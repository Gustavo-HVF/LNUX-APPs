/*
 * WEBC — a tela de quem joga (dentro do jogo, com a personagem):
 *   - no alto, a barra com o logo do WEBC (volta ao site) e o ☰, que abre a janela Opções;
 *   - embaixo, no meio, as expressões da personagem (1 a 9): um clique ou a tecla do número, e os outros veem;
 *   - no canto, o bate-papo (abre e fecha a conversa da sala) e o vídeo numa tela;
 *   - a janela Opções: Personagem, Sala, Ajuda, Acessibilidade, Gráfico e Controle.
 *
 * C.Jogo(ctx) — ctx: palco() (o palco 3D ou null), emocao(nome), gesto(nome), video(), secoes() → {personagem, sala,
 * ajuda, exibir} (itens no formato dos menus: {rotulo, acao, ativo, marcado} ou "-"), cenario() (o painel da luz e do
 * cenário), qualidade() (a qualidade das texturas).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);

  // ── os desenhos (SVG próprios, sem emoji) ───────────────────────────
  const ROSTO = "M16 3a13 13 0 1 0 0 26a13 13 0 1 0 0-26Z";
  const OLHOS = "M11 11.2a1.8 2.3 0 1 0 0 4.6a1.8 2.3 0 1 0 0-4.6Z M21 11.2a1.8 2.3 0 1 0 0 4.6a1.8 2.3 0 1 0 0-4.6Z";
  const svg = (corpo, extra = "") => `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" focusable="false">${corpo}${extra}</svg>`;
  const furado = (d) => `<path fill="currentColor" fill-rule="evenodd" d="${d}"/>`;
  /** As 9 expressões: a emoção (ou o gesto), o nome e o desenho. */
  const EXPRESSOES = [
    { id: "feliz", nome: "Feliz", icone: svg(furado(`${ROSTO} ${OLHOS} M9.5 18.2h13a6.5 6.5 0 0 1-13 0Z`)) },
    { id: "rindo", nome: "Rindo", icone: svg(furado(`${ROSTO} M8.4 13.6l2.6-2.7 2.6 2.7-1.1 1.1-1.5-1.5-1.5 1.5Z M18.4 13.6l2.6-2.7 2.6 2.7-1.1 1.1-1.5-1.5-1.5 1.5Z M8.5 17h15a7.5 7.5 0 0 1-15 0Z`)) },
    { id: "surpresa", nome: "Surpresa", icone: svg(furado(`${ROSTO} M11 10.4a2.2 2.8 0 1 0 0 5.6a2.2 2.8 0 1 0 0-5.6Z M21 10.4a2.2 2.8 0 1 0 0 5.6a2.2 2.8 0 1 0 0-5.6Z M16 18a3 3.6 0 1 0 0 7.2a3 3.6 0 1 0 0-7.2Z`)) },
    { id: "apaixonada", nome: "Apaixonada", icone: svg(furado("M16 28.5S4 21.2 4 13a6.2 6.2 0 0 1 12-2.3A6.2 6.2 0 0 1 28 13c0 8.2-12 15.5-12 15.5Z"),
      '<path fill="currentColor" d="M26.5 2.5a2 2 0 0 1 3.5 1.6c0 2.4-3.5 4.4-3.5 4.4S23 6.5 23 4.1a2 2 0 0 1 3.5-1.6Z" opacity=".8"/>') },
    { id: "triste", nome: "Triste", icone: svg(furado(`${ROSTO} ${OLHOS} M10 24a6 5 0 0 1 12 0h-2.2a3.8 3 0 0 0-7.6 0Z M11 17.3c-1 1.6-1.7 2.7-1.7 3.5a1.7 1.7 0 0 0 3.4 0c0-.8-.7-1.9-1.7-3.5Z`)) },
    { id: "brava", nome: "Brava", icone: svg(furado(`${ROSTO} M7.6 9.6l6.4 2.4-.7 1.7-6.4-2.4Z M24.4 9.6l-6.4 2.4.7 1.7 6.4-2.4Z M11 14a1.6 1.8 0 1 0 0 3.6a1.6 1.8 0 1 0 0-3.6Z M21 14a1.6 1.8 0 1 0 0 3.6a1.6 1.8 0 1 0 0-3.6Z M10.5 23.6h11v-1.4a5.5 3.6 0 0 0-11 0Z`),
      '<path fill="currentColor" d="M5.2 2.6l5.6 4.6-3.4 2.6Z M26.8 2.6l-5.6 4.6 3.4 2.6Z"/>') },
    { id: "acenar", nome: "Acenar", gesto: true, icone: svg(furado("M9.6 18.3V10a2 2 0 0 1 4 0v5.5h.8V7.6a2 2 0 0 1 4 0v7.9h.8V8.8a2 2 0 0 1 4 0v8h.8v-3.3a2 2 0 0 1 4 0v7.6a9 9 0 0 1-9 9h-1.4a9 9 0 0 1-7.8-4.6l-3.3-5.8a2 2 0 0 1 3.4-2.1Z"),
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4.2 9.5a7 7 0 0 1 3-4.6 M2 7.6a10 10 0 0 1 4-5.4"/>') },
    { id: "provocadora", nome: "Piscadinha", icone: svg(furado(`${ROSTO} M11 11.2a1.8 2.3 0 1 0 0 4.6a1.8 2.3 0 1 0 0-4.6Z M18.4 13h5.2v1.9h-5.2Z M9.5 18.2h13a6.5 6.5 0 0 1-13 0Z`)) },
    { id: "pensativa", nome: "Pensativa", icone: svg(furado("M9.6 21a5.2 5.2 0 0 1 .4-10.4 6.8 6.8 0 0 1 12.8-1.4A5.6 5.6 0 0 1 23 21Z"),
      '<circle cx="8.5" cy="25" r="2.2" fill="currentColor"/><circle cx="4.8" cy="28.6" r="1.3" fill="currentColor"/>') },
  ];
  const ICONES = {
    menu: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="M3 5.5h18v2.6H3Zm0 5.2h18v2.6H3Zm0 5.2h18v2.6H3Z"/></svg>',
    chat: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="M16 4C8.3 4 3 8.8 3 14.6c0 3.4 1.8 6.3 4.8 8.2L6 28.5l6.4-3.6c1.2.3 2.4.4 3.6.4 7.7 0 13-4.8 13-10.7S23.7 4 16 4Z"/></svg>',
    video: '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 3.5l5 5 6-6"/><rect x="3" y="9" width="26" height="17" rx="3.5" fill="currentColor"/><path fill="currentColor" d="M8 26h3l-1.2 3H7.6Zm13 0h3l.4 3h-2.2Z"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
    // os cartões da janela Opções
    personagem: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="15" r="8.5" fill="currentColor"/><path fill="currentColor" d="M8 42c0-9.4 7.2-15.5 16-15.5S40 32.6 40 42Z"/></svg>',
    sala: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M6 22 24 7l18 15v19a2 2 0 0 1-2 2H30V31H18v12H8a2 2 0 0 1-2-2Z"/></svg>',
    ajuda: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M24 4a20 20 0 1 0 0 40 20 20 0 1 0 0-40Zm-.4 9c-4.7 0-7.8 2.7-8 6.8h4.6c.2-1.8 1.4-2.9 3.3-2.9s3.2 1.1 3.2 2.7c0 1.5-.7 2.3-2.6 3.5-2.2 1.3-3.2 2.8-3 5.4v.9h4.5v-.8c0-1.6.6-2.4 2.6-3.6 2.2-1.3 3.5-3 3.5-5.6C31.7 15.6 28.4 13 23.6 13Zm-.2 18.3a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"/></svg>',
    acessibilidade: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="8.5" r="4.5" fill="currentColor"/><path fill="currentColor" d="M8 15.5c5.3 1.4 10.6 2.1 16 2.1s10.7-.7 16-2.1l1 3.9c-4 1.1-8.1 1.8-12.3 2.1V29l4.7 14h-4.6L24 31.5 19.2 43h-4.6l4.7-14v-7.5c-4.2-.3-8.3-1-12.3-2.1Z"/></svg>',
    grafico: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="8" width="40" height="26" rx="4" fill="currentColor"/><path fill="currentColor" d="M18 38h12l1.5 4h-15Z"/><path fill="var(--jogo-cartao-fundo, #fff)" d="M14 28l7-9 5 6 4-4 6 7Z"/><circle cx="33" cy="15" r="3" fill="var(--jogo-cartao-fundo, #fff)"/></svg>',
    controle: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M14.5 12h19c5.8 0 9.6 4.6 10.3 12.5l.9 9.2c.4 4-3.8 6.4-6.8 3.8L33 33H15l-4.9 4.5c-3 2.6-7.2.2-6.8-3.8l.9-9.2C4.9 16.6 8.7 12 14.5 12Zm-1 6.5v3.5H10v3h3.5v3.5h3V25H20v-3h-3.5v-3.5Zm19.5.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm4.5 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
  };
  Object.assign(ICONES, {
    itens: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M17 15h14l3-8H14Z"/><rect x="16" y="17" width="16" height="26" rx="3" fill="currentColor"/><path fill="var(--jogo-cartao-fundo, #fff)" d="M22 23h4v9h-4Z"/></svg>',
    batepapo: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M8 8h26a5 5 0 0 1 5 5v13a5 5 0 0 1-5 5H19l-8 6v-6H8a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5Z"/><path fill="currentColor" opacity=".55" d="M42 17a4 4 0 0 1 3 4v12a4 4 0 0 1-4 4h-2v5l-7-5H22a4 4 0 0 1-3.5-2H35a7 7 0 0 0 7-7Z"/></svg>',
    conta: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="9" width="40" height="30" rx="5" fill="currentColor"/><circle cx="17" cy="21" r="5" fill="var(--jogo-cartao-fundo, #fff)"/><path fill="var(--jogo-cartao-fundo, #fff)" d="M8.5 33c.8-4.6 4.1-7 8.5-7s7.7 2.4 8.5 7Z"/><path fill="var(--jogo-cartao-fundo, #fff)" d="M29 18h10v3H29Zm0 7h10v3H29Z"/></svg>',
    aparencia: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M24 4C12.4 4 4 12.4 4 23.4 4 34.2 12.6 44 23.3 44c2.6 0 4-1.6 4-3.6 0-1-.4-1.8-1-2.6-.6-.8-1-1.6-1-2.6 0-2 1.6-3.2 3.6-3.2H33c6.1 0 11-4.5 11-10.6C44 11.4 35 4 24 4Z"/><circle cx="14.5" cy="22" r="3" fill="var(--jogo-cartao-fundo, #fff)"/><circle cx="19.5" cy="13.5" r="3" fill="var(--jogo-cartao-fundo, #fff)"/><circle cx="29" cy="13.5" r="3" fill="var(--jogo-cartao-fundo, #fff)"/><circle cx="34.5" cy="21" r="3" fill="var(--jogo-cartao-fundo, #fff)"/></svg>',
    som: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M6 18h8l11-9v30l-11-9H6Z"/><path fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" d="M31 17.5a9 9 0 0 1 0 13M36.5 12a16.5 16.5 0 0 1 0 24"/></svg>',
    camera: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M17 8h14l3 5h7a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4h7Z"/><circle cx="24" cy="26" r="8" fill="var(--jogo-cartao-fundo, #fff)"/><circle cx="24" cy="26" r="4.5" fill="currentColor"/></svg>',
    teclado: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="11" width="42" height="26" rx="5" fill="currentColor"/><path fill="var(--jogo-cartao-fundo, #fff)" d="M9 17h4v4H9Zm7 0h4v4h-4Zm7 0h4v4h-4Zm7 0h4v4h-4Zm7 0h3v4h-3ZM9 24h4v4H9Zm7 0h4v4h-4Zm7 0h4v4h-4Zm7 0h4v4h-4Zm7 0h3v4h-3Zm-23 7h20v3H14Z"/></svg>',
  });
  // as categorias da janela Opções, em grupos (no computador, à esquerda; no celular, os quadrados)
  const GRUPOS = [
    ["Jogo", [["personagem", "Personagem"], ["itens", "Itens"], ["sala", "Sala"], ["batepapo", "Bate-papo"]]],
    ["Você", [["conta", "Conta"], ["aparencia", "Aparência"], ["acessibilidade", "Acessibilidade"]]],
    ["Ajustes", [["grafico", "Gráfico"], ["som", "Som"], ["camera", "Câmera"], ["controle", "Controle"], ["teclado", "Teclado"]]],
    ["Ajuda", [["ajuda", "Ajuda"]]],
  ];
  const SECOES = GRUPOS.flatMap(([, l]) => l);
  const celular = () => matchMedia("(max-width: 760px)").matches;
  const icone = (nome, classe = "jogo-svg") => el("span", { class: classe, html: ICONES[nome] });

  // ── acessibilidade (guardada neste navegador) ───────────────────────
  const CHAVE_ACESSO = "webc.acessibilidade";
  const lerAcesso = () => { try { return { tamanho: 1, reduzir: false, contraste: false, numeros: true, ...JSON.parse(localStorage.getItem(CHAVE_ACESSO) || "{}") }; } catch (e) { return { tamanho: 1, reduzir: false, contraste: false, numeros: true }; } };
  function aplicarAcesso(a = lerAcesso()) {
    const r = document.documentElement;
    r.style.setProperty("--webc-escala", String(a.tamanho || 1));
    // a opacidade do fundo do menu e da janela Opções (o texto continua inteiro; dá para ver o jogo atrás)
    r.style.setProperty("--webc-menu-opacidade", String(Math.min(1, Math.max(0.3, +a.opacidadeMenu || 1))));
    if (a.reduzir) r.dataset.reduzir = ""; else delete r.dataset.reduzir;
    if (a.numeros === false) r.dataset.semNumeros = ""; else delete r.dataset.semNumeros;
  }
  function gravarAcesso(mud) {
    const a = { ...lerAcesso(), ...mud };
    try { localStorage.setItem(CHAVE_ACESSO, JSON.stringify(a)); } catch (e) { /* sem armazenamento */ }
    aplicarAcesso(a);
    return a;
  }
  aplicarAcesso();
  C.acessibilidade = { ler: lerAcesso, gravar: gravarAcesso };

  // ── o bate-papo (guardado neste navegador): os balões, o aviso das novas e o tamanho do texto ──
  const CHAVE_PAPO = "webc.batepapo";
  const lerPapo = () => { try { return { baloes: true, contador: true, tamanho: 1, ...JSON.parse(localStorage.getItem(CHAVE_PAPO) || "{}") }; } catch (e) { return { baloes: true, contador: true, tamanho: 1 }; } };
  const aplicarPapo = (a = lerPapo()) => document.documentElement.style.setProperty("--webc-papo-escala", String(a.tamanho || 1));
  function gravarPapo(mud) {
    const a = { ...lerPapo(), ...mud };
    try { localStorage.setItem(CHAVE_PAPO, JSON.stringify(a)); } catch (e) { /* sem armazenamento */ }
    aplicarPapo(a);
    return a;
  }
  aplicarPapo();
  C.batePapo = { ler: lerPapo, gravar: gravarPapo };

  C.Jogo = function (ctx) {
    let emocaoAtual = "neutra", voltarT = 0, naoLidas = 0, opcoes = null;
    const raiz = document.documentElement;

    // ── as expressões, embaixo no meio (no lugar dos gestos antigos: #gestos) ──
    const barra = document.getElementById("gestos");
    barra.hidden = false;
    barra.classList.add("jogo-expressoes");
    barra.setAttribute("aria-label", "Expressões da personagem (1 a 9)");
    function desenharExpressoes() {
      barra.replaceChildren(...EXPRESSOES.map((x, i) => el("button", { type: "button", class: "jogo-expressao", "data-expressao": x.id, title: `${t(x.nome)} (${i + 1})`, "aria-label": x.nome,
        "aria-keyshortcuts": String(i + 1), "aria-pressed": String(emocaoAtual === x.id), onclick: () => expressar(x.id) },
      el("span", { class: "jogo-numero", "aria-hidden": "true" }, String(i + 1)), el("span", { class: "jogo-expressao-icone", html: x.icone }))));
    }
    /** Liga uma expressão (a mesma de novo volta ao normal); depois de uns segundos, volta ao normal sozinha. */
    function expressar(id) {
      const x = EXPRESSOES.find((e) => e.id === id);
      if (!x) return;
      const b = barra.querySelector(`[data-expressao="${id}"]`);
      if (b) { b.classList.remove("pulsou"); void b.offsetWidth; b.classList.add("pulsou"); }
      if (x.gesto) { ctx.gesto(id); return; }
      clearTimeout(voltarT);
      emocaoAtual = emocaoAtual === id ? "neutra" : id;
      ctx.emocao(emocaoAtual);
      if (emocaoAtual !== "neutra") voltarT = setTimeout(() => { emocaoAtual = "neutra"; ctx.emocao("neutra"); marcar(); }, 6000);
      marcar();
    }
    const marcar = () => { for (const b of barra.querySelectorAll("[data-expressao]")) b.setAttribute("aria-pressed", String(b.dataset.expressao === emocaoAtual)); };

    // ── o canto: bate-papo e vídeo ──
    const contador = el("span", { class: "jogo-nao-lidas", hidden: true, "aria-hidden": "true" });
    const botaoChat = el("button", { type: "button", class: "jogo-canto-botao", id: "jogo-chat", title: "Bate-papo", "aria-label": "Bate-papo", "aria-expanded": "false", onclick: () => alternarChat() }, icone("chat"), contador);
    const botaoVideo = el("button", { type: "button", class: "jogo-canto-botao", id: "botao-video", title: "Vídeo na tela (YouTube, Vimeo, Twitch)", "aria-label": "Vídeo na tela", onclick: () => ctx.video() }, icone("video"));
    const canto = el("div", { class: "jogo-canto", role: "toolbar", "aria-label": "Bate-papo e vídeo" }, botaoChat, botaoVideo);
    document.getElementById("palco-area").append(canto);
    // o item na mão (js/mochila.js): o nome e as teclas, em cima do canto
    const chipItem = el("button", { type: "button", class: "jogo-item-chip", id: "jogo-item", hidden: true, title: t("Itens"), onclick: () => abrirOpcoes("itens") });
    document.getElementById("palco-area").append(chipItem);
    function atualizarItem() {
      const it = ctx.itens && ctx.itens.naMao();
      chipItem.hidden = !it;
      if (!it) return;
      chipItem.replaceChildren(el("span", { class: "jogo-item-icone", html: ICONES.itens }), el("b", { translate: "no" }, it.reg.nome),
        el("span", { class: "jogo-item-teclas" }, el("kbd", {}, "E"), " ", t("usar"), " · ", el("kbd", {}, "G"), " ", ctx.itens.visivel() ? t("esconder") : t("mostrar")));
      if (opcoes && opcoes.querySelector('[data-lista="itens"]')) abrirOpcoes("itens");
    }
    // o bate-papo (a conversa da sala) flutua por cima do jogo; um ✕ no alto dele
    const cabeca = document.querySelector("#conversa .lnux-painel-cabeca");
    if (cabeca && !cabeca.querySelector("#jogo-fechar-chat")) cabeca.append(el("button", { type: "button", class: "lnux-botao icone plano jogo-so", id: "jogo-fechar-chat", title: "Fechar", "aria-label": "Fechar o bate-papo", onclick: () => alternarChat(false) }, icone("fechar")));
    function alternarChat(abrir = raiz.dataset.chat !== "aberto") {
      if (abrir) raiz.dataset.chat = "aberto"; else delete raiz.dataset.chat;
      botaoChat.setAttribute("aria-expanded", String(abrir));
      if (abrir) {
        naoLidas = 0; contador.hidden = true;
        const m = document.getElementById("mensagens");
        if (m) m.scrollTop = m.scrollHeight;
        const campo = document.getElementById("texto");
        if (campo && !campo.disabled && !matchMedia("(pointer: coarse)").matches) setTimeout(() => campo.focus(), 30);
      } else if (document.activeElement && document.activeElement.id === "texto") document.activeElement.blur();
    }
    function novaMensagem() {
      if (raiz.dataset.chat === "aberto" || lerPapo().contador === false) return;
      naoLidas++;
      contador.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
      contador.hidden = false;
    }

    // ── o ☰ e a janela Opções ──
    const fecharOpcoes = () => { if (opcoes) { opcoes.remove(); opcoes = null; document.removeEventListener("keydown", teclaOpcoes, true); } };
    let ultimaSecao = "personagem";
    function teclaOpcoes(e) {
      if (e.key !== "Escape" || document.querySelector(".lnux-fundo-modal, .galeria-temas")) return;
      e.preventDefault(); e.stopPropagation();
      // no celular, dentro de uma categoria, o Esc volta aos quadrados; senão, fecha
      if (opcoes && opcoes.dataset.secao && celular()) abrirOpcoes("", { grade: true }); else fecharOpcoes();
    }
    /**
     * Abre a janela Opções. No computador: as categorias à esquerda e a escolhida à direita (a última vista, ou
     * Personagem). No celular: os quadrados das categorias e, tocando num, a categoria (com o voltar).
     */
    function abrirOpcoes(secao = "", { grade = false } = {}) {
      const novo = !opcoes;
      if (novo) {
        opcoes = el("div", { class: "jogo-opcoes-fundo", onclick: (e) => { if (e.target === opcoes) fecharOpcoes(); } });
        document.body.append(opcoes);
        document.addEventListener("keydown", teclaOpcoes, true);
      }
      if (!secao && !grade && !celular()) secao = ultimaSecao;
      if (secao) ultimaSecao = secao;
      opcoes.dataset.secao = secao;
      const nomeDa = (id) => t((SECOES.find((x) => x[0] === id) || [id, id])[1]);
      const titulo = secao ? nomeDa(secao) : t("Opções");
      const nav = el("nav", { class: "jogo-opcoes-nav", "aria-label": t("Categorias") }, GRUPOS.map(([nomeGrupo, lista]) => el("div", { class: "jogo-opcoes-grupo" },
        el("h3", {}, t(nomeGrupo)),
        el("div", { class: "jogo-opcoes-grade" }, lista.map(([id, nome]) => el("button", { type: "button", class: "jogo-opcao" + (id === secao ? " ativa" : ""), "data-secao": id,
          "aria-current": id === secao ? "page" : undefined, onclick: () => abrirOpcoes(id) },
        el("span", { class: "jogo-opcao-icone", html: ICONES[id] }), el("span", { class: "jogo-opcao-nome" }, t(nome))))))));
      const conteudo = el("div", { class: "jogo-opcoes-conteudo" }, secao ? el("div", { class: "jogo-opcoes-lista", "data-lista": secao },
        el("h3", { class: "jogo-opcoes-secao-titulo" }, el("span", { class: "jogo-opcoes-secao-icone", html: ICONES[secao] }), titulo), ...desenharSecao(secao).filter(Boolean)) : null);
      opcoes.replaceChildren(el("section", { class: "jogo-opcoes" + (novo ? " entrando" : "") + (secao ? " com-secao" : ""), role: "dialog", "aria-modal": "true", "aria-label": t("Opções") },
        el("header", { class: "jogo-opcoes-topo" },
          secao ? el("button", { type: "button", class: "jogo-opcoes-voltar", "aria-label": "Voltar", title: "Voltar", onclick: () => abrirOpcoes("", { grade: true }) }, icone("voltar")) : null,
          el("h2", {}, secao ? el("span", {}, el("span", { class: "fraco-claro" }, t("Opções") + " › "), titulo) : titulo),
          el("span", { class: "jogo-opcoes-dica" }, el("kbd", {}, "Esc"), " ", t("fecha")),
          el("button", { type: "button", class: "jogo-opcoes-fechar", "aria-label": "Fechar", title: "Fechar", onclick: fecharOpcoes }, icone("fechar"))),
        el("div", { class: "jogo-opcoes-corpo" }, nav, conteudo)));
      const foco = opcoes.querySelector(secao && celular() ? ".jogo-opcoes-lista button:not(:disabled), .jogo-opcoes-lista input" : secao ? ".jogo-opcao.ativa" : ".jogo-opcao");
      if (foco) foco.focus({ preventScroll: true });
    }
    /** Uma linha de menu (o mesmo formato dos menus do app). Os que ligam e desligam ficam na janela; os outros fecham. */
    function linhaDeMenu(i, secao) {
      const ativo = !i.ativo || i.ativo();
      const marcado = i.marcado ? !!i.marcado() : null;
      return el("button", { type: "button", class: "jogo-item" + (marcado ? " marcado" : ""), disabled: !ativo, role: marcado === null ? undefined : "switch", "aria-checked": marcado === null ? undefined : String(marcado),
        onclick: async () => {
          if (marcado === null) fecharOpcoes();
          try { await i.acao(); } catch (e) { LNUX.erro(e); }
          if (marcado !== null && opcoes) abrirOpcoes(secao);
        } },
      el("span", { class: "rotulo" }, i.rotulo), marcado !== null ? el("span", { class: "jogo-chave", "aria-hidden": "true" }) : i.atalho ? el("kbd", {}, i.atalho) : null);
    }
    /** Os itens dos menus, sem separadores sobrando. */
    function linhas(itens, secao) {
      const out = [];
      for (const i of itens) {
        if (i === "-") { if (out.length && out[out.length - 1].tagName !== "HR") out.push(el("hr")); continue; }
        out.push(linhaDeMenu(i, secao));
      }
      while (out.length && out[out.length - 1].tagName === "HR") out.pop();
      return out;
    }
    const grupo = (titulo, ...filhos) => el("div", { class: "jogo-grupo" }, titulo ? el("h3", {}, titulo) : null, ...filhos);
    const faixa = (rotulo, min, max, passo, valor, aoMudar, mostrar) => {
      const num = el("span", { class: "valor" }, mostrar(valor));
      const i = el("input", { type: "range", min, max, step: passo, value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => { num.textContent = mostrar(+i.value); aoMudar(+i.value); });
      return el("label", { class: "jogo-faixa" }, el("span", { class: "jogo-faixa-rotulo" }, el("span", {}, rotulo), num), i);
    };
    const chave = (rotulo, valor, aoMudar, dica) => {
      const c = el("input", { type: "checkbox", checked: !!valor, role: "switch", "aria-label": rotulo });
      c.addEventListener("change", () => aoMudar(c.checked));
      return el("label", { class: "jogo-alternar", title: dica || "" }, el("span", { class: "rotulo" }, rotulo), c);
    };
    const segmentos = (rotulo, opcoesSeg, valor, aoMudar) => el("div", { class: "jogo-segmentos", role: "group", "aria-label": rotulo },
      el("span", { class: "jogo-faixa-rotulo" }, rotulo),
      el("div", { class: "jogo-segmentos-botoes" }, opcoesSeg.map(([v, r]) => el("button", { type: "button", class: String(v) === String(valor) ? "ativo" : "", "aria-pressed": String(String(v) === String(valor)), "data-valor": v,
        onclick: (e) => { aoMudar(v); for (const b of e.currentTarget.parentElement.children) { const sim = b === e.currentTarget; b.classList.toggle("ativo", sim); b.setAttribute("aria-pressed", String(sim)); } } }, r))));

    function desenharSecao(secao) {
      const s = ctx.secoes();
      const p = ctx.palco();
      if (secao === "personagem") return linhas(s.personagem, secao);
      if (secao === "sala") return linhas(s.sala, secao);
      if (secao === "conta") {
        const eu = C.contas && C.contas.eu;
        return [
          grupo("", el("p", { class: "jogo-nota" }, eu ? t("Você está na conta de {nome}.", { nome: eu.nome }) : t("Você joga sem conta, como {nome}.", { nome: (C.nomeDoJogo && C.nomeDoJogo.atual()) || "?" }))),
          ...linhas([...s.conta, "-",
            ...(eu ? [] : [{ rotulo: "Trocar o meu nome...", acao: () => C.trocarNomeDoJogo && C.trocarNomeDoJogo() }]),
            ...(eu ? [{ rotulo: "Editar o perfil (foto, banner, bio)...", acao: () => C.janelaPerfil() }] : [])], secao),
        ];
      }
      if (secao === "batepapo") {
        const a = lerPapo();
        return [
          grupo("", ...linhas([{ rotulo: "Abrir o bate-papo", atalho: "Enter", acao: () => alternarChat(true) }], secao)),
          grupo(t("Mensagens"),
            chave("Balões com as mensagens em cima das personagens", a.baloes !== false, (v) => gravarPapo({ baloes: v })),
            chave("Avisar as mensagens novas (o número no botão)", a.contador !== false, (v) => { gravarPapo({ contador: v }); if (!v) { naoLidas = 0; contador.hidden = true; } })),
          grupo(t("Leitura"), segmentos("Tamanho do texto do bate-papo", [[1, "Normal"], [1.15, "Grande"], [1.3, "Maior"]], a.tamanho || 1, (v) => gravarPapo({ tamanho: +v }))),
          grupo("", el("p", { class: "jogo-nota" }, t("Enter abre o bate-papo; Esc fecha. Quem criou a sala pode desligar o bate-papo em Sala › Opções da sala."))),
        ];
      }
      if (secao === "aparencia") {
        const temaBotao = el("button", { type: "button", class: "jogo-item", id: "opcoes-tema", onclick: (e) => C.escolherTema(e.currentTarget) }, el("span", { class: "rotulo" }, t("Tema")), el("span", { class: "jogo-valor" }, C.temas.nome(C.temas.TEMAS.find((x) => x.id === C.temas.atual) || C.temas.TEMAS[0])));
        return [
          grupo(t("Tema"), temaBotao, el("p", { class: "jogo-nota" }, t("Com conta, o tema vai para o seu perfil: quem abre o seu perfil o vê nele."))),
          grupo(t("Idioma"), segmentos("Idioma", Object.entries(C.IDIOMAS).map(([k, v]) => [k, v.nome]), C.idioma, (k) => { C.definirIdioma(k); abrirOpcoes(secao); })),
        ];
      }
      if (secao === "som") {
        const v = ctx.videos && ctx.videos();
        if (!v) return [grupo("", el("p", { class: "jogo-nota" }, t("Ainda não há som para ajustar aqui.")))];
        return [
          grupo(t("Vídeos na sala"),
            faixa("Volume dos vídeos", 0, 100, 5, Math.round((v.volumeGeral ?? 1) * 100), (x) => v.definirVolumeGeral(x / 100), (x) => x + "%"),
            chave("Silenciar o meu vídeo", v.mudo, (x) => { if (!!x !== !!v.mudo) v.alternarMudo(); }),
            chave("Ouvir os vídeos dos outros", v.somOutros, (x) => v.definirSomOutros(x))),
          grupo("", el("p", { class: "jogo-nota" }, t("O som das telas dos outros diminui com a distância: chegue perto para ouvir melhor."))),
        ];
      }
      if (secao === "camera") {
        const m = p && p.mundo;
        if (!m) return [grupo("", el("p", { class: "jogo-nota" }, t("Abra uma personagem VRoid (.vrm) para mudar a câmera e o andar.")))];
        // trocar o tipo de câmera redesenha a seção (cada tipo tem os seus ajustes)
        const redesenhar = () => abrirOpcoes("camera");
        const c = m.cfg, modo = c.camera || "terceira";
        return LNUX.filhos(
          grupo(t("Tipo de câmera"),
            segmentos("Câmera", [["terceira", t("Terceira pessoa")], ["ombro", t("No ombro")], ["primeira", t("Primeira pessoa")]], modo, (v) => { m.trocarCamera(v); redesenhar(); }),
            el("p", { class: "jogo-nota" }, t("F troca a câmera; Q põe a câmera no ombro e troca o lado."))),
          modo === "terceira" ? grupo(t("Terceira pessoa"),
            faixa("Distância da câmera", 1.2, 8, 0.1, +(c.distancia || m.cam.dist || 3.2).toFixed(1), (x) => { c.distancia = x; m.cam.dist = x; m.salvarCfg(); }, (x) => x.toFixed(1) + " m"),
            faixa("Câmera para o lado", -1, 1, 0.05, +c.camLado || 0, (x) => { c.camLado = x; m.salvarCfg(); }, (x) => (Math.abs(x) < 0.01 ? t("no meio") : (x > 0 ? t("direita") : t("esquerda")) + " " + Math.abs(x).toFixed(2) + " m")),
            faixa("Altura da câmera", -0.5, 0.6, 0.05, +c.camAltura || 0, (x) => { c.camAltura = x; m.salvarCfg(); }, (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + " m")) : null,
          modo === "ombro" ? grupo(t("No ombro"),
            segmentos("Lado", [[-1, t("Ombro esquerdo")], [1, t("Ombro direito")]], c.ombroLado < 0 ? -1 : 1, (v) => { c.ombroLado = +v; m.salvarCfg(); }),
            faixa("Afastar para o lado", 0.2, 1.2, 0.05, +c.ombroAfastar || 0.5, (x) => { c.ombroAfastar = x; m.salvarCfg(); }, (x) => x.toFixed(2) + " m"),
            faixa("Distância da câmera", 0.8, 4, 0.1, +c.ombroDistancia || 1.8, (x) => { c.ombroDistancia = x; m.salvarCfg(); }, (x) => x.toFixed(1) + " m")) : null,
          modo === "primeira" ? grupo(t("Primeira pessoa"),
            faixa("Campo de visão", 50, 110, 1, +c.fovPrimeira || 75, (x) => { c.fovPrimeira = x; m.salvarCfg(); }, (x) => Math.round(x) + "°"),
            el("p", { class: "jogo-nota" }, t("Olhe para baixo para ver o corpo. A cabeça acompanha o olhar, e a câmera segue a cabeça nos movimentos grandes (um mortal, uma dança)."))) : null,
          grupo(t("Câmera"),
            faixa("Sensibilidade da câmera", 0.3, 2.5, 0.1, c.sensibilidade || 1, (x) => { c.sensibilidade = x; m.salvarCfg(); }, (x) => x.toFixed(1) + "×"),
            chave("Inverter a câmera (para cima e para baixo)", c.inverterY, (x) => { c.inverterY = x; m.salvarCfg(); })),
          grupo("", el("p", { class: "jogo-nota" }, t("Arrastar gira a câmera; a rodinha do mouse (ou a pinça, no celular) aproxima e afasta. A câmera não atravessa as paredes."))));
      }
      if (secao === "ajuda") return [...linhas(s.ajuda, secao), el("hr"), grupo("", el("p", { class: "jogo-nota" }, t("As expressões: clique nelas embaixo da tela ou aperte de 1 a 9 no teclado. Os outros na sala veem.")))];
      if (secao === "acessibilidade") {
        const a = lerAcesso();
        return [
          grupo(t("Leitura"),
            segmentos("Tamanho da interface", [[1, "Normal"], [1.15, "Grande"], [1.3, "Maior"]], a.tamanho, (v) => gravarAcesso({ tamanho: +v })),
            chave("Alto contraste", a.contraste, (v) => { gravarAcesso({ contraste: v, temaAntes: v ? C.temas.atual : lerAcesso().temaAntes }); C.temas.definir(v ? "contrast" : (lerAcesso().temaAntes || "webc")); }, "Cores fortes: texto claro no preto")),
          grupo(t("Movimento na tela"),
            chave("Reduzir animações", a.reduzir, (v) => gravarAcesso({ reduzir: v }), "Sem as transições entre as páginas e sem os efeitos que se mexem"),
            chave("Mostrar os números das expressões", a.numeros !== false, (v) => gravarAcesso({ numeros: v }))),
          grupo(t("Menu e opções"),
            segmentos("Opacidade do menu e das opções", [[1, "100%"], [0.85, "85%"], [0.7, "70%"], [0.55, "55%"], [0.4, "40%"]], [1, 0.85, 0.7, 0.55, 0.4].reduce((m, v) => (Math.abs(v - (+a.opacidadeMenu || 1)) < Math.abs(m - (+a.opacidadeMenu || 1)) ? v : m), 1), (v) => gravarAcesso({ opacidadeMenu: +v })),
            el("p", { class: "jogo-nota" }, t("Menos opacidade deixa ver o jogo atrás do menu e da janela Opções; o texto continua igual."))),
        ];
      }
      if (secao === "grafico") {
        const luz = p && p.luzCfg;
        return [
          grupo(t("Desempenho"),
            p && p.definirResolucao ? segmentos("Resolução", [[0.5, "50%"], [0.75, "75%"], [1, "100%"]], [0.5, 0.75, 1].reduce((m, v) => (Math.abs(v - p.resolucao) < Math.abs(m - p.resolucao) ? v : m), 1), (v) => p.definirResolucao(+v)) : null,
            luz ? chave("Luz e sombras realistas (no cenário)", luz.realista, (v) => p.definirLuz({ realista: v }), "Um sol com sombra, céu e tons naturais. Desligado, a luz de frente de sempre (mais leve).") : null,
            luz ? chave("Sombras", luz.sombras, (v) => p.definirLuz({ sombras: v }), "As sombras pesam: no celular, desligue se ficar lento.") : null),
          grupo(t("Mais"), ...linhas([
            { rotulo: "Luz, sombras e luzes do mapa...", acao: () => ctx.cenario(), ativo: () => !!p },
            ...s.exibir.filter((i) => i === "-" || !/^(Rosto|Busto|Corpo inteiro|Posição e tamanho|Mostrar atalhos|Luz e sombras realistas|Mostrar áreas)/.test(i.rotulo)),
          ], secao)),
        ];
      }
      if (secao === "controle") {
        const m = p && p.mundo;
        return [
          m ? grupo(t("Andar"),
            faixa("Velocidade ao andar", 0.5, 2.5, 0.1, m.cfg.velocidade || 1, (v) => { m.cfg.velocidade = v; m.salvarCfg(); }, (v) => v.toFixed(1) + "×"),
            chave("Pés no chão (IK): as pernas se ajustam a degraus e rampas", m.cfg.ik !== false, (v) => { m.cfg.ik = v; m.salvarCfg(); })) : grupo("", el("p", { class: "jogo-nota" }, t("Abra uma personagem VRoid (.vrm) para mudar a câmera e o andar."))),
          m ? grupo(t("Boneco de pano"),
            el("button", { type: "button", class: "lnux-botao", id: "jogo-ragdoll", onclick: () => { fecharOpcoes(); m.alternarRagdoll(); } }, t(m.caido ? "Levantar (R)" : "Cair agora (R)")),
            chave("Cair como boneco de pano ao despencar de muito alto", m.cfg.ragdollQueda !== false, (v) => { m.cfg.ragdollQueda = v; m.salvarCfg(); }),
            el("p", { class: "jogo-nota" }, t("Caído, aperte R de novo ou ande para levantar."))) : null,
          grupo(t("No celular"), el("p", { class: "jogo-nota" }, t("No celular: o direcional na tela anda; arrastar gira a câmera; a pinça aproxima."))),
        ].filter(Boolean);
      }
      if (secao === "itens") {
        const it = ctx.itens;
        if (!it) return [];
        const lista = el("div", { class: "jogo-inventario" }, el("p", { class: "jogo-nota" }, t("Carregando...")));
        it.lista().then((l) => {
          const mao = it.naMao();
          lista.replaceChildren(...(l.length ? l.map((x) => {
            const naMao = !!(mao && mao.reg.id === x.id);
            const mini = x.miniatura instanceof Blob ? el("img", { class: "jogo-inv-mini", src: URL.createObjectURL(x.miniatura), alt: "" }) : el("span", { class: "jogo-inv-mini", html: ICONES.itens });
            return el("div", { class: "jogo-inv" + (naMao ? " na-mao" : ""), "data-item": x.id }, mini,
              el("span", { class: "jogo-inv-nome" }, el("b", { translate: "no" }, x.nome), el("span", { class: "fraco pequeno" }, x.origem === "loja" ? t("da loja") : t("criado por você"))),
              el("div", { class: "jogo-inv-botoes" },
                naMao ? el("button", { type: "button", class: "lnux-botao pequeno", "data-acao": "guardar", onclick: () => { it.guardar(); abrirOpcoes("itens"); } }, t("Guardar"))
                  : el("button", { type: "button", class: "lnux-botao primario pequeno", "data-acao": "segurar", onclick: () => it.segurar(x.id).then(() => abrirOpcoes("itens")).catch(LNUX.erro) }, t("Segurar")),
                naMao ? el("button", { type: "button", class: "lnux-botao pequeno", "data-acao": "usar", onclick: () => it.usar() }, t("Usar")) : null,
                el("button", { type: "button", class: "lnux-botao pequeno", "data-acao": "ajustar", onclick: () => { fecharOpcoes(); it.ajustar(x.id); } }, t("Ajustar no meu corpo"))));
          }) : [el("p", { class: "jogo-nota" }, t("Nenhum item ainda. Crie um no Estúdio de itens ou baixe da loja."))]));
        }).catch(LNUX.erro);
        return [
          grupo(t("Meus itens"), lista),
          grupo("", el("div", { class: "estudio-botoes" },
            el("button", { type: "button", class: "lnux-botao", onclick: () => { fecharOpcoes(); it.criar(); } }, t("Criar um item...")),
            el("button", { type: "button", class: "lnux-botao", onclick: () => { fecharOpcoes(); it.loja(); } }, t("Itens da loja...")))),
          grupo("", el("p", { class: "jogo-nota" }, t("Com o item na mão: E usa (segurando, o lançador dispara sem parar), G esconde e mostra. Os outros na sala veem o item e o que ele faz."))),
        ];
      }
      if (secao === "teclado") {
        const tecla = (k, o) => el("div", { class: "jogo-tecla" }, el("span", { class: "jogo-teclas" }, ...k.split(" ").map((x) => el("kbd", {}, x))), el("span", {}, t(o)));
        return [
          grupo(t("Andar"), tecla("W A S D", "Andar (ou as setas)"), tecla("Shift", "Correr"), tecla("Espaço", "Pular"),
            tecla("V", "Voar (quem criou a sala)"), tecla("Espaço C", "Subir e descer, voando"), tecla("R", "Cair como boneco de pano (e levantar)")),
          grupo(t("Itens"), tecla("E", "Usar o item (segurando: sem parar)"), tecla("G", "Esconder e mostrar o item")),
          grupo(t("Câmera"), tecla("F", "Trocar a câmera (terceira pessoa, ombro, primeira pessoa)"), tecla("Q", "Câmera no ombro (de novo: troca o lado)")),
          grupo(t("Personagem"), tecla("1 … 9", "Expressões")),
          grupo(t("Janelas"), tecla("Enter", "Abrir o bate-papo"), tecla("Esc", "Abrir e fechar as Opções")),
        ];
      }
      return [];
    }

    // ── as teclas: 1 a 9 (expressões) e Enter (bate-papo) ──
    const digitando = (e) => { const a = e.target; return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))); };
    document.addEventListener("keydown", (e) => {
      if (raiz.dataset.modo !== "jogar" || e.ctrlKey || e.metaKey || e.altKey || digitando(e)) return;
      if (opcoes || document.querySelector(".lnux-fundo-modal, .lnux-menu, .tela-inicio, .loja:not(.em-pagina), .galeria-temas") || (C.webc && C.webc.visivel)) return;
      if (e.key === "Escape") { // o Esc abre as Opções do jogo (com o bate-papo aberto, fecha ele primeiro)
        e.preventDefault();
        if (raiz.dataset.chat === "aberto") alternarChat(false); else abrirOpcoes();
        return;
      }
      const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (n && !e.shiftKey) { e.preventDefault(); expressar(EXPRESSOES[+n[2] - 1].id); return; }
      if (e.key === "Enter" && raiz.dataset.chat !== "aberto") { e.preventDefault(); alternarChat(true); }
    });
    document.getElementById("texto").addEventListener("keydown", (e) => { if (e.key === "Escape" && raiz.dataset.modo === "jogar") alternarChat(false); });

    desenharExpressoes();
    C.aoMudarIdioma(() => { desenharExpressoes(); if (opcoes) abrirOpcoes(opcoes.dataset.secao || ""); });
    return {
      EXPRESSOES, expressar, abrirOpcoes, fecharOpcoes, alternarChat, novaMensagem, atualizarItem,
      /** A emoção mudou por outro caminho (ex.: a captura pela câmera): a barra acompanha. */
      emocaoMudou(nome) { emocaoAtual = nome; marcar(); },
      get opcoesAbertas() { return !!opcoes; },
      /** O botão ☰ (no alto, no lugar dos botões do app). */
      botaoMenu: () => el("button", { type: "button", class: "jogo-menu-botao", id: "jogo-menu", title: "Opções", "aria-label": "Opções", "aria-haspopup": "dialog", onclick: () => abrirOpcoes() }, icone("menu")),
    };
  };
})();
