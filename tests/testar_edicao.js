// Testes da álgebra de edição do Vídeo (apps/video/edicao.js), só com o Node. Uso: node tests/testar_edicao.js
const path = require("path");
const V = require(path.join(__dirname, "..", "apps", "video", "edicao.js"));
let ok = 0, falhas = 0;
function caso(nome, f) { try { f(); ok++; console.log("  ✔ " + nome); } catch (e) { falhas++; console.log("  ✖ " + nome + "\n    " + e.message); } }
function igual(a, b, msg) { if (Math.abs(a - b) > 1e-6) throw new Error(`${msg}: esperava ${b}, veio ${a}`); }
function verdade(c, msg) { if (!c) throw new Error(msg); }

// Projeto: V1 com A [0,4) e B [4,10); A1 com o áudio vinculado de A. Mídia de 20 s.
function projeto() {
  return {
    midias: { m: { tipo: "video", duracao: 20 }, i: { tipo: "imagem" } },
    trilhas: [{ id: "V1", tipo: "video" }, { id: "A1", tipo: "audio" }],
    clipes: [
      { id: "A", trilha: "V1", tipo: "midia", midia: "m", inicio: 0, entrada: 2, duracao: 4, velocidade: 1, vinculo: "x", anim: { "opac.valor": [{ t: 1, v: 0 }, { t: 3, v: 100 }] } },
      { id: "Aa", trilha: "A1", tipo: "midia", midia: "m", inicio: 0, entrada: 2, duracao: 4, velocidade: 1, vinculo: "x" },
      { id: "B", trilha: "V1", tipo: "midia", midia: "m", inicio: 4, entrada: 10, duracao: 6, velocidade: 1 },
    ],
    transicoes: [],
  };
}
const por = (p, id) => p.clipes.find((c) => c.id === id);

caso("cortar: duas partes, a da direita continua a mídia e leva os quadros-chave deslocados", () => {
  const p = projeto(); const b = V.cortar(p, por(p, "A"), 2.5);
  igual(por(p, "A").duracao, 2.5, "duração da esquerda"); igual(b.inicio, 2.5, "início da direita"); igual(b.entrada, 4.5, "entrada da direita");
  igual(b.anim["opac.valor"][0].t, -1.5, "quadro-chave deslocado");
});
caso("adicionar corte em várias trilhas mantém o vídeo e o áudio vinculados em par", () => {
  const p = projeto(); const novos = V.adicionarCorte(p, ["V1", "A1"], 1);
  verdade(novos.length === 2 && novos[0].vinculo === novos[1].vinculo && novos[0].vinculo !== "x", "par novo");
});
caso("inserir empurra tudo em todas as trilhas e corta o que atravessa o ponto", () => {
  const p = projeto();
  V.inserir(p, [{ id: "N", trilha: "V1", tipo: "midia", midia: "m", entrada: 0, duracao: 3, inicio: 0 }], 2);
  igual(por(p, "N").inicio, 2, "novo no ponto"); igual(por(p, "A").duracao, 2, "A cortado"); igual(por(p, "B").inicio, 7, "B empurrado");
  const resto = p.clipes.find((c) => c.trilha === "V1" && Math.abs(c.inicio - 5) < 1e-9); verdade(resto && Math.abs(resto.entrada - 4) < 1e-9, "a outra metade de A em 5 s");
  const audio = p.clipes.filter((c) => c.trilha === "A1").sort((a, b) => a.inicio - b.inicio); igual(audio[1].inicio, 5, "o áudio também abriu espaço");
});
caso("sobrescrever cobre só a trilha do clipe novo", () => {
  const p = projeto();
  V.sobrescrever(p, [{ id: "N", trilha: "V1", tipo: "midia", midia: "m", entrada: 0, duracao: 3, inicio: 0 }], 3);
  igual(por(p, "A").duracao, 3, "A aparado"); igual(por(p, "B").inicio, 6, "B aparado no começo"); igual(por(p, "B").entrada, 12, "entrada de B andou"); igual(por(p, "Aa").duracao, 4, "o áudio não mudou");
});
caso("levantar deixa o buraco; extrair fecha", () => {
  let p = projeto(); V.levantar(p, ["V1", "A1"], 1, 5);
  igual(por(p, "A").duracao, 1, "A até 1"); igual(por(p, "B").inicio, 5, "B começa em 5"); igual(V.duracaoTotal(p), 10, "duração igual");
  p = projeto(); V.extrair(p, ["V1", "A1"], 1, 5); igual(por(p, "B").inicio, 1, "B puxado para 1"); igual(V.duracaoTotal(p), 6, "ficou 4 s mais curto");
});
caso("apagar com ondulação fecha o buraco do clipe na trilha", () => {
  const p = projeto(); V.apagarComOndulacao(p, new Set(["A", "Aa"]));
  igual(por(p, "B").inicio, 0, "B veio para o começo");
});
caso("aparar o fim respeita o tamanho da mídia; aparar o começo não passa do começo da mídia", () => {
  const p = projeto(); const b = por(p, "B");
  igual(V.aparar(p, b, "fim", 100), 4, "só cresce até a mídia acabar (20 s)"); igual(b.duracao, 10, "duração");
  const a = por(p, "A"); V.aparar(p, a, "inicio", -10); igual(a.inicio, 0, "não passa do zero"); igual(a.entrada, 2, "nem da mídia");
  V.aparar(p, a, "inicio", 1); igual(a.inicio, 1, "começo em 1"); igual(a.entrada, 3, "entrada 3"); igual(a.anim["opac.valor"][0].t, 0, "quadro-chave ficou na mesma imagem");
});
caso("aparar com ondulação puxa o resto da trilha junto (e o áudio vinculado)", () => {
  const p = projeto(); V.apararOndulacao(p, por(p, "A"), "fim", -1);
  igual(por(p, "A").duracao, 3, "A encurtou"); igual(por(p, "Aa").duracao, 3, "o áudio vinculado também"); igual(por(p, "B").inicio, 3, "B veio junto");
  const q = projeto(); V.apararOndulacao(q, por(q, "A"), "inicio", 1);
  igual(por(q, "A").inicio, 0, "A fica no lugar"); igual(por(q, "A").entrada, 3, "mas mostra a partir de 3"); igual(por(q, "B").inicio, 3, "B veio 1 s para trás");
});
caso("edição rolante move o corte entre A e B sem mudar o total", () => {
  const p = projeto(); const d = V.apararRolagem(p, por(p, "A"), por(p, "B"), 1);
  igual(d, 1, "andou 1 s"); igual(por(p, "A").duracao, 5, "A cresceu"); igual(por(p, "B").inicio, 5, "B começa depois"); igual(por(p, "B").entrada, 11, "entrada de B"); igual(V.duracaoTotal(p), 10, "total igual");
});
caso("slip muda o trecho da mídia sem mexer no lugar; slide mexe nos vizinhos", () => {
  const p = projeto(); V.slip(p, por(p, "B"), -2); igual(por(p, "B").entrada, 12, "mostra 2 s adiante"); igual(por(p, "B").inicio, 4, "no mesmo lugar");
  const q = projeto(); q.clipes.push({ id: "C", trilha: "V1", tipo: "midia", midia: "m", inicio: 10, entrada: 0, duracao: 5, velocidade: 1 });
  V.slide(q, por(q, "B"), 1); igual(por(q, "B").inicio, 5, "B andou"); igual(por(q, "A").duracao, 5, "A cresceu"); igual(por(q, "C").inicio, 11, "C encolheu no começo"); igual(por(q, "C").duracao, 4, "C mais curto");
});
caso("esticar a velocidade: o mesmo trecho em mais tempo fica mais lento", () => {
  const p = projeto(); const v = V.esticarTaxa(p, por(p, "B"), "fim", 6);
  igual(v, 0.5, "metade da velocidade"); igual(por(p, "B").duracao, 12, "dobro do tempo");
});
caso("buraco: acha e fecha", () => {
  const p = projeto(); por(p, "B").inicio = 6; const b = V.buracoEm(p, "V1", 5);
  igual(b.de, 4, "de"); igual(b.ate, 6, "até"); V.fecharBuraco(p, "V1", 5); igual(por(p, "B").inicio, 4, "fechado");
});
console.log(`\n${ok} ok · ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
