/*
 * WEBC (web chat) — o site: o cabeçalho (o logo, a paleta de temas, o idioma e você), o início com os três cartões
 * (LOJA, SALA, PERFIL), as páginas (a loja e as salas, de js/loja.js e js/salas.js, e o perfil, daqui), as transições
 * entre elas e a tela de carregamento ao entrar numa sala. Dentro de uma sala, o site some e fica o jogo; o logo do
 * WEBC no alto traz o site de volta (a sala continua, e uma faixa avisa "você está na sala").
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);
  const reduzir = () => "reduzir" in document.documentElement.dataset || !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); // Opções › Acessibilidade também
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const svg = (html) => { const s = el("span", { class: "webc-svg", "aria-hidden": "true" }); s.innerHTML = html; return s; };

  /** O logo: o balão de fala com "WEBC" (preto, com a borda em relevo). */
  C.logoWebc = function (altura = 44) {
    const s = el("span", { class: "webc-logo-svg", "aria-hidden": "true" });
    s.innerHTML = `<svg viewBox="0 0 132 104" height="${altura}" width="${Math.round(altura * 132 / 104)}">` +
      '<path d="M16 8h94a16 16 0 0 1 16 16v42a16 16 0 0 1-16 16H96l12 18-31-18H16A16 16 0 0 1 0 66V24A16 16 0 0 1 16 8Z" fill="#c9c9c9"/>' +
      '<path d="M22 3h94a14 14 0 0 1 14 14v42a14 14 0 0 1-14 14h-14l10 17-28-17H22A14 14 0 0 1 8 59V17A14 14 0 0 1 22 3Z" fill="#000" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<text x="69" y="50" text-anchor="middle" font-family="Lato, \'Segoe UI\', Roboto, Arial, sans-serif" font-weight="700" font-size="32" letter-spacing="-.5" fill="#fff">WEBC</text></svg>';
    return s;
  };
  const ICONES = {
    loja: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M12 22h40l-3 32H15z"/><path d="M23 22v-4a9 9 0 0 1 18 0v4"/><path d="M24 33c2 4 14 4 16 0"/></svg>',
    sala: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M10 54h44"/><path d="M16 54V14h22v40"/><circle cx="32" cy="35" r="1.8" fill="currentColor"/><path d="M38 20l10 4v30"/></svg>',
    perfil: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="24" r="10"/><path d="M14 54c2-11 9-16 18-16s16 5 18 16"/></svg>',
    globo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/></svg>',
    busca: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>',
    filtro: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 4h18l-7 8.5V20l-4 2v-9.5Z"/></svg>',
    coracao: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.2 1.7-2 3.1-3.2 5.3-3.2 3.7 0 5.8 3.9 4.3 7.2C19.5 16.4 12 21 12 21Z"/></svg>',
    baixar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
    salvar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    chatbot: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M14 16h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H30l-10 8v-8h-6a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6Z"/><circle cx="24" cy="31" r="2.2" fill="currentColor"/><circle cx="32" cy="31" r="2.2" fill="currentColor"/><circle cx="40" cy="31" r="2.2" fill="currentColor"/><path d="M32 16V9m-3 0h6"/></svg>',
    novidades: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M32 8l6 14 15 1-11.5 10 3.5 15L32 40l-13 8 3.5-15L11 23l15-1Z"/></svg>',
    widgets: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><rect x="10" y="10" width="19" height="19" rx="5"/><rect x="35" y="10" width="19" height="19" rx="5"/><rect x="10" y="35" width="19" height="19" rx="5"/><path stroke-linecap="round" d="M44.5 37v15M37 44.5h15"/></svg>',
    mais: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  C.iconeWebc = (nome) => svg(ICONES[nome] || "");

  const estado = { raiz: null, conteudo: null, pagina: "", opcoes: {}, atual: null, ctx: null, trocando: null };

  // ── o cabeçalho ──────────────────────────────────────────────────────

  function cabecalho() {
    const tema = el("button", { type: "button", class: "webc-icone", id: "webc-tema", title: "Tema", "aria-label": "Tema", onclick: (e) => C.escolherTema(e.currentTarget) }, C.iconePaleta(24));
    const idioma = el("button", { type: "button", class: "webc-icone webc-idioma", id: "webc-idioma", "aria-label": "Idioma", title: "Idioma", onclick: (e) => menuIdioma(e.currentTarget) },
      C.iconeWebc("globo"), el("span", { class: "webc-idioma-curto" }));
    const eu = el("button", { type: "button", class: "webc-eu", id: "webc-eu", "aria-haspopup": "true", onclick: (e) => menuEu(e.currentTarget) });
    return el("header", { class: "webc-topo" },
      el("button", { type: "button", class: "webc-logo", "aria-label": "WEBC — início", title: "Início", onclick: () => ir("inicio") }, C.logoWebc(46)),
      el("nav", { class: "webc-nav", "aria-label": "Páginas" }, ["loja", "sala", "perfil"].map((p) => el("button", { type: "button", "data-ir": p, onclick: () => ir(p) }, { loja: "Loja", sala: "Sala", perfil: "Perfil" }[p]))),
      el("div", { class: "webc-acoes" }, tema, el("span", { class: "webc-separador", "aria-hidden": "true" }), idioma, eu));
  }
  function desenharEu() {
    if (!estado.raiz) return;
    const b = estado.raiz.querySelector("#webc-eu"), conta = C.contas && C.contas.eu;
    const nome = conta ? conta.nome : (estado.ctx && estado.ctx.salas.nome()) || t("Visitante");
    b.replaceChildren(el("span", { class: "webc-eu-nome", translate: "no" }, nome), conta ? C.fotoDaConta(conta, 46) : el("span", { class: "foto-conta webc-sem-foto", style: { width: "46px", height: "46px" } }, C.iconeWebc("perfil")));
    b.setAttribute("aria-label", t("Você: {nome}", { nome }));
    const curto = estado.raiz.querySelector(".webc-idioma-curto");
    if (curto) curto.textContent = C.IDIOMAS[C.idioma].curto;
    for (const n of estado.raiz.querySelectorAll(".webc-nav [data-ir]")) n.classList.toggle("ativa", n.dataset.ir === estado.pagina);
  }
  /** Um menu pequeno embaixo de um botão: itens = [{rotulo, acao, marcado, perigo}] ou "-". */
  function menuPequeno(botao, itens, classe = "") {
    const velho = document.querySelector(".webc-menu");
    if (velho) { const era = velho.dono === botao; velho.remove(); if (era) return; }
    const m = el("div", { class: "webc-menu " + classe, role: "menu" }, itens.filter(Boolean).map((i) => i === "-" ? el("hr") :
      el("button", { type: "button", role: "menuitem", class: (i.marcado ? "marcado " : "") + (i.perigo ? "perigo" : ""), "data-acao": i.id || "", onclick: () => { fechar(); i.acao(); } }, i.rotulo)));
    m.dono = botao;
    document.body.append(m);
    const r = botao.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + "px";
    m.style.right = Math.max(8, Math.round(innerWidth - r.right)) + "px";
    const fora = (e) => { if (!m.contains(e.target) && !botao.contains(e.target)) fechar(); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    function fechar() { m.remove(); document.removeEventListener("pointerdown", fora, true); document.removeEventListener("keydown", tecla); }
    setTimeout(() => { document.addEventListener("pointerdown", fora, true); document.addEventListener("keydown", tecla); }, 0);
    const primeiro = m.querySelector("button");
    if (primeiro) primeiro.focus();
  }
  function menuIdioma(botao) {
    menuPequeno(botao, Object.entries(C.IDIOMAS).map(([k, v]) => ({ id: "idioma-" + k, rotulo: v.nome, marcado: C.idioma === k, acao: () => C.definirIdioma(k) })), "webc-menu-idioma");
  }
  function menuEu(botao) {
    const conta = C.contas && C.contas.eu, pub = (C.contas && C.contas.publico) || {}, ctx = estado.ctx;
    menuPequeno(botao, [
      { id: "perfil", rotulo: t("Meu perfil"), acao: () => ir("perfil") },
      conta ? null : { id: "nome", rotulo: t("Trocar o meu nome"), acao: () => C.trocarNomeDoJogo().then(() => desenharEu()) },
      conta ? null : pub.contas ? { id: "entrar", rotulo: t("Entrar na conta"), acao: () => C.janelaConta("entrar") } : null,
      conta ? null : pub.contas && pub.contas_email !== false ? { id: "criar", rotulo: t("Criar conta"), acao: () => C.janelaConta("criar") } : null,
      LNUX.ponte && LNUX.ponte.disponivel && C.janelaContasDono ? { id: "contas-dono", rotulo: t("Contas e e-mail do servidor..."), acao: () => C.janelaContasDono().catch(LNUX.erro) } : null,
      ctx && ctx.conversar ? { id: "conversar", rotulo: t("Conversar com a personagem (chat bot)"), acao: () => ctx.conversar() } : null,
      conta ? "-" : null,
      conta ? { id: "sair", rotulo: t("Sair da conta"), perigo: true, acao: () => C.contas.sair() } : null,
    ]);
  }

  // ── as páginas e as transições ───────────────────────────────────────

  const PAGINAS = {
    inicio: paginaInicio,
    novidades: paginaNovidades,
    loja: (pag, op) => paginaDeOverlay(pag, () => C.abrirLoja(estado.ctx.loja, { dentro: pag, pagina: true, tipo: op.tipo || "personagem", item: op.item, busca: op.busca })),
    sala: (pag, op) => paginaDeOverlay(pag, () => C.abrirSalas(estado.ctx.salas, { dentro: pag, pagina: true, codigo: op.codigo || "" })),
    perfil: paginaPerfil,
  };
  /** A loja e as salas: os mesmos de antes, agora dentro da página (sem o botão de fechar). */
  function paginaDeOverlay(pag, abrir) {
    const p = abrir();
    p.then((entrou) => { if (entrou && estado.pagina === "sala") { /* entrou numa sala: o jogo aparece (quem esconde o site é o app) */ } }).catch(() => {});
    return { fechar: () => p.fechar(), objeto: p };
  }
  /**
   * Vai para uma página (inicio, loja, sala, perfil), com a transição. opcoes: {id (perfil), tipo/item/busca (loja),
   * codigo (sala)}.
   */
  async function ir(pagina, opcoes = {}) {
    if (!estado.raiz || !PAGINAS[pagina]) return;
    mostrar();
    const minha = (estado.trocando = {});
    const velho = estado.conteudo.firstElementChild;
    if (velho && !opcoes.semTransicao && !reduzir()) {
      velho.classList.add("webc-sai");
      await esperar(170);
      if (estado.trocando !== minha) return;
    }
    if (estado.atual) { try { estado.atual.fechar(); } catch (e) { console.warn(e); } }
    estado.atual = null;
    estado.pagina = pagina;
    estado.opcoes = opcoes;
    estado.raiz.dataset.pagina = pagina;
    const pag = el("div", { class: "webc-pagina webc-entra", "data-pagina": pagina });
    estado.conteudo.replaceChildren(pag);
    estado.conteudo.scrollTop = 0;
    desenharEu();
    try { estado.atual = (await PAGINAS[pagina](pag, opcoes)) || null; } catch (e) { LNUX.erro(e); }
    requestAnimationFrame(() => requestAnimationFrame(() => pag.classList.remove("webc-entra")));
  }

  /** O início: os três cartões grandes, os quadrados menores (chat bot, novidades e widgets) e os widgets da pessoa. */
  function paginaInicio(pag) {
    const cartao = (id, titulo, sub) => el("button", { type: "button", class: "webc-cartao", "data-ir": id, onclick: () => ir(id) },
      el("span", { class: "webc-cartao-icone" }, C.iconeWebc(id)), el("span", { class: "webc-cartao-titulo" }, titulo), el("span", { class: "webc-cartao-sub" }, sub));
    const quadrado = (id, titulo, sub, acao) => el("button", { type: "button", class: "webc-quadrado", "data-quadrado": id, onclick: acao },
      el("span", { class: "webc-quadrado-icone" }, C.iconeWebc(id)), el("span", { class: "webc-quadrado-texto" }, el("b", {}, titulo), el("span", {}, sub)));
    const area = el("section", { class: "webc-widgets", "aria-label": "Widgets" });
    const widgets = C.widgets.montar(area, { ir, escolher: () => C.widgets.escolher().then(() => widgets.desenhar()) });
    const ctx = estado.ctx;
    pag.append(el("div", { class: "webc-inicio" },
      el("div", { class: "webc-cartoes" },
        cartao("loja", "LOJA", "Personagens, mapas e animações"),
        cartao("sala", "SALA", "Entre numa sala ou crie a sua"),
        cartao("perfil", "PERFIL", "Sua foto, bio, salvos e amigos")),
      el("div", { class: "webc-quadrados" },
        ctx && ctx.conversar ? quadrado("chatbot", "Chat bot", "Converse com a personagem", () => ctx.conversar()) : null,
        quadrado("novidades", "Novidades", "O que há de novo", () => ir("novidades")),
        quadrado("widgets", "Widgets", "Adicione ao seu início", () => C.widgets.escolher().then(() => widgets.desenhar()))),
      area));
    return { fechar() { widgets.parar(); } };
  }

  // ── as novidades ─────────────────────────────────────────────────────

  /** O que mudou no WEBC (os mais novos primeiro). */
  const MUDANCAS = [
    "A tela do jogo: as expressões de 1 a 9, o bate-papo no canto e a janela Opções (personagem, sala, ajuda, acessibilidade, gráfico e controle).",
    "No início: o chat bot, as novidades e os widgets.",
    "O nome é pedido na tela de entrar, também para quem joga sem conta.",
    "A loja com # para achar, curtidas e quantas pessoas baixaram.",
    "O perfil com capa, salvos e amigos.",
    "Português, English e 日本語, e os temas do VLC-Web.",
    "Vídeo numa tela da sala e luz calculada por raios.",
  ];
  async function paginaNovidades(pag) {
    const loja = el("div", { class: "webc-grade novidades-loja" }, el("p", { class: "fraco" }, t("Carregando...")));
    const salas = el("div", { class: "novidades-salas" }, el("p", { class: "fraco" }, t("Carregando...")));
    pag.append(el("section", { class: "webc-painel novidades-pagina" },
      el("header", { class: "webc-painel-topo" }, el("h1", { class: "webc-painel-titulo" }, "NOVIDADES")),
      el("section", { class: "novidades-secao" }, el("h2", {}, "Chegou na loja"), loja),
      el("section", { class: "novidades-secao" }, el("h2", {}, "Salas novas"), salas),
      el("section", { class: "novidades-secao" }, el("h2", {}, "O que mudou no WEBC"), el("ul", { class: "novidades-lista" }, MUDANCAS.map((m) => el("li", {}, m))))));
    C.loja.lista().then((r) => {
      const novos = r.itens.slice().sort((a, b) => b.criado - a.criado).slice(0, 8);
      loja.replaceChildren(...(novos.length ? novos.map((i) => C.cartaoDaLoja(i, { aoAbrir: () => ir("loja", { tipo: i.tipo, item: i.id }) })) : [el("p", { class: "fraco" }, t("Nada na loja ainda."))]));
    }).catch(() => loja.replaceChildren(el("p", { class: "fraco" }, t("A loja não respondeu."))));
    C.Sala.lista().then((r) => {
      const novas = (r.salas || []).slice().sort((a, b) => b.criada - a.criada).slice(0, 6);
      salas.replaceChildren(...(novas.length ? novas.map((s) => el("button", { type: "button", class: "novidades-sala", "data-codigo": s.codigo, onclick: () => ir("sala", { codigo: s.codigo }) },
        el("b", { translate: "no" }, s.nome), el("span", { class: "fraco pequeno" }, t("por {autor}", { autor: s.criador || "?" }) + " · " + `👥 ${s.pessoas}/${s.max}`))) : [el("p", { class: "fraco" }, t("Nenhuma sala pública aberta agora."))]));
    }).catch(() => salas.replaceChildren(el("p", { class: "fraco" }, t("O servidor não respondeu."))));
    return { fechar() {} };
  }

  // ── o perfil ─────────────────────────────────────────────────────────

  async function paginaPerfil(pag, { id } = {}) {
    const eu = C.contas && C.contas.eu;
    const alvo = id || (eu && eu.id);
    const caixa = el("section", { class: "webc-painel perfil-pagina" });
    pag.append(caixa);
    if (!alvo) {
      const pub = (C.contas && C.contas.publico) || {};
      caixa.append(el("div", { class: "perfil-banner" }), el("div", { class: "perfil-foto-grande" }, el("span", { class: "foto-conta webc-sem-foto", style: { width: "150px", height: "150px" } }, C.iconeWebc("perfil"))),
        el("h1", { class: "perfil-nome" }, t("Visitante")),
        el("p", { class: "perfil-vazio" }, pub.contas ? t("Entre na sua conta para ter um perfil: foto, bio, os itens que você salvar na loja e amigos.") : t("Este servidor não tem contas.")),
        pub.contas ? el("div", { class: "perfil-acoes" },
          el("button", { type: "button", class: "lnux-botao primario", id: "perfil-entrar", onclick: () => C.janelaConta("entrar") }, t("Entrar")),
          pub.contas_email !== false ? el("button", { type: "button", class: "lnux-botao", onclick: () => C.janelaConta("criar") }, t("Criar conta")) : null) : null);
      return { fechar() {} };
    }
    const meu = !!(eu && alvo === eu.id);
    caixa.append(el("p", { class: "fraco perfil-carregando" }, t("Carregando...")));
    let p;
    try { p = meu ? await C.contas.carregar() : await C.contas.perfil(alvo); } catch (e) { caixa.replaceChildren(el("p", { class: "perfil-vazio" }, e.message)); return { fechar() {} }; }
    if (!p) { caixa.replaceChildren(el("p", { class: "perfil-vazio" }, t("Essa conta não existe."))); return { fechar() {} }; }
    const capa = C.contas.imagem(p, "capa");
    const acoes = el("div", { class: "perfil-acoes" });
    const desenharAcoes = (relacao) => {
      if (meu) {
        acoes.replaceChildren(el("button", { type: "button", class: "lnux-botao primario", id: "perfil-editar", onclick: () => C.janelaPerfil().then(() => ir("perfil", { semTransicao: true })).catch(LNUX.erro) }, t("Editar perfil")),
          el("button", { type: "button", class: "lnux-botao", onclick: () => C.contas.sair() }, t("Sair da conta")));
        return;
      }
      if (!eu) { acoes.replaceChildren(); return; }
      const amizade = async (acao) => { try { const r = await C.contas.amizade(acao, p.id); desenharAcoes(r.relacao); } catch (e) { LNUX.erro(e); } };
      const b = (rotulo, acao, classe = "") => el("button", { type: "button", class: "lnux-botao " + classe, id: "perfil-amizade", "data-relacao": relacao || "", onclick: () => amizade(acao) }, rotulo);
      acoes.replaceChildren(relacao === "amigo" ? b(t("✓ Amigos (desfazer)"), "desfazer") : relacao === "enviado" ? b(t("Pedido enviado (cancelar)"), "desfazer")
        : relacao === "recebido" ? b(t("Aceitar o pedido de amizade"), "aceitar", "primario") : b(t("Adicionar amigo"), "pedir", "primario"));
    };
    desenharAcoes(p.relacao);
    const secao = (titulo, ...filhos) => el("section", { class: "perfil-secao" }, el("h2", {}, titulo), ...filhos);
    const salvos = el("div", { class: "perfil-salvos" });
    const amigos = el("div", { class: "perfil-amigos" });
    const pedidos = el("div", { class: "perfil-pedidos" });
    caixa.replaceChildren(
      el("div", { class: "perfil-banner", style: { background: capa ? `center / cover no-repeat url("${capa}")` : p.cor || "var(--destaque)" } }),
      el("div", { class: "perfil-foto-grande" }, C.fotoDaConta(p, 150)),
      el("h1", { class: "perfil-nome", translate: "no" }, p.nome),
      p.pronomes ? el("p", { class: "perfil-pronomes fraco", translate: "no" }, p.pronomes) : null,
      acoes,
      el("div", { class: "perfil-secoes" },
        secao(t("Bio"), p.bio ? el("p", { class: "perfil-bio", translate: "no" }, p.bio) : el("p", { class: "fraco" }, t("Sem bio.")),
          el("p", { class: "fraco pequeno" }, [p.local ? "📍 " + p.local : "", t("conta desde {data}", { data: new Date(p.desde * 1000).toLocaleDateString(C.IDIOMAS[C.idioma].lang) })].filter(Boolean).join(" · ")),
          p.links && p.links.length ? el("div", { class: "perfil-links" }, p.links.map((l) => el("a", { href: l, target: "_blank", rel: "noopener noreferrer nofollow", translate: "no" }, l.replace(/^https?:\/\//, "")))) : null),
        secao(t("Salvos"), salvos),
        secao(t("Amigos"), amigos),
        meu ? secao(t("Pedidos de amizade"), pedidos) : null));
    // os salvos: os itens da loja (personagens, mapas e animações)
    try {
      const itens = (await C.loja.lista()).itens, porId = new Map(itens.map((i) => [i.id, i]));
      const meus = (p.salvos || []).map((i) => porId.get(i)).filter(Boolean);
      const grupo = (tipo, titulo) => {
        const l = meus.filter((i) => i.tipo === tipo);
        return el("div", { class: "perfil-grupo" }, el("h3", {}, titulo, el("span", { class: "conta" }, String(l.length))),
          l.length ? el("div", { class: "webc-grade pequena" }, l.map((i) => C.cartaoDaLoja(i, { aoAbrir: () => ir("loja", { tipo: i.tipo, item: i.id }) }))) : el("p", { class: "fraco pequeno" }, t("Nada salvo ainda.")));
      };
      salvos.replaceChildren(grupo("personagem", t("Personagens")), grupo("mundo", t("Mapas")), grupo("animacao", t("Animações")));
    } catch (e) { salvos.replaceChildren(el("p", { class: "fraco" }, t("A loja não respondeu."))); }
    // os amigos (e, no meu, os pedidos)
    const pessoa = (a, extra) => el("div", { class: "perfil-amigo" },
      el("button", { type: "button", class: "perfil-amigo-botao", onclick: () => ir("perfil", { id: a.id }) }, C.fotoDaConta(a, 64), el("span", { translate: "no" }, a.nome)), extra || null);
    amigos.replaceChildren(...((p.amigos || []).length ? p.amigos.map((a) => pessoa(a)) : [el("p", { class: "fraco pequeno" }, t("Nenhum amigo ainda."))]));
    if (meu) {
      const linha = (a, botoes) => pessoa(a, el("div", { class: "perfil-amigo-acoes" }, botoes));
      const mexer = async (acao, a) => { try { await C.contas.amizade(acao, a.id); ir("perfil", { semTransicao: true }); } catch (e) { LNUX.erro(e); } };
      const recebidos = (p.pedidos || []).map((a) => linha(a, [el("button", { type: "button", class: "lnux-botao primario pequeno", "data-aceitar": a.id, onclick: () => mexer("aceitar", a) }, t("Aceitar")),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => mexer("recusar", a) }, t("Recusar"))]));
      const enviados = (p.enviados || []).map((a) => linha(a, [el("span", { class: "fraco pequeno" }, t("pedido enviado")), el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => mexer("desfazer", a) }, t("Cancelar"))]));
      pedidos.replaceChildren(...(recebidos.length || enviados.length ? [...recebidos, ...enviados] : [el("p", { class: "fraco pequeno" }, t("Nenhum pedido."))]));
    }
    return { fechar() {} };
  }

  // ── a tela de carregamento (ao entrar numa sala) ─────────────────────

  C.carregandoSala = {
    elemento: null,
    mostrar(titulo) {
      this.fechar(true);
      const texto = el("p", { class: "webc-carregando-texto", role: "status" }, t("Procurando a sala..."));
      this.elemento = el("div", { class: "webc-carregando", role: "dialog", "aria-modal": "true", "aria-label": t("Entrando na sala") },
        el("div", { class: "webc-carregando-logo" }, C.logoWebc(96)),
        el("h2", { translate: "no" }, titulo || ""),
        el("div", { class: "webc-carregando-barra" }, el("span")),
        texto);
      document.body.append(this.elemento);
      this.texto = (s) => { texto.textContent = s; };
      requestAnimationFrame(() => this.elemento && this.elemento.classList.add("visivel"));
    },
    texto() {},
    fechar(agora) {
      const e = this.elemento;
      this.elemento = null;
      if (!e) return;
      if (agora || reduzir()) { e.remove(); return; }
      e.classList.remove("visivel");
      e.classList.add("saindo");
      setTimeout(() => e.remove(), 420);
    },
  };

  // ── mostrar e esconder o site (dentro de uma sala, fica o jogo) ──────

  function mostrar() {
    if (!estado.raiz) return;
    estado.raiz.hidden = false;
    document.documentElement.dataset.webc = "site";
    desenharFaixa();
    C.paginaPronta();
  }
  function esconder() {
    if (!estado.raiz) return;
    if (estado.atual) { try { estado.atual.fechar(); } catch (e) { console.warn(e); } }
    estado.atual = null;
    estado.conteudo.replaceChildren();
    estado.pagina = "";
    estado.raiz.hidden = true;
    document.documentElement.dataset.webc = "jogo";
  }
  /** Com uma sala aberta por trás: a faixa "Você está na sala ..." com Voltar à sala e Sair. */
  function desenharFaixa() {
    if (!estado.raiz) return;
    const faixa = estado.raiz.querySelector(".webc-na-sala"), s = estado.ctx && estado.ctx.sala && estado.ctx.sala();
    const dentro = !!(s && s.dentro);
    faixa.hidden = !dentro;
    if (!dentro) return;
    faixa.replaceChildren(el("span", {}, t("Você está na sala"), " ", el("b", { translate: "no" }, s.info ? s.info.nome : "")),
      el("button", { type: "button", class: "lnux-botao primario pequeno", id: "webc-voltar-sala", onclick: () => esconder() }, t("Voltar à sala")),
      el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => estado.ctx.sairDaSala().then(() => ir("sala")).catch(LNUX.erro) }, t("Sair da sala")));
  }

  /**
   * Monta o site uma vez. ctx: {salas (o ctx de js/salas.js), loja (o de js/loja.js), sala() → a Sala, sairDaSala(),
   * conversar() (vai para o chat bot)}.
   */
  C.webc = {
    montar(ctx) {
      if (estado.raiz) return;
      estado.ctx = ctx;
      estado.conteudo = el("main", { class: "webc-conteudo" });
      estado.raiz = el("div", { id: "webc", class: "webc", hidden: true },
        cabecalho(),
        el("div", { class: "webc-na-sala", hidden: true }),
        estado.conteudo);
      document.body.append(estado.raiz);
      if (C.contas) C.contas.aoMudar(() => { desenharEu(); if (estado.pagina === "perfil" && !estado.opcoes.id) ir("perfil", { semTransicao: true }); });
      C.aoMudarIdioma(() => { desenharEu(); desenharFaixa(); if (estado.pagina) ir(estado.pagina, { ...estado.opcoes, semTransicao: true }); });
      desenharEu();
    },
    ir, mostrar, esconder, desenharFaixa, menuIdioma,
    get pagina() { return estado.pagina; },
    get visivel() { return !!(estado.raiz && !estado.raiz.hidden); },
    verPerfil: (id) => ir("perfil", { id }),
  };
})();
