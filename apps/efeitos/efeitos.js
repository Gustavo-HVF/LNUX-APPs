/*
 * Efeitos — animação de títulos e gráficos (interface).
 *
 * A composição (JSON) tem tamanho, quadros por segundo, duração, fundo e camadas. Cada camada guarda os
 * valores fixos (props), os quadros-chave (anim: {prop: [{t, v, s}]}) e o "tremer" (tremer: {prop: {amplitude,
 * frequencia}}). Com o relógio ⏱ de uma propriedade ligado, mexer nela (no painel ou arrastando no visor) cria
 * ou atualiza um quadro-chave no instante do cursor — como nos editores de animação.
 */
(function () {
  "use strict";

  const { el, icone, $, limitar } = LNUX;
  const { Motor, SUAVIZACOES, PROPRIEDADES, valor } = EfeitosMotor;

  const canvas = $("#quadro"), alcas = $("#alcas");
  const motor = new Motor(canvas);

  const TAMANHOS = [["1920x1080", "1920 × 1080 (Full HD)"], ["1280x720", "1280 × 720 (HD)"], ["1080x1920", "1080 × 1920 (vertical)"], ["1080x1080", "1080 × 1080 (quadrado)"], ["800x450", "800 × 450 (leve)"], ["512x512", "512 × 512 (figurinha)"]];
  const FONTES = [["system-ui, sans-serif", "Sem serifa"], ["Georgia, serif", "Com serifa"], ["'Arial Black', Impact, sans-serif", "Pesada"], ["ui-monospace, monospace", "Máquina de escrever"], ["'Comic Sans MS', 'Comic Neue', cursive", "Escrita à mão"]];
  const MISTURAS = [["source-over", "Normal"], ["multiply", "Multiplicar"], ["screen", "Tela (clarear)"], ["overlay", "Sobrepor"], ["darken", "Escurecer"], ["lighten", "Clarear"], ["color-dodge", "Subexpor cor"], ["difference", "Diferença"], ["lighter", "Somar luz"], ["hue", "Matiz"], ["color", "Cor"]];
  const ANIM_TEXTO = [["nenhuma", "Nenhuma"], ["digitar", "Digitar"], ["letras-sobem", "Letras sobem"], ["por-palavra", "Palavra por palavra"], ["pular", "Letras pulam"], ["onda", "Onda (sem parar)"]];
  const CORES_TIPO = { texto: "--clipe-texto", forma: "--clipe-video", imagem: "--clipe-imagem", video: "--clipe-imagem", particulas: "--clipe-audio" };
  const ICONE_TIPO = { texto: "texto", forma: "forma", imagem: "imagem", video: "video", particulas: "particulas" };

  // ── Estado ──────────────────────────────────────────────────────────

  let comp = null;
  const midias = new Map(); // id → {blob, url}
  const guardadas = new Set();
  let escolhida = null; // id da camada
  let chaveEscolhida = null; // {camada, prop, i}
  let tempo = 0;
  let pxs = 100;
  let tocando = false, inicioReal = 0, inicioTempo = 0;
  let caminhoProjeto = null;

  const hist = new LNUX.Historico(() => comp, (e) => { comp = e; if (!comp.camadas.some((c) => c.id === escolhida)) escolhida = null; chaveEscolhida = null; mudou(); });
  const camadaPorId = (id) => comp.camadas.find((c) => c.id === id);
  const atual = () => camadaPorId(escolhida);
  const quadroDe = (t) => Math.round(t * comp.fps) / comp.fps;

  function camadaBase(tipo, extra = {}) {
    const W = comp.largura, H = comp.altura;
    return Object.assign({
      id: LNUX.id("l"), tipo, nome: tipo, inicio: 0, fim: comp.duracao, visivel: true, travada: false, mistura: "source-over", aberta: true,
      semente: Math.floor(Math.random() * 1000) + 1,
      props: { x: W / 2, y: H / 2, escala: 100, rotacao: 0, opacidade: 100, desenho: 100, desfoque: 0, brilho: 0, sombra: 0, matiz: 0 },
      anim: {}, tremer: {},
    }, extra);
  }
  const formaBase = (tipo, extra = {}) => Object.assign({ tipo, largura: Math.round(comp.largura * 0.32), altura: Math.round(comp.altura * 0.22), raio: 18, pontas: 5, preenchimento: "#5b9dff", gradiente: null, contorno: "#ffffff", espessura: 0 }, extra);
  const textoBase = (conteudo, extra = {}) => Object.assign({ conteudo, fonte: FONTES[0][0], tamanho: Math.round(comp.altura * 0.12), peso: 800, cor: "#ffffff", alinhamento: "center", espacamento: 0, entrelinha: 1.15, contorno: false, corContorno: "#000000", animacao: "nenhuma", duracaoAnim: 1 }, extra);

  function novaComposicao(exemplo = true) {
    comp = { versao: 1, nome: "Composição sem nome", largura: 1280, altura: 720, fps: 30, duracao: 6, fundo: "#14161c", transparente: false, camadas: [], midias: {} };
    if (exemplo) {
      const titulo = camadaBase("texto", { nome: "Título", texto: textoBase("Olá, LNUX!", { animacao: "letras-sobem", duracaoAnim: 1.2 }) });
      const faixa = camadaBase("forma", { nome: "Faixa", forma: formaBase("retangulo", { largura: 760, altura: 170, raio: 26, preenchimento: "#3d7fe0", gradiente: "#a855f7" }) });
      comp.camadas.push(titulo, faixa);
      aplicarPronta(faixa, "zoom", 0);
      aplicarPronta(titulo, "sumir", 0, true);
      tempo = 1.5; // abre num ponto em que o exemplo já apareceu
    }
  }

  // ── Valores e quadros-chave ─────────────────────────────────────────

  const temAnim = (c, p) => !!(c.anim[p] && c.anim[p].length);
  const valorBase = (c, p, t) => valor({ ...c, tremer: null }, p, t);
  const indiceChave = (c, p, t) => (c.anim[p] || []).findIndex((k) => Math.abs(k.t - t) < 0.5 / comp.fps);

  /** Muda o valor de uma propriedade no instante atual (com animação ligada, vira quadro-chave). */
  function definir(c, p, v) {
    if (temAnim(c, p)) {
      const i = indiceChave(c, p, tempo);
      if (i >= 0) c.anim[p][i].v = v;
      else { c.anim[p].push({ t: quadroDe(tempo), v, s: "suave" }); c.anim[p].sort((a, b) => a.t - b.t); }
    } else c.props[p] = v;
  }
  function alternarAnimacao(c, p) {
    hist.marcar(temAnim(c, p) ? "Desligar animação" : "Ligar animação");
    if (temAnim(c, p)) { c.props[p] = valorBase(c, p, tempo); delete c.anim[p]; }
    else c.anim[p] = [{ t: quadroDe(tempo), v: c.props[p], s: "suave" }];
    mudou();
  }
  function chaveAqui(c, p) {
    hist.marcar("Quadro-chave");
    if (!c.anim[p]) c.anim[p] = [];
    const i = indiceChave(c, p, tempo);
    if (i >= 0) c.anim[p].splice(i, 1);
    else { c.anim[p].push({ t: quadroDe(tempo), v: valorBase(c, p, tempo), s: "suave" }); c.anim[p].sort((a, b) => a.t - b.t); }
    if (!c.anim[p].length) delete c.anim[p];
    mudou();
  }
  function irParaChave(c, p, direcao) {
    const ts = p ? (c.anim[p] || []).map((k) => k.t) : Object.values(c.anim).flat().map((k) => k.t);
    const alvo = direcao > 0 ? ts.filter((t) => t > tempo + 1e-4).sort((a, b) => a - b)[0] : ts.filter((t) => t < tempo - 1e-4).sort((a, b) => b - a)[0];
    if (alvo !== undefined) irPara(alvo);
  }

  // ── Animações prontas e modelos ─────────────────────────────────────

  const PRONTAS = {
    aparecer: "Aparecer", sumir: "Sumir no fim", "deslizar-esquerda": "Entrar pela esquerda", "deslizar-direita": "Entrar pela direita",
    "deslizar-baixo": "Subir de baixo", zoom: "Zoom elástico", quicar: "Cair quicando", girar: "Girar sem parar", pulsar: "Pulsar",
    desenhar: "Desenhar o contorno", tremer: "Tremer", desfocar: "Sair do desfoque",
  };

  /** Aplica uma animação pronta à camada, a partir do instante t0. */
  function aplicarPronta(c, nome, t0 = tempo, semHistorico = false) {
    if (!semHistorico) hist.marcar(PRONTAS[nome]);
    const W = comp.largura, H = comp.altura, p = c.props;
    const fim = c.fim;
    const chaves = (prop, lista) => { c.anim[prop] = lista.map(([t, v, s = "saida"]) => ({ t: quadroDe(limitar(t, 0, comp.duracao)), v, s })).sort((a, b) => a.t - b.t); };
    const base = (prop) => valorBase(c, prop, t0);
    switch (nome) {
      case "aparecer": chaves("opacidade", [[t0, 0], [t0 + 0.5, 100]]); break;
      case "sumir": chaves("opacidade", [[Math.max(t0, fim - 0.6), base("opacidade"), "suave"], [fim - 0.05, 0]]); break;
      case "deslizar-esquerda": chaves("x", [[t0, base("x") - W * 0.6], [t0 + 0.8, base("x")]]); chaves("opacidade", [[t0, 0], [t0 + 0.4, 100]]); break;
      case "deslizar-direita": chaves("x", [[t0, base("x") + W * 0.6], [t0 + 0.8, base("x")]]); chaves("opacidade", [[t0, 0], [t0 + 0.4, 100]]); break;
      case "deslizar-baixo": chaves("y", [[t0, base("y") + H * 0.35], [t0 + 0.8, base("y")]]); chaves("opacidade", [[t0, 0], [t0 + 0.4, 100]]); break;
      case "zoom": chaves("escala", [[t0, 0, "elastico"], [t0 + 1, base("escala") || 100]]); break;
      case "quicar": chaves("y", [[t0, base("y") - H * 0.6, "pulo"], [t0 + 1.1, base("y")]]); break;
      case "girar": chaves("rotacao", [[c.inicio, 0, "linear"], [fim, 360]]); break;
      case "pulsar": { const l = []; for (let t = t0, i = 0; t <= fim; t += 0.45, i++) l.push([t, i % 2 ? 112 : 100, "suave"]); chaves("escala", l); break; }
      case "desenhar": chaves("desenho", [[t0, 0, "suave"], [t0 + 1.2, 100]]); break;
      case "tremer": c.tremer.x = { amplitude: 10, frequencia: 4 }; c.tremer.y = { amplitude: 10, frequencia: 4 }; c.tremer.rotacao = { amplitude: 3, frequencia: 3 }; break;
      case "desfocar": chaves("desfoque", [[t0, 24, "saida"], [t0 + 0.9, 0]]); chaves("opacidade", [[t0, 0], [t0 + 0.5, 100]]); break;
    }
    c.aberta = true;
    if (!semHistorico) mudou();
  }

  const MODELOS = {
    titulo: "Título com faixa", terco: "Terço inferior (nome e cargo)", contagem: "Contagem regressiva (3, 2, 1)",
    botao: "Botão chamando para clicar", confete: "Chuva de confete", neve: "Neve caindo", logo: "Estrela com brilho",
  };
  function aplicarModelo(nome) {
    hist.marcar(MODELOS[nome]);
    const W = comp.largura, H = comp.altura, t0 = tempo;
    const novas = [];
    const ate = (c, d) => { c.inicio = t0; c.fim = Math.min(comp.duracao, t0 + d); return c; };
    if (nome === "titulo") {
      const f = ate(camadaBase("forma", { nome: "Faixa", forma: formaBase("retangulo", { largura: W * 0.62, altura: H * 0.22, raio: 20, preenchimento: "#ef476f", gradiente: "#f78c6b" }) }), 4);
      const t = ate(camadaBase("texto", { nome: "Título", texto: textoBase("SEU TÍTULO", { animacao: "letras-sobem", duracaoAnim: 0.9 }) }), 4);
      novas.push(t, f); aplicarPronta(f, "deslizar-esquerda", t0, true); aplicarPronta(f, "sumir", t0, true); aplicarPronta(t, "sumir", t0, true);
    } else if (nome === "terco") {
      const f = ate(camadaBase("forma", { nome: "Fundo do nome", forma: formaBase("retangulo", { largura: W * 0.4, altura: H * 0.16, raio: 10, preenchimento: "#1d4ed8" }) }), 5);
      f.props.x = W * 0.27; f.props.y = H * 0.8;
      const n = ate(camadaBase("texto", { nome: "Nome", texto: textoBase("Nome da Pessoa", { tamanho: Math.round(H * 0.06), alinhamento: "left" }) }), 5);
      n.props.x = W * 0.27; n.props.y = H * 0.775;
      const c = ate(camadaBase("texto", { nome: "Cargo", texto: textoBase("o que ela faz", { tamanho: Math.round(H * 0.035), peso: 400, cor: "#c7d2fe", alinhamento: "left" }) }), 5);
      c.props.x = W * 0.27; c.props.y = H * 0.835;
      novas.push(n, c, f);
      for (const x of novas) { aplicarPronta(x, "deslizar-esquerda", t0, true); aplicarPronta(x, "sumir", t0, true); }
    } else if (nome === "contagem") {
      ["3", "2", "1"].forEach((n, i) => {
        const t = camadaBase("texto", { nome: "Número " + n, texto: textoBase(n, { tamanho: Math.round(H * 0.5), fonte: FONTES[2][0] }), inicio: t0 + i, fim: Math.min(comp.duracao, t0 + i + 1) });
        novas.push(t); aplicarPronta(t, "zoom", t0 + i, true);
        t.anim.opacidade = [{ t: quadroDe(t0 + i + 0.6), v: 100, s: "entrada" }, { t: quadroDe(t0 + i + 0.98), v: 0, s: "linear" }];
      });
      novas.reverse();
    } else if (nome === "botao") {
      const f = ate(camadaBase("forma", { nome: "Botão", forma: formaBase("retangulo", { largura: W * 0.3, altura: H * 0.13, raio: 60, preenchimento: "#e11d48" }) }), comp.duracao);
      const t = ate(camadaBase("texto", { nome: "Texto do botão", texto: textoBase("INSCREVA-SE", { tamanho: Math.round(H * 0.06) }) }), comp.duracao);
      f.props.y = t.props.y = H * 0.75;
      novas.push(t, f);
      aplicarPronta(f, "zoom", t0, true); aplicarPronta(t, "zoom", t0, true);
      f.anim.escala.push({ t: quadroDe(t0 + 1.5), v: 108, s: "suave" }, { t: quadroDe(t0 + 2), v: 100, s: "suave" }, { t: quadroDe(t0 + 2.5), v: 108, s: "suave" }, { t: quadroDe(t0 + 3), v: 100, s: "suave" });
    } else if (nome === "confete") {
      const p = ate(camadaBase("particulas", { nome: "Confete", particulas: { quantidade: 180, direcao: "explosao", forma: "confete", cores: ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#ffffff"], tamanho: 16, velocidade: 520, vida: 2.6, gravidade: 0, espalhar: 360, semente: 7 } }), 3);
      p.props.y = H * 0.45; novas.push(p);
    } else if (nome === "neve") {
      const p = ate(camadaBase("particulas", { nome: "Neve", particulas: { quantidade: 140, direcao: "neve", forma: "circulo", cores: ["#ffffff", "#dbeafe"], tamanho: 9, velocidade: 160, vida: 6, gravidade: 0, espalhar: 0, semente: 3 } }), comp.duracao);
      novas.push(p);
    } else if (nome === "logo") {
      const s = ate(camadaBase("forma", { nome: "Estrela", forma: formaBase("estrela", { largura: H * 0.4, altura: H * 0.4, preenchimento: "#ffd166", gradiente: "#f97316", pontas: 5 }) }), comp.duracao);
      novas.push(s); aplicarPronta(s, "zoom", t0, true); aplicarPronta(s, "girar", t0, true);
      s.anim.brilho = [{ t: quadroDe(t0), v: 0, s: "suave" }, { t: quadroDe(t0 + 1), v: 30, s: "suave" }, { t: quadroDe(Math.min(comp.duracao, t0 + 2)), v: 8, s: "suave" }];
    }
    comp.camadas.unshift(...novas);
    escolhida = novas[0] && novas[0].id;
    mudou();
  }

  // ── Criar e mexer nas camadas ───────────────────────────────────────

  function adicionar(c) {
    hist.marcar("Nova camada");
    comp.camadas.unshift(c);
    escolhida = c.id;
    chaveEscolhida = null;
    mudou();
    return c;
  }
  const criar = {
    texto: () => adicionar(camadaBase("texto", { nome: "Texto", texto: textoBase("Texto novo") })),
    retangulo: () => adicionar(camadaBase("forma", { nome: "Retângulo", forma: formaBase("retangulo") })),
    elipse: () => adicionar(camadaBase("forma", { nome: "Elipse", forma: formaBase("elipse", { largura: Math.round(comp.altura * 0.3), altura: Math.round(comp.altura * 0.3), preenchimento: "#06d6a0" }) })),
    estrela: () => adicionar(camadaBase("forma", { nome: "Estrela", forma: formaBase("estrela", { largura: Math.round(comp.altura * 0.35), altura: Math.round(comp.altura * 0.35), preenchimento: "#ffd166" }) })),
    linha: () => { const c = adicionar(camadaBase("forma", { nome: "Linha", forma: formaBase("linha", { espessura: 10, preenchimento: "#ffffff", contorno: "#ffffff", largura: Math.round(comp.largura * 0.5) }) })); aplicarPronta(c, "desenhar"); },
    particulas: () => adicionar(camadaBase("particulas", { nome: "Partículas", particulas: { quantidade: 80, direcao: "cima", forma: "circulo", cores: ["#ffd166", "#ef476f", "#06d6a0"], tamanho: 12, velocidade: 240, vida: 2.5, gravidade: 0, espalhar: 50, semente: 1 } })),
    midia: async () => {
      const [arq] = await LNUX.arquivos.abrir({ titulo: "Imagem ou vídeo", aceitar: "image/*,video/*" });
      if (!arq) return;
      const id = LNUX.id("m");
      const tipo = (arq.tipo || "").startsWith("video/") ? "video" : "imagem";
      const blob = await arq.blob();
      comp.midias[id] = { nome: arq.nome, tipo };
      await registrarMidia(id, blob);
      const c = camadaBase(tipo, { nome: LNUX.nomeSemExtensao(arq.nome), midia: id });
      const m = motor.midias.get(id);
      const w = m.imagem ? m.el.naturalWidth : m.el.videoWidth, h = m.imagem ? m.el.naturalHeight : m.el.videoHeight;
      if (w && h) c.props.escala = Math.round(Math.min(100, (Math.min(comp.largura / w, comp.altura / h) * 100) * 0.8));
      adicionar(c);
    },
  };

  function registrarMidia(id, blob) {
    const url = URL.createObjectURL(blob);
    midias.set(id, { blob, url });
    const tipo = comp.midias[id].tipo;
    return new Promise((resolver) => {
      if (tipo === "imagem") {
        const img = new Image();
        img.onload = img.onerror = () => { motor.midias.set(id, { el: img, imagem: true }); resolver(); desenharQuadro(); };
        img.src = url;
      } else {
        const v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto";
        v.onloadeddata = v.onerror = () => { motor.midias.set(id, { el: v, imagem: false }); resolver(); desenharQuadro(); };
        v.src = url;
      }
    });
  }

  function apagarCamada() {
    const c = atual();
    if (!c) return;
    hist.marcar("Apagar camada");
    comp.camadas = comp.camadas.filter((x) => x !== c);
    escolhida = null;
    mudou();
  }
  function apagar() {
    if (chaveEscolhida) {
      const c = camadaPorId(chaveEscolhida.camada);
      hist.marcar("Apagar quadro-chave");
      c.anim[chaveEscolhida.prop].splice(chaveEscolhida.i, 1);
      if (!c.anim[chaveEscolhida.prop].length) { c.props[chaveEscolhida.prop] = valorBase(c, chaveEscolhida.prop, tempo); delete c.anim[chaveEscolhida.prop]; }
      chaveEscolhida = null;
      mudou();
    } else apagarCamada();
  }
  function duplicarCamada() {
    const c = atual();
    if (!c) return;
    hist.marcar("Duplicar camada");
    const n = JSON.parse(JSON.stringify(c));
    n.id = LNUX.id("l");
    n.nome = c.nome + " (cópia)";
    comp.camadas.splice(comp.camadas.indexOf(c), 0, n);
    escolhida = n.id;
    mudou();
  }
  function moverCamada(direcao) {
    const c = atual();
    if (!c) return;
    const i = comp.camadas.indexOf(c), j = i + direcao;
    if (j < 0 || j >= comp.camadas.length) return;
    hist.marcar("Mudar a ordem");
    comp.camadas.splice(i, 1);
    comp.camadas.splice(j, 0, c);
    mudou();
  }
  function cortarCamada(lado) {
    const c = atual();
    if (!c) return;
    hist.marcar(lado === "inicio" ? "Começar no cursor" : "Terminar no cursor");
    if (lado === "inicio" && tempo < c.fim) c.inicio = quadroDe(tempo);
    if (lado === "fim" && tempo > c.inicio) c.fim = quadroDe(tempo);
    mudou();
  }

  // ── Visor ───────────────────────────────────────────────────────────

  function ajustarVisor() {
    if (canvas.width !== comp.largura || canvas.height !== comp.altura) {
      canvas.width = alcas.width = comp.largura;
      canvas.height = alcas.height = comp.altura;
    }
    const palco = $("#palco");
    const w = palco.clientWidth - 24, h = palco.clientHeight - 24;
    if (w <= 0 || h <= 0) return;
    const e = Math.min(w / comp.largura, h / comp.altura);
    for (const c of [canvas, alcas]) { c.style.width = Math.floor(comp.largura * e) + "px"; c.style.height = Math.floor(comp.altura * e) + "px"; }
    desenharQuadro();
  }
  new ResizeObserver(ajustarVisor).observe($("#palco"));

  function sincronizarVideos(t, tocandoAgora) {
    for (const c of comp.camadas) {
      if (c.tipo !== "video") continue;
      const m = motor.midias.get(c.midia);
      if (!m) continue;
      const v = m.el;
      const dentro = t >= c.inicio && t < c.fim;
      const alvo = Math.max(0, t - c.inicio) % Math.max(0.1, v.duration || 1);
      if (!dentro) { if (!v.paused) v.pause(); continue; }
      if (tocandoAgora) {
        if (v.paused) { v.currentTime = alvo; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - alvo) > 0.25) v.currentTime = alvo;
      } else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - alvo) > 0.03) v.currentTime = alvo; }
    }
  }

  function desenharQuadro() {
    if (!comp) return;
    motor.desenhar(comp, tempo);
    desenharAlcas();
  }

  function geometria(c) {
    const cx = valor(c, "x", tempo), cy = valor(c, "y", tempo);
    const rot = (valor(c, "rotacao", tempo) * Math.PI) / 180;
    const esc = Math.max(0.01, valor(c, "escala", tempo) / 100);
    const { w, h } = motor.caixa(c);
    return { cx, cy, rot, esc, w, h };
  }
  function paraLocal(g, x, y) {
    const dx = x - g.cx, dy = y - g.cy;
    const c = Math.cos(-g.rot), s = Math.sin(-g.rot);
    return { x: (dx * c - dy * s) / g.esc, y: (dx * s + dy * c) / g.esc };
  }

  function desenharAlcas() {
    const ctx = alcas.getContext("2d");
    ctx.clearRect(0, 0, alcas.width, alcas.height);
    const c = atual();
    if (!c || tocando || !c.visivel || tempo < c.inicio || tempo >= c.fim) return;
    const g = geometria(c);
    const u = comp.largura / 640;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rot);
    const w = g.w * g.esc, h = g.h * g.esc;
    ctx.strokeStyle = "#5b9dff"; ctx.lineWidth = 1.5 * u; ctx.setLineDash([6 * u, 4 * u]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) { ctx.fillRect(x - 5 * u, y - 5 * u, 10 * u, 10 * u); ctx.strokeRect(x - 5 * u, y - 5 * u, 10 * u, 10 * u); }
    ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - 26 * u); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -h / 2 - 30 * u, 6 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function pontoNoVisor(e) {
    const r = alcas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (comp.largura / r.width), y: (e.clientY - r.top) * (comp.altura / r.height) };
  }
  let arrastoVisor = null;
  alcas.addEventListener("pointerdown", (e) => {
    if (tocando) pausar();
    const p = pontoNoVisor(e);
    const u = comp.largura / 640;
    let c = atual(), zona = null;
    if (c && c.visivel && !c.travada && tempo >= c.inicio && tempo < c.fim) {
      const g = geometria(c), l = paraLocal(g, p.x, p.y);
      const hw = g.w / 2, hh = g.h / 2, tol = (10 * u) / g.esc;
      if (Math.hypot(l.x, l.y - (-hh - (30 * u) / g.esc)) < tol * 1.3) zona = "girar";
      else if ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].some(([x, y]) => Math.abs(l.x - x) < tol && Math.abs(l.y - y) < tol)) zona = "escala";
      else if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) zona = "mover";
    }
    if (!zona) {
      c = comp.camadas.find((x) => {
        if (!x.visivel || x.travada || tempo < x.inicio || tempo >= x.fim) return false;
        const g = geometria(x), l = paraLocal(g, p.x, p.y);
        return Math.abs(l.x) <= g.w / 2 && Math.abs(l.y) <= g.h / 2;
      });
      zona = c ? "mover" : null;
    }
    if (!c || !zona) { escolhida = null; chaveEscolhida = null; desenharTudo(); return; }
    escolhida = c.id;
    alcas.setPointerCapture(e.pointerId);
    const g = geometria(c);
    arrastoVisor = { c, zona, p, x: valorBase(c, "x", tempo), y: valorBase(c, "y", tempo), escala: valorBase(c, "escala", tempo), rotacao: valorBase(c, "rotacao", tempo), g, marcado: false,
      dist: Math.hypot(p.x - g.cx, p.y - g.cy), ang: Math.atan2(p.y - g.cy, p.x - g.cx) };
    desenharTudo();
  });
  alcas.addEventListener("pointermove", (e) => {
    const a = arrastoVisor;
    if (!a) return;
    const p = pontoNoVisor(e);
    if (!a.marcado) { if (Math.hypot(p.x - a.p.x, p.y - a.p.y) < 3) return; hist.marcar("Mexer no visor"); a.marcado = true; }
    if (a.zona === "mover") {
      let nx = a.x + p.x - a.p.x, ny = a.y + p.y - a.p.y;
      if (Math.abs(nx - comp.largura / 2) < comp.largura * 0.01) nx = comp.largura / 2; // gruda no centro
      if (Math.abs(ny - comp.altura / 2) < comp.altura * 0.01) ny = comp.altura / 2;
      definir(a.c, "x", Math.round(nx)); definir(a.c, "y", Math.round(ny));
    } else if (a.zona === "escala") {
      definir(a.c, "escala", Math.max(1, Math.round(a.escala * (Math.hypot(p.x - a.g.cx, p.y - a.g.cy) / Math.max(1, a.dist)))));
    } else if (a.zona === "girar") {
      let r = a.rotacao + ((Math.atan2(p.y - a.g.cy, p.x - a.g.cx) - a.ang) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      definir(a.c, "rotacao", Math.round(r * 10) / 10);
    }
    desenharQuadro();
    atualizarPropriedadesLeve();
  });
  alcas.addEventListener("pointerup", () => { if (arrastoVisor && arrastoVisor.marcado) mudou(); arrastoVisor = null; });

  // ── Reprodução ──────────────────────────────────────────────────────

  function irPara(t) {
    tempo = limitar(t, 0, comp.duracao);
    if (tocando) { inicioTempo = tempo; inicioReal = performance.now(); }
    sincronizarVideos(tempo, tocando);
    desenharQuadro();
    mostrarTempo();
    posicionarCabecote();
    if (!tocando) { atualizarPropriedadesLeve(); atualizarValoresDaLinha(); }
  }
  /** Os valores ao lado das propriedades animadas, na linha do tempo, acompanham o cursor. */
  function atualizarValoresDaLinha() {
    for (const s of nomes.querySelectorAll(".nome-prop .valor[data-prop]")) {
      const c = camadaPorId(s.dataset.camada);
      if (c) s.textContent = formatar(s.dataset.prop, valor(c, s.dataset.prop, tempo));
    }
  }
  function mostrarTempo() {
    $("#tempo").textContent = LNUX.tempo(tempo);
    $("#duracao").textContent = "/ " + LNUX.tempo(comp.duracao);
  }
  function alternarPlay() { tocando ? pausar() : tocar(); }
  function tocar() {
    if (tempo >= comp.duracao - 1e-3) tempo = 0;
    tocando = true; inicioReal = performance.now(); inicioTempo = tempo;
    atualizarBotoes();
    requestAnimationFrame(laco);
  }
  function pausar() {
    tocando = false;
    sincronizarVideos(tempo, false);
    atualizarBotoes();
    desenharTudo();
  }
  let aoTerminarGravacao = null;
  function laco() {
    if (!tocando) return;
    let t = inicioTempo + (performance.now() - inicioReal) / 1000;
    if (t >= comp.duracao) {
      if (aoTerminarGravacao) { tempo = comp.duracao; pausar(); const f = aoTerminarGravacao; aoTerminarGravacao = null; f(); return; }
      if ($("#repetir").checked) { inicioTempo = 0; inicioReal = performance.now(); t = 0; }
      else { tempo = comp.duracao; pausar(); mostrarTempo(); posicionarCabecote(); return; }
    }
    tempo = t;
    sincronizarVideos(t, true);
    motor.desenhar(comp, t);
    desenharAlcas();
    mostrarTempo();
    posicionarCabecote();
    if (gravando) gravando.progresso(t / comp.duracao);
    requestAnimationFrame(laco);
  }

  const botoes = {};
  for (const [id, ic, dica, acao] of [
    ["inicio", "inicio", "Início (Home)", () => irPara(0)],
    ["voltar", "voltar", "Quadro anterior (←)", () => irPara(tempo - 1 / comp.fps)],
    ["tocar", "play", "Tocar / pausar (Espaço)", () => alternarPlay()],
    ["avancar", "avancar", "Próximo quadro (→)", () => irPara(tempo + 1 / comp.fps)],
    ["fim", "fim", "Fim (End)", () => irPara(comp.duracao)],
  ]) { botoes[id] = LNUX.botaoIcone(ic, dica, acao); $("#botoes-transporte").append(botoes[id]); }
  for (const [ic, dica, acao] of [
    ["texto", "Texto (T)", () => criar.texto()], ["retangulo", "Retângulo", () => criar.retangulo()], ["elipse", "Elipse", () => criar.elipse()],
    ["estrela", "Estrela", () => criar.estrela()], ["menos", "Linha (que se desenha)", () => criar.linha()], ["particulas", "Partículas", () => criar.particulas()],
    ["imagem", "Imagem ou vídeo...", () => criar.midia()],
  ]) $("#botoes-criar").append(LNUX.botaoIcone(ic, dica, acao));
  function atualizarBotoes() { botoes.tocar.innerHTML = icone(tocando ? "pausa" : "play"); }

  $("#botao-prontas").addEventListener("click", (e) => {
    const c = atual();
    const r = e.currentTarget.getBoundingClientRect();
    LNUX.abrirMenu(c ? [{ grupo: `Na camada "${c.nome}", a partir do cursor` }, ...Object.entries(PRONTAS).map(([id, nome]) => ({ rotulo: nome, acao: () => aplicarPronta(c, id) }))]
      : [{ grupo: "Escolha uma camada primeiro" }], r.left, r.bottom + 2, e.currentTarget);
  });
  $("#botao-modelos").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    LNUX.abrirMenu([{ grupo: "Acrescenta camadas prontas no cursor" }, ...Object.entries(MODELOS).map(([id, nome]) => ({ rotulo: nome, acao: () => aplicarModelo(id) }))], r.left, r.bottom + 2, e.currentTarget);
  });
  $("#botao-exportar").addEventListener("click", () => exportar());

  // ── Linha do tempo (camadas e quadros-chave) ────────────────────────

  const nomes = $("#nomes"), faixas = $("#faixas"), conteudo = $("#faixas-conteudo"), regua = $("#regua"), cabecote = $("#cabecote");
  faixas.addEventListener("scroll", () => { nomes.scrollTop = faixas.scrollTop; desenharRegua(); posicionarCabecote(); });
  const propsVisiveis = (c) => Object.keys(PROPRIEDADES).filter((p) => temAnim(c, p));

  function ajustarZoom() {
    const largura = faixas.clientWidth;
    if (largura > 0 && !ajustarZoom.manual) pxs = Math.max(20, (largura - 24) / comp.duracao);
  }
  function desenharLinha() {
    ajustarZoom();
    conteudo.style.width = Math.ceil(comp.duracao * pxs + 24) + "px";
    $("#contagem").textContent = comp.camadas.length ? `${comp.camadas.length}` : "";
    const linhasNomes = [], linhasFaixas = [];
    for (const c of comp.camadas) {
      const sel = c.id === escolhida;
      const corCamada = LNUX.tema.cor(CORES_TIPO[c.tipo] || "--clipe-video");
      const seta = el("button", { class: "seta" + (c.aberta ? " aberta" : ""), title: "Mostrar as propriedades animadas", html: "▸", onclick: (e) => { e.stopPropagation(); c.aberta = !c.aberta; desenharLinha(); } });
      const nome = el("div", {
        class: "nome-camada" + (sel ? " escolhida" : ""),
        onclick: () => { escolhida = c.id; chaveEscolhida = null; desenharTudo(); },
        ondblclick: async () => { const n = await LNUX.perguntar("Nome da camada", { valor: c.nome }); if (n) { hist.marcar("Renomear"); c.nome = n; mudou(); } },
        oncontextmenu: (e) => { e.preventDefault(); escolhida = c.id; desenharTudo(); LNUX.abrirMenu(menuCamada(), e.clientX, e.clientY); },
      }, seta, el("span", { class: "tipo", html: icone(ICONE_TIPO[c.tipo]) }), el("span", { class: "texto", title: c.nome }, c.nome),
        el("button", { title: c.visivel ? "Esconder" : "Mostrar", html: icone(c.visivel ? "olho" : "olho-fechado"), onclick: (e) => { e.stopPropagation(); hist.marcar("Mostrar/esconder"); c.visivel = !c.visivel; mudou(); } }),
        el("button", { class: "trava", title: c.travada ? "Destravar" : "Travar (não deixa mexer no visor)", html: icone(c.travada ? "cadeado" : "cadeado-aberto"), onclick: (e) => { e.stopPropagation(); c.travada = !c.travada; mudou(); } }));
      linhasNomes.push(nome);
      const faixa = el("div", { class: "faixa" });
      const barra = el("div", { class: "barra" + (sel ? " escolhida" : ""), style: { left: c.inicio * pxs + "px", width: Math.max(4, (c.fim - c.inicio) * pxs) + "px", "--cor-camada": corCamada } });
      barra.addEventListener("pointerdown", (e) => arrastarBarra(e, c, barra));
      faixa.append(barra);
      const todas = [...new Set(Object.values(c.anim).flat().map((k) => k.t))];
      for (const t of todas) faixa.append(el("div", { class: "chave resumo", style: { left: t * pxs + "px" } }));
      linhasFaixas.push(faixa);
      if (c.aberta) {
        const props = propsVisiveis(c);
        if (!props.length) {
          linhasNomes.push(el("div", { class: "nome-prop" }, el("span", { class: "texto fraco" }, "Sem animação: ligue o ◇ no painel")));
          linhasFaixas.push(el("div", { class: "faixa prop" }));
        }
        for (const p of props) {
          linhasNomes.push(el("div", { class: "nome-prop", onclick: () => { escolhida = c.id; desenharTudo(); } },
            el("span", { class: "texto" }, PROPRIEDADES[p].nome),
            el("span", { class: "valor", dataset: { camada: c.id, prop: p } }, formatar(p, valor(c, p, tempo)))));
          const fp = el("div", { class: "faixa prop" });
          c.anim[p].forEach((k, i) => {
            const escolhidaChave = chaveEscolhida && chaveEscolhida.camada === c.id && chaveEscolhida.prop === p && chaveEscolhida.i === i;
            const d = el("div", { class: "chave" + (escolhidaChave ? " escolhida" : ""), style: { left: k.t * pxs + "px" }, title: `${LNUX.tempo(k.t)} · ${formatar(p, k.v)} · ${SUAVIZACOES[k.s]?.nome || ""}` });
            d.addEventListener("pointerdown", (e) => arrastarChave(e, c, p, i, d));
            d.addEventListener("dblclick", () => irPara(k.t));
            fp.append(d);
          });
          linhasFaixas.push(fp);
        }
      }
    }
    if (!comp.camadas.length) linhasNomes.push(el("div", { class: "lnux-vazio" }, "Crie uma camada na barra de cima (texto, forma, partículas...) ou use um Modelo."));
    nomes.replaceChildren(...linhasNomes);
    conteudo.replaceChildren(...linhasFaixas);
    nomes.scrollTop = faixas.scrollTop;
    desenharRegua();
    posicionarCabecote();
  }
  const formatar = (p, v) => (Math.round(v * 10) / 10).toString().replace(".", ",") + PROPRIEDADES[p].unidade;

  function desenharRegua() {
    const w = faixas.clientWidth, h = 26;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    regua.width = w * dpr; regua.height = h * dpr; regua.style.width = w + "px";
    const ctx = regua.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = LNUX.tema.cor("--painel"); ctx.fillRect(0, 0, w, h);
    const x0 = faixas.scrollLeft;
    let passo = 0.1;
    for (const p of [1 / comp.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]) { passo = p; if (p * pxs >= 60) break; }
    ctx.strokeStyle = LNUX.tema.cor("--borda-forte"); ctx.fillStyle = LNUX.tema.cor("--texto-2");
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily; ctx.textBaseline = "top";
    for (let t = Math.floor(x0 / pxs / passo) * passo; t <= comp.duracao + 1e-6 && t * pxs - x0 < w; t += passo) {
      const x = Math.round(t * pxs - x0) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(LNUX.tempo(t).replace(/^00:/, ""), x + 3, 2);
    }
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(comp.duracao * pxs - x0, 0, w, h);
    const xc = tempo * pxs - x0;
    ctx.fillStyle = LNUX.tema.cor("--cabecote");
    ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc, 9); ctx.fill();
  }
  function posicionarCabecote() {
    cabecote.style.left = tempo * pxs + "px";
    cabecote.style.height = Math.max(faixas.scrollHeight, faixas.clientHeight) + "px";
    desenharRegua();
  }
  regua.addEventListener("pointerdown", (e) => {
    regua.setPointerCapture(e.pointerId);
    const mover = (ev) => irPara(quadroDe((ev.clientX - regua.getBoundingClientRect().left + faixas.scrollLeft) / pxs));
    mover(e);
    const fim = () => { regua.removeEventListener("pointermove", mover); regua.removeEventListener("pointerup", fim); desenharTudo(); };
    regua.addEventListener("pointermove", mover);
    regua.addEventListener("pointerup", fim);
  });
  faixas.addEventListener("pointerdown", (e) => {
    if (e.target !== faixas && e.target !== conteudo && !e.target.classList.contains("faixa")) return;
    const r = faixas.getBoundingClientRect();
    irPara(quadroDe((e.clientX - r.left + faixas.scrollLeft) / pxs));
    chaveEscolhida = null;
    desenharTudo();
  });
  faixas.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    ajustarZoom.manual = true;
    pxs = limitar(pxs * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 10, 2000);
    desenharLinha();
  }, { passive: false });
  new ResizeObserver(() => desenharLinha()).observe(faixas);

  function encaixarTempo(t, ignorar) {
    const tol = 6 / pxs;
    const pontos = [tempo, 0, comp.duracao];
    for (const c of comp.camadas) if (c !== ignorar) pontos.push(c.inicio, c.fim);
    for (const p of pontos) if (Math.abs(p - t) < tol) return p;
    return quadroDe(t);
  }

  function arrastarBarra(e, c, barra) {
    e.stopPropagation();
    escolhida = c.id;
    chaveEscolhida = null;
    const r = barra.getBoundingClientRect();
    const zona = e.clientX - r.left < 7 ? "inicio" : r.right - e.clientX < 7 ? "fim" : "mover";
    const x0 = e.clientX, orig = { inicio: c.inicio, fim: c.fim, anim: JSON.parse(JSON.stringify(c.anim)) };
    let marcado = false;
    barra.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      const dt = (ev.clientX - x0) / pxs;
      if (!marcado) { if (Math.abs(ev.clientX - x0) < 3) return; hist.marcar("Mexer na camada"); marcado = true; }
      if (zona === "mover") {
        const dur = orig.fim - orig.inicio;
        let ini = encaixarTempo(orig.inicio + dt, c);
        const pelaPonta = encaixarTempo(orig.fim + dt, c) - dur;
        if (Math.abs(pelaPonta - (orig.inicio + dt)) < Math.abs(ini - (orig.inicio + dt))) ini = pelaPonta;
        ini = limitar(ini, -dur + 1 / comp.fps, comp.duracao - 1 / comp.fps);
        const delta = ini - orig.inicio;
        c.inicio = ini; c.fim = ini + dur;
        for (const p of Object.keys(orig.anim)) c.anim[p] = orig.anim[p].map((k) => ({ ...k, t: quadroDe(k.t + delta) })); // os quadros-chave vão junto
      } else if (zona === "inicio") c.inicio = limitar(encaixarTempo(orig.inicio + dt, c), 0, c.fim - 1 / comp.fps);
      else c.fim = limitar(encaixarTempo(orig.fim + dt, c), c.inicio + 1 / comp.fps, comp.duracao);
      barra.style.left = c.inicio * pxs + "px";
      barra.style.width = Math.max(4, (c.fim - c.inicio) * pxs) + "px";
      desenharQuadro();
    };
    const soltar = () => { barra.removeEventListener("pointermove", mover); barra.removeEventListener("pointerup", soltar); if (marcado) mudou(); else desenharTudo(); };
    barra.addEventListener("pointermove", mover);
    barra.addEventListener("pointerup", soltar);
  }

  function arrastarChave(e, c, p, i, elemento) {
    e.stopPropagation();
    escolhida = c.id;
    chaveEscolhida = { camada: c.id, prop: p, i };
    const x0 = e.clientX, k = c.anim[p][i], t0 = k.t;
    let marcado = false;
    elemento.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      if (!marcado) { if (Math.abs(ev.clientX - x0) < 3) return; hist.marcar("Mover quadro-chave"); marcado = true; }
      const chave = c.anim[p].find((x) => x === k) || k;
      chave.t = limitar(encaixarTempo(t0 + (ev.clientX - x0) / pxs, null), 0, comp.duracao);
      elemento.style.left = chave.t * pxs + "px";
      desenharQuadro();
    };
    const soltar = () => {
      elemento.removeEventListener("pointermove", mover);
      elemento.removeEventListener("pointerup", soltar);
      if (marcado) { c.anim[p].sort((a, b) => a.t - b.t); chaveEscolhida.i = c.anim[p].indexOf(k); mudou(); }
      else { desenharTudo(); }
    };
    elemento.addEventListener("pointermove", mover);
    elemento.addEventListener("pointerup", soltar);
  }

  function menuCamada() {
    return [
      { rotulo: "Duplicar camada", atalho: "Ctrl+D", acao: duplicarCamada },
      { rotulo: "Subir (fica por cima)", atalho: "Ctrl+↑", acao: () => moverCamada(-1) },
      { rotulo: "Descer", atalho: "Ctrl+↓", acao: () => moverCamada(1) },
      { rotulo: "Começar no cursor", atalho: "Alt+[", acao: () => cortarCamada("inicio") },
      { rotulo: "Terminar no cursor", atalho: "Alt+]", acao: () => cortarCamada("fim") },
      "-",
      { rotulo: "Apagar camada", acao: apagarCamada },
    ];
  }

  // ── Painel de propriedades ──────────────────────────────────────────

  const corpo = $("#corpo-propriedades");
  const secao = (titulo, ...filhos) => el("div", { class: "lnux-secao" }, el("h3", {}, titulo), ...filhos);

  /** Linha de propriedade animável: ⏱, nome (arraste para mudar), número e ◀ ◆ ▶. */
  function linhaAnimavel(c, p) {
    const def = PROPRIEDADES[p];
    const animada = temAnim(c, p);
    const entrada = el("input", { class: "lnux-entrada", type: "number", step: def.passo, value: Math.round(valorBase(c, p, tempo) * 100) / 100 });
    entrada.dataset.prop = p;
    const aplicar = (v, comHistorico) => {
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
      if (comHistorico) hist.marcar(def.nome);
      definir(c, p, v);
      desenharQuadro();
    };
    entrada.addEventListener("change", () => { aplicar(+entrada.value || 0, true); mudou(); });
    const rotulo = el("label", { title: "Arraste para os lados para mudar" }, def.nome);
    rotulo.addEventListener("pointerdown", (e) => {
      rotulo.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = valorBase(c, p, tempo);
      let marcado = false;
      const mover = (ev) => {
        if (!marcado) { hist.marcar(def.nome); marcado = true; }
        const v = Math.round((v0 + (ev.clientX - x0) * def.passo * (ev.shiftKey ? 10 : 1)) * 100) / 100;
        aplicar(v, false);
        entrada.value = Math.round(valorBase(c, p, tempo) * 100) / 100;
      };
      const soltar = () => { rotulo.removeEventListener("pointermove", mover); rotulo.removeEventListener("pointerup", soltar); if (marcado) mudou(); };
      rotulo.addEventListener("pointermove", mover);
      rotulo.addEventListener("pointerup", soltar);
    });
    const naChave = animada && indiceChave(c, p, tempo) >= 0;
    return el("div", { class: "prop-linha" },
      el("button", { class: "relogio" + (animada ? " ligado" : ""), type: "button", title: animada ? "Desligar a animação desta propriedade" : "Animar esta propriedade (cria um quadro-chave aqui)", html: icone("chave-quadro"), onclick: () => alternarAnimacao(c, p) }),
      rotulo, entrada,
      animada ? el("span", { class: "navegar" },
        el("button", { type: "button", title: "Quadro-chave anterior", onclick: () => irParaChave(c, p, -1) }, "◀"),
        el("button", { type: "button", class: naChave ? "na-chave" : "", title: naChave ? "Tirar o quadro-chave daqui" : "Pôr um quadro-chave aqui", onclick: () => chaveAqui(c, p) }, "◆"),
        el("button", { type: "button", title: "Próximo quadro-chave", onclick: () => irParaChave(c, p, 1) }, "▶")) : el("span"));
  }

  function campo(rotulo, entrada) { return el("div", { class: "lnux-prop" }, el("label", {}, rotulo), entrada, el("span")); }
  function numero(valorAtual, aoMudar, { passo = 1, min, max } = {}) {
    const e = el("input", { class: "lnux-entrada", type: "number", step: passo, value: valorAtual, min, max });
    e.addEventListener("change", () => { aoMudar(+e.value); });
    return e;
  }
  function selecao(valorAtual, opcoes, aoMudar) {
    const s = el("select", { class: "lnux-selecao" }, ...opcoes.map(([v, n]) => el("option", { value: v, selected: String(v) === String(valorAtual) }, n)));
    s.addEventListener("change", () => aoMudar(s.value));
    return s;
  }
  function corEntrada(valorAtual, aoMudar) {
    const e = el("input", { class: "lnux-entrada", type: "color", value: valorAtual || "#ffffff" });
    let marcado = false;
    e.addEventListener("input", () => { if (!marcado) { hist.marcar("Cor"); marcado = true; } aoMudar(e.value); desenharQuadro(); });
    e.addEventListener("change", () => { marcado = false; mudou(); });
    return e;
  }
  const comHist = (rotulo, f) => (v) => { hist.marcar(rotulo); f(v); mudou(); };

  function desenharPropriedades() {
    corpo.replaceChildren();
    const c = atual();
    const titulo = $("#titulo-propriedades");
    if (!c) { titulo.textContent = "Composição"; propriedadesDaComposicao(); return; }
    titulo.textContent = `Camada: ${c.nome}`;
    if (chaveEscolhida && chaveEscolhida.camada === c.id && c.anim[chaveEscolhida.prop] && c.anim[chaveEscolhida.prop][chaveEscolhida.i]) {
      const k = c.anim[chaveEscolhida.prop][chaveEscolhida.i];
      corpo.append(secao(`Quadro-chave: ${PROPRIEDADES[chaveEscolhida.prop].nome}`,
        campo("Tempo", numero(Math.round(k.t * 100) / 100, comHist("Tempo do quadro-chave", (v) => { k.t = limitar(quadroDe(v), 0, comp.duracao); c.anim[chaveEscolhida.prop].sort((a, b) => a.t - b.t); chaveEscolhida.i = c.anim[chaveEscolhida.prop].indexOf(k); }), { passo: 1 / comp.fps })),
        campo("Valor", numero(Math.round(k.v * 100) / 100, comHist("Valor do quadro-chave", (v) => { k.v = v; }), { passo: PROPRIEDADES[chaveEscolhida.prop].passo })),
        campo("Até o próximo", selecao(k.s, Object.entries(SUAVIZACOES).map(([id, s]) => [id, s.nome]), comHist("Suavização", (v) => { k.s = v; }))),
        el("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } },
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => irPara(k.t) }, "Ir até ele"),
          el("button", { class: "lnux-botao pequeno perigo", type: "button", onclick: apagar }, "Apagar"))));
    }
    corpo.append(secao("Camada",
      campo("Começa em", numero(Math.round(c.inicio * 100) / 100, comHist("Início", (v) => { c.inicio = limitar(quadroDe(v), 0, c.fim - 1 / comp.fps); }), { passo: 1 / comp.fps })),
      campo("Termina em", numero(Math.round(c.fim * 100) / 100, comHist("Fim", (v) => { c.fim = limitar(quadroDe(v), c.inicio + 1 / comp.fps, comp.duracao); }), { passo: 1 / comp.fps })),
      campo("Mistura", selecao(c.mistura, MISTURAS, comHist("Mistura", (v) => { c.mistura = v; })))));
    corpo.append(secao("Transformar", ...["x", "y", "escala", "rotacao", "opacidade"].map((p) => linhaAnimavel(c, p))));
    if (c.tipo === "texto") propriedadesDoTexto(c);
    if (c.tipo === "forma") propriedadesDaForma(c);
    if (c.tipo === "particulas") propriedadesDasParticulas(c);
    corpo.append(secao("Efeitos", ...(c.tipo === "forma" ? ["desenho"] : []).concat(["desfoque", "brilho", "sombra", "matiz"]).map((p) => linhaAnimavel(c, p))));
    const props = ["x", "y", "rotacao", "escala", "opacidade"];
    corpo.append(secao("Tremer (movimento aleatório suave)",
      ...props.map((p) => {
        const tr = c.tremer[p] || { amplitude: 0, frequencia: 3 };
        return el("div", { class: "prop-linha", style: { gridTemplateColumns: "minmax(70px,1fr) 70px 70px" } },
          el("label", { style: { cursor: "default" } }, PROPRIEDADES[p].nome),
          numero(tr.amplitude, comHist("Tremer", (v) => { c.tremer[p] = { ...tr, amplitude: Math.max(0, v) }; if (!v) delete c.tremer[p]; }), { passo: 1, min: 0 }),
          numero(tr.frequencia, comHist("Tremer", (v) => { c.tremer[p] = { ...tr, frequencia: Math.max(0.1, v) }; }), { passo: 0.5, min: 0.1 }));
      }),
      el("p", { class: "fraco", style: { margin: "4px 0 0" } }, "Quanto (amplitude) e quão rápido (vezes por segundo).")));
  }

  function propriedadesDoTexto(c) {
    const tx = c.texto;
    const area = el("textarea", { class: "lnux-area", rows: 2 }, tx.conteudo);
    let marcado = false;
    area.addEventListener("input", () => { if (!marcado) { hist.marcar("Texto"); marcado = true; } tx.conteudo = area.value; desenharQuadro(); });
    area.addEventListener("change", () => { marcado = false; if (c.nome === "Texto" || c.nome === "Texto novo") c.nome = area.value.split("\n")[0].slice(0, 24) || c.nome; mudou(); });
    corpo.append(secao("Texto", area,
      campo("Fonte", selecao(tx.fonte, FONTES, comHist("Fonte", (v) => { tx.fonte = v; }))),
      campo("Tamanho", numero(tx.tamanho, comHist("Tamanho do texto", (v) => { tx.tamanho = Math.max(4, v); }), { passo: 2, min: 4 })),
      campo("Peso", selecao(tx.peso, [[300, "Fino"], [400, "Normal"], [700, "Negrito"], [800, "Extra negrito"], [900, "Preto"]], comHist("Peso", (v) => { tx.peso = +v; }))),
      campo("Cor", corEntrada(tx.cor, (v) => { tx.cor = v; })),
      campo("Alinhamento", selecao(tx.alinhamento, [["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"]], comHist("Alinhamento", (v) => { tx.alinhamento = v; }))),
      campo("Espaço entre letras", numero(tx.espacamento, comHist("Espaçamento", (v) => { tx.espacamento = v; }), { passo: 1 })),
      el("label", { class: "lnux-alternar", style: { margin: "6px 0" } }, (() => { const x = el("input", { type: "checkbox", checked: tx.contorno }); x.addEventListener("change", comHist("Contorno", () => { tx.contorno = x.checked; })); return x; })(), "Contorno"),
      campo("Cor do contorno", corEntrada(tx.corContorno, (v) => { tx.corContorno = v; tx.contorno = true; })),
      campo("Animar o texto", selecao(tx.animacao, ANIM_TEXTO, comHist("Animação do texto", (v) => { tx.animacao = v; }))),
      campo("Duração da animação", numero(tx.duracaoAnim, comHist("Duração", (v) => { tx.duracaoAnim = Math.max(0.1, v); }), { passo: 0.1, min: 0.1 }))));
  }

  function propriedadesDaForma(c) {
    const f = c.forma;
    corpo.append(secao("Forma",
      campo("Tipo", selecao(f.tipo, [["retangulo", "Retângulo"], ["elipse", "Elipse"], ["estrela", "Estrela"], ["poligono", "Polígono"], ["linha", "Linha"], ["anel", "Anel"]], comHist("Tipo da forma", (v) => { f.tipo = v; if ((v === "linha" || v === "anel") && !f.espessura) f.espessura = 10; }))),
      campo("Largura", numero(f.largura, comHist("Largura", (v) => { f.largura = Math.max(1, v); }), { passo: 2 })),
      f.tipo !== "linha" ? campo("Altura", numero(f.altura, comHist("Altura", (v) => { f.altura = Math.max(1, v); }), { passo: 2 })) : null,
      f.tipo === "retangulo" ? campo("Cantos redondos", numero(f.raio, comHist("Cantos", (v) => { f.raio = Math.max(0, v); }), { passo: 1 })) : null,
      f.tipo === "estrela" || f.tipo === "poligono" ? campo("Pontas", numero(f.pontas, comHist("Pontas", (v) => { f.pontas = limitar(Math.round(v), 3, 40); }), { passo: 1 })) : null,
      campo("Preenchimento", corEntrada(f.preenchimento, (v) => { f.preenchimento = v; })),
      el("label", { class: "lnux-alternar", style: { margin: "6px 0" } }, (() => { const x = el("input", { type: "checkbox", checked: !!f.gradiente }); x.addEventListener("change", comHist("Degradê", () => { f.gradiente = x.checked ? "#a855f7" : null; })); return x; })(), "Degradê"),
      f.gradiente ? campo("Segunda cor", corEntrada(f.gradiente, (v) => { f.gradiente = v; })) : null,
      campo("Contorno", corEntrada(f.contorno, (v) => { f.contorno = v; })),
      campo("Espessura do contorno", numero(f.espessura, comHist("Espessura", (v) => { f.espessura = Math.max(0, v); }), { passo: 1, min: 0 }))));
  }

  function propriedadesDasParticulas(c) {
    const p = c.particulas;
    corpo.append(secao("Partículas",
      campo("Direção", selecao(p.direcao, [["cima", "Para cima"], ["baixo", "Para baixo"], ["direita", "Para a direita"], ["esquerda", "Para a esquerda"], ["explosao", "Explosão"], ["neve", "Neve (tela toda)"]], comHist("Direção", (v) => { p.direcao = v; }))),
      campo("Forma", selecao(p.forma, [["circulo", "Bolinhas"], ["quadrado", "Quadradinhos"], ["confete", "Confete"]], comHist("Forma", (v) => { p.forma = v; }))),
      campo("Quantidade", numero(p.quantidade, comHist("Quantidade", (v) => { p.quantidade = limitar(Math.round(v), 1, 2000); }), { passo: 10 })),
      campo("Tamanho", numero(p.tamanho, comHist("Tamanho", (v) => { p.tamanho = Math.max(1, v); }), { passo: 1 })),
      campo("Velocidade", numero(p.velocidade, comHist("Velocidade", (v) => { p.velocidade = Math.max(0, v); }), { passo: 10 })),
      campo("Vida (s)", numero(p.vida, comHist("Vida", (v) => { p.vida = Math.max(0.3, v); }), { passo: 0.1 })),
      campo("Gravidade", numero(p.gravidade, comHist("Gravidade", (v) => { p.gravidade = v; }), { passo: 10 })),
      campo("Abertura (°)", numero(p.espalhar, comHist("Abertura", (v) => { p.espalhar = limitar(v, 0, 360); }), { passo: 5 })),
      campo("Cores", el("div", { style: { display: "flex", gap: "4px" } }, ...[0, 1, 2].map((i) => corEntrada(p.cores[i] || "#ffffff", (v) => { p.cores[i] = v; })))),
      el("button", { class: "lnux-botao pequeno", type: "button", onclick: comHist("Sortear", () => { p.semente = Math.floor(Math.random() * 1e6); }) }, "Sortear de novo")));
  }

  function propriedadesDaComposicao() {
    const nome = el("input", { class: "lnux-entrada", value: comp.nome });
    nome.addEventListener("change", comHist("Nome", () => { comp.nome = nome.value.trim() || comp.nome; }));
    const tam = selecao(`${comp.largura}x${comp.altura}`, TAMANHOS.some(([v]) => v === `${comp.largura}x${comp.altura}`) ? TAMANHOS : [[`${comp.largura}x${comp.altura}`, `${comp.largura} × ${comp.altura}`], ...TAMANHOS],
      comHist("Tamanho", (v) => {
        const [w, h] = v.split("x").map(Number);
        const fx = w / comp.largura, fy = h / comp.altura;
        for (const c of comp.camadas) { // mantém as camadas no mesmo lugar relativo
          c.props.x *= fx; c.props.y *= fy;
          for (const k of c.anim.x || []) k.v *= fx;
          for (const k of c.anim.y || []) k.v *= fy;
        }
        comp.largura = w; comp.altura = h;
      }));
    corpo.append(secao("Composição",
      el("label", { class: "lnux-campo" }, el("span", {}, "Nome"), nome),
      campo("Tamanho", tam),
      campo("Quadros/s", selecao(comp.fps, [[12, "12"], [24, "24"], [25, "25"], [30, "30"], [60, "60"]], comHist("Quadros por segundo", (v) => { comp.fps = +v; }))),
      campo("Duração (s)", numero(comp.duracao, comHist("Duração", (v) => { comp.duracao = limitar(v, 0.5, 600); for (const c of comp.camadas) c.fim = Math.min(c.fim, comp.duracao); ajustarZoom.manual = false; }), { passo: 0.5, min: 0.5 })),
      campo("Fundo", corEntrada(comp.fundo, (v) => { comp.fundo = v; })),
      el("label", { class: "lnux-alternar", style: { marginTop: "6px" } }, (() => { const x = el("input", { type: "checkbox", checked: comp.transparente }); x.addEventListener("change", comHist("Fundo transparente", () => { comp.transparente = x.checked; })); return x; })(), "Fundo transparente (para PNG e GIF)")),
      secao("Como animar", el("div", { class: "fraco", html: `
        <p style="margin:0 0 6px">1. Crie uma camada (barra de cima) ou use um <b>Modelo</b>.</p>
        <p style="margin:0 0 6px">2. Escolha a camada e aplique uma <b>Animação pronta</b>, ou anime à mão: ligue o <b>◆</b> de uma propriedade, mude o cursor de lugar e mude o valor — cada mudança vira um quadro-chave.</p>
        <p style="margin:0">3. Clique num ◆ amarelo na linha do tempo para escolher a <b>suavização</b> (freando, quicando, elástico...).</p>` })));
  }

  const atualizarPropriedadesLeve = LNUX.adiar(() => {
    // só atualiza os números (não reconstrói o painel, para não perder o foco)
    const c = atual();
    if (!c) return;
    for (const entrada of corpo.querySelectorAll("input[data-prop]")) if (document.activeElement !== entrada) entrada.value = Math.round(valorBase(c, entrada.dataset.prop, tempo) * 100) / 100;
  }, 60);

  // ── Exportar ────────────────────────────────────────────────────────

  let gravando = null;
  async function renderizarQuadros(aoQuadro, { escala = 1, p, de = 0, ate = 1 }) {
    const total = Math.max(1, Math.round(comp.duracao * comp.fps));
    const temp = document.createElement("canvas");
    temp.width = Math.round(comp.largura * escala); temp.height = Math.round(comp.altura * escala);
    const tctx = temp.getContext("2d");
    for (let i = 0; i < total; i++) {
      if (p.cancelado) throw new Error("Exportação cancelada.");
      const t = i / comp.fps;
      tempo = t;
      sincronizarVideos(t, false);
      if (comp.camadas.some((c) => c.tipo === "video" && t >= c.inicio && t < c.fim)) await LNUX.esperar(60);
      motor.desenhar(comp, t);
      tctx.clearRect(0, 0, temp.width, temp.height);
      tctx.drawImage(canvas, 0, 0, temp.width, temp.height);
      await aoQuadro(temp, tctx, i, total);
      p.definir(de + (ate - de) * ((i + 1) / total), `Quadro ${i + 1} de ${total}...`);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  async function exportar() {
    pausar();
    const temFfmpeg = LNUX.ponte.tem("ffmpeg");
    const formato = el("select", { class: "lnux-selecao" },
      el("option", { value: "webm" }, "Vídeo WebM (grava enquanto toca)"),
      el("option", { value: "mp4", disabled: !temFfmpeg }, "Vídeo MP4" + (temFfmpeg ? "" : " · precisa da ponte com ffmpeg")),
      el("option", { value: "gif" }, "GIF animado (feito no navegador)"),
      el("option", { value: "png" }, "Sequência de PNG (num .zip, com transparência)"),
      el("option", { value: "quadro" }, "Só o quadro atual (PNG)"));
    const largura = el("select", { class: "lnux-selecao" }, ...[1, 0.75, 0.5, 0.33, 0.25].map((f) => el("option", { value: f, selected: f === (comp.largura > 800 ? 0.5 : 1) }, `${Math.round(comp.largura * f)} × ${Math.round(comp.altura * f)}`)));
    const linhaLargura = el("label", { class: "lnux-campo" }, el("span", {}, "Tamanho do GIF"), largura);
    const atualizar = () => { linhaLargura.hidden = formato.value !== "gif"; };
    formato.addEventListener("change", atualizar);
    atualizar();
    const ok = await LNUX.dialogo({
      titulo: "Exportar", corpo: el("div", { style: { display: "grid", gap: "12px" } }, el("label", { class: "lnux-campo" }, el("span", {}, "Formato"), formato), linhaLargura,
        el("p", { class: "fraco", style: { margin: 0 } }, `${comp.largura} × ${comp.altura} · ${comp.fps} quadros/s · ${LNUX.tempo(comp.duracao)}.` + (comp.transparente ? " O fundo transparente vale no PNG e no GIF." : ""))),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Exportar", primario: true, valor: true }],
    });
    if (!ok) return;
    const base = (comp.nome || "animacao").replace(/[\\/:*?"<>|]+/g, "_");
    const tempoAntes = tempo;
    const sel = escolhida;
    escolhida = null;
    desenharAlcas();
    let p = null; // a janela de progresso aberta (para fechar se der erro)
    try {
      if (formato.value === "quadro") {
        motor.desenhar(comp, tempo);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        await LNUX.arquivos.salvar(blob, `${base} ${LNUX.tempo(tempo).replace(/[:.]/g, "-")}.png`, { titulo: "Salvar o quadro" });
      } else if (formato.value === "gif") {
        p = LNUX.progresso("Fazendo o GIF", { aoCancelar: () => { p.cancelado = true; } });
        const esc = +largura.value;
        const gif = new LNUX.Gif(Math.round(comp.largura * esc), Math.round(comp.altura * esc), { transparente: comp.transparente });
        await renderizarQuadros((tmp, tctx) => gif.quadro(tctx.getImageData(0, 0, tmp.width, tmp.height), Math.round(100 / comp.fps)), { escala: esc, p });
        p.fechar();
        await LNUX.arquivos.salvar(gif.gerar(), base + ".gif", { titulo: "Salvar o GIF" });
      } else if (formato.value === "png") {
        p = LNUX.progresso("Fazendo os PNG", { aoCancelar: () => { p.cancelado = true; } });
        const zip = new LNUX.Zip();
        await renderizarQuadros(async (tmp, _c, i) => { zip.adicionar(`${base}_${String(i).padStart(5, "0")}.png`, await new Promise((r) => tmp.toBlob(r, "image/png"))); }, { p });
        p.definir(1, "Juntando no .zip...");
        const blob = await zip.gerar();
        p.fechar();
        await LNUX.arquivos.salvar(blob, base + " (png).zip", { titulo: "Salvar a sequência" });
      } else {
        if (!window.MediaRecorder || !canvas.captureStream) throw new Error("Este navegador não grava vídeo. Use GIF ou PNG.");
        const tipo = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
        const fluxo = canvas.captureStream(comp.fps);
        const gravador = new MediaRecorder(fluxo, { mimeType: tipo, videoBitsPerSecond: 8_000_000 });
        const pedacos = [];
        gravador.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
        p = LNUX.progresso("Gravando a animação", { aoCancelar: () => { p.cancelado = true; tocando = false; gravador.stop(); } });
        gravando = { progresso: (f) => p.definir(f * (formato.value === "mp4" ? 0.7 : 1), `Gravando... ${Math.round(f * 100)}%`) };
        const fim = new Promise((r) => { gravador.onstop = r; });
        tempo = 0;
        motor.desenhar(comp, 0);
        gravador.start(500);
        aoTerminarGravacao = () => gravador.state !== "inactive" && gravador.stop();
        tocar();
        await fim;
        gravando = null;
        aoTerminarGravacao = null;
        fluxo.getTracks().forEach((t) => t.stop());
        if (p.cancelado) throw new Error("Exportação cancelada.");
        const webm = new Blob(pedacos, { type: tipo.split(";")[0] });
        if (formato.value === "webm") { p.fechar(); await LNUX.arquivos.salvar(webm, base + (tipo.includes("mp4") ? ".mp4" : ".webm"), { titulo: "Salvar o vídeo" }); }
        else {
          p.definir(0.72, "Enviando para a ponte...");
          const { caminho } = await LNUX.ponte.temporario(webm, base + ".webm");
          const r = await LNUX.ponte.converter({ entrada: caminho, perfil: "mp4", opcoes: { crf: 20 } }, (f, t) => p.definir(0.72 + f * 0.25, t));
          const saida = await LNUX.ponte.ler(r.saida, "blob");
          p.fechar();
          await LNUX.arquivos.salvar(saida, base + ".mp4", { titulo: "Salvar o vídeo" });
        }
      }
    } catch (e) {
      if (p) p.fechar();
      LNUX.aviso(e.message, e.message.includes("cancelada") ? "info" : "erro");
    } finally {
      gravando = null;
      escolhida = sel;
      irPara(tempoAntes);
      desenharTudo();
    }
  }

  // ── Guardar e projetos ──────────────────────────────────────────────

  const guardarDepois = LNUX.adiar(async () => {
    try {
      await LNUX.guardado.gravar("efeitos:comp", JSON.stringify(comp));
      for (const [id, m] of midias) if (!guardadas.has(id) && comp.midias[id]) { await LNUX.guardado.gravar("efeitos:midia:" + id, m.blob); guardadas.add(id); }
    } catch (e) { console.warn(e); }
  }, 700);

  async function carregarComposicao(dados, buscarMidia) {
    comp = Object.assign({ midias: {}, camadas: [] }, dados);
    for (const c of comp.camadas) { c.anim = c.anim || {}; c.tremer = c.tremer || {}; }
    motor.midias.clear(); midias.clear(); guardadas.clear();
    for (const id of Object.keys(comp.midias)) {
      const blob = await buscarMidia(id);
      if (blob) await registrarMidia(id, blob);
    }
    escolhida = null; chaveEscolhida = null; tempo = 0;
    ajustarZoom.manual = false;
  }

  async function novo() {
    if (comp.camadas.length && !(await LNUX.confirmar("Nova composição", "Começar uma composição nova? A atual sai da tela (salve antes, se quiser guardar).", { rotulo: "Começar do zero" }))) return;
    novaComposicao(false);
    motor.midias.clear(); midias.clear(); guardadas.clear();
    for (const k of await LNUX.guardado.chaves("efeitos:midia:")) await LNUX.guardado.apagar(k);
    escolhida = null; chaveEscolhida = null; tempo = 0; caminhoProjeto = null;
    hist.limpar();
    mudou();
  }

  async function gerarPacote() {
    const zip = new LNUX.Zip();
    const copia = JSON.parse(JSON.stringify(comp));
    for (const [id, m] of Object.entries(copia.midias)) {
      const x = midias.get(id);
      if (x) { m.arquivo = `midias/${id}.${LNUX.extensao(m.nome) || "bin"}`; zip.adicionar(m.arquivo, x.blob); }
    }
    copia.app = "lnux-efeitos";
    zip.adicionar("composicao.json", JSON.stringify(copia, null, 2));
    return zip.gerar();
  }
  async function salvarProjeto(como) {
    try {
      const r = await LNUX.arquivos.salvar(await gerarPacote(), (comp.nome || "composicao").replace(/[\\/:*?"<>|]+/g, "_") + ".lnuxefeitos", { titulo: "Salvar composição", caminho: como ? null : caminhoProjeto });
      if (r && r !== "baixado") caminhoProjeto = r;
    } catch (e) { LNUX.erro(e); }
  }
  async function abrirProjeto() {
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Abrir composição", aceitar: ".lnuxefeitos,.zip,.json" });
    if (!arq) return;
    try {
      let dados, conteudo = null;
      if (LNUX.extensao(arq.nome) === "json") dados = JSON.parse(await arq.texto());
      else { conteudo = await LNUX.Zip.ler(await arq.blob()); const j = conteudo.get("composicao.json"); if (!j) throw new Error("Este arquivo não é uma composição do Efeitos."); dados = JSON.parse(await j.text()); }
      await carregarComposicao(dados, async (id) => (conteudo && dados.midias[id].arquivo ? conteudo.get(dados.midias[id].arquivo) : null));
      for (const m of Object.values(comp.midias)) delete m.arquivo;
      caminhoProjeto = arq.caminho && arq.caminho.endsWith(".lnuxefeitos") ? arq.caminho : null;
      hist.limpar();
      mudou();
      LNUX.aviso("Composição aberta.", "ok");
    } catch (e) { LNUX.erro(e); }
  }

  // ── Mudanças ────────────────────────────────────────────────────────

  function desenharTudo() {
    desenharQuadro();
    desenharLinha();
    desenharPropriedades();
  }
  function mudou() {
    $("#titulo-doc").textContent = comp.nome;
    tempo = limitar(tempo, 0, comp.duracao);
    ajustarVisor();
    mostrarTempo();
    desenharTudo();
    guardarDepois();
  }
  document.addEventListener("lnux:tema", () => desenharLinha());

  // ── Menus ───────────────────────────────────────────────────────────

  const temCamada = () => !!atual();
  const menus = [
    { rotulo: "Arquivo", itens: [
      { rotulo: "Nova composição", atalho: "Alt+N", acao: novo },
      { rotulo: "Abrir composição...", atalho: "Ctrl+O", acao: abrirProjeto },
      { rotulo: "Salvar composição", atalho: "Ctrl+S", acao: () => salvarProjeto(false) },
      { rotulo: "Salvar composição como...", atalho: "Ctrl+Shift+S", acao: () => salvarProjeto(true) },
      "-",
      { rotulo: "Exportar (vídeo, GIF, PNG)...", atalho: "Ctrl+E", acao: exportar },
    ] },
    { rotulo: "Editar", itens: [
      { rotulo: "Desfazer", atalho: "Ctrl+Z", acao: () => hist.desfazer(), ativo: () => hist.podeDesfazer() },
      { rotulo: "Refazer", atalho: ["Ctrl+Shift+Z", "Ctrl+Y"], acao: () => hist.refazer(), ativo: () => hist.podeRefazer() },
      "-",
      { rotulo: "Apagar (quadro-chave ou camada)", atalho: ["Del", "Backspace"], acao: apagar, ativo: temCamada },
      { rotulo: "Duplicar camada", atalho: "Ctrl+D", acao: duplicarCamada, ativo: temCamada },
      { rotulo: "Subir a camada", atalho: "Ctrl+↑", acao: () => moverCamada(-1), ativo: temCamada },
      { rotulo: "Descer a camada", atalho: "Ctrl+↓", acao: () => moverCamada(1), ativo: temCamada },
      { rotulo: "Camada começa no cursor", atalho: "Alt+[", acao: () => cortarCamada("inicio"), ativo: temCamada },
      { rotulo: "Camada termina no cursor", atalho: "Alt+]", acao: () => cortarCamada("fim"), ativo: temCamada },
      { rotulo: "Tirar a escolha", atalho: "Esc", acao: () => { escolhida = null; chaveEscolhida = null; desenharTudo(); } },
    ] },
    { rotulo: "Camada", itens: [
      { rotulo: "Novo texto", atalho: "T", acao: criar.texto },
      { rotulo: "Novo retângulo", acao: criar.retangulo },
      { rotulo: "Nova elipse", acao: criar.elipse },
      { rotulo: "Nova estrela", acao: criar.estrela },
      { rotulo: "Nova linha (que se desenha)", acao: criar.linha },
      { rotulo: "Novas partículas", acao: criar.particulas },
      { rotulo: "Imagem ou vídeo...", atalho: "Ctrl+I", acao: criar.midia },
      "-",
      ...Object.entries(MODELOS).map(([id, nome]) => ({ rotulo: "Modelo: " + nome, acao: () => aplicarModelo(id) })),
    ] },
    { rotulo: "Animar", itens: [
      ...Object.entries(PRONTAS).map(([id, nome]) => ({ rotulo: nome, ativo: temCamada, acao: () => aplicarPronta(atual(), id) })),
      "-",
      { rotulo: "Quadro-chave anterior", atalho: "J", acao: () => atual() && irParaChave(atual(), null, -1), ativo: temCamada },
      { rotulo: "Próximo quadro-chave", atalho: "K", acao: () => atual() && irParaChave(atual(), null, 1), ativo: temCamada },
      { rotulo: "Tirar todas as animações da camada", ativo: temCamada, acao: () => { const c = atual(); hist.marcar("Tirar animações"); for (const p of Object.keys(c.anim)) c.props[p] = valorBase(c, p, tempo); c.anim = {}; c.tremer = {}; mudou(); } },
    ] },
    { rotulo: "Reproduzir", itens: [
      { rotulo: "Tocar / pausar", atalho: "Espaço", acao: alternarPlay },
      { rotulo: "Quadro anterior", atalho: "←", acao: () => irPara(tempo - 1 / comp.fps) },
      { rotulo: "Próximo quadro", atalho: "→", acao: () => irPara(tempo + 1 / comp.fps) },
      { rotulo: "Voltar 1 segundo", atalho: "Shift+←", acao: () => irPara(tempo - 1) },
      { rotulo: "Avançar 1 segundo", atalho: "Shift+→", acao: () => irPara(tempo + 1) },
      { rotulo: "Início", atalho: "Home", acao: () => irPara(0) },
      { rotulo: "Fim", atalho: "End", acao: () => irPara(comp.duracao) },
    ] },
    { rotulo: "Exibir", itens: [
      { rotulo: "Linha do tempo: aproximar", atalho: ["=", "Mais"], acao: () => { ajustarZoom.manual = true; pxs *= 1.4; desenharLinha(); } },
      { rotulo: "Linha do tempo: afastar", atalho: "-", acao: () => { ajustarZoom.manual = true; pxs = Math.max(10, pxs / 1.4); desenharLinha(); } },
      { rotulo: "Linha do tempo: caber tudo", atalho: "0", acao: () => { ajustarZoom.manual = false; desenharLinha(); } },
      "-",
      { rotulo: "Layout: padrão", acao: () => LNUX.layout.definir("padrao"), marcado: () => LNUX.layout.atual() === "padrao" },
      { rotulo: "Layout: animação", acao: () => LNUX.layout.definir("animacao"), marcado: () => LNUX.layout.atual() === "animacao" },
      { rotulo: "Layout: visor grande", acao: () => LNUX.layout.definir("visor"), marcado: () => LNUX.layout.atual() === "visor" },
      { rotulo: "Layout: celular", acao: () => LNUX.layout.definir("celular"), marcado: () => LNUX.layout.atual() === "celular" },
    ] },
    { rotulo: "Ajuda", itens: [
      { rotulo: "Atalhos de teclado", acao: () => LNUX.ajudaAtalhos() },
      { rotulo: "Sobre o Efeitos", acao: () => LNUX.sobre() },
    ] },
  ];

  for (const b of document.querySelectorAll("#abas-celular button")) {
    b.addEventListener("click", () => {
      document.documentElement.dataset.aba = b.dataset.aba;
      for (const x of document.querySelectorAll("#abas-celular button")) x.setAttribute("aria-selected", String(x === b));
      setTimeout(() => { desenharLinha(); ajustarVisor(); }, 20);
    });
  }
  document.documentElement.dataset.aba = "linha";

  // ── Começo ──────────────────────────────────────────────────────────

  $("#marca-icone").innerHTML = icone("efeito");
  novaComposicao(true);
  LNUX.iniciar({
    app: "efeitos", nome: "Efeitos",
    descricao: "Animação de títulos e gráficos: camadas de texto, forma, partículas, imagem e vídeo, quadros-chave com suavização, animações prontas, efeitos e modos de mistura. Exporta em WebM, MP4, GIF e PNG.",
    inspirado: { nome: "EffectCraft", url: "https://github.com/storytold/effectcraft", autores: "ArtCraft Team e os colaboradores do EffectCraft" },
    layouts: [
      { id: "padrao", nome: "Padrão", descricao: "Visor, propriedades e camadas", icone: "layout" },
      { id: "animacao", nome: "Animação", descricao: "Linha do tempo alta, para mexer nos quadros-chave", icone: "chave-quadro" },
      { id: "visor", nome: "Visor grande", descricao: "Mais espaço para ver a animação", icone: "tela" },
      { id: "celular", nome: "Celular", descricao: "Visor em cima e abas embaixo", icone: "tela", celular: true },
    ],
    aoMudarLayout: () => setTimeout(() => { desenharLinha(); ajustarVisor(); }, 30),
    menus,
  }).then(async () => {
    const salvo = await LNUX.guardado.ler("efeitos:comp");
    if (salvo) {
      try {
        await carregarComposicao(JSON.parse(salvo), async (id) => { const b = await LNUX.guardado.ler("efeitos:midia:" + id); if (b) guardadas.add(id); return b; });
        LNUX.aviso("Composição recuperada de onde você parou.", "ok");
      } catch (e) { console.warn(e); novaComposicao(true); }
    }
    mudou();
  });
  mudou();

  window.Efeitos = { get comp() { return comp; }, motor, aplicarPronta, aplicarModelo, irPara, criar, definir, gerarPacote, valor, get tempo() { return tempo; }, exportar };
})();
