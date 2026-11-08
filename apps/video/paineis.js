/*
 * Vídeo — os outros painéis: abas, Origem (monitor da mídia, com entrada/saída e Inserir/Sobrescrever),
 * Mixer de áudio, Metadados, Projeto (pastas, lista e ícones, rótulos, busca), Navegador de mídia (pastas do
 * aparelho pela ponte), Efeitos (árvore com busca e predefinições), Marcadores, Informações, Histórico,
 * Gráficos essenciais (modelos de título, terço inferior, créditos...) e Texto (legendas SRT/VTT).
 */
(function () {
  "use strict";
  const { el, $, $$, limitar, icone } = LNUX;
  const P = (V.Paineis = {});
  let A = null;
  const abertas = {}; // painel → aba aberta
  const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nomeMidia = (m) => (m ? m.nome : "");
  const usosDa = (id) => A.projeto.clipes.filter((c) => c.midia === id).length;

  // ── Abas ────────────────────────────────────────────────────────────

  P.abrirAba = function (painel, aba) {
    const caixa = $(`.lnux-painel[data-painel="${painel}"]`);
    if (!caixa) return;
    abertas[painel] = aba;
    LNUX.preferencia.gravar("lnux.video.aba." + painel, aba);
    for (const b of $$(".lnux-abas button[data-aba]", caixa)) { b.setAttribute("aria-selected", String(b.dataset.aba === aba)); b.setAttribute("role", "tab"); }
    for (const c of $$(".aba-corpo", caixa)) c.classList.toggle("aberta", c.dataset.aba === aba);
    desenharAba(aba, false);
    if (aba === "escopos") V.Controles && V.Controles.redesenharEscopos();
  };
  const abaAberta = (aba) => Object.values(abertas).includes(aba);

  const assinaturas = {};
  let projetoVisto = null;
  function desenharAba(aba, leve) {
    if (!A) return;
    const f = DESENHAR[aba];
    if (!f) return;
    const caixa = $("#aba-" + aba);
    if (leve && caixa && caixa.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return; // não atrapalha quem digita
    f(caixa, leve);
  }
  /** Reconstrói a aba só se o que ela mostra mudou. */
  function mudouAssinatura(aba, valor) {
    const s = JSON.stringify(valor);
    if (assinaturas[aba] === s) return false;
    assinaturas[aba] = s;
    return true;
  }

  P.desenhar = function (leve) {
    if (!A) return;
    if (A.projeto !== projetoVisto) { projetoVisto = A.projeto; for (const k of Object.keys(assinaturas)) delete assinaturas[k]; }
    for (const aba of new Set(Object.values(abertas))) desenharAba(aba, leve);
  };

  // ── Origem ──────────────────────────────────────────────────────────

  let origemId = null, origemEl = null, origemVideo = true, origemAudio = true;
  const origem = {};
  function montarOrigem() {
    const caixa = $("#aba-origem");
    origem.nome = el("div", { class: "nome" }, "Dois cliques numa mídia do Projeto abrem ela aqui.");
    origem.tela = el("div", { class: "tela-origem" });
    origem.tempo = el("span", { class: "mono tempo-programa", title: "Tempo da mídia" }, "00:00:00:00");
    origem.trecho = el("span", { class: "mono fraco", title: "Duração entre a entrada e a saída" }, "");
    origem.regua = el("canvas", { class: "regua-monitor", height: 18 });
    const b = (ic, dica, acao, extra = "") => { const x = LNUX.botaoIcone("info", dica, acao, "plano " + extra); x.innerHTML = A.icv(ic); return x; };
    origem.play = b("play", "Tocar/pausar a origem (Espaço com a Origem ativa)", () => tocarOrigem());
    origem.bVideo = el("button", { type: "button", class: "lnux-botao pequeno", "aria-pressed": "true", title: "Levar o vídeo ao inserir/sobrescrever", onclick: () => { origemVideo = !origemVideo; origem.bVideo.setAttribute("aria-pressed", String(origemVideo)); } }, "Vídeo");
    origem.bAudio = el("button", { type: "button", class: "lnux-botao pequeno", "aria-pressed": "true", title: "Levar o áudio ao inserir/sobrescrever", onclick: () => { origemAudio = !origemAudio; origem.bAudio.setAttribute("aria-pressed", String(origemAudio)); } }, "Áudio");
    const controles = el("div", { class: "controles-monitor" },
      b("entrada", "Marcar entrada (I)", () => P.marcarOrigem("entrada")),
      b("saida", "Marcar saída (O)", () => P.marcarOrigem("saida")),
      b("ir-entrada", "Ir para a entrada", () => irOrigem(midiaOrigem()?.origemEntrada ?? 0), "so-pc"),
      b("voltar", "Quadro anterior", () => P.quadroOrigem(-1)), origem.play, b("avancar", "Próximo quadro", () => P.quadroOrigem(1)),
      b("ir-saida", "Ir para a saída", () => irOrigem(midiaOrigem()?.origemSaida ?? (origemEl ? origemEl.duration : 0)), "so-pc"),
      el("span", { class: "sep" }),
      el("button", { type: "button", class: "lnux-botao pequeno", title: "Inserir na linha do tempo, no cursor, empurrando o resto (,)", onclick: () => P.daOrigem("inserir") }, "Inserir"),
      el("button", { type: "button", class: "lnux-botao pequeno", title: "Sobrescrever na linha do tempo, no cursor (.)", onclick: () => P.daOrigem("sobrescrever") }, "Sobrescrever"),
      origem.bVideo, origem.bAudio);
    caixa.replaceChildren(el("div", { class: "origem" }, origem.nome, origem.tela, el("div", { class: "monitor-tempos" }, origem.tempo, el("span", { class: "espaco", style: { flex: 1 } }), origem.trecho), origem.regua, controles));
    origem.regua.addEventListener("pointerdown", (e) => {
      if (!origemEl) return;
      origem.regua.setPointerCapture(e.pointerId);
      const ir = (ev) => { const r = origem.regua.getBoundingClientRect(); irOrigem(((ev.clientX - r.left - 8) / (r.width - 16)) * (origemEl.duration || 0)); };
      ir(e);
      const mover = (ev) => ir(ev), fim = () => { origem.regua.removeEventListener("pointermove", mover); origem.regua.removeEventListener("pointerup", fim); };
      origem.regua.addEventListener("pointermove", mover); origem.regua.addEventListener("pointerup", fim);
    });
    new ResizeObserver(desenharReguaOrigem).observe(origem.regua);
  }
  const midiaOrigem = () => (origemId ? A.midia(origemId) : null);
  function irOrigem(t) { if (!origemEl || origemEl.tagName === "IMG") return; origemEl.currentTime = limitar(t, 0, origemEl.duration || 0); mostrarTempoOrigem(); }
  function mostrarTempoOrigem() {
    const m = midiaOrigem();
    origem.tempo.textContent = A.tempo(origemEl && origemEl.currentTime ? origemEl.currentTime : 0);
    if (m) {
      const de = m.origemEntrada ?? 0, ate = m.origemSaida ?? (m.tipo === "imagem" ? 5 : m.duracao);
      origem.trecho.textContent = (m.origemEntrada !== undefined || m.origemSaida !== undefined ? "entrada→saída " : "duração ") + A.tempo(Math.max(0, ate - de));
    }
    desenharReguaOrigem();
  }
  function desenharReguaOrigem() {
    const cv = origem.regua, w = cv.clientWidth, h = 18, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = midiaOrigem();
    const d = origemEl && origemEl.duration && isFinite(origemEl.duration) ? origemEl.duration : (m ? m.duracao || 5 : 1);
    const x = (t) => 8 + (t / d) * (w - 16);
    ctx.strokeStyle = LNUX.tema.cor("--borda-forte");
    ctx.beginPath(); ctx.moveTo(8, 12.5); ctx.lineTo(w - 8, 12.5); ctx.stroke();
    if (m && (m.origemEntrada !== undefined || m.origemSaida !== undefined)) {
      ctx.fillStyle = "rgba(79,143,247,.35)";
      const a = x(m.origemEntrada ?? 0), b = x(m.origemSaida ?? d);
      ctx.fillRect(a, 4, Math.max(2, b - a), 10);
    }
    if (origemEl && origemEl.tagName !== "IMG") {
      const xc = x(origemEl.currentTime || 0);
      ctx.fillStyle = "#4f8ff7"; ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc, 9); ctx.fill(); ctx.fillRect(xc - 0.5, 0, 1, h);
    }
  }
  P.abrirNaOrigem = function (id) {
    const m = A.midia(id);
    if (!m) return;
    origemId = id;
    A.midiaEscolhida = id;
    A.monitorAtivo = "origem";
    P.abrirAba("esq", "origem");
    if (origemEl && origemEl.pause) origemEl.pause();
    const url = A.urls.get(id);
    origem.nome.textContent = m.nome + (url ? "" : " — mídia faltando");
    if (!url) { origem.tela.replaceChildren(); origemEl = null; return; }
    if (m.tipo === "imagem") origemEl = el("img", { src: url, alt: m.nome });
    else {
      origemEl = el(m.tipo === "audio" ? "audio" : "video", { src: url, preload: "auto", playsinline: true, controls: m.tipo === "audio" });
      origemEl.addEventListener("timeupdate", mostrarTempoOrigem);
      origemEl.addEventListener("seeked", mostrarTempoOrigem);
      origemEl.addEventListener("loadedmetadata", () => { origemEl.currentTime = m.origemEntrada ?? 0; mostrarTempoOrigem(); });
      origemEl.addEventListener("play", () => { origem.play.innerHTML = icone("pausa"); });
      origemEl.addEventListener("pause", () => { origem.play.innerHTML = icone("play"); });
    }
    origemEl.draggable = true;
    origemEl.addEventListener("dragstart", (e) => { V.arrastando = { tipo: "midia", id }; e.dataTransfer.setData("text/x-lnux-midia", id); e.dataTransfer.effectAllowed = "copy"; });
    origemEl.addEventListener("dragend", () => { V.arrastando = null; });
    origem.tela.replaceChildren(origemEl);
    mostrarTempoOrigem();
    P.desenhar(true);
  };
  function tocarOrigem() { if (!origemEl || origemEl.tagName === "IMG") return; if (origemEl.paused) origemEl.play().catch(() => {}); else origemEl.pause(); }
  P.tocarOrigem = tocarOrigem;
  P.jklOrigem = function (tecla) {
    if (!origemEl || origemEl.tagName === "IMG") return;
    if (tecla === "k") { origemEl.pause(); return; }
    if (tecla === "j") { origemEl.pause(); origemEl.currentTime = Math.max(0, origemEl.currentTime - 1); return; } // o navegador não toca para trás: volta 1 s
    origemEl.playbackRate = origemEl.paused ? 1 : Math.min(8, origemEl.playbackRate * 2);
    origemEl.play().catch(() => {});
  };
  P.quadroOrigem = function (n) { if (origemEl && origemEl.tagName !== "IMG") { origemEl.pause(); irOrigem(origemEl.currentTime + n / A.projeto.fps); } };
  P.origemTemMidia = () => !!(origemId && A.midia(origemId));
  /** I/O na Origem. Devolve true se tratou (a Origem tem uma mídia). */
  P.marcarOrigem = function (tipo) {
    const m = midiaOrigem();
    if (!m) return false;
    const t = origemEl && origemEl.tagName !== "IMG" ? A.arredondar(origemEl.currentTime) : tipo === "entrada" ? 0 : 5;
    A.marcar(tipo === "entrada" ? "Entrada da origem" : "Saída da origem");
    if (tipo === "entrada") { m.origemEntrada = t; if (m.origemSaida !== undefined && m.origemSaida <= t) delete m.origemSaida; }
    else { m.origemSaida = t; if (m.origemEntrada !== undefined && m.origemEntrada >= t) delete m.origemEntrada; }
    mostrarTempoOrigem();
    A.mudou({ leve: true });
    return true;
  };
  P.limparMarcasOrigem = function () { const m = midiaOrigem(); if (!m) return false; A.marcar("Limpar marcas da origem"); delete m.origemEntrada; delete m.origemSaida; mostrarTempoOrigem(); A.mudou({ leve: true }); return true; };
  /** Inserir (,) ou Sobrescrever (.) a mídia da Origem na linha do tempo, no cursor, nas trilhas de origem. */
  P.daOrigem = function (modo) {
    const id = origemId || A.midiaEscolhida;
    const m = id && A.midia(id);
    if (!m) { LNUX.aviso("Abra uma mídia na Origem (dois cliques no painel Projeto)."); return; }
    const p = A.projeto;
    const video = origemVideo && m.tipo !== "audio" && p.trilhas.some((t) => t.tipo === "video" && t.origem && !t.travada);
    const audio = origemAudio && (m.tipo === "audio" || m.temAudio) && p.trilhas.some((t) => t.tipo === "audio" && t.origem && !t.travada);
    if (!video && !audio) { LNUX.aviso("Ligue o botão V ou A (origem) no cabeçalho de uma trilha para dizer onde a mídia entra."); return; }
    const novos = A.colocarMidia(id, { modo, entrada: m.origemEntrada, saida: m.origemSaida, video, audio, tempo: A.arredondar(A.cursor) });
    if (novos.length) A.irPara(Math.max(...novos.map(V.fim)));
  };

  // ── Mixer de áudio ──────────────────────────────────────────────────

  let canaisMixer = [];
  function desenharMixer(caixa) {
    const p = A.projeto;
    if (!mudouAssinatura("mixer", [p.trilhas.filter((t) => t.tipo === "audio").map((t) => [t.id, t.nome, t.mudo, t.solo]), A.projeto.volumeMestre === undefined])) { atualizarMixer(); return; }
    canaisMixer = [];
    const fmt = (v) => (v <= -59.9 ? "−∞" : (v > 0 ? "+" : "") + v.toFixed(1).replace(".", ",")) + " dB";
    const canal = (t, mestre) => {
      const obter = () => (mestre ? p.volumeMestre || 0 : t.volume || 0);
      const fader = el("input", { class: "fader", type: "range", min: -60, max: 12, step: 0.5, value: obter(), "aria-label": "Volume " + (mestre ? "do mestre" : t.nome) });
      const vl = el("div", { class: "vl" }, fmt(obter()));
      let marcou = false;
      fader.addEventListener("input", () => { if (!marcou) { A.marcar("Volume da trilha"); marcou = true; } if (mestre) p.volumeMestre = +fader.value; else t.volume = +fader.value; vl.textContent = fmt(+fader.value); A.mudou({ leve: true }); });
      fader.addEventListener("change", () => { marcou = false; });
      fader.addEventListener("dblclick", () => { A.marcar("Volume 0 dB"); if (mestre) p.volumeMestre = 0; else t.volume = 0; A.mudou(); assinaturas.mixer = null; desenharMixer(caixa); });
      const medidor = el("canvas", { width: 10, height: 120 });
      const pan = mestre ? el("span") : el("input", { class: "pan", type: "range", min: -100, max: 100, step: 1, value: t.pan || 0, title: "Panorama (dois cliques: centro)", "aria-label": "Panorama " + t.nome });
      if (!mestre) {
        let mp = false;
        pan.addEventListener("input", () => { if (!mp) { A.marcar("Panorama da trilha"); mp = true; } t.pan = +pan.value; A.mudou({ leve: true }); });
        pan.addEventListener("change", () => { mp = false; });
        pan.addEventListener("dblclick", () => { A.marcar("Panorama ao centro"); t.pan = 0; pan.value = 0; A.mudou({ leve: true }); });
      }
      const botoes = mestre ? el("div", { class: "bt" }) : el("div", { class: "bt" },
        el("button", { type: "button", class: "m", "aria-pressed": String(!!t.mudo), title: "Mudo", onclick: () => { A.marcar("Mudo"); t.mudo = !t.mudo; A.mudou(); } }, "M"),
        el("button", { type: "button", class: "s", "aria-pressed": String(!!t.solo), title: "Solo", onclick: () => { A.marcar("Solo"); t.solo = !t.solo; A.mudou(); } }, "S"));
      canaisMixer.push({ id: mestre ? "_mestre" : t.id, medidor, atualizar: () => { if (document.activeElement !== fader) { fader.value = obter(); vl.textContent = fmt(obter()); } if (!mestre && document.activeElement !== pan) pan.value = t.pan || 0; } });
      return el("div", { class: "canal" + (mestre ? " mestre" : "") }, el("div", { class: "nm", title: mestre ? "Mestre" : t.nome }, mestre ? "Mestre" : t.nome), botoes, el("div", { class: "fm" }, fader, medidor), vl, pan);
    };
    caixa.replaceChildren(el("div", { class: "mixer" }, ...p.trilhas.filter((t) => t.tipo === "audio").map((t) => canal(t, false)), canal(null, true)));
  }
  function atualizarMixer() { for (const c of canaisMixer) c.atualizar(); }
  P.medidoresMixer = function (m) {
    if (!abaAberta("mixer") || !canaisMixer.length) return;
    for (const c of canaisMixer) {
      const v = !m ? 0 : c.id === "_mestre" ? Math.max(m.pico[0], m.pico[1]) : m.trilhas[c.id] || 0;
      const db = 20 * Math.log10(Math.max(1e-5, v));
      const f = limitar((db + 60) / 60, 0, 1);
      const cv = c.medidor, ctx = cv.getContext("2d"), h = cv.height;
      ctx.clearRect(0, 0, 10, h);
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, "#3fbf6f"); g.addColorStop(0.8, "#e8d44d"); g.addColorStop(1, "#e5484d");
      ctx.fillStyle = g; ctx.fillRect(0, h - f * h, 10, f * h);
    }
  };

  // ── Metadados ───────────────────────────────────────────────────────

  function desenharMetadados(caixa) {
    const c = A.escolhidos()[0];
    const id = A.midiaEscolhida || (c && c.midia);
    const m = id && A.midia(id);
    if (!mudouAssinatura("metadados", [id, m && m.nome, m && m.meta])) return;
    if (!m) { caixa.replaceChildren(el("div", { class: "props-painel" }, el("p", { class: "fraco" }, "Escolha uma mídia no painel Projeto para ver e anotar as informações dela."))); return; }
    m.meta = m.meta || {};
    const info = [["Nome", m.nome], ["Tipo", { video: "Vídeo", audio: "Áudio", imagem: "Imagem" }[m.tipo]], ["Duração", m.tipo === "imagem" ? "—" : A.tempo(m.duracao)],
      ["Tamanho do quadro", m.largura ? `${m.largura} × ${m.altura}` : "—"], ["Tem som", m.tipo === "imagem" ? "—" : m.temAudio ? "sim" : "não"],
      ["Arquivo", m.caminho || "guardado no navegador"], ["Tamanho", m.tamanho ? LNUX.bytes(m.tamanho) : "—"], ["Usada na sequência", usosDa(id) + " vez(es)"]];
    const campo = (chave, rotulo, area) => {
      const x = el(area ? "textarea" : "input", { class: "lnux-entrada", value: m.meta[chave] || "", rows: 3 });
      if (area) x.value = m.meta[chave] || "";
      x.addEventListener("change", () => { A.marcar("Metadados"); m.meta[chave] = x.value; assinaturas.metadados = JSON.stringify([id, m.nome, m.meta]); A.mudou({ leve: true }); });
      return el("label", { class: "lnux-campo" }, el("span", {}, rotulo), x);
    };
    caixa.replaceChildren(el("div", { class: "props-painel" },
      el("table", { class: "tabela" }, el("tbody", {}, ...info.map(([k, v]) => el("tr", {}, el("td", { class: "fraco" }, k), el("td", { style: { whiteSpace: "normal" } }, v))))),
      campo("descricao", "Descrição", true), campo("cena", "Cena"), campo("tomada", "Tomada"), campo("palavras", "Palavras-chave"), campo("comentario", "Comentário", true)));
  }

  // ── Projeto ─────────────────────────────────────────────────────────

  let pastaAtual = null, modoProjeto = LNUX.preferencia.ler("lnux.video.projeto.modo", "icones"), buscaProjeto = "", tamIcone = +LNUX.preferencia.ler("lnux.video.projeto.tam", "120");
  function desenharProjeto(caixa) {
    const p = A.projeto;
    p.pastas = p.pastas || [];
    if (!mudouAssinatura("projeto", [Object.entries(p.midias).map(([id, m]) => [id, m.nome, m.pasta, m.rotulo, !!A.urls.get(id), usosDa(id), m.origemEntrada, m.origemSaida]), p.pastas, pastaAtual, modoProjeto, buscaProjeto, tamIcone, A.midiaEscolhida])) return;
    const barra = el("div", { class: "barra-painel" });
    const botao = (ic, dica, acao) => { const b = LNUX.botaoIcone(ic, dica, acao, "plano pequeno"); return b; };
    const busca = el("input", { class: "lnux-entrada", type: "search", placeholder: "Procurar...", value: buscaProjeto, "aria-label": "Procurar no projeto", style: { minHeight: "26px" } });
    busca.addEventListener("input", () => { buscaProjeto = busca.value; desenharProjeto(caixa); const b = caixa.querySelector("input[type=search]"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    const tam = el("input", { type: "range", min: 70, max: 220, step: 10, value: tamIcone, title: "Tamanho dos ícones", "aria-label": "Tamanho dos ícones", style: { width: "70px" } });
    tam.addEventListener("input", () => { tamIcone = +tam.value; LNUX.preferencia.gravar("lnux.video.projeto.tam", tamIcone); grade.style.setProperty("--tam-icone", tamIcone + "px"); });
    barra.append(
      botao("importar", "Importar mídias (Ctrl+I)", () => A.importarDialogo().then((ids) => { for (const id of ids) A.projeto.midias[id].pasta = pastaAtual; A.mudou(); })),
      botao("pasta", "Nova pasta", async () => { const n = await LNUX.perguntar("Nova pasta", { rotulo: "Nome da pasta", valor: "Pasta " + (p.pastas.length + 1) }); if (!n) return; A.marcar("Nova pasta"); p.pastas.push({ id: V.novoId("p"), nome: n.trim(), pai: pastaAtual }); A.mudou(); }),
      botao("mais", "Novo item (título, forma, cor sólida, camada de ajuste)", (e) => { const r = e.currentTarget.getBoundingClientRect(); LNUX.abrirMenu(itensNovo(), r.left, r.bottom + 2); }),
      botao("video", "Pôr a mídia escolhida na linha do tempo, no cursor", () => { if (A.midiaEscolhida) { const novos = A.colocarMidia(A.midiaEscolhida, { tempo: A.cursor, entrada: A.midia(A.midiaEscolhida).origemEntrada, saida: A.midia(A.midiaEscolhida).origemSaida }); if (novos.length) A.irPara(Math.max(...novos.map(V.fim))); } else LNUX.aviso("Escolha uma mídia primeiro."); }),
      el("span", { class: "espaco" }), busca,
      el("button", { type: "button", class: "lnux-botao pequeno plano", "aria-pressed": String(modoProjeto === "lista"), title: "Ver em lista", onclick: () => { modoProjeto = modoProjeto === "lista" ? "icones" : "lista"; LNUX.preferencia.gravar("lnux.video.projeto.modo", modoProjeto); desenharProjeto(caixa); } }, "Lista"),
      modoProjeto === "icones" ? tam : null);
    const q = semAcento(buscaProjeto.trim());
    const pastas = q ? [] : p.pastas.filter((x) => (x.pai || null) === pastaAtual);
    const midias = Object.entries(p.midias).filter(([, m]) => (q ? semAcento(m.nome).includes(q) : (m.pasta || null) === pastaAtual));
    const caminho = [];
    for (let id = pastaAtual; id; ) { const x = p.pastas.find((k) => k.id === id); if (!x) break; caminho.unshift(x); id = x.pai || null; }
    const trilha = caminho.length ? el("div", { class: "barra-painel", style: { fontSize: ".88em" } },
      el("button", { type: "button", class: "lnux-botao pequeno plano", onclick: () => { pastaAtual = null; desenharProjeto(caixa); } }, "Projeto"),
      ...caminho.flatMap((x) => [el("span", { class: "fraco" }, "›"), el("button", { type: "button", class: "lnux-botao pequeno plano", onclick: () => { pastaAtual = x.id; desenharProjeto(caixa); } }, x.nome)])) : null;
    let grade;
    if (modoProjeto === "lista") {
      grade = el("div", { class: "lista-simples" }, el("table", { class: "tabela" },
        el("thead", {}, el("tr", {}, el("th", {}, "Nome"), el("th", {}, "Tipo"), el("th", {}, "Duração"), el("th", {}, "Quadro"), el("th", {}, "Usos"))),
        el("tbody", {}, ...pastas.map((x) => linhaPasta(x, caixa)), ...midias.map(([id, m]) => linhaMidia(id, m)))));
    } else {
      grade = el("div", { class: "grade-midias", style: { "--tam-icone": tamIcone + "px" } }, ...pastas.map((x) => iconePasta(x, caixa)), ...midias.map(([id, m]) => iconeMidia(id, m)));
    }
    if (!pastas.length && !midias.length) grade.append(el("div", { class: "fraco", style: { padding: "14px", gridColumn: "1 / -1" } }, q ? "Nada com esse nome." : "Importe vídeos, sons e imagens (botão ⤓ ou arraste arquivos para cá)."));
    LNUX.soltarArquivos(grade, async (lista) => { const ids = await A.importar(lista); for (const id of ids) A.projeto.midias[id].pasta = pastaAtual; A.mudou(); });
    caixa.replaceChildren(barra, trilha || "", grade);
  }
  function itensNovo() {
    return [
      { rotulo: "Título", acao: () => A.novoGrafico("texto") },
      { rotulo: "Forma", acao: () => A.novoGrafico("forma") },
      { rotulo: "Cor sólida", acao: () => A.novoGrafico("cor") },
      { rotulo: "Camada de ajuste", acao: () => A.novoGrafico("ajuste") },
    ];
  }
  function arrastavel(no, id) {
    no.draggable = true;
    no.addEventListener("dragstart", (e) => { V.arrastando = { tipo: "midia", id }; e.dataTransfer.setData("text/x-lnux-midia", id); e.dataTransfer.effectAllowed = "copyMove"; });
    no.addEventListener("dragend", () => { V.arrastando = null; });
  }
  function soltavelPasta(no, pastaId, caixa) {
    no.addEventListener("dragover", (e) => { if (V.arrastando && V.arrastando.tipo === "midia") { e.preventDefault(); no.classList.add("escolhida"); } });
    no.addEventListener("dragleave", () => no.classList.remove("escolhida"));
    no.addEventListener("drop", (e) => { if (!V.arrastando || V.arrastando.tipo !== "midia") return; e.preventDefault(); A.marcar("Mover para a pasta"); A.midia(V.arrastando.id).pasta = pastaId; V.arrastando = null; A.mudou(); desenharProjeto(caixa); });
  }
  function abrirPasta(x, caixa) { pastaAtual = x.id; desenharProjeto(caixa); }
  function menuPasta(e, x, caixa) {
    e.preventDefault();
    const p = A.projeto;
    LNUX.abrirMenu([
      { rotulo: "Abrir", acao: () => abrirPasta(x, caixa) },
      { rotulo: "Renomear...", acao: async () => { const n = await LNUX.perguntar("Renomear pasta", { valor: x.nome }); if (n) { A.marcar("Renomear pasta"); x.nome = n.trim(); A.mudou(); } } },
      { rotulo: "Apagar a pasta (as mídias voltam para fora)", acao: () => { A.marcar("Apagar pasta"); for (const m of Object.values(p.midias)) if (m.pasta === x.id) m.pasta = x.pai || null; for (const k of p.pastas) if (k.pai === x.id) k.pai = x.pai || null; p.pastas = p.pastas.filter((k) => k !== x); A.mudou(); } },
    ], e.clientX, e.clientY);
  }
  function iconePasta(x, caixa) {
    const n = A.projeto.pastas.filter((k) => k.pai === x.id).length + Object.values(A.projeto.midias).filter((m) => m.pasta === x.id).length;
    const no = el("div", { class: "item-midia", tabindex: 0, title: x.nome, ondblclick: () => abrirPasta(x, caixa), onkeydown: (e) => { if (e.key === "Enter") abrirPasta(x, caixa); }, oncontextmenu: (e) => menuPasta(e, x, caixa) },
      el("div", { class: "mini", html: icone("pasta") }), el("div", { class: "rodape" }, el("span", { class: "nm" }, x.nome), el("span", { class: "fraco" }, String(n))));
    soltavelPasta(no, x.id, caixa);
    return no;
  }
  function linhaPasta(x, caixa) {
    const tr = el("tr", { tabindex: 0, ondblclick: () => abrirPasta(x, caixa), oncontextmenu: (e) => menuPasta(e, x, caixa) }, el("td", {}, "📁 " + x.nome), el("td", { class: "fraco" }, "Pasta"), el("td"), el("td"), el("td"));
    soltavelPasta(tr, x.id, caixa);
    return tr;
  }
  function escolherMidia(id) { A.midiaEscolhida = id; assinaturas.projeto = null; A.mudou({ leve: true }); }
  function iconeMidia(id, m) {
    const falta = !A.urls.get(id);
    const mini = el("div", { class: "mini", style: m.miniatura ? { backgroundImage: `url(${m.miniatura})` } : {}, html: m.miniatura ? "" : icone(m.tipo === "audio" ? "musica" : m.tipo === "imagem" ? "imagem" : "video") });
    mini.append(el("span", { class: "faixa-cor", style: { background: A.CORES_ROTULO[m.rotulo] || "transparent" } }));
    if (falta) mini.append(el("div", { class: "falta" }, "mídia faltando"));
    if (m.origemEntrada !== undefined || m.origemSaida !== undefined) mini.append(el("span", { style: { position: "absolute", right: "3px", top: "3px", fontSize: "10px", background: "rgba(0,0,0,.6)", color: "#fff", padding: "0 4px", borderRadius: "3px" } }, "E/S"));
    const no = el("div", { class: "item-midia" + (A.midiaEscolhida === id ? " escolhida" : ""), tabindex: 0, title: `${m.nome}\n${m.tipo === "imagem" ? "imagem" : A.tempo(m.duracao)}${m.largura ? ` · ${m.largura}×${m.altura}` : ""}\nDois cliques: abrir na Origem · arraste para a linha do tempo`,
      onclick: () => escolherMidia(id), ondblclick: () => P.abrirNaOrigem(id), onkeydown: (e) => { if (e.key === "Enter") P.abrirNaOrigem(id); }, oncontextmenu: (e) => menuMidia(e, id) },
    mini, el("div", { class: "rodape" }, el("span", { class: "nm" }, m.nome), el("span", { class: "fraco" }, m.tipo === "imagem" ? "" : A.tempo(m.duracao).slice(3, 8))));
    arrastavel(no, id);
    return no;
  }
  function linhaMidia(id, m) {
    const tr = el("tr", { class: A.midiaEscolhida === id ? "escolhida" : "", tabindex: 0, onclick: () => escolherMidia(id), ondblclick: () => P.abrirNaOrigem(id), oncontextmenu: (e) => menuMidia(e, id) },
      el("td", {}, el("span", { class: "cor-marcador", style: { background: A.CORES_ROTULO[m.rotulo] || "transparent", marginRight: "6px" } }), m.nome + (A.urls.get(id) ? "" : " ⚠")),
      el("td", { class: "fraco" }, { video: "Vídeo", audio: "Áudio", imagem: "Imagem" }[m.tipo]), el("td", { class: "mono" }, m.tipo === "imagem" ? "—" : A.tempo(m.duracao)),
      el("td", { class: "fraco" }, m.largura ? `${m.largura}×${m.altura}` : "—"), el("td", { class: "fraco" }, String(usosDa(id))));
    arrastavel(tr, id);
    return tr;
  }
  function menuMidia(e, id) {
    e.preventDefault();
    const p = A.projeto, m = A.midia(id);
    escolherMidia(id);
    LNUX.abrirMenu([
      { rotulo: "Abrir na Origem", acao: () => P.abrirNaOrigem(id) },
      { rotulo: "Inserir na sequência (no cursor)", acao: () => A.colocarMidia(id, { modo: "inserir", entrada: m.origemEntrada, saida: m.origemSaida }) },
      { rotulo: "Sobrescrever na sequência (no cursor)", acao: () => A.colocarMidia(id, { modo: "sobrescrever", entrada: m.origemEntrada, saida: m.origemSaida }) },
      { rotulo: "Mostrar na sequência", ativo: () => usosDa(id) > 0, acao: () => { A.selecao = new Set(p.clipes.filter((c) => c.midia === id).map((c) => c.id)); const c = p.clipes.find((c) => c.midia === id); if (c) A.irPara(c.inicio); A.mudou({ leve: true }); } },
      "-",
      { rotulo: "Renomear...", acao: async () => { const n = await LNUX.perguntar("Renomear mídia", { valor: m.nome }); if (n) { A.marcar("Renomear mídia"); m.nome = n.trim(); A.mudou(); } } },
      { grupo: "Rótulo" },
      ...Object.keys(A.CORES_ROTULO).map((cor) => ({ rotulo: "● " + cor[0].toUpperCase() + cor.slice(1), marcado: () => (m.rotulo || "nenhum") === cor, acao: () => { A.marcar("Rótulo"); m.rotulo = cor; A.mudou(); } })),
      "-",
      ...(p.pastas.length ? [{ grupo: "Mover para" }, { rotulo: "(fora das pastas)", acao: () => { A.marcar("Mover"); m.pasta = null; A.mudou(); } }, ...p.pastas.map((x) => ({ rotulo: "📁 " + x.nome, acao: () => { A.marcar("Mover"); m.pasta = x.id; A.mudou(); } })), "-"] : []),
      { rotulo: A.urls.get(id) ? "Trocar o arquivo..." : "Encontrar o arquivo...", acao: () => trocarArquivo(id) },
      { rotulo: "Apagar do projeto", acao: async () => {
        const n = usosDa(id);
        if (n && !(await LNUX.confirmar("Apagar mídia", `"${m.nome}" está em ${n} clipe(s) da sequência. Apagar a mídia e esses clipes?`, { rotulo: "Apagar", perigo: true }))) return;
        A.marcar("Apagar mídia");
        for (const c of p.clipes.filter((c) => c.midia === id)) V.removerClipe(p, c.id);
        delete p.midias[id];
        A.arquivos.delete(id);
        LNUX.guardado.apagar("video:midia:" + id);
        if (A.midiaEscolhida === id) A.midiaEscolhida = null;
        A.mudou();
      } },
    ], e.clientX, e.clientY);
  }
  async function trocarArquivo(id) {
    const m = A.midia(id);
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Arquivo de " + m.nome, aceitar: m.tipo === "imagem" ? "image/*" : m.tipo === "audio" ? "audio/*" : "video/*" });
    if (!arq) return;
    A.marcar("Trocar arquivo");
    if (arq.origem === "ponte") { m.caminho = arq.caminho; A.arquivos.delete(id); }
    else { m.caminho = null; A.arquivos.set(id, await arq.blob()); A.guardados.delete(id); }
    m.tamanho = arq.tamanho;
    A.urls.delete(id); A.picos.delete(id);
    A.registrarUrl(id);
    A.mudou();
    LNUX.aviso("Arquivo ligado à mídia.", "ok");
  }
  P.mostrarNoProjeto = function (id) {
    const m = A.midia(id);
    if (!m) return;
    pastaAtual = m.pasta || null; buscaProjeto = "";
    A.midiaEscolhida = id;
    P.abrirAba("proj", "projeto");
    assinaturas.projeto = null;
    desenharProjeto($("#aba-projeto"));
  };

  // ── Navegador de mídia (pastas do aparelho, pela ponte) ─────────────

  let pastaNavegador = null;
  async function desenharNavegador(caixa, leve) {
    if (leve && caixa.childElementCount) return;
    if (!LNUX.ponte.disponivel) {
      caixa.replaceChildren(el("div", { class: "props-painel" },
        el("p", { class: "fraco" }, "O navegador de mídia mostra as pastas do aparelho quando o app é aberto pelo LNUX (ponte local: 🧩 Apps Web)."),
        el("button", { type: "button", class: "lnux-botao", onclick: () => A.importarDialogo() }, "Importar pelo navegador...")));
      return;
    }
    const estado = LNUX.ponte.estado || {};
    pastaNavegador = pastaNavegador || LNUX.preferencia.ler("lnux.video.navegador", "") || (estado.pastas && (estado.pastas["Vídeos"] || estado.pastas["Filmes"])) || estado.home || "~";
    let lista;
    try { lista = await LNUX.ponte.listar(pastaNavegador); } catch (e) { caixa.replaceChildren(el("p", { class: "fraco", style: { padding: "10px" } }, e.message)); pastaNavegador = estado.home || "~"; return; }
    pastaNavegador = lista.caminho;
    LNUX.preferencia.gravar("lnux.video.navegador", pastaNavegador);
    const campo = el("input", { class: "lnux-entrada", value: pastaNavegador, "aria-label": "Pasta", style: { minHeight: "26px" } });
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter") { pastaNavegador = campo.value; desenharNavegador(caixa); } });
    const ehMidia = (nome) => /^(video|audio|image)\//.test(LNUX.mimeDe(nome));
    const itens = lista.itens.filter((i) => i.tipo === "pasta" || ehMidia(i.nome));
    const atalhos = Object.entries(estado.pastas || {}).filter(([, c]) => c).map(([n, c]) => el("button", { type: "button", class: "lnux-botao pequeno plano", onclick: () => { pastaNavegador = c; desenharNavegador(caixa); } }, n));
    const importar = async (it) => { const ids = await A.importar([LNUX.arquivoDaPonte(it)]); if (ids[0]) P.abrirNaOrigem(ids[0]); };
    caixa.replaceChildren(
      el("div", { class: "barra-painel" }, LNUX.botaoIcone("seta-cima", "Pasta de cima", () => { pastaNavegador = pastaNavegador.replace(/\/[^/]+\/?$/, "") || "/"; desenharNavegador(caixa); }, "plano pequeno"), campo),
      el("div", { class: "barra-painel" }, ...atalhos),
      el("div", { class: "lista-simples" }, ...(itens.length ? itens : [null]).map((it) => !it ? el("div", { class: "fraco" }, "(nenhuma mídia aqui)") : el("div", {
        title: it.tipo === "pasta" ? "Abrir a pasta" : "Dois cliques: importar e abrir na Origem",
        onclick: () => { if (it.tipo === "pasta") { pastaNavegador = it.caminho; desenharNavegador(caixa); } },
        ondblclick: () => { if (it.tipo !== "pasta") importar(it); },
      }, el("span", { html: icone(it.tipo === "pasta" ? "pasta" : /^audio/.test(LNUX.mimeDe(it.nome)) ? "musica" : /^image/.test(LNUX.mimeDe(it.nome)) ? "imagem" : "video") }), el("span", { style: { flex: 1 } }, it.nome),
        it.tipo === "pasta" ? null : el("span", { class: "fraco" }, LNUX.bytes(it.tamanho)),
        it.tipo === "pasta" ? null : el("button", { type: "button", class: "lnux-botao pequeno", onclick: (e) => { e.stopPropagation(); importar(it); } }, "Importar")))));
  }

  // ── Efeitos ─────────────────────────────────────────────────────────

  const PREDEFINICOES = [
    { id: "cinema", nome: "Look de cinema (cor + barras)", efeitos: [["cor", { look: 1, intensidade: 80, contraste: 12 }], ["barras-cinema", {}]] },
    { id: "pb-contraste", nome: "Preto e branco com contraste", efeitos: [["preto-branco", { contraste: 30 }]] },
    { id: "vhs", nome: "Fita VHS antiga", efeitos: [["vhs", { quantidade: 70 }], ["ruido", { quantidade: 25 }], ["aberracao", { quantidade: 6 }]] },
    { id: "sonho", nome: "Sonho (brilho suave)", efeitos: [["brilho-glow", { limiar: 45, raio: 25, intensidade: 120 }], ["cor", { saturacao: 115, desbotado: 25 }]] },
    { id: "por-do-sol", nome: "Pôr do sol (duotone)", efeitos: [["duotone", { quantidade: 55 }]] },
    { id: "nitido", nome: "Mais nítido", efeitos: [["nitidez", { quantidade: 90 }]] },
    { id: "voz-podcast", nome: "Voz de podcast", audio: true, efeitos: [["passa-alta", { freq: 80 }], ["voz", { quantidade: 60 }], ["compressor", { limiar: -24, razao: 3 }], ["limitador", { teto: -1 }]] },
    { id: "radio", nome: "Voz de rádio antigo", audio: true, efeitos: [["passa-alta", { freq: 500 }], ["passa-baixa", { freq: 3500 }], ["compressor", { limiar: -30, razao: 8 }]] },
    { id: "sala", nome: "Ambiente de sala", audio: true, efeitos: [["reverb", { tamanho: 1.6, mistura: 22 }]] },
  ];
  P.aplicarPredefinicao = function (ids, id) {
    const pre = PREDEFINICOES.find((x) => x.id === id);
    if (!pre) return;
    const alvos = A.projeto.clipes.filter((c) => ids.has(c.id) && (A.trilha(c.trilha).tipo === "audio") === !!pre.audio);
    if (!alvos.length) { LNUX.aviso(pre.audio ? "Escolha um clipe de áudio." : "Escolha um clipe de vídeo, imagem ou título."); return; }
    A.marcar("Predefinição: " + pre.nome);
    for (const c of alvos) for (const [efeito, params] of pre.efeitos) { const fx = V.novoEfeito(efeito, !!pre.audio); Object.assign(fx.params, params); c.efeitos.push(fx); }
    A.selecao = new Set(alvos.map((c) => c.id));
    A.mudou();
    P.abrirAba("esq", "controles");
  };
  let buscaEfeitos = "", efeitoEscolhido = null;
  const abertasEfeitos = new Set(JSON.parse(LNUX.preferencia.ler("lnux.video.efeitos.abertas", '["Efeitos de vídeo","Transições de vídeo"]')));
  P.padraoVideo = LNUX.preferencia.ler("lnux.video.transicao.video", "dissolver");
  P.padraoAudio = LNUX.preferencia.ler("lnux.video.transicao.audio", "potencia");
  function aplicarItem(item) {
    if (item.tipo === "efeito") {
      if (!A.selecao.size) { LNUX.aviso("Escolha um ou mais clipes na linha do tempo (ou arraste o efeito até o clipe)."); return; }
      A.aplicarEfeito(new Set(A.selecao), item.id, item.audio);
    } else if (item.tipo === "predef") {
      if (!A.selecao.size) { LNUX.aviso("Escolha um ou mais clipes na linha do tempo."); return; }
      P.aplicarPredefinicao(new Set(A.selecao), item.id);
    } else {
      const trilhas = A.trilhasAlvo(item.audio ? "audio" : "video");
      const pontos = V.pontosDeCorte(A.projeto, trilhas).filter((x) => x > 0);
      if (!pontos.length) { LNUX.aviso("Não há pontos de corte nas trilhas marcadas."); return; }
      const corte = pontos.sort((x, y) => Math.abs(x - A.cursor) - Math.abs(y - A.cursor))[0];
      A.marcar("Transição");
      let n = 0;
      for (const t of trilhas) { const { a, b } = V.vizinhosNoCorte(A.projeto, t, corte); if ((a || b) && A.aplicarTransicao(t, corte, item.id, { marcar: false })) n++; }
      if (!n) LNUX.aviso("Nenhuma trilha marcada tem clipe nesse ponto.");
    }
  }
  function desenharEfeitos(caixa) {
    if (!mudouAssinatura("efeitos", [buscaEfeitos, efeitoEscolhido && efeitoEscolhido.id + efeitoEscolhido.tipo, P.padraoVideo, P.padraoAudio])) return;
    const busca = el("input", { class: "lnux-entrada", type: "search", placeholder: "Procurar efeitos e transições...", value: buscaEfeitos, "aria-label": "Procurar efeitos", style: { minHeight: "26px" } });
    busca.addEventListener("input", () => { buscaEfeitos = busca.value; desenharEfeitos(caixa); const b = caixa.querySelector("input[type=search]"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    const q = semAcento(buscaEfeitos.trim());
    const bate = (nome, cat) => !q || semAcento(nome + " " + (cat || "")).includes(q);
    const item = (x) => {
      const escolhido = efeitoEscolhido && efeitoEscolhido.id === x.id && efeitoEscolhido.tipo === x.tipo && !!efeitoEscolhido.audio === !!x.audio;
      const padrao = x.tipo === "transicao" && (x.audio ? P.padraoAudio : P.padraoVideo) === x.id;
      const no = el("div", { class: "item-efeito", tabindex: 0, style: escolhido ? { background: "var(--destaque-suave)" } : {}, title: "Arraste até um clipe (ou um corte) · dois cliques: aplicar no que estiver escolhido",
        onclick: () => { efeitoEscolhido = x; assinaturas.efeitos = null; desenharEfeitos(caixa); },
        ondblclick: () => aplicarItem(x), onkeydown: (e) => { if (e.key === "Enter") aplicarItem(x); },
        oncontextmenu: (e) => { e.preventDefault(); LNUX.abrirMenu([{ rotulo: "Aplicar", acao: () => aplicarItem(x) }, ...(x.tipo === "transicao" ? [{ rotulo: "Usar como transição padrão (Ctrl+D)", acao: () => { if (x.audio) { P.padraoAudio = x.id; LNUX.preferencia.gravar("lnux.video.transicao.audio", x.id); } else { P.padraoVideo = x.id; LNUX.preferencia.gravar("lnux.video.transicao.video", x.id); } assinaturas.efeitos = null; desenharEfeitos(caixa); } }] : [])], e.clientX, e.clientY); },
      }, el("span", { html: icone(x.tipo === "transicao" ? "camadas" : x.audio ? "onda" : x.tipo === "predef" ? "estrela" : "efeito") }), x.nome, padrao ? el("span", { class: "tag" }, "padrão") : null);
      no.draggable = true;
      no.addEventListener("dragstart", (e) => { V.arrastando = { tipo: x.tipo, id: x.id, audio: !!x.audio }; e.dataTransfer.setData("text/x-lnux-efeito", JSON.stringify(V.arrastando)); e.dataTransfer.effectAllowed = "copy"; });
      no.addEventListener("dragend", () => { V.arrastando = null; });
      return no;
    };
    const pasta = (nome, filhos, nivel = 0) => {
      if (!filhos.length) return null;
      const d = el("details", { open: !!q || abertasEfeitos.has(nome), style: nivel ? { paddingLeft: "12px" } : {} }, el("summary", {}, nome), ...filhos);
      d.addEventListener("toggle", () => { if (q) return; d.open ? abertasEfeitos.add(nome) : abertasEfeitos.delete(nome); LNUX.preferencia.gravar("lnux.video.efeitos.abertas", JSON.stringify([...abertasEfeitos])); });
      return d;
    };
    const porCategoria = (lista, tipo, audio, raiz) => {
      const cats = [...new Set(lista.map((x) => x.categoria || "Outros"))];
      return cats.map((cat) => pasta(raiz + " › " + cat, lista.filter((x) => (x.categoria || "Outros") === cat && bate(x.nome, cat)).map((x) => item({ tipo, id: x.id, nome: x.nome, audio })), 1)).filter(Boolean);
    };
    const arvore = el("div", { class: "arvore" },
      pasta("Predefinições", PREDEFINICOES.filter((x) => bate(x.nome, "predefinição")).map((x) => item({ tipo: "predef", id: x.id, nome: x.nome, audio: !!x.audio }))),
      pasta("Efeitos de vídeo", porCategoria(V.EFEITOS_VIDEO, "efeito", false, "Vídeo")),
      pasta("Transições de vídeo", porCategoria(V.TRANSICOES, "transicao", false, "Transição")),
      pasta("Efeitos de áudio", porCategoria(V.EFEITOS_AUDIO, "efeito", true, "Áudio")),
      pasta("Transições de áudio", V.TRANSICOES_AUDIO.filter((x) => bate(x.nome, "transição áudio")).map((x) => item({ tipo: "transicao", id: x.id, nome: x.nome, audio: true }))));
    if (!arvore.childElementCount) arvore.append(el("p", { class: "fraco", style: { padding: "10px" } }, "Nenhum efeito com esse nome."));
    caixa.replaceChildren(el("div", { class: "barra-painel" }, busca,
      el("button", { type: "button", class: "lnux-botao pequeno", title: "Aplicar o item escolhido nos clipes escolhidos (transição: no corte mais perto do cursor)", onclick: () => (efeitoEscolhido ? aplicarItem(efeitoEscolhido) : LNUX.aviso("Escolha um efeito da lista.")) }, "Aplicar")), arvore);
  }

  // ── Marcadores ──────────────────────────────────────────────────────

  let filtroMarcador = "";
  function desenharMarcadores(caixa) {
    const p = A.projeto;
    const atual = p.marcadores.find((m) => A.cursor >= m.tempo - 1e-4 && A.cursor <= m.tempo + Math.max(A.quadro(), m.duracao || 0));
    if (!mudouAssinatura("marcadores", [p.marcadores, filtroMarcador, atual && atual.id])) return;
    const filtro = el("select", { class: "lnux-selecao pequena", "aria-label": "Mostrar só a cor" }, el("option", { value: "" }, "Todas as cores"), ...Object.keys(A.CORES_MARCADOR).map((c) => el("option", { value: c, selected: c === filtroMarcador }, c[0].toUpperCase() + c.slice(1))));
    filtro.addEventListener("change", () => { filtroMarcador = filtro.value; desenharMarcadores(caixa); });
    const lista = [...p.marcadores].filter((m) => !filtroMarcador || m.cor === filtroMarcador).sort((a, b) => a.tempo - b.tempo);
    caixa.replaceChildren(
      el("div", { class: "barra-painel" },
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => A.comandos.marcador() }, "+ Marcador (M)"), filtro, el("span", { class: "espaco" }),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => P.exportarMarcadores() }, "Exportar CSV")),
      el("div", { class: "lista-simples" }, ...(lista.length ? lista.map((m) => el("div", {
        class: atual === m ? "atual" : "", tabindex: 0, title: "Clique: ir · dois cliques: editar",
        onclick: () => A.irPara(m.tempo), ondblclick: () => P.editarMarcador(m), onkeydown: (e) => { if (e.key === "Enter") P.editarMarcador(m); if (e.key === "Delete") { A.marcar("Apagar marcador"); p.marcadores = p.marcadores.filter((k) => k !== m); A.mudou({ leve: true }); } },
        oncontextmenu: (e) => { e.preventDefault(); LNUX.abrirMenu([{ rotulo: "Editar...", acao: () => P.editarMarcador(m) }, { rotulo: "Apagar", acao: () => { A.marcar("Apagar marcador"); p.marcadores = p.marcadores.filter((k) => k !== m); A.mudou({ leve: true }); } }], e.clientX, e.clientY); },
      }, el("span", { class: "cor-marcador", style: { background: A.CORES_MARCADOR[m.cor] || "#3fbf6f" } }), el("span", { class: "mono" }, A.tempo(m.tempo)),
        el("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, m.nome || el("i", { class: "fraco" }, "sem nome"), m.comentario ? el("span", { class: "fraco" }, " — " + m.comentario) : null),
        m.duracao ? el("span", { class: "fraco mono" }, A.tempo(m.duracao)) : null)) : [el("div", { class: "fraco", style: { cursor: "default" } }, "Sem marcadores. Aperte M para marcar o ponto do cursor.")])));
  }
  P.editarMarcador = async function (m) {
    const nome = el("input", { class: "lnux-entrada", value: m.nome || "" });
    const comentario = el("textarea", { class: "lnux-entrada", rows: 3 });
    comentario.value = m.comentario || "";
    const corSel = el("select", { class: "lnux-selecao" }, ...Object.keys(A.CORES_MARCADOR).map((c) => el("option", { value: c, selected: c === m.cor }, c[0].toUpperCase() + c.slice(1))));
    const duracao = el("input", { class: "lnux-entrada", value: A.tempo(m.duracao || 0) });
    const r = await LNUX.dialogo({ titulo: "Marcador em " + A.tempo(m.tempo), corpo: el("div", { style: { display: "grid", gap: "10px" } },
      el("label", { class: "lnux-campo" }, el("span", {}, "Nome"), nome), el("label", { class: "lnux-campo" }, el("span", {}, "Comentário"), comentario),
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, el("label", { class: "lnux-campo" }, el("span", {}, "Cor"), corSel), el("label", { class: "lnux-campo" }, el("span", {}, "Duração"), duracao))),
    botoes: [{ rotulo: "Apagar", valor: "apagar", perigo: true }, "espaco", { rotulo: "Cancelar", valor: null }, { rotulo: "OK", primario: true, valor: "ok" }] });
    if (r === "apagar") { A.marcar("Apagar marcador"); A.projeto.marcadores = A.projeto.marcadores.filter((k) => k.id !== m.id); A.mudou({ leve: true }); return; }
    if (r !== "ok") return;
    A.marcar("Editar marcador");
    const alvo = A.projeto.marcadores.find((k) => k.id === m.id) || m;
    alvo.nome = nome.value.trim(); alvo.comentario = comentario.value.trim(); alvo.cor = corSel.value;
    alvo.duracao = Math.max(0, A.lerTempo(duracao.value) || 0);
    A.mudou({ leve: true });
  };
  P.exportarMarcadores = function () {
    const q = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
    const linhas = ["Nome;Início;Duração;Cor;Comentário", ...[...A.projeto.marcadores].sort((a, b) => a.tempo - b.tempo).map((m) => [q(m.nome), A.tempo(m.tempo), A.tempo(m.duracao || 0), m.cor, q(m.comentario)].join(";"))];
    LNUX.arquivos.salvar(new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv" }), (A.projeto.nome || "marcadores") + " - marcadores.csv", { titulo: "Exportar marcadores" });
  };

  // ── Informações ─────────────────────────────────────────────────────

  function desenharInfo(caixa) {
    const p = A.projeto;
    const c = A.escolhidos()[0];
    const linhas = [];
    const titulo = (t) => linhas.push(el("tr", {}, el("th", { colspan: 2 }, t)));
    const lin = (k, v) => linhas.push(el("tr", {}, el("td", { class: "fraco" }, k), el("td", { class: "mono", style: { whiteSpace: "normal" } }, v)));
    if (c) {
      const m = c.tipo === "midia" ? A.midia(c.midia) : null;
      titulo("Clipe: " + (c.nome || (m && m.nome) || c.tipo));
      lin("Trilha", A.trilha(c.trilha).nome);
      lin("Começa", A.tempo(c.inicio)); lin("Termina", A.tempo(V.fim(c))); lin("Duração", A.tempo(c.duracao));
      if (m && m.tipo !== "imagem") { lin("Mídia (entrada)", A.tempo(c.entrada)); lin("Mídia (saída)", A.tempo(c.entrada + c.duracao * (c.velocidade || 1))); lin("Velocidade", Math.round((c.velocidade || 1) * 100) + "%"); }
      lin("Efeitos", c.efeitos.length ? c.efeitos.map((f) => (V.definicaoEfeito(f.id) || {}).nome || f.id).join(", ") : "nenhum");
      lin("Quadros-chave", String(Object.values(c.anim || {}).reduce((s, ch) => s + ch.length, 0)));
      if (A.selecao.size > 1) lin("Escolhidos", A.selecao.size + " clipes");
    }
    titulo("Sequência: " + p.nome);
    lin("Cursor", A.tempo(A.cursor)); lin("Duração", A.tempo(A.duracao()));
    if (p.entrada !== null || p.saida !== null) lin("Entrada → saída", `${A.tempo(p.entrada ?? 0)} → ${A.tempo(p.saida ?? A.duracao())}`);
    lin("Quadro", `${p.largura} × ${p.altura} · ${String(p.fps).replace(".", ",")} q/s`);
    lin("Clipes", String(p.clipes.length)); lin("Transições", String(p.transicoes.length)); lin("Marcadores", String(p.marcadores.length));
    caixa.replaceChildren(el("div", { class: "props-painel" }, el("table", { class: "tabela" }, el("tbody", {}, ...linhas))));
  }

  // ── Histórico ───────────────────────────────────────────────────────

  function desenharHistorico(caixa) {
    const h = A.hist;
    if (!mudouAssinatura("historico", [h.passado.length, h.futuro.length, h.passado.length ? h.passado[h.passado.length - 1].descricao : ""])) return;
    const itens = [el("div", { onclick: () => { while (h.podeDesfazer()) h.desfazer(); } }, el("span", { class: "fraco" }, "↺"), "Começo")];
    h.passado.forEach((x, i) => itens.push(el("div", { title: "Voltar até aqui", onclick: () => { for (let k = h.passado.length - 1; k > i; k--) h.desfazer(); } }, el("span", { class: "fraco mono" }, String(i + 1)), x.descricao || "Mudança")));
    itens.push(el("div", { class: "atual" }, el("span", { class: "fraco" }, "●"), "Agora"));
    [...h.futuro].reverse().forEach((x, i) => itens.push(el("div", { class: "fraco", title: "Refazer até aqui", onclick: () => { for (let k = 0; k <= i; k++) h.refazer(); } }, el("span", { class: "mono" }, "↻"), x.descricao || "Mudança")));
    caixa.replaceChildren(el("div", { class: "barra-painel" }, el("span", { class: "fraco" }, `${h.passado.length} passo(s) para desfazer`), el("span", { class: "espaco" }),
      el("button", { type: "button", class: "lnux-botao pequeno", disabled: !h.podeDesfazer(), onclick: () => h.desfazer() }, "Desfazer"),
      el("button", { type: "button", class: "lnux-botao pequeno", disabled: !h.podeRefazer(), onclick: () => h.refazer() }, "Refazer")),
    el("div", { class: "lista-simples" }, ...itens));
    const atual = caixa.querySelector(".atual");
    if (atual) atual.scrollIntoView({ block: "nearest" });
  }

  // ── Gráficos essenciais ─────────────────────────────────────────────

  const MODELOS = [
    { nome: "Título", icone: "texto", fazer: () => A.novoGrafico("texto") },
    { nome: "Terço inferior", icone: "legenda", fazer: () => A.novoGrafico("texto", { nome: "Terço inferior", texto: { conteudo: "Nome da pessoa\nCargo ou lugar", fonte: "system-ui, sans-serif", tamanho: 5, cor: "#ffffff", negrito: true, italico: false, alinhamento: "left", contorno: false, corContorno: "#000000", espessuraContorno: 8, sombra: false, fundo: { ligado: true, cor: "#1d4ed8", opacidade: 0.85 }, posicao: "baixo", animacao: "subir", entrelinha: 1.25 }, mov: { ...A.clipeBase().mov, posX: A.projeto.largura * 0.3, posY: A.projeto.altura * 0.5 } }) },
    { nome: "Créditos subindo", icone: "texto", fazer: () => A.novoGrafico("texto", { nome: "Créditos", texto: { conteudo: "Direção\nFulana de Tal\n\nRoteiro\nCiclano\n\nMúsica\nBeltrano\n\nObrigado por assistir!", fonte: "system-ui, sans-serif", tamanho: 5, cor: "#ffffff", negrito: false, italico: false, alinhamento: "center", contorno: false, sombra: true, fundo: { ligado: false, cor: "#000000", opacidade: 0.6 }, posicao: "meio", animacao: "rolar", entrelinha: 1.35 } }, { duracao: 12 }) },
    { nome: "Letreiro andando", icone: "texto", fazer: () => A.novoGrafico("texto", { nome: "Letreiro", texto: { conteudo: "ÚLTIMAS NOTÍCIAS • escreva aqui o seu texto que passa pela tela •", fonte: "system-ui, sans-serif", tamanho: 4.5, cor: "#ffffff", negrito: true, italico: false, alinhamento: "center", contorno: false, sombra: false, fundo: { ligado: true, cor: "#b91c1c", opacidade: 0.9 }, posicao: "baixo", animacao: "letreiro", entrelinha: 1.2 } }, { duracao: 10 }) },
    { nome: "Legenda", icone: "legenda", fazer: () => P.novaLegenda() },
    { nome: "Retângulo", icone: "retangulo", fazer: () => A.novoGrafico("forma") },
    { nome: "Elipse", icone: "elipse", fazer: () => { const c = A.novoGrafico("forma"); c.forma.tipo = "elipse"; c.forma.altura = c.forma.largura * 0.5; A.mudou(); } },
    { nome: "Linha", icone: "forma", fazer: () => { const c = A.novoGrafico("forma"); c.forma.tipo = "linha"; c.forma.espessura = 8; c.forma.contorno = "#ffffff"; A.mudou(); } },
    { nome: "Cor sólida", icone: "cor", fazer: () => A.novoGrafico("cor") },
    { nome: "Camada de ajuste", icone: "camadas", fazer: () => A.novoGrafico("ajuste") },
    { nome: "Barras de cinema", icone: "tela", fazer: () => { const c = A.novoGrafico("ajuste", { nome: "Barras de cinema" }, { duracao: Math.max(5, A.duracao() - A.cursor) }); c.efeitos.push(V.novoEfeito("barras-cinema")); A.mudou(); } },
    { nome: "Vinheta", icone: "efeito", fazer: () => { const c = A.novoGrafico("ajuste", { nome: "Vinheta" }, { duracao: Math.max(5, A.duracao() - A.cursor) }); const fx = V.novoEfeito("cor"); fx.params.vinheta = -45; c.efeitos.push(fx); A.mudou(); } },
  ];
  function desenharGraficos(caixa) {
    const c = A.escolhidos().find((x) => ["texto", "forma", "cor"].includes(x.tipo));
    if (!mudouAssinatura("graficos", [c && c.id, c && c.tipo, c && c.forma && !!c.forma.gradiente])) return;
    const modelos = el("div", { class: "modelos" }, ...MODELOS.map((m) => el("button", { type: "button", title: "Pôr no cursor, na trilha de vídeo livre mais alta", onclick: () => { m.fazer(); V.Paineis.abrirAba("dir", "graficos"); } }, el("span", { html: icone(m.icone) }), m.nome)));
    const editar = el("div", { class: "props-painel" });
    if (c) editar.append(...V.Controles.editorGrafico(c));
    else editar.append(el("p", { class: "fraco" }, "Escolha um título, uma forma ou uma cor sólida na linha do tempo para editar aqui."));
    caixa.replaceChildren(el("div", { class: "barra-painel" }, el("b", {}, "Modelos")), modelos, el("div", { class: "barra-painel" }, el("b", {}, "Editar")), editar);
  }

  // ── Texto: legendas ─────────────────────────────────────────────────

  const legendas = () => A.projeto.clipes.filter((c) => c.legenda).sort((a, b) => a.inicio - b.inicio);
  function trilhaDeLegendas() {
    const p = A.projeto;
    let t = p.trilhas.find((x) => x.legendas);
    if (!t) { t = { id: "C1", tipo: "video", nome: "Legendas", alvo: false, legendas: true }; while (A.trilha(t.id)) t.id = "C" + Math.floor(Math.random() * 900 + 100); p.trilhas.unshift(t); }
    return t;
  }
  const estiloLegenda = (conteudo) => ({ conteudo, fonte: "system-ui, sans-serif", tamanho: 5.2, cor: "#ffffff", negrito: false, italico: false, alinhamento: "center", contorno: false, corContorno: "#000000", espessuraContorno: 8, sombra: true, fundo: { ligado: true, cor: "#000000", opacidade: 0.55 }, posicao: "baixo", animacao: "nenhuma", entrelinha: 1.2 });
  function criarLegenda(inicio, duracao, conteudo) {
    const t = trilhaDeLegendas();
    const c = A.clipeBase({ trilha: t.id, tipo: "texto", legenda: true, inicio, duracao, nome: "Legenda", texto: estiloLegenda(conteudo), rotulo: "amarelo" });
    A.projeto.clipes.push(c);
    return c;
  }
  P.novaLegenda = function () {
    A.marcar("Nova legenda");
    let t = A.arredondar(A.cursor);
    const lista = legendas();
    const em = lista.find((c) => t >= c.inicio && t < V.fim(c));
    if (em) t = V.fim(em);
    const prox = lista.find((c) => c.inicio > t);
    const dur = Math.max(A.quadro(), Math.min(3, prox ? prox.inicio - t : 3));
    const c = criarLegenda(t, dur, "Nova legenda");
    A.selecao = new Set([c.id]);
    A.mudou();
    P.abrirAba("dir", "texto");
    setTimeout(() => { const area = $(`#aba-texto [data-legenda="${c.id}"] textarea`); if (area) { area.focus(); area.select(); } }, 30);
  };
  function desenharTexto(caixa, leve) {
    const lista = legendas();
    const atual = lista.find((c) => A.cursor >= c.inicio && A.cursor < V.fim(c));
    const sig = [lista.map((c) => [c.id, c.inicio, c.duracao, c.texto.conteudo]), buscaLegenda];
    if (!mudouAssinatura("texto", sig)) { for (const x of $$(".texto-item", caixa)) x.style.background = atual && x.dataset.legenda === atual.id ? "var(--destaque-suave)" : ""; return; }
    const busca = el("input", { class: "lnux-entrada", type: "search", placeholder: "Procurar nas legendas...", value: buscaLegenda, style: { minHeight: "26px" } });
    busca.addEventListener("input", () => { buscaLegenda = busca.value; desenharTexto(caixa); const b = caixa.querySelector("input[type=search]"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    const q = semAcento(buscaLegenda.trim());
    const itens = lista.filter((c) => !q || semAcento(c.texto.conteudo).includes(q)).map((c) => {
      const area = el("textarea", { class: "lnux-entrada", rows: 2, "aria-label": "Texto da legenda" });
      area.value = c.texto.conteudo;
      let marcou = false;
      area.addEventListener("focus", () => { marcou = false; A.selecao = new Set([c.id]); if (A.cursor < c.inicio || A.cursor >= V.fim(c)) A.irPara(c.inicio); });
      area.addEventListener("input", () => { if (!marcou) { A.marcar("Texto da legenda"); marcou = true; } const x = A.clipe(c.id); if (x) x.texto.conteudo = area.value; assinaturas.texto = JSON.stringify([legendas().map((k) => [k.id, k.inicio, k.duracao, k.texto.conteudo]), buscaLegenda]); A.mudou({ leve: true }); });
      area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); A.irPara(V.fim(c)); P.novaLegenda(); } });
      return el("div", { class: "texto-item", "data-legenda": c.id, style: atual === c ? { background: "var(--destaque-suave)" } : {} },
        el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
          el("span", { class: "tc mono", title: "Ir para a legenda", onclick: () => { A.selecao = new Set([c.id]); A.irPara(c.inicio); } }, `${A.tempo(c.inicio)} → ${A.tempo(V.fim(c))}`),
          el("span", { class: "espaco", style: { flex: 1 } }),
          el("button", { type: "button", class: "lnux-botao pequeno plano", title: "Fim da legenda no cursor", onclick: () => { const x = A.clipe(c.id); if (!x || A.cursor <= x.inicio) return; A.marcar("Fim da legenda"); x.duracao = A.arredondar(A.cursor - x.inicio); A.mudou(); } }, "⇥"),
          el("button", { type: "button", class: "lnux-botao pequeno plano", title: "Apagar a legenda", onclick: () => { A.marcar("Apagar legenda"); V.removerClipe(A.projeto, c.id); A.mudou(); } }, "×")),
        area);
    });
    caixa.replaceChildren(
      el("div", { class: "barra-painel" },
        el("button", { type: "button", class: "lnux-botao pequeno", title: "Nova legenda no cursor (Ctrl+Enter dentro de uma legenda cria a próxima)", onclick: () => P.novaLegenda() }, "+ Legenda"),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => P.importarLegendas() }, "Importar"),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); LNUX.abrirMenu([{ rotulo: "SRT (SubRip)", acao: () => P.exportarLegendas("srt") }, { rotulo: "VTT (WebVTT)", acao: () => P.exportarLegendas("vtt") }], r.left, r.bottom + 2); } }, "Exportar"),
        el("button", { type: "button", class: "lnux-botao pequeno", title: "Muda o estilo de todas as legendas para o da legenda escolhida", onclick: () => {
          const modelo = A.escolhidos().find((c) => c.legenda);
          if (!modelo) { LNUX.aviso("Escolha uma legenda na linha do tempo (com o estilo que quer) e ajuste em Propriedades."); return; }
          A.marcar("Estilo das legendas");
          for (const c of legendas()) if (c !== modelo) { const conteudo = c.texto.conteudo; c.texto = JSON.parse(JSON.stringify(modelo.texto)); c.texto.conteudo = conteudo; c.mov = JSON.parse(JSON.stringify(modelo.mov)); }
          A.mudou();
        } }, "Copiar estilo para todas"),
        busca),
      el("div", { class: "lista-simples" }, ...(itens.length ? itens : [el("div", { class: "fraco", style: { cursor: "default", display: "block" } }, lista.length ? "Nenhuma legenda com esse texto." : "Sem legendas. Use + Legenda (no cursor) ou importe um arquivo .srt ou .vtt.")])));
  }
  let buscaLegenda = "";
  function lerTempoLegenda(s) {
    const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0") / 1000;
  }
  P.lerLegendas = function (texto) {
    const blocos = texto.replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
    const saida = [];
    for (const b of blocos) {
      const linhas = b.split("\n").filter((l) => l.trim() !== "");
      const i = linhas.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const [a, z] = linhas[i].split("-->").map((x) => x.trim().split(/\s+/)[0]);
      const de = lerTempoLegenda(a), ate = lerTempoLegenda(z);
      if (de === null || ate === null || ate <= de) continue;
      const conteudo = linhas.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
      if (conteudo) saida.push({ de, ate, conteudo });
    }
    return saida;
  };
  P.importarLegendas = async function () {
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Importar legendas", aceitar: ".srt,.vtt,text/vtt,text/plain" });
    if (!arq) return;
    const lista = P.lerLegendas(await arq.texto());
    if (!lista.length) { LNUX.aviso("Não achei legendas nesse arquivo (formatos: SRT e WebVTT).", "alerta"); return; }
    A.marcar("Importar legendas");
    for (const l of lista) criarLegenda(A.arredondar(l.de), Math.max(A.quadro(), A.arredondar(l.ate - l.de)), l.conteudo);
    A.mudou();
    P.abrirAba("dir", "texto");
    LNUX.aviso(`${lista.length} legenda(s) importada(s).`, "ok");
  };
  P.textoLegendas = function (formato) {
    const tc = (t) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000; const d = (n, k = 2) => String(n).padStart(k, "0"); return `${d(h)}:${d(m)}:${d(s)}${formato === "srt" ? "," : "."}${d(r, 3)}`; };
    const lista = legendas();
    if (formato === "vtt") return "WEBVTT\n\n" + lista.map((c) => `${tc(c.inicio)} --> ${tc(V.fim(c))}\n${c.texto.conteudo}`).join("\n\n") + "\n";
    return lista.map((c, i) => `${i + 1}\n${tc(c.inicio)} --> ${tc(V.fim(c))}\n${c.texto.conteudo}`).join("\n\n") + "\n";
  };
  P.exportarLegendas = function (formato) {
    if (!legendas().length) { LNUX.aviso("Não há legendas para exportar."); return; }
    LNUX.arquivos.salvar(new Blob([P.textoLegendas(formato)], { type: formato === "vtt" ? "text/vtt" : "text/plain" }), (A.projeto.nome || "legendas") + "." + formato, { titulo: "Exportar legendas" });
  };

  // ── Começo ──────────────────────────────────────────────────────────

  const DESENHAR = {
    origem: () => {}, controles: () => V.Controles.desenhar(), propriedades: () => V.Controles.desenhar(), cor: () => V.Controles.desenhar(), escopos: () => V.Controles.redesenharEscopos(),
    mixer: desenharMixer, metadados: desenharMetadados, projeto: desenharProjeto, navegador: desenharNavegador, efeitos: desenharEfeitos,
    marcadores: desenharMarcadores, info: desenharInfo, historico: desenharHistorico, graficos: desenharGraficos, texto: desenharTexto,
  };

  P.iniciar = function () {
    A = V.app;
    montarOrigem();
    for (const caixa of $$(".lnux-painel[data-painel]")) {
      const painel = caixa.dataset.painel;
      for (const b of $$(".lnux-abas button[data-aba]", caixa)) b.addEventListener("click", () => P.abrirAba(painel, b.dataset.aba));
      const primeira = $(".lnux-abas button[data-aba]", caixa).dataset.aba;
      const salva = LNUX.preferencia.ler("lnux.video.aba." + painel, primeira);
      P.abrirAba(painel, $(`.lnux-abas button[data-aba="${salva}"]`, caixa) ? salva : primeira);
    }
    // qual monitor responde a I, O, Espaço, J/K/L: o último em que se mexeu (Origem ou programa/linha do tempo)
    A.monitorAtivo = "programa";
    document.addEventListener("pointerdown", (e) => {
      if (e.target.closest("#aba-origem")) A.monitorAtivo = "origem";
      else if (e.target.closest("#programa, #linha-do-tempo, #ferramentas")) A.monitorAtivo = "programa";
    }, true);
    A.hist.aoMudar = () => { if (abaAberta("historico")) desenharHistorico($("#aba-historico")); };
    document.addEventListener("lnux:ponte", () => { if (abaAberta("navegador")) desenharNavegador($("#aba-navegador")); });
  };
})();
