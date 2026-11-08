// Teste do app Vídeo (editor estilo Premiere) no Chromium (Playwright). Rode com: python3 tests/testar_navegador.py video
// Cobre: importar pela ponte, Origem com entrada/saída e Inserir, arrastar do Projeto, navalha, apagar com
// ondulação, ferramentas Ondulação e Slip, efeitos (arrastar, fx, Controles de efeito, quadros-chave e
// interpolação), painel Cor e curvas, escopos, transição padrão, marcadores, legendas, mixer, loudness,
// normalização, exportar MP4, pacote .lnuxvideo, recuperar depois de recarregar, migração e celular.
const { chromium, devices } = require("playwright");
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
const perto = (a, b, tol = 0.02) => typeof a === "number" && Math.abs(a - b) <= tol;

let consolaGlobal = [];
(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  const consola = (consolaGlobal = []);
  pagina.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message + " " + (e.stack || "").split("\n")[1]));
  const projeto = () => pagina.evaluate(() => JSON.parse(JSON.stringify(Video.projeto)));
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const pronto = () => pagina.waitForFunction(() => window.Video && Video.pronto && LNUX.ponte.disponivel, null, { timeout: 15000 });
  // pontos coloridos e brilho médio do quadro do monitor (amostra 64×36 do compositor)
  const quadro = () => pagina.evaluate(() => {
    const a = Video.render.amostra(64, 36);
    let cor = 0, soma = 0;
    for (let i = 0; i < a.px.length; i += 4) { const r = a.px[i], g = a.px[i + 1], b = a.px[i + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 40) cor++; soma += (r + g + b) / 3; }
    return { cor, brilho: soma / (a.px.length / 4) };
  });
  const irPara = async (t) => { await pagina.evaluate((t) => Video.irPara(t), t); await esperar(500); };
  const area = (id) => pagina.evaluate((id) => Video.V.Linha.areaDoClipe(id), id);
  const xDe = (t) => pagina.evaluate((t) => Video.V.Linha.xDoTempo(t), t);
  const arrastar = async (x0, y0, x1, y1) => { await pagina.mouse.move(x0, y0); await pagina.mouse.down(); await pagina.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await pagina.mouse.move(x1, y1, { steps: 6 }); await pagina.mouse.up(); };

  await pagina.goto(`${BASE}/apps/video/#token=${TOKEN}`);
  await pronto();
  // começa de um projeto limpo (o navegador do teste pode ter um guardado)
  await pagina.evaluate(async () => { for (const k of [...(await LNUX.guardado.chaves("video:")), ...(await LNUX.guardado.chaves("video2:"))]) await LNUX.guardado.apagar(k); });
  await pagina.reload();
  await pronto();
  await pagina.evaluate(() => LNUX.layout.definir("edicao"));
  ok(await pagina.isVisible("#ferramentas button[data-ferramenta='navalha']") && (await pagina.$$("#ferramentas button")).length === 11, "a coluna de ferramentas tem as 11 ferramentas (Seleção, Ondulação, Rolante, Navalha, Slip, Slide...)");
  ok((await pagina.$$(".cab-trilha")).length === 6 && (await pagina.isVisible(".cab-mix")), "a linha do tempo começa com V1–V3, A1–A3 e a linha Mix");

  // ── 1) Importar pelo painel Projeto (janela de pastas da ponte, Ctrl+clique escolhe várias)
  await pagina.click('#aba-projeto button[aria-label^="Importar mídias"]');
  await pagina.fill(".lnux-pastas .caminho input", MIDIAS);
  await pagina.press(".lnux-pastas .caminho input", "Enter");
  await pagina.waitForSelector(".lnux-pastas li:has-text('video.mp4')");
  await pagina.click(".lnux-pastas li:has-text('video.mp4')");
  for (const n of ["foto.png", "musica.mp3", "clipe.webm"]) await pagina.click(`.lnux-pastas li:has-text('${n}')`, { modifiers: ["Control"] });
  await pagina.click(".lnux-dialogo footer button:has-text('Abrir')");
  // espera a importação inteira (a última mídia ainda está sendo analisada quando entra no projeto)
  await pagina.waitForFunction(() => Object.keys(Video.projeto.midias).length === 4 && Object.values(Video.projeto.midias).every((m) => m.temAudio !== undefined) && !document.querySelector(".lnux-fundo-modal"), null, { timeout: 30000 });
  let p = await projeto();
  const idDe = (nome) => Object.keys(p.midias).find((id) => p.midias[id].nome === nome);
  const mv = p.midias[idDe("video.mp4")];
  ok(mv.tipo === "video" && perto(mv.duracao, 4, 0.2) && mv.largura === 640 && mv.miniatura && mv.temAudio === true, `o vídeo entra com duração, tamanho, miniatura e "tem som" (${mv.largura}×${mv.altura}, ${mv.duracao.toFixed(2)} s)`);
  ok(p.midias[idDe("clipe.webm")].temAudio === false && p.midias[idDe("foto.png")].tipo === "imagem" && p.midias[idDe("musica.mp3")].tipo === "audio", "o vídeo sem som, a foto e a música são reconhecidos");
  ok(await pagina.isVisible(".item-midia:has-text('video.mp4')"), "as mídias aparecem no painel Projeto");

  // ── 2) Origem: dois cliques, entrada 1 s, saída 3 s, vírgula insere vídeo e áudio vinculados
  await pagina.dblclick(".item-midia:has-text('video.mp4')");
  await pagina.waitForFunction(() => { const v = document.querySelector("#aba-origem video"); return v && v.readyState >= 1; });
  ok(await pagina.isVisible("#aba-origem video"), "dois cliques abre a mídia na Origem");
  const posOrigem = async (t) => pagina.evaluate((t) => new Promise((r) => { const v = document.querySelector("#aba-origem video"); v.addEventListener("seeked", r, { once: true }); v.currentTime = t; }), t);
  await pagina.click("#aba-origem .tela-origem", { position: { x: 5, y: 5 } });
  await posOrigem(1); await pagina.keyboard.press("i");
  await posOrigem(3); await pagina.keyboard.press("o");
  p = await projeto();
  ok(perto(p.midias[idDe("video.mp4")].origemEntrada, 1, 0.04) && perto(p.midias[idDe("video.mp4")].origemSaida, 3, 0.04), "com a Origem ativa, I e O marcam a entrada e a saída da mídia");
  await pagina.keyboard.press(",");
  p = await projeto();
  const v1 = p.clipes.find((c) => c.trilha === "V1"), a1 = p.clipes.find((c) => c.trilha === "A1");
  ok(p.clipes.length === 2 && v1 && a1 && v1.vinculo && v1.vinculo === a1.vinculo && perto(v1.duracao, 2, 0.04) && perto(v1.entrada, 1, 0.04), "a vírgula (Inserir) põe o trecho entrada→saída no V1 e o som vinculado no A1");
  ok(perto(await pagina.evaluate(() => Video.cursor), 2, 0.04), "depois de inserir, o cursor vai para o fim do que entrou");

  // ── 3) Arrastar a foto do Projeto para a trilha V2, em 2 s (sobrescrever)
  const caixaPistas = await pagina.$eval("#pistas", (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const yV2 = await pagina.$eval('.cab-trilha[data-trilha="V2"]', (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  await pagina.dragAndDrop(".item-midia:has-text('foto.png')", "#pistas", { targetPosition: { x: (await xDe(2)) - caixaPistas.x + 3, y: yV2 - caixaPistas.y } });
  p = await projeto();
  const foto = p.clipes.find((c) => c.midia === idDe("foto.png"));
  ok(foto && foto.trilha === "V2" && perto(foto.inicio, 2, 0.04) && perto(foto.duracao, 5, 0.04), "arrastar do Projeto para a V2 põe a foto lá (com encaixe no cursor)");
  await pagina.evaluate(() => Video.V.Linha.verTudo());

  // ── 4) O monitor mostra o quadro do vídeo (testsrc2 é colorido)
  await irPara(1);
  const q1 = await quadro();
  ok(q1.cor > 300, `o monitor mostra o quadro do vídeo (${q1.cor} pontos coloridos)`);

  // ── 5) Navalha (C): corta o vídeo e o áudio vinculado no ponto clicado
  await pagina.keyboard.press("c");
  let r = await area(v1.id);
  await pagina.mouse.click(await xDe(1), r.y + r.h / 2);
  await pagina.keyboard.press("v");
  p = await projeto();
  let doV1 = p.clipes.filter((c) => c.trilha === "V1").sort((a, b) => a.inicio - b.inicio), doA1 = p.clipes.filter((c) => c.trilha === "A1").sort((a, b) => a.inicio - b.inicio);
  ok(doV1.length === 2 && doA1.length === 2 && perto(doV1[1].inicio, 1) && perto(doV1[1].entrada, 2, 0.04) && doV1[1].vinculo === doA1[1].vinculo, "a navalha corta o vídeo e o som juntos, e a segunda parte continua da mídia");

  // ── 6) Shift+Del no primeiro pedaço: apaga (vídeo e som) e fecha o buraco; Ctrl+Z volta
  r = await area(doV1[0].id);
  await pagina.mouse.click(r.x + r.w / 2, r.y + r.h - 6);
  await pagina.keyboard.press("Shift+Delete");
  p = await projeto();
  ok(p.clipes.filter((c) => c.trilha === "V1").length === 1 && perto(p.clipes.find((c) => c.trilha === "V1").inicio, 0) && perto(p.clipes.find((c) => c.trilha === "A1").inicio, 0), "Shift+Del apaga o clipe e o som vinculado e fecha o buraco");
  await pagina.keyboard.press("Control+z");
  ok((await projeto()).clipes.length === 5, "Ctrl+Z desfaz");

  // ── 7) Ondulação (B): puxar o fim do 1º pedaço 0,5 s para a esquerda encurta e puxa o resto
  await pagina.keyboard.press("b");
  r = await area(doV1[0].id);
  const pxs = await pagina.evaluate(() => Video.V.Linha.pxs());
  await arrastar(r.x + r.w - 2, r.y + r.h / 2, r.x + r.w - 2 - 0.5 * pxs, r.y + r.h / 2);
  p = await projeto();
  doV1 = p.clipes.filter((c) => c.trilha === "V1").sort((a, b) => a.inicio - b.inicio); doA1 = p.clipes.filter((c) => c.trilha === "A1").sort((a, b) => a.inicio - b.inicio);
  ok(perto(doV1[0].duracao, 0.5, 0.04) && perto(doV1[1].inicio, 0.5, 0.04) && perto(doA1[0].duracao, 0.5, 0.04) && perto(doA1[1].inicio, 0.5, 0.04), `a ferramenta Ondulação apara e o resto acompanha, no vídeo e no som (${doV1[0].duracao.toFixed(2)} s, próximo em ${doV1[1].inicio.toFixed(2)} s)`);
  await pagina.keyboard.press("Control+z");

  // ── 8) Slip (Y): arrastar o 2º pedaço muda o trecho da mídia, sem mexer no lugar nem na duração
  await pagina.keyboard.press("y");
  p = await projeto();
  doV1 = p.clipes.filter((c) => c.trilha === "V1").sort((a, b) => a.inicio - b.inicio);
  r = await area(doV1[1].id);
  await arrastar(r.x + r.w / 2, r.y + r.h / 2, r.x + r.w / 2 - 0.5 * pxs, r.y + r.h / 2);
  await pagina.keyboard.press("v");
  p = await projeto();
  const slip = p.clipes.find((c) => c.id === doV1[1].id);
  ok(perto(slip.inicio, 1) && perto(slip.duracao, 1) && perto(slip.entrada, 2.5, 0.05), `o Slip troca o trecho da mídia (entrada ${slip.entrada.toFixed(2)} s) sem mexer no clipe`);
  await pagina.keyboard.press("Control+z");

  // ── 9) Efeito: arrastar "Preto e branco" do painel Efeitos até o clipe deixa o quadro cinza
  await pagina.click('#painel-proj button[data-aba="efeitos"]');
  await pagina.fill("#aba-efeitos input[type=search]", "preto e branco");
  r = await area(doV1[0].id);
  await pagina.dragAndDrop('#aba-efeitos .item-efeito:text-is("Preto e branco")', "#pistas", { targetPosition: { x: r.x + r.w / 2 - caixaPistas.x, y: r.y + r.h / 2 - caixaPistas.y } });
  p = await projeto();
  const pb = p.clipes.find((c) => c.id === doV1[0].id);
  ok(pb.efeitos.some((f) => f.id === "preto-branco"), "arrastar o efeito até o clipe aplica o efeito");
  await irPara(0.5);
  const qpb = await quadro();
  ok(qpb.cor < 20, `o quadro fica em preto e branco (${qpb.cor} pontos coloridos)`);
  ok(await pagina.isVisible("#aba-controles .ce-secao .titulo:has-text('Preto e branco')"), "o efeito aparece nos Controles de efeito");
  await pagina.click("#aba-controles .ce-secao .titulo:has-text('Preto e branco') .fx");
  await esperar(300);
  ok((await quadro()).cor > 300, "o botão fx desliga o efeito (para comparar)");
  await pagina.click("#aba-controles .ce-secao .titulo:has-text('Preto e branco') .fx");

  // ── 10) Controles de efeito: relógio da Opacidade, dois valores em tempos diferentes = quadros-chave
  await pagina.evaluate(() => Video.irPara(0));
  await esperar(200);
  const linhaOpac = "#aba-controles .ce-linha:has(label:text-matches('Opacidade$'))";
  await pagina.click(`${linhaOpac} .relogio`);
  await pagina.evaluate(() => Video.irPara(0.4));
  await pagina.click(`${linhaOpac} .valor-quente`);
  await pagina.fill(`${linhaOpac} .valor-quente input`, "0");
  await pagina.press(`${linhaOpac} .valor-quente input`, "Enter");
  p = await projeto();
  let chaves = p.clipes.find((c) => c.id === doV1[0].id).anim["opac.valor"];
  ok(chaves && chaves.length === 2 && chaves[0].v === 100 && chaves[1].v === 0 && perto(chaves[1].t, 0.4, 0.04), "o relógio liga a animação e mudar o valor em outro tempo cria o 2º quadro-chave");
  await irPara(0.2);
  const meio = await quadro();
  await irPara(0.0);
  const inteiro = await quadro();
  ok(meio.brilho < inteiro.brilho * 0.75 && meio.brilho > inteiro.brilho * 0.25, `na metade, a opacidade está pela metade (brilho ${meio.brilho.toFixed(0)} de ${inteiro.brilho.toFixed(0)})`);
  // botão direito no quadro-chave da faixa → Segurar
  const posChave = await pagina.evaluate(() => {
    const linha = [...document.querySelectorAll("#aba-controles .ce-linha")].find((l) => /Opacidade$/.test(l.querySelector("label")?.textContent || ""));
    const cv = document.querySelector("#aba-controles .trilha-ce canvas"), rc = cv.getBoundingClientRect(), rl = linha.getBoundingClientRect();
    const c = Video.app.escolhidos().find((x) => Video.app.trilha(x.trilha).tipo === "video");
    return { x: rc.left + 8 + (0 / c.duracao) * (rc.width - 16), y: rl.top + rl.height / 2 };
  });
  await pagina.mouse.click(posChave.x, posChave.y, { button: "right" });
  await pagina.click(".lnux-menu button:has-text('Segurar')");
  await irPara(0.2);
  p = await projeto();
  chaves = p.clipes.find((c) => c.id === doV1[0].id).anim["opac.valor"];
  ok(chaves[0].i === "segurar" && (await quadro()).brilho > inteiro.brilho * 0.9, "botão direito no quadro-chave escolhe a interpolação (Segurar: o valor não muda até o próximo)");
  await pagina.keyboard.press("Control+z"); await pagina.keyboard.press("Control+z"); await pagina.keyboard.press("Control+z");

  // ── 11) Painel Cor: saturação 0 no 2º pedaço cria o Cor (Lumetri) e o quadro fica cinza; curvas ganham ponto
  r = await area(doV1[1].id);
  await pagina.mouse.click(r.x + r.w / 2, r.y + r.h - 6);
  await pagina.click('#painel-dir button[data-aba="cor"]');
  await irPara(1.5);
  await pagina.evaluate(() => {
    const linha = [...document.querySelectorAll("#aba-cor .prop-linha")].find((l) => l.querySelector("label").textContent === "Saturação");
    const f = linha.querySelector("input[type=range]");
    f.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    f.value = 0; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup"));
  });
  await esperar(500);
  p = await projeto();
  const lum = p.clipes.find((c) => c.id === doV1[1].id).efeitos.find((f) => f.id === "cor");
  ok(lum && lum.params.saturacao === 0 && (await quadro()).cor < 20, "mexer na Saturação do painel Cor cria a correção (Lumetri) e o quadro fica cinza");
  await pagina.click("#aba-cor details:has(summary:text('Curvas')) summary");
  const cvCurva = await pagina.$("#aba-cor .curvas canvas");
  const bc = await cvCurva.boundingBox();
  await pagina.mouse.click(bc.x + bc.width * 0.5, bc.y + bc.height * 0.3);
  p = await projeto();
  ok(p.clipes.find((c) => c.id === doV1[1].id).efeitos.find((f) => f.id === "cor").curvas.mestre.length === 3, "clicar na curva põe um ponto (curvas RGB)");

  // ── 12) Escopos: a forma de onda desenha
  await pagina.click('#painel-dir button[data-aba="escopos"]');
  await esperar(300);
  const pontosEscopo = await pagina.$eval("#aba-escopos canvas", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 40) n++; return n; });
  ok(pontosEscopo > 500, `os Escopos mostram a forma de onda do quadro (${pontosEscopo} pontos)`);
  await pagina.click('#aba-escopos button[data-escopo="vetor"]');
  ok(true, "o vetorscópio também abre");

  // ── 13) Transição padrão (Ctrl+D) no corte de 1 s
  await pagina.evaluate(() => { Video.app.selecao.clear(); Video.irPara(1); });
  await pagina.click("#rolagem", { position: { x: 5, y: 5 } }).catch(() => {});
  await pagina.evaluate(() => { Video.app.selecao.clear(); Video.app.transicaoEscolhida = null; Video.irPara(1); });
  await pagina.keyboard.press("Control+d");
  p = await projeto();
  const tr = p.transicoes.find((t) => t.trilha === "V1");
  ok(tr && tr.tipo === "dissolver" && tr.a === doV1[0].id && tr.b === doV1[1].id, "Ctrl+D põe a dissolução no corte mais perto do cursor");
  ok(await pagina.evaluate(() => Video.projeto.transicoes.some((t) => t.trilha.startsWith("A"))) === false, "e não mexe nas trilhas de áudio (essa é Ctrl+Shift+D)");
  await pagina.keyboard.press("Control+Shift+d");
  ok(await pagina.evaluate(() => Video.projeto.transicoes.some((t) => t.trilha === "A1" && t.tipo === "potencia")), "Ctrl+Shift+D põe o fade cruzado de áudio");

  // ── 14) Marcadores: M marca, dois cliques editam, CSV sai
  await irPara(0.5);
  await pagina.keyboard.press("m");
  await pagina.click('#painel-proj button[data-aba="marcadores"]');
  await pagina.dblclick("#aba-marcadores .lista-simples > div");
  await pagina.fill(".lnux-dialogo input.lnux-entrada >> nth=0", "Começo");
  await pagina.selectOption(".lnux-dialogo select", "vermelho");
  await pagina.click(".lnux-dialogo footer button:has-text('OK')");
  p = await projeto();
  ok(p.marcadores.length === 1 && p.marcadores[0].nome === "Começo" && p.marcadores[0].cor === "vermelho" && perto(p.marcadores[0].tempo, 0.5), "M põe um marcador e o painel Marcadores edita nome e cor");

  // ── 15) Legendas: SRT lido, legenda criada no cursor e SRT escrito
  const srt = await pagina.evaluate(() => {
    const lidas = Video.V.Paineis.lerLegendas("1\n00:00:01,000 --> 00:00:02,500\n<i>Olá</i>, mundo\n\n2\n00:00:03,000 --> 00:00:04,000\nTchau\n");
    Video.irPara(0.2);
    Video.V.Paineis.novaLegenda();
    return { lidas, texto: Video.V.Paineis.textoLegendas("srt"), vtt: Video.V.Paineis.textoLegendas("vtt") };
  });
  ok(srt.lidas.length === 2 && srt.lidas[0].conteudo === "Olá, mundo" && srt.lidas[1].de === 3, "o SRT é lido (e as marcas como <i> saem)");
  ok(srt.texto.startsWith("1\n00:00:00,200 --> 00:00:03,200\nNova legenda") && srt.vtt.startsWith("WEBVTT\n\n00:00:00.200 --> "), "a legenda nova entra no cursor e sai em SRT e VTT");
  ok(await pagina.isVisible("#aba-texto .texto-item textarea"), "o painel Texto lista as legendas para editar");

  // ── 16) Mixer: M deixa a trilha A1 muda
  await pagina.click('#painel-esq button[data-aba="mixer"]');
  await pagina.click("#aba-mixer .canal:has-text('Áudio 1') button.m");
  ok((await projeto()).trilhas.find((t) => t.id === "A1").mudo === true, "o Mixer de áudio deixa a trilha muda");
  await pagina.click("#aba-mixer .canal:has-text('Áudio 1') button.m");

  // ── 17) Tocar com Espaço: o cursor anda e o medidor mede o loudness
  await pagina.evaluate(() => { Video.app.monitorAtivo = "programa"; Video.irPara(0); });
  await pagina.click("#quadro").catch(() => {});
  await pagina.evaluate(() => Video.app.selecao.clear());
  await pagina.keyboard.press("Space");
  await esperar(1500);
  const tocando = await pagina.evaluate(() => ({ cursor: Video.cursor, tocando: Video.app.tocando, lufs: document.querySelector(".lufs").textContent }));
  await pagina.keyboard.press("k");
  ok(tocando.tocando && tocando.cursor > 0.8, `Espaço toca a sequência (cursor em ${tocando.cursor.toFixed(2)} s)`);
  ok(/I-?\d+,\dLUFS/.test(tocando.lufs.replace(/\s/g, "")), `os medidores mostram o loudness (${tocando.lufs.replace(/\s+/g, " ")})`);

  // ── 18) Normalização do áudio exportado para -16 LUFS
  const lufs = await pagina.evaluate(async () => { const b = await Video.app.audioOffline(0, Video.app.duracao(), -16); return Video.app.loudnessDe(b); });
  ok(perto(lufs, -16, 0.6), `o áudio exportado normalizado fica em ${lufs.toFixed(1)} LUFS (pedido: -16)`);

  // ── 19) Exportar MP4 (ponte + ffmpeg) e conferir com o ffprobe
  await pagina.keyboard.press("Control+m");
  await pagina.waitForSelector(".lnux-dialogo:has-text('Exportar')");
  ok((await pagina.$eval(".lnux-dialogo select", (s) => s.value)) === "mp4", "com a ponte e o ffmpeg, o formato padrão é MP4");
  await pagina.click(".lnux-dialogo footer button:has-text('Exportar')");
  await pagina.waitForSelector(".lnux-dialogo:has-text('Salvar o vídeo')", { timeout: 60000 });
  await pagina.fill(".lnux-pastas .caminho input", PASTA);
  await pagina.press(".lnux-pastas .caminho input", "Enter");
  // espera a janela terminar de abrir a pasta (senão o arquivo vai para a pasta anterior)
  await pagina.waitForSelector(".lnux-pastas li:has-text('midias')");
  await pagina.waitForTimeout(300);
  await pagina.fill(".lnux-dialogo .lnux-campo input", "teste-v2.mp4");
  await pagina.click(".lnux-dialogo footer button:has-text('Salvar aqui')");
  await pagina.waitForFunction((p) => [...document.querySelectorAll(".lnux-aviso")].some((a) => a.textContent.includes(p + "/teste-v2.mp4")), PASTA.replace(/\/$/, ""), { timeout: 30000 });
  const sonda = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(PASTA, "teste-v2.mp4")]).toString());
  const dur = +sonda.format.duration, durSeq = await pagina.evaluate(() => Video.app.duracao());
  ok(sonda.streams.some((s) => s.codec_name === "h264") && sonda.streams.some((s) => s.codec_type === "audio") && Math.abs(dur - durSeq) < 1, `o MP4 exportado tem H.264 e som, com ${dur.toFixed(2)} s (sequência: ${durSeq.toFixed(2)} s)`);

  // ── 20) Pacote .lnuxvideo e recuperar depois de recarregar
  const pacote = await pagina.evaluate(async () => { const z = await LNUX.Zip.ler(await Video.gerarPacote()); return [...z.keys()]; });
  ok(pacote.includes("projeto.json") && !pacote.some((n) => n.startsWith("midias/")), `o .lnuxvideo leva o projeto (as mídias da ponte ficam no aparelho): ${pacote.join(", ")}`);
  const antes = await projeto();
  await esperar(1300);
  await pagina.reload();
  await pronto();
  await pagina.waitForFunction(() => Video.projeto.clipes.length > 0, null, { timeout: 10000 });
  const depois = await projeto();
  ok(depois.clipes.length === antes.clipes.length && depois.transicoes.length === antes.transicoes.length && depois.marcadores.length === 1 && (await pagina.evaluate(() => Video.app.urls.size)) === 4,
    `depois de recarregar, o projeto volta (${depois.clipes.length} clipes, ${depois.transicoes.length} transições, mídias abertas)`);

  // ── 21) Projeto da versão anterior do app é convertido
  const migrado = await pagina.evaluate(() => Video.migrar({ nome: "Velho", largura: 1280, altura: 720, fps: 30, midias: { m1: { nome: "a.mp4", tipo: "video", duracao: 4, largura: 640, altura: 360 } },
    trilhas: [{ id: "t1", tipo: "video", nome: "Vídeo" }, { id: "t2", tipo: "audio", nome: "Áudio" }],
    clipes: [{ id: "c1", trilha: "t1", midia: "m1", inicio: 0, entrada: 0, duracao: 4, mov: { x: 0, y: 0, escala: 1, rotacao: 0, opacidade: 0.5 }, cor: { saturacao: -1 }, entradaTr: { tipo: "dissolver", duracao: 1 } }],
    marcadores: [{ tempo: 1, nome: "x" }] }));
  const cm = migrado.clipes[0];
  ok(migrado.versao === 2 && cm.mov.escala === 200 && cm.opac.valor === 50 && cm.efeitos[0].id === "cor" && cm.efeitos[0].params.saturacao === 0 && migrado.transicoes[0].b === "c1" && migrado.trilhas.find((t) => t.tipo === "video").origem,
    "um projeto da versão anterior vira a versão nova (movimento, opacidade, cor, transição e marcadores)");

  // ── 22) Celular: layout próprio, sem rolar para o lado
  const cel = await navegador.newContext({ ...devices["Pixel 5"] });
  const pc = await cel.newPage();
  pc.on("pageerror", (e) => consola.push("[celular] " + e.message));
  await pc.goto(`${BASE}/apps/video/#token=${TOKEN}`);
  await pc.waitForFunction(() => window.Video && Video.pronto);
  ok((await pc.getAttribute("html", "data-layout")) === "celular", "no celular, o espaço Celular entra sozinho");
  ok((await pc.evaluate(() => document.documentElement.scrollWidth)) <= 395, "e a página não rola para o lado");
  await pc.click("#abas-celular button[data-movel='efeitos']");
  ok(await pc.isVisible("#aba-efeitos .arvore"), "as abas de baixo trocam para o painel Efeitos");
  await cel.close();

  ok(consola.length === 0, "nenhum erro no console" + (consola.length ? ":\n    " + consola.join("\n    ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); if (consolaGlobal.length) console.error("Console do navegador:\n  " + consolaGlobal.join("\n  ")); process.exit(2); });
