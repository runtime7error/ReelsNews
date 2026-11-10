# ReelsNews ⚽📱

Notícias esportivas em alta exibidas como **Reels** com foco editorial no texto da notícia, placar e dados da partida, lendo diretamente do arquivo [`feed.json`](./feed.json).

## Rodando

```bash
npm install
npm start        # http://localhost:3000
```

## Como funciona

- **`server.js`** (Node + Express)
  - Lê `feed.json` a cada requisição (basta atualizar o arquivo para refletir no app sem reiniciar).
  - Cruza `noticias` com `monitoramento.tendencias` (ranking, volume de buscas, crescimento percentual).
  - Busca opcionalmente a `og:image` das matérias nas fontes apenas para compor a ambientação de fundo no topo do card.
  - `GET /api/feed` → retorna os itens prontos para os reels.
- **`public/`** (HTML/CSS/JS puro):
  - Interface limpa sem a barra de navegação inferior de celular.
  - Foco no texto: manchete em destaque, card de placar (`scoreboard`), parágrafos com leitura guiada (o parágrafo ativo fica aceso sincronizado com as barras de progresso no topo) e fatos extras (classificação e próximo jogo).

## Interações

| Ação | Gesto / Tecla |
| --- | --- |
| Próximo / anterior reel | rolar, `↑` `↓` |
| Próximo / anterior parágrafo | toque nas laterais (esq/dir), `←` `→` |
| Pausar leitura | toque no centro, `Espaço` |
| Curtir | toque duplo, ❤, tecla `L` |
| Ver fontes originais | 💬 |
| Compartilhar | ✈ |
| Dados do monitoramento | toque em "Reels" no topo |
