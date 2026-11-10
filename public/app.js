const $ = (s, el = document) => el.querySelector(s);

const feed = $('#feed');
const tpl = $('#reelTpl');
const WORDS_PER_SEC = 3.2; // velocidade de leitura usada para o tempo de cada parágrafo
const MIN_SEG = 4; // segundos mínimos por parágrafo

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

const state = {
  likes: new Set(store.get('likes', [])),
  following: new Set(store.get('following', [])),
  items: [],
  meta: null,
  paused: false,
};

/* ------------------------------------------------------------ */
/* Utilidades                                                    */
/* ------------------------------------------------------------ */
function parseVolume(t) {
  const m = String(t || '').toLowerCase().match(/([\d.,]+)\s*(mil|k|milh|mi|m|bilh)?/);
  if (!m) return 1000;
  let n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  const s = m[2] || '';
  if (s === 'mil' || s === 'k') n *= 1e3;
  else if (s.startsWith('milh') || s === 'mi' || s === 'm') n *= 1e6;
  else if (s.startsWith('bilh')) n *= 1e9;
  return n || 1000;
}

function fmt(n) {
  n = Math.round(n);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} mi`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1).replace('.', ',').replace(',0', '')} mil`;
  return n.toLocaleString('pt-BR');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (isNaN(d)) return '';
  const min = Math.max(1, Math.round((Date.now() - d) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return days < 7 ? `há ${days} d` : d.toLocaleDateString('pt-BR');
}

function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const seeded = (s) => (hash(s) % 1000) / 1000;

function initials(name) {
  const words = String(name).replace(/[^\p{L}\d\s-]/gu, '').split(/[\s-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

function handle(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'noticias';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

// "Atlético de Madrid 1-2 Barcelona" / "Vasco 2-1 Palmeiras (4-5 nos pênaltis)"
function parseScore(placar) {
  const m = String(placar || '').match(/^(.+?)\s+(\d+)\s*[-x×]\s*(\d+)\s+(.+?)(?:\s*\((.+)\))?$/i);
  if (!m) return null;
  return { home: m[1].trim(), hs: +m[2], as: +m[3], away: m[4].trim(), extra: m[5] || '' };
}

const STATUS = {
  encerrada: 'Encerrado', 'em andamento': 'Ao vivo', 'ao vivo': 'Ao vivo',
  agendada: 'Em breve', adiada: 'Adiado', intervalo: 'Intervalo',
};

const searchUrl = (item) => `https://www.google.com/search?q=${encodeURIComponent(item.termo || item.titulo)}&tbm=nws`;
const trendsUrl = (item) => `https://trends.google.com/trends/explore?geo=BR&date=now%201-d&q=${encodeURIComponent(item.termo)}`;
const mainUrl = (item) => item.link || searchUrl(item);

/* ------------------------------------------------------------ */
/* Carregamento                                                  */
/* ------------------------------------------------------------ */
async function load() {
  const btn = $('#btnRefresh');
  btn.classList.add('spin');
  try {
    const res = await fetch('/api/feed', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar');
    state.items = data.items;
    state.meta = data;
    render(data);
  } catch (err) {
    feed.innerHTML = `
      <div class="state">
        <h2>Não foi possível carregar</h2>
        <p>${esc(err.message)}</p>
        <button class="btn" data-act="retry">Tentar novamente</button>
      </div>`;
  } finally {
    btn.classList.remove('spin');
  }
}

function render(data) {
  feed.innerHTML = '';
  feed.scrollTop = 0;

  if (!data.items.length) {
    feed.innerHTML = `
      <div class="state">
        <h2>Nenhuma notícia no feed</h2>
        <p>O arquivo feed.json não tem itens em "noticias".</p>
        <button class="btn" data-act="retry">Recarregar</button>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  data.items.forEach((item, i) => frag.appendChild(buildReel(item, i)));

  const end = document.createElement('div');
  end.className = 'reel state';
  const coleta = data.monitoramento?.dataColeta;
  end.innerHTML = `
    <h2>Você está em dia ✨</h2>
    <p>Essas foram as ${data.items.length} notícias em alta${coleta ? `, coletadas ${esc(timeAgo(coleta))}` : ''}.</p>
    <button class="btn" data-act="retry">Atualizar feed</button>`;
  frag.appendChild(end);

  feed.appendChild(frag);
  observe();
}

function buildReel(item, index) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.index = index;
  el.style.setProperty('--h', hash(item.subcategoria || item.id) % 360);

  const esporte = item.esporte || {};
  const volume = parseVolume(item.trend?.volume);
  const r = seeded(item.id);
  const author = item.fontes[0]?.veiculo || 'Google Trends';

  // foto (apenas ambientação)
  const img = $('.cover', el);
  if (item.image) {
    img.src = item.image;
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.remove();
    $('.audio-thumb', el).style.backgroundImage = `url("${item.image}")`;
  } else img.remove();

  // selo de tendência
  const badge = [
    item.ranking ? `#${item.ranking} em alta` : 'Em alta',
    item.trend?.volume && `${item.trend.volume} buscas`,
    item.trend?.crescimento && `↑ ${item.trend.crescimento}`,
  ].filter(Boolean).join(' · ');
  $('.trend-text', el).textContent = badge;

  // tags
  const tags = [esporte.campeonato || item.subcategoria, timeAgo(item.data)].filter(Boolean);
  $('.tags', el).innerHTML = tags.map((t, i) => `<span class="tag ${i ? 'alt' : ''}">${esc(t)}</span>`).join('');

  // título
  $('.headline', el).textContent = item.titulo;

  // placar
  const score = parseScore(esporte.placar);
  if (score) {
    const sb = $('.scoreboard', el);
    sb.hidden = false;
    const fill = (side, name, goals, other) => {
      const t = $(`.team.${side}`, sb);
      $('.team-name', t).textContent = name;
      const crest = $('.crest', t);
      crest.textContent = initials(name);
      crest.style.setProperty('--c', hash(name) % 360);
      if (goals > other) t.classList.add('win');
    };
    fill('home', score.home, score.hs, score.as);
    fill('away', score.away, score.as, score.hs);
    $('.s-home', sb).textContent = score.hs;
    $('.s-away', sb).textContent = score.as;
    const st = String(esporte.status_partida || '').toLowerCase();
    const stEl = $('.score-status', sb);
    stEl.textContent = STATUS[st] || st;
    stEl.classList.toggle('live', /vivo|andamento/.test(st));
    $('.score-extra', sb).textContent = score.extra;
  }

  // parágrafos
  const paras = item.paragrafos.length ? item.paragrafos : [item.titulo];
  $('.body', el).innerHTML = paras.map((p) => `<p>${esc(p)}</p>`).join('');
  el._segs = paras.map((p) => Math.max(MIN_SEG, p.split(/\s+/).length / WORDS_PER_SEC));
  $('.progress', el).innerHTML = paras.map(() => '<i><b></b></i>').join('');

  // fatos extras
  const facts = [];
  const cls = (esporte.classificacao || []).map((c) =>
    [c.time, c.resultado, c.posicao && `${c.posicao}º lugar`, c.pontos && `${c.pontos} pts`].filter(Boolean).join(' · '));
  if (cls.length) facts.push(['🏆', cls.join(' | ')]);
  if (esporte.proximo_evento) facts.push(['📅', `<b>Próximo:</b> ${esc(esporte.proximo_evento)}`]);
  $('.facts', el).innerHTML = facts.map(([i, t]) => `<div><span>${i}</span><span>${i === '🏆' ? esc(t) : t}</span></div>`).join('');

  // métricas
  const likes = volume * (0.02 + r * 0.03) + (state.likes.has(item.id) ? 1 : 0);
  $('.like-count', el).textContent = fmt(likes);
  $('.comment-count', el).textContent = fmt(item.fontes.length);
  $('.share-count', el).textContent = fmt(volume * (0.002 + r * 0.004));
  if (state.likes.has(item.id)) $('.like', el).classList.add('liked');

  // autor
  $('.author-avatar', el).textContent = initials(author).slice(0, 2);
  $('.author-name', el).textContent = handle(author);
  const follow = $('.follow', el);
  follow.dataset.author = author;
  if (state.following.has(author)) { follow.classList.add('following'); follow.textContent = 'Seguindo'; }

  // "música" e buscas
  $('.music-text', el).textContent = `Google Trends · ${item.termo}${esporte.atletas?.length ? ` · ${esporte.atletas.join(', ')}` : ''}`;
  $('.marquee', el).innerHTML += $('.marquee', el).innerHTML; // loop contínuo
  $('.users-text', el).textContent = `${item.trend?.volume || '—'} buscas`;

  return el;
}

/* ------------------------------------------------------------ */
/* Reprodução: avança parágrafo a parágrafo                       */
/* ------------------------------------------------------------ */
let observer;
function observe() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(e.target);
      else deactivate(e.target);
    }
  }, { root: feed, threshold: [0, 0.6, 1] });
  feed.querySelectorAll('.reel').forEach((r) => observer.observe(r));
}

function activate(reel) {
  if (reel.classList.contains('playing') || reel.classList.contains('state')) return;
  reel.classList.add('playing');
  reel.classList.toggle('paused', state.paused);
  showParagraph(reel, 0);
}

function deactivate(reel) {
  reel.classList.remove('playing', 'paused');
  reel.querySelectorAll('.progress i').forEach((s) => s.classList.remove('done', 'current'));
  reel.querySelectorAll('.body p').forEach((p) => p.classList.remove('active'));
}

function showParagraph(reel, i) {
  const segs = [...reel.querySelectorAll('.progress i')];
  const paras = [...reel.querySelectorAll('.body p')];
  reel._p = i;
  reel.style.setProperty('--seg', `${reel._segs[i]}s`);
  segs.forEach((s, j) => {
    s.classList.toggle('done', j < i);
    s.classList.remove('current');
  });
  void segs[i]?.offsetWidth; // reinicia a animação
  segs[i]?.classList.add('current');
  paras.forEach((p, j) => p.classList.toggle('active', j === i));
}

feed.addEventListener('animationend', (e) => {
  if (e.animationName !== 'fill') return;
  const reel = e.target.closest('.reel');
  if (!reel?.classList.contains('playing')) return;
  const next = reel._p + 1;
  if (next < reel._segs.length) showParagraph(reel, next);
  else go(1);
});

function current() {
  return feed.children[Math.round(feed.scrollTop / feed.clientHeight)];
}

function go(dir) {
  feed.scrollBy({ top: dir * feed.clientHeight, behavior: 'smooth' });
}

function itemOf(el) {
  const reel = el?.closest?.('.reel');
  return reel && state.items[reel.dataset.index];
}

/* ------------------------------------------------------------ */
/* Interações                                                    */
/* ------------------------------------------------------------ */
function toggleLike(reel, forceOn = false) {
  const item = itemOf(reel);
  if (!item) return;
  const on = forceOn || !state.likes.has(item.id);
  if (on === state.likes.has(item.id)) return;
  on ? state.likes.add(item.id) : state.likes.delete(item.id);
  store.set('likes', [...state.likes]);
  $('.like', reel).classList.toggle('liked', on);
  const base = parseVolume(item.trend?.volume) * (0.02 + seeded(item.id) * 0.03);
  $('.like-count', reel).textContent = fmt(base + (on ? 1 : 0));
}

function heartBurst(reel) {
  const h = $('.big-heart', reel);
  h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
}

function togglePause() {
  state.paused = !state.paused;
  current()?.classList.toggle('paused', state.paused);
  toast(state.paused ? '⏸ Pausado' : '▶ Reproduzindo');
}

// pula para o parágrafo anterior/seguinte (toque nas laterais, como nos stories)
function stepParagraph(reel, dir) {
  const i = (reel._p ?? 0) + dir;
  if (i < 0) return go(-1);
  if (i >= reel._segs.length) return go(1);
  showParagraph(reel, i);
}

async function share(item) {
  const url = mainUrl(item);
  try {
    if (navigator.share) await navigator.share({ title: item.titulo, text: item.titulo, url });
    else { await navigator.clipboard.writeText(url); toast('Link copiado'); }
  } catch { /* cancelado */ }
}

let tapTimer = null;
feed.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="retry"]')) return load();

  const reel = e.target.closest('.reel');
  if (!reel || reel.classList.contains('state')) return;
  const item = itemOf(reel);

  if (e.target.closest('.like')) return toggleLike(reel);
  if (e.target.closest('.comments')) return openSources(item);
  if (e.target.closest('.share')) return share(item);
  if (e.target.closest('.more')) return openMore(item);
  if (e.target.closest('.audio')) return window.open(mainUrl(item), '_blank', 'noopener');
  if (e.target.closest('.follow')) {
    const a = e.target.closest('.follow').dataset.author;
    const on = !state.following.has(a);
    on ? state.following.add(a) : state.following.delete(a);
    store.set('following', [...state.following]);
    feed.querySelectorAll('.follow').forEach((f) => {
      if (f.dataset.author === a) { f.classList.toggle('following', on); f.textContent = on ? 'Seguindo' : 'Seguir'; }
    });
    return;
  }
  if (e.target.closest('.author')) return window.open(mainUrl(item), '_blank', 'noopener');

  // toque duplo = curtir; toque simples: laterais trocam parágrafo, centro pausa
  if (tapTimer) {
    clearTimeout(tapTimer); tapTimer = null;
    toggleLike(reel, true); heartBurst(reel);
    return;
  }
  const rect = reel.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  tapTimer = setTimeout(() => {
    tapTimer = null;
    if (x < 0.25) stepParagraph(reel, -1);
    else if (x > 0.75) stepParagraph(reel, 1);
    else togglePause();
  }, 250);
});

document.addEventListener('keydown', (e) => {
  if ($('#sheet').classList.contains('open')) { if (e.key === 'Escape') closeSheet(); return; }
  const r = current();
  if (['ArrowDown', 'j', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
  else if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
  else if (e.key === 'ArrowRight' && r?._segs) stepParagraph(r, 1);
  else if (e.key === 'ArrowLeft' && r?._segs) stepParagraph(r, -1);
  else if (e.key === ' ') { e.preventDefault(); togglePause(); }
  else if (e.key.toLowerCase() === 'l' && r?._segs) { toggleLike(r, true); heartBurst(r); }
});

$('#btnBack').addEventListener('click', () => go(-1));
$('#btnRefresh').addEventListener('click', () => load());
$('#btnInfo').addEventListener('click', openInfo);

/* ------------------------------------------------------------ */
/* Bottom sheets                                                 */
/* ------------------------------------------------------------ */
function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBackdrop').hidden = false;
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('#sheetBackdrop').hidden = true;
}
$('#sheetBackdrop').addEventListener('click', closeSheet);

function openSources(item) {
  const list = item.fontes.map((f) => `
    <a class="news-item" href="${esc(f.url)}" target="_blank" rel="noopener">
      <span class="ico">${esc(initials(f.veiculo).slice(0, 2))}</span>
      <div>
        <div class="src">${esc(f.veiculo)}${f.data_publicacao ? ` · ${esc(timeAgo(f.data_publicacao))}` : ''}</div>
        <div class="ttl">${esc(f.titulo_original)}</div>
      </div>
    </a>`).join('');
  openSheet('Fontes', list || '<p class="note">Sem fontes informadas.</p>');
}

function openMore(item) {
  openSheet('Opções', `
    <a class="sheet-row" href="${esc(mainUrl(item))}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>Abrir matéria original
    </a>
    <a class="sheet-row" href="${esc(trendsUrl(item))}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>Ver "${esc(item.termo)}" no Google Trends
    </a>
    <a class="sheet-row" href="${esc(searchUrl(item))}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>Mais notícias sobre o assunto
    </a>
    <button class="sheet-row" data-copy="${esc(mainUrl(item))}">
      <svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>Copiar link
    </button>`);
}

function openInfo() {
  const m = state.meta?.monitoramento || {};
  const obs = state.meta?.resumo?.observacoes || [];
  const coleta = m.dataColeta ? new Date(m.dataColeta).toLocaleString('pt-BR') : '—';
  openSheet('Sobre este feed', `
    <p class="note"><b>Fonte:</b> ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener" style="color:#4da3ff">${esc(m.fonte || m.url)}</a>` : esc(m.fonte || '—')}</p>
    <p class="note"><b>Coleta:</b> ${esc(coleta)} · últimas ${esc(m.periodoHoras ?? '—')} h</p>
    <p class="note"><b>Filtro editorial:</b> ${esc(m.filtro || '—')}</p>
    ${m.observacao ? `<p class="note">${esc(m.observacao)}</p>` : ''}
    ${obs.length ? `<ul class="note">${obs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}`);
}

$('#sheetBody').addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.copy) { await navigator.clipboard.writeText(t.dataset.copy).catch(() => {}); toast('Link copiado'); closeSheet(); }
  else if (t.tagName === 'A') closeSheet();
});

load();
