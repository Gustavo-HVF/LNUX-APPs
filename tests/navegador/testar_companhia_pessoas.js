// Teste das outras pessoas no WEBC, no Chromium: pesquisar por alguém (o cartão preto com a foto e o nome), as três
// bolinhas em cima da personagem de alguém (adicionar amigo, ver perfil e chat privado) e o chat privado.
// Rode com: python3 tests/testar_navegador.py companhia_pessoas
//
// Dois navegadores, como duas pessoas com conta (criadas com um SMTP de mentira): a Ana abre pelo LNUX (com a chave
// da ponte) e cria a sala; a Bia chega só pelo endereço.
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

(async () => {
  const navegadores = [], consola = [];
  const pessoa = async (nome) => {
    const n = await chromium.launch();
    navegadores.push(n);
    const contexto = await n.newContext({ viewport: { width: 1100, height: 760 }, locale: "pt-BR" });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    await contexto.addInitScript(() => { try { localStorage.setItem("companhia.luz", JSON.stringify({ realista: false, sombras: false })); } catch (e) { /* sem armazenamento */ } });
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const ana = await pessoa("Ana"), bia = await pessoa("Bia");
  const smtp = await smtpFalso();
  /** Onde fica, na tela da Ana, o meio do corpo da Bia. */
  const ondeEstaBia = () => ana.ev(() => { const s = window.Companhia.sala, r = [...s.remotos.values()][0], p = s.naTela(r, r.altura * 0.55); return p && [p.x, p.y]; });
  const abrirBolhas = async () => {
    for (let vez = 0; ; vez++) {
      const [x, y] = await ondeEstaBia();
      await ana.pagina.mouse.click(x, y);
      try { await ana.pagina.waitForSelector(".pessoa-bolhas .pessoa-bolha", { timeout: 3000 }); return; }
      catch (e) { if (vez >= 2) throw e; } // ela ainda se mexia: tenta de novo
    }
  };
  try {
    // ── as contas ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}`);
    await ana.pagina.waitForFunction(() => window.C && C.contas && window.Companhia);
    await configurarEmail(ana, smtp.porta);
    const anaId = await criarConta(smtp, ana, "Ana Pessoas", "ana.pessoas@exemplo.com");
    await bia.pagina.goto(`${BASE}/apps/companhia/`);
    await bia.pagina.waitForFunction(() => window.C && C.contas && window.Companhia);
    const biaId = await criarConta(smtp, bia, "Bia Pessoas", "bia.pessoas@exemplo.com");
    ok(!!anaId && !!biaId, "a Ana e a Bia criam as contas (código pelo e-mail de mentira)");

    // ── pesquisar por alguém ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar`);
    await ana.pagina.reload();
    await ana.pagina.waitForSelector("#webc-buscar", { timeout: 30000 });
    await ana.pagina.click("#webc-buscar");
    await ana.pagina.waitForSelector(".busca-pessoas #busca-pessoas-campo");
    const cartao = await ana.ev(() => {
      const c = document.querySelector(".busca-pessoas"), linha = c.querySelector(".busca-pessoas-linha"), s = getComputedStyle(c);
      return { fundo: s.backgroundColor, raio: parseFloat(s.borderTopLeftRadius), placeholder: c.querySelector("input").placeholder, lupa: !!linha.querySelector("svg"),
        linha: getComputedStyle(linha).borderBottomStyle, foco: document.activeElement === c.querySelector("input"), direita: c.getBoundingClientRect().right > innerWidth - 60 };
    });
    ok(cartao.fundo === "rgb(0, 0, 0)" && cartao.raio >= 16 && cartao.placeholder === "pesquisa por alguém" && cartao.lupa && cartao.linha === "solid" && cartao.foco && cartao.direita,
      "a lupa no alto abre o cartão preto à direita: a lupa, \"pesquisa por alguém\" com a linha embaixo, já com o cursor");
    await ana.pagina.fill("#busca-pessoas-campo", "bia pes");
    await ana.pagina.waitForSelector(`.busca-pessoas-pessoa[data-id="${biaId}"]`, { timeout: 5000 });
    const achou = await ana.ev((id) => {
      const p = document.querySelector(`.busca-pessoas-pessoa[data-id="${id}"]`), foto = p.querySelector(".foto-conta"), r = foto.getBoundingClientRect();
      return { nome: p.querySelector(".busca-pessoas-nome").textContent, redonda: getComputedStyle(foto).borderRadius, largura: r.width, antes: r.right <= p.querySelector(".busca-pessoas-nome").getBoundingClientRect().left,
        amigo: p.querySelector(".busca-pessoas-amigo") && p.querySelector(".busca-pessoas-amigo").dataset.relacao, todos: document.querySelectorAll(".busca-pessoas-pessoa").length };
    }, biaId);
    ok(achou.nome === "Bia Pessoas" && /50%|9999|px/.test(achou.redonda) && achou.largura >= 48 && achou.antes && achou.todos === 1,
      "digitando parte do nome, aparece a pessoa: a foto redonda e, ao lado, o nome");
    await ana.pagina.fill("#busca-pessoas-campo", "ninguém assim");
    await ana.pagina.waitForSelector('.busca-pessoas-dica:text-is("Ninguém com esse nome.")');
    ok(true, "um nome que não existe avisa \"Ninguém com esse nome.\"");
    await ana.pagina.fill("#busca-pessoas-campo", "BIA");
    await ana.pagina.waitForSelector(`.busca-pessoas-pessoa[data-id="${biaId}"] .busca-pessoas-abrir`);
    await ana.pagina.click(`.busca-pessoas-pessoa[data-id="${biaId}"] .busca-pessoas-abrir`);
    await ana.pagina.waitForSelector('.perfil-nome:text-is("Bia Pessoas")', { timeout: 10000 });
    ok(await ana.ev(() => !document.querySelector(".busca-pessoas") && C.webc.pagina === "perfil"), "um clique na pessoa abre o perfil dela (e o cartão fecha)");
    await ana.pagina.click("#webc-buscar");
    await ana.pagina.waitForSelector(".busca-pessoas");
    await ana.pagina.waitForTimeout(100);
    await ana.pagina.keyboard.press("Escape");
    ok(await ana.ev(() => !document.querySelector(".busca-pessoas")), "o Esc fecha o cartão");

    // ── a Ana cria a sala; a Bia entra ──
    await ana.ev(() => C.webc.ir("sala"));
    await ana.pagina.waitForSelector(".salas #sala-criar", { timeout: 30000 });
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Nome da sala"]', "Sala das Pessoas");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForSelector(".link-sala input");
    const codigo = ((await ana.pagina.inputValue(".link-sala input")).match(/#sala=([a-z0-9]+)$/) || [])[1];
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await bia.pagina.reload();
    await bia.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    await ana.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return r && r.conta && r.avatar; }, null, { timeout: 60000 });
    // a Bia anda um pouco para a frente, para a Ana a ver na frente da câmera
    await bia.pagina.mouse.click(250, 650);
    await bia.pagina.keyboard.down("KeyW");
    await bia.pagina.waitForTimeout(900);
    await bia.pagina.keyboard.up("KeyW");
    await ana.pagina.waitForTimeout(1500);
    ok(!!(await ondeEstaBia()), "a Bia entra na sala e aparece na tela da Ana");

    // ── as três bolinhas ──
    await abrirBolhas();
    const bolhas = await ana.ev(() => {
      const s = window.Companhia.sala, r = [...s.remotos.values()][0], topo = s.naTela(r, r.altura);
      return [...document.querySelectorAll(".pessoa-bolhas .pessoa-bolha")].map((b) => {
        const c = getComputedStyle(b), q = b.getBoundingClientRect();
        return { opcao: b.dataset.opcao, fundo: c.backgroundColor, borda: c.borderTopColor, bordaLargura: parseFloat(c.borderTopWidth), redonda: Math.abs(q.width - q.height) < 2,
          icone: !!b.querySelector(".pessoa-bolha-icone svg"), texto: b.querySelector(".pessoa-bolha-texto").getBoundingClientRect().width, rotulo: b.getAttribute("aria-label"),
          cx: q.left + q.width / 2 - topo.x, cy: q.top + q.height / 2 - topo.y };
      });
    });
    ok(bolhas.map((b) => b.opcao).join() === "amigo,perfil,privado", "clicar na personagem da Bia abre três bolinhas: adicionar amigo, ver perfil e chat privado");
    ok(bolhas.every((b) => b.fundo === "rgb(255, 255, 255)" && b.borda === "rgb(0, 0, 0)" && b.bordaLargura >= 2 && b.redonda && b.icone && b.texto < 1),
      "as bolinhas são brancas com a borda preta e, paradas, mostram só o desenho (sem texto)");
    ok(bolhas[0].cy < -30 && bolhas[1].cx > bolhas[0].cx && bolhas[2].cx > bolhas[1].cx && bolhas[2].cy > bolhas[1].cy && bolhas[1].cy > bolhas[0].cy,
      `ficam em cima da personagem, num arco do alto para o lado (${bolhas.map((b) => `${Math.round(b.cx)},${Math.round(b.cy)}`).join(" · ")})`);
    // passar o mouse: a bolinha se estica e mostra o nome
    await ana.pagina.hover('.pessoa-bolha[data-opcao="perfil"]');
    await ana.pagina.waitForTimeout(400);
    const esticada = await ana.ev(() => { const b = document.querySelector('.pessoa-bolha[data-opcao="perfil"]'), q = b.getBoundingClientRect(); return { largura: q.width, altura: q.height, texto: b.querySelector(".pessoa-bolha-texto").textContent, visivel: b.querySelector(".pessoa-bolha-texto").getBoundingClientRect().width > 20 }; });
    ok(esticada.largura > esticada.altura * 2 && esticada.visivel && esticada.texto === "Ver perfil", `passando o mouse, a bolinha se estica e diz o nome: "${esticada.texto}"`);
    await ana.pagina.waitForFunction(() => /Adicionar amigo/.test(document.querySelector('.pessoa-bolha[data-opcao="amigo"]').getAttribute("aria-label")));

    // adicionar amigo
    await ana.pagina.click('.pessoa-bolha[data-opcao="amigo"]');
    await ana.pagina.waitForFunction(() => document.querySelector('.pessoa-bolha[data-opcao="amigo"]').dataset.relacao === "enviado", null, { timeout: 5000 });
    const pedidos = await bia.ev(async () => ((await C.contas.carregar()).pedidos || []).map((p) => p.nome));
    ok(pedidos.includes("Ana Pessoas"), "Adicionar amigo: a Bia recebe o pedido de amizade da Ana (e a bolinha passa a dizer \"Pedido enviado\")");
    await ana.pagina.keyboard.press("Escape");
    ok(await ana.ev(() => !document.querySelector(".pessoa-bolhas")), "o Esc fecha as bolinhas");

    // ver perfil
    await abrirBolhas();
    await ana.pagina.click('.pessoa-bolha[data-opcao="perfil"]');
    await ana.pagina.waitForSelector('.perfil-nome:text-is("Bia Pessoas")', { timeout: 10000 });
    ok(await ana.ev(() => C.webc.visivel && C.webc.pagina === "perfil" && window.Companhia.sala.dentro), "Ver perfil abre o perfil da Bia no site (a sala continua)");
    await ana.pagina.click("#webc-voltar-sala");
    await ana.pagina.waitForFunction(() => !C.webc.visivel);

    // ── o chat privado ──
    await ana.pagina.waitForTimeout(500);
    await abrirBolhas();
    await ana.pagina.click('.pessoa-bolha[data-opcao="privado"]');
    await bia.pagina.waitForSelector(".privado-pedido", { timeout: 10000 });
    ok(await bia.ev(() => /Ana Pessoas/.test(document.querySelector(".privado-pedido").textContent) && /quer conversar no privado/.test(document.querySelector(".privado-pedido").textContent)),
      "Chat privado: a Bia recebe o pedido (\"Ana Pessoas quer conversar no privado.\") com Aceitar e Recusar");
    ok(await ana.ev(() => /Esperando Bia Pessoas aceitar/.test(document.querySelector(".privado-janela .privado-estado").textContent) && document.querySelector(".privado-campo").disabled),
      "do lado da Ana, a janelinha espera a Bia aceitar (sem escrever ainda)");
    await bia.pagina.click('.privado-pedido [data-acao="aceitar"]');
    await ana.pagina.waitForFunction(() => !document.querySelector(".privado-campo").disabled, null, { timeout: 10000 });
    await bia.pagina.waitForSelector(".privado-janela .privado-campo:not([disabled])");
    ok(await bia.ev(() => !document.querySelector(".privado-pedido")), "a Bia aceita: as duas ficam com a janelinha do chat privado aberta");
    await ana.pagina.fill(".privado-campo", "isto é só para você");
    await ana.pagina.keyboard.press("Enter");
    await bia.pagina.waitForFunction(() => [...document.querySelectorAll(".privado-msg.ela")].some((m) => m.textContent === "isto é só para você"), null, { timeout: 10000 });
    const naBia = await bia.ev(() => ({ papo: document.querySelector("#mensagens").textContent, balao: !![...window.Companhia.sala.remotos.values()][0].balao }));
    ok(!/só para você/.test(naBia.papo) && !naBia.balao, "a mensagem chega à Bia só na janelinha: nada no bate-papo da sala nem no balão em cima da personagem");
    ok(await ana.pagina.waitForFunction(() => [...document.querySelectorAll(".privado-msg.eu")].some((m) => m.textContent === "isto é só para você"), null, { timeout: 10000 }).then(() => true, () => false),
      "e aparece para a Ana do lado dela");
    await bia.pagina.click('.privado-janela [data-acao="fechar"]');
    await ana.pagina.waitForFunction(() => /fechou o chat privado/.test(document.querySelector(".privado-janela").textContent), null, { timeout: 10000 });
    ok(await ana.ev(() => document.querySelector(".privado-campo").disabled), "a Bia fecha o chat privado: a Ana é avisada e não escreve mais");

    await bia.ev(() => window.Companhia.sala.sair());
    await ana.ev(() => window.Companhia.sala.fechar());
    ok(await ana.ev(() => !document.querySelector(".privado-janela") && !document.querySelector(".pessoa-bolhas")), "ao sair da sala, as janelinhas e as bolinhas somem");
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push(String((e && e.stack) || e));
    console.log("  ✖ " + e);
  } finally {
    await apagarConta(ana);
    await apagarConta(bia);
    smtp.srv.close();
    for (const n of navegadores) await n.close();
  }
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})();
