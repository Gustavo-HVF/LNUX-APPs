/*
 * Vídeo — núcleo: estado do projeto, mídias, reprodução, monitor de programa, espaços de trabalho, menus,
 * salvar/abrir e exportar. Os painéis ficam em linha.js (linha do tempo e ferramentas), controles.js (Controles
 * de efeito, Propriedades, Cor, Escopos) e paineis.js (Projeto, Origem, Efeitos, Marcadores, Texto...).
 * Todos conversam por V.app (o objeto "A" daqui).
 */
(function () {
  "use strict";
  const { el, icone, $, limitar } = LNUX;

  // Ícones próprios do Vídeo (mesmo traço dos de comum/lnux.js)
  const ICV = {
    entrada: '<path d="M9 4H6v16h3"/><path d="M13 12h6M16 9l3 3-3 3"/>',
    saida: '<path d="M15 4h3v16h-3"/><path d="M11 12H5M8 9l-3 3 3 3"/>',
    "ir-entrada": '<path d="M6 4v16"/><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
    "ir-saida": '<path d="M18 4v16"/><path d="M5 5.5v13L15 12z" fill="currentColor" stroke="none"/>',
    levantar: '<path d="M4 16h16"/><path d="M12 13V4M8 8l4-4 4 4"/><path d="M4 20h5M15 20h5"/>',
    extrair: '<path d="M4 18h16"/><path d="M12 15V4M8 8l4-4 4 4"/><path d="M9 21l3-3 3 3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    selecao: '<path d="M6 3l12 9-5.5 1.2L15.5 20l-2.5 1-3-6.8L6 18z"/>',
    "trilha-frente": '<path d="M4 12h12M12 7l5 5-5 5"/><path d="M19 5v14"/>',
    ondulacao: '<path d="M8 4v16"/><path d="M8 12h11M15 8l4 4-4 4"/>',
    rolagem: '<path d="M12 4v16"/><path d="M4 12h5M15 12h5M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
    esticar: '<path d="M4 6v12M20 6v12"/><path d="M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
    navalha: '<path d="M14 3l7 7-11 11H3v-7z"/><path d="M10 7l7 7"/>',
    slip: '<path d="M3 8h18v8H3z"/><path d="M8 12h8M11 10l-3 2 3 2M13 10l3 2-3 2"/>',
    slide: '<path d="M3 8h5v8H3zM16 8h5v8h-5z"/><path d="M9 6h6v12H9z"/>',
    mao: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-12 5l-3-4a1.5 1.5 0 0 1 2.3-2z"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    texto: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    vinculo: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    chave: '<path d="M12 3l4 4-4 4-4-4z" fill="currentColor"/><path d="M3 18l5-5 4 3 9-8"/>',
    guias: '<rect x="3" y="5" width="18" height="14" rx="1"/><rect x="6" y="8" width="12" height="8" stroke-dasharray="2 2"/>',
  };
  const icv = (nome) => (ICV[nome] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICV[nome]}</svg>` : icone(nome));

  const CORES_ROTULO = { nenhum: null, violeta: "#a879f2", iris: "#5b9dff", caribe: "#3cc6d0", lavanda: "#c4a7ff", ceruleo: "#2f9bdf", floresta: "#3fa34d", rosa: "#e5577a", manga: "#f5a524", amarelo: "#e8d44d", tangerina: "#ef7f45" };
  const CORES_MARCADOR = { verde: "#3fbf6f", vermelho: "#e5484d", laranja: "#f5a524", amarelo: "#e8d44d", branco: "#e8eaed", azul: "#4f8ff7", ciano: "#3cc6d0", roxo: "#a879f2" };

  // ── Estado ──────────────────────────────────────────────────────────

  function novoProjeto() {
    return {
      versao: 2, nome: "Projeto sem nome", largura: 1920, altura: 1080, fps: 30, fundo: "#000000", volumeMestre: 0,
      midias: {}, pastas: [], transicoes: [], marcadores: [], entrada: null, saida: null,
      trilhas: [
        { id: "V3", tipo: "video", nome: "Vídeo 3", alvo: true },
        { id: "V2", tipo: "video", nome: "Vídeo 2", alvo: true },
        { id: "V1", tipo: "video", nome: "Vídeo 1", alvo: true, origem: true },
        { id: "A1", tipo: "audio", nome: "Áudio 1", alvo: true, origem: true, volume: 0, pan: 0 },
        { id: "A2", tipo: "audio", nome: "Áudio 2", alvo: true, volume: 0, pan: 0 },
        { id: "A3", tipo: "audio", nome: "Áudio 3", alvo: true, volume: 0, pan: 0 },
      ],
      clipes: [],
    };
  }

  const A = (V.app = {
    projeto: novoProjeto(),
    arquivos: new Map(), // id da mídia → Blob (as que vieram do navegador)
    urls: new Map(), // id da mídia → URL que o <video> abre
    miniaturas: new Map(), // id da mídia → Image
    picos: new Map(), // id da mídia → {taxa, min, max} (forma de onda) | null
    guardados: new Set(), // mídias já guardadas no navegador
    selecao: new Set(),
    trilhaAtiva: "V1",
    cursor: 0,
    tocando: false,
    velocidadeJKL: 0,
    ferramenta: "selecao",
    ima: true,
    vinculada: true,
    guias: false,
    transicaoEscolhida: null,
    midiaEscolhida: null,
    monitorAtivo: "programa",
    contaGotas: null,
    caminhoProjeto: null,
    copiados: null,
    CORES_ROTULO, CORES_MARCADOR, icv,
  });

  A.hist = new LNUX.Historico(() => A.projeto, (estado) => {
    A.projeto = estado;
    A.selecao = new Set([...A.selecao].filter((id) => A.clipe(id)));
    if (A.transicaoEscolhida && !A.projeto.transicoes.some((t) => t.id === A.transicaoEscolhida)) A.transicaoEscolhida = null;
    for (const id of Object.keys(A.projeto.midias)) if (!A.urls.get(id)) A.registrarUrl(id);
    A.mudou();
  });
  A.marcar = (descricao) => A.hist.marcar(descricao);

  A.clipe = (id) => A.projeto.clipes.find((c) => c.id === id);
  A.trilha = (id) => A.projeto.trilhas.find((t) => t.id === id);
  A.midia = (id) => A.projeto.midias[id];
  A.escolhidos = () => A.projeto.clipes.filter((c) => A.selecao.has(c.id));
  A.quadro = () => 1 / A.projeto.fps;
  A.arredondar = (t) => Math.round(t * A.projeto.fps) / A.projeto.fps;
  A.duracao = () => V.duracaoTotal(A.projeto);
  A.tempo = (t) => LNUX.tempo(t, A.projeto.fps);
  A.trilhasAlvo = (tipo) => A.projeto.trilhas.filter((t) => (!tipo || t.tipo === tipo) && t.alvo !== false && !t.travada).map((t) => t.id);

  /** Clipe novo com as propriedades padrão (Movimento, Opacidade, Recorte, Volume). */
  A.clipeBase = function (extra) {
    const p = A.projeto;
    return Object.assign({
      id: V.novoId("c"), trilha: "V1", tipo: "midia", inicio: 0, entrada: 0, duracao: 5, velocidade: 1, ativo: true, nome: "",
      mov: { posX: p.largura / 2, posY: p.altura / 2, escala: 100, escalaLargura: 100, uniforme: true, rotacao: 0, ancoraX: null, ancoraY: null },
      opac: { valor: 100, mistura: "normal" }, rec: { esquerda: 0, topo: 0, direita: 0, baixo: 0, suavizar: 0 },
      audio: { nivel: 0, pan: 0 }, efeitos: [], anim: {},
    }, extra);
  };

  /** Muda um valor no instante do cursor: com a animação ligada vira quadro-chave; sem, muda o valor fixo. */
  A.definirValor = function (c, caminho, v) {
    const ch = c.anim && c.anim[caminho];
    if (ch && ch.length) {
      const t = A.arredondar(limitar(A.cursor - c.inicio, 0, c.duracao));
      const k = ch.find((x) => Math.abs(x.t - t) < A.quadro() / 2);
      if (k) k.v = v; else ch.push({ t, v, i: "linear" });
      V.ajeitarChaves(ch);
    } else V.definirFixo(c, caminho, v);
  };

  // ── Mídias ──────────────────────────────────────────────────────────

  function tipoDaMidia(nome, mime) {
    mime = mime || LNUX.mimeDe(nome);
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("image/")) return "imagem";
    return null;
  }
  function miniaturaDe(fonte, w, h) {
    const c = document.createElement("canvas");
    c.width = 192; c.height = 108;
    const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, 192, 108);
    const e = Math.min(192 / w, 108 / h);
    try { x.drawImage(fonte, (192 - w * e) / 2, (108 - h * e) / 2, w * e, h * e); } catch (err) { return null; }
    return c.toDataURL("image/jpeg", 0.72);
  }
  function analisar(url, tipo) {
    return new Promise((resolver, rejeitar) => {
      const espera = setTimeout(() => rejeitar(new Error("A mídia demorou demais para abrir.")), 25000);
      if (tipo === "imagem") {
        const img = new Image();
        img.onload = () => { clearTimeout(espera); resolver({ duracao: 5, largura: img.naturalWidth, altura: img.naturalHeight, miniatura: miniaturaDe(img, img.naturalWidth, img.naturalHeight) }); };
        img.onerror = () => { clearTimeout(espera); rejeitar(new Error("O navegador não abriu esta imagem.")); };
        img.src = url;
        return;
      }
      const m = document.createElement(tipo === "audio" ? "audio" : "video");
      m.preload = "auto"; m.muted = true;
      m.onerror = () => { clearTimeout(espera); rejeitar(new Error("O navegador não abre este formato.")); };
      m.onloadedmetadata = () => {
        const duracao = isFinite(m.duration) ? m.duration : 0;
        if (tipo === "audio") { clearTimeout(espera); resolver({ duracao, largura: 0, altura: 0, miniatura: null }); return; }
        m.currentTime = Math.min(1, duracao / 3);
        m.onseeked = () => { clearTimeout(espera); resolver({ duracao, largura: m.videoWidth, altura: m.videoHeight, miniatura: miniaturaDe(m, m.videoWidth, m.videoHeight) }); m.removeAttribute("src"); m.load(); };
      };
      m.src = url;
    });
  }

  /** Decodifica o áudio da mídia (forma de onda, exportar só o áudio, saber se o vídeo tem som). */
  const buffersAudio = new Map();
  A.bufferDeAudio = async function (id) {
    if (buffersAudio.has(id)) return buffersAudio.get(id);
    const m = A.midia(id);
    if (!m || m.tipo === "imagem") return null;
    let dados = null;
    try {
      if (A.arquivos.has(id)) { if (A.arquivos.get(id).size > 250e6) return null; dados = await A.arquivos.get(id).arrayBuffer(); }
      else if (m.caminho && LNUX.ponte.disponivel) { if ((m.tamanho || 0) > 250e6) return null; dados = await LNUX.ponte.ler(m.caminho, "arraybuffer"); }
      else return null;
      const b = await A.audio.garantir().decodeAudioData(dados);
      buffersAudio.set(id, b);
      return b;
    } catch (e) { buffersAudio.set(id, null); return null; }
  };
  async function calcularPicos(id) {
    if (A.picos.has(id)) return;
    A.picos.set(id, null);
    const b = await A.bufferDeAudio(id);
    if (!b) return;
    const taxa = 120, passo = Math.max(1, Math.floor(b.sampleRate / taxa)), n = Math.ceil(b.length / passo);
    const min = new Float32Array(n), max = new Float32Array(n);
    const canais = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let mi = 0, ma = 0;
      for (const d of canais) for (let j = i * passo, f = Math.min(b.length, j + passo); j < f; j++) { const v = d[j]; if (v < mi) mi = v; if (v > ma) ma = v; }
      min[i] = mi; max[i] = ma;
    }
    A.picos.set(id, { taxa: b.sampleRate / passo, min, max });
    V.Linha && V.Linha.redesenhar();
  }

  A.registrarUrl = function (id) {
    const m = A.midia(id);
    if (!m) return;
    if (A.arquivos.has(id)) { if (!A.urls.has(id) || !A.urls.get(id).startsWith("blob:")) A.urls.set(id, URL.createObjectURL(A.arquivos.get(id))); }
    else if (m.caminho && LNUX.ponte.disponivel) A.urls.set(id, LNUX.ponte.url(m.caminho));
    else A.urls.delete(id);
    if (m.miniatura && !A.miniaturas.has(id)) { const img = new Image(); img.onload = () => V.Linha && V.Linha.redesenhar(); img.src = m.miniatura; A.miniaturas.set(id, img); }
    if (A.urls.get(id)) calcularPicos(id);
  };

  /** Importa arquivos (do navegador ou da ponte) para o projeto. Devolve os ids novos. */
  A.importar = async function (lista, { pasta = null } = {}) {
    const novas = [];
    const p = lista.length > 1 ? LNUX.progresso("Importando") : null;
    try {
      for (const [i, arq] of lista.entries()) {
        p && p.definir(i / lista.length, arq.nome);
        const tipo = tipoDaMidia(arq.nome, arq.tipo);
        if (!tipo) { LNUX.aviso(`${arq.nome}: não é vídeo, áudio nem imagem.`, "alerta"); continue; }
        const id = V.novoId("m");
        let url;
        if (arq.origem === "ponte") url = arq.url;
        else { const blob = await arq.blob(); A.arquivos.set(id, blob); url = URL.createObjectURL(blob); }
        try {
          const info = await analisar(url, tipo);
          A.projeto.midias[id] = { nome: arq.nome, tipo, mime: arq.tipo, tamanho: arq.tamanho, caminho: arq.origem === "ponte" ? arq.caminho : null, pasta, rotulo: tipo === "audio" ? "floresta" : tipo === "imagem" ? "lavanda" : "iris", ...info };
          A.urls.set(id, url);
          A.registrarUrl(id);
          // o vídeo tem som? (ponte: ffprobe; senão, tenta decodificar o áudio)
          let temAudio = tipo === "audio";
          if (tipo === "video") {
            if (arq.origem === "ponte" && LNUX.ponte.tem("ffprobe")) { try { temAudio = !!(await LNUX.ponte.midia(arq.caminho)).audio; } catch (e) { temAudio = true; } }
            else { const b = await A.bufferDeAudio(id); temAudio = b ? true : (arq.tamanho || 0) > 250e6; }
          }
          A.projeto.midias[id].temAudio = temAudio;
          novas.push(id);
        } catch (e) {
          A.arquivos.delete(id);
          LNUX.aviso(`${arq.nome}: ${e.message}`, "erro");
        }
      }
    } finally { p && p.fechar(); }
    if (novas.length) { A.midiaEscolhida = novas[novas.length - 1]; A.mudou(); }
    return novas;
  };
  A.importarDialogo = async () => A.importar(await LNUX.arquivos.abrir({ titulo: "Importar mídias", aceitar: "video/*,audio/*,image/*", multiplos: true }));

  /** "Ajustar ao quadro": escala para a mídia caber inteira na imagem. */
  A.escalaAjustada = function (m) {
    if (!m || !m.largura) return 100;
    return Math.round(Math.min(A.projeto.largura / m.largura, A.projeto.altura / m.altura) * 1000) / 10;
  };

  /**
   * Põe uma mídia na linha do tempo (o vídeo na trilha de vídeo de origem e o som, vinculado, na de áudio).
   * modo: "sobrescrever" | "inserir"; trilhaV/trilhaA: trilhas de destino (padrão: as marcadas como origem).
   */
  A.colocarMidia = function (id, { tempo = A.cursor, modo = "sobrescrever", trilhaV, trilhaA, entrada, saida, video = true, audio = true, marcar = true } = {}) {
    const m = A.midia(id);
    if (!m) return [];
    const p = A.projeto;
    const ini = entrada ?? 0, fim = saida ?? (m.tipo === "imagem" ? ini + 5 : m.duracao);
    const dur = Math.max(A.quadro(), A.arredondar(fim - ini));
    const tv = trilhaV || (p.trilhas.find((t) => t.tipo === "video" && t.origem) || p.trilhas.find((t) => t.tipo === "video")).id;
    const ta = trilhaA || (p.trilhas.find((t) => t.tipo === "audio" && t.origem) || p.trilhas.find((t) => t.tipo === "audio")).id;
    if (marcar) A.marcar(modo === "inserir" ? "Inserir" : "Sobrescrever");
    const querVideo = m.tipo !== "audio" && video, querAudio = (m.tipo === "audio" || (m.tipo === "video" && m.temAudio)) && audio;
    const vinculo = querVideo && querAudio ? V.novoId("v") : undefined;
    const novos = [];
    const nome = LNUX.nomeSemExtensao(m.nome);
    if (querVideo) novos.push(A.clipeBase({ trilha: tv, tipo: "midia", midia: id, entrada: ini, duracao: dur, nome, vinculo, mov: { ...A.clipeBase().mov, escala: A.escalaAjustada(m) } }));
    if (querAudio) novos.push(A.clipeBase({ trilha: ta, tipo: "midia", midia: id, entrada: ini, duracao: dur, nome, vinculo }));
    if (!novos.length) return [];
    for (const c of novos) c.inicio = 0;
    if (modo === "inserir") V.inserir(p, novos, tempo, p.trilhas.filter((t) => !t.travada).map((t) => t.id));
    else V.sobrescrever(p, novos, tempo);
    A.selecao = new Set(novos.map((c) => c.id));
    A.transicaoEscolhida = null;
    A.mudou();
    return novos;
  };

  /** Clipe de texto, forma, cor sólida ou camada de ajuste na trilha de vídeo livre mais alta. */
  A.novoGrafico = function (tipo, extra = {}, { tempo = A.cursor, duracao = 5 } = {}) {
    const p = A.projeto;
    tempo = A.arredondar(tempo);
    A.marcar("Novo " + { texto: "título", forma: "forma", cor: "cor sólida", ajuste: "camada de ajuste" }[tipo]);
    const livre = (t) => t.tipo === "video" && !t.travada && !t.legendas && !p.clipes.some((c) => c.trilha === t.id && c.inicio < tempo + duracao && V.fim(c) > tempo);
    let trilha = p.trilhas.find(livre);
    if (!trilha) {
      const n = p.trilhas.filter((t) => t.tipo === "video").length + 1;
      let id = "V" + n;
      while (A.trilha(id)) id = "V" + Math.floor(Math.random() * 900 + 100);
      trilha = { id, tipo: "video", nome: "Vídeo " + n, alvo: true };
      p.trilhas.splice(p.trilhas.findIndex((t) => t.tipo === "video" && !t.legendas), 0, trilha);
    }
    const nomes = { texto: "Título", forma: "Forma", cor: "Cor sólida", ajuste: "Camada de ajuste" };
    const c = A.clipeBase(Object.assign({ trilha: trilha.id, tipo, inicio: tempo, duracao, nome: nomes[tipo] }, extra));
    if (tipo === "texto" && !c.texto) c.texto = { conteudo: "Seu título", fonte: "system-ui, sans-serif", tamanho: 9, cor: "#ffffff", negrito: true, italico: false, alinhamento: "center", contorno: false, corContorno: "#000000", espessuraContorno: 8, sombra: true, fundo: { ligado: false, cor: "#000000", opacidade: 0.6 }, posicao: "meio", animacao: "aparecer", entrelinha: 1.22 };
    if (tipo === "forma" && !c.forma) c.forma = { tipo: "retangulo", largura: Math.round(p.largura * 0.4), altura: Math.round(p.altura * 0.18), raio: 16, preenchimento: "#2f6fe4", gradiente: null, contorno: "#ffffff", espessura: 0, sombra: true };
    if (tipo === "cor" && !c.cor) c.cor = "#1d4ed8";
    p.clipes.push(c);
    A.selecao = new Set([c.id]);
    A.transicaoEscolhida = null;
    A.mudou();
    return c;
  };

  /** Aplica um efeito do catálogo aos clipes (de vídeo: imagem, título, ajuste...; de áudio: os de som). */
  A.aplicarEfeito = function (ids, efeitoId, audio) {
    const alvos = A.projeto.clipes.filter((c) => ids.has(c.id) && (audio ? A.trilha(c.trilha).tipo === "audio" : A.trilha(c.trilha).tipo === "video"));
    if (!alvos.length) { LNUX.aviso(audio ? "Escolha um clipe de áudio." : "Escolha um clipe de vídeo, imagem, título ou camada de ajuste."); return; }
    A.marcar("Aplicar efeito");
    for (const c of alvos) c.efeitos.push(V.novoEfeito(efeitoId, audio));
    A.selecao = new Set(alvos.map((c) => c.id));
    A.mudou();
    V.Paineis && V.Paineis.abrirAba("esq", "controles");
  };

  /** Transição num ponto de corte da trilha (perto de t) ou no começo/fim de um clipe sozinho. */
  A.aplicarTransicao = function (trilha, t, tipo, { duracao = 1, marcar = true } = {}) {
    const p = A.projeto;
    const tol = Math.max(0.25, 12 / (V.Linha ? V.Linha.pxs() : 40));
    const pontos = V.pontosDeCorte(p, [trilha]).filter((x) => Math.abs(x - t) < tol).sort((a, b) => Math.abs(a - t) - Math.abs(b - t));
    if (!pontos.length) { LNUX.aviso("Ponha a transição num ponto de corte (onde um clipe termina ou começa)."); return null; }
    const corte = pontos[0];
    const { a, b } = V.vizinhosNoCorte(p, trilha, corte);
    if (!a && !b) return null;
    if (marcar) A.marcar("Transição");
    // tira a que já existir no mesmo ponto
    p.transicoes = p.transicoes.filter((x) => !(x.trilha === trilha && ((a && x.a === a.id && (!x.b || (b && x.b === b.id))) || (b && x.b === b.id && !x.a))));
    const d = Math.min(duracao, a && b ? 2 * Math.min(a.duracao, b.duracao) : (a || b).duracao);
    const tr = { id: V.novoId("t"), trilha, a: a ? a.id : null, b: b ? b.id : null, tipo, duracao: A.arredondar(d), direcao: 0 };
    p.transicoes.push(tr);
    A.mudou();
    return tr;
  };
  A.transicaoPadrao = function (audio = false) {
    const trilhas = A.trilhasAlvo(audio ? "audio" : "video");
    const pontos = V.pontosDeCorte(A.projeto, trilhas).filter((x) => x > 0);
    if (!pontos.length) { LNUX.aviso("Não há pontos de corte nas trilhas marcadas."); return; }
    const corte = pontos.sort((x, y) => Math.abs(x - A.cursor) - Math.abs(y - A.cursor))[0];
    const tipo = audio ? (V.Paineis.padraoAudio || "potencia") : (V.Paineis.padraoVideo || "dissolver");
    A.marcar(audio ? "Transição de áudio" : "Transição de vídeo");
    let n = 0;
    for (const t of trilhas) {
      const { a, b } = V.vizinhosNoCorte(A.projeto, t, corte);
      if ((a || b) && A.aplicarTransicao(t, corte, tipo, { marcar: false })) n++;
    }
    if (!n) LNUX.aviso("Nenhuma trilha marcada tem clipe nesse ponto.");
  };

  // ── Reprodução: um elemento de mídia por clipe ──────────────────────

  const elementos = new Map(); // id do clipe → {el, url, imagem, audio}
  A.elementos = elementos;

  function elementoDe(c) {
    const m = A.midia(c.midia);
    const url = A.urls.get(c.midia);
    let x = elementos.get(c.id);
    if (x && x.url === url) return x;
    if (x) descartar(c.id);
    if (!m || !url) return null;
    const naTrilhaDeAudio = A.trilha(c.trilha).tipo === "audio";
    if (m.tipo === "imagem") {
      if (naTrilhaDeAudio) return null;
      const img = new Image();
      img.src = url;
      x = { el: img, url, imagem: true };
    } else {
      const e = document.createElement(naTrilhaDeAudio ? "audio" : "video");
      e.preload = "auto"; e.playsInline = true; e.src = url;
      if (!naTrilhaDeAudio) e.muted = true; // o som vem do clipe de áudio vinculado
      x = { el: e, url, imagem: false, audio: naTrilhaDeAudio };
    }
    elementos.set(c.id, x);
    return x;
  }
  function descartar(id) {
    const x = elementos.get(id);
    if (!x) return;
    if (!x.imagem) { try { x.el.pause(); x.el.removeAttribute("src"); x.el.load(); } catch (e) { /* ok */ } }
    A.audio.soltar(id);
    elementos.delete(id);
    A.render && A.render.ok && A.render.esquecer("m:" + id);
  }

  /** Põe cada elemento no ponto certo para o instante t. Parado: devolve uma Promise que espera os quadros. */
  function sincronizar(t, tocando) {
    const espera = [];
    const p = A.projeto;
    const taxa = Math.abs(A.velocidadeJKL) > 1 ? Math.abs(A.velocidadeJKL) : 1;
    const vivos = new Set();
    for (const c of p.clipes) {
      vivos.add(c.id);
      if (c.tipo !== "midia") continue;
      const [de, ate] = V.janelaDoClipe(p, c);
      const perto = t >= de - 1.5 && t < ate;
      if (!perto) {
        const x = elementos.get(c.id);
        if (x && (t < de - 15 || t > ate + 15)) descartar(c.id); else if (x && !x.imagem && !x.el.paused) x.el.pause();
        continue;
      }
      const x = elementoDe(c);
      if (!x || x.imagem) continue;
      const e = x.el;
      if (x.audio) A.audio.ligar(c, e); // (re)monta a cadeia se os efeitos de áudio ou a trilha mudaram
      const ativo = t >= de && t < ate && c.ativo !== false;
      const dur = A.midia(c.midia).duracao || Infinity;
      const alvo = Math.min(Math.max(0, c.entrada + (Math.max(t, de) - c.inicio) * (c.velocidade || 1)), Math.max(0, dur - 0.04));
      if (!ativo) {
        if (!e.paused) e.pause();
        if (Math.abs(e.currentTime - alvo) > 0.05 && e.readyState >= 1) e.currentTime = alvo;
        continue;
      }
      if (tocando && A.velocidadeJKL >= 0) {
        e.playbackRate = Math.min(16, (c.velocidade || 1) * taxa);
        if (e.paused) { if (Math.abs(e.currentTime - alvo) > 0.05) e.currentTime = alvo; const pr = e.play(); if (pr && pr.catch) pr.catch(() => {}); }
        else if (Math.abs(e.currentTime - alvo) > 0.25 * taxa) e.currentTime = alvo;
      } else {
        if (!e.paused) e.pause();
        if (Math.abs(e.currentTime - alvo) > 0.02) {
          espera.push(new Promise((r) => { const ok = () => { e.removeEventListener("seeked", ok); r(); }; e.addEventListener("seeked", ok); setTimeout(ok, 1500); }));
          try { e.currentTime = alvo; } catch (err) { /* sem metadados ainda */ }
        }
      }
    }
    for (const id of [...elementos.keys()]) if (!vivos.has(id)) descartar(id); // clipes apagados
    A.audio.atualizar(p, t);
    return Promise.all(espera);
  }
  A.sincronizar = sincronizar;
  function pausarTudo() { for (const x of elementos.values()) if (!x.imagem && !x.el.paused) x.el.pause(); }

  /** Imagem de um clipe para o compositor. */
  function fonte(c) {
    const x = elementos.get(c.id) || (c.tipo === "midia" ? elementoDe(c) : null);
    if (!x) return null;
    if (x.imagem) return x.el.complete && x.el.naturalWidth ? { el: x.el, w: x.el.naturalWidth, h: x.el.naturalHeight } : null;
    return x.el.readyState >= 2 && x.el.videoWidth ? { el: x.el, w: x.el.videoWidth, h: x.el.videoHeight } : null;
  }
  A.fonte = fonte;
  /** Tamanho da camada do clipe (px), para as alças e o ponto de ancoragem. */
  A.tamanhoCamada = function (c) {
    if (c.tipo !== "midia") return { w: A.projeto.largura, h: A.projeto.altura };
    const f = fonte(c);
    if (f) return { w: f.w, h: f.h };
    const m = A.midia(c.midia);
    return m && m.largura ? { w: m.largura, h: m.altura } : null;
  };

  // ── Monitor de programa ─────────────────────────────────────────────

  const canvas = $("#quadro"), sobre = $("#sobreposicao");
  A.render = new V.Render(canvas);
  A.audio = new V.Audio();
  let resolucao = 1;
  let exportando = null;

  function desenharQuadro(t) {
    if (!A.render.ok) return;
    A.render.desenhar(A.projeto, t, fonte, { escala: exportando ? exportando.escala : resolucao });
    if (!exportando) desenharSobreposicao();
  }
  A.desenharQuadro = desenharQuadro;

  let pendente = false, outraVez = false;
  A.atualizarQuadro = function () {
    if (A.tocando) return;
    desenharQuadro(A.cursor);
    if (pendente) { outraVez = true; return; }
    pendente = true;
    sincronizar(A.cursor, false).then(() => {
      pendente = false;
      if (!A.tocando) desenharQuadro(A.cursor);
      V.Controles && V.Controles.escopos();
      if (outraVez) { outraVez = false; A.atualizarQuadro(); }
    });
  };
  // vídeos que terminam de carregar depois: redesenha de vez em quando
  setInterval(() => { if (!A.tocando && !exportando && document.visibilityState === "visible") desenharQuadro(A.cursor); }, 900);

  function ajustarTela() {
    const tela = $("#tela");
    const zoom = $("#zoom-programa").value;
    const W = A.projeto.largura, H = A.projeto.altura;
    let e;
    if (zoom === "ajustar") e = Math.min((tela.clientWidth - 16) / W, (tela.clientHeight - 16) / H);
    else e = +zoom / (window.devicePixelRatio || 1);
    e = Math.max(0.02, e);
    canvas.style.width = Math.round(W * e) + "px";
    canvas.style.height = Math.round(H * e) + "px";
    desenharSobreposicao();
  }
  new ResizeObserver(ajustarTela).observe($("#tela"));
  $("#zoom-programa").addEventListener("change", ajustarTela);
  $("#resolucao").addEventListener("change", (e) => { resolucao = +e.target.value; A.atualizarQuadro(); });

  /** Matriz da camada de um clipe no instante t (para as alças do monitor). */
  function geometria(c, t) {
    const tam = A.tamanhoCamada(c);
    if (!tam) return null;
    const tl = t - c.inicio;
    const v = (k, d) => { const x = V.valor(c, "mov." + k, tl); return x === undefined || x === null ? d : x; };
    const s = v("escala", 100) / 100;
    return { w: tam.w, h: tam.h, px: v("posX", A.projeto.largura / 2), py: v("posY", A.projeto.altura / 2), sx: c.mov.uniforme === false ? v("escalaLargura", 100) / 100 : s, sy: s,
      rot: (v("rotacao", 0) * Math.PI) / 180, ax: v("ancoraX", tam.w / 2), ay: v("ancoraY", tam.h / 2) };
  }
  const paraProjeto = (g, x, y) => { const dx = (x - g.ax) * g.sx, dy = (y - g.ay) * g.sy, c = Math.cos(g.rot), s = Math.sin(g.rot); return [g.px + dx * c - dy * s, g.py + dx * s + dy * c]; };
  const paraCamada = (g, x, y) => { const dx = x - g.px, dy = y - g.py, c = Math.cos(-g.rot), s = Math.sin(-g.rot); return [(dx * c - dy * s) / g.sx + g.ax, (dx * s + dy * c) / g.sy + g.ay]; };

  function desenharSobreposicao() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    sobre.width = Math.round(r.width * dpr); sobre.height = Math.round(r.height * dpr);
    const ctx = sobre.getContext("2d");
    ctx.clearRect(0, 0, sobre.width, sobre.height);
    const k = sobre.width / A.projeto.largura;
    if (A.guias) {
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
      const W = sobre.width, H = sobre.height;
      ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
      ctx.beginPath(); ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2); ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 + 10); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (A.tocando) return;
    const c = A.escolhidos().find((x) => A.trilha(x.trilha).tipo === "video" && A.cursor >= x.inicio && A.cursor < V.fim(x));
    if (!c) return;
    const g = geometria(c, A.cursor);
    if (!g) return;
    const cantos = [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]].map(([x, y]) => paraProjeto(g, x, y).map((v) => v * k));
    ctx.strokeStyle = "#4f8ff7"; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); cantos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const [x, y] of cantos) { ctx.fillRect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); ctx.strokeRect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); }
    const [gx, gy] = paraProjeto(g, g.w / 2, -24 / (k * g.sy || 1)).map((v) => v * k);
    ctx.beginPath(); ctx.arc(gx, gy, 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const [ax, ay] = paraProjeto(g, g.ax, g.ay).map((v) => v * k);
    ctx.beginPath(); ctx.arc(ax, ay, 5 * dpr, 0, Math.PI * 2); ctx.moveTo(ax - 8 * dpr, ay); ctx.lineTo(ax + 8 * dpr, ay); ctx.moveTo(ax, ay - 8 * dpr); ctx.lineTo(ax, ay + 8 * dpr); ctx.stroke();
  }
  A.desenharSobreposicao = desenharSobreposicao;

  // Arrastar no monitor: mover (dentro), redimensionar (cantos), girar (bolinha de cima). Ferramenta Texto: cria um título.
  let arrastoTela = null;
  sobre.addEventListener("pointerdown", (e) => {
    if (A.tocando) A.pausar();
    A.monitorAtivo = "programa";
    const r = sobre.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * A.projeto.largura, y = ((e.clientY - r.top) / r.height) * A.projeto.altura;
    if (A.contaGotas) { // conta-gotas do painel Cor
      const a = A.render.amostra(256, 144);
      const f = A.contaGotas;
      A.contaGotas = null;
      if (a) { const i = (Math.floor((y / A.projeto.altura) * 143) * 256 + Math.floor((x / A.projeto.largura) * 255)) * 4; f([a.px[i], a.px[i + 1], a.px[i + 2]]); }
      return;
    }
    if (A.ferramenta === "texto") {
      const c = A.novoGrafico("texto");
      c.mov.posX = Math.round(x); c.mov.posY = Math.round(y); c.texto.posicao = "meio";
      A.ferramenta = "selecao"; V.Linha.atualizarFerramentas(); A.mudou();
      V.Paineis.abrirAba("dir", "propriedades");
      return;
    }
    const t = A.cursor;
    const candidatos = A.projeto.trilhas.filter((tr) => tr.tipo === "video" && !tr.oculta && !tr.travada).flatMap((tr) => A.projeto.clipes.filter((c) => c.trilha === tr.id && c.ativo !== false && t >= c.inicio && t < V.fim(c)));
    let alvo = null, zona = null;
    const tol = 10 * (A.projeto.largura / r.width);
    for (const c of [...A.escolhidos().filter((c) => candidatos.includes(c)), ...candidatos]) {
      const g = geometria(c, t);
      if (!g) continue;
      const [lx, ly] = paraCamada(g, x, y);
      const cantos = [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]];
      if (A.selecao.has(c.id)) {
        const [gx, gy] = paraProjeto(g, g.w / 2, -24 / ((sobre.width / A.projeto.largura) * g.sy || 1));
        if (Math.hypot(x - gx, y - gy) < tol * 1.4) { alvo = c; zona = "girar"; break; }
        if (cantos.some(([cx, cy]) => { const [px, py] = paraProjeto(g, cx, cy); return Math.hypot(x - px, y - py) < tol; })) { alvo = c; zona = "escala"; break; }
      }
      if (lx >= 0 && lx <= g.w && ly >= 0 && ly <= g.h) { alvo = c; zona = "mover"; break; }
    }
    if (!alvo) { A.selecao.clear(); A.mudou({ leve: true }); return; }
    if (!A.selecao.has(alvo.id)) { A.selecao = new Set([alvo.id]); A.transicaoEscolhida = null; }
    sobre.setPointerCapture(e.pointerId);
    const g = geometria(alvo, t);
    const tl = t - alvo.inicio;
    arrastoTela = { c: alvo, zona, x, y, g, marcado: false, px: V.valor(alvo, "mov.posX", tl), py: V.valor(alvo, "mov.posY", tl), escala: V.valor(alvo, "mov.escala", tl), rot: V.valor(alvo, "mov.rotacao", tl),
      dist: Math.hypot(x - g.px, y - g.py), ang: Math.atan2(y - g.py, x - g.px) };
    A.mudou({ leve: true });
  });
  sobre.addEventListener("pointermove", (e) => {
    const a = arrastoTela;
    if (!a) return;
    const r = sobre.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * A.projeto.largura, y = ((e.clientY - r.top) / r.height) * A.projeto.altura;
    if (!a.marcado) { if (Math.hypot(x - a.x, y - a.y) < 3) return; A.marcar("Mexer no monitor"); a.marcado = true; }
    if (a.zona === "mover") {
      let nx = a.px + x - a.x, ny = a.py + y - a.y;
      const W = A.projeto.largura, H = A.projeto.altura;
      if (Math.abs(nx - W / 2) < W * 0.01) nx = W / 2; // gruda no centro
      if (Math.abs(ny - H / 2) < H * 0.01) ny = H / 2;
      if (e.shiftKey) { if (Math.abs(x - a.x) > Math.abs(y - a.y)) ny = a.py; else nx = a.px; }
      A.definirValor(a.c, "mov.posX", Math.round(nx * 10) / 10);
      A.definirValor(a.c, "mov.posY", Math.round(ny * 10) / 10);
    } else if (a.zona === "escala") {
      A.definirValor(a.c, "mov.escala", Math.max(0.1, Math.round(a.escala * (Math.hypot(x - a.g.px, y - a.g.py) / Math.max(1, a.dist)) * 10) / 10));
    } else {
      let rot = a.rot + ((Math.atan2(y - a.g.py, x - a.g.px) - a.ang) * 180) / Math.PI;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      A.definirValor(a.c, "mov.rotacao", Math.round(rot * 10) / 10);
    }
    desenharQuadro(A.cursor);
    V.Controles && V.Controles.atualizarValores();
  });
  sobre.addEventListener("pointerup", () => { if (arrastoTela && arrastoTela.marcado) A.mudou({ leve: true }); arrastoTela = null; });
  sobre.addEventListener("wheel", (e) => {
    const c = A.escolhidos().find((x) => A.trilha(x.trilha).tipo === "video" && A.cursor >= x.inicio && A.cursor < V.fim(x));
    if (!c || A.tocando) return;
    e.preventDefault();
    A.marcar("Escala");
    A.definirValor(c, "mov.escala", Math.max(0.1, Math.round(V.valor(c, "mov.escala", A.cursor - c.inicio) * (e.deltaY < 0 ? 1.04 : 1 / 1.04) * 10) / 10));
    A.mudou({ leve: true });
  }, { passive: false });
  LNUX.soltarArquivos($("#tela"), async (lista) => { const ids = await A.importar(lista); for (const id of ids) A.colocarMidia(id); });

  // Régua do monitor e tempo
  const reguaP = $("#regua-programa");
  function desenharReguaPrograma() {
    const w = reguaP.clientWidth, h = 18, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    reguaP.width = w * dpr; reguaP.height = h * dpr;
    const ctx = reguaP.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = Math.max(1, A.duracao());
    const x = (t) => 8 + (t / d) * (w - 16);
    ctx.strokeStyle = LNUX.tema.cor("--borda-forte");
    ctx.beginPath(); ctx.moveTo(8, 12.5); ctx.lineTo(w - 8, 12.5);
    for (let i = 0; i <= 20; i++) { ctx.moveTo(x((d * i) / 20), 9); ctx.lineTo(x((d * i) / 20), 16); }
    ctx.stroke();
    const p = A.projeto;
    if (p.entrada !== null || p.saida !== null) {
      ctx.fillStyle = "rgba(79,143,247,.35)";
      const a = x(p.entrada ?? 0), b = x(p.saida ?? d);
      ctx.fillRect(a, 4, Math.max(2, b - a), 10);
    }
    for (const m of p.marcadores) { ctx.fillStyle = CORES_MARCADOR[m.cor] || "#3fbf6f"; ctx.fillRect(x(m.tempo) - 3, 0, 6, 6); }
    ctx.fillStyle = "#4f8ff7";
    const xc = x(A.cursor);
    ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc, 9); ctx.fill();
    ctx.fillRect(xc - 0.5, 0, 1, h);
  }
  reguaP.addEventListener("pointerdown", (e) => {
    reguaP.setPointerCapture(e.pointerId);
    A.monitorAtivo = "programa";
    const ir = (ev) => { const r = reguaP.getBoundingClientRect(); A.irPara(A.arredondar(((ev.clientX - r.left - 8) / (r.width - 16)) * Math.max(1, A.duracao()))); };
    ir(e);
    const fim = () => { reguaP.removeEventListener("pointermove", ir); reguaP.removeEventListener("pointerup", fim); };
    reguaP.addEventListener("pointermove", ir);
    reguaP.addEventListener("pointerup", fim);
  });
  for (const id of ["#tempo-programa", "#tempo-linha"]) {
    $(id).addEventListener("click", async () => {
      const v = await LNUX.perguntar("Ir para", { rotulo: "Tempo (00:01:30:00, 1:30 ou 90)", valor: A.tempo(A.cursor) });
      if (v === null) return;
      const t = lerTempo(v);
      if (t === null) LNUX.aviso("Não entendi esse tempo.", "alerta"); else A.irPara(t);
    });
  }
  function lerTempo(s) {
    s = String(s).trim().replace(",", ".");
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    const p = s.split(":").map(Number);
    if (!p.length || p.some((x) => !isFinite(x))) return null;
    if (p.length === 4) return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / A.projeto.fps;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return null;
  }
  A.lerTempo = lerTempo;

  function mostrarTempo() {
    $("#tempo-programa").textContent = A.tempo(A.cursor);
    $("#tempo-linha").textContent = A.tempo(A.cursor);
    $("#duracao-programa").textContent = A.tempo(A.duracao());
    desenharReguaPrograma();
  }
  A.mostrarTempo = mostrarTempo;

  // ── Tocar, parar, J K L ─────────────────────────────────────────────

  let inicioReal = 0, inicioProj = 0;
  A.irPara = function (t) {
    A.cursor = limitar(t, 0, Math.max(A.duracao(), 0) + 3600);
    if (A.tocando) { inicioProj = A.cursor; inicioReal = performance.now(); }
    mostrarTempo();
    V.Linha && V.Linha.manterVisivel();
    V.Linha && V.Linha.redesenhar();
    V.Controles && V.Controles.atualizarValores();
    V.Paineis && V.Paineis.desenhar(true);
    A.atualizarQuadro();
  };
  A.tocar = function (velocidade = 1) {
    if (!A.projeto.clipes.length) { LNUX.aviso("A linha do tempo está vazia."); return; }
    if (velocidade > 0 && A.cursor >= A.duracao() - 0.01 && !exportando) A.cursor = 0;
    A.audio.garantir();
    A.velocidadeJKL = velocidade;
    A.tocando = true;
    inicioReal = performance.now();
    inicioProj = A.cursor;
    if (!exportando) A.audio.zerarLoudness();
    atualizarBotaoPlay();
    desenharSobreposicao();
    requestAnimationFrame(laco);
  };
  A.pausar = function () {
    A.tocando = false;
    A.velocidadeJKL = 0;
    pausarTudo();
    atualizarBotaoPlay();
    A.atualizarQuadro();
    V.Controles && V.Controles.atualizarValores();
    V.Paineis && V.Paineis.desenhar(true);
  };
  A.alternarPlay = () => (A.tocando ? A.pausar() : A.tocar(1));
  A.jkl = function (tecla) {
    if (tecla === "k") { A.pausar(); return; }
    const sentido = tecla === "l" ? 1 : -1;
    const atual = A.tocando ? A.velocidadeJKL : 0;
    const v = Math.sign(atual) === sentido ? Math.min(8, Math.abs(atual) * 2) * sentido : sentido;
    if (A.tocando) A.pausar();
    A.tocar(v);
  };

  let ultimoPainel = 0;
  function laco() {
    if (!A.tocando) return;
    const agora = performance.now();
    const t = inicioProj + ((agora - inicioReal) / 1000) * A.velocidadeJKL;
    const fim = exportando ? exportando.ate : A.duracao();
    if (t >= fim || t < 0) {
      A.cursor = limitar(t, 0, fim);
      A.pausar();
      mostrarTempo();
      if (exportando && exportando.terminar) exportando.terminar();
      return;
    }
    A.cursor = t;
    sincronizar(t, A.velocidadeJKL > 0); // para trás: procura quadro a quadro
    desenharQuadro(t);
    if (exportando) exportando.progresso && exportando.progresso((t - exportando.de) / (exportando.ate - exportando.de));
    else {
      mostrarTempo();
      V.Linha && V.Linha.manterVisivel();
      V.Linha && V.Linha.redesenhar();
      if (agora - ultimoPainel > 160) { ultimoPainel = agora; V.Controles && V.Controles.escopos(); V.Controles && V.Controles.atualizarValores(); }
    }
    medidores();
    requestAnimationFrame(laco);
  }

  // ── Medidores (pico e loudness) ─────────────────────────────────────

  const caixaMedidores = $("#medidores");
  const canvasMedidor = el("canvas", { height: 200, "aria-label": "Medidor de pico (L e R)" });
  const lufs = el("div", { class: "lufs", title: "Loudness (EBU R128): M = momentâneo (0,4 s), S = curto (3 s), I = integrado (desde o play), Pico = maior pico" });
  caixaMedidores.append(canvasMedidor, lufs, el("button", { class: "lnux-botao pequeno", type: "button", title: "Zerar o loudness integrado e o pico", onclick: () => { A.audio.zerarLoudness(); medidores(true); } }, "Zerar"));
  const fmtLufs = (v) => (v === undefined || !isFinite(v) ? "—" : v.toFixed(1).replace(".", ","));
  function medidores(forcar) {
    const m = A.audio.medir(A.projeto, A.tocando);
    const ctx = canvasMedidor.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvasMedidor.clientWidth, h = canvasMedidor.clientHeight;
    if (!w || !h) return;
    if (canvasMedidor.width !== Math.round(w * dpr) || canvasMedidor.height !== Math.round(h * dpr)) { canvasMedidor.width = Math.round(w * dpr); canvasMedidor.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const barra = (i, valor) => {
      const db = 20 * Math.log10(Math.max(1e-5, valor));
      const f = limitar((db + 60) / 60, 0, 1);
      const x = 4 + i * 16;
      ctx.fillStyle = LNUX.tema.cor("--fundo"); ctx.fillRect(x, 0, 12, h);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#3fbf6f"); grad.addColorStop(0.8, "#e8d44d"); grad.addColorStop(1, "#e5484d");
      ctx.fillStyle = grad; ctx.fillRect(x, h - f * h, 12, f * h);
    };
    barra(0, m ? m.pico[0] : 0); barra(1, m ? m.pico[1] : 0);
    ctx.fillStyle = LNUX.tema.cor("--texto-3"); ctx.font = "9px sans-serif";
    for (const d of [0, -6, -12, -18, -24, -36, -48]) { const y = h - ((d + 60) / 60) * h; ctx.fillText(String(d), 38, Math.max(8, y + 3)); }
    if (m && (A.tocando || forcar)) lufs.innerHTML = `<b>M</b><span>${fmtLufs(m.momentaneo)} LUFS</span><b>S</b><span>${fmtLufs(m.curto)} LUFS</span><b>I</b><span>${fmtLufs(m.integrado)} LUFS</span><b>Pico</b><span>${fmtLufs(m.picoMax)} dB</span>`;
    V.Paineis && V.Paineis.medidoresMixer(m);
  }
  lufs.innerHTML = "<b>M</b><span>— LUFS</span><b>S</b><span>— LUFS</span><b>I</b><span>— LUFS</span><b>Pico</b><span>— dB</span>";
  new ResizeObserver(() => medidores(false)).observe(canvasMedidor);

  // ── Controles do monitor de programa ────────────────────────────────

  const ctlP = $("#controles-programa");
  const botaoMonitor = (ic, dica, acao, extra = "") => { const b = LNUX.botaoIcone("info", dica, acao, "plano " + extra); b.innerHTML = icv(ic); return b; };
  const botaoPlay = botaoMonitor("play", "Tocar / pausar (Espaço)", () => A.alternarPlay());
  ctlP.append(
    botaoMonitor("bandeira", "Adicionar marcador (M)", () => C.marcador(), "so-pc"),
    botaoMonitor("entrada", "Marcar entrada (I)", () => C.entrada(true)),
    botaoMonitor("saida", "Marcar saída (O)", () => C.saida(true)),
    botaoMonitor("ir-entrada", "Ir para a entrada (Shift+I)", () => A.irPara(A.projeto.entrada ?? 0), "so-pc"),
    botaoMonitor("voltar", "Quadro anterior (←)", () => A.irPara(A.cursor - A.quadro())),
    botaoPlay,
    botaoMonitor("avancar", "Próximo quadro (→)", () => A.irPara(A.cursor + A.quadro())),
    botaoMonitor("ir-saida", "Ir para a saída (Shift+O)", () => A.irPara(A.projeto.saida ?? A.duracao()), "so-pc"),
    el("span", { class: "sep" }),
    botaoMonitor("levantar", "Levantar (;): tira o trecho entre a entrada e a saída, deixando o buraco", () => C.levantar()),
    botaoMonitor("extrair", "Extrair ('): tira o trecho e fecha o buraco", () => C.extrair()),
    botaoMonitor("camera", "Exportar quadro (Shift+E)", () => exportarQuadro()),
    botaoMonitor("guias", "Guias de área segura", () => { A.guias = !A.guias; desenharSobreposicao(); }, "so-pc"));
  function atualizarBotaoPlay() { botaoPlay.innerHTML = icone(A.tocando ? "pausa" : "play"); }

  // ── Comandos (menus, atalhos e botões chamam estes) ─────────────────

  const C = (A.comandos = {});
  /** A Origem está ativa (foi o último monitor em que se mexeu) e tem mídia? I, O, Espaço, J/K/L vão para ela. */
  const naOrigem = () => A.monitorAtivo === "origem" && V.Paineis.origemTemMidia();
  C.entrada = (programa) => {
    if (!programa && naOrigem() && V.Paineis.marcarOrigem("entrada")) return;
    A.marcar("Marcar entrada"); A.projeto.entrada = A.arredondar(A.cursor);
    if (A.projeto.saida !== null && A.projeto.saida <= A.projeto.entrada) A.projeto.saida = null;
    A.mudou({ leve: true });
  };
  C.saida = (programa) => {
    if (!programa && naOrigem() && V.Paineis.marcarOrigem("saida")) return;
    A.marcar("Marcar saída"); A.projeto.saida = A.arredondar(A.cursor);
    if (A.projeto.entrada !== null && A.projeto.entrada >= A.projeto.saida) A.projeto.entrada = null;
    A.mudou({ leve: true });
  };
  C.marcarClipe = () => {
    const c = A.escolhidos()[0] || A.projeto.clipes.find((x) => A.trilhasAlvo().includes(x.trilha) && A.cursor >= x.inicio && A.cursor < V.fim(x));
    if (!c) return;
    A.marcar("Marcar clipe"); A.projeto.entrada = c.inicio; A.projeto.saida = V.fim(c); A.mudou({ leve: true });
  };
  C.limparMarcas = () => { if (naOrigem() && V.Paineis.limparMarcasOrigem()) return; A.marcar("Limpar entrada e saída"); A.projeto.entrada = A.projeto.saida = null; A.mudou({ leve: true }); };
  function trecho() {
    const p = A.projeto;
    if (p.entrada === null && p.saida === null) { LNUX.aviso("Marque a entrada (I) e a saída (O) na sequência primeiro."); return null; }
    return [p.entrada ?? 0, p.saida ?? A.duracao()];
  }
  C.levantar = () => { const t = trecho(); if (!t) return; A.marcar("Levantar"); V.levantar(A.projeto, A.trilhasAlvo(), t[0], t[1]); A.mudou(); };
  C.extrair = () => { const t = trecho(); if (!t) return; A.marcar("Extrair"); V.extrair(A.projeto, A.trilhasAlvo(), t[0], t[1]); A.projeto.saida = null; A.irPara(t[0]); A.mudou(); };
  C.marcador = () => {
    const existente = A.projeto.marcadores.find((m) => Math.abs(m.tempo - A.cursor) < A.quadro() / 2);
    if (existente) { V.Paineis.editarMarcador(existente); return; }
    A.marcar("Marcador");
    A.projeto.marcadores.push({ id: V.novoId("mk"), tempo: A.arredondar(A.cursor), duracao: 0, nome: "", comentario: "", cor: "verde" });
    A.mudou({ leve: true });
  };
  C.marcadorVizinho = (sentido) => {
    const ts = A.projeto.marcadores.map((m) => m.tempo).sort((a, b) => a - b);
    const t = sentido > 0 ? ts.find((x) => x > A.cursor + 1e-4) : ts.reverse().find((x) => x < A.cursor - 1e-4);
    if (t !== undefined) A.irPara(t);
  };
  C.corteVizinho = (sentido, todas) => {
    const pts = V.pontosDeCorte(A.projeto, todas ? null : A.trilhasAlvo());
    const t = sentido > 0 ? pts.find((x) => x > A.cursor + 1e-4) : pts.reverse().find((x) => x < A.cursor - 1e-4);
    if (t !== undefined) A.irPara(t);
  };
  C.adicionarCorte = (todas) => {
    const trilhas = todas ? A.projeto.trilhas.filter((t) => !t.travada).map((t) => t.id) : (A.selecao.size ? [...new Set(A.escolhidos().map((c) => c.trilha))] : A.trilhasAlvo());
    A.marcar("Adicionar corte");
    const novos = V.adicionarCorte(A.projeto, trilhas, A.arredondar(A.cursor));
    if (!novos.length) LNUX.aviso("O cursor não está em cima de nenhum clipe das trilhas marcadas.");
    A.mudou();
  };
  C.apagar = (ondular) => {
    if (A.transicaoEscolhida) {
      A.marcar("Apagar transição");
      A.projeto.transicoes = A.projeto.transicoes.filter((t) => t.id !== A.transicaoEscolhida);
      A.transicaoEscolhida = null;
      A.mudou();
      return;
    }
    if (!A.selecao.size) {
      // sem clipe escolhido: Shift+Del fecha o espaço vazio sob o cursor (na trilha ativa)
      if (ondular && V.buracoEm(A.projeto, A.trilhaAtiva, A.cursor)) { A.marcar("Fechar buraco"); V.fecharBuraco(A.projeto, A.trilhaAtiva, A.cursor); A.mudou(); }
      return;
    }
    A.marcar(ondular ? "Apagar com ondulação" : "Apagar");
    const ids = new Set([...A.selecao].filter((id) => { const c = A.clipe(id); return c && !A.trilha(c.trilha).travada; }));
    if (ondular) V.apagarComOndulacao(A.projeto, ids);
    else for (const id of ids) V.removerClipe(A.projeto, id);
    A.selecao.clear();
    A.mudou();
  };
  C.copiar = (recortar) => {
    const lista = A.escolhidos();
    if (!lista.length) return;
    const ini = Math.min(...lista.map((c) => c.inicio));
    A.copiados = lista.map((c) => ({ ...JSON.parse(JSON.stringify(c)), inicio: c.inicio - ini }));
    if (recortar) { A.marcar("Recortar"); for (const c of lista) V.removerClipe(A.projeto, c.id); A.selecao.clear(); A.mudou(); }
    else LNUX.aviso(`${lista.length} clipe(s) copiado(s).`);
  };
  C.colar = (inserindo) => {
    if (!A.copiados || !A.copiados.length) return;
    A.marcar(inserindo ? "Colar inserindo" : "Colar");
    const mapa = new Map();
    const novos = A.copiados.filter((c) => A.trilha(c.trilha)).map((c) => {
      const n = JSON.parse(JSON.stringify(c));
      n.id = V.novoId("c");
      if (n.vinculo) { if (!mapa.has(n.vinculo)) mapa.set(n.vinculo, V.novoId("v")); n.vinculo = mapa.get(n.vinculo); }
      for (const f of n.efeitos) { const velho = f.uid; f.uid = Math.random().toString(36).slice(2, 9); for (const k of Object.keys(n.anim)) if (k.startsWith(`fx.${velho}.`)) { n.anim[k.replace(velho, f.uid)] = n.anim[k]; delete n.anim[k]; } }
      return n;
    });
    if (inserindo) V.inserir(A.projeto, novos, A.arredondar(A.cursor)); else V.sobrescrever(A.projeto, novos, A.arredondar(A.cursor));
    A.selecao = new Set(novos.map((c) => c.id));
    A.mudou();
  };
  C.colarAtributos = () => {
    const fonteC = A.copiados && A.copiados[0];
    if (!fonteC || !A.selecao.size) { LNUX.aviso("Copie um clipe (Ctrl+C) e escolha os clipes que vão receber os atributos."); return; }
    A.marcar("Colar atributos");
    for (const c of A.escolhidos()) {
      if (A.trilha(c.trilha).tipo !== (A.trilha(fonteC.trilha) || {}).tipo) continue;
      for (const k of ["mov", "opac", "rec", "audio"]) c[k] = JSON.parse(JSON.stringify(fonteC[k]));
      const anim = {};
      for (const [k, ch] of Object.entries(fonteC.anim || {})) if (!k.startsWith("fx.")) anim[k] = JSON.parse(JSON.stringify(ch));
      for (const f of fonteC.efeitos) {
        const n = JSON.parse(JSON.stringify(f));
        n.uid = Math.random().toString(36).slice(2, 9);
        for (const [k, ch] of Object.entries(fonteC.anim || {})) if (k.startsWith(`fx.${f.uid}.`)) anim[k.replace(f.uid, n.uid)] = JSON.parse(JSON.stringify(ch));
        c.efeitos.push(n);
      }
      c.anim = Object.assign(c.anim || {}, anim);
    }
    A.mudou();
  };
  C.duplicar = () => { if (!A.selecao.size) return; C.copiar(false); const fim = Math.max(...A.escolhidos().map(V.fim)); A.irPara(fim); C.colar(false); };
  C.ativar = () => { if (!A.selecao.size) return; A.marcar("Ativar/desativar"); const ligar = A.escolhidos().some((c) => c.ativo === false); for (const c of A.escolhidos()) c.ativo = ligar; A.mudou(); };
  C.vincular = () => {
    const lista = A.escolhidos();
    if (!lista.length) return;
    A.marcar("Vincular/desvincular");
    if (lista.some((c) => c.vinculo)) for (const c of lista) delete c.vinculo;
    else { const v = V.novoId("v"); for (const c of lista) c.vinculo = v; }
    A.mudou();
  };
  C.ajustarQuadro = (preencher) => {
    A.marcar(preencher ? "Preencher o quadro" : "Ajustar ao quadro");
    for (const c of A.escolhidos()) {
      const m = c.tipo === "midia" && A.midia(c.midia);
      if (!m || !m.largura) continue;
      const a = A.projeto.largura / m.largura, b = A.projeto.altura / m.altura;
      c.mov.escala = Math.round((preencher ? Math.max(a, b) : Math.min(a, b)) * 1000) / 10;
      c.mov.posX = A.projeto.largura / 2; c.mov.posY = A.projeto.altura / 2;
      delete c.anim["mov.escala"]; delete c.anim["mov.posX"]; delete c.anim["mov.posY"];
    }
    A.mudou();
  };
  C.velocidade = async () => {
    const c = A.escolhidos().find((x) => x.tipo === "midia");
    if (!c) { LNUX.aviso("Escolha um clipe de vídeo ou áudio."); return; }
    const pct = el("input", { class: "lnux-entrada", type: "number", min: 5, max: 2000, step: 1, value: Math.round((c.velocidade || 1) * 100) });
    const ond = el("input", { type: "checkbox", checked: true });
    const ok = await LNUX.dialogo({ titulo: "Velocidade / duração", corpo: el("div", { style: { display: "grid", gap: "10px" } },
      el("label", { class: "lnux-campo" }, el("span", {}, "Velocidade (%)"), pct), el("label", { class: "lnux-alternar" }, ond, "Edição em cascata: os clipes seguintes acompanham"),
      el("p", { class: "fraco", style: { margin: 0 } }, "Acima de 100% fica mais rápido (e mais curto). O áudio acompanha a velocidade.")),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "OK", primario: true, valor: true }] });
    if (!ok) return;
    A.marcar("Velocidade");
    const v = limitar(+pct.value / 100, 0.05, 20);
    for (const x of [c, ...(A.vinculada ? V.parceiros(A.projeto, c) : [])]) V.mudarVelocidade(A.projeto, x, v, ond.checked);
    A.mudou();
  };
  C.congelar = async () => {
    const c = A.projeto.clipes.find((x) => x.tipo === "midia" && A.trilha(x.trilha).tipo === "video" && A.cursor >= x.inicio && A.cursor < V.fim(x) && A.midia(x.midia).tipo === "video");
    if (!c) { LNUX.aviso("Ponha o cursor em cima de um clipe de vídeo."); return; }
    await sincronizar(A.cursor, false);
    const f = fonte(c);
    if (!f) return;
    const cv = document.createElement("canvas"); cv.width = f.w; cv.height = f.h;
    cv.getContext("2d").drawImage(f.el, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const [id] = await A.importar([{ nome: `${c.nome || "quadro"} (quadro ${A.tempo(A.cursor).replace(/:/g, "-")}).png`, tipo: "image/png", tamanho: blob.size, origem: "navegador", blob: async () => blob }]);
    if (!id) return;
    A.marcar("Congelar quadro");
    const novo = A.clipeBase({ trilha: c.trilha, tipo: "midia", midia: id, duracao: 2, nome: "Quadro congelado", mov: JSON.parse(JSON.stringify(c.mov)), efeitos: JSON.parse(JSON.stringify(c.efeitos.filter((x) => !x.audio))) });
    novo.inicio = 0;
    V.inserir(A.projeto, [novo], A.arredondar(A.cursor));
    A.mudou();
  };
  C.selecionarNoCursor = () => {
    const c = A.projeto.clipes.filter((x) => A.trilhasAlvo().includes(x.trilha) && A.cursor >= x.inicio && A.cursor < V.fim(x));
    A.selecao = V.comVinculados(A.projeto, new Set(c.map((x) => x.id)), A.vinculada);
    A.mudou({ leve: true });
  };
  C.empurrar = (quadros) => {
    if (!A.selecao.size) return;
    A.marcar("Empurrar clipes");
    const d = quadros * A.quadro();
    for (const c of A.escolhidos()) if (!A.trilha(c.trilha).travada) c.inicio = Math.max(0, A.arredondar(c.inicio + d));
    A.mudou();
  };
  C.volumeClipe = (db) => {
    const lista = A.escolhidos().filter((c) => A.trilha(c.trilha).tipo === "audio");
    if (!lista.length) return;
    A.marcar("Volume do clipe");
    for (const c of lista) A.definirValor(c, "audio.nivel", limitar((V.valor(c, "audio.nivel", A.cursor - c.inicio) || 0) + db, -96, 15));
    A.mudou({ leve: true });
  };
  C.apagarTrilhasVazias = () => {
    const p = A.projeto;
    const vazia = (t) => !p.clipes.some((c) => c.trilha === t.id);
    A.marcar("Apagar trilhas vazias");
    for (const tipo of ["video", "audio"]) {
      const doTipo = p.trilhas.filter((t) => t.tipo === tipo);
      const ficam = doTipo.filter((t) => !vazia(t));
      const manter = ficam.length ? ficam : [doTipo[doTipo.length - 1]];
      p.trilhas = p.trilhas.filter((t) => t.tipo !== tipo || manter.includes(t));
      if (!p.trilhas.some((t) => t.tipo === tipo && t.origem)) { const t = p.trilhas.find((x) => x.tipo === tipo && !x.legendas); if (t) t.origem = true; }
    }
    if (!A.trilha(A.trilhaAtiva)) A.trilhaAtiva = p.trilhas[0].id;
    A.mudou();
  };
  C.adicionarTrilha = (tipo) => {
    A.marcar("Nova trilha");
    const n = A.projeto.trilhas.filter((t) => t.tipo === tipo && !t.legendas).length + 1;
    const prefixo = tipo === "video" ? "V" : "A";
    let id = prefixo + n;
    while (A.trilha(id)) id = prefixo + Math.floor(Math.random() * 900 + 100);
    const t = { id, tipo, nome: (tipo === "video" ? "Vídeo " : "Áudio ") + n, alvo: true, volume: 0, pan: 0 };
    if (tipo === "video") A.projeto.trilhas.splice(A.projeto.trilhas.findIndex((x) => x.tipo === "video" && !x.legendas), 0, t);
    else A.projeto.trilhas.push(t);
    A.mudou();
  };

  // ── Guardar no navegador, versões e projetos .lnuxvideo ─────────────

  let ultimaVersao = 0;
  const guardarDepois = LNUX.adiar(async () => {
    try {
      const json = JSON.stringify(A.projeto);
      await LNUX.guardado.gravar("video2:projeto", json);
      for (const [id, b] of A.arquivos) if (!A.guardados.has(id) && A.projeto.midias[id]) {
        try { await LNUX.guardado.gravar("video:midia:" + id, b); } catch (e) { LNUX.aviso(`Não deu para guardar "${A.projeto.midias[id].nome}" no navegador (pouco espaço?). Salve o projeto num arquivo.`, "alerta"); }
        A.guardados.add(id);
      }
      // versões automáticas: no máximo uma a cada 3 minutos, guardando as 10 últimas
      if (Date.now() - ultimaVersao > 180000) {
        ultimaVersao = Date.now();
        const versoes = (await LNUX.guardado.ler("video2:versoes")) || [];
        versoes.unshift({ data: Date.now(), nome: A.projeto.nome, json });
        await LNUX.guardado.gravar("video2:versoes", versoes.slice(0, 10));
      }
    } catch (e) { console.warn(e); }
  }, 900);

  /** Projeto da versão 1 do app (antes dos efeitos) → versão 2. */
  function migrar(d) {
    if (d.versao === 2) {
      // completa campos que versões novas acrescentaram
      d.pastas = d.pastas || []; d.transicoes = d.transicoes || []; d.marcadores = d.marcadores || [];
      if (d.entrada === undefined) d.entrada = null;
      if (d.saida === undefined) d.saida = null;
      return d;
    }
    const p = Object.assign(novoProjeto(), { nome: d.nome || "Projeto", largura: d.largura || 1920, altura: d.altura || 1080, fps: d.fps || 30, fundo: d.fundo || "#000000", midias: d.midias || {},
      marcadores: (d.marcadores || []).map((m) => ({ id: V.novoId("mk"), tempo: m.tempo, duracao: 0, nome: m.nome || "", comentario: "", cor: "verde" })) });
    if (d.trilhas && d.trilhas.length) {
      p.trilhas = d.trilhas.map((t) => ({ id: t.id, tipo: t.tipo, nome: t.nome, alvo: true, origem: false, mudo: !!t.mudo, oculta: !!t.oculta, volume: 0, pan: 0 }));
      if (!p.trilhas.some((t) => t.tipo === "video")) p.trilhas.unshift({ id: "V1", tipo: "video", nome: "Vídeo 1", alvo: true });
      if (!p.trilhas.some((t) => t.tipo === "audio")) p.trilhas.push({ id: "A1", tipo: "audio", nome: "Áudio 1", alvo: true, volume: 0, pan: 0 });
      // origem: a trilha de vídeo de baixo (como a V1) e a primeira de áudio
      [...p.trilhas].reverse().find((t) => t.tipo === "video").origem = true;
      p.trilhas.find((t) => t.tipo === "audio").origem = true;
    }
    p.clipes = (d.clipes || []).map((c) => {
      const m = d.midias && d.midias[c.midia];
      const ajuste = m && m.largura ? Math.min(p.largura / m.largura, p.altura / m.altura) : 1;
      const n = A.clipeBase({ id: c.id, trilha: c.trilha, tipo: c.tipo === "texto" ? "texto" : "midia", midia: c.midia, inicio: c.inicio, entrada: c.entrada || 0, duracao: c.duracao, velocidade: c.velocidade || 1, nome: c.nome || "" });
      n.mov.posX = p.largura / 2; n.mov.posY = p.altura / 2;
      if (c.mov) Object.assign(n.mov, { posX: p.largura / 2 + (c.mov.x || 0) * p.largura, posY: p.altura / 2 + (c.mov.y || 0) * p.altura, escala: Math.round((c.mov.escala ?? 1) * (c.tipo === "texto" ? 1 : ajuste) * 1000) / 10, rotacao: c.mov.rotacao || 0 });
      else if (c.tipo !== "texto") n.mov.escala = Math.round(ajuste * 1000) / 10;
      if (c.mov && c.mov.opacidade !== undefined) n.opac.valor = c.mov.opacidade * 100;
      if (c.texto) n.texto = Object.assign({ fundo: { ligado: false, cor: "#000000", opacidade: 0.6 } }, c.texto);
      n.audio.nivel = c.volume !== undefined && c.volume !== 1 ? Math.round(20 * Math.log10(Math.max(0.001, c.volume)) * 10) / 10 : 0;
      n.mudo = !!c.mudo;
      if (c.cor && Object.values(c.cor).some((x) => x)) {
        const fx = V.novoEfeito("cor");
        Object.assign(fx.params, { contraste: (c.cor.contraste || 0) * 100, saturacao: 100 + (c.cor.saturacao || 0) * 100, temperatura: (c.cor.temperatura || 0) * 100, exposicao: (c.cor.brilho || 0) * 1.5, vinheta: -(c.cor.vinheta || 0) * 100 });
        n.efeitos.push(fx);
      }
      const tipoTr = (t) => ({ deslizar: "deslizar", cortina: "limpar", zoom: "zoom", preto: "preto", branco: "branco" }[t] || "dissolver");
      if (c.entradaTr && c.entradaTr.tipo && c.entradaTr.tipo !== "nenhuma") p.transicoes.push({ id: V.novoId("t"), trilha: c.trilha, a: null, b: c.id, tipo: tipoTr(c.entradaTr.tipo), duracao: c.entradaTr.duracao || 1, direcao: 0 });
      if (c.saidaTr && c.saidaTr.tipo && c.saidaTr.tipo !== "nenhuma") p.transicoes.push({ id: V.novoId("t"), trilha: c.trilha, a: c.id, b: null, tipo: tipoTr(c.saidaTr.tipo), duracao: c.saidaTr.duracao || 1, direcao: 0 });
      return n;
    });
    return p;
  }

  async function carregar(dados, buscarBlob) {
    for (const id of [...elementos.keys()]) descartar(id);
    for (const u of A.urls.values()) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    A.arquivos.clear(); A.urls.clear(); A.miniaturas.clear(); A.picos.clear(); buffersAudio.clear(); A.guardados.clear();
    A.projeto = migrar(dados);
    for (const [id, m] of Object.entries(A.projeto.midias)) {
      if (!m.caminho) { const b = await buscarBlob(id, m); if (b) A.arquivos.set(id, b); }
      delete m.arquivo;
      A.registrarUrl(id);
    }
    A.selecao.clear(); A.cursor = 0; A.transicaoEscolhida = null; A.midiaEscolhida = null;
    A.trilhaAtiva = (A.projeto.trilhas.find((t) => t.origem) || A.projeto.trilhas[0]).id;
  }

  async function restaurar() {
    let salvo = await LNUX.guardado.ler("video2:projeto");
    if (!salvo) salvo = await LNUX.guardado.ler("video:projeto"); // projeto da versão anterior do app
    if (!salvo) return false;
    try {
      await carregar(typeof salvo === "string" ? JSON.parse(salvo) : salvo, async (id) => { const b = await LNUX.guardado.ler("video:midia:" + id); if (b) A.guardados.add(id); return b; });
      return true;
    } catch (e) { console.warn(e); return false; }
  }

  async function novo() {
    if (A.projeto.clipes.length && !(await LNUX.confirmar("Novo projeto", "Começar um projeto novo? O atual sai da tela (salve antes se quiser guardar; as versões automáticas ficam em Arquivo › Versões).", { rotulo: "Começar do zero" }))) return;
    A.pausar();
    await carregar(novoProjeto(), async () => null);
    for (const k of await LNUX.guardado.chaves("video:midia:")) await LNUX.guardado.apagar(k);
    A.caminhoProjeto = null;
    A.hist.limpar();
    A.mudou();
  }

  async function gerarPacote() {
    const zip = new LNUX.Zip();
    const copia = JSON.parse(JSON.stringify(A.projeto));
    for (const [id, m] of Object.entries(copia.midias)) {
      if (A.arquivos.has(id)) { m.arquivo = `midias/${id}.${LNUX.extensao(m.nome) || "bin"}`; zip.adicionar(m.arquivo, A.arquivos.get(id)); }
    }
    copia.app = "lnux-video";
    zip.adicionar("projeto.json", JSON.stringify(copia, null, 2));
    return zip.gerar();
  }
  A.gerarPacote = gerarPacote;
  async function salvarProjeto(como) {
    const p = LNUX.progresso("Salvando o projeto");
    try {
      const blob = await gerarPacote();
      p.fechar();
      const r = await LNUX.arquivos.salvar(blob, (A.projeto.nome || "projeto").replace(/[\\/:*?"<>|]+/g, "_") + ".lnuxvideo", { titulo: "Salvar projeto", caminho: como ? null : A.caminhoProjeto });
      if (r && r !== "baixado") A.caminhoProjeto = r;
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
      A.pausar();
      for (const k of await LNUX.guardado.chaves("video:midia:")) await LNUX.guardado.apagar(k);
      await carregar(dados, async (id, m) => (m.arquivo ? conteudo.get(m.arquivo) : null));
      A.caminhoProjeto = arq.caminho && arq.caminho.endsWith(".lnuxvideo") ? arq.caminho : null;
      A.hist.limpar();
      A.mudou();
      V.Linha.verTudo();
      const faltando = Object.keys(A.projeto.midias).filter((id) => !A.urls.get(id)).length;
      LNUX.aviso(faltando ? `Projeto aberto, mas ${faltando} mídia(s) estão faltando (estavam nas pastas de outro aparelho). Botão direito na mídia › Encontrar o arquivo.` : "Projeto aberto.", faltando ? "alerta" : "ok");
    } catch (e) { LNUX.erro(e); }
  }
  async function versoes() {
    const lista = (await LNUX.guardado.ler("video2:versoes")) || [];
    if (!lista.length) { LNUX.aviso("Ainda não há versões automáticas (uma é guardada a cada 3 minutos de trabalho)."); return; }
    const sel = el("select", { class: "lnux-selecao", size: Math.min(10, lista.length) }, ...lista.map((v, i) => el("option", { value: i, selected: i === 0 }, `${new Date(v.data).toLocaleString("pt-BR")} — ${v.nome}`)));
    const ok = await LNUX.dialogo({ titulo: "Versões salvas automaticamente", corpo: el("div", {}, el("p", { class: "fraco", style: { marginTop: 0 } }, "Volta o projeto para uma versão anterior (dá para desfazer)."), sel), botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Voltar para esta", primario: true, valor: true }] });
    if (!ok) return;
    A.marcar("Voltar versão");
    A.projeto = migrar(JSON.parse(lista[+sel.value].json));
    for (const id of Object.keys(A.projeto.midias)) A.registrarUrl(id);
    A.selecao.clear();
    A.mudou();
  }
  async function configuracoes() {
    const p = A.projeto;
    const res = el("select", { class: "lnux-selecao" }, ...[["3840x2160", "3840 × 2160 (4K)"], ["2560x1440", "2560 × 1440 (QHD)"], ["1920x1080", "1920 × 1080 (Full HD)"], ["1280x720", "1280 × 720 (HD)"], ["1080x1920", "1080 × 1920 (vertical: Reels, Shorts, TikTok)"], ["1080x1350", "1080 × 1350 (retrato 4:5)"], ["1080x1080", "1080 × 1080 (quadrado)"], ["854x480", "854 × 480"]]
      .map(([v, n]) => el("option", { value: v, selected: v === `${p.largura}x${p.altura}` }, n)));
    if (![...res.options].some((o) => o.selected)) res.append(el("option", { value: `${p.largura}x${p.altura}`, selected: true }, `${p.largura} × ${p.altura}`));
    const fps = el("select", { class: "lnux-selecao" }, ...[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => el("option", { value: f, selected: f === p.fps }, `${String(f).replace(".", ",")} quadros/s`)));
    const nome = el("input", { class: "lnux-entrada", value: p.nome });
    const fundo = el("input", { class: "lnux-entrada", type: "color", value: p.fundo });
    const ok = await LNUX.dialogo({ titulo: "Configurações da sequência", corpo: el("div", { style: { display: "grid", gap: "10px" } },
      el("label", { class: "lnux-campo" }, el("span", {}, "Nome"), nome), el("label", { class: "lnux-campo" }, el("span", {}, "Tamanho do quadro"), res),
      el("label", { class: "lnux-campo" }, el("span", {}, "Quadros por segundo"), fps), el("label", { class: "lnux-campo" }, el("span", {}, "Cor de fundo"), fundo)),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "OK", primario: true, valor: true }] });
    if (!ok) return;
    A.marcar("Configurações da sequência");
    const [w, h] = res.value.split("x").map(Number);
    if (w !== p.largura || h !== p.altura) {
      const fx = w / p.largura, fy = h / p.altura;
      for (const c of p.clipes) {
        c.mov.posX *= fx; c.mov.posY *= fy;
        for (const k of c.anim["mov.posX"] || []) k.v *= fx;
        for (const k of c.anim["mov.posY"] || []) k.v *= fy;
        if (c.tipo === "midia") { const m = A.midia(c.midia); if (m && m.largura) { const antes = Math.min(p.largura / m.largura, p.altura / m.altura), depois = Math.min(w / m.largura, h / m.altura); c.mov.escala = Math.round((c.mov.escala * depois) / antes * 10) / 10; } }
      }
    }
    Object.assign(p, { nome: nome.value.trim() || p.nome, largura: w, altura: h, fps: +fps.value, fundo: fundo.value });
    A.mudou();
    ajustarTela();
  }
  C.configuracoes = configuracoes;

  // ── Exportar ────────────────────────────────────────────────────────

  async function exportarQuadro() {
    const sel = A.selecao;
    A.selecao = new Set();
    await sincronizar(A.cursor, false);
    exportando = { escala: 1 };
    desenharQuadro(A.cursor);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    exportando = null;
    A.selecao = sel;
    desenharQuadro(A.cursor);
    await LNUX.arquivos.salvar(blob, `${A.projeto.nome || "quadro"} ${A.tempo(A.cursor).replace(/:/g, "-")}.png`, { titulo: "Exportar quadro" });
  }

  /** Loudness integrado (LUFS, EBU R128) de um AudioBuffer, para normalizar a exportação. */
  async function loudnessDe(buffer) {
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const f = ctx.createBufferSource(); f.buffer = buffer;
    const sh = ctx.createBiquadFilter(); sh.type = "highshelf"; sh.frequency.value = 1681.97; sh.gain.value = 4;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 38.14; hp.Q.value = 0.5;
    f.connect(sh).connect(hp).connect(ctx.destination); f.start();
    const k = await ctx.startRendering();
    const n = Math.round(k.sampleRate * 0.4), passo = Math.round(k.sampleRate * 0.1);
    const blocos = [];
    for (let i = 0; i + n <= k.length; i += passo) {
      let e = 0;
      for (let c = 0; c < k.numberOfChannels; c++) { const d = k.getChannelData(c); let s = 0; for (let j = i; j < i + n; j++) s += d[j] * d[j]; e += s / n; }
      blocos.push(e);
    }
    const L = (e) => -0.691 + 10 * Math.log10(Math.max(1e-12, e));
    let b = blocos.filter((e) => L(e) > -70);
    if (!b.length) return -Infinity;
    const rel = L(b.reduce((s, x) => s + x, 0) / b.length) - 10;
    b = b.filter((e) => L(e) > rel);
    return L(b.reduce((s, x) => s + x, 0) / b.length);
  }
  A.loudnessDe = loudnessDe;

  async function audioOffline(de, ate, normalizar) {
    const buffers = new Map();
    for (const c of A.projeto.clipes) if (c.tipo === "midia" && A.trilha(c.trilha).tipo === "audio" && !buffers.has(c.midia)) buffers.set(c.midia, await A.bufferDeAudio(c.midia));
    const buf = await A.audio.renderizarOffline(A.projeto, de, ate, buffers);
    if (normalizar !== null) {
      const atual = await loudnessDe(buf);
      if (isFinite(atual)) {
        const g = Math.pow(10, (normalizar - atual) / 20);
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * g)); }
      }
    }
    return buf;
  }
  A.audioOffline = audioOffline;

  async function exportar() {
    if (!A.projeto.clipes.length) { LNUX.aviso("A linha do tempo está vazia."); return; }
    A.pausar();
    const ff = LNUX.ponte.tem("ffmpeg");
    const formato = el("select", { class: "lnux-selecao" },
      el("option", { value: "mp4", disabled: !ff }, "MP4 (H.264 + AAC)" + (ff ? "" : " — precisa da ponte com ffmpeg")),
      el("option", { value: "webm" }, "WebM (direto do navegador)"),
      el("option", { value: "gif" }, "GIF animado (feito no navegador)"),
      el("option", { value: "png" }, "Sequência de PNG (quadro a quadro, num .zip)"),
      el("option", { value: "wav" }, "Só o áudio: WAV"),
      el("option", { value: "mp3", disabled: !ff }, "Só o áudio: MP3" + (ff ? "" : " — precisa da ponte com ffmpeg")));
    formato.value = ff ? "mp4" : "webm";
    const temMarcas = A.projeto.entrada !== null || A.projeto.saida !== null;
    const trechoSel = el("select", { class: "lnux-selecao" }, el("option", { value: "tudo" }, "A sequência inteira"), el("option", { value: "marcas", disabled: !temMarcas, selected: temMarcas }, "Da entrada até a saída"));
    const tamanho = el("select", { class: "lnux-selecao" }, ...[[1, "Igual à sequência"], [0.5, "Metade"], [0.25, "Um quarto (GIF leve)"]].map(([v, n]) => el("option", { value: v }, `${n} (${Math.round(A.projeto.largura * v)} × ${Math.round(A.projeto.altura * v)})`)));
    const qualidade = el("select", { class: "lnux-selecao" }, el("option", { value: "3000000" }, "Leve"), el("option", { value: "8000000", selected: true }, "Boa"), el("option", { value: "16000000" }, "Alta"));
    const norm = el("select", { class: "lnux-selecao" }, el("option", { value: "" }, "Não mexer no volume"), el("option", { value: "-14" }, "Normalizar para -14 LUFS (YouTube, Spotify)"), el("option", { value: "-16" }, "Normalizar para -16 LUFS (podcast)"), el("option", { value: "-23" }, "Normalizar para -23 LUFS (TV, EBU R128)"));
    const linhaNorm = el("label", { class: "lnux-campo" }, el("span", {}, "Volume (só para áudio)"), norm);
    const atual = () => { linhaNorm.hidden = !["wav", "mp3"].includes(formato.value); };
    formato.addEventListener("change", atual); atual();
    const ok = await LNUX.dialogo({ titulo: "Exportar", corpo: el("div", { style: { display: "grid", gap: "10px" } },
      el("label", { class: "lnux-campo" }, el("span", {}, "Formato"), formato), el("label", { class: "lnux-campo" }, el("span", {}, "Trecho"), trechoSel),
      el("label", { class: "lnux-campo" }, el("span", {}, "Tamanho"), tamanho), el("label", { class: "lnux-campo" }, el("span", {}, "Qualidade (vídeo)"), qualidade), linhaNorm,
      el("p", { class: "fraco", style: { margin: 0 } }, "MP4 e WebM são gravados enquanto tocam (deixe esta aba na frente). GIF, PNG e o áudio são feitos sem tocar.")),
      botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Exportar", primario: true, valor: true }] });
    if (!ok) return;
    const [de, ate] = trechoSel.value === "marcas" ? [A.projeto.entrada ?? 0, A.projeto.saida ?? A.duracao()] : [0, A.duracao()];
    const base = (A.projeto.nome || "video").replace(/[\\/:*?"<>|]+/g, "_");
    const escalaExp = +tamanho.value;
    const sel = A.selecao;
    A.selecao = new Set();
    let p = null;
    try {
      if (formato.value === "wav" || formato.value === "mp3") {
        p = LNUX.progresso("Mixando o áudio");
        const buf = await audioOffline(de, ate, norm.value ? +norm.value : null);
        const wav = V.paraWav(buf);
        if (formato.value === "wav") { p.fechar(); p = null; await LNUX.arquivos.salvar(wav, base + ".wav", { titulo: "Salvar o áudio" }); return; }
        p.definir(0.5, "Convertendo para MP3...");
        const { caminho } = await LNUX.ponte.temporario(wav, base + ".wav");
        const r = await LNUX.ponte.converter({ entrada: caminho, perfil: "mp3" }, (f, t) => p.definir(0.5 + f * 0.45, t));
        const saida = await LNUX.ponte.ler(r.saida, "blob");
        p.fechar(); p = null;
        await LNUX.arquivos.salvar(saida, base + ".mp3", { titulo: "Salvar o áudio" });
        return;
      }
      if (formato.value === "gif" || formato.value === "png") {
        p = LNUX.progresso(formato.value === "gif" ? "Fazendo o GIF" : "Fazendo os PNG", { aoCancelar: () => { p.cancelado = true; } });
        const fps = formato.value === "gif" ? Math.min(15, A.projeto.fps) : A.projeto.fps;
        const total = Math.max(1, Math.round((ate - de) * fps));
        const W = Math.round(A.projeto.largura * escalaExp), H = Math.round(A.projeto.altura * escalaExp);
        const gif = formato.value === "gif" ? new LNUX.Gif(W, H) : null;
        const zip = formato.value === "png" ? new LNUX.Zip() : null;
        const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
        const tctx = tmp.getContext("2d", { willReadFrequently: true });
        exportando = { escala: escalaExp };
        for (let i = 0; i < total; i++) {
          if (p.cancelado) throw new Error("Exportação cancelada.");
          const t = de + i / fps;
          await sincronizar(t, false);
          desenharQuadro(t);
          tctx.drawImage(canvas, 0, 0, W, H);
          if (gif) gif.quadro(tctx.getImageData(0, 0, W, H), Math.round(100 / fps));
          else zip.adicionar(`${base}_${String(i).padStart(6, "0")}.png`, await new Promise((r) => tmp.toBlob(r, "image/png")));
          p.definir((i + 1) / total, `Quadro ${i + 1} de ${total}...`);
        }
        exportando = null;
        const blob = gif ? gif.gerar() : await zip.gerar();
        p.fechar(); p = null;
        await LNUX.arquivos.salvar(blob, gif ? base + ".gif" : base + " (png).zip", { titulo: "Salvar" });
        return;
      }
      // MP4 / WebM: grava o canvas e o mestre do áudio enquanto toca
      if (!window.MediaRecorder || !canvas.captureStream) throw new Error("Este navegador não grava vídeo. Use GIF ou PNG.");
      const tipo = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      A.audio.garantir();
      const fluxo = canvas.captureStream(A.projeto.fps);
      for (const faixa of A.audio.gravacao.stream.getAudioTracks()) fluxo.addTrack(faixa);
      const gravador = new MediaRecorder(fluxo, { mimeType: tipo, videoBitsPerSecond: +qualidade.value, audioBitsPerSecond: 192000 });
      const pedacos = [];
      gravador.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
      const terminou = new Promise((r) => { gravador.onstop = r; });
      p = LNUX.progresso("Gravando o vídeo", { aoCancelar: () => { p.cancelado = true; A.pausar(); if (gravador.state !== "inactive") gravador.stop(); } });
      exportando = { escala: escalaExp, de, ate, progresso: (f) => p.definir(f * (formato.value === "mp4" ? 0.7 : 1), `Gravando... ${Math.round(f * 100)}%`), terminar: () => gravador.state !== "inactive" && gravador.stop() };
      A.cursor = de;
      await sincronizar(de, false);
      desenharQuadro(de);
      gravador.start(500);
      A.tocar(1);
      await terminou;
      exportando = null;
      fluxo.getVideoTracks().forEach((t) => t.stop());
      if (p.cancelado) throw new Error("Exportação cancelada.");
      const webm = new Blob(pedacos, { type: tipo.split(";")[0] });
      if (formato.value === "webm") { p.fechar(); p = null; await LNUX.arquivos.salvar(webm, base + (tipo.includes("mp4") ? ".mp4" : ".webm"), { titulo: "Salvar o vídeo" }); return; }
      p.definir(0.72, "Enviando para a ponte...");
      const { caminho } = await LNUX.ponte.temporario(webm, base + ".webm");
      const r = await LNUX.ponte.converter({ entrada: caminho, perfil: "mp4", opcoes: { crf: 20 } }, (f, t) => p.definir(0.72 + f * 0.25, t));
      const saida = await LNUX.ponte.ler(r.saida, "blob");
      p.fechar(); p = null;
      await LNUX.arquivos.salvar(saida, base + ".mp4", { titulo: "Salvar o vídeo" });
    } catch (e) {
      if (p) p.fechar();
      LNUX.aviso(e.message, e.message.includes("cancelada") ? "info" : "erro");
    } finally {
      exportando = null;
      A.selecao = sel;
      A.atualizarQuadro();
    }
  }
  A.exportar = exportar;

  // ── Mudanças ────────────────────────────────────────────────────────

  /** Depois de qualquer mudança no projeto. leve = só redesenhar (não arruma as transições). */
  A.mudou = function ({ leve = false } = {}) {
    if (!leve) V.limparTransicoes(A.projeto);
    $("#titulo-doc").textContent = A.projeto.nome;
    V.Linha && V.Linha.desenhar(leve);
    V.Controles && V.Controles.desenhar(leve);
    V.Paineis && V.Paineis.desenhar(leve);
    mostrarTempo();
    A.atualizarQuadro();
    guardarDepois();
  };

  // ── Espaços de trabalho e menus ─────────────────────────────────────

  const ESPACOS = [
    { id: "edicao", nome: "Edição", abas: { esq: "controles", dir: "propriedades", proj: "projeto" } },
    { id: "montagem", nome: "Montagem", abas: { esq: "origem", proj: "projeto" } },
    { id: "cor", nome: "Cor", abas: { esq: "controles", dir: "cor", proj: "projeto" } },
    { id: "efeitos", nome: "Efeitos", abas: { esq: "controles", dir: "propriedades", proj: "efeitos" } },
    { id: "audio", nome: "Áudio", abas: { esq: "mixer", dir: "propriedades", proj: "efeitos" } },
    { id: "legendas", nome: "Legendas e gráficos", abas: { esq: "controles", dir: "texto", proj: "projeto" } },
    { id: "celular", nome: "Celular", abas: {}, celular: true },
  ];
  const espacos = $("#espacos");
  for (const e of ESPACOS.filter((x) => !x.celular)) espacos.append(el("button", { type: "button", "data-espaco": e.id, onclick: () => LNUX.layout.definir(e.id) }, e.nome));
  function aoMudarEspaco(id) {
    document.documentElement.dataset.espaco = id;
    const e = ESPACOS.find((x) => x.id === id) || ESPACOS[0];
    for (const [painel, aba] of Object.entries(e.abas)) V.Paineis && V.Paineis.abrirAba(painel, aba);
    for (const b of espacos.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.espaco === id));
    if (id === "celular" && !document.documentElement.dataset.movel) document.documentElement.dataset.movel = "linha";
    setTimeout(() => { ajustarTela(); V.Linha && V.Linha.desenhar(true); }, 40);
  }
  for (const b of document.querySelectorAll("#abas-celular button")) {
    b.addEventListener("click", () => {
      document.documentElement.dataset.movel = b.dataset.movel;
      for (const x of document.querySelectorAll("#abas-celular button")) x.setAttribute("aria-selected", String(x === b));
      if (b.dataset.movel === "efeitos") V.Paineis.abrirAba("proj", "efeitos");
      if (b.dataset.movel === "projeto") V.Paineis.abrirAba("proj", "projeto");
      if (b.dataset.movel === "controles") V.Paineis.abrirAba("esq", "controles");
      if (b.dataset.movel === "cor") V.Paineis.abrirAba("dir", "cor");
      setTimeout(() => { V.Linha.desenhar(true); ajustarTela(); }, 30);
    });
  }

  const temSel = () => A.selecao.size > 0;
  const ferramenta = (id) => () => { A.ferramenta = id; V.Linha.atualizarFerramentas(); };
  // Espaço, J/K/L e ←/→ vão para a Origem quando ela é o monitor ativo
  const tocarOuOrigem = () => (naOrigem() ? V.Paineis.tocarOrigem() : A.alternarPlay());
  const jklOuOrigem = (t) => () => (naOrigem() ? V.Paineis.jklOrigem(t) : A.jkl(t));
  const quadroOuOrigem = (n) => () => (naOrigem() ? V.Paineis.quadroOrigem(n) : A.irPara(A.cursor + n * A.quadro()));
  const menus = [
    { rotulo: "Arquivo", itens: [
      { rotulo: "Novo projeto", atalho: "Alt+N", acao: novo },
      { rotulo: "Abrir projeto...", atalho: "Ctrl+O", acao: abrirProjeto },
      { rotulo: "Salvar", atalho: "Ctrl+S", acao: () => salvarProjeto(false) },
      { rotulo: "Salvar como...", atalho: "Ctrl+Shift+S", acao: () => salvarProjeto(true) },
      { rotulo: "Versões salvas automaticamente...", acao: versoes },
      "-",
      { rotulo: "Importar...", atalho: "Ctrl+I", acao: () => A.importarDialogo() },
      { rotulo: "Importar legendas (SRT ou VTT)...", acao: () => V.Paineis.importarLegendas() },
      "-",
      { rotulo: "Exportar mídia...", atalho: ["Ctrl+M", "Ctrl+E"], acao: exportar },
      { rotulo: "Exportar quadro", atalho: "Shift+E", acao: exportarQuadro },
      { rotulo: "Exportar legendas (SRT)...", acao: () => V.Paineis.exportarLegendas("srt") },
      { rotulo: "Exportar legendas (VTT)...", acao: () => V.Paineis.exportarLegendas("vtt") },
      { rotulo: "Exportar marcadores (CSV)...", acao: () => V.Paineis.exportarMarcadores() },
      "-",
      { rotulo: "Configurações da sequência...", acao: configuracoes },
    ] },
    { rotulo: "Editar", itens: [
      { rotulo: "Desfazer", atalho: "Ctrl+Z", acao: () => A.hist.desfazer(), ativo: () => A.hist.podeDesfazer() },
      { rotulo: "Refazer", atalho: ["Ctrl+Shift+Z", "Ctrl+Y"], acao: () => A.hist.refazer(), ativo: () => A.hist.podeRefazer() },
      "-",
      { rotulo: "Recortar", atalho: "Ctrl+X", acao: () => C.copiar(true), ativo: temSel },
      { rotulo: "Copiar", atalho: "Ctrl+C", acao: () => C.copiar(false), ativo: temSel },
      { rotulo: "Colar", atalho: "Ctrl+V", acao: () => C.colar(false) },
      { rotulo: "Colar inserindo", atalho: "Ctrl+Shift+V", acao: () => C.colar(true) },
      { rotulo: "Colar atributos (efeitos, movimento...)", atalho: "Ctrl+Alt+V", acao: C.colarAtributos },
      { rotulo: "Duplicar (logo depois)", acao: C.duplicar, ativo: temSel },
      { rotulo: "Apagar", atalho: ["Del", "Backspace"], acao: () => C.apagar(false) },
      { rotulo: "Apagar com ondulação", atalho: ["Shift+Del", "Shift+Backspace"], acao: () => C.apagar(true) },
      "-",
      { rotulo: "Selecionar tudo", atalho: "Ctrl+A", acao: () => { A.selecao = new Set(A.projeto.clipes.map((c) => c.id)); A.mudou({ leve: true }); } },
      { rotulo: "Tirar a seleção", atalho: "Ctrl+Shift+A", acao: () => { A.selecao.clear(); A.transicaoEscolhida = null; A.mudou({ leve: true }); } },
      { rotulo: "Selecionar o clipe no cursor", atalho: "D", acao: C.selecionarNoCursor },
    ] },
    { rotulo: "Clipe", itens: [
      { rotulo: "Velocidade / duração...", atalho: "Ctrl+R", acao: C.velocidade },
      { rotulo: "Ativar / desativar", atalho: "Ctrl+Shift+E", acao: C.ativar, ativo: temSel },
      { rotulo: "Vincular / desvincular vídeo e áudio", atalho: "Ctrl+L", acao: C.vincular, ativo: temSel },
      { rotulo: "Ajustar ao quadro", acao: () => C.ajustarQuadro(false), ativo: temSel },
      { rotulo: "Preencher o quadro (sem bordas)", acao: () => C.ajustarQuadro(true), ativo: temSel },
      { rotulo: "Congelar o quadro do cursor", acao: C.congelar },
      "-",
      { rotulo: "Novo título", acao: () => A.novoGrafico("texto") },
      { rotulo: "Nova forma", acao: () => A.novoGrafico("forma") },
      { rotulo: "Nova cor sólida", acao: () => A.novoGrafico("cor") },
      { rotulo: "Nova camada de ajuste", acao: () => A.novoGrafico("ajuste") },
      { rotulo: "Nova legenda no cursor", acao: () => V.Paineis.novaLegenda() },
      "-",
      { rotulo: "Aumentar o volume do clipe (1 dB)", atalho: "]", acao: () => C.volumeClipe(1) },
      { rotulo: "Diminuir o volume do clipe (1 dB)", atalho: "[", acao: () => C.volumeClipe(-1) },
    ] },
    { rotulo: "Sequência", itens: [
      { rotulo: "Adicionar corte", atalho: "Ctrl+K", acao: () => C.adicionarCorte(false) },
      { rotulo: "Adicionar corte em todas as trilhas", atalho: "Ctrl+Shift+K", acao: () => C.adicionarCorte(true) },
      { rotulo: "Aplicar a transição de vídeo padrão", atalho: "Ctrl+D", acao: () => A.transicaoPadrao(false) },
      { rotulo: "Aplicar a transição de áudio padrão", atalho: "Ctrl+Shift+D", acao: () => A.transicaoPadrao(true) },
      "-",
      { rotulo: "Levantar", atalho: ";", acao: C.levantar },
      { rotulo: "Extrair", atalho: "'", acao: C.extrair },
      { rotulo: "Inserir a mídia da Origem", atalho: ",", acao: () => V.Paineis.daOrigem("inserir") },
      { rotulo: "Sobrescrever com a mídia da Origem", atalho: ".", acao: () => V.Paineis.daOrigem("sobrescrever") },
      "-",
      { rotulo: "Encaixe", atalho: "S", acao: () => { A.ima = !A.ima; V.Linha.atualizarBotoes(); }, marcado: () => A.ima },
      { rotulo: "Seleção vinculada", acao: () => { A.vinculada = !A.vinculada; V.Linha.atualizarBotoes(); }, marcado: () => A.vinculada },
      "-",
      { rotulo: "Nova trilha de vídeo", acao: () => C.adicionarTrilha("video") },
      { rotulo: "Nova trilha de áudio", acao: () => C.adicionarTrilha("audio") },
      { rotulo: "Apagar as trilhas vazias", acao: C.apagarTrilhasVazias },
      { rotulo: "Configurações da sequência...", acao: configuracoes, semComando: true },
    ] },
    { rotulo: "Marcadores", itens: [
      { rotulo: "Marcar entrada", atalho: "I", acao: () => C.entrada() },
      { rotulo: "Marcar saída", atalho: "O", acao: () => C.saida() },
      { rotulo: "Marcar o clipe", atalho: "X", acao: C.marcarClipe },
      { rotulo: "Limpar entrada e saída", atalho: "Ctrl+Shift+X", acao: C.limparMarcas },
      { rotulo: "Ir para a entrada", atalho: "Shift+I", acao: () => A.irPara(A.projeto.entrada ?? 0) },
      { rotulo: "Ir para a saída", atalho: "Shift+O", acao: () => A.irPara(A.projeto.saida ?? A.duracao()) },
      "-",
      { rotulo: "Adicionar marcador", atalho: "M", acao: C.marcador },
      { rotulo: "Próximo marcador", atalho: "Shift+M", acao: () => C.marcadorVizinho(1) },
      { rotulo: "Marcador anterior", atalho: "Ctrl+Shift+M", acao: () => C.marcadorVizinho(-1) },
      { rotulo: "Apagar todos os marcadores", acao: () => { A.marcar("Apagar marcadores"); A.projeto.marcadores = []; A.mudou({ leve: true }); } },
    ] },
    { rotulo: "Reproduzir", itens: [
      { rotulo: "Tocar / pausar", atalho: "Espaço", acao: tocarOuOrigem },
      { rotulo: "Tocar para trás (mais rápido a cada toque)", atalho: "J", acao: jklOuOrigem("j") },
      { rotulo: "Parar", atalho: "K", acao: jklOuOrigem("k") },
      { rotulo: "Tocar (mais rápido a cada toque)", atalho: "L", acao: jklOuOrigem("l") },
      "-",
      { rotulo: "Quadro anterior", atalho: "←", acao: quadroOuOrigem(-1) },
      { rotulo: "Próximo quadro", atalho: "→", acao: quadroOuOrigem(1) },
      { rotulo: "Voltar 5 quadros", atalho: "Shift+←", acao: quadroOuOrigem(-5) },
      { rotulo: "Avançar 5 quadros", atalho: "Shift+→", acao: quadroOuOrigem(5) },
      { rotulo: "Ponto de edição anterior", atalho: "↑", acao: () => C.corteVizinho(-1, false) },
      { rotulo: "Próximo ponto de edição", atalho: "↓", acao: () => C.corteVizinho(1, false) },
      { rotulo: "Início", atalho: "Home", acao: () => A.irPara(0) },
      { rotulo: "Fim", atalho: "End", acao: () => A.irPara(A.duracao()) },
      "-",
      { rotulo: "Empurrar o clipe 1 quadro para a esquerda", atalho: "Alt+←", acao: () => C.empurrar(-1) },
      { rotulo: "Empurrar o clipe 1 quadro para a direita", atalho: "Alt+→", acao: () => C.empurrar(1) },
      { rotulo: "Empurrar o clipe 5 quadros para a esquerda", atalho: "Alt+Shift+←", acao: () => C.empurrar(-5) },
      { rotulo: "Empurrar o clipe 5 quadros para a direita", atalho: "Alt+Shift+→", acao: () => C.empurrar(5) },
    ] },
    { rotulo: "Ferramentas", itens: [
      { rotulo: "Seleção", atalho: "V", acao: ferramenta("selecao"), marcado: () => A.ferramenta === "selecao" },
      { rotulo: "Selecionar a trilha para a frente", atalho: "A", acao: ferramenta("trilha-frente"), marcado: () => A.ferramenta === "trilha-frente" },
      { rotulo: "Edição em ondulação", atalho: "B", acao: ferramenta("ondulacao"), marcado: () => A.ferramenta === "ondulacao" },
      { rotulo: "Edição rolante", atalho: "N", acao: ferramenta("rolagem"), marcado: () => A.ferramenta === "rolagem" },
      { rotulo: "Esticar a velocidade", atalho: "R", acao: ferramenta("esticar"), marcado: () => A.ferramenta === "esticar" },
      { rotulo: "Navalha (cortar)", atalho: "C", acao: ferramenta("navalha"), marcado: () => A.ferramenta === "navalha" },
      { rotulo: "Deslizar o conteúdo (slip)", atalho: "Y", acao: ferramenta("slip"), marcado: () => A.ferramenta === "slip" },
      { rotulo: "Deslizar o clipe (slide)", atalho: "U", acao: ferramenta("slide"), marcado: () => A.ferramenta === "slide" },
      { rotulo: "Mão", atalho: "H", acao: ferramenta("mao"), marcado: () => A.ferramenta === "mao" },
      { rotulo: "Zoom", atalho: "Z", acao: ferramenta("zoom"), marcado: () => A.ferramenta === "zoom" },
      { rotulo: "Texto", atalho: "T", acao: ferramenta("texto"), marcado: () => A.ferramenta === "texto" },
    ] },
    { rotulo: "Exibir", itens: [
      { rotulo: "Aproximar a linha do tempo", atalho: ["=", "Mais", "Shift+Mais"], acao: () => V.Linha.zoom(1.5) },
      { rotulo: "Afastar a linha do tempo", atalho: "-", acao: () => V.Linha.zoom(1 / 1.5) },
      { rotulo: "Ver a sequência toda", atalho: "\\", acao: () => V.Linha.verTudo() },
      { rotulo: "Guias de área segura", acao: () => { A.guias = !A.guias; desenharSobreposicao(); }, marcado: () => A.guias },
      "-",
      ...ESPACOS.map((e) => ({ rotulo: "Espaço de trabalho: " + e.nome, acao: () => LNUX.layout.definir(e.id), marcado: () => LNUX.layout.atual() === e.id })),
    ] },
    { rotulo: "Ajuda", itens: [
      { rotulo: "Atalhos de teclado", acao: () => LNUX.ajudaAtalhos() },
      { rotulo: "Como editar", acao: ajuda },
      { rotulo: "Sobre o Vídeo", acao: () => LNUX.sobre() },
    ] },
  ];

  function ajuda() {
    LNUX.dialogo({ titulo: "Como usar o Vídeo", largo: true, corpo: el("div", { html: `
      <p><strong>Montar:</strong> importe no painel <em>Projeto</em> (ou arraste arquivos). Dois cliques abrem a mídia na <em>Origem</em>: marque a entrada (I) e a saída (O) e use <b>,</b> para inserir ou <b>.</b> para sobrescrever na linha do tempo, no cursor, nas trilhas de origem (botões V e A no começo do cabeçalho das trilhas). Arrastar do Projeto ou da Origem para a linha do tempo também funciona (com Ctrl, insere).</p>
      <p><strong>Ferramentas</strong> (coluna ao lado da linha do tempo): Seleção (V), Trilha para a frente (A), Ondulação (B), Rolante (N), Esticar velocidade (R), Navalha (C), Slip (Y), Slide (U), Mão (H), Zoom (Z) e Texto (T). <b>Ctrl+K</b> corta no cursor; <b>Shift+Del</b> apaga fechando o buraco; <b>;</b> e <b>'</b> levantam e extraem o trecho entre a entrada e a saída; Alt+arrastar duplica.</p>
      <p><strong>Efeitos:</strong> arraste um efeito do painel <em>Efeitos</em> para um clipe (ou dê dois cliques com o clipe escolhido). Em <em>Controles de efeito</em>, o relógio liga a animação de cada propriedade: mude o cursor e o valor para criar quadros-chave; clique no nome para ver o gráfico de valor e velocidade; botão direito no quadro-chave escolhe a interpolação. Transições vão nos pontos de corte (<b>Ctrl+D</b> põe a padrão).</p>
      <p><strong>No monitor:</strong> com o clipe escolhido, arraste para mover, puxe um canto para redimensionar e a bolinha de cima para girar (Shift: de 15 em 15°). A rodinha do mouse muda a escala.</p>
      <p><strong>Cor:</strong> no espaço <em>Cor</em>, o painel Cor tem correção básica (com Auto), looks, curvas, rodas de cor, HSL secundária (com conta-gotas) e vinheta; os <em>Escopos</em> mostram forma de onda, parade RGB, vetorscópio e histograma.</p>
      <p><strong>Áudio:</strong> o espaço <em>Áudio</em> mostra o mixer (volume, panorama, mudo e solo por trilha); os medidores mostram o pico e o loudness (LUFS). Na exportação de áudio dá para normalizar para -14, -16 ou -23 LUFS. A linha amarela nos clipes de áudio é o volume: arraste para mudar, Ctrl+clique cria um quadro-chave.</p>
      <p><strong>Legendas:</strong> no espaço <em>Legendas e gráficos</em>, o painel Texto cria, edita, importa e exporta legendas (SRT e VTT); <em>Gráficos essenciais</em> tem modelos de título, terço inferior, créditos e letreiro.</p>
      <p><strong>Guardar:</strong> tudo fica guardado neste navegador, com versões automáticas (Arquivo › Versões). <em>Salvar</em> gera um .lnuxvideo com as mídias dentro.</p>` }) });
  }

  // ── Começo ──────────────────────────────────────────────────────────

  $("#marca-icone").innerHTML = icone("video");
  if (!A.render.ok) LNUX.aviso("Este navegador não tem WebGL2: a imagem e os efeitos não aparecem. Use o Chrome, o Edge ou o Firefox atualizados.", "erro", 15000);
  V.Linha.iniciar();
  V.Controles.iniciar();
  V.Paineis.iniciar();
  LNUX.iniciar({
    app: "video", nome: "Vídeo",
    descricao: "Editor de vídeo com linha do tempo, ferramentas de edição (ondulação, rolante, slip, slide, navalha), efeitos com quadros-chave, cor (Lumetri, curvas, rodas, escopos), áudio com mixer e loudness, legendas e exportação.",
    inspirado: { nome: "FilmCraft", url: "https://github.com/storytold/filmcraft", autores: "ArtCraft Team e os colaboradores do FilmCraft" },
    layouts: ESPACOS.map((e) => ({ id: e.id, nome: e.nome, celular: e.celular, icone: e.celular ? "tela" : "layout" })),
    aoMudarLayout: aoMudarEspaco,
    menus,
  }).then(async () => {
    if (await restaurar()) LNUX.aviso("Projeto recuperado de onde você parou.", "ok");
    else for (const id of Object.keys(A.projeto.midias)) A.registrarUrl(id); // a ponte ligou depois: as mídias dela ganham endereço
    A.mudou();
    if (A.projeto.clipes.length) V.Linha.verTudo();
    window.Video.pronto = true;
  });
  A.mudou();

  // Para os testes automáticos e para quem quiser mexer pelo console
  window.Video = {
    get projeto() { return A.projeto; }, app: A, V, pronto: false,
    get cursor() { return A.cursor; }, irPara: (t) => A.irPara(t),
    importar: A.importar, colocarMidia: A.colocarMidia, novoGrafico: A.novoGrafico, aplicarEfeito: A.aplicarEfeito, aplicarTransicao: A.aplicarTransicao,
    gerarPacote, exportar, comandos: C, render: A.render, audio: A.audio, migrar,
  };
})();
