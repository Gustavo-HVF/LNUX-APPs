// Teste das salas da Companhia (jogar com outras pessoas), com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_sala
//
// Não baixa nada. Dois navegadores separados, como duas pessoas: a "Ana" abre pelo LNUX (com a chave da ponte) e
// cria a sala com um cenário; a "Bia" chega só pelo endereço (sem a chave). Cobre: a pergunta ao abrir (conversar
// com o chat bot ou jogar com outras pessoas), o modo de jogar sem nenhuma opção de IA, a lista de salas, criar a
// sala com as opções (pública, senha, quantas pessoas, bate-papo, cenário com prévia), a Bia achando a sala na
// lista e entrando com a senha, o cenário e o avatar chegando para a outra pessoa, as posições de quem anda, o
// bate-papo com balão, o aceno, as opções mudadas depois (sala privada some da lista), entrar pelo link, sair e
// fechar a sala — e que o link da sala não dá acesso à ponte.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { mapaDeTeste } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const consola = [];
  const pessoa = async (nome) => {
    const contexto = await navegador.newContext({ viewport: { width: 1100, height: 760 } });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a), menus: () => pagina.locator(".lnux-menubar > button").allTextContents() };
  };
  const ana = await pessoa("Ana"), bia = await pessoa("Bia");
  try {
    // ── a pergunta ao abrir ──
    await ana.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}`);
    await ana.pagina.waitForSelector(".cartao-modo");
    const cartoes = await ana.pagina.locator(".cartao-modo b").allTextContents();
    ok(cartoes.join("|") === "Conversar com a personagem|Jogar com outras pessoas" && (await ana.ev(() => window.Companhia.modo)) === null,
      `ao abrir, a Companhia pergunta antes de entrar: ${cartoes.join(" / ")}`);
    await ana.pagina.click('.cartao-modo[data-modo="conversa"]');
    await ana.pagina.waitForFunction(() => window.Companhia.live2d !== undefined, null, { timeout: 20000 });
    let m = await ana.menus();
    ok(["Conversa", "IA", "Voz"].every((x) => m.includes(x)) && !m.includes("Sala") && (await ana.ev(() => window.Companhia.modo === "conversa" && document.documentElement.dataset.modo === "conversa" && document.querySelector("#chip-sala").hidden)),
      "escolhendo conversar: o chat bot de sempre (menus Conversa, IA e Voz; sem o menu Sala)");
    await ana.pagina.click('.lnux-menubar > button:text-is("Ajuda")');
    await ana.pagina.click('.lnux-menu button:has(.rotulo:text-is("Trocar de modo (jogar com outras pessoas)..."))');
    await ana.pagina.waitForSelector(".cartao-modo");
    ok(true, "Ajuda › Trocar de modo pergunta de novo");

    // ── jogar: sem as funções de IA; abre a lista de salas ──
    await ana.pagina.click('.cartao-modo[data-modo="jogar"]');
    await ana.pagina.waitForSelector(".salas #sala-criar");
    m = await ana.menus();
    const semIA = await ana.ev(() => {
      const some = (s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === "none"; };
      return { modo: window.Companhia.modo, selo: some("#selo-ia"), gasto: some("#gasto"), mic: some("#botao-mic"), rodape: some(".conversa-rodape"), afeto: some("#chip-afeto"), nucleo: some("#nucleo-aviso"), chip: !document.querySelector("#chip-sala").hidden };
    });
    ok(!m.includes("IA") && !m.includes("Conversa") && !m.includes("Voz") && m.includes("Sala") && m.includes("Movimento"), `jogar: os menus são ${m.join(", ")} (sem IA, Conversa nem Voz)`);
    ok(semIA.modo === "jogar" && semIA.selo && semIA.gasto && semIA.mic && semIA.rodape && semIA.afeto && semIA.nucleo && semIA.chip, "jogar: somem o selo da IA, os tokens, o microfone, \"Falar\", o afeto e o aviso do Live2D; aparece o botão da sala");
    await ana.pagina.waitForSelector(".salas .loja-vazio:not([hidden])");
    ok(await ana.ev(() => /Nenhuma sala pública aberta/.test(document.querySelector(".salas .loja-vazio").textContent) && !document.querySelector(".salas .loja-dono").hidden),
      "jogar: abre a lista de salas deste servidor (vazia), com \"Criar sala\"; o dono do servidor vê a opção de deixar os outros criarem");
    await ana.pagina.click('.salas button[aria-label="Fechar a lista de salas"]');
    await ana.pagina.click('.lnux-menubar > button:text-is("Personagem")');
    const itens = await ana.pagina.locator(".lnux-menu .rotulo").allTextContents();
    await ana.pagina.keyboard.press("Escape");
    ok(!itens.some((i) => /Perfil e personalidade|Voz desta personagem|Áreas de toque/.test(i)) && itens.some((i) => /Roupas/.test(i)), "jogar: o menu Personagem não tem perfil, voz nem áreas de toque (coisas do chat bot)");

    // ── a Ana cria a sala, com as opções e um cenário ──
    await ana.ev(async (b64) => { await C.mapas.guardar("Praça", new Map([["praca.glb", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]]), "praca.glb"); window.Companhia.janelaSala(); }, mapaDeTeste().toString("base64"));
    await ana.pagina.waitForSelector(".salas #sala-criar");
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-aviso:has-text("Diga o seu nome")');
    await ana.pagina.fill('.salas input[aria-label="Seu nome"]', "Ana");
    await ana.pagina.click("#sala-criar");
    await ana.pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    ok(await ana.ev(() => document.querySelector('.lnux-dialogo input[aria-label="Nome da sala"]').value === "Sala de Ana" && document.querySelector('.form-sala [data-publica="true"]').classList.contains("ativa")),
      "criar uma sala: as opções (nome, descrição, pública ou privada, senha, pessoas, bate-papo e o cenário)");
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Nome da sala"]', "Praça da Ana");
    await ana.pagina.fill('.lnux-dialogo textarea[aria-label="Descrição da sala"]', "Venha passear na praça.");
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Senha da sala"]', "1234");
    await ana.pagina.fill('.lnux-dialogo input[aria-label="Quantas pessoas cabem"]', "4");
    await ana.pagina.selectOption('.lnux-dialogo select[aria-label="Cenário da sala"]', { label: "Praça" });
    await ana.pagina.waitForSelector(".vitrine-cenario[data-pronta]", { timeout: 60000 });
    ok(true, "o cenário escolhido aparece em 3D antes de criar");
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await ana.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro, null, { timeout: 90000 });
    await ana.pagina.waitForSelector(".link-sala input");
    const link = await ana.pagina.inputValue(".link-sala input");
    const codigo = (link.match(/#sala=([a-z0-9]+)$/) || [])[1];
    const naSala = await ana.ev(() => { const p = window.Companhia.palco, s = window.Companhia.sala; return { andando: p.mundo.andando, mapa: !!p.mundo.colisor, y: p.raiz.position.y, pessoas: s.pessoas, dono: !!s.chave, avatar: window.Companhia.atual.perfil.nome, chip: document.querySelector("#chip-sala").textContent, hash: location.hash }; });
    ok(!!codigo && codigo.length === 8 && naSala.hash === "#sala=" + codigo, `a sala é criada e o link aparece para copiar (…#sala=${codigo})`);
    const opcoes = await ana.ev(() => { const i = window.Companhia.sala.info; return { senha: i.senha, max: i.max, publica: i.publica, descricao: i.descricao, criador: i.criador, miniatura: i.miniatura }; });
    ok(opcoes.senha && opcoes.max === 4 && opcoes.publica && opcoes.descricao === "Venha passear na praça." && opcoes.criador === "Ana",
      "a sala nasce com as opções escolhidas (pública, com senha, para 4 pessoas, com a descrição e quem criou)");
    ok(naSala.andando && naSala.mapa && Math.abs(naSala.y - 1) < 0.05 && naSala.pessoas === 1 && naSala.dono && /Praça da Ana · 1 pessoa/.test(naSala.chip), `a Ana entra andando no cenário da sala, com o boneco padrão (${naSala.avatar}); o botão mostra "${naSala.chip}"`);
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Fechar")');

    // ── a Bia chega pelo endereço (sem a chave da ponte) e acha a sala na lista ──
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar`);
    await bia.pagina.waitForSelector(`.salas .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    const naLista = await bia.ev((c) => { const k = document.querySelector(`.cartao-sala[data-codigo="${c}"]`); return { texto: k.textContent, cadeado: !!k.querySelector(".selo-cadeado"), img: !!k.querySelector(".capa img"),
      criar: !!document.querySelector("#sala-criar") && !document.querySelector("#sala-criar").hidden, ponte: LNUX.ponte.disponivel, dono: !document.querySelector(".salas .loja-dono").hidden }; }, codigo);
    ok(/Praça da Ana/.test(naLista.texto) && /Venha passear/.test(naLista.texto) && /1\/4/.test(naLista.texto) && /por Ana/.test(naLista.texto) && naLista.cadeado && naLista.img,
      "a Bia vê a sala na lista: nome, descrição, quem criou, 1/4 pessoas, o cadeado da senha e a miniatura do cenário");
    ok(naLista.criar && !naLista.ponte && !naLista.dono, "mesmo sem a ponte, quem chega pode criar a sua sala (o dono deixou); só não vê a opção do dono");
    await bia.pagina.fill('.salas input[aria-label="Seu nome"]', "Bia");
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForSelector('.lnux-dialogo input[aria-label="Senha"]', { timeout: 30000 });
    await bia.pagina.fill('.lnux-dialogo input[aria-label="Senha"]', "errada");
    await bia.pagina.click('.lnux-dialogo footer button:text-is("Entrar")');
    await bia.pagina.waitForSelector('.lnux-dialogo:has-text("Senha errada")', { timeout: 30000 });
    ok(await bia.ev(() => !window.Companhia.sala || !window.Companhia.sala.dentro), "a senha errada não entra (pede de novo)");
    await bia.pagina.fill('.lnux-dialogo input[aria-label="Senha"]', "1234");
    await bia.pagina.click('.lnux-dialogo footer button:text-is("Entrar")');
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 90000 });
    ok(await bia.ev(() => !document.querySelector(".salas") && location.hash.startsWith("#sala=")), "com a senha certa, a Bia entra e a lista de salas fecha");
    const bianaSala = await bia.ev(() => { const p = window.Companhia.palco, s = window.Companhia.sala, r = [...s.remotos.values()][0]; let tri = 0; p.mundo.mapa.traverse((o) => { if (o.isMesh) tri += o.geometry.index.count / 3; });
      return { mapa: p.mundo.info.nome, tri, y: p.raiz.position.y, remoto: r.nome, pessoas: s.pessoas, dono: !!s.chave, titulo: document.querySelector("#conversa-titulo").textContent }; });
    ok(bianaSala.mapa === "Praça" && bianaSala.tri === 36 && Math.abs(bianaSala.y - 1) < 0.05, `a Bia recebe o cenário da sala ("${bianaSala.mapa}", ${bianaSala.tri} triângulos) e pisa no piso`);
    ok(bianaSala.remoto === "Ana" && bianaSala.pessoas === 2 && !bianaSala.dono && bianaSala.titulo === "Sala: Praça da Ana", "a Bia vê a Ana na sala (2 pessoas)");
    await ana.pagina.waitForFunction(() => window.Companhia.sala.remotos.size === 1, null, { timeout: 20000 });
    ok(await ana.ev(() => [...window.Companhia.sala.remotos.values()][0].nome === "Bia" && /Bia entrou/.test(document.querySelector("#mensagens").textContent) && /2 pessoas/.test(document.querySelector("#chip-sala").textContent)), "a Ana vê a Bia chegar (\"Bia entrou.\", 2 pessoas)");
    // os avatares chegam: cada uma vê o boneco (VRM) da outra
    await ana.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].avatar, null, { timeout: 60000 });
    await bia.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].avatar, null, { timeout: 60000 });
    ok(await bia.ev(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return !!r.avatar.vrm && !r.boneco.visible && r.altura > 1.3; }), "o avatar (.vrm) de cada uma chega para a outra pelo servidor da sala");

    // ── andar: a outra pessoa vê ──
    const antes = await bia.ev(() => [...window.Companhia.sala.remotos.values()][0].grupo.position.toArray());
    await ana.pagina.mouse.click(250, 420);
    await ana.pagina.keyboard.down("KeyW");
    await bia.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].estado === "andando", null, { timeout: 20000 });
    await ana.pagina.waitForTimeout(2500);
    await ana.pagina.keyboard.up("KeyW");
    await ana.pagina.waitForFunction(() => window.Companhia.palco.mundo.estado === "parado", null, { timeout: 20000 });
    const fim = await ana.ev(() => window.Companhia.palco.raiz.position.toArray());
    await bia.pagina.waitForFunction((f) => { const r = [...window.Companhia.sala.remotos.values()][0], p = r.grupo.position; return r.estado === "parado" && Math.hypot(p.x - f[0], p.y - f[1], p.z - f[2]) < 0.3; }, fim, { timeout: 30000 }).catch(() => {});
    const pos = await Promise.all([ana.ev(() => window.Companhia.palco.raiz.position.toArray()), bia.ev(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return { p: r.grupo.position.toArray(), estado: r.estado }; })]);
    const dist = Math.hypot(...pos[0].map((v, i) => v - pos[1].p[i]));
    ok(pos[1].p[2] > antes[2] + 0.5 && dist < 0.4 && pos[1].estado === "parado", `a Ana anda (W) e a Bia vê a personagem dela andar e parar no mesmo lugar (diferença de ${dist.toFixed(2)} m)`);

    // ── bate-papo e gestos ──
    await bia.pagina.fill("#texto", "oi, Ana! <b>tudo bem?</b>");
    await bia.pagina.press("#texto", "Enter");
    await ana.pagina.waitForFunction(() => /oi, Ana!/.test(document.querySelector("#mensagens").textContent), null, { timeout: 20000 });
    await bia.pagina.waitForFunction(() => /oi, Ana!/.test(document.querySelector("#mensagens").textContent), null, { timeout: 20000 });
    const papo = await Promise.all([ana.ev(() => { const msg = [...document.querySelectorAll("#mensagens .msg.ela")].pop(), r = [...window.Companhia.sala.remotos.values()][0]; return { texto: msg.textContent, html: msg.querySelector(".t").innerHTML, balao: !!r.balao }; }),
      bia.ev(() => { const msg = [...document.querySelectorAll("#mensagens .msg.eu")].pop(); return { meu: !!msg && /oi, Ana!/.test(msg.textContent), campo: document.querySelector("#texto").value, ia: window.Companhia.ia.gasto.pedidos + window.Companhia.ia.gasto.locais }; })]);
    ok(/^Bia: oi, Ana!/.test(papo[0].texto) && papo[0].balao && papo[1].meu && papo[1].campo === "", "o que a Bia escreve chega para a Ana com o nome dela e um balão em cima da personagem");
    ok(/&lt;b&gt;/.test(papo[0].html) && papo[1].ia === 0 && (await bia.ev(() => document.querySelectorAll("#mensagens .msg.ela").length)) === 0, "a mensagem é só texto (nada de HTML) e nenhum chat bot responde: quem fala são as pessoas");
    await ana.pagina.click('#gestos button[aria-label="Acenar"]');
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return r.acenar > 0; }, null, { timeout: 15000 });
    await ana.pagina.click('#gestos button[aria-label="Feliz"]');
    await bia.pagina.waitForFunction(() => [...window.Companhia.sala.remotos.values()][0].emocao === "feliz", null, { timeout: 15000 });
    ok(true, "o aceno e a expressão (feliz) da Ana aparecem para a Bia");

    // ── a aparência vai junto: tamanho, proporções, braços, peças escondidas e texturas trocadas ──
    const antesDoAjuste = await bia.ev(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return { escala: r.avatar.vrm.scene.scale.x, altura: r.altura }; });
    await ana.ev(async () => {
      const p = window.Companhia.palco, a = window.Companhia.atual;
      p.definirAjuste({ bracos: 30, escala: { geral: 1.5, pernas: 1.2, cabeca: 1.3 }, ossos: { head: [0, 0, 20] } });
      p.mostrarPeca("Roupa_CLOTH", false);
      // uma textura trocada (como em Personagem › Roupas): 8×8 vermelha
      const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d"); g.fillStyle = "#e33"; g.fillRect(0, 0, 8, 8);
      const png = await new Promise((ok) => c.toBlob(ok, "image/png"));
      const r = a.roupas.find((x) => x.id === a.roupaAtual) || a.roupas[0];
      r.texturas = { ...(r.texturas || {}), Calca_CLOTH: png };
      await p.trocarTextura("Calca_CLOTH", png);
    });
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0]; if (!(r.avatar && Math.abs(r.avatar.vrm.scene.scale.x - 1.5) < 0.01 && r.aparencia && r.aparencia.ocultas.includes("Roupa_CLOTH"))) return false;
      const calca = r.avatar.pecas.find((x) => x.nome === "Calca_CLOTH").materiais[0].map; return !!(calca && calca.image && calca.image.width === 8); }, null, { timeout: 30000 }).catch(() => {});
    await bia.pagina.waitForTimeout(500);
    const visto = await bia.ev(() => {
      const r = [...window.Companhia.sala.remotos.values()][0], av = r.avatar, peca = (n) => av.pecas.find((x) => x.nome === n);
      const cabeca = av.vrm.humanoid.getRawBoneNode("head").scale.x / av.brutos.head.x, perna = av.vrm.humanoid.getRawBoneNode("leftUpperLeg").scale.x / av.brutos.leftUpperLeg.x;
      const calca = peca("Calca_CLOTH").materiais[0].map;
      const giro = av.ajusteQ.get("head"), mao = av.vrm.humanoid.getRawBoneNode("leftHand").getWorldPosition(new THREE.Vector3()), ombro = av.vrm.humanoid.getRawBoneNode("leftUpperArm").getWorldPosition(new THREE.Vector3());
      return { cabeca, perna, erguer: av.erguer, altura: r.altura, roupa: peca("Roupa_CLOTH").materiais.every((m) => !m.visible), calca: !!(calca && calca.image && calca.image.width === 8), giro: !!giro, braco: ombro.y - mao.y };
    });
    ok(Math.abs(visto.cabeca - 1.3) < 0.01 && Math.abs(visto.perna - 1.2) < 0.01 && visto.erguer > 0.05 && visto.altura > antesDoAjuste.altura * 1.4,
      `o tamanho (1,5×) e as proporções da Ana (cabeça 1,3×, pernas 1,2×, o quadril sobe) aparecem igual para a Bia (altura ${antesDoAjuste.altura.toFixed(2)} → ${visto.altura.toFixed(2)} m)`);
    ok(visto.roupa && visto.calca && visto.giro, "a peça que a Ana escondeu some, a textura que ela trocou aparece e a correção do osso da cabeça vale também para a Bia" + (visto.roupa && visto.calca && visto.giro ? "" : ` (${JSON.stringify(visto)})`));
    ok(visto.braco > 0.2 && visto.braco < 0.75, `os braços em descanso no ângulo que a Ana escolheu (mão ${visto.braco.toFixed(2)} m abaixo do ombro)`);
    await ana.ev(() => { const p = window.Companhia.palco; p.definirAjuste(null); p.mostrarPeca("Roupa_CLOTH", true); });
    await bia.pagina.waitForFunction(() => { const r = [...window.Companhia.sala.remotos.values()][0]; return Math.abs(r.avatar.vrm.scene.scale.x - 1) < 0.01 && !r.aparencia.ocultas.length; }, null, { timeout: 30000 });
    ok(true, "e quando a Ana volta ao normal, a Bia vê voltar também");
    await ana.pagina.screenshot({ path: path.join(PASTA, "companhia-sala-ana.png") });
    await bia.pagina.screenshot({ path: path.join(PASTA, "companhia-sala-bia.png") });

    // ── o link só dá acesso à sala ──
    const acesso = await bia.ev(async (c) => ({ pastas: (await fetch("/api/pastas?caminho=~")).status, estado: (await fetch("/api/estado")).status, fechar: (await fetch("/api/sala/" + c, { method: "DELETE" })).status, mapa: (await fetch("/api/sala/" + c + "/mapa", { method: "PUT", body: "x" })).status }), codigo);
    ok(acesso.pastas === 401 && acesso.estado === 401 && acesso.fechar === 403 && acesso.mapa === 403, "com o link, a Bia não lê as pastas do aparelho, não troca o cenário nem fecha a sala da Ana");

    // ── a Ana muda as opções: privada, sem senha e sem bate-papo ──
    await ana.pagina.click('.lnux-menubar > button:text-is("Sala")');
    await ana.pagina.click('.lnux-menu button:has(.rotulo:text-is("Opções da sala (pública, senha, pessoas, bate-papo)..."))');
    await ana.pagina.waitForSelector('.form-sala [data-publica="false"]');
    await ana.pagina.click('.form-sala [data-publica="false"]');
    await ana.pagina.check('.form-sala input[aria-label="Tirar a senha"]');
    await ana.pagina.uncheck('.form-sala input[aria-label="Bate-papo por texto"]');
    await ana.pagina.click('.lnux-dialogo footer button:text-is("Salvar")');
    await bia.pagina.waitForFunction(() => document.querySelector("#texto").disabled, null, { timeout: 20000 });
    const privada = await bia.ev(async (c) => ({ lista: (await (await fetch("/api/salas")).json()).salas.map((s) => s.codigo), falar: (await fetch("/api/sala/" + c + "/falar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: window.Companhia.sala.eu.id, segredo: window.Companhia.sala.eu.segredo, texto: "oi" }) })).status }), codigo);
    ok(!privada.lista.includes(codigo) && privada.falar === 403 && (await ana.ev(() => !window.Companhia.sala.info.senha)),
      "a Ana deixa a sala privada (some da lista), tira a senha e desliga o bate-papo (a caixa de texto da Bia trava)");

    // ── sair e fechar ──
    await bia.pagina.click('.lnux-menubar > button:text-is("Sala")');
    await bia.pagina.click('.lnux-menu button:has(.rotulo:text-is("Sair da sala"))');
    await ana.pagina.waitForFunction(() => window.Companhia.sala.remotos.size === 0 && /Bia saiu/.test(document.querySelector("#mensagens").textContent), null, { timeout: 20000 });
    ok(await bia.ev(() => !window.Companhia.sala.dentro && location.hash === "#modo=jogar"), "a Bia sai da sala e a Ana é avisada (\"Bia saiu.\")");
    // pelo link (a sala agora é privada): ela aparece em destaque em cima da lista
    await bia.ev((c) => { window.Companhia.janelaSala(c); }, codigo); // (sem esperar a lista fechar)
    await bia.pagina.waitForSelector(`.salas-convite .cartao-sala[data-codigo="${codigo}"]`, { timeout: 30000 });
    ok(await bia.ev((c) => !document.querySelector(`#salas-lista .cartao-sala[data-codigo="${c}"]`), codigo), "pelo link, a sala privada aparece em destaque (\"A sala do seu link\"), fora da lista pública");
    await bia.pagina.click(`.salas-convite .cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala.dentro && window.Companhia.sala.remotos.size === 1, null, { timeout: 60000 });
    await ana.pagina.click('.lnux-menubar > button:text-is("Sala")');
    await ana.pagina.click('.lnux-menu button:has(.rotulo:text-is("Fechar a sala para todos"))');
    await bia.pagina.waitForFunction(() => !window.Companhia.sala.dentro && /A sala foi fechada/.test(document.querySelector("#mensagens").textContent), null, { timeout: 30000 });
    ok((await bia.ev(async (c) => (await fetch("/api/sala/" + c)).status, codigo)) === 404, "a Ana fecha a sala: a Bia é avisada e o link deixa de valer");
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
    try { await ana.pagina.screenshot({ path: path.join(PASTA, "companhia-sala-erro-ana.png") }); await bia.pagina.screenshot({ path: path.join(PASTA, "companhia-sala-erro-bia.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (salas): ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
