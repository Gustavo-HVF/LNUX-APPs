// Teste do cenário fechado, da posição do mapa e do voo (atravessar as paredes) da Companhia, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_cenario
//
// Não baixa nada. Usa uma "casa" de teste (piso, quatro paredes sem porta e telhado). Cobre: a personagem nasce no
// piso de dentro (não em cima do telhado); a posição do mapa (X, Y, Z) no painel do cenário, guardada com ele; as
// paredes seguram quem anda; voar (V) sobe com o Espaço e atravessa a parede; ao parar de voar fora da casa, cai e
// volta ao começo. Na sala: quem visita nasce dentro, não voa (nem pelo V nem pelo menu) e vê o painel travado; quem
// criou voa e muda a posição do mapa, que chega a todos sem baixar o cenário de novo.
const { chromium } = require("playwright");
const { menus, nomeGuardado } = require("./companhia_menus.js");
const fs = require("fs");
const path = require("path");
const { bonecoVRM0, casaDeTeste } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const boneco = path.join(PASTA, "boneco-vrm0.vrm");
  fs.writeFileSync(boneco, bonecoVRM0());
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome) => {
    const contexto = await navegador.newContext({ viewport: { width: 1100, height: 760 }, locale: "pt-BR" });
    await nomeGuardado(contexto, nome);
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    const mapas = [];
    pagina.on("request", (r) => { if (/\/api\/sala\/[a-z0-9]+\/mapa\?/.test(r.url()) && r.method() === "GET") mapas.push(r.url()); });
    return {
      pagina, mapas, ev: (f, a) => pagina.evaluate(f, a),
      ...menus(pagina),
      segurar: async (tecla, ms) => { await pagina.keyboard.down(tecla); await pagina.waitForTimeout(ms); await pagina.keyboard.up(tecla); },
    };
  };
  const ana = await pessoa("Ana"), bia = await pessoa("Bia");
  const posicao = (p) => p.ev(() => { const m = window.Companhia.palco.mundo, r = window.Companhia.palco.raiz.position; return { x: r.x, y: r.y, z: r.z, voando: m.voando, andando: m.andando }; });
  const casa = casaDeTeste().toString("base64");
  try {
    // ── sozinha: a casa fechada ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await ana.pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined, null, { timeout: 20000 });
    await ana.menu("Personagem", "Importar ZIP ou .vrm...");
    await ana.pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([ana.pagina.waitForEvent("filechooser"), ana.pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(boneco);
    await ana.pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });
    const idCasa = await ana.ev(async (b64) => {
      const reg = await C.mapas.guardar("Casa", new Map([["casa.glb", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]]), "casa.glb");
      await window.Companhia.estudio.abrirMapaGuardado(reg.id);
      return reg.id;
    }, casa);
    let p = await posicao(ana);
    ok(Math.abs(p.y - 0.2) < 0.03 && Math.abs(p.x) < 0.5 && Math.abs(p.z) < 0.5, `num mapa fechado, ela nasce no piso de dentro (y = ${p.y.toFixed(2)}), não em cima do telhado (y = 3,4)`);

    // a posição do mapa, no painel do cenário
    await ana.menu("Movimento", "Cenário (mapa)...");
    await ana.pagina.click('.painel-estudio .posicao-mapa summary');
    await ana.pagina.waitForSelector('.painel-estudio input[aria-label="Para cima e para baixo (Y)"]');
    const eixos = await ana.pagina.locator('.painel-estudio .posicao-mapa input[type="range"]').count();
    await ana.ev(() => { const i = document.querySelector('.painel-estudio input[aria-label="Para cima e para baixo (Y)"]'); i.value = "1"; i.dispatchEvent(new Event("input")); });
    const moveu = await ana.ev(() => { const m = window.Companhia.palco.mundo; return { y: m.mapa.position.y, min: m.caixa.min.y, eu: window.Companhia.palco.raiz.position.y, ajuste: m.info.ajuste.posicao }; });
    ok(eixos === 3 && Math.abs(moveu.y - 1) < 1e-6 && Math.abs(moveu.min - 1) < 0.01 && Math.abs(moveu.eu - 0.2) < 0.03 && moveu.ajuste[1] === 1,
      "Posição do mapa (X, Y, Z): subir o mapa 1 m move o cenário e a colisão; a personagem fica onde está");
    let guardado = null;
    for (let i = 0; i < 25 && JSON.stringify(guardado) !== "[0,1,0]"; i++) { // grava 0,4 s depois do último movimento
      await ana.pagina.waitForTimeout(200);
      guardado = await ana.ev(async (id) => (await C.mapas.lista()).find((m) => m.id === id).ajuste.posicao, idCasa);
    }
    ok(JSON.stringify(guardado) === "[0,1,0]", `a posição fica guardada com o cenário no aparelho (${JSON.stringify(guardado)})`);
    await ana.pagina.click('.painel-estudio button:text-is("Zerar a posição")');
    ok(await ana.ev(() => window.Companhia.palco.mundo.mapa.position.y === 0), "\"Zerar a posição\" põe o mapa de volta");

    // andar: a parede segura; voando, atravessa
    await ana.ev(() => window.Companhia.estudio.alternarAndar(true));
    await ana.pagina.mouse.click(300, 420);
    await ana.pagina.keyboard.down("ShiftLeft");
    await ana.segurar("KeyW", 4000);
    await ana.pagina.keyboard.up("ShiftLeft");
    p = await posicao(ana);
    ok(p.andando && !p.voando && p.z > 4 && p.z < 5.8, `andando, a parede da casa segura (z = ${p.z.toFixed(2)}, a parede começa em 5,8)`);
    await ana.pagina.keyboard.press("KeyV");
    ok((await posicao(ana)).voando && /voando/.test(await ana.ev(() => document.querySelector("#chip-movimento").textContent)), "V: voa (o botão do movimento mostra \"voando\")");
    const antesDeSubir = (await posicao(ana)).y;
    await ana.segurar("Space", 700);
    const subiu = (await posicao(ana)).y;
    await ana.segurar("KeyC", 300);
    const desceu = (await posicao(ana)).y;
    ok(subiu > antesDeSubir + 1 && desceu < subiu - 0.3, `voando, segurar Espaço sobe (${antesDeSubir.toFixed(2)} → ${subiu.toFixed(2)}) e C desce (${desceu.toFixed(2)})`);
    await ana.segurar("KeyW", 1500);
    p = await posicao(ana);
    ok(p.z > 6.3, `voando, atravessa a parede (z = ${p.z.toFixed(2)}: do lado de fora da casa)`);
    ok(await ana.ev(() => !!document.querySelector(".controles-mundo.voando .botao-subir") && getComputedStyle(document.querySelector(".controles-mundo .botao-subir")).display !== "none"),
      "na tela (celular), aparecem Subir e Descer enquanto voa");
    await ana.pagina.keyboard.press("KeyV");
    await ana.pagina.waitForFunction(() => { const r = window.Companhia.palco.raiz.position; return Math.abs(r.y - 0.2) < 0.05 && Math.abs(r.z) < 1; }, null, { timeout: 15000 });
    ok(!(await posicao(ana)).voando, "parando de voar do lado de fora (sem chão), ela cai e volta ao começo, dentro da casa");
    await ana.ev(() => window.Companhia.estudio.alternarAndar(false));

    // ── na sala: só quem criou voa e mexe no cenário ──
    await ana.pagina.goto("about:blank"); // só trocar o # do endereço não recarrega a página
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar&pagina=sala`);
    await ana.pagina.waitForSelector(".salas #sala-criar", { timeout: 30000 });
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Nome da sala"]', "Casa da Ana");
    await ana.pagina.selectOption('.lnux-dialogo select[aria-label="Cenário da sala"]', { label: "Casa" });
    await ana.pagina.waitForSelector(".vitrine-cenario[data-pronta]", { timeout: 60000 });
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForSelector(".link-sala input");
    const codigo = ((await ana.pagina.inputValue(".link-sala input")).match(/#sala=([a-z0-9]+)$/) || [])[1];
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    p = await posicao(ana);
    ok(!!codigo && Math.abs(p.y - 0.2) < 0.05, `a Ana cria a sala com a casa e entra no piso de dentro (y = ${p.y.toFixed(2)})`);

    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await bia.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    p = await posicao(bia);
    ok(Math.abs(p.y - 0.2) < 0.05 && Math.abs(p.x) < 5.5 && Math.abs(p.z) < 5.5, `a Bia entra na sala e nasce dentro da casa também (y = ${p.y.toFixed(2)})`);
    const baixadas = bia.mapas.length;

    // a Bia não voa
    await bia.pagina.mouse.click(300, 420);
    await bia.pagina.keyboard.press("KeyV");
    await bia.pagina.waitForSelector('.lnux-aviso:has-text("só quem criou pode voar")', { timeout: 5000 });
    const voarBia = await bia.itemDoMenu("Movimento", "Voar, atravessando as paredes (V)");
    ok(!(await posicao(bia)).voando && voarBia.existe && !voarBia.ativo && !(await bia.ev(() => window.Companhia.palco.mundo.alternarVoo(true))),
      "a Bia (que só visita) não voa: o V avisa que só quem criou pode, o item do menu fica desligado e o mundo recusa");
    ok(await bia.ev(() => document.querySelector(".controles-mundo .botao-voar").hidden), "o botão de voar da tela não aparece para ela");
    await bia.menu("Movimento", "Cenário (mapa)...");
    await bia.pagina.waitForSelector(".painel-estudio .aviso-sala-cenario:not([hidden])");
    const painelBia = await bia.ev(() => {
      const q = (s) => document.querySelector(".painel-estudio " + s);
      return { aviso: q(".aviso-sala-cenario").textContent, y: q('input[aria-label="Para cima e para baixo (Y)"]').disabled, tamanho: q('input[aria-label="Tamanho do cenário"]').disabled,
        mapas: q('select[aria-label="Cenário"]').disabled, voo: [...document.querySelectorAll(".painel-estudio button")].find((b) => /Voar/.test(b.textContent)).disabled };
    });
    ok(/só essa pessoa muda/.test(painelBia.aviso) && painelBia.y && painelBia.tamanho && painelBia.mapas && painelBia.voo, "no painel do cenário, a Bia vê o aviso e os controles do mapa travados (posição, tamanho, outro cenário, voar)");

    // a Ana voa e muda a posição do mapa: chega à Bia sem baixar o cenário de novo
    const voarAna = await ana.itemDoMenu("Sala", "Voar, atravessando as paredes (V)");
    await ana.pagina.mouse.click(300, 420);
    await ana.pagina.keyboard.press("KeyV");
    ok(voarAna.ativo && (await posicao(ana)).voando, "a Ana (quem criou) voa na sala (V, ou Sala › Voar)");
    await ana.menu("Sala", "Ajustar o cenário da sala (tamanho, posição, começo)...");
    await ana.pagina.click('.painel-estudio .posicao-mapa summary');
    await ana.pagina.waitForSelector('.painel-estudio input[aria-label="Para os lados (X)"]');
    ok(await ana.ev(() => /vão para todos/.test(document.querySelector(".aviso-sala-cenario").textContent) && !document.querySelector('.painel-estudio input[aria-label="Para os lados (X)"]').disabled),
      "o painel da Ana diz que o ajuste vai para todos, com os controles livres");
    await ana.ev(() => { const i = document.querySelector('.painel-estudio input[aria-label="Para os lados (X)"]'); i.value = "2.5"; i.dispatchEvent(new Event("input")); });
    await bia.pagina.waitForFunction(() => Math.abs(window.Companhia.palco.mundo.mapa.position.x - 2.5) < 1e-6, null, { timeout: 15000 });
    await bia.pagina.waitForTimeout(800);
    const depois = await bia.ev(() => ({ x: window.Companhia.palco.raiz.position.x, y: window.Companhia.palco.raiz.position.y, slider: +document.querySelector('.painel-estudio input[aria-label="Para os lados (X)"]').value }));
    const info = await bia.ev((c) => C.Sala.consultar(c), codigo);
    ok(bia.mapas.length === baixadas && info.mapa.arquivo < info.mapa.versao && info.mapa.ajuste.posicao[0] === 2.5,
      `a posição chega à Bia sem baixar o cenário de novo (${bia.mapas.length - baixadas} downloads; arquivo ${info.mapa.arquivo}, versão ${info.mapa.versao})`);
    ok(Math.abs(depois.y - 0.2) < 0.05 && depois.x > -3.3 && depois.x < 8.3 && depois.slider === 2.5, `com o mapa mudado de lugar, a Bia volta ao começo, ainda dentro da casa (x = ${depois.x.toFixed(2)}), e o painel dela mostra o valor novo`);
    await ana.pagina.waitForTimeout(1500);
    ok(await ana.ev(() => Math.abs(window.Companhia.palco.mundo.mapa.position.x - 2.5) < 1e-6 && window.Companhia.palco.mundo.voando), "a Ana continua com o ajuste dela (não volta ao antigo) e voando");

    await bia.ev(() => window.Companhia.sala.sair());
    await ana.ev(() => window.Companhia.sala.fechar());
  } catch (e) {
    erros.push("falhou: " + e.message);
    console.log(e);
    for (const [n, p] of [["ana", ana], ["bia", bia]]) await p.pagina.screenshot({ path: path.join(PASTA, `cenario-erro-${n}.png`) }).catch(() => {});
  }
  if (consola.length) console.log("Console:\n  " + consola.join("\n  "));
  await navegador.close();
  console.log(erros.length ? `\n✖ ${erros.length} falha(s) em companhia_cenario.` : `\n✔ companhia_cenario: ${passos} verificações ok.`);
  process.exit(erros.length ? 1 : 0);
})();
