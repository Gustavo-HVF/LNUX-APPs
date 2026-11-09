/*
 * Companhia — palco 3D para personagens VRoid (.vrm), com o three.js e o three-vrm (pixiv, MIT).
 *
 * Tem o mesmo jeito do palco Live2D (C.Palco): definirEmocao, gesto, falar, olharPara, expressões, enquadramento
 * e toques. Assim a conversa, a voz, as reações e a memória funcionam igual para os dois tipos de personagem.
 *
 *   - Emoções viram as expressões padrão do VRM (happy, sad, angry, relaxed, surprised...), que todo modelo do
 *     VRoid tem, mais uma postura da cabeça e do tronco. A boca fala com "aa"/"oh"; o piscar é próprio.
 *   - Gestos (concordar, negar, acenar, pular...) mexem nos ossos do esqueleto humanoide do VRM.
 *   - As áreas de toque seguem o corpo: são calculadas a cada momento a partir dos ossos (cabeça, mãos, pés...).
 *   - Roupas: cada personagem pode ter vários .vrm (um por roupa); as peças (materiais de roupa do VRoid, como
 *     Tops, Bottoms, Shoes) podem ser escondidas, e a textura de uma peça pode ser trocada por outra imagem.
 *
 * O pacote do three.js + three-vrm (vendor/three-vrm-pacote.min.js) só é carregado quando uma personagem VRoid abre.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const misturar = (a, b, t) => a + (b - a) * t;

  let carregandoPacote = null;
  /** Carrega o three.js + three-vrm (uma vez). */
  C.prepararVRM = function () {
    if (window.CompanhiaVRM) return Promise.resolve(true);
    if (!carregandoPacote) carregandoPacote = new Promise((ok, falhou) => {
      const s = document.createElement("script");
      s.src = "vendor/three-vrm-pacote.min.js";
      s.onload = () => (window.CompanhiaVRM ? ok(true) : falhou(new Error("o three-vrm não carregou")));
      s.onerror = () => { carregandoPacote = null; falhou(new Error("faltou vendor/three-vrm-pacote.min.js")); };
      document.head.append(s);
    });
    return carregandoPacote;
  };

  /** Emoção → pesos das expressões do VRM (nomes do VRM 1.0; o three-vrm traduz os do VRM 0.x: joy, sorrow...). */
  const EXPRESSOES = {
    neutra: {}, feliz: { happy: 0.8 }, rindo: { happy: 1, aa: 0.35 }, timida: { happy: 0.35, relaxed: 0.45 },
    triste: { sad: 0.85 }, chorando: { sad: 1 }, brava: { angry: 0.9 }, surpresa: { surprised: 0.9 },
    assustada: { surprised: 0.7, sad: 0.35 }, pensativa: { relaxed: 0.3 }, apaixonada: { happy: 0.6, relaxed: 0.5 },
    animada: { happy: 1, surprised: 0.2 }, sonolenta: { relaxed: 0.6, blink: 0.45 }, provocadora: { happy: 0.55, blinkLeft: 0.9 },
    confusa: { surprised: 0.35, sad: 0.25 },
  };
  /** Postura por emoção (radianos): cabeça baixa (+x), de lado (z), tronco para a frente (+x), olhar desviado. */
  const POSTURA = {
    triste: { cabecaX: 0.22, troncoX: 0.08 }, chorando: { cabecaX: 0.28, troncoX: 0.1 }, timida: { cabecaX: 0.15, cabecaZ: 0.12, desviar: 0.4 },
    pensativa: { cabecaZ: -0.15, cabecaX: -0.08 }, surpresa: { troncoX: -0.06, cabecaX: -0.08 }, brava: { cabecaX: 0.08 },
    confusa: { cabecaZ: 0.22 }, apaixonada: { cabecaZ: 0.12 }, provocadora: { cabecaZ: 0.15 }, sonolenta: { cabecaX: 0.2, cabecaZ: 0.1 },
    feliz: { cabecaZ: 0.06 }, assustada: { troncoX: -0.05 },
  };
  const PRESETS = new Set(["happy", "angry", "sad", "relaxed", "surprised", "aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight",
    "lookUp", "lookDown", "lookLeft", "lookRight", "neutral"]);
  /** Materiais que são roupa (nomes do VRoid: Tops_01_CLOTH, Bottoms, Onepiece, Shoes, Accessory...) e os que não são. */
  const ROUPA = /cloth|tops|bottoms|onepiece|shoes|socks|accessor|acc_|gloves|hat|wing|pannier|skirt|dress|jacket|coat|ribbon|bag|roupa|outfit|costume/i;
  const NAO_ROUPA = /skin|hair|face|eye|brow|mouth|lash|tooth|teeth/i;
  /** "N00_000_00_Tops_01_CLOTH (Instance)" → "Tops_01_CLOTH" */
  const nomePeca = (n) => String(n || "").replace(/\s*\((Instance|Outline)\)/gi, "").replace(/^N\d+_\d+_\d+_/, "").trim();
  C.nomePeca = nomePeca;
  const ehCelular = () => (window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4);

  class Palco3D {
    constructor(conteiner) {
      const T = window.THREE;
      this.tipo = "vrm";
      this.conteiner = conteiner;
      this.ouvintes = {};
      this.modelo = null;
      this.vrm = null;
      this.personagem = null;
      this.roupa = null;
      this.emocao = "neutra";
      this.intensidade = 1;
      this.emocaoDesde = performance.now();
      this.fala = 0;
      this.falaAlvo = 0;
      this.gestos = [];
      this.olhar = { x: 0, y: 0, alvoX: 0, alvoY: 0, ultimo: -1e9 };
      this.piscar = { proximo: performance.now() + 2500, fase: 0, inicio: 0 };
      this.enquadramento = { modo: "busto", zoom: 1, dx: 0, dy: 0 };
      this.expressoes = new Map(); // as expressões próprias do modelo (fora as padrão): nome → {alvo, peso, emocao}
      this.pesos = {}; // peso atual de cada expressão (suavizado)
      this.pecas = []; // [{nome, materiais: [Material], visivel}]
      this.texturas = [];
      this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.view = this.renderer.domElement;
      this.view.classList.add("palco-canvas", "palco-3d");
      conteiner.append(this.view);
      this.cena = new T.Scene();
      this.camera = new T.PerspectiveCamera(30, 1, 0.05, 30);
      const luz = new T.DirectionalLight(0xffffff, Math.PI * 0.9);
      luz.position.set(1, 1.5, 2);
      this.cena.add(luz, new T.HemisphereLight(0xffffff, 0x8888aa, 0.9));
      this.alvoOlhar = new T.Object3D();
      this.cena.add(this.alvoOlhar);
      this.relogio = new T.Clock();
      this.v = new T.Vector3();
      this.view.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.emit("placa-perdida"); });
      this.view.addEventListener("webglcontextrestored", () => this.emit("placa-voltou"));
      new ResizeObserver(() => this.redimensionar()).observe(conteiner);
      this.redimensionar();
      this.toques = new C.Toques(this);
      // as áreas de toque seguem os ossos: calculadas na hora (o editor de áreas não vale para personagens 3D)
      Object.defineProperty(this.toques, "zonas", { get: () => this.zonasAtuais(), set: () => {} });
      this.continuar();
    }

    on(evento, f) { (this.ouvintes[evento] = this.ouvintes[evento] || []).push(f); }
    emit(evento, ...a) { for (const f of this.ouvintes[evento] || []) { try { f(...a); } catch (e) { console.error(e); } } }

    redimensionar() {
      const W = this.conteiner.clientWidth, H = this.conteiner.clientHeight;
      if (!W || !H) return;
      this.renderer.setSize(W, H, false);
      this.view.style.width = "100%";
      this.view.style.height = "100%";
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      this.enquadrar();
    }
    pausar() { this.renderer.setAnimationLoop(null); }
    continuar() { this.relogio.getDelta(); this.renderer.setAnimationLoop(() => this.quadro()); }
    mostrar(sim) { this.view.style.display = sim ? "" : "none"; if (sim) this.continuar(); else this.pausar(); }

    // ── texturas (mesma ideia do palco Live2D: celular até 2048 px, computador até 4096, nunca acima da placa)
    maxTextura() { return this.renderer.capabilities.maxTextureSize || 4096; }
    limiteTextura(qualidade = "auto") {
      const max = this.maxTextura();
      if (qualidade === "original") return max;
      if (+qualidade) return Math.min(max, +qualidade);
      return Math.min(max, ehCelular() ? 2048 : 4096);
    }
    reduzirTexturas(limite) {
      const vistas = new Set();
      this.texturas = [];
      this.limiteUsado = limite;
      this.modelo.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) {
            if (!v || !v.isTexture || vistas.has(v) || !v.image) continue;
            vistas.add(v);
            const img = v.image, w = img.width, h = img.height;
            if (!w || !h) continue;
            const info = { arquivo: v.name || m.name || "textura", original: [w, h], usada: [w, h] };
            if (Math.max(w, h) > limite) {
              const k = limite / Math.max(w, h);
              const tela = document.createElement("canvas");
              tela.width = Math.max(1, Math.round(w * k));
              tela.height = Math.max(1, Math.round(h * k));
              const g = tela.getContext("2d");
              g.imageSmoothingQuality = "high";
              g.drawImage(img, 0, 0, tela.width, tela.height);
              v.image = tela;
              v.needsUpdate = true;
              info.usada = [tela.width, tela.height];
            }
            this.texturas.push(info);
          }
        }
      });
    }
    texturasPretas() { return false; } // o three.js já reduz sozinho o que passa do limite da placa
    diagnostico() {
      const gl = this.renderer.getContext();
      let gpu = "";
      try { const ext = gl.getExtension("WEBGL_debug_renderer_info"); gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER); } catch (e) { /* escondido */ }
      return { webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1, gpu, maxTextura: this.maxTextura(), memoria: navigator.deviceMemory || null, celular: !!ehCelular(),
        limite: this.limiteUsado || null, texturas: this.texturas, nucleo: "não precisa (VRM)", pretas: false };
    }

    /**
     * Carrega a personagem VRoid: p = {tipo: "vrm", roupas: [{id, nome, blob, ocultas: [], texturas: {peça: Blob}}],
     * roupaAtual, emocoes, ativas, enquadramento, qualidade}.
     */
    async carregar(p, { roupaId } = {}) {
      this.descarregar();
      this.personagem = p;
      const { GLTFLoader, VRMLoaderPlugin, VRMUtils } = window.CompanhiaVRM;
      const roupa = p.roupas.find((r) => r.id === (roupaId || p.roupaAtual)) || p.roupas[0];
      if (!roupa) throw new Error("Essa personagem não tem nenhum arquivo .vrm.");
      const carregador = new GLTFLoader();
      carregador.register((parser) => new VRMLoaderPlugin(parser));
      const url = URL.createObjectURL(roupa.blob);
      let gltf;
      try { gltf = await carregador.loadAsync(url); } finally { URL.revokeObjectURL(url); }
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("Esse arquivo não é um VRM (o formato das personagens exportadas pelo VRoid Studio).");
      if (this.personagem !== p) { VRMUtils.deepDispose(vrm.scene); return null; } // trocou no meio
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm); // os VRM 0.x olham para o outro lado
      vrm.scene.traverse((o) => { o.frustumCulled = false; });
      this.vrm = vrm;
      this.modelo = vrm.scene;
      this.roupa = roupa;
      this.cena.add(vrm.scene);
      this.reduzirTexturas(this.limiteTextura(p.qualidade || "auto"));
      if (vrm.lookAt) vrm.lookAt.target = this.alvoOlhar;
      // expressões: as padrão viram emoções; as próprias do modelo viram atalhos (como no Live2D)
      const em = vrm.expressionManager;
      const nomes = em ? em.expressions.map((e) => e.expressionName) : [];
      this.disponiveis = new Set(nomes);
      this.expressoes.clear();
      this.pesos = {};
      for (const n of nomes) if (!PRESETS.has(n)) this.expressoes.set(n, { alvo: 0, peso: 0, emocao: false, params: [n] });
      for (const n of p.ativas || []) if (this.expressoes.has(n)) Object.assign(this.expressoes.get(n), { alvo: 1, peso: 1 });
      // peças de roupa (agrupadas pelo nome do material)
      const porNome = new Map();
      vrm.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material || [])) {
          const n = nomePeca(m.name);
          if (!n || NAO_ROUPA.test(n) || !ROUPA.test(n)) continue;
          if (!porNome.has(n)) porNome.set(n, { nome: n, materiais: new Set(), visivel: true });
          porNome.get(n).materiais.add(m);
        }
      });
      this.pecas = [...porNome.values()].map((x) => ({ ...x, materiais: [...x.materiais] }));
      for (const peca of this.pecas) if ((roupa.ocultas || []).includes(peca.nome)) this.mostrarPeca(peca.nome, false);
      for (const [peca, blob] of Object.entries(roupa.texturas || {})) await this.trocarTextura(peca, blob).catch((e) => console.warn("textura", peca, e));
      // pose de descanso (os braços do VRM vêm abertos em "T") e medidas do corpo para enquadrar e para as áreas
      this.poseBase();
      vrm.update(0);
      this.medir();
      this.enquadramento = Object.assign({ modo: "busto", zoom: 1, dx: 0, dy: 0 }, p.enquadramento || {});
      this.enquadrar();
      this.definirEmocao("neutra");
      this.emit("carregado", this);
      return vrm;
    }

    descarregar() {
      if (this.vrm) {
        this.cena.remove(this.vrm.scene);
        try { window.CompanhiaVRM.VRMUtils.deepDispose(this.vrm.scene); } catch (e) { /* já foi */ }
      }
      this.vrm = null;
      this.modelo = null;
      this.gestos = [];
      this.pecas = [];
      this.personagem = null;
    }

    // ── roupas: peças e texturas

    mostrarPeca(nome, visivel) {
      const peca = this.pecas.find((x) => x.nome === nome);
      if (!peca) return false;
      peca.visivel = visivel;
      for (const m of peca.materiais) { m.visible = visivel; m.needsUpdate = true; }
      return true;
    }
    pecasOcultas() { return this.pecas.filter((x) => !x.visivel).map((x) => x.nome); }
    /** Troca a imagem (cor/estampa) de uma peça. As coordenadas de textura do modelo continuam as mesmas. */
    async trocarTextura(nome, blob) {
      const T = window.THREE;
      const peca = this.pecas.find((x) => x.nome === nome);
      if (!peca) return false;
      const bmp = await createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none" });
      const tex = new T.Texture(bmp);
      tex.flipY = false; // como as texturas do glTF
      tex.colorSpace = T.SRGBColorSpace;
      tex.needsUpdate = true;
      for (const m of peca.materiais) {
        const antiga = m.map;
        if (!peca.originais) peca.originais = new Map();
        if (!peca.originais.has(m)) peca.originais.set(m, { map: m.map, shade: m.shadeMultiplyTexture });
        if (antiga) { tex.wrapS = antiga.wrapS; tex.wrapT = antiga.wrapT; tex.offset.copy(antiga.offset); tex.repeat.copy(antiga.repeat); }
        m.map = tex;
        // no MToon (o material do VRoid) a sombra costuma usar a mesma imagem
        if (m.shadeMultiplyTexture && m.shadeMultiplyTexture === (peca.originais.get(m).map)) m.shadeMultiplyTexture = tex;
        m.needsUpdate = true;
      }
      return true;
    }
    voltarTextura(nome) {
      const peca = this.pecas.find((x) => x.nome === nome);
      if (!peca || !peca.originais) return;
      for (const [m, o] of peca.originais) { m.map = o.map; m.shadeMultiplyTexture = o.shade; m.needsUpdate = true; }
      peca.originais = null;
    }

    // ── corpo
    osso(nome) { return this.vrm && this.vrm.humanoid ? this.vrm.humanoid.getNormalizedBoneNode(nome) : null; }
    posicao(nome, alvo) {
      const b = this.vrm && this.vrm.humanoid ? this.vrm.humanoid.getRawBoneNode(nome) : null;
      return b ? b.getWorldPosition(alvo || new window.THREE.Vector3()) : null;
    }
    /** Braços para baixo e o resto parado: a base de todos os quadros. */
    poseBase() {
      const h = this.vrm.humanoid;
      if (!h) return;
      h.resetNormalizedPose();
      const o = (n) => this.osso(n);
      if (o("leftUpperArm")) o("leftUpperArm").rotation.z = -1.2;
      if (o("rightUpperArm")) o("rightUpperArm").rotation.z = 1.2;
      if (o("leftLowerArm")) o("leftLowerArm").rotation.z = -0.15;
      if (o("rightLowerArm")) o("rightLowerArm").rotation.z = 0.15;
      if (o("hips")) this.hipsBase = o("hips").position.clone();
    }
    medir() {
      const T = window.THREE;
      const cab = this.posicao("head") || new T.Vector3(0, 1.4, 0);
      const pe = this.posicao("leftFoot") || new T.Vector3(0, 0.05, 0);
      const quadril = this.posicao("hips") || new T.Vector3(0, 0.85, 0);
      this.altura = Math.max(0.5, cab.y - pe.y + 0.1);
      this.medidas = { cabecaY: cab.y, peY: Math.min(pe.y, 0) , quadrilY: quadril.y, topo: cab.y + this.altura * 0.12, x: cab.x, z: cab.z };
    }

    // ── enquadramento
    enquadrar() {
      if (!this.medidas) { this.emit("enquadrado"); return; }
      const m = this.medidas, e = this.enquadramento, T = window.THREE;
      let cy, alto;
      if (e.modo === "rosto") { cy = m.cabecaY + this.altura * 0.05; alto = this.altura * 0.26; }
      else if (e.modo === "corpo") { cy = (m.topo + m.peY) / 2; alto = (m.topo - m.peY) * 1.08; }
      else { cy = (m.topo + m.quadrilY) / 2 + this.altura * 0.02; alto = (m.topo - m.quadrilY) * 1.35; }
      const meiaFov = T.MathUtils.degToRad(this.camera.fov / 2);
      const largura = alto * (e.modo === "corpo" ? 0.55 : 0.75);
      let dist = Math.max((alto / 2) / Math.tan(meiaFov), (largura / 2) / (Math.tan(meiaFov) * this.camera.aspect));
      dist /= e.zoom || 1;
      this.distBase = dist;
      this.alvoCam = new T.Vector3(m.x - (e.dx || 0) * alto, cy - (e.dy || 0) * alto, m.z);
      this.camera.position.set(this.alvoCam.x, this.alvoCam.y, m.z + dist);
      this.camera.lookAt(this.alvoCam);
      this.emit("enquadrado");
    }
    definirEnquadramento(mudancas) { Object.assign(this.enquadramento, mudancas); this.enquadrar(); this.emit("enquadramento", { ...this.enquadramento }); }

    // ── emoções, gestos, expressões, olhar e fala (mesmos nomes do palco Live2D)
    definirEmocao(nome, intensidade = 1) {
      if (!C.EMOCOES[nome]) nome = "neutra";
      this.emocao = nome;
      this.intensidade = limitar(intensidade, 0, 1);
      this.emocaoDesde = performance.now();
      const mapa = (this.personagem && this.personagem.emocoes) || {};
      const desta = new Set(mapa[nome] || []);
      for (const [n, x] of this.expressoes) {
        if (desta.has(n)) { if (x.alvo < 0.5) { x.alvo = 1; x.emocao = true; } }
        else if (x.emocao) { x.alvo = 0; x.emocao = false; }
      }
      this.emit("emocao", nome);
    }
    gesto(nome) {
      const dur = { concordar: 1.1, negar: 1.1, inclinar: 1.4, pular: 0.9, tremer: 0.9, suspirar: 1.8, piscar: 0.6, "olhar-em-volta": 2.4, encolher: 1.2, aproximar: 1.6, acenar: 1.8, desviar: 1.4 }[nome];
      if (!dur) return false;
      this.gestos = this.gestos.filter((g) => g.nome !== nome);
      this.gestos.push({ nome, inicio: performance.now() / 1000, duracao: dur });
      this.emit("gesto", nome);
      return true;
    }
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
    falar(nivel) { this.falaAlvo = limitar(nivel, 0, 1); }
    olharPara(x, y) {
      if (x === null || !this.modelo) { this.olhar.ultimo = -1e9; return; }
      const W = this.conteiner.clientWidth, H = this.conteiner.clientHeight;
      const cab = this.paraTela(this.posicao("head", this.v));
      this.olhar.alvoX = limitar((x - (cab ? cab.x : W / 2)) / (W * 0.45), -1, 1);
      this.olhar.alvoY = limitar(-(y - (cab ? cab.y : H * 0.3)) / (H * 0.45), -1, 1);
      this.olhar.ultimo = performance.now();
    }
    /** Valor de uma expressão do VRM (para os testes e o diagnóstico). */
    expressao(nome) { return this.vrm && this.vrm.expressionManager ? this.vrm.expressionManager.getValue(nome) : null; }

    // ── a cada quadro
    quadro() {
      const dt = Math.min(0.1, this.relogio.getDelta());
      const vrm = this.vrm;
      if (vrm) {
        try { this.animar(dt); vrm.update(dt); } catch (e) { console.error(e); }
      }
      this.renderer.render(this.cena, this.camera);
    }
    animar(dt) {
      const vrm = this.vrm, t = performance.now() / 1000, agora = performance.now();
      const emo = C.EMOCOES[this.emocao] || C.EMOCOES.neutra, k = this.intensidade;
      this.poseBase();
      const o = (n) => this.osso(n);
      const post = POSTURA[this.emocao] || {};
      let cabX = (post.cabecaX || 0) * k, cabY = 0, cabZ = (post.cabecaZ || 0) * k, troncoX = (post.troncoX || 0) * k, troncoZ = 0, pulo = 0, aproximar = 0;
      // respirar e balançar devagar
      troncoX += Math.sin(t * 1.6) * 0.012;
      troncoZ += Math.sin(t * 0.5) * 0.015;
      cabZ += Math.sin(t * 0.29) * 0.03;
      // movimentos da emoção
      const fase = t - this.emocaoDesde / 1000;
      if (emo.mexer === "rir") cabX += Math.sin(t * 14) * 0.05;
      if (emo.mexer === "solucar") troncoX += Math.max(0, Math.sin(t * 5)) * 0.04;
      if (emo.mexer === "tremer") { cabY += Math.sin(t * 40) * 0.03; troncoZ += Math.sin(t * 37) * 0.02; }
      if (emo.mexer === "balancar") troncoZ += Math.sin(t * 2) * 0.06;
      if (emo.mexer === "cochilar") cabX += Math.max(0, Math.sin(t * 0.8)) * 0.25;
      if (emo.mexer === "pular") pulo = Math.max(0, Math.sin(t * 6)) * 0.015;
      if (emo.postura === "subir") pulo += 0.02 * k * Math.max(0, 1 - fase * 1.5);
      // olhar: ponteiro (se mexeu há pouco) ou passeia
      const ol = this.olhar;
      if (agora - ol.ultimo > 5000) { ol.alvoX = Math.sin(t * 0.21) * 0.3; ol.alvoY = Math.sin(t * 0.17) * 0.15; }
      ol.x = misturar(ol.x, ol.alvoX, Math.min(1, dt * 5));
      ol.y = misturar(ol.y, ol.alvoY, Math.min(1, dt * 5));
      let olharX = ol.x - (post.desviar || 0);
      cabY += olharX * 0.35;
      cabX -= ol.y * 0.2;
      // gestos
      const pesosExtra = {};
      let acenar = 0, onda = 0, ombros = 0;
      this.gestos = this.gestos.filter((g) => t - g.inicio < g.duracao);
      for (const g of this.gestos) {
        const p = (t - g.inicio) / g.duracao, env = Math.sin(Math.PI * p);
        switch (g.nome) {
          case "concordar": cabX += Math.sin(p * Math.PI * 4) * 0.22 * env; break;
          case "negar": cabY += Math.sin(p * Math.PI * 4) * 0.35 * env; break;
          case "inclinar": cabZ += 0.3 * env; break;
          case "pular": pulo += Math.abs(Math.sin(p * Math.PI * 2)) * 0.06; break;
          case "tremer": cabY += Math.sin(t * 45) * 0.05 * env; troncoZ += Math.sin(t * 40) * 0.03 * env; break;
          case "suspirar": troncoX += 0.1 * env; cabX += 0.15 * env; ombros -= 0.1 * env; break;
          case "piscar": pesosExtra.blinkLeft = env; break;
          case "olhar-em-volta": cabY += Math.sin(p * Math.PI * 3) * 0.5 * env; olharX = Math.sin(p * Math.PI * 3); break;
          case "encolher": ombros += 0.22 * env; cabX += 0.08 * env; break;
          case "aproximar": aproximar = 0.12 * env; troncoX += 0.08 * env; break;
          case "acenar": acenar = env; onda = Math.sin(p * Math.PI * 6); break;
          case "desviar": cabY -= 0.5 * env; olharX = -0.8 * env; break;
        }
      }
      // ossos
      const aplicar = (n, x, y, z) => { const b = o(n); if (b) { b.rotation.x += x; b.rotation.y += y; b.rotation.z += z; } };
      aplicar("spine", troncoX * 0.5, 0, troncoZ * 0.5);
      aplicar("chest", troncoX * 0.5, 0, troncoZ * 0.5);
      aplicar("neck", cabX * 0.4, cabY * 0.4, cabZ * 0.4);
      aplicar("head", cabX * 0.6, cabY * 0.6, cabZ * 0.6);
      aplicar("leftShoulder", 0, 0, ombros);
      aplicar("rightShoulder", 0, 0, -ombros);
      if (acenar) {
        // braço direito levantado em diagonal, balançando de um lado para o outro ("tchau")
        aplicar("rightUpperArm", 0, 0, -(2.3 + onda * 0.3) * acenar);
        aplicar("rightLowerArm", 0, -0.6 * acenar, 0);
      }
      if (o("hips") && this.hipsBase) o("hips").position.y = this.hipsBase.y + pulo * this.altura;
      // câmera: chegar perto
      if (this.alvoCam) {
        const d = this.distBase * (1 - aproximar);
        this.camera.position.z = misturar(this.camera.position.z, this.medidas.z + d, Math.min(1, dt * 8));
      }
      // olhos: alvo na frente do rosto, deslocado pelo olhar
      const cam = this.camera.position;
      this.alvoOlhar.position.set(cam.x + olharX * 0.6 * this.altura, cam.y + ol.y * 0.4 * this.altura, cam.z);
      // expressões
      const alvo = {};
      for (const [n, w] of Object.entries(EXPRESSOES[this.emocao] || {})) alvo[n] = w * k;
      if (emo.mexer === "rir") alvo.aa = 0.25 + Math.abs(Math.sin(t * 9)) * 0.35;
      Object.assign(alvo, pesosExtra);
      // piscar (de 2 a 6 s)
      const pis = this.piscar;
      if (agora > pis.proximo) { pis.fase = 1; pis.inicio = agora; pis.mostrou = false; pis.proximo = agora + 2000 + Math.random() * 4000; }
      if (pis.fase) {
        // cada piscada aparece em pelo menos um quadro (num aparelho lento, um quadro pode durar mais que a piscada)
        const q = (agora - pis.inicio) / 150;
        if (q >= 1 && pis.mostrou) pis.fase = 0;
        else { alvo.blink = Math.max(alvo.blink || 0, pis.mostrou ? Math.sin(Math.PI * Math.min(q, 1)) : 1); pis.mostrou = true; }
      }
      // boca com a voz
      this.fala = misturar(this.fala, this.falaAlvo, Math.min(1, dt * 20));
      if (this.fala > 0.02) { alvo.aa = Math.max(alvo.aa || 0, this.fala * 0.9); alvo.oh = this.fala * 0.3 * Math.abs(Math.sin(t * 7)); }
      const em = vrm.expressionManager;
      if (em) {
        const vel = Math.min(1, dt * 8);
        for (const n of this.disponiveis) {
          if (!PRESETS.has(n)) continue;
          const rapido = n === "blink" || n === "blinkLeft" || n === "aa" || n === "oh";
          this.pesos[n] = rapido ? (alvo[n] || 0) : misturar(this.pesos[n] || 0, alvo[n] || 0, vel);
          em.setValue(n, this.pesos[n]);
        }
        for (const [n, x] of this.expressoes) {
          x.peso = misturar(x.peso, x.alvo, vel);
          em.setValue(n, x.peso);
        }
      }
    }

    // ── tela ↔ modelo (para os toques e os efeitos): no 3D, frações do palco
    paraTela(v) {
      if (!v) return null;
      const q = v.clone().project(this.camera);
      return { x: (q.x + 1) / 2 * this.conteiner.clientWidth, y: (1 - q.y) / 2 * this.conteiner.clientHeight };
    }
    paraModelo(x, y) { return this.modelo ? { x: x / this.conteiner.clientWidth, y: y / this.conteiner.clientHeight } : null; }
    deModelo(nx, ny) { return { x: nx * this.conteiner.clientWidth, y: ny * this.conteiner.clientHeight }; }

    /** As áreas de toque agora, a partir dos ossos (frações do palco). */
    zonasAtuais() {
      if (!this.vrm || !this.medidas) return [];
      const T = window.THREE, a = this.altura, W = this.conteiner.clientWidth, H = this.conteiner.clientHeight;
      const ret = (c, hw, hh) => {
        if (!c) return null;
        const pts = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].map(([dx, dy]) => this.paraTela(new T.Vector3(c.x + dx, c.y + dy, c.z)));
        const xs = pts.map((p) => p.x / W), ys = pts.map((p) => p.y / H);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      };
      const pos = (n) => this.posicao(n);
      const cab = pos("head");
      if (!cab) return [];
      const topo = cab.y + a * 0.12, centro = cab.y + a * 0.06;
      const em = (x, y, z) => new T.Vector3(x, y, z);
      const zonas = [
        ["chapeu", "Chapéu / topo", [ret(em(cab.x, topo - a * 0.005, cab.z), a * 0.08, a * 0.02)]],
        ["cabeca", "Cabeça", [ret(em(cab.x, topo - a * 0.04, cab.z), a * 0.075, a * 0.02)]],
        ["orelhas", "Orelhas", [ret(em(cab.x - a * 0.068, centro, cab.z), a * 0.016, a * 0.03), ret(em(cab.x + a * 0.068, centro, cab.z), a * 0.016, a * 0.03)]],
        ["rosto", "Rosto e bochechas", [ret(em(cab.x, cab.y + a * 0.035, cab.z + a * 0.03), a * 0.05, a * 0.035)]],
        ["ombros", "Ombros e braços", [ret(pos("leftUpperArm"), a * 0.035, a * 0.035), ret(pos("rightUpperArm"), a * 0.035, a * 0.035)]],
        ["maos", "Mãos", [ret(pos("leftHand"), a * 0.045, a * 0.045), ret(pos("rightHand"), a * 0.045, a * 0.045)]],
        ["barriga", "Barriga (cócegas)", [ret(pos("spine") && em(pos("spine").x, pos("spine").y + a * 0.01, pos("spine").z + a * 0.04), a * 0.06, a * 0.035)]],
        ["pes", "Pés (cócegas)", [ret(pos("leftFoot"), a * 0.05, a * 0.035), ret(pos("rightFoot"), a * 0.05, a * 0.035)]],
      ];
      return zonas.map(([id, nome, rets]) => ({ id, nome, rets: rets.filter(Boolean) })).filter((z) => z.rets.length);
    }

    foto() { this.renderer.render(this.cena, this.camera); return new Promise((ok) => this.view.toBlob(ok, "image/png")); }
  }
  C.Palco3D = Palco3D;

  // ── Ler um .vrm: nome, autor e licença (do próprio arquivo) ──────────

  /** Lê o JSON de dentro do .vrm (é um .glb) e devolve {nome, autor, versao, redistribuir, licenca, miniatura}. */
  C.lerMetaVRM = async function (blob) {
    const cab = new DataView(await blob.slice(0, 20).arrayBuffer());
    if (cab.getUint32(0, true) !== 0x46546c67) throw new Error("Esse arquivo não é um .vrm (nem um .glb).");
    const tam = cab.getUint32(12, true);
    const j = JSON.parse(await blob.slice(20, 20 + tam).text());
    const ext = j.extensions || {};
    const v1 = ext.VRMC_vrm, v0 = ext.VRM;
    if (!v1 && !v0) throw new Error("Esse .glb não é um VRM (falta a parte de personagem que o VRoid Studio grava).");
    const m = (v1 ? v1.meta : v0.meta) || {};
    const nome = m.name || m.title || "";
    const autor = (m.authors || []).join(", ") || m.author || "";
    const redistribuir = v1 ? m.allowRedistribution !== false && m.modification !== "prohibited" : !/Redistribution_Prohibited/i.test(m.licenseName || "");
    return { nome, autor, versao: v1 ? "1.0" : "0.x", redistribuir, licenca: m.licenseUrl || m.licenseName || m.otherLicenseUrl || "",
      materiais: (j.materials || []).map((x) => nomePeca(x.name)) };
  };
})();
