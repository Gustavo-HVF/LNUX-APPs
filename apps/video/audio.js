/*
 * Vídeo — motor de áudio (Web Audio).
 *
 *   elemento do clipe → efeitos do clipe → volume e panorama do clipe (animáveis, com os fades cruzados)
 *     → trilha (volume, panorama, mudo/solo, medidor) → mestre → alto-falante e gravação da exportação
 *
 * O mestre tem os medidores de loudness do padrão EBU R128 / ITU-R BS.1770: o sinal passa pela ponderação K
 * (um "shelf" de +4 dB em 1,7 kHz e um passa-alta em 38 Hz) e a energia vira LUFS: Momentâneo (400 ms), Curto
 * (3 s) e Integrado (com as portas de -70 LUFS e de -10 LU), mais o pico (dBFS) de cada canal.
 * A mesma cadeia de efeitos é montada num OfflineAudioContext para exportar só o áudio, sem tocar.
 */
(function () {
  "use strict";
  const V = (window.V = window.V || {});
  const db = (x) => Math.pow(10, x / 20);
  /** Força o nó a sair em estéreo (um som mono vira igual nos dois lados). Sem isso, o panorama do Web Audio
   *  baixa 3 dB de cada lado de um som mono, e o medidor só veria o canal esquerdo. */
  function estereo(no) { no.channelCount = 2; no.channelCountMode = "explicit"; no.channelInterpretation = "speakers"; return no; }

  /** Janela em que o clipe soa/aparece, contando as transições (o que sai continua tocando por baixo). */
  function janelaDoClipe(projeto, c) {
    let de = c.inicio, ate = V.fim(c);
    for (const tr of projeto.transicoes || []) {
      if (tr.a === c.id && tr.b) ate = Math.max(ate, V.fim(c) + tr.duracao / 2);
      if (tr.b === c.id && tr.a) de = Math.min(de, c.inicio - tr.duracao / 2);
    }
    return [de, ate];
  }

  /** Fator de volume das transições de áudio (fade cruzado) e dos fades de um lado só. */
  function fatorTransicao(projeto, c, t) {
    let f = 1;
    for (const tr of projeto.transicoes || []) {
      if (tr.a !== c.id && tr.b !== c.id) continue;
      const a = tr.a && projeto.clipes.find((x) => x.id === tr.a), b = tr.b && projeto.clipes.find((x) => x.id === tr.b);
      let de, ate;
      if (a && b) { de = b.inicio - tr.duracao / 2; ate = b.inicio + tr.duracao / 2; }
      else if (b) { de = b.inicio; ate = b.inicio + tr.duracao; }
      else if (a) { de = V.fim(a) - tr.duracao; ate = V.fim(a); }
      else continue;
      if (t < de || t > ate) continue;
      let p = (t - de) / Math.max(1e-6, ate - de);
      const entrando = tr.b === c.id && !(a && !b);
      if (!entrando) p = 1 - p; // o que sai vai do 1 ao 0
      const potencia = tr.tipo !== "ganho";
      f *= potencia ? Math.sin((p * Math.PI) / 2) : p;
    }
    return f;
  }

  /** Resposta ao impulso de uma sala (ruído que decai), com semente fixa. */
  function impulso(ctx, segundos) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * segundos));
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    let s = 12345;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = r() * Math.pow(1 - i / n, 2.6); }
    return b;
  }

  /**
   * Monta a cadeia de efeitos de áudio de um clipe. Devolve {entrada, saida, atualizar(params por efeito)}.
   * Funciona igual em AudioContext e OfflineAudioContext.
   */
  function montarCadeia(ctx, efeitos) {
    const entrada = ctx.createGain();
    let atual = entrada;
    const blocos = [];
    const mix = (efeitoEntrada, efeitoSaida) => { // seco + molhado
      const seco = ctx.createGain(), molhado = ctx.createGain(), saida = ctx.createGain();
      atual.connect(seco).connect(saida);
      atual.connect(efeitoEntrada);
      efeitoSaida.connect(molhado).connect(saida);
      atual = saida;
      return { seco, molhado };
    };
    for (const fx of efeitos) {
      const b = { uid: fx.uid, id: fx.id, nos: {} };
      const n = b.nos;
      switch (fx.id) {
        case "ganho": n.g = ctx.createGain(); atual.connect(n.g); atual = n.g; break;
        case "eq":
          n.graves = ctx.createBiquadFilter(); n.graves.type = "lowshelf";
          n.medios = ctx.createBiquadFilter(); n.medios.type = "peaking";
          n.agudos = ctx.createBiquadFilter(); n.agudos.type = "highshelf";
          atual.connect(n.graves).connect(n.medios).connect(n.agudos); atual = n.agudos; break;
        case "passa-alta": case "passa-baixa":
          n.f = ctx.createBiquadFilter(); n.f.type = fx.id === "passa-alta" ? "highpass" : "lowpass"; n.f.Q.value = 0.707;
          atual.connect(n.f); atual = n.f; break;
        case "zumbido":
          n.notches = [];
          for (let k = 0; k < 6; k++) { const f = ctx.createBiquadFilter(); f.type = "notch"; f.Q.value = 30; atual.connect(f); atual = f; n.notches.push(f); }
          break;
        case "voz":
          n.hp = ctx.createBiquadFilter(); n.hp.type = "highpass"; n.hp.frequency.value = 85;
          n.presenca = ctx.createBiquadFilter(); n.presenca.type = "peaking"; n.presenca.frequency.value = 3200; n.presenca.Q.value = 0.9;
          n.lama = ctx.createBiquadFilter(); n.lama.type = "peaking"; n.lama.frequency.value = 280; n.lama.Q.value = 1.1;
          n.comp = ctx.createDynamicsCompressor(); n.ganho = ctx.createGain();
          atual.connect(n.hp).connect(n.lama).connect(n.presenca).connect(n.comp).connect(n.ganho); atual = n.ganho; break;
        case "compressor": case "limitador":
          n.comp = ctx.createDynamicsCompressor(); n.ganho = ctx.createGain();
          atual.connect(n.comp).connect(n.ganho); atual = n.ganho; break;
        case "eco":
          n.atraso = ctx.createDelay(3); n.retorno = ctx.createGain();
          n.atraso.connect(n.retorno).connect(n.atraso);
          n.mix = mix(n.atraso, n.atraso); break;
        case "reverb":
          n.conv = ctx.createConvolver(); n.mix = mix(n.conv, n.conv); n.tamanho = 0; break;
        case "mono":
          n.g = ctx.createGain(); n.g.channelCount = 1; n.g.channelCountMode = "explicit"; n.g.channelInterpretation = "speakers";
          atual.connect(n.g); atual = n.g; break;
        default: continue;
      }
      blocos.push(b);
    }
    const saida = atual;
    function atualizar(paramsPorUid, ativos) {
      for (const b of blocos) {
        const p = paramsPorUid[b.uid] || {};
        const ligado = ativos ? ativos.has(b.uid) : true;
        const n = b.nos;
        switch (b.id) {
          case "ganho": n.g.gain.value = ligado ? db(p.db || 0) : 1; break;
          case "eq":
            n.graves.frequency.value = p.fGraves; n.graves.gain.value = ligado ? p.graves : 0;
            n.medios.frequency.value = p.fMedios; n.medios.Q.value = p.q; n.medios.gain.value = ligado ? p.medios : 0;
            n.agudos.frequency.value = p.fAgudos; n.agudos.gain.value = ligado ? p.agudos : 0; break;
          case "passa-alta": n.f.frequency.value = ligado ? p.freq : 1; break;
          case "passa-baixa": n.f.frequency.value = ligado ? p.freq : Math.min(22000, ctx.sampleRate / 2 - 100); break;
          case "zumbido": n.notches.forEach((f, k) => { const freq = (+p.rede || 60) * (k + 1); f.frequency.value = ligado && k < (p.harmonicos || 4) ? freq : 1; f.Q.value = ligado && k < (p.harmonicos || 4) ? 30 : 0.0001; }); break;
          case "voz": { const q = ligado ? (p.quantidade || 0) / 100 : 0; n.presenca.gain.value = 5 * q; n.lama.gain.value = -4 * q; n.hp.frequency.value = ligado ? 85 : 1;
            n.comp.threshold.value = -12 - 18 * q; n.comp.ratio.value = 1 + 3 * q; n.ganho.gain.value = db(4 * q); break; }
          case "compressor": n.comp.threshold.value = ligado ? p.limiar : 0; n.comp.ratio.value = ligado ? p.razao : 1;
            n.comp.attack.value = p.ataque / 1000; n.comp.release.value = p.liberacao / 1000; n.comp.knee.value = 6; n.ganho.gain.value = ligado ? db(p.ganho) : 1; break;
          case "limitador": n.comp.threshold.value = ligado ? p.teto : 0; n.comp.ratio.value = ligado ? 20 : 1; n.comp.knee.value = 0;
            n.comp.attack.value = 0.002; n.comp.release.value = 0.06; n.ganho.gain.value = 1; break;
          case "eco": n.atraso.delayTime.value = (p.tempo || 300) / 1000; n.retorno.gain.value = (p.retorno || 0) / 100;
            n.mix.molhado.gain.value = ligado ? (p.mistura || 0) / 100 : 0; break;
          case "reverb":
            if (ligado && n.tamanho !== p.tamanho) { n.conv.buffer = impulso(ctx, p.tamanho || 2); n.tamanho = p.tamanho; }
            n.mix.molhado.gain.value = ligado ? (p.mistura || 0) / 100 : 0; break;
          case "mono": n.g.channelCount = ligado ? 1 : 2; break;
        }
      }
    }
    return { entrada, saida, atualizar, assinatura: efeitos.map((f) => f.id + ":" + f.uid).join(",") };
  }

  /** Parâmetros (no instante) e quais efeitos de áudio estão ligados. */
  function paramsDeAudio(c, tLocal) {
    const params = {}, ativos = new Set();
    for (const fx of c.efeitos || []) if (fx.audio) { params[fx.uid] = V.paramsNoTempo(c, fx, tLocal); if (fx.ativo) ativos.add(fx.uid); }
    return { params, ativos };
  }

  class Audio {
    constructor() {
      this.ctx = null;
      this.clipes = new Map(); // id → {el, fonte, cadeia, ganho, pan}
      this.trilhas = new Map(); // id → {entrada, volume, pan, medidor}
      this.loud = { blocos: [], curtos: [], ultimoBloco: 0, pico: [-Infinity, -Infinity], integradoBlocos: [] };
    }

    garantir() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return this.ctx; }
      const A = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new A());
      this.mestre = estereo(ctx.createGain());
      this.mestre.connect(ctx.destination);
      this.gravacao = ctx.createMediaStreamDestination();
      this.mestre.connect(this.gravacao);
      // medidores: pico de cada canal e loudness (ponderação K)
      const divisor = ctx.createChannelSplitter(2);
      this.mestre.connect(divisor);
      this.picoCanais = [0, 1].map((ch) => { const a = ctx.createAnalyser(); a.fftSize = 2048; divisor.connect(a, ch); return a; });
      this.kCanais = [0, 1].map((ch) => {
        const shelf = ctx.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 1681.97; shelf.gain.value = 4;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 38.14; hp.Q.value = 0.5;
        const a = ctx.createAnalyser(); a.fftSize = 32768;
        divisor.connect(shelf, ch); shelf.connect(hp).connect(a);
        return a;
      });
      this.bufK = new Float32Array(32768);
      this.bufPico = new Float32Array(2048);
      return ctx;
    }

    trilha(id) {
      let t = this.trilhas.get(id);
      if (t) return t;
      const ctx = this.garantir();
      t = { entrada: ctx.createGain(), volume: ctx.createGain(), pan: ctx.createStereoPanner(), medidor: ctx.createAnalyser() };
      t.medidor.fftSize = 2048;
      t.entrada.connect(t.volume).connect(t.pan).connect(this.mestre);
      t.pan.connect(t.medidor);
      this.trilhas.set(id, t);
      return t;
    }

    /** Liga o elemento de um clipe ao áudio (uma vez por elemento) e (re)monta a cadeia se os efeitos mudaram. */
    ligar(c, el) {
      const ctx = this.garantir();
      let x = this.clipes.get(c.id);
      if (x && x.el !== el) { this.soltar(c.id); x = null; }
      if (!x) {
        let fonte;
        try { fonte = ctx.createMediaElementSource(el); } catch (e) { return null; }
        x = { el, fonte, ganho: estereo(ctx.createGain()), pan: ctx.createStereoPanner(), cadeia: null, trilha: null };
        x.ganho.connect(x.pan);
        this.clipes.set(c.id, x);
      }
      const efeitos = (c.efeitos || []).filter((f) => f.audio);
      const assinatura = efeitos.map((f) => f.id + ":" + f.uid).join(",");
      if (!x.cadeia || x.cadeia.assinatura !== assinatura) {
        try { x.fonte.disconnect(); } catch (e) { /* ok */ }
        if (x.cadeia) { try { x.cadeia.saida.disconnect(); } catch (e) { /* ok */ } }
        x.cadeia = montarCadeia(ctx, efeitos);
        x.fonte.connect(x.cadeia.entrada);
        x.cadeia.saida.connect(x.ganho);
      }
      if (x.trilha !== c.trilha) {
        try { x.pan.disconnect(); } catch (e) { /* ok */ }
        x.pan.connect(this.trilha(c.trilha).entrada);
        x.trilha = c.trilha;
      }
      return x;
    }
    soltar(id) {
      const x = this.clipes.get(id);
      if (!x) return;
      try { x.fonte.disconnect(); x.pan.disconnect(); } catch (e) { /* ok */ }
      this.clipes.delete(id);
    }

    /** Ajusta volumes e efeitos de cada clipe no instante t (chamado a cada quadro). */
    atualizar(projeto, t) {
      if (!this.ctx) return;
      const algumSolo = projeto.trilhas.some((x) => x.tipo === "audio" && x.solo);
      for (const tr of projeto.trilhas) {
        if (tr.tipo !== "audio") continue;
        const n = this.trilha(tr.id);
        const audivel = !tr.mudo && (!algumSolo || tr.solo);
        n.volume.gain.setTargetAtTime(audivel ? db(tr.volume || 0) : 0, this.ctx.currentTime, 0.01);
        n.pan.pan.setTargetAtTime((tr.pan || 0) / 100, this.ctx.currentTime, 0.01);
      }
      this.mestre.gain.setTargetAtTime(db(projeto.volumeMestre || 0), this.ctx.currentTime, 0.01);
      for (const [id, x] of this.clipes) {
        const c = projeto.clipes.find((k) => k.id === id);
        if (!c) { this.soltar(id); continue; }
        const tLocal = t - c.inicio;
        const nivel = V.valor(c, "audio.nivel", tLocal) ?? 0;
        const ganho = c.mudo ? 0 : db(nivel) * fatorTransicao(projeto, c, t);
        x.ganho.gain.setTargetAtTime(ganho, this.ctx.currentTime, 0.008);
        x.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (V.valor(c, "audio.pan", tLocal) || 0) / 100)), this.ctx.currentTime, 0.01);
        const { params, ativos } = paramsDeAudio(c, tLocal);
        x.cadeia.atualizar(params, ativos);
      }
    }

    /** Níveis: pico de cada canal do mestre (dBFS), por trilha (0..1) e loudness (LUFS). */
    medir(projeto, tocando) {
      if (!this.ctx) return null;
      const pico = this.picoCanais.map((a) => { a.getFloatTimeDomainData(this.bufPico); let m = 0; for (const v of this.bufPico) m = Math.max(m, Math.abs(v)); return m; });
      const trilhas = {};
      for (const [id, n] of this.trilhas) { n.medidor.getFloatTimeDomainData(this.bufPico); let m = 0; for (const v of this.bufPico) m = Math.max(m, Math.abs(v)); trilhas[id] = m; }
      const L = this.loud;
      const agora = this.ctx.currentTime;
      if (tocando && agora - L.ultimoBloco >= 0.1) {
        L.ultimoBloco = agora;
        const taxa = this.ctx.sampleRate;
        const n400 = Math.min(32768, Math.round(taxa * 0.4)), n100 = Math.round(taxa * 0.1);
        let e400 = 0, e100 = 0;
        for (const a of this.kCanais) {
          a.getFloatTimeDomainData(this.bufK);
          let s4 = 0, s1 = 0;
          for (let i = 32768 - n400; i < 32768; i++) { const v = this.bufK[i] * this.bufK[i]; s4 += v; if (i >= 32768 - n100) s1 += v; }
          e400 += s4 / n400; e100 += s1 / n100;
        }
        const lufs = (e) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);
        L.momentaneo = lufs(e400);
        L.curtos.push(e100);
        if (L.curtos.length > 30) L.curtos.shift();
        L.curto = lufs(L.curtos.reduce((s, x) => s + x, 0) / L.curtos.length);
        if (L.momentaneo > -70) L.integradoBlocos.push(e400);
        if (L.integradoBlocos.length) {
          const media = L.integradoBlocos.reduce((s, x) => s + x, 0) / L.integradoBlocos.length;
          const limiar = lufs(media) - 10;
          const validos = L.integradoBlocos.filter((e) => lufs(e) > limiar);
          L.integrado = validos.length ? lufs(validos.reduce((s, x) => s + x, 0) / validos.length) : -Infinity;
        }
        L.pico = L.pico.map((p, i) => Math.max(p, 20 * Math.log10(Math.max(1e-9, pico[i]))));
      }
      return { pico, trilhas, momentaneo: L.momentaneo, curto: L.curto, integrado: L.integrado, picoMax: Math.max(...L.pico) };
    }
    zerarLoudness() { this.loud = { blocos: [], curtos: [], ultimoBloco: 0, pico: [-Infinity, -Infinity], integradoBlocos: [] }; }

    /**
     * Mixa o áudio do projeto (de "de" até "ate") sem tocar. buffers: Map id da mídia → AudioBuffer já decodificado.
     */
    async renderizarOffline(projeto, de, ate, buffers, taxa = 48000) {
      const dur = Math.max(0.05, ate - de);
      const ctx = new OfflineAudioContext(2, Math.ceil(dur * taxa), taxa);
      const mestre = ctx.createGain();
      mestre.gain.value = db(projeto.volumeMestre || 0);
      mestre.connect(ctx.destination);
      const algumSolo = projeto.trilhas.some((x) => x.tipo === "audio" && x.solo);
      const nosTrilha = new Map();
      for (const tr of projeto.trilhas) {
        if (tr.tipo !== "audio") continue;
        const vol = ctx.createGain(), pan = ctx.createStereoPanner();
        vol.gain.value = !tr.mudo && (!algumSolo || tr.solo) ? db(tr.volume || 0) : 0;
        pan.pan.value = (tr.pan || 0) / 100;
        vol.connect(pan).connect(mestre);
        nosTrilha.set(tr.id, vol);
      }
      for (const c of projeto.clipes) {
        const destino = nosTrilha.get(c.trilha);
        const buffer = c.tipo === "midia" && buffers.get(c.midia);
        if (!destino || !buffer || c.mudo) continue;
        const [ja, jb] = janelaDoClipe(projeto, c);
        const ini = Math.max(ja, de), fim = Math.min(jb, ate);
        if (fim <= ini) continue;
        const fonte = ctx.createBufferSource();
        fonte.buffer = buffer;
        fonte.playbackRate.value = c.velocidade || 1;
        const cadeia = montarCadeia(ctx, (c.efeitos || []).filter((f) => f.audio));
        const ganho = estereo(ctx.createGain()), pan = ctx.createStereoPanner();
        fonte.connect(cadeia.entrada); cadeia.saida.connect(ganho).connect(pan).connect(destino);
        const { params, ativos } = paramsDeAudio(c, ini - c.inicio);
        cadeia.atualizar(params, ativos);
        // volume e panorama animados: um ponto a cada 20 ms
        ganho.gain.setValueAtTime(db(V.valor(c, "audio.nivel", ini - c.inicio) ?? 0) * fatorTransicao(projeto, c, ini), Math.max(0, ini - de));
        for (let t = ini; t <= fim + 1e-6; t += 0.02) {
          const tl = t - c.inicio;
          const g = db(V.valor(c, "audio.nivel", tl) ?? 0) * fatorTransicao(projeto, c, t);
          ganho.gain.linearRampToValueAtTime(g, t - de);
          pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, (V.valor(c, "audio.pan", tl) || 0) / 100)), t - de);
        }
        const offset = Math.max(0, c.entrada + (ini - c.inicio) * (c.velocidade || 1));
        if (offset >= buffer.duration) continue;
        fonte.start(ini - de, offset);
        fonte.stop(fim - de);
      }
      return ctx.startRendering();
    }
  }

  /** AudioBuffer → WAV 16 bits. */
  function paraWav(buffer) {
    const canais = buffer.numberOfChannels, n = buffer.length;
    const v = new DataView(new ArrayBuffer(44 + n * canais * 2));
    const txt = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    txt(0, "RIFF"); v.setUint32(4, 36 + n * canais * 2, true); txt(8, "WAVE"); txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, canais, true); v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * canais * 2, true); v.setUint16(32, canais * 2, true);
    v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, n * canais * 2, true);
    const dados = Array.from({ length: canais }, (_, c) => buffer.getChannelData(c));
    let p = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < canais; c++) { const s = Math.max(-1, Math.min(1, dados[c][i])); v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2; }
    return new Blob([v.buffer], { type: "audio/wav" });
  }

  Object.assign(V, { Audio, montarCadeia, janelaDoClipe, fatorTransicao, paraWav, db });
})();
