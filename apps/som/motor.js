/*
 * Som — motor de áudio (Web Audio API).
 *
 * Cada trilha tem a mesma cadeia, tanto para tocar ao vivo quanto para exportar (OfflineAudioContext):
 *   clipes → entrada → EQ (graves, médios, agudos) → compressor → eco → reverb → pan → volume → mestre
 * O eco e o reverb são "inserções" com mistura: parte do som passa direto e parte passa pelo efeito.
 */
(function () {
  "use strict";

  const dbParaGanho = (db) => Math.pow(10, db / 20);
  const ganhoParaDb = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));

  /** Resposta ao impulso de uma sala (ruído que decai): é o "eco" que o reverb soma ao som. */
  const cacheImpulso = new Map();
  function impulso(ctx, segundos) {
    const chave = `${ctx.sampleRate}:${segundos.toFixed(2)}`;
    if (ctx instanceof AudioContext && cacheImpulso.has(chave)) return cacheImpulso.get(chave);
    const n = Math.max(1, Math.floor(ctx.sampleRate * segundos));
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    // Semente fixa: o mesmo projeto sempre soa igual (e a exportação bate com o que se ouve)
    let semente = 12345;
    const aleatorio = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = aleatorio() * Math.pow(1 - i / n, 2.6);
    }
    if (ctx instanceof AudioContext) cacheImpulso.set(chave, b);
    return b;
  }

  /** Parte do sinal vai direto e parte pelo efeito; devolve o nó de saída. */
  function insercao(ctx, entrada, efeitoEntrada, efeitoSaida) {
    const seco = ctx.createGain(), molhado = ctx.createGain(), saida = ctx.createGain();
    entrada.connect(seco).connect(saida);
    entrada.connect(efeitoEntrada);
    efeitoSaida.connect(molhado).connect(saida);
    return { seco, molhado, saida };
  }

  /** Monta a cadeia de uma trilha no contexto (ao vivo ou offline). */
  function montarTrilha(ctx, trilha, destino) {
    const n = {};
    n.entrada = ctx.createGain();
    n.graves = ctx.createBiquadFilter(); n.graves.type = "lowshelf"; n.graves.frequency.value = 220;
    n.medios = ctx.createBiquadFilter(); n.medios.type = "peaking"; n.medios.frequency.value = 1100; n.medios.Q.value = 0.9;
    n.agudos = ctx.createBiquadFilter(); n.agudos.type = "highshelf"; n.agudos.frequency.value = 4200;
    n.compressor = ctx.createDynamicsCompressor();
    n.compSeco = ctx.createGain(); n.compMolhado = ctx.createGain(); n.posComp = ctx.createGain();
    n.entrada.connect(n.graves).connect(n.medios).connect(n.agudos);
    n.agudos.connect(n.compSeco).connect(n.posComp);
    n.agudos.connect(n.compressor).connect(n.compMolhado).connect(n.posComp);
    // Eco: atraso com realimentação
    n.atraso = ctx.createDelay(4);
    n.retorno = ctx.createGain();
    n.atraso.connect(n.retorno).connect(n.atraso);
    n.eco = insercao(ctx, n.posComp, n.atraso, n.atraso);
    // Reverb
    n.convolver = ctx.createConvolver();
    n.reverb = insercao(ctx, n.eco.saida, n.convolver, n.convolver);
    n.pan = ctx.createStereoPanner();
    n.volume = ctx.createGain();
    n.medidor = ctx.createAnalyser(); n.medidor.fftSize = 1024;
    n.reverb.saida.connect(n.pan).connect(n.volume).connect(destino);
    n.volume.connect(n.medidor);
    n._tamanhoReverb = 0;
    aplicarTrilha(ctx, n, trilha, true);
    return n;
  }

  /** Atualiza os parâmetros de uma trilha já montada (dá para mexer enquanto toca). */
  function aplicarTrilha(ctx, n, t, audivel) {
    const agora = ctx.currentTime;
    const suave = (param, valor) => (ctx instanceof AudioContext ? param.setTargetAtTime(valor, agora, 0.015) : (param.value = valor));
    const e = t.efeitos;
    suave(n.graves.gain, e.eq.ligado ? e.eq.graves : 0);
    suave(n.medios.gain, e.eq.ligado ? e.eq.medios : 0);
    suave(n.agudos.gain, e.eq.ligado ? e.eq.agudos : 0);
    n.compressor.threshold.value = e.compressor.limiar;
    n.compressor.ratio.value = e.compressor.razao;
    n.compressor.attack.value = 0.006;
    n.compressor.release.value = 0.2;
    n.compressor.knee.value = 6;
    suave(n.compSeco.gain, e.compressor.ligado ? 0 : 1);
    // compensa um pouco o volume que o compressor tira
    suave(n.compMolhado.gain, e.compressor.ligado ? dbParaGanho(Math.min(12, -e.compressor.limiar * (1 - 1 / e.compressor.razao) * 0.5)) : 0);
    n.atraso.delayTime.value = e.eco.tempo;
    suave(n.retorno.gain, e.eco.retorno);
    suave(n.eco.seco.gain, 1);
    suave(n.eco.molhado.gain, e.eco.ligado ? e.eco.mistura : 0);
    if (e.reverb.ligado && n._tamanhoReverb !== e.reverb.tamanho) {
      n.convolver.buffer = impulso(ctx, e.reverb.tamanho);
      n._tamanhoReverb = e.reverb.tamanho;
    }
    suave(n.reverb.seco.gain, 1);
    suave(n.reverb.molhado.gain, e.reverb.ligado ? e.reverb.mistura : 0);
    suave(n.pan.pan, t.pan);
    suave(n.volume.gain, audivel ? dbParaGanho(t.volume) : 0);
  }

  // Todo clipe ganha um fade mínimo de 4 ms nas pontas: sem isso, um corte no meio da onda dá um estalo
  const FADE_MINIMO = 0.004;
  const fadeEntrada = (c) => Math.min(c.duracao / 2, Math.max(FADE_MINIMO, c.fadeIn || 0));
  const fadeSaida = (c) => Math.min(c.duracao / 2, Math.max(FADE_MINIMO, c.fadeOut || 0));

  /** Ganho de um clipe num instante da linha do tempo (fades de entrada e de saída). */
  function ganhoDoClipe(c, tempo) {
    const g = dbParaGanho(c.ganho || 0);
    const desde = tempo - c.inicio, ate = c.inicio + c.duracao - tempo;
    const f = Math.min(1, Math.max(0, desde / fadeEntrada(c)), Math.max(0, ate / fadeSaida(c)));
    return g * f;
  }

  /**
   * Agenda um clipe para tocar. "deProjeto" é o instante da linha do tempo que corresponde a "quandoCtx" no
   * relógio do áudio. Toca só o pedaço entre "deProjeto" e "ateProjeto".
   */
  function agendarClipe(ctx, clipe, buffer, entrada, deProjeto, quandoCtx, ateProjeto = Infinity) {
    const inicio = Math.max(clipe.inicio, deProjeto);
    const fim = Math.min(clipe.inicio + clipe.duracao, ateProjeto);
    if (fim <= inicio + 0.001) return null;
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    const ganho = ctx.createGain();
    fonte.connect(ganho).connect(entrada);
    const paraCtx = (t) => quandoCtx + (t - deProjeto);
    // Envelope: valor no começo e rampas até os pontos onde o fade muda
    const pontos = [inicio, fim, clipe.inicio + fadeEntrada(clipe), clipe.inicio + clipe.duracao - fadeSaida(clipe)];
    const ordenados = [...new Set(pontos.filter((p) => p >= inicio && p <= fim))].sort((a, b) => a - b);
    ganho.gain.setValueAtTime(ganhoDoClipe(clipe, inicio), paraCtx(inicio));
    for (const p of ordenados.slice(1)) ganho.gain.linearRampToValueAtTime(ganhoDoClipe(clipe, Math.min(p, fim - 1e-4)), paraCtx(p));
    const deslocamento = clipe.entrada + (inicio - clipe.inicio);
    fonte.start(Math.max(paraCtx(inicio), ctx.currentTime), Math.max(0, deslocamento), fim - inicio);
    return fonte;
  }

  /** Buffer invertido (para "tocar ao contrário"), guardado para não refazer sempre. */
  const cacheInvertidos = new WeakMap();
  function invertido(buffer) {
    if (cacheInvertidos.has(buffer)) return cacheInvertidos.get(buffer);
    const ctxTemp = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const b = ctxTemp.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const origem = buffer.getChannelData(c), dest = b.getChannelData(c);
      for (let i = 0, n = origem.length; i < n; i++) dest[i] = origem[n - 1 - i];
    }
    cacheInvertidos.set(buffer, b);
    return b;
  }

  class Motor {
    constructor() {
      this.ctx = null;
      this.buffers = new Map(); // id do áudio → AudioBuffer
      this.picos = new Map(); // id do áudio → {taxa, min, max}
      this.tocando = false;
      this.fontes = [];
      this.trilhas = new Map();
      this.metronomoLigado = false;
      this.aoTerminar = null;
    }

    garantirContexto() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
        this.mestre = this.ctx.createGain();
        this.medidorMestre = this.ctx.createAnalyser();
        this.medidorMestre.fftSize = 2048;
        this.mestre.connect(this.ctx.destination);
        this.mestre.connect(this.medidorMestre);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    async decodificar(arrayBuffer) {
      const ctx = this.garantirContexto();
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    /** Guarda um áudio decodificado e calcula os picos usados para desenhar a forma de onda. */
    registrar(id, buffer) {
      this.buffers.set(id, buffer);
      const taxa = Math.min(400, buffer.sampleRate); // picos por segundo
      const passo = Math.max(1, Math.floor(buffer.sampleRate / taxa));
      const n = Math.ceil(buffer.length / passo);
      const min = new Float32Array(n), max = new Float32Array(n);
      const canais = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      for (let i = 0; i < n; i++) {
        let mi = 1, ma = -1;
        const ini = i * passo, fim = Math.min(buffer.length, ini + passo);
        for (const d of canais) for (let j = ini; j < fim; j++) { const v = d[j]; if (v < mi) mi = v; if (v > ma) ma = v; }
        min[i] = mi; max[i] = ma;
      }
      this.picos.set(id, { taxa: buffer.sampleRate / passo, min, max });
    }

    pico(id) {
      const p = this.picos.get(id);
      if (!p) return 0;
      let m = 0;
      for (let i = 0; i < p.max.length; i++) m = Math.max(m, Math.abs(p.max[i]), Math.abs(p.min[i]));
      return m;
    }

    bufferDoClipe(c) {
      const b = this.buffers.get(c.audio);
      return b && c.reverso ? invertido(b) : b;
    }

    static audivel(projeto, t) {
      const algumSolo = projeto.trilhas.some((x) => x.solo);
      return !t.mudo && (!algumSolo || t.solo);
    }

    /** Começa a tocar o projeto a partir de "de" (segundos). Com loop, repete a região marcada. */
    tocar(projeto, de, { loop = null } = {}) {
      this.parar();
      const ctx = this.garantirContexto();
      this.tocando = true;
      this.projeto = projeto;
      this.loop = loop && loop.fim > loop.inicio + 0.05 ? loop : null;
      if (this.loop && (de < this.loop.inicio || de >= this.loop.fim)) de = this.loop.inicio;
      for (const t of projeto.trilhas) this.trilhas.set(t.id, montarTrilha(ctx, t, this.mestre));
      this.atualizarTrilhas(projeto);
      this.mestre.gain.value = dbParaGanho(projeto.volumeMestre || 0);
      this.inicioCtx = ctx.currentTime + 0.06;
      this.inicioProjeto = de;
      this._agendarTrecho(de, this.inicioCtx);
      this._proximaBatida = null;
      this._relogio = setInterval(() => this._vigiar(), 25);
    }

    _agendarTrecho(de, quandoCtx) {
      const fim = this.loop ? this.loop.fim : Infinity;
      for (const c of this.projeto.clipes) {
        const n = this.trilhas.get(c.trilha);
        const b = this.bufferDoClipe(c);
        if (!n || !b) continue;
        const f = agendarClipe(this.ctx, c, b, n.entrada, de, quandoCtx, fim);
        if (f) this.fontes.push(f);
      }
      this._fimDoTrecho = quandoCtx + ((this.loop ? this.loop.fim : duracaoDoProjeto(this.projeto)) - de);
    }

    _vigiar() {
      if (!this.tocando) return;
      const ctx = this.ctx;
      // Loop: agenda a próxima volta um pouco antes de a atual acabar
      if (this.loop && ctx.currentTime > this._fimDoTrecho - 0.2) {
        const volta = this._fimDoTrecho;
        this.inicioCtx = volta;
        this.inicioProjeto = this.loop.inicio;
        this._agendarTrecho(this.loop.inicio, volta);
      } else if (!this.loop && ctx.currentTime > this._fimDoTrecho + 0.1 && !this.gravando) {
        this.parar();
        this.aoTerminar && this.aoTerminar();
        return;
      }
      if (this.metronomoLigado) this._metronomo();
      // Fontes que já terminaram saem da lista
      if (this.fontes.length > 200) this.fontes = this.fontes.slice(-200);
    }

    _metronomo() {
      const ctx = this.ctx, p = this.projeto;
      const batida = 60 / p.bpm;
      const agora = this.tempo();
      if (this._proximaBatida === null || this._proximaBatida < agora - batida) this._proximaBatida = Math.ceil(agora / batida - 1e-6) * batida;
      while (this._proximaBatida < agora + 0.12) {
        const t = this._proximaBatida;
        const quando = this.inicioCtx + (t - this.inicioProjeto);
        if (quando >= ctx.currentTime) {
          const acento = Math.round(t / batida) % p.compasso === 0;
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = acento ? 1500 : 1000;
          g.gain.setValueAtTime(0.0001, quando);
          g.gain.exponentialRampToValueAtTime(acento ? 0.5 : 0.3, quando + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.05);
          o.connect(g).connect(ctx.destination); // fora do mestre: o metrônomo não entra na exportação
          o.start(quando);
          o.stop(quando + 0.06);
        }
        this._proximaBatida += batida;
      }
    }

    /** Instante atual da linha do tempo enquanto toca. */
    tempo() {
      if (!this.tocando) return null;
      const t = this.inicioProjeto + Math.max(0, this.ctx.currentTime - this.inicioCtx);
      return t;
    }

    atualizarTrilhas(projeto) {
      if (!this.tocando) return;
      for (const t of projeto.trilhas) {
        const n = this.trilhas.get(t.id);
        if (n) aplicarTrilha(this.ctx, n, t, Motor.audivel(projeto, t));
      }
      if (this.mestre) this.mestre.gain.setTargetAtTime(dbParaGanho(projeto.volumeMestre || 0), this.ctx.currentTime, 0.015);
    }

    parar() {
      clearInterval(this._relogio);
      for (const f of this.fontes) { try { f.stop(); } catch (e) { /* já parou */ } }
      this.fontes = [];
      for (const n of this.trilhas.values()) { try { n.volume.disconnect(); } catch (e) { /* ok */ } }
      this.trilhas.clear();
      this.tocando = false;
    }

    /** Nível (0..1) de pico e RMS de um analisador. */
    static nivel(analisador) {
      if (!analisador) return { pico: 0, rms: 0 };
      const d = new Float32Array(analisador.fftSize);
      analisador.getFloatTimeDomainData(d);
      let pico = 0, soma = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pico) pico = v; soma += d[i] * d[i]; }
      return { pico, rms: Math.sqrt(soma / d.length) };
    }

    /**
     * Mixa o projeto (ou um trecho, ou só algumas trilhas) num AudioBuffer, sem tocar: é a exportação.
     * soTrilhas: lista de ids (para exportar cada trilha separada).
     */
    async renderizar(projeto, { inicio = 0, fim = null, soTrilhas = null, taxa = 48000 } = {}) {
      fim = fim ?? duracaoDoProjeto(projeto);
      const duracao = Math.max(0.05, fim - inicio);
      const ctx = new OfflineAudioContext(2, Math.ceil(duracao * taxa), taxa);
      const mestre = ctx.createGain();
      mestre.gain.value = dbParaGanho(projeto.volumeMestre || 0);
      mestre.connect(ctx.destination);
      const nos = new Map();
      for (const t of projeto.trilhas) {
        if (soTrilhas && !soTrilhas.includes(t.id)) continue;
        const n = montarTrilha(ctx, t, mestre);
        aplicarTrilha(ctx, n, t, soTrilhas ? true : Motor.audivel(projeto, t));
        nos.set(t.id, n);
      }
      for (const c of projeto.clipes) {
        const n = nos.get(c.trilha);
        const b = this.bufferDoClipe(c);
        if (n && b) agendarClipe(ctx, c, b, n.entrada, inicio, 0, fim);
      }
      return ctx.startRendering();
    }
  }

  function duracaoDoProjeto(p) {
    return p.clipes.reduce((m, c) => Math.max(m, c.inicio + c.duracao), 0);
  }

  /** AudioBuffer → arquivo WAV (PCM 16 ou 24 bits). */
  function paraWav(buffer, bits = 16) {
    const canais = buffer.numberOfChannels, n = buffer.length, bytes = bits / 8;
    const tamanho = 44 + n * canais * bytes;
    const v = new DataView(new ArrayBuffer(tamanho));
    const texto = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    texto(0, "RIFF"); v.setUint32(4, tamanho - 8, true); texto(8, "WAVE");
    texto(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, canais, true);
    v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * canais * bytes, true);
    v.setUint16(32, canais * bytes, true); v.setUint16(34, bits, true);
    texto(36, "data"); v.setUint32(40, n * canais * bytes, true);
    const dados = Array.from({ length: canais }, (_, c) => buffer.getChannelData(c));
    let p = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < canais; c++) {
        const s = Math.max(-1, Math.min(1, dados[c][i]));
        if (bits === 16) { v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2; }
        else { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(p, x & 0xff); v.setUint8(p + 1, (x >> 8) & 0xff); v.setUint8(p + 2, (x >> 16) & 0xff); p += 3; }
      }
    }
    return new Blob([v.buffer], { type: "audio/wav" });
  }

  window.SomMotor = { Motor, paraWav, dbParaGanho, ganhoParaDb, duracaoDoProjeto, ganhoDoClipe };
})();
