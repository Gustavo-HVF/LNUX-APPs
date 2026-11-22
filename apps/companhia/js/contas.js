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
      const antes = JSON.stringify(this.eu || null);
      if (!this.sessao()) this.eu = null;
      else {
        try { this.eu = await pedir("GET", "eu"); this.sincronizarTema(); }
        catch (e) { if (e.status === 401) this.guardarSessao(""); this.eu = null; }
      }
      // só avisa se mudou: quem ouve (a página do perfil) carrega de novo, e avisar sempre faria um laço sem fim
      if (JSON.stringify(this.eu || null) !== antes) this.avisar();
      return this.eu;
    },
    entrou(r) { this.guardarSessao(r.sessao); this.eu = r.conta; this.sincronizarTema(); this.avisar(); return r.conta; },
    /** O tema do perfil: a conta sem tema recebe o deste navegador; o navegador que nunca escolheu um usa o da conta. */
    sincronizarTema() {
      const eu = this.eu;
      if (!eu || !C.temas) return;
      let escolhido = null;
      try { escolhido = localStorage.getItem("webc.tema"); } catch (e) { /* sem armazenamento */ }
      if (!eu.tema) { eu.tema = C.temas.atual; pedir("POST", "perfil", { json: { tema: eu.tema } }).catch(() => {}); }
      else if (!escolhido && eu.tema !== C.temas.atual && C.temas.TEMAS.some((t) => t.id === eu.tema)) C.temas.definir(eu.tema);
    },
    cadastrar: (d) => pedir("POST", "cadastro", { json: { ...d, idioma: C.idioma || "pt" } }),
    async verificar(email, codigo) { return C.contas.entrou(await pedir("POST", "verificar", { json: { email, codigo } })); },
    reenviar: (email) => pedir("POST", "reenviar", { json: { email } }),
    async entrar(email, senha) { return C.contas.entrou(await pedir("POST", "entrar", { json: { email, senha } })); },
    async sair() { try { await pedir("POST", "sair", { json: {} }); } catch (e) { /* já saiu */ } this.guardarSessao(""); this.eu = null; this.avisar(); },
    async salvarPerfil(d) { this.eu = await pedir("POST", "perfil", { json: d }); this.avisar(); return this.eu; },
    async mandarImagem(tipo, blob) { this.eu = await pedir("PUT", "midia", { corpo: blob, parametros: { tipo } }); this.avisar(); return this.eu; },
    async tirarImagem(tipo) { this.eu = await pedir("DELETE", "midia", { parametros: { tipo } }); this.avisar(); return this.eu; },
    trocarSenha: (atual, nova) => pedir("POST", "senha", { json: { atual, nova } }),
    recuperar: (email) => pedir("POST", "recuperar", { json: { email, idioma: C.idioma || "pt" } }),
    async redefinir(email, codigo, senha) { return C.contas.entrou(await pedir("POST", "redefinir", { json: { email, codigo, senha } })); },
    async apagar(senha) { await pedir("POST", "apagar", { json: { senha } }); this.guardarSessao(""); this.eu = null; this.avisar(); },
    perfil: (id) => pedir("GET", "perfil/" + encodeURIComponent(id)),
    /** Pesquisar por alguém pelo nome: {pessoas: [{id, nome, foto, cor, titulos, relacao}], mais}. */
    buscar: (q) => pedir("GET", "buscar", { parametros: { q } }),
    /** O nome está livre? (nenhuma outra conta tem esse nome, sem diferença de acentos e maiúsculas). Sem servidor: livre. */
    async nomeLivre(nome) {
      if (!(await this.disponivel())) return true;
      try { return !!(await pedir("GET", "nome", { parametros: { nome } })).livre; } catch (e) { return true; }
    },
    /** O dono do servidor (no aparelho dele, com a chave) ou uma conta com cargo de dono ou admin: pode dar títulos. */
    souDonoDoServidor: () => !!(LNUX.ponte && LNUX.ponte.disponivel),
    podeDarTitulos() { const c = (this.eu || {}).cargo; return this.souDonoDoServidor() || c === "dono" || c === "admin"; },
    /** Dá títulos a uma conta ({titulos: [{nome, cor}], cargo}). Devolve o perfil dela. */
    darTitulos: (id, d) => pedir("POST", "titulos", { json: { id, ...d } }),
    /** Amizade: acao = pedir | aceitar | recusar | desfazer. Devolve {relacao, amigos, pedidos, enviados}. */
    async amizade(acao, id) { const r = await pedir("POST", "amigos", { json: { acao, id } }); if (this.eu) Object.assign(this.eu, { amigos: r.amigos, pedidos: r.pedidos, enviados: r.enviados }); this.avisar(); return r; },
    /** Guarda (ou tira) um item da loja no perfil. */
    async salvar(id, salvar = true) { const r = await pedir("POST", "salvos", { json: { id, salvar } }); if (this.eu) this.eu.salvos = r.salvos; return r.salvos; },
    salvou(id) { return !!(this.eu && (this.eu.salvos || []).includes(id)); },
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

  /** Os tamanhos das imagens do perfil: a foto (quadrada, mostrada redonda) e o banner (a capa), 750 × 325. */
  C.TAMANHOS_DO_PERFIL = { foto: [512, 512], capa: [750, 325] };

  /**
   * Arrumar uma imagem antes de usar: a pessoa arrasta para posicionar e amplia ou reduz (o controle, os botões − e +,
   * a rodinha do mouse ou dois dedos). Sai do tamanho pedido (largura × altura), em WebP (ou JPEG). Resolve com o
   * Blob, ou null se cancelar. redonda: mostra o círculo da foto do perfil por cima.
   */
  C.ajustarImagem = async function (blob, { largura, altura, redonda = false, titulo = "Ajustar a imagem" } = {}) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (e) { throw new Error(C.t("Não consegui abrir essa imagem (use PNG, JPEG, WebP ou GIF).")); }
    const iw = bmp.width, ih = bmp.height;
    const cobrir = Math.max(largura / iw, altura / ih), caber = Math.min(largura / iw, altura / ih);
    const zMin = Math.min(1, caber / cobrir), zMax = 6;
    let z = 1, cx = largura / 2, cy = altura / 2; // o centro da imagem, nas medidas da saída
    // a cor do fundo (quando a imagem fica menor que o quadro): a média da própria imagem
    const media = (() => { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; })();
    const tela = el("canvas", { class: "recorte-tela" });
    const quadro = el("div", { class: "recorte-quadro" + (redonda ? " redonda" : ""), tabindex: 0, role: "img", "aria-label": C.t("Arraste para posicionar a imagem"), style: { aspectRatio: `${largura} / ${altura}` } },
      tela, redonda ? el("div", { class: "recorte-circulo", "aria-hidden": "true" }) : null);
    const zoom = el("input", { type: "range", class: "recorte-zoom", min: 0, max: 1000, step: 1, "aria-label": C.t("Zoom") });
    const escala = () => cobrir * z;
    /** Mantém a imagem cobrindo o quadro (ou, menor que ele, dentro dele). */
    function prender() {
      const s = escala(), mx = (iw * s) / 2, my = (ih * s) / 2;
      cx = Math.min(Math.max(cx, Math.min(mx, largura - mx)), Math.max(mx, largura - mx));
      cy = Math.min(Math.max(cy, Math.min(my, altura - my)), Math.max(my, altura - my));
    }
    function pintar(ctx, k) {
      const s = escala() * k;
      ctx.fillStyle = media;
      ctx.fillRect(0, 0, largura * k, altura * k);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, cx * k - (iw * s) / 2, cy * k - (ih * s) / 2, iw * s, ih * s);
    }
    // o zoom no controle é logarítmico (o meio do controle fica perto do tamanho que cobre o quadro)
    const zParaControle = (v) => Math.round((Math.log(v / zMin) / Math.log(zMax / zMin)) * 1000);
    const controleParaZ = (n) => zMin * Math.pow(zMax / zMin, n / 1000);
    function desenhar() {
      const r = quadro.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (tela.width !== w || tela.height !== h) { tela.width = w; tela.height = h; }
      pintar(tela.getContext("2d"), w / largura);
      zoom.value = zParaControle(z);
    }
    /** Amplia (ou reduz) em volta de um ponto do quadro (px, py, nas medidas da saída). */
    function ampliar(novo, px = largura / 2, py = altura / 2) {
      novo = Math.min(zMax, Math.max(zMin, novo));
      cx = px - ((px - cx) * novo) / z;
      cy = py - ((py - cy) * novo) / z;
      z = novo;
      prender();
      desenhar();
    }
    const paraSaida = (e) => { const r = quadro.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * largura, ((e.clientY - r.top) / r.height) * altura]; };
    // arrastar (um dedo ou o mouse) e a pinça (dois dedos)
    const toques = new Map();
    let pinca = null;
    quadro.addEventListener("pointerdown", (e) => {
      quadro.setPointerCapture(e.pointerId);
      toques.set(e.pointerId, [e.clientX, e.clientY]);
      quadro.classList.add("arrastando");
      if (toques.size === 2) { const [a, b] = [...toques.values()]; pinca = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z }; }
    });
    quadro.addEventListener("pointermove", (e) => {
      if (!toques.has(e.pointerId)) return;
      const antes = toques.get(e.pointerId), r = quadro.getBoundingClientRect();
      toques.set(e.pointerId, [e.clientX, e.clientY]);
      if (toques.size >= 2 && pinca) {
        const [a, b] = [...toques.values()];
        const meio = paraSaida({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
        ampliar(pinca.z * (Math.hypot(a[0] - b[0], a[1] - b[1]) / (pinca.d || 1)), meio[0], meio[1]);
        return;
      }
      cx += ((e.clientX - antes[0]) / r.width) * largura;
      cy += ((e.clientY - antes[1]) / r.height) * altura;
      prender();
      desenhar();
    });
    const soltar = (e) => { toques.delete(e.pointerId); if (toques.size < 2) pinca = null; if (!toques.size) quadro.classList.remove("arrastando"); };
    quadro.addEventListener("pointerup", soltar);
    quadro.addEventListener("pointercancel", soltar);
    quadro.addEventListener("wheel", (e) => { e.preventDefault(); const [px, py] = paraSaida(e); ampliar(z * Math.exp(-e.deltaY * 0.0015), px, py); }, { passive: false });
    quadro.addEventListener("keydown", (e) => {
      const passo = e.shiftKey ? 40 : 10, mover = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[e.key];
      if (mover) { cx += mover[0]; cy += mover[1]; prender(); desenhar(); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { ampliar(z * 1.15); e.preventDefault(); }
      else if (e.key === "-") { ampliar(z / 1.15); e.preventDefault(); }
    });
    zoom.addEventListener("input", () => ampliar(controleParaZ(+zoom.value)));
    const botao = (rotulo, aria, acao) => el("button", { type: "button", class: "lnux-botao plano recorte-botao", "aria-label": C.t(aria), onclick: acao }, rotulo);
    const corpo = el("div", { class: "recorte" }, quadro,
      el("div", { class: "recorte-controles" }, botao("−", "Reduzir", () => ampliar(z / 1.2)), zoom, botao("+", "Ampliar", () => ampliar(z * 1.2)),
        el("button", { type: "button", class: "lnux-botao plano pequeno", id: "recorte-inteira", onclick: () => { z = zMin; cx = largura / 2; cy = altura / 2; desenhar(); } }, C.t("Imagem inteira")),
        el("button", { type: "button", class: "lnux-botao plano pequeno", id: "recorte-centralizar", onclick: () => { z = 1; cx = largura / 2; cy = altura / 2; desenhar(); } }, C.t("Preencher"))),
      el("p", { class: "fraco pequeno recorte-dica" }, C.t("Arraste para posicionar. Use o controle, a rodinha do mouse ou dois dedos para ampliar e reduzir. Fica com {l} × {a} pixels.", { l: largura, a: altura })));
    const observar = new ResizeObserver(() => desenhar());
    observar.observe(quadro);
    const r = await LNUX.dialogo({ titulo: C.t(titulo), largo: true, corpo, botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Usar", primario: true, valor: "usar" }] });
    observar.disconnect();
    if (r !== "usar") { bmp.close(); return null; }
    const saida = document.createElement("canvas");
    saida.width = largura; saida.height = altura;
    pintar(saida.getContext("2d"), 1);
    bmp.close();
    const webp = await new Promise((ok) => saida.toBlob(ok, "image/webp", 0.9));
    return webp && webp.type === "image/webp" ? webp : new Promise((ok) => saida.toBlob(ok, "image/jpeg", 0.9));
  };

  /** Trocar a foto ou o banner do perfil: escolher a imagem, arrumar (zoom e posição) e mandar. Resolve com a conta, ou null. */
  C.trocarImagemDoPerfil = async function (tipo) {
    const [a] = await LNUX.arquivos.abrir({ titulo: tipo === "foto" ? C.t("Foto do perfil") : C.t("Banner do perfil"), aceitar: ".png,.jpg,.jpeg,.webp,.gif,.bmp,image/*" });
    if (!a) return null;
    try {
      const [largura, altura] = C.TAMANHOS_DO_PERFIL[tipo];
      const blob = await C.ajustarImagem(await a.blob(), { largura, altura, redonda: tipo === "foto", titulo: tipo === "foto" ? "Ajustar a foto" : "Ajustar o banner" });
      if (!blob) return null;
      return await C.contas.mandarImagem(tipo, blob);
    } catch (e) { LNUX.erro(e); return null; }
  };

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
      corpo.dataset.modo = modo;
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
        if (e.campo === "nome") { const n = corpo.querySelector('input[aria-label="Nome"]'); if (n) { n.setAttribute("aria-invalid", "true"); n.focus(); } }
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
          el("div", { class: "conta-ou", role: "separator" }, el("span", {}, "ou")),
          el("p", { class: "conta-criar", style: { margin: 0 } }, link("Criar uma conta", () => desenhar("criar")))];
      },
      criar(msg) {
        const n = entrada({ autocomplete: "nickname", maxlength: 30, "aria-label": "Nome" }), e = entrada({ type: "email", autocomplete: "email", "aria-label": "E-mail", value: email });
        const s = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Senha", minlength: 8 }), s2 = entrada({ type: "password", autocomplete: "new-password", "aria-label": "Repita a senha" });
        const i = entrada({ type: "number", min: 1, max: 120, inputmode: "numeric", "aria-label": "Idade" });
        const aceito = el("input", { type: "checkbox", "aria-label": "Concordo em guardar os dados" });
        const ir = el("button", { type: "button", class: "lnux-botao primario", id: "conta-criar" }, "Criar conta");
        const nomeAviso = el("small", { class: "conta-nome-aviso", role: "alert", hidden: true }, C.t("Esse nome já é de outra conta. Escolha outro."));
        n.addEventListener("change", async () => {
          const v = n.value.trim();
          const livre = v.length < 2 || (await C.contas.nomeLivre(v));
          if (n.value.trim() !== v) return;
          nomeAviso.hidden = livre;
          if (livre) n.removeAttribute("aria-invalid"); else n.setAttribute("aria-invalid", "true");
        });
        n.addEventListener("input", () => { nomeAviso.hidden = true; n.removeAttribute("aria-invalid"); });
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
          el("div", { class: "grade" }, el("div", { class: "conta-nome" }, campo("Nome", n, "Como os outros vão te ver"), nomeAviso), campo("Idade", i, pub.idade_minima ? `A partir de ${pub.idade_minima} anos` : "")),
          campo("E-mail", e, "Para o código de confirmação e para recuperar a senha"),
          el("div", { class: "grade" }, campo("Senha", s, "Pelo menos 8 caracteres"), campo("Repita a senha", s2)),
          el("label", { class: "lnux-alternar" }, aceito, el("span", {}, "Concordo que o meu nome, e-mail, idade e perfil fiquem guardados no WEBC.")),
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

  // ── Títulos (Admin, Criador, Moderador, VIP...) ──────────────────────

  /** Os títulos que dá para escolher com um toque (e a cor de cada um); dá também para escrever outro. */
  C.TITULOS_PRONTOS = [["Admin", "#e53935"], ["Moderador", "#1e88e5"], ["Criador", "#8e24aa"], ["VIP", "#d81b60"], ["Apoiador", "#43a047"],
    ["Dev", "#00897b"], ["Artista", "#fb8c00"], ["Ajudante", "#5e35b1"], ["Veterano", "#6d4c41"]];
  /** Os selos dos títulos de alguém (ou null se não tem). */
  C.selosDeTitulos = function (titulos, pequeno = false) {
    if (!titulos || !titulos.length) return null;
    return el("span", { class: "selos-titulos" + (pequeno ? " pequenos" : ""), translate: "no" },
      titulos.map((x) => el("span", { class: "selo-titulo", style: { "--selo": x.cor || "#6b7280" } }, x.nome)));
  };
  /**
   * Dar títulos a uma conta: os prontos com um toque, um escrito à mão (com a cor) e, para o dono, o cargo (admin dá
   * títulos também). Resolve com o perfil atualizado, ou null.
   */
  C.janelaTitulos = async function (conta) {
    let lista = (conta.titulos || []).map((x) => ({ ...x }));
    const servidor = C.contas.souDonoDoServidor(), meuCargo = servidor ? "servidor" : (C.contas.eu || {}).cargo || "";
    const atuais = el("div", { class: "titulos-atuais" });
    const prontos = el("div", { class: "titulos-prontos" });
    const novoNome = entrada({ maxlength: 20, placeholder: C.t("Outro título"), "aria-label": C.t("Outro título") });
    const novaCor = el("input", { type: "color", value: "#6b7280", "aria-label": C.t("Cor do título") });
    const aviso = el("p", { class: "conta-msg erro", role: "alert", hidden: true });
    const tem = (nome) => lista.some((x) => x.nome.toLowerCase() === nome.toLowerCase());
    function colocar(nome, cor) {
      nome = String(nome || "").trim().slice(0, 20);
      if (!nome || tem(nome)) return;
      if (lista.length >= 4) { aviso.textContent = C.t("Até 4 títulos por pessoa."); aviso.hidden = false; return; }
      aviso.hidden = true;
      lista.push({ nome, cor });
      desenhar();
    }
    function desenhar() {
      atuais.replaceChildren(...(lista.length ? lista.map((x, i) => el("span", { class: "selo-titulo removivel", style: { "--selo": x.cor }, translate: "no" }, x.nome,
        el("button", { type: "button", class: "selo-tirar", "aria-label": C.t("Tirar {nome}", { nome: x.nome }), onclick: () => { lista.splice(i, 1); desenhar(); } }, "×")))
        : [el("span", { class: "fraco pequeno" }, C.t("Sem títulos."))]));
      prontos.replaceChildren(...C.TITULOS_PRONTOS.map(([n, c]) => el("button", { type: "button", class: "selo-titulo opcao" + (tem(n) ? " ativo" : ""), style: { "--selo": c }, "aria-pressed": String(tem(n)), "data-titulo": n,
        onclick: () => { if (tem(n)) lista = lista.filter((x) => x.nome.toLowerCase() !== n.toLowerCase()); else colocar(n, c); desenhar(); } }, C.t(n))));
    }
    desenhar();
    // o cargo: o dono dá e tira o de administrador; o de dono só muda no aparelho do servidor
    let cargo = null;
    const opcoesCargo = [["", C.t("Nenhum")], ["admin", C.t("Administrador (também dá títulos)")]].concat(servidor ? [["dono", C.t("Dono do servidor")]] : []);
    if ((meuCargo === "servidor" || meuCargo === "dono") && (servidor || conta.cargo !== "dono")) {
      cargo = el("select", { class: "lnux-selecao", "aria-label": C.t("Cargo") }, opcoesCargo.map(([v, r]) => el("option", { value: v, selected: (conta.cargo || "") === v }, r)));
      cargo.addEventListener("change", () => { if (cargo.value === "admin" && !tem("Admin")) colocar("Admin", "#e53935"); });
    }
    const corpo = el("div", { class: "ajustes janela-titulos" },
      el("p", { style: { margin: 0 } }, el("b", { translate: "no" }, conta.nome)),
      el("div", { class: "lnux-rotulo" }, C.t("Títulos")), atuais,
      el("div", { class: "lnux-rotulo" }, C.t("Escolher")), prontos,
      el("div", { class: "linha" }, novoNome, novaCor, el("button", { type: "button", class: "lnux-botao", id: "titulo-por", onclick: () => { colocar(novoNome.value, novaCor.value); novoNome.value = ""; } }, C.t("Pôr"))),
      aviso,
      cargo ? campo(C.t("Cargo"), cargo, C.t("Quem é administrador também dá títulos, pelo perfil das pessoas (até pelo celular).")) : null);
    novoNome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); colocar(novoNome.value, novaCor.value); novoNome.value = ""; } });
    const r = await LNUX.dialogo({ titulo: C.t("Títulos"), corpo, botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", primario: true, valor: "ok" }] });
    if (r !== "ok") return null;
    try {
      const d = { titulos: lista };
      if (cargo && cargo.value !== (conta.cargo || "")) d.cargo = cargo.value;
      const novo = await C.contas.darTitulos(conta.id, d);
      if (C.contas.eu && C.contas.eu.id === conta.id) { C.contas.eu = { ...C.contas.eu, titulos: novo.titulos, cargo: novo.cargo }; C.contas.avisar(); }
      LNUX.aviso(C.t("Títulos salvos."), "ok");
      return novo;
    } catch (e) { LNUX.erro(e); return null; }
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
        el("div", {}, el("h2", {}, p.nome), C.selosDeTitulos(p.titulos), p.pronomes ? el("span", { class: "fraco" }, p.pronomes) : null)),
      p.bio ? el("p", { class: "perfil-bio" }, p.bio) : el("p", { class: "fraco" }, "Sem bio."),
      el("div", { class: "fraco pequeno" }, [p.local ? "📍 " + p.local : "", "conta desde " + new Date(p.desde * 1000).toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")),
      p.links && p.links.length ? el("div", { class: "perfil-links" }, p.links.map((l) => el("a", { href: l, target: "_blank", rel: "noopener noreferrer nofollow" }, l.replace(/^https?:\/\//, "")))) : null);
    if (p.tema && C.temas) C.temas.local(corpo, p.tema); // no tema que a pessoa usa
    const botoes = [{ rotulo: "Fechar", primario: true, valor: null }];
    if (C.contas.podeDarTitulos()) botoes.unshift({ rotulo: "Dar títulos...", valor: "titulos" });
    const r = await LNUX.dialogo({ titulo: "Perfil", corpo, botoes });
    if (r === "titulos" && await C.janelaTitulos(p)) return C.mostrarPerfil(id);
    return r;
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
          el("button", { type: "button", class: "lnux-botao", id: "perfil-capa", onclick: () => trocar("capa") }, "Trocar o banner"),
          eu.capa ? el("button", { type: "button", class: "lnux-botao", id: "perfil-tirar-capa", onclick: () => tirar("capa") }, "Tirar") : null),
        el("div", { class: "perfil-cabeca" }, C.fotoDaConta(eu, 84),
          el("div", { class: "linha" }, el("button", { type: "button", class: "lnux-botao", id: "perfil-foto", onclick: () => trocar("foto") }, "Trocar a foto"),
            eu.foto ? el("button", { type: "button", class: "lnux-botao plano", onclick: () => tirar("foto") }, "Tirar a foto") : null)));
    };
    async function trocar(tipo) {
      const novo = await C.trocarImagemDoPerfil(tipo);
      if (novo) { eu = novo; desenharTopo(); }
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
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, C.t("E-mail: {email} · idade: {idade} anos. Só você vê; os outros veem o perfil.", { email: eu.email, idade: eu.idade })),
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
  // o domínio da conta → o provedor (para preencher o SMTP certo)
  const DOMINIOS = { "gmail.com": "gmail", "googlemail.com": "gmail", "outlook.com": "outlook", "hotmail.com": "outlook", "live.com": "outlook", "yahoo.com": "yahoo", "yahoo.com.br": "yahoo" };
  const PORTAS_DE_RECEBER = { 993: "IMAP", 143: "IMAP", 995: "POP", 110: "POP" };
  /** O provedor de um e-mail ou de um servidor (imap.gmail.com → gmail), ou "". */
  const provedorDe = (...textos) => {
    for (const t of textos) {
      const d = String(t || "").trim().toLowerCase().split("@").pop();
      for (const [dom, p] of Object.entries(DOMINIOS)) if (d === dom || d.endsWith("." + dom)) return p;
    }
    return "";
  };
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
    const nomeRem = entrada({ value: e.nome || "", "aria-label": "Nome do remetente", placeholder: "WEBC" });
    const preencher = (nome) => { const p = PROVEDORES[nome]; if (p) { servidor.value = p[0]; porta.value = p[1]; seguranca.value = p[2]; } conferir(); };
    provedor.addEventListener("change", () => preencher(provedor.value));
    provedor.value = Object.keys(PROVEDORES).find((k) => PROVEDORES[k][0] === (e.servidor || "").trim().toLowerCase()) || "";
    // o engano mais comum: o servidor de RECEBER (IMAP/POP, como o app de e-mail do celular mostra) no lugar do de mandar
    const avisoServidor = el("div", { class: "conta-msg erro contas-aviso-smtp", role: "alert", hidden: true });
    function conferir() {
      const host = servidor.value.trim().toLowerCase(), tipo = PORTAS_DE_RECEBER[+porta.value] || (/^imap\./.test(host) ? "IMAP" : /^pop3?\./.test(host) ? "POP" : "");
      if (!tipo) { avisoServidor.hidden = true; return; }
      const prov = provedorDe(usuario.value, remetente.value, host), certo = PROVEDORES[prov] || [host.replace(/^(imap|pop3?|mail)\./, "smtp.") || "smtp.seu-provedor.com", 465, "ssl"];
      avisoServidor.replaceChildren(el("span", {}, C.t("Esse é o servidor de receber e-mails ({tipo}), não o de mandar. Para mandar os códigos, use o SMTP: {smtp}.",
        { tipo, smtp: `${certo[0]}, ${C.t("porta")} ${certo[1]} (${certo[2] === "ssl" ? "SSL/TLS" : "STARTTLS"})` })), " ",
        el("button", { type: "button", class: "lnux-botao pequeno", id: "contas-corrigir-smtp", onclick: () => { servidor.value = certo[0]; porta.value = certo[1]; seguranca.value = certo[2]; provedor.value = prov; conferir(); } }, C.t("Corrigir")));
      avisoServidor.hidden = false;
    }
    servidor.addEventListener("input", conferir);
    porta.addEventListener("input", () => { if (+porta.value === 465) seguranca.value = "ssl"; else if (+porta.value === 587) seguranca.value = "starttls"; conferir(); });
    seguranca.addEventListener("change", () => { if (["", "465", "587"].includes(porta.value.trim())) porta.value = seguranca.value === "ssl" ? 465 : seguranca.value === "starttls" ? 587 : porta.value; conferir(); });
    // a conta é do Gmail (ou outro conhecido) e o servidor está vazio: já preenche
    for (const c of [usuario, remetente]) c.addEventListener("change", () => { const p = provedorDe(c.value); if (p && !servidor.value.trim()) { provedor.value = p; preencher(p); } conferir(); });
    conferir();
    const idade = entrada({ type: "number", min: 0, max: 99, value: a.idade_minima, "aria-label": "Idade mínima" });
    const exigir = el("input", { type: "checkbox", checked: a.exigir_conta, "aria-label": "Só joga quem tem conta" });
    const lista = el("div", { class: "contas-lista" });
    async function desenharLista() {
      try {
        const l = (await C.contas.lista()).contas;
        lista.replaceChildren(l.length ? el("table", {}, el("tbody", {}, l.map((c) => el("tr", {},
          el("td", {}, el("span", { translate: "no" }, c.nome), " ", C.selosDeTitulos(c.titulos, true), c.cargo ? el("span", { class: "fraco pequeno" }, " · " + C.t(c.cargo === "dono" ? "dono" : "administrador")) : null),
          el("td", { class: "fraco" }, c.email), el("td", {}, c.idade + " anos"), el("td", { class: "fraco pequeno" }, c.verificada ? "confirmada" : "falta o código"),
          el("td", {}, c.verificada ? el("button", { type: "button", class: "lnux-botao plano", "data-titulos": c.id, onclick: async () => { if (await C.janelaTitulos(c)) desenharLista(); } }, "Títulos") : null),
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
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, C.t("{n} contas confirmadas.", { n: a.contas })),
      el("div", { class: "lnux-rotulo" }, "E-mail que manda os códigos"),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Use uma conta de e-mail sua. Quem manda os códigos é este servidor: não precisa configurar nada no app de e-mail do celular. A senha fica guardada só no servidor e não volta para a tela."),
      el("p", { class: "fraco pequeno contas-gmail", style: { margin: 0 } }, C.t("No Gmail: ligue a verificação em duas etapas e crie uma senha de app (16 letras) em"), " ",
        el("a", { href: "https://myaccount.google.com/apppasswords", target: "_blank", rel: "noopener noreferrer", translate: "no" }, "myaccount.google.com/apppasswords"),
        C.t(". Use essa senha aqui, não a senha normal da conta. O servidor é smtp.gmail.com, porta 465 (SSL/TLS).")),
      campo("Provedor", provedor),
      el("div", { class: "grade" }, campo("Servidor SMTP (de mandar)", servidor), campo("Porta", porta)), avisoServidor,
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
