// Teste do app Efeitos no Chromium (Playwright). Rode com: python3 tests/testar_navegador.py
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

async function baixar(pagina, destino) {
  await pagina.waitForSelector(".lnux-dialogo footer button:has-text('Baixar pelo navegador')", { timeout: 90000 });
  const [d] = await Promise.all([pagina.waitForEvent("download"), pagina.click(".lnux-dialogo footer button:has-text('Baixar pelo navegador')")]);
  await d.saveAs(destino);
}

(async () => {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));

  await pagina.goto(`${BASE}/apps/efeitos/#token=${TOKEN}`);
  await pagina.waitForFunction(() => window.Efeitos && LNUX.ponte.disponivel, null, { timeout: 10000 });
  await pagina.evaluate(async () => { for (const k of await LNUX.guardado.chaves("efeitos:")) await LNUX.guardado.apagar(k); });
  await pagina.reload();
  await pagina.waitForFunction(() => window.Efeitos && LNUX.ponte.disponivel);
  await pagina.waitForTimeout(400);

  // Composição de exemplo
  let comp = await pagina.evaluate(() => Efeitos.comp);
  ok(comp.camadas.length === 2 && comp.camadas[0].tipo === "texto" && comp.camadas[1].tipo === "forma", "abre com um exemplo (título e faixa)");
  const zoom = await pagina.evaluate(() => { const f = Efeitos.comp.camadas[1]; return [0, 0.5, 1, 3].map((t) => Math.round(Efeitos.valor(f, "escala", t))); });
  ok(zoom[0] === 0 && zoom[1] > 80 && zoom[2] === 100 && zoom[3] === 100, `o zoom elástico vai de 0 a 100% (passa do ponto no meio): ${zoom.join(", ")}`);
  await pagina.evaluate(() => Efeitos.irPara(2));
  const desenhado = await pagina.evaluate(() => {
    const c = document.getElementById("quadro"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let azul = 0, branco = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i + 2] > 180 && d[i] < 160) azul++; if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) branco++; }
    return { azul, branco };
  });
  ok(desenhado.azul > 500 && desenhado.branco > 200, `o visor desenha a faixa (degradê) e o texto (${desenhado.azul} azuis, ${desenhado.branco} brancos)`);

  // Novo texto com T e animação à mão: ⏱ no X em 0 s, muda o X em 2 s
  await pagina.click("#faixas", { position: { x: 600, y: 4 } });
  await pagina.evaluate(() => Efeitos.irPara(0));
  await pagina.keyboard.press("t");
  comp = await pagina.evaluate(() => Efeitos.comp);
  ok(comp.camadas.length === 3 && comp.camadas[0].tipo === "texto" && comp.camadas[0].texto.conteudo === "Texto novo", "T cria uma camada de texto (por cima)");
  await pagina.click(".prop-linha:has(label:text-is('Horizontal')) .relogio");
  await pagina.evaluate(() => Efeitos.irPara(2));
  await pagina.fill(".prop-linha:has(label:text-is('Horizontal')) input", "300");
  await pagina.press(".prop-linha:has(label:text-is('Horizontal')) input", "Tab");
  const anim = await pagina.evaluate(() => { const c = Efeitos.comp.camadas[0]; return { chaves: c.anim.x, meio: Efeitos.valor(c, "x", 1) }; });
  ok(anim.chaves.length === 2 && anim.chaves[0].t === 0 && anim.chaves[0].v === 640 && anim.chaves[1].t === 2 && anim.chaves[1].v === 300, "com o ⏱ ligado, mudar o valor em outro tempo cria o 2º quadro-chave");
  ok(anim.meio < 640 && anim.meio > 300, `e no meio o valor fica entre os dois (${Math.round(anim.meio)} px em 1 s)`);
  ok((await pagina.$$(".faixa.prop .chave")).length >= 2, "os quadros-chave aparecem na linha do tempo");

  // Clicar num quadro-chave mostra a suavização; trocar para "Quicando"
  await pagina.click(".faixa.prop .chave >> nth=0");
  await pagina.waitForSelector("h3:has-text('Quadro-chave')");
  await pagina.selectOption(".lnux-secao:has(h3:has-text('Quadro-chave')) select", "pulo");
  ok((await pagina.evaluate(() => Efeitos.comp.camadas[0].anim.x[0].s)) === "pulo", "escolher o quadro-chave deixa trocar a suavização");
  await pagina.keyboard.press("Delete");
  ok((await pagina.evaluate(() => Efeitos.comp.camadas[0].anim.x.length)) === 1, "Del apaga o quadro-chave escolhido");
  await pagina.keyboard.press("Control+z");
  ok((await pagina.evaluate(() => Efeitos.comp.camadas[0].anim.x.length)) === 2, "Ctrl+Z traz de volta");

  // Arrastar no visor move a camada (cria quadro-chave porque o X está animado)
  await pagina.evaluate(() => Efeitos.irPara(1));
  const caixa = await pagina.$eval("#alcas", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const xAntes = await pagina.evaluate(() => Efeitos.valor(Efeitos.comp.camadas[0], "x", 1));
  const px = caixa.x + (xAntes / 1280) * caixa.w, py = caixa.y + caixa.h / 2;
  await pagina.mouse.move(px, py); await pagina.mouse.down(); await pagina.mouse.move(px + 60, py + 30, { steps: 5 }); await pagina.mouse.up();
  const depois = await pagina.evaluate(() => { const c = Efeitos.comp.camadas[0]; return { chaves: c.anim.x.length, y: c.props.y, x: Efeitos.valor(c, "x", 1) }; });
  ok(depois.chaves === 3 && depois.x > xAntes + 50 && depois.y > 360, `arrastar no visor move a camada (X ${Math.round(xAntes)} → ${Math.round(depois.x)}, novo quadro-chave em 1 s)`);

  // Animação pronta e modelo
  await pagina.evaluate(() => { Efeitos.irPara(0); Efeitos.aplicarPronta(Efeitos.comp.camadas[0], "quicar"); });
  ok(await pagina.evaluate(() => Efeitos.comp.camadas[0].anim.y[0].s === "pulo"), "animação pronta 'Cair quicando' usa a suavização certa");
  await pagina.evaluate(() => { Efeitos.irPara(0); Efeitos.aplicarModelo("confete"); Efeitos.irPara(0.8); });
  const confete = await pagina.evaluate(() => {
    const c = document.getElementById("quadro"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 140 && d[i + 1] > 110 && d[i + 2] < 100 && d[i] - d[i + 2] > 60) n++; // amarelos (meio transparentes)
    return { camadas: Efeitos.comp.camadas.length, tipo: Efeitos.comp.camadas[0].tipo, amarelos: n };
  });
  ok(confete.tipo === "particulas" && confete.amarelos > 300, `o modelo de confete solta partículas coloridas (${confete.amarelos} pontos amarelos)`);

  // Exportar: composição curta, GIF feito no navegador
  await pagina.evaluate(() => { const c = Efeitos.comp; c.duracao = 2; c.fps = 12; for (const l of c.camadas) l.fim = Math.min(l.fim, 2); Efeitos.irPara(0); });
  await pagina.keyboard.press("Escape");
  await pagina.keyboard.press("Control+e");
  await pagina.waitForSelector(".lnux-dialogo:has-text('Formato')");
  await pagina.selectOption(".lnux-dialogo select >> nth=0", "gif");
  await pagina.selectOption(".lnux-dialogo select >> nth=1", { index: 3 });
  await pagina.click(".lnux-dialogo footer button:has-text('Exportar')");
  const gif = path.join(PASTA, "efeitos.gif");
  await baixar(pagina, gif);
  const infoGif = JSON.parse(execFileSync("python3", ["-c", "import json,sys; from PIL import Image; im=Image.open(sys.argv[1]); n=getattr(im,'n_frames',1); print(json.dumps({'n':n,'w':im.size[0],'h':im.size[1],'d':im.info.get('duration')}))", gif]).toString());
  ok(infoGif.n === 24 && infoGif.w === Math.round(1280 * 0.33) && infoGif.d === 80, `o GIF sai com 24 quadros de ${infoGif.w}×${infoGif.h} (2 s a 12 quadros/s)`);

  // PNG com fundo transparente
  await pagina.evaluate(() => { Efeitos.comp.transparente = true; });
  await pagina.keyboard.press("Control+e");
  await pagina.selectOption(".lnux-dialogo select >> nth=0", "png");
  await pagina.click(".lnux-dialogo footer button:has-text('Exportar')");
  const zipPng = path.join(PASTA, "efeitos-png.zip");
  await baixar(pagina, zipPng);
  const infoPng = JSON.parse(execFileSync("python3", ["-c", "import json,sys,zipfile,io; from PIL import Image; z=zipfile.ZipFile(sys.argv[1]); n=z.namelist(); im=Image.open(io.BytesIO(z.read(n[0]))); print(json.dumps({'n':len(n),'modo':im.mode,'canto':im.getpixel((2,2))}))", zipPng]).toString());
  ok(infoPng.n === 24 && infoPng.modo === "RGBA" && infoPng.canto[3] === 0, `a sequência PNG tem 24 quadros com fundo transparente (canto: ${JSON.stringify(infoPng.canto)})`);
  await pagina.evaluate(() => { Efeitos.comp.transparente = false; });

  // Vídeo MP4 pela ponte (grava 2 s enquanto toca)
  await pagina.keyboard.press("Control+e");
  await pagina.selectOption(".lnux-dialogo select >> nth=0", "mp4");
  await pagina.click(".lnux-dialogo footer button:has-text('Exportar')");
  const mp4 = path.join(PASTA, "efeitos.mp4");
  await baixar(pagina, mp4);
  const infoMp4 = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mp4]).toString());
  const durMp4 = parseFloat(infoMp4.format.duration);
  ok(infoMp4.streams[0].codec_name === "h264" && infoMp4.streams[0].width === 1280 && durMp4 > 1.5 && durMp4 < 3, `o MP4 sai em H.264 1280×720 com ${durMp4.toFixed(2)} s`);

  // Pacote e recuperação
  const pacote = await pagina.evaluate(async () => { const z = await LNUX.Zip.ler(await Efeitos.gerarPacote()); return JSON.parse(await z.get("composicao.json").text()).camadas.length; });
  ok(pacote === 4, "o .lnuxefeitos guarda as 4 camadas");
  await pagina.waitForTimeout(1000);
  await pagina.reload();
  await pagina.waitForFunction(() => window.Efeitos && Efeitos.comp.camadas.length === 4, null, { timeout: 10000 });
  ok(true, "depois de recarregar, a composição volta (4 camadas)");
  await pagina.evaluate(() => { Efeitos.comp.duracao = 6; for (const l of Efeitos.comp.camadas) l.fim = 6; Efeitos.irPara(1.2); });
  await pagina.click(".nome-camada >> nth=1");
  await pagina.waitForTimeout(300);
  await pagina.screenshot({ path: path.join(PASTA, "efeitos.png") });

  const celular = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pc = await celular.newPage();
  pc.on("pageerror", (e) => consola.push("[pageerror celular] " + e.message));
  await pc.goto(`${BASE}/apps/efeitos/`);
  await pc.waitForFunction(() => window.Efeitos);
  await pc.waitForTimeout(1000);
  ok((await pc.getAttribute("html", "data-layout")) === "celular" && (await pc.evaluate(() => document.documentElement.scrollWidth)) <= 392, "no celular: layout Celular, sem rolar para o lado");
  await pc.screenshot({ path: path.join(PASTA, "efeitos-celular.png") });

  ok(consola.length === 0, "nenhum erro no console" + (consola.length ? ":\n    " + consola.join("\n    ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
