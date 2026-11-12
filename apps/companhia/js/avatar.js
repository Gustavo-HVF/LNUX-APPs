/*
 * Companhia — avatares de outros formatos viram personagens VRM.
 *
 * O que entra: o avatar de um .unitypackage (como os do VRChat e os vendidos no BOOTH: um .fbx com o esqueleto, as
 * texturas e os materiais .mat do Unity), um .fbx solto (com as texturas ao lado, num ZIP) ou um .glb/.gltf com
 * esqueleto de pessoa. O que sai: um .vrm (VRM 1.0) montado no aparelho, que a Companhia guarda e abre como
 * qualquer personagem VRoid — com roupas, captura de movimento, pacotes de movimento, andar e salas.
 *
 * O que a conversão faz:
 *   - acha os ossos de pessoa: pela ficha que o Unity guarda ao lado do .fbx (.meta, "humanDescription") ou, sem
 *     ela, pelos nomes dos ossos (mixamo, Unity, VRoid, Blender, Biped...);
 *   - põe o avatar de pé, olhando para a frente, com os pés no chão e na medida certa (os .fbx vêm em
 *     centímetros), sem escalas escondidas no esqueleto, e deixa os braços e as pernas na pose em T;
 *   - liga os materiais do Unity (.mat) às texturas do pacote (cor, textura principal, recorte/transparência,
 *     dois lados, brilho próprio) e grava no estilo de desenho das personagens VRoid (MToon). As texturas PNG e
 *     JPEG entram como vieram; TGA, PSD, BMP e WebP são convertidas;
 *   - transforma as formas do rosto em expressões do VRM: boca (vrc.v_aa, あ, A...), piscar, alegre, brava,
 *     triste, surpresa... e guarda só as formas usadas (um avatar pode ter centenas);
 *   - dá balanço a cabelo, saia, rabo, orelhas e fitas (os ossos soltos com esses nomes).
 *
 * O que não vem: os efeitos dos shaders do Unity (lilToon, Poiyomi: contornos, brilhos, matcaps), as físicas do
 * VRChat (PhysBones, que ficam no .prefab, não no modelo), animações, menus e objetos ligados/desligados pelo
 * prefab (dá para esconder peças em Personagem › Roupas). Tudo acontece no aparelho; nada é enviado.
 *
 * Atenção à licença: um pacote do Unity não diz o que o autor deixa fazer. O .vrm convertido fica marcado como
 * "não redistribuir" e a Companhia avisa antes de mandar a personagem para outras pessoas.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const ext = (n) => (String(n).match(/\.([^./\\]+)$/) || [, ""])[1].toLowerCase();
  const base = (n) => String(n).replace(/\\/g, "/").split("/").pop();
  const semExt = (n) => base(n).replace(/\.[^.]+$/, "");
  /** Só letras e números (e kana/kanji), para comparar nomes escritos de jeitos diferentes. */
  const liso = (n) => semExt(n).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]/g, "");
  const MODELO = /\.(fbx|glb|gltf)$/i;
  const IMAGEM = /\.(png|jpe?g|webp|bmp|gif|tga|psd)$/i;
  const OBRIGATORIOS = ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"];
  const NOME_PT = { hips: "quadril", spine: "coluna", head: "cabeça", UpperArm: "braço", LowerArm: "antebraço", Hand: "mão", UpperLeg: "coxa", LowerLeg: "canela", Foot: "pé" };
  const nomeDoOsso = (n) => NOME_PT[n] || (NOME_PT[n.replace(/^(left|right)/, "")] + (n.startsWith("left") ? " esquerdo" : " direito")).replace(/a (esquerd|direit)o$/, "a $1a");

  // ── As fichas do Unity (YAML), lidas só no que interessa ────────────

  const semAspas = (s) => {
    s = String(s).trim();
    if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  };
  /** O .meta de um modelo: os ossos de pessoa que o Unity reconheceu e os materiais ligados a ele. */
  function lerMetaDoModelo(texto) {
    const humano = [], materiais = {};
    for (const m of texto.matchAll(/-\s*boneName:[ \t]*(.*)\r?\n\s*humanName:[ \t]*(.*)/g)) if (m[1].trim() && m[2].trim()) humano.push({ osso: semAspas(m[1]), humano: semAspas(m[2]) });
    for (const m of texto.matchAll(/type:\s*UnityEngine:Material\s*\r?\n\s*assembly:[^\n]*\n\s*name:[ \t]*(.*)\r?\n\s*second:\s*\{[^}]*guid:\s*([0-9a-f]{32})/g)) materiais[semAspas(m[1])] = m[2];
    return { humano, materiais, pessoa: /animationType:\s*3\b/.test(texto) };
  }
  /** Um material do Unity (.mat): texturas (pelo guid), números, cores e o jeito de desenhar. */
  function lerMat(texto) {
    const texturas = {}, numeros = {}, cores = {};
    const guid = (s) => (s.match(/guid:\s*([0-9a-f]{32})/) || [])[1];
    for (const m of texto.matchAll(/-\s*(_\w+):\s*\r?\n\s*m_Texture:\s*\{([^}]*)\}/g)) if (guid(m[2])) texturas[m[1]] = guid(m[2]);
    for (const m of texto.matchAll(/name:\s*(_\w+)\s*\r?\n\s*second:\s*\r?\n\s*m_Texture:\s*\{([^}]*)\}/g)) if (guid(m[2])) texturas[m[1]] = guid(m[2]); // formato antigo
    for (const m of texto.matchAll(/-\s*(_\w+):\s*(-?\d[\d.eE+-]*)\s*$/gm)) numeros[m[1]] = +m[2];
    for (const m of texto.matchAll(/name:\s*(_\w+)\s*\r?\n\s*second:\s*(-?\d[\d.eE+-]*)\s*$/gm)) numeros[m[1]] = +m[2];
    const COR = "\\{r:\\s*([-\\d.eE+]+),\\s*g:\\s*([-\\d.eE+]+),\\s*b:\\s*([-\\d.eE+]+),\\s*a:\\s*([-\\d.eE+]+)\\}";
    for (const m of texto.matchAll(new RegExp("-\\s*(_\\w+):\\s*" + COR, "g"))) cores[m[1]] = [+m[2], +m[3], +m[4], +m[5]];
    for (const m of texto.matchAll(new RegExp("name:\\s*(_\\w+)\\s*\\r?\\n\\s*second:\\s*" + COR, "g"))) cores[m[1]] = [+m[2], +m[3], +m[4], +m[5]];
    return { nome: semAspas((texto.match(/^\s*m_Name:[ \t]*(.*)$/m) || [, ""])[1]), texturas, numeros, cores,
      tipo: (texto.match(/RenderType:\s*(\w+)/) || [])[1] || "", fila: +((texto.match(/m_CustomRenderQueue:\s*(-?\d+)/) || [])[1] || -1),
      palavras: texto.match(/_ALPHATEST_ON|_ALPHABLEND_ON|_ALPHAPREMULTIPLY_ON|_EMISSION\b/g) || [] };
  }
  /** OPAQUE (sem transparência), MASK (recortado) ou BLEND (transparente), como o glTF chama. */
  function modoAlfa(mat) {
    const n = mat.numeros;
    if (/Cutout/i.test(mat.tipo)) return "MASK";
    if (/Transparent|Fade/i.test(mat.tipo) || mat.fila >= 3000) return "BLEND";
    if (mat.fila >= 2450 || mat.palavras.includes("_ALPHATEST_ON")) return "MASK";
    if (mat.palavras.includes("_ALPHABLEND_ON") || mat.palavras.includes("_ALPHAPREMULTIPLY_ON")) return "BLEND";
    if (mat.tipo) return "OPAQUE";
    const modo = n._TransparentMode !== undefined ? n._TransparentMode : n._Mode !== undefined ? n._Mode : n._BlendMode;
    return modo === 1 ? "MASK" : modo >= 2 ? "BLEND" : "OPAQUE";
  }

  // ── Imagens que o navegador não abre sozinho ────────────────────────

  /** TGA (cores de verdade ou cinza, com ou sem compactação RLE) → ImageData. */
  function lerTGA(d) {
    const tipo = d[2], larg = d[12] | (d[13] << 8), alt = d[14] | (d[15] << 8), bits = d[16], bytes = bits >> 3;
    if (d[1] || ![2, 3, 10, 11].includes(tipo) || ![8, 24, 32].includes(bits) || !larg || !alt) throw new Error("TGA de um tipo que não sei ler");
    const n = larg * alt, px = new Uint8ClampedArray(n * 4);
    let p = 18 + d[0], temAlfa = false;
    const por = (i, o) => {
      if (bytes === 1) { px[i] = px[i + 1] = px[i + 2] = d[o]; px[i + 3] = 255; return; }
      px[i] = d[o + 2]; px[i + 1] = d[o + 1]; px[i + 2] = d[o]; px[i + 3] = bytes === 4 ? d[o + 3] : 255;
      if (bytes === 4 && d[o + 3]) temAlfa = true;
    };
    if (tipo < 8) for (let i = 0; i < n; i++, p += bytes) por(i * 4, p);
    else for (let i = 0; i < n;) {
      const c = d[p++], q = (c & 127) + 1;
      if (c & 128) { for (let k = 0; k < q && i < n; k++, i++) por(i * 4, p); p += bytes; } else for (let k = 0; k < q && i < n; k++, i++, p += bytes) por(i * 4, p);
    }
    if (bytes === 4 && !temAlfa) for (let i = 3; i < px.length; i += 4) px[i] = 255; // canal alfa vazio: é uma imagem sem transparência
    if (!(d[17] & 0x20)) { // começa por baixo (o comum): vira
      const linha = larg * 4, tmp = new Uint8ClampedArray(linha);
      for (let y = 0; y < alt >> 1; y++) { const a = y * linha, b = (alt - 1 - y) * linha; tmp.set(px.subarray(a, a + linha)); px.copyWithin(a, b, b + linha); px.set(tmp, b); }
    }
    return new ImageData(px, larg, alt);
  }
  /** PSD (Photoshop, 8 bits, RGB): a imagem juntada que o arquivo guarda no fim → ImageData. */
  function lerPSD(d) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (v.getUint32(0) !== 0x38425053 || v.getUint16(4) !== 1) throw new Error("não é um PSD comum");
    const canais = v.getUint16(12), alt = v.getUint32(14), larg = v.getUint32(18);
    if (v.getUint16(22) !== 8 || v.getUint16(24) !== 3 || canais < 3) throw new Error("PSD que não é RGB de 8 bits");
    let p = 26;
    for (let k = 0; k < 3; k++) p += 4 + v.getUint32(p); // modo de cor, recursos e camadas: pulados
    const compactado = v.getUint16(p);
    p += 2;
    const n = larg * alt, px = new Uint8ClampedArray(n * 4).fill(255), usar = Math.min(canais, 4);
    if (compactado === 0) { for (let c = 0; c < usar; c++) for (let i = 0; i < n; i++) px[i * 4 + c] = d[p + c * n + i]; }
    else if (compactado === 1) {
      let q = p + canais * alt * 2;
      for (let c = 0; c < canais; c++) for (let y = 0; y < alt; y++) {
        const fim = q + v.getUint16(p + (c * alt + y) * 2);
        if (c < usar) {
          const linha = y * larg;
          let x = 0;
          while (q < fim) {
            const b = d[q++];
            if (b < 128) for (let k = 0; k <= b; k++, q++, x++) { if (x < larg) px[(linha + x) * 4 + c] = d[q]; }
            else if (b > 128) { const valor = d[q++]; for (let k = 0; k < 257 - b; k++, x++) if (x < larg) px[(linha + x) * 4 + c] = valor; }
          }
        }
        q = fim;
      }
    } else throw new Error("PSD compactado de um jeito que não sei ler");
    return new ImageData(px, larg, alt);
  }
  const telaDe = (dados) => { const t = document.createElement("canvas"); t.width = dados.width; t.height = dados.height; t.getContext("2d").putImageData(dados, 0, 0); return t; };
  /**
   * Um arquivo de imagem → {direto: {dados, mime}} (PNG e JPEG entram no .vrm como vieram, sem regravar) ou
   * {tela} (os outros formatos, desenhados num canvas para o exportador gravar em PNG). null se não der para ler.
   */
  async function abrirImagem(blob, nome) {
    const d = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return { direto: { blob, mime: "image/png" } };
    if (d[0] === 0xff && d[1] === 0xd8) return { direto: { blob, mime: "image/jpeg" } };
    const tudo = async () => new Uint8Array(await blob.arrayBuffer());
    try {
      if (d[0] === 0x38 && d[1] === 0x42 && d[2] === 0x50 && d[3] === 0x53) return { tela: telaDe(lerPSD(await tudo())) };
      if (ext(nome) === "tga") return { tela: telaDe(lerTGA(await tudo())) };
      const bmp = await createImageBitmap(blob), t = document.createElement("canvas");
      t.width = bmp.width; t.height = bmp.height;
      t.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
      return { tela: t };
    } catch (e) {
      // sem nome (uma textura embutida no .fbx) o TGA não tem marca no começo: tenta como TGA por último
      try { return { tela: telaDe(lerTGA(await tudo())) }; } catch (e2) { return null; }
    }
  }

  // ── Expressões: das formas do rosto (blendshapes) para os nomes do VRM ─────

  // Cada expressão: padrões em ordem de preferência, testados no nome em minúsculas.
  const fim = (s) => new RegExp("(^|[._\\s-])(" + s + ")$");
  const EXPRESSOES = {
    aa: [/vrc\.v_aa$/, fim("v_aa|viseme_aa|mth_a|mouth_a|kuchi_a"), /^(a|aa|あ|口_あ)$/, /fcl_mth_a$/, /^(jawopen|mouthopen|mouth_open)$/],
    ih: [/vrc\.v_ih$/, fim("v_ih|viseme_ih?|mth_i|mouth_i|kuchi_i"), /^(i|ih|い|口_い)$/, /fcl_mth_i$/],
    ou: [/vrc\.v_ou$/, fim("v_ou|viseme_ou?|viseme_u|mth_u|mouth_u|kuchi_u"), /^(u|ou|う|口_う)$/, /fcl_mth_u$/],
    ee: [/vrc\.v_e$/, fim("v_ee?|viseme_ee?|mth_e|mouth_e|kuchi_e"), /^(e|ee|え|口_え)$/, /fcl_mth_e$/],
    oh: [/vrc\.v_oh$/, fim("v_oh?|viseme_oh?|mth_o|mouth_o|kuchi_o"), /^(o|oh|お|口_お)$/, /fcl_mth_o$/],
    blink: [/vrc\.blink$/, /^(blink|まばたき|目閉じ|eyes?_?closed?|eye_?close|close_?eyes?|blink_both)$/, /fcl_eye_close$/, fim("blink|eye_close")],
    blinkLeft: [/vrc\.blink_left$/, /^(ウィンク|ウィンク左|eyeblinkleft|eyeblink_l|wink_?l(eft)?|blink_?l(eft)?|eye_close_l)$/, /fcl_eye_close_l$/, fim("blink_l(eft)?|wink_l(eft)?")],
    blinkRight: [/vrc\.blink_right$/, /^(ウィンク右|ウィンク２|ウィンク2|eyeblinkright|eyeblink_r|wink_?r(ight)?|blink_?r(ight)?|eye_close_r)$/, /fcl_eye_close_r$/, fim("blink_r(ight)?|wink_r(ight)?")],
    happy: [/fcl_all_joy$/, /^(joy|happy|smile|笑い|笑顔|にこり|にっこり|喜び)$/, fim("joy|happy|smile"), /^(mouthsmile|mouth_smile)$/],
    angry: [/fcl_all_angry$/, /^(angry|anger|怒り|怒)$/, fim("angry|anger")],
    sad: [/fcl_all_sorrow$/, /^(sad|sorrow|悲しい|悲しみ|困る|泣き)$/, fim("sad|sorrow")],
    relaxed: [/fcl_all_fun$/, /^(relaxed|fun|なごみ|穏やか)$/, fim("relaxed|fun")],
    surprised: [/fcl_all_surprised$/, /^(surprised?|びっくり|驚き|おどろき)$/, fim("surprised?")],
  };
  /** Outras formas que valem como atalhos de expressão (rubor, lágrima, língua...). */
  const EXTRAS = /照れ|頬染|blush|cheek|涙|tear|ハート|heart|星目|star|舌|べー|tongue|じと目|ジト目|jito|smug|ドヤ|はぅ|> ?<|shy|ぷく|puff|pout|汗|sweat|青ざめ|pale|ω|cat_?mouth|キス|kiss|てへ|tehe/i;

  /** nomes: as formas de todas as malhas. Devolve {expressao: nomeDaForma} e a lista dos atalhos extras. */
  function acharExpressoes(nomes) {
    const lista = [...new Set(nomes)], achadas = {};
    for (const [expr, padroes] of Object.entries(EXPRESSOES)) {
      for (const p of padroes) {
        const n = lista.find((x) => p.test(x.toLowerCase().trim()));
        if (n) { achadas[expr] = n; break; }
      }
    }
    const usadas = new Set(Object.values(achadas));
    const extras = lista.filter((n) => !usadas.has(n) && EXTRAS.test(n) && !/vrc\.|^v_|viseme/i.test(n)).slice(0, 12);
    return { achadas, extras };
  }

  // ── Esqueleto ────────────────────────────────────────────────────────

  /** "Left Thumb Proximal" (Unity) → "leftThumbMetacarpal" (VRM 1.0); "UpperChest" → "upperChest". */
  function ossoDoUnity(h) {
    const n = String(h).replace(/\s+/g, "");
    const dedo = n.match(/^(Left|Right)(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/);
    if (dedo) return dedo[1].toLowerCase() + dedo[2] + (dedo[2] === "Thumb" ? { Proximal: "Metacarpal", Intermediate: "Proximal", Distal: "Distal" }[dedo[3]] : dedo[3]);
    return n ? n[0].toLowerCase() + n.slice(1) : "";
  }
  const BALANCO = [
    [/hair|kami|髪|ahoge|アホ毛|bang|前髪|ponytail|twintail|ツインテ|braid|三つ編|おさげ|もみあげ|side_?hair|back_?hair/i, { stiffness: 1.1, gravityPower: 0.06, dragForce: 0.5 }, "cabelo"],
    [/skirt|スカート|dress|ワンピ|coat_?tail|cape|マント|cloak|裾|frill|フリル/i, { stiffness: 0.7, gravityPower: 0.12, dragForce: 0.5 }, "saia"],
    [/tail|しっぽ|尻尾|シッポ/i, { stiffness: 1.3, gravityPower: 0.05, dragForce: 0.45 }, "rabo"],
    [/(^|[^a-zA-Z])ears?([^a-z]|$)|[a-z]Ears?([^a-z]|$)|耳|みみ|mimi([^a-z]|$)/, { stiffness: 2.2, gravityPower: 0, dragForce: 0.4 }, "orelhas"],
    [/ribbon|リボン|necktie|(^|[^a-z])tie([^a-z]|$)|ネクタイ|scarf|マフラー|sleeve|袖|ひも|紐|tassel|strap|hood|フード|wing|羽/i, { stiffness: 1, gravityPower: 0.1, dragForce: 0.5 }, "fitas"],
    [/breast|bust|胸|おっぱい|oppai|boob/i, { stiffness: 3, gravityPower: 0, dragForce: 0.35 }, "busto"],
  ];
  // nomes que nunca balançam: ajudantes, pontas e partes do corpo (um "LeftForeArm" não é uma orelha, "ear")
  const SEM_BALANCO = /twist|roll|(^|[_.\s-])ik([_.\s-]|$)|helper|collider|col_|eye|目|brow|lid|lash|tooth|teeth|tongue|舌|jaw|finger|thumb|index|pinky|toe|(fore|upper|lower)?arm|leg|hand|foot|shoulder|spine|chest|hips|pelvis|neck|knee|elbow|wrist|ankle/i;

  /** Junta os vértices iguais de uma malha sem índices (como as do .fbx), levando as formas junto. */
  function indexar(g) {
    const T = window.THREE;
    if (g.index || !g.attributes.position) return g;
    const nomes = Object.keys(g.attributes), atributos = nomes.map((n) => g.attributes[n]), n = g.attributes.position.count;
    if (atributos.some((a) => a.isInterleavedBufferAttribute)) return g;
    const visto = new Map(), indice = new Uint32Array(n), fonte = [];
    for (let i = 0; i < n; i++) {
      let chave = "";
      for (const a of atributos) { const d = a.array, t = a.itemSize, o = i * t; for (let k = 0; k < t; k++) chave += d[o + k] + ","; }
      let j = visto.get(chave);
      if (j === undefined) { j = fonte.length; visto.set(chave, j); fonte.push(i); }
      indice[i] = j;
    }
    const copiar = (a) => {
      const t = a.itemSize, d = new a.array.constructor(fonte.length * t);
      for (let j = 0; j < fonte.length; j++) { const o = fonte[j] * t; for (let k = 0; k < t; k++) d[j * t + k] = a.array[o + k]; }
      const novo = new T.BufferAttribute(d, t, a.normalized);
      novo.name = a.name;
      return novo;
    };
    const novo = new T.BufferGeometry();
    nomes.forEach((nome, i) => novo.setAttribute(nome, copiar(atributos[i])));
    for (const [nome, lista] of Object.entries(g.morphAttributes || {})) novo.morphAttributes[nome] = lista.map(copiar);
    novo.morphTargetsRelative = g.morphTargetsRelative;
    novo.setIndex(new T.BufferAttribute(fonte.length > 65535 ? indice : new Uint16Array(indice), 1));
    for (const gr of g.groups) novo.addGroup(gr.start, gr.count, gr.materialIndex);
    novo.name = g.name;
    return novo;
  }

  // ── O arquivo .glb por dentro ────────────────────────────────────────

  function abrirGLB(buffer) {
    const v = new DataView(buffer), tj = v.getUint32(12, true), ib = 20 + tj;
    return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, tj))), bin: new Uint8Array(buffer, ib + 8, v.getUint32(ib, true)) };
  }
  /** Monta o .glb de novo. trocas: Map(índice da bufferView → Blob ou Uint8Array com o conteúdo novo). */
  function fecharGLB(json, bin, trocas) {
    const partes = [];
    let pos = 0;
    const encher = () => { const s = (4 - (pos % 4)) % 4; if (s) { partes.push(new Uint8Array(s)); pos += s; } };
    json.bufferViews.forEach((bv, i) => {
      const dados = trocas.get(i) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      encher();
      bv.byteOffset = pos;
      bv.byteLength = dados.size !== undefined ? dados.size : dados.length;
      partes.push(dados);
      pos += bv.byteLength;
    });
    encher();
    json.buffers = [{ byteLength: pos }];
    const texto = new TextEncoder().encode(JSON.stringify(json)), sobra = (4 - (texto.length % 4)) % 4;
    const cab = new DataView(new ArrayBuffer(20)), cabBin = new DataView(new ArrayBuffer(8));
    cab.setUint32(0, 0x46546c67, true); cab.setUint32(4, 2, true); cab.setUint32(8, 20 + texto.length + sobra + 8 + pos, true);
    cab.setUint32(12, texto.length + sobra, true); cab.setUint32(16, 0x4e4f534a, true);
    cabBin.setUint32(0, pos, true); cabBin.setUint32(4, 0x004e4942, true);
    return new Blob([cab, texto, new Uint8Array(sobra).fill(0x20), cabBin, ...partes], { type: "model/gltf-binary" });
  }

  // ── A conversão ──────────────────────────────────────────────────────

  C.avatar = {
    MODELO,
    ACEITAR: ".unitypackage,.fbx,.glb",
    lerMat, lerMetaDoModelo, lerTGA, lerPSD, acharExpressoes, ossoDoUnity,

    /** O pacote tem cara de avatar (e não de cenário)? Um .vrm dentro, ou um modelo que o Unity marcou como pessoa. */
    pareceAvatar(arquivos) {
      const metas = arquivos.metas || new Map();
      return [...arquivos.keys()].some((n) => /\.vrm$/i.test(n) || (/\.fbx$/i.test(n) && metas.has(n) && lerMetaDoModelo(metas.get(n)).pessoa));
    },
    /** Os modelos do pacote que podem ser o avatar, do mais provável para o menos. */
    candidatos(arquivos) {
      const metas = arquivos.metas || new Map();
      const nota = (n) => (metas.has(n) && lerMetaDoModelo(metas.get(n)).pessoa ? 0 : 2) + (/anim|motion|pose|prop|weapon|item|accessor|effect|particle|collider/i.test(base(n)) ? 1 : 0);
      return [...arquivos.keys()].filter((n) => MODELO.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n)).sort((a, b) => nota(a) - nota(b) || arquivos.get(b).size - arquivos.get(a).size);
    },

    /**
     * Converte o modelo `principal` do pacote (Map caminho → Blob; de um .unitypackage vem com .metas e .guids)
     * num .vrm. Devolve {vrm: Blob, nome, resumo: {...}, avisos: [texto]}.
     */
    async paraVRM(arquivos, principal, { nome, aoProgresso = () => {} } = {}) {
      await C.prepararVRM();
      const T = window.THREE, V = window.CompanhiaVRM, avisos = [];
      const blob = arquivos.get(principal), tipo = ext(principal);
      if (!blob) throw new Error("Não achei o arquivo " + principal + ".");
      const metas = arquivos.metas || new Map(), guids = arquivos.guids || new Map();
      const meta = metas.has(principal) ? lerMetaDoModelo(metas.get(principal)) : { humano: [], materiais: {}, pessoa: false };
      nome = nome || semExt(principal);

      // 1. abrir o modelo
      aoProgresso(0.05, "Lendo o modelo...");
      const pedidos = new Map(), urls = [], porNome = new Map([...arquivos.keys()].map((n) => [base(n).toLowerCase(), n]));
      const gerente = new T.LoadingManager(), andamento = { carregados: 0, total: 0 };
      gerente.onProgress = (_, carregados, total) => { andamento.carregados = carregados; andamento.total = total; };
      const pontinho = new Blob([Uint8Array.from(atob(PIXEL.split(",")[1]), (c) => c.charCodeAt(0))], { type: "image/png" });
      gerente.setURLModifier((url) => {
        if (/^data:/i.test(url) || urls.includes(url) || /^blob:[^/]*\/\/[^/]+\/[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(url)) return url;
        let limpo = url;
        try { limpo = decodeURIComponent(url); } catch (e) { /* fica como veio */ }
        const achado = porNome.get(base(limpo.replace(/[?#].*$/, "")).toLowerCase());
        if (!achado) return PIXEL; // textura que não veio no pacote
        // o navegador não abre TGA nem PSD: o modelo recebe um pontinho no lugar, com um endereço só dele, e a
        // imagem de verdade é lida depois (abrirImagem), quando o material é refeito
        const u = URL.createObjectURL(/\.(png|jpe?g|webp|bmp|gif|bin)$/i.test(achado) ? arquivos.get(achado) : pontinho);
        urls.push(u);
        pedidos.set(u, achado);
        return u;
      });
      let objeto;
      try {
        if (tipo === "fbx") objeto = new V.FBXLoader(gerente).parse(await blob.arrayBuffer(), "");
        else if (tipo === "glb" || tipo === "gltf") {
          const carregador = new V.GLTFLoader(gerente), draco = new V.DRACOLoader();
          draco.setDecoderPath(new URL("vendor/draco/", location.href).href);
          carregador.setDRACOLoader(draco);
          carregador.setMeshoptDecoder(V.MeshoptDecoder);
          const u = URL.createObjectURL(blob);
          urls.push(u);
          try { objeto = (await carregador.loadAsync(u)).scene; } finally { draco.dispose(); }
        } else throw new Error("Não sei converter avatares ." + tipo + " (use .fbx, .glb ou o .unitypackage).");
      } catch (e) {
        throw /^Não sei/.test(e.message) ? e : new Error(`Não consegui ler o modelo ${base(principal)}: ${(e && e.message) || e}`);
      }
      for (let i = 0; i < 150 && andamento.carregados < andamento.total; i++) await LNUX.esperar(100); // as texturas embutidas terminam de chegar
      await LNUX.esperar(40);
      const ehFBX = tipo === "fbx";
      // o carregador de .fbx repete o osso usado por mais de uma malha (a cópia vira filha do primeiro, no mesmo lugar e
      // com o mesmo nome): fica um osso só, senão cada malha seguiria um esqueleto diferente
      if (ehFBX) {
        const mesmo = (b) => { let o = b; while (o.parent && o.parent.isBone && o.ID !== undefined && o.parent.ID === o.ID) o = o.parent; return o; };
        const copias = new Set();
        objeto.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.bones = o.skeleton.bones.map((b) => { const m = mesmo(b); if (m !== b) copias.add(b); return m; }); });
        for (const b of copias) { for (const f of [...b.children]) b.parent.add(f); b.parent.remove(b); }
      }
      objeto.updateMatrixWorld(true);

      // 2. malhas e ossos
      const malhas = [], comPele = [], ossos = [];
      objeto.traverse((o) => {
        if (o.isCamera || o.isLight) return;
        if (o.isMesh && o.geometry && o.geometry.attributes.position) { malhas.push(o); if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones.length) comPele.push(o); }
      });
      if (!comPele.length) throw new Error(`"${base(principal)}" não tem esqueleto (nenhuma malha presa em ossos), então não dá para virar personagem. Se é um cenário, abra em Movimento › Cenário.`);
      const ehOsso = new Set();
      for (const m of comPele) for (const b of m.skeleton.bones) ehOsso.add(b);
      objeto.traverse((o) => { if (o.isBone) ehOsso.add(o); });
      objeto.traverse((o) => { if (ehOsso.has(o)) ossos.push(o); });
      // nomes: únicos e não vazios (os índices do glTF são achados pelo nome depois de exportar)
      const usados = new Set();
      objeto.traverse((o) => {
        let n = o.name || (o.isMesh ? "Malha" : "No"), k = 2;
        while (usados.has(n)) n = `${o.name || "No"}_${k++}`;
        usados.add(n);
        o.name = n;
      });

      // 3. quais ossos são os de uma pessoa
      const original = (o) => (o.userData && o.userData.originalName) || o.name;
      const porNomeDeOsso = new Map();
      for (const o of ossos) { porNomeDeOsso.set(o.name, o); porNomeDeOsso.set(original(o), o); porNomeDeOsso.set(T.PropertyBinding.sanitizeNodeName(original(o)), o); }
      const validos = new Set(C.OSSOS_VRM || []);
      let mapa = {}, comoMapeou = "pelos nomes dos ossos";
      if (meta.humano.length) {
        for (const { osso, humano } of meta.humano) {
          const vrm = ossoDoUnity(humano), no = porNomeDeOsso.get(osso) || porNomeDeOsso.get(T.PropertyBinding.sanitizeNodeName(osso));
          if (no && validos.has(vrm) && !mapa[vrm]) mapa[vrm] = no;
        }
        comoMapeou = "pela ficha do Unity (.meta)";
      }
      if (OBRIGATORIOS.some((n) => !mapa[n])) {
        const lista = ossos.map((o) => ({ nome: original(o), pai: o.parent && ehOsso.has(o.parent) ? original(o.parent) : null }));
        const palpite = C.mapearOssos(lista), pelosNomes = {};
        for (const [vrm, n] of Object.entries(palpite)) { const no = porNomeDeOsso.get(n); if (no && validos.has(vrm)) pelosNomes[vrm] = no; }
        if (OBRIGATORIOS.filter((n) => !pelosNomes[n]).length <= OBRIGATORIOS.filter((n) => !mapa[n]).length) { mapa = { ...pelosNomes, ...mapa }; if (!meta.humano.length) comoMapeou = "pelos nomes dos ossos"; }
      }
      // os olhos (o reconhecimento pelos nomes pula; servem para ela olhar para a pessoa)
      const jaUsados = new Set(Object.values(mapa));
      for (const o of ossos) {
        if (jaUsados.has(o) || !/eye|目|瞳/i.test(original(o)) || /brow|lid|lash|high|shadow|white|line|まゆ|眉|ball_end|_end$/i.test(original(o))) continue;
        const lado = C.ladoDoOsso ? C.ladoDoOsso(original(o)) : null;
        if (lado && !mapa[lado + "Eye"] && mapa.head && (function sobe(x) { return x === mapa.head || (x.parent && sobe(x.parent)); })(o)) { mapa[lado + "Eye"] = o; jaUsados.add(o); }
      }
      if (!mapa.leftEye || !mapa.rightEye) { delete mapa.leftEye; delete mapa.rightEye; }
      if (mapa.upperChest && !mapa.chest) { mapa.chest = mapa.upperChest; delete mapa.upperChest; }
      const faltam = OBRIGATORIOS.filter((n) => !mapa[n]);
      if (faltam.length) {
        const e = new Error(`Não reconheci o esqueleto de uma pessoa em "${base(principal)}": ${faltam.length === OBRIGATORIOS.length ? "nenhum osso bateu" : "faltou " + faltam.map(nomeDoOsso).join(", ")}. ` +
          `Ossos do arquivo: ${ossos.slice(0, 14).map(original).join(", ")}${ossos.length > 14 ? "..." : ""}. Se o pacote tem outro modelo, escolha ele; se é um cenário, abra em Movimento › Cenário.`);
        e.semEsqueleto = true;
        throw e;
      }

      // 4. de pé, olhando para a frente (+Z), braço esquerdo em +X, pés no chão, em metros
      aoProgresso(0.3, "Ajustando o esqueleto...");
      const lugar = (o) => new T.Vector3().setFromMatrixPosition(o.matrixWorld);
      {
        const cima = lugar(mapa.head).sub(lugar(mapa.hips)).normalize();
        const esquerda = lugar(mapa.leftUpperArm).sub(lugar(mapa.rightUpperArm));
        esquerda.addScaledVector(cima, -esquerda.dot(cima)).normalize();
        const frente = new T.Vector3().crossVectors(esquerda, cima).normalize();
        objeto.applyMatrix4(new T.Matrix4().set(esquerda.x, esquerda.y, esquerda.z, 0, cima.x, cima.y, cima.z, 0, frente.x, frente.y, frente.z, 0, 0, 0, 0, 1));
        objeto.updateMatrixWorld(true);
      }
      const caixaDe = () => {
        const caixa = new T.Box3(), parte = new T.Box3();
        for (const m of malhas) {
          if (m.isSkinnedMesh) { m.skeleton.update(); m.computeBoundingBox(); parte.copy(m.boundingBox).applyMatrix4(m.matrixWorld); }
          else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); parte.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); }
          if (!parte.isEmpty() && isFinite(parte.min.y) && isFinite(parte.max.y)) caixa.union(parte);
        }
        return caixa;
      };
      let caixa = caixaDe(), altura = caixa.max.y - caixa.min.y;
      if (!(altura > 0)) throw new Error("Não consegui medir o avatar (as malhas vieram vazias).");
      let fator = 1;
      while (altura * fator > 4) fator /= 10;
      while (altura * fator < 0.25) fator *= 10;
      const quadril = lugar(mapa.hips);
      objeto.applyMatrix4(new T.Matrix4().makeScale(fator, fator, fator).setPosition(-quadril.x * fator, -caixa.min.y * fator, -quadril.z * fator));
      objeto.updateMatrixWorld(true);
      altura *= fator;

      // 5. tirar as escalas escondidas: cada nó com ossos embaixo fica só com posição e rotação
      const raiz = new T.Group();
      raiz.name = "Raiz";
      usados.add("Raiz");
      const temOsso = new Map();
      (function marcar(o) { let tem = ehOsso.has(o); for (const f of o.children) tem = marcar(f) || tem; temOsso.set(o, tem); return tem; })(objeto);
      const mundoAntigo = new Map(), mundoNovo = new Map();
      objeto.traverse((o) => mundoAntigo.set(o, o.matrixWorld.clone()));
      const ligacoes = comPele.map((m) => ({ malha: m, ossos: m.skeleton.bones.slice(), inversas: m.skeleton.boneInverses.map((b) => b.clone()), ligacao: m.bindMatrix.clone() }));
      const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(), um = new T.Vector3(1, 1, 1);
      (function refazer(o, paiNovo) {
        const novo = mundoAntigo.get(o).clone();
        if (temOsso.get(o)) { novo.decompose(p, q, s); novo.compose(p, q, um); }
        mundoNovo.set(o, novo);
        new T.Matrix4().copy(paiNovo).invert().multiply(novo).decompose(o.position, o.quaternion, o.scale);
        for (const f of o.children) refazer(f, novo);
      })(objeto, new T.Matrix4());
      raiz.add(objeto);
      for (const { malha, ossos: lista, inversas, ligacao } of ligacoes) {
        const novas = lista.map((b, i) => new T.Matrix4().copy(mundoNovo.get(b) || b.matrixWorld).invert().multiply(mundoAntigo.get(b) || b.matrixWorld).multiply(inversas[i]).multiply(ligacao));
        raiz.add(malha); // a malha com pele fica na raiz, sem transformação (no glTF quem a posiciona são os ossos)
        malha.position.set(0, 0, 0); malha.quaternion.identity(); malha.scale.set(1, 1, 1);
        malha.bind(new T.Skeleton(lista, novas), new T.Matrix4());
        malha.normalizeSkinWeights();
      }
      raiz.updateMatrixWorld(true);

      // 6. pose em T: braços na horizontal, pernas na vertical (um giro mínimo em cada osso, de cima para baixo)
      let girou = 0;
      const apontar = (osso, filho, alvo) => {
        if (!osso || !filho) return;
        const atual = lugar(filho).sub(lugar(osso));
        if (atual.lengthSq() < 1e-10) return;
        atual.normalize();
        const angulo = atual.angleTo(alvo);
        if (angulo < 0.009) return;
        girou = Math.max(girou, angulo);
        const giro = new T.Quaternion().setFromUnitVectors(atual, alvo), pai = new T.Quaternion();
        osso.parent.getWorldQuaternion(pai);
        osso.quaternion.premultiply(pai).premultiply(giro).premultiply(pai.invert());
        osso.updateMatrixWorld(true);
      };
      for (const [lado, x] of [["left", 1], ["right", -1]]) {
        const X = new T.Vector3(x, 0, 0), baixo = new T.Vector3(0, -1, 0);
        apontar(mapa[lado + "UpperArm"], mapa[lado + "LowerArm"], X);
        apontar(mapa[lado + "LowerArm"], mapa[lado + "Hand"], X);
        apontar(mapa[lado + "UpperLeg"], mapa[lado + "LowerLeg"], baixo);
        apontar(mapa[lado + "LowerLeg"], mapa[lado + "Foot"], baixo);
      }
      raiz.updateMatrixWorld(true);
      // os pés de volta no chão e o quadril no meio (a pose em T pode ter mudado a altura)
      caixa = caixaDe();
      const q2 = lugar(mapa.hips);
      objeto.position.x -= q2.x; objeto.position.y -= caixa.min.y; objeto.position.z -= q2.z;
      raiz.updateMatrixWorld(true);
      altura = caixa.max.y - caixa.min.y;

      // 7. expressões: das formas do rosto; só as usadas ficam no arquivo
      aoProgresso(0.45, "Rosto e materiais...");
      const comFormas = malhas.filter((m) => m.morphTargetDictionary && Object.keys(m.morphTargetDictionary).length && m.geometry.morphAttributes.position);
      const todas = comFormas.flatMap((m) => Object.keys(m.morphTargetDictionary));
      const { achadas, extras } = acharExpressoes(todas);
      if (!achadas.blink && achadas.blinkLeft && achadas.blinkRight) achadas.blink = [achadas.blinkLeft, achadas.blinkRight];
      const guardar = new Set([...Object.values(achadas).flat(), ...extras]);
      for (const m of comFormas) {
        const g = m.geometry, dic = m.morphTargetDictionary, ficam = Object.keys(dic).filter((n) => guardar.has(n)).sort((a, b) => dic[a] - dic[b]);
        g.morphAttributes.position = ficam.map((n) => { const a = g.morphAttributes.position[dic[n]]; a.name = n; return a; });
        delete g.morphAttributes.normal;
        if (!ficam.length) delete g.morphAttributes.position;
        m.morphTargetDictionary = Object.fromEntries(ficam.map((n, i) => [n, i]));
        m.morphTargetInfluences = ficam.map(() => 0);
      }
      for (const m of malhas) if (!comFormas.includes(m) && m.geometry.morphAttributes) { m.geometry.morphAttributes = {}; m.morphTargetDictionary = undefined; m.morphTargetInfluences = undefined; }
      // malhas do .fbx: juntar os vértices repetidos (o arquivo fica bem menor) e virar o V das texturas (no glTF o 0 é em cima)
      const geometrias = new Map();
      for (const m of malhas) {
        if (!geometrias.has(m.geometry)) {
          let g = m.geometry;
          if (ehFBX) {
            g = indexar(g);
            const uv = g.attributes.uv;
            if (uv) { for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); uv.needsUpdate = true; }
          }
          if (!g.attributes.normal) g.computeVertexNormals();
          geometrias.set(m.geometry, g);
        }
        m.geometry = geometrias.get(m.geometry);
      }

      // 8. materiais: do .mat do Unity (pela ficha, pelo nome) ou do próprio modelo
      const mats = new Map(); // caminho do .mat → lido
      for (const n of arquivos.keys()) if (/\.mat$/i.test(n)) { try { mats.set(n, lerMat(await arquivos.get(n).text())); } catch (e) { /* ilegível: fica de fora */ } }
      const matPorNome = new Map([...mats].map(([c, m]) => [liso(m.nome || c), c]));
      const acharMat = (nomeMaterial) => {
        const g = meta.materiais[nomeMaterial];
        if (g && guids.has(g) && mats.has(guids.get(g))) return mats.get(guids.get(g));
        const l = liso(nomeMaterial);
        if (!l) return null;
        if (matPorNome.has(l)) return mats.get(matPorNome.get(l));
        let melhor = null, tamanho = 0;
        for (const [n, c] of matPorNome) if (n.length >= 3 && l.length >= 3 && (n.includes(l) || l.includes(n)) && Math.min(n.length, l.length) > tamanho) { melhor = c; tamanho = Math.min(n.length, l.length); }
        return melhor ? mats.get(melhor) : null;
      };
      const imagens = [...arquivos.keys()].filter((n) => IMAGEM.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n));
      const texturas = new Map(), diretas = []; // caminho → Texture; [{nome, blob, mime}]
      let semTextura = 0, naoAbriu = 0;
      const texturaDoArquivo = async (caminho) => {
        if (texturas.has(caminho)) return texturas.get(caminho);
        const lida = await abrirImagem(arquivos.get(caminho), caminho);
        let tex = null;
        if (lida && lida.direto) {
          const tela = document.createElement("canvas");
          tela.width = tela.height = 1; // o conteúdo de verdade entra depois, direto no arquivo (sem regravar a imagem)
          tex = new T.CanvasTexture(tela);
          tex.name = "companhia-tex-" + diretas.length;
          tex.userData.mimeType = lida.direto.mime;
          diretas.push({ nome: tex.name, ...lida.direto });
        } else if (lida) { tex = new T.CanvasTexture(lida.tela); tex.name = semExt(caminho); }
        else naoAbriu++;
        if (tex) { tex.flipY = false; tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; }
        texturas.set(caminho, tex);
        return tex;
      };
      const embutidas = new Map(); // endereço → textura (as imagens embutidas no .fbx)
      const texturaDoModelo = async (tex) => {
        // a textura que o próprio modelo pede: um arquivo do pacote (entra direto) ou uma imagem embutida
        if (!tex || !tex.image) return null;
        const src = tex.image.src || "";
        if (pedidos.has(src)) { const c = pedidos.get(src); return c && IMAGEM.test(c) ? texturaDoArquivo(c) : null; }
        if (/^data:/.test(src) && src.length < 400) return null; // o pontinho branco de "não achei"
        if (tex.image.naturalWidth === 0 && /^blob:/.test(src)) {
          // embutida num formato que o navegador não abre (TGA, PSD): lê os bytes e decodifica aqui
          if (!embutidas.has(src)) {
            let nova = null;
            try {
              const lida = await abrirImagem(await (await fetch(src)).blob(), "");
              if (lida) { nova = new T.CanvasTexture(lida.tela || await createImageBitmap(lida.direto.blob)); nova.flipY = false; nova.colorSpace = T.SRGBColorSpace; nova.wrapS = nova.wrapT = T.RepeatWrapping; }
            } catch (e) { nova = null; }
            if (!nova) naoAbriu++;
            embutidas.set(src, nova);
          }
          return embutidas.get(src);
        }
        if (ehFBX) { tex.flipY = false; tex.needsUpdate = true; }
        return tex;
      };
      const novos = new Map();
      const converter = async (m) => {
        if (novos.has(m)) return novos.get(m);
        const n = new T.MeshStandardMaterial({ name: m.name || "Material", roughness: 0.9, metalness: 0 });
        const mat = acharMat(m.name);
        let tex = null;
        if (mat) {
          const chave = ["_MainTex", "_BaseMap", "_BaseColorMap", "_BaseTexture", "_MainTexture", "_Albedo", "_DiffuseMap", "_Diffuse"].find((k) => mat.texturas[k] && guids.has(mat.texturas[k]));
          if (chave && IMAGEM.test(guids.get(mat.texturas[chave]))) tex = await texturaDoArquivo(guids.get(mat.texturas[chave]));
          const cor = mat.cores._Color || mat.cores._BaseColor;
          if (cor) { n.color.setRGB(Math.min(1, cor[0]), Math.min(1, cor[1]), Math.min(1, cor[2]), T.SRGBColorSpace); if (cor[3] < 0.999) n.opacity = Math.max(0, cor[3]); }
          const modo = modoAlfa(mat);
          if (modo === "MASK") n.alphaTest = mat.numeros._Cutoff > 0 && mat.numeros._Cutoff < 1 ? mat.numeros._Cutoff : 0.5;
          else if (modo === "BLEND") n.transparent = true;
          const corte = mat.numeros._Cull !== undefined ? mat.numeros._Cull : mat.numeros._CullMode !== undefined ? mat.numeros._CullMode : mat.numeros._Culling;
          if (corte === 0) n.side = T.DoubleSide;
          const brilho = mat.texturas._EmissionMap && guids.has(mat.texturas._EmissionMap) && (mat.palavras.includes("_EMISSION") || mat.numeros._UseEmission === 1 || mat.numeros._EnableEmission === 1);
          if (brilho && IMAGEM.test(guids.get(mat.texturas._EmissionMap))) {
            const e = await texturaDoArquivo(guids.get(mat.texturas._EmissionMap)), c = mat.cores._EmissionColor || [1, 1, 1, 1];
            if (e) { n.emissiveMap = e; n.emissive.setRGB(Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2]), T.SRGBColorSpace); }
          }
        } else {
          if (m.color) n.color.copy(m.color);
          if (m.transparent) { n.transparent = true; n.opacity = m.opacity ?? 1; }
          if (m.alphaTest) n.alphaTest = m.alphaTest;
          if (m.side === T.DoubleSide) n.side = T.DoubleSide;
        }
        if (!tex) tex = await texturaDoModelo(m.map);
        if (!tex && !mat) { // pelo nome: uma imagem chamada como o material
          const l = liso(m.name), c = l.length >= 3 && imagens.find((x) => liso(x) === l || liso(x).includes(l));
          if (c) tex = await texturaDoArquivo(c);
        }
        if (tex) { n.map = tex; if (!mat) n.color.set(0xffffff); } else semTextura++;
        novos.set(m, n);
        return n;
      };
      for (const m of malhas) m.material = Array.isArray(m.material) ? await Promise.all(m.material.map(converter)) : await converter(m.material);
      // um pacote com uma textura só e nenhum material ligado: é a textura de tudo
      if (semTextura === novos.size && imagens.length === 1) { const unica = await texturaDoArquivo(imagens[0]); if (unica) for (const n of novos.values()) { n.map = unica; n.color.set(0xffffff); semTextura--; } }
      if (naoAbriu) avisos.push(`${naoAbriu} textura(s) estão num formato que não abre aqui (use PNG, JPEG, TGA ou PSD comum).`);
      if (semTextura > 0 && imagens.length) avisos.push(`${semTextura} de ${novos.size} materiais ficaram só com a cor: o pacote não diz qual textura é de cada um. Dá para pôr as texturas em Personagem › Roupas.`);

      // 9. gravar o glTF e completar com a parte de personagem (VRM 1.0)
      aoProgresso(0.6, "Montando o .vrm...");
      objeto.animations = [];
      const tirar = [];
      raiz.traverse((o) => { if (o.isCamera || o.isLight || o.isLine || o.isPoints) tirar.push(o); });
      for (const o of tirar) if (o.parent) o.parent.remove(o);
      const cena = new T.Scene();
      cena.add(raiz);
      cena.updateMatrixWorld(true);
      const buffer = await new V.GLTFExporter().parseAsync(cena, { binary: true, onlyVisible: true, maxTextureSize: 4096 });
      urls.forEach((u) => URL.revokeObjectURL(u));
      const { json, bin } = abrirGLB(buffer);
      const indice = new Map((json.nodes || []).map((n, i) => [n.name, i]));
      const no = (o) => indice.get(o.name);
      // texturas que entram direto
      const trocas = new Map();
      for (const d of diretas) {
        for (const t of json.textures || []) {
          if (t.name !== d.nome) continue;
          const im = json.images[t.source];
          trocas.set(im.bufferView, d.blob);
          im.mimeType = d.mime;
          delete t.name;
        }
      }
      // materiais no estilo das personagens VRoid (MToon)
      for (const m of json.materials || []) {
        const pbr = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {}), cor = pbr.baseColorFactor || [1, 1, 1, 1];
        pbr.metallicFactor = 0; pbr.roughnessFactor = 0.9;
        m.extensions = { ...(m.extensions || {}), VRMC_materials_mtoon: { specVersion: "1.0", transparentWithZWrite: false, renderQueueOffsetNumber: 0,
          shadeColorFactor: [cor[0] * 0.84, cor[1] * 0.8, cor[2] * 0.86].map((v) => +v.toFixed(4)), ...(pbr.baseColorTexture ? { shadeMultiplyTexture: { index: pbr.baseColorTexture.index } } : {}),
          shadingShiftFactor: -0.05, shadingToonyFactor: 0.9, giEqualizationFactor: 0.9, outlineWidthMode: "none" } };
      }
      // ossos de pessoa
      const humanBones = {};
      for (const [vrm, o] of Object.entries(mapa)) if (no(o) !== undefined) humanBones[vrm] = { node: no(o) };
      // expressões
      const ligar = (formas) => comFormas.flatMap((m) => [].concat(formas).filter((f) => m.morphTargetDictionary[f] !== undefined && no(m) !== undefined).map((f) => ({ node: no(m), index: m.morphTargetDictionary[f], weight: 1 })));
      const expressao = (formas) => ({ morphTargetBinds: ligar(formas), isBinary: false, overrideBlink: "none", overrideLookAt: "none", overrideMouth: "none" });
      const preset = {}, custom = {};
      for (const [e, formas] of Object.entries(achadas)) { const x = expressao(formas); if (x.morphTargetBinds.length) preset[e] = x; }
      for (const f of extras) { const x = expressao(f); if (x.morphTargetBinds.length) custom[f.replace(/[^\p{L}\p{N}_ -]/gu, "_")] = x; }
      // olhar: pelos ossos dos olhos
      let lookAt;
      if (mapa.leftEye && mapa.rightEye) {
        const olhos = lugar(mapa.leftEye).add(lugar(mapa.rightEye)).multiplyScalar(0.5).sub(lugar(mapa.head));
        const faixa = { inputMaxValue: 90, outputScale: 10 };
        lookAt = { offsetFromHeadBone: olhos.toArray().map((v) => +v.toFixed(4)), type: "bone", rangeMapHorizontalInner: faixa, rangeMapHorizontalOuter: faixa, rangeMapVerticalDown: faixa, rangeMapVerticalUp: faixa };
      }
      // balanço: cabelo, saia, rabo, orelhas, fitas
      const molas = this._molas(ossos, mapa, jaUsados, original, no, lugar, altura);
      json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), "VRMC_vrm", "VRMC_materials_mtoon", ...(molas ? ["VRMC_springBone"] : [])])];
      json.extensions = { ...(json.extensions || {}),
        VRMC_vrm: { specVersion: "1.0",
          meta: { name: nome, version: "1", authors: ["(não informado no pacote)"], copyrightInformation: `Convertido de ${base(principal)} pela Companhia (LNUX-APPs). Os direitos são de quem fez o avatar.`,
            licenseUrl: "https://vrm.dev/licenses/1.0/", avatarPermission: "onlyAuthor", allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false, commercialUsage: "personalNonProfit",
            allowPoliticalOrReligiousUsage: false, allowAntisocialOrHateUsage: false, creditNotation: "required", allowRedistribution: false, modification: "prohibited" },
          humanoid: { humanBones }, expressions: { preset, custom }, ...(lookAt ? { lookAt } : {}) },
        ...(molas ? { VRMC_springBone: molas.extensao } : {}) };
      json.asset = { ...(json.asset || {}), generator: "LNUX Companhia (conversor de avatares)" };
      json.extras = { ...(json.extras || {}), companhia: { convertido: ext(base(principal)), origem: base(principal) } };
      aoProgresso(0.95, "Terminando...");
      const vrm = fecharGLB(json, bin, trocas);
      for (const g of geometrias.values()) g.dispose();
      for (const t of texturas.values()) if (t) t.dispose();
      for (const n of novos.values()) n.dispose();
      let triangulos = 0;
      for (const m of malhas) triangulos += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      return { vrm, nome, avisos,
        resumo: { modelo: base(principal), comoMapeou, ossos: Object.keys(humanBones).length, dedos: Object.keys(humanBones).filter((n) => /Thumb|Index|Middle|Ring|Little/.test(n)).length,
          olhos: !!lookAt, poseEmT: girou > 0.05 ? Math.round(girou * 180 / Math.PI) : 0, altura: +altura.toFixed(2), escala: fator, triangulos: Math.round(triangulos),
          expressoes: Object.keys(preset), atalhos: Object.keys(custom), formas: new Set(todas).size, materiais: novos.size, comTextura: novos.size - Math.max(0, semTextura), doUnity: [...novos.keys()].filter((m) => acharMat(m.name)).length,
          balanco: molas ? molas.resumo : [], tamanho: vrm.size } };
    },

    /** Ossos soltos com nome de cabelo, saia, rabo... viram correntes com balanço (VRMC_springBone). */
    _molas(ossos, mapa, humanos, original, no, lugar, altura) {
      const T = window.THREE, k = altura / 1.6;
      const tipoDe = (o) => { const n = original(o); return SEM_BALANCO.test(n) ? null : BALANCO.find(([re]) => re.test(n)) || null; };
      const dentro = new Map(); // osso → tipo (o dele ou o herdado do pai)
      for (const o of ossos) {
        if (humanos.has(o) || no(o) === undefined) continue;
        const t = tipoDe(o) || (dentro.has(o.parent) && !SEM_BALANCO.test(original(o)) ? dentro.get(o.parent) : null);
        if (t) dentro.set(o, t);
      }
      if (!dentro.size) return null;
      const filhos = (o) => o.children.filter((f) => dentro.has(f));
      const springs = [], contagem = {};
      const corrente = (inicio) => {
        const lista = [inicio];
        let o = inicio;
        while (filhos(o).length) { const [primeiro, ...outros] = filhos(o); for (const f of outros) corrente(f); lista.push(primeiro); o = primeiro; }
        if (lista.length < 2) return; // um osso sozinho não tem para onde balançar
        const [, ajuste, rotulo] = dentro.get(inicio);
        springs.push({ name: original(inicio), joints: lista.map((b) => ({ node: no(b), hitRadius: +(0.02 * k).toFixed(4), gravityDir: [0, -1, 0], ...ajuste })), _tipo: rotulo });
        contagem[rotulo] = (contagem[rotulo] || 0) + 1;
      };
      for (const o of dentro.keys()) {
        if (dentro.has(o.parent)) continue;
        // um osso-base com vários ramos (a raiz do cabelo) fica parado: cada ramo é uma corrente
        if (filhos(o).length > 1) for (const f of filhos(o)) corrente(f); else corrente(o);
      }
      if (!springs.length) return null;
      // colisores: a cabeça e o tronco (para o cabelo) e as coxas (para a saia), no espaço de cada osso
      const colliders = [], grupos = { corpo: [], pernas: [] };
      const local = (osso, pontoNoMundo) => osso.worldToLocal(pontoNoMundo.clone()).toArray().map((v) => +v.toFixed(4));
      const esfera = (osso, ponto, raio, grupo) => { if (!osso || no(osso) === undefined) return; grupos[grupo].push(colliders.length); colliders.push({ node: no(osso), shape: { sphere: { offset: local(osso, ponto), radius: +(raio * k).toFixed(4) } } }); };
      const capsula = (osso, a, b, raio, grupo) => { if (!osso || no(osso) === undefined) return; grupos[grupo].push(colliders.length); colliders.push({ node: no(osso), shape: { capsule: { offset: local(osso, a), radius: +(raio * k).toFixed(4), tail: local(osso, b) } } }); };
      const cabeca = lugar(mapa.head);
      esfera(mapa.head, cabeca.clone().add(new T.Vector3(0, 0.07 * k, 0.01 * k)), 0.085, "corpo");
      const peito = mapa.upperChest || mapa.chest || mapa.spine;
      capsula(peito, lugar(peito).add(new T.Vector3(0, 0.03 * k, 0)), lugar(mapa.neck || mapa.head).add(new T.Vector3(0, -0.06 * k, 0)), 0.085, "corpo");
      capsula(mapa.hips, lugar(mapa.hips), lugar(mapa.spine), 0.09, "corpo");
      for (const lado of ["left", "right"]) capsula(mapa[lado + "UpperLeg"], lugar(mapa[lado + "UpperLeg"]), lugar(mapa[lado + "LowerLeg"]), 0.06, "pernas");
      const colliderGroups = [{ name: "corpo", colliders: grupos.corpo }, { name: "pernas", colliders: grupos.pernas }];
      for (const s of springs) { s.colliderGroups = s._tipo === "saia" ? [0, 1] : s._tipo === "cabelo" || s._tipo === "fitas" || s._tipo === "rabo" ? [0] : []; delete s._tipo; if (!s.colliderGroups.length) delete s.colliderGroups; }
      return { extensao: { specVersion: "1.0", colliders, colliderGroups, springs }, resumo: Object.entries(contagem).map(([n, q]) => `${n} (${q})`) };
    },
  };
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
})();
