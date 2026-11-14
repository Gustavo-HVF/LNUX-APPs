// Teste do menu Movimento da Companhia (personagens VRoid), com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_corpo
//
// Parte 1 — sempre roda, sem baixar nada: um boneco VRM 0.x montado aqui mesmo (ossos e caixinhas; o VRM 0.x olha
// para −Z e tem o braço esquerdo em −X, como os do VRoid Studio estável). Cobre:
//   - o defeito corrigido: nos VRM 0.x os braços ficam para BAIXO em descanso, a cabeça abaixa quando triste e o
//     aceno levanta o braço direito;
//   - a captura de movimento com resultados de mentira (sem câmera): braço levantado, com e sem espelho, dedo
//     dobrado, pernas com os pés no chão;
//   - pacotes de movimento: um .bvh montado aqui, tocar/parar, ligação dos ossos e "usar ao andar";
//   - cenário: um .glb de caixas montado aqui, cair no chão, andar com W, parar na parede, pular com Espaço,
//     .unitypackage, a explicação do .vrcw e o cenário de volta ao recarregar;
//   - ajuste do esqueleto pela tela (braços, proporções, osso espelhado), guardado e exportado.
// Parte 2 — com o modelo de exemplo da pixiv (baixado, ou LNUX_TESTE_VRM): VRM 1.0, rosto (piscar, boca, sorriso
//   nas formas do VRoid, cabeça) e um .vrma de exemplo.
// Parte 3 — captura de verdade: uma foto de exemplo do MediaPipe vira a câmera (de mentira) do Chromium, a ponte
//   baixa os arquivos do rastreamento e a personagem copia a pose. Pulada sem internet ou com LNUX_TESTE_SEM_CAMERA=1.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const URL_VRM = "https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";
const URL_VRMA = "https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.5/packages/three-vrm-animation/examples/models/test.vrma";
const URL_FOTO = "https://storage.googleapis.com/mediapipe-assets/pose.jpg"; // foto de exemplo do MediaPipe: braços abertos
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
const pular = (m) => console.log("  ⏭  " + m);
const RUIDO = /Failed to load resource|voz do navegador|INFO: Created TensorFlow|gl_context|_graph\.cc|feedback_manager|XNNPACK/;

const { mapaDeTeste, bonecoVRM0, bvhDeTeste, unityPackage } = require("./companhia_arquivos.js");

// ── Resultados de mentira do rastreador (no formato do Worker) ────────

/**
 * Corpo: pontos em "coordenadas da pessoa" (x: esquerda dela, y: para cima, z: para a frente) → as do MediaPipe (x para a
 * direita da imagem = esquerda da pessoa, y para baixo, z negativo para a câmera). bracoE: "cima" ou "lado".
 */
function corpoDeMentira({ bracoE = "cima", agachar = 0 } = {}) {
  const P = new Array(33).fill(null).map(() => [0, 0.62, 0.05]);
  const por = (i, x, y, z) => { P[i] = [x, y, z]; };
  por(0, 0, 0.62, 0.1); por(7, 0.08, 0.64, 0); por(8, -0.08, 0.64, 0);
  por(11, 0.18, 0.45, 0); por(12, -0.18, 0.45, 0);
  if (bracoE === "cima") { por(13, 0.18, 0.72, 0); por(15, 0.18, 0.98, 0); por(17, 0.16, 1.06, -0.02); por(19, 0.2, 1.06, 0.02); por(21, 0.21, 1.02, 0.03); }
  else { por(13, 0.45, 0.45, 0); por(15, 0.7, 0.45, 0); por(17, 0.78, 0.45, -0.02); por(19, 0.78, 0.45, 0.02); por(21, 0.74, 0.45, 0.04); }
  por(14, -0.45, 0.45, 0); por(16, -0.7, 0.45, 0); por(18, -0.78, 0.45, -0.02); por(20, -0.78, 0.45, 0.02); por(22, -0.74, 0.45, 0.04);
  por(23, 0.1, 0, 0); por(24, -0.1, 0, 0);
  // agachar: os joelhos vão para a frente e os pés ficam embaixo do quadril
  const jz = 0.3 * agachar, jy = -0.42 + 0.12 * agachar, ty = -0.84 + 0.36 * agachar;
  por(25, 0.1, jy, jz); por(26, -0.1, jy, jz); por(27, 0.1, ty, 0); por(28, -0.1, ty, 0);
  por(29, 0.1, ty - 0.04, -0.05); por(30, -0.1, ty - 0.04, -0.05); por(31, 0.1, ty - 0.04, 0.12); por(32, -0.1, ty - 0.04, 0.12);
  const mundo = P.map(([x, y, z]) => [x, -y, -z, 1]);
  return { mundo, imagem: mundo.map(([x, y]) => [0.5 + x * 0.45, 0.45 + y * 0.45, 0, 1]) };
}
/** Mão esquerda da pessoa, no alto (junto do pulso do braço levantado), palma para a frente; dobrar: o indicador fecha. */
function maoDeMentira(dobrar) {
  const pulso = [0.18, 0.98, 0], H = new Array(21).fill(null);
  H[0] = pulso;
  [[0.15, 1.0, 0.01], [0.13, 1.03, 0.02], [0.115, 1.06, 0.02], [0.1, 1.08, 0.02]].forEach((p, i) => { H[1 + i] = p; });
  [[5, 0.16], [9, 0.18], [13, 0.2], [17, 0.22]].forEach(([i, x]) => {
    H[i] = [x, 1.07, 0];
    if (i === 5 && dobrar) { H[6] = [x, 1.105, 0.02]; H[7] = [x, 1.1, 0.05]; H[8] = [x, 1.075, 0.06]; }
    else { H[i + 1] = [x, 1.11, 0]; H[i + 2] = [x, 1.14, 0]; H[i + 3] = [x, 1.165, 0]; }
  });
  const mundo = H.map(([x, y, z]) => [x - 0.18, -(y - 1.07), -z, 1]);
  return { lado: "Right", confianca: 0.95, mundo, imagem: H.map(([x, y]) => [0.5 + x * 0.45, 0.45 - y * 0.45, 0, 1]) };
}
/** Rosto: pisca o olho esquerdo, boca aberta sorrindo, cabeça virada para a esquerda da pessoa (giro em Y). */
function rostoDeMentira() {
  const a = 0.45, c = Math.cos(a), s = Math.sin(a);
  return { formas: { eyeBlinkLeft: 0.92, eyeBlinkRight: 0.04, jawOpen: 0.5, mouthSmileLeft: 0.85, mouthSmileRight: 0.85, browInnerUp: 0.1, eyeLookOutLeft: 0.5, eyeLookInRight: 0.5 },
    matriz: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -60, 1] };
}

async function baixar(url, destino) {
  if (fs.existsSync(destino)) return true;
  try { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer())); return true; }
  catch (e) { return false; }
}

(async () => {
  const boneco = path.join(PASTA, "boneco-vrm0.vrm"), mapa = path.join(PASTA, "mapa-teste.glb"), bvh = path.join(PASTA, "levantar-braco.bvh");
  fs.writeFileSync(boneco, bonecoVRM0());
  fs.writeFileSync(mapa, mapaDeTeste());
  fs.writeFileSync(bvh, bvhDeTeste());
  const pacoteUnity = path.join(PASTA, "mundo.unitypackage");
  fs.writeFileSync(pacoteUnity, unityPackage("Assets/Mundo/mapa-do-pacote.glb", mapaDeTeste()));
  const mundoVrc = path.join(PASTA, "mundo.vrcw");
  fs.writeFileSync(mundoVrc, Buffer.from("UnityFS\0\0\0\0\x065.x.x\0"));

  const abrirNavegador = async (args = []) => {
    const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", ...args] });
    const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR", acceptDownloads: true, permissions: ["camera"] });
    await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
    const pagina = await contexto.newPage();
    const consola = [];
    pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
    pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 20000 });
    return { navegador, pagina, consola };
  };
  let { navegador, pagina, consola } = await abrirNavegador();
  let ev = (f, a) => pagina.evaluate(f, a);
  let esperar = (ms) => pagina.waitForTimeout(ms);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const escolherArquivo = async (arquivos) => {
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arquivos);
  };
  const importarPersonagem = async (arquivo) => {
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await escolherArquivo(arquivo);
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });
    // a saudação acena: espera o gesto acabar e o rosto voltar ao neutro, para medir a pose de descanso
    await pagina.waitForFunction(() => !window.Companhia.palco.gestos.length && !window.Companhia.respondendo, null, { timeout: 30000 });
    await ev(() => window.Companhia.palco.definirEmocao("neutra"));
    await esperar(900);
  };
  /** Posições (mundo) dos ossos pedidos e medidas úteis. */
  const corpo = () => ev(() => {
    const p = window.Companhia.palco, r = {};
    for (const n of ["head", "neck", "hips", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightHand", "leftIndexDistal", "leftFoot", "rightFoot", "leftLowerLeg"]) { const v = p.posicao(n); r[n] = v ? [v.x, v.y, v.z] : null; }
    const cab = p.nos.head, q = cab.getWorldQuaternion(new THREE.Quaternion()), frente = new THREE.Vector3(0, 0, p.v0 ? -1 : 1).applyQuaternion(q);
    return { ...r, frente: [frente.x, frente.y, frente.z], v0: p.v0, altura: p.altura, raiz: p.raiz.position.toArray() };
  });
  /** Espera a captura (de mentira) assentar na pose. */
  const assentar = () => pagina.waitForFunction(() => { const c = window.Companhia.captura; return c.alvos.size > 0 && [...c.alvos].every(([n, a]) => { const s = c.atual.get(n); return s && Math.abs(s.peso - a.peso) < 0.03; }); }, null, { timeout: 30000 }).then(() => esperar(700));
  const simular = (dados, cfg) => ev(([dados, cfg]) => {
    const c = window.Companhia.captura;
    clearInterval(c._teste);
    c.desligar();
    Object.assign(c.cfg, { rosto: true, corpo: true, maos: true, pernas: false, olhos: true, espelhar: false, suavizar: 0.2, previa: false }, cfg);
    c._teste = setInterval(() => c.simular(dados), 50);
  }, [dados, cfg || {}]);
  const pararSimulacao = () => ev(() => { const c = window.Companhia.captura; clearInterval(c._teste); c.desligar(); });

  try {
    // ════ Parte 1: boneco VRM 0.x ════
    await importarPersonagem(boneco);
    let c = await corpo();
    ok(c.v0 === true && (await ev(() => !document.querySelector("#chip-movimento").hidden)), "boneco VRM 0.x aberto no palco 3D, com o botão 🎬 Movimento");
    ok(c.leftHand[1] < c.leftUpperArm[1] - 0.15 && c.rightHand[1] < c.rightUpperArm[1] - 0.15, `VRM 0.x: em descanso os braços ficam para BAIXO (mãos ${(c.leftHand[1] - c.leftUpperArm[1]).toFixed(2)} e ${(c.rightHand[1] - c.rightUpperArm[1]).toFixed(2)} m abaixo dos ombros)`);
    ok(c.leftHand[0] > 0.1 && c.rightHand[0] < -0.1, "VRM 0.x: a personagem olha para a câmera (a mão esquerda dela fica do lado direito da tela)");
    await ev(() => window.Companhia.palco.definirEmocao("triste"));
    await esperar(900);
    c = await corpo();
    ok(c.frente[1] < -0.08 && c.frente[2] > 0.8, `VRM 0.x: triste, a cabeça abaixa (antes levantava): frente ${c.frente.map((v) => v.toFixed(2))}`);
    await ev(() => { window.Companhia.palco.definirEmocao("neutra"); window.Companhia.palco.gesto("acenar"); });
    await esperar(900);
    c = await corpo();
    ok(c.rightHand[1] > c.rightUpperArm[1] + 0.1 && c.leftHand[1] < c.leftUpperArm[1], `VRM 0.x: acenar levanta o braço direito (mão ${(c.rightHand[1] - c.rightUpperArm[1]).toFixed(2)} m acima do ombro)`);
    await esperar(1200);

    // ── captura de movimento, com resultados de mentira ──
    await simular({ corpo: corpoDeMentira({ bracoE: "cima" }), maos: [maoDeMentira(false)] }, { espelhar: false });
    await assentar();
    c = await corpo();
    const retoE = Math.hypot(...c.leftIndexDistal.map((v, i) => v - c.leftHand[i]));
    ok(c.leftHand[1] > c.head[1] + 0.05 && Math.abs(c.rightHand[1] - c.rightUpperArm[1]) < 0.1 && c.rightHand[0] < -0.45,
      `captura (sem espelho): o braço esquerdo da pessoa levanta o esquerdo da personagem; o direito fica aberto (mão E ${c.leftHand[1].toFixed(2)} m, cabeça ${c.head[1].toFixed(2)} m)`);
    await simular({ corpo: corpoDeMentira({ bracoE: "cima" }), maos: [maoDeMentira(true)] }, { espelhar: false });
    await assentar();
    c = await corpo();
    const dobradoE = Math.hypot(...c.leftIndexDistal.map((v, i) => v - c.leftHand[i]));
    ok(dobradoE < retoE * 0.85, `captura dos dedos: o indicador dobrado chega mais perto do pulso (${retoE.toFixed(3)} → ${dobradoE.toFixed(3)} m)`);
    await simular({ corpo: corpoDeMentira({ bracoE: "cima" }) }, { espelhar: true });
    await assentar();
    c = await corpo();
    ok(c.rightHand[1] > c.head[1] + 0.05 && Math.abs(c.leftHand[1] - c.leftUpperArm[1]) < 0.1, "captura (espelho): o braço esquerdo da pessoa levanta o DIREITO da personagem, como num espelho");
    await simular({ corpo: corpoDeMentira({ bracoE: "lado", agachar: 1 }) }, { pernas: true });
    await assentar();
    c = await corpo();
    const peMaisBaixo = Math.min(c.leftFoot[1], c.rightFoot[1]);
    ok(c.hips[1] < 0.9 - 0.12 && c.leftLowerLeg[2] > c.hips[2] + 0.1 && Math.abs(peMaisBaixo - 0.08) < 0.06,
      `captura das pernas: agachar dobra os joelhos para a frente e desce o quadril, com os pés no chão (quadril ${c.hips[1].toFixed(2)} m, pés ${peMaisBaixo.toFixed(2)} m)`);
    await pararSimulacao();
    await esperar(1500);
    c = await corpo();
    ok(c.leftHand[1] < c.leftUpperArm[1] - 0.15 && Math.abs(c.hips[1] - 0.9) < 0.03, "captura desligada: a personagem volta à pose de descanso");

    // ── pacotes de movimento ──
    await menu("Movimento", "Pacotes de movimento...");
    await pagina.waitForSelector(".painel-estudio");
    await pagina.click('.painel-estudio button:text-is("Importar...")');
    await escolherArquivo(bvh);
    await pagina.waitForSelector('.linha-movimento:has-text("levantar-braco")', { timeout: 30000 });
    const mov = await ev(async () => (await C.movimentos.lista())[0]);
    ok(mov.tipo === "bvh" && Math.abs(mov.duracao - 1) < 0.05, `movimento .bvh importado pela tela: "${mov.nome}", ${mov.duracao} s`);
    const ligados = await ev(async (id) => (await C.movimentos.ossos(id)).automatico, mov.id);
    ok(ligados.hips === "Hips" && ligados.leftUpperArm === "LeftArm" && ligados.leftLowerArm === "LeftForeArm" && ligados.rightUpperLeg === "RightUpLeg" && ligados.leftLowerLeg === "LeftLeg" && ligados.neck === "Neck",
      "o esqueleto do arquivo é reconhecido pelos nomes (Hips, LeftArm, LeftForeArm, RightUpLeg...)");
    await pagina.locator('.linha-movimento:has-text("levantar-braco") button').first().click();
    await pagina.waitForFunction(() => { const a = window.Companhia.palco.anim; return a.tocando && a.peso > 0.99 && a.tempo > 0.85; }, null, { timeout: 20000 });
    c = await corpo();
    ok(c.leftHand[1] > c.leftUpperArm[1] + 0.2 && c.rightHand[1] < c.rightUpperArm[1] + 0.12 && c.hips[0] - c.raiz[0] > 0.12 && Math.abs(c.hips[1] - 0.9) < 0.03,
      `tocar o movimento: no fim o braço esquerdo está no alto e o corpo andou para a esquerda dela (mão ${(c.leftHand[1] - c.leftUpperArm[1]).toFixed(2)} m acima do ombro, quadril ${(c.hips[0] - c.raiz[0]).toFixed(2)} m para o lado)`);
    ok(await pagina.locator(".linha-movimento.tocando").count() === 1, "o painel mostra qual movimento está tocando");
    // ligar os ossos à mão: com os braços trocados, o esquerdo para de subir e quem mexe é o direito
    await ev(async (id) => { const o = await C.movimentos.ossos(id); const m = { ...o.automatico, leftUpperArm: o.automatico.rightUpperArm, rightUpperArm: o.automatico.leftUpperArm }; await C.movimentos.definirMapa(id, m); await window.Companhia.estudio.tocar(id); }, mov.id);
    await pagina.waitForFunction(() => { const a = window.Companhia.palco.anim; return a.tocando && a.peso > 0.99 && a.tempo > 0.85; }, null, { timeout: 20000 });
    c = await corpo();
    ok(Math.abs(c.leftLowerArm[1] - c.leftUpperArm[1]) < 0.06 && Math.abs(c.rightHand[1] - c.rightUpperArm[1]) > 0.15, "ligação dos ossos trocada à mão (Ossos...): o braço esquerdo para de subir (o cotovelo fica na altura do ombro) e quem mexe é o direito");
    await ev(async (id) => { await C.movimentos.definirMapa(id, null); window.Companhia.estudio.parar(); }, mov.id);
    await pagina.waitForFunction(() => !window.Companhia.palco.anim.tocando && window.Companhia.palco.anim.peso < 0.01, null, { timeout: 10000 });
    c = await corpo();
    ok(c.leftHand[1] < c.leftUpperArm[1] - 0.15 && c.rightHand[1] < c.rightUpperArm[1] - 0.15, "parar o movimento: volta à pose de descanso");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-1.png") });

    // ── cenário e andar ──
    await menu("Movimento", "Cenário (mapa)...");
    await pagina.waitForSelector('.painel-estudio:has-text("Cenário")');
    await pagina.click('.painel-estudio button:text-is("Abrir cenário...")');
    await escolherArquivo(mundoVrc);
    await pagina.waitForSelector('.lnux-dialogo h2:text-is("Esse arquivo não abre aqui")', { timeout: 15000 });
    const explicacao = await pagina.textContent(".lnux-dialogo:last-of-type .corpo");
    ok(/VRChat/.test(explicacao) && /glTF|GLB/.test(explicacao) && /unitypackage/.test(explicacao), "o mundo publicado do VRChat (.vrcw) é explicado: não abre; use glTF/GLB ou o .unitypackage");
    await pagina.click('.lnux-dialogo footer button:text-is("Entendi")');
    await pagina.click('.painel-estudio button:text-is("Abrir cenário...")');
    await escolherArquivo(mapa);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.info && window.Companhia.palco.mundo.colisor, null, { timeout: 30000 });
    await esperar(500);
    c = await corpo();
    const infoMapa = await ev(() => { const m = window.Companhia.palco.mundo; return { nome: m.info.nome, escala: m.info.ajuste.escala, caixa: [m.caixa.min.y, m.caixa.max.y] }; });
    ok(Math.abs(c.raiz[1] - 1) < 0.03 && infoMapa.escala === 1, `cenário .glb aberto: a personagem aparece em cima do piso (y = ${c.raiz[1].toFixed(2)} m), no retrato com o mapa atrás`);
    await pagina.click('.painel-estudio button:text-is("Andar pelo cenário")');
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.andando, null, { timeout: 5000 });
    ok(await ev(() => !!document.querySelector(".controles-mundo .direcional") && window.Companhia.palco.zonasAtuais().length === 0 && window.Companhia.palco.camera.fov === 50),
      "andar pelo cenário: câmera em terceira pessoa, direcional na tela e toques desligados");
    // ── luz e sombras realistas (dá para desligar) ──
    const luz = await ev(async () => {
      const p = window.Companhia.palco, T = window.THREE, r = p.renderer, gl = r.getContext();
      const quadros = (n) => new Promise((fim) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : fim()); f(); });
      // uma caixa no ar, de lado: a sombra dela cai no piso do cenário, num ponto que dá para calcular pelo sol
      const caixa = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0xcc5533 }));
      caixa.position.set(2.2, 2.5, 1.6);
      caixa.castShadow = true;
      p.cena.add(caixa);
      const ler = async () => {
        await quadros(4);
        const a = p.luzCfg.sol * Math.PI / 180, t = 1.5 / Math.tan(p.luzCfg.altura * Math.PI / 180);
        const ponto = new T.Vector3(2.2 - Math.sin(a) * t, 1, 1.6 - Math.cos(a) * t).project(p.camera), px = new Uint8Array(4), tela = r.domElement;
        r.render(p.cena, p.camera);
        gl.readPixels(Math.round((ponto.x + 1) / 2 * tela.width), Math.round((ponto.y + 1) / 2 * tela.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { claro: px[0] + px[1] + px[2], naTela: Math.abs(ponto.x) < 0.95 && Math.abs(ponto.y) < 0.95 };
      };
      const estado = () => ({ sombras: r.shadowMap.enabled && p.luz.castShadow, tons: r.toneMapping !== T.NoToneMapping, redonda: p.mundo.sombra.material.opacity });
      p.definirLuz({ realista: true, sombras: true, sol: 135, altura: 55 });
      const com = await ler(), ligada = estado();
      p.definirLuz({ sombras: false });
      const sem = await ler(), semSombras = estado();
      p.definirLuz({ sombras: true });
      p.cena.remove(caixa);
      let normais = true;
      p.mundo.mapa.traverse((o) => { if (o.isMesh && !o.geometry.attributes.normal) normais = false; });
      return { com, sem, ligada, semSombras, normais };
    });
    ok(luz.ligada.sombras && luz.ligada.tons && luz.ligada.redonda === 0 && luz.com.naTela && luz.normais && luz.com.claro < luz.sem.claro * 0.9,
      `luz e sombras realistas: o sol faz sombra no piso do cenário (ponto na sombra ${luz.com.claro}, sem sombra ${luz.sem.claro}) e a sombra redonda some`);
    ok(!luz.semSombras.sombras && luz.semSombras.tons && luz.semSombras.redonda === 1, "\"Sombras\" desligada: fica a luz do sol, sem sombra (a redonda volta)");
    await pagina.click('.painel-estudio label:has-text("Luz e sombras realistas") input');
    await esperar(300);
    ok(await ev(() => { const p = window.Companhia.palco, r = p.renderer; return !p.luzCfg.realista && !r.shadowMap.enabled && !p.luz.castShadow && r.toneMapping === window.THREE.NoToneMapping && p.luzSol === false && JSON.parse(LNUX.preferencia.ler("companhia.luz", "{}")).realista === false; }),
      "desligar \"Luz e sombras realistas\" no painel volta à luz simples de antes, e a escolha fica guardada");
    await pagina.click('.painel-estudio label:has-text("Luz e sombras realistas") input');
    await pagina.mouse.click(200, 420); // o palco recebe as teclas
    const z0 = (await corpo()).raiz[2];
    await pagina.keyboard.down("KeyW");
    await pagina.waitForFunction((z) => window.Companhia.palco.raiz.position.z > z + 0.6, z0, { timeout: 20000 });
    ok(await ev(() => window.Companhia.palco.mundo.estado === "andando"), "W anda para a frente (para longe da câmera)");
    await pagina.keyboard.down("ShiftLeft");
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.estado === "correndo", null, { timeout: 10000 });
    ok(true, "Shift corre");
    await esperar(4500);
    await pagina.keyboard.up("ShiftLeft");
    await pagina.keyboard.up("KeyW");
    c = await corpo();
    ok(c.raiz[2] > 2.3 && c.raiz[2] < 3 && Math.abs(c.raiz[1] - 1) < 0.05, `a parede segura a personagem (parou em z = ${c.raiz[2].toFixed(2)} m; a parede começa em 3)`);
    const pulo = await ev(async () => {
      const p = window.Companhia.palco, m = p.mundo;
      let alto = p.raiz.position.y, noAr = false;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }));
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) { alto = Math.max(alto, p.raiz.position.y); noAr = noAr || m.estado === "pulando"; if (noAr && m.noChao && performance.now() - t0 > 400) break; await new Promise((r) => requestAnimationFrame(r)); }
      return { alto, noAr, fim: p.raiz.position.y, noChao: m.noChao };
    });
    ok(pulo.alto > 1.5 && pulo.noAr && pulo.noChao && Math.abs(pulo.fim - 1) < 0.05, `Espaço pula e ela cai de volta no piso (subiu até ${pulo.alto.toFixed(2)} m)`);
    await pagina.keyboard.down("KeyA");
    await esperar(1500);
    await pagina.keyboard.up("KeyA");
    c = await corpo();
    ok(c.raiz[0] > 0.3, `A anda para o lado (x = ${c.raiz[0].toFixed(2)} m)`);
    // o movimento importado no lugar do andar próprio
    await ev(async (id) => { LNUX.preferencia.gravar("companhia.andar", JSON.stringify({ andando: id })); await window.Companhia.estudio.aplicarAndar(); }, mov.id);
    await pagina.keyboard.down("KeyS");
    await pagina.waitForFunction(() => { const a = window.Companhia.palco.anim; return a.info && a.info.tipo === "andar" && a.peso > 0.9; }, null, { timeout: 15000 });
    ok(await ev(() => window.Companhia.palco.anim.noLugar === true), "um movimento do pacote pode ficar no lugar do andar próprio (\"usar ao andar\"), sem tirar o quadril do lugar");
    await pagina.keyboard.up("KeyS");
    await ev(async () => { LNUX.preferencia.gravar("companhia.andar", "{}"); await window.Companhia.estudio.aplicarAndar(); });
    await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-2.png") });
    await ev(() => window.Companhia.palco.mundo.marcarPartida());
    const partida = await ev(async () => { const m = window.Companhia.palco.mundo; await C.mapas.atualizar({ id: m.info.id, ajuste: m.info.ajuste }); return m.info.ajuste.partida; });
    await pagina.click('.painel-estudio button:text-is("Voltar ao retrato")');
    await pagina.waitForFunction(() => !window.Companhia.palco.mundo.andando && window.Companhia.palco.camera.fov === 30, null, { timeout: 5000 });
    c = await corpo();
    ok(Math.abs(c.raiz[0] - partida[0]) < 0.01 && Math.abs(c.raiz[2] - partida[2]) < 0.01 && (await ev(() => window.Companhia.palco.zonasAtuais().length > 0)), "voltar ao retrato: ela fica no ponto de partida marcado (\"Começar aqui\") e os toques voltam");
    // .unitypackage: abre o pacote e acha o modelo de dentro
    await pagina.click('.painel-estudio button:text-is("Abrir cenário...")');
    await escolherArquivo(pacoteUnity);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.info && window.Companhia.palco.mundo.info.principal === "mundo.glb", null, { timeout: 30000 });
    ok((await ev(() => C.mapas.lista())).length === 2, "um .unitypackage é aberto e o modelo de dentro vira o cenário (guardado em .glb)");
    await pagina.click(".painel-estudio header button");

    // ── ajuste do esqueleto, pela tela ──
    await menu("Movimento", "Ajustar esqueleto...");
    await pagina.waitForSelector('.painel-estudio:has-text("Ajustar esqueleto")');
    const faixa = (rotulo, valor) => pagina.locator(`.painel-estudio input[type=range][aria-label^="${rotulo}"]`).evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, valor);
    const antes = await corpo();
    await faixa("Braços em descanso", 20);
    await esperar(500);
    c = await corpo();
    ok(c.leftHand[1] > antes.leftHand[1] + 0.15 && c.leftHand[1] < c.leftUpperArm[1], `braços em descanso a 20°: mais abertos (mão de ${antes.leftHand[1].toFixed(2)} para ${c.leftHand[1].toFixed(2)} m)`);
    await faixa("Pernas", 1.25);
    await esperar(500);
    c = await corpo();
    const pe = Math.min(c.leftFoot[1], c.rightFoot[1]) - c.raiz[1];
    ok(c.hips[1] - c.raiz[1] > 0.9 + 0.15 && Math.abs(pe - 0.1) < 0.05, `pernas a 125%: o quadril sobe e os pés continuam no chão (quadril ${(c.hips[1] - c.raiz[1]).toFixed(2)} m, pés ${pe.toFixed(2)} m)`);
    await pagina.selectOption('.painel-estudio select[aria-label="Osso"]', "leftUpperArm");
    await pagina.locator('.painel-estudio details:has-text("Correção por osso") input[type=range]').nth(2).evaluate((e) => { e.value = 30; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await esperar(1200);
    const guardado = await ev(() => window.Companhia.atual.esqueleto);
    c = await corpo();
    ok(JSON.stringify(guardado.ossos.leftUpperArm) === "[0,0,30]" && JSON.stringify(guardado.ossos.rightUpperArm) === "[0,0,-30]" && c.leftHand[1] > c.leftUpperArm[1] && c.rightHand[1] > c.rightUpperArm[1],
      "correção de um osso (braço esquerdo, +30° em Z) espelhada no outro lado: os dois braços sobem");
    ok(await ev(() => !!window.Companhia.palco.ajudante && window.Companhia.palco.ossoMarcado === "leftUpperArm"), "o esqueleto aparece na tela com o osso escolhido marcado");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-3.png") });
    await pagina.click(".painel-estudio header button");
    ok(await ev(() => !window.Companhia.palco.ajudante), "fechar o painel esconde o esqueleto");

    // ── recarregar: o ajuste, o cenário e os movimentos continuam ──
    await esperar(800);
    await pagina.reload();
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 60000 });
    await esperar(500);
    const depois = await ev(async () => { const p = window.Companhia.palco; return { ajuste: p.ajuste, mapa: p.mundo.info && p.mundo.info.principal, movimentos: (await C.movimentos.lista()).length, y: p.raiz.position.y }; });
    ok(depois.ajuste.bracos === 20 && depois.ajuste.escala.pernas === 1.25 && depois.ajuste.ossos.leftUpperArm[2] === 30 && depois.mapa === "mundo.glb" && depois.movimentos === 1 && Math.abs(depois.y - 1) < 0.05,
      `ao abrir de novo: o ajuste do esqueleto, o cenário e os movimentos continuam (${JSON.stringify({ bracos: depois.ajuste.bracos, mapa: depois.mapa, movimentos: depois.movimentos })})`);
    await menu("Personagem", "Exportar personagem (ZIP)...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click('.lnux-dialogo footer button:text-is("Baixar pelo navegador")')]);
    const zipado = fs.readFileSync(await baixado.path()).toString("latin1");
    ok(/"esqueleto": \{\s*"bracos": 20/.test(zipado), "exportar a personagem leva o ajuste do esqueleto junto (companhia.json)");
    ok(consola.length === 0, "parte 1 sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));

    // ════ Parte 2: modelo de exemplo da pixiv (VRM 1.0, com rosto) ════
    const vrm = process.env.LNUX_TESTE_VRM || path.join(PASTA, "exemplo-pixiv.vrm");
    if (!(process.env.LNUX_TESTE_VRM || await baixar(URL_VRM, vrm))) pular("Parte 2 pulada: não deu para baixar o modelo de exemplo da pixiv (use LNUX_TESTE_VRM=/caminho/modelo.vrm).");
    else {
      await ev(() => window.Companhia.estudio.abrirMapaGuardado("")); // sem cenário
      await importarPersonagem(vrm);
      c = await corpo();
      ok(c.v0 === false && c.leftHand[1] < c.leftUpperArm[1] - 0.15 && c.rightHand[1] < c.rightUpperArm[1] - 0.15 && c.leftHand[0] > 0.1, "VRM 1.0: braços para baixo em descanso, como antes");
      await simular({ corpo: corpoDeMentira({ bracoE: "cima" }), rosto: rostoDeMentira() }, { espelhar: false });
      await assentar();
      c = await corpo();
      const rosto = await ev(() => { const p = window.Companhia.palco, m = p.morfos.get("Fcl_MTH_Fun");
        return { piscaE: p.expressao("blinkLeft"), piscaD: p.expressao("blinkRight"), aa: p.expressao("aa"), happy: p.expressao("happy"), sorriso: m ? m[0][0].morphTargetInfluences[m[0][1]] : null, olhar: p.rastreado && p.rastreado.olhar }; });
      ok(c.leftHand[1] > c.head[1] && rosto.piscaE > 0.8 && rosto.piscaD < 0.2 && rosto.aa > 0.15, `VRM 1.0, captura: braço esquerdo no alto, olho esquerdo fechado e boca aberta (blinkLeft ${rosto.piscaE.toFixed(2)}, aa ${rosto.aa.toFixed(2)})`);
      ok(rosto.sorriso > 0.3 && rosto.happy < 0.1, `o sorriso vai para as formas do rosto do VRoid (boca: ${rosto.sorriso === null ? "?" : rosto.sorriso.toFixed(2)}), sem fechar os olhos como o "happy" (${rosto.happy.toFixed(2)})`);
      ok(c.frente[0] > 0.25 && rosto.olhar && rosto.olhar.x > 0.1, `a cabeça e os olhos viram para o lado para onde a pessoa virou (frente x = ${c.frente[0].toFixed(2)})`);
      await simular({ rosto: rostoDeMentira() }, { espelhar: true });
      await assentar();
      c = await corpo();
      const espelho = await ev(() => { const p = window.Companhia.palco; return { piscaE: p.expressao("blinkLeft"), piscaD: p.expressao("blinkRight") }; });
      ok(c.frente[0] < -0.25 && espelho.piscaD > 0.8 && espelho.piscaE < 0.2, "com o espelho, o rosto também troca de lado (pisca o olho direito, a cabeça vira para o outro lado)");
      await pararSimulacao();
      await esperar(800);
      ok(await ev(() => { const p = window.Companhia.palco, m = p.morfos.get("Fcl_MTH_Fun"); return m[0][0].morphTargetInfluences[m[0][1]] === 0; }), "captura desligada: as formas do rosto voltam a zero");
      const vrma = path.join(PASTA, "exemplo-pixiv.vrma");
      if (!(await baixar(URL_VRMA, vrma))) pular(".vrma de exemplo não baixou: o teste do VRM Animation foi pulado.");
      else {
        await menu("Movimento", "Pacotes de movimento...");
        await pagina.waitForSelector(".painel-estudio");
        await pagina.click('.painel-estudio button:text-is("Importar...")');
        await escolherArquivo(vrma);
        await pagina.waitForSelector('.linha-movimento:has-text("exemplo-pixiv")', { timeout: 30000 });
        const novo = await ev(async () => (await C.movimentos.lista()).find((x) => x.tipo === "vrma"));
        ok(!!novo && novo.duracao > 0.5, `VRM Animation (.vrma) importado pela tela: ${novo && novo.duracao} s`);
        const r = { novos: [[novo.id]] };
        const mexeu = await ev(async (id) => {
          const p = window.Companhia.palco, clip = await C.movimentos.clip(id), q0 = {};
          for (const n of C.OSSOS_VRM) if (p.nos[n]) q0[n] = p.nos[n].quaternion.clone();
          p.tocarMovimento(clip, { transicao: 0, info: { tipo: "movimento", id } });
          let maior = 0;
          const t0 = performance.now();
          while (performance.now() - t0 < 2500) { await new Promise((r) => requestAnimationFrame(r)); for (const n of Object.keys(q0)) maior = Math.max(maior, p.nos[n].quaternion.angleTo(q0[n])); }
          p.pararMovimento(0);
          return { maior, ossos: clip.tracks.length };
        }, r.novos[0][0]);
        ok(mexeu.maior > 0.3, `o .vrma toca na personagem (um osso girou ${mexeu.maior.toFixed(2)} rad)`);
      }
      ok(consola.length === 0, "parte 2 sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
    }
    await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-4.png") });
    await navegador.close();

    // ════ Parte 3: captura de verdade, com uma foto no lugar da câmera ════
    const foto = path.join(PASTA, "pose-mediapipe.jpg"), video = path.join(PASTA, "camera-de-mentira.y4m");
    let motivo = process.env.LNUX_TESTE_SEM_CAMERA ? "LNUX_TESTE_SEM_CAMERA" : "";
    if (!motivo && !(await baixar(URL_FOTO, foto))) motivo = "não deu para baixar a foto de exemplo do MediaPipe";
    if (!motivo) {
      try { execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-i", foto, "-t", "2", "-r", "15", "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=gray,format=yuv420p", video]); }
      catch (e) { motivo = "o ffmpeg não montou o vídeo da câmera de mentira"; }
    }
    if (motivo) pular(`Parte 3 (câmera) pulada: ${motivo}.`);
    else {
      ({ navegador, pagina, consola } = await abrirNavegador(["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`]));
      ev = (f, a) => pagina.evaluate(f, a);
      esperar = (ms) => pagina.waitForTimeout(ms);
      await importarPersonagem(boneco);
      const ligou = await ev(async () => {
        const c = window.Companhia.captura;
        Object.assign(c.cfg, { rosto: false, maos: false, corpo: true, pernas: true, espelhar: false, modeloCorpo: "lite", delegado: "cpu", previa: true, suavizar: 0.2 });
        try { await c.ligar(); return { ok: true, delegado: c.medida.delegado }; } catch (e) { return { ok: false, erro: e.message }; }
      });
      if (!ligou.ok && /baixar|internet/i.test(ligou.erro)) pular("Parte 3 (câmera) pulada: sem internet para os arquivos do rastreamento: " + ligou.erro);
      else {
        ok(ligou.ok && ligou.delegado && ligou.delegado.corpo, "captura ligada com a câmera (de mentira): a ponte entregou os arquivos do MediaPipe e o rastreador subiu no Worker" + (ligou.ok ? ` (${ligou.delegado.corpo})` : ": " + ligou.erro));
        if (ligou.ok) {
          await pagina.waitForFunction(() => window.Companhia.captura.achados && window.Companhia.captura.achados.corpo, null, { timeout: 120000 });
          ok(await ev(() => !!document.querySelector(".captura-previa video") && document.querySelector(".captura-previa video").videoWidth > 0), "a janelinha mostra a câmera, com os pontos achados por cima");
          const guardados = await ev(() => LNUX.ponte.pedir("GET", "mediapipe"));
          ok(guardados.arquivos["vision_wasm_internal.wasm"] > 1e6 && guardados.arquivos["pose_landmarker_lite.task"] > 1e6 && guardados.arquivos["face_landmarker.task"] === null,
            "a ponte guardou no aparelho só o que foi usado (o WebAssembly e o modelo do corpo)");
          // a foto: de pé, braços abertos na horizontal → a personagem abre os braços
          await pagina.waitForFunction(() => { const p = window.Companhia.palco, y = (n) => p.posicao(n).y, x = (n) => p.posicao(n).x;
            return Math.abs(y("leftHand") - y("leftUpperArm")) < 0.16 && Math.abs(y("rightHand") - y("rightUpperArm")) < 0.16 && x("leftHand") > 0.45 && x("rightHand") < -0.45; }, null, { timeout: 120000 });
          ok(true, "a personagem copia a pose da foto: os dois braços abertos na horizontal");
          const pernas = await ev(() => { const p = window.Companhia.palco; return Math.abs(p.posicao("leftFoot").x - p.posicao("rightFoot").x); });
          ok(pernas > 0.35, `e as pernas afastadas, como na foto (pés a ${pernas.toFixed(2)} m um do outro)`);
          await ev(() => window.Companhia.estudio.alternarCaptura(false));
          ok(await ev(() => !document.querySelector(".captura-previa") && !window.Companhia.captura.ligada), "desligar a captura fecha a câmera");
        }
        ok(consola.length === 0, "parte 3 sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
      }
      await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-5.png") });
    }
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-corpo-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close().catch(() => {});
  }
  console.log(`\nCompanhia (movimento): ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
