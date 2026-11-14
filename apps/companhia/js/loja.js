/*
 * Companhia — loja: personagens, mundos e animações guardados no aparelho de quem tem o servidor.
 *
 * Quem entra pelo link vê a loja como uma vitrine: cartões com a miniatura, abas por tipo e busca. Ao abrir um
 * item, ele aparece em 3D (a personagem girando, o mundo visto de cima, a animação num boneco) antes de a pessoa
 * decidir usar. "Usar" baixa o arquivo para o navegador dela: a personagem vira uma das suas, o mundo vai para
 * Movimento › Cenário e a animação para os pacotes de movimento. "Publicar" manda uma personagem, um mundo ou
 * uma animação sua para a loja (com a miniatura tirada da prévia), se o dono do servidor deixar.
 *
 * O servidor (servidor/lnux_apps.py, /api/loja) guarda tudo numa pasta própria do aparelho (~/.lnux-apps/loja), a
 * única que os visitantes alcançam. Quem publica recebe um segredo (guardado só no navegador dela) para trocar a
 * miniatura ou apagar o que publicou; o dono (com a chave da ponte, no próprio aparelho) apaga qualquer item e
 * decide se os visitantes podem publicar.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const TIPOS = {
    personagem: { nome: "Personagens", um: "Personagem", icone: "🧍", usar: "Usar esta personagem" },
    mundo: { nome: "Mapas", um: "Mapa", icone: "🗺️", usar: "Usar este mapa" },
    animacao: { nome: "Animações", um: "Animação", icone: "💃", usar: "Usar esta animação" },
  };
  const t = (s, v) => (C.t ? C.t(s, v) : s);
  const SEGREDOS = "companhia.loja.segredos";

  // ── O servidor ───────────────────────────────────────────────────────

  async function pedir(metodo, rota, { json, corpo, como = "json", segredo } = {}) {
    const cab = {};
    if (LNUX.ponte._token) cab["X-Ponte-Token"] = LNUX.ponte._token; // o dono do servidor
    const sessao = C.contas && C.contas.sessao();
    if (sessao) cab["X-Conta-Sessao"] = sessao; // quem tem conta: curtir, e o nome dela no que publicar
    if (segredo) cab["X-Loja-Segredo"] = segredo;
    if (json !== undefined) cab["Content-Type"] = "application/json";
    let r;
    try { r = await fetch("/api/loja" + (rota ? "/" + rota : ""), { method: metodo, headers: cab, body: json !== undefined ? JSON.stringify(json) : corpo }); }
    catch (e) { throw new Error("A loja não respondeu (o servidor está ligado?)."); }
    if (!r.ok) {
      let msg = "A loja respondeu " + r.status;
      try { const j = await r.json(); if (j.erro) msg = j.erro; } catch (e) { /* sem corpo */ }
      const erro = new Error(msg);
      erro.status = r.status;
      throw erro;
    }
    return como === "json" ? r.json() : como === "blob" ? r.blob() : r;
  }
  const lerSegredos = () => { try { return JSON.parse(LNUX.preferencia.ler(SEGREDOS, "{}")) || {}; } catch (e) { return {}; } };
  const gravarSegredo = (id, segredo) => { const s = lerSegredos(); if (segredo) s[id] = segredo; else delete s[id]; LNUX.preferencia.gravar(SEGREDOS, JSON.stringify(s)); };

  let publico = null;
  C.loja = {
    TIPOS,
    /** O servidor tem a loja? (pergunta uma vez; quem entra pelo link também vê) */
    async disponivel() {
      if (publico === null) {
        try { const r = await fetch("/api/publico", { cache: "no-store" }); publico = r.ok ? await r.json() : {}; } catch (e) { publico = {}; }
      }
      return !!publico.loja;
    },
    lista: () => pedir("GET", ""),
    /** O Sketchfab (só o dono): a chave fica no servidor, que busca e baixa. */
    sketchfab: {
      estado: () => pedir("GET", "sketchfab"),
      chave: (token) => pedir("PUT", "sketchfab", { json: { token } }),
      buscar: (q, { animado = false, cursor = "" } = {}) => pedir("GET", "sketchfab/buscar?" + new URLSearchParams({ q, animado: animado ? "1" : "0", cursor })),
      importar: (uid, tags = "") => pedir("POST", "sketchfab/importar", { json: { uid, tags } }),
    },
    miniatura: (item) => `/api/loja/${item.id}/miniatura?v=${item.miniatura}`,
    /** Baixa o arquivo do item (com o andamento: aoProgresso(fração)). */
    async baixar(item, aoProgresso = () => {}) {
      const r = await pedir("GET", item.id + "/arquivo", { como: "resposta" });
      const total = +r.headers.get("Content-Length") || item.tamanho || 0;
      if (!r.body || !total) return r.blob();
      const leitor = r.body.getReader(), partes = [];
      let recebido = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        partes.push(value);
        recebido += value.length;
        aoProgresso(recebido / total);
      }
      return new Blob(partes);
    },
    /** Publica: {tipo, blob, arquivo, nome, descricao, autor, tags}. Guarda o segredo neste navegador. Devolve o item. */
    publicar({ tipo, blob, arquivo, nome, descricao, autor, tags }, aoProgresso = () => {}) {
      return new Promise((ok, falhou) => {
        const q = new URLSearchParams({ arquivo, nome: nome || "", descricao: descricao || "", autor: autor || "", tags: (tags || []).join(",") });
        const x = new XMLHttpRequest();
        x.open("PUT", `/api/loja/${tipo}?${q}`);
        if (LNUX.ponte._token) x.setRequestHeader("X-Ponte-Token", LNUX.ponte._token);
        const sessao = C.contas && C.contas.sessao();
        if (sessao) x.setRequestHeader("X-Conta-Sessao", sessao);
        x.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso(e.loaded / e.total); };
        x.onerror = () => falhou(new Error("A loja não respondeu (o servidor está ligado?)."));
        x.onload = () => {
          let j = {};
          try { j = JSON.parse(x.responseText || "{}"); } catch (e) { /* sem corpo */ }
          if (x.status !== 201) { falhou(new Error(j.erro || "A loja respondeu " + x.status)); return; }
          gravarSegredo(j.item.id, j.segredo);
          ok(j.item);
        };
        x.send(blob);
      });
    },
    trocarMiniatura: (item, blob) => pedir("PUT", item.id + "/miniatura", { corpo: blob, segredo: lerSegredos()[item.id] }),
    async apagar(item) { await pedir("DELETE", item.id, { segredo: lerSegredos()[item.id] }); gravarSegredo(item.id, null); },
    configurar: (cfg) => pedir("POST", "config", { json: cfg }),
    /** Curtir (só com conta). Devolve {curtidas, curti}. */
    curtir: (item, curtir) => pedir("POST", item.id + "/curtir", { json: { curtir } }),
    /** Conta que esta pessoa baixou (uma vez por pessoa). Devolve {baixados}. */
    baixou: (item) => pedir("POST", item.id + "/baixou", { json: {} }).catch(() => null),
    /** Muda os #, o nome ou a descrição (quem publicou, pelo segredo, ou o dono). */
    editar: (item, dados) => pedir("POST", item.id, { json: dados, segredo: lerSegredos()[item.id] }),
    /** "fnaf, terror #anime" → ["fnaf", "terror", "anime"] (como o servidor faz). */
    tags: (texto) => [...new Set(String(texto || "").split(/[\s,;#]+/).map((x) => x.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "")).filter(Boolean))].slice(0, 12),
    /** Quem pode apagar o item: o dono da loja ou quem publicou (o segredo ficou neste navegador). */
    podeMexer: (item, dono) => !!(dono || (!item.solto && lerSegredos()[item.id])),
  };

  // ── Vitrine: a prévia em 3D ──────────────────────────────────────────

  const cor = (nome, padrao) => (getComputedStyle(document.documentElement).getPropertyValue(nome) || "").trim() || padrao;

  /**
   * Mostra um item da loja em 3D dentro de um elemento: a personagem de pé (girando devagar), o mundo visto de
   * cima ou a animação num boneco. Arrastar gira; a rodinha aproxima. foto() tira a miniatura.
   */
  class Vitrine {
    constructor(alvo) {
      const T = window.THREE, V = window.CompanhiaVRM;
      this.alvo = alvo;
      const r = (this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.NeutralToneMapping || T.ACESFilmicToneMapping;
      r.domElement.className = "vitrine-tela";
      alvo.append(r.domElement);
      this.cena = new T.Scene();
      this.cena.background = new T.Color(cor("--trilha-alt", "#1d2027"));
      const pmrem = new T.PMREMGenerator(r);
      this.cena.environment = pmrem.fromScene(new V.RoomEnvironment(), 0.04).texture;
      this.cena.environmentIntensity = 0.55;
      pmrem.dispose();
      const sol = new T.DirectionalLight(0xfff1dc, 2.2);
      sol.position.set(2, 4, 3);
      this.cena.add(sol, new T.HemisphereLight(0xdfeaff, 0x8a7d6c, 1.0));
      this.camera = new T.PerspectiveCamera(30, 1, 0.01, 2000);
      this.olhar = { giro: 0.5, inclina: 0.1, dist: 3, alvo: new T.Vector3(0, 1, 0), girando: true };
      this.objeto = null;
      this.vrm = null;
      this.relogio = new T.Clock();
      this.t = 0;
      this.ligarControles();
      this.redimensionar();
      this.observador = new ResizeObserver(() => this.redimensionar());
      this.observador.observe(alvo);
      const quadro = () => { if (!this.renderer) return; this.quadro = requestAnimationFrame(quadro); this.desenhar(); };
      this.quadro = requestAnimationFrame(quadro);
    }
    ligarControles() {
      const tela = this.renderer.domElement, o = this.olhar;
      let antes = null;
      tela.addEventListener("pointerdown", (e) => { antes = [e.clientX, e.clientY]; o.girando = false; tela.setPointerCapture(e.pointerId); });
      tela.addEventListener("pointermove", (e) => {
        if (!antes) return;
        o.giro -= (e.clientX - antes[0]) * 0.01;
        o.inclina = Math.max(-0.3, Math.min(1.35, o.inclina + (e.clientY - antes[1]) * 0.008));
        antes = [e.clientX, e.clientY];
      });
      const soltar = () => { antes = null; };
      tela.addEventListener("pointerup", soltar);
      tela.addEventListener("pointercancel", soltar);
      tela.addEventListener("wheel", (e) => { e.preventDefault(); o.dist = Math.max(o.min || 0.3, Math.min(o.max || 50, o.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });
    }
    redimensionar() {
      const w = Math.max(1, this.alvo.clientWidth), h = Math.max(1, this.alvo.clientHeight);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    posicionarCamera() {
      const o = this.olhar, c = this.camera;
      c.position.set(o.alvo.x + Math.sin(o.giro) * Math.cos(o.inclina) * o.dist, o.alvo.y + Math.sin(o.inclina) * o.dist, o.alvo.z + Math.cos(o.giro) * Math.cos(o.inclina) * o.dist);
      c.lookAt(o.alvo);
    }
    desenhar() {
      const dt = Math.min(0.1, this.relogio.getDelta());
      this.t += dt;
      if (this.olhar.girando) this.olhar.giro += dt * 0.35;
      if (this.aoQuadro) { try { this.aoQuadro(dt); } catch (e) { console.error(e); this.aoQuadro = null; } }
      this.posicionarCamera();
      this.renderer.render(this.cena, this.camera);
    }
    limpar() {
      this.aoQuadro = null;
      this.animador = null;
      if (this.objeto) {
        this.cena.remove(this.objeto);
        try { window.CompanhiaVRM.VRMUtils.deepDispose(this.objeto); } catch (e) { /* já foi */ }
      }
      if (this.chao) { this.cena.remove(this.chao); this.chao.geometry.dispose(); this.chao.material.dispose(); this.chao = null; }
      this.objeto = this.vrm = null;
    }
    /** Mostra um item: tipo "personagem" (.vrm), "mundo" (.glb) ou "animacao" (.vrma/.bvh/.fbx/.glb, num boneco). */
    async mostrar(tipo, blob, arquivo) {
      await C.prepararVRM();
      this.limpar();
      if (tipo === "personagem") return this.personagem(blob);
      if (tipo === "mundo") return this.mundo(blob);
      return this.animacao(blob, arquivo);
    }
    async abrirVRM(blob) {
      const T = window.THREE, { GLTFLoader, VRMLoaderPlugin, VRMUtils } = window.CompanhiaVRM;
      const carregador = new GLTFLoader();
      carregador.register((parser) => new VRMLoaderPlugin(parser));
      const url = URL.createObjectURL(blob);
      let gltf;
      try { gltf = await carregador.loadAsync(url); } finally { URL.revokeObjectURL(url); }
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("Esse arquivo não é uma personagem VRM.");
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((o) => { o.frustumCulled = false; });
      const v0 = vrm.meta ? vrm.meta.metaVersion === "0" : false, s = v0 ? -1 : 1, h = vrm.humanoid;
      // de pé, com os braços para baixo (a pose de descanso do palco), no espaço do VRM 1.0
      const descanso = C.poseDescanso(1.2), nos = {};
      for (const n of C.OSSOS_VRM) { const b = h.getNormalizedBoneNode(n); if (b) nos[n] = b; }
      const quadril = nos.hips ? nos.hips.position.clone() : new T.Vector3(0, 0.9, 0);
      const pose = (fonte) => {
        for (const n in nos) { const q = fonte(n); if (q) nos[n].quaternion.set(q.x * s, q.y, q.z * s, q.w); else nos[n].quaternion.identity(); }
      };
      pose((n) => descanso[n]);
      vrm.update(0);
      this.cena.add(vrm.scene);
      this.objeto = vrm.scene;
      this.vrm = vrm;
      return { vrm, nos, pose, quadril, s, descanso };
    }
    enquadrarPessoa(altura) {
      const T = window.THREE, o = this.olhar;
      o.alvo.set(0, altura * 0.52, 0);
      o.dist = altura * 2.15;
      o.inclina = 0.08;
      o.giro = 0.45;
      o.min = altura * 0.5;
      o.max = altura * 6;
      this.camera.near = 0.01;
      this.camera.far = 200;
      this.camera.updateProjectionMatrix();
      this.chao = new T.Mesh(new T.CircleGeometry(altura * 0.42, 48), new T.MeshStandardMaterial({ color: cor("--borda", "#343944"), roughness: 0.95 }));
      this.chao.rotation.x = -Math.PI / 2;
      this.chao.position.y = -0.002;
      this.cena.add(this.chao);
    }
    async personagem(blob) {
      const { vrm, nos } = await this.abrirVRM(blob);
      const caixa = new window.THREE.Box3().setFromObject(vrm.scene);
      this.enquadrarPessoa(Math.max(0.5, caixa.max.y));
      let piscar = 2;
      this.aoQuadro = (dt) => {
        // respira e pisca
        if (nos.chest || nos.spine) (nos.chest || nos.spine).rotation.x = Math.sin(this.t * 1.6) * 0.012;
        piscar -= dt;
        const em = vrm.expressionManager;
        if (em) { em.setValue("blink", piscar < 0.12 ? 1 : 0); if (piscar < 0) piscar = 2 + Math.random() * 3; }
        vrm.update(dt);
      };
    }
    async mundo(blob) {
      const T = window.THREE, V = window.CompanhiaVRM;
      const carregador = new V.GLTFLoader(), draco = new V.DRACOLoader();
      draco.setDecoderPath(new URL("vendor/draco/", location.href).href);
      carregador.setDRACOLoader(draco);
      carregador.setMeshoptDecoder(V.MeshoptDecoder);
      const url = URL.createObjectURL(blob);
      let gltf;
      try { gltf = await carregador.loadAsync(url); } finally { URL.revokeObjectURL(url); draco.dispose(); }
      const cena = gltf.scene;
      cena.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
      this.cena.add(cena);
      this.objeto = cena;
      // um mapa com animações (moinho, água...): elas já tocam na prévia
      if (gltf.animations && gltf.animations.length) {
        const mixer = new T.AnimationMixer(cena);
        for (const c of gltf.animations) mixer.clipAction(c).play();
        this.aoQuadro = (dt) => mixer.update(dt);
        this.animado = gltf.animations.length;
      }
      const caixa = new T.Box3().setFromObject(cena), centro = caixa.getCenter(new T.Vector3()), raio = Math.max(0.5, caixa.getSize(new T.Vector3()).length() / 2);
      const o = this.olhar;
      o.alvo.copy(centro);
      o.dist = raio * 2.1;
      o.inclina = 0.6;
      o.giro = 0.6;
      o.min = raio * 0.2;
      o.max = raio * 8;
      this.camera.near = Math.max(0.01, raio / 500);
      this.camera.far = raio * 40;
      this.camera.updateProjectionMatrix();
    }
    async animacao(blob, arquivo) {
      const T = window.THREE;
      const clip = await C.movimentos.clipDoArquivo(blob, arquivo || "animacao.bvh");
      const { vrm, nos, pose, quadril } = await this.abrirVRM(C.bonecoPadrao([0.36, 0.62, 0.95]));
      this.enquadrarPessoa(1.6);
      this.olhar.dist *= 1.15;
      const an = (this.animador = new C.Animador());
      an.definirDescanso(C.poseDescanso(1.2));
      an.tocar(clip, { transicao: 0 });
      this.duracao = clip.duration;
      const altura = Math.max(0.05, quadril.y);
      this.aoQuadro = (dt) => {
        an.atualizar(this.parado ? 0 : dt);
        pose((n) => an.nos[n] && an.nos[n].quaternion);
        // o quadril sobe e desce com o movimento (em alturas do quadril), mas não sai do lugar (para não sair da vitrine)
        if (nos.hips) nos.hips.position.set(quadril.x, quadril.y + an.nos.hips.position.y * altura, quadril.z);
        vrm.update(dt);
      };
    }
    /** Para a animação num ponto (0 a 1), para a miniatura. */
    pausarEm(fracao) {
      if (!this.animador || !this.animador.acao) return;
      this.animador.acao.time = (this.duracao || 0) * fracao;
      this.parado = true;
      this.aoQuadro && this.aoQuadro(0);
    }
    /** A miniatura (quadrada), do ângulo de agora. */
    async foto(lado = 384) {
      const r = this.renderer, tela = r.domElement, antes = [tela.width, tela.height], aspecto = this.camera.aspect, girando = this.olhar.girando;
      this.olhar.girando = false;
      r.setPixelRatio(1);
      r.setSize(lado, lado, false);
      this.camera.aspect = 1;
      this.camera.updateProjectionMatrix();
      this.posicionarCamera();
      r.render(this.cena, this.camera);
      const blob = await new Promise((ok) => tela.toBlob((b) => ok(b), "image/webp", 0.86));
      const png = blob && blob.type === "image/webp" ? blob : await new Promise((ok) => tela.toBlob(ok, "image/png"));
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.setSize(antes[0] / r.getPixelRatio(), antes[1] / r.getPixelRatio(), false);
      this.camera.aspect = aspecto;
      this.camera.updateProjectionMatrix();
      this.redimensionar();
      this.olhar.girando = girando;
      return png;
    }
    destruir() {
      this.limpar();
      cancelAnimationFrame(this.quadro);
      this.observador.disconnect();
      if (this.cena.environment) this.cena.environment.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
  C.Vitrine = Vitrine;

  // ── A loja (a tela) ──────────────────────────────────────────────────

  const quando = (s) => {
    const d = (Date.now() / 1000 - s) / 86400;
    return d < 1 ? "hoje" : d < 2 ? "ontem" : d < 30 ? `há ${Math.floor(d)} dias` : new Date(s * 1000).toLocaleDateString("pt-BR");
  };

  /** O cartão de um item: a prévia em cima e, embaixo, o nome, quem publicou, as curtidas e quantos baixaram. */
  /** O crédito de um item que veio de fora (o Sketchfab): o nome, quem fez, o site e a licença, com os links. */
  C.creditoDoItem = function (item) {
    const o = item.origem || {}, l = item.licenca || {};
    const link = (texto, url) => (url && /^https?:\/\//.test(url) ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow", translate: "no" }, texto) : el("span", { translate: "no" }, texto));
    return LNUX.filhos(t("Original:") + " ", link("“" + item.nome + "”", o.url), " — ", link(o.autor || "?", o.autor_url), ` · ${o.site || ""}`, l.nome ? " · " : null, l.nome ? link(l.nome, l.url) : null);
  };

  /**
   * Trazer mapas do Sketchfab para a loja (só o dono do servidor): buscar, ver a licença de cada um e trazer. A chave do
   * Sketchfab fica no servidor (chaves.json); o servidor baixa o modelo, converte para .glb e põe na loja com o crédito.
   * Resolve com o item que entrou na loja (ou null).
   */
  C.janelaSketchfab = async function () {
    let estado;
    try { estado = await C.loja.sketchfab.estado(); } catch (e) { LNUX.erro(e); return null; }
    let resolvido = null, cursor = "", busca = "", animado = false;
    const chaveCampo = el("input", { class: "lnux-entrada", type: "password", autocomplete: "off", placeholder: "Cole a sua chave da API do Sketchfab", "aria-label": "Chave da API do Sketchfab" });
    const areaChave = el("div", { class: "sketchfab-chave" });
    const campo = el("input", { class: "lnux-entrada", type: "search", placeholder: "Procurar mapas no Sketchfab (ex.: praça, castelo, fnaf)", "aria-label": "Procurar no Sketchfab", "data-enter-proprio": "1" });
    const soAnimados = el("input", { type: "checkbox", "aria-label": "Só os com animação" });
    const grade = el("div", { class: "sketchfab-grade" });
    const mais = el("button", { type: "button", class: "lnux-botao", hidden: true, onclick: () => buscar(true) }, "Mais resultados");
    const aviso = el("p", { class: "fraco pequeno", style: { margin: 0 } });
    const tags = el("input", { class: "lnux-entrada", placeholder: "# para achar na loja (opcional)", "aria-label": "# para achar na loja" });
    function desenharChave() {
      areaChave.replaceChildren(...LNUX.filhos(
        estado.chave ? el("p", { class: "fraco pequeno", style: { margin: 0 } }, t("A chave do Sketchfab está guardada no servidor."), " ",
          el("button", { type: "button", class: "lnux-botao plano conta-link", onclick: () => { estado.chave = false; desenharChave(); } }, t("Trocar a chave")))
          : el("div", { class: "linha" }, chaveCampo, el("button", { type: "button", class: "lnux-botao primario", id: "sketchfab-guardar-chave", onclick: async () => {
            try { estado = { ...estado, ...(await C.loja.sketchfab.chave(chaveCampo.value.trim())) }; chaveCampo.value = ""; desenharChave(); LNUX.aviso(t("Chave do Sketchfab guardada no servidor."), "ok"); } catch (e) { LNUX.erro(e); }
          } }, t("Guardar a chave"))),
        estado.chave ? null : el("p", { class: "fraco pequeno", style: { margin: 0 } }, t("Para baixar, o Sketchfab pede a chave da sua conta (sketchfab.com › Configurações › Senha e API). Ela fica só no servidor, nunca no navegador."))));
    }
    async function buscar(continuar) {
      if (!continuar) { cursor = ""; grade.replaceChildren(el("p", { class: "fraco" }, t("Procurando..."))); }
      busca = campo.value.trim();
      animado = soAnimados.checked;
      try {
        const r = await C.loja.sketchfab.buscar(busca, { animado, cursor });
        if (!continuar) grade.replaceChildren();
        for (const m of r.modelos) grade.append(cartao(m));
        if (!grade.children.length) grade.append(el("p", { class: "fraco" }, t("Nada com esse nome.")));
        cursor = r.proximo || "";
        mais.hidden = !cursor;
      } catch (e) { grade.replaceChildren(el("p", { class: "conta-msg erro" }, e.message)); }
    }
    function cartao(m) {
      const trazer = el("button", { type: "button", class: "lnux-botao primario pequeno", disabled: !m.pode_loja, "data-uid": m.uid,
        title: m.pode_loja ? "" : "A licença deste modelo não deixa redistribuir: ele não pode ir para a loja.", onclick: () => importar(m, trazer) }, m.pode_loja ? t("Trazer para a loja") : t("Licença não deixa"));
      return el("article", { class: "sketchfab-cartao" + (m.pode_loja ? "" : " bloqueado"), "data-uid": m.uid },
        el("div", { class: "capa" }, m.miniatura ? el("img", { src: m.miniatura, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
          m.animacoes ? el("span", { class: "selo-novo" }, t("animado")) : null),
        el("div", { class: "sketchfab-info" },
          el("b", { translate: "no" }, m.nome),
          el("span", { class: "fraco pequeno", translate: "no" }, m.autor),
          el("span", { class: "sketchfab-licenca" + (m.pode_loja ? " livre" : "") }, m.licenca_nome || "?"),
          el("div", { class: "linha" }, trazer, /^https?:\/\//.test(m.url || "") ? el("a", { class: "lnux-botao plano pequeno", href: m.url, target: "_blank", rel: "noopener noreferrer nofollow" }, t("Ver no Sketchfab")) : null)));
    }
    async function importar(m, botao) {
      if (!estado.chave) { LNUX.aviso(t("Falta a chave do Sketchfab."), "alerta"); chaveCampo.focus(); return; }
      botao.disabled = true;
      const prog = LNUX.progresso(t("Trazendo do Sketchfab"));
      prog.definir(0.15, t("Baixando \"{nome}\" e convertendo para .glb...", { nome: m.nome }));
      try {
        const r = await C.loja.sketchfab.importar(m.uid, tags.value);
        resolvido = r.item;
        LNUX.aviso(t("\"{nome}\" está na loja.", { nome: r.item.nome }), "ok");
        janela.fechar(r.item);
      } catch (e) { LNUX.erro(e); botao.disabled = false; }
      finally { prog.fechar(); }
    }
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscar(false); } });
    soAnimados.addEventListener("change", () => buscar(false));
    desenharChave();
    const corpo = el("div", { class: "ajustes janela-sketchfab" }, areaChave,
      el("div", { class: "linha" }, campo, el("button", { type: "button", class: "lnux-botao primario", id: "sketchfab-buscar", onclick: () => buscar(false) }, t("Procurar"))),
      el("label", { class: "lnux-alternar" }, soAnimados, t("Só os com animação (moinhos, água, portas...)")),
      el("label", { class: "lnux-campo" }, el("span", {}, t("# (categorias)")), tags),
      grade, mais, aviso,
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, t("Só entram na loja os modelos com licença Creative Commons que deixa redistribuir (CC0, BY, BY-SA, BY-NC, BY-NC-SA), com o crédito de quem fez. Os comprados (licença Standard) não podem ir para a loja.")));
    const janela = LNUX.dialogo({ titulo: t("Mapas do Sketchfab"), largo: true, corpo, botoes: [{ rotulo: "Fechar", valor: null }], aoAbrir: () => { buscar(false); campo.focus(); } });
    const r = await janela;
    return resolvido || (r && r.id ? r : null);
  };

  C.cartaoDaLoja = function (item, { aoAbrir = () => {}, aoCurtir = null } = {}) {
    const tp = TIPOS[item.tipo];
    const capa = el("div", { class: "capa" }, item.miniatura ? el("img", { src: C.loja.miniatura(item), alt: "", loading: "lazy" }) : el("span", { class: "sem-miniatura", "aria-hidden": "true" }, tp.icone),
      el("span", { class: "selo-tipo" }, tp.um));
    if (Date.now() / 1000 - item.criado < 3 * 86400) capa.append(el("span", { class: "selo-novo" }, "Novo"));
    const curtir = el("button", { type: "button", class: "webc-curtir" + (item.curti ? " curti" : ""), "aria-pressed": String(!!item.curti), title: item.curti ? "Descurtir" : "Curtir", "aria-label": item.curti ? "Descurtir" : "Curtir",
      onclick: (e) => { e.stopPropagation(); if (aoCurtir) aoCurtir(item); } }, C.iconeWebc ? C.iconeWebc("coracao") : "♥", el("span", { class: "numero" }, String(item.curtidas || 0)));
    const cartao = el("article", { class: "cartao-loja webc-item", role: "listitem", tabindex: 0, "data-id": item.id, "data-tipo": item.tipo, onclick: () => aoAbrir(item),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoAbrir(item); } } },
      capa,
      el("div", { class: "webc-item-info" },
        el("span", { class: "nome", translate: "no" }, item.nome),
        el("span", { class: "autor" }, item.autor ? t("por {autor}", { autor: item.autor }) : t("sem autor")),
        item.tags && item.tags.length ? el("span", { class: "webc-tags", translate: "no" }, item.tags.slice(0, 3).map((x) => "#" + x).join(" ")) : null,
        el("div", { class: "webc-item-numeros" }, curtir, el("span", { class: "webc-baixados", title: "Quantas pessoas baixaram" }, C.iconeWebc ? C.iconeWebc("baixar") : "⤓", el("span", { class: "numero" }, String(item.baixados || 0))))));
    return cartao;
  };

  /**
   * Abre a loja. opcoes: {tipo (aba inicial), aoUsar(item, blob) (o que "Usar" faz; padrão: ctx.usar), dentro (o
   * lugar: numa página do WEBC; sem ele, por cima de tudo), pagina (sem o botão de fechar), item (abre direto),
   * busca}.
   * ctx (do app): {usar(item, blob), fontes(tipo) → [{id, nome}], arquivoDaFonte(tipo, id) → {blob, arquivo, nome},
   *                arquivoDoAparelho(tipo) → {blob, arquivo, nome} | null, autor()}.
   * Devolve uma Promise que resolve quando a loja fecha.
   */
  C.abrirLoja = function (ctx, { tipo = "", aoUsar = null, dentro = null, pagina = false, item: itemInicial = "", busca: buscaInicial = "" } = {}) {
    let fechar;
    const terminou = new Promise((ok) => (fechar = ok));
    let dados = { itens: [], publicar: false, dono: false }, aba = TIPOS[tipo] ? tipo : "personagem", busca = "", vitrine = null, aberto = null, miniaturas = null;
    let ordem = "curtidos", soSalvos = false;
    const grade = el("div", { class: "loja-grade webc-grade", role: "list" });
    const abas = el("nav", { class: "loja-abas webc-abas", role: "tablist" });
    const campo = el("input", { type: "search", class: "loja-busca webc-busca-campo", placeholder: "pesquisa", "aria-label": "Procurar na loja", value: buscaInicial });
    const dono = el("div", { class: "loja-dono", hidden: true });
    const detalhe = el("section", { class: "loja-detalhe", hidden: true, "aria-live": "polite" });
    const vazio = el("div", { class: "loja-vazio", hidden: true });
    const filtro = el("div", { class: "webc-filtro-painel", hidden: true });
    const botaoFiltro = el("button", { type: "button", class: "webc-filtro", "aria-expanded": "false", onclick: () => { filtro.hidden = !filtro.hidden; botaoFiltro.setAttribute("aria-expanded", String(!filtro.hidden)); desenharFiltro(); } },
      el("span", {}, "filtro"), C.iconeWebc ? C.iconeWebc("filtro") : "⏷");
    const publicar = el("button", { class: "lnux-botao primario", type: "button", id: "loja-publicar", onclick: () => janelaPublicar(ctx, { tipo: aba || "personagem" }).then((item) => { if (item) { recarregar().then(() => abrirItem(item.id)); } }).catch(LNUX.erro) }, "＋ Publicar");
    const botaoSketchfab = el("button", { class: "lnux-botao", type: "button", id: "loja-sketchfab", hidden: true, title: "Trazer mapas do Sketchfab",
      onclick: () => C.janelaSketchfab().then((item) => { if (item) { aba = "mundo"; recarregar().then(() => abrirItem(item.id)); } }).catch(LNUX.erro) }, "Sketchfab");
    const caixa = el("div", { class: "loja webc-loja" + (pagina ? " em-pagina" : ""), role: pagina ? "region" : "dialog", "aria-label": "Loja", "aria-modal": pagina ? undefined : "true" },
      el("header", { class: "loja-topo webc-painel-topo" },
        el("h1", { class: "webc-painel-titulo" }, "LOJA"),
        el("label", { class: "webc-busca" }, C.iconeWebc ? C.iconeWebc("busca") : "🔍", campo),
        el("span", { class: "webc-espaco" }),
        botaoSketchfab, publicar, botaoFiltro,
        pagina ? null : el("button", { class: "lnux-botao icone plano", type: "button", "aria-label": "Fechar a loja", title: "Fechar", html: LNUX.icone("fechar"), onclick: () => sair() })),
      filtro, abas, dono, grade, vazio, detalhe);
    (dentro || document.body).append(caixa);
    const teclas = (e) => {
      if (e.key !== "Escape" || document.querySelector(".lnux-fundo-modal")) return;
      if (!detalhe.hidden) { e.preventDefault(); voltar(); return; }
      if (!pagina) { e.preventDefault(); sair(); }
    };
    document.addEventListener("keydown", teclas);
    const pararDeOuvir = C.contas ? C.contas.aoMudar(() => recarregar().catch(() => {})) : () => {};
    function sair() {
      document.removeEventListener("keydown", teclas);
      pararDeOuvir();
      if (vitrine) { vitrine.destruir(); vitrine = null; }
      if (miniaturas) miniaturas.parar = true;
      caixa.remove();
      fechar();
    }
    busca = buscaInicial.trim().toLowerCase();
    campo.addEventListener("input", () => {
      busca = campo.value.trim().toLowerCase();
      if (!detalhe.hidden) voltar();
      // nada nesta categoria, mas há em outra: vai para ela (quem pesquisa "praça" nas personagens acha o mapa)
      if (busca && !filtrados().length) { const outra = Object.keys(TIPOS).find((tp) => filtrados(tp).length); if (outra) { aba = outra; desenharFiltro(); } }
      desenharAbas();
      desenharGrade();
    });

    function desenharAbas() {
      const conta = (tp) => dados.itens.filter((i) => i.tipo === tp && passa(i)).length; // com uma pesquisa: quantos acharam em cada categoria
      abas.replaceChildren(...Object.entries(TIPOS).map(([tp, x]) =>
        el("button", { type: "button", role: "tab", class: "loja-aba" + (aba === tp ? " ativa" : ""), "aria-selected": String(aba === tp), "data-tipo": tp,
          onclick: () => { aba = tp; voltar(); desenharAbas(); desenharGrade(); desenharFiltro(); } }, x.nome, el("span", { class: "conta" }, String(conta(tp))))));
    }
    /** O filtro: a ordem, só os salvos e os # mais usados nesta categoria. */
    function desenharFiltro() {
      if (filtro.hidden) return;
      const contagem = new Map();
      for (const i of dados.itens) if (i.tipo === aba) for (const tg of i.tags || []) contagem.set(tg, (contagem.get(tg) || 0) + 1);
      const populares = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 16);
      const opcao = (v, r) => el("button", { type: "button", class: "webc-chip" + (ordem === v ? " ativo" : ""), "data-ordem": v, onclick: () => { ordem = v; desenharFiltro(); desenharGrade(); } }, r);
      const salvos = el("input", { type: "checkbox", checked: soSalvos, disabled: !(C.contas && C.contas.eu), "aria-label": "Só os que eu salvei" });
      salvos.addEventListener("change", () => { soSalvos = salvos.checked; desenharAbas(); desenharGrade(); });
      filtro.replaceChildren(...LNUX.filhos(
        el("div", { class: "webc-filtro-linha" }, el("span", { class: "fraco pequeno" }, "Ordenar:"), opcao("curtidos", "Mais curtidos"), opcao("baixados", "Mais baixados"), opcao("novos", "Mais novos"), opcao("nome", "Nome")),
        el("label", { class: "lnux-alternar" }, salvos, "Só os que eu salvei no perfil"),
        populares.length ? el("div", { class: "webc-filtro-linha" }, el("span", { class: "fraco pequeno" }, "#:"),
          populares.map(([tg, n]) => el("button", { type: "button", class: "webc-chip" + (busca === "#" + tg ? " ativo" : ""), "data-tag": tg, translate: "no", onclick: () => { campo.value = busca === "#" + tg ? "" : "#" + tg; campo.dispatchEvent(new Event("input")); desenharFiltro(); } }, `#${tg} (${n})`))) : null));
    }
    async function curtirItem(item) {
      if (!(C.contas && C.contas.eu)) {
        LNUX.aviso("Entre na sua conta para curtir.", "alerta");
        if (C.janelaConta && (C.contas.publico || {}).contas) C.janelaConta("entrar");
        return;
      }
      try {
        const r = await C.loja.curtir(item, !item.curti);
        Object.assign(item, r);
        desenharGrade();
        if (aberto === item) desenharNumeros(item);
      } catch (e) { LNUX.erro(e); }
    }
    /** O item passa na pesquisa (pelo nome, autor, descrição ou #) e no "só os salvos"? */
    function passa(i) {
      const tag = busca.startsWith("#") ? busca.slice(1) : "";
      return (!soSalvos || (C.contas && C.contas.salvou(i.id))) &&
        (!busca || (tag ? (i.tags || []).includes(tag) : (i.nome + " " + i.autor + " " + i.descricao + " " + (i.tags || []).join(" ")).toLowerCase().includes(busca)));
    }
    function filtrados(tipo = aba) {
      const l = dados.itens.filter((i) => i.tipo === tipo && passa(i));
      const por = { curtidos: (a, b) => (b.curtidas || 0) - (a.curtidas || 0) || b.criado - a.criado, baixados: (a, b) => (b.baixados || 0) - (a.baixados || 0) || b.criado - a.criado,
        novos: (a, b) => b.criado - a.criado, nome: (a, b) => a.nome.localeCompare(b.nome) }[ordem];
      return l.sort(por);
    }
    function desenharGrade() {
      const lista = filtrados();
      grade.replaceChildren(...lista.map((i) => C.cartaoDaLoja(i, { aoAbrir: (x) => abrirItem(x.id), aoCurtir: curtirItem })));
      vazio.hidden = !!lista.length || !detalhe.hidden;
      vazio.replaceChildren(...LNUX.filhos(el("p", { style: { margin: 0 } }, busca ? (busca.startsWith("#") ? t("Nada com o {tag}.", { tag: busca }) : "Nada com esse nome.") : t("Ainda não há {tipo} na loja.", { tipo: t(TIPOS[aba].nome).toLowerCase() })),
        dados.publicar || dados.dono ? el("p", { class: "fraco", style: { margin: 0 } }, "Seja a primeira pessoa a publicar: ＋ Publicar.") : null));
    }
    function desenharDono() {
      dono.hidden = !dados.dono;
      botaoSketchfab.hidden = !dados.dono;
      if (!dados.dono) return;
      const caixaPublicar = el("input", { type: "checkbox", checked: dados.publicar });
      caixaPublicar.addEventListener("change", async () => {
        try { dados.publicar = (await C.loja.configurar({ publicar: caixaPublicar.checked })).publicar; LNUX.aviso(dados.publicar ? "Os visitantes podem publicar na loja." : "Só você publica na loja agora.", "ok"); }
        catch (e) { caixaPublicar.checked = dados.publicar; LNUX.erro(e); }
      });
      dono.replaceChildren(el("label", { class: "lnux-alternar" }, caixaPublicar, "Deixar quem entra pelo link publicar"));
    }
    async function recarregar() {
      dados = await C.loja.lista();
      publicar.hidden = !(dados.publicar || dados.dono);
      desenharAbas();
      desenharDono();
      desenharGrade();
      desenharFiltro();
      gerarMiniaturas();
      if (aberto) { const novo = dados.itens.find((i) => i.id === aberto.id); if (novo) { Object.assign(aberto, novo); desenharNumeros(aberto); } }
    }
    function voltar() {
      if (vitrine) { vitrine.destruir(); vitrine = null; }
      aberto = null;
      detalhe.hidden = true;
      grade.hidden = false;
      abas.hidden = false;
      vazio.hidden = !!filtrados().length;
    }
    let numeros = null;
    function desenharNumeros(item) {
      if (!numeros) return;
      const salvo = C.contas && C.contas.salvou(item.id);
      numeros.replaceChildren(
        el("button", { type: "button", class: "lnux-botao webc-curtir" + (item.curti ? " curti" : ""), id: "loja-curtir", "aria-pressed": String(!!item.curti), onclick: () => curtirItem(item) },
          C.iconeWebc ? C.iconeWebc("coracao") : "♥", el("span", { class: "numero" }, String(item.curtidas || 0)), " ", item.curti ? t("Curtido") : t("Curtir")),
        el("span", { class: "webc-baixados", title: "Quantas pessoas baixaram" }, C.iconeWebc ? C.iconeWebc("baixar") : "⤓", el("span", { class: "numero" }, String(item.baixados || 0)), " ", t("baixaram")),
        C.contas && C.contas.eu ? el("button", { type: "button", class: "lnux-botao" + (salvo ? " ativo" : ""), id: "loja-salvar", "aria-pressed": String(!!salvo),
          onclick: async () => { try { await C.contas.salvar(item.id, !salvo); desenharNumeros(item); LNUX.aviso(salvo ? t("Saiu do seu perfil.") : t("Salvo no seu perfil."), "ok"); } catch (e) { LNUX.erro(e); } } },
          C.iconeWebc ? C.iconeWebc("salvar") : "🔖", " ", salvo ? t("Salvo no perfil") : t("Salvar no perfil")) : null);
    }
    async function abrirItem(id) {
      const item = dados.itens.find((i) => i.id === id);
      if (!item) return;
      if (item.tipo !== aba) { aba = item.tipo; desenharAbas(); }
      aberto = item;
      const tp = TIPOS[item.tipo];
      grade.hidden = true;
      abas.hidden = true;
      vazio.hidden = true;
      detalhe.hidden = false;
      const palco = el("div", { class: "vitrine" }, el("div", { class: "vitrine-aviso" }, "Carregando a prévia..."));
      const usar = el("button", { class: "lnux-botao primario", type: "button", id: "loja-usar" }, tp.usar);
      const baixarArquivo = el("button", { class: "lnux-botao", type: "button" }, "Baixar o arquivo");
      const mexe = C.loja.podeMexer(item, dados.dono);
      const apagar = mexe ? el("button", { class: "lnux-botao perigo", type: "button" }, "Apagar da loja") : null;
      numeros = el("div", { class: "loja-numeros" });
      const tags = el("div", { class: "webc-tags-lista" });
      const desenharTags = () => tags.replaceChildren(...(item.tags || []).map((tg) => el("button", { type: "button", class: "webc-chip", translate: "no", onclick: () => { campo.value = "#" + tg; campo.dispatchEvent(new Event("input")); } }, "#" + tg)),
        mexe ? el("button", { type: "button", class: "webc-chip plano", id: "loja-editar-tags", onclick: async () => {
          const c = el("input", { class: "lnux-entrada", value: (item.tags || []).map((x) => "#" + x).join(" "), "aria-label": "#", placeholder: "#fnaf #anime" });
          const r = await LNUX.dialogo({ titulo: t("Os # deste item"), corpo: el("div", { class: "ajustes" }, el("label", { class: "lnux-campo" }, el("span", {}, "Separe por espaço ou vírgula (até 12)"), c)), aoAbrir: () => c.focus(),
            botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", primario: true, valor: () => c.value }] });
          if (r === null || r === undefined) return;
          try { Object.assign(item, await C.loja.editar(item, { tags: C.loja.tags(r) })); desenharTags(); desenharGrade(); } catch (e) { LNUX.erro(e); }
        } }, (item.tags || []).length ? "✎ #" : "＋ #") : null);
      desenharTags();
      detalhe.replaceChildren(
        el("button", { class: "lnux-botao plano loja-voltar", type: "button", onclick: voltar }, C.iconeWebc ? C.iconeWebc("voltar") : "←", " ", t("Voltar à loja")),
        el("div", { class: "loja-produto" }, palco,
          el("div", { class: "loja-ficha" },
            el("span", { class: "selo-tipo" }, tp.icone + " " + tp.um),
            el("h2", { translate: "no" }, item.nome),
            el("p", { class: "fraco", style: { margin: 0 } }, ...LNUX.filhos(
              item.autor ? (item.conta && C.webc ? el("button", { type: "button", class: "webc-link-autor", translate: "no", onclick: () => C.webc.verPerfil(item.conta) }, t("por {autor}", { autor: item.autor })) : el("span", { translate: "no" }, t("por {autor}", { autor: item.autor }))) : null,
              " · " + [quando(item.criado), LNUX.bytes(item.tamanho)].filter(Boolean).join(" · "))),
            tags,
            item.origem ? el("p", { class: "loja-credito" }, ...C.creditoDoItem(item)) : null,
            item.animacoes ? el("p", { class: "fraco pequeno loja-animado", style: { margin: 0 } }, t(item.animacoes > 1 ? "Com {n} animações: elas tocam no jogo." : "Com 1 animação: ela toca no jogo.", { n: item.animacoes })) : null,
            item.descricao ? el("p", { class: "loja-descricao", translate: "no" }, item.descricao) : null,
            numeros,
            el("p", { class: "fraco pequeno", style: { margin: 0 } }, item.tipo === "personagem" ? "Arraste para girar; a rodinha aproxima. Usar guarda a personagem entre as suas." :
              item.tipo === "mundo" ? "Arraste para girar; a rodinha aproxima. Usar guarda o mapa em Movimento › Cenário." : "A animação, num boneco. Usar guarda em Movimento › Pacotes de movimento."),
            el("div", { class: "loja-acoes" }, usar, baixarArquivo, apagar))));
      desenharNumeros(item);
      let blob = null;
      const pegar = async (titulo) => {
        if (blob) return blob;
        const prog = LNUX.progresso(titulo);
        try { blob = await C.loja.baixar(item, (f) => prog.definir(f, `${LNUX.bytes(item.tamanho * f)} / ${LNUX.bytes(item.tamanho)}`)); }
        finally { prog.fechar(); }
        return blob;
      };
      const contar = () => C.loja.baixou(item).then((r) => { if (r) { item.baixados = r.baixados; desenharNumeros(item); } });
      usar.addEventListener("click", async () => {
        try {
          const b = await pegar(t("Baixando \"{nome}\"", { nome: item.nome }));
          contar();
          const fim = await (aoUsar || ctx.usar)(item, b);
          if (fim !== false) { if (pagina) voltar(); else sair(); }
        } catch (e) { LNUX.erro(e); }
      });
      baixarArquivo.addEventListener("click", async () => { try { LNUX.baixar(await pegar(t("Baixando \"{nome}\"", { nome: item.nome })), item.arquivo); contar(); } catch (e) { LNUX.erro(e); } });
      if (apagar) apagar.addEventListener("click", async () => {
        if (!(await LNUX.confirmar(t("Apagar da loja"), t("Apagar \"{nome}\" da loja? Quem já usou continua com a cópia dele.", { nome: item.nome }), { rotulo: t("Apagar"), perigo: true }))) return;
        try { await C.loja.apagar(item); voltar(); await recarregar(); LNUX.aviso(t("\"{nome}\" saiu da loja.", { nome: item.nome }), "ok"); } catch (e) { LNUX.erro(e); }
      });
      // a prévia: baixa e mostra em 3D
      try {
        blob = await C.loja.baixar(item, (f) => { const a = palco.querySelector(".vitrine-aviso"); if (a) a.textContent = `${t("Carregando a prévia...")} ${Math.round(f * 100)}%`; });
        if (aberto !== item) return;
        await C.prepararVRM();
        if (vitrine) vitrine.destruir();
        vitrine = new Vitrine(palco);
        await vitrine.mostrar(item.tipo, blob, item.arquivo);
        if (aberto !== item) return;
        const aviso = palco.querySelector(".vitrine-aviso");
        if (aviso) aviso.remove();
        palco.dataset.pronta = "1";
        // sem miniatura e com direito de pôr: tira agora, da prévia
        if (!item.miniatura && C.loja.podeMexer(item, dados.dono)) {
          await LNUX.esperar(600);
          if (vitrine && aberto === item) { if (item.tipo === "animacao") vitrine.pausarEm(0.4); await C.loja.trocarMiniatura(item, await vitrine.foto()); }
        }
      } catch (e) {
        const aviso = palco.querySelector(".vitrine-aviso");
        if (aviso) aviso.textContent = t("A prévia não abriu: {erro}", { erro: e.message });
      }
    }
    /** O dono da loja (ou quem publicou) gera as miniaturas que faltam, uma de cada vez, numa vitrine escondida. */
    async function gerarMiniaturas() {
      if (miniaturas) return;
      const faltam = dados.itens.filter((i) => !i.miniatura && C.loja.podeMexer(i, dados.dono)).slice(0, 8);
      if (!faltam.length) return;
      const estado = (miniaturas = { parar: false });
      const escondido = el("div", { class: "vitrine-escondida", "aria-hidden": "true" });
      document.body.append(escondido);
      let v = null;
      try {
        await C.prepararVRM();
        v = new Vitrine(escondido);
        for (const item of faltam) {
          if (estado.parar) break;
          try {
            await v.mostrar(item.tipo, await C.loja.baixar(item), item.arquivo);
            await LNUX.esperar(300);
            if (item.tipo === "animacao") v.pausarEm(0.4);
            await C.loja.trocarMiniatura(item, await v.foto());
            item.miniatura = Math.floor(Date.now() / 1000);
            const c = grade.querySelector(`[data-id="${item.id}"] .capa`);
            if (c) { const s = c.querySelector(".sem-miniatura"); if (s) s.replaceWith(el("img", { src: C.loja.miniatura(item), alt: "" })); }
          } catch (e) { console.warn("loja: a miniatura de " + item.nome + " não saiu", e); }
        }
      } finally { if (v) v.destruir(); escondido.remove(); miniaturas = null; }
    }
    recarregar().then(() => { if (itemInicial) abrirItem(itemInicial); }).catch((e) => { LNUX.erro(e); if (!pagina) sair(); });
    caixa.recarregar = recarregar;
    caixa.abrirItem = abrirItem;
    return Object.assign(terminou, { fechar: sair, elemento: caixa });
  };

  /**
   * Publicar na loja: escolhe o tipo e o que publicar (uma das suas personagens, um dos seus cenários ou movimentos,
   * ou um arquivo do aparelho), mostra a prévia, e manda com a miniatura. Devolve o item publicado (ou null).
   */
  async function janelaPublicar(ctx, { tipo = "personagem" } = {}) {
    let fonte = null, vitrine = null, d = null;
    const seletorTipo = el("div", { class: "loja-tipos", role: "radiogroup", "aria-label": "O que publicar" });
    const lista = el("select", { class: "lnux-selecao", "aria-label": "Qual" });
    const nome = el("input", { class: "lnux-entrada", maxlength: 60, "aria-label": "Nome na loja" });
    const descricao = el("textarea", { class: "lnux-entrada", rows: 3, maxlength: 600, "aria-label": "Descrição", placeholder: "Conte o que é (opcional)" });
    const autor = el("input", { class: "lnux-entrada", maxlength: 40, value: ctx.autor ? ctx.autor() : "", "aria-label": "Seu nome", placeholder: "Como os outros vão te ver" });
    const tags = el("input", { class: "lnux-entrada", maxlength: 200, "aria-label": "# (categorias)", placeholder: "#fnaf #anime #terror", translate: "no" });
    const previa = el("div", { class: "vitrine vitrine-publicar" }, el("div", { class: "vitrine-aviso" }, "Escolha o que publicar."));
    const desenharTipos = () => seletorTipo.replaceChildren(...Object.entries(TIPOS).map(([t, x]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(t === tipo), class: "loja-aba" + (t === tipo ? " ativa" : ""), "data-tipo": t, onclick: () => { tipo = t; desenharTipos(); carregarLista(); } }, x.icone + " " + x.um)));
    async function carregarLista() {
      const itens = await ctx.fontes(tipo);
      lista.replaceChildren(el("option", { value: "" }, itens.length ? "Escolha..." : "(nenhuma ainda)"), ...itens.map((i) => el("option", { value: i.id }, i.nome)),
        el("option", { value: "@arquivo" }, "Um arquivo do seu aparelho..."));
      fonte = null;
      mostrarPrevia(null);
    }
    async function mostrarPrevia(f) {
      fonte = f;
      if (vitrine) { vitrine.destruir(); vitrine = null; }
      previa.replaceChildren(el("div", { class: "vitrine-aviso" }, f ? "Carregando a prévia..." : "Escolha o que publicar."));
      if (!f) return;
      if (!nome.value || nome.dataset.auto === "1") { nome.value = f.nome; nome.dataset.auto = "1"; }
      try {
        await C.prepararVRM();
        vitrine = new Vitrine(previa);
        await vitrine.mostrar(tipo, f.blob, f.arquivo);
        const a = previa.querySelector(".vitrine-aviso");
        if (a) a.remove();
        previa.dataset.pronta = "1";
      } catch (e) {
        fonte = null;
        const a = previa.querySelector(".vitrine-aviso");
        if (a) a.textContent = "Não deu para mostrar: " + e.message;
      }
    }
    nome.addEventListener("input", () => { nome.dataset.auto = "0"; });
    lista.addEventListener("change", async () => {
      try {
        if (lista.value === "@arquivo") { const f = await ctx.arquivoDoAparelho(tipo); lista.value = ""; if (f) await mostrarPrevia(f); return; }
        await mostrarPrevia(lista.value ? await ctx.arquivoDaFonte(tipo, lista.value) : null);
      } catch (e) { LNUX.erro(e); }
    });
    const corpo = el("div", { class: "ajustes loja-publicar" },
      seletorTipo,
      el("div", { class: "grade" },
        el("div", { class: "ajustes" },
          el("label", { class: "lnux-campo" }, el("span", {}, "O que publicar"), lista),
          el("label", { class: "lnux-campo" }, el("span", {}, "Nome na loja"), nome),
          C.contas && C.contas.eu ? null : el("label", { class: "lnux-campo" }, el("span", {}, "Seu nome (autor)"), autor),
          el("label", { class: "lnux-campo" }, el("span", {}, "# para achar (separe por espaço)"), tags,
            el("small", { class: "fraco" }, "Ex.: quem pesquisar fnaf acha o que tem #fnaf, mesmo sem fnaf no nome.")),
          el("label", { class: "lnux-campo" }, el("span", {}, "Descrição"), descricao)),
        previa),
      el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Quem entrar no WEBC pode ver, curtir e baixar. A miniatura é tirada da prévia (gire antes, se quiser). Publique só o que você pode compartilhar."));
    desenharTipos();
    await carregarLista();
    d = LNUX.dialogo({ titulo: "Publicar na loja", largo: true, corpo, botoes: [{ rotulo: "Cancelar", valor: null },
      { rotulo: "Publicar", primario: true, antes: async () => { if (!fonte) { LNUX.aviso("Escolha o que publicar (e espere a prévia).", "alerta"); return false; } return true; }, valor: () => "publicar" }] });
    const r = await d;
    try {
      if (r !== "publicar" || !fonte) return null;
      if (tipo === "animacao" && vitrine) vitrine.pausarEm(0.4);
      const miniatura = vitrine ? await vitrine.foto().catch(() => null) : null;
      const prog = LNUX.progresso("Publicando na loja");
      let item;
      try {
        item = await C.loja.publicar({ tipo, blob: fonte.blob, arquivo: fonte.arquivo, nome: nome.value.trim() || fonte.nome, descricao: descricao.value.trim(), autor: autor.value.trim(), tags: C.loja.tags(tags.value) },
          (f) => prog.definir(f * 0.95, `${LNUX.bytes(fonte.blob.size * f)} de ${LNUX.bytes(fonte.blob.size)}`));
        if (miniatura) await C.loja.trocarMiniatura(item, miniatura).catch((e) => console.warn("loja: miniatura", e));
      } finally { prog.fechar(); }
      if (ctx.lembrarAutor) ctx.lembrarAutor(autor.value.trim());
      LNUX.aviso(`"${item.nome}" está na loja.`, "ok");
      return item;
    } finally { if (vitrine) vitrine.destruir(); }
  }
  C.publicarNaLoja = janelaPublicar;
})();
