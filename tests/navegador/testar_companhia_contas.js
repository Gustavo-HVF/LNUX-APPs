// Teste das contas da Companhia (cadastro com o código por e-mail, entrar, perfil), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_contas
//
// Não manda e-mail de verdade: o teste sobe um servidor de e-mail (SMTP) de mentira e o dono do servidor o configura
// pela tela (Contas e e-mail). Duas pessoas, em navegadores separados: o "dono" (com a chave da ponte) e a "Ana" (só
// pelo endereço). Cobre: o dono configurando o e-mail (e o e-mail de teste chegando); a Ana criando a conta pela lista
// de salas, com o código que chegou por e-mail; o nome da conta no lugar do nome digitado; editar o perfil (foto
// recortada, bio, pronomes, link, cor) e o que fica guardado no servidor; a Ana criando uma sala e o dono vendo, em
// "Pessoas na sala", a foto e o perfil dela; sair, entrar de novo, "esqueci a senha"; a tela de início ("Continuar"
// com a conta deste navegador, entrar pelo cartão); e o dono exigindo conta.
const { chromium } = require("playwright");
const fs = require("fs");
const net = require("net");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

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
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, porta: srv.address().port, caixa })));
}
/** O assunto e o destinatário do e-mail (lidos pelo Python, que entende a codificação dos cabeçalhos). */
function lerEmail(bruto) {
  const saida = execFileSync("python3", ["-c", "import email, email.policy, json, sys\nm = email.message_from_string(sys.stdin.read(), policy=email.policy.default)\n" +
    "print(json.dumps({'assunto': str(m['Subject']), 'para': str(m['To']), 'de': str(m['From']), 'texto': m.get_content()}))"], { input: bruto });
  return JSON.parse(saida.toString("utf8"));
}
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) linhas.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(linhas)), bloco("IEND", Buffer.alloc(0))]);
}

(async () => {
  const smtp = await smtpFalso();
  const foto = path.join(PASTA, "foto-da-ana.png");
  fs.writeFileSync(foto, png(300, 200, [230, 60, 120]));
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome) => {
    const contexto = await navegador.newContext({ viewport: { width: 1200, height: 820 }, locale: "pt-BR" });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text()) && !/40[13]|409/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    pagina.on("crash", () => consola.push(`[${nome}] a página caiu (crash)`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const dono = await pessoa("dono"), ana = await pessoa("Ana");
  const esperarEmail = async (n) => { for (let i = 0; i < 100 && smtp.caixa.length < n; i++) await new Promise((r) => setTimeout(r, 100)); return smtp.caixa.length >= n ? lerEmail(smtp.caixa[n - 1]) : null; };
  const codigoDe = (m) => (m && (m.assunto.match(/\b(\d{6})\b/) || [])[1]) || "";
  try {
    // ── o dono configura o e-mail que manda os códigos ──
    await dono.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar&pagina=sala`);
    await dono.pagina.waitForSelector(".salas #contas-dono", { timeout: 30000 });
    await dono.pagina.click("#contas-dono");
    await dono.pagina.waitForSelector('.lnux-dialogo input[aria-label="Servidor SMTP"]');
    await dono.pagina.selectOption('.lnux-dialogo select[aria-label="Provedor de e-mail"]', "gmail");
    ok(await dono.ev(() => document.querySelector('.lnux-dialogo input[aria-label="Servidor SMTP"]').value === "smtp.gmail.com"), "o dono escolhe o provedor (Gmail) e o servidor e a porta se preenchem");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Servidor SMTP"]', "127.0.0.1");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Porta"]', String(smtp.porta));
    await dono.pagina.selectOption('.lnux-dialogo select[aria-label="Segurança"]', "nenhuma");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Usuário do e-mail"]', "dono@exemplo.com");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Senha do e-mail"]', "senha-de-app");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Remetente"]', "dono@exemplo.com");
    await dono.pagina.fill('.lnux-dialogo input[aria-label="Nome do remetente"]', "Servidor da Praça");
    await dono.pagina.click("#contas-testar-email");
    await dono.pagina.waitForSelector('.lnux-dialogo input[aria-label="Mandar o teste para"]');
    await dono.pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Mandar")');
    const teste = await esperarEmail(1);
    ok(teste && teste.para === "dono@exemplo.com" && /Servidor da Praça/.test(teste.de), "o e-mail de teste chega (pelo e-mail que o dono configurou)");
    await dono.pagina.click('.lnux-dialogo footer button:text-is("Salvar")');
    await dono.pagina.waitForFunction(() => !document.querySelector('.lnux-dialogo input[aria-label="Servidor SMTP"]'), null, { timeout: 10000 });

    // ── a Ana cria a conta pela lista de salas ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await ana.pagina.waitForSelector(".salas #conta-abrir-criar", { timeout: 30000 });
    await ana.pagina.click("#conta-abrir-criar");
    await ana.pagina.waitForSelector("#conta-criar");
    await ana.pagina.fill('.janela-conta input[aria-label="Nome"]', "Ana Clara");
    await ana.pagina.fill('.janela-conta input[aria-label="Idade"]', "20");
    await ana.pagina.fill('.janela-conta input[aria-label="E-mail"]', "ana@exemplo.com");
    await ana.pagina.fill('.janela-conta input[aria-label="Senha"]', "segredo123");
    await ana.pagina.fill('.janela-conta input[aria-label="Repita a senha"]', "segredo124");
    await ana.pagina.click("#conta-criar");
    await ana.pagina.waitForSelector('.conta-msg.erro:has-text("não são iguais")');
    await ana.pagina.fill('.janela-conta input[aria-label="Repita a senha"]', "segredo123");
    await ana.pagina.click("#conta-criar");
    await ana.pagina.waitForSelector('.conta-msg.erro:has-text("Marque que concorda")');
    ok(true, "criar conta confere as senhas iguais e pede que a pessoa concorde em guardar os dados no servidor");
    await ana.pagina.check('.janela-conta input[aria-label="Concordo em guardar os dados"]');
    await ana.pagina.click("#conta-criar");
    await ana.pagina.waitForSelector("#conta-confirmar", { timeout: 30000 });
    const codigo = await esperarEmail(2);
    ok(codigo && codigo.para === "ana@exemplo.com" && /^\d{6}$/.test(codigoDe(codigo)) && /15 minutos/.test(codigo.texto), `o código de 6 dígitos chega por e-mail para a Ana ("${codigo && codigo.assunto}")`);
    ok(await ana.ev(() => /an\*\*\*@exemplo\.com/.test(document.querySelector(".janela-conta").textContent) && [...document.querySelectorAll(".janela-conta .conta-acoes button")].find((b) => /Mandar outro/.test(b.textContent)).disabled),
      "a tela do código mostra o e-mail escondido (an***@exemplo.com) e o \"Mandar outro código\" espera 1 minuto");
    await ana.pagina.fill(".codigo-conta", codigoDe(codigo) === "000000" ? "111111" : "000000");
    await ana.pagina.click("#conta-confirmar");
    await ana.pagina.waitForSelector('.conta-msg.erro:has-text("Código errado")');
    await ana.pagina.fill(".codigo-conta", codigoDe(codigo));
    await ana.pagina.click("#conta-confirmar");
    await ana.pagina.waitForSelector(".salas #conta-perfil", { timeout: 30000 });
    const comConta = await ana.ev(() => ({ nome: document.querySelector('.salas input[aria-label="Seu nome"]').value, so: document.querySelector('.salas input[aria-label="Seu nome"]').readOnly,
      barra: document.querySelector(".salas-conta").textContent, sessao: !!localStorage.getItem("companhia.conta.sessao") }));
    ok(comConta.nome === "Ana Clara" && comConta.so && /Ana Clara/.test(comConta.barra) && comConta.sessao, "com o código certo, a conta é criada e a Ana já entra: o nome dela vem da conta");

    // ── o perfil: foto, bio, pronomes, link, cor ──
    await ana.pagina.click("#conta-perfil");
    await ana.pagina.waitForSelector("#perfil-foto");
    const [escolha] = await Promise.all([ana.pagina.waitForEvent("filechooser"), ana.pagina.click("#perfil-foto")]);
    await escolha.setFiles(foto);
    await ana.pagina.waitForSelector(".janela-perfil .foto-conta img", { timeout: 30000 });
    await ana.pagina.fill('.janela-perfil textarea[aria-label="Bio"]', "Gosto de dançar e de jogar com os amigos.");
    await ana.pagina.fill('.janela-perfil input[aria-label="Pronomes"]', "ela/dela");
    await ana.pagina.fill('.janela-perfil input[aria-label="Cidade"]', "Recife");
    await ana.pagina.fill('.janela-perfil input[aria-label="Link 1"]', "https://exemplo.com/ana");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Salvar")');
    await ana.pagina.waitForSelector('.lnux-aviso:has-text("Perfil salvo")');
    const salvo = await ana.ev(async () => { const eu = (await (await fetch("/api/contas/eu", { headers: { "X-Conta-Sessao": localStorage.getItem("companhia.conta.sessao") } })).json());
      const img = await (await fetch(`/api/contas/midia/${eu.id}/foto`)).blob(); const bmp = await createImageBitmap(img); return { ...eu, foto: [bmp.width, bmp.height, img.type] }; });
    ok(salvo.bio === "Gosto de dançar e de jogar com os amigos." && salvo.pronomes === "ela/dela" && salvo.local === "Recife" && salvo.links[0] === "https://exemplo.com/ana" &&
      salvo.foto[0] === 512 && salvo.foto[1] === 512 && /webp|jpeg/.test(salvo.foto[2]), `o perfil fica guardado no servidor, com a foto recortada em quadrado (${salvo.foto.join(" × ")})`);

    // ── a Ana cria uma sala; o dono entra e vê o perfil dela ──
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    ok(await ana.ev(() => document.querySelector('.lnux-dialogo input[aria-label="Nome da sala"]').value === "Sala de Ana Clara"), "a sala sugere o nome da conta");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    const codigoSala = await ana.ev(() => window.Companhia.sala.codigo);
    await dono.ev(() => { window.Companhia.janelaSala(); }); // (sem esperar a lista fechar)
    await dono.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigoSala}"]`, { timeout: 30000 });
    ok(await dono.ev((c) => /por Ana Clara/.test(document.querySelector(`.cartao-sala[data-codigo="${c}"]`).textContent), codigoSala), "na lista, a sala aparece como criada pela conta (\"por Ana Clara\")");
    await dono.pagina.fill('.salas input[aria-label="Seu nome"]', "Dono");
    await dono.pagina.click(`.cartao-sala[data-codigo="${codigoSala}"] .entrar`);
    await dono.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    await dono.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].conta, null, { timeout: 20000 });
    await dono.pagina.click('.lnux-menubar > button:text-is("Sala")');
    await dono.pagina.click('.lnux-menu button:has(.rotulo:text-is("Pessoas na sala"))');
    await dono.pagina.waitForSelector(".pessoas-sala .pessoa-sala.com-conta");
    await dono.pagina.click(".pessoas-sala .pessoa-sala.com-conta");
    await dono.pagina.waitForSelector('.perfil-pagina .perfil-nome:text-is("Ana Clara")', { timeout: 20000 });
    await dono.pagina.waitForTimeout(500);
    const perfil = await dono.ev(() => { const c = document.querySelector(".perfil-pagina"); const img = c.querySelector(".perfil-foto-grande .foto-conta img, .perfil-foto-grande img"); return { texto: c.textContent, foto: !!(img && img.naturalWidth === 512), link: c.querySelector(".perfil-links a").getAttribute("rel"), faixa: !!document.querySelector(".webc-na-sala:not([hidden]) #webc-voltar-sala") }; });
    ok(/Ana Clara/.test(perfil.texto) && /ela\/dela/.test(perfil.texto) && /Gosto de dançar/.test(perfil.texto) && /Recife/.test(perfil.texto) && perfil.foto && /noopener/.test(perfil.link) && !/ana@exemplo/.test(perfil.texto),
      "o dono clica na Ana em Pessoas na sala e abre a página de perfil dela (foto, nome, pronomes, bio, cidade e link; sem o e-mail)");
    ok(perfil.faixa, "fora do jogo, uma faixa lembra a sala e tem \"Voltar à sala\"");
    await dono.pagina.screenshot({ path: path.join(PASTA, "companhia-contas-perfil.png") });
    await dono.pagina.click("#webc-voltar-sala");
    await dono.pagina.waitForFunction(() => !C.webc.visivel, null, { timeout: 10000 });
    await dono.pagina.waitForFunction(() => !document.querySelector(".lnux-fundo-modal"), null, { timeout: 10000 });

    // ── sair, entrar de novo e "esqueci a senha" ──
    await ana.ev(() => window.Companhia.sala.fechar()); // quem criou fecha a sala (para os outros testes começarem sem ela)
    await ana.ev(() => C.contas.sair());
    await ana.ev(() => { window.Companhia.janelaSala(); });
    await ana.pagina.waitForSelector(".salas #conta-abrir-entrar");
    await ana.pagina.click("#conta-abrir-entrar");
    await ana.pagina.fill('.janela-conta input[aria-label="E-mail"]', "ana@exemplo.com");
    await ana.pagina.fill('.janela-conta input[aria-label="Senha"]', "errada999");
    await ana.pagina.click("#conta-entrar");
    await ana.pagina.waitForSelector('.conta-msg.erro:has-text("E-mail ou senha errados")');
    await ana.pagina.click('.janela-conta button:text-is("Esqueci a senha")');
    await ana.pagina.click('.janela-conta button:text-is("Mandar o código")');
    await ana.pagina.waitForSelector('.janela-conta input[aria-label="Senha nova"]');
    const recuperar = await esperarEmail(3);
    await ana.pagina.fill(".codigo-conta", codigoDe(recuperar));
    await ana.pagina.fill('.janela-conta input[aria-label="Senha nova"]', "senhanova456");
    await ana.pagina.click('.janela-conta button:text-is("Trocar a senha e entrar")');
    await ana.pagina.waitForSelector(".salas #conta-perfil", { timeout: 30000 });
    ok(/senha nova/.test(recuperar.texto), "\"Esqueci a senha\": o código chega por e-mail, a senha nova vale e a Ana entra");
    await ana.ev(() => C.contas.sair());
    await ana.pagina.click("#conta-abrir-entrar");
    await ana.pagina.fill('.janela-conta input[aria-label="E-mail"]', "ana@exemplo.com");
    await ana.pagina.fill('.janela-conta input[aria-label="Senha"]', "senhanova456");
    await ana.pagina.click("#conta-entrar");
    await ana.pagina.waitForSelector(".salas #conta-perfil", { timeout: 30000 });
    ok(true, "sair e entrar de novo com o e-mail e a senha");

    // ── a tela de entrar: quem já entrou neste navegador vai direto ao início do site; os outros entram pelo cartão ──
    await ana.pagina.goto("about:blank"); // só trocar o # do endereço não recarrega a página
    await ana.pagina.goto(`${BASE}/apps/companhia/`);
    await ana.pagina.waitForSelector('.webc-cartao[data-ir="perfil"]', { timeout: 30000 });
    ok(await ana.ev(() => !document.querySelector(".tela-inicio") && window.Companhia.modo === "jogar" && /Ana Clara/.test(document.querySelector("#webc-eu").textContent) && !!document.querySelector("#webc-eu .foto-conta img, #webc-eu img")),
      "quem já entrou neste navegador vai direto ao início do site, com o nome e a foto da conta no alto");
    // o perfil, como página: a capa, a foto, a bio e as seções
    await ana.pagina.click('.webc-cartao[data-ir="perfil"]');
    await ana.pagina.waitForSelector(".perfil-pagina .perfil-salvos > *", { timeout: 20000 });
    await ana.pagina.waitForFunction(() => { const i = document.querySelector(".perfil-pagina .perfil-foto-grande img"); return i && i.complete; }, null, { timeout: 10000 }).catch(() => {});
    ok(await ana.ev(() => { const p = document.querySelector(".perfil-pagina"); return !!p.querySelector(".perfil-banner") && !!p.querySelector(".perfil-foto-grande img") && /Gosto de dançar/.test(p.textContent) && /Salvos/.test(p.textContent) && /Amigos/.test(p.textContent) && !!p.querySelector("#perfil-editar"); }),
      "a página Perfil: a capa (o banner), a foto redonda, a bio e embaixo os salvos e os amigos; \"Editar perfil\" para quem é dono");
    await ana.pagina.click("#webc-eu");
    await ana.pagina.click('.webc-menu [data-acao="sair"]');
    await ana.pagina.waitForFunction(() => !C.contas.eu, null, { timeout: 10000 });
    await ana.pagina.reload();
    await ana.pagina.waitForSelector('.tela-inicio input[aria-label="E-mail"]', { timeout: 30000 });
    await ana.pagina.fill('.tela-inicio input[aria-label="E-mail"]', "ana@exemplo.com");
    await ana.pagina.fill('.tela-inicio input[aria-label="Senha"]', "errada999");
    await ana.pagina.click(".tela-inicio #conta-entrar");
    await ana.pagina.waitForSelector('.tela-inicio .conta-msg.erro:has-text("E-mail ou senha errados")');
    await ana.pagina.fill('.tela-inicio input[aria-label="Senha"]', "senhanova456");
    await ana.pagina.press('.tela-inicio input[aria-label="Senha"]', "Enter");
    await ana.pagina.waitForSelector('.webc-cartao[data-ir="sala"]', { timeout: 30000 });
    await ana.pagina.waitForFunction(() => !document.querySelector(".tela-inicio"), null, { timeout: 5000 }).catch(() => {}); // some com um esmaecer
    ok(await ana.ev(() => window.Companhia.modo === "jogar" && !document.querySelector(".tela-inicio") && C.contas.eu && C.contas.eu.nome === "Ana Clara"),
      "saindo pelo menu da conta e entrando pela tela de entrar: a senha errada avisa no próprio cartão; a certa (Enter) entra e vai ao início do site, já com a conta");

    // ── o dono exige conta: quem não entrou precisa entrar antes ──
    await dono.ev(() => C.contas.salvarAjustes({ exigir_conta: true }));
    await ana.ev(() => C.contas.sair());
    await ana.pagina.reload();
    await ana.pagina.waitForSelector(".tela-inicio .inicio-nota", { timeout: 30000 });
    ok(await ana.ev(() => !document.querySelector("#inicio-sem-conta") && /pede uma conta/.test(document.querySelector(".inicio-nota").textContent)),
      "com \"só entra quem tem conta\", a tela de início não oferece jogar sem conta");
    await ana.pagina.goto("about:blank");
    await ana.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=sala`);
    await ana.pagina.waitForSelector(".salas .salas-pede-conta:not([hidden])", { timeout: 30000 });
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector("#conta-entrar", { timeout: 10000 });
    ok(true, "com \"só entra quem tem conta\", a lista avisa e criar sala pede para entrar na conta antes");
    await dono.ev(() => C.contas.salvarAjustes({ exigir_conta: false }));
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    if (consola.length) console.log("  console: " + consola.slice(0, 5).join(" | "));
    try { await ana.pagina.screenshot({ path: path.join(PASTA, "companhia-contas-erro-ana.png") }); await dono.pagina.screenshot({ path: path.join(PASTA, "companhia-contas-erro-dono.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    smtp.srv.close();
    await navegador.close();
  }
  console.log(`\nCompanhia (contas): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
