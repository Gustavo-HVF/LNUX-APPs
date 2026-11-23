/*
 * WEBC — os itens que a personagem carrega e usa (lanterna, arma de bolhas, varinha, chapéu...). Ver
 * docs/estudio-de-itens.md.
 *
 *   - O formato: um .glb. As malhas (formas prontas e modelos importados) são nós "parte_<id>" (o leitor de glTF tira o ":" dos nomes); a ficha do item (o
 *     nome, o encaixe no corpo e as partes que não são malha: luzes, partículas e lançadores) vai em extras.webcItem.
 *     Ao abrir, a ficha passa por limpar(): todo número é conferido e limitado (um item dos outros é dado, nunca
 *     código, e não pode travar o aparelho de ninguém).
 *   - C.ItemVivo: o item montado na cena, preso num osso (o normalizado do VRM, que tem os mesmos eixos em qualquer
 *     modelo), com as luzes, as partículas e os projéteis funcionando. usar() dispara as reações.
 *   - C.itens: os itens guardados no aparelho (os criados e os baixados da loja) e o ajuste de encaixe de cada pessoa.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const LISTA = "webc:itens";
  const chaveItem = (id) => "webc:item:" + id;
  const CHAVE_AJUSTES = "webc.itens.encaixe";
  const num = (v, min, max, padrao) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
  const cor = (v, padrao = "#ffffff") => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : padrao);
  const texto = (v, max, padrao = "") => String(v == null ? padrao : v).replace(/[\x00-\x1f<>]/g, "").slice(0, max);
  const vetor = (v, min, max, padrao) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, min, max, padrao[i])) : padrao.slice());
  const LIMITES = { particulas: 2000, projeteis: 80, luzes: 4, partes: 64, cadencia: 50, tamanho: 25 * 1024 * 1024 };

  /** Onde o item pode ficar no corpo (o osso e o nome). "costas" é o peito, com o item atrás. */
  C.ENCAIXES = {
    rightHand: "Mão direita", leftHand: "Mão esquerda", head: "Cabeça", chest: "Peito", costas: "Costas", hips: "Quadril",
    rightFoot: "Pé direito", leftFoot: "Pé esquerdo",
  };
  const OSSO_DO_ENCAIXE = { costas: "chest" };
  C.FORMAS = { cubo: "Cubo", esfera: "Esfera", cilindro: "Cilindro", cone: "Cone", capsula: "Cápsula", toro: "Toro", plano: "Plano", anel: "Anel" };

  // ── os modelos prontos ──────────────────────────────────────────────
  C.PARTICULAS_PRONTAS = {
    fumaca: { nome: "Fumaça", taxa: 18, rajada: 0, vida: 2.2, velocidade: 0.4, abertura: 25, gravidade: -0.15, arrasto: 0.6, tamanho: [0.15, 0.6], cor: ["#bbbbbb", "#555555"], opacidade: 0.5, forma: "fumaca", somar: false },
    faisca: { nome: "Faíscas", taxa: 60, rajada: 0, vida: 0.5, velocidade: 2.5, abertura: 60, gravidade: 4, arrasto: 0.2, tamanho: [0.05, 0.01], cor: ["#fff3a0", "#ff6a00"], opacidade: 1, forma: "faisca", somar: true },
    fogo: { nome: "Fogo", taxa: 50, rajada: 0, vida: 0.8, velocidade: 0.8, abertura: 20, gravidade: -1.2, arrasto: 0.3, tamanho: [0.25, 0.05], cor: ["#ffd36b", "#ff3300"], opacidade: 0.9, forma: "circulo", somar: true },
    neve: { nome: "Neve", taxa: 25, rajada: 0, vida: 3, velocidade: 0.3, abertura: 180, gravidade: 0.4, arrasto: 0.8, tamanho: [0.05, 0.05], cor: ["#ffffff", "#dfefff"], opacidade: 0.9, forma: "circulo", somar: false },
    bolhas: { nome: "Bolhas", taxa: 8, rajada: 0, vida: 2.5, velocidade: 0.5, abertura: 35, gravidade: -0.25, arrasto: 0.5, tamanho: [0.08, 0.16], cor: ["#bfe9ff", "#ffffff"], opacidade: 0.6, forma: "bolha", somar: false },
    confete: { nome: "Confete", taxa: 0, rajada: 80, vida: 2.5, velocidade: 3, abertura: 50, gravidade: 3, arrasto: 0.9, tamanho: [0.06, 0.06], cor: ["#ff4d8d", "#4dd2ff"], opacidade: 1, forma: "quadrado", somar: false },
    estrelas: { nome: "Estrelas", taxa: 20, rajada: 0, vida: 1.2, velocidade: 0.6, abertura: 180, gravidade: 0, arrasto: 0.4, tamanho: [0.12, 0], cor: ["#fff7b0", "#b07bff"], opacidade: 1, forma: "estrela", somar: true },
    magia: { nome: "Magia", taxa: 40, rajada: 0, vida: 1, velocidade: 0.3, abertura: 180, gravidade: -0.3, arrasto: 0.5, tamanho: [0.1, 0], cor: ["#7bf3ff", "#8a4bff"], opacidade: 1, forma: "circulo", somar: true },
  };
  C.LANCADORES_PRONTOS = {
    pistola: { nome: "Pistola", velocidade: 60, gravidade: 0, vida: 1.2, cadencia: 180, porTiro: 1, dispersao: 1, tamanho: 0.03, cor: "#ffd27a", rastro: true, brilho: true, quiques: 0, impacto: true, clarao: true, recuo: 0.3 },
    laser: { nome: "Laser", velocidade: 120, gravidade: 0, vida: 0.8, cadencia: 90, porTiro: 1, dispersao: 0, tamanho: 0.02, cor: "#ff2a6a", rastro: true, brilho: true, quiques: 1, impacto: true, clarao: false, recuo: 0.1 },
    bolhas: { nome: "Bolhas", velocidade: 4, gravidade: -0.3, vida: 3, cadencia: 120, porTiro: 3, dispersao: 18, tamanho: 0.12, cor: "#bfe9ff", rastro: false, brilho: false, quiques: 0, impacto: true, clarao: false, recuo: 0 },
    fogos: { nome: "Fogos", velocidade: 18, gravidade: 6, vida: 2, cadencia: 600, porTiro: 1, dispersao: 4, tamanho: 0.07, cor: "#ffb84d", rastro: true, brilho: true, quiques: 0, impacto: true, clarao: true, recuo: 0.5 },
    neve: { nome: "Bola de neve", velocidade: 14, gravidade: 9.8, vida: 3, cadencia: 400, porTiro: 1, dispersao: 2, tamanho: 0.1, cor: "#ffffff", rastro: false, brilho: false, quiques: 1, impacto: true, clarao: false, recuo: 0.2 },
  };
  C.LUZES_PRONTAS = {
    lanterna: { nome: "Lanterna", luz: "lanterna", cor: "#fff4d6", forca: 30, alcance: 18, abertura: 28, suavidade: 0.45, sombra: true, cone: true, piscar: 0, alternar: true, ligada: true },
    lampada: { nome: "Lâmpada", luz: "lampada", cor: "#ffd9a0", forca: 6, alcance: 6, abertura: 60, suavidade: 0.5, sombra: false, cone: false, piscar: 0, alternar: true, ligada: true },
    tocha: { nome: "Tocha", luz: "lampada", cor: "#ff9a3c", forca: 8, alcance: 7, abertura: 60, suavidade: 0.5, sombra: false, cone: false, piscar: 0.5, alternar: false, ligada: true },
  };

  // ── a ficha: criar e limpar ─────────────────────────────────────────
  C.novoItem = () => ({ v: 1, nome: "Item novo", descricao: "", encaixe: { osso: "rightHand", pos: [-0.075, -0.03, 0], rot: [0, 0, 0], escala: 1 }, partes: [] }); // segurado pelo cabo, como na mão de boneco
  C.novaParte = function (tipo, extra = {}) {
    const base = { id: LNUX.id("p"), nome: "", tipo, pos: [0, 0, 0], rot: [0, 0, 0], esc: [1, 1, 1], visivel: true };
    if (tipo === "forma") Object.assign(base, { forma: "cubo", nome: "Cubo", esc: [0.1, 0.1, 0.1], cor: "#8aa4ff", metal: 0.1, rugosidade: 0.6, brilho: 0, corBrilho: "#ffffff", opacidade: 1, aramado: false, chapado: false });
    if (tipo === "modelo") Object.assign(base, { nome: "Modelo", animar: true });
    if (tipo === "luz") Object.assign(base, { ...C.LUZES_PRONTAS.lanterna });
    if (tipo === "particulas") Object.assign(base, { ...C.PARTICULAS_PRONTAS.faisca, aoUsar: "continuo", mundo: true, forma3d: "ponto" });
    if (tipo === "lancador") Object.assign(base, { ...C.LANCADORES_PRONTOS.pistola });
    return Object.assign(base, extra);
  };
  /** Confere a ficha (de quem for): só os campos conhecidos, os números dentro dos limites, sem nada que vire código. */
  C.limparItem = function (bruto) {
    const d = bruto && typeof bruto === "object" ? bruto : {};
    const e = d.encaixe || {};
    const item = {
      v: 1, nome: texto(d.nome, 60, "Item") || "Item", descricao: texto(d.descricao, 300),
      encaixe: { osso: C.ENCAIXES[e.osso] ? e.osso : "rightHand", pos: vetor(e.pos, -2, 2, [0, 0, 0]), rot: vetor(e.rot, -360, 360, [0, 0, 0]), escala: num(e.escala, 0.05, 10, 1) },
      partes: [],
    };
    let luzes = 0;
    for (const p of (Array.isArray(d.partes) ? d.partes : []).slice(0, LIMITES.partes)) {
      if (!p || !["forma", "modelo", "luz", "particulas", "lancador"].includes(p.tipo)) continue;
      if (p.tipo === "luz" && ++luzes > LIMITES.luzes) continue;
      const q = { id: texto(p.id, 40).replace(/[^\w-]/g, "") || LNUX.id("p"), nome: texto(p.nome, 40), tipo: p.tipo, pos: vetor(p.pos, -20, 20, [0, 0, 0]), rot: vetor(p.rot, -360, 360, [0, 0, 0]),
        esc: vetor(p.esc, -50, 50, [1, 1, 1]), visivel: p.visivel !== false };
      if (p.tipo === "forma") Object.assign(q, { forma: C.FORMAS[p.forma] ? p.forma : "cubo", cor: cor(p.cor, "#8aa4ff"), metal: num(p.metal, 0, 1, 0.1), rugosidade: num(p.rugosidade, 0, 1, 0.6),
        brilho: num(p.brilho, 0, 10, 0), corBrilho: cor(p.corBrilho), opacidade: num(p.opacidade, 0.05, 1, 1), aramado: !!p.aramado, chapado: !!p.chapado });
      if (p.tipo === "modelo") Object.assign(q, { animar: p.animar !== false, cor: p.cor ? cor(p.cor) : "", brilho: num(p.brilho, 0, 10, 0), opacidade: num(p.opacidade, 0.05, 1, 1) });
      if (p.tipo === "luz") Object.assign(q, { luz: p.luz === "lampada" ? "lampada" : "lanterna",
        cor: cor(p.cor, "#fff4d6"), forca: num(p.forca, 0, 200, 30), alcance: num(p.alcance, 0.5, 60, 18), abertura: num(p.abertura, 5, 85, 28), suavidade: num(p.suavidade, 0, 1, 0.45),
        sombra: !!p.sombra, cone: !!p.cone, piscar: num(p.piscar, 0, 1, 0), alternar: p.alternar !== false, ligada: p.ligada !== false });
      if (p.tipo === "particulas") Object.assign(q, { taxa: num(p.taxa, 0, 300, 20), rajada: Math.round(num(p.rajada, 0, 400, 0)), vida: num(p.vida, 0.05, 8, 1), velocidade: num(p.velocidade, 0, 30, 1),
        abertura: num(p.abertura, 0, 180, 30), gravidade: num(p.gravidade, -20, 20, 0), arrasto: num(p.arrasto, 0, 5, 0.3), tamanho: [num((p.tamanho || [])[0], 0, 3, 0.1), num((p.tamanho || [])[1], 0, 3, 0.05)],
        cor: [cor((p.cor || [])[0], "#ffffff"), cor((p.cor || [])[1], "#ffffff")], opacidade: num(p.opacidade, 0.02, 1, 1),
        forma: ["circulo", "faisca", "fumaca", "estrela", "quadrado", "bolha"].includes(p.forma) ? p.forma : "circulo", somar: !!p.somar, mundo: p.mundo !== false,
        aoUsar: ["continuo", "rajada", "enquanto"].includes(p.aoUsar) ? p.aoUsar : "continuo", forma3d: ["ponto", "esfera", "caixa"].includes(p.forma3d) ? p.forma3d : "ponto" });
      if (p.tipo === "lancador") Object.assign(q, { velocidade: num(p.velocidade, 0.5, 200, 60), gravidade: num(p.gravidade, -20, 30, 0), vida: num(p.vida, 0.1, 6, 1.2), cadencia: num(p.cadencia, LIMITES.cadencia, 5000, 180),
        porTiro: Math.round(num(p.porTiro, 1, 12, 1)), dispersao: num(p.dispersao, 0, 45, 1), tamanho: num(p.tamanho, 0.005, 1, 0.03), cor: cor(p.cor, "#ffd27a"), rastro: !!p.rastro, brilho: !!p.brilho,
        quiques: Math.round(num(p.quiques, 0, 5, 0)), impacto: p.impacto !== false, clarao: !!p.clarao, recuo: num(p.recuo, 0, 2, 0.3) });
      item.partes.push(q);
    }
    return item;
  };
  // a luz guarda a espécie em "luz": lanterna (um cone, como a de mão) ou lâmpada (para todos os lados)
  C.especieDaLuz = (p) => (p.luz === "lampada" ? "lampada" : "lanterna");

  // ── texturas das partículas (desenhadas aqui) ───────────────────────
  const TEXTURAS = {};
  function texturaParticula(forma) {
    if (TEXTURAS[forma]) return TEXTURAS[forma];
    const T = window.THREE, tela = document.createElement("canvas");
    tela.width = tela.height = 64;
    const g = tela.getContext("2d");
    g.translate(32, 32);
    const radial = (a, b) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
    if (forma === "circulo") { g.fillStyle = radial("rgba(255,255,255,1)", "rgba(255,255,255,0)"); g.fillRect(-32, -32, 64, 64); }
    else if (forma === "fumaca") { for (let i = 0; i < 6; i++) { g.fillStyle = radial("rgba(255,255,255,.35)", "rgba(255,255,255,0)"); g.beginPath(); g.arc(Math.cos(i) * 8, Math.sin(i * 1.7) * 8, 22, 0, 7); g.fill(); } }
    else if (forma === "faisca") { g.fillStyle = radial("rgba(255,255,255,1)", "rgba(255,255,255,0)"); g.fillRect(-32, -3, 64, 6); g.fillRect(-3, -32, 6, 64); g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill(); }
    else if (forma === "estrela") { g.fillStyle = "#fff"; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 28, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); }
    else if (forma === "quadrado") { g.fillStyle = "#fff"; g.fillRect(-20, -20, 40, 40); }
    else if (forma === "bolha") { g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 26, 0, 7); g.stroke(); g.fillStyle = "rgba(255,255,255,.18)"; g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(-9, -10, 5, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(tela);
    t.colorSpace = T.SRGBColorSpace;
    return (TEXTURAS[forma] = t);
  }

  /** Um emissor de partículas (no mundo, ou preso no item): pontos com tamanho, cor e transparência próprios. */
  class Emissor {
    constructor(def, cena, reduzir) {
      const T = window.THREE;
      this.def = def;
      this.cena = cena;
      this.max = Math.min(LIMITES.particulas, Math.max(16, Math.ceil(def.taxa * def.vida * 1.2 + def.rajada * 1.1)));
      if (reduzir) this.max = Math.max(16, Math.floor(this.max / 3));
      const n = this.max;
      this.pos = new Float32Array(n * 3);
      this.vel = new Float32Array(n * 3);
      this.idade = new Float32Array(n).fill(1e9);
      this.vidas = new Float32Array(n).fill(1);
      this.tam = new Float32Array(n);
      this.cores = new Float32Array(n * 3);
      this.alfas = new Float32Array(n);
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(this.pos, 3));
      g.setAttribute("tamanho", new T.BufferAttribute(this.tam, 1));
      g.setAttribute("cor", new T.BufferAttribute(this.cores, 3));
      g.setAttribute("alfa", new T.BufferAttribute(this.alfas, 1));
      this.material = new T.ShaderMaterial({
        uniforms: { mapa: { value: texturaParticula(def.forma) }, escala: { value: 600 } },
        vertexShader: "attribute float tamanho; attribute vec3 cor; attribute float alfa; varying vec3 vCor; varying float vAlfa;" +
          "uniform float escala; void main(){ vCor = cor; vAlfa = alfa; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = tamanho * escala / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "uniform sampler2D mapa; varying vec3 vCor; varying float vAlfa; void main(){ vec4 t = texture2D(mapa, gl_PointCoord); gl_FragColor = vec4(vCor * t.rgb, t.a * vAlfa); if (gl_FragColor.a < 0.01) discard; }",
        transparent: true, depthWrite: false, blending: def.somar ? T.AdditiveBlending : T.NormalBlending,
      });
      this.pontos = new T.Points(g, this.material);
      this.pontos.frustumCulled = false;
      this.pontos.renderOrder = 5;
      cena.add(this.pontos);
      this.acumulado = 0;
      this.ativo = def.aoUsar === "continuo";
      this.proximo = 0;
      this.c0 = new T.Color(def.cor[0]);
      this.c1 = new T.Color(def.cor[1]);
      this._c = new T.Color();
      this._v = new T.Vector3();
      this._q = new T.Quaternion();
    }
    /** Solta n partículas do ponto/direção do emissor (no mundo). */
    soltar(n, origem, rotacao) {
      const d = this.def, abre = d.abertura * Math.PI / 180, v = this._v;
      for (let k = 0; k < n; k++) {
        const i = this.proximo;
        this.proximo = (this.proximo + 1) % this.max;
        // direção num cone em volta de +Y do emissor
        const th = Math.random() * Math.PI * 2, ph = Math.acos(1 - Math.random() * (1 - Math.cos(abre)));
        v.set(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)).applyQuaternion(rotacao);
        const vel = d.velocidade * (0.6 + Math.random() * 0.8);
        let ox = 0, oy = 0, oz = 0;
        if (d.forma3d === "esfera") { const r = 0.05 * Math.cbrt(Math.random()); ox = (Math.random() - 0.5) * 2 * r; oy = (Math.random() - 0.5) * 2 * r; oz = (Math.random() - 0.5) * 2 * r; }
        else if (d.forma3d === "caixa") { ox = (Math.random() - 0.5) * 0.1; oy = (Math.random() - 0.5) * 0.1; oz = (Math.random() - 0.5) * 0.1; }
        this.pos[i * 3] = origem.x + ox; this.pos[i * 3 + 1] = origem.y + oy; this.pos[i * 3 + 2] = origem.z + oz;
        this.vel[i * 3] = v.x * vel; this.vel[i * 3 + 1] = v.y * vel; this.vel[i * 3 + 2] = v.z * vel;
        this.idade[i] = 0;
        this.vidas[i] = d.vida * (0.7 + Math.random() * 0.6);
        this.misturaCor = Math.random();
      }
    }
    atualizar(dt, origem, rotacao) {
      const d = this.def;
      if (this.ativo && d.taxa > 0) {
        this.acumulado += d.taxa * dt;
        const n = Math.min(64, Math.floor(this.acumulado));
        if (n > 0) { this.acumulado -= n; this.soltar(n, origem, rotacao); }
      }
      const arrasto = Math.exp(-d.arrasto * dt), g = d.gravidade * dt;
      let vivas = 0;
      for (let i = 0; i < this.max; i++) {
        const a = (this.idade[i] += dt), vida = this.vidas[i];
        if (a >= vida) { this.alfas[i] = 0; this.tam[i] = 0; continue; }
        vivas++;
        const t = a / vida, j = i * 3;
        this.vel[j] *= arrasto; this.vel[j + 1] = this.vel[j + 1] * arrasto - g; this.vel[j + 2] *= arrasto;
        this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
        this.tam[i] = d.tamanho[0] + (d.tamanho[1] - d.tamanho[0]) * t;
        // confete: cada uma numa das duas cores; o resto vai da cor do começo à do fim
        this._c.copy(this.c0).lerp(this.c1, d.forma === "quadrado" ? (i % 2) : t);
        this.cores[j] = this._c.r; this.cores[j + 1] = this._c.g; this.cores[j + 2] = this._c.b;
        this.alfas[i] = d.opacidade * Math.min(1, (1 - t) * 3) * Math.min(1, t * 12 + 0.2);
      }
      const g2 = this.pontos.geometry;
      for (const nome of ["position", "tamanho", "cor", "alfa"]) g2.attributes[nome].needsUpdate = true;
      this.vivas = vivas;
    }
    descartar() { this.cena.remove(this.pontos); this.pontos.geometry.dispose(); this.material.dispose(); }
  }

  // ── a geometria das formas prontas (todas de tamanho 1: o tamanho vem da escala) ──
  const GEOMETRIAS = {};
  C.geometriaDaForma = function (forma) {
    const T = window.THREE;
    if (GEOMETRIAS[forma]) return GEOMETRIAS[forma];
    const g = {
      cubo: () => new T.BoxGeometry(1, 1, 1), esfera: () => new T.SphereGeometry(0.5, 32, 20), cilindro: () => new T.CylinderGeometry(0.5, 0.5, 1, 32),
      cone: () => new T.ConeGeometry(0.5, 1, 32), capsula: () => new T.CapsuleGeometry(0.25, 0.5, 8, 16), toro: () => new T.TorusGeometry(0.4, 0.12, 16, 40),
      plano: () => new T.PlaneGeometry(1, 1), anel: () => new T.RingGeometry(0.25, 0.5, 40),
    }[forma] || (() => new T.BoxGeometry(1, 1, 1));
    return (GEOMETRIAS[forma] = g());
  };
  /** Uma malha nova de forma pronta, com o material da parte. */
  C.malhaDaForma = function (parte) {
    const T = window.THREE;
    const m = new T.Mesh(C.geometriaDaForma(parte.forma), new T.MeshStandardMaterial({ side: ["plano", "anel"].includes(parte.forma) ? T.DoubleSide : T.FrontSide }));
    m.castShadow = true;
    m.receiveShadow = true;
    C.aplicarMaterial(m, parte);
    return m;
  };
  /** Aplica cor, metal, rugosidade, brilho, opacidade, aramado e faces chapadas (em todas as malhas do objeto). */
  C.aplicarMaterial = function (obj, parte) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material || [])) {
        if (parte.tipo === "forma" || parte.cor) { if (m.color) m.color.set(parte.cor); }
        if (parte.tipo === "forma") { if ("metalness" in m) m.metalness = parte.metal; if ("roughness" in m) m.roughness = parte.rugosidade; m.wireframe = !!parte.aramado; m.flatShading = !!parte.chapado; }
        if (m.emissive) { m.emissive.set(parte.brilho > 0 ? parte.corBrilho || parte.cor || "#ffffff" : "#000000"); m.emissiveIntensity = parte.brilho || 0; }
        const op = parte.opacidade ?? 1;
        m.transparent = op < 1 || m.transparent && !!m.userData.transparenteOriginal;
        m.opacity = op;
        m.needsUpdate = true;
      }
    });
  };
  const RAD = Math.PI / 180;
  C.posicionarParte = function (obj, parte) {
    obj.position.set(parte.pos[0], parte.pos[1], parte.pos[2]);
    obj.rotation.set(parte.rot[0] * RAD, parte.rot[1] * RAD, parte.rot[2] * RAD);
    obj.scale.set(parte.esc[0] || 1e-4, parte.esc[1] || 1e-4, parte.esc[2] || 1e-4);
    obj.visible = parte.visivel !== false;
  };

  // ── o item montado ──────────────────────────────────────────────────
  /**
   * O item na cena. def: a ficha (já limpa); malhas: Map id → Object3D (das partes forma/modelo, vindas do .glb ou do
   * estúdio); animacoes: as do .glb. ctx: {cena, colisor() (a malha com a árvore de colisão, ou null), outros() (as
   * pessoas: [{p, raio, altura}]), reduzir}. A raiz (this.raiz) vai num osso (encaixar) ou solta na cena (estúdio).
   */
  class ItemVivo {
    constructor(def, malhas, animacoes, ctx) {
      const T = window.THREE;
      this.def = def;
      this.ctx = ctx;
      this.raiz = new T.Group();      // fica no osso (ou na cena)
      this.raiz.name = "item:" + def.nome;
      this.corpo = new T.Group();     // o encaixe (posição, giro e tamanho em relação ao osso)
      this.raiz.add(this.corpo);
      this.objetos = new Map();       // id da parte → Object3D
      this.emissores = new Map();     // id → Emissor
      this.luzes = new Map();         // id → {luz, cone, ligada}
      this.projeteis = [];
      this.impacto = null;            // um emissor de faíscas para os impactos (criado na primeira vez)
      this.usando = false;
      this.ultimoTiro = new Map();
      this.recuo = 0;
      this.mixer = null;
      this.animacoes = animacoes || [];
      this.aplicarEncaixe(def.encaixe);
      for (const parte of def.partes) this.montarParte(parte, malhas && malhas.get(parte.id));
      if (this.animacoes.length) {
        this.mixer = new T.AnimationMixer(this.corpo);
        this.acoes = this.animacoes.map((a) => this.mixer.clipAction(a));
      }
    }
    aplicarEncaixe(e) {
      this.corpo.position.set(e.pos[0], e.pos[1], e.pos[2]);
      this.corpo.rotation.set(e.rot[0] * RAD, e.rot[1] * RAD, e.rot[2] * RAD);
      this.corpo.scale.setScalar(e.escala || 1);
      this.encaixe = e;
    }
    montarParte(parte, malha) {
      const T = window.THREE;
      let obj;
      if (parte.tipo === "forma") obj = malha || C.malhaDaForma(parte);
      else if (parte.tipo === "modelo") obj = malha || new T.Group();
      else obj = new T.Group();
      obj.name = "parte_" + parte.id;
      obj.userData.parte = parte.id;
      C.posicionarParte(obj, parte);
      if (parte.tipo === "forma" || parte.tipo === "modelo") C.aplicarMaterial(obj, parte);
      if (parte.tipo === "luz") {
        const lanterna = C.especieDaLuz(parte) === "lanterna";
        const luz = lanterna ? new T.SpotLight(parte.cor, parte.forca, parte.alcance, parte.abertura * RAD, parte.suavidade, 1.6) : new T.PointLight(parte.cor, parte.forca, parte.alcance, 1.6);
        luz.castShadow = !!parte.sombra;
        if (luz.castShadow) { luz.shadow.mapSize.set(1024, 1024); luz.shadow.bias = -0.0008; luz.shadow.camera.near = 0.05; }
        obj.add(luz);
        let cone = null;
        if (lanterna) {
          luz.target.position.set(0, 0, 1); // a frente da parte (+Z)
          obj.add(luz.target);
          if (parte.cone) {
            const comp = Math.min(6, parte.alcance * 0.35), raio = Math.tan(parte.abertura * RAD) * comp;
            const g = new T.ConeGeometry(raio, comp, 32, 1, true);
            g.translate(0, -comp / 2, 0);
            g.rotateX(-Math.PI / 2);
            cone = new T.Mesh(g, new T.MeshBasicMaterial({ color: parte.cor, transparent: true, opacity: 0.12, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
            cone.raycast = () => {};
            cone.userData.semCaixa = true; // o cone de luz não conta no tamanho do item (enquadrar, contorno)
            obj.add(cone);
          }
        }
        this.luzes.set(parte.id, { luz, cone, ligada: parte.ligada !== false, forca: parte.forca });
        this.ligarLuz(parte.id, parte.ligada !== false);
      }
      if (parte.tipo === "particulas") this.emissores.set(parte.id, new Emissor(parte, parte.mundo ? this.ctx.cena : obj, this.ctx.reduzir));
      this.objetos.set(parte.id, obj);
      this.corpo.add(obj);
      return obj;
    }
    ligarLuz(id, sim) {
      const l = this.luzes.get(id);
      if (!l) return;
      l.ligada = sim;
      l.luz.visible = sim;
      if (l.cone) l.cone.visible = sim;
    }
    /** Quais luzes estão ligadas (para a sala): uma lista de 0 e 1 na ordem das partes. */
    get luzesLigadas() { return [...this.luzes.values()].map((l) => (l.ligada ? 1 : 0)); }
    definirLuzes(lista) { [...this.luzes.keys()].forEach((id, i) => { if (lista && lista[i] !== undefined) this.ligarLuz(id, !!lista[i]); }); }

    /**
     * Usar (a tecla E): liga/desliga as luzes que alternam, solta as rajadas, toca as animações do modelo e dispara os
     * lançadores. mira: o ponto no mundo para onde atirar (ou null: para a frente do lançador). Devolve se fez algo.
     */
    usar(mira = null) {
      let fez = false;
      for (const parte of this.def.partes) {
        if (parte.tipo === "luz" && parte.alternar) { const l = this.luzes.get(parte.id); this.ligarLuz(parte.id, !l.ligada); fez = true; }
        if (parte.tipo === "particulas") {
          const e = this.emissores.get(parte.id);
          if (parte.rajada > 0) { const { pos, rot } = this.ondeEsta(parte.id); e.soltar(Math.min(parte.rajada, e.max), pos, rot); fez = true; }
          if (parte.aoUsar === "enquanto") { e.ativo = true; fez = true; }
          if (parte.aoUsar === "rajada" && !parte.rajada) { const { pos, rot } = this.ondeEsta(parte.id); e.soltar(Math.min(30, e.max), pos, rot); fez = true; }
        }
        if (parte.tipo === "lancador") { this.disparar(parte, mira); fez = true; }
        if (parte.tipo === "modelo" && parte.animar && this.acoes && this.acoes.length) {
          for (const a of this.acoes) { a.reset(); a.setLoop(window.THREE.LoopOnce, 1); a.clampWhenFinished = false; a.play(); }
          fez = true;
        }
      }
      this.usando = true;
      this.mira = mira;
      return fez;
    }
    /** Soltou a tecla: para o disparo contínuo e as partículas "enquanto usa". */
    soltarUso() {
      this.usando = false;
      for (const parte of this.def.partes) if (parte.tipo === "particulas" && parte.aoUsar === "enquanto") this.emissores.get(parte.id).ativo = false;
    }
    /** Onde uma parte está no mundo agora: {pos, rot, frente}. */
    ondeEsta(id) {
      const T = window.THREE, obj = this.objetos.get(id);
      obj.updateWorldMatrix(true, false);
      const pos = (this._pos = this._pos || new T.Vector3()), rot = (this._rot = this._rot || new T.Quaternion()), esc = (this._esc = this._esc || new T.Vector3());
      obj.matrixWorld.decompose(pos, rot, esc);
      const frente = (this._frente = this._frente || new T.Vector3()).set(0, 0, 1).applyQuaternion(rot);
      return { pos, rot, frente };
    }
    disparar(parte, mira) {
      const T = window.THREE, agora = performance.now();
      if (agora - (this.ultimoTiro.get(parte.id) || 0) < parte.cadencia) return;
      this.ultimoTiro.set(parte.id, agora);
      this.tiros = (this.tiros || 0) + 1;
      const { pos, frente } = this.ondeEsta(parte.id);
      const dir = new T.Vector3();
      if (mira) dir.subVectors(mira, pos).normalize(); else dir.copy(frente);
      if (dir.lengthSq() < 1e-6) dir.copy(frente);
      for (let i = 0; i < parte.porTiro; i++) {
        if (this.projeteis.length >= LIMITES.projeteis) this.tirarProjetil(0);
        const d = dir.clone();
        if (parte.dispersao > 0) {
          const a = parte.dispersao * RAD, eixo = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(d).normalize();
          d.applyAxisAngle(eixo, (Math.random() - 0.5) * 2 * a).normalize();
        }
        const malha = new T.Mesh(this.geometriaProjetil(), new T.MeshBasicMaterial({ color: parte.cor, transparent: !parte.brilho, opacity: parte.brilho ? 1 : 0.9 }));
        malha.scale.setScalar(parte.tamanho);
        malha.position.copy(pos);
        malha.raycast = () => {};
        this.ctx.cena.add(malha);
        let rastro = null;
        if (parte.rastro) {
          const g = new T.BufferGeometry().setFromPoints([pos.clone(), pos.clone()]);
          rastro = new T.Line(g, new T.LineBasicMaterial({ color: parte.cor, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false }));
          rastro.frustumCulled = false;
          this.ctx.cena.add(rastro);
        }
        this.projeteis.push({ parte, malha, rastro, vel: d.multiplyScalar(parte.velocidade), idade: 0, quiques: parte.quiques, antes: pos.clone() });
      }
      if (parte.clarao) this.clarao(pos, parte.cor);
      this.recuo = Math.min(1, this.recuo + parte.recuo);
    }
    geometriaProjetil() { return (this._geo = this._geo || new window.THREE.SphereGeometry(1, 10, 8)); }
    clarao(pos, c) {
      const T = window.THREE;
      if (!this._clarao) { this._clarao = new T.PointLight(c, 0, 4, 2); this.ctx.cena.add(this._clarao); }
      this._clarao.color.set(c);
      this._clarao.position.copy(pos);
      this._clarao.intensity = 6;
    }
    tirarProjetil(i) {
      const p = this.projeteis[i];
      this.ctx.cena.remove(p.malha);
      p.malha.material.dispose();
      if (p.rastro) { this.ctx.cena.remove(p.rastro); p.rastro.geometry.dispose(); p.rastro.material.dispose(); }
      this.projeteis.splice(i, 1);
    }
    /** Um impacto: faíscas na cor do projétil, onde bateu. */
    estourar(pos, normal, c) {
      const T = window.THREE;
      if (!this.impacto) this.impacto = new Emissor({ ...C.PARTICULAS_PRONTAS.faisca, taxa: 0, rajada: 0, aoUsar: "rajada", mundo: true, forma3d: "ponto", vida: 0.45, velocidade: 2.2, abertura: 70 }, this.ctx.cena, this.ctx.reduzir);
      this.impacto.c0.set(c);
      this.impacto.c1.set(c).multiplyScalar(0.4);
      const rot = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), normal || new T.Vector3(0, 1, 0));
      this.impacto.soltar(14, pos, rot);
    }

    /** Um quadro: partículas, projéteis (com o cenário e as pessoas), o piscar das luzes, o clarão e o recuo. */
    atualizar(dt) {
      const T = window.THREE;
      if (this.mixer) this.mixer.update(dt);
      for (const [id, e] of this.emissores) { const { pos, rot } = this.ondeEsta(id); e.atualizar(dt, pos, rot); }
      if (this.impacto) this.impacto.atualizar(dt, new T.Vector3(), new T.Quaternion());
      // disparo contínuo segurando a tecla
      if (this.usando) for (const parte of this.def.partes) if (parte.tipo === "lancador") this.disparar(parte, this.mira);
      // luzes que piscam (como uma tocha)
      const t = performance.now() / 1000;
      for (const parte of this.def.partes) {
        if (parte.tipo !== "luz" || !parte.piscar || this.ctx.reduzir) continue;
        const l = this.luzes.get(parte.id);
        l.luz.intensity = l.forca * (1 - parte.piscar * 0.5 * (0.5 + 0.5 * Math.sin(t * 17 + Math.sin(t * 7) * 3)));
      }
      if (this._clarao && this._clarao.intensity > 0) this._clarao.intensity = Math.max(0, this._clarao.intensity - dt * 60);
      this.recuo = Math.max(0, this.recuo - dt * 4);
      this.atualizarProjeteis(dt);
    }
    atualizarProjeteis(dt) {
      const T = window.THREE, colisor = this.ctx.colisor && this.ctx.colisor(), outros = (this.ctx.outros && this.ctx.outros()) || [];
      const raio = (this._raio = this._raio || new T.Ray()), passo = new T.Vector3();
      for (let i = this.projeteis.length - 1; i >= 0; i--) {
        const p = this.projeteis[i], parte = p.parte;
        p.idade += dt;
        if (p.idade > parte.vida) { this.tirarProjetil(i); continue; }
        p.vel.y -= parte.gravidade * dt;
        p.antes.copy(p.malha.position);
        passo.copy(p.vel).multiplyScalar(dt);
        const dist = passo.length();
        let bateu = null;
        if (dist > 0) {
          raio.origin.copy(p.antes);
          raio.direction.copy(passo).multiplyScalar(1 / dist);
          if (colisor) {
            const toque = colisor.geometry.boundsTree.raycastFirst(raio, T.DoubleSide);
            if (toque && toque.distance <= dist) bateu = { ponto: toque.point, normal: toque.face ? toque.face.normal.clone() : new T.Vector3(0, 1, 0), dist: toque.distance };
          } else if (p.antes.y + passo.y <= 0) { // o chão simples
            const f = p.antes.y / Math.max(1e-6, -passo.y);
            bateu = { ponto: p.antes.clone().addScaledVector(passo, Math.max(0, f)), normal: new T.Vector3(0, 1, 0), dist: dist * f };
          }
          // as pessoas da sala: um cilindro em pé cada (só o efeito, sem dano)
          for (const o of outros) {
            const fim = p.antes.clone().add(passo);
            const dx = fim.x - o.p.x, dz = fim.z - o.p.z;
            if (Math.hypot(dx, dz) < o.raio && fim.y > o.p.y && fim.y < o.p.y + o.altura) { bateu = { ponto: fim, normal: new T.Vector3(dx, 0, dz).normalize(), dist }; break; }
          }
        }
        if (bateu) {
          if (parte.impacto) this.estourar(bateu.ponto, bateu.normal, parte.cor);
          if (p.quiques > 0) {
            p.quiques--;
            p.malha.position.copy(bateu.ponto).addScaledVector(bateu.normal, parte.tamanho * 1.1);
            p.vel.reflect(bateu.normal).multiplyScalar(0.6);
          } else { this.tirarProjetil(i); continue; }
        } else p.malha.position.add(passo);
        if (p.rastro) {
          const a = p.rastro.geometry.attributes.position, tras = p.malha.position.clone().addScaledVector(p.vel, -Math.min(0.06, p.idade));
          a.setXYZ(0, tras.x, tras.y, tras.z);
          a.setXYZ(1, p.malha.position.x, p.malha.position.y, p.malha.position.z);
          a.needsUpdate = true;
        }
      }
    }
    get temLancador() { return this.def.partes.some((p) => p.tipo === "lancador"); }
    descartar() {
      for (const e of this.emissores.values()) e.descartar();
      if (this.impacto) this.impacto.descartar();
      while (this.projeteis.length) this.tirarProjetil(0);
      if (this._clarao) this.ctx.cena.remove(this._clarao);
      for (const l of this.luzes.values()) { if (l.luz.shadow && l.luz.shadow.map) l.luz.shadow.map.dispose(); l.luz.dispose && l.luz.dispose(); }
      if (this.raiz.parent) this.raiz.parent.remove(this.raiz);
    }
  }
  C.ItemVivo = ItemVivo;

  /**
   * Prende o item no corpo: no osso normalizado do VRM (os mesmos eixos em qualquer modelo; no VRM 0.x, o modelo está
   * virado e a base desfaz). nos: os ossos normalizados {nome → Object3D}; v0: se o modelo é VRM 0.x.
   */
  C.encaixarItem = function (item, nos, v0) {
    const T = window.THREE, nome = OSSO_DO_ENCAIXE[item.encaixe.osso] || item.encaixe.osso;
    const osso = nos[nome] || (nome === "chest" ? nos.upperChest || nos.spine : null) || nos.hips;
    if (!osso) return false;
    if (!item.base) { item.base = new T.Group(); item.base.add(item.raiz); }
    item.base.rotation.set(0, v0 ? Math.PI : 0, 0);
    osso.add(item.base);
    return true;
  };
  C.desencaixarItem = function (item) { if (item.base && item.base.parent) item.base.parent.remove(item.base); };

  // ── o arquivo: .glb com a ficha em extras ───────────────────────────
  /**
   * Junta as malhas e a ficha num .glb (Blob). malhas: Map id → Object3D (das formas e dos modelos), animacoes: as dos
   * modelos importados.
   */
  C.exportarItem = async function (def, malhas, animacoes = []) {
    const T = window.THREE, V = window.CompanhiaVRM;
    const cena = new T.Scene();
    cena.name = "webc-item";
    for (const parte of def.partes) {
      if (parte.tipo !== "forma" && parte.tipo !== "modelo") continue;
      const orig = malhas.get(parte.id);
      if (!orig) continue;
      const copia = orig.clone(true);
      copia.name = "parte_" + parte.id;
      C.posicionarParte(copia, { ...parte, visivel: true });
      copia.traverse((o) => { o.userData = {}; });
      cena.add(copia);
    }
    cena.userData = { webcItem: JSON.parse(JSON.stringify(def)) };
    const dados = await new V.GLTFExporter().parseAsync(cena, { binary: true, animations: animacoes, onlyVisible: false });
    return new Blob([dados], { type: "model/gltf-binary" });
  };
  /** Abre um .glb de item: {def (limpa), malhas: Map id → Object3D, animacoes}. */
  C.abrirItem = async function (blob) {
    const V = window.CompanhiaVRM;
    if (blob.size > LIMITES.tamanho) throw new Error(C.t("Esse item é grande demais (o limite é 25 MB)."));
    const gltf = await new V.GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
    const bruta = gltf.scene.userData && gltf.scene.userData.webcItem;
    const def = C.limparItem(bruta || { nome: "Modelo", partes: [{ id: "modelo", tipo: "modelo", nome: "Modelo" }] });
    const malhas = new Map();
    for (const filho of [...gltf.scene.children]) {
      const m = /^parte_([\w-]+)$/.exec(filho.name || "");
      if (m) { malhas.set(m[1], filho); C.posicionarParte(filho, { pos: [0, 0, 0], rot: [0, 0, 0], esc: [1, 1, 1] }); }
    }
    // um .glb qualquer (sem a ficha): o arquivo inteiro vira a parte "modelo"
    if (!bruta) { const g = gltf.scene; g.name = "parte_modelo"; malhas.set("modelo", g); }
    for (const [, o] of malhas) { if (o.parent) o.parent.remove(o); o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); }
    return { def, malhas, animacoes: gltf.animations || [] };
  };

  // ── os itens guardados no aparelho e o ajuste de cada pessoa ───────
  C.itens = {
    LIMITES,
    async lista() { return (await LNUX.guardado.ler(LISTA)) || []; },
    /** Guarda (ou troca) um item: reg {id?, nome, origem: "meu" | "loja", loja?, miniatura?}; blob: o .glb. */
    async guardar(reg, blob) {
      const id = reg.id || LNUX.id("it");
      await LNUX.guardado.gravar(chaveItem(id), { blob });
      const l = (await C.itens.lista()).filter((x) => x.id !== id);
      const novo = { origem: "meu", ...reg, id, tamanho: blob.size, mudado: Date.now() };
      l.unshift(novo);
      await LNUX.guardado.gravar(LISTA, l);
      return novo;
    },
    async ler(id) { const r = await LNUX.guardado.ler(chaveItem(id)); return r ? r.blob : null; },
    async apagar(id) { await LNUX.guardado.apagar(chaveItem(id)); await LNUX.guardado.gravar(LISTA, (await C.itens.lista()).filter((x) => x.id !== id)); },
    /** O ajuste de encaixe que esta pessoa fez num item (por cima do do criador), ou null. */
    ajuste(chave) { try { return JSON.parse(localStorage.getItem(CHAVE_AJUSTES) || "{}")[chave] || null; } catch (e) { return null; } },
    gravarAjuste(chave, encaixe) {
      let todos = {};
      try { todos = JSON.parse(localStorage.getItem(CHAVE_AJUSTES) || "{}"); } catch (e) { /* vazio */ }
      if (encaixe) todos[chave] = encaixe; else delete todos[chave];
      try { localStorage.setItem(CHAVE_AJUSTES, JSON.stringify(todos)); } catch (e) { /* sem armazenamento */ }
    },
  };
})();
