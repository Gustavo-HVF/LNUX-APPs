/*
 * WEBC — o carregador de glTF dos mapas (o jogo, a vitrine da loja e o conversor): Draco, Meshopt, KTX2 e as extensões que o
 * three.js deixou de abrir.
 *
 * KHR_materials_pbrSpecularGlossiness: o material "specular/glossiness" das exportações antigas do Sketchfab (e de
 * vários exportadores do 3ds Max). Sem ela, o three.js ignora a textura de cor e deixa o material todo metálico: o mapa
 * aparece sem textura, cinza ou escuro. Aqui ele vira o material de sempre (cor = difusa, sem metal, rugosidade =
 * 1 − brilho, com a textura de brilho virando a de rugosidade).
 *
 * C.carregadorGLTF(gerente) → GLTFLoader pronto (chame .soltar() no fim).
 * C.glbSemEspecular(buffer) → o mesmo .glb com a alternativa padrão (pbrMetallicRoughness) escrita nos materiais
 *   specular/glossiness, para abrir em qualquer programa; null se não precisa. Só reescreve o JSON (as texturas ficam).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const ESPECULAR = "KHR_materials_pbrSpecularGlossiness";
  const MAIOR = 2048; // a textura de rugosidade feita do brilho não passa disso (é calculada pixel a pixel)

  /** A textura de rugosidade feita do brilho (o canal alfa da textura specular/glossiness): rugosidade = 1 − brilho. */
  function rugosidadeDoBrilho(T, tex, fator, canal) {
    const img = tex && tex.image;
    if (!img || !img.width || typeof document === "undefined") return null;
    const k = Math.min(1, MAIOR / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(img.width * k));
    tela.height = Math.max(1, Math.round(img.height * k));
    const ctx = tela.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, tela.width, tela.height);
    const dados = ctx.getImageData(0, 0, tela.width, tela.height), p = dados.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = 255 - Math.round(p[i + 3] * fator);
      p[i] = p[i + 1] = p[i + 2] = r;
      p[i + 3] = 255;
    }
    ctx.putImageData(dados, 0, 0);
    const nova = new T.CanvasTexture(tela);
    nova.name = (tex.name || "brilho") + " (rugosidade)";
    nova.flipY = tex.flipY;
    nova.wrapS = tex.wrapS;
    nova.wrapT = tex.wrapT;
    nova.magFilter = tex.magFilter;
    nova.minFilter = tex.minFilter;
    nova.colorSpace = T.NoColorSpace;
    nova.channel = canal || 0;
    if (tex.offset) { nova.offset.copy(tex.offset); nova.repeat.copy(tex.repeat); nova.rotation = tex.rotation; nova.center.copy(tex.center); }
    return nova;
  }

  /** O plugin do GLTFLoader para o KHR_materials_pbrSpecularGlossiness. */
  class PluginEspecular {
    constructor(parser) { this.parser = parser; this.name = ESPECULAR; }
    extendMaterialParams(indice, p) {
      const def = (this.parser.json.materials || [])[indice] || {};
      const ext = def.extensions && def.extensions[ESPECULAR];
      if (!ext) return Promise.resolve();
      const T = window.THREE, espera = [];
      const f = Array.isArray(ext.diffuseFactor) ? ext.diffuseFactor : [1, 1, 1, 1];
      p.color = new T.Color().setRGB(f[0], f[1], f[2], T.LinearSRGBColorSpace);
      p.opacity = f[3] === undefined ? 1 : f[3];
      p.metalness = 0; // specular/glossiness não tem metal: o que brilha vem da cor especular (quase sempre a de um não metal)
      const brilho = ext.glossinessFactor === undefined ? 1 : ext.glossinessFactor;
      p.roughness = 1 - brilho;
      if (ext.diffuseTexture) espera.push(this.parser.assignTexture(p, "map", ext.diffuseTexture, T.SRGBColorSpace));
      if (ext.specularGlossinessTexture) {
        const d = ext.specularGlossinessTexture;
        espera.push(this.parser.getDependency("texture", d.index).then((tex) => {
          try {
            const r = rugosidadeDoBrilho(T, tex, brilho, d.texCoord);
            if (r) { p.roughnessMap = r; p.roughness = 1; }
          } catch (e) { /* imagem que não dá para ler: fica a rugosidade do fator */ }
        }).catch(() => {}));
      }
      return Promise.all(espera);
    }
  }

  C.carregadorGLTF = function (gerente) {
    const V = window.CompanhiaVRM;
    const carregador = new V.GLTFLoader(gerente);
    const draco = new V.DRACOLoader(); // sem o gerente do mapa: ele troca os endereços que não são do pacote (o decodificador viraria um pixel)
    draco.setDecoderPath(new URL("vendor/draco/", location.href).href);
    carregador.setDRACOLoader(draco);
    carregador.setMeshoptDecoder(V.MeshoptDecoder);
    const ktx2 = C.ktx2 && C.ktx2.carregador(); // texturas KTX2 (Basis Universal), js/ktx2.js
    if (ktx2) carregador.setKTX2Loader(ktx2);
    carregador.register((parser) => new PluginEspecular(parser));
    carregador.soltar = () => draco.dispose();
    return carregador;
  };

  /** Reescreve só o JSON do .glb: a alternativa pbrMetallicRoughness nos materiais specular/glossiness. */
  C.glbSemEspecular = function (buffer) {
    const v = new DataView(buffer);
    if (buffer.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67 || v.getUint32(16, true) !== 0x4e4f534a) return null;
    const n = v.getUint32(12, true);
    let json;
    try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, n))); } catch (e) { return null; }
    if (!(json.extensionsUsed || []).includes(ESPECULAR)) return null;
    let mudou = (json.extensionsRequired || []).includes(ESPECULAR);
    for (const m of json.materials || []) {
      const ext = m.extensions && m.extensions[ESPECULAR];
      if (!ext || m.pbrMetallicRoughness) continue;
      mudou = true;
      // o brilho de cada pixel (a textura specular/glossiness) não cabe na alternativa: com ela, uma rugosidade média
      const rugosidade = 1 - (ext.glossinessFactor === undefined ? 1 : ext.glossinessFactor);
      const pbr = { metallicFactor: 0, roughnessFactor: +(ext.specularGlossinessTexture ? Math.max(rugosidade, 0.8) : rugosidade).toFixed(4) };
      if (Array.isArray(ext.diffuseFactor)) pbr.baseColorFactor = ext.diffuseFactor;
      if (ext.diffuseTexture) pbr.baseColorTexture = ext.diffuseTexture;
      m.pbrMetallicRoughness = pbr;
    }
    if (!mudou) return null;
    json.extensionsRequired = (json.extensionsRequired || []).filter((e) => e !== ESPECULAR);
    if (!json.extensionsRequired.length) delete json.extensionsRequired;
    let texto = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (texto.length % 4)) % 4;
    if (pad) { const t = new Uint8Array(texto.length + pad); t.set(texto); t.fill(0x20, texto.length); texto = t; }
    const resto = new Uint8Array(buffer, 20 + n); // o BIN (e o que vier depois) fica igual
    const saida = new Uint8Array(20 + texto.length + resto.length);
    const s = new DataView(saida.buffer);
    s.setUint32(0, 0x46546c67, true);
    s.setUint32(4, 2, true);
    s.setUint32(8, saida.length, true);
    s.setUint32(12, texto.length, true);
    s.setUint32(16, 0x4e4f534a, true);
    saida.set(texto, 20);
    saida.set(resto, 20 + texto.length);
    return saida.buffer;
  };
})();
