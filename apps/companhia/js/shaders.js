/*
 * Companhia — os shaders do Unity nos avatares convertidos.
 *
 * Um shader do Unity (HLSL/CG) não roda no navegador. O que dá para levar é o que ele quer dizer: cada material (.mat)
 * aponta para um shader (m_Shader, pelo guid) e guarda os valores dele (cores, números, texturas). Aqui:
 *   - o shader é reconhecido pelo nome ("Shader \"...\"" no .shader, que vem no pacote do avatar ou na biblioteca
 *     carregada pela pessoa) e ganha uma família:
 *       · desenho (toon): Poiyomi, lilToon, UTS (Unity-Chan), Sunao, Arktoon, MToon, VRChat Toon Lit, Rero com rampa...
 *       · realista (PBR): Standard, Rero Standard, URP/HDRP Lit, Autodesk Interactive...
 *       · sem luz (unlit): Unlit/*, VRChat Mobile Unlit...
 *   - os valores do material viram o material do WEBC:
 *       · desenho → MToon (o das personagens VRoid): a cor da sombra (_ShadowColor, _1st_ShadeColor...), o brilho na
 *         borda (rim: _RimLightColor/_RimColor e a largura), o contorno (outline: largura e cor), o relevo (normal map)
 *         e o brilho próprio (emissão);
 *       · realista → o material padrão do glTF: metal (_Metallic), rugosidade (1 − _Glossiness), relevo, emissão;
 *       · sem luz → MToon sem sombra (a cor fica igual com qualquer luz).
 *   - a biblioteca: a pessoa carrega shaders (.shader, ou o .unitypackage deles) em Personagem › Shaders do Unity. Eles
 *     ficam guardados no aparelho (só o nome, o guid, a família e a lista de propriedades: o código não é usado) e
 *     valem para os próximos avatares cujos materiais apontem para eles, mesmo quando o shader não vem no pacote.
 * O que não vem (não tem como no navegador): efeitos que dependem do código do shader (glitter, dissolve, AudioLink,
 * texturas de matcap e de rampa, decalques, parallax...).
 *
 * C.shaders = { familia(nome), lerShader(texto), carregar(arquivos), lista(), apagar(guid), perfil(guid, arquivos), traduzir(mat, perfil) }
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const CHAVE = "companhia-shaders";
  const GUID_EMBUTIDO = "0000000000000000f000000000000000";

  /** A família do shader pelo nome: "toon", "pbr", "unlit" ou "desconhecido". */
  function familia(nome) {
    const n = String(nome || "").toLowerCase();
    if (!n) return "desconhecido";
    if (/unlit|nolight|no lighting/.test(n)) return "unlit";
    if (/poiyomi|liltoon|lil toon|\buts\b|unitychantoon|unity-chan|toon|sunao|arktoon|mtoon|xstoon|xiexe|silent'?s? cel|celshad|cel shad|reflex shader|noenoe|orl|anime/.test(n)) return "toon";
    if (/standard|\blit\b|autodesk interactive|pbr|rero|specular|metallic|roughness|hdrp|urp|universal render/.test(n)) return "pbr";
    return "desconhecido";
  }
  /** Um .shader: o nome e as propriedades (sem o código). */
  function lerShader(texto) {
    const nome = (/^\s*Shader\s+"([^"]+)"/m.exec(texto) || [])[1] || "";
    const bloco = (/Properties\s*\{([\s\S]*?)\n\s*\}/.exec(texto) || [])[1] || "";
    const props = [...bloco.matchAll(/^\s*(?:\[[^\]]*\]\s*)*(_\w+)\s*\(/gm)].map((m) => m[1]);
    // um shader "Rero Standard" com as opções de rampa ligadas vira desenho; aqui só o nome conta
    return { nome, familia: familia(nome), props: [...new Set(props)].slice(0, 400) };
  }
  async function lista() { try { return (await LNUX.guardado.ler(CHAVE)) || []; } catch (e) { return []; } }
  /**
   * Carrega shaders para a biblioteca. arquivos: Map caminho → Blob (.shader soltos, ou de um .unitypackage, com
   * .guids e .metas). Devolve {novos, atualizados, ignorados, lista}.
   */
  async function carregar(arquivos) {
    const atual = await lista(), porGuid = new Map(atual.map((s) => [s.guid || "nome:" + s.nome, s]));
    let novos = 0, atualizados = 0, ignorados = 0;
    const guidDe = new Map();
    for (const [g, c] of arquivos.guids || []) guidDe.set(c, g);
    for (const [c, blob] of arquivos) {
      if (!/\.shader$/i.test(c)) continue;
      let s;
      try { s = lerShader(await blob.text()); } catch (e) { ignorados++; continue; }
      if (!s.nome) { ignorados++; continue; }
      let guid = guidDe.get(c) || null;
      const meta = arquivos.metas && arquivos.metas.get(c);
      if (!guid && meta) guid = (/guid:\s*([0-9a-f]{32})/.exec(meta) || [])[1] || null;
      const chave = guid || "nome:" + s.nome;
      const reg = { guid, nome: s.nome, familia: s.familia, props: s.props, arquivo: c.split("/").pop(), quando: Date.now() };
      if (porGuid.has(chave)) atualizados++; else novos++;
      porGuid.set(chave, reg);
    }
    const nova = [...porGuid.values()];
    await LNUX.guardado.gravar(CHAVE, nova);
    return { novos, atualizados, ignorados, lista: nova };
  }
  async function apagar(chave) { await LNUX.guardado.gravar(CHAVE, (await lista()).filter((s) => (s.guid || "nome:" + s.nome) !== chave)); }

  /**
   * O shader de um material: {nome, familia, origem: "pacote" | "biblioteca" | "embutido"} ou null.
   * ref: {id, guid} (o m_Shader do .mat); arquivos: o pacote do avatar (com .guids); biblioteca: a lista (opcional).
   */
  async function perfil(ref, arquivos, biblioteca = null) {
    if (!ref || !ref.guid) return null;
    if (ref.guid === GUID_EMBUTIDO) {
      const embutidos = { 46: "Standard", 45: "Standard (Specular setup)", 10750: "Unlit/Transparent", 10751: "Unlit/Transparent Cutout", 10752: "Unlit/Texture", 10755: "Unlit/Color" };
      const nome = embutidos[ref.id] || "";
      return nome ? { nome, familia: familia(nome), origem: "embutido" } : null;
    }
    const caminho = arquivos && arquivos.guids && arquivos.guids.get(ref.guid);
    if (caminho && /\.shader$/i.test(caminho) && arquivos.get(caminho)) {
      try { const s = lerShader(await arquivos.get(caminho).text()); if (s.nome) return { nome: s.nome, familia: s.familia, origem: "pacote" }; } catch (e) { /* ilegível */ }
    }
    const lib = biblioteca || (await lista());
    const achado = lib.find((s) => s.guid === ref.guid);
    return achado ? { nome: achado.nome, familia: achado.familia, origem: "biblioteca" } : null;
  }

  const ligado = (v) => v !== undefined && v > 0.5;
  /**
   * Os valores do material traduzidos (sem as texturas, que o conversor liga pelos guids): {familia, sombra, rim,
   * contorno, metal, rugosidade, relevo (guid), relevoEscala, semSombra}.
   */
  function traduzir(mat, p) {
    const f = p ? p.familia : "desconhecido", n = mat.numeros, c = mat.cores, t = mat.texturas, nome = (p && p.nome || "").toLowerCase();
    const r = { familia: f, shader: p ? p.nome : null };
    // o relevo (normal map): qualquer família
    const relevo = t._BumpMap || t._NormalMap || t._NormalTex;
    if (relevo) { r.relevo = relevo; r.relevoEscala = n._BumpScale ?? n._NormalScale ?? 1; }
    if (f === "pbr") {
      r.metal = Math.min(1, Math.max(0, n._Metallic ?? 0));
      const liso = n._Glossiness ?? n._Smoothness ?? 0.5;
      r.rugosidade = Math.min(1, Math.max(0.04, 1 - liso));
      // o Rero Standard com a rampa ligada desenha como toon
      if (/rero/.test(nome) && ligado(n._StylizeRamp)) r.familia = "toon";
    }
    if (r.familia === "toon") {
      // a cor da sombra
      const s = c._ShadowColor || c._1st_ShadeColor || c._ShadeColor || c._Shadow1stColor || c._ShadowColor1;
      if (s && !(/poiyomi/.test(nome) && n._ShadingEnabled === 0)) r.sombra = s.slice(0, 3);
      // o brilho na borda
      const rimLigado = /poiyomi/.test(nome) ? ligado(n._EnableRimLighting) : /liltoon|lil/.test(nome) ? ligado(n._UseRim) : (c._RimColor || c._RimLightColor) !== undefined && (n._RimLight === undefined || ligado(n._RimLight));
      const rc = c._RimLightColor || c._RimColor;
      if (rimLigado && rc) {
        const largura = Math.min(1, Math.max(0.05, n._RimWidth ?? n._RimBorder ?? n._RimLight_Power ?? 0.5));
        r.rim = { cor: rc.slice(0, 3).map((v) => v * Math.min(1, rc[3] ?? 1)), potencia: +(1 + (1 - largura) * 8).toFixed(2) };
      }
      // o contorno (outline)
      const contornoLigado = /poiyomi/.test(nome) ? ligado(n._EnableOutlines) : /liltoon|lil/.test(nome) ? /outline/.test(nome) : ligado(n._OutlineEnabled) || n._Outline_Width !== undefined && n._Outline_Width > 0;
      const larg = n._LineWidth ?? n._OutlineWidth ?? n._Outline_Width ?? n._Outline ?? 0;
      // Poiyomi e lilToon em centímetros; UTS e Rero em "unidades do shader" (um pouco menor)
      const metros = /poiyomi|liltoon|lil/.test(nome) ? larg * 0.01 : larg * 0.001;
      if (contornoLigado && metros >= 0.0003) r.contorno = { largura: +Math.min(0.01, metros).toFixed(5), cor: (c._LineColor || c._OutlineColor || c._Outline_Color || [0, 0, 0, 1]).slice(0, 3) };
    }
    if (f === "unlit") r.semSombra = true;
    return r;
  }

  /** O nome para mostrar: "Hidden/Locked/.poiyomi/Poiyomi Toon/794992ca..." → "Poiyomi Toon" (sem o código da versão travada). */
  function nomeCurto(nome) {
    const partes = String(nome || "").split("/").filter((p) => p && !/^[0-9a-f]{16,}$/i.test(p) && !/^(hidden|locked)$/i.test(p));
    return (partes.pop() || nome || "").replace(/^\./, "");
  }
  C.shaders = { familia, nomeCurto, lerShader, carregar, lista, apagar, perfil, traduzir, GUID_EMBUTIDO };
})();
