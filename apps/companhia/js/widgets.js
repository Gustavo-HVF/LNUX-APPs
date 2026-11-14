/*
 * WEBC — os widgets do início: a pessoa escolhe quais quer (o relógio, as salas abertas, os novos na loja, os amigos,
 * os salvos e um bloco de notas), e eles ficam embaixo dos cartões, na ordem em que foram postos. Ficam guardados neste
 * navegador. ✕ tira; as setas mudam a ordem.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);
  const CHAVE = "webc.widgets", CHAVE_NOTAS = "webc.notas";

  const ler = () => { try { const l = JSON.parse(localStorage.getItem(CHAVE) || "[]"); return Array.isArray(l) ? l.filter((id) => TIPOS[id]) : []; } catch (e) { return []; } };
  const gravar = (l) => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (e) { /* sem armazenamento */ } };
  const vazio = (texto) => el("p", { class: "fraco pequeno webc-widget-vazio" }, texto);
  const D = (corpo) => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;
  const DESENHOS = {
    relogio: D('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    salas: D('<path d="M4 21h16M7 21V4h8v17"/><circle cx="12.6" cy="13" r=".9" fill="currentColor"/><path d="M15 6h4v15"/>'),
    loja: D('<path d="M5 8h14l-1.2 12H6.2Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
    amigos: D('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.6 2.8-5.4 5.5-5.4s4.9 1.8 5.5 5.4"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.4c2.6-.4 4.6 1.2 5 4.6"/>'),
    salvos: D('<path d="M7 3.5h10v17l-5-3.6-5 3.6Z"/>'),
    notas: D('<path d="M6 3.5h9l3.5 3.5v13.5H6Z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>'),
  };
  const ICONE = new Proxy({}, { get: (_, id) => { const s = el("span", { class: "webc-widget-desenho" }); s.innerHTML = DESENHOS[id] || ""; return s; } });

  /** Cada widget: o nome, a explicação e como se desenha (devolve uma função para parar, se precisar). */
  const TIPOS = {
    relogio: {
      nome: "Relógio", sub: "A hora e o dia",
      desenhar(corpo) {
        const hora = el("div", { class: "webc-relogio-hora" }), dia = el("div", { class: "webc-relogio-dia fraco" });
        const tic = () => {
          const agora = new Date(), lang = (C.IDIOMAS[C.idioma] || {}).lang || "pt-BR";
          hora.textContent = agora.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
          dia.textContent = agora.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
        };
        tic();
        corpo.replaceChildren(hora, dia);
        const id = setInterval(tic, 10000);
        return () => clearInterval(id);
      },
    },
    salas: {
      nome: "Salas abertas", sub: "As salas com mais gente agora",
      async desenhar(corpo, { ir }) {
        const r = await C.Sala.lista();
        const l = (r.salas || []).slice().sort((a, b) => b.pessoas - a.pessoas || b.criada - a.criada).slice(0, 4);
        corpo.replaceChildren(el("p", { class: "fraco pequeno", style: { margin: 0 } }, t("{n} de {max} salas abertas", { n: r.abertas !== undefined ? r.abertas : (r.salas || []).length, max: r.maximo || "?" })),
          ...(l.length ? l.map((s) => el("button", { type: "button", class: "webc-widget-linha", "data-codigo": s.codigo, onclick: () => ir("sala", { codigo: s.codigo }) },
            el("span", { translate: "no" }, s.nome), el("span", { class: "fraco" }, `👥 ${s.pessoas}/${s.max}`))) : [vazio(t("Nenhuma sala pública aberta agora."))]));
      },
    },
    loja: {
      nome: "Novos na loja", sub: "O que acabou de chegar",
      async desenhar(corpo, { ir }) {
        const itens = (await C.loja.lista()).itens.slice().sort((a, b) => b.criado - a.criado).slice(0, 4);
        corpo.replaceChildren(itens.length ? el("div", { class: "webc-widget-miniaturas" }, itens.map((i) => el("button", { type: "button", class: "webc-widget-miniatura", title: i.nome, onclick: () => ir("loja", { tipo: i.tipo, item: i.id }) },
          i.miniatura ? el("img", { src: C.loja.miniatura(i), alt: "", loading: "lazy" }) : el("span", { class: "sem-miniatura", "aria-hidden": "true" }, ICONE.loja), el("span", { class: "nome", translate: "no" }, i.nome)))) : vazio(t("Nada na loja ainda.")));
      },
    },
    amigos: {
      nome: "Amigos", sub: "Os seus amigos",
      async desenhar(corpo, { ir }) {
        if (!(C.contas && C.contas.eu)) { corpo.replaceChildren(vazio(t("Entre na sua conta para ver os amigos."))); return; }
        const eu = await C.contas.carregar();
        const l = (eu && eu.amigos) || [];
        corpo.replaceChildren(l.length ? el("div", { class: "webc-widget-amigos" }, l.slice(0, 8).map((a) => el("button", { type: "button", class: "webc-widget-amigo", title: a.nome, onclick: () => ir("perfil", { id: a.id }) },
          C.fotoDaConta(a, 44), el("span", { translate: "no" }, a.nome)))) : vazio(t("Nenhum amigo ainda.")));
      },
    },
    salvos: {
      nome: "Meus salvos", sub: "O que você salvou na loja",
      async desenhar(corpo, { ir }) {
        if (!(C.contas && C.contas.eu)) { corpo.replaceChildren(vazio(t("Entre na sua conta para salvar itens da loja."))); return; }
        const ids = new Set(C.contas.eu.salvos || []);
        const itens = (await C.loja.lista()).itens.filter((i) => ids.has(i.id)).slice(0, 6);
        corpo.replaceChildren(itens.length ? el("div", { class: "webc-widget-miniaturas" }, itens.map((i) => el("button", { type: "button", class: "webc-widget-miniatura", title: i.nome, onclick: () => ir("loja", { tipo: i.tipo, item: i.id }) },
          i.miniatura ? el("img", { src: C.loja.miniatura(i), alt: "", loading: "lazy" }) : el("span", { class: "sem-miniatura", "aria-hidden": "true" }, ICONE.salvos), el("span", { class: "nome", translate: "no" }, i.nome)))) : vazio(t("Nada salvo ainda.")));
      },
    },
    notas: {
      nome: "Bloco de notas", sub: "Anotações neste navegador",
      desenhar(corpo) {
        let texto = "";
        try { texto = localStorage.getItem(CHAVE_NOTAS) || ""; } catch (e) { /* sem armazenamento */ }
        const area = el("textarea", { class: "lnux-area webc-notas", rows: 4, maxlength: 2000, placeholder: "Escreva aqui...", "aria-label": "Bloco de notas" });
        area.value = texto;
        area.addEventListener("input", LNUX.adiar(() => { try { localStorage.setItem(CHAVE_NOTAS, area.value); } catch (e) { /* sem armazenamento */ } }, 300));
        corpo.replaceChildren(area);
      },
    },
  };

  C.widgets = {
    TIPOS,
    ler,
    adicionar(id) { const l = ler(); if (TIPOS[id] && !l.includes(id)) { l.push(id); gravar(l); } },
    tirar(id) { gravar(ler().filter((x) => x !== id)); },
    /** Desenha os widgets da pessoa dentro de area. Devolve {desenhar, parar}. */
    montar(area, ctx) {
      let paradas = [];
      const parar = () => { for (const f of paradas) { try { f(); } catch (e) { /* já parou */ } } paradas = []; };
      function desenhar() {
        parar();
        const lista = ler();
        const cartoes = lista.map((id, n) => {
          const tipo = TIPOS[id], corpo = el("div", { class: "webc-widget-corpo" }, el("p", { class: "fraco pequeno" }, t("Carregando...")));
          const mover = (d) => { const l = ler(); const i = l.indexOf(id), j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; gravar(l); desenhar(); };
          const cartao = el("article", { class: "webc-widget", "data-widget": id },
            el("header", { class: "webc-widget-topo" },
              el("span", { class: "webc-widget-icone", "aria-hidden": "true" }, ICONE[id]), el("h3", {}, tipo.nome),
              lista.length > 1 ? el("button", { type: "button", class: "webc-widget-botao", title: "Para a esquerda", "aria-label": "Para a esquerda", disabled: n === 0, onclick: () => mover(-1) }, "‹") : null,
              lista.length > 1 ? el("button", { type: "button", class: "webc-widget-botao", title: "Para a direita", "aria-label": "Para a direita", disabled: n === lista.length - 1, onclick: () => mover(1) }, "›") : null,
              el("button", { type: "button", class: "webc-widget-botao webc-widget-tirar", title: "Tirar do início", "aria-label": "Tirar do início", onclick: () => { C.widgets.tirar(id); desenhar(); } }, C.iconeWebc("fechar"))),
            corpo);
          Promise.resolve().then(() => tipo.desenhar(corpo, ctx)).then((f) => { if (typeof f === "function") paradas.push(f); })
            .catch((e) => { console.warn("widget", id, e); corpo.replaceChildren(vazio(t("O servidor não respondeu."))); });
          return cartao;
        });
        area.replaceChildren(...cartoes,
          el("button", { type: "button", class: "webc-widget-mais", id: "widget-adicionar", onclick: () => ctx.escolher() }, C.iconeWebc("mais"), el("span", {}, lista.length ? t("Adicionar widget") : t("Adicionar um widget ao seu início"))));
      }
      desenhar();
      return { desenhar, parar };
    },
    /** A janela de escolher: cada widget com Adicionar ou Tirar. */
    escolher() {
      const grade = el("div", { class: "webc-widgets-escolher" });
      const desenhar = () => {
        const tem = new Set(ler());
        grade.replaceChildren(...Object.entries(TIPOS).map(([id, w]) => el("div", { class: "webc-widget-opcao" + (tem.has(id) ? " posto" : ""), "data-widget": id },
          el("span", { class: "webc-widget-icone grande", "aria-hidden": "true" }, ICONE[id]),
          el("span", { class: "webc-widget-opcao-texto" }, el("b", {}, w.nome), el("span", { class: "fraco pequeno" }, w.sub)),
          el("button", { type: "button", class: "lnux-botao pequeno" + (tem.has(id) ? "" : " primario"), onclick: () => { if (tem.has(id)) C.widgets.tirar(id); else C.widgets.adicionar(id); desenhar(); } }, tem.has(id) ? t("Tirar") : t("Adicionar")))));
      };
      desenhar();
      return LNUX.dialogo({ titulo: t("Widgets"), largo: true, corpo: el("div", { class: "ajustes" }, el("p", { class: "fraco", style: { margin: 0 } }, t("Escolha o que fica no seu início. Os widgets ficam guardados neste navegador.")), grade),
        botoes: [{ rotulo: "Pronto", primario: true, valor: true }] });
    },
  };
})();
