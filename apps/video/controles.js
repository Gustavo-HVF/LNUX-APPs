/*
 * Vídeo — painéis do clipe escolhido:
 *  · Controles de efeito: Movimento, Opacidade, Recorte, Tempo, Volume e os efeitos do clipe, com o relógio
 *    (liga a animação), ◀ ◆ ▶ (quadros-chave), valores que mudam arrastando, a faixa de quadros-chave à direita e
 *    o gráfico de valor e velocidade de cada propriedade;
 *  · Propriedades: transformar, recortar, velocidade, texto, forma e áudio, com controles simples;
 *  · Cor (Lumetri): correção básica (com Auto), criativo, curvas RGB, rodas de cor, HSL secundária e vinheta;
 *  · Escopos: forma de onda, parade RGB, vetorscópio e histograma do quadro do monitor.
 */
(function () {
  "use strict";
  const { el, $, limitar, icone } = LNUX;
  const K = (V.Controles = {});
  let A = null;
  let caixaCE, caixaProps, caixaCor, caixaEscopos;
  let assinaturaCE = "", assinaturaProps = "", assinaturaCor = "";
  const fechadas = new Set(); // seções recolhidas nos Controles de efeito
  const abertasCor = new Set(["Correção básica"]); // seções abertas no painel Cor
  let expandida = null; // "id do clipe|caminho" com o gráfico aberto
  let vivos = []; // {atualizar()} dos Controles de efeito (sem reconstruir)
  let vivosProps = [];
  let vivosCor = [];
  let faixa = null; // a faixa de quadros-chave (canvas) dos Controles de efeito
  let linhasCE = []; // linhas animáveis: {c, caminhos, elemento, grafico}
  let chaveEscolhida = null; // {clipe, caminhos, t}

  const RELOGIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.5 6.5l1.5-1.5"/></svg>';
  const fmtNum = (v, casas) => (v === undefined || v === null || !isFinite(v) ? "—" : (+v).toFixed(casas).replace(".", ","));
  const casasDoPasso = (passo) => (passo >= 1 ? 0 : passo >= 0.1 ? 1 : 2);
  const lerNumero = (s) => { const v = parseFloat(String(s).replace(",", ".").replace(/[^\d.+-]/g, "")); return isFinite(v) ? v : null; };
  const animado = (c, k) => !!(c.anim && c.anim[k] && c.anim[k].length);
  const tl = (c) => A.cursor - c.inicio;
  const ehVideo = (c) => A.trilha(c.trilha) && A.trilha(c.trilha).tipo === "video";

  /** O clipe dos painéis: o primeiro escolhido (de preferência o de vídeo). */
  function clipeAtual() {
    const lista = A.escolhidos();
    return lista.find(ehVideo) || lista[0] || null;
  }

  // ── Valor que muda arrastando (como no Premiere) ────────────────────

  /**
   * Número azul: arrastar para os lados muda (Shift ×10, Ctrl ÷10), clique para digitar, ↑/↓ no teclado.
   * opcoes: {obter, definir(v), passo, min, max, unidade, casas, descricao}
   */
  function valorQuente(o) {
    const passo = o.passo || 1, casas = o.casas ?? casasDoPasso(passo);
    const span = el("span", { class: "valor-quente", tabindex: 0, role: "spinbutton", title: "Arraste para os lados ou clique para digitar" });
    const mostrar = () => { if (!span.querySelector("input")) { const v = o.obter(); span.textContent = fmtNum(v, casas) + (v === undefined || v === null ? "" : o.unidade || ""); span.setAttribute("aria-valuenow", String(v)); } };
    const aplicar = (v, marcar) => {
      if (v === null || !isFinite(v)) return;
      if (marcar) A.marcar(o.descricao || "Mudar valor");
      o.definir(limitar(Math.round(v / passo) * passo, o.min ?? -Infinity, o.max ?? Infinity));
      mostrar();
      A.mudou({ leve: true });
    };
    let arr = null;
    span.addEventListener("pointerdown", (e) => {
      if (span.querySelector("input") || e.button !== 0) return;
      e.preventDefault();
      span.setPointerCapture(e.pointerId);
      arr = { x: e.clientX, v: o.obter() ?? 0, moveu: false };
    });
    span.addEventListener("pointermove", (e) => {
      if (!arr) return;
      const dx = e.clientX - arr.x;
      if (!arr.moveu) { if (Math.abs(dx) < 2) return; arr.moveu = true; A.marcar(o.descricao || "Mudar valor"); }
      const f = e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1;
      aplicar(arr.v + dx * passo * f, false);
    });
    span.addEventListener("pointerup", () => { if (arr && !arr.moveu) editar(); arr = null; });
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); editar(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); aplicar((o.obter() ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * passo * (e.shiftKey ? 10 : 1), true); }
    });
    function editar() {
      const entrada = el("input", { value: fmtNum(o.obter(), casas), "aria-label": o.descricao || "valor" });
      span.replaceChildren(entrada);
      entrada.focus(); entrada.select();
      let feito = false;
      const fim = (salvar) => { if (feito) return; feito = true; const v = lerNumero(entrada.value); entrada.remove(); if (salvar && v !== null) aplicar(v, true); mostrar(); };
      entrada.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") fim(true); if (e.key === "Escape") fim(false); });
      entrada.addEventListener("blur", () => fim(true));
    }
    mostrar();
    span.atualizar = mostrar;
    return span;
  }

  // ── Quadros-chave de uma linha (vários caminhos andam juntos, ex.: Posição X e Y) ──

  function temposDasChaves(c, caminhos) {
    const s = new Set();
    for (const k of caminhos) for (const q of (c.anim && c.anim[k]) || []) s.add(+q.t.toFixed(5));
    return [...s].sort((a, b) => a - b);
  }
  function alternarAnimacao(c, caminhos) {
    A.marcar("Animação");
    const ligado = caminhos.some((k) => animado(c, k));
    c.anim = c.anim || {};
    const t = A.arredondar(limitar(tl(c), 0, c.duracao));
    for (const k of caminhos) {
      if (ligado) { if (animado(c, k)) { V.definirFixo(c, k, V.valor(c, k, tl(c))); delete c.anim[k]; } }
      else c.anim[k] = [{ t, v: V.valor(c, k, t) ?? valorPadraoDe(c, k), i: "linear" }];
    }
    A.mudou();
  }
  function alternarChave(c, caminhos) {
    A.marcar("Quadro-chave");
    c.anim = c.anim || {};
    const t = A.arredondar(limitar(tl(c), 0, c.duracao));
    const existe = caminhos.some((k) => (c.anim[k] || []).some((q) => Math.abs(q.t - t) < A.quadro() / 2));
    for (const k of caminhos) {
      const ch = c.anim[k] || (c.anim[k] = []);
      if (existe) { const i = ch.findIndex((q) => Math.abs(q.t - t) < A.quadro() / 2); if (i >= 0) ch.splice(i, 1); }
      else ch.push({ t, v: V.valor(c, k, t) ?? valorPadraoDe(c, k), i: "linear" });
      V.ajeitarChaves(ch);
      if (!ch.length) delete c.anim[k];
    }
    A.mudou();
  }
  function irParaChave(c, caminhos, sentido) {
    const ts = temposDasChaves(c, caminhos).map((t) => t + c.inicio);
    const t = sentido > 0 ? ts.find((x) => x > A.cursor + 1e-4) : ts.reverse().find((x) => x < A.cursor - 1e-4);
    if (t !== undefined) A.irPara(t);
  }
  /** Ponto de ancoragem vazio = centro da camada. */
  function valorPadraoDe(c, k) {
    if (k === "mov.ancoraX" || k === "mov.ancoraY") { const tam = A.tamanhoCamada(c) || { w: A.projeto.largura, h: A.projeto.altura }; return k.endsWith("X") ? tam.w / 2 : tam.h / 2; }
    return 0;
  }
  const valorDe = (c, k) => { const v = V.valor(c, k, tl(c)); return v === null || v === undefined ? valorPadraoDe(c, k) : v; };

  // ── Seções dos Controles de efeito ──────────────────────────────────

  function secoesDoClipe(c) {
    const p = A.projeto, s = [];
    const num = (rotulo, caminhos, extra = {}) => ({ tipo: "num", rotulo, caminhos, c, ...extra });
    const prop = (k) => V.PROPRIEDADES[k];
    if (ehVideo(c)) {
      s.push({ id: c.id + ":mov", titulo: "Movimento", c, reset: () => {
        const m = c.tipo === "midia" && A.midia(c.midia);
        Object.assign(c.mov, { posX: p.largura / 2, posY: p.altura / 2, escala: m ? A.escalaAjustada(m) : 100, escalaLargura: 100, uniforme: true, rotacao: 0, ancoraX: null, ancoraY: null });
        for (const k of Object.keys(c.anim)) if (k.startsWith("mov.")) delete c.anim[k];
      }, linhas: [
        num("Posição", ["mov.posX", "mov.posY"], { passo: 1, casas: 1 }),
        num(c.mov.uniforme === false ? "Altura da escala" : "Escala", ["mov.escala"], { passo: 0.1, min: 0, unidade: "%" }),
        num("Largura da escala", ["mov.escalaLargura"], { passo: 0.1, min: 0, unidade: "%", desligado: c.mov.uniforme !== false }),
        { tipo: "sim", rotulo: "Escala uniforme", obter: () => c.mov.uniforme !== false, definir: (v) => { c.mov.uniforme = v; } },
        num("Rotação", ["mov.rotacao"], { passo: 0.1, unidade: "°" }),
        num("Ponto de ancoragem", ["mov.ancoraX", "mov.ancoraY"], { passo: 1, casas: 1 }),
      ] });
      s.push({ id: c.id + ":opac", titulo: "Opacidade", c, reset: () => { c.opac = { valor: 100, mistura: "normal" }; delete c.anim["opac.valor"]; }, linhas: [
        num("Opacidade", ["opac.valor"], { passo: 0.1, min: 0, max: 100, unidade: "%" }),
        { tipo: "escolha", rotulo: "Modo de mistura", opcoes: V.MISTURAS, obter: () => c.opac.mistura || "normal", definir: (v) => { c.opac.mistura = v; } },
      ] });
      s.push({ id: c.id + ":rec", titulo: "Recorte", c, reset: () => { c.rec = { esquerda: 0, topo: 0, direita: 0, baixo: 0, suavizar: 0 }; for (const k of Object.keys(c.anim)) if (k.startsWith("rec.")) delete c.anim[k]; },
        linhas: ["esquerda", "topo", "direita", "baixo", "suavizar"].map((k) => num(prop("rec." + k).nome, ["rec." + k], { passo: prop("rec." + k).passo, min: 0, max: prop("rec." + k).max, unidade: prop("rec." + k).unidade })) });
    } else {
      s.push({ id: c.id + ":vol", titulo: "Volume", c, reset: () => { c.audio.nivel = 0; delete c.anim["audio.nivel"]; c.mudo = false; }, linhas: [
        num("Nível", ["audio.nivel"], { passo: 0.1, min: -96, max: 15, unidade: " dB" }),
        { tipo: "sim", rotulo: "Ignorar (mudo)", obter: () => !!c.mudo, definir: (v) => { c.mudo = v; } },
      ] });
      s.push({ id: c.id + ":pan", titulo: "Panorama", c, reset: () => { c.audio.pan = 0; delete c.anim["audio.pan"]; }, linhas: [num("Panorama (− esquerda, + direita)", ["audio.pan"], { passo: 1, min: -100, max: 100 })] });
    }
    if (c.tipo === "midia") {
      s.push({ id: c.id + ":tempo", titulo: "Tempo", c, linhas: [
        { tipo: "num", rotulo: "Velocidade", c, fixo: true, passo: 1, min: 5, max: 2000, unidade: "%", obter: () => Math.round((c.velocidade || 1) * 100),
          definir: (v) => { for (const x of [c, ...(A.vinculada ? V.parceiros(p, c) : [])]) V.mudarVelocidade(p, x, v / 100, false); } },
      ] });
    }
    for (const fx of c.efeitos.filter((f) => !!f.audio === !ehVideo(c))) s.push(secaoDoEfeito(c, fx));
    return s;
  }

  function secaoDoEfeito(c, fx) {
    const def = V.definicaoEfeito(fx.id);
    const linhas = [];
    for (const prm of def ? def.params : []) {
      if (prm.grupo) { linhas.push({ tipo: "grupo", rotulo: prm.grupo }); continue; }
      const k = `fx.${fx.uid}.${prm.id}`;
      if (prm.tipo === "n") linhas.push({ tipo: "num", rotulo: prm.nome, caminhos: [k], c, passo: prm.passo, min: prm.min, max: prm.max, unidade: prm.unidade });
      else if (prm.tipo === "cor") linhas.push({ tipo: "cor", rotulo: prm.nome, obter: () => fx.params[prm.id], definir: (v) => { fx.params[prm.id] = v; } });
      else if (prm.tipo === "escolha") linhas.push({ tipo: "escolha", rotulo: prm.nome, opcoes: prm.opcoes, numerico: true, obter: () => fx.params[prm.id], definir: (v) => { fx.params[prm.id] = v; } });
      else if (prm.tipo === "sim") linhas.push({ tipo: "sim", rotulo: prm.nome, obter: () => !!fx.params[prm.id], definir: (v) => { fx.params[prm.id] = v; } });
    }
    if (def && def.curvas) linhas.push({ tipo: "nota", rotulo: "Curvas e rodas de cor: painel Cor (à direita)." });
    const i = () => c.efeitos.indexOf(fx);
    return {
      id: fx.uid, titulo: def ? def.nome : fx.id, c, fx,
      reset: () => { for (const prm of def.params) if (!prm.grupo) fx.params[prm.id] = prm.padrao; if (def.curvas) fx.curvas = V.curvasPadrao(); for (const k of Object.keys(c.anim)) if (k.startsWith(`fx.${fx.uid}.`)) delete c.anim[k]; },
      acoes: [
        ["↑", "Subir (os efeitos são aplicados de cima para baixo)", () => { const j = i(); if (j > 0) { A.marcar("Ordem dos efeitos"); c.efeitos.splice(j - 1, 0, c.efeitos.splice(j, 1)[0]); A.mudou(); } }],
        ["↓", "Descer", () => { const j = i(); if (j < c.efeitos.length - 1) { A.marcar("Ordem dos efeitos"); c.efeitos.splice(j + 1, 0, c.efeitos.splice(j, 1)[0]); A.mudou(); } }],
        ["×", "Tirar o efeito", () => { A.marcar("Tirar efeito"); c.efeitos.splice(i(), 1); for (const k of Object.keys(c.anim)) if (k.startsWith(`fx.${fx.uid}.`)) delete c.anim[k]; A.mudou(); }],
      ],
      linhas,
    };
  }

  function linhaNumerica(l) {
    const c = l.c;
    const linha = el("div", { class: "ce-linha" + (l.desligado ? " fraco" : "") });
    if (l.fixo) {
      const v = valorQuente({ obter: l.obter, definir: l.definir, passo: l.passo, min: l.min, max: l.max, unidade: l.unidade, descricao: l.rotulo });
      vivos.push(v);
      linha.append(el("span"), el("label", {}, l.rotulo), el("span", {}, v), el("span"));
      return [linha];
    }
    const chaveExp = c.id + "|" + l.caminhos[0];
    const relogio = el("button", { type: "button", class: "relogio", title: "Ligar/desligar a animação (cria um quadro-chave no cursor)", "aria-label": "Animar " + l.rotulo, html: RELOGIO, onclick: () => alternarAnimacao(c, l.caminhos) });
    const valores = el("span", { style: { display: "inline-flex", gap: "8px" } });
    for (const k of l.caminhos) {
      const v = valorQuente({ obter: () => valorDe(c, k), definir: (x) => A.definirValor(c, k, x), passo: l.passo, min: l.min, max: l.max, unidade: l.unidade, casas: l.casas, descricao: l.rotulo });
      vivos.push(v);
      valores.append(v);
    }
    const anterior = el("button", { type: "button", title: "Quadro-chave anterior", onclick: () => irParaChave(c, l.caminhos, -1) }, "◀");
    const diamante = el("button", { type: "button", title: "Pôr/tirar um quadro-chave no cursor", onclick: () => alternarChave(c, l.caminhos) }, "◆");
    const proximo = el("button", { type: "button", title: "Próximo quadro-chave", onclick: () => irParaChave(c, l.caminhos, 1) }, "▶");
    const nav = el("span", { class: "nav" }, anterior, diamante, proximo);
    const rotulo = el("label", { title: "Clique para ver o gráfico de valor e velocidade", style: { cursor: "pointer" }, onclick: () => { expandida = expandida === chaveExp ? null : chaveExp; assinaturaCE = ""; K.desenhar(); } }, (expandida === chaveExp ? "▾ " : "▸ ") + l.rotulo);
    linha.append(relogio, rotulo, valores, nav);
    const atualizar = () => {
      const ligado = l.caminhos.some((k) => animado(c, k));
      relogio.classList.toggle("ligado", ligado);
      nav.style.visibility = ligado ? "visible" : "hidden";
      const t = tl(c);
      diamante.classList.toggle("na-chave", temposDasChaves(c, l.caminhos).some((x) => Math.abs(x - t) < A.quadro() / 2));
    };
    atualizar();
    vivos.push({ atualizar });
    const info = { c, caminhos: l.caminhos, elemento: linha, grafico: null, rotulo: l.rotulo, unidade: l.unidade || "" };
    linhasCE.push(info);
    if (expandida === chaveExp) {
      info.grafico = el("div", { class: "ce-grafico", style: { position: "relative", fontSize: "11px", color: "var(--texto-3)", padding: "2px 8px 2px 30px" } });
      info.graficoRotulos = info.grafico;
    }
    return info.grafico ? [linha, info.grafico] : [linha];
  }

  function linhaWidget(l) {
    const linha = el("div", { class: "ce-linha" });
    let campo;
    if (l.tipo === "escolha") {
      campo = el("select", { class: "lnux-selecao pequena" }, ...l.opcoes.map(([v, n]) => el("option", { value: v }, n)));
      campo.value = l.obter();
      campo.addEventListener("change", () => { A.marcar(l.rotulo); l.definir(l.numerico ? +campo.value : campo.value); A.mudou(); });
      vivos.push({ atualizar: () => { if (document.activeElement !== campo) campo.value = l.obter(); } });
    } else if (l.tipo === "cor") {
      campo = el("input", { type: "color", value: l.obter() });
      let marcou = false;
      campo.addEventListener("input", () => { if (!marcou) { A.marcar(l.rotulo); marcou = true; } l.definir(campo.value); A.mudou({ leve: true }); });
      campo.addEventListener("change", () => { marcou = false; });
    } else {
      campo = el("input", { type: "checkbox", checked: !!l.obter() });
      campo.addEventListener("change", () => { A.marcar(l.rotulo); l.definir(campo.checked); A.mudou(); });
    }
    linha.append(el("span"), el("label", {}, l.rotulo), el("span", {}, campo), el("span"));
    return [linha];
  }

  function desenharCE() {
    vivos = []; linhasCE = [];
    const c = clipeAtual();
    const tr = A.transicaoEscolhida && A.projeto.transicoes.find((x) => x.id === A.transicaoEscolhida);
    if (tr) { desenharTransicao(tr); return; }
    if (!c) {
      caixaCE.replaceChildren(el("div", { class: "lnux-vazio", style: { padding: "18px", textAlign: "center" } },
        el("p", { class: "fraco" }, "Escolha um clipe na linha do tempo para ver, mudar e animar o movimento, a opacidade e os efeitos dele."),
        el("p", { class: "fraco" }, "Para pôr um efeito, arraste do painel Efeitos para o clipe.")));
      faixa = null;
      return;
    }
    const clipes = [c, ...(A.vinculada ? V.parceiros(A.projeto, c).filter((x) => !ehVideo(x) && ehVideo(c)) : [])];
    const props = el("div", { class: "props", style: { position: "relative" } });
    const nomeSeq = A.projeto.nome;
    props.append(el("div", { class: "ce-linha", style: { height: "22px", minHeight: "22px", borderBottom: "1px solid var(--borda)" } }, el("span"), el("b", { style: { gridColumn: "2 / -1", fontSize: ".85em", color: "var(--texto-3)" } }, ehVideo(c) ? "Efeitos de vídeo" : "Efeitos de áudio")));
    clipes.forEach((x, i) => {
      if (i > 0) props.append(el("div", { class: "ce-grupo", style: { paddingLeft: "8px" } }, "Efeitos de áudio (" + (x.nome || A.midia(x.midia)?.nome || "áudio") + ")"));
      for (const s of secoesDoClipe(x)) props.append(desenharSecao(s));
    });
    props.addEventListener("scroll", () => desenharFaixa());
    const trilhaCE = el("div", { class: "trilha-ce" });
    faixa = el("canvas", { tabindex: 0, "aria-label": "Quadros-chave do clipe" });
    trilhaCE.append(faixa);
    const cab = el("div", { class: "cabeca-ce" }, el("span", { title: "Sequência" }, nomeSeq), el("span", { title: "Clipe" }, "▸ " + (c.nome || (A.midia(c.midia) || {}).nome || c.tipo)));
    caixaCE.replaceChildren(el("div", { class: "controles" }, cab, props, trilhaCE));
    faixa._props = props;
    iniciarFaixa(faixa, c);
    new ResizeObserver(() => desenharFaixa()).observe(trilhaCE);
    desenharFaixa();
  }

  function desenharSecao(s) {
    const fechada = fechadas.has(s.id);
    const titulo = el("div", { class: "titulo", onclick: () => { fechada ? fechadas.delete(s.id) : fechadas.add(s.id); assinaturaCE = ""; K.desenhar(); } },
      el("span", { class: "seta" }, "▾"));
    if (s.fx) {
      titulo.append(el("button", { type: "button", class: "fx", "aria-pressed": String(s.fx.ativo !== false), title: "Ligar/desligar o efeito (comparar)",
        onclick: (e) => { e.stopPropagation(); A.marcar("Ligar/desligar efeito"); s.fx.ativo = s.fx.ativo === false; A.mudou(); } }, "fx"));
    } else titulo.append(el("span", { class: "fx", style: { borderColor: "transparent" } }, "fx"));
    titulo.append(el("span", {}, s.titulo), el("span", { class: "espaco" }));
    for (const [rotulo, dica, acao] of s.acoes || []) titulo.append(el("button", { type: "button", class: "lnux-botao pequeno plano", title: dica, "aria-label": dica, onclick: (e) => { e.stopPropagation(); acao(); } }, rotulo));
    if (s.reset) titulo.append(el("button", { type: "button", class: "lnux-botao pequeno plano", title: "Voltar ao padrão", "aria-label": "Voltar ao padrão", onclick: (e) => { e.stopPropagation(); A.marcar("Voltar ao padrão"); s.reset(); A.mudou(); } }, "↺"));
    const linhas = el("div", { class: "linhas" });
    if (!fechada) {
      for (const l of s.linhas) {
        if (l.tipo === "grupo") linhas.append(el("div", { class: "ce-grupo" }, l.rotulo));
        else if (l.tipo === "nota") linhas.append(el("div", { class: "ce-grupo", style: { textTransform: "none", letterSpacing: 0 } }, l.rotulo));
        else if (l.tipo === "num") linhas.append(...linhaNumerica(l));
        else linhas.append(...linhaWidget(l));
      }
    }
    return el("div", { class: "ce-secao" + (fechada ? " fechada" : "") }, titulo, linhas);
  }

  function desenharTransicao(tr) {
    const def = V.TRANSICOES.find((x) => x.id === tr.tipo) || V.TRANSICOES_AUDIO.find((x) => x.id === tr.tipo);
    const audio = !!V.TRANSICOES_AUDIO.find((x) => x.id === tr.tipo);
    const lista = audio ? V.TRANSICOES_AUDIO : V.TRANSICOES;
    const tipo = el("select", { class: "lnux-selecao pequena" }, ...lista.map((x) => el("option", { value: x.id, selected: x.id === tr.tipo }, x.nome)));
    tipo.addEventListener("change", () => { A.marcar("Tipo da transição"); tr.tipo = tipo.value; A.mudou(); });
    const dur = valorQuente({ obter: () => tr.duracao, definir: (v) => { tr.duracao = Math.max(A.quadro(), A.arredondar(v)); }, passo: 1 / A.projeto.fps, casas: 2, min: 1 / A.projeto.fps, unidade: " s", descricao: "Duração da transição" });
    vivos.push(dur);
    const linhas = [
      el("div", { class: "ce-linha" }, el("span"), el("label", {}, "Tipo"), el("span", {}, tipo), el("span")),
      el("div", { class: "ce-linha" }, el("span"), el("label", {}, "Duração"), dur, el("span")),
    ];
    if (def && def.direcao) {
      const dir = el("select", { class: "lnux-selecao pequena" }, ...V.DIRECOES.map(([v, n]) => el("option", { value: v, selected: v === (tr.direcao || 0) }, n)));
      dir.addEventListener("change", () => { A.marcar("Direção da transição"); tr.direcao = +dir.value; A.mudou(); });
      linhas.push(el("div", { class: "ce-linha" }, el("span"), el("label", {}, "Direção"), el("span", {}, dir), el("span")));
    }
    const lados = tr.a && tr.b ? "Entre dois clipes (centrada no corte)" : tr.b ? "No começo do clipe" : "No fim do clipe";
    linhas.push(el("div", { class: "ce-grupo", style: { textTransform: "none", letterSpacing: 0 } }, lados + ". Arraste as bordas da transição na linha do tempo para mudar a duração."));
    caixaCE.replaceChildren(el("div", { style: { padding: "4px 0" } },
      el("div", { class: "ce-secao" }, el("div", { class: "titulo" }, el("span", { class: "fx" }, "fx"), el("span", {}, "Transição: " + (def ? def.nome : tr.tipo)), el("span", { class: "espaco" }),
        el("button", { type: "button", class: "lnux-botao pequeno plano", title: "Apagar a transição", onclick: () => { A.marcar("Apagar transição"); A.projeto.transicoes = A.projeto.transicoes.filter((x) => x !== tr); A.transicaoEscolhida = null; A.mudou(); } }, "×")),
      el("div", { class: "linhas" }, ...linhas))));
    faixa = null;
  }

  // ── Faixa de quadros-chave e gráficos ───────────────────────────────

  function geometriaFaixa(c) {
    const w = faixa.clientWidth;
    const dur = Math.max(A.quadro(), c.duracao);
    return { w, x: (t) => 8 + (t / dur) * (w - 16), t: (x) => limitar(((x - 8) / Math.max(1, w - 16)) * dur, 0, dur), dur };
  }
  function yDaLinha(info, props) { return info.elemento.offsetTop - props.scrollTop + info.elemento.offsetHeight / 2; }

  function desenharFaixa() {
    if (!faixa || !faixa.isConnected) return;
    const c = clipeAtual();
    if (!c) return;
    const props = faixa._props;
    const w = faixa.parentElement.clientWidth, h = props.clientHeight + 40;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (faixa.width !== Math.round(w * dpr) || faixa.height !== Math.round(h * dpr)) { faixa.width = Math.round(w * dpr); faixa.height = Math.round(h * dpr); faixa.style.width = w + "px"; faixa.style.height = h + "px"; }
    const ctx = faixa.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = geometriaFaixa(c);
    const cor = (v) => LNUX.tema.cor(v);
    // régua do clipe
    ctx.fillStyle = cor("--painel"); ctx.fillRect(0, 0, w, 22);
    ctx.fillStyle = cor("--trilha"); ctx.fillRect(g.x(0), 22, g.x(g.dur) - g.x(0), h);
    ctx.strokeStyle = cor("--borda-forte"); ctx.fillStyle = cor("--texto-3"); ctx.font = "10px sans-serif"; ctx.textBaseline = "top";
    const passos = 4;
    ctx.beginPath();
    for (let i = 0; i <= passos; i++) { const t = (g.dur * i) / passos, x = Math.round(g.x(t)) + 0.5; ctx.moveTo(x, 14); ctx.lineTo(x, 22); }
    ctx.stroke();
    ctx.fillText(A.tempo(c.inicio).slice(3), g.x(0) + 2, 2);
    const fimTxt = A.tempo(V.fim(c)).slice(3);
    ctx.fillText(fimTxt, g.x(g.dur) - ctx.measureText(fimTxt).width - 2, 2);
    // diamantes de cada linha
    for (const info of linhasCE) {
      const y = yDaLinha(info, props);
      if (y < 22 || y > h) continue;
      ctx.strokeStyle = cor("--borda"); ctx.beginPath(); ctx.moveTo(0, y + info.elemento.offsetHeight / 2 - 0.5); ctx.lineTo(w, y + info.elemento.offsetHeight / 2 - 0.5); ctx.stroke();
      for (const t of temposDasChaves(info.c, info.caminhos)) {
        const x = g.x(t - (info.c.inicio - c.inicio));
        const escolhida = chaveEscolhida && chaveEscolhida.clipe === info.c.id && chaveEscolhida.caminhos[0] === info.caminhos[0] && Math.abs(chaveEscolhida.t - t) < 1e-4;
        const tipo = ((info.c.anim[info.caminhos[0]] || []).find((q) => Math.abs(q.t - t) < 1e-4) || {}).i || "linear";
        ctx.fillStyle = escolhida ? "#4f8ff7" : cor("--texto-2");
        ctx.beginPath();
        if (tipo === "segurar") ctx.rect(x - 4, y - 4, 8, 8);
        else if (tipo === "bezier" || tipo === "facilitar") { ctx.arc(x, y, 4.5, 0, Math.PI * 2); }
        else { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
        ctx.fill();
      }
      if (info.grafico) desenharGrafico(ctx, info, g, info.grafico.offsetTop - props.scrollTop, info.grafico.offsetHeight, w);
    }
    // cursor
    const xc = g.x(A.cursor - c.inicio);
    if (A.cursor >= c.inicio - 1e-6 && A.cursor <= V.fim(c) + 1e-6) {
      ctx.fillStyle = "#4f8ff7";
      ctx.beginPath(); ctx.moveTo(xc - 5, 0); ctx.lineTo(xc + 5, 0); ctx.lineTo(xc, 8); ctx.fill();
      ctx.fillRect(xc - 0.5, 0, 1, h);
    }
  }

  /** Gráfico de valor (em cima) e de velocidade (embaixo) de uma propriedade. */
  function desenharGrafico(ctx, info, g, y0, altura, w) {
    if (y0 + altura < 22) return;
    const c = info.c, k = info.caminhos[0];
    const dur = c.duracao, n = Math.max(40, Math.round(w / 3));
    const amostras = [];
    for (let i = 0; i <= n; i++) amostras.push(V.valor(c, k, (dur * i) / n) ?? valorPadraoDe(c, k));
    const ch = (c.anim && c.anim[k]) || [];
    let min = Math.min(...amostras, ...ch.map((q) => q.v)), max = Math.max(...amostras, ...ch.map((q) => q.v));
    if (max - min < 1e-6) { min -= 1; max += 1; }
    const folga = (max - min) * 0.1;
    min -= folga; max += folga;
    const hv = altura * 0.6, hvel = altura * 0.4 - 6;
    const yv = (v) => y0 + 4 + (1 - (v - min) / (max - min)) * (hv - 8);
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(0, y0, w, altura);
    ctx.strokeStyle = "#e8d44d"; ctx.lineWidth = 1.5; ctx.beginPath();
    amostras.forEach((v, i) => { const x = g.x((dur * i) / n), y = yv(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    for (const q of ch) { ctx.fillStyle = "#e8d44d"; ctx.beginPath(); ctx.arc(g.x(q.t), yv(q.v), 4, 0, Math.PI * 2); ctx.fill(); }
    // velocidade = derivada do valor
    const vel = amostras.map((v, i) => (i ? (v - amostras[i - 1]) / (dur / n) : 0));
    vel[0] = vel[1] || 0;
    const mv = Math.max(1e-6, ...vel.map(Math.abs));
    const base = y0 + hv + 3 + hvel / 2;
    ctx.strokeStyle = LNUX.tema.cor("--borda-forte"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, base); ctx.stroke();
    ctx.strokeStyle = "#4f8ff7"; ctx.lineWidth = 1.5; ctx.beginPath();
    vel.forEach((v, i) => { const x = g.x((dur * i) / n), y = base - (v / mv) * (hvel / 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.lineWidth = 1;
    info.escala = { min, max, yv, hv, y0 };
    if (info.graficoRotulos) {
      const casas = Math.abs(max - min) < 10 ? 2 : 1;
      info.graficoRotulos.replaceChildren(
        el("div", { style: { position: "absolute", top: "2px" } }, fmtNum(max, casas) + info.unidade),
        el("div", { style: { position: "absolute", top: Math.round(hv - 14) + "px" } }, fmtNum(min, casas) + info.unidade),
        el("div", { style: { position: "absolute", top: Math.round(hv + 4) + "px" } }, "Velocidade: " + fmtNum(mv, 2) + info.unidade + "/s"));
    }
  }

  function iniciarFaixa(cv, c) {
    let arr = null;
    const achar = (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const g = geometriaFaixa(c), props = cv._props;
      for (const info of linhasCE) {
        if (info.grafico && info.escala) {
          const gy = info.grafico.offsetTop - props.scrollTop;
          if (y >= gy && y <= gy + info.grafico.offsetHeight) {
            const ch = info.c.anim[info.caminhos[0]] || [];
            const i = ch.findIndex((q) => Math.abs(g.x(q.t) - x) <= 6 && Math.abs(info.escala.yv(q.v) - y) <= 6);
            return { x, y, g, info, grafico: true, i };
          }
        }
        const yl = yDaLinha(info, props);
        if (Math.abs(y - yl) <= info.elemento.offsetHeight / 2) {
          const t = temposDasChaves(info.c, info.caminhos).find((t) => Math.abs(g.x(t) - x) <= 6);
          return { x, y, g, info, t };
        }
      }
      return { x, y, g };
    };
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      cv.focus({ preventScroll: true });
      cv.setPointerCapture(e.pointerId);
      const h = achar(e);
      if (h.grafico && h.i >= 0) { const q = h.info.c.anim[h.info.caminhos[0]][h.i]; arr = { tipo: "grafico", h, x0: h.x, y0: h.y, t0: q.t, v0: q.v, moveu: false }; return; }
      if (h.info && h.t !== undefined) {
        chaveEscolhida = { clipe: h.info.c.id, caminhos: h.info.caminhos, t: h.t };
        arr = { tipo: "chave", h, x0: h.x, t0: h.t, moveu: false };
        A.irPara(c.inicio + h.t);
        return;
      }
      chaveEscolhida = null;
      arr = { tipo: "cursor" };
      A.irPara(c.inicio + h.g.t(h.x));
    });
    cv.addEventListener("pointermove", (e) => {
      if (!arr) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const g = geometriaFaixa(c);
      if (arr.tipo === "cursor") { A.irPara(c.inicio + g.t(x)); return; }
      if (!arr.moveu) { if (Math.abs(x - arr.x0) + Math.abs(y - (arr.y0 ?? y)) < 3) return; arr.moveu = true; A.marcar("Mover quadro-chave"); }
      const dt = g.t(x) - g.t(arr.x0);
      if (arr.tipo === "chave") {
        const info = arr.h.info;
        let novo = limitar(A.arredondar(arr.t0 + dt), 0, info.c.duracao);
        // os caminhos da linha andam juntos; não deixa cair em cima de outro quadro
        for (const k of info.caminhos) {
          const ch = info.c.anim[k] || [];
          const q = ch.find((x) => Math.abs(x.t - (chaveEscolhida ? chaveEscolhida.t : arr.t0)) < 1e-4);
          if (q && !ch.some((x) => x !== q && Math.abs(x.t - novo) < 1e-4)) q.t = novo;
          V.ajeitarChaves(ch);
        }
        chaveEscolhida.t = novo;
      } else {
        const info = arr.h.info, ch = info.c.anim[info.caminhos[0]], q = ch[arr.h.i];
        const esc = info.escala;
        q.v = arr.v0 - ((y - arr.y0) / Math.max(10, esc.hv - 8)) * (esc.max - esc.min);
        if (!e.shiftKey) q.t = limitar(A.arredondar(arr.t0 + dt), 0, info.c.duracao);
        V.ajeitarChaves(ch);
      }
      A.desenharQuadro(A.cursor);
      desenharFaixa();
      for (const v of vivos) v.atualizar && v.atualizar();
    });
    cv.addEventListener("pointerup", () => { if (arr && arr.moveu) A.mudou({ leve: true }); arr = null; });
    cv.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && chaveEscolhida) {
        e.preventDefault(); e.stopPropagation();
        const cc = A.clipe(chaveEscolhida.clipe);
        if (!cc) return;
        A.marcar("Apagar quadro-chave");
        for (const k of chaveEscolhida.caminhos) { const ch = cc.anim[k] || []; const i = ch.findIndex((q) => Math.abs(q.t - chaveEscolhida.t) < 1e-4); if (i >= 0) ch.splice(i, 1); V.ajeitarChaves(ch); if (!ch.length) delete cc.anim[k]; }
        chaveEscolhida = null;
        A.mudou();
      }
    });
    cv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const h = achar(e);
      if (!h.info || h.t === undefined) return;
      const info = h.info;
      const chaves = () => info.caminhos.map((k) => (info.c.anim[k] || []).find((q) => Math.abs(q.t - h.t) < 1e-4)).filter(Boolean);
      LNUX.abrirMenu([
        ...V.INTERPOLACOES.map(([id, nome]) => ({ rotulo: nome, marcado: () => (chaves()[0] || {}).i === id, acao: () => { A.marcar("Interpolação"); for (const q of chaves()) q.i = id; for (const k of info.caminhos) V.ajeitarChaves(info.c.anim[k] || []); A.mudou(); } })),
        "-",
        { rotulo: "Apagar o quadro-chave", acao: () => { A.marcar("Apagar quadro-chave"); for (const k of info.caminhos) { const ch = info.c.anim[k] || []; const i = ch.findIndex((q) => Math.abs(q.t - h.t) < 1e-4); if (i >= 0) ch.splice(i, 1); if (!ch.length) delete info.c.anim[k]; } A.mudou(); } },
      ], e.clientX, e.clientY);
    });
  }

  // ── Propriedades ────────────────────────────────────────────────────

  /** Linha com rótulo, faixa deslizante, número e o ◆ (quadro-chave no cursor). */
  function propNumero(c, rotulo, caminho, { min, max, passo = 1, unidade = "" } = {}) {
    const faixaEl = el("input", { type: "range", min, max, step: passo, "aria-label": rotulo });
    const numero = el("input", { class: "lnux-entrada", type: "number", min, max, step: passo, style: { width: "74px", minHeight: "26px", padding: "2px 4px" }, "aria-label": rotulo });
    const diamante = el("button", { type: "button", class: "diamante", title: "Pôr/tirar quadro-chave no cursor (anima a propriedade)", html: "◆", onclick: () => alternarChave(c, [caminho]) });
    let marcou = false;
    const aplicar = (v) => { if (!marcou) { A.marcar(rotulo); marcou = true; } A.definirValor(c, caminho, limitar(+v, min ?? -Infinity, max ?? Infinity)); A.mudou({ leve: true }); };
    faixaEl.addEventListener("input", () => { numero.value = faixaEl.value; aplicar(faixaEl.value); });
    numero.addEventListener("input", () => { if (numero.value !== "") aplicar(numero.value); });
    for (const x of [faixaEl, numero]) x.addEventListener("change", () => { marcou = false; });
    const atualizar = () => {
      const v = valorDe(c, caminho);
      if (document.activeElement !== numero) numero.value = Math.round(v / passo) * passo === v ? v : +(+v).toFixed(casasDoPasso(passo));
      if (document.activeElement !== faixaEl) faixaEl.value = v;
      diamante.classList.toggle("ligado", animado(c, caminho));
    };
    atualizar();
    vivosProps.push({ atualizar });
    return el("div", { class: "prop-linha" }, el("label", {}, rotulo), faixaEl, numero, el("span", { class: "fraco" }, unidade), diamante);
  }
  /** Campo de um objeto do clipe (texto/forma): muda direto, sem quadro-chave. */
  function campo(obj, chave, rotulo, tipo = "text", extra = {}) {
    let entrada;
    if (tipo === "select") entrada = el("select", { class: "lnux-selecao" }, ...extra.opcoes.map(([v, n]) => el("option", { value: v }, n)));
    else if (tipo === "textarea") entrada = el("textarea", { class: "lnux-entrada", rows: 3 });
    else entrada = el("input", { class: tipo === "checkbox" ? "" : "lnux-entrada", type: tipo, ...(extra.attrs || {}) });
    const ler = () => (tipo === "checkbox" ? entrada.checked : tipo === "number" || tipo === "range" ? +entrada.value : entrada.value);
    const escrever = () => { const v = obj()[chave]; if (tipo === "checkbox") entrada.checked = !!v; else entrada.value = v ?? ""; };
    escrever();
    let marcou = false;
    entrada.addEventListener(tipo === "select" || tipo === "checkbox" ? "change" : "input", () => {
      if (!marcou) { A.marcar(rotulo); marcou = true; }
      obj()[chave] = extra.converter ? extra.converter(ler()) : ler();
      if (tipo === "select" || tipo === "checkbox") marcou = false;
      A.mudou({ leve: true });
    });
    entrada.addEventListener("change", () => { marcou = false; });
    vivosProps.push({ atualizar: () => { if (document.activeElement !== entrada) escrever(); } });
    if (tipo === "checkbox") return el("label", { class: "lnux-alternar" }, entrada, rotulo);
    return el("label", { class: "lnux-campo" }, el("span", {}, rotulo), entrada);
  }
  const grade = (...filhos) => el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, ...filhos);

  /** Editor de texto/forma/cor (Propriedades e Gráficos essenciais usam). */
  K.editorGrafico = function (c) {
    const partes = [];
    if (c.tipo === "texto") {
      const tx = () => c.texto;
      if (!c.texto.fundo) c.texto.fundo = { ligado: false, cor: "#000000", opacidade: 0.6 };
      partes.push(el("h3", {}, LNUX.iconeEl("texto"), "Texto"),
        campo(tx, "conteudo", "Texto", "textarea"),
        grade(campo(tx, "fonte", "Fonte", "select", { opcoes: [["system-ui, sans-serif", "Sem serifa"], ["Georgia, serif", "Com serifa"], ["'Trebuchet MS', sans-serif", "Trebuchet"], ["Impact, 'Arial Black', sans-serif", "Impacto"], ["'Courier New', monospace", "Máquina de escrever"], ["'Comic Sans MS', cursive", "Manuscrita"], ["ui-rounded, 'Nunito', system-ui, sans-serif", "Arredondada"]] }),
          campo(tx, "tamanho", "Tamanho (% da altura)", "number", { attrs: { min: 1, max: 40, step: 0.5 } })),
        grade(campo(tx, "cor", "Cor", "color"), campo(tx, "alinhamento", "Alinhamento", "select", { opcoes: [["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"]] })),
        grade(campo(tx, "negrito", "Negrito", "checkbox"), campo(tx, "italico", "Itálico", "checkbox")),
        grade(campo(tx, "posicao", "Posição na tela", "select", { opcoes: [["cima", "Em cima"], ["meio", "No meio"], ["baixo", "Embaixo"]] }),
          campo(tx, "entrelinha", "Entrelinha", "number", { attrs: { min: 0.8, max: 3, step: 0.05 } })),
        campo(tx, "animacao", "Animação", "select", { opcoes: [["nenhuma", "Nenhuma"], ["aparecer", "Aparecer"], ["subir", "Subir aparecendo"], ["zoom", "Zoom aparecendo"], ["digitar", "Digitando"], ["rolar", "Créditos subindo"], ["letreiro", "Letreiro andando"]] }),
        el("h3", {}, "Contorno, sombra e fundo"),
        grade(campo(tx, "contorno", "Contorno", "checkbox"), campo(tx, "sombra", "Sombra", "checkbox")),
        grade(campo(tx, "corContorno", "Cor do contorno", "color"), campo(tx, "espessuraContorno", "Espessura (%)", "number", { attrs: { min: 1, max: 40, step: 1 } })),
        grade(campo(() => c.texto.fundo, "ligado", "Fundo atrás do texto", "checkbox"), campo(() => c.texto.fundo, "cor", "Cor do fundo", "color")),
        campo(() => c.texto.fundo, "opacidade", "Opacidade do fundo", "range", { attrs: { min: 0, max: 1, step: 0.05 } }));
    } else if (c.tipo === "forma") {
      const f = () => c.forma;
      partes.push(el("h3", {}, LNUX.iconeEl("forma"), "Forma"),
        grade(campo(f, "tipo", "Tipo", "select", { opcoes: [["retangulo", "Retângulo"], ["elipse", "Elipse"], ["linha", "Linha"]] }), campo(f, "raio", "Cantos arredondados", "number", { attrs: { min: 0, max: 500 } })),
        grade(campo(f, "largura", "Largura (px)", "number", { attrs: { min: 1, max: 8000 } }), campo(f, "altura", "Altura (px)", "number", { attrs: { min: 1, max: 8000 } })),
        grade(campo(f, "preenchimento", "Preenchimento", "color"), campo(f, "gradiente", "Gradiente até", "color")),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => { A.marcar("Gradiente"); c.forma.gradiente = c.forma.gradiente ? null : "#a879f2"; A.mudou(); } }, c.forma.gradiente ? "Tirar o gradiente" : "Usar gradiente"),
        grade(campo(f, "contorno", "Contorno", "color"), campo(f, "espessura", "Espessura do contorno", "number", { attrs: { min: 0, max: 200 } })),
        campo(f, "sombra", "Sombra", "checkbox"));
    } else if (c.tipo === "cor") {
      partes.push(el("h3", {}, "Cor sólida"), campo(() => c, "cor", "Cor", "color"));
    }
    return partes;
  };

  function desenharProps() {
    vivosProps = [];
    const c = clipeAtual();
    const p = A.projeto;
    if (!c) {
      caixaProps.replaceChildren(el("div", { class: "props-painel" },
        el("h3", {}, LNUX.iconeEl("video"), "Sequência: " + p.nome),
        el("div", { class: "fraco" }, `${p.largura} × ${p.altura} · ${String(p.fps).replace(".", ",")} quadros/s · ${A.tempo(A.duracao())}`),
        el("div", { class: "fraco" }, `${p.clipes.length} clipe(s) · ${Object.keys(p.midias).length} mídia(s) · ${p.trilhas.length} trilhas`),
        el("button", { type: "button", class: "lnux-botao", onclick: () => A.comandos.configuracoes() }, "Configurações da sequência..."),
        el("p", { class: "fraco" }, "Escolha um clipe na linha do tempo para mudar posição, escala, recorte, velocidade, texto e volume aqui.")));
      return;
    }
    const m = c.tipo === "midia" ? A.midia(c.midia) : null;
    const partes = [];
    const nome = el("input", { class: "lnux-entrada", value: c.nome || (m && m.nome) || "", "aria-label": "Nome do clipe" });
    nome.addEventListener("change", () => { A.marcar("Renomear clipe"); c.nome = nome.value.trim(); A.mudou({ leve: true }); });
    partes.push(el("label", { class: "lnux-campo" }, el("span", {}, { midia: m ? { video: "Clipe de vídeo", imagem: "Imagem", audio: "Clipe de áudio" }[m.tipo] : "Clipe", texto: "Título", forma: "Forma", cor: "Cor sólida", ajuste: "Camada de ajuste" }[c.tipo]), nome),
      el("div", { class: "fraco" }, `${A.tempo(c.inicio)} → ${A.tempo(V.fim(c))} · duração ${A.tempo(c.duracao)}`));
    if (ehVideo(c)) {
      partes.push(...K.editorGrafico(c));
      if (c.tipo === "ajuste") partes.push(el("p", { class: "fraco" }, "Os efeitos desta camada valem para tudo o que estiver nas trilhas de baixo. Arraste efeitos do painel Efeitos para ela."));
      partes.push(el("h3", {}, "Transformar"),
        propNumero(c, "Posição X", "mov.posX", { min: -p.largura, max: p.largura * 2, passo: 1 }),
        propNumero(c, "Posição Y", "mov.posY", { min: -p.altura, max: p.altura * 2, passo: 1 }),
        propNumero(c, "Escala", "mov.escala", { min: 0, max: 400, passo: 0.1, unidade: "%" }),
        propNumero(c, "Rotação", "mov.rotacao", { min: -360, max: 360, passo: 0.1, unidade: "°" }),
        propNumero(c, "Opacidade", "opac.valor", { min: 0, max: 100, passo: 0.1, unidade: "%" }),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => { A.marcar("Centralizar"); A.definirValor(c, "mov.posX", p.largura / 2); A.definirValor(c, "mov.posY", p.altura / 2); A.mudou(); } }, "Centralizar"),
          m && m.largura ? el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => A.comandos.ajustarQuadro(false) }, "Ajustar ao quadro") : null,
          m && m.largura ? el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => A.comandos.ajustarQuadro(true) }, "Preencher o quadro") : null),
        el("h3", {}, "Recortar"),
        propNumero(c, "Esquerda", "rec.esquerda", { min: 0, max: 100, passo: 0.1, unidade: "%" }),
        propNumero(c, "Em cima", "rec.topo", { min: 0, max: 100, passo: 0.1, unidade: "%" }),
        propNumero(c, "Direita", "rec.direita", { min: 0, max: 100, passo: 0.1, unidade: "%" }),
        propNumero(c, "Embaixo", "rec.baixo", { min: 0, max: 100, passo: 0.1, unidade: "%" }));
    } else {
      partes.push(el("h3", {}, LNUX.iconeEl("volume"), "Áudio"),
        propNumero(c, "Volume", "audio.nivel", { min: -60, max: 15, passo: 0.1, unidade: "dB" }),
        propNumero(c, "Panorama", "audio.pan", { min: -100, max: 100, passo: 1 }),
        campo(() => c, "mudo", "Deixar o clipe mudo", "checkbox"));
    }
    if (c.tipo === "midia" && m && m.tipo !== "imagem") {
      const vel = el("input", { class: "lnux-entrada", type: "number", min: 5, max: 2000, step: 1, value: Math.round((c.velocidade || 1) * 100), style: { width: "90px" } });
      const cascata = el("input", { type: "checkbox", checked: true });
      vel.addEventListener("change", () => { const v = limitar(+vel.value / 100, 0.05, 20); A.marcar("Velocidade"); for (const x of [c, ...(A.vinculada ? V.parceiros(p, c) : [])]) V.mudarVelocidade(p, x, v, cascata.checked); A.mudou(); });
      partes.push(el("h3", {}, "Velocidade"), el("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
        el("label", { class: "lnux-campo" }, el("span", {}, "Velocidade (%)"), vel), el("label", { class: "lnux-alternar" }, cascata, "Os clipes seguintes acompanham")),
        el("div", { class: "fraco" }, `Mídia de ${A.tempo(c.entrada)} a ${A.tempo(c.entrada + c.duracao * (c.velocidade || 1))}`));
    }
    caixaProps.replaceChildren(el("div", { class: "props-painel" }, ...partes));
  }

  // ── Cor (Lumetri) ───────────────────────────────────────────────────

  function lumetriDe(c) { return c.efeitos.find((f) => f.id === "cor" && !f.audio); }
  function garantirLumetri(c) {
    let fx = lumetriDe(c);
    if (!fx) { fx = V.novoEfeito("cor"); c.efeitos.unshift(fx); }
    return fx;
  }

  function desenharCor() {
    vivosCor = [];
    const c = clipeAtual();
    if (!c || !ehVideo(c)) {
      caixaCor.replaceChildren(el("div", { class: "props-painel" }, el("p", { class: "fraco" }, "Escolha um clipe de vídeo, imagem, título ou uma camada de ajuste para corrigir a cor."),
        el("p", { class: "fraco" }, "Dica: para corrigir vários clipes de uma vez, ponha uma camada de ajuste (Clipe › Nova camada de ajuste) por cima e mude a cor dela.")));
      return;
    }
    const def = V.definicaoEfeito("cor");
    let fx = lumetriDe(c);
    const uid = () => (fx || (fx = lumetriDe(c))) && fx.uid;
    const tocar = (descricao) => { if (!fx) { A.marcar(descricao); fx = garantirLumetri(c); return true; } return false; };
    const secoes = [];
    let atual = null;
    for (const prm of def.params) {
      if (prm.grupo) { atual = { nome: prm.grupo, params: [] }; secoes.push(atual); continue; }
      atual.params.push(prm);
    }
    const linha = (prm) => {
      const k = () => `fx.${uid()}.${prm.id}`;
      const obter = () => (fx ? V.valor(c, k(), tl(c)) ?? fx.params[prm.id] : prm.padrao);
      if (prm.tipo === "sim") {
        const ch = el("input", { type: "checkbox", checked: !!obter() });
        ch.addEventListener("change", () => { if (!tocar(prm.nome)) A.marcar(prm.nome); fx.params[prm.id] = ch.checked; A.mudou({ leve: true }); });
        vivosCor.push({ atualizar: () => { ch.checked = !!obter(); } });
        return el("label", { class: "lnux-alternar" }, ch, prm.nome);
      }
      if (prm.tipo === "escolha") {
        const sel = el("select", { class: "lnux-selecao" }, ...prm.opcoes.map(([v, n]) => el("option", { value: v }, n)));
        sel.value = obter();
        sel.addEventListener("change", () => { if (!tocar(prm.nome)) A.marcar(prm.nome); fx.params[prm.id] = +sel.value; A.mudou({ leve: true }); });
        vivosCor.push({ atualizar: () => { if (document.activeElement !== sel) sel.value = obter(); } });
        return el("label", { class: "lnux-campo" }, el("span", {}, prm.nome), sel);
      }
      const faixaEl = el("input", { type: "range", min: prm.min, max: prm.max, step: prm.passo, "aria-label": prm.nome });
      const valor = el("span", { class: "mono", style: { minWidth: "42px", textAlign: "right", color: "var(--azul-tempo)" } });
      const diamante = el("button", { type: "button", class: "diamante", title: "Quadro-chave no cursor", html: "◆", onclick: () => { tocar(prm.nome); alternarChave(c, [k()]); } });
      let marcou = false;
      faixaEl.addEventListener("input", () => {
        if (!marcou) { if (!tocar(prm.nome)) A.marcar(prm.nome); marcou = true; }
        A.definirValor(c, k(), +faixaEl.value);
        valor.textContent = fmtNum(+faixaEl.value, casasDoPasso(prm.passo));
        A.mudou({ leve: true });
      });
      faixaEl.addEventListener("change", () => { marcou = false; });
      faixaEl.addEventListener("dblclick", () => { A.marcar(prm.nome + " (padrão)"); if (fx) { A.definirValor(c, k(), prm.padrao); A.mudou(); } });
      const atualizar = () => { const v = obter(); if (document.activeElement !== faixaEl) faixaEl.value = v; valor.textContent = fmtNum(v, casasDoPasso(prm.passo)); diamante.classList.toggle("ligado", !!fx && animado(c, k())); };
      atualizar();
      vivosCor.push({ atualizar });
      return el("div", { class: "prop-linha", title: "Dois cliques na faixa: volta ao padrão" }, el("label", {}, prm.nome), faixaEl, valor, el("span"), diamante);
    };
    const partes = [
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
        el("b", {}, c.nome || (A.midia(c.midia) || {}).nome || "Clipe"), el("span", { class: "espaco", style: { flex: 1 } }),
        fx ? el("button", { type: "button", class: "lnux-botao pequeno", "aria-pressed": String(fx.ativo !== false), title: "Comparar: liga/desliga a correção", onclick: () => { A.marcar("Ligar/desligar a cor"); fx.ativo = fx.ativo === false; A.mudou(); } }, fx.ativo === false ? "Desligada" : "Ligada") : null,
        fx ? el("button", { type: "button", class: "lnux-botao pequeno", title: "Voltar tudo ao padrão", onclick: () => { A.marcar("Cor ao padrão"); for (const prm of def.params) if (!prm.grupo) fx.params[prm.id] = prm.padrao; fx.curvas = V.curvasPadrao(); for (const k of Object.keys(c.anim)) if (k.startsWith(`fx.${fx.uid}.`)) delete c.anim[k]; A.mudou(); } }, "↺ Padrão") : null),
    ];
    for (const s of secoes) {
      const det = el("details", { open: abertasCor.has(s.nome) });
      det.addEventListener("toggle", () => { det.open ? abertasCor.add(s.nome) : abertasCor.delete(s.nome); });
      const corpo = el("div", { style: { display: "grid", gap: "6px", padding: "6px 0 10px" } });
      if (s.nome === "Correção básica") corpo.append(el("div", { style: { display: "flex", gap: "6px" } }, el("button", { type: "button", class: "lnux-botao pequeno", title: "Acerta exposição, contraste, brancos e pretos olhando o quadro do cursor", onclick: () => auto(c) }, "Auto"), el("span", { class: "fraco", style: { fontSize: ".85em", alignSelf: "center" } }, "olha o quadro do cursor")));
      if (s.nome === "Rodas de cor") corpo.append(rodas(c, () => fx, tocar, uid));
      else for (const prm of s.params) corpo.append(linha(prm));
      if (s.nome === "HSL secundária") corpo.prepend(el("button", { type: "button", class: "lnux-botao pequeno", title: "Clique no monitor numa cor para escolher a matiz da chave", onclick: () => {
        LNUX.aviso("Clique no monitor de programa na cor que quer corrigir.");
        A.contaGotas = (rgb) => { tocar("Conta-gotas"); const [h] = hsv(rgb); A.marcar("Conta-gotas"); A.definirValor(c, `fx.${uid()}.hslMatiz`, Math.round(h)); fx.params.hsl = true; A.mudou(); };
      } }, "Conta-gotas"));
      det.append(el("summary", {}, s.nome), corpo);
      partes.push(det);
      if (s.nome === "Criativo") {
        const dc = el("details", { open: abertasCor.has("Curvas") });
        dc.addEventListener("toggle", () => { dc.open ? abertasCor.add("Curvas") : abertasCor.delete("Curvas"); });
        dc.append(el("summary", {}, "Curvas"), curvas(c, () => fx, tocar));
        partes.push(dc);
      }
    }
    caixaCor.replaceChildren(el("div", { class: "props-painel" }, ...partes));
  }

  function hsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; }
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }

  /** Auto: mede o quadro sem a correção e acerta exposição, contraste, brancos e pretos. */
  function auto(c) {
    const fx0 = lumetriDe(c);
    const estava = fx0 ? fx0.ativo : null;
    if (fx0) fx0.ativo = false;
    A.desenharQuadro(A.cursor);
    const a = A.render.amostra(128, 72);
    if (fx0) fx0.ativo = estava;
    if (!a) return;
    const lumas = [];
    for (let i = 0; i < a.px.length; i += 4) lumas.push((0.2126 * a.px[i] + 0.7152 * a.px[i + 1] + 0.0722 * a.px[i + 2]) / 255);
    lumas.sort((x, y) => x - y);
    const q = (f) => lumas[Math.min(lumas.length - 1, Math.floor(f * lumas.length))];
    const media = lumas.reduce((s, x) => s + x, 0) / lumas.length;
    A.marcar("Cor automática");
    const fx = garantirLumetri(c);
    const set = (k, v) => A.definirValor(c, `fx.${fx.uid}.${k}`, Math.round(v * 100) / 100);
    set("exposicao", limitar(Math.log2(0.42 / Math.max(0.02, media)) * 0.8, -2, 2));
    set("brancos", limitar((0.97 - q(0.995)) * 160, -60, 80));
    set("pretos", limitar((0.03 - q(0.005)) * 200, -60, 40));
    set("contraste", limitar((0.75 - (q(0.95) - q(0.05))) * 60, -30, 40));
    A.mudou();
  }

  function rodas(c, fx, tocar, uid) {
    const caixa = el("div", { class: "rodas" });
    for (const [prefixo, nome] of [["sombras", "Sombras"], ["medios", "Meios-tons"], ["realces", "Realces"]]) {
      const cv = el("canvas", { width: 220, height: 220, title: "Arraste para dar uma cor; dois cliques voltam ao neutro", "aria-label": "Roda de cor: " + nome });
      const luz = el("input", { type: "range", min: -100, max: 100, step: 1, style: { width: "100%" }, "aria-label": nome + ": luz" });
      const obter = (eixo) => (fx() ? V.valor(c, `fx.${uid()}.${prefixo}${eixo}`, tl(c)) ?? fx().params[prefixo + eixo] : 0);
      const desenhar = () => {
        const ctx = cv.getContext("2d"), R = 100, cx = 110, cy = 110;
        ctx.clearRect(0, 0, 220, 220);
        const g = ctx.createConicGradient ? ctx.createConicGradient(0, cx, cy) : null;
        if (g) { for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${((1 - i / 12) * 360) % 360} 75% 50%)`); ctx.fillStyle = g; }
        else ctx.fillStyle = "#777";
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        rg.addColorStop(0, "rgba(128,128,128,1)"); rg.addColorStop(1, "rgba(128,128,128,0)");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.stroke();
        const x = obter("X"), y = obter("Y");
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx + x * R, cy - y * R, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        luz.value = obter("L");
      };
      let marcou = false;
      const mover = (e) => {
        const r = cv.getBoundingClientRect();
        let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
        x /= 100 / 110; y /= 100 / 110;
        const d = Math.hypot(x, y);
        if (d > 1) { x /= d; y /= d; }
        if (!marcou) { if (!tocar("Roda de cor")) A.marcar("Roda de cor"); marcou = true; }
        A.definirValor(c, `fx.${uid()}.${prefixo}X`, Math.round(x * 100) / 100);
        A.definirValor(c, `fx.${uid()}.${prefixo}Y`, Math.round(y * 100) / 100);
        desenhar();
        A.mudou({ leve: true });
      };
      cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); marcou = false; mover(e); });
      cv.addEventListener("pointermove", (e) => { if (e.buttons) mover(e); });
      cv.addEventListener("dblclick", () => { if (!fx()) return; A.marcar("Roda neutra"); A.definirValor(c, `fx.${uid()}.${prefixo}X`, 0); A.definirValor(c, `fx.${uid()}.${prefixo}Y`, 0); A.mudou(); desenhar(); });
      let marcouLuz = false;
      luz.addEventListener("input", () => { if (!marcouLuz) { if (!tocar("Luz da roda")) A.marcar("Luz da roda"); marcouLuz = true; } A.definirValor(c, `fx.${uid()}.${prefixo}L`, +luz.value); A.mudou({ leve: true }); });
      luz.addEventListener("change", () => { marcouLuz = false; });
      desenhar();
      vivosCor.push({ atualizar: desenhar });
      caixa.append(el("div", { class: "roda" }, cv, nome, luz));
    }
    return caixa;
  }

  let canalCurva = "mestre";
  function curvas(c, fx, tocar) {
    const cv = el("canvas", { width: 512, height: 512, "aria-label": "Curvas de cor" });
    const canais = el("div", { class: "lnux-segmentos", style: { marginBottom: "6px" } });
    const desenharCanais = () => canais.replaceChildren(...[["mestre", "Mestre"], ["r", "Vermelho"], ["g", "Verde"], ["b", "Azul"]].map(([id, n]) =>
      el("button", { type: "button", "aria-pressed": String(canalCurva === id), onclick: () => { canalCurva = id; desenharCanais(); desenhar(); } }, n)));
    desenharCanais();
    const pontos = () => (fx() && fx().curvas ? fx().curvas[canalCurva] : [[0, 0], [1, 1]]);
    const corCanal = { mestre: "#e8eaed", r: "#ff5a5a", g: "#4cd964", b: "#5b9dff" };
    function desenhar() {
      const ctx = cv.getContext("2d"), W = 512, H = 512;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(128,128,128,.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); for (let i = 1; i < 4; i++) { ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); } ctx.stroke();
      ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke(); ctx.setLineDash([]);
      const f = V.curvaMonotonica(pontos());
      ctx.strokeStyle = corCanal[canalCurva]; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i <= 128; i++) { const x = i / 128, y = limitar(f(x), 0, 1); i ? ctx.lineTo(x * W, (1 - y) * H) : ctx.moveTo(x * W, (1 - y) * H); }
      ctx.stroke();
      for (const [x, y] of pontos()) { ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x * W, (1 - y) * H, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    let arr = null;
    const posicao = (e) => { const r = cv.getBoundingClientRect(); return [limitar((e.clientX - r.left) / r.width, 0, 1), limitar(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      if (!tocar("Curvas")) A.marcar("Curvas");
      const lista = fx().curvas[canalCurva];
      const [x, y] = posicao(e);
      let i = lista.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.04);
      if (i < 0) { lista.push([x, V.curvaMonotonica(lista)(x)]); lista.sort((a, b) => a[0] - b[0]); i = lista.findIndex((p) => p[0] === x); }
      if (e.button === 2 || e.detail >= 2) { if (i > 0 && i < lista.length - 1) lista.splice(i, 1); arr = null; desenhar(); A.mudou({ leve: true }); return; }
      arr = { i };
      desenhar(); A.mudou({ leve: true });
    });
    cv.addEventListener("pointermove", (e) => {
      if (!arr) return;
      const lista = fx().curvas[canalCurva];
      let [x, y] = posicao(e);
      const ponta = arr.i === 0 || arr.i === lista.length - 1;
      if (ponta) x = lista[arr.i][0];
      else x = limitar(x, lista[arr.i - 1][0] + 0.01, lista[arr.i + 1][0] - 0.01);
      lista[arr.i] = [x, y];
      desenhar();
      A.mudou({ leve: true });
    });
    cv.addEventListener("pointerup", () => { arr = null; });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    desenhar();
    vivosCor.push({ atualizar: desenhar });
    return el("div", { class: "curvas", style: { padding: "6px 0" } }, canais, cv,
      el("div", { class: "fraco", style: { fontSize: ".85em", marginTop: "4px" } }, "Clique para pôr um ponto e arraste; dois cliques ou botão direito apagam o ponto."),
      el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => { if (!fx()) return; A.marcar("Curva reta"); fx().curvas[canalCurva] = [[0, 0], [1, 1]]; desenhar(); A.mudou(); } }, "Curva reta"));
  }

  // ── Escopos ─────────────────────────────────────────────────────────

  let tipoEscopo = "onda";
  let cvEscopo = null, ultimoEscopo = 0, pedidoEscopo = 0;
  function montarEscopos() {
    cvEscopo = el("canvas", { width: 512, height: 320, "aria-label": "Escopo" });
    const sel = el("div", { class: "lnux-segmentos", style: { flexWrap: "wrap" } }, ...[["onda", "Onda"], ["parade", "RGB"], ["vetor", "Vetor"], ["histograma", "Histograma"]].map(([id, n]) =>
      el("button", { type: "button", "aria-pressed": String(tipoEscopo === id), "data-escopo": id, title: { onda: "Forma de onda (luminância)", parade: "Parade RGB", vetor: "Vetorscópio", histograma: "Histograma" }[id],
        onclick: () => { tipoEscopo = id; for (const b of sel.children) b.setAttribute("aria-pressed", String(b.dataset.escopo === id)); desenharEscopo(true); } }, n)));
    caixaEscopos.replaceChildren(el("div", { class: "props-painel escopos" }, sel, cvEscopo, el("p", { class: "fraco", style: { margin: 0, fontSize: ".85em" } }, "Mostram o quadro do cursor (com todos os efeitos). Forma de onda: 0 a 100 IRE de baixo para cima.")));
  }
  function desenharEscopo(forcar) {
    if (!cvEscopo || !caixaEscopos.classList.contains("aberta")) return;
    const agora = performance.now();
    if (!forcar && agora - ultimoEscopo < 120) { if (!pedidoEscopo) pedidoEscopo = setTimeout(() => { pedidoEscopo = 0; desenharEscopo(true); }, 130); return; }
    ultimoEscopo = agora;
    const a = A.render.ok ? A.render.amostra(256, 144) : null;
    const ctx = cvEscopo.getContext("2d"), W = cvEscopo.width, H = cvEscopo.height;
    ctx.fillStyle = "#050607"; ctx.fillRect(0, 0, W, H);
    if (!a) return;
    const img = ctx.createImageData(W, H), d = img.data;
    const somar = (x, y, r, g, b, k = 40) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = Math.min(255, d[i] + r * k / 255); d[i + 1] = Math.min(255, d[i + 1] + g * k / 255); d[i + 2] = Math.min(255, d[i + 2] + b * k / 255); d[i + 3] = 255; };
    const px = a.px;
    if (tipoEscopo === "onda" || tipoEscopo === "parade") {
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const i = (y * a.w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        if (tipoEscopo === "onda") { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, yy = (1 - l / 255) * (H - 1), xx = (x / a.w) * W; somar(xx, yy, 120, 255, 140, 45); somar(xx + 1, yy, 120, 255, 140, 45); }
        else {
          const terco = W / 3, xx = (x / a.w) * terco;
          somar(xx, (1 - r / 255) * (H - 1), 255, 60, 60, 50);
          somar(terco + xx, (1 - g / 255) * (H - 1), 60, 255, 90, 50);
          somar(2 * terco + xx, (1 - b / 255) * (H - 1), 70, 120, 255, 50);
        }
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = "11px sans-serif";
      for (const ire of [0, 25, 50, 75, 100]) { const y = (1 - ire / 100) * (H - 1) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(String(ire), 3, Math.max(10, y - 2)); }
      if (tipoEscopo === "parade") { ctx.beginPath(); ctx.moveTo(W / 3, 0); ctx.lineTo(W / 3, H); ctx.moveTo((2 * W) / 3, 0); ctx.lineTo((2 * W) / 3, H); ctx.stroke(); }
    } else if (tipoEscopo === "vetor") {
      const cx = W / 2, cy = H / 2, R = H * 0.45;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const cb = -0.1146 * r - 0.3854 * g + 0.5 * b, cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
        somar(cx + cb * 2 * R, cy - cr * 2 * R, px[i], px[i + 1], px[i + 2], 60);
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.font = "11px sans-serif";
      for (const [n, r, g, b] of [["R", 1, 0, 0], ["Mg", 1, 0, 1], ["B", 0, 0, 1], ["Cy", 0, 1, 1], ["G", 0, 1, 0], ["Yl", 1, 1, 0]]) {
        const cb = (-0.1146 * r - 0.3854 * g + 0.5 * b) * 0.75, cr = (0.5 * r - 0.4542 * g - 0.0458 * b) * 0.75;
        const x = cx + cb * 2 * R, y = cy - cr * 2 * R;
        ctx.strokeStyle = `rgb(${r * 255},${g * 255},${b * 255})`; ctx.strokeRect(x - 6, y - 6, 12, 12);
        ctx.fillStyle = ctx.strokeStyle; ctx.fillText(n, x + 8, y + 4);
      }
      // linha de tom de pele
      ctx.strokeStyle = "rgba(255,200,150,.35)"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(-2.15) * R, cy + Math.sin(-2.15) * R); ctx.stroke();
    } else {
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < px.length; i += 4) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; hist[3][Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++; }
      const max = Math.max(...hist.map((h) => Math.max(...h)));
      const cores = ["rgba(255,70,70,.55)", "rgba(70,230,100,.55)", "rgba(80,140,255,.55)", "rgba(230,230,230,.4)"];
      ctx.globalCompositeOperation = "lighter";
      hist.forEach((h, k) => {
        ctx.fillStyle = cores[k]; ctx.beginPath(); ctx.moveTo(0, H);
        for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - (Math.sqrt(h[i] / max)) * (H - 4));
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ── API ─────────────────────────────────────────────────────────────

  K.iniciar = function () {
    A = V.app;
    caixaCE = $("#aba-controles"); caixaProps = $("#aba-propriedades"); caixaCor = $("#aba-cor"); caixaEscopos = $("#aba-escopos");
    montarEscopos();
    // enquanto arrasta uma faixa do painel Cor ele não é reconstruído; ao soltar, sim (aparecem os botões do efeito)
    caixaCor.addEventListener("pointerdown", () => { arrastandoCor = true; });
    window.addEventListener("pointerup", () => { if (arrastandoCor) { arrastandoCor = false; setTimeout(() => K.desenhar(), 0); } });
  };

  // Os painéis guardam referências aos objetos do projeto; quando o projeto inteiro é trocado (desfazer, abrir,
  // gestos da linha do tempo), tudo é reconstruído.
  let projetoVisto = null, versao = 0;
  function assinatura(extra, semLumetri) {
    if (A.projeto !== projetoVisto) { projetoVisto = A.projeto; versao++; }
    const c = clipeAtual();
    const parceiros = c ? V.parceiros(A.projeto, c) : [];
    const daqui = (x) => [x.id, x.tipo, x.trilha, x.efeitos.filter((f) => !(semLumetri && f.id === "cor")).map((f) => f.uid + (f.ativo === false || semLumetri ? "" : "+")),
      Object.keys(x.anim || {}).filter((k) => x.anim[k].length && !(semLumetri && k.startsWith("fx."))), x.mov.uniforme, !!(x.forma && x.forma.gradiente)];
    return JSON.stringify([versao, extra, c && daqui(c), parceiros.map(daqui), A.transicaoEscolhida, A.vinculada]);
  }

  K.desenhar = function () {
    if (!A) return;
    const a1 = assinatura("ce" + expandida + [...fechadas].join());
    if (a1 !== assinaturaCE) { assinaturaCE = a1; desenharCE(); } else K.atualizarValoresCE();
    const a2 = assinatura("props");
    if (a2 !== assinaturaProps) { assinaturaProps = a2; desenharProps(); } else for (const v of vivosProps) v.atualizar();
    // o painel Cor não se reconstrói só porque o Lumetri foi criado no meio de um arraste
    const c = clipeAtual();
    const a3 = assinatura("cor", true) + (c && lumetriDe(c) ? (lumetriDe(c).ativo === false ? "0" : "1") : "");
    if (a3 !== assinaturaCor && !arrastandoCor) { assinaturaCor = a3; desenharCor(); } else for (const v of vivosCor) v.atualizar();
  };
  let arrastandoCor = false;
  K.atualizarValoresCE = function () { for (const v of vivos) v.atualizar && v.atualizar(); desenharFaixa(); };
  /** Depois de mexer no cursor ou no monitor: só os números e a faixa (sem reconstruir). */
  K.atualizarValores = function () {
    if (!A) return;
    if (A.projeto !== projetoVisto) { K.desenhar(); return; }
    K.atualizarValoresCE();
    for (const v of vivosProps) v.atualizar();
    for (const v of vivosCor) v.atualizar();
  };
  K.escopos = () => desenharEscopo(false);
  K.redesenharEscopos = () => desenharEscopo(true);
})();
