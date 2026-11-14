/*
 * WEBC — a tela de entrar: a página inteira com a arte de fundo e, no meio, o cartão preto com o logo, o e-mail, a
 * senha, "Entrar", "ou" e "Criar conta" (esqueci a senha e o código por e-mail também acontecem no próprio cartão).
 * "Jogar sem conta" (quando o servidor deixa) pede o nome no próprio cartão: todo mundo entra com um nome, com conta
 * ou não. Quem já entrou na conta neste navegador vai direto para o início. Embaixo, o idioma. Resolve com "jogar".
 *
 * C.telaInicio({ link }): link = veio por um endereço de jogar (#sala=, #modo=jogar). Aí, quem já tem o nome guardado
 * (ou a conta) nem vê a tela; os outros veem, para entrar ou dizer o nome.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);

  /** O nome de quem joga sem conta (guardado neste navegador). Com conta, vale o nome da conta. */
  C.nomeDoJogo = {
    ler: () => LNUX.preferencia.ler("companhia.sala-nome", ""),
    gravar: (n) => LNUX.preferencia.gravar("companhia.sala-nome", String(n || "").trim().slice(0, 24)),
    /** O nome que vale agora: o da conta ou o guardado. */
    atual: () => (C.contas && C.contas.eu ? C.contas.eu.nome : LNUX.preferencia.ler("companhia.sala-nome", "")),
    valido: (n) => String(n || "").trim().length >= 2,
  };

  /** O campo do nome (o mesmo no cartão e na janela de trocar o nome). Devolve {corpo, campo, ler()}. */
  C.campoDoNome = function (valor = "") {
    const campo = el("input", { class: "lnux-entrada", id: "inicio-nome", maxlength: 24, autocomplete: "nickname", value: valor, placeholder: "Como os outros vão te ver", "aria-label": "Seu nome" });
    return { campo, corpo: el("label", { class: "lnux-campo" }, el("span", {}, "Seu nome"), campo), ler: () => campo.value.trim() };
  };

  C.telaInicio = function ({ link = false } = {}) {
    return new Promise(async (resolver) => {
      let form = null, acabou = false, rodada = 0, modoCartao = "entrar";
      // já entrou na conta neste navegador (ou veio por um link e já tem o nome): direto para o jogo
      try {
        if (await C.contas.disponivel() && C.contas.sessao()) { await C.contas.carregar(); if (C.contas.eu) { resolver("jogar"); return; } }
      } catch (e) { /* sem servidor: mostra a tela */ }
      if (link && C.nomeDoJogo.valido(C.nomeDoJogo.ler()) && !((C.contas.publico || {}).exigir_conta)) { resolver("jogar"); return; }
      const cartao = el("section", { class: "inicio-cartao webc-login-cartao", "aria-label": "Entrar" });
      const idiomas = el("div", { class: "webc-login-idiomas", role: "group", "aria-label": "Idioma" });
      const desenharIdiomas = () => idiomas.replaceChildren(...Object.entries(C.IDIOMAS).map(([k, v]) =>
        el("button", { type: "button", class: C.idioma === k ? "ativo" : "", "aria-pressed": String(C.idioma === k), "data-idioma": k, onclick: () => { C.definirIdioma(k); desenharIdiomas(); desenhar(); } }, v.nome)));
      const tela = el("div", { class: "tela-inicio webc-login" },
        el("div", { class: "webc-login-fundo", "aria-hidden": "true" }),
        el("main", { class: "webc-login-centro" }, cartao, idiomas));
      const desligar = C.contas.aoMudar(() => { if (!acabou && !form && modoCartao === "entrar") desenhar(); });
      function acabar(modo) {
        if (acabou) return;
        acabou = true;
        if (form) form.parar();
        desligar();
        tela.classList.add("saindo");
        setTimeout(() => tela.remove(), 380);
        resolver(modo);
      }
      const marca = () => el("div", { class: "webc-login-marca" }, C.logoWebc(78), el("span", { class: "webc-login-nome" }, "web chat"));
      /** Jogar sem conta: o nome, no próprio cartão. */
      function desenharNome(comVoltar) {
        modoCartao = "nome";
        if (form) { form.parar(); form = null; }
        const nome = C.campoDoNome(C.nomeDoJogo.ler());
        const aviso = el("p", { class: "conta-msg erro", role: "alert", hidden: true });
        const jogar = () => {
          const n = nome.ler();
          if (!C.nomeDoJogo.valido(n)) { aviso.textContent = t("Diga o seu nome (pelo menos 2 letras)."); aviso.hidden = false; nome.campo.focus(); return; }
          C.nomeDoJogo.gravar(n);
          acabar("jogar");
        };
        nome.campo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); jogar(); } });
        cartao.replaceChildren(marca(),
          el("h3", { class: "webc-login-titulo" }, t("Jogar sem conta")),
          el("p", { class: "webc-login-texto" }, t("Todo mundo entra com um nome: é como os outros vão te ver nas salas.")),
          nome.corpo, aviso,
          el("div", { class: "conta-acoes" }, el("button", { type: "button", class: "lnux-botao primario webc-login-botao", id: "inicio-jogar", onclick: jogar }, t("Jogar"))),
          comVoltar ? el("button", { type: "button", class: "webc-login-link", id: "inicio-voltar", onclick: () => { modoCartao = "entrar"; desenhar(); } }, t("Voltar")) : null);
        if (!matchMedia("(pointer: coarse)").matches) nome.campo.focus();
      }
      async function desenhar() {
        const vez = ++rodada;
        if (modoCartao === "nome") return;
        const temContas = await C.contas.disponivel().catch(() => false), pub = C.contas.publico || {};
        if (acabou || vez !== rodada || modoCartao === "nome") return;
        if (form) { form.parar(); form = null; }
        if (!temContas) { desenharNome(false); return; } // sem contas no servidor: só o nome
        form = C.formularioConta("entrar", { aoEntrar: (conta) => { if (conta) acabar("jogar"); } });
        const podeSemConta = !pub.exigir_conta || !!(LNUX.ponte && LNUX.ponte._token);
        cartao.replaceChildren(marca(), form.corpo,
          podeSemConta ? el("button", { type: "button", class: "webc-login-link webc-sem-conta", id: "inicio-sem-conta", "data-modo": "jogar", onclick: () => desenharNome(true) }, t("Jogar sem conta"))
            : el("p", { class: "fraco pequeno inicio-nota" }, t("Este servidor pede uma conta para jogar: entre ou crie a sua.")));
        const email = form.corpo.querySelector('input[type="email"]');
        if (email && !matchMedia("(pointer: coarse)").matches) email.focus(); // no celular, o teclado não sobe sozinho
      }
      desenharIdiomas();
      document.body.append(tela);
      C.paginaPronta();
      desenhar().catch((e) => { console.error(e); desenharNome(false); });
    });
  };

  /** Trocar o nome de quem joga sem conta (no menu da conta do site). Resolve com o nome novo, ou null. */
  C.trocarNomeDoJogo = async function () {
    const nome = C.campoDoNome(C.nomeDoJogo.ler());
    const r = await LNUX.dialogo({ titulo: t("Seu nome"), corpo: el("div", { class: "ajustes" }, nome.corpo, el("p", { class: "fraco pequeno", style: { margin: 0 } }, t("Como os outros vão te ver"))),
      botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", primario: true, valor: () => nome.ler() }] });
    if (r === null || r === undefined) return null;
    if (!C.nomeDoJogo.valido(r)) { LNUX.aviso(t("Diga o seu nome (pelo menos 2 letras)."), "alerta"); return null; }
    C.nomeDoJogo.gravar(r);
    return r;
  };
})();
