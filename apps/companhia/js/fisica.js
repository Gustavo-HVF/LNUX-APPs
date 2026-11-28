/*
 * Companhia — os objetos com física do cenário: bolas, copos, caixas, enfeites soltos... que caem, rolam, quicam, são
 * empurrados por quem passa e podem ser pegos e levados para outro lugar.
 *
 * Os corpos vêm da conversão (userData.webc.corpo, nos "extras" do .glb, js/unity-cena.js): o Rigidbody do Unity dá a
 * massa, a gravidade e se é cinemático; o colisor dá a forma; o material de física dá o quique e o atrito; o VRC
 * Pickup do VRChat diz que dá para pegar.
 *
 * A física é simples e barata (feita aqui, sem biblioteca): cada corpo colide como uma esfera (a forma do colisor
 * reduzida a ela) contra o cenário (a árvore de colisão do js/mundo.js: o ponto mais perto da malha), contra os
 * outros corpos e contra as pessoas (um cilindro em pé cada: andar contra uma bola chuta, contra uma caixa empurra).
 * Só a esfera rola; as outras formas deslizam e param em pé. Corpos parados "dormem" até alguém encostar.
 *
 * Pegar: E perto de um objeto pegável (sem item da mochila na mão) pega; E de novo põe na frente; segurar E e soltar
 * joga (mais força quanto mais tempo segurou). Na sala, quem mexeu num objeto manda onde ele está no estado
 * (js/sala.js, campo "fis"), e os outros seguem; quem encosta depois passa a mandar.
 *
 * C.Fisica: new C.Fisica(mundo); .carregar(mapa); .passo(dt); .pegarOuSoltar(); .paraSala(); .receber(quem, lista); .limpar()
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const GRAVIDADE = 9.81, SUBPASSOS = 3, ALCANCE_PEGAR = 1.6;

  class Fisica {
    constructor(mundo) {
      this.mundo = mundo;
      this.corpos = [];        // [{id, obj, raio, centro (no objeto), vel, giro (vel. angular), massa, ...}]
      this.porId = new Map();
      this.segurando = null;   // o corpo na minha mão
      this.apertouEm = 0;      // quando o E foi apertado (segurar para jogar)
      this.meus = new Map();   // id → até quando eu mando nesse corpo (ms)
      this.remotos = new Map(); // id → {quem, ate, alvo: {p, q, v}}
      this._v = null;
    }
    /** Acha os corpos do mapa (na ordem do arquivo: o id é o mesmo em todos os aparelhos da sala). */
    carregar(mapa) {
      this.limpar();
      const T = window.THREE;
      this._v = new T.Vector3(); this._v2 = new T.Vector3(); this._q = new T.Quaternion();
      if (!mapa) return 0;
      mapa.updateMatrixWorld(true);
      const achados = [];
      mapa.traverse((o) => { const w = o.userData && o.userData.webc; if (w && w.corpo && w.corpo.forma) achados.push(o); });
      achados.forEach((o, i) => {
        const d = o.userData.webc.corpo, f = d.forma, esc = o.getWorldScale(new T.Vector3());
        const meia = new T.Vector3(...f.meia).multiply(esc), k = Math.max(esc.x, esc.y, esc.z);
        const raio = Math.max(0.02, f.tipo === "esfera" ? Math.max(meia.x, meia.y, meia.z) : f.tipo === "capsula" ? Math.min(...[meia.x, meia.y, meia.z].sort((a, b) => b - a).slice(1)) : Math.min(meia.x, meia.y, meia.z));
        const c = {
          id: i + ":" + (o.name || "corpo").slice(0, 24), obj: o, tipo: f.tipo, raio, meiaAltura: meia.y, centro: new T.Vector3(...f.centro),
          vel: new T.Vector3(), giro: new T.Vector3(), massa: Math.max(0.05, d.massa || 1), gravidade: d.gravidade !== false, cinematico: !!d.cinematico,
          pegavel: !!d.pegavel, quique: Math.min(0.95, Math.max(0, d.quique ?? (f.tipo === "esfera" ? 0.45 : 0.15))), atrito: Math.min(1, Math.max(0, d.atrito ?? 0.6)),
          arrasto: d.arrasto || 0, dormindo: !(d.gravidade !== false && !d.cinematico), parado: 0, escala: k, // com gravidade: começa acordado (cai e assenta)
          inicio: new T.Matrix4().copy(mapa.matrixWorld).invert().multiply(o.matrixWorld), // onde começa, em relação ao mapa
        };
        // o corpo passa a viver no mundo (fora do mapa): a física é feita no espaço do mundo
        this.mundo.palco.cena.attach(o);
        this.corpos.push(c);
        this.porId.set(c.id, c);
      });
      return this.corpos.length;
    }
    /** O mapa mudou de lugar ou tamanho: os corpos voltam para onde começaram (em relação ao mapa). */
    reiniciar() {
      const T = window.THREE, mapa = this.mundo.mapa;
      if (!mapa) return;
      mapa.updateMatrixWorld(true);
      for (const c of this.corpos) {
        if (c === this.segurando) this.segurando = null;
        new T.Matrix4().multiplyMatrices(mapa.matrixWorld, c.inicio).decompose(c.obj.position, c.obj.quaternion, c.obj.scale);
        c.vel.set(0, 0, 0); c.giro.set(0, 0, 0); c.dormindo = !(c.gravidade && !c.cinematico); c.solto = false;
      }
    }
    limpar() {
      for (const c of this.corpos) {
        if (c.obj.parent) c.obj.parent.remove(c.obj);
        c.obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material || [])) m.dispose(); } });
      }
      this.corpos = []; this.porId.clear(); this.segurando = null; this.meus.clear(); this.remotos.clear();
    }
    /** O centro do corpo no mundo. */
    centroDe(c, alvo) { return alvo.copy(c.centro).multiply(c.obj.scale).applyQuaternion(c.obj.quaternion).add(c.obj.position); }
    /** Move o corpo para o centro novo (mantendo o giro). */
    porCentro(c, centro) { const d = this._v2.copy(c.centro).multiply(c.obj.scale).applyQuaternion(c.obj.quaternion); c.obj.position.copy(centro).sub(d); }

    /** As pessoas para empurrar: [{p (pés), raio, altura, vel}] — eu primeiro. */
    pessoas() {
      const m = this.mundo, lista = [];
      if (m.andando && m.palco.vrm && !m.voando) lista.push({ p: m.palco.raiz.position, raio: m.raio, altura: m.altura, vel: m.vel, eu: true });
      if (m.outros) for (const o of m.outros()) lista.push({ p: o.p, raio: o.raio, altura: o.altura || 1.6, vel: o.vel || null });
      return lista;
    }

    passo(dt) {
      if (!this.corpos.length || dt <= 0) return;
      const T = window.THREE, agora = performance.now(), h = Math.min(dt, 0.05) / SUBPASSOS;
      const colisor = this.mundo.colisor, bvh = colisor && colisor.geometry.boundsTree, pessoas = this.pessoas();
      const centro = this._v, perto = { point: new T.Vector3(), distance: 0 };
      // o que está na minha mão segue a mão
      if (this.segurando) this.seguirMao(this.segurando, dt);
      for (const c of this.corpos) {
        // de outra pessoa da sala: vai até onde ela disse
        const r = this.remotos.get(c.id);
        if (r && r.ate > agora && !(this.meus.get(c.id) > agora)) { this.seguirRemoto(c, r, dt); continue; }
        if (c === this.segurando) continue;
        if (c.cinematico && !c.solto) continue; // pegável cinemático: parado até alguém pegar
        // acorda se alguém encostar
        if (c.dormindo) {
          this.centroDe(c, centro);
          for (const p of pessoas) if (this.encostando(c, centro, p, 0.05)) { c.dormindo = false; break; }
          if (c.dormindo) continue;
        }
        for (let s = 0; s < SUBPASSOS; s++) {
          if (c.gravidade || c.solto) c.vel.y -= GRAVIDADE * h;
          if (c.arrasto || !(c.gravidade || c.solto)) c.vel.multiplyScalar(Math.max(0, 1 - (c.arrasto || 0.8) * h)); // sem gravidade: vai parando (no ar)
          this.centroDe(c, centro);
          centro.addScaledVector(c.vel, h);
          let noChao = false;
          // o cenário: o ponto mais perto da malha (duas vezes, para os cantos)
          if (bvh) for (let k = 0; k < 2; k++) {
            const achou = bvh.closestPointToPoint(centro, perto, 0, c.raio);
            if (!achou || perto.distance >= c.raio) break;
            const n = this._v2.subVectors(centro, perto.point);
            const d = n.length();
            if (d < 1e-6) n.set(0, 1, 0); else n.multiplyScalar(1 / d);
            centro.addScaledVector(n, c.raio - perto.distance + 1e-4);
            const vn = c.vel.dot(n);
            if (vn < 0) {
              c.vel.addScaledVector(n, -(1 + (Math.abs(vn) > 0.6 ? c.quique : 0)) * vn);
              // atrito: freia o deslizar no contato
              const tang = c.vel.clone().addScaledVector(n, -c.vel.dot(n));
              c.vel.addScaledVector(tang, -Math.min(1, c.atrito * (c.tipo === "esfera" ? 1.2 : 12) * h));
            }
            if (n.y > 0.5) noChao = true;
          }
          if (!bvh && centro.y < c.raio) { centro.y = c.raio; if (c.vel.y < 0) c.vel.y *= -c.quique; noChao = true; c.vel.x *= 1 - c.atrito * 8 * h; c.vel.z *= 1 - c.atrito * 8 * h; }
          // as pessoas: andar contra empurra (e chuta o que é leve)
          for (const p of pessoas) this.empurrar(c, centro, p);
          this.porCentro(c, centro);
          // a esfera rola: gira com a velocidade no chão
          if (c.tipo === "esfera" && noChao) c.giro.set(c.vel.z / c.raio, 0, -c.vel.x / c.raio);
          else c.giro.multiplyScalar(Math.max(0, 1 - 2 * h));
          if (c.giro.lengthSq() > 1e-6) { const ang = c.giro.length() * h; c.obj.quaternion.premultiply(this._q.setFromAxisAngle(this._v2.copy(c.giro).normalize(), ang)); }
          if (noChao) c.solto = c.solto && c.vel.lengthSq() > 0.05;
        }
        // caiu para fora do mapa: volta para onde começou
        if (c.obj.position.y < this.mundo.caixa.min.y - 30) { this.reiniciar(); return; }
        // parou: dorme
        if (c.vel.lengthSq() < 0.0025) { c.parado += dt; if (c.parado > 0.6) { c.dormindo = true; c.vel.set(0, 0, 0); c.giro.set(0, 0, 0); } }
        else c.parado = 0;
      }
      this.colidirEntreSi();
    }
    encostando(c, centro, p, folga = 0) {
      if (centro.y < p.p.y - c.raio || centro.y > p.p.y + p.altura + c.raio) return false;
      return Math.hypot(centro.x - p.p.x, centro.z - p.p.z) < c.raio + p.raio + folga;
    }
    /** Uma pessoa encostando no corpo: tira de dentro dela e passa a velocidade de quem andou contra. */
    empurrar(c, centro, p) {
      if (!this.encostando(c, centro, p)) return;
      const dx = centro.x - p.p.x, dz = centro.z - p.p.z, dist = Math.hypot(dx, dz) || 1e-4, nx = dx / dist, nz = dz / dist;
      // um corpo baixo (até o joelho) é chutado para a frente; um alto é só empurrado
      centro.x = p.p.x + nx * (c.raio + p.raio);
      centro.z = p.p.z + nz * (c.raio + p.raio);
      if (p.vel) {
        const contra = p.vel.x * nx + p.vel.z * nz;
        if (contra > 0) {
          const leve = Math.min(1.6, 1.2 / Math.sqrt(c.massa)), baixo = centro.y < p.p.y + p.altura * 0.35;
          const k = (baixo ? 1.15 : 1) * leve;
          const vn = c.vel.x * nx + c.vel.z * nz;
          if (vn < contra * k) { c.vel.x += nx * (contra * k - vn); c.vel.z += nz * (contra * k - vn); }
          if (baixo && c.tipo === "esfera" && contra > 2) c.vel.y = Math.max(c.vel.y, contra * 0.35 * leve); // um chute levanta a bola um pouco
        }
      }
      c.dormindo = false;
      if (p.eu) this.meus.set(c.id, performance.now() + 2500); // eu mexi: eu mando onde ele está, por um tempo
    }
    colidirEntreSi() {
      const T = window.THREE, a = new T.Vector3(), b = new T.Vector3(), n = new T.Vector3();
      const vivos = this.corpos.filter((c) => !c.dormindo || c === this.segurando);
      for (const c1 of vivos) {
        this.centroDe(c1, a);
        for (const c2 of this.corpos) {
          if (c1 === c2 || (c2.dormindo && c2.cinematico)) continue;
          this.centroDe(c2, b);
          const d = a.distanceTo(b), min = c1.raio + c2.raio;
          if (d >= min || d < 1e-6) continue;
          n.subVectors(b, a).multiplyScalar(1 / d);
          const m1 = c1 === this.segurando ? 1e6 : c1.massa, m2 = c2 === this.segurando ? 1e6 : c2.massa, tot = m1 + m2;
          const fundo = min - d;
          if (c1 !== this.segurando) { a.addScaledVector(n, -fundo * m2 / tot); this.porCentro(c1, a); }
          if (c2 !== this.segurando) { b.addScaledVector(n, fundo * m1 / tot); this.porCentro(c2, b); c2.dormindo = false; }
          const rel = c2.vel.dot(n) - c1.vel.dot(n);
          if (rel < 0) {
            const j = -(1 + Math.min(c1.quique, c2.quique)) * rel / (1 / m1 + 1 / m2);
            if (c1 !== this.segurando) c1.vel.addScaledVector(n, -j / m1);
            if (c2 !== this.segurando) c2.vel.addScaledVector(n, j / m2);
          }
        }
      }
    }

    // ── pegar, levar e soltar ─────────────────────────────────────────
    /** O pegável mais perto da minha mão (ou do peito), até ALCANCE_PEGAR, ou null. */
    maisPerto() {
      const m = this.mundo, T = window.THREE;
      if (!m.palco.vrm) return null;
      const mao = m.palco.nos && m.palco.nos.rightHand ? m.palco.nos.rightHand.getWorldPosition(new T.Vector3()) : m.palco.raiz.position.clone().add(new T.Vector3(0, m.altura * 0.6, 0));
      let melhor = null, dist = ALCANCE_PEGAR * (m.altura / 1.6);
      const c0 = new T.Vector3();
      for (const c of this.corpos) {
        if (!c.pegavel || c === this.segurando) continue;
        const r = this.remotos.get(c.id);
        if (r && r.segurado && r.ate > performance.now()) continue; // na mão de outra pessoa
        const d = this.centroDe(c, c0).distanceTo(mao) - c.raio;
        if (d < dist) { dist = d; melhor = c; }
      }
      return melhor;
    }
    /** E: pega o mais perto, ou (já segurando) põe na frente. forca: 0 = pôr, 1 = jogar com tudo. */
    pegarOuSoltar(forca = 0) {
      if (this.segurando) { this.soltar(forca); return "soltou"; }
      const c = this.maisPerto();
      if (!c) return null;
      this.segurando = c;
      c.dormindo = false; c.solto = false;
      c.vel.set(0, 0, 0); c.giro.set(0, 0, 0);
      this.meus.set(c.id, Infinity);
      this.mundo.palco.emit("fisica-pegou", { nome: c.obj.name });
      return "pegou";
    }
    soltar(forca = 0) {
      const c = this.segurando, m = this.mundo;
      if (!c) return;
      this.segurando = null;
      const T = window.THREE, dir = new T.Vector3(-Math.sin(m.cam.giro), 0, -Math.cos(m.cam.giro));
      if (m.cam && typeof m.cam.altura === "number") dir.y = Math.sin(-m.cam.altura * 0.5) * 0.6 + (forca > 0 ? 0.25 : 0);
      dir.normalize();
      c.vel.copy(m.vel).multiplyScalar(0.8).addScaledVector(dir, forca * 7 * Math.min(1.3, 1 / Math.sqrt(Math.max(0.05, c.massa))));
      if (forca > 0.2) c.giro.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
      c.solto = true; // um pegável cinemático (sem gravidade no Unity) cai ao ser solto e depois para onde ficou
      c.dormindo = false;
      this.meus.set(c.id, performance.now() + 3000);
      m.palco.emit("fisica-soltou", { nome: c.obj.name });
    }
    /** Na mão: um pouco à frente da mão direita (ou do peito), virado para onde a pessoa olha. */
    seguirMao(c, dt) {
      const m = this.mundo, T = window.THREE;
      const alvo = m.palco.nos && m.palco.nos.rightHand ? m.palco.nos.rightHand.getWorldPosition(new T.Vector3()) : m.palco.raiz.position.clone().add(new T.Vector3(0, m.altura * 0.6, 0));
      alvo.add(new T.Vector3(Math.sin(m.rumo), 0, Math.cos(m.rumo)).multiplyScalar(c.raio + 0.08));
      const centro = this.centroDe(c, new T.Vector3()), k = 1 - Math.exp(-dt * 25);
      const antes = centro.clone();
      centro.lerp(alvo, k);
      c.vel.copy(centro).sub(antes).multiplyScalar(1 / Math.max(1e-3, dt));
      this.porCentro(c, centro);
      const q = this._q.setFromAxisAngle(new T.Vector3(0, 1, 0), m.rumo);
      c.obj.quaternion.slerp(q, k * 0.5);
    }
    seguirRemoto(c, r, dt) {
      const k = 1 - Math.exp(-dt * 12), a = r.alvo;
      c.obj.position.lerp(a.p, k);
      c.obj.quaternion.slerp(a.q, k);
      c.vel.copy(a.v);
      c.dormindo = false;
      if (performance.now() > r.ate - 50) c.dormindo = true;
    }

    // ── na sala ──────────────────────────────────────────────────────
    /** Os corpos que eu mando (segurando ou mexidos há pouco): [[id, x, y, z, qx, qy, qz, qw, vx, vy, vz, segurando]] */
    paraSala() {
      const agora = performance.now(), saida = [], arr = (v) => Math.round(v * 1000) / 1000;
      for (const [id, ate] of this.meus) {
        if (ate < agora) { this.meus.delete(id); continue; }
        const c = this.porId.get(id);
        if (!c) continue;
        const p = c.obj.position, q = c.obj.quaternion, v = c.vel;
        saida.push([id, arr(p.x), arr(p.y), arr(p.z), arr(q.x), arr(q.y), arr(q.z), arr(q.w), arr(v.x), arr(v.y), arr(v.z), c === this.segurando ? 1 : 0]);
        if (saida.length >= 12) break;
      }
      return saida.length ? saida : null;
    }
    /** O que outra pessoa da sala mandou: ela passa a mandar nesses corpos (se eu não estiver segurando). */
    receber(quem, lista) {
      if (!Array.isArray(lista)) return;
      const T = window.THREE, agora = performance.now();
      for (const x of lista) {
        if (!Array.isArray(x) || x.length < 11) continue;
        const c = this.porId.get(String(x[0]));
        if (!c || c === this.segurando) continue;
        const nums = x.slice(1, 11).map(Number);
        if (nums.some((v) => !Number.isFinite(v))) continue;
        this.meus.delete(c.id);
        this.remotos.set(c.id, { quem, ate: agora + 700, segurado: !!x[11], alvo: { p: new T.Vector3(nums[0], nums[1], nums[2]), q: new T.Quaternion(nums[3], nums[4], nums[5], nums[6]).normalize(), v: new T.Vector3(nums[7], nums[8], nums[9]) } });
      }
    }
  }
  C.Fisica = Fisica;
})();
