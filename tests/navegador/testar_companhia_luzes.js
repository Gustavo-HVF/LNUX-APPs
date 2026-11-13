// Teste das luzes do cenário da Companhia (as luzes do mapa e a luz calculada por raios), com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_luzes
//
// Não baixa nada. Usa uma casa de teste fechada com uma lâmpada que brilha no teto (com uma mesa embaixo), uma luz
// que vem no arquivo (KHR_lights_punctual) e uma vela (achada pelo nome). Cobre: achar as três; acender em tempo real
// as mais perto (no máximo quantas a pessoa escolheu); apagar uma pela lista e pôr uma à mão (guardado no cenário e
// vindo do dono da sala); a hora do dia, a exposição e o tom; a luz calculada por raios (a sombra da mesa embaixo
// da lâmpada, o canto mais escuro, o mapa pintado e mais leve, a lâmpada continuando a brilhar); o guardado (abrir de
// novo é na hora); tirar; e a conversão para .glb mantendo as lâmpadas do arquivo.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { bonecoVRM0, casaComLuzes } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const boneco = path.join(PASTA, "boneco-vrm0.vrm");
  fs.writeFileSync(boneco, bonecoVRM0());
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 } });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const casa = casaComLuzes().toString("base64");
  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined, null, { timeout: 20000 });
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(boneco);
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });
    const id = await ev(async (b64) => {
      const l = window.Companhia.palco.mundo.luzes;
      l.definir({ ligadas: true, forca: 1, alcance: 1, juntas: 8, sombras: 0, nomes: true, raios: { qualidade: "rapida", suave: 2, ceu: true, rebatida: 0.7, sozinho: false } });
      window.Companhia.palco.definirLuz({ realista: true, sombras: true });
      const reg = await C.mapas.guardar("Casa com luzes", new Map([["casa.glb", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]]), "casa.glb");
      await window.Companhia.estudio.abrirMapaGuardado(reg.id);
      window.Companhia.estudio.alternarAndar(true);
      return reg.id;
    }, casa);

    // ── achar as luzes ──
    const achadas = await ev(() => window.Companhia.palco.mundo.luzes.fontes.map((f) => ({ tipo: f.tipo, nome: f.nome, pos: f.pos.toArray(), cor: "#" + f.cor.getHexString() })));
    const tipo = (t) => achadas.find((f) => f.tipo === t);
    const perto = (a, b, d = 0.3) => a && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;
    ok(achadas.length === 3 && perto(tipo("brilho").pos, [-3, 3.05, 0], 0.2), `a lâmpada que brilha no teto vira uma luz (no lugar dela, ${tipo("brilho") && tipo("brilho").cor})`);
    ok(tipo("arquivo") && perto(tipo("arquivo").pos, [3, 2.6, 0], 0.05) && tipo("arquivo").nome === "Luz", "a luz que veio no arquivo (KHR_lights_punctual) também");
    ok(tipo("nome") && perto(tipo("nome").pos, [1.05, 0.32, -3.95], 0.1) && tipo("nome").cor === "#ff9a40", "e a vela, pelo nome da peça (\"Vela_01\"), com a cor de chama");
    // em tempo real
    await pagina.waitForTimeout(1200);
    let acesas = await ev(() => { const c = []; window.Companhia.palco.cena.traverse((o) => { if (o.isPointLight && o.userData.daCompanhia) c.push(o.intensity); }); return { total: c.length, acesas: c.filter((i) => i > 0.5).length, doArquivo: (() => { let n = 0; window.Companhia.palco.mundo.mapa.traverse((o) => { if (o.isLight) n++; }); return n; })() }; });
    ok(acesas.total === 8 && acesas.acesas === 3 && acesas.doArquivo === 0, `em tempo real: 3 luzes acesas no conjunto de 8 (a luz do arquivo saiu do mapa: quem acende é o conjunto)`);
    await ev(() => window.Companhia.palco.mundo.luzes.definir({ juntas: 2 }));
    await pagina.waitForTimeout(1200);
    acesas = await ev(() => { const c = []; window.Companhia.palco.cena.traverse((o) => { if (o.isPointLight && o.userData.daCompanhia) c.push(o.intensity); }); return { total: c.length, acesas: c.filter((i) => i > 0.5).length }; });
    ok(acesas.total === 2 && acesas.acesas === 2, "\"Acesas ao mesmo tempo: 2\": só as 2 mais importantes ficam acesas");
    await ev(() => window.Companhia.palco.mundo.luzes.definir({ juntas: 8 }));

    // ── o painel: hora do dia, tom, apagar uma, pôr uma ──
    await menu("Movimento", "Cenário (mapa)...");
    await pagina.waitForSelector(".painel-luz .resumo-luzes");
    ok(/Achei 3 luzes: 1 do arquivo, 1 que brilham, 1 pelo nome/.test(await ev(() => document.querySelector(".painel-luz .resumo-luzes").textContent)), "o painel conta as luzes achadas e de onde vieram");
    await pagina.click('.horas-luz [data-hora="noite"]');
    await pagina.click(".painel-luz .luz-avancado summary");
    await pagina.selectOption('.painel-luz select[aria-label="Tom das cores"]', "aces");
    await pagina.waitForTimeout(300);
    const luz = await ev(() => { const p = window.Companhia.palco; return { exp: p.renderer.toneMappingExposure, tom: p.renderer.toneMapping === THREE.ACESFilmicToneMapping, sol: p.luz.intensity, ceu: p.luzCeu.intensity, cfg: p.luzCfg.hora }; });
    ok(luz.cfg === "noite" && luz.exp === 1.4 && luz.sol < 0.3 && luz.ceu < 0.2 && luz.tom, `"🌙 Noite": sol e céu fracos (${luz.sol.toFixed(2)} / ${luz.ceu.toFixed(2)}), exposição 1,4; o tom "Cinema (ACES)" vale`);
    await pagina.click(".painel-luz .luz-lista summary");
    await pagina.uncheck('.painel-luz .luz-item[data-tipo="nome"] input[type="checkbox"]');
    let estado = await ev(() => { const m = window.Companhia.palco.mundo; return { vela: m.luzes.fontes.find((f) => f.tipo === "nome").ligada, desligadas: m.info.ajuste.luzesDesligadas }; });
    ok(!estado.vela && estado.desligadas.length === 1 && /^nome:/.test(estado.desligadas[0]), "apagar a vela pela lista (fica guardado no ajuste do cenário)");
    await pagina.click('.painel-luz button:text-is("📍 Pôr uma luz aqui")');
    await pagina.waitForTimeout(700);
    estado = await ev(async (id) => { const m = window.Companhia.palco.mundo, g = (await C.mapas.lista()).find((x) => x.id === id); return { minhas: m.luzes.fontes.filter((f) => f.tipo === "minha").length, guardada: (g.ajuste.luzes || []).length, desligadas: (g.ajuste.luzesDesligadas || []).length }; }, id);
    ok(estado.minhas === 1 && estado.guardada === 1 && estado.desligadas === 1, "\"📍 Pôr uma luz aqui\": uma luz nova onde a personagem está, guardada com o cenário");
    // o dono da sala muda as luzes: chega por trocarAjuste (o mesmo caminho do ajuste da sala)
    const veioDaSala = await ev(() => { const m = window.Companhia.palco.mundo, a = JSON.parse(JSON.stringify(m.info.ajuste)); a.luzes.push({ p: [0, 2, 3], cor: "#88ccff", forca: 2 }); a.luzesDesligadas = []; m.trocarAjuste(a);
      return { minhas: m.luzes.fontes.filter((f) => f.tipo === "minha").length, vela: m.luzes.fontes.find((f) => f.tipo === "nome").ligada }; });
    ok(veioDaSala.minhas === 2 && veioDaSala.vela, "as luzes que o dono da sala põe ou acende chegam com o ajuste do cenário");
    // volta ao começo (sem as minhas, com a vela acesa) e grava no cenário: o guardado da luz calculada vale para este estado
    await ev(async (id) => { const m = window.Companhia.palco.mundo, a = JSON.parse(JSON.stringify(m.info.ajuste)); a.luzes = []; a.luzesDesligadas = []; m.trocarAjuste(a); await C.mapas.atualizar({ id, ajuste: m.info.ajuste }); }, id);

    // ── luz calculada por raios ──
    await pagina.click('.painel-luz button.calcular-luz');
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.luzes.assado, null, { timeout: 180000 });
    const calc = await ev(() => {
      const m = window.Companhia.palco.mundo, l = m.luzes, T = THREE;
      // a luz pintada em cada ponto do chão (o tampo da mesa faz sombra embaixo da lâmpada)
      let casa = null, lampada = null;
      m.mapa.traverse((o) => { if (o.isMesh && o.name === "Casa") casa = o; if (o.isMesh && o.name === "Lampada_do_teto") lampada = o; });
      const P = casa.geometry.attributes.position, Cr = casa.geometry.attributes.color, v = new T.Vector3();
      const media = (filtro) => { let s = 0, n = 0; for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(casa.matrixWorld); if (filtro(v)) { s += Cr.getX(i) + Cr.getY(i) + Cr.getZ(i); n++; } } return n ? s / n : NaN; };
      const chao = (x, z, r) => (p) => Math.abs(p.y - 0.2) < 0.01 && Math.hypot(p.x - x, p.z - z) < r;
      return {
        assado: l.assado, raios: l.calculo.raios, vertices: l.calculo.vertices, basico: casa.material.isMeshBasicMaterial && casa.material.vertexColors, original: !!casa.userData.luzOriginal,
        lampada: lampada.material.isMeshStandardMaterial && lampada.material.emissiveIntensity > 0,
        sobMesa: media(chao(-3, 0, 0.35)), aoLado: media(chao(-3, 1.6, 0.35)), canto: media((p) => Math.abs(p.y - 0.2) < 0.01 && Math.abs(p.x) > 5.5 && Math.abs(p.z) > 5.5),
        meio: media(chao(0, 0, 1)), sombra: m.sombra.material.opacity,
        estado: document.querySelector(".painel-luz .estado-raios").textContent,
      };
    });
    ok(calc.assado && calc.raios > 50000 && calc.basico && calc.original && calc.lampada, `a luz calculada por raios: ${(calc.raios / 1e6).toFixed(2)} milhão de raios, o mapa pintado (material leve, sem luz em tempo real); a lâmpada continua brilhando`);
    ok(calc.sobMesa < calc.aoLado * 0.6, `a mesa faz sombra no chão embaixo da lâmpada (${calc.sobMesa.toFixed(3)} embaixo, ${calc.aoLado.toFixed(3)} ao lado)`);
    ok(calc.canto < calc.meio, `os cantos da casa ficam mais escuros que o meio (${calc.canto.toFixed(3)} / ${calc.meio.toFixed(3)})`);
    ok(calc.sombra === 1 && /milhão de raios/.test(calc.estado), "com a luz calculada, volta a sombra redonda embaixo da personagem; o painel diz quantos raios");
    // o guardado: abrir de novo é na hora
    await ev(() => window.Companhia.palco.mundo.luzes.definir({ raios: { sozinho: true } }));
    await ev(async (id) => { await window.Companhia.estudio.abrirMapaGuardado(id); }, id);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.luzes.assado, null, { timeout: 30000 });
    const guardado = await ev(() => window.Companhia.palco.mundo.luzes.calculo);
    ok(guardado.guardado && guardado.raios === 0 && guardado.segundos < 5, `"Calcular sozinho": abrindo o cenário de novo, a luz calculada guardada volta sem lançar os raios de novo (${guardado.segundos.toFixed(1)} s; ${JSON.stringify({ raios: guardado.raios, tempos: guardado.tempos })})`);
    // mexer no tamanho do mapa: a luz calculada sai (não vale mais)
    await ev(() => { const m = window.Companhia.palco.mundo; m.luzes.definir({ raios: { sozinho: false } }); m.info.ajuste.giro = 90; m.aplicarAjuste(); });
    ok(await ev(() => { let basico = false; window.Companhia.palco.mundo.mapa.traverse((o) => { if (o.isMesh && o.material.isMeshBasicMaterial) basico = true; }); return !window.Companhia.palco.mundo.luzes.assado && !basico; }),
      "girar o mapa tira a luz calculada (o mapa volta à luz em tempo real)");
    await ev(() => { const m = window.Companhia.palco.mundo; m.info.ajuste.giro = 0; m.aplicarAjuste(); });

    // ── a conversão para .glb mantém as lâmpadas do arquivo ──
    const convertido = await ev(async (b64) => {
      await C.prepararVRM();
      const r = await C.conversor.paraGLB(new Map([["casa.glb", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]]), "casa.glb");
      const u = URL.createObjectURL(r.glb), g = await new CompanhiaVRM.GLTFLoader().loadAsync(u);
      URL.revokeObjectURL(u);
      let luzes = 0;
      g.scene.traverse((o) => { if (o.isPointLight) luzes++; });
      return luzes;
    }, casa);
    ok(convertido === 1, "converter um mapa para .glb mantém a lâmpada do arquivo");
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
    await pagina.screenshot({ path: path.join(PASTA, "companhia-luzes.png") });
  } catch (e) {
    erros.push("falhou: " + e.message);
    console.log(e);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-luzes-erro.png") }).catch(() => {});
  }
  if (consola.length) console.log("Console:\n  " + consola.join("\n  "));
  await navegador.close();
  console.log(erros.length ? `\n✖ ${erros.length} falha(s) em companhia_luzes.` : `\n✔ companhia_luzes: ${passos} verificações ok.`);
  process.exit(erros.length ? 1 : 0);
})();
