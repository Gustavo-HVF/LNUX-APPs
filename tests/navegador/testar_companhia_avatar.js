// Teste do conversor de avatares da Companhia (.unitypackage, .fbx → personagem .vrm), no Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_avatar
//
// Não baixa nada: o avatar é montado aqui (tests/navegador/companhia_arquivos.js: avatarFBX e avatarDoUnity), no
// jeito dos avatares do VRChat feitos no Blender: em centímetros, de costas, com os braços em A, ossos com nomes do
// Blender ("Left arm", "Left elbow", "Left knee"...), duas malhas dividindo o osso da cabeça, formas do rosto
// (vrc.v_aa, vrc.blink, Joy, 照れ), materiais .mat do Unity e texturas PNG, TGA e PSD.
// Cobre: os leitores de TGA, PSD e .mat; o pacote pelo menu (com a ficha .meta do Unity); o resumo da conversão;
// a personagem aberta (de frente, braços para baixo, pés no chão, textura do lado certo, expressões, balanço do
// cabelo, olhar, licença "não redistribuir"); o .vrm gerado por dentro; um ZIP com o .unitypackage dentro (como os
// do BOOTH); um .fbx com as texturas ao lado (ossos pelos nomes; TGA pedido pelo .fbx; PSD pelo nome); soltar
// pacotes no palco (avatar vira personagem, mundo vira cenário); um pacote sem esqueleto; e recarregar a página.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { avatarFBX, avatarDoUnity, unityPackage, mapaDeTeste, png, tga, psd, zip } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const { pacote, texturas } = avatarDoUnity();
  const arqPacote = path.join(PASTA, "avatar-do-unity.unitypackage");
  fs.writeFileSync(arqPacote, pacote);
  // como vêm do BOOTH: um ZIP com o .unitypackage e os termos de uso
  const arqBooth = path.join(PASTA, "avatar-booth.zip");
  fs.writeFileSync(arqBooth, zip([["Avatar_v1.0/Avatar_v1.0.unitypackage", pacote], ["Avatar_v1.0/利用規約.txt", Buffer.from("termos de uso de teste\n")]]));
  // um .fbx com as texturas ao lado: o .fbx pede roupa.tga; corpo (PSD) e cabelo (PNG) vão pelo nome do material
  const arqFbx = path.join(PASTA, "avatar-fbx.zip");
  fs.writeFileSync(arqFbx, zip([["Avatar/Avatar.fbx", avatarFBX({ texturaDaRoupa: "roupa.tga" }).fbx],
    ["Avatar/Textures/corpo.psd", psd(64, 64, (x, y) => (y < 32 ? [225, 40, 40] : [40, 70, 225]), true)],
    ["Avatar/Textures/roupa.tga", tga(16, 16, () => [40, 190, 90, 255])],
    ["Avatar/Textures/cabelo.png", png(32, 32, () => [240, 200, 40])]]));
  const arqSemEsqueleto = path.join(PASTA, "sem-esqueleto.unitypackage");
  fs.writeFileSync(arqSemEsqueleto, unityPackage("Assets/Coisa/caixa.glb", mapaDeTeste()));
  const mundo = unityPackage("Assets/Mundo/mapa-do-pacote.glb", mapaDeTeste());

  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  let pagina = await contexto.newPage();
  const consola = [];
  const ouvir = (p) => {
    p.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
    p.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  };
  ouvir(pagina);
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);
  const menu = async (topo, item) => { await pagina.click(`.lnux-menubar > button:text-is("${topo}")`); await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`); };
  const escolherArquivo = async (arquivo) => {
    await pagina.waitForSelector(".lnux-dialogo");
    const [esc] = await Promise.all([pagina.waitForEvent("filechooser"), pagina.click('.lnux-dialogo:last-of-type footer button:text-is("Escolher pelo navegador...")')]);
    await esc.setFiles(arquivo);
  };
  const resumo = async () => {
    await pagina.waitForSelector("#avatar-convertido", { timeout: 120000 });
    return ev(() => document.querySelector("#avatar-convertido").innerText);
  };
  const botaoDoDialogo = (rotulo) => pagina.click(`.lnux-dialogo:last-of-type footer button:text-is("${rotulo}")`);
  const aberta = async (nome) => {
    await pagina.waitForFunction((nome) => { const c = window.Companhia; return c.atual && c.atual.nome === nome && c.palco.modelo && c.pronto; }, nome, { timeout: 120000 });
    await pagina.waitForFunction(() => !window.Companhia.palco.gestos.length && !window.Companhia.respondendo, null, { timeout: 30000 });
    await ev(() => window.Companhia.palco.definirEmocao("neutra"));
    await esperar(900);
  };
  /** A personagem aberta: pose, medidas, expressões, peças e o que o three-vrm leu. */
  const personagem = () => ev(() => {
    const p = window.Companhia.palco, T = window.THREE, pos = (n) => { const v = p.posicao(n); return v ? [v.x, v.y, v.z] : null; };
    const pe = Math.min(pos("leftFoot")[1], pos("rightFoot")[1]), cx = new T.Box3().setFromObject(p.vrm.scene);
    const mats = {};
    p.vrm.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { const n = C.nomePeca(m.name); if (!mats[n]) mats[n] = { textura: !!(m.map && m.map.image && m.map.image.width > 1), corte: +(m.alphaTest || 0).toFixed(2), doisLados: m.side === T.DoubleSide, mtoon: !!m.isMToonMaterial }; } });
    return { v0: p.v0, leftUpperArm: pos("leftUpperArm"), leftHand: pos("leftHand"), rightUpperArm: pos("rightUpperArm"), rightHand: pos("rightHand"), head: pos("head"), hips: pos("hips"),
      pe: pe - p.raiz.position.y, topo: cx.max.y - p.raiz.position.y, exprs: [...p.disponiveis], atalhos: [...p.expressoes.keys()], pecas: p.pecas.map((x) => x.nome), mats,
      molas: p.vrm.springBoneManager ? p.vrm.springBoneManager.joints.size : 0, olhar: !!(p.vrm.lookAt && p.vrm.humanoid.getRawBoneNode("leftEye") && p.vrm.humanoid.getRawBoneNode("rightEye")),
      protegido: !!window.Companhia.atual.protegido, convertido: window.Companhia.atual.convertido === true && window.Companhia.atual.roupas[0].convertido === "fbx" };
  });
  /** A cor que aparece na tela num ponto do corpo (no espaço da personagem: x para a esquerda dela, z para a frente). */
  const corNaTela = (osso, desvio) => ev(([osso, desvio]) => {
    const p = window.Companhia.palco, T = window.THREE, r = p.renderer, gl = r.getContext();
    const ponto = p.posicao(osso).add(new T.Vector3(...desvio)).project(p.camera), px = new Uint8Array(4), tela = r.domElement;
    r.render(p.cena, p.camera);
    gl.readPixels(Math.round((ponto.x + 1) / 2 * tela.width), Math.round((ponto.y + 1) / 2 * tela.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }, [osso, desvio]);
  const vermelho = (c) => c[0] > c[1] + 60 && c[0] > c[2] + 60, verde = (c) => c[1] > c[0] + 40 && c[1] > c[2] + 40;
  /** Solta arquivos no palco, como arrastar do computador. */
  const soltar = (arquivos) => ev((arquivos) => {
    const dt = new DataTransfer();
    for (const [nome, b64] of arquivos) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], nome));
    document.querySelector("#palco-area").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, arquivos.map(([n, d]) => [n, Buffer.from(d).toString("base64")]));

  try {
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}&modo=conversa`);
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined && document.querySelector("#nucleo-aviso:not([hidden])"), null, { timeout: 20000 });

    // ── leitores: TGA, PSD, materiais do Unity, nomes das expressões ──
    const leitores = await ev(async ([tgaRle, tgaCru, psdRle, psdCru]) => {
      const de = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), px = (im, x, y) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
      const t1 = C.avatar.lerTGA(de(tgaRle)), t2 = C.avatar.lerTGA(de(tgaCru)), p1 = C.avatar.lerPSD(de(psdRle)), p2 = C.avatar.lerPSD(de(psdCru));
      const mat = C.avatar.lerMat("%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: Cabelo_lilToon\n  m_CustomRenderQueue: 2450\n  stringTagMap:\n    RenderType: TransparentCutout\n  m_SavedProperties:\n    m_TexEnvs:\n" +
        "    - _MainTex:\n        m_Texture: {fileID: 2800000, guid: 0123456789abcdef0123456789abcdef, type: 3}\n        m_Scale: {x: 1, y: 1}\n    m_Floats:\n    - _Cull: 0\n    - _Cutoff: 0.35\n    m_Colors:\n    - _Color: {r: 1, g: 0.5, b: 0.25, a: 1}\n");
      const ex = C.avatar.acharExpressoes(["Body", "vrc.v_aa", "vrc.v_oh", "vrc.blink", "Joy", "照れ", "sobrando", "eye_close_L", "eye_close_R"]);
      return { t1: [px(t1, 0, 0), px(t1, 3, 1), t1.width], t2: [px(t2, 0, 0), px(t2, 3, 1)], p1: [px(p1, 0, 0), px(p1, 4, 3), p1.width, p1.height], p2: [px(p2, 0, 0), px(p2, 4, 3)], mat, ex };
    }, [tga(4, 2, (x, y) => (y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128]), true), tga(4, 2, (x, y) => (y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128])),
      psd(5, 4, (x, y) => (y < 2 ? [250, 10, 20] : [10, 20, 240]), true), psd(5, 4, (x, y) => (y < 2 ? [250, 10, 20] : [10, 20, 240]))].map((b) => b.toString("base64")));
    ok(JSON.stringify(leitores.t1) === JSON.stringify([[255, 0, 0, 255], [0, 0, 255, 128], 4]) && JSON.stringify(leitores.t2) === JSON.stringify(leitores.t1.slice(0, 2)),
      "TGA (compactado e não): as cores e a transparência chegam certas, de cima para baixo");
    ok(JSON.stringify(leitores.p1) === JSON.stringify([[250, 10, 20, 255], [10, 20, 240, 255], 5, 4]) && JSON.stringify(leitores.p2) === JSON.stringify(leitores.p1.slice(0, 2)),
      "PSD do Photoshop (compactado e não): a imagem juntada é lida");
    ok(leitores.mat.nome === "Cabelo_lilToon" && leitores.mat.texturas._MainTex === "0123456789abcdef0123456789abcdef" && leitores.mat.numeros._Cutoff === 0.35 && leitores.mat.numeros._Cull === 0 &&
      leitores.mat.cores._Color[1] === 0.5 && leitores.mat.tipo === "TransparentCutout", "material .mat do Unity: textura (pelo guid), recorte, dois lados e cor");
    ok(leitores.ex.achadas.aa === "vrc.v_aa" && leitores.ex.achadas.oh === "vrc.v_oh" && leitores.ex.achadas.blink === "vrc.blink" && leitores.ex.achadas.happy === "Joy" &&
      leitores.ex.achadas.blinkLeft === "eye_close_L" && JSON.stringify(leitores.ex.extras) === JSON.stringify(["照れ"]), `formas do rosto viram expressões do VRM: ${JSON.stringify(leitores.ex.achadas)}`);

    // ── o .unitypackage pelo menu ──
    await menu("Personagem", "Importar avatar do Unity (.unitypackage, .fbx)...");
    await escolherArquivo(arqPacote);
    let texto = await resumo();
    ok(/23 ossos reconhecidos pela ficha do Unity \(\.meta\), com os olhos e sem os dedos/.test(texto) && /pose em T \(45°\)/.test(texto) && /1,7\d m de altura/.test(texto),
      "resumo: 23 ossos pela ficha do Unity (com os olhos), 1,7 m, braços em A postos na pose em T");
    ok(/3 expressões \(aa, blink, happy\) e 1 atalho \(照れ\), das 5 formas/.test(texto) && /3 de 3 com textura \(2 pelos materiais do Unity\)/.test(texto) && /cabelo \(1\)/.test(texto) && /não redistribuir/.test(texto),
      "resumo: expressões, texturas pelos materiais do Unity, balanço do cabelo e o aviso de licença");
    await pagina.screenshot({ path: path.join(PASTA, "companhia-avatar-1.png") });
    await botaoDoDialogo("Importar");
    await aberta("avatar-do-unity");
    let c = await personagem();
    ok(c.v0 === false && c.convertido && c.protegido, "vira uma personagem VRM 1.0 guardada no aparelho, marcada como \"não redistribuir\"");
    ok(c.leftHand[1] < c.leftUpperArm[1] - 0.15 && c.rightHand[1] < c.rightUpperArm[1] - 0.15 && c.leftHand[0] > 0.1 && c.rightHand[0] < -0.1,
      `de frente para a câmera, com os braços para baixo em descanso (mão esquerda em x = ${c.leftHand[0].toFixed(2)}, ${(c.leftUpperArm[1] - c.leftHand[1]).toFixed(2)} m abaixo do ombro)`);
    ok(Math.abs(c.pe - 0.04) < 0.05 && Math.abs(c.topo - 1.71) < 0.06 && Math.abs(c.hips[0]) < 0.02, `em metros e com os pés no chão (topo ${c.topo.toFixed(2)} m, pé ${c.pe.toFixed(2)} m)`);
    ok(["aa", "blink", "happy"].every((e) => c.exprs.includes(e)) && JSON.stringify(c.atalhos) === JSON.stringify(["照れ"]), `expressões ${c.exprs.join(", ")} e o atalho 照れ`);
    const boca = await ev(() => {
      const p = window.Companhia.palco, em = p.vrm.expressionManager;
      em.setValue("aa", 1);
      em.update();
      let v = null;
      p.vrm.scene.traverse((o) => { if (o.morphTargetDictionary && o.morphTargetDictionary["vrc.v_aa"] !== undefined) v = o.morphTargetInfluences[o.morphTargetDictionary["vrc.v_aa"]]; });
      em.setValue("aa", 0);
      return v;
    });
    ok(boca > 0.99, "a expressão \"aa\" mexe a forma vrc.v_aa do rosto (a boca fala)");
    ok(JSON.stringify([...c.pecas].sort()) === JSON.stringify(["Cabelo", "Corpo", "Roupa"]) && c.mats.Corpo.textura && c.mats.Roupa.textura && c.mats.Cabelo.textura && c.mats.Corpo.mtoon &&
      c.mats.Cabelo.corte === 0.4 && c.mats.Cabelo.doisLados && !c.mats.Corpo.doisLados, "materiais em MToon, com textura; o do cabelo recortado e de dois lados, como no .mat; cada material é uma peça (Roupas)");
    ok(c.molas >= 2 && c.olhar, `o cabelo balança (${c.molas} juntas) e os olhos seguem a pessoa`);
    await pagina.click('button:text-is("Corpo")');
    await esperar(1200);
    const cara = await corNaTela("head", [0, 0.1, 0.13]), peito = await corNaTela("chest", [0, 0.08, 0.12]);
    ok(vermelho(cara) && verde(peito), `texturas do lado certo: a frente da cabeça usa a metade de cima (vermelha) da textura (${cara}), a roupa é verde (${peito})`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-avatar-2.png") });

    // ── o .vrm por dentro ──
    const dentro = await ev(async ([b64, corpoPng]) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]), arquivos = await C.lerUnityPackage(blob);
      const r = await C.avatar.paraVRM(arquivos, C.avatar.candidatos(arquivos)[0]);
      const cab = new DataView(await r.vrm.slice(0, 20).arrayBuffer()), tj = cab.getUint32(12, true), j = JSON.parse(await r.vrm.slice(20, 20 + tj).text());
      const bin = new Uint8Array(await r.vrm.slice(20 + tj + 8).arrayBuffer()), v = j.extensions.VRMC_vrm;
      const imagens = j.images.map((im) => { const bv = j.bufferViews[im.bufferView]; return { mime: im.mimeType, b64: btoa(String.fromCharCode(...bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength))) }; });
      const ossos = Object.values(v.humanoid.humanBones).map((b) => j.nodes[b.node]);
      return { candidatos: C.avatar.candidatos(arquivos), meta: v.meta, usados: j.extensionsUsed, ossos: ossos.length, semEscala: ossos.every((n) => !n.scale || n.scale.every((s) => Math.abs(s - 1) < 1e-4)),
        pngDireto: imagens.some((i) => i.b64 === corpoPng), mimes: imagens.map((i) => i.mime), cabelo: j.materials.find((m) => m.name === "Cabelo"), molas: j.extensions.VRMC_springBone.springs.map((s) => s.joints.length),
        colisores: j.extensions.VRMC_springBone.colliders.length, olhar: v.lookAt && v.lookAt.type, nada: !j.animations };
    }, [pacote.toString("base64"), texturas["corpo.png"].toString("base64")]);
    ok(dentro.candidatos[0] === "Assets/Avatar/Avatar.fbx" && dentro.ossos === 23 && dentro.semEscala && dentro.olhar === "bone" && dentro.nada,
      "o .vrm: ossos de pessoa sem escala escondida (a Armature com escala 100 sumiu), olhar pelos ossos dos olhos, sem animações");
    ok(dentro.meta.allowRedistribution === false && dentro.meta.modification === "prohibited" && dentro.meta.avatarPermission === "onlyAuthor" && /Avatar\.fbx/.test(dentro.meta.copyrightInformation),
      "a licença gravada no .vrm é a mais fechada (o pacote não diz a do autor)");
    ok(["VRMC_vrm", "VRMC_materials_mtoon", "VRMC_springBone"].every((e) => dentro.usados.includes(e)) && JSON.stringify(dentro.molas) === "[3]" && dentro.colisores >= 4,
      "VRM 1.0 com MToon e balanço (uma corrente de 3 ossos de cabelo, com colisores na cabeça e no corpo)");
    ok(dentro.pngDireto && dentro.mimes.every((m) => m === "image/png") && dentro.cabelo.alphaMode === "MASK" && dentro.cabelo.alphaCutoff === 0.4 && dentro.cabelo.doubleSided,
      "o PNG entra no .vrm do jeito que veio (sem regravar); o TGA vira PNG; o recorte do cabelo vira alphaMode MASK");

    // ── ZIP do BOOTH (com o .unitypackage dentro), pela importação de sempre; desistir no resumo ──
    const antes = (await ev(() => C.listarPersonagens())).length;
    await menu("Personagem", "Importar ZIP ou .vrm...");
    await escolherArquivo(arqBooth);
    texto = await resumo();
    ok(/23 ossos/.test(texto) && /Avatar convertido: Avatar_v1\.0/.test(await ev(() => document.querySelector(".lnux-dialogo:last-of-type h2").textContent)),
      "um ZIP como os do BOOTH (o .unitypackage e os termos de uso) também abre, pela importação de sempre");
    await botaoDoDialogo("Cancelar");
    await esperar(500);
    ok((await ev(() => C.listarPersonagens())).length === antes && (await ev(() => window.Companhia.atual.nome)) === "avatar-do-unity", "Cancelar no resumo não importa nada");

    // ── .fbx com as texturas ao lado (ossos pelos nomes, TGA pedido pelo .fbx, PSD pelo nome do material) ──
    await menu("Personagem", "Importar avatar do Unity (.unitypackage, .fbx)...");
    await escolherArquivo(arqFbx);
    texto = await resumo();
    ok(/23 ossos reconhecidos pelos nomes dos ossos/.test(texto) && /3 de 3 com textura/.test(texto) && !/pelos materiais do Unity/.test(texto),
      "um ZIP com o .fbx e as texturas: os ossos pelos nomes do Blender (\"Left arm\", \"Left knee\"...) e as 3 texturas (TGA, PSD e PNG)");
    await botaoDoDialogo("Importar");
    await aberta("avatar-fbx");
    c = await personagem();
    ok(c.leftHand[1] < c.leftUpperArm[1] - 0.15 && c.leftHand[0] > 0.1 && Math.abs(c.pe - 0.04) < 0.05, "o avatar do .fbx também fica de frente, com os braços para baixo e os pés no chão");
    await pagina.click('button:text-is("Corpo")');
    await esperar(1200);
    const cara2 = await corNaTela("head", [0, 0.1, 0.13]), peito2 = await corNaTela("chest", [0, 0.08, 0.12]);
    ok(vermelho(cara2) && verde(peito2), `a textura do .psd (cabeça ${cara2}) e a do .tga pedida pelo .fbx (roupa ${peito2}) aparecem do lado certo`);

    // ── andar com a personagem convertida ──
    await ev(() => window.Companhia.estudio.alternarAndar(true));
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.andando, null, { timeout: 5000 });
    await pagina.mouse.click(300, 420);
    const z0 = await ev(() => window.Companhia.palco.raiz.position.z);
    await pagina.keyboard.down("KeyW");
    await pagina.waitForFunction((z) => window.Companhia.palco.raiz.position.z > z + 0.5, z0, { timeout: 20000 }).catch(() => {});
    await pagina.keyboard.up("KeyW");
    const andou = await ev(() => ({ z: window.Companhia.palco.raiz.position.z, y: window.Companhia.palco.raiz.position.y, estado: window.Companhia.palco.mundo.estado }));
    ok(andou.z > z0 + 0.5 && Math.abs(andou.y) < 0.05, `anda pelo cenário com W A S D (foi até z = ${andou.z.toFixed(2)} m)`);
    await ev(() => window.Companhia.estudio.alternarAndar(false));

    // ── soltar no palco: o pacote de avatar vira personagem; o de mundo, cenário ──
    await soltar([["outro-avatar.unitypackage", pacote]]);
    texto = await resumo();
    ok(/23 ossos/.test(texto), "soltar um .unitypackage de avatar no palco (com uma personagem 3D aberta) converte o avatar");
    await botaoDoDialogo("Cancelar");
    await esperar(400);
    await soltar([["mundo.unitypackage", mundo]]);
    await pagina.waitForFunction(() => window.Companhia.palco.mundo.info && window.Companhia.palco.mundo.colisor, null, { timeout: 30000 });
    ok(await ev(() => !document.querySelector("#avatar-convertido") && window.Companhia.palco.mundo.info.principal === "mundo.glb"), "um .unitypackage de mundo solto no palco continua virando cenário");

    // ── pacote sem esqueleto ──
    await menu("Personagem", "Importar avatar do Unity (.unitypackage, .fbx)...");
    await escolherArquivo(arqSemEsqueleto);
    await pagina.waitForFunction(() => [...document.querySelectorAll(".lnux-aviso")].some((a) => /não tem esqueleto/.test(a.textContent)), null, { timeout: 30000 }).catch(() => {});
    ok(await ev(() => [...document.querySelectorAll(".lnux-aviso")].some((a) => /não tem esqueleto/.test(a.textContent) && /Cenário/.test(a.textContent))),
      "um pacote sem esqueleto explica que não dá para virar personagem (e que cenário abre em Movimento › Cenário)");
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));

    // ── recarregar: as personagens convertidas continuam ──
    await pagina.reload();
    await pagina.waitForFunction(() => window.Companhia && window.Companhia.live2d !== undefined, null, { timeout: 60000 });
    await esperar(1500);
    const lista = await ev(() => C.listarPersonagens().then((l) => l.map((p) => p.nome)));
    const id = await ev(() => C.listarPersonagens().then((l) => l.find((p) => p.nome === "avatar-do-unity").id));
    await ev((id) => window.Companhia.abrirPersonagem(id), id);
    await aberta("avatar-do-unity");
    c = await personagem();
    ok(lista.includes("avatar-do-unity") && lista.includes("avatar-fbx") && c.molas >= 2 && c.mats.Corpo.textura, "ao abrir de novo, as personagens convertidas estão guardadas e abrem iguais");
    ok(consola.length === 0, "sem erros no console depois de recarregar" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("erro: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-avatar-erro.png") }); } catch (e2) { /* sem tela */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (avatares): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
