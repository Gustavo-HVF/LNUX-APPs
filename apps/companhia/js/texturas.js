/*
 * Companhia — achar a textura certa de cada material (personagens e cenários, js/avatar.js e js/conversor.js).
 *
 * Os pacotes do Unity e os ZIPs de modelos raramente dizem qual imagem é de qual material. O que se usa, nesta ordem:
 *   1. o material do Unity (.mat), achado pela ficha do modelo (.meta: "externalObjects") ou pelo nome: a propriedade
 *      da cor principal (Standard, URP, HDRP, lilToon, Poiyomi, UTS, Toony...) e, se houver, a do relevo (normal map);
 *   2. a textura que o próprio modelo pede (o .fbx guarda o nome do arquivo);
 *   3. o nome: a imagem cujo nome mais combina com o do material ("Body" ↔ "T_Body_BaseColor.png", "body_diff.tga"),
 *      deixando de fora as que não são de cor (normal, rugosidade, metal, máscara, emissão, sombra...).
 */
(function (raiz) {
  "use strict";
  const C = (raiz.C = raiz.C || {});
  const base = (n) => String(n).replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");

  // palavras que dizem o papel da imagem
  const COR = new Set(["albedo", "alb", "basecolor", "basecolour", "base", "diffuse", "diff", "dif", "color", "colour", "col", "main", "maintex", "d", "c", "bc", "tex", "texture", "skin", "body"]);
  const OUTRO = new Set(["normal", "normals", "nrm", "nor", "norm", "n", "bump", "height", "disp", "displacement", "rough", "roughness", "rgh", "r", "metal", "metallic", "metalness", "mtl", "m",
    "ao", "occlusion", "occ", "emission", "emissive", "emit", "emi", "e", "glow", "mask", "masks", "msk", "spec", "specular", "gloss", "glossiness", "opacity", "alpha", "matcap", "rim", "outline",
    "shadow", "shade", "sss", "thickness", "detail", "flow", "noise", "id", "orm", "arm", "mra", "rma", "lightmap", "lm", "cube", "env", "reflection", "toon", "ramp"]);
  const RUIDO = new Set(["mat", "material", "materials", "mtl", "t", "tx", "tex", "texture", "textures", "new", "default", "lambert", "phong", "blinn", "standard", "shader", "png", "jpg", "tga", "psd", "inst", "instance", "copy"]);
  /** As palavras de um nome ("T_Body_BaseColor" → ["body", "basecolor"]; "HairDiff01" → ["hair", "diff"]). */
  function palavras(nome) {
    return base(nome).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").toLowerCase().split(/[^a-z0-9぀-ヿ一-鿿]+/).filter((p) => p && !/^\d+$/.test(p));
  }
  /** O papel de uma imagem pelo nome: "cor", "normal" ou "outro" (rugosidade, máscara...). */
  function papel(nome) {
    const ps = palavras(nome), inteiro = base(nome).toLowerCase();
    const ultima = ps[ps.length - 1] || "";
    if (/normal|nrm/.test(inteiro)) return "normal";
    if (/matcap|roughness|metallic|metalness|occlusion|emissi|specular|glossiness|opacity|outline|shadow|lightmap|mask/.test(inteiro)) return "outro";
    if (ps.some((p) => ["normal", "normals", "nrm", "nor", "norm", "bump"].includes(p)) || ultima === "n") return "normal";
    if (ps.some((p) => OUTRO.has(p) && !["r", "m", "e", "n", "id"].includes(p)) || ["r", "m", "e", "id"].includes(ultima)) return "outro";
    return "cor";
  }
  /**
   * A imagem que mais combina com o nome do material (ou null). imagens: os caminhos do pacote; usadas: as que já foram
   * de outros materiais (valem um pouco menos); quer: "cor" (padrão) ou "normal".
   */
  function melhorPara(nomeMaterial, imagens, { usadas = new Set(), quer = "cor" } = {}) {
    const alvo = palavras(nomeMaterial).filter((p) => !RUIDO.has(p) && !COR.has(p) || p === "body" || p === "skin");
    if (!alvo.length) return null;
    const juntoAlvo = alvo.join("");
    let melhor = null, nota = 0;
    for (const img of imagens) {
      if (papel(img) !== quer) continue;
      const ps = palavras(img).filter((p) => !RUIDO.has(p));
      const nomes = ps.filter((p) => !COR.has(p) && !OUTRO.has(p) || p === "body" || p === "skin");
      let n = 0;
      for (const a of alvo) {
        if (nomes.includes(a)) n += 3;
        else if (a.length >= 4 && nomes.some((p) => p.length >= 4 && (p.startsWith(a) || a.startsWith(p)))) n += 2;
      }
      const junto = nomes.join("");
      if (junto && junto === juntoAlvo) n += 4;
      else if (juntoAlvo.length >= 4 && junto.includes(juntoAlvo)) n += 2;
      if (!n) continue;
      if (ps.some((p) => COR.has(p) && !["body", "skin", "tex", "texture"].includes(p))) n += 1; // diz que é de cor
      n -= Math.max(0, nomes.length - alvo.length) * 0.5; // palavras a mais (outra peça: "Body" ≠ "BodyTattoo")
      if (usadas.has(img)) n -= 1;
      if (n > nota) { nota = n; melhor = img; }
    }
    return nota >= 2.5 ? melhor : null;
  }
  // as propriedades da cor principal e do relevo, nos shaders mais usados (na ordem de preferência)
  const PROP_COR = ["_MainTex", "_BaseMap", "_BaseColorMap", "_BaseTexture", "_MainTexture", "_BaseColorTexture", "_Albedo", "_AlbedoMap", "_AlbedoTex", "_DiffuseMap", "_Diffuse",
    "_ColorMap", "_Color_Texture", "_BaseColor_Texture", "_Tex", "_Texture", "_MainTex2nd"];
  const PROP_NORMAL = ["_BumpMap", "_NormalMap", "_NormalTex", "_Normal", "_BumpTex"];
  /**
   * A textura de cor (e o relevo) de um .mat do Unity: {cor, normal} com os guids. Sem nenhuma propriedade conhecida, a
   * primeira textura cujo nome de propriedade não seja de outro papel (máscara, emissão, matcap...).
   */
  function doMaterialUnity(texturas, temGuid = () => true) {
    const achar = (lista) => { const k = lista.find((p) => texturas[p] && temGuid(texturas[p])); return k ? texturas[k] : null; };
    let cor = achar(PROP_COR);
    if (!cor) {
      const k = Object.keys(texturas).find((p) => temGuid(texturas[p]) && papel(p.replace(/^_/, "")) === "cor" && !/matcap|mask|emis|outline|shadow|rim|ramp|noise|detail|alpha|cube|env|aniso|gloss|spec|light/i.test(p));
      cor = k ? texturas[k] : null;
    }
    return { cor, normal: achar(PROP_NORMAL) };
  }
  C.texturas = { palavras, papel, melhorPara, doMaterialUnity, PROP_COR, PROP_NORMAL };
})(typeof window !== "undefined" ? window : globalThis);
