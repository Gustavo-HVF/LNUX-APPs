// Teste do app Som no Chromium (Playwright). Rode com: python3 tests/testar_navegador.py
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// As variáveis vêm de tests/testar_navegador.py (que sobe o servidor com pastas temporárias)
const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const MIDIAS = process.env.LNUX_TESTE_MIDIAS || path.join(PASTA, "midias");

const erros = [];
let passos = 0;
function ok(cond, msg) {
  if (!cond) { console.log("  ✖ " + msg); erros.push(msg); } else { passos++; console.log("  ✔ " + msg); }
}

(async () => {
  const navegador = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 820 }, permissions: ["microphone"] });
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consola.push(`[${m.type()}] ${m.text()}`); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));

  await pagina.goto(`${BASE}/apps/som/#token=${TOKEN}`);
  await pagina.waitForFunction(() => window.Som && LNUX.ponte.estado !== undefined);
  await pagina.waitForTimeout(800);
  ok(await pagina.evaluate(() => LNUX.ponte.disponivel), "a ponte ficou ligada (a chave do endereço foi aceita)");
  ok(!(await pagina.evaluate(() => location.hash.includes("token"))), "a chave saiu da barra de endereço");
  ok((await pagina.textContent(".lnux-selo")).includes("Ponte ligada"), "o selo mostra 'Ponte ligada'");

  // Importar pela janela da ponte: navega até a pasta de mídias e abre o WAV com dois cliques
  await pagina.click("#importar");
  await pagina.waitForSelector(".lnux-pastas");
  await pagina.fill(".lnux-pastas .caminho input", MIDIAS);
  await pagina.press(".lnux-pastas .caminho input", "Enter");
  await pagina.waitForSelector(".lnux-pastas li:has-text('tom.wav')");
  ok(await pagina.isVisible(".lnux-pastas li.desligado:has-text('foto.png')"), "na janela de importar, a foto aparece desligada (não é áudio)");
  await pagina.dblclick(".lnux-pastas li:has-text('tom.wav')");
  await pagina.waitForFunction(() => Som.projeto.clipes.length === 1, null, { timeout: 15000 });
  let p = await pagina.evaluate(() => Som.projeto);
  ok(Math.abs(p.clipes[0].duracao - 3) < 0.05, `o WAV importado vira um clipe de 3 s (${p.clipes[0].duracao.toFixed(3)})`);

  // MP3 importado "pelo navegador" (o caminho que o app usa sem ponte), na outra trilha
  await pagina.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    await Som.adicionarArquivos([{ nome: "musica.mp3", tipo: "audio/mpeg", tamanho: blob.size, blob: async () => blob }], { tempo: 3 });
  }, `/api/arquivo?caminho=${encodeURIComponent(MIDIAS + "/musica.mp3")}`);
  p = await pagina.evaluate(() => Som.projeto);
  ok(p.clipes.length === 2 && p.clipes[1].inicio === 3, "o MP3 entra como segundo clipe, em 3 s");

  // Separar no cursor (tecla S) e desfazer/refazer
  await pagina.evaluate(() => { Som.irPara(1.5); });
  await pagina.click("#rolagem", { position: { x: 5, y: 300 } }); // tira o foco dos campos (clica no vazio)
  await pagina.evaluate(() => Som.irPara(1.5));
  await pagina.keyboard.press("s");
  p = await pagina.evaluate(() => Som.projeto);
  ok(p.clipes.length === 3, `S separa o clipe no cursor (agora ${p.clipes.length} clipes)`);
  const partes = p.clipes.filter((c) => c.audio === p.clipes[0].audio).sort((a, b) => a.inicio - b.inicio);
  ok(Math.abs(partes[0].duracao - 1.5) < 0.01 && Math.abs(partes[1].entrada - 1.5) < 0.01, "as duas partes continuam o áudio do ponto certo");
  await pagina.keyboard.press("Control+z");
  ok((await pagina.evaluate(() => Som.projeto.clipes.length)) === 2, "Ctrl+Z desfaz a separação");
  await pagina.keyboard.press("Control+Shift+z");
  ok((await pagina.evaluate(() => Som.projeto.clipes.length)) === 3, "Ctrl+Shift+Z refaz");

  // A linha do tempo foi desenhada (pixels coloridos no canvas)
  const coloridos = await pagina.evaluate(() => {
    const c = document.getElementById("pistas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - d[i + 1]) > 40 || Math.abs(d[i + 1] - d[i + 2]) > 40) n++;
    return n;
  });
  ok(coloridos > 500, `os clipes aparecem desenhados na linha do tempo (${coloridos} pontos coloridos)`);

  // Tocar 1 s
  await pagina.evaluate(() => Som.irPara(0));
  await pagina.keyboard.press(" ");
  await pagina.waitForTimeout(1100);
  const tocando = await pagina.evaluate(() => ({ t: Som.motor.tempo(), tocando: Som.motor.tocando }));
  ok(tocando.tocando && tocando.t > 0.7 && tocando.t < 1.6, `Espaço toca (cursor em ${tocando.t && tocando.t.toFixed(2)} s depois de ~1 s)`);
  await pagina.keyboard.press(" ");
  ok(!(await pagina.evaluate(() => Som.motor.tocando)), "Espaço de novo pausa");

  // Gravar ~1,5 s pelo microfone simulado
  await pagina.evaluate(() => Som.irPara(6));
  await pagina.keyboard.press("r");
  await pagina.waitForTimeout(1600);
  await pagina.keyboard.press("r");
  await pagina.waitForFunction(() => Som.projeto.clipes.some((c) => c.nome.startsWith("Gravação")), null, { timeout: 10000 });
  p = await pagina.evaluate(() => Som.projeto);
  const gravado = p.clipes.find((c) => c.nome.startsWith("Gravação"));
  ok(gravado && gravado.inicio === 6 && gravado.duracao > 1 && gravado.duracao < 2.2, `R grava e cria o clipe em 6 s (${gravado && gravado.duracao.toFixed(2)} s)`);

  // Efeitos numa trilha e exportação WAV (render offline)
  await pagina.evaluate(() => { const t = Som.projeto.trilhas[0]; t.efeitos.reverb.ligado = true; t.efeitos.eco.ligado = true; t.efeitos.eq.ligado = true; t.efeitos.eq.graves = 6; });
  const wav = await pagina.evaluate(async () => { const b = await Som.renderizarWav(); return { tamanho: b.size, tipo: b.type }; });
  const esperado = 44 + Math.ceil(p.clipes.reduce((m, c) => Math.max(m, c.inicio + c.duracao), 0) * 48000) * 4;
  ok(wav.tipo === "audio/wav" && Math.abs(wav.tamanho - esperado) < 48000 * 4 * 0.05, `a mixagem sai em WAV com o tamanho certo (${wav.tamanho} bytes)`);

  // MP3 pela ponte (ffmpeg)
  const mp3 = await pagina.evaluate(async () => {
    const w = await Som.renderizarWav();
    const { caminho } = await LNUX.ponte.temporario(w, "teste.wav");
    const r = await LNUX.ponte.converter({ entrada: caminho, perfil: "mp3" });
    const b = await LNUX.ponte.ler(r.saida, "blob");
    return { tamanho: b.size, saida: r.saida };
  });
  ok(mp3.tamanho > 5000 && mp3.saida.endsWith(".mp3"), `e em MP3 pela ponte (${mp3.tamanho} bytes)`);

  // Pacote do projeto (.lnuxsom)
  const pacote = await pagina.evaluate(async () => {
    const z = await Som.gerarPacote();
    const arquivos = await LNUX.Zip.ler(z);
    const json = JSON.parse(await arquivos.get("projeto.json").text());
    return { nomes: [...arquivos.keys()], audios: Object.keys(json.audios).length, clipes: json.clipes.length };
  });
  ok(pacote.nomes.includes("projeto.json") && pacote.audios === 3 && pacote.nomes.length === 4, `o .lnuxsom leva o projeto e os 3 áudios (${pacote.nomes.join(", ")})`);

  // Recarregar: o projeto volta do IndexedDB
  const antes = await pagina.evaluate(() => Som.projeto.clipes.length);
  await pagina.waitForTimeout(1200); // guardar no navegador tem um pequeno atraso
  await pagina.reload();
  await pagina.waitForFunction(() => window.Som && Som.projeto.clipes.length > 0, null, { timeout: 15000 });
  await pagina.waitForTimeout(500);
  const depois = await pagina.evaluate(() => ({ n: Som.projeto.clipes.length, buffers: Som.motor.buffers.size }));
  ok(depois.n === antes && depois.buffers === 3, `depois de recarregar, o projeto volta inteiro (${depois.n} clipes, ${depois.buffers} áudios)`);

  // Tema e layout
  await pagina.evaluate(() => LNUX.tema.definir("claro"));
  ok((await pagina.getAttribute("html", "data-tema")) === "claro", "o tema claro é aplicado");
  await pagina.evaluate(() => LNUX.layout.definir("mixagem"));
  await pagina.waitForTimeout(300);
  const mixer = await pagina.evaluate(() => document.getElementById("mixer").getBoundingClientRect().height);
  ok(mixer > 300, `o layout Mixagem mostra o mixer grande (${Math.round(mixer)} px)`);
  ok((await pagina.$$(".canal")).length === (await pagina.evaluate(() => Som.projeto.trilhas.length)) + 1, "o mixer tem um canal por trilha e o mestre");
  await pagina.screenshot({ path: path.join(PASTA, "som-mixagem-claro.png") });
  await pagina.evaluate(() => { LNUX.tema.definir("escuro"); LNUX.layout.definir("completo"); });
  await pagina.evaluate(() => { Som.projeto.clipes.length && document.dispatchEvent(new Event("x")); });
  await pagina.waitForTimeout(300);
  await pagina.screenshot({ path: path.join(PASTA, "som-escuro.png") });

  // Paleta de comandos
  await pagina.keyboard.press("Control+Shift+P");
  await pagina.waitForSelector(".lnux-paleta");
  await pagina.keyboard.type("metro");
  ok((await pagina.textContent(".lnux-paleta li.ativo")).includes("Metrônomo"), "a paleta de comandos acha 'Metrônomo' digitando 'metro'");
  await pagina.keyboard.press("Enter");
  await pagina.waitForTimeout(200);
  ok(await pagina.evaluate(() => Som.motor.metronomoLigado), "e o Enter liga o metrônomo");

  // Celular
  const celular = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const pc = await celular.newPage();
  pc.on("pageerror", (e) => consola.push("[pageerror celular] " + e.message));
  await pc.goto(`${BASE}/apps/som/`);
  await pc.waitForFunction(() => window.Som);
  await pc.waitForTimeout(1500);
  ok((await pc.getAttribute("html", "data-layout")) === "simples", "no celular, o layout Simples entra sozinho");
  const largura = await pc.evaluate(() => document.documentElement.scrollWidth);
  ok(largura <= 392, `no celular a página não rola para o lado (${largura} px)`);
  await pc.screenshot({ path: path.join(PASTA, "som-celular.png") });

  const relevantes = consola.filter((l) => !/AudioContext was not allowed|favicon/i.test(l));
  ok(relevantes.length === 0, "nenhum erro no console" + (relevantes.length ? ":\n    " + relevantes.join("\n    ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
