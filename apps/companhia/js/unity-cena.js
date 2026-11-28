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
 * O que não vem: terrenos (Terrain), luzes assadas (lightmaps), sondas, scripts, partículas, sons e animações da cena.
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
    for (const d of documentos(texto)) {
      if (d.classe === 4 || d.classe === 224) {
        if (d.despojado) { const pi = ref(campo(d.corpo, "m_PrefabInstance") || campo(d.corpo, "m_PrefabInternal")); if (pi) despojados.set(d.id, pi.id); continue; }
        transforms.set(d.id, {
          id: d.id, objeto: (ref(campo(d.corpo, "m_GameObject")) || {}).id, pai: (ref(campo(d.corpo, "m_Father")) || {}).id || "0",
          pos: vetor(campo(d.corpo, "m_LocalPosition"), ["x", "y", "z"], [0, 0, 0]), rot: vetor(campo(d.corpo, "m_LocalRotation"), ["x", "y", "z", "w"], [0, 0, 0, 1]),
          esc: vetor(campo(d.corpo, "m_LocalScale"), ["x", "y", "z"], [1, 1, 1]),
        });
      } else if (d.classe === 1 && !d.despojado) objetos.set(d.id, { nome: campo(d.corpo, "m_Name") || "", ativo: campo(d.corpo, "m_IsActive") !== "0" });
      else if (d.classe === 33 && !d.despojado) { const go = ref(campo(d.corpo, "m_GameObject")), m = ref(campo(d.corpo, "m_Mesh")); if (go && m) malhaDe.set(go.id, m); }
      else if ((d.classe === 23 || d.classe === 137) && !d.despojado) {
        const go = ref(campo(d.corpo, "m_GameObject")), lista = [];
        const bloco = /m_Materials:\s*\r?\n((?:\s*-\s*\{[^}]*\}\s*\r?\n?)+)/.exec(d.corpo);
        if (bloco) for (const x of bloco[1].matchAll(/\{[^}]*\}/g)) { const r = ref(x[0]); if (r && r.guid) lista.push(r.guid); }
        if (go) materiaisDe.set(go.id, lista);
      } else if (d.classe === 1001) {
        const fonte = ref(campo(d.corpo, "m_SourcePrefab") || campo(d.corpo, "m_ParentPrefab"));
        const pai = (ref(campo(d.corpo, "m_TransformParent")) || {}).id || "0";
        // as mudanças: [{alvo, caminho, valor}]
        const mudancas = [];
        for (const m of d.corpo.matchAll(/-\s*target:\s*(\{[^}]*\})\s*\r?\n\s*propertyPath:[ \t]*(\S+)\s*\r?\n\s*value:[ \t]*(.*)/g)) mudancas.push({ alvo: (ref(m[1]) || {}).id, caminho: m[2], valor: m[3].trim() });
        instancias.set(d.id, { id: d.id, fonte: fonte && fonte.guid, pai, mudancas });
      }
    }
    return { transforms, objetos, malhaDe, materiaisDe, instancias, despojados, T };
  }

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
      /** O material de um .mat (cor e textura), ou null. */
      const material = async (guid) => {
        if (materiais.has(guid)) return materiais.get(guid);
        let m = null;
        const caminho = guids.get(guid);
        if (caminho && /\.mat$/i.test(caminho) && C.avatar) {
          try {
            const mat = C.avatar.lerMat(await arquivos.get(caminho).text());
            m = new T.MeshStandardMaterial({ name: mat.nome || caminho.split("/").pop(), roughness: 0.85 });
            const cor = mat.cores._Color || mat.cores._BaseColor;
            if (cor) m.color.setRGB(Math.min(1, cor[0]), Math.min(1, cor[1]), Math.min(1, cor[2]), T.SRGBColorSpace);
            const tx = C.texturas.doMaterialUnity(mat.texturas, (g) => guids.has(g) && /\.(png|jpe?g|webp|tga|psd|bmp)$/i.test(guids.get(g)));
            if (tx.cor) {
              const img = guids.get(tx.cor), blob = arquivos.get(img), tela = document.createElement("canvas");
              if (/\.(tga|psd)$/i.test(img)) { const d = new Uint8Array(await blob.arrayBuffer()), dd = /\.psd$/i.test(img) ? C.avatar.lerPSD(d) : C.avatar.lerTGA(d); tela.width = dd.width; tela.height = dd.height; tela.getContext("2d").putImageData(dd, 0, 0); }
              else { const bmp = await createImageBitmap(blob); tela.width = bmp.width; tela.height = bmp.height; tela.getContext("2d").drawImage(bmp, 0, 0); bmp.close(); }
              const t = new T.CanvasTexture(tela);
              t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping;
              m.map = t;
            }
          } catch (e) { m = null; }
        }
        materiais.set(guid, m);
        return m;
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
        // os objetos com malha
        for (const [go, malha] of c.malhaDe) {
          const obj = c.objetos.get(go);
          if (obj && !obj.ativo) continue;
          const tr = [...c.transforms.values()].find((t) => t.objeto === go);
          if (!tr) continue;
          const m = matrizDe(tr.id);
          const mats = await Promise.all((c.materiaisDe.get(go) || []).map(material));
          let peca = null;
          if (malha.guid === GUID_PRONTO && PRONTAS[malha.id]) {
            peca = new T.Mesh(formaPronta(PRONTAS[malha.id]), mats.find(Boolean) || new T.MeshStandardMaterial({ color: 0xcfd3dc, roughness: 0.9 }));
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
          destino.add(g);
          colocados++;
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
      return { grupo, colocados, faltaram: [...faltaram] };
    },
  };
})();
