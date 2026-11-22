// Teste do WEBC, no Chromium: nenhuma página mostra "null", "undefined" ou "NaN" (no texto, nas dicas, nos rótulos e
// nos campos). Passa pelo início, novidades, loja (as três categorias), sala, perfil (com e sem conta), cria uma
// sala, entra no jogo e abre cada seção das Opções. Também pega quem põe null direto na página (append,
// replaceChildren...): o navegador escreveria a palavra "null".
// Rode com: python3 tests/testar_navegador.py companhia_nulos
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { smtpFalso, configurarEmail, criarConta, apagarConta } = require("./companhia_email.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** Na página: guarda quem põe null ou undefined direto num elemento (com o caminho no código). */
function vigiarNulos() {
  window.__nulos = [];
  for (const nome of ["append", "prepend", "replaceChildren", "after", "before", "replaceWith"]) {
    for (const proto of [Element.prototype, DocumentFragment.prototype]) {
      const original = proto[nome];
      if (!original) continue;
      proto[nome] = function (...xs) {
        if (xs.some((x) => x === null || x === undefined)) window.__nulos.push(nome + ": " + (new Error().stack || "").split("\n").slice(2, 5).map((l) => l.trim()).join(" ← "));
        return original.apply(this, xs);
      };
    }
  }
}
/** O que a pessoa vê agora com "null", "undefined" ou "NaN": o texto, as dicas, os rótulos e os campos. */
function procurarNulos() {
  const ruim = /(^|[^\w-])(null|undefined|NaN)([^\w-]|$)/;
  const achados = [];
  const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const pai = n.parentElement;
    if (!pai || /^(SCRIPT|STYLE)$/.test(pai.tagName) || pai.closest("[hidden]")) continue;
    if (ruim.test(n.textContent)) achados.push(`texto em <${pai.tagName.toLowerCase()} class="${pai.className}">: ${n.textContent.trim().slice(0, 80)}`);
  }
  for (const e of document.querySelectorAll("[title], [aria-label], [placeholder], [alt], input, select, textarea")) {
    for (const a of ["title", "aria-label", "placeholder", "alt"]) { const v = e.getAttribute(a); if (v && ruim.test(v)) achados.push(`${a} em <${e.tagName.toLowerCase()} class="${e.className}">: ${v.slice(0, 80)}`); }
    if ("value" in e && e.type !== "hidden" && ruim.test(String(e.value || ""))) achados.push(`valor de <${e.tagName.toLowerCase()} class="${e.className}">: ${String(e.value).slice(0, 80)}`);
  }
  const titulo = document.title;
  if (ruim.test(titulo)) achados.push("título da aba: " + titulo);
  return achados;
}

(async () => {
  const navegador = await chromium.launch();
  const consola = [];
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  await contexto.addInitScript(vigiarNulos);
  await contexto.addInitScript(() => { try { localStorage.setItem("companhia.luz", JSON.stringify({ realista: false, sombras: false })); } catch (e) { /* sem armazenamento */ } });
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const p = { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  const smtp = await smtpFalso();
  const vistos = new Set();
  /** Confere a tela de agora (e junta o que achar, sem repetir). */
  const conferir = async (onde) => {
    await pagina.waitForTimeout(600);
    const achados = await pagina.evaluate(procurarNulos);
    const nulos = await pagina.evaluate(() => window.__nulos.splice(0));
    const novos = [...achados, ...nulos.map((n) => "null posto na página: " + n)].filter((x) => !vistos.has(x));
    novos.forEach((x) => vistos.add(x));
    ok(!novos.length, `${onde}: sem "null", "undefined" nem "NaN"` + (novos.length ? " — " + novos.slice(0, 4).join(" | ") : ""));
  };
  const ir = async (pag, opcoes = {}) => { await p.ev(([a, b]) => C.webc.ir(a, b), [pag, opcoes]); await pagina.waitForTimeout(400); };
  try {
    // ── sem conta ──
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}`);
    await pagina.waitForSelector(".tela-inicio #inicio-sem-conta", { timeout: 30000 });
    await conferir("a tela de entrar");
    await pagina.click("#inicio-sem-conta");
    await pagina.fill("#inicio-nome", "Nula");
    await pagina.click("#inicio-jogar");
    await pagina.waitForSelector('.webc-cartao[data-ir="loja"]', { timeout: 30000 });
    await conferir("o início (sem conta)");
    await ir("novidades"); await conferir("as novidades");
    await ir("perfil"); await conferir("o perfil (sem conta)");
    await ir("sala"); await pagina.waitForSelector(".salas", { timeout: 20000 }); await conferir("a página Sala (sem conta)");
    await pagina.click("#webc-eu"); await conferir("o menu da conta"); await pagina.keyboard.press("Escape");

    // ── com conta ──
    await configurarEmail(p, smtp.porta);
    await criarConta(smtp, p, "Nula Conta", "nula.conta@exemplo.com");
    await ir("inicio"); await conferir("o início (com conta)");
    await ir("perfil"); await pagina.waitForSelector(".perfil-nome"); await conferir("o meu perfil");
    // um item na loja sem descrição nem # (os campos vazios não podem virar "null")
    await p.ev(() => C.loja.publicar({ tipo: "personagem", blob: C.bonecoPadrao(), arquivo: "boneco.vrm", nome: "Boneco nulo" }));
    await ir("novidades"); await conferir("as novidades com um item na loja");
    await ir("loja", { tipo: "personagem" });
    await pagina.waitForSelector(".webc-loja .cartao-loja", { timeout: 20000 });
    await conferir("a loja com um item");
    await pagina.click(".webc-loja .cartao-loja");
    await pagina.waitForSelector(".loja-detalhe:not([hidden])", { timeout: 20000 });
    await conferir("um item da loja aberto");
    await pagina.keyboard.press("Escape");
    for (const tipo of ["personagem", "mundo", "animacao"]) { await ir("loja", { tipo }); await pagina.waitForSelector(".webc-loja"); await conferir(`a loja (${tipo})`); }
    await ir("sala"); await pagina.waitForSelector(".salas #sala-criar", { timeout: 20000 }); await conferir("a página Sala (com conta)");
    await pagina.click("#webc-buscar"); await pagina.fill("#busca-pessoas-campo", "nula"); await pagina.waitForSelector(".busca-pessoas-pessoa", { timeout: 5000 });
    await conferir("pesquisar por alguém"); await pagina.keyboard.press("Escape");

    // ── no jogo ──
    await pagina.click("#sala-criar");
    await pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await conferir("a janela de criar sala");
    await pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await pagina.waitForSelector(".link-sala input");
    await conferir("o link da sala");
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    await conferir("a tela do jogo");
    await pagina.click("#jogo-chat"); await conferir("o bate-papo aberto"); await pagina.click("#jogo-chat");
    await pagina.click("#jogo-menu");
    await pagina.waitForSelector(".jogo-opcoes [data-secao]");
    const secoes = await p.ev(() => [...document.querySelectorAll(".jogo-opcoes [data-secao]")].map((b) => b.dataset.secao));
    for (const s of secoes) { await pagina.click(`.jogo-opcoes [data-secao="${s}"]`); await conferir(`Opções › ${s}`); }
    await pagina.click(".jogo-opcoes-fechar");
    await ir("loja"); await conferir("a loja com a sala aberta por trás");
    await ir("sala"); await pagina.waitForSelector(".salas .cartao-sala", { timeout: 20000 }); await conferir("a página Sala com a minha sala na lista");
    await p.ev(() => window.Companhia.sala.fechar());
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push(String((e && e.stack) || e));
    console.log("  ✖ " + e);
  } finally {
    await apagarConta(p);
    smtp.srv.close();
    await navegador.close();
  }
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})();
