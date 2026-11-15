// Teste da IK das pernas (os pés se adaptam ao chão), no Chromium. Rode com: python3 tests/testar_navegador.py companhia_ik
//
// Monta um cenário com um piso (topo em y = 0,2), um degrau de 15 cm (x > 0) e uma rampa de 20° (z > 3), abre o boneco
// VRM 0.x de teste, anda pelo cenário e põe a personagem com um pé em cima do degrau e o outro no piso. Confere: com a
// IK, cada pé fica no chão dele (a mesma altura acima do chão que no piso plano), o quadril desce e o joelho do pé de
// cima dobra; sem a IK (Opções › Controle), um pé fica no ar. Na rampa, o pé inclina junto com o chão.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { glb, gltfDeMalha, caixas, bonecoVRM0 } = require("./companhia_arquivos.js");
const { menus } = require("./companhia_menus.js");

const BASE = process.env.LNUX_TESTE_BASE, TOKEN = process.env.LNUX_TESTE_TOKEN;
const PASTA = process.env.LNUX_TESTE_SAIDA || require("os").tmpdir();
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|cubism|live2d/i;
let passos = 0;
const erros = [];
const ok = (cond, texto) => { if (cond) { passos++; console.log("  ✔ " + texto); } else { erros.push(texto); console.log("  ✖ " + texto); } };

/** O cenário: piso, degrau e rampa (a rampa sobe 20° no sentido +Z, a partir de z = 3). */
function cenarioDaIk() {
  const m = caixas([[-6, 0, -6, 6, 0.2, 6], [0, 0.2, -6, 6, 0.35, 2]]);
  // a rampa: um plano inclinado de x -6..-1, z 3..6
  const ang = (20 * Math.PI) / 180, y0 = 0.2, n = m.posicoes.length / 3;
  const extra = [[-6, y0, 3], [-1, y0, 3], [-1, y0 + 3 * Math.tan(ang), 6], [-6, y0 + 3 * Math.tan(ang), 6]];
  const pos = new Float32Array(m.posicoes.length + 12);
  pos.set(m.posicoes);
  extra.forEach((p, i) => pos.set(p, m.posicoes.length + i * 3));
  const idx = new Uint16Array(m.indices.length + 12);
  idx.set(m.indices);
  idx.set([n, n + 2, n + 1, n, n + 3, n + 2, n, n + 1, n + 2, n, n + 2, n + 3], m.indices.length); // os dois lados
  const malha = { posicoes: pos, indices: idx, min: [-6, 0, -6], max: [6, Math.max(0.35, y0 + 3 * Math.tan(ang)), 6] };
  const { json, bin } = gltfDeMalha(malha, { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Chao", mesh: 0 }] });
  return glb(json, bin);
}

(async () => {
  const boneco = path.join(PASTA, "boneco-ik.vrm"), mapa = path.join(PASTA, "cenario-ik.glb");
  fs.writeFileSync(boneco, bonecoVRM0());
  fs.writeFileSync(mapa, cenarioDaIk());
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1000, height: 700 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const { menu } = menus(pagina);
  const escolherArquivo = async (arquivo) => {
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arquivo);
  };
  /** Põe a personagem num lugar (x, z), olhando para +Z, e espera ela assentar e a IK suavizar. */
  const por = async (x, z) => {
    await ev(([x, z]) => {
      const p = window.Companhia.palco, m = p.mundo;
      m.rumo = 0; p.raiz.rotation.y = 0;
      p.raiz.position.set(x, 1.2, z);
      m.vel.set(0, 0, 0);
    }, [x, z]);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.noChao, null, { timeout: 20000 });
    await esperar(2500);
  };
  /** As medidas: os pés (altura acima do chão sob cada um), o quadril e a inclinação do pé esquerdo. */
  const medir = () => ev(() => {
    const p = window.Companhia.palco, m = p.mundo, T = window.THREE;
    const chao = (v) => { const t = m.colisor.geometry.boundsTree.raycastFirst(new T.Ray(new T.Vector3(v.x, v.y + 1, v.z), new T.Vector3(0, -1, 0)), T.DoubleSide); return t ? t.point.y : NaN; };
    const pe = (n) => { const o = p.vrm.humanoid.getRawBoneNode(n), v = o.getWorldPosition(new T.Vector3()); return { x: v.x, y: v.y, acima: v.y - chao(v), cima: new T.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new T.Quaternion())) }; };
    const e = pe("leftFoot"), d = pe("rightFoot"), q = p.vrm.humanoid.getRawBoneNode("hips").getWorldPosition(new T.Vector3());
    const joelho = (lado) => { const a = p.vrm.humanoid.getRawBoneNode(lado + "UpperLeg").getWorldPosition(new T.Vector3()), b = p.vrm.humanoid.getRawBoneNode(lado + "LowerLeg").getWorldPosition(new T.Vector3()), c = p.vrm.humanoid.getRawBoneNode(lado + "Foot").getWorldPosition(new T.Vector3()); return (a.clone().sub(b).angleTo(c.clone().sub(b)) * 180) / Math.PI; };
    return { esq: { x: e.x, acima: e.acima, cima: e.cima.toArray() }, dir: { x: d.x, acima: d.acima, cima: d.cima.toArray() }, quadril: q.y - p.raiz.position.y, raiz: p.raiz.position.y,
      joelhoE: joelho("left"), joelhoD: joelho("right"), ik: p.ik ? { dy: p.ik.dy, quadril: p.ik.quadril } : null };
  });
  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined, null, { timeout: 30000 });
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await escolherArquivo(boneco);
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });
    await pagina.waitForFunction(() => !window.Companhia.palco.gestos.length, null, { timeout: 30000 });
    await ev(() => window.Companhia.palco.definirEmocao("neutra"));
    await menu("Movimento", "Cenário (mapa)...");
    await pagina.waitForSelector('.painel-estudio:has-text("Cenário")');
    await pagina.click('.painel-estudio button:text-is("Abrir cenário...")');
    await escolherArquivo(mapa);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.info && window.Companhia.palco.mundo.colisor, null, { timeout: 30000 });
    await pagina.click('.painel-estudio button:text-is("Andar pelo cenário")');
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.andando, null, { timeout: 5000 });

    // ── no piso plano: a medida de base (a altura do tornozelo acima do chão) ──
    await por(-3, -3);
    const plano = await medir();
    ok(Math.abs(plano.esq.acima - plano.dir.acima) < 0.02 && plano.esq.acima > -0.01 && plano.ik && Math.abs(plano.ik.quadril) < 0.01,
      `no piso plano, os dois pés na mesma altura (${plano.esq.acima.toFixed(3)} e ${plano.dir.acima.toFixed(3)} m acima do chão) e o quadril no lugar`);
    // ── um pé no degrau (x > 0) e o outro no piso ──
    // os pés ficam dos dois lados de x = 0: a personagem fica no meio, na beirada do degrau
    await por(0, -3);
    const degrau = await medir();
    const alto = degrau.esq.x > degrau.dir.x ? degrau.esq : degrau.dir, baixo = alto === degrau.esq ? degrau.dir : degrau.esq;
    const joelhoAlto = alto === degrau.esq ? degrau.joelhoE : degrau.joelhoD, joelhoBaixo = alto === degrau.esq ? degrau.joelhoD : degrau.joelhoE;
    const base = plano.esq.acima;
    ok(alto.x > 0 && baixo.x < 0, `a personagem fica com um pé sobre o degrau (x = ${alto.x.toFixed(2)}) e o outro sobre o piso (x = ${baixo.x.toFixed(2)})`);
    ok(Math.abs(alto.acima - base) < 0.025 && Math.abs(baixo.acima - base) < 0.025,
      `com a IK, cada pé pisa no chão dele: ${alto.acima.toFixed(3)} m (degrau) e ${baixo.acima.toFixed(3)} m (piso) acima do chão, como no plano (${base.toFixed(3)})`);
    ok(joelhoAlto < joelhoBaixo - 8, `o joelho da perna de cima dobra (${joelhoAlto.toFixed(0)}° contra ${joelhoBaixo.toFixed(0)}° da outra)`);
    ok(degrau.ik && degrau.ik.quadril <= 0, `o quadril desce o quanto o pé de baixo precisa (${degrau.ik ? degrau.ik.quadril.toFixed(3) : "?"} m)`);
    // ── sem a IK: um pé fica no ar (ou entra no chão) ──
    await ev(() => { window.Companhia.palco.mundo.cfg.ik = false; });
    await esperar(1500);
    const sem = await medir();
    const semAlto = sem.esq.x > sem.dir.x ? sem.esq : sem.dir, semBaixo = semAlto === sem.esq ? sem.dir : sem.esq;
    ok(Math.abs(semAlto.acima - base) > 0.05 || Math.abs(semBaixo.acima - base) > 0.05,
      `sem a IK (Opções › Controle), um pé fica fora do chão: ${semAlto.acima.toFixed(3)} e ${semBaixo.acima.toFixed(3)} m`);
    await ev(() => { window.Companhia.palco.mundo.cfg.ik = true; });
    // ── na rampa de 20°: os pés inclinam com o chão ──
    await por(-3.5, 4.5);
    const rampa = await medir();
    const angulo = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
    const inclinou = angulo(rampa.esq.cima, plano.esq.cima);
    ok(inclinou > 12 && inclinou < 28 && Math.abs(rampa.esq.acima - base) < 0.04 && Math.abs(rampa.dir.acima - base) < 0.04,
      `na rampa de 20°, o pé inclina com o chão (${inclinou.toFixed(0)}°) e os dois pisam nela (${rampa.esq.acima.toFixed(3)} e ${rampa.dir.acima.toFixed(3)} m)`);
    // ── a opção está em Opções › Controle ──
    ok(await ev(() => !!window.C.ikDosPes), "a IK está carregada (js/ik.js)");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-ik.png") });
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
  } finally {
    await navegador.close();
  }
  console.log(`\nIK das pernas: ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
