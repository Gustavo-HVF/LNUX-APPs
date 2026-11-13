/*
 * Companhia — contas: criar conta (nome, e-mail, senha, idade), confirmar pelo código que chega por e-mail, entrar,
 * esqueci a senha e o perfil (foto, capa, nome, bio, pronomes, cidade, links e cor), que os outros veem nas salas.
 *
 * Tudo fica no aparelho de quem tem o servidor (servidor/lnux_apps.py, /api/contas): as contas, as senhas (só o hash)
 * e as fotos. Este navegador guarda só a sessão (a chave de entrada da conta). O código de verificação sai pelo
 * e-mail que o dono do servidor configurou (Contas e e-mail, só para o dono).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const SESSAO = "companhia.conta.sessao";
  const ouvintes = [];

  // ── O servidor ───────────────────────────────────────────────────────

  async function pedir(metodo, rota, { json, corpo, como = "json", parametros } = {}) {
    const cab = {};
    const sessao = C.contas.sessao();
    if (sessao) cab["X-Conta-Sessao"] = sessao;
    if (LNUX.ponte && LNUX.ponte._token) cab["X-Ponte-Token"] = LNUX.ponte._token;
    if (json !== undefined) cab["Content-Type"] = "application/json";
    const url = new URL("/api/contas/" + rota, location.origin);
    for (const [k, v] of Object.entries(parametros || {})) url.searchParams.set(k, v);
    let r;
    try { r = await fetch(url, { method: metodo, headers: cab, body: json !== undefined ? JSON.stringify(json) : corpo }); }
    catch (e) { throw new Error("O servidor não respondeu (ele está ligado?)."); }
    let j = null;
    if (como === "json" || !r.ok) { try { j = await r.json(); } catch (e) { j = null; } }
    if (!r.ok) {
      const erro = new Error((j && j.erro) || "O servidor respondeu " + r.status);
      erro.status = r.status;
      Object.assign(erro, j || {});
      throw erro;
    }
    return j;
  }

  C.contas = {
    eu: null,
    publico: null,
    sessao: () => { try { return localStorage.getItem(SESSAO) || ""; } catch (e) { return ""; } },
    guardarSessao(s) { try { if (s) localStorage.setItem(SESSAO, s); else localStorage.removeItem(SESSAO); } catch (e) { /* sem armazenamento */ } },
    aoMudar(fn) { ouvintes.push(fn); return () => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); }; },
    avisar() { for (const fn of ouvintes) { try { fn(this.eu); } catch (e) { console.error(e); } } },
    /** O que o servidor oferece: {contas, contas_email, exigir_conta, idade_minima}. */
    async disponivel() {
      if (!this.publico) { try { const r = await fetch("/api/publico", { cache: "no-store" }); this.publico = r.ok ? await r.json() : {}; } catch (e) { this.publico = {}; } }
      return !!this.publico.contas;
    },
    async atualizarPublico() { this.publico = null; return this.disponivel(); },
    /** Lê a conta da sessão guardada (se ainda vale). */
    async carregar() {
      if (!this.sessao()) { this.eu = null; return null; }
      try { this.eu = await pedir("GET", "eu"); }
      catch (e) { if (e.status === 401) this.guardarSessao(""); this.eu = null; }
      this.avisar();
      return this.eu;
    },
    entrou(r) { this.guardarSessao(r.sessao); this.eu = r.conta; this.avisar(); return r.conta; },
    cadastrar: (d) => pedir("POST", "cadastro", { json: d }),
    async verificar(email, codigo) { return C.contas.entrou(await pedir("POST", "verificar", { json: { email, codigo } })); },
    reenviar: (email) => pedir("POST", "reenviar", { json: { email } }),
    async entrar(email, senha) { return C.contas.entrou(await pedir("POST", "entrar", { json: { email, senha } })); },
    async sair() { try { await pedir("POST", "sair", { json: {} }); } catch (e) { /* já saiu */ } this.guardarSessao(""); this.eu = null; this.avisar(); },
    async salvarPerfil(d) { this.eu = await pedir("POST", "perfil", { json: d }); this.avisar(); return this.eu; },
    async mandarImagem(tipo, blob) { this.eu = await pedir("PUT", "midia", { corpo: blob, parametros: { tipo } }); this.avisar(); return this.eu; },
    async tirarImagem(tipo) { this.eu = await pedir("DELETE", "midia", { parametros: { tipo } }); this.avisar(); return this.eu; },
    trocarSenha: (atual, nova) => pedir("POST", "senha", { json: { atual, nova } }),
    recuperar: (email) => pedir("POST", "recuperar", { json: { email } }),
    async redefinir(email, codigo, senha) { return C.contas.entrou(await pedir("POST", "redefinir", { json: { email, codigo, senha } })); },
    async apagar(senha) { await pedir("POST", "apagar", { json: { senha } }); this.guardarSessao(""); this.eu = null; this.avisar(); },
    perfil: (id) => pedir("GET", "perfil/" + encodeURIComponent(id)),
    imagem: (p, tipo = "foto") => (p && p[tipo] ? `/api/contas/midia/${p.id}/${tipo}?v=${p[tipo]}` : ""),
    // do dono do servidor
    ajustes: () => pedir("GET", "ajustes"),
    salvarAjustes: (d) => pedir("POST", "ajustes", { json: d }),
    emailTeste: (para) => pedir("POST", "email-teste", { json: { para } }),
    lista: () => pedir("GET", "lista"),
    apagarConta: (id) => pedir("DELETE", "conta/" + id),
  };

  // ── Pedaços de tela ──────────────────────────────────────────────────

  const iniciais = (nome) => String(nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase() || "?";
  /** A foto da conta num círculo (ou as iniciais, na cor dela). */
  C.fotoDaConta = function (p, tamanho = 40) {
    const url = C.contas.imagem(p, "foto");
    return el("span", { class: "foto-conta", style: { width: tamanho + "px", height: tamanho + "px", fontSize: Math.round(tamanho * 0.4) + "px", background: (p && p.cor) || "var(--destaque)" } },
      url ? el("img", { src: url, alt: "" }) : iniciais(p && p.nome));
  };
  const campo = (rotulo, entrada, dica) => el("label", { class: "lnux-campo" }, el("span", {}, rotulo), entrada, dica ? el("small", { class: "fraco" }, dica) : null);
  const entrada = (attrs) => el("input", { class: "lnux-entrada", ...attrs });
  const mensagem = (texto, erro = true) => el("p", { class: "conta-msg" + (erro ? " erro" : ""), role: erro ? "alert" : "status" }, texto);

  /** Uma imagem escolhida pela pessoa, recortada no meio e reduzida (foto: quadrada; capa: 3×1), em WebP. */
  async function recortar(blob, largura, altura) {
    const bmp = await createImageBitmap(blob);
    const escala = Math.max(largura / bmp.width, altura / bmp.height), w = largura / escala, h = altura / escala;
    const tela = document.createElement("canvas");
    tela.width = largura; tela.height = altura;
    tela.getContext("2d").drawImage(bmp, (bmp.width - w) / 2, (bmp.height - h) / 2, w, h, 0, 0, largura, altura);
    bmp.close();
    const webp = await new Promise((ok) => tela.toBlob(ok, "image/webp", 0.88));
    return webp && webp.type === "image/webp" ? webp : new Promise((ok) => tela.toBlob(ok, "image/jpeg", 0.88));
  }

  // ── Entrar, criar conta, código, esqueci a senha ─────────────────────

  /**
   * O formulário da conta (entrar, criar, código, esqueci a senha, senha nova), que troca de tela sozinho. Vai na janela
   * da conta e no cartão da tela de início. aoEntrar(conta) quando a pessoa entra. Devolve {corpo, desenhar, parar}.
   */
  C.formularioConta = function (modo = "entrar", { aoEntrar = () => {} } = {}) {
    let email = "", espera = null;
    const corpo = el("div", { class: "ajustes janela-conta" });
    const pub = C.contas.publico || {};
    const fechar = (conta) => { clearInterval(espera); aoEntrar(conta || null); };
    function desenhar(novo, msg) {
      modo = novo;
      clearInterval(espera);
      corpo.replaceChildren(...telas[modo](msg).filter(Boolean));
      // o foco no primeiro campo: na hora, se a janela já está aberta (ao abrir, a própria janela cuida do foco)
      const primeiro = corpo.querySelector("input:not([readonly])");
      if (primeiro && corpo.isConnected) primeiro.focus();
    }
    async function tentar(botao, acao) {
      const antes = botao.textContent;
      botao.disabled = true;
      botao.textContent = "Um momento...";
      const msg = corpo.querySelector(".conta-msg");
      if (msg) msg.remove();
      try { await acao(); }
      catch (e) {
        if (e.pendente && modo !== "codigo") { email = email || e.email; desenhar("codigo", mensagem(e.message, false)); return; }
        corpo.querySelector(".conta-acoes").before(mensagem(e.message));
      } finally { botao.disabled = false; botao.textContent = antes; }
    }
    const acoes = (...b) => el("div", { class: "conta-acoes" }, ...b);
    const link = (texto, fn) => el("button", { type: "button", class: "lnux-botao plano conta-link", onclick: fn }, texto);
    const telas = {
      entrar(msg) {
        const e = entrada({ type: "email", autocomplete: "email", "aria-label": "E-mail", value: email }), s = entrada({ type: "password", autocomplete: "current-password", "aria-label": "Senha" });
        const ir = el("button", { type: "button", class: "lnux-botao primario", id: "conta-entrar" }, "Entrar");
        const fazer = () => tentar(ir, async () => { email = e.value.trim(); fechar(await C.contas.entrar(email, s.value)); });
        ir.addEventListener("click", fazer);
        s.addEventListener("keydown", (ev) => { if (ev.key === "Enter") fazer(); });
        return [el("h3", {}, "Entrar na sua conta"), campo("E-mail", e), campo("Senha", s), msg || null,
          acoes(ir, link("Esqueci a senha", () => { email = e.value.trim(); desenhar("esqueci"); })),
          el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Não tem conta? ", link("Criar uma conta", () => desenhar("criar")))];
      },
      criar(msg) {
        const n = entrada({ autocomplete: "nickname", maxlength: 30, "aria-label": "Nome" }), e = entrada({ type: "email", autocomplete: "email", "aria-label": "E-mail", value: email });
        const s = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Senha", minlength: 8 }), s2 = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Repita a senha" });
        const i = entrada({ type: "number", min: 1, max: 120, inputmode: "numeric", "aria-label": "Idade" });
        const aceito = el("input", { type: "checkbox", "aria-label": "Concordo em guardar os dados" });
        const ir = el("button", { type: "button", class: "lnux-botao primario", id: "conta-criar" }, "Criar conta");
        ir.addEventListener("click", () => tentar(ir, async () => {
          if (s.value !== s2.value) throw new Error("As duas senhas não são iguais.");
          if (!aceito.checked) throw new Error("Marque que concorda em guardar os seus dados neste servidor.");
          email = e.value.trim();
          const r = await C.contas.cadastrar({ nome: n.value.trim(), email, senha: s.value, idade: +i.value });
          desenhar("codigo", mensagem(`Mandamos um código de 6 dígitos para ${r.email}. Veja a caixa de entrada (e o spam).`, false));
        }));
        if (pub.contas_email === false) return [el("h3", {}, "Criar conta"), mensagem("O dono deste servidor ainda não configurou o envio de e-mails, então ainda não dá para criar contas aqui."),
          acoes(link("Voltar", () => desenhar("entrar")))];
        return [el("h3", {}, "Criar uma conta"),
          el("div", { class: "grade" }, campo("Nome", n, "Como os outros vão te ver"), campo("Idade", i, pub.idade_minima ? `A partir de ${pub.idade_minima} anos` : "")),
          campo("E-mail", e, "Para o código de confirmação e para recuperar a senha"),
          el("div", { class: "grade" }, campo("Senha", s, "Pelo menos 8 caracteres"), campo("Repita a senha", s2)),
          el("label", { class: "lnux-alternar" }, aceito, el("span", {}, "Concordo que o meu nome, e-mail, idade e perfil fiquem guardados no aparelho de quem tem este servidor.")),
          msg || null, acoes(ir), el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Já tem conta? ", link("Entrar", () => desenhar("entrar")))];
      },
      codigo(msg) {
        const c = entrada({ inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, "aria-label": "Código", class: "lnux-entrada codigo-conta", placeholder: "000000" });
        const ir = el("button", { type: "button", class: "lnux-botao primario", id: "conta-confirmar" }, "Confirmar");
        const reenviar = el("button", { type: "button", class: "lnux-botao" }, "Mandar outro código");
        const fazer = () => tentar(ir, async () => fechar(await C.contas.verificar(email, c.value.trim())));
        ir.addEventListener("click", fazer);
        c.addEventListener("keydown", (ev) => { if (ev.key === "Enter") fazer(); });
        let falta = 60;
        const contar = () => { reenviar.disabled = falta > 0; reenviar.textContent = falta > 0 ? `Mandar outro código (${falta}s)` : "Mandar outro código"; falta--; };
        contar();
        setTimeout(() => { espera = setInterval(() => { contar(); if (falta < 0) clearInterval(espera); }, 1000); }, 0);
        reenviar.addEventListener("click", () => tentar(reenviar, async () => { const r = await C.contas.reenviar(email); desenhar("codigo", mensagem(`Mandamos outro código para ${r.email}.`, false)); }));
        return [el("h3", {}, "Confirme o seu e-mail"), el("p", { style: { margin: 0 } }, "Digite o código de 6 dígitos que chegou por e-mail. Ele vale por 15 minutos."),
          campo("Código", c), msg || null, acoes(ir, reenviar), el("p", { class: "fraco pequeno", style: { margin: 0 } }, link("Voltar", () => desenhar("entrar")))];
      },
      esqueci(msg) {
        const e = entrada({ type: "email", autocomplete: "email", "aria-label": "E-mail", value: email });
        const ir = el("button", { type: "button", class: "lnux-botao primario" }, "Mandar o código");
        ir.addEventListener("click", () => tentar(ir, async () => { email = e.value.trim(); await C.contas.recuperar(email); desenhar("nova", mensagem("Se houver uma conta com esse e-mail, chegou um código para ele.", false)); }));
        return [el("h3", {}, "Esqueci a senha"), campo("E-mail da conta", e), msg || null, acoes(ir, link("Voltar", () => desenhar("entrar")))];
      },
      nova(msg) {
        const c = entrada({ inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, "aria-label": "Código", class: "lnux-entrada codigo-conta", placeholder: "000000" });
        const s = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Senha nova" });
        const ir = el("button", { type: "button", class: "lnux-botao primario" }, "Trocar a senha e entrar");
        ir.addEventListener("click", () => tentar(ir, async () => fechar(await C.contas.redefinir(email, c.value.trim(), s.value))));
        return [el("h3", {}, "Criar uma senha nova"), campo("Código que chegou por e-mail", c), campo("Senha nova", s, "Pelo menos 8 caracteres"), msg || null,
          acoes(ir, link("Voltar", () => desenhar("entrar")))];
      },
    };
    desenhar(modo);
    return { corpo, desenhar, parar: () => clearInterval(espera), get modo() { return modo; } };
  };
  /** A janela da conta: começa em "entrar" ou "criar". Resolve com a conta (quando entra) ou null (fechou). */
  C.janelaConta = function (modo = "entrar") {
    let d = null, resultado = null;
    const f = C.formularioConta(modo, { aoEntrar: (conta) => { resultado = conta; d.fechar(conta); } });
    d = LNUX.dialogo({ titulo: "Conta", corpo: f.corpo, botoes: [] });
    return d.then(() => { f.parar(); return resultado; });
  };

  // ── Perfil ───────────────────────────────────────────────────────────

  /** O perfil de alguém (como os outros veem): capa, foto, nome, pronomes, bio, cidade, links e desde quando. */
  C.mostrarPerfil = async function (id) {
    let p;
    try { p = await C.contas.perfil(id); } catch (e) { LNUX.erro(e); return; }
    const capa = C.contas.imagem(p, "capa");
    const corpo = el("div", { class: "perfil-cartao" },
      el("div", { class: "perfil-capa", style: { background: capa ? `center / cover no-repeat url("${capa}")` : (p.cor || "var(--destaque)") } }),
      el("div", { class: "perfil-cabeca" }, C.fotoDaConta(p, 84),
        el("div", {}, el("h2", {}, p.nome), p.pronomes ? el("span", { class: "fraco" }, p.pronomes) : null)),
      p.bio ? el("p", { class: "perfil-bio" }, p.bio) : el("p", { class: "fraco" }, "Sem bio."),
      el("div", { class: "fraco pequeno" }, [p.local ? "📍 " + p.local : "", "conta desde " + new Date(p.desde * 1000).toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")),
      p.links && p.links.length ? el("div", { class: "perfil-links" }, p.links.map((l) => el("a", { href: l, target: "_blank", rel: "noopener noreferrer nofollow" }, l.replace(/^https?:\/\//, "")))) : null);
    return LNUX.dialogo({ titulo: "Perfil", corpo, botoes: [{ rotulo: "Fechar", primario: true, valor: null }] });
  };

  /** Editar o meu perfil: foto, capa, nome, bio, pronomes, cidade, links, cor; e a conta (senha, sair, apagar). */
  C.janelaPerfil = async function () {
    if (!C.contas.eu) { const c = await C.janelaConta("entrar"); if (!c) return null; }
    let eu = C.contas.eu;
    const nome = entrada({ maxlength: 30, value: eu.nome, "aria-label": "Nome" });
    const bio = el("textarea", { class: "lnux-entrada", rows: 4, maxlength: 300, "aria-label": "Bio", placeholder: "Conte um pouco sobre você" }, eu.bio || "");
    const pronomes = entrada({ maxlength: 30, value: eu.pronomes || "", "aria-label": "Pronomes", placeholder: "ela/dela, ele/dele, elu/delu..." });
    const local = entrada({ maxlength: 60, value: eu.local || "", "aria-label": "Cidade", placeholder: "Opcional" });
    const links = [0, 1, 2].map((i) => entrada({ type: "url", maxlength: 200, value: (eu.links || [])[i] || "", "aria-label": `Link ${i + 1}`, placeholder: "https://..." }));
    const cor = el("input", { type: "color", value: eu.cor || "#5b9dff", "aria-label": "Cor do perfil" });
    const topo = el("div", { class: "perfil-editar-topo" });
    const desenharTopo = () => {
      const capa = C.contas.imagem(eu, "capa");
      topo.replaceChildren(
        el("div", { class: "perfil-capa", style: { background: capa ? `center / cover no-repeat url("${capa}")` : cor.value } },
          el("button", { type: "button", class: "lnux-botao", id: "perfil-capa", onclick: () => trocar("capa") }, "Trocar a capa"),
          eu.capa ? el("button", { type: "button", class: "lnux-botao plano", onclick: () => tirar("capa") }, "Tirar") : null),
        el("div", { class: "perfil-cabeca" }, C.fotoDaConta(eu, 84),
          el("div", { class: "linha" }, el("button", { type: "button", class: "lnux-botao", id: "perfil-foto", onclick: () => trocar("foto") }, "Trocar a foto"),
            eu.foto ? el("button", { type: "button", class: "lnux-botao plano", onclick: () => tirar("foto") }, "Tirar a foto") : null)));
    };
    async function trocar(tipo) {
      const [a] = await LNUX.arquivos.abrir({ titulo: tipo === "foto" ? "Foto do perfil" : "Capa do perfil", aceitar: ".png,.jpg,.jpeg,.webp,.gif,.bmp" });
      if (!a) return;
      try {
        const blob = tipo === "foto" ? await recortar(await a.blob(), 512, 512) : await recortar(await a.blob(), 1200, 400);
        eu = await C.contas.mandarImagem(tipo, blob);
        desenharTopo();
      } catch (e) { LNUX.erro(e); }
    }
    async function tirar(tipo) { try { eu = await C.contas.tirarImagem(tipo); desenharTopo(); } catch (e) { LNUX.erro(e); } }
    cor.addEventListener("input", desenharTopo);
    desenharTopo();
    let d = null;
    const sair = el("button", { type: "button", class: "lnux-botao", onclick: async () => { await C.contas.sair(); d.fechar(null); LNUX.aviso("Você saiu da conta.", "ok"); } }, "Sair da conta");
    const senha = el("button", { type: "button", class: "lnux-botao", onclick: () => janelaTrocarSenha() }, "Trocar a senha");
    const apagar = el("button", { type: "button", class: "lnux-botao perigo", onclick: async () => { if (await janelaApagar()) d.fechar(null); } }, "Apagar a conta");
    const corpo = el("div", { class: "ajustes janela-perfil" }, topo,
      el("div", { class: "grade" }, campo("Nome", nome), campo("Pronomes", pronomes)),
      campo("Bio", bio, "Até 300 caracteres"),
      el("div", { class: "grade" }, campo("Cidade", local), el("label", { class: "lnux-campo" }, el("span", {}, "Cor do perfil"), cor)),
      el("div", { class: "lnux-rotulo" }, "Links (até 3)"), ...links,
      el("div", { class: "lnux-rotulo" }, "Conta"),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, `E-mail: ${eu.email} · idade: ${eu.idade} anos. Ficam no aparelho de quem tem este servidor; os outros só veem o perfil.`),
      el("div", { class: "linha" }, senha, sair, apagar));
    d = LNUX.dialogo({ titulo: "Meu perfil", largo: true, corpo, botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", primario: true, valor: "salvar" }] });
    if ((await d) !== "salvar") return null;
    try {
      eu = await C.contas.salvarPerfil({ nome: nome.value.trim(), bio: bio.value.trim(), pronomes: pronomes.value.trim(), local: local.value.trim(), cor: cor.value,
        links: links.map((l) => l.value.trim()).filter(Boolean) });
      LNUX.aviso("Perfil salvo.", "ok");
      return eu;
    } catch (e) { LNUX.erro(e); return null; }
  };
  async function janelaTrocarSenha() {
    const a = entrada({ type: "password", autocomplete: "current-password", "aria-label": "Senha atual" }), n = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Senha nova" });
    const r = await LNUX.dialogo({ titulo: "Trocar a senha", corpo: el("div", { class: "ajustes" }, campo("Senha atual", a), campo("Senha nova", n, "Pelo menos 8 caracteres")),
      botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Trocar", primario: true, valor: "ok" }] });
    if (r !== "ok") return;
    try { await C.contas.trocarSenha(a.value, n.value); LNUX.aviso("Senha trocada. As outras sessões da conta saíram.", "ok"); } catch (e) { LNUX.erro(e); }
  }
  async function janelaApagar() {
    const s = entrada({ type: "password", autocomplete: "current-password", "aria-label": "Senha" });
    const r = await LNUX.dialogo({ titulo: "Apagar a conta", corpo: el("div", { class: "ajustes" },
      el("p", { style: { margin: 0 } }, "A conta, o perfil e as fotos são apagados do servidor. Não dá para desfazer."), campo("Sua senha", s)),
      botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Apagar a conta", perigo: true, valor: "ok" }] });
    if (r !== "ok") return false;
    try { await C.contas.apagar(s.value); LNUX.aviso("Conta apagada.", "ok"); return true; } catch (e) { LNUX.erro(e); return false; }
  }

  // ── Do dono do servidor: o e-mail dos códigos, a idade mínima, exigir conta e a lista ─────

  const PROVEDORES = { gmail: ["smtp.gmail.com", 465, "ssl"], outlook: ["smtp-mail.outlook.com", 587, "starttls"], yahoo: ["smtp.mail.yahoo.com", 465, "ssl"] };
  C.janelaContasDono = async function () {
    let a;
    try { a = await C.contas.ajustes(); } catch (e) { LNUX.erro(e); return; }
    const e = a.email;
    const provedor = el("select", { class: "lnux-selecao", "aria-label": "Provedor de e-mail" }, el("option", { value: "" }, "Escolha para preencher..."),
      el("option", { value: "gmail" }, "Gmail"), el("option", { value: "outlook" }, "Outlook / Hotmail"), el("option", { value: "yahoo" }, "Yahoo"), el("option", { value: "" }, "Outro"));
    const servidor = entrada({ value: e.servidor || "", "aria-label": "Servidor SMTP", placeholder: "smtp.gmail.com" });
    const porta = entrada({ type: "number", value: e.porta || "", "aria-label": "Porta", placeholder: "465" });
    const seguranca = el("select", { class: "lnux-selecao", "aria-label": "Segurança" }, [["ssl", "SSL/TLS (porta 465)"], ["starttls", "STARTTLS (porta 587)"], ["nenhuma", "Nenhuma (só para testes)"]]
      .map(([v, t]) => el("option", { value: v, selected: (e.seguranca || "ssl") === v }, t)));
    const usuario = entrada({ value: e.usuario || "", "aria-label": "Usuário do e-mail", autocomplete: "off", placeholder: "voce@gmail.com" });
    const senha = entrada({ type: "password", "aria-label": "Senha do e-mail", autocomplete: "new-password", placeholder: e.tem_senha ? "(guardada; escreva para trocar)" : "Senha de app" });
    const remetente = entrada({ type: "email", value: e.remetente || "", "aria-label": "Remetente", placeholder: "voce@gmail.com" });
    const nomeRem = entrada({ value: e.nome || "", "aria-label": "Nome do remetente", placeholder: "Companhia" });
    provedor.addEventListener("change", () => { const p = PROVEDORES[provedor.value]; if (p) { servidor.value = p[0]; porta.value = p[1]; seguranca.value = p[2]; } });
    const idade = entrada({ type: "number", min: 0, max: 99, value: a.idade_minima, "aria-label": "Idade mínima" });
    const exigir = el("input", { type: "checkbox", checked: a.exigir_conta, "aria-label": "Só joga quem tem conta" });
    const lista = el("div", { class: "contas-lista" });
    async function desenharLista() {
      try {
        const l = (await C.contas.lista()).contas;
        lista.replaceChildren(l.length ? el("table", {}, el("tbody", {}, l.map((c) => el("tr", {},
          el("td", {}, c.nome), el("td", { class: "fraco" }, c.email), el("td", {}, c.idade + " anos"), el("td", { class: "fraco pequeno" }, c.verificada ? "confirmada" : "falta o código"),
          el("td", {}, el("button", { type: "button", class: "lnux-botao plano perigo", onclick: async () => {
            if (!(await LNUX.confirmar("Apagar conta", `Apagar a conta de ${c.nome} (${c.email}) deste servidor?`, { rotulo: "Apagar", perigo: true }))) return;
            try { await C.contas.apagarConta(c.id); desenharLista(); } catch (err) { LNUX.erro(err); } } }, "Apagar")))))) : el("p", { class: "fraco", style: { margin: 0 } }, "Nenhuma conta ainda."));
      } catch (err) { lista.replaceChildren(mensagem(err.message)); }
    }
    desenharLista();
    const testar = el("button", { type: "button", class: "lnux-botao", id: "contas-testar-email", onclick: async () => {
      const campoPara = entrada({ type: "email", value: remetente.value || "", "aria-label": "Mandar o teste para" });
      const para = await LNUX.dialogo({ titulo: "E-mail de teste", corpo: el("div", { class: "ajustes" }, campo("Mandar um e-mail de teste para", campoPara)),
        botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Mandar", primario: true, valor: () => campoPara.value.trim() }] });
      if (!para) return;
      try { await salvar(); await C.contas.emailTeste(para); LNUX.aviso("E-mail de teste mandado. Confira a caixa de entrada.", "ok"); } catch (err) { LNUX.erro(err); }
    } }, "Mandar um e-mail de teste");
    async function salvar() {
      const email = { servidor: servidor.value.trim(), porta: porta.value, seguranca: seguranca.value, usuario: usuario.value.trim(), remetente: remetente.value.trim(), nome: nomeRem.value.trim() };
      if (senha.value) email.senha = senha.value;
      const r = await C.contas.salvarAjustes({ email, idade_minima: +idade.value, exigir_conta: exigir.checked });
      await C.contas.atualizarPublico();
      return r;
    }
    const corpo = el("div", { class: "ajustes janela-contas-dono" },
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, `As contas ficam neste aparelho: ${a.pasta} (${a.contas} confirmadas).`),
      el("div", { class: "lnux-rotulo" }, "E-mail que manda os códigos"),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Use uma conta de e-mail sua. No Gmail, crie uma \"senha de app\" (Conta Google › Segurança › Senhas de app) e use aqui, não a senha normal. A senha fica só neste aparelho."),
      campo("Provedor", provedor),
      el("div", { class: "grade" }, campo("Servidor SMTP", servidor), campo("Porta", porta)),
      el("div", { class: "grade" }, campo("Segurança", seguranca), campo("Usuário", usuario)),
      el("div", { class: "grade" }, campo("Senha", senha), campo("Remetente (e-mail)", remetente)),
      campo("Nome do remetente", nomeRem), testar,
      el("div", { class: "lnux-rotulo" }, "Regras"),
      el("div", { class: "grade" }, campo("Idade mínima para criar conta", idade), el("label", { class: "lnux-alternar" }, exigir, "Só entra nas salas quem tem conta")),
      el("div", { class: "lnux-rotulo" }, "Contas"), lista);
    const r = await LNUX.dialogo({ titulo: "Contas e e-mail", largo: true, corpo, botoes: [{ rotulo: "Fechar", valor: null }, { rotulo: "Salvar", primario: true, valor: "ok" }] });
    if (r === "ok") { try { await salvar(); LNUX.aviso("Ajustes das contas salvos.", "ok"); } catch (err) { LNUX.erro(err); } }
  };

  C.contas.disponivel().then((tem) => { if (tem) C.contas.carregar(); });
})();
