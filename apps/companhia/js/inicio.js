/*
 * Companhia — a tela de início: a página inteira, com um cartão no meio para entrar na conta (e-mail e senha, esqueci a
 * senha, criar conta e o código que chega por e-mail), jogar sem conta (quando o servidor deixa) ou ir conversar com a
 * personagem (o chat bot). Quem já entrou neste navegador só continua. Resolve com o modo: "jogar" ou "conversa".
 *
 * Sem contas no servidor (ou com a página aberta sem o servidor), o cartão oferece só jogar e conversar.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;

  /** A marca: duas pessoas lado a lado (a companhia), num quadrado de cantos redondos. */
  function marca(tamanho = 40) {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("width", tamanho);
    svg.setAttribute("height", tamanho);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<defs><linearGradient id="inicio-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a5c"/><stop offset=".55" stop-color="#e2558f"/><stop offset="1" stop-color="#7a5cff"/></linearGradient></defs>'
      + '<rect width="48" height="48" rx="14" fill="url(#inicio-grad)"/>'
      + '<circle cx="18" cy="18" r="6" fill="#fff"/><path d="M7 37c0-7 5-11 11-11s11 4 11 11z" fill="#fff"/>'
      + '<circle cx="31" cy="20" r="5" fill="#fff" fill-opacity=".72"/><path d="M23.5 37c.6-6 4-9.4 7.5-9.4 4.6 0 9 3.5 9 9.4z" fill="#fff" fill-opacity=".72"/>';
    return svg;
  }
  C.marcaCompanhia = marca;

  /** Quantas salas estão abertas agora (some se o servidor não responder). */
  async function contarSalas(linha) {
    try {
      const r = await C.Sala.lista(), salas = (r && r.salas) || [];
      const pessoas = salas.reduce((s, x) => s + (x.pessoas || 0), 0);
      linha.replaceChildren(el("span", { class: "ponto" + (salas.length ? " vivo" : "") }),
        salas.length ? `${salas.length} ${salas.length === 1 ? "sala aberta" : "salas abertas"} · ${pessoas} ${pessoas === 1 ? "pessoa jogando" : "pessoas jogando"}` : "Nenhuma sala aberta agora: crie a primeira.");
      linha.hidden = false;
    } catch (e) { linha.hidden = true; }
  }

  C.telaInicio = function () {
    return new Promise((resolver) => {
      let form = null, acabou = false, rodada = 0;
      const cartao = el("section", { class: "inicio-cartao", "aria-label": "Entrar" });
      const salas = el("p", { class: "inicio-salas", role: "status", hidden: true });
      const conversar = () => el("button", { type: "button", class: "inicio-link", "data-modo": "conversa", onclick: () => acabar("conversa") }, "Conversar com a personagem");
      const tela = el("div", { class: "tela-inicio" },
        el("div", { class: "inicio-fundo", "aria-hidden": "true" }, el("div", { class: "inicio-brilho um" }), el("div", { class: "inicio-brilho dois" }), el("div", { class: "inicio-chao" })),
        el("header", { class: "inicio-topo" }, el("div", { class: "inicio-marca" }, marca(34), el("span", {}, "Companhia")),
          el("button", { type: "button", class: "inicio-link", id: "inicio-conversar", "data-modo": "conversa", onclick: () => acabar("conversa") }, "Conversar com a personagem →")),
        el("div", { class: "inicio-centro" },
          el("div", { class: "inicio-chamada" }, el("h1", {}, "Boas-vindas à Companhia"), el("p", {}, "Mundos 3D, a sua personagem e gente de verdade.")),
          cartao, salas),
        el("footer", { class: "inicio-rodape" },
          el("span", {}, "As contas, as fotos e as salas ficam no aparelho de quem tem este servidor."),
          el("span", {}, "Prefere o chat bot? ", conversar())));
      const desligar = C.contas.aoMudar(() => { if (!acabou && !form) desenhar(); });
      function acabar(modo) {
        if (acabou) return;
        acabou = true;
        if (form) form.parar();
        desligar();
        tela.classList.add("saindo");
        setTimeout(() => tela.remove(), 320);
        resolver(modo);
      }
      async function desenhar() {
        const vez = ++rodada; // a conta muda no meio (carregar avisa): vale só o último desenho
        const temContas = await C.contas.disponivel().catch(() => false), pub = C.contas.publico || {};
        if (temContas && C.contas.sessao() && !C.contas.eu) await C.contas.carregar();
        if (acabou || vez !== rodada) return;
        if (form) { form.parar(); form = null; }
        const eu = temContas ? C.contas.eu : null;
        const semConta = (rotulo, primario) => el("button", { type: "button", class: "lnux-botao inicio-largo" + (primario ? " primario" : ""), id: "inicio-sem-conta", "data-modo": "jogar", onclick: () => acabar("jogar") }, rotulo);
        if (!temContas) {
          cartao.replaceChildren(el("h3", {}, "Jogar com outras pessoas"),
            el("p", { class: "fraco", style: { margin: 0 } }, "Entre numa sala da lista (ou crie a sua), escolha um nome e uma personagem e ande pelo cenário com as outras pessoas."),
            semConta("Jogar", true));
          return;
        }
        if (eu) {
          const continuar = el("button", { type: "button", class: "lnux-botao primario inicio-largo", id: "inicio-continuar", onclick: () => acabar("jogar") }, "Continuar");
          cartao.replaceChildren(el("div", { class: "inicio-eu" }, C.fotoDaConta(eu, 72), el("h3", {}, `Que bom te ver, ${eu.nome}!`),
            el("p", { class: "fraco", style: { margin: 0 } }, "Você já está com a sua conta neste navegador.")),
          continuar,
          el("button", { type: "button", class: "lnux-botao plano conta-link", id: "inicio-outra-conta", onclick: () => C.contas.sair() }, "Entrar com outra conta")); // sair avisa, e o cartão volta ao formulário
          continuar.focus();
          return;
        }
        form = C.formularioConta("entrar", { aoEntrar: (conta) => { if (conta) acabar("jogar"); } });
        const podeSemConta = !pub.exigir_conta || !!(LNUX.ponte && LNUX.ponte._token); // quem tem o servidor joga sem conta
        cartao.replaceChildren(form.corpo, ...(podeSemConta
          ? [el("div", { class: "inicio-ou" }, el("span", {}, "ou")), semConta("Jogar sem conta", false),
            el("p", { class: "fraco pequeno inicio-nota" }, "Sem conta, você entra só com um nome. Com conta, os outros veem a sua foto e o seu perfil.")]
          : [el("p", { class: "fraco pequeno inicio-nota" }, "Este servidor pede uma conta para jogar: entre ou crie a sua.")]));
        const email = form.corpo.querySelector('input[type="email"]');
        if (email && !matchMedia("(pointer: coarse)").matches) email.focus(); // no celular, o teclado não sobe sozinho
      }
      document.body.append(tela);
      desenhar().catch((e) => { console.error(e); cartao.replaceChildren(el("p", {}, "Não consegui falar com o servidor."), el("button", { type: "button", class: "lnux-botao primario inicio-largo", "data-modo": "jogar", onclick: () => acabar("jogar") }, "Jogar")); });
      contarSalas(salas);
    });
  };
})();
