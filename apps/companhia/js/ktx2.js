/*
 * WEBC — texturas KTX2 (Basis Universal): abrir cenários que já vêm com elas e gravar os nossos com elas.
 *
 * KTX2 com Basis Universal (a extensão KHR_texture_basisu do glTF) é a textura que a placa de vídeo usa comprimida:
 * ocupa bem menos memória de vídeo que PNG/JPEG (que viram pixels soltos ao abrir) e o arquivo também fica menor.
 *   - abrir: o transcodificador (vendor/basis/, do three.js) converte para o formato que a placa entende;
 *   - gravar: o codificador (vendor/ktx2-codificador.min.js + vendor/ktx2/basis_encoder.wasm, uns 3,4 MB) só é
 *     baixado quando a pessoa escolhe "KTX2" na conversão. O .glb já pronto (com PNG/JPEG) é regravado: cada imagem
 *     vira KTX2 (cor e brilho em sRGB, ETC1S, que é a menor; o relevo — normal map — em UASTC, que não borra as
 *     direções), com mipmaps. Sem a imagem antiga ao lado: quem abrir precisa entender KTX2 (o WEBC entende).
 *
 * C.ktx2 = { carregador() → KTX2Loader (um só, compartilhado), glbComKTX2(buffer, {aoProgresso}) → {buffer, convertidas, antes, depois} }
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const EXT = "KHR_texture_basisu";
  let carregador = null, codificador = null;

  /** O KTX2Loader (um para tudo: ele mantém os workers do transcodificador). */
  function obterCarregador() {
    if (carregador) return carregador;
    const V = window.CompanhiaVRM, T = window.THREE;
    if (!V || !V.KTX2Loader) return null;
    carregador = new V.KTX2Loader().setTranscoderPath(new URL("vendor/basis/", location.href).href);
    // o que a placa de vídeo entende (BC7, ASTC, ETC2...): perguntado uma vez, num desenho pequeno à parte
    let r = null;
    try {
      r = new T.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
      carregador.detectSupport(r);
    } catch (e) { console.warn("WEBC: sem WebGL para escolher o formato das texturas KTX2 (vão como pixels soltos)", e); }
    finally { if (r) { r.dispose(); r.forceContextLoss(); } }
    return carregador;
  }

  /** Carrega o codificador (uma vez). */
  function obterCodificador() {
    if (codificador) return codificador;
    codificador = new Promise((ok, falhou) => {
      if (window.CompanhiaKTX2) { ok(); return; }
      const s = document.createElement("script");
      s.src = new URL("vendor/ktx2-codificador.min.js", location.href).href;
      s.onload = () => ok();
      s.onerror = () => falhou(new Error("Não consegui baixar o codificador de KTX2 (vendor/ktx2-codificador.min.js)."));
      document.head.append(s);
    }).then(() => {
      // a função do ktx2-encoder (com o decodificador de imagens do navegador), sempre com o WebAssembly daqui
      const wasmUrl = new URL("vendor/ktx2/basis_encoder.wasm", location.href).href;
      return { encode: (dados, opcoes) => window.CompanhiaKTX2.encodeToKTX2(dados, { ...opcoes, wasmUrl }) };
    });
    codificador.catch(() => { codificador = null; });
    return codificador;
  }

  /** O .glb em partes: {json, bin}. */
  function abrirGLB(buffer) {
    const v = new DataView(buffer);
    if (v.getUint32(0, true) !== 0x46546c67) throw new Error("Não é um .glb.");
    let p = 12, json = null, bin = null;
    while (p + 8 <= buffer.byteLength) {
      const n = v.getUint32(p, true), tipo = v.getUint32(p + 4, true);
      if (tipo === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, p + 8, n)));
      else if (tipo === 0x004e4942) bin = new Uint8Array(buffer, p + 8, n);
      p += 8 + n;
    }
    if (!json) throw new Error("O .glb não tem o JSON.");
    return { json, bin: bin || new Uint8Array(0) };
  }
  function fecharGLB(json, bin) {
    const texto = new TextEncoder().encode(JSON.stringify(json));
    const nj = Math.ceil(texto.length / 4) * 4, nb = Math.ceil(bin.length / 4) * 4;
    const total = 12 + 8 + nj + (bin.length ? 8 + nb : 0), saida = new Uint8Array(total), v = new DataView(saida.buffer);
    v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
    v.setUint32(12, nj, true); v.setUint32(16, 0x4e4f534a, true);
    saida.set(texto, 20);
    for (let i = 20 + texto.length; i < 20 + nj; i++) saida[i] = 0x20;
    if (bin.length) { v.setUint32(20 + nj, nb, true); v.setUint32(24 + nj, 0x004e4942, true); saida.set(bin, 28 + nj); }
    return saida.buffer;
  }

  /**
   * Regrava as imagens (PNG/JPEG) de um .glb como KTX2. buffer: ArrayBuffer do .glb. Devolve {buffer, convertidas,
   * antes (bytes das imagens), depois}. aoProgresso(fração, texto).
   */
  async function glbComKTX2(buffer, { aoProgresso = () => {} } = {}) {
    const { json, bin } = abrirGLB(buffer);
    const imagens = json.images || [];
    if (!imagens.length) return { buffer, convertidas: 0, antes: 0, depois: 0 };
    // como cada imagem é usada: cor (sRGB), relevo (normal) ou dados (rugosidade, metal, oclusão)
    const uso = new Map();
    const marcar = (info, tipo) => {
      if (!info || info.index === undefined) return;
      const t = (json.textures || [])[info.index];
      if (t && t.source !== undefined && !uso.has(t.source)) uso.set(t.source, tipo);
    };
    for (const m of json.materials || []) {
      const pbr = m.pbrMetallicRoughness || {};
      marcar(pbr.baseColorTexture, "cor"); marcar(m.emissiveTexture, "cor"); marcar(m.normalTexture, "normal");
      marcar(pbr.metallicRoughnessTexture, "dados"); marcar(m.occlusionTexture, "dados");
    }
    aoProgresso(0, "Preparando o codificador de KTX2...");
    const enc = await obterCodificador();
    const novas = new Map(); // índice do bufferView → bytes novos
    let antes = 0, depois = 0, convertidas = 0, feitas = 0;
    const lista = imagens.map((im, i) => [im, i]).filter(([im]) => im.bufferView !== undefined && /image\/(png|jpeg)/.test(im.mimeType || ""));
    for (const [im, i] of lista) {
      aoProgresso(feitas / Math.max(1, lista.length), `Comprimindo as texturas em KTX2 (${feitas + 1} de ${lista.length})...`);
      const bv = json.bufferViews[im.bufferView], dados = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const tipo = uso.get(i) || "cor";
      try {
        const ktx = await enc.encode(dados, tipo === "normal"
          ? { isUASTC: true, isNormalMap: true, needSupercompression: true, generateMipmap: true, isSetKTX2SRGBTransferFunc: false, isPerceptual: false }
          : { isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isSetKTX2SRGBTransferFunc: tipo === "cor", isPerceptual: tipo === "cor" });
        antes += dados.length; depois += ktx.length;
        novas.set(im.bufferView, ktx);
        im.mimeType = "image/ktx2";
        for (const t of json.textures || []) if (t.source === i) { t.extensions = { ...(t.extensions || {}), [EXT]: { source: i } }; delete t.source; }
        convertidas++;
      } catch (e) { console.warn("WEBC: uma textura não virou KTX2 (fica como estava)", e); }
      feitas++;
      await new Promise((r) => setTimeout(r, 0)); // a janela respira
    }
    if (!convertidas) return { buffer, convertidas, antes, depois };
    // o BIN de novo, na mesma ordem, com as imagens trocadas (cada parte alinhada em 4 bytes)
    const partes = [];
    let pos = 0;
    json.bufferViews.forEach((bv, k) => {
      const d = novas.get(k) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const alinhado = Math.ceil(pos / 4) * 4;
      partes.push([alinhado, d]);
      bv.byteOffset = alinhado; bv.byteLength = d.length;
      pos = alinhado + d.length;
    });
    const novoBin = new Uint8Array(Math.ceil(pos / 4) * 4);
    for (const [o, d] of partes) novoBin.set(d, o);
    json.buffers[0].byteLength = novoBin.length;
    json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), EXT])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), EXT])];
    aoProgresso(1, "");
    return { buffer: fecharGLB(json, novoBin), convertidas, antes, depois };
  }

  C.ktx2 = { carregador: obterCarregador, glbComKTX2, abrirGLB };
})();
