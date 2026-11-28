// Teste do conversor de avatares: os ossos escolhidos à mão, os materiais como a cena do Unity põe, os shaders (do
// pacote e da biblioteca) e as outras versões de pele virando variações. Mais a opacidade do menu e o céu do cenário
// (que não muda com o tema). No Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_avatar_extras
//
// Não baixa nada: o avatar é o de tests/navegador/companhia_arquivos.js (avatarFBX), num pacote montado aqui com um
// "Poiyomi Toon" travado (só o nome e as propriedades), três peles ("Pele", "Pele 1", "Pele 2") e a cena que põe a
// "Pele 1" no corpo.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { avatarFBX, unityPackage, png } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };
const g = (n) => n.toString(16).padStart(32, "0");

const SHADER_POIYOMI = `Shader "Hidden/Locked/.poiyomi/Poiyomi Toon/0a1b2c3d4e5f60718293a4b5c6d7e8f9"
{
	Properties
	{
		_Color ("Color", Color) = (1,1,1,1)
		_MainTex ("Texture", 2D) = "white" {}
		[ToggleUI] _EnableRimLighting ("Rim", Float) = 0
		_RimLightColor ("Rim Color", Color) = (1,1,1,1)
		_RimWidth ("Rim Width", Range(0, 1)) = 0.8
		[ToggleUI] _EnableOutlines ("Outlines", Float) = 0
		_LineWidth ("Outline Width", Float) = 0
		_LineColor ("Outline Color", Color) = (0,0,0,1)
		_ShadowColor ("Shadow Color", Color) = (0.7,0.75,0.85,1)
	}
	SubShader { Pass { CGPROGRAM ENDCG } }
}
`;
const mat = (nome, { tex = {}, num = {}, cor = {}, shader }) => `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!21 &2100000\nMaterial:\n  serializedVersion: 8\n  m_Name: ${nome}\n` +
  `  m_Shader: ${shader}\n  m_CustomRenderQueue: -1\n  stringTagMap:\n    RenderType: Opaque\n  m_SavedProperties:\n    serializedVersion: 3\n    m_TexEnvs:\n` +
  Object.entries(tex).map(([k, v]) => `    - ${k}:\n        m_Texture: {fileID: 2800000, guid: ${v}, type: 3}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}\n`).join("") + "    m_Floats:\n" +
  Object.entries(num).map(([k, v]) => `    - ${k}: ${v}\n`).join("") + "    m_Colors:\n" + Object.entries(cor).map(([k, v]) => `    - ${k}: {r: ${v[0]}, g: ${v[1]}, b: ${v[2]}, a: ${v[3]}}\n`).join("");

/** O pacote: o .fbx (com a ficha de pessoa), três peles, roupa, cabelo (Standard), o shader e a cena. */
function pacoteDoAvatar({ comShader = true, comCena = true } = {}) {
  const { fbx, humano } = avatarFBX();
  const metaFbx = `fileFormatVersion: 2\nguid: ${g(1)}\nModelImporter:\n  internalIDToNameTable: []\n  externalObjects: {}\n  humanDescription:\n    human:\n` +
    humano.map(([o, n]) => `    - boneName: ${o}\n      humanName: ${n}\n`).join("") + "  animationType: 3\n";
  const poiyomi = `{fileID: 4800000, guid: ${g(50)}, type: 3}`, standard = "{fileID: 46, guid: 0000000000000000f000000000000000, type: 0}";
  const toon = { num: { _EnableRimLighting: 1, _RimWidth: 0.5, _EnableOutlines: 1, _LineWidth: 0.2, _ShadingEnabled: 1 }, cor: { _Color: [1, 1, 1, 1], _ShadowColor: [0.6, 0.5, 0.7, 1], _RimLightColor: [1, 0, 0, 1], _LineColor: [0, 0, 1, 1] } };
  const arquivos = [
    { caminho: "Assets/Av/Avatar.fbx", dados: fbx, guid: g(1), meta: metaFbx },
    { caminho: "Assets/Av/Materials/Pele.mat", dados: mat("Pele", { tex: { _MainTex: g(11) }, ...toon, shader: poiyomi }), guid: g(21) },
    { caminho: "Assets/Av/Materials/Pele 1.mat", dados: mat("Pele 1", { tex: { _MainTex: g(12) }, ...toon, shader: poiyomi }), guid: g(22) },
    { caminho: "Assets/Av/Materials/Pele 2.mat", dados: mat("Pele 2", { tex: { _MainTex: g(13) }, ...toon, shader: poiyomi }), guid: g(23) },
    { caminho: "Assets/Av/Materials/Roupa.mat", dados: mat("Roupa", { tex: { _MainTex: g(14) }, ...toon, shader: poiyomi }), guid: g(24) },
    { caminho: "Assets/Av/Materials/Cabelo.mat", dados: mat("Cabelo", { tex: { _MainTex: g(15) }, num: { _Metallic: 0.7, _Glossiness: 0.8 }, cor: { _Color: [1, 1, 1, 1] }, shader: standard }), guid: g(25) },
    { caminho: "Assets/Av/Textures/pele-clara.png", dados: png(8, 8, () => [250, 220, 200]), guid: g(11) },
    { caminho: "Assets/Av/Textures/pele-media.png", dados: png(8, 8, () => [200, 150, 110]), guid: g(12) },
    { caminho: "Assets/Av/Textures/pele-escura.png", dados: png(8, 8, () => [110, 70, 50]), guid: g(13) },
    { caminho: "Assets/Av/Textures/roupa.png", dados: png(8, 8, () => [40, 190, 90]), guid: g(14) },
    { caminho: "Assets/Av/Textures/cabelo.png", dados: png(8, 8, () => [240, 200, 40]), guid: g(15) },
  ];
  if (comShader) arquivos.push({ caminho: "Assets/Av/Shaders/Poiyomi Toon.shader", dados: SHADER_POIYOMI, guid: g(50) });
  if (comCena) {
    // a cena: o corpo ("Body") com a Pele 1 e a Roupa; o cabelo ("Hair") com o Cabelo (o .fbx chama os materiais de Corpo, Roupa e Cabelo)
    const r = (go, ids) => `--- !u!137 &${go + 1}\nSkinnedMeshRenderer:\n  m_GameObject: {fileID: ${go}}\n  m_Enabled: 1\n  m_Materials:\n` + ids.map((x) => `  - {fileID: 2100000, guid: ${x}, type: 2}\n`).join("") + `  m_Mesh: {fileID: -${go}123, guid: ${g(1)}, type: 3}\n`;
    const cena = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n" +
      `--- !u!1 &100\nGameObject:\n  m_Name: Body\n  m_IsActive: 1\n` + r(100, [g(22), g(24)]) +
      `--- !u!1 &200\nGameObject:\n  m_Name: Hair\n  m_IsActive: 1\n` + r(200, [g(25)]);
    arquivos.push({ caminho: "Assets/Av/Avatar.unity", dados: cena, guid: g(60) });
  }
  return unityPackage(arquivos);
}
/** O mesmo avatar sem a ficha de pessoa e com os ossos de nomes que não dizem nada ("B0", "B1"...). */
function avatarSemNomes() {
  const { fbx, ossos } = avatarFBX();
  let texto = fbx.toString("utf8");
  const nomes = {};
  ossos.forEach((n, i) => { nomes[n] = "B" + i; texto = texto.split(`"Model::${n}"`).join(`"Model::B${i}"`); });
  return { pacote: unityPackage([{ caminho: "Assets/X/Boneco.fbx", dados: Buffer.from(texto, "utf8"), guid: g(1) }]), nomes };
}

(async () => {
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 30000 });

    /** Converte um pacote (base64) e devolve o resumo, as variações e os materiais do .vrm. */
    const converter = (b64, opcoes = {}) => ev(async ([b64, opcoes]) => {
      await C.prepararVRM();
      const arqs = await C.lerUnityPackage(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      try {
        const r = await C.avatar.paraVRM(arqs, C.avatar.candidatos(arqs)[0], { nome: "Teste", ...opcoes });
        const { json } = C.ktx2.abrirGLB(await r.vrm.arrayBuffer());
        const mats = json.materials.map((m) => {
          const mt = m.extensions && m.extensions.VRMC_materials_mtoon, pbr = m.pbrMetallicRoughness || {};
          const tex = pbr.baseColorTexture ? json.images[json.textures[pbr.baseColorTexture.index].source] : null;
          return { nome: m.name, mtoon: !!mt, sombra: mt && mt.shadeColorFactor, rim: mt && mt.parametricRimColorFactor, contorno: mt && mt.outlineWidthMode !== "none" ? [mt.outlineWidthFactor, mt.outlineColorFactor] : null, metal: pbr.metallicFactor, rug: pbr.roughnessFactor, imagem: tex && tex.name };
        });
        return { resumo: r.resumo, variacoes: r.variacoes.map((v) => [v.nome, Object.keys(v.imagens).sort()]), mats };
      } catch (e) { return { erro: e.message, semEsqueleto: !!e.semEsqueleto, ossos: (e.ossosDoModelo || []).length, palpite: e.palpite || null, faltam: e.faltam || [] }; }
    }, [b64, opcoes]);

    // ── materiais pela cena, shaders e as versões de pele ──
    const r = await converter(pacoteDoAvatar().toString("base64"));
    const pele = r.mats.find((m) => m.nome === "Pele 1"), cabelo = r.mats.find((m) => m.nome === "Cabelo");
    ok(r.resumo && r.resumo.pelaCena >= 2 && pele && !r.mats.some((m) => m.nome === "Pele" || m.nome === "Pele 2"),
      `os materiais vêm como a cena do Unity põe: a "Pele 1" no corpo (e não a "Pele" pelo nome); ${r.resumo && r.resumo.pelaCena} pela cena: ${r.mats.map((m) => m.nome).join(", ")}`);
    ok(pele && pele.mtoon && Math.abs(pele.sombra[0] - 0.6) < 0.01 && Math.abs(pele.sombra[1] - 0.5) < 0.01 && pele.rim && pele.rim[0] === 1 && pele.contorno && Math.abs(pele.contorno[0] - 0.002) < 1e-6 && pele.contorno[1][2] === 1,
      `Poiyomi (o shader do pacote) → MToon com a sombra, o brilho na borda e o contorno do material: ${JSON.stringify(pele)}`);
    ok(cabelo && !cabelo.mtoon && Math.abs(cabelo.metal - 0.7) < 0.01 && Math.abs(cabelo.rug - 0.2) < 0.01, `Standard (embutido no Unity) → material realista com o metal e a rugosidade: ${JSON.stringify(cabelo)}`);
    ok(r.resumo.shaders.nomes.some((s) => s.nome === "Poiyomi Toon" && s.familia === "toon") && r.resumo.shaders.traduzidos >= 3, `o resumo diz os shaders (o nome sem o código da versão travada): ${JSON.stringify(r.resumo.shaders)}`);
    const v = r.variacoes.find((x) => /Pele 1/.test(x[0]));
    ok(v && v[1].length === 2 && v[1].includes("Pele.png") && v[1].includes("Pele 2.png"), `as outras peles ("Pele" e "Pele 2") viram variações para trocar, sem se misturar: ${JSON.stringify(r.variacoes)}`);

    // ── a biblioteca de shaders: o mesmo avatar sem o .shader no pacote ──
    const semShader = await converter(pacoteDoAvatar({ comShader: false }).toString("base64"));
    ok(semShader.resumo && !semShader.resumo.shaders.nomes.some((s) => s.nome === "Poiyomi Toon"), "sem o shader no pacote (e sem a biblioteca), o Poiyomi não é reconhecido");
    const carregado = await ev(async (texto) => {
      const m = new Map([["Assets/Shaders/Poiyomi Toon.shader", new Blob([texto])]]);
      m.metas = new Map([["Assets/Shaders/Poiyomi Toon.shader", "fileFormatVersion: 2\nguid: 00000000000000000000000000000032\n"]]);
      m.guids = new Map();
      return C.shaders.carregar(m);
    }, SHADER_POIYOMI);
    const comLib = await converter(pacoteDoAvatar({ comShader: false }).toString("base64"));
    const peleLib = comLib.mats.find((m) => m.nome === "Pele 1");
    ok(carregado.novos === 1 && peleLib && peleLib.rim && peleLib.contorno, `carregado na biblioteca (Personagem › Shaders do Unity), o shader vale para os próximos avatares: ${JSON.stringify(peleLib)}`);
    // a janela da biblioteca
    await pagina.click('.lnux-menubar > button:text-is("Personagem")');
    await pagina.click('.lnux-menu button:has(.rotulo:text-is("Shaders do Unity (para converter avatares)..."))');
    await pagina.waitForSelector("#lista-shaders");
    ok(await ev(() => /Poiyomi Toon/.test(document.querySelector("#lista-shaders").textContent) && /desenho/.test(document.querySelector("#lista-shaders").textContent)), "a janela Shaders do Unity lista o shader carregado (família: desenho)");
    await pagina.click('.lnux-dialogo footer button:text-is("Fechar")');

    // ── os ossos escolhidos à mão ──
    const { pacote, nomes } = avatarSemNomes();
    const falhou = await converter(pacote.toString("base64"));
    ok(falhou.semEsqueleto && falhou.ossos > 20 && falhou.faltam.includes("hips"), `ossos de nomes que não dizem nada: o conversor para e entrega a lista para escolher (${falhou.ossos} ossos; faltam ${falhou.faltam.length})`);
    const escolha = { hips: nomes.Hips, spine: nomes.Spine, chest: nomes.Chest, neck: nomes.Neck, head: nomes.Head };
    for (const [L, l] of [["Left", "left"], ["Right", "right"]]) Object.assign(escolha, { [l + "Shoulder"]: nomes[L + " shoulder"], [l + "UpperArm"]: nomes[L + " arm"], [l + "LowerArm"]: nomes[L + " elbow"], [l + "Hand"]: nomes[L + " wrist"], [l + "UpperLeg"]: nomes[L + " leg"], [l + "LowerLeg"]: nomes[L + " knee"], [l + "Foot"]: nomes[L + " ankle"] });
    const certo = await converter(pacote.toString("base64"), { ossos: escolha });
    ok(certo.resumo && certo.resumo.comoMapeou === "escolhidos à mão" && certo.resumo.ossos >= 17 && certo.resumo.altura > 1.5, `com os ossos escolhidos, converte: ${certo.resumo && certo.resumo.ossos} ossos, ${certo.resumo && certo.resumo.altura} m`);
    // pela tela: a janela "Escolher os ossos" aparece sozinha
    const arq = path.join(PASTA, "avatar-sem-nomes.unitypackage");
    fs.writeFileSync(arq, pacote);
    await pagina.click('.lnux-menubar > button:text-is("Personagem")');
    await pagina.click('.lnux-menu button:has(.rotulo:text-is("Importar avatar do Unity ou do Blender (.unitypackage, .fbx, .blend)..."))');
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arq);
    await pagina.waitForSelector("#escolher-ossos", { timeout: 60000 });
    // sem escolher tudo, não deixa
    await pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Converter com estes ossos")');
    ok(await ev(() => /Faltam/.test(document.querySelector("#escolher-ossos").textContent)), "a janela não deixa converter sem os ossos obrigatórios");
    await ev((escolha) => { for (const [vrm, n] of Object.entries(escolha)) { const s = document.querySelector(`#escolher-ossos select[data-osso="${vrm}"]`); if (s) s.value = n; } }, escolha);
    await pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Converter com estes ossos")');
    await pagina.waitForSelector("#avatar-convertido", { timeout: 120000 });
    ok(await ev(() => /escolhidos à mão/.test(document.querySelector("#avatar-convertido").textContent)), "pela tela: escolhe os ossos e o resumo diz \"escolhidos à mão\"");
    await pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Cancelar")');

    // ── a opacidade do menu ──
    const op = await ev(() => { C.acessibilidade.gravar({ opacidadeMenu: 0.55 }); const v = getComputedStyle(document.documentElement).getPropertyValue("--webc-menu-opacidade").trim(); C.acessibilidade.gravar({ opacidadeMenu: 1 }); return v; });
    ok(op === "0.55", `a opacidade do menu e das opções (Opções › Acessibilidade) vale na tela: ${op}`);

    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-avatar-extras-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (avatares: ossos, cena, shaders, peles; menu): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
