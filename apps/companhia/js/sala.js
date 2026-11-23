/*
 * Companhia — salas: jogar com outras pessoas no mesmo cenário.
 *
 * O servidor guarda as salas; quem abre a Companhia por ele vê a lista das salas públicas (js/salas.js) e entra, ou
 * cria a sua com as opções (pública ou privada, senha, quantas pessoas, bate-papo, cenário). Criar não precisa da
 * ponte: pelo link isolado do LNUX (só a Companhia), quem chega cria a sala, se o dono do servidor deixar. O link
 * de uma sala só dá acesso a ela, nunca às pastas do aparelho. Para valer pela internet, o servidor precisa estar
 * num endereço que os outros alcancem (o túnel do LNUX, ou a rede de casa).
 *
 * Cada pessoa anda com a própria personagem; os outros a veem andar, correr, pular, acenar, mudar de expressão e,
 * com a captura de movimento ligada, mexer os braços, as mãos e o rosto. A aparência vai junto e se atualiza na
 * hora: o tamanho e as proporções (Ajustar esqueleto), os braços, as correções dos ossos, as peças escondidas, as
 * texturas trocadas e a roupa vestida. Há um bate-papo por texto, com balão em
 * cima da cabeça. Não há chat bot nem nenhuma função de IA neste modo.
 *
 * Como funciona: a sala fica na memória do servidor (servidor/lnux_apps.py, /api/sala). Umas 8 vezes por segundo
 * cada navegador manda onde a sua personagem está e recebe onde estão as outras; entre um aviso e outro, as
 * personagens dos outros são levadas suavemente até o lugar novo. O cenário (.glb) e os avatares (.vrm) passam
 * pelo servidor da sala uma vez. Enquanto a personagem de alguém não chega, ela aparece como um boneco simples.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const arred = (v) => Math.round(v * 1000) / 1000;
  const CORES = [0x4f8ef7, 0xf2647a, 0x38c793, 0xf5a623, 0x9b6cf2, 0x2bc4d6, 0xe8704f, 0x8bc34a];
  /** Emoção → expressões do VRM (as mesmas do palco). */
  const ROSTO = { feliz: { happy: 0.8 }, rindo: { happy: 1, aa: 0.35 }, triste: { sad: 0.85 }, brava: { angry: 0.9 }, surpresa: { surprised: 0.9 }, apaixonada: { happy: 0.6, relaxed: 0.5 }, sonolenta: { relaxed: 0.6, blink: 0.45 },
    pensativa: { relaxed: 0.3 }, provocadora: { happy: 0.55, blinkLeft: 0.9 }, timida: { happy: 0.35, relaxed: 0.45 }, animada: { happy: 1, surprised: 0.2 }, confusa: { surprised: 0.35, sad: 0.25 } };
  /** O relógio da sala (em segundos): o do servidor, para quem está numa sala; senão, o deste aparelho. As animações dos
   *  mapas usam este relógio: todos na sala veem o moinho na mesma posição. */
  let relogioDe = null;
  C.relogioDaSala = () => Date.now() / 1000 + (relogioDe && relogioDe.dentro && relogioDe.desvio !== undefined ? relogioDe.desvio : 0);
  const PRESETS_ROSTO = ["happy", "sad", "angry", "relaxed", "surprised", "aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight"];

  /** Pede à sala (o código da sala é o que dá acesso; a chave da ponte só vai se houver: é o dono do servidor). */
  /**
   * Um pedido ao servidor da sala. tempo: desiste depois de tantos ms (uma resposta que nunca chega não pode travar a
   * sala para sempre); sinal: o AbortSignal da vez na sala (sair cancela o que ainda estava a caminho). Quem desistiu
   * recebe um erro com .cancelado (e .saiu, se foi porque a pessoa saiu da sala).
   */
  async function pedir(metodo, rota, { json, corpo, como = "json", chave, base = "/api/sala", tempo = 0, sinal = null } = {}) {
    const cabecalhos = {};
    if (json !== undefined) cabecalhos["Content-Type"] = "application/json";
    if (chave) cabecalhos["X-Sala-Chave"] = chave;
    if (LNUX.ponte && LNUX.ponte._token) cabecalhos["X-Ponte-Token"] = LNUX.ponte._token;
    const sessao = C.contas && C.contas.sessao();
    if (sessao) cabecalhos["X-Conta-Sessao"] = sessao; // quem entrou na conta aparece com o nome e o perfil dela
    const controle = new AbortController(), desistir = () => controle.abort();
    const relogio = tempo ? setTimeout(desistir, tempo) : 0;
    if (sinal) { if (sinal.aborted) desistir(); else sinal.addEventListener("abort", desistir, { once: true }); }
    const cancelado = () => Object.assign(new Error(sinal && sinal.aborted ? "Você saiu da sala." : "A sala demorou demais para responder."),
      { cancelado: true, saiu: !!(sinal && sinal.aborted) });
    try {
      let r;
      try { r = await fetch(base + (rota ? "/" + rota : ""), { method: metodo, headers: cabecalhos, body: json !== undefined ? JSON.stringify(json) : corpo, signal: controle.signal }); }
      catch (e) {
        if (controle.signal.aborted) throw cancelado();
        throw new Error("O servidor da sala não respondeu. O link ainda vale? (quem criou a sala precisa estar com ela aberta)");
      }
      if (!r.ok) {
        let msg = "A sala respondeu " + r.status, campo = "";
        try { const j = await r.json(); if (j.erro) msg = j.erro; campo = j.campo || ""; } catch (e) { /* sem corpo */ }
        const erro = new Error(msg);
        erro.status = r.status;
        erro.campo = campo; // "nome": o nome é de uma conta (quem joga sem conta escolhe outro)
        throw erro;
      }
      try { return await (como === "blob" ? r.blob() : r.json()); }
      catch (e) { if (controle.signal.aborted) throw cancelado(); throw e; }
    } finally {
      clearTimeout(relogio);
      if (sinal) sinal.removeEventListener("abort", desistir);
    }
  }
  // quanto esperar os pedidos pequenos antes de desistir (e tentar de novo na próxima volta). Os arquivos (avatar,
  // texturas) não têm limite (num celular lento, um avatar grande leva minutos): só sair da sala os cancela.
  const ESPERA = { estado: 10000, pequeno: 20000 };

  /** Uma placa de texto que sempre olha para a câmera (o nome em cima da cabeça, o balão da fala). */
  function placa(texto, { fundo = "rgba(20,24,36,.78)", cor = "#fff", tamanho = 30, largura = 420, titulo = null } = {}) {
    const T = window.THREE, tela = document.createElement("canvas"), g = tela.getContext("2d");
    if (titulo && titulo.nome) return placaComTitulo(texto, titulo, { fundo, cor, tamanho });
    g.font = `600 ${tamanho}px system-ui, sans-serif`;
    // quebra em linhas
    const palavras = String(texto).split(/\s+/), linhas = [];
    let linha = "";
    for (const p of palavras) { const t = linha ? linha + " " + p : p; if (g.measureText(t).width > largura && linha) { linhas.push(linha); linha = p; } else linha = t; }
    if (linha) linhas.push(linha);
    const w = Math.min(largura, Math.max(...linhas.map((l) => g.measureText(l).width))) + 28, h = linhas.length * (tamanho + 8) + 16;
    tela.width = Math.ceil(w);
    tela.height = Math.ceil(h);
    g.font = `600 ${tamanho}px system-ui, sans-serif`;
    g.fillStyle = fundo;
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, tela.width, tela.height, 14); else g.rect(0, 0, tela.width, tela.height);
    g.fill();
    g.fillStyle = cor;
    g.textBaseline = "top";
    linhas.forEach((l, i) => g.fillText(l, 14, 10 + i * (tamanho + 8), largura));
    const tex = new T.CanvasTexture(tela);
    tex.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.renderOrder = 20;
    s.scale.set(tela.width / 300, tela.height / 300, 1);
    s.userData.alto = tela.height / 300;
    return s;
  }
  /** A placa do nome com o título em cima (um selo na cor dele, como "Admin" ou "Criador"). */
  function placaComTitulo(texto, titulo, { fundo, cor, tamanho }) {
    const T = window.THREE, tela = document.createElement("canvas"), g = tela.getContext("2d");
    const fonteNome = `600 ${tamanho}px system-ui, sans-serif`, fonteTitulo = `800 ${Math.round(tamanho * 0.72)}px system-ui, sans-serif`;
    const nome = String(texto).slice(0, 40), rotulo = String(titulo.nome).slice(0, 20).toUpperCase();
    g.font = fonteNome; const wn = g.measureText(nome).width;
    g.font = fonteTitulo; const wt = g.measureText(rotulo).width;
    const hTitulo = Math.round(tamanho * 0.72) + 12, hNome = tamanho + 18;
    tela.width = Math.ceil(Math.max(wn + 28, wt + 24));
    tela.height = hTitulo + 6 + hNome;
    const caixa = (x, y, w, h, r, c) => { g.fillStyle = c; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); };
    caixa((tela.width - (wt + 24)) / 2, 0, wt + 24, hTitulo, hTitulo / 2, /^#[0-9a-f]{6}$/i.test(titulo.cor || "") ? titulo.cor : "#6b7280");
    g.font = fonteTitulo; g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "center";
    g.fillText(rotulo, tela.width / 2, hTitulo / 2 + 1);
    caixa(0, hTitulo + 6, tela.width, hNome, 14, fundo);
    g.font = fonteNome; g.fillStyle = cor;
    g.fillText(nome, tela.width / 2, hTitulo + 6 + hNome / 2 + 1);
    const tex = new T.CanvasTexture(tela);
    tex.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.renderOrder = 20;
    s.scale.set(tela.width / 300, tela.height / 300, 1);
    s.userData.alto = tela.height / 300;
    return s;
  }
  const soltarPlaca = (s) => { if (s) { if (s.parent) s.parent.remove(s); s.material.map.dispose(); s.material.dispose(); } };

  /** O boneco simples: quem não mandou o avatar (ou enquanto ele carrega). */
  function criarBoneco(cor) {
    const T = window.THREE, g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color: cor, roughness: 0.7 }), claro = new T.MeshStandardMaterial({ color: 0xf2e6da, roughness: 0.8 });
    const parte = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    parte(new T.CapsuleGeometry(0.2, 0.5, 6, 14), mat, 0, 0.95, 0);                 // tronco
    parte(new T.SphereGeometry(0.17, 18, 14), claro, 0, 1.47, 0);                    // cabeça
    parte(new T.BoxGeometry(0.2, 0.05, 0.06), new T.MeshStandardMaterial({ color: 0x1c2233 }), 0, 1.5, 0.15); // "olhos": mostra para onde olha
    const perna = new T.CapsuleGeometry(0.075, 0.42, 4, 10), braco = new T.CapsuleGeometry(0.06, 0.42, 4, 10);
    const membros = { pernaE: parte(perna, mat, 0.1, 0.36, 0), pernaD: parte(perna, mat, -0.1, 0.36, 0), bracoE: parte(braco, claro, 0.29, 0.98, 0), bracoD: parte(braco, claro, -0.29, 0.98, 0) };
    g.userData.membros = membros;
    return g;
  }

  /** Um VRM pronto para receber a pose (o mesmo jeito do palco 3D: pose canônica → ossos, com a conversão do VRM 0.x). */
  async function abrirAvatar(blob, limiteTextura) {
    const T = window.THREE, V = window.CompanhiaVRM;
    const carregador = new V.GLTFLoader();
    carregador.register((parser) => new V.VRMLoaderPlugin(parser));
    const url = URL.createObjectURL(blob);
    let gltf;
    try { gltf = await carregador.loadAsync(url); } finally { URL.revokeObjectURL(url); }
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("O avatar recebido não é um VRM.");
    V.VRMUtils.removeUnnecessaryVertices(gltf.scene);
    if (V.VRMUtils.combineSkeletons) V.VRMUtils.combineSkeletons(gltf.scene);
    const v0 = C.virarDeFrente(vrm, gltf); // de frente, pela geometria (não só pela versão do arquivo)
    vrm.scene.traverse((o) => { o.frustumCulled = false; if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    if (limiteTextura) C.Palco3D.prototype.reduzirTexturas.call({ modelo: vrm.scene, texturas: [] }, limiteTextura); // os avatares dos outros pesam menos
    const nos = {};
    if (vrm.humanoid) { vrm.humanoid.resetNormalizedPose(); for (const n of C.OSSOS_VRM) { const no = vrm.humanoid.getNormalizedBoneNode(n); if (no) nos[n] = no; } }
    const hips = nos.hips ? nos.hips.position.clone() : new T.Vector3(0, 0.9, 0);
    const ausentes = C.OSSOS_VRM.filter((n) => !nos[n]).map((n) => [n, C.OSSOS_VRM.filter((f) => C.PAIS_VRM[f] === n)]).filter(([, f]) => f.length);
    vrm.scene.updateMatrixWorld(true);
    const y = (n, padrao) => { const b = vrm.humanoid && vrm.humanoid.getRawBoneNode(n); return b ? b.getWorldPosition(new T.Vector3()).y : padrao; };
    const altura = Math.max(0.5, y("head", 1.4) - Math.min(y("leftFoot", 0.05), 0.2) + 0.25);
    const expressoes = new Set(vrm.expressionManager ? vrm.expressionManager.expressions.map((e) => e.expressionName) : []);
    // para a aparência: as peças de roupa, o tamanho original dos ossos e onde fica a coxa (para as proporções)
    const brutos = {};
    for (const n of C.OSSOS_VRM) { const b = vrm.humanoid && vrm.humanoid.getRawBoneNode(n); if (b) brutos[n] = b.scale.clone(); }
    const coxa = nos.leftUpperLeg || nos.rightUpperLeg;
    return { vrm, v0, nos, hips, ausentes, altura, expressoes, pecas: C.pecasDoModelo(gltf), brutos, coxaY: coxa ? coxa.position.y : null,
      descanso: null, ajusteQ: new Map(), erguer: 0, escala: 1 };
  }
  /** A aparência que a pessoa mandou, no avatar dela: {ajuste, ocultas: [peça], texturas: {peça: Blob}}. */
  async function aplicarAparencia(av, ap) {
    const pronto = C.prepararAjuste(ap && ap.ajuste);
    av.descanso = pronto.descanso;
    av.ajusteQ = pronto.ajusteQ;
    av.escala = pronto.ajuste.escala.geral;
    av.erguer = C.aplicarProporcoes(av.vrm, pronto.ajuste.escala, av.brutos, Math.max(0.05, av.hips.y), av.coxaY);
    const ocultas = new Set((ap && ap.ocultas) || []), texturas = (ap && ap.texturas) || {};
    for (const peca of av.pecas) {
      C.mostrarPecaEm(peca, !ocultas.has(peca.nome));
      C.voltarTexturaEm(peca);
      if (texturas[peca.nome]) { try { await C.trocarTexturaEm(peca, texturas[peca.nome]); } catch (e) { console.warn("sala: textura de " + peca.nome, e); } }
    }
    const molas = av.vrm.springBoneManager;
    if (molas) { try { molas.reset(); molas.setInitState(); } catch (e) { /* sem molas */ } }
  }
  function gravarPose(av, pose, quadril) {
    const s = av.v0 ? -1 : 1;
    for (const [n, filhos] of av.ausentes) for (const f of filhos) pose[f].premultiply(pose[n]);
    for (const n of C.OSSOS_VRM) { const b = av.nos[n]; if (b) { const q = pose[n]; b.quaternion.set(q.x * s, q.y, q.z * s, q.w); } }
    if (av.nos.hips) av.nos.hips.position.set(av.hips.x + quadril.x * s, av.hips.y + quadril.y + (av.erguer || 0), av.hips.z + quadril.z * s);
  }

  /** A personagem de outra pessoa, no nosso cenário. */
  class Remoto {
    constructor(sala, id, nome) {
      const T = window.THREE;
      this.sala = sala;
      this.id = id;
      this.nome = nome;
      this.grupo = new T.Group();
      this.cor = CORES[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES.length];
      this.boneco = criarBoneco(this.cor);
      this.grupo.add(this.boneco);
      this.altura = 1.65;
      this.rotulo = placa(nome);
      this.grupo.add(this.rotulo);
      this.alvo = new T.Vector3();
      this.rumo = 0;
      this.rumoAlvo = 0;
      this.estado = "parado";
      this.andar = { fase: 0, andar: 0, correr: 0, pulo: 0, subindo: false, altura: 1.5 };
      this.emocao = "neutra";
      this.gestoVisto = null;    // o número do último gesto dela que já vi (null: ainda não vi nenhum estado)
      this.acenar = 0;           // quando começou o aceno (s)
      this.avatar = null;        // {vrm, ...} quando o VRM dela chegou
      this.avatarVersao = 0;
      this.aparencia = null;     // {ajuste, ocultas, texturas: {peça: Blob}}: como ela deixou a personagem
      this.aparenciaVersao = 0;
      this.texturas = new Map(); // n → Blob (as texturas dela que já baixei)
      this.video = null;         // o vídeo que ela pôs na tela: {url, modo, pos, rumo, tamanho, inicio, pausado, n, desvio} (js/video.js mostra)
      this.videoVersao = 0;
      this.pose = {};
      for (const n of C.OSSOS_VRM) this.pose[n] = new T.Quaternion();
      this.poseRecebida = null;  // captura de movimento dela: {osso: Quaternion}
      this.poseSuave = {};
      this.rostoRecebido = null;
      this.quadril = new T.Vector3();
      this.piscar = performance.now() + 1500 + Math.random() * 3000;
      this.primeiro = true;
      this.posicionarPlacas();
      sala.palco.cena.add(this.grupo);
    }
    posicionarPlacas() {
      this.rotulo.position.set(0, this.altura + 0.16, 0);
      if (this.balao) this.balao.position.set(0, this.altura + 0.3 + this.balao.userData.alto / 2, 0);
    }
    /** O que o servidor disse dela agora. */
    receber(j) {
      const T = window.THREE, e = j.estado || {};
      // a placa com o nome (e o primeiro título, como "Admin", na cor dele)
      const titulo = (j.titulos || [])[0] || null, chaveTitulo = titulo ? titulo.nome + titulo.cor : "";
      this.titulos = j.titulos || [];
      if (j.nome !== this.nome || chaveTitulo !== this.chaveTitulo) {
        this.nome = j.nome; this.chaveTitulo = chaveTitulo;
        soltarPlaca(this.rotulo); this.rotulo = placa(j.nome, { titulo }); this.grupo.add(this.rotulo); this.posicionarPlacas();
      }
      if (Array.isArray(e.p)) this.alvo.set(e.p[0], e.p[1], e.p[2]);
      if (this.primeiro) { this.grupo.position.copy(this.alvo); this.rumo = e.r || 0; this.primeiro = false; }
      this.rumoAlvo = e.r || 0;
      this.giroCam = typeof e.c === "number" ? e.c : null;
      this.estado = e.e || "parado";
      this.emocao = e.emo || "neutra";
      if (Array.isArray(e.g) && e.g[0] !== this.gestoVisto) { // um gesto novo (o que já tinha acontecido antes de eu chegar não repete)
        if (this.gestoVisto !== null && e.g[1] === "acenar") this.acenar = performance.now() / 1000;
        this.gestoVisto = e.g[0];
      }
      if (e.pose) {
        this.poseRecebida = this.poseRecebida || {};
        for (const n of Object.keys(this.poseRecebida)) if (!e.pose[n]) delete this.poseRecebida[n];
        for (const [n, q] of Object.entries(e.pose)) { if (!this.pose[n] || !Array.isArray(q)) continue; (this.poseRecebida[n] = this.poseRecebida[n] || new T.Quaternion()).set(q[0], q[1], q[2], q[3]).normalize(); }
      } else this.poseRecebida = null;
      this.rostoRecebido = e.rosto || null;
      this.olharCabeca = typeof e.o === "number" ? e.o : 0;
      this.quadrilRecebido = Array.isArray(e.qd) ? e.qd : null; // boneco de pano
      if (j.avatar !== this.avatarVersao) { this.avatarVersao = j.avatar; this.buscarAvatar(); }
      if ((j.aparencia || 0) !== this.aparenciaVersao) { this.aparenciaVersao = j.aparencia || 0; this.buscarAparencia(); }
      if ((j.video || 0) !== this.videoVersao) { this.videoVersao = j.video || 0; this.buscarVideo(); }
      if ((j.item || 0) !== this.itemVersao) { this.itemVersao = j.item || 0; this.buscarItem(); }
      this.itemEstado = e.it && typeof e.it === "object" ? e.it : null;
      this.conta = j.conta || null;
    }
    /** O vídeo dela mudou (abriu, pausou, pulou, mudou a tela de lugar, fechou). desvio: o relógio do servidor menos o meu. */
    async buscarVideo() {
      const versao = this.videoVersao;
      if (!versao) { this.video = null; return; }
      try {
        const v = await pedir("GET", `${this.sala.codigo}/video/${this.id}?v=${versao}`, { tempo: ESPERA.pequeno, sinal: this.sala.sinal() });
        if (versao === this.videoVersao) this.video = { ...v, desvio: v.agora - Date.now() / 1000 };
      } catch (e) { if (versao === this.videoVersao) this.video = null; }
    }
    /** O item dela (do Estúdio de itens): baixa o .glb uma vez por versão e monta (a ficha é conferida em C.abrirItem). */
    async buscarItem() {
      const versao = this.itemVersao;
      if (!versao || !C.abrirItem) return;
      try {
        const blob = await pedir("GET", `${this.sala.codigo}/item/${this.id}?v=${versao}`, { como: "blob", sinal: this.sala.sinal() });
        const { def, malhas, animacoes } = await C.abrirItem(blob);
        if (versao !== this.itemVersao) return;
        if (this.item) this.item.descartar();
        this.itemNos = null;
        const palco = this.sala.palco;
        this.item = new C.ItemVivo(def, malhas, animacoes, { cena: palco.cena, colisor: () => palco.mundo && palco.mundo.colisor, outros: () => [], reduzir: "reduzir" in document.documentElement.dataset });
        this.itemEncaixe = null;
        this.itemUsos = null;
      } catch (e) { if (!e.saiu) console.warn("sala: o item de " + this.nome + " não chegou", e); }
    }
    /** Põe o item dela no corpo dela e repete o que ela faz com ele (as luzes, os usos e a mira). */
    atualizarItem(dt) {
      const it = this.item, e = this.itemEstado, av = this.avatar;
      if (!it) return;
      const mostrar = !!(e && e.on && av);
      it.raiz.visible = mostrar;
      if (!e || !av) { it.atualizar(dt); return; }
      if (e.aj) { const k = JSON.stringify(e.aj); if (k !== this.itemEncaixe) { this.itemEncaixe = k; it.aplicarEncaixe(C.limparItem({ encaixe: e.aj }).encaixe); this.itemNos = null; } }
      if (this.itemNos !== av.nos) { C.encaixarItem(it, av.nos, !!av.v0); this.itemNos = av.nos; } // o osso pode ter mudado (outro encaixe, outro avatar)
      if (Array.isArray(e.lz)) it.definirLuzes(e.lz);
      const u = Array.isArray(e.u) ? e.u : [0];
      if (this.itemUsos === null) this.itemUsos = u[0]; // o que ela usou antes de eu chegar não repete
      else if (u[0] > this.itemUsos) {
        this.itemUsos = u[0];
        const T = window.THREE, mira = u.length >= 4 ? new T.Vector3(u[1], u[2], u[3]) : null;
        // as luzes que alternam já vêm em "lz": aqui só as rajadas, as animações e os disparos
        const luzes = it.luzesLigadas;
        it.usar(mira);
        it.definirLuzes(luzes);
        if (it.temLancador) this.mirarAte = performance.now() + 900;
      }
      if (!e.s) it.soltarUso();
      else if (u.length >= 4) it.mira = new window.THREE.Vector3(u[1], u[2], u[3]);
      it.atualizar(dt);
    }
    async buscarAparencia() {
      const versao = this.aparenciaVersao;
      if (!versao) return;
      try {
        const ap = await pedir("GET", `${this.sala.codigo}/aparencia/${this.id}?v=${versao}`, { tempo: ESPERA.pequeno, sinal: this.sala.sinal() });
        const texturas = {};
        for (const [peca, n] of Object.entries(ap.texturas || {})) {
          if (!this.texturas.has(n)) this.texturas.set(n, await pedir("GET", `${this.sala.codigo}/textura/${this.id}/${n}`, { como: "blob", sinal: this.sala.sinal() }));
          texturas[peca] = this.texturas.get(n);
        }
        if (versao !== this.aparenciaVersao) return;
        this.aparencia = { ajuste: ap.ajuste || null, ocultas: ap.ocultas || [], texturas };
        if (this.avatar) { await aplicarAparencia(this.avatar, this.aparencia); this.medirAltura(); }
      } catch (e) { if (!e.saiu) console.warn("sala: a aparência de " + this.nome + " não chegou", e); }
    }
    medirAltura() {
      const av = this.avatar;
      this.altura = av ? av.altura * (av.escala || 1) + (av.erguer || 0) * (av.escala || 1) : 1.65;
      this.posicionarPlacas();
    }
    async buscarAvatar() {
      const versao = this.avatarVersao;
      if (!versao) { this.trocarAvatar(null); return; }
      try {
        const blob = await pedir("GET", `${this.sala.codigo}/avatar/${this.id}?v=${versao}`, { como: "blob", sinal: this.sala.sinal() });
        const av = await abrirAvatar(blob, 1024);
        if (versao !== this.avatarVersao || !this.grupo.parent) { window.CompanhiaVRM.VRMUtils.deepDispose(av.vrm.scene); return; }
        if (this.aparencia) await aplicarAparencia(av, this.aparencia);
        this.trocarAvatar(av);
      } catch (e) { if (!e.saiu) console.warn("sala: o avatar de " + this.nome + " não abriu", e); }
    }
    trocarAvatar(av) {
      if (this.item) { C.desencaixarItem(this.item); this.itemNos = null; } // o item não vai embora junto com o avatar velho
      if (this.avatar) { this.grupo.remove(this.avatar.vrm.scene); try { window.CompanhiaVRM.VRMUtils.deepDispose(this.avatar.vrm.scene); } catch (e) { /* já foi */ } }
      this.avatar = av;
      this.boneco.visible = !av;
      if (av) this.grupo.add(av.vrm.scene);
      this.medirAltura();
    }
    falar(texto) {
      soltarPlaca(this.balao);
      this.balao = placa(texto, { fundo: "rgba(255,255,255,.94)", cor: "#1b2030", tamanho: 28 });
      this.grupo.add(this.balao);
      this.balaoAte = performance.now() + 4000 + Math.min(6000, texto.length * 70);
      this.posicionarPlacas();
    }
    atualizar(dt) {
      const agora = performance.now(), t = agora / 1000, g = this.grupo, a = this.andar;
      // chega suavemente aonde o servidor disse (longe demais: pula direto)
      const d = g.position.distanceTo(this.alvo);
      if (d > 6) g.position.copy(this.alvo); else g.position.lerp(this.alvo, 1 - Math.exp(-dt * 10));
      let dr = this.rumoAlvo - this.rumo;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      this.rumo += dr * (1 - Math.exp(-dt * 10));
      g.rotation.y = this.rumo;
      const k = 1 - Math.exp(-dt * 10), anda = this.estado === "andando" || this.estado === "correndo";
      a.andar += ((anda ? 1 : 0) - a.andar) * k;
      a.correr += ((this.estado === "correndo" ? 1 : 0) - a.correr) * k;
      a.pulo += ((this.estado === "pulando" ? 1 : 0) - a.pulo) * k;
      a.fase += dt * (5.6 + 3.6 * a.correr);
      a.altura = this.altura;
      if (this.balao && agora > this.balaoAte) { soltarPlaca(this.balao); this.balao = null; }
      const aceno = this.acenar ? (t - this.acenar) / 1.8 : 2, env = aceno < 1 ? Math.sin(Math.PI * aceno) : 0;
      if (!this.avatar) {
        // boneco: pernas e braços balançam; o aceno levanta um braço
        const m = this.boneco.userData.membros, s = Math.sin(a.fase) * (0.5 + 0.4 * a.correr) * a.andar;
        m.pernaE.rotation.x = -s; m.pernaD.rotation.x = s; m.bracoE.rotation.x = s; m.bracoD.rotation.x = -s;
        m.bracoD.rotation.z = -2.6 * env + Math.sin(t * 12) * 0.25 * env;
        m.bracoD.position.y = 0.98 + 0.28 * env;
        this.boneco.position.y = Math.abs(Math.sin(a.fase)) * 0.03 * a.andar;
        return;
      }
      // avatar VRM: descanso → andar → captura dela → aceno → ossos
      const av = this.avatar, pose = this.pose, T = window.THREE;
      const descanso = av.descanso || this.sala.descanso;
      for (const n of C.OSSOS_VRM) { if (descanso[n]) pose[n].copy(descanso[n]); else pose[n].identity(); }
      this.quadril.set(0, 0, 0);
      if (this.quadrilRecebido) this.quadril.set(this.quadrilRecebido[0], this.quadrilRecebido[1], this.quadrilRecebido[2]).multiplyScalar(av.hips.y || 1); // caída (boneco de pano)
      else C.poseDeAndar(pose, this.quadril, a, 1);
      if (this.olharCabeca && !(this.poseRecebida && this.poseRecebida.head)) { // em primeira pessoa: a cabeça dela segue o olhar
        const q = (this._qo = this._qo || new T.Quaternion()), e = (this._eo = this._eo || new T.Euler()), o = this.olharCabeca;
        pose.chest.multiply(q.setFromEuler(e.set(o * 0.15, 0, 0)));
        pose.neck.multiply(q.setFromEuler(e.set(o * 0.35, 0, 0)));
        pose.head.multiply(q.setFromEuler(e.set(o * 0.5, 0, 0)));
      }
      if (this.poseRecebida) for (const [n, q] of Object.entries(this.poseRecebida)) { const s = (this.poseSuave[n] = this.poseSuave[n] || q.clone()); s.slerp(q, 1 - Math.exp(-dt * 14)); pose[n].copy(s); }
      if (env > 0 && !(this.poseRecebida && this.poseRecebida.rightUpperArm)) {
        const q = (this._q = this._q || new T.Quaternion()), q2 = (this._q2 = this._q2 || new T.Quaternion()), e = (this._e = this._e || new T.Euler());
        pose.rightUpperArm.slerp(q.setFromEuler(e.set(0, 0, -0.5)), env);
        q.setFromEuler(e.set(0, 0, -1.07 + Math.sin(aceno * Math.PI * 6) * 0.35)).multiply(q2.setFromEuler(e.set(-0.8, 0, 0)));
        pose.rightLowerArm.slerp(q, env);
      }
      const eIt = this.itemEstado;
      if (this.item && eIt && eIt.on && eIt.aj && !(this.poseRecebida && this.poseRecebida[eIt.aj.osso === "leftHand" ? "leftIndexProximal" : "rightIndexProximal"]))
        C.poseDeSegurar(pose, eIt.aj.osso, Math.max(0, Math.min(1, ((this.mirarAte || 0) - agora) / 300)));
      for (const [n, q] of av.ajusteQ) if (pose[n]) pose[n].premultiply(q); // as correções dos ossos que ela fez
      gravarPose(av, pose, this.quadril);
      // os pés dela no chão do nosso cenário (IK das pernas), como os nossos
      const mundo = this.sala.palco && this.sala.palco.mundo;
      if (C.ikDosPes && mundo) {
        this._frente = (this._frente || new T.Vector3()).set(Math.sin(this.rumo), 0, Math.cos(this.rumo));
        this.ik = C.ikDosPes(av.vrm, { colisor: mundo.colisor, base: g.position, frente: this._frente, dt, estado: (this.estadoIk = this.estadoIk || {}),
          ativo: mundo.cfg.ik !== false && this.estado !== "pulando" && this.estado !== "voando" && !(this.poseRecebida && this.poseRecebida.leftUpperLeg) });
      }
      // rosto: a emoção, a captura dela e o piscar
      const em = av.vrm.expressionManager;
      if (em) {
        const alvo = { ...(ROSTO[this.emocao] || {}) };
        if (this.rostoRecebido) for (const [n, v] of Object.entries(this.rostoRecebido)) alvo[n] = Math.max(alvo[n] || 0, v);
        else if (agora > this.piscar) { alvo.blink = 1; if (agora > this.piscar + 130) this.piscar = agora + 2000 + Math.random() * 4000; }
        for (const n of PRESETS_ROSTO) if (av.expressoes.has(n)) em.setValue(n, alvo[n] || 0);
      }
      av.vrm.update(dt);
      this.atualizarItem(dt);
    }
    descartar() {
      if (this.item) { this.item.descartar(); this.item = null; }
      this.trocarAvatar(null);
      soltarPlaca(this.rotulo);
      soltarPlaca(this.balao);
      this.boneco.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      if (this.grupo.parent) this.grupo.parent.remove(this.grupo);
    }
  }

  class Sala {
    /**
     * palco: o palco 3D; captura: a captura de movimento (para mandar a pose); aoMudar(), aoMensagem({de, nome, texto, meu});
     * aoPrivado(estado, anterior) (o chat privado mudou: {recebidos, enviados, abertos} com os ids) e
     * aoMensagemPrivada({de, para, nome, texto, meu}) (uma mensagem do chat privado: só as duas pessoas a recebem);
     * aparencia(): como estou agora ({avatar: Blob do .vrm vestido, ajuste, ocultas, texturas: {peça: Blob}}), conferido a
     * cada segundo: o que mudou vai para os outros.
     */
    constructor({ palco, captura, aoMudar, aoMensagem, aoPrivado, aoMensagemPrivada, aparencia }) {
      this.palco = palco;
      this.captura = captura;
      this.obterAparencia = aparencia || null;
      this.enviando = false;
      this.aoMudar = aoMudar || (() => {});
      this.aoMensagem = aoMensagem || (() => {});
      this.aoPrivado = aoPrivado || (() => {});
      this.aoMensagemPrivada = aoMensagemPrivada || (() => {});
      this.privado = { recebidos: [], enviados: [], abertos: [] }; // o chat privado (os ids de quem)
      this.codigo = null;
      this.info = null;         // {nome, mapa}
      this.eu = null;           // {id, segredo, nome}
      this.chave = null;        // só de quem criou a sala
      this.remotos = new Map();
      this.visto = 0;           // última mensagem recebida
      this.gesto = [0, ""];
      this.descanso = C.poseDescanso(1.2);
      this.ocupado = false;
      this.falhas = 0;
      // cada entrada na sala é uma "vez": sair (ou entrar de novo) muda a vez, cancela o que estava a caminho e faz as
      // respostas atrasadas da vez anterior serem ignoradas (antes, uma delas podia chegar depois e travar a sala)
      this.vez = 0;
      this.controle = null;
      this.relogio = new window.THREE.Clock();
      this.quadro = () => { if (!this.codigo) return; const dt = Math.min(0.3, this.relogio.getDelta()); for (const r of this.remotos.values()) { try { r.atualizar(dt); } catch (e) { console.error(e); } } this.pedidoQuadro = requestAnimationFrame(this.quadro); };
    }
    get dentro() { return !!(this.codigo && this.eu); }
    get pessoas() { return this.remotos.size + (this.dentro ? 1 : 0); }
    link() { return this.codigo ? location.origin + location.pathname + "#sala=" + this.codigo : ""; }
    /** O sinal da vez atual na sala (cancela quando a pessoa sai). */
    sinal() { return this.controle ? this.controle.signal : null; }
    /** Começa (ou encerra, com entrou = false) uma vez na sala: o que estava a caminho é cancelado. */
    novaVez(entrou) {
      this.vez++;
      if (this.controle) this.controle.abort();
      this.controle = entrou ? new AbortController() : null;
      this.ocupado = false;
      this.enviando = false;
      this.enviandoItem = false;
      this.itemEnviado = null;
    }

    /** As salas públicas deste servidor e se dá para criar: {salas: [...], criar, visitantes_criam, dono, abertas, maximo}. */
    static lista() { return pedir("GET", "", { base: "/api/salas" }); }
    /** O dono do servidor deixa (ou não) quem chega pelo link criar salas. */
    static ajustar(ajustes) { return pedir("POST", "ajustes", { json: ajustes, base: "/api/salas" }); }
    /** As chaves das salas que criei (neste navegador): {código: chave}. */
    static minhas() { try { return JSON.parse(LNUX.preferencia.ler("companhia.salas.chaves", "{}")) || {}; } catch (e) { return {}; } }
    static guardarChave(codigo, chave) {
      const m = Sala.minhas();
      if (chave) m[codigo] = chave; else delete m[codigo];
      for (const c of Object.keys(m).slice(0, -20)) delete m[c]; // só as mais recentes
      LNUX.preferencia.gravar("companhia.salas.chaves", JSON.stringify(m));
    }

    /**
     * Cria uma sala neste servidor. opcoes: {nome, descricao, publica, senha, max, bate_papo, criador}.
     * mapa: {glb: Blob, nome, ajuste} (um cenário meu) | {loja: id, nome} (um mundo da loja) | null (o chão simples).
     * miniatura: Blob (a foto do cenário, para a lista) | null.
     */
    async criar(opcoes, mapa, miniatura) {
      const r = await pedir("POST", "", { json: opcoes });
      this.chave = r.chave;
      Sala.guardarChave(r.codigo, r.chave);
      if (mapa) await this.mandarMapa(r.codigo, mapa);
      if (miniatura) await pedir("PUT", `${r.codigo}/miniatura`, { corpo: miniatura, chave: r.chave }).catch((e) => console.warn("sala: miniatura", e));
      return r;
    }
    async mandarMapa(codigo, mapa) {
      if (mapa.loja) { await pedir("POST", `${codigo}/mapa`, { json: { loja: mapa.loja }, chave: this.chave }); return; }
      this.ajusteEnviado = JSON.stringify(mapa.ajuste || {});
      await pedir("PUT", `${codigo}/mapa?nome=${encodeURIComponent(mapa.nome || "mapa")}&ajuste=${encodeURIComponent(this.ajusteEnviado)}`, { corpo: mapa.glb, chave: this.chave });
    }
    /** Quem criou muda as opções da sala (as mesmas de criar, menos o cenário). */
    async configurar(opcoes) {
      const r = await pedir("POST", `${this.codigo}/config`, { json: opcoes, chave: this.chave });
      this.info = { ...this.info, ...r };
      this.aoMudar();
      return r;
    }
    async trocarMiniatura(blob) { if (this.codigo && this.chave && blob) await pedir("PUT", `${this.codigo}/miniatura`, { corpo: blob, chave: this.chave }); }
    /** O que a sala tem (para a tela de entrada): {nome, pessoas, max, mapa: {nome, tamanho, ajuste, versao} | null}. */
    static consultar(codigo) { return pedir("GET", codigo); }

    /**
     * Entra na sala: baixa o cenário dela, põe a personagem no ponto de partida e começa a trocar posições.
     * avatar: Blob do .vrm para os outros verem (null = aparece como boneco simples para eles).
     */
    async entrar(codigo, nome, avatar, aoProgresso = () => {}, { senha = "" } = {}) {
      if (this.dentro) await this.sair();
      const palco = this.palco, mundo = palco.mundo;
      this.chave = Sala.minhas()[codigo] || null; // quem criou a sala (neste navegador) continua dona dela
      aoProgresso("Procurando a sala...");
      const info = await Sala.consultar(codigo);
      if (info.pessoas >= info.max) throw Object.assign(new Error(`A sala está cheia (${info.max} pessoas).`), { status: 429 });
      if (info.senha && !this.chave && !senha) throw Object.assign(new Error("Esta sala tem senha."), { status: 403, senha: true });
      // entra primeiro (a senha e a lotação são conferidas aqui), depois baixa o cenário
      aoProgresso("Entrando...");
      let eu;
      try { eu = await pedir("POST", `${codigo}/entrar`, { json: { nome, senha }, chave: this.chave }); }
      catch (e) { if (e.status === 403) e.senha = true; throw e; }
      try {
        if (info.mapa) {
          aoProgresso(C.t("Baixando o cenário da sala ({tamanho})...", { tamanho: LNUX.bytes(info.mapa.tamanho) }));
          const glb = await pedir("GET", `${codigo}/mapa?v=${info.mapa.arquivo || info.mapa.versao}`, { como: "blob" });
          aoProgresso("Abrindo o cenário...");
          await mundo.abrirMapa(new Map([["sala.glb", glb]]), { nome: info.mapa.nome, principal: "sala.glb", ajuste: { ...(info.mapa.ajuste || {}) } });
        } else if (mundo.mapa) mundo.tirarMapa();
      } catch (e) {
        pedir("POST", `${codigo}/sair`, { json: { id: eu.id, segredo: eu.segredo } }).catch(() => {});
        throw e;
      }
      this.novaVez(true);
      this.codigo = codigo;
      this.info = info;
      this.eu = { ...eu, nome };
      this.visto = eu.mensagens || 0;
      this.mapaVersao = info.mapa ? info.mapa.versao : 0;
      this.mapaArquivo = info.mapa ? info.mapa.arquivo || info.mapa.versao : 0;
      if (avatar) pedir("PUT", `${codigo}/avatar?id=${eu.id}&segredo=${eu.segredo}`, { corpo: avatar, sinal: this.sinal() }).catch((e) => { if (!e.saiu) console.warn("sala: o avatar não subiu", e); });
      this.avatarEnviado = avatar || null;
      this.aparenciaEnviada = "";
      this.texturasEnviadas = new Map(); // Blob → n
      this.ultimaAparencia = 0;
      // cada um nasce um pouco para o lado, para não ficar um dentro do outro
      mundo.entrar();
      const lado = (parseInt(eu.id, 36) % 7) - 3;
      palco.raiz.position.x += lado * 0.7;
      palco.raiz.position.z += ((parseInt(eu.id, 36) >> 3) % 3) * 0.7;
      mundo.assentar();
      this.falhas = 0;
      clearInterval(this.pulso);
      this.pulso = setInterval(() => this.trocar(), 120);
      this.relogio.getDelta();
      this.pedidoQuadro = requestAnimationFrame(this.quadro);
      this.aoMudar();
      return info;
    }
    /** O que mandamos de nós: lugar, rumo, andar/correr/pular, emoção, gesto e, com a captura ligada, a pose e o rosto. */
    meuEstado() {
      const p = this.palco, m = p.mundo, r = p.raiz.position;
      const e = { p: [arred(r.x), arred(r.y), arred(r.z)], r: arred(m.rumo), e: m.estado, emo: p.emocao, g: this.gesto, c: arred(m.cam.giro) }; // c: para onde a câmera olha (a tela de vídeo que segue fica na frente dela)
      const it = this.mochila && this.mochila.paraSala();
      if (it) e.it = it; // o item na mão (js/mochila.js)
      if (m.olharCabeca) e.o = arred(m.olharCabeca); // em primeira pessoa: a cabeça abaixa e levanta com o olhar
      const rd = m.ragdoll;
      if (rd && (rd.ativo || rd.saida > 0)) {
        // boneco de pano: a pose inteira do corpo e onde o quadril está (em relação à altura do quadril, para servir em qualquer avatar)
        e.pose = {};
        for (const n of C.OSSOS_RAGDOLL) { const q = p.pose[n]; if (q && p.nos[n]) e.pose[n] = [arred(q.x), arred(q.y), arred(q.z), arred(q.w)]; }
        const qd = p.quadrilDesl, a = p.alturaQuadril || 1;
        e.qd = [arred(qd.x / a), arred(qd.y / a), arred(qd.z / a)];
        return e;
      }
      const cap = this.captura;
      if (cap && cap.ativa && cap.atual.size) {
        e.pose = {};
        for (const [n, s] of cap.atual) if (s.peso > 0.5) e.pose[n] = [arred(s.q.x), arred(s.q.y), arred(s.q.z), arred(s.q.w)];
        const rosto = p.rastreado && p.rastreado.rosto;
        if (rosto) { e.rosto = {}; for (const n of PRESETS_ROSTO) if (rosto.expr[n] > 0.03) e.rosto[n] = Math.round(rosto.expr[n] * 100) / 100; }
      }
      return e;
    }
    /** Manda o que mudou na minha aparência: a roupa (o .vrm), as texturas novas e o ajuste/as peças escondidas. */
    async enviarAparencia() {
      if (!this.dentro || this.enviando || !this.obterAparencia) return;
      const a = this.obterAparencia();
      if (!a) return;
      this.enviando = true;
      const { codigo, eu, vez } = this, q = `id=${eu.id}&segredo=${eu.segredo}`, sinal = this.sinal();
      try {
        if (a.avatar && a.avatar !== this.avatarEnviado) {
          await pedir("PUT", `${codigo}/avatar?${q}`, { corpo: a.avatar, sinal });
          this.avatarEnviado = a.avatar;
        }
        const texturas = {};
        for (const [peca, blob] of Object.entries(a.texturas || {})) {
          if (!(blob instanceof Blob)) continue;
          if (!this.texturasEnviadas.has(blob)) {
            const n = this.texturasEnviadas.size % 256;
            await pedir("PUT", `${codigo}/textura?${q}&n=${n}`, { corpo: blob, sinal });
            this.texturasEnviadas.set(blob, n);
          }
          texturas[peca] = this.texturasEnviadas.get(blob);
        }
        const json = JSON.stringify({ ajuste: a.ajuste || null, ocultas: a.ocultas || [], texturas });
        if (json !== this.aparenciaEnviada && this.codigo === codigo) {
          await pedir("PUT", `${codigo}/aparencia?${q}`, { corpo: json, tempo: ESPERA.pequeno, sinal });
          this.aparenciaEnviada = json;
        }
      } catch (e) { if (!e.saiu) console.warn("sala: a aparência não subiu", e); }
      finally { if (vez === this.vez) this.enviando = false; } // de uma vez anterior: a nova já começou sem ela
    }
    /** O item que levo na mão vai para a sala uma vez (os outros baixam quando a versão muda). */
    async enviarItem() {
      const blob = this.mochila && this.mochila.blob;
      if (!this.dentro || !blob || blob === this.itemEnviado || this.enviandoItem) return;
      const { codigo, eu, vez } = this;
      this.enviandoItem = true;
      try { await pedir("PUT", `${codigo}/item?id=${eu.id}&segredo=${eu.segredo}`, { corpo: blob, sinal: this.sinal() }); if (vez === this.vez) this.itemEnviado = blob; }
      catch (e) { if (!e.saiu) console.warn("sala: o item não subiu", e); }
      finally { if (vez === this.vez) this.enviandoItem = false; }
    }
    async trocar() {
      if (!this.dentro || this.ocupado) return;
      if (performance.now() - this.ultimaAparencia > 1000) { this.ultimaAparencia = performance.now(); this.enviarAparencia(); this.enviarItem(); }
      const { vez, eu, codigo } = this;
      this.ocupado = true;
      try {
        const enviado = Date.now() / 1000;
        const r = await pedir("POST", `${codigo}/estado`, { json: { id: eu.id, segredo: eu.segredo, desde: this.visto, estado: this.meuEstado() }, tempo: ESPERA.estado, sinal: this.sinal() });
        if (vez !== this.vez) return; // saiu (ou entrou de novo) enquanto esperava: a resposta é da vez anterior
        this.falhas = 0;
        if (typeof r.agora === "number") { // o relógio do servidor menos o meu (metade da ida e volta descontada), suavizado
          const d = r.agora - (enviado + Date.now() / 1000) / 2;
          this.desvio = this.desvio === undefined ? d : this.desvio * 0.85 + d * 0.15;
          relogioDe = this;
        }
        const vivos = new Set();
        for (const j of r.pessoas) {
          if (j.id === eu.id) { this.meuVideo = j.video || 0; continue; }
          vivos.add(j.id);
          let rem = this.remotos.get(j.id);
          if (!rem) { rem = new Remoto(this, j.id, j.nome); this.remotos.set(j.id, rem); this.aoMensagem({ sistema: true, texto: C.t("{nome} entrou.", { nome: j.nome }) }); this.aoMudar(); }
          rem.receber(j);
        }
        for (const [id, rem] of this.remotos) if (!vivos.has(id)) { this.aoMensagem({ sistema: true, texto: C.t("{nome} saiu.", { nome: rem.nome }) }); rem.descartar(); this.remotos.delete(id); this.aoMudar(); }
        if (r.privado) this.receberPrivado(r.privado);
        for (const m of r.mensagens || []) {
          this.visto = Math.max(this.visto, m.n);
          const meu = m.de === eu.id, rem = this.remotos.get(m.de);
          if (m.para) { this.aoMensagemPrivada({ de: m.de, para: m.para, nome: m.nome, texto: m.texto, meu }); continue; } // no chat privado: sem balão
          if (rem && !(C.batePapo && C.batePapo.ler().baloes === false)) rem.falar(m.texto); // Opções › Bate-papo: os balões
          this.aoMensagem({ de: m.de, nome: m.nome, texto: m.texto, meu, titulo: m.titulo || null });
        }
        if (r.mapa !== this.mapaVersao) { this.mapaVersao = r.mapa; this.trocarMapa().catch((e) => { if (!e.saiu) console.warn(e); }); }
        // quem criou mudou o nome ou o bate-papo: todos veem
        if (this.info && ((r.nome && r.nome !== this.info.nome) || (r.bate_papo !== undefined && r.bate_papo !== this.info.bate_papo) || (r.videos && r.videos !== this.info.videos))) {
          this.info = { ...this.info, nome: r.nome || this.info.nome, bate_papo: r.bate_papo, videos: r.videos || this.info.videos };
          this.aoMudar();
        }
      } catch (e) {
        if (vez !== this.vez) return; // da vez anterior (ou cancelado porque saiu)
        if (e.status === 404 || e.status === 403 || ++this.falhas > 40) { const motivo = e.status === 404 ? "A sala foi fechada." : e.status === 403 ? "Você foi tirado da sala (ficou tempo demais sem resposta)." : "A ligação com a sala caiu."; await this.sair(true); this.aoMensagem({ sistema: true, texto: motivo }); LNUX.aviso(motivo, "alerta", 8000); }
      } finally { if (vez === this.vez) this.ocupado = false; }
    }
    /** Quem criou a sala trocou o cenário (todos passam para o novo) ou só o ajuste dele (tamanho, giro, posição, começo). */
    async trocarMapa() {
      if (this.trocandoMapa) { this.trocarDeNovo = true; return; } // uma troca de cada vez; a última vale
      this.trocandoMapa = true;
      try {
        do { this.trocarDeNovo = false; await this.trocarMapaAgora(); } while (this.trocarDeNovo && this.dentro);
      } finally { this.trocandoMapa = false; }
    }
    async trocarMapaAgora() {
      const info = await Sala.consultar(this.codigo), mundo = this.palco.mundo;
      if (!this.dentro) return;
      this.info = info;
      if (!info.mapa) { this.mapaArquivo = 0; mundo.tirarMapa(); return; }
      const arquivo = info.mapa.arquivo || info.mapa.versao;
      if (arquivo === this.mapaArquivo && mundo.mapa) {
        // o mesmo arquivo: só o ajuste mudou (quem criou e mandou esse mesmo ajuste já está com ele, talvez até mais novo)
        const ajuste = info.mapa.ajuste || {};
        if (!this.chave || JSON.stringify(ajuste) !== this.ajusteEnviado) mundo.trocarAjuste({ ...ajuste });
        this.aoMudar();
        return;
      }
      const glb = await pedir("GET", `${this.codigo}/mapa?v=${arquivo}`, { como: "blob", sinal: this.sinal() });
      if (!this.dentro) return;
      await mundo.abrirMapa(new Map([["sala.glb", glb]]), { nome: info.mapa.nome, principal: "sala.glb", ajuste: { ...(info.mapa.ajuste || {}) } });
      this.mapaArquivo = arquivo;
      this.aoMensagem({ sistema: true, texto: C.t("O cenário da sala agora é \"{nome}\".", { nome: info.mapa.nome }) });
    }
    /** Quem criou mexeu no ajuste do cenário (Movimento › Cenário): vai para todos, sem mandar o arquivo de novo. */
    async mandarAjuste(ajuste) {
      if (!this.dentro || !this.chave || !this.info || !this.info.mapa) return;
      this.ajusteEnviado = JSON.stringify(ajuste);
      await pedir("POST", `${this.codigo}/config`, { json: { ajuste: JSON.parse(this.ajusteEnviado) }, chave: this.chave });
    }
    async falar(texto) {
      texto = String(texto || "").trim().slice(0, 300);
      if (!texto || !this.dentro) return;
      await pedir("POST", `${this.codigo}/falar`, { json: { id: this.eu.id, segredo: this.eu.segredo, texto } });
    }
    /** O chat privado mudou (veio na troca de estado ou na resposta de um pedido): avisa só se mudou. */
    receberPrivado(p) {
      const novo = { recebidos: p.recebidos || [], enviados: p.enviados || [], abertos: p.abertos || [] };
      if (JSON.stringify(novo) === JSON.stringify(this.privado)) return;
      const anterior = this.privado;
      this.privado = novo;
      this.aoPrivado(novo, anterior);
    }
    /** O chat privado com alguém da sala: acao = pedir | aceitar | recusar | fechar (fechar também cancela o meu pedido). */
    async pedirPrivado(acao, para) {
      if (!this.dentro) throw new Error("Você não está numa sala.");
      const vez = this.vez, r = await pedir("POST", `${this.codigo}/privado`, { json: { id: this.eu.id, segredo: this.eu.segredo, para, acao } });
      if (vez === this.vez) this.receberPrivado(r);
      return r;
    }
    /** Uma mensagem no chat privado (só as duas pessoas veem). */
    async falarPrivado(para, texto) {
      texto = String(texto || "").trim().slice(0, 300);
      if (!texto || !this.dentro) return;
      await pedir("POST", `${this.codigo}/falar`, { json: { id: this.eu.id, segredo: this.eu.segredo, texto, para } });
    }
    /**
     * Quem está neste ponto da tela (x, y em pixels da página): a personagem de outra pessoa mais perto da câmera, ou null.
     * Confere o retângulo do corpo dela na tela (dos pés à cabeça), que vale para qualquer avatar (até os bem grandes).
     */
    pessoaNaTela(x, y) {
      const p = this.palco;
      if (!this.dentro || !p || !p.camera) return null;
      const T = window.THREE, caixa = p.view.getBoundingClientRect(), v = new T.Vector3();
      let achada = null, perto = Infinity;
      for (const r of this.remotos.values()) {
        const pe = this.naTela(r, 0, caixa, v), topo = this.naTela(r, r.altura + 0.1, caixa, v);
        if (!pe || !topo) continue;
        const alto = Math.max(12, pe.y - topo.y), largo = Math.max(18, alto * 0.42);
        if (x < topo.x - largo / 2 || x > topo.x + largo / 2 || y < topo.y || y > pe.y) continue;
        if (pe.d < perto) { perto = pe.d; achada = r; }
      }
      return achada;
    }
    /** Onde fica, na página, um ponto da personagem de alguém (a altura em metros acima dos pés). null: atrás da câmera. */
    naTela(r, altura, caixa = this.palco.view.getBoundingClientRect(), v = new window.THREE.Vector3()) {
      const cam = this.palco.camera;
      v.copy(r.grupo.position);
      v.y += altura;
      const d = v.distanceTo(cam.position);
      v.project(cam);
      if (v.z > 1 || v.z < -1) return null;
      return { x: caixa.left + (v.x + 1) / 2 * caixa.width, y: caixa.top + (1 - v.y) / 2 * caixa.height, d };
    }
    /** O meu vídeo na tela: acao = abrir | lugar | pausar | continuar | pular | fechar. Devolve o estado (com "agora", o relógio do servidor). */
    async mandarVideo(acao, dados = {}) {
      if (!this.dentro) throw new Error("Você não está numa sala.");
      return pedir("POST", `${this.codigo}/video`, { json: { id: this.eu.id, segredo: this.eu.segredo, acao, ...dados } });
    }
    /** Um gesto meu que os outros veem (o aceno). */
    gestoMeu(nome) { this.gesto = [this.gesto[0] + 1, nome]; }
    async sair(caiu = false) {
      clearInterval(this.pulso);
      cancelAnimationFrame(this.pedidoQuadro);
      const codigo = this.codigo, eu = this.eu;
      this.novaVez(false); // o que estava a caminho (a troca de estado, a aparência, os avatares dos outros) é cancelado
      this.codigo = null;
      this.eu = null;
      this.ajusteEnviado = undefined;
      this.receberPrivado({}); // os chats privados fecham
      for (const r of this.remotos.values()) r.descartar();
      this.remotos.clear();
      if (codigo && eu && !caiu) pedir("POST", `${codigo}/sair`, { json: { id: eu.id, segredo: eu.segredo } }).catch(() => {});
      this.aoMudar();
    }
    /** Fecha a sala para todos (só quem criou). */
    async fechar() {
      const codigo = this.codigo;
      await this.sair();
      if (codigo && this.chave) await pedir("DELETE", codigo, { chave: this.chave }).catch(() => {});
      if (codigo) Sala.guardarChave(codigo, null);
      this.chave = null;
    }
  }
  C.Sala = Sala;
  C.salaPedir = pedir;

  /**
   * O avatar padrão: um boneco de caixas, montado aqui mesmo como um VRM 1.0 (só ossos e caixinhas presas neles), para
   * quem entra numa sala sem ter uma personagem .vrm. cor: [r, g, b] da roupa (0 a 1). Devolve um Blob (.vrm).
   */
  C.bonecoPadrao = function (cor = [0.31, 0.56, 0.97]) {
    const ossos = [["hips", null, [0, 0.92, 0]], ["spine", "hips", [0, 1.0, 0]], ["chest", "spine", [0, 1.15, 0]], ["neck", "chest", [0, 1.38, 0]], ["head", "neck", [0, 1.46, 0]]];
    for (const [l, s] of [["left", 1], ["right", -1]]) {
      ossos.push([l + "Shoulder", "chest", [0.06 * s, 1.34, 0]], [l + "UpperArm", l + "Shoulder", [0.17 * s, 1.34, 0]], [l + "LowerArm", l + "UpperArm", [0.42 * s, 1.34, 0]], [l + "Hand", l + "LowerArm", [0.66 * s, 1.34, 0]],
        [l + "UpperLeg", "hips", [0.09 * s, 0.88, 0]], [l + "LowerLeg", l + "UpperLeg", [0.09 * s, 0.49, 0]], [l + "Foot", l + "LowerLeg", [0.09 * s, 0.09, 0]], [l + "Toes", l + "Foot", [0.09 * s, 0.02, 0.12]]);
    }
    // caixas presas nos ossos: [osso, material, centro em relação ao osso, tamanho]
    const PELE = 0, ROUPA = 1, CALCA = 2, ESCURO = 3;
    const caixas = [["hips", CALCA, [0, 0.02, 0], [0.3, 0.2, 0.19]], ["spine", ROUPA, [0, 0.08, 0], [0.3, 0.16, 0.19]], ["chest", ROUPA, [0, 0.11, 0], [0.36, 0.24, 0.21]], ["neck", PELE, [0, 0.03, 0], [0.09, 0.1, 0.09]],
      ["head", PELE, [0, 0.1, 0.01], [0.21, 0.24, 0.22]], ["head", ESCURO, [0, 0.2, -0.02], [0.23, 0.1, 0.24]], ["head", ESCURO, [0.05, 0.11, 0.12], [0.035, 0.035, 0.02]], ["head", ESCURO, [-0.05, 0.11, 0.12], [0.035, 0.035, 0.02]]];
    for (const [l, s] of [["left", 1], ["right", -1]]) {
      caixas.push([l + "UpperArm", ROUPA, [0.125 * s, 0, 0], [0.25, 0.09, 0.09]], [l + "LowerArm", PELE, [0.12 * s, 0, 0], [0.24, 0.075, 0.075]], [l + "Hand", PELE, [0.05 * s, 0, 0], [0.1, 0.04, 0.08]],
        [l + "UpperLeg", CALCA, [0, -0.195, 0], [0.125, 0.39, 0.125]], [l + "LowerLeg", CALCA, [0, -0.2, 0], [0.105, 0.4, 0.105]], [l + "Foot", ESCURO, [0, -0.045, 0.06], [0.1, 0.08, 0.24]]);
    }
    // um cubo de lado 1 (24 vértices, com as normais), usado por todas as caixas
    const pos = [], nor = [], idx = [];
    for (const [n, u, v] of [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]]) {
      const b = pos.length / 3;
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { for (let k = 0; k < 3; k++) pos.push((n[k] + u[k] * a + v[k] * c) / 2); nor.push(...n); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const P = new Float32Array(pos), N = new Float32Array(nor), I = new Uint16Array(idx);
    const bin = new Uint8Array(P.byteLength + N.byteLength + I.byteLength);
    bin.set(new Uint8Array(P.buffer), 0); bin.set(new Uint8Array(N.buffer), P.byteLength); bin.set(new Uint8Array(I.buffer), P.byteLength + N.byteLength);
    const lugar = Object.fromEntries(ossos.map(([n, , p]) => [n, p]));
    const nodes = ossos.map(([n, pai, p]) => ({ name: "Osso_" + n, translation: pai ? p.map((v, k) => +(v - lugar[pai][k]).toFixed(4)) : p }));
    ossos.forEach(([, pai], i) => { if (pai) { const o = nodes[ossos.findIndex((x) => x[0] === pai)]; (o.children = o.children || []).push(i); } });
    caixas.forEach(([osso, material, centro, tamanho], i) => {
      nodes.push({ name: "Caixa_" + i, mesh: material, translation: centro, scale: tamanho });
      const o = nodes[ossos.findIndex((x) => x[0] === osso)];
      (o.children = o.children || []).push(nodes.length - 1);
    });
    const mat = (nome, c) => ({ name: nome, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 0.85 } });
    const json = {
      asset: { version: "2.0", generator: "LNUX Companhia" }, extensionsUsed: ["VRMC_vrm"], scene: 0, scenes: [{ nodes: [0] }], nodes,
      buffers: [{ byteLength: bin.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: I.byteLength, target: 34963 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" }, { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" }],
      materials: [mat("Pele", [0.93, 0.8, 0.7]), mat("Roupa_CLOTH", cor), mat("Calca_CLOTH", [0.2, 0.24, 0.36]), mat("Escuro", [0.13, 0.14, 0.2])],
      meshes: [0, 1, 2, 3].map((m) => ({ name: "Caixa", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: m }] })),
      extensions: { VRMC_vrm: { specVersion: "1.0",
        meta: { name: "Boneco", version: "1", authors: ["LNUX-APPs"], licenseUrl: "https://vrm.dev/licenses/1.0/", avatarPermission: "everyone", commercialUsage: "corporation", creditNotation: "unnecessary", allowRedistribution: true, modification: "allowModificationRedistribution" },
        humanoid: { humanBones: Object.fromEntries(ossos.map(([n], i) => [n, { node: i }])) } } },
    };
    const texto = new TextEncoder().encode(JSON.stringify(json)), sobraJ = (4 - (texto.length % 4)) % 4, sobraB = (4 - (bin.length % 4)) % 4;
    const total = 12 + 8 + texto.length + sobraJ + 8 + bin.length + sobraB, saida = new Uint8Array(total), v = new DataView(saida.buffer);
    v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
    v.setUint32(12, texto.length + sobraJ, true); v.setUint32(16, 0x4e4f534a, true);
    saida.set(texto, 20); saida.fill(0x20, 20 + texto.length, 20 + texto.length + sobraJ);
    const b0 = 20 + texto.length + sobraJ;
    v.setUint32(b0, bin.length + sobraB, true); v.setUint32(b0 + 4, 0x004e4942, true);
    saida.set(bin, b0 + 8);
    return new Blob([saida], { type: "model/gltf-binary" });
  };

})();
