/*
 * Companhia — captura de movimento pela câmera, para as personagens VRoid (.vrm).
 *
 * A câmera do aparelho é lida pelo MediaPipe Tasks Vision (Google, Apache-2.0), que roda num Worker
 * (vendor/mediapipe-visao.min.js) para o desenho da personagem não travar. A cada quadro ele devolve:
 *
 *   - rosto: 52 formas (as do ARKit: piscar, boca, sobrancelhas, direção dos olhos...) e a rotação da cabeça;
 *   - corpo: 33 pontos em metros (ombros, cotovelos, pulsos, quadril, joelhos, tornozelos, pés...);
 *   - mãos: 21 pontos de cada mão (os dedos, junta por junta).
 *
 * Aqui esses pontos viram rotações dos ossos do VRM, no espaço canônico do palco 3D (a personagem olha para +Z,
 * o braço esquerdo aponta para +X): tronco e ombros pela linha dos ombros e do quadril; braços e pernas por
 * "mira e polo" (o osso aponta para a junta seguinte e torce para o lado em que o cotovelo/joelho dobra); pulso
 * pelo plano da palma; dedos junta por junta; cabeça pela matriz do rosto; olhos e expressões pelas 52 formas.
 * Nada é enviado para fora: a imagem da câmera é processada no próprio aparelho.
 *
 * Os arquivos do MediaPipe (WebAssembly e modelos, ~30 MB) não vêm no repositório. Eles são buscados, nesta
 * ordem: na cópia guardada no navegador, na ponte local (que baixa das fontes oficiais uma vez e guarda em
 * ~/.lnux-apps/mediapipe/) ou direto da internet (e então ficam guardados no navegador).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  /** 0 abaixo de a, 1 acima de b, suave no meio. */
  const degrau = (a, b, v) => { const t = limitar((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const faixa = (v, a, b) => limitar((v - a) / (b - a));

  // ── Arquivos do MediaPipe ───────────────────────────────────────────
  const VERSAO = "1.2.2";
  const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO}/wasm/`;
  const MODELOS = "https://storage.googleapis.com/mediapipe-models/";
  const ARQUIVOS = {
    "vision_wasm_internal.js": { url: CDN + "vision_wasm_internal.js", tipo: "text/javascript", mb: 0.3 },
    "vision_wasm_internal.wasm": { url: CDN + "vision_wasm_internal.wasm", tipo: "application/wasm", mb: 14.6 },
    "face_landmarker.task": { url: MODELOS + "face_landmarker/face_landmarker/float16/1/face_landmarker.task", mb: 3.8 },
    "pose_landmarker_lite.task": { url: MODELOS + "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", mb: 5.8 },
    "pose_landmarker_full.task": { url: MODELOS + "pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task", mb: 9.4 },
    "hand_landmarker.task": { url: MODELOS + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", mb: 7.8 },
  };
  const chaveGuardado = (nome) => `companhia:visao:${VERSAO}:${nome}`;

  C.capturaArquivos = {
    VERSAO, ARQUIVOS,
    /** Devolve o arquivo (Blob): do navegador, da ponte (que baixa se faltar) ou da internet. */
    async obter(nome, aoProgresso = () => {}) {
      const info = ARQUIVOS[nome];
      if (!info) throw new Error("Arquivo do rastreamento desconhecido: " + nome);
      const comTipo = (b) => (info.tipo && b.type !== info.tipo ? new Blob([b], { type: info.tipo }) : b);
      const guardado = await LNUX.guardado.ler(chaveGuardado(nome));
      if (guardado && guardado.size) return comTipo(guardado);
      const ponte = LNUX.ponte;
      if (ponte.tem("mediapipe")) {
        try {
          const estado = await ponte.pedir("GET", "mediapipe");
          if (!estado.arquivos[nome]) {
            aoProgresso(`Baixando ${nome} (${info.mb} MB) pela ponte, só desta vez...`);
            await ponte.pedir("POST", "mediapipe", { json: { arquivos: [nome] } });
          }
          return comTipo(await ponte.pedir("GET", "mediapipe/" + nome, { como: "blob" }));
        } catch (e) { console.warn("captura: a ponte não entregou " + nome + "; tentando pela internet", e); }
      }
      aoProgresso(`Baixando ${nome} (${info.mb} MB), só desta vez...`);
      let resposta;
      try { resposta = await fetch(info.url); } catch (e) { resposta = null; }
      if (!resposta || !resposta.ok) throw new Error(`Não consegui baixar ${nome} (${info.mb} MB), que a captura de movimento precisa. Precisa de internet na primeira vez` +
        (ponte.disponivel ? "." : "; abrindo a Companhia pelo LNUX (🌐 Apps Web), a ponte guarda os arquivos no aparelho."));
      const blob = comTipo(await resposta.blob());
      LNUX.guardado.gravar(chaveGuardado(nome), blob).catch(() => {}); // da próxima vez, sem internet
      return blob;
    },
    /** Quanto está guardado neste navegador (bytes). */
    async guardados() {
      let total = 0;
      for (const k of await LNUX.guardado.chaves("companhia:visao:")) { const b = await LNUX.guardado.ler(k); total += (b && b.size) || 0; }
      return total;
    },
    async apagar() { for (const k of await LNUX.guardado.chaves("companhia:visao:")) await LNUX.guardado.apagar(k); },
  };

  // ── Pontos do MediaPipe ─────────────────────────────────────────────
  /** Pontos do corpo: o par do outro lado (1–3 ↔ 4–6 nos olhos; depois ímpar = esquerda, par = direita). */
  const outroLado = (i) => (i === 0 ? 0 : i <= 6 ? (i <= 3 ? i + 3 : i - 3) : (i % 2 ? i + 1 : i - 1));
  const LIGACOES_CORPO = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30],
    [15, 19], [16, 20], [0, 7], [0, 8]];
  const LIGACOES_MAO = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  /** Dedo do VRM → os 4 pontos da mão do MediaPipe (da base à ponta). */
  const PONTOS_DEDO = { Thumb: [1, 2, 3, 4], Index: [5, 6, 7, 8], Middle: [9, 10, 11, 12], Ring: [13, 14, 15, 16], Little: [17, 18, 19, 20] };

  const PADRAO = { rosto: true, corpo: true, maos: true, pernas: false, olhos: true, espelhar: true, suavizar: 0.5, modeloCorpo: "lite", delegado: "auto", previa: true, camera: "", fps: 30 };

  class Captura {
    /** conteiner: onde fica a janelinha da câmera; aoEstado(texto, tipo): avisos de andamento. */
    constructor({ conteiner, aoEstado } = {}) {
      this.conteiner = conteiner || document.body;
      this.aoEstado = aoEstado || (() => {});
      this.cfg = { ...PADRAO };
      try { Object.assign(this.cfg, JSON.parse(LNUX.preferencia.ler("companhia.captura", "{}"))); } catch (e) { /* padrão */ }
      this.palco = null;      // o palco 3D da personagem (a tela põe aqui)
      this.ligada = false;
      this.ligando = false;
      this.worker = null;
      this.fluxo = null;
      this.video = null;
      this.ocupado = false;
      this.alvos = new Map(); // osso → {q, peso, t}: o último resultado
      this.atual = new Map(); // osso → {q, peso}: suavizado, o que vai para a pose
      this.rosto = null;      // {expr, morfos, arkit, olhar, t}
      this.rostoSuave = null;
      this.antebraco = {};    // lado → {q: rotação do antebraço no mundo canônico, t}
      this.polo = {};
      this.maoVista = {};     // lado → quando a mão foi vista pela última vez
      this.visto = { rosto: 0, corpo: 0, maos: 0 };
      this.medida = { fps: 0, ms: 0, quadros: 0, desde: 0, delegado: null };
      this.calibre = null;    // rotação neutra da cabeça (olhando para a tela)
      this.cabecaCrua = null;
      this.erros = 0;
    }
    salvarCfg() { LNUX.preferencia.gravar("companhia.captura", JSON.stringify(this.cfg)); }
    /** Vale na pose? (ligada, ou recebendo resultados de fora, e com um palco 3D) */
    get ativa() { return (this.ligada || this.simulando) && !!this.palco; }
    /**
     * Recebe um resultado pronto, sem a câmera: {rosto: {formas, matriz}, corpo: {mundo, imagem}, maos: [{lado, mundo,
     * imagem}]}, no formato do Worker. Serve para os testes e para ligar outro rastreador. desligar() encerra.
     */
    simular(resultado) { this.simulando = true; this.processar(resultado); }

    // ── ligar e desligar ────────────────────────────────────────────
    async ligar() {
      if (this.ligada || this.ligando) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(window.isSecureContext === false
          ? "A câmera só funciona em endereço seguro: abra a Companhia por http://127.0.0.1 (ou localhost) no próprio aparelho, ou por https (o túnel do LNUX)."
          : "Este navegador não dá acesso à câmera.");
      }
      const cfg = this.cfg;
      if (!cfg.rosto && !cfg.corpo && !cfg.maos) throw new Error("Marque pelo menos uma coisa para rastrear: o rosto, o corpo ou as mãos.");
      this.ligando = true;
      try {
        // a câmera primeiro: se a pessoa não deixar, nem baixa os arquivos
        this.aoEstado("Abrindo a câmera...");
        const video = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
        if (cfg.camera) video.deviceId = { exact: cfg.camera }; else video.facingMode = "user";
        try { this.fluxo = await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
        catch (e) {
          if (cfg.camera && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
            cfg.camera = "";
            this.fluxo = await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined, facingMode: "user" }, audio: false });
          } else throw e;
        }
        this.montarPrevia();
        this.video.srcObject = this.fluxo;
        await this.video.play().catch(() => {});
        // os arquivos do MediaPipe
        const nomes = { wasmJs: "vision_wasm_internal.js", wasmBin: "vision_wasm_internal.wasm" };
        if (cfg.rosto) nomes.rosto = "face_landmarker.task";
        if (cfg.corpo) nomes.corpo = cfg.modeloCorpo === "full" ? "pose_landmarker_full.task" : "pose_landmarker_lite.task";
        if (cfg.maos) nomes.maos = "hand_landmarker.task";
        this.aoEstado("Preparando o rastreamento...");
        const blobs = {};
        for (const [k, nome] of Object.entries(nomes)) blobs[k] = await C.capturaArquivos.obter(nome, (t) => this.aoEstado(t));
        const modelos = {};
        for (const k of ["rosto", "corpo", "maos"]) if (blobs[k]) modelos[k] = await blobs[k].arrayBuffer();
        this.aoEstado("Ligando o rastreamento...");
        await this.criarWorker({ wasmJs: blobs.wasmJs, wasmBin: blobs.wasmBin, modelos });
        this.ligada = true;
        this.erros = 0;
        this.medida = { fps: 0, ms: 0, quadros: 0, desde: performance.now(), delegado: this.medida.delegado };
        this.bombear();
        this.aoEstado("");
      } catch (e) {
        this.desligar();
        throw this.explicar(e);
      } finally { this.ligando = false; }
    }
    explicar(e) {
      const n = e && e.name;
      if (n === "NotAllowedError" || n === "SecurityError") return new Error("A câmera não foi liberada. Permita o uso da câmera para este endereço (o cadeado ao lado do endereço, no navegador) e tente de novo.");
      if (n === "NotFoundError" || n === "OverconstrainedError") return new Error("Não achei nenhuma câmera neste aparelho.");
      if (n === "NotReadableError" || n === "AbortError") return new Error("A câmera está sendo usada por outro programa (ou o aparelho não deixou abrir). Feche o outro programa e tente de novo.");
      return e instanceof Error ? e : new Error(String(e));
    }
    criarWorker(dados) {
      return new Promise((ok, falhou) => {
        let w;
        try { w = new Worker("vendor/mediapipe-visao.min.js"); } catch (e) { falhou(new Error("Faltou vendor/mediapipe-visao.min.js (o rastreamento).")); return; }
        this.worker = w;
        const limite = setTimeout(() => falhou(new Error("O rastreamento demorou demais para ligar neste aparelho.")), 90000);
        w.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.tipo === "pronto") { clearTimeout(limite); this.medida.delegado = m.delegado; ok(); }
          else if (m.tipo === "resultado") { this.ocupado = false; try { this.processar(m); } catch (e) { console.error(e); } }
          else if (m.tipo === "erro") {
            if (!m.quadro) { clearTimeout(limite); falhou(new Error("O rastreamento não ligou: " + m.mensagem)); return; }
            this.ocupado = false;
            if (++this.erros > 20) { console.error("captura:", m.mensagem); this.desligar(); this.aoEstado("O rastreamento parou: " + m.mensagem, "erro"); }
          }
        };
        w.onerror = (ev) => { clearTimeout(limite); falhou(new Error("O rastreamento não ligou" + (ev && ev.message ? ": " + ev.message : "."))); };
        w.postMessage({ tipo: "iniciar", ...dados, delegado: this.cfg.delegado === "cpu" ? "CPU" : "GPU" }, Object.values(dados.modelos));
      });
    }
    desligar() {
      this.ligada = false;
      this.simulando = false;
      if (this.pedido && this.video) {
        if (this.video.cancelVideoFrameCallback && this.pedidoVideo) this.video.cancelVideoFrameCallback(this.pedido); else cancelAnimationFrame(this.pedido);
      }
      this.pedido = 0;
      if (this.worker) { try { this.worker.postMessage({ tipo: "fechar" }); } catch (e) { /* já fechou */ } const w = this.worker; setTimeout(() => w.terminate(), 300); this.worker = null; }
      if (this.fluxo) { for (const t of this.fluxo.getTracks()) t.stop(); this.fluxo = null; }
      if (this.caixa) { this.caixa.remove(); this.caixa = null; this.video = null; this.tela = null; }
      this.ocupado = false;
      this.alvos.clear();
      this.atual.clear();
      this.rosto = null;
      this.rostoSuave = null;
      this.antebraco = {};
      this.polo = {};
    }
    /** Lista as câmeras do aparelho (os nomes só aparecem depois que a câmera foi liberada uma vez). */
    async cameras() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, nome: d.label || "Câmera " + (i + 1) })); }
      catch (e) { return []; }
    }

    // ── a janelinha da câmera ───────────────────────────────────────
    montarPrevia() {
      if (this.caixa) return;
      this.video = el("video", { playsinline: "", muted: "", autoplay: "" });
      this.video.muted = true;
      this.tela = el("canvas", { width: 320, height: 240 });
      this.rotulo = el("span", { class: "rotulo" }, "");
      this.caixa = el("div", { class: "captura-previa", title: "Sua câmera (a imagem não sai do aparelho)" }, this.video, this.tela, this.rotulo);
      this.conteiner.append(this.caixa);
      this.aplicarPrevia();
    }
    aplicarPrevia() {
      if (!this.caixa) return;
      this.caixa.classList.toggle("espelhada", !!this.cfg.espelhar);
      this.caixa.classList.toggle("escondida", !this.cfg.previa);
    }
    desenharPrevia(r) {
      if (!this.tela || !this.cfg.previa) return;
      const v = this.video, tela = this.tela;
      if (v.videoWidth && (tela.width !== v.videoWidth || tela.height !== v.videoHeight)) { tela.width = v.videoWidth; tela.height = v.videoHeight; }
      const g = tela.getContext("2d"), W = tela.width, H = tela.height;
      g.clearRect(0, 0, W, H);
      g.lineWidth = Math.max(2, W / 200);
      const linhas = (pts, ligacoes, cor, visivel) => {
        g.strokeStyle = cor;
        g.beginPath();
        for (const [a, b] of ligacoes) {
          if (visivel && (pts[a][3] < 0.4 || pts[b][3] < 0.4)) continue;
          g.moveTo(pts[a][0] * W, pts[a][1] * H);
          g.lineTo(pts[b][0] * W, pts[b][1] * H);
        }
        g.stroke();
      };
      if (r.corpo) linhas(r.corpo.imagem, LIGACOES_CORPO, "#3ddc97", true);
      for (const m of r.maos || []) linhas(m.imagem, LIGACOES_MAO, "#ffb020", false);
      if (r.rosto && r.rosto.pontos) {
        g.fillStyle = "#6bb8ff";
        const p = r.rosto.pontos, t = Math.max(1.5, W / 320);
        for (let i = 0; i < p.length; i += 6) g.fillRect(p[i] * W - t / 2, p[i + 1] * H - t / 2, t, t);
      }
    }

    // ── a câmera, quadro a quadro ───────────────────────────────────
    bombear() {
      if (!this.ligada) return;
      const v = this.video, agora = performance.now();
      if (!this.ocupado && v && v.readyState >= 2 && v.currentTime !== this.tempoVideo && agora - (this.enviado || 0) >= 1000 / (this.cfg.fps || 30) - 4) {
        this.tempoVideo = v.currentTime;
        this.ocupado = true;
        this.enviado = agora;
        const cfg = this.cfg;
        createImageBitmap(v).then((imagem) => {
          if (!this.ligada || !this.worker) { imagem.close(); this.ocupado = false; return; }
          this.worker.postMessage({ tipo: "quadro", imagem, t: Math.round(agora), partes: { rosto: cfg.rosto, corpo: cfg.corpo, maos: cfg.maos }, pontosDoRosto: cfg.previa }, [imagem]);
        }).catch(() => { this.ocupado = false; });
      }
      this.pedidoVideo = !!(v && v.requestVideoFrameCallback);
      this.pedido = this.pedidoVideo ? v.requestVideoFrameCallback(() => this.bombear()) : requestAnimationFrame(() => this.bombear());
    }

    /** Um resultado do Worker (ou de um teste): pontos → rotações dos ossos e expressões. */
    processar(r) {
      const agora = performance.now();
      const m = this.medida;
      if (m.ultimo) m.intervalo = m.intervalo ? m.intervalo * 0.7 + (agora - m.ultimo) * 0.3 : agora - m.ultimo;
      m.ultimo = agora;
      m.quadros++;
      m.ms = m.ms ? m.ms * 0.9 + (r.ms || 0) * 0.1 : r.ms || 0;
      if (agora - m.desde > 1000) { m.fps = Math.round(m.quadros * 1000 / (agora - m.desde)); m.quadros = 0; m.desde = agora; }
      if (this.palco && this.palco.vrm) {
        if (r.corpo) { this.resolverCorpo(r.corpo); this.visto.corpo = agora; }
        if (r.maos && r.maos.length) { this.resolverMaos(r.maos, r.corpo); this.visto.maos = agora; }
        if (r.rosto) { this.resolverRosto(r.rosto); this.visto.rosto = agora; }
      }
      this.achados = { rosto: !!r.rosto, corpo: !!r.corpo, maos: (r.maos || []).length };
      if (this.rotulo) this.rotulo.textContent = `${m.fps || "…"} qps` + (r.rosto ? " · rosto" : "") + (r.corpo ? " · corpo" : "") + (r.maos && r.maos.length ? ` · ${r.maos.length} mão${r.maos.length > 1 ? "s" : ""}` : "");
      this.desenharPrevia(r);
    }
    definir(nome, q, peso) {
      let a = this.alvos.get(nome);
      if (!a) { a = { q: new window.THREE.Quaternion(), peso: 0, t: 0 }; this.alvos.set(nome, a); }
      a.q.copy(q);
      a.peso = peso;
      a.t = performance.now();
    }

    // ── corpo ───────────────────────────────────────────────────────
    resolverCorpo(corpo) {
      const T = window.THREE, cfg = this.cfg, palco = this.palco, agora = performance.now();
      const esp = !!cfg.espelhar;
      // pontos no espaço canônico (x: esquerda da personagem, y: para cima, z: para a frente dela)
      const P = [], V = [];
      for (let i = 0; i < 33; i++) {
        const m = corpo.mundo[esp ? outroLado(i) : i];
        P.push(new T.Vector3(esp ? -m[0] : m[0], -m[1], -m[2]));
        V.push(degrau(0.2, 0.5, m[3]));
      }
      const meio = (a, b) => new T.Vector3().addVectors(P[a], P[b]).multiplyScalar(0.5);
      const dir = (a, b) => new T.Vector3().subVectors(b, a).normalize();
      const X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
      const quadro = (x, y) => { // rotação cujo eixo Y é y e cujo eixo X é x (endireitado)
        const yy = y.clone().normalize(), xx = x.clone().addScaledVector(yy, -x.dot(yy)).normalize(), zz = new T.Vector3().crossVectors(xx, yy);
        return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(xx, yy, zz));
      };
      // ── tronco: a coluna vai do meio do quadril ao meio dos ombros; os ombros dão o giro
      const visQuadril = Math.min(V[23], V[24]), visOmbros = Math.min(V[11], V[12]);
      if (visOmbros < 0.2) return;
      const meioO = meio(11, 12), meioQ = meio(23, 24);
      // sem o quadril à vista (sentado à mesa), a coluna fica quase em pé
      const cima = dir(meioQ, meioO).lerp(Y, 1 - (0.35 + 0.65 * visQuadril)).normalize();
      const linhaOmbros = dir(P[12], P[11]);
      const Rpeito = quadro(linhaOmbros, cima);
      // corpo inteiro: só com o quadril e pelo menos uma perna inteira à vista (sentado à mesa, as pernas são chute)
      const corpoInteiro = cfg.pernas && visQuadril > 0.5 && Math.max(Math.min(V[25], V[27]), Math.min(V[26], V[28])) > 0.5;
      const Rquadril = corpoInteiro ? quadro(dir(P[24], P[23]), cima) : new T.Quaternion();
      if (corpoInteiro) this.definir("hips", Rquadril, visQuadril);
      const total = Rquadril.clone().invert().multiply(Rpeito);
      const partes = ["spine", "chest", "upperChest"].filter((n) => palco.nos[n]);
      const fatia = new T.Quaternion().slerp(total, 1 / Math.max(1, partes.length));
      for (const n of partes) this.definir(n, fatia, visOmbros);
      const RpeitoInv = Rpeito.clone().invert();
      // um ombro mais alto que o outro (sem o tronco inclinar): vai para os ossos dos ombros
      const inclinacao = Math.asin(limitar(linhaOmbros.dot(new T.Vector3(0, 1, 0).applyQuaternion(Rpeito)), -1, 1));

      // ── braços: mira (para a junta seguinte) e polo (o lado para onde o cotovelo dobra)
      const membro = (lado, a0, p0, dU, dL, RpaiPadrao) => {
        const perp = dL.clone().addScaledVector(dU, -dL.dot(dU)), dobra = perp.length();
        // esticado, o polo vem do quadro anterior (ou do menor giro a partir da pose em T)
        let reserva = this.polo[lado] ? this.polo[lado].clone() : p0.clone().applyQuaternion(RpaiPadrao);
        reserva.addScaledVector(dU, -reserva.dot(dU));
        if (reserva.lengthSq() < 1e-6) reserva = p0.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(a0, dU));
        reserva.normalize();
        const polo = dobra > 1e-4 ? reserva.clone().lerp(perp.multiplyScalar(1 / dobra), degrau(0.1, 0.38, dobra)).normalize() : reserva;
        this.polo[lado] = polo.clone();
        const de = new T.Matrix4().makeBasis(a0, p0, new T.Vector3().crossVectors(a0, p0));
        const para = new T.Matrix4().makeBasis(dU, polo, new T.Vector3().crossVectors(dU, polo));
        const Rcima = new T.Quaternion().setFromRotationMatrix(para.multiply(de.transpose()));
        const baixoLocal = new T.Quaternion().setFromUnitVectors(a0, dL.clone().applyQuaternion(Rcima.clone().invert()).normalize());
        return { Rcima, baixoLocal, Rbaixo: Rcima.clone().multiply(baixoLocal) };
      };
      for (const [l, s, iO, iC, iP] of [["left", 1, 11, 13, 15], ["right", -1, 12, 14, 16]]) {
        const peso = Math.min(V[iO], V[iC]), pesoAnte = Math.min(peso, V[iP]);
        if (peso < 0.02) continue;
        const a0 = new T.Vector3(s, 0, 0);
        const dU = dir(P[iO], P[iC]), dL = dir(P[iC], P[iP]);
        // o ombro sobe junto quando o braço passa da horizontal
        const elevacao = Math.asin(limitar(dU.clone().applyQuaternion(RpeitoInv).y, -1, 1));
        const subir = limitar(0.35 * Math.max(0, elevacao) + 0.6 * inclinacao * s, -0.25, 0.5);
        const qOmbro = new T.Quaternion().setFromAxisAngle(Z, subir * s);
        const Rombro = Rpeito.clone().multiply(qOmbro);
        const { Rcima, baixoLocal, Rbaixo } = membro(l + "Arm", a0, Z, dU, dL, Rombro);
        if (palco.nos[l + "Shoulder"]) this.definir(l + "Shoulder", qOmbro, peso);
        this.definir(l + "UpperArm", (palco.nos[l + "Shoulder"] ? Rombro : Rpeito).clone().invert().multiply(Rcima), peso);
        this.definir(l + "LowerArm", baixoLocal, pesoAnte);
        this.antebraco[l] = { q: Rbaixo, t: agora, peso: pesoAnte };
        // pulso pelos pontos do corpo (grosseiro): só quando a mão não está sendo rastreada de perto
        if (!(cfg.maos && agora - (this.maoVista[l] || 0) < 500)) {
          const iMin = iP + 2, iInd = iP + 4, pesoMao = pesoAnte * Math.min(V[iMin], V[iInd]) * 0.7;
          const Rmao = this.rotacaoDaMao(s, dir(P[iP], meio(iMin, iInd)), new T.Vector3().subVectors(P[iInd], P[iMin]));
          if (Rmao && pesoMao > 0.02) {
            const local = Rbaixo.clone().invert().multiply(Rmao);
            const angulo = 2 * Math.acos(limitar(Math.abs(local.w), 0, 1));
            if (angulo > 1.1) local.slerp(new T.Quaternion(), 1 - 1.1 / angulo); // os pontos do corpo erram muito a mão
            this.definir(l + "Hand", local, pesoMao);
          }
        }
      }

      // ── cabeça pelos pontos do corpo (nariz e orelhas), quando o rosto não está sendo rastreado
      if (!(cfg.rosto && agora - this.visto.rosto < 500) && Math.min(V[7], V[8], V[0]) > 0.3) {
        const lado = dir(P[8], P[7]), frente = dir(meio(7, 8), P[0]);
        const cimaCab = new T.Vector3().crossVectors(frente, lado);
        if (cimaCab.lengthSq() > 1e-4) {
          const R = quadro(lado, cimaCab).multiply(new T.Quaternion().setFromAxisAngle(X, -0.35)); // o nariz fica abaixo da linha das orelhas
          this.cabeca(RpeitoInv.clone().multiply(R), Math.min(V[7], V[8]) * 0.8);
        }
      }
      this.peito = { q: Rpeito, t: agora };

      // ── pernas (corpo inteiro na câmera)
      if (corpoInteiro) {
        const tras = new T.Vector3(0, 0, -1), baixo = new T.Vector3(0, -1, 0);
        const RquadrilInv = Rquadril.clone().invert();
        for (const [l, iQ, iJ, iT, iD] of [["left", 23, 25, 27, 31], ["right", 24, 26, 28, 32]]) {
          const peso = Math.min(V[iQ], V[iJ]), pesoCanela = Math.min(peso, V[iT]);
          if (peso < 0.02) continue;
          // a profundidade das pernas é a parte mais incerta de uma câmera só: vale pela metade
          const raso = (a, b) => { const d = new T.Vector3().subVectors(b, a); d.z *= 0.5; return d.normalize(); };
          const dU = raso(P[iQ], P[iJ]), dL = raso(P[iJ], P[iT]);
          const { Rcima, baixoLocal, Rbaixo } = membro(l + "Leg", baixo, tras, dU, dL, Rquadril);
          this.definir(l + "UpperLeg", RquadrilInv.clone().multiply(Rcima), peso);
          this.definir(l + "LowerLeg", baixoLocal, pesoCanela);
          if (palco.nos[l + "Foot"]) {
            const alvo = dir(P[iT], P[iD]).applyQuaternion(Rbaixo.clone().invert());
            const q = new T.Quaternion().setFromUnitVectors(palco.direcaoDescanso(l + "Foot"), alvo);
            const angulo = 2 * Math.acos(limitar(Math.abs(q.w), 0, 1));
            if (angulo > 0.9) q.slerp(new T.Quaternion(), 1 - 0.9 / angulo);
            this.definir(l + "Foot", q, pesoCanela * V[iD]);
          }
        }
      }
    }
    /** Rotação (mundo canônico) de uma mão: dedos apontando para `dedos`, do mindinho para o indicador em `largura`. */
    rotacaoDaMao(s, dedos, largura) {
      const T = window.THREE;
      const c = largura.clone().addScaledVector(dedos, -largura.dot(dedos));
      if (c.lengthSq() < 1e-8) return null;
      c.normalize();
      const a0 = new T.Vector3(s, 0, 0), c0 = new T.Vector3(0, 0, 1); // na pose em T os polegares apontam para a frente
      const de = new T.Matrix4().makeBasis(a0, c0, new T.Vector3().crossVectors(a0, c0));
      const para = new T.Matrix4().makeBasis(dedos, c, new T.Vector3().crossVectors(dedos, c));
      return new T.Quaternion().setFromRotationMatrix(para.multiply(de.transpose()));
    }
    /** Divide a rotação da cabeça (em relação ao peito) entre o pescoço e a cabeça. */
    cabeca(local, peso) {
      const T = window.THREE;
      this.cabecaCrua = local.clone();
      if (this.calibre) local = local.clone().multiply(this.calibre);
      const pescoco = new T.Quaternion().slerp(local, 0.4);
      this.definir("neck", pescoco, peso);
      this.definir("head", pescoco.clone().invert().multiply(local), peso);
    }
    /** "Estou olhando para a tela": a posição da cabeça de agora passa a ser a neutra. */
    calibrar() {
      if (!this.cabecaCrua) return false;
      this.calibre = this.cabecaCrua.clone().invert();
      return true;
    }

    // ── mãos e dedos ────────────────────────────────────────────────
    resolverMaos(maos, corpo) {
      const T = window.THREE, cfg = this.cfg, palco = this.palco, agora = performance.now(), esp = !!cfg.espelhar;
      // de quem é cada mão: a do pulso mais perto (na imagem). Quando os dois pulsos ficam quase à mesma distância (mãos
      // juntas) ou o corpo não está sendo rastreado, vale o lado que o MediaPipe diz ("Left" = a mão esquerda da pessoa)
      const lados = maos.map((m) => {
        const rotulo = m.lado === "Left" ? "left" : "right";
        if (corpo) {
          const w = m.imagem[0], d = (i) => Math.hypot(w[0] - corpo.imagem[i][0], w[1] - corpo.imagem[i][1]);
          const custo = Math.min(d(15), d(16)), outro = Math.max(d(15), d(16));
          return { pessoa: custo < outro * 0.6 ? (d(15) <= d(16) ? "left" : "right") : rotulo, custo, outro };
        }
        return { pessoa: rotulo, custo: 0, outro: 1 };
      });
      if (maos.length === 2 && lados[0].pessoa === lados[1].pessoa) { // as duas no mesmo pulso: a mais longe troca
        const i = lados[0].outro - lados[0].custo < lados[1].outro - lados[1].custo ? 0 : 1;
        lados[i].pessoa = lados[i].pessoa === "left" ? "right" : "left";
      }
      const baixo = new T.Vector3(0, -1, 0); // as palmas olham para baixo na pose em T
      maos.forEach((m, k) => {
        const pessoa = lados[k].pessoa;
        if (corpo && lados[k].custo > 0.3 && !(maos.length === 2)) return; // longe demais de qualquer pulso
        const l = esp ? (pessoa === "left" ? "right" : "left") : pessoa, s = l === "left" ? 1 : -1;
        const H = m.mundo.map((p) => new T.Vector3(esp ? -p[0] : p[0], -p[1], -p[2]));
        const dir = (a, b) => new T.Vector3().subVectors(H[b], H[a]).normalize();
        const Rmao = this.rotacaoDaMao(s, dir(0, 9), new T.Vector3().subVectors(H[5], H[17]));
        if (!Rmao) return;
        this.maoVista[l] = agora;
        // pulso: em relação ao antebraço (do corpo); metade da torção vai para o antebraço, como no braço de verdade
        const ante = this.antebraco[l];
        if (ante && agora - ante.t < 500) {
          const local = ante.q.clone().invert().multiply(Rmao);
          const torcao = new T.Quaternion(local.x, 0, 0, local.w);
          if (torcao.lengthSq() > 1e-8) {
            torcao.normalize();
            const metade = new T.Quaternion().slerp(torcao, 0.5);
            const alvoAnte = this.alvos.get(l + "LowerArm");
            if (alvoAnte && agora - alvoAnte.t < 100) { alvoAnte.q.multiply(metade); local.premultiply(metade.clone().invert()); }
          }
          this.definir(l + "Hand", local, 1);
        }
        // dedos: cada falange aponta para o ponto seguinte; as do meio e da ponta só dobram (dobradiça)
        for (const [dedo, pts] of Object.entries(PONTOS_DEDO)) {
          const ossos = dedo === "Thumb" ? ["Metacarpal", "Proximal", "Distal"] : ["Proximal", "Intermediate", "Distal"];
          const Rpai = Rmao.clone();
          let anterior = null;
          ossos.forEach((parte, i) => {
            const nome = l + dedo + parte;
            if (!palco.nos[nome]) return;
            const descanso = palco.direcaoDescanso(nome);
            if (/Distal$/.test(nome) && anterior) descanso.copy(anterior); // a ponta segue a direção da falange do meio
            anterior = descanso.clone();
            const alvo = dir(pts[i], pts[i + 1]).applyQuaternion(Rpai.clone().invert()).normalize();
            let q;
            if (dedo !== "Thumb" && i > 0) {
              const eixo = new T.Vector3().crossVectors(descanso, baixo).normalize();
              const sinal = Math.sign(new T.Vector3().crossVectors(descanso, alvo).dot(eixo)) || 1;
              q = new T.Quaternion().setFromAxisAngle(eixo, limitar(descanso.angleTo(alvo) * sinal, -0.1, 1.9));
            } else {
              q = new T.Quaternion().setFromUnitVectors(descanso, alvo);
              const angulo = 2 * Math.acos(limitar(Math.abs(q.w), 0, 1));
              if (angulo > 1.7) q.slerp(new T.Quaternion(), 1 - 1.7 / angulo);
            }
            this.definir(nome, q, 1);
            Rpai.multiply(q);
          });
        }
      });
    }

    // ── rosto: cabeça, olhos e expressões ───────────────────────────
    resolverRosto(rosto) {
      const T = window.THREE, cfg = this.cfg, agora = performance.now(), esp = !!cfg.espelhar;
      const formas = rosto.formas || {};
      // com o espelho, a esquerda de quem está na câmera comanda a direita da personagem
      const f = (n) => formas[n] || 0;
      const E = (n) => f(n + (esp ? "Right" : "Left")), D = (n) => f(n + (esp ? "Left" : "Right"));
      const media = (n) => (f(n + "Left") + f(n + "Right")) / 2;
      // cabeça: a matriz do rosto já vem no espaço da câmera (x para a direita da imagem, y para cima, z para a câmera)
      if (rosto.matriz) {
        const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().fromArray(rosto.matriz));
        if (esp) { q.y = -q.y; q.z = -q.z; }
        const peito = this.peito && agora - this.peito.t < 500 ? this.peito.q : null;
        this.cabeca(peito ? peito.clone().invert().multiply(q) : q, 1);
      }
      const abrir = faixa(f("jawOpen"), 0.04, 0.55), redondo = limitar(Math.max(f("mouthFunnel"), f("mouthPucker")) * 1.3);
      const sorriso = media("mouthSmile"), largo = limitar(media("mouthStretch") * 1.5 + sorriso * 0.5), bico = faixa(f("mouthPucker"), 0.25, 0.85);
      const tristeza = media("mouthFrown"), sobeMeio = f("browInnerUp"), sobeFora = media("browOuterUp"), arregalar = media("eyeWide"), apertar = media("eyeSquint");
      const franzir = media("browDown") * (1 - faixa(sorriso, 0.2, 0.7)); // sorrindo, as sobrancelhas descem sem ser de bravo
      const expr = {
        blinkLeft: faixa(E("eyeBlink"), 0.25, 0.7), blinkRight: faixa(D("eyeBlink"), 0.25, 0.7),
        aa: abrir * (1 - redondo) * (1 - 0.4 * largo), oh: abrir * redondo, ou: bico * (1 - abrir),
        ih: largo * (1 - abrir) * 0.6, ee: largo * abrir * 0.5,
        happy: 0, angry: 0, sad: 0, surprised: 0,
      };
      let morfos = null;
      const palco = this.palco;
      if (palco && palco.morfos.has("Fcl_BRW_Angry")) {
        // modelos do VRoid: sobrancelhas, olhos arregalados e os cantos da boca, sem fechar os olhos (como o "happy" faz)
        morfos = {
          Fcl_BRW_Surprised: faixa(Math.max(sobeMeio, sobeFora), 0.15, 0.8),
          Fcl_BRW_Angry: faixa(franzir, 0.2, 0.8),
          Fcl_BRW_Sorrow: faixa(sobeMeio - sobeFora, 0.15, 0.6) * faixa(tristeza, 0.05, 0.4),
          Fcl_EYE_Surprised: faixa(arregalar, 0.2, 0.8),
          Fcl_EYE_Joy: faixa(apertar * sorriso, 0.3, 0.9) * 0.55, // olhos sorrindo (apertados), sem fechar
          Fcl_MTH_Fun: faixa(sorriso, 0.15, 0.8) * (1 - 0.6 * abrir),
          Fcl_MTH_Angry: faixa(tristeza, 0.2, 0.8),
        };
      } else {
        expr.happy = faixa(sorriso, 0.35, 0.9) * 0.7;
        expr.angry = faixa(franzir, 0.4, 0.9) * (1 - sorriso);
        expr.surprised = faixa((sobeMeio + arregalar) / 2, 0.4, 0.9);
        expr.sad = faixa(tristeza, 0.3, 0.8) * 0.7;
      }
      // olhos: para os lados (positivo = para a esquerda da personagem) e para cima
      let olhar = null;
      if (cfg.olhos) {
        const ladoP = ((f("eyeLookOutLeft") - f("eyeLookInLeft")) + (f("eyeLookInRight") - f("eyeLookOutRight"))) / 2; // para a esquerda de quem está na câmera
        const cima = (media("eyeLookUp") - Math.max(0, media("eyeLookDown") - 0.15));
        olhar = { x: limitar(ladoP * (esp ? -1 : 1), -1, 1) * 0.55, y: limitar(cima, -1, 1) * 0.4 };
      }
      // as 52 formas com os lados trocados (para modelos "perfect sync", com as formas do ARKit)
      let arkit = formas;
      if (esp) { arkit = {}; for (const [n, v] of Object.entries(formas)) arkit[n.endsWith("Left") ? n.slice(0, -4) + "Right" : n.endsWith("Right") ? n.slice(0, -5) + "Left" : n] = v; }
      this.rosto = { expr, morfos, arkit, olhar, t: agora };
    }

    // ── a cada quadro do desenho: suaviza e mistura na pose ─────────
    aplicar(pose, dt) {
      const agora = performance.now();
      const vel = 5 + (1 - limitar(this.cfg.suavizar)) * 30;
      const k = 1 - Math.exp(-dt * vel), kp = 1 - Math.exp(-dt * 6);
      // um resultado vale até chegar o próximo (num aparelho lento eles chegam espaçados), com folga
      const validade = Math.max(700, (this.medida.intervalo || 0) * 2.5);
      for (const [n, a] of this.alvos) {
        let s = this.atual.get(n);
        if (!s) { s = { q: a.q.clone(), peso: 0 }; this.atual.set(n, s); }
        const vivo = agora - a.t < validade;
        if (vivo) s.q.slerp(a.q, s.peso < 0.02 ? 1 : k);
        s.peso += ((vivo ? a.peso : 0) - s.peso) * kp;
        if (s.peso > 0.004 && pose[n]) pose[n].slerp(s.q, Math.min(1, s.peso));
      }
      const peso = (n) => { const s = this.atual.get(n); return s ? s.peso : 0; };
      const info = { cabeca: peso("head") > 0.4, tronco: peso("chest") > 0.4 || peso("spine") > 0.4, bracos: Math.max(peso("leftUpperArm"), peso("rightUpperArm")) > 0.4,
        pernas: Math.min(1, Math.max(peso("leftUpperLeg"), peso("rightUpperLeg"))), rosto: null, olhar: null };
      const r = this.rosto;
      if (r && agora - r.t < validade) {
        // expressões: o piscar e a boca quase na hora; o resto um pouco mais calmo
        let s = this.rostoSuave;
        if (!s) s = this.rostoSuave = { expr: { ...r.expr }, morfos: r.morfos ? { ...r.morfos } : null, olhar: r.olhar ? { ...r.olhar } : null };
        const kr = 1 - Math.exp(-dt * 28), kl = 1 - Math.exp(-dt * 14);
        for (const [n, v] of Object.entries(r.expr)) s.expr[n] = (s.expr[n] || 0) + (v - (s.expr[n] || 0)) * (n.startsWith("blink") ? 1 : kr);
        if (r.morfos) { s.morfos = s.morfos || {}; for (const [n, v] of Object.entries(r.morfos)) s.morfos[n] = (s.morfos[n] || 0) + (v - (s.morfos[n] || 0)) * kl; } else s.morfos = null;
        if (r.olhar) { s.olhar = s.olhar || { x: 0, y: 0 }; s.olhar.x += (r.olhar.x - s.olhar.x) * kr; s.olhar.y += (r.olhar.y - s.olhar.y) * kr; } else s.olhar = null;
        info.rosto = { expr: s.expr, morfos: s.morfos, arkit: r.arkit };
        info.olhar = s.olhar;
      } else this.rostoSuave = null;
      return info;
    }
  }
  C.Captura = Captura;
  C.CAPTURA_PADRAO = PADRAO;
})();
