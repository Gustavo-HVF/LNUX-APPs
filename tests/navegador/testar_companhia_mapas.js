// Teste do conversor de cenários da Companhia (qualquer formato → .glb), com a ponte local, no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_mapas
//
// Não baixa nada: usa dois .blend de verdade guardados em tests/dados/ (salvos pelo Blender 4.2 e pelo 5.3, que
// gravam as malhas de jeitos diferentes; os dois compactados com zstd) e monta os outros formatos aqui.
// Cobre: o leitor próprio de .blend (triângulos, materiais, textura embutida, posição dos objetos filhos e o Z do
// Blender virando o Y daqui), .obj + .mtl, .stl, .ply, .dae, .gltf com .bin solto, abrir o .blend como cenário
// pela tela (a personagem pisa no piso), "mapa deitado", "Salvar em .glb" e "Só converter".
// Se o aparelho tiver o Blender (ou o módulo bpy; LNUX_APPS_BLENDER aponta outro), confere também a conversão
// feita por ele, pela ponte; sem Blender, essa parte é pulada.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { bonecoVRM0, caixas, gltfDeMalha } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const DADOS = path.join(__dirname, "..", "dados");
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const boneco = path.join(PASTA, "boneco-vrm0.vrm");
  fs.writeFileSync(boneco, bonecoVRM0());
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|voz do navegador/.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const escolherArquivo = async (arquivos) => {
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arquivos);
  };
  /** Converte arquivos (nome → base64) na página e abre o .glb de volta para medir. */
  const converter = (arquivos, principal) => ev(async ([arquivos, principal]) => {
    await C.prepararVRM();
    const mapa = new Map(Object.entries(arquivos).map(([n, b64]) => [n, new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])]));
    const r = await C.conversor.paraGLB(mapa, principal);
    const cab = new DataView(await r.glb.slice(0, 12).arrayBuffer());
    const u = URL.createObjectURL(r.glb), g = await new CompanhiaVRM.GLTFLoader().loadAsync(u);
    URL.revokeObjectURL(u);
    let t = 0, tex = 0;
    const mats = new Map(), nos = [];
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      nos.push(o.name);
      t += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      for (const m of [].concat(o.material)) { mats.set(m.name, m.color.getHexString()); if (m.map && m.map.image && m.map.image.width) tex++; }
    });
    const c = new THREE.Box3().setFromObject(g.scene);
    return { como: r.como, avisos: r.avisos, tamanho: r.glb.size, glTF: cab.getUint32(0, true) === 0x46546c67 && cab.getUint32(4, true) === 2, triangulos: t, materiais: Object.fromEntries(mats), texturas: tex, nos: nos.sort(),
      caixa: [...c.min.toArray(), ...c.max.toArray()].map((v) => +v.toFixed(2)) };
  }, [Object.fromEntries(Object.entries(arquivos).map(([n, d]) => [n, Buffer.from(d).toString("base64")])), principal]);

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 20000 });
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await escolherArquivo(boneco);
    await pagina.waitForFunction(() => window.Companhia.atual && window.Companhia.palco.modelo && window.Companhia.pronto, null, { timeout: 90000 });

    // ── .blend pelo leitor próprio ──
    const temBlender = await ev(async () => { try { return (await LNUX.ponte.pedir("GET", "blender")).disponivel; } catch (e) { return false; } });
    for (const [versao, arquivo] of [["4.2", "cenario-blender-4.2.blend"], ["5.3", "cenario-blender-5.3.blend"]]) {
      const dados = fs.readFileSync(path.join(DADOS, arquivo));
      const lido = await ev(async (b64) => {
        // direto no leitor (mesmo com o Blender instalado, para conferir o leitor próprio)
        let d = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const compactado = C.blend.compactacao(d);
        if (compactado === "zstd") { await C.prepararVRM(); const z = new CompanhiaVRM.ZSTDDecoder(); await z.init(); d = z.decode(d); }
        const b = C.blend.ler(d);
        return { compactado, versao: b.versao, objetos: b.objetos.map((o) => o.nome).sort(), triangulos: b.objetos.reduce((s, o) => s + b.malhas[o.malha].triangulos, 0), uv: b.malhas.every((m) => !!m.uvs),
          materiais: b.materiais.map((m) => [m.nome, m.cor.map((v) => +v.toFixed(2)).join(","), +m.rugosidade.toFixed(2), m.imagem !== null]).sort(), imagens: b.imagens.map((i) => [i.nome, !!i.dados]) };
      }, dados.toString("base64"));
      ok(lido.compactado === "zstd" && lido.triangulos === 1026 && lido.objetos.join() === "Coluna,Macaca,Parede,Piso" && lido.uv,
        `.blend do Blender ${versao} (zstd, formato ${lido.versao}): 4 malhas, 1026 triângulos e UV, como o Blender exporta`);
      ok(JSON.stringify(lido.materiais) === JSON.stringify([["Chao", "1,1,1,1", 0.8, true], ["Pedra", "0.6,0.6,0.65,1", 0.8, false], ["Tijolo", "0.8,0.2,0.2,1", 0.8, false]]) && lido.imagens[0][1] === true,
        `.blend ${versao}: materiais do Principled (cor, rugosidade), a imagem ligada na cor e a textura embutida no arquivo`);
    }
    if (!temBlender) {
      const r = await converter({ "cenario.blend": fs.readFileSync(path.join(DADOS, "cenario-blender-5.3.blend")) }, "cenario.blend");
      ok(r.glTF && r.triangulos === 1026 && r.texturas === 1 && /leitor próprio/.test(r.como) && r.avisos.some((a) => /Blender/.test(a)), `.blend → .glb pelo leitor próprio (${r.tamanho} bytes), avisando o que só o Blender converte`);
      ok(JSON.stringify(r.caixa) === "[-12,1,-12,12,4,12]" && r.nos.join() === "Coluna,Macaca,Parede,Piso",
        `o Z do Blender vira o Y daqui e a parede (filha de outro objeto, com escala) fica no lugar: caixa ${r.caixa}`);
      ok(r.materiais.Tijolo === "e77c7c" || /^[de]/.test(r.materiais.Tijolo || ""), `as cores dos materiais vão para o .glb (Tijolo #${r.materiais.Tijolo})`);
    } else {
      // com o Blender no aparelho, o conversor usa ele (pela ponte)
      const r = await converter({ "cenario.blend": fs.readFileSync(path.join(DADOS, "cenario-blender-5.3.blend")) }, "cenario.blend");
      ok(r.glTF && r.triangulos === 1026 && /Blender do aparelho/.test(r.como) && !r.avisos.length, `.blend → .glb pelo Blender do aparelho, pela ponte (${r.tamanho} bytes, 1026 triângulos)`);
      ok(Math.abs(r.caixa[1] - 1) < 0.01 && Math.abs(r.caixa[4] - 4) < 0.01 && r.texturas === 1, `a exportação do Blender chega com a altura e a textura certas: caixa ${r.caixa}`);
      ok((await ev(() => LNUX.ponte.pedir("GET", "pastas", { parametros: { caminho: LNUX.ponte.estado.temporarios } }))).itens.every((i) => !/^blender-/.test(i.nome)), "a pasta temporária da conversão é apagada depois");
    }

    // ── os outros formatos ──
    const obj = "mtllib cores.mtl\nv 0 0 0\nv 4 0 0\nv 4 0 4\nv 0 0 4\nv 2 3 2\nvt 0 0\nvt 1 0\nvt 1 1\nusemtl Vermelho\nf 1/1 2/2 3/3 4/1\nf 1/1 2/2 5/3\nf 2/1 3/2 5/3\n";
    let r = await converter({ "casa.obj": obj, "cores.mtl": "newmtl Vermelho\nKd 0.9 0.1 0.1\nNs 30\n" }, "casa.obj");
    ok(r.glTF && r.triangulos === 4 && "Vermelho" in r.materiais && JSON.stringify(r.caixa) === "[0,0,0,4,3,4]", `.obj + .mtl → .glb (4 triângulos; o quadrado vira 2; material "Vermelho" #${r.materiais.Vermelho})`);
    r = await converter({ "peca.stl": "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 3 0 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid t\n" }, "peca.stl");
    ok(r.glTF && r.triangulos === 1 && r.caixa[3] === 3, ".stl → .glb");
    r = await converter({ "nuvem.ply": "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n2 0 0\n2 2 0\n0 2 0\n3 0 1 2\n3 0 2 3\n" }, "nuvem.ply");
    ok(r.glTF && r.triangulos === 2 && r.caixa[3] === 2, ".ply → .glb");
    const dae = `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><up_axis>Y_UP</up_axis></asset><library_geometries><geometry id="g"><mesh><source id="p"><float_array id="pa" count="9">0 0 0 5 0 0 0 5 0</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#s"/></scene></COLLADA>`;
    r = await converter({ "cena.dae": dae }, "cena.dae");
    ok(r.glTF && r.triangulos === 1 && r.caixa[3] === 5, ".dae (Collada) → .glb");
    // .gltf com o .bin solto ao lado → um .glb só
    const { json, bin } = gltfDeMalha(caixas([[-2, 0, -2, 2, 1, 2]]), { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Caixa", mesh: 0 }] });
    json.buffers[0].uri = "dados.bin";
    r = await converter({ "pasta/cena.gltf": JSON.stringify(json), "pasta/dados.bin": bin }, "pasta/cena.gltf");
    ok(r.glTF && r.triangulos === 12 && JSON.stringify(r.caixa) === "[-2,0,-2,2,1,2]", ".gltf + .bin soltos → um .glb só, com tudo dentro");
    const erro = await ev(async () => { try { await C.conversor.paraGLB(new Map([["vazio.obj", new Blob(["# nada\n"])]]), "vazio.obj"); return ""; } catch (e) { return e.message; } });
    ok(/nenhuma malha/.test(erro), "um arquivo sem malha é recusado com explicação: " + erro);

    // ── pela tela: abrir o .blend como cenário ──
    await menu("Movimento", "Cenário (mapa)...");
    await pagina.waitForSelector('.painel-estudio:has-text("Cenário")');
    ok(/\.blend/.test(await pagina.textContent(".painel-estudio")) && await pagina.isVisible('.painel-estudio button:text-is("Só converter um mapa para .glb...")'), "o painel Cenário diz os formatos que converte (com o .blend) e tem o botão de só converter");
    await pagina.click('.painel-estudio button:text-is("Abrir cenário...")');
    await escolherArquivo(path.join(DADOS, "cenario-blender-4.2.blend"));
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.info && window.Companhia.palco.mundo.colisor, null, { timeout: 180000 });
    await esperar(500);
    const cena = await ev(async () => { const p = window.Companhia.palco, m = p.mundo, l = await C.mapas.lista(), arqs = await C.mapas.ler(m.info.id);
      return { nome: m.info.nome, principal: m.info.principal, y: p.raiz.position.y, caixa: [m.caixa.min.y, m.caixa.max.y].map((v) => +v.toFixed(2)), guardados: l.length, arquivos: [...arqs.keys()], aviso: [...document.querySelectorAll(".lnux-aviso")].map((a) => a.textContent).join(" ") }; });
    ok(cena.principal === "cenario-blender-4.2.glb" && cena.arquivos.join() === "cenario-blender-4.2.glb" && Math.abs(cena.y - 1) < 0.03 && cena.caixa.join() === "1,4",
      `abrir um .blend pela tela: é convertido, guardado em .glb e vira o cenário; a personagem fica em cima do piso (y = ${cena.y.toFixed(2)} m)`);
    ok(/convertido/.test(cena.aviso) && (temBlender ? /Blender do aparelho/ : /leitor próprio/).test(cena.aviso), "o aviso diz como foi convertido: " + cena.aviso.slice(0, 110));
    // mapa deitado (Z para cima)
    await pagina.locator('.painel-estudio label:has-text("O mapa veio deitado") input').check();
    await esperar(400);
    const deitado = await ev(() => { const m = window.Companhia.palco.mundo; return [m.info.ajuste.deitado, +(m.caixa.max.y - m.caixa.min.y).toFixed(1)]; });
    ok(deitado[0] === true && deitado[1] === 24, `"O mapa veio deitado" levanta o mapa (a altura passou de 3 para ${deitado[1]} m)`);
    await pagina.locator('.painel-estudio label:has-text("O mapa veio deitado") input').uncheck();
    // salvar o cenário em .glb
    await pagina.click('.painel-estudio button:text-is("Salvar em .glb")');
    await pagina.waitForSelector(".lnux-dialogo");
    let [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click('.lnux-dialogo footer button:text-is("Baixar pelo navegador")')]);
    let salvo = fs.readFileSync(await baixado.path());
    ok(baixado.suggestedFilename() === "cenario-blender-4.2.glb" && salvo.readUInt32LE(0) === 0x46546c67 && salvo.readUInt32LE(8) === salvo.length, `"Salvar em .glb" entrega o cenário convertido (${salvo.length} bytes)`);
    // só converter (sem usar como cenário)
    await pagina.click('.painel-estudio button:text-is("Só converter um mapa para .glb...")');
    const objeto = path.join(PASTA, "piramide.obj");
    fs.writeFileSync(objeto, obj.replace("mtllib cores.mtl\n", ""));
    await escolherArquivo(objeto);
    await pagina.waitForSelector('.lnux-dialogo h2:text-is("Salvar o mapa convertido (.glb)")', { timeout: 60000 });
    [baixado] = await Promise.all([pagina.waitForEvent("download"), pagina.click('.lnux-dialogo footer button:text-is("Baixar pelo navegador")')]);
    salvo = fs.readFileSync(await baixado.path());
    ok(baixado.suggestedFilename() === "piramide.glb" && salvo.readUInt32LE(0) === 0x46546c67 && (await ev(async () => (await C.mapas.lista()).length)) === 1,
      `"Só converter" salva o .glb (${salvo.length} bytes) sem trocar o cenário`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-mapas-1.png") });
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + e.message);
    console.log(e);
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-mapas-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (mapas): ${passos} ok, ${erros.length} com problema.`);
  if (erros.length) { console.log(erros.map((x) => "  - " + x).join("\n")); process.exit(1); }
})();
