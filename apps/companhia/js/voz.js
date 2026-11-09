/*
 * Companhia — voz: a personagem fala (TTS) e ouve (reconhecimento de fala do navegador).
 *
 * Geradores de voz:
 *   - navegador: a voz do sistema (speechSynthesis) — grátis;
 *   - ponte: a voz do aparelho pela ponte (termux-tts-speak / espeak) — sem a boca sincronizada;
 *   - ElevenLabs (api.elevenlabs.io): flash v2.5 (rápido e barato), multilingual v2, v3 (com marcas de emoção);
 *   - OpenAI TTS (gpt-4o-mini-tts recebe "instruções" de emoção);
 *   - VoiceStudio (https://github.com/debpalash/VoiceStudio, AGPL-3.0): roda no aparelho e tem uma API compatível
 *     com a da OpenAI em http://127.0.0.1:3900/v1 — a Companhia só conversa com essa API (não copia código dele);
 *   - outro servidor compatível com a OpenAI (Kokoro-FastAPI, openedai-speech...).
 *
 * A resposta é falada frase por frase: a próxima já vai sendo gerada enquanto a atual toca. A boca do modelo
 * acompanha o volume do áudio (um AnalyserNode). Frases curtas e repetidas ficam guardadas no navegador, para não
 * gastar créditos de novo.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});

  const PROVEDORES_VOZ = {
    navegador: { nome: "Voz do navegador (grátis)" },
    ponte: { nome: "Voz do aparelho, pela ponte (termux-tts-speak / espeak)" },
    elevenlabs: { nome: "ElevenLabs", url: "https://api.elevenlabs.io/v1", chave: "sim", modelos: ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v3"], site: "https://elevenlabs.io/app/settings/api-keys" },
    openai: { nome: "OpenAI TTS", url: "https://api.openai.com/v1", chave: "sim", modelos: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
      vozes: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] },
    voicestudio: { nome: "VoiceStudio (no aparelho)", url: "http://127.0.0.1:3900/v1", chave: "opcional", local: true, modelos: ["omnivoice", "voxcpm2", "cosyvoice", "kittentts"], site: "https://github.com/debpalash/VoiceStudio" },
    "voz-personalizada": { nome: "Outro compatível com OpenAI (Kokoro-FastAPI, openedai-speech...)", url: "http://127.0.0.1:8880/v1", chave: "opcional", local: true, modelos: ["kokoro", "tts-1"] },
  };
  C.PROVEDORES_VOZ = PROVEDORES_VOZ;

  const COMO_FALAR = {
    neutra: "natural e calma", feliz: "alegre e calorosa", rindo: "rindo, divertida", timida: "tímida, um pouco baixinho", triste: "triste, mais devagar",
    chorando: "chorosa, com a voz embargada", brava: "brava, mas de um jeito fofo", surpresa: "surpresa", assustada: "assustada, rápida", pensativa: "pensativa, calma",
    apaixonada: "doce e carinhosa", animada: "muito animada", sonolenta: "sonolenta, bocejando", provocadora: "provocadora e marota", confusa: "confusa, em dúvida",
  };
  /** Marcas de áudio do ElevenLabs v3 para algumas emoções. */
  const MARCAS_V3 = { rindo: "[laughs]", chorando: "[crying]", animada: "[excited]", provocadora: "[mischievously]", pensativa: "[curious]", sonolenta: "[sighs]", timida: "[shyly]" };
  /** Voz do navegador: tom e velocidade por emoção. */
  const AJUSTE_NAVEGADOR = { feliz: [1.05, 1.08], rindo: [1.08, 1.12], animada: [1.12, 1.15], triste: [0.9, 0.92], chorando: [0.88, 0.95], sonolenta: [0.85, 0.9],
    brava: [1.05, 0.95], surpresa: [1.08, 1.15], assustada: [1.15, 1.1], timida: [0.95, 1.08], apaixonada: [0.95, 1.05], provocadora: [1.0, 1.05] };

  const CONFIG_PADRAO = { provedor: "navegador", voz: "", modelo: "", url: "", velocidade: 1, tom: 1, volume: 1, falar: true, emocaoNaVoz: true, maxCaracteres: 600, guardar: true };

  const voz = { config: { ...CONFIG_PADRAO }, fila: [], tocando: null, aoNivel: null, aoComecar: null, aoTerminar: null, gerando: 0 };
  C.voz = voz;
  voz.carregar = () => { try { Object.assign(voz.config, JSON.parse(localStorage.getItem("companhia.voz") || "{}")); } catch (e) { /* padrão */ } return voz.config; };
  voz.salvar = () => localStorage.setItem("companhia.voz", JSON.stringify(voz.config));
  /** A configuração que vale: a geral, com o que a personagem tem de próprio por cima. */
  voz.efetiva = () => Object.assign({}, voz.config, (voz.daPersonagem || {}));

  // ── Áudio (para a boca acompanhar) ───────────────────────────────────

  let ctx = null, analisador = null, ganho = null;
  voz.audio = function () {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      analisador = ctx.createAnalyser();
      analisador.fftSize = 1024;
      ganho = ctx.createGain();
      ganho.connect(analisador);
      analisador.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };
  /** Chame num toque/clique da pessoa: os navegadores só deixam tocar som depois de um gesto. */
  voz.destravar = () => { try { voz.audio(); } catch (e) { /* sem áudio */ } };

  let rafNivel = 0;
  function medirNivel() {
    cancelAnimationFrame(rafNivel);
    const dados = new Float32Array(analisador.fftSize);
    const passo = () => {
      if (!voz.tocando || voz.tocando.tipo !== "audio") { if (voz.aoNivel) voz.aoNivel(0); return; }
      analisador.getFloatTimeDomainData(dados);
      let s = 0;
      for (let i = 0; i < dados.length; i++) s += dados[i] * dados[i];
      const rms = Math.sqrt(s / dados.length);
      if (voz.aoNivel) voz.aoNivel(Math.min(1, Math.max(0, (rms - 0.012) * 7)));
      rafNivel = requestAnimationFrame(passo);
    };
    passo();
  }

  // ── Gerar o áudio de uma frase ───────────────────────────────────────

  function hash(t) { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16) + t.length.toString(36); }
  async function doGuardado(chave) { try { return await LNUX.guardado.ler("companhia:voz:" + chave); } catch (e) { return null; } }
  async function guardar(chave, blob) {
    try {
      const indice = (await LNUX.guardado.ler("companhia:voz:indice")) || [];
      indice.push(chave);
      while (indice.length > 150) await LNUX.guardado.apagar("companhia:voz:" + indice.shift());
      await LNUX.guardado.gravar("companhia:voz:" + chave, blob);
      await LNUX.guardado.gravar("companhia:voz:indice", indice);
    } catch (e) { /* sem espaço: tudo bem */ }
  }

  /** Gera o áudio (Blob) de uma frase no provedor configurado. */
  voz.gerar = async function (texto, emocao, cfg = voz.efetiva(), sinal) {
    const p = PROVEDORES_VOZ[cfg.provedor];
    const url = (cfg.url || p.url || "").replace(/\/+$/, "");
    const chaveCache = hash([cfg.provedor, cfg.voz, cfg.modelo, cfg.velocidade, cfg.emocaoNaVoz ? emocao : "", texto].join("|"));
    if (cfg.guardar && texto.length <= 160) { const b = await doGuardado(chaveCache); if (b) return b; }
    let r;
    if (cfg.provedor === "elevenlabs") {
      if (!cfg.voz) throw new Error("Escolha a voz do ElevenLabs (Voz › Configurar › Listar vozes).");
      const modelo = cfg.modelo || "eleven_flash_v2_5";
      const intensa = ["rindo", "animada", "brava", "surpresa", "assustada", "chorando", "provocadora"].includes(emocao);
      const calma = ["triste", "sonolenta", "timida", "pensativa"].includes(emocao);
      const settings = { stability: cfg.emocaoNaVoz ? (intensa ? 0.3 : calma ? 0.6 : 0.45) : 0.5, similarity_boost: 0.75, style: cfg.emocaoNaVoz && intensa ? 0.55 : 0.2, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, cfg.velocidade || 1)) };
      if (/v3/.test(modelo)) settings.stability = [0, 0.5, 1].reduce((a, b) => (Math.abs(b - settings.stability) < Math.abs(a - settings.stability) ? b : a));
      const falado = /v3/.test(modelo) && cfg.emocaoNaVoz && MARCAS_V3[emocao] ? MARCAS_V3[emocao] + " " + texto : texto;
      r = await C.ia.transporte("elevenlabs", `${url}/text-to-speech/${encodeURIComponent(cfg.voz)}?output_format=mp3_44100_64`, {
        cab: { "content-type": "application/json", accept: "audio/mpeg" }, corpo: { text: falado, model_id: modelo, voice_settings: settings, language_code: /flash_v2_5|turbo_v2_5/.test(modelo) ? "pt" : undefined }, sinal });
    } else {
      // OpenAI, VoiceStudio e compatíveis: POST /audio/speech
      const id = cfg.provedor;
      const modelo = cfg.modelo || (p.modelos || [])[0] || "tts-1";
      const corpo = { model: modelo, input: texto, voice: cfg.voz || (id === "openai" ? "coral" : "default"), response_format: "mp3", speed: cfg.velocidade || 1 };
      if (cfg.emocaoNaVoz && (modelo === "gpt-4o-mini-tts" || id === "voicestudio")) corpo.instructions = `Fale em português do Brasil, com voz ${COMO_FALAR[emocao] || COMO_FALAR.neutra}.`;
      if (id === "voicestudio") corpo.language = "pt";
      r = await C.ia.transporte(id, url + "/audio/speech", { cab: { "content-type": "application/json" }, corpo, sinal, tipo: "openai" });
    }
    const blob = await r.blob();
    if (blob.size < 100) throw new Error("O gerador de voz devolveu um áudio vazio.");
    if (cfg.guardar && texto.length <= 160) guardar(chaveCache, blob);
    return blob;
  };

  /** Vozes disponíveis no provedor: [{id, nome, detalhe}]. */
  voz.listarVozes = async function (cfg = voz.efetiva()) {
    const p = PROVEDORES_VOZ[cfg.provedor];
    const url = (cfg.url || p.url || "").replace(/\/+$/, "");
    if (cfg.provedor === "navegador") {
      let vs = speechSynthesis.getVoices();
      if (!vs.length) { await new Promise((ok) => { speechSynthesis.onvoiceschanged = ok; setTimeout(ok, 1500); }); vs = speechSynthesis.getVoices(); }
      return vs.sort((a, b) => (b.lang.startsWith("pt") - a.lang.startsWith("pt")) || a.name.localeCompare(b.name)).map((v) => ({ id: v.name, nome: v.name, detalhe: v.lang + (v.localService ? "" : " · online") }));
    }
    if (cfg.provedor === "ponte") return [];
    if (cfg.provedor === "openai") return p.vozes.map((v) => ({ id: v, nome: v }));
    if (cfg.provedor === "elevenlabs") {
      const j = await (await C.ia.transporte("elevenlabs", url + "/voices", { metodo: "GET" })).json();
      return (j.voices || []).map((v) => ({ id: v.voice_id, nome: v.name, detalhe: [v.category, (v.labels || {}).gender, (v.labels || {}).accent].filter(Boolean).join(" · ") }));
    }
    const r = await C.ia.transporte(cfg.provedor, url + "/audio/voices", { metodo: "GET", tipo: "openai" });
    const j = await r.json();
    return (j.voices || j.data || j || []).map((v) => (typeof v === "string" ? { id: v, nome: v } : { id: v.voice_id || v.id || v.name, nome: v.name || v.id, detalhe: [v.type, v.language].filter(Boolean).join(" · ") }));
  };

  // ── Fila de falas ────────────────────────────────────────────────────

  /** Fala uma frase (entra na fila). */
  voz.falar = function (texto, emocao = "neutra") {
    const cfg = voz.efetiva();
    if (!cfg.falar || cfg.provedor === "desligada") return;
    texto = texto.replace(/[*_~`#>]/g, "").replace(/\s+/g, " ").trim();
    if (!texto) return;
    const item = { texto, emocao, cfg, controle: new AbortController() };
    voz.fila.push(item);
    if (!["navegador", "ponte"].includes(cfg.provedor)) adiantar();
    if (!voz.tocando) proxima();
  };
  // gera o áudio das próximas (até 2 ao mesmo tempo)
  function adiantar() {
    for (const item of voz.fila) {
      if (voz.gerando >= 2) break;
      if (item.audio) continue;
      voz.gerando++;
      item.audio = voz.gerar(item.texto, item.emocao, item.cfg, item.controle.signal).finally(() => { voz.gerando--; adiantar(); });
      item.audio.catch(() => {});
    }
  }
  async function proxima() {
    const item = voz.fila.shift();
    if (!item) { voz.tocando = null; if (voz.aoNivel) voz.aoNivel(0); if (voz.aoTerminar) voz.aoTerminar(); return; }
    voz.tocando = { tipo: "esperando", item };
    if (voz.aoComecar) voz.aoComecar(item);
    try {
      if (item.cfg.provedor === "navegador") await tocarNavegador(item);
      else if (item.cfg.provedor === "ponte") await tocarPonte(item);
      else await tocarAudio(item);
    } catch (e) {
      if (e.name !== "AbortError") {
        console.warn(e);
        if (voz.aoErro) voz.aoErro(e, item);
        // se o gerador falhar, a voz do navegador fala no lugar (para a conversa não ficar muda)
        if (item.cfg.provedor !== "navegador" && "speechSynthesis" in window) { try { await tocarNavegador({ ...item, cfg: { ...item.cfg, voz: "" } }); } catch (err) { /* nada */ } }
      }
    }
    if (voz.tocando && voz.tocando.item === item) proxima();
  }
  async function tocarAudio(item) {
    if (!item.audio) { voz.gerando++; item.audio = voz.gerar(item.texto, item.emocao, item.cfg, item.controle.signal).finally(() => { voz.gerando--; }); }
    const blob = await item.audio;
    const ac = voz.audio();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    if (!voz.tocando || voz.tocando.item !== item) return;
    await new Promise((ok) => {
      const fonte = ac.createBufferSource();
      fonte.buffer = buf;
      const vol = ac.createGain();
      vol.gain.value = item.cfg.volume ?? 1;
      fonte.connect(vol); vol.connect(ganho);
      fonte.onended = ok;
      voz.tocando = { tipo: "audio", item, fonte, fim: ok };
      fonte.start();
      medirNivel();
    });
  }
  function tocarNavegador(item) {
    return new Promise((ok, falhou) => {
      if (!("speechSynthesis" in window)) { falhou(new Error("Este navegador não tem voz.")); return; }
      const u = new SpeechSynthesisUtterance(item.texto);
      u.lang = "pt-BR";
      const v = speechSynthesis.getVoices().find((x) => x.name === item.cfg.voz) || speechSynthesis.getVoices().find((x) => x.lang.replace("_", "-").startsWith("pt-BR")) || null;
      if (v) u.voice = v;
      const [vel, tom] = item.cfg.emocaoNaVoz ? (AJUSTE_NAVEGADOR[item.emocao] || [1, 1]) : [1, 1];
      u.rate = (item.cfg.velocidade || 1) * vel;
      u.pitch = Math.min(2, (item.cfg.tom || 1) * tom);
      u.volume = item.cfg.volume ?? 1;
      // sem acesso ao som, a boca "fala" num ritmo, com pulos a cada palavra
      let pulso = 0, raf = 0;
      const t0 = performance.now();
      const boca = () => { const t = (performance.now() - t0) / 1000; const n = 0.25 + 0.35 * Math.abs(Math.sin(t * 13)) + pulso; pulso *= 0.85; if (voz.aoNivel) voz.aoNivel(Math.min(1, n)); raf = requestAnimationFrame(boca); };
      u.onstart = () => boca();
      u.onboundary = () => { pulso = 0.35; };
      const fim = () => { cancelAnimationFrame(raf); if (voz.aoNivel) voz.aoNivel(0); ok(); };
      u.onend = fim;
      u.onerror = (e) => { cancelAnimationFrame(raf); if (voz.aoNivel) voz.aoNivel(0); if (e.error === "interrupted" || e.error === "canceled") ok(); else falhou(new Error("A voz do navegador falhou: " + e.error)); };
      voz.tocando = { tipo: "navegador", item, fim };
      speechSynthesis.speak(u);
    });
  }
  async function tocarPonte(item) {
    await LNUX.ponte.falar(item.texto);
    // a ponte não diz quando termina: a boca mexe pelo tempo estimado da frase
    const dur = Math.max(800, item.texto.length * 65);
    const t0 = performance.now();
    await new Promise((ok) => {
      const passo = () => {
        const t = performance.now() - t0;
        if (t > dur || !voz.tocando || voz.tocando.item !== item) { if (voz.aoNivel) voz.aoNivel(0); ok(); return; }
        if (voz.aoNivel) voz.aoNivel(0.3 + 0.35 * Math.abs(Math.sin(t / 75)));
        requestAnimationFrame(passo);
      };
      voz.tocando = { tipo: "ponte", item, fim: ok };
      passo();
    });
  }
  /** Para de falar e esvazia a fila. */
  voz.parar = function () {
    for (const item of voz.fila) item.controle.abort();
    voz.fila = [];
    const t = voz.tocando;
    voz.tocando = null;
    if (t) {
      t.item.controle.abort();
      if (t.fonte) { try { t.fonte.stop(); } catch (e) { /* já parou */ } }
      if (t.fim) t.fim();
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (voz.aoNivel) voz.aoNivel(0);
  };
  voz.falando = () => !!voz.tocando || voz.fila.length > 0;

  // ── Ouvir (reconhecimento de fala do navegador) ──────────────────────

  voz.podeOuvir = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  /**
   * Ouve uma fala. aoParcial(texto) enquanto a pessoa fala; aoFinal(texto) quando termina. Devolve parar().
   * No Chrome o reconhecimento usa a internet (servidor do Google); no Safari pode ser no aparelho.
   */
  voz.ouvir = function ({ aoParcial, aoFinal, aoFim, aoErro, idioma = "pt-BR" } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("Este navegador não reconhece fala. Use o Chrome, o Edge ou o Safari — ou digite.");
    const r = new SR();
    r.lang = idioma;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let final = "";
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript; else parcial += e.results[i][0].transcript;
      }
      if (aoParcial) aoParcial((final + " " + parcial).trim());
    };
    r.onerror = (e) => { if (aoErro && e.error !== "no-speech" && e.error !== "aborted") aoErro(new Error(e.error === "not-allowed" ? "O navegador não deixou usar o microfone." : "Reconhecimento de fala: " + e.error)); };
    r.onend = () => { if (final.trim() && aoFinal) aoFinal(final.trim()); if (aoFim) aoFim(); };
    r.start();
    return () => { try { r.stop(); } catch (e) { /* já parou */ } };
  };
})();
