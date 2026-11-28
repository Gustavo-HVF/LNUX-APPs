/*
 * WEBC — o "boneco de pano" (ragdoll): a personagem cai mole, com o corpo solto, e quica e escorrega no cenário.
 *
 * Sem motor de física: cada junta (quadril, peito, cabeça, ombros, cotovelos, mãos, coxas, joelhos e pés) é um ponto
 * com inércia (integração de Verlet), presos uns aos outros pelo comprimento dos ossos (e por travessas que deixam o
 * tronco firme). Os pontos batem no cenário (a mesma árvore de colisão do andar, js/mundo.js) e no chão simples.
 * A cada quadro, a pose dos ossos sai das posições dos pontos (o tronco dá a torção; cada braço e perna aponta para
 * a junta seguinte). Na sala, a pose vai para os outros como a da captura de movimento (js/sala.js).
 *
 * O corpo não entra em si mesmo: cada parte (tronco, cabeça, braço, antebraço, coxa, canela) é uma cápsula, e as que não
 * são vizinhas (separadas por mais de uma junta) se empurram para fora. E quem anda por cima de um corpo caído o arrasta:
 * as pessoas da sala empurram as juntas com a velocidade delas.
 *
 * C.Ragdoll(palco, mundo): cair(velocidade), levantar(), ativo, passo(dt), aplicar(pose, quadril), centro(alvo).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});

  // as juntas (o primeiro nome que o modelo tiver) e quem prende em quem
  const PONTOS = {
    hips: ["hips"], peito: ["upperChest", "chest", "spine"], head: ["head"],
    lUA: ["leftUpperArm"], lLA: ["leftLowerArm"], lH: ["leftHand"], rUA: ["rightUpperArm"], rLA: ["rightLowerArm"], rH: ["rightHand"],
    lUL: ["leftUpperLeg"], lLL: ["leftLowerLeg"], lF: ["leftFoot"], rUL: ["rightUpperLeg"], rLL: ["rightLowerLeg"], rF: ["rightFoot"],
  };
  const OSSOS = [["hips", "peito"], ["peito", "head"], ["peito", "lUA"], ["peito", "rUA"], ["lUA", "lLA"], ["lLA", "lH"], ["rUA", "rLA"], ["rLA", "rH"],
    ["hips", "lUL"], ["hips", "rUL"], ["lUL", "lLL"], ["lLL", "lF"], ["rUL", "rLL"], ["rLL", "rF"]];
  // travessas: o tronco não dobra feito papel (e a cabeça não entra no peito)
  const TRAVESSAS = [["lUA", "rUA"], ["lUL", "rUL"], ["lUA", "hips"], ["rUA", "hips"], ["lUL", "peito"], ["rUL", "peito"], ["lUA", "lUL"], ["rUA", "rUL"],
    ["head", "lUA"], ["head", "rUA"], ["head", "hips"]];
  // as partes do corpo como cápsulas (de uma junta à outra, com o raio em metros para uma pessoa de 1,5 m)
  const CAPSULAS = [["hips", "peito", 0.1], ["head", "head", 0.1], ["lUA", "lLA", 0.04], ["lLA", "lH", 0.035], ["rUA", "rLA", 0.04], ["rLA", "rH", 0.035],
    ["lUL", "lLL", 0.065], ["lLL", "lF", 0.05], ["rUL", "rLL", 0.065], ["rLL", "rF", 0.05]];
  // os pares que se empurram: os que não ficam a uma junta (ou menos) um do outro (o braço encosta no ombro, não colide com ele)
  const PARES_CAPSULAS = (() => {
    const viz = new Map();
    const liga = (a, b) => { (viz.get(a) || viz.set(a, new Set()).get(a)).add(b); (viz.get(b) || viz.set(b, new Set()).get(b)).add(a); };
    for (const [a, b] of OSSOS) liga(a, b);
    const perto = (a, b) => a === b || (viz.get(a) && viz.get(a).has(b));
    const pares = [];
    for (let i = 0; i < CAPSULAS.length; i++) for (let j = i + 1; j < CAPSULAS.length; j++) {
      const [a1, b1] = CAPSULAS[i], [a2, b2] = CAPSULAS[j];
      if ([a1, b1].some((x) => [a2, b2].some((y) => perto(x, y)))) continue;
      pares.push([i, j]);
    }
    return pares;
  })();
  // não fechar demais (o joelho e o cotovelo não dobram até encostar)
  const MINIMOS = [["lUA", "lH", 0.45], ["rUA", "rH", 0.45], ["lUL", "lF", 0.5], ["rUL", "rF", 0.5], ["hips", "lF", 0.35], ["hips", "rF", 0.35]];
  /** Os ossos que a pose do boneco comanda (vão para os outros na sala). */
  C.OSSOS_RAGDOLL = ["hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
    "leftHand", "rightHand", "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot"];

  /** Os pontos mais perto entre dois segmentos (p1→q1 e p2→q2): saida = [s, t], as frações em cada um. */
  function pertoDosSegmentos(p1, q1, p2, q2, saida) {
    const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
    const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
    let s, t;
    if (a < 1e-9 && e < 1e-9) { saida[0] = 0; saida[1] = 0; return; }
    if (a < 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
    else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (e < 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
        s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      }
    }
    saida[0] = s; saida[1] = t;
  }

  class Ragdoll {
    constructor(palco, mundo) {
      this.palco = palco;
      this.mundo = mundo;
      this.ativo = false;
      this.pontos = null;   // nome → {p, antes, r}
      this.ligas = [];      // [a, b, comprimento, min (só empurra para fora)]
      this.desde = 0;
      this.saida = 0;       // 1 → 0 ao levantar: a pose solta volta aos poucos para a de pé
      this.congelada = null;
    }
    /** Cai: os pontos saem de onde as juntas estão agora, com a velocidade dela (correndo, cai para a frente). */
    cair(velocidade) {
      const T = window.THREE, p = this.palco;
      if (!p.vrm || this.ativo) return false;
      p.raiz.updateMatrixWorld(true);
      this.pontos = {};
      const esc = this.mundo.altura / 1.5;
      for (const [nome, ossos] of Object.entries(PONTOS)) {
        const osso = ossos.find((n) => p.ossoBruto(n));
        if (!osso) return false; // um modelo sem as juntas básicas não vira boneco
        const pos = p.posicao(osso);
        const vel = (velocidade || new T.Vector3()).clone().multiplyScalar(1 / 60);
        // um empurrãozinho diferente em cada junta: o corpo gira um pouco ao cair
        vel.add(new T.Vector3((Math.random() - 0.5) * 0.01, Math.random() * 0.012, (Math.random() - 0.5) * 0.01).multiplyScalar(esc));
        this.pontos[nome] = { p: pos.clone(), antes: pos.clone().sub(vel), r: (nome === "head" ? 0.11 : nome === "hips" || nome === "peito" ? 0.1 : 0.05) * esc, toca: false };
      }
      const P = this.pontos, d = (a, b) => P[a].p.distanceTo(P[b].p);
      this.ligas = [...OSSOS, ...TRAVESSAS].map(([a, b]) => [a, b, d(a, b), false]);
      for (const [a, b, f] of MINIMOS) this.ligas.push([a, b, d(a, b) * f, true]);
      this.ativo = true;
      this.desde = performance.now();
      this.saida = 0;
      this.mundo.vel.set(0, 0, 0);
      this.palco.emit("ragdoll", true);
      return true;
    }
    /** Levanta: a personagem fica de pé onde o quadril caiu, virada para onde a cabeça apontava. */
    levantar() {
      if (!this.ativo) return;
      const T = window.THREE, P = this.pontos, raiz = this.palco.raiz, m = this.mundo;
      const quadril = P.hips.p, para = new T.Vector3().subVectors(P.head.p, quadril);
      raiz.position.set(quadril.x, quadril.y, quadril.z);
      raiz.position.y = m.alturaDoChao(new T.Vector3(quadril.x, quadril.y + m.altura * 0.3, quadril.z));
      if (Math.hypot(para.x, para.z) > 0.05) m.rumo = Math.atan2(para.x, para.z);
      raiz.rotation.y = m.rumo;
      raiz.updateMatrixWorld(true);
      // a pose solta fica guardada e sai aos poucos (meio segundo)
      this.congelada = {};
      for (const n of C.OSSOS_RAGDOLL) if (this.palco.pose[n]) this.congelada[n] = this.palco.pose[n].clone();
      this.saida = 1;
      this.ativo = false;
      m.vel.set(0, 0, 0);
      m.noChao = false;
      this.palco.emit("ragdoll", false);
    }
    /** O meio do corpo (para a câmera em terceira pessoa seguir o boneco). */
    centro(alvo) { return alvo.copy(this.pontos.hips.p).lerp(this.pontos.peito.p, 0.5); }

    /** Um quadro da física: gravidade, ossos do tamanho certo e o cenário. */
    passo(dt) {
      if (this.saida > 0) this.saida = Math.max(0, this.saida - dt * 2);
      if (!this.ativo) return;
      const T = window.THREE, P = this.pontos, m = this.mundo, esc = m.altura / 1.5, sub = 4, h = Math.min(dt, 1 / 30) / sub;
      const g = 22 * esc * h * h, lista = Object.values(P);
      const v = (this._v = this._v || new T.Vector3()), alvo = (this._alvo = this._alvo || { point: new T.Vector3() });
      for (let s = 0; s < sub; s++) {
        for (const q of lista) {
          // inércia (com atrito quando está encostado em algo) + gravidade
          v.subVectors(q.p, q.antes).multiplyScalar(q.toca ? 0.82 : 0.995);
          q.antes.copy(q.p);
          q.p.add(v);
          q.p.y -= g;
        }
        for (let it = 0; it < 6; it++) {
          for (const [a, b, comp, min] of this.ligas) {
            const pa = P[a].p, pb = P[b].p;
            v.subVectors(pb, pa);
            const dist = v.length() || 1e-6;
            if (min && dist >= comp) continue;
            v.multiplyScalar((dist - comp) / dist * 0.5);
            pa.add(v);
            pb.sub(v);
          }
          if (it % 2 === 0) this.colidirCorpo(esc);
          for (const q of lista) this.colidir(q, alvo);
        }
        this.arrastarPelasPessoas(h);
      }
      // caiu para fora do mapa: levanta no ponto de partida
      if (P.hips.p.y < m.caixa.min.y - 25 * esc) { this.ativo = false; this.saida = 0; m.partida(); this.palco.emit("ragdoll", false); }
    }
    /** O quanto uma parte do corpo entrou em outra, no pior par (em metros; 0 = nada entrou). Para conferir nos testes. */
    penetracao() {
      if (!this.pontos) return 0;
      const P = this.pontos, a = [0, 0], esc = this.mundo.altura / 1.5;
      let pior = 0;
      for (const [i, j] of PARES_CAPSULAS) {
        const c1 = CAPSULAS[i], c2 = CAPSULAS[j], p1 = P[c1[0]].p, q1 = P[c1[1]].p, p2 = P[c2[0]].p, q2 = P[c2[1]].p;
        pertoDosSegmentos(p1, q1, p2, q2, a);
        const x = p1.clone().lerp(q1, a[0]), y = p2.clone().lerp(q2, a[1]);
        pior = Math.max(pior, (c1[2] + c2[2]) * esc - x.distanceTo(y));
      }
      return pior;
    }
    /** As partes do corpo que não são vizinhas se empurram (um braço não entra na barriga, uma perna não passa pela outra). */
    colidirCorpo(esc) {
      const P = this.pontos, a = this._a || (this._a = [0, 0]);
      for (const [i, j] of PARES_CAPSULAS) {
        const c1 = CAPSULAS[i], c2 = CAPSULAS[j];
        const p1 = P[c1[0]].p, q1 = P[c1[1]].p, p2 = P[c2[0]].p, q2 = P[c2[1]].p;
        const r = (c1[2] + c2[2]) * esc;
        pertoDosSegmentos(p1, q1, p2, q2, a);
        const s = a[0], t = a[1];
        const x1 = p1.x + (q1.x - p1.x) * s, y1 = p1.y + (q1.y - p1.y) * s, z1 = p1.z + (q1.z - p1.z) * s;
        const x2 = p2.x + (q2.x - p2.x) * t, y2 = p2.y + (q2.y - p2.y) * t, z2 = p2.z + (q2.z - p2.z) * t;
        let dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        const d = Math.hypot(dx, dy, dz);
        if (d >= r) continue;
        if (d < 1e-6) { dx = 0; dy = 1; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
        const f = (r - d) * 0.5;
        // cada ponta anda o tanto que estava perto do ponto que encostou (como um osso de verdade)
        const mexer = (pt, peso, sinal) => { pt.x += dx * f * peso * sinal; pt.y += dy * f * peso * sinal; pt.z += dz * f * peso * sinal; };
        if (p1 === q1) mexer(p1, 1, -1); else { mexer(p1, 1 - s, -1); mexer(q1, s, -1); }
        if (p2 === q2) mexer(p2, 1, 1); else { mexer(p2, 1 - t, 1); mexer(q2, t, 1); }
      }
    }
    /**
     * As pessoas da sala (cilindros em pé) empurram as juntas para fora e, andando, levam junto: quem passa por cima de
     * um corpo caído o arrasta na direção em que anda.
     */
    arrastarPelasPessoas(h) {
      const m = this.mundo;
      if (!m.outros) return;
      for (const o of m.outros()) {
        if (o.caido) continue;
        const vx = o.vel ? o.vel.x : 0, vz = o.vel ? o.vel.z : 0, anda = Math.hypot(vx, vz) > 0.2;
        for (const q of Object.values(this.pontos)) {
          if (q.p.y < o.p.y - q.r || q.p.y > o.p.y + o.altura) continue;
          const dx = q.p.x - o.p.x, dz = q.p.z - o.p.z, dist = Math.hypot(dx, dz), raio = o.raio + q.r;
          if (dist >= raio) continue;
          const nx = dist > 1e-4 ? dx / dist : 1, nz = dist > 1e-4 ? dz / dist : 0, f = raio - dist;
          q.p.x += nx * f; q.p.z += nz * f;
          // a velocidade de quem empurra passa para a junta (no Verlet, a velocidade é a diferença para o passo anterior)
          if (anda) { q.antes.x = q.p.x - vx * h * 1.1; q.antes.z = q.p.z - vz * h * 1.1; q.antes.y = Math.min(q.antes.y, q.p.y - 0.4 * h); }
        }
      }
    }
    /** Um ponto contra o cenário (ou o chão simples): fica do lado de fora, a "r" da superfície. */
    colidir(q, alvo) {
      const T = window.THREE, m = this.mundo;
      q.toca = false;
      if (!m.colisor) {
        if (q.p.y < q.r) { q.p.y = q.r; q.toca = true; }
        return;
      }
      const arvore = m.colisor.geometry.boundsTree;
      // atravessou uma superfície fina entre um passo e outro: volta para o lado de onde veio
      const v = (this._v2 = this._v2 || new T.Vector3()).subVectors(q.p, q.antes), dist = v.length();
      if (dist > q.r * 0.5) {
        const raio = (this._raio = this._raio || new T.Ray());
        raio.origin.copy(q.antes);
        raio.direction.copy(v).multiplyScalar(1 / dist);
        const toque = arvore.raycastFirst(raio, T.DoubleSide);
        if (toque && toque.distance < dist) {
          const n = toque.face ? toque.face.normal.clone().transformDirection(m.colisor.matrixWorld) : new T.Vector3(0, 1, 0);
          if (n.dot(raio.direction) > 0) n.negate();
          q.p.copy(toque.point).addScaledVector(n, q.r);
          q.toca = true;
        }
      }
      const perto = arvore.closestPointToPoint(q.p, alvo, 0, q.r);
      if (perto && perto.distance < q.r) {
        const fora = (this._fora = this._fora || new T.Vector3()).subVectors(q.p, perto.point);
        if (fora.lengthSq() < 1e-10) fora.set(0, 1, 0);
        q.p.copy(perto.point).addScaledVector(fora.normalize(), q.r);
        q.toca = true;
      }
    }

    /**
     * A pose a partir dos pontos (espaço canônico: o da personagem em pé, olhando para +Z), por cima da que já foi
     * calculada. Ao levantar, a pose solta sai aos poucos.
     */
    aplicar(pose, quadril) {
      const T = window.THREE, p = this.palco;
      if (!this.ativo) {
        if (this.saida > 0 && this.congelada) for (const [n, q] of Object.entries(this.congelada)) if (pose[n]) pose[n].slerp(q, this.saida * this.saida);
        return;
      }
      const P = this.pontos, raiz = p.raiz, k = (p.vrm.scene.scale.x || 1);
      const L = {}, inv = (this._inv = this._inv || new T.Matrix4()).copy(raiz.matrixWorld).invert();
      for (const [n, q] of Object.entries(P)) L[n] = q.p.clone().applyMatrix4(inv).multiplyScalar(1 / k);
      // o tronco: para cima (do quadril ao peito), o lado (da direita para a esquerda) e a frente
      const cima = new T.Vector3().subVectors(L.peito, L.hips).normalize();
      const lado = new T.Vector3().subVectors(L.lUL, L.rUL).add(new T.Vector3().subVectors(L.lUA, L.rUA)).normalize();
      const frente = new T.Vector3().crossVectors(lado, cima).normalize();
      lado.crossVectors(cima, frente).normalize();
      const Qt = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(lado, cima, frente));
      const W = { hips: Qt };
      for (const n of ["hips", "spine", "chest", "upperChest", "leftShoulder", "rightShoulder", "leftHand", "rightHand", "leftFoot", "rightFoot", "head"]) if (pose[n]) pose[n].identity();
      pose.hips.copy(Qt);
      const d0 = new T.Vector3(), atual = new T.Vector3(), qa = new T.Quaternion(), invPai = new T.Quaternion();
      /** O osso aponta para a próxima junta, girando o mínimo a partir do pai (a torção vem do tronco). */
      const apontar = (osso, pai, de, para, descanso) => {
        if (!pose[osso]) return;
        d0.copy(descanso).applyQuaternion(W[pai]);
        atual.subVectors(L[para], L[de]).normalize();
        W[osso] = qa.setFromUnitVectors(d0, atual).clone().multiply(W[pai]);
        pose[osso].copy(invPai.copy(W[pai]).invert().multiply(W[osso]));
      };
      W.peito = Qt;
      apontar("neck", "peito", "peito", "head", new T.Vector3(0, 1, 0));
      const dir = (n) => p.direcaoDescanso(n, new T.Vector3());
      apontar("leftUpperArm", "peito", "lUA", "lLA", dir("leftUpperArm"));
      apontar("leftLowerArm", "leftUpperArm", "lLA", "lH", dir("leftLowerArm"));
      apontar("rightUpperArm", "peito", "rUA", "rLA", dir("rightUpperArm"));
      apontar("rightLowerArm", "rightUpperArm", "rLA", "rH", dir("rightLowerArm"));
      apontar("leftUpperLeg", "hips", "lUL", "lLL", dir("leftUpperLeg"));
      apontar("leftLowerLeg", "leftUpperLeg", "lLL", "lF", dir("leftLowerLeg"));
      apontar("rightUpperLeg", "hips", "rUL", "rLL", dir("rightUpperLeg"));
      apontar("rightLowerLeg", "rightUpperLeg", "rLL", "rF", dir("rightLowerLeg"));
      // o quadril vai aonde o ponto dele está (o resto do corpo segue pelos ossos)
      const base = p.hipsBase.clone();
      if (p.v0) { base.x = -base.x; base.z = -base.z; }
      quadril.copy(L.hips).sub(base);
      quadril.y -= p.erguer || 0;
    }
  }
  C.Ragdoll = Ragdoll;
})();
