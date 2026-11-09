/*
 * Companhia — palco Live2D: carrega o modelo (Cubism 4, como os exportados pelo VTube Studio), dá vida a ele e
 * reconhece os toques.
 *
 * As emoções são descritas em "sinais" simples (sorriso, abertura dos olhos, sobrancelhas, ângulo da cabeça...).
 * Os sinais viram os parâmetros padrão do Live2D (ParamAngleX, ParamEyeLOpen, ParamMouthForm...) dentro dos
 * limites que o próprio modelo define, então funcionam em qualquer modelo. Se houver um vtube.json, os parâmetros
 * extras que o autor ligou ao rastreamento do VTube Studio (sorriso nos olhos, boca de lado, bochecha inflada...)
 * também acompanham, com as faixas que ele escolheu.
 *
 * Por cima, camadas próprias: piscar, olhar para o ponteiro, gestos (concordar, negar, pular...), a boca
 * acompanhando a voz e as expressões (.exp3.json) — várias ao mesmo tempo, como os atalhos do VTube Studio.
 * A respiração e o balanço parado vêm do próprio pixi-live2d-display; a física (cabelo, roupa) vem do modelo.
 *
 * O núcleo do Live2D (Cubism Core) é da Live2D Inc. e não vem junto: veja C.garantirNucleo().
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const misturar = (a, b, t) => a + (b - a) * t;

  // ── Sinais e emoções ─────────────────────────────────────────────────

  /**
   * Sinais (todos com o rosto relaxado em NEUTRO):
   *   angX/angY/angZ  cabeça em graus (X: vira para a direita da tela; Y: olha para cima; Z: inclina)
   *   olhoX/olhoY     para onde os olhos olham (-1..1)
   *   olhoE/olhoD     abertura de cada olho (0 fechado, 1 normal, até 1.3 arregalado)
   *   olhosRiso       olhos "sorrindo" (0..1)
   *   sorriso         boca (-1 triste/brava, 0 normal, 1 sorriso)
   *   boca            boca aberta (0..1)
   *   sobr            sobrancelhas (-1 franzidas, 0 normal, 1 erguidas)
   *   bochecha        bochechas coradas (0..1)
   *   bocaX, bico, inflar, labios: extras de boca (só nos modelos que têm)
   */
  const NEUTRO = { angX: 0, angY: 0, angZ: 0, olhoX: 0, olhoY: 0, olhoE: 1, olhoD: 1, olhosRiso: 0, sorriso: 0.15, boca: 0,
    sobr: 0, bochecha: 0, bocaX: 0, bico: 0, inflar: 0, labios: 0 };

  /** Parâmetros padrão do Live2D: [id, sinal, tipo, fator]. tipo: abs (valor direto), bip (-1..1 em volta do padrão), uni (0..1 do mínimo ao máximo), olho. */
  const PADRAO = [
    ["ParamAngleX", "angX", "abs", 1], ["ParamAngleY", "angY", "abs", 1], ["ParamAngleZ", "angZ", "abs", 1],
    ["ParamBodyAngleX", "angX", "abs", 1 / 3], ["ParamBodyAngleY", "angY", "abs", 1 / 3], ["ParamBodyAngleZ", "angZ", "abs", 1 / 3],
    ["ParamEyeBallX", "olhoX", "bip"], ["ParamEyeBallY", "olhoY", "bip"],
    ["ParamEyeLOpen", "olhoE", "olho"], ["ParamEyeROpen", "olhoD", "olho"],
    ["ParamEyeLSmile", "olhosRiso", "uni"], ["ParamEyeRSmile", "olhosRiso", "uni"],
    ["ParamMouthForm", "sorriso", "bip"], ["ParamMouthOpenY", "boca", "uni"],
    ["ParamBrowLY", "sobr", "bip"], ["ParamBrowRY", "sobr", "bip"], ["ParamBrowLForm", "sobr", "bip"], ["ParamBrowRForm", "sobr", "bip"],
    ["ParamCheek", "bochecha", "uni"],
  ];
  const IDS_PADRAO = new Set(PADRAO.map((p) => p[0]));
  /** Entradas do rastreamento do VTube Studio, calculadas a partir dos sinais (para os parâmetros extras do vtube.json). */
  const ENTRADAS_VTS = {
    MouthSmile: (s) => (s.sorriso + 1) / 2, MouthOpen: (s) => s.boca, JawOpen: (s) => s.boca * 0.8, MouthX: (s) => s.bocaX,
    Brows: (s) => (s.sobr + 1) / 2, BrowLeftY: (s) => (s.sobr + 1) / 2, BrowRightY: (s) => (s.sobr + 1) / 2,
    EyeOpenLeft: (s) => Math.min(1, s.olhoE), EyeOpenRight: (s) => Math.min(1, s.olhoD),
    EyeRightX: (s) => s.olhoX, EyeRightY: (s) => s.olhoY, EyeLeftX: (s) => s.olhoX, EyeLeftY: (s) => s.olhoY,
    FaceAngleX: (s) => s.angX, FaceAngleY: (s) => s.angY, FaceAngleZ: (s) => s.angZ,
    CheekPuff: (s) => s.inflar, MouthPucker: (s) => s.bico, MouthFunnel: (s) => s.bico * 0.5, MouthPressLipOpen: (s) => s.labios, MouthShrug: () => 0,
  };

  /**
   * As emoções: sinais (os que faltam ficam em NEUTRO; "olhos" vale para os dois), postura do corpo e o movimento
   * que fica rodando enquanto ela dura. As expressões de cada emoção são escolhidas por personagem.
   */
  const EMOCOES = {
    neutra: { nome: "Neutra", sinais: {} },
    feliz: { nome: "Feliz", sinais: { sorriso: 1, olhosRiso: 0.6, sobr: 0.35, olhos: 0.92, angZ: 4, bochecha: 0.25 } },
    rindo: { nome: "Rindo", sinais: { sorriso: 1, boca: 0.55, olhosRiso: 1, olhos: 0.3, sobr: 0.5, angY: 6, bochecha: 0.35 }, mexer: "rir" },
    timida: { nome: "Tímida", sinais: { sorriso: 0.45, sobr: 0.25, olhos: 0.6, angY: -9, angX: 12, olhoX: -0.6, olhoY: -0.4, bochecha: 1 } },
    triste: { nome: "Triste", sinais: { sorriso: -0.8, sobr: 0.6, olhos: 0.65, angY: -12, olhoY: -0.5 }, postura: "cair" },
    chorando: { nome: "Chorando", sinais: { sorriso: -1, boca: 0.25, sobr: 0.8, olhos: 0.35, angY: -14, bochecha: 0.4 }, postura: "cair", mexer: "solucar" },
    brava: { nome: "Brava", sinais: { sorriso: -0.9, sobr: -1, olhos: 1.05, angY: -6, labios: 0.6, inflar: 0.4, bochecha: 0.2 } },
    surpresa: { nome: "Surpresa", sinais: { sorriso: 0, boca: 0.7, sobr: 1, olhos: 1.3, angY: 6 }, postura: "subir" },
    assustada: { nome: "Assustada", sinais: { sorriso: -0.5, boca: 0.45, sobr: 0.9, olhos: 1.3, angY: -4 }, mexer: "tremer" },
    pensativa: { nome: "Pensativa", sinais: { sorriso: -0.1, sobr: 0.3, olhos: 0.8, angZ: -10, angX: -12, olhoX: 0.5, olhoY: 0.7, bocaX: 0.4 } },
    apaixonada: { nome: "Apaixonada", sinais: { sorriso: 1, olhosRiso: 0.5, sobr: 0.4, olhos: 0.7, angZ: 7, bochecha: 1 }, mexer: "balancar" },
    animada: { nome: "Animada", sinais: { sorriso: 1, boca: 0.35, sobr: 0.7, olhos: 1.2, bochecha: 0.3 }, mexer: "pular" },
    sonolenta: { nome: "Sonolenta", sinais: { sorriso: 0, sobr: -0.1, olhos: 0.3, angY: -8, angZ: 6 }, mexer: "cochilar" },
    provocadora: { nome: "Provocadora", sinais: { sorriso: 0.75, sobr: 0.2, olhoE: 0.15, olhoD: 0.95, angZ: 9, angX: 6, bochecha: 0.15, bico: 0.3 } },
    confusa: { nome: "Confusa", sinais: { sorriso: -0.25, sobr: 0.4, olhoE: 0.85, olhoD: 1.05, angZ: 13, bocaX: -0.5 } },
  };
  C.EMOCOES = EMOCOES;
  /** Gestos que a IA (ou um toque) pode pedir: duração em segundos. */
  const GESTOS = { concordar: 1.1, negar: 1.1, inclinar: 1.4, pular: 0.9, tremer: 0.9, suspirar: 1.8, piscar: 0.6, "olhar-em-volta": 2.4, encolher: 1.2, aproximar: 1.6, acenar: 1.4, desviar: 1.4 };
  C.GESTOS = Object.keys(GESTOS);

  /** Palavras que, no nome de uma expressão, sugerem a emoção (inglês, chinês, japonês e português). */
  const PISTAS = {
    brava: /angry|anger|mad|rage|生气|怒|brava|raiva/i, triste: /sad|悲|难过|triste|depress/i, chorando: /tear|cry|泪|哭|涙|chor/i,
    apaixonada: /heart|love|爱|心|ハート|cora[cç]/i, animada: /star|kira|sparkl|shine|星|キラ|brilh/i, timida: /blush|shy|^red$|脸红|照れ|vergonh|corad/i,
    surpresa: /surpris|shock|惊|驚|surpres/i, assustada: /fear|scare|怕|恐|medo/i, rindo: /laugh|lol|笑う|rir/i, feliz: /happy|smile|joy|开心|嬉|feliz/i,
    sonolenta: /sleep|sono|眠|zz/i, confusa: /confus|疑|\?/i,
  };
  /** Para cada emoção, as expressões do modelo que combinam pelo nome (a pessoa muda em Personagem › Emoções). */
  C.adivinharExpressoes = function (nomes) {
    const mapa = {};
    for (const [emo, re] of Object.entries(PISTAS)) {
      const achadas = nomes.filter((n) => re.test(n));
      if (achadas.length) mapa[emo] = achadas;
    }
    if (mapa.chorando && mapa.triste) mapa.chorando = [...new Set([...mapa.chorando, ...mapa.triste])];
    return mapa;
  };

  // ── O núcleo do Live2D (Cubism Core) ─────────────────────────────────

  const URL_OFICIAL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
  function carregarScript(src) {
    return new Promise((ok, falhou) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => (window.Live2DCubismCore ? ok(true) : falhou(new Error("o arquivo não é o núcleo do Live2D")));
      s.onerror = () => { s.remove(); falhou(new Error("não carregou " + src)); };
      document.head.append(s);
    });
  }
  /**
   * Garante o Live2DCubismCore: 1) o guardado pela ponte; 2) o arquivo que a pessoa escolheu (guardado no
   * navegador); 3) uma cópia em vendor/ (se a pessoa pôs lá); 4) o site oficial da Live2D (precisa de internet).
   * Devolve de onde veio, ou null.
   */
  C.garantirNucleo = async function ({ oficial = true } = {}) {
    if (window.Live2DCubismCore) return "pronto";
    const ponte = window.LNUX && LNUX.ponte;
    if (ponte && ponte.disponivel) { try { await carregarScript("/api/live2d/core"); return "ponte"; } catch (e) { /* ainda não baixado */ } }
    try {
      const guardado = await LNUX.guardado.ler("companhia:nucleo");
      if (guardado) { await carregarScript(URL.createObjectURL(guardado)); return "navegador"; }
    } catch (e) { /* segue */ }
    try {
      // só tenta se a pessoa pôs o arquivo lá (sem isso, o navegador reclama do script que não existe)
      const r = await fetch("vendor/live2dcubismcore.min.js", { method: "HEAD" });
      if (r.ok && /javascript/.test(r.headers.get("content-type") || "")) { await carregarScript("vendor/live2dcubismcore.min.js"); return "vendor"; }
    } catch (e) { /* não tem */ }
    if (oficial) { try { await carregarScript(URL_OFICIAL); return "oficial"; } catch (e) { /* sem internet */ } }
    return null;
  };
  C.URL_NUCLEO = URL_OFICIAL;

  /** Núcleo + o pixi-live2d-display (que só pode carregar depois do núcleo). Devolve de onde veio o núcleo, ou null. */
  C.prepararLive2D = async function (opcoes) {
    const origem = await C.garantirNucleo(opcoes);
    if (!origem) return null;
    if (!(window.PIXI && PIXI.live2d)) {
      await new Promise((ok, falhou) => {
        const s = document.createElement("script");
        s.src = "vendor/pixi-live2d-display-cubism4.min.js";
        s.onload = () => (PIXI.live2d ? ok() : falhou(new Error("o pixi-live2d-display não carregou")));
        s.onerror = () => falhou(new Error("faltou vendor/pixi-live2d-display-cubism4.min.js"));
        document.head.append(s);
      });
    }
    return origem;
  };

  // ── Texturas: tamanho que a placa de vídeo do aparelho aguenta ─────────

  /**
   * Muitos modelos vêm com texturas enormes (o do VTube Studio, por exemplo, 4096×8192 px = 128 MB na placa de
   * vídeo). Vários celulares só aceitam até 4096 px, ou não têm memória de vídeo para isso: a textura não sobe e a
   * personagem aparece toda preta. As coordenadas de textura do Live2D vão de 0 a 1, então uma cópia menor da
   * mesma imagem serve no lugar — na tela do celular a diferença quase não aparece.
   */
  C.QUALIDADES = [["auto", "Automática (recomendada)"], ["original", "Original (o tamanho do modelo)"], ["4096", "Alta (até 4096 px)"], ["2048", "Média (até 2048 px)"], ["1024", "Leve (até 1024 px)"]];
  const ehCelular = () => (window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4);

  /** Largura e altura de uma imagem (lê só o cabeçalho, no caso do PNG). */
  async function dimensoes(blob) {
    const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { const v = new DataView(b.buffer); return [v.getUint32(16), v.getUint32(20)]; }
    try { const bmp = await createImageBitmap(blob); const d = [bmp.width, bmp.height]; bmp.close(); return d; } catch (e) { return null; }
  }
  /** Uma cópia PNG da imagem com o lado maior = limite (mantém a proporção). */
  async function reduzirImagem(blob, limite, [w, h]) {
    const k = limite / Math.max(w, h), nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
    let bmp;
    try { bmp = await createImageBitmap(blob, { resizeWidth: nw, resizeHeight: nh, resizeQuality: "high", premultiplyAlpha: "none" }); }
    catch (e) { bmp = await createImageBitmap(blob); }
    const tela = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(nw, nh) : Object.assign(document.createElement("canvas"), { width: nw, height: nh });
    const g = tela.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, nw, nh);
    bmp.close();
    return tela.convertToBlob ? tela.convertToBlob({ type: "image/png" }) : new Promise((ok) => tela.toBlob(ok, "image/png"));
  }

  // ── O palco ──────────────────────────────────────────────────────────

  class Palco {
    constructor(conteiner) {
      this.conteiner = conteiner;
      this.ouvintes = {};
      this.modelo = null;
      this.personagem = null;
      this.padrao = [];        // [id, sinal, tipo, fator] dos parâmetros padrão que o modelo tem
      this.extras = [];        // [id, entrada, inMin, inMax, outMin, outMax] (do vtube.json)
      this.faixa = new Map();  // id → {min, max, def}
      this.sinais = { ...NEUTRO };
      this.emocao = "neutra";
      this.intensidade = 1;
      this.emocaoDesde = performance.now();
      this.fala = 0;
      this.falaAlvo = 0;
      this.expressoes = new Map(); // nome → {params, peso, alvo, emocao, fadeIn, fadeOut}
      this.idsExpressoes = new Set();
      this.gestos = [];
      this.olhar = { x: 0, y: 0, alvoX: 0, alvoY: 0, ultimo: -1e9 };
      this.piscar = { proximo: performance.now() + 2500, fase: 0, inicio: 0 };
      this.enquadramento = { modo: "busto", zoom: 1, dx: 0, dy: 0 };
      this.toques = new Toques(this);
      const PIXI = window.PIXI;
      this.app = new PIXI.Application({ resizeTo: conteiner, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), preserveDrawingBuffer: true });
      conteiner.append(this.app.view);
      this.app.view.classList.add("palco-canvas");
      // se a placa de vídeo do aparelho reiniciar (falta de memória), o app recarrega a personagem com texturas menores
      this.app.view.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.emit("placa-perdida"); });
      this.app.view.addEventListener("webglcontextrestored", () => this.emit("placa-voltou"));
      new ResizeObserver(() => { this.app.resize(); this.enquadrar(); }).observe(conteiner);
    }

    on(evento, f) { (this.ouvintes[evento] = this.ouvintes[evento] || []).push(f); }
    emit(evento, ...a) { for (const f of this.ouvintes[evento] || []) { try { f(...a); } catch (e) { console.error(e); } } }

    /**
     * Carrega um personagem: {arquivos: Map(caminho → Blob), modelo: caminho do .model3.json, vtube (objeto ou null),
     * expressoes: [{nome, caminho}], idle: caminho do movimento parado, emocoes: {emoção: [nomes]}, ativas: [nomes],
     * enquadramento, zonas}
     */
    /** O maior lado de textura que a placa de vídeo deste aparelho aceita. */
    maxTextura() { const gl = this.app.renderer.gl; return (gl && gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096; }
    /** O lado máximo das texturas para a qualidade escolhida ("auto", "original" ou um número), sem passar do limite da placa. */
    limiteTextura(qualidade = "auto") {
      const max = this.maxTextura();
      if (qualidade === "original") return max;
      if (+qualidade) return Math.min(max, +qualidade);
      return Math.min(max, ehCelular() ? 2048 : 4096);
    }

    async carregar(p, { limite = null, tentativa = 0 } = {}) {
      this.descarregar();
      this.personagem = p;
      limite = limite || this.limiteTextura(p.qualidade || "auto");
      const PIXI = window.PIXI;
      if (!Palco.relogio) { PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker); Palco.relogio = true; }
      const base = p.modelo.includes("/") ? p.modelo.replace(/[^/]+$/, "") : "";
      const relativo = (c) => (c.startsWith(base) ? c.slice(base.length) : c);
      const cfg = JSON.parse(await p.arquivos.get(p.modelo).text());
      cfg.FileReferences = cfg.FileReferences || {};
      // as expressões ficam na camada própria (várias juntas); o movimento parado vem do vtube.json se faltar
      delete cfg.FileReferences.Expressions;
      if (!cfg.FileReferences.Motions && p.idle && p.arquivos.has(p.idle)) cfg.FileReferences.Motions = { Idle: [{ File: relativo(p.idle) }] };
      for (const chave of ["DisplayInfo", "UserData"]) if (cfg.FileReferences[chave] && !p.arquivos.has(base + cfg.FileReferences[chave])) delete cfg.FileReferences[chave];
      // texturas maiores que o limite viram cópias menores (guardadas no navegador para a próxima vez)
      const trocadas = new Map();
      this.texturas = [];
      const chaveCopia = p.id ? `companhia:tex:${p.id}:${limite}` : null;
      let copias = null;
      for (const t of cfg.FileReferences.Textures || []) {
        const c = base + t, b = p.arquivos.get(c);
        if (!b) continue;
        const dim = await dimensoes(b);
        if (!dim || Math.max(...dim) <= limite) { this.texturas.push({ arquivo: c, original: dim, usada: dim }); continue; }
        if (copias === null) copias = (chaveCopia && (await LNUX.guardado.ler(chaveCopia))) || {};
        if (!copias[c]) { this.emit("preparando", `Ajustando a textura ${t} (${dim.join("×")} px) para este aparelho...`); copias[c] = await reduzirImagem(b, limite, dim); copias.novas = true; }
        trocadas.set(c, copias[c]);
        const k = limite / Math.max(...dim);
        this.texturas.push({ arquivo: c, original: dim, usada: dim.map((x) => Math.round(x * k)) });
      }
      if (copias && copias.novas && chaveCopia) { delete copias.novas; LNUX.guardado.gravar(chaveCopia, copias).catch(() => {}); }
      this.limiteUsado = limite;
      const arquivos = [];
      const fm = new File([JSON.stringify(cfg)], p.modelo.split("/").pop());
      Object.defineProperty(fm, "webkitRelativePath", { value: p.modelo });
      arquivos.push(fm);
      for (const [c, b] of p.arquivos) {
        if (c === p.modelo) continue;
        const f = new File([trocadas.get(c) || b], c.split("/").pop());
        Object.defineProperty(f, "webkitRelativePath", { value: c });
        arquivos.push(f);
      }
      const modelo = await PIXI.live2d.Live2DModel.from(arquivos, { autoInteract: false });
      if (this.personagem !== p) { modelo.destroy({ texture: true, baseTexture: true }); return null; } // trocou de personagem no meio
      this.modelo = modelo;
      this.app.stage.addChild(modelo);
      // confere se as texturas subiram para a placa de vídeo; se vierem pretas, tenta de novo com cópias menores
      this.enquadramento = Object.assign({ modo: "busto", zoom: 1, dx: 0, dy: 0 }, p.enquadramento || {});
      this.enquadrar();
      this.app.renderer.render(this.app.stage);
      const maior = Math.max(0, ...this.texturas.map((t) => Math.max(...(t.usada || [0]))));
      if (this.texturasPretas() && maior > 1024 && tentativa < 3) {
        const menor = Math.max(1024, Math.min(limite, maior) / 2);
        console.warn(`Companhia: as texturas (${maior} px) não subiram para a placa de vídeo; tentando com ${menor} px.`);
        this.emit("texturas-reduzidas", { de: maior, para: menor });
        return this.carregar(p, { limite: menor, tentativa: tentativa + 1 });
      }
      const core = modelo.internalModel.coreModel;
      const ids = core._model.parameters.ids;
      this.faixa.clear();
      for (let i = 0; i < ids.length; i++) {
        this.faixa.set(ids[i], { min: core.getParameterMinimumValue(i), max: core.getParameterMaximumValue(i), def: core.getParameterDefaultValue(i) });
      }
      this.padrao = PADRAO.filter((x) => this.faixa.has(x[0]));
      const vts = (p.vtube && p.vtube.ParameterSettings) || [];
      this.extras = vts.filter((s) => s.Input && ENTRADAS_VTS[s.Input] && s.OutputLive2D && this.faixa.has(s.OutputLive2D) && !IDS_PADRAO.has(s.OutputLive2D))
        .map((s) => [s.OutputLive2D, s.Input, s.InputRangeLower, s.InputRangeUpper, s.OutputRangeLower, s.OutputRangeUpper]);
      // expressões (camada própria)
      this.expressoes.clear();
      this.idsExpressoes.clear();
      for (const e of p.expressoes || []) {
        try {
          const json = JSON.parse(await p.arquivos.get(e.caminho).text());
          const params = (json.Parameters || []).filter((x) => this.faixa.has(x.Id));
          for (const x of params) this.idsExpressoes.add(x.Id);
          this.expressoes.set(e.nome, { params, peso: 0, alvo: 0, emocao: false, fadeIn: json.FadeInTime ?? 0.4, fadeOut: json.FadeOutTime ?? 0.4 });
        } catch (err) { console.warn("expressão", e.nome, err); }
      }
      for (const nome of p.ativas || []) if (this.expressoes.has(nome)) { const x = this.expressoes.get(nome); x.alvo = 1; x.peso = 1; }
      const im = modelo.internalModel;
      // antes do movimento: as expressões partem do valor padrão a cada quadro (senão "Add" acumularia)
      im.on("beforeMotionUpdate", () => { for (const id of this.idsExpressoes) core.setParameterValueById(id, this.faixa.get(id).def); });
      im.on("afterMotionUpdate", () => this.aplicar());
      this.toques.zonas = p.zonas && p.zonas.length ? p.zonas : zonasPadrao(im.originalWidth, im.originalHeight);
      this.definirEmocao("neutra");
      this.emit("carregado", this);
      return modelo;
    }

    /**
     * As texturas ficaram pretas na placa de vídeo? (Quando a textura não sobe — grande demais ou sem memória —, a
     * placa devolve preto opaco em todo ponto.) Desenha cada textura em 16×16 e confere.
     */
    texturasPretas() {
      const PIXI = window.PIXI, r = this.app.renderer;
      if (!this.modelo || !r.plugins.extract) return false;
      for (const tex of this.modelo.textures) {
        if (!tex.valid) continue;
        const s = new PIXI.Sprite(tex);
        s.width = 16; s.height = 16;
        const rt = PIXI.RenderTexture.create({ width: 16, height: 16 });
        r.render(s, { renderTexture: rt, clear: true });
        const px = r.plugins.extract.pixels(rt);
        rt.destroy(true);
        s.destroy();
        let preto = true;
        for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2] || px[i + 3] !== 255) { preto = false; break; }
        if (preto) return true;
      }
      return false;
    }

    /** Placa de vídeo, limite de textura e as texturas do modelo (para a janela de diagnóstico). */
    diagnostico() {
      const r = this.app.renderer, gl = r.gl;
      let gpu = "";
      try { const ext = gl.getExtension("WEBGL_debug_renderer_info"); gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER); } catch (e) { /* escondido */ }
      let nucleo = "";
      try { const v = Live2DCubismCore.Version.csmGetVersion(); nucleo = `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${v & 0xffff}`; } catch (e) { /* sem núcleo */ }
      return { webgl: r.context.webGLVersion, gpu, maxTextura: this.maxTextura(), memoria: navigator.deviceMemory || null, celular: !!ehCelular(),
        limite: this.limiteUsado || null, texturas: this.texturas || [], nucleo, pretas: this.modelo ? this.texturasPretas() : null };
    }

    descarregar() {
      // libera também as texturas na placa de vídeo (senão cada troca de personagem acumula dezenas de MB)
      if (this.modelo) { this.app.stage.removeChild(this.modelo); this.modelo.destroy({ children: true, texture: true, baseTexture: true }); this.modelo = null; }
      this.gestos = [];
      this.personagem = null;
    }

    /** Valores de um parâmetro (min/max/padrão/atual) — para os ajustes e os testes. */
    parametro(id) { return this.modelo && this.faixa.has(id) ? { ...this.faixa.get(id), valor: this.modelo.internalModel.coreModel.getParameterValueById(id) } : null; }

    // ── enquadramento: rosto, busto (meio corpo) ou corpo inteiro; zoom e deslocamento da pessoa por cima
    enquadrar() {
      const m = this.modelo;
      if (!m) return;
      const W = this.conteiner.clientWidth, H = this.conteiner.clientHeight;
      if (!W || !H) return;
      const ow = m.internalModel.originalWidth, oh = m.internalModel.originalHeight;
      const corpoInteiro = oh / ow > 1.4;
      const fracao = { rosto: corpoInteiro ? 0.26 : 0.5, busto: corpoInteiro ? 0.55 : 0.85, corpo: 1 }[this.enquadramento.modo] || 1;
      const e = this.enquadramento;
      const escala = Math.min(H / (oh * fracao), (W * 0.98) / (ow * (fracao < 1 ? Math.min(1, fracao * 1.6) : 1))) * 0.97 * e.zoom;
      m.scale.set(escala);
      m.x = (W - ow * escala) / 2 + e.dx * W;
      m.y = H * 0.02 + e.dy * H;
      this.baseX = m.x; this.baseY = m.y; this.baseEscala = escala;
      this.emit("enquadrado");
    }
    definirEnquadramento(mudancas) { Object.assign(this.enquadramento, mudancas); this.enquadrar(); this.emit("enquadramento", { ...this.enquadramento }); }

    // ── emoções, gestos, expressões, olhar e fala

    definirEmocao(nome, intensidade = 1) {
      if (!EMOCOES[nome]) nome = "neutra";
      this.emocao = nome;
      this.intensidade = limitar(intensidade, 0, 1);
      this.emocaoDesde = performance.now();
      // liga as expressões da emoção; desliga as da emoção anterior (as que a pessoa ligou à mão ficam)
      const mapa = (this.personagem && this.personagem.emocoes) || {};
      const desta = new Set(mapa[nome] || []);
      for (const [n, x] of this.expressoes) {
        if (desta.has(n)) { if (x.alvo < 0.5) { x.alvo = 1; x.emocao = true; } }
        else if (x.emocao) { x.alvo = 0; x.emocao = false; }
      }
      this.emit("emocao", nome);
    }
    gesto(nome) {
      if (!GESTOS[nome]) return false;
      this.gestos = this.gestos.filter((g) => g.nome !== nome);
      this.gestos.push({ nome, inicio: performance.now() / 1000, duracao: GESTOS[nome] });
      this.emit("gesto", nome);
      return true;
    }
    /** Liga/desliga uma expressão à mão (como um atalho do VTube Studio). Devolve se ficou ligada. */
    alternarExpressao(nome, ligar) {
      const x = this.expressoes.get(nome);
      if (!x) return false;
      x.alvo = ligar === undefined ? (x.alvo > 0.5 ? 0 : 1) : (ligar ? 1 : 0);
      x.emocao = false;
      this.emit("expressoes", this.expressoesAtivas());
      return x.alvo > 0.5;
    }
    expressoesAtivas() { return [...this.expressoes].filter(([, x]) => x.alvo > 0.5 && !x.emocao).map(([n]) => n); }
    expressoesLigadas() { return [...this.expressoes].filter(([, x]) => x.alvo > 0.5).map(([n]) => n); }
    /** Nível da voz (0..1) para a boca. */
    falar(nivel) { this.falaAlvo = limitar(nivel, 0, 1); }
    /** Olhar para um ponto do conteiner (px); null volta a passear. */
    olharPara(x, y) {
      if (x === null || !this.modelo) { this.olhar.ultimo = -1e9; return; }
      const r = this.conteiner.getBoundingClientRect();
      const m = this.modelo, im = m.internalModel;
      const cx = m.x + (im.originalWidth * m.scale.x) / 2;
      const cy = m.y + im.originalHeight * m.scale.y * (im.originalHeight / im.originalWidth > 1.4 ? 0.17 : 0.35);
      this.olhar.alvoX = limitar((x - cx) / (r.width * 0.45), -1, 1);
      this.olhar.alvoY = limitar(-(y - cy) / (r.height * 0.45), -1, 1);
      this.olhar.ultimo = performance.now();
    }

    // ── a cada quadro: emoção + gestos + piscar + olhar + fala → parâmetros do modelo
    aplicar() {
      const m = this.modelo;
      if (!m) return;
      const core = m.internalModel.coreModel;
      const agora = performance.now();
      const t = agora / 1000;
      const dt = Math.min(0.1, (agora - (this.ultimoQuadro || agora)) / 1000) || 1 / 60;
      this.ultimoQuadro = agora;
      const emo = EMOCOES[this.emocao] || EMOCOES.neutra;
      const k = this.intensidade;
      const alvo = { ...NEUTRO };
      for (const [c, v] of Object.entries(emo.sinais)) {
        if (c === "olhos") { alvo.olhoE = misturar(1, v, k); alvo.olhoD = misturar(1, v, k); continue; }
        alvo[c] = misturar(NEUTRO[c], v, k);
      }
      const fase = t - this.emocaoDesde / 1000;
      if (emo.mexer === "rir") { alvo.angY += Math.sin(t * 14) * 3; alvo.boca = 0.3 + Math.abs(Math.sin(t * 9)) * 0.4; }
      if (emo.mexer === "solucar") alvo.angY += Math.max(0, Math.sin(t * 5)) * 4;
      if (emo.mexer === "tremer") { alvo.angX += Math.sin(t * 40) * 1.5; alvo.angZ += Math.sin(t * 37) * 1.2; }
      if (emo.mexer === "balancar") alvo.angZ += Math.sin(t * 2) * 5;
      if (emo.mexer === "cochilar") { const c = Math.max(0, Math.sin(t * 0.8)); alvo.angY -= c * 8; alvo.olhoE *= 1 - 0.6 * c; alvo.olhoD *= 1 - 0.6 * c; }
      // olhar: segue o ponteiro (se mexeu há pouco) ou passeia devagar
      const o = this.olhar;
      if (agora - o.ultimo > 5000) { o.alvoX = Math.sin(t * 0.21) * 0.3; o.alvoY = Math.sin(t * 0.17) * 0.15; }
      o.x = misturar(o.x, o.alvoX, Math.min(1, dt * 5));
      o.y = misturar(o.y, o.alvoY, Math.min(1, dt * 5));
      if (emo.sinais.olhoX === undefined) { alvo.olhoX = o.x; alvo.olhoY = o.y; }
      alvo.angX += o.x * 16;
      alvo.angY += o.y * 10;
      // gestos (somam por cima)
      let pulo = 0, tremor = 0, aproximar = 0;
      this.gestos = this.gestos.filter((g) => t - g.inicio < g.duracao);
      for (const g of this.gestos) {
        const p = (t - g.inicio) / g.duracao, env = Math.sin(Math.PI * p);
        switch (g.nome) {
          case "concordar": alvo.angY += Math.sin(p * Math.PI * 4) * 13 * env; break;
          case "negar": alvo.angX += Math.sin(p * Math.PI * 4) * 20 * env; break;
          case "inclinar": alvo.angZ += 15 * env; break;
          case "pular": pulo = Math.abs(Math.sin(p * Math.PI * 2)) * 0.035; alvo.sorriso = Math.max(alvo.sorriso, 0.8 * env); break;
          case "tremer": alvo.angX += Math.sin(t * 45) * 3 * env; tremor = Math.sin(t * 40) * env; break;
          case "suspirar": alvo.angY -= 10 * env; alvo.olhoE *= 1 - 0.5 * env; alvo.olhoD *= 1 - 0.5 * env; alvo.boca = Math.max(alvo.boca, 0.25 * env); break;
          case "piscar": alvo.olhoE = misturar(alvo.olhoE, 0, env); alvo.sorriso = Math.max(alvo.sorriso, 0.9); break;
          case "olhar-em-volta": alvo.olhoX = Math.sin(p * Math.PI * 3) * 0.9; alvo.angX += Math.sin(p * Math.PI * 3) * 15 * env; break;
          case "encolher": alvo.angZ += 8 * env; alvo.angY -= 6 * env; pulo -= 0.012 * env; break;
          case "aproximar": aproximar = 0.06 * env; alvo.angY += 5 * env; break;
          case "acenar": alvo.angZ += Math.sin(p * Math.PI * 6) * 7 * env; alvo.sorriso = Math.max(alvo.sorriso, 0.95); break;
          case "desviar": alvo.angX += 22 * env; alvo.olhoX = -0.8 * env; break;
        }
      }
      // piscar (de 2 a 6 s)
      const pis = this.piscar;
      if (agora > pis.proximo) { pis.fase = 1; pis.inicio = agora; pis.proximo = agora + 2000 + Math.random() * 4000; }
      let fechar = 0;
      if (pis.fase) { const q = (agora - pis.inicio) / 150; if (q >= 1) pis.fase = 0; else fechar = Math.sin(Math.PI * q); }
      // fala: a boca acompanha a voz (por cima da emoção)
      this.fala = misturar(this.fala, this.falaAlvo, Math.min(1, dt * 20));
      if (this.fala > 0.02) alvo.boca = Math.max(alvo.boca * 0.3, this.fala);
      // suaviza (a boca da fala é mais rápida)
      const s = this.sinais;
      const vel = Math.min(1, dt * 6);
      for (const c of Object.keys(alvo)) s[c] = misturar(s[c], alvo[c], c === "boca" && this.fala > 0.02 ? Math.min(1, dt * 25) : vel);
      const olhoE = s.olhoE * (1 - fechar), olhoD = s.olhoD * (1 - fechar);
      const valor = (c) => (c === "olhoE" ? olhoE : c === "olhoD" ? olhoD : s[c]);
      // sinais → parâmetros padrão
      for (const [id, c, tipo, fator] of this.padrao) {
        const f = this.faixa.get(id), v = valor(c);
        let r;
        if (tipo === "abs") r = v * fator;
        else if (tipo === "uni") r = f.min + (f.max - f.min) * limitar(v, 0, 1);
        else if (tipo === "bip") r = v >= 0 ? f.def + (f.max - f.def) * Math.min(1, v) : f.def + (f.def - f.min) * Math.max(-1, v);
        else { // olho: 1 = aberto normal (o padrão do modelo); acima disso, arregala até o máximo
          const normal = f.def > f.min + 0.01 ? f.def : f.max;
          r = v <= 1 ? f.min + (normal - f.min) * Math.max(0, v) : normal + (f.max - normal) * Math.min(1, (v - 1) / 0.3);
        }
        core.setParameterValueById(id, limitar(r, f.min, f.max));
      }
      // extras do vtube.json (com as faixas que o autor do modelo escolheu)
      const sv = { ...s, olhoE, olhoD };
      for (const [id, entrada, a, b, c0, c1] of this.extras) {
        const v = ENTRADAS_VTS[entrada](sv);
        const q = b === a ? 0 : limitar((v - a) / (b - a), 0, 1);
        const f = this.faixa.get(id);
        core.setParameterValueById(id, limitar(c0 + (c1 - c0) * q, f.min, f.max));
      }
      // expressões: entram e saem suavemente; Add soma, Multiply multiplica, Overwrite substitui
      for (const x of this.expressoes.values()) {
        const passo = dt / Math.max(0.05, x.alvo > x.peso ? x.fadeIn : x.fadeOut);
        x.peso = x.alvo > x.peso ? Math.min(x.alvo, x.peso + passo) : Math.max(x.alvo, x.peso - passo);
        if (x.peso <= 0.001) continue;
        for (const pr of x.params) {
          const atual = core.getParameterValueById(pr.Id);
          if (pr.Blend === "Multiply") core.setParameterValueById(pr.Id, atual * misturar(1, pr.Value, x.peso));
          else if (pr.Blend === "Overwrite") core.setParameterValueById(pr.Id, misturar(atual, pr.Value, x.peso));
          else core.setParameterValueById(pr.Id, atual + pr.Value * x.peso);
        }
      }
      // corpo inteiro: pulo, susto, desânimo, chegar perto (mexe no desenho, então serve para qualquer modelo)
      const H = this.conteiner.clientHeight;
      const susto = emo.postura === "subir" ? 0.012 * k * Math.max(0, 1 - fase * 1.5) : 0;
      const desanimo = emo.postura === "cair" ? 0.01 * k : 0;
      m.y = misturar(m.y, this.baseY + (-pulo - susto + desanimo) * H, Math.min(1, dt * 12));
      m.scale.set(misturar(m.scale.x, this.baseEscala * (1 + aproximar), Math.min(1, dt * 8)));
      m.x = this.baseX - ((m.scale.x - this.baseEscala) * m.internalModel.originalWidth) / 2 + tremor * 3;
    }

    /** Ponto do conteiner (px) → coordenadas do modelo (0..1 da largura/altura originais). */
    paraModelo(x, y) {
      const m = this.modelo;
      if (!m) return null;
      return { x: (x - m.x) / (m.internalModel.originalWidth * m.scale.x), y: (y - m.y) / (m.internalModel.originalHeight * m.scale.y) };
    }
    deModelo(nx, ny) {
      const m = this.modelo;
      return { x: m.x + nx * m.internalModel.originalWidth * m.scale.x, y: m.y + ny * m.internalModel.originalHeight * m.scale.y };
    }
    /** Pausa o desenho (durante trabalho pesado, como importar um ZIP, ou com a aba escondida) e volta. */
    pausar() { this.app.ticker.stop(); window.PIXI.Ticker.shared.stop(); }
    continuar() { this.ultimoQuadro = 0; window.PIXI.Ticker.shared.start(); this.app.ticker.start(); }
    /** Uma foto do palco (PNG). */
    foto() { this.app.renderer.render(this.app.stage); return new Promise((ok) => this.app.view.toBlob(ok, "image/png")); }
  }
  C.Palco = Palco;

  // ── Toques: áreas do corpo e gestos (tocar, tocar duas vezes, segurar, carinho/esfregar, puxar) ──

  /**
   * Áreas padrão, em frações do modelo (0..1). Ficam de fora o peito e o quadril: os toques são de carinho
   * (cafuné, segurar a mão, cócegas) ou de provocação de brincadeira (cutucar, puxar a orelha ou a bochecha,
   * mexer no chapéu). A pessoa ajusta as áreas em Personagem › Áreas de toque.
   */
  function zonasPadrao(ow, oh) {
    const z = (id, nome, rets) => ({ id, nome, rets });
    if (oh / ow > 1.4) return [
      z("chapeu", "Chapéu", [[0.33, 0.0, 0.67, 0.075]]),
      z("cabeca", "Cabeça", [[0.33, 0.075, 0.67, 0.15]]),
      z("orelhas", "Orelhas", [[0.25, 0.12, 0.35, 0.2], [0.65, 0.12, 0.75, 0.2]]),
      z("rosto", "Rosto e bochechas", [[0.37, 0.15, 0.63, 0.25]]),
      z("ombros", "Ombros e braços", [[0.24, 0.27, 0.4, 0.4], [0.6, 0.27, 0.76, 0.4]]),
      z("maos", "Mãos", [[0.15, 0.44, 0.33, 0.56], [0.67, 0.44, 0.85, 0.56]]),
      z("barriga", "Barriga (cócegas)", [[0.42, 0.4, 0.58, 0.5]]),
      z("pes", "Pés (cócegas)", [[0.33, 0.9, 0.67, 1.0]]),
    ];
    return [
      z("chapeu", "Chapéu / topo", [[0.28, 0.0, 0.72, 0.1]]),
      z("cabeca", "Cabeça", [[0.25, 0.1, 0.75, 0.3]]),
      z("orelhas", "Orelhas", [[0.15, 0.25, 0.27, 0.42], [0.73, 0.25, 0.85, 0.42]]),
      z("rosto", "Rosto e bochechas", [[0.32, 0.3, 0.68, 0.5]]),
      z("ombros", "Ombros e braços", [[0.08, 0.62, 0.32, 0.85], [0.68, 0.62, 0.92, 0.85]]),
      z("barriga", "Barriga (cócegas)", [[0.38, 0.88, 0.62, 1.0]]),
    ];
  }
  C.zonasPadrao = zonasPadrao;

  class Toques {
    constructor(palco) {
      this.palco = palco;
      this.zonas = [];
      this.ativo = null;
      this.editando = false;
      this.ultimoToque = { t: 0, zona: null };
      const el = palco.conteiner;
      el.addEventListener("pointerdown", (e) => this.inicio(e));
      el.addEventListener("pointermove", (e) => this.mover(e));
      el.addEventListener("pointerup", (e) => this.fim(e));
      el.addEventListener("pointercancel", () => { clearTimeout(this.segurarT); this.ativo = null; palco.emit("tocando", null); });
      el.addEventListener("pointerleave", () => palco.olharPara(null, null));
    }
    zonaEm(x, y) {
      const n = this.palco.paraModelo(x, y);
      if (!n) return null;
      for (const z of this.zonas) for (const [a, b, c, d] of z.rets) if (n.x >= a && n.x <= c && n.y >= b && n.y <= d) return z;
      return null;
    }
    ponto(e) { const r = this.palco.conteiner.getBoundingClientRect(); return (this.ultimoPonto = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }); }
    inicio(e) {
      if (e.button > 0 || this.editando) return;
      const p = this.ponto(e);
      const zona = this.zonaEm(p.x, p.y);
      if (!zona) return;
      try { this.palco.conteiner.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
      this.ativo = { zona, inicio: p, ultimo: p, caminho: 0, viradas: 0, dirX: 0, dirY: 0, maxDist: 0, segurou: false, esfregando: false, carinhos: 0 };
      this.palco.emit("tocando", zona);
      clearTimeout(this.segurarT);
      this.segurarT = setTimeout(() => {
        const a = this.ativo;
        if (a && a.maxDist < 14) { a.segurou = true; this.disparar(a.zona, "segurar", 1); }
      }, 650);
    }
    mover(e) {
      if (this.editando) return;
      const p = this.ponto(e);
      this.palco.olharPara(p.x, p.y);
      const a = this.ativo;
      if (!a) { this.palco.conteiner.style.cursor = this.zonaEm(p.x, p.y) ? "grab" : ""; return; }
      const dx = p.x - a.ultimo.x, dy = p.y - a.ultimo.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) return;
      a.caminho += d;
      a.maxDist = Math.max(a.maxDist, Math.hypot(p.x - a.inicio.x, p.y - a.inicio.y));
      // vai e volta (viradas de direção) = carinho / cafuné / esfregar
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const horizontal = Math.abs(dx) > Math.abs(dy);
      if ((horizontal && sx && a.dirX && sx !== a.dirX) || (!horizontal && sy && a.dirY && sy !== a.dirY)) a.viradas++;
      if (Math.abs(dx) > 1) a.dirX = sx;
      if (Math.abs(dy) > 1) a.dirY = sy;
      a.ultimo = p;
      if (!a.esfregando && a.viradas >= 3 && a.caminho > 110) { a.esfregando = true; a.marcaCarinho = a.caminho; this.disparar(a.zona, "carinho", 1); }
      else if (a.esfregando && a.caminho - a.marcaCarinho > 300) { a.marcaCarinho = a.caminho; a.carinhos++; this.palco.emit("carinho-continuo", { zona: a.zona.id, vezes: a.carinhos, x: p.x, y: p.y }); }
    }
    fim(e) {
      clearTimeout(this.segurarT);
      const a = this.ativo;
      this.ativo = null;
      this.palco.emit("tocando", null);
      if (!a) return;
      const p = this.ponto(e);
      const tempo = p.t - a.inicio.t;
      if (a.esfregando || a.segurou) return;
      if (a.maxDist > 45 && a.viradas < 2) { this.disparar(a.zona, "puxar", limitar(a.maxDist / 200, 0.3, 1)); return; }
      if (tempo < 400 && a.maxDist < 14) {
        const duplo = p.t - this.ultimoToque.t < 400 && this.ultimoToque.zona === a.zona.id;
        this.ultimoToque = { t: duplo ? 0 : p.t, zona: a.zona.id };
        this.disparar(a.zona, duplo ? "tocar2" : "tocar", 1);
      }
    }
    disparar(zona, gesto, intensidade) {
      const p = this.ultimoPonto || { x: 0, y: 0 };
      this.palco.emit("toque", { zona: zona.id, nomeZona: zona.nome, gesto, intensidade, x: p.x, y: p.y });
    }
  }
  C.Toques = Toques;
})();
