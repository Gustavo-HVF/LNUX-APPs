/*
 * Companhia — a lista de salas (como a lista de servidores de um jogo) e o formulário de criar uma sala.
 *
 * Ao entrar no modo de jogar, aparece a lista das salas públicas deste servidor: a miniatura do cenário, o nome, a
 * descrição, quem criou, quantas pessoas estão e cabem, e um cadeado nas que têm senha. Dá para entrar com um
 * clique, colar o link de uma sala privada, ou criar uma sala com as opções: nome, descrição, pública (aparece na
 * lista) ou privada (só com o link), senha, quantas pessoas cabem, bate-papo e o cenário (um dos seus ou um mundo
 * da loja, com a prévia em 3D antes de escolher). Quem criou muda as opções depois (Sala › Opções da sala).
 *
 * Criar não precisa da ponte: pelo link isolado do LNUX, quem chega cria a sala — se o dono do servidor deixar
 * (ele vê aqui a opção "Deixar quem entra pelo link criar salas").
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;

  // ── O cenário: um dos meus ou um mundo da loja, com a prévia em 3D ─────

  /**
   * Um seletor de cenário com a prévia. ctx.cenarios() → {meus: [{id, nome}], loja: [{id, nome}]};
   * ctx.arquivoDoCenario({tipo, id}) → Blob (.glb). Devolve {elemento, valor() → {tipo, id, nome} | null, foto(), destruir()}.
   */
  async function seletorDeCenario(ctx, inicial = "") {
    const { meus, loja } = await ctx.cenarios();
    const sel = el("select", { class: "lnux-selecao", "aria-label": "Cenário da sala" },
      el("option", { value: "" }, "Chão simples (sem cenário)"),
      meus.length ? el("optgroup", { label: "Meus cenários" }, meus.map((m) => el("option", { value: "meu:" + m.id }, m.nome))) : null,
      loja.length ? el("optgroup", { label: "Mundos da loja" }, loja.map((m) => el("option", { value: "loja:" + m.id }, m.nome))) : null);
    if (inicial && [...sel.options].some((o) => o.value === inicial)) sel.value = inicial;
    const previa = el("div", { class: "vitrine vitrine-cenario" });
    let vitrine = null, vez = 0;
    const valor = () => {
      if (!sel.value) return null;
      const [tipo, id] = sel.value.split(":");
      return { tipo, id, nome: sel.selectedOptions[0].textContent };
    };
    async function mostrar() {
      const v = valor(), minha = ++vez;
      if (vitrine) { vitrine.destruir(); vitrine = null; }
      previa.removeAttribute("data-pronta");
      previa.replaceChildren(el("div", { class: "vitrine-aviso" }, v ? "Carregando a prévia..." : "🌱 O chão simples: um piso liso, sem paredes."));
      if (!v) return;
      try {
        const blob = await ctx.arquivoDoCenario(v);
        if (minha !== vez) return;
        await C.prepararVRM();
        vitrine = new C.Vitrine(previa);
        await vitrine.mostrar("mundo", blob, "cenario.glb");
        if (minha !== vez) return;
        const a = previa.querySelector(".vitrine-aviso");
        if (a) a.remove();
        previa.dataset.pronta = "1";
      } catch (e) {
        const a = previa.querySelector(".vitrine-aviso");
        if (a) a.textContent = "A prévia não abriu: " + e.message;
      }
    }
    sel.addEventListener("change", mostrar);
    mostrar();
    return {
      elemento: el("div", { class: "ajustes" }, el("label", { class: "lnux-campo" }, el("span", {}, "Cenário"), sel), previa,
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Arraste a prévia para girar. Os seus cenários vêm de Movimento › Cenário; os mundos, da loja deste servidor.")),
      valor,
      foto: async () => (vitrine && valor() && valor().tipo === "meu" ? vitrine.foto().catch(() => null) : null),
      destruir: () => { vez++; if (vitrine) vitrine.destruir(); vitrine = null; },
    };
  }

  // ── As opções da sala ─────────────────────────────────────────────────

  /**
   * O formulário de criar (com o cenário) ou de mudar as opções de uma sala (sem). Devolve a Promise do diálogo:
   * {opcoes: {nome, descricao, publica, senha, max, bate_papo}, cenario, miniatura} ou null.
   */
  C.formularioDeSala = async function (ctx, { inicial = {}, criar = true, pessoasMax = 16 } = {}) {
    const nome = el("input", { class: "lnux-entrada", maxlength: 40, value: inicial.nome || "", "aria-label": "Nome da sala", placeholder: "Ex.: Praça da Ana" });
    const descricao = el("textarea", { class: "lnux-entrada", rows: 2, maxlength: 200, "aria-label": "Descrição da sala", placeholder: "O que vai rolar (opcional)" }, inicial.descricao || "");
    let publica = inicial.publica !== false;
    const visibilidade = el("div", { class: "loja-tipos", role: "radiogroup", "aria-label": "Quem vê a sala" });
    const desenharVisibilidade = () => visibilidade.replaceChildren(
      ...[[true, "🌐 Pública", "aparece na lista de salas"], [false, "🔒 Privada", "só entra quem tiver o link"]].map(([v, rotulo, dica]) =>
        el("button", { type: "button", role: "radio", class: "loja-aba" + (publica === v ? " ativa" : ""), "aria-checked": String(publica === v), "data-publica": String(v), title: dica,
          onclick: () => { publica = v; desenharVisibilidade(); } }, rotulo, el("span", { class: "conta" }, dica))));
    desenharVisibilidade();
    const senha = el("input", { class: "lnux-entrada", maxlength: 64, "aria-label": "Senha da sala", placeholder: inicial.senha ? "Tem senha: escreva outra para trocar" : "Sem senha", autocomplete: "off" });
    const tirarSenha = inicial.senha ? el("input", { type: "checkbox", "aria-label": "Tirar a senha" }) : null;
    if (tirarSenha) tirarSenha.addEventListener("change", () => { senha.disabled = tirarSenha.checked; if (tirarSenha.checked) senha.value = ""; });
    const max = el("input", { type: "range", min: 2, max: pessoasMax, step: 1, value: inicial.max || pessoasMax, "aria-label": "Quantas pessoas cabem" });
    const maxTexto = el("span", { class: "valor mono" }, " " + max.value);
    max.addEventListener("input", () => { maxTexto.textContent = " " + max.value; });
    const papo = el("input", { type: "checkbox", checked: inicial.bate_papo !== false, "aria-label": "Bate-papo por texto" });
    const cenario = criar ? await seletorDeCenario(ctx, inicial.cenario || "") : null;
    const corpo = el("div", { class: "ajustes form-sala" },
      el("div", { class: criar ? "grade" : "" },
        el("div", { class: "ajustes" },
          el("label", { class: "lnux-campo" }, el("span", {}, "Nome da sala"), nome),
          el("label", { class: "lnux-campo" }, el("span", {}, "Descrição"), descricao),
          el("div", { class: "lnux-campo" }, el("span", {}, "Quem vê a sala"), visibilidade),
          el("label", { class: "lnux-campo" }, el("span", {}, "Senha (opcional)"), senha),
          tirarSenha ? el("label", { class: "lnux-alternar" }, tirarSenha, "Tirar a senha") : null,
          el("label", { class: "lnux-campo faixa" }, el("span", {}, "Pessoas na sala (no máximo)", maxTexto), max),
          el("label", { class: "lnux-alternar" }, papo, "Bate-papo por texto")),
        cenario ? cenario.elemento : null));
    let resultado = null;
    try {
      const r = await LNUX.dialogo({ titulo: criar ? "Criar uma sala" : "Opções da sala", largo: true, corpo,
        botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: criar ? "Criar e entrar" : "Salvar", primario: true,
          antes: () => { if (!nome.value.trim()) { LNUX.aviso("Dê um nome para a sala.", "alerta"); nome.focus(); return false; } return true; }, valor: () => "ok" }] });
      if (r === "ok") {
        const opcoes = { nome: nome.value.trim(), descricao: descricao.value.trim(), publica, max: +max.value, bate_papo: papo.checked };
        if (criar || senha.value) opcoes.senha = senha.value;
        if (tirarSenha && tirarSenha.checked) opcoes.senha = "";
        resultado = { opcoes, cenario: cenario ? cenario.valor() : null, miniatura: cenario ? await cenario.foto() : null };
      }
    } finally { if (cenario) cenario.destruir(); }
    return resultado;
  };

  /** Só o cenário (para quem criou trocar o de uma sala aberta). Devolve {cenario, miniatura} ou null. */
  C.escolherCenarioDaSala = async function (ctx, inicial = "") {
    const c = await seletorDeCenario(ctx, inicial);
    try {
      const r = await LNUX.dialogo({ titulo: "Trocar o cenário da sala", largo: true, corpo: c.elemento,
        botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Trocar", primario: true, valor: "ok" }] });
      return r === "ok" ? { cenario: c.valor(), miniatura: await c.foto() } : null;
    } finally { c.destruir(); }
  };

  // ── A lista de salas ──────────────────────────────────────────────────

  /**
   * Abre a lista de salas. opcoes: {codigo} (a sala do link, se veio um). ctx (do app):
   *   personagens() → [{id, nome}], nome() e personagem() (os últimos usados), lojaDisponivel,
   *   escolherNaLoja() → id | null, importarPersonagem() → id | null,
   *   entrar(codigo, {nome, personagem, senha}), criar({opcoes, cenario, miniatura}, {nome, personagem}),
   *   cenarios(), arquivoDoCenario(v).
   * Devolve uma Promise que resolve quando a lista fecha (true se entrou numa sala).
   */
  C.abrirSalas = function (ctx, { codigo = "" } = {}) {
    let fechar, lista = { salas: [], criar: false, dono: false }, relogio = null, ocupado = false;
    const terminou = new Promise((ok) => (fechar = ok));
    const nome = el("input", { class: "lnux-entrada", value: ctx.nome(), maxlength: 24, placeholder: "Como os outros vão te ver", "aria-label": "Seu nome" });
    const personagem = el("select", { class: "lnux-selecao", "aria-label": "Sua personagem" });
    const grade = el("div", { class: "loja-grade salas-grade", role: "list", id: "salas-lista" });
    const vazio = el("div", { class: "loja-vazio", hidden: true });
    const dono = el("div", { class: "loja-dono", hidden: true });
    const convite = el("div", { class: "salas-convite", hidden: true });
    const codigoCampo = el("input", { class: "lnux-entrada", value: codigo, placeholder: "Tem o link de uma sala privada? Cole aqui", "aria-label": "Link ou código da sala", "data-enter-proprio": "1" });
    const botaoCriar = el("button", { class: "lnux-botao primario", type: "button", id: "sala-criar", onclick: () => criar().catch(LNUX.erro) }, "＋ Criar sala");
    const contagem = el("span", { class: "fraco pequeno" });
    const caixa = el("div", { class: "loja salas", role: "dialog", "aria-label": "Salas", "aria-modal": "true" },
      el("header", { class: "loja-topo" },
        el("div", { class: "loja-titulo" }, el("b", {}, "🎮 Salas"), el("span", { class: "fraco pequeno" }, "escolha uma sala para entrar, ou crie a sua")),
        contagem,
        el("button", { class: "lnux-botao", type: "button", title: "Atualizar a lista", onclick: () => atualizar().catch(LNUX.erro) }, "↻ Atualizar"),
        botaoCriar,
        el("button", { class: "lnux-botao icone plano", type: "button", "aria-label": "Fechar a lista de salas", title: "Fechar", html: LNUX.icone("fechar"), onclick: () => sair(false) })),
      el("div", { class: "salas-eu" },
        el("label", { class: "lnux-campo" }, el("span", {}, "Seu nome"), nome),
        el("label", { class: "lnux-campo" }, el("span", {}, "Sua personagem"), personagem),
        ctx.lojaDisponivel ? el("button", { class: "lnux-botao", type: "button", id: "sala-loja-personagem", title: "Ver as personagens da loja, em 3D, e escolher uma",
          onclick: async () => { const id = await ctx.escolherNaLoja(); if (id) await desenharPersonagens(id); } }, "🛍️ Personagens da loja") : null),
      dono, convite,
      el("div", { class: "salas-codigo linha" }, el("label", { class: "lnux-campo" }, codigoCampo),
        el("button", { class: "lnux-botao", type: "button", id: "sala-entrar", onclick: () => { const c = codigoDe(codigoCampo.value); if (!c) { LNUX.aviso("Cole o link (ou o código) da sala.", "alerta"); codigoCampo.focus(); return; } entrarPeloCodigo(c).catch(LNUX.erro); } }, "Entrar pelo link")),
      grade, vazio);
    document.body.append(caixa);
    codigoCampo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); caixa.querySelector("#sala-entrar").click(); } });
    const teclas = (e) => { if (e.key === "Escape" && !document.querySelector(".lnux-fundo-modal") && !document.querySelector(".loja:not(.salas)")) { e.preventDefault(); sair(false); } };
    document.addEventListener("keydown", teclas);
    function sair(entrou) {
      clearInterval(relogio);
      document.removeEventListener("keydown", teclas);
      caixa.remove();
      fechar(entrou);
    }
    const codigoDe = (texto) => { const m = String(texto).match(/sala=([a-z0-9]+)/i); return (m ? m[1] : String(texto)).trim().toLowerCase(); };

    async function desenharPersonagens(escolhida) {
      const lista = await ctx.personagens();
      const atual = escolhida !== undefined ? escolhida : ctx.personagem();
      personagem.replaceChildren(el("option", { value: "" }, "Boneco simples (padrão)"), ...lista.map((p) => el("option", { value: p.id }, p.nome)),
        el("option", { value: "@importar" }, "Importar uma personagem (.vrm, ZIP ou avatar do Unity)..."));
      personagem.value = lista.some((p) => p.id === atual) ? atual : "";
    }
    personagem.addEventListener("change", async () => {
      if (personagem.value !== "@importar") return;
      personagem.value = "";
      try { const id = await ctx.importarPersonagem(); if (id) await desenharPersonagens(id); } catch (e) { LNUX.erro(e); }
    });
    /** Quem vai entrar: o nome (obrigatório) e a personagem. */
    function jogador() {
      const n = nome.value.trim();
      if (!n) { LNUX.aviso("Diga o seu nome (como os outros vão te ver).", "alerta"); nome.focus(); return null; }
      return { nome: n, personagem: personagem.value };
    }
    function cartao(s, destaque) {
      const minha = !!C.Sala.minhas()[s.codigo], cheia = s.pessoas >= s.max;
      const capa = el("div", { class: "capa" }, s.miniatura ? el("img", { src: `/api/sala/${s.codigo}/miniatura?v=${s.miniatura}`, alt: "", loading: "lazy" }) : el("span", { class: "sem-miniatura", "aria-hidden": "true" }, s.mapa ? "🗺️" : "🌱"),
        el("span", { class: "selo-tipo" }, `👥 ${s.pessoas}/${s.max}`));
      if (s.senha) capa.append(el("span", { class: "selo-cadeado", title: "Tem senha" }, "🔒"));
      if (minha) capa.append(el("span", { class: "selo-novo" }, "Sua"));
      else if (cheia) capa.append(el("span", { class: "selo-novo cheia" }, "Cheia"));
      return el("div", { class: "cartao-loja cartao-sala" + (destaque ? " destaque" : ""), role: "listitem", "data-codigo": s.codigo },
        capa,
        el("span", { class: "nome" }, s.nome),
        s.descricao ? el("span", { class: "descricao pequeno" }, s.descricao) : null,
        el("span", { class: "fraco pequeno" }, [s.criador ? "por " + s.criador : "", s.mapa ? s.mapa.nome : "chão simples", s.bate_papo ? "" : "sem bate-papo", s.publica ? "" : "privada"].filter(Boolean).join(" · ")),
        el("button", { class: "lnux-botao primario entrar", type: "button", disabled: cheia && !minha, onclick: () => entrarNa(s).catch(LNUX.erro) }, cheia && !minha ? "Cheia" : "Entrar"));
    }
    async function atualizar() {
      if (ocupado) return;
      ocupado = true;
      try {
        lista = await C.Sala.lista();
        grade.replaceChildren(...lista.salas.map((s) => cartao(s)));
        vazio.hidden = !!lista.salas.length;
        vazio.replaceChildren(el("p", { style: { margin: 0 } }, "Nenhuma sala pública aberta agora."),
          el("p", { class: "fraco", style: { margin: 0 } }, lista.criar ? "Crie a sua: ＋ Criar sala." : "Peça o link de uma sala a quem criou."));
        botaoCriar.hidden = !lista.criar;
        contagem.textContent = `${lista.abertas} de ${lista.maximo} salas abertas neste servidor`;
        desenharDono();
      } finally { ocupado = false; }
    }
    function desenharDono() {
      dono.hidden = !lista.dono;
      if (!lista.dono || dono.firstChild) return;
      const caixaCriar = el("input", { type: "checkbox", checked: lista.visitantes_criam });
      caixaCriar.addEventListener("change", async () => {
        try { const r = await C.Sala.ajustar({ visitantes_criam: caixaCriar.checked }); LNUX.aviso(r.visitantes_criam ? "Quem entra pelo link pode criar salas." : "Só você cria salas agora.", "ok"); }
        catch (e) { caixaCriar.checked = !caixaCriar.checked; LNUX.erro(e); }
      });
      dono.replaceChildren(el("span", { class: "fraco pequeno" }, "O servidor é seu: as salas ficam neste aparelho enquanto ele estiver ligado."),
        el("label", { class: "lnux-alternar" }, caixaCriar, "Deixar quem entra pelo link criar salas"));
    }
    /** A sala que veio no link aparece em destaque, em cima da lista (mesmo se for privada). */
    async function mostrarConvite(c) {
      try {
        const s = await C.Sala.consultar(c);
        convite.hidden = false;
        convite.replaceChildren(el("div", { class: "lnux-rotulo" }, "A sala do seu link"), el("div", { class: "salas-grade" }, cartao(s, true)));
      } catch (e) {
        convite.hidden = false;
        convite.replaceChildren(el("p", { class: "fraco", style: { margin: 0 } }, "A sala do seu link não está mais aberta (quem criou fechou, ou o servidor foi reiniciado). Veja as outras abaixo."));
      }
    }
    async function entrarPeloCodigo(c) {
      let s;
      try { s = await C.Sala.consultar(c); } catch (e) { throw e.status === 404 ? new Error("Essa sala não existe mais (ou o código está errado).") : e; }
      return entrarNa(s);
    }
    async function entrarNa(s) {
      const j = jogador();
      if (!j) return;
      let senha = "";
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        try {
          await ctx.entrar(s.codigo, { ...j, senha });
          sair(true);
          return;
        } catch (e) {
          if (!e.senha) throw e;
          const campo = el("input", { class: "lnux-entrada", type: "password", "aria-label": "Senha", autocomplete: "off" });
          const r = await LNUX.dialogo({ titulo: `Senha de "${s.nome}"`, corpo: el("div", { class: "ajustes" }, tentativa ? el("p", { style: { margin: 0, color: "var(--perigo)" } }, "Senha errada. Tente de novo.") : null,
            el("label", { class: "lnux-campo" }, el("span", {}, "Esta sala tem senha"), campo)), aoAbrir: () => campo.focus(),
            botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Entrar", primario: true, valor: () => campo.value }] });
          if (r === null || r === undefined) return;
          senha = r;
        }
      }
    }
    async function criar() {
      const j = jogador();
      if (!j) return;
      const f = await C.formularioDeSala(ctx, { inicial: { nome: `Sala de ${j.nome}` }, pessoasMax: lista.pessoas_max || 16 });
      if (!f) return;
      await ctx.criar(f, j);
      sair(true);
    }
    desenharPersonagens().catch(LNUX.erro);
    atualizar().catch(LNUX.erro);
    if (codigo) mostrarConvite(codigoDe(codigo));
    relogio = setInterval(() => atualizar().catch(() => {}), 4000);
    return Object.assign(terminou, { fechar: () => sair(false), elemento: caixa, atualizar });
  };
})();
