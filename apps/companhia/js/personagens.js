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
    if (!modelos.length) {
      if (nomes.some((n) => /\.moc$/i.test(n) || /(^|\/)model\.json$/i.test(n))) throw new Error("Este parece um modelo do Live2D Cubism 2 (.moc / model.json). A Companhia lê modelos Cubism 3 e 4 (.moc3 / .model3.json), como os do VTube Studio.");
      throw new Error("Não achei o arquivo .model3.json. Escolha o ZIP (ou a pasta) do modelo Live2D, como os exportados pelo VTube Studio.");
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
