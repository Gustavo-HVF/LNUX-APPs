/*
 * WEBC — a tela de entrar: a página inteira com a arte de fundo e, no meio, o cartão preto com o logo, o e-mail, a
 * senha, "Entrar", "ou" e "Criar conta" (esqueci a senha e o código por e-mail também acontecem no próprio cartão).
 * Quem já entrou neste navegador vai direto para o início. "Jogar sem conta" aparece quando o servidor deixa. Embaixo,
 * o idioma. Resolve com o modo: "jogar" (ou "conversa", se vier pelo endereço).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);

  C.telaInicio = function () {
    return new Promise(async (resolver) => {
      let form = null, acabou = false, rodada = 0;
      // já entrou neste navegador: direto para o início
      try {
        if (await C.contas.disponivel() && C.contas.sessao()) { await C.contas.carregar(); if (C.contas.eu) { resolver("jogar"); return; } }
      } catch (e) { /* sem servidor: mostra a tela */ }
      const cartao = el("section", { class: "inicio-cartao webc-login-cartao", "aria-label": "Entrar" });
      const idiomas = el("div", { class: "webc-login-idiomas", role: "group", "aria-label": "Idioma" });
      const desenharIdiomas = () => idiomas.replaceChildren(...Object.entries(C.IDIOMAS).map(([k, v]) =>
        el("button", { type: "button", class: C.idioma === k ? "ativo" : "", "aria-pressed": String(C.idioma === k), "data-idioma": k, onclick: () => { C.definirIdioma(k); desenharIdiomas(); desenhar(); } }, v.nome)));
      const tela = el("div", { class: "tela-inicio webc-login" },
        el("div", { class: "webc-login-fundo", "aria-hidden": "true" }),
        el("main", { class: "webc-login-centro" }, cartao, idiomas));
      const desligar = C.contas.aoMudar(() => { if (!acabou && !form) desenhar(); });
      function acabar(modo) {
        if (acabou) return;
        acabou = true;
        if (form) form.parar();
        desligar();
        tela.classList.add("saindo");
        setTimeout(() => tela.remove(), 380);
        resolver(modo);
      }
      async function desenhar() {
        const vez = ++rodada;
        const temContas = await C.contas.disponivel().catch(() => false), pub = C.contas.publico || {};
        if (acabou || vez !== rodada) return;
        if (form) { form.parar(); form = null; }
        const marca = el("div", { class: "webc-login-marca" }, C.logoWebc(78), el("span", { class: "webc-login-nome" }, "web chat"));
        const semConta = (rotulo, classe) => el("button", { type: "button", class: classe, id: "inicio-sem-conta", "data-modo": "jogar", onclick: () => acabar("jogar") }, rotulo);
        if (!temContas) {
          cartao.replaceChildren(marca, el("p", { class: "webc-login-texto" }, t("Entre numa sala, escolha uma personagem e ande pelos mapas com outras pessoas.")),
            semConta(t("Jogar"), "lnux-botao primario webc-login-botao"));
          return;
        }
        form = C.formularioConta("entrar", { aoEntrar: (conta) => { if (conta) acabar("jogar"); } });
        const podeSemConta = !pub.exigir_conta || !!(LNUX.ponte && LNUX.ponte._token);
        cartao.replaceChildren(marca, form.corpo,
          podeSemConta ? semConta(t("Jogar sem conta"), "webc-login-link webc-sem-conta") : el("p", { class: "fraco pequeno inicio-nota" }, t("Este servidor pede uma conta para jogar: entre ou crie a sua.")));
        const email = form.corpo.querySelector('input[type="email"]');
        if (email && !matchMedia("(pointer: coarse)").matches) email.focus(); // no celular, o teclado não sobe sozinho
      }
      desenharIdiomas();
      document.body.append(tela);
      desenhar().catch((e) => { console.error(e); cartao.replaceChildren(el("p", {}, t("O servidor não respondeu.")), el("button", { type: "button", class: "lnux-botao primario webc-login-botao", "data-modo": "jogar", onclick: () => acabar("jogar") }, t("Jogar"))); });
    });
  };
})();
