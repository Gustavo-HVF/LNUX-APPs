/*
 * LNUX-APPs — codificador de GIF animado (só JavaScript do navegador).
 *
 * Paleta fixa de 252 cores (6 níveis de vermelho × 7 de verde × 6 de azul) com pontilhado ordenado (Bayer 4×4),
 * que fica bom em animações de títulos e formas e é rápido; uma cor a mais é reservada para o fundo
 * transparente. Compressão LZW como manda a especificação GIF89a.
 *
 *   const gif = new LNUX.Gif(320, 180, { transparente: false });
 *   gif.quadro(ctx.getImageData(0, 0, 320, 180), 4);   // 4 centésimos de segundo
 *   const blob = gif.gerar();
 */
(function () {
  "use strict";

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
  const TRANSPARENTE = 252;

  function paleta() {
    const p = new Uint8Array(256 * 3);
    let i = 0;
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      p[i++] = Math.round((r * 255) / 5); p[i++] = Math.round((g * 255) / 6); p[i++] = Math.round((b * 255) / 5);
    }
    return p; // as últimas 4 entradas ficam pretas (252 = transparente)
  }

  /** Compressão LZW de um quadro (índices de cor) em sub-blocos de até 255 bytes. */
  function lzw(indices, tamanhoMinimo = 8) {
    const saida = [];
    let bloco = [];
    let acumulado = 0, bits = 0;
    const emitir = (codigo, largura) => {
      acumulado |= codigo << bits;
      bits += largura;
      while (bits >= 8) {
        bloco.push(acumulado & 0xff);
        if (bloco.length === 255) { saida.push(255, ...bloco); bloco = []; }
        acumulado >>>= 8;
        bits -= 8;
      }
    };
    const limpar = 1 << tamanhoMinimo, fim = limpar + 1;
    let tabela = new Map();
    let proximo = fim + 1, largura = tamanhoMinimo + 1;
    emitir(limpar, largura);
    let atual = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const chave = atual * 4096 + k;
      const achado = tabela.get(chave);
      if (achado !== undefined) { atual = achado; continue; }
      emitir(atual, largura);
      if (proximo < 4096) {
        tabela.set(chave, proximo++);
        if (proximo > 1 << largura && largura < 12) largura++;
      } else {
        emitir(limpar, largura);
        tabela = new Map();
        proximo = fim + 1;
        largura = tamanhoMinimo + 1;
      }
      atual = k;
    }
    emitir(atual, largura);
    emitir(fim, largura);
    if (bits > 0) bloco.push(acumulado & 0xff);
    if (bloco.length) saida.push(bloco.length, ...bloco);
    saida.push(0);
    return saida;
  }

  class Gif {
    constructor(largura, altura, { transparente = false, repetir = 0 } = {}) {
      this.largura = largura;
      this.altura = altura;
      this.transparente = transparente;
      this.repetir = repetir;
      this.partes = [];
    }

    /** Acrescenta um quadro (ImageData do tamanho do GIF); atraso em centésimos de segundo. */
    quadro(imagem, atraso = 4) {
      const { width: w, height: h, data: d } = imagem;
      const indices = new Uint8Array(w * h);
      for (let y = 0, p = 0; y < h; y++) {
        for (let x = 0; x < w; x++, p++) {
          const o = p * 4;
          if (this.transparente && d[o + 3] < 128) { indices[p] = TRANSPARENTE; continue; }
          const b = BAYER[(y & 3) * 4 + (x & 3)];
          const r = Math.min(5, Math.max(0, Math.round((d[o] / 255) * 5 + b)));
          const g = Math.min(6, Math.max(0, Math.round((d[o + 1] / 255) * 6 + b)));
          const bl = Math.min(5, Math.max(0, Math.round((d[o + 2] / 255) * 5 + b)));
          indices[p] = r * 42 + g * 6 + bl;
        }
      }
      const gce = [0x21, 0xf9, 4, ((this.transparente ? 2 : 1) << 2) | (this.transparente ? 1 : 0), atraso & 0xff, (atraso >> 8) & 0xff, this.transparente ? TRANSPARENTE : 0, 0];
      const descritor = [0x2c, 0, 0, 0, 0, w & 0xff, w >> 8, h & 0xff, h >> 8, 0];
      this.partes.push(new Uint8Array([...gce, ...descritor, 8]), new Uint8Array(lzw(indices)));
    }

    gerar() {
      const w = this.largura, h = this.altura;
      const cabeca = [..."GIF89a"].map((c) => c.charCodeAt(0));
      const tela = [w & 0xff, w >> 8, h & 0xff, h >> 8, 0xf7, 0, 0]; // tabela global de 256 cores
      const repetir = [0x21, 0xff, 11, ..."NETSCAPE2.0"].map((c) => (typeof c === "string" ? c.charCodeAt(0) : c));
      const repetir2 = [3, 1, this.repetir & 0xff, (this.repetir >> 8) & 0xff, 0];
      return new Blob([new Uint8Array([...cabeca, ...tela]), paleta(), new Uint8Array([...repetir, ...repetir2]), ...this.partes, new Uint8Array([0x3b])], { type: "image/gif" });
    }
  }

  window.LNUX = window.LNUX || {};
  window.LNUX.Gif = Gif;
})();
