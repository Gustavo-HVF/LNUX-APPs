// Teste dos minijogos do WEBC (tênis, beisebol, boliche, golfe e boxe), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_minijogos
//
// Não usa câmera de verdade: os movimentos chegam como resultados prontos do rastreamento (o mesmo formato do
// MediaPipe), quadro a quadro. Cobre: a página JOGOS (os cinco jogos, as opções e a escolha do controle, o cartão no
// início e no menu); as contas de cada jogo (os pontos do boliche, as rebatidas do beisebol, os buracos do golfe);
// cada jogo abre em tela cheia e desenha o cenário; os controles do mouse/teclado e da câmera (golpe pelo pulso,
// guarda com as mãos no rosto, inclinar o corpo); uma jogada de cada (a bola de boliche derruba pinos, a tacada anda,
// o soco acerta, o saque e a rebatida saem); a pausa (Esc), o fim de jogo, sair; e o console sem erros.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { nomeGuardado } = require("./companhia_menus.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|GPU stall|voz do navegador/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 760 }, locale: "pt-BR" });
  await nomeGuardado(contexto, "Jogador");
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const estado = () => ev(() => C.minijogos.atual && C.minijogos.atual.jogo.estado());
  /** Quantas cores diferentes há na tela do jogo (lida logo depois de desenhar). */
  const cores = () => ev(() => {
    const s = C.minijogos.atual; s.renderer.render(s.cena, s.camera);
    const gl = s.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4), vistas = new Set();
    for (let i = 1; i < 12; i++) for (let j = 1; j < 9; j++) { gl.readPixels(Math.floor((w * i) / 12), Math.floor((h * j) / 9), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); vistas.add(px.slice(0, 3).map((v) => v >> 4).join(",")); }
    return vistas.size;
  });
  /** Um quadro do rastreamento: o corpo de frente, com os pulsos onde se pede (x/y na imagem; z em metros no espaço do corpo). */
  await contexto.addInitScript(() => {
    window.__corpo = (o = {}) => {
      const im = Array.from({ length: 33 }, () => [0.5, 0.8, 0, 0.9]), mu = Array.from({ length: 33 }, () => [0, 0, 0, 0.9]);
      im[0] = [0.5 + (o.inclinar || 0), 0.25, 0, 0.99]; im[11] = [0.6, 0.42, 0, 0.99]; im[12] = [0.4, 0.42, 0, 0.99];
      const mE = o.maoE || [0.66, 0.62, 0], mD = o.maoD || [0.34, 0.62, 0];
      im[15] = [mE[0], mE[1], 0, 0.95]; im[16] = [mD[0], mD[1], 0, 0.95];
      mu[15] = [(0.5 - mE[0]) * 1.5, (mE[1] - 0.5) * 1.5, mE[2] || 0, 0.95]; mu[16] = [(0.5 - mD[0]) * 1.5, (mD[1] - 0.5) * 1.5, mD[2] || 0, 0.95];
      return { corpo: { imagem: im, mundo: mu } };
    };
    /** Um golpe: o pulso vai rápido para a frente (z) e volta, ~30 quadros por segundo. */
    window.__golpe = async (mao = "D", alto = false, antesDoPico = null) => {
      const enviar = C.minijogos.atual.simularCamera();
      const y = alto ? 0.36 : 0.62;
      const traj = [0, 0, -0.12, -0.3, -0.5, -0.62, -0.66, -0.66, -0.64, -0.6, -0.5];
      let t = performance.now() + 1000; // cada quadro com o horário dele (como os da câmera), 30 por segundo
      const quadro = (o) => { const r = window.__corpo(o); r.t = (t += 33); enviar(r); };
      for (const [i, z] of traj.entries()) { if (i === 5 && antesDoPico) antesDoPico(); quadro(mao === "D" ? { maoD: [0.42, y, z] } : { maoE: [0.58, y, z] }); await new Promise((r) => setTimeout(r, 10)); }
      for (let i = 0; i < 6; i++) { quadro({}); await new Promise((r) => setTimeout(r, 10)); }
    };
  });
  const abrirJogo = async (id, opcoes = {}) => {
    for (const [op, v] of Object.entries(opcoes)) await pagina.click(`.mj-jogo[data-jogo="${id}"] [data-opcao="${op}"] [data-valor="${v}"]`);
    await pagina.click(`[data-jogar="${id}"]`);
    await pagina.waitForFunction((i) => C.minijogos.atual && C.minijogos.atual.id === i && C.minijogos.atual.jogo, id, { timeout: 30000 });
    await ev(() => { C.minijogos.atual.velocidade = 1.5; });
    await esperar(400);
  };
  const sair = async () => {
    await ev(() => C.minijogos.atual && C.minijogos.atual.sair());
    await pagina.waitForFunction(() => !document.querySelector(".minijogo"), null, { timeout: 10000 });
  };
  const segurar = async (ms) => { await pagina.keyboard.down("Space"); await esperar(ms); await pagina.keyboard.up("Space"); };

  try {
    // ── a página JOGOS ──
    await pagina.goto(`${BASE}/apps/companhia/#modo=jogar`);
    await pagina.waitForSelector('.webc-cartao[data-ir="jogos"]', { timeout: 30000 });
    ok(await ev(() => !!document.querySelector('.webc-nav [data-ir="jogos"]') && document.querySelectorAll(".webc-cartoes .webc-cartao").length === 4), "o início tem o cartão JOGOS (quatro cartões) e o menu tem Jogos");
    await pagina.click('.webc-cartao[data-ir="jogos"]');
    await pagina.waitForSelector(".mj-grade .mj-jogo", { timeout: 20000 });
    const lista = await ev(() => [...document.querySelectorAll(".mj-jogo")].map((j) => j.dataset.jogo).join(","));
    ok(lista === "tenis,beisebol,boliche,golfe,boxe", `a página JOGOS mostra os cinco jogos (${lista})`);
    ok(await ev(() => ["modo", "games"].every((o) => document.querySelector(`.mj-jogo[data-jogo="tenis"] [data-opcao="${o}"]`)) && !!document.querySelector('.mj-jogo[data-jogo="golfe"] [data-opcao="buracos"] [data-valor="18"]')
      && !!document.querySelector('.mj-jogo[data-jogo="beisebol"] [data-opcao="entradas"]') && !!document.querySelector('.mj-controle [data-controle="camera"]')),
      "cada jogo tem as opções (simples/duplas, 3/9/18 buracos, entradas...) e dá para escolher mouse e teclado ou câmera de movimento");
    await esperar(600);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos.png") });

    // ── as contas ──
    const contas = await ev(() => {
      const p = C.esportes.pontosBoliche, tot = (j) => { const q = p(j).quadros.filter((f) => f.total !== null); return q.length ? q[q.length - 1].total : null; };
      const tipos = new Set();
      for (let i = 0; i < 600; i++) tipos.add(C.esportes.rebatida(Math.random(), (Math.random() - 0.5) * 0.3, Math.random()).tipo);
      const h1 = C.esportes.buracoDe(0, 42, 9), h2 = C.esportes.buracoDe(0, 42, 9);
      return { perfeito: tot(Array(12).fill(10)), spares: tot(Array(21).fill(5)), noves: tot([].concat(...Array(10).fill([9, 0]))), decimo: p([...Array(18).fill(0), 10, 4, 6]).quadros[9].marcas.join(""),
        tipos: [...tipos].sort().join(","), mesmo: JSON.stringify(h1) === JSON.stringify(h2), tee: C.esportes.superficie(h1, 0, 0), green: C.esportes.superficie(h1, h1.green.x, h1.green.z), par3: C.esportes.buracoDe(1, 5, 3).par };
    });
    ok(contas.perfeito === 300 && contas.spares === 150 && contas.noves === 90 && contas.decimo === "X4/", `boliche: jogo perfeito 300, só spares 150, só noves 90, 10º quadro "X4/" (${JSON.stringify(contas).slice(0, 80)})`);
    ok(["dupla", "eliminado", "falta", "homerun", "simples", "tripla"].every((x) => contas.tipos.includes(x)), `beisebol: as rebatidas dão falta, eliminado, simples, dupla, tripla e home run (${contas.tipos})`);
    ok(contas.mesmo && contas.tee === "tee" && contas.green === "green" && contas.par3 === 3, "golfe: o mesmo percurso para a mesma semente; o tee e o green no lugar certo");

    // ── boliche ──
    await abrirJogo("boliche");
    ok((await cores()) > 6, "boliche: abre em tela cheia com a pista, os pinos e o placar dos 10 quadros");
    ok(await ev(() => document.querySelectorAll(".mj-boliche .mj-quadro").length === 10), "o placar do boliche tem os 10 quadros");
    await pagina.mouse.move(640, 400);
    await segurar(800);
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().jogadas.length >= 1, null, { timeout: 40000, polling: 300 });
    let e = await estado();
    ok(e.jogadas[0] > 0, `segurar e soltar o Espaço joga a bola: derrubou ${e.jogadas[0]} pino(s)`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-boliche.png") });
    const antesCam = e.lancamentos;
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().fase === "mirando", null, { timeout: 10000 });
    await ev(() => window.__golpe("D"));
    await pagina.waitForFunction((n) => C.minijogos.atual.jogo.estado().lancamentos > n, antesCam, { timeout: 10000 });
    ok(true, "com a câmera, o movimento do braço joga a bola (a velocidade do pulso é a força)");
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().jogadas.length >= 2, null, { timeout: 40000, polling: 300 });
    e = await estado();
    ok(e.quadro >= 2 || e.jogadas.length === 2, `depois de duas bolas (ou um strike) o jogo segue para o próximo quadro (quadro ${e.quadro}, jogadas ${e.jogadas.join(",")})`);
    // pausa
    await pagina.keyboard.press("Escape");
    await pagina.waitForSelector(".mj-pausa:not([hidden]) [data-acao=continuar]");
    ok(await ev(() => C.minijogos.atual.pausado), "Esc pausa o jogo (Continuar, Recomeçar, Som e Sair)");
    await pagina.click(".mj-pausa [data-acao=continuar]");
    ok(await ev(() => !C.minijogos.atual.pausado && document.querySelector(".mj-pausa").hidden), "Continuar volta ao jogo");
    await sair();
    ok(await ev(() => !!document.querySelector(".mj-grade") && !C.minijogos.atual), "sair do jogo volta para a página JOGOS");

    // ── tênis (duplas) ──
    await abrirJogo("tenis", { modo: "duplas", games: 1 });
    e = await estado();
    ok(e.jogadores === 4 && e.fase === "saque", "tênis em duplas: quatro jogadores na quadra; você saca");
    ok((await cores()) > 6, "a quadra aparece (rede, linhas, torcida)");
    await pagina.keyboard.press("Space");
    await pagina.waitForFunction(() => { const b = C.minijogos.atual.jogo.estado().bola; return b.lancada && b.y > 1.9; }, null, { timeout: 5000, polling: 30 });
    await pagina.keyboard.press("Space");
    await esperar(150);
    e = await estado();
    ok(e.bola.batedor === 1 || e.fase === "morta", `Espaço joga a bola para cima e o segundo toque saca (${e.fase}, batedor ${e.bola.batedor})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-tenis.png") });
    await pagina.waitForFunction(() => { const s = C.minijogos.atual.jogo.estado(); return s.placar.pontos.some((p) => p > 0) || s.placar.games.some((g) => g > 0); }, null, { timeout: 30000, polling: 300 });
    ok(true, "o ponto acaba e vai para o placar (15, 30, 40...)");
    await esperar(2200);
    await ev(() => C.minijogos.atual.jogo.bolaParaVoce());
    await pagina.keyboard.press("Space");
    await esperar(100);
    e = await estado();
    ok(e.bola.batedor === 1, "na troca de bola, o toque na hora certa devolve a bola");
    await esperar(2200);
    const rebateu = await ev(async () => {
      const s = C.minijogos.atual;
      let batedor = null;
      const parar = s.entrada.on("golpe", () => { batedor = s.jogo.estado().bola.batedor; }); // logo depois do jogo tratar o golpe
      await window.__golpe("D", false, () => s.jogo.bolaParaVoce(1.5, 6)); // a bola chega no instante do golpe
      parar();
      return batedor;
    });
    ok(rebateu === 1, "com a câmera, o movimento do braço rebate");
    await sair();

    // ── beisebol ──
    await abrirJogo("beisebol", { entradas: 1 });
    ok((await cores()) > 6, "beisebol: o campo (diamante, bases, muro, torcida) aparece");
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().fase === "arremesso", null, { timeout: 15000, polling: 50 });
    await esperar(480);
    await pagina.keyboard.press("Space");
    await pagina.waitForFunction(() => ["pronto", "voo"].includes(C.minijogos.atual.jogo.estado().fase), null, { timeout: 15000, polling: 50 });
    e = await estado();
    ok(e.golpes === 1 && (e.fase === "voo" || e.strikes + e.bolas + e.fora > 0), `o CPU arremessa e Espaço balança o taco (${e.fase}, B${e.bolas} S${e.strikes})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-beisebol.png") });
    await ev(() => C.minijogos.atual.jogo.trocarLado());
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().fase === "mirando", null, { timeout: 15000, polling: 100 });
    await pagina.keyboard.press("KeyE");
    e = await estado();
    ok(!e.topo && e.tipo === "curva", "na metade de baixo você arremessa; E troca o arremesso (rápida → curva)");
    await pagina.mouse.move(640, 380);
    await segurar(500);
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().arremessos >= 2, null, { timeout: 5000 });
    ok(true, "segurar e soltar arremessa; o CPU rebate ou deixa passar");
    await pagina.waitForFunction(() => ["pronto", "mirando", "fim"].includes(C.minijogos.atual.jogo.estado().fase) && C.minijogos.atual.jogo.estado().arremessos >= 2, null, { timeout: 20000, polling: 100 });
    await sair();

    // ── golfe ──
    await abrirJogo("golfe", { buracos: 3 });
    e = await estado();
    ok(e.total === 3 && e.buraco === 1 && e.tacadas === 0 && e.lie === "tee", `golfe: percurso de 3 buracos, começa no tee do 1º (par ${e.par}, ${Math.round(e.distancia)} m)`);
    ok((await cores()) > 6, "o campo aparece (fairway, árvores, bandeira)");
    await ev(() => { C.minijogos.atual.entrada.mira.x = 0; });
    const x0 = e.x, z0 = e.z;
    await segurar(900);
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().tacadas === 1, null, { timeout: 5000 });
    await pagina.waitForFunction(() => ["mirando", "buraco"].includes(C.minijogos.atual.jogo.estado().fase), null, { timeout: 30000, polling: 200 });
    e = await estado();
    ok(Math.hypot(e.x - x0, e.z - z0) > 40, `a tacada manda a bola longe (${Math.round(Math.hypot(e.x - x0, e.z - z0))} m, caiu no ${e.lie})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-golfe.png") });
    await ev(() => { const j = C.minijogos.atual.jogo, h = j.buracoAtual; j.colocar(h.copo.x, h.copo.z + 0.6); C.minijogos.atual.entrada.mira.x = 0; });
    e = await estado();
    ok(e.taco === "Putter" && e.lie === "green", "no green, o taco é o putter");
    await ev(() => C.minijogos.atual.jogo.bater(0.2, 0));
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().cartao.length === 1, null, { timeout: 15000, polling: 100 });
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().buraco === 2, null, { timeout: 15000, polling: 200 });
    e = await estado();
    ok(e.cartao[0].tacadas === 2 && e.tacadas === 0, "a bola cai no buraco: o cartão anota (2 tacadas) e vai para o buraco 2");
    await sair();

    // ── boxe ──
    await abrirJogo("boxe", { nivel: "facil" });
    ok((await cores()) > 6, "boxe: o ringue (cordas, lona, torcida) e o adversário aparecem");
    await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().fase === "luta", null, { timeout: 10000 });
    for (let i = 0; i < 6; i++) { await ev(() => C.minijogos.atual.jogo.forcarAdversario("parado", 2)); await pagina.keyboard.press(i % 2 ? "KeyJ" : "KeyK"); await esperar(380); }
    e = await estado();
    ok(e.socos >= 5 && e.acertos > 0 && e.vida[1] < e.vidaMaxima, `J e K soltam o jab e o direto; os socos acertam (${e.acertos} de ${e.socos}; vida dele ${Math.round(e.vida[1])})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-boxe.png") });
    const vidaAntes = e.vida[0];
    await pagina.keyboard.down("KeyS");
    await ev(() => C.minijogos.atual.jogo.forcarAdversario("preparo", 0.2, { mao: "D" }));
    await esperar(900);
    await pagina.keyboard.up("KeyS");
    e = await estado();
    ok(e.bloqueios >= 1 && vidaAntes - e.vida[0] < 5, `segurando S (guarda), o soco dele é bloqueado (vida ${Math.round(vidaAntes)} → ${Math.round(e.vida[0])})`);
    const acertosAntes = e.socos;
    await ev(() => C.minijogos.atual.jogo.forcarAdversario("atordoado", 3));
    await ev(() => window.__golpe("E", true));
    e = await estado();
    ok(e.socos > acertosAntes, "com a câmera, um soco de verdade com a mão esquerda vira jab");
    const enviar = await ev(() => { const f = C.minijogos.atual.simularCamera(); f(window.__corpo({ maoE: [0.53, 0.3, 0], maoD: [0.47, 0.3, 0] })); return C.minijogos.atual.entrada.guarda; });
    const inclina = await ev(() => { const f = C.minijogos.atual.simularCamera(); f(window.__corpo({ inclinar: -0.08 })); return C.minijogos.atual.entrada.lado; });
    ok(enviar === true && inclina > 0.4, `com a câmera, as duas mãos no rosto fazem a guarda e inclinar o corpo esquiva (lado ${inclina.toFixed(2)})`);
    // pular para o fim dos 3 rounds
    for (let r = 0; r < 3; r++) {
      await pagina.waitForFunction(() => C.minijogos.atual.jogo.estado().fase === "luta", null, { timeout: 15000, polling: 200 });
      await ev(() => C.minijogos.atual.jogo.pularTempo(0.05));
      await esperar(300);
    }
    await pagina.waitForSelector(".mj-fim [data-acao=de-novo]", { timeout: 15000 });
    ok(await ev(() => C.minijogos.atual.jogo.estado().round === 3 && /pontos|Empate/i.test(document.querySelector(".mj-fim h2").textContent)), "depois do 3º round, a luta vai para os pontos e mostra o resultado (Jogar de novo / Escolher outro jogo)");
    await pagina.click(".mj-fim [data-acao=de-novo]");
    await esperar(400);
    e = await estado();
    ok(e.round === 1 && e.vida[0] === 100 && !(await ev(() => C.minijogos.atual.acabou)), "Jogar de novo recomeça a luta do zero");
    await pagina.keyboard.press("Escape");
    await pagina.click(".mj-pausa [data-acao=sair]");
    await pagina.waitForFunction(() => !document.querySelector(".minijogo"), null, { timeout: 10000 });
    ok(true, "Sair do jogo (pela pausa) fecha a tela do jogo");

    // celular: a página e um jogo cabem na tela
    await pagina.setViewportSize({ width: 390, height: 780 });
    await esperar(300);
    ok(await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no celular, a página JOGOS cabe na largura");
    await abrirJogo("boliche");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-celular.png") });
    ok(await ev(() => { const r = document.querySelector(".mj-boliche").getBoundingClientRect(); return r.width > 0 && document.querySelector(".mj-tela").clientWidth === window.innerWidth; }), "no celular, o jogo ocupa a tela e o placar aparece");
    await sair();
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    console.log("  console:", consola.slice(0, 6));
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-jogos-erro.png") }); } catch (x) { /* sem tela */ }
  } finally {
    await navegador.close();
    // LNUX_TESTE_GUARDAR: uma pasta para guardar as imagens do teste (a de saída é apagada no fim)
    if (process.env.LNUX_TESTE_GUARDAR) for (const f of fs.readdirSync(PASTA)) if (/^companhia-jogos.*\.png$/.test(f)) fs.copyFileSync(path.join(PASTA, f), path.join(process.env.LNUX_TESTE_GUARDAR, f));
  }
  console.log(`\nMinijogos: ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
