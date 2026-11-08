// Teste do app Vídeo no Chromium (Playwright). Rode com: python3 tests/testar_navegador.py
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// As variáveis vêm de tests/testar_navegador.py (que sobe o servidor com pastas temporárias)
const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const MIDIAS = process.env.LNUX_TESTE_MIDIAS || path.join(PASTA, "midias");
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));

  await pagina.goto(`${BASE}/apps/video/#token=${TOKEN}`);
  await pagina.waitForFunction(() => window.Video && LNUX.ponte.disponivel, null, { timeout: 10000 });
  // começa de um projeto limpo (o navegador do teste pode ter um guardado)
  await pagina.evaluate(async () => { for (const k of await LNUX.guardado.chaves("video:")) await LNUX.guardado.apagar(k); });
  await pagina.reload();
  await pagina.waitForFunction(() => window.Video && LNUX.ponte.disponivel);

  // Importar três mídias pela janela da ponte (Ctrl+clique escolhe várias)
  await pagina.click("#botao-importar");
  await pagina.fill(".lnux-pastas .caminho input", MIDIAS);
  await pagina.press(".lnux-pastas .caminho input", "Enter");
  await pagina.waitForSelector(".lnux-pastas li:has-text('video.mp4')");
  await pagina.click(".lnux-pastas li:has-text('video.mp4')");
  await pagina.click(".lnux-pastas li:has-text('foto.png')", { modifiers: ["Control"] });
  await pagina.click(".lnux-pastas li:has-text('musica.mp3')", { modifiers: ["Control"] });
  ok(!(await pagina.isVisible(".lnux-pastas li.desligado:has-text('tom.wav')")), "na janela do Vídeo, áudio também pode ser escolhido");
  await pagina.click(".lnux-dialogo footer button:has-text('Abrir')");
  await pagina.waitForFunction(() => Object.keys(Video.projeto.midias).length === 3, null, { timeout: 20000 });
  const midias = await pagina.evaluate(() => Object.values(Video.projeto.midias).map((m) => ({ nome: m.nome, tipo: m.tipo, d: m.duracao, w: m.largura, h: m.altura, mini: !!m.miniatura, caminho: m.caminho })));
  const v = midias.find((m) => m.nome === "video.mp4");
  ok(v && v.tipo === "video" && Math.abs(v.d - 4) < 0.2 && v.w === 640 && v.h === 360 && v.mini, `o vídeo entra com duração, tamanho e miniatura (${v && v.w}×${v && v.h}, ${v && v.d.toFixed(2)} s)`);
  ok(midias.find((m) => m.nome === "foto.png").tipo === "imagem" && midias.find((m) => m.nome === "musica.mp3").tipo === "audio", "a foto e a música são reconhecidas");
  ok(midias.every((m) => m.caminho && m.caminho.startsWith(MIDIAS)), "as mídias da ponte guardam o caminho no aparelho (não são copiadas para o navegador)");

  // Pôr na linha do tempo: vídeo (dois cliques), música (dois cliques)
  await pagina.dblclick(".midia:has-text('video.mp4')");
  await pagina.evaluate(() => Video.irPara(0));
  await pagina.dblclick(".midia:has-text('musica.mp3')");
  let p = await pagina.evaluate(() => Video.projeto);
  const trilhaDe = (c) => p.trilhas.find((t) => t.id === c.trilha).tipo;
  ok(p.clipes.length === 2 && trilhaDe(p.clipes[0]) === "video" && trilhaDe(p.clipes[1]) === "audio", "o vídeo vai para uma trilha de vídeo e a música para uma de áudio");

  // O quadro aparece (testsrc2 é colorido)
  await pagina.evaluate(() => Video.irPara(1));
  await pagina.waitForTimeout(900);
  const colorido = await pagina.evaluate(() => {
    const c = document.getElementById("quadro"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 400) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) n++;
    return n;
  });
  ok(colorido > 200, `o monitor mostra o quadro do vídeo (${colorido} pontos coloridos)`);

  // Look preto e branco no clipe de vídeo
  await pagina.evaluate(() => { const c = Video.projeto.clipes.find((x) => x.tipo === "midia" && Video.projeto.midias[x.midia].tipo === "video"); Object.assign(c.cor, { saturacao: -1 }); Video.irPara(1.01); });
  await pagina.waitForTimeout(500);
  const cinza = await pagina.evaluate(() => {
    const c = document.getElementById("quadro"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 400) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) n++;
    return n;
  });
  ok(cinza < 20, `o look sem saturação deixa o quadro em preto e branco (${cinza} pontos coloridos)`);
  await pagina.evaluate(() => { Video.projeto.clipes.forEach((c) => c.cor && (c.cor.saturacao = 0)); });

  // Título com a tecla T
  await pagina.click("#rolagem", { position: { x: 900, y: 5 } });
  await pagina.evaluate(() => Video.irPara(0.5));
  await pagina.keyboard.press("t");
  p = await pagina.evaluate(() => Video.projeto);
  const texto = p.clipes.find((c) => c.tipo === "texto");
  ok(texto && texto.inicio === 0.5 && trilhaDe(texto) === "video", "T cria um título no cursor, numa trilha de vídeo");
  ok(p.trilhas.findIndex((t) => t.id === texto.trilha) < p.trilhas.findIndex((t) => t.id === p.clipes[0].trilha), "o título fica numa trilha acima do vídeo (aparece por cima)");
  await pagina.evaluate(() => Video.irPara(2));
  await pagina.waitForTimeout(400);
  const branco = await pagina.evaluate(() => {
    const c = document.getElementById("quadro"), d = c.getContext("2d").getImageData(c.width * 0.3, c.height * 0.4, c.width * 0.4, c.height * 0.2).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) n++;
    return n;
  });
  ok(branco > 500, `o título aparece no meio da imagem (${branco} pontos brancos)`);

  // Separar o vídeo no cursor
  await pagina.evaluate(() => { Video.irPara(2.5); });
  await pagina.click("#rolagem", { position: { x: 1000, y: 5 } }); // clica no vazio (tira a seleção)
  await pagina.evaluate(() => Video.irPara(2.5));
  const antes = await pagina.evaluate(() => Video.projeto.clipes.length);
  await pagina.keyboard.press("s");
  p = await pagina.evaluate(() => Video.projeto);
  const partesVideo = p.clipes.filter((c) => c.midia && p.midias[c.midia].nome === "video.mp4").sort((a, b) => a.inicio - b.inicio);
  ok(p.clipes.length > antes && partesVideo.length === 2 && Math.abs(partesVideo[1].entrada - 2.5) < 0.05, "S separa os clipes no cursor e a segunda parte continua do ponto certo");
  await pagina.keyboard.press("Control+z");
  ok((await pagina.evaluate(() => Video.projeto.clipes.length)) === antes, "Ctrl+Z desfaz");

  // Tocar 1 s
  await pagina.evaluate(() => Video.irPara(0));
  await pagina.keyboard.press(" ");
  await pagina.waitForTimeout(1200);
  const tocando = await pagina.evaluate(() => {
    const c = Video.projeto.clipes.find((x) => x.midia && Video.projeto.midias[x.midia].nome === "video.mp4");
    const item = Video.motor.elementos.get(c.id);
    return { cursor: Video.cursor, video: item && item.el.currentTime, pausado: item && item.el.paused };
  });
  ok(tocando.cursor > 0.8 && tocando.video > 0.6 && !tocando.pausado, `Espaço toca: o cursor e o vídeo andam juntos (${tocando.cursor.toFixed(2)} s · vídeo em ${tocando.video && tocando.video.toFixed(2)} s)`);
  await pagina.keyboard.press(" ");

  // Legendas SRT: ler e escrever
  const srt = await pagina.evaluate(() => {
    const itens = Video.lerSrt("1\n00:00:01,000 --> 00:00:02,500\nOlá, mundo\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>Tchau</i>\n");
    const clipes = itens.map((x) => ({ inicio: x.inicio, duracao: x.fim - x.inicio, texto: { conteudo: x.texto } }));
    return { itens, volta: Video.srtDe(clipes) };
  });
  ok(srt.itens.length === 2 && srt.itens[0].inicio === 1 && srt.itens[1].texto === "Tchau", "o SRT é lido (e as marcas como <i> saem)");
  ok(srt.volta.includes("00:00:01,000 --> 00:00:02,500\nOlá, mundo"), "e escrito de volta no mesmo formato");

  // Exportar em MP4 (grava enquanto toca + ffmpeg da ponte); tira a música para ficar com 4 s
  await pagina.evaluate(() => { const p = Video.projeto; p.clipes = p.clipes.filter((c) => !(c.midia && p.midias[c.midia].nome === "musica.mp3")); const t = p.clipes.find((c) => c.tipo === "texto"); t.duracao = 2; Video.irPara(0); });
  await pagina.keyboard.press("Control+e");
  await pagina.waitForSelector(".lnux-dialogo:has-text('Exportar o vídeo')");
  ok((await pagina.$eval(".lnux-dialogo select", (s) => s.value)) === "mp4", "com a ponte e o ffmpeg, o formato padrão é MP4");
  await pagina.click(".lnux-dialogo footer button:has-text('Exportar')");
  await pagina.waitForSelector(".lnux-dialogo:has-text('Salvar o vídeo')", { timeout: 60000 });
  const [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click(".lnux-dialogo footer button:has-text('Baixar pelo navegador')")]);
  const destino = path.join(PASTA, "exportado.mp4");
  await baixado.saveAs(destino);
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", destino]).toString());
  const temVideo = info.streams.some((s) => s.codec_type === "video" && s.codec_name === "h264");
  const temAudio = info.streams.some((s) => s.codec_type === "audio");
  const dur = parseFloat(info.format.duration);
  ok(temVideo && temAudio && dur > 3.3 && dur < 5, `o MP4 exportado tem vídeo H.264 e som, com ${dur.toFixed(2)} s`);

  // Projeto .lnuxvideo: uma mídia do navegador vai junto; as da ponte ficam só com o caminho
  await pagina.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    await Video.adicionarArquivos([{ nome: "clipe.webm", tipo: "video/webm", tamanho: blob.size, origem: "navegador", blob: async () => blob }]);
  }, `/api/arquivo?caminho=${encodeURIComponent(MIDIAS + "/clipe.webm")}`);
  const pacote = await pagina.evaluate(async () => { const z = await LNUX.Zip.ler(await Video.gerarPacote()); return [...z.keys()]; });
  ok(pacote.includes("projeto.json") && pacote.filter((n) => n.startsWith("midias/")).length === 1, `o .lnuxvideo leva só a mídia do navegador (${pacote.join(", ")})`);

  // Recarregar: volta tudo (a do navegador do IndexedDB, as da ponte pelo caminho)
  const n = await pagina.evaluate(() => Video.projeto.clipes.length);
  await pagina.waitForTimeout(1300);
  await pagina.reload();
  await pagina.waitForFunction(() => window.Video && Object.keys(Video.projeto.midias).length === 4, null, { timeout: 15000 });
  await pagina.waitForTimeout(800);
  const rest = await pagina.evaluate(() => ({ n: Video.projeto.clipes.length, urls: Object.keys(Video.projeto.midias).filter((id) => Video.motor.urls.get(id)).length }));
  ok(rest.n === n && rest.urls === 4, `depois de recarregar, o projeto e as 4 mídias voltam (${rest.n} clipes, ${rest.urls} mídias abertas)`);
  await pagina.evaluate(() => Video.irPara(1.2));
  await pagina.waitForTimeout(700);
  await pagina.screenshot({ path: path.join(PASTA, "video-edicao.png") });

  // Celular
  const celular = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pc = await celular.newPage();
  pc.on("pageerror", (e) => consola.push("[pageerror celular] " + e.message));
  await pc.goto(`${BASE}/apps/video/`);
  await pc.waitForFunction(() => window.Video);
  await pc.waitForTimeout(1200);
  ok((await pc.getAttribute("html", "data-layout")) === "celular", "no celular, o layout Celular entra sozinho");
  ok((await pc.evaluate(() => document.documentElement.scrollWidth)) <= 392, "e a página não rola para o lado");
  await pc.screenshot({ path: path.join(PASTA, "video-celular.png") });
  await pc.click("#abas-celular button[data-aba='propriedades']");
  ok(await pc.isVisible("#propriedades"), "as abas do celular trocam para Propriedades");

  ok(consola.length === 0, "nenhum erro no console" + (consola.length ? ":\n    " + consola.join("\n    ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
