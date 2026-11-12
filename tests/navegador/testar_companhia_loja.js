// Teste da loja da Companhia e do site publicado sozinho (--so-app), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_loja
//
// Não baixa nada. Duas pessoas, em navegadores separados: o "dono" abre pelo LNUX (com a chave da ponte) e a
// "visita" só pelo endereço (sem a chave), como quem recebeu o link. Cobre: a loja vazia; publicar pela tela (a
// personagem, com a prévia 3D e a miniatura tirada dela); a grade como uma loja (abas, busca, miniaturas, que o dono
// gera para o que veio sem); a prévia 3D da personagem, do mundo e da animação antes de usar; usar cada um (a
// personagem escolhida para a sala, o mundo em Cenário, a animação em Pacotes de movimento); a visita publicando
// um arquivo dela e apagando só o que é dela; o dono fechando a loja para publicações. Depois sobe um servidor com
// --so-app companhia e confere, como quem chega pelo túnel: a página inicial leva à Companhia, os outros apps não
// abrem, sem o botão dos Apps Web, e a ponte não abre nem com a chave.
const { chromium } = require("playwright");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { bonecoVRM0, mapaDeTeste, bvhDeTeste } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RAIZ = path.resolve(__dirname, "..", "..");
const RUIDO = /Failed to load resource|voz do navegador|GPU stall/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
const portaLivre = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome, cabecalhos) => {
    const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
    if (cabecalhos) await contexto.setExtraHTTPHeaders(cabecalhos);
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a), contexto };
  };
  /** Quantos pixels da prévia 3D não são o fundo (para saber que algo foi desenhado). */
  const desenhado = (p) => p.ev(() => {
    const tela = document.querySelector(".loja-detalhe .vitrine-tela") || document.querySelector(".vitrine-publicar .vitrine-tela");
    if (!tela) return 0;
    const c = document.createElement("canvas");
    c.width = 120; c.height = 90;
    const x = c.getContext("2d");
    x.drawImage(tela, 0, 0, 120, 90);
    const d = x.getImageData(0, 0, 120, 90).data, fundo = [d[0], d[1], d[2]];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]) > 30) n++;
    return n;
  });
  const dono = await pessoa("dono"), visita = await pessoa("visita");
  let servidor = null;
  try {
    // ── o dono: uma personagem dele e a loja vazia ──
    await dono.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await dono.pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined, null, { timeout: 30000 });
    await dono.ev(async (b64) => {
      await window.Companhia.importarPacote(new Map([["Boneco do dono.vrm", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]]));
    }, bonecoVRM0().toString("base64"));
    await dono.pagina.waitForFunction(() => window.Companhia.pronto && window.Companhia.palco.modelo && window.Companhia.lojaDisponivel, null, { timeout: 60000 });
    await dono.pagina.click('.lnux-menubar > button:text-is("Personagem")');
    await dono.pagina.click('.lnux-menu button:has(.rotulo:text-is("Loja: personagens, mundos e animações..."))');
    await dono.pagina.waitForSelector(".loja .loja-vazio:not([hidden])");
    ok(await dono.ev(() => /Ainda não há nada na loja/.test(document.querySelector(".loja-vazio").textContent) && !document.querySelector(".loja-dono").hidden &&
      document.querySelector(".loja-dono input").checked), "a loja abre pelo menu Personagem; vazia, e o dono vê onde fica a pasta e se os visitantes publicam");

    // ── publicar pela tela: a prévia e a miniatura ──
    await dono.pagina.click('.loja-topo button:has-text("Publicar")');
    await dono.pagina.waitForSelector(".loja-publicar select");
    await dono.pagina.selectOption(".loja-publicar select", { label: "Boneco de teste" });
    await dono.pagina.waitForSelector(".vitrine-publicar[data-pronta]", { timeout: 60000 });
    await dono.pagina.waitForTimeout(500);
    ok((await desenhado(dono)) > 150, "publicar: a personagem escolhida aparece em 3D antes de mandar");
    await dono.pagina.fill('.loja-publicar input[aria-label="Seu nome"]', "Dono");
    await dono.pagina.fill(".loja-publicar textarea", "Um boneco de teste, só ossos e caixinhas.");
    await dono.pagina.click('.lnux-dialogo footer button:text-is("Publicar")');
    await dono.pagina.waitForSelector(".loja-detalhe:not([hidden]) .vitrine[data-pronta]", { timeout: 60000 });
    let lista = (await dono.ev(() => C.loja.lista())).itens;
    ok(lista.length === 1 && lista[0].tipo === "personagem" && lista[0].nome === "Boneco de teste" && lista[0].autor === "Dono" && lista[0].miniatura > 0 && /\.vrm$/.test(lista[0].arquivo),
      "publicado: a personagem foi para a loja (no aparelho do servidor), com a miniatura tirada da prévia");
    // um mundo e uma animação, como se viessem de arquivos (pela API); sem miniatura: o dono gera ao abrir a loja
    await dono.ev(async ([m, b]) => {
      const blob = (x) => new Blob([Uint8Array.from(atob(x), (c) => c.charCodeAt(0))]);
      await C.loja.publicar({ tipo: "mundo", blob: blob(m), arquivo: "praca.glb", nome: "Praça de teste", descricao: "Um piso, uma parede e um degrau.", autor: "Dono" });
      await C.loja.publicar({ tipo: "animacao", blob: blob(b), arquivo: "levantar.bvh", nome: "Levantar o braço", autor: "Dono" });
    }, [mapaDeTeste().toString("base64"), Buffer.from(bvhDeTeste()).toString("base64")]);
    await dono.pagina.click(".loja-voltar");
    await dono.ev(() => document.querySelector(".loja").recarregar());
    await dono.pagina.waitForFunction(async () => (await C.loja.lista()).itens.every((i) => i.miniatura > 0), null, { timeout: 60000, polling: 1000 });
    ok(true, "o dono gera sozinho as miniaturas que faltam (o mundo visto de cima, a animação num boneco)");
    await dono.ev(() => document.querySelector(".loja").recarregar());
    await dono.pagina.waitForTimeout(600);
    await dono.pagina.screenshot({ path: path.join(PASTA, "companhia-loja-1.png") });

    // ── a visita: entra pelo link (sem a chave), no modo de jogar ──
    await visita.pagina.goto(`${BASE}/apps/companhia/#modo=jogar`);
    await visita.pagina.waitForSelector("#sala-loja-personagem", { timeout: 30000 });
    ok(await visita.ev(() => !window.LNUX.ponte.disponivel && !document.querySelector("#sala-loja-mundo")), "quem entra pelo link (sem a ponte) acha a loja na janela da sala: \"Personagens da loja\"");
    await visita.pagina.click("#sala-loja-personagem");
    await visita.pagina.waitForSelector(".cartao-loja");
    const grade = await visita.ev(() => ({ abas: [...document.querySelectorAll(".loja-aba")].map((a) => a.textContent), ativa: document.querySelector(".loja-aba.ativa").dataset.tipo,
      cartoes: [...document.querySelectorAll(".cartao-loja")].map((c) => [c.querySelector(".nome").textContent, !!c.querySelector(".capa img")]), dono: !document.querySelector(".loja-dono").hidden }));
    ok(grade.ativa === "personagem" && JSON.stringify(grade.cartoes) === JSON.stringify([["Boneco de teste", true]]) && grade.abas.join("|").includes("Mundos1") && !grade.dono,
      `a loja abre nas personagens, como uma vitrine (cartões com miniatura; abas ${grade.abas.join(", ")}); a visita não vê a parte do dono`);
    await visita.pagina.click(".cartao-loja");
    await visita.pagina.waitForSelector(".loja-detalhe .vitrine[data-pronta]", { timeout: 60000 });
    await visita.pagina.waitForTimeout(400);
    ok((await desenhado(visita)) > 150 && (await visita.ev(() => !document.querySelector(".loja-acoes .perigo"))), "antes de usar, a personagem aparece em 3D (e a visita não pode apagar o que não é dela)");
    await visita.pagina.screenshot({ path: path.join(PASTA, "companhia-loja-2.png") });
    await visita.pagina.click("#loja-usar");
    await visita.pagina.waitForSelector('.lnux-dialogo select[aria-label="Sua personagem"]', { timeout: 60000 });
    await visita.pagina.waitForTimeout(300);
    ok(await visita.ev(() => document.querySelector('.lnux-dialogo select[aria-label="Sua personagem"]').selectedOptions[0].text === "Boneco de teste" && !document.querySelector(".loja")),
      "\"Usar esta personagem\" volta para a sala com ela escolhida");
    await visita.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    // o mundo e a animação
    await visita.ev(() => { window.Companhia.abrirLoja(); });
    await visita.pagina.waitForSelector(".cartao-loja");
    await visita.pagina.fill(".loja-busca", "praça");
    ok(await visita.ev(() => [...document.querySelectorAll(".cartao-loja .nome")].map((n) => n.textContent).join() === "Praça de teste"), "a busca acha o mundo pelo nome");
    await visita.pagina.click(".cartao-loja");
    await visita.pagina.waitForSelector(".loja-detalhe .vitrine[data-pronta]", { timeout: 60000 });
    ok((await desenhado(visita)) > 150, "o mundo aparece em 3D, visto de cima");
    await visita.pagina.click("#loja-usar");
    await visita.pagina.waitForFunction(() => !document.querySelector(".loja"), null, { timeout: 30000 });
    await visita.pagina.waitForFunction(async () => (await C.mapas.lista()).some((m) => m.nome === "Praça de teste"), null, { timeout: 30000 });
    ok(true, "\"Usar este mundo\" guarda o mundo em Movimento › Cenário");
    await visita.ev(() => { window.Companhia.abrirLoja("animacao"); });
    await visita.pagina.waitForSelector(".cartao-loja");
    await visita.pagina.click(".cartao-loja");
    await visita.pagina.waitForSelector(".loja-detalhe .vitrine[data-pronta]", { timeout: 60000 });
    await visita.pagina.waitForTimeout(400);
    ok((await desenhado(visita)) > 150, "a animação aparece num boneco, em 3D");
    await visita.pagina.screenshot({ path: path.join(PASTA, "companhia-loja-3.png") });
    await visita.pagina.click("#loja-usar");
    await visita.pagina.waitForFunction(async () => (await C.movimentos.lista()).some((m) => m.nome === "levantar" && m.pacote === "Loja"), null, { timeout: 30000 });
    ok(true, "\"Usar esta animação\" põe a animação nos pacotes de movimento");

    // ── a visita publica uma animação dela (um arquivo do aparelho) e só ela (ou o dono) apaga ──
    const bvh = path.join(PASTA, "aceno-da-visita.bvh");
    fs.writeFileSync(bvh, bvhDeTeste());
    await visita.ev(() => { window.Companhia.abrirLoja(); });
    await visita.pagina.waitForSelector(".cartao-loja");
    await visita.pagina.click('.loja-topo button:has-text("Publicar")');
    await visita.pagina.click('.loja-tipos button[data-tipo="animacao"]');
    await visita.pagina.waitForFunction(() => [...document.querySelector(".loja-publicar select").options].some((o) => o.value === "@arquivo"));
    const [escolha] = await Promise.all([visita.pagina.waitForEvent("filechooser"), visita.pagina.selectOption(".loja-publicar select", "@arquivo")]);
    await escolha.setFiles(bvh);
    await visita.pagina.waitForSelector(".vitrine-publicar[data-pronta]", { timeout: 60000 });
    await visita.pagina.fill('.loja-publicar input[aria-label="Seu nome"]', "Visita");
    await visita.pagina.click('.lnux-dialogo footer button:text-is("Publicar")');
    await visita.pagina.waitForSelector(".loja-detalhe:not([hidden]) .loja-acoes .perigo", { timeout: 60000 });
    lista = (await visita.ev(() => C.loja.lista())).itens;
    const daVisita = lista.find((i) => i.nome === "aceno-da-visita");
    ok(daVisita && daVisita.autor === "Visita" && daVisita.miniatura > 0, "a visita publica uma animação dela (com a miniatura), e pode apagar o que publicou");
    await visita.pagina.click(".loja-acoes .perigo");
    await visita.pagina.click('.lnux-dialogo footer button:text-is("Apagar")');
    await visita.pagina.waitForFunction(async () => !(await C.loja.lista()).itens.some((i) => i.nome === "aceno-da-visita"), null, { timeout: 20000 });
    ok(true, "apagar tira da loja (e do aparelho do servidor)");
    // o dono fecha a loja para publicações: a visita não vê mais o botão
    await dono.ev(() => C.loja.configurar({ publicar: false }));
    await visita.ev(() => document.querySelector(".loja").recarregar());
    ok(await visita.ev(() => document.querySelector('.loja-topo .primario').hidden), "o dono pode fechar a loja para publicações (o botão some para os visitantes)");
    await dono.ev(() => C.loja.configurar({ publicar: true }));
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));

    // ── publicar só a Companhia (--so-app), visto de fora, como pelo túnel ──
    const porta = await portaLivre(), dados = fs.mkdtempSync(path.join(os.tmpdir(), "lnux-so-app-"));
    servidor = spawn("python3", [path.join(RAIZ, "servidor", "lnux_apps.py"), "--porta", String(porta), "--so-app", "companhia", "--sem-comandos", "--permitir-host", "abc.trycloudflare.com"],
      { env: { ...process.env, LNUX_APPS_DADOS: dados }, stdio: "ignore" });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${porta}/api/publico`)).ok) break; } catch (e) { /* subindo */ } await new Promise((r) => setTimeout(r, 100)); }
    const chave = fs.readFileSync(path.join(dados, "ponte.json"), "utf8").match(/"token":\s*"([^"]+)"/)[1];
    const fora = await pessoa("de fora", { "Cf-Connecting-Ip": "203.0.113.9", "Cf-Ray": "8a1b2c3d4e5f-GRU" });
    const sozinho = `http://127.0.0.1:${porta}`;
    // mesmo com a chave no endereço (um link vazado): de fora, nada da ponte
    const resposta = await fora.pagina.goto(`${sozinho}/#token=${chave}&modo=conversa`);
    await fora.pagina.waitForFunction(() => window.Companhia && window.LNUX.publico && window.LNUX.publico.so_app, null, { timeout: 30000 });
    await fora.pagina.waitForTimeout(500);
    const vistoDeFora = await fora.ev(async () => ({ url: location.pathname, ponte: window.LNUX.ponte.disponivel, casa: !!document.querySelector('a[href="../../"]'),
      marca: document.querySelector(".lnux-marca").getAttribute("href"), selo: document.querySelector(".lnux-selo").hidden,
      pastas: (await fetch("/api/pastas?caminho=~", { headers: { "X-Ponte-Token": window.LNUX.ponte._token } })).status,
      outro: (await fetch("/apps/video/")).status, inicio: (await fetch("/")).url.replace(location.origin, ""), loja: (await fetch("/api/loja")).status }));
    ok(resposta.ok && vistoDeFora.url === "/apps/companhia/" && vistoDeFora.inicio === "/apps/companhia/" && vistoDeFora.outro === 404,
      "publicado sozinho: o endereço abre direto na Companhia; a página inicial leva a ela e os outros apps não existem ali");
    ok(!vistoDeFora.casa && vistoDeFora.marca === "./" && vistoDeFora.selo, "sem o botão dos Apps Web (nem pelo nome do app) e sem o selo da ponte");
    ok(!vistoDeFora.ponte && vistoDeFora.pastas === 403 && vistoDeFora.loja === 200, "de fora, nem a chave abre a ponte (as pastas do aparelho dão 403); a loja e as salas funcionam");
    // no próprio aparelho, com a chave, o dono continua usando a ponte (para criar as salas)
    const local = await pessoa("dono no aparelho");
    await local.pagina.goto(`${sozinho}/apps/companhia/#token=${chave}&modo=jogar`);
    await local.pagina.waitForSelector("#sala-criar", { timeout: 30000 });
    ok(await local.ev(() => window.LNUX.ponte.disponivel && !document.querySelector('a[href="../../"]')), "no próprio aparelho, o dono (com a chave) usa a ponte e cria as salas");
    await fora.pagina.screenshot({ path: path.join(PASTA, "companhia-loja-4.png") });
    ok(consola.length === 0, "sem erros no console no site publicado" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await visita.pagina.screenshot({ path: path.join(PASTA, "companhia-loja-erro.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    if (servidor) servidor.kill();
    await navegador.close();
  }
  console.log(`\nCompanhia (loja): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
