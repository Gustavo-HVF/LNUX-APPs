// Teste das personagens VRoid (.vrm) na Companhia, com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_vrm
//
// Usa o modelo de exemplo da pixiv (VRM1_Constraint_Twist_Sample.vrm, do repositório do three-vrm: redistribuição
// e modificação permitidas, crédito não exigido). Ele é baixado na hora (ou use LNUX_TESTE_VRM=/caminho/modelo.vrm).
// Cobre: importar o .vrm pela tela sem o núcleo do Live2D, a personagem desenhada com cor, emoções nas expressões
// do VRM, boca com a voz, piscar, gesto, áreas de toque seguindo o corpo (cafuné), peças de roupa (esconder e
// trocar a textura), segunda roupa, trocar pelo botão e pela conversa ("troca de roupa"), recarregar mantendo
// tudo, o item de roupa do VRoid Studio (.vroidcustomitem) explicado e as texturas dele guardadas, exportar e
// importar de volta, e trocar entre uma personagem VRoid e uma Live2D (se houver LNUX_TESTE_MODELO e o núcleo).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const URL_VRM = "https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** Um PNG de cor única (para trocar a textura de uma peça). */
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo); const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; linhas[i] = r; linhas[i + 1] = g; linhas[i + 2] = b; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(linhas)), bloco("IEND", Buffer.alloc(0))]);
}
/** Um ZIP simples (store), para montar um "item de roupa do VRoid" de mentira. */
function zip(arquivos) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, dados] of arquivos) {
    const n = Buffer.from(nome), c = crc(dados);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt32LE(c, 14); loc.writeUInt32LE(dados.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(c, 16); cen.writeUInt32LE(dados.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(pos, 42);
    partes.push(loc, n, dados); central.push(cen, n);
    pos += 30 + n.length + dados.length;
  }
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fim]);
}

(async () => {
  let vrm = process.env.LNUX_TESTE_VRM || path.join(PASTA, "exemplo-pixiv.vrm");
  if (!fs.existsSync(vrm)) {
    try {
      const r = await fetch(URL_VRM);
      if (!r.ok) throw new Error("HTTP " + r.status);
      fs.writeFileSync(vrm, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.log(`  ⏭  Pulado: não deu para baixar o modelo de exemplo da pixiv (${e.message}). Use LNUX_TESTE_VRM=/caminho/modelo.vrm.`);
      return;
    }
  }
  const segundo = path.join(PASTA, "roupa-2.vrm");
  fs.copyFileSync(vrm, segundo); // a "outra roupa": o mesmo modelo exportado de novo
  const vermelho = path.join(PASTA, "vermelho.png");
  fs.writeFileSync(vermelho, png(64, 64, [220, 20, 40]));
  const itemVroid = path.join(PASTA, "Angels.skirt_customitem.zip");
  fs.writeFileSync(itemVroid, zip([
    ["Angels.skirt_customitem/customitem/angels_skirt.vroidcustomitem", Buffer.from("item de mentira")],
    ["Angels.skirt_customitem/Black.female/Dress.Black.png", png(8, 8, [10, 10, 10])],
    ["Angels.skirt_customitem/White.female/Dress.White.png", png(8, 8, [250, 250, 250])],
  ]));

  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  // sem o núcleo do Live2D: as personagens VRoid não precisam dele
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const importarPelaTela = async (arquivo) => {
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arquivo);
  };
  const brilho = () => ev(async () => {
    const b = await window.Companhia.palco.foto(); const img = await createImageBitmap(b); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0, s = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) { n++; s += d[i] + d[i + 1] + d[i + 2]; }
    return { n, brilho: n ? Math.round(s / n / 3) : 0 };
  });
  const ultimaDela = () => ev(() => { const m = [...document.querySelectorAll("#mensagens .msg.ela .t")]; return m.length ? m[m.length - 1].textContent : ""; });
  const contarDela = () => ev(() => document.querySelectorAll("#mensagens .msg.ela").length);

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 20000 });
    ok(await ev(() => window.Companhia.live2d) === null, "sem o núcleo do Live2D (para provar que o VRoid não precisa dele)");

    // ── importar o .vrm pela tela ──
    await importarPelaTela(vrm);
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
    await esperar(800);
    const info = await ev(() => ({ tipo: window.Companhia.atual.tipo, roupas: window.Companhia.atual.roupas.length, pecas: window.Companhia.palco.pecas.map((x) => x.nome),
      vazio: document.querySelector("#palco-vazio").hidden, canvas3d: !!document.querySelector(".palco-3d"), chip: document.querySelector("#chip-roupa").hidden ? "" : document.querySelector("#chip-roupa").textContent }));
    ok(info.tipo === "vrm" && info.vazio && info.canvas3d, "personagem VRoid importada e aberta no palco 3D");
    const cor = await brilho();
    ok(cor.n > 3000 && cor.brilho > 40, `a personagem aparece com cor (${cor.n} pontos, brilho ${cor.brilho})`);
    ok(info.pecas.length >= 3 && info.pecas.every((n) => !/Outline|Instance/.test(n)), "peças de roupa encontradas: " + info.pecas.join(", "));
    ok(/👗/.test(info.chip), `botão de roupa no palco (${info.chip})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-vrm-1.png") });

    // ── emoções, boca, piscar, gesto ──
    await ev(() => window.Companhia.palco.definirEmocao("feliz"));
    await esperar(800);
    const feliz = await ev(() => window.Companhia.palco.expressao("happy"));
    await ev(() => window.Companhia.palco.definirEmocao("triste"));
    await esperar(800);
    const triste = await ev(() => [window.Companhia.palco.expressao("sad"), window.Companhia.palco.expressao("happy")]);
    ok(feliz > 0.5 && triste[0] > 0.5 && triste[1] < 0.2, `emoções nas expressões do VRM (feliz: happy ${feliz.toFixed(2)}; triste: sad ${triste[0].toFixed(2)})`);
    await ev(() => { window.Companhia.palco.definirEmocao("neutra"); window.Companhia.palco.falar(1); });
    await esperar(300);
    const boca = await ev(() => window.Companhia.palco.expressao("aa"));
    await ev(() => window.Companhia.palco.falar(0));
    ok(boca > 0.5, `boca acompanha a voz (aa ${boca.toFixed(2)})`);
    const piscou = await ev(async () => { let m = 0; const t0 = performance.now(); while (performance.now() - t0 < 7000) { m = Math.max(m, window.Companhia.palco.expressao("blink")); await new Promise((r) => requestAnimationFrame(r)); } return m; });
    ok(piscou > 0.6, `pisca sozinha (blink chegou a ${piscou.toFixed(2)})`);
    const mao = await ev(async () => {
      const p = window.Companhia.palco, antes = p.posicao("rightHand").y - p.posicao("rightUpperArm").y;
      p.gesto("acenar");
      await new Promise((r) => setTimeout(r, 900));
      return [antes, p.posicao("rightHand").y - p.posicao("rightUpperArm").y];
    });
    ok(mao[0] < 0 && mao[1] > 0.1, `acenar levanta o braço (mão ${mao[0].toFixed(2)} → ${mao[1].toFixed(2)} m em relação ao ombro)`);

    // ── toque: as áreas seguem o corpo ──
    await esperar(1200);
    const ponto = (zona) => ev((z) => {
      const p = window.Companhia.palco, zz = p.toques.zonas.find((x) => x.id === z), [a, b, c, d] = zz.rets[0];
      const q = p.deModelo((a + c) / 2, (b + d) / 2), r = document.querySelector("#palco").getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    }, zona);
    const cab = await ponto("cabeca");
    const n0 = await contarDela();
    await pagina.mouse.move(cab.x, cab.y);
    await pagina.mouse.down();
    for (let i = 0; i < 6; i++) { await pagina.mouse.move(cab.x + 30, cab.y, { steps: 4 }); await pagina.mouse.move(cab.x - 30, cab.y, { steps: 4 }); }
    await pagina.mouse.up();
    await pagina.waitForFunction((n) => document.querySelectorAll("#mensagens .msg.ela").length > n && !window.Companhia.respondendo, n0, { timeout: 10000 });
    const toque = await ev(() => [...document.querySelectorAll("#mensagens .msg.toque")].pop().textContent);
    ok(/carinho/.test(toque) && /Cabeça/.test(toque), `cafuné na cabeça da personagem 3D: ${toque} → ${await ultimaDela()}`);

    // ── roupas: esconder uma peça e trocar a textura ──
    await pagina.click("#chip-roupa");
    await pagina.click('.lnux-menu button:has(.rotulo:text-is("Peças, cores e mais roupas..."))');
    await pagina.waitForSelector(".linha-peca");
    const peca = info.pecas.find((n) => /Tops/i.test(n)) || info.pecas[0];
    await pagina.locator(`.linha-peca:has-text("${peca}") input[type=checkbox]`).uncheck();
    await esperar(200);
    const oculta = await ev((n) => window.Companhia.palco.pecas.find((x) => x.nome === n).materiais.every((m) => m.visible === false), peca);
    ok(oculta, `esconder a peça "${peca}"`);
    await pagina.locator(`.linha-peca:has-text("${peca}") input[type=checkbox]`).check();
    const [escTex] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.selectOption(`.linha-peca:has-text("${peca}") select`, "arquivo").then(() => pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")'))]);
    await escTex.setFiles(vermelho);
    await pagina.waitForFunction((n) => { const r = window.Companhia.atual.roupas.find((x) => x.id === window.Companhia.atual.roupaAtual); return !!r.texturas[n]; }, peca, { timeout: 10000 });
    const largura = await ev((n) => window.Companhia.palco.pecas.find((x) => x.nome === n).materiais[0].map.image.width, peca);
    ok(largura === 64, `trocar a textura da peça por outra imagem (${largura}×${largura})`);
    await pagina.locator(`.linha-peca:has-text("Bottoms") input[type=checkbox]`).uncheck().catch(() => {});

    // ── segunda roupa ──
    const [escRoupa] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo button:text-is("Adicionar roupa (.vrm)...")').then(() => pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")'))]);
    await escRoupa.setFiles(segundo);
    await pagina.waitForFunction(() => window.Companhia.atual.roupas.length === 2, null, { timeout: 15000 });
    ok(true, "segunda roupa adicionada (outro .vrm da mesma personagem)");
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    const primeira = await ev(() => window.Companhia.atual.roupaAtual);
    await pagina.click("#chip-roupa");
    await pagina.click('.lnux-menu button:has(.rotulo:text-is("roupa-2"))');
    await pagina.waitForFunction((id) => window.Companhia.atual.roupaAtual !== id && window.Companhia.palco.modelo && window.Companhia.palco.roupa.nome === "roupa-2", primeira, { timeout: 30000 });
    await esperar(400);
    ok((await brilho()).brilho > 40 && /roupa-2/.test(await pagina.textContent("#chip-roupa")), "trocar de roupa pelo botão do palco");
    const n1 = await contarDela();
    await pagina.fill("#texto", "troca de roupa, por favor");
    await pagina.press("#texto", "Enter");
    await pagina.waitForFunction((n) => document.querySelectorAll("#mensagens .msg.ela").length > n && !window.Companhia.respondendo, n1, { timeout: 30000 });
    const r = await ultimaDela();
    ok(await ev((id) => window.Companhia.atual.roupaAtual === id, primeira) && /troquei/i.test(r), `trocar de roupa pela conversa (0 tokens): ${r}`);

    // ── recarregar: tudo guardado ──
    await pagina.reload();
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
    const depois = await ev(() => { const p = window.Companhia.palco, a = window.Companhia.atual, r = a.roupas.find((x) => x.id === a.roupaAtual);
      return { roupas: a.roupas.length, ocultas: r.ocultas, tex: Object.keys(r.texturas), vis: p.pecas.filter((x) => !x.visivel).map((x) => x.nome), largura: (p.pecas.find((x) => r.texturas[x.nome]) || { materiais: [{ map: { image: {} } }] }).materiais[0].map.image.width }; });
    ok(depois.roupas === 2 && depois.tex.includes(peca) && depois.largura === 64 && depois.vis.join() === depois.ocultas.join() && depois.ocultas.some((n) => /Bottoms/.test(n)),
      `ao abrir de novo: 2 roupas, textura trocada e peça escondida continuam (${JSON.stringify(depois)})`);

    // ── o item de roupa do VRoid Studio (.vroidcustomitem) ──
    await importarPelaTela(itemVroid);
    await pagina.waitForSelector('.lnux-dialogo h2:text-is("Item de roupa do VRoid Studio")', { timeout: 15000 });
    const explicacao = await pagina.textContent(".lnux-dialogo:last-of-type .corpo");
    ok(/só abre lá/.test(explicacao) && /VRM/.test(explicacao), "o item de roupa do VRoid Studio é explicado (só abre no VRoid Studio; exportar como VRM)");
    await pagina.click('.lnux-dialogo footer button:text-is("Guardar as texturas")');
    await pagina.waitForFunction(() => (window.Companhia.atual.variacoes || []).length === 2, null, { timeout: 10000 });
    ok(true, "as texturas do pacote (Black e White) viram variações de cor da personagem");
    await ev(() => { window.Companhia.janelaRoupas(); }); // abre a janela (sem esperar ela fechar)
    await pagina.waitForSelector(".linha-peca select");
    const opcoes = await pagina.locator(".linha-peca select").first().locator("option").allTextContents();
    ok(opcoes.some((o) => /Black\.female \/ Dress\.Black\.png/.test(o)), "as variações aparecem para escolher em cada peça");
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');

    // ── exportar e importar de volta ──
    await menu("Personagem", "Exportar personagem (ZIP)...");
    await pagina.waitForSelector(".lnux-dialogo");
    if (await pagina.isVisible('.lnux-dialogo footer button:text-is("Exportar")')) await pagina.click('.lnux-dialogo footer button:text-is("Exportar")');
    const [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click('.lnux-dialogo footer button:text-is("Baixar pelo navegador")')]);
    const exportado = path.join(PASTA, "exportada-vrm.zip");
    fs.copyFileSync(await baixado.path(), exportado);
    await importarPelaTela(exportado);
    await pagina.waitForFunction(() => window.Companhia.pronto && window.Companhia.atual && window.Companhia.palco.modelo && (window.C.listarPersonagens ? true : false), null, { timeout: 60000 });
    await pagina.waitForFunction(async () => (await window.C.listarPersonagens()).length === 2, null, { timeout: 30000 });
    const volta = await ev(() => { const a = window.Companhia.atual, r = a.roupas.find((x) => x.id === a.roupaAtual); return { roupas: a.roupas.map((x) => x.nome), tex: Object.keys(r.texturas), variacoes: (a.variacoes || []).length }; });
    ok(volta.roupas.length === 2 && volta.variacoes === 2, `exportar (ZIP com as roupas e as texturas) e importar de volta: ${JSON.stringify(volta)}`);

    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
    await pagina.screenshot({ path: path.join(PASTA, "companhia-vrm-2.png") });
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-vrm-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (VRoid): ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
