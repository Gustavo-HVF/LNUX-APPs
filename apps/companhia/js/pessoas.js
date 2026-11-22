/*
 * WEBC — as outras pessoas dentro da sala:
 *   - Clicar na personagem de alguém abre três bolinhas em cima dela (no alto, à direita de quem olha): Adicionar amigo,
 *     Ver perfil e Chat privado. Cada bolinha é branca com a borda preta e tem um desenho; ao passar o mouse (ou focar
 *     pelo teclado), ela se estica e mostra o nome da opção. No celular, os nomes já aparecem.
 *   - O chat privado: um pede, o outro aceita (ou recusa); as mensagens só chegam às duas pessoas, numa janelinha
 *     embaixo à direita (uma por conversa). Quem sai da sala fecha os chats dele.
 *
 * C.MenuDePessoa(ctx) — ctx: sala() → a Sala (js/sala.js), palco() → o palco 3D, privados() → o C.Privados.
 * C.Privados(ctx) — ctx: sala() → a Sala.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);
  const reduzir = () => "reduzir" in document.documentElement.dataset || !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ── os desenhos (SVG próprios, sem emoji) ───────────────────────────
  const svg = (corpo) => `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">${corpo}</svg>`;
  const ICONES = {
    amigo: svg('<circle cx="9.5" cy="8" r="4" fill="currentColor"/><path fill="currentColor" d="M2 20.5c0-4.3 3.4-7 7.5-7s7.5 2.7 7.5 7Z"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M19 7v7M15.5 10.5h7"/>'),
    amigos: svg('<circle cx="9.5" cy="8" r="4" fill="currentColor"/><path fill="currentColor" d="M2 20.5c0-4.3 3.4-7 7.5-7s7.5 2.7 7.5 7Z"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m15.5 10.5 2.3 2.3 4.4-4.6"/>'),
    esperando: svg('<circle cx="9.5" cy="8" r="4" fill="currentColor"/><path fill="currentColor" d="M2 20.5c0-4.3 3.4-7 7.5-7s7.5 2.7 7.5 7Z"/><circle cx="18.8" cy="10.5" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M18.8 8.4v2.2l1.4 1"/>'),
    perfil: svg('<rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="9" cy="10.3" r="2.6" fill="currentColor"/><path fill="currentColor" d="M4.8 17c.4-2.4 2.1-3.6 4.2-3.6s3.8 1.2 4.2 3.6Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15 9.5h3.5M15 13h3.5"/>'),
    privado: svg('<path fill="currentColor" d="M11 3C6 3 2 6.2 2 10.2c0 2.2 1.2 4.1 3.1 5.4L4.2 19.5l4.2-2.4c.8.2 1.7.3 2.6.3h.4V14a4 4 0 0 1 4-4h4.4C19 6 15.4 3 11 3Z"/><rect x="13.5" y="14.5" width="8.5" height="7" rx="1.5" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M15.5 14.5V13a2.25 2.25 0 0 1 4.5 0v1.5"/>'),
    fechar: svg('<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>'),
    minimizar: svg('<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 12h12"/>'),
    enviar: svg('<path fill="currentColor" d="M3 20.5 21.5 12 3 3.5l2.2 7L14 12l-8.8 1.5Z"/>'),
  };
  const icone = (nome) => el("span", { class: "pessoa-bolha-icone", html: ICONES[nome] });
  // onde ficam as três bolinhas, a partir do alto da cabeça (em pixels): um arco do alto para a direita, como no desenho
  const LUGARES = [[-6, -66], [46, -44], [70, 4]];

  /** A foto de quem tem conta (ou as iniciais, na cor de cada um). */
  function fotoDe(r, tamanho) {
    if (!r.conta) return C.fotoDaConta({ nome: r.nome, cor: typeof r.cor === "number" ? "#" + r.cor.toString(16).padStart(6, "0") : "" }, tamanho);
    return el("img", { class: "foto-conta", src: `/api/contas/midia/${r.conta}/foto`, alt: "", style: { width: tamanho + "px", height: tamanho + "px" },
      onerror: (e) => { e.target.replaceWith(C.fotoDaConta({ nome: r.nome }, tamanho)); } });
  }

  // ── as três bolinhas em cima da personagem ─────────────────────────

  C.MenuDePessoa = function (ctx) {
    let aberto = null; // {remoto, raiz, quadro, relacao}

    // um clique (sem arrastar: arrastar gira a câmera) na personagem de alguém abre as bolinhas
    function ligar() {
      const p = ctx.palco();
      if (!p || !p.conteiner || p.conteiner.dataset.menuPessoa) return;
      p.conteiner.dataset.menuPessoa = "1";
      let toque = null;
      p.conteiner.addEventListener("pointerdown", (e) => { if (e.button <= 0) toque = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
      p.conteiner.addEventListener("pointerup", (e) => {
        const ini = toque;
        toque = null;
        if (!ini || ini.id !== e.pointerId || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 8 || performance.now() - ini.t > 600) return;
        const s = ctx.sala();
        const r = s && s.dentro ? s.pessoaNaTela(e.clientX, e.clientY) : null;
        if (r) abrir(r); else fechar();
      });
    }

    function abrir(r) {
      if (aberto && aberto.remoto === r) { fechar(); return; }
      fechar();
      const eu = C.contas && C.contas.eu;
      const bolha = (id, nomeIcone, rotulo, acao, { ativo = true, dica = "" } = {}) => el("button", {
        type: "button", class: "pessoa-bolha", "data-opcao": id, "aria-label": rotulo, title: dica || rotulo, "aria-disabled": ativo ? null : "true",
        onclick: (e) => { e.stopPropagation(); if (ativo) acao(); else if (dica) LNUX.aviso(dica, "alerta"); },
      }, icone(nomeIcone), el("span", { class: "pessoa-bolha-texto" }, rotulo));
      const semConta = !r.conta;
      const amigo = bolha("amigo", "amigo", t("Adicionar amigo"), () => pedirAmizade(r),
        { ativo: !semConta, dica: semConta ? t("{nome} está jogando sem conta.", { nome: r.nome }) : "" });
      const perfil = bolha("perfil", "perfil", t("Ver perfil"), () => { fechar(); C.webc ? C.webc.verPerfil(r.conta) : C.mostrarPerfil(r.conta); },
        { ativo: !semConta, dica: semConta ? t("{nome} está jogando sem conta.", { nome: r.nome }) : "" });
      const privados = ctx.privados();
      const privado = bolha("privado", "privado", privados.rotulo(r.id), () => { fechar(); privados.abrirCom(r).catch(LNUX.erro); });
      const bolhas = [amigo, perfil, privado];
      const raiz = el("div", { class: "pessoa-bolhas" + (reduzir() ? "" : " entrando"), role: "menu", "aria-label": t("Opções para {nome}", { nome: r.nome }), "data-pessoa": r.id }, bolhas);
      bolhas.forEach((b, i) => { b.setAttribute("role", "menuitem"); b.style.setProperty("--i", i); });
      raiz.addEventListener("keydown", (e) => {
        const i = bolhas.indexOf(document.activeElement);
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); }
        else if (/^(ArrowDown|ArrowRight)$/.test(e.key)) { e.preventDefault(); bolhas[(i + 1) % bolhas.length].focus(); }
        else if (/^(ArrowUp|ArrowLeft)$/.test(e.key)) { e.preventDefault(); bolhas[(i + bolhas.length - 1) % bolhas.length].focus(); }
      });
      document.body.append(raiz);
      aberto = { remoto: r, raiz, amigo, relacao: "" };
      if (!reduzir()) requestAnimationFrame(() => raiz.classList.remove("entrando"));
      // a relação de amizade muda o desenho e o nome da primeira bolinha
      if (!semConta && eu) {
        if (eu.id === r.conta) desenharAmizade("eu");
        else C.contas.perfil(r.conta).then((p) => { if (aberto && aberto.remoto === r) desenharAmizade(p.relacao || ""); }).catch(() => {});
      }
      const seguir = () => {
        if (!aberto || aberto.raiz !== raiz) return;
        const s2 = ctx.sala();
        if (!s2 || !s2.dentro || !s2.remotos.has(r.id)) { fechar(); return; }
        const topo = s2.naTela(r, r.altura);
        if (!topo) { raiz.hidden = true; } else {
          raiz.hidden = false;
          raiz.style.transform = `translate(${Math.round(topo.x)}px, ${Math.round(topo.y)}px)`;
        }
        aberto.quadro = requestAnimationFrame(seguir);
      };
      LUGARES.forEach(([x, y], i) => { bolhas[i].style.left = x + "px"; bolhas[i].style.top = y + "px"; });
      seguir();
      // fecha ao clicar fora (o clique em outra personagem abre as dela) ou com o Esc
      aberto.fora = (e) => { if (!raiz.contains(e.target) && !(ctx.palco() && ctx.palco().conteiner.contains(e.target))) fechar(); };
      aberto.tecla = (e) => { if (e.key === "Escape" && aberto) { e.stopPropagation(); fechar(); } };
      setTimeout(() => { if (aberto && aberto.raiz === raiz) { document.addEventListener("pointerdown", aberto.fora, true); document.addEventListener("keydown", aberto.tecla, true); } }, 0);
    }

    function desenharAmizade(relacao) {
      if (!aberto) return;
      aberto.relacao = relacao;
      const b = aberto.amigo, [nomeIcone, rotulo] = {
        eu: ["amigos", t("É você")],
        amigo: ["amigos", t("Já são amigos")],
        enviado: ["esperando", t("Pedido enviado")],
        recebido: ["amigo", t("Aceitar amizade")],
      }[relacao] || ["amigo", t("Adicionar amigo")];
      b.dataset.relacao = relacao;
      b.setAttribute("aria-label", rotulo);
      b.title = rotulo;
      b.querySelector(".pessoa-bolha-icone").innerHTML = ICONES[nomeIcone];
      b.querySelector(".pessoa-bolha-texto").textContent = rotulo;
    }

    async function pedirAmizade(r) {
      const eu = C.contas && C.contas.eu;
      if (!eu) {
        LNUX.aviso(t("Entre na sua conta para adicionar amigos."), "alerta");
        if (C.janelaConta && C.contas.publico && C.contas.publico.contas) C.janelaConta("entrar");
        return;
      }
      const relacao = aberto ? aberto.relacao : "";
      if (relacao === "eu") return;
      if (relacao === "amigo") { LNUX.aviso(t("Vocês já são amigos."), "ok"); return; }
      if (relacao === "enviado") { LNUX.aviso(t("O pedido já foi enviado. Espere {nome} aceitar.", { nome: r.nome })); return; }
      try {
        const res = await C.contas.amizade(relacao === "recebido" ? "aceitar" : "pedir", r.conta);
        desenharAmizade(res.relacao);
        LNUX.aviso(res.relacao === "amigo" ? t("Agora você e {nome} são amigos.", { nome: r.nome }) : t("Pedido de amizade enviado para {nome}.", { nome: r.nome }), "ok");
      } catch (e) { LNUX.erro(e); }
    }

    function fechar() {
      if (!aberto) return;
      cancelAnimationFrame(aberto.quadro);
      document.removeEventListener("pointerdown", aberto.fora, true);
      document.removeEventListener("keydown", aberto.tecla, true);
      aberto.raiz.remove();
      aberto = null;
    }

    return { ligar, abrir, fechar, get aberto() { return aberto ? aberto.remoto : null; } };
  };

  // ── o chat privado ─────────────────────────────────────────────────

  C.Privados = function (ctx) {
    const janelas = new Map(); // id da pessoa → {raiz, lista, campo, minimizada, naoLidas}
    const avisos = new Map();  // id → o aviso "quer conversar no privado"
    const nomes = new Map();   // id → o último nome visto (para quem já saiu)
    const area = el("div", { class: "privados", "aria-live": "polite" });
    document.body.append(area);
    const estado = () => { const s = ctx.sala(); return (s && s.privado) || { recebidos: [], enviados: [], abertos: [] }; };
    const remoto = (id) => { const s = ctx.sala(); return s && s.remotos.get(id); };
    const nome = (id) => { const r = remoto(id); if (r) nomes.set(id, r.nome); return nomes.get(id) || t("Alguém"); };

    /** O nome da bolinha do chat privado, conforme o que está acontecendo com essa pessoa. */
    function rotulo(id) {
      const p = estado();
      return p.abertos.includes(id) ? t("Abrir o chat privado") : p.enviados.includes(id) ? t("Chat privado pedido") : p.recebidos.includes(id) ? t("Aceitar o chat privado") : t("Chat privado");
    }
    /** Pela bolinha: abre o que já está aberto, aceita um pedido ou manda o pedido. */
    async function abrirCom(r) {
      const s = ctx.sala(), p = estado();
      nomes.set(r.id, r.nome);
      if (p.abertos.includes(r.id)) { mostrarJanela(r.id, true); return; }
      if (p.recebidos.includes(r.id)) { await s.pedirPrivado("aceitar", r.id); return; }
      if (p.enviados.includes(r.id)) { mostrarJanela(r.id, true); return; }
      await s.pedirPrivado("pedir", r.id);
      LNUX.aviso(t("Pedido de chat privado enviado para {nome}.", { nome: r.nome }), "ok");
    }

    /** O estado do chat privado mudou (pedidos novos, aceitos, fechados). */
    function aoMudar(p, antes) {
      const s = ctx.sala();
      if (!s || !s.dentro) { limpar(); return; } // saiu da sala: os chats privados fecham
      for (const id of p.recebidos) if (!antes.recebidos.includes(id)) avisarPedido(id);
      for (const id of [...avisos.keys()]) if (!p.recebidos.includes(id)) { avisos.get(id).remove(); avisos.delete(id); }
      for (const id of p.enviados) if (!janelas.has(id)) mostrarJanela(id, false);
      for (const id of p.abertos) {
        if (!antes.abertos.includes(id)) { mostrarJanela(id, false); sistema(id, t("Chat privado com {nome}: só você e {nome} veem estas mensagens.", { nome: nome(id) })); }
      }
      for (const [id, j] of janelas) {
        const esperando = p.enviados.includes(id), abertoAgora = p.abertos.includes(id);
        if (!esperando && !abertoAgora) {
          // estava esperando e não abriu: recusou (ou saiu); estava aberto: fechou
          if (antes.abertos.includes(id)) { sistema(id, remoto(id) ? t("{nome} fechou o chat privado.", { nome: nome(id) }) : t("{nome} saiu da sala.", { nome: nome(id) })); travar(id); }
          else if (antes.enviados.includes(id)) { sistema(id, remoto(id) ? t("{nome} não aceitou o chat privado.", { nome: nome(id) }) : t("{nome} saiu da sala.", { nome: nome(id) })); travar(id); }
          else if (!j.travada) { j.raiz.remove(); janelas.delete(id); }
        } else desenharEstado(id);
      }
    }

    function avisarPedido(id) {
      if (avisos.has(id)) return;
      const s = ctx.sala(), r = remoto(id);
      const responder = (acao) => { s.pedirPrivado(acao, id).catch(LNUX.erro); };
      const aviso = el("div", { class: "privado-pedido", role: "alertdialog", "aria-label": t("Pedido de chat privado"), "data-pessoa": id },
        r ? fotoDe(r, 38) : null,
        el("p", {}, el("b", { translate: "no" }, nome(id)), " ", t("quer conversar no privado.")),
        el("div", { class: "privado-pedido-botoes" },
          el("button", { type: "button", class: "lnux-botao primario pequeno", "data-acao": "aceitar", onclick: () => responder("aceitar") }, t("Aceitar")),
          el("button", { type: "button", class: "lnux-botao pequeno", "data-acao": "recusar", onclick: () => responder("recusar") }, t("Recusar"))));
      avisos.set(id, aviso);
      area.prepend(aviso);
    }

    function mostrarJanela(id, focar) {
      let j = janelas.get(id);
      if (!j) {
        const r = remoto(id);
        const lista = el("div", { class: "privado-mensagens", role: "log", "aria-label": t("Mensagens do chat privado") });
        const campo = el("input", { class: "lnux-entrada privado-campo", maxlength: 300, placeholder: t("Escreva no privado..."), "aria-label": t("Mensagem para {nome}", { nome: nome(id) }),
          onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); enviar(id); } else if (e.key === "Escape") { e.stopPropagation(); campo.blur(); } } });
        const enviarB = el("button", { type: "button", class: "privado-enviar", title: t("Enviar"), "aria-label": t("Enviar"), onclick: () => enviar(id) }, icone("enviar"));
        const estadoLinha = el("p", { class: "privado-estado" });
        const contador = el("span", { class: "privado-contador", hidden: true });
        const raiz = el("section", { class: "privado-janela", "data-pessoa": id, "aria-label": t("Chat privado com {nome}", { nome: nome(id) }) },
          el("header", { class: "privado-topo" },
            el("button", { type: "button", class: "privado-quem", title: t("Minimizar"), onclick: () => minimizar(id) }, r ? fotoDe(r, 28) : C.fotoDaConta({ nome: nome(id) }, 28),
              el("span", { translate: "no" }, nome(id)), contador),
            el("button", { type: "button", class: "privado-botao", title: t("Minimizar"), "aria-label": t("Minimizar"), onclick: () => minimizar(id) }, icone("minimizar")),
            el("button", { type: "button", class: "privado-botao", "data-acao": "fechar", title: t("Fechar o chat privado"), "aria-label": t("Fechar o chat privado"), onclick: () => fecharConversa(id) }, icone("fechar"))),
          estadoLinha, lista,
          el("div", { class: "privado-escrever" }, campo, enviarB));
        j = { raiz, lista, campo, enviarB, estadoLinha, contador, minimizada: false, naoLidas: 0, travada: false };
        janelas.set(id, j);
        area.append(raiz);
      }
      if (j.minimizada && focar) minimizar(id, false);
      desenharEstado(id);
      if (focar && !j.campo.disabled) j.campo.focus();
    }
    function desenharEstado(id) {
      const j = janelas.get(id), p = estado();
      if (!j || j.travada) return;
      const aberto = p.abertos.includes(id);
      j.estadoLinha.hidden = aberto;
      j.estadoLinha.textContent = aberto ? "" : t("Esperando {nome} aceitar...", { nome: nome(id) });
      j.campo.disabled = !aberto;
      j.enviarB.disabled = !aberto;
    }
    /** A conversa acabou (a outra pessoa fechou, recusou ou saiu): a janela fica para ler, sem escrever. */
    function travar(id) {
      const j = janelas.get(id);
      if (!j) return;
      j.travada = true;
      j.campo.disabled = true;
      j.enviarB.disabled = true;
      j.estadoLinha.hidden = true;
    }
    function minimizar(id, sim) {
      const j = janelas.get(id);
      if (!j) return;
      j.minimizada = sim === undefined ? !j.minimizada : sim;
      j.raiz.classList.toggle("minimizada", j.minimizada);
      if (!j.minimizada) { j.naoLidas = 0; j.contador.hidden = true; }
    }
    async function fecharConversa(id) {
      const j = janelas.get(id), s = ctx.sala(), p = estado();
      if (j) { j.raiz.remove(); janelas.delete(id); }
      if (s && s.dentro && (p.abertos.includes(id) || p.enviados.includes(id))) await s.pedirPrivado("fechar", id).catch(() => {});
    }
    async function enviar(id) {
      const j = janelas.get(id), s = ctx.sala();
      const texto = j && j.campo.value.trim();
      if (!texto || !s) return;
      j.campo.value = "";
      try { await s.falarPrivado(id, texto); } catch (e) { LNUX.erro(e); j.campo.value = texto; }
    }
    function linha(id, no) {
      const j = janelas.get(id);
      if (!j) return;
      j.lista.append(no);
      j.lista.scrollTop = j.lista.scrollHeight;
    }
    function sistema(id, texto) { linha(id, el("div", { class: "privado-msg sistema" }, texto)); }

    /** Uma mensagem do chat privado (minha ou da outra pessoa). */
    function mensagem(m) {
      const id = m.meu ? m.para : m.de;
      if (!m.meu) nomes.set(id, m.nome);
      mostrarJanela(id, false);
      linha(id, el("div", { class: "privado-msg " + (m.meu ? "eu" : "ela") }, el("span", { class: "t", translate: "no" }, m.texto)));
      const j = janelas.get(id);
      if (!m.meu && j.minimizada) { j.naoLidas++; j.contador.textContent = String(j.naoLidas); j.contador.hidden = false; }
    }

    /** Saiu da sala: tudo some. */
    function limpar() {
      for (const a of avisos.values()) a.remove();
      avisos.clear();
      for (const j of janelas.values()) j.raiz.remove();
      janelas.clear();
    }

    return { rotulo, abrirCom, aoMudar, mensagem, limpar, janelas, area };
  };
})();
