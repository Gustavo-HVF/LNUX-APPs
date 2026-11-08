/*
 * LNUX-APPs — ZIP simples (só JavaScript do navegador).
 *
 * Os apps salvam um projeto num arquivo só: um .zip com "projeto.json" e as mídias junto. Para escrever,
 * os arquivos vão sem compressão ("store"): vídeo e áudio já são comprimidos, e assim fica rápido. Para ler,
 * aceita "store" e "deflate" (o formato comum de qualquer .zip), usando o DecompressionStream do navegador.
 *
 *   const zip = new LNUX.Zip(); zip.adicionar("projeto.json", texto); zip.adicionar("midia/a.wav", blob);
 *   const blob = await zip.gerar();
 *   const arquivos = await LNUX.Zip.ler(blob);   // Map nome → Blob
 */
(function () {
  "use strict";

  const TABELA = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABELA[n] = c >>> 0;
  }
  function crc32(bytes, crc = 0) {
    crc = crc ^ 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = TABELA[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dataDos(d = new Date()) {
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { hora, dia };
  }

  class Zip {
    constructor() { this.itens = []; }

    /** dados: texto, Blob, ArrayBuffer ou Uint8Array */
    adicionar(nome, dados) {
      this.itens.push({ nome, dados });
      return this;
    }

    async gerar() {
      const codificador = new TextEncoder();
      const partes = [];
      const central = [];
      let posicao = 0;
      const { hora, dia } = dataDos();
      for (const item of this.itens) {
        let bytes;
        if (typeof item.dados === "string") bytes = codificador.encode(item.dados);
        else if (item.dados instanceof Blob) bytes = new Uint8Array(await item.dados.arrayBuffer());
        else if (item.dados instanceof ArrayBuffer) bytes = new Uint8Array(item.dados);
        else bytes = item.dados;
        if (bytes.length >= 0xffffffff) throw new Error(`${item.nome} passa de 4 GB: grande demais para o ZIP simples.`);
        const nome = codificador.encode(item.nome);
        const crc = crc32(bytes);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // nomes em UTF-8
        local.setUint16(8, 0, true); // sem compressão
        local.setUint16(10, hora, true);
        local.setUint16(12, dia, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, bytes.length, true);
        local.setUint32(22, bytes.length, true);
        local.setUint16(26, nome.length, true);
        partes.push(local.buffer, nome, bytes);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, hora, true);
        c.setUint16(14, dia, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, bytes.length, true);
        c.setUint32(24, bytes.length, true);
        c.setUint16(28, nome.length, true);
        c.setUint32(42, posicao, true);
        central.push(c.buffer, nome);
        posicao += 30 + nome.length + bytes.length;
      }
      const tamanhoCentral = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
      const fim = new DataView(new ArrayBuffer(22));
      fim.setUint32(0, 0x06054b50, true);
      fim.setUint16(8, this.itens.length, true);
      fim.setUint16(10, this.itens.length, true);
      fim.setUint32(12, tamanhoCentral, true);
      fim.setUint32(16, posicao, true);
      return new Blob([...partes, ...central, fim.buffer], { type: "application/zip" });
    }

    /** Lê um .zip (Blob/ArrayBuffer) e devolve um Map nome → Blob. */
    static async ler(arquivo) {
      const buffer = arquivo instanceof Blob ? await arquivo.arrayBuffer() : arquivo;
      const v = new DataView(buffer);
      let fim = -1;
      for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
        if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
      }
      if (fim < 0) throw new Error("Este arquivo não é um ZIP (ou está corrompido).");
      const total = v.getUint16(fim + 10, true);
      let p = v.getUint32(fim + 16, true);
      const decodificador = new TextDecoder();
      const saida = new Map();
      for (let n = 0; n < total; n++) {
        if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP corrompido (índice).");
        const metodo = v.getUint16(p + 10, true);
        const comprimido = v.getUint32(p + 20, true);
        const tamNome = v.getUint16(p + 28, true), tamExtra = v.getUint16(p + 30, true), tamComentario = v.getUint16(p + 32, true);
        const local = v.getUint32(p + 42, true);
        const nome = decodificador.decode(new Uint8Array(buffer, p + 46, tamNome));
        p += 46 + tamNome + tamExtra + tamComentario;
        if (nome.endsWith("/")) continue;
        const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const bytes = new Uint8Array(buffer, inicio, comprimido);
        if (metodo === 0) saida.set(nome, new Blob([bytes]));
        else if (metodo === 8) {
          if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não sabe descompactar ZIP.");
          const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          saida.set(nome, await new Response(fluxo).blob());
        } else throw new Error(`${nome}: tipo de compressão não suportado (${metodo}).`);
      }
      return saida;
    }
  }

  window.LNUX = window.LNUX || {};
  window.LNUX.Zip = Zip;
  window.LNUX.crc32 = crc32;
})();
