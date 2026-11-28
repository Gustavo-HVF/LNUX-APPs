/*
 * Companhia — conversor de cenários: qualquer um destes formatos vira um .glb (glTF binário, com as texturas
 * dentro), que é o formato em que a Companhia guarda e abre os mapas (e o que a sala manda para quem entra):
 *
 *   .blend  Blender. Com a ponte e o Blender instalado no aparelho, é o próprio Blender que exporta (sai igual ao
 *           que ele mostra, com os modificadores aplicados). Sem ele, entra o leitor próprio (js/blend.js): malhas,
 *           posições, UV, materiais simples e texturas embutidas, de arquivos do Blender 2.6 ao 5.x.
 *   .fbx  .obj (+.mtl)  .dae (Collada)  .stl  .ply  .3ds  .3mf  .usdz   pelos carregadores do three.js
 *   .gltf (+.bin e texturas soltas) e .glb                              juntados num arquivo só
 *   .zip e .unitypackage                                                abertos antes (js/mundo.js: C.mapas.preparar)
 *
 * Tudo acontece no aparelho. O resultado pode ser usado como cenário na hora e salvo como arquivo .glb.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const FORMATOS = [["blend", "Blender"], ["glb", "glTF binário"], ["gltf", "glTF"], ["fbx", "FBX"], ["obj", "Wavefront OBJ"], ["dae", "Collada"], ["stl", "STL"],
    ["ply", "PLY"], ["3ds", "3D Studio"], ["3mf", "3MF"], ["usdz", "USDZ"]];
  const MODELO = new RegExp("\\.(" + FORMATOS.map((f) => f[0]).join("|") + ")$", "i");
  const IMAGEM = /\.(png|jpe?g|webp|bmp|gif|tga)$/i;
  const ext = (n) => (String(n).match(/\.([^./\\]+)$/) || [, ""])[1].toLowerCase();
  const base = (n) => String(n).replace(/\\/g, "/").split("/").pop();

  /** Um gerente de carregamento que acha as texturas e os .bin dentro do pacote, pelo caminho ou só pelo nome. */
  function gerenteDoPacote(arquivos, principal) {
    const T = window.THREE, urls = [], gerente = new T.LoadingManager();
    const nomes = [...arquivos.keys()], porNome = new Map(nomes.map((n) => [base(n).toLowerCase(), n]));
    const pasta = principal.includes("/") ? principal.replace(/[^/]+$/, "") : "";
    const estado = { carregados: 0, total: 0 };
    gerente.onProgress = (_, carregados, total) => { estado.carregados = carregados; estado.total = total; };
    gerente.setURLModifier((url) => {
      // os endereços que este gerente criou (blob:) e os dados embutidos passam direto; um "blob:.../textura.png" é um
      // arquivo vizinho do modelo (o carregador montou o endereço em cima do endereço do próprio modelo)
      if (/^data:/i.test(url) || urls.includes(url) || /^blob:[^/]*\/\/[^/]+\/[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(url)) return url; // dados embutidos e objetos de verdade (as texturas de dentro de um .glb)
      let limpo = url;
      try { limpo = decodeURIComponent(url); } catch (e) { /* fica como veio */ }
      limpo = limpo.replace(/^blob:/i, "").replace(/^.*?:\/\/[^/]+\//, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/[?#].*$/, "");
      const achado = arquivos.has(pasta + limpo) ? pasta + limpo : arquivos.has(limpo) ? limpo : porNome.get(base(limpo).toLowerCase());
      if (!achado) return PIXEL; // textura que não veio: um ponto branco, sem erro
      const u = URL.createObjectURL(arquivos.get(achado));
      urls.push(u);
      return u;
    });
    /** Espera as texturas pedidas pelos carregadores terminarem de chegar. */
    const esperar = async () => { for (let i = 0; i < 150 && estado.carregados < estado.total; i++) await LNUX.esperar(100); await LNUX.esperar(30); };
    return { gerente, esperar, url: (nome) => { const u = URL.createObjectURL(arquivos.get(nome)); urls.push(u); return u; }, soltar: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 20000) };
  }

  /** Blob de imagem → textura do three.js (num canvas, para o exportador de glTF conseguir gravar). */
  async function texturaDe(blob) {
    const T = window.THREE;
    const bmp = await createImageBitmap(blob);
    const tela = document.createElement("canvas");
    tela.width = bmp.width;
    tela.height = bmp.height;
    tela.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    const tex = new T.CanvasTexture(tela);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }

  /**
   * .blend → cena do three.js, pelo leitor próprio. personagem: as malhas presas num esqueleto (o da armadura ou o
   * refeito pelos grupos de vértices, js/blend-personagem.js) viram malhas com pele, com as formas (shape keys).
   */
  async function cenaDoBlend(blob, arquivos, avisos, { personagem = false } = {}) {
    const T = window.THREE, V = window.CompanhiaVRM;
    let dados = new Uint8Array(await blob.arrayBuffer());
    const como = C.blend.compactacao(dados);
    if (como === "gzip") dados = new Uint8Array(await new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    else if (como === "zstd") { const z = new V.ZSTDDecoder(); await z.init(); dados = z.decode(dados); }
    const b = C.blend.ler(dados);
    if (!b.objetos.length) throw new Error("Esse .blend não tem nenhuma malha que eu consiga ler (ele pode ter só curvas, textos ou objetos escondidos).");
    // imagens: as embutidas no arquivo, ou as que vieram ao lado (pelo nome)
    const porNome = new Map([...arquivos.keys()].map((n) => [base(n).toLowerCase(), n]));
    const texturas = [];
    let faltaram = 0;
    for (const im of b.imagens) {
      let fonte = im.dados ? new Blob([im.dados]) : null;
      if (!fonte) { const n = porNome.get(base(im.caminho).toLowerCase()); if (n) fonte = arquivos.get(n); }
      let tex = null;
      if (fonte) { try { tex = await texturaDe(fonte); } catch (e) { tex = null; } }
      texturas.push(tex);
    }
    const materiais = b.materiais.map((m) => {
      const mat = new T.MeshStandardMaterial({ name: m.nome, roughness: Math.min(1, Math.max(0, m.rugosidade)), metalness: Math.min(1, Math.max(0, m.metalico)) });
      mat.color.setRGB(m.cor[0], m.cor[1], m.cor[2]);
      if (m.cor[3] < 0.999) { mat.transparent = true; mat.opacity = m.cor[3]; }
      if (m.recorte) mat.alphaTest = 0.5; // um shader transparente misturado pelo alfa da imagem: recorta (cabelo, cílios, rendas)
      if (m.imagem !== null) { if (texturas[m.imagem]) mat.map = texturas[m.imagem]; else faltaram++; }
      return mat;
    });
    if (faltaram) avisos.push(`${faltaram} textura(s) do .blend não vieram junto: abra também as imagens (ou embuta no Blender: Arquivo › Dados externos › Empacotar recursos).`);
    const padrao = new T.MeshStandardMaterial({ name: "Sem material", color: 0xb8bcc8, roughness: 0.85 });
    const geometrias = b.malhas.map((m) => {
      let g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(m.posicoes, 3));
      if (m.uvs) g.setAttribute("uv", new T.BufferAttribute(m.uvs, 2));
      try { g = V.toCreasedNormals(g, 0.7); } catch (e) { g.computeVertexNormals(); } // liso onde as faces quase não dobram
      for (const gr of m.grupos) g.addGroup(gr.inicio, gr.quantidade, gr.material);
      return g;
    });
    const raiz = new T.Group();
    raiz.name = "Cena do Blender";
    if (personagem) {
      montarPersonagem(b, raiz, materiais, padrao, avisos);
      raiz.rotation.x = -Math.PI / 2;
      raiz.updateMatrixWorld(true);
      raiz.traverse((o) => { if (o.isSkinnedMesh) o.bind(o.skeleton); }); // (sem a matriz: assim ele calcula as inversas dos ossos) // a pose de repouso, já de pé (Y para cima)
      return raiz;
    }
    for (const o of b.objetos) {
      const m = b.malhas[o.malha], g = geometrias[o.malha];
      const lista = [];
      for (const gr of m.grupos) lista[gr.material] = materiais[m.materiais[gr.material]] || padrao;
      for (let i = 0; i < lista.length; i++) if (!lista[i]) lista[i] = padrao;
      const malha = new T.Mesh(g, m.grupos.length === 1 ? lista[m.grupos[0].material] : lista);
      if (m.grupos.length === 1) g.clearGroups();
      malha.name = o.nome;
      malha.applyMatrix4(new T.Matrix4().fromArray(o.matriz));
      raiz.add(malha);
    }
    raiz.rotation.x = -Math.PI / 2; // no Blender o Z aponta para cima; aqui, o Y
    raiz.updateMatrixWorld(true);
    avisos.push("Convertido pelo leitor próprio (sem o Blender): modificadores, curvas, textos e instâncias de coleção não entram. Com o Blender instalado no aparelho e a ponte ligada, a conversão é completa.");
    return raiz;
  }

  /**
   * As malhas de uma personagem do .blend, com pele: as posições já no mundo (do Blender), os ossos (THREE.Bone) do
   * esqueleto de cada objeto, os pesos (até 4 por vértice), as normais lisas (pela média nos vértices de origem, sem
   * costura nas bordas da UV) e as formas (shape keys) como alvos de morph. Objetos sem esqueleto entram parados.
   */
  function montarPersonagem(b, raiz, materiais, padrao, avisos) {
    const T = window.THREE;
    const esqueletos = new Map(); // chave → {ossos: [Bone], dados}
    let semEsqueleto = 0, comoFoi = "";
    b.objetos.forEach((o, io) => {
      const m = b.malhas[o.malha], esq = C.esqueletoDoBlend ? C.esqueletoDoBlend(b, o, m) : null;
      const n = m.indices.length, M = o.matriz;
      // posições no mundo (por canto) e a normal lisa de cada vértice de origem
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = m.posicoes[i * 3], y = m.posicoes[i * 3 + 1], z = m.posicoes[i * 3 + 2];
        pos[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; pos[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; pos[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      const normalV = new Float32Array(m.nVertices * 3);
      for (let t = 0; t < n; t += 3) {
        const a = t * 3, bb = (t + 1) * 3, c = (t + 2) * 3;
        const ux = pos[bb] - pos[a], uy = pos[bb + 1] - pos[a + 1], uz = pos[bb + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (let k = 0; k < 3; k++) { const v = m.indices[t + k]; normalV[v * 3] += nx; normalV[v * 3 + 1] += ny; normalV[v * 3 + 2] += nz; }
      }
      const normais = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = m.indices[i], x = normalV[v * 3], y = normalV[v * 3 + 1], z = normalV[v * 3 + 2], l = Math.hypot(x, y, z) || 1;
        normais[i * 3] = x / l; normais[i * 3 + 1] = y / l; normais[i * 3 + 2] = z / l;
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos, 3));
      g.setAttribute("normal", new T.BufferAttribute(normais, 3));
      if (m.uvs) g.setAttribute("uv", new T.BufferAttribute(m.uvs, 2));
      for (const gr of m.grupos) g.addGroup(gr.inicio, gr.quantidade, gr.material);
      // as formas (shape keys): a diferença de cada vértice, no mundo
      if (m.formas && m.formas.length) {
        g.morphAttributes.position = m.formas.map((f) => {
          const d = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            const v = m.indices[i], x = f.posicoes[v * 3], y = f.posicoes[v * 3 + 1], z = f.posicoes[v * 3 + 2];
            d[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12] - pos[i * 3]; d[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13] - pos[i * 3 + 1]; d[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14] - pos[i * 3 + 2];
          }
          return new T.BufferAttribute(d, 3);
        });
        g.morphTargetsRelative = true;
      }
      const lista = [];
      for (const gr of m.grupos) lista[gr.material] = materiais[m.materiais[gr.material]] || padrao;
      for (let i = 0; i < lista.length; i++) if (!lista[i]) lista[i] = padrao;
      const material = m.grupos.length === 1 ? lista[m.grupos[0].material] : lista;
      if (m.grupos.length === 1) g.clearGroups();
      let malha;
      if (esq) {
        const chave = o.armadura >= 0 ? "a" + o.armadura : "o" + io;
        if (!esqueletos.has(chave)) {
          const ossos = esq.ossos.map((x) => { const bone = new T.Bone(); bone.name = x.nome; return bone; });
          esq.ossos.forEach((x, i) => {
            const pai = x.pai >= 0 ? esq.ossos[x.pai] : null;
            ossos[i].position.set(x.pos[0] - (pai ? pai.pos[0] : 0), x.pos[1] - (pai ? pai.pos[1] : 0), x.pos[2] - (pai ? pai.pos[2] : 0));
            if (x.pai >= 0) ossos[x.pai].add(ossos[i]); else raiz.add(ossos[i]);
          });
          esqueletos.set(chave, { ossos, nomes: new Map(esq.ossos.map((x, i) => [x.nome, i])) });
        }
        const e = esqueletos.get(chave), mapa = esq.ossos.map((x) => e.nomes.get(x.nome) ?? 0);
        const idx = new Uint16Array(n * 4), pesos = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { const v = m.indices[i]; for (let k = 0; k < 4; k++) { idx[i * 4 + k] = mapa[esq.ossoDe[v * 4 + k]] || 0; pesos[i * 4 + k] = esq.pesoDe[v * 4 + k]; } }
        g.setAttribute("skinIndex", new T.BufferAttribute(idx, 4));
        g.setAttribute("skinWeight", new T.BufferAttribute(pesos, 4));
        malha = new T.SkinnedMesh(g, material);
        malha.skeleton = new T.Skeleton(e.ossos);
        comoFoi = esq.como;
        if (esq.semPeso) avisos.push(`${esq.semPeso} vértice(s) de "${o.nome}" sem peso foram presos no osso mais perto.`);
      } else { malha = new T.Mesh(g, material); semEsqueleto++; }
      if (g.morphAttributes.position) { malha.morphTargetDictionary = {}; m.formas.forEach((f, i) => { malha.morphTargetDictionary[f.nome] = i; }); malha.morphTargetInfluences = m.formas.map(() => 0); }
      malha.name = o.nome;
      raiz.add(malha);
    });
    if (comoFoi === "grupos") avisos.push("O .blend não tem a armadura: o esqueleto foi refeito pelos grupos de vértices (os pesos que ficaram na malha). Confira as juntas na personagem; se algo dobrar estranho, salve o .blend com a armadura.");
    if (semEsqueleto) avisos.push(`${semEsqueleto} objeto(s) sem esqueleto nem grupos de vértices entraram parados.`);
  }

  /** .blend → .glb pelo Blender do aparelho (pela ponte). Devolve o Blob do .glb, ou null se não há Blender. */
  async function blendPelaPonte(nome, blob, arquivos, aoProgresso) {
    const ponte = LNUX.ponte;
    if (!ponte.tem("blender")) return null;
    const estado = await ponte.pedir("GET", "blender").catch(() => null);
    if (!estado || !estado.disponivel) return null;
    const lote = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try {
      aoProgresso(0.15, "Mandando o arquivo para o Blender do aparelho...");
      const enviado = await ponte.pedir("PUT", `blender/${lote}/${encodeURIComponent(base(nome))}`, { corpo: blob, tipo: "application/octet-stream" });
      for (const [n, b] of arquivos) if (IMAGEM.test(n)) await ponte.pedir("PUT", `blender/${lote}/${encodeURIComponent(base(n))}`, { corpo: b, tipo: "application/octet-stream" });
      aoProgresso(0.4, "O Blender está convertendo (pode levar um pouco)...");
      const r = await ponte.pedir("POST", "blender/" + lote, { json: { principal: enviado.nome } });
      aoProgresso(0.85, "Pegando o resultado...");
      return await ponte.ler(r.saida, "blob");
    } finally { ponte.pedir("DELETE", "blender/" + lote).catch(() => {}); }
  }

  /** Abre um modelo de qualquer formato aceito como cena do three.js (menos .blend pela ponte, que já sai em .glb). */
  async function carregar(arquivos, principal, avisos, opcoes = {}) {
    const T = window.THREE, V = window.CompanhiaVRM;
    const tipo = ext(principal), blob = arquivos.get(principal);
    if (tipo === "blend") return cenaDoBlend(blob, arquivos, avisos, opcoes);
    const g = gerenteDoPacote(arquivos, principal);
    const malhaDe = (geo) => { if (!geo.attributes.normal) geo.computeVertexNormals(); return new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.85, vertexColors: !!geo.attributes.color })); };
    let objeto;
    try {
      if (tipo === "glb" || tipo === "gltf") {
        const carregador = C.carregadorGLTF(g.gerente); // com o specular/glossiness (vira o material padrão no .glb)
        try { const gltf = await carregador.loadAsync(g.url(principal)); objeto = gltf.scene; objeto.animations = gltf.animations || []; } // as animações do mapa vão junto
        catch (e) { throw new Error("Não consegui abrir o modelo: " + e.message); }
        finally { carregador.soltar(); }
      } else if (tipo === "fbx") objeto = new V.FBXLoader(g.gerente).parse(await blob.arrayBuffer(), "");
      else if (tipo === "obj") {
        const carregador = new V.OBJLoader(g.gerente), textoObj = await blob.text();
        const mtl = (textoObj.match(/^mtllib\s+(.+)$/m) || [])[1], nomeMtl = mtl && [...arquivos.keys()].find((n) => base(n).toLowerCase() === base(mtl.trim()).toLowerCase());
        if (nomeMtl) { const materiais = new V.MTLLoader(g.gerente).parse(await arquivos.get(nomeMtl).text(), ""); materiais.preload(); carregador.setMaterials(materiais); }
        objeto = carregador.parse(textoObj);
      } else if (tipo === "dae") { const dae = new V.ColladaLoader(g.gerente).parse(await blob.text(), ""); objeto = dae.scene; objeto.animations = dae.animations || []; }
      else if (tipo === "stl") objeto = malhaDe(new V.STLLoader().parse(await blob.arrayBuffer()));
      else if (tipo === "ply") objeto = malhaDe(new V.PLYLoader().parse(await blob.arrayBuffer()));
      else if (tipo === "3ds") objeto = new V.TDSLoader(g.gerente).parse(await blob.arrayBuffer(), "");
      else if (tipo === "3mf") objeto = new V.ThreeMFLoader(g.gerente).parse(await blob.arrayBuffer());
      else if (tipo === "usdz") objeto = new V.USDZLoader(g.gerente).parse(await blob.arrayBuffer());
      else throw new Error("Não sei converter arquivos ." + tipo + ".");
      await g.esperar();
    } catch (e) {
      throw e instanceof Error && /^(Esse|Não)/.test(e.message) ? e : new Error(`Não consegui ler esse .${tipo}: ${(e && e.message) || e}`);
    } finally { g.soltar(); }
    return objeto;
  }

  /**
   * Os materiais sem textura ganham a dela: pelo material do Unity (.mat, achado pela ficha .meta do modelo ou pelo
   * nome) ou pelo nome da imagem que mais combina (js/texturas.js). TGA e PSD também abrem. Devolve quantas ligou.
   */
  async function ligarTexturas(objeto, arquivos, principal, tipo, avisos) {
    const T = window.THREE, A = C.avatar;
    const imagens = [...arquivos.keys()].filter((n) => /\.(png|jpe?g|webp|bmp|gif|tga|psd)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n));
    if (!imagens.length || !C.texturas) return 0;
    const metas = arquivos.metas || new Map(), guids = arquivos.guids || new Map();
    const meta = A && metas.has(principal) ? A.lerMetaDoModelo(metas.get(principal)) : { materiais: {} };
    const liso = (n) => base(n).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const matsPorNome = new Map([...arquivos.keys()].filter((n) => /\.mat$/i.test(n)).map((n) => [liso(n), n]));
    const lidos = new Map();
    const lerMat = async (caminho) => { if (!lidos.has(caminho)) { try { lidos.set(caminho, A.lerMat(await arquivos.get(caminho).text())); } catch (e) { lidos.set(caminho, null); } } return lidos.get(caminho); };
    const texturas = new Map(), usadas = new Set(), virar = tipo !== "glb" && tipo !== "gltf";
    const abrir = async (caminho) => {
      if (texturas.has(caminho)) return texturas.get(caminho);
      let tex = null;
      try {
        const blob = arquivos.get(caminho), tela = document.createElement("canvas");
        if (/\.(tga|psd)$/i.test(caminho) && A) {
          const d = new Uint8Array(await blob.arrayBuffer()), img = /\.psd$/i.test(caminho) ? A.lerPSD(d) : A.lerTGA(d);
          tela.width = img.width; tela.height = img.height; tela.getContext("2d").putImageData(img, 0, 0);
        } else { const bmp = await createImageBitmap(blob); tela.width = bmp.width; tela.height = bmp.height; tela.getContext("2d").drawImage(bmp, 0, 0); bmp.close(); }
        tex = new T.CanvasTexture(tela);
        tex.colorSpace = T.SRGBColorSpace;
        tex.wrapS = tex.wrapT = T.RepeatWrapping;
        tex.flipY = virar;
        tex.name = base(caminho);
      } catch (e) { tex = null; }
      texturas.set(caminho, tex);
      return tex;
    };
    let porMat = 0, porNome = 0;
    const feitos = new Set();
    const malhas = [];
    objeto.traverse((o) => { if (o.isMesh) malhas.push(o); });
    for (const o of malhas) {
      for (const m of [].concat(o.material || [])) {
        if (!m || feitos.has(m) || (m.map && m.map.image && (m.map.image.width || 0) > 1)) continue;
        feitos.add(m);
        let caminho = null;
        // 1. o .mat do Unity (pela ficha do modelo ou pelo nome)
        const g = meta.materiais[m.name], doMeta = g && guids.has(g) ? guids.get(g) : null;
        const camMat = doMeta && /\.mat$/i.test(doMeta) ? doMeta : matsPorNome.get(liso(m.name || ""));
        if (camMat && A) {
          const mat = await lerMat(camMat);
          const c = mat && C.texturas.doMaterialUnity(mat.texturas, (x) => guids.has(x) && imagens.includes(guids.get(x)));
          if (c && c.cor) { caminho = guids.get(c.cor); porMat++; }
        }
        // 2. pelo nome
        if (!caminho) { caminho = C.texturas.melhorPara(m.name || "", imagens, { usadas }); if (caminho) porNome++; }
        if (!caminho) continue;
        const tex = await abrir(caminho);
        if (!tex) continue;
        usadas.add(caminho);
        m.map = tex;
        if (m.color) m.color.set(0xffffff);
        m.needsUpdate = true;
      }
    }
    if (porMat) avisos.push(`${porMat} material(is) ganharam a textura pelos materiais do Unity (.mat).`);
    if (porNome) avisos.push(`${porNome} material(is) ganharam a textura pelo nome da imagem (o modelo não dizia qual era).`);
    return porMat + porNome;
  }

  /** Deixa a cena pronta para virar glTF: só malhas, com materiais que o glTF entende. Devolve o número de triângulos. */
  function preparar(objeto) {
    const T = window.THREE, tirar = [], trocados = new Map();
    let triangulos = 0;
    const padrao = (m) => {
      if (!m) return new T.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.85 });
      if (m.isMeshStandardMaterial || m.isMeshBasicMaterial) return m;
      if (trocados.has(m)) return trocados.get(m);
      const n = new T.MeshStandardMaterial({ name: m.name, color: m.color ? m.color.clone() : new T.Color(0xffffff), map: m.map || null, normalMap: m.normalMap || null,
        emissive: m.emissive ? m.emissive.clone() : new T.Color(0), emissiveMap: m.emissiveMap || null, transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest || 0,
        side: m.side, vertexColors: !!m.vertexColors, roughness: m.shininess !== undefined ? Math.min(1, Math.max(0.2, 1 - m.shininess / 120)) : 0.85, metalness: 0 });
      if (n.map) n.map.colorSpace = T.SRGBColorSpace;
      trocados.set(m, n);
      return n;
    };
    objeto.traverse((o) => {
      if (o.isCamera || (o.isLight && !o.isPointLight && !o.isSpotLight) || o.isLine || o.isPoints || o.isSkeletonHelper) { tirar.push(o); return; } // as lâmpadas ficam (js/luzes.js acende)
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes.position) { tirar.push(o); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      o.material = Array.isArray(o.material) ? o.material.map(padrao) : padrao(o.material);
      triangulos += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
    for (const o of tirar) if (o.parent) o.parent.remove(o);
    // as animações (moinhos, água, portas...) ficam, menos as trilhas de peças que saíram (câmeras, linhas)
    const nomes = new Set();
    objeto.traverse((o) => { if (o.name) nomes.add(o.name); nomes.add(o.uuid); });
    objeto.animations = (objeto.animations || []).map((c) => {
      const trilhas = c.tracks.filter((t) => { try { return nomes.has(T.PropertyBinding.parseTrackName(t.name).nodeName); } catch (e) { return false; } });
      return trilhas.length ? new T.AnimationClip(c.name, c.duration, trilhas) : null;
    }).filter(Boolean);
    return Math.round(triangulos);
  }

  // ── as texturas: o tamanho, JPEG onde não há transparência e (se a pessoa quiser) KTX2 ──────────────────
  // texturas: {maior: 512 | 1024 | 2048 | 4096 (px no lado maior), formato: "auto" (JPEG/PNG) | "ktx2" | "original" (como antes: PNG, até 4096)}
  const PREF_TEXTURAS = "companhia.texturas", TEXTURAS_PADRAO = { maior: 1024, formato: "auto" };
  function texturasEscolhidas(t) {
    let p = null;
    try { p = JSON.parse(LNUX.preferencia.ler(PREF_TEXTURAS, "null")); } catch (e) { p = null; }
    const r = { ...TEXTURAS_PADRAO, ...(p || {}), ...(t || {}) };
    if (![512, 1024, 2048, 4096].includes(+r.maior)) r.maior = 1024;
    if (!["auto", "ktx2", "original"].includes(r.formato)) r.formato = "auto";
    r.maior = +r.maior;
    return r;
  }
  const CHAVES_TEXTURA = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "alphaMap", "lightMap", "bumpMap", "specularMap"];
  /**
   * Prepara as texturas antes de gravar: reduz as maiores que "maior" e marca as que não precisam de transparência para
   * irem em JPEG (bem menor que PNG para fotos de madeira, pedra, tecido...). PNG fica onde a transparência é usada
   * (recorte de folhas, grades, vidro). Devolve {total, jpeg, reduzidas}.
   */
  function otimizarTexturas(raiz, { maior = 1024, formato = "auto" } = {}) {
    const usos = new Map(); // textura → precisa de transparência?
    raiz.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material || [])) {
        if (!m) continue;
        for (const k of CHAVES_TEXTURA) {
          const t = m[k];
          if (!t || !t.isTexture) continue;
          const alfa = (k === "map" || k === "alphaMap") && (m.transparent || m.alphaTest > 0);
          usos.set(t, (usos.get(t) || false) || alfa);
        }
      }
    });
    let jpeg = 0, reduzidas = 0;
    const amostra = document.createElement("canvas");
    amostra.width = amostra.height = 64;
    const ctxA = amostra.getContext("2d", { willReadFrequently: true });
    for (const [t, querAlfa] of usos) {
      if (t.isCompressedTexture || t.isDataTexture) continue; // o exportador descomprime e reduz (maxTextureSize)
      const img = t.image;
      const w = img && (img.naturalWidth || img.videoWidth || img.width), h = img && (img.naturalHeight || img.videoHeight || img.height);
      if (!w || !h || typeof img.getContext !== "function" && !(img instanceof ImageBitmap) && !(typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement)) continue;
      if (formato !== "original" && Math.max(w, h) > maior) {
        const k = maior / Math.max(w, h), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        t.image = c;
        t.needsUpdate = true;
        reduzidas++;
      }
      if (formato === "original") continue;
      // numa amostra (64 × 64, do meio da imagem, sem reduzir): tem pixels transparentes? e é "foto" (os vizinhos
      // variam: madeira, pedra, tecido — bem menor em JPEG) ou "desenho" (áreas lisas: logotipo, letreiro, cor
      // lisa — menor e sem borrão em PNG)?
      let temAlfa = false, foto = false;
      try {
        const iw = t.image.width, ih = t.image.height, sx = Math.max(0, (iw - 64) / 2), sy = Math.max(0, (ih - 64) / 2);
        ctxA.clearRect(0, 0, 64, 64);
        ctxA.drawImage(t.image, sx, sy, Math.min(64, iw), Math.min(64, ih), 0, 0, Math.min(64, iw), Math.min(64, ih));
        const d = ctxA.getImageData(0, 0, Math.min(64, iw), Math.min(64, ih)).data, larg = Math.min(64, iw);
        let pares = 0, variam = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 250) temAlfa = true;
          if ((i / 4) % larg === larg - 1) continue;
          const dif = Math.abs(d[i] - d[i + 4]) + Math.abs(d[i + 1] - d[i + 5]) + Math.abs(d[i + 2] - d[i + 6]);
          pares++;
          if (dif > 6) variam++;
        }
        foto = pares > 0 && variam / pares > 0.25;
      } catch (e) { temAlfa = true; }
      if (!(querAlfa && temAlfa) && foto) { t.userData.mimeType = "image/jpeg"; jpeg++; }
    }
    return { total: usos.size, jpeg, reduzidas };
  }
  /** Grava a cena em .glb com as escolhas de textura (e, se for KTX2, regrava as imagens). Devolve {glb, info}. */
  async function gravarGLB(cena, texturas, { animacoes = [], aoProgresso = () => {} } = {}) {
    const V = window.CompanhiaVRM, t = texturasEscolhidas(texturas);
    const info = otimizarTexturas(cena, t);
    const exp = new V.GLTFExporter();
    if (V.TextureUtils && exp.setTextureUtils) exp.setTextureUtils(V.TextureUtils); // texturas KTX2 de um mapa que já veio assim
    let saida = await exp.parseAsync(cena, { binary: true, onlyVisible: true, maxTextureSize: t.formato === "original" ? 4096 : t.maior, animations: animacoes });
    if (t.formato === "ktx2" && C.ktx2) {
      const r = await C.ktx2.glbComKTX2(saida, { aoProgresso });
      saida = r.buffer;
      info.ktx2 = { convertidas: r.convertidas, antes: r.antes, depois: r.depois };
    }
    info.escolha = t;
    return { glb: new Blob([saida], { type: "model/gltf-binary" }), info };
  }
  /** O aviso do que foi feito com as texturas (para o resumo da conversão). */
  function avisoTexturas(info) {
    if (!info || !info.total) return null;
    const t = info.escolha, partes = [];
    if (t.formato === "original") return null;
    if (info.reduzidas) partes.push(C.t("{n} reduzida(s) para {px} px", { n: info.reduzidas, px: t.maior }));
    if (info.ktx2 && info.ktx2.convertidas) partes.push(C.t("{n} em KTX2 ({antes} → {depois})", { n: info.ktx2.convertidas, antes: LNUX.bytes(info.ktx2.antes), depois: LNUX.bytes(info.ktx2.depois) }));
    else if (info.jpeg) partes.push(C.t("{n} em JPEG (sem transparência)", { n: info.jpeg }));
    return partes.length ? C.t("Texturas: {lista}.", { lista: partes.join(", ") }) : null;
  }
  /** A escolha das texturas na tela (tamanho e formato), guardada para as próximas conversões. */
  function escolhaTexturas() {
    const { el } = LNUX, t = texturasEscolhidas();
    const gravar = () => { try { LNUX.preferencia.gravar(PREF_TEXTURAS, JSON.stringify({ maior: +tam.value, formato: fmt.value })); } catch (e) { /* sem armazenamento */ } };
    const tam = el("select", { class: "lnux-selecao", "aria-label": C.t("Tamanho máximo das texturas"), "data-texturas": "maior", onchange: gravar },
      [[512, "512 px (leve, celular)"], [1024, "1024 px (recomendado)"], [2048, "2048 px (mais nítido)"], [4096, "4096 px (máximo)"]].map(([v, r]) => el("option", { value: v, selected: v === t.maior }, C.t(r))));
    const fmt = el("select", { class: "lnux-selecao", "aria-label": C.t("Formato das texturas"), "data-texturas": "formato", onchange: gravar },
      [["auto", "JPEG/PNG automático (recomendado)"], ["ktx2", "KTX2 (comprimida na placa de vídeo; mais lento para converter)"], ["original", "Como vieram (PNG, sem reduzir)"]].map(([v, r]) => el("option", { value: v, selected: v === t.formato }, C.t(r))));
    return el("details", { class: "escolha-texturas" }, el("summary", {}, C.t("Texturas do cenário convertido")),
      el("div", { class: "ajustes", style: { marginTop: "8px" } },
        el("label", { class: "lnux-campo" }, el("span", {}, C.t("Tamanho máximo")), tam),
        el("label", { class: "lnux-campo" }, el("span", {}, C.t("Formato")), fmt),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, C.t("JPEG onde não há transparência e PNG onde há (folhas, grades, vidro). KTX2 ocupa menos memória de vídeo e o arquivo fica menor; baixa um codificador de uns 3 MB na primeira vez."))));
  }

  C.conversor = {
    texturasEscolhidas, escolhaTexturas, otimizarTexturas,
    FORMATOS, MODELO, ligarTexturas,
    ACEITAR: FORMATOS.map((f) => "." + f[0]).join(",") + ",.mtl,.bin,.zip,.unitypackage,.png,.jpg,.jpeg,.webp,.bmp,.vrcw",
    /** Os modelos de um pacote, do mais provável para o menos (o .blend na frente; depois o maior). */
    modelos(arquivos) {
      const ordem = FORMATOS.map((f) => f[0]);
      return [...arquivos.keys()].filter((n) => MODELO.test(n)).sort((a, b) => (ext(a) === "blend" ? 0 : 1) - (ext(b) === "blend" ? 0 : 1) || arquivos.get(b).size - arquivos.get(a).size || ordem.indexOf(ext(a)) - ordem.indexOf(ext(b)));
    },
    /**
     * Junta vários modelos num .glb só: a cena do Unity montada (opcoes.cena: o caminho do .unity, js/unity-cena.js) ou
     * todos os modelos lado a lado (opcoes.modelos). Devolve {glb, triangulos, avisos, como, colocados}.
     */
    async juntarGLB(arquivos, { cena = null, modelos = null, aoProgresso = () => {}, texturas = null } = {}) {
      await C.prepararVRM();
      const T = window.THREE, V = window.CompanhiaVRM, avisos = [];
      const carregarModelo = async (caminho) => {
        const tipo = ext(caminho), aviso = [];
        const o = await carregar(arquivos, caminho, aviso);
        if (tipo !== "blend" && tipo !== "glb" && tipo !== "gltf") await ligarTexturas(o, arquivos, caminho, tipo, aviso);
        return o;
      };
      const raiz = new T.Group();
      raiz.name = "Cenário";
      let colocados = 0, como = "", fisica = null;
      if (cena) {
        aoProgresso(0.1, "Montando a cena do Unity...");
        const r = await C.unityCena.montar(arquivos, cena, { carregarModelo, maiorTextura: Math.max(1024, texturasEscolhidas(texturas).maior), aoProgresso: (f) => aoProgresso(0.1 + f * 0.6, "Montando a cena do Unity...") });
        raiz.add(r.grupo);
        colocados = r.colocados;
        if (r.faltaram.length) avisos.push(`${r.faltaram.length} modelo(s) da cena não abriram: ${r.faltaram.slice(0, 5).join(", ")}${r.faltaram.length > 5 ? "..." : ""}.`);
        if (!colocados) throw new Error("A cena do Unity não tem nenhum modelo que eu consiga pôr no lugar (só terreno, luzes ou peças de fora do pacote).");
        como = "montando a cena do Unity";
        fisica = r.fisica || null;
        if (r.texturas && r.texturas.previas) avisos.push(`${r.texturas.previas} textura(s) estão num formato do Unity que não consigo ler (comprimidas com "crunch" ou BC7): entraram as miniaturas que o pacote traz, com as cores certas mas pouca resolução.`);
        if (fisica && (fisica.colisores || fisica.corpos)) avisos.push(`Física do Unity: ${fisica.colisores} colisor(es) sólido(s) (o resto, como plantas e enfeites, dá para atravessar), ${fisica.corpos} objeto(s) com física, ${fisica.pegaveis} de pegar.`);
      } else {
        // lado a lado, numa fileira, com um espaço entre eles
        let x = 0;
        for (let i = 0; i < modelos.length; i++) {
          aoProgresso(0.1 + 0.6 * i / modelos.length, `Abrindo ${base(modelos[i])}...`);
          let o;
          try { o = await carregarModelo(modelos[i]); } catch (e) { avisos.push(`${base(modelos[i])} não abriu: ${e.message}`); continue; }
          const g = new T.Group();
          g.name = base(modelos[i]).replace(/\.[^.]+$/, "");
          g.add(o);
          if (ext(modelos[i]) === "fbx") g.scale.setScalar((o.userData.unitScaleFactor || 1) / 100);
          g.updateMatrixWorld(true);
          const caixa = new T.Box3().setFromObject(g), tam = caixa.getSize(new T.Vector3());
          if (caixa.isEmpty()) continue;
          g.position.set(x - caixa.min.x, -caixa.min.y, -(caixa.min.z + caixa.max.z) / 2);
          x += tam.x + 0.5;
          raiz.add(g);
          colocados++;
        }
        if (!colocados) throw new Error("Nenhum dos modelos abriu.");
        como = `com ${colocados} modelos lado a lado`;
      }
      const triangulos = preparar(raiz);
      aoProgresso(0.8, "Gravando o .glb...");
      const cenaT = new T.Scene();
      cenaT.add(raiz);
      cenaT.updateMatrixWorld(true);
      const { glb, info } = await gravarGLB(cenaT, texturas, { aoProgresso: (f, t) => aoProgresso(0.8 + f * 0.19, t) });
      const av = avisoTexturas(info);
      if (av) avisos.push(av);
      void V;
      return { glb, triangulos, avisos, como, colocados, fisica, texturas: info };
    },
    /**
     * Converte um modelo para .glb. arquivos: Map caminho → Blob (o modelo e o que vier ao lado dele).
     * Devolve {glb: Blob, triangulos, avisos: [texto], como: texto}.
     */
    async paraGLB(arquivos, principal, { aoProgresso = () => {}, personagem = false, texturas = null } = {}) {
      await C.prepararVRM();
      const T = window.THREE, V = window.CompanhiaVRM, avisos = [];
      const tipo = ext(principal), blob = arquivos.get(principal);
      if (!blob) throw new Error("Não achei o arquivo " + principal + ".");
      // um .glb sozinho já está no formato certo
      if (tipo === "glb" && arquivos.size === 1) {
        // material specular/glossiness (exportações antigas do Sketchfab): escreve a alternativa padrão, que todo programa abre
        const padrao = C.glbSemEspecular(await blob.arrayBuffer());
        if (padrao) avisos.push("Os materiais specular/glossiness (exportações antigas do Sketchfab) ganharam a versão padrão: as texturas aparecem em qualquer programa.");
        let pronto = padrao || null;
        // KTX2 escolhido: as imagens de dentro do .glb são regravadas (o resto do arquivo fica como estava)
        if (!personagem && texturasEscolhidas(texturas).formato === "ktx2" && C.ktx2) {
          const r = await C.ktx2.glbComKTX2(pronto || (await blob.arrayBuffer()), { aoProgresso });
          if (r.convertidas) { pronto = r.buffer; avisos.push(avisoTexturas({ total: r.convertidas, escolha: texturasEscolhidas(texturas), ktx2: r })); }
        }
        return { glb: pronto ? new Blob([pronto], { type: "model/gltf-binary" }) : blob, triangulos: null, avisos, como: "já estava em .glb" };
      }
      if (tipo === "blend" && !personagem) { // (uma personagem passa pelo leitor próprio: ele refaz o esqueleto e mantém os pesos)
        let pronto = null;
        try { pronto = await blendPelaPonte(principal, blob, arquivos, aoProgresso); }
        catch (e) { avisos.push("O Blender do aparelho não conseguiu (" + e.message + "); usei o leitor próprio."); }
        if (pronto && texturasEscolhidas(texturas).formato === "ktx2" && C.ktx2) {
          const r = await C.ktx2.glbComKTX2(await pronto.arrayBuffer(), { aoProgresso });
          if (r.convertidas) { pronto = new Blob([r.buffer], { type: "model/gltf-binary" }); avisos.push(avisoTexturas({ total: r.convertidas, escolha: texturasEscolhidas(texturas), ktx2: r })); }
        }
        if (pronto) return { glb: pronto, triangulos: null, avisos, como: "pelo Blender do aparelho" };
      }
      aoProgresso(0.2, "Lendo o modelo...");
      const objeto = await carregar(arquivos, principal, avisos, { personagem });
      if (tipo !== "blend" && tipo !== "glb" && tipo !== "gltf") await ligarTexturas(objeto, arquivos, principal, tipo, avisos);
      const triangulos = preparar(objeto);
      if (!triangulos) throw new Error("Esse arquivo não tem nenhuma malha (só câmeras, luzes ou pontos).");
      aoProgresso(0.7, "Gravando o .glb...");
      const cena = new T.Scene();
      cena.add(objeto);
      cena.updateMatrixWorld(true);
      // (uma personagem segue para o conversor de VRM: as texturas ficam como estão)
      const { glb, info } = await gravarGLB(cena, personagem ? { formato: "original" } : texturas, { animacoes: objeto.animations || [], aoProgresso: (f, t) => aoProgresso(0.7 + f * 0.29, t) });
      if (personagem) return { glb, triangulos, avisos, como: "pelo leitor próprio de .blend" };
      const av = avisoTexturas(info);
      if (av) avisos.push(av);
      const nAnim = (objeto.animations || []).length;
      if (nAnim) avisos.push(nAnim === 1 ? C.t("Com 1 animação: ela toca no jogo.") : C.t("Com {n} animações: elas tocam no jogo.", { n: nAnim }));
      objeto.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); } } });
      return { glb, triangulos, avisos, como: tipo === "blend" ? "pelo leitor próprio de .blend" : "de ." + tipo, texturas: info };
    },
  };
})();
