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
 * A pose de cada quadro é montada em camadas, num "espaço canônico" (o do VRM 1.0: a personagem olha para +Z, o
 * braço esquerdo aponta para +X e, na pose em T, todos os ossos têm rotação zero):
 *
 *   descanso (braços para baixo) → movimento tocando (pacote .vrma/.fbx/.bvh ou o andar do cenário) → captura de
 *   movimento (câmera) → emoção e gestos (somados) → ajuste do esqueleto (correção por osso) → ossos do modelo.
 *
 * Os VRM 0.x (os do VRoid Studio "estável") olham para −Z e têm o braço esquerdo em −X; o three-vrm vira o modelo
 * inteiro, mas as rotações dos ossos continuam espelhadas. Por isso a pose só é convertida no fim (gravarPose):
 * antes, os braços desses modelos iam para CIMA em vez de para baixo, e a cabeça e o tronco inclinavam ao contrário.
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
  C.PRESETS_VRM = PRESETS;
  /** Materiais que são roupa (nomes do VRoid: Tops_01_CLOTH, Bottoms, Onepiece, Shoes, Accessory...) e os que não são. */
  const ROUPA = /cloth|tops|bottoms|onepiece|shoes|socks|accessor|acc_|gloves|hat|wing|pannier|skirt|dress|jacket|coat|ribbon|bag|roupa|outfit|costume/i;
  const NAO_ROUPA = /skin|hair|face|eye|brow|mouth|lash|tooth|teeth/i;
  /** "N00_000_00_Tops_01_CLOTH (Instance)" → "Tops_01_CLOTH" */
  const nomePeca = (n) => String(n || "").replace(/\s*\((Instance|Outline)\)/gi, "").replace(/^N\d+_\d+_\d+_/, "").trim();
  C.nomePeca = nomePeca;
  const ehCelular = () => (window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  /** Rotação zero (para os ossos sem pose de descanso). */
  const IDENT = { x: 0, y: 0, z: 0, w: 1, isQuaternion: true };

  // ── Esqueleto humanoide (nomes do VRM 1.0) ──────────────────────────
  const DEDOS = ["Thumb", "Index", "Middle", "Ring", "Little"];
  const PAIS = { hips: null, spine: "hips", chest: "spine", upperChest: "chest", neck: "upperChest", head: "neck" };
  for (const l of ["left", "right"]) {
    Object.assign(PAIS, { [l + "UpperLeg"]: "hips", [l + "LowerLeg"]: l + "UpperLeg", [l + "Foot"]: l + "LowerLeg", [l + "Toes"]: l + "Foot",
      [l + "Shoulder"]: "upperChest", [l + "UpperArm"]: l + "Shoulder", [l + "LowerArm"]: l + "UpperArm", [l + "Hand"]: l + "LowerArm" });
    for (const d of DEDOS) {
      const partes = d === "Thumb" ? ["Metacarpal", "Proximal", "Distal"] : ["Proximal", "Intermediate", "Distal"];
      partes.forEach((parte, i) => { PAIS[l + d + parte] = i ? l + d + partes[i - 1] : l + "Hand"; });
    }
  }
  /** Os ossos que a pose mexe, com os pais antes dos filhos (os olhos ficam com o lookAt do VRM). */
  const OSSOS = Object.keys(PAIS);
  C.OSSOS_VRM = OSSOS;
  C.PAIS_VRM = PAIS;
  C.DEDOS_VRM = DEDOS;
  /** O osso do outro lado (leftHand ↔ rightHand); os do meio devolvem o próprio nome. */
  C.ossoEspelhado = (n) => (n.startsWith("left") ? "right" + n.slice(4) : n.startsWith("right") ? "left" + n.slice(5) : n);

  /**
   * Pose de descanso no espaço canônico: braços para baixo (bracos = ângulo em radianos a partir da pose em T),
   * cotovelos e dedos um pouco dobrados. Devolve {osso: Quaternion}; os ossos fora da lista ficam sem rotação.
   */
  C.poseDescanso = function (bracos = 1.2) {
    const T = window.THREE, p = {};
    const q = (x, y, z) => new T.Quaternion().setFromEuler(new T.Euler(x, y, z));
    for (const [l, s] of [["left", 1], ["right", -1]]) { // s: o lado direito é o espelho (y e z trocam de sinal)
      p[l + "UpperArm"] = q(0, 0, -bracos * s);
      p[l + "LowerArm"] = q(0, -0.22 * s, 0);
      for (const d of DEDOS.slice(1)) {
        p[l + d + "Proximal"] = q(0, 0, -0.22 * s);
        p[l + d + "Intermediate"] = q(0, 0, -0.3 * s);
        p[l + d + "Distal"] = q(0, 0, -0.18 * s);
      }
      p[l + "ThumbProximal"] = q(0, 0.18 * s, 0);
      p[l + "ThumbDistal"] = q(0, 0.14 * s, 0);
    }
    return p;
  };

  /** Ajuste do esqueleto que cada personagem pode guardar (Movimento › Ajustar esqueleto). */
  C.ajustePadrao = () => ({ bracos: 69, ossos: {}, escala: { geral: 1, cabeca: 1, bracos: 1, pernas: 1, maos: 1 } });

  /**
   * Toca movimentos (AnimationClip no espaço canônico: "<osso>.quaternion", "hips.position" em alturas do quadril
   * e "expr.<expressão>") em ossos de mentira; o palco lê esses ossos a cada quadro e mistura com o resto da pose.
   * Assim o mesmo movimento serve para qualquer personagem, e trocar de roupa não interrompe a dança.
   */
  class Animador {
    constructor() {
      const T = window.THREE;
      this.raiz = new T.Object3D();
      this.nos = {};
      for (const n of OSSOS) { const o = new T.Object3D(); o.name = n; this.raiz.add(o); this.nos[n] = o; }
      this.expr = new T.Object3D();
      this.expr.name = "expr";
      for (const n of PRESETS) this.expr[n] = 0;
      this.raiz.add(this.expr);
      this.mixer = new T.AnimationMixer(this.raiz);
      this.mixer.addEventListener("finished", (e) => {
        if (e.action !== this.acao) return;
        this.alvo = 0;
        this.transicao = 0.4;
        if (this.aoTerminar) this.aoTerminar(this.info);
      });
      this.acao = null;
      this.info = null;     // quem pediu: {tipo: "movimento" | "andar", id, nome}
      this.peso = 0;        // quanto o movimento vale na pose (0 = só o descanso)
      this.alvo = 0;
      this.transicao = 0.3;
      this.noLugar = false; // movimentos de andar: o quadril não sai do lugar (quem anda é o cenário)
      this.aoTerminar = null;
      this.opcoes = null;
    }
    /** A pose em que os ossos ficam quando o movimento não mexe neles (os dedos, em muitos pacotes). */
    definirDescanso(descanso) {
      const acao = this.acao, clip = acao && acao.getClip(), tempo = acao ? acao.time : 0, opcoes = this.opcoes, tocava = this.alvo > 0;
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.raiz);
      for (const n of OSSOS) {
        if (descanso[n]) this.nos[n].quaternion.copy(descanso[n]); else this.nos[n].quaternion.identity();
        this.nos[n].position.set(0, 0, 0);
      }
      this.acao = null;
      if (clip && tocava) { this.tocar(clip, { ...opcoes, transicao: 0 }); this.acao.time = tempo; }
    }
    tocar(clip, { repetir = true, velocidade = 1, transicao = 0.3, noLugar = false, info = null } = {}) {
      const T = window.THREE;
      const acao = this.mixer.clipAction(clip);
      const anterior = this.acao;
      this.opcoes = { repetir, velocidade, noLugar, info };
      acao.reset();
      acao.setLoop(repetir ? T.LoopRepeat : T.LoopOnce, Infinity);
      acao.clampWhenFinished = true;
      acao.timeScale = velocidade;
      acao.setEffectiveWeight(1);
      if (anterior && anterior !== acao && this.peso > 0.01 && transicao > 0) { acao.play(); anterior.crossFadeTo(acao, transicao, false); }
      else { if (anterior && anterior !== acao) anterior.stop(); acao.play(); }
      this.acao = acao;
      this.info = info;
      this.noLugar = noLugar;
      this.alvo = 1;
      this.transicao = transicao;
      if (!transicao) this.peso = 1;
      return acao;
    }
    parar(transicao = 0.3) {
      this.alvo = 0;
      this.transicao = transicao;
      if (!transicao) { this.peso = 0; this.mixer.stopAllAction(); this.acao = null; this.info = null; }
    }
    get tocando() { return !!this.acao && this.alvo > 0; }
    get tempo() { return this.acao ? this.acao.time : 0; }
    definirVelocidade(v) { if (this.acao) this.acao.timeScale = v; if (this.opcoes) this.opcoes.velocidade = v; }
    atualizar(dt) {
      this.mixer.update(dt);
      const passo = this.transicao > 0 ? dt / this.transicao : 1;
      this.peso = this.alvo > this.peso ? Math.min(this.alvo, this.peso + passo) : Math.max(this.alvo, this.peso - passo);
      if (this.peso <= 0 && this.acao && this.alvo <= 0) { this.mixer.stopAllAction(); this.acao = null; this.info = null; }
    }
  }
  C.Animador = Animador;

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
      this.disponiveis = new Set();
      this.apelidos = {};
      this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.view = this.renderer.domElement;
      this.view.classList.add("palco-canvas", "palco-3d");
      conteiner.append(this.view);
      this.cena = new T.Scene();
      this.camera = new T.PerspectiveCamera(30, 1, 0.05, 400);
      const luz = new T.DirectionalLight(0xffffff, Math.PI * 0.9);
      luz.position.set(1, 1.5, 2);
      this.luz = luz;
      this.cena.add(luz, new T.HemisphereLight(0xffffff, 0x8888aa, 0.9));
      // onde a personagem está: no retrato fica parada na origem (ou no ponto de partida do cenário); no cenário, anda
      this.raiz = new T.Group();
      this.cena.add(this.raiz);
      this.alvoOlhar = new T.Object3D();
      this.cena.add(this.alvoOlhar);
      this.relogio = new T.Clock();
      this.v = new T.Vector3();
      // pose (espaço canônico), movimentos, ajuste do esqueleto, captura e cenário
      this.pose = {};
      for (const n of OSSOS) this.pose[n] = new T.Quaternion();
      this.quadrilDesl = new T.Vector3(); // quanto o quadril sai do lugar neste quadro (metros, canônico)
      this.nos = {};
      this.repouso = {};                  // posição de cada osso em relação ao pai, na pose em T (canônico)
      this.brutos = {};
      this.v0 = false;
      this.ajuste = C.ajustePadrao();
      this.ajusteQ = new Map();
      this.descanso = C.poseDescanso(1.2);
      this.erguer = 0;
      this.alturaQuadril = 0.9;
      this.peDescanso = -0.9;
      this.altura = 1.5;
      this.anim = new Animador();
      this.anim.definirDescanso(this.descanso);
      this.anim.aoTerminar = (info) => this.emit("movimento-terminou", info);
      this.captura = null;                // C.Captura ligada (a tela põe aqui)
      this.rastreado = null;
      this.morfos = new Map();            // formas do rosto fora das expressões (VRoid: Fcl_BRW_*, Fcl_MTH_*...)
      this.aproximar = 0;
      this._q = new T.Quaternion();
      this._q2 = new T.Quaternion();
      this._e = new T.Euler();
      this._v = new T.Vector3();
      this.view.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.emit("placa-perdida"); });
      this.view.addEventListener("webglcontextrestored", () => this.emit("placa-voltou"));
      new ResizeObserver(() => this.redimensionar()).observe(conteiner);
      this.redimensionar();
      this.toques = new C.Toques(this);
      // as áreas de toque seguem os ossos: calculadas na hora (o editor de áreas não vale para personagens 3D)
      Object.defineProperty(this.toques, "zonas", { get: () => this.zonasAtuais(), set: () => {} });
      this.mundo = C.Mundo ? new C.Mundo(this) : null; // cenário e andar (js/mundo.js)
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
     * roupaAtual, emocoes, ativas, enquadramento, qualidade, esqueleto}.
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
      this.v0 = !!(vrm.meta && vrm.meta.metaVersion === "0");
      this.raiz.add(vrm.scene);
      this.reduzirTexturas(this.limiteTextura(p.qualidade || "auto"));
      if (vrm.lookAt) vrm.lookAt.target = this.alvoOlhar;
      // expressões: as padrão viram emoções; as próprias do modelo viram atalhos (como no Live2D)
      const em = vrm.expressionManager;
      const nomes = em ? em.expressions.map((e) => e.expressionName) : [];
      this.disponiveis = new Set(nomes);
      // um modelo pode trazer uma expressão padrão com outro nome (no VRM 0.x do VRoid, "Surprised" vem como própria)
      this.apelidos = {};
      for (const n of nomes) {
        const padrao = [...PRESETS].find((x) => x.toLowerCase() === n.toLowerCase() && x !== n);
        if (padrao && !this.disponiveis.has(padrao)) this.apelidos[padrao] = n;
      }
      const apelidadas = new Set(Object.values(this.apelidos));
      this.expressoes.clear();
      this.pesos = {};
      for (const n of nomes) if (!PRESETS.has(n) && !apelidadas.has(n)) this.expressoes.set(n, { alvo: 0, peso: 0, emocao: false, params: [n] });
      for (const n of p.ativas || []) if (this.expressoes.has(n)) Object.assign(this.expressoes.get(n), { alvo: 1, peso: 1 });
      this.acharMorfos(gltf);
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
      // esqueleto: os ossos, as medidas na pose em T, o ajuste guardado e a pose de descanso (braços para baixo)
      this.lerEsqueleto();
      this.definirAjuste(p.esqueleto || null, { medir: false });
      if (this.mundo) this.mundo.aoCarregar();
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
      this.mostrarEsqueleto(false);
      if (this.vrm) {
        this.raiz.remove(this.vrm.scene);
        try { window.CompanhiaVRM.VRMUtils.deepDispose(this.vrm.scene); } catch (e) { /* já foi */ }
      }
      this.vrm = null;
      this.modelo = null;
      this.gestos = [];
      this.pecas = [];
      this.nos = {};
      this.morfos = new Map();
      this.rastreado = null;
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
    ossoBruto(nome) { return this.vrm && this.vrm.humanoid ? this.vrm.humanoid.getRawBoneNode(nome) : null; }
    posicao(nome, alvo) {
      const b = this.ossoBruto(nome);
      return b ? b.getWorldPosition(alvo || new window.THREE.Vector3()) : null;
    }
    /** Os ossos deste modelo e onde cada um fica em relação ao pai na pose em T, já no espaço canônico. */
    lerEsqueleto() {
      const T = window.THREE, h = this.vrm.humanoid, s = this.v0 ? -1 : 1;
      this.nos = {};
      this.repouso = {};
      this.brutos = {};
      if (!h) return;
      h.resetNormalizedPose();
      for (const n of OSSOS) {
        const no = h.getNormalizedBoneNode(n);
        if (!no) continue;
        this.nos[n] = no;
        this.repouso[n] = new T.Vector3(no.position.x * s, no.position.y, no.position.z * s);
        const bruto = h.getRawBoneNode(n);
        if (bruto) this.brutos[n] = bruto.scale.clone(); // tamanho original (para as proporções)
      }
      this.hipsBase = this.nos.hips ? this.nos.hips.position.clone() : new T.Vector3(0, 0.9, 0);
      this.alturaQuadril = Math.max(0.05, this.hipsBase.y);
      // ossos que este modelo não tem (upperChest, ombros...): o giro deles passa para os filhos
      this.ausentes = OSSOS.filter((n) => !this.nos[n]).map((n) => [n, OSSOS.filter((f) => PAIS[f] === n)]).filter(([, filhos]) => filhos.length);
    }
    /** O pai de um osso neste modelo (pula os que o modelo não tem, como o upperChest). */
    paiDe(nome) { let p = PAIS[nome]; while (p && !this.nos[p]) p = PAIS[p]; return p || null; }
    /** Direção (canônica) em que um osso aponta na pose em T: do osso para o filho (ou a do próprio osso, na ponta). */
    direcaoDescanso(nome, alvo) {
      const v = alvo || new window.THREE.Vector3();
      const filho = OSSOS.find((n) => this.nos[n] && this.paiDe(n) === nome && (!/Hand$/.test(nome) || /Middle/.test(n)) && !/Shoulder|UpperLeg/.test(n));
      if (filho && this.repouso[filho].lengthSq() > 1e-10) return v.copy(this.repouso[filho]).normalize();
      if (this.repouso[nome] && this.repouso[nome].lengthSq() > 1e-10 && PAIS[nome]) return v.copy(this.repouso[nome]).normalize();
      return v.set(0, 1, 0);
    }
    /** Rotação de um osso no mundo canônico (a pose do quadro, de cima para baixo na cadeia). */
    rotacaoCanonica(nome, alvo) {
      const q = alvo || new window.THREE.Quaternion();
      q.copy(this.pose[nome]);
      for (let p = this.paiDe(nome); p; p = this.paiDe(p)) q.premultiply(this.pose[p]);
      return q;
    }
    /** Altura (canônica, em relação ao quadril) do ponto mais baixo dos pés na pose dada. */
    peMaisBaixo(pose) {
      const T = window.THREE, q = this._q2, v = this._v;
      const esc = (this.ajuste.escala && this.ajuste.escala.pernas) || 1;
      let menor = Infinity;
      for (const l of ["left", "right"]) {
        const cadeia = [l + "UpperLeg", l + "LowerLeg", l + "Foot", l + "Toes"].filter((n) => this.nos[n]);
        const pos = new T.Vector3();
        q.copy(pose.hips || IDENT);
        cadeia.forEach((n, i) => {
          pos.add(v.copy(this.repouso[n]).multiplyScalar(i ? esc : 1).applyQuaternion(q));
          q.multiply(pose[n] || IDENT);
          if (i >= 2) menor = Math.min(menor, pos.y);
        });
      }
      return Number.isFinite(menor) ? menor : -this.alturaQuadril;
    }

    /**
     * Ajuste do esqueleto: ângulo dos braços em descanso (graus a partir da pose em T), correção de rotação por osso
     * (graus, eixos X/Y/Z do corpo) e proporções (altura, cabeça, braços, pernas e mãos). Vale por cima de tudo:
     * do descanso, dos pacotes de movimento e da captura.
     */
    definirAjuste(a, { medir = true } = {}) {
      const T = window.THREE, padrao = C.ajustePadrao();
      a = a || {};
      this.ajuste = { bracos: Number.isFinite(+a.bracos) && a.bracos !== null && a.bracos !== "" ? limitar(+a.bracos, 0, 90) : padrao.bracos,
        ossos: { ...(a.ossos || {}) }, escala: Object.assign(padrao.escala, a.escala || {}) };
      this.descanso = C.poseDescanso(this.ajuste.bracos * Math.PI / 180);
      this.anim.definirDescanso(this.descanso);
      this.ajusteQ = new Map();
      for (const [n, r] of Object.entries(this.ajuste.ossos)) {
        if (!r || !(r[0] || r[1] || r[2])) continue;
        this.ajusteQ.set(n, new T.Quaternion().setFromEuler(new T.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180)));
      }
      const e = this.ajuste.escala;
      for (const k of Object.keys(e)) e[k] = limitar(+e[k] || 1, 0.3, 3);
      if (!this.vrm) return;
      // proporções: mexem no tamanho dos ossos do próprio modelo
      const por = (n, k) => { const o = this.ossoBruto(n); if (o && this.brutos[n]) o.scale.copy(this.brutos[n]).multiplyScalar(k); };
      this.vrm.scene.scale.setScalar(e.geral);
      por("head", e.cabeca);
      for (const l of ["left", "right"]) { por(l + "UpperArm", e.bracos); por(l + "Hand", e.maos / e.bracos); por(l + "UpperLeg", e.pernas); }
      // pernas mais compridas: o quadril sobe para os pés continuarem no chão
      const coxa = this.repouso.leftUpperLeg || this.repouso.rightUpperLeg;
      this.erguer = coxa ? (e.pernas - 1) * Math.max(0, this.alturaQuadril + coxa.y) : 0;
      this.peDescanso = this.peMaisBaixo({});
      const molas = this.vrm.springBoneManager;
      if (molas) { try { molas.reset(); molas.setInitState(); } catch (err) { /* modelo sem molas */ } }
      if (medir) { this.poseBase(); this.vrm.update(0); this.medir(); this.enquadrar(); }
    }

    /** Põe o modelo na pose de descanso (sem movimento, captura nem gestos): a base das medidas. */
    poseBase() {
      if (!this.vrm || !this.vrm.humanoid) return;
      for (const n of OSSOS) this.pose[n].copy(this.descanso[n] || IDENT);
      this.quadrilDesl.set(0, 0, 0);
      for (const [n, q] of this.ajusteQ) if (this.pose[n]) this.pose[n].premultiply(q);
      this.gravarPose();
    }
    /** Passa a pose (canônica) para os ossos do modelo; nos VRM 0.x, x e z trocam de sinal. */
    gravarPose() {
      const s = this.v0 ? -1 : 1, pose = this.pose;
      for (const [n, filhos] of this.ausentes || []) for (const f of filhos) pose[f].premultiply(pose[n]);
      for (const n of OSSOS) {
        const b = this.nos[n];
        if (!b) continue;
        const q = pose[n];
        b.quaternion.set(q.x * s, q.y, q.z * s, q.w);
      }
      const h = this.nos.hips, d = this.quadrilDesl;
      if (h && this.hipsBase) h.position.set(this.hipsBase.x + d.x * s, this.hipsBase.y + d.y + this.erguer, this.hipsBase.z + d.z * s);
    }
    medir() {
      const T = window.THREE;
      // em relação a onde a personagem está (no cenário ela pode estar longe da origem)
      this.raiz.updateWorldMatrix(true, true);
      const local = (n, padrao) => { const p = this.posicao(n); return p ? this.raiz.worldToLocal(p) : padrao; };
      const cab = local("head", new T.Vector3(0, 1.4, 0));
      const pe = local("leftFoot", new T.Vector3(0, 0.05, 0));
      const quadril = local("hips", new T.Vector3(0, 0.85, 0));
      this.altura = Math.max(0.5, cab.y - pe.y + 0.1);
      this.medidas = { cabecaY: cab.y, peY: Math.min(pe.y, 0), quadrilY: quadril.y, topo: cab.y + this.altura * 0.12, x: cab.x, z: cab.z };
    }

    // ── esqueleto à mostra (para o ajuste)
    mostrarEsqueleto(sim) {
      const T = window.THREE;
      if (this.ajudante) { this.cena.remove(this.ajudante); this.ajudante.dispose(); this.ajudante = null; }
      if (this.marca) { this.cena.remove(this.marca); this.marca.geometry.dispose(); this.marca.material.dispose(); this.marca = null; }
      this.ossoMarcado = null;
      if (!sim || !this.vrm) return;
      const raizOssos = this.ossoBruto("hips");
      if (!raizOssos) return;
      this.ajudante = new T.SkeletonHelper(raizOssos.parent || raizOssos);
      this.ajudante.material.depthTest = false;
      this.ajudante.material.transparent = true;
      this.ajudante.renderOrder = 10;
      this.marca = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshBasicMaterial({ color: 0xffcc00, depthTest: false, transparent: true, opacity: 0.9 }));
      this.marca.renderOrder = 11;
      this.marca.visible = false;
      this.cena.add(this.ajudante, this.marca);
    }
    destacarOsso(nome) { this.ossoMarcado = nome || null; }

    // ── enquadramento (retrato): a câmera fica de frente para a personagem, onde ela estiver
    enquadrar() {
      if (!this.medidas) { this.emit("enquadrado"); return; }
      const m = this.medidas, e = this.enquadramento, T = window.THREE;
      let cy, alto;
      if (e.modo === "rosto") { cy = m.cabecaY + this.altura * 0.05; alto = this.altura * 0.26; }
      else if (e.modo === "corpo") { cy = (m.topo + m.peY) / 2; alto = (m.topo - m.peY) * 1.08; }
      else { cy = (m.topo + m.quadrilY) / 2 + this.altura * 0.02; alto = (m.topo - m.quadrilY) * 1.35; }
      const meiaFov = T.MathUtils.degToRad(30 / 2);
      const largura = alto * (e.modo === "corpo" ? 0.55 : 0.75);
      let dist = Math.max((alto / 2) / Math.tan(meiaFov), (largura / 2) / (Math.tan(meiaFov) * this.camera.aspect));
      dist /= e.zoom || 1;
      this.distBase = dist;
      this.alvoLocal = new T.Vector3(m.x - (e.dx || 0) * alto, cy - (e.dy || 0) * alto, m.z);
      if (!(this.mundo && this.mundo.andando)) this.cameraRetrato(this.aproximar);
      this.emit("enquadrado");
    }
    /** Põe a câmera do retrato (aproximar: 0 a 1, o gesto de chegar perto). */
    cameraRetrato(aproximar) {
      if (!this.alvoLocal) return;
      if (this.camera.fov !== 30) { this.camera.fov = 30; this.camera.updateProjectionMatrix(); }
      this.raiz.updateWorldMatrix(true, false);
      this.alvoCam = this.raiz.localToWorld(this._v.copy(this.alvoLocal)).clone();
      this.camera.position.copy(this.raiz.localToWorld(this._v.set(this.alvoLocal.x, this.alvoLocal.y, this.alvoLocal.z + this.distBase * (1 - aproximar))));
      this.camera.lookAt(this.alvoCam);
      // a luz acompanha a frente da personagem
      this.luz.position.copy(this.raiz.localToWorld(this._v.set(1, 1.5, 2)));
      this.luz.target.position.copy(this.raiz.position);
      this.luz.target.updateMatrixWorld();
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
      if (nome === "pular" && this.mundo && this.mundo.andando) this.mundo.pular();
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
    expressao(nome) { return this.vrm && this.vrm.expressionManager ? this.vrm.expressionManager.getValue(this.apelidos[nome] || nome) : null; }

    // ── movimentos (pacotes)
    /** Toca um movimento (AnimationClip canônico, de C.movimentos). */
    tocarMovimento(clip, opcoes = {}) {
      const acao = this.anim.tocar(clip, opcoes);
      this.emit("movimento", this.anim.info);
      return acao;
    }
    pararMovimento(transicao = 0.3) { this.anim.parar(transicao); this.emit("movimento", null); }

    // ── formas do rosto fora das expressões (para a captura: sobrancelhas, sorriso da boca...)
    acharMorfos(gltf) {
      this.morfos = new Map();
      const json = gltf.parser && gltf.parser.json;
      if (!json) return;
      const nomesDe = (malha) => (malha && ((malha.extras && malha.extras.targetNames) || (malha.primitives[0] && malha.primitives[0].extras && malha.primitives[0].extras.targetNames))) || [];
      // as que alguma expressão do VRM já usa ficam com o gerente de expressões (ele zera e soma a cada quadro)
      const usadas = new Set();
      const ext = json.extensions || {};
      if (ext.VRM && ext.VRM.blendShapeMaster) {
        for (const g of ext.VRM.blendShapeMaster.blendShapeGroups || []) for (const b of g.binds || []) usadas.add(nomesDe(json.meshes[b.mesh])[b.index]);
      }
      if (ext.VRMC_vrm && ext.VRMC_vrm.expressions) {
        for (const grupo of [ext.VRMC_vrm.expressions.preset || {}, ext.VRMC_vrm.expressions.custom || {}]) {
          for (const e of Object.values(grupo)) for (const b of e.morphTargetBinds || []) usadas.add(nomesDe(json.meshes[(json.nodes[b.node] || {}).mesh])[b.index]);
        }
      }
      // os nomes das formas vêm do JSON do arquivo (o VRM 0.x guarda nos "primitives", que o three.js não lê)
      const origem = gltf.parser.associations;
      this.vrm.scene.traverse((o) => {
        if (!o.isMesh || !o.morphTargetInfluences) return;
        const de = origem && origem.get(o);
        const nomes = de && de.meshes !== undefined ? nomesDe(json.meshes[de.meshes]) : [];
        const porIndice = nomes.length ? nomes : Object.keys(o.morphTargetDictionary || {});
        for (let i = 0; i < o.morphTargetInfluences.length; i++) {
          const nome = porIndice[i];
          if (!nome || usadas.has(nome)) continue;
          const curto = nome.replace(/^.*\./, ""); // "Face_Blendshape.Fcl_BRW_Angry" → "Fcl_BRW_Angry"
          if (!this.morfos.has(curto)) this.morfos.set(curto, []);
          this.morfos.get(curto).push([o, i]);
        }
      });
    }
    definirMorfo(nome, valor) { const l = this.morfos.get(nome); if (l) for (const [malha, i] of l) malha.morphTargetInfluences[i] = valor; return !!l; }

    // ── a cada quadro
    quadro() {
      const dt = Math.min(0.1, this.relogio.getDelta());
      const vrm = this.vrm;
      if (this.mundo) { try { this.mundo.atualizar(dt); } catch (e) { console.error(e); } }
      if (vrm) {
        try { this.animar(dt); vrm.update(dt); this.depois(); } catch (e) { console.error(e); }
      }
      if (this.mundo && this.mundo.andando) { try { this.mundo.camera(dt); } catch (e) { console.error(e); } }
      this.renderer.render(this.cena, this.camera);
    }
    animar(dt) {
      const vrm = this.vrm, t = performance.now() / 1000, agora = performance.now();
      const emo = C.EMOCOES[this.emocao] || C.EMOCOES.neutra, k = this.intensidade;
      const pose = this.pose, an = this.anim, mundo = this.mundo;
      const andando = !!(mundo && mundo.andando);
      // 1. descanso
      for (const n of OSSOS) pose[n].copy(this.descanso[n] || IDENT);
      this.quadrilDesl.set(0, 0, 0);
      // 2. movimento tocando (pacote, ou o andar/correr/pular do cenário)
      an.atualizar(dt);
      let pesoMov = an.peso;
      if (pesoMov > 0.001) {
        for (const n of OSSOS) pose[n].slerp(an.nos[n].quaternion, pesoMov);
        const hp = an.nos.hips.position;
        this.quadrilDesl.set(an.noLugar ? 0 : hp.x, hp.y, an.noLugar ? 0 : hp.z).multiplyScalar(this.alturaQuadril * pesoMov);
      }
      if (andando) pesoMov = Math.max(pesoMov, mundo.posar(pose, this.quadrilDesl, dt, pesoMov));
      // 3. captura de movimento (câmera)
      const cap = this.captura && this.captura.ativa ? this.captura : null;
      const ras = (this.rastreado = cap ? cap.aplicar(pose, dt, this) : null);
      if (ras && ras.pernas) this.quadrilDesl.y += (this.peDescanso - this.peMaisBaixo(pose)) * ras.pernas; // os pés ficam no chão
      // 4. emoção e gestos (somados por cima)
      const post = POSTURA[this.emocao] || {};
      const leve = 1 - 0.75 * Math.min(1, pesoMov); // com um movimento tocando, a postura da emoção fica discreta
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
      if (emo.mexer === "pular" && !andando) pulo = Math.max(0, Math.sin(t * 6)) * 0.015;
      if (emo.postura === "subir" && !andando) pulo += 0.02 * k * Math.max(0, 1 - fase * 1.5);
      // olhar: ponteiro (se mexeu há pouco) ou passeia
      const ol = this.olhar;
      if (agora - ol.ultimo > 5000 || andando) { ol.alvoX = Math.sin(t * 0.21) * 0.3; ol.alvoY = Math.sin(t * 0.17) * 0.15; }
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
          case "pular": if (!andando) pulo += Math.abs(Math.sin(p * Math.PI * 2)) * 0.06; break;
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
      // soma nos ossos (rotações pequenas, no eixo do próprio osso); o que a captura comanda não recebe
      const somar = (n, x, y, z) => { if (this.nos[n]) pose[n].multiply(this._q.setFromEuler(this._e.set(x, y, z))); };
      if (!(ras && ras.tronco)) {
        somar("spine", troncoX * 0.5 * leve, 0, troncoZ * 0.5 * leve);
        somar("chest", troncoX * 0.5 * leve, 0, troncoZ * 0.5 * leve);
      }
      if (!(ras && ras.cabeca)) {
        somar("neck", cabX * 0.4 * leve, cabY * 0.4 * leve, cabZ * 0.4 * leve);
        somar("head", cabX * 0.6 * leve, cabY * 0.6 * leve, cabZ * 0.6 * leve);
      }
      if (!(ras && ras.bracos)) {
        somar("leftShoulder", 0, 0, ombros);
        somar("rightShoulder", 0, 0, -ombros);
        if (acenar) {
          // "tchau": braço direito para o lado e para cima, antebraço em pé balançando, a palma para a frente
          pose.rightUpperArm.slerp(this._q.setFromEuler(this._e.set(0, 0, -0.5)), acenar);
          this._q.setFromEuler(this._e.set(0, 0, -1.07 + onda * 0.35)).multiply(this._q2.setFromEuler(this._e.set(-0.8, 0, 0)));
          pose.rightLowerArm.slerp(this._q, acenar);
          pose.rightHand.slerp(this._q.setFromEuler(this._e.set(-0.7, 0, 0)), acenar);
        }
      }
      this.quadrilDesl.y += pulo * this.altura;
      // 5. ajuste do esqueleto (correção por osso, nos eixos do corpo)
      for (const [n, q] of this.ajusteQ) if (pose[n]) pose[n].premultiply(q);
      // 6. ossos do modelo
      this.gravarPose();
      // câmera do retrato: chegar perto
      if (!andando) {
        this.aproximar = misturar(this.aproximar, aproximar, Math.min(1, dt * 8));
        this.cameraRetrato(this.aproximar);
      }
      // olhos: pela captura (a direção dos olhos de quem está na câmera) ou um alvo na frente do rosto
      const cabeca = this.nos.head, s = this.v0 ? -1 : 1;
      if (ras && ras.olhar && cabeca) {
        const gx = ras.olhar.x, gy = ras.olhar.y;
        cabeca.updateWorldMatrix(true, false);
        const dir = this._v.set(Math.sin(gx) * Math.cos(gy) * s, Math.sin(gy), Math.cos(gx) * Math.cos(gy) * s).applyQuaternion(cabeca.getWorldQuaternion(this._q));
        this.posicao("head", this.alvoOlhar.position).addScaledVector(dir, 3);
        this.alvoOlhar.position.y += this.altura * 0.04;
      } else if (andando && cabeca) {
        // andando, a câmera fica atrás: os olhos seguem a frente do rosto
        cabeca.updateWorldMatrix(true, false);
        const dir = this._v.set(olharX * 0.4 * s, ol.y * 0.2, s).applyQuaternion(cabeca.getWorldQuaternion(this._q));
        this.posicao("head", this.alvoOlhar.position).addScaledVector(dir, 3);
      } else {
        const cam = this.camera;
        this.alvoOlhar.position.copy(cam.position).add(this._v.set(olharX * 0.6 * this.altura, ol.y * 0.4 * this.altura, 0).applyQuaternion(cam.quaternion));
      }
      // expressões
      const alvo = {};
      for (const [n, w] of Object.entries(EXPRESSOES[this.emocao] || {})) alvo[n] = w * k;
      if (emo.mexer === "rir") alvo.aa = 0.25 + Math.abs(Math.sin(t * 9)) * 0.35;
      Object.assign(alvo, pesosExtra);
      // as expressões do movimento tocando (os .vrma podem trazer rosto)
      if (an.peso > 0.001) for (const n of PRESETS) { const w = an.expr[n]; if (w > 0.001) alvo[n] = Math.max(alvo[n] || 0, w * an.peso); }
      // piscar (de 2 a 6 s); com o rosto rastreado, quem pisca é a pessoa
      const rosto = ras && ras.rosto;
      const pis = this.piscar;
      if (rosto) {
        pis.fase = 0;
        alvo.blinkLeft = Math.max(alvo.blinkLeft || 0, rosto.expr.blinkLeft || 0);
        alvo.blinkRight = Math.max(alvo.blinkRight || 0, rosto.expr.blinkRight || 0);
        if (!this.disponiveis.has("blinkLeft") || !this.disponiveis.has("blinkRight")) alvo.blink = Math.max(alvo.blink || 0, Math.min(rosto.expr.blinkLeft || 0, rosto.expr.blinkRight || 0));
        for (const n of ["aa", "ih", "ou", "ee", "oh", "happy", "angry", "sad", "surprised"]) if (rosto.expr[n] > 0.001) alvo[n] = Math.max(alvo[n] || 0, rosto.expr[n]);
      } else {
        if (agora > pis.proximo) { pis.fase = 1; pis.inicio = agora; pis.mostrou = false; pis.proximo = agora + 2000 + Math.random() * 4000; }
        if (pis.fase) {
          // cada piscada aparece em pelo menos um quadro (num aparelho lento, um quadro pode durar mais que a piscada)
          const q = (agora - pis.inicio) / 150;
          if (q >= 1 && pis.mostrou) pis.fase = 0;
          else { alvo.blink = Math.max(alvo.blink || 0, pis.mostrou ? Math.sin(Math.PI * Math.min(q, 1)) : 1); pis.mostrou = true; }
        }
      }
      // boca com a voz
      this.fala = misturar(this.fala, this.falaAlvo, Math.min(1, dt * 20));
      if (this.fala > 0.02) { alvo.aa = Math.max(alvo.aa || 0, this.fala * 0.9); alvo.oh = Math.max(alvo.oh || 0, this.fala * 0.3 * Math.abs(Math.sin(t * 7))); }
      const em = vrm.expressionManager;
      if (em) {
        const vel = Math.min(1, dt * 8);
        for (const n of PRESETS) {
          const real = this.apelidos[n] || n;
          if (!this.disponiveis.has(real)) continue;
          const rapido = n === "blink" || n === "blinkLeft" || n === "blinkRight" || n === "aa" || n === "oh" || (rosto && (n === "ih" || n === "ou" || n === "ee"));
          this.pesos[n] = rapido ? (alvo[n] || 0) : misturar(this.pesos[n] || 0, alvo[n] || 0, vel);
          em.setValue(real, this.pesos[n]);
        }
        for (const [n, x] of this.expressoes) {
          x.peso = misturar(x.peso, x.alvo, vel);
          // modelos com as 52 formas do ARKit ("perfect sync"): a captura comanda direto
          const direto = rosto && rosto.arkit ? rosto.arkit[n.charAt(0).toLowerCase() + n.slice(1)] : undefined;
          em.setValue(n, direto === undefined ? x.peso : Math.max(x.peso, direto));
        }
      }
    }
    /** Depois do vrm.update: as formas do rosto que a captura comanda direto e a marca do osso escolhido. */
    depois() {
      const rosto = this.rastreado && this.rastreado.rosto;
      if (rosto && rosto.morfos) {
        for (const [n, v] of Object.entries(rosto.morfos)) this.definirMorfo(n, v);
        this.morfosLigados = true;
      } else if (this.morfosLigados) {
        for (const n of this.morfos.keys()) if (/^Fcl_(BRW|EYE|MTH)_/.test(n)) this.definirMorfo(n, 0);
        this.morfosLigados = false;
      }
      if (this.marca) {
        const p = this.ossoMarcado && this.posicao(this.ossoMarcado, this.marca.position);
        this.marca.visible = !!p;
        if (p) this.marca.scale.setScalar(Math.max(0.006, this.camera.position.distanceTo(p) * 0.012));
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

    /** As áreas de toque agora, a partir dos ossos (frações do palco). Andando pelo cenário, arrastar gira a câmera. */
    zonasAtuais() {
      if (!this.vrm || !this.medidas || (this.mundo && this.mundo.andando)) return [];
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
