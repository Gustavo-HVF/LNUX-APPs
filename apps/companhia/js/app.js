/*
 * Companhia — a tela: junta o palco (Live2D), a conversa (IA ou motor local), a voz, os toques e a memória.
 *
 * Fluxo de uma mensagem: a pessoa escreve (ou fala) → o motor local responde se for simples → senão o roteador
 * escolhe a rota (padrão / pensar / longo) → a resposta chega aos pedaços → o LeitorDeFala separa as marcas
 * [emoção][gesto] (o rosto e o corpo reagem na hora) → cada frase completa vai para a voz → tudo é guardado na
 * memória do aparelho. De tempos em tempos (e ao abrir), a memória é reanalisada.
 */
(function () {
  "use strict";
  const { el, $ } = LNUX;
  const ia = C.ia, voz = C.voz, mem = C.memoria;
  const pref = (k, padrao) => LNUX.preferencia.ler("companhia." + k, padrao);
  const gravarPref = (k, v) => LNUX.preferencia.gravar("companhia." + k, String(v));
  ia.carregar();
  voz.carregar();
  // Modo: "conversa" (o chat bot) ou "jogar" (com outras pessoas numa sala, sem nenhuma função de IA). O endereço pode
  // já dizer (#modo=conversa, #modo=jogar ou #sala=<código>, o link de uma sala); senão a pessoa escolhe ao abrir.
  const fragmento = new URLSearchParams(location.hash.replace(/^#/, ""));
  let MODO = fragmento.get("sala") ? "jogar" : (["conversa", "jogar"].includes(fragmento.get("modo")) ? fragmento.get("modo") : null);
  const jogando = () => MODO === "jogar";
  let sala = null; // a sala em que estou (js/sala.js), no modo de jogar

  const palcoArea = $("#palco-area");
  // Dois palcos: Live2D (pixi) e 3D (VRoid/VRM, three.js). "palco" aponta para o da personagem aberta; os
  // ouvintes (toques, emoção...) valem para os dois. O 3D só é criado quando uma personagem VRoid abre.
  const palco2d = new C.Palco($("#palco"));
  let palco3d = null, palcoAtivo = palco2d;
  const ouvintesPalco = [];
  const palco = new Proxy({}, {
    get(_, k) {
      if (k === "on") return (ev, f) => { ouvintesPalco.push([ev, f]); palco2d.on(ev, f); if (palco3d) palco3d.on(ev, f); };
      const v = palcoAtivo[k];
      return typeof v === "function" ? v.bind(palcoAtivo) : v;
    },
    set(_, k, v) { palcoAtivo[k] = v; return true; },
  });
  // Captura de movimento (câmera), pacotes de movimento, cenário e esqueleto: só para as personagens VRoid (3D)
  const captura = new C.Captura({ conteiner: palcoArea, aoEstado: (texto, tipo) => {
    if (tipo === "erro") { LNUX.aviso(texto, "erro", 9000); return; }
    $("#palco-carregando").textContent = texto || "";
    $("#palco-carregando").hidden = !texto;
  } });
  async function usarPalco(tipo) {
    if (tipo === "vrm") {
      await C.prepararVRM();
      if (!palco3d) {
        palco3d = new C.Palco3D($("#palco"));
        for (const [ev, f] of ouvintesPalco) palco3d.on(ev, f);
        palco3d.captura = captura;
      }
      captura.palco = palco3d;
      palco2d.descarregar();
      palco2d.pausar();
      palco2d.app.view.style.display = "none";
      palco3d.mostrar(true);
      palcoAtivo = palco3d;
    } else {
      estudio.fechar();
      captura.desligar(); // as personagens Live2D não têm esqueleto para a captura comandar
      captura.palco = null;
      if (palco3d) { if (palco3d.mundo) palco3d.mundo.sair(); palco3d.descarregar(); palco3d.mostrar(false); }
      palco2d.app.view.style.display = "";
      palco2d.continuar();
      palcoAtivo = palco2d;
    }
    palcoArea.classList.toggle("palco-vrm", tipo === "vrm");
  }
  const listaMsgs = $("#mensagens");
  const campo = $("#texto");
  // Os painéis do menu Movimento (js/estudio.js)
  const estudio = C.Estudio({ area: palcoArea, captura, get palco() { return palcoAtivo; }, atual: () => atual, salvar: () => salvarPersonagem(), aoMudar: () => atualizarChipMovimento() });
  function atualizarChipMovimento() {
    const b = $("#chip-movimento"), vrm = !!(atual && atual.tipo === "vrm");
    b.hidden = !vrm;
    const andando = vrm && palco3d && palco3d.mundo && palco3d.mundo.andando;
    b.textContent = "🎬 Movimento" + (captura.ligada ? " · câmera" : "") + (andando ? " · andando" : "");
    b.classList.toggle("ligado", captura.ligada || !!andando);
    palcoArea.classList.toggle("andando", !!andando);
  }
  let atual = null;        // personagem aberta (com os arquivos)
  let est = null;          // memória (estado) dela
  let live2d = null;       // de onde veio o núcleo do Live2D (null = não carregou)
  let pedido = null;       // AbortController da resposta em andamento
  let respondendo = false;
  let ultimoToqueIA = 0, ultimaFalaToque = 0;
  let pararOuvir = null;
  let novasDesdeAnalise = 0;
  let voltarNeutraT = 0;
  let balaoT = 0;
  let mostrarZonas = false;

  // ── Ajudantes ────────────────────────────────────────────────────────

  const salvarEstado = LNUX.adiar(() => { if (est) mem.salvarEstado(est); atualizarAfeto(); }, 400);
  const salvarPersonagem = LNUX.adiar(() => { if (atual) C.salvarPersonagem(atual).catch(LNUX.erro); }, 600);
  const rolarFim = () => { listaMsgs.scrollTop = listaMsgs.scrollHeight; };
  const nomeDela = () => (atual ? atual.perfil.nome : "Ela");
  const hora = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const NOME_ROTA = { padrao: "padrão", leve: "leve", pensar: "pensar", longo: "contexto longo", local: "local (0 tokens)", toque: "local (0 tokens)" };
  const rotulo = (r) => NOME_ROTA[r] || r;

  function atualizarAfeto() {
    const a = est ? est.afeto || 0 : 0;
    const barra = $("#afeto-barra");
    barra.classList.toggle("negativo", a < 0);
    barra.style.left = a >= 0 ? "50%" : 50 + a / 2 + "%";
    barra.style.width = Math.abs(a) / 2 + "%";
    $("#chip-afeto").title = `Afeto: ${Math.round(a)} (de -100 a 100). Sobe com carinho e conversa; desce com provocação.`;
  }
  function atualizarGasto() {
    const g = ia.gasto;
    $("#gasto").textContent = g.pedidos || g.locais ? `IA ${g.pedidos} · local ${g.locais} · ~${(g.entrada + g.saida).toLocaleString("pt-BR")} tok` : "";
    $("#gasto").title = `Nesta sessão: ${g.pedidos} pedidos à IA (~${g.entrada} tokens de entrada, ~${g.saida} de saída, estimados) e ${g.locais} respostas do motor local (0 tokens).`;
  }
  function atualizarSeloIA() {
    const s = $("#selo-ia");
    const r = ia.config.rotas.padrao;
    if (ia.config.motorLocal === "sempre" || !r.provedor) { s.textContent = "motor local"; s.classList.remove("ligada"); s.title = "Sem IA: respostas do motor local (0 tokens). Ligue uma IA em IA › Provedores."; return; }
    const p = ia.provedor(r.provedor);
    s.textContent = (p.local ? "local · " : "") + (r.modelo || p.modelo || p.sugestao || p.nome);
    s.classList.add("ligada");
    s.title = `Rota padrão: ${p.nome}${r.modelo ? " · " + r.modelo : ""}` + (ia.config.motorLocal === "simples" ? " — o simples é respondido sem IA." : "");
  }
  function efeito(x, y, tipo) {
    const simbolos = { carinho: ["💗", "💕", "✨"], provocacao: ["💢", "❗", "💢"], cocegas: ["😆", "〰", "✨"], atencao: ["❔", "✨", "👀"], amor: ["💖", "💗", "💞"] }[tipo] || ["✨"];
    const caixa = $("#efeitos");
    for (let i = 0; i < 3; i++) {
      const s = el("span", { style: { left: x + (Math.random() - 0.5) * 40 + "px", top: y + (Math.random() - 0.5) * 20 + "px", animationDelay: i * 0.12 + "s" } }, simbolos[i % simbolos.length]);
      s.style.setProperty("--dx", (Math.random() - 0.5) * 60 + "px");
      caixa.append(s);
      setTimeout(() => s.remove(), 1600);
    }
  }
  function mostrarBalao(texto, { ficar = false } = {}) {
    const b = $("#balao");
    clearTimeout(balaoT);
    if (!texto) { b.hidden = true; return; }
    b.textContent = texto.length > 220 ? "…" + texto.slice(-220) : texto;
    b.hidden = false;
    if (!ficar) balaoT = setTimeout(() => { if (!voz.falando() && !respondendo) b.hidden = true; }, 6000);
  }
  function agendarNeutra() {
    clearTimeout(voltarNeutraT);
    voltarNeutraT = setTimeout(() => {
      if (respondendo || voz.falando()) { agendarNeutra(); return; }
      const a = est ? est.afeto || 0 : 0;
      palco.definirEmocao(a >= 40 ? "feliz" : a <= -30 ? "brava" : "neutra", a >= 40 ? 0.35 : a <= -30 ? 0.3 : 1);
    }, 14000);
  }

  // ── Mensagens na tela ────────────────────────────────────────────────

  let ultimoDia = "";
  function separadorDia(data) {
    const d = new Date(data).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    if (d !== ultimoDia) { ultimoDia = d; listaMsgs.append(el("div", { class: "separador-dia" }, d)); }
  }
  function desenharMsg(m) {
    separadorDia(m.data || Date.now());
    if (m.papel === "marco") { const e = el("div", { class: "msg sistema" }, "— nova conversa —"); listaMsgs.append(e); return e; }
    if (m.papel === "toque") { const e = el("div", { class: "msg toque" }, m.texto); listaMsgs.append(e); return e; }
    const corpo = el("span", { class: "t" }, m.texto);
    const info = el("span", { class: "info" }, hora(m.data || Date.now()) + (m.emocao && m.papel === "ela" ? " · " + ((C.EMOCOES[m.emocao] || {}).nome || m.emocao) : "") + (m.rota ? " · " + rotulo(m.rota) : ""));
    const e = el("div", { class: "msg " + m.papel }, corpo, info);
    if (m.papel === "ela") e.append(el("button", { class: "lnux-botao icone pequeno plano repetir", title: "Falar de novo", "aria-label": "Falar de novo", html: LNUX.icone("volume"),
      onclick: () => { voz.destravar(); voz.parar(); voz.falar(corpo.textContent, m.emocao); } }));
    listaMsgs.append(e);
    return e;
  }
  function avisoNaConversa(texto, tipo = "sistema") { const e = el("div", { class: "msg " + tipo }, texto); listaMsgs.append(e); rolarFim(); return e; }

  async function desenharHistorico() {
    listaMsgs.replaceChildren();
    ultimoDia = "";
    if (!atual) return;
    const msgs = await mem.recentes(atual.id, 80);
    for (const m of msgs) desenharMsg(m);
    rolarFim();
  }

  // ── Responder ────────────────────────────────────────────────────────

  /**
   * Toca uma resposta (da IA ao vivo ou pronta): mostra, mexe o rosto e o corpo e fala frase por frase.
   * fonte: async (aoPedaco) => void. Devolve {texto, emocao}.
   */
  async function tocarResposta(fonte, { papel = "ela", falar = true, rota = "" } = {}) {
    const bolha = desenharMsg({ papel, texto: "", data: Date.now() });
    const corpo = bolha.querySelector(".t");
    let emocao = null;
    const leitor = new C.LeitorDeFala((e) => {
      if (e.tipo === "emocao") { emocao = e.nome; palco.definirEmocao(e.nome); $("#chip-emocao").textContent = C.EMOCOES[e.nome].nome; }
      else if (e.tipo === "gesto") palco.gesto(e.nome);
      else if (e.tipo === "texto") { corpo.textContent += e.texto; mostrarBalao(corpo.textContent, { ficar: true }); rolarFim(); }
      else if (e.tipo === "acao") corpo.append(el("span", { class: "acao" }, "*" + e.texto + "* "));
      else if (e.tipo === "frase" && falar) voz.falar(e.texto, e.emocao || emocao || "neutra");
    });
    respondendo = true;
    $("#digitando").hidden = false;
    try {
      await fonte((pedaco) => { $("#digitando").hidden = true; leitor.empurrar(pedaco); });
    } finally {
      respondendo = false;
      $("#digitando").hidden = true;
    }
    const texto = leitor.fim();
    corpo.textContent = texto;
    if (!leitor.viuMarca) { emocao = C.sentimento(texto); palco.definirEmocao(emocao); }
    emocao = emocao || "neutra";
    $("#chip-emocao").textContent = C.EMOCOES[emocao].nome;
    bolha.querySelector(".info").textContent = hora(Date.now()) + " · " + C.EMOCOES[emocao].nome + (rota ? " · " + rotulo(rota) : "");
    mostrarBalao(texto);
    agendarNeutra();
    return { texto, emocao, bolha };
  }
  /** Uma resposta pronta (motor local ou fala de toque), "digitada" rapidinho. */
  const respostaPronta = (texto) => async (aoPedaco) => {
    const partes = texto.match(/\[[^\]]*\]|\S+\s*/g) || [texto];
    for (const p of partes) { aoPedaco(p); await LNUX.esperar(p.startsWith("[") ? 0 : 18); }
  };

  /** Contexto para a IA: as últimas trocas desde o último "nova conversa". */
  async function trocasRecentes(n) {
    const msgs = await mem.recentes(atual.id, n * 2 + 6);
    const i = msgs.map((m) => m.papel).lastIndexOf("marco");
    return msgs.slice(i + 1).filter((m) => m.papel !== "sistema").slice(-n * 2)
      .map((m) => (m.papel === "toque" ? { ...m, papel: "eu", texto: `(${m.descricao || m.texto})` } : m));
  }

  async function enviar(texto) {
    texto = texto.trim();
    if (jogando()) { enviarParaSala(texto); return; } // jogar: a caixa de texto fala com as pessoas da sala (não há chat bot)
    if (!texto || !atual) return;
    voz.destravar();
    voz.parar();
    if (pedido) pedido.abort();
    campo.value = "";
    ajustarCampo();
    const msg = { papel: "eu", texto, data: Date.now() };
    desenharMsg(msg);
    rolarFim();
    msg.id = await mem.adicionar(atual.id, msg);
    const fatos = mem.analisarLocal(est, msg);
    if (fatos.length) salvarEstado();
    novasDesdeAnalise++;
    palco.olharPara(null);
    const ctxLocal = { nome: nomeDela(), pessoa: est.pessoa, afeto: est.afeto, fatos: est.fatos };
    let local = await pedidoDeRoupa(texto);
    if (local) { /* já respondeu: trocou de roupa */ }
    else if (ia.config.motorLocal === "sempre" || !ia.configurada()) local = C.motorLocal(texto, { ...ctxLocal, forcar: true });
    else if (ia.config.motorLocal === "simples") local = C.motorLocal(texto, ctxLocal);
    if (local) {
      ia.gasto.locais++;
      const r = await tocarResposta(respostaPronta(local), { rota: "local" });
      await mem.adicionar(atual.id, { papel: "ela", texto: r.texto, emocao: r.emocao, rota: "local", data: Date.now() });
      atualizarGasto();
      return;
    }
    // pela IA
    const recentes = await trocasRecentes(ia.config.trocasRecentes);
    const idsRecentes = new Set(recentes.map((m) => m.id));
    const sistema = ia.sistema(atual, est, { fatos: mem.fatosParaContexto(est, texto), trechos: await mem.trechosParecidos(atual.id, texto, idsRecentes, 3) });
    const tokens = ia.estimarTokens(sistema) + recentes.reduce((s, m) => s + ia.estimarTokens(m.texto), 0);
    const rota = ia.rotear("conversa", tokens, texto);
    pedido = new AbortController();
    const meu = pedido;
    try {
      const r = await tocarResposta((aoPedaco) => ia.conversar({ provedor: rota.provedor, modelo: rota.modelo, sistema, mensagens: recentes, sinal: meu.signal, aoPedaco,
        maxTokens: rota.rota === "pensar" ? Math.max(ia.config.maxTokens, 700) : ia.config.maxTokens }), { rota: rota.rota });
      if (r.texto) await mem.adicionar(atual.id, { papel: "ela", texto: r.texto, emocao: r.emocao, rota: rota.rota, data: Date.now() });
      else r.bolha.remove();
    } catch (e) {
      if (e.name === "AbortError") return;
      console.error(e);
      listaMsgs.lastElementChild && listaMsgs.lastElementChild.classList.contains("ela") && !listaMsgs.lastElementChild.querySelector(".t").textContent && listaMsgs.lastElementChild.remove();
      avisoNaConversa(e.message, "erro");
      palco.definirEmocao("confusa");
      agendarNeutra();
    } finally {
      if (pedido === meu) pedido = null;
      atualizarGasto();
    }
    // análise da memória pela IA, de tempos em tempos (em segundo plano, rota leve)
    if (novasDesdeAnalise >= 16) { novasDesdeAnalise = 0; analisarMemoria(false); }
  }

  /** A IA da rota leve, para tarefas de fundo (memória, saudações). null se não houver. */
  function iaLeve() {
    if (!ia.configurada()) return null;
    const rota = ia.rotear("leve", 0);
    if (!rota.provedor) return null;
    return async (prompt, sistema = "Você analisa conversas e responde só o que foi pedido.") => (await ia.conversar({ provedor: rota.provedor, modelo: rota.modelo, sistema, mensagens: [{ papel: "eu", texto: prompt }], maxTokens: 600, temperatura: 0.2 })).texto;
  }
  async function analisarMemoria(avisar) {
    if (!atual) return;
    try {
      const r = await mem.reanalisar(atual.id, { ia: iaLeve(), nome: nomeDela() });
      est = r.estado;
      atualizarAfeto();
      atualizarGasto();
      if (avisar && r.fatosNovos.length) avisoNaConversa(`${nomeDela()} lembrou de ${r.fatosNovos.length} coisa${r.fatosNovos.length > 1 ? "s" : ""} sobre você${r.usouIA ? " (com a IA leve)" : ""}.`);
      return r;
    } catch (e) { console.warn("memória", e); return null; }
  }

  // ── Toques ───────────────────────────────────────────────────────────

  palco.on("toque", async (ev) => {
    if (!atual || jogando()) return; // jogar: a personagem é o avatar de quem joga, não uma companhia que reage
    voz.destravar();
    const r = C.reagirAoToque(ev, est.afeto || 0, atual.reacoes);
    palco.definirEmocao(r.emocao);
    palco.gesto(r.gesto);
    $("#chip-emocao").textContent = C.EMOCOES[r.emocao].nome;
    efeito(ev.x, ev.y, r.tipo === "carinho" && r.carinhos >= 5 ? "amor" : r.tipo);
    est.afeto = Math.max(-100, Math.min(100, (est.afeto || 0) + r.afeto));
    salvarEstado();
    const textoToque = `✋ ${C.GESTOS_TOQUE[ev.gesto]} · ${ev.nomeZona}`;
    desenharMsg({ papel: "toque", texto: textoToque, data: Date.now() });
    rolarFim();
    mem.adicionar(atual.id, { papel: "toque", texto: textoToque, descricao: "A pessoa " + r.descricao, data: Date.now() });
    agendarNeutra();
    // fala: não atropela uma resposta da conversa, e não fala a cada toque seguido
    const agora = Date.now();
    if (respondendo || (voz.falando() && agora - ultimaFalaToque > 4000) || agora - ultimaFalaToque < 2500) return;
    ultimaFalaToque = agora;
    voz.parar();
    const leve = ia.configurada() && ia.config.toquesComIA && agora - ultimoToqueIA > ia.config.intervaloToquesIA * 1000 ? ia.rotear("leve", 0) : null;
    if (leve && leve.provedor) {
      ultimoToqueIA = agora;
      const recentes = (await trocasRecentes(2)).slice(-4);
      recentes.push({ papel: "eu", texto: `(A pessoa ${r.descricao}. Reaja com uma frase curta. Sugestão de marcas: [${r.emocao}][${r.gesto}].)` });
      const sistema = ia.sistema(atual, est, { fatos: mem.fatosParaContexto(est, "", 3), curto: true });
      try {
        const resp = await tocarResposta((aoPedaco) => ia.conversar({ provedor: leve.provedor, modelo: leve.modelo, sistema, mensagens: recentes, maxTokens: 80, aoPedaco }), { rota: "leve" });
        if (resp.texto) { await mem.adicionar(atual.id, { papel: "ela", texto: resp.texto, emocao: resp.emocao, rota: "leve", data: Date.now() }); atualizarGasto(); return; }
      } catch (e) { console.warn("toque pela IA falhou; vai a fala pronta", e); listaMsgs.lastElementChild && listaMsgs.lastElementChild.classList.contains("ela") && listaMsgs.lastElementChild.remove(); }
    }
    ia.gasto.locais++;
    const resp = await tocarResposta(respostaPronta(r.fala), { rota: "local" });
    await mem.adicionar(atual.id, { papel: "ela", texto: resp.texto, emocao: resp.emocao, rota: "toque", data: Date.now() });
    atualizarGasto();
  });
  palco.on("carinho-continuo", (ev) => {
    if (!atual || jogando()) return;
    efeito(ev.x, ev.y, "carinho");
    est.afeto = Math.min(100, (est.afeto || 0) + 0.5);
    salvarEstado();
    if (ev.vezes % 4 === 0 && !voz.falando() && !respondendo) voz.falar(["Hmmm...", "Hehe...", "Que gostoso..."][Math.floor(Math.random() * 3)], palco.emocao);
  });
  palco.on("tocando", (z) => $("#palco").classList.toggle("tocando", !!z));
  palco.on("emocao", (nome) => { $("#chip-emocao").textContent = C.EMOCOES[nome].nome; desenharAtalhos(); });
  palco.on("enquadrado", () => desenharZonas());
  // texturas grandes demais para a placa de vídeo do aparelho (a personagem ficaria preta)
  let reduziuPorFalha = null;
  palco.on("preparando", (texto) => { $("#palco-carregando").textContent = texto; });
  palco.on("texturas-reduzidas", (r) => { reduziuPorFalha = r; $("#palco-carregando").textContent = `Texturas grandes demais para este aparelho; tentando com ${r.para} px...`; });
  palco.on("placa-perdida", () => LNUX.aviso("A placa de vídeo do aparelho reiniciou (pouca memória). Vou recarregar a personagem com texturas menores.", "alerta", 8000));
  palco.on("placa-voltou", () => {
    if (!atual) return;
    atual.qualidade = String(Math.max(1024, (palco.limiteUsado || 4096) / 2));
    C.salvarPersonagem(atual).catch(() => {});
    abrirPersonagem(atual.id, { saudar: false });
  });

  // a boca acompanha a voz
  voz.aoNivel = (n) => palco.falar(n);
  voz.aoErro = (e, item) => {
    if (voz.avisouErro) return;
    voz.avisouErro = true;
    avisoNaConversa("Voz: " + e.message + (item && item.cfg.provedor !== "navegador" ? " (falei com a voz do navegador)" : ""), "erro");
  };
  voz.aoTerminar = () => {
    agendarNeutra();
    if ($("#opcao-maos-livres").checked && !pararOuvir && atual) setTimeout(() => { if (!voz.falando() && !respondendo) ouvir(); }, 400);
  };

  // ── Atalhos de expressão e áreas de toque na tela ────────────────────

  function desenharAtalhos() {
    const barra = $("#atalhos");
    if (!atual || pref("atalhos", "1") !== "1" || !palco.expressoes.size) { barra.replaceChildren(); return; }
    const botoes = [...palco.expressoes].map(([nome, x]) => el("button", {
      type: "button", "aria-pressed": String(x.alvo > 0.5), class: x.emocao ? "da-emocao" : "", title: x.emocao ? "Ligada pela emoção (clique para fixar)" : "Ligar/desligar (como um atalho do VTube Studio)",
      onclick: () => { palco.alternarExpressao(nome); atual.ativas = palco.expressoesAtivas(); salvarPersonagem(); desenharAtalhos(); },
    }, nome));
    barra.replaceChildren(el("span", { class: "rotulo" }, "Expressões:"), ...botoes);
  }

  function desenharZonas(editor) {
    const svg = $("#zonas");
    svg.classList.toggle("visivel", mostrarZonas || !!editor);
    if (!(mostrarZonas || editor) || !palco.modelo) { svg.replaceChildren(); return; }
    const ns = "http://www.w3.org/2000/svg";
    const filhos = [];
    for (const z of palco.toques.zonas) {
      z.rets.forEach((r, i) => {
        const a = palco.deModelo(r[0], r[1]), b = palco.deModelo(r[2], r[3]);
        const ret = document.createElementNS(ns, "rect");
        Object.entries({ x: a.x, y: a.y, width: Math.max(4, b.x - a.x), height: Math.max(4, b.y - a.y), rx: 6 }).forEach(([k, v]) => ret.setAttribute(k, v));
        ret.dataset.zona = z.id; ret.dataset.i = i;
        if (editor && editor.escolhida === z.id) ret.classList.add("escolhida");
        filhos.push(ret);
        if (i === 0) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", a.x + 4); t.setAttribute("y", a.y + 14); t.textContent = z.nome; filhos.push(t); }
        if (editor && editor.escolhida === z.id) {
          const alca = document.createElementNS(ns, "rect");
          Object.entries({ x: b.x - 7, y: b.y - 7, width: 12, height: 12, class: "alca" }).forEach(([k, v]) => alca.setAttribute(k, v));
          alca.dataset.zona = z.id; alca.dataset.i = i; alca.dataset.alca = "1";
          filhos.push(alca);
        }
      });
    }
    svg.replaceChildren(...filhos);
  }

  // ── Abrir personagem ─────────────────────────────────────────────────

  let pronto = false; // fim da abertura (histórico, reanálise e saudação) — os testes esperam por ele
  async function abrirPersonagem(id, { saudar = true } = {}) {
    pronto = false;
    $("#palco-carregando").textContent = "Carregando...";
    $("#palco-carregando").hidden = false;
    try {
      voz.parar();
      if (pedido) pedido.abort();
      palco.descarregar(); // tira a anterior antes de ler a nova (o desenho e a leitura do ZIP disputam o aparelho)
      const p = await C.lerPersonagem(id);
      if (!p) throw new Error("Essa personagem não está mais guardada.");
      if (p.tipo !== "vrm" && !live2d) { await mostrarVazio(); LNUX.aviso("Falta o núcleo do Live2D (veja o aviso na tela). Personagens VRoid (.vrm) abrem sem ele.", "alerta"); return; }
      await usarPalco(p.tipo === "vrm" ? "vrm" : "live2d");
      reduziuPorFalha = null;
      await palco.carregar(p);
      if (reduziuPorFalha) {
        // guarda o tamanho que funcionou, para não tentar de novo da próxima vez
        p.qualidade = String(palco.limiteUsado);
        C.salvarPersonagem(p).catch(() => {});
        LNUX.aviso(`As texturas de ${p.perfil.nome} eram grandes demais para a placa de vídeo deste aparelho (a personagem ficaria preta). Usei ${palco.limiteUsado} px — dá para mudar em Exibir › Qualidade das texturas.`, "alerta", 12000);
      }
      atual = p;
      gravarPref("atual", id);
      voz.daPersonagem = p.voz || null;
      $("#palco-vazio").hidden = true;
      palcoArea.classList.remove("sem-personagem");
      $("#titulo-doc").textContent = p.perfil.nome;
      $("#conversa-titulo").textContent = "Conversa com " + p.perfil.nome;
      campo.placeholder = `Escreva para ${p.perfil.nome}...`;
      for (const b of $("#enquadramento").children) b.setAttribute("aria-pressed", String(b.dataset.modo === palco.enquadramento.modo));
      desenharAtalhos();
      desenharZonas();
      atualizarChipRoupa();
      atualizarChipMovimento();
      await estudio.aoAbrirPersonagem(); // o cenário e os movimentos de andar em uso (só personagens VRoid)
      if (jogando()) { est = { afeto: 0, fatos: [], pessoa: "" }; return; } // jogar: sem memória, saudação nem chat bot
      est = await mem.estado(id);
      atualizarAfeto();
      await desenharHistorico();
      const { passou, estado } = await mem.visitar(id);
      est = estado;
      // reanalisa o que ficou das conversas anteriores (local sempre; IA leve se houver conversa nova suficiente)
      const r = await analisarMemoria(true);
      if (saudar) await saudacao(passou, r);
    } catch (e) {
      LNUX.erro(e);
      await mostrarVazio();
    } finally {
      $("#palco-carregando").hidden = true;
      pronto = true;
    }
  }

  async function saudacao(passou, analise) {
    if (!atual) return;
    const p = atual.perfil;
    const pessoa = est.pessoa ? ", " + est.pessoa : "";
    let fala = null;
    if (passou === null) fala = `[feliz][acenar] ${p.saudacao || "Oi!"}` + (est.pessoa ? "" : " [timida] Como você se chama?");
    else if (passou > 3 * 3600e3) {
      const leve = iaLeve();
      const plano = est.fatos.filter((f) => f.tipo === "plano").slice(-1)[0];
      if (leve && ia.config.toquesComIA) {
        try {
          const sistema = ia.sistema(atual, est, { fatos: mem.fatosParaContexto(est, plano ? plano.texto : "", 6), curto: true });
          const r = await tocarResposta((aoPedaco) => ia.conversar({ provedor: ia.rotear("leve", 0).provedor, modelo: ia.rotear("leve", 0).modelo, sistema, maxTokens: 90, aoPedaco,
            mensagens: [{ papel: "eu", texto: `(A pessoa voltou depois de ${C.tempoDesde(passou)}. Cumprimente com uma ou duas frases curtas${plano ? ", perguntando sobre isto: " + plano.texto : ", lembrando de algo que vocês conversaram"}.)` }] }), { rota: "leve" });
          if (r.texto) { await mem.adicionar(atual.id, { papel: "ela", texto: r.texto, emocao: r.emocao, rota: "leve", data: Date.now() }); atualizarGasto(); return; }
        } catch (e) { console.warn("saudação pela IA falhou", e); }
      }
      const dias = passou > 864e5 * 1.5;
      fala = dias ? `[animada][acenar] ${pessoa ? "Oi" + pessoa : "Oi"}! Faz ${C.tempoDesde(passou)} que a gente não conversa... [triste] fiquei com saudade.` : `[feliz][acenar] Voltou${pessoa}!`;
      if (plano) fala += ` [pensativa] E aí... ${plano.texto.replace(/^Disse em [\d/]+ que ia /, "como foi ").replace(/^Tinha /, "como foi ").replace(/\s*\(contou em [\d/]+\)/, "").replace(/\.$/, "")}?`;
    }
    if (!fala) return;
    ia.gasto.locais++;
    const r = await tocarResposta(respostaPronta(fala), { rota: "local", falar: voz.config.falar && !!(navigator.userActivation && navigator.userActivation.hasBeenActive) });
    await mem.adicionar(atual.id, { papel: "ela", texto: r.texto, emocao: r.emocao, rota: "local", data: Date.now() });
    atualizarGasto();
  }

  async function mostrarVazio() {
    atual = null;
    estudio.fechar();
    captura.desligar();
    atualizarChipMovimento();
    palco.descarregar();
    $("#palco-vazio").hidden = false;
    palcoArea.classList.add("sem-personagem");
    $("#titulo-doc").textContent = "Sem personagem";
    $("#conversa-titulo").textContent = "Conversa";
    $("#atalhos").replaceChildren();
    $("#zonas").replaceChildren();
    listaMsgs.replaceChildren(el("div", { class: "msg sistema" }, jogando() ? "Modo de jogar: crie uma sala ou entre numa pelo link (menu Sala). As mensagens das pessoas da sala aparecem aqui." : "Importe uma personagem para conversar."));
    const lista = await C.listarPersonagens();
    const cartao = $("#palco-vazio .cartao");
    cartao.querySelector(".lista-personagens") && cartao.querySelector(".lista-personagens").remove();
    if (lista.length) cartao.querySelector(".botoes").after(el("div", { class: "lista-personagens" }, lista.map((p) => cartaoPersonagem(p, () => abrirPersonagem(p.id)))));
    const aviso = $("#nucleo-aviso");
    aviso.hidden = !!live2d;
    if (!live2d) desenharAvisoNucleo(aviso);
  }

  function cartaoPersonagem(p, aoClicar, atualId) {
    const img = p.icone ? el("img", { src: URL.createObjectURL(p.icone), alt: "" }) : el("span", { class: "sem-icone" }, (p.nome || "?")[0]);
    return el("button", { type: "button", class: "cartao-personagem" + (atualId === p.id ? " atual" : ""), onclick: aoClicar }, img, el("span", {}, p.nome));
  }

  // ── Núcleo do Live2D ─────────────────────────────────────────────────

  function desenharAvisoNucleo(caixa) {
    const escolher = el("input", { type: "file", accept: ".js", style: { display: "none" } });
    escolher.addEventListener("change", async () => {
      const f = escolher.files[0];
      if (!f) return;
      await instalarNucleo(f);
    });
    caixa.replaceChildren(
      el("b", {}, "Falta o núcleo do Live2D (Cubism Core)."),
      el("p", { style: { margin: "6px 0 0" } }, "Ele só é preciso para personagens Live2D (VTube Studio). Personagens VRoid (.vrm) abrem sem ele."),
      el("p", { style: { margin: "6px 0 0" } }, "Ele é da Live2D Inc. e não pode vir junto com o app. A Companhia tenta baixar do site oficial; se não der (sem internet), baixe o ",
        el("a", { href: "https://www.live2d.com/en/sdk/download/web/", target: "_blank", rel: "noopener" }, "Cubism SDK for Web"),
        " e escolha o arquivo ", el("code", {}, "live2dcubismcore.min.js"), ". Usar o núcleo significa aceitar a licença da Live2D."),
      el("div", { class: "botoes" },
        el("button", { class: "lnux-botao primario pequeno", type: "button", onclick: () => tentarNucleo(true) }, LNUX.ponte.disponivel ? "Baixar pela ponte" : "Tentar de novo"),
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => escolher.click() }, "Escolher o arquivo..."), escolher));
  }
  async function instalarNucleo(arquivo) {
    const texto = await arquivo.slice(0, 2000000).text();
    if (!/Live2DCubismCore/.test(texto)) { LNUX.aviso("Esse arquivo não é o live2dcubismcore.min.js.", "erro"); return; }
    if (LNUX.ponte.disponivel) { try { await LNUX.ponte.pedir("PUT", "live2d/core", { corpo: arquivo, tipo: "text/javascript" }); } catch (e) { console.warn(e); } }
    await LNUX.guardado.gravar("companhia:nucleo", new Blob([await arquivo.arrayBuffer()], { type: "text/javascript" }));
    LNUX.aviso("Núcleo do Live2D guardado neste aparelho.", "ok");
    await tentarNucleo(false);
  }
  async function tentarNucleo(baixar) {
    if (baixar && LNUX.ponte.disponivel && !live2d) {
      try { await LNUX.ponte.pedir("POST", "live2d/core", { json: {} }); } catch (e) { LNUX.aviso("A ponte não conseguiu baixar: " + e.message, "alerta"); }
    }
    try { live2d = await C.prepararLive2D(); } catch (e) { live2d = null; LNUX.erro(e); }
    if (live2d === "oficial" && LNUX.ponte.disponivel) LNUX.ponte.pedir("POST", "live2d/core", { json: {} }).catch(() => {}); // guarda para usar sem internet
    if (live2d) $("#nucleo-aviso").hidden = true;
    const id = pref("atual", "");
    const lista = await C.listarPersonagens();
    const pode = lista.filter((p) => live2d || p.tipo === "vrm"); // sem o núcleo, só as personagens VRoid abrem
    const escolhido = pode.find((p) => p.id === id) || pode[0];
    if (escolhido) await abrirPersonagem(escolhido.id); else await mostrarVazio();
  }

  // ── Importar ─────────────────────────────────────────────────────────

  async function importar(origem) {
    let arquivos = null, zip = null;
    palco.pausar(); // o desenho pesa: sem ele, o ZIP abre bem mais rápido
    try {
      if (origem === "pasta") {
        const files = await C.escolherPasta();
        if (!files.length) return;
        arquivos = C.pacoteDaPasta(files);
      } else {
        const avatar = origem === "avatar";
        const [a] = await LNUX.arquivos.abrir({ titulo: avatar ? "Importar avatar do Unity (.unitypackage, .fbx, .glb ou um ZIP com eles)" : "Importar personagem (ZIP, .vrm, .unitypackage ou .model3.json)",
          aceitar: avatar ? C.avatar.ACEITAR + ",.zip" : (LNUX.ponte.disponivel ? ".zip,.vrm,.json," : ".zip,.vrm,") + C.avatar.ACEITAR });
        if (!a) return;
        if (/\.json$/i.test(a.nome)) {
          if (a.origem !== "ponte") throw new Error("Pelo navegador, escolha o ZIP ou use Importar pasta.");
          const prog = LNUX.progresso("Lendo a pasta do modelo");
          try { arquivos = await C.pacoteDaPonte(a.caminho, (f, n) => prog.definir(f, n)); } finally { prog.fechar(); }
        } else ({ arquivos, zip } = await pacoteDoArquivo(a.nome, await a.blob()));
      }
      palco.continuar();
      if (!arquivos) return; // desistiu na conversão do avatar
      await importarPacote(arquivos, zip);
    } catch (e) { erroAoImportar(e); } finally { palco.continuar(); }
  }
  /**
   * Um arquivo escolhido ou solto → o pacote da personagem (Map caminho → Blob). ZIP e .vrm como sempre; o avatar de
   * um .unitypackage (ou de um ZIP com ele dentro, como os do BOOTH), um .fbx ou um .glb com esqueleto é convertido
   * para .vrm antes. arquivos: null quando a pessoa desiste no meio.
   */
  async function pacoteDoArquivo(nome, blob, { avatar = true } = {}) {
    if (/\.vrm$/i.test(nome)) return { arquivos: new Map([[nome, blob]]), zip: null };
    if (/\.unitypackage$/i.test(nome)) return { arquivos: await pacoteDoAvatar(await C.lerUnityPackage(blob), LNUX.nomeSemExtensao(nome)), zip: null };
    if (C.avatar.MODELO.test(nome)) {
      // um .glb pode já ser um VRM (só com o nome trocado)
      if (/\.glb$/i.test(nome)) { try { await C.lerMetaVRM(blob); return { arquivos: new Map([[nome.replace(/\.glb$/i, ".vrm"), blob]]), zip: null }; } catch (e) { /* um .glb comum: converte */ } }
      return { arquivos: await pacoteDoAvatar(new Map([[nome, blob]]), LNUX.nomeSemExtensao(nome)), zip: null };
    }
    const arquivos = await C.pacoteDoZip(blob), nomes = [...arquivos.keys()].filter((n) => !/(^|\/)(__MACOSX|\.)/.test(n));
    if (avatar && !nomes.some((n) => /\.(vrm|model3\.json|vroidcustomitem|moc)$/i.test(n) || /(^|\/)model\.json$/i.test(n))) {
      const pacote = nomes.filter((n) => /\.unitypackage$/i.test(n)).sort((a, b) => arquivos.get(b).size - arquivos.get(a).size)[0];
      if (pacote) return { arquivos: await pacoteDoAvatar(await C.lerUnityPackage(arquivos.get(pacote)), LNUX.nomeSemExtensao(pacote.split("/").pop())), zip: null };
      if (nomes.some((n) => C.avatar.MODELO.test(n))) return { arquivos: await pacoteDoAvatar(arquivos, LNUX.nomeSemExtensao(nome)), zip: null };
    }
    return { arquivos, zip: blob };
  }
  /**
   * O avatar de um pacote do Unity (ou um .fbx/.glb com as texturas ao lado) → Map com o .vrm pronto para importar.
   * Se o pacote já traz um .vrm, é ele. Senão escolhe o modelo, converte (js/avatar.js) e mostra o que saiu.
   */
  async function pacoteDoAvatar(arquivos, nome) {
    const nomes = [...arquivos.keys()].filter((n) => !/(^|\/)(__MACOSX|\.)/.test(n));
    const vrms = nomes.filter((n) => /\.vrm$/i.test(n));
    if (vrms.length) return new Map(vrms.map((n) => [n.split("/").pop(), arquivos.get(n)]));
    const candidatos = C.avatar.candidatos(arquivos);
    if (!candidatos.length) {
      throw new Error("Esse pacote não tem um modelo de avatar (.fbx, .glb ou .vrm)" + (nomes.some((n) => /\.(unity|prefab|anim|controller|cs|shader)$/i.test(n)) ? ": ele traz só cenas, animações, shaders ou scripts do Unity." : ".") +
        (nomes.length ? ` Veio: ${nomes.slice(0, 6).map((n) => n.split("/").pop()).join(", ")}${nomes.length > 6 ? "..." : ""}.` : ""));
    }
    let principal = candidatos[0];
    if (candidatos.length > 1) {
      const s = el("select", { class: "lnux-selecao", size: Math.min(8, candidatos.length), style: { width: "100%" } }, candidatos.map((c, i) => el("option", { value: c, selected: i === 0 }, `${c.split("/").pop()} (${LNUX.bytes(arquivos.get(c).size)})`)));
      const r = await LNUX.dialogo({ titulo: "Qual é o avatar?", corpo: el("div", { class: "ajustes" }, el("p", { style: { margin: 0 } }, "O pacote tem mais de um modelo. O primeiro costuma ser o avatar; os outros podem ser acessórios ou animações."), s),
        botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Converter", primario: true, valor: () => s.value }] });
      if (!r) return null;
      principal = r;
    }
    const prog = LNUX.progresso("Convertendo o avatar para VRM");
    let r;
    try {
      await LNUX.esperar(40); // a janela aparece antes do trabalho pesado
      r = await C.avatar.paraVRM(arquivos, principal, { nome: candidatos.length > 1 ? LNUX.nomeSemExtensao(principal.split("/").pop()) : nome, aoProgresso: (f, t) => prog.definir(f, t) });
    } finally { prog.fechar(); }
    const x = r.resumo, item = (...t) => el("li", {}, ...t);
    const ok = await LNUX.dialogo({ titulo: `Avatar convertido: ${r.nome}`, largo: true,
      corpo: el("div", { class: "ajustes", id: "avatar-convertido" },
        el("ul", { style: { margin: 0, paddingLeft: "20px", display: "grid", gap: "4px" } },
          item(el("b", {}, "Esqueleto: "), `${x.ossos} ossos reconhecidos ${x.comoMapeou}${x.dedos ? `, com os dedos (${x.dedos})` : ", sem os dedos"}${x.olhos ? " e os olhos" : ""}; ${x.altura.toLocaleString("pt-BR")} m de altura` + (x.poseEmT ? `; braços e pernas postos na pose em T (${x.poseEmT}°)` : "") + "."),
          item(el("b", {}, "Rosto: "), x.expressoes.length ? `${x.expressoes.length} expressões (${x.expressoes.join(", ")})${x.atalhos.length ? ` e ${x.atalhos.length} atalhos (${x.atalhos.join(", ")})` : ""}, das ${x.formas} formas do modelo.` : x.formas ? `nenhuma das ${x.formas} formas do rosto tem um nome que eu conheça: ela não vai mexer a boca nem piscar.` : "o modelo não tem formas de rosto: ela não vai mexer a boca nem piscar."),
          item(el("b", {}, "Materiais: "), `${x.comTextura} de ${x.materiais} com textura${x.doUnity ? ` (${x.doUnity} pelos materiais do Unity)` : ""}, no estilo de desenho das personagens VRoid.`),
          item(el("b", {}, "Balanço: "), x.balanco.length ? x.balanco.join(", ") + "." : "nenhum osso de cabelo, saia ou rabo reconhecido pelo nome."),
          item(el("b", {}, "Arquivo: "), `${LNUX.bytes(x.tamanho)}, ${x.triangulos.toLocaleString("pt-BR")} triângulos.`)),
        r.avisos.length ? el("div", { class: "fraco" }, r.avisos.map((a) => el("p", { style: { margin: "4px 0 0" } }, "⚠ " + a))) : null,
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Não vêm: os efeitos dos shaders do Unity (lilToon, Poiyomi...), as físicas do VRChat e as peças ligadas e desligadas pelo prefab (esconda as que sobrarem em Personagem › Roupas). " +
          "O pacote não diz a licença: avatares comprados quase nunca deixam redistribuir. A personagem fica só neste aparelho, marcada como \"não redistribuir\"; confira os termos de quem fez antes de mostrar para outras pessoas.")),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Importar", primario: true, valor: true }] });
    return ok ? new Map([[r.nome.replace(/[\\/:*?"<>|]/g, "_") + ".vrm", r.vrm]]) : null;
  }
  async function importarPacote(arquivos, zip) {
    pronto = false;
    const info = await C.lerPacote(arquivos);
    if (info.protegido && !info.convertido && !(await LNUX.confirmar("Modelo com licença", `O autor de "${info.nome}" não deixa redistribuir o modelo${info.tipo === "vrm" ? " (licença gravada no .vrm)" : " (VTube Studio)"}. Ele fica só neste aparelho; não compartilhe o ZIP exportado. Importar?`, { rotulo: "Importar" }))) return;
    const p = await C.importarPacote(arquivos, zip);
    if (info.tipo === "vrm") LNUX.aviso(`${p.nome} importada (VRoid): ${p.roupas.length} roupa${p.roupas.length > 1 ? "s" : ""}${p.variacoes.length ? `, ${p.variacoes.length} variações de textura` : ""}. Troque em Personagem › Roupas.`, "ok");
    else LNUX.aviso(`${p.nome} importada: ${info.expressoes.length} expressões${info.idle ? ", movimento parado" : ""}${info.vtube ? ", ajustes do VTube Studio" : ""}.`, "ok");
    await abrirPersonagem(p.id);
  }
  /** Erros de importação: o item de roupa do VRoid Studio vira variações de textura da personagem VRoid aberta. */
  async function erroAoImportar(e) {
    if (!e.itemVroid) { LNUX.erro(e); return; }
    const n = (e.variacoes || []).length;
    if (atual && atual.tipo === "vrm" && n) {
      const r = await LNUX.dialogo({ titulo: "Item de roupa do VRoid Studio", corpo: e.message + `\n\nO pacote tem ${n} jogo${n > 1 ? "s" : ""} de texturas (${e.variacoes.map((v) => v.nome).join(", ")}). Guardar como variações de cor de ${atual.perfil.nome}?`,
        botoes: [{ rotulo: "Agora não", valor: false }, { rotulo: "Guardar as texturas", primario: true, valor: true }] });
      if (r) {
        atual.variacoes = [...(atual.variacoes || []), ...e.variacoes];
        await C.salvarPersonagem(atual);
        LNUX.aviso(`${n} variações guardadas. Use em Personagem › Roupas (Textura de cada peça).`, "ok");
      }
      return;
    }
    LNUX.dialogo({ titulo: "Item de roupa do VRoid Studio", corpo: e.message, botoes: [{ rotulo: "Entendi", primario: true, valor: true }] });
  }
  LNUX.soltarArquivos(palcoArea, async (arqs) => {
    const noPalco3D = !!(atual && atual.tipo === "vrm");
    let a = arqs.find((x) => /\.(zip|vrm)$/i.test(x.nome));
    const outros = arqs.filter((x) => /\.(vrma|bvh|unitypackage|vrcw)$/i.test(x.nome) || C.conversor.MODELO.test(x.nome));
    // um pacote do Unity: se tem cara de avatar (ou não há personagem 3D aberta para ele ser cenário), vira personagem
    const pacote = !a && arqs.find((x) => /\.unitypackage$/i.test(x.nome));
    if (pacote) {
      try {
        const dentro = await C.lerUnityPackage(await pacote.blob());
        if (!noPalco3D || C.avatar.pareceAvatar(dentro)) {
          const convertido = await pacoteDoAvatar(dentro, LNUX.nomeSemExtensao(pacote.nome));
          if (convertido) await importarPacote(convertido, null);
          return;
        }
      } catch (e) { if (!noPalco3D || e.semEsqueleto !== true) { erroAoImportar(e); return; } }
    }
    if (outros.length && noPalco3D) { soltarNoPalco3D(outros).catch(LNUX.erro); return; }
    if (!a) a = arqs.find((x) => C.avatar.MODELO.test(x.nome)); // sem uma personagem 3D aberta, um .fbx ou .glb solto é um avatar
    if (!a) { LNUX.aviso(outros.length ? "Movimentos e cenários são para personagens VRoid (.vrm): abra uma primeiro." : "Solte o ZIP do modelo, o arquivo .vrm ou o avatar (.unitypackage, .fbx) — ou use Personagem › Importar pasta.", "alerta"); return; }
    palco.pausar();
    let arquivos, zip = null;
    try { ({ arquivos, zip } = await pacoteDoArquivo(a.nome, await a.blob(), { avatar: !noPalco3D })); }
    catch (e) { palco.continuar(); erroAoImportar(e); return; }
    palco.continuar();
    if (!arquivos) return;
    // um ZIP só de movimentos (ou só com um cenário) solto com uma personagem VRoid aberta
    const nomes = [...arquivos.keys()];
    if (zip && atual && atual.tipo === "vrm" && !nomes.some((n) => /\.(vrm|model3\.json|vroidcustomitem)$/i.test(n))) {
      if (nomes.some((n) => /\.(vrma|bvh)$/i.test(n)) || (nomes.some((n) => /\.fbx$/i.test(n)) && !nomes.some((n) => /\.(png|jpe?g)$/i.test(n)))) { estudio.receberMovimentos(new Map([[a.nome, zip]])).catch(LNUX.erro); return; }
      if (nomes.some((n) => C.conversor.MODELO.test(n))) { estudio.receberMapa(new Map([[a.nome, zip]]), LNUX.nomeSemExtensao(a.nome)).catch(LNUX.erro); return; }
    }
    try { await importarPacote(arquivos, zip); } catch (e) { erroAoImportar(e); }
  });
  /** Arquivos soltos sobre uma personagem VRoid: movimentos (.vrma, .bvh) ou cenário; .fbx e .glb podem ser os dois. */
  async function soltarNoPalco3D(arqs) {
    const mapa = new Map();
    for (const x of arqs) mapa.set(x.nome, await x.blob());
    const nomes = [...mapa.keys()];
    let destino = nomes.every((n) => /\.(vrma|bvh)$/i.test(n)) ? "movimento" : nomes.some((n) => /\.(blend|obj|dae|stl|ply|3ds|3mf|usdz|unitypackage|vrcw)$/i.test(n)) ? "cenario" : null;
    if (!destino) destino = await LNUX.dialogo({ titulo: "O que é esse arquivo?", corpo: `${nomes.join(", ")}: um .fbx ou .glb pode ser um movimento (uma animação para a personagem), um cenário (um mapa para ela andar) ou outra personagem (um avatar com esqueleto, convertido para VRM).`,
      botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Personagem", valor: "personagem" }, { rotulo: "Cenário", valor: "cenario" }, { rotulo: "Movimento", primario: true, valor: "movimento" }] });
    if (destino === "personagem") { const convertido = await pacoteDoAvatar(mapa, LNUX.nomeSemExtensao(nomes.find((n) => C.avatar.MODELO.test(n)) || nomes[0])); if (convertido) await importarPacote(convertido, null); }
    else if (destino === "movimento") await estudio.receberMovimentos(mapa);
    else if (destino === "cenario") await estudio.receberMapa(mapa, LNUX.nomeSemExtensao(nomes[0]));
  }

  // ── Roupas ───────────────────────────────────────────────────────────

  const PECA_LIVE2D = /cloth|outfit|costume|dress|hat|coat|jacket|skirt|roupa|chap[eé]u|衣|服|帽/i;
  const roupaAtual = () => (atual && atual.tipo === "vrm" ? atual.roupas.find((r) => r.id === atual.roupaAtual) || atual.roupas[0] : null);
  function atualizarChipRoupa() {
    const b = $("#chip-roupa");
    const tem = atual && (atual.tipo === "vrm" ? atual.roupas.length > 1 || palco.pecas.length : [...palco.expressoes.keys()].some((n) => PECA_LIVE2D.test(n)));
    b.hidden = !tem;
    const r = roupaAtual();
    b.textContent = "👗 " + (r ? r.nome : "Roupa");
  }
  /** Veste outra roupa (outro .vrm da mesma personagem), sem perder a conversa. */
  async function vestir(roupaId) {
    if (!atual || atual.tipo !== "vrm" || roupaId === atual.roupaAtual) return;
    atual.roupaAtual = roupaId;
    $("#palco-carregando").textContent = "Trocando de roupa...";
    $("#palco-carregando").hidden = false;
    try {
      const emocao = palco.emocao;
      await palco.carregar(atual, { roupaId });
      palco.definirEmocao(emocao);
      await C.salvarPersonagem(atual);
      desenharAtalhos();
      atualizarChipRoupa();
    } catch (e) { LNUX.erro(e); } finally { $("#palco-carregando").hidden = true; }
  }
  async function adicionarRoupa() {
    if (!atual || atual.tipo !== "vrm") return;
    const arqs = await LNUX.arquivos.abrir({ titulo: "Adicionar roupa (outro .vrm da mesma personagem)", aceitar: ".vrm", multiplos: true });
    for (const a of arqs) {
      try { const r = await C.adicionarRoupa(atual, await a.blob(), LNUX.nomeSemExtensao(a.nome)); LNUX.aviso(`Roupa "${r.nome}" adicionada.`, "ok"); }
      catch (e) { LNUX.erro(e); }
    }
    atualizarChipRoupa();
  }
  function menuRoupa() {
    if (!atual) return;
    const r = $("#chip-roupa").getBoundingClientRect();
    const itens = atual.tipo === "vrm"
      ? [...atual.roupas.map((x) => ({ rotulo: x.nome, marcado: () => x.id === atual.roupaAtual, acao: () => vestir(x.id) })), "-",
        { rotulo: "Peças, cores e mais roupas...", acao: janelaRoupas }]
      : [...[...palco.expressoes.keys()].filter((n) => PECA_LIVE2D.test(n)).map((n) => ({ rotulo: n, marcado: () => palco.expressoes.get(n).alvo > 0.5,
        acao: () => { palco.alternarExpressao(n); atual.ativas = palco.expressoesAtivas(); salvarPersonagem(); desenharAtalhos(); } })), "-", { rotulo: "Roupas...", acao: janelaRoupas }];
    LNUX.abrirMenu(itens, r.left, r.bottom + 4, $("#chip-roupa"));
  }
  /** Personagem › Roupas: trocar de roupa, esconder peças, trocar a textura de uma peça, acrescentar roupas. */
  async function janelaRoupas() {
    if (!atual) return;
    const corpo = el("div", { class: "ajustes" });
    if (atual.tipo !== "vrm") {
      const pecas = [...palco.expressoes.keys()].filter((n) => PECA_LIVE2D.test(n));
      corpo.append(el("p", { class: "fraco", style: { margin: 0 } }, "Nos modelos Live2D, as roupas e acessórios que o autor separou ficam nas expressões (como os atalhos do VTube Studio)."),
        ...(pecas.length ? pecas.map((n) => { const c = el("input", { type: "checkbox", checked: palco.expressoes.get(n).alvo > 0.5 });
          c.addEventListener("change", () => { palco.alternarExpressao(n, c.checked); atual.ativas = palco.expressoesAtivas(); salvarPersonagem(); desenharAtalhos(); });
          return el("label", { class: "lnux-alternar" }, c, n); }) : [el("p", {}, "Este modelo não tem expressões de roupa. Todas as expressões ficam nos botões embaixo da personagem.")]));
      await LNUX.dialogo({ titulo: "Roupas de " + atual.perfil.nome, corpo, largo: true, botoes: [{ rotulo: "Fechar", primario: true, valor: null }] });
      return;
    }
    const salvar = () => C.salvarPersonagem(atual).catch(LNUX.erro);
    const desenhar = () => {
      const r = roupaAtual();
      const linhasRoupas = atual.roupas.map((x) => {
        const nome = el("input", { class: "lnux-entrada", value: x.nome, "aria-label": "Nome da roupa" });
        nome.addEventListener("change", () => { x.nome = nome.value.trim() || x.nome; salvar(); atualizarChipRoupa(); });
        const vestindo = x.id === atual.roupaAtual;
        return el("div", { class: "linha-roupa" + (vestindo ? " atual" : "") },
          el("button", { class: "lnux-botao pequeno" + (vestindo ? " primario" : ""), type: "button", disabled: vestindo, onclick: async () => { await vestir(x.id); desenhar(); } }, vestindo ? "Vestindo" : "Vestir"),
          nome,
          atual.roupas.length > 1 ? el("button", { class: "lnux-botao pequeno perigo", type: "button", onclick: async () => {
            if (!(await LNUX.confirmar("Tirar roupa da lista", `Tirar "${x.nome}" desta personagem?`, { rotulo: "Tirar", perigo: true }))) return;
            atual.roupas = atual.roupas.filter((y) => y !== x);
            if (vestindo) await vestir(atual.roupas[0].id);
            await salvar(); atualizarChipRoupa(); desenhar();
          } }, "Tirar") : null);
      });
      const opcoesTextura = [["", "Textura original"], ["arquivo", "Escolher imagem..."],
        ...(atual.variacoes || []).flatMap((v, i) => Object.keys(v.imagens).map((n) => [`v:${i}:${n}`, `${v.nome} / ${n}`]))];
      const linhasPecas = palco.pecas.map((pc) => {
        const c = el("input", { type: "checkbox", checked: pc.visivel });
        c.addEventListener("change", () => { palco.mostrarPeca(pc.nome, c.checked); r.ocultas = palco.pecasOcultas(); salvar(); });
        const sel = el("select", { class: "lnux-selecao", "aria-label": "Textura de " + pc.nome }, opcoesTextura.map(([v, n]) => el("option", { value: v }, n)));
        if (r.texturas[pc.nome]) sel.prepend(el("option", { value: "manter", selected: true }, "Textura trocada"));
        sel.addEventListener("change", async () => {
          try {
            let blob = null;
            if (sel.value === "arquivo") { const [a] = await LNUX.arquivos.abrir({ titulo: "Textura para " + pc.nome, aceitar: "image/*" }); if (!a) return; blob = await a.blob(); }
            else if (sel.value.startsWith("v:")) { const [, i, ...n] = sel.value.split(":"); blob = atual.variacoes[+i].imagens[n.join(":")]; }
            else if (sel.value === "manter") return;
            if (blob) { await palco.trocarTextura(pc.nome, blob); r.texturas[pc.nome] = blob; }
            else { palco.voltarTextura(pc.nome); delete r.texturas[pc.nome]; }
            await salvar();
          } catch (e) { LNUX.erro(e); }
        });
        return el("div", { class: "linha-peca" }, el("label", { class: "lnux-alternar" }, c, pc.nome), sel);
      });
      corpo.replaceChildren(
        el("div", { class: "lnux-rotulo" }, "Roupas (cada uma é um .vrm da mesma personagem)"), ...linhasRoupas,
        el("div", { class: "linha" }, el("button", { class: "lnux-botao", type: "button", onclick: async () => { await adicionarRoupa(); desenhar(); } }, "Adicionar roupa (.vrm)...")),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "No VRoid Studio, vista outra roupa na mesma personagem e exporte de novo como VRM; depois adicione aqui. Pela conversa também dá: \"troca de roupa\"."),
        el("div", { class: "lnux-rotulo" }, `Peças de "${r.nome}"`),
        ...(linhasPecas.length ? linhasPecas : [el("p", { class: "fraco", style: { margin: 0 } }, "Este modelo não tem peças de roupa separadas.")]),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Esconder uma peça pode mostrar o corpo sem acabamento (o VRoid apaga a pele que a roupa cobre). A textura nova precisa ser do mesmo molde da peça, como as cores que vêm nos pacotes de roupa do VRoid; se o modelo foi exportado com as texturas juntas num atlas, ela não encaixa."),
        el("div", { class: "linha" }, el("button", { class: "lnux-botao", type: "button", onclick: async () => {
          const arqs = await LNUX.arquivos.abrir({ titulo: "Texturas (um ZIP de roupa do VRoid ou imagens)", aceitar: ".zip,image/*", multiplos: true });
          if (!arqs.length) return;
          const mapa = new Map();
          for (const a of arqs) {
            if (/\.zip$/i.test(a.nome)) for (const [c, b] of await C.pacoteDoZip(await a.blob())) mapa.set(c, b);
            else mapa.set("Imagens/" + a.nome, await a.blob());
          }
          const novas = C.variacoesDoPacote(mapa);
          atual.variacoes = [...(atual.variacoes || []), ...novas];
          await salvar();
          LNUX.aviso(`${novas.length} jogo(s) de texturas guardado(s).`, "ok");
          desenhar();
        } }, "Guardar texturas para trocar (ZIP ou imagens)..."),
        (atual.variacoes || []).length ? el("span", { class: "fraco pequeno" }, `${atual.variacoes.length} jogo(s): ${atual.variacoes.map((v) => v.nome).join(", ")}`) : null));
    };
    desenhar();
    await LNUX.dialogo({ titulo: "Roupas de " + atual.perfil.nome, corpo, largo: true, botoes: [{ rotulo: "Fechar", primario: true, valor: null }] });
  }
  /** "Troca de roupa" na conversa: veste a próxima (sem gastar tokens). */
  async function pedidoDeRoupa(texto) {
    if (!atual || atual.tipo !== "vrm") return null;
    if (!/\b(troc|mud|vist|veste|coloc|bot|põe|poe)\w*\b.{0,25}\b(roupa|outfit|look|vestido|traje|figurino)\b/i.test(texto)) return null;
    if (atual.roupas.length < 2) return "[pensativa] Por enquanto eu só tenho esta roupa... Dá para me dar outra em Personagem › Roupas (um .vrm meu, exportado do VRoid com outra roupa).";
    const i = atual.roupas.findIndex((r) => r.id === atual.roupaAtual);
    const prox = atual.roupas[(i + 1) % atual.roupas.length];
    await vestir(prox.id);
    return `[feliz][pular] Pronto, troquei! Agora estou com "${prox.nome}". Gostou?`;
  }

  // ── Janelas: personagem ──────────────────────────────────────────────

  const campoTexto = (rotulo, valor, { area = false, dica = "", tipo = "text", placeholder = "" } = {}) => {
    const entrada = area ? el("textarea", { class: "lnux-area", rows: 3, placeholder }, valor || "") : el("input", { class: "lnux-entrada", type: tipo, value: valor ?? "", placeholder });
    return { campo: el("label", { class: "lnux-campo" }, el("span", {}, rotulo), entrada, dica ? el("small", { class: "fraco" }, dica) : null), entrada };
  };
  const seletor = (opcoes, valor) => el("select", { class: "lnux-selecao" }, opcoes.map(([v, n]) => el("option", { value: v, selected: v === valor }, n)));

  async function janelaTrocar() {
    const lista = await C.listarPersonagens();
    const corpo = el("div", { class: "ajustes" });
    const desenhar = (itens) => corpo.replaceChildren(
      itens.length ? el("div", { class: "lista-personagens", style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, itens.map((p) => cartaoPersonagem(p, () => { d.fechar(); abrirPersonagem(p.id); }, atual && atual.id))) : el("p", { class: "fraco" }, "Nenhuma personagem ainda."),
      el("div", { class: "linha" }, el("button", { class: "lnux-botao", type: "button", onclick: () => { d.fechar(); importar("zip"); } }, "Importar ZIP ou .vrm..."), el("button", { class: "lnux-botao", type: "button", onclick: () => { d.fechar(); importar("pasta"); } }, "Importar pasta...")));
    desenhar(lista);
    const d = LNUX.dialogo({ titulo: "Trocar de personagem", corpo, largo: true, botoes: [{ rotulo: "Fechar", valor: null }] });
  }

  async function janelaPerfil() {
    if (!atual) return;
    const p = atual.perfil;
    const nome = campoTexto("Nome", p.nome);
    const apresentacao = campoTexto("Quem ela é", p.apresentacao, { area: true, dica: "História, aparência, de onde vem. Vai para a IA a cada mensagem: quanto mais curto, menos tokens." });
    const personalidade = campoTexto("Personalidade", p.personalidade, { area: true });
    const jeito = campoTexto("Jeito de falar", p.jeito, { area: true });
    const saudacao = campoTexto("Primeira fala", p.saudacao);
    const chamar = campoTexto("Como ela chama você (opcional)", p.comoChamar, { placeholder: "ex.: pelo nome, 'chefe', 'meu bem'..." });
    const idioma = seletor([["pt-BR", "Português (Brasil)"], ["pt-PT", "Português (Portugal)"], ["en", "Inglês"], ["es", "Espanhol"], ["ja", "Japonês"]], p.idioma || "pt-BR");
    const corpo = el("div", { class: "ajustes" }, nome.campo, apresentacao.campo, personalidade.campo, jeito.campo, el("div", { class: "grade" }, saudacao.campo, chamar.campo),
      el("label", { class: "lnux-campo" }, el("span", {}, "Idioma das respostas"), idioma),
      el("small", { class: "fraco" }, `Tamanho do perfil: ~${ia.estimarTokens(p.apresentacao + p.personalidade + p.jeito)} tokens por mensagem.`));
    const ok = await LNUX.dialogo({ titulo: "Perfil de " + p.nome, corpo, largo: true, botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] });
    if (!ok) return;
    Object.assign(p, { nome: nome.entrada.value.trim() || p.nome, apresentacao: apresentacao.entrada.value.trim(), personalidade: personalidade.entrada.value.trim(), jeito: jeito.entrada.value.trim(),
      saudacao: saudacao.entrada.value.trim(), comoChamar: chamar.entrada.value.trim(), idioma: idioma.value });
    $("#titulo-doc").textContent = p.nome;
    $("#conversa-titulo").textContent = "Conversa com " + p.nome;
    campo.placeholder = `Escreva para ${p.nome}...`;
    await C.salvarPersonagem(atual);
    LNUX.aviso("Perfil salvo.", "ok");
  }

  async function janelaEmocoes() {
    if (!atual) return;
    const nomes = [...palco.expressoes.keys()];
    const mapa = JSON.parse(JSON.stringify(atual.emocoes || {}));
    const linhas = [];
    for (const [id, e] of Object.entries(C.EMOCOES)) {
      const opcoes = el("div", { class: "opcoes" }, nomes.length ? nomes.map((n) => {
        const c = el("input", { type: "checkbox", checked: (mapa[id] || []).includes(n) });
        c.addEventListener("change", () => { const s = new Set(mapa[id] || []); c.checked ? s.add(n) : s.delete(n); mapa[id] = [...s]; });
        return el("label", {}, c, n);
      }) : el("span", { class: "fraco" }, "(o modelo não tem expressões)"));
      linhas.push(el("button", { class: "lnux-botao pequeno", type: "button", title: "Ver", onclick: () => { atual.emocoes = mapa; palco.definirEmocao(id); } }, e.nome), opcoes);
    }
    const corpo = el("div", { class: "ajustes" },
      el("p", { class: "fraco", style: { margin: 0 } }, "Para cada emoção, marque as expressões do modelo que devem ligar junto (o rosto já muda sozinho; as expressões somam lágrimas, corações, bochecha vermelha...). Clique no nome para ver."),
      el("div", { class: "tabela-emocoes" }, linhas));
    const antes = atual.emocoes;
    const ok = await LNUX.dialogo({ titulo: "Emoções e expressões", corpo, largo: true, botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] });
    atual.emocoes = ok ? mapa : antes;
    palco.definirEmocao("neutra");
    if (ok) { await C.salvarPersonagem(atual); LNUX.aviso("Emoções salvas.", "ok"); }
  }

  /** Editor das áreas de toque: arrastar para mover, a alça para mudar o tamanho. */
  function editarZonas() {
    if (!atual || !palco.modelo) return;
    if (atual.tipo === "vrm") { mostrarZonas = true; desenharZonas(); LNUX.aviso("Nas personagens VRoid as áreas de toque seguem o corpo sozinhas (cabeça, mãos, pés...). Agora elas estão aparecendo; desligue em Exibir › Mostrar áreas de toque.", "info", 9000); return; }
    const original = JSON.parse(JSON.stringify(palco.toques.zonas));
    const editor = { escolhida: palco.toques.zonas[0] && palco.toques.zonas[0].id };
    palco.toques.editando = true;
    const svg = $("#zonas");
    svg.classList.add("editando");
    const sel = seletor(palco.toques.zonas.map((z) => [z.id, z.nome]), editor.escolhida);
    sel.addEventListener("change", () => { editor.escolhida = sel.value; desenharZonas(editor); });
    const fechar = (salvar) => {
      palco.toques.editando = false;
      svg.classList.remove("editando");
      barra.remove();
      if (salvar) { atual.zonas = palco.toques.zonas; C.salvarPersonagem(atual); LNUX.aviso("Áreas de toque salvas.", "ok"); }
      else palco.toques.zonas = original;
      desenharZonas();
    };
    const barra = el("div", { class: "editor-zonas-barra" }, el("span", { class: "fraco pequeno" }, "Arraste as áreas; a alça muda o tamanho."), sel,
      el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { const z = palco.toques.zonas.find((x) => x.id === editor.escolhida); z.rets.push([0.4, 0.4, 0.55, 0.5]); desenharZonas(editor); } }, "+ Retângulo"),
      el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { const z = palco.toques.zonas.find((x) => x.id === editor.escolhida); if (z.rets.length > 1) z.rets.pop(); desenharZonas(editor); } }, "− Retângulo"),
      el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { palco.toques.zonas = C.zonasPadrao(palco.modelo.internalModel.originalWidth, palco.modelo.internalModel.originalHeight); desenharZonas(editor); } }, "Padrão"),
      el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => fechar(false) }, "Cancelar"),
      el("button", { class: "lnux-botao pequeno primario", type: "button", onclick: () => fechar(true) }, "Salvar"));
    palcoArea.append(barra);
    let arrasto = null;
    svg.onpointerdown = (e) => {
      const alvo = e.target;
      if (!alvo.dataset || !alvo.dataset.zona) return;
      editor.escolhida = alvo.dataset.zona; sel.value = editor.escolhida;
      const z = palco.toques.zonas.find((x) => x.id === alvo.dataset.zona);
      const r = svg.getBoundingClientRect();
      arrasto = { ret: z.rets[+alvo.dataset.i], alca: !!alvo.dataset.alca, inicio: palco.paraModelo(e.clientX - r.left, e.clientY - r.top), copia: [...z.rets[+alvo.dataset.i]] };
      svg.setPointerCapture(e.pointerId);
      desenharZonas(editor);
    };
    svg.onpointermove = (e) => {
      if (!arrasto) return;
      const r = svg.getBoundingClientRect();
      const p = palco.paraModelo(e.clientX - r.left, e.clientY - r.top);
      const dx = p.x - arrasto.inicio.x, dy = p.y - arrasto.inicio.y, c = arrasto.copia, ret = arrasto.ret;
      if (arrasto.alca) { ret[2] = Math.max(c[0] + 0.02, c[2] + dx); ret[3] = Math.max(c[1] + 0.01, c[3] + dy); }
      else { ret[0] = c[0] + dx; ret[1] = c[1] + dy; ret[2] = c[2] + dx; ret[3] = c[3] + dy; }
      desenharZonas(editor);
    };
    svg.onpointerup = () => { arrasto = null; };
    desenharZonas(editor);
  }

  async function exportarPersonagem() {
    if (!atual) return;
    if (atual.protegido && !(await LNUX.confirmar("Licença do modelo", "O autor marcou este modelo como \"não compartilhar\". O ZIP é para você levar para outro aparelho seu — não publique.", { rotulo: "Exportar" }))) return;
    const blob = await C.exportarPersonagem(atual.id);
    await LNUX.arquivos.salvar(blob, atual.perfil.nome.replace(/[^\p{L}\p{N} _-]+/gu, "") + " (Companhia).zip", { titulo: "Exportar personagem" });
  }
  async function apagarPersonagem() {
    if (!atual) return;
    const nome = atual.perfil.nome;
    if (!(await LNUX.confirmar("Apagar personagem", `Apagar ${nome} deste aparelho? As conversas e a memória dela também serão apagadas.`, { rotulo: "Apagar", perigo: true }))) return;
    const id = atual.id;
    await C.apagarPersonagem(id);
    await mem.apagar(id);
    LNUX.aviso(nome + " foi apagada.", "ok");
    const lista = await C.listarPersonagens();
    if (lista[0]) abrirPersonagem(lista[0].id); else mostrarVazio();
  }

  // ── Janelas: memória ─────────────────────────────────────────────────

  async function janelaMemoria() {
    if (!atual) return;
    est = await mem.estado(atual.id);
    const total = await mem.contar(atual.id);
    const pessoa = campoTexto("Seu nome (como ela lembra)", est.pessoa);
    const resumo = campoTexto("Resumo das conversas", est.resumo, { area: true, dica: "Vai para a IA a cada mensagem (curto = menos tokens)." });
    const lista = el("div", { class: "lista-fatos" });
    const desenharFatos = () => lista.replaceChildren(...(est.fatos.length ? est.fatos.map((f, i) => el("div", {}, el("span", { class: "tipo" }, f.tipo), el("span", { class: "t" }, f.texto),
      el("button", { class: "lnux-botao icone pequeno plano", type: "button", title: "Esquecer", "aria-label": "Esquecer", html: LNUX.icone("lixo"), onclick: () => { est.fatos.splice(i, 1); desenharFatos(); } })))
      : [el("div", { class: "fraco" }, "Ela ainda não sabe nada sobre você.")]));
    desenharFatos();
    const novoFato = el("input", { class: "lnux-entrada", placeholder: "Ensinar algo (ex.: Gosta de café sem açúcar.)", "data-enter-proprio": "1" });
    const somar = () => { if (novoFato.value.trim()) { mem.juntarFato(est, { texto: novoFato.value.trim(), tipo: "outro", origem: "pessoa" }); novoFato.value = ""; desenharFatos(); } };
    novoFato.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); somar(); } });
    const afeto = el("input", { type: "range", min: -100, max: 100, value: Math.round(est.afeto || 0) });
    const copia = LNUX.ponte.disponivel ? mem.caminhoCopia(atual.perfil.nome).arquivo : null;
    let d = null; // a janela (os botões de dentro a fecham)
    const corpo = el("div", { class: "ajustes" },
      el("p", { class: "fraco", style: { margin: 0 } }, `${total} mensagens guardadas neste aparelho · visitas: ${est.visitas || 0}` + (est.ultimaVisita ? ` · última: ${new Date(est.ultimaVisita).toLocaleString("pt-BR")}` : "")),
      el("div", { class: "grade" }, pessoa.campo, el("label", { class: "lnux-campo" }, el("span", {}, "Afeto"), afeto)), resumo.campo,
      el("div", {}, el("div", { class: "lnux-rotulo" }, `O que ela lembra (${est.fatos.length})`), lista), el("div", { class: "linha" }, novoFato, el("button", { class: "lnux-botao", type: "button", onclick: somar }, "Ensinar")),
      el("div", { class: "linha" },
        el("button", { class: "lnux-botao", type: "button", onclick: async () => { d.fechar(); await analisarMemoria(true); LNUX.aviso("Memória reanalisada.", "ok"); } }, "Reanalisar agora"),
        el("button", { class: "lnux-botao", type: "button", onclick: exportarMemoria }, "Exportar (JSON)"),
        el("button", { class: "lnux-botao", type: "button", onclick: () => { d.fechar(); importarMemoria(); } }, "Importar..."),
        copia ? el("button", { class: "lnux-botao", type: "button", title: copia, onclick: async () => { try { LNUX.aviso("Cópia salva em " + (await mem.copiarParaAparelho(atual.id, atual.perfil.nome)), "ok"); } catch (e) { LNUX.erro(e); } } }, "Copiar para o aparelho") : null,
        copia ? el("button", { class: "lnux-botao", type: "button", title: copia, onclick: async () => { try { const n = await mem.importar(atual.id, await mem.lerDoAparelho(atual.perfil.nome)); d.fechar(); LNUX.aviso(`${n} mensagens restauradas.`, "ok"); desenharHistorico(); } catch (e) { LNUX.erro(e); } } }, "Restaurar do aparelho") : null),
      el("label", { class: "lnux-alternar" }, (() => { const c = el("input", { type: "checkbox", checked: pref("copia-auto", "0") === "1", disabled: !copia }); c.addEventListener("change", () => gravarPref("copia-auto", c.checked ? "1" : "0")); return c; })(),
        copia ? "Copiar para o aparelho sozinho, ao sair do app" : "Cópia automática no aparelho (precisa da ponte)"));
    d = LNUX.dialogo({ titulo: "O que " + atual.perfil.nome + " lembra", corpo, largo: true,
      botoes: [{ rotulo: "Apagar tudo...", valor: "apagar", perigo: true }, "espaco", { rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", valor: "salvar", primario: true }] });
    const r = await d;
    if (r === "salvar") {
      est.pessoa = pessoa.entrada.value.trim(); est.resumo = resumo.entrada.value.trim(); est.afeto = +afeto.value;
      await mem.salvarEstado(est); atualizarAfeto(); LNUX.aviso("Memória salva.", "ok");
    } else if (r === "apagar") {
      if (await LNUX.confirmar("Apagar memória", `Apagar todas as conversas e tudo que ${atual.perfil.nome} lembra? (A personagem continua.)`, { rotulo: "Apagar", perigo: true })) {
        await mem.apagar(atual.id); est = await mem.estado(atual.id); atualizarAfeto(); await desenharHistorico(); LNUX.aviso("Memória apagada.", "ok");
      }
    } else est = await mem.estado(atual.id);
  }
  async function exportarMemoria() {
    if (!atual) return;
    const dados = await mem.exportar(atual.id, atual.perfil.nome);
    await LNUX.arquivos.salvar(new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" }), `${atual.perfil.nome} - memoria.json`, { titulo: "Exportar memória" });
  }
  async function importarMemoria() {
    if (!atual) return;
    const [a] = await LNUX.arquivos.abrir({ titulo: "Importar memória", aceitar: ".json" });
    if (!a) return;
    try {
      const n = await mem.importar(atual.id, JSON.parse(await a.texto()));
      LNUX.aviso(`${n} mensagens importadas.`, "ok");
      await desenharHistorico();
      await analisarMemoria(true);
    } catch (e) { LNUX.erro(e); }
  }
  async function janelaHistorico() {
    if (!atual) return;
    const todas = await mem.todas(atual.id);
    const busca = el("input", { class: "lnux-entrada", placeholder: "Procurar nas conversas...", "data-enter-proprio": "1" });
    const lista = el("div", { class: "mensagens", style: { maxHeight: "55vh", border: "1px solid var(--borda)", borderRadius: "8px" } });
    const desenhar = () => {
      const q = busca.value.trim();
      const itens = q ? mem.bm25(todas.filter((m) => m.texto), q, 60).sort((a, b) => a.id - b.id) : todas.slice(-300);
      lista.replaceChildren(...itens.map((m) => el("div", { class: "msg " + (m.papel === "marco" ? "sistema" : m.papel) }, m.papel === "marco" ? "— nova conversa —" : m.texto,
        el("span", { class: "info" }, new Date(m.data).toLocaleString("pt-BR")))));
      if (!q) lista.scrollTop = lista.scrollHeight;
    };
    busca.addEventListener("input", LNUX.adiar(desenhar, 200));
    desenhar();
    LNUX.dialogo({ titulo: `Histórico (${todas.length} mensagens)`, corpo: el("div", { class: "ajustes" }, busca, lista), largo: true, botoes: [{ rotulo: "Fechar", valor: null }] });
  }
  async function novaConversa() {
    if (!atual) return;
    voz.parar();
    const m = { papel: "marco", texto: "", data: Date.now() };
    await mem.adicionar(atual.id, m);
    desenharMsg(m);
    rolarFim();
    analisarMemoria(false);
  }

  // ── Janelas: IA ──────────────────────────────────────────────────────

  async function janelaProvedores() {
    await ia.atualizarChaves();
    const corpo = el("div", { class: "ajustes" });
    const avisoChave = LNUX.ponte.disponivel
      ? el("div", { class: "aviso" }, "Ponte ligada: as chaves ficam guardadas no aparelho (~/.lnux-apps/ia.json) e a ponte faz os pedidos — a chave não passa pelo navegador.")
      : el("div", { class: "aviso" }, "Sem a ponte local: a chave fica guardada neste navegador e o pedido vai direto ao provedor. Abra a Companhia pelo LNUX (🌐 Apps Web) para guardar as chaves no aparelho.");
    const sel = seletor(Object.entries(C.PROVEDORES).map(([id, p]) => [id, p.nome + (ia.temChave(id) ? " ✓" : "")]), ia.config.rotas.padrao.provedor || "openai");
    const detalhes = el("div", { class: "ajustes" });
    const desenhar = () => {
      const id = sel.value, p = ia.provedor(id), info = C.PROVEDORES[id];
      const url = campoTexto("Endereço da API", p.url, { placeholder: "https://.../v1" });
      const modelo = campoTexto("Modelo", p.modelo, { placeholder: info.sugestao ? "ex.: " + info.sugestao : "" });
      const tipo = seletor([["openai", "Compatível com OpenAI"], ["anthropic", "Anthropic (Messages)"], ["gemini", "Gemini"]], p.tipo);
      const chave = campoTexto("Chave da API", "", { tipo: "password", placeholder: ia.temChave(id) ? "•••••• (guardada — deixe vazio para manter)" : info.chave === "nao" ? "não precisa" : "cole a chave aqui" });
      const modelos = el("datalist", { id: "lista-modelos" });
      modelo.entrada.setAttribute("list", "lista-modelos");
      const listar = el("button", { class: "lnux-botao", type: "button", onclick: async () => {
        listar.disabled = true;
        try { await guardar(false); const ms = await ia.listarModelos(id); modelos.replaceChildren(...ms.map((m) => el("option", { value: m }))); LNUX.aviso(`${ms.length} modelos. Clique no campo Modelo para escolher.`, "ok"); modelo.entrada.focus(); }
        catch (e) { LNUX.erro(e); } finally { listar.disabled = false; }
      } }, "Listar modelos");
      const guardar = async (avisar = true) => {
        ia.config.provedores[id] = { url: url.entrada.value.trim().replace(/\/+$/, ""), modelo: modelo.entrada.value.trim(), tipo: id === "personalizado" ? tipo.value : undefined };
        ia.salvar();
        if (chave.entrada.value.trim()) { await ia.guardarChave(id, chave.entrada.value.trim(), url.entrada.value.trim() || info.url); chave.entrada.value = ""; }
        if (avisar) LNUX.aviso(info.nome + " salvo.", "ok");
      };
      const usar = async () => {
        await guardar(false);
        ia.config.rotas.padrao = { provedor: id, modelo: modelo.entrada.value.trim() };
        if (ia.config.motorLocal === "sempre") ia.config.motorLocal = "simples";
        ia.salvar(); atualizarSeloIA(); LNUX.aviso(`A conversa agora usa ${info.nome}.`, "ok");
      };
      const testar = async () => {
        try {
          await guardar(false);
          const r = await ia.conversar({ provedor: id, modelo: modelo.entrada.value.trim(), sistema: "Responda só: [feliz] Oi!", mensagens: [{ papel: "eu", texto: "Diga oi." }], maxTokens: 30 });
          LNUX.aviso(`Funcionou (${r.modelo}): ${C.separarMarcas(r.texto).texto || r.texto}`, "ok");
        } catch (e) { LNUX.erro(e); }
      };
      detalhes.replaceChildren(
        info.dica ? el("p", { class: "fraco", style: { margin: 0 } }, info.dica) : null,
        info.local ? el("p", { class: "fraco", style: { margin: 0 } }, "Roda no próprio aparelho/computador: nada sai para a internet e não gasta créditos.") : null,
        el("div", { class: "grade" }, url.campo, id === "personalizado" ? el("label", { class: "lnux-campo" }, el("span", {}, "Jeito da API"), tipo) : el("span")),
        el("div", { class: "linha" }, modelo.campo, listar, modelos),
        info.chave !== "nao" ? el("div", { class: "linha" }, chave.campo,
          ia.temChave(id) ? el("button", { class: "lnux-botao", type: "button", onclick: async () => { await ia.guardarChave(id, "", ""); LNUX.aviso("Chave apagada.", "ok"); desenhar(); } }, "Apagar chave") : null,
          info.site ? el("a", { class: "lnux-botao plano", href: info.site, target: "_blank", rel: "noopener" }, "Pegar uma chave") : null) : null,
        el("div", { class: "linha" }, el("button", { class: "lnux-botao", type: "button", onclick: () => guardar() }, "Salvar"), el("button", { class: "lnux-botao", type: "button", onclick: testar }, "Testar"),
          el("button", { class: "lnux-botao primario", type: "button", onclick: usar }, "Usar na conversa")));
    };
    sel.addEventListener("change", desenhar);
    desenhar();
    let extras = null;
    if (LNUX.ponte.disponivel) {
      const hosts = await ia.hostsExtras();
      const campoHosts = campoTexto("Endereços extras que a ponte pode chamar", hosts.join(", "), { dica: "Para uma IA em outro computador da sua rede (ex.: 192.168.0.10:11434). Os programas do próprio aparelho (127.0.0.1) já valem." });
      extras = el("details", {}, el("summary", {}, "Outros computadores da rede"), campoHosts.campo,
        el("button", { class: "lnux-botao", type: "button", onclick: async () => { try { await ia.hostsExtras(campoHosts.entrada.value.split(/[\s,]+/).filter(Boolean)); LNUX.aviso("Endereços salvos.", "ok"); } catch (e) { LNUX.erro(e); } } }, "Salvar endereços"));
    }
    corpo.append(avisoChave, el("label", { class: "lnux-campo" }, el("span", {}, "Provedor"), sel), detalhes, extras || "",
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Para gastar menos: em IA › Rotas, use um modelo barato ou local na rota Leve (toques, memória, saudações) e deixe o motor local responder o simples."));
    await LNUX.dialogo({ titulo: "IA: provedores e chaves", corpo, largo: true, botoes: [{ rotulo: "Fechar", valor: null }] });
    atualizarSeloIA();
  }

  async function janelaRotas() {
    const provs = [["", "— (usa a padrão)"], ...Object.entries(C.PROVEDORES).map(([id, p]) => [id, p.nome])];
    const campos = {};
    const linhas = Object.entries(C.ROTAS).map(([rota, info]) => {
      const r = ia.config.rotas[rota] || {};
      const prov = seletor(rota === "padrao" ? [["", "— (sem IA: motor local)"], ...provs.slice(1)] : provs, r.provedor || "");
      const modelo = el("input", { class: "lnux-entrada", value: r.modelo || "", placeholder: "modelo (vazio = o do provedor)" });
      campos[rota] = { prov, modelo };
      return el("div", { class: "lnux-secao" }, el("h3", {}, info.nome), el("p", { class: "fraco pequeno", style: { margin: "0 0 6px" } }, info.dica), el("div", { class: "grade" }, prov, modelo));
    });
    const motor = seletor([["simples", "Responder o simples sem IA (recomendado)"], ["sempre", "Só o motor local (sem IA)"], ["nunca", "Tudo pela IA"]], ia.config.motorLocal);
    const limite = campoTexto("Contexto longo a partir de (tokens)", ia.config.limiteLongo, { tipo: "number" });
    const max = campoTexto("Tamanho máximo da resposta (tokens)", ia.config.maxTokens, { tipo: "number" });
    const trocas = campoTexto("Trocas recentes no contexto", ia.config.trocasRecentes, { tipo: "number", dica: "Menos = mais barato; os assuntos antigos ainda entram pela memória quando têm a ver." });
    const temp = campoTexto("Criatividade (0 a 1.5)", ia.config.temperatura, { tipo: "number" });
    const toques = el("input", { type: "checkbox", checked: ia.config.toquesComIA });
    const intervalo = campoTexto("Intervalo mínimo entre reações a toque pela IA (s)", ia.config.intervaloToquesIA, { tipo: "number" });
    const corpo = el("div", { class: "ajustes" }, el("p", { class: "fraco", style: { margin: 0 } }, "No espírito do claude-code-router: cada tipo de tarefa vai para o modelo certo, e o simples nem chega à IA."),
      ...linhas, el("label", { class: "lnux-campo" }, el("span", {}, "Motor local (0 tokens)"), motor), el("div", { class: "grade" }, limite.campo, max.campo, trocas.campo, temp.campo),
      el("label", { class: "lnux-alternar" }, toques, "Reações a toques e saudações pela IA (rota leve)"), intervalo.campo);
    if (!(await LNUX.dialogo({ titulo: "IA: rotas e economia de tokens", corpo, largo: true, botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] }))) return;
    for (const [rota, c] of Object.entries(campos)) ia.config.rotas[rota] = { provedor: c.prov.value, modelo: c.modelo.value.trim() };
    Object.assign(ia.config, { motorLocal: motor.value, limiteLongo: +limite.entrada.value || 6000, maxTokens: +max.entrada.value || 350, trocasRecentes: Math.max(1, +trocas.entrada.value || 8),
      temperatura: Math.max(0, Math.min(1.5, +temp.entrada.value || 0.85)), toquesComIA: toques.checked, intervaloToquesIA: Math.max(0, +intervalo.entrada.value || 20) });
    ia.salvar(); atualizarSeloIA(); LNUX.aviso("Rotas salvas.", "ok");
  }

  // ── Janelas: voz ─────────────────────────────────────────────────────

  async function janelaVoz(daPersonagem) {
    await ia.atualizarChaves();
    const base = daPersonagem ? Object.assign({}, voz.config, (atual && atual.voz) || {}) : { ...voz.config };
    const prov = seletor(Object.entries(C.PROVEDORES_VOZ).map(([id, p]) => [id, p.nome + (ia.temChave(id) ? " ✓" : "")]), base.provedor);
    const detalhes = el("div", { class: "ajustes" });
    const cfg = { ...base };
    const desenhar = () => {
      cfg.provedor = prov.value;
      const p = C.PROVEDORES_VOZ[cfg.provedor];
      const vozSel = el("select", { class: "lnux-selecao" }, el("option", { value: cfg.voz || "" }, cfg.voz || "(padrão)"));
      const listar = el("button", { class: "lnux-botao", type: "button", onclick: async () => {
        try { cfg.url = url ? url.entrada.value.trim() : ""; const vs = await voz.listarVozes(cfg); vozSel.replaceChildren(el("option", { value: "" }, "(padrão)"), ...vs.map((v) => el("option", { value: v.id, selected: v.id === cfg.voz }, v.nome + (v.detalhe ? " — " + v.detalhe : "")))); LNUX.aviso(vs.length + " vozes.", "ok"); }
        catch (e) { LNUX.erro(e); }
      } }, "Listar vozes");
      vozSel.addEventListener("change", () => { cfg.voz = vozSel.value; });
      const url = p.url !== undefined ? campoTexto("Endereço", cfg.url || p.url) : null;
      const modelo = p.modelos ? el("select", { class: "lnux-selecao" }, p.modelos.map((m) => el("option", { value: m, selected: m === (cfg.modelo || p.modelos[0]) }, m))) : null;
      if (modelo) modelo.addEventListener("change", () => { cfg.modelo = modelo.value; });
      const chave = p.chave ? campoTexto("Chave da API", "", { tipo: "password", placeholder: ia.temChave(cfg.provedor) ? "•••••• (guardada)" : p.chave === "opcional" ? "(opcional)" : "cole a chave" }) : null;
      detalhes.replaceChildren(
        cfg.provedor === "voicestudio" ? el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Instale e abra o VoiceStudio no aparelho (ele fica em http://127.0.0.1:3900). A Companhia usa a API dele; a voz é gerada no aparelho. O VoiceStudio é AGPL-3.0, de debpalash.") : null,
        cfg.provedor === "elevenlabs" ? el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Para economizar créditos: eleven_flash_v2_5 custa metade. O eleven_v3 entende emoções ([laughs], [sighs]...).") : null,
        cfg.provedor === "openai" ? el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Usa a mesma chave da OpenAI da IA. O gpt-4o-mini-tts muda o tom conforme a emoção.") : null,
        url ? url.campo : null, el("div", { class: "linha" }, el("label", { class: "lnux-campo" }, el("span", {}, "Voz"), vozSel), cfg.provedor !== "ponte" ? listar : null),
        modelo ? el("label", { class: "lnux-campo" }, el("span", {}, "Modelo"), modelo) : null,
        chave ? el("div", { class: "linha" }, chave.campo, el("button", { class: "lnux-botao", type: "button", onclick: async () => { try { await ia.guardarChave(cfg.provedor, chave.entrada.value.trim(), (url ? url.entrada.value : p.url) || p.url); chave.entrada.value = ""; LNUX.aviso("Chave salva.", "ok"); } catch (e) { LNUX.erro(e); } } }, "Salvar chave"),
          p.site ? el("a", { class: "lnux-botao plano", href: p.site, target: "_blank", rel: "noopener" }, "Site") : null) : null);
      detalhes.lerUrl = () => (url ? url.entrada.value.trim() : "");
    };
    prov.addEventListener("change", () => { cfg.voz = ""; cfg.modelo = ""; desenhar(); });
    desenhar();
    const vel = el("input", { type: "range", min: 0.6, max: 1.6, step: 0.05, value: base.velocidade || 1 });
    const tom = el("input", { type: "range", min: 0.5, max: 1.6, step: 0.05, value: base.tom || 1 });
    const emocao = el("input", { type: "checkbox", checked: base.emocaoNaVoz });
    const guardarCache = el("input", { type: "checkbox", checked: base.guardar });
    const corpo = el("div", { class: "ajustes" }, el("label", { class: "lnux-campo" }, el("span", {}, "Gerador de voz"), prov), detalhes,
      el("div", { class: "grade" }, el("label", { class: "lnux-campo" }, el("span", {}, "Velocidade"), vel), el("label", { class: "lnux-campo" }, el("span", {}, "Tom (voz do navegador)"), tom)),
      el("label", { class: "lnux-alternar" }, emocao, "A emoção muda o jeito de falar"),
      el("label", { class: "lnux-alternar" }, guardarCache, "Guardar frases curtas (não gasta créditos de novo)"),
      el("button", { class: "lnux-botao", type: "button", onclick: () => { voz.destravar(); const antes = voz.daPersonagem; voz.daPersonagem = { ...ler() }; voz.parar(); voz.falar("Oi! Essa é a minha voz. Gostou?", "feliz"); setTimeout(() => { voz.daPersonagem = antes; }, 100); } }, "Testar"));
    const ler = () => ({ provedor: cfg.provedor, voz: cfg.voz, modelo: cfg.modelo, url: detalhes.lerUrl(), velocidade: +vel.value, tom: +tom.value, emocaoNaVoz: emocao.checked, guardar: guardarCache.checked, falar: true });
    const ok = await LNUX.dialogo({ titulo: daPersonagem ? "Voz de " + atual.perfil.nome : "Voz (padrão)", corpo, largo: true,
      botoes: daPersonagem ? [{ rotulo: "Usar a voz padrão", valor: "padrao" }, "espaco", { rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] : [{ rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] });
    if (!ok) return;
    const novo = ler();
    if (daPersonagem) {
      const { falar, ...proprio } = novo;
      atual.voz = ok === "padrao" ? null : proprio;
      voz.daPersonagem = atual.voz;
      await C.salvarPersonagem(atual);
    } else { Object.assign(voz.config, novo, { falar: voz.config.falar }); voz.salvar(); }
    LNUX.aviso("Voz salva.", "ok");
  }

  // ── Microfone ────────────────────────────────────────────────────────

  function ouvir() {
    if (pararOuvir) { pararOuvir(); return; }
    voz.destravar();
    voz.parar();
    try {
      const botao = $("#botao-mic");
      botao.classList.add("ouvindo");
      palco.definirEmocao("pensativa", 0.4);
      pararOuvir = voz.ouvir({
        aoParcial: (t) => { campo.value = t; ajustarCampo(); },
        aoFinal: (t) => { enviar(t); },
        aoErro: (e) => LNUX.aviso(e.message, "alerta"),
        aoFim: () => { botao.classList.remove("ouvindo"); pararOuvir = null; },
        idioma: atual ? atual.perfil.idioma || "pt-BR" : "pt-BR",
      });
    } catch (e) { $("#botao-mic").classList.remove("ouvindo"); pararOuvir = null; LNUX.erro(e); }
  }

  // ── Exibir ───────────────────────────────────────────────────────────

  function enquadrar(modo) {
    if (!atual) return;
    if (palco.mundo && palco.mundo.andando) estudio.alternarAndar(false); // Rosto/Busto/Corpo voltam ao retrato
    palco.definirEnquadramento({ modo, zoom: 1, dx: 0, dy: 0 });
    for (const b of $("#enquadramento").children) b.setAttribute("aria-pressed", String(b.dataset.modo === modo));
    atual.enquadramento = { ...palco.enquadramento };
    salvarPersonagem();
  }
  async function janelaPosicao() {
    if (!atual) return;
    const e = { ...palco.enquadramento };
    const controle = (rotulo, chave, min, max, passo) => {
      const i = el("input", { type: "range", min, max, step: passo, value: e[chave] });
      i.addEventListener("input", () => palco.definirEnquadramento({ [chave]: +i.value }));
      return el("label", { class: "lnux-campo" }, el("span", {}, rotulo), i);
    };
    const ok = await LNUX.dialogo({ titulo: "Posição e tamanho", corpo: el("div", { class: "ajustes" }, controle("Zoom", "zoom", 0.4, 3, 0.02), controle("Para os lados", "dx", -0.6, 0.6, 0.01), controle("Para cima/baixo", "dy", -1.5, 0.8, 0.01),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Dica: a rodinha do mouse sobre a personagem também dá zoom.")), botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Salvar", primario: true, valor: true }] });
    if (!ok) palco.definirEnquadramento(e);
    atual.enquadramento = { ...palco.enquadramento };
    salvarPersonagem();
  }
  $("#palco").addEventListener("wheel", (e) => {
    if (!atual) return;
    e.preventDefault();
    if (palco.mundo && palco.mundo.andando) { palco.mundo.zoom(e.deltaY < 0 ? 1 / 1.1 : 1.1); return; } // andando: a rodinha aproxima a câmera
    palco.definirEnquadramento({ zoom: LNUX.limitar(palco.enquadramento.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 0.4, 3) });
    atual.enquadramento = { ...palco.enquadramento };
    salvarPersonagem();
  }, { passive: false });

  async function janelaFundo() {
    const atualFundo = pref("fundo", "padrao");
    const opcoes = seletor([["padrao", "Padrão do tema"], ["quarto", "Quarto (tons quentes)"], ["noite", "Noite"], ["ceu", "Céu"], ["verde", "Tela verde (para gravar)"], ["imagem", "Uma imagem minha..."]], atualFundo);
    if (!(await LNUX.dialogo({ titulo: "Fundo", corpo: el("label", { class: "lnux-campo" }, el("span", {}, "Fundo do palco"), opcoes), botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "OK", primario: true, valor: true }] }))) return;
    if (opcoes.value === "imagem") {
      const [a] = await LNUX.arquivos.abrir({ titulo: "Imagem de fundo", aceitar: "image/*" });
      if (!a) return;
      await LNUX.guardado.gravar("companhia:fundo", await a.blob());
    }
    gravarPref("fundo", opcoes.value);
    aplicarFundo();
  }
  const FUNDOS = { quarto: "linear-gradient(180deg,#f3d9c2,#c99a7c)", noite: "radial-gradient(ellipse at 50% 20%,#2c3a6b,#0b0f1f)", ceu: "linear-gradient(180deg,#7ec3f5,#d9f0ff)", verde: "#00b140" };
  async function aplicarFundo() {
    const f = pref("fundo", "padrao");
    palcoArea.classList.remove("fundo-imagem");
    palcoArea.style.background = "";
    if (FUNDOS[f]) palcoArea.style.background = FUNDOS[f];
    if (f === "imagem") {
      const b = await LNUX.guardado.ler("companhia:fundo");
      if (b) { palcoArea.classList.add("fundo-imagem"); palcoArea.style.backgroundImage = `url(${URL.createObjectURL(b)})`; }
    }
  }
  async function foto() {
    if (!atual) return;
    const blob = await palco.foto();
    await LNUX.arquivos.salvar(blob, `${atual.perfil.nome} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`, { titulo: "Salvar foto" });
  }

  // ── Ajuda ────────────────────────────────────────────────────────────

  function ajuda() {
    LNUX.dialogo({ titulo: "Primeiros passos", largo: true, corpo: el("div", { class: "ajustes" },
      el("p", { style: { margin: 0 } }, el("b", {}, "1. Personagem: "), "Personagem › Importar ZIP (ou pasta). Funciona com modelos Live2D Cubism 3/4 — os do VTube Studio trazem expressões, movimento parado e ícone. Troque quando quiser em Personagem › Trocar."),
      el("p", { style: { margin: 0 } }, el("b", {}, "2. Conversa: "), "Sem configurar nada, o motor local conversa o básico (0 tokens). Para conversar de verdade, ligue uma IA em IA › Provedores: ChatGPT, Claude, Gemini, OpenRouter, Groq, DeepSeek... ou uma IA local (Ollama, LM Studio, llama.cpp) — nada sai do aparelho."),
      el("p", { style: { margin: 0 } }, el("b", {}, "3. Economia: "), "IA › Rotas: um modelo barato/local para as tarefas leves (toques, memória, saudações), um mais forte para perguntas difíceis. Também dá para usar o claude-code-router como provedor."),
      el("p", { style: { margin: 0 } }, el("b", {}, "4. Voz: "), "Voz › Configurar: voz do navegador (grátis), ElevenLabs, OpenAI, VoiceStudio (no aparelho) ou outro servidor compatível. O microfone ao lado da caixa de texto escuta você; \"Mãos livres\" deixa a conversa toda por voz."),
      el("p", { style: { margin: 0 } }, el("b", {}, "5. Toques: "), "Toque, toque duas vezes, segure, faça carinho (vai e volta) ou puxe: cabeça (cafuné), chapéu, orelhas, bochechas, ombros, mãos, barriga e pés (cócegas). Exibir › Mostrar áreas de toque; Personagem › Áreas de toque para ajustar."),
      el("p", { style: { margin: 0 } }, el("b", {}, "6. Memória: "), "As conversas ficam neste aparelho. Ao abrir, ela relê o que ficou e lembra de você (nome, gostos, planos). Conversa › O que ela lembra, para ver, corrigir, exportar ou copiar para uma pasta do aparelho."),
      el("p", { style: { margin: 0 } }, el("b", {}, "Expressões: "), "os botões embaixo da personagem ligam/desligam as expressões do modelo, como os atalhos do VTube Studio. Personagem › Emoções liga expressões a cada emoção."),
      el("p", { style: { margin: 0 } }, el("b", {}, "Movimento (personagens VRoid): "), "o menu Movimento (ou o botão 🎬 no palco) tem a captura de movimento pela câmera (rosto, olhos, tronco, braços, mãos, dedos e pernas), os pacotes de movimento (.vrma, .fbx do Mixamo, .bvh), o cenário para andar (W A S D, Shift corre, Espaço pula) e o ajuste do esqueleto.")),
      botoes: [{ rotulo: "Entendi", primario: true, valor: true }] });
  }
  /** Qualidade das texturas + diagnóstico da placa de vídeo (para quando a personagem aparece preta ou o app fica lento). */
  async function janelaQualidade() {
    const d = palco.diagnostico();
    const linha = (rotulo, valor) => el("div", { class: "linha-diag" }, el("span", { class: "fraco" }, rotulo), el("span", { class: "mono" }, valor));
    const texturas = d.texturas.map((t) => `${t.arquivo.split("/").pop()}: ${t.original ? t.original.join("×") : "?"}` + (t.usada && t.original && t.usada[0] !== t.original[0] ? ` → ${t.usada.join("×")}` : "") + " px");
    const sel = seletor(C.QUALIDADES, (atual && atual.qualidade) || "auto");
    const corpo = el("div", { class: "ajustes" },
      el("p", { class: "fraco", style: { margin: 0 } }, "Modelos com texturas muito grandes podem aparecer pretos ou deixar o app lento em celulares: a placa de vídeo não aguenta. Com texturas menores a personagem quase não muda na tela e gasta bem menos memória."),
      atual ? el("label", { class: "lnux-campo" }, el("span", {}, "Qualidade das texturas de " + atual.perfil.nome), sel) : el("p", {}, "Abra uma personagem para escolher a qualidade."),
      el("div", { class: "diag" },
        linha("Placa de vídeo", d.gpu || "(o navegador não informa)"),
        linha("WebGL", String(d.webgl)),
        linha("Maior textura aceita", d.maxTextura + " px"),
        linha("Memória do aparelho", d.memoria ? d.memoria + " GB" : "(o navegador não informa)"),
        linha("Tipo de aparelho", d.celular ? "celular/tablet (automática: até 2048 px)" : "computador (automática: até 4096 px)"),
        linha("Núcleo do Live2D", d.nucleo || "(não carregado)"),
        linha("Limite usado agora", d.limite ? d.limite + " px" : "—"),
        ...texturas.map((t) => linha("Textura", t)),
        d.pretas === null ? null : linha("Conferência na placa de vídeo", d.pretas ? "✖ textura preta (não subiu)" : "✔ texturas ok")));
    const r = await LNUX.dialogo({ titulo: "Qualidade das texturas", corpo, largo: true, botoes: atual ? [{ rotulo: "Fechar", valor: null }, { rotulo: "Aplicar", primario: true, valor: "aplicar" }] : [{ rotulo: "Fechar", valor: null }] });
    if (r !== "aplicar" || !atual) return;
    atual.qualidade = sel.value === "auto" ? null : sel.value;
    await C.salvarPersonagem(atual);
    await abrirPersonagem(atual.id, { saudar: false });
    LNUX.aviso(`Texturas: ${palco.limiteUsado} px.`, "ok");
  }

  function creditos() {
    const item = (nome, url, txt) => el("li", {}, el("a", { href: url, target: "_blank", rel: "noopener" }, nome), " — ", txt);
    LNUX.dialogo({ titulo: "Créditos e licenças", largo: true, corpo: el("div", { class: "ajustes" },
      el("p", { style: { margin: 0 } }, "A Companhia é uma reescrita própria (licença MIT, parte do LNUX-APPs). Usa e se inspira em:"),
      el("ul", { style: { margin: 0, paddingLeft: "18px", display: "grid", gap: "4px" } },
        item("pixi.js 6", "https://github.com/pixijs/pixijs", "desenho (MIT), em vendor/."),
        item("pixi-live2d-display", "https://github.com/guansss/pixi-live2d-display", "carregar e animar modelos Live2D (MIT, guansss), em vendor/."),
        item("three.js e three-vrm", "https://github.com/pixiv/three-vrm", "personagens VRoid (.vrm) em 3D e movimentos .vrma (MIT; three.js e pixiv), em vendor/."),
        item("MediaPipe Tasks Vision", "https://ai.google.dev/edge/mediapipe/solutions/guide", "captura de movimento pela câmera: rosto, corpo e mãos (Apache-2.0, Google). O código vem em vendor/; o WebAssembly e os modelos são baixados na primeira vez."),
        item("three-mesh-bvh", "https://github.com/gkjohnson/three-mesh-bvh", "colisão com o cenário ao andar (MIT, Garrett Johnson), em vendor/."),
        item("Kalidokit", "https://github.com/yeemachine/kalidokit", "referência da ideia de passar os pontos do MediaPipe para um VRM (MIT, yeemachine); o cálculo daqui é próprio."),
        item("Live2D Cubism Core", "https://www.live2d.com/en/sdk/download/web/", "núcleo da Live2D Inc. — licença própria; NÃO vem junto: é baixado do site oficial ou escolhido por você."),
        item("claude-code-router", "https://github.com/musistudio/claude-code-router", "ideia das rotas por tarefa para economizar tokens (MIT); também dá para usá-lo como provedor."),
        item("VoiceStudio", "https://github.com/debpalash/VoiceStudio", "gerador de voz local (AGPL-3.0, debpalash) — a Companhia só chama a API dele; nenhum código foi copiado."),
        item("Open-LLM-VTuber", "https://github.com/Open-LLM-VTuber/Open-LLM-VTuber", "ideia das marcas de emoção no texto da IA (MIT)."),
        item("AIRI (moeru-ai)", "https://github.com/moeru-ai/airi", "referência de companheira virtual com Live2D, voz e memória (MIT)."),
        item("waifu-companion", "https://github.com/waifuai/waifu-companion", "referência de companhia só no navegador, com motor local e memória (MIT-0)."),
        item("charivo", "https://github.com/zeikar/charivo", "referência de personagem Live2D com LLM e TTS (MIT)."),
        item("VTube Studio", "https://denchisoft.com", "formato dos pacotes de modelo (.vtube.json). Não afiliado.")),
      el("p", { class: "fraco", style: { margin: 0 } }, "Os modelos que você importa são dos autores deles e ficam só no seu aparelho. Respeite a licença de cada modelo.")),
      botoes: [{ rotulo: "Fechar", primario: true, valor: true }] });
  }

  // ── Jogar com outras pessoas (salas) ─────────────────────────────────

  const copiar = async (texto) => {
    try { await navigator.clipboard.writeText(texto); } catch (e) { try { await LNUX.ponte.areaDeTransferencia.escrever(texto); } catch (e2) { await LNUX.dialogo({ titulo: "Copie o link", corpo: el("input", { class: "lnux-entrada", value: texto, readonly: true }) }); return; } }
    LNUX.aviso("Link copiado.", "ok");
  };
  function garantirSala() {
    if (!sala) sala = new C.Sala({ palco: palco3d, captura, aoMudar: atualizarSala, aoMensagem: mensagemDaSala });
    return sala;
  }
  function mensagemDaSala(m) {
    if (!jogando()) return;
    const e = m.sistema ? el("div", { class: "msg sistema" }, m.texto)
      : el("div", { class: "msg " + (m.meu ? "eu" : "ela") }, m.meu ? null : el("b", { class: "quem" }, m.nome + ": "), el("span", { class: "t" }, m.texto), el("span", { class: "info" }, hora(Date.now())));
    listaMsgs.append(e);
    rolarFim();
  }
  function atualizarSala() {
    const dentro = !!(sala && sala.dentro);
    const chip = $("#chip-sala");
    chip.hidden = !jogando();
    chip.textContent = dentro ? `🎮 ${sala.info.nome} · ${sala.pessoas} ${sala.pessoas === 1 ? "pessoa" : "pessoas"}` : "🎮 Entrar numa sala";
    chip.classList.toggle("ligado", dentro);
    $("#gestos").hidden = !(jogando() && atual && atual.tipo === "vrm");
    if (jogando()) {
      $("#conversa-titulo").textContent = dentro ? `Sala: ${sala.info.nome}` : "Sala";
      campo.placeholder = dentro ? "Escreva para as pessoas da sala..." : "Entre numa sala para conversar com as pessoas...";
      $("#titulo-doc").textContent = dentro ? `${sala.info.nome} (${sala.pessoas})` : atual ? atual.perfil.nome : "Jogar";
    }
    atualizarChipMovimento();
  }
  function enviarParaSala(texto) {
    if (!texto) return;
    if (!sala || !sala.dentro) { LNUX.aviso("Entre numa sala primeiro (menu Sala).", "alerta"); return; }
    campo.value = "";
    ajustarCampo();
    sala.falar(texto).catch(LNUX.erro);
  }
  /** O avatar padrão (um boneco de caixas), guardado como uma personagem qualquer na primeira vez. */
  async function idDoBoneco() {
    const id = pref("sala-boneco", "");
    if (id && (await C.listarPersonagens()).some((p) => p.id === id)) return id;
    await C.prepararVRM();
    const p = await C.importarPacote(new Map([["Boneco.vrm", C.bonecoPadrao()]]));
    gravarPref("sala-boneco", p.id);
    return p.id;
  }
  /** O arquivo .vrm da minha personagem, para os outros me verem (ou null: eles veem um boneco simples). */
  async function avatarParaOsOutros(mandar) {
    if (!mandar || !atual || atual.tipo !== "vrm") return null;
    if (atual.protegido && !(await LNUX.dialogo({ titulo: "Modelo com licença", corpo: `O autor de "${atual.perfil.nome}" não deixa redistribuir o modelo. Para os outros te verem com ela, o arquivo é mandado para o aparelho de cada pessoa da sala. ` +
      "Sem mandar, você continua se vendo com ela e os outros veem um boneco simples.", botoes: [{ rotulo: "Aparecer como boneco", valor: false, primario: true }, { rotulo: "Mandar mesmo assim", valor: true }] }))) return null;
    const r = roupaAtual();
    return r ? r.blob : null;
  }
  const codigoDe = (texto) => { const m = String(texto).match(/sala=([a-z0-9]+)/i); return (m ? m[1] : String(texto)).trim().toLowerCase(); };
  /** Criar ou entrar numa sala: nome, personagem e o código (ou o cenário, para criar). */
  async function janelaSala(codigoInicial = "") {
    const personagens = (await C.listarPersonagens()).filter((p) => p.tipo === "vrm" && p.id !== pref("sala-boneco", ""));
    const nome = el("input", { class: "lnux-entrada", value: pref("sala-nome", ""), maxlength: 24, placeholder: "Como os outros vão te ver", "aria-label": "Seu nome" });
    const avatar = seletor([["", "Boneco simples (padrão)"], ...personagens.map((p) => [p.id, p.nome]), ["importar", "Importar uma personagem .vrm..."]], pref("sala-avatar", (atual && atual.tipo === "vrm" && personagens.some((p) => p.id === atual.id) && atual.id) || ""));
    avatar.setAttribute("aria-label", "Sua personagem");
    const mandar = el("input", { type: "checkbox", checked: pref("sala-mandar", "1") === "1" });
    const codigo = el("input", { class: "lnux-entrada", value: codigoInicial || (sala && sala.codigo) || "", placeholder: "cole o link (ou o código) da sala", "aria-label": "Link ou código da sala", "data-enter-proprio": "1" });
    const podeCriar = LNUX.ponte.disponivel && LNUX.ponte.tem("salas");
    const mapas = podeCriar ? await C.mapas.lista() : [];
    const mapa = seletor([["", "Sem cenário (chão simples)"], ...mapas.map((m) => [m.id, m.nome])], pref("mapa", ""));
    mapa.setAttribute("aria-label", "Cenário da sala");
    const titulo = el("input", { class: "lnux-entrada", value: pref("sala-titulo", "Minha sala"), maxlength: 40, "aria-label": "Nome da sala" });
    let d = null;
    /** Confere o nome e abre a personagem escolhida. Devolve {nome, avatar} (ou null se faltou algo). */
    const preparar = async () => {
      const n = nome.value.trim();
      if (!n) { LNUX.aviso("Diga o seu nome (como os outros vão te ver).", "alerta"); nome.focus(); return null; }
      gravarPref("sala-nome", n);
      gravarPref("sala-mandar", mandar.checked ? "1" : "0");
      if (avatar.value === "importar") { d.fechar(); await importar("zip"); if (atual && atual.tipo === "vrm") gravarPref("sala-avatar", atual.id); janelaSala(codigo.value); return null; }
      gravarPref("sala-avatar", avatar.value);
      const id = avatar.value || (await idDoBoneco());
      if (!atual || atual.id !== id) await abrirPersonagem(id, { saudar: false });
      if (!atual || atual.tipo !== "vrm") throw new Error("Não consegui abrir essa personagem.");
      return { nome: n, avatar: avatar.value ? await avatarParaOsOutros(mandar.checked) : (await C.lerPersonagem(id)).roupas[0].blob }; // o boneco padrão sempre vai
    };
    const entrar = async (cod, criada) => {
      const eu = await preparar();
      if (!eu) return;
      d.fechar();
      $("#palco-carregando").hidden = false;
      try {
        const info = await garantirSala().entrar(cod, eu.nome, eu.avatar, (t) => { $("#palco-carregando").textContent = t; });
        history.replaceState(null, "", location.pathname + location.search + "#sala=" + cod); // recarregar volta para a sala
        listaMsgs.replaceChildren();
        mensagemDaSala({ sistema: true, texto: `Você entrou em "${info.nome}"` + (info.mapa ? `, no cenário "${info.mapa.nome}".` : ".") + " W A S D andam, Shift corre, Espaço pula; escreva aqui para falar com as pessoas." });
        if (criada) mostrarLinks(criada);
      } finally { $("#palco-carregando").hidden = true; atualizarSala(); }
    };
    const criar = async () => {
      gravarPref("sala-titulo", titulo.value.trim() || "Minha sala");
      let m = null;
      if (mapa.value) {
        const reg = mapas.find((x) => x.id === mapa.value), arqs = await C.mapas.ler(mapa.value);
        if (reg && arqs) {
          const glb = arqs.size === 1 && /\.glb$/i.test([...arqs.keys()][0]) ? [...arqs.values()][0] : (await C.conversor.paraGLB(arqs, reg.principal || C.conversor.modelos(arqs)[0])).glb;
          m = { glb, nome: reg.nome, ajuste: reg.ajuste || {} };
        }
      }
      if (!(await preparar())) return;
      const r = await garantirSala().criar(titulo.value.trim() || "Minha sala", m);
      await entrar(r.codigo, r);
    };
    const corpo = el("div", { class: "ajustes" },
      el("div", { class: "grade" }, el("label", { class: "lnux-campo" }, el("span", {}, "Seu nome"), nome), el("label", { class: "lnux-campo" }, el("span", {}, "Sua personagem"), avatar)),
      el("label", { class: "lnux-alternar" }, mandar, "Mostrar minha personagem para os outros (sem isso, eles me veem como um boneco simples)"),
      el("div", { class: "lnux-rotulo" }, "Entrar numa sala"),
      el("div", { class: "linha" }, el("label", { class: "lnux-campo" }, codigo), el("button", { class: "lnux-botao primario", type: "button", id: "sala-entrar", onclick: () => { const c = codigoDe(codigo.value); if (!c) { LNUX.aviso("Cole o link (ou o código) da sala.", "alerta"); codigo.focus(); return; } entrar(c).catch(LNUX.erro); } }, "Entrar")),
      podeCriar ? el("div", { class: "lnux-rotulo" }, "Criar uma sala neste aparelho") : null,
      podeCriar ? el("div", { class: "linha" }, el("label", { class: "lnux-campo" }, el("span", {}, "Nome da sala"), titulo), el("label", { class: "lnux-campo" }, el("span", {}, "Cenário"), mapa),
        el("button", { class: "lnux-botao", type: "button", id: "sala-criar", onclick: () => criar().catch(LNUX.erro) }, "Criar sala")) : null,
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, podeCriar
        ? "A sala fica neste aparelho enquanto o LNUX estiver aberto. Depois de criar, mande o link para as pessoas: elas entram pelo navegador, sem instalar nada. Os cenários vêm de Movimento › Cenário."
        : "Para entrar, basta o link que a pessoa que criou a sala mandou. Para criar uma sala, abra a Companhia pelo LNUX (🌐 Apps Web) no aparelho que vai ser o servidor."));
    codigo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#sala-entrar").click(); } });
    d = LNUX.dialogo({ titulo: "Jogar com outras pessoas", corpo, largo: true, botoes: [{ rotulo: "Fechar", valor: null }] });
    return d;
  }
  /** Os links da sala para mandar aos outros (o do túnel, o da rede de casa e o deste endereço). */
  function mostrarLinks(criada) {
    if (!sala || !sala.codigo) return;
    const caminho = location.pathname + "#sala=" + sala.codigo;
    const publicos = ((criada && criada.enderecos) || sala.enderecos || []).map((e) => e + caminho);
    if (criada) sala.enderecos = criada.enderecos || [];
    const local = /^(127\.|localhost|\[::1\])/.test(location.hostname);
    const links = [...new Set([...publicos, ...(local && publicos.length ? [] : [location.origin + caminho])])];
    LNUX.dialogo({ titulo: "Link da sala", largo: true, botoes: [{ rotulo: "Fechar", primario: true, valor: null }], corpo: el("div", { class: "ajustes" },
      el("p", { style: { margin: 0 } }, "Mande este link para quem vai jogar. A pessoa abre no navegador, escolhe um nome e entra:"),
      ...links.map((l) => el("div", { class: "linha link-sala" }, el("input", { class: "lnux-entrada", value: l, readonly: true, "aria-label": "Link da sala" }), el("button", { class: "lnux-botao", type: "button", onclick: () => copiar(l) }, "Copiar"))),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, local && !publicos.length
        ? "Este endereço (127.0.0.1) só vale neste aparelho. Para pessoas de fora entrarem, ligue no LNUX o compartilhamento dos Apps Web pela internet (o túnel) e crie a sala abrindo a Companhia pelo endereço do túnel; na rede de casa, abra o servidor para a rede e use o endereço com o IP do aparelho."
        : "A sala existe enquanto o servidor deste aparelho estiver ligado. O link só dá acesso à sala (o cenário, os avatares e o bate-papo): quem entra não vê as suas pastas nem usa a ponte.")) });
  }
  async function sairDaSala(fechar) {
    if (!sala || !sala.dentro) return;
    if (fechar) await sala.fechar(); else await sala.sair();
    history.replaceState(null, "", location.pathname + location.search + "#modo=jogar");
    mensagemDaSala({ sistema: true, texto: fechar ? "Você fechou a sala." : "Você saiu da sala." });
    atualizarSala();
  }
  /** Quem criou a sala troca o cenário dela: todos passam para o novo. */
  async function trocarMapaDaSala() {
    if (!sala || !sala.dentro || !sala.chave) return;
    const mapas = await C.mapas.lista();
    const sel = seletor([["", "Sem cenário (chão simples)"], ...mapas.map((m) => [m.id, m.nome])], "");
    if (!(await LNUX.dialogo({ titulo: "Trocar o cenário da sala", corpo: el("div", { class: "ajustes" }, el("label", { class: "lnux-campo" }, el("span", {}, "Cenário (os de Movimento › Cenário)"), sel)), botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Trocar", primario: true, valor: true }] }))) return;
    if (!sel.value) { await C.salaPedir("DELETE", sala.codigo + "/mapa", { chave: sala.chave }); return; }
    const reg = mapas.find((x) => x.id === sel.value), arqs = await C.mapas.ler(sel.value);
    const glb = arqs.size === 1 && /\.glb$/i.test([...arqs.keys()][0]) ? [...arqs.values()][0] : (await C.conversor.paraGLB(arqs, reg.principal || C.conversor.modelos(arqs)[0])).glb;
    await sala.mandarMapa(sala.codigo, { glb, nome: reg.nome, ajuste: reg.ajuste || {} });
  }
  /** Gestos e expressões que os outros veem. */
  function barraDeGestos() {
    const rosto = (emoji, emocao, dica) => el("button", { type: "button", title: dica, "aria-label": dica, onclick: () => { palco.definirEmocao(emocao); clearTimeout(voltarNeutraT); if (emocao !== "neutra") voltarNeutraT = setTimeout(() => palco.definirEmocao("neutra"), 8000); } }, emoji);
    $("#gestos").replaceChildren(
      el("button", { type: "button", title: "Acenar", "aria-label": "Acenar", onclick: () => { palco.gesto("acenar"); if (sala) sala.gestoMeu("acenar"); } }, "👋"),
      rosto("😀", "feliz", "Feliz"), rosto("😂", "rindo", "Rindo"), rosto("😮", "surpresa", "Surpresa"), rosto("😢", "triste", "Triste"), rosto("😠", "brava", "Brava"), rosto("😐", "neutra", "Neutra"));
  }
  /** O começo do modo de jogar: sem o núcleo do Live2D nem a memória; abre a janela da sala (com o código do link, se veio). */
  async function iniciarJogo() {
    live2d = null;
    barraDeGestos();
    await mostrarVazio();
    atualizarSala();
    await janelaSala(fragmento.get("sala") || "");
  }
  /** Pergunta de novo o que a pessoa quer fazer (recarrega sem o modo no endereço). */
  async function trocarModo() {
    if (sala && sala.dentro) await sala.sair();
    history.replaceState(null, "", location.pathname + location.search);
    location.reload();
  }
  /** Antes de entrar: conversar com o chat bot ou jogar com outras pessoas? */
  async function escolherModo() {
    if (MODO) return MODO;
    let d = null;
    const cartao = (modo, emoji, titulo, texto) => el("button", { class: "cartao-modo", type: "button", "data-modo": modo, onclick: () => d.fechar(modo) }, el("span", { class: "emoji" }, emoji), el("b", {}, titulo), el("span", { class: "fraco" }, texto));
    d = LNUX.dialogo({ titulo: "Companhia", largo: true, botoes: [], corpo: el("div", { class: "escolha-modo" },
      el("p", { style: { margin: 0 } }, "O que você quer fazer?"),
      el("div", { class: "cartoes" },
        cartao("conversa", "💬", "Conversar com a personagem", "O chat bot: ela responde (com uma IA ou sem), fala, reage aos toques e lembra de você."),
        cartao("jogar", "🎮", "Jogar com outras pessoas", "Entrar num cenário com outras pessoas, pelo link de uma sala. Sem chat bot nem IA: quem fala são as pessoas."))) });
    return (await d) || "conversa";
  }

  // ── Menus ────────────────────────────────────────────────────────────

  const comPersonagem = () => !!atual;
  const menus = [
    { rotulo: "Personagem", itens: [
      { rotulo: "Importar ZIP ou .vrm...", atalho: "Ctrl+O", acao: () => importar("zip") },
      { rotulo: "Importar avatar do Unity (.unitypackage, .fbx)...", acao: () => importar("avatar") },
      { rotulo: "Importar pasta...", acao: () => importar("pasta") },
      { rotulo: "Trocar de personagem...", atalho: "Ctrl+P", acao: janelaTrocar },
      "-",
      { rotulo: "Perfil e personalidade...", acao: janelaPerfil, ativo: comPersonagem },
      { rotulo: "Emoções e expressões...", acao: janelaEmocoes, ativo: comPersonagem },
      { rotulo: "Áreas de toque...", acao: editarZonas, ativo: comPersonagem },
      { rotulo: "Voz desta personagem...", acao: () => janelaVoz(true), ativo: comPersonagem },
      { rotulo: "Roupas...", acao: janelaRoupas, ativo: comPersonagem },
      "-",
      { rotulo: "Exportar personagem (ZIP)...", acao: exportarPersonagem, ativo: comPersonagem },
      { rotulo: "Apagar esta personagem...", acao: apagarPersonagem, ativo: comPersonagem },
    ] },
    { rotulo: "Conversa", itens: [
      { rotulo: "Nova conversa", atalho: "Ctrl+Shift+N", acao: novaConversa, ativo: comPersonagem },
      { rotulo: "O que ela lembra (memória)...", atalho: "Ctrl+M", acao: janelaMemoria, ativo: comPersonagem },
      { rotulo: "Histórico...", atalho: "Ctrl+H", acao: janelaHistorico, ativo: comPersonagem },
      "-",
      { rotulo: "Exportar memória (JSON)...", acao: exportarMemoria, ativo: comPersonagem },
      { rotulo: "Importar memória...", acao: importarMemoria, ativo: comPersonagem },
      "-",
      { rotulo: "Parar de falar", atalho: "Esc", acao: () => { voz.parar(); if (pedido) pedido.abort(); } },
    ] },
    { rotulo: "IA", itens: [
      { rotulo: "Provedores e chaves...", acao: janelaProvedores },
      { rotulo: "Rotas e economia de tokens...", acao: janelaRotas },
      "-",
      { rotulo: "Responder o simples sem IA", marcado: () => ia.config.motorLocal === "simples", acao: () => { ia.config.motorLocal = "simples"; ia.salvar(); atualizarSeloIA(); } },
      { rotulo: "Só o motor local (sem IA)", marcado: () => ia.config.motorLocal === "sempre", acao: () => { ia.config.motorLocal = "sempre"; ia.salvar(); atualizarSeloIA(); } },
      { rotulo: "Tudo pela IA", marcado: () => ia.config.motorLocal === "nunca", acao: () => { ia.config.motorLocal = "nunca"; ia.salvar(); atualizarSeloIA(); } },
      "-",
      { rotulo: "Toques e saudações pela IA", marcado: () => ia.config.toquesComIA, acao: () => { ia.config.toquesComIA = !ia.config.toquesComIA; ia.salvar(); } },
    ] },
    { rotulo: "Voz", itens: [
      { rotulo: "Configurar voz...", acao: () => janelaVoz(false) },
      { rotulo: "Falar as respostas", marcado: () => voz.config.falar, acao: () => { voz.config.falar = !voz.config.falar; voz.salvar(); $("#opcao-falar").checked = voz.config.falar; if (!voz.config.falar) voz.parar(); } },
      { rotulo: "Mãos livres (conversa por voz)", marcado: () => $("#opcao-maos-livres").checked, acao: () => { const c = $("#opcao-maos-livres"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); } },
      { rotulo: "Ouvir (microfone)", atalho: "Ctrl+Shift+M", acao: ouvir, ativo: comPersonagem },
      { rotulo: "Testar a voz", acao: () => { voz.destravar(); voz.parar(); voz.falar("Oi! Tudo bem? Essa é a minha voz.", "feliz"); } },
    ] },
    { rotulo: "Movimento", itens: estudio.itensDoMenu() },
    { rotulo: "Exibir", itens: [
      { rotulo: "Rosto", acao: () => enquadrar("rosto"), ativo: comPersonagem, marcado: () => palco.enquadramento.modo === "rosto" },
      { rotulo: "Busto", acao: () => enquadrar("busto"), ativo: comPersonagem, marcado: () => palco.enquadramento.modo === "busto" },
      { rotulo: "Corpo inteiro", acao: () => enquadrar("corpo"), ativo: comPersonagem, marcado: () => palco.enquadramento.modo === "corpo" },
      { rotulo: "Posição e tamanho...", acao: janelaPosicao, ativo: comPersonagem },
      { rotulo: "Qualidade das texturas...", acao: janelaQualidade },
      "-",
      { rotulo: "Mostrar áreas de toque", marcado: () => mostrarZonas, acao: () => { mostrarZonas = !mostrarZonas; desenharZonas(); } },
      { rotulo: "Mostrar atalhos de expressão", marcado: () => pref("atalhos", "1") === "1", acao: () => { gravarPref("atalhos", pref("atalhos", "1") === "1" ? "0" : "1"); desenharAtalhos(); } },
      { rotulo: "Luz e sombras realistas (no cenário)", marcado: () => !!(palco.luzCfg && palco.luzCfg.realista), acao: () => palco.definirLuz({ realista: !palco.luzCfg.realista }), ativo: () => !!(atual && atual.tipo === "vrm") },
      { rotulo: "Fundo...", acao: janelaFundo },
      { rotulo: "Salvar foto (PNG)...", acao: foto, ativo: comPersonagem },
      { rotulo: "Tela cheia", atalho: "F11", acao: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) },
    ] },
    { rotulo: "Ajuda", itens: [
      { rotulo: "Primeiros passos", acao: ajuda },
      { rotulo: "Diagnóstico (personagem preta ou lenta)...", acao: janelaQualidade },
      { rotulo: "Núcleo do Live2D...", acao: () => { const c = el("div", { class: "nucleo" }); desenharAvisoNucleo(c); if (live2d) c.prepend(el("p", { style: { margin: "0 0 6px" } }, `✓ Núcleo carregado (${({ ponte: "guardado pela ponte", navegador: "guardado no navegador", vendor: "vendor/", oficial: "site oficial", pronto: "já carregado" })[live2d]}).`)); LNUX.dialogo({ titulo: "Núcleo do Live2D", corpo: c, botoes: [{ rotulo: "Fechar", valor: null }] }); } },
      { rotulo: "Créditos e licenças", acao: creditos },
      { rotulo: "Atalhos de teclado", acao: () => LNUX.ajudaAtalhos() },
    ] },
  ];

  /** Os menus do modo escolhido. Jogando, somem a conversa com o chat bot, a IA, a voz e a memória; entra o menu Sala. */
  function menusDoModo() {
    const trocar = { rotulo: jogando() ? "Trocar de modo (conversar com a personagem)..." : "Trocar de modo (jogar com outras pessoas)...", acao: trocarModo };
    if (!jogando()) return menus.map((m) => (m.rotulo === "Ajuda" ? { ...m, itens: [...m.itens, "-", trocar] } : m));
    const naSala = () => !!(sala && sala.dentro), dono = () => naSala() && !!sala.chave;
    const semIA = new Set(["Perfil e personalidade...", "Emoções e expressões...", "Áreas de toque...", "Voz desta personagem...", "Mostrar áreas de toque", "Primeiros passos", "Núcleo do Live2D..."]);
    const menuSala = { rotulo: "Sala", itens: [
      { rotulo: "Criar ou entrar numa sala...", acao: () => janelaSala() },
      { rotulo: "Link da sala...", acao: () => mostrarLinks(), ativo: naSala },
      { rotulo: "Pessoas na sala", ativo: naSala, acao: () => LNUX.dialogo({ titulo: `${sala.info.nome}: ${sala.pessoas} ${sala.pessoas === 1 ? "pessoa" : "pessoas"}`, corpo: el("div", { class: "ajustes" }, el("div", {}, sala.eu.nome + " (você)"), ...[...sala.remotos.values()].map((r) => el("div", {}, r.nome))), botoes: [{ rotulo: "Fechar", primario: true, valor: null }] }) },
      { rotulo: "Trocar o cenário da sala...", acao: () => trocarMapaDaSala().catch(LNUX.erro), ativo: dono },
      { rotulo: "Ver as personagens dos outros (senão, bonecos)", marcado: () => garantirSalaCfg().avatares, acao: () => { const c = garantirSalaCfg(); c.avatares = !c.avatares; LNUX.preferencia.gravar("companhia.sala", JSON.stringify(c)); if (sala) { sala.cfg.avatares = c.avatares; for (const r of sala.remotos.values()) r.buscarAvatar(); } } },
      "-",
      { rotulo: "Sair da sala", acao: () => sairDaSala(false).catch(LNUX.erro), ativo: naSala },
      { rotulo: "Fechar a sala para todos", acao: () => sairDaSala(true).catch(LNUX.erro), ativo: dono },
      "-", trocar,
    ] };
    const ajudaJogo = { rotulo: "Como jogar", acao: () => LNUX.dialogo({ titulo: "Jogar com outras pessoas", largo: true, botoes: [{ rotulo: "Entendi", primario: true, valor: true }], corpo: el("div", { class: "ajustes" },
      el("p", { style: { margin: 0 } }, el("b", {}, "Entrar: "), "abra o link que a pessoa mandou (ou Sala › Criar ou entrar e cole o link), escolha um nome e uma personagem. Sem uma personagem .vrm, você entra com um boneco simples."),
      el("p", { style: { margin: 0 } }, el("b", {}, "Criar uma sala: "), "abra a Companhia pelo LNUX (a ponte), escolha o cenário (os de Movimento › Cenário; qualquer mapa é convertido para .glb) e mande o link. Para pessoas de fora, o LNUX precisa estar com os Apps Web compartilhados pela internet (o túnel)."),
      el("p", { style: { margin: 0 } }, el("b", {}, "Andar: "), "W A S D ou as setas, Shift corre, Espaço pula, arrastar gira a câmera. No celular, o direcional da tela."),
      el("p", { style: { margin: 0 } }, el("b", {}, "Interagir: "), "escreva na caixa de texto (aparece um balão em cima da sua personagem), use os gestos e as expressões embaixo do palco e, com Movimento › Captura de movimento, mexa os braços, as mãos e o rosto da personagem pela câmera: os outros veem."),
      el("p", { class: "fraco", style: { margin: 0 } }, "Neste modo não há chat bot nem funções de IA. O link só dá acesso à sala, nunca às pastas do aparelho de quem criou.")) }) };
    return [menus[0], menuSala, ...menus.slice(1)].filter((m) => !["Conversa", "IA", "Voz"].includes(m.rotulo))
      .map((m) => ({ ...m, itens: [...(m.rotulo === "Ajuda" ? [ajudaJogo] : []), ...m.itens.filter((i) => typeof i === "string" || !semIA.has(i.rotulo))] }));
  }
  const garantirSalaCfg = () => { if (sala) return sala.cfg; try { return Object.assign({ avatares: true }, JSON.parse(pref("sala", "{}") || "{}")); } catch (e) { return { avatares: true }; } };

  // ── Entrada de texto e controles ─────────────────────────────────────

  function ajustarCampo() { campo.style.height = "auto"; campo.style.height = Math.min(140, campo.scrollHeight + 2) + "px"; }
  campo.addEventListener("input", ajustarCampo);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(campo.value); }
    if (e.key === "Escape") { voz.parar(); if (pedido) pedido.abort(); }
  });
  $("#form-entrada").addEventListener("submit", (e) => { e.preventDefault(); enviar(campo.value); });
  $("#botao-enviar").innerHTML = LNUX.icone("play");
  $("#botao-mic").innerHTML = LNUX.icone("microfone");
  $("#botao-mic").addEventListener("click", ouvir);
  if (!voz.podeOuvir()) $("#botao-mic").title = "Este navegador não reconhece fala (use Chrome, Edge ou Safari)";
  $("#opcao-falar").checked = voz.config.falar;
  $("#opcao-falar").addEventListener("change", (e) => { voz.config.falar = e.target.checked; voz.salvar(); if (!e.target.checked) voz.parar(); });
  $("#opcao-maos-livres").checked = pref("maos-livres", "0") === "1";
  $("#opcao-maos-livres").addEventListener("change", (e) => { gravarPref("maos-livres", e.target.checked ? "1" : "0"); if (e.target.checked && !voz.podeOuvir()) LNUX.aviso("Este navegador não reconhece fala.", "alerta"); });
  for (const b of $("#enquadramento").children) b.addEventListener("click", () => enquadrar(b.dataset.modo));
  $("#vazio-zip").addEventListener("click", () => importar("zip"));
  $("#vazio-pasta").addEventListener("click", () => importar("pasta"));
  $("#botoes-conversa").append(
    LNUX.botaoIcone("mais", "Nova conversa", novaConversa),
    LNUX.botaoIcone("info", "O que ela lembra", janelaMemoria));
  $("#marca-icone").innerHTML = LNUX.icone("ia");
  $("#chip-roupa").addEventListener("click", menuRoupa);
  $("#chip-sala").addEventListener("click", () => { if (sala && sala.dentro) mostrarLinks(); else janelaSala(); });
  window.addEventListener("pagehide", () => { if (sala && sala.dentro) sala.sair(); });
  $("#chip-movimento").addEventListener("click", () => { const r = $("#chip-movimento").getBoundingClientRect(); LNUX.abrirMenu(estudio.itensDoMenu(), r.left, r.bottom + 4, $("#chip-movimento")); });
  palco.on("mundo", () => atualizarChipMovimento());
  palco.on("movimento-terminou", () => estudio.atualizar());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".lnux-fundo-modal") && (voz.falando() || pedido)) { voz.parar(); if (pedido) pedido.abort(); } });
  // destrava o som no primeiro toque em qualquer lugar
  document.addEventListener("pointerdown", () => voz.destravar(), { once: true });
  // cópia automática da memória no aparelho ao sair
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") palco.pausar(); else palco.continuar(); // aba escondida não gasta bateria
    if (document.visibilityState === "hidden" && atual && LNUX.ponte.disponivel && pref("copia-auto", "0") === "1") mem.copiarParaAparelho(atual.id, atual.perfil.nome).catch(() => {});
  });

  // ── Começar ──────────────────────────────────────────────────────────

  escolherModo().then((modo) => {
    MODO = modo;
    document.documentElement.dataset.modo = modo;
    return LNUX.iniciar({
      app: "companhia", nome: "Companhia",
      descricao: "Converse com personagens Live2D (como os do VTube Studio) ou VRoid (.vrm): chat com IA ou motor local, voz, expressões, toques e memória no aparelho; nas VRoid, captura de movimento pela câmera, pacotes de movimento, cenários para andar e salas para jogar com outras pessoas.",
      layouts: [
        { id: "lado", nome: jogando() ? "Personagem e sala" : "Personagem e conversa", descricao: "A personagem e a conversa lado a lado", icone: "layout" },
        { id: "foco", nome: "Foco na personagem", descricao: "A personagem grande, a conversa flutuando", icone: "imagem" },
        { id: "celular", nome: "Celular", descricao: "Personagem em cima, conversa embaixo", icone: "tela", celular: true },
      ],
      menus: menusDoModo(),
      aoMudarLayout: () => setTimeout(() => palco.enquadrar(), 50),
    });
  }).then(async () => {
    aplicarFundo();
    if (jogando()) { await iniciarJogo(); return; } // jogar: nada de IA, voz, memória nem núcleo do Live2D
    atualizarSeloIA();
    atualizarGasto();
    await ia.atualizarChaves();
    await tentarNucleo(false);
  }).catch(LNUX.erro);

  // Para os testes automáticos e para quem quiser mexer pelo console
  window.Companhia = {
    palco, ia, voz, mem, enviar, abrirPersonagem, importarPacote, tentarNucleo, instalarNucleo, vestir, janelaRoupas, captura, estudio, janelaSala,
    get sala() { return sala; }, get modo() { return MODO; },
    get atual() { return atual; }, get estado() { return est; }, get live2d() { return live2d; }, get respondendo() { return respondendo; }, get pronto() { return pronto; },
  };
})();
