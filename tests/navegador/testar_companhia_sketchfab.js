// Teste do Sketchfab na loja do WEBC e dos mapas com animação, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_sketchfab
//
// Não fala com o Sketchfab de verdade: o teste sobe um Sketchfab de mentira (busca, detalhes, download e miniatura) na
// porta que o testar_navegador.py passou ao servidor (LNUX_SKETCHFAB_API). Cobre: só o dono vê o botão Sketchfab; a
// chave guardada no servidor; buscar; a licença que não deixa redistribuir fica bloqueada; trazer um mapa animado para a
// loja (com o crédito, a licença e os # do Sketchfab); usar esse mapa numa sala: as animações tocam, a peça que se mexe
// sai da colisão, e quem entra na sala vê a animação no mesmo ponto (o relógio do servidor).
const { chromium } = require("playwright");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { mapaAnimado, png } = require("./companhia_arquivos.js");
const { nomeGuardado } = require("./companhia_menus.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const PORTA = +(process.env.LNUX_TESTE_SKETCHFAB_PORTA || 0);
const RUIDO = /Failed to load resource|voz do navegador|GPU stall/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

/** O Sketchfab de mentira. */
function sketchfabFalso() {
  const A = "a".repeat(32), B = "b".repeat(32), glb = mapaAnimado(), mini = png(64, 40, () => [80, 140, 220]);
  const vistos = [];
  const modelo = (uid, nome, lic, anim) => ({ uid, name: nome, user: { displayName: "Joana", profileUrl: "https://sketchfab.example/joana" }, viewerUrl: `https://sketchfab.example/3d-models/${uid}`,
    license: { slug: lic, label: lic.toUpperCase() }, animationCount: anim, faceCount: 24, isDownloadable: true, description: "Um moinho que gira.",
    thumbnails: { images: [{ url: `http://127.0.0.1:${PORTA}/miniatura.png`, width: 640 }] }, tags: [{ name: "fnaf" }, { name: "moinho" }] });
  const modelos = { [A]: modelo(A, "Moinho animado", "by", 1), [B]: modelo(B, "Castelo comprado", "st", 0) };
  const srv = http.createServer((req, res) => {
    vistos.push([req.url, req.headers.authorization || ""]);
    const enviar = (corpo, tipo = "application/json", status = 200) => { const b = Buffer.isBuffer(corpo) ? corpo : Buffer.from(JSON.stringify(corpo)); res.writeHead(status, { "Content-Type": tipo, "Content-Length": b.length }); res.end(b); };
    const caminho = req.url.split("?")[0], partes = caminho.split("/");
    if (caminho === "/v3/search") return enviar({ results: Object.values(modelos), cursors: { next: null } });
    if (partes[2] === "models" && modelos[partes[3]]) {
      if (partes[4] === "download") {
        if (req.headers.authorization !== "Token chave-de-teste-123") return enviar({ detail: "não" }, "application/json", 401);
        return enviar({ glb: { url: `http://127.0.0.1:${PORTA}/arquivos/moinho.glb`, size: glb.length, expires: 300 } });
      }
      return enviar(modelos[partes[3]]);
    }
    if (caminho === "/arquivos/moinho.glb") return enviar(glb, "model/gltf-binary");
    if (caminho === "/miniatura.png") return enviar(mini, "image/png");
    enviar({ detail: "nada" }, "application/json", 404);
  });
  return new Promise((r) => srv.listen(PORTA, "127.0.0.1", () => r({ srv, vistos, A, B })));
}

(async () => {
  if (!PORTA) { console.log("⏭  Pulado: rode pelo testar_navegador.py (ele passa a porta do Sketchfab de mentira)."); return; }
  const falso = await sketchfabFalso();
  const navegadores = [], consola = [];
  // um navegador para cada pessoa (sem placa de vídeo, num navegador só, o desenho de uma trava o da outra)
  const pessoa = async (nome) => {
    const n = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    navegadores.push(n);
    const contexto = await n.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
    await nomeGuardado(contexto, nome);
    await contexto.addInitScript(() => { try { localStorage.setItem("companhia.luz", JSON.stringify({ realista: false, sombras: false })); } catch (e) { /* sem armazenamento */ } });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text()) && !/40[13]/.test(m.text())) consola.push(`[${nome}] ${m.text()}`); });
    pagina.on("pageerror", (e) => consola.push(`[${nome}] [pageerror] ${e.message}`));
    return { pagina, ev: (f, a) => pagina.evaluate(f, a) };
  };
  const dono = await pessoa("Dono"), bia = await pessoa("Bia");
  try {
    // ── só o dono vê o Sketchfab na loja ──
    await bia.pagina.goto(`${BASE}/apps/companhia/#modo=jogar&pagina=loja`);
    await bia.pagina.waitForSelector(".webc-loja .loja-topo", { timeout: 30000 });
    await dono.pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=jogar&pagina=loja`);
    await dono.pagina.waitForSelector(".webc-loja #loja-sketchfab:not([hidden])", { timeout: 30000 });
    ok(await bia.ev(() => document.querySelector("#loja-sketchfab").hidden), "na loja, só o dono do servidor vê o botão Sketchfab");

    // ── a chave fica no servidor ──
    await dono.pagina.click("#loja-sketchfab");
    await dono.pagina.waitForSelector(".janela-sketchfab #sketchfab-guardar-chave");
    await dono.pagina.fill('.janela-sketchfab input[aria-label="Chave da API do Sketchfab"]', "chave-de-teste-123");
    await dono.pagina.click("#sketchfab-guardar-chave");
    await dono.pagina.waitForSelector('.lnux-aviso:has-text("Chave do Sketchfab guardada")');
    ok(await dono.ev(() => !document.querySelector('.janela-sketchfab input[aria-label="Chave da API do Sketchfab"]') && !Object.keys(localStorage).some((k) => /sketchfab/i.test(k + localStorage.getItem(k)))),
      "a chave do Sketchfab vai para o servidor (nada dela fica no navegador)");

    // ── buscar; a licença diz o que pode ir para a loja ──
    await dono.pagina.fill('.janela-sketchfab input[aria-label="Procurar no Sketchfab"]', "moinho");
    await dono.pagina.press('.janela-sketchfab input[aria-label="Procurar no Sketchfab"]', "Enter");
    await dono.pagina.waitForSelector(`.sketchfab-cartao[data-uid="${falso.B}"]`, { timeout: 20000 });
    const cartoes = await dono.ev(([a, b]) => ({ a: document.querySelector(`.sketchfab-cartao[data-uid="${a}"]`).innerText, aLivre: !document.querySelector(`.sketchfab-cartao[data-uid="${a}"] button[data-uid]`).disabled,
      bLivre: !document.querySelector(`.sketchfab-cartao[data-uid="${b}"] button[data-uid]`).disabled, img: !!document.querySelector(`.sketchfab-cartao[data-uid="${a}"] img`) }), [falso.A, falso.B]);
    ok(/Moinho animado/.test(cartoes.a) && /Joana/.test(cartoes.a) && /CC BY 4.0/.test(cartoes.a) && /animado/.test(cartoes.a) && cartoes.img && cartoes.aLivre && !cartoes.bLivre,
      "a busca mostra os modelos com a miniatura, quem fez e a licença; o comprado (Standard) fica bloqueado para a loja");
    ok(falso.vistos.some(([u]) => /\/v3\/search\?.*q=moinho/.test(u)), "quem pergunta ao Sketchfab é o servidor (o navegador não fala com ele)");

    // ── trazer para a loja: o .glb, o crédito, a licença e os # ──
    await dono.pagina.fill('.janela-sketchfab input[aria-label="# para achar na loja"]', "praça");
    await dono.pagina.click(`.sketchfab-cartao[data-uid="${falso.A}"] button[data-uid]`);
    await dono.pagina.waitForSelector(".loja-detalhe:not([hidden]) .loja-credito", { timeout: 60000 });
    const detalhe = await dono.ev(() => { const d = document.querySelector(".loja-detalhe"); return { credito: d.querySelector(".loja-credito").innerText, links: [...d.querySelectorAll(".loja-credito a")].map((a) => a.href), animado: (d.querySelector(".loja-animado") || {}).textContent || "" }; });
    const itens = (await dono.ev(() => C.loja.lista())).itens, moinho = itens.find((i) => i.nome === "Moinho animado");
    ok(/Joana/.test(detalhe.credito) && /Sketchfab/.test(detalhe.credito) && /CC BY 4\.0/.test(detalhe.credito) && detalhe.links.some((l) => /creativecommons\.org\/licenses\/by\/4\.0/.test(l)),
      `o mapa entra na loja com o crédito: ${detalhe.credito.replace(/\s+/g, " ")}`);
    ok(moinho && moinho.tipo === "mundo" && moinho.animacoes === 1 && /Com 1 animação/.test(detalhe.animado) && moinho.tags.includes("praça") && moinho.tags.includes("fnaf") && moinho.miniatura > 0,
      "é um mapa da loja, com a miniatura do Sketchfab, os # (os do dono e os do Sketchfab) e o aviso de que tem animação");
    ok(falso.vistos.some(([u, a]) => u.endsWith("/download") && a === "Token chave-de-teste-123"), "o download foi pedido com a chave, pelo servidor");

    // ── usar o mapa animado numa sala ──
    await dono.ev(() => C.webc.ir("sala"));
    await dono.pagina.waitForSelector(".salas #sala-criar", { timeout: 20000 });
    await dono.pagina.click("#sala-criar");
    await dono.pagina.waitForSelector('.lnux-dialogo select[aria-label="Cenário da sala"]');
    await dono.pagina.selectOption('.lnux-dialogo select[aria-label="Cenário da sala"]', { label: "Moinho animado" });
    await dono.pagina.waitForSelector(".vitrine-cenario[data-pronta]", { timeout: 60000 });
    await dono.pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await dono.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.palco.mundo.mapa, null, { timeout: 120000 });
    await dono.pagina.click('.lnux-dialogo footer button:text-is("Fechar")').catch(() => {});
    const giro = () => dono.ev(() => { let pa = null; window.Companhia.palco.mundo.mapa.traverse((o) => { if (o.name === "Pa") pa = o; }); return pa ? pa.quaternion.toArray() : null; });
    const g1 = await giro();
    await dono.pagina.waitForTimeout(1200);
    const g2 = await giro();
    const mundo = await dono.ev(() => { const m = window.Companhia.palco.mundo; let pa = null, chao = null; m.mapa.traverse((o) => { if (o.name === "Pa") pa = o; if (o.name === "Chao") chao = o; });
      return { animacoes: m.animacoes.length, mixer: !!m.mixer, pa: !!(pa && pa.userData.animado), chao: !!(chao && !chao.userData.animado), tri: m.colisor.geometry.index ? m.colisor.geometry.index.count / 3 : m.colisor.geometry.attributes.position.count / 3 }; });
    ok(mundo.animacoes === 1 && mundo.mixer && g1 && g2 && g1.some((v, i) => Math.abs(v - g2[i]) > 0.01), "no jogo, a animação do mapa toca (a pá gira)");
    ok(mundo.pa && mundo.chao && mundo.tri === 12, `a peça que se mexe sai da colisão (fica só o chão: ${mundo.tri} triângulos)`);

    // ── quem entra na sala vê a animação no mesmo ponto ──
    const codigo = await dono.ev(() => window.Companhia.sala.codigo);
    await bia.pagina.goto("about:blank");
    await bia.pagina.goto(`${BASE}/apps/companhia/#sala=${codigo}`);
    await bia.pagina.waitForSelector(`.cartao-sala[data-codigo="${codigo}"] .entrar`, { timeout: 30000 });
    await bia.pagina.click(`.cartao-sala[data-codigo="${codigo}"] .entrar`);
    await bia.pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.palco.mundo.mixer && window.Companhia.sala.desvio !== undefined, null, { timeout: 180000 });
    await dono.pagina.waitForFunction(() => window.Companhia.sala.desvio !== undefined, null, { timeout: 30000 });
    // o ponto da animação = o relógio do servidor (módulo 4 s): o mesmo para as duas, a menos da diferença dos relógios
    const [ra, rb] = await Promise.all([dono.ev(() => ({ t: C.relogioDaSala(), agora: Date.now() / 1000 })), bia.ev(() => ({ t: C.relogioDaSala(), agora: Date.now() / 1000 }))]);
    const dif = Math.abs((ra.t - ra.agora) - (rb.t - rb.agora));
    ok(dif < 0.5, `as duas tocam a animação pelo relógio do servidor (diferença de ${dif.toFixed(3)} s): quem entra vê a pá na mesma posição`);
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await dono.pagina.screenshot({ path: path.join(PASTA, "companhia-sketchfab-erro.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    for (const n of navegadores) await n.close();
    falso.srv.close();
  }
  console.log(`\nSketchfab e mapas animados: ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
