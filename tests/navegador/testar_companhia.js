// Teste da Companhia (apps/companhia) com a ponte local, no Chromium. Rode com: python3 tests/testar_navegador.py companhia
//
// Precisa de um modelo Live2D e do núcleo do Live2D, que NÃO vêm no repositório (licenças):
//   LNUX_TESTE_MODELO=/caminho/modelo.zip    (um ZIP de modelo do VTube Studio / Cubism 3-4)
//   LNUX_TESTE_NUCLEO=/caminho/live2dcubismcore.min.js
// Sem eles, o teste é pulado.
//
// Uma IA e um gerador de voz "de mentira" sobem num servidor local (compatível com a OpenAI), e a ponte repassa
// os pedidos com a chave guardada nela. Cobre: núcleo pela ponte, importar o ZIP pela tela, emoções nos
// parâmetros, piscar, boca, expressões sem acumular, motor local (0 tokens), memória (nome), provedor e chave
// pela tela (a chave não vai para o navegador), resposta ao vivo com marcas [emoção][gesto], roteador (leve /
// padrão), toques (carinho, cutucar, puxar), voz frase a frase com cache, reanálise da memória ao recarregar,
// exportar memória, trocar de personagem (liberando a textura), perfil, placa de vídeo que não aguenta a textura
// grande (a personagem ficava preta), celular e sem a ponte (núcleo escolhido pela pessoa).
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const MODELO = process.env.LNUX_TESTE_MODELO || "";
const NUCLEO = process.env.LNUX_TESTE_NUCLEO || "";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** Brilho médio dos pixels opacos do palco (0 = personagem toda preta). */
const brilho = (pg) => pg.evaluate(async () => {
  const b = await window.Companhia.palco.foto(); const img = await createImageBitmap(b); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0, s = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) { n++; s += d[i] + d[i + 1] + d[i + 2]; }
  return n ? Math.round(s / n / 3) : 0;
});

// ── IA e voz de mentira ───────────────────────────────────────────────

const registro = [];
function wav(segundos = 0.5) {
  const taxa = 16000, n = Math.floor(taxa * segundos), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / taxa) * 2 * Math.PI * 220) * 20000 * Math.sin((Math.PI * i) / n)), 44 + i * 2);
  return b;
}
function respostaDa(msgs, sistema) {
  const ultima = (msgs[msgs.length - 1] || {}).content || "";
  if (/Leia a conversa/.test(ultima)) return '{"fatos": [{"texto": "Gosta de piadas de zumbi.", "tipo": "gosta"}], "resumo": "Conversaram sobre pizza e piadas.", "afeto": 2}';
  if (/^\(A pessoa voltou/.test(ultima)) return "[feliz][acenar] Que bom que voltou!";
  if (/^\(A pessoa/.test(ultima)) return "[timida][encolher] Ei... isso faz cócegas! Hehe.";
  if (/piada/i.test(ultima)) return "[rindo][pular] Por que o zumbi não come palhaço? Porque tem gosto engraçado! [provocadora] Gostou?";
  if (/Diga oi/.test(ultima)) return "[feliz] Oi!";
  return `[feliz][concordar] Entendi o que você disse. [surpresa] Que legal! O sistema tinha ${sistema.length} letras.`;
}
const mock = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const j = corpo ? JSON.parse(corpo) : {};
    registro.push({ url: req.url, metodo: req.method, auth: req.headers.authorization || "", origem: req.headers.origin || "", modelo: j.model, corpo: j });
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "mock-grande" }, { id: "mock-pequeno" }] })); return; }
    if (req.url === "/v1/audio/voices") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ voices: [{ voice_id: "ana", name: "Ana" }] })); return; }
    if (req.url === "/v1/audio/speech") { res.writeHead(200, { "content-type": "audio/wav" }); res.end(wav(0.6)); return; }
    if (req.url === "/v1/chat/completions") {
      const msgs = j.messages.filter((m) => m.role !== "system");
      const sistema = (j.messages.find((m) => m.role === "system") || {}).content || "";
      const texto = respostaDa(msgs, sistema);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const pedacos = texto.match(/.{1,7}/gs);
      let i = 0;
      const t = setInterval(() => {
        if (i < pedacos.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pedacos[i++] } }] })}\n\n`);
        else { res.write("data: [DONE]\n\n"); res.end(); clearInterval(t); }
      }, 15);
      return;
    }
    res.writeHead(404); res.end("{}");
  });
});

(async () => {
  if (!MODELO || !NUCLEO || !fs.existsSync(MODELO) || !fs.existsSync(NUCLEO)) {
    console.log("  ⏭  Pulado: defina LNUX_TESTE_MODELO (ZIP de um modelo Live2D) e LNUX_TESTE_NUCLEO (live2dcubismcore.min.js).");
    return;
  }
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;
  // o núcleo do Live2D guardado pela ponte (como se ela tivesse baixado do site oficial)
  const rn = await fetch(BASE + "/api/live2d/core", { method: "PUT", headers: { "X-Ponte-Token": TOKEN, "Content-Type": "text/javascript" }, body: fs.readFileSync(NUCLEO) });
  ok(rn.ok, "núcleo do Live2D guardado pela ponte");

  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1360, height: 860 }, locale: "pt-BR", acceptDownloads: true });
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|502)/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const ev = (f, a) => pagina.evaluate(f, a);
  const menu = async (topo, item) => {
    await pagina.click(`.lnux-menubar > button:text-is("${topo}")`);
    await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`);
  };
  const ultimaDela = () => ev(() => { const m = [...document.querySelectorAll("#mensagens .msg.ela .t")]; return m.length ? m[m.length - 1].textContent : ""; });
  const esperarResposta = async (antes) => {
    await pagina.waitForFunction((n) => document.querySelectorAll("#mensagens .msg.ela").length > n && !window.Companhia.respondendo, antes, { timeout: 15000 });
    await esperar(150);
  };
  const contarDela = () => ev(() => document.querySelectorAll("#mensagens .msg.ela").length);
  const enviar = async (texto) => { const n = await contarDela(); await pagina.fill("#texto", texto); await pagina.press("#texto", "Enter"); await esperarResposta(n); return ultimaDela(); };
  const param = (id) => ev((i) => window.Companhia.palco.parametro(i), id);

  try {
    // ── abrir: núcleo pela ponte, tela vazia ──
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector(".lnux-selo"), null, { timeout: 15000 });
    await pagina.waitForFunction(() => window.Companhia.live2d, null, { timeout: 15000 });
    ok(await ev(() => window.Companhia.live2d) === "ponte", "núcleo do Live2D carregado pela ponte (sem internet)");
    ok(await pagina.isVisible("#palco-vazio"), "sem personagem: a tela pede para importar");

    // ── importar o ZIP pela tela (Personagem › Importar ZIP › Escolher pelo navegador) ──
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [escolha] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo footer button:text-is("Escolher pelo navegador...")')]);
    await escolha.setFiles(MODELO);
    // modelos marcados "não compartilhar" no VTube Studio pedem confirmação
    await pagina.waitForSelector('.lnux-dialogo footer button:text-is("Importar")', { timeout: 15000 }).then(() => pagina.click('.lnux-dialogo footer button:text-is("Importar")')).catch(() => {});
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo, null, { timeout: 30000 });
    await esperar(800);
    const info = await ev(() => ({ nome: window.Companhia.atual.perfil.nome, exps: window.Companhia.palco.expressoes.size, botoes: document.querySelectorAll("#atalhos button").length,
      titulo: document.querySelector("#titulo-doc").textContent, vazio: document.querySelector("#palco-vazio").hidden, idle: window.Companhia.atual.idle, emocoes: window.Companhia.atual.emocoes }));
    ok(info.vazio && info.titulo === info.nome, `personagem importada e aberta: ${info.nome}`);
    ok(info.exps > 0 && info.botoes === info.exps, `expressões viram atalhos (${info.exps})`);
    ok(Object.keys(info.emocoes).length > 0, "emoções ligadas às expressões pelo nome: " + Object.entries(info.emocoes).map(([e, x]) => e + "→" + x.join("+")).join(", "));
    const pixels = await ev(async () => { const b = await window.Companhia.palco.foto(); const img = await createImageBitmap(b); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
    ok(pixels > 5000, `a personagem aparece no palco (${pixels} pixels desenhados)`);
    const cor = await brilho(pagina);
    ok(cor > 30, `a personagem tem cor (brilho médio ${cor}; preta seria 0)`);
    const tex = await ev(() => ({ limite: window.Companhia.palco.limiteUsado, t: window.Companhia.palco.texturas, gpu: window.Companhia.palco.modelo.textures.map((x) => [x.baseTexture.realWidth, x.baseTexture.realHeight]) }));
    ok(tex.gpu.every((d) => Math.max(...d) <= tex.limite), `texturas dentro do limite automático (${tex.limite} px): ` + tex.t.map((x) => x.original.join("×") + (x.usada[0] !== x.original[0] ? " → " + x.usada.join("×") : "")).join(", "));
    await pagina.screenshot({ path: path.join(PASTA, "companhia-1.png") });

    // ── emoções e boca nos parâmetros ──
    const neutro = await param("ParamMouthForm");
    await ev(() => window.Companhia.palco.definirEmocao("feliz"));
    await esperar(900);
    const feliz = await param("ParamMouthForm");
    await ev(() => window.Companhia.palco.definirEmocao("triste"));
    await esperar(900);
    const triste = await param("ParamMouthForm");
    ok(feliz.valor > neutro.valor && triste.valor < neutro.valor, `emoção muda a boca (neutra ${neutro.valor.toFixed(2)}, feliz ${feliz.valor.toFixed(2)}, triste ${triste.valor.toFixed(2)})`);
    const angY = await param("ParamAngleY");
    ok(angY.valor < -4, `triste: cabeça baixa (ParamAngleY ${angY.valor.toFixed(1)})`);
    await ev(() => { window.Companhia.palco.definirEmocao("neutra"); window.Companhia.palco.falar(1); });
    await esperar(300);
    const bocaAberta = (await param("ParamMouthOpenY")).valor;
    await ev(() => window.Companhia.palco.falar(0));
    await esperar(500);
    const bocaFechada = (await param("ParamMouthOpenY")).valor;
    ok(bocaAberta > 0.6 && bocaFechada < 0.2, `boca acompanha a voz (aberta ${bocaAberta.toFixed(2)}, fechada ${bocaFechada.toFixed(2)})`);
    // piscar: em 7 s o olho fecha pelo menos uma vez
    const minimoOlho = await ev(async () => { let m = 9; const t0 = performance.now(); while (performance.now() - t0 < 7000) { m = Math.min(m, window.Companhia.palco.parametro("ParamEyeLOpen").valor); await new Promise((r) => requestAnimationFrame(r)); } return m; });
    ok(minimoOlho < 0.4, `pisca sozinha (olho chegou a ${minimoOlho.toFixed(2)})`);
    // expressão liga e desliga sem acumular (Add não pode somar a cada quadro)
    const exp = await ev(() => { const [nome, x] = [...window.Companhia.palco.expressoes].find(([, x]) => x.params.length && x.params[0].Blend !== "Multiply"); return { nome, id: x.params[0].Id, valor: x.params[0].Value }; });
    await pagina.click(`#atalhos button:text-is("${exp.nome}")`);
    await esperar(1200);
    const ligada = (await param(exp.id)).valor;
    await esperar(800);
    const ligada2 = (await param(exp.id)).valor;
    await pagina.click(`#atalhos button:text-is("${exp.nome}")`);
    await esperar(1200);
    const desligada = (await param(exp.id)).valor;
    const def = (await param(exp.id)).def;
    ok(Math.abs(ligada - ligada2) < 0.05 && Math.abs(desligada - def) < 0.05 && Math.abs(ligada - def) > 0.3, `atalho de expressão "${exp.nome}" liga (${ligada.toFixed(2)}), fica estável e desliga (${desligada.toFixed(2)})`);

    // ── motor local (sem IA, 0 tokens) e memória ──
    let r = await enviar("oi");
    ok(/\boi|bom dia|boa tarde|boa noite/i.test(r) && !/\[/.test(r), `motor local responde "oi" (o cumprimento muda com a hora): ${r}`);
    r = await enviar("meu nome é Gustavo");
    ok(/Gustavo/.test(r), `aprende o nome: ${r}`);
    ok(await ev(() => window.Companhia.estado.pessoa) === "Gustavo", "o nome fica na memória");
    r = await enviar("qual é meu nome?");
    ok(/Gustavo/.test(r), `lembra o nome sem IA: ${r}`);
    r = await enviar("eu adoro pizza de calabresa e hoje eu ri muito");
    ok(r.length > 3, `sem IA, o motor local ainda conversa: ${r}`);
    ok(await ev(() => window.C.ia.gasto.pedidos === 0 && window.C.ia.gasto.locais >= 4), "tudo isso com 0 pedidos à IA");

    // ── provedor pela tela: Outro (compatível com OpenAI), chave guardada na ponte ──
    await menu("IA", "Provedores e chaves...");
    await pagina.waitForSelector(".lnux-dialogo");
    await pagina.selectOption(".lnux-dialogo select.lnux-selecao >> nth=0", "personalizado");
    await pagina.fill('.lnux-dialogo input[placeholder="https://.../v1"]', MOCK);
    await pagina.fill('.lnux-dialogo input[type="password"]', "chave-secreta-123");
    await pagina.click('.lnux-dialogo button:text-is("Listar modelos")');
    await pagina.waitForFunction(() => document.querySelectorAll("#lista-modelos option").length === 2, null, { timeout: 8000 });
    ok(true, "Listar modelos mostra os modelos do provedor");
    await pagina.fill('.lnux-dialogo input[list="lista-modelos"]', "mock-grande");
    await pagina.click('.lnux-dialogo button:text-is("Usar na conversa")');
    await esperar(300);
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    const chavesNoNavegador = await ev(() => Object.keys(localStorage).filter((k) => k.startsWith("companhia.chave")).length + (JSON.stringify(localStorage).includes("chave-secreta") ? 10 : 0));
    ok(chavesNoNavegador === 0, "a chave não fica no navegador (só na ponte)");
    const listou = registro.find((x) => x.url === "/v1/models");
    ok(listou && listou.auth === "Bearer chave-secreta-123" && !listou.origem, "a ponte pôs a chave no pedido (e o provedor não viu o navegador)");
    ok((await pagina.textContent("#selo-ia")).includes("mock-grande"), "o selo mostra o modelo da conversa");
    // rota leve: um modelo menor
    await ev(() => { window.C.ia.config.rotas.leve = { provedor: "personalizado", modelo: "mock-pequeno" }; window.C.ia.config.intervaloToquesIA = 0; window.C.ia.salvar(); });

    // ── resposta ao vivo com marcas de emoção e gesto ──
    const gestos = [];
    await pagina.exposeFunction("anotarGesto", (g) => gestos.push(g));
    await ev(() => window.Companhia.palco.on("gesto", (g) => window.anotarGesto(g)));
    const antes = registro.length;
    r = await enviar("me conta uma piada");
    ok(/zumbi/.test(r) && !/\[|\]/.test(r), `resposta da IA sem as marcas: ${r.slice(0, 60)}...`);
    ok(gestos.includes("pular"), "a marca [pular] virou gesto do corpo");
    const pedidoChat = registro.slice(antes).find((x) => x.url === "/v1/chat/completions");
    ok(pedidoChat && pedidoChat.modelo === "mock-grande" && pedidoChat.corpo.stream === true, "conversa vai para o modelo da rota padrão, ao vivo (stream)");
    const sistema = pedidoChat.corpo.messages[0].content;
    ok(/Gustavo/.test(sistema) && /Emoções:/.test(sistema), "o contexto leva o que ela lembra (nome) e as regras das marcas");
    ok(pedidoChat.corpo.messages.length <= 2 * 8 + 2, `contexto enxuto (${pedidoChat.corpo.messages.length} mensagens)`);
    ok(await ev(() => document.querySelector("#chip-emocao").textContent) === "Provocadora", "a última emoção da resposta fica no rosto");
    r = await enviar("oi");
    ok(registro.slice(antes).filter((x) => x.url === "/v1/chat/completions").length === 1, "com IA ligada, o \"oi\" ainda é do motor local (0 tokens)");

    // ── toques: carinho na cabeça, cutucar o rosto, puxar a orelha ──
    const ponto = (zona) => ev((z) => {
      const p = window.Companhia.palco, zz = p.toques.zonas.find((x) => x.id === z), [a, b, c, d] = zz.rets[0];
      const q = p.deModelo((a + c) / 2, (b + d) / 2), r = document.querySelector("#palco").getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    }, zona);
    const afeto0 = await ev(() => window.Companhia.estado.afeto);
    let n = await contarDela();
    const cab = await ponto("cabeca");
    await pagina.mouse.move(cab.x, cab.y);
    await pagina.mouse.down();
    for (let i = 0; i < 6; i++) { await pagina.mouse.move(cab.x + 40, cab.y, { steps: 4 }); await pagina.mouse.move(cab.x - 40, cab.y, { steps: 4 }); }
    await pagina.mouse.up();
    await esperarResposta(n);
    const toque1 = await ev(() => [...document.querySelectorAll("#mensagens .msg.toque")].pop().textContent);
    ok(/carinho/.test(toque1) && /Cabeça/.test(toque1), `cafuné reconhecido: ${toque1}`);
    ok(await ev(() => window.Companhia.estado.afeto) > afeto0, "carinho aumenta o afeto");
    const pedidoToque = registro.filter((x) => x.url === "/v1/chat/completions").pop();
    ok(pedidoToque.modelo === "mock-pequeno" && pedidoToque.corpo.max_tokens <= 100, "a reação ao toque vai para a rota leve (modelo pequeno, resposta curta)");
    await ev(() => { window.C.ia.config.toquesComIA = false; });
    await esperar(2700);
    n = await contarDela();
    const rosto = await ponto("rosto");
    await pagina.mouse.click(rosto.x, rosto.y);
    await esperarResposta(n);
    const toque2 = await ev(() => [...document.querySelectorAll("#mensagens .msg.toque")].pop().textContent);
    ok(/tocar/.test(toque2) && /Rosto/.test(toque2), `cutucar a bochecha: ${toque2} → ${await ultimaDela()}`);
    await esperar(2700);
    n = await contarDela();
    const orelha = await ponto("orelhas");
    await pagina.mouse.move(orelha.x, orelha.y);
    await pagina.mouse.down();
    await pagina.mouse.move(orelha.x - 90, orelha.y + 10, { steps: 8 });
    await pagina.mouse.up();
    await esperarResposta(n);
    const toque3 = await ev(() => [...document.querySelectorAll("#mensagens .msg.toque")].pop().textContent);
    ok(/puxar/.test(toque3), `puxar a orelha: ${toque3} → ${await ultimaDela()}`);
    ok(await ev(() => window.Companhia.palco.emocao) === "brava", "puxar a orelha deixa ela brava");
    await ev(() => { window.C.ia.config.toquesComIA = true; window.C.ia.salvar(); });

    // ── voz: frase por frase, boca mexendo, e frases curtas guardadas ──
    await ev((url) => { Object.assign(window.C.voz.config, { provedor: "voz-personalizada", url, voz: "ana", modelo: "kokoro", falar: true }); window.C.voz.salvar(); }, MOCK);
    await pagina.check("#opcao-falar");
    const vozesAntes = registro.filter((x) => x.url === "/v1/audio/speech").length;
    let maxBoca = 0;
    const medir = setInterval(async () => { try { maxBoca = Math.max(maxBoca, await ev(() => window.Companhia.palco.fala)); } catch (e) { /* fim */ } }, 60);
    await enviar("o que você acha disso?");
    await pagina.waitForFunction(() => !window.C.voz.falando(), null, { timeout: 15000 });
    clearInterval(medir);
    const falas = registro.filter((x) => x.url === "/v1/audio/speech").slice(vozesAntes);
    ok(falas.length >= 2, `a resposta foi falada frase por frase (${falas.length} pedidos de voz)`);
    ok(falas.every((f) => f.corpo.voice === "ana" && f.corpo.input && !/\[/.test(f.corpo.input)), "a voz recebe o texto limpo, com a voz escolhida");
    ok(maxBoca > 0.2, `a boca mexe com o som (${maxBoca.toFixed(2)})`);
    const v0 = registro.filter((x) => x.url === "/v1/audio/speech").length;
    await ev(() => { window.C.voz.falar("Frase repetida curta.", "feliz"); });
    await pagina.waitForFunction(() => !window.C.voz.falando(), null, { timeout: 10000 });
    await esperar(300);
    await ev(() => { window.C.voz.falar("Frase repetida curta.", "feliz"); });
    await pagina.waitForFunction(() => !window.C.voz.falando(), null, { timeout: 10000 });
    ok(registro.filter((x) => x.url === "/v1/audio/speech").length - v0 === 1, "frase repetida não gera voz de novo (guardada)");
    await pagina.uncheck("#opcao-falar");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-2.png") });

    // ── recarregar: histórico volta e a memória é reanalisada (IA leve) ──
    for (const t of ["gosto de pizza", "e de jogar", "hoje choveu", "amanhã vou ter uma prova de cálculo"]) await enviar(t);
    const guardadas = await ev(async () => (await window.C.memoria.todas(window.Companhia.atual.id)).length);
    const analisesAntes = registro.filter((x) => x.url === "/v1/chat/completions" && /Leia a conversa/.test(JSON.stringify(x.corpo.messages))).length;
    await pagina.reload();
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 30000 });
    const est = await ev(() => window.Companhia.estado);
    const analises = registro.filter((x) => x.url === "/v1/chat/completions" && /Leia a conversa/.test(JSON.stringify(x.corpo.messages)));
    ok(analises.length > analisesAntes && analises[analises.length - 1].modelo === "mock-pequeno", "ao abrir, a memória é reanalisada pela rota leve");
    ok(est.fatos.some((f) => f.origem === "ia" && /piadas de zumbi/.test(f.texto)) && /piadas/.test(est.resumo), `fatos e resumo pela IA: ${est.fatos.map((f) => f.texto).join(" | ").slice(0, 200)} — ${est.resumo}`);
    ok(est.fatos.some((f) => f.texto === "Gosta de pizza de calabresa."), "a análise local corta a frase no lugar certo (\"Gosta de pizza de calabresa.\")");
    ok(est.fatos.some((f) => f.tipo === "plano"), "o plano (prova) foi anotado pela análise local");
    const naTela = await ev(() => document.querySelectorAll("#mensagens .msg.eu, #mensagens .msg.ela, #mensagens .msg.toque").length);
    ok(naTela >= Math.min(80, guardadas) - 2, `histórico de volta na tela (${naTela} de ${guardadas})`);
    ok(await ev(() => window.Companhia.estado.pessoa) === "Gustavo", "lembra o nome depois de recarregar");

    // ── memória: janela e exportar ──
    await menu("Conversa", "O que ela lembra (memória)...");
    await pagina.waitForSelector(".lista-fatos");
    ok((await pagina.textContent(".lista-fatos")).includes("calabresa"), "a janela da memória mostra os fatos");
    await pagina.click('.lnux-dialogo footer button:text-is("Cancelar")');
    await menu("Conversa", "Exportar memória (JSON)...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click('.lnux-dialogo footer button:text-is("Baixar pelo navegador")')]);
    const json = JSON.parse(fs.readFileSync(await baixado.path(), "utf8"));
    const total = await ev(async () => (await window.C.memoria.todas(window.Companhia.atual.id)).length);
    ok(json.mensagens.length === total && json.estado.pessoa === "Gustavo", `memória exportada (${json.mensagens.length} mensagens)`);

    // ── perfil e trocar de personagem ──
    await menu("Personagem", "Perfil e personalidade...");
    await pagina.waitForSelector(".lnux-dialogo");
    await pagina.fill(".lnux-dialogo .lnux-campo:has(span:text-is('Nome')) input", "Lili");
    await pagina.click('.lnux-dialogo footer button:text-is("Salvar")');
    await esperar(300);
    ok(await pagina.textContent("#titulo-doc") === "Lili", "perfil renomeado");
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [escolha2] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo footer button:text-is("Escolher pelo navegador...")')]);
    await escolha2.setFiles(MODELO);
    await pagina.waitForSelector('.lnux-dialogo footer button:text-is("Importar")', { timeout: 15000 }).then(() => pagina.click('.lnux-dialogo footer button:text-is("Importar")')).catch(() => {});
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.atual.perfil.nome !== "Lili" && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 30000 });
    const segunda = await ev(() => ({ id: window.Companhia.atual.id, msgs: document.querySelectorAll("#mensagens .msg.eu").length }));
    await ev(() => { window.__texturaAnterior = window.Companhia.palco.modelo.textures[0].baseTexture; });
    ok(segunda.msgs === 0, "a segunda personagem tem a própria conversa (vazia)");
    await menu("Personagem", "Trocar de personagem...");
    await pagina.waitForSelector(".cartao-personagem");
    ok(await pagina.locator(".lnux-dialogo .cartao-personagem").count() === 2, "a janela de troca mostra as duas");
    await pagina.click('.lnux-dialogo .cartao-personagem:has-text("Lili")');
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.atual.perfil.nome === "Lili" && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 30000 });
    ok(await ev(() => document.querySelectorAll("#mensagens .msg.eu").length) > 3, "voltou para a Lili, com a conversa dela");
    ok(await ev(() => window.__texturaAnterior.destroyed === true), "trocar de personagem libera a textura da anterior (memória de vídeo)");

    // ── uma personagem VRoid (.vrm) junto: trocar de uma para a outra (palco 3D ↔ Live2D) ──
    const VRM = process.env.LNUX_TESTE_VRM || "";
    if (VRM && fs.existsSync(VRM)) {
      await menu("Personagem", "Importar ZIP ou .vrm...");
      await pagina.waitForSelector(".lnux-dialogo");
      const [escV] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo footer button:text-is("Escolher pelo navegador...")')]);
      await escV.setFiles(VRM);
      await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.atual.tipo === "vrm" && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
      ok((await brilho(pagina)) > 30 && await ev(() => getComputedStyle(document.querySelector(".palco-3d")).display !== "none"), "personagem VRoid aberta no palco 3D, ao lado das Live2D");
      await menu("Personagem", "Trocar de personagem...");
      await pagina.click('.lnux-dialogo .cartao-personagem:has-text("Lili")');
      await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.atual.perfil.nome === "Lili" && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
      const volta = await ev(() => ({ tipo: window.Companhia.atual.tipo, canvas3d: getComputedStyle(document.querySelector(".palco-3d")).display, l2d: !!window.Companhia.palco.app }));
      ok(volta.tipo !== "vrm" && volta.canvas3d === "none" && volta.l2d && (await brilho(pagina)) > 30, "de volta à Live2D: o palco 3D some e o Live2D desenha de novo");
    } else ok(true, "(sem LNUX_TESTE_VRM: a troca VRoid ↔ Live2D fica para o teste companhia_vrm)");

    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));

    // ── aparelho cuja placa de vídeo não aguenta a textura grande (a personagem ficava preta) ──
    // A placa diz aceitar 8192 px, mas falha acima de 2048 (como num celular sem memória de vídeo): a textura não
    // sobe e fica preta. A Companhia tem de perceber, refazer com texturas menores e guardar o tamanho que funcionou.
    const fraco = await navegador.newContext({ viewport: { width: 1100, height: 760 }, locale: "pt-BR" });
    await fraco.addInitScript(() => {
      for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const gp = P.getParameter, tx = P.texImage2D;
        P.getParameter = function (q) { return q === this.MAX_TEXTURE_SIZE ? 8192 : gp.call(this, q); };
        P.texImage2D = function (...a) {
          const f = a[a.length - 1], w = a.length === 9 ? a[3] : f && f.width, h = a.length === 9 ? a[4] : f && f.height;
          if (w > 2048 || h > 2048) { window.__falhasTextura = (window.__falhasTextura || 0) + 1; return; }
          return tx.apply(this, a);
        };
      }
    });
    const pf = await fraco.newPage();
    await pf.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pf.waitForFunction(() => window.Companhia && window.Companhia.live2d, null, { timeout: 15000 });
    await pf.click('.lnux-menubar > button:text-is("Personagem")');
    await pf.click('.lnux-menu button:has(.rotulo:text-is("Importar ZIP ou .vrm..."))');
    await pf.waitForSelector(".lnux-dialogo");
    const [esf] = await Promise.all([pf.waitForEvent("filechooser"), pf.click('.lnux-dialogo footer button:text-is("Escolher pelo navegador...")')]);
    await esf.setFiles(MODELO);
    await pf.waitForSelector('.lnux-dialogo footer button:text-is("Importar")', { timeout: 15000 }).then(() => pf.click('.lnux-dialogo footer button:text-is("Importar")')).catch(() => {});
    await pf.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });
    await pf.waitForTimeout(800);
    const r1 = await pf.evaluate(() => ({ limite: window.Companhia.palco.limiteUsado, qualidade: window.Companhia.atual.qualidade, falhas: window.__falhasTextura || 0,
      aviso: [...document.querySelectorAll(".lnux-aviso")].map((a) => a.textContent).join(" ") }));
    const corFraco = await brilho(pf);
    const maiorOriginal = await pf.evaluate(() => Math.max(...window.Companhia.palco.texturas.map((t) => Math.max(...t.original))));
    if (maiorOriginal > 2048) {
      ok(r1.falhas > 0 && corFraco > 30, `textura grande demais: percebeu o preto e refez menor (${r1.limite} px, brilho ${corFraco})`);
      ok(/grandes demais/.test(r1.aviso) && r1.qualidade === String(r1.limite), "avisa e guarda o tamanho que funcionou");
      await pf.screenshot({ path: path.join(PASTA, "companhia-placa-fraca.png") });
      await pf.reload();
      await pf.waitForFunction(() => window.Companhia && window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
      const r2 = await pf.evaluate(() => ({ falhas: window.__falhasTextura || 0, limite: window.Companhia.palco.limiteUsado }));
      ok(r2.falhas === 0 && r2.limite === r1.limite && (await brilho(pf)) > 30, "ao abrir de novo, já usa o tamanho certo (sem preto e sem tentar de novo)");
      await pf.click('.lnux-menubar > button:text-is("Exibir")');
      await pf.click('.lnux-menu button:has(.rotulo:text-is("Qualidade das texturas..."))');
      await pf.waitForSelector(".diag");
      const diag = await pf.textContent(".diag");
      ok(/8192 px/.test(diag) && /texturas ok/.test(diag), "a janela de qualidade mostra o limite da placa e a conferência");
    } else ok(true, "(modelo de teste com texturas pequenas: o caso da placa fraca não se aplica)");
    await fraco.close();

    // ── celular ──
    const cel = await navegador.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
    const pc = await cel.newPage();
    await pc.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pc.waitForFunction(() => window.Companhia && window.Companhia.live2d, null, { timeout: 15000 });
    ok(await pc.evaluate(() => document.documentElement.dataset.layout) === "celular", "no celular, layout de celular");
    const caixas = await pc.evaluate(() => { const a = document.querySelector("#palco-area").getBoundingClientRect(), b = document.querySelector("#conversa").getBoundingClientRect(); return { a: a.bottom, b: b.top, w: b.width, W: innerWidth }; });
    ok(caixas.a <= caixas.b + 1 && caixas.w >= caixas.W - 2, "personagem em cima, conversa embaixo, sem rolar de lado");
    await pc.screenshot({ path: path.join(PASTA, "companhia-celular.png") });
    await cel.close();

    // ── sem a ponte: a pessoa escolhe o arquivo do núcleo ──
    const sem = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
    await sem.route(/cubism\.live2d\.com/, (rota) => rota.abort());
    const ps = await sem.newPage();
    await ps.goto(`${BASE}/apps/companhia/`);
    await ps.waitForSelector("#nucleo-aviso:not([hidden])", { timeout: 15000 });
    ok(true, "sem a ponte e sem internet: aviso do núcleo do Live2D");
    const [esc] = await Promise.all([ps.waitForEvent("filechooser"), ps.click('#nucleo-aviso button:text-is("Escolher o arquivo...")')]);
    await esc.setFiles(NUCLEO);
    await ps.waitForFunction(() => window.Companhia.live2d === "navegador", null, { timeout: 15000 });
    ok(true, "núcleo escolhido pela pessoa e guardado no navegador");
    await sem.close();
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
    mock.close();
  }
  console.log(`\nCompanhia: ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
