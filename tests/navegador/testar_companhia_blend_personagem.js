// Teste das personagens do Blender (.blend → .vrm), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_blend_personagem
//
// Usa as personagens de tests/dados (geradas por gerar_personagem_blend.py, com o Blender 5.3): um boneco de caixas em
// pose em A, com a armadura de pessoa, os grupos de vértices, duas formas no rosto (vrc.blink e vrc.v_aa) e a textura
// num shader Diffuse; e a mesma sem a armadura (só os grupos, como muitos modelos do Sketchfab). Cobre: o esqueleto da
// armadura e o refeito pelos grupos (as juntas no mesmo lugar), o resumo da conversão (ossos, pose em T, expressões,
// textura), a personagem aberta pelo menu (de pé, braços para baixo, piscando) e um .blend sem pesos (a mensagem).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const DADOS = path.join(__dirname, "..", "dados");
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  for (const nome of ["personagem-blender-5.3.blend", "personagem-sem-armadura-5.3.blend", "cenario-blender-5.3.blend"])
    await contexto.route("**/dados-de-teste/" + nome, (r) => r.fulfill({ status: 200, body: fs.readFileSync(path.join(DADOS, nome)), contentType: "application/octet-stream" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.C && C.avatar && C.conversor && window.Companhia, null, { timeout: 30000 });

    // ── o esqueleto: o da armadura e o refeito pelos grupos ficam no mesmo lugar ──
    const esq = await ev(async () => {
      await C.prepararVRM();
      const ler = async (nome) => {
        let d = new Uint8Array(await (await fetch("/dados-de-teste/" + nome)).arrayBuffer());
        const z = new CompanhiaVRM.ZSTDDecoder(); await z.init(); d = z.decode(d);
        const b = C.blend.ler(d), o = b.objetos[0];
        return { b, o, e: C.esqueletoDoBlend(b, o, b.malhas[o.malha]) };
      };
      const com = await ler("personagem-blender-5.3.blend"), sem = await ler("personagem-sem-armadura-5.3.blend");
      const pos = (r, n) => r.e.ossos.find((x) => x.nome === n).pos;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const juntas = ["Spine", "Neck", "UpperArm_L", "LowerArm_L", "Hand_R", "LowerLeg_L", "Foot_R"].map((n) => [n, dist(pos(com, n), pos(sem, n))]);
      const pai = (r, n) => { const x = r.e.ossos.find((o) => o.nome === n); return x.pai >= 0 ? r.e.ossos[x.pai].nome : null; };
      return { comoCom: com.e.como, comoSem: sem.e.como, armaduras: com.b.armaduras.length, ossos: com.e.ossos.length, ossosSem: sem.e.ossos.length, juntas,
        formas: com.b.malhas[0].formas.map((f) => f.nome), textura: com.b.materiais[0].imagem !== null,
        pais: ["Hand_L", "LowerLeg_R", "Neck", "Shoulder_L", "Spine"].map((n) => pai(sem, n)).join() };
    });
    ok(esq.armaduras === 1 && esq.comoCom === "armadura" && esq.ossos === 19, `o .blend com armadura: ${esq.ossos} ossos lidos da armadura`);
    ok(esq.comoSem === "grupos" && esq.ossosSem === 19 && esq.pais === "LowerArm_L,UpperLeg_R,Chest,Chest,Hips", `sem a armadura, o esqueleto é refeito pelos grupos de vértices, com a hierarquia de pessoa (${esq.pais})`);
    ok(esq.juntas.every(([, d]) => d < 0.05), "as juntas refeitas ficam a menos de 5 cm das da armadura: " + esq.juntas.map(([n, d]) => `${n} ${Math.round(d * 100)} cm`).join(", "));
    ok(esq.formas.join() === "vrc.blink,vrc.v_aa" && esq.textura, "as formas do rosto (shape keys) e a textura ligada num shader Diffuse (não no Principled) são lidas");

    // ── a conversão para .vrm (as duas) ──
    for (const [nome, refeito] of [["personagem-blender-5.3.blend", false], ["personagem-sem-armadura-5.3.blend", true]]) {
      const r = await ev(async ([n]) => {
        const blob = await (await fetch("/dados-de-teste/" + n)).blob();
        try { const r = await C.avatar.paraVRM(new Map([[n, blob]]), n, { nome: "Boneco" }); return { resumo: r.resumo, avisos: r.avisos, tam: r.vrm.size }; }
        catch (e) { return { erro: e.message }; }
      }, [nome]);
      const x = r.resumo || {};
      ok(!r.erro && x.ossos >= 15 && x.poseEmT > 20 && x.altura > 1.6 && x.altura < 1.9 && x.expressoes.includes("blink") && x.expressoes.includes("aa") && x.comTextura === 1,
        `${nome}: vira .vrm — ${x.ossos} ossos ${x.comoMapeou}, braços em A postos na pose em T (${x.poseEmT}°), ${x.altura} m, expressões ${(x.expressoes || []).join(", ")}, textura` + (r.erro ? " — " + r.erro : ""));
      ok(refeito === (r.avisos || []).some((a) => /refeito pelos grupos/.test(a)), refeito ? "e avisa que o esqueleto foi refeito pelos grupos" : "sem o aviso de esqueleto refeito (veio a armadura)");
    }

    // ── pelo menu: a personagem aberta, de pé, com os braços para baixo, piscando ──
    fs.writeFileSync(path.join(PASTA, "boneco.blend"), fs.readFileSync(path.join(DADOS, "personagem-sem-armadura-5.3.blend")));
    await pagina.click('.lnux-menubar > button:text-is("Personagem")');
    await pagina.click('.lnux-menu button:has(.rotulo:text-is("Importar avatar do Unity ou do Blender (.unitypackage, .fbx, .blend)..."))');
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(path.join(PASTA, "boneco.blend"));
    await pagina.waitForSelector("#avatar-convertido", { timeout: 120000 });
    await pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Importar")');
    await pagina.waitForFunction(() => { const c = window.Companhia; return c.atual && c.atual.nome === "boneco" && c.palco.modelo && c.pronto; }, null, { timeout: 120000 });
    await pagina.waitForTimeout(1500);
    const aberta = await ev(() => {
      const p = window.Companhia.palco, pos = (n) => { const v = p.posicao(n); return [v.x, v.y - p.raiz.position.y, v.z]; };
      const em = p.vrm.expressionManager;
      em.setValue("blink", 1); p.vrm.update(0);
      return { v0: p.v0, mao: pos("leftHand"), ombro: pos("leftUpperArm"), pe: Math.min(pos("leftFoot")[1], pos("rightFoot")[1]), cabeca: pos("head")[1], piscar: em.getValue("blink") };
    });
    await pagina.screenshot({ path: path.join(PASTA, "companhia-blend-personagem.png") });
    ok(aberta.v0 === false && aberta.mao[1] < aberta.ombro[1] - 0.15 && aberta.mao[0] > 0.05 && aberta.pe < 0.15 && aberta.cabeca > 1.3 && aberta.piscar === 1,
      `pelo menu (Personagem › Importar avatar do Unity ou do Blender), a personagem abre de pé, com os braços para baixo e piscando (mão ${(aberta.ombro[1] - aberta.mao[1]).toFixed(2)} m abaixo do ombro)`);

    // ── um .blend sem esqueleto nem grupos (um cenário): a mensagem diz o que fazer ──
    const semRig = await ev(async () => {
      const blob = await (await fetch("/dados-de-teste/cenario-blender-5.3.blend")).blob();
      try { await C.avatar.paraVRM(new Map([["cenario.blend", blob]]), "cenario.blend"); return "converteu"; } catch (e) { return e.message; }
    });
    ok(/não tem esqueleto/.test(semRig) && /Com pesos automáticos/.test(semRig), "um .blend sem armadura nem grupos de vértices explica como fazer o rig no Blender");
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
