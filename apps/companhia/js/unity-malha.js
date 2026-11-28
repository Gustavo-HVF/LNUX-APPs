/*
 * Companhia — ler as malhas do Unity guardadas como arquivo próprio (Mesh .asset, em YAML).
 *
 * Muitos pacotes de mundo não trazem .fbx: cada malha vem como um "Mesh.asset" (é assim que o Unity guarda malhas
 * feitas ou juntadas dentro dele, e é o que sai dos mundos exportados com as peças separadas). Há dois jeitos:
 *   - cru (m_MeshCompression: 0): m_VertexData com os canais (posição, normal, tangente, cor, UV0..7, pesos) e os
 *     bytes em hexadecimal (_typelessdata), e m_IndexBuffer com os índices (16 ou 32 bits);
 *   - comprimido (m_MeshCompression 1 a 3): m_CompressedMesh, com cada parte num vetor de bits (PackedBitVector):
 *     inteiros de N bits, que viram números com m_Start + m_Range.
 * Cada submalha (m_SubMeshes) vira um grupo da geometria (um material para cada).
 * O Unity usa a mão esquerda e as faces da frente em sentido horário: o X troca de sinal e a ordem dos cantos de cada
 * triângulo inverte (o three quer anti-horário). As formas (blend shapes) e os ossos não entram: aqui é cenário.
 *
 * C.unityMalha = { ler(texto) → BufferGeometry | null }
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});

  const campo = (t, nome) => { const m = new RegExp("^\\s*" + nome + ":[ \\t]*(.*)$", "m").exec(t); return m ? m[1].trim() : null; };
  const hexParaBytes = (h) => {
    h = (h || "").trim();
    const b = new Uint8Array(h.length >> 1);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  };
  /** Um bloco do YAML pelo nome (as linhas com mais recuo que ele), ou "". */
  function bloco(t, nome) {
    const m = new RegExp("^( *)" + nome + ":[^\\n]*\\n", "m").exec(t);
    if (!m) return "";
    const recuo = m[1].length, linhas = t.slice(m.index + m[0].length).split("\n"), saida = [];
    for (const l of linhas) {
      if (l.trim() && l.search(/\S/) <= recuo && !(l.search(/\S/) === recuo && l.trimStart().startsWith("- "))) break;
      saida.push(l);
    }
    return saida.join("\n");
  }

  // ── PackedBitVector ─────────────────────────────────────────────────
  function lerPacote(t, nome) {
    const b = bloco(t, nome);
    return { n: +(campo(b, "m_NumItems") || 0), range: +(campo(b, "m_Range") || 0), start: +(campo(b, "m_Start") || 0), dados: hexParaBytes(campo(b, "m_Data")), bits: +(campo(b, "m_BitSize") || 0) };
  }
  function inteiros(p, quantos = p.n, inicio = 0) {
    const r = new Uint32Array(quantos);
    if (!p.bits) return r;
    let pos = p.bits * inicio, ind = pos >> 3;
    pos &= 7;
    for (let i = 0; i < quantos; i++) {
      let x = 0, bits = 0;
      while (bits < p.bits) {
        x |= ((p.dados[ind] || 0) >> pos) << bits;
        const num = Math.min(p.bits - bits, 8 - pos);
        pos += num; bits += num;
        if (pos === 8) { ind++; pos = 0; }
      }
      r[i] = p.bits >= 32 ? x >>> 0 : x & ((1 << p.bits) - 1);
    }
    return r;
  }
  function numeros(p, quantos = p.n, inicio = 0) {
    const ints = inteiros(p, quantos, inicio), max = p.bits >= 32 ? 4294967295 : (1 << p.bits) - 1;
    const escala = max ? p.range / max : 0, r = new Float32Array(quantos);
    for (let i = 0; i < quantos; i++) r[i] = ints[i] * escala + p.start;
    return r;
  }

  // ── os formatos dos canais (VertexData serializedVersion 3; as antigas usam outra tabela) ──
  const FORMATOS3 = [[4, "f32"], [2, "f16"], [1, "un8"], [1, "sn8"], [2, "un16"], [2, "sn16"], [1, "u8"], [1, "s8"], [2, "u16"], [2, "s16"], [4, "u32"], [4, "s32"]];
  const FORMATOS2 = [[4, "f32"], [2, "f16"], [1, "un8"], [1, "u8"], [4, "u32"]];
  function meia(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  function lerValor(dv, o, tipo) {
    switch (tipo) {
      case "f32": return dv.getFloat32(o, true);
      case "f16": return meia(dv.getUint16(o, true));
      case "un8": return dv.getUint8(o) / 255;
      case "sn8": return Math.max(-1, dv.getInt8(o) / 127);
      case "un16": return dv.getUint16(o, true) / 65535;
      case "sn16": return Math.max(-1, dv.getInt16(o, true) / 32767);
      case "u8": return dv.getUint8(o);
      case "s8": return dv.getInt8(o);
      case "u16": return dv.getUint16(o, true);
      case "s16": return dv.getInt16(o, true);
      case "u32": return dv.getUint32(o, true);
      default: return dv.getInt32(o, true);
    }
  }

  /** Os vértices crus: {pos, normal, uv, uv2, cor} (Float32Array, no espaço do Unity) ou null. */
  function lerCru(t) {
    const vd = bloco(t, "m_VertexData"), n = +(campo(vd, "m_VertexCount") || 0);
    const dados = hexParaBytes(campo(vd, "_typelessdata"));
    if (!n || !dados.length) return null;
    const versao = +(campo(vd, "serializedVersion") || 3);
    const tabela = versao >= 3 ? FORMATOS3 : FORMATOS2;
    const canais = [...bloco(vd, "m_Channels").matchAll(/stream:\s*(\d+)\s*\n\s*offset:\s*(\d+)\s*\n\s*format:\s*(\d+)\s*\n\s*dimension:\s*(\d+)/g)]
      .map((m) => ({ stream: +m[1], offset: +m[2], format: +m[3], dim: +m[4] & 0xf }));
    // o passo de cada fluxo (stream) e onde ele começa (cada um alinhado em 16 bytes)
    const passos = [], inicios = [];
    for (const c of canais) if (c.dim) { const tam = (tabela[c.format] || [4])[0] * c.dim; passos[c.stream] = Math.max(passos[c.stream] || 0, c.offset + tam); }
    let fim = 0;
    for (let s = 0; s < passos.length; s++) { if (!passos[s]) continue; inicios[s] = fim; fim = Math.ceil((fim + passos[s] * n) / 16) * 16; }
    const dv = new DataView(dados.buffer);
    const canal = (i, dimQuer) => {
      const c = canais[i];
      if (!c || !c.dim || passos[c.stream] === undefined) return null;
      const [tam, tipo] = tabela[c.format] || [4, "f32"], r = new Float32Array(n * dimQuer);
      for (let v = 0; v < n; v++) {
        const base = inicios[c.stream] + v * passos[c.stream] + c.offset;
        if (base + tam * c.dim > dados.length) return null;
        for (let k = 0; k < Math.min(dimQuer, c.dim); k++) r[v * dimQuer + k] = lerValor(dv, base + k * tam, tipo);
        if (dimQuer === 4 && c.dim < 4) r[v * 4 + 3] = 1;
      }
      return r;
    };
    // a ordem dos canais: 0 posição, 1 normal, 2 tangente, 3 cor, 4.. UV0..UV7 (versão 2: 0 pos, 1 normal, 2 cor, 3 UV0, 4 UV1, 5 tangente)
    return versao >= 3
      ? { n, pos: canal(0, 3), normal: canal(1, 3), cor: canal(3, 4), uv: canal(4, 2), uv2: canal(5, 2) }
      : { n, pos: canal(0, 3), normal: canal(1, 3), cor: canal(2, 4), uv: canal(3, 2), uv2: canal(4, 2) };
  }
  /** Os vértices comprimidos (m_CompressedMesh). */
  function lerComprimido(t) {
    const cm = bloco(t, "m_CompressedMesh");
    const vs = lerPacote(cm, "m_Vertices");
    if (!vs.n) return null;
    const n = vs.n / 3, r = { n, pos: numeros(vs) };
    const uv = lerPacote(cm, "m_UV"), info = +(campo(cm, "m_UVInfo") || 0);
    if (uv.n) {
      if (info) {
        let deslocado = 0;
        for (let c = 0; c < 8; c++) {
          const bits = info >>> (c * 4);
          if (!(bits & 4)) continue;
          const dim = 1 + (bits & 3), dd = numeros(uv, dim * n, deslocado), saida = new Float32Array(n * 2);
          for (let v = 0; v < n; v++) { saida[v * 2] = dd[v * dim]; saida[v * 2 + 1] = dim > 1 ? dd[v * dim + 1] : 0; }
          deslocado += dim * n;
          if (c === 0) r.uv = saida; else if (c === 1) r.uv2 = saida;
        }
      } else {
        r.uv = numeros(uv, Math.min(uv.n, n * 2));
        if (uv.n >= n * 4) r.uv2 = numeros(uv, n * 2, n * 2);
      }
    }
    const nm = lerPacote(cm, "m_Normals");
    if (nm.n) {
      const dd = numeros(nm), sinais = inteiros(lerPacote(cm, "m_NormalSigns")), saida = new Float32Array(n * 3);
      for (let v = 0; v < Math.min(n, dd.length / 2); v++) {
        const x = dd[v * 2], y = dd[v * 2 + 1], zz = 1 - x * x - y * y;
        let z = zz > 0 ? Math.sqrt(zz) : 0;
        if (sinais[v] === 0) z = -z;
        const l = Math.hypot(x, y, z) || 1;
        saida.set([x / l, y / l, z / l], v * 3);
      }
      r.normal = saida;
    }
    const cores = lerPacote(cm, "m_Colors");
    if (cores.n) {
      const ints = inteiros(cores), saida = new Float32Array(n * 4);
      for (let v = 0; v < Math.min(n, ints.length); v++) { const c = ints[v]; saida.set([(c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255, ((c >>> 24) & 255) / 255], v * 4); }
      r.cor = saida;
    }
    r.indices = inteiros(lerPacote(cm, "m_Triangles"));
    return r;
  }

  /** As submalhas: [{inicio (em índices, ou em bytes se porByte), quantos, baseVertex, topologia}]. */
  function submalhas(t) {
    return [...bloco(t, "m_SubMeshes").matchAll(/firstByte:\s*(\d+)\s*\n\s*indexCount:\s*(\d+)\s*\n\s*topology:\s*(\d+)(?:\s*\n\s*baseVertex:\s*(-?\d+))?/g)]
      .map((m) => ({ primeiroByte: +m[1], quantos: +m[2], topologia: +m[3], baseVertex: +(m[4] || 0) }));
  }

  C.unityMalha = {
    /** Uma malha .asset do Unity (o texto YAML) → BufferGeometry (no espaço do three.js), ou null se não der. */
    ler(texto) {
      const T = window.THREE;
      if (!/^\s*Mesh:\s*$/m.test(texto)) return null;
      const comprimida = +(campo(texto, "m_MeshCompression") || 0) > 0;
      let v = comprimida ? lerComprimido(texto) : null;
      if (!v) v = lerCru(texto);
      if (!v || !v.pos || !v.n) return null;
      const ind32 = campo(texto, "m_IndexFormat") === "1";
      let indices = v.indices;
      if (!indices) {
        const b = hexParaBytes(campo(texto, "m_IndexBuffer")), dv = new DataView(b.buffer);
        indices = new Uint32Array(b.length / (ind32 ? 4 : 2));
        for (let i = 0; i < indices.length; i++) indices[i] = ind32 ? dv.getUint32(i * 4, true) : dv.getUint16(i * 2, true);
      }
      const tamIndice = ind32 && !v.indices ? 4 : 2;
      // os índices de cada submalha (com baseVertex), e os quadrados viram dois triângulos
      const saida = [], grupos = [];
      for (const s of submalhas(texto)) {
        const ini = Math.floor(s.primeiroByte / tamIndice), inicioGrupo = saida.length;
        if (s.topologia === 0) for (let i = 0; i + 2 < s.quantos; i += 3) saida.push(indices[ini + i] + s.baseVertex, indices[ini + i + 1] + s.baseVertex, indices[ini + i + 2] + s.baseVertex);
        else if (s.topologia === 2) for (let i = 0; i + 3 < s.quantos; i += 4) { const q = [0, 1, 2, 3].map((k) => indices[ini + i + k] + s.baseVertex); saida.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
        grupos.push([inicioGrupo, saida.length - inicioGrupo]);
      }
      if (!saida.length) return null;
      // o espelho do X (mão esquerda → direita) e os cantos na ordem do three (anti-horário)
      const pos = v.pos.slice(0, v.n * 3);
      for (let i = 0; i < pos.length; i += 3) pos[i] = -pos[i];
      for (let i = 0; i < saida.length; i += 3) { const a = saida[i + 1]; saida[i + 1] = saida[i + 2]; saida[i + 2] = a; }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos, 3));
      if (v.normal) { const nn = v.normal.slice(0, v.n * 3); for (let i = 0; i < nn.length; i += 3) nn[i] = -nn[i]; g.setAttribute("normal", new T.BufferAttribute(nn, 3)); }
      // o V do Unity cresce para cima, como o do three com as texturas em flipY (o padrão): entra como está
      if (v.uv) g.setAttribute("uv", new T.BufferAttribute(v.uv.slice(0, v.n * 2), 2));
      if (v.uv2) g.setAttribute("uv1", new T.BufferAttribute(v.uv2.slice(0, v.n * 2), 2));
      if (v.cor) g.setAttribute("color", new T.BufferAttribute(v.cor.slice(0, v.n * 4), 4));
      const maior = saida.reduce((m, x) => (x > m ? x : m), 0);
      if (maior >= v.n) return null; // índices fora dos vértices: arquivo quebrado
      g.setIndex(maior > 65535 ? new T.BufferAttribute(new Uint32Array(saida), 1) : new T.BufferAttribute(new Uint16Array(saida), 1));
      for (let i = 0; i < grupos.length; i++) g.addGroup(grupos[i][0], grupos[i][1], i);
      if (!v.normal) g.computeVertexNormals();
      g.name = campo(texto, "m_Name") || "Malha";
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    },
  };
})();
