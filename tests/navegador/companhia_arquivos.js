// Arquivos de teste da Companhia montados na hora (sem baixar nada), usados pelos testar_companhia_*.js: um .glb de
// caixas (cenário), um boneco VRM 0.x só de ossos, um .bvh, um .unitypackage, imagens (PNG, TGA, PSD), um ZIP e um
// avatar do Unity (.fbx com esqueleto, formas do rosto e materiais .mat).
const zlib = require("zlib");

/** Um .glb a partir do JSON do glTF e (se houver) do bloco binário. */
function glb(json, bin) {
  const alinhar = (b, enche) => { const sobra = (4 - (b.length % 4)) % 4; return sobra ? Buffer.concat([b, Buffer.alloc(sobra, enche)]) : b; };
  const j = alinhar(Buffer.from(JSON.stringify(json)), 0x20), b = bin ? alinhar(bin, 0) : null;
  const cab = Buffer.alloc(12);
  cab.writeUInt32LE(0x46546c67, 0); cab.writeUInt32LE(2, 4); cab.writeUInt32LE(12 + 8 + j.length + (b ? 8 + b.length : 0), 8);
  const bloco = (dados, tipo) => { const c = Buffer.alloc(8); c.writeUInt32LE(dados.length, 0); c.writeUInt32LE(tipo, 4); return Buffer.concat([c, dados]); };
  return Buffer.concat([cab, bloco(j, 0x4e4f534a), ...(b ? [bloco(b, 0x004e4942)] : [])]);
}
/** Malha de caixas: [[xmin, ymin, zmin, xmax, ymax, zmax], ...] → {posicoes: Float32Array, indices: Uint16Array, min, max}. */
function caixas(lista) {
  const pos = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) pos.push(x, y, z);
    for (const [a, c, d] of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]) idx.push(b + a, b + c, b + d);
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  return { posicoes: new Float32Array(pos), indices: new Uint16Array(idx), min, max };
}
function gltfDeMalha(m, extras = {}) {
  const p = Buffer.from(m.posicoes.buffer), i = Buffer.from(m.indices.buffer), sobra = (4 - (i.length % 4)) % 4;
  const bin = Buffer.concat([i, Buffer.alloc(sobra), p]);
  return { bin, json: {
    asset: { version: "2.0", generator: "teste do LNUX-APPs" }, buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: i.length, target: 34963 }, { buffer: 0, byteOffset: i.length + sobra, byteLength: p.length, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5123, count: m.indices.length, type: "SCALAR" }, { bufferView: 1, componentType: 5126, count: m.posicoes.length / 3, type: "VEC3", min: m.min, max: m.max }],
    materials: [{ name: "Cinza", pbrMetallicRoughness: { baseColorFactor: [0.6, 0.65, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true }],
    meshes: [{ name: "Malha", primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }], ...extras } };
}
/** Cenário: um piso com o topo em y = 1, uma parede em z = 3 (à frente de quem nasce no meio) e um degrau baixo. */
function mapaDeTeste() {
  const { json, bin } = gltfDeMalha(caixas([[-12, 0.5, -12, 12, 1, 12], [-4, 1, 3, 4, 4, 3.5], [-12, 1, -6, -6, 1.12, -4]]),
    { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Mapa", mesh: 0 }] });
  return glb(json, bin);
}
/** Cenário com animação: o piso (parado) e uma pá ("Pa") que gira em volta do eixo Y, uma volta a cada 4 s. */
function mapaAnimado() {
  const { json, bin } = gltfDeMalha(caixas([[-12, 0.5, -12, 12, 1, 12]]), { scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "Chao", mesh: 0 }, { name: "Pa", mesh: 0, translation: [0, 3, -6], scale: [0.1, 2, 0.02] }] });
  const tempos = Buffer.from(new Float32Array([0, 1, 2, 3, 4]).buffer);
  const s = Math.SQRT1_2, giros = Buffer.from(new Float32Array([0, 0, 0, 1, 0, s, 0, s, 0, 1, 0, 0, 0, s, 0, -s, 0, 0, 0, -1]).buffer);
  const inicio = bin.length;
  const tudo = Buffer.concat([bin, tempos, giros]);
  json.buffers[0].byteLength = tudo.length;
  json.bufferViews.push({ buffer: 0, byteOffset: inicio, byteLength: tempos.length }, { buffer: 0, byteOffset: inicio + tempos.length, byteLength: giros.length });
  const vt = json.bufferViews.length - 2;
  json.accessors.push({ bufferView: vt, componentType: 5126, count: 5, type: "SCALAR", min: [0], max: [4] }, { bufferView: vt + 1, componentType: 5126, count: 5, type: "VEC4" });
  const at = json.accessors.length - 2;
  json.animations = [{ name: "Girar", channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }], samplers: [{ input: at, output: at + 1, interpolation: "LINEAR" }] }];
  return glb(json, tudo);
}
/**
 * Cenário com o material "specular/glossiness" (KHR_materials_pbrSpecularGlossiness), como nas exportações antigas do
 * Sketchfab: o piso com a textura de cor verde (40, 160, 60) e a de brilho com alfa 51 (brilho 0,2 → rugosidade 0,8).
 */
function mapaEspecular() {
  const E = "KHR_materials_pbrSpecularGlossiness", m = caixas([[-12, 0.5, -12, 12, 1, 12]]);
  const { json, bin } = gltfDeMalha(m, { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Floresta", mesh: 0 }] });
  const uv = new Float32Array((m.posicoes.length / 3) * 2);
  for (let i = 0; i < m.posicoes.length / 3; i++) { uv[i * 2] = (m.posicoes[i * 3] + 12) / 24; uv[i * 2 + 1] = (m.posicoes[i * 3 + 2] + 12) / 24; }
  const alinhar = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const partes = [alinhar(bin), Buffer.from(uv.buffer), alinhar(png(8, 8, () => [40, 160, 60])), alinhar(png(8, 8, () => [5, 5, 5, 51], true))];
  let off = 0;
  const vistas = partes.map((p) => { const v = { buffer: 0, byteOffset: off, byteLength: p.length }; off += p.length; return v; });
  const tudo = Buffer.concat(partes);
  json.buffers[0].byteLength = tudo.length;
  const n = json.bufferViews.length;
  json.bufferViews.push(vistas[1], vistas[2], vistas[3]);
  json.accessors.push({ bufferView: n, componentType: 5126, count: uv.length / 2, type: "VEC2" });
  json.meshes[0].primitives[0].attributes.TEXCOORD_0 = json.accessors.length - 1;
  json.images = [{ bufferView: n + 1, mimeType: "image/png" }, { bufferView: n + 2, mimeType: "image/png" }];
  json.textures = [{ source: 0 }, { source: 1 }];
  json.materials = [{ name: "folhas", extensions: { [E]: { diffuseFactor: [1, 1, 1, 1], diffuseTexture: { index: 0 }, specularFactor: [0.02, 0.02, 0.02], glossinessFactor: 1, specularGlossinessTexture: { index: 1 } } } }];
  json.extensionsUsed = [E];
  json.extensionsRequired = [E];
  return glb(json, tudo);
}
/** Cenário fechado: uma casa de 12 × 12 m com piso (topo em y = 0,2), quatro paredes sem porta e telhado (topo em y = 3,4). */
function casaDeTeste() {
  const { json, bin } = gltfDeMalha(caixas([[-6, 0, -6, 6, 0.2, 6], [-6, 0.2, -6, 6, 3.2, -5.8], [-6, 0.2, 5.8, 6, 3.2, 6], [-6, 0.2, -5.8, -5.8, 3.2, 5.8], [5.8, 0.2, -5.8, 6, 3.2, 5.8],
    [-6.2, 3.2, -6.2, 6.2, 3.4, 6.2]]), { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Casa", mesh: 0 }] });
  return glb(json, bin);
}
/**
 * Cenário fechado com luzes: a casa (sem janela) com uma lâmpada que brilha no teto (material emissivo, perto de
 * x = −3, com uma mesa embaixo dela, de 1,2 m e tampo em y = 1), uma luz pontual que vem no próprio arquivo (KHR_lights_punctual, perto de x = 3) e uma vela (uma peça
 * chamada "Vela_01", sem brilho, achada pelo nome).
 */
function casaComLuzes() {
  const malhas = [caixas([[-6, 0, -6, 6, 0.2, 6], [-6, 0.2, -6, 6, 3.2, -5.8], [-6, 0.2, 5.8, 6, 3.2, 6], [-6, 0.2, -5.8, -5.8, 3.2, 5.8], [5.8, 0.2, -5.8, 6, 3.2, 5.8], [-6.2, 3.2, -6.2, 6.2, 3.4, 6.2],
    [-3.6, 0.9, -0.6, -2.4, 1.0, 0.6], [-3.55, 0.2, -0.55, -3.45, 0.9, -0.45]]),
    caixas([[-3.2, 2.95, -0.2, -2.8, 3.15, 0.2]]), caixas([[1, 0.2, -4, 1.1, 0.45, -3.9]])];
  const bins = [], views = [], acessores = [];
  let off = 0;
  for (const m of malhas) {
    const i = Buffer.from(m.indices.buffer), p = Buffer.from(m.posicoes.buffer), sobra = (4 - (i.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: i.length, target: 34963 });
    acessores.push({ bufferView: views.length - 1, componentType: 5123, count: m.indices.length, type: "SCALAR" });
    bins.push(i, Buffer.alloc(sobra));
    off += i.length + sobra;
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length, target: 34962 });
    acessores.push({ bufferView: views.length - 1, componentType: 5126, count: m.posicoes.length / 3, type: "VEC3", min: m.min, max: m.max });
    bins.push(p);
    off += p.length;
  }
  const bin = Buffer.concat(bins);
  const json = {
    asset: { version: "2.0", generator: "teste do LNUX-APPs" }, extensionsUsed: ["KHR_lights_punctual", "KHR_materials_emissive_strength"],
    extensions: { KHR_lights_punctual: { lights: [{ type: "point", color: [0.6, 0.8, 1], intensity: 40, name: "Luz do arquivo" }] } },
    buffers: [{ byteLength: bin.length }], bufferViews: views, accessors: acessores,
    materials: [
      { name: "Parede", pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: "Lampada", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0 }, emissiveFactor: [1, 0.85, 0.5], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } } },
      { name: "Cera", pbrMetallicRoughness: { baseColorFactor: [0.9, 0.85, 0.7, 1], metallicFactor: 0 } }],
    meshes: [0, 1, 2].map((k) => ({ name: ["Casa", "Lampada do teto", "Vela"][k], primitives: [{ attributes: { POSITION: 2 * k + 1 }, indices: 2 * k, material: k }] })),
    nodes: [{ name: "Casa", mesh: 0 }, { name: "Lampada do teto", mesh: 1 }, { name: "Vela_01", mesh: 2 }, { name: "Luz", translation: [3, 2.6, 0], extensions: { KHR_lights_punctual: { light: 0 } } }],
    scene: 0, scenes: [{ nodes: [0, 1, 2, 3] }],
  };
  return glb(json, bin);
}
/**
 * Boneco VRM 0.x: só ossos (com uma caixinha em cada um, para aparecer na tela). Como nos VRM 0.x de verdade, olha
 * para −Z e o lado esquerdo fica em −X.
 */
function bonecoVRM0({ virado = false } = {}) {
  // virado: o espelho (declarado 0.x, mas olhando para +Z, com o lado esquerdo em +X), como alguns arquivos por aí
  const ossos = [["hips", null, [0, 0.9, 0]], ["spine", "hips", [0, 1.0, 0]], ["chest", "spine", [0, 1.15, 0]], ["neck", "chest", [0, 1.35, 0]], ["head", "neck", [0, 1.45, 0]]];
  for (const [l, s] of [["left", virado ? 1 : -1], ["right", virado ? -1 : 1]]) {
    ossos.push([l + "Shoulder", "chest", [0.05 * s, 1.3, 0]], [l + "UpperArm", l + "Shoulder", [0.15 * s, 1.3, 0]], [l + "LowerArm", l + "UpperArm", [0.4 * s, 1.3, 0]], [l + "Hand", l + "LowerArm", [0.65 * s, 1.3, 0]],
      [l + "IndexProximal", l + "Hand", [0.73 * s, 1.3, -0.02]], [l + "IndexIntermediate", l + "IndexProximal", [0.77 * s, 1.3, -0.02]], [l + "IndexDistal", l + "IndexIntermediate", [0.8 * s, 1.3, -0.02]],
      [l + "MiddleProximal", l + "Hand", [0.735 * s, 1.3, 0]], [l + "MiddleIntermediate", l + "MiddleProximal", [0.775 * s, 1.3, 0]], [l + "MiddleDistal", l + "MiddleIntermediate", [0.805 * s, 1.3, 0]],
      [l + "UpperLeg", "hips", [0.09 * s, 0.85, 0]], [l + "LowerLeg", l + "UpperLeg", [0.09 * s, 0.47, 0]], [l + "Foot", l + "LowerLeg", [0.09 * s, 0.08, 0]], [l + "Toes", l + "Foot", [0.09 * s, 0.02, virado ? 0.12 : -0.12]]);
  }
  const { json, bin } = gltfDeMalha(caixas([[-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]]));
  const lugar = Object.fromEntries(ossos.map(([n, , p]) => [n, p]));
  const nodes = ossos.map(([n, pai, p]) => ({ name: "J_" + n, translation: pai ? p.map((v, k) => +(v - lugar[pai][k]).toFixed(4)) : p, children: [] }));
  ossos.forEach(([n, pai], i) => { if (pai) nodes[ossos.findIndex((o) => o[0] === pai)].children.push(i); });
  // uma caixinha em cada osso (a cabeça e o tronco maiores)
  ossos.forEach(([n], i) => { nodes.push({ name: "C_" + n, mesh: 0, scale: n === "head" ? [0.18, 0.2, 0.18] : /chest|spine|hips/.test(n) ? [0.26, 0.1, 0.14] : [0.05, 0.05, 0.05] }); nodes[i].children.push(nodes.length - 1); });
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  Object.assign(json, { scene: 0, scenes: [{ nodes: [0] }], nodes, extensionsUsed: ["VRM"], extensions: { VRM: {
    exporterVersion: "teste do LNUX-APPs", specVersion: "0.0",
    meta: { title: "Boneco de teste", author: "LNUX-APPs", version: "1", allowedUserName: "Everyone", violentUssageName: "Allow", sexualUssageName: "Allow", commercialUssageName: "Allow", licenseName: "CC0" },
    humanoid: { humanBones: ossos.map(([n], i) => ({ bone: n, node: i, useDefaultValues: true })) },
    blendShapeMaster: { blendShapeGroups: [] }, secondaryAnimation: { boneGroups: [], colliderGroups: [] }, materialProperties: [] } } });
  return glb(json, bin);
}
/** Um .bvh curto: de pé, o braço esquerdo sobe 80° e o corpo anda 20 unidades para a esquerda (30 quadros por segundo). */
function bvhDeTeste() {
  const junta = (nome, desl, filhos, raiz) => `${raiz ? "ROOT" : "JOINT"} ${nome}\n{\nOFFSET ${desl.join(" ")}\nCHANNELS ${raiz ? "6 Xposition Yposition Zposition" : "3"} Zrotation Xrotation Yrotation\n${filhos}}\n`;
  const fim = (desl) => `End Site\n{\nOFFSET ${desl.join(" ")}\n}\n`;
  const braco = (l, s) => junta(l + "Shoulder", [4 * s, 30, 0], junta(l + "Arm", [12 * s, 0, 0], junta(l + "ForeArm", [25 * s, 0, 0], junta(l + "Hand", [25 * s, 0, 0], fim([8 * s, 0, 0])))));
  const perna = (l, s) => junta(l + "UpLeg", [9 * s, -5, 0], junta(l + "Leg", [0, -38, 0], junta(l + "Foot", [0, -39, 0], fim([0, -6, 12]))));
  const arvore = junta("Hips", [0, 0, 0], junta("Spine", [0, 10, 0], junta("Neck", [0, 35, 0], junta("Head", [0, 10, 0], fim([0, 15, 0]))) + braco("Left", 1) + braco("Right", -1)) + perna("Left", 1) + perna("Right", -1), true);
  // ordem das juntas no arquivo: Hips, Spine, Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand, Right..., LeftUpLeg...
  const N = 31, linhas = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), canais = [+(20 * t).toFixed(3), 88, 0, 0, 0, 0];
    for (let j = 1; j < 18; j++) canais.push(j === 5 ? +(80 * t).toFixed(3) : 0, 0, 0); // junta 5 = LeftArm: gira em Z (sobe)
    linhas.push(canais.join(" "));
  }
  return `HIERARCHY\n${arvore}MOTION\nFrames: ${N}\nFrame Time: ${(1 / 30).toFixed(6)}\n${linhas.join("\n")}\n`;
}
/**
 * Um .unitypackage (tar.gz do Unity): para cada arquivo, <guid>/pathname, <guid>/asset e <guid>/asset.meta.
 * unityPackage(caminho, dados) monta um pacote de um arquivo só; unityPackage([{caminho, dados, guid, meta}]) monta vários.
 */
function unityPackage(caminho, dados) {
  const arquivos = Array.isArray(caminho) ? caminho : [{ caminho, dados, guid: "0123456789abcdef0123456789abcdef" }];
  const entrada = (nome, corpo) => {
    const cab = Buffer.alloc(512);
    cab.write(nome, 0); cab.write("0000644\0", 100); cab.write("0000000\0", 108); cab.write("0000000\0", 116);
    cab.write(corpo.length.toString(8).padStart(11, "0") + "\0", 124); cab.write("00000000000\0", 136); cab.write("        ", 148); cab.write("0", 156); cab.write("ustar\0" + "00", 257);
    let soma = 0;
    for (const b of cab) soma += b;
    cab.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
    return Buffer.concat([cab, corpo, Buffer.alloc((512 - (corpo.length % 512)) % 512)]);
  };
  const partes = [];
  arquivos.forEach((a, i) => {
    const guid = a.guid || (i + 1).toString(16).padStart(32, "a");
    partes.push(entrada(`${guid}/pathname`, Buffer.from(a.caminho)), entrada(`${guid}/asset`, Buffer.from(a.dados)), entrada(`${guid}/asset.meta`, Buffer.from(a.meta || `fileFormatVersion: 2\nguid: ${guid}\n`)));
  });
  return zlib.gzipSync(Buffer.concat([...partes, Buffer.alloc(1024)]));
}

// ── Avatar do Unity (para o conversor de avatares) ──────────────────────

/** PNG simples: pixel(x, y) → [r, g, b]. */
function png(w, h, pixel, alfa = false) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, c]); };
  const ihdr = Buffer.alloc(13), n = alfa ? 4 : 3; // alfa: pixel(x, y) → [r, g, b, a]
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alfa ? 6 : 2;
  const linhas = Buffer.alloc((w * n + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) linhas.set(pixel(x, y), y * (w * n + 1) + 1 + x * n);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(linhas)), bloco("IEND", Buffer.alloc(0))]);
}
/** TGA de 32 bits (BGRA), começando por baixo como é o comum; rle = compactado. pixel(x, y) → [r, g, b, a], com y = 0 em cima. */
function tga(w, h, pixel, rle = false) {
  const cab = Buffer.alloc(18);
  cab[2] = rle ? 10 : 2; cab.writeUInt16LE(w, 12); cab.writeUInt16LE(h, 14); cab[16] = 32; cab[17] = 8;
  const corpo = [];
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w;) {
      const [r, g, b, a] = pixel(x, y);
      if (!rle) { corpo.push(b, g, r, a); x++; continue; }
      let n = 1;
      while (x + n < w && n < 128 && pixel(x + n, y).join() === [r, g, b, a].join()) n++;
      corpo.push(0x80 | (n - 1), b, g, r, a);
      x += n;
    }
  }
  return Buffer.concat([cab, Buffer.from(corpo)]);
}
/** PSD (Photoshop) de 8 bits RGB, só com a imagem juntada (sem camadas); rle = compactado (PackBits). pixel(x, y) → [r, g, b]. */
function psd(w, h, pixel, rle = false) {
  const cab = Buffer.alloc(26);
  cab.write("8BPS", 0); cab.writeUInt16BE(1, 4); cab.writeUInt16BE(3, 12); cab.writeUInt32BE(h, 14); cab.writeUInt32BE(w, 18); cab.writeUInt16BE(8, 22); cab.writeUInt16BE(3, 24);
  const secoes = Buffer.alloc(12), modo = Buffer.alloc(2);
  modo.writeUInt16BE(rle ? 1 : 0);
  const canais = [0, 1, 2].map((c) => { const d = Buffer.alloc(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = pixel(x, y)[c]; return d; });
  if (!rle) return Buffer.concat([cab, secoes, modo, ...canais]);
  const tamanhos = Buffer.alloc(3 * h * 2), linhas = [];
  canais.forEach((d, c) => {
    for (let y = 0; y < h; y++) {
      const saida = [];
      for (let x = 0; x < w;) {
        let n = 1;
        while (x + n < w && n < 128 && d[y * w + x + n] === d[y * w + x]) n++;
        if (n > 1) { saida.push(257 - n, d[y * w + x]); x += n; } else { saida.push(0, d[y * w + x]); x++; }
      }
      tamanhos.writeUInt16BE(saida.length, (c * h + y) * 2);
      linhas.push(Buffer.from(saida));
    }
  });
  return Buffer.concat([cab, secoes, modo, tamanhos, ...linhas]);
}
/**
 * Um avatar em .fbx (texto, FBX 7.4), no jeito dos avatares do VRChat feitos no Blender:
 *   - medidas em centímetros, uma "Armature" com escala 100 e os ossos com nomes de lá ("Left arm", "Left elbow",
 *     "Left wrist", "Left leg", "Left knee", "Left ankle"...); olhando para −Z (de costas para a câmera da Companhia)
 *     e com os braços em A (45° para baixo);
 *   - duas malhas com pele que dividem o osso da cabeça: Body (materiais Corpo e Roupa; a textura da Roupa é pedida
 *     pelo próprio .fbx) e Hair (material Cabelo), com uma corrente de ossos de cabelo (Hair_1, Hair_2, Hair_3);
 *   - formas do rosto na cabeça: vrc.v_aa, vrc.blink, Joy, 照れ e uma que não serve para nada (sobrando).
 * texturaDaRoupa: o nome do arquivo que o .fbx pede para o material Roupa.
 * Devolve {fbx: Buffer, ossos: [nome], humano: [[osso, nome no Unity]]}.
 */
function avatarFBX({ texturaDaRoupa = "roupa.png" } = {}) {
  const c45 = Math.SQRT1_2;
  const ossos = [["Hips", null, [0, 0.92, 0]], ["Spine", "Hips", [0, 1.0, 0]], ["Chest", "Spine", [0, 1.15, 0]], ["Neck", "Chest", [0, 1.38, 0]], ["Head", "Neck", [0, 1.46, 0]],
    ["LeftEye", "Head", [0.035, 1.56, 0.1]], ["RightEye", "Head", [-0.035, 1.56, 0.1]], ["Hair_1", "Head", [0, 1.66, -0.1]], ["Hair_2", "Hair_1", [0, 1.5, -0.13]], ["Hair_3", "Hair_2", [0, 1.34, -0.14]]];
  const humano = [["Hips", "Hips"], ["Spine", "Spine"], ["Chest", "Chest"], ["Neck", "Neck"], ["Head", "Head"], ["LeftEye", "LeftEye"], ["RightEye", "RightEye"]];
  // caixas: [osso, material, centro em relação ao osso, tamanho] (metros, no espaço da personagem: olhando para +Z, esquerda em +X)
  const corpo = [["Hips", 1, [0, 0.02, 0], [0.3, 0.2, 0.19]], ["Spine", 1, [0, 0.08, 0], [0.3, 0.16, 0.19]], ["Chest", 1, [0, 0.11, 0], [0.36, 0.24, 0.21]], ["Neck", 0, [0, 0.03, 0], [0.09, 0.1, 0.09]],
    ["Head", 0, [0, 0.1, 0.01], [0.21, 0.24, 0.22]]];
  const cabelo = [["Head", 0, [0, 0.22, -0.01], [0.24, 0.06, 0.25]], ["Hair_1", 0, [0, -0.08, 0], [0.18, 0.16, 0.05]], ["Hair_2", 0, [0, -0.08, 0], [0.16, 0.16, 0.04]]];
  for (const [L, s] of [["Left", 1], ["Right", -1]]) {
    const ombro = [0.17 * s, 1.34, 0], cotovelo = [ombro[0] + 0.25 * c45 * s, 1.34 - 0.25 * c45, 0], pulso = [cotovelo[0] + 0.24 * c45 * s, cotovelo[1] - 0.24 * c45, 0];
    ossos.push([L + " shoulder", "Chest", [0.06 * s, 1.34, 0]], [L + " arm", L + " shoulder", ombro], [L + " elbow", L + " arm", cotovelo], [L + " wrist", L + " elbow", pulso],
      [L + " leg", "Hips", [0.09 * s, 0.88, 0]], [L + " knee", L + " leg", [0.09 * s, 0.49, 0]], [L + " ankle", L + " knee", [0.09 * s, 0.09, 0]], [L + " toe", L + " ankle", [0.09 * s, 0.02, 0.12]]);
    humano.push([L + " shoulder", L + "Shoulder"], [L + " arm", L + "UpperArm"], [L + " elbow", L + "LowerArm"], [L + " wrist", L + "Hand"], [L + " leg", L + "UpperLeg"], [L + " knee", L + "LowerLeg"], [L + " ankle", L + "Foot"], [L + " toe", L + "Toes"]);
    corpo.push([L + " arm", 1, [0.09 * s, -0.09, 0], [0.2, 0.2, 0.09]], [L + " elbow", 0, [0.085 * s, -0.085, 0], [0.19, 0.19, 0.075]], [L + " wrist", 0, [0.03 * s, -0.03, 0], [0.08, 0.08, 0.07]],
      [L + " leg", 1, [0, -0.195, 0], [0.125, 0.39, 0.125]], [L + " knee", 1, [0, -0.2, 0], [0.105, 0.4, 0.105]], [L + " ankle", 0, [0, -0.045, 0.06], [0.1, 0.08, 0.24]]);
  }
  const lugar = Object.fromEntries(ossos.map(([n, , p]) => [n, p]));
  const noArquivo = ([x, y, z]) => [-x * 100, y * 100, -z * 100]; // de costas, em centímetros
  const n4 = (v) => +v.toFixed(4);
  const FACES = [[1, 3, 7, 5, [1, 0, 0]], [0, 4, 6, 2, [-1, 0, 0]], [2, 6, 7, 3, [0, 1, 0]], [0, 1, 5, 4, [0, -1, 0]], [4, 5, 7, 6, [0, 0, 1]], [0, 2, 3, 1, [0, 0, -1]]];
  /** As caixas viram uma malha: pontos, polígonos (quadrados), normais, UV, material por polígono e os pontos de cada osso. */
  const malha = (caixas) => {
    const pontos = [], poligonos = [], normais = [], uv = [], uvIndice = [], materiais = [], porOsso = {}, inicio = {};
    for (const [osso, material, centro, tamanho] of caixas) {
      const b = pontos.length / 3;
      if (!(osso in inicio)) inicio[osso] = b;
      for (let i = 0; i < 8; i++) {
        pontos.push(...noArquivo([0, 1, 2].map((k) => lugar[osso][k] + centro[k] + ((i >> k) & 1 ? 0.5 : -0.5) * tamanho[k])).map(n4));
        (porOsso[osso] = porOsso[osso] || []).push(b + i);
      }
      for (const [a, c, d, e, n] of FACES) {
        poligonos.push(b + a, b + c, b + d, -(b + e) - 1);
        for (let k = 0; k < 4; k++) normais.push(-n[0], n[1], -n[2]);
        // a frente da cabeça usa só a metade de cima da textura (V de 0,5 a 1, com o V do Unity: 1 é em cima)
        const frenteDaCabeca = osso === "Head" && n[2] === 1 && material === 0 && caixas === corpo;
        const u0 = uv.length / 2;
        uv.push(0, frenteDaCabeca ? 0.5 : 0, 1, frenteDaCabeca ? 0.5 : 0, 1, 1, 0, 1);
        uvIndice.push(u0, u0 + 1, u0 + 2, u0 + 3);
        materiais.push(material);
      }
    }
    return { pontos, poligonos, normais, uv, uvIndice, materiais, porOsso, inicio };
  };
  const mCorpo = malha(corpo), mCabelo = malha(cabelo);
  // formas do rosto: mexem nos pontos da frente da caixa da cabeça (no arquivo, a frente é −Z)
  const cabeca = mCorpo.inicio.Head, frenteBaixo = [cabeca + 4, cabeca + 5], frenteCima = [cabeca + 6, cabeca + 7];
  const formas = [["vrc.v_aa", frenteBaixo, [0, -3, 0]], ["vrc.blink", frenteCima, [0, -1.5, 0]], ["Joy", frenteBaixo, [0, 1, 0]], ["照れ", [...frenteBaixo, ...frenteCima], [0, 0, -1]], ["sobrando", frenteCima, [0, 2, 0]]];

  const T = (n) => "\t".repeat(n);
  const lista = (nome, valores, n) => `${T(n)}${nome}: *${valores.length} {\n${T(n + 1)}a: ${valores.join(",")}\n${T(n)}}\n`;
  const ID = { armature: 2000, malhaCorpo: 2001, malhaCabelo: 2002, geoCorpo: 1001, geoCabelo: 1002, peleCorpo: 5000, peleCabelo: 5001, formas: 6000 };
  const idDoOsso = Object.fromEntries(ossos.map(([n], i) => [n, 3000 + i]));
  let objetos = "", ligacoes = "";
  const ligar = (de, para, extra) => { ligacoes += `\tC: "${extra ? "OP" : "OO"}",${de},${para}${extra ? `, "${extra}"` : ""}\n`; };
  const geometria = (id, nome, m) => `\tGeometry: ${id}, "Geometry::${nome}", "Mesh" {\n` + lista("Vertices", m.pontos, 2) + lista("PolygonVertexIndex", m.poligonos, 2) + "\t\tGeometryVersion: 124\n" +
    `\t\tLayerElementNormal: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "Direct"\n` + lista("Normals", m.normais, 3) + "\t\t}\n" +
    `\t\tLayerElementUV: 0 {\n\t\t\tVersion: 101\n\t\t\tName: "UVMap"\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "IndexToDirect"\n` + lista("UV", m.uv, 3) + lista("UVIndex", m.uvIndice, 3) + "\t\t}\n" +
    `\t\tLayerElementMaterial: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygon"\n\t\t\tReferenceInformationType: "IndexToDirect"\n` + lista("Materials", m.materiais, 3) + "\t\t}\n\t}\n";
  const modelo = (id, nome, tipo, props) => `\tModel: ${id}, "Model::${nome}", "${tipo}" {\n\t\tVersion: 232\n\t\tProperties70:  {\n${props.map((p) => `\t\t\tP: ${p}\n`).join("")}\t\t}\n\t\tShading: T\n\t\tCulling: "CullingOff"\n\t}\n`;
  const mover = (v) => `"Lcl Translation", "Lcl Translation", "", "A",${v.map(n4).join(",")}`;
  objetos += geometria(ID.geoCorpo, "Body", mCorpo) + geometria(ID.geoCabelo, "Hair", mCabelo);
  objetos += modelo(ID.armature, "Armature", "Null", [`"Lcl Scaling", "Lcl Scaling", "", "A",100,100,100`]) + modelo(ID.malhaCorpo, "Body", "Mesh", [mover([0, 0, 0])]) + modelo(ID.malhaCabelo, "Hair", "Mesh", [mover([0, 0, 0])]);
  ligar(ID.armature, 0); ligar(ID.malhaCorpo, 0); ligar(ID.malhaCabelo, 0); ligar(ID.geoCorpo, ID.malhaCorpo); ligar(ID.geoCabelo, ID.malhaCabelo);
  for (const [nome, pai, p] of ossos) {
    // dentro da Armature (escala 100) os ossos ficam em metros; cada um guarda a distância até o pai
    const q = noArquivo(p), qp = pai ? noArquivo(lugar[pai]) : [0, 0, 0];
    objetos += modelo(idDoOsso[nome], nome, "LimbNode", [mover(q.map((v, k) => (v - qp[k]) / 100))]);
    ligar(idDoOsso[nome], pai ? idDoOsso[pai] : ID.armature);
  }
  const material = (id, nome, cor) => `\tMaterial: ${id}, "Material::${nome}", "" {\n\t\tVersion: 102\n\t\tShadingModel: "phong"\n\t\tMultiLayer: 0\n\t\tProperties70:  {\n\t\t\tP: "DiffuseColor", "Color", "", "A",${cor.join(",")}\n\t\t}\n\t}\n`;
  objetos += material(4001, "Corpo", [0.8, 0.8, 0.8]) + material(4002, "Roupa", [0.8, 0.8, 0.8]) + material(4003, "Cabelo", [0.8, 0.8, 0.8]);
  ligar(4001, ID.malhaCorpo); ligar(4002, ID.malhaCorpo); ligar(4003, ID.malhaCabelo);
  // a textura da Roupa é pedida pelo .fbx, com o caminho do computador de quem fez (só o nome do arquivo serve)
  const t = texturaDaRoupa;
  objetos += `\tTexture: 7001, "Texture::roupa", "" {\n\t\tType: "TextureVideoClip"\n\t\tVersion: 202\n\t\tTextureName: "Texture::roupa"\n\t\tMedia: "Video::roupa"\n\t\tFileName: "C:/Users/alguem/avatar/Textures/${t}"\n\t\tRelativeFilename: "Textures\\${t}"\n\t}\n` +
    `\tVideo: 7002, "Video::roupa", "Clip" {\n\t\tType: "Clip"\n\t\tFileName: "C:/Users/alguem/avatar/Textures/${t}"\n\t\tRelativeFilename: "Textures\\${t}"\n\t}\n`;
  ligar(7001, 4002, "DiffuseColor"); ligar(7002, 7001);
  // pele: cada ponto preso em um osso só
  const pele = (idPele, idGeo, m, base) => {
    objetos += `\tDeformer: ${idPele}, "Deformer::", "Skin" {\n\t\tVersion: 101\n\t\tLink_DeformAcuracy: 50\n\t}\n`;
    ligar(idPele, idGeo);
    Object.entries(m.porOsso).forEach(([osso, pontos], i) => {
      const q = noArquivo(lugar[osso]).map(n4), id = base + i;
      objetos += `\tDeformer: ${id}, "SubDeformer::", "Cluster" {\n\t\tVersion: 100\n\t\tUserData: "", ""\n` + lista("Indexes", pontos, 2) + lista("Weights", pontos.map(() => 1), 2) +
        lista("Transform", [0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.01, 0, n4(-q[0] / 100), n4(-q[1] / 100), n4(-q[2] / 100), 1], 2) + lista("TransformLink", [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, q[0], q[1], q[2], 1], 2) + "\t}\n";
      ligar(id, idPele); ligar(idDoOsso[osso], id);
    });
  };
  pele(ID.peleCorpo, ID.geoCorpo, mCorpo, 5100);
  pele(ID.peleCabelo, ID.geoCabelo, mCabelo, 5200);
  // formas do rosto
  objetos += `\tDeformer: ${ID.formas}, "Deformer::", "BlendShape" {\n\t\tVersion: 100\n\t}\n`;
  ligar(ID.formas, ID.geoCorpo);
  formas.forEach(([nome, pontos, d], i) => {
    objetos += `\tDeformer: ${6100 + i}, "SubDeformer::${nome}", "BlendShapeChannel" {\n\t\tVersion: 100\n\t\tDeformPercent: 0\n` + lista("FullWeights", [100], 2) + "\t}\n" +
      `\tGeometry: ${6200 + i}, "Geometry::${nome}", "Shape" {\n\t\tVersion: 100\n` + lista("Indexes", pontos, 2) + lista("Vertices", pontos.flatMap(() => d), 2) + lista("Normals", pontos.flatMap(() => [0, 0, 0]), 2) + "\t}\n";
    ligar(6100 + i, ID.formas); ligar(6200 + i, 6100 + i);
  });
  const texto = `; FBX 7.4.0 project file\n; avatar de teste do LNUX-APPs\nFBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n\tCreator: "teste do LNUX-APPs"\n}\n` +
    `GlobalSettings:  {\n\tVersion: 1000\n\tProperties70:  {\n\t\tP: "UpAxis", "int", "Integer", "",1\n\t\tP: "UnitScaleFactor", "double", "Number", "",1\n\t}\n}\n` +
    `Objects:  {\n${objetos}}\nConnections:  {\n${ligacoes}}\n`;
  return { fbx: Buffer.from(texto, "utf8"), ossos: ossos.map((o) => o[0]), humano };
}
/**
 * O avatar de teste dentro de um .unitypackage, como os do VRChat: o .fbx com a ficha do Unity (ossos de pessoa e o
 * material do cabelo ligado pela ficha), os materiais .mat (Corpo achado pelo nome; o do cabelo é recortado, de dois
 * lados e com textura .tga), as texturas e um prefab. Devolve {pacote: Buffer, fbx, texturas: {nome: Buffer}}.
 */
function avatarDoUnity() {
  const { fbx, humano } = avatarFBX(), g = (n) => n.toString(16).padStart(32, "0");
  const texturas = {
    "corpo.png": png(64, 64, (x, y) => (y < 32 ? [225, 40, 40] : [40, 70, 225])),   // em cima vermelho, embaixo azul
    "roupa.png": png(16, 16, () => [40, 190, 90]),
    "cabelo.tga": tga(32, 32, (x, y) => (y < 4 ? [255, 255, 255, 0] : [240, 200, 40, 255]), true),
  };
  const metaDoFbx = `fileFormatVersion: 2\nguid: ${g(1)}\nModelImporter:\n  serializedVersion: 21300\n  externalObjects:\n  - first:\n      type: UnityEngine:Material\n      assembly: UnityEngine.CoreModule\n      name: Cabelo\n    second: {fileID: 2100000, guid: ${g(3)}, type: 2}\n` +
    `  materials:\n    materialImportMode: 2\n  humanDescription:\n    serializedVersion: 3\n    human:\n` +
    humano.map(([osso, nome]) => `    - boneName: ${osso}\n      humanName: ${nome}\n      limit:\n        min: {x: 0, y: 0, z: 0}\n        useDefaultValues: 1\n`).join("") +
    `    skeleton: []\n    armTwist: 0.5\n  animationType: 3\n`;
  const mat = (nome, { tex = {}, num = {}, cor = {}, tipo = "Opaque", fila = -1 }) => `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!21 &2100000\nMaterial:\n  serializedVersion: 8\n  m_Name: ${nome}\n` +
    `  m_Shader: {fileID: 4800000, guid: df12117ecd77c31469c224178886498e, type: 3}\n  m_CustomRenderQueue: ${fila}\n  stringTagMap:\n    RenderType: ${tipo}\n  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs:\n` +
    Object.entries(tex).map(([k, v]) => `    - ${k}:\n        m_Texture: {fileID: 2800000, guid: ${v}, type: 3}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}\n`).join("") + "    m_Ints: []\n    m_Floats:\n" +
    Object.entries(num).map(([k, v]) => `    - ${k}: ${v}\n`).join("") + "    m_Colors:\n" + Object.entries(cor).map(([k, v]) => `    - ${k}: {r: ${v[0]}, g: ${v[1]}, b: ${v[2]}, a: ${v[3]}}\n`).join("");
  const pacote = unityPackage([
    { caminho: "Assets/Avatar/Avatar.fbx", dados: fbx, guid: g(1), meta: metaDoFbx },
    { caminho: "Assets/Avatar/Materials/Corpo.mat", dados: mat("Corpo", { tex: { _MainTex: g(4) }, cor: { _Color: [1, 1, 1, 1] }, num: { _Cull: 2, _Cutoff: 0.5 } }), guid: g(2) },
    { caminho: "Assets/Avatar/Materials/Cabelo_lilToon.mat", dados: mat("Cabelo_lilToon", { tex: { _MainTex: g(5) }, cor: { _Color: [1, 1, 1, 1] }, num: { _Cull: 0, _Cutoff: 0.4 }, tipo: "TransparentCutout", fila: 2450 }), guid: g(3) },
    { caminho: "Assets/Avatar/Textures/corpo.png", dados: texturas["corpo.png"], guid: g(4) },
    { caminho: "Assets/Avatar/Textures/cabelo.tga", dados: texturas["cabelo.tga"], guid: g(5) },
    { caminho: "Assets/Avatar/Textures/roupa.png", dados: texturas["roupa.png"], guid: g(6) },
    { caminho: "Assets/Avatar/Avatar.prefab", dados: "%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Avatar\n", guid: g(7) },
    { caminho: "Assets/Avatar/Leia-me.txt", dados: "Avatar de teste do LNUX-APPs.\n", guid: g(8) },
  ]);
  return { pacote, fbx, texturas };
}

// ── Mundo do Unity com física (malhas e texturas guardadas pelo Unity, colisores, Rigidbody, VRC Pickup) ──

/** Bits LSB primeiro, como o PackedBitVector do Unity. */
function empacotarBits(ints, bits) {
  const saida = Buffer.alloc(Math.ceil(ints.length * bits / 8));
  let pos = 0;
  for (const v of ints) for (let b = 0; b < bits; b++, pos++) if ((v >>> b) & 1) saida[pos >> 3] |= 1 << (pos & 7);
  return saida;
}
function pacoteFloats(vals, bits) {
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1, m = (1 << bits) - 1;
  return { n: vals.length, start: min, range, bits, dados: empacotarBits(vals.map((v) => Math.round((v - min) / range * m)), bits) };
}
const yamlPacote = (nome, p, comFaixa = true) => `    ${nome}:\n      m_NumItems: ${p.n}\n` + (comFaixa ? `      m_Range: ${p.range}\n      m_Start: ${p.start}\n` : "") + `      m_Data: ${p.dados.toString("hex")}\n      m_BitSize: ${p.bits}\n`;
/**
 * Uma malha .asset do Unity (no espaço do Unity, mão esquerda). pos: [[x,y,z]], normais: [[x,y,z]], uv: [[u,v]],
 * tris: [a,b,c,...] (horário, como o Unity). comprimida: m_MeshCompression 2 (PackedBitVector) em vez dos bytes crus.
 */
function malhaUnity(nome, { pos, normais, uv, tris }, { comprimida = false } = {}) {
  const n = pos.length;
  let corpo;
  if (comprimida) {
    const signs = normais.map((v) => (v[2] >= 0 ? 1 : 0));
    corpo = "  m_MeshCompression: 2\n  m_IndexFormat: 0\n  m_IndexBuffer: \n  m_VertexData:\n    serializedVersion: 3\n    m_VertexCount: 0\n    m_Channels: []\n    m_DataSize: 0\n    _typelessdata: \n  m_CompressedMesh:\n" +
      yamlPacote("m_Vertices", pacoteFloats(pos.flat(), 16)) + yamlPacote("m_UV", pacoteFloats(uv.flat(), 12)) + yamlPacote("m_Normals", pacoteFloats(normais.map((v) => [v[0], v[1]]).flat(), 10)) +
      yamlPacote("m_NormalSigns", { n, bits: 1, dados: empacotarBits(signs, 1) }, false) + yamlPacote("m_Triangles", { n: tris.length, bits: 8, dados: empacotarBits(tris, 8) }, false) + "    m_UVInfo: 5\n";
  } else {
    const passo = 32, buf = Buffer.alloc(n * passo);
    pos.forEach((p, i) => { p.forEach((v, k) => buf.writeFloatLE(v, i * passo + k * 4)); normais[i].forEach((v, k) => buf.writeFloatLE(v, i * passo + 12 + k * 4)); uv[i].forEach((v, k) => buf.writeFloatLE(v, i * passo + 24 + k * 4)); });
    const canal = (offset, dim) => `    - stream: 0\n      offset: ${offset}\n      format: 0\n      dimension: ${dim}\n`;
    const ib = Buffer.alloc(tris.length * 2);
    tris.forEach((v, i) => ib.writeUInt16LE(v, i * 2));
    corpo = `  m_MeshCompression: 0\n  m_IndexFormat: 0\n  m_IndexBuffer: ${ib.toString("hex")}\n  m_VertexData:\n    serializedVersion: 3\n    m_VertexCount: ${n}\n    m_Channels:\n` +
      canal(0, 3) + canal(12, 3) + canal(0, 0) + canal(0, 0) + canal(24, 2) + Array.from({ length: 9 }, () => canal(0, 0)).join("") + `    m_DataSize: ${buf.length}\n    _typelessdata: ${buf.toString("hex")}\n`;
  }
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!43 &4300000\nMesh:\n  serializedVersion: 11\n  m_Name: ${nome}\n  m_SubMeshes:\n  - serializedVersion: 2\n    firstByte: 0\n    indexCount: ${tris.length}\n    topology: 0\n    baseVertex: 0\n    firstVertex: 0\n    vertexCount: ${n}\n` + corpo;
}
/** Uma caixa (no Unity) de lado l, com as faces para fora. */
function caixaUnity(l = 1) {
  const h = l / 2, pos = [], normais = [], uv = [], tris = [];
  const faces = [[[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[-1, 0, 0], [0, 0, -1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]], [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]]];
  for (const [n, u, v] of faces) {
    const b = pos.length;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push([0, 1, 2].map((k) => (n[k] + u[k] * su + v[k] * sv) * h)); normais.push(n); uv.push([(su + 1) / 2, (sv + 1) / 2]); }
    // a face da frente no Unity é horária vista de frente: (v1 − v0) × (v2 − v0) dá o contrário da normal (conferido
    // com as malhas de um mundo de verdade: o leitor vira para o three e as faces batem com as normais)
    tris.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  return { pos, normais, uv, tris };
}
/** Grama: dois "cartões" cruzados de 1,2 m × 0,8 m (dos dois lados). */
function gramaUnity() {
  const pos = [], normais = [], uv = [], tris = [];
  for (const [dx, dz] of [[0.6, 0], [0, 0.6]]) {
    const b = pos.length, n = dz ? [1, 0, 0] : [0, 0, 1];
    for (const [s, y] of [[-1, 0], [1, 0], [1, 0.8], [-1, 0.8]]) { pos.push([dx * s, y, dz * s]); normais.push(n); uv.push([(s + 1) / 2, y / 0.8]); }
    tris.push(b, b + 2, b + 1, b, b + 3, b + 2, b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, normais, uv, tris };
}
/** Uma Texture2D .asset do Unity: formato 4 (RGBA32) ou 10 (DXT1); bytes já no formato, linhas de baixo para cima. */
function texturaUnity(nome, w, h, formato, bytes) {
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!28 &2800000\nTexture2D:\n  m_Name: ${nome}\n  serializedVersion: 2\n  m_Width: ${w}\n  m_Height: ${h}\n  m_CompleteImageSize: ${bytes.length}\n  m_TextureFormat: ${formato}\n  m_MipCount: 1\n` +
    `  m_ColorSpace: 1\n  image data: ${bytes.length}\n  _typelessdata: ${Buffer.from(bytes).toString("hex")}\n  m_StreamData:\n    serializedVersion: 2\n    offset: 0\n    size: 0\n    path: \n`;
}
/**
 * Um mundo do Unity sem .fbx (como os exportados com as peças separadas): a cena com o chão e uma parede (cubos do
 * Unity com BoxCollider), uma moita de grama (malha .asset crua, material recortado com textura DXT1, sem colisor), uma
 * bola (Rigidbody com gravidade, SphereCollider, material de física que quica), uma caixa de pegar (malha .asset
 * comprimida, Rigidbody cinemático, BoxCollider e o VRC Pickup), uma sala desligada (ligada por script no VRChat) e o
 * descritor do VRChat com o ponto de nascer. Devolve {pacote: Buffer}.
 */
function mundoUnityComFisica() {
  const g = (n) => n.toString(16).padStart(32, "0");
  const G = { cena: g(0x101), grama: g(0x102), caixa: g(0x103), matChao: g(0x104), matGrama: g(0x105), texChao: g(0x106), texGrama: g(0x107), fisBola: g(0x108) };
  const mat = (nome, tex, extra = "") => `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!21 &2100000\nMaterial:\n  m_Name: ${nome}\n  m_CustomRenderQueue: -1\n  stringTagMap:\n${extra}  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs:\n` +
    `      _MainTex:\n        m_Texture: {fileID: 2800000, guid: ${tex}, type: 3}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}\n    m_Floats:\n      _Cutoff: 0.5\n    m_Colors:\n      _Color: {r: 1, g: 1, b: 1, a: 1}\n`;
  // a cena: [id do objeto, nome, posição, escala, componentes]
  let id = 1000;
  const docs = [];
  const objeto = (nome, pos, esc, comps, { ativo = 1, pai = 0, rotY = 0 } = {}) => {
    const go = ++id, tr = ++id, ids = comps.map(() => ++id);
    const q = [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)];
    docs.push(`--- !u!1 &${go}\nGameObject:\n  m_Component:\n  - component: {fileID: ${tr}}\n` + ids.map((c) => `  - component: {fileID: ${c}}\n`).join("") + `  m_Layer: 0\n  m_Name: ${nome}\n  m_IsActive: ${ativo}\n`);
    docs.push(`--- !u!4 &${tr}\nTransform:\n  m_GameObject: {fileID: ${go}}\n  m_LocalRotation: {x: ${q[0]}, y: ${q[1]}, z: ${q[2]}, w: ${q[3]}}\n  m_LocalPosition: {x: ${pos[0]}, y: ${pos[1]}, z: ${pos[2]}}\n  m_LocalScale: {x: ${esc[0]}, y: ${esc[1]}, z: ${esc[2]}}\n  m_Children: []\n  m_Father: {fileID: ${pai}}\n`);
    comps.forEach((c, i) => docs.push(c(ids[i], go)));
    return tr;
  };
  const filtro = (malha) => (i, go) => `--- !u!33 &${i}\nMeshFilter:\n  m_GameObject: {fileID: ${go}}\n  m_Mesh: ${malha}\n`;
  const desenho = (matGuid) => (i, go) => `--- !u!23 &${i}\nMeshRenderer:\n  m_GameObject: {fileID: ${go}}\n  m_Enabled: 1\n  m_Materials:\n  - {fileID: ${matGuid ? "2100000, guid: " + matGuid + ", type: 2" : "10303, guid: 0000000000000000f000000000000000, type: 0"}}\n`;
  const caixaCol = (gatilho = 0) => (i, go) => `--- !u!65 &${i}\nBoxCollider:\n  m_GameObject: {fileID: ${go}}\n  m_Material: {fileID: 0}\n  m_IsTrigger: ${gatilho}\n  m_Enabled: 1\n  serializedVersion: 3\n  m_Size: {x: 1, y: 1, z: 1}\n  m_Center: {x: 0, y: 0, z: 0}\n`;
  const esferaCol = (i, go) => `--- !u!135 &${i}\nSphereCollider:\n  m_GameObject: {fileID: ${go}}\n  m_Material: {fileID: 13400000, guid: ${G.fisBola}, type: 2}\n  m_IsTrigger: 0\n  m_Enabled: 1\n  serializedVersion: 3\n  m_Radius: 0.5\n  m_Center: {x: 0, y: 0, z: 0}\n`;
  const corpo = (gravidade, cinematico) => (i, go) => `--- !u!54 &${i}\nRigidbody:\n  m_GameObject: {fileID: ${go}}\n  serializedVersion: 4\n  m_Mass: 0.5\n  m_Drag: 0\n  m_AngularDrag: 0.05\n  m_UseGravity: ${gravidade}\n  m_IsKinematic: ${cinematico}\n  m_Interpolate: 0\n  m_Constraints: 0\n  m_CollisionDetection: 0\n`;
  const pickup = (i, go) => `--- !u!114 &${i}\nMonoBehaviour:\n  m_GameObject: {fileID: ${go}}\n  m_Enabled: 1\n  m_Script: {fileID: 1804438810, guid: 661092b4961be7145bfbe56e1e62337b, type: 3}\n  DisallowTheft: 0\n  AutoHold: 1\n  InteractionText: \n  UseText: Use\n  pickupable: 1\n  proximity: 2\n`;
  const cubo = "{fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}", esfera = "{fileID: 10207, guid: 0000000000000000e000000000000000, type: 0}";
  objeto("Chao", [0, -0.1, 0], [20, 0.2, 20], [filtro(cubo), desenho(G.matChao), caixaCol()]);
  objeto("Parede", [0, 1, 6], [6, 2, 0.3], [filtro(cubo), desenho(null), caixaCol()]);
  objeto("Grass_Patch", [0, 0, 3], [1, 1, 1], [filtro(`{fileID: 4300000, guid: ${G.grama}, type: 2}`), desenho(G.matGrama)]);
  objeto("Gatilho", [0, 1, -3], [2, 2, 2], [caixaCol(1)]); // um gatilho (atravessável, nem aparece)
  objeto("Ball", [2, 2, 0], [0.4, 0.4, 0.4], [filtro(esfera), desenho(null), esferaCol, corpo(1, 0)]);
  objeto("Pickup Box", [-1.5, 0.15, 0], [0.3, 0.3, 0.3], [filtro(`{fileID: 4300000, guid: ${G.caixa}, type: 2}`), desenho(null), caixaCol(), corpo(0, 1), pickup]);
  // uma sala desligada (o mundo liga por script quando alguém entra): 12 peças → entra no mapa; a versão "Quest" não
  const sala = objeto("Salao", [-8, 0, -8], [1, 1, 1], [], { ativo: 0 });
  for (let i = 0; i < 12; i++) objeto("Coluna " + i, [i % 4, 0.5, Math.floor(i / 4)], [0.3, 1, 0.3], [filtro(cubo), desenho(null)], { pai: sala });
  const quest = objeto("Salao for Quest", [8, 0, -8], [1, 1, 1], [], { ativo: 0 });
  for (let i = 0; i < 12; i++) objeto("Coluna Q " + i, [i % 4, 0.5, Math.floor(i / 4)], [0.3, 1, 0.3], [filtro(cubo), desenho(null)], { pai: quest });
  // o ponto de nascer, virado para o +Z do Unity (o giro de 0)
  const spawn = objeto("Spawn", [0, 0, 1], [1, 1, 1], []);
  docs.push(`--- !u!1 &${++id}\nGameObject:\n  m_Name: VRCWorld\n  m_IsActive: 1\n--- !u!114 &${++id}\nMonoBehaviour:\n  m_GameObject: {fileID: ${id - 1}}\n  m_Enabled: 1\n  spawns:\n  - {fileID: ${spawn}}\n  spawnRadius: 0\n`);
  const cena = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" + docs.join("");
  // as texturas: o chão cinza (RGBA32 2×2: a linha de baixo vermelha, a de cima azul, para conferir a ordem) e a grama verde em DXT1
  const rgba = Buffer.from([220, 30, 30, 255, 220, 30, 30, 255, 30, 30, 220, 255, 30, 30, 220, 255]);
  const dxt = Buffer.alloc(8); dxt.writeUInt16LE(0x07e0, 0); dxt.writeUInt16LE(0x0000, 2); // verde puro, todos os pixels com a cor 0
  const pacote = unityPackage([
    { caminho: "Assets/Mundo/Mundo.unity", dados: cena, guid: G.cena },
    { caminho: "Assets/Mundo/Mesh/Grass_Patch.asset", dados: malhaUnity("Grass_Patch", gramaUnity()), guid: G.grama },
    { caminho: "Assets/Mundo/Mesh/PickupBox.asset", dados: malhaUnity("PickupBox", caixaUnity(1), { comprimida: true }), guid: G.caixa },
    { caminho: "Assets/Mundo/Material/Chao.mat", dados: mat("Chao", G.texChao), guid: G.matChao },
    { caminho: "Assets/Mundo/Material/Grama.mat", dados: mat("Grama", G.texGrama, "    RenderType: TransparentCutout\n"), guid: G.matGrama },
    { caminho: "Assets/Mundo/Texture2D/Chao.asset", dados: texturaUnity("Chao", 2, 2, 4, rgba), guid: G.texChao },
    { caminho: "Assets/Mundo/Texture2D/Grama.asset", dados: texturaUnity("Grama", 4, 4, 10, dxt), guid: G.texGrama },
    { caminho: "Assets/Mundo/PhysicMaterial/Quica.physicMaterial", dados: "%YAML 1.1\n--- !u!134 &13400000\nPhysicMaterial:\n  m_Name: Quica\n  dynamicFriction: 0.3\n  staticFriction: 0.3\n  bounciness: 0.7\n", guid: G.fisBola },
  ]);
  return { pacote, malhaUnity, caixaUnity, gramaUnity, texturaUnity };
}

/** Um ZIP simples (sem compactar): [[nome, Buffer]]. */
function zip(arquivos) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, dados] of arquivos) {
    const n = Buffer.from(nome), c = crc(dados), loc = Buffer.alloc(30), cen = Buffer.alloc(46);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt32LE(c, 14); loc.writeUInt32LE(dados.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(n.length, 26);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(c, 16); cen.writeUInt32LE(dados.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(pos, 42);
    partes.push(loc, n, dados);
    central.push(cen, n);
    pos += 30 + n.length + dados.length;
  }
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fim]);
}

module.exports = { mundoUnityComFisica, malhaUnity, caixaUnity, texturaUnity, glb, caixas, gltfDeMalha, mapaDeTeste, mapaAnimado, mapaEspecular, casaDeTeste, casaComLuzes, bonecoVRM0, bvhDeTeste, unityPackage, png, tga, psd, zip, avatarFBX, avatarDoUnity };
