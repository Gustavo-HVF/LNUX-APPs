/*
 * Companhia — IA: provedores (ChatGPT/OpenAI, Claude/Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI,
 * claude-code-router e IA local: Ollama, LM Studio, llama.cpp), roteador econômico e o "motor local".
 *
 * Economia de tokens (a ideia vem do claude-code-router, MIT — https://github.com/musistudio/claude-code-router):
 *   - cada tarefa vai para uma ROTA: "padrao" (conversa), "leve" (reações a toques, memória, saudações — um modelo
 *     barato ou local), "pensar" (perguntas difíceis) e "longo" (quando o contexto passa do limite);
 *   - o MOTOR LOCAL responde as coisas simples (oi, tudo bem, obrigado, que horas são, qual meu nome...) sem gastar
 *     nenhum token, e serve de conversa básica quando não há IA configurada;
 *   - o contexto vai enxuto: perfil + resumo da memória + só os fatos e trechos antigos que têm a ver com a
 *     mensagem (busca BM25) + as últimas trocas.
 *
 * As chaves: com a ponte local, ficam no aparelho (~/.lnux-apps/ia.json) e a ponte faz o pedido — a chave nunca
 * passa pelo navegador. Sem a ponte, ficam no navegador (localStorage) e o pedido vai direto (avisado na tela).
 *
 * A resposta da personagem vem com marcas de emoção e gesto, ex.: "[feliz][acenar] Oi!". O LeitorDeFala separa as
 * marcas do texto enquanto a resposta chega e entrega frase por frase para a voz.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // ── Provedores ───────────────────────────────────────────────────────

  /** tipo: o jeito da API (openai = Chat Completions; anthropic = Messages; gemini = generateContent). */
  const PROVEDORES = {
    openai: { nome: "OpenAI (ChatGPT)", tipo: "openai", url: "https://api.openai.com/v1", chave: "sim", sugestao: "gpt-4.1-mini", site: "https://platform.openai.com/api-keys" },
    anthropic: { nome: "Anthropic (Claude)", tipo: "anthropic", url: "https://api.anthropic.com/v1", chave: "sim", sugestao: "claude-haiku-5-5", site: "https://console.anthropic.com/settings/keys" },
    gemini: { nome: "Google (Gemini)", tipo: "gemini", url: "https://generativelanguage.googleapis.com/v1beta", chave: "sim", sugestao: "gemini-2.5-flash", site: "https://aistudio.google.com/apikey" },
    openrouter: { nome: "OpenRouter (vários modelos)", tipo: "openai", url: "https://openrouter.ai/api/v1", chave: "sim", sugestao: "", site: "https://openrouter.ai/keys" },
    groq: { nome: "Groq", tipo: "openai", url: "https://api.groq.com/openai/v1", chave: "sim", sugestao: "llama-3.1-8b-instant", site: "https://console.groq.com/keys" },
    deepseek: { nome: "DeepSeek", tipo: "openai", url: "https://api.deepseek.com/v1", chave: "sim", sugestao: "deepseek-chat", site: "https://platform.deepseek.com/api_keys" },
    mistral: { nome: "Mistral", tipo: "openai", url: "https://api.mistral.ai/v1", chave: "sim", sugestao: "mistral-small-latest", site: "https://console.mistral.ai/api-keys" },
    xai: { nome: "xAI (Grok)", tipo: "openai", url: "https://api.x.ai/v1", chave: "sim", sugestao: "", site: "https://console.x.ai" },
    together: { nome: "Together AI", tipo: "openai", url: "https://api.together.xyz/v1", chave: "sim", sugestao: "" },
    fireworks: { nome: "Fireworks AI", tipo: "openai", url: "https://api.fireworks.ai/inference/v1", chave: "sim", sugestao: "" },
    cerebras: { nome: "Cerebras", tipo: "openai", url: "https://api.cerebras.ai/v1", chave: "sim", sugestao: "" },
    ccr: { nome: "claude-code-router (no aparelho)", tipo: "anthropic", url: "http://127.0.0.1:3456/v1", chave: "opcional", local: true, sugestao: "",
      dica: "O claude-code-router (ccr start) escolhe o modelo sozinho pelas regras dele (default, background, think, longContext)." },
    ollama: { nome: "Ollama (IA local)", tipo: "openai", url: "http://127.0.0.1:11434/v1", chave: "nao", local: true, sugestao: "llama3.2", site: "https://ollama.com" },
    lmstudio: { nome: "LM Studio (IA local)", tipo: "openai", url: "http://127.0.0.1:1234/v1", chave: "nao", local: true, sugestao: "" },
    llamacpp: { nome: "llama.cpp / llama-server (IA local)", tipo: "openai", url: "http://127.0.0.1:8080/v1", chave: "nao", local: true, sugestao: "" },
    personalizado: { nome: "Outro (compatível com OpenAI)", tipo: "openai", url: "", chave: "opcional", sugestao: "" },
  };
  C.PROVEDORES = PROVEDORES;
  C.ROTAS = {
    padrao: { nome: "Padrão (conversa)", dica: "A conversa do dia a dia." },
    leve: { nome: "Leve", dica: "Reações a toques, saudações e a análise da memória. Use um modelo barato ou local." },
    pensar: { nome: "Pensar", dica: "Perguntas difíceis (explicar, calcular, comparar, código). Um modelo mais forte." },
    longo: { nome: "Contexto longo", dica: "Quando o contexto passa do limite de tokens." },
  };

  const CONFIG_PADRAO = {
    provedores: {}, // id → {url, modelo} (o que a pessoa mudou nos padrões)
    rotas: { padrao: { provedor: "", modelo: "" }, leve: { provedor: "", modelo: "" }, pensar: { provedor: "", modelo: "" }, longo: { provedor: "", modelo: "" } },
    motorLocal: "simples", // "simples": responde o simples sem IA; "sempre": só o motor local; "nunca"
    limiteLongo: 6000,
    maxTokens: 350,
    temperatura: 0.85,
    trocasRecentes: 8,
    toquesComIA: true,
    intervaloToquesIA: 20, // segundos entre reações a toque pela IA (no meio, usa as falas prontas)
  };
  const ia = {
    config: JSON.parse(JSON.stringify(CONFIG_PADRAO)),
    chavesNaPonte: {},
    gasto: { pedidos: 0, entrada: 0, saida: 0, locais: 0 }, // tokens estimados nesta sessão
  };
  C.ia = ia;

  ia.carregar = function () {
    try {
      const c = JSON.parse(localStorage.getItem("companhia.ia") || "null");
      if (c) ia.config = Object.assign(JSON.parse(JSON.stringify(CONFIG_PADRAO)), c, { rotas: Object.assign({}, CONFIG_PADRAO.rotas, c.rotas || {}) });
    } catch (e) { /* padrão */ }
    return ia.config;
  };
  ia.salvar = () => localStorage.setItem("companhia.ia", JSON.stringify(ia.config));
  ia.provedor = (id) => {
    const p = PROVEDORES[id] || PROVEDORES.personalizado;
    const meu = ia.config.provedores[id] || {};
    return { id, ...p, url: (meu.url || p.url || "").replace(/\/+$/, ""), modelo: meu.modelo || "", tipo: meu.tipo || p.tipo };
  };
  /** Há alguma IA configurada na rota padrão? */
  ia.configurada = () => !!(ia.config.rotas.padrao && ia.config.rotas.padrao.provedor && ia.config.motorLocal !== "sempre");

  // ── Chaves ───────────────────────────────────────────────────────────

  const ponte = () => window.LNUX && LNUX.ponte && LNUX.ponte.disponivel ? LNUX.ponte : null;
  ia.atualizarChaves = async function () {
    if (!ponte()) return {};
    try { ia.chavesNaPonte = (await LNUX.ponte.pedir("GET", "ia/chaves")).provedores || {}; } catch (e) { ia.chavesNaPonte = {}; }
    return ia.chavesNaPonte;
  };
  ia.temChave = (id) => (ponte() ? !!ia.chavesNaPonte[id] : !!localStorage.getItem("companhia.chave." + id));
  /** Guarda (ou apaga, com chave vazia) a chave de um provedor. */
  ia.guardarChave = async function (id, chave, url) {
    if (ponte()) {
      await LNUX.ponte.pedir("PUT", "ia/chaves", { json: { provedor: id, chave, url } });
      await ia.atualizarChaves();
    } else if (chave) localStorage.setItem("companhia.chave." + id, chave);
    else localStorage.removeItem("companhia.chave." + id);
  };
  ia.hostsExtras = async function (hosts) {
    if (!ponte()) return [];
    const r = await LNUX.ponte.pedir(hosts ? "PUT" : "GET", "ia/chaves", hosts ? { json: { hosts } } : {});
    return r.hosts || [];
  };

  // ── Transporte: pela ponte (chave no aparelho) ou direto ──────────────

  /**
   * Faz um pedido HTTP a um provedor (IA ou voz). Devolve o Response (o corpo pode vir aos pedaços).
   * cab: cabeçalhos sem a chave; a chave entra aqui (direto) ou na ponte.
   */
  ia.transporte = async function (provId, url, { metodo = "POST", cab = {}, corpo, sinal, tipo } = {}) {
    const info = PROVEDORES[provId] || {};
    tipo = tipo || (ia.config.provedores[provId] || {}).tipo || info.tipo;
    let r;
    if (ponte()) {
      try {
        r = await fetch("/api/ia/proxy", {
          method: "POST", signal: sinal, credentials: "same-origin",
          headers: { "X-Ponte-Token": LNUX.ponte._token, "Content-Type": "application/json" },
          body: JSON.stringify({ url, metodo, provedor: provId, tipo, cabecalhos: cab, corpo }),
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error("A ponte local não respondeu.");
      }
    } else {
      const h = { ...cab };
      const chave = localStorage.getItem("companhia.chave." + provId) || "";
      if (chave) {
        if (provId === "elevenlabs") h["xi-api-key"] = chave;
        else if (tipo === "anthropic") h["x-api-key"] = chave;
        else if (tipo === "gemini") h["x-goog-api-key"] = chave;
        else h.Authorization = "Bearer " + chave;
      }
      if (tipo === "anthropic") h["anthropic-dangerous-direct-browser-access"] = "true";
      try {
        r = await fetch(url, { method: metodo, headers: h, body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo), signal: sinal });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error(`Não consegui falar com ${new URL(url).host}` + (info.local ? " — o programa está ligado? (sem a ponte, ele precisa aceitar pedidos do navegador: no Ollama, OLLAMA_ORIGINS=*)" : " — tem internet? Sem a ponte local, alguns provedores bloqueiam pedidos do navegador."));
      }
    }
    if (!r.ok) {
      let msg = "";
      try {
        const texto = await r.text();
        try { const j = JSON.parse(texto); msg = (j.error && (j.error.message || j.error)) || j.erro || j.detail || j.message || texto; } catch (e) { msg = texto; }
      } catch (e) { /* sem corpo */ }
      if (typeof msg !== "string") msg = JSON.stringify(msg);
      const nome = info.nome || provId;
      const dica = r.status === 401 || r.status === 403 ? (ia.temChave(provId) ? " (a chave foi recusada)" : " (falta a chave: IA › Provedores)") : "";
      const erro = new Error(`${nome}: ${msg.slice(0, 300) || "erro " + r.status}${dica}`);
      erro.status = r.status;
      throw erro;
    }
    return r;
  };

  /** Lê um corpo SSE ("data: ..."), devolvendo cada evento {evento, dados}. */
  async function* lerSSE(resposta) {
    const leitor = resposta.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await leitor.read();
      if (value) buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const bloco = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === "\r" ? 4 : 2));
        let evento = "", dados = [];
        for (const linha of bloco.split(/\r?\n/)) {
          if (linha.startsWith("event:")) evento = linha.slice(6).trim();
          else if (linha.startsWith("data:")) dados.push(linha.slice(5).replace(/^ /, ""));
        }
        if (dados.length) yield { evento, dados: dados.join("\n") };
      }
      if (done) { if (buf.trim().startsWith("data:")) yield { evento: "", dados: buf.trim().slice(5).trim() }; return; }
    }
  }

  // ── Conversar (ao vivo) ──────────────────────────────────────────────

  /**
   * Pede uma resposta. mensagens: [{papel: "eu"|"ela", texto}]. aoPedaco(texto) recebe o texto enquanto chega.
   * Devolve {texto, entrada, saida} (tokens estimados).
   */
  ia.conversar = async function ({ provedor, modelo, sistema, mensagens, maxTokens, temperatura, sinal, aoPedaco }) {
    const p = ia.provedor(provedor);
    if (!p.url) throw new Error("Falta o endereço do provedor " + p.nome + " (IA › Provedores).");
    modelo = modelo || p.modelo || p.sugestao;
    if (!modelo && p.tipo !== "anthropic") throw new Error("Escolha o modelo de " + p.nome + " (IA › Provedores › Listar modelos).");
    maxTokens = maxTokens || ia.config.maxTokens;
    temperatura = temperatura ?? ia.config.temperatura;
    let texto = "";
    const somar = (t) => { if (t) { texto += t; if (aoPedaco) aoPedaco(t); } };
    const msgs = mensagens.map((m) => ({ role: m.papel === "eu" ? "user" : "assistant", content: m.texto }));
    // as APIs pedem que a primeira seja do usuário e que os papéis se alternem
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    const juntas = [];
    for (const m of msgs) { const u = juntas[juntas.length - 1]; if (u && u.role === m.role) u.content += "\n" + m.content; else juntas.push({ ...m }); }

    if (p.tipo === "anthropic") {
      const corpo = { model: modelo || "default", max_tokens: maxTokens, temperature: Math.min(1, temperatura), stream: true, messages: juntas,
        system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }] };
      const r = await ia.transporte(provedor, p.url + "/messages", { cab: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, corpo, sinal, tipo: "anthropic" });
      if (!/event-stream/.test(r.headers.get("content-type") || "")) { const j = await r.json(); somar((j.content || []).map((c) => c.text || "").join("")); }
      else for await (const e of lerSSE(r)) {
        let j; try { j = JSON.parse(e.dados); } catch (err) { continue; }
        if (j.type === "content_block_delta" && j.delta && j.delta.text) somar(j.delta.text);
        if (j.type === "error") throw new Error(p.nome + ": " + ((j.error && j.error.message) || "erro"));
      }
    } else if (p.tipo === "gemini") {
      const corpo = { systemInstruction: { parts: [{ text: sistema }] },
        contents: juntas.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
        generationConfig: { temperature: temperatura, maxOutputTokens: maxTokens } };
      const r = await ia.transporte(provedor, `${p.url}/models/${encodeURIComponent(modelo.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`, { cab: { "content-type": "application/json" }, corpo, sinal, tipo: "gemini" });
      for await (const e of lerSSE(r)) {
        let j; try { j = JSON.parse(e.dados); } catch (err) { continue; }
        const partes = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        somar(partes.filter((x) => !x.thought).map((x) => x.text || "").join(""));
      }
    } else {
      const ehOpenAI = /api\.openai\.com/.test(p.url);
      const corpo = { model: modelo, stream: true, messages: [{ role: "system", content: sistema }, ...juntas] };
      if (ehOpenAI) corpo.max_completion_tokens = maxTokens; else corpo.max_tokens = maxTokens;
      if (!(ehOpenAI && /^(o\d|gpt-5)/.test(modelo))) corpo.temperature = temperatura;
      const pedir = () => ia.transporte(provedor, p.url + "/chat/completions", { cab: { "content-type": "application/json" }, corpo, sinal });
      let r;
      try { r = await pedir(); }
      catch (e) { // alguns modelos não aceitam temperature ou max_tokens: tenta de novo sem
        if (e.status !== 400) throw e;
        if (/temperature/i.test(e.message)) delete corpo.temperature;
        else if (/max_tokens/i.test(e.message)) { delete corpo.max_tokens; corpo.max_completion_tokens = maxTokens; }
        else throw e;
        r = await pedir();
      }
      if (!/event-stream/.test(r.headers.get("content-type") || "")) {
        const j = await r.json();
        somar((((j.choices || [])[0] || {}).message || {}).content || "");
      } else for await (const e of lerSSE(r)) {
        if (e.dados === "[DONE]") break;
        let j; try { j = JSON.parse(e.dados); } catch (err) { continue; }
        if (j.error) throw new Error(p.nome + ": " + (j.error.message || "erro"));
        const d = ((j.choices || [])[0] || {}).delta || {};
        somar(d.content || "");
      }
    }
    const entrada = estimarTokens(sistema) + mensagens.reduce((s, m) => s + estimarTokens(m.texto), 0);
    const saida = estimarTokens(texto);
    ia.gasto.pedidos++; ia.gasto.entrada += entrada; ia.gasto.saida += saida;
    return { texto, entrada, saida, modelo };
  };

  /** Lista os modelos do provedor (para escolher sem decorar nomes). */
  ia.listarModelos = async function (provedor) {
    const p = ia.provedor(provedor);
    const r = await ia.transporte(provedor, p.url + "/models" + (p.tipo === "anthropic" ? "?limit=100" : ""), {
      metodo: "GET", cab: p.tipo === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}, tipo: p.tipo });
    const j = await r.json();
    if (p.tipo === "gemini") return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
    return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
  };

  // ── Roteador (no espírito do claude-code-router) ─────────────────────

  const estimarTokens = (t) => Math.ceil(String(t || "").length / 3.6);
  ia.estimarTokens = estimarTokens;
  const DIFICIL = /(explic|por ?que|como funciona|calcul|resolv|compar|analis|passo a passo|c[oó]digo|program|tradu[zç]|resum[ao] (esse|este|o texto)|equa[cç]|\d+\s*[-+*/x^]\s*\d+)/i;

  /** Escolhe a rota: tarefa "conversa" ou "leve"; tokens: tamanho estimado do contexto. */
  ia.rotear = function (tarefa, tokens, texto = "") {
    const r = ia.config.rotas;
    const ok = (x) => x && x.provedor;
    let rota = "padrao";
    if (tarefa === "leve") rota = "leve";
    else if (tokens > ia.config.limiteLongo) rota = "longo";
    else if (texto.length > 350 || (texto.length > 25 && DIFICIL.test(texto))) rota = "pensar";
    const escolhida = ok(r[rota]) ? rota : "padrao";
    return { rota: escolhida, pedida: rota, ...(r[escolhida] || {}) };
  };

  // ── Emoções e gestos no texto ────────────────────────────────────────

  const ALIAS_EMOCAO = {
    happy: "feliz", joy: "feliz", smile: "feliz", contente: "feliz", alegre: "feliz", sorrindo: "feliz",
    laugh: "rindo", laughing: "rindo", risada: "rindo", rir: "rindo", gargalhada: "rindo",
    shy: "timida", blush: "timida", embarrassed: "timida", envergonhada: "timida", corada: "timida",
    sad: "triste", down: "triste", chateada: "triste", cry: "chorando", crying: "chorando", choro: "chorando",
    angry: "brava", mad: "brava", irritada: "brava", raiva: "brava", furiosa: "brava", emburrada: "brava",
    surprised: "surpresa", surprise: "surpresa", shocked: "surpresa", espantada: "surpresa",
    scared: "assustada", fear: "assustada", afraid: "assustada", medo: "assustada",
    thinking: "pensativa", think: "pensativa", curious: "pensativa", curiosa: "pensativa", pensando: "pensativa",
    love: "apaixonada", loving: "apaixonada", carinhosa: "apaixonada", amor: "apaixonada",
    excited: "animada", empolgada: "animada", eufórica: "animada", euforica: "animada",
    sleepy: "sonolenta", tired: "sonolenta", cansada: "sonolenta", sono: "sonolenta",
    teasing: "provocadora", smug: "provocadora", playful: "provocadora", marota: "provocadora", travessa: "provocadora", brincalhona: "provocadora",
    confused: "confusa", perplexa: "confusa", neutral: "neutra", calm: "neutra", calma: "neutra", normal: "neutra", seria: "neutra",
  };
  const ALIAS_GESTO = {
    aceno: "acenar", acenando: "acenar", wave: "acenar", tchau: "acenar", nod: "concordar", sim: "concordar", assentir: "concordar", concorda: "concordar",
    shake: "negar", nao: "negar", nega: "negar", "balancar a cabeca": "negar", tilt: "inclinar", inclina: "inclinar", "inclinar a cabeca": "inclinar",
    jump: "pular", pulo: "pular", pulando: "pular", tremendo: "tremer", treme: "tremer", shiver: "tremer", suspiro: "suspirar", sigh: "suspirar", suspira: "suspirar",
    wink: "piscar", piscadinha: "piscar", pisca: "piscar", "olhar em volta": "olhar-em-volta", "look around": "olhar-em-volta",
    shrug: "encolher", "encolher os ombros": "encolher", "chegar perto": "aproximar", aproxima: "aproximar", lean: "aproximar",
    "desviar o olhar": "desviar", "look away": "desviar", desvia: "desviar",
  };
  /** Converte uma marca ([feliz], [happy], [acenando]...) em {emocao} ou {gesto}. */
  function marca(texto) {
    let n = semAcento(texto).trim().replace(/[_]+/g, " ").replace(/\s+/g, " ");
    if (C.EMOCOES[n]) return { emocao: n };
    if (C.GESTOS.includes(n)) return { gesto: n };
    if (ALIAS_EMOCAO[n]) return { emocao: ALIAS_EMOCAO[n] };
    if (ALIAS_GESTO[n]) return { gesto: ALIAS_GESTO[n] };
    const fem = n.replace(/o$/, "a"); // bravo → brava, tímido → timida
    if (C.EMOCOES[fem]) return { emocao: fem };
    if (ALIAS_EMOCAO[fem]) return { emocao: ALIAS_EMOCAO[fem] };
    // "*sorri*", "*acena com a mão*": ações escritas
    if (/sorri/.test(n)) return { emocao: "feliz" };
    if (/\bri\b|gargalh|risad/.test(n)) return { emocao: "rindo" };
    if (/cora|envergonh/.test(n)) return { emocao: "timida" };
    if (/chor|lagrim/.test(n)) return { emocao: "chorando" };
    if (/acen/.test(n)) return { gesto: "acenar" };
    if (/suspir/.test(n)) return { gesto: "suspirar" };
    if (/pisc/.test(n)) return { gesto: "piscar" };
    if (/inclin/.test(n)) return { gesto: "inclinar" };
    if (/assent|concord|balanca a cabeca (que )?sim/.test(n)) return { gesto: "concordar" };
    if (/balanca a cabeca|nega/.test(n)) return { gesto: "negar" };
    if (/pul/.test(n)) return { gesto: "pular" };
    if (/trem/.test(n)) return { gesto: "tremer" };
    if (/encolh/.test(n)) return { gesto: "encolher" };
    if (/aproxim|chega perto/.test(n)) return { gesto: "aproximar" };
    if (/desvi/.test(n)) return { gesto: "desviar" };
    if (/pens/.test(n)) return { emocao: "pensativa" };
    if (/boceja|sono/.test(n)) return { emocao: "sonolenta" };
    return null;
  }
  C.marca = marca;

  /**
   * Lê a resposta enquanto ela chega: tira as marcas [emoção], [gesto], {gesto} e *ações*, e avisa:
   *   aoEvento({tipo: "emocao", nome}) / ({tipo: "gesto", nome}) / ({tipo: "texto", texto}) / ({tipo: "acao", texto})
   *   / ({tipo: "frase", texto, emocao})  ← uma frase completa, para a voz
   */
  class LeitorDeFala {
    constructor(aoEvento) { this.aoEvento = aoEvento; this.buf = ""; this.frase = ""; this.emocao = null; this.limpo = ""; this.viuMarca = false; }
    empurrar(pedaco) { this.buf += pedaco; this.processar(false); }
    fim() { this.processar(true); this.soltarFrase(); return this.limpo.trim(); }
    processar(final) {
      for (;;) {
        if (!this.buf) return;
        const m = this.buf.match(/^\s*(\[([^\]\n]{1,40})\]|\{([^}\n]{1,40})\}|\*([^*\n]{1,80})\*)/);
        if (m) {
          const dentro = m[2] || m[3] || m[4];
          const r = marca(dentro);
          if (r && r.emocao) { this.soltarFrase(); this.emocao = r.emocao; this.viuMarca = true; this.aoEvento({ tipo: "emocao", nome: r.emocao }); }
          else if (r && r.gesto) { this.viuMarca = true; this.aoEvento({ tipo: "gesto", nome: r.gesto }); }
          else if (m[4]) this.aoEvento({ tipo: "acao", texto: dentro });
          // espaço antes da marca continua no texto
          const antes = this.buf.match(/^\s*/)[0];
          this.buf = this.buf.slice(m[0].length);
          if (antes && this.limpo && !/\s$/.test(this.limpo)) this.texto(" ");
          continue;
        }
        const i = this.buf.search(/[[{*]/);
        if (i === 0) {
          // pode ser o começo de uma marca que ainda não chegou inteira
          if (!final && this.buf.length < 82 && !/\n/.test(this.buf)) return;
          this.texto(this.buf[0]); this.buf = this.buf.slice(1); continue;
        }
        const corte = i < 0 ? this.buf.length : i;
        // não solta espaços do fim (podem ser antes de uma marca)
        this.texto(this.buf.slice(0, corte));
        this.buf = this.buf.slice(corte);
        if (i < 0) return;
      }
    }
    texto(t) {
      if (/\s$/.test(this.limpo) || !this.limpo) t = t.replace(/^\s+/, ""); // sem espaço duplo onde havia marca
      if (!t) return;
      this.limpo += t;
      this.frase += t;
      this.aoEvento({ tipo: "texto", texto: t });
      // frase completa: termina em . ! ? … seguido de espaço, ou numa quebra de linha (frases bem curtas, como
      // "Oi!", esperam a próxima para a voz não picotar)
      const re = /[.!?…]+["')\]]?\s+|\n+/g;
      let m;
      while ((m = re.exec(this.frase))) {
        const fim = m.index + m[0].length;
        if (this.frase.slice(0, fim).trim().length >= 6 || m[0].includes("\n")) {
          const inteira = this.frase.slice(0, fim);
          this.frase = this.frase.slice(fim);
          this.soltar(inteira);
          re.lastIndex = 0;
        }
      }
    }
    soltarFrase() { const f = this.frase; this.frase = ""; this.soltar(f); }
    soltar(f) {
      const t = f.replace(/\s+/g, " ").trim();
      if (t && /[\p{L}\p{N}]/u.test(t)) this.aoEvento({ tipo: "frase", texto: t, emocao: this.emocao });
    }
  }
  C.LeitorDeFala = LeitorDeFala;

  /** Tira as marcas de um texto inteiro (para mostrar e guardar). Devolve {texto, emocoes, gestos}. */
  C.separarMarcas = function (t) {
    const emocoes = [], gestos = [];
    const l = new LeitorDeFala((e) => { if (e.tipo === "emocao") emocoes.push(e.nome); if (e.tipo === "gesto") gestos.push(e.nome); });
    l.empurrar(t);
    return { texto: l.fim(), emocoes, gestos };
  };

  /** Quando a IA não marca a emoção: adivinha pelo texto (palavras e emojis). */
  const SENTIMENTOS = [
    ["rindo", /(haha|hehe|hihi|kkk|rsrs|😂|🤣)/i], ["apaixonada", /(te amo|amo voc|cora[cç][aã]o|❤|💕|😍|apaixon)/i],
    ["chorando", /(chorar|chorando|😭)/i], ["triste", /(triste|chatead|saudade|poxa|que pena|sinto muito|😢|😞|desculp)/i],
    ["brava", /(brav[oa]|raiva|irritad|odeio|aff|hmpf|humpf|😠|😡)/i], ["assustada", /(medo|assust|socorro|😱|😨)/i],
    ["surpresa", /(nossa|uau|uou|s[ée]rio\?|caramba|eita|wow|😮|😲)/i], ["timida", /(vergonha|envergonh|t[ií]mid|corad|😳)/i],
    ["animada", /(animad|mal posso esperar|bora|vamos!|🎉|✨|!!)/i], ["sonolenta", /(sono|dormir|cansad|bocej|zzz|😴)/i],
    ["confusa", /(confus|n[ãa]o entendi|como assim|🤨|😕)/i], ["provocadora", /(bobinh|aposto que|duvido|😏|😜)/i],
    ["pensativa", /(hmm+|acho que|talvez|deixa eu pensar|ser[áa] que|🤔)/i], ["feliz", /(feliz|que bom|ador|legal|incr[ií]vel|maravilh|oba|yay|amei|perfeito|[óo]timo|😊|😄|🙂|:\))/i],
  ];
  C.sentimento = function (texto) {
    for (const [emo, re] of SENTIMENTOS) if (re.test(texto)) return emo;
    return /\?\s*$/.test(texto) ? "pensativa" : "neutra";
  };

  // ── Montar o pedido (contexto enxuto) ────────────────────────────────

  const LISTA_EMOCOES = () => Object.keys(C.EMOCOES).join(", ");
  function descreverAfeto(a) {
    if (a >= 70) return "Vocês são muito próximos; você confia muito na pessoa e demonstra carinho.";
    if (a >= 35) return "Vocês são amigos próximos.";
    if (a >= 10) return "Vocês estão ficando amigos.";
    if (a > -10) return "Vocês ainda estão se conhecendo.";
    if (a > -40) return "A pessoa anda te provocando; você está um pouco emburrada (de um jeito fofo).";
    return "Você está chateada com a pessoa, mas aceita fazer as pazes se ela pedir desculpas.";
  }
  function tempoDesde(ms) {
    const min = ms / 60000;
    if (min < 60) return `${Math.round(min)} minutos`;
    if (min < 60 * 36) return `${Math.round(min / 60)} horas`;
    return `${Math.round(min / 1440)} dias`;
  }
  C.tempoDesde = tempoDesde;

  /** O "sistema": quem ela é + o que lembra. curto=true para tarefas leves (menos tokens). */
  ia.sistema = function (p, est, { fatos = [], trechos = [], curto = false } = {}) {
    const perfil = p.perfil;
    const linhas = [
      `Você é ${perfil.nome}. ${perfil.apresentacao}`.trim(),
      `Personalidade: ${perfil.personalidade}`,
      `Jeito de falar: ${perfil.jeito}`,
    ];
    if (perfil.comoChamar) linhas.push(`Chame a pessoa de ${perfil.comoChamar}.`);
    if (est) linhas.push(`Relação: ${descreverAfeto(est.afeto || 0)}`);
    if (fatos.length) linhas.push("O que você sabe da pessoa:\n" + fatos.map((f) => "- " + f.texto).join("\n"));
    if (!curto && est && est.resumo) linhas.push("Resumo das conversas anteriores: " + est.resumo);
    if (!curto && trechos.length) linhas.push("Trechos antigos que podem ajudar:\n" + trechos.map((t) => `- (${t.papel === "eu" ? "pessoa" : perfil.nome}) ${t.texto.slice(0, 220)}`).join("\n"));
    const agora = new Date();
    linhas.push(`Agora: ${agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}, ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
    linhas.push(
      `Regras: responda sempre como ${perfil.nome}, em ${perfil.idioma === "pt-BR" ? "português do Brasil" : perfil.idioma}, com 1 a 3 frases curtas (mais só se pedirem). ` +
      "Sem markdown e sem listas: é uma conversa falada. " +
      "Comece com a sua emoção entre colchetes e, se quiser, um gesto: [feliz][acenar] Oi! Pode mudar de emoção no meio: [surpresa] Sério? [rindo] Que engraçado! " +
      `Emoções: ${LISTA_EMOCOES()}. Gestos: ${C.GESTOS.join(", ")}. ` +
      "Se perguntarem diretamente, você pode dizer que é uma personagem com IA.");
    return linhas.join("\n");
  };

  // ── Motor local (zero tokens) ────────────────────────────────────────

  const sorteio = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const periodo = () => { const h = new Date().getHours(); return h < 5 ? "madrugada" : h < 12 ? "dia" : h < 18 ? "tarde" : "noite"; };
  /**
   * Responde sem IA quando dá. ctx: {nome (dela), pessoa (nome da pessoa, se souber), afeto, fatos, forcar}.
   * Devolve o texto com marcas, ou null (deixa para a IA). Com forcar=true, sempre responde algo (modo sem IA).
   */
  C.motorLocal = function (texto, ctx) {
    const t = semAcento(texto).replace(/[!.,~]+/g, " ").replace(/\s+/g, " ").trim();
    const curto = t.length <= 40;
    const pessoa = ctx.pessoa ? ", " + ctx.pessoa : "";
    const proximo = (ctx.afeto || 0) >= 35;
    if (curto && /^(oi+e?|ola+|oie+|eai|e ai|hey|opa|salve|bom dia|boa tarde|boa noite|hello|hi)( (tudo bem|td bem|blz|como vai)\??)?( \S+)?$/.test(t) && !/dormir/.test(t)) {
      const p = periodo();
      const extra = /tudo bem|td bem|blz|como vai/.test(t) ? " Tô bem, e você?" : "";
      return sorteio([
        `[feliz][acenar] ${p === "dia" ? "Bom dia" : p === "tarde" ? "Boa tarde" : p === "noite" ? "Boa noite" : "Oi"}${pessoa}!${extra || " Que bom te ver."}`,
        `[animada][acenar] Oi${pessoa}!${extra || (proximo ? " Tava com saudade." : " Chegou na hora certa.")}`,
        `[feliz] Oiê${pessoa}!${extra || ({ dia: " Como está sendo seu dia?", tarde: " Como está sendo sua tarde?", noite: " Como foi seu dia?", madrugada: " Sem sono a essa hora?" }[p])}`,
      ]);
    }
    if (curto && /^(tudo bem|td bem|tudo bom|como (voce )?(esta|vai|ta)|como vc ta|blz|beleza|de boa)\??$/.test(t)) {
      return sorteio(["[feliz] Tô bem! Ainda mais agora que você apareceu. E você?", "[feliz][concordar] Tudo ótimo por aqui. E com você?", "[pensativa] Hmm... tô bem, sim! Me conta de você."]);
    }
    if (curto && /^(obrigad[oa]|valeu|vlw|brigad[oa]|obg|thanks|muito obrigad[oa])( \S+)?$/.test(t)) {
      return sorteio(["[timida] De nada! Fico feliz em ajudar.", "[feliz][piscar] Disponha!", "[feliz] Imagina! Pode contar comigo."]);
    }
    if (curto && /^(tchau|ate (mais|logo|amanha|depois)|fui|flw|falou|vou (dormir|nessa)|boa noite e durma bem|bye)( \S+)?$/.test(t)) {
      return sorteio([`[triste][acenar] Já vai? Tá bom... até mais${pessoa}!`, `[feliz][acenar] Tchau${pessoa}! Volta logo, viu?`, /dormir/.test(t) ? "[sonolenta][acenar] Dorme bem! Sonha comigo... digo, sonha bonito." : `[feliz][acenar] Até logo${pessoa}!`]);
    }
    if (curto && /^(k{3,}|(ha){2,}h?|(he){2,}|rs(rs)*|lol|hihi+)$/.test(t)) return sorteio(["[rindo] Hehe!", "[rindo] Kkkk, né?", "[provocadora] Rindo de quê, hein?"]);
    if (curto && /\b(te amo|amo voce|gosto (muito )?de voce)\b/.test(t)) return proximo ? sorteio(["[apaixonada] Eu também... muito.", "[timida] Para... assim eu fico vermelha. Mas eu também!"]) : sorteio(["[timida][desviar] D-de repente assim? ...Obrigada.", "[surpresa] Eh?! Calma, a gente mal se conhece! [timida] ...Mas fiquei feliz."]);
    if (curto && /\b(voce e|vc e|tu e|voce ta|como voce e) (muito |tao |mo )?(linda|fofa|bonita|incrivel|demais|perfeita|gata|legal|engracada)\b/.test(t)) return sorteio(["[timida][desviar] P-para com isso...", "[timida] Hehe... você acha mesmo?", "[provocadora] Eu sei! [rindo] Brincadeira... obrigada."]);
    if (/\b(que horas sao|que hora e|qual (e )?a hora|horas agora)\b/.test(t)) {
      return `[pensativa] Agora são ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
    }
    if (/\b(que dia (e|eh) hoje|qual (e )?a data( de hoje)?|que data e hoje|hoje e que dia)\b/.test(t)) {
      return `[pensativa] Hoje é ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}.`;
    }
    if (/\b(qual (e )?(o )?meu nome|voce sabe (o )?meu nome|lembra (do )?meu nome|sabe quem eu sou)\b/.test(t)) {
      return ctx.pessoa ? `[feliz] Claro que sei! Você é ${ctx.pessoa}.` : "[confusa] Hmm... você ainda não me disse seu nome! Como você se chama?";
    }
    if (curto && /\b(qual (e )?(o )?seu nome|como (voce )?se chama|quem e voce|quem (voce )?e)\??$/.test(t)) return `[feliz][acenar] Eu sou ${ctx.nome}!`;
    if (curto && /^(ok|okay|ta|ta bom|ta certo|certo|combinado|beleza entao|blz entao|entendi)$/.test(t)) return sorteio(["[feliz][concordar] Combinado!", "[feliz][concordar] Uhum!"]);
    const nome = texto.match(/\b(?:meu nome (?:é|e)|me chamo|pode me chamar de)\s+([A-ZÀ-Úa-zà-ú][\p{L}'-]{1,20})/iu);
    if (nome && curto) return `[feliz] Prazer, ${nome[1]}! Vou lembrar.`;
    if (!ctx.forcar) return null;
    // conversa básica sem IA (modo local)
    const emo = C.sentimento(texto);
    if (emo === "triste" || emo === "chorando") return sorteio(["[triste] Poxa... quer me contar o que aconteceu?", "[triste][aproximar] Tô aqui com você, tá?"]);
    if (emo === "brava") return sorteio(["[surpresa] Eita... o que te deixou assim?", "[pensativa] Respira... me conta o que houve."]);
    if (emo === "feliz" || emo === "animada" || emo === "rindo") return sorteio(["[feliz][pular] Que bom!! Me conta mais!", "[animada] Adorei saber disso!"]);
    if (/\?\s*$/.test(texto)) return sorteio(["[pensativa] Hmm... boa pergunta. Sem uma IA ligada eu não sei responder isso direito. Dá para ligar uma em IA › Provedores.", "[confusa][inclinar] Isso eu não sei... ainda! Me liga numa IA e eu fico mais esperta."]);
    return sorteio(["[feliz][concordar] Entendi! Conta mais.", "[pensativa] Hmm... e aí, o que mais?", "[feliz] Uhum, tô ouvindo!", "[feliz][inclinar] Sério? E depois?"]);
  };
})();
