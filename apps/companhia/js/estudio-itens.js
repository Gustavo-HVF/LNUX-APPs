/*
 * WEBC — o Estúdio de itens (a página CRIAR do site). Ver docs/estudio-de-itens.md.
 *
 * À esquerda, adicionar partes (formas, modelo 3D, luz, partículas, lançador) e a lista delas; no meio, a cena (arrastar
 * no vazio gira a câmera, com o botão direito ou Shift move, a rodinha aproxima; arrastar uma parte a move, gira ou
 * muda o tamanho, livre ou num eixo); à direita, as propriedades da parte escolhida ou do item (nome e encaixe no corpo).
 * Vistas: o item sozinho, na mão de boneco (para acertar o encaixe) e no boneco inteiro. "Testar" põe uma parede na
 * frente para usar o item (E). Guarda no aparelho, publica na loja e exporta o .glb.
 *
 * No modo "ajustar no meu corpo" (um item baixado), só o encaixe muda, e fica guardado para esta pessoa.
 *
 * C.abrirEstudioItens(lugar, {id, ajustar, mochila}) → {fechar}.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const t = (s, v) => C.t(s, v);
  const RAD = Math.PI / 180;
  const arred = (v, p = 1000) => Math.round(v * p) / p;
  const NOMES_TIPO = { forma: "Forma", modelo: "Modelo 3D", luz: "Luz", particulas: "Partículas", lancador: "Lançador" };

  /** A mão de boneco (a direita, no espaço do osso: os dedos para -X, a palma para baixo, o polegar para a frente). */
  function maoDeBoneco(esquerda) {
    const T = window.THREE, g = new T.Group(), pele = new T.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.8 });
    const caixa = (x, y, z, w, h, d, rz = 0, ry = 0) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), pele); m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.castShadow = true; g.add(m); return m; };
    caixa(-0.045, 0, 0, 0.09, 0.028, 0.08);                    // a palma
    caixa(0.03, 0, 0, 0.07, 0.05, 0.065);                      // o pulso
    // os quatro dedos, fechados em volta de um cabo (o cabo passa por (-0.075, -0.03, 0), ao longo de Z)
    [-0.03, -0.01, 0.01, 0.03].forEach((z, i) => {
      const comp = i === 3 ? 0.8 : 1;
      caixa(-0.1, -0.006, z, 0.025 * comp, 0.018, 0.017);
      caixa(-0.115, -0.03, z, 0.018, 0.03 * comp, 0.016);
      caixa(-0.1, -0.052, z, 0.022 * comp, 0.016, 0.015);
    });
    caixa(-0.04, -0.025, 0.045, 0.02, 0.018, 0.045, 0, -0.6);    // o polegar, por cima do cabo
    caixa(-0.065, -0.045, 0.048, 0.03, 0.016, 0.018, 0, -0.3);
    // o cabo de referência (transparente): onde o item segurado costuma ficar
    const cabo = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 0.14, 16), new T.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.35, depthWrite: false }));
    cabo.rotation.x = Math.PI / 2;
    cabo.position.set(-0.075, -0.03, 0);
    g.add(cabo);
    g.userData.cabo = cabo;
    if (esquerda) g.scale.x = -1;
    return g;
  }
  /** O encaixe padrão de cada lugar do corpo (o item segurado pelo cabo, apontando para a frente). */
  const ENCAIXE_PADRAO = {
    rightHand: { pos: [-0.075, -0.03, 0], rot: [0, 0, 0] }, leftHand: { pos: [0.075, -0.03, 0], rot: [0, 0, 0] },
    head: { pos: [0, 0.12, 0], rot: [0, 0, 0] }, chest: { pos: [0, 0.05, 0.12], rot: [0, 0, 0] }, costas: { pos: [0, 0.05, -0.14], rot: [0, 180, 0] },
    hips: { pos: [0.16, 0, 0], rot: [0, 0, 0] }, rightFoot: { pos: [0, 0, 0.05], rot: [0, 0, 0] }, leftFoot: { pos: [0, 0, 0.05], rot: [0, 0, 0] },
  };

  C.abrirEstudioItens = function (lugar, { id = "", ajustar = false, mochila = null } = {}) {
    const T = window.THREE;
    let def = Object.assign(C.novoItem(), { nome: t("Item novo") }), malhas = new Map(), animacoes = [], vivo = null, reg = null;
    let sel = null;            // id da parte, "encaixe" ou null
    let modo = "mover", eixo = null, grade = true, vista = "item", testando = false, fechado = false;
    const desfazer = [], refazer = [];
    let mudouDesde = 0, sujo = false;

    // ── a página ────────────────────────────────────────────────────
    const nomeItem = el("input", { class: "estudio-nome", value: def.nome, "aria-label": t("Nome do item"), maxlength: 60 });
    const tela = el("div", { class: "estudio-tela", tabindex: 0, "aria-label": t("A cena do item: arraste para girar a câmera ou mover a parte escolhida") });
    const listaPartes = el("div", { class: "estudio-lista", role: "listbox", "aria-label": t("As partes do item") });
    const props = el("div", { class: "estudio-props" });
    const barra = el("div", { class: "estudio-ferramentas", role: "toolbar", "aria-label": t("Ferramentas") });
    const testeBarra = el("div", { class: "estudio-teste", hidden: true });
    const painelMeus = el("div", { class: "estudio-meus webc-bolha-painel", hidden: true });
    const infoTeste = el("span", { class: "fraco pequeno" });
    const bolha = (o) => C.bolhaWebc(o);
    const bMeus = bolha({ id: "estudio-meus", icone: "b-meus", rotulo: t("Meus itens"), painel: painelMeus, acao: () => desenharMeus() });
    const bNovo = bolha({ id: "estudio-novo", icone: "b-novo", rotulo: t("Novo"), acao: () => novo() });
    const bImportar = bolha({ id: "estudio-importar", icone: "b-importar", rotulo: t("Importar"), acao: () => importarItem().catch(LNUX.erro) });
    const bTestar = bolha({ id: "estudio-testar", icone: "b-testar", rotulo: t("Testar"), acao: () => alternarTeste() });
    const bSalvar = bolha({ id: "estudio-salvar", icone: "b-salvar", rotulo: ajustar ? t("Salvar o ajuste") : t("Salvar"), acao: () => salvar().catch(LNUX.erro) });
    const bExportar = bolha({ id: "estudio-exportar", icone: "b-exportar", rotulo: t("Exportar .glb"), acao: () => exportar().catch(LNUX.erro) });
    const bPublicar = bolha({ id: "estudio-publicar", icone: "b-publicar", rotulo: t("Publicar na loja"), acao: () => publicar().catch(LNUX.erro) });
    const caixa = el("section", { class: "webc-painel webc-loja estudio-itens" + (ajustar ? " ajustando" : ""), "aria-label": t("Estúdio de itens") },
      el("header", { class: "webc-painel-topo" },
        el("h1", { class: "webc-painel-titulo" }, ajustar ? t("AJUSTAR") : t("CRIAR")), nomeItem, el("span", { class: "webc-espaco" }),
        el("div", { class: "webc-bolhas", role: "toolbar", "aria-label": t("Opções do estúdio") }, ...(ajustar ? [bTestar, bSalvar] : [bMeus, bNovo, bImportar, bTestar, bSalvar, bExportar, bPublicar]))),
      painelMeus,
      ajustar ? el("p", { class: "estudio-aviso" }, t("Ajuste onde o item fica no seu corpo: arraste o item na mão de boneco (ou use os números à direita). Fica guardado só para você, e os outros na sala veem o item no lugar que você deixou.")) : null,
      el("div", { class: "estudio-corpo" },
        el("aside", { class: "estudio-esquerda", hidden: ajustar }, el("h2", {}, t("Adicionar")), adicionar(), el("h2", {}, t("Partes")), listaPartes),
        el("div", { class: "estudio-meio" }, barra, tela, testeBarra),
        el("aside", { class: "estudio-direita" }, props)));
    lugar.append(caixa);

    // ── a cena ──────────────────────────────────────────────────────
    const render = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    render.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    render.shadowMap.enabled = true;
    render.outputColorSpace = T.SRGBColorSpace;
    tela.append(render.domElement);
    const cena = new T.Scene();
    cena.background = new T.Color(0x1e2129);
    const camera = new T.PerspectiveCamera(40, 1, 0.01, 200);
    cena.add(new T.HemisphereLight(0xdfe8ff, 0x3a3328, 0.9));
    const sol = new T.DirectionalLight(0xffffff, 1.6);
    sol.position.set(2, 4, 3);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    Object.assign(sol.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 12 });
    cena.add(sol);
    const chao = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshStandardMaterial({ color: 0x2a2e38, roughness: 1 }));
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -0.001;
    chao.receiveShadow = true;
    cena.add(chao);
    const grelha = new T.GridHelper(2, 40, 0x56607a, 0x353b4a);
    cena.add(grelha);
    const eixos = new T.AxesHelper(0.12);
    cena.add(eixos);
    const frente = new T.ArrowHelper(new T.Vector3(0, 0, 1), new T.Vector3(0, 0.002, 0), 0.25, 0x48d07a, 0.04, 0.025); // a frente do item (+Z)
    cena.add(frente);
    const contorno = new T.Box3Helper(new T.Box3(), 0xffd24a);
    /** O tamanho do que se vê de um objeto (sem o cone de luz nem as partículas). */
    function caixaDe(raiz) {
      const b = new T.Box3(), tmp = new T.Box3();
      raiz.updateWorldMatrix(true, true);
      raiz.traverse((o) => {
        if (!o.isMesh || o.userData.semCaixa || !o.geometry || !o.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        b.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
      });
      return b;
    }
    contorno.visible = false;
    cena.add(contorno);
    // a parede de teste (com a árvore de colisão, como o cenário do jogo)
    const parede = new T.Mesh(new T.BoxGeometry(6, 3, 0.2), new T.MeshStandardMaterial({ color: 0x6c7488, roughness: 0.9 }));
    parede.position.set(0, 1.5, 4);
    parede.receiveShadow = true;
    parede.visible = false;
    cena.add(parede);
    let colisorTeste = null;
    function prepararColisor() {
      if (colisorTeste) return colisorTeste;
      const g = parede.geometry.clone().applyMatrix4(parede.matrixWorld);
      g.boundsTree = new window.CompanhiaVRM.MeshBVH(g);
      colisorTeste = new T.Mesh(g);
      colisorTeste.updateMatrixWorld(true);
      return colisorTeste;
    }
    // o osso de mentira (vista da mão) e o boneco inteiro (vista do corpo)
    const ossoFalso = new T.Group();
    cena.add(ossoFalso);
    let mao = maoDeBoneco(false);
    ossoFalso.add(mao);
    let boneco = null; // {vrm, nos}
    async function prepararBoneco() {
      if (boneco) return boneco;
      await C.prepararVRM();
      const { GLTFLoader, VRMLoaderPlugin } = window.CompanhiaVRM, carregador = new GLTFLoader();
      carregador.register((p) => new VRMLoaderPlugin(p));
      const gltf = await carregador.parseAsync(await C.bonecoPadrao([0.85, 0.78, 0.7]).arrayBuffer(), "");
      const vrm = gltf.userData.vrm, nos = {};
      for (const n of C.OSSOS_VRM || []) { const no = vrm.humanoid.getNormalizedBoneNode(n); if (no) nos[n] = no; }
      vrm.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      boneco = { vrm, nos };
      return boneco;
    }

    // ── a câmera (girar em volta, mover, aproximar) ─────────────────
    const orbita = { alvo: new T.Vector3(0, 0.05, 0), dist: 0.9, giro: 0.7, altura: 0.45 };
    function posicionarCamera() {
      const o = orbita, ca = Math.cos(o.altura);
      camera.position.set(o.alvo.x + Math.sin(o.giro) * ca * o.dist, o.alvo.y + Math.sin(o.altura) * o.dist, o.alvo.z + Math.cos(o.giro) * ca * o.dist);
      camera.lookAt(o.alvo);
    }
    /** Enquadra o que interessa na vista (o item, a mão ou o boneco). */
    function focar() {
      const caixaB = new T.Box3();
      if (vista === "corpo" && boneco) caixaB.setFromObject(boneco.vrm.scene);
      else if (vista === "mao") { caixaB.copy(caixaDe(mao)); if (vivo) caixaB.union(caixaDe(vivo.corpo)); }
      else if (vivo) caixaB.copy(caixaDe(vivo.corpo));
      if (caixaB.isEmpty()) caixaB.set(new T.Vector3(-0.15, 0, -0.15), new T.Vector3(0.15, 0.2, 0.15));
      const c = caixaB.getCenter(new T.Vector3()), tam = caixaB.getSize(new T.Vector3()).length();
      orbita.alvo.copy(c);
      orbita.dist = Math.max(0.25, tam * 1.4);
      posicionarCamera();
    }

    // ── montar o item na cena ───────────────────────────────────────
    const ctxItem = { cena, colisor: () => (testando ? prepararColisor() : null), outros: () => [], reduzir: false };
    function reconstruir() {
      if (vivo) { C.desencaixarItem(vivo); vivo.descartar(); }
      vivo = new C.ItemVivo(def, malhas, animacoes, ctxItem);
      for (const p of def.partes) if (p.tipo === "forma" || p.tipo === "modelo") malhas.set(p.id, vivo.objetos.get(p.id));
      for (const p of def.partes) {
        const obj = vivo.objetos.get(p.id);
        obj.traverse((o) => { if (o.isMesh) o.userData.parteDe = p.id; });
        if (p.tipo !== "forma" && p.tipo !== "modelo") obj.add(ajudante(p)); // um desenho para achar e arrastar a parte
      }
      colocarNaVista();
      desenharLista();
    }
    /** O desenho das partes que não são malha (só no estúdio): a luz, o emissor e o cano do lançador. */
    function ajudante(p) {
      const cores = { luz: 0xffd24a, particulas: 0x7bf3ff, lancador: 0xff6a8a };
      const g = new T.Group();
      const corpo = new T.Mesh(p.tipo === "luz" ? new T.SphereGeometry(0.025, 16, 12) : p.tipo === "particulas" ? new T.OctahedronGeometry(0.028) : new T.CylinderGeometry(0.012, 0.018, 0.06, 12),
        new T.MeshBasicMaterial({ color: cores[p.tipo], wireframe: p.tipo === "particulas" }));
      if (p.tipo === "lancador") corpo.rotation.x = Math.PI / 2;
      corpo.userData.parteDe = p.id;
      g.add(corpo);
      if (p.tipo !== "particulas") g.add(new T.ArrowHelper(new T.Vector3(0, 0, 1), new T.Vector3(), 0.12, cores[p.tipo], 0.03, 0.018)); // para onde aponta (+Z)
      else g.add(new T.ArrowHelper(new T.Vector3(0, 1, 0), new T.Vector3(), 0.1, cores[p.tipo], 0.025, 0.015)); // para onde as partículas saem (+Y)
      g.userData.ajudante = true;
      g.scale.setScalar(1 / Math.max(0.05, Math.abs(p.esc[0] || 1)));
      return g;
    }
    /** O item na vista: sozinho (sem o encaixe), na mão de boneco ou no boneco inteiro. */
    function colocarNaVista() {
      if (!vivo) return;
      C.desencaixarItem(vivo);
      mao.visible = vista === "mao";
      if (boneco) { if (vista === "corpo") cena.add(boneco.vrm.scene); else cena.remove(boneco.vrm.scene); }
      const naMao = vista === "mao" && (def.encaixe.osso === "rightHand" || def.encaixe.osso === "leftHand");
      if (vista === "item") {
        vivo.aplicarEncaixe({ osso: def.encaixe.osso, pos: [0, 0, 0], rot: [0, 0, 0], escala: 1 });
        if (vivo.raiz.parent !== cena) cena.add(vivo.raiz);
      } else if (vista === "corpo" && boneco) {
        vivo.aplicarEncaixe(def.encaixe);
        C.encaixarItem(vivo, boneco.nos, false);
      } else {
        // a mão de boneco (direita ou esquerda) no lugar do osso; nos outros encaixes, só o osso
        vivo.aplicarEncaixe(def.encaixe);
        ossoFalso.remove(mao);
        mao = maoDeBoneco(def.encaixe.osso === "leftHand");
        mao.visible = naMao;
        ossoFalso.add(mao);
        C.encaixarItem(vivo, { [def.encaixe.osso === "costas" ? "chest" : def.encaixe.osso]: ossoFalso, hips: ossoFalso }, false);
      }
      frente.visible = vista === "item";
      eixos.visible = vista !== "corpo";
    }

    // ── a lista das partes ──────────────────────────────────────────
    function desenharLista() {
      listaPartes.replaceChildren(...LNUX.filhos(
        el("button", { type: "button", class: "estudio-parte" + (sel === "encaixe" ? " ativa" : ""), "data-parte": "encaixe", role: "option", "aria-selected": String(sel === "encaixe"), onclick: () => escolher("encaixe") },
          el("span", { class: "estudio-parte-tipo" }, t("Corpo")), el("span", { class: "estudio-parte-nome" }, t("Encaixe: {lugar}", { lugar: t(C.ENCAIXES[def.encaixe.osso]) }))),
        ...def.partes.map((p, i) => el("div", { class: "estudio-parte" + (sel === p.id ? " ativa" : "") + (p.visivel === false ? " escondida" : ""), "data-parte": p.id, role: "option", "aria-selected": String(sel === p.id), tabindex: 0,
          onclick: () => escolher(p.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); escolher(p.id); } } },
          el("span", { class: "estudio-parte-tipo" }, t(NOMES_TIPO[p.tipo])),
          el("span", { class: "estudio-parte-nome", translate: "no" }, p.nome || t(NOMES_TIPO[p.tipo])),
          el("span", { class: "estudio-parte-acoes" },
            el("button", { type: "button", title: p.visivel === false ? t("Mostrar") : t("Esconder"), "aria-label": p.visivel === false ? t("Mostrar") : t("Esconder"), onclick: (e) => { e.stopPropagation(); mudar(() => { p.visivel = p.visivel === false; }, true); } }, p.visivel === false ? "◌" : "●"),
            el("button", { type: "button", title: t("Subir"), "aria-label": t("Subir"), disabled: i === 0, onclick: (e) => { e.stopPropagation(); mudar(() => { def.partes.splice(i - 1, 0, def.partes.splice(i, 1)[0]); }, true); } }, "↑"),
            el("button", { type: "button", title: t("Descer"), "aria-label": t("Descer"), disabled: i === def.partes.length - 1, onclick: (e) => { e.stopPropagation(); mudar(() => { def.partes.splice(i + 1, 0, def.partes.splice(i, 1)[0]); }, true); } }, "↓")))),
        def.partes.length ? null : el("p", { class: "fraco pequeno" }, t("Nenhuma parte ainda: adicione uma forma, um modelo 3D, uma luz, partículas ou um lançador."))));
    }
    function escolher(id) {
      sel = id;
      if (id === "encaixe" && vista === "item") trocarVista("mao");
      desenharLista();
      desenharProps();
    }
    const parteSel = () => def.partes.find((p) => p.id === sel) || null;

    // ── adicionar partes ────────────────────────────────────────────
    function adicionar() {
      const botao = (rotulo, acao, attrs = {}) => el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => acao(), ...attrs }, rotulo);
      const selectPronto = (lista) => el("select", { class: "lnux-selecao" }, Object.entries(lista).map(([k, v]) => el("option", { value: k }, t(v.nome))));
      const sPart = selectPronto(C.PARTICULAS_PRONTAS), sLanc = selectPronto(C.LANCADORES_PRONTOS), sLuz = selectPronto(C.LUZES_PRONTAS);
      return el("div", { class: "estudio-adicionar" },
        el("div", { class: "estudio-formas" }, Object.entries(C.FORMAS).map(([k, n]) => botao(t(n), () => novaParte("forma", { forma: k, nome: t(n) }), { "data-forma": k }))),
        botao(t("Modelo 3D..."), () => importarModelo().catch(LNUX.erro), { id: "estudio-add-modelo" }),
        el("div", { class: "estudio-linha" }, sLuz, botao(t("＋ Luz"), () => novaParte("luz", { ...C.LUZES_PRONTAS[sLuz.value], nome: t(C.LUZES_PRONTAS[sLuz.value].nome) }), { id: "estudio-add-luz" })),
        el("div", { class: "estudio-linha" }, sPart, botao(t("＋ Partículas"), () => novaParte("particulas", { ...C.PARTICULAS_PRONTAS[sPart.value], nome: t(C.PARTICULAS_PRONTAS[sPart.value].nome) }), { id: "estudio-add-particulas" })),
        el("div", { class: "estudio-linha" }, sLanc, botao(t("＋ Lançador"), () => novaParte("lancador", { ...C.LANCADORES_PRONTOS[sLanc.value], nome: t(C.LANCADORES_PRONTOS[sLanc.value].nome) }), { id: "estudio-add-lancador" })));
    }
    function novaParte(tipo, extra) {
      const p = C.novaParte(tipo, extra);
      if (tipo === "lancador" || tipo === "luz") p.pos = [0, 0.03, 0.12];
      mudar(() => { def.partes.push(p); def = C.limparItem(def); }, true);
      escolher(p.id);
      return p;
    }
    async function importarModelo() {
      const arqs = await LNUX.arquivos.abrir({ titulo: t("Modelo 3D para o item (.glb, .gltf, .fbx, .obj ou ZIP)"), aceitar: C.conversor.ACEITAR, multiplos: true });
      if (!arqs.length) return;
      const mapa = new Map();
      for (const a of arqs) mapa.set(a.nome, await a.blob());
      const pronto = await C.mapas.preparar(mapa), principal = C.conversor.modelos(pronto)[0];
      if (!principal) throw new Error(t("Não achei um modelo 3D nesses arquivos."));
      const glb = /\.glb$/i.test(principal) ? pronto.get(principal) : (await C.conversor.paraGLB(pronto, principal)).glb;
      const gltf = await new window.CompanhiaVRM.GLTFLoader().parseAsync(await glb.arrayBuffer(), "");
      const modelo = gltf.scene;
      // centraliza e põe num tamanho de segurar (o maior lado com 30 cm); dá para mudar depois
      const b = new T.Box3().setFromObject(modelo), tam = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
      const grupo = new T.Group();
      modelo.position.sub(c);
      grupo.add(modelo);
      const escala = 0.3 / Math.max(1e-4, tam.x, tam.y, tam.z);
      grupo.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const p = C.novaParte("modelo", { nome: LNUX.nomeSemExtensao(principal.split("/").pop()).slice(0, 40), esc: [escala, escala, escala] });
      malhas.set(p.id, grupo);
      animacoes.push(...(gltf.animations || []));
      mudar(() => { def.partes.push(p); }, true);
      escolher(p.id);
      focar();
    }

    // ── mudar, desfazer e refazer ───────────────────────────────────
    /** Faz uma mudança na ficha (guardando como estava para o Ctrl+Z). remontar: refaz a cena (luzes, partículas...). */
    function mudar(fn, remontar = false, juntar = false) {
      const agora = performance.now();
      if (!juntar || agora - mudouDesde > 600) { desfazer.push(JSON.stringify(def)); if (desfazer.length > 100) desfazer.shift(); refazer.length = 0; }
      mudouDesde = agora;
      fn();
      sujo = true;
      if (remontar) agendarRemontar(); else atualizarObjetos();
      desenharLista();
      if (barra.isConnected && (desfazer.length === 1 || refazer.length === 0)) desenharBarra(); // o ↶ e o ↷ ligam e desligam
    }
    let remontarT = 0;
    function agendarRemontar() { clearTimeout(remontarT); remontarT = setTimeout(() => { reconstruir(); desenharProps(); }, 60); }
    /** Só as posições e os materiais (sem refazer a cena): enquanto arrasta. */
    function atualizarObjetos() {
      if (!vivo) return;
      for (const p of def.partes) {
        const o = vivo.objetos.get(p.id);
        if (!o) continue;
        C.posicionarParte(o, p);
        const aj = o.children.find((x) => x.userData.ajudante);
        if (aj) aj.scale.setScalar(1 / Math.max(0.05, Math.abs(p.esc[0] || 1)));
      }
      if (vista !== "item") vivo.aplicarEncaixe(def.encaixe);
    }
    function voltar(de, para) {
      if (!de.length) return;
      para.push(JSON.stringify(def));
      def = C.limparItem(JSON.parse(de.pop()));
      if (sel && sel !== "encaixe" && !parteSel()) sel = null;
      nomeItem.value = def.nome;
      reconstruir();
      desenharProps();
      desenharBarra();
    }

    // ── as propriedades ─────────────────────────────────────────────
    const campoNum = (rotulo, valor, aoMudar, { passo = 0.01, min = -100, max = 100 } = {}) => {
      const i = el("input", { type: "number", class: "lnux-entrada", step: passo, min, max, value: arred(valor), "aria-label": rotulo });
      i.addEventListener("input", () => { const v = parseFloat(i.value); if (Number.isFinite(v)) aoMudar(v); });
      return el("label", { class: "estudio-num" }, el("span", {}, rotulo), i);
    };
    const tres = (rotulo, vet, aoMudar, opcoes) => el("div", { class: "estudio-tres" }, el("span", { class: "estudio-rotulo" }, rotulo),
      ...["x", "y", "z"].map((k, i) => campoNum(k.toUpperCase(), vet[i], (v) => aoMudar(i, v), opcoes)));
    const faixa = (rotulo, valor, min, max, passo, aoMudar, remontar = true) => {
      const v = el("span", { class: "valor" }, String(arred(valor, 100)));
      const i = el("input", { type: "range", min, max, step: passo, value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => { v.textContent = String(arred(+i.value, 100)); mudar(() => aoMudar(+i.value), remontar, true); });
      return el("label", { class: "estudio-faixa" }, el("span", {}, rotulo, " ", v), i);
    };
    const corCampo = (rotulo, valor, aoMudar, remontar = true) => {
      const i = el("input", { type: "color", value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => mudar(() => aoMudar(i.value), remontar, true));
      return el("label", { class: "estudio-cor" }, el("span", {}, rotulo), i);
    };
    const marca = (rotulo, valor, aoMudar, remontar = true) => {
      const c = el("input", { type: "checkbox", checked: !!valor });
      c.addEventListener("change", () => mudar(() => aoMudar(c.checked), remontar));
      return el("label", { class: "lnux-alternar estudio-marca" }, c, rotulo);
    };
    const escolha = (rotulo, opcoes, valor, aoMudar, remontar = true) => {
      const s = el("select", { class: "lnux-selecao", "aria-label": rotulo }, Object.entries(opcoes).map(([k, n]) => el("option", { value: k, selected: k === valor }, t(n))));
      s.addEventListener("change", () => mudar(() => aoMudar(s.value), remontar));
      return el("label", { class: "estudio-escolha" }, el("span", {}, rotulo), s);
    };
    const secao = (titulo, ...filhos) => el("section", { class: "estudio-secao" }, el("h3", {}, titulo), ...filhos);

    function desenharProps() {
      const p = parteSel();
      if (sel === "encaixe" || !p) { props.replaceChildren(...LNUX.filhos(propsDoItem())); return; }
      const transformar = secao(t("Posição, giro e tamanho"),
        tres(t("Posição (m)"), p.pos, (i, v) => mudar(() => { p.pos[i] = v; }, false, true)),
        tres(t("Giro (°)"), p.rot, (i, v) => mudar(() => { p.rot[i] = v; }, false, true), { passo: 1, min: -360, max: 360 }),
        tres(t("Tamanho"), p.esc, (i, v) => mudar(() => { p.esc[i] = v; }, false, true), { passo: 0.01, min: -50, max: 50 }),
        el("div", { class: "estudio-botoes" },
          el("button", { type: "button", class: "lnux-botao pequeno", id: "estudio-duplicar", onclick: () => duplicar() }, t("Duplicar")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => espelhar(0) }, t("Espelhar X")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => espelhar(1) }, t("Espelhar Y")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => espelhar(2) }, t("Espelhar Z")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => mudar(() => { p.pos = [0, p.pos[1], 0]; }) }, t("Centralizar")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => noChao(p) }, t("Pôr no chão")),
          el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => mudar(() => { p.pos = [0, 0, 0]; p.rot = [0, 0, 0]; p.esc = p.tipo === "forma" ? [0.1, 0.1, 0.1] : [1, 1, 1]; }) }, t("Zerar")),
          el("button", { type: "button", class: "lnux-botao pequeno perigo", id: "estudio-apagar", onclick: () => apagar() }, t("Apagar"))));
      const nome = el("input", { class: "lnux-entrada", value: p.nome, maxlength: 40, "aria-label": t("Nome da parte") });
      nome.addEventListener("input", () => mudar(() => { p.nome = nome.value; }, false, true));
      props.replaceChildren(...LNUX.filhos(
        el("h2", {}, t(NOMES_TIPO[p.tipo])), el("label", { class: "lnux-campo" }, el("span", {}, t("Nome")), nome),
        transformar, ...propsDoTipo(p)));
    }
    function propsDoTipo(p) {
      if (p.tipo === "forma") return [secao(t("Forma e material"),
        escolha(t("Forma"), C.FORMAS, p.forma, (v) => { p.forma = v; const o = vivo.objetos.get(p.id); if (o && o.isMesh) o.geometry = C.geometriaDaForma(v); }, false),
        corCampo(t("Cor"), p.cor, (v) => { p.cor = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        faixa(t("Metal"), p.metal, 0, 1, 0.01, (v) => { p.metal = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        faixa(t("Rugosidade"), p.rugosidade, 0, 1, 0.01, (v) => { p.rugosidade = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        faixa(t("Brilho (luz própria)"), p.brilho, 0, 10, 0.1, (v) => { p.brilho = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        corCampo(t("Cor do brilho"), p.corBrilho, (v) => { p.corBrilho = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        faixa(t("Opacidade"), p.opacidade, 0.05, 1, 0.01, (v) => { p.opacidade = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        marca(t("Aramado"), p.aramado, (v) => { p.aramado = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        marca(t("Faces chapadas"), p.chapado, (v) => { p.chapado = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => textura(p).catch(LNUX.erro) }, t("Textura (imagem)...")))];
      if (p.tipo === "modelo") return [secao(t("Modelo"),
        marca(t("Tocar as animações do arquivo ao usar"), p.animar, (v) => { p.animar = v; }),
        el("p", { class: "fraco pequeno" }, animacoes.length ? t("{n} animação(ões) no arquivo.", { n: animacoes.length }) : t("O arquivo não tem animações.")),
        faixa(t("Brilho (luz própria)"), p.brilho || 0, 0, 10, 0.1, (v) => { p.brilho = v; p.corBrilho = p.corBrilho || "#ffffff"; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false),
        faixa(t("Opacidade"), p.opacidade ?? 1, 0.05, 1, 0.01, (v) => { p.opacidade = v; C.aplicarMaterial(vivo.objetos.get(p.id), p); }, false))];
      if (p.tipo === "luz") return [secao(t("Luz"),
        escolha(t("Tipo"), { lanterna: "Lanterna (um cone)", lampada: "Lâmpada (para todos os lados)" }, C.especieDaLuz(p), (v) => { p.luz = v; }),
        corCampo(t("Cor"), p.cor, (v) => { p.cor = v; }),
        faixa(t("Força"), p.forca, 0, 200, 0.5, (v) => { p.forca = v; }),
        faixa(t("Alcance (m)"), p.alcance, 0.5, 60, 0.5, (v) => { p.alcance = v; }),
        C.especieDaLuz(p) === "lanterna" ? faixa(t("Abertura do cone (°)"), p.abertura, 5, 85, 1, (v) => { p.abertura = v; }) : null,
        C.especieDaLuz(p) === "lanterna" ? faixa(t("Suavidade da borda"), p.suavidade, 0, 1, 0.01, (v) => { p.suavidade = v; }) : null,
        faixa(t("Piscar (como uma tocha)"), p.piscar, 0, 1, 0.01, (v) => { p.piscar = v; }),
        marca(t("Faz sombra"), p.sombra, (v) => { p.sombra = v; }),
        C.especieDaLuz(p) === "lanterna" ? marca(t("Cone visível no ar"), p.cone, (v) => { p.cone = v; }) : null,
        marca(t("Liga e desliga ao usar (E)"), p.alternar, (v) => { p.alternar = v; }),
        marca(t("Começa ligada"), p.ligada, (v) => { p.ligada = v; }))];
      if (p.tipo === "particulas") return [secao(t("Partículas"),
        escolha(t("Modelo pronto"), Object.fromEntries(Object.entries(C.PARTICULAS_PRONTAS).map(([k, v]) => [k, v.nome])), "", (v) => { Object.assign(p, C.PARTICULAS_PRONTAS[v], { nome: p.nome }); }),
        escolha(t("Quando"), { continuo: "Sempre", enquanto: "Enquanto usa (segurando E)", rajada: "Uma rajada ao usar" }, p.aoUsar, (v) => { p.aoUsar = v; }),
        faixa(t("Por segundo"), p.taxa, 0, 300, 1, (v) => { p.taxa = v; }),
        faixa(t("Rajada ao usar"), p.rajada, 0, 400, 1, (v) => { p.rajada = v; }),
        faixa(t("Vida (s)"), p.vida, 0.05, 8, 0.05, (v) => { p.vida = v; }),
        faixa(t("Velocidade"), p.velocidade, 0, 30, 0.1, (v) => { p.velocidade = v; }),
        faixa(t("Abertura (°)"), p.abertura, 0, 180, 1, (v) => { p.abertura = v; }),
        faixa(t("Gravidade"), p.gravidade, -20, 20, 0.1, (v) => { p.gravidade = v; }),
        faixa(t("Arrasto do ar"), p.arrasto, 0, 5, 0.05, (v) => { p.arrasto = v; }),
        faixa(t("Tamanho no começo"), p.tamanho[0], 0, 3, 0.01, (v) => { p.tamanho[0] = v; }),
        faixa(t("Tamanho no fim"), p.tamanho[1], 0, 3, 0.01, (v) => { p.tamanho[1] = v; }),
        corCampo(t("Cor no começo"), p.cor[0], (v) => { p.cor[0] = v; }),
        corCampo(t("Cor no fim"), p.cor[1], (v) => { p.cor[1] = v; }),
        faixa(t("Opacidade"), p.opacidade, 0.02, 1, 0.01, (v) => { p.opacidade = v; }),
        escolha(t("Desenho"), { circulo: "Círculo", faisca: "Faísca", fumaca: "Fumaça", estrela: "Estrela", quadrado: "Quadrado", bolha: "Bolha" }, p.forma, (v) => { p.forma = v; }),
        escolha(t("De onde saem"), { ponto: "Um ponto", esfera: "Uma esfera", caixa: "Uma caixa" }, p.forma3d, (v) => { p.forma3d = v; }),
        marca(t("Brilho somado (luz)"), p.somar, (v) => { p.somar = v; }),
        marca(t("Ficam no mundo (não seguem o item)"), p.mundo, (v) => { p.mundo = v; }))];
      if (p.tipo === "lancador") return [secao(t("Lançador de projéteis"),
        escolha(t("Modelo pronto"), Object.fromEntries(Object.entries(C.LANCADORES_PRONTOS).map(([k, v]) => [k, v.nome])), "", (v) => { Object.assign(p, C.LANCADORES_PRONTOS[v], { nome: p.nome }); }),
        faixa(t("Velocidade (m/s)"), p.velocidade, 0.5, 200, 0.5, (v) => { p.velocidade = v; }),
        faixa(t("Gravidade"), p.gravidade, -20, 30, 0.1, (v) => { p.gravidade = v; }),
        faixa(t("Alcance (s de voo)"), p.vida, 0.1, 6, 0.1, (v) => { p.vida = v; }),
        faixa(t("Intervalo entre tiros (ms)"), p.cadencia, 50, 5000, 10, (v) => { p.cadencia = v; }),
        faixa(t("Projéteis por tiro"), p.porTiro, 1, 12, 1, (v) => { p.porTiro = v; }),
        faixa(t("Dispersão (°)"), p.dispersao, 0, 45, 0.5, (v) => { p.dispersao = v; }),
        faixa(t("Tamanho"), p.tamanho, 0.005, 1, 0.005, (v) => { p.tamanho = v; }),
        corCampo(t("Cor"), p.cor, (v) => { p.cor = v; }),
        faixa(t("Quiques"), p.quiques, 0, 5, 1, (v) => { p.quiques = v; }),
        faixa(t("Recuo"), p.recuo, 0, 2, 0.05, (v) => { p.recuo = v; }),
        marca(t("Rastro"), p.rastro, (v) => { p.rastro = v; }),
        marca(t("Brilhante"), p.brilho, (v) => { p.brilho = v; }),
        marca(t("Faíscas no impacto"), p.impacto, (v) => { p.impacto = v; }),
        marca(t("Clarão no cano"), p.clarao, (v) => { p.clarao = v; }),
        el("p", { class: "fraco pequeno" }, t("O tiro sai na direção da seta (+Z). No jogo, vai para onde a câmera aponta.")))];
      return [];
    }
    function propsDoItem() {
      const e = def.encaixe;
      const desc = el("textarea", { class: "lnux-entrada", rows: 3, maxlength: 300, "aria-label": t("Descrição") }, def.descricao);
      desc.addEventListener("input", () => mudar(() => { def.descricao = desc.value; }, false, true));
      return [
        ajustar ? null : el("h2", {}, t("O item")),
        ajustar ? null : el("label", { class: "lnux-campo" }, el("span", {}, t("Descrição")), desc),
        secao(t("Encaixe no corpo"),
          ajustar ? null : escolha(t("Onde fica"), C.ENCAIXES, e.osso, (v) => { e.osso = v; const pd = ENCAIXE_PADRAO[v]; e.pos = pd.pos.slice(); e.rot = pd.rot.slice(); }),
          tres(t("Posição (m)"), e.pos, (i, v) => mudar(() => { e.pos[i] = v; }, false, true)),
          tres(t("Giro (°)"), e.rot, (i, v) => mudar(() => { e.rot[i] = v; }, false, true), { passo: 1, min: -360, max: 360 }),
          el("div", { class: "estudio-tres" }, campoNum(t("Tamanho"), e.escala, (v) => mudar(() => { e.escala = Math.max(0.05, v); }, false, true), { passo: 0.01, min: 0.05, max: 10 })),
          el("div", { class: "estudio-botoes" },
            el("button", { type: "button", class: "lnux-botao pequeno", id: "estudio-ver-mao", onclick: () => { escolher("encaixe"); trocarVista("mao"); } }, t("Ver na mão de boneco")),
            el("button", { type: "button", class: "lnux-botao pequeno", id: "estudio-ver-corpo", onclick: () => { escolher("encaixe"); trocarVista("corpo"); } }, t("Ver no boneco inteiro")),
            el("button", { type: "button", class: "lnux-botao pequeno", onclick: () => mudar(() => { const pd = ENCAIXE_PADRAO[e.osso]; e.pos = pd.pos.slice(); e.rot = pd.rot.slice(); e.escala = 1; }) }, t("Encaixe padrão")),
            ajustar ? el("button", { type: "button", class: "lnux-botao pequeno", id: "estudio-do-criador", onclick: () => voltarAoCriador() }, t("Voltar ao do criador")) : null),
          el("p", { class: "fraco pequeno" }, t("Escolha \"Encaixe\" na lista (ou clique aqui) e arraste o item na cena: ele se move em relação ao osso. A parte azul na mão de boneco é onde fica o cabo."))),
        ajustar ? null : el("p", { class: "fraco pequeno" }, t("Dica: monte o item com a frente para a seta verde (+Z). Lanternas e lançadores apontam para a frente.")),
      ];
    }
    function duplicar() {
      const p = parteSel();
      if (!p) return;
      const copia = JSON.parse(JSON.stringify(p));
      copia.id = LNUX.id("p");
      copia.nome = (p.nome || "") + " " + t("(cópia)");
      copia.pos = [p.pos[0] + 0.03, p.pos[1], p.pos[2]];
      const o = malhas.get(p.id);
      if (o) malhas.set(copia.id, o.clone(true));
      mudar(() => { def.partes.push(copia); }, true);
      escolher(copia.id);
    }
    function apagar() {
      const p = parteSel();
      if (!p) return;
      mudar(() => { def.partes = def.partes.filter((x) => x !== p); }, true);
      sel = null;
      desenharProps();
    }
    function espelhar(i) { const p = parteSel(); if (p) mudar(() => { p.esc[i] = -p.esc[i]; }); }
    function noChao(p) {
      const o = vivo.objetos.get(p.id);
      if (!o) return;
      const b = new T.Box3().setFromObject(o);
      if (!b.isEmpty()) mudar(() => { p.pos[1] = arred(p.pos[1] - b.min.y); });
    }
    async function textura(p) {
      const [a] = await LNUX.arquivos.abrir({ titulo: t("Imagem para a textura"), aceitar: "image/*" });
      if (!a) return;
      const url = URL.createObjectURL(await a.blob());
      const tex = await new T.TextureLoader().loadAsync(url);
      tex.colorSpace = T.SRGBColorSpace;
      const o = vivo.objetos.get(p.id);
      mudar(() => { p.cor = "#ffffff"; }, false);
      o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.map = tex; m.material.needsUpdate = true; } });
      C.aplicarMaterial(o, p);
      desenharProps();
    }

    // ── ferramentas: modo, eixo, grade, vista ───────────────────────
    function desenharBarra() {
      const seg = (grupo, opcoes, atual, aoEscolher) => el("div", { class: "estudio-seg", role: "group", "aria-label": grupo },
        opcoes.map(([v, r, dica]) => el("button", { type: "button", class: v === atual ? "ativo" : "", "aria-pressed": String(v === atual), title: dica || r, "data-valor": String(v), onclick: () => aoEscolher(v) }, r)));
      barra.replaceChildren(
        seg(t("Arrastar"), [["mover", t("Mover"), "W"], ["girar", t("Girar"), "E"], ["escala", t("Tamanho"), "R"]], modo, (v) => { modo = v; desenharBarra(); }),
        seg(t("Eixo"), [[null, t("Livre")], ["x", "X"], ["y", "Y"], ["z", "Z"]], eixo, (v) => { eixo = v; desenharBarra(); }),
        el("button", { type: "button", class: grade ? "ativo" : "", "aria-pressed": String(grade), title: t("Encaixar na grade (1 cm e 15°)"), onclick: () => { grade = !grade; desenharBarra(); } }, t("Grade")),
        el("button", { type: "button", title: t("Desfazer (Ctrl+Z)"), "aria-label": t("Desfazer"), disabled: !desfazer.length, onclick: () => voltar(desfazer, refazer) }, "↶"),
        el("button", { type: "button", title: t("Refazer (Ctrl+Y)"), "aria-label": t("Refazer"), disabled: !refazer.length, onclick: () => voltar(refazer, desfazer) }, "↷"),
        seg(t("Vista"), [["item", t("Item")], ["mao", t("Mão")], ["corpo", t("Corpo")]], vista, (v) => trocarVista(v)),
        el("button", { type: "button", title: t("Focar (F)"), onclick: () => focar() }, t("Focar")));
    }
    async function trocarVista(v) {
      vista = v;
      if (v === "corpo") await prepararBoneco();
      if (fechado) return;
      colocarNaVista();
      desenharBarra();
      if (v === "mao") { orbita.giro = 0.6; orbita.altura = 0.15; } // de lado e um pouco de baixo: dá para ver os dedos fechados
      focar();
    }
    function alternarTeste(sim = !testando) {
      testando = sim;
      parede.visible = sim;
      testeBarra.hidden = !sim;
      if (sim) {
        if (vista === "corpo") trocarVista("item");
        orbita.alvo.set(0, 0.3, 1.5); orbita.dist = 4; orbita.giro = Math.PI * 0.85; orbita.altura = 0.25; posicionarCamera();
      }
      bTestar.classList.toggle("ligada", sim);
      bTestar.setAttribute("aria-pressed", String(sim));
    }
    const botaoUsar = el("button", { type: "button", class: "lnux-botao primario", id: "estudio-usar" }, t("Usar (E)"));
    botaoUsar.addEventListener("pointerdown", (e) => { e.preventDefault(); if (vivo) vivo.usar(null); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) botaoUsar.addEventListener(ev, () => { if (vivo) vivo.soltarUso(); });
    testeBarra.append(botaoUsar, el("span", { class: "fraco pequeno" }, t("Segure para disparar sem parar. A parede fica na frente do item (+Z).")), infoTeste);

    // ── arrastar na cena ────────────────────────────────────────────
    const raycaster = new T.Raycaster(), ponteiro = new T.Vector2();
    let arrasto = null;
    function noPonteiro(e) {
      const r = render.domElement.getBoundingClientRect();
      ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ponteiro, camera);
    }
    function parteNoPonteiro() {
      if (!vivo) return null;
      const alvos = [];
      vivo.corpo.traverse((o) => { if (o.isMesh && o.userData.parteDe && o.visible) alvos.push(o); });
      const toque = raycaster.intersectObjects(alvos, false)[0];
      return toque ? toque.object.userData.parteDe : null;
    }
    render.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    render.domElement.addEventListener("pointerdown", (e) => {
      tela.focus({ preventScroll: true });
      noPonteiro(e);
      const tocou = e.button === 0 && !e.shiftKey ? parteNoPonteiro() : null;
      let alvo = null;
      if (tocou && !ajustar) { if (sel !== tocou && sel !== "encaixe") escolher(tocou); alvo = sel === "encaixe" ? "encaixe" : tocou; }
      else if (tocou && ajustar) alvo = "encaixe";
      render.domElement.setPointerCapture(e.pointerId);
      if (alvo) {
        const obj = alvo === "encaixe" ? vivo.corpo : vivo.objetos.get(alvo);
        const inicio = obj.getWorldPosition(new T.Vector3());
        const plano = new T.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new T.Vector3()).negate(), inicio);
        const ponto = raycaster.ray.intersectPlane(plano, new T.Vector3());
        desfazer.push(JSON.stringify(def)); refazer.length = 0; mudouDesde = performance.now();
        arrasto = { tipo: "parte", alvo, obj, plano, ponto, x: e.clientX, y: e.clientY, antes: JSON.parse(JSON.stringify(alvo === "encaixe" ? def.encaixe : parteSel())) };
      } else arrasto = { tipo: e.button === 2 || e.shiftKey ? "mover-camera" : "girar-camera", x: e.clientX, y: e.clientY };
    });
    render.domElement.addEventListener("pointermove", (e) => {
      if (!arrasto) return;
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      if (arrasto.tipo === "girar-camera") { orbita.giro -= dx * 0.008; orbita.altura = Math.max(-1.2, Math.min(1.45, orbita.altura + dy * 0.006)); arrasto.x = e.clientX; arrasto.y = e.clientY; posicionarCamera(); return; }
      if (arrasto.tipo === "mover-camera") {
        const k = orbita.dist * 0.0016, dir = new T.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-dx * k).add(new T.Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(dy * k));
        orbita.alvo.add(dir); arrasto.x = e.clientX; arrasto.y = e.clientY; posicionarCamera(); return;
      }
      arrastarParte(e, dx, dy);
    });
    const soltarArrasto = () => { if (arrasto && arrasto.tipo === "parte") { sujo = true; agendarRemontar(); } arrasto = null; };
    render.domElement.addEventListener("pointerup", soltarArrasto);
    render.domElement.addEventListener("pointercancel", soltarArrasto);
    render.domElement.addEventListener("wheel", (e) => { e.preventDefault(); orbita.dist = Math.max(0.08, Math.min(30, orbita.dist * (e.deltaY < 0 ? 0.9 : 1.1))); posicionarCamera(); }, { passive: false });

    const pegar = (v, passo) => (grade ? Math.round(v / passo) * passo : v);
    function arrastarParte(e, dx, dy) {
      const a = arrasto, enc = a.alvo === "encaixe", p = enc ? def.encaixe : parteSel();
      if (!p) return;
      noPonteiro(e);
      if (modo === "mover") {
        const agora = raycaster.ray.intersectPlane(a.plano, new T.Vector3());
        if (!agora || !a.ponto) return;
        const delta = agora.clone().sub(a.ponto);
        // do mundo para o espaço do pai (o encaixe, ou o osso no caso do encaixe)
        const pai = a.obj.parent;
        const q = pai.getWorldQuaternion(new T.Quaternion()).invert(), s = pai.getWorldScale(new T.Vector3());
        delta.applyQuaternion(q).divide(s);
        const base = a.antes.pos;
        const nova = [base[0] + delta.x, base[1] + delta.y, base[2] + delta.z].map((v, i) => (eixo && "xyz"[i] !== eixo ? base[i] : pegar(v, 0.01)));
        p.pos = nova.map((v) => arred(v));
      } else if (modo === "girar") {
        const i = "xyz".indexOf(eixo || "y");
        const rot = a.antes.rot.slice();
        rot[i] = arred(pegar(rot[i] + dx * 0.6, 15), 100);
        if (!eixo) rot[0] = arred(pegar(a.antes.rot[0] + dy * 0.6, 15), 100);
        p.rot = rot;
      } else {
        const f = Math.exp((dx - dy) * 0.006);
        if (enc) p.escala = arred(Math.max(0.05, pegar(a.antes.escala * f, 0.01)));
        else p.esc = a.antes.esc.map((v, i) => (eixo && "xyz"[i] !== eixo ? v : arred(pegar(v * f, 0.005))));
      }
      sujo = true;
      atualizarObjetos();
      if (!enc && sel) { const props2 = props.querySelectorAll(".estudio-tres input"); void props2; }
    }

    // ── teclas ──────────────────────────────────────────────────────
    const editavel = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    function teclas(e) {
      if (fechado || !caixa.isConnected || editavel(e) || document.querySelector(".lnux-fundo-modal")) return;
      if (!(caixa.contains(document.activeElement) || document.activeElement === document.body)) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === "z") { e.preventDefault(); voltar(desfazer, refazer); desenharBarra(); return; }
      if (ctrl && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); voltar(refazer, desfazer); desenharBarra(); return; }
      if (ctrl && k === "d") { e.preventDefault(); duplicar(); return; }
      if (ctrl || e.altKey) return;
      if (testando && k === "e") { if (!e.repeat && vivo) vivo.usar(null); e.preventDefault(); return; }
      if (k === "w") modo = "mover"; else if (k === "e") modo = "girar"; else if (k === "r") modo = "escala";
      else if (k === "x" || k === "y" || k === "z") eixo = eixo === k ? null : k;
      else if (k === "f") focar();
      else if (k === "delete" || k === "backspace") { if (parteSel()) { e.preventDefault(); apagar(); } return; }
      else if (k === "escape") { sel = null; desenharLista(); desenharProps(); return; }
      else return;
      e.preventDefault();
      desenharBarra();
    }
    function teclaSolta(e) { if (testando && e.key.toLowerCase() === "e" && vivo) vivo.soltarUso(); }
    document.addEventListener("keydown", teclas);
    document.addEventListener("keyup", teclaSolta);

    // ── guardar, abrir, publicar ────────────────────────────────────
    nomeItem.addEventListener("input", () => mudar(() => { def.nome = nomeItem.value.slice(0, 60) || t("Item"); }, false, true));
    async function arquivoDoItem() { return C.exportarItem(C.limparItem(def), malhas, animacoes); }
    /** Uma foto do item (para a lista e a loja). */
    async function foto() {
      const antes = { vista, testando, sel };
      if (testando) alternarTeste(false);
      if (vista !== "item") await trocarVista("item");
      contorno.visible = false;
      focar();
      render.render(cena, camera);
      const blob = await new Promise((ok) => render.domElement.toBlob(ok, "image/png"));
      if (antes.vista !== "item") await trocarVista(antes.vista);
      if (antes.testando) alternarTeste(true);
      return blob;
    }
    async function salvar() {
      if (ajustar) {
        C.itens.gravarAjuste(reg.loja ? "loja:" + reg.loja : reg.id, C.limparItem(def).encaixe);
        if (mochila && mochila.naMao && mochila.naMao.reg.id === reg.id) mochila.aplicarAjuste(C.limparItem(def).encaixe);
        sujo = false;
        LNUX.aviso(t("Ajuste guardado: o item fica assim no seu corpo."), "ok");
        return;
      }
      const prog = LNUX.progresso ? LNUX.progresso(t("Guardando o item")) : null;
      try {
        const blob = await arquivoDoItem();
        let miniatura = null;
        try { miniatura = await foto(); } catch (e) { /* sem foto */ }
        reg = await C.itens.guardar({ ...(reg && reg.origem === "meu" ? { id: reg.id } : {}), nome: def.nome, origem: "meu", miniatura }, blob);
        sujo = false;
        LNUX.aviso(t("\"{nome}\" foi guardado em Meus itens.", { nome: def.nome }), "ok");
      } finally { if (prog) prog.fechar(); }
    }
    async function exportar() {
      const blob = await arquivoDoItem();
      LNUX.baixar ? LNUX.baixar(blob, (def.nome || "item").replace(/[^\w\- ]+/g, "").trim() + ".glb") : window.open(URL.createObjectURL(blob));
    }
    async function publicar() {
      if (!def.partes.length) { LNUX.aviso(t("Adicione pelo menos uma parte antes de publicar."), "alerta"); return; }
      if (!(C.contas && C.contas.eu) && !(C.contas && C.contas.souDonoDoServidor())) {
        LNUX.aviso(t("Só quem tem conta publica na loja. Entre na sua conta (ou crie uma) para publicar."), "alerta");
        if (C.janelaConta) await C.janelaConta("entrar");
        if (!(C.contas && C.contas.eu)) return;
      }
      const tags = await LNUX.dialogo({ titulo: t("Publicar \"{nome}\" na loja", { nome: def.nome }), corpo: el("div", { class: "ajustes" },
        el("p", { style: { margin: 0 } }, t("O item vai para a loja, em Itens: todos veem, baixam e usam. Quem baixar recebe o item já no lugar que você deixou (e pode ajustar no próprio corpo).")),
        el("label", { class: "lnux-campo" }, el("span", {}, t("# para achar (separados por espaço)")), el("input", { class: "lnux-entrada", id: "estudio-tags", placeholder: "lanterna luz" }))),
        botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: "Publicar", primario: true, valor: () => document.querySelector("#estudio-tags").value }] });
      if (tags === null || tags === undefined) return;
      const blob = await arquivoDoItem(), mini = await foto();
      const item = await C.loja.publicar({ tipo: "item", blob, arquivo: (def.nome || "item").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) + ".glb", nome: def.nome, descricao: def.descricao,
        tags: String(tags).split(/[\s,#]+/).filter(Boolean) });
      try { await C.loja.trocarMiniatura(item, mini); } catch (e) { /* sem miniatura */ }
      LNUX.aviso(t("\"{nome}\" está na loja, em Itens.", { nome: def.nome }), "ok");
    }
    async function importarItem() {
      const [a] = await LNUX.arquivos.abrir({ titulo: t("Item para abrir (.glb)"), aceitar: ".glb" });
      if (!a) return;
      await abrirBlob(await a.blob(), null);
    }
    async function abrirBlob(blob, registro) {
      const r = await C.abrirItem(blob);
      def = r.def; malhas = r.malhas; animacoes = r.animacoes; reg = registro;
      if (ajustar && reg) { const aj = C.itens.ajuste(reg.loja ? "loja:" + reg.loja : reg.id); if (aj) def.encaixe = C.limparItem({ encaixe: aj }).encaixe; }
      nomeItem.value = def.nome;
      desfazer.length = 0; refazer.length = 0; sujo = false;
      sel = ajustar ? "encaixe" : null;
      reconstruir();
      desenharProps();
      if (ajustar) await trocarVista(def.encaixe.osso === "rightHand" || def.encaixe.osso === "leftHand" ? "mao" : "corpo");
      else focar();
    }
    function voltarAoCriador() {
      C.itens.gravarAjuste(reg.loja ? "loja:" + reg.loja : reg.id, null);
      C.itens.ler(reg.id).then((b) => abrirBlob(b, reg)).then(() => {
        if (mochila && mochila.naMao && mochila.naMao.reg.id === reg.id) mochila.aplicarAjuste(def.encaixe);
        LNUX.aviso(t("O item voltou ao encaixe de quem criou."), "ok");
      }).catch(LNUX.erro);
    }
    async function novo() {
      if (sujo && !(await LNUX.confirmar(t("Começar um item novo? O que não foi guardado se perde.")))) return;
      def = C.novoItem(); def.nome = t("Item novo"); malhas = new Map(); animacoes = []; reg = null; sel = null;
      nomeItem.value = def.nome;
      desfazer.length = 0; refazer.length = 0; sujo = false;
      reconstruir(); desenharProps(); trocarVista("item");
    }
    async function desenharMeus() {
      const l = await C.itens.lista();
      painelMeus.replaceChildren(...(l.length ? [el("div", { class: "estudio-meus-lista" }, l.map((x) => {
        const mini = x.miniatura instanceof Blob ? el("img", { src: URL.createObjectURL(x.miniatura), alt: "" }) : el("span", { class: "sem-miniatura" }, C.iconeWebc("b-item"));
        return el("div", { class: "estudio-meu", "data-item": x.id }, mini, el("b", { translate: "no" }, x.nome), el("span", { class: "fraco pequeno" }, x.origem === "loja" ? t("da loja") : t("meu")),
          el("div", { class: "estudio-botoes" },
            el("button", { type: "button", class: "lnux-botao pequeno", onclick: async () => { if (sujo && !(await LNUX.confirmar(t("Abrir outro item? O que não foi guardado se perde.")))) return; await abrirBlob(await C.itens.ler(x.id), x.origem === "meu" ? x : null); bMeus.fecharPainel(); } }, x.origem === "loja" ? t("Editar uma cópia") : t("Abrir")),
            el("button", { type: "button", class: "lnux-botao pequeno perigo", onclick: async () => { if (await LNUX.confirmar(t("Apagar \"{nome}\" deste aparelho?", { nome: x.nome }))) { await C.itens.apagar(x.id); desenharMeus(); } } }, t("Apagar"))));
      }))] : [el("p", { class: "fraco" }, t("Nenhum item guardado ainda. Monte um e aperte Salvar."))]));
    }

    // ── o laço de desenho ───────────────────────────────────────────
    const relogio = new T.Clock();
    function redimensionar() {
      const w = Math.max(10, tela.clientWidth), h = Math.max(10, tela.clientHeight);
      render.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const observador = new ResizeObserver(redimensionar);
    observador.observe(tela);
    function quadro() {
      if (fechado) return;
      const dt = Math.min(0.05, relogio.getDelta());
      if (boneco && vista === "corpo") {
        // o boneco com os braços para baixo e a mão fechada em volta do cabo
        const pose = {};
        for (const [n, no] of Object.entries(boneco.nos)) { no.quaternion.identity(); pose[n] = no.quaternion; }
        if (pose.rightUpperArm) pose.rightUpperArm.setFromEuler(new T.Euler(0, 0, 1.25));
        if (pose.leftUpperArm) pose.leftUpperArm.setFromEuler(new T.Euler(0, 0, -1.25));
        C.poseDeSegurar(pose, def.encaixe.osso, 0);
        boneco.vrm.update(dt);
      }
      if (vivo) vivo.atualizar(dt);
      const p = parteSel(), obj = sel === "encaixe" ? vivo && vivo.corpo : p && vivo && vivo.objetos.get(p.id);
      if (obj) { contorno.box.copy(caixaDe(obj)); contorno.visible = !contorno.box.isEmpty(); } else contorno.visible = false;
      if (testando && vivo) {
        const vivas = [...vivo.emissores.values()].reduce((s, e) => s + (e.vivas || 0), 0) + (vivo.impacto ? vivo.impacto.vivas || 0 : 0);
        infoTeste.textContent = t("{p} partículas · {q} projéteis · {n} tiros", { p: vivas, q: vivo.projeteis.length, n: vivo.tiros || 0 });
      }
      render.render(cena, camera);
      requestAnimationFrame(quadro);
    }

    // ── começa ──────────────────────────────────────────────────────
    desenharBarra();
    reconstruir();
    desenharProps();
    redimensionar();
    posicionarCamera();
    requestAnimationFrame(quadro);
    (async () => {
      if (!id) return;
      const registro = (await C.itens.lista()).find((x) => x.id === id), blob = registro && (await C.itens.ler(id));
      if (blob) await abrirBlob(blob, registro);
    })().catch(LNUX.erro);

    function fechar() {
      fechado = true;
      clearTimeout(remontarT);
      document.removeEventListener("keydown", teclas);
      document.removeEventListener("keyup", teclaSolta);
      observador.disconnect();
      if (vivo) vivo.descartar();
      render.dispose();
      caixa.remove();
    }
    return { fechar, get def() { return def; }, get vivo() { return vivo; }, novaParte, escolher, trocarVista, alternarTeste, salvar, publicar, foto, get sel() { return sel; }, get cena() { return cena; }, camera, render };
  };
})();
