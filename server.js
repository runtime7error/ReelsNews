import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FEED_FILE = process.env.FEED_FILE || path.join(__dirname, 'feed.json');
const OG_TTL = 6 * 60 * 60 * 1000; // 6 h
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const app = express();
const ogCache = new Map(); // url -> { at, image }

/* ------------------------------------------------------------------ */
/* Leitura do feed.json                                                */
/* ------------------------------------------------------------------ */
// O arquivo é relido a cada requisição: basta substituir o feed.json
// para o conteúdo ser atualizado, sem reiniciar o servidor.
async function readFeed() {
  const raw = await fs.readFile(FEED_FILE, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

function buildItems(feed) {
  const trends = feed?.monitoramento?.tendencias || [];
  const byRank = new Map(trends.map((t) => [t.ranking, t]));
  const byTerm = new Map(trends.map((t) => [String(t.assunto).toLowerCase(), t]));

  return (feed?.noticias || [])
    .map((n) => {
      const trend =
        byRank.get(n.ranking_trends) || byTerm.get(String(n.termo_trends || '').toLowerCase()) || null;
      const fontes = (n.fontes || []).filter((f) => f?.url);
      return {
        id: n.id,
        ranking: n.ranking_trends ?? trend?.ranking ?? null,
        termo: n.termo_trends || trend?.assunto || '',
        categoria: n.categoria || trend?.categoria || '',
        subcategoria: n.subcategoria || '',
        titulo: n.titulo || '',
        paragrafos: (n.paragrafos || []).filter(Boolean),
        data: n.data_publicacao || n.data_evento || null,
        dataEvento: n.data_evento || null,
        esporte: n.esporte || null,
        entidades: n.entidades || [],
        link: n.link_principal || fontes[0]?.url || null,
        fontes,
        trend: trend && {
          volume: trend.volume_buscas,
          crescimento: trend.crescimento_percentual,
          inicio: trend.inicio_tendencia,
        },
      };
    })
    .sort((a, b) => (a.ranking ?? 999) - (b.ranking ?? 999));
}

/* ------------------------------------------------------------------ */
/* Imagem de capa (og:image) da matéria principal — usada só de fundo  */
/* ------------------------------------------------------------------ */
async function fetchOgImage(url) {
  if (!url) return null;
  const cached = ogCache.get(url);
  if (cached && Date.now() - cached.at < OG_TTL) return cached.image;

  let image = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      while (html.length < 300_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.includes('</head>')) break;
      }
      reader.cancel().catch(() => {});
      const m =
        html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
      if (m) image = new URL(m[1].replace(/&amp;/g, '&'), res.url).href;
    }
  } catch {
    /* sem imagem: o card usa só o gradiente */
  } finally {
    clearTimeout(timer);
  }
  ogCache.set(url, { at: Date.now(), image });
  return image;
}

/* ------------------------------------------------------------------ */
/* Rotas                                                               */
/* ------------------------------------------------------------------ */
app.get('/api/feed', async (_req, res) => {
  try {
    const feed = await readFeed();
    const items = buildItems(feed);

    // tenta a matéria principal e depois as demais fontes
    await Promise.all(items.map(async (it) => {
      const urls = [it.link, ...it.fontes.map((f) => f.url)].filter((u, i, a) => u && a.indexOf(u) === i);
      for (const u of urls) {
        it.image = await fetchOgImage(u);
        if (it.image) break;
      }
    }));

    const m = feed.monitoramento || {};
    res.json({
      monitoramento: {
        fonte: m.fonte, url: m.url, dataColeta: m.data_coleta, periodoHoras: m.periodo_horas,
        filtro: m.filtro_editorial, observacao: m.observacao,
      },
      resumo: feed.resumo_execucao || null,
      items,
    });
  } catch (err) {
    console.error(err);
    const msg = err.code === 'ENOENT' ? `Arquivo não encontrado: ${FEED_FILE}` : `Erro ao ler feed.json: ${err.message}`;
    res.status(500).json({ error: msg });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`ReelsNews rodando em http://localhost:${PORT}  (feed: ${FEED_FILE})`);
});
