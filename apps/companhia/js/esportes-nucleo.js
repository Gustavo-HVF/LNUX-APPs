/*
 * WEBC — o núcleo dos minijogos de esporte (sem three.js e sem a tela: só contas, para o js/esportes.js usar e os
 * testes conferirem). Readaptado do Linux Sports (o projeto Unity do mesmo autor; código próprio, sem nada de jogos
 * de terceiros):
 *
 *   voo        a bola no ar com gravidade, resistência do ar e o efeito Magnus (backspin sustenta, topspin derruba,
 *              efeito lateral curva), o quique com atrito e a busca da velocidade para uma distância;
 *   boliche    o split (o pino 1 caiu e sobraram grupos separados) e a máscara dos pinos em pé;
 *   beisebol   queimada dupla e voo de sacrifício (quem está na 3ª marca);
 *   ia         um perfil para cada adversário: precisão, reação, força, velocidade e estilo, a partir de uma força
 *              (0 a 1) e de uma semente estável (o nome);
 *   habilidade pontos de 0 a 2000 por jogo, ajustados como no xadrez (Elo) contra a força do adversário;
 *   recordes   por pessoa e por jogo (melhor marca, vitórias, partidas, habilidade), guardados neste navegador.
 *
 * Unidades: metros, segundos e quilos (o mesmo do js/esportes.js).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const G = 9.8;

  // ══════════════════════════════ o voo da bola ══════════════════════════════

  const AR = 1.2; // densidade do ar (kg/m³)
  /** Bolas: raio (m), massa (kg), arrasto, Magnus (S, kg), perda do giro (1/s), restituição e atrito no quique. */
  const BOLAS = {
    golfe: { raio: 0.02135, massa: 0.04593, arrasto: 0.25, magnus: 0.000025, perdaGiro: 0.25, restituicao: 0.38, atrito: 0.35 },
    tenis: { raio: 0.0335, massa: 0.058, arrasto: 0.55, magnus: 0.000045, perdaGiro: 0.15, restituicao: 0.75, atrito: 0.25 },
    beisebol: { raio: 0.0366, massa: 0.145, arrasto: 0.33, magnus: 0.00008, perdaGiro: 0.1, restituicao: 0.45, atrito: 0.4 },
  };
  const cruz = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  /** A aceleração da bola (m/s²) com a velocidade, o giro (rad/s, vetor) e o vento (m/s). */
  function aceleracao(vel, giro, vento, bola) {
    const r = { x: vel.x - (vento ? vento.x : 0), y: vel.y - (vento ? vento.y || 0 : 0), z: vel.z - (vento ? vento.z : 0) };
    const v = Math.hypot(r.x, r.y, r.z), area = Math.PI * bola.raio * bola.raio;
    const k = v > 1e-5 ? (-0.5 * AR * bola.arrasto * area * v) / bola.massa : 0;
    const m = giro ? cruz(giro, r) : { x: 0, y: 0, z: 0 }, s = bola.magnus / bola.massa;
    return { x: k * r.x + s * m.x, y: -G + k * r.y + s * m.y, z: k * r.z + s * m.z };
  }
  /** Um passo (Euler semi-implícito): muda pos, vel e giro no lugar. */
  function passo(pos, vel, giro, vento, bola, dt) {
    const a = aceleracao(vel, giro, vento, bola);
    vel.x += a.x * dt; vel.y += a.y * dt; vel.z += a.z * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    if (giro) { const f = Math.max(0, 1 - bola.perdaGiro * dt); giro.x *= f; giro.y *= f; giro.z *= f; }
  }
  /** O eixo do backspin para uma direção no chão (o Magnus empurra para cima). Topspin = o eixo ao contrário. */
  function eixoBackspin(dir) {
    const h = Math.hypot(dir.x, dir.z) || 1, d = { x: dir.x / h, y: 0, z: dir.z / h };
    return cruz(d, { x: 0, y: 1, z: 0 });
  }
  /** Simula sem colisão até a bola descer à altura "chao". Devolve {x, y, z, t}. */
  function preverQueda(pos0, vel0, giro0, vento, bola, chao = 0, max = 15, dt = 1 / 120) {
    const pos = { ...pos0 }, vel = { ...vel0 }, giro = giro0 ? { ...giro0 } : null;
    let t = 0;
    while (t < max) {
      const ant = { ...pos };
      passo(pos, vel, giro, vento, bola, dt);
      t += dt;
      if (pos.y <= chao && vel.y < 0) {
        const k = (ant.y - chao) / (ant.y - pos.y || 1);
        return { x: ant.x + (pos.x - ant.x) * k, y: chao, z: ant.z + (pos.z - ant.z) * k, t };
      }
    }
    return { ...pos, t };
  }
  /** A velocidade de saída (m/s) para a bola cair a "distancia" metros com o ângulo (graus) e o backspin (rad/s). */
  function velocidadePara(distancia, anguloGraus, backspin, bola, desnivel = 0, maxima = 95) {
    let lo = 0.5, hi = maxima;
    const a = (anguloGraus * Math.PI) / 180, giro = eixoBackspin({ x: 0, z: 1 });
    for (let i = 0; i < 28; i++) {
      const v = 0.5 * (lo + hi);
      const q = preverQueda({ x: 0, y: 0, z: 0 }, { x: 0, y: Math.sin(a) * v, z: Math.cos(a) * v }, { x: giro.x * backspin, y: 0, z: giro.z * backspin }, null, bola, desnivel);
      if (q.z < distancia) lo = v; else hi = v;
    }
    return 0.5 * (lo + hi);
  }
  /** O quique numa superfície de normal n: a parte normal volta com a restituição, a tangencial perde pelo atrito e
   *  parte do giro vira velocidade no chão (o efeito "morde"). Devolve a nova velocidade e muda o giro. */
  function quique(vel, n, giro, bola) {
    const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
    if (vn >= 0) return { ...vel };
    const N = { x: vn * n.x, y: vn * n.y, z: vn * n.z }, Tg = { x: vel.x - N.x, y: vel.y - N.y, z: vel.z - N.z };
    const c = giro ? cruz(giro, { x: -n.x * bola.raio, y: -n.y * bola.raio, z: -n.z * bola.raio }) : { x: 0, y: 0, z: 0 };
    const f = limitar(bola.atrito);
    const nt = { x: Tg.x - (Tg.x + c.x) * f, y: Tg.y - (Tg.y + c.y) * f, z: Tg.z - (Tg.z + c.z) * f };
    if (giro) { giro.x *= 1 - f; giro.y *= 1 - f; giro.z *= 1 - f; }
    return { x: nt.x - N.x * bola.restituicao, y: nt.y - N.y * bola.restituicao, z: nt.z - N.z * bola.restituicao };
  }

  // ══════════════════════════════ boliche ══════════════════════════════

  // Os pinos na ordem do js/esportes.js (1 na frente; em cada fileira, da esquerda para a direita): a coluna em
  // meias distâncias e a fileira.
  const COL = [0, -1, 1, -2, 0, 2, -3, -1, 1, 3], FIL = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3];
  const mascara = (emPe) => emPe.reduce((m, de, i) => (de ? m | (1 << i) : m), 0);
  const contarBits = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
  /** Split: o pino 1 caiu e os que sobraram formam dois ou mais grupos sem pino entre eles (regra da USBC). */
  function ehSplit(m) {
    if (m & 1 || contarBits(m) < 2) return false;
    let vistos = 0, grupos = 0;
    for (let i = 0; i < 10; i++) {
      if (!((m >> i) & 1) || (vistos >> i) & 1) continue;
      grupos++;
      const pilha = [i]; vistos |= 1 << i;
      while (pilha.length) {
        const a = pilha.pop();
        for (let b = 0; b < 10; b++) {
          if (!((m >> b) & 1) || (vistos >> b) & 1) continue;
          const df = Math.abs(FIL[a] - FIL[b]), dc = Math.abs(COL[a] - COL[b]);
          if ((df === 0 && dc === 2) || (df === 1 && dc === 1) || (df === 2 && dc === 0)) { vistos |= 1 << b; pilha.push(b); }
        }
      }
    }
    return grupos >= 2;
  }
  /** O nome do split (os pinos em pé, do menor para o maior: "7-10", "4-6"...). */
  const nomeSplit = (m) => Array.from({ length: 10 }, (_, i) => ((m >> i) & 1 ? i + 1 : 0)).filter(Boolean).join("-");

  // ══════════════════════════════ beisebol ══════════════════════════════

  /**
   * O que a eliminação vira, com as bases e as eliminações de antes: {tipo: "simples"|"dupla"|"sacrificio", corridas,
   * bases, fora}. Rasteira com corredor na 1ª e menos de 2 eliminações: queimada dupla (a chance vem da defesa);
   * bola alta funda com corredor na 3ª e menos de 2 eliminações: voo de sacrifício (ele marca).
   */
  function eliminacao({ bases, fora, alta, distancia = 0, defesa = 0.5, sorteio = Math.random }) {
    const b = bases.slice();
    if (!alta && b[0] && fora < 2 && sorteio() < 0.35 + 0.35 * defesa) {
      b[0] = false;
      return { tipo: "dupla", corridas: 0, bases: b, fora: Math.min(3, fora + 2) };
    }
    if (alta && b[2] && fora < 2 && distancia >= 60) {
      b[2] = false;
      return { tipo: "sacrificio", corridas: 1, bases: b, fora: fora + 1 };
    }
    return { tipo: "simples", corridas: 0, bases: b, fora: fora + 1 };
  }

  // ══════════════════════════════ a IA ══════════════════════════════

  /** Hash FNV-1a (estável em qualquer navegador). */
  function hash(s) {
    let h = 2166136261;
    for (const ch of String(s || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) & 0x7fffffff;
  }
  /** O perfil de um adversário: força 0 a 1 e a semente (o nome dele) dão o estilo. */
  function perfilIA(forca, semente = "cpu", corpo = {}) {
    const s = limitar(forca), h = hash(semente), u1 = (h & 0xff) / 255, u2 = ((h >> 8) & 0xff) / 255, u3 = ((h >> 16) & 0xff) / 255;
    const altura = limitar(corpo.altura ?? 0.5), peso = limitar(corpo.peso ?? 0.5);
    return {
      forca: s,
      precisao: limitar(0.25 + 0.7 * s + 0.05 * (u1 - 0.5)),
      reacao: 0.45 - 0.33 * s + 0.04 * u2,                 // segundos até reagir
      potencia: limitar(0.3 + 0.4 * s + 0.3 * peso),
      velocidade: limitar(0.35 + 0.45 * s + 0.25 * (1 - Math.abs(peso - 0.4))),
      alcance: 0.85 + 0.3 * altura,
      agressividade: limitar(0.3 + 0.4 * u3 + 0.2 * s),
      lado: u1 * 2 - 1,                                     // prefere a esquerda (-1) ou a direita (+1)
      semente: h,
      /** Um erro aleatório (normal) que diminui com a precisão. */
      erro(escala, r = Math.random) {
        const a = 1 - r(), b = r();
        return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b) * escala * (1 - this.precisao * 0.9);
      },
    };
  }

  // ══════════════════════════════ habilidade (Elo) ══════════════════════════════

  const HABILIDADE_MAX = 2000, K = 60;
  /** Quanto os pontos mudam: força do adversário 0 a 1 (vira 0 a 2000), resultado 1 = vitória, 0,5 = empate. */
  function deltaHabilidade(atual, forcaAdversario, resultado) {
    const opp = limitar(forcaAdversario) * HABILIDADE_MAX;
    const esperado = 1 / (1 + Math.pow(10, (opp - atual) / 400));
    return Math.round(K * (limitar(resultado) - esperado));
  }
  /** A força do CPU para quem tem esses pontos (o adversário acompanha você). */
  const forcaPara = (pontos) => limitar(0.15 + 0.8 * limitar(pontos / HABILIDADE_MAX));

  // ══════════════════════════════ recordes ══════════════════════════════

  const PREF = "webc.esportes.recordes";
  function ler() { try { return JSON.parse(LNUX.preferencia.ler(PREF, "{}")) || {}; } catch (e) { return {}; } }
  function gravar(d) { try { LNUX.preferencia.gravar(PREF, JSON.stringify(d)); } catch (e) { /* sem armazenamento */ } }
  /** Quem está jogando: a conta (se entrou) ou o nome guardado; "visitante" se nenhum. */
  function pessoa() {
    const c = C.contas && C.contas.eu;
    if (c && (c.id || c.nome)) return "conta:" + (c.id || c.nome);
    try { const n = localStorage.getItem("companhia.sala-nome"); if (n) return "nome:" + n; } catch (e) { /* sem armazenamento */ }
    return "visitante";
  }
  function doJogo(jogo, quem = pessoa()) {
    const d = ler(), p = (d[quem] = d[quem] || {});
    return { d, p, r: (p[jogo] = p[jogo] || { partidas: 0, vitorias: 0, habilidade: 0, melhor: null }) };
  }
  /** Os recordes de um jogo (para a página JOGOS e o fim de partida). */
  const recordesDe = (jogo, quem) => ({ ...doJogo(jogo, quem).r });
  /**
   * Registra uma partida. resultado: {vitoria, empate?, recorde?: {valor, melhor: "maior"|"menor", rotulo}, forcaCPU?}.
   * Devolve {novoRecorde, anterior, delta, habilidade}.
   */
  function registrar(jogo, resultado = {}, quem = pessoa()) {
    const { d, r } = doJogo(jogo, quem);
    r.partidas++;
    if (resultado.vitoria) r.vitorias++;
    let novoRecorde = false, anterior = null;
    const rec = resultado.recorde;
    if (rec && Number.isFinite(rec.valor)) {
      // cada variante (ex.: golfe de 3, 9 ou 18 buracos) tem o próprio recorde; o cartão mostra o último que melhorou
      const v = String(rec.variante || "-"), por = (r.melhores = r.melhores || {});
      anterior = por[v] ? por[v].valor : null;
      const melhorou = anterior === null || (rec.melhor === "menor" ? rec.valor < anterior : rec.valor > anterior);
      if (melhorou) {
        por[v] = { valor: rec.valor, rotulo: rec.rotulo || String(rec.valor) };
        r.melhor = rec.valor; r.rotulo = por[v].rotulo; novoRecorde = true;
      }
    }
    let delta = 0;
    if (Number.isFinite(resultado.forcaCPU)) {
      delta = deltaHabilidade(r.habilidade, resultado.forcaCPU, resultado.empate ? 0.5 : resultado.vitoria ? 1 : 0);
      r.habilidade = Math.max(0, Math.min(HABILIDADE_MAX, r.habilidade + delta));
    }
    gravar(d);
    return { novoRecorde, anterior, delta, habilidade: r.habilidade };
  }

  C.esportesNucleo = {
    G, BOLAS, aceleracao, passo, eixoBackspin, preverQueda, velocidadePara, quique,
    mascara, ehSplit, nomeSplit, eliminacao,
    hash, perfilIA, deltaHabilidade, forcaPara, HABILIDADE_MAX,
    pessoa, recordesDe, registrar,
  };
})();
