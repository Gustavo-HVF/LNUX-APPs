// Teste do compositor WebGL2 do Vídeo (apps/video/render.js) no Chromium: compila todos os efeitos e confere pixels.
// Rode com: python3 tests/testar_navegador.py render
const { chromium } = require("playwright");
const BASE = process.env.LNUX_TESTE_BASE || "http://127.0.0.1:8124";
const erros = [];
let passos = 0;
const ok = (c, m) => { if (c) { passos++; console.log("  ✔ " + m); } else { erros.push(m); console.log("  ✖ " + m); } };

(async () => {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  const consola = [];
  pagina.on("pageerror", (e) => consola.push(e.message));
  pagina.on("console", (m) => m.type() === "error" && consola.push(m.text()));
  await pagina.goto(BASE + "/apps.json");
  await pagina.setContent(`<canvas id="c"></canvas>
    <script src="${BASE}/apps/video/catalogo.js"></script><script src="${BASE}/apps/video/edicao.js"></script><script src="${BASE}/apps/video/render.js"></script>`);
  await pagina.waitForFunction(() => window.V && V.Render);
  const r = await pagina.evaluate(async () => {
    const saida = {};
    const canvas = document.getElementById("c");
    const R = new V.Render(canvas);
    saida.webgl2 = R.ok;
    if (!R.ok) return saida;
    // 1) todos os efeitos compilam
    saida.falharam = [];
    for (const def of V.EFEITOS_VIDEO) { try { R.programaDoEfeito(def); } catch (e) { saida.falharam.push(def.id + ": " + e.message.slice(0, 300)); } }
    // projeto de teste 64×36
    const base = (extra) => Object.assign({ id: "c" + Math.random(), trilha: "V1", tipo: "cor", cor: "#ff0000", inicio: 0, duracao: 10, entrada: 0,
      mov: { posX: 32, posY: 18, escala: 100, escalaLargura: 100, uniforme: true, rotacao: 0, ancoraX: 32, ancoraY: 18 }, opac: { valor: 100, mistura: "normal" },
      rec: { esquerda: 0, topo: 0, direita: 0, baixo: 0, suavizar: 0 }, efeitos: [], anim: {} }, extra);
    const proj = (clipes, extra = {}) => Object.assign({ largura: 64, altura: 36, fundo: "#000000", midias: {}, transicoes: [], trilhas: [{ id: "V2", tipo: "video" }, { id: "V1", tipo: "video" }], clipes }, extra);
    const px = (x, y) => { const a = R.amostra(64, 36); const i = (y * 64 + x) * 4; return [a.px[i], a.px[i + 1], a.px[i + 2]]; };
    const semFonte = () => null;
    R.desenhar(proj([base()]), 1, semFonte); saida.vermelho = px(32, 18);
    const inv = base(); inv.efeitos = [Object.assign(V.novoEfeito("inverter"), {})]; R.desenhar(proj([inv]), 1, semFonte); saida.invertido = px(32, 18);
    // mistura "tela": vermelho (V1) + azul (V2) = magenta
    R.desenhar(proj([base(), base({ trilha: "V2", cor: "#0000ff", opac: { valor: 100, mistura: "tela" } })]), 1, semFonte); saida.tela = px(32, 18);
    // recorte: corta metade da direita do clipe de cima
    R.desenhar(proj([base(), base({ trilha: "V2", cor: "#00ff00", rec: { esquerda: 0, topo: 0, direita: 50, baixo: 0, suavizar: 0 } })]), 1, semFonte); saida.recorte = [px(10, 18), px(54, 18)];
    // movimento: escala 50% e posição no canto: o centro fica preto, o canto vermelho
    R.desenhar(proj([base({ mov: { posX: 16, posY: 9, escala: 50, escalaLargura: 100, uniforme: true, rotacao: 0, ancoraX: 32, ancoraY: 18 } })]), 1, semFonte); saida.movimento = [px(16, 9), px(48, 27)];
    // rotação 90° de um retângulo largo (só largura 50%): vira alto
    R.desenhar(proj([base({ mov: { posX: 32, posY: 18, escala: 30, escalaLargura: 200, uniforme: false, rotacao: 90, ancoraX: 32, ancoraY: 18 } })]), 1, semFonte); saida.rotacao = [px(32, 4), px(12, 18)];
    // opacidade animada por quadro-chave: 0 em 0 s, 100 em 2 s → metade em 1 s
    const anim = base(); anim.anim = { "opac.valor": [{ t: 0, v: 0, i: "linear" }, { t: 2, v: 100, i: "linear" }] }; R.desenhar(proj([anim]), 1, semFonte); saida.animado = px(32, 18);
    // transição "limpar" da esquerda entre vermelho e verde (corte em 5 s, 2 s): em 5 s, metade de cada
    const a = base({ id: "A", duracao: 5 }), b = base({ id: "B", inicio: 5, cor: "#00ff00" });
    R.desenhar(proj([a, b], { transicoes: [{ id: "t", trilha: "V1", a: "A", b: "B", tipo: "limpar", duracao: 2, direcao: 0 }] }), 5, semFonte); saida.limpar = [px(8, 18), px(56, 18)];
    R.desenhar(proj([a, b], { transicoes: [{ id: "t", trilha: "V1", a: "A", b: "B", tipo: "dissolver", duracao: 2 }] }), 5, semFonte); saida.dissolver = px(32, 18);
    R.desenhar(proj([a, b], { transicoes: [{ id: "t", trilha: "V1", a: "A", b: "B", tipo: "preto", duracao: 2 }] }), 5, semFonte); saida.preto = px(32, 18);
    // camada de ajuste com preto e branco por cima do vermelho
    const aj = base({ trilha: "V2", tipo: "ajuste" }); aj.efeitos = [V.novoEfeito("preto-branco")]; R.desenhar(proj([base(), aj]), 1, semFonte); saida.ajuste = px(32, 18);
    // texto branco no meio, sobre o preto
    const t = base({ tipo: "texto", mov: { posX: 32, posY: 18, escala: 100, escalaLargura: 100, uniforme: true, rotacao: 0, ancoraX: 32, ancoraY: 18 }, texto: { conteudo: "███", tamanho: 60, cor: "#ffffff", posicao: "meio", animacao: "nenhuma" } });
    R.desenhar(proj([t]), 1, semFonte); saida.texto = px(32, 18);
    // efeito de cor (Lumetri) com saturação 0
    const cor = base(); const fx = V.novoEfeito("cor"); fx.params.saturacao = 0; cor.efeitos = [fx]; R.desenhar(proj([cor]), 1, semFonte); saida.lumetri = px(32, 18);
    // todos os efeitos rodam sem erro num quadro
    saida.rodaram = 0;
    for (const def of V.EFEITOS_VIDEO) { const c = base(); c.efeitos = [V.novoEfeito(def.id)]; R.desenhar(proj([c]), 1, semFonte); saida.rodaram++; }
    saida.erroGL = R.gl.getError();
    return saida;
  });
  ok(r.webgl2, "o Chromium tem WebGL2");
  ok(r.falharam && r.falharam.length === 0, `os ${31} efeitos de vídeo compilam` + (r.falharam && r.falharam.length ? ":\n    " + r.falharam.join("\n    ") : ""));
  const perto = (a, b, tol = 12) => a && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  ok(perto(r.vermelho, [255, 0, 0]), `cor sólida: ${r.vermelho}`);
  ok(perto(r.invertido, [0, 255, 255]), `inverter cores: ${r.invertido}`);
  ok(perto(r.tela, [255, 0, 255]), `modo de mistura "tela" (vermelho + azul = magenta): ${r.tela}`);
  ok(perto(r.recorte[0], [0, 255, 0]) && perto(r.recorte[1], [255, 0, 0]), `recorte: verde à esquerda, vermelho à direita: ${JSON.stringify(r.recorte)}`);
  ok(perto(r.movimento[0], [255, 0, 0]) && perto(r.movimento[1], [0, 0, 0]), `posição e escala: ${JSON.stringify(r.movimento)}`);
  ok(perto(r.rotacao[0], [255, 0, 0]) && perto(r.rotacao[1], [0, 0, 0]), `rotação de 90° com largura diferente: ${JSON.stringify(r.rotacao)}`);
  ok(perto(r.animado, [128, 0, 0], 8), `opacidade por quadro-chave na metade: ${r.animado}`);
  ok(perto(r.limpar[0], [0, 255, 0]) && perto(r.limpar[1], [255, 0, 0]), `transição cortina: entra pela esquerda: ${JSON.stringify(r.limpar)}`);
  ok(perto(r.dissolver, [128, 128, 0], 10), `dissolução cruzada na metade: ${r.dissolver}`);
  ok(perto(r.preto, [0, 0, 0], 10), `mergulhar no preto: preto no corte: ${r.preto}`);
  ok(perto(r.ajuste, [54, 54, 54], 14), `camada de ajuste preto e branco por cima do vermelho: ${r.ajuste}`);
  ok(perto(r.texto, [255, 255, 255], 30), `texto branco desenhado: ${r.texto}`);
  ok(perto(r.lumetri, [54, 54, 54], 16), `Cor (Lumetri) com saturação 0: ${r.lumetri}`);
  ok(r.rodaram === 31 && r.erroGL === 0, `cada efeito roda num quadro sem erro do WebGL (${r.rodaram})`);
  ok(consola.length === 0, "nenhum erro no console" + (consola.length ? ":\n    " + consola.join("\n    ") : ""));
  await navegador.close();
  console.log(`\n${passos} ok · ${erros.length} falharam`);
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
