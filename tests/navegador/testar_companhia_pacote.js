// Teste dos pacotes do Unity com vários modelos e das cenas do Unity, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_pacote
//
// Não baixa nada: o pacote é montado aqui, como os do VRChat que trazem a personagem, roupas, itens e um mundo:
//   - Avatar.fbx (com a ficha de pessoa do Unity), Hat_Outfit.fbx (uma peça feita para o mesmo esqueleto),
//     Prop.glb (um objeto solto) e Mundo.unity (uma cena: uma instância de prefab do Prop.glb, mudada de lugar, e um
//     cubo do próprio Unity com um material .mat que aponta para uma textura).
// Cobre: as texturas achadas pelo nome (C.texturas); o cenário que guarda as fichas (.meta) e as cenas; a cena do
// Unity montada (cada peça no lugar, com o material); a janela "O que é cada modelo?" (palpites e erros); a
// personagem com a roupa vestida; o item na mochila e o cenário guardado, tudo numa importação só.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { avatarFBX, avatarDoUnity, unityPackage, mapaDeTeste, png } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

const g = (n) => n.toString(16).padStart(32, "0");
/** A cena do Unity: o Prop.glb (instância de prefab, levado para x = 5) e um cubo do Unity em x = -3 com o material Pedra. */
function cenaDoUnity() {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_Component:
  - component: {fileID: 101}
  - component: {fileID: 102}
  - component: {fileID: 103}
  m_Name: Pedra
  m_IsActive: 1
--- !u!4 &101
Transform:
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 3, y: 0.5, z: 0}
  m_LocalScale: {x: 2, y: 1, z: 2}
  m_Children: []
  m_Father: {fileID: 0}
--- !u!33 &102
MeshFilter:
  m_GameObject: {fileID: 100}
  m_Mesh: {fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}
--- !u!23 &103
MeshRenderer:
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_Materials:
  - {fileID: 2100000, guid: ${g(0x31)}, type: 2}
--- !u!1001 &200
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 400000, guid: ${g(0x13)}, type: 3}
      propertyPath: m_LocalPosition.x
      value: -5
      objectReference: {fileID: 0}
    - target: {fileID: 400000, guid: ${g(0x13)}, type: 3}
      propertyPath: m_LocalPosition.y
      value: 0
      objectReference: {fileID: 0}
    - target: {fileID: 100000, guid: ${g(0x13)}, type: 3}
      propertyPath: m_Name
      value: Banco
      objectReference: {fileID: 0}
  m_SourcePrefab: {fileID: 100100000, guid: ${g(0x13)}, type: 3}
`;
}
function pedraMat() {
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!21 &2100000\nMaterial:\n  m_Name: Pedra\n  m_SavedProperties:\n    m_TexEnvs:\n` +
    `    - _BaseMap:\n        m_Texture: {fileID: 2800000, guid: ${g(0x32)}, type: 3}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}\n    m_Floats: []\n    m_Colors:\n    - _BaseColor: {r: 1, g: 1, b: 1, a: 1}\n`;
}

(async () => {
  // a ficha do Avatar.fbx (com os ossos de pessoa) vem do pacote de teste dos avatares
  const { humano, fbx } = avatarFBX();
  const metaPessoa = (guid) => `fileFormatVersion: 2\nguid: ${guid}\nModelImporter:\n  humanDescription:\n    human:\n` +
    humano.map(([osso, nome]) => `    - boneName: ${osso}\n      humanName: ${nome}\n`).join("") + "  animationType: 3\n";
  const pacote = unityPackage([
    { caminho: "Assets/Pacote/Avatar.fbx", dados: fbx, guid: g(0x11), meta: metaPessoa(g(0x11)) },
    { caminho: "Assets/Pacote/Hat_Outfit.fbx", dados: avatarFBX({ texturaDaRoupa: "roupa.png" }).fbx, guid: g(0x12), meta: `fileFormatVersion: 2\nguid: ${g(0x12)}\nModelImporter:\n  animationType: 2\n` },
    { caminho: "Assets/Pacote/Prop.glb", dados: mapaDeTeste(), guid: g(0x13) },
    { caminho: "Assets/Pacote/Textures/corpo.png", dados: png(16, 16, () => [225, 40, 40]), guid: g(0x21) },
    { caminho: "Assets/Pacote/Textures/roupa.png", dados: png(16, 16, () => [40, 190, 90]), guid: g(0x22) },
    { caminho: "Assets/Pacote/Mundo/Pedra.mat", dados: pedraMat(), guid: g(0x31) },
    { caminho: "Assets/Pacote/Mundo/pedra_textura.png", dados: png(8, 8, () => [30, 30, 220]), guid: g(0x32) },
    { caminho: "Assets/Pacote/Mundo/Mundo.unity", dados: cenaDoUnity(), guid: g(0x33) },
    { caminho: "Assets/Pacote/Scripts/Coisa.cs", dados: "public class Coisa {}\n", guid: g(0x34) },
  ]);
  const arqPacote = path.join(PASTA, "pacote-varios.unitypackage");
  fs.writeFileSync(arqPacote, pacote);
  void avatarDoUnity;

  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const botaoDoDialogo = (rotulo) => pagina.click(`.lnux-dialogo:last-of-type footer button:text-is("${rotulo}")`);
  const b64 = pacote.toString("base64");

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 20000 });

    // ── as texturas pelo nome ──
    const tx = await ev(() => {
      const imgs = ["T/T_Body_BaseColor.png", "T/T_Body_Normal.png", "T/Hair_Diff.tga", "T/Hair_Mask.png", "T/shoes_base.png", "T/Shoes_MatCap.png", "T/BodyTattoo_col.png"];
      return { body: C.texturas.melhorPara("Body", imgs), hair: C.texturas.melhorPara("Hair_mat", imgs), shoes: C.texturas.melhorPara("Shoes", imgs), nada: C.texturas.melhorPara("Olhos", imgs),
        normal: C.texturas.melhorPara("Body", imgs, { quer: "normal" }), papeis: [C.texturas.papel("x_nrm"), C.texturas.papel("Skin_D"), C.texturas.papel("Face_Rough")],
        unity: C.texturas.doMaterialUnity({ _MatCap: "a", _BaseMap: "b", _BumpMap: "c" }) };
    });
    ok(tx.body === "T/T_Body_BaseColor.png" && tx.hair === "T/Hair_Diff.tga" && tx.shoes === "T/shoes_base.png" && tx.nada === null, `texturas pelo nome do material: ${JSON.stringify([tx.body, tx.hair, tx.shoes, tx.nada])}`);
    ok(tx.normal === "T/T_Body_Normal.png" && tx.papeis.join() === "normal,cor,outro" && tx.unity.cor === "b" && tx.unity.normal === "c", "o papel de cada imagem (cor, relevo, outro) e o material do Unity (URP: _BaseMap)");

    // ── o cenário: o pacote guarda as fichas e as cenas, e a cena do Unity é montada ──
    const cena = await ev(async (b64) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
      const preparado = await C.mapas.preparar(new Map([["pacote-varios.unitypackage", blob]]));
      const nomes = [...preparado.keys()];
      const r = await C.conversor.juntarGLB(preparado, { cena: nomes.find((n) => /\.unity$/i.test(n)) });
      const T = window.THREE, gltf = await C.carregadorGLTF().parseAsync(await r.glb.arrayBuffer(), "");
      gltf.scene.updateMatrixWorld(true);
      const achar = (re) => { let a = null; gltf.scene.traverse((o) => { if (!a && o.isMesh && re.test(o.name + " " + (o.parent ? o.parent.name : ""))) a = o; }); return a; };
      const pedra = achar(/Pedra/), banco = achar(/Banco|Mapa/);
      const centro = (o) => { const c = new T.Box3().setFromObject(o).getCenter(new T.Vector3()); return [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)]; };
      const todos = await C.conversor.juntarGLB(preparado, { modelos: nomes.filter((n) => C.conversor.MODELO.test(n)) });
      return { nomes, metas: !!(preparado.metas && preparado.metas.size), guids: !!(preparado.guids && preparado.guids.size), colocados: r.colocados,
        pedra: pedra && { centro: centro(pedra), tamanho: new T.Box3().setFromObject(pedra).getSize(new T.Vector3()).toArray().map((v) => +v.toFixed(2)), textura: !!(pedra.material.map && pedra.material.map.image) },
        banco: banco && centro(banco), todos: todos.colocados };
    }, b64);
    ok(cena.metas && cena.guids && cena.nomes.some((n) => /Mundo\.unity$/.test(n)) && cena.nomes.some((n) => /Pedra\.mat$/.test(n)) && !cena.nomes.some((n) => /\.cs$/.test(n)),
      "o .unitypackage como cenário guarda as fichas (.meta), a cena e os materiais (e deixa os scripts de fora)");
    ok(cena.colocados >= 2 && cena.pedra && Math.abs(cena.pedra.centro[0] + 3) < 0.05 && Math.abs(cena.pedra.centro[1] - 0.5) < 0.05 && cena.pedra.tamanho[0] > 1.9 && cena.pedra.textura,
      `a cena do Unity montada: o cubo do Unity no lugar (x espelhado), no tamanho e com a textura do .mat: ${JSON.stringify(cena.pedra)}`);
    ok(cena.banco && cena.banco[0] > 4, `a instância de prefab do Prop.glb mudada de lugar pela cena: ${JSON.stringify(cena.banco)}`);
    ok(cena.todos === 3, `"todos os modelos": os 3 modelos do pacote lado a lado (${cena.todos})`);

    // ── o pacote como personagem: a janela dos papéis ──
    await menu("Personagem", "Importar avatar do Unity ou do Blender (.unitypackage, .fbx, .blend)...");
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arqPacote);
    await pagina.waitForSelector("#papeis-do-pacote", { timeout: 60000 });
    const palpites = await ev(() => Object.fromEntries([...document.querySelectorAll("#papeis-do-pacote select")].map((s) => [(s.dataset.modelo || s.dataset.cena).split("/").pop(), s.value])));
    ok(palpites["Avatar.fbx"] === "personagem" && palpites["Hat_Outfit.fbx"] === "junto" && palpites["Prop.glb"] === "item" && palpites["Mundo.unity"] === "nao",
      `os palpites: a personagem, a roupa junto dela, o item e a cena: ${JSON.stringify(palpites)}`);
    // duas personagens: não deixa
    await pagina.selectOption('#papeis-do-pacote select[data-modelo$="Prop.glb"]', "personagem");
    await botaoDoDialogo("Importar");
    await pagina.waitForTimeout(300);
    ok(await ev(() => !!document.querySelector("#papeis-do-pacote") && /Só um modelo/.test(document.querySelector("#papeis-do-pacote").innerText)), "duas personagens escolhidas: a janela avisa e não fecha");
    await pagina.selectOption('#papeis-do-pacote select[data-modelo$="Prop.glb"]', "item");
    await pagina.selectOption('#papeis-do-pacote select[data-cena$="Mundo.unity"]', "cenario");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-pacote-1.png") });
    const itensAntes = (await ev(() => C.itens.lista())).length, mapasAntes = (await ev(() => C.mapas.lista())).length;
    await botaoDoDialogo("Importar");
    await pagina.waitForSelector("#avatar-convertido", { timeout: 180000 });
    const texto = await ev(() => document.querySelector("#avatar-convertido").innerText);
    ok(/Peças juntas: 1 modelo/.test(texto) && /item Prop/.test(texto) && /cenário Mundo/.test(texto), "resumo: a roupa vestida, o item e o cenário que vieram do mesmo pacote");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-pacote-2.png") });
    await botaoDoDialogo("Importar");
    await pagina.waitForFunction(() => { const c = window.Companhia; return c.atual && c.atual.nome === "Avatar" && c.palco.modelo && c.pronto; }, null, { timeout: 120000 });
    const p = await ev(() => {
      const malhas = [];
      window.Companhia.palco.vrm.scene.traverse((o) => { if (o.isSkinnedMesh) malhas.push(o); });
      // as malhas da peça seguem o mesmo esqueleto da personagem
      const ossos = new Set(malhas.map((m) => m.skeleton.bones.find((b) => /hips|Hips/.test(b.name))).filter(Boolean));
      return { malhas: malhas.length, mesmoEsqueleto: ossos.size === 1 };
    });
    ok(p.malhas >= 4 && p.mesmoEsqueleto, `a personagem abre com as malhas da roupa no mesmo esqueleto (${p.malhas} malhas)`);
    const itens = await ev(() => C.itens.lista()), mapas = await ev(() => C.mapas.lista());
    ok(itens.length === itensAntes + 1 && itens[0].nome === "Prop" && mapas.length === mapasAntes + 1 && mapas[mapas.length - 1].nome === "Mundo", "o item foi para a mochila e a cena virou cenário guardado");
    const blobItem = await ev(async (id) => { const b = await C.itens.ler(id); const gl = await C.carregadorGLTF().parseAsync(await b.arrayBuffer(), ""); let n = 0; gl.scene.traverse((o) => { if (o.isMesh) n++; }); return n; }, itens[0].id);
    ok(blobItem >= 1, "o item guardado é um .glb que abre");
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-pacote-erro.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (pacotes com vários modelos): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
