// Teste do Estúdio de itens do WEBC, no Chromium (docs/estudio-de-itens.md).
// Rode com: python3 tests/testar_navegador.py companhia_itens
//
// Dois navegadores: a Ana (com a chave da ponte) monta um item na página CRIAR (cilindro, lanterna, lançador e
// partículas), testa contra a parede, guarda, publica na loja, entra numa sala com ele na mão, usa (E), esconde (G) e
// ajusta no corpo; a Bia entra na sala e vê o item na mão da Ana e os tiros. Também confere que a ficha de um item é
// limpa ao abrir (os limites de partículas, cadência, partes e luzes; nada de HTML no nome).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { nomeGuardado } = require("./companhia_menus.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const FOTOS = process.env.LNUX_TESTE_FOTOS || "";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegadores = [], consola = [];
  const pessoa = async (nome) => {
    const n = await chromium.launch();
    navegadores.push(n);
    const contexto = await n.newContext({ viewport: { width: 1360, height: 860 }, locale: "pt-BR" });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    await contexto.addInitScript(() => { try { localStorage.setItem("companhia.luz", JSON.stringify({ realista: false, sombras: false })); } catch (e) { /* sem armazenamento */ } });
    await nomeGuardado(contexto, nome);
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const ana = await pessoa("Ana"), bia = await pessoa("Bia");
  /** Espera uma condição que precisa de await (a página responde com true quando pronto). */
  const esperar = async (p, fn, ms = 20000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await p.ev(fn)) return true; await p.pagina.waitForTimeout(200); } throw new Error("tempo esgotado esperando: " + fn); };
  const foto = async (p, nome) => { if (FOTOS) await p.pagina.screenshot({ path: path.join(FOTOS, nome + ".png") }); };
  try {
    // ── a página CRIAR ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar&pagina=criar`);
    await ana.pagina.waitForSelector(".estudio-itens .estudio-tela canvas", { timeout: 30000 });
    const pagina = await ana.ev(() => ({ nav: [...document.querySelectorAll(".webc-nav [data-ir]")].map((b) => b.dataset.ir).join(), titulo: document.querySelector(".estudio-itens .webc-painel-titulo").textContent,
      bolhas: [...document.querySelectorAll(".estudio-itens .webc-bolha")].map((b) => b.id).join(), formas: document.querySelectorAll(".estudio-formas [data-forma]").length }));
    ok(pagina.nav === "loja,sala,criar,perfil" && pagina.titulo === "CRIAR" && pagina.formas === 8 && /estudio-salvar/.test(pagina.bolhas) && /estudio-publicar/.test(pagina.bolhas),
      "a página CRIAR (no alto do site): o estúdio com as 8 formas, as partes, a cena e as bolinhas (meus itens, novo, importar, testar, salvar, exportar, publicar)");

    // ── montar: um cabo (cilindro), uma lanterna, um lançador e faíscas ──
    await ana.pagina.fill(".estudio-nome", "Lanterna de teste");
    await ana.pagina.click('.estudio-formas [data-forma="cilindro"]');
    await ana.pagina.click("#estudio-add-luz");
    await ana.pagina.selectOption(".estudio-adicionar .estudio-linha:nth-of-type(3) select", "pistola").catch(() => {});
    await ana.pagina.click("#estudio-add-lancador");
    await ana.pagina.click("#estudio-add-particulas");
    await ana.pagina.waitForTimeout(400);
    const montado = await ana.ev(() => [...document.querySelectorAll(".estudio-lista .estudio-parte[data-parte]")].map((p) => p.dataset.parte === "encaixe" ? "encaixe" : p.querySelector(".estudio-parte-tipo").textContent).join());
    ok(montado === "encaixe,Forma,Luz,Lançador,Partículas", `as partes aparecem na lista (${montado})`);
    // propriedades: a partícula escolhida mostra as dela; mudar um valor muda a parte
    const propsParticulas = await ana.ev(() => [...document.querySelectorAll(".estudio-props input[type=range]")].map((i) => i.getAttribute("aria-label")).length);
    ok(propsParticulas >= 10, `as partículas têm os ajustes delas (${propsParticulas} controles: por segundo, vida, velocidade, gravidade, tamanho, cor...)`);
    // desfazer e refazer
    await ana.pagina.click('.estudio-ferramentas button[aria-label="Desfazer"]');
    await ana.pagina.waitForTimeout(300);
    const desfeito = await ana.ev(() => document.querySelectorAll(".estudio-lista .estudio-parte[data-parte]").length);
    await ana.pagina.click('.estudio-ferramentas button[aria-label="Refazer"]');
    await ana.pagina.waitForTimeout(300);
    const refeito = await ana.ev(() => document.querySelectorAll(".estudio-lista .estudio-parte[data-parte]").length);
    ok(desfeito === 4 && refeito === 5, "desfazer tira a última parte e refazer põe de volta");
    // arrastar a parte escolhida (a do cilindro) para o lado: a posição muda
    await ana.pagina.click('.estudio-lista .estudio-parte:nth-child(2)');
    const antes = await ana.ev(() => document.querySelector('.estudio-props .estudio-tres input[aria-label="X"]').value);
    const caixa = await ana.pagina.locator(".estudio-tela canvas").boundingBox();
    const centro = await ana.ev(() => { const c = document.querySelector(".estudio-tela canvas").getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; });
    void caixa;
    await ana.pagina.mouse.move(centro[0], centro[1]);
    await ana.pagina.mouse.down();
    await ana.pagina.mouse.move(centro[0] + 80, centro[1], { steps: 6 });
    await ana.pagina.mouse.up();
    await ana.pagina.waitForTimeout(400);
    const depois = await ana.ev(() => { const p = document.querySelector('.estudio-props .estudio-tres input[aria-label="X"]'); return p ? p.value : null; });
    ok(depois !== null && Math.abs(+depois - +antes) > 0.005, `arrastar a parte na cena a move (x: ${antes} → ${depois})`);

    // ── na mão de boneco e no boneco inteiro ──
    await ana.pagina.click('.estudio-lista .estudio-parte[data-parte="encaixe"]');
    await ana.pagina.click("#estudio-ver-corpo");
    await ana.pagina.waitForTimeout(1500);
    await foto(ana, "estudio-corpo");
    await ana.pagina.click("#estudio-ver-mao");
    await ana.pagina.waitForTimeout(600);
    await foto(ana, "estudio-mao");
    ok(await ana.ev(() => document.querySelector('.estudio-ferramentas [data-valor="mao"]').classList.contains("ativo")), "o encaixe: a vista da mão de boneco (e a do boneco inteiro) para acertar onde o item fica");

    // ── testar: a parede na frente, usar e os tiros ──
    await ana.pagina.click("#estudio-testar");
    await ana.pagina.waitForSelector("#estudio-usar");
    const usar = await ana.pagina.locator("#estudio-usar").boundingBox();
    await ana.pagina.mouse.move(usar.x + usar.width / 2, usar.y + usar.height / 2);
    await ana.pagina.mouse.down();
    await ana.pagina.waitForTimeout(700);
    const teste = await ana.ev(() => document.querySelector(".estudio-teste").textContent);
    await ana.pagina.mouse.up();
    await foto(ana, "estudio-teste");
    const projeteis = +((teste.match(/(\d+) tiros/) || [])[1] || 0);
    ok(projeteis >= 3, `Testar: segurando "Usar", o lançador dispara sem parar contra a parede (${teste.replace(/^.*?(\d+ partículas)/, "$1")})`);
    await ana.pagina.click("#estudio-testar");

    // ── guardar ──
    await ana.pagina.click("#estudio-salvar");
    await esperar(ana, async () => (await C.itens.lista()).length === 1);
    const guardado = await ana.ev(async () => { const l = await C.itens.lista(), b = await C.itens.ler(l[0].id), r = await C.abrirItem(b);
      return { nome: l[0].nome, origem: l[0].origem, mini: l[0].miniatura instanceof Blob, tipos: r.def.partes.map((p) => p.tipo).join(), luz: r.def.partes.find((p) => p.tipo === "luz").luz, malhas: r.malhas.size, glb: new Uint8Array(await b.slice(0, 4).arrayBuffer()).join() }; });
    ok(guardado.nome === "Lanterna de teste" && guardado.origem === "meu" && guardado.mini && guardado.tipos === "forma,luz,lancador,particulas" && guardado.luz === "lanterna" && guardado.malhas === 1 && guardado.glb === "103,108,84,70",
      "Salvar guarda o item no aparelho (um .glb com a ficha dentro e uma foto); abrindo de novo, vêm as mesmas partes");

    // ── a ficha é limpa ao abrir (o item dos outros é dado, nunca código) ──
    const limpo = await ana.ev(() => {
      const ruim = { nome: "<img src=x onerror=alert(1)>Bomba", encaixe: { osso: "rightHand; drop", pos: [999, 0, 0] },
        partes: [...Array(200)].map((_, i) => ({ tipo: i < 10 ? "luz" : "particulas", taxa: 1e9, vida: 999, rajada: 1e6, cor: ["javascript:x", "#fff"] })).concat([{ tipo: "lancador", cadencia: 1, porTiro: 999, velocidade: 1e9 }]) };
      const d = C.limparItem(ruim), part = d.partes.find((p) => p.tipo === "particulas"), lanc = C.limparItem({ partes: [{ tipo: "lancador", cadencia: 1, porTiro: 999, velocidade: 1e9 }] }).partes[0];
      return { nome: d.nome, osso: d.encaixe.osso, pos: d.encaixe.pos[0], partes: d.partes.length, luzes: d.partes.filter((p) => p.tipo === "luz").length, taxa: part.taxa, vida: part.vida, rajada: part.rajada, cor: part.cor[0], cad: lanc.cadencia, porTiro: lanc.porTiro, vel: lanc.velocidade };
    });
    ok(!/[<>]/.test(limpo.nome) && limpo.osso === "rightHand" && limpo.pos === 2 && limpo.partes <= 64 && limpo.luzes === 4 && limpo.taxa === 300 && limpo.vida === 8 && limpo.rajada === 400 && limpo.cor === "#ffffff" && limpo.cad === 50 && limpo.porTiro === 12 && limpo.vel === 200,
      "a ficha de um item é conferida ao abrir: sem HTML no nome, até 64 partes e 4 luzes, partículas, cadência, projéteis e velocidade dentro dos limites");

    // ── publicar na loja (o dono publica sem conta) ──
    await ana.pagina.click("#estudio-publicar");
    await ana.pagina.waitForSelector("#estudio-tags");
    await ana.pagina.fill("#estudio-tags", "lanterna teste");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Publicar")');
    await esperar(ana, async () => (await C.loja.lista()).itens.some((i) => i.tipo === "item" && i.nome === "Lanterna de teste"));
    const naLoja = await ana.ev(async () => { const i = (await C.loja.lista()).itens.find((x) => x.tipo === "item"); return { tags: (i.tags || []).join(), mini: !!i.miniatura, arquivo: i.arquivo }; });
    ok(naLoja.tags === "lanterna,teste" && naLoja.mini && /\.glb$/.test(naLoja.arquivo), "Publicar: o item vai para a loja, na categoria Itens, com os # e a foto");
    await ana.ev(() => C.webc.ir("loja", { tipo: "item" }));
    await ana.pagina.waitForSelector('.webc-loja .cartao-loja[data-tipo="item"]', { timeout: 20000 });
    ok(true, "a loja mostra o item na categoria Itens");

    // ── no jogo: a sala, segurar, usar, esconder ──
    await ana.ev(() => C.webc.ir("sala"));
    await ana.pagina.waitForSelector(".salas #sala-criar", { timeout: 20000 });
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForSelector(".link-sala input");
    const codigo = ((await ana.pagina.inputValue(".link-sala input")).match(/#sala=([a-z0-9]+)$/) || [])[1];
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    await ana.pagina.click("#jogo-menu");
    await ana.pagina.click('.jogo-opcoes [data-secao="itens"]');
    await ana.pagina.waitForSelector('.jogo-inventario [data-acao="segurar"]');
    await ana.pagina.click('.jogo-inventario [data-acao="segurar"]');
    await ana.pagina.waitForSelector('.jogo-inventario [data-acao="guardar"]', { timeout: 15000 });
    await ana.pagina.click(".jogo-opcoes-fechar");
    const naMao = await ana.ev(() => { const p = window.Companhia.palco, it = document.querySelector("#jogo-item"); let osso = null; const base = (window.__vivo = null); void base;
      for (const [n, no] of Object.entries(p.nos)) if (no.children.some((c) => c.children.some((x) => /^item:/.test(x.name)))) osso = n;
      return { osso, segurando: p.segurando, chip: !it.hidden && /Lanterna de teste/.test(it.textContent), mira: !document.querySelector(".mira-item").hidden }; });
    ok(naMao.osso === "rightHand" && naMao.segurando === "rightHand" && naMao.chip && naMao.mira, "Opções › Itens › Segurar: o item vai para a mão direita (os dedos fecham), aparece o nome com as teclas e a mira no meio da tela");
    await ana.pagina.mouse.click(300, 700);
    await ana.pagina.keyboard.down("KeyE");
    await ana.pagina.waitForTimeout(600);
    const usando = await ana.ev(() => { const s = window.Companhia.sala.meuEstado(); return { it: s.it, luz: null }; });
    await ana.pagina.keyboard.up("KeyE");
    ok(usando.it && usando.it.on === 1 && usando.it.u[0] >= 1 && usando.it.u.length === 4 && usando.it.s === 1 && Array.isArray(usando.it.lz), "E usa o item: o lançador atira para onde a câmera aponta e a sala recebe os usos, a mira e as luzes");
    await foto(ana, "item-na-mao");
    await ana.pagina.keyboard.press("KeyG");
    ok(await ana.ev(() => window.Companhia.sala.meuEstado().it.on === 0), "G esconde o item (e os outros param de ver)");
    await ana.pagina.keyboard.press("KeyG");

    // ── a Bia entra e vê o item na mão da Ana ──
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await bia.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return r.item && r.avatar && r.item.raiz.visible && r.item.base && r.item.base.parent === r.avatar.nos.rightHand; }, null, { timeout: 60000 });
    ok(true, "a Bia vê o item na mão direita da Ana (o arquivo vem pela sala, uma vez)");
    await ana.pagina.keyboard.down("KeyE");
    await bia.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].item.projeteis.length > 0, null, { timeout: 15000 }).then(() => ok(true, "a Ana atira e a Bia vê os tiros saindo do item"), () => ok(false, "a Ana atira e a Bia vê os tiros saindo do item"));
    await ana.pagina.keyboard.up("KeyE");

    // ── ajustar no meu corpo ──
    await ana.pagina.click("#jogo-menu");
    await ana.pagina.click('.jogo-opcoes [data-secao="itens"]');
    await ana.pagina.click('.jogo-inventario [data-acao="ajustar"]');
    await ana.pagina.waitForSelector(".estudio-itens.ajustando .estudio-tela canvas", { timeout: 20000 });
    await ana.pagina.waitForTimeout(800);
    const campoY = ana.pagina.locator('.estudio-props .estudio-secao .estudio-tres').first().locator('input[aria-label="Y"]');
    await campoY.fill("0.05");
    await ana.pagina.click("#estudio-salvar");
    await ana.pagina.waitForTimeout(300);
    const ajuste = await ana.ev(async () => { const l = await C.itens.lista(); return { aj: C.itens.ajuste(l[0].id), sala: window.Companhia.sala.meuEstado().it.aj }; });
    ok(ajuste.aj && Math.abs(ajuste.aj.pos[1] - 0.05) < 1e-6 && Math.abs(ajuste.sala.pos[1] - 0.05) < 1e-6, "Ajustar no meu corpo: o encaixe muda só para a Ana, vale para o item na mão e vai para a sala");
    await bia.pagina.waitForFunction(() => { const it = [...window.Companhia.sala.remotos.values()][0].item; return Math.abs(it.encaixe.pos[1] - 0.05) < 1e-6; }, null, { timeout: 15000 }).then(() => ok(true, "a Bia vê o item no lugar novo"), () => ok(false, "a Bia vê o item no lugar novo"));

    await bia.ev(() => window.Companhia.sala.sair());
    await ana.ev(() => window.Companhia.sala.fechar());
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push(String((e && e.stack) || e));
    console.log("  ✖ " + e);
  } finally {
    for (const n of navegadores) await n.close();
  }
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})();
