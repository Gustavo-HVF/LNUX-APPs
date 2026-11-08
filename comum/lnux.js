/*
 * LNUX-APPs — biblioteca comum a todos os apps (só JavaScript do navegador, sem dependências).
 *
 * O que tem aqui:
 *   • temas (claro, escuro, sépia, oceano, alto contraste e "do sistema"), densidade e layout de cada app,
 *     salvos no navegador e trocados pela janela "Aparência";
 *   • barra de menus com atalhos de teclado e paleta de comandos (Ctrl+Shift+P);
 *   • diálogos, avisos, divisores arrastáveis entre painéis e histórico de desfazer/refazer;
 *   • o cliente da PONTE LOCAL (servidor/lnux_apps.py): com ela, os apps abrem e salvam arquivos nas pastas do
 *     aparelho, convertem com o ffmpeg e usam bateria, área de transferência, notificações...; sem ela, os apps
 *     continuam funcionando só com o que o navegador oferece;
 *   • abrir e salvar arquivos (pelo navegador ou pelas pastas, via ponte) e um guardado no IndexedDB.
 *
 * Uso num app:
 *   <link rel="stylesheet" href="../../comum/lnux.css">
 *   <script src="../../comum/lnux.js"></script>
 *   LNUX.iniciar({ app: "video", nome: "Vídeo", layouts: [...], menus: [...] })
 */
(function () {
  "use strict";

  const LNUX = {};
  window.LNUX = LNUX;

  // ── Utilidades ──────────────────────────────────────────────────────

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));
  LNUX.$ = $;
  LNUX.$$ = $$;

  /** Cria um elemento: el("button", {class: "lnux-botao", onclick: f}, "texto", outroElemento) */
  function el(tag, atributos, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(atributos || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (k === "dataset") Object.assign(e.dataset, v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    }
    for (const f of filhos.flat()) {
      if (f === undefined || f === null || f === false) continue;
      e.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return e;
  }
  LNUX.el = el;

  LNUX.escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  LNUX.limitar = (v, min, max) => Math.min(max, Math.max(min, v));
  LNUX.id = (prefixo = "id") => prefixo + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  LNUX.esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  LNUX.adiar = function (funcao, ms = 250) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => funcao.apply(this, args), ms);
    };
  };

  /** 75.5 → "01:15.50"; com fps → "00:01:15:15" (timecode) */
  LNUX.tempo = function (segundos, fps) {
    if (!isFinite(segundos)) segundos = 0;
    const negativo = segundos < 0;
    segundos = Math.abs(segundos);
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = Math.floor(segundos % 60);
    const d2 = (n) => String(n).padStart(2, "0");
    let texto;
    if (fps) {
      const q = Math.floor((segundos - Math.floor(segundos)) * fps + 1e-6);
      texto = `${d2(h)}:${d2(m)}:${d2(s)}:${d2(q)}`;
    } else {
      const cs = Math.floor((segundos - Math.floor(segundos)) * 100 + 1e-6);
      texto = (h ? `${h}:` : "") + `${d2(m)}:${d2(s)}.${d2(cs)}`;
    }
    return (negativo ? "-" : "") + texto;
  };

  LNUX.bytes = function (n) {
    if (!isFinite(n)) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)).toString().replace(".", ",") + " " + u[i];
  };

  /** Baixa um Blob (ou texto) como arquivo pelo navegador. */
  LNUX.baixar = function (dados, nome, tipo = "application/octet-stream") {
    const blob = dados instanceof Blob ? dados : new Blob([dados], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: nome });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  LNUX.nomeSemExtensao = (nome) => String(nome).replace(/\.[^./\\]+$/, "");
  LNUX.extensao = (nome) => (String(nome).match(/\.([^./\\]+)$/) || [, ""])[1].toLowerCase();

  // ── Ícones (desenhos próprios, traço de 24×24) ──────────────────────

  const ICONES = {
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    pausa: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    parar: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none"/>',
    gravar: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
    inicio: '<path d="M6 5v14"/><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
    fim: '<path d="M18 5v14"/><path d="M5 5.5v13L15 12z" fill="currentColor" stroke="none"/>',
    voltar: '<path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/>',
    avancar: '<path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/>',
    repetir: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    cortar: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.2 8.2L20 20"/><path d="M8.2 15.8L20 4"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    lixo: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    desfazer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    refazer: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    ima: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/><path d="M10 3v8a2 2 0 0 0 4 0V3"/>',
    "zoom-mais": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
    "zoom-menos": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
    pasta: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    arquivo: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    abrir: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v1"/><path d="M3 19l3-8h16l-3 8z"/>',
    salvar: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>',
    exportar: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/>',
    importar: '<path d="M12 15V3"/><path d="M7 10l5 5 5-5"/><path d="M5 14v6h14v-6"/>',
    microfone: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
    texto: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    forma: '<rect x="3.5" y="10" width="10" height="10" rx="1"/><circle cx="15.5" cy="8.5" r="5"/>',
    retangulo: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    elipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    estrela: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>',
    cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
    olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    "olho-fechado": '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.9"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    cadeado: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "cadeado-aberto": '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
    mudo: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    aparencia: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M9 9v11"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "seta-cima": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "seta-esquerda": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    casa: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    musica: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="1.5"/><path d="M16 10l5-3v10l-5-3z"/>',
    imagem: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 8.5"/>',
    camadas: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    "chave-quadro": '<path d="M12 4l8 8-8 8-8-8z"/>',
    metronomo: '<path d="M9 3h6l4 18H5z"/><path d="M12 15l5-9"/>',
    onda: '<path d="M2 12h2l2-6 3 12 3-14 3 16 3-10 2 2h2"/>',
    mixer: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" fill="currentColor"/><rect x="10" y="7" width="4" height="3" fill="currentColor"/><rect x="16" y="11" width="4" height="3" fill="currentColor"/>',
    bandeira: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    duplicar: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    efeito: '<path d="M5 19L19 5"/><path d="M15 3v4M13 5h4M5 7v3M3.5 8.5h3M18 15v4M16 17h4"/>',
    cor: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    ponte: '<path d="M3 17h18"/><path d="M5 17V11a7 7 0 0 1 14 0v6"/><path d="M9 17v-5M15 17v-5M12 17v-6"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    comando: '<path d="M5 7l5 5-5 5"/><path d="M12 18h7"/>',
    tela: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
    particulas: '<circle cx="6" cy="7" r="1.5" fill="currentColor"/><circle cx="17" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="7" cy="18" r="1.5" fill="currentColor"/><circle cx="18" cy="16" r="1.5" fill="currentColor"/>',
    legenda: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 14h4M13 14h4M7 10h10"/>',
    ia: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  };

  /** HTML de um ícone; LNUX.icone("play") */
  LNUX.icone = function (nome, classe = "") {
    const corpo = ICONES[nome] || ICONES.info;
    return `<svg class="${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
  };
  LNUX.iconeEl = (nome) => {
    const s = document.createElement("span");
    s.innerHTML = LNUX.icone(nome);
    return s.firstChild;
  };

  /** Botão com ícone e dica: LNUX.botaoIcone("play", "Tocar (Espaço)", aoClicar) */
  LNUX.botaoIcone = function (icone, dica, aoClicar, classes = "plano") {
    const b = el("button", { class: `lnux-botao icone ${classes}`, title: dica, "aria-label": dica, type: "button" });
    b.innerHTML = LNUX.icone(icone);
    if (aoClicar) b.addEventListener("click", aoClicar);
    return b;
  };

  // ── Temas, densidade e layout ───────────────────────────────────────

  LNUX.temas = [
    { id: "sistema", nome: "Do sistema", cores: ["#ffffff", "#16181d", "#5b9dff"] },
    { id: "escuro", nome: "Escuro", cores: ["#16181d", "#262a33", "#5b9dff"] },
    { id: "claro", nome: "Claro", cores: ["#eef0f3", "#ffffff", "#2f6fe4"] },
    { id: "sepia", nome: "Sépia", cores: ["#ece2cf", "#f7efdf", "#a5582a"] },
    { id: "oceano", nome: "Oceano", cores: ["#0b1724", "#15293b", "#2cc7c0"] },
    { id: "contraste", nome: "Alto contraste", cores: ["#000000", "#1a1a1a", "#ffd400"] },
  ];
  LNUX.densidades = [
    { id: "compacta", nome: "Compacta" },
    { id: "normal", nome: "Normal" },
    { id: "confortavel", nome: "Confortável (toque)" },
  ];

  function lerPreferencia(chave, padrao) {
    try { return localStorage.getItem(chave) ?? padrao; } catch (e) { return padrao; }
  }
  function gravarPreferencia(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* navegador sem armazenamento: só não lembra */ }
  }
  LNUX.preferencia = { ler: lerPreferencia, gravar: gravarPreferencia };

  const escuroDoSistema = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  LNUX.tema = {
    escolhido: () => lerPreferencia("lnux.tema", "sistema"),
    /** O tema que está valendo de fato (resolve "sistema" para claro ou escuro). */
    atual() {
      const t = this.escolhido();
      if (t !== "sistema") return t;
      return escuroDoSistema && !escuroDoSistema.matches ? "claro" : "escuro";
    },
    definir(id) {
      gravarPreferencia("lnux.tema", id);
      this.aplicar();
    },
    aplicar() {
      document.documentElement.dataset.tema = this.atual();
      document.dispatchEvent(new CustomEvent("lnux:tema", { detail: this.atual() }));
    },
    /** Lê uma cor do tema atual: LNUX.tema.cor("--destaque") */
    cor(variavel) {
      return getComputedStyle(document.documentElement).getPropertyValue(variavel).trim();
    },
  };
  if (escuroDoSistema) escuroDoSistema.addEventListener("change", () => LNUX.tema.escolhido() === "sistema" && LNUX.tema.aplicar());
  // Outra aba trocou o tema: acompanha
  window.addEventListener("storage", (e) => {
    if (e.key === "lnux.tema") LNUX.tema.aplicar();
    if (e.key === "lnux.densidade") LNUX.densidade.aplicar();
  });

  LNUX.densidade = {
    atual: () => lerPreferencia("lnux.densidade", "normal"),
    definir(id) { gravarPreferencia("lnux.densidade", id); this.aplicar(); },
    aplicar() { document.documentElement.dataset.densidade = this.atual(); },
  };

  // Aplica já, antes de o app desenhar a tela (evita piscar no tema errado)
  LNUX.tema.aplicar();
  LNUX.densidade.aplicar();

  const config = { app: "lnux", nome: "LNUX", layouts: [], aoMudarLayout: null };

  LNUX.layout = {
    atual() {
      const salvo = lerPreferencia("lnux.layout." + config.app, "");
      if (salvo && config.layouts.some((l) => l.id === salvo)) return salvo;
      const celular = config.layouts.find((l) => l.celular);
      if (celular && window.innerWidth < 760) return celular.id;
      return config.layouts[0] ? config.layouts[0].id : "padrao";
    },
    definir(id) {
      gravarPreferencia("lnux.layout." + config.app, id);
      this.aplicar();
    },
    aplicar() {
      const id = this.atual();
      document.documentElement.dataset.layout = id;
      if (config.aoMudarLayout) config.aoMudarLayout(id);
      document.dispatchEvent(new CustomEvent("lnux:layout", { detail: id }));
    },
  };

  /** Janela "Aparência": tema, densidade e layout do app. */
  LNUX.aparencia = function () {
    const temas = el("div", { class: "lnux-temas" });
    const desenharTemas = () => {
      temas.replaceChildren(...LNUX.temas.map((t) =>
        el("button", {
          class: "lnux-tema-opcao", type: "button", "aria-pressed": String(LNUX.tema.escolhido() === t.id),
          onclick: () => { LNUX.tema.definir(t.id); desenharTemas(); },
        }, el("span", { class: "amostra" }, ...t.cores.map((c) => el("span", { style: { background: c } }))), t.nome)));
    };
    desenharTemas();

    const densidade = el("div", { class: "lnux-segmentos" });
    const desenharDensidade = () => densidade.replaceChildren(...LNUX.densidades.map((d) =>
      el("button", { type: "button", "aria-pressed": String(LNUX.densidade.atual() === d.id), onclick: () => { LNUX.densidade.definir(d.id); desenharDensidade(); } }, d.nome)));
    desenharDensidade();

    const layouts = el("div", { class: "lnux-layouts" });
    const desenharLayouts = () => layouts.replaceChildren(...config.layouts.map((l) =>
      el("button", {
        class: "lnux-layout-opcao", type: "button", "aria-pressed": String(LNUX.layout.atual() === l.id),
        onclick: () => { LNUX.layout.definir(l.id); desenharLayouts(); },
      }, el("span", { html: LNUX.icone(l.icone || "layout") }), el("span", {}, l.nome, l.descricao ? el("small", {}, l.descricao) : null))));
    desenharLayouts();

    const corpo = el("div", { style: { display: "grid", gap: "16px" } },
      el("div", { class: "lnux-campo" }, el("span", {}, "Tema (vale para todos os apps)"), temas),
      el("div", { class: "lnux-campo" }, el("span", {}, "Tamanho dos controles"), densidade),
      config.layouts.length ? el("div", { class: "lnux-campo" }, el("span", {}, "Layout deste app"), layouts) : null);
    return LNUX.dialogo({ titulo: "Aparência", corpo, botoes: [{ rotulo: "Fechar", primario: true }] });
  };

  // ── Avisos e diálogos ───────────────────────────────────────────────

  let caixaAvisos = null;
  /** Aviso rápido no canto: LNUX.aviso("Salvo", "ok"); tipos: info, ok, erro, alerta */
  LNUX.aviso = function (mensagem, tipo = "info", ms) {
    if (!caixaAvisos) {
      caixaAvisos = el("div", { class: "lnux-avisos", role: "status", "aria-live": "polite" });
      document.body.append(caixaAvisos);
    }
    const fechar = () => item.remove();
    const item = el("div", { class: `lnux-aviso ${tipo}` }, el("div", {}, mensagem),
      el("button", { class: "lnux-botao icone pequeno plano", "aria-label": "Fechar", onclick: fechar, html: LNUX.icone("fechar") }));
    caixaAvisos.append(item);
    setTimeout(fechar, ms ?? (tipo === "erro" ? 9000 : 4000));
    return item;
  };
  LNUX.erro = (e) => {
    console.error(e);
    LNUX.aviso(e && e.message ? e.message : String(e), "erro");
  };

  /**
   * Janela modal. Devolve uma Promise com o "valor" do botão apertado (ou null se fechou).
   *   LNUX.dialogo({titulo, corpo: elemento|texto, largo, botoes: [{rotulo, valor, primario, perigo, antes(): bool}]})
   * O objeto devolvido também tem .fechar(valor) e .elemento.
   */
  LNUX.dialogo = function ({ titulo, corpo, botoes = [{ rotulo: "OK", valor: true, primario: true }], largo = false, aoAbrir }) {
    let resolver;
    const promessa = new Promise((r) => (resolver = r));
    const anterior = document.activeElement;
    const fundo = el("div", { class: "lnux-fundo-modal" });
    const caixa = el("div", { class: "lnux-dialogo" + (largo ? " largo" : ""), role: "dialog", "aria-modal": "true", "aria-label": titulo });
    const fechar = (valor = null) => {
      fundo.remove();
      document.removeEventListener("keydown", teclas, true);
      if (anterior && anterior.focus) anterior.focus();
      resolver(valor);
    };
    const teclas = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); fechar(null); }
      // Enter aperta o botão principal, a não ser num campo que trata o próprio Enter (data-enter-proprio)
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON" && !(e.target.closest && e.target.closest("[data-enter-proprio]"))) {
        const principal = caixa.querySelector("footer .primario");
        if (principal) { e.preventDefault(); e.stopPropagation(); principal.click(); }
      }
    };
    const rodape = el("footer");
    for (const b of botoes) {
      if (b === "espaco") { rodape.append(el("span", { class: "espaco" })); continue; }
      rodape.append(el("button", {
        class: "lnux-botao" + (b.primario ? " primario" : "") + (b.perigo ? " perigo" : ""), type: "button",
        onclick: async () => {
          if (b.antes && (await b.antes()) === false) return;
          fechar(b.valor === undefined ? true : (typeof b.valor === "function" ? b.valor() : b.valor));
        },
      }, b.rotulo));
    }
    caixa.append(
      el("header", {}, el("h2", {}, titulo), el("button", { class: "lnux-botao icone plano", "aria-label": "Fechar", onclick: () => fechar(null), html: LNUX.icone("fechar") })),
      el("div", { class: "corpo" }, corpo instanceof Node ? corpo : el("p", { style: { margin: 0 } }, corpo ?? "")),
      botoes.length ? rodape : null);
    fundo.append(caixa);
    fundo.addEventListener("pointerdown", (e) => { if (e.target === fundo) fechar(null); });
    document.addEventListener("keydown", teclas, true);
    document.body.append(fundo);
    setTimeout(() => {
      const foco = caixa.querySelector("[autofocus]") || caixa.querySelector(".corpo input, .corpo select, .corpo textarea") || caixa.querySelector("footer .primario");
      if (foco) foco.focus();
      if (aoAbrir) aoAbrir(caixa);
    }, 0);
    promessa.fechar = fechar;
    promessa.elemento = caixa;
    return promessa;
  };

  LNUX.confirmar = (titulo, texto, { rotulo = "Continuar", perigo = false } = {}) =>
    LNUX.dialogo({ titulo, corpo: texto, botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo, valor: true, primario: true, perigo }] }).then((v) => v === true);

  LNUX.perguntar = function (titulo, { rotulo = "", valor = "", tipo = "text", dica = "" } = {}) {
    const entrada = el("input", { class: "lnux-entrada", type: tipo, value: valor, autofocus: true });
    const corpo = el("label", { class: "lnux-campo" }, rotulo ? el("span", {}, rotulo) : null, entrada, dica ? el("small", { class: "fraco" }, dica) : null);
    setTimeout(() => entrada.select(), 10);
    return LNUX.dialogo({ titulo, corpo, botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "OK", primario: true, valor: () => entrada.value }] });
  };

  /** Janela com barra de progresso: const p = LNUX.progresso("Exportando"); p.definir(0.5, "texto"); p.fechar() */
  LNUX.progresso = function (titulo, { aoCancelar } = {}) {
    const barra = el("div");
    const texto = el("div", { class: "fraco" }, "Preparando...");
    const d = LNUX.dialogo({
      titulo, corpo: el("div", { style: { display: "grid", gap: "10px" } }, el("div", { class: "lnux-progresso" }, barra), texto),
      botoes: aoCancelar ? [{ rotulo: "Cancelar", valor: "cancelar" }] : [],
    });
    d.then((v) => { if (v === "cancelar" || (v === null && aoCancelar)) aoCancelar && aoCancelar(); });
    return {
      definir(fracao, mensagem) {
        if (fracao !== null && fracao !== undefined) barra.style.width = (LNUX.limitar(fracao, 0, 1) * 100).toFixed(1) + "%";
        if (mensagem) texto.textContent = mensagem;
      },
      fechar: () => d.fechar("fim"),
    };
  };

  // ── Menus, atalhos e paleta de comandos ─────────────────────────────

  const comandos = []; // {grupo, rotulo, atalho, acao, ativo}
  const atalhos = new Map(); // "ctrl+shift+z" → comando
  const ehMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function normalizarAtalho(texto) {
    return texto.toLowerCase().split("+").map((p) => p.trim()).map((p) => (p === "cmd" || p === "meta" ? "ctrl" : p)).sort((a, b) => {
      const ordem = ["ctrl", "alt", "shift"];
      const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
    }).join("+");
  }
  function atalhoDoEvento(e) {
    const partes = [];
    if (e.ctrlKey || e.metaKey) partes.push("ctrl");
    if (e.altKey) partes.push("alt");
    if (e.shiftKey) partes.push("shift");
    let tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    // Nomes como aparecem nos atalhos dos apps ("Espaço", "←", "Del", "Mais"); o "+" vira "mais" porque o
    // próprio "+" separa as teclas do atalho
    const nomes = { " ": "espaço", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", delete: "del", escape: "esc", "+": "mais" };
    tecla = nomes[tecla] || tecla;
    if (["control", "shift", "alt", "meta"].includes(tecla)) return "";
    // Com shift, e.key vira o símbolo ("?" em vez de "/"); usa o código físico para letras e números
    if (e.shiftKey && /^Key[A-Z]$/.test(e.code)) tecla = e.code.slice(3).toLowerCase();
    if (e.shiftKey && /^Digit\d$/.test(e.code)) tecla = e.code.slice(5);
    partes.push(tecla);
    return partes.join("+");
  }
  LNUX.mostrarAtalho = (texto) => (texto ? (ehMac ? texto.replace(/Ctrl\+/gi, "⌘").replace(/Alt\+/gi, "⌥").replace(/Shift\+/gi, "⇧") : texto) : "");

  /** Registra um comando (aparece na paleta e, se tiver atalho, responde ao teclado). */
  LNUX.comando = function (c) {
    comandos.push(c);
    if (c.atalho) for (const a of [].concat(c.atalho)) atalhos.set(normalizarAtalho(a), c);
    return c;
  };

  function campoEditavel(alvo) {
    return alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) && !(alvo.type === "range" || alvo.type === "checkbox" || alvo.type === "button");
  }

  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".lnux-fundo-modal, .lnux-paleta")) return; // janela aberta: ela cuida do teclado
    const chave = atalhoDoEvento(e);
    if (!chave) return;
    const c = atalhos.get(chave);
    if (!c) return;
    // Enter e Espaço num botão ou link com foco são do botão (apertá-lo), não do atalho
    if ((chave === "enter" || chave === "espaço") && e.target.closest && e.target.closest("button, a, summary")) return;
    // Num campo de texto, só os atalhos com Ctrl/Alt (e os marcados como "global") passam
    if (campoEditavel(e.target) && !c.global && !/ctrl|alt/.test(chave)) return;
    if (campoEditavel(e.target) && ["ctrl+z", "ctrl+y", "ctrl+shift+z", "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+x"].includes(chave) && !c.global) return;
    if (c.ativo && !c.ativo()) return;
    e.preventDefault();
    try { c.acao(e); } catch (erro) { LNUX.erro(erro); }
  });

  let menuAberto = null;
  function fecharMenu() {
    if (!menuAberto) return;
    menuAberto.menu.remove();
    menuAberto.botao.setAttribute("aria-expanded", "false");
    menuAberto = null;
  }
  document.addEventListener("pointerdown", (e) => {
    if (menuAberto && !menuAberto.menu.contains(e.target) && !menuAberto.botao.contains(e.target)) fecharMenu();
  });
  window.addEventListener("blur", fecharMenu);
  window.addEventListener("resize", fecharMenu);

  /** Abre um menu solto (também usado como menu de contexto) na posição x, y. */
  LNUX.abrirMenu = function (itens, x, y, botao) {
    fecharMenu();
    const menu = el("div", { class: "lnux-menu", role: "menu" });
    for (const item of itens) {
      if (item === "-") { menu.append(el("hr")); continue; }
      if (item.grupo) { menu.append(el("div", { class: "titulo-grupo" }, item.grupo)); continue; }
      const ativo = item.ativo ? item.ativo() : true;
      const marcado = item.marcado ? item.marcado() : false;
      menu.append(el("button", {
        type: "button", role: "menuitem", disabled: !ativo,
        onclick: () => { fecharMenu(); try { item.acao(); } catch (erro) { LNUX.erro(erro); } },
      }, el("span", { class: "marca" }, marcado ? "✓" : ""), el("span", { class: "rotulo" }, item.rotulo), el("span", { class: "atalho" }, LNUX.mostrarAtalho([].concat(item.atalho || [])[0] || ""))));
    }
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";
    menuAberto = { menu, botao: botao || menu };
    if (botao) botao.setAttribute("aria-expanded", "true");
    menu.addEventListener("keydown", (e) => {
      const botoes = $$("button:not(:disabled)", menu);
      const i = botoes.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (botoes[i + 1] || botoes[0]).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (botoes[i - 1] || botoes[botoes.length - 1]).focus(); }
      if (e.key === "Escape") { fecharMenu(); botao && botao.focus(); }
    });
    return menu;
  };

  /**
   * Monta a barra de menus. definicao = [{rotulo: "Arquivo", itens: [{rotulo, atalho, acao, ativo, marcado}, "-", ...]}]
   * Cada item vira também um comando da paleta e um atalho de teclado.
   */
  LNUX.menus = function (barra, definicao) {
    barra.classList.add("lnux-menubar");
    // Em tela estreita (celular), os menus viram um botão só (☰) com todos os grupos dentro
    const compacto = el("button", { type: "button", class: "lnux-menu-compacto", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": "Menu" }, "☰ Menu");
    compacto.addEventListener("click", () => {
      if (menuAberto && menuAberto.botao === compacto) { fecharMenu(); return; }
      const itens = [];
      for (const m of definicao) itens.push({ grupo: m.rotulo }, ...m.itens.filter((i) => i !== "-"));
      const r = compacto.getBoundingClientRect();
      LNUX.abrirMenu(itens, r.left, r.bottom + 2, compacto);
    });
    barra.append(compacto);
    for (const m of definicao) {
      for (const item of m.itens) if (item !== "-" && !item.grupo && !item.semComando) LNUX.comando({ ...item, grupo: m.rotulo });
      const botao = el("button", { type: "button", "aria-haspopup": "true", "aria-expanded": "false" }, m.rotulo);
      const abrir = () => {
        const r = botao.getBoundingClientRect();
        const menu = LNUX.abrirMenu(m.itens, r.left, r.bottom + 2, botao);
        const primeiro = menu.querySelector("button:not(:disabled)");
        return primeiro;
      };
      botao.addEventListener("click", () => (menuAberto && menuAberto.botao === botao ? fecharMenu() : abrir()));
      botao.addEventListener("pointerenter", () => { if (menuAberto && menuAberto.botao !== botao && barra.contains(menuAberto.botao)) abrir(); });
      botao.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); const p = abrir(); p && p.focus(); } });
      barra.append(botao);
    }
  };

  /** Paleta de comandos (Ctrl+Shift+P ou F1): procura qualquer comando pelo nome. */
  LNUX.paleta = function (extras = []) {
    if (document.querySelector(".lnux-paleta")) return;
    const lista = [...comandos, ...extras].filter((c) => c.rotulo && c.acao);
    const fundo = el("div", { class: "lnux-fundo-modal", style: { background: "rgba(0,0,0,.25)" } });
    const caixa = el("div", { class: "lnux-paleta", role: "dialog", "aria-label": "Paleta de comandos" });
    const entrada = el("input", { placeholder: "Digite um comando...", "aria-label": "Comando" });
    const ul = el("ul", { role: "listbox" });
    caixa.append(entrada, ul);
    let achados = [], escolhido = 0;
    const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const desenhar = () => {
      const q = semAcento(entrada.value.trim());
      achados = lista.filter((c) => !c.ativo || c.ativo()).filter((c) => !q || q.split(/\s+/).every((p) => semAcento(`${c.grupo || ""} ${c.rotulo}`).includes(p))).slice(0, 60);
      escolhido = Math.min(escolhido, Math.max(0, achados.length - 1));
      ul.replaceChildren(...achados.map((c, i) => el("li", {
        class: i === escolhido ? "ativo" : "", role: "option",
        onpointerdown: (e) => { e.preventDefault(); executar(i); },
      }, c.grupo ? el("span", { class: "grupo" }, c.grupo + ":") : null, el("span", {}, c.rotulo), el("span", { class: "atalho" }, LNUX.mostrarAtalho([].concat(c.atalho || [])[0] || "")))));
      if (!achados.length) ul.append(el("li", { class: "fraco" }, "Nenhum comando com esse nome."));
      const ativo = ul.querySelector(".ativo");
      if (ativo) ativo.scrollIntoView({ block: "nearest" });
    };
    const fechar = () => fundo.remove();
    const executar = (i) => {
      const c = achados[i];
      fechar();
      if (c) setTimeout(() => { try { c.acao(); } catch (erro) { LNUX.erro(erro); } }, 0);
    };
    entrada.addEventListener("input", () => { escolhido = 0; desenhar(); });
    entrada.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); escolhido = Math.min(achados.length - 1, escolhido + 1); desenhar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); escolhido = Math.max(0, escolhido - 1); desenhar(); }
      else if (e.key === "Enter") { e.preventDefault(); executar(escolhido); }
      else if (e.key === "Escape") { e.preventDefault(); fechar(); }
    });
    fundo.addEventListener("pointerdown", (e) => { if (e.target === fundo) fechar(); });
    fundo.append(caixa);
    document.body.append(fundo);
    desenhar();
    entrada.focus();
  };

  // ── Divisores arrastáveis entre painéis ─────────────────────────────

  /**
   * <div class="lnux-divisor" data-divisor="vertical" data-alvo="#painel" data-min="160" data-max="600" data-lado="antes|depois">
   * Arrastar muda a largura (vertical) ou a altura (horizontal) do alvo; o tamanho fica salvo por app.
   */
  LNUX.divisores = function (raiz = document) {
    for (const d of $$(".lnux-divisor", raiz)) {
      if (d.dataset.pronto) continue;
      d.dataset.pronto = "1";
      const vertical = d.dataset.divisor === "vertical";
      const alvo = d.dataset.alvo ? $(d.dataset.alvo) : (d.dataset.lado === "depois" ? d.nextElementSibling : d.previousElementSibling);
      if (!alvo) continue;
      const chave = `lnux.divisor.${config.app}.${d.dataset.alvo || d.id || "x"}`;
      const salvo = parseFloat(lerPreferencia(chave, ""));
      const min = parseFloat(d.dataset.min || "80"), max = parseFloat(d.dataset.max || "4000");
      const aplicar = (px) => {
        px = LNUX.limitar(px, min, max);
        alvo.style.flex = `0 0 ${px}px`;
        alvo.style[vertical ? "width" : "height"] = px + "px";
        return px;
      };
      if (salvo) aplicar(salvo);
      d.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        d.classList.add("arrastando");
        const inicio = vertical ? e.clientX : e.clientY;
        const tamanho = alvo.getBoundingClientRect()[vertical ? "width" : "height"];
        const sinal = (d.dataset.lado === "depois" ? -1 : 1) * (d.dataset.inverter ? -1 : 1);
        let final = tamanho;
        const mover = (ev) => {
          final = aplicar(tamanho + sinal * ((vertical ? ev.clientX : ev.clientY) - inicio));
          window.dispatchEvent(new Event("resize"));
        };
        const soltar = () => {
          d.classList.remove("arrastando");
          d.removeEventListener("pointermove", mover);
          d.removeEventListener("pointerup", soltar);
          d.removeEventListener("pointercancel", soltar);
          gravarPreferencia(chave, String(Math.round(final)));
        };
        d.addEventListener("pointermove", mover);
        d.addEventListener("pointerup", soltar);
        d.addEventListener("pointercancel", soltar);
      });
    }
  };

  // ── Desfazer / refazer ──────────────────────────────────────────────

  /**
   * Histórico por fotografias do estado (JSON). Chame marcar("o que vai mudar") ANTES de mudar o estado.
   *   const h = new LNUX.Historico(() => projeto, (estado) => { projeto = estado; desenhar(); });
   */
  LNUX.Historico = class {
    constructor(obter, aplicar, limite = 150) {
      this.obter = obter;
      this.aplicar = aplicar;
      this.limite = limite;
      this.passado = [];
      this.futuro = [];
      this.aoMudar = null;
    }
    marcar(descricao = "") {
      this.passado.push({ descricao, estado: JSON.stringify(this.obter()) });
      if (this.passado.length > this.limite) this.passado.shift();
      this.futuro = [];
      this.aoMudar && this.aoMudar();
    }
    podeDesfazer() { return this.passado.length > 0; }
    podeRefazer() { return this.futuro.length > 0; }
    desfazer() {
      const p = this.passado.pop();
      if (!p) return;
      this.futuro.push({ descricao: p.descricao, estado: JSON.stringify(this.obter()) });
      this.aplicar(JSON.parse(p.estado));
      this.aoMudar && this.aoMudar();
      return p.descricao;
    }
    refazer() {
      const f = this.futuro.pop();
      if (!f) return;
      this.passado.push({ descricao: f.descricao, estado: JSON.stringify(this.obter()) });
      this.aplicar(JSON.parse(f.estado));
      this.aoMudar && this.aoMudar();
      return f.descricao;
    }
    limpar() { this.passado = []; this.futuro = []; this.aoMudar && this.aoMudar(); }
  };

  // ── Guardado no navegador (IndexedDB) ───────────────────────────────

  let bancoPromessa = null;
  function banco() {
    if (!bancoPromessa) {
      bancoPromessa = new Promise((resolver, rejeitar) => {
        const pedido = indexedDB.open("lnux-apps", 1);
        pedido.onupgradeneeded = () => pedido.result.createObjectStore("kv");
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => rejeitar(pedido.error);
      });
    }
    return bancoPromessa;
  }
  function transacao(modo, fazer) {
    return banco().then((db) => new Promise((resolver, rejeitar) => {
      const t = db.transaction("kv", modo);
      const r = fazer(t.objectStore("kv"));
      t.oncomplete = () => resolver(r && "result" in r ? r.result : undefined);
      t.onerror = () => rejeitar(t.error);
      t.onabort = () => rejeitar(t.error || new Error("O navegador recusou guardar (pouco espaço?)."));
    }));
  }
  /** Guarda qualquer coisa (inclusive Blob e ArrayBuffer) no navegador, por app. */
  LNUX.guardado = {
    ler: (chave) => transacao("readonly", (s) => s.get(chave)).catch(() => undefined),
    gravar: (chave, valor) => transacao("readwrite", (s) => s.put(valor, chave)),
    apagar: (chave) => transacao("readwrite", (s) => s.delete(chave)),
    chaves: (prefixo = "") => transacao("readonly", (s) => s.getAllKeys()).then((ks) => (ks || []).filter((k) => String(k).startsWith(prefixo))).catch(() => []),
  };

  // ── Ponte local ─────────────────────────────────────────────────────

  /**
   * Cliente da ponte local (servidor/lnux_apps.py). O LNUX abre o app com "#token=..." no endereço; o token fica
   * guardado no navegador e vai em cada pedido (cabeçalho X-Ponte-Token). Mídias usam um cookie que a ponte
   * cria em /api/entrar, porque <video src> não manda cabeçalhos.
   */
  const ponte = {
    disponivel: false,
    estado: null,
    motivo: "",
    _token: "",
  };
  LNUX.ponte = ponte;

  (function lerToken() {
    const m = location.hash.match(/(?:^#|&)token=([A-Za-z0-9_-]+)/);
    if (m) {
      gravarPreferencia("lnux.ponte.token", m[1]);
      const resto = location.hash.replace(/(?:^#|&)token=[A-Za-z0-9_-]+/, "").replace(/^&/, "");
      history.replaceState(null, "", location.pathname + location.search + (resto ? "#" + resto : ""));
    }
    ponte._token = lerPreferencia("lnux.ponte.token", "");
  })();

  ponte.pedir = async function (metodo, rota, { json, corpo, parametros, como = "json", sinal, tipo } = {}) {
    const url = new URL("/api/" + rota.replace(/^\//, ""), location.origin);
    for (const [k, v] of Object.entries(parametros || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const cabecalhos = { "X-Ponte-Token": ponte._token };
    let body = corpo;
    if (json !== undefined) { body = JSON.stringify(json); cabecalhos["Content-Type"] = "application/json"; }
    else if (tipo) cabecalhos["Content-Type"] = tipo;
    let resposta;
    try {
      resposta = await fetch(url, { method: metodo, headers: cabecalhos, body, signal: sinal, credentials: "same-origin" });
    } catch (e) {
      throw new Error("A ponte local não respondeu. Ela está ligada? (abra o app pelo LNUX: 🌐 Apps Web)");
    }
    if (!resposta.ok) {
      let msg = `A ponte respondeu ${resposta.status}`;
      try { const j = await resposta.json(); if (j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
      const erro = new Error(msg);
      erro.status = resposta.status;
      throw erro;
    }
    if (como === "json") return resposta.json();
    if (como === "texto") return resposta.text();
    if (como === "blob") return resposta.blob();
    if (como === "arraybuffer") return resposta.arrayBuffer();
    return resposta;
  };

  /** Vê se a ponte está ligada (e se o token vale). Guarda o estado em ponte.estado. */
  ponte.verificar = async function () {
    ponte.disponivel = false;
    if (location.protocol === "file:") { ponte.motivo = "aberto direto do arquivo (sem servidor)"; return false; }
    try {
      const controle = new AbortController();
      const t = setTimeout(() => controle.abort(), 2500);
      const estado = await ponte.pedir("GET", "estado", { sinal: controle.signal });
      clearTimeout(t);
      if (!estado || !estado.ponte) { ponte.motivo = estado && estado.motivo ? estado.motivo : "o servidor está sem a ponte"; return false; }
      await ponte.pedir("POST", "entrar", { json: {} });
      ponte.estado = estado;
      ponte.disponivel = true;
      ponte.motivo = "";
    } catch (e) {
      ponte.motivo = e.status === 401 ? "o endereço não tem a chave da ponte (abra o app pelo LNUX)" : (e.status === 404 ? "o servidor não tem a ponte" : "a ponte não está ligada");
    }
    document.dispatchEvent(new CustomEvent("lnux:ponte", { detail: ponte.disponivel }));
    return ponte.disponivel;
  };

  ponte.tem = (recurso) => !!(ponte.disponivel && ponte.estado && ponte.estado.recursos && ponte.estado.recursos[recurso]);
  ponte.listar = (caminho, ocultos = false) => ponte.pedir("GET", "pastas", { parametros: { caminho, ocultos: ocultos ? 1 : 0 } });
  ponte.info = (caminho) => ponte.pedir("GET", "info", { parametros: { caminho } });
  ponte.url = (caminho) => "/api/arquivo?caminho=" + encodeURIComponent(caminho);
  ponte.ler = (caminho, como = "texto") => ponte.pedir("GET", "arquivo", { parametros: { caminho }, como });
  ponte.gravar = (caminho, dados, { sobrescrever = false } = {}) =>
    ponte.pedir("PUT", "arquivo", { parametros: { caminho, sobrescrever: sobrescrever ? 1 : 0 }, corpo: dados, tipo: "application/octet-stream" });
  ponte.criarPasta = (caminho) => ponte.pedir("POST", "criar-pasta", { json: { caminho } });
  ponte.mover = (de, para) => ponte.pedir("POST", "mover", { json: { de, para } });
  ponte.copiar = (de, para, sobrescrever = false) => ponte.pedir("POST", "copiar", { json: { de, para, sobrescrever } });
  ponte.apagar = (caminho) => ponte.pedir("POST", "apagar", { json: { caminho } });
  ponte.temporario = (dados, nome) => ponte.pedir("PUT", "temporario", { parametros: { nome }, corpo: dados, tipo: "application/octet-stream" });
  ponte.midia = (caminho) => ponte.pedir("GET", "midia", { parametros: { caminho } });
  ponte.bateria = () => ponte.pedir("GET", "bateria");
  ponte.sistema = () => ponte.pedir("GET", "sistema");
  ponte.notificar = (titulo, texto) => ponte.pedir("POST", "notificar", { json: { titulo, texto } });
  ponte.falar = (texto) => ponte.pedir("POST", "falar", { json: { texto } });
  ponte.vibrar = (ms = 200) => ponte.pedir("POST", "vibrar", { json: { ms } });
  ponte.areaDeTransferencia = {
    ler: () => ponte.pedir("GET", "area-de-transferencia").then((r) => r.texto),
    escrever: (texto) => ponte.pedir("POST", "area-de-transferencia", { json: { texto } }),
  };
  ponte.executar = (comando, { pasta, tempo = 60 } = {}) => ponte.pedir("POST", "executar", { json: { comando, pasta, tempo } });

  /**
   * Converte com o ffmpeg (na ponte). perfil: mp4, webm, gif, mp3, ogg, opus, m4a, flac, wav.
   * Devolve {saida, tamanho} quando termina; aoProgresso(fração, texto) é chamado no caminho.
   */
  ponte.converter = async function ({ entrada, perfil, saida, opcoes = {} }, aoProgresso, sinal) {
    const { id } = await ponte.pedir("POST", "converter", { json: { entrada, perfil, saida, opcoes } });
    for (;;) {
      if (sinal && sinal.aborted) {
        await ponte.pedir("DELETE", "tarefas/" + id).catch(() => {});
        throw new Error("Conversão cancelada.");
      }
      const t = await ponte.pedir("GET", "tarefas/" + id);
      if (aoProgresso) aoProgresso(t.progresso, t.estado === "rodando" ? `Convertendo (${Math.round(t.progresso * 100)}%)...` : "Na fila...");
      if (t.estado === "pronto") return t;
      if (t.estado === "erro" || t.estado === "cancelado") throw new Error(t.erro || "A conversão falhou.");
      await LNUX.esperar(500);
    }
  };

  /** Selo "Ponte ligada / sem ponte" para a barra do app. */
  ponte.selo = function () {
    const s = el("span", { class: "lnux-selo", title: "" });
    const atualizar = () => {
      s.classList.toggle("ligado", ponte.disponivel);
      s.textContent = ponte.disponivel ? "Ponte ligada" : "Sem ponte";
      s.title = ponte.disponivel
        ? "A ponte local está ligada: dá para abrir e salvar nas pastas do aparelho e usar o ffmpeg."
        : `Só o navegador (${ponte.motivo || "sem a ponte local"}). Para usar as pastas do aparelho, abra este app pelo LNUX: 🌐 Apps Web.`;
    };
    atualizar();
    document.addEventListener("lnux:ponte", atualizar);
    s.style.cursor = "help";
    s.addEventListener("click", () => LNUX.aviso(s.title));
    return s;
  };

  // ── Abrir e salvar arquivos ─────────────────────────────────────────

  function aceita(nome, mime, aceitar) {
    if (!aceitar) return true;
    const ext = "." + LNUX.extensao(nome);
    return aceitar.split(",").map((a) => a.trim().toLowerCase()).some((a) =>
      a === ext || (a.endsWith("/*") && (mime || "").startsWith(a.slice(0, -1))) || a === (mime || "").toLowerCase());
  }

  const MIMES = {
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", avi: "video/x-msvideo", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
    json: "application/json", txt: "text/plain", srt: "text/plain", vtt: "text/vtt", pdf: "application/pdf", zip: "application/zip",
  };
  LNUX.mimeDe = (nome) => MIMES[LNUX.extensao(nome)] || "application/octet-stream";

  /** Um arquivo escolhido: do navegador (blob) ou da ponte (caminho). */
  function arquivoDoNavegador(f) {
    let url = null;
    return {
      nome: f.name, tipo: f.type || LNUX.mimeDe(f.name), tamanho: f.size, caminho: null, origem: "navegador",
      get url() { return url || (url = URL.createObjectURL(f)); },
      blob: async () => f,
      texto: async () => f.text(),
    };
  }
  function arquivoDaPonte(item) {
    return {
      nome: item.nome, tipo: LNUX.mimeDe(item.nome), tamanho: item.tamanho, caminho: item.caminho, origem: "ponte",
      url: ponte.url(item.caminho),
      blob: async () => { const b = await ponte.ler(item.caminho, "blob"); return new File([b], item.nome, { type: LNUX.mimeDe(item.nome) }); },
      texto: async () => ponte.ler(item.caminho, "texto"),
    };
  }
  LNUX.arquivoDaPonte = arquivoDaPonte;

  function escolherPeloNavegador({ aceitar, multiplos }) {
    return new Promise((resolver) => {
      const entrada = el("input", { type: "file", accept: aceitar || "", multiple: multiplos, style: { display: "none" } });
      let terminou = false;
      entrada.addEventListener("change", () => { terminou = true; resolver(Array.from(entrada.files || []).map(arquivoDoNavegador)); entrada.remove(); });
      // Se a pessoa cancelar, alguns navegadores não avisam: o foco volta à janela sem "change"
      window.addEventListener("focus", () => setTimeout(() => { if (!terminou) { resolver([]); entrada.remove(); } }, 800), { once: true });
      entrada.addEventListener("cancel", () => { terminou = true; resolver([]); entrada.remove(); });
      document.body.append(entrada);
      entrada.click();
    });
  }

  /**
   * Navegador de pastas da ponte. modo "arquivo" (escolher arquivos) ou "pasta" (escolher onde salvar).
   * Devolve {elemento, valor()}.
   */
  function navegadorDePastas({ modo, aceitar, multiplos, inicio, nomeSugerido }) {
    const estado = ponte.estado || {};
    const raiz = el("div", { class: "lnux-pastas" });
    const campoCaminho = el("input", { class: "lnux-entrada", "aria-label": "Pasta", "data-enter-proprio": "1" });
    const lista = el("ul", { role: "listbox", "aria-multiselectable": String(!!multiplos) });
    const campoNome = modo === "pasta" ? el("input", { class: "lnux-entrada", value: nomeSugerido || "", "aria-label": "Nome do arquivo" }) : null;
    let atual = inicio || lerPreferencia("lnux.ponte.ultima-pasta", "") || estado.home || "~";
    let itens = [];
    const escolhidos = new Set();
    let ocultos = false;

    const ir = async (caminho) => {
      try {
        const r = await ponte.listar(caminho, ocultos);
        atual = r.caminho;
        itens = r.itens;
        escolhidos.clear();
        campoCaminho.value = atual;
        gravarPreferencia("lnux.ponte.ultima-pasta", atual);
        desenhar();
      } catch (e) { LNUX.erro(e); }
    };
    const desenhar = () => {
      const linhas = [];
      if (atual !== "/" && atual.split("/").length > 1) {
        linhas.push(el("li", { ondblclick: () => ir(r_pai()), onclick: () => ir(r_pai()) }, el("span", { html: LNUX.icone("seta-cima") }), ".. (voltar)"));
      }
      for (const it of itens) {
        const pasta = it.tipo === "pasta";
        const pode = pasta || (modo === "arquivo" && aceita(it.nome, LNUX.mimeDe(it.nome), aceitar));
        const li = el("li", {
          class: (escolhidos.has(it.caminho) ? "escolhido" : "") + (pode ? "" : " desligado"), role: "option",
          onclick: (e) => {
            if (pasta) { ir(it.caminho); return; }
            if (!pode) return;
            if (modo === "pasta") { campoNome.value = it.nome; return; }
            if (!multiplos || !(e.ctrlKey || e.metaKey || e.shiftKey)) escolhidos.clear();
            escolhidos.has(it.caminho) ? escolhidos.delete(it.caminho) : escolhidos.add(it.caminho);
            desenhar();
          },
          ondblclick: () => { if (!pasta && pode && modo === "arquivo") { escolhidos.clear(); escolhidos.add(it.caminho); raiz.dispatchEvent(new Event("confirmar")); } },
        }, el("span", { html: LNUX.icone(pasta ? "pasta" : iconeDoArquivo(it.nome)) }), it.nome, el("span", { class: "tam" }, pasta ? "" : LNUX.bytes(it.tamanho)));
        linhas.push(li);
      }
      if (!itens.length) linhas.push(el("li", { class: "desligado" }, "(pasta vazia)"));
      lista.replaceChildren(...linhas);
    };
    const r_pai = () => atual.replace(/\/[^/]+\/?$/, "") || "/";
    campoCaminho.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); ir(campoCaminho.value); } });

    const atalhosPastas = el("div", { class: "atalhos" });
    for (const [rotulo, caminho] of Object.entries(estado.pastas || {})) {
      if (caminho) atalhosPastas.append(el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => ir(caminho) }, rotulo));
    }
    const botaoOcultos = el("button", { class: "lnux-botao pequeno", type: "button", "aria-pressed": "false", onclick: () => { ocultos = !ocultos; botaoOcultos.setAttribute("aria-pressed", String(ocultos)); ir(atual); } }, "Ocultos");
    atalhosPastas.append(botaoOcultos);
    if (modo === "pasta") {
      atalhosPastas.append(el("button", {
        class: "lnux-botao pequeno", type: "button",
        onclick: async () => {
          const nome = await LNUX.perguntar("Nova pasta", { rotulo: "Nome da pasta" });
          if (!nome) return;
          try { await ponte.criarPasta(atual.replace(/\/$/, "") + "/" + nome); ir(atual); } catch (e) { LNUX.erro(e); }
        },
      }, "Nova pasta"));
    }

    raiz.append(el("div", { class: "caminho" }, campoCaminho, el("button", { class: "lnux-botao", type: "button", onclick: () => ir(campoCaminho.value) }, "Ir")), atalhosPastas, lista);
    if (campoNome) raiz.append(el("label", { class: "lnux-campo" }, el("span", {}, "Nome do arquivo"), campoNome));
    ir(atual);
    return {
      elemento: raiz,
      valor: () => modo === "pasta"
        ? (campoNome.value.trim() ? atual.replace(/\/$/, "") + "/" + campoNome.value.trim() : null)
        : itens.filter((i) => escolhidos.has(i.caminho)),
    };
  }

  function iconeDoArquivo(nome) {
    const m = LNUX.mimeDe(nome);
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "musica";
    if (m.startsWith("image/")) return "imagem";
    return "arquivo";
  }

  LNUX.arquivos = {
    /**
     * Escolhe arquivos. Com a ponte, mostra as pastas do aparelho e um botão para escolher pelo navegador;
     * sem ela, abre direto a escolha do navegador. Devolve uma lista (vazia se cancelou).
     */
    async abrir({ titulo = "Abrir", aceitar = "", multiplos = false } = {}) {
      if (!ponte.disponivel) return escolherPeloNavegador({ aceitar, multiplos });
      const nav = navegadorDePastas({ modo: "arquivo", aceitar, multiplos });
      const d = LNUX.dialogo({
        titulo, largo: true, corpo: nav.elemento,
        botoes: [
          { rotulo: "Escolher pelo navegador...", valor: "navegador" }, "espaco",
          { rotulo: "Cancelar", valor: null },
          { rotulo: "Abrir", primario: true, valor: "ponte", antes: () => { if (!nav.valor().length) { LNUX.aviso("Escolha um arquivo (ou dê dois cliques nele)."); return false; } } },
        ],
      });
      nav.elemento.addEventListener("confirmar", () => d.fechar("ponte"));
      const r = await d;
      if (r === "navegador") return escolherPeloNavegador({ aceitar, multiplos });
      if (r === "ponte") return nav.valor().map(arquivoDaPonte);
      return [];
    },

    /**
     * Salva um Blob. Com a ponte, pergunta se baixa (navegador) ou salva numa pasta do aparelho.
     * Devolve o caminho salvo (ponte), "baixado" ou null (cancelou).
     */
    async salvar(blob, nome, { titulo = "Salvar", caminho = null } = {}) {
      if (!ponte.disponivel) { LNUX.baixar(blob, nome); return "baixado"; }
      if (caminho) {
        await ponte.gravar(caminho, blob, { sobrescrever: true });
        LNUX.aviso("Salvo em " + caminho, "ok");
        return caminho;
      }
      const nav = navegadorDePastas({ modo: "pasta", nomeSugerido: nome });
      const r = await LNUX.dialogo({
        titulo, largo: true, corpo: nav.elemento,
        botoes: [{ rotulo: "Baixar pelo navegador", valor: "baixar" }, "espaco", { rotulo: "Cancelar", valor: null }, { rotulo: "Salvar aqui", primario: true, valor: "ponte" }],
      });
      if (r === "baixar") { LNUX.baixar(blob, nome); return "baixado"; }
      if (r !== "ponte") return null;
      const destino = nav.valor();
      if (!destino) { LNUX.aviso("Faltou o nome do arquivo.", "alerta"); return null; }
      try {
        await ponte.gravar(destino, blob, { sobrescrever: false });
      } catch (e) {
        if (e.status !== 409) throw e;
        if (!(await LNUX.confirmar("Substituir?", `Já existe ${destino}. Substituir pelo novo?`, { rotulo: "Substituir", perigo: true }))) return null;
        await ponte.gravar(destino, blob, { sobrescrever: true });
      }
      LNUX.aviso("Salvo em " + destino, "ok");
      return destino;
    },
  };

  /** Aceita arquivos arrastados para dentro de um elemento. */
  LNUX.soltarArquivos = function (alvo, aoSoltar) {
    alvo.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); alvo.classList.add("soltando"); } });
    alvo.addEventListener("dragleave", () => alvo.classList.remove("soltando"));
    alvo.addEventListener("drop", (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      alvo.classList.remove("soltando");
      aoSoltar(Array.from(e.dataTransfer.files).map(arquivoDoNavegador), e);
    });
  };

  // ── Sobre e créditos ────────────────────────────────────────────────

  /** Janela "Sobre": o que o app faz e de onde veio a ideia (créditos da licença do original). */
  LNUX.sobre = function () {
    const c = config;
    const corpo = el("div", { style: { display: "grid", gap: "10px" } },
      el("p", { style: { margin: 0 } }, c.descricao || ""),
      c.inspirado ? el("div", { class: "lnux-secao" },
        el("h3", {}, "Créditos"),
        el("p", { style: { margin: 0 } },
          `Inspirado no ${c.inspirado.nome}, da storytold (${c.inspirado.autores || "ArtCraft Team e colaboradores"}), `,
          "distribuído sob a licença MIT ou Apache-2.0. ",
          el("a", { href: c.inspirado.url, target: "_blank", rel: "noopener" }, c.inspirado.url)),
        el("p", { class: "fraco", style: { margin: "6px 0 0" } },
          "Este app é uma reescrita própria e bem mais simples, em HTML, CSS e JavaScript: não usa código, nome nem logos do original (o nome ArtCraft e os logos são marcas da ArtCraft Team).")) : null,
      el("p", { class: "fraco", style: { margin: 0 } }, "Parte do LNUX-APPs · licença MIT · ", el("a", { href: "../../CREDITOS.md", target: "_blank" }, "todos os créditos")));
    return LNUX.dialogo({ titulo: `Sobre o ${c.nome}`, corpo });
  };

  // ── Atalhos de teclado (janela de ajuda) ────────────────────────────

  LNUX.ajudaAtalhos = function () {
    const linhas = comandos.filter((c) => c.atalho).map((c) => el("tr", {},
      el("td", { class: "fraco", style: { padding: "3px 12px 3px 0" } }, c.grupo || ""),
      el("td", { style: { padding: "3px 12px 3px 0" } }, c.rotulo),
      el("td", { class: "mono", style: { padding: "3px 0", whiteSpace: "nowrap" } }, [].concat(c.atalho).map(LNUX.mostrarAtalho).join("  ·  "))));
    return LNUX.dialogo({ titulo: "Atalhos de teclado", largo: true, corpo: el("table", { style: { borderCollapse: "collapse", width: "100%" } }, el("tbody", {}, linhas)) });
  };

  // ── Iniciar um app ──────────────────────────────────────────────────

  /**
   * Prepara o app: tema, layout, barra de menus, botão de aparência, selo da ponte, atalhos padrão.
   *   cfg = {app, nome, descricao, inspirado: {nome, url, autores}, layouts: [{id, nome, descricao, icone, celular}],
   *          menus: [...], aoMudarLayout(id)}
   * Devolve uma Promise que resolve depois de verificar a ponte.
   */
  LNUX.iniciar = function (cfg) {
    Object.assign(config, cfg);
    document.title = cfg.nome + " · LNUX";
    const barra = $(".lnux-menubar");
    if (barra && cfg.menus) LNUX.menus(barra, cfg.menus);
    const acoes = $(".lnux-topo-acoes");
    if (acoes) {
      acoes.append(ponte.selo(),
        LNUX.botaoIcone("comando", "Paleta de comandos (Ctrl+Shift+P)", () => LNUX.paleta()),
        LNUX.botaoIcone("aparencia", "Aparência: tema e layout", () => LNUX.aparencia()),
        el("a", { class: "lnux-botao icone plano", href: "../../", title: "Todos os apps", "aria-label": "Todos os apps", html: LNUX.icone("casa") }));
    }
    LNUX.comando({ grupo: "Exibir", rotulo: "Paleta de comandos", atalho: ["Ctrl+Shift+P", "F1"], acao: () => LNUX.paleta(), global: true });
    LNUX.comando({ grupo: "Exibir", rotulo: "Aparência: tema e layout", acao: () => LNUX.aparencia() });
    for (const t of LNUX.temas) LNUX.comando({ grupo: "Tema", rotulo: t.nome, acao: () => LNUX.tema.definir(t.id) });
    for (const l of config.layouts) LNUX.comando({ grupo: "Layout", rotulo: l.nome, acao: () => LNUX.layout.definir(l.id) });
    LNUX.layout.aplicar();
    LNUX.divisores();
    return ponte.verificar();
  };
})();
