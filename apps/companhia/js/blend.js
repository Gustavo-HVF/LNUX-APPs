/*
 * Companhia — leitor de arquivos .blend (Blender), para converter cenários sem precisar do Blender instalado.
 *
 * O .blend é a memória do Blender gravada em blocos; no fim vem o "DNA", que descreve cada estrutura (nomes,
 * tipos e tamanhos dos campos) na versão que gravou o arquivo. Por isso o leitor não tem as estruturas fixas:
 * ele lê o DNA e procura os campos pelo nome. Assim abre arquivos de versões diferentes:
 *
 *   - cabeçalho antigo ("BLENDER-v305", até o Blender 4.x) e novo ("BLENDER17-01v0500", do 5.0 em diante);
 *   - compactados com gzip (até o 2.93) ou zstd (do 3.0 em diante);
 *   - malhas no formato antigo (MVert/MLoop/MPoly, até o 3.x), em camadas de atributos (do 3.5 ao 4.5:
 *     "position", ".corner_vert", "material_index", UV) e no depósito de atributos (do 5.0 em diante).
 *
 * O que sai: os objetos de malha com a posição no mundo (inclusive filhos de outros objetos), os triângulos
 * (polígonos de mais de 3 lados são divididos), o primeiro mapa UV, os materiais (cor, rugosidade, metal e a
 * imagem ligada à cor do Principled BSDF) e as imagens embutidas no arquivo.
 *
 * O que NÃO sai (para isso, converta pelo próprio Blender; a ponte faz sozinha quando ele está instalado):
 * modificadores (espelho, matriz, subdivisão...), curvas, textos, metaballs, instâncias de coleção, partículas,
 * animações e materiais além do Principled simples.
 *
 * Este arquivo não usa o navegador nem o three.js: devolve só números (C.blend.ler). Quem monta a cena é o
 * conversor (js/conversor.js).
 */
(function (raiz) {
  "use strict";
  const texto = new TextDecoder();

  /** Lê o DNA e os blocos. dados: Uint8Array já descompactado. */
  function abrir(dados) {
    const visao = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
    const marca = texto.decode(dados.subarray(0, 7));
    if (marca !== "BLENDER") throw new Error("Esse arquivo não é um .blend do Blender.");
    let pos, ponteiro, pequeno, versao, cabecaGrande = false;
    const c7 = String.fromCharCode(dados[7]);
    if (c7 === "_" || c7 === "-") { // "BLENDER-v305": ponteiro (_ = 4, - = 8), ordem dos bytes (v = pequena), versão
      ponteiro = c7 === "_" ? 4 : 8;
      pequeno = String.fromCharCode(dados[8]) === "v";
      versao = +texto.decode(dados.subarray(9, 12));
      pos = 12;
    } else { // "BLENDER17-01v0500": tamanho do cabeçalho, ponteiro, versão do formato, ordem dos bytes, versão
      const tam = +texto.decode(dados.subarray(7, 9));
      ponteiro = String.fromCharCode(dados[9]) === "_" ? 4 : 8;
      const formato = +texto.decode(dados.subarray(10, 12));
      pequeno = String.fromCharCode(dados[12]) === "v";
      versao = +texto.decode(dados.subarray(13, 17));
      cabecaGrande = formato >= 1;
      pos = tam;
    }
    if (!pequeno) throw new Error("Esse .blend foi gravado num computador de bytes invertidos (muito antigo); abra e salve de novo no Blender.");
    const ler = { u8: (p) => dados[p], i16: (p) => visao.getInt16(p, true), u16: (p) => visao.getUint16(p, true), i32: (p) => visao.getInt32(p, true), u32: (p) => visao.getUint32(p, true),
      f32: (p) => visao.getFloat32(p, true), f64: (p) => visao.getFloat64(p, true), i64: (p) => Number(visao.getBigInt64(p, true)),
      ptr: (p) => (ponteiro === 8 ? visao.getBigUint64(p, true) : BigInt(visao.getUint32(p, true))) };
    // blocos
    // Os endereços guardados nos ponteiros só valem dentro do grupo de cada dado (o bloco do objeto, da malha, do
    // material... e os blocos "DATA" que vêm logo depois dele): o Blender reaproveita endereços entre um grupo e outro.
    const blocos = [], porEndereco = new Map(), ids = new Map();
    let dna = null, escopo = new Map();
    while (pos + 16 <= dados.length) {
      const codigo = texto.decode(dados.subarray(pos, pos + 4)).replace(/\0+$/, "");
      let tam, velho, sdna, n, cab;
      if (cabecaGrande) { sdna = ler.i32(pos + 4); velho = ler.ptr(pos + 8); tam = ler.i64(pos + 16); n = ler.i64(pos + 24); cab = 32; }
      else if (ponteiro === 8) { tam = ler.i32(pos + 4); velho = ler.ptr(pos + 8); sdna = ler.i32(pos + 16); n = ler.i32(pos + 20); cab = 24; }
      else { tam = ler.i32(pos + 4); velho = ler.ptr(pos + 8); sdna = ler.i32(pos + 12); n = ler.i32(pos + 16); cab = 20; }
      if (codigo === "ENDB") break;
      const b = { codigo, tam, velho, sdna, n, inicio: pos + cab };
      if (codigo === "DNA1") dna = b;
      else {
        if (codigo !== "DATA") { escopo = new Map(); ids.set(velho, b); }
        b.escopo = escopo;
        escopo.set(velho, b);
        blocos.push(b);
        if (!porEndereco.has(velho)) porEndereco.set(velho, b); // dados compartilhados entre grupos: o primeiro que aparecer
      }
      pos += cab + tam;
    }
    if (!dna) throw new Error("Esse .blend está incompleto (falta a descrição das estruturas).");
    // DNA: SDNA NAME [nomes] TYPE [tipos] TLEN [tamanhos] STRC [estruturas]
    let p = dna.inicio + 4;
    const alinhar = () => { p = dna.inicio + ((p - dna.inicio + 3) & ~3); }; // o alinhamento é em relação ao começo do DNA
    const lista = (marcaEsperada) => {
      alinhar();
      if (texto.decode(dados.subarray(p, p + 4)) !== marcaEsperada) throw new Error("Esse .blend tem um DNA que não entendi.");
      const n = ler.i32(p + 4), itens = [];
      p += 8;
      for (let i = 0; i < n; i++) { let f = p; while (dados[f]) f++; itens.push(texto.decode(dados.subarray(p, f))); p = f + 1; }
      return itens;
    };
    const nomes = lista("NAME"), tipos = lista("TYPE");
    alinhar();
    p += 4; // TLEN
    const tamanhos = tipos.map((_, i) => ler.u16(p + i * 2));
    p += tipos.length * 2;
    alinhar();
    const nEstruturas = ler.i32(p + 4);
    p += 8;
    const estruturas = [], porNome = new Map();
    for (let i = 0; i < nEstruturas; i++) {
      const tipo = ler.u16(p), nCampos = ler.u16(p + 2), campos = new Map();
      p += 4;
      let desl = 0;
      for (let k = 0; k < nCampos; k++) {
        const t = ler.u16(p), nomeCru = nomes[ler.u16(p + 2)];
        p += 4;
        const ehPonteiro = nomeCru[0] === "*" || nomeCru.startsWith("(*");
        const dims = [...nomeCru.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]), quantos = dims.reduce((a, b) => a * b, 1);
        const base = ehPonteiro ? ponteiro : tamanhos[t];
        const nome = nomeCru.replace(/^\(?\*+/, "").replace(/\).*$/, "").replace(/\[.*$/, "");
        campos.set(nome, { desl, tipo: tipos[t], ponteiro: ehPonteiro, dims, quantos, base });
        desl += base * quantos;
      }
      const e = { nome: tipos[tipo], tam: tamanhos[tipo], campos };
      estruturas.push(e);
      porNome.set(e.nome, e);
    }
    const resolver = (esc, endereco) => (esc && esc.get(endereco)) || ids.get(endereco) || porEndereco.get(endereco) || null;
    return { dados, ler, ponteiro, versao, blocos, porEndereco, ids, resolver, estruturas, porNome };
  }

  /** Um registro de uma estrutura dentro de um bloco, com leitura dos campos pelo nome. */
  class Registro {
    constructor(arq, estrutura, inicio, escopo) { this.arq = arq; this.e = estrutura; this.inicio = inicio; this.escopo = escopo || null; }
    tem(nome) { return this.e.campos.has(nome); }
    /** O primeiro dos nomes que existir nesta versão (os campos mudam de nome entre as versões do Blender). */
    campo(...nomes) { for (const n of nomes) { const c = this.e.campos.get(n); if (c) return c; } return null; }
    num(...nomes) {
      const c = this.campo(...nomes);
      return c ? this.valor(c, this.inicio + c.desl) : undefined;
    }
    valor(c, p) {
      const l = this.arq.ler;
      if (c.ponteiro) return l.ptr(p);
      switch (c.tipo) {
        case "char": case "uchar": case "int8_t": case "uint8_t": case "bool": return l.u8(p);
        case "short": case "int16_t": return l.i16(p);
        case "ushort": case "uint16_t": return l.u16(p);
        case "int": case "int32_t": return l.i32(p);
        case "uint": case "uint32_t": return l.u32(p);
        case "float": return l.f32(p);
        case "double": return l.f64(p);
        case "int64_t": case "uint64_t": return l.i64(p);
        default: return undefined;
      }
    }
    vetor(...nomes) {
      const c = this.campo(...nomes);
      if (!c) return null;
      const r = [];
      for (let i = 0; i < c.quantos; i++) r.push(this.valor(c, this.inicio + c.desl + i * c.base));
      return r;
    }
    texto(...nomes) {
      const c = this.campo(...nomes);
      if (!c) return "";
      const p = this.inicio + c.desl, d = this.arq.dados;
      let f = p;
      while (f < p + c.quantos && d[f]) f++;
      return texto.decode(d.subarray(p, f));
    }
    /** Estrutura embutida (um campo que é outra estrutura). */
    dentro(...nomes) {
      const c = this.campo(...nomes);
      if (!c || c.ponteiro) return null;
      const e = this.arq.porNome.get(c.tipo);
      return e ? new Registro(this.arq, e, this.inicio + c.desl, this.escopo) : null;
    }
    /** O bloco para onde um ponteiro aponta (ou null). */
    bloco(...nomes) {
      const c = this.campo(...nomes);
      if (!c || !c.ponteiro) return null;
      return this.arq.resolver(this.escopo, this.arq.ler.ptr(this.inicio + c.desl));
    }
    /** O registro para onde um ponteiro aponta, lido como a estrutura do bloco (ou a pedida). */
    alvo(nome, estrutura) {
      const b = this.bloco(nome);
      return b ? registroDo(this.arq, b, 0, estrutura) : null;
    }
  }
  function registroDo(arq, bloco, i = 0, estrutura = null) {
    const e = estrutura ? arq.porNome.get(estrutura) : arq.estruturas[bloco.sdna];
    return e ? new Registro(arq, e, bloco.inicio + i * e.tam, bloco.escopo) : null;
  }
  /** Percorre uma lista ligada do Blender (ListBase: first → next → ...). */
  function* listaLigada(arq, registro, campo, estrutura) {
    const lb = registro.dentro(campo);
    if (!lb) return;
    let b = lb.bloco("first");
    for (let i = 0; b && i < 100000; i++) {
      const r = registroDo(arq, b, 0, estrutura);
      if (!r) return;
      yield r;
      b = r.bloco("next");
    }
  }
  const nomeDoId = (r) => { const id = r.dentro("id"); return id ? id.texto("name").slice(2) : ""; };

  // ── malhas ──────────────────────────────────────────────────────────
  const flutuantes = (arq, bloco, n, passo = 0, desl = 0, porItem = 3) => {
    // n itens de `porItem` números reais; passo = tamanho de cada item no arquivo (0 = colados)
    const saida = new Float32Array(n * porItem), tam = passo || porItem * 4;
    if (!bloco || bloco.tam < n * tam) return null;
    for (let i = 0; i < n; i++) for (let k = 0; k < porItem; k++) saida[i * porItem + k] = arq.ler.f32(bloco.inicio + i * tam + desl + k * 4);
    return saida;
  };
  const inteiros = (arq, bloco, n, passo = 4, desl = 0, tipo = "i32") => {
    if (!bloco || bloco.tam < n * passo) return null;
    const saida = new Int32Array(n);
    for (let i = 0; i < n; i++) saida[i] = arq.ler[tipo](bloco.inicio + i * passo + desl);
    return saida;
  };

  /** Acha uma camada de atributos (CustomData, do 2.6 ao 4.5) pelo tipo e, se dado, pelo nome. */
  function camada(arq, malha, dominio, tipos, nome) {
    const cd = malha.dentro(dominio);
    if (!cd) return null;
    const total = cd.num("totlayer") || 0, b = cd.bloco("layers");
    if (!b || !total) return null;
    for (let i = 0; i < total; i++) {
      const l = registroDo(arq, b, i, "CustomDataLayer");
      if (!l || !tipos.includes(l.num("type"))) continue;
      if (nome && l.texto("name") !== nome) continue;
      const dadosDaCamada = l.bloco("data");
      if (dadosDaCamada) return dadosDaCamada;
    }
    return null;
  }
  /** Acha um atributo no depósito de atributos (Blender 5.0 em diante) pelo nome (ou o primeiro que servir). */
  function atributo(arq, malha, nome, aceitar) {
    const dep = malha.dentro("attribute_storage");
    if (!dep) return null;
    const n = dep.num("dna_attributes_num") || 0, b = dep.bloco("dna_attributes");
    if (!b || !n) return null;
    for (let i = 0; i < n; i++) {
      const a = registroDo(arq, b, i, "Attribute");
      if (!a) continue;
      const bn = a.bloco("name");
      let nomeA = "";
      if (bn) { let f = bn.inicio; while (f < bn.inicio + bn.tam && arq.dados[f]) f++; nomeA = texto.decode(arq.dados.subarray(bn.inicio, f)); }
      if (nome ? nomeA !== nome : !aceitar(a, nomeA)) continue;
      const guarda = a.alvo("data", a.num("storage_type") === 0 ? "AttributeArray" : "AttributeSingle");
      const d = guarda && guarda.bloco("data");
      if (d) return { bloco: d, unico: a.num("storage_type") !== 0, tipo: a.num("data_type"), dominio: a.num("domain") };
    }
    return null;
  }

  /** Triângulos de um polígono de n lados (leque; os côncavos de mais de 4 lados passam por "cortar orelhas"). */
  function triangular(pos, cantos, saida) {
    const n = cantos.length;
    if (n < 3) return;
    if (n <= 4) { for (let i = 1; i < n - 1; i++) saida.push(cantos[0], cantos[i], cantos[i + 1]); return; }
    // plano do polígono (normal de Newell) e orelhas em 2D
    let nx = 0, ny = 0, nz = 0;
    const P = cantos.map((c) => [pos[c.v * 3], pos[c.v * 3 + 1], pos[c.v * 3 + 2]]);
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const eixo = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0 : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
    const u = (eixo + 1) % 3, w = (eixo + 2) % 3, sinal = [nx, ny, nz][eixo] < 0 ? -1 : 1;
    const Q = P.map((q) => [q[u] * sinal, q[w]]);
    const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const dentro = (a, b, c, q) => area(a, b, q) >= 0 && area(b, c, q) >= 0 && area(c, a, q) >= 0;
    const resto = cantos.map((_, i) => i);
    let voltas = 0;
    while (resto.length > 3 && voltas < n * n) {
      let cortou = false;
      for (let i = 0; i < resto.length; i++) {
        const ia = resto[(i + resto.length - 1) % resto.length], ib = resto[i], ic = resto[(i + 1) % resto.length];
        if (area(Q[ia], Q[ib], Q[ic]) <= 0) continue;
        if (resto.some((k) => k !== ia && k !== ib && k !== ic && dentro(Q[ia], Q[ib], Q[ic], Q[k]))) continue;
        saida.push(cantos[ia], cantos[ib], cantos[ic]);
        resto.splice(i, 1);
        cortou = true;
        break;
      }
      voltas++;
      if (!cortou) break;
    }
    for (let i = 1; i < resto.length - 1; i++) saida.push(cantos[resto[0]], cantos[resto[i]], cantos[resto[i + 1]]);
  }

  function lerMalha(arq, m) {
    const nv = m.num("totvert", "verts_num") || 0, nc = m.num("totloop", "corners_num") || 0, np = m.num("totpoly", "faces_num") || 0;
    if (!nv || !nc || !np) return null;
    // posições: MVert (antigo), camada "position" (3.5–4.5) ou depósito de atributos (5.0+)
    let pos = null;
    const mvert = m.bloco("mvert");
    if (mvert && arq.porNome.get("MVert")) pos = flutuantes(arq, mvert, nv, arq.porNome.get("MVert").tam);
    if (!pos) pos = flutuantes(arq, camada(arq, m, "vdata", [48], "position") || camada(arq, m, "vert_data", [48], "position"), nv);
    if (!pos) { const a = atributo(arq, m, "position"); if (a) pos = flutuantes(arq, a.bloco, nv); }
    if (!pos) { const v = camada(arq, m, "vdata", [0]); if (v && arq.porNome.get("MVert")) pos = flutuantes(arq, v, nv, arq.porNome.get("MVert").tam); }
    // cantos → vértices
    let cv = null;
    const mloop = m.bloco("mloop");
    if (mloop && arq.porNome.get("MLoop")) cv = inteiros(arq, mloop, nc, arq.porNome.get("MLoop").tam, 0, "u32");
    if (!cv) cv = inteiros(arq, camada(arq, m, "ldata", [11], ".corner_vert") || camada(arq, m, "corner_data", [11], ".corner_vert"), nc);
    if (!cv) { const a = atributo(arq, m, ".corner_vert"); if (a) cv = inteiros(arq, a.bloco, nc); }
    if (!cv) { const l = camada(arq, m, "ldata", [26]); if (l && arq.porNome.get("MLoop")) cv = inteiros(arq, l, nc, arq.porNome.get("MLoop").tam, 0, "u32"); }
    // polígonos: onde cada um começa nos cantos
    let ini = null, tamPoli = null, matPoli = null;
    const mpoly = m.bloco("mpoly") || (arq.porNome.get("MPoly") ? camada(arq, m, "pdata", [25]) : null);
    const ePoly = arq.porNome.get("MPoly");
    if (mpoly && ePoly && ePoly.campos.get("loopstart")) {
      const c = ePoly.campos;
      ini = inteiros(arq, mpoly, np, ePoly.tam, c.get("loopstart").desl);
      tamPoli = inteiros(arq, mpoly, np, ePoly.tam, c.get("totloop").desl);
      if (c.get("mat_nr")) matPoli = inteiros(arq, mpoly, np, ePoly.tam, c.get("mat_nr").desl, "i16");
    }
    if (!ini) {
      const desl = inteiros(arq, m.bloco("poly_offset_indices", "face_offset_indices"), np + 1);
      if (desl) { ini = desl.subarray(0, np); tamPoli = new Int32Array(np); for (let i = 0; i < np; i++) tamPoli[i] = desl[i + 1] - desl[i]; }
    }
    if (!pos || !cv || !ini) return null;
    if (!matPoli) {
      matPoli = inteiros(arq, camada(arq, m, "pdata", [11], "material_index") || camada(arq, m, "face_data", [11], "material_index"), np);
      if (!matPoli) { const a = atributo(arq, m, "material_index"); if (a) matPoli = a.unico ? new Int32Array(np).fill(arq.ler.i32(a.bloco.inicio)) : inteiros(arq, a.bloco, np); }
    }
    // UV: MLoopUV (antigo), camada de 2 números (3.5–4.5) ou o primeiro atributo de 2 números por canto (5.0+)
    let uv = null;
    const eUV = arq.porNome.get("MLoopUV");
    const uvAntigo = m.bloco("mloopuv") || camada(arq, m, "ldata", [16]);
    if (uvAntigo && eUV) uv = flutuantes(arq, uvAntigo, nc, eUV.tam, 0, 2);
    if (!uv) uv = flutuantes(arq, camada(arq, m, "ldata", [49]) || camada(arq, m, "corner_data", [49]), nc, 0, 0, 2);
    if (!uv) { const a = atributo(arq, m, null, (at, nome) => at.num("domain") === 3 && !nome.startsWith(".") && at.bloco("data") && at.num("storage_type") === 0 && (() => { const g = at.alvo("data", "AttributeArray"), d = g && g.bloco("data"); return d && d.tam === nc * 8; })()); if (a) uv = flutuantes(arq, a.bloco, nc, 0, 0, 2); }
    // triângulos, separados por material
    const porMaterial = new Map();
    for (let f = 0; f < np; f++) {
      const n = tamPoli[f], i0 = ini[f];
      if (n < 3 || i0 < 0 || i0 + n > nc) continue;
      const cantos = [];
      for (let k = 0; k < n; k++) { const v = cv[i0 + k]; if (v >= 0 && v < nv) cantos.push({ v, c: i0 + k }); }
      const mat = matPoli ? Math.max(0, matPoli[f]) : 0;
      if (!porMaterial.has(mat)) porMaterial.set(mat, []);
      triangular(pos, cantos, porMaterial.get(mat));
    }
    const total = [...porMaterial.values()].reduce((s, l) => s + l.length, 0);
    if (!total) return null;
    const posicoes = new Float32Array(total * 3), uvs = uv ? new Float32Array(total * 2) : null, grupos = [];
    let i = 0;
    for (const [material, cantos] of [...porMaterial].sort((a, b) => a[0] - b[0])) {
      grupos.push({ material, inicio: i, quantidade: cantos.length });
      for (const c of cantos) {
        posicoes[i * 3] = pos[c.v * 3]; posicoes[i * 3 + 1] = pos[c.v * 3 + 1]; posicoes[i * 3 + 2] = pos[c.v * 3 + 2];
        if (uvs) { uvs[i * 2] = uv[c.c * 2]; uvs[i * 2 + 1] = uv[c.c * 2 + 1]; }
        i++;
      }
    }
    return { posicoes, uvs, grupos, triangulos: total / 3 };
  }

  // ── materiais e imagens ─────────────────────────────────────────────
  function lerMaterial(arq, m, imagens) {
    const r = { nome: nomeDoId(m), cor: [m.num("r") ?? 0.8, m.num("g") ?? 0.8, m.num("b") ?? 0.8, m.num("a", "alpha") ?? 1], rugosidade: m.num("roughness") ?? 0.6, metalico: m.num("metallic") ?? 0, imagem: null };
    // o Principled BSDF da árvore de nós: cor (ou a imagem ligada nela), rugosidade e metal
    const arvore = m.alvo("nodetree");
    if (!arvore) return r;
    let principal = null;
    const porNo = new Map();
    for (const no of listaLigada(arq, arvore, "nodes", "bNode")) {
      porNo.set(no.inicio, no);
      if (no.texto("idname") === "ShaderNodeBsdfPrincipled" && !principal) principal = no;
    }
    if (!principal) return r;
    const entradas = new Map();
    for (const s of listaLigada(arq, principal, "inputs", "bNodeSocket")) entradas.set(s.texto("identifier") || s.texto("name"), s);
    const valor = (nome, estrutura, campo) => { const s = entradas.get(nome), v = s && s.alvo("default_value", estrutura); return v ? (campo === "value" && v.campo("value").quantos > 1 ? v.vetor("value") : v.num("value")) : undefined; };
    const cor = valor("Base Color", "bNodeSocketValueRGBA", "value");
    if (Array.isArray(cor)) r.cor = cor;
    const rug = valor("Roughness", "bNodeSocketValueFloat"), met = valor("Metallic", "bNodeSocketValueFloat"), alfa = valor("Alpha", "bNodeSocketValueFloat");
    if (rug !== undefined) r.rugosidade = rug;
    if (met !== undefined) r.metalico = met;
    if (alfa !== undefined) r.cor[3] = alfa;
    // uma textura de imagem ligada na cor
    const alvoCor = entradas.get("Base Color");
    for (const lig of listaLigada(arq, arvore, "links", "bNodeLink")) {
      const para = lig.bloco("tosock"), de = lig.bloco("fromnode");
      if (!alvoCor || !para || !de || para.inicio !== alvoCor.inicio) continue;
      const no = porNo.get(de.inicio);
      if (!no || no.texto("idname") !== "ShaderNodeTexImage") continue;
      const img = no.bloco("id");
      if (img && imagens.has(img.inicio)) { r.imagem = imagens.get(img.inicio); r.cor = [1, 1, 1, r.cor[3]]; }
    }
    return r;
  }
  function lerImagem(arq, im) {
    const r = { nome: nomeDoId(im), caminho: im.texto("filepath", "name"), dados: null };
    const pegar = (pf) => { const d = pf && pf.bloco("data"), n = pf ? pf.num("size") : 0; if (d && n > 0 && n <= d.tam) r.dados = arq.dados.slice(d.inicio, d.inicio + n); };
    pegar(im.alvo("packedfile", "PackedFile"));
    if (!r.dados) for (const ipf of listaLigada(arq, im, "packedfiles", "ImagePackedFile")) { pegar(ipf.alvo("packedfile", "PackedFile")); if (r.dados) break; }
    return r;
  }

  // ── objetos ─────────────────────────────────────────────────────────
  const multiplicar = (a, b) => { // matrizes 4×4 em colunas (como o Blender e o OpenGL guardam)
    const r = new Array(16);
    for (let c = 0; c < 4; c++) for (let l = 0; l < 4; l++) r[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1] + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3];
    return r;
  };
  function matrizLocal(o) {
    const loc = o.vetor("loc") || [0, 0, 0], esc = o.vetor("scale", "size") || [1, 1, 1], modo = o.num("rotmode") ?? 1;
    let R; // 3×3 em linhas
    if (modo === 0) { // quatérnio (w, x, y, z)
      const [w, x, y, z] = o.vetor("quat") || [1, 0, 0, 0], n = Math.hypot(w, x, y, z) || 1, a = w / n, b = x / n, c = y / n, d = z / n;
      R = [1 - 2 * (c * c + d * d), 2 * (b * c - a * d), 2 * (b * d + a * c), 2 * (b * c + a * d), 1 - 2 * (b * b + d * d), 2 * (c * d - a * b), 2 * (b * d - a * c), 2 * (c * d + a * b), 1 - 2 * (b * b + c * c)];
    } else { // ângulos de Euler, na ordem do modo (1 = XYZ ... 6 = ZYX): a primeira letra gira primeiro
      const [ax, ay, az] = o.vetor("rot") || [0, 0, 0];
      const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)], ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)], rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
      const m3 = (p, q) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j]; return r; };
      const eixos = { X: rx(ax), Y: ry(ay), Z: rz(az) }, ordem = ["XYZ", "XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"][modo > 0 && modo < 7 ? modo : 1];
      R = m3(eixos[ordem[2]], m3(eixos[ordem[1]], eixos[ordem[0]]));
    }
    return [R[0] * esc[0], R[3] * esc[0], R[6] * esc[0], 0, R[1] * esc[1], R[4] * esc[1], R[7] * esc[1], 0, R[2] * esc[2], R[5] * esc[2], R[8] * esc[2], 0, loc[0], loc[1], loc[2], 1];
  }

  /**
   * Lê um .blend já descompactado (Uint8Array). Devolve
   * {versao, objetos: [{nome, matriz (4×4 em colunas, eixos do Blender: Z para cima), malha, materiais: [índices]}],
   *  malhas: [{nome, posicoes, uvs, grupos: [{material, inicio, quantidade}], triangulos}], materiais, imagens}.
   */
  function ler(dados) {
    const arq = abrir(dados instanceof Uint8Array ? dados : new Uint8Array(dados));
    const doCodigo = (c) => arq.blocos.filter((b) => b.codigo === c);
    const imagens = new Map(), listaImagens = [];
    for (const b of doCodigo("IM")) { const r = registroDo(arq, b); if (r) { imagens.set(b.inicio, listaImagens.length); listaImagens.push(lerImagem(arq, r)); } }
    const materiais = new Map(), listaMateriais = [];
    for (const b of doCodigo("MA")) { const r = registroDo(arq, b); if (r) { materiais.set(b.inicio, listaMateriais.length); listaMateriais.push(lerMaterial(arq, r, imagens)); } }
    const malhas = new Map(), listaMalhas = [];
    const objetos = [], porBloco = new Map();
    const blocosOB = doCodigo("OB");
    for (const b of blocosOB) porBloco.set(b.inicio, registroDo(arq, b));
    const mundo = new Map();
    const matrizDoMundo = (b, fundo = 0) => {
      if (mundo.has(b.inicio)) return mundo.get(b.inicio);
      const o = porBloco.get(b.inicio);
      let m = o.vetor("obmat", "object_to_world"); // até o 4.1 o arquivo guarda a matriz pronta (já com as restrições)
      if (!m || m.length !== 16 || m.every((v) => v === 0)) {
        m = matrizLocal(o);
        const pai = o.bloco("parent");
        if (pai && porBloco.has(pai.inicio) && fundo < 64) m = multiplicar(multiplicar(matrizDoMundo(pai, fundo + 1), o.vetor("parentinv") || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), m);
      }
      mundo.set(b.inicio, m);
      return m;
    };
    for (const b of blocosOB) {
      const o = porBloco.get(b.inicio);
      if (!o || o.num("type") !== 1) continue; // 1 = malha
      if ((o.num("visibility_flag", "restrictflag") || 0) & 4) continue; // escondido na imagem final
      const dadosDaMalha = o.bloco("data");
      if (!dadosDaMalha || dadosDaMalha.codigo !== "ME") continue;
      if (!malhas.has(dadosDaMalha.inicio)) {
        const m = registroDo(arq, dadosDaMalha), lida = m && lerMalha(arq, m);
        if (lida) {
          lida.nome = nomeDoId(m);
          // os materiais da malha (o objeto pode trocar, mas quase nunca troca)
          const nMat = m.num("totcol") || 0, bm = m.bloco("mat");
          lida.materiais = [];
          for (let i = 0; i < nMat && bm; i++) { const alvo = arq.resolver(bm.escopo, arq.ler.ptr(bm.inicio + i * arq.ponteiro)); lida.materiais.push(alvo && materiais.has(alvo.inicio) ? materiais.get(alvo.inicio) : -1); }
          malhas.set(dadosDaMalha.inicio, listaMalhas.length);
          listaMalhas.push(lida);
        } else malhas.set(dadosDaMalha.inicio, -1);
      }
      const malha = malhas.get(dadosDaMalha.inicio);
      if (malha < 0) continue;
      objetos.push({ nome: nomeDoId(o), matriz: matrizDoMundo(b), malha });
    }
    return { versao: arq.versao, objetos, malhas: listaMalhas, materiais: listaMateriais, imagens: listaImagens };
  }

  /** gzip (1f 8b), zstd (28 b5 2f fd) ou nada. */
  const compactacao = (d) => (d[0] === 0x1f && d[1] === 0x8b ? "gzip" : d[0] === 0x28 && d[1] === 0xb5 && d[2] === 0x2f && d[3] === 0xfd ? "zstd" : "");

  const api = { ler, abrir, compactacao };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (raiz.C = raiz.C || {}).blend = api;
})(typeof window !== "undefined" ? window : globalThis);
