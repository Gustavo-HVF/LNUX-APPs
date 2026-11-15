/*
 * WEBC — minijogos de esporte (tênis, beisebol, boliche, golfe e boxe): a página JOGOS e o motor que os jogos usam.
 *
 * Cada jogo (js/esportes.js) se registra com C.minijogos.registrar({id, nome, descricao, opcoes, criar(ctx)}). Ao jogar,
 * abre uma tela cheia por cima do site com o cenário em 3D (three.js), o placar, os avisos, a barra de força e a pausa
 * (Esc). Os cenários e os bonecos são originais: cores vivas, formas simples e arredondadas.
 *
 * Os controles chegam aos jogos por uma "entrada" só, venham do mouse e teclado ou da câmera de movimento:
 *   - mira {x, y} (-1 a 1): o mouse sobre a tela, ou a mão direita em frente ao corpo (câmera);
 *   - "toque" (apertou: botão do mouse, Espaço, J/K) e "solta" (soltou, com a força carregada enquanto segurava);
 *   - "golpe" (câmera): um movimento rápido do braço, com a força (a velocidade do pulso), a direção e a mão;
 *   - guarda (as duas mãos na frente do rosto, ou S/Shift) e lado (inclinar o corpo, ou A/D e as setas).
 * A câmera usa o mesmo rastreamento da captura de movimento (js/captura.js, MediaPipe no próprio aparelho): só o
 * corpo, sem o rosto nem os dedos. Nada da imagem sai do aparelho.
 *
 * ctx (o que o jogo recebe): {T, cena, camera, entrada, hud, opcoes, cor, som(tipo), boneco(op), mat(cor), malha(geo,
 * cor), ceu(op), luzes(op), arquibancada(op), arvore(x, z, escala), fim(resultado), aleatorio(semente)}.
 * O jogo devolve {atualizar(dt), estado(), parar()?}.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => (C.t ? C.t(s, v) : s);
  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const JOGOS = [];
  const PREF = "webc.minijogos";
  const lerPref = () => { try { return JSON.parse(LNUX.preferencia.ler(PREF, "{}")) || {}; } catch (e) { return {}; } };
  const gravarPref = (p) => { try { LNUX.preferencia.gravar(PREF, JSON.stringify({ ...lerPref(), ...p })); } catch (e) { /* sem armazenamento */ } };

  // ── números que se repetem (sorteios com semente: o mesmo campo de golfe para a mesma partida) ──
  function aleatorio(semente = Date.now()) {
    let s = (Math.floor(semente) >>> 0) || 1;
    const f = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    f.entre = (a, b) => a + (b - a) * f();
    f.inteiro = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.escolher = (l) => l[Math.floor(f() * l.length)];
    return f;
  }

  // ── a entrada: mouse e teclado, ou a câmera de movimento ──────────────

  class Entrada {
    constructor(tela) {
      this.tela = tela;
      this.mira = { x: 0, y: 0 };
      this.apertado = false;
      this.carga = 0;
      this.guarda = false;
      this.lado = 0;
      this.teclas = new Set();
      this.ouvintes = {};
      this.modo = "mouse";
      this.pose = null;          // o último corpo visto pela câmera (para a tela mostrar e os testes conferirem)
      this.trilha = [];          // as últimas posições do mouse (para o efeito ao soltar)
      this.pulsos = { E: null, D: null };
      this.recarga = { E: 0, D: 0 };
      this.golpes = 0;
      this.inicioCarga = 0;
      this.maoCarga = "D";
      const pos = (e) => {
        const r = tela.getBoundingClientRect();
        this.mira.x = limitar(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
        this.mira.y = limitar(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1);
        this.trilha.push([performance.now(), this.mira.x, this.mira.y]);
        if (this.trilha.length > 30) this.trilha.shift();
      };
      this.ao = {
        move: (e) => { if (this.modo === "mouse") pos(e); },
        down: (e) => {
          if (e.button !== 0 && e.button !== 2) return;
          e.preventDefault();
          if (this.modo === "mouse") pos(e);
          try { tela.setPointerCapture(e.pointerId); } catch (x) { /* sem captura */ }
          this.apertar(e.button === 2 ? "E" : "D");
        },
        up: (e) => { if (e.button !== 0 && e.button !== 2) return; this.soltar(e.button === 2 ? "E" : "D"); },
        menu: (e) => e.preventDefault(),
        tecla: (e) => {
          if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
          const k = e.code;
          this.teclas.add(k);
          if (k === "Space" || k === "Enter") { e.preventDefault(); this.apertar("D"); }
          else if (k === "KeyJ") this.apertar("E");
          else if (k === "KeyK") this.apertar("D");
          this.atualizarTeclas();
          this.emitir("tecla", { codigo: k });
        },
        teclaSolta: (e) => {
          const k = e.code;
          this.teclas.delete(k);
          if (k === "Space" || k === "Enter") this.soltar("D");
          else if (k === "KeyJ") this.soltar("E");
          else if (k === "KeyK") this.soltar("D");
          this.atualizarTeclas();
        },
        sumiu: () => { this.teclas.clear(); this.atualizarTeclas(); if (this.apertado) this.soltar(this.maoCarga); },
      };
      tela.addEventListener("pointermove", this.ao.move);
      tela.addEventListener("pointerdown", this.ao.down);
      tela.addEventListener("pointerup", this.ao.up);
      tela.addEventListener("contextmenu", this.ao.menu);
      window.addEventListener("keydown", this.ao.tecla);
      window.addEventListener("keyup", this.ao.teclaSolta);
      window.addEventListener("blur", this.ao.sumiu);
    }
    on(nome, f) { (this.ouvintes[nome] = this.ouvintes[nome] || []).push(f); return () => { this.ouvintes[nome] = (this.ouvintes[nome] || []).filter((x) => x !== f); }; }
    emitir(nome, dados) { for (const f of (this.ouvintes[nome] || []).slice()) { try { f(dados); } catch (e) { console.error(e); } } }
    limparOuvintes() { this.ouvintes = {}; }
    atualizarTeclas() {
      const k = this.teclas;
      if (this.modo === "mouse" || !this.pose) {
        this.lado = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
        this.guarda = k.has("KeyS") || k.has("ArrowDown") || k.has("ShiftLeft") || k.has("ShiftRight");
      }
    }
    apertar(mao) {
      this.apertado = true;
      this.maoCarga = mao;
      this.inicioCarga = performance.now();
      this.carga = 0;
      this.emitir("toque", { mao, origem: "mouse" });
    }
    soltar(mao) {
      if (!this.apertado) return;
      this.apertado = false;
      const agora = performance.now(), r = this.trilha.filter((p) => agora - p[0] < 260);
      const dx = r.length > 1 ? (r[r.length - 1][1] - r[0][1]) / Math.max(0.05, (r[r.length - 1][0] - r[0][0]) / 1000) : 0;
      const forca = this.carga;
      this.carga = 0;
      this.emitir("solta", { mao, forca, dx: limitar(dx / 4, -1, 1), origem: "mouse" });
    }
    /** A cada quadro: a força que vai enchendo enquanto segura (1,1 s até o máximo). */
    atualizar() {
      if (this.apertado) this.carga = limitar((performance.now() - this.inicioCarga) / 1100);
      if (this.pose && performance.now() - this.pose.t > 1500) this.pose = null; // a pessoa saiu da frente da câmera
    }
    /**
     * Um quadro da câmera (o resultado do rastreamento: {corpo: {imagem, mundo}}). Os pontos do MediaPipe: 0 nariz,
     * 11/12 ombros, 15/16 pulsos (esquerdo/direito da pessoa). Na imagem, x vai da esquerda para a direita da foto:
     * espelhado, o lado direito da pessoa fica à direita da tela (como num espelho).
     */
    receberPose(r) {
      const corpo = r && r.corpo;
      if (!corpo || !corpo.imagem || corpo.imagem.length < 17) return;
      // o horário do quadro da câmera (o rastreamento manda): a velocidade não depende de quanto a tela demorou para desenhar
      const agora = typeof r.t === "number" ? r.t : performance.now(), im = corpo.imagem, mu = corpo.mundo || corpo.imagem;
      const ponto = (i) => ({ x: 1 - im[i][0], y: im[i][1], v: im[i][3] === undefined ? 1 : im[i][3] });
      const oE = ponto(11), oD = ponto(12), nariz = ponto(0);
      if (oE.v < 0.3 || oD.v < 0.3) return;
      const centro = { x: (oE.x + oD.x) / 2, y: (oE.y + oD.y) / 2 }, largura = Math.max(0.05, Math.abs(oE.x - oD.x));
      const mE = ponto(15), mD = ponto(16);
      const rel = (m) => ({ x: limitar((m.x - centro.x) / (largura * 1.6), -1, 1), y: limitar(-(m.y - centro.y) / (largura * 1.6), -1, 1) });
      if (mD.v > 0.3) this.mira = rel(mD); else if (mE.v > 0.3) this.mira = rel(mE);
      this.lado = limitar((nariz.x - centro.x) / (largura * 0.45), -1, 1);
      if (Math.abs(this.lado) < 0.18) this.lado = 0;
      const perto = (m) => m.v > 0.3 && m.y < centro.y + largura * 0.15 && Math.abs(m.x - nariz.x) < largura * 0.9;
      this.guarda = perto(mE) && perto(mD);
      this.pose = { t: performance.now(), centro, largura, mE: rel(mE), mD: rel(mD), guarda: this.guarda, lado: this.lado };
      // os golpes: a velocidade de cada pulso (em metros por segundo, no espaço do corpo); o golpe sai no pico
      for (const [mao, i] of [["E", 15], ["D", 16]]) {
        const p = { x: mu[i][0], y: mu[i][1], z: mu[i][2], sx: 1 - im[i][0], sy: im[i][1], v: im[i][3] === undefined ? 1 : im[i][3], t: agora };
        const a = this.pulsos[mao];
        this.pulsos[mao] = p;
        if (!a || p.v < 0.3 || a.v < 0.3) continue;
        const dt = Math.max(0.016, (p.t - a.t) / 1000);
        if (dt > 0.25) { p.vel = 0; continue; }
        const escala = corpo.mundo ? 1 : 1.6 / largura; // sem os pontos em metros: a imagem medida pelos ombros
        const vel = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) * escala / dt;
        p.vel = a.vel === undefined ? vel : a.vel * 0.35 + vel * 0.65;
        p.vx = (p.sx - a.sx) / largura / dt;
        p.vy = -(p.sy - a.sy) / largura / dt;
        p.pico = Math.max(a.pico || 0, p.vel);
        p.dirx = Math.abs(p.vx) > Math.abs(a.dirx || 0) ? p.vx : a.dirx || 0;
        p.diry = Math.abs(p.vy) > Math.abs(a.diry || 0) ? p.vy : a.diry || 0;
        if (p.vel > 1.9 && a.vel !== undefined && p.vel < a.vel && agora > this.recarga[mao]) {
          // passou do pico: o golpe sai
          const forca = limitar((p.pico - 1.6) / 4.2);
          this.recarga[mao] = agora + 420;
          this.golpes++;
          this.emitir("golpe", { mao, forca: Math.max(0.15, forca), dx: limitar(p.dirx / 6, -1, 1), dy: limitar(p.diry / 6, -1, 1), origem: "camera", altura: this.pose[mao === "E" ? "mE" : "mD"].y });
          p.pico = 0; p.dirx = 0; p.diry = 0;
        } else if (p.vel < 1.2) { p.pico = 0; p.dirx = 0; p.diry = 0; }
      }
      this.emitir("pose", this.pose);
    }
    soltarTudo() {
      const tela = this.tela;
      tela.removeEventListener("pointermove", this.ao.move);
      tela.removeEventListener("pointerdown", this.ao.down);
      tela.removeEventListener("pointerup", this.ao.up);
      tela.removeEventListener("contextmenu", this.ao.menu);
      window.removeEventListener("keydown", this.ao.tecla);
      window.removeEventListener("keyup", this.ao.teclaSolta);
      window.removeEventListener("blur", this.ao.sumiu);
      this.ouvintes = {};
    }
  }

  // ── som: bipes feitos na hora (sem arquivos) ──────────────────────────

  function criarSom() {
    let ac = null;
    const ligado = () => lerPref().som !== false;
    const tocar = (tipo) => {
      if (!ligado()) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === "suspended") ac.resume();
        const agora = ac.currentTime, g = ac.createGain();
        g.connect(ac.destination);
        const tom = (f, d, tipoOnda = "sine", vol = 0.25, ate = f) => {
          const o = ac.createOscillator(), gg = ac.createGain();
          o.type = tipoOnda; o.frequency.setValueAtTime(f, agora); o.frequency.exponentialRampToValueAtTime(Math.max(20, ate), agora + d);
          gg.gain.setValueAtTime(vol, agora); gg.gain.exponentialRampToValueAtTime(0.001, agora + d);
          o.connect(gg); gg.connect(g); o.start(agora); o.stop(agora + d + 0.02);
        };
        const ruido = (d, vol = 0.3, filtro = 1200) => {
          const n = Math.floor(ac.sampleRate * d), b = ac.createBuffer(1, n, ac.sampleRate), x = b.getChannelData(0);
          for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n);
          const s = ac.createBufferSource(), f = ac.createBiquadFilter(), gg = ac.createGain();
          s.buffer = b; f.type = "lowpass"; f.frequency.value = filtro; gg.gain.value = vol;
          s.connect(f); f.connect(gg); gg.connect(g); s.start(agora);
        };
        ({
          bola: () => { tom(520, 0.08, "triangle", 0.3, 300); ruido(0.05, 0.15, 3000); },
          quique: () => tom(220, 0.06, "sine", 0.2, 140),
          rebatida: () => { tom(900, 0.06, "square", 0.12, 400); ruido(0.08, 0.3, 4000); },
          pinos: () => { ruido(0.45, 0.45, 2200); tom(300, 0.25, "triangle", 0.12, 180); },
          rolar: () => ruido(0.3, 0.12, 400),
          soco: () => { ruido(0.12, 0.5, 900); tom(120, 0.12, "sine", 0.35, 60); },
          defesa: () => { ruido(0.08, 0.3, 600); tom(200, 0.06, "square", 0.08, 150); },
          sino: () => { tom(1250, 0.9, "sine", 0.25, 1240); tom(1870, 0.7, "sine", 0.1, 1860); },
          apito: () => tom(2300, 0.35, "square", 0.08, 2200),
          ponto: () => { tom(660, 0.12, "triangle", 0.25); setTimeout(() => tocar("ponto2"), 110); },
          ponto2: () => tom(990, 0.18, "triangle", 0.25),
          erro: () => tom(260, 0.3, "sawtooth", 0.08, 140),
          torcida: () => ruido(1.4, 0.18, 1600),
          buraco: () => { tom(700, 0.1, "sine", 0.3, 500); setTimeout(() => tocar("ponto"), 160); },
        }[tipo] || (() => {}))();
      } catch (e) { /* sem som neste navegador */ }
    };
    tocar.fechar = () => { try { if (ac) ac.close(); } catch (e) { /* já fechou */ } ac = null; };
    return tocar;
  }

  // ── peças do cenário ──────────────────────────────────────────────────

  let gradiente = null;
  function materialDe(T, cor, op = {}) {
    if (!gradiente) {
      const d = new Uint8Array([90, 170, 235, 255]);
      gradiente = new T.DataTexture(d, 4, 1, T.RedFormat);
      gradiente.minFilter = gradiente.magFilter = T.NearestFilter;
      gradiente.needsUpdate = true;
    }
    return new T.MeshToonMaterial({ color: new T.Color(cor), gradientMap: gradiente, transparent: !!op.transparente, opacity: op.opacidade ?? 1, ...(op.mapa ? { map: op.mapa } : {}), ...(op.emissivo ? { emissive: new T.Color(op.emissivo) } : {}) });
  }
  function malhaDe(T, geo, cor, op = {}) {
    const m = new T.Mesh(geo, cor && cor.isMaterial ? cor : materialDe(T, cor, op));
    m.castShadow = op.sombra !== false;
    m.receiveShadow = op.recebe !== false;
    return m;
  }

  /** Um boneco original (arredondado, de uma cor só, com rosto simples). Olha para +Z. */
  function bonecoDe(T, { cor = "#3d7bff", pele = "#f3c9a1", cabelo = "#3b2a20", calca = "#2b3550", escala = 1, luvas = null, nome = "" } = {}) {
    const g = new T.Group();
    g.name = nome;
    const corpo = new T.Group();
    g.add(corpo);
    const m = (geo, c) => malhaDe(T, geo, c);
    const quadril = new T.Group();
    quadril.position.y = 0.78;
    corpo.add(quadril);
    const tronco = new T.Group();
    quadril.add(tronco);
    const peito = m(new T.CapsuleGeometry(0.21, 0.34, 6, 14), cor);
    peito.position.y = 0.33;
    peito.scale.set(1.1, 1, 0.8);
    peito.userData.uniforme = true; // a cor do time (o beisebol troca entre as metades da entrada)
    tronco.add(peito);
    const cabeca = new T.Group();
    cabeca.position.y = 0.86;
    tronco.add(cabeca);
    const rosto = m(new T.SphereGeometry(0.2, 20, 16), pele);
    cabeca.add(rosto);
    const topo = m(new T.SphereGeometry(0.206, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.48), cabelo);
    topo.rotation.x = -0.25;
    cabeca.add(topo);
    for (const x of [-0.07, 0.07]) {
      const olho = m(new T.SphereGeometry(0.028, 10, 8), "#1d1f27");
      olho.position.set(x, 0.02, 0.18);
      olho.scale.z = 0.5;
      cabeca.add(olho);
    }
    const boca = m(new T.TorusGeometry(0.045, 0.011, 6, 12, Math.PI), "#9b3d3d");
    boca.position.set(0, -0.07, 0.185);
    boca.rotation.z = Math.PI;
    cabeca.add(boca);
    const membro = (lado, alto, comprimento, raio, corM, ponta) => {
      const piv = new T.Group();
      piv.position.set(lado, alto, 0);
      const parte = m(new T.CapsuleGeometry(raio, comprimento, 4, 10), corM);
      if (corM === cor) parte.userData.uniforme = true;
      parte.position.y = -comprimento / 2 - raio * 0.4;
      piv.add(parte);
      const fim = new T.Group();
      fim.position.y = -comprimento - raio;
      piv.add(fim);
      if (ponta) fim.add(ponta);
      return { piv, fim };
    };
    const mao = (c, r) => m(new T.SphereGeometry(r, 12, 10), c);
    // olhando para +Z, a direita do boneco fica em -X
    const bD = membro(-0.29, 0.56, 0.4, 0.065, cor, mao(luvas || pele, luvas ? 0.11 : 0.075));
    const bE = membro(0.29, 0.56, 0.4, 0.065, cor, mao(luvas || pele, luvas ? 0.11 : 0.075));
    tronco.add(bD.piv, bE.piv);
    const pD = membro(-0.11, 0, 0.5, 0.085, calca, null);
    const pE = membro(0.11, 0, 0.5, 0.085, calca, null);
    for (const p of [pD, pE]) { const pe = m(new T.BoxGeometry(0.13, 0.08, 0.24), "#e9ecf2"); pe.position.set(0, -0.03, 0.05); p.fim.add(pe); quadril.add(p.piv); }
    g.scale.setScalar(escala);
    // a pose: ângulos (radianos) que vão suavemente até o alvo; animar() toca uma sequência de poses
    const juntas = { ombroD: bD.piv, ombroE: bE.piv, pernaD: pD.piv, pernaE: pE.piv, tronco, cabeca, quadril };
    const alvo = {}, base = {};
    for (const [k, o] of Object.entries(juntas)) { alvo[k] = [0, 0, 0]; base[k] = [o.rotation.x, o.rotation.y, o.rotation.z]; }
    let anim = null, tempo = 0, andar = 0;
    const b = {
      grupo: g, corpo, quadril, tronco, cabeca, mao: { D: bD.fim, E: bE.fim }, juntas, alto: 0,
      /** Os ângulos de descanso (o que vale quando nenhuma animação toca). */
      descanso: { ombroD: [0, 0, -0.12], ombroE: [0, 0, 0.12] },
      andando: 0,
      pose(p) { for (const [k, v] of Object.entries(p)) if (alvo[k]) alvo[k] = v.slice(); },
      /** quadros: [{t (0 a 1), pose}], duracao (s). */
      animar(quadros, duracao, aoFim) { anim = { quadros, duracao, t: 0, aoFim }; },
      get animando() { return !!anim; },
      atualizar(dt) {
        tempo += dt;
        let atual = {};
        for (const k of Object.keys(juntas)) atual[k] = (b.descanso[k] || [0, 0, 0]).slice();
        if (b.andando > 0.01) {
          andar += dt * 9 * b.andando;
          const s = Math.sin(andar) * 0.6 * b.andando;
          atual.pernaD = [s, 0, 0]; atual.pernaE = [-s, 0, 0];
          if (!anim) { atual.ombroD[0] -= s * 0.6; atual.ombroE[0] += s * 0.6; }
        }
        if (anim) {
          anim.t += dt / anim.duracao;
          const q = anim.quadros;
          let i = 0;
          while (i < q.length - 1 && q[i + 1].t <= anim.t) i++;
          const a = q[i], c = q[Math.min(q.length - 1, i + 1)];
          const k = c === a ? 1 : limitar((anim.t - a.t) / (c.t - a.t));
          const e = k * k * (3 - 2 * k);
          for (const nome of Object.keys(juntas)) {
            const va = a.pose[nome], vc = c.pose[nome];
            if (!va && !vc) continue;
            const x = va || atual[nome], y = vc || atual[nome];
            atual[nome] = [0, 1, 2].map((j) => x[j] + (y[j] - x[j]) * e);
          }
          if (anim.t >= 1) { const f = anim.aoFim; anim = null; if (f) f(); }
        } else {
          for (const [k, v] of Object.entries(alvo)) if (v.some((x) => x)) atual[k] = v;
        }
        // respirar
        atual.tronco = atual.tronco.slice();
        atual.tronco[0] += Math.sin(tempo * 2.2) * 0.015;
        for (const [k, o] of Object.entries(juntas)) {
          const v = atual[k], s = 1 - Math.exp(-dt * 18);
          o.rotation.x += (base[k][0] + v[0] - o.rotation.x) * s;
          o.rotation.y += (base[k][1] + v[1] - o.rotation.y) * s;
          o.rotation.z += (base[k][2] + v[2] - o.rotation.z) * s;
        }
        corpo.position.y = b.alto + Math.abs(Math.sin(andar)) * 0.04 * b.andando;
      },
      /** Põe um objeto na mão (a raquete, o taco...). Ele aponta para baixo do braço (-Y) a partir da mão. */
      segurar(obj, lado = "D") { b.mao[lado].add(obj); return obj; },
    };
    return b;
  }

  /** O céu (um degradê) e a névoa no horizonte. */
  function ceuDe(T, cena, { cima = "#4aa3ff", baixo = "#d9f1ff", nevoa = null, perto = 60, longe = 260 } = {}) {
    const tela = document.createElement("canvas");
    tela.width = 4; tela.height = 256;
    const g = tela.getContext("2d"), d = g.createLinearGradient(0, 0, 0, 256);
    d.addColorStop(0, cima); d.addColorStop(0.62, baixo); d.addColorStop(1, baixo);
    g.fillStyle = d; g.fillRect(0, 0, 4, 256);
    const tex = new T.CanvasTexture(tela);
    tex.colorSpace = T.SRGBColorSpace;
    cena.background = tex;
    cena.fog = new T.Fog(nevoa || baixo, perto, longe);
  }
  /** O sol (com sombras numa caixa em volta do centro) e a luz do céu. */
  function luzesDe(T, cena, { raio = 30, centro = [0, 0, 0], intensidade = 2.2, de = [18, 30, 12], ambiente = 1.1 } = {}) {
    const ceu = new T.HemisphereLight("#e8f4ff", "#7f9a6a", ambiente);
    cena.add(ceu);
    const sol = new T.DirectionalLight("#fff6e6", intensidade);
    sol.position.set(centro[0] + de[0], centro[1] + de[1], centro[2] + de[2]);
    sol.target.position.set(...centro);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    const s = sol.shadow.camera;
    s.left = -raio; s.right = raio; s.top = raio; s.bottom = -raio; s.near = 1; s.far = 140;
    sol.shadow.bias = -0.0006;
    sol.shadow.normalBias = 0.02;
    cena.add(sol, sol.target);
    return { sol, ceu };
  }
  /** Uma arquibancada com a torcida (bonequinhos coloridos que pulam quando alguém faz ponto). */
  function arquibancadaDe(T, cena, { largura = 20, filas = 5, x = 0, z = 0, giro = 0, cor = "#c7ccd8", semente = 7 } = {}) {
    const r = aleatorio(semente), g = new T.Group();
    g.position.set(x, 0, z);
    g.rotation.y = giro;
    for (let i = 0; i < filas; i++) {
      const degrau = malhaDe(T, new T.BoxGeometry(largura, 0.5 * (i + 1), 0.9), i % 2 ? cor : "#b4bac8", { sombra: false });
      degrau.position.set(0, 0.25 * (i + 1), -i * 0.9);
      g.add(degrau);
    }
    const porFila = Math.floor(largura / 0.7), total = porFila * filas;
    const geo = new T.CapsuleGeometry(0.17, 0.3, 3, 8);
    const pessoas = new T.InstancedMesh(geo, materialDe(T, "#ffffff"), total);
    const cores = ["#ff6b6b", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8e7dff", "#f78c40", "#4cc9f0", "#ffffff"];
    const m4 = new T.Matrix4(), base = [];
    let n = 0;
    for (let i = 0; i < filas; i++) for (let j = 0; j < porFila; j++) {
      if (r() < 0.12) continue;
      const px = -largura / 2 + 0.35 + j * 0.7 + r.entre(-0.08, 0.08), py = 0.5 * (i + 1) + 0.33, pz = -i * 0.9;
      base.push([px, py, pz, r() * 6.28]);
      m4.makeTranslation(px, py, pz);
      pessoas.setMatrixAt(n, m4);
      pessoas.setColorAt(n, new T.Color(r.escolher(cores)));
      n++;
    }
    pessoas.count = n;
    pessoas.castShadow = false;
    g.add(pessoas);
    cena.add(g);
    let festa = 0, tempo = 0;
    return {
      grupo: g,
      comemorar(s = 1.6) { festa = Math.max(festa, s); },
      atualizar(dt) {
        tempo += dt;
        if (festa <= 0) return;
        festa -= dt;
        for (let i = 0; i < base.length; i++) {
          const [px, py, pz, f] = base[i];
          m4.makeTranslation(px, py + Math.max(0, Math.sin(tempo * 12 + f)) * 0.25 * Math.min(1, festa), pz);
          pessoas.setMatrixAt(i, m4);
        }
        pessoas.instanceMatrix.needsUpdate = true;
      },
    };
  }
  function arvoreDe(T, cena, x, z, escala = 1, cor = "#3f9d4a") {
    const g = new T.Group();
    const tronco = malhaDe(T, new T.CylinderGeometry(0.18, 0.25, 1.6, 8), "#8a5a35");
    tronco.position.y = 0.8;
    const copa = malhaDe(T, new T.SphereGeometry(1.2, 12, 10), cor);
    copa.position.y = 2.3;
    copa.scale.y = 1.15;
    g.add(tronco, copa);
    g.position.set(x, 0, z);
    g.scale.setScalar(escala);
    cena.add(g);
    return g;
  }

  // ── a tela do jogo ────────────────────────────────────────────────────

  let atual = null;

  /** Abre um minijogo em tela cheia. Devolve uma Promise que resolve quando a pessoa sai. */
  async function abrir(id, opcoes = {}, { captura = null } = {}) {
    const def = JOGOS.find((j) => j.id === id);
    if (!def) throw new Error(t("Esse jogo não existe."));
    if (atual) atual.sair();
    await C.prepararVRM(); // o three.js vem no pacote do three-vrm
    const T = window.THREE;
    let fechar;
    const terminou = new Promise((ok) => (fechar = ok));
    const tela = el("canvas", { class: "mj-tela", tabindex: "0", "aria-label": t(def.nome) });
    const placar = el("div", { class: "mj-placar", "aria-live": "polite" });
    const aviso = el("div", { class: "mj-aviso", "aria-live": "assertive" });
    const dica = el("div", { class: "mj-dica" });
    const barra = el("div", { class: "mj-barra", hidden: true }, el("span"));
    const estadoCamera = el("span", { class: "mj-camera-estado" });
    const botaoCamera = el("button", { type: "button", class: "lnux-botao pequeno mj-botao-camera", "aria-pressed": "false", onclick: () => alternarCamera() }, t("Câmera de movimento"));
    const botaoPausa = el("button", { type: "button", class: "lnux-botao pequeno", "aria-label": t("Pausar"), onclick: () => pausar(true) }, t("Pausar"));
    const camadaPausa = el("div", { class: "mj-pausa", hidden: true });
    const raiz = el("div", { class: "minijogo", role: "dialog", "aria-modal": "true", "aria-label": t(def.nome), "data-jogo": id },
      tela, el("div", { class: "mj-topo" }, el("b", { class: "mj-nome" }, t(def.nome)), placar, el("span", { class: "mj-espaco" }), estadoCamera, botaoCamera, botaoPausa),
      aviso, barra, dica, camadaPausa);
    document.body.append(raiz);
    document.documentElement.classList.add("com-minijogo");
    const renderer = new T.WebGLRenderer({ canvas: tela, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const cena = new T.Scene();
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 600);
    const entrada = new Entrada(tela);
    const som = criarSom();
    const cor = (C.contas && C.contas.eu && C.contas.eu.perfil && C.contas.eu.perfil.cor) || lerPref().cor || "#2f7bff";
    let pausado = false, acabou = false, jogo = null, avisoAte = 0, pedido = 0, ultimo = performance.now(), cameraPropria = null, pararDeOuvir = null;

    const hud = {
      placar(conteudo) { if (typeof conteudo === "string") placar.textContent = conteudo; else placar.replaceChildren(...[].concat(conteudo).filter(Boolean)); },
      aviso(texto, ms = 1600, tipo = "") {
        aviso.textContent = texto;
        aviso.className = "mj-aviso visivel" + (tipo ? " " + tipo : "");
        avisoAte = performance.now() + ms;
      },
      dica(texto) { dica.textContent = texto || ""; dica.hidden = !texto; },
      /** A barra de força (0 a 1), ou null para esconder. */
      barra(v, rotulo = "") {
        barra.hidden = v === null || v === undefined;
        if (!barra.hidden) { barra.firstChild.style.width = Math.round(limitar(v) * 100) + "%"; barra.dataset.rotulo = rotulo; }
      },
    };
    function redimensionar() {
      const w = raiz.clientWidth || window.innerWidth, h = raiz.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const observador = new ResizeObserver(redimensionar);
    observador.observe(raiz);

    async function alternarCamera(ligar = entrada.modo !== "camera") {
      if (!ligar) {
        entrada.modo = "mouse"; entrada.pose = null; entrada.atualizarTeclas();
        if (pararDeOuvir) { pararDeOuvir(); pararDeOuvir = null; }
        if (cameraPropria) { cameraPropria.desligar(); cameraPropria = null; }
        botaoCamera.setAttribute("aria-pressed", "false"); estadoCamera.textContent = "";
        gravarPref({ camera: false });
        hud.dica(jogo && jogo.dica ? jogo.dica("mouse") : "");
        return;
      }
      try {
        let fonte = captura && captura.ligada ? captura : null; // a captura do jogo já ligada: usa a mesma câmera
        if (!fonte) {
          if (!C.Captura) throw new Error(t("A câmera de movimento não está disponível aqui."));
          cameraPropria = new C.Captura({ conteiner: raiz, aoEstado: (texto, tipo) => { estadoCamera.textContent = texto ? t(texto) : ""; if (tipo === "erro") LNUX.aviso(t(texto), "erro"); } });
          cameraPropria.cfg = { ...cameraPropria.cfg, rosto: false, maos: false, corpo: true, previa: true, espelhar: true };
          fonte = cameraPropria;
          pararDeOuvir = fonte.ouvir((r) => entrada.receberPose(r));
          await fonte.ligar();
        } else pararDeOuvir = fonte.ouvir((r) => entrada.receberPose(r));
        entrada.modo = "camera";
        botaoCamera.setAttribute("aria-pressed", "true");
        estadoCamera.textContent = t("Fique de frente para a câmera, com os ombros e as mãos à vista.");
        gravarPref({ camera: true });
        hud.dica(jogo && jogo.dica ? jogo.dica("camera") : "");
      } catch (e) {
        if (pararDeOuvir) { pararDeOuvir(); pararDeOuvir = null; }
        if (cameraPropria) { cameraPropria.desligar(); cameraPropria = null; }
        entrada.modo = "mouse";
        estadoCamera.textContent = "";
        LNUX.erro(e);
      }
    }
    /** Para os testes (e para outro rastreador): usa resultados prontos no lugar da câmera. */
    function simularCamera() {
      entrada.modo = "camera";
      botaoCamera.setAttribute("aria-pressed", "true");
      hud.dica(jogo && jogo.dica ? jogo.dica("camera") : "");
      return (r) => entrada.receberPose(r);
    }

    function pausar(sim) {
      if (acabou) return;
      pausado = sim;
      camadaPausa.hidden = !sim;
      if (sim) {
        camadaPausa.replaceChildren(el("div", { class: "mj-cartao" },
          el("h2", {}, t("Pausa")),
          el("p", { class: "fraco" }, jogo && jogo.dica ? jogo.dica(entrada.modo) : ""),
          el("div", { class: "mj-acoes" },
            el("button", { type: "button", class: "lnux-botao primario", "data-acao": "continuar", onclick: () => pausar(false) }, t("Continuar")),
            el("button", { type: "button", class: "lnux-botao", "data-acao": "reiniciar", onclick: () => reiniciar() }, t("Recomeçar")),
            el("button", { type: "button", class: "lnux-botao", "data-acao": "som", onclick: (e) => { const ligado = lerPref().som === false; gravarPref({ som: ligado }); e.currentTarget.textContent = ligado ? t("Som: ligado") : t("Som: desligado"); } }, lerPref().som === false ? t("Som: desligado") : t("Som: ligado")),
            el("button", { type: "button", class: "lnux-botao perigo", "data-acao": "sair", onclick: () => sair() }, t("Sair do jogo")))));
        const b = camadaPausa.querySelector("[data-acao=continuar]");
        if (b) b.focus();
      } else { ultimo = performance.now(); tela.focus(); }
    }
    function fim(resultado = {}) {
      if (acabou) return;
      acabou = true;
      hud.barra(null);
      som(resultado.vitoria ? "torcida" : "apito");
      camadaPausa.hidden = false;
      camadaPausa.replaceChildren(el("div", { class: "mj-cartao mj-fim", "data-vitoria": resultado.vitoria ? "1" : "0" },
        el("h2", {}, resultado.titulo || t("Fim de jogo")),
        resultado.subtitulo ? el("p", { class: "mj-subtitulo" }, resultado.subtitulo) : null,
        resultado.tabela || null,
        (resultado.linhas || []).length ? el("ul", { class: "mj-linhas" }, resultado.linhas.map((l) => el("li", {}, l))) : null,
        el("div", { class: "mj-acoes" },
          el("button", { type: "button", class: "lnux-botao primario", "data-acao": "de-novo", onclick: () => reiniciar() }, t("Jogar de novo")),
          el("button", { type: "button", class: "lnux-botao", "data-acao": "sair", onclick: () => sair() }, t("Escolher outro jogo")))));
      const b = camadaPausa.querySelector("[data-acao=de-novo]");
      if (b) b.focus();
      sessao.resultado = resultado;
    }
    function limparCena() {
      cena.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); }
      });
      if (cena.background && cena.background.dispose) cena.background.dispose();
      cena.clear();
      cena.background = null;
      cena.fog = null;
    }
    function iniciar() {
      limparCena();
      entrada.limparOuvintes();
      hud.placar(""); hud.dica(""); hud.barra(null);
      aviso.className = "mj-aviso";
      acabou = false;
      pausado = false;
      camadaPausa.hidden = true;
      sessao.resultado = null;
      const ctx = {
        T, cena, camera, entrada, hud, opcoes: { ...opcoes }, cor, som, fim, aleatorio, renderer, elemento: raiz,
        mat: (c, op) => materialDe(T, c, op),
        malha: (geo, c, op) => malhaDe(T, geo, c, op),
        boneco: (op) => { const b = bonecoDe(T, op); cena.add(b.grupo); return b; },
        ceu: (op) => ceuDe(T, cena, op),
        luzes: (op) => luzesDe(T, cena, op),
        arquibancada: (op) => arquibancadaDe(T, cena, op),
        arvore: (x, z, e, c) => arvoreDe(T, cena, x, z, e, c),
      };
      jogo = def.criar(ctx);
      sessao.jogo = jogo;
      hud.dica(jogo.dica ? jogo.dica(entrada.modo) : "");
      redimensionar();
      ultimo = performance.now();
    }
    function reiniciar() { if (jogo && jogo.parar) jogo.parar(); iniciar(); tela.focus(); }
    function quadro(agora) {
      pedido = requestAnimationFrame(quadro);
      const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000)) * sessao.velocidade;
      ultimo = agora;
      entrada.atualizar();
      if (avisoAte && agora > avisoAte) { aviso.className = "mj-aviso"; avisoAte = 0; }
      if (!pausado && !acabou && jogo) {
        try { jogo.atualizar(dt); } catch (e) { console.error(e); pausar(true); LNUX.erro(e); }
      } else if (acabou && jogo && jogo.atualizarFim) jogo.atualizarFim(dt);
      renderer.render(cena, camera);
    }
    const teclas = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector(".lnux-fundo-modal")) return;
      if (acabou) sair(); else pausar(!pausado);
    };
    document.addEventListener("keydown", teclas, true);
    function sair() {
      if (!atual || atual !== sessao) return;
      cancelAnimationFrame(pedido);
      document.removeEventListener("keydown", teclas, true);
      observador.disconnect();
      if (jogo && jogo.parar) jogo.parar();
      if (pararDeOuvir) pararDeOuvir();
      if (cameraPropria) cameraPropria.desligar();
      entrada.soltarTudo();
      limparCena();
      renderer.dispose();
      som.fechar();
      raiz.remove();
      document.documentElement.classList.remove("com-minijogo");
      atual = null;
      C.minijogos.atual = null;
      fechar(sessao.resultado);
    }
    const sessao = { id, def, opcoes, entrada, hud, cena, camera, renderer, jogo: null, resultado: null, velocidade: 1, elemento: raiz,
      sair, pausar, reiniciar, alternarCamera, simularCamera, get pausado() { return pausado; }, get acabou() { return acabou; } };
    atual = sessao;
    C.minijogos.atual = sessao;
    iniciar();
    pedido = requestAnimationFrame(quadro);
    tela.focus();
    if (lerPref().camera && navigator.mediaDevices) alternarCamera(true).catch(() => {});
    return Object.assign(terminou, { sessao });
  }

  // ── a página JOGOS ────────────────────────────────────────────────────

  const ICONES = {
    tenis: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><ellipse cx="26" cy="24" rx="14" ry="17" transform="rotate(-35 26 24)"/><path d="M35 37l14 14"/><path d="M17 15l17 17M14 25l13 13M24 12l13 13"/><circle cx="50" cy="20" r="5" fill="currentColor" stroke="none"/></svg>',
    beisebol: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M10 54l30-38a4 4 0 0 1 6 5L16 59z"/><circle cx="46" cy="46" r="9"/><path d="M40 40c3 2 4 6 3 9M52 52c-3-2-4-6-3-9"/></svg>',
    boliche: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><circle cx="22" cy="40" r="14"/><circle cx="18" cy="35" r="1.8" fill="currentColor"/><circle cx="24" cy="33" r="1.8" fill="currentColor"/><circle cx="22" cy="40" r="1.8" fill="currentColor"/><path d="M46 8c-3 0-4 4-3 8 1 3-3 6-3 14 0 9 3 18 6 26 3-8 6-17 6-26 0-8-4-11-3-14 1-4 0-8-3-8z"/><path d="M42 18h8"/></svg>',
    golfe: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M24 54V8l22 9-22 9"/><ellipse cx="32" cy="54" rx="22" ry="5"/><circle cx="46" cy="47" r="3" fill="currentColor" stroke="none"/></svg>',
    boxe: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M18 32c-4-8-2-20 10-22 8-1 14 2 16 8h4c4 0 6 3 6 7v6c0 6-4 10-10 11v10H22V44c-3-3-4-7-4-12z"/><path d="M44 18c-6 0-9 4-9 9M22 44h22"/></svg>',
    jogos: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M14 22h36c6 0 10 6 10 16s-4 14-8 14c-5 0-7-6-11-6H23c-4 0-6 6-11 6-4 0-8-4-8-14s4-16 10-16z"/><path d="M18 31v10M13 36h10"/><circle cx="44" cy="33" r="2.4" fill="currentColor"/><circle cx="50" cy="39" r="2.4" fill="currentColor"/></svg>',
  };
  const icone = (nome) => { const s = el("span", { class: "webc-svg", "aria-hidden": "true" }); s.innerHTML = ICONES[nome] || ""; return s; };

  /** A página: os cinco jogos, cada um com as opções e o botão Jogar, e a escolha do controle. */
  function pagina(pag, { captura = null } = {}) {
    const pref = lerPref(), escolhas = pref.opcoes || {};
    const controle = el("div", { class: "mj-controle", role: "radiogroup", "aria-label": t("Controle") });
    const desenharControle = () => {
      const camera = !!lerPref().camera;
      controle.replaceChildren(el("span", { class: "fraco" }, t("Controle:")),
        ...[["mouse", t("Mouse e teclado")], ["camera", t("Câmera de movimento")]].map(([v, r]) =>
          el("button", { type: "button", role: "radio", class: "webc-chip" + ((v === "camera") === camera ? " ativo" : ""), "aria-checked": String((v === "camera") === camera), "data-controle": v,
            onclick: () => { gravarPref({ camera: v === "camera" }); desenharControle(); } }, r)),
        el("small", { class: "fraco" }, camera ? t("A câmera liga ao começar o jogo (a imagem não sai do aparelho). Fique de frente, com os ombros e as mãos à vista.") : t("Mire com o mouse; clique (ou Espaço) para golpear; segure para carregar a força.")));
    };
    desenharControle();
    const cartao = (def) => {
      const minhas = { ...Object.fromEntries((def.opcoes || []).map((o) => [o.id, o.padrao])), ...(escolhas[def.id] || {}) };
      const linhaOpcoes = (def.opcoes || []).map((o) => el("div", { class: "mj-opcao", role: "radiogroup", "aria-label": t(o.rotulo), "data-opcao": o.id },
        el("span", { class: "fraco pequeno" }, t(o.rotulo)),
        ...o.valores.map((v) => el("button", { type: "button", role: "radio", class: "webc-chip" + (minhas[o.id] === v.v ? " ativo" : ""), "aria-checked": String(minhas[o.id] === v.v), "data-valor": String(v.v),
          onclick: (e) => {
            minhas[o.id] = v.v;
            for (const b of e.currentTarget.parentElement.querySelectorAll("[data-valor]")) { const sim = b.dataset.valor === String(v.v); b.classList.toggle("ativo", sim); b.setAttribute("aria-checked", String(sim)); }
            const p = lerPref(); gravarPref({ opcoes: { ...(p.opcoes || {}), [def.id]: { ...minhas } } });
          } }, t(v.rotulo)))));
      const artigo = el("article", { class: "mj-jogo", "data-jogo": def.id },
        el("div", { class: "mj-jogo-capa" }, icone(def.id)),
        el("div", { class: "mj-jogo-info" },
          el("h2", {}, t(def.nome)),
          el("p", { class: "fraco" }, t(def.descricao)),
          ...linhaOpcoes,
          el("button", { type: "button", class: "lnux-botao primario mj-jogar", "data-jogar": def.id, onclick: () => abrir(def.id, { ...minhas }, { captura }).catch(LNUX.erro) }, t("Jogar"))));
      artigo.style.setProperty("--mj-cor", def.cor || "#2f7bff"); // a cor da capa de cada jogo
      return artigo;
    };
    pag.append(el("section", { class: "webc-painel mj-pagina" },
      el("header", { class: "webc-painel-topo" }, el("h1", { class: "webc-painel-titulo" }, t("JOGOS"))),
      controle,
      el("div", { class: "mj-grade" }, JOGOS.map(cartao))));
    return { fechar() {} };
  }

  C.minijogos = {
    registrar(def) { if (!JOGOS.some((j) => j.id === def.id)) JOGOS.push(def); },
    lista: () => JOGOS.slice(),
    abrir, pagina, icone, aleatorio, atual: null,
    Entrada, // para os testes
  };
})();
