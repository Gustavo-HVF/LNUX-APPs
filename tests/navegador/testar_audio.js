// Teste do motor de áudio do Vídeo (apps/video/audio.js) no Chromium. Rode com: python3 tests/testar_navegador.py audio
const { chromium } = require("playwright");
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8124";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const pagina = await navegador.newPage();
  const consola = [];
  pagina.on("pageerror", (e) => consola.push(e.message));
  await pagina.goto(BASE + "/apps.json");
  await pagina.setContent(`<script src="${BASE}/apps/video/catalogo.js"></script><script src="${BASE}/apps/video/edicao.js"></script><script src="${BASE}/apps/video/audio.js"></script>`);
  await pagina.waitForFunction(() => window.V && V.Audio);
  const r = await pagina.evaluate(async () => {
    const s = {};
    const taxa = 48000;
    const tom = (seg, amp, freq = 1000) => { const c = new OfflineAudioContext(1, seg * taxa, taxa); const b = c.createBuffer(1, seg * taxa, taxa); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / taxa); return b; };
    const clipe = (extra) => Object.assign({ tipo: "midia", midia: "m", trilha: "A1", inicio: 0, entrada: 0, duracao: 2, velocidade: 1, audio: { nivel: 0, pan: 0 }, efeitos: [], anim: {} }, extra);
    const projeto = (clipes, extra = {}) => Object.assign({ midias: { m: { tipo: "audio", duracao: 4 } }, trilhas: [{ id: "A1", tipo: "audio", volume: 0, pan: 0 }], clipes, transicoes: [] }, extra);
    const A = new V.Audio();
    const buffers = new Map([["m", tom(4, 0.5)]]);
    const rms = (buf, de, ate) => { const d = buf.getChannelData(0); let q = 0, n = 0; for (let i = Math.floor(de * taxa); i < Math.floor(ate * taxa); i++) { q += d[i] * d[i]; n++; } return Math.sqrt(q / n); };
    // 1) volume -6 dB
    let out = await A.renderizarOffline(projeto([clipe({ id: "a", audio: { nivel: -6, pan: 0 } })]), 0, 2, buffers);
    s.menos6 = 20 * Math.log10(rms(out, 0.5, 1.5) / (0.5 / Math.SQRT2));
    // 2) volume animado: de -40 dB a 0 dB
    const anim = clipe({ id: "b" }); anim.anim = { "audio.nivel": [{ t: 0, v: -40, i: "linear" }, { t: 2, v: 0, i: "linear" }] };
    out = await A.renderizarOffline(projeto([anim]), 0, 2, buffers);
    s.comeco = rms(out, 0.05, 0.25); s.fim = rms(out, 1.75, 1.95);
    // 3) fade cruzado entre dois clipes (potência constante): no corte, cada um a ~70%
    const a = clipe({ id: "A", duracao: 2 }), b = clipe({ id: "B", inicio: 2, entrada: 2 });
    out = await A.renderizarOffline(projeto([a, b], { transicoes: [{ id: "t", trilha: "A1", a: "A", b: "B", tipo: "potencia", duracao: 1 }] }), 0, 4, buffers);
    s.cruzado = rms(out, 1.95, 2.05) / (0.5 / Math.SQRT2);
    out = await A.renderizarOffline(projeto([a, b], { transicoes: [{ id: "t", trilha: "A1", a: "A", b: "B", tipo: "ganho", duracao: 1 }] }), 0, 4, buffers);
    s.cruzadoGanho = rms(out, 1.95, 2.05) / (0.5 / Math.SQRT2);
    // 4) passa-alta em 5 kHz tira quase todo um tom de 1 kHz
    const pa = clipe({ id: "c" }); const fx = V.novoEfeito("passa-alta", true); fx.params.freq = 5000; pa.efeitos = [fx];
    out = await A.renderizarOffline(projeto([pa]), 0, 2, buffers);
    s.passaAlta = 20 * Math.log10(rms(out, 0.5, 1.5) / (0.5 / Math.SQRT2));
    // 5) todos os efeitos de áudio montam e rodam
    const todos = clipe({ id: "d" }); todos.efeitos = V.EFEITOS_AUDIO.map((e) => V.novoEfeito(e.id, true));
    out = await A.renderizarOffline(projeto([todos]), 0, 1, buffers);
    s.todosRodam = Number.isFinite(rms(out, 0.2, 0.8));
    // 6) trilha muda = silêncio; solo
    out = await A.renderizarOffline(projeto([clipe({ id: "e" })], { trilhas: [{ id: "A1", tipo: "audio", mudo: true }] }), 0, 1, buffers);
    s.mudo = rms(out, 0.2, 0.8);
    // 7) WAV
    s.wav = V.paraWav(out).size;
    // 8) loudness ao vivo: seno 1 kHz, amplitude 0,1 nos dois canais → -20,7 LUFS
    const ctx = A.garantir(); await ctx.resume();
    const osc = ctx.createOscillator(); osc.frequency.value = 1000; const g = ctx.createGain(); g.gain.value = 0.1; osc.connect(g).connect(A.mestre); osc.start();
    for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 100)); A.medir({ trilhas: [], clipes: [] }, true); }
    const m = A.medir({ trilhas: [], clipes: [] }, true);
    osc.stop();
    s.momentaneo = m.momentaneo; s.curto = m.curto; s.integrado = m.integrado; s.pico = m.picoMax;
    return s;
  });
  ok(Math.abs(r.menos6 + 6) < 0.3, `volume do clipe: -6 dB (${r.menos6.toFixed(2)} dB)`);
  ok(r.comeco < 0.05 && Math.abs(r.fim - 0.25) < 0.02, `volume animado por quadro-chave: sobe de ${r.comeco.toFixed(3)} para ${r.fim.toFixed(3)}`);
  // dois trechos da mesma onda (em fase): ganho constante soma 1,0; potência constante soma √2 (é para sons diferentes)
  ok(Math.abs(r.cruzadoGanho - 1) < 0.05, `fade cruzado de ganho constante: volume igual no corte (${r.cruzadoGanho.toFixed(2)})`);
  ok(Math.abs(r.cruzado - Math.SQRT2) < 0.06, `fade cruzado de potência constante: sen + cos no corte (${r.cruzado.toFixed(2)} = √2 com a mesma onda)`);
  ok(r.passaAlta < -20, `passa-alta em 5 kHz tira o tom de 1 kHz (${r.passaAlta.toFixed(1)} dB)`);
  ok(r.todosRodam, "os 11 efeitos de áudio juntos montam e rodam");
  ok(r.mudo < 1e-4, "trilha muda fica em silêncio");
  ok(r.wav > 44, "exporta WAV");
  ok(Math.abs(r.momentaneo + 20.69) < 0.6 && Math.abs(r.curto + 20.69) < 0.6 && Math.abs(r.integrado + 20.69) < 0.6,
    `loudness de um seno de 1 kHz em 0,1: M ${r.momentaneo.toFixed(1)} · S ${r.curto.toFixed(1)} · I ${r.integrado.toFixed(1)} LUFS (esperado -20,7)`);
  ok(Math.abs(r.pico + 20) < 0.5, `pico: ${r.pico.toFixed(1)} dBFS (esperado -20)`);
  ok(consola.length === 0, "nenhum erro no console" + (consola.length ? ": " + consola.join(" | ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
