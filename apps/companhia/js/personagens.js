/*
 * Companhia — personagens: importar (ZIP do VTube Studio, pasta, ou pela ponte), guardar no aparelho, trocar.
 *
 * Um "pacote" é o conjunto de arquivos de um modelo Live2D Cubism 3/4: o .model3.json, o .moc3, as texturas,
 * a física e, quando vem do VTube Studio, o .vtube.json (atalhos de expressão, movimento parado, ícone e como
 * o rastreamento liga nos parâmetros). Tudo fica no navegador (IndexedDB) deste aparelho — nada é enviado.
 *
 * O ZIP exportado pela Companhia leva junto um companhia.json (perfil, emoções, áreas de toque, voz), então
 * dá para levar a personagem configurada para outro aparelho. Atenção à licença do modelo antes de compartilhar.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const LISTA = "companhia:lista";
  const chave = (id) => "companhia:p:" + id;
  const nomeDe = (c) => c.split("/").pop();
  const semExt = (n) => n.replace(/\.(model3|vtube|exp3|motion3)?\.json$/i, "").replace(/\.[^.]+$/, "");

  /** Perfil padrão de uma personagem nova (a pessoa edita em Personagem › Perfil). */
  C.perfilPadrao = (nome) => ({
    nome,
    apresentacao: `${nome} é uma personagem que conversa com você pela tela.`,
    personalidade: "Carinhosa, brincalhona e um pouco provocadora. Curiosa sobre o dia da pessoa. Fica tímida com elogios e reclama (de brincadeira) quando é provocada.",
    jeito: "Fala português do Brasil, de um jeito leve e natural, com frases curtas. Usa poucos emojis.",
    saudacao: "Oi! Que bom te ver.",
    comoChamar: "",
    idioma: "pt-BR",
  });

  // ── Ler um pacote (Map caminho → Blob) ──────────────────────────────

  /**
   * Examina os arquivos e devolve a descrição do modelo (sem guardar nada). Lança um erro explicado se faltar algo.
   */
  C.lerPacote = async function (arquivos) {
    const nomes = [...arquivos.keys()].filter((n) => !/(^|\/)(__MACOSX|\.)/.test(n));
    const modelos = nomes.filter((n) => /\.model3\.json$/i.test(n)).sort((a, b) => a.split("/").length - b.split("/").length);
    if (!modelos.length && nomes.some((n) => /\.vrm$/i.test(n))) return C.lerPacoteVRM(arquivos);
    if (!modelos.length && nomes.some((n) => /\.vroidcustomitem$/i.test(n))) {
      const e = new Error("Esse é um item de roupa do VRoid Studio (.vroidcustomitem), não uma personagem: ele guarda ajustes das roupas " +
        "que só existem dentro do VRoid Studio, então só abre lá. Aplique o item na sua personagem no VRoid Studio e exporte como VRM " +
        "(Câmera/Exportação › Exportar como VRM); depois importe o .vrm aqui. As texturas PNG do pacote podem virar cores da roupa em " +
        "Personagem › Roupas.");
      e.itemVroid = true;
      e.variacoes = C.variacoesDoPacote(arquivos);
      throw e;
    }
    if (!modelos.length) {
      if (nomes.some((n) => /\.moc$/i.test(n) || /(^|\/)model\.json$/i.test(n))) throw new Error("Este parece um modelo do Live2D Cubism 2 (.moc / model.json). O WEBC lê modelos Cubism 3 e 4 (.moc3 / .model3.json), como os do VTube Studio.");
      throw new Error("Não achei uma personagem: falta o .model3.json (Live2D, como os do VTube Studio) ou o .vrm (VRoid). Escolha o ZIP, a pasta ou o arquivo .vrm.");
    }
    const modelo = modelos[0];
    const base = modelo.includes("/") ? modelo.replace(/[^/]+$/, "") : "";
    const cfg = JSON.parse(await arquivos.get(modelo).text());
    const refs = cfg.FileReferences || {};
    const faltando = [refs.Moc, ...(refs.Textures || [])].filter((r) => r && !arquivos.has(base + r));
    if (!refs.Moc) throw new Error("O .model3.json não diz qual é o arquivo .moc3.");
    if (faltando.length) throw new Error("Faltam arquivos do modelo: " + faltando.join(", "));
    // vtube.json (se houver): na mesma pasta, com o mesmo nome de preferência
    const vtubes = nomes.filter((n) => /\.vtube\.json$/i.test(n));
    const caminhoVtube = vtubes.find((n) => n.startsWith(base) && semExt(nomeDe(n)) === semExt(nomeDe(modelo))) || vtubes[0] || null;
    let vtube = null;
    if (caminhoVtube) { try { vtube = JSON.parse(await arquivos.get(caminhoVtube).text()); } catch (e) { vtube = null; } }
    // acha um arquivo pelo nome, perto do modelo
    const acharPorNome = (nome) => {
      if (!nome) return null;
      if (arquivos.has(base + nome)) return base + nome;
      const n = nomeDe(nome).toLowerCase();
      return nomes.find((c) => nomeDe(c).toLowerCase() === n) || null;
    };
    // expressões: as do model3.json, os atalhos do VTube Studio e qualquer .exp3.json da pasta
    const expressoes = [];
    const vistas = new Set();
    const somar = (nome, caminho) => { if (caminho && !vistas.has(caminho)) { vistas.add(caminho); expressoes.push({ nome, caminho }); } };
    for (const e of refs.Expressions || []) somar(e.Name || semExt(nomeDe(e.File)), acharPorNome(e.File));
    for (const h of (vtube && vtube.Hotkeys) || []) if (h.Action === "ToggleExpression" && h.File) somar(h.Name || semExt(h.File), acharPorNome(h.File));
    for (const c of nomes.filter((n) => /\.exp3\.json$/i.test(n)).sort()) somar(semExt(nomeDe(c)), c);
    // nomes repetidos ganham um número
    const contagem = {};
    for (const e of expressoes) { contagem[e.nome] = (contagem[e.nome] || 0) + 1; if (contagem[e.nome] > 1) e.nome += " " + contagem[e.nome]; }
    // movimento parado
    let idle = null;
    const fr = (vtube && vtube.FileReferences) || {};
    if (fr.IdleAnimation) idle = acharPorNome(fr.IdleAnimation);
    if (!idle && refs.Motions) {
      const grupo = refs.Motions.Idle || refs.Motions.idle || Object.values(refs.Motions)[0];
      if (grupo && grupo[0]) idle = acharPorNome(grupo[0].File);
    }
    if (!idle) idle = nomes.find((n) => /idle.*\.motion3\.json$/i.test(n)) || null;
    const icone = acharPorNome(fr.Icon) || nomes.find((n) => /(^|\/)icon\.(png|jpe?g|webp)$/i.test(n)) || null;
    // configurações da própria Companhia (de um ZIP exportado por ela)
    let companhia = null;
    const cj = nomes.find((n) => nomeDe(n) === "companhia.json");
    if (cj) { try { companhia = JSON.parse(await arquivos.get(cj).text()); } catch (e) { companhia = null; } }
    const nome = (companhia && companhia.perfil && companhia.perfil.nome) || (vtube && vtube.Name) || semExt(nomeDe(modelo));
    const tamanho = [...arquivos.values()].reduce((s, b) => s + b.size, 0);
    return { nome, modelo, vtube, caminhoVtube, expressoes, idle, icone, companhia, tamanho, arquivosTotal: nomes.length,
      protegido: !!(vtube && vtube.GeneralSettings && vtube.GeneralSettings.WorkshopSharingForbidden) };
  };

  // ── Guardar e listar ────────────────────────────────────────────────

  async function lista() { return (await LNUX.guardado.ler(LISTA)) || []; }
  C.listarPersonagens = lista;

  /** Importa um pacote (Map caminho → Blob) e guarda. zipOriginal: o Blob do ZIP (se veio de um ZIP). */
  C.importarPacote = async function (arquivos, zipOriginal = null) {
    const info = await C.lerPacote(arquivos);
    if (info.tipo === "vrm") return importarVRM(info);
    // guarda só o que é do modelo (sem lixo de sistema), num ZIP sem compressão
    let zip = zipOriginal;
    if (!zip) {
      const z = new LNUX.Zip();
      for (const [c, b] of arquivos) if (!/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(c)) z.adicionar(c, b);
      zip = await z.gerar();
    }
    const id = LNUX.id("p");
    const cfg = info.companhia || {};
    const nomesExp = info.expressoes.map((e) => e.nome);
    const p = {
      id, nome: info.nome, criado: Date.now(), atualizado: Date.now(),
      modelo: info.modelo, vtube: info.vtube, expressoes: info.expressoes, idle: info.idle, icone: info.icone, protegido: info.protegido,
      perfil: Object.assign(C.perfilPadrao(info.nome), cfg.perfil || {}),
      emocoes: cfg.emocoes || C.adivinharExpressoes(nomesExp),
      ativas: (cfg.ativas || []).filter((n) => nomesExp.includes(n)),
      enquadramento: cfg.enquadramento || null,
      zonas: cfg.zonas || null,
      voz: cfg.voz || null,
      reacoes: cfg.reacoes || null,
    };
    await LNUX.guardado.gravar(chave(id), { ...p, zip });
    const icone = info.icone ? arquivos.get(info.icone) : null;
    const l = await lista();
    l.push({ id, nome: p.nome, criado: p.criado, icone });
    await LNUX.guardado.gravar(LISTA, l);
    return p;
  };

  /** Lê uma personagem guardada: devolve o registro + arquivos (Map) prontos para o palco. */
  C.lerPersonagem = async function (id) {
    const r = await LNUX.guardado.ler(chave(id));
    if (!r) return null;
    if (r.tipo === "vrm") return r; // as roupas (.vrm) já estão no registro
    const arquivos = await LNUX.Zip.ler(r.zip);
    const { zip, ...p } = r;
    return Object.assign(p, { arquivos });
  };

  /** Grava as mudanças de configuração (perfil, emoções, áreas, voz...). */
  C.salvarPersonagem = async function (p) {
    const r = await LNUX.guardado.ler(chave(p.id));
    if (!r) return;
    const { arquivos, ...dados } = p;
    dados.atualizado = Date.now();
    await LNUX.guardado.gravar(chave(p.id), { ...r, ...dados, zip: r.zip });
    const l = await lista();
    const item = l.find((x) => x.id === p.id);
    if (item && item.nome !== p.perfil.nome) { item.nome = p.perfil.nome; await LNUX.guardado.gravar(LISTA, l); }
  };

  C.apagarPersonagem = async function (id) {
    await LNUX.guardado.apagar(chave(id));
    for (const k of await LNUX.guardado.chaves("companhia:tex:" + id + ":")) await LNUX.guardado.apagar(k); // cópias reduzidas das texturas
    await LNUX.guardado.gravar(LISTA, (await lista()).filter((x) => x.id !== id));
  };

  /** ZIP com o modelo + companhia.json (configurações). */
  C.exportarPersonagem = async function (id) {
    const r = await LNUX.guardado.ler(chave(id));
    if (r.tipo === "vrm") return exportarVRM(r);
    const arquivos = await LNUX.Zip.ler(r.zip);
    const z = new LNUX.Zip();
    for (const [c, b] of arquivos) if (nomeDe(c) !== "companhia.json") z.adicionar(c, b);
    const base = r.modelo.includes("/") ? r.modelo.replace(/[^/]+$/, "") : "";
    z.adicionar(base + "companhia.json", JSON.stringify({
      versao: 1, app: "LNUX Companhia", perfil: r.perfil, emocoes: r.emocoes, ativas: r.ativas, enquadramento: r.enquadramento,
      zonas: r.zonas, voz: r.voz, reacoes: r.reacoes,
    }, null, 2));
    return await z.gerar();
  };

  // ── Personagens VRoid (.vrm) ────────────────────────────────────────

  /**
   * PNGs agrupados por pasta, como no pacote de um item do VRoid (Black.female/Dress.Black.png...): cada pasta vira
   * uma "variação" (um jogo de cores) que pode ser aplicada nas peças em Personagem › Roupas.
   */
  C.variacoesDoPacote = function (arquivos) {
    const grupos = new Map();
    for (const [c, b] of arquivos) {
      if (!/\.(png|jpe?g|webp)$/i.test(c) || /(^|\/)(__MACOSX|\.|thumbnails?\/|icon\.)/i.test(c)) continue;
      const partes = c.split("/");
      const pasta = partes.length > 1 ? partes[partes.length - 2] : "Texturas";
      if (!grupos.has(pasta)) grupos.set(pasta, {});
      grupos.get(pasta)[partes[partes.length - 1]] = b;
    }
    return [...grupos].map(([nome, imagens]) => ({ nome, imagens }));
  };

  /** Um ou mais .vrm (uma personagem com várias roupas) + texturas soltas (variações) + companhia.json. */
  C.lerPacoteVRM = async function (arquivos) {
    const vrms = [...arquivos].filter(([c]) => /\.vrm$/i.test(c) && !/(^|\/)(__MACOSX|\.)/.test(c));
    const roupas = [];
    let meta = null;
    for (const [c, blob] of vrms) {
      const m = await C.lerMetaVRM(blob);
      meta = meta || m;
      roupas.push({ id: LNUX.id("r"), nome: semExt(nomeDe(c)) || m.nome || "Roupa", blob, ocultas: [], texturas: {}, meta: m });
    }
    let companhia = null;
    const cj = [...arquivos.keys()].find((n) => nomeDe(n) === "companhia.json");
    if (cj) { try { companhia = JSON.parse(await arquivos.get(cj).text()); } catch (e) { companhia = null; } }
    // um ZIP exportado pela Companhia traz os nomes das roupas, as peças escondidas e as texturas trocadas
    if (companhia && Array.isArray(companhia.roupas)) {
      for (const r of roupas) {
        const dados = companhia.roupas.find((x) => x.arquivo && nomeDe(x.arquivo) === nomeDe(vrms[roupas.indexOf(r)][0]));
        if (!dados) continue;
        r.nome = dados.nome || r.nome;
        r.ocultas = dados.ocultas || [];
        for (const [peca, caminho] of Object.entries(dados.texturas || {})) {
          const achado = [...arquivos.keys()].find((n) => n.endsWith(caminho));
          if (achado) r.texturas[peca] = arquivos.get(achado);
        }
      }
    }
    const usadas = new Set(Object.values(roupas.flatMap((r) => Object.values(r.texturas))));
    const variacoes = C.variacoesDoPacote(new Map([...arquivos].filter(([c, b]) => !usadas.has(b) && !/(^|\/)texturas-da-companhia\//.test(c))));
    const nome = (companhia && companhia.perfil && companhia.perfil.nome) || meta.nome || roupas[0].nome;
    return { tipo: "vrm", nome, roupas, variacoes, companhia, meta, protegido: roupas.some((r) => !r.meta.redistribuir), convertido: roupas.some((r) => r.meta.convertido) };
  };

  async function importarVRM(info) {
    const id = LNUX.id("p");
    const cfg = info.companhia || {};
    const p = {
      id, tipo: "vrm", nome: info.nome, criado: Date.now(), atualizado: Date.now(), protegido: info.protegido, convertido: info.convertido || false,
      roupas: info.roupas.map(({ meta, ...r }) => ({ ...r, autor: meta.autor, versao: meta.versao, ...(meta.convertido ? { convertido: meta.convertido } : {}) })),
      roupaAtual: info.roupas[0].id, variacoes: info.variacoes,
      perfil: Object.assign(C.perfilPadrao(info.nome), cfg.perfil || {}),
      emocoes: cfg.emocoes || {}, ativas: cfg.ativas || [], enquadramento: cfg.enquadramento || null,
      voz: cfg.voz || null, reacoes: cfg.reacoes || null, qualidade: null, esqueleto: cfg.esqueleto || null,
    };
    await LNUX.guardado.gravar(chave(id), p);
    const l = await lista();
    l.push({ id, nome: p.nome, criado: p.criado, icone: null, tipo: "vrm" });
    await LNUX.guardado.gravar(LISTA, l);
    return p;
  }

  /** Acrescenta uma roupa (outro .vrm da mesma personagem). */
  C.adicionarRoupa = async function (p, blob, nome) {
    const m = await C.lerMetaVRM(blob);
    const r = { id: LNUX.id("r"), nome: nome || m.nome || "Roupa " + (p.roupas.length + 1), blob, ocultas: [], texturas: {}, autor: m.autor, versao: m.versao };
    p.roupas.push(r);
    if (!m.redistribuir) p.protegido = true;
    await C.salvarPersonagem(p);
    return r;
  };

  /** ZIP: roupas/<nome>.vrm + as texturas trocadas + companhia.json (dá para importar de volta, igual). */
  async function exportarVRM(r) {
    const z = new LNUX.Zip();
    const usados = new Set();
    const roupas = r.roupas.map((x, i) => {
      let base = (x.nome || "roupa").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "roupa-" + (i + 1);
      while (usados.has(base)) base += "-" + (i + 1);
      usados.add(base);
      z.adicionar(`roupas/${base}.vrm`, x.blob);
      const texturas = {};
      for (const [peca, blob] of Object.entries(x.texturas || {})) {
        const caminho = `texturas-da-companhia/${base}/${peca}.png`;
        z.adicionar(caminho, blob);
        texturas[peca] = caminho;
      }
      return { arquivo: `roupas/${base}.vrm`, nome: x.nome, ocultas: x.ocultas || [], texturas };
    });
    for (const v of r.variacoes || []) for (const [n, b] of Object.entries(v.imagens)) z.adicionar(`variacoes/${v.nome}/${n}`, b);
    z.adicionar("companhia.json", JSON.stringify({ versao: 1, app: "LNUX Companhia", tipo: "vrm", perfil: r.perfil, emocoes: r.emocoes, ativas: r.ativas,
      enquadramento: r.enquadramento, voz: r.voz, reacoes: r.reacoes, esqueleto: r.esqueleto || null, roupas }, null, 2));
    return z.gerar();
  }

  // ── De onde vêm os arquivos ─────────────────────────────────────────

  /** De um ZIP (Blob/File). */
  C.pacoteDoZip = async (blob) => LNUX.Zip.ler(blob);

  /** De uma pasta escolhida no navegador (<input webkitdirectory>): usa os caminhos relativos. */
  C.pacoteDaPasta = function (files) {
    const m = new Map();
    for (const f of files) m.set(f.webkitRelativePath || f.name, f);
    return m;
  };

  /** Escolher uma pasta pelo navegador. */
  C.escolherPasta = function () {
    return new Promise((ok) => {
      const i = LNUX.el("input", { type: "file", webkitdirectory: "", directory: "", multiple: true, style: { display: "none" } });
      i.addEventListener("change", () => { ok(Array.from(i.files || [])); i.remove(); });
      i.addEventListener("cancel", () => { ok([]); i.remove(); });
      document.body.append(i);
      i.click();
    });
  };

  /**
   * Pela ponte: a pessoa escolhe o .model3.json (ou o .vtube.json) numa pasta do aparelho e a Companhia lê a
   * pasta inteira (com subpastas, até 3 níveis e 400 arquivos).
   */
  C.pacoteDaPonte = async function (caminhoJson, aoProgresso) {
    const ponte = LNUX.ponte;
    const pasta = caminhoJson.replace(/\/[^/]+$/, "");
    const m = new Map();
    const fila = [[pasta, ""]];
    const itens = [];
    while (fila.length) {
      const [abs, rel] = fila.shift();
      const r = await ponte.listar(abs);
      for (const it of r.itens) {
        if (it.tipo === "pasta") { if (rel.split("/").length < 4) fila.push([it.caminho, rel + it.nome + "/"]); }
        else itens.push([it.caminho, rel + it.nome]);
        if (itens.length > 400) throw new Error("A pasta tem arquivos demais. Escolha a pasta só do modelo.");
      }
    }
    let n = 0;
    for (const [abs, rel] of itens) {
      if (/\.(psd|mp4|mov|zip|7z|rar|exe)$/i.test(rel)) continue;
      m.set(rel, await ponte.ler(abs, "blob"));
      if (aoProgresso) aoProgresso(++n / itens.length, rel);
    }
    return m;
  };
})();
