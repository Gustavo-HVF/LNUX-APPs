/*
 * Companhia — memória: as conversas ficam no próprio aparelho (IndexedDB do navegador) e, com a ponte, também
 * numa cópia em arquivo numa pasta do aparelho. Ao abrir o app, as mensagens que ainda não foram analisadas são
 * reanalisadas: viram fatos sobre a pessoa (nome, gostos, planos...), um resumo curto e o nível de afeto.
 *
 * A análise tem duas camadas: uma local (padrões de frase, zero tokens, sempre roda) e, se houver IA, uma pela
 * rota "leve" (modelo barato ou local), em blocos, só quando há conversa nova suficiente.
 * Na hora de responder, só os fatos e os trechos antigos que têm a ver com a mensagem vão para a IA (busca BM25).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // ── Banco (IndexedDB) ────────────────────────────────────────────────

  let bancoP = null;
  function banco() {
    if (!bancoP) bancoP = new Promise((ok, falhou) => {
      const r = indexedDB.open("lnux-companhia", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const m = db.createObjectStore("mensagens", { keyPath: "id", autoIncrement: true });
        m.createIndex("personagem", "personagem");
        db.createObjectStore("estado", { keyPath: "personagem" });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => falhou(r.error);
    });
    return bancoP;
  }
  function tx(lojas, modo, fazer) {
    return banco().then((db) => new Promise((ok, falhou) => {
      const t = db.transaction(lojas, modo);
      let resultado;
      Promise.resolve(fazer(t, (v) => { resultado = v; })).catch(falhou);
      t.oncomplete = () => ok(resultado);
      t.onerror = () => falhou(t.error);
      t.onabort = () => falhou(t.error || new Error("O navegador recusou guardar (pouco espaço?)."));
    }));
  }
  const pedido = (r) => new Promise((ok, falhou) => { r.onsuccess = () => ok(r.result); r.onerror = () => falhou(r.error); });

  const ESTADO_NOVO = (pid) => ({ personagem: pid, resumo: "", fatos: [], afeto: 0, analisadoAte: 0, analisadoIAAte: 0, ultimaVisita: 0, visitas: 0, pessoa: "", topicos: [] });

  const mem = {};
  C.memoria = mem;

  mem.adicionar = (pid, msg) => tx(["mensagens"], "readwrite", (t, fim) => {
    const r = t.objectStore("mensagens").add({ personagem: pid, data: Date.now(), ...msg });
    r.onsuccess = () => fim(r.result);
  });
  mem.atualizar = (msg) => tx(["mensagens"], "readwrite", (t) => { t.objectStore("mensagens").put(msg); });
  /** As últimas n mensagens (da mais antiga para a mais nova). */
  mem.recentes = (pid, n = 30) => tx(["mensagens"], "readonly", (t, fim) => {
    const lista = [];
    const r = t.objectStore("mensagens").index("personagem").openCursor(IDBKeyRange.only(pid), "prev");
    r.onsuccess = () => {
      const c = r.result;
      if (c && lista.length < n) { lista.push(c.value); c.continue(); } else fim(lista.reverse());
    };
  });
  mem.todas = (pid) => tx(["mensagens"], "readonly", (t, fim) => {
    const r = t.objectStore("mensagens").index("personagem").getAll(IDBKeyRange.only(pid));
    r.onsuccess = () => fim(r.result.sort((a, b) => a.id - b.id));
  });
  mem.contar = (pid) => tx(["mensagens"], "readonly", (t, fim) => { const r = t.objectStore("mensagens").index("personagem").count(IDBKeyRange.only(pid)); r.onsuccess = () => fim(r.result); });
  mem.estado = async (pid) => (await tx(["estado"], "readonly", (t, fim) => { const r = t.objectStore("estado").get(pid); r.onsuccess = () => fim(r.result); })) || ESTADO_NOVO(pid);
  mem.salvarEstado = (est) => tx(["estado"], "readwrite", (t) => { t.objectStore("estado").put(est); });
  /** Apaga tudo da personagem (conversas e o que ela lembra). */
  mem.apagar = (pid) => tx(["mensagens", "estado"], "readwrite", async (t) => {
    t.objectStore("estado").delete(pid);
    const ids = await pedido(t.objectStore("mensagens").index("personagem").getAllKeys(IDBKeyRange.only(pid)));
    for (const id of ids) t.objectStore("mensagens").delete(id);
  });

  // ── Busca (BM25) ─────────────────────────────────────────────────────

  const PARADAS = new Set(("a o as os um uma uns umas de da do das dos em na no nas nos por pra para pro com sem que se e ou mas eu tu ele ela nos vos eles elas " +
    "me te lhe meu minha teu tua seu sua isso isto aquilo esse essa este esta aqui ali la ja nao sim muito mais menos bem tambem so como quando onde " +
    "ser estar ter ir foi era sou esta estou tem tenho vai vou fazer faz fiz voce voces vc ta tava ne entao porque hoje agora ai oi ola tudo coisa").split(" "));
  const termos = (t) => semAcento(t).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !PARADAS.has(w)).map((w) => w.replace(/(s|es)$/, ""));
  C.termos = termos;
  /** Os n documentos mais parecidos com a consulta. docs: [{texto, ...}] */
  function bm25(docs, consulta, n) {
    const q = [...new Set(termos(consulta))];
    if (!q.length || !docs.length) return [];
    const tok = docs.map((d) => termos(d.texto));
    const media = tok.reduce((s, x) => s + x.length, 0) / tok.length || 1;
    const df = {};
    for (const x of tok) for (const w of new Set(x)) df[w] = (df[w] || 0) + 1;
    const N = docs.length, k1 = 1.4, b = 0.75;
    const notas = tok.map((x, i) => {
      let s = 0;
      for (const w of q) {
        const f = x.filter((y) => y === w).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
        s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * x.length) / media));
      }
      return [s, i];
    });
    return notas.filter((x) => x[0] > 0.2).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => docs[x[1]]);
  }
  mem.bm25 = bm25;

  /** Fatos que vão para a IA: os fixos (nome, idade...) + os que têm a ver com a mensagem. */
  mem.fatosParaContexto = function (est, consulta, n = 10) {
    const fixos = est.fatos.filter((f) => ["nome", "idade", "mora", "trabalho", "estudo"].includes(f.tipo));
    const resto = est.fatos.filter((f) => !fixos.includes(f));
    const parecidos = bm25(resto, consulta, n);
    const planos = resto.filter((f) => f.tipo === "plano" && Date.now() - f.data < 10 * 864e5).slice(-2);
    return [...new Set([...fixos, ...parecidos, ...planos])].slice(0, n + 4);
  };
  /** Trechos antigos parecidos (fora das últimas trocas). */
  mem.trechosParecidos = async function (pid, consulta, excluir, n = 3) {
    const todas = await mem.todas(pid);
    const fora = todas.filter((m) => !excluir.has(m.id) && (m.papel === "eu" || m.papel === "ela") && m.texto.length > 12).slice(-2000);
    return bm25(fora, consulta, n);
  };

  // ── Análise local (zero tokens) ──────────────────────────────────────

  const NOME = /(?:meu nome (?:é|e)|me chamo|pode me chamar de|(?:^|\s)sou (?:o|a) (?=[A-ZÀ-Ú]))\s*([A-ZÀ-Úa-zà-ú][\p{L}'-]{1,20})/u;
  const PADROES = [
    ["idade", /\btenho (\d{1,3}) anos\b/i, (m) => `Tem ${m[1]} anos (em ${new Date().getFullYear()}).`],
    ["mora", /\b(?:moro|vivo) (?:em|no|na|nos|nas) ([^.,!?\n]{2,40}?)(?=\s+(?:e|mas|porque|pq|que|quando|hoje|ontem|agora|s[oó] que)\s|[.,;!?\n]|$)/i, (m) => `Mora em ${m[1].trim()}.`],
    ["trabalho", /\b(?:trabalho|trampo) (como|de|com|na|no|em) ([^.,!?\n]{2,40}?)(?=\s+(?:e|mas|porque|pq|que|quando|hoje|ontem|agora|s[oó] que)\s|[.,;!?\n]|$)/i, (m) => `Trabalha ${m[1]} ${m[2].trim()}.`],
    ["estudo", /\b(?:estudo|fa[cç]o faculdade de|curso|to cursando|estou cursando) ([^.,!?\n]{2,40}?)(?=\s+(?:e|mas|porque|pq|que|quando|hoje|ontem|agora|s[oó] que)\s|[.,;!?\n]|$)/i, (m) => `Estuda ${m[1].trim()}.`],
    ["favorito", /\b(?:minha|meu) ([\p{L}]+(?: [\p{L}]+)?) favorit([oa]) (?:é|e|sao|são) ([^.,!?\n]{2,30})/iu, (m) => `${m[2] === "a" ? "A" : "O"} ${m[1]} favorit${m[2]} é ${m[3].trim()}.`],
    ["aniversario", /\banivers[aá]rio (?:é|e|cai) (?:dia |em |no dia )?([^.,!?\n]{2,25})/i, (m) => `O aniversário é ${m[1].trim()}.`],
    ["pet", /\b(?:tenho|meu|minha) (?:um |uma )?(cachorr[oa]|gat[oa]|calopsita|papagaio|peixe|hamster|coelh[oa]|tartaruga)\b(?:[^.!?\n]{0,12}?(?:chamad[oa]|se chama|nome (?:é|e)) ([\p{L}]+))?/iu, (m) => `Tem ${/a$/.test(m[1]) ? "uma" : "um"} ${m[1]}${m[2] ? " chamad" + (/a$/.test(m[1]) ? "a " : "o ") + m[2] : ""}.`],
    ["pessoa", /\b(minha|meu) (m[aã]e|pai|irm[aã]|irm[aã]o|namorad[oa]|espos[oa]|marido|filh[oa]|melhor amig[oa]|chefe|av[oóô]) (?:se chama |chamad[oa] |(?:é|e) (?:o |a )?)([A-ZÀ-Ú][\p{L}]+)/u, (m) => `${m[1] === "minha" ? "A" : "O"} ${m[2]} se chama ${m[3]}.`],
    ["gosta", /\b(?:eu )?(?:gosto (?:muito |bastante )?de|amo|adoro|curto)\s+(?!voc[eê]|vc|te\b|tu\b)([^.,!?\n]{2,40}?)(?=\s+(?:e|mas|porque|pq|que|quando|hoje|ontem|agora|s[oó] que)\s|[.,;!?\n]|$)/i, (m) => `Gosta de ${m[1].trim()}.`],
    ["nao-gosta", /\b(?:odeio|detesto|n[aã]o gosto (?:de|do|da)|n[aã]o suporto)\s+(?!voc[eê]|vc)([^.,!?\n]{2,40}?)(?=\s+(?:e|mas|porque|pq|que|quando|hoje|ontem|agora|s[oó] que)\s|[.,;!?\n]|$)/i, (m) => `Não gosta de ${m[1].trim()}.`],
    ["plano", /(?:^|\s)(?:amanh[aã]|semana que vem|m[eê]s que vem|hoje (?:[aà] noite|mais tarde)|depois|no fim de semana)(?!\p{L})[^.!?\n]{0,10}?(?:^|\s)(?:eu )?(?:vou|tenho que|preciso)\s+(?!ter (?:uma? )?(?:prova|entrevista|consulta|viagem|reuni|apresenta|jogo|show|exame))([^.!?\n]{3,60})/iu, (m) => `Disse em ${new Date().toLocaleDateString("pt-BR")} que ia ${m[1].trim()}.`],
    ["plano", /\b(?:vou ter|tenho) (?:uma |um )?(prova|entrevista|consulta|viagem|reuni[aã]o|apresenta[cç][aã]o|jogo|show|exame)\b([^.!?\n]{0,40})/i, (m) => `Tinha ${/a$|ão$|ao$/.test(m[1]) ? "uma" : "um"} ${m[1]}${m[2]} (contou em ${new Date().toLocaleDateString("pt-BR")}).`],
  ];
  const UNICOS = new Set(["nome", "idade", "mora", "trabalho", "estudo", "aniversario"]);

  /** Junta um fato novo (substitui os do mesmo tipo único e evita repetidos). */
  function juntarFato(est, f) {
    const chave = semAcento(f.texto).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!chave) return false;
    if (est.fatos.some((x) => semAcento(x.texto).replace(/[^\p{L}\p{N}]+/gu, " ").trim() === chave)) return false;
    if (UNICOS.has(f.tipo)) est.fatos = est.fatos.filter((x) => x.tipo !== f.tipo);
    if (f.tipo === "favorito") { const sobre = f.texto.split(" favorit")[0]; est.fatos = est.fatos.filter((x) => !(x.tipo === "favorito" && x.texto.split(" favorit")[0] === sobre)); }
    est.fatos.push({ texto: f.texto, tipo: f.tipo || "outro", data: f.data || Date.now(), origem: f.origem || "local" });
    if (est.fatos.length > 150) est.fatos = est.fatos.slice(-150);
    return true;
  }
  mem.juntarFato = juntarFato;

  const CARINHO = /\b(obrigad|te amo|amo voc|gosto de voc|linda|fofa|querida|adoro voc|saudade|voc[eê] [eé] (incr|demais|legal)|desculp)/i;
  const OFENSA = /\b(chata|feia|idiota|burra|in[uú]til|odeio voc|cala a boca|some daqui|lixo)\b/i;

  /** Análise local de uma mensagem da pessoa: fatos, nome e afeto. Devolve os fatos novos. */
  mem.analisarLocal = function (est, msg) {
    const novos = [];
    if (msg.papel !== "eu") return novos;
    const t = msg.texto;
    const n = t.match(NOME);
    if (n && !PARADAS.has(semAcento(n[1]))) {
      const nome = n[1][0].toUpperCase() + n[1].slice(1);
      est.pessoa = nome;
      const f = { texto: `O nome da pessoa é ${nome}.`, tipo: "nome", data: msg.data };
      if (juntarFato(est, f)) novos.push(f);
    }
    for (const [tipo, re, fazer] of PADROES) {
      const m = t.match(re);
      if (!m) continue;
      const f = { texto: fazer(m), tipo, data: msg.data };
      if (juntarFato(est, f)) novos.push(f);
    }
    if (CARINHO.test(t)) est.afeto = Math.min(100, (est.afeto || 0) + 2);
    if (OFENSA.test(t)) est.afeto = Math.max(-100, (est.afeto || 0) - 5);
    return novos;
  };

  /** Os assuntos mais falados num bloco de mensagens (para o resumo sem IA). */
  function topicos(msgs, n = 5) {
    const conta = {};
    for (const m of msgs) if (m.papel === "eu") for (const w of termos(m.texto)) if (w.length > 3) conta[w] = (conta[w] || 0) + 1;
    return Object.entries(conta).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  }

  // ── Reanálise (ao abrir o app e de tempos em tempos) ─────────────────

  /**
   * Analisa as mensagens que ainda não foram analisadas. opcoes.ia(prompt) → texto (JSON), se houver IA na rota
   * leve; sem ela, só a análise local. Devolve {novas, fatosNovos, usouIA}.
   */
  mem.reanalisar = async function (pid, { ia = null, minimoIA = 6, nome = "ela" } = {}) {
    const est = await mem.estado(pid);
    const todas = await mem.todas(pid);
    const novas = todas.filter((m) => m.id > (est.analisadoAte || 0));
    const fatosNovos = [];
    for (const m of novas) fatosNovos.push(...mem.analisarLocal(est, m));
    if (novas.length) {
      est.analisadoAte = novas[novas.length - 1].id;
      const tops = topicos(novas);
      if (tops.length) est.topicos = [...new Set([...tops, ...(est.topicos || [])])].slice(0, 12);
      if (!est.resumo && tops.length) est.resumo = `Já conversaram sobre: ${tops.join(", ")}.`;
    }
    // com IA: em blocos, só se há conversa nova suficiente (economia)
    let usouIA = false;
    const paraIA = todas.filter((m) => m.id > (est.analisadoIAAte || 0) && (m.papel === "eu" || m.papel === "ela"));
    if (ia && paraIA.filter((m) => m.papel === "eu").length >= minimoIA) {
      const blocos = [];
      let atual = [], tamanho = 0;
      for (const m of paraIA) {
        const linha = `${m.papel === "eu" ? "Pessoa" : nome}: ${m.texto.slice(0, 400)}`;
        if (tamanho + linha.length > 6000 && atual.length) { blocos.push(atual); atual = []; tamanho = 0; }
        atual.push([m.id, linha]); tamanho += linha.length;
      }
      if (atual.length) blocos.push(atual);
      for (const bloco of blocos.slice(-4)) {
        const prompt = "Leia a conversa entre a Pessoa e " + nome + ". Responda SÓ com JSON neste formato: " +
          '{"fatos": [{"texto": "...", "tipo": "nome|idade|mora|trabalho|estudo|gosta|nao-gosta|pessoa|pet|plano|outro"}], "resumo": "...", "afeto": 0}\n' +
          "fatos: coisas duráveis sobre a Pessoa, frases curtas em 3ª pessoa (só o que é novo). resumo: o resumo atualizado de tudo (até 5 frases). " +
          "afeto: de -3 a 3, quanto a conversa aproximou (+) ou afastou (-).\n" +
          (est.resumo ? "Resumo anterior: " + est.resumo + "\n" : "") +
          (est.fatos.length ? "Fatos que já sei: " + est.fatos.slice(-30).map((f) => f.texto).join(" | ") + "\n" : "") +
          "Conversa:\n" + bloco.map((x) => x[1]).join("\n");
        try {
          const resposta = await ia(prompt);
          const j = JSON.parse((resposta.match(/\{[\s\S]*\}/) || ["{}"])[0]);
          for (const f of j.fatos || []) {
            const fato = typeof f === "string" ? { texto: f, tipo: "outro" } : f;
            if (fato.texto) { fato.origem = "ia"; if (juntarFato(est, fato)) fatosNovos.push(fato); }
          }
          if (j.resumo) est.resumo = String(j.resumo).slice(0, 900);
          if (typeof j.afeto === "number") est.afeto = Math.max(-100, Math.min(100, (est.afeto || 0) + Math.max(-3, Math.min(3, j.afeto)) * 2));
          est.analisadoIAAte = bloco[bloco.length - 1][0];
          usouIA = true;
        } catch (e) {
          console.warn("memória: a análise pela IA falhou, fica a local", e);
          break;
        }
      }
    }
    await mem.salvarEstado(est);
    return { novas: novas.length, fatosNovos, usouIA, estado: est };
  };

  /** Marca a visita (para "faz 3 dias que a gente não conversa"). Devolve quanto tempo passou (ms). */
  mem.visitar = async function (pid) {
    const est = await mem.estado(pid);
    const antes = est.ultimaVisita || 0;
    est.ultimaVisita = Date.now();
    est.visitas = (est.visitas || 0) + 1;
    if (antes && Date.now() - antes > 6 * 3600e3) est.afeto = Math.min(100, (est.afeto || 0) + 1);
    await mem.salvarEstado(est);
    return { passou: antes ? Date.now() - antes : null, estado: est };
  };

  // ── Exportar, importar e cópia no aparelho ───────────────────────────

  mem.exportar = async (pid, nome) => ({ versao: 1, app: "LNUX Companhia", personagem: nome, exportado: new Date().toISOString(),
    estado: await mem.estado(pid), mensagens: (await mem.todas(pid)).map(({ id, personagem, ...m }) => m) });
  /** Importa (junta) um JSON exportado. substituir=true apaga a memória atual antes. */
  mem.importar = async function (pid, dados, { substituir = false } = {}) {
    if (!dados || !Array.isArray(dados.mensagens)) throw new Error("Este arquivo não é uma memória da Companhia.");
    if (substituir) await mem.apagar(pid);
    const existentes = new Set((await mem.todas(pid)).map((m) => m.data + "|" + m.texto));
    let n = 0;
    await tx(["mensagens"], "readwrite", (t) => {
      for (const m of dados.mensagens) {
        if (!m || typeof m.texto !== "string" || existentes.has(m.data + "|" + m.texto)) continue;
        t.objectStore("mensagens").add({ papel: m.papel === "ela" ? "ela" : m.papel === "toque" ? "toque" : "eu", texto: m.texto.slice(0, 8000), data: m.data || Date.now(), emocao: m.emocao, personagem: pid });
        n++;
      }
    });
    const est = await mem.estado(pid);
    if (dados.estado) {
      for (const f of dados.estado.fatos || []) if (f && f.texto) juntarFato(est, f);
      if (!est.resumo && dados.estado.resumo) est.resumo = dados.estado.resumo;
      if (!est.pessoa && dados.estado.pessoa) est.pessoa = dados.estado.pessoa;
      if (substituir) est.afeto = dados.estado.afeto || 0;
    }
    await mem.salvarEstado(est);
    return n;
  };
  /** Caminho da cópia no aparelho (pela ponte). */
  mem.caminhoCopia = (nome) => {
    const home = (LNUX.ponte.estado && LNUX.ponte.estado.home) || "~";
    const limpo = semAcento(nome).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "personagem";
    return { pasta: home + "/LNUX/Companhia", arquivo: `${home}/LNUX/Companhia/${limpo}-memoria.json` };
  };
  mem.copiarParaAparelho = async function (pid, nome) {
    if (!LNUX.ponte.disponivel) throw new Error("A cópia no aparelho precisa da ponte local.");
    const { pasta, arquivo } = mem.caminhoCopia(nome);
    try { await LNUX.ponte.criarPasta(pasta.replace(/\/Companhia$/, "")); } catch (e) { /* já existe */ }
    try { await LNUX.ponte.criarPasta(pasta); } catch (e) { /* já existe */ }
    await LNUX.ponte.gravar(arquivo, new Blob([JSON.stringify(await mem.exportar(pid, nome))], { type: "application/json" }), { sobrescrever: true });
    return arquivo;
  };
  mem.lerDoAparelho = async function (nome) {
    const { arquivo } = mem.caminhoCopia(nome);
    return JSON.parse(await LNUX.ponte.ler(arquivo, "texto"));
  };
})();
