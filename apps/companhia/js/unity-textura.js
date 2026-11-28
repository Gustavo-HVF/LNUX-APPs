/*
 * Companhia — ler as texturas guardadas pelo próprio Unity (Texture2D .asset, em YAML).
 *
 * Pacotes de mundo sem os .png originais trazem cada textura como "Texture2D.asset": a largura, a altura, o formato
 * (m_TextureFormat) e os bytes em hexadecimal (_typelessdata), com o nível maior primeiro e as linhas de baixo para
 * cima. Aqui viram imagens (um canvas):
 *   - lidos de verdade: Alpha8, RGB24, RGBA32, ARGB32, BGRA32, RGB565, RGBA4444, DXT1 (BC1) e DXT5 (BC3);
 *   - os outros (DXT "crunched", BC7, BC6H, ASTC, ETC...) e os que guardam os bytes fora do arquivo (.resS): entra a
 *     miniatura que o pacote traz ao lado (preview.png, pequena mas com as cores certas), ou nada.
 * As maiores que 1024 (ou o tamanho escolhido na conversão) são reduzidas (o mapa inteiro precisa caber no .glb).
 *
 * C.unityTextura = { imagem(texto, previa?, {maior}) → Promise<{tela, como: "lida"|"previa"}|null>, FORMATOS_LIDOS }
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const MAIOR = 1024;
  const campo = (t, nome) => { const m = new RegExp("^\\s*" + nome + ":[ \\t]*(.*)$", "m").exec(t); return m ? m[1].trim() : null; };

  function hexParaBytes(h, max) {
    const n = Math.min(h.length >> 1, max), b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = h.charCodeAt(i * 2), c = h.charCodeAt(i * 2 + 1);
      b[i] = ((a <= 57 ? a - 48 : (a | 32) - 87) << 4) | (c <= 57 ? c - 48 : (c | 32) - 87);
    }
    return b;
  }
  /** As cores de 565 (16 bits) para [r, g, b]. */
  const de565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

  /** Um bloco DXT1 (8 bytes) → 16 pixels RGBA em "saida" (x0, y0 no lugar). */
  function blocoCor(d, o, saida, larg, x0, y0, alfaDxt1) {
    const c0 = d[o] | (d[o + 1] << 8), c1 = d[o + 2] | (d[o + 3] << 8), a = de565(c0), b = de565(c1);
    const cores = [a, b];
    if (c0 > c1 || !alfaDxt1) { cores.push(a.map((v, i) => (2 * v + b[i]) / 3), a.map((v, i) => (v + 2 * b[i]) / 3)); }
    else cores.push(a.map((v, i) => (v + b[i]) / 2), null);
    const bits = d[o + 4] | (d[o + 5] << 8) | (d[o + 6] << 16) | (d[o + 7] << 24);
    for (let k = 0; k < 16; k++) {
      const x = x0 + (k & 3), y = y0 + (k >> 2);
      const c = cores[(bits >>> (2 * k)) & 3], p = (y * larg + x) * 4;
      if (c) { saida[p] = c[0]; saida[p + 1] = c[1]; saida[p + 2] = c[2]; if (alfaDxt1) saida[p + 3] = 255; }
      else if (alfaDxt1) saida[p + 3] = 0;
    }
  }
  /** O alfa de um bloco DXT5 (8 bytes). */
  function blocoAlfa(d, o, saida, larg, x0, y0) {
    const a0 = d[o], a1 = d[o + 1], t = [a0, a1];
    if (a0 > a1) for (let i = 1; i <= 6; i++) t.push(((7 - i) * a0 + i * a1) / 7);
    else { for (let i = 1; i <= 4; i++) t.push(((5 - i) * a0 + i * a1) / 5); t.push(0, 255); }
    let bits = 0n;
    for (let i = 0; i < 6; i++) bits |= BigInt(d[o + 2 + i]) << BigInt(8 * i);
    for (let k = 0; k < 16; k++) {
      const x = x0 + (k & 3), y = y0 + (k >> 2);
      saida[(y * larg + x) * 4 + 3] = t[Number((bits >> BigInt(3 * k)) & 7n)];
    }
  }
  /** Os pixels (RGBA, linhas de baixo para cima como no Unity) do formato, ou null se não sei ler. */
  function decodificar(fmt, d, w, h) {
    const n = w * h, s = new Uint8ClampedArray(n * 4);
    const cru = (bpp, f) => { if (d.length < n * bpp) return null; for (let i = 0; i < n; i++) f(i * bpp, i * 4); return s; };
    switch (fmt) {
      case 1: return cru(1, (o, p) => { s[p] = s[p + 1] = s[p + 2] = 255; s[p + 3] = d[o]; });                              // Alpha8
      case 3: return cru(3, (o, p) => { s[p] = d[o]; s[p + 1] = d[o + 1]; s[p + 2] = d[o + 2]; s[p + 3] = 255; });         // RGB24
      case 4: return cru(4, (o, p) => { s[p] = d[o]; s[p + 1] = d[o + 1]; s[p + 2] = d[o + 2]; s[p + 3] = d[o + 3]; });    // RGBA32
      case 5: return cru(4, (o, p) => { s[p] = d[o + 1]; s[p + 1] = d[o + 2]; s[p + 2] = d[o + 3]; s[p + 3] = d[o]; });    // ARGB32
      case 14: return cru(4, (o, p) => { s[p] = d[o + 2]; s[p + 1] = d[o + 1]; s[p + 2] = d[o]; s[p + 3] = d[o + 3]; });   // BGRA32
      case 7: return cru(2, (o, p) => { const c = de565(d[o] | (d[o + 1] << 8)); s[p] = c[0]; s[p + 1] = c[1]; s[p + 2] = c[2]; s[p + 3] = 255; }); // RGB565
      case 13: return cru(2, (o, p) => { const v = d[o] | (d[o + 1] << 8); s[p] = ((v >> 12) & 15) * 17; s[p + 1] = ((v >> 8) & 15) * 17; s[p + 2] = ((v >> 4) & 15) * 17; s[p + 3] = (v & 15) * 17; }); // RGBA4444
      case 10: case 12: {                                                                                                  // DXT1, DXT5
        const bx = Math.ceil(w / 4), by = Math.ceil(h / 4), tam = fmt === 10 ? 8 : 16;
        if (d.length < bx * by * tam) return null;
        // cada bloco num 4×4 à parte (as bordas de imagens que não são múltiplas de 4 são cortadas depois)
        const lw = bx * 4, tmp = new Uint8ClampedArray(lw * by * 4 * 4);
        for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) {
          const o = (y * bx + x) * tam;
          if (fmt === 10) blocoCor(d, o, tmp, lw, x * 4, y * 4, true);
          else { blocoAlfa(d, o, tmp, lw, x * 4, y * 4); blocoCor(d, o + 8, tmp, lw, x * 4, y * 4, false); }
        }
        for (let y = 0; y < h; y++) s.set(tmp.subarray(y * lw * 4, y * lw * 4 + w * 4), y * w * 4);
        return s;
      }
      default: return null;
    }
  }
  const FORMATOS_LIDOS = [1, 3, 4, 5, 7, 10, 12, 13, 14];

  /** Um canvas com a imagem, reduzido para caber em MAIOR, de cabeça para cima (as linhas do Unity vêm de baixo). */
  function paraTela(px, w, h, maior = MAIOR) {
    const t = document.createElement("canvas");
    t.width = w; t.height = h;
    const ctx = t.getContext("2d"), img = new ImageData(w, h), linha = w * 4;
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * linha, (h - y) * linha), y * linha);
    ctx.putImageData(img, 0, 0);
    if (Math.max(w, h) <= maior) return t;
    const k = maior / Math.max(w, h), r = document.createElement("canvas");
    r.width = Math.max(1, Math.round(w * k)); r.height = Math.max(1, Math.round(h * k));
    r.getContext("2d").drawImage(t, 0, 0, r.width, r.height);
    return r;
  }

  C.unityTextura = {
    FORMATOS_LIDOS,
    async imagem(texto, previa = null, { maior = MAIOR } = {}) {
      if (/^\s*Texture2D:\s*$/m.test(texto)) {
        const w = +(campo(texto, "m_Width") || 0), h = +(campo(texto, "m_Height") || 0), fmt = +(campo(texto, "m_TextureFormat") || -1);
        const fora = (/m_StreamData:[\s\S]*?path:[ \t]*(\S+)/.exec(texto) || [])[1];
        if (w > 0 && h > 0 && w * h <= 8192 * 8192 && !fora && FORMATOS_LIDOS.includes(fmt)) {
          const i = texto.indexOf("_typelessdata:");
          if (i >= 0) {
            const ini = i + 14 + (texto.slice(i + 14, i + 20).match(/^[ \t]*/)[0].length), fim = texto.indexOf("\n", ini);
            const bytes = hexParaBytes(texto.slice(ini, fim < 0 ? undefined : fim), 8 * w * h);
            const px = decodificar(fmt, bytes, w, h);
            if (px) return { tela: paraTela(px, w, h, maior), como: "lida" };
          }
        }
      }
      if (previa) {
        try {
          const bmp = await createImageBitmap(previa), t = document.createElement("canvas");
          t.width = bmp.width; t.height = bmp.height;
          t.getContext("2d").drawImage(bmp, 0, 0);
          bmp.close();
          return { tela: t, como: "previa" };
        } catch (e) { /* miniatura quebrada */ }
      }
      return null;
    },
  };
})();
