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
      if (/^(data|blob):/i.test(url)) return url;
      let limpo = url;
      try { limpo = decodeURIComponent(url); } catch (e) { /* fica como veio */ }
      limpo = limpo.replace(/^.*?:\/\/[^/]+\//, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/[?#].*$/, "");
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

  /** .blend → cena do three.js, pelo leitor próprio. */
  async function cenaDoBlend(blob, arquivos, avisos) {
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
  async function carregar(arquivos, principal, avisos) {
    const T = window.THREE, V = window.CompanhiaVRM;
    const tipo = ext(principal), blob = arquivos.get(principal);
    if (tipo === "blend") return cenaDoBlend(blob, arquivos, avisos);
    const g = gerenteDoPacote(arquivos, principal);
    const malhaDe = (geo) => { if (!geo.attributes.normal) geo.computeVertexNormals(); return new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.85, vertexColors: !!geo.attributes.color })); };
    let objeto;
    try {
      if (tipo === "glb" || tipo === "gltf") {
        const carregador = new V.GLTFLoader(g.gerente), draco = new V.DRACOLoader(g.gerente);
        draco.setDecoderPath(new URL("vendor/draco/", location.href).href);
        carregador.setDRACOLoader(draco);
        carregador.setMeshoptDecoder(V.MeshoptDecoder);
        try { objeto = (await carregador.loadAsync(g.url(principal))).scene; }
        catch (e) { throw new Error(/KTX|basis/i.test(e.message) ? "Esse cenário usa texturas KTX2/Basis, que ainda não abrem aqui. Exporte com texturas PNG/JPEG." : "Não consegui abrir o modelo: " + e.message); }
        finally { draco.dispose(); }
      } else if (tipo === "fbx") objeto = new V.FBXLoader(g.gerente).parse(await blob.arrayBuffer(), "");
      else if (tipo === "obj") {
        const carregador = new V.OBJLoader(g.gerente), textoObj = await blob.text();
        const mtl = (textoObj.match(/^mtllib\s+(.+)$/m) || [])[1], nomeMtl = mtl && [...arquivos.keys()].find((n) => base(n).toLowerCase() === base(mtl.trim()).toLowerCase());
        if (nomeMtl) { const materiais = new V.MTLLoader(g.gerente).parse(await arquivos.get(nomeMtl).text(), ""); materiais.preload(); carregador.setMaterials(materiais); }
        objeto = carregador.parse(textoObj);
      } else if (tipo === "dae") objeto = new V.ColladaLoader(g.gerente).parse(await blob.text(), "").scene;
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
      if (o.isCamera || o.isLight || o.isLine || o.isPoints || o.isSkeletonHelper) { tirar.push(o); return; }
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes.position) { tirar.push(o); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      o.material = Array.isArray(o.material) ? o.material.map(padrao) : padrao(o.material);
      triangulos += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
    for (const o of tirar) if (o.parent) o.parent.remove(o);
    objeto.animations = [];
    return Math.round(triangulos);
  }

  C.conversor = {
    FORMATOS, MODELO,
    ACEITAR: FORMATOS.map((f) => "." + f[0]).join(",") + ",.mtl,.bin,.zip,.unitypackage,.png,.jpg,.jpeg,.webp,.bmp,.vrcw",
    /** Os modelos de um pacote, do mais provável para o menos (o .blend na frente; depois o maior). */
    modelos(arquivos) {
      const ordem = FORMATOS.map((f) => f[0]);
      return [...arquivos.keys()].filter((n) => MODELO.test(n)).sort((a, b) => (ext(a) === "blend" ? 0 : 1) - (ext(b) === "blend" ? 0 : 1) || arquivos.get(b).size - arquivos.get(a).size || ordem.indexOf(ext(a)) - ordem.indexOf(ext(b)));
    },
    /**
     * Converte um modelo para .glb. arquivos: Map caminho → Blob (o modelo e o que vier ao lado dele).
     * Devolve {glb: Blob, triangulos, avisos: [texto], como: texto}.
     */
    async paraGLB(arquivos, principal, { aoProgresso = () => {} } = {}) {
      await C.prepararVRM();
      const T = window.THREE, V = window.CompanhiaVRM, avisos = [];
      const tipo = ext(principal), blob = arquivos.get(principal);
      if (!blob) throw new Error("Não achei o arquivo " + principal + ".");
      // um .glb sozinho já está no formato certo
      if (tipo === "glb" && arquivos.size === 1) return { glb: blob, triangulos: null, avisos, como: "já estava em .glb" };
      if (tipo === "blend") {
        let pronto = null;
        try { pronto = await blendPelaPonte(principal, blob, arquivos, aoProgresso); }
        catch (e) { avisos.push("O Blender do aparelho não conseguiu (" + e.message + "); usei o leitor próprio."); }
        if (pronto) return { glb: pronto, triangulos: null, avisos, como: "pelo Blender do aparelho" };
      }
      aoProgresso(0.2, "Lendo o modelo...");
      const objeto = await carregar(arquivos, principal, avisos);
      const triangulos = preparar(objeto);
      if (!triangulos) throw new Error("Esse arquivo não tem nenhuma malha (só câmeras, luzes ou pontos).");
      aoProgresso(0.7, "Gravando o .glb...");
      const cena = new T.Scene();
      cena.add(objeto);
      cena.updateMatrixWorld(true);
      const saida = await new V.GLTFExporter().parseAsync(cena, { binary: true, onlyVisible: true, maxTextureSize: 4096 });
      objeto.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); } } });
      return { glb: new Blob([saida], { type: "model/gltf-binary" }), triangulos, avisos, como: tipo === "blend" ? "pelo leitor próprio de .blend" : "de ." + tipo };
    },
  };
})();
