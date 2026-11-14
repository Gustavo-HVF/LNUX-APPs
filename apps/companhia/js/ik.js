/*
 * WEBC — cinemática inversa (IK) das pernas: os pés se adaptam ao chão do cenário.
 *
 * A cada quadro, depois que a pose (descanso, andar, gestos...) já foi gravada nos ossos e antes do vrm.update:
 *   1. um raio desce sob cada pé e acha o chão do mapa (a mesma árvore de colisão do andar);
 *   2. o quadril desce o quanto o pé mais baixo precisa (num degrau ou numa rampa, a cápsula da personagem fica apoiada
 *      na beirada e um pé ficaria no ar);
 *   3. cada perna é resolvida com a IK analítica de dois ossos (coxa e canela, pela lei dos cossenos): o joelho dobra
 *      para a frente, no mesmo plano em que o movimento já dobrava;
 *   4. o pé inclina com o chão (até ~35°), só quando está pisando (no passo, o pé que sobe fica como o movimento quer).
 *
 * Tudo é feito no espaço do mundo, nos ossos normalizados do three-vrm: vale igual para os VRM 0.x e 1.0. As mudanças
 * entram e saem suaves (pular, voar e sair do cenário desligam aos poucos).
 *
 * C.ikDosPes(vrm, {colisor, base, frente, ativo, dt, estado}) → {dy: [esq, dir], quadril} ou null (desligada).
 *   colisor: a malha com a árvore de colisão (mundo.colisor); base: onde a personagem pisa (Vector3 do mundo);
 *   frente: para onde ela olha (Vector3); ativo: se pode agir agora (no chão, sem voar); estado: um objeto guardado por
 *   personagem (a suavização).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const PERNAS = [["leftUpperLeg", "leftLowerLeg", "leftFoot"], ["rightUpperLeg", "rightLowerLeg", "rightFoot"]];
  const SOBE = 0.42;     // o quanto um pé sobe (degrau), em pernas
  const DESCE = 0.45;    // o quanto um pé desce (e o quadril junto), em pernas
  const INCLINA = 0.6;   // o máximo que o pé inclina com o chão (radianos, ~35°)
  const RAPIDEZ = 14;    // a suavização dos pés (por segundo)
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

  let k = null; // os vetores e quatérnios de trabalho (criados uma vez, quando o three.js já carregou)
  function trabalho() {
    if (k) return k;
    const T = window.THREE, v = () => new T.Vector3(), q = () => new T.Quaternion();
    k = { T, a: v(), b: v(), c: v(), f: [v(), v()], alvo: v(), u: v(), w: v(), eixo: v(), s: v(), up: new T.Vector3(0, 1, 0), n: [v(), v()],
      r: q(), p: q(), pi: q(), t: q(), pe0: [q(), q()], ray: new T.Ray(), baixo: new T.Vector3(0, -1, 0) };
    return k;
  }
  /** Gira um osso por uma rotação dada no espaço do mundo (local ← pai⁻¹ · r · pai · local) e atualiza os filhos. */
  function girarNoMundo(osso, r) {
    osso.parent.getWorldQuaternion(k.p);
    k.pi.copy(k.p).invert();
    osso.quaternion.premultiply(k.t.copy(k.pi).multiply(r).multiply(k.p));
    osso.updateMatrixWorld(true);
  }

  C.ikDosPes = function (vrm, { colisor, base, frente, ativo = true, dt = 1 / 60, estado }) {
    const h = vrm && vrm.humanoid;
    if (!h || !estado || !base) return null;
    trabalho();
    const T = k.T;
    // entra e sai suave
    estado.peso = estado.peso || 0;
    estado.peso += ((colisor && ativo ? 1 : 0) - estado.peso) * (1 - Math.exp(-dt * 8));
    if (!estado.dy) estado.dy = [0, 0];
    if (estado.peso < 0.002 || !colisor) { estado.peso = 0; estado.dy[0] = estado.dy[1] = 0; return null; }
    const quadril = h.getNormalizedBoneNode("hips");
    const ossos = PERNAS.map((l) => l.map((n) => h.getNormalizedBoneNode(n)));
    if (!quadril || ossos.some((l) => l.some((o) => !o))) return null;
    quadril.updateWorldMatrix(true, true);
    const arvore = colisor.geometry.boundsTree, suave = 1 - Math.exp(-dt * RAPIDEZ);
    // 1. o chão sob cada pé
    const pernaDe = [0, 0], chao = [0, 0];
    for (let i = 0; i < 2; i++) {
      const [coxa, canela, pe] = ossos[i];
      const A = coxa.getWorldPosition(k.a), B = canela.getWorldPosition(k.b), F = pe.getWorldPosition(k.f[i]);
      const perna = (pernaDe[i] = A.distanceTo(B) + B.distanceTo(F));
      k.ray.origin.set(F.x, base.y + perna * SOBE, F.z);
      k.ray.direction.copy(k.baixo);
      const toque = arvore.raycastFirst(k.ray, T.DoubleSide);
      let dy = 0;
      k.n[i].copy(k.up);
      if (toque && toque.distance <= perna * (SOBE + DESCE)) {
        dy = limitar(toque.point.y - base.y, -perna * DESCE, perna * SOBE);
        chao[i] = toque.point.y;
        if (toque.face && toque.face.normal) { k.n[i].copy(toque.face.normal); if (k.n[i].y < 0) k.n[i].negate(); }
      } else chao[i] = base.y;
      estado.dy[i] += (dy - estado.dy[i]) * suave;
    }
    // 2. o quadril desce o quanto o pé mais baixo precisa
    const peso = estado.peso, desce = Math.min(0, estado.dy[0], estado.dy[1]) * peso;
    if (desce) {
      quadril.parent.getWorldScale(k.s);
      quadril.position.y += desce / (k.s.y || 1);
      quadril.updateMatrixWorld(true);
    }
    // 3 e 4. cada perna: o pé no chão (IK de dois ossos) e inclinado com ele
    for (let i = 0; i < 2; i++) {
      const [coxa, canela, pe] = ossos[i];
      pe.getWorldQuaternion(k.pe0[i]); // a direção que o movimento deu ao pé (o quadril só andou, não girou)
      const A = coxa.getWorldPosition(k.a), B = canela.getWorldPosition(k.b), F = pe.getWorldPosition(k.c);
      const alturaAntes = k.f[i].y - chao[i]; // o pé pisando (perto do chão) ou no ar (no passo)
      const alvo = k.alvo.copy(F);
      alvo.y += estado.dy[i] * peso - desce;
      const lab = A.distanceTo(B), lbc = B.distanceTo(F);
      if (lab > 1e-5 && lbc > 1e-5 && Math.abs(alvo.y - F.y) > 1e-5) {
        const d = limitar(A.distanceTo(alvo), (lab + lbc) * 0.02, (lab + lbc) * 0.9995);
        const u = k.u.subVectors(A, B), w = k.w.subVectors(F, B);
        const agora = u.angleTo(w), quer = Math.acos(limitar((lab * lab + lbc * lbc - d * d) / (2 * lab * lbc), -1, 1));
        // o eixo do joelho: o plano em que a perna já dobra; esticada, o joelho vai para a frente
        k.eixo.crossVectors(w, u);
        if (k.eixo.lengthSq() < 1e-10 * lab * lbc) k.eixo.crossVectors(frente, k.s.subVectors(F, A));
        if (k.eixo.lengthSq() > 1e-12) {
          k.eixo.normalize();
          girarNoMundo(canela, k.r.setFromAxisAngle(k.eixo, agora - quer));
          // a coxa aponta o pé para o alvo
          const F2 = pe.getWorldPosition(k.c);
          k.u.subVectors(F2, A).normalize();
          k.w.subVectors(alvo, A).normalize();
          girarNoMundo(coxa, k.r.setFromUnitVectors(k.u, k.w));
        }
      }
      // o pé: a direção do movimento, inclinada com o chão quando está pisando
      const pisando = limitar(1 - Math.max(0, alturaAntes - pernaDe[i] * 0.12) / (pernaDe[i] * 0.12), 0, 1);
      k.r.setFromUnitVectors(k.up, k.n[i]);
      const ang = 2 * Math.acos(limitar(k.r.w, -1, 1));
      if (ang > INCLINA) k.r.slerp(k.t.identity(), 1 - INCLINA / ang);
      k.r.slerp(k.t.identity(), 1 - peso * pisando);
      pe.parent.getWorldQuaternion(k.p);
      pe.quaternion.copy(k.p.invert().multiply(k.r).multiply(k.pe0[i]));
      pe.updateMatrixWorld(true);
    }
    return { dy: [estado.dy[0] * peso, estado.dy[1] * peso], quadril: desce };
  };
})();
