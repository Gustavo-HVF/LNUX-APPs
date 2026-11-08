/*
 * Vídeo — álgebra de edição (sem tela: só mexe no objeto do projeto). É o "jeito Premiere" de editar:
 * inserir (empurra o resto), sobrescrever (cobre o que estiver lá), levantar (tira deixando o buraco), extrair
 * (tira e fecha), apagar com ondulação, adicionar corte, aparar com ondulação e com rolagem, deslizar o conteúdo
 * (slip), deslizar o clipe (slide) e esticar a velocidade. Clipes vinculados (o vídeo e o áudio do mesmo arquivo)
 * andam juntos.
 *
 * Os quadros-chave são guardados em relação ao começo do clipe; quando o começo do clipe anda dentro da mídia
 * (aparar o começo), eles são deslocados para continuar no mesmo ponto da imagem.
 * Roda também no Node (tests/testar_edicao.js).
 */
(function (raiz) {
  "use strict";
  const V = (raiz.V = raiz.V || {});
  const EPS = 1e-6;

  let contador = 0;
  const novoId = (prefixo) => `${prefixo}-${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const fim = (c) => c.inicio + c.duracao;
  const copiar = (x) => JSON.parse(JSON.stringify(x));

  /** Quanto de mídia ainda existe depois do ponto de entrada (Infinity para imagem, texto, cor...). */
  function duracaoDaMidia(p, c) {
    if (c.tipo !== "midia") return Infinity;
    const m = p.midias[c.midia];
    return !m || m.tipo === "imagem" ? Infinity : m.duracao || Infinity;
  }
  const vel = (c) => c.velocidade || 1;

  /** Desloca os quadros-chave do clipe (em segundos do clipe). */
  function deslocarChaves(c, d) {
    if (!c.anim || !d) return;
    for (const ch of Object.values(c.anim)) { for (const k of ch) k.t -= d; delete ch._m; }
  }

  function clipesDaTrilha(p, trilha) {
    return p.clipes.filter((c) => c.trilha === trilha).sort((a, b) => a.inicio - b.inicio);
  }
  function parceiros(p, c) {
    return c.vinculo ? p.clipes.filter((x) => x !== c && x.vinculo === c.vinculo) : [];
  }
  /** O clipe e os vinculados a ele (quando a seleção vinculada está ligada). */
  function comVinculados(p, ids, vinculada = true) {
    const saida = new Set(ids);
    if (vinculada) for (const c of p.clipes) if (saida.has(c.id)) for (const x of parceiros(p, c)) saida.add(x.id);
    return saida;
  }

  /** Separa um clipe em dois no instante t; devolve o pedaço da direita (ou null se t não cai dentro dele). */
  function cortar(p, c, t) {
    if (t <= c.inicio + EPS || t >= fim(c) - EPS) return null;
    const corte = t - c.inicio;
    const b = copiar(c);
    b.id = novoId("c");
    b.inicio = t;
    b.duracao = c.duracao - corte;
    b.entrada = c.entrada + corte * vel(c);
    deslocarChaves(b, corte);
    c.duracao = corte;
    if (c.vinculo) b.vinculo = c.vinculo + "/" + Math.round(t * 1000); // a parte da direita forma outro par
    // transições: a de saída vai para o pedaço da direita
    for (const tr of p.transicoes || []) if (tr.a === c.id) tr.a = b.id;
    p.clipes.push(b);
    return b;
  }

  /** Corta todos os clipes das trilhas no instante t (Ctrl+K: adicionar corte). */
  function adicionarCorte(p, trilhas, t) {
    const novos = [];
    const pares = new Map();
    for (const c of [...p.clipes]) {
      if (!trilhas.includes(c.trilha)) continue;
      const b = cortar(p, c, t);
      if (b) {
        novos.push(b);
        if (c.vinculo) { const chave = c.vinculo; if (!pares.has(chave)) pares.set(chave, novoId("v")); b.vinculo = pares.get(chave); }
      }
    }
    return novos;
  }

  /**
   * Tira tudo o que estiver nas trilhas entre "de" e "ate" (sem mexer no resto): apaga o que está dentro, apara o
   * que está pela metade, corta em dois o que atravessa o trecho. Base de sobrescrever, levantar e extrair.
   */
  function limparTrecho(p, trilhas, de, ate) {
    if (ate <= de + EPS) return;
    for (const c of [...p.clipes]) {
      if (!trilhas.includes(c.trilha) || fim(c) <= de + EPS || c.inicio >= ate - EPS) continue;
      if (c.inicio >= de - EPS && fim(c) <= ate + EPS) { removerClipe(p, c.id); continue; }
      if (c.inicio < de && fim(c) > ate) { cortar(p, c, ate); c.duracao = de - c.inicio; continue; }
      if (c.inicio < de) { c.duracao = de - c.inicio; continue; }
      const corte = ate - c.inicio; // começa dentro do trecho: apara o começo
      c.inicio = ate;
      c.duracao -= corte;
      c.entrada += corte * vel(c);
      deslocarChaves(c, corte);
    }
  }

  function removerClipe(p, id) {
    p.clipes = p.clipes.filter((c) => c.id !== id);
    if (p.transicoes) p.transicoes = p.transicoes.filter((t) => t.a !== id && t.b !== id);
  }

  /** Empurra os clipes das trilhas que começam em "aPartir" ou depois. */
  function deslocar(p, trilhas, aPartir, delta) {
    for (const c of p.clipes) if (trilhas.includes(c.trilha) && c.inicio >= aPartir - EPS) c.inicio = Math.max(0, c.inicio + delta);
  }

  /**
   * INSERIR (vírgula): abre espaço no instante t em todas as trilhas sincronizadas (corta o que atravessa t e
   * empurra o resto) e põe os clipes novos. "novos" já vêm com trilha, entrada e duração; o início é relativo a t.
   */
  function inserir(p, novos, t, trilhasSincronizadas) {
    const duracao = Math.max(...novos.map((c) => (c.inicio || 0) + c.duracao));
    const afetadas = trilhasSincronizadas || p.trilhas.map((x) => x.id);
    adicionarCorte(p, afetadas, t);
    deslocar(p, afetadas, t, duracao);
    for (const c of novos) { c.inicio = t + (c.inicio || 0); p.clipes.push(c); }
    return duracao;
  }

  /** SOBRESCREVER (ponto): cobre o que estiver nas trilhas dos clipes novos, a partir de t. */
  function sobrescrever(p, novos, t) {
    for (const c of novos) {
      const de = t + (c.inicio || 0);
      limparTrecho(p, [c.trilha], de, de + c.duracao);
      c.inicio = de;
      p.clipes.push(c);
    }
  }

  /** LEVANTAR (;): tira o trecho entrada→saída das trilhas, deixando o buraco. */
  function levantar(p, trilhas, de, ate) { limparTrecho(p, trilhas, de, ate); }

  /** EXTRAIR ('): tira o trecho e fecha o buraco. */
  function extrair(p, trilhas, de, ate) {
    limparTrecho(p, trilhas, de, ate);
    deslocar(p, trilhas, ate, -(ate - de));
  }

  /** Apaga os clipes e fecha o buraco que cada um deixa na sua trilha (Shift+Del). */
  function apagarComOndulacao(p, ids) {
    const alvos = p.clipes.filter((c) => ids.has(c.id)).sort((a, b) => b.inicio - a.inicio);
    for (const c of alvos) {
      removerClipe(p, c.id);
      // só fecha se nada mais ocupa o buraco nessa trilha
      const ocupado = p.clipes.some((x) => x.trilha === c.trilha && x.inicio < fim(c) - EPS && fim(x) > c.inicio + EPS);
      if (!ocupado) deslocar(p, [c.trilha], fim(c), -c.duracao);
    }
  }

  /** Buraco (sem clipes) que contém t na trilha: {de, ate} ou null. */
  function buracoEm(p, trilha, t) {
    const lista = clipesDaTrilha(p, trilha);
    let de = 0;
    for (const c of lista) {
      if (t >= de && t < c.inicio) return { de, ate: c.inicio };
      de = Math.max(de, fim(c));
    }
    return null;
  }
  function fecharBuraco(p, trilha, t) {
    const b = buracoEm(p, trilha, t);
    if (!b) return false;
    deslocar(p, [trilha], b.ate, -(b.ate - b.de));
    return true;
  }

  // ── Aparar ────────────────────────────────────────────────────────────
  const minimo = 1 / 120;

  /** Aparar normal (ferramenta Seleção): muda só este clipe. lado = "inicio" | "fim"; devolve o delta aplicado. */
  function aparar(p, c, lado, delta) {
    const max = duracaoDaMidia(p, c);
    if (lado === "fim") {
      const nova = Math.min(Math.max(minimo, c.duracao + delta), (max - c.entrada) / vel(c));
      const d = nova - c.duracao;
      c.duracao = nova;
      return d;
    }
    // delta > 0 encurta (o começo vai para a direita); delta < 0 puxa o começo para a esquerda
    let d = Math.min(delta, c.duracao - minimo);
    let limiteEsquerda = -c.inicio; // não passa do zero da linha do tempo
    if (max !== Infinity) limiteEsquerda = Math.max(limiteEsquerda, -c.entrada / vel(c)); // nem do começo da mídia
    d = Math.max(d, limiteEsquerda);
    c.inicio += d;
    c.duracao -= d;
    c.entrada = Math.max(0, c.entrada + d * vel(c));
    deslocarChaves(c, d);
    return d;
  }

  /** Aparar com ondulação (ferramenta Ondulação, B): o resto da trilha acompanha, sem buraco. */
  function apararOndulacao(p, c, lado, delta) {
    const trilhas = [c.trilha, ...parceiros(p, c).map((x) => x.trilha)];
    const pontoAntes = lado === "fim" ? fim(c) : c.inicio;
    if (lado === "fim") {
      const d = aparar(p, c, "fim", delta);
      for (const x of parceiros(p, c)) aparar(p, x, "fim", d);
      for (const x of p.clipes) if (trilhas.includes(x.trilha) && x !== c && !parceiros(p, c).includes(x) && x.inicio >= pontoAntes - EPS) x.inicio += d;
      return d;
    }
    // começo: a mídia anda, o clipe fica no lugar e o resto da trilha se aproxima
    const inicio = c.inicio;
    const d = aparar(p, c, "inicio", delta);
    c.inicio = inicio;
    for (const x of parceiros(p, c)) { aparar(p, x, "inicio", d); x.inicio = inicio; }
    for (const x of p.clipes) if (trilhas.includes(x.trilha) && x !== c && !parceiros(p, c).includes(x) && x.inicio >= pontoAntes + c.duracao + d - EPS) x.inicio -= d;
    return d;
  }

  /** Edição rolante (N): move o ponto de corte entre dois clipes vizinhos, sem mudar a duração total. */
  function apararRolagem(p, a, b, delta) {
    const maxA = (duracaoDaMidia(p, a) - a.entrada) / vel(a) - a.duracao; // quanto A ainda pode crescer
    const maxB = b.entrada / vel(b); // quanto B pode recuar o começo
    const d = Math.max(-(a.duracao - minimo), -maxB, Math.min(delta, maxA, b.duracao - minimo));
    a.duracao += d;
    b.inicio += d;
    b.duracao -= d;
    b.entrada += d * vel(b);
    deslocarChaves(b, d);
    return d;
  }

  /** Deslizar o conteúdo (slip, Y): muda o trecho da mídia mostrado, sem mexer no lugar nem na duração. */
  function slip(p, c, delta) {
    const max = duracaoDaMidia(p, c);
    if (max === Infinity && c.tipo !== "midia") return 0;
    const antes = c.entrada;
    c.entrada = Math.min(Math.max(0, c.entrada - delta * vel(c)), Math.max(0, max - c.duracao * vel(c)));
    return (antes - c.entrada) / vel(c); // os quadros-chave ficam presos ao clipe (não à mídia)
  }

  /** Deslizar o clipe (slide, U): o clipe anda entre os vizinhos, que se ajustam (o de antes cresce, o de depois diminui). */
  function slide(p, c, delta) {
    const lista = clipesDaTrilha(p, c.trilha);
    const i = lista.indexOf(c);
    const antes = lista[i - 1] && Math.abs(fim(lista[i - 1]) - c.inicio) < 1e-3 ? lista[i - 1] : null;
    const depois = lista[i + 1] && Math.abs(lista[i + 1].inicio - fim(c)) < 1e-3 ? lista[i + 1] : null;
    let d = delta;
    if (antes) d = Math.max(d, -(antes.duracao - minimo)), d = Math.min(d, (duracaoDaMidia(p, antes) - antes.entrada) / vel(antes) - antes.duracao);
    else d = Math.max(d, -c.inicio);
    if (depois) d = Math.min(d, depois.duracao - minimo), d = Math.max(d, -depois.entrada / vel(depois));
    if (antes) antes.duracao += d;
    if (depois) { depois.inicio += d; depois.duracao -= d; depois.entrada += d * vel(depois); deslocarChaves(depois, d); }
    c.inicio += d;
    return d;
  }

  /** Esticar a velocidade (R): a nova duração muda a velocidade, mostrando o mesmo trecho da mídia. */
  function esticarTaxa(p, c, lado, delta) {
    const trecho = c.duracao * vel(c);
    const nova = Math.max(minimo, c.duracao + (lado === "fim" ? delta : -delta));
    const v = Math.min(20, Math.max(0.05, trecho / nova));
    const duracao = trecho / v;
    if (lado === "inicio") c.inicio = fim(c) - duracao;
    // os quadros-chave acompanham a mudança de tempo
    if (c.anim) for (const ch of Object.values(c.anim)) { for (const k of ch) k.t *= duracao / c.duracao; delete ch._m; }
    c.duracao = duracao;
    c.velocidade = Math.round(v * 1000) / 1000;
    return c.velocidade;
  }

  /** Muda a velocidade (porcentagem) mantendo o trecho da mídia; o resto da trilha acompanha se "ondular". */
  function mudarVelocidade(p, c, novaVel, ondular = false) {
    const trecho = c.duracao * vel(c);
    const antes = fim(c);
    c.duracao = trecho / novaVel;
    if (c.anim) for (const ch of Object.values(c.anim)) { for (const k of ch) k.t *= vel(c) / novaVel; delete ch._m; }
    c.velocidade = novaVel;
    if (ondular) for (const x of p.clipes) if (x.trilha === c.trilha && x !== c && x.inicio >= antes - EPS) x.inicio += fim(c) - antes;
  }

  /** Pontos de corte (começos e fins) das trilhas, ordenados — para ↑/↓ e para o ímã. */
  function pontosDeCorte(p, trilhas = null) {
    const s = new Set([0]);
    for (const c of p.clipes) if (!trilhas || trilhas.includes(c.trilha)) { s.add(+c.inicio.toFixed(6)); s.add(+fim(c).toFixed(6)); }
    return [...s].sort((a, b) => a - b);
  }

  /** Clipes vizinhos colados num ponto de corte da trilha (para transições e edição rolante). */
  function vizinhosNoCorte(p, trilha, t, tolerancia = 1e-3) {
    const lista = clipesDaTrilha(p, trilha);
    const a = lista.find((c) => Math.abs(fim(c) - t) < tolerancia) || null;
    const b = lista.find((c) => Math.abs(c.inicio - t) < tolerancia) || null;
    return { a, b };
  }

  const duracaoTotal = (p) => p.clipes.reduce((m, c) => Math.max(m, fim(c)), 0);

  Object.assign(V, {
    novoId, fim, duracaoDaMidia, clipesDaTrilha, parceiros, comVinculados, cortar, adicionarCorte, limparTrecho, removerClipe,
    deslocar, inserir, sobrescrever, levantar, extrair, apagarComOndulacao, buracoEm, fecharBuraco, aparar, apararOndulacao,
    apararRolagem, slip, slide, esticarTaxa, mudarVelocidade, pontosDeCorte, vizinhosNoCorte, duracaoTotal, deslocarChaves,
  });
  if (typeof module !== "undefined") module.exports = V;
})(typeof window !== "undefined" ? window : globalThis);
