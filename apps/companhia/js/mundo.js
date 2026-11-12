/*
 * Companhia — cenário (mapa) e andar, para as personagens VRoid (.vrm).
 *
 *   - Cenário: um modelo 3D (.glb/.gltf, .fbx ou .obj; ZIP com as texturas junto) vira o lugar onde a personagem
 *     está. No retrato ele aparece atrás dela; em "Andar pelo cenário" ela anda por ele.
 *   - Andar: W A S D (ou as setas), Shift para correr, Espaço para pular; arrastar gira a câmera e a rodinha
 *     aproxima. No celular aparecem um direcional e um botão de pulo. Sem cenário, há um chão simples.
 *   - Colisão: a personagem é uma cápsula que desliza no chão, nas paredes e nas rampas do cenário. As malhas do
 *     mapa são juntadas numa árvore (three-mesh-bvh, MIT), então mapas grandes não pesam a cada quadro.
 *   - O andar/correr/pular tem um movimento próprio (calculado aqui); um movimento de um pacote pode ficar no
 *     lugar de cada um (Movimento › Pacotes de movimento › "Usar ao andar").
 *
 * Mapas do VRChat: um mundo publicado (.vrcw) é um pacote do Unity, com malhas, materiais e scripts num formato
 * próprio do motor, que não abre fora dele (e baixar o mundo dos outros fere os termos do VRChat). O que abre
 * aqui é o cenário exportado em glTF/GLB (no Unity: UnityGLTF ou "Export GLB"; no Blender: Exportar › glTF) ou
 * os modelos .fbx/.obj que vêm dentro de um .unitypackage (a Companhia abre o pacote e lista os modelos).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const LISTA = "companhia:mapas";
  const chaveMapa = (id) => "companhia:mapa:" + id;
  const MODELO = /\.(glb|gltf|fbx|obj)$/i;
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  /** Abre um .unitypackage (um .tar.gz do Unity: <guid>/pathname + <guid>/asset) e devolve Map caminho → Blob. */
  C.lerUnityPackage = async function (blob) {
    if (!window.DecompressionStream) throw new Error("Este navegador não abre .unitypackage (falta a descompressão). Extraia o pacote e escolha os modelos .fbx/.glb.");
    let dados;
    try { dados = new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
    catch (e) { throw new Error("Esse arquivo não parece um .unitypackage (não deu para descompactar)."); }
    const texto = new TextDecoder();
    const partes = new Map(); // guid → {pathname, asset}
    for (let p = 0; p + 512 <= dados.length;) {
      const nome = texto.decode(dados.subarray(p, p + 100)).replace(/\0.*$/, "");
      if (!nome) break;
      const tamanho = parseInt(texto.decode(dados.subarray(p + 124, p + 136)).replace(/\0.*$/, "").trim() || "0", 8) || 0;
      const corpo = dados.subarray(p + 512, p + 512 + tamanho);
      const m = nome.replace(/^\.\//, "").match(/^([0-9a-f]{32})\/(pathname|asset)$/i);
      if (m) {
        if (!partes.has(m[1])) partes.set(m[1], {});
        if (m[2] === "pathname") partes.get(m[1]).pathname = texto.decode(corpo).split("\n")[0].trim();
        else partes.get(m[1]).asset = corpo;
      }
      p += 512 + Math.ceil(tamanho / 512) * 512;
    }
    const arquivos = new Map();
    for (const { pathname, asset } of partes.values()) if (pathname && asset) arquivos.set(pathname, new Blob([asset]));
    if (!arquivos.size) throw new Error("Esse .unitypackage veio vazio (ou não é um pacote do Unity).");
    return arquivos;
  };

  class Mundo {
    constructor(palco) {
      const T = window.THREE;
      this.palco = palco;
      this.andando = false;
      this.mapa = null;         // o cenário na cena
      this.info = null;         // {id, nome, ajuste: {escala, giro, partida: [x, y, z, rumo] | null}}
      this.colisor = null;      // malha única com a árvore de colisão
      this.caixa = new T.Box3(new T.Vector3(-30, 0, -30), new T.Vector3(30, 3, 30));
      this.vel = new T.Vector3();
      this.noChao = true;
      this.rumo = 0;            // para onde a personagem olha (radianos em volta de Y; 0 = +Z)
      this.cam = { giro: Math.PI, altura: 0.25, dist: 3.2, alvo: new T.Vector3() };
      this.teclas = new Set();
      this.direcional = { x: 0, y: 0 };
      this.querPular = false;
      this.cfg = { velocidade: 1 };
      try { Object.assign(this.cfg, JSON.parse(LNUX.preferencia.ler("companhia.mundo", "{}"))); } catch (e) { /* padrão */ }
      this.estado = "parado";   // parado | andando | correndo | pulando
      this.fase = 0;
      this.pesoAndar = 0;
      this.pesoCorrer = 0;
      this.pesoPulo = 0;
      this.clips = {};          // estado → AnimationClip (movimentos do pacote no lugar do andar próprio)
      this.clipTocando = null;
      this._v = new T.Vector3();
      this._v2 = new T.Vector3();
      this._q = new T.Quaternion();
      this._e = new T.Euler();
      this._seg = new T.Line3();
      this._caixa = new T.Box3();
      // chão simples (quando não há cenário) e a sombra redonda embaixo da personagem
      this.chao = new T.GridHelper(60, 60, 0x8891a8, 0xb9c0d4);
      this.chao.material.transparent = true;
      this.chao.material.opacity = 0.55;
      this.chao.visible = false;
      const telaSombra = document.createElement("canvas");
      telaSombra.width = telaSombra.height = 64;
      const g = telaSombra.getContext("2d"), grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, "rgba(0,0,0,.45)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.sombra = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(telaSombra), transparent: true, depthWrite: false }));
      this.sombra.rotation.x = -Math.PI / 2;
      this.sombra.visible = false;
      this.sombra.renderOrder = 1;
      palco.cena.add(this.chao, this.sombra);
      this.ligarEntradas();
    }
    salvarCfg() { LNUX.preferencia.gravar("companhia.mundo", JSON.stringify(this.cfg)); }
    get altura() { return this.palco.altura || 1.5; }
    get raio() { return Math.max(0.12, this.altura * 0.16); }

    // ── entrar e sair do modo de andar ──────────────────────────────
    entrar() {
      if (this.andando || !this.palco.vrm) return false;
      this.andando = true;
      this.vel.set(0, 0, 0);
      this.rumo = this.palco.raiz.rotation.y;
      this.cam.giro = this.rumo + Math.PI; // a câmera começa atrás dela
      this.cam.altura = 0.25;
      this.cam.dist = 3.2 * (this.altura / 1.5);
      this.cam.alvo.copy(this.palco.raiz.position).y += this.altura * 0.8;
      this.chao.visible = !this.mapa;
      this.sombra.visible = true;
      this.mostrarControles(true);
      this.palco.emit("mundo", true);
      return true;
    }
    sair() {
      if (!this.andando) return;
      this.andando = false;
      this.teclas.clear();
      this.direcional.x = this.direcional.y = 0;
      this.chao.visible = false;
      this.sombra.visible = false;
      this.pesoAndar = this.pesoCorrer = this.pesoPulo = 0;
      if (this.palco.anim.info && this.palco.anim.info.tipo === "andar") this.palco.anim.parar(0.2);
      this.clipTocando = null;
      this.mostrarControles(false);
      this.partida(); // de volta ao retrato, no ponto de partida
      this.palco.enquadrar();
      this.palco.emit("mundo", false);
    }
    /** Quando uma personagem abre: no lugar certo do cenário. */
    aoCarregar() { if (!this.andando) this.partida(); }

    /** Leva a personagem ao ponto de partida (o guardado, ou o alto do meio do mapa, de onde ela cai no chão). */
    partida() {
      const T = window.THREE, raiz = this.palco.raiz, a = this.info && this.info.ajuste;
      this.vel.set(0, 0, 0);
      if (this.mapa && a && a.partida) { raiz.position.set(a.partida[0], a.partida[1], a.partida[2]); this.rumo = a.partida[3] || 0; }
      else if (this.mapa) {
        const c = this.caixa.getCenter(new T.Vector3());
        raiz.position.set(c.x, this.caixa.max.y + 0.5, c.z);
        this.rumo = 0;
        this.assentar();
      } else { raiz.position.set(0, 0, 0); this.rumo = 0; }
      raiz.rotation.y = this.rumo;
      raiz.updateMatrixWorld(true);
      const molas = this.palco.vrm && this.palco.vrm.springBoneManager;
      if (molas) { try { molas.reset(); } catch (e) { /* sem molas */ } }
    }
    /** Desce a personagem até o chão que estiver embaixo dela (sem esperar a gravidade). */
    assentar() {
      const T = window.THREE, raiz = this.palco.raiz;
      if (!this.colisor) { raiz.position.y = 0; return; }
      const raio = new T.Ray(new T.Vector3(raiz.position.x, raiz.position.y + 0.5, raiz.position.z), new T.Vector3(0, -1, 0));
      const toque = this.colisor.geometry.boundsTree.raycastFirst(raio, T.DoubleSide);
      if (toque) raiz.position.y = toque.point.y;
      else {
        // nada embaixo do meio do mapa: procura um chão em volta
        for (let i = 1; i <= 24 && !this.acharChao(i); i++); // eslint-disable-line curly
      }
    }
    acharChao(i) {
      const T = window.THREE, raiz = this.palco.raiz, tam = this.caixa.getSize(new T.Vector3()), c = this.caixa.getCenter(new T.Vector3());
      const ang = i * 2.399, r = Math.sqrt(i / 24) * 0.45;
      const x = c.x + Math.cos(ang) * r * tam.x, z = c.z + Math.sin(ang) * r * tam.z;
      const toque = this.colisor.geometry.boundsTree.raycastFirst(new T.Ray(new T.Vector3(x, this.caixa.max.y + 1, z), new T.Vector3(0, -1, 0)), T.DoubleSide);
      if (!toque) return false;
      raiz.position.set(x, toque.point.y, z);
      return true;
    }
    /** Guarda o lugar de agora como ponto de partida do cenário. */
    marcarPartida() {
      if (!this.info) return null;
      const p = this.palco.raiz.position;
      this.info.ajuste.partida = [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +this.rumo.toFixed(3)];
      return this.info.ajuste.partida;
    }
    pular() { this.querPular = true; }

    // ── teclado, ponteiro e controles de toque ──────────────────────
    ligarEntradas() {
      const alvoEditavel = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
      const TECLAS = { KeyW: "frente", ArrowUp: "frente", KeyS: "tras", ArrowDown: "tras", KeyA: "esquerda", ArrowLeft: "esquerda", KeyD: "direita", ArrowRight: "direita",
        ShiftLeft: "correr", ShiftRight: "correr", Space: "pular" };
      window.addEventListener("keydown", (e) => {
        if (!this.andando || alvoEditavel(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".lnux-fundo-modal")) return;
        const acao = TECLAS[e.code];
        if (!acao) return;
        e.preventDefault();
        if (acao === "pular") { if (!e.repeat) this.querPular = true; } else this.teclas.add(acao);
      });
      window.addEventListener("keyup", (e) => { const acao = TECLAS[e.code]; if (acao) this.teclas.delete(acao); });
      window.addEventListener("blur", () => this.teclas.clear());
      // arrastar no palco gira a câmera
      const c = this.palco.conteiner;
      let arrasto = null;
      c.addEventListener("pointerdown", (e) => {
        if (!this.andando || e.button > 0) return;
        arrasto = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // as teclas voltam a andar
      });
      c.addEventListener("pointermove", (e) => {
        if (!arrasto || arrasto.id !== e.pointerId || !this.andando) return;
        this.cam.giro -= (e.clientX - arrasto.x) * 0.006;
        this.cam.altura = limitar(this.cam.altura + (e.clientY - arrasto.y) * 0.005, -0.35, 1.3);
        arrasto.x = e.clientX;
        arrasto.y = e.clientY;
      });
      const soltar = (e) => { if (arrasto && arrasto.id === e.pointerId) arrasto = null; };
      c.addEventListener("pointerup", soltar);
      c.addEventListener("pointercancel", soltar);
    }
    /** A rodinha (ou o gesto de pinça) aproxima e afasta a câmera. */
    zoom(fator) { this.cam.dist = limitar(this.cam.dist * fator, 0.7 * (this.altura / 1.5), 14 * (this.altura / 1.5)); }
    /** Direcional e botão de pulo na tela (para o celular; no computador ficam discretos). */
    mostrarControles(sim) {
      if (!sim) { if (this.controles) { this.controles.remove(); this.controles = null; } return; }
      if (this.controles) return;
      const pino = el("div", { class: "pino" });
      const base = el("div", { class: "direcional", title: "Andar (ou W A S D)" }, pino);
      const pulo = el("button", { class: "botao-pulo", type: "button", title: "Pular (ou Espaço)", "aria-label": "Pular" }, "⤒");
      const correr = el("button", { class: "botao-correr", type: "button", title: "Correr (ou Shift)", "aria-label": "Correr", "aria-pressed": "false" }, "»");
      this.controles = el("div", { class: "controles-mundo" }, base, el("div", { class: "botoes" }, correr, pulo));
      this.palco.conteiner.parentElement.append(this.controles);
      let toque = null;
      const mover = (e) => {
        const r = base.getBoundingClientRect(), raio = r.width / 2;
        let dx = (e.clientX - (r.left + raio)) / raio, dy = (e.clientY - (r.top + raio)) / raio;
        const d = Math.hypot(dx, dy);
        if (d > 1) { dx /= d; dy /= d; }
        this.direcional.x = dx;
        this.direcional.y = -dy;
        pino.style.transform = `translate(${dx * raio * 0.6}px, ${dy * raio * 0.6}px)`;
      };
      base.addEventListener("pointerdown", (e) => { toque = e.pointerId; base.setPointerCapture(e.pointerId); mover(e); e.stopPropagation(); e.preventDefault(); });
      base.addEventListener("pointermove", (e) => { if (toque === e.pointerId) mover(e); });
      const largar = (e) => { if (toque !== e.pointerId) return; toque = null; this.direcional.x = this.direcional.y = 0; pino.style.transform = ""; };
      base.addEventListener("pointerup", largar);
      base.addEventListener("pointercancel", largar);
      pulo.addEventListener("pointerdown", (e) => { this.querPular = true; e.stopPropagation(); e.preventDefault(); });
      correr.addEventListener("click", (e) => { this.correrFixo = !this.correrFixo; correr.setAttribute("aria-pressed", String(this.correrFixo)); e.stopPropagation(); });
    }

    // ── a cada quadro: entradas → velocidade → colisão ──────────────
    atualizar(dt) {
      if (!this.andando || !this.palco.vrm) return;
      const raiz = this.palco.raiz, t = this.teclas, esc = this.altura / 1.5;
      let lado = (t.has("direita") ? 1 : 0) - (t.has("esquerda") ? 1 : 0) + this.direcional.x;
      let frente = (t.has("frente") ? 1 : 0) - (t.has("tras") ? 1 : 0) + this.direcional.y;
      const forca = Math.hypot(lado, frente);
      if (forca > 1) { lado /= forca; frente /= forca; }
      const correndo = (t.has("correr") || this.correrFixo || Math.hypot(this.direcional.x, this.direcional.y) > 0.92) && forca > 0.1;
      // em relação à câmera: "frente" é para longe dela
      const s = Math.sin(this.cam.giro), c = Math.cos(this.cam.giro);
      const mx = -s * frente + c * lado, mz = -c * frente - s * lado;
      const rapidez = (correndo ? 4.4 : 1.7) * esc * this.cfg.velocidade;
      const acel = 1 - Math.exp(-dt * (this.noChao ? 12 : 2.5));
      this.vel.x += (mx * rapidez - this.vel.x) * acel;
      this.vel.z += (mz * rapidez - this.vel.z) * acel;
      if (forca > 0.1) {
        // vira para onde anda
        const alvo = Math.atan2(mx, mz);
        let d = alvo - this.rumo;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.rumo += d * (1 - Math.exp(-dt * 12));
        // andar interrompe um movimento do pacote que estivesse tocando (uma dança, por exemplo)
        const info = this.palco.anim.info;
        if (info && info.tipo === "movimento" && this.palco.anim.tocando) this.palco.pararMovimento(0.25);
      }
      if (this.querPular && (this.noChao || (this.tempoNoAr || 0) < 0.14)) { this.vel.y = Math.sqrt(2 * 22 * esc * 0.95 * esc); this.noChao = false; this.tempoNoAr = 0.2; }
      this.querPular = false;
      // gravidade e colisão, em passos pequenos (para não atravessar paredes finas)
      const passos = 5, h = dt / passos;
      for (let i = 0; i < passos; i++) {
        // no chão, um empurrãozinho para baixo mantém a cápsula encostada (e descendo rampas sem quicar)
        this.vel.y = this.noChao && this.vel.y <= 0 ? -22 * esc * h : this.vel.y - 22 * esc * h;
        raiz.position.addScaledVector(this.vel, h);
        this.colidir(h);
      }
      this.tempoNoAr = this.noChao ? 0 : (this.tempoNoAr || 0) + dt;
      raiz.rotation.y = this.rumo;
      // caiu para fora do mapa: volta ao começo
      if (raiz.position.y < this.caixa.min.y - 25 * esc) this.partida();
      // estado (para o movimento)
      const vh = Math.hypot(this.vel.x, this.vel.z);
      // "no ar" só depois de um instante (um degrau ou uma lombada não contam como pulo)
      const novo = this.tempoNoAr > 0.14 ? "pulando" : vh < 0.25 * esc ? "parado" : correndo ? "correndo" : "andando";
      const k = 1 - Math.exp(-dt * 10);
      this.pesoAndar += ((novo === "andando" || novo === "correndo" ? 1 : 0) - this.pesoAndar) * k;
      this.pesoCorrer += ((novo === "correndo" ? 1 : 0) - this.pesoCorrer) * k;
      this.pesoPulo += ((novo === "pulando" ? 1 : 0) - this.pesoPulo) * k;
      this.fase += dt * (5.6 + 3.6 * this.pesoCorrer) * Math.max(0.4, Math.min(1.6, vh / Math.max(0.1, rapidez)));
      if (novo !== this.estado) { this.estado = novo; this.palco.emit("mundo-estado", novo); }
      this.trocarClip(vh, rapidez);
      // sombra no chão
      this.sombra.position.set(raiz.position.x, this.alturaDoChao(raiz.position) + 0.012, raiz.position.z);
      this.sombra.scale.setScalar(this.altura * 0.55 * Math.max(0.4, 1 - (raiz.position.y - this.sombra.position.y) * 0.5));
    }
    alturaDoChao(p) {
      const T = window.THREE;
      if (!this.colisor) return 0;
      const toque = this.colisor.geometry.boundsTree.raycastFirst(new T.Ray(this._v.set(p.x, p.y + this.altura * 0.5, p.z), this._v2.set(0, -1, 0)), T.DoubleSide);
      return toque ? toque.point.y : p.y;
    }
    /** A personagem é uma cápsula em pé; empurra para fora de tudo que ela encostar. */
    colidir(h) {
      const T = window.THREE, raiz = this.palco.raiz, r = this.raio, alto = Math.max(this.altura, r * 2.2);
      if (!this.colisor) {
        // chão simples
        if (raiz.position.y <= 0 && this.vel.y <= 0) { raiz.position.y = 0; this.vel.y = 0; this.noChao = true; } else this.noChao = false;
        return;
      }
      const seg = this._seg, caixa = this._caixa;
      seg.start.set(raiz.position.x, raiz.position.y + r, raiz.position.z);
      seg.end.set(raiz.position.x, raiz.position.y + alto - r, raiz.position.z);
      caixa.makeEmpty();
      caixa.expandByPoint(seg.start);
      caixa.expandByPoint(seg.end);
      caixa.min.addScalar(-r);
      caixa.max.addScalar(r);
      const pTri = this._v, pCap = this._v2;
      this.colisor.geometry.boundsTree.shapecast({
        intersectsBounds: (b) => b.intersectsBox(caixa),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(seg, pTri, pCap);
          if (d < r) {
            const fundo = r - d, dir = pCap.sub(pTri).normalize();
            seg.start.addScaledVector(dir, fundo);
            seg.end.addScaledVector(dir, fundo);
          }
        },
      });
      // quanto a cápsula foi empurrada
      const novo = pTri.copy(seg.start);
      novo.y -= r;
      const desl = pCap.subVectors(novo, raiz.position);
      // empurrada para cima = está pisando em algo
      this.noChao = desl.y > Math.abs(h * this.vel.y * 0.25);
      const tam = Math.max(0, desl.length() - 1e-5);
      desl.normalize().multiplyScalar(tam);
      raiz.position.add(desl);
      if (!this.noChao) { desl.normalize(); this.vel.addScaledVector(desl, -desl.dot(this.vel)); }
      else this.vel.y = 0;
      void T;
    }

    // ── o movimento do andar ────────────────────────────────────────
    /** Movimentos do pacote no lugar do andar próprio: {parado, andando, correndo, pulando} → AnimationClip (ou null). */
    definirClips(clips) { this.clips = clips || {}; this.clipTocando = null; if (this.palco.anim.info && this.palco.anim.info.tipo === "andar") this.palco.anim.parar(0.2); }
    trocarClip(vh, rapidez) {
      const an = this.palco.anim;
      if (an.info && an.info.tipo === "movimento" && an.tocando) { this.clipTocando = null; return; } // uma dança tocando: fica
      const clip = this.clips[this.estado] || null;
      if (clip !== this.clipTocando) {
        this.clipTocando = clip;
        if (clip) an.tocar(clip, { repetir: this.estado !== "pulando", transicao: 0.22, noLugar: true, info: { tipo: "andar", estado: this.estado } });
        else if (an.info && an.info.tipo === "andar") an.parar(0.22);
      }
      if (clip && (this.estado === "andando" || this.estado === "correndo")) an.definirVelocidade(limitar(vh / Math.max(0.1, rapidez), 0.5, 1.5));
    }
    /** O andar/correr/pular próprio, por cima da pose de descanso. Devolve quanto ele vale (0 a 1). */
    posar(pose, quadril, dt, pesoMov) {
      const livre = 1 - Math.min(1, pesoMov); // um movimento do pacote tocando manda
      const a = this.pesoAndar * livre, c = this.pesoCorrer, p = this.pesoPulo * livre;
      if (a < 0.002 && p < 0.002) return 0;
      const q = this._q, e = this._e, s = Math.sin(this.fase), co = Math.cos(this.fase);
      const antes = (n, x, y, z) => { if (pose[n]) pose[n].premultiply(q.setFromEuler(e.set(x, y, z))); }; // nos eixos do corpo
      const depois = (n, x, y, z) => { if (pose[n]) pose[n].multiply(q.setFromEuler(e.set(x, y, z))); };   // nos eixos do osso
      if (a >= 0.002) {
        const passo = (0.42 + 0.38 * c) * a, joelho = (0.75 + 0.55 * c) * a, braco = (0.32 + 0.55 * c) * a;
        // pernas: a esquerda vai para a frente quando s > 0; o joelho dobra enquanto a perna vem
        antes("leftUpperLeg", -passo * s - 0.08 * c * a, 0, 0);
        antes("rightUpperLeg", passo * s - 0.08 * c * a, 0, 0);
        const jE = 0.08 * a + joelho * Math.max(0, co), jD = 0.08 * a + joelho * Math.max(0, -co);
        depois("leftLowerLeg", jE, 0, 0);
        depois("rightLowerLeg", jD, 0, 0);
        depois("leftFoot", -0.35 * jE + 0.25 * passo * s, 0, 0);
        depois("rightFoot", -0.35 * jD - 0.25 * passo * s, 0, 0);
        // braços ao contrário das pernas; correndo, os cotovelos dobram
        antes("leftUpperArm", braco * s, 0, 0);
        antes("rightUpperArm", -braco * s, 0, 0);
        depois("leftLowerArm", 0, -(0.15 + 1.0 * c) * a, 0);
        depois("rightLowerArm", 0, (0.15 + 1.0 * c) * a, 0);
        // tronco: gira contra as pernas, inclina para a frente na corrida; o quadril sobe e desce a cada passo
        depois("hips", 0.04 * c * a, 0.07 * s * a, 0);
        depois("spine", 0.1 * c * a, -0.09 * s * a, 0);
        depois("chest", 0.04 * c * a, -0.06 * s * a, 0);
        quadril.y += (Math.cos(this.fase * 2) * 0.014 * (1 + c) - 0.012 - 0.02 * c) * a * this.altura;
      }
      if (p >= 0.002) {
        // no ar: joelhos encolhidos, braços abertos
        const sobe = this.vel.y > 0 ? 1 : 0.6;
        antes("leftUpperLeg", -0.55 * p * sobe, 0, 0);
        antes("rightUpperLeg", -0.25 * p * sobe, 0, 0);
        depois("leftLowerLeg", 0.95 * p * sobe, 0, 0);
        depois("rightLowerLeg", 0.6 * p * sobe, 0, 0);
        antes("leftUpperArm", 0, 0, 0.45 * p);
        antes("rightUpperArm", 0, 0, -0.45 * p);
        depois("spine", -0.06 * p, 0, 0);
      }
      void dt;
      return Math.max(a, p) * 0.85;
    }

    // ── câmera em terceira pessoa ───────────────────────────────────
    camera(dt) {
      const T = window.THREE, cam = this.palco.camera, raiz = this.palco.raiz, k = this.cam;
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
      const alvo = this._v.copy(raiz.position);
      alvo.y += this.altura * 0.82;
      k.alvo.lerp(alvo, 1 - Math.exp(-dt * 14));
      const ca = Math.cos(k.altura);
      const dir = this._v2.set(Math.sin(k.giro) * ca, Math.sin(k.altura), Math.cos(k.giro) * ca);
      let dist = k.dist;
      if (this.colisor) {
        // a câmera não atravessa as paredes: chega mais perto
        const toque = this.colisor.geometry.boundsTree.raycastFirst(new T.Ray(k.alvo, dir), T.DoubleSide);
        if (toque && toque.distance < dist + 0.2) dist = Math.max(0.25, toque.distance - 0.2);
      }
      cam.position.copy(k.alvo).addScaledVector(dir, dist);
      cam.lookAt(k.alvo);
      // a luz acompanha a câmera, de cima
      const luz = this.palco.luz;
      luz.position.copy(k.alvo).addScaledVector(dir, 2).add(this._v.set(0.6, 2.2, 0));
      luz.target.position.copy(k.alvo);
      luz.target.updateMatrixWorld();
    }

    // ── cenário: abrir, ajustar, tirar ──────────────────────────────
    /**
     * Abre um cenário. arquivos: Map caminho → Blob (um .glb sozinho, ou o modelo com as texturas ao lado).
     * info: {id, nome, principal, ajuste}. Devolve {triangulos, tamanho: [x, y, z]}.
     */
    async abrirMapa(arquivos, info) {
      const T = window.THREE, V = window.CompanhiaVRM;
      const nomes = [...arquivos.keys()];
      const principal = info.principal && arquivos.has(info.principal) ? info.principal
        : nomes.filter((n) => MODELO.test(n)).sort((a, b) => (/\.gl(b|tf)$/i.test(b) - /\.gl(b|tf)$/i.test(a)) || arquivos.get(b).size - arquivos.get(a).size)[0];
      if (!principal) throw new Error("Não achei um modelo 3D de cenário (.glb, .gltf, .fbx ou .obj) nesses arquivos.");
      // os arquivos ao lado do modelo (texturas, .bin) saem do próprio pacote, pelo nome
      const urls = [];
      const porNome = new Map(nomes.map((n) => [n.split("/").pop().toLowerCase(), n]));
      const base = principal.includes("/") ? principal.replace(/[^/]+$/, "") : "";
      const gerente = new T.LoadingManager();
      gerente.setURLModifier((url) => {
        if (/^(data|blob):/i.test(url)) return url;
        let limpo = url;
        try { limpo = decodeURIComponent(url); } catch (e) { /* fica como veio */ }
        limpo = limpo.replace(/^.*?:\/\/[^/]+\//, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/[?#].*$/, "");
        const achado = arquivos.has(base + limpo) ? base + limpo : arquivos.has(limpo) ? limpo : porNome.get(limpo.split("/").pop().toLowerCase());
        if (!achado) return PIXEL; // textura que não veio: um ponto branco, sem erro
        const u = URL.createObjectURL(arquivos.get(achado));
        urls.push(u);
        return u;
      });
      let objeto;
      const tipo = principal.split(".").pop().toLowerCase();
      try {
        if (tipo === "glb" || tipo === "gltf") {
          const carregador = new V.GLTFLoader(gerente);
          const draco = new V.DRACOLoader(gerente);
          draco.setDecoderPath(new URL("vendor/draco/", location.href).href);
          carregador.setDRACOLoader(draco);
          carregador.setMeshoptDecoder(V.MeshoptDecoder);
          const u = URL.createObjectURL(arquivos.get(principal));
          urls.push(u);
          try { objeto = (await carregador.loadAsync(u)).scene; }
          catch (e) { throw new Error(/KTX|basis/i.test(e.message) ? "Esse cenário usa texturas KTX2/Basis, que ainda não abrem aqui. Exporte com texturas PNG/JPEG." : "Não consegui abrir o cenário: " + e.message); }
          finally { draco.dispose(); }
        } else if (tipo === "fbx") {
          objeto = new V.FBXLoader(gerente).parse(await arquivos.get(principal).arrayBuffer(), "");
        } else {
          objeto = new V.OBJLoader(gerente).parse(await arquivos.get(principal).text());
          objeto.traverse((o) => { if (o.isMesh) o.material = new T.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.9 }); });
        }
      } finally { setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 30000); }
      let triangulos = 0;
      objeto.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = true;
        const g = o.geometry;
        triangulos += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      });
      if (!triangulos) throw new Error("Esse arquivo não tem nenhuma malha para servir de cenário.");
      this.tirarMapa();
      this.mapa = objeto;
      this.info = { id: info.id || null, nome: info.nome || principal.split("/").pop(), principal, ajuste: Object.assign({ escala: 0, giro: 0, deitado: false, partida: null }, info.ajuste || {}) };
      // tamanho: os FBX costumam vir em centímetros; um mapa "gigante" ou "minúsculo" é ajustado para caber uma pessoa
      const bruto = new T.Box3().setFromObject(objeto).getSize(new T.Vector3());
      const maior = Math.max(bruto.x, bruto.y, bruto.z) || 1;
      if (!this.info.ajuste.escala) this.info.ajuste.escala = maior > 2000 ? 0.01 : maior < 1 ? +(8 / maior).toPrecision(2) : 1;
      this.palco.cena.add(objeto);
      this.luzDoAmbiente();
      this.aplicarAjuste();
      if (this.andando) { this.chao.visible = false; this.partida(); } else this.partida();
      this.palco.enquadrar();
      this.palco.emit("mapa", this.info);
      return { triangulos: Math.round(triangulos), tamanho: this.caixa.getSize(new T.Vector3()).toArray().map((v) => +v.toFixed(1)) };
    }
    /** Aplica o tamanho e o giro do cenário e refaz a colisão. */
    aplicarAjuste() {
      const T = window.THREE, V = window.CompanhiaVRM;
      if (!this.mapa) return;
      const a = this.info.ajuste;
      this.mapa.scale.setScalar(limitar(+a.escala || 1, 1e-4, 1e4));
      this.mapa.rotation.set(a.deitado ? -Math.PI / 2 : 0, (+a.giro || 0) * Math.PI / 180, 0, "YXZ"); // deitado: o arquivo veio com o Z para cima
      this.mapa.updateMatrixWorld(true);
      this.caixa.setFromObject(this.mapa);
      if (this.colisor) { this.colisor.geometry.dispose(); this.colisor = null; }
      // todas as malhas viram uma só (só as posições), com a árvore que acelera a colisão
      const malhas = [];
      this.mapa.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position && o.visible) malhas.push(o); });
      const gerador = new V.StaticGeometryGenerator(malhas);
      gerador.attributes = ["position"];
      const geo = gerador.generate();
      geo.boundsTree = new V.MeshBVH(geo);
      this.colisor = new T.Mesh(geo);
    }
    /** Reflexos e luz ambiente para os materiais do cenário (uma sala clara neutra). */
    luzDoAmbiente() {
      const T = window.THREE, V = window.CompanhiaVRM;
      if (this.palco.cena.environment) return;
      try {
        const pmrem = new T.PMREMGenerator(this.palco.renderer);
        this.palco.cena.environment = pmrem.fromScene(new V.RoomEnvironment(), 0.04).texture;
        this.palco.cena.environmentIntensity = 0.7;
        pmrem.dispose();
      } catch (e) { console.warn("ambiente", e); }
    }
    tirarMapa() {
      if (!this.mapa) return;
      this.palco.cena.remove(this.mapa);
      this.mapa.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
      });
      if (this.colisor) { this.colisor.geometry.dispose(); this.colisor = null; }
      this.mapa = null;
      this.info = null;
      this.caixa.min.set(-30, 0, -30);
      this.caixa.max.set(30, 3, 30);
      this.chao.visible = this.andando;
      this.partida();
      this.palco.enquadrar();
      this.palco.emit("mapa", null);
    }
  }
  C.Mundo = Mundo;

  // ── Cenários guardados no aparelho ──────────────────────────────────
  C.mapas = {
    MODELO,
    async lista() { return (await LNUX.guardado.ler(LISTA)) || []; },
    /** Guarda um cenário: arquivos = Map caminho → Blob. Devolve o registro {id, nome, principal, tamanho, ajuste}. */
    async guardar(nome, arquivos, principal) {
      const id = LNUX.id("m");
      const itens = [...arquivos];
      const reg = { id, nome, principal: principal || null, tamanho: itens.reduce((s, [, b]) => s + b.size, 0), criado: Date.now(), ajuste: { escala: 0, giro: 0, partida: null } };
      await LNUX.guardado.gravar(chaveMapa(id), { arquivos: itens });
      const l = await C.mapas.lista();
      l.push(reg);
      await LNUX.guardado.gravar(LISTA, l);
      return reg;
    },
    async ler(id) { const r = await LNUX.guardado.ler(chaveMapa(id)); return r ? new Map(r.arquivos) : null; },
    async atualizar(reg) { const l = await C.mapas.lista(); const i = l.findIndex((x) => x.id === reg.id); if (i >= 0) { l[i] = { ...l[i], ...reg }; await LNUX.guardado.gravar(LISTA, l); } },
    async apagar(id) { await LNUX.guardado.apagar(chaveMapa(id)); await LNUX.guardado.gravar(LISTA, (await C.mapas.lista()).filter((x) => x.id !== id)); },
    /**
     * Arquivos escolhidos pela pessoa → Map caminho → Blob pronto para abrir. Abre ZIP e .unitypackage; explica
     * os formatos que não dá para abrir (mundos publicados do VRChat, cenas do Unity).
     */
    async preparar(arquivos) {
      const saida = new Map();
      for (const [nome, blob] of arquivos) {
        if (/\.(vrcw|vrca|unity3d|assetbundle|bundle)$/i.test(nome)) {
          const e = new Error("Esse é um mundo (ou avatar) já publicado do VRChat/Unity: um pacote fechado do motor Unity, que não abre fora dele. " +
            "Para usar um cenário aqui, abra o arquivo do projeto: o .blend do Blender, .fbx, .obj, .dae, glTF/GLB (no Unity, com o UnityGLTF ou \"Export GLB\") " +
            "ou o .unitypackage do mundo, que a Companhia lista os modelos de dentro. Ela converte tudo para .glb.");
          e.explicacao = true;
          throw e;
        }
        if (/\.unity$/i.test(nome)) { const e = new Error("Uma cena do Unity (.unity) só diz onde cada peça fica; os modelos estão em outros arquivos. Exporte a cena em glTF/GLB (UnityGLTF) e abra o .glb aqui."); e.explicacao = true; throw e; }
        if (/\.zip$/i.test(nome)) for (const [c, b] of await LNUX.Zip.ler(blob)) saida.set(c, b);
        else if (/\.unitypackage$/i.test(nome)) for (const [c, b] of await C.lerUnityPackage(blob)) saida.set(c, b);
        else saida.set(nome, blob);
      }
      for (const n of [...saida.keys()]) if (/(^|\/)(__MACOSX|\.DS_Store)/.test(n) || /\.(meta|cs|shader|mat|prefab|unity|asset|anim|controller|dll)$/i.test(n)) saida.delete(n);
      return saida;
    },
    modelos(arquivos) { return C.conversor.modelos(arquivos); },
  };
})();
