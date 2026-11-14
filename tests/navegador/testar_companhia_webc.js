// Teste do WEBC (o site do modo de jogar), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_webc
//
// Não manda e-mail de verdade (um servidor SMTP de mentira, como no teste das contas). Pessoas em navegadores
// separados: o "dono" (com a chave da ponte, só para preparar a loja e o e-mail), a "Ana" e a "Bia" (com conta) e uma
// visita sem conta, com o navegador em inglês. Cobre: os três idiomas (o navegador em inglês já abre em inglês; trocar
// para japonês e português na tela de entrar, sem recarregar, e a escolha fica guardada); a paleta de temas (os do
// VLC-Web, sem emoji; o tema fica guardado); a transição entre as páginas; a loja com # (quem pesquisa "fnaf" acha o
// que tem #fnaf mesmo sem fnaf no nome), curtir só com conta, quantas pessoas baixaram e salvar no perfil; a página
// do perfil (capa, foto, bio, salvos e amigos); pedir, aceitar e desfazer amizade; a tela de carregamento ao entrar
// numa sala; e que nada no site fala do LNUX nem do aparelho.
const { chromium } = require("playwright");
const { menus, nomeGuardado } = require("./companhia_menus.js");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { execFileSync } = require("child_process");
const { bonecoVRM0, bvhDeTeste } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** Um servidor de e-mail de mentira: guarda o que chega. */
function smtpFalso() {
  const caixa = [];
  const srv = net.createServer((s) => {
    let dados = false, buf = "", msg = [];
    s.write("220 falso ESMTP\r\n");
    s.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (dados) { if (l === ".") { dados = false; caixa.push(msg.join("\r\n")); msg = []; s.write("250 ok\r\n"); } else msg.push(l); continue; }
        const u = l.toUpperCase();
        if (u.startsWith("EHLO") || u.startsWith("HELO")) s.write("250-falso\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (u.startsWith("AUTH")) s.write("235 ok\r\n");
        else if (u === "DATA") { dados = true; s.write("354 manda\r\n"); }
        else if (u === "QUIT") { s.write("221 tchau\r\n"); s.end(); }
        else s.write("250 ok\r\n");
      }
    });
    s.on("error", () => {});
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, porta: srv.address().port, caixa })));
}
/** O assunto e o destinatário do e-mail (lidos pelo Python, que entende a codificação dos cabeçalhos). */
function lerEmail(bruto) {
  const saida = execFileSync("python3", ["-c", "import email, email.policy, json, sys\nm = email.message_from_string(sys.stdin.read(), policy=email.policy.default)\n" +
    "print(json.dumps({'assunto': str(m['Subject']), 'para': str(m['To'])}))"], { input: bruto });
  return JSON.parse(saida.toString("utf8"));
}

(async () => {
  const smtp = await smtpFalso();
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome, locale = "pt-BR") => {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 820 }, locale });
    await nomeGuardado(contexto, nome);
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text()) && !/40[13]/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const semLnux = (p) => p.ev(() => { const w = document.querySelector("#webc"); return !/LNUX|Companhia|celular|aparelho de quem/i.test(w ? w.innerText : document.body.innerText); });
  /** Cria uma conta pela API (com o código que chega no e-mail de mentira) e entra com ela. */
  const criarConta = async (p, nome, email) => {
    const antes = smtp.caixa.length;
    await p.ev(([n, e]) => C.contas.cadastrar({ nome: n, email: e, senha: "segredo123", idade: 22 }), [nome, email]);
    for (let i = 0; i < 100 && smtp.caixa.length <= antes; i++) await new Promise((r) => setTimeout(r, 100));
    const m = lerEmail(smtp.caixa[smtp.caixa.length - 1]);
    const codigo = (m.assunto.match(/\b(\d{6})\b/) || [])[1];
    return p.ev(([e, c]) => C.contas.verificar(e, c).then((x) => x.id), [email, codigo]);
  };
  const dono = await pessoa("dono"), ana = await pessoa("Ana"), bia = await pessoa("Bia"), visita = await pessoa("visita", "en-US");
  try {
    // ── o dono: o e-mail dos códigos e três itens na loja (um com #fnaf sem fnaf no nome) ──
    await dono.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar`);
    await dono.pagina.waitForSelector('.webc-cartao[data-ir="loja"]', { timeout: 30000 });
    await dono.ev(async ([porta, vrm, bvh]) => {
      await C.contas.salvarAjustes({ email: { servidor: "127.0.0.1", porta, seguranca: "nenhuma", usuario: "dono@exemplo.com", senha: "x", remetente: "dono@exemplo.com", nome: "WEBC" }, exigir_conta: false });
      const blob = (x) => new Blob([Uint8Array.from(atob(x), (c) => c.charCodeAt(0))]);
      await C.loja.publicar({ tipo: "personagem", blob: blob(vrm), arquivo: "urso.vrm", nome: "Urso animatrônico", descricao: "Um urso de pizzaria.", autor: "Dono", tags: ["fnaf", "terror"] });
      await C.loja.publicar({ tipo: "animacao", blob: blob(bvh), arquivo: "aceno.bvh", nome: "Aceno do urso", autor: "Dono", tags: ["fnaf"] });
    }, [smtp.porta, bonecoVRM0().toString("base64"), Buffer.from(bvhDeTeste()).toString("base64")]);
    const itens = (await dono.ev(() => C.loja.lista())).itens;
    const urso = itens.find((i) => i.nome === "Urso animatrônico"), aceno = itens.find((i) => i.nome === "Aceno do urso");
    ok(urso && urso.tags.join() === "fnaf,terror" && aceno && aceno.tags.join() === "fnaf", "publicar na loja com # (o urso ganha #fnaf e #terror)");

    // ── os idiomas: o navegador em inglês abre em inglês; troca sem recarregar e fica guardado ──
    await visita.pagina.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const app = document.querySelector(".lnux-app");
      window.__abertura = { carregando: document.documentElement.hasAttribute("data-carregando"), app: app && getComputedStyle(app).visibility, logo: !!document.querySelector(".webc-abrindo") };
    }));
    await visita.pagina.goto(`${BASE}/apps/companhia/`);
    await visita.pagina.waitForSelector(".tela-inicio #inicio-sem-conta");
    const abertura = await visita.ev(() => ({ ...window.__abertura, depois: document.documentElement.hasAttribute("data-carregando") }));
    ok(abertura.carregando && abertura.app === "hidden" && abertura.logo && !abertura.depois, "ao abrir, só o logo do WEBC aparece até a tela de entrar ficar pronta (o layout do chat bot não pisca)");
    const ingles = await visita.ev(() => ({ lang: document.documentElement.lang, entrar: document.querySelector("#conta-entrar").textContent, sem: document.querySelector("#inicio-sem-conta").textContent,
      email: document.querySelector('.tela-inicio input[type="email"]').getAttribute("aria-label"), ativo: document.querySelector(".webc-login-idiomas .ativo").dataset.idioma }));
    ok(ingles.lang === "en" && ingles.entrar === "Log in" && ingles.sem === "Play without an account" && ingles.ativo === "en", `o navegador em inglês já abre em inglês ("${ingles.entrar}", "${ingles.sem}")`);
    await visita.pagina.click('.webc-login-idiomas [data-idioma="ja"]');
    const japones = await visita.ev(() => ({ lang: document.documentElement.lang, entrar: document.querySelector("#conta-entrar").textContent, criar: document.querySelector(".conta-criar").textContent, guardado: localStorage.getItem("webc.idioma") }));
    ok(japones.lang === "ja" && japones.entrar === "ログイン" && /アカウントを作成/.test(japones.criar) && japones.guardado === "ja", `japonês: troca na hora, sem recarregar ("${japones.entrar}") e fica guardado`);
    await visita.pagina.click('.webc-login-idiomas [data-idioma="pt"]');
    ok(await visita.ev(() => document.querySelector("#conta-entrar").textContent === "Entrar" && document.documentElement.lang === "pt-BR"), "e de volta ao português");
    await visita.pagina.click('.webc-login-idiomas [data-idioma="en"]');
    await visita.pagina.click("#inicio-sem-conta");
    await visita.pagina.waitForSelector("#inicio-nome");
    ok(await visita.ev(() => document.querySelector("#inicio-jogar").textContent === "Play" && document.querySelector("#inicio-nome").getAttribute("aria-label") === "Your name"),
      "jogar sem conta pede o nome no próprio cartão (\"Your name\", \"Play\")");
    await visita.pagina.fill("#inicio-nome", "Visitor");
    await visita.pagina.click("#inicio-jogar");
    await visita.pagina.waitForSelector('.webc-cartao[data-ir="loja"]', { timeout: 30000 });
    const inicioEn = await visita.ev(() => ({ cartoes: [...document.querySelectorAll(".webc-cartao")].map((c) => c.textContent).join(" | "), nav: [...document.querySelectorAll(".webc-nav [data-ir]")].map((b) => b.textContent).join() }));
    ok(/store/i.test(inicioEn.cartoes) && /rooms/i.test(inicioEn.cartoes) && /profile/i.test(inicioEn.cartoes) && /^store,rooms,profile$/i.test(inicioEn.nav), `o início em inglês: ${inicioEn.nav}`);
    ok(await semLnux(visita), "nada no site fala do LNUX, da Companhia nem do aparelho de quem tem o servidor");

    // ── a paleta de temas (os do VLC-Web) ──
    const paleta = await visita.ev(() => { const b = document.querySelector("#webc-tema"); return { svg: !!b.querySelector("svg"), emoji: /\p{Extended_Pictographic}/u.test(b.textContent), titulo: b.getAttribute("title") || b.getAttribute("aria-label") }; });
    await visita.pagina.click("#webc-tema");
    await visita.pagina.waitForSelector(".galeria-temas .tema-opcao");
    const temas = await visita.ev(() => [...document.querySelectorAll(".galeria-temas .tema-opcao")].map((b) => b.dataset.tema));
    ok(paleta.svg && !paleta.emoji && temas.length === 32 && ["webc", "default", "synthwave", "sakura", "steampunk"].every((x) => temas.includes(x)),
      `o botão do tema é uma paleta desenhada (sem emoji) e abre a galeria com o WEBC e os ${temas.length - 1} temas do VLC-Web`);
    const fundoAntes = await visita.ev(() => getComputedStyle(document.documentElement).getPropertyValue("--fundo").trim());
    await visita.pagina.click('.galeria-temas [data-tema="synthwave"]');
    const tema = await visita.ev(() => ({ skin: document.documentElement.dataset.skin, tom: document.documentElement.dataset.tema, fundo: getComputedStyle(document.documentElement).getPropertyValue("--fundo").trim(), guardado: localStorage.getItem("webc.tema") }));
    ok(tema.skin === "synthwave" && tema.tom === "escuro" && tema.fundo !== fundoAntes && tema.guardado === "synthwave", `escolher Synthwave muda as cores na hora (fundo ${fundoAntes} → ${tema.fundo}) e fica guardado`);

    // ── a transição entre as páginas ──
    await visita.ev(() => { window.__transicoes = []; new MutationObserver((l) => { for (const m of l) for (const n of m.addedNodes) if (n.classList && n.classList.contains("webc-pagina")) window.__transicoes.push(n.className); }).observe(document.querySelector(".webc-conteudo"), { childList: true }); });
    await visita.pagina.click('.webc-nav [data-ir="loja"]');
    await visita.pagina.waitForSelector(".webc-loja .cartao-loja", { timeout: 20000 });
    ok(await visita.ev(() => window.__transicoes.some((c) => /webc-entra/.test(c))), "ir a uma página tem transição (a página entra com uma animação)");
    await visita.pagina.screenshot({ path: path.join(PASTA, "companhia-webc-loja-en.png") });

    // ── a loja: as três categorias, a pesquisa pelo # e curtir só com conta ──
    const loja = await visita.ev(() => ({ titulo: document.querySelector(".webc-loja .webc-painel-titulo").textContent, abas: [...document.querySelectorAll(".webc-loja .loja-aba")].map((a) => a.dataset.tipo).join() }));
    ok(loja.titulo === "STORE" && loja.abas.split(",").sort().join() === "animacao,mundo,personagem", `a loja tem as três categorias: mapas, personagens e animações (título "${loja.titulo}")`);
    await visita.pagina.fill(".webc-loja .loja-busca", "fnaf");
    const fnaf = await visita.ev(() => [...document.querySelectorAll(".webc-loja .cartao-loja .nome")].map((n) => n.textContent));
    ok(fnaf.join() === "Urso animatrônico", "quem pesquisa \"fnaf\" acha o urso (que tem #fnaf, mesmo sem fnaf no nome)");
    await visita.pagina.fill(".webc-loja .loja-busca", "#terror");
    ok((await visita.ev(() => [...document.querySelectorAll(".webc-loja .cartao-loja .nome")].map((n) => n.textContent).join())) === "Urso animatrônico", "pesquisar \"#terror\" acha pelo #");
    await visita.pagina.fill(".webc-loja .loja-busca", "");
    await visita.pagina.click(".webc-loja .webc-filtro");
    ok(await visita.ev(() => !!document.querySelector('.webc-filtro-painel [data-tag="fnaf"]') && !!document.querySelector('.webc-filtro-painel [data-ordem="curtidos"]')), "o filtro mostra a ordem (mais curtidos, mais baixados...) e os # mais usados");
    await visita.pagina.click(`.webc-loja .cartao-loja[data-id="${urso.id}"] .webc-curtir`);
    await visita.pagina.waitForSelector(".lnux-aviso");
    const semConta = await visita.ev(async (id) => ({ aviso: document.querySelector(".lnux-aviso").textContent, api: (await fetch(`/api/loja/${id}/curtir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status,
      n: document.querySelector(`.cartao-loja[data-id="${id}"] .webc-curtir .numero`).textContent }), urso.id);
    ok(/Log in to like/.test(semConta.aviso) && semConta.api === 401 && semConta.n === "0", `sem conta não dá para curtir ("${semConta.aviso.trim()}"; o servidor responde ${semConta.api})`);

    // ── a Ana (com conta): curtir, baixar e salvar no perfil ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#modo=jogar`);
    await ana.pagina.waitForSelector('.webc-cartao[data-ir="loja"]', { timeout: 30000 });
    const anaId = await criarConta(ana, "Ana", "ana.webc@exemplo.com");
    await ana.pagina.click('.webc-nav [data-ir="loja"]');
    await ana.pagina.waitForSelector(`.webc-loja .cartao-loja[data-id="${urso.id}"]`, { timeout: 20000 });
    await ana.pagina.click(`.webc-loja .cartao-loja[data-id="${urso.id}"] .webc-curtir`);
    await ana.pagina.waitForSelector(`.webc-loja .cartao-loja[data-id="${urso.id}"] .webc-curtir.curti`);
    const curtido = await ana.ev(async (id) => ({ n: document.querySelector(`.cartao-loja[data-id="${id}"] .webc-curtir .numero`).textContent, servidor: (await C.loja.lista()).itens.find((i) => i.id === id) }), urso.id);
    ok(curtido.n === "1" && curtido.servidor.curtidas === 1 && curtido.servidor.curti, "com conta, a Ana curte o urso (1 curtida, guardada no servidor)");
    await ana.pagina.click(`.webc-loja .cartao-loja[data-id="${urso.id}"] .webc-curtir`);
    await ana.pagina.waitForFunction((id) => document.querySelector(`.cartao-loja[data-id="${id}"] .webc-curtir .numero`).textContent === "0", urso.id);
    await ana.pagina.click(`.webc-loja .cartao-loja[data-id="${urso.id}"] .webc-curtir`);
    await ana.pagina.waitForFunction((id) => document.querySelector(`.cartao-loja[data-id="${id}"] .webc-curtir .numero`).textContent === "1", urso.id);
    ok(true, "curtir de novo descurte (0) e curtir mais uma vez volta a 1: cada conta conta uma vez");
    // salvar no perfil
    await ana.pagina.click(`.webc-loja .cartao-loja[data-id="${urso.id}"]`);
    await ana.pagina.waitForSelector("#loja-salvar", { timeout: 20000 });
    await ana.pagina.click("#loja-salvar");
    await ana.pagina.waitForSelector('#loja-salvar[aria-pressed="true"]');
    ok(await ana.ev((id) => C.contas.salvou(id), urso.id), "\"Salvar no perfil\" guarda o urso na conta da Ana");
    // baixar: a animação (usar conta como baixar); a mesma conta não conta duas vezes
    await ana.pagina.click(".webc-loja .loja-voltar");
    await ana.pagina.click('.webc-loja .loja-aba[data-tipo="animacao"]');
    await ana.pagina.click(`.webc-loja .cartao-loja[data-id="${aceno.id}"]`);
    await ana.pagina.waitForSelector("#loja-usar", { timeout: 20000 });
    await ana.pagina.click("#loja-usar");
    await ana.pagina.waitForFunction(async (id) => (await C.loja.lista()).itens.find((i) => i.id === id).baixados === 1, aceno.id, { timeout: 30000 });
    await ana.ev((id) => C.loja.baixou({ id }), aceno.id);
    const baixados = await ana.ev(async (id) => (await C.loja.lista()).itens.find((i) => i.id === id).baixados, aceno.id);
    ok(baixados === 1, "usar a animação conta 1 em \"quantas pessoas baixaram\" (e a mesma pessoa não conta duas vezes)");
    await visita.ev((id) => C.loja.baixou({ id }), aceno.id);
    ok((await visita.ev(async (id) => (await C.loja.lista()).itens.find((i) => i.id === id).baixados, aceno.id)) === 2, "outra pessoa (sem conta) que baixa soma: 2");

    // ── o perfil como página: capa, foto, bio, salvos e amigos ──
    await ana.ev(() => C.contas.salvarPerfil({ bio: "Gosto de terror e de pizza." }));
    await ana.pagina.click('.webc-nav [data-ir="perfil"]');
    await ana.pagina.waitForSelector(".perfil-pagina .perfil-salvos .cartao-loja", { timeout: 20000 });
    const perfil = await ana.ev(() => { const p = document.querySelector(".perfil-pagina"); return { banner: !!p.querySelector(".perfil-banner"), foto: !!p.querySelector(".perfil-foto-grande"), bio: p.querySelector(".perfil-bio").textContent,
      salvos: [...p.querySelectorAll(".perfil-salvos .cartao-loja .nome")].map((n) => n.textContent), grupos: [...p.querySelectorAll(".perfil-grupo h3")].map((h) => h.firstChild.textContent).join(), secoes: [...p.querySelectorAll(".perfil-secao h2")].map((h) => h.textContent).join() }; });
    ok(perfil.banner && perfil.foto && perfil.bio === "Gosto de terror e de pizza." && perfil.salvos.join() === "Urso animatrônico" && perfil.grupos === "Personagens,Mapas,Animações" && /Bio,Salvos,Amigos/.test(perfil.secoes),
      "a página Perfil: a capa (banner), a foto, e descendo a bio, os salvos (personagens, mapas e animações) e os amigos");
    await ana.pagina.screenshot({ path: path.join(PASTA, "companhia-webc-perfil.png") });

    // ── o início: os widgets que a pessoa escolhe e as novidades ──
    await ana.pagina.click(".webc-logo, .webc-topo .webc-logo");
    await ana.pagina.waitForSelector('.webc-quadrado[data-quadrado="widgets"]', { timeout: 20000 });
    await ana.pagina.click('.webc-quadrado[data-quadrado="widgets"]');
    await ana.pagina.waitForSelector(".webc-widgets-escolher");
    for (const id of ["relogio", "notas", "salvos"]) await ana.pagina.click(`.webc-widget-opcao[data-widget="${id}"] button`);
    await ana.pagina.click('.lnux-dialogo footer button.primario');
    await ana.pagina.waitForSelector('.webc-widget[data-widget="salvos"] .webc-widget-miniatura', { timeout: 20000 });
    await ana.pagina.fill(".webc-notas", "levar o urso para a praça");
    await ana.pagina.waitForTimeout(500);
    await ana.pagina.reload();
    await ana.pagina.waitForSelector('.webc-widget[data-widget="notas"] .webc-notas', { timeout: 30000 });
    const widgets = await ana.ev(() => ({ ordem: [...document.querySelectorAll(".webc-widget")].map((w) => w.dataset.widget).join(), notas: document.querySelector(".webc-notas").value,
      hora: /\d/.test(document.querySelector(".webc-relogio-hora").textContent), salvo: [...document.querySelectorAll('.webc-widget[data-widget="salvos"] .nome')].map((n) => n.textContent).join() }));
    ok(widgets.ordem === "relogio,notas,salvos" && widgets.notas === "levar o urso para a praça" && widgets.hora && widgets.salvo === "Urso animatrônico",
      "os widgets que a Ana escolhe (relógio, notas, salvos) ficam no início dela, na ordem, e continuam depois de recarregar");
    await ana.pagina.click('.webc-widget[data-widget="notas"] .webc-widget-tirar');
    ok((await ana.ev(() => [...document.querySelectorAll(".webc-widget")].map((w) => w.dataset.widget).join())) === "relogio,salvos", "✕ tira um widget do início");
    await ana.pagina.click('.webc-quadrado[data-quadrado="novidades"]');
    await ana.pagina.waitForSelector(".novidades-pagina .novidades-loja .cartao-loja", { timeout: 20000 });
    ok(await ana.ev(() => document.querySelectorAll(".novidades-pagina .novidades-lista li").length >= 5 && !!document.querySelector('.novidades-loja .cartao-loja')), "Novidades: o que chegou na loja, as salas novas e o que mudou no WEBC");

    // ── amizade: a Ana pede, a Bia aceita ──
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar`);
    await bia.pagina.waitForSelector('.webc-cartao[data-ir="perfil"]', { timeout: 30000 });
    const biaId = await criarConta(bia, "Bia", "bia.webc@exemplo.com");
    await ana.ev((id) => C.webc.verPerfil(id), biaId);
    await ana.pagina.waitForSelector('.perfil-pagina .perfil-nome:text-is("Bia")', { timeout: 20000 });
    await ana.pagina.click('#perfil-amizade[data-relacao=""]');
    await ana.pagina.waitForSelector('#perfil-amizade[data-relacao="enviado"]');
    ok(true, "no perfil da Bia, a Ana clica em \"Adicionar amigo\" (fica \"Pedido enviado\")");
    await bia.pagina.click('.webc-nav [data-ir="perfil"]');
    await bia.pagina.waitForSelector(".perfil-pagina .perfil-pedidos [data-aceitar]", { timeout: 20000 });
    await bia.pagina.click(".perfil-pagina .perfil-pedidos [data-aceitar]");
    await bia.pagina.waitForSelector('.perfil-pagina .perfil-amigos .perfil-amigo:has-text("Ana")', { timeout: 20000 });
    const amigos = await ana.ev(async () => (await C.contas.carregar()).amigos.map((a) => a.nome || a));
    ok(amigos.some((a) => a === "Bia" || a === biaId), "a Bia vê o pedido no perfil dela, aceita, e as duas ficam amigas (a Ana aparece nos amigos da Bia e a Bia nos da Ana)");
    await ana.ev((id) => C.webc.verPerfil(id), biaId);
    await ana.pagina.waitForSelector('#perfil-amizade[data-relacao="amigo"]', { timeout: 20000 });
    await ana.pagina.click('#perfil-amizade[data-relacao="amigo"]');
    await ana.pagina.waitForSelector('#perfil-amizade[data-relacao=""]', { timeout: 20000 });
    ok(true, "e dá para desfazer a amizade");

    // ── a tela de carregamento ao entrar numa sala ──
    await ana.ev(() => { window.__carregou = false; new MutationObserver(() => { if (document.querySelector(".webc-carregando")) window.__carregou = true; }).observe(document.body, { childList: true }); });
    await ana.pagina.click('.webc-nav [data-ir="sala"]');
    await ana.pagina.waitForSelector(".salas #sala-criar", { timeout: 20000 });
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForFunction(() => !document.querySelector(".webc-carregando"), null, { timeout: 10000 });
    ok(await ana.ev(() => window.__carregou && !C.webc.visivel), "criar (ou entrar numa) sala mostra a tela de carregamento; depois o site some e fica o jogo");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")').catch(() => {});
    await ana.pagina.click(".lnux-marca");
    await ana.pagina.waitForSelector(".webc-na-sala:not([hidden]) #webc-voltar-sala", { timeout: 10000 });
    await ana.pagina.click("#webc-voltar-sala");
    await ana.pagina.waitForFunction(() => !C.webc.visivel, null, { timeout: 10000 });
    ok(true, "dentro da sala, o logo do WEBC leva ao site, e \"Voltar à sala\" volta ao jogo");
    await ana.ev(() => window.Companhia.sala.fechar());
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await ana.pagina.screenshot({ path: path.join(PASTA, "companhia-webc-erro.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    await navegador.close();
    smtp.srv.close();
  }
  console.log(`\nWEBC: ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
