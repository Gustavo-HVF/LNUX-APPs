/*
 * Companhia — montar uma cena do Unity (.unity) de um .unitypackage: cada modelo no lugar.
 *
 * Um mundo do VRChat vem como um pacote do Unity com a cena (.unity, em YAML) e centenas de peças (.fbx, .obj, .glb,
 * .prefab, .mat, texturas). A cena só diz onde cada peça fica. Aqui ela é lida e montada:
 *   - os Transform (posição, giro, tamanho e o pai) dão o lugar de cada objeto;
 *   - um objeto com MeshFilter mostra a malha de um modelo (achada pelo nome, pela ficha .meta do modelo:
 *     internalIDToNameTable ou fileIDToRecycleName) ou uma forma pronta do Unity (cubo, esfera, cilindro, cápsula, plano,
 *     quadrado), com o material dele (.mat: cor e textura, js/texturas.js);
 *   - um PrefabInstance de um modelo (arrastar o .fbx para a cena) põe o modelo inteiro no lugar; de um .prefab, monta o
 *     prefab do mesmo jeito (até 4 níveis), com as mudanças de posição, giro e tamanho que a cena fez;
 *   - o Unity usa a mão esquerda (X para a direita, Z para a frente) e o three.js a direita: o X troca de sinal (e o giro
 *     acompanha). Os .fbx entram em metros como no Unity (a unidade do arquivo e a escala da ficha .meta).
 *   - as malhas guardadas pelo próprio Unity (Mesh .asset, comuns em mundos sem .fbx) são lidas por js/unity-malha.js;
 *   - a física vai junto, nos "extras" do .glb (userData.webc, lido por js/mundo.js e js/fisica.js):
 *       · só os colisores sólidos do Unity seguram a pessoa (BoxCollider, SphereCollider, CapsuleCollider e
 *         MeshCollider sem "Is Trigger", fora das camadas que o VRChat deixa atravessar: Pickup, Walkthrough, UI...).
 *         As malhas sem colisor (plantas, heras, enfeites) ficam atravessáveis, como no Unity: webc.colide = false;
 *         os colisores que não têm malha visível viram peças "só colisão" (webc.soColisao);
 *       · um objeto com Rigidbody vira um corpo com física (webc.corpo: massa, gravidade, cinemático, a forma do
 *         colisor, quique e atrito do material de física), com as peças filhas dentro dele;
 *       · o VRC Pickup do VRChat (o componente com "pickupable") marca o corpo como pegável (webc.corpo.pegavel).
 * O que não vem: terrenos (Terrain), luzes assadas (lightmaps), sondas, scripts (Udon), partículas, sons e animações.
 *
 * C.unityCena = {cenas(arquivos) → [caminhos .unity], montar(arquivos, cena, {carregarModelo}) → {grupo, colocados, faltaram}}.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const PRONTAS = { 10202: "cubo", 10207: "esfera", 10206: "cilindro", 10208: "capsula", 10209: "plano", 10210: "quadrado" };
  const GUID_PRONTO = "0000000000000000e000000000000000";
  const MODELO = /\.(fbx|obj|glb|gltf|dae|blend|3ds|stl|ply)$/i;

  /** Os documentos do YAML do Unity: [{classe, id, despojado, corpo}]. */
  function documentos(texto) {
    const docs = [];
    const partes = texto.split(/\r?\n--- !u!/);
    for (const p of partes.slice(1)) {
      const cab = /^(\d+) &(-?\d+)( stripped)?/.exec(p);
      if (cab) docs.push({ classe: +cab[1], id: cab[2], despojado: !!cab[3], corpo: p });
    }
    return docs;
  }
  const campo = (corpo, nome) => { const m = new RegExp("^\\s*" + nome + ":[ \\t]*(.*)$", "m").exec(corpo); return m ? m[1].trim() : null; };
  const ref = (v) => { if (!v) return null; const f = /fileID:\s*(-?\d+)/.exec(v), g = /guid:\s*([0-9a-f]{32})/.exec(v); return { id: f ? f[1] : "0", guid: g ? g[1] : null }; };
  const vetor = (v, chaves, padrao) => { if (!v) return padrao; const r = chaves.map((k) => { const m = new RegExp("\\b" + k + ":\\s*(-?[\\d.eE+-]+)").exec(v); return m ? +m[1] : NaN; }); return r.some((x) => !Number.isFinite(x)) ? padrao : r; };

  /** A ficha .meta de um modelo: o nome de cada malha pelo fileID, e a escala de importação. */
  function fichaDoModelo(texto) {
    const nomes = new Map();
    if (texto) {
      for (const m of texto.matchAll(/-\s*first:\s*\r?\n\s*(\d+):\s*(-?\d+)\s*\r?\n\s*second:[ \t]*(.*)/g)) nomes.set(m[2], m[3].trim().replace(/^["']|["']$/g, ""));
      for (const m of texto.matchAll(/^\s*(-?\d+):[ \t]*(\S.*)$/gm)) if (/^43\d{5}$|^-?\d{6,}$/.test(m[1]) && !nomes.has(m[1]) && !/[{}]/.test(m[2])) nomes.set(m[1], m[2].trim());
    }
    const escala = texto ? +((/globalScale:\s*([\d.eE+-]+)/.exec(texto) || [])[1] || 1) : 1;
    const usarArquivo = texto ? !/useFileScale:\s*0/.test(texto) : true;
    return { nomes, escala: Number.isFinite(escala) && escala > 0 ? escala : 1, usarArquivo };
  }

  /** Lê uma cena (ou um .prefab): os transforms, os objetos, as malhas, os materiais e as instâncias de prefab. */
  function lerCena(texto) {
    const T = window.THREE;
    const transforms = new Map(), objetos = new Map(), malhaDe = new Map(), materiaisDe = new Map(), instancias = new Map(), despojados = new Map();
    const colisores = new Map(), corpos = new Map(), pegaveis = new Set(), escondidos = new Set();
    let partidas = [];
    const lista = (mapa, k, v) => (mapa.get(k) || mapa.set(k, []).get(k)).push(v);
    for (const d of documentos(texto)) {
      if (d.classe === 4 || d.classe === 224) {
        if (d.despojado) { const pi = ref(campo(d.corpo, "m_PrefabInstance") || campo(d.corpo, "m_PrefabInternal")); if (pi) despojados.set(d.id, pi.id); continue; }
        transforms.set(d.id, {
          id: d.id, objeto: (ref(campo(d.corpo, "m_GameObject")) || {}).id, pai: (ref(campo(d.corpo, "m_Father")) || {}).id || "0",
          pos: vetor(campo(d.corpo, "m_LocalPosition"), ["x", "y", "z"], [0, 0, 0]), rot: vetor(campo(d.corpo, "m_LocalRotation"), ["x", "y", "z", "w"], [0, 0, 0, 1]),
          esc: vetor(campo(d.corpo, "m_LocalScale"), ["x", "y", "z"], [1, 1, 1]),
        });
      } else if (d.classe === 1 && !d.despojado) objetos.set(d.id, { nome: campo(d.corpo, "m_Name") || "", ativo: campo(d.corpo, "m_IsActive") !== "0", camada: +(campo(d.corpo, "m_Layer") || 0) });
      else if (d.classe === 33 && !d.despojado) { const go = ref(campo(d.corpo, "m_GameObject")), m = ref(campo(d.corpo, "m_Mesh")); if (go && m) malhaDe.set(go.id, m); }
      else if ((d.classe === 23 || d.classe === 137) && !d.despojado) {
        const go = ref(campo(d.corpo, "m_GameObject")), lista = [];
        const bloco = /m_Materials:\s*\r?\n((?:\s*-\s*\{[^}]*\}\s*\r?\n?)+)/.exec(d.corpo);
        if (bloco) for (const x of bloco[1].matchAll(/\{[^}]*\}/g)) { const r = ref(x[0]); lista.push(r && r.guid ? r.guid : null); }
        if (go) materiaisDe.set(go.id, lista);
        if (go && campo(d.corpo, "m_Enabled") === "0") escondidos.add(go.id); // o desenho desligado (a peça só colide)
        if (d.classe === 137 && go) { const m = ref(campo(d.corpo, "m_Mesh")); if (m && !malhaDe.has(go.id)) malhaDe.set(go.id, m); }
      } else if ([64, 65, 135, 136].includes(d.classe) && !d.despojado) {
        // os colisores: a forma, se é gatilho (atravessável) e o material de física
        const go = ref(campo(d.corpo, "m_GameObject"));
        if (!go || campo(d.corpo, "m_Enabled") === "0") continue;
        const c = { tipo: { 64: "malha", 65: "caixa", 135: "esfera", 136: "capsula" }[d.classe], gatilho: campo(d.corpo, "m_IsTrigger") === "1",
          centro: vetor(campo(d.corpo, "m_Center"), ["x", "y", "z"], [0, 0, 0]), material: (ref(campo(d.corpo, "m_Material")) || {}).guid || null };
        if (c.tipo === "caixa") c.tamanho = vetor(campo(d.corpo, "m_Size"), ["x", "y", "z"], [1, 1, 1]);
        if (c.tipo === "esfera" || c.tipo === "capsula") c.raio = +(campo(d.corpo, "m_Radius") || 0.5);
        if (c.tipo === "capsula") { c.altura = +(campo(d.corpo, "m_Height") || 2); c.direcao = +(campo(d.corpo, "m_Direction") || 1); }
        if (c.tipo === "malha") { c.malha = ref(campo(d.corpo, "m_Mesh")); c.convexo = campo(d.corpo, "m_Convex") === "1"; }
        lista(colisores, go.id, c);
      } else if (d.classe === 54 && !d.despojado) {
        const go = ref(campo(d.corpo, "m_GameObject"));
        if (go) corpos.set(go.id, { massa: +(campo(d.corpo, "m_Mass") || 1), arrasto: +(campo(d.corpo, "m_Drag") || 0), arrastoGiro: +(campo(d.corpo, "m_AngularDrag") || 0.05),
          gravidade: campo(d.corpo, "m_UseGravity") !== "0", cinematico: campo(d.corpo, "m_IsKinematic") === "1", travas: +(campo(d.corpo, "m_Constraints") || 0) });
      } else if (d.classe === 114 && !d.despojado && /^\s*spawns:\s*$/m.test(d.corpo) && !partidas.length) {
        // o VRC Scene Descriptor: onde a pessoa nasce
        const b = /^\s*spawns:\s*\r?\n((?:\s*-\s*\{[^}]*\}\s*\r?\n?)+)/m.exec(d.corpo);
        if (b) partidas = [...b[1].matchAll(/fileID:\s*(-?\d+)/g)].map((m) => m[1]).filter((x) => x !== "0");
      } else if (d.classe === 114 && !d.despojado && /^\s*pickupable:\s*1/m.test(d.corpo)) {
        // o VRC Pickup (o componente do VRChat para pegar com a mão)
        const go = ref(campo(d.corpo, "m_GameObject"));
        if (go && campo(d.corpo, "m_Enabled") !== "0") pegaveis.add(go.id);
      } else if (d.classe === 1001) {
        const fonte = ref(campo(d.corpo, "m_SourcePrefab") || campo(d.corpo, "m_ParentPrefab"));
        const pai = (ref(campo(d.corpo, "m_TransformParent")) || {}).id || "0";
        // as mudanças: [{alvo, caminho, valor}]
        const mudancas = [];
        for (const m of d.corpo.matchAll(/-\s*target:\s*(\{[^}]*\})\s*\r?\n\s*propertyPath:[ \t]*(\S+)\s*\r?\n\s*value:[ \t]*(.*)/g)) mudancas.push({ alvo: (ref(m[1]) || {}).id, caminho: m[2], valor: m[3].trim() });
        instancias.set(d.id, { id: d.id, fonte: fonte && fonte.guid, pai, mudancas });
      }
    }
    // o transform de cada objeto (para achar o lugar de cada um sem procurar na lista toda)
    const transformDe = new Map();
    for (const t of transforms.values()) if (t.objeto) transformDe.set(t.objeto, t);
    return { transforms, objetos, malhaDe, materiaisDe, instancias, despojados, colisores, corpos, pegaveis, escondidos, transformDe, partidas, T };
  }

  // as camadas que o VRChat deixa a pessoa atravessar (UI, Player, PlayerLocal, UiMenu, Pickup, PickupNoEnvironment,
  // StereoLeft/Right, Walkthrough, MirrorReflection): um colisor nelas não segura ninguém
  const CAMADAS_ATRAVESSAVEIS = new Set([5, 9, 10, 12, 13, 14, 15, 16, 17, 18]);

  /** Unity (mão esquerda) → three.js (mão direita): o X troca de sinal; no giro, Y e Z. */
  function matrizLocal(pos, rot, esc) {
    const T = window.THREE;
    return new T.Matrix4().compose(new T.Vector3(-pos[0], pos[1], pos[2]), new T.Quaternion(rot[0], -rot[1], -rot[2], rot[3]).normalize(), new T.Vector3(esc[0], esc[1], esc[2]));
  }
  /** A posição, o giro e o tamanho que uma instância de prefab pôs no objeto raiz (o alvo com mais mudanças de lugar). */
  function lugarDaInstancia(inst) {
    const porAlvo = new Map();
    for (const m of inst.mudancas) if (/^m_Local(Position|Rotation|Scale)\./.test(m.caminho)) (porAlvo.get(m.alvo) || porAlvo.set(m.alvo, []).get(m.alvo)).push(m);
    let lista = [];
    for (const l of porAlvo.values()) if (l.length > lista.length) lista = l;
    const pos = [0, 0, 0], rot = [0, 0, 0, 1], esc = [1, 1, 1];
    for (const m of lista) {
      const [, qual, eixo] = /^m_Local(Position|Rotation|Scale)\.(\w)$/.exec(m.caminho) || [];
      const v = +m.valor, i = "xyzw".indexOf(eixo);
      if (!Number.isFinite(v) || i < 0) continue;
      if (qual === "Position" && i < 3) pos[i] = v; else if (qual === "Rotation") rot[i] = v; else if (qual === "Scale" && i < 3) esc[i] = v;
    }
    const nome = (inst.mudancas.find((m) => m.caminho === "m_Name") || {}).valor;
    const ativo = (inst.mudancas.find((m) => m.caminho === "m_IsActive") || {}).valor !== "0";
    return { pos, rot, esc, nome, ativo };
  }

  C.unityCena = {
    /** As cenas do pacote (.unity), da maior para a menor. */
    cenas(arquivos) { return [...arquivos.keys()].filter((n) => /\.unity$/i.test(n)).sort((a, b) => arquivos.get(b).size - arquivos.get(a).size); },
    /**
     * Monta a cena. arquivos: o pacote (com .guids e .metas, de C.lerUnityPackage); cena: o caminho do .unity;
     * carregarModelo(caminho) → Promise<Object3D> (o modelo inteiro, em metros, com as texturas). Devolve {grupo,
     * colocados, faltaram (modelos que não abriram)}.
     */
    async montar(arquivos, cena, { carregarModelo, aoProgresso = () => {} } = {}) {
      const T = window.THREE, guids = arquivos.guids || new Map(), metas = arquivos.metas || new Map();
      const grupo = new T.Group();
      grupo.name = cena.split("/").pop().replace(/\.unity$/i, "");
      const modelos = new Map(), fichas = new Map(), faltaram = new Set(), materiais = new Map();
      let colocados = 0;
      const ficha = (caminho) => { if (!fichas.has(caminho)) fichas.set(caminho, fichaDoModelo(metas.get(caminho))); return fichas.get(caminho); };
      /** O modelo (uma vez só), já na escala do Unity. */
      const modelo = async (caminho) => {
        if (!modelos.has(caminho)) {
          let o = null;
          try {
            o = await carregarModelo(caminho);
            const f = ficha(caminho), unidade = /\.fbx$/i.test(caminho) && f.usarArquivo ? (o.userData.unitScaleFactor || 1) / 100 : 1;
            const raiz = new T.Group();
            raiz.add(o);
            raiz.scale.setScalar(unidade * f.escala);
            raiz.updateMatrixWorld(true);
            o = raiz;
          } catch (e) { faltaram.add(caminho.split("/").pop()); o = null; }
          modelos.set(caminho, o);
        }
        return modelos.get(caminho);
      };
      /** A imagem de uma textura do pacote (PNG, JPEG, TGA, PSD ou a Texture2D .asset do Unity), num canvas (uma vez só). */
      const imagens = new Map(), previas = arquivos.previas || new Map();
      let texturasLidas = 0, texturasPrevia = 0;
      const imagem = async (img) => {
        if (imagens.has(img)) return imagens.get(img);
        let tela = null;
        try {
          const blob = arquivos.get(img);
          if (/\.asset$/i.test(img)) {
            const r = C.unityTextura ? await C.unityTextura.imagem(await blob.text(), previas.get(img)) : null;
            if (r) { tela = r.tela; if (r.como === "lida") texturasLidas++; else texturasPrevia++; }
          } else {
            tela = document.createElement("canvas");
            if (/\.(tga|psd)$/i.test(img)) { const d = new Uint8Array(await blob.arrayBuffer()), dd = /\.psd$/i.test(img) ? C.avatar.lerPSD(d) : C.avatar.lerTGA(d); tela.width = dd.width; tela.height = dd.height; tela.getContext("2d").putImageData(dd, 0, 0); }
            else { const bmp = await createImageBitmap(blob); tela.width = bmp.width; tela.height = bmp.height; tela.getContext("2d").drawImage(bmp, 0, 0); bmp.close(); }
          }
        } catch (e) { tela = null; }
        imagens.set(img, tela);
        return tela;
      };
      /** O material de um .mat (cor e textura), ou null. */
      const material = async (guid) => {
        if (materiais.has(guid)) return materiais.get(guid);
        let m = null;
        const caminho = guids.get(guid);
        if (caminho && /\.mat$/i.test(caminho) && C.avatar) {
          try {
            const mat = C.avatar.lerMat(await arquivos.get(caminho).text());
            m = new T.MeshStandardMaterial({ name: mat.nome || caminho.split("/").pop(), roughness: 0.85 });
            const modo = C.avatar.modoAlfa ? C.avatar.modoAlfa(mat) : "OPAQUE";
            if (modo === "MASK") { m.alphaTest = Math.min(0.9, Math.max(0.05, mat.numeros._Cutoff ?? 0.5)); m.side = T.DoubleSide; }
            else if (modo === "BLEND") { m.transparent = true; m.depthWrite = false; }
            if (mat.numeros._Cull === 0 || mat.numeros._CullMode === 0) m.side = T.DoubleSide;
            const cor = mat.cores._Color || mat.cores._BaseColor;
            if (cor) { m.color.setRGB(Math.min(1, cor[0]), Math.min(1, cor[1]), Math.min(1, cor[2]), T.SRGBColorSpace); if (m.transparent && cor[3] < 1) m.opacity = Math.max(0.05, cor[3]); }
            const tx = C.texturas.doMaterialUnity(mat.texturas, (g) => guids.has(g) && /\.(png|jpe?g|webp|tga|psd|bmp|asset)$/i.test(guids.get(g)) && arquivos.has(guids.get(g)));
            const tela = tx.cor ? await imagem(guids.get(tx.cor)) : null;
            if (tela) {
              const t = new T.CanvasTexture(tela);
              t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping;
              m.map = t;
            }
          } catch (e) { m = null; }
        }
        materiais.set(guid, m);
        return m;
      };
      /** Uma malha guardada pelo Unity (.asset): a geometria (uma vez só), ou null. */
      const malhasAsset = new Map();
      const malhaAsset = async (guid) => {
        if (malhasAsset.has(guid)) return malhasAsset.get(guid);
        let g = null;
        const caminho = guids.get(guid);
        if (caminho && /\.asset$/i.test(caminho) && arquivos.get(caminho) && C.unityMalha) {
          try { g = C.unityMalha.ler(await arquivos.get(caminho).text()); } catch (e) { g = null; }
          if (!g) faltaram.add(caminho.split("/").pop());
        }
        malhasAsset.set(guid, g);
        return g;
      };
      /** O material de física (.physicMaterial): quique e atrito. */
      const fisicos = new Map();
      const materialFisico = async (guid) => {
        if (!guid) return null;
        if (fisicos.has(guid)) return fisicos.get(guid);
        let r = null;
        const caminho = guids.get(guid);
        if (caminho && /\.physicmaterial$/i.test(caminho) && arquivos.get(caminho)) {
          const t = await arquivos.get(caminho).text();
          r = { quique: +(campo(t, "bounciness") || campo(t, "m_Bounciness") || 0), atrito: +(campo(t, "dynamicFriction") || campo(t, "m_DynamicFriction") || 0.6) };
        }
        fisicos.set(guid, r);
        return r;
      };
      let colisoresSolidos = 0, corposFeitos = 0, pegaveisFeitos = 0, soColisao = 0, partida = null;
      // (sem "wireframe": o exportador de glTF gravaria como linhas, e o jogo não acharia a malha)
      const MATERIAL_COLISAO = new T.MeshBasicMaterial({ name: "WEBC_colisor", color: 0xff00ff, transparent: true, opacity: 0.2, depthWrite: false });
      /** A geometria de um colisor de forma (caixa, esfera, cápsula) no espaço do objeto (three.js). */
      const geometriaColisor = (c) => {
        const ctr = [-c.centro[0], c.centro[1], c.centro[2]];
        let g;
        if (c.tipo === "caixa") g = new T.BoxGeometry(Math.abs(c.tamanho[0]) || 1e-3, Math.abs(c.tamanho[1]) || 1e-3, Math.abs(c.tamanho[2]) || 1e-3);
        else if (c.tipo === "esfera") g = new T.SphereGeometry(c.raio, 12, 8);
        else {
          g = new T.CapsuleGeometry(c.raio, Math.max(0, c.altura - 2 * c.raio), 4, 10);
          if (c.direcao === 0) g.rotateZ(Math.PI / 2); else if (c.direcao === 2) g.rotateX(Math.PI / 2);
        }
        g.translate(ctr[0], ctr[1], ctr[2]);
        return g;
      };
      const formaPronta = (tipo) => {
        const g = { cubo: () => new T.BoxGeometry(1, 1, 1), esfera: () => new T.SphereGeometry(0.5, 24, 16), cilindro: () => new T.CylinderGeometry(0.5, 0.5, 2, 24), capsula: () => new T.CapsuleGeometry(0.5, 1, 8, 16),
          plano: () => new T.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), quadrado: () => new T.PlaneGeometry(1, 1) }[tipo]();
        return g;
      };

      /** Monta uma cena ou um prefab dentro de "destino" (com a matriz da base), até 4 prefabs dentro de prefabs. */
      const montarTexto = async (texto, destino, base, nivel) => {
        const c = lerCena(texto);
        const mundo = new Map();
        // a matriz de cada transform no mundo (pais primeiro; um transform de prefab "despojado" vale a instância)
        const matrizInstancia = new Map();
        const matrizDe = (id, fundo = 0) => {
          if (!id || id === "0") return base;
          if (mundo.has(id)) return mundo.get(id);
          if (fundo > 200) return base;
          const t = c.transforms.get(id);
          let m;
          if (t) m = matrizDe(t.pai, fundo + 1).clone().multiply(matrizLocal(t.pos, t.rot, t.esc));
          else if (c.despojados.has(id) && c.instancias.has(c.despojados.get(id))) m = matrizDaInstancia(c.instancias.get(c.despojados.get(id)), fundo + 1);
          else m = base;
          mundo.set(id, m);
          return m;
        };
        const matrizDaInstancia = (inst, fundo = 0) => {
          if (matrizInstancia.has(inst.id)) return matrizInstancia.get(inst.id);
          const l = lugarDaInstancia(inst), m = matrizDe(inst.pai, fundo + 1).clone().multiply(matrizLocal(l.pos, l.rot, l.esc));
          matrizInstancia.set(inst.id, m);
          return m;
        };
        // ativo: o objeto ligado e os pais ligados. Muitos mundos guardam as salas desligadas e ligam por script na hora
        // (quem entra na sala liga ela): um grupo desligado com muitas malhas dentro conta como ligado, menos os que têm
        // cara de sobra (versão velha, de depuração, de teste, a versão para Quest/celular, a de sombra/oclusão)
        const malhasDentro = new Map();
        for (const go of c.malhaDe.keys()) {
          let t = c.transformDe.get(go), fundo = 0;
          while (t && fundo++ < 300) { malhasDentro.set(t.id, (malhasDentro.get(t.id) || 0) + 1); t = c.transforms.get(t.pai); }
        }
        const SOBRA = /\b(old|debug|test|teste|backup|unused|quest|android|mobile|occluder|occlusion|lod[1-9]|_off|disabled|hidden|deprecated)\b|(^|[\s_-])(old|bak|wip)([\s_-]|$)/i;
        const ativoCache = new Map();
        const ativo = (tr, fundo = 0) => {
          if (!tr) return true;
          if (ativoCache.has(tr.id)) return ativoCache.get(tr.id);
          const o = c.objetos.get(tr.objeto);
          const ligado = !o || o.ativo || ((malhasDentro.get(tr.id) || 0) >= 12 && !SOBRA.test(o.nome.replace(/([a-z])([A-Z])/g, "$1 $2")));
          const r = ligado && (!o || !SOBRA.test(o.nome) || o.ativo) && (fundo > 200 || ativo(c.transforms.get(tr.pai), fundo + 1));
          ativoCache.set(tr.id, r);
          return r;
        };
        // o ponto de nascer (o primeiro do VRC Scene Descriptor): a posição e para onde olha
        if (nivel === 0 && c.partidas.length && c.transforms.has(c.partidas[0])) {
          const mp = matrizDe(c.partidas[0]), pos = new T.Vector3(), q = new T.Quaternion();
          mp.decompose(pos, q, new T.Vector3());
          const frente = new T.Vector3(0, 0, 1).applyQuaternion(q);
          partida = { pos: pos.toArray().map((v) => +v.toFixed(3)), rumo: +Math.atan2(frente.x, frente.z).toFixed(3) };
        }
        // os corpos com física (Rigidbody): um grupo cada, no lugar do objeto; as peças dentro dele vão junto
        const corpoDoTransform = new Map();
        for (const [go, rb] of c.corpos) {
          const tr = c.transformDe.get(go);
          if (!tr || !ativo(tr)) continue;
          const pega = c.pegaveis.has(go);
          if (rb.cinematico && !pega) continue; // cinemático sem ser pegável: o Unity move por animação ou script; fica parado
          const g = new T.Group();
          g.name = (c.objetos.get(go) || {}).nome || "Corpo";
          g.applyMatrix4(matrizDe(tr.id));
          g.userData.webc = { corpo: { massa: rb.massa, arrasto: rb.arrasto, gravidade: rb.gravidade && !rb.cinematico, cinematico: rb.cinematico, pegavel: pega, travas: rb.travas } };
          destino.add(g);
          corpoDoTransform.set(tr.id, g);
          corposFeitos++;
          if (pega) pegaveisFeitos++;
        }
        /** O corpo em que o transform está (ele mesmo ou um pai), ou null. */
        const corpoDe = (tr, fundo = 0) => {
          for (let t = tr; t && fundo < 200; t = c.transforms.get(t.pai), fundo++) if (corpoDoTransform.has(t.id)) return corpoDoTransform.get(t.id);
          return null;
        };
        /** Põe a peça (já no lugar do mundo) no corpo dela, se tiver, ou no destino. */
        const colocar = (peca, tr) => {
          destino.add(peca);
          const corpo = corpoDe(tr);
          if (corpo) { destino.updateMatrixWorld(true); corpo.attach(peca); }
        };
        // os objetos com malha
        for (const [go, malha] of c.malhaDe) {
          const tr = c.transformDe.get(go);
          if (!tr || !ativo(tr)) continue;
          const obj = c.objetos.get(go);
          const m = matrizDe(tr.id);
          const listaMats = c.materiaisDe.get(go) || [];
          const mats = await Promise.all(listaMats.map(material));
          let peca = null;
          if (malha.guid === GUID_PRONTO && PRONTAS[malha.id]) {
            peca = new T.Mesh(formaPronta(PRONTAS[malha.id]), mats.find(Boolean) || new T.MeshStandardMaterial({ color: 0xcfd3dc, roughness: 0.9 }));
          } else if (malha.guid && guids.has(malha.guid) && /\.asset$/i.test(guids.get(malha.guid))) {
            const geo = await malhaAsset(malha.guid);
            if (geo) {
              const cinza = new T.MeshStandardMaterial({ color: 0xcfd3dc, roughness: 0.9 });
              const lista = geo.groups.length > 1 ? geo.groups.map((_, i) => mats[Math.min(i, mats.length - 1)] || cinza) : mats.find(Boolean) || cinza;
              peca = new T.Mesh(geo, lista);
            }
          } else if (malha.guid && guids.has(malha.guid) && MODELO.test(guids.get(malha.guid))) {
            const caminho = guids.get(malha.guid), mod = await modelo(caminho);
            if (!mod) continue;
            const nome = ficha(caminho).nomes.get(malha.id);
            let achada = null;
            if (nome) mod.traverse((o) => { if (!achada && o.isMesh && (o.name === nome || (o.geometry && o.geometry.name === nome) || T.PropertyBinding.sanitizeNodeName(nome) === o.name)) achada = o; });
            if (achada) {
              peca = new T.Mesh(achada.geometry, mats.some(Boolean) ? (mats.length > 1 ? mats.map((x) => x || achada.material) : mats[0] || achada.material) : achada.material);
              // a malha do Unity está no espaço do próprio nó (sem o lugar dele dentro do modelo), na escala de importação
              const s = new T.Vector3();
              achada.getWorldScale(s);
              peca.scale.copy(s);
            } else peca = mod.clone(true);
          }
          if (!peca) continue;
          const g = new T.Group();
          g.name = (obj && obj.nome) || "Peça";
          g.applyMatrix4(m);
          g.add(peca);
          // colide só se o próprio objeto tem um MeshCollider sólido com a mesma malha (os outros colisores viram peças só de colisão)
          const cols = c.colisores.get(go) || [], camada = obj ? obj.camada : 0;
          const colide = cols.some((x) => !x.gatilho && x.tipo === "malha" && x.malha && x.malha.guid === malha.guid && x.malha.id === malha.id) && !CAMADAS_ATRAVESSAVEIS.has(camada);
          g.userData.webc = { colide };
          if (c.escondidos.has(go)) { if (!colide) continue; g.userData.webc.soColisao = true; } // desenho desligado: só a colisão (o WEBC esconde ao abrir)
          colocar(g, tr);
          colocados++;
        }
        // os colisores: as formas viram peças "só colisão" (ou a forma do corpo, num corpo com física)
        for (const [go, cols] of c.colisores) {
          const tr = c.transformDe.get(go);
          if (!tr || !ativo(tr)) continue;
          const obj = c.objetos.get(go), corpo = corpoDe(tr);
          for (const col of cols) {
            if (col.gatilho) continue;
            if (corpo) {
              // a forma do corpo: o primeiro colisor sólido dele (no espaço do grupo do corpo)
              const dados = corpo.userData.webc.corpo;
              if (dados.forma) continue;
              const fis = await materialFisico(col.material);
              if (fis) { dados.quique = fis.quique; dados.atrito = fis.atrito; }
              let geo = null;
              if (col.tipo === "malha") { const gm = col.malha && (await malhaAsset(col.malha.guid)); if (gm) geo = gm.clone(); }
              else geo = geometriaColisor(col);
              if (!geo) continue;
              destino.updateMatrixWorld(true);
              geo.applyMatrix4(new T.Matrix4().copy(corpo.matrixWorld).invert().multiply(destino.matrixWorld).multiply(matrizDe(tr.id)));
              geo.computeBoundingBox();
              const caixa = geo.boundingBox, tam = caixa.getSize(new T.Vector3()), ctr = caixa.getCenter(new T.Vector3());
              dados.forma = { tipo: col.tipo === "esfera" ? "esfera" : col.tipo === "capsula" ? "capsula" : "caixa", centro: ctr.toArray().map((v) => +v.toFixed(4)), meia: tam.multiplyScalar(0.5).toArray().map((v) => +v.toFixed(4)) };
              geo.dispose();
              continue;
            }
            if (CAMADAS_ATRAVESSAVEIS.has(obj ? obj.camada : 0)) continue;
            colisoresSolidos++;
            if (col.tipo === "malha") {
              // a malha do colisor é a mesma que aparece: a peça visível já colide
              const malha = c.malhaDe.get(go);
              if (malha && col.malha && malha.guid === col.malha.guid && malha.id === col.malha.id) continue;
              const gm = col.malha && (col.malha.guid === GUID_PRONTO ? (PRONTAS[col.malha.id] ? formaPronta(PRONTAS[col.malha.id]) : null) : await malhaAsset(col.malha.guid));
              if (!gm) continue;
              const p = new T.Mesh(gm, MATERIAL_COLISAO);
              p.name = "WEBC_colisor";
              p.applyMatrix4(matrizDe(tr.id));
              p.userData.webc = { soColisao: true, colide: true };
              destino.add(p);
              soColisao++;
            } else {
              const p = new T.Mesh(geometriaColisor(col), MATERIAL_COLISAO);
              p.name = "WEBC_colisor";
              p.applyMatrix4(matrizDe(tr.id));
              p.userData.webc = { soColisao: true, colide: true };
              destino.add(p);
              soColisao++;
            }
          }
        }
        // um corpo sem colisor sólido: a forma é a caixa das peças dele
        for (const corpo of corpoDoTransform.values()) {
          const dados = corpo.userData.webc.corpo;
          if (dados.forma) continue;
          corpo.updateMatrixWorld(true);
          const inv = corpo.matrixWorld.clone().invert(), caixa = new T.Box3();
          corpo.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); caixa.union(o.geometry.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld))); } });
          if (caixa.isEmpty()) { corpo.userData.webc = { corpoVazio: true }; continue; }
          const tam = caixa.getSize(new T.Vector3()), ctr = caixa.getCenter(new T.Vector3());
          dados.forma = { tipo: "caixa", centro: ctr.toArray().map((v) => +v.toFixed(4)), meia: tam.multiplyScalar(0.5).toArray().map((v) => +v.toFixed(4)) };
        }
        // as instâncias de prefab (de um modelo, ou de outro .prefab)
        for (const inst of c.instancias.values()) {
          const l = lugarDaInstancia(inst);
          if (!l.ativo || !inst.fonte || !guids.has(inst.fonte)) continue;
          const caminho = guids.get(inst.fonte), m = matrizDaInstancia(inst);
          if (MODELO.test(caminho)) {
            const mod = await modelo(caminho);
            if (!mod) continue;
            const g = mod.clone(true);
            g.name = l.nome || caminho.split("/").pop();
            g.applyMatrix4(m);
            destino.add(g);
            colocados++;
          } else if (/\.prefab$/i.test(caminho) && nivel < 4) {
            await montarTexto(await arquivos.get(caminho).text(), destino, m, nivel + 1);
          }
          aoProgresso(Math.min(0.95, colocados / 400));
        }
      };
      await montarTexto(await arquivos.get(cena).text(), grupo, new T.Matrix4(), 0);
      // com colisores sólidos, quem decide a colisão é o Unity: o resto atravessa (webc.colide falso nas peças sem colisor)
      grupo.userData.webc = { colisoesDoUnity: colisoresSolidos > 0, versao: 1, ...(partida ? { partida } : {}) };
      if (!colisoresSolidos) grupo.traverse((o) => { if (o.userData.webc && o.userData.webc.colide === false && !o.userData.webc.soColisao) delete o.userData.webc.colide; });
      return { grupo, colocados, faltaram: [...faltaram], fisica: { colisores: colisoresSolidos, soColisao, corpos: corposFeitos, pegaveis: pegaveisFeitos }, texturas: { lidas: texturasLidas, previas: texturasPrevia } };
    },
  };
})();
