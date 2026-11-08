/*
 * Vídeo — linha do tempo: cabeçalhos das trilhas (origem, alvo, trava, olho, mudo e solo, linha Mix), régua
 * com entrada/saída e marcadores, clipes (miniaturas, forma de onda, selo fx, linha de opacidade/volume com
 * quadros-chave), transições e as ferramentas de edição: Seleção, Trilha para a frente, Ondulação, Rolante,
 * Esticar velocidade, Navalha, Slip, Slide, Mão, Zoom e Texto.
 *
 * Arrastar sempre parte de uma "fotografia" do projeto tirada no começo do gesto: a cada movimento o projeto
 * volta à fotografia e recebe o deslocamento total. Assim as operações de edição.js (que não são reversíveis
 * aos pedaços) ficam exatas e o Ctrl+Z desfaz o gesto inteiro.
 */
(function () {
  "use strict";
  const { el, $, limitar, icone } = LNUX;
  const L = (V.Linha = {});
  let A = null; // V.app (criado em video.js)
  let pxs = 40; // pixels por segundo
  let regua, pistas, rolagem, espaco, cabecalhos, barraFerramentas, faixaZoom;
  let mostrarLinhas = true; // linhas de opacidade (vídeo) e volume (áudio) dentro dos clipes
  let guia = null; // tempo da linha de encaixe durante um gesto
  let fantasma = null; // prévia ao soltar mídia ou efeito: {trilha, de, ate} | {clipe}
  let laco = null; // seleção por laço: {x0, y0, x1, y1} em px do conteúdo
  let arrasto = null;
  let assinaturaTrilhas = "";
  let projetoVisto = null;
  const MIX = 30; // altura da linha Mix
  const CAB = 15; // altura da faixa do nome dentro do clipe
  const cor = (v) => LNUX.tema.cor(v);
  const fonte = () => getComputedStyle(document.body).fontFamily;

  // ── Geometria ───────────────────────────────────────────────────────

  function alturaBase() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--altura-trilha")) || 52; }
  /** Posição vertical de cada trilha (em px do conteúdo). Trilhas "altas" têm o dobro da altura. */
  function layout() {
    const H = alturaBase();
    const mapa = new Map();
    let y = 0;
    for (const t of A.projeto.trilhas) { const h = Math.round(t.alta ? H * 2 : H); mapa.set(t.id, { y, h, t }); y += h; }
    return { mapa, total: y };
  }
  function trilhaEm(yc) {
    for (const g of layout().mapa.values()) if (yc >= g.y && yc < g.y + g.h) return g;
    return null;
  }
  function ponto(e) {
    const r = pistas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, t: Math.max(0, (x + rolagem.scrollLeft) / pxs), yc: y + rolagem.scrollTop };
  }
  /** Retângulo do clipe na tela (px do canvas). */
  function retangulo(c, g) {
    return { x: c.inicio * pxs - rolagem.scrollLeft, y: g.y - rolagem.scrollTop + 1, w: Math.max(2, c.duracao * pxs), h: g.h - 2 };
  }
  /** Trecho de tempo de uma transição (igual ao compositor). */
  function regiaoTransicao(tr) {
    const a = tr.a && A.clipe(tr.a), b = tr.b && A.clipe(tr.b);
    if (a && b) return { de: b.inicio - tr.duracao / 2, ate: b.inicio + tr.duracao / 2, a, b };
    if (b) return { de: b.inicio, ate: b.inicio + tr.duracao, a: null, b };
    if (a) return { de: V.fim(a) - tr.duracao, ate: V.fim(a), a, b: null };
    return null;
  }

  // Linha de opacidade/volume: valor → fração da altura
  const caminhoDaLinha = (trilha) => (trilha.tipo === "audio" ? "audio.nivel" : "opac.valor");
  const fracao = (caminho, v) => (caminho === "audio.nivel" ? limitar(((v ?? 0) + 60) / 75, 0, 1) : limitar((v ?? 100) / 100, 0, 1));
  const daFracao = (caminho, f) => (caminho === "audio.nivel" ? (f <= 0.001 ? -96 : Math.round((f * 75 - 60) * 10) / 10) : Math.round(limitar(f, 0, 1) * 1000) / 10);
  function yDaLinha(r, caminho, v) { return r.y + CAB + 3 + (1 - fracao(caminho, v)) * (r.h - CAB - 6); }
  const temLinha = (r) => mostrarLinhas && r.h - CAB >= 18;

  // ── Encaixe (ímã) ───────────────────────────────────────────────────

  function encaixar(t, ignorar, forcar) {
    if (!A.ima && !forcar) return { t: A.arredondar(t), guia: null };
    const p = A.projeto;
    const pontos = [0, A.cursor, ...p.marcadores.map((m) => m.tempo)];
    if (p.entrada !== null) pontos.push(p.entrada);
    if (p.saida !== null) pontos.push(p.saida);
    for (const c of p.clipes) if (!ignorar || !ignorar.has(c.id)) pontos.push(c.inicio, V.fim(c));
    let melhor = null, d = 9 / pxs;
    for (const x of pontos) { const dd = Math.abs(x - t); if (dd < d) { d = dd; melhor = x; } }
    return melhor === null ? { t: A.arredondar(t), guia: null } : { t: melhor, guia: melhor };
  }

  // ── Desenho ─────────────────────────────────────────────────────────

  function preparar(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + "px"; c.style.height = h + "px"; }
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return x;
  }
  function passo() {
    const q = 1 / A.projeto.fps;
    for (const p of [q, 2 * q, 5 * q, 10 * q, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]) if (p * pxs >= 80) return p;
    return 3600;
  }
  function rotuloTempo(t, p) {
    const tc = A.tempo(t);
    const sem = tc.startsWith("00:") ? tc.slice(3) : tc;
    return p < 1 ? sem : sem.slice(0, sem.length - 3);
  }
  function atualizarEspaco() {
    const w = rolagem.clientWidth;
    const fim = Math.max(A.duracao() + 30, (w / pxs) * 1.2, 60);
    espaco.style.width = Math.ceil(fim * pxs) + "px";
    espaco.style.height = layout().total + MIX + 40 + "px";
  }

  function desenharRegua() {
    const w = regua.clientWidth, h = regua.clientHeight;
    if (!w || !h) return;
    const ctx = preparar(regua, w, h);
    const p = A.projeto, sl = rolagem.scrollLeft, t0 = sl / pxs, t1 = (sl + w) / pxs;
    ctx.fillStyle = cor("--painel"); ctx.fillRect(0, 0, w, h);
    if (p.entrada !== null || p.saida !== null) {
      const a = (p.entrada ?? 0) * pxs - sl, b = (p.saida ?? Math.max(A.duracao(), p.entrada + 1)) * pxs - sl;
      ctx.fillStyle = "rgba(79,143,247,.3)"; ctx.fillRect(a, h - 7, Math.max(2, b - a), 7);
      ctx.fillStyle = "#4f8ff7";
      if (p.entrada !== null) ctx.fillRect(a, 4, 2, h - 4);
      if (p.saida !== null) ctx.fillRect(b - 2, 4, 2, h - 4);
    }
    const ps = passo();
    ctx.strokeStyle = cor("--borda-forte"); ctx.fillStyle = cor("--texto-3");
    ctx.font = "10px " + fonte(); ctx.textBaseline = "top";
    ctx.beginPath();
    for (let i = Math.floor(t0 / ps); i * ps <= t1 + ps; i++) {
      const x = Math.round(i * ps * pxs - sl) + 0.5;
      ctx.moveTo(x, 12); ctx.lineTo(x, h);
      for (let k = 1; k < 5; k++) { const xk = Math.round((i + k / 5) * ps * pxs - sl) + 0.5; ctx.moveTo(xk, h - 5); ctx.lineTo(xk, h); }
      ctx.fillText(rotuloTempo(i * ps, ps), x + 3, 2);
    }
    ctx.stroke();
    for (const m of p.marcadores) {
      const x = m.tempo * pxs - sl;
      if (x < -200 || x > w + 10) continue;
      ctx.fillStyle = A.CORES_MARCADOR[m.cor] || "#3fbf6f";
      if (m.duracao > 0) { ctx.globalAlpha = 0.5; ctx.fillRect(x, h - 12, m.duracao * pxs, 6); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.moveTo(x - 5, h - 15); ctx.lineTo(x + 5, h - 15); ctx.lineTo(x + 5, h - 9); ctx.lineTo(x, h - 4); ctx.lineTo(x - 5, h - 9); ctx.closePath(); ctx.fill();
    }
    const xc = A.cursor * pxs - sl;
    ctx.fillStyle = "#4f8ff7";
    ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc + 6, 8); ctx.lineTo(xc, 14); ctx.lineTo(xc - 6, 8); ctx.closePath(); ctx.fill();
    ctx.fillRect(xc - 0.5, 14, 1, h - 14);
  }

  function corDoClipe(c, m, audio) {
    const rot = c.rotulo || (m && m.rotulo) || { texto: "manga", forma: "tangerina", cor: "rosa", ajuste: "lavanda" }[c.tipo];
    return A.CORES_ROTULO[rot] || (audio ? "#3fa34d" : "#5b9dff");
  }

  function desenharPistas() {
    const w = rolagem.clientWidth, h = rolagem.clientHeight;
    if (!w || !h) return;
    const ctx = preparar(pistas, w, h);
    const geo = layout();
    const p = A.projeto, sl = rolagem.scrollLeft, st = rolagem.scrollTop, t0 = sl / pxs, t1 = (sl + w) / pxs;
    ctx.fillStyle = cor("--trilha"); ctx.fillRect(0, 0, w, h);
    let anterior = null;
    for (const [id, g] of geo.mapa) {
      const y = g.y - st;
      if (y < h && y + g.h > 0) {
        ctx.fillStyle = g.t.tipo === "audio" ? cor("--trilha-alt") : cor("--trilha");
        ctx.fillRect(0, y, w, g.h);
        if (id === A.trilhaAtiva) { ctx.fillStyle = cor("--destaque-suave"); ctx.globalAlpha = 0.45; ctx.fillRect(0, y, w, g.h); ctx.globalAlpha = 1; }
        if (g.t.travada) {
          ctx.strokeStyle = cor("--borda"); ctx.beginPath();
          for (let x = -(sl % 12) - g.h; x < w; x += 12) { ctx.moveTo(x, y + g.h); ctx.lineTo(x + g.h, y); }
          ctx.stroke();
        }
        ctx.fillStyle = cor("--borda"); ctx.fillRect(0, y + g.h - 1, w, 1);
        if (anterior && anterior.tipo === "video" && g.t.tipo === "audio") { ctx.fillStyle = cor("--borda-forte"); ctx.fillRect(0, y - 1, w, 2); }
      }
      anterior = g.t;
    }
    // linha Mix (mestre) embaixo das trilhas
    const ym = geo.total - st;
    ctx.fillStyle = cor("--painel"); ctx.fillRect(0, ym, w, MIX);
    ctx.fillStyle = cor("--borda-forte"); ctx.fillRect(0, ym, w, 1);
    // grade
    const ps = passo();
    ctx.strokeStyle = cor("--borda"); ctx.globalAlpha = 0.45; ctx.beginPath();
    for (let i = Math.floor(t0 / ps); i * ps <= t1 + ps; i++) { const x = Math.round(i * ps * pxs - sl) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, Math.min(h, ym)); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // entrada → saída
    if (p.entrada !== null || p.saida !== null) {
      const a = (p.entrada ?? 0) * pxs - sl, b = (p.saida ?? Math.max(A.duracao(), p.entrada + 1)) * pxs - sl;
      ctx.fillStyle = "rgba(79,143,247,.09)"; ctx.fillRect(a, 0, b - a, Math.min(h, ym));
    }
    // clipes
    for (const c of p.clipes) {
      if (V.fim(c) < t0 || c.inicio > t1) continue;
      const g = geo.mapa.get(c.trilha);
      if (!g || g.y - st > h || g.y + g.h - st < 0) continue;
      desenharClipe(ctx, c, retangulo(c, g), w, g.t);
    }
    // transições
    for (const tr of p.transicoes) {
      const g = geo.mapa.get(tr.trilha), rg = regiaoTransicao(tr);
      if (!g || !rg) continue;
      const x = rg.de * pxs - sl, xw = Math.max(4, (rg.ate - rg.de) * pxs), y = g.y - st + 1 + CAB, hh = Math.max(8, g.h - 2 - CAB);
      if (x > w || x + xw < 0) continue;
      const def = V.TRANSICOES.find((x) => x.id === tr.tipo) || V.TRANSICOES_AUDIO.find((x) => x.id === tr.tipo);
      ctx.fillStyle = "rgba(168,121,242,.78)"; ctx.fillRect(x, y, xw, hh);
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.moveTo(x, y + hh); ctx.lineTo(x + xw, y); ctx.stroke();
      if (A.transicaoEscolhida === tr.id) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, xw - 2, hh - 2); ctx.lineWidth = 1; }
      if (xw > 46 && def) { ctx.fillStyle = "#fff"; ctx.font = "600 10px " + fonte(); ctx.textBaseline = "middle"; ctx.fillText(def.nome, x + 4, y + Math.min(9, hh / 2), xw - 8); }
    }
    // prévia ao soltar
    if (fantasma && fantasma.trilha) {
      const g = geo.mapa.get(fantasma.trilha);
      if (g) {
        const x = fantasma.de * pxs - sl;
        ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.strokeStyle = "#fff"; ctx.setLineDash([4, 3]);
        ctx.fillRect(x, g.y - st + 1, (fantasma.ate - fantasma.de) * pxs, g.h - 2); ctx.strokeRect(x + 0.5, g.y - st + 1.5, (fantasma.ate - fantasma.de) * pxs - 1, g.h - 3);
        ctx.setLineDash([]);
        if (fantasma.inserir) { ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, 0, 2, Math.min(h, ym)); }
      }
    }
    // marcadores
    for (const m of p.marcadores) {
      const x = Math.round(m.tempo * pxs - sl) + 0.5;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = A.CORES_MARCADOR[m.cor] || "#3fbf6f"; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Math.min(h, ym)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // laço
    if (laco) {
      const x = Math.min(laco.x0, laco.x1) - sl, y = Math.min(laco.y0, laco.y1) - st;
      ctx.fillStyle = "rgba(79,143,247,.15)"; ctx.strokeStyle = "#4f8ff7";
      ctx.fillRect(x, y, Math.abs(laco.x1 - laco.x0), Math.abs(laco.y1 - laco.y0)); ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(laco.x1 - laco.x0), Math.abs(laco.y1 - laco.y0));
    }
    // linha de encaixe
    if (guia !== null) {
      const x = Math.round(guia * pxs - sl) + 0.5;
      ctx.strokeStyle = cor("--texto"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Math.min(h, ym)); ctx.stroke();
      ctx.fillStyle = cor("--texto");
      ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 6); ctx.fill();
    }
    // cursor
    const xc = Math.round(A.cursor * pxs - sl) + 0.5;
    ctx.strokeStyle = "#4f8ff7"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, h); ctx.stroke();
  }

  function desenharClipe(ctx, c, r, largura, trilha) {
    const m = c.tipo === "midia" ? A.midia(c.midia) : null;
    const audio = trilha.tipo === "audio";
    const xi = Math.max(r.x, -2), xf = Math.min(r.x + r.w, largura + 2);
    if (xf <= xi) return;
    const desligado = c.ativo === false;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3); else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalAlpha = desligado ? 0.35 : 0.82;
    ctx.fillStyle = corDoClipe(c, m, audio); ctx.fillRect(xi, r.y, xf - xi, r.h);
    ctx.globalAlpha = desligado ? 0.35 : 1;
    const corpo = r.h - CAB;
    // miniaturas (tira de filme) nos clipes de vídeo e imagem
    if (!audio && m && m.tipo !== "audio" && corpo > 12) {
      const img = A.miniaturas.get(c.midia);
      if (img && img.complete && img.naturalWidth) {
        const tw = corpo * 16 / 9;
        for (let x = r.x; x < xf; x += tw) if (x + tw > xi) ctx.drawImage(img, x, r.y + CAB, Math.min(tw, r.x + r.w - x), corpo);
      }
    }
    // forma de onda nos clipes de áudio
    if (audio && m && corpo > 8) {
      const pk = A.picos.get(c.midia);
      if (pk) {
        const meio = r.y + CAB + corpo / 2, amp = (corpo - 4) / 2, vel = c.velocidade || 1;
        ctx.fillStyle = "rgba(255,255,255,.72)";
        for (let x = Math.floor(xi); x < xf; x++) {
          const a = c.entrada + ((x - r.x) / pxs) * vel, b = c.entrada + ((x + 1 - r.x) / pxs) * vel;
          let mi = 0, ma = 0;
          for (let i = Math.max(0, Math.floor(a * pk.taxa)), f = Math.min(pk.max.length, Math.ceil(b * pk.taxa)); i < f; i++) { if (pk.min[i] < mi) mi = pk.min[i]; if (pk.max[i] > ma) ma = pk.max[i]; }
          const g = Math.pow(10, (V.valor(c, "audio.nivel", (x - r.x) / pxs) ?? 0) / 20);
          ctx.fillRect(x, meio - Math.min(1, ma * g) * amp, 1, Math.max(1, (Math.min(1, ma * g) - Math.max(-1, mi * g)) * amp));
        }
      } else if (corpo > 20) { ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "10px " + fonte(); ctx.fillText("forma de onda...", Math.max(r.x, 0) + 4, r.y + CAB + corpo / 2); }
    }
    if ((c.tipo === "texto" || c.tipo === "forma" || c.tipo === "cor" || c.tipo === "ajuste") && corpo > 14) {
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "italic 11px " + fonte(); ctx.textBaseline = "middle";
      const txt = c.tipo === "texto" ? (c.texto.conteudo || "").replace(/\n/g, " ⏎ ") : { forma: "▭ forma", cor: "■ cor sólida", ajuste: "◫ camada de ajuste" }[c.tipo];
      ctx.fillText(txt, Math.max(r.x, 0) + 6, r.y + CAB + corpo / 2, Math.max(0, xf - Math.max(r.x, 0) - 10));
    }
    // faixa do nome
    ctx.fillStyle = "rgba(0,0,0,.34)"; ctx.fillRect(xi, r.y, xf - xi, CAB);
    let x = Math.max(r.x, 0) + 3;
    const efeitosVisiveis = c.efeitos.length > 0, animado = Object.keys(c.anim || {}).length > 0;
    if (r.w > 24) {
      ctx.fillStyle = efeitosVisiveis ? "#e8d44d" : animado ? "#c4a7ff" : "rgba(255,255,255,.35)";
      ctx.fillRect(x, r.y + 2.5, 15, 10);
      ctx.fillStyle = "#111"; ctx.font = "italic 700 9px " + fonte(); ctx.textBaseline = "middle"; ctx.fillText("fx", x + 2.5, r.y + 7.8);
      x += 19;
    }
    ctx.fillStyle = "#fff"; ctx.font = "600 10.5px " + fonte(); ctx.textBaseline = "middle";
    let rotulo = c.nome || (m ? m.nome : c.tipo === "texto" ? "Texto" : "clipe");
    if (c.vinculo) rotulo += audio ? " [A]" : " [V]";
    if ((c.velocidade || 1) !== 1) rotulo += `  ${Math.round(c.velocidade * 100)}%`;
    if (c.mudo) rotulo += "  (mudo)";
    if (desligado) rotulo += "  (desativado)";
    if (c.tipo === "midia" && (!m || !A.urls.get(c.midia))) { rotulo += "  ⚠ mídia faltando"; ctx.fillStyle = "#ffb4b4"; }
    ctx.fillText(rotulo, x, r.y + 8, Math.max(0, xf - x - 4));
    // linha de opacidade / volume com os quadros-chave
    if (temLinha(r)) {
      const caminho = caminhoDaLinha(trilha);
      ctx.strokeStyle = audio ? "#ffe066" : "rgba(255,255,255,.9)"; ctx.lineWidth = 1;
      ctx.beginPath();
      const ch = c.anim && c.anim[caminho];
      if (ch && ch.length) {
        for (let px = Math.floor(xi); px <= xf; px += 2) { const y = yDaLinha(r, caminho, V.valor(c, caminho, (px - r.x) / pxs)); px === Math.floor(xi) ? ctx.moveTo(px, y) : ctx.lineTo(px, y); }
      } else { const y = yDaLinha(r, caminho, V.valorFixo(c, caminho)); ctx.moveTo(xi, y); ctx.lineTo(xf, y); }
      ctx.stroke();
      for (const k of ch || []) {
        const kx = r.x + k.t * pxs, ky = yDaLinha(r, caminho, k.v);
        if (kx < xi - 4 || kx > xf + 4) continue;
        ctx.fillStyle = audio ? "#ffe066" : "#fff";
        ctx.beginPath(); ctx.moveTo(kx, ky - 4); ctx.lineTo(kx + 4, ky); ctx.lineTo(kx, ky + 4); ctx.lineTo(kx - 4, ky); ctx.closePath(); ctx.fill();
      }
    }
    if (desligado) {
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.beginPath();
      for (let k = Math.floor(xi) - r.h; k < xf; k += 8) { ctx.moveTo(k, r.y + r.h); ctx.lineTo(k + r.h, r.y); }
      ctx.stroke();
    }
    ctx.restore();
    if (A.selecao.has(c.id)) {
      ctx.strokeStyle = cor("--texto"); ctx.lineWidth = 2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 3); else ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (fantasma && fantasma.clipe === c.id) { ctx.strokeStyle = "#e8d44d"; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.lineWidth = 1; }
  }

  let pedido = 0;
  function redesenhar() {
    if (pedido) return;
    pedido = requestAnimationFrame(() => { pedido = 0; desenharRegua(); desenharPistas(); });
  }

  // ── Cabeçalhos das trilhas ──────────────────────────────────────────

  function desenharCabecalhos() {
    const geo = layout();
    const p = A.projeto;
    const linhas = [];
    let anterior = null;
    for (const t of p.trilhas) {
      const g = geo.mapa.get(t.id);
      const alternar = (classe, conteudo, dica, ligado, acao) => el("button", {
        type: "button", class: classe, title: dica, "aria-label": dica, "aria-pressed": String(!!ligado), html: conteudo,
        onclick: (e) => { e.stopPropagation(); acao(); },
      });
      const mudar = (descricao, f) => () => { A.marcar(descricao); f(); A.mudou(); };
      linhas.push(el("div", {
        class: "cab-trilha" + (anterior && anterior.tipo !== t.tipo ? " divisa" : "") + (t.id === A.trilhaAtiva ? " ativa" : ""),
        style: { height: g.h + "px" }, "data-trilha": t.id,
        onclick: () => { A.trilhaAtiva = t.id; desenharCabecalhos(); redesenhar(); },
        ondblclick: mudar("Altura da trilha", () => { t.alta = !t.alta; }),
        oncontextmenu: (e) => { e.preventDefault(); menuDaTrilha(t, e.clientX, e.clientY); },
      },
      alternar("patch esconder-celular", t.tipo === "video" ? "V" : "A", "Origem: a mídia da Origem entra nesta trilha ao inserir (,) ou sobrescrever (.)", t.origem,
        mudar("Origem da trilha", () => { const ligar = !t.origem; for (const x of p.trilhas) if (x.tipo === t.tipo) x.origem = false; t.origem = ligar; })),
      alternar("alvo", t.id, "Trilha marcada: recebe os cortes (Ctrl+K), levantar e extrair, e vale para ↑/↓", t.alvo !== false, mudar("Marcar trilha", () => { t.alvo = t.alvo === false; })),
      alternar("trava", icone("cadeado"), "Travar a trilha (nada nela muda)", t.travada, mudar("Travar trilha", () => { t.travada = !t.travada; })),
      t.tipo === "video" ? alternar("olho", icone("olho"), "Esconder a trilha (não aparece na imagem)", t.oculta, mudar("Esconder trilha", () => { t.oculta = !t.oculta; })) : null,
      t.tipo === "audio" ? alternar("m", "M", "Mudo", t.mudo, mudar("Mudo", () => { t.mudo = !t.mudo; })) : null,
      t.tipo === "audio" ? alternar("s", "S", "Solo (só esta trilha toca)", t.solo, mudar("Solo", () => { t.solo = !t.solo; })) : null,
      el("span", { class: "nome", title: t.nome + " (dois cliques: trilha alta/baixa)" }, t.nome)));
      anterior = t;
    }
    const mestre = el("input", { type: "range", min: -60, max: 12, step: 0.5, value: p.volumeMestre || 0, title: "Volume do mestre (dB)", "aria-label": "Volume do mestre" });
    const valorMestre = el("span", { class: "mono" }, `${(p.volumeMestre || 0).toFixed(1).replace(".", ",")} dB`);
    mestre.addEventListener("pointerdown", () => A.marcar("Volume do mestre"));
    mestre.addEventListener("input", () => { p.volumeMestre = +mestre.value; valorMestre.textContent = `${(+mestre.value).toFixed(1).replace(".", ",")} dB`; A.mudou({ leve: true }); });
    mestre.addEventListener("dblclick", () => { A.marcar("Volume do mestre"); p.volumeMestre = 0; A.mudou(); });
    linhas.push(el("div", { class: "cab-mix", style: { height: MIX + "px" }, title: "Mix: o volume final (mestre)" }, el("b", {}, "Mix"), mestre, valorMestre), el("div", { style: { height: "40px" } }));
    cabecalhos.replaceChildren(...linhas);
    cabecalhos.scrollTop = rolagem.scrollTop;
    assinaturaTrilhas = assinaturaDasTrilhas();
  }
  const assinaturaDasTrilhas = () => JSON.stringify([A.projeto.trilhas.map((t) => [t.id, t.nome, t.origem, t.alvo, t.travada, t.oculta, t.mudo, t.solo, t.alta]), A.trilhaAtiva, A.projeto.volumeMestre]);

  function menuDaTrilha(t, x, y) {
    const p = A.projeto;
    LNUX.abrirMenu([
      { rotulo: "Renomear a trilha...", acao: async () => { const n = await LNUX.perguntar("Nome da trilha", { valor: t.nome }); if (n) { A.marcar("Renomear trilha"); t.nome = n.trim() || t.nome; A.mudou(); } } },
      { rotulo: t.alta ? "Trilha baixa" : "Trilha alta (ver melhor a forma de onda)", acao: () => { A.marcar("Altura da trilha"); t.alta = !t.alta; A.mudou(); } },
      "-",
      { rotulo: "Nova trilha de vídeo", acao: () => A.comandos.adicionarTrilha("video") },
      { rotulo: "Nova trilha de áudio", acao: () => A.comandos.adicionarTrilha("audio") },
      { rotulo: "Apagar as trilhas vazias", acao: () => A.comandos.apagarTrilhasVazias() },
      "-",
      { rotulo: "Apagar esta trilha (e os clipes dela)", ativo: () => p.trilhas.filter((x) => x.tipo === t.tipo).length > 1, acao: async () => {
        const n = p.clipes.filter((c) => c.trilha === t.id).length;
        if (n && !(await LNUX.confirmar("Apagar trilha", `A trilha "${t.nome}" tem ${n} clipe(s). Apagar mesmo assim?`, { rotulo: "Apagar", perigo: true }))) return;
        A.marcar("Apagar trilha");
        for (const c of p.clipes.filter((c) => c.trilha === t.id)) V.removerClipe(p, c.id);
        p.trilhas = p.trilhas.filter((x) => x !== t);
        p.transicoes = p.transicoes.filter((x) => x.trilha !== t.id);
        if (A.trilhaAtiva === t.id) A.trilhaAtiva = p.trilhas[0].id;
        A.mudou();
      } },
    ], x, y);
  }

  // ── Procurar o que está embaixo do ponteiro ─────────────────────────

  function acharEm(pt) {
    const g = trilhaEm(pt.yc);
    if (!g) return { g: null };
    const sl = rolagem.scrollLeft;
    for (const tr of A.projeto.transicoes) {
      if (tr.trilha !== g.t.id) continue;
      const rg = regiaoTransicao(tr);
      if (!rg) continue;
      const x0 = rg.de * pxs - sl, x1 = rg.ate * pxs - sl;
      if (pt.x >= x0 - 2 && pt.x <= x1 + 2 && pt.yc >= g.y + CAB) return { g, tr, rg, zona: pt.x < x0 + 5 ? "inicio" : pt.x > x1 - 5 ? "fim" : "corpo" };
    }
    const lista = A.projeto.clipes.filter((c) => c.trilha === g.t.id);
    const zonaDe = (c) => {
      const x0 = c.inicio * pxs - sl, x1 = V.fim(c) * pxs - sl, borda = Math.min(8, (x1 - x0) / 3);
      if (pt.x <= x0 + borda && pt.x >= x0 - 4) return "inicio";
      if (pt.x >= x1 - borda && pt.x <= x1 + 4) return "fim";
      return pt.x > x0 && pt.x < x1 ? "corpo" : null;
    };
    // primeiro o clipe que contém o ponto; depois uma borda logo ao lado
    let c = lista.find((x) => pt.t >= x.inicio && pt.t < V.fim(x)) || lista.find((x) => zonaDe(x));
    if (!c) return { g };
    let zona = zonaDe(c) || "corpo";
    // na borda entre dois clipes: o lado do ponteiro decide
    if (zona === "inicio") { const ant = lista.find((x) => x !== c && Math.abs(V.fim(x) - c.inicio) < 1e-3); if (ant && pt.t < c.inicio) { c = ant; zona = "fim"; } }
    const r = retangulo(c, g);
    if (zona === "corpo" && temLinha(r)) {
      const caminho = caminhoDaLinha(g.t);
      const ch = (c.anim && c.anim[caminho]) || [];
      const i = ch.findIndex((k) => Math.abs(r.x + k.t * pxs - pt.x) <= 5 && Math.abs(yDaLinha(r, caminho, k.v) - pt.y) <= 5);
      if (i >= 0) return { g, c, zona: "chave", caminho, i, r };
      if (Math.abs(yDaLinha(r, caminho, V.valor(c, caminho, pt.t - c.inicio)) - pt.y) <= 4) return { g, c, zona: "linha", caminho, r };
    }
    return { g, c, zona, r };
  }

  // ── Dica que acompanha o ponteiro ───────────────────────────────────

  const dica = el("div", { class: "dica-linha", hidden: true });
  document.body.append(dica);
  function mostrarDica(e, texto) { dica.hidden = false; dica.textContent = texto; dica.style.left = e.clientX + 14 + "px"; dica.style.top = e.clientY + 16 + "px"; }
  const sinal = (d) => (d < 0 ? "−" : "+") + A.tempo(Math.abs(d));

  // ── Gestos ──────────────────────────────────────────────────────────

  function selecionarClique(c, e) {
    const soEste = e.altKey || !A.vinculada;
    const grupo = soEste ? new Set([c.id]) : V.comVinculados(A.projeto, new Set([c.id]), true);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (A.selecao.has(c.id)) { for (const id of grupo) A.selecao.delete(id); return false; }
      for (const id of grupo) A.selecao.add(id);
    } else if (!A.selecao.has(c.id)) A.selecao = grupo;
    else if (e.altKey) A.selecao = grupo;
    return true;
  }
  let inicioGesto = { x: 0, y: 0 };
  const comecar = (tipo, extra) => (arrasto = Object.assign({ tipo, antes: JSON.stringify(A.projeto), moveu: false, cx: inicioGesto.x, cy: inicioGesto.y }, extra));
  /** Volta o projeto à fotografia do começo do gesto. */
  function voltar() { A.projeto = JSON.parse(arrasto.antes); return A.projeto; }
  function marcarUmaVez(descricao) { if (!arrasto.marcou) { A.marcar(descricao); arrasto.marcou = true; } }
  const desbloqueadas = () => A.projeto.trilhas.filter((t) => !t.travada).map((t) => t.id);

  function cortarComNavalha(pt, e, h) {
    const t = encaixar(pt.t, null).t;
    A.marcar("Navalha");
    if (e.shiftKey) V.adicionarCorte(A.projeto, desbloqueadas(), t);
    else {
      const alvos = A.vinculada && !e.altKey ? [h.c, ...V.parceiros(A.projeto, h.c)] : [h.c];
      const pares = new Map();
      for (const c of alvos) {
        if (A.trilha(c.trilha).travada) continue;
        const b = V.cortar(A.projeto, c, t);
        if (b && c.vinculo) { if (!pares.has(c.vinculo)) pares.set(c.vinculo, V.novoId("v")); b.vinculo = pares.get(c.vinculo); }
      }
    }
    A.mudou();
  }

  function aoApertar(e) {
    if (e.button === 2) return;
    rolagem.focus({ preventScroll: true });
    inicioGesto = { x: e.clientX, y: e.clientY };
    const pt = ponto(e);
    if (e.pointerType === "touch") {
      toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (toques.size === 2) { cancelar(); const [a, b] = [...toques.values()]; pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y), pxs0: pxs, t: (((a.x + b.x) / 2 - pistas.getBoundingClientRect().left) + rolagem.scrollLeft) / pxs }; return; }
    }
    if (A.tocando && A.ferramenta !== "mao") A.pausar();
    pistas.setPointerCapture(e.pointerId);
    const ferramenta = e.button === 1 ? "mao" : A.ferramenta;
    if (ferramenta === "mao") { comecar("mao", { x: e.clientX, y: e.clientY, sl: rolagem.scrollLeft, st: rolagem.scrollTop }); return; }
    if (ferramenta === "zoom") { zoomEm(pt.t, e.altKey ? 1 / 1.6 : 1.6); return; }
    const h = acharEm(pt);
    if (h.g) A.trilhaAtiva = h.g.t.id;
    if (ferramenta === "texto") {
      A.novoGrafico("texto", {}, { tempo: encaixar(pt.t).t });
      A.ferramenta = "selecao"; L.atualizarFerramentas();
      V.Paineis.abrirAba("dir", "propriedades");
      return;
    }
    // transição
    if (h.tr) {
      A.transicaoEscolhida = h.tr.id;
      A.selecao.clear();
      if (h.zona !== "corpo") comecar("transicao", { id: h.tr.id, lado: h.zona });
      A.mudou({ leve: true });
      return;
    }
    A.transicaoEscolhida = null;
    if (!h.c) {
      if (e.pointerType === "touch") comecar("mao", { x: e.clientX, y: e.clientY, sl: rolagem.scrollLeft, st: rolagem.scrollTop, clique: pt });
      else comecar("laco", { x0: pt.x + rolagem.scrollLeft, y0: pt.yc, base: e.shiftKey || e.ctrlKey || e.metaKey ? new Set(A.selecao) : new Set(), clique: pt });
      return;
    }
    if (A.trilha(h.c.trilha).travada) { LNUX.aviso("Essa trilha está travada (cadeado no cabeçalho)."); return; }
    if (ferramenta === "navalha") { cortarComNavalha(pt, e, h); return; }
    if (h.zona === "chave" || h.zona === "linha") {
      if (!A.selecao.has(h.c.id)) A.selecao = new Set([h.c.id]);
      if (h.zona === "linha" && (e.ctrlKey || e.metaKey)) { // Ctrl+clique na linha: quadro-chave novo
        A.marcar("Quadro-chave");
        const ch = (h.c.anim[h.caminho] = h.c.anim[h.caminho] || []);
        if (!ch.length && h.c.duracao > 0) ch.push({ t: 0, v: V.valorFixo(h.c, h.caminho), i: "linear" });
        ch.push({ t: A.arredondar(pt.t - h.c.inicio), v: V.valor(h.c, h.caminho, pt.t - h.c.inicio), i: "linear" });
        V.ajeitarChaves(ch);
        A.mudou();
        return;
      }
      const ch = h.c.anim && h.c.anim[h.caminho];
      comecar(h.zona, { id: h.c.id, caminho: h.caminho, i: h.i, x0: pt.x, y0: pt.y, corpo: h.r.h - CAB - 6, animado: !!(ch && ch.length), v0: V.valor(h.c, h.caminho, pt.t - h.c.inicio) });
      A.mudou({ leve: true });
      return;
    }
    if (ferramenta === "trilha-frente") {
      const t = h.c.inicio;
      const lista = A.projeto.clipes.filter((c) => c.inicio >= t - 1e-6 && (e.shiftKey ? c.trilha === h.c.trilha : true) && !A.trilha(c.trilha).travada);
      A.selecao = V.comVinculados(A.projeto, new Set(lista.map((c) => c.id)), A.vinculada);
      comecarMover(pt, e, h.c);
      A.mudou({ leve: true });
      return;
    }
    const continuar = selecionarClique(h.c, e);
    A.mudou({ leve: true });
    if (!continuar) return;
    const borda = h.zona === "inicio" || h.zona === "fim";
    if (ferramenta === "slip") { comecar("slip", { id: h.c.id, x0: pt.x }); return; }
    if (ferramenta === "slide") { comecar("slide", { id: h.c.id, x0: pt.x, inicio0: h.c.inicio }); return; }
    if (borda) {
      let modo = { selecao: "aparar", ondulacao: "ondulacao", rolagem: "rolagem", esticar: "esticar" }[ferramenta] || "aparar";
      let par = null;
      if (modo === "rolagem") {
        const corte = h.zona === "fim" ? V.fim(h.c) : h.c.inicio;
        const { a, b } = V.vizinhosNoCorte(A.projeto, h.c.trilha, corte);
        if (a && b) par = { a: a.id, b: b.id, corte }; else modo = "aparar";
      }
      comecar("borda", { modo, id: h.c.id, lado: h.zona, t0: pt.t, borda0: h.zona === "inicio" ? h.c.inicio : V.fim(h.c), par });
      return;
    }
    comecarMover(pt, e, h.c);
  }

  function comecarMover(pt, e, c) {
    const lista = A.projeto.clipes.filter((x) => A.selecao.has(x.id) && !A.trilha(x.trilha).travada);
    if (!lista.length) return;
    const extra = { ids: new Set(lista.map((x) => x.id)), t0: pt.t, g0: trilhaEm(pt.yc), copiar: e.altKey, principal: c.id,
      min: Math.min(...lista.map((x) => x.inicio)), max: Math.max(...lista.map(V.fim)) };
    if (extra.copiar) { extra.novos = new Map(lista.map((x) => [x.id, V.novoId("c")])); extra.vinculos = new Map(); }
    comecar("mover", extra);
  }

  function aoMover(e) {
    if (pinca && toques.has(e.pointerId)) {
      toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (toques.size === 2) {
        const [a, b] = [...toques.values()];
        const novo = limitar(pinca.pxs0 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinca.d0), 0.5, 60 * A.projeto.fps);
        const xm = (a.x + b.x) / 2 - pistas.getBoundingClientRect().left;
        pxs = novo; atualizarEspaco(); rolagem.scrollLeft = pinca.t * pxs - xm; atualizarZoom(); redesenhar();
      }
      return;
    }
    const pt = ponto(e);
    if (!arrasto) { cursorDoPonteiro(pt, e); return; }
    const a = arrasto;
    if (!a.moveu) {
      if (Math.hypot(e.clientX - a.cx, e.clientY - a.cy) < (a.tipo === "laco" ? 4 : 3)) return;
      a.moveu = true;
    }
    const p = A.projeto;
    switch (a.tipo) {
      case "mao":
        rolagem.scrollLeft = a.sl - (e.clientX - a.x); rolagem.scrollTop = a.st - (e.clientY - a.y);
        return;
      case "laco": {
        laco = { x0: a.x0, y0: a.y0, x1: pt.x + rolagem.scrollLeft, y1: pt.yc };
        const ta = Math.min(laco.x0, laco.x1) / pxs, tb = Math.max(laco.x0, laco.x1) / pxs, ya = Math.min(laco.y0, laco.y1), yb = Math.max(laco.y0, laco.y1);
        const geo = layout();
        A.selecao = new Set(a.base);
        for (const c of p.clipes) { const g = geo.mapa.get(c.trilha); if (g && c.inicio < tb && V.fim(c) > ta && g.y < yb && g.y + g.h > ya) A.selecao.add(c.id); }
        if (A.vinculada) A.selecao = V.comVinculados(p, A.selecao, true);
        redesenhar();
        return;
      }
      case "mover": moverPara(pt, e); break;
      case "borda": aparar(pt, e); break;
      case "slip": {
        marcarUmaVez("Slip");
        const q = voltar(), c = q.clipes.find((x) => x.id === a.id);
        const d = (pt.x - a.x0) / pxs;
        const real = V.slip(q, c, d);
        if (A.vinculada) for (const x of V.parceiros(q, c)) V.slip(q, x, d);
        mostrarDica(e, `Slip ${sinal(real)}  ·  mídia de ${A.tempo(c.entrada)} a ${A.tempo(c.entrada + c.duracao * (c.velocidade || 1))}`);
        break;
      }
      case "slide": {
        marcarUmaVez("Slide");
        const q = voltar(), c = q.clipes.find((x) => x.id === a.id);
        const s = encaixar(a.inicio0 + (pt.x - a.x0) / pxs, new Set([c.id]));
        guia = s.guia;
        const d = V.slide(q, c, s.t - a.inicio0);
        if (A.vinculada) for (const x of V.parceiros(q, c)) V.slide(q, x, d);
        mostrarDica(e, `Slide ${sinal(d)}`);
        break;
      }
      case "chave": case "linha": {
        marcarUmaVez(a.tipo === "chave" ? "Mover quadro-chave" : "Ajustar a linha");
        const q = voltar(), c = q.clipes.find((x) => x.id === a.id);
        const dfrac = -(pt.y - a.y0) / Math.max(10, a.corpo);
        const ajustar = (v) => daFracao(a.caminho, fracao(a.caminho, v) + dfrac);
        let mostrar;
        if (a.tipo === "chave") {
          const ch = c.anim[a.caminho], k = ch[a.i];
          k.v = ajustar(k.v);
          if (!e.shiftKey) k.t = limitar(A.arredondar(k.t + (pt.x - a.x0) / pxs), 0, c.duracao);
          V.ajeitarChaves(ch);
          mostrar = k.v;
        } else if (a.animado) { for (const k of c.anim[a.caminho]) k.v = ajustar(k.v); V.ajeitarChaves(c.anim[a.caminho]); mostrar = ajustar(a.v0); }
        else { V.definirFixo(c, a.caminho, ajustar(a.v0)); mostrar = V.valorFixo(c, a.caminho); }
        mostrarDica(e, a.caminho === "audio.nivel" ? `Volume ${mostrar <= -95 ? "−∞" : mostrar.toFixed(1).replace(".", ",")} dB` : `Opacidade ${mostrar.toFixed(1).replace(".", ",")}%`);
        break;
      }
      case "transicao": {
        marcarUmaVez("Duração da transição");
        const q = voltar(), tr = q.transicoes.find((x) => x.id === a.id), rg = regiaoTransicao(tr);
        if (!rg) break;
        const t = A.arredondar(pt.t), quadro = A.quadro();
        let d;
        if (rg.a && rg.b) d = 2 * Math.abs(t - rg.b.inicio), d = Math.min(d, 2 * Math.min(rg.a.duracao, rg.b.duracao));
        else if (rg.b) d = a.lado === "fim" ? t - rg.b.inicio : rg.ate - t, d = Math.min(d, rg.b.duracao);
        else d = a.lado === "inicio" ? V.fim(rg.a) - t : t - rg.de, d = Math.min(d, rg.a.duracao);
        tr.duracao = Math.max(quadro, A.arredondar(d));
        mostrarDica(e, "Duração " + A.tempo(tr.duracao));
        break;
      }
    }
    redesenhar();
    A.desenharQuadro(A.cursor);
    V.Controles && V.Controles.atualizarValores();
  }

  function moverPara(pt, e) {
    const a = arrasto;
    marcarUmaVez(a.copiar ? "Duplicar clipes" : "Mover clipes");
    const p = voltar();
    let movidos = p.clipes.filter((x) => a.ids.has(x.id));
    if (a.copiar) {
      movidos = movidos.map((x) => {
        const n = JSON.parse(JSON.stringify(x));
        n.id = a.novos.get(x.id);
        if (n.vinculo) { if (!a.vinculos.has(n.vinculo)) a.vinculos.set(n.vinculo, V.novoId("v")); n.vinculo = a.vinculos.get(n.vinculo); }
        p.clipes.push(n);
        return n;
      });
    }
    // tempo, com encaixe pelo começo ou pelo fim do grupo
    const bruto = pt.t - a.t0;
    const s1 = encaixar(a.min + bruto, a.ids), s2 = encaixar(a.max + bruto, a.ids);
    let dt = A.arredondar(a.min + bruto) - a.min;
    guia = null;
    const c1 = s1.guia !== null ? s1.t - a.min : null, c2 = s2.guia !== null ? s2.t - a.max : null;
    if (c1 !== null && (c2 === null || Math.abs(c1 - bruto) <= Math.abs(c2 - bruto))) { dt = c1; guia = s1.guia; }
    else if (c2 !== null) { dt = c2; guia = s2.guia; }
    dt = Math.max(dt, -a.min);
    // trilhas: anda o mesmo número de trilhas do mesmo tipo
    const g = trilhaEm(pt.yc);
    let passos = 0;
    if (g && a.g0 && g.t.tipo === a.g0.t.tipo) {
      const doTipo = p.trilhas.filter((t) => t.tipo === g.t.tipo);
      passos = doTipo.findIndex((t) => t.id === g.t.id) - doTipo.findIndex((t) => t.id === a.g0.t.id);
    }
    const tipoMovido = a.g0 ? a.g0.t.tipo : null;
    if (passos) {
      const doTipo = p.trilhas.filter((t) => t.tipo === tipoMovido);
      const indices = movidos.filter((c) => A.trilha(c.trilha).tipo === tipoMovido).map((c) => doTipo.findIndex((t) => t.id === c.trilha));
      passos = limitar(passos, -Math.min(...indices), doTipo.length - 1 - Math.max(...indices));
    }
    for (const c of movidos) {
      c.inicio = Math.max(0, c.inicio + dt);
      if (passos && A.trilha(c.trilha).tipo === tipoMovido) {
        const doTipo = p.trilhas.filter((t) => t.tipo === tipoMovido);
        const destino = doTipo[doTipo.findIndex((t) => t.id === c.trilha) + passos];
        if (destino && !destino.travada) c.trilha = destino.id;
      }
    }
    A.selecao = new Set(movidos.map((c) => c.id));
    a.ctrl = e.ctrlKey || e.metaKey;
    fantasma = null;
    mostrarDica(e, `${a.copiar ? "Duplicar " : ""}${sinal(dt)}${a.ctrl ? "  ·  inserir (empurra o resto)" : "  ·  sobrescrever (Ctrl: inserir)"}`);
  }

  /** Ao soltar os clipes movidos: sobrescreve o que estiver embaixo (ou insere, com Ctrl). */
  function soltarMover(e) {
    const p = A.projeto;
    const movidos = p.clipes.filter((x) => A.selecao.has(x.id));
    p.clipes = p.clipes.filter((x) => !A.selecao.has(x.id));
    if (e.ctrlKey || e.metaKey) {
      const t = Math.min(...movidos.map((x) => x.inicio));
      for (const x of movidos) x.inicio -= t;
      V.inserir(p, movidos, t, desbloqueadas());
    } else V.sobrescrever(p, movidos, 0);
  }

  function aparar(pt, e) {
    const a = arrasto;
    const nomes = { aparar: "Aparar", ondulacao: "Aparar com ondulação", rolagem: "Edição rolante", esticar: "Esticar a velocidade" };
    marcarUmaVez(nomes[a.modo]);
    const p = voltar();
    const c = p.clipes.find((x) => x.id === a.id);
    const ignorar = new Set([c.id, ...V.parceiros(p, c).map((x) => x.id)]);
    if (a.par) { ignorar.add(a.par.a); ignorar.add(a.par.b); }
    const s = encaixar(a.borda0 + (pt.t - a.t0), ignorar);
    guia = s.guia;
    const delta = s.t - a.borda0;
    let texto = "";
    if (a.modo === "aparar") {
      const parceiros = A.vinculada ? V.parceiros(p, c).filter((x) => Math.abs((a.lado === "inicio" ? x.inicio : V.fim(x)) - a.borda0) < 1e-3) : [];
      let d = V.aparar(p, c, a.lado, delta);
      for (const x of parceiros) V.aparar(p, x, a.lado, d);
      texto = `${sinal(d)}  ·  duração ${A.tempo(c.duracao)}`;
    } else if (a.modo === "ondulacao") {
      const d = V.apararOndulacao(p, c, a.lado, delta);
      texto = `Ondulação ${sinal(d)}  ·  duração ${A.tempo(c.duracao)}`;
    } else if (a.modo === "rolagem") {
      const ca = p.clipes.find((x) => x.id === a.par.a), cb = p.clipes.find((x) => x.id === a.par.b);
      const d = V.apararRolagem(p, ca, cb, delta);
      if (A.vinculada) for (const x of V.parceiros(p, ca)) { const { b } = V.vizinhosNoCorte(p, x.trilha, a.par.corte); if (b) V.apararRolagem(p, x, b, d); }
      texto = `Rolante ${sinal(d)}`;
    } else {
      const v = V.esticarTaxa(p, c, a.lado, delta);
      if (A.vinculada) for (const x of V.parceiros(p, c)) V.esticarTaxa(p, x, a.lado, delta);
      texto = `Velocidade ${Math.round(v * 100)}%  ·  duração ${A.tempo(c.duracao)}`;
    }
    mostrarDica(e, texto);
  }

  function aoSoltar(e) {
    if (toques.has(e.pointerId)) { toques.delete(e.pointerId); if (toques.size < 2 && pinca) { pinca = null; return; } }
    const a = arrasto;
    arrasto = null;
    guia = null; laco = null;
    dica.hidden = true;
    if (!a) return;
    if (a.tipo === "mao" || a.tipo === "laco") {
      if (!a.moveu && a.clique) { // clique no vazio: tira a seleção e leva o cursor até lá
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) A.selecao.clear();
        A.irPara(encaixar(a.clique.t, null).t);
        A.mudou({ leve: true });
      } else if (a.tipo === "laco") A.mudou({ leve: true });
      redesenhar();
      return;
    }
    if (!a.moveu) {
      // clique sem arrastar num clipe já escolhido (sem Shift/Ctrl): fica só ele (e o vinculado)
      if (a.tipo === "mover" && !(e.shiftKey || e.ctrlKey || e.metaKey) && A.selecao.size > 1) {
        const c = A.clipe(a.principal);
        if (c) { A.selecao = e.altKey || !A.vinculada ? new Set([c.id]) : V.comVinculados(A.projeto, new Set([c.id]), true); A.mudou({ leve: true }); }
      }
      return;
    }
    if (a.tipo === "mover") soltarMover(e);
    A.mudou();
  }

  function cancelar() {
    if (arrasto && arrasto.moveu && arrasto.tipo !== "mao" && arrasto.tipo !== "laco") { A.projeto = JSON.parse(arrasto.antes); if (arrasto.marcou) A.hist.passado.pop(); A.mudou(); }
    arrasto = null; guia = null; laco = null; dica.hidden = true;
    redesenhar();
  }

  function cursorDoPonteiro(pt, e) {
    const f = A.ferramenta;
    const cursores = { mao: "grab", zoom: e.altKey ? "zoom-out" : "zoom-in", navalha: "crosshair", texto: "text" };
    if (cursores[f]) { pistas.style.cursor = cursores[f]; return; }
    const h = acharEm(pt);
    let cursor = "default";
    if (h.tr) cursor = h.zona === "corpo" ? "pointer" : "ew-resize";
    else if (h.c) {
      if (h.zona === "chave") cursor = "move";
      else if (h.zona === "linha") cursor = "ns-resize";
      else if (h.zona === "inicio" || h.zona === "fim") cursor = f === "rolagem" ? "col-resize" : f === "esticar" ? "ew-resize" : f === "slip" || f === "slide" ? "ew-resize" : "ew-resize";
      else cursor = f === "slip" || f === "slide" ? "ew-resize" : "grab";
    }
    pistas.style.cursor = cursor;
  }

  // ── Menu de contexto ────────────────────────────────────────────────

  function aoMenu(e) {
    e.preventDefault();
    cancelar();
    const pt = ponto(e);
    const h = acharEm(pt);
    const C = A.comandos;
    if (h.tr) {
      const tr = h.tr;
      A.transicaoEscolhida = tr.id; A.mudou({ leve: true });
      const def = V.TRANSICOES.find((x) => x.id === tr.tipo);
      LNUX.abrirMenu([
        { rotulo: "Duração da transição...", acao: () => duracaoDaTransicao(tr) },
        ...(def && def.direcao ? V.DIRECOES.map(([v, n]) => ({ rotulo: "Direção: " + n.toLowerCase(), marcado: () => (tr.direcao || 0) === v, acao: () => { A.marcar("Direção da transição"); tr.direcao = v; A.mudou(); } })) : []),
        "-",
        { rotulo: "Apagar a transição", acao: () => { A.marcar("Apagar transição"); A.projeto.transicoes = A.projeto.transicoes.filter((x) => x !== tr); A.transicaoEscolhida = null; A.mudou(); } },
      ], e.clientX, e.clientY);
      return;
    }
    if (h.c) {
      const c = h.c;
      if (!A.selecao.has(c.id)) { A.selecao = A.vinculada ? V.comVinculados(A.projeto, new Set([c.id]), true) : new Set([c.id]); A.mudou({ leve: true }); }
      const m = c.tipo === "midia" ? A.midia(c.midia) : null;
      const audio = A.trilha(c.trilha).tipo === "audio";
      LNUX.abrirMenu([
        { rotulo: "Cortar aqui", atalho: "C", acao: () => cortarComNavalha(pt, { shiftKey: false, altKey: false }, h) },
        { rotulo: c.ativo === false ? "Ativar" : "Desativar", atalho: "Ctrl+Shift+E", acao: C.ativar },
        { rotulo: c.vinculo ? "Desvincular vídeo e áudio" : "Vincular", atalho: "Ctrl+L", acao: C.vincular },
        { rotulo: "Velocidade / duração...", atalho: "Ctrl+R", acao: C.velocidade, ativo: () => c.tipo === "midia" },
        { rotulo: "Renomear...", acao: async () => { const n = await LNUX.perguntar("Nome do clipe", { valor: c.nome || (m && m.nome) || "" }); if (n !== null) { A.marcar("Renomear clipe"); c.nome = n.trim(); A.mudou(); } } },
        "-",
        ...(!audio ? [
          { rotulo: "Ajustar ao quadro", acao: () => C.ajustarQuadro(false), ativo: () => !!m },
          { rotulo: "Preencher o quadro", acao: () => C.ajustarQuadro(true), ativo: () => !!m },
          { rotulo: "Congelar o quadro do cursor", acao: C.congelar, ativo: () => m && m.tipo === "video" },
        ] : [
          { rotulo: c.mudo ? "Tirar do mudo" : "Deixar mudo", acao: () => { A.marcar("Mudo do clipe"); for (const x of A.escolhidos()) x.mudo = !c.mudo; A.mudou(); } },
        ]),
        { rotulo: "Abrir na Origem", acao: () => V.Paineis.abrirNaOrigem(c.midia), ativo: () => !!m },
        { rotulo: "Mostrar no Projeto", acao: () => V.Paineis.mostrarNoProjeto(c.midia), ativo: () => !!m },
        "-",
        { grupo: "Rótulo" },
        ...Object.entries(A.CORES_ROTULO).map(([id]) => ({ rotulo: "● " + id[0].toUpperCase() + id.slice(1), marcado: () => (c.rotulo || "") === (id === "nenhum" ? "" : id), acao: () => { A.marcar("Rótulo"); for (const x of A.escolhidos()) { if (id === "nenhum") delete x.rotulo; else x.rotulo = id; } A.mudou(); } })),
        "-",
        { rotulo: "Copiar", atalho: "Ctrl+C", acao: () => C.copiar(false) },
        { rotulo: "Recortar", atalho: "Ctrl+X", acao: () => C.copiar(true) },
        { rotulo: "Colar atributos", atalho: "Ctrl+Alt+V", acao: C.colarAtributos, ativo: () => !!(A.copiados && A.copiados.length) },
        { rotulo: "Apagar", atalho: "Del", acao: () => C.apagar(false) },
        { rotulo: "Apagar com ondulação", atalho: "Shift+Del", acao: () => C.apagar(true) },
      ], e.clientX, e.clientY);
      return;
    }
    const buraco = h.g ? V.buracoEm(A.projeto, h.g.t.id, pt.t) : null;
    LNUX.abrirMenu([
      { rotulo: "Apagar este espaço vazio (ondulação)", ativo: () => !!buraco && !h.g.t.travada, acao: () => { A.marcar("Fechar buraco"); V.fecharBuraco(A.projeto, h.g.t.id, pt.t); A.mudou(); } },
      { rotulo: "Colar aqui", ativo: () => !!(A.copiados && A.copiados.length), acao: () => { A.irPara(encaixar(pt.t).t); C.colar(false); } },
      { rotulo: "Adicionar marcador aqui", acao: () => { A.irPara(encaixar(pt.t).t); C.marcador(); } },
      "-",
      { rotulo: "Nova trilha de vídeo", acao: () => C.adicionarTrilha("video") },
      { rotulo: "Nova trilha de áudio", acao: () => C.adicionarTrilha("audio") },
      { rotulo: "Novo título aqui", acao: () => A.novoGrafico("texto", {}, { tempo: encaixar(pt.t).t }) },
    ], e.clientX, e.clientY);
  }

  async function duracaoDaTransicao(tr) {
    const v = await LNUX.perguntar("Duração da transição", { rotulo: "Duração (segundos ou 00:00:01:00)", valor: String(tr.duracao).replace(".", ",") });
    if (v === null) return;
    const t = A.lerTempo(v);
    if (!t || t <= 0) { LNUX.aviso("Duração inválida.", "alerta"); return; }
    A.marcar("Duração da transição");
    tr.duracao = A.arredondar(t);
    A.mudou();
  }
  L.duracaoDaTransicao = duracaoDaTransicao;

  // ── Soltar mídias e efeitos ─────────────────────────────────────────

  function duracaoMidia(m) {
    const ini = m.origemEntrada ?? 0, fim = m.origemSaida ?? (m.tipo === "imagem" ? ini + 5 : m.duracao);
    return Math.max(A.quadro(), fim - ini);
  }
  function aoArrastarPorCima(e) {
    const ar = V.arrastando;
    if (!ar) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const pt = ponto(e);
    if (ar.tipo === "midia") {
      const m = A.midia(ar.id), g = trilhaEm(pt.yc);
      if (!m) return;
      const s = encaixar(pt.t, null);
      let trilha = g ? g.t.id : null;
      if (g && m.tipo === "audio" && g.t.tipo === "video") trilha = (A.projeto.trilhas.find((t) => t.tipo === "audio" && t.origem) || {}).id;
      fantasma = { trilha, de: s.t, ate: s.t + duracaoMidia(m), inserir: e.ctrlKey || e.metaKey };
      guia = s.guia;
    } else {
      const h = acharEm(pt);
      fantasma = h.c ? { clipe: h.c.id } : null;
    }
    redesenhar();
  }
  function aoSoltarArrastado(e) {
    const ar = V.arrastando;
    fantasma = null; guia = null;
    if (!ar) { redesenhar(); return; }
    e.preventDefault();
    V.arrastando = null;
    const pt = ponto(e);
    if (ar.tipo === "midia") {
      const m = A.midia(ar.id), g = trilhaEm(pt.yc);
      if (!m) return;
      const opcoes = { tempo: encaixar(pt.t, null).t, modo: e.ctrlKey || e.metaKey ? "inserir" : "sobrescrever", entrada: m.origemEntrada ?? undefined, saida: m.origemSaida ?? undefined };
      if (g && !g.t.travada) { if (g.t.tipo === "video") opcoes.trilhaV = g.t.id; else opcoes.trilhaA = g.t.id; }
      A.colocarMidia(ar.id, opcoes);
      return;
    }
    const h = acharEm(pt);
    if (!h.c) { LNUX.aviso(ar.tipo === "transicao" ? "Solte a transição em cima do começo ou do fim de um clipe." : "Solte o efeito em cima de um clipe."); redesenhar(); return; }
    const ids = A.selecao.has(h.c.id) ? new Set(A.selecao) : new Set([h.c.id]);
    if (ar.tipo === "efeito") { A.aplicarEfeito(ids, ar.id, ar.audio); return; }
    if (ar.tipo === "predef") { V.Paineis.aplicarPredefinicao(ids, ar.id); return; }
    const audio = h.g.t.tipo === "audio";
    if (!!ar.audio !== audio) { LNUX.aviso(audio ? "Esta é uma transição de vídeo: solte numa trilha de vídeo." : "Esta é uma transição de áudio: solte numa trilha de áudio."); redesenhar(); return; }
    const borda = Math.abs(pt.t - h.c.inicio) < Math.abs(pt.t - V.fim(h.c)) ? h.c.inicio : V.fim(h.c);
    const tr = A.aplicarTransicao(h.g.t.id, borda, ar.id);
    if (tr) { A.transicaoEscolhida = tr.id; A.mudou({ leve: true }); }
  }

  // ── Régua ───────────────────────────────────────────────────────────

  function marcadorPerto(x) {
    const sl = rolagem.scrollLeft;
    return A.projeto.marcadores.find((m) => Math.abs(m.tempo * pxs - sl - x) <= 6) || null;
  }
  function iniciarRegua() {
    let arrastoRegua = null;
    regua.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const x = e.clientX - regua.getBoundingClientRect().left;
      regua.setPointerCapture(e.pointerId);
      const m = e.clientY - regua.getBoundingClientRect().top > regua.clientHeight - 16 ? marcadorPerto(x) : null;
      if (A.tocando) A.pausar();
      arrastoRegua = m ? { marcador: m.id, antes: JSON.stringify(A.projeto), moveu: false, x } : { cursor: true };
      if (!m) A.irPara(encaixarRegua(x, e));
    });
    regua.addEventListener("pointermove", (e) => {
      if (!arrastoRegua) { const x = e.clientX - regua.getBoundingClientRect().left; regua.style.cursor = marcadorPerto(x) ? "ew-resize" : "pointer"; return; }
      const x = e.clientX - regua.getBoundingClientRect().left;
      if (arrastoRegua.cursor) { A.irPara(encaixarRegua(x, e)); return; }
      if (!arrastoRegua.moveu) { if (Math.abs(x - arrastoRegua.x) < 3) return; A.marcar("Mover marcador"); arrastoRegua.moveu = true; }
      const m = A.projeto.marcadores.find((k) => k.id === arrastoRegua.marcador);
      if (m) { m.tempo = encaixar((x + rolagem.scrollLeft) / pxs, null).t; redesenhar(); }
    });
    regua.addEventListener("pointerup", () => { if (arrastoRegua && arrastoRegua.moveu) A.mudou({ leve: true }); else if (arrastoRegua && arrastoRegua.marcador) { const m = A.projeto.marcadores.find((k) => k.id === arrastoRegua.marcador); if (m) A.irPara(m.tempo); } arrastoRegua = null; });
    regua.addEventListener("dblclick", (e) => { const m = marcadorPerto(e.clientX - regua.getBoundingClientRect().left); if (m) V.Paineis.editarMarcador(m); });
    regua.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const x = e.clientX - regua.getBoundingClientRect().left;
      const m = marcadorPerto(x), t = (x + rolagem.scrollLeft) / pxs;
      const C = A.comandos;
      LNUX.abrirMenu(m ? [
        { rotulo: "Editar o marcador...", acao: () => V.Paineis.editarMarcador(m) },
        { rotulo: "Apagar o marcador", acao: () => { A.marcar("Apagar marcador"); A.projeto.marcadores = A.projeto.marcadores.filter((k) => k !== m); A.mudou({ leve: true }); } },
      ] : [
        { rotulo: "Marcar entrada aqui", acao: () => { A.irPara(A.arredondar(t)); C.entrada(); } },
        { rotulo: "Marcar saída aqui", acao: () => { A.irPara(A.arredondar(t)); C.saida(); } },
        { rotulo: "Limpar entrada e saída", acao: C.limparMarcas },
        { rotulo: "Adicionar marcador aqui", acao: () => { A.irPara(A.arredondar(t)); C.marcador(); } },
      ], e.clientX, e.clientY);
    });
  }
  /** Na régua o cursor encaixa nos cortes só com Shift (como no Premiere). */
  function encaixarRegua(x, e) {
    const t = Math.max(0, (x + rolagem.scrollLeft) / pxs);
    return e.shiftKey ? encaixar(t, null, true).t : A.arredondar(t);
  }

  // ── Zoom ────────────────────────────────────────────────────────────

  const maxPxs = () => 60 * A.projeto.fps;
  function zoomEm(t, fator) {
    const x = t * pxs - rolagem.scrollLeft;
    pxs = limitar(pxs * fator, 0.5, maxPxs());
    atualizarEspaco();
    rolagem.scrollLeft = t * pxs - x;
    atualizarZoom();
    redesenhar();
  }
  function atualizarZoom() { if (faixaZoom) faixaZoom.value = Math.log2(pxs); }

  // ── Barra de ferramentas e botões ───────────────────────────────────

  const FERRAMENTAS = [
    ["selecao", "Seleção (V): escolhe, move e apara. Alt+arrastar duplica"],
    ["trilha-frente", "Selecionar para a frente (A): tudo dali em diante; com Shift, só uma trilha"],
    ["ondulacao", "Edição em ondulação (B): apara e o resto da trilha acompanha"],
    ["rolagem", "Edição rolante (N): move o corte entre dois clipes"],
    ["esticar", "Esticar a velocidade (R): a nova duração muda a velocidade"],
    ["navalha", "Navalha (C): corta o clipe; com Shift, todas as trilhas"],
    ["slip", "Slip (Y): troca o trecho da mídia sem mexer no clipe"],
    ["slide", "Slide (U): move o clipe entre os vizinhos"],
    ["mao", "Mão (H): arrasta a vista"],
    ["zoom", "Zoom (Z): clique aproxima; com Alt, afasta"],
    ["texto", "Texto (T): clique no monitor ou na linha do tempo para criar um título"],
  ];
  L.atualizarFerramentas = function () {
    for (const b of barraFerramentas.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.ferramenta === A.ferramenta));
    $("#sobreposicao").style.cursor = A.ferramenta === "texto" ? "text" : "";
  };
  let botoes = {};
  L.atualizarBotoes = function () {
    botoes.ima && botoes.ima.setAttribute("aria-pressed", String(A.ima));
    botoes.vinculada && botoes.vinculada.setAttribute("aria-pressed", String(A.vinculada));
    botoes.linhas && botoes.linhas.setAttribute("aria-pressed", String(mostrarLinhas));
    redesenhar();
  };

  // ── Toque com dois dedos (pinça = zoom) ─────────────────────────────

  const toques = new Map();
  let pinca = null;

  // ── API usada pelo resto do app ─────────────────────────────────────

  L.iniciar = function () {
    A = V.app;
    regua = $("#regua"); pistas = $("#pistas"); rolagem = $("#rolagem"); espaco = $("#espaco"); cabecalhos = $("#cabecalhos");
    barraFerramentas = $("#ferramentas");
    for (const [id, nome] of FERRAMENTAS) {
      barraFerramentas.append(el("button", { type: "button", "data-ferramenta": id, title: nome, "aria-label": nome, html: A.icv(id), onclick: () => { A.ferramenta = id; L.atualizarFerramentas(); } }));
    }
    const botao = (ic, dica, acao, extra = {}) => { const b = el("button", Object.assign({ type: "button", class: "lnux-botao icone pequeno plano", title: dica, "aria-label": dica, html: A.icv(ic), onclick: acao }, extra)); return b; };
    botoes.ima = botao("ima", "Encaixe (S): os clipes grudam nos cortes, no cursor e nos marcadores", () => { A.ima = !A.ima; L.atualizarBotoes(); }, { "aria-pressed": "true" });
    botoes.vinculada = botao("vinculo", "Seleção vinculada: o vídeo e o áudio do mesmo arquivo andam juntos", () => { A.vinculada = !A.vinculada; L.atualizarBotoes(); }, { "aria-pressed": "true" });
    botoes.linhas = botao("chave", "Mostrar as linhas de opacidade e volume nos clipes (Ctrl+clique na linha cria um quadro-chave)", () => { mostrarLinhas = !mostrarLinhas; L.atualizarBotoes(); }, { "aria-pressed": "true" });
    $("#botoes-linha").append(botoes.ima, botoes.vinculada, botoes.linhas,
      botao("bandeira", "Adicionar marcador (M)", () => A.comandos.marcador()),
      botao("mais", "Nova trilha", (e) => { const r = e.currentTarget.getBoundingClientRect(); LNUX.abrirMenu([{ rotulo: "Nova trilha de vídeo", acao: () => A.comandos.adicionarTrilha("video") }, { rotulo: "Nova trilha de áudio", acao: () => A.comandos.adicionarTrilha("audio") }], r.left, r.bottom + 2); }));
    faixaZoom = el("input", { type: "range", min: -1, max: Math.log2(60 * 60), step: 0.05, value: Math.log2(pxs), title: "Zoom da linha do tempo", "aria-label": "Zoom da linha do tempo", style: { width: "110px" } });
    faixaZoom.addEventListener("input", () => { const t = A.cursor; const x = t * pxs - rolagem.scrollLeft; pxs = limitar(Math.pow(2, +faixaZoom.value), 0.5, maxPxs()); atualizarEspaco(); rolagem.scrollLeft = t * pxs - x; redesenhar(); });
    $("#zoom-linha").append(botao("menos", "Afastar (-)", () => L.zoom(1 / 1.5)), faixaZoom, botao("mais", "Aproximar (=)", () => L.zoom(1.5)),
      el("button", { type: "button", class: "lnux-botao pequeno plano", title: "Ver a sequência toda (\\)", onclick: () => L.verTudo() }, "Tudo"));
    L.atualizarFerramentas();
    L.atualizarBotoes();

    pistas.addEventListener("pointerdown", aoApertar);
    pistas.addEventListener("pointermove", aoMover);
    pistas.addEventListener("pointerup", aoSoltar);
    pistas.addEventListener("pointercancel", (e) => { toques.delete(e.pointerId); pinca = null; cancelar(); });
    pistas.addEventListener("pointerleave", () => { if (!arrasto) pistas.style.cursor = "default"; });
    pistas.addEventListener("contextmenu", aoMenu);
    pistas.addEventListener("dblclick", (e) => {
      const h = acharEm(ponto(e));
      if (h.tr) duracaoDaTransicao(h.tr);
      else if (h.c && h.c.tipo === "midia") V.Paineis.abrirNaOrigem(h.c.midia);
      else if (h.c) V.Paineis.abrirAba("dir", h.c.tipo === "texto" || h.c.tipo === "forma" || h.c.tipo === "cor" ? "propriedades" : "propriedades");
    });
    pistas.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); zoomEm(ponto(e).t, e.deltaY < 0 ? 1.25 : 0.8); }
      else if (e.shiftKey) { e.preventDefault(); rolagem.scrollLeft += e.deltaY + e.deltaX; }
    }, { passive: false });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && arrasto) cancelar(); });
    cabecalhos.addEventListener("wheel", (e) => { rolagem.scrollTop += e.deltaY; }, { passive: true });
    rolagem.addEventListener("scroll", () => { cabecalhos.scrollTop = rolagem.scrollTop; redesenhar(); });
    new ResizeObserver(() => { atualizarEspaco(); redesenhar(); }).observe(rolagem);
    rolagem.addEventListener("dragover", aoArrastarPorCima);
    rolagem.addEventListener("dragleave", () => { fantasma = null; guia = null; redesenhar(); });
    rolagem.addEventListener("drop", aoSoltarArrastado);
    LNUX.soltarArquivos(rolagem, async (lista, e) => {
      const pt = ponto(e);
      const ids = await A.importar(lista);
      let t = encaixar(pt.t, null).t;
      for (const id of ids) { const novos = A.colocarMidia(id, { tempo: t }); if (novos.length) t = Math.max(...novos.map(V.fim)); }
    });
    iniciarRegua();
    document.addEventListener("lnux:tema", redesenhar);
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redesenhar);
  };

  L.desenhar = function (leve) {
    if (!A) return;
    atualizarEspaco();
    // os cabeçalhos guardam as trilhas do projeto: se o projeto foi trocado (desfazer, abrir), reconstrói
    if (!leve || assinaturaDasTrilhas() !== assinaturaTrilhas || A.projeto !== projetoVisto) { projetoVisto = A.projeto; desenharCabecalhos(); }
    redesenhar();
  };
  L.redesenhar = redesenhar;
  L.pxs = () => pxs;
  L.zoom = (f) => {
    const sl = rolagem.scrollLeft, w = rolagem.clientWidth;
    const x = A.cursor * pxs;
    zoomEm(x >= sl && x <= sl + w ? A.cursor : (sl + w / 2) / pxs, f);
  };
  L.verTudo = function () {
    pxs = limitar((rolagem.clientWidth - 30) / Math.max(5, A.duracao() * 1.05), 0.5, maxPxs());
    atualizarEspaco();
    rolagem.scrollLeft = 0;
    atualizarZoom();
    redesenhar();
  };
  L.manterVisivel = function () {
    if (!rolagem || arrasto) return;
    const x = A.cursor * pxs, sl = rolagem.scrollLeft, w = rolagem.clientWidth;
    if (x < sl || x > sl + w - 24) rolagem.scrollLeft = A.tocando ? x - 24 : x - w / 2;
  };
  L.cancelar = cancelar;
  /** Retângulo de um clipe na tela (px da janela) — usado pelos testes automáticos. */
  L.areaDoClipe = function (id) {
    const c = A.clipe(id);
    if (!c) return null;
    const g = layout().mapa.get(c.trilha), r = retangulo(c, g), b = pistas.getBoundingClientRect();
    return { x: b.left + r.x, y: b.top + r.y, w: r.w, h: r.h };
  };
  L.xDoTempo = (t) => pistas.getBoundingClientRect().left + t * pxs - rolagem.scrollLeft;
  L.mostrandoLinhas = () => mostrarLinhas;

  /** Tira as transições que ficaram sem sentido (clipes que não estão mais colados ou mudaram de trilha). */
  V.limparTransicoes = function (p) {
    const porId = new Map(p.clipes.map((c) => [c.id, c]));
    p.transicoes = (p.transicoes || []).filter((tr) => {
      const a = tr.a && porId.get(tr.a), b = tr.b && porId.get(tr.b);
      if (tr.a && !a) tr.a = null;
      if (tr.b && !b) tr.b = null;
      if (!a && !b) return false;
      if (a && b && (a.trilha !== b.trilha || Math.abs(V.fim(a) - b.inicio) > 1e-3)) {
        // descolaram: vira uma transição de um lado só no clipe que entra
        tr.a = null;
      }
      tr.trilha = (b || a).trilha;
      return true;
    });
  };
})();
