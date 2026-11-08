/*
 * Som — estúdio de áudio multipistas (interface).
 *
 * O projeto é um objeto simples (salvo em JSON): trilhas, clipes e os dados de cada áudio. Os áudios em si
 * (Blob original + AudioBuffer decodificado) ficam fora do JSON, num mapa por id. Tudo é guardado no
 * navegador (IndexedDB) a cada mudança, então fechar a aba não perde nada; "Salvar projeto" gera um
 * .lnuxsom (um ZIP com o projeto.json e os áudios), que dá para abrir em outro aparelho.
 */
(function () {
  "use strict";

  const { el, icone, $, limitar } = LNUX;
  const { Motor, paraWav, duracaoDoProjeto } = SomMotor;
  const motor = new Motor();

  const CORES = ["#5b9dff", "#4fd18b", "#f5a524", "#e5577a", "#a879f2", "#3cc6d0", "#d6c14a", "#ef7f45"];
  const ALTURA_CABECA_CLIPE = 15;

  // ── Estado ──────────────────────────────────────────────────────────

  function novaTrilha(i, nome) {
    return {
      id: LNUX.id("t"), nome: nome || `Trilha ${i + 1}`, cor: CORES[i % CORES.length], volume: 0, pan: 0,
      mudo: false, solo: false, armada: false,
      efeitos: {
        eq: { ligado: false, graves: 0, medios: 0, agudos: 0 },
        compressor: { ligado: false, limiar: -18, razao: 4 },
        eco: { ligado: false, tempo: 0.3, retorno: 0.35, mistura: 0.25 },
        reverb: { ligado: false, tamanho: 2, mistura: 0.25 },
      },
    };
  }
  function novoProjeto() {
    const t = novaTrilha(0);
    t.armada = true;
    return { versao: 1, nome: "Projeto sem nome", bpm: 120, compasso: 4, grade: "1", volumeMestre: 0, latencia: 0,
      loop: { inicio: 0, fim: 0 }, trilhas: [t, novaTrilha(1)], clipes: [], audios: {} };
  }

  let projeto = novoProjeto();
  const audios = new Map(); // id → {blob}: o arquivo original de cada áudio
  const guardados = new Set(); // ids de áudio já guardados no navegador
  let selecao = new Set();
  let trilhaEscolhida = projeto.trilhas[0].id;
  let cursor = 0;
  let inicioDoPlay = 0;
  let pxs = 60; // pixels por segundo
  let ferramenta = "selecionar";
  let ima = true;
  let loopLigado = false;
  let caminhoProjeto = null; // onde o projeto foi salvo pela ponte (Ctrl+S salva por cima)
  let area_transferencia = [];
  let gravacao = null;

  const hist = new LNUX.Historico(() => projeto, (estado) => {
    projeto = estado;
    selecao = new Set([...selecao].filter((id) => projeto.clipes.some((c) => c.id === id)));
    if (!projeto.trilhas.some((t) => t.id === trilhaEscolhida)) trilhaEscolhida = projeto.trilhas[0] && projeto.trilhas[0].id;
    mudou({ estrutura: true });
  });

  const trilhaPorId = (id) => projeto.trilhas.find((t) => t.id === id);
  const clipePorId = (id) => projeto.clipes.find((c) => c.id === id);
  const indiceDaTrilha = (id) => projeto.trilhas.findIndex((t) => t.id === id);
  const duracaoAudio = (id) => (motor.buffers.get(id) ? motor.buffers.get(id).duration : (projeto.audios[id] || {}).duracao || 0);
  const alturaTrilha = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--altura-trilha")) || 86;

  // ── Grade (encaixe no tempo) ────────────────────────────────────────

  function passoGrade() {
    const g = projeto.grade, batida = 60 / projeto.bpm;
    if (g === "0") return 0;
    if (g === "compasso") return batida * projeto.compasso;
    if (g === "seg") return 1;
    return batida * parseFloat(g);
  }
  function encaixar(t, { ignorar = null } = {}) {
    let melhor = t, distancia = Infinity;
    const tolerancia = 8 / pxs;
    if (ima) {
      const pontos = [cursor, 0];
      for (const c of projeto.clipes) if (!ignorar || !ignorar.has(c.id)) pontos.push(c.inicio, c.inicio + c.duracao);
      for (const p of pontos) { const d = Math.abs(p - t); if (d < tolerancia && d < distancia) { melhor = p; distancia = d; } }
      if (distancia < Infinity) return melhor;
    }
    const passo = passoGrade();
    return passo ? Math.round(t / passo) * passo : t;
  }

  // ── Elementos ───────────────────────────────────────────────────────

  const regua = $("#regua"), pistas = $("#pistas"), rolagem = $("#rolagem"), espaco = $("#espaco"), cabecalhos = $("#cabecalhos");
  const corpoProps = $("#corpo-propriedades"), canais = $("#canais");
  $("#marca-icone").innerHTML = icone("onda");
  $("#dica-icone").innerHTML = icone("microfone");
  $("#importar-icone").innerHTML = icone("importar");

  // Transporte
  const botoes = {};
  const transporte = $("#botoes-transporte");
  for (const [id, ic, dica, acao] of [
    ["inicio", "inicio", "Ir para o início (Home)", () => irPara(0)],
    ["tocar", "play", "Tocar / pausar (Espaço)", () => alternarPlay()],
    ["parar", "parar", "Parar e voltar (Enter)", () => parar(true)],
    ["gravar", "gravar", "Gravar (R)", () => alternarGravacao()],
    ["loop", "repetir", "Repetir a região marcada (L)", () => alternarLoop()],
    ["metronomo", "metronomo", "Metrônomo (M)", () => alternarMetronomo()],
  ]) {
    const b = LNUX.botaoIcone(ic, dica, acao);
    b.id = "botao-" + id;
    botoes[id] = b;
    transporte.append(b);
  }
  botoes.gravar.style.color = "var(--perigo)";
  const grupoGrade = $("#botoes-grade");
  botoes.ima = LNUX.botaoIcone("ima", "Ímã: encaixar nas bordas dos clipes e no cursor", () => { ima = !ima; atualizarBotoes(); });
  botoes.cortar = LNUX.botaoIcone("cortar", "Ferramenta de corte (C): clique num clipe para cortar ali", () => { ferramenta = ferramenta === "cortar" ? "selecionar" : "cortar"; atualizarBotoes(); });
  grupoGrade.append(botoes.ima, botoes.cortar);
  const grupoZoom = $("#botoes-zoom");
  grupoZoom.append(
    LNUX.botaoIcone("zoom-menos", "Afastar (-)", () => zoom(1 / 1.5)),
    LNUX.botaoIcone("zoom-mais", "Aproximar (+)", () => zoom(1.5)),
    LNUX.botaoIcone("layout", "Ver o projeto todo (0)", () => verTudo()));

  function atualizarBotoes() {
    botoes.tocar.innerHTML = icone(motor.tocando && !gravacao ? "pausa" : "play");
    botoes.gravar.classList.toggle("gravando", !!gravacao);
    botoes.loop.setAttribute("aria-pressed", String(loopLigado));
    botoes.metronomo.setAttribute("aria-pressed", String(motor.metronomoLigado));
    botoes.ima.setAttribute("aria-pressed", String(ima));
    botoes.cortar.setAttribute("aria-pressed", String(ferramenta === "cortar"));
    pistas.style.cursor = ferramenta === "cortar" ? "crosshair" : "default";
  }

  const campoBpm = $("#bpm"), campoCompasso = $("#compasso"), campoGrade = $("#grade");
  campoBpm.addEventListener("change", () => { hist.marcar("Mudar o BPM"); projeto.bpm = limitar(Math.round(+campoBpm.value || 120), 30, 300); mudou(); });
  campoCompasso.addEventListener("change", () => { hist.marcar("Mudar o compasso"); projeto.compasso = +campoCompasso.value; mudou(); });
  campoGrade.addEventListener("change", () => { projeto.grade = campoGrade.value; mudou(); });

  // ── Desenho da linha do tempo (canvas) ──────────────────────────────

  function prepararCanvas(c, largura, altura) {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(largura * dpr) || c.height !== Math.round(altura * dpr)) {
      c.width = Math.round(largura * dpr);
      c.height = Math.round(altura * dpr);
      c.style.width = largura + "px";
      c.style.height = altura + "px";
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function atualizarEspaco() {
    const fim = Math.max(duracaoDoProjeto(projeto) + 30, (rolagem.clientWidth / pxs) * 1.2, 60);
    espaco.style.width = Math.ceil(fim * pxs) + "px";
    espaco.style.height = projeto.trilhas.length * alturaTrilha() + 40 + "px";
    $("#dica-vazia").hidden = projeto.clipes.length > 0;
  }

  const cor = (v) => LNUX.tema.cor(v);

  function linhasDaGrade(ctx, x0, largura, altura, t0, t1) {
    const batida = 60 / projeto.bpm, compasso = batida * projeto.compasso;
    const porBatidas = projeto.grade !== "seg";
    ctx.lineWidth = 1;
    if (porBatidas) {
      const mostrarBatidas = batida * pxs > 14;
      const passo = mostrarBatidas ? batida : compasso * Math.max(1, Math.ceil(28 / (compasso * pxs)));
      for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) {
        const x = Math.round(t * pxs - x0) + 0.5;
        const eCompasso = Math.abs(t / compasso - Math.round(t / compasso)) < 1e-6;
        ctx.strokeStyle = eCompasso ? cor("--borda-forte") : cor("--borda");
        ctx.globalAlpha = eCompasso ? 0.9 : 0.45;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, altura); ctx.stroke();
      }
    } else {
      const passo = escolherPasso();
      for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) {
        const x = Math.round(t * pxs - x0) + 0.5;
        ctx.strokeStyle = cor("--borda");
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, altura); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function escolherPasso() {
    for (const p of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (p * pxs >= 70) return p;
    return 600;
  }

  function desenharRegua() {
    const largura = regua.clientWidth, altura = regua.clientHeight;
    if (!largura) return;
    const ctx = prepararCanvas(regua, largura, altura);
    const x0 = rolagem.scrollLeft, t0 = x0 / pxs, t1 = (x0 + largura) / pxs;
    ctx.fillStyle = cor("--painel");
    ctx.fillRect(0, 0, largura, altura);
    // região do loop
    if (projeto.loop.fim > projeto.loop.inicio) {
      ctx.fillStyle = loopLigado ? cor("--destaque") : cor("--borda-forte");
      ctx.globalAlpha = loopLigado ? 0.35 : 0.3;
      ctx.fillRect(projeto.loop.inicio * pxs - x0, altura - 9, (projeto.loop.fim - projeto.loop.inicio) * pxs, 9);
      ctx.globalAlpha = 1;
    }
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = cor("--texto-2");
    ctx.strokeStyle = cor("--borda-forte");
    ctx.textBaseline = "top";
    const batida = 60 / projeto.bpm, compasso = batida * projeto.compasso;
    if (projeto.grade !== "seg") {
      const pulo = Math.max(1, Math.ceil(36 / (compasso * pxs)));
      for (let n = Math.floor(t0 / compasso); n * compasso <= t1; n++) {
        const x = Math.round(n * compasso * pxs - x0) + 0.5;
        if (n % pulo === 0) {
          ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, altura); ctx.stroke();
          ctx.fillText(String(n + 1), x + 3, 3);
        }
        if (batida * pxs > 12) {
          for (let b = 1; b < projeto.compasso; b++) {
            const xb = Math.round((n * compasso + b * batida) * pxs - x0) + 0.5;
            ctx.beginPath(); ctx.moveTo(xb, altura - 7); ctx.lineTo(xb, altura); ctx.stroke();
          }
        }
      }
    } else {
      const passo = escolherPasso();
      for (let t = Math.floor(t0 / passo) * passo; t <= t1; t += passo) {
        const x = Math.round(t * pxs - x0) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, altura); ctx.stroke();
        ctx.fillText(LNUX.tempo(t).replace(/\.00$/, ""), x + 3, 3);
      }
    }
    // cursor
    const xc = cursor * pxs - x0;
    ctx.fillStyle = cor("--cabecote");
    ctx.beginPath(); ctx.moveTo(xc - 6, 0); ctx.lineTo(xc + 6, 0); ctx.lineTo(xc, 9); ctx.fill();
    ctx.strokeStyle = cor("--borda");
    ctx.beginPath(); ctx.moveTo(0, altura - 0.5); ctx.lineTo(largura, altura - 0.5); ctx.stroke();
  }

  function retanguloDoClipe(c, x0, y0, H) {
    const i = indiceDaTrilha(c.trilha);
    return { x: c.inicio * pxs - x0, y: i * H - y0 + 3, w: Math.max(2, c.duracao * pxs), h: H - 6 };
  }

  function desenharPistas() {
    const largura = rolagem.clientWidth, altura = rolagem.clientHeight;
    if (!largura || !altura) return;
    const ctx = prepararCanvas(pistas, largura, altura);
    const x0 = rolagem.scrollLeft, y0 = rolagem.scrollTop, H = alturaTrilha();
    const t0 = x0 / pxs, t1 = (x0 + largura) / pxs;
    ctx.fillStyle = cor("--trilha");
    ctx.fillRect(0, 0, largura, altura);
    projeto.trilhas.forEach((t, i) => {
      const y = i * H - y0;
      if (y > altura || y + H < 0) return;
      ctx.fillStyle = t.id === trilhaEscolhida ? cor("--destaque-suave") : (i % 2 ? cor("--trilha-alt") : cor("--trilha"));
      ctx.fillRect(0, y, largura, H);
      ctx.fillStyle = cor("--borda");
      ctx.fillRect(0, y + H - 1, largura, 1);
    });
    linhasDaGrade(ctx, x0, largura, Math.min(altura, projeto.trilhas.length * H - y0), t0, t1);
    if (projeto.loop.fim > projeto.loop.inicio) {
      ctx.fillStyle = cor("--destaque");
      ctx.globalAlpha = loopLigado ? 0.08 : 0.04;
      ctx.fillRect(projeto.loop.inicio * pxs - x0, 0, (projeto.loop.fim - projeto.loop.inicio) * pxs, altura);
      ctx.globalAlpha = 1;
    }
    for (const c of projeto.clipes) {
      if (c.inicio > t1 || c.inicio + c.duracao < t0) continue;
      desenharClipe(ctx, c, retanguloDoClipe(c, x0, y0, H), largura);
    }
    // gravação em andamento
    if (gravacao) {
      const i = indiceDaTrilha(gravacao.trilha);
      const agora = motor.tempo() ?? gravacao.inicio;
      ctx.fillStyle = cor("--perigo");
      ctx.globalAlpha = 0.45;
      ctx.fillRect(gravacao.inicio * pxs - x0, i * H - y0 + 3, Math.max(2, (agora - gravacao.inicio) * pxs), H - 6);
      ctx.globalAlpha = 1;
    }
    // cursor e cabeça de reprodução
    const xc = Math.round(cursor * pxs - x0) + 0.5;
    ctx.strokeStyle = cor("--cabecote");
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, altura); ctx.stroke();
  }

  function desenharClipe(ctx, c, r, largura) {
    const t = trilhaPorId(c.trilha);
    const corTrilha = t ? t.cor : CORES[0];
    const escolhido = selecao.has(c.id);
    const faltando = !motor.buffers.get(c.audio);
    ctx.save();
    // recorta o que sai da tela (clipes enormes)
    const xi = Math.max(r.x, -4), xf = Math.min(r.x + r.w, largura + 4);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(r.x, r.y, r.w, r.h, 5) : ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = corTrilha;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(xi, r.y, xf - xi, r.h);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(xi, r.y, xf - xi, ALTURA_CABECA_CLIPE);
    ctx.globalAlpha = 1;
    // forma de onda
    const picos = motor.picos.get(c.audio);
    const meio = r.y + ALTURA_CABECA_CLIPE + (r.h - ALTURA_CABECA_CLIPE) / 2, amp = (r.h - ALTURA_CABECA_CLIPE) / 2 - 2;
    if (picos && amp > 2) {
      ctx.fillStyle = corTrilha;
      const durBuffer = duracaoAudio(c.audio);
      for (let x = Math.floor(xi); x < xf; x++) {
        const tLocal = (x - r.x) / pxs, tLocal2 = (x + 1 - r.x) / pxs;
        let a = c.entrada + tLocal, b = c.entrada + tLocal2;
        if (c.reverso) { const a2 = durBuffer - b, b2 = durBuffer - a; a = a2; b = b2; }
        const i0 = Math.max(0, Math.floor(a * picos.taxa)), i1 = Math.min(picos.max.length, Math.ceil(b * picos.taxa));
        let mi = 0, ma = 0;
        for (let i = i0; i < i1; i++) { if (picos.min[i] < mi) mi = picos.min[i]; if (picos.max[i] > ma) ma = picos.max[i]; }
        const g = SomMotor.ganhoDoClipe(c, c.inicio + tLocal);
        ctx.fillRect(x, meio - ma * amp * g, 1, Math.max(1, (ma - mi) * amp * g));
      }
    } else if (faltando) {
      ctx.fillStyle = cor("--texto-3");
      ctx.font = "11px sans-serif";
      ctx.fillText("áudio faltando", Math.max(r.x, 0) + 6, meio + 4);
    }
    // fades
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 1.2;
    if (c.fadeIn > 0) { ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + c.fadeIn * pxs, r.y + ALTURA_CABECA_CLIPE); ctx.stroke(); }
    if (c.fadeOut > 0) { ctx.beginPath(); ctx.moveTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x + r.w - c.fadeOut * pxs, r.y + ALTURA_CABECA_CLIPE); ctx.stroke(); }
    // alças dos fades (quadradinhos nos cantos de cima)
    ctx.fillStyle = "#fff";
    ctx.fillRect(r.x + c.fadeIn * pxs - 3, r.y + ALTURA_CABECA_CLIPE - 3, 6, 6);
    ctx.fillRect(r.x + r.w - c.fadeOut * pxs - 3, r.y + ALTURA_CABECA_CLIPE - 3, 6, 6);
    // nome
    ctx.fillStyle = "#fff";
    ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = "middle";
    const rotulo = (c.reverso ? "⟲ " : "") + (c.nome || "clipe") + (c.ganho ? ` (${c.ganho > 0 ? "+" : ""}${c.ganho.toFixed(1)} dB)` : "");
    ctx.fillText(rotulo, Math.max(r.x, 0) + 5, r.y + ALTURA_CABECA_CLIPE / 2 + 0.5, Math.max(0, xf - Math.max(r.x, 0) - 10));
    ctx.restore();
    if (escolhido) {
      ctx.strokeStyle = cor("--texto");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5) : ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.stroke();
    }
  }

  let pedidoDesenho = 0;
  function redesenhar() {
    if (pedidoDesenho) return;
    pedidoDesenho = requestAnimationFrame(() => { pedidoDesenho = 0; desenharRegua(); desenharPistas(); });
  }

  rolagem.addEventListener("scroll", () => { cabecalhos.scrollTop = rolagem.scrollTop; redesenhar(); });
  new ResizeObserver(() => { atualizarEspaco(); redesenhar(); }).observe(rolagem);
  document.addEventListener("lnux:tema", redesenhar);
  document.addEventListener("lnux:layout", () => setTimeout(() => { atualizarEspaco(); desenharCabecalhos(); redesenhar(); }, 30));

  // ── Interação com os clipes ─────────────────────────────────────────

  function pontoNoCanvas(e) {
    const r = pistas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, t: (x + rolagem.scrollLeft) / pxs, trilha: Math.floor((y + rolagem.scrollTop) / alturaTrilha()) };
  }

  function acharClipe(p) {
    const H = alturaTrilha(), x0 = rolagem.scrollLeft, y0 = rolagem.scrollTop;
    for (let i = projeto.clipes.length - 1; i >= 0; i--) {
      const c = projeto.clipes[i];
      const r = retanguloDoClipe(c, x0, y0, H);
      if (p.x >= r.x - 4 && p.x <= r.x + r.w + 4 && p.y >= r.y && p.y <= r.y + r.h) {
        let zona = "mover";
        const borda = Math.min(8, r.w / 4);
        const xFadeIn = r.x + c.fadeIn * pxs, xFadeOut = r.x + r.w - c.fadeOut * pxs;
        if (p.y < r.y + ALTURA_CABECA_CLIPE + 4 && Math.abs(p.x - xFadeIn) < 7) zona = "fade-in";
        else if (p.y < r.y + ALTURA_CABECA_CLIPE + 4 && Math.abs(p.x - xFadeOut) < 7) zona = "fade-out";
        else if (p.x < r.x + borda) zona = "aparar-inicio";
        else if (p.x > r.x + r.w - borda) zona = "aparar-fim";
        return { clipe: c, zona };
      }
    }
    return null;
  }

  pistas.addEventListener("pointermove", (e) => {
    if (arrasto) return;
    if (ferramenta === "cortar") return;
    const achado = acharClipe(pontoNoCanvas(e));
    pistas.style.cursor = !achado ? "default" : ({ "aparar-inicio": "ew-resize", "aparar-fim": "ew-resize", "fade-in": "nesw-resize", "fade-out": "nwse-resize", mover: "grab" })[achado.zona];
  });

  let arrasto = null;
  pistas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    rolagem.focus({ preventScroll: true });
    const p = pontoNoCanvas(e);
    const achado = acharClipe(p);
    const trilha = projeto.trilhas[p.trilha];
    if (trilha) trilhaEscolhida = trilha.id;
    if (achado && (ferramenta === "cortar" || e.altKey)) {
      cortarClipe(achado.clipe, encaixar(p.t));
      return;
    }
    if (!achado) {
      if (!e.shiftKey) selecao.clear();
      if (e.pointerType === "touch") {
        arrasto = { tipo: "rolar", x: e.clientX, y: e.clientY, sl: rolagem.scrollLeft, st: rolagem.scrollTop, moveu: false, t: p.t };
      } else {
        irPara(encaixar(Math.max(0, p.t)));
        arrasto = { tipo: "cursor" };
      }
      pistas.setPointerCapture(e.pointerId);
      desenharCabecalhos();
      desenharPropriedades();
      redesenhar();
      return;
    }
    const c = achado.clipe;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { selecao.has(c.id) ? selecao.delete(c.id) : selecao.add(c.id); }
    else if (!selecao.has(c.id)) { selecao.clear(); selecao.add(c.id); }
    arrasto = {
      tipo: achado.zona, clipe: c.id, x: e.clientX, t: p.t, trilhaInicial: p.trilha, marcado: false,
      originais: new Map([...selecao].map((id) => { const x = clipePorId(id); return [id, { ...x }]; })),
    };
    pistas.setPointerCapture(e.pointerId);
    desenharCabecalhos();
    desenharPropriedades();
    redesenhar();
  });

  pistas.addEventListener("pointermove", (e) => {
    if (!arrasto) return;
    const p = pontoNoCanvas(e);
    if (arrasto.tipo === "rolar") {
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) arrasto.moveu = true;
      rolagem.scrollLeft = arrasto.sl - dx;
      rolagem.scrollTop = arrasto.st - dy;
      return;
    }
    if (arrasto.tipo === "cursor") { irPara(encaixar(Math.max(0, p.t))); return; }
    if (!arrasto.marcado) {
      if (Math.abs(e.clientX - arrasto.x) < 3 && p.trilha === arrasto.trilhaInicial) return;
      hist.marcar("Editar clipe");
      arrasto.marcado = true;
    }
    const orig = arrasto.originais.get(arrasto.clipe);
    const c = clipePorId(arrasto.clipe);
    const dt = p.t - arrasto.t;
    const durBuffer = duracaoAudio(c.audio) || orig.entrada + orig.duracao;
    if (arrasto.tipo === "mover") {
      const novoInicio = encaixar(Math.max(0, orig.inicio + dt), { ignorar: selecao });
      // também encaixa pelo fim do clipe
      const fimEncaixado = encaixar(orig.inicio + dt + orig.duracao, { ignorar: selecao }) - orig.duracao;
      const escolhido = Math.abs(fimEncaixado - (orig.inicio + dt)) < Math.abs(novoInicio - (orig.inicio + dt)) ? fimEncaixado : novoInicio;
      const delta = Math.max(-Math.min(...[...arrasto.originais.values()].map((o) => o.inicio)), escolhido - orig.inicio);
      const dTrilha = limitar(p.trilha, 0, projeto.trilhas.length - 1) - arrasto.trilhaInicial;
      for (const [id, o] of arrasto.originais) {
        const x = clipePorId(id);
        x.inicio = Math.max(0, o.inicio + delta);
        const it = limitar(indiceDaTrilha(o.trilha) + dTrilha, 0, projeto.trilhas.length - 1);
        x.trilha = projeto.trilhas[it].id;
      }
    } else if (arrasto.tipo === "aparar-inicio") {
      const novo = limitar(encaixar(orig.inicio + dt, { ignorar: new Set([c.id]) }), orig.inicio - orig.entrada, orig.inicio + orig.duracao - 0.02);
      c.entrada = orig.entrada + (novo - orig.inicio);
      c.duracao = orig.duracao - (novo - orig.inicio);
      c.inicio = Math.max(0, novo);
      c.fadeIn = Math.min(c.fadeIn, c.duracao / 2);
    } else if (arrasto.tipo === "aparar-fim") {
      const fim = limitar(encaixar(orig.inicio + orig.duracao + dt, { ignorar: new Set([c.id]) }), orig.inicio + 0.02, orig.inicio + durBuffer - orig.entrada);
      c.duracao = fim - orig.inicio;
      c.fadeOut = Math.min(c.fadeOut, c.duracao / 2);
    } else if (arrasto.tipo === "fade-in") {
      c.fadeIn = limitar(orig.fadeIn + dt, 0, c.duracao - c.fadeOut);
    } else if (arrasto.tipo === "fade-out") {
      c.fadeOut = limitar(orig.fadeOut - dt, 0, c.duracao - c.fadeIn);
    }
    redesenhar();
    desenharPropriedadesLeve();
  });

  const soltar = () => {
    if (!arrasto) return;
    const a = arrasto;
    arrasto = null;
    if (a.tipo === "rolar" && !a.moveu) irPara(encaixar(Math.max(0, a.t)));
    if (a.marcado) mudou();
  };
  pistas.addEventListener("pointerup", soltar);
  pistas.addEventListener("pointercancel", soltar);

  pistas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const achado = acharClipe(pontoNoCanvas(e));
    if (achado && !selecao.has(achado.clipe.id)) { selecao.clear(); selecao.add(achado.clipe.id); redesenhar(); desenharPropriedades(); }
    LNUX.abrirMenu(achado ? [
      { rotulo: "Separar no cursor", atalho: "S", acao: () => separarNoCursor() },
      { rotulo: "Duplicar", atalho: "Ctrl+D", acao: () => duplicar() },
      { rotulo: "Copiar", atalho: "Ctrl+C", acao: () => copiar() },
      "-",
      { rotulo: "Normalizar", acao: () => normalizar() },
      { rotulo: "Tocar ao contrário", acao: () => inverter() },
      { rotulo: "Fades curtos (entrada e saída)", acao: () => fadesCurtos() },
      "-",
      { rotulo: "Apagar", atalho: "Del", acao: () => apagar() },
    ] : [
      { rotulo: "Colar aqui", atalho: "Ctrl+V", ativo: () => area_transferencia.length > 0, acao: () => { irPara(encaixar(pontoNoCanvas(e).t)); colar(); } },
      { rotulo: "Importar áudio aqui...", acao: () => { irPara(encaixar(pontoNoCanvas(e).t)); importar(); } },
    ], e.clientX, e.clientY);
  });

  pistas.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const p = pontoNoCanvas(e);
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.t, p.x);
  }, { passive: false });

  // Régua: clique/arraste move o cursor; com Shift, marca a região do loop; dois cliques tiram o loop
  let arrastoRegua = null;
  regua.addEventListener("pointerdown", (e) => {
    const t = (e.clientX - regua.getBoundingClientRect().left + rolagem.scrollLeft) / pxs;
    regua.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      arrastoRegua = { tipo: "loop", de: encaixar(Math.max(0, t)) };
      projeto.loop = { inicio: arrastoRegua.de, fim: arrastoRegua.de };
    } else {
      arrastoRegua = { tipo: "cursor" };
      irPara(encaixar(Math.max(0, t)));
    }
  });
  regua.addEventListener("pointermove", (e) => {
    if (!arrastoRegua) return;
    const t = encaixar(Math.max(0, (e.clientX - regua.getBoundingClientRect().left + rolagem.scrollLeft) / pxs));
    if (arrastoRegua.tipo === "loop") {
      projeto.loop = { inicio: Math.min(arrastoRegua.de, t), fim: Math.max(arrastoRegua.de, t) };
      loopLigado = projeto.loop.fim > projeto.loop.inicio;
      atualizarBotoes();
      redesenhar();
    } else irPara(t);
  });
  regua.addEventListener("pointerup", () => { if (arrastoRegua && arrastoRegua.tipo === "loop") mudou(); arrastoRegua = null; });
  regua.addEventListener("dblclick", () => { projeto.loop = { inicio: 0, fim: 0 }; loopLigado = false; atualizarBotoes(); mudou(); });

  // ── Edição ──────────────────────────────────────────────────────────

  function escolhidos() { return projeto.clipes.filter((c) => selecao.has(c.id)); }

  function cortarClipe(c, t) {
    if (t <= c.inicio + 0.01 || t >= c.inicio + c.duracao - 0.01) return false;
    hist.marcar("Separar clipe");
    const corte = t - c.inicio;
    const novo = { ...c, id: LNUX.id("c"), inicio: t, duracao: c.duracao - corte, fadeIn: 0 };
    if (c.reverso) novo.entrada = c.entrada; else novo.entrada = c.entrada + corte;
    if (c.reverso) c.entrada = c.entrada + (c.duracao - corte);
    c.duracao = corte;
    c.fadeOut = 0;
    c.fadeIn = Math.min(c.fadeIn, c.duracao);
    novo.fadeOut = Math.min(novo.fadeOut, novo.duracao);
    projeto.clipes.push(novo);
    selecao = new Set([novo.id]);
    mudou();
    return true;
  }

  function separarNoCursor() {
    let alvos = escolhidos();
    if (!alvos.length) alvos = projeto.clipes.filter((c) => c.trilha === trilhaEscolhida);
    alvos = alvos.filter((c) => cursor > c.inicio + 0.01 && cursor < c.inicio + c.duracao - 0.01);
    if (!alvos.length) { LNUX.aviso("Ponha o cursor em cima de um clipe para separar."); return; }
    hist.marcar("Separar no cursor");
    const novos = new Set();
    for (const c of alvos) {
      const corte = cursor - c.inicio;
      const novo = { ...c, id: LNUX.id("c"), inicio: cursor, duracao: c.duracao - corte, fadeIn: 0, entrada: c.reverso ? c.entrada : c.entrada + corte };
      if (c.reverso) c.entrada = c.entrada + (c.duracao - corte);
      c.duracao = corte;
      c.fadeOut = 0;
      projeto.clipes.push(novo);
      novos.add(novo.id);
    }
    selecao = novos;
    mudou();
  }

  function apagar() {
    if (!selecao.size) return;
    hist.marcar("Apagar clipes");
    projeto.clipes = projeto.clipes.filter((c) => !selecao.has(c.id));
    selecao.clear();
    mudou();
  }

  function duplicar() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    hist.marcar("Duplicar");
    const fim = Math.max(...alvos.map((c) => c.inicio + c.duracao)), ini = Math.min(...alvos.map((c) => c.inicio));
    const novos = new Set();
    for (const c of alvos) {
      const n = { ...c, id: LNUX.id("c"), inicio: c.inicio + (fim - ini) };
      projeto.clipes.push(n);
      novos.add(n.id);
    }
    selecao = novos;
    mudou();
  }

  function copiar() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    const ini = Math.min(...alvos.map((c) => c.inicio));
    const base = Math.min(...alvos.map((c) => indiceDaTrilha(c.trilha)));
    area_transferencia = alvos.map((c) => ({ ...c, inicio: c.inicio - ini, deltaTrilha: indiceDaTrilha(c.trilha) - base }));
    LNUX.aviso(`${alvos.length} clipe(s) copiado(s).`);
  }

  function colar() {
    if (!area_transferencia.length) return;
    hist.marcar("Colar");
    const base = Math.max(0, indiceDaTrilha(trilhaEscolhida));
    const novos = new Set();
    for (const c of area_transferencia) {
      const it = Math.min(projeto.trilhas.length - 1, base + c.deltaTrilha);
      const n = { ...c, id: LNUX.id("c"), inicio: cursor + c.inicio, trilha: projeto.trilhas[it].id };
      delete n.deltaTrilha;
      projeto.clipes.push(n);
      novos.add(n.id);
    }
    selecao = novos;
    mudou();
  }

  function normalizar() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    hist.marcar("Normalizar");
    for (const c of alvos) {
      const pico = motor.pico(c.audio);
      if (pico > 0) c.ganho = Math.round((-0.3 - 20 * Math.log10(pico)) * 10) / 10;
    }
    mudou();
    LNUX.aviso("Normalizado: o pico mais alto agora fica em -0,3 dB.", "ok");
  }

  function inverter() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    hist.marcar("Tocar ao contrário");
    for (const c of alvos) {
      const dur = duracaoAudio(c.audio);
      c.entrada = Math.max(0, dur - (c.entrada + c.duracao));
      c.reverso = !c.reverso;
    }
    mudou();
  }

  function fadesCurtos() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    hist.marcar("Fades curtos");
    for (const c of alvos) { c.fadeIn = Math.min(0.05, c.duracao / 3); c.fadeOut = Math.min(0.05, c.duracao / 3); }
    mudou();
  }

  // ── Trilhas ─────────────────────────────────────────────────────────

  function adicionarTrilha(nome) {
    hist.marcar("Nova trilha");
    const t = novaTrilha(projeto.trilhas.length, nome);
    projeto.trilhas.push(t);
    trilhaEscolhida = t.id;
    mudou({ estrutura: true });
    return t;
  }
  function excluirTrilha(id = trilhaEscolhida) {
    if (projeto.trilhas.length <= 1) { LNUX.aviso("O projeto precisa de pelo menos uma trilha."); return; }
    hist.marcar("Excluir trilha");
    projeto.trilhas = projeto.trilhas.filter((t) => t.id !== id);
    projeto.clipes = projeto.clipes.filter((c) => c.trilha !== id);
    trilhaEscolhida = projeto.trilhas[0].id;
    mudou({ estrutura: true });
  }
  function duplicarTrilha(id = trilhaEscolhida) {
    const t = trilhaPorId(id);
    if (!t) return;
    hist.marcar("Duplicar trilha");
    const nova = JSON.parse(JSON.stringify(t));
    nova.id = LNUX.id("t");
    nova.nome = t.nome + " (cópia)";
    nova.armada = false;
    projeto.trilhas.splice(indiceDaTrilha(id) + 1, 0, nova);
    for (const c of projeto.clipes.filter((x) => x.trilha === id)) projeto.clipes.push({ ...c, id: LNUX.id("c"), trilha: nova.id });
    trilhaEscolhida = nova.id;
    mudou({ estrutura: true });
  }
  function moverTrilha(id, direcao) {
    const i = indiceDaTrilha(id), j = i + direcao;
    if (j < 0 || j >= projeto.trilhas.length) return;
    hist.marcar("Mover trilha");
    const [t] = projeto.trilhas.splice(i, 1);
    projeto.trilhas.splice(j, 0, t);
    mudou({ estrutura: true });
  }
  function alternarTrilha(campo, id = trilhaEscolhida) {
    const t = trilhaPorId(id);
    if (!t) return;
    t[campo] = !t[campo];
    if (campo === "armada" && t.armada) for (const x of projeto.trilhas) if (x !== t) x.armada = false;
    mudou();
  }

  function desenharCabecalhos() {
    const H = alturaTrilha();
    cabecalhos.replaceChildren(...projeto.trilhas.map((t) => {
      const nome = el("input", { class: "nome", value: t.nome, "aria-label": "Nome da trilha" });
      nome.addEventListener("change", () => { hist.marcar("Renomear trilha"); t.nome = nome.value.trim() || t.nome; mudou(); });
      const botao = (classe, rotulo, campo, dica) => el("button", {
        class: classe, type: "button", title: dica, "aria-pressed": String(!!t[campo]),
        onclick: (e) => { e.stopPropagation(); alternarTrilha(campo, t.id); },
      }, rotulo);
      const volume = el("input", { type: "range", min: -40, max: 12, step: 0.5, value: t.volume, "aria-label": "Volume da trilha" });
      const valor = el("span", { class: "mono" }, formatarDb(t.volume));
      volume.addEventListener("pointerdown", () => hist.marcar("Volume"));
      volume.addEventListener("input", () => { t.volume = +volume.value; valor.textContent = formatarDb(t.volume); motor.atualizarTrilhas(projeto); desenharMixer(); });
      volume.addEventListener("change", () => mudou());
      const div = el("div", {
        class: "cabecalho-trilha" + (t.id === trilhaEscolhida ? " escolhida" : ""), style: { "--cor-trilha": t.cor, height: H + "px" },
        onpointerdown: () => { if (trilhaEscolhida !== t.id) { trilhaEscolhida = t.id; selecao.clear(); desenharCabecalhos(); desenharPropriedades(); redesenhar(); } },
        oncontextmenu: (e) => {
          e.preventDefault();
          LNUX.abrirMenu([
            { rotulo: "Duplicar trilha", acao: () => duplicarTrilha(t.id) },
            { rotulo: "Mover para cima", ativo: () => indiceDaTrilha(t.id) > 0, acao: () => moverTrilha(t.id, -1) },
            { rotulo: "Mover para baixo", ativo: () => indiceDaTrilha(t.id) < projeto.trilhas.length - 1, acao: () => moverTrilha(t.id, 1) },
            "-",
            { rotulo: "Excluir trilha", acao: () => excluirTrilha(t.id) },
          ], e.clientX, e.clientY);
        },
      },
      nome,
      el("div", { class: "botoes" }, botao("m", "M", "mudo", "Mudo"), botao("s", "S", "solo", "Solo"), botao("r", "R", "armada", "Armar para gravar nesta trilha")),
      el("div", { class: "volume" }, volume, valor));
      return div;
    }));
    cabecalhos.append(el("div", { style: { height: "40px" } }));
    cabecalhos.scrollTop = rolagem.scrollTop;
  }

  const formatarDb = (v) => (v > 0 ? "+" : "") + (Math.round(v * 10) / 10).toString().replace(".", ",") + " dB";

  // ── Painel de propriedades ──────────────────────────────────────────

  function campoNumero(rotulo, valor, { min, max, passo = 0.01, unidade = "", aoMudar, deslizante = true, casas = 2 }) {
    const id = LNUX.id("p");
    const entrada = el("input", { id, class: "lnux-entrada", type: deslizante ? "range" : "number", min, max, step: passo, value: valor });
    const saida = el("output", { for: id }, formatar(valor));
    function formatar(v) { return (Math.round(v * Math.pow(10, casas)) / Math.pow(10, casas)).toString().replace(".", ",") + unidade; }
    let marcado = false;
    entrada.addEventListener("input", () => {
      if (!marcado) { hist.marcar(rotulo); marcado = true; }
      const v = limitar(+entrada.value, min, max);
      saida.textContent = formatar(v);
      aoMudar(v, false);
    });
    entrada.addEventListener("change", () => { marcado = false; aoMudar(limitar(+entrada.value, min, max), true); });
    return el("div", { class: "lnux-prop" }, el("label", { for: id }, rotulo), entrada, saida);
  }

  function alternador(rotulo, valor, aoMudar) {
    const caixa = el("input", { type: "checkbox", checked: valor });
    caixa.addEventListener("change", () => { hist.marcar(rotulo); aoMudar(caixa.checked); });
    return el("label", { class: "lnux-alternar" }, caixa, rotulo);
  }

  function secao(titulo, ...conteudo) { return el("div", { class: "lnux-secao" }, el("h3", {}, titulo), ...conteudo); }

  function desenharPropriedades() {
    const lista = escolhidos();
    const titulo = $("#titulo-propriedades");
    corpoProps.replaceChildren();
    if (lista.length === 1) {
      const c = lista[0];
      titulo.textContent = "Clipe";
      const nome = el("input", { class: "lnux-entrada", value: c.nome || "" });
      nome.addEventListener("change", () => { hist.marcar("Renomear clipe"); c.nome = nome.value; mudou(); });
      const dur = duracaoAudio(c.audio);
      corpoProps.append(
        secao("Clipe", el("label", { class: "lnux-campo" }, el("span", {}, "Nome"), nome),
          el("p", { class: "fraco", style: { margin: "8px 0 0" } }, `Começa em ${LNUX.tempo(c.inicio)} · dura ${LNUX.tempo(c.duracao)}` + (dur ? ` · áudio de ${LNUX.tempo(dur)}` : ""))),
        secao("Volume e fades",
          campoNumero("Ganho", c.ganho || 0, { min: -30, max: 18, passo: 0.1, unidade: " dB", casas: 1, aoMudar: (v, fim) => { c.ganho = v; redesenhar(); if (fim) mudou(); } }),
          campoNumero("Fade de entrada", c.fadeIn, { min: 0, max: Math.max(0.01, c.duracao - c.fadeOut), unidade: " s", aoMudar: (v, fim) => { c.fadeIn = v; redesenhar(); if (fim) mudou(); } }),
          campoNumero("Fade de saída", c.fadeOut, { min: 0, max: Math.max(0.01, c.duracao - c.fadeIn), unidade: " s", aoMudar: (v, fim) => { c.fadeOut = v; redesenhar(); if (fim) mudou(); } })),
        secao("Ações", el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: separarNoCursor }, "Separar no cursor"),
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: duplicar }, "Duplicar"),
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: normalizar }, "Normalizar"),
          el("button", { class: "lnux-botao pequeno", type: "button", onclick: inverter }, c.reverso ? "Tocar para a frente" : "Tocar ao contrário"),
          el("button", { class: "lnux-botao pequeno perigo", type: "button", onclick: apagar }, "Apagar"))));
      return;
    }
    if (lista.length > 1) {
      titulo.textContent = `${lista.length} clipes`;
      corpoProps.append(secao("Vários clipes", el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: duplicar }, "Duplicar"),
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: normalizar }, "Normalizar"),
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: fadesCurtos }, "Fades curtos"),
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => marcarLoopNaSelecao() }, "Marcar loop aqui"),
        el("button", { class: "lnux-botao pequeno perigo", type: "button", onclick: apagar }, "Apagar"))));
      return;
    }
    const t = trilhaPorId(trilhaEscolhida);
    if (!t) return;
    titulo.textContent = "Trilha: " + t.nome;
    const e = t.efeitos;
    const atualizar = (fim) => { motor.atualizarTrilhas(projeto); desenharMixer(); if (fim) mudou(); };
    const corEntrada = el("input", { class: "lnux-entrada", type: "color", value: t.cor });
    corEntrada.addEventListener("change", () => { hist.marcar("Cor da trilha"); t.cor = corEntrada.value; mudou(); });
    corpoProps.append(
      secao("Trilha",
        el("div", { class: "lnux-prop" }, el("label", {}, "Cor"), corEntrada, el("span")),
        campoNumero("Volume", t.volume, { min: -40, max: 12, passo: 0.5, unidade: " dB", casas: 1, aoMudar: (v, fim) => { t.volume = v; desenharCabecalhosLeve(); atualizar(fim); } }),
        campoNumero("Pan", t.pan, { min: -1, max: 1, passo: 0.05, aoMudar: (v, fim) => { t.pan = v; atualizar(fim); } })),
      secao("Equalizador",
        alternador("Ligado", e.eq.ligado, (v) => { e.eq.ligado = v; atualizar(true); }),
        campoNumero("Graves", e.eq.graves, { min: -15, max: 15, passo: 0.5, unidade: " dB", casas: 1, aoMudar: (v, fim) => { e.eq.graves = v; e.eq.ligado = true; atualizar(fim); } }),
        campoNumero("Médios", e.eq.medios, { min: -15, max: 15, passo: 0.5, unidade: " dB", casas: 1, aoMudar: (v, fim) => { e.eq.medios = v; e.eq.ligado = true; atualizar(fim); } }),
        campoNumero("Agudos", e.eq.agudos, { min: -15, max: 15, passo: 0.5, unidade: " dB", casas: 1, aoMudar: (v, fim) => { e.eq.agudos = v; e.eq.ligado = true; atualizar(fim); } })),
      secao("Compressor",
        alternador("Ligado", e.compressor.ligado, (v) => { e.compressor.ligado = v; atualizar(true); }),
        campoNumero("Limiar", e.compressor.limiar, { min: -60, max: 0, passo: 1, unidade: " dB", casas: 0, aoMudar: (v, fim) => { e.compressor.limiar = v; atualizar(fim); } }),
        campoNumero("Razão", e.compressor.razao, { min: 1, max: 20, passo: 0.5, unidade: ":1", casas: 1, aoMudar: (v, fim) => { e.compressor.razao = v; atualizar(fim); } })),
      secao("Eco",
        alternador("Ligado", e.eco.ligado, (v) => { e.eco.ligado = v; atualizar(true); }),
        campoNumero("Tempo", e.eco.tempo, { min: 0.02, max: 2, passo: 0.01, unidade: " s", aoMudar: (v, fim) => { e.eco.tempo = v; atualizar(fim); } }),
        campoNumero("Repetições", e.eco.retorno, { min: 0, max: 0.9, passo: 0.01, aoMudar: (v, fim) => { e.eco.retorno = v; atualizar(fim); } }),
        campoNumero("Mistura", e.eco.mistura, { min: 0, max: 1, passo: 0.01, aoMudar: (v, fim) => { e.eco.mistura = v; atualizar(fim); } }),
        el("button", { class: "lnux-botao pequeno", type: "button", onclick: () => { hist.marcar("Eco no tempo"); e.eco.tempo = Math.round((60 / projeto.bpm / 2) * 1000) / 1000; e.eco.ligado = true; atualizar(true); desenharPropriedades(); } }, "Eco no tempo da música (1/8)")),
      secao("Reverb",
        alternador("Ligado", e.reverb.ligado, (v) => { e.reverb.ligado = v; atualizar(true); }),
        campoNumero("Tamanho da sala", e.reverb.tamanho, { min: 0.3, max: 8, passo: 0.1, unidade: " s", casas: 1, aoMudar: (v, fim) => { e.reverb.tamanho = v; if (fim) atualizar(true); } }),
        campoNumero("Mistura", e.reverb.mistura, { min: 0, max: 1, passo: 0.01, aoMudar: (v, fim) => { e.reverb.mistura = v; atualizar(fim); } })),
      secao("Projeto",
        campoNumero("Volume mestre", projeto.volumeMestre || 0, { min: -30, max: 6, passo: 0.5, unidade: " dB", casas: 1, aoMudar: (v, fim) => { projeto.volumeMestre = v; motor.atualizarTrilhas(projeto); desenharMixer(); if (fim) mudou(); } }),
        campoNumero("Compensar o atraso da gravação", projeto.latencia || 0, { min: 0, max: 400, passo: 1, unidade: " ms", casas: 0, aoMudar: (v, fim) => { projeto.latencia = v; if (fim) mudou(); } }),
        el("p", { class: "fraco", style: { margin: "6px 0 0" } }, "Se a voz gravada fica atrasada em relação à música, aumente a compensação.")));
  }
  // Durante um arraste, só atualiza o texto do clipe (redesenhar o painel todo tiraria o foco)
  const desenharPropriedadesLeve = LNUX.adiar(desenharPropriedades, 120);
  const desenharCabecalhosLeve = LNUX.adiar(desenharCabecalhos, 60);

  // ── Mixer ───────────────────────────────────────────────────────────

  const medidoresMixer = new Map();
  function desenharMixer() {
    if (getComputedStyle($("#mixer")).display === "none") return;
    medidoresMixer.clear();
    const canal = (t, mestre) => {
      const valorDb = mestre ? projeto.volumeMestre || 0 : t.volume;
      const fader = el("input", { class: "fader", type: "range", min: -40, max: 12, step: 0.5, value: valorDb, "aria-label": "Volume" });
      const valor = el("div", { class: "valor" }, formatarDb(valorDb));
      fader.addEventListener("pointerdown", () => hist.marcar("Volume"));
      fader.addEventListener("input", () => {
        if (mestre) projeto.volumeMestre = +fader.value; else t.volume = +fader.value;
        valor.textContent = formatarDb(+fader.value);
        motor.atualizarTrilhas(projeto);
        if (!mestre) desenharCabecalhosLeve();
      });
      fader.addEventListener("change", () => mudou());
      const medidor = el("canvas", { width: 10, height: 120 });
      medidoresMixer.set(mestre ? "mestre" : t.id, medidor);
      const partes = [el("div", { class: "nome", style: { "--cor-trilha": mestre ? "var(--destaque)" : t.cor }, title: mestre ? "Mestre" : t.nome }, mestre ? "Mestre" : t.nome)];
      if (!mestre) {
        const e = t.efeitos;
        partes.push(el("div", { class: "efeitos-mini" },
          ...[["EQ", e.eq.ligado], ["CMP", e.compressor.ligado], ["ECO", e.eco.ligado], ["REV", e.reverb.ligado]].map(([n, l]) => el("span", { class: l ? "ligado" : "" }, n))));
      } else partes.push(el("div", { class: "efeitos-mini" }, el("span", {}, "SAÍDA")));
      partes.push(el("div", { class: "fader-medidor" }, fader, medidor), valor);
      if (!mestre) {
        const pan = el("input", { class: "pan", type: "range", min: -1, max: 1, step: 0.05, value: t.pan, title: "Pan (esquerda ↔ direita)", "aria-label": "Pan" });
        pan.addEventListener("pointerdown", () => hist.marcar("Pan"));
        pan.addEventListener("input", () => { t.pan = +pan.value; motor.atualizarTrilhas(projeto); });
        pan.addEventListener("change", () => mudou());
        pan.addEventListener("dblclick", () => { t.pan = 0; pan.value = 0; motor.atualizarTrilhas(projeto); mudou(); });
        partes.push(el("div", { class: "botoes" },
          el("button", { class: "m", type: "button", "aria-pressed": String(t.mudo), onclick: () => alternarTrilha("mudo", t.id) }, "M"),
          el("button", { class: "s", type: "button", "aria-pressed": String(t.solo), onclick: () => alternarTrilha("solo", t.id) }, "S")), pan);
      } else partes.push(el("div"), el("div"));
      return el("div", {
        class: "canal" + (mestre ? " mestre" : ""), style: { "--cor-trilha": mestre ? "" : t.cor },
        onclick: () => { if (!mestre && trilhaEscolhida !== t.id) { trilhaEscolhida = t.id; selecao.clear(); desenharCabecalhos(); desenharPropriedades(); redesenhar(); } },
      }, ...partes);
    };
    canais.replaceChildren(...projeto.trilhas.map((t) => canal(t, false)), canal(null, true));
  }

  function desenharMedidor(canvas, nivel, vertical = true) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const db = 20 * Math.log10(Math.max(1e-5, nivel.pico));
    const fracao = limitar((db + 48) / 48, 0, 1);
    const rms = limitar((20 * Math.log10(Math.max(1e-5, nivel.rms)) + 48) / 48, 0, 1);
    const corBarra = db > -1 ? "#f2667a" : db > -9 ? "#f5c451" : "#4fd18b";
    ctx.fillStyle = corBarra;
    if (vertical) {
      ctx.globalAlpha = 0.45; ctx.fillRect(0, h - fracao * h, w, fracao * h);
      ctx.globalAlpha = 1; ctx.fillRect(0, h - rms * h, w, rms * h);
    } else {
      ctx.globalAlpha = 0.45; ctx.fillRect(0, 0, fracao * w, h);
      ctx.globalAlpha = 1; ctx.fillRect(0, 0, rms * w, h);
    }
    ctx.globalAlpha = 1;
  }

  // ── Tocar, parar, gravar ────────────────────────────────────────────

  function irPara(t) {
    cursor = Math.max(0, t);
    if (motor.tocando && !gravacao) { inicioDoPlay = cursor; motor.tocar(projeto, cursor, { loop: loopLigado ? projeto.loop : null }); }
    mostrarTempo(cursor);
    manterVisivel(cursor);
    redesenhar();
  }

  function alternarPlay() {
    if (gravacao) { pararGravacao(); return; }
    if (motor.tocando) { pausar(); return; }
    inicioDoPlay = cursor;
    motor.tocar(projeto, cursor, { loop: loopLigado ? projeto.loop : null });
    atualizarBotoes();
    laco();
  }
  function pausar() {
    const t = motor.tempo();
    motor.parar();
    if (t !== null) cursor = t;
    atualizarBotoes();
    redesenhar();
  }
  function parar(voltar) {
    if (gravacao) { pararGravacao(); return; }
    motor.parar();
    if (voltar) cursor = inicioDoPlay;
    atualizarBotoes();
    mostrarTempo(cursor);
    redesenhar();
  }
  motor.aoTerminar = () => { atualizarBotoes(); redesenhar(); };

  function alternarLoop() {
    if (!(projeto.loop.fim > projeto.loop.inicio)) {
      if (selecao.size) marcarLoopNaSelecao();
      else { LNUX.aviso("Marque a região do loop: arraste na régua segurando Shift (ou escolha clipes e use Transporte › Marcar loop)."); return; }
    }
    loopLigado = !loopLigado;
    if (motor.tocando && !gravacao) motor.tocar(projeto, motor.tempo(), { loop: loopLigado ? projeto.loop : null });
    atualizarBotoes();
    redesenhar();
  }
  function marcarLoopNaSelecao() {
    const alvos = escolhidos();
    if (!alvos.length) return;
    projeto.loop = { inicio: Math.min(...alvos.map((c) => c.inicio)), fim: Math.max(...alvos.map((c) => c.inicio + c.duracao)) };
    loopLigado = true;
    atualizarBotoes();
    mudou();
  }
  function alternarMetronomo() {
    motor.metronomoLigado = !motor.metronomoLigado;
    atualizarBotoes();
  }

  let microfone = null;
  async function alternarGravacao() {
    if (gravacao) { pararGravacao(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { LNUX.aviso("Este navegador não grava áudio.", "erro"); return; }
    let trilha = projeto.trilhas.find((t) => t.armada);
    if (!trilha) {
      trilha = trilhaPorId(trilhaEscolhida) || projeto.trilhas[0];
      trilha.armada = true;
    }
    try {
      if (!microfone || !microfone.active) {
        microfone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      }
    } catch (e) {
      LNUX.aviso("Sem acesso ao microfone. Permita o microfone para este endereço no navegador.", "erro");
      return;
    }
    if (motor.tocando) motor.parar();
    const tipos = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", ""];
    const tipo = tipos.find((t) => !t || MediaRecorder.isTypeSupported(t));
    const gravador = new MediaRecorder(microfone, tipo ? { mimeType: tipo } : undefined);
    const pedacos = [];
    gravador.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
    motor.gravando = true;
    motor.tocar(projeto, cursor);
    const ctx = motor.ctx;
    const entradaMedidor = ctx.createMediaStreamSource(microfone);
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 1024;
    entradaMedidor.connect(analisador);
    gravacao = { trilha: trilha.id, inicio: cursor, gravador, pedacos, analisador, entradaMedidor, t0Ctx: ctx.currentTime, inicioCtx: motor.inicioCtx };
    gravador.start(250);
    inicioDoPlay = cursor;
    atualizarBotoes();
    desenharCabecalhos();
    laco();
  }

  function pararGravacao() {
    const g = gravacao;
    if (!g) return;
    gravacao = null;
    const fim = motor.tempo();
    motor.gravando = false;
    motor.parar();
    g.entradaMedidor.disconnect();
    g.gravador.onstop = async () => {
      const blob = new Blob(g.pedacos, { type: g.gravador.mimeType || "audio/webm" });
      try {
        const buffer = await motor.decodificar(await blob.arrayBuffer());
        const id = LNUX.id("a");
        audios.set(id, { blob });
        motor.registrar(id, buffer);
        hist.marcar("Gravação");
        projeto.audios[id] = { nome: `Gravação ${new Date().toLocaleTimeString("pt-BR")}`, tipo: blob.type, duracao: buffer.duration, canais: buffer.numberOfChannels, taxa: buffer.sampleRate };
        // O gravador começou um pouco antes do play (que foi agendado para logo depois) + a latência do aparelho
        const antes = Math.max(0, g.inicioCtx - g.t0Ctx);
        const atraso = antes + (projeto.latencia || 0) / 1000;
        const duracao = Math.max(0.05, Math.min(buffer.duration - atraso, (fim ?? g.inicio) - g.inicio + 0.05));
        const c = { id: LNUX.id("c"), trilha: g.trilha, audio: id, nome: projeto.audios[id].nome, inicio: g.inicio, entrada: atraso, duracao, ganho: 0, fadeIn: 0, fadeOut: 0 };
        projeto.clipes.push(c);
        selecao = new Set([c.id]);
        cursor = g.inicio;
        mudou();
        LNUX.aviso("Gravação pronta.", "ok");
      } catch (e) {
        LNUX.aviso("Não deu para ler a gravação: " + e.message, "erro");
      }
    };
    g.gravador.stop();
    atualizarBotoes();
    redesenhar();
  }

  function mostrarTempo(t) {
    $("#relogio-tempo").textContent = LNUX.tempo(t);
    const batida = 60 / projeto.bpm;
    const b = Math.floor(t / batida + 1e-6);
    $("#relogio-compasso").textContent = `${Math.floor(b / projeto.compasso) + 1}.${(b % projeto.compasso) + 1}`;
  }

  function manterVisivel(t) {
    const x = t * pxs;
    const l = rolagem.scrollLeft, w = rolagem.clientWidth;
    if (x < l || x > l + w - 30) rolagem.scrollLeft = Math.max(0, x - w * 0.25);
  }

  let rodandoLaco = false;
  function laco() {
    if (rodandoLaco) return;
    rodandoLaco = true;
    const passo = () => {
      const tocando = motor.tocando;
      if (tocando) {
        const t = motor.tempo();
        cursor = t;
        mostrarTempo(t);
        manterVisivel(t);
        desenharRegua();
        desenharPistas();
        desenharMedidor($("#medidor-mestre"), gravacao ? Motor.nivel(gravacao.analisador) : Motor.nivel(motor.medidorMestre), false);
        for (const [id, c] of medidoresMixer) {
          const n = id === "mestre" ? motor.medidorMestre : motor.trilhas.get(id) && motor.trilhas.get(id).medidor;
          desenharMedidor(c, Motor.nivel(n));
        }
        requestAnimationFrame(passo);
      } else {
        rodandoLaco = false;
        desenharMedidor($("#medidor-mestre"), { pico: 0, rms: 0 }, false);
        for (const c of medidoresMixer.values()) desenharMedidor(c, { pico: 0, rms: 0 });
        atualizarBotoes();
      }
    };
    requestAnimationFrame(passo);
  }

  // ── Zoom ────────────────────────────────────────────────────────────

  function zoom(fator, emTempo = null, emX = null) {
    const antes = pxs;
    pxs = limitar(pxs * fator, 4, 3000);
    if (emTempo === null) { emTempo = cursor; emX = cursor * antes - rolagem.scrollLeft; }
    atualizarEspaco();
    rolagem.scrollLeft = Math.max(0, emTempo * pxs - emX);
    redesenhar();
  }
  function verTudo() {
    const d = Math.max(10, duracaoDoProjeto(projeto) * 1.05);
    pxs = limitar((rolagem.clientWidth - 20) / d, 4, 3000);
    atualizarEspaco();
    rolagem.scrollLeft = 0;
    redesenhar();
  }

  // ── Importar áudio ──────────────────────────────────────────────────

  /** Decodifica; se o navegador não abre o formato e a ponte tem ffmpeg, converte para WAV antes. */
  async function decodificarArquivo(arq) {
    const blob = await arq.blob();
    try {
      return { buffer: await motor.decodificar(await blob.arrayBuffer()), blob };
    } catch (e) {
      if (!LNUX.ponte.tem("ffmpeg")) throw new Error(`O navegador não abre ${arq.nome}. Com a ponte local (e o ffmpeg), o Som converte sozinho.`);
      const entrada = arq.caminho || (await LNUX.ponte.temporario(blob, arq.nome)).caminho;
      const r = await LNUX.ponte.converter({ entrada, perfil: "wav" });
      const wav = await LNUX.ponte.ler(r.saida, "blob");
      return { buffer: await motor.decodificar(await wav.arrayBuffer()), blob: new Blob([wav], { type: "audio/wav" }) };
    }
  }

  async function adicionarArquivos(lista, { trilha = null, tempo = cursor } = {}) {
    if (!lista.length) return;
    const p = lista.length > 1 || lista[0].tamanho > 8e6 ? LNUX.progresso("Abrindo os áudios") : null;
    let primeiro = true;
    const novos = [];
    try {
      for (const [i, arq] of lista.entries()) {
        p && p.definir(i / lista.length, `Abrindo ${arq.nome}...`);
        try {
          const { buffer, blob } = await decodificarArquivo(arq);
          novos.push({ arq, buffer, blob });
        } catch (e) { LNUX.aviso(e.message, "erro"); }
      }
    } finally { p && p.fechar(); }
    if (!novos.length) return;
    hist.marcar("Importar áudio");
    selecao.clear();
    for (const { arq, buffer, blob } of novos) {
      const id = LNUX.id("a");
      audios.set(id, { blob });
      motor.registrar(id, buffer);
      projeto.audios[id] = { nome: arq.nome, tipo: blob.type || arq.tipo, duracao: buffer.duration, canais: buffer.numberOfChannels, taxa: buffer.sampleRate };
      let alvo = trilha && trilhaPorId(trilha);
      if (!alvo) {
        const escolhida = trilhaPorId(trilhaEscolhida);
        const livre = (t) => !projeto.clipes.some((c) => c.trilha === t.id && c.inicio < tempo + buffer.duration && c.inicio + c.duracao > tempo);
        alvo = primeiro && escolhida && livre(escolhida) ? escolhida : projeto.trilhas.find(livre);
        if (!alvo) { alvo = novaTrilha(projeto.trilhas.length, LNUX.nomeSemExtensao(arq.nome).slice(0, 24)); projeto.trilhas.push(alvo); }
      }
      const c = { id: LNUX.id("c"), trilha: alvo.id, audio: id, nome: LNUX.nomeSemExtensao(arq.nome), inicio: tempo, entrada: 0, duracao: buffer.duration, ganho: 0, fadeIn: 0, fadeOut: 0 };
      projeto.clipes.push(c);
      selecao.add(c.id);
      trilhaEscolhida = alvo.id;
      primeiro = false;
    }
    mudou({ estrutura: true });
    if (duracaoDoProjeto(projeto) * pxs > rolagem.clientWidth * 3 || projeto.clipes.length === novos.length) verTudo();
  }

  async function importar() {
    const lista = await LNUX.arquivos.abrir({ titulo: "Importar áudio", aceitar: "audio/*,video/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.aac,.webm", multiplos: true });
    await adicionarArquivos(lista);
  }

  LNUX.soltarArquivos(rolagem, (lista, e) => {
    const p = pontoNoCanvas(e);
    const t = projeto.trilhas[p.trilha];
    adicionarArquivos(lista, { trilha: t ? t.id : null, tempo: encaixar(Math.max(0, p.t)) });
  });

  // ── Guardar no navegador e projetos .lnuxsom ────────────────────────

  const guardarDepois = LNUX.adiar(async () => {
    try {
      await LNUX.guardado.gravar("som:projeto", JSON.stringify(projeto));
      for (const [id, a] of audios) {
        if (!guardados.has(id) && projeto.audios[id]) { await LNUX.guardado.gravar("som:audio:" + id, a.blob); guardados.add(id); }
      }
    } catch (e) {
      console.warn("Não deu para guardar no navegador:", e);
    }
  }, 700);

  async function limparGuardados() {
    for (const k of await LNUX.guardado.chaves("som:audio:")) await LNUX.guardado.apagar(k);
    guardados.clear();
  }

  async function carregarAudios(origem) {
    // origem(id) → Blob
    const ids = Object.keys(projeto.audios);
    const p = ids.length > 2 ? LNUX.progresso("Abrindo o projeto") : null;
    try {
      for (const [i, id] of ids.entries()) {
        p && p.definir(i / ids.length, `Áudio ${i + 1} de ${ids.length}...`);
        const blob = await origem(id);
        if (!blob) continue;
        try {
          const buffer = await motor.decodificar(await blob.arrayBuffer());
          audios.set(id, { blob });
          motor.registrar(id, buffer);
        } catch (e) { LNUX.aviso(`Não deu para abrir o áudio "${projeto.audios[id].nome}".`, "erro"); }
      }
    } finally { p && p.fechar(); }
  }

  function prepararProjetoCarregado(dados) {
    const base = novoProjeto();
    projeto = Object.assign(base, dados);
    projeto.trilhas = (dados.trilhas || base.trilhas).map((t) => Object.assign(novaTrilha(0), t, { efeitos: Object.assign(novaTrilha(0).efeitos, t.efeitos || {}) }));
    projeto.loop = dados.loop || { inicio: 0, fim: 0 };
    selecao.clear();
    trilhaEscolhida = projeto.trilhas[0] && projeto.trilhas[0].id;
    cursor = 0;
  }

  async function restaurar() {
    const salvo = await LNUX.guardado.ler("som:projeto");
    if (!salvo) return false;
    try {
      prepararProjetoCarregado(JSON.parse(salvo));
      await carregarAudios(async (id) => { const b = await LNUX.guardado.ler("som:audio:" + id); if (b) guardados.add(id); return b; });
      return true;
    } catch (e) {
      console.warn("Projeto guardado inválido:", e);
      return false;
    }
  }

  async function novo() {
    if (projeto.clipes.length && !(await LNUX.confirmar("Novo projeto", "Começar um projeto novo? O atual sai da tela (salve antes, se quiser guardar).", { rotulo: "Começar do zero" }))) return;
    motor.parar();
    projeto = novoProjeto();
    audios.clear();
    motor.buffers.clear();
    motor.picos.clear();
    selecao.clear();
    trilhaEscolhida = projeto.trilhas[0].id;
    cursor = 0;
    caminhoProjeto = null;
    hist.limpar();
    await limparGuardados();
    mudou({ estrutura: true });
  }

  async function gerarPacote() {
    const zip = new LNUX.Zip();
    const usados = new Set(projeto.clipes.map((c) => c.audio));
    const copia = JSON.parse(JSON.stringify(projeto));
    copia.audios = {};
    for (const id of usados) {
      const a = audios.get(id), meta = projeto.audios[id];
      if (!a || !meta) continue;
      const ext = LNUX.extensao(meta.nome) || (meta.tipo || "").split("/")[1]?.split(";")[0] || "audio";
      const arquivo = `audios/${id}.${ext}`;
      copia.audios[id] = { ...meta, arquivo };
      zip.adicionar(arquivo, a.blob);
    }
    copia.app = "lnux-som";
    zip.adicionar("projeto.json", JSON.stringify(copia, null, 2));
    return zip.gerar();
  }

  async function salvarProjeto(como = false) {
    const nome = (projeto.nome || "projeto").replace(/[\\/:*?"<>|]+/g, "_") + ".lnuxsom";
    const p = LNUX.progresso("Salvando o projeto");
    try {
      const blob = await gerarPacote();
      p.fechar();
      const r = await LNUX.arquivos.salvar(blob, nome, { titulo: "Salvar projeto", caminho: como ? null : caminhoProjeto });
      if (r && r !== "baixado") caminhoProjeto = r;
    } catch (e) { p.fechar(); LNUX.erro(e); }
  }

  async function abrirProjeto() {
    const [arq] = await LNUX.arquivos.abrir({ titulo: "Abrir projeto", aceitar: ".lnuxsom,.zip" });
    if (!arq) return;
    try {
      const arquivos = await LNUX.Zip.ler(await arq.blob());
      const json = arquivos.get("projeto.json");
      if (!json) throw new Error("Este arquivo não é um projeto do Som (falta projeto.json).");
      const dados = JSON.parse(await json.text());
      motor.parar();
      audios.clear(); motor.buffers.clear(); motor.picos.clear();
      await limparGuardados();
      prepararProjetoCarregado(dados);
      await carregarAudios(async (id) => arquivos.get((dados.audios[id] || {}).arquivo));
      for (const id of Object.keys(projeto.audios)) delete projeto.audios[id].arquivo;
      caminhoProjeto = arq.caminho && arq.caminho.endsWith(".lnuxsom") ? arq.caminho : null;
      hist.limpar();
      mudou({ estrutura: true });
      verTudo();
      LNUX.aviso("Projeto aberto.", "ok");
    } catch (e) { LNUX.erro(e); }
  }

  async function renomearProjeto() {
    const nome = await LNUX.perguntar("Nome do projeto", { valor: projeto.nome });
    if (nome === null || !nome.trim()) return;
    hist.marcar("Renomear projeto");
    projeto.nome = nome.trim();
    mudou();
  }

  // ── Exportar ────────────────────────────────────────────────────────

  async function exportar() {
    if (!projeto.clipes.length) { LNUX.aviso("Ainda não há som para exportar."); return; }
    const temFfmpeg = LNUX.ponte.tem("ffmpeg");
    const formatos = [
      ["wav16", "WAV (16 bits, CD)", true], ["wav24", "WAV (24 bits, estúdio)", true],
      ["mp3", "MP3", temFfmpeg], ["ogg", "OGG Vorbis", temFfmpeg], ["opus", "Opus", temFfmpeg], ["flac", "FLAC (sem perda)", temFfmpeg], ["m4a", "M4A (AAC)", temFfmpeg],
    ];
    const formato = el("select", { class: "lnux-selecao" }, ...formatos.map(([v, n, ok]) => el("option", { value: v, disabled: !ok }, n + (ok ? "" : " — precisa da ponte com ffmpeg"))));
    const trecho = el("select", { class: "lnux-selecao" },
      el("option", { value: "tudo" }, "O projeto inteiro"),
      el("option", { value: "loop", disabled: !(projeto.loop.fim > projeto.loop.inicio) }, "Só a região do loop"));
    const separado = el("input", { type: "checkbox" });
    const corpo = el("div", { style: { display: "grid", gap: "12px" } },
      el("label", { class: "lnux-campo" }, el("span", {}, "Formato"), formato),
      el("label", { class: "lnux-campo" }, el("span", {}, "Trecho"), trecho),
      el("label", { class: "lnux-alternar" }, separado, "Uma trilha por arquivo (num .zip, em WAV)"),
      temFfmpeg ? null : el("p", { class: "fraco", style: { margin: 0 } }, "MP3, OGG, FLAC e M4A saem pela ponte local com o ffmpeg. Abra o Som pelo LNUX (🌐 Apps Web) para ter esses formatos."));
    const ok = await LNUX.dialogo({ titulo: "Exportar", corpo, botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Exportar", primario: true, valor: true }] });
    if (!ok) return;
    const de = trecho.value === "loop" ? projeto.loop.inicio : 0;
    const ate = trecho.value === "loop" ? projeto.loop.fim : duracaoDoProjeto(projeto);
    const base = (projeto.nome || "mixagem").replace(/[\\/:*?"<>|]+/g, "_");
    const p = LNUX.progresso("Exportando");
    try {
      if (separado.checked) {
        const zip = new LNUX.Zip();
        for (const [i, t] of projeto.trilhas.entries()) {
          if (!projeto.clipes.some((c) => c.trilha === t.id)) continue;
          p.definir(i / projeto.trilhas.length, `Trilha ${t.nome}...`);
          const b = await motor.renderizar(projeto, { inicio: de, fim: ate, soTrilhas: [t.id] });
          zip.adicionar(`${String(i + 1).padStart(2, "0")} ${t.nome.replace(/[\\/:*?"<>|]+/g, "_")}.wav`, paraWav(b, formato.value === "wav24" ? 24 : 16));
        }
        p.definir(1, "Juntando no .zip...");
        const blob = await zip.gerar();
        p.fechar();
        await LNUX.arquivos.salvar(blob, base + " - trilhas.zip", { titulo: "Salvar as trilhas" });
        return;
      }
      p.definir(0.1, "Mixando...");
      const buffer = await motor.renderizar(projeto, { inicio: de, fim: ate });
      const wav = paraWav(buffer, formato.value === "wav24" ? 24 : 16);
      if (formato.value.startsWith("wav")) {
        p.fechar();
        await LNUX.arquivos.salvar(wav, base + ".wav", { titulo: "Salvar a mixagem" });
        return;
      }
      p.definir(0.4, "Enviando para a ponte...");
      const { caminho } = await LNUX.ponte.temporario(wav, base + ".wav");
      const r = await LNUX.ponte.converter({ entrada: caminho, perfil: formato.value }, (f, txt) => p.definir(0.4 + f * 0.5, txt));
      p.definir(0.95, "Buscando o arquivo...");
      const saida = await LNUX.ponte.ler(r.saida, "blob");
      p.fechar();
      await LNUX.arquivos.salvar(saida, `${base}.${formato.value}`, { titulo: "Salvar a mixagem" });
    } catch (e) { p.fechar(); LNUX.erro(e); }
  }

  // ── Mudanças ────────────────────────────────────────────────────────

  function mudou({ estrutura = false } = {}) {
    $("#titulo-doc").textContent = projeto.nome;
    campoBpm.value = projeto.bpm;
    campoCompasso.value = String(projeto.compasso);
    campoGrade.value = projeto.grade;
    atualizarEspaco();
    desenharCabecalhos();
    desenharPropriedades();
    desenharMixer();
    redesenhar();
    mostrarTempo(cursor);
    if (motor.tocando && !gravacao) {
      // mudou a estrutura (clipes, trilhas): recomeça a tocar do ponto atual com o projeto novo
      motor.tocar(projeto, motor.tempo(), { loop: loopLigado ? projeto.loop : null });
    }
    guardarDepois();
  }

  // ── Menus e atalhos ─────────────────────────────────────────────────

  const temSelecao = () => selecao.size > 0;
  const menus = [
    { rotulo: "Arquivo", itens: [
      { rotulo: "Novo projeto", atalho: "Alt+N", acao: novo },
      { rotulo: "Abrir projeto...", atalho: "Ctrl+O", acao: abrirProjeto },
      { rotulo: "Salvar projeto", atalho: "Ctrl+S", acao: () => salvarProjeto(false) },
      { rotulo: "Salvar projeto como...", atalho: "Ctrl+Shift+S", acao: () => salvarProjeto(true) },
      "-",
      { rotulo: "Importar áudio...", atalho: "Ctrl+I", acao: importar },
      { rotulo: "Exportar (WAV, MP3, OGG...)...", atalho: "Ctrl+E", acao: exportar },
      "-",
      { rotulo: "Renomear projeto...", acao: renomearProjeto },
    ] },
    { rotulo: "Editar", itens: [
      { rotulo: "Desfazer", atalho: "Ctrl+Z", acao: () => { const d = hist.desfazer(); if (d) LNUX.aviso("Desfeito: " + d); }, ativo: () => hist.podeDesfazer() },
      { rotulo: "Refazer", atalho: ["Ctrl+Shift+Z", "Ctrl+Y"], acao: () => hist.refazer(), ativo: () => hist.podeRefazer() },
      "-",
      { rotulo: "Separar no cursor", atalho: "S", acao: separarNoCursor },
      { rotulo: "Duplicar", atalho: "Ctrl+D", acao: duplicar, ativo: temSelecao },
      { rotulo: "Copiar", atalho: "Ctrl+C", acao: copiar, ativo: temSelecao },
      { rotulo: "Colar no cursor", atalho: "Ctrl+V", acao: colar, ativo: () => area_transferencia.length > 0 },
      { rotulo: "Apagar", atalho: ["Del", "Backspace"], acao: apagar, ativo: temSelecao },
      "-",
      { rotulo: "Escolher todos os clipes", atalho: "Ctrl+A", acao: () => { selecao = new Set(projeto.clipes.map((c) => c.id)); desenharPropriedades(); redesenhar(); } },
      { rotulo: "Normalizar", acao: normalizar, ativo: temSelecao },
      { rotulo: "Tocar ao contrário", acao: inverter, ativo: temSelecao },
      { rotulo: "Fades curtos (entrada e saída)", acao: fadesCurtos, ativo: temSelecao },
      "-",
      { rotulo: "Ferramenta de corte", atalho: "C", acao: () => { ferramenta = ferramenta === "cortar" ? "selecionar" : "cortar"; atualizarBotoes(); }, marcado: () => ferramenta === "cortar" },
      { rotulo: "Ímã (encaixar nas bordas)", acao: () => { ima = !ima; atualizarBotoes(); }, marcado: () => ima },
    ] },
    { rotulo: "Trilha", itens: [
      { rotulo: "Nova trilha", atalho: "Alt+T", acao: () => adicionarTrilha() },
      { rotulo: "Duplicar trilha", acao: () => duplicarTrilha() },
      { rotulo: "Excluir trilha", acao: () => excluirTrilha() },
      "-",
      { rotulo: "Mudo", atalho: "Shift+M", acao: () => alternarTrilha("mudo") },
      { rotulo: "Solo", atalho: "Shift+S", acao: () => alternarTrilha("solo") },
      { rotulo: "Armar para gravar", atalho: "Shift+R", acao: () => alternarTrilha("armada") },
      "-",
      { rotulo: "Trilha de cima", atalho: "↑", acao: () => { const i = indiceDaTrilha(trilhaEscolhida); if (i > 0) { trilhaEscolhida = projeto.trilhas[i - 1].id; selecao.clear(); mudou(); } } },
      { rotulo: "Trilha de baixo", atalho: "↓", acao: () => { const i = indiceDaTrilha(trilhaEscolhida); if (i < projeto.trilhas.length - 1) { trilhaEscolhida = projeto.trilhas[i + 1].id; selecao.clear(); mudou(); } } },
    ] },
    { rotulo: "Transporte", itens: [
      { rotulo: "Tocar / pausar", atalho: "Espaço", acao: alternarPlay },
      { rotulo: "Parar e voltar", atalho: "Enter", acao: () => parar(true) },
      { rotulo: "Gravar", atalho: "R", acao: alternarGravacao },
      "-",
      { rotulo: "Ir para o início", atalho: "Home", acao: () => irPara(0) },
      { rotulo: "Ir para o fim", atalho: "End", acao: () => irPara(duracaoDoProjeto(projeto)) },
      { rotulo: "Voltar um passo da grade", atalho: "←", acao: () => irPara(cursor - (passoGrade() || 1)) },
      { rotulo: "Avançar um passo da grade", atalho: "→", acao: () => irPara(cursor + (passoGrade() || 1)) },
      "-",
      { rotulo: "Repetir a região (loop)", atalho: "L", acao: alternarLoop, marcado: () => loopLigado },
      { rotulo: "Marcar loop nos clipes escolhidos", acao: marcarLoopNaSelecao, ativo: temSelecao },
      { rotulo: "Tirar o loop", acao: () => { projeto.loop = { inicio: 0, fim: 0 }; loopLigado = false; atualizarBotoes(); mudou(); } },
      { rotulo: "Metrônomo", atalho: "M", acao: alternarMetronomo, marcado: () => motor.metronomoLigado },
    ] },
    { rotulo: "Exibir", itens: [
      { rotulo: "Aproximar", atalho: ["=", "Mais", "Shift+Mais"], acao: () => zoom(1.5) },
      { rotulo: "Afastar", atalho: "-", acao: () => zoom(1 / 1.5) },
      { rotulo: "Ver o projeto todo", atalho: "0", acao: verTudo },
      "-",
      { rotulo: "Layout: edição", acao: () => LNUX.layout.definir("edicao"), marcado: () => LNUX.layout.atual() === "edicao" },
      { rotulo: "Layout: edição e mixer", acao: () => LNUX.layout.definir("completo"), marcado: () => LNUX.layout.atual() === "completo" },
      { rotulo: "Layout: mixagem", acao: () => LNUX.layout.definir("mixagem"), marcado: () => LNUX.layout.atual() === "mixagem" },
      { rotulo: "Layout: simples (celular)", acao: () => LNUX.layout.definir("simples"), marcado: () => LNUX.layout.atual() === "simples" },
      "-",
      { rotulo: "Aparência (tema e layout)...", acao: () => LNUX.aparencia(), semComando: true },
    ] },
    { rotulo: "Ajuda", itens: [
      { rotulo: "Atalhos de teclado", acao: () => LNUX.ajudaAtalhos() },
      { rotulo: "Como gravar e editar", acao: ajuda },
      { rotulo: "Sobre o Som", acao: () => LNUX.sobre() },
    ] },
  ];

  function ajuda() {
    LNUX.dialogo({ titulo: "Como usar o Som", largo: true, corpo: el("div", { html: `
      <p><strong>Gravar:</strong> aperte <b>R</b> (ou o botão vermelho). Grava na trilha armada (botão <b>R</b> da trilha) a partir do cursor, tocando as outras trilhas junto. <b>R</b> ou <b>Espaço</b> param.</p>
      <p><strong>Importar:</strong> arraste arquivos de áudio (ou vídeo) para as trilhas, ou use <em>Importar áudio</em>. Com a ponte local, dá para escolher nas pastas do aparelho e abrir formatos que o navegador não conhece.</p>
      <p><strong>Editar:</strong> arraste o clipe para mover (inclusive para outra trilha); puxe as bordas para aparar; puxe os quadradinhos de cima para o fade. <b>S</b> separa no cursor, <b>C</b> liga a ferramenta de corte, <b>Del</b> apaga, <b>Ctrl+D</b> duplica. Botão direito mostra mais opções.</p>
      <p><strong>Tempo:</strong> o BPM e a grade fazem os clipes encaixarem nas batidas. Arraste na régua com <b>Shift</b> para marcar um loop e aperte <b>L</b> para repetir. <b>M</b> liga o metrônomo.</p>
      <p><strong>Mixar:</strong> escolha uma trilha para ver o volume, pan, equalizador, compressor, eco e reverb. O layout <em>Mixagem</em> mostra o mixer grande.</p>
      <p><strong>Guardar:</strong> tudo fica guardado neste navegador sozinho. <em>Salvar projeto</em> gera um arquivo .lnuxsom com os áudios dentro, para abrir em outro lugar. <em>Exportar</em> gera a música final.</p>` }) });
  }

  // ── Começo ──────────────────────────────────────────────────────────

  $("#nova-trilha").addEventListener("click", () => adicionarTrilha());
  $("#importar").addEventListener("click", importar);

  LNUX.iniciar({
    app: "som", nome: "Som",
    descricao: "Estúdio de áudio multipistas: gravar pelo microfone, editar clipes com fades, mixar com equalizador, compressor, eco e reverb, e exportar.",
    inspirado: { nome: "SoundCraft", url: "https://github.com/storytold/soundcraft", autores: "ArtCraft Team e os colaboradores do SoundCraft" },
    layouts: [
      { id: "completo", nome: "Edição e mixer", descricao: "Trilhas, propriedades e o mixer embaixo", icone: "layout" },
      { id: "edicao", nome: "Edição", descricao: "Mais espaço para as trilhas, sem o mixer", icone: "onda" },
      { id: "mixagem", nome: "Mixagem", descricao: "O mixer grande, para acertar volumes e efeitos", icone: "mixer" },
      { id: "simples", nome: "Simples (celular)", descricao: "Uma coluna, botões maiores", icone: "tela", celular: true },
    ],
    menus,
  }).then(async () => {
    if (await restaurar()) LNUX.aviso("Projeto recuperado de onde você parou.", "ok");
    mudou({ estrutura: true });
    if (projeto.clipes.length) verTudo();
  });
  atualizarBotoes();
  mudou({ estrutura: true });

  // Para os testes automáticos e para quem quiser mexer pelo console
  window.Som = { get projeto() { return projeto; }, motor, adicionarArquivos, exportar, renderizarWav: async () => paraWav(await motor.renderizar(projeto)), separarNoCursor, irPara, gerarPacote };
})();
