// Teste dos mundos do Unity com física: malhas e texturas guardadas pelo Unity, colisores, plantas que atravessam e
// dobram, objetos que caem, rolam, são chutados e pegos. No Chromium.
// Rode com: python3 tests/testar_navegador.py companhia_fisica
//
// Não baixa nada: o mundo é montado aqui (tests/navegador/companhia_arquivos.js: mundoUnityComFisica), sem .fbx, como
// os mundos exportados com as peças separadas: malhas .asset (uma crua, uma comprimida), texturas Texture2D .asset
// (RGBA32 e DXT1), cubos do Unity, BoxCollider/SphereCollider, Rigidbody, VRC Pickup, uma sala desligada e o ponto de
// nascer do VRChat.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { mundoUnityComFisica, malhaUnity, caixaUnity, texturaUnity } = require("./companhia_arquivos.js");

const PASTA = process.env.LNUX_TESTE_SAIDA || __dirname;
const TOKEN = process.env.LNUX_TESTE_TOKEN || fs.readFileSync(path.join(PASTA, "token.txt"), "utf8").trim();
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8123";
const RUIDO = /Failed to load resource|voz do navegador|GPU stall|não tem esqueleto/;
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const { pacote } = mundoUnityComFisica();
  const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 }, locale: "pt-BR" });
  await contexto.route(/cubism\.live2d\.com|\/api\/live2d\/core/, (r) => r.fulfill({ status: 404, body: "" }));
  const pagina = await contexto.newPage();
  const consola = [];
  pagina.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text())) consola.push(m.text()); });
  pagina.on("pageerror", (e) => consola.push("[pageerror] " + e.message));
  const ev = (f, a) => pagina.evaluate(f, a);
  const esperar = (ms) => pagina.waitForTimeout(ms);

  try {
    // ── entra numa sala (o mundo anda com a personagem padrão) ──
    await pagina.goto(`${BASE}/apps/companhia/#token=${TOKEN}`);
    await pagina.waitForSelector(".tela-inicio #inicio-sem-conta", { timeout: 30000 });
    await pagina.click("#inicio-sem-conta");
    await pagina.fill("#inicio-nome", "Fabi");
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
    await esperar(800);

    // ── os leitores: malha crua e comprimida, texturas RGBA32 e DXT1, o que é planta ──
    const leitores = await ev(async ([crua, comp, rgba, dxt]) => {
      const faces = (g) => { // a ordem dos cantos contra a normal guardada: quantas concordam
        const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array; let a = 0, d = 0;
        for (let k = 0; k < I.length; k += 3) {
          const [i0, i1, i2] = [I[k], I[k + 1], I[k + 2]], e1 = [0, 1, 2].map((j) => P[i1 * 3 + j] - P[i0 * 3 + j]), e2 = [0, 1, 2].map((j) => P[i2 * 3 + j] - P[i0 * 3 + j]);
          const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          if (f[0] * (N[i0 * 3] + N[i1 * 3] + N[i2 * 3]) + f[1] * (N[i0 * 3 + 1] + N[i1 * 3 + 1] + N[i2 * 3 + 1]) + f[2] * (N[i0 * 3 + 2] + N[i1 * 3 + 2] + N[i2 * 3 + 2]) > 0) a++; else d++;
        }
        return [a, d];
      };
      const g1 = C.unityMalha.ler(crua), g2 = C.unityMalha.ler(comp);
      g2.computeBoundingBox();
      const px = (t, x, y) => [...t.getContext("2d").getImageData(x, y, 1, 1).data];
      const t1 = await C.unityTextura.imagem(rgba), t2 = await C.unityTextura.imagem(dxt);
      const T = window.THREE, malha = (nome, mat) => { const m = new T.Mesh(new T.PlaneGeometry(0.5, 0.5), mat || new T.MeshStandardMaterial()); m.name = nome; return m; };
      const recortado = new T.MeshStandardMaterial({ alphaTest: 0.5, map: new T.Texture() });
      return {
        crua: { tris: g1.index.count / 3, faces: faces(g1), uv: !!g1.attributes.uv },
        comp: { tris: g2.index.count / 3, faces: faces(g2), caixa: [g2.boundingBox.min.toArray(), g2.boundingBox.max.toArray()].flat().map((v) => +v.toFixed(2)) },
        rgba: [t1.como, px(t1.tela, 0, 0), px(t1.tela, 0, 1)], dxt: [t2.como, px(t2.tela, 2, 2)],
        planta: [C.colisao.ehPlanta(malha("Grass_01")), C.colisao.ehPlanta(malha("Fence_Wire")), C.colisao.ehPlanta(malha("Cartao", recortado)), C.colisao.ehPlanta(malha("Mesa"))],
      };
    }, [malhaUnity("Grama", require("./companhia_arquivos.js").caixaUnity(1)), malhaUnity("Caixa", caixaUnity(1), { comprimida: true }),
      texturaUnity("t", 2, 2, 4, Buffer.from([220, 30, 30, 255, 220, 30, 30, 255, 30, 30, 220, 255, 30, 30, 220, 255])),
      (() => { const d = Buffer.alloc(8); d.writeUInt16LE(0x07e0, 0); return texturaUnity("g", 4, 4, 10, d); })()]);
    ok(leitores.crua.tris === 12 && leitores.crua.faces[1] === 0 && leitores.crua.uv, `malha .asset crua do Unity: 12 triângulos, as faces viradas para fora (${leitores.crua.faces})`);
    ok(leitores.comp.tris === 12 && leitores.comp.faces[1] === 0 && leitores.comp.caixa.every((v, i) => Math.abs(Math.abs(v) - 0.5) < 0.01),
      `malha .asset comprimida (PackedBitVector): 12 triângulos, as faces para fora e o tamanho certo (${leitores.comp.caixa})`);
    ok(leitores.rgba[0] === "lida" && leitores.rgba[1][2] > 200 && leitores.rgba[2][0] > 200 && leitores.dxt[0] === "lida" && leitores.dxt[1][1] > 240 && leitores.dxt[1][0] < 10,
      `Texture2D .asset: RGBA32 de cabeça para cima (em cima azul, embaixo vermelho) e DXT1 (verde): ${JSON.stringify(leitores.rgba.slice(1))} ${JSON.stringify(leitores.dxt[1])}`);
    ok(JSON.stringify(leitores.planta) === "[true,false,true,false]", `o que é planta: pelo nome (grama sim, cerca não) e por ser pequena e recortada: ${JSON.stringify(leitores.planta)}`);

    // ── converter o mundo: a cena montada, com a física nos extras do .glb ──
    const conv = await ev(async (b64) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
      const arqs = await C.mapas.preparar(new Map([["mundo.unitypackage", blob]]));
      const r = await C.conversor.juntarGLB(arqs, { cena: C.unityCena.cenas(arqs)[0] });
      window.__glb = r.glb;
      const gltf = await C.carregadorGLTF().parseAsync(await r.glb.arrayBuffer(), "");
      const nomes = [], corpos = [];
      let raiz = null, grama = null;
      gltf.scene.traverse((o) => { if (o.name) nomes.push(o.name); const w = o.userData.webc; if (w && w.corpo) corpos.push([o.name, w.corpo.pegavel, w.corpo.forma && w.corpo.forma.tipo, w.corpo.quique]); if (w && w.versao) raiz = w; if (o.name === "Grass_Patch") grama = w; });
      let texturas = 0;
      gltf.scene.traverse((o) => { if (o.isMesh && o.material.map) texturas++; });
      return { asset: [...arqs.keys()].filter((n) => /\.asset$/.test(n)).length, fisica: r.fisica, avisos: r.avisos, corpos, raiz, grama, texturas,
        salao: nomes.filter((n) => /^Coluna.\d/.test(n)).length, quest: nomes.filter((n) => /^Coluna.Q/.test(n)).length, gatilho: nomes.includes("Gatilho") };
    }, pacote.toString("base64"));
    ok(conv.asset === 4 && conv.texturas >= 2, `o pacote sem .fbx: as malhas e texturas .asset ficam (${conv.asset}) e viram desenho com textura (${conv.texturas} peças com textura)`);
    ok(conv.fisica && conv.fisica.colisores === 2 && conv.fisica.corpos === 2 && conv.fisica.pegaveis === 1 && conv.raiz && conv.raiz.colisoesDoUnity,
      `a física do Unity vai junto: 2 colisores sólidos (o gatilho não), 2 corpos, 1 de pegar: ${JSON.stringify(conv.fisica)}`);
    ok(conv.corpos.some((c) => c[0] === "Ball" && !c[1] && c[2] === "esfera" && c[3] === 0.7) && conv.corpos.some((c) => /^Pickup.Box$/.test(c[0]) && c[1] && c[2] === "caixa"),
      `os corpos: a bola (esfera, quica 0,7 pelo material de física) e a caixa de pegar: ${JSON.stringify(conv.corpos)}`);
    ok(conv.grama && conv.grama.colide === false && conv.salao === 12 && conv.quest === 0 && conv.raiz.partida && Math.abs(conv.raiz.partida.pos[2] - 1) < 0.01,
      `a grama sem colisor fica atravessável; a sala desligada entra (${conv.salao} colunas) e a versão Quest não (${conv.quest}); o ponto de nascer vem do VRChat (${JSON.stringify(conv.raiz.partida)})`);

    // ── no jogo ──
    const aberto = await ev(async () => {
      const m = window.Companhia.palco.mundo;
      await m.abrirMapa(new Map([["mundo.glb", window.__glb]]), { nome: "Mundo de teste" });
      const T = window.THREE, p = m.palco.raiz.position;
      const raio = (o, d) => { const t = m.colisor.geometry.boundsTree.raycastFirst(new T.Ray(new T.Vector3(...o), new T.Vector3(...d).normalize()), T.DoubleSide); return t ? +t.distance.toFixed(2) : null; };
      const planta = m.plantas && m.plantas.plantas[0];
      return { pos: p.toArray().map((v) => +v.toFixed(2)), rumo: +m.rumo.toFixed(2), corpos: m.fisica.corpos.length, plantas: m.plantas ? m.plantas.plantas.length : 0, dobra: !!(planta && [].concat(planta.material)[0].userData.dobra),
        frente: raio([0, 0.4, 1], [0, 0, 1]), gatilho: raio([0, 1, -1], [0, 0, -1]), escala: m.info.ajuste.escala };
    });
    ok(Math.abs(aberto.pos[0]) < 0.05 && Math.abs(aberto.pos[2] - 1) < 0.05 && Math.abs(aberto.pos[1]) < 0.05 && aberto.escala === 1, `nasce no ponto do VRChat, em pé no chão: ${JSON.stringify(aberto.pos)} (rumo ${aberto.rumo})`);
    ok(aberto.frente > 4.5 && aberto.frente < 5 && aberto.gatilho === null, `a colisão: a grama e o gatilho não seguram (o raio só bate na parede, a ${aberto.frente} m)`);
    ok(aberto.plantas === 1 && aberto.dobra && aberto.corpos === 2, `a grama dobra (o efeito no material) e os 2 corpos passam a ter física`);
    // o céu do cenário é do mundo: trocar o tema da pessoa não muda
    const ceu = await ev(async () => {
      const m = window.Companhia.palco.mundo, antes = m.palco.cena.background, atual = C.temas.atual;
      const outro = (C.temas.lista ? Object.keys(C.temas.lista) : ["contrast", "webc"]).find((t) => t !== atual) || "contrast";
      C.temas.definir(outro);
      await new Promise((r) => setTimeout(r, 200));
      const depois = m.palco.cena.background;
      C.temas.definir(atual);
      return { ceu: !!(antes && antes.userData && antes.userData.ceuDoMundo), igual: antes === depois, tema: outro };
    });
    ok(ceu.ceu && ceu.igual, `o céu do cenário é do mundo: trocar o tema (para ${ceu.tema}) não muda o céu`);

    // a bola cai, quica (o material de física dela quica 0,7) e fica no chão
    await pagina.waitForFunction(() => { const c = window.Companhia.palco.mundo.fisica.corpos.find((x) => /Ball/.test(x.id)); return c.dormindo; }, null, { timeout: 20000 }).catch(() => {});
    const bola = await ev(() => { const c = window.Companhia.palco.mundo.fisica.corpos.find((x) => /Ball/.test(x.id)), v = new THREE.Vector3(); window.Companhia.palco.mundo.fisica.centroDe(c, v); return v.toArray().map((x) => +x.toFixed(2)); });
    ok(Math.abs(bola[1] - 0.2) < 0.05 && Math.abs(bola[0] - -2) < 0.3, `a bola cai e para no chão (centro a ${bola[1]} m, raio 0,2): ${JSON.stringify(bola)}`);

    // andar pela grama: atravessa (e a grama se afasta)
    const andar = async (x, z, giro, ms) => {
      await ev(([x, z, giro]) => { const m = window.Companhia.palco.mundo; m.palco.raiz.position.set(x, 0, z); m.vel.set(0, 0, 0); m.cam.giro = giro; m.rumo = giro + Math.PI; }, [x, z, giro]);
      await pagina.keyboard.down("KeyW"); await esperar(ms); await pagina.keyboard.up("KeyW"); await esperar(300);
      return ev(() => window.Companhia.palco.mundo.palco.raiz.position.toArray().map((v) => +v.toFixed(2)));
    };
    const depois = await andar(0, 1.6, Math.PI, 2500);
    const pessoas = await ev(() => window.Companhia.palco.mundo.plantas.uniformes.uPessoas.value[0].toArray());
    // (sólida, a grama, que vai de z 2,4 a 3,6, pararia a pessoa em uns 2,1)
    ok(depois[2] > 3.0, `andar contra a grama: passa por ela (de z 1,6 para ${depois[2]}; sólida, pararia em ~2,1)`);
    ok(pessoas[3] > 0 && Math.abs(pessoas[2] - depois[2]) < 0.6, "a grama sabe onde a pessoa está (para se afastar dela)");
    const parede = await andar(0, 4.5, Math.PI, 2000);
    ok(parede[2] < 5.75, `a parede (com colisor) segura: parou em z ${parede[2]}`);

    // chutar a bola: andar contra ela
    const antes = bola;
    await andar(-2, antes[2] - 1.4, Math.PI, 1600);
    await esperar(800);
    const chutada = await ev(() => { const c = window.Companhia.palco.mundo.fisica.corpos.find((x) => /Ball/.test(x.id)), v = new THREE.Vector3(); window.Companhia.palco.mundo.fisica.centroDe(c, v); return v.toArray().map((x) => +x.toFixed(2)); });
    ok(chutada[2] - antes[2] > 0.6, `andar contra a bola chuta ela para a frente (z ${antes[2]} → ${chutada[2]})`);

    // pegar a caixa (E), levar e jogar (segurar o E)
    await ev(() => { const m = window.Companhia.palco.mundo; m.palco.raiz.position.set(1.5, 0, -0.5); m.vel.set(0, 0, 0); m.cam.giro = Math.PI; m.rumo = 0; });
    await esperar(300);
    const perto = await ev(() => { const c = window.Companhia.palco.mundo.fisica.maisPerto(); return c && c.id; });
    await pagina.keyboard.press("KeyE");
    await esperar(400);
    const pega = await ev(() => { const f = window.Companhia.palco.mundo.fisica; return { segurando: f.segurando && f.segurando.id, sala: f.paraSala() }; });
    ok(perto && /Pickup.Box/.test(perto) && pega.segurando === perto && pega.sala && pega.sala[0][11] === 1, `E pega o objeto de pegar mais perto (${perto}) e a sala fica sabendo (na mão)`);
    // anda com ela na mão: vai junto
    const levada = await andar(1.5, -0.5, Math.PI, 1500);
    const naMao = await ev(() => { const f = window.Companhia.palco.mundo.fisica, v = new THREE.Vector3(); f.centroDe(f.segurando, v); return v.distanceTo(window.Companhia.palco.mundo.palco.raiz.position); });
    ok(levada[2] > 0.3 && naMao < 1.2, `levando na mão: a caixa vai junto (a ${naMao.toFixed(2)} m dos pés)`);
    const ondeSoltou = await ev(() => { const f = window.Companhia.palco.mundo.fisica, v = new THREE.Vector3(); f.centroDe(f.segurando, v); return v.toArray(); });
    await pagina.keyboard.down("KeyE"); await esperar(1100); await pagina.keyboard.up("KeyE");
    await esperar(3000);
    const jogada = await ev((o) => { const f = window.Companhia.palco.mundo.fisica, c = f.porId.get([...f.porId.keys()].find((k) => /Pickup/.test(k))), v = new THREE.Vector3(); f.centroDe(c, v); return { longe: v.distanceTo(new THREE.Vector3(...o)), y: v.y, segurando: !!f.segurando }; }, ondeSoltou);
    ok(!jogada.segurando && jogada.longe > 1.5 && jogada.y < 0.5, `segurar e soltar o E joga a caixa: caiu a ${jogada.longe.toFixed(1)} m (e ficou no chão: ${jogada.y.toFixed(2)} m)`);

    // o que vem da sala: outra pessoa mexeu na bola
    const remoto = await ev(async () => {
      const f = window.Companhia.palco.mundo.fisica, id = [...f.porId.keys()].find((k) => /Ball/.test(k));
      for (let i = 0; i < 8; i++) { f.receber("alguem", [[id, 3, 0.2, -3, 0, 0, 0, 1, 0, 0, 0, 0]]); await new Promise((r) => setTimeout(r, 100)); }
      const v = new THREE.Vector3(); f.centroDe(f.porId.get(id), v);
      return v.toArray().map((x) => +x.toFixed(2));
    });
    ok(Math.abs(remoto[0] - 3) < 0.4 && Math.abs(remoto[2] + 3) < 0.4, `a bola vai para onde a outra pessoa da sala mandou: ${JSON.stringify(remoto)}`);
    await pagina.screenshot({ path: path.join(PASTA, "companhia-fisica.png") });
    ok(consola.length === 0, "sem erros no console" + (consola.length ? ": " + consola.slice(0, 3).join(" | ") : ""));
  } catch (e) {
    erros.push("exceção: " + (e && e.stack || e));
    console.log("  ✖ " + (e && e.stack || e));
    try { await pagina.screenshot({ path: path.join(PASTA, "companhia-fisica-erro.png") }); } catch (x) { /* nada */ }
  } finally {
    await navegador.close();
  }
  console.log(`\nCompanhia (física dos mundos do Unity): ${passos} ok, ${erros.length} com problema.`);
  process.exit(erros.length ? 1 : 0);
})();
