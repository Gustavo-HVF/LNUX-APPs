/*
 * Companhia — o esqueleto de uma personagem do Blender (.blend), para ela virar VRM (js/avatar.js).
 *
 * Duas fontes, nesta ordem:
 *   1. a armadura do arquivo (os ossos em repouso, lidos por js/blend.js): os pesos de cada vértice vêm dos grupos de
 *      vértices com o nome do osso;
 *   2. sem armadura, mas com os grupos de vértices (é comum: muitos modelos do Sketchfab e de lojas vêm "sem o rig",
 *      com os pesos ainda guardados na malha), o esqueleto é refeito a partir dos grupos: cada junta fica onde o grupo
 *      do osso encontra o do pai (os vértices com peso dos dois), e a hierarquia sai dos nomes (Hips → Spine → Chest →
 *      Neck → Head, braços, dedos, pernas), das correntes numeradas (Hair.L.001 → Hair.L.002...) e, para o resto, do
 *      grupo com que ele mais se mistura.
 * Sem armadura e sem grupos não há como saber como o corpo dobra: a mensagem explica como fazer o rig no Blender.
 *
 * Este arquivo não usa o three.js: devolve só números, no espaço do Blender (Z para cima). Quem monta a cena é o
 * conversor (js/conversor.js).
 */
(function (raiz) {
  "use strict";
  const C = (raiz.C = raiz.C || {});

  /** Ponto × matriz 4×4 (em colunas, como o Blender guarda). */
  const aplicar = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

  // a hierarquia de uma pessoa, pelos papéis do VRM (C.mapearOssos acha o papel de cada nome)
  const PAI_HUMANO = {
    spine: "hips", chest: "spine", upperChest: "chest", neck: ["upperChest", "chest", "spine"], head: "neck", leftEye: "head", rightEye: "head", jaw: "head",
    leftShoulder: ["upperChest", "chest", "spine"], rightShoulder: ["upperChest", "chest", "spine"],
    leftUpperArm: ["leftShoulder", "upperChest", "chest", "spine"], rightUpperArm: ["rightShoulder", "upperChest", "chest", "spine"],
    leftLowerArm: "leftUpperArm", rightLowerArm: "rightUpperArm", leftHand: "leftLowerArm", rightHand: "rightLowerArm",
    leftUpperLeg: "hips", rightUpperLeg: "hips", leftLowerLeg: "leftUpperLeg", rightLowerLeg: "rightUpperLeg",
    leftFoot: "leftLowerLeg", rightFoot: "rightLowerLeg", leftToes: "leftFoot", rightToes: "rightFoot",
  };
  for (const lado of ["left", "right"]) {
    for (const d of ["Index", "Middle", "Ring", "Little"]) { PAI_HUMANO[lado + d + "Proximal"] = lado + "Hand"; PAI_HUMANO[lado + d + "Intermediate"] = lado + d + "Proximal"; PAI_HUMANO[lado + d + "Distal"] = lado + d + "Intermediate"; }
    PAI_HUMANO[lado + "ThumbMetacarpal"] = lado + "Hand"; PAI_HUMANO[lado + "ThumbProximal"] = [lado + "ThumbMetacarpal", lado + "Hand"]; PAI_HUMANO[lado + "ThumbDistal"] = lado + "ThumbProximal";
  }

  /**
   * Refaz o esqueleto a partir dos grupos de vértices. nomes: os nomes dos grupos; pos: as posições dos vértices (nv×3,
   * no mundo); pesos: {grupos, pesos} (nv×4, de js/blend.js). Devolve [{nome, pai (índice ou -1), pos: [x, y, z]}] na
   * ordem dos grupos usados, ou null.
   */
  function esqueletoDosGrupos(nomes, pos, pesos) {
    const nv = pos.length / 3, n = nomes.length;
    const soma = new Float64Array(n), centro = new Float64Array(n * 3);
    // quanto cada par de grupos se mistura (os vértices com peso dos dois) e onde
    const juntos = new Map(); // a*n+b → [peso, x, y, z]
    for (let v = 0; v < nv; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const g = pesos.grupos[v * 4 + k], w = pesos.pesos[v * 4 + k];
        if (g < 0 || g >= n || w <= 0) continue;
        soma[g] += w; centro[g * 3] += x * w; centro[g * 3 + 1] += y * w; centro[g * 3 + 2] += z * w;
        for (let j = k + 1; j < 4; j++) {
          const h = pesos.grupos[v * 4 + j], u = pesos.pesos[v * 4 + j];
          if (h < 0 || h >= n || u <= 0) continue;
          const m = Math.min(w, u), chave = Math.min(g, h) * n + Math.max(g, h);
          const a = juntos.get(chave) || juntos.set(chave, [0, 0, 0, 0]).get(chave);
          a[0] += m; a[1] += x * m; a[2] += y * m; a[3] += z * m;
        }
      }
    }
    const usados = [];
    for (let g = 0; g < n; g++) if (soma[g] > 1e-6) usados.push(g);
    if (!usados.length) return null;
    const centroDe = (g) => [centro[g * 3] / soma[g], centro[g * 3 + 1] / soma[g], centro[g * 3 + 2] / soma[g]];
    const mistura = (a, b) => juntos.get(Math.min(a, b) * n + Math.max(a, b)) || null;
    // os papéis de pessoa pelos nomes
    const papel = new Map(), dePapel = new Map();
    if (C.mapearOssos) {
      const mapa = C.mapearOssos(usados.map((g) => ({ nome: nomes[g], pai: null })));
      for (const [vrm, nome] of Object.entries(mapa)) { const g = usados.find((x) => nomes[x] === nome); if (g !== undefined && !dePapel.has(vrm)) { papel.set(g, vrm); dePapel.set(vrm, g); } }
    }
    // o pai de cada grupo
    const pai = new Map();
    const porNome = new Map(usados.map((g) => [nomes[g], g]));
    for (const g of usados) {
      const p = papel.get(g);
      if (p === "hips") { pai.set(g, -1); continue; }
      if (p && PAI_HUMANO[p]) {
        const opcoes = [].concat(PAI_HUMANO[p]);
        const achado = opcoes.map((o) => dePapel.get(o)).find((x) => x !== undefined);
        if (achado !== undefined) { pai.set(g, achado); continue; }
      }
      // corrente numerada: "Hair.L.002" vem de "Hair.L.001"
      const m = /^(.*?)(\d+)$/.exec(nomes[g]);
      if (m && +m[2] > 1) {
        const anterior = [m[1] + String(+m[2] - 1).padStart(m[2].length, "0"), m[1] + (+m[2] - 1)].map((x) => porNome.get(x)).find((x) => x !== undefined);
        if (anterior !== undefined) { pai.set(g, anterior); continue; }
      }
    }
    // o resto: o grupo de pessoa (ou outro já ligado) com que mais se mistura; sem mistura, o mais perto
    const sobe = (g, alvo) => { for (let x = g, i = 0; x !== undefined && x >= 0 && i < 400; x = pai.get(x), i++) if (x === alvo) return true; return false; };
    for (const g of usados) {
      if (pai.has(g)) continue;
      let melhor = -1, nota = 0;
      for (const h of usados) {
        if (h === g || sobe(h, g)) continue;
        const j = mistura(g, h), peso = j ? j[0] * (papel.has(h) ? 2 : 1) : 0;
        if (peso > nota) { nota = peso; melhor = h; }
      }
      if (melhor < 0) {
        const c = centroDe(g);
        let perto = Infinity;
        for (const h of usados) { if (h === g || sobe(h, g) || !papel.has(h)) continue; const d = centroDe(h), dd = (d[0] - c[0]) ** 2 + (d[1] - c[1]) ** 2 + (d[2] - c[2]) ** 2; if (dd < perto) { perto = dd; melhor = h; } }
      }
      pai.set(g, melhor);
    }
    if (![...pai.values()].includes(-1) && !dePapel.has("hips")) { const raizG = usados[0]; pai.set(raizG, -1); }
    // a posição: onde o grupo encontra o do pai (a cabeça do osso); sem mistura, a ponta do grupo virada para o pai (os
    // vértices dele mais perto do meio do pai); sem pai, o meio do próprio grupo
    const pontaPerto = (g, p) => {
      const alvo = centroDe(p), lista = [];
      for (let v = 0; v < nv; v++) for (let k = 0; k < 4; k++) if (pesos.grupos[v * 4 + k] === g && pesos.pesos[v * 4 + k] > 0.3) { lista.push([(pos[v * 3] - alvo[0]) ** 2 + (pos[v * 3 + 1] - alvo[1]) ** 2 + (pos[v * 3 + 2] - alvo[2]) ** 2, v]); break; }
      if (!lista.length) return centroDe(g);
      lista.sort((x, y) => x[0] - y[0]);
      // a ponta: os vértices quase tão perto quanto o mais perto (a face inteira da ponta, não só um canto)
      const d0 = Math.sqrt(lista[0][0]), dMax = Math.sqrt(lista[lista.length - 1][0]), limite = d0 + Math.max(0.01, (dMax - d0) * 0.15), r = [0, 0, 0];
      let k = 0;
      for (const [dd, v] of lista) { if (Math.sqrt(dd) > limite) break; r[0] += pos[v * 3]; r[1] += pos[v * 3 + 1]; r[2] += pos[v * 3 + 2]; k++; }
      return r.map((x) => x / k);
    };
    const ossos = usados.map((g) => {
      const p = pai.get(g), j = p >= 0 ? mistura(g, p) : null;
      const posicao = j && j[0] > 1e-4 ? [j[1] / j[0], j[2] / j[0], j[3] / j[0]] : p >= 0 ? pontaPerto(g, p) : centroDe(g);
      return { grupo: g, nome: nomes[g], paiGrupo: p, pos: posicao };
    });
    // o quadril fica entre as coxas e a coluna (o meio do grupo dele costuma cair na barriga)
    const iH = dePapel.get("hips");
    if (iH !== undefined) {
      const juntas = ["spine", "leftUpperLeg", "rightUpperLeg"].map((r) => dePapel.get(r)).filter((x) => x !== undefined).map((x) => ossos.find((o) => o.grupo === x).pos);
      if (juntas.length >= 2) ossos.find((o) => o.grupo === iH).pos = [0, 1, 2].map((k) => juntas.reduce((s, q) => s + q[k], 0) / juntas.length);
    }
    const indice = new Map(ossos.map((o, i) => [o.grupo, i]));
    // pais antes dos filhos
    const ordem = [], feito = new Set();
    const pôr = (o, i = 0) => { if (feito.has(o.grupo) || i > 400) return; const p = o.paiGrupo; if (p >= 0 && indice.has(p)) pôr(ossos[indice.get(p)], i + 1); feito.add(o.grupo); ordem.push(o); };
    for (const o of ossos) pôr(o);
    const novo = new Map(ordem.map((o, i) => [o.grupo, i]));
    return ordem.map((o) => ({ nome: o.nome, pai: o.paiGrupo >= 0 && novo.has(o.paiGrupo) ? novo.get(o.paiGrupo) : -1, pos: o.pos, grupo: o.grupo }));
  }

  /**
   * O esqueleto e os pesos de um objeto do .blend (o que js/blend.js leu). b: o resultado de C.blend.ler; o: o objeto;
   * m: a malha dele. Devolve {ossos: [{nome, pai, pos (mundo, Z para cima)}], ossoDe: Int16Array (nv×4), pesoDe:
   * Float32Array (nv×4), como: "armadura" | "grupos"} ou null (sem como saber).
   */
  C.esqueletoDoBlend = function (b, o, m) {
    const nv = m.nVertices;
    // as posições dos vértices no mundo (uma por vértice, não por canto)
    const pos = new Float32Array(nv * 3), feito = new Uint8Array(nv);
    for (let i = 0; i < m.indices.length; i++) {
      const v = m.indices[i];
      if (feito[v]) continue;
      feito[v] = 1;
      const p = aplicar(o.matriz, m.posicoes[i * 3], m.posicoes[i * 3 + 1], m.posicoes[i * 3 + 2]);
      pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
    }
    let ossos = null, como = "";
    const arm = o.armadura >= 0 ? b.armaduras[o.armadura] : null;
    if (arm && arm.ossos.length) {
      ossos = arm.ossos.map((x) => ({ nome: x.nome, pai: x.pai, pos: aplicar(arm.matriz, x.cabeca[0], x.cabeca[1], x.cabeca[2]) }));
      como = "armadura";
    } else if (m.pesos && o.grupos.length) {
      ossos = esqueletoDosGrupos(o.grupos, pos, m.pesos);
      como = "grupos";
    }
    if (!ossos || !ossos.length) return null;
    // os pesos: grupo → osso (pelo nome)
    const doGrupo = new Map(), porNome = new Map(ossos.map((x, i) => [x.nome, i]));
    o.grupos.forEach((nome, g) => { if (porNome.has(nome)) doGrupo.set(g, porNome.get(nome)); });
    const ossoDe = new Int16Array(nv * 4), pesoDe = new Float32Array(nv * 4);
    let semPeso = 0;
    for (let v = 0; v < nv; v++) {
      let total = 0, k2 = 0;
      for (let k = 0; k < 4 && m.pesos; k++) {
        const g = m.pesos.grupos[v * 4 + k], w = m.pesos.pesos[v * 4 + k];
        if (g < 0 || w <= 0 || !doGrupo.has(g)) continue;
        ossoDe[v * 4 + k2] = doGrupo.get(g); pesoDe[v * 4 + k2] = w; total += w; k2++;
      }
      if (total > 1e-6) { for (let k = 0; k < k2; k++) pesoDe[v * 4 + k] /= total; continue; }
      // sem peso (uma peça que não foi presa): vai com o osso mais perto
      semPeso++;
      let melhor = 0, d = Infinity;
      for (let i = 0; i < ossos.length; i++) { const q = ossos[i].pos, dd = (q[0] - pos[v * 3]) ** 2 + (q[1] - pos[v * 3 + 1]) ** 2 + (q[2] - pos[v * 3 + 2]) ** 2; if (dd < d) { d = dd; melhor = i; } }
      ossoDe[v * 4] = melhor; pesoDe[v * 4] = 1;
    }
    return { ossos, ossoDe, pesoDe, como, semPeso, posicoes: pos };
  };
  C.esqueletoDosGrupos = esqueletoDosGrupos;
})(typeof window !== "undefined" ? window : globalThis);
