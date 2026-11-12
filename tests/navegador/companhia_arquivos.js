// Arquivos de teste da Companhia montados na hora (sem baixar nada), usados por testar_companhia_corpo.js e
// testar_companhia_mapas.js: um .glb de caixas (cenário), um boneco VRM 0.x só de ossos, um .bvh e um .unitypackage.
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
/**
 * Boneco VRM 0.x: só ossos (com uma caixinha em cada um, para aparecer na tela). Como nos VRM 0.x de verdade, olha
 * para −Z e o lado esquerdo fica em −X.
 */
function bonecoVRM0() {
  const ossos = [["hips", null, [0, 0.9, 0]], ["spine", "hips", [0, 1.0, 0]], ["chest", "spine", [0, 1.15, 0]], ["neck", "chest", [0, 1.35, 0]], ["head", "neck", [0, 1.45, 0]]];
  for (const [l, s] of [["left", -1], ["right", 1]]) {
    ossos.push([l + "Shoulder", "chest", [0.05 * s, 1.3, 0]], [l + "UpperArm", l + "Shoulder", [0.15 * s, 1.3, 0]], [l + "LowerArm", l + "UpperArm", [0.4 * s, 1.3, 0]], [l + "Hand", l + "LowerArm", [0.65 * s, 1.3, 0]],
      [l + "IndexProximal", l + "Hand", [0.73 * s, 1.3, -0.02]], [l + "IndexIntermediate", l + "IndexProximal", [0.77 * s, 1.3, -0.02]], [l + "IndexDistal", l + "IndexIntermediate", [0.8 * s, 1.3, -0.02]],
      [l + "MiddleProximal", l + "Hand", [0.735 * s, 1.3, 0]], [l + "MiddleIntermediate", l + "MiddleProximal", [0.775 * s, 1.3, 0]], [l + "MiddleDistal", l + "MiddleIntermediate", [0.805 * s, 1.3, 0]],
      [l + "UpperLeg", "hips", [0.09 * s, 0.85, 0]], [l + "LowerLeg", l + "UpperLeg", [0.09 * s, 0.47, 0]], [l + "Foot", l + "LowerLeg", [0.09 * s, 0.08, 0]], [l + "Toes", l + "Foot", [0.09 * s, 0.02, -0.12]]);
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
/** Um .unitypackage (tar.gz do Unity) com um arquivo: <guid>/pathname e <guid>/asset. */
function unityPackage(caminho, dados) {
  const guid = "0123456789abcdef0123456789abcdef";
  const entrada = (nome, corpo) => {
    const cab = Buffer.alloc(512);
    cab.write(nome, 0); cab.write("0000644\0", 100); cab.write("0000000\0", 108); cab.write("0000000\0", 116);
    cab.write(corpo.length.toString(8).padStart(11, "0") + "\0", 124); cab.write("00000000000\0", 136); cab.write("        ", 148); cab.write("0", 156); cab.write("ustar\0" + "00", 257);
    let soma = 0;
    for (const b of cab) soma += b;
    cab.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
    return Buffer.concat([cab, corpo, Buffer.alloc((512 - (corpo.length % 512)) % 512)]);
  };
  return zlib.gzipSync(Buffer.concat([entrada(`${guid}/pathname`, Buffer.from(caminho)), entrada(`${guid}/asset`, dados), entrada(`${guid}/asset.meta`, Buffer.from("fileFormatVersion: 2\n")), Buffer.alloc(1024)]));
}

module.exports = { glb, caixas, gltfDeMalha, mapaDeTeste, bonecoVRM0, bvhDeTeste, unityPackage };
