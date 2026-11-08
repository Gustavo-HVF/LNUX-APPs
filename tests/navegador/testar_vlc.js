// Teste do VLC-Web (apps/vlc-web) com a ponte local, no Chromium. Rode com: python3 tests/testar_navegador.py vlc
// Cobre: tema do LNUX na primeira vez, selo da ponte, pastas do aparelho (menu e Ctrl+Alt+O), tocar e avançar
// com Range, legenda ao lado, faixas do MKV pelo leitor do VLC Web, som AC-3 separado pela ponte, troca de faixa
// pelo menu Áudio, legenda embutida pelo menu Legenda, AVI preparado antes de tocar, capturar imagem salvando
// na pasta do aparelho, converter pelo ffmpeg do aparelho, sem ponte e no celular.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const MIDIAS = process.env.LNUX_TESTE_MIDIAS || path.join(PASTA, "midias");
const VLC = path.join(MIDIAS, "vlc");
const SAIDA = path.join(MIDIAS, "saida");
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
let consolaGlobal = [];

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1400, height: 880 } });
  // o tema escolhido no LNUX-APPs (página inicial) antes de abrir o VLC-Web pela primeira vez
  await contexto.addInitScript(() => { try { if (!localStorage.getItem("lnux.tema")) localStorage.setItem("lnux.tema", "oceano"); } catch (e) { /* ok */ } });
  const pagina = await contexto.newPage();
  const consola = (consolaGlobal = []);
  pagina.on("console", (m) => { if (m.type() === "error") consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const tocador = () => pagina.evaluate(() => {
    const p = VW.app.player, it = p.item;
    return { titulo: it && it.title, url: it && it.url, estado: p.state, t: p.currentTime, slave: p.slaveKind, slaveSrc: p.slave ? p.slave.src : "",
      faixas: p.getAudioTracks().map((x) => x.label), subs: p.subs.tracks.map((t) => t.label), legendaAtiva: !!p.subs.activeId, video: p.renderer.hasVideo };
  });
  const menu = async (topo) => { await pagina.click(`.menubar-item[data-id="${topo}"]`); await pagina.waitForSelector(".menu"); };
  const itemMenu = (texto) => `.menu .menu-item:has(.menu-label:text-is("${texto}"))`;
  const abrirPastas = async () => {
    await pagina.keyboard.press("Control+Alt+o");
    await pagina.waitForSelector(".lnux-pastas .lnux-item");
  };

  await pagina.goto(`${BASE}/apps/vlc-web/#token=${TOKEN}`);
  await pagina.waitForFunction(() => window.VW && VW.lnux && VW.lnux.pronto, null, { timeout: 20000 });
  ok((await pagina.getAttribute("html", "data-skin")) === "ocean", "na primeira vez, o VLC-Web segue o tema do LNUX-APPs (Oceano)");
  ok((await pagina.evaluate(() => location.hash)) === "", "a chave da ponte sai do endereço");
  ok((await pagina.textContent(".lnux-selo")) === "Ponte" && (await pagina.getAttribute(".lnux-selo", "class")).includes("ligada"), "a barra de status mostra a ponte ligada");
  ok(await pagina.isVisible('.welcome [data-lnux="pastas"]'), "a tela de boas-vindas ganha o botão Pastas do aparelho");

  // ── 1) Mídia › Abrir das pastas do aparelho; tocar com a legenda ao lado; avançar (Range)
  await menu("media");
  ok(await pagina.isVisible(itemMenu("Todos os apps (LNUX-APPs)")), "o menu Mídia tem Todos os apps");
  await pagina.click(itemMenu("Abrir das pastas do aparelho…"));
  await pagina.waitForSelector(".lnux-pastas .lnux-item");
  await pagina.fill(".lnux-pastas .lnux-caminho", VLC);
  await pagina.press(".lnux-pastas .lnux-caminho", "Enter");
  await pagina.waitForSelector(".lnux-pastas .lnux-item:has-text('filme.mp4')");
  const nomes = await pagina.$$eval(".lnux-pastas .lnux-item .n", (n) => n.map((x) => x.textContent));
  ok(["antigo.avi", "dublado.mkv", "filme.mp4", "filme.srt"].every((n) => nomes.includes(n)), `a janela lista as mídias e legendas da pasta (${nomes.join(", ")})`);
  await pagina.dblclick(".lnux-pastas .lnux-item:has-text('filme.mp4')");
  await pagina.waitForFunction(() => VW.app.player.state === "playing" && VW.app.player.currentTime > 0.5, null, { timeout: 15000 });
  let e = await tocador();
  ok(e.titulo === "filme" && e.url.includes("/api/arquivo?caminho=") && !e.url.startsWith("blob:"), "dois cliques toca direto do aparelho, sem copiar para o navegador");
  ok(e.legendaAtiva && e.subs.length === 1, `a legenda de mesmo nome (filme.srt) entra junto e já aparece (${e.subs.join(", ")})`);
  await pagina.evaluate(() => VW.app.player.seek(15));
  await pagina.waitForFunction(() => VW.app.player.currentTime >= 15, null, { timeout: 10000 }).catch(() => {});
  ok((await tocador()).t >= 15, "avançar para 15 s funciona (o servidor atende pedidos parciais)");

  // ── 2) MKV dublado: faixas lidas pelo VLC Web, som AC-3 separado pela ponte, troca de faixa e legenda embutida
  await abrirPastas();
  await pagina.click(".lnux-pastas .lnux-item:has-text('dublado.mkv')");
  await pagina.click(".lnux-pastas footer button:has-text('Tocar'):not(:has-text('pasta'))");
  await pagina.waitForFunction(() => VW.app.player.item && VW.app.player.item.title === "dublado" && VW.app.player.getAudioTracks().length === 2, null, { timeout: 15000 }).catch(() => {});
  e = await tocador();
  ok(e.faixas.length === 2 && /Português/.test(e.faixas[0]) && /Inglês/.test(e.faixas[1]), `as faixas do MKV aparecem com idioma e formato (${e.faixas.join(" | ")})`);
  await pagina.waitForFunction(() => VW.app.player.slaveKind === "track" && /faixa-1\.m4a/.test(VW.app.player.slave.src), null, { timeout: 20000 }).catch(() => {});
  e = await tocador();
  ok(e.slave === "track" && /faixa-1\.m4a/.test(e.slaveSrc), "o som em AC-3 (que o navegador não toca) é separado pelo ffmpeg do aparelho e sai junto com o vídeo");
  await menu("audio");
  await pagina.hover(itemMenu("Faixa de áudio"));
  await pagina.locator(".menu").last().locator(".menu-item:not(.disabled):has-text('Inglês')").click();
  await pagina.waitForFunction(() => /faixa-2\.m4a/.test(VW.app.player.slave ? VW.app.player.slave.src : ""), null, { timeout: 20000 }).catch(() => {});
  ok(/faixa-2\.m4a/.test((await tocador()).slaveSrc), "Áudio › Faixa de áudio › Inglês troca a faixa (separada pela ponte, sem baixar o arquivo)");
  await menu("subtitle");
  await pagina.hover(itemMenu("Legendas embutidas (pelo ffmpeg do aparelho)"));
  const submenu = pagina.locator(".menu").last();
  await submenu.locator(".menu-item:not(.disabled):has-text('Português')").click();
  await pagina.waitForFunction(() => VW.app.player.subs.tracks.some((t) => /dublado\.por\.vtt/.test(t.label)), null, { timeout: 15000 }).catch(() => {});
  ok((await tocador()).subs.some((s) => /dublado\.por\.vtt/.test(s)), "Legenda › Legendas embutidas separa a legenda de dentro do MKV");

  // ── 3) AVI antigo: o ffmpeg do aparelho prepara antes de tocar
  await abrirPastas();
  await pagina.dblclick(".lnux-pastas .lnux-item:has-text('antigo.avi')");
  await pagina.waitForFunction(() => { const p = VW.app.player; return p.item && p.item.title === "antigo" && p.state === "playing" && p.renderer.hasVideo; }, null, { timeout: 40000 }).catch(() => {});
  e = await tocador();
  ok(e.estado === "playing" && e.video && /antigo\.mp4/.test(e.url), "um AVI (MPEG-4 antigo) é convertido pelo ffmpeg do aparelho e toca");

  // ── 4) Capturar imagem (Shift+S): salva direto na pasta do aparelho
  await pagina.evaluate(() => VW.app.player.pause());
  await pagina.locator("#app").focus();
  await pagina.keyboard.press("Shift+S");
  await pagina.waitForSelector(".lnux-salvar", { timeout: 15000 });
  await pagina.fill(".lnux-salvar .win-body input >> nth=1", SAIDA);
  await pagina.click(".lnux-salvar footer button:has-text('Salvar no aparelho')");
  await pagina.waitForSelector(".toast:has-text('Salvo em')", { timeout: 15000 }).catch(() => {});
  let capturas = [];
  for (let i = 0; i < 30 && !capturas.length; i++) { capturas = fs.readdirSync(SAIDA).filter((n) => /\.(png|jpe?g|webp)$/.test(n)); if (!capturas.length) await esperar(500); }
  const cabeca = capturas.length ? fs.readFileSync(path.join(SAIDA, capturas[0])).subarray(0, 4) : Buffer.alloc(0);
  ok(capturas.length === 1 && (cabeca[0] === 0x89 || cabeca[0] === 0xff || cabeca.toString() === "RIFF"), `a captura de imagem vai para a pasta escolhida no aparelho (${capturas.join(", ")})`);

  // ── 5) Converter pelo ffmpeg do aparelho (o AVI para MP3)
  await menu("media");
  await pagina.click(itemMenu("Converter pelo ffmpeg do aparelho…"));
  await pagina.waitForSelector(".win:has-text('Converter pelo ffmpeg do aparelho') select");
  await pagina.selectOption(".win:has-text('Converter pelo ffmpeg do aparelho') select >> nth=0", "mp3");
  await pagina.fill(".win:has-text('Converter pelo ffmpeg do aparelho') .win-body input", path.join(SAIDA, "antigo.mp3"));
  await pagina.click(".win:has-text('Converter pelo ffmpeg do aparelho') footer button:has-text('Converter')");
  await pagina.waitForSelector(".toast:has-text('Convertido')", { timeout: 30000 }).catch(() => {});
  let codec = "";
  try { codec = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path.join(SAIDA, "antigo.mp3")]).toString().trim(); } catch (err) { /* não existe */ }
  ok(codec === "mp3", `Mídia › Converter pelo ffmpeg do aparelho gera o MP3 na pasta escolhida (${codec || "nada"})`);
  ok(consola.length === 0, "nenhum erro no console (nem a tentativa de tocar o AVI direto)" + (consola.length ? ":\n    " + consola.join("\n    ") : ""));

  // ── 6) Sem a ponte (aberto fora do LNUX): o VLC Web funciona como sempre
  const semPonte = await navegador.newContext({ viewport: { width: 1200, height: 800 } });
  const sp = await semPonte.newPage();
  const consolaSem = [];
  sp.on("pageerror", (x) => consolaSem.push(x.message));
  await sp.goto(`${BASE}/apps/vlc-web/`);
  await sp.waitForFunction(() => window.VW && VW.lnux && VW.lnux.pronto, null, { timeout: 20000 });
  ok((await sp.textContent(".lnux-selo")) === "Sem ponte" && !(await sp.isVisible('[data-lnux="pastas"]')), "sem a ponte, o selo avisa e o botão das pastas não aparece");
  await sp.click('.menubar-item[data-id="media"]');
  ok(!(await sp.isVisible(itemMenu("Abrir das pastas do aparelho…"))) && (await sp.isVisible(itemMenu("Abrir arquivo…"))), "o menu Mídia fica o do VLC Web (Abrir arquivo...), sem as opções da ponte");
  ok(consolaSem.length === 0, "sem erros de página sem a ponte");
  await semPonte.close();

  // ── 7) Celular
  const cel = await navegador.newContext({ ...devices["Pixel 5"] });
  const pc = await cel.newPage();
  await pc.goto(`${BASE}/apps/vlc-web/#token=${TOKEN}`);
  await pc.waitForFunction(() => window.VW && VW.lnux && VW.lnux.pronto, null, { timeout: 20000 });
  ok((await pc.evaluate(() => document.documentElement.scrollWidth)) <= 395, "no celular a página não rola para o lado");
  await pc.click('[data-lnux="pastas"]');
  await pc.waitForSelector(".lnux-pastas .lnux-item");
  const larg = await pc.$eval(".lnux-pastas", (x) => x.getBoundingClientRect().right);
  ok(larg <= 393, `a janela das pastas cabe na tela do celular (${Math.round(larg)} px)`);
  await cel.close();

  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); if (consolaGlobal.length) console.error("Console do navegador:\n  " + consolaGlobal.join("\n  ")); process.exit(2); });
