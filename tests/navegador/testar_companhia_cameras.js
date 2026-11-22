// Teste das câmeras do WEBC, do boneco de pano e da colisão entre as pessoas, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_cameras
//
// Cria uma sala (com o boneco padrão) e confere: terceira pessoa com a câmera para o lado, no ombro (Q troca o
// lado), primeira pessoa (F) nos olhos, com a cabeça escondida, o corpo aparecendo ao olhar para baixo e a cabeça
// acompanhando o olhar; a câmera seguindo a cabeça num giro grande; o boneco de pano (R) caindo no chão e levantando;
// e que a personagem não atravessa outra pessoa da sala.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const FOTOS = process.env.LNUX_TESTE_FOTOS || "";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch();
  const consola = [];
  const contexto = await navegador.newContext({ viewport: { width: 1100, height: 760 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  await contexto.addInitScript(() => { try { localStorage.setItem("companhia.luz", JSON.stringify({ realista: false, sombras: false })); localStorage.removeItem("companhia.mundo"); } catch (e) { /* sem armazenamento */ } });
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const foto = async (nome) => { if (FOTOS) await pagina.screenshot({ path: path.join(FOTOS, nome + ".png") }); };
  /** Onde está a câmera em relação à personagem: a distância da cabeça, para que lado e a altura. */
  const medir = () => ev(() => {
    const p = window.Companhia.palco, m = p.mundo, cam = p.camera, cab = p.posicao("head"), raiz = p.raiz.position;
    const direita = new THREE.Vector3(Math.cos(m.cam.giro), 0, -Math.sin(m.cam.giro));
    const alvo = (m._centro || m.cam.alvo).clone(), base = raiz.clone().setY(raiz.y + m.altura * 0.82);
    return { modo: m.cfg.camera, daCabeca: cam.position.distanceTo(cab), lado: alvo.clone().sub(base).dot(direita), fov: cam.fov,
      escalaCabeca: p.ossoBruto("head").scale.x, altura: m.altura };
  });
  try {
    // ── entra numa sala (o boneco padrão) ──
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}`);
    await pagina.waitForSelector(".tela-inicio #inicio-sem-conta", { timeout: 30000 });
    await pagina.click("#inicio-sem-conta");
    await pagina.fill("#inicio-nome", "Camila");
    await pagina.click("#inicio-jogar");
    await pagina.waitForSelector('.webc-cartao[data-ir="sala"]', { timeout: 30000 });
    await ev(() => C.webc.ir("sala"));
    await pagina.waitForSelector(".salas #sala-criar", { timeout: 20000 });
    await pagina.click("#sala-criar");
    await pagina.waitForSelector('.lnux-dialogo input[aria-label="Nome da sala"]');
    await pagina.click('.lnux-dialogo footer button:text-is("Criar e entrar")');
    await pagina.waitForFunction(() => window.Companhia.sala && window.Companhia.sala.dentro && window.Companhia.palco.mundo.andando, null, { timeout: 90000 });
    await pagina.waitForSelector(".link-sala input");
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');
    await pagina.waitForTimeout(1500);

    // ── terceira pessoa, com a câmera para o lado ──
    let c = await medir();
    ok(c.modo === "terceira" && c.daCabeca > 1.5 && Math.abs(c.lado) < 0.05 && c.escalaCabeca > 0.5, `começa em terceira pessoa, atrás e no meio (a ${c.daCabeca.toFixed(1)} m da cabeça)`);
    await ev(() => { const m = window.Companhia.palco.mundo; m.cfg.camLado = 0.6; m.cfg.camAltura = 0.3; });
    await pagina.waitForTimeout(900);
    c = await medir();
    ok(c.lado > 0.45, `dá para pôr a câmera para o lado em terceira pessoa (${c.lado.toFixed(2)} m para a direita)`);
    await ev(() => { const m = window.Companhia.palco.mundo; m.cfg.camLado = 0; m.cfg.camAltura = 0; });

    // ── no ombro: Q liga e troca o lado ──
    await pagina.keyboard.press("KeyQ");
    await pagina.waitForTimeout(900);
    const direito = await medir();
    await foto("camera-ombro");
    await pagina.keyboard.press("KeyQ");
    await pagina.waitForTimeout(900);
    const esquerdo = await medir();
    ok(direito.modo === "ombro" && direito.lado > 0.3 && esquerdo.lado < -0.3 && direito.daCabeca < c.daCabeca,
      `Q põe a câmera no ombro (direito: ${direito.lado.toFixed(2)} m) e, de novo, troca o lado (esquerdo: ${esquerdo.lado.toFixed(2)} m), mais perto`);

    // ── primeira pessoa: F ──
    await pagina.keyboard.press("KeyF");
    await pagina.waitForTimeout(900);
    c = await medir();
    ok(c.modo === "primeira" && c.daCabeca < 0.25 * (c.altura / 1.5) + 0.05 && c.escalaCabeca < 0.01 && c.fov === 75,
      `F vai para a primeira pessoa: a câmera nos olhos (a ${c.daCabeca.toFixed(2)} m do osso da cabeça) e a cabeça escondida só para quem joga`);
    // olhar para baixo: a cabeça abaixa e o corpo aparece embaixo da tela
    const olhar = (altura) => ev((a) => {
      const p = window.Companhia.palco, m = p.mundo;
      m.cam.altura = a;
      return new Promise((ok) => setTimeout(() => {
        const cam = p.camera, frente = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        // o quadril na tela (y de -1 embaixo a 1 em cima) e se está dentro dela
        const q = p.posicao("leftLowerLeg").project(cam), pe = p.posicao("leftFoot").project(cam);
        ok({ inclinacao: Math.asin(frente.y), cabeca: m.olharCabeca, quadril: [q.x, q.y, q.z], pe: [pe.x, pe.y, pe.z], estado: window.Companhia.sala.meuEstado().o || 0 });
      }, 700));
    }, altura);
    const frente = await olhar(0);
    const baixo = await olhar(1.2);
    await foto("camera-primeira-baixo");
    const dentro = (v) => Math.abs(v[0]) <= 1 && Math.abs(v[1]) <= 1 && v[2] < 1;
    ok(baixo.inclinacao < -0.9 && dentro(baixo.quadril) && dentro(baixo.pe) && !dentro(frente.pe),
      `olhando para baixo, aparece o corpo (as pernas e os pés na tela; olhando para a frente, os pés não aparecem)`);
    ok(baixo.cabeca > 0.9 && Math.abs(frente.cabeca) < 0.05 && baixo.estado > 0.9, `a cabeça abaixa junto com o olhar (${baixo.cabeca.toFixed(2)} rad), e a sala recebe isso para os outros verem`);
    const cima = await olhar(-0.9);
    ok(cima.inclinacao > 0.6 && cima.cabeca < -0.6, "olhando para cima, a cabeça levanta");
    await olhar(0);
    // um giro grande da cabeça (como num mortal): a câmera vai junto
    const segue = await ev(() => new Promise((ok) => {
      // o quadril dá meia cambalhota (pelo ajuste dos ossos, que vale a cada quadro, como um movimento faria)
      const p = window.Companhia.palco, cam = p.camera, antes = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      p.ajusteQ.set("hips", new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2.2));
      setTimeout(() => { const depois = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); p.ajusteQ.delete("hips"); ok(antes.angleTo(depois)); }, 900);
    }));
    ok(segue > 0.6, `num giro grande do corpo (como um mortal), a câmera em primeira pessoa segue a cabeça (girou ${(segue * 57.3).toFixed(0)}°)`);
    await pagina.waitForTimeout(400);

    // ── boneco de pano: R ──
    await pagina.keyboard.press("KeyF"); // volta à terceira pessoa
    await pagina.waitForTimeout(500);
    c = await medir();
    ok(c.modo === "terceira" && c.escalaCabeca > 0.5, "F de novo volta à terceira pessoa (e a cabeça volta)");
    const pe0 = await ev(() => window.Companhia.palco.raiz.position.y);
    await pagina.keyboard.press("KeyR");
    await pagina.waitForTimeout(2500);
    const caido = await ev(() => {
      const p = window.Companhia.palco, m = p.mundo, r = m.ragdoll;
      return { ativo: r.ativo, estado: m.estado, quadril: p.posicao("hips").y, cabeca: p.posicao("head").y, sala: window.Companhia.sala.meuEstado() };
    });
    await foto("ragdoll");
    ok(caido.ativo && caido.estado === "caido" && caido.quadril < pe0 + 0.45 && caido.cabeca < pe0 + 0.6,
      `R: cai como boneco de pano e fica no chão (quadril a ${(caido.quadril - pe0).toFixed(2)} m, cabeça a ${(caido.cabeca - pe0).toFixed(2)} m do chão)`);
    ok(caido.sala.e === "caido" && caido.sala.pose && Object.keys(caido.sala.pose).length >= 12 && Array.isArray(caido.sala.qd), "a pose do corpo caído vai para as outras pessoas da sala");
    await pagina.keyboard.press("KeyR");
    await pagina.waitForTimeout(1200);
    const depe = await ev(() => { const p = window.Companhia.palco; return { ativo: p.mundo.ragdoll.ativo, cabeca: p.posicao("head").y - p.raiz.position.y, altura: p.mundo.altura }; });
    ok(!depe.ativo && depe.cabeca > depe.altura * 0.7, "R de novo: levanta e fica de pé");

    // ── ninguém atravessa ninguém ──
    const empurrou = await ev(() => new Promise((ok) => {
      const p = window.Companhia.palco, m = p.mundo, raiz = p.raiz.position;
      const outra = { p: raiz.clone().add(new THREE.Vector3(0, 0, 0.1)), raio: 0.26, altura: 1.6 };
      const antes = m.outros;
      m.outros = () => [outra];
      setTimeout(() => { const d = Math.hypot(raiz.x - outra.p.x, raiz.z - outra.p.z); m.outros = antes; ok({ d, minimo: m.raio + outra.raio }); }, 600);
    }));
    ok(empurrou.d >= empurrou.minimo - 0.01, `encostando em outra pessoa da sala, a personagem é empurrada para fora (${empurrou.d.toFixed(2)} m entre as duas, o mínimo é ${empurrou.minimo.toFixed(2)})`);
    // andando contra ela, não passa
    const parede = await ev(() => new Promise((ok) => {
      const p = window.Companhia.palco, m = p.mundo, raiz = p.raiz.position;
      const frente = new THREE.Vector3(-Math.sin(m.cam.giro), 0, -Math.cos(m.cam.giro));
      const outra = { p: raiz.clone().addScaledVector(frente, 1.2), raio: 0.26, altura: 1.6 };
      const antes = m.outros;
      m.outros = () => [outra];
      m.teclas.add("frente");
      setTimeout(() => {
        m.teclas.delete("frente");
        const passou = raiz.clone().sub(outra.p).dot(frente) > 0, d = Math.hypot(raiz.x - outra.p.x, raiz.z - outra.p.z);
        m.outros = antes;
        ok({ passou, d, minimo: m.raio + outra.raio });
      }, 2500);
    }));
    ok(!parede.passou && parede.d >= parede.minimo - 0.02, `andando contra outra pessoa, não atravessa (para a ${parede.d.toFixed(2)} m dela)`);

    // ── Opções › Câmera ──
    await pagina.click("#jogo-menu");
    await pagina.click('.jogo-opcoes [data-secao="camera"]');
    await pagina.click('.jogo-opcoes [data-valor="primeira"]');
    ok(await ev(() => window.Companhia.palco.mundo.cfg.camera === "primeira" && !!document.querySelector('.jogo-opcoes input[aria-label="Campo de visão"]')),
      "Opções › Câmera: escolher Primeira pessoa troca a câmera e mostra o campo de visão");
    await pagina.click('.jogo-opcoes [data-valor="ombro"]');
    ok(await ev(() => !!document.querySelector('.jogo-opcoes input[aria-label="Afastar para o lado"]') && !!document.querySelector('.jogo-opcoes [data-valor="-1"]')),
      "no ombro: o lado (esquerdo ou direito), quanto afastar e a distância");
    await pagina.click(".jogo-opcoes-fechar");
    await ev(() => window.Companhia.sala.fechar());
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push(String((e && e.stack) || e));
    console.log("  ✖ " + e);
  } finally {
    await navegador.close();
  }
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})();
