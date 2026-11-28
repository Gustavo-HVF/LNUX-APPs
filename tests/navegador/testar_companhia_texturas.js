// Teste das texturas dos cenários convertidos: o tamanho máximo, JPEG onde não há transparência e KTX2 (Basis
// Universal), gravar e abrir. No Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_texturas
//
// Não baixa nada: o cenário é um .gltf montado aqui, com uma textura grande e sem transparência (1600 px, a cor do
// chão) e uma pequena com recorte (as folhas, PNG com alfa, num material MASK).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { png, bonecoVRM0 } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** Um .gltf com dois materiais: o chão (textura grande, opaca) e as folhas (textura pequena com alfa, recortada). */
function cenarioComTexturas() {
  const posicoes = [], uvs = [], indices = [];
  const quad = (pts) => { const b = posicoes.length / 3; for (const p of pts) posicoes.push(...p); uvs.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[-5, 0, 5], [5, 0, 5], [5, 0, -5], [-5, 0, -5]]);                 // o chão (para cima)
  const n1 = indices.length;
  quad([[-0.6, 0, 0], [0.6, 0, 0], [0.6, 1, 0], [-0.6, 1, 0]]);           // as folhas (um cartão)
  const p = Buffer.from(new Float32Array(posicoes).buffer), u = Buffer.from(new Float32Array(uvs).buffer), i = Buffer.from(new Uint16Array(indices).buffer);
  const binario = Buffer.concat([p, u, i]);
  const gltf = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "Chao", mesh: 0 }, { name: "Moita", mesh: 1 }],
    buffers: [{ uri: "dados.bin", byteLength: binario.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: p.length }, { buffer: 0, byteOffset: p.length, byteLength: u.length }, { buffer: 0, byteOffset: p.length + u.length, byteLength: i.length }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posicoes.length / 3, type: "VEC3", min: [-5, 0, -5], max: [5, 1, 5] },
      { bufferView: 1, componentType: 5126, count: uvs.length / 2, type: "VEC2" },
      { bufferView: 2, byteOffset: 0, componentType: 5123, count: n1, type: "SCALAR" },
      { bufferView: 2, byteOffset: n1 * 2, componentType: 5123, count: indices.length - n1, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 3, material: 1 }] }],
    materials: [
      { name: "Chao", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } },
      { name: "Folhas", alphaMode: "MASK", alphaCutoff: 0.5, doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0 } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: "chao.png" }, { uri: "folhas.png" }],
  };
  return {
    "cenario.gltf": Buffer.from(JSON.stringify(gltf)),
    "dados.bin": binario,
    // opaca e grande, com ruído como uma foto (madeira, pedra): é onde o JPEG ganha
    "chao.png": png(1600, 1600, (x, y) => { const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, n = (r - Math.floor(r)) * 60; return [120 + n, 90 + n * 0.8, 60 + n * 0.5].map(Math.round); }),
    "folhas.png": png(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 24 ? [40, 160, 40, 255] : [0, 0, 0, 0]), true), // folha redonda com recorte
  };
}

(async () => {
  const arquivos = cenarioComTexturas();
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const b64 = Object.fromEntries(Object.entries(arquivos).map(([n, d]) => [n, d.toString("base64")]));

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 30000 });
    // uma personagem 3D aberta (o cenário é dela)
    await ev(async (b) => { await window.Companhia.importarPacote(new Map([["Boneco.vrm", new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))])]])); }, bonecoVRM0().toString("base64"));
    await pagina.waitForFunction(() => window.Companhia.pronto && window.Companhia.palco.modelo && window.Companhia.palco.mundo, null, { timeout: 60000 });

    /** Converte com as escolhas e lê o .glb gerado: as imagens (tipo, largura) e as extensões. */
    const converter = (texturas) => ev(async ([b64, texturas]) => {
      const arqs = new Map(Object.entries(b64).map(([n, d]) => [n, new Blob([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))])]));
      const r = await C.conversor.paraGLB(arqs, "cenario.gltf", { texturas });
      const buf = await r.glb.arrayBuffer(), { json, bin } = C.ktx2.abrirGLB(buf);
      const imagens = [];
      for (const im of json.images || []) {
        const bv = json.bufferViews[im.bufferView], dados = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        let largura = null;
        if (/png|jpeg/.test(im.mimeType)) { const bmp = await createImageBitmap(new Blob([dados], { type: im.mimeType })); largura = bmp.width; bmp.close(); }
        imagens.push({ tipo: im.mimeType, largura, bytes: dados.length });
      }
      window.__glb = r.glb;
      return { tamanho: buf.byteLength, imagens, req: json.extensionsRequired || [], basisu: (json.textures || []).filter((t) => t.extensions && t.extensions.KHR_texture_basisu).length, avisos: r.avisos };
    }, [b64, texturas]);

    const original = await converter({ formato: "original" });
    ok(original.imagens.every((i) => i.tipo === "image/png") && original.imagens.some((i) => i.largura === 1600), `"Como vieram": PNG, sem reduzir (${original.imagens.map((i) => i.largura).join(", ")} px; ${original.tamanho} bytes)`);

    const auto = await converter({ formato: "auto", maior: 1024 });
    const chao = auto.imagens.find((i) => i.largura >= 64 && i.tipo === "image/jpeg"), folhas = auto.imagens.find((i) => i.tipo === "image/png");
    ok(chao && chao.largura === 1024 && folhas && folhas.largura === 64, `automático: o chão (opaco) em JPEG e reduzido para 1024 px; as folhas (recorte) continuam PNG: ${JSON.stringify(auto.imagens.map((i) => [i.tipo, i.largura]))}`);
    ok(auto.tamanho < original.tamanho * 0.6 && auto.avisos.some((a) => /JPEG/.test(a) && /1024/.test(a)), `o arquivo fica bem menor (${original.tamanho} → ${auto.tamanho} bytes) e o aviso conta o que foi feito: ${auto.avisos.join(" | ")}`);

    // a escolha entre JPEG e PNG: foto (os vizinhos variam) vira JPEG; desenho (áreas lisas, poucas cores) fica PNG
    const escolha = await ev(() => {
      const T = THREE, tela = (f) => { const c = document.createElement("canvas"); c.width = 256; c.height = 128; const x = c.getContext("2d"), d = x.createImageData(256, 128); for (let i = 0; i < 256 * 128; i++) d.data.set([...f(i % 256, Math.floor(i / 256)), 255], i * 4); x.putImageData(d, 0, 0); return new T.CanvasTexture(c); };
      const letreiro = tela((x, y) => (x > 40 && x < 216 && y > 40 && y < 88 ? [250, 240, 40] : [30, 30, 120]));
      const pedra = tela((x, y) => { const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, n = (r - Math.floor(r)) * 80; return [100 + n, 100 + n, 100 + n]; });
      const g = new T.Group();
      g.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial({ map: letreiro })), new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial({ map: pedra })));
      const r = C.conversor.otimizarTexturas(g, { maior: 1024, formato: "auto" });
      return [letreiro.userData.mimeType || "image/png", pedra.userData.mimeType || "image/png", r.jpeg];
    });
    ok(escolha[0] === "image/png" && escolha[1] === "image/jpeg", `foto vira JPEG e desenho (letreiro, áreas lisas) fica PNG: ${JSON.stringify(escolha)}`);

    const pequeno = await converter({ formato: "auto", maior: 512 });
    ok(pequeno.imagens.some((i) => i.largura === 512) && pequeno.tamanho < auto.tamanho, `512 px: menor ainda (${pequeno.tamanho} bytes)`);

    // KTX2: grava e abre
    const ktx = await converter({ formato: "ktx2", maior: 1024 });
    ok(ktx.imagens.every((i) => i.tipo === "image/ktx2") && ktx.basisu === 2 && ktx.req.includes("KHR_texture_basisu") && ktx.avisos.some((a) => /KTX2/.test(a)),
      `KTX2: as 2 texturas viram KTX2 (KHR_texture_basisu, exigida no arquivo): ${JSON.stringify(ktx.imagens.map((i) => [i.tipo, i.bytes]))}; ${ktx.avisos.join(" | ")}`);
    const aberto = await ev(async () => {
      const gltf = await C.carregadorGLTF().parseAsync(await window.__glb.arrayBuffer(), "");
      const mapas = [];
      gltf.scene.traverse((o) => { if (o.isMesh && o.material.map) mapas.push([o.material.map.isCompressedTexture || o.material.map.isTexture, o.material.map.image && (o.material.map.image.width || (o.material.map.mipmaps && o.material.map.mipmaps[0] && o.material.map.mipmaps[0].width))]); });
      // e no jogo, como cenário
      const m = window.Companhia.palco.mundo;
      await m.abrirMapa(new Map([["ktx2.glb", window.__glb]]), { nome: "Com KTX2" });
      return { mapas, noJogo: !!m.mapa, plantas: m.plantas ? m.plantas.plantas.length : 0 };
    });
    ok(aberto.mapas.length === 2 && aberto.mapas.every((m) => m[0] && m[1] > 0) && aberto.noJogo, `o .glb com KTX2 abre (o transcodificador do WEBC) e vira cenário no jogo: ${JSON.stringify(aberto)}`);

    // um .glb pronto: o KTX2 regrava só as imagens
    const reGravado = await ev(async (b64) => {
      const arqs = new Map(Object.entries(b64).map(([n, d]) => [n, new Blob([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))])]));
      const base = await C.conversor.paraGLB(arqs, "cenario.gltf", { texturas: { formato: "auto" } });
      const r = await C.conversor.paraGLB(new Map([["mapa.glb", base.glb]]), "mapa.glb", { texturas: { formato: "ktx2" } });
      const { json } = C.ktx2.abrirGLB(await r.glb.arrayBuffer());
      return { tipos: json.images.map((i) => i.mimeType), como: r.como };
    }, b64);
    ok(reGravado.tipos.every((t) => t === "image/ktx2") && /já estava/.test(reGravado.como), `um .glb pronto com KTX2 escolhido: as imagens de dentro viram KTX2 (${reGravado.tipos})`);

    // a escolha na tela fica guardada para as próximas conversões
    const tela = await ev(() => {
      const d = C.conversor.escolhaTexturas();
      document.body.append(d);
      const tam = d.querySelector('[data-texturas="maior"]'), fmt = d.querySelector('[data-texturas="formato"]');
      tam.value = "2048"; tam.dispatchEvent(new Event("change"));
      fmt.value = "ktx2"; fmt.dispatchEvent(new Event("change"));
      const r = C.conversor.texturasEscolhidas();
      d.remove();
      tam.value = "1024"; fmt.value = "auto"; tam.dispatchEvent(new Event("change"));
      return [r, C.conversor.texturasEscolhidas()];
    });
    ok(tela[0].maior === 2048 && tela[0].formato === "ktx2" && tela[1].maior === 1024 && tela[1].formato === "auto", `a escolha (tamanho e formato) fica guardada para as próximas conversões: ${JSON.stringify(tela)}`);
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (texturas: tamanho, JPEG e KTX2): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
