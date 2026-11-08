/*
 * Vídeo — editor de vídeo (interface).
 *
 * Projeto (JSON): mídias (só os dados: nome, tipo, duração, tamanho, miniatura e, se veio da ponte, o
 * caminho no aparelho), trilhas (de vídeo, em cima, e de áudio, embaixo) e clipes. Os arquivos das mídias
 * que vieram do navegador ficam guardados no IndexedDB; os que vieram da ponte são abertos de novo pelo
 * caminho. "Salvar projeto" gera um .lnuxvideo (ZIP com o projeto.json e as mídias do navegador).
 */
(function () {
  "use strict";

  const { el, icone, $, limitar } = LNUX;
  const { Motor, LOOKS } = VideoMotor;

  const canvas = $("#quadro");
  const motor = new Motor(canvas);

  const RESOLUCOES = [
    ["1920x1080", "1920 × 1080 (Full HD)"], ["1280x720", "1280 × 720 (HD)"], ["854x480", "854 × 480"],
    ["1080x1920", "1080 × 1920 (vertical: Reels, TikTok, Shorts)"], ["1080x1080", "1080 × 1080 (quadrado)"], ["720x1280", "720 × 1280 (vertical leve)"],
  ];
  const FONTES = [
    ["system-ui, sans-serif", "Sem serifa"], ["Georgia, 'Times New Roman', serif", "Com serifa"],
    ["'Arial Black', Impact, sans-serif", "Pesada (títulos)"], ["ui-monospace, 'DejaVu Sans Mono', monospace", "Máquina de escrever"],
    ["'Comic Sans MS', 'Comic Neue', cursive", "Escrita à mão"],
  ];
  const TRANSICOES = [["nenhuma", "Nenhuma"], ["dissolver", "Dissolver"], ["deslizar", "Deslizar"], ["cortina", "Cortina"], ["zoom", "Zoom"]];

  // ── Estado ──────────────────────────────────────────────────────────

  function novoProjeto() {
    return {
      versao: 1, nome: "Projeto sem nome", largura: 1280, altura: 720, fps: 30, fundo: "#000000",
      midias: {},
      trilhas: [
        { id: LNUX.id("t"), tipo: "video", nome: "Vídeo 2" },
        { id: LNUX.id("t"), tipo: "video", nome: "Vídeo 1" },
        { id: LNUX.id("t"), tipo: "audio", nome: "Áudio 1" },
        { id: LNUX.id("t"), tipo: "audio", nome: "Áudio 2" },
      ],
      clipes: [], marcadores: [],
    };
  }

  let projeto = novoProjeto();
  const arquivos = new Map(); // id da mídia → Blob (as que vieram do navegador)
  const guardados = new Set();
  const picos = new Map(); // id da mídia → {taxa, min, max}
  const miniaturas = new Map(); // id da mídia → Image
  let selecao = new Set();
  let trilhaEscolhida = null;
  let midiaEscolhida = null;
  let cursor = 0;
  let pxs = 40;
  let ima = true;
  let ferramenta = "selecionar";
  let tocando = false, inicioReal = 0, inicioProj = 0;
  let exportando = null;
  let caminhoProjeto = null;
  let copiados = [];

  const hist = new LNUX.Historico(() => projeto, (estado) => {
    projeto = estado;
    selecao = new Set([...selecao].filter((id) => projeto.clipes.some((c) => c.id === id)));
    mudou();
  });

  const trilhaPorId = (id) => projeto.trilhas.find((t) => t.id === id);
  const clipePorId = (id) => projeto.clipes.find((c) => c.id === id);
  const indiceDaTrilha = (id) => projeto.trilhas.findIndex((t) => t.id === id);
  const duracaoProjeto = () => projeto.clipes.reduce((m, c) => Math.max(m, c.inicio + c.duracao), 0);
  const alturaTrilha = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--altura-trilha")) || 54;
  const quadro = () => 1 / projeto.fps;
  const tipoDaTrilhaPara = (c) => (c.tipo === "texto" || (projeto.midias[c.midia] || {}).tipo !== "audio" ? "video" : "audio");
  const escolhidos = () => projeto.clipes.filter((c) => selecao.has(c.id));

  // ── Elementos ───────────────────────────────────────────────────────

  const regua = $("#regua"), pistas = $("#pistas"), rolagem = $("#rolagem"), espaco = $("#espaco"), cabecalhos = $("#cabecalhos");
  const corpoProps = $("#corpo-propriedades"), listaMidias = $("#lista-midias");
  $("#marca-icone").innerHTML = icone("video");

  const botoes = {};
  for (const [id, ic, dica, acao] of [
    ["inicio", "inicio", "Início (Home)", () => irPara(0)],
    ["voltar", "voltar", "Quadro anterior (←)", () => irPara(cursor - quadro())],
    ["tocar", "play", "Tocar / pausar (Espaço)", () => alternarPlay()],
    ["avancar", "avancar", "Próximo quadro (→)", () => irPara(cursor + quadro())],
    ["fim", "fim", "Fim (End)", () => irPara(duracaoProjeto())],
  ]) { botoes[id] = LNUX.botaoIcone(ic, dica, acao); $("#botoes-transporte").append(botoes[id]); }
  for (const [id, ic, dica, acao] of [
    ["desfazer", "desfazer", "Desfazer (Ctrl+Z)", () => hist.desfazer()],
    ["refazer", "refazer", "Refazer (Ctrl+Shift+Z)", () => hist.refazer()],
    ["separar", "cortar", "Separar no cursor (S)", () => separarNoCursor()],
    ["apagar", "lixo", "Apagar (Del)", () => apagar()],
    ["ima", "ima", "Ímã: encaixar nas bordas e no cursor", () => { ima = !ima; atualizarBotoes(); }],
    ["marcador", "bandeira", "Marcador no cursor (M)", () => adicionarMarcador()],
  ]) { botoes[id] = LNUX.botaoIcone(ic, dica, acao); $("#botoes-edicao").append(botoes[id]); }
  $("#botoes-zoom").append(
    LNUX.botaoIcone("zoom-menos", "Afastar (-)", () => zoom(1 / 1.5)),
    LNUX.botaoIcone("zoom-mais", "Aproximar (+)", () => zoom(1.5)),
    LNUX.botaoIcone("layout", "Ver tudo (0)", () => verTudo()));

  function atualizarBotoes() {
    botoes.tocar.innerHTML = icone(tocando ? "pausa" : "play");
    botoes.ima.setAttribute("aria-pressed", String(ima));
    botoes.desfazer.disabled = !hist.podeDesfazer();
    botoes.refazer.disabled = !hist.podeRefazer();
    pistas.style.cursor = ferramenta === "cortar" ? "crosshair" : "default";
  }
  hist.aoMudar = atualizarBotoes;

  // ── Mídias ──────────────────────────────────────────────────────────

  function tipoDaMidia(nome, mime) {
    mime = mime || LNUX.mimeDe(nome);
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("image/")) return "imagem";
    return null;
  }

  /** Lê duração, tamanho e uma miniatura da mídia (carregando num elemento à parte). */
  function analisarMidia(url, tipo) {
    return new Promise((resolver, rejeitar) => {
      const tempo = setTimeout(() => rejeitar(new Error("A mídia demorou demais para abrir.")), 20000);
      if (tipo === "imagem") {
        const img = new Image();
        img.onload = () => { clearTimeout(tempo); resolver({ duracao: 5, largura: img.naturalWidth, altura: img.naturalHeight, miniatura: miniaturaDe(img, img.naturalWidth, img.naturalHeight) }); };
        img.onerror = () => { clearTimeout(tempo); rejeitar(new Error("O navegador não abriu esta imagem.")); };
        img.src = url;
        return;
      }
      const m = document.createElement(tipo === "audio" ? "audio" : "video");
      m.preload = "auto";
      m.muted = true;
      m.onerror = () => { clearTimeout(tempo); rejeitar(new Error("O navegador não abre este formato.")); };
      m.onloadedmetadata = () => {
        const duracao = isFinite(m.duration) ? m.duration : 0;
        if (tipo === "audio") { clearTimeout(tempo); resolver({ duracao, largura: 0, altura: 0, miniatura: null }); return; }
        m.currentTime = Math.min(1, duracao / 3);
        m.onseeked = () => { clearTimeout(tempo); resolver({ duracao, largura: m.videoWidth, altura: m.videoHeight, miniatura: miniaturaDe(m, m.videoWidth, m.videoHeight) }); m.removeAttribute("src"); m.load(); };
      };
      m.src = url;
    });
  }
  function miniaturaDe(fonte, w, h) {
    const c = document.createElement("canvas");
    c.width = 160; c.height = 90;
    const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, 160, 90);
    const e = Math.min(160 / w, 90 / h);
    try { x.drawImage(fonte, (160 - w * e) / 2, (90 - h * e) / 2, w * e, h * e); } catch (err) { return null; }
    return c.toDataURL("image/jpeg", 0.7);
  }

  /** Forma de onda (picos) do som da mídia, em segundo plano. */
  async function calcularPicos(id) {
    const m = projeto.midias[id];
    if (!m || m.tipo === "imagem" || picos.has(id)) return;
    try {
      let dados;
      if (arquivos.has(id)) { if (arquivos.get(id).size > 120e6) return; dados = await arquivos.get(id).arrayBuffer(); }
      else if (m.caminho && LNUX.ponte.disponivel) { if ((m.tamanho || 0) > 120e6) return; dados = await LNUX.ponte.ler(m.caminho, "arraybuffer"); }
      else return;
      const ctx = motor.garantirAudio();
      const b = await ctx.decodeAudioData(dados);
      const taxa = 100, passo = Math.floor(b.sampleRate / taxa), n = Math.ceil(b.length / passo);
      const min = new Float32Array(n), max = new Float32Array(n), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) {
        let mi = 0, ma = 0;
        for (let j = i * passo, f = Math.min(b.length, j + passo); j < f; j++) { const v = d[j]; if (v < mi) mi = v; if (v > ma) ma = v; }
        min[i] = mi; max[i] = ma;
      }
      picos.set(id, { taxa, min, max });
      redesenhar();
    } catch (e) { picos.set(id, null); /* vídeo sem som, ou formato que o Web Audio não abre */ }
  }

  function urlDaMidia(id) {
    const m = projeto.midias[id];
    if (!m) return null;
    if (arquivos.has(id)) return motor.urls.get(id) || URL.createObjectURL(arquivos.get(id));
    if (m.caminho && LNUX.ponte.disponivel) return LNUX.ponte.url(m.caminho);
    return null;
  }
  function registrarUrl(id) {
    const u = urlDaMidia(id);
    if (u) motor.urls.set(id, u); else motor.urls.delete(id);
    const m = projeto.midias[id];
    if (m && m.miniatura && !miniaturas.has(id)) { const img = new Image(); img.src = m.miniatura; miniaturas.set(id, img); img.onload = redesenhar; }
  }

  async function adicionarArquivos(lista, destino = null) {
    if (!lista.length) return [];
    const p = lista.length > 1 ? LNUX.progresso("Abrindo as mídias") : null;
    const novas = [];
    try {
      for (const [i, arq] of lista.entries()) {
        p && p.definir(i / lista.length, arq.nome);
        const tipo = tipoDaMidia(arq.nome, arq.tipo);
        if (!tipo) { LNUX.aviso(`${arq.nome}: não é vídeo, áudio nem imagem.`, "alerta"); continue; }
        const id = LNUX.id("m");
        let url;
        if (arq.origem === "ponte") url = arq.url;
        else { const blob = await arq.blob(); arquivos.set(id, blob); url = URL.createObjectURL(blob); }
        try {
          const info = await analisarMidia(url, tipo);
          projeto.midias[id] = { nome: arq.nome, tipo, mime: arq.tipo, tamanho: arq.tamanho, caminho: arq.origem === "ponte" ? arq.caminho : null, ...info };
          motor.urls.set(id, url);
          registrarUrl(id);
          novas.push(id);
          calcularPicos(id);
        } catch (e) {
          arquivos.delete(id);
          const dica = LNUX.ponte.tem("ffmpeg") ? " Converta antes para MP4 (no LNUX: 🎬 Vídeos › converter) ou WebM." : "";
          LNUX.aviso(`${arq.nome}: ${e.message}${dica}`, "erro");
        }
      }
    } finally { p && p.fechar(); }
    if (novas.length) {
      midiaEscolhida = novas[novas.length - 1];
      if (destino) { hist.marcar("Pôr na linha do tempo"); for (const id of novas) colocarNaLinha(id, destino.trilha, destino.tempo, true); }
      mudou();
      guardarDepois();
    }
    return novas;
  }

  async function importar() {
    const lista = await LNUX.arquivos.abrir({ titulo: "Importar mídias", aceitar: "video/*,audio/*,image/*", multiplos: true });
    await adicionarArquivos(lista);
  }

  function desenharMidias() {
    const ids = Object.keys(projeto.midias);
    if (!ids.length) {
      listaMidias.replaceChildren(el("div", { class: "lnux-vazio", style: { gridColumn: "1 / -1" }, html: icone("importar") + "<div>Arraste vídeos, músicas e fotos para cá, ou use <strong>Importar</strong>.</div>" }));
      return;
    }
    listaMidias.replaceChildren(...ids.map((id) => {
      const m = projeto.midias[id];
      const falta = !motor.urls.get(id);
      const mini = el("div", { class: "miniatura", style: m.miniatura ? { backgroundImage: `url(${m.miniatura})` } : {} },
        m.miniatura ? null : el("span", { html: icone(m.tipo === "audio" ? "musica" : m.tipo === "imagem" ? "imagem" : "video") }),
        m.tipo !== "imagem" ? el("span", { class: "dur" }, LNUX.tempo(m.duracao).replace(/\.\d+$/, "")) : null,
        falta ? el("span", { class: "falta" }, "faltando — clique com o direito para achar") : null);
      const item = el("div", {
        class: "midia" + (midiaEscolhida === id ? " escolhida" : ""), draggable: "true", title: `${m.nome}\n${m.largura ? m.largura + "×" + m.altura + " · " : ""}${LNUX.tempo(m.duracao)}`,
        onclick: () => { midiaEscolhida = id; desenharMidias(); },
        ondblclick: () => { hist.marcar("Pôr na linha do tempo"); colocarNaLinha(id, null, cursor); mudou(); },
        ondragstart: (e) => { e.dataTransfer.setData("text/x-lnux-midia", id); e.dataTransfer.effectAllowed = "copy"; },
        oncontextmenu: (e) => {
          e.preventDefault();
          LNUX.abrirMenu([
            { rotulo: "Pôr na linha do tempo (no cursor)", acao: () => { hist.marcar("Pôr na linha do tempo"); colocarNaLinha(id, null, cursor); mudou(); } },
            { rotulo: "Achar o arquivo (trocar)...", acao: () => reencontrar(id) },
            "-",
            { rotulo: "Tirar do projeto", acao: () => tirarMidia(id) },
          ], e.clientX, e.clientY);
        },
      }, mini, el("div", { class: "nome" }, m.nome));
      return item;
    }));
  }

  async function reencontrar(id) {
    const m = projeto.midias[id];
    const [arq] = await LNUX.arquivos.abrir({ titulo: `Achar "${m.nome}"`, aceitar: m.tipo === "imagem" ? "image/*" : m.tipo === "audio" ? "audio/*" : "video/*" });
    if (!arq) return;
    hist.marcar("Trocar o arquivo da mídia");
    if (arq.origem === "ponte") { arquivos.delete(id); m.caminho = arq.caminho; motor.urls.set(id, arq.url); }
    else { const b = await arq.blob(); arquivos.set(id, b); guardados.delete(id); m.caminho = null; motor.urls.set(id, URL.createObjectURL(b)); }
    for (const c of projeto.clipes) if (c.midia === id) motor.descartar(c.id);
    picos.delete(id);
    calcularPicos(id);
    mudou();
  }

  function tirarMidia(id) {
    const usado = projeto.clipes.some((c) => c.midia === id);
    hist.marcar("Tirar mídia");
    if (usado) projeto.clipes = projeto.clipes.filter((c) => c.midia !== id);
    delete projeto.midias[id];
    mudou();
  }

  LNUX.soltarArquivos(listaMidias, (lista) => adicionarArquivos(lista));
  LNUX.soltarArquivos($("#tela"), (lista) => adicionarArquivos(lista, { trilha: null, tempo: cursor }));

  // ── Clipes ──────────────────────────────────────────────────────────

  function clipeBase(extra) {
    return Object.assign({
      id: LNUX.id("c"), inicio: 0, entrada: 0, duracao: 5, velocidade: 1,
      mov: { x: 0, y: 0, escala: 1, rotacao: 0, opacidade: 1 },
      cor: { brilho: 0, contraste: 0, saturacao: 0, matiz: 0, temperatura: 0, desfoque: 0, vinheta: 0 },
      volume: 1, mudo: false, fadeIn: 0, fadeOut: 0,
      entradaTr: { tipo: "nenhuma", duracao: 0.5 }, saidaTr: { tipo: "nenhuma", duracao: 0.5 },
    }, extra);
  }

  /** Trilha livre do tipo certo no trecho (ou cria uma). */
  function trilhaLivre(tipo, inicio, duracao, preferida) {
    const livre = (t) => t.tipo === tipo && !projeto.clipes.some((c) => c.trilha === t.id && c.inicio < inicio + duracao - 1e-3 && c.inicio + c.duracao > inicio + 1e-3);
    const pref = preferida && trilhaPorId(preferida);
    if (pref && livre(pref)) return pref;
    const lista = tipo === "video" ? [...projeto.trilhas].reverse() : projeto.trilhas; // vídeo: a de baixo primeiro
    const achada = lista.find(livre);
    if (achada) return achada;
    const nova = { id: LNUX.id("t"), tipo, nome: tipo === "video" ? `Vídeo ${projeto.trilhas.filter((t) => t.tipo === "video").length + 1}` : `Áudio ${projeto.trilhas.filter((t) => t.tipo === "audio").length + 1}` };
    if (tipo === "video") projeto.trilhas.unshift(nova); else projeto.trilhas.push(nova);
    return nova;
  }

  function colocarNaLinha(idMidia, trilha, tempo, emSequencia = false) {
    const m = projeto.midias[idMidia];
    if (!m) return null;
    const tipo = m.tipo === "audio" ? "audio" : "video";
    const duracao = m.tipo === "imagem" ? 5 : m.duracao;
    let inicio = Math.max(0, tempo);
    if (emSequencia) {
      const t = trilha && trilhaPorId(trilha);
      if (t && t.tipo === tipo) {
        const ocupado = projeto.clipes.filter((c) => c.trilha === t.id && c.inicio + c.duracao > inicio && c.inicio < inicio + duracao);
        if (ocupado.length) inicio = Math.max(...ocupado.map((c) => c.inicio + c.duracao));
      }
    }
    const t = trilhaLivre(tipo, inicio, duracao, trilha);
    const c = clipeBase({ tipo: "midia", midia: idMidia, trilha: t.id, inicio, duracao, nome: LNUX.nomeSemExtensao(m.nome) });
    projeto.clipes.push(c);
    selecao = new Set([c.id]);
    if (emSequencia) cursor = inicio + duracao;
    return c;
  }

  function novoTexto(conteudo = "Seu título aqui", { inicio = cursor, duracao = 4, estilo = {}, trilha = null } = {}) {
    const t = trilha ? trilhaPorId(trilha) : trilhaLivre("video", inicio, duracao, projeto.trilhas.find((x) => x.tipo === "video")?.id);
    const c = clipeBase({
      tipo: "texto", trilha: t.id, inicio, duracao, nome: conteudo.split("\n")[0].slice(0, 30),
      texto: Object.assign({ conteudo, fonte: FONTES[0][0], tamanho: 8, cor: "#ffffff", negrito: true, contorno: false, corContorno: "#000000",
        sombra: true, fundo: { ligado: false, cor: "#000000", opacidade: 0.6 }, posicao: "meio", alinhamento: "center", animacao: "aparecer" }, estilo),
    });
    projeto.clipes.push(c);
    selecao = new Set([c.id]);
    return c;
  }

  function separarNoCursor() {
    let alvos = escolhidos();
    if (!alvos.length) alvos = projeto.clipes.filter((c) => cursor > c.inicio && cursor < c.inicio + c.duracao);
    alvos = alvos.filter((c) => cursor > c.inicio + quadro() / 2 && cursor < c.inicio + c.duracao - quadro() / 2);
    if (!alvos.length) { LNUX.aviso("Ponha o cursor em cima de um clipe para separar."); return; }
    hist.marcar("Separar");
    const novos = new Set();
    for (const c of alvos) {
      const corte = cursor - c.inicio;
      const n = JSON.parse(JSON.stringify(c));
      n.id = LNUX.id("c");
      n.inicio = cursor;
      n.duracao = c.duracao - corte;
      n.entrada = c.entrada + corte * (c.velocidade || 1);
      n.fadeIn = 0;
      n.entradaTr = { tipo: "nenhuma", duracao: c.entradaTr.duracao };
      c.duracao = corte;
      c.fadeOut = 0;
      c.saidaTr = { tipo: "nenhuma", duracao: c.saidaTr.duracao };
      projeto.clipes.push(n);
      novos.add(n.id);
    }
    selecao = novos;
    mudou();
  }

  function apagar(fecharBuraco = false) {
    if (!selecao.size) return;
    hist.marcar(fecharBuraco ? "Apagar e fechar o buraco" : "Apagar");
    const alvos = escolhidos();
    projeto.clipes = projeto.clipes.filter((c) => !selecao.has(c.id));
    if (fecharBuraco) {
      for (const a of alvos) for (const c of projeto.clipes) if (c.trilha === a.trilha && c.inicio >= a.inicio + a.duracao - 1e-6) c.inicio -= a.duracao;
    }
    selecao.clear();
    mudou();
  }

  function duplicar() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    hist.marcar("Duplicar");
    const novos = new Set();
    for (const c of alvos) {
      const n = JSON.parse(JSON.stringify(c));
      n.id = LNUX.id("c");
      n.inicio = c.inicio + c.duracao;
      const t = trilhaLivre(tipoDaTrilhaPara(c), n.inicio, n.duracao, c.trilha);
      n.trilha = t.id;
      projeto.clipes.push(n);
      novos.add(n.id);
    }
    selecao = novos;
    mudou();
  }

  function copiar() { copiados = escolhidos().map((c) => JSON.parse(JSON.stringify(c))); if (copiados.length) LNUX.aviso(`${copiados.length} clipe(s) copiado(s).`); }
  function colar() {
    if (!copiados.length) return;
    hist.marcar("Colar");
    const ini = Math.min(...copiados.map((c) => c.inicio));
    const novos = new Set();
    for (const c of copiados) {
      const n = JSON.parse(JSON.stringify(c));
      n.id = LNUX.id("c");
      n.inicio = cursor + (c.inicio - ini);
      n.trilha = trilhaLivre(tipoDaTrilhaPara(c), n.inicio, n.duracao, c.trilha).id;
      projeto.clipes.push(n);
      novos.add(n.id);
    }
    selecao = novos;
    mudou();
  }

  function separarAudio() {
    const alvos = escolhidos().filter((c) => c.tipo === "midia" && projeto.midias[c.midia]?.tipo === "video");
    if (!alvos.length) { LNUX.aviso("Escolha um clipe de vídeo."); return; }
    hist.marcar("Separar o áudio");
    for (const c of alvos) {
      const t = trilhaLivre("audio", c.inicio, c.duracao);
      const a = JSON.parse(JSON.stringify(c));
      a.id = LNUX.id("c");
      a.trilha = t.id;
      a.nome = c.nome + " (áudio)";
      a.mudo = false;
      projeto.clipes.push(a);
      c.mudo = true;
    }
    mudou();
    LNUX.aviso("O áudio foi para uma trilha de áudio; o vídeo ficou mudo.", "ok");
  }

  function adicionarMarcador() {
    hist.marcar("Marcador");
    projeto.marcadores.push({ tempo: cursor, nome: `Marcador ${projeto.marcadores.length + 1}` });
    mudou();
  }

  // ── Encaixe ─────────────────────────────────────────────────────────

  function encaixar(t, ignorar = null) {
    if (!ima) return Math.round(t * projeto.fps) / projeto.fps;
    const tolerancia = 8 / pxs;
    let melhor = null, dist = tolerancia;
    const pontos = [cursor, 0, ...projeto.marcadores.map((m) => m.tempo)];
    for (const c of projeto.clipes) if (!ignorar || !ignorar.has(c.id)) pontos.push(c.inicio, c.inicio + c.duracao);
    for (const p of pontos) { const d = Math.abs(p - t); if (d < dist) { dist = d; melhor = p; } }
    return melhor ?? Math.round(t * projeto.fps) / projeto.fps;
  }

  // ── Linha do tempo (desenho) ────────────────────────────────────────

  const cor = (v) => LNUX.tema.cor(v);
  function prepararCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + "px"; c.style.height = h + "px"; }
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return x;
  }
  function passoDaRegua() {
    for (const p of [1 / projeto.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (p * pxs >= 70) return p;
    return 600;
  }

  function atualizarEspaco() {
    const fim = Math.max(duracaoProjeto() + 20, (rolagem.clientWidth / pxs) * 1.2, 30);
    espaco.style.width = Math.ceil(fim * pxs) + "px";
    espaco.style.height = projeto.trilhas.length * alturaTrilha() + 30 + "px";
  }

  function desenharRegua() {
    const w = regua.clientWidth, h = regua.clientHeight;
    if (!w) return;
    const ctx = prepararCanvas(regua, w, h);
    const x0 = rolagem.scrollLeft, t0 = x0 / pxs, t1 = (x0 + w) / pxs;
    ctx.fillStyle = cor("--painel"); ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = cor("--borda-forte"); ctx.fillStyle = cor("--texto-2");
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily; ctx.textBaseline = "top";
    const passo = passoDaRegua();
    for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) {
      const x = Math.round(t * pxs - x0) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(passo < 1 ? LNUX.tempo(t, projeto.fps).slice(3) : LNUX.tempo(t).replace(/\.00$/, ""), x + 3, 2);
    }
    for (const m of projeto.marcadores) {
      const x = m.tempo * pxs - x0;
      ctx.fillStyle = cor("--aviso");
      ctx.beginPath(); ctx.moveTo(x, h - 9); ctx.lineTo(x + 5, h - 4); ctx.lineTo(x, h); ctx.lineTo(x - 5, h - 4); ctx.fill();
    }
    const xc = cursor * pxs - x0;
    ctx.fillStyle = cor("--cabecote");
    ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc, 9); ctx.fill();
  }

  function retangulo(c, x0, y0, H) {
    return { x: c.inicio * pxs - x0, y: indiceDaTrilha(c.trilha) * H - y0 + 2, w: Math.max(2, c.duracao * pxs), h: H - 4 };
  }

  function desenharPistas() {
    const w = rolagem.clientWidth, h = rolagem.clientHeight;
    if (!w || !h) return;
    const ctx = prepararCanvas(pistas, w, h);
    const x0 = rolagem.scrollLeft, y0 = rolagem.scrollTop, H = alturaTrilha();
    const t0 = x0 / pxs, t1 = (x0 + w) / pxs;
    ctx.fillStyle = cor("--trilha"); ctx.fillRect(0, 0, w, h);
    projeto.trilhas.forEach((t, i) => {
      const y = i * H - y0;
      ctx.fillStyle = t.id === trilhaEscolhida ? cor("--destaque-suave") : t.tipo === "audio" ? cor("--trilha-alt") : cor("--trilha");
      ctx.fillRect(0, y, w, H);
      ctx.fillStyle = cor("--borda"); ctx.fillRect(0, y + H - 1, w, 1);
      if (i > 0 && t.tipo === "audio" && projeto.trilhas[i - 1].tipo === "video") { ctx.fillStyle = cor("--borda-forte"); ctx.fillRect(0, y - 1, w, 2); }
    });
    const passo = passoDaRegua();
    ctx.strokeStyle = cor("--borda"); ctx.globalAlpha = 0.5;
    for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) { const x = Math.round(t * pxs - x0) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const c of projeto.clipes) {
      if (c.inicio > t1 || c.inicio + c.duracao < t0) continue;
      desenharClipe(ctx, c, retangulo(c, x0, y0, H), w);
    }
    for (const m of projeto.marcadores) {
      const x = Math.round(m.tempo * pxs - x0) + 0.5;
      ctx.strokeStyle = cor("--aviso"); ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]);
    }
    const xc = Math.round(cursor * pxs - x0) + 0.5;
    ctx.strokeStyle = cor("--cabecote"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, h); ctx.stroke();
  }

  function desenharClipe(ctx, c, r, largura) {
    const m = projeto.midias[c.midia];
    const tipo = c.tipo === "texto" ? "texto" : trilhaPorId(c.trilha)?.tipo === "audio" ? "audio" : m?.tipo;
    const corBase = cor({ video: "--clipe-video", audio: "--clipe-audio", imagem: "--clipe-imagem", texto: "--clipe-texto" }[tipo] || "--clipe-video");
    const xi = Math.max(r.x, -2), xf = Math.min(r.x + r.w, largura + 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(r.x, r.y, r.w, r.h, 4) : ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = corBase; ctx.globalAlpha = 0.85; ctx.fillRect(xi, r.y, xf - xi, r.h); ctx.globalAlpha = 1;
    const img = miniaturas.get(c.midia);
    if ((tipo === "video" || tipo === "imagem") && img && img.complete && img.naturalWidth) {
      const tw = (r.h - 14) * 16 / 9;
      ctx.globalAlpha = 0.9;
      for (let x = r.x; x < xf; x += tw + 2) if (x + tw > xi) ctx.drawImage(img, x, r.y + 14, tw, r.h - 14);
      ctx.globalAlpha = 1;
    }
    if (tipo === "audio" || (tipo === "video" && !c.mudo && r.h > 30 && !img)) {
      const p = picos.get(c.midia);
      if (p) {
        const meio = r.y + 14 + (r.h - 14) / 2, amp = (r.h - 16) / 2;
        ctx.fillStyle = "rgba(255,255,255,.75)";
        const vel = c.velocidade || 1;
        for (let x = Math.floor(xi); x < xf; x++) {
          const a = c.entrada + ((x - r.x) / pxs) * vel, b = c.entrada + ((x + 1 - r.x) / pxs) * vel;
          let mi = 0, ma = 0;
          for (let i = Math.floor(a * p.taxa), f = Math.min(p.max.length, Math.ceil(b * p.taxa)); i < f; i++) { if (p.min[i] < mi) mi = p.min[i]; if (p.max[i] > ma) ma = p.max[i]; }
          const g = VideoMotor.volumeDoClipe(c, c.inicio + (x - r.x) / pxs);
          ctx.fillRect(x, meio - ma * amp * g, 1, Math.max(1, (ma - mi) * amp * g));
        }
      }
    }
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(xi, r.y, xf - xi, 14);
    ctx.fillStyle = "#fff"; ctx.font = "600 10.5px " + getComputedStyle(document.body).fontFamily; ctx.textBaseline = "middle";
    let rotulo = c.tipo === "texto" ? "T  " + (c.texto.conteudo || "").replace(/\n/g, " ") : (c.nome || m?.nome || "clipe");
    if ((c.velocidade || 1) !== 1) rotulo += `  ${c.velocidade}×`;
    if (c.mudo && tipo === "video") rotulo += "  (mudo)";
    if (!m && c.tipo !== "texto") rotulo += "  (mídia faltando)";
    ctx.fillText(rotulo, Math.max(r.x, 0) + 4, r.y + 7.5, Math.max(0, xf - Math.max(r.x, 0) - 8));
    // transições e fades
    ctx.fillStyle = "rgba(255,255,255,.85)";
    if (c.entradaTr && c.entradaTr.tipo !== "nenhuma") { const tw = c.entradaTr.duracao * pxs; ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + tw, r.y + 14); ctx.lineTo(r.x, r.y + 14); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; }
    if (c.saidaTr && c.saidaTr.tipo !== "nenhuma") { const tw = c.saidaTr.duracao * pxs; ctx.beginPath(); ctx.moveTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x + r.w - tw, r.y + 14); ctx.lineTo(r.x + r.w, r.y + 14); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    if (selecao.has(c.id)) {
      ctx.strokeStyle = cor("--texto"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 4) : ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.stroke();
    }
  }

  function desenharCabecalhos() {
    const H = alturaTrilha();
    cabecalhos.replaceChildren(...projeto.trilhas.map((t) => {
      const alternar = (campo, ic, icOn, dica) => el("button", {
        type: "button", title: dica, "aria-pressed": String(!!t[campo]), class: campo === "oculta" ? "esconder" : null,
        onclick: (e) => { e.stopPropagation(); hist.marcar(dica); t[campo] = !t[campo]; mudou(); },
        html: icone(t[campo] ? icOn : ic),
      });
      return el("div", {
        class: "cabecalho-trilha" + (t.id === trilhaEscolhida ? " escolhida" : ""), style: { height: H + "px" },
        onclick: () => { trilhaEscolhida = t.id; desenharCabecalhos(); redesenhar(); },
        oncontextmenu: (e) => {
          e.preventDefault();
          LNUX.abrirMenu([
            { rotulo: "Renomear trilha...", acao: async () => { const n = await LNUX.perguntar("Nome da trilha", { valor: t.nome }); if (n) { hist.marcar("Renomear trilha"); t.nome = n; mudou(); } } },
            { rotulo: t.tipo === "video" ? "Nova trilha de vídeo" : "Nova trilha de áudio", acao: () => novaTrilha(t.tipo) },
            "-",
            { rotulo: "Excluir trilha (e os clipes dela)", acao: () => excluirTrilha(t.id) },
          ], e.clientX, e.clientY);
        },
      },
      el("div", { class: "rotulo" }, t.nome, el("small", {}, t.tipo === "video" ? "vídeo" : "áudio")),
      t.tipo === "video" ? alternar("oculta", "olho", "olho-fechado", "Esconder a trilha") : null,
      alternar("mudo", "volume", "mudo", "Deixar a trilha muda"));
    }));
    cabecalhos.append(el("div", { style: { height: "30px" } }));
    cabecalhos.scrollTop = rolagem.scrollTop;
  }

  function novaTrilha(tipo) {
    hist.marcar("Nova trilha");
    const n = { id: LNUX.id("t"), tipo, nome: tipo === "video" ? `Vídeo ${projeto.trilhas.filter((t) => t.tipo === "video").length + 1}` : `Áudio ${projeto.trilhas.filter((t) => t.tipo === "audio").length + 1}` };
    if (tipo === "video") projeto.trilhas.unshift(n); else projeto.trilhas.push(n);
    mudou();
  }
  function excluirTrilha(id) {
    const t = trilhaPorId(id);
    if (projeto.trilhas.filter((x) => x.tipo === t.tipo).length <= 1) { LNUX.aviso("Precisa ficar pelo menos uma trilha de cada tipo."); return; }
    hist.marcar("Excluir trilha");
    projeto.trilhas = projeto.trilhas.filter((x) => x.id !== id);
    projeto.clipes = projeto.clipes.filter((c) => c.trilha !== id);
    mudou();
  }

  let pedido = 0;
  function redesenhar() {
    if (pedido) return;
    pedido = requestAnimationFrame(() => { pedido = 0; desenharRegua(); desenharPistas(); });
  }
  rolagem.addEventListener("scroll", () => { cabecalhos.scrollTop = rolagem.scrollTop; redesenhar(); });
  new ResizeObserver(() => { atualizarEspaco(); redesenhar(); ajustarTela(); }).observe(rolagem);
  document.addEventListener("lnux:tema", redesenhar);

  // ── Linha do tempo (interação) ──────────────────────────────────────

  function ponto(e) {
    const r = pistas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, t: (x + rolagem.scrollLeft) / pxs, trilha: Math.floor((y + rolagem.scrollTop) / alturaTrilha()) };
  }
  function acharClipe(p) {
    const H = alturaTrilha();
    for (let i = projeto.clipes.length - 1; i >= 0; i--) {
      const c = projeto.clipes[i], r = retangulo(c, rolagem.scrollLeft, rolagem.scrollTop, H);
      if (p.x >= r.x - 3 && p.x <= r.x + r.w + 3 && p.y >= r.y && p.y <= r.y + r.h) {
        const borda = Math.min(8, r.w / 4);
        return { clipe: c, zona: p.x < r.x + borda ? "aparar-inicio" : p.x > r.x + r.w - borda ? "aparar-fim" : "mover" };
      }
    }
    return null;
  }

  let arrasto = null;
  pistas.addEventListener("pointermove", (e) => {
    if (arrasto || ferramenta === "cortar") return;
    const a = acharClipe(ponto(e));
    pistas.style.cursor = !a ? "default" : a.zona === "mover" ? "grab" : "ew-resize";
  });
  pistas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    rolagem.focus({ preventScroll: true });
    const p = ponto(e);
    const a = acharClipe(p);
    const t = projeto.trilhas[p.trilha];
    if (t) trilhaEscolhida = t.id;
    pistas.setPointerCapture(e.pointerId);
    if (a && (ferramenta === "cortar" || e.altKey)) { cursor = encaixar(p.t); selecao = new Set([a.clipe.id]); separarNoCursor(); return; }
    if (!a) {
      if (!e.shiftKey) selecao.clear();
      arrasto = e.pointerType === "touch"
        ? { tipo: "rolar", x: e.clientX, y: e.clientY, sl: rolagem.scrollLeft, st: rolagem.scrollTop, moveu: false, t: p.t }
        : { tipo: "cursor" };
      if (arrasto.tipo === "cursor") irPara(Math.max(0, p.t));
      desenharCabecalhos(); desenharPropriedades(); redesenhar();
      return;
    }
    const c = a.clipe;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { selecao.has(c.id) ? selecao.delete(c.id) : selecao.add(c.id); }
    else if (!selecao.has(c.id)) selecao = new Set([c.id]);
    arrasto = { tipo: a.zona, clipe: c.id, x: e.clientX, t: p.t, trilha: p.trilha, marcado: false, orig: new Map(escolhidos().map((x) => [x.id, JSON.parse(JSON.stringify(x))])) };
    desenharCabecalhos(); desenharPropriedades(); redesenhar();
  });
  pistas.addEventListener("pointermove", (e) => {
    if (!arrasto) return;
    const p = ponto(e);
    if (arrasto.tipo === "rolar") {
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) arrasto.moveu = true;
      rolagem.scrollLeft = arrasto.sl - dx; rolagem.scrollTop = arrasto.st - dy;
      return;
    }
    if (arrasto.tipo === "cursor") { irPara(Math.max(0, p.t)); return; }
    if (!arrasto.marcado) {
      if (Math.abs(e.clientX - arrasto.x) < 3 && p.trilha === arrasto.trilha) return;
      hist.marcar("Editar clipe"); arrasto.marcado = true;
    }
    const o = arrasto.orig.get(arrasto.clipe), c = clipePorId(arrasto.clipe);
    const dt = p.t - arrasto.t;
    const midia = projeto.midias[c.midia];
    const limiteMidia = c.tipo === "texto" || midia?.tipo === "imagem" ? Infinity : (midia?.duracao || Infinity);
    if (arrasto.tipo === "mover") {
      let novo = encaixar(Math.max(0, o.inicio + dt), selecao);
      const pelaPonta = encaixar(o.inicio + dt + o.duracao, selecao) - o.duracao;
      if (Math.abs(pelaPonta - (o.inicio + dt)) < Math.abs(novo - (o.inicio + dt))) novo = pelaPonta;
      const delta = Math.max(-Math.min(...[...arrasto.orig.values()].map((x) => x.inicio)), novo - o.inicio);
      const dTrilha = limitar(p.trilha, 0, projeto.trilhas.length - 1) - arrasto.trilha;
      for (const [id, x] of arrasto.orig) {
        const k = clipePorId(id);
        k.inicio = Math.max(0, x.inicio + delta);
        const alvo = projeto.trilhas[limitar(indiceDaTrilha(x.trilha) + dTrilha, 0, projeto.trilhas.length - 1)];
        k.trilha = alvo.tipo === trilhaPorId(x.trilha).tipo ? alvo.id : x.trilha; // não muda de vídeo para áudio
      }
    } else if (arrasto.tipo === "aparar-inicio") {
      const vel = c.velocidade || 1;
      const minimo = c.tipo === "texto" || midia?.tipo === "imagem" ? 0 : o.inicio - o.entrada / vel;
      const novo = limitar(encaixar(o.inicio + dt, new Set([c.id])), Math.max(0, minimo), o.inicio + o.duracao - quadro());
      c.entrada = Math.max(0, o.entrada + (novo - o.inicio) * vel);
      c.duracao = o.duracao - (novo - o.inicio);
      c.inicio = novo;
    } else if (arrasto.tipo === "aparar-fim") {
      const vel = c.velocidade || 1;
      const maximo = o.inicio + (limiteMidia - o.entrada) / vel;
      c.duracao = limitar(encaixar(o.inicio + o.duracao + dt, new Set([c.id])), o.inicio + quadro(), maximo) - o.inicio;
    }
    redesenhar();
    atualizarQuadro();
  });
  const soltar = () => {
    if (!arrasto) return;
    const a = arrasto; arrasto = null;
    if (a.tipo === "rolar" && !a.moveu) irPara(Math.max(0, a.t));
    if (a.marcado) mudou();
  };
  pistas.addEventListener("pointerup", soltar);
  pistas.addEventListener("pointercancel", soltar);
  pistas.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const p = ponto(e);
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.t, p.x);
  }, { passive: false });
  pistas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const a = acharClipe(ponto(e));
    if (a && !selecao.has(a.clipe.id)) { selecao = new Set([a.clipe.id]); desenharPropriedades(); redesenhar(); }
    LNUX.abrirMenu(a ? [
      { rotulo: "Separar no cursor", atalho: "S", acao: separarNoCursor },
      { rotulo: "Duplicar", atalho: "Ctrl+D", acao: duplicar },
      { rotulo: "Copiar", atalho: "Ctrl+C", acao: copiar },
      { rotulo: "Separar o áudio", ativo: () => a.clipe.tipo === "midia" && projeto.midias[a.clipe.midia]?.tipo === "video", acao: separarAudio },
      "-",
      { rotulo: "Apagar", atalho: "Del", acao: () => apagar(false) },
      { rotulo: "Apagar e fechar o buraco", atalho: "Shift+Del", acao: () => apagar(true) },
    ] : [
      { rotulo: "Colar aqui", atalho: "Ctrl+V", ativo: () => copiados.length > 0, acao: () => { cursor = Math.max(0, ponto(e).t); colar(); } },
      { rotulo: "Novo texto aqui", acao: () => { hist.marcar("Novo texto"); novoTexto(undefined, { inicio: Math.max(0, ponto(e).t) }); mudou(); } },
    ], e.clientX, e.clientY);
  });
  // Arrastar uma mídia da lista para a linha do tempo
  rolagem.addEventListener("dragover", (e) => { if (Array.from(e.dataTransfer.types).includes("text/x-lnux-midia")) { e.preventDefault(); rolagem.classList.add("soltando"); } });
  rolagem.addEventListener("dragleave", () => rolagem.classList.remove("soltando"));
  rolagem.addEventListener("drop", (e) => {
    rolagem.classList.remove("soltando");
    const id = e.dataTransfer.getData("text/x-lnux-midia");
    const p = ponto(e);
    if (id) {
      e.preventDefault();
      hist.marcar("Pôr na linha do tempo");
      const t = projeto.trilhas[p.trilha];
      colocarNaLinha(id, t ? t.id : null, encaixar(Math.max(0, p.t)));
      mudou();
    } else if (e.dataTransfer.files.length) {
      e.preventDefault();
      const t = projeto.trilhas[p.trilha];
      adicionarArquivos(Array.from(e.dataTransfer.files).map((f) => ({ nome: f.name, tipo: f.type, tamanho: f.size, origem: "navegador", blob: async () => f })), { trilha: t ? t.id : null, tempo: Math.max(0, p.t) });
    }
  });
  regua.addEventListener("pointerdown", (e) => {
    regua.setPointerCapture(e.pointerId);
    const mover = (ev) => irPara(Math.max(0, (ev.clientX - regua.getBoundingClientRect().left + rolagem.scrollLeft) / pxs));
    mover(e);
    const fim = () => { regua.removeEventListener("pointermove", mover); regua.removeEventListener("pointerup", fim); };
    regua.addEventListener("pointermove", mover);
    regua.addEventListener("pointerup", fim);
  });

  function zoom(fator, emTempo = null, emX = null) {
    const antes = pxs;
    pxs = limitar(pxs * fator, 2, 2000);
    if (emTempo === null) { emTempo = cursor; emX = cursor * antes - rolagem.scrollLeft; }
    atualizarEspaco();
    rolagem.scrollLeft = Math.max(0, emTempo * pxs - emX);
    redesenhar();
  }
  function verTudo() {
    pxs = limitar((rolagem.clientWidth - 20) / Math.max(10, duracaoProjeto() * 1.05), 2, 2000);
    atualizarEspaco();
    rolagem.scrollLeft = 0;
    redesenhar();
  }

  // ── Monitor e reprodução ────────────────────────────────────────────

  function ajustarTela() {
    if (canvas.width !== projeto.largura || canvas.height !== projeto.altura) { canvas.width = projeto.largura; canvas.height = projeto.altura; atualizarQuadro(); }
    const tela = $("#tela");
    const w = tela.clientWidth - 20, h = tela.clientHeight - 20;
    if (w <= 0 || h <= 0) return;
    const e = Math.min(w / projeto.largura, h / projeto.altura);
    canvas.style.width = Math.floor(projeto.largura * e) + "px";
    canvas.style.height = Math.floor(projeto.altura * e) + "px";
  }
  new ResizeObserver(ajustarTela).observe($("#tela"));

  function desenharQuadro(t) {
    motor.desenhar(projeto, t, { guias: !exportando && $("#guias").checked });
    if (exportando || tocando) return;
    // contorno do clipe escolhido, para arrastar no monitor
    const c = escolhidos()[0];
    if (!c || t < c.inicio || t >= c.inicio + c.duracao || trilhaPorId(c.trilha)?.tipo !== "video") return;
    const r = retanguloNoMonitor(c);
    if (!r) return;
    const x = motor.ctx;
    x.save();
    x.strokeStyle = LNUX.tema.cor("--destaque") || "#5b9dff";
    x.lineWidth = Math.max(2, projeto.largura / 500);
    x.setLineDash([10, 6]);
    x.translate(r.cx, r.cy);
    x.rotate(((c.mov?.rotacao || 0) * Math.PI) / 180);
    x.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    x.restore();
  }
  function retanguloNoMonitor(c) {
    if (c.tipo === "texto") { const m = motor.medirTexto(c); const s = c.mov?.escala ?? 1; return { cx: m.cx, cy: m.cy, w: (m.largura + m.tamanho * 0.5) * s, h: (m.altura + m.tamanho * 0.3) * s }; }
    const item = motor.elementos.get(c.id);
    if (!item) return null;
    const w = item.imagem ? item.el.naturalWidth : item.el.videoWidth, h = item.imagem ? item.el.naturalHeight : item.el.videoHeight;
    return w && h ? motor.retanguloDaMidia(projeto, c, w, h) : null;
  }

  let quadroPendente = false;
  function atualizarQuadro() {
    if (tocando) return;
    desenharQuadro(cursor);
    if (quadroPendente) return;
    quadroPendente = true;
    const t = cursor;
    motor.sincronizar(projeto, t, false).then(() => { quadroPendente = false; if (!tocando) desenharQuadro(cursor); });
  }
  // vídeos que terminam de carregar redesenham o quadro
  setInterval(() => { if (!tocando && document.visibilityState === "visible") desenharQuadro(cursor); }, 700);

  function irPara(t) {
    cursor = limitar(t, 0, Math.max(duracaoProjeto(), 0) + 3600);
    if (tocando) { inicioProj = cursor; inicioReal = performance.now(); }
    mostrarTempo();
    manterVisivel();
    redesenhar();
    atualizarQuadro();
  }
  function mostrarTempo() {
    $("#tempo").textContent = LNUX.tempo(cursor, projeto.fps);
    $("#duracao").textContent = "/ " + LNUX.tempo(duracaoProjeto(), projeto.fps);
  }
  function manterVisivel() {
    const x = cursor * pxs, l = rolagem.scrollLeft, w = rolagem.clientWidth;
    if (x < l || x > l + w - 30) rolagem.scrollLeft = Math.max(0, x - w * 0.2);
  }

  function alternarPlay() { tocando ? pausar() : tocar(); }
  function tocar() {
    if (!projeto.clipes.length) { LNUX.aviso("Ponha alguma coisa na linha do tempo primeiro."); return; }
    if (cursor >= duracaoProjeto() - 0.01) cursor = 0;
    motor.garantirAudio();
    tocando = true;
    motor.tocando = true;
    inicioReal = performance.now();
    inicioProj = cursor;
    atualizarBotoes();
    requestAnimationFrame(laco);
  }
  function pausar() {
    tocando = false;
    motor.tocando = false;
    motor.pausarTudo();
    atualizarBotoes();
    atualizarQuadro();
  }
  function laco() {
    if (!tocando) return;
    const t = inicioProj + (performance.now() - inicioReal) / 1000;
    const fim = duracaoProjeto();
    if (t >= fim) {
      cursor = fim;
      pausar();
      mostrarTempo();
      redesenhar();
      if (exportando) exportando.terminar();
      return;
    }
    cursor = t;
    motor.sincronizar(projeto, t, true);
    desenharQuadro(t);
    if (exportando) exportando.progresso(t / fim);
    mostrarTempo();
    if (!exportando) { manterVisivel(); desenharRegua(); desenharPistas(); }
    if (Math.random() < 0.02) motor.limpar(projeto, t);
    requestAnimationFrame(laco);
  }

  // Arrastar no monitor move o clipe escolhido (ou o que estiver em cima)
  let arrastoTela = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (tocando) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width), y = (e.clientY - r.top) * (canvas.height / r.height);
    let c = escolhidos()[0];
    const rr = c && cursor >= c.inicio && cursor < c.inicio + c.duracao ? retanguloNoMonitor(c) : null;
    if (!rr || Math.abs(x - rr.cx) > rr.w / 2 || Math.abs(y - rr.cy) > rr.h / 2) c = motor.clipeNoPonto(projeto, cursor, x, y);
    if (!c) { selecao.clear(); desenharPropriedades(); redesenhar(); atualizarQuadro(); return; }
    selecao = new Set([c.id]);
    canvas.setPointerCapture(e.pointerId);
    arrastoTela = { c, x, y, mx: c.mov.x, my: c.mov.y, marcado: false, escala: canvas.width / r.width };
    desenharPropriedades(); redesenhar(); atualizarQuadro();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!arrastoTela) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width), y = (e.clientY - r.top) * (canvas.height / r.height);
    if (!arrastoTela.marcado) { if (Math.hypot(x - arrastoTela.x, y - arrastoTela.y) < 4) return; hist.marcar("Mover na tela"); arrastoTela.marcado = true; }
    let nx = arrastoTela.mx + (x - arrastoTela.x) / canvas.width, ny = arrastoTela.my + (y - arrastoTela.y) / canvas.height;
    if (Math.abs(nx) < 0.01) nx = 0; // gruda no centro
    if (Math.abs(ny) < 0.01) ny = 0;
    arrastoTela.c.mov.x = nx; arrastoTela.c.mov.y = ny;
    desenharQuadro(cursor);
  });
  canvas.addEventListener("pointerup", () => { if (arrastoTela && arrastoTela.marcado) mudou(); arrastoTela = null; });
  canvas.addEventListener("wheel", (e) => {
    const c = escolhidos()[0];
    if (!c || tocando || trilhaPorId(c.trilha)?.tipo !== "video") return;
    e.preventDefault();
    hist.marcar("Escala");
    c.mov.escala = limitar(c.mov.escala * (e.deltaY < 0 ? 1.05 : 1 / 1.05), 0.05, 10);
    mudouLeve();
  }, { passive: false });

  // ── Propriedades ────────────────────────────────────────────────────

  function deslizante(rotulo, valor, { min, max, passo = 0.01, unidade = "", casas = 2, aoMudar }) {
    const id = LNUX.id("p");
    const entrada = el("input", { id, type: "range", min, max, step: passo, value: valor });
    const fmt = (v) => (Math.round(v * 10 ** casas) / 10 ** casas).toString().replace(".", ",") + unidade;
    const saida = el("output", { for: id }, fmt(valor));
    let marcado = false;
    entrada.addEventListener("input", () => { if (!marcado) { hist.marcar(rotulo); marcado = true; } saida.textContent = fmt(+entrada.value); aoMudar(+entrada.value, false); });
    entrada.addEventListener("change", () => { marcado = false; aoMudar(+entrada.value, true); });
    entrada.addEventListener("dblclick", () => { hist.marcar(rotulo); const padrao = min < 0 ? 0 : min; entrada.value = padrao; saida.textContent = fmt(padrao); aoMudar(padrao, true); });
    return el("div", { class: "lnux-prop", title: "Dois cliques voltam ao padrão" }, el("label", { for: id }, rotulo), entrada, saida);
  }
  function escolha(rotulo, valor, opcoes, aoMudar) {
    const s = el("select", { class: "lnux-selecao" }, ...opcoes.map(([v, n]) => el("option", { value: v, selected: String(v) === String(valor) }, n)));
    s.addEventListener("change", () => { hist.marcar(rotulo); aoMudar(s.value); });
    return el("div", { class: "lnux-prop" }, el("label", {}, rotulo), s, el("span"));
  }
  function caixa(rotulo, valor, aoMudar) {
    const c = el("input", { type: "checkbox", checked: valor });
    c.addEventListener("change", () => { hist.marcar(rotulo); aoMudar(c.checked); });
    return el("label", { class: "lnux-alternar" }, c, rotulo);
  }
  const secao = (titulo, ...filhos) => el("div", { class: "lnux-secao" }, el("h3", {}, titulo), ...filhos);
  const mudouLeve = () => { atualizarQuadro(); redesenhar(); guardarDepois(); };

  function desenharPropriedades() {
    const lista = escolhidos();
    corpoProps.replaceChildren();
    const titulo = $("#titulo-propriedades");
    if (lista.length > 1) {
      titulo.textContent = `${lista.length} clipes`;
      corpoProps.append(secao("Vários clipes", el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: duplicar }, "Duplicar"),
        el("button", { class: "lnux-botao pequeno perigo", type: "button", onclick: () => apagar(false) }, "Apagar"))));
      return;
    }
    if (!lista.length) { titulo.textContent = "Projeto"; propriedadesDoProjeto(); return; }
    const c = lista[0];
    const midia = projeto.midias[c.midia];
    const naTrilhaDeVideo = trilhaPorId(c.trilha)?.tipo === "video";
    titulo.textContent = c.tipo === "texto" ? "Texto" : (midia?.tipo === "audio" || !naTrilhaDeVideo ? "Áudio" : midia?.tipo === "imagem" ? "Imagem" : "Vídeo");
    const r = (fim) => (fim ? mudou() : mudouLeve());

    const info = el("p", { class: "fraco", style: { margin: 0 } }, `De ${LNUX.tempo(c.inicio, projeto.fps)} até ${LNUX.tempo(c.inicio + c.duracao, projeto.fps)} (${LNUX.tempo(c.duracao)})`);
    const blocos = [];
    if (c.tipo === "texto") {
      const tx = c.texto;
      const area = el("textarea", { class: "lnux-area", rows: 3 }, tx.conteudo);
      let marcado = false;
      area.addEventListener("input", () => { if (!marcado) { hist.marcar("Texto"); marcado = true; } tx.conteudo = area.value; c.nome = area.value.split("\n")[0].slice(0, 30); mudouLeve(); });
      area.addEventListener("change", () => { marcado = false; mudou(); });
      const corTexto = el("input", { class: "lnux-entrada", type: "color", value: tx.cor });
      corTexto.addEventListener("input", () => { tx.cor = corTexto.value; mudouLeve(); });
      corTexto.addEventListener("change", () => { hist.marcar("Cor do texto"); mudou(); });
      const corFundo = el("input", { class: "lnux-entrada", type: "color", value: tx.fundo.cor });
      corFundo.addEventListener("input", () => { tx.fundo.cor = corFundo.value; tx.fundo.ligado = true; mudouLeve(); });
      blocos.push(secao("Texto", area,
        escolha("Fonte", tx.fonte, FONTES, (v) => { tx.fonte = v; mudou(); }),
        deslizante("Tamanho", tx.tamanho, { min: 2, max: 30, passo: 0.5, unidade: "%", casas: 1, aoMudar: (v, f) => { tx.tamanho = v; r(f); } }),
        el("div", { class: "lnux-prop" }, el("label", {}, "Cor"), corTexto, el("span")),
        el("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "6px 0" } },
          caixa("Negrito", tx.negrito, (v) => { tx.negrito = v; mudou(); }),
          caixa("Sombra", tx.sombra, (v) => { tx.sombra = v; mudou(); }),
          caixa("Contorno", tx.contorno, (v) => { tx.contorno = v; mudou(); })),
        escolha("Posição", tx.posicao, [["cima", "Em cima"], ["meio", "No meio"], ["baixo", "Embaixo (legenda)"]], (v) => { tx.posicao = v; c.mov.y = 0; mudou(); }),
        escolha("Alinhamento", tx.alinhamento, [["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"]], (v) => { tx.alinhamento = v; mudou(); }),
        escolha("Animação", tx.animacao, [["nenhuma", "Nenhuma"], ["aparecer", "Aparecer"], ["subir", "Subir"], ["zoom", "Zoom"], ["digitar", "Digitar"]], (v) => { tx.animacao = v; mudou(); }),
        caixa("Faixa atrás do texto", tx.fundo.ligado, (v) => { tx.fundo.ligado = v; mudou(); }),
        el("div", { class: "lnux-prop" }, el("label", {}, "Cor da faixa"), corFundo, el("span")),
        deslizante("Opacidade da faixa", tx.fundo.opacidade, { min: 0, max: 1, aoMudar: (v, f) => { tx.fundo.opacidade = v; tx.fundo.ligado = true; r(f); } })));
    }
    if (c.tipo !== "texto" && midia && midia.tipo !== "imagem") {
      blocos.push(secao("Velocidade",
        deslizante("Velocidade", c.velocidade || 1, { min: 0.25, max: 4, passo: 0.05, unidade: "×", aoMudar: (v, f) => {
          const trecho = c.duracao * (c.velocidade || 1);
          c.velocidade = v;
          c.duracao = Math.min(trecho / v, ((midia.duracao || Infinity) - c.entrada) / v);
          motor.descartar(c.id);
          r(f);
          if (f) desenharPropriedades();
        } })));
    }
    if (naTrilhaDeVideo) {
      const m = c.mov;
      blocos.push(secao("Movimento",
        deslizante("Horizontal", m.x, { min: -1, max: 1, aoMudar: (v, f) => { m.x = v; r(f); } }),
        deslizante("Vertical", m.y, { min: -1, max: 1, aoMudar: (v, f) => { m.y = v; r(f); } }),
        deslizante("Tamanho", m.escala, { min: 0.05, max: 4, passo: 0.01, unidade: "×", aoMudar: (v, f) => { m.escala = v; r(f); } }),
        deslizante("Girar", m.rotacao, { min: -180, max: 180, passo: 1, unidade: "°", casas: 0, aoMudar: (v, f) => { m.rotacao = v; r(f); } }),
        deslizante("Opacidade", m.opacidade, { min: 0, max: 1, aoMudar: (v, f) => { m.opacidade = v; r(f); } }),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" } },
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { hist.marcar("Centralizar"); Object.assign(m, { x: 0, y: 0, rotacao: 0 }); mudou(); } }, "Centralizar"),
          c.tipo !== "texto" && midia?.largura ? el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => {
            hist.marcar("Preencher a tela");
            const a = projeto.largura / midia.largura, b = projeto.altura / midia.altura;
            Object.assign(m, { x: 0, y: 0, escala: Math.max(a, b) / Math.min(a, b) });
            mudou();
          } }, "Preencher a tela (sem bordas)") : null,
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { hist.marcar("Movimento original"); Object.assign(m, { x: 0, y: 0, escala: 1, rotacao: 0, opacidade: 1 }); mudou(); } }, "Voltar ao original"))));
    }
    if (c.tipo !== "texto" && naTrilhaDeVideo) {
      const k = c.cor;
      const looks = el("div", { class: "looks" }, ...Object.entries({ nenhum: "Original", "preto-e-branco": "Preto e branco", quente: "Quente", frio: "Frio", vintage: "Vintage", vivido: "Vívido", cinema: "Cinema", desbotado: "Desbotado" })
        .map(([id, nome]) => el("button", { type: "button", onclick: () => { hist.marcar("Look " + nome); Object.assign(k, { brilho: 0, contraste: 0, saturacao: 0, matiz: 0, temperatura: 0, desfoque: 0, vinheta: 0 }, LOOKS[id]); mudou(); } }, nome)));
      blocos.push(secao("Cor", looks,
        deslizante("Brilho", k.brilho, { min: -1, max: 1, aoMudar: (v, f) => { k.brilho = v; r(f); } }),
        deslizante("Contraste", k.contraste, { min: -1, max: 1, aoMudar: (v, f) => { k.contraste = v; r(f); } }),
        deslizante("Saturação", k.saturacao, { min: -1, max: 1, aoMudar: (v, f) => { k.saturacao = v; r(f); } }),
        deslizante("Temperatura", k.temperatura, { min: -1, max: 1, aoMudar: (v, f) => { k.temperatura = v; r(f); } }),
        deslizante("Matiz", k.matiz, { min: -180, max: 180, passo: 1, unidade: "°", casas: 0, aoMudar: (v, f) => { k.matiz = v; r(f); } }),
        deslizante("Desfoque", k.desfoque, { min: 0, max: 30, passo: 0.5, unidade: " px", casas: 1, aoMudar: (v, f) => { k.desfoque = v; r(f); } }),
        deslizante("Vinheta", k.vinheta, { min: 0, max: 1, aoMudar: (v, f) => { k.vinheta = v; r(f); } })));
    }
    if (c.tipo !== "texto" && midia && midia.tipo !== "imagem") {
      blocos.push(secao("Áudio",
        caixa("Mudo", c.mudo, (v) => { c.mudo = v; mudou(); }),
        deslizante("Volume", c.volume, { min: 0, max: 2, unidade: "×", aoMudar: (v, f) => { c.volume = v; r(f); } }),
        deslizante("Fade de entrada", c.fadeIn, { min: 0, max: Math.min(10, c.duracao), passo: 0.05, unidade: " s", aoMudar: (v, f) => { c.fadeIn = v; r(f); } }),
        deslizante("Fade de saída", c.fadeOut, { min: 0, max: Math.min(10, c.duracao), passo: 0.05, unidade: " s", aoMudar: (v, f) => { c.fadeOut = v; r(f); } }),
        midia.tipo === "video" && naTrilhaDeVideo ? el("button", { class: "lnux-botao pequeno", type: "button", onclick: separarAudio }, "Separar o áudio numa trilha") : null));
    }
    if (naTrilhaDeVideo) {
      blocos.push(secao("Transições",
        escolha("Entrada", c.entradaTr.tipo, TRANSICOES, (v) => { c.entradaTr.tipo = v; mudou(); }),
        deslizante("Duração da entrada", c.entradaTr.duracao, { min: 0.1, max: Math.max(0.2, Math.min(5, c.duracao / 2)), passo: 0.05, unidade: " s", aoMudar: (v, f) => { c.entradaTr.duracao = v; r(f); } }),
        escolha("Saída", c.saidaTr.tipo, TRANSICOES, (v) => { c.saidaTr.tipo = v; mudou(); }),
        deslizante("Duração da saída", c.saidaTr.duracao, { min: 0.1, max: Math.max(0.2, Math.min(5, c.duracao / 2)), passo: 0.05, unidade: " s", aoMudar: (v, f) => { c.saidaTr.duracao = v; r(f); } }),
        el("p", { class: "fraco", style: { margin: "6px 0 0" } }, "Para misturar dois clipes, ponha um na trilha de cima, sobrepondo o fim do outro, e use \"Dissolver\" na entrada.")));
    }
    corpoProps.prepend(secao("Clipe", info));
    corpoProps.append(...blocos);
  }

  function propriedadesDoProjeto() {
    const nome = el("input", { class: "lnux-entrada", value: projeto.nome });
    nome.addEventListener("change", () => { hist.marcar("Nome do projeto"); projeto.nome = nome.value.trim() || projeto.nome; mudou(); });
    const res = el("select", { class: "lnux-selecao" }, ...RESOLUCOES.map(([v, n]) => el("option", { value: v, selected: v === `${projeto.largura}x${projeto.altura}` }, n)));
    if (!RESOLUCOES.some(([v]) => v === `${projeto.largura}x${projeto.altura}`)) res.prepend(el("option", { value: `${projeto.largura}x${projeto.altura}`, selected: true }, `${projeto.largura} × ${projeto.altura}`));
    res.addEventListener("change", () => { hist.marcar("Tamanho do vídeo"); const [w, h] = res.value.split("x").map(Number); projeto.largura = w; projeto.altura = h; mudou(); });
    const fps = el("select", { class: "lnux-selecao" }, ...[24, 25, 30, 50, 60].map((f) => el("option", { value: f, selected: f === projeto.fps }, `${f} quadros/s`)));
    fps.addEventListener("change", () => { hist.marcar("Quadros por segundo"); projeto.fps = +fps.value; mudou(); });
    const fundo = el("input", { class: "lnux-entrada", type: "color", value: projeto.fundo });
    fundo.addEventListener("change", () => { hist.marcar("Cor de fundo"); projeto.fundo = fundo.value; mudou(); });
    corpoProps.append(
      secao("Projeto", el("label", { class: "lnux-campo" }, el("span", {}, "Nome"), nome),
        el("label", { class: "lnux-campo", style: { marginTop: "8px" } }, el("span", {}, "Tamanho do vídeo"), res),
        el("label", { class: "lnux-campo", style: { marginTop: "8px" } }, el("span", {}, "Quadros por segundo"), fps),
        el("div", { class: "lnux-prop", style: { marginTop: "8px" } }, el("label", {}, "Cor de fundo"), fundo, el("span")),
        el("p", { class: "fraco", style: { margin: "8px 0 0" } }, `Duração: ${LNUX.tempo(duracaoProjeto())} · ${projeto.clipes.length} clipe(s) · ${Object.keys(projeto.midias).length} mídia(s)`)),
      secao("Marcadores", projeto.marcadores.length
        ? el("div", { style: { display: "grid", gap: "4px" } }, ...projeto.marcadores.sort((a, b) => a.tempo - b.tempo).map((m) => el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => irPara(m.tempo) }, LNUX.tempo(m.tempo)),
          el("span", { style: { flex: 1 } }, m.nome),
          el("button", { class: "lnux-botao pequeno icone plano", type: "button", title: "Tirar", html: icone("fechar"), onclick: () => { hist.marcar("Tirar marcador"); projeto.marcadores = projeto.marcadores.filter((x) => x !== m); mudou(); } }))))
        : el("p", { class: "fraco", style: { margin: 0 } }, "Aperte M para marcar o ponto do cursor.")),
      secao("Dica", el("p", { class: "fraco", style: { margin: 0 } }, "Escolha um clipe na linha do tempo (ou clique nele no monitor) para mexer na cor, no tamanho, no volume, nas transições e no texto.")));
  }

  // ── Legendas (SRT) ──────────────────────────────────────────────────

  function lerSrt(texto) {
    const tempo = (s) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : NaN; };
    return texto.replace(/\r/g, "").split(/\n\s*\n/).map((b) => {
      const linhas = b.trim().split("\n");
      const i = linhas.findIndex((l) => l.includes("-->"));
      if (i < 0) return null;
      const [a, z] = linhas[i].split("-->");
      return { inicio: tempo(a), fim: tempo(z), texto: linhas.slice(i + 1).join("\n").replace(/<[^>]+>/g, "") };
    }).filter((x) => x && isFinite(x.inicio) && isFinite(x.fim) && x.fim > x.inicio && x.texto.trim());
  }
  /** 3723.5 → "01:02:03,500" (formato de tempo do SRT) */
  function tempoSrt(s) {
    const ms = Math.round(s * 1000);
    const d = (n, k = 2) => String(n).padStart(k, "0");
    return `${d(Math.floor(ms / 3600000))}:${d(Math.floor(ms / 60000) % 60)}:${d(Math.floor(ms / 1000) % 60)},${d(ms % 1000, 3)}`;
  }
  function srtDe(clipes) {
    return [...clipes].sort((a, b) => a.inicio - b.inicio)
      .map((c, i) => `${i + 1}\n${tempoSrt(c.inicio)} --> ${tempoSrt(c.inicio + c.duracao)}\n${c.texto.conteudo}\n`).join("\n");
  }
  async function importarLegendas() {
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Importar legendas (SRT)", aceitar: ".srt,.vtt,.txt" });
    if (!arq) return;
    const itens = lerSrt(await arq.texto());
    if (!itens.length) { LNUX.aviso("Não achei legendas nesse arquivo (formato SRT).", "erro"); return; }
    hist.marcar("Importar legendas");
    const t = { id: LNUX.id("t"), tipo: "video", nome: "Legendas" };
    projeto.trilhas.unshift(t);
    for (const it of itens) novoTexto(it.texto, { inicio: it.inicio, duracao: it.fim - it.inicio, trilha: t.id, estilo: { tamanho: 5, negrito: false, sombra: true, posicao: "baixo", animacao: "nenhuma", fundo: { ligado: true, cor: "#000000", opacidade: 0.55 } } });
    selecao.clear();
    mudou();
    LNUX.aviso(`${itens.length} legendas na trilha "Legendas".`, "ok");
  }
  async function exportarLegendas() {
    const textos = projeto.clipes.filter((c) => c.tipo === "texto");
    if (!textos.length) { LNUX.aviso("Não há textos para virar legenda."); return; }
    const legendas = textos.filter((c) => trilhaPorId(c.trilha)?.nome === "Legendas");
    await LNUX.arquivos.salvar(new Blob([srtDe(legendas.length ? legendas : textos)], { type: "text/plain" }), (projeto.nome || "legendas") + ".srt", { titulo: "Salvar legendas" });
  }

  // ── Guardar e projetos .lnuxvideo ───────────────────────────────────

  const guardarDepois = LNUX.adiar(async () => {
    try {
      await LNUX.guardado.gravar("video:projeto", JSON.stringify(projeto));
      for (const [id, b] of arquivos) if (!guardados.has(id) && projeto.midias[id]) {
        try { await LNUX.guardado.gravar("video:midia:" + id, b); guardados.add(id); }
        catch (e) { LNUX.aviso(`Não deu para guardar "${projeto.midias[id].nome}" no navegador (pouco espaço?). Salve o projeto num arquivo.`, "alerta"); guardados.add(id); }
      }
    } catch (e) { console.warn(e); }
  }, 800);

  async function restaurar() {
    const salvo = await LNUX.guardado.ler("video:projeto");
    if (!salvo) return false;
    try {
      projeto = Object.assign(novoProjeto(), JSON.parse(salvo));
      for (const id of Object.keys(projeto.midias)) {
        if (!projeto.midias[id].caminho) {
          const b = await LNUX.guardado.ler("video:midia:" + id);
          if (b) { arquivos.set(id, b); guardados.add(id); }
        }
        registrarUrl(id);
        calcularPicos(id);
      }
      return true;
    } catch (e) { console.warn(e); return false; }
  }

  async function novo() {
    if (projeto.clipes.length && !(await LNUX.confirmar("Novo projeto", "Começar um projeto novo? O atual sai da tela (salve antes, se quiser guardar).", { rotulo: "Começar do zero" }))) return;
    pausar();
    for (const id of [...motor.elementos.keys()]) motor.descartar(id);
    projeto = novoProjeto();
    arquivos.clear(); picos.clear(); miniaturas.clear(); motor.urls.clear(); selecao.clear();
    for (const k of await LNUX.guardado.chaves("video:midia:")) await LNUX.guardado.apagar(k);
    guardados.clear();
    cursor = 0; caminhoProjeto = null;
    hist.limpar();
    mudou();
  }

  async function gerarPacote() {
    const zip = new LNUX.Zip();
    const copia = JSON.parse(JSON.stringify(projeto));
    for (const [id, m] of Object.entries(copia.midias)) {
      if (arquivos.has(id)) {
        m.arquivo = `midias/${id}.${LNUX.extensao(m.nome) || "bin"}`;
        zip.adicionar(m.arquivo, arquivos.get(id));
      }
    }
    copia.app = "lnux-video";
    zip.adicionar("projeto.json", JSON.stringify(copia, null, 2));
    return zip.gerar();
  }
  async function salvarProjeto(como) {
    const p = LNUX.progresso("Salvando o projeto");
    try {
      const blob = await gerarPacote();
      p.fechar();
      const r = await LNUX.arquivos.salvar(blob, (projeto.nome || "projeto").replace(/[\\/:*?"<>|]+/g, "_") + ".lnuxvideo", { titulo: "Salvar projeto", caminho: como ? null : caminhoProjeto });
      if (r && r !== "baixado") caminhoProjeto = r;
    } catch (e) { p.fechar(); LNUX.erro(e); }
  }
  async function abrirProjeto() {
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Abrir projeto", aceitar: ".lnuxvideo,.zip" });
    if (!arq) return;
    try {
      const conteudo = await LNUX.Zip.ler(await arq.blob());
      const json = conteudo.get("projeto.json");
      if (!json) throw new Error("Este arquivo não é um projeto do Vídeo.");
      const dados = JSON.parse(await json.text());
      pausar();
      for (const id of [...motor.elementos.keys()]) motor.descartar(id);
      arquivos.clear(); picos.clear(); miniaturas.clear(); motor.urls.clear(); guardados.clear(); selecao.clear();
      for (const k of await LNUX.guardado.chaves("video:midia:")) await LNUX.guardado.apagar(k);
      projeto = Object.assign(novoProjeto(), dados);
      for (const [id, m] of Object.entries(projeto.midias)) {
        if (m.arquivo && conteudo.get(m.arquivo)) arquivos.set(id, conteudo.get(m.arquivo));
        delete m.arquivo;
        registrarUrl(id);
        calcularPicos(id);
      }
      caminhoProjeto = arq.caminho && arq.caminho.endsWith(".lnuxvideo") ? arq.caminho : null;
      cursor = 0;
      hist.limpar();
      mudou();
      verTudo();
      const faltando = Object.keys(projeto.midias).filter((id) => !motor.urls.get(id));
      LNUX.aviso(faltando.length ? `Projeto aberto, mas ${faltando.length} mídia(s) estão faltando (estavam nas pastas de outro aparelho).` : "Projeto aberto.", faltando.length ? "alerta" : "ok");
    } catch (e) { LNUX.erro(e); }
  }

  // ── Exportar ────────────────────────────────────────────────────────

  async function exportarQuadro() {
    const antes = $("#guias").checked;
    $("#guias").checked = false;
    selecao.clear();
    await motor.sincronizar(projeto, cursor, false);
    motor.desenhar(projeto, cursor);
    $("#guias").checked = antes;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    await LNUX.arquivos.salvar(blob, `${projeto.nome || "quadro"} ${LNUX.tempo(cursor).replace(/[:.]/g, "-")}.png`, { titulo: "Salvar o quadro" });
    mudou();
  }

  async function exportar() {
    if (!projeto.clipes.length) { LNUX.aviso("A linha do tempo está vazia."); return; }
    if (!window.MediaRecorder || !canvas.captureStream) { LNUX.aviso("Este navegador não grava vídeo. Use o Chrome, o Edge ou o Firefox.", "erro"); return; }
    const temFfmpeg = LNUX.ponte.tem("ffmpeg");
    const formato = el("select", { class: "lnux-selecao" },
      el("option", { value: "webm" }, "WebM (direto do navegador)"),
      el("option", { value: "mp4", disabled: !temFfmpeg }, "MP4 (H.264) — toca em qualquer lugar" + (temFfmpeg ? "" : " · precisa da ponte com ffmpeg")),
      el("option", { value: "gif", disabled: !temFfmpeg }, "GIF animado" + (temFfmpeg ? "" : " · precisa da ponte com ffmpeg")));
    if (temFfmpeg) formato.value = "mp4";
    const qualidade = el("select", { class: "lnux-selecao" },
      el("option", { value: "2500000" }, "Leve (2,5 Mbps)"), el("option", { value: "6000000", selected: true }, "Boa (6 Mbps)"), el("option", { value: "12000000" }, "Alta (12 Mbps)"));
    const ok = await LNUX.dialogo({
      titulo: "Exportar o vídeo",
      corpo: el("div", { style: { display: "grid", gap: "12px" } },
        el("label", { class: "lnux-campo" }, el("span", {}, "Formato"), formato),
        el("label", { class: "lnux-campo" }, el("span", {}, "Qualidade"), qualidade),
        el("p", { class: "fraco", style: { margin: 0 } }, `O vídeo é gravado enquanto toca: leva ${LNUX.tempo(duracaoProjeto())}. Deixe esta aba aberta na frente até terminar.`)),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Exportar", primario: true, valor: true }],
    });
    if (!ok) return;
    const tipos = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    const tipo = tipos.find((t) => MediaRecorder.isTypeSupported(t));
    motor.garantirAudio();
    selecao.clear();
    desenharPropriedades();
    const fluxo = canvas.captureStream(projeto.fps);
    for (const faixa of motor.destinoGravacao.stream.getAudioTracks()) fluxo.addTrack(faixa);
    const gravador = new MediaRecorder(fluxo, { mimeType: tipo, videoBitsPerSecond: +qualidade.value, audioBitsPerSecond: 160000 });
    const pedacos = [];
    gravador.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
    let cancelado = false;
    const p = LNUX.progresso("Gravando o vídeo", { aoCancelar: () => { cancelado = true; pausar(); gravador.stop(); exportando = null; } });
    const terminou = new Promise((resolver) => { gravador.onstop = resolver; });
    exportando = { progresso: (f) => p.definir(f * (formato.value === "webm" ? 1 : 0.7), `Gravando... ${Math.round(f * 100)}%`), terminar: () => gravador.state !== "inactive" && gravador.stop() };
    pausar();
    cursor = 0;
    await motor.sincronizar(projeto, 0, false);
    motor.desenhar(projeto, 0);
    gravador.start(500);
    tocar();
    await terminou;
    exportando = null;
    fluxo.getVideoTracks().forEach((t) => t.stop());
    if (cancelado) { LNUX.aviso("Exportação cancelada."); return; }
    const webm = new Blob(pedacos, { type: tipo.split(";")[0] });
    const base = (projeto.nome || "video").replace(/[\\/:*?"<>|]+/g, "_");
    try {
      if (formato.value === "webm") { p.fechar(); await LNUX.arquivos.salvar(webm, base + (tipo.includes("mp4") ? ".mp4" : ".webm"), { titulo: "Salvar o vídeo" }); return; }
      p.definir(0.72, "Enviando para a ponte...");
      const { caminho } = await LNUX.ponte.temporario(webm, base + ".webm");
      const r = await LNUX.ponte.converter({ entrada: caminho, perfil: formato.value, opcoes: formato.value === "gif" ? { fps: Math.min(15, projeto.fps), largura: Math.min(640, projeto.largura) } : { crf: 21 } },
        (f, t) => p.definir(0.72 + f * 0.25, t));
      p.definir(0.98, "Buscando o arquivo...");
      const saida = await LNUX.ponte.ler(r.saida, "blob");
      p.fechar();
      await LNUX.arquivos.salvar(saida, `${base}.${formato.value}`, { titulo: "Salvar o vídeo" });
    } catch (e) { p.fechar(); LNUX.erro(e); }
  }

  // ── Mudanças ────────────────────────────────────────────────────────

  function mudou() {
    $("#titulo-doc").textContent = projeto.nome;
    for (const id of Object.keys(projeto.midias)) if (!motor.urls.get(id)) registrarUrl(id);
    motor.limpar(projeto, cursor);
    ajustarTela();
    atualizarEspaco();
    desenharMidias();
    desenharCabecalhos();
    desenharPropriedades();
    mostrarTempo();
    redesenhar();
    atualizarQuadro();
    atualizarBotoes();
    guardarDepois();
  }

  // ── Menus, atalhos e começo ─────────────────────────────────────────

  const temSelecao = () => selecao.size > 0;
  const menus = [
    { rotulo: "Arquivo", itens: [
      { rotulo: "Novo projeto", atalho: "Alt+N", acao: novo },
      { rotulo: "Abrir projeto...", atalho: "Ctrl+O", acao: abrirProjeto },
      { rotulo: "Salvar projeto", atalho: "Ctrl+S", acao: () => salvarProjeto(false) },
      { rotulo: "Salvar projeto como...", atalho: "Ctrl+Shift+S", acao: () => salvarProjeto(true) },
      "-",
      { rotulo: "Importar mídias...", atalho: "Ctrl+I", acao: importar },
      { rotulo: "Importar legendas (SRT)...", acao: importarLegendas },
      "-",
      { rotulo: "Exportar o vídeo...", atalho: "Ctrl+E", acao: exportar },
      { rotulo: "Exportar o quadro atual (PNG)...", acao: exportarQuadro },
      { rotulo: "Exportar as legendas (SRT)...", acao: exportarLegendas },
    ] },
    { rotulo: "Editar", itens: [
      { rotulo: "Desfazer", atalho: "Ctrl+Z", acao: () => hist.desfazer(), ativo: () => hist.podeDesfazer() },
      { rotulo: "Refazer", atalho: ["Ctrl+Shift+Z", "Ctrl+Y"], acao: () => hist.refazer(), ativo: () => hist.podeRefazer() },
      "-",
      { rotulo: "Separar no cursor", atalho: "S", acao: separarNoCursor },
      { rotulo: "Duplicar", atalho: "Ctrl+D", acao: duplicar, ativo: temSelecao },
      { rotulo: "Copiar", atalho: "Ctrl+C", acao: copiar, ativo: temSelecao },
      { rotulo: "Colar no cursor", atalho: "Ctrl+V", acao: colar, ativo: () => copiados.length > 0 },
      { rotulo: "Apagar", atalho: ["Del", "Backspace"], acao: () => apagar(false), ativo: temSelecao },
      { rotulo: "Apagar e fechar o buraco", atalho: ["Shift+Del", "Shift+Backspace"], acao: () => apagar(true), ativo: temSelecao },
      "-",
      { rotulo: "Escolher todos os clipes", atalho: "Ctrl+A", acao: () => { selecao = new Set(projeto.clipes.map((c) => c.id)); desenharPropriedades(); redesenhar(); } },
      { rotulo: "Ferramenta de corte", atalho: "C", acao: () => { ferramenta = ferramenta === "cortar" ? "selecionar" : "cortar"; atualizarBotoes(); }, marcado: () => ferramenta === "cortar" },
      { rotulo: "Ímã", acao: () => { ima = !ima; atualizarBotoes(); }, marcado: () => ima },
    ] },
    { rotulo: "Clipe", itens: [
      { rotulo: "Novo texto / título", atalho: "T", acao: () => { hist.marcar("Novo texto"); novoTexto(); mudou(); } },
      { rotulo: "Terço inferior (nome e cargo)", acao: () => { hist.marcar("Novo texto"); novoTexto("Nome da pessoa\nO que ela faz", { estilo: { tamanho: 5, posicao: "baixo", alinhamento: "left", fundo: { ligado: true, cor: "#1d4ed8", opacidade: 0.85 }, animacao: "subir" } }); clipePorId([...selecao][0]).mov.x = -0.22; mudou(); } },
      { rotulo: "Pôr a mídia escolhida no cursor", atalho: "Insert", ativo: () => !!midiaEscolhida, acao: () => { hist.marcar("Pôr na linha do tempo"); colocarNaLinha(midiaEscolhida, null, cursor); mudou(); } },
      { rotulo: "Separar o áudio", acao: separarAudio, ativo: temSelecao },
      { rotulo: "Marcador no cursor", atalho: "M", acao: adicionarMarcador },
      "-",
      { rotulo: "Nova trilha de vídeo", acao: () => novaTrilha("video") },
      { rotulo: "Nova trilha de áudio", acao: () => novaTrilha("audio") },
    ] },
    { rotulo: "Reproduzir", itens: [
      { rotulo: "Tocar / pausar", atalho: ["Espaço", "K"], acao: alternarPlay },
      { rotulo: "Tocar (L)", atalho: "L", acao: () => !tocando && tocar() },
      { rotulo: "Voltar 1 segundo", atalho: ["J", "Shift+←"], acao: () => irPara(cursor - 1) },
      { rotulo: "Avançar 1 segundo", atalho: "Shift+→", acao: () => irPara(cursor + 1) },
      { rotulo: "Quadro anterior", atalho: "←", acao: () => irPara(cursor - quadro()) },
      { rotulo: "Próximo quadro", atalho: "→", acao: () => irPara(cursor + quadro()) },
      { rotulo: "Início", atalho: "Home", acao: () => irPara(0) },
      { rotulo: "Fim", atalho: "End", acao: () => irPara(duracaoProjeto()) },
      { rotulo: "Próximo corte", atalho: "↓", acao: () => { const p = projeto.clipes.flatMap((c) => [c.inicio, c.inicio + c.duracao]).filter((t) => t > cursor + 1e-4).sort((a, b) => a - b)[0]; if (p !== undefined) irPara(p); } },
      { rotulo: "Corte anterior", atalho: "↑", acao: () => { const p = projeto.clipes.flatMap((c) => [c.inicio, c.inicio + c.duracao]).filter((t) => t < cursor - 1e-4).sort((a, b) => b - a)[0]; if (p !== undefined) irPara(p); } },
    ] },
    { rotulo: "Exibir", itens: [
      { rotulo: "Aproximar", atalho: ["=", "Mais", "Shift+Mais"], acao: () => zoom(1.5) },
      { rotulo: "Afastar", atalho: "-", acao: () => zoom(1 / 1.5) },
      { rotulo: "Ver tudo", atalho: "0", acao: verTudo },
      { rotulo: "Guias de área segura", acao: () => { $("#guias").checked = !$("#guias").checked; atualizarQuadro(); }, marcado: () => $("#guias").checked },
      "-",
      { rotulo: "Layout: edição", acao: () => LNUX.layout.definir("edicao"), marcado: () => LNUX.layout.atual() === "edicao" },
      { rotulo: "Layout: cor", acao: () => LNUX.layout.definir("cor"), marcado: () => LNUX.layout.atual() === "cor" },
      { rotulo: "Layout: montagem", acao: () => LNUX.layout.definir("montagem"), marcado: () => LNUX.layout.atual() === "montagem" },
      { rotulo: "Layout: celular", acao: () => LNUX.layout.definir("celular"), marcado: () => LNUX.layout.atual() === "celular" },
    ] },
    { rotulo: "Ajuda", itens: [
      { rotulo: "Atalhos de teclado", acao: () => LNUX.ajudaAtalhos() },
      { rotulo: "Como editar", acao: ajuda },
      { rotulo: "Sobre o Vídeo", acao: () => LNUX.sobre() },
    ] },
  ];

  function ajuda() {
    LNUX.dialogo({ titulo: "Como usar o Vídeo", largo: true, corpo: el("div", { html: `
      <p><strong>Mídias:</strong> arraste vídeos, músicas e fotos para a lista <em>Mídias</em> (ou use Importar). Arraste da lista para a linha do tempo, ou dê dois cliques para pôr no cursor.</p>
      <p><strong>Cortar:</strong> ponha o cursor e aperte <b>S</b> para separar; puxe as bordas do clipe para aparar; <b>Del</b> apaga e <b>Shift+Del</b> apaga fechando o buraco. Com <b>C</b>, cada clique corta.</p>
      <p><strong>Na tela:</strong> clique num clipe no monitor para escolher, arraste para mover e use a rodinha do mouse para aumentar ou diminuir.</p>
      <p><strong>Cor, transições, áudio e texto:</strong> no painel <em>Propriedades</em> do clipe escolhido. Os "looks" aplicam uma cor pronta. <b>T</b> cria um título; <em>Importar legendas</em> transforma um .srt em textos.</p>
      <p><strong>Exportar:</strong> o vídeo é gravado enquanto toca (WebM). Com a ponte local e o ffmpeg, sai em MP4 ou GIF.</p>
      <p><strong>Guardar:</strong> tudo fica guardado neste navegador sozinho. <em>Salvar projeto</em> gera um .lnuxvideo com as mídias dentro (as que vieram das pastas do aparelho ficam só como caminho).</p>` }) });
  }

  $("#botao-importar").addEventListener("click", importar);
  $("#botao-texto").addEventListener("click", () => { hist.marcar("Novo texto"); novoTexto(); mudou(); });
  $("#guias").addEventListener("change", atualizarQuadro);
  for (const b of document.querySelectorAll("#abas-celular button")) {
    b.addEventListener("click", () => {
      document.documentElement.dataset.aba = b.dataset.aba;
      for (const x of document.querySelectorAll("#abas-celular button")) x.setAttribute("aria-selected", String(x === b));
      setTimeout(() => { atualizarEspaco(); redesenhar(); ajustarTela(); }, 20);
    });
  }
  document.documentElement.dataset.aba = "linha";

  LNUX.iniciar({
    app: "video", nome: "Vídeo",
    descricao: "Editor de vídeo com linha do tempo de várias trilhas: cortar, aparar, cor, transições, títulos, legendas e exportar em WebM, MP4 ou GIF.",
    inspirado: { nome: "FilmCraft", url: "https://github.com/storytold/filmcraft", autores: "ArtCraft Team e os colaboradores do FilmCraft" },
    layouts: [
      { id: "edicao", nome: "Edição", descricao: "Mídias, monitor, propriedades e a linha do tempo", icone: "layout" },
      { id: "cor", nome: "Cor", descricao: "Monitor e propriedades maiores, para acertar a cor", icone: "cor" },
      { id: "montagem", nome: "Montagem", descricao: "A linha do tempo bem alta", icone: "video" },
      { id: "celular", nome: "Celular", descricao: "Monitor em cima e abas embaixo", icone: "tela", celular: true },
    ],
    aoMudarLayout: () => setTimeout(() => { atualizarEspaco(); redesenhar(); ajustarTela(); }, 30),
    menus,
  }).then(async () => {
    const recuperado = await restaurar();
    if (recuperado) LNUX.aviso("Projeto recuperado de onde você parou.", "ok");
    mudou();
    if (projeto.clipes.length) verTudo();
  });
  mudou();

  window.Video = { get projeto() { return projeto; }, motor, adicionarArquivos, colocarNaLinha, novoTexto, irPara, separarNoCursor, gerarPacote, exportar, lerSrt, srtDe, get cursor() { return cursor; } };
})();
