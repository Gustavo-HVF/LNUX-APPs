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
  const SECOES = [["personagem", "Personagem"], ["sala", "Sala"], ["ajuda", "Ajuda"], ["acessibilidade", "Acessibilidade"], ["grafico", "Gráfico"], ["controle", "Controle"]];
  const icone = (nome, classe = "jogo-svg") => el("span", { class: classe, html: ICONES[nome] });

  // ── acessibilidade (guardada neste navegador) ───────────────────────
  const CHAVE_ACESSO = "webc.acessibilidade";
  const lerAcesso = () => { try { return { tamanho: 1, reduzir: false, contraste: false, numeros: true, ...JSON.parse(localStorage.getItem(CHAVE_ACESSO) || "{}") }; } catch (e) { return { tamanho: 1, reduzir: false, contraste: false, numeros: true }; } };
  function aplicarAcesso(a = lerAcesso()) {
    const r = document.documentElement;
    r.style.setProperty("--webc-escala", String(a.tamanho || 1));
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
      if (raiz.dataset.chat === "aberto") return;
      naoLidas++;
      contador.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
      contador.hidden = false;
    }

    // ── o ☰ e a janela Opções ──
    const fecharOpcoes = () => { if (opcoes) { opcoes.remove(); opcoes = null; document.removeEventListener("keydown", teclaOpcoes, true); } };
    function teclaOpcoes(e) {
      if (e.key !== "Escape" || document.querySelector(".lnux-fundo-modal")) return;
      e.preventDefault(); e.stopPropagation();
      if (opcoes && opcoes.dataset.secao) abrirOpcoes(); else fecharOpcoes();
    }
    /** Abre a janela Opções (os seis cartões) ou, com secao, uma das seções. */
    function abrirOpcoes(secao = "") {
      const novo = !opcoes;
      if (novo) {
        opcoes = el("div", { class: "jogo-opcoes-fundo", onclick: (e) => { if (e.target === opcoes) fecharOpcoes(); } });
        document.body.append(opcoes);
        document.addEventListener("keydown", teclaOpcoes, true);
      }
      opcoes.dataset.secao = secao;
      const titulo = secao ? t(SECOES.find((s) => s[0] === secao)[1]) : t("Opções");
      const corpo = secao ? el("div", { class: "jogo-opcoes-lista" }, ...desenharSecao(secao))
        : el("div", { class: "jogo-opcoes-grade" }, SECOES.map(([id, nome]) => el("button", { type: "button", class: "jogo-opcao", "data-secao": id, onclick: () => abrirOpcoes(id) },
          el("span", { class: "jogo-opcao-icone", html: ICONES[id] }), el("span", { class: "jogo-opcao-nome" }, nome))));
      opcoes.replaceChildren(el("section", { class: "jogo-opcoes" + (novo ? " entrando" : ""), role: "dialog", "aria-modal": "true", "aria-label": titulo },
        el("header", { class: "jogo-opcoes-topo" },
          secao ? el("button", { type: "button", class: "jogo-opcoes-voltar", "aria-label": "Voltar", title: "Voltar", onclick: () => abrirOpcoes() }, icone("voltar")) : null,
          el("h2", {}, secao ? el("span", {}, el("span", { class: "fraco-claro" }, t("Opções") + " › "), titulo) : titulo),
          el("button", { type: "button", class: "jogo-opcoes-fechar", "aria-label": "Fechar", title: "Fechar", onclick: fecharOpcoes }, icone("fechar"))),
        corpo));
      const foco = opcoes.querySelector(secao ? ".jogo-opcoes-lista button:not(:disabled), .jogo-opcoes-lista input" : ".jogo-opcao");
      if (foco) foco.focus();
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
      if (secao === "ajuda") return [...linhas(s.ajuda, secao), el("hr"), grupo("", el("p", { class: "jogo-nota" }, t("As expressões: clique nelas embaixo da tela ou aperte de 1 a 9 no teclado. Os outros na sala veem.")))];
      if (secao === "acessibilidade") {
        const a = lerAcesso();
        return [
          grupo("", segmentos("Idioma", Object.entries(C.IDIOMAS).map(([k, v]) => [k, v.nome]), C.idioma, (k) => { C.definirIdioma(k); abrirOpcoes(secao); })),
          grupo(t("Leitura"),
            segmentos("Tamanho da interface", [[1, "Normal"], [1.15, "Grande"], [1.3, "Maior"]], a.tamanho, (v) => gravarAcesso({ tamanho: +v })),
            chave("Alto contraste", a.contraste, (v) => { gravarAcesso({ contraste: v, temaAntes: v ? C.temas.atual : lerAcesso().temaAntes }); C.temas.definir(v ? "contrast" : (lerAcesso().temaAntes || "webc")); }, "Cores fortes: texto claro no preto")),
          grupo(t("Movimento na tela"),
            chave("Reduzir animações", a.reduzir, (v) => gravarAcesso({ reduzir: v }), "Sem as transições entre as páginas e sem os efeitos que se mexem"),
            chave("Mostrar os números das expressões", a.numeros !== false, (v) => gravarAcesso({ numeros: v }))),
        ];
      }
      if (secao === "grafico") {
        const luz = p && p.luzCfg;
        const temaBotao = el("button", { type: "button", class: "jogo-item", onclick: (e) => C.escolherTema(e.currentTarget) }, el("span", { class: "rotulo" }, t("Tema")), el("span", { class: "jogo-valor" }, C.temas.nome(C.temas.TEMAS.find((x) => x.id === C.temas.atual) || C.temas.TEMAS[0])));
        return [
          grupo(t("Aparência"), temaBotao),
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
        const tecla = (k, o) => el("div", { class: "jogo-tecla" }, el("span", { class: "jogo-teclas" }, ...k.split(" ").map((x) => el("kbd", {}, x))), el("span", {}, o));
        return [
          grupo(t("Teclado"),
            tecla("W A S D", "Andar (ou as setas)"), tecla("Shift", "Correr"), tecla("Espaço", "Pular"), tecla("1 … 9", "Expressões"),
            tecla("V", "Voar (quem criou a sala)"), tecla("Espaço C", "Subir e descer, voando"), tecla("Enter", "Abrir o bate-papo"), tecla("Esc", "Fechar")),
          m ? grupo(t("Câmera e andar"),
            faixa("Sensibilidade da câmera", 0.3, 2.5, 0.1, m.cfg.sensibilidade || 1, (v) => { m.cfg.sensibilidade = v; m.salvarCfg(); }, (v) => v.toFixed(1) + "×"),
            chave("Inverter a câmera (para cima e para baixo)", m.cfg.inverterY, (v) => { m.cfg.inverterY = v; m.salvarCfg(); }),
            faixa("Velocidade ao andar", 0.5, 2.5, 0.1, m.cfg.velocidade || 1, (v) => { m.cfg.velocidade = v; m.salvarCfg(); }, (v) => v.toFixed(1) + "×")) : grupo("", el("p", { class: "jogo-nota" }, t("Abra uma personagem VRoid (.vrm) para mudar a câmera e o andar."))),
          grupo("", el("p", { class: "jogo-nota" }, t("No celular: o direcional na tela anda; arrastar gira a câmera; a pinça aproxima."))),
        ];
      }
      return [];
    }

    // ── as teclas: 1 a 9 (expressões) e Enter (bate-papo) ──
    const digitando = (e) => { const a = e.target; return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))); };
    document.addEventListener("keydown", (e) => {
      if (raiz.dataset.modo !== "jogar" || e.ctrlKey || e.metaKey || e.altKey || digitando(e)) return;
      if (opcoes || document.querySelector(".lnux-fundo-modal, .lnux-menu, .tela-inicio, .loja:not(.em-pagina)") || (C.webc && C.webc.visivel)) return;
      const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (n && !e.shiftKey) { e.preventDefault(); expressar(EXPRESSOES[+n[2] - 1].id); return; }
      if (e.key === "Enter" && raiz.dataset.chat !== "aberto") { e.preventDefault(); alternarChat(true); }
    });
    document.getElementById("texto").addEventListener("keydown", (e) => { if (e.key === "Escape" && raiz.dataset.modo === "jogar") alternarChat(false); });

    desenharExpressoes();
    C.aoMudarIdioma(() => { desenharExpressoes(); if (opcoes) abrirOpcoes(opcoes.dataset.secao || ""); });
    return {
      EXPRESSOES, expressar, abrirOpcoes, fecharOpcoes, alternarChat, novaMensagem,
      /** A emoção mudou por outro caminho (ex.: a captura pela câmera): a barra acompanha. */
      emocaoMudou(nome) { emocaoAtual = nome; marcar(); },
      get opcoesAbertas() { return !!opcoes; },
      /** O botão ☰ (no alto, no lugar dos botões do app). */
      botaoMenu: () => el("button", { type: "button", class: "jogo-menu-botao", id: "jogo-menu", title: "Opções", "aria-label": "Opções", "aria-haspopup": "dialog", onclick: () => abrirOpcoes() }, icone("menu")),
    };
  };
})();
