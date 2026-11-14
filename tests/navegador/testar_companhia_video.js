// Teste do vídeo numa tela do cenário da Companhia (YouTube, Vimeo, Twitch, arquivo), com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_video
//
// Não baixa nada: o "site de vídeos" e o player do YouTube são respondidos pelo próprio teste (um .webm feito com o
// ffmpeg e uma página que anota os comandos que o player recebe). Duas pessoas: a "Ana" cria a sala (com a chave da
// ponte) e põe um vídeo; a "Bia" entra pelo endereço. Cobre: os links que servem (e os que não); a tela na frente da
// personagem, seguindo-a ou parada; a Bia vendo a tela da Ana no mesmo lugar e no mesmo ponto do vídeo; pausar,
// pular e continuar valendo para as duas; o player do YouTube (o endereço sem cookies, o ponto de início e os comandos);
// o som das telas dos outros; a sala que deixa só quem criou pôr vídeos; e fechar.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
const VIDEO = "https://videos.exemplo.com/filme.webm";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s";
const PLAYER_YT = `<!doctype html><body style="margin:0;background:#c4302b;color:#fff;font:60px sans-serif;display:grid;place-items:center;height:100vh">player<script>
  window.recebidos = []; addEventListener("message", (e) => { try { window.recebidos.push(JSON.parse(e.data)); } catch (x) {} });</script>`;

(async () => {
  // um vídeo de 30 s (testsrc: o número na tela é o segundo), servido com pedidos de trecho (Range), como um site de verdade
  const filme = path.join(PASTA, "tela-filme.webm");
  if (!fs.existsSync(filme)) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=20:duration=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
    "-c:v", "libvpx", "-b:v", "250k", "-c:a", "libvorbis", "-shortest", filme]);
  const dados = fs.readFileSync(filme);
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome) => {
    const contexto = await navegador.newContext({ viewport: { width: 1100, height: 760 }, locale: "pt-BR" });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    await contexto.route("https://videos.exemplo.com/**", (r) => {
      const faixa = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || "");
      if (!faixa) return r.fulfill({ status: 200, body: dados, headers: { "Content-Type": "video/webm", "Accept-Ranges": "bytes" } });
      const de = +faixa[1], ate = faixa[2] ? Math.min(+faixa[2], dados.length - 1) : dados.length - 1;
      return r.fulfill({ status: 206, body: dados.subarray(de, ate + 1), headers: { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Range": `bytes ${de}-${ate}/${dados.length}` } });
    });
    await contexto.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, body: PLAYER_YT, contentType: "text/html" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const ana = await pessoa("Ana"), bia = await pessoa("Bia");
  /** A tela de alguém nesta página: onde está (no mundo), se aparece, o tempo do <video> e se está pausado. */
  const tela = (p, chave) => p.ev((k) => {
    const v = window.Companhia.videos, t = v.telas.get(k === "ana" ? [...window.Companhia.sala.remotos.values()].find((r) => r.nome === "Ana").id : k);
    if (!t) return null;
    const midia = t.el.querySelector("video, iframe");
    return { pos: t.ancora.position.toArray(), rumo: t.rumo, visivel: t.visivel, el: t.el.style.visibility, tipo: midia && midia.tagName, src: midia && midia.getAttribute("src"),
      tempo: midia && midia.tagName === "VIDEO" ? midia.currentTime : null, pausado: midia && midia.tagName === "VIDEO" ? midia.paused : null, volume: t.volume, largura: t.largura };
  }, chave);
  const raiz = (p) => p.ev(() => window.Companhia.palco.raiz.position.toArray());
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  try {
    // ── a Ana cria a sala (chão simples) ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar&pagina=sala`);
    await ana.pagina.waitForSelector(".salas #sala-criar", { timeout: 30000 });
    await ana.pagina.fill('.salas input[aria-label="Seu nome"]', "Ana");
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    ok(await ana.ev(() => document.querySelector('.lnux-dialogo input[aria-label="Quem entra pode pôr vídeos na tela"]').checked), "criar sala: \"Quem entra pode pôr vídeos na tela\" (ligado)");
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Nome da sala"]', "Cinema da Ana");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForSelector(".link-sala input");
    const codigo = ((await ana.pagina.inputValue(".link-sala input")).match(/#sala=([a-z0-9]+)$/) || [])[1];
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');

    // ── os links ──
    const links = await ana.ev(() => {
      const i = (u) => { const d = C.video.interpretar(u); return d ? [d.tipo, d.id || d.canal || d.video || d.url || d.lista, Math.round(d.em || 0)].join("|") : null; };
      return {
        yt: i("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s"), curto: i("https://youtu.be/dQw4w9WgXcQ?t=42"), shorts: i("https://youtube.com/shorts/dQw4w9WgXcQ"), lista: i("https://www.youtube.com/playlist?list=PL1234567890abcdef"),
        vimeo: i("https://vimeo.com/76979871"), twitch: i("https://www.twitch.tv/umcanal"), twitchVideo: i("https://www.twitch.tv/videos/123456789?t=1h2m3s"), arquivo: i("https://exemplo.com/a/filme.mp4#t=12"),
        ruins: ["https://exemplo.com/pagina", "javascript:alert(1)", "https://www.youtube.com/watch?v=curto", "ftp://exemplo.com/x.mp4", "nada"].map(i),
        endereco: C.video.endereco(C.video.interpretar("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), 75.6),
      };
    });
    ok(links.yt === "youtube|dQw4w9WgXcQ|90" && links.curto === "youtube|dQw4w9WgXcQ|42" && links.shorts === "youtube|dQw4w9WgXcQ|0" && links.lista === "youtube|PL1234567890abcdef|0",
      "links do YouTube: watch (com t=1m30s), youtu.be, shorts e playlist");
    ok(links.vimeo === "vimeo|76979871|0" && links.twitch === "twitch|umcanal|0" && links.twitchVideo === "twitch|123456789|3723" && links.arquivo === "arquivo|https://exemplo.com/a/filme.mp4#t=12|12",
      "Vimeo, Twitch (canal e vídeo, com o tempo) e um arquivo de vídeo (.mp4)");
    ok(links.ruins.every((x) => x === null), "links que não são de vídeo (uma página qualquer, javascript:, ftp:) não abrem");
    ok(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/.test(links.endereco) && /start=75/.test(links.endereco) && /enablejsapi=1/.test(links.endereco) && /autoplay=1/.test(links.endereco),
      "o player do YouTube é o sem cookies, começa no segundo certo e aceita comandos");

    // ── a Ana põe um vídeo (pelo botão 📺) ──
    await ana.pagina.click("#botao-video");
    await ana.pagina.waitForSelector('.janela-video input[aria-label="Link do vídeo"]');
    await ana.pagina.fill('.janela-video input[aria-label="Link do vídeo"]', "https://exemplo.com/uma-pagina");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Mostrar")');
    await ana.pagina.waitForSelector('.janela-video .conta-msg.erro:not([hidden])');
    ok(true, "um link que não é de vídeo avisa na própria janela");
    await ana.pagina.fill('.janela-video input[aria-label="Link do vídeo"]', VIDEO);
    await ana.pagina.selectOption('.janela-video select[aria-label="Tamanho da tela"]', "2");
    await ana.pagina.click('.janela-video [data-modo-tela="seguir"]');
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Mostrar")');
    await ana.pagina.waitForFunction(() => { const t = window.Companhia.videos.telas.get("eu"); const v = t && t.el.querySelector("video"); return v && v.currentTime > 0.5 && t.visivel; }, null, { timeout: 30000 });
    let t = await tela(ana, "eu"), r = await raiz(ana);
    const barra = await ana.ev(() => !!document.querySelector(".barra-video") && /videos\.exemplo\.com/.test(document.querySelector(".barra-video").textContent));
    ok(t.tipo === "VIDEO" && t.visivel && t.el === "visible" && !t.pausado && t.largura === 2 && barra, "o vídeo aparece numa tela no cenário, tocando, com a barra de controles");
    ok(t.pos[1] > r[1] + 1 && dist2(t.pos, r) > 2 && dist2(t.pos, r) < 3.5, `a tela fica na frente dela, acima da cabeça (a ${dist2(t.pos, r).toFixed(1)} m)`);
    // o mouse em cima da tela: o palco deixa os cliques passarem para o player (que fica atrás dele, aparecendo pelo furo)
    const centro = await ana.ev(() => { const p = window.Companhia.palco, t = window.Companhia.videos.telas.get("eu"), v = t.ancora.position.clone().project(p.camera), r = p.conteiner.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height + 30]; });
    await ana.pagina.mouse.move(centro[0], centro[1]);
    const sobre = await ana.ev(() => window.Companhia.palco.view.style.pointerEvents);
    const alvo = await ana.ev(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.tagName; }, centro);
    await ana.pagina.mouse.move(60, 400);
    const fora = await ana.ev(() => window.Companhia.palco.view.style.pointerEvents);
    ok(sobre === "none" && alvo === "VIDEO" && fora === "", `com o mouse em cima da tela, o clique vai para o player (${alvo}); fora dela, volta para o cenário`);
    // seguindo: ela anda e a tela vai junto
    await ana.pagina.mouse.click(250, 650);
    await ana.pagina.keyboard.down("KeyA");
    await ana.pagina.waitForTimeout(1800);
    await ana.pagina.keyboard.up("KeyA");
    await ana.pagina.waitForTimeout(1500);
    const t2 = await tela(ana, "eu"), r2 = await raiz(ana);
    ok(dist2(r2, r) > 1.5 && dist2(t2.pos, t.pos) > 1.2 && Math.abs(dist2(t2.pos, r2) - dist2(t.pos, r)) < 0.4, `"Segue a personagem": ela andou ${dist2(r2, r).toFixed(1)} m e a tela foi junto (continua a ${dist2(t2.pos, r2).toFixed(1)} m dela)`);
    // parada: ela anda e a tela fica
    await ana.pagina.click('.barra-video [data-acao="modo"]');
    await ana.pagina.waitForFunction(() => window.Companhia.videos.meu.modo === "parada");
    const fixa = (await tela(ana, "eu")).pos;
    await ana.pagina.mouse.click(250, 650);
    await ana.pagina.keyboard.down("KeyD");
    await ana.pagina.waitForTimeout(1800);
    await ana.pagina.keyboard.up("KeyD");
    await ana.pagina.waitForTimeout(800);
    const t3 = await tela(ana, "eu");
    ok(dist2(t3.pos, fixa) < 0.05 && /Parada/.test(await ana.ev(() => document.querySelector('.barra-video [data-acao="modo"]').textContent)), "\"Fica parada\": ela anda e a tela fica no lugar");

    // ── a Bia entra e vê a tela da Ana, no mesmo lugar e no mesmo ponto ──
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await bia.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    await bia.pagina.fill('.salas input[aria-label="Seu nome"]', "Bia");
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    await bia.pagina.waitForFunction(() => { const s = window.Companhia.sala, r = [...s.remotos.values()][0], t = r && window.Companhia.videos.telas.get(r.id); const v = t && t.el.querySelector("video"); return v && v.currentTime > 0.3; }, null, { timeout: 30000 });
    let ta = await tela(ana, "eu"), tb = await tela(bia, "ana");
    ok(tb.tipo === "VIDEO" && Math.hypot(tb.pos[0] - ta.pos[0], tb.pos[1] - ta.pos[1], tb.pos[2] - ta.pos[2]) < 0.05 && Math.abs(tb.rumo - ta.rumo) < 0.01, "a Bia vê a tela da Ana no mesmo lugar do cenário");
    ok(Math.abs(tb.tempo - ta.tempo) < 1.5, `e no mesmo ponto do vídeo (Ana em ${ta.tempo.toFixed(1)} s, Bia em ${tb.tempo.toFixed(1)} s)`);
    ok(await bia.ev(() => !document.querySelector(".barra-video")), "a barra de controles é só de quem pôs o vídeo");

    // pausar, pular e continuar: vale para as duas
    await ana.pagina.click('.barra-video [data-acao="pausar"]');
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0], v = window.Companhia.videos.telas.get(r.id).el.querySelector("video"); return v.paused; }, null, { timeout: 10000 });
    ta = await tela(ana, "eu");
    tb = await tela(bia, "ana");
    ok(ta.pausado && tb.pausado && Math.abs(tb.tempo - ta.tempo) < 0.8, `a Ana pausa: o vídeo para nas duas, no mesmo ponto (${ta.tempo.toFixed(1)} s / ${tb.tempo.toFixed(1)} s)`);
    const antes = ta.tempo;
    await ana.pagina.click('.barra-video button:text-is("+10s")');
    await bia.pagina.waitForFunction((a) => { const r = [...window.Companhia.sala.remotos.values()][0], v = window.Companhia.videos.telas.get(r.id).el.querySelector("video"); return v.currentTime > a + 8; }, antes, { timeout: 10000 });
    tb = await tela(bia, "ana");
    ok(Math.abs(tb.tempo - (antes + 10)) < 1 && tb.pausado, `+10s: a Bia vai junto (${antes.toFixed(1)} → ${tb.tempo.toFixed(1)} s), ainda pausado`);
    await ana.pagina.click('.barra-video [data-acao="pausar"]');
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0], v = window.Companhia.videos.telas.get(r.id).el.querySelector("video"); return !v.paused; }, null, { timeout: 10000 });
    ok(true, "continuar: volta a tocar nas duas");

    // o som: a tela parada da Ana diminui com a distância; desligado o som dos outros, a da Ana fica muda para a Bia
    tb = await tela(bia, "ana");
    ok(tb.volume > 0 && tb.volume <= 100, `para a Bia, o som da tela da Ana depende da distância (volume ${tb.volume})`);
    await bia.ev(() => window.Companhia.videos.definirSomOutros(false));
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0], v = window.Companhia.videos.telas.get(r.id).el.querySelector("video"); return v.muted; }, null, { timeout: 5000 });
    ok(true, "Sala › \"Som das telas dos outros\" desligado: a tela da Ana fica muda para a Bia");
    await bia.ev(() => window.Companhia.videos.definirSomOutros(true));
    await bia.ev(() => window.Companhia.videos.definirVerOutros(false));
    await bia.pagina.waitForFunction(() => window.Companhia.videos.telas.size === 0, null, { timeout: 5000 });
    await bia.ev(() => window.Companhia.videos.definirVerOutros(true));
    await bia.pagina.waitForFunction(() => window.Companhia.videos.telas.size === 1, null, { timeout: 5000 });
    ok(true, "\"Ver as telas dos outros\" desligado esconde a tela da Ana (e ligado, volta)");

    // ── YouTube: o player sem cookies, no ponto do link, e os comandos chegam a ele ──
    await ana.ev((u) => window.Companhia.videos.abrir(u, { modo: "seguir", tamanho: 3.2 }), YT);
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0], t = window.Companhia.videos.telas.get(r.id); return t && t.el.querySelector("iframe"); }, null, { timeout: 15000 });
    tb = await tela(bia, "ana");
    const inicio = +((tb.src.match(/start=(\d+)/) || [])[1]);
    ok(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/.test(tb.src) && inicio >= 90 && inicio < 100 && tb.largura === 3.2,
      `a Ana troca para um link do YouTube: a Bia recebe o player sem cookies, a partir do segundo do link (start=${inicio}) e a tela maior (3,2 m)`);
    const quadroYT = () => bia.pagina.frames().find((f) => /youtube-nocookie\.com\/embed/.test(f.url()));
    await bia.pagina.waitForFunction(() => true);
    for (let i = 0; i < 40 && !quadroYT(); i++) await bia.pagina.waitForTimeout(200);
    await bia.pagina.waitForTimeout(1500); // o player carrega e pega o volume
    await ana.ev(() => window.Companhia.videos.pausar());
    let recebidos = [];
    for (let i = 0; i < 30; i++) {
      recebidos = await quadroYT().evaluate(() => window.recebidos).catch(() => []);
      if (recebidos.some((c) => c.func === "pauseVideo")) break;
      await bia.pagina.waitForTimeout(250);
    }
    const ir = recebidos.find((c) => c.func === "seekTo");
    ok(recebidos.some((c) => c.func === "pauseVideo") && ir && ir.args[0] >= 90 && recebidos.some((c) => c.func === "setVolume"),
      `a Ana pausa: o player do YouTube da Bia recebe "ir para ${ir ? Math.round(ir.args[0]) : "?"} s" e "pausar" (e o volume)`);

    // ── só quem criou põe vídeos ──
    await bia.ev(() => window.Companhia.videos.abrir("https://vimeo.com/76979871", { modo: "parada", tamanho: 1.2 }));
    await ana.pagina.waitForFunction(() => window.Companhia.videos.telas.size === 2, null, { timeout: 15000 });
    ok(await ana.ev(() => { const r = [...window.Companhia.sala.remotos.values()][0], t = window.Companhia.videos.telas.get(r.id); return /player\.vimeo\.com\/video\/76979871/.test(t.el.querySelector("iframe").src); }),
      "a Bia põe um vídeo do Vimeo e a Ana vê a tela dela");
    await ana.ev(() => window.Companhia.sala.configurar({ videos: "dono" }));
    await ana.pagina.waitForFunction(() => window.Companhia.videos.telas.size === 1, null, { timeout: 15000 });
    await bia.pagina.waitForSelector('.lnux-aviso:has-text("só quem criou põe vídeos")', { timeout: 15000 });
    ok(await bia.ev(() => !window.Companhia.videos.meu && !document.querySelector(".barra-video")), "a Ana deixa só quem criou pôr vídeos: a tela da Bia some para todos e ela é avisada");
    await bia.pagina.click("#botao-video");
    await bia.pagina.waitForSelector('.lnux-aviso:has-text("só quem criou põe vídeos")');
    ok(!(await bia.ev(() => !!document.querySelector(".janela-video"))), "o botão 📺 da Bia avisa em vez de abrir");

    // ── fechar ──
    await ana.pagina.click('.barra-video [data-acao="fechar"]');
    await bia.pagina.waitForFunction(() => window.Companhia.videos.telas.size === 0, null, { timeout: 15000 });
    ok(await ana.ev(() => !window.Companhia.videos.meu && window.Companhia.videos.telas.size === 0 && !document.querySelector(".barra-video")), "a Ana fecha o vídeo: a tela some para as duas");
    await bia.ev(() => window.Companhia.sala.sair());
    await ana.ev(() => window.Companhia.sala.fechar());
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("falhou: " + e.message);
    console.log(e);
    for (const [n, p] of [["ana", ana], ["bia", bia]]) await p.pagina.screenshot({ path: path.join(PASTA, `video-erro-${n}.png`) }).catch(() => {});
  }
  if (consola.length) console.log("Console:\n  " + consola.join("\n  "));
  await navegador.close();
  console.log(erros.length ? `\n✖ ${erros.length} falha(s) em companhia_video.` : `\n✔ companhia_video: ${passos} verificações ok.`);
  process.exit(erros.length ? 1 : 0);
})();
