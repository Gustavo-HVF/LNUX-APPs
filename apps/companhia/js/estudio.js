/*
 * Companhia — os painéis do menu Movimento, para as personagens VRoid (.vrm):
 *
 *   Captura de movimento   a câmera comanda o rosto, os olhos, o tronco, os braços, as mãos, os dedos e as pernas
 *   Pacotes de movimento   importar e tocar movimentos (.vrma, .fbx, .bvh, .glb, ZIP) e ligar os ossos à mão
 *   Cenário                abrir um mapa (.glb, .fbx, .obj, ZIP, .unitypackage) e andar por ele (W A S D, Espaço)
 *   Ajustar esqueleto      braços em descanso, proporções e correção de rotação por osso
 *
 * Os painéis ficam ao lado da personagem (não cobrem o palco), para ver o resultado enquanto se mexe.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const pref = (k, padrao) => LNUX.preferencia.ler("companhia." + k, padrao);
  const gravarPref = (k, v) => LNUX.preferencia.gravar("companhia." + k, String(v));

  const NOMES_OSSOS = { hips: "Quadril", spine: "Coluna", chest: "Peito", upperChest: "Peito (alto)", neck: "Pescoço", head: "Cabeça",
    Shoulder: "Ombro", UpperArm: "Braço", LowerArm: "Antebraço", Hand: "Mão", UpperLeg: "Coxa", LowerLeg: "Canela", Foot: "Pé", Toes: "Dedos do pé",
    Thumb: "Polegar", Index: "Indicador", Middle: "Médio", Ring: "Anelar", Little: "Mínimo", Metacarpal: "base", Proximal: "1", Intermediate: "2", Distal: "ponta" };
  /** "leftIndexProximal" → "Indicador esq. 1" */
  C.nomeDoOsso = function (n) {
    const t = (x) => C.t(x);
    if (NOMES_OSSOS[n]) return t(NOMES_OSSOS[n]);
    const m = n.match(/^(left|right)([A-Z][a-z]+)([A-Z][a-z]+)?([A-Z][a-z]+)?$/);
    if (!m) return n;
    const lado = m[1] === "left" ? "esq." : "dir.", resto = m[2] + (m[3] && !C.DEDOS_VRM.includes(m[2]) ? m[3] : "");
    if (C.DEDOS_VRM.includes(m[2])) return `${t(NOMES_OSSOS[m[2]])} ${t(lado)} ${NOMES_OSSOS[m[3]] ? t(NOMES_OSSOS[m[3]]) : ""}`.trim();
    return `${NOMES_OSSOS[resto] ? t(NOMES_OSSOS[resto]) : resto} ${t(lado)}`;
  };
  const ESTADOS_ANDAR = [["parado", "ficar parada"], ["andando", "andar"], ["correndo", "correr"], ["pulando", "pular"]];

  /**
   * ctx: {area (onde os painéis ficam), palco (o da personagem aberta), captura, atual(): personagem, salvar(): guarda a
   * personagem (com espera), aviso}. Devolve as ações para os menus.
   */
  C.Estudio = function (ctx) {
    const { area, captura } = ctx;
    const palco = () => ctx.palco;
    const ehVRM = () => { const a = ctx.atual(); return !!(a && a.tipo === "vrm" && palco().tipo === "vrm"); };
    const exigirVRM = () => {
      if (ehVRM()) return true;
      LNUX.aviso("Isso é para personagens VRoid (.vrm), que têm esqueleto em 3D. Importe uma em Personagem › Importar ZIP ou .vrm.", "alerta", 7000);
      return false;
    };
    let aberto = null; // {id, elemento, aoFechar, atualizar}

    // ── o painel ao lado do palco ───────────────────────────────────
    /** A personagem fica no meio da parte do palco que o painel não cobre. */
    function abrirEspaco() {
      const p = palco();
      if (!p || !p.definirMargens) return;
      if (!aberto) { p.definirMargens({}); return; }
      const a = area.getBoundingClientRect(), r = aberto.elemento.getBoundingClientRect();
      const embaixo = r.width > a.width * 0.7; // no celular o painel fica embaixo, de lado a lado
      p.definirMargens(embaixo ? { baixo: Math.max(0, a.bottom - r.top) } : { direita: Math.max(0, a.right - r.left) });
    }
    window.addEventListener("resize", () => { if (aberto) abrirEspaco(); });
    function fechar() {
      if (!aberto) return;
      const a = aberto;
      aberto = null;
      a.elemento.remove();
      abrirEspaco();
      if (a.aoFechar) a.aoFechar();
    }
    function painel(id, titulo, corpo, { aoFechar, atualizar } = {}) {
      if (aberto && aberto.id === id) { fechar(); return null; }
      fechar();
      const caixa = el("aside", { class: "painel-estudio", role: "dialog", "aria-label": titulo },
        el("header", {}, el("span", { class: "titulo" }, titulo), el("button", { class: "lnux-botao icone pequeno plano", type: "button", "aria-label": "Fechar", title: "Fechar", html: LNUX.icone("fechar"), onclick: fechar })),
        el("div", { class: "corpo ajustes" }, corpo));
      // mexer no painel não conta como toque na personagem nem gira a câmera
      for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel"]) caixa.addEventListener(ev, (e) => e.stopPropagation());
      area.append(caixa);
      aberto = { id, elemento: caixa, aoFechar, atualizar };
      abrirEspaco();
      return caixa;
    }
    const marcar = (rotulo, valor, aoMudar, dica) => {
      const c = el("input", { type: "checkbox", checked: !!valor });
      c.addEventListener("change", () => aoMudar(c.checked));
      return el("label", { class: "lnux-alternar", title: dica || "" }, c, rotulo);
    };
    const faixa = (rotulo, min, max, passo, valor, aoMudar, mostrar = (v) => v) => {
      const num = el("span", { class: "valor mono" }, mostrar(valor));
      const i = el("input", { type: "range", min, max, step: passo, value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => { num.textContent = mostrar(+i.value); aoMudar(+i.value); });
      const campo = el("label", { class: "lnux-campo faixa" }, el("span", {}, rotulo, num), i);
      campo.definir = (v) => { i.value = v; num.textContent = mostrar(+v); };
      return campo;
    };
    const escolha = (rotulo, opcoes, valor, aoMudar) => {
      const s = el("select", { class: "lnux-selecao", "aria-label": rotulo }, opcoes.map(([v, n]) => el("option", { value: v, selected: String(v) === String(valor) }, n)));
      s.addEventListener("change", () => aoMudar(s.value));
      const campo = el("label", { class: "lnux-campo" }, el("span", {}, rotulo), s);
      campo.selecao = s;
      return campo;
    };
    const botao = (rotulo, acao, classes = "") => el("button", { class: "lnux-botao " + classes, type: "button", onclick: async () => { try { await acao(); } catch (e) { LNUX.erro(e); } } }, rotulo);

    // ── Captura de movimento ────────────────────────────────────────
    async function alternarCaptura(ligar) {
      if (!exigirVRM()) return false;
      if (ligar === undefined) ligar = !captura.ligada;
      try {
        if (ligar) {
          await captura.ligar();
          const d = captura.medida.delegado || {};
          LNUX.aviso("Captura de movimento ligada" + (Object.values(d).includes("GPU") ? " (placa de vídeo)" : " (processador)") + ". A imagem da câmera não sai do aparelho.", "ok", 5000);
        } else captura.desligar();
      } catch (e) { LNUX.erro(e); }
      ctx.aoMudar();
      if (aberto && aberto.atualizar) aberto.atualizar();
      return captura.ligada;
    }
    async function religar() { if (captura.ligada) { captura.desligar(); await alternarCaptura(true); } }

    async function painelCaptura() {
      if (!exigirVRM()) return;
      const cfg = captura.cfg;
      const mudar = (k, reinicia) => (v) => { cfg[k] = v; captura.salvarCfg(); captura.aplicarPrevia(); if (reinicia) religar(); };
      const liga = botao("", () => alternarCaptura(), "primario");
      const estado = el("div", { class: "fraco pequeno estado-captura" });
      const cameras = escolha("Câmera", [["", "Automática (a da frente)"]], cfg.camera, mudar("camera", true));
      const listarCameras = async () => {
        const l = await captura.cameras();
        cameras.selecao.replaceChildren(el("option", { value: "" }, "Automática (a da frente)"), ...l.map((c) => el("option", { value: c.id, selected: c.id === cfg.camera }, c.nome)));
      };
      const atualizar = () => {
        liga.textContent = captura.ligada ? "Desligar a câmera" : captura.ligando ? "Ligando..." : "Ligar a câmera";
        liga.classList.toggle("primario", !captura.ligada);
        const m = captura.medida, a = captura.achados || {}, d = m.delegado || {};
        estado.textContent = !captura.ligada ? "Desligada. A câmera comanda a personagem: o que você faz, ela faz."
          : C.t("{fps} quadros por segundo ({ms} ms cada, {como}) · achou: {achou}", { fps: m.fps || "…", ms: Math.round(m.ms || 0), como: C.t(Object.values(d).includes("GPU") ? "placa de vídeo" : "processador"),
            achou: [a.rosto && C.t("rosto"), a.corpo && C.t("corpo"), a.maos && C.t(a.maos > 1 ? "{n} mãos" : "{n} mão", { n: a.maos })].filter(Boolean).join(C.t(", ")) || C.t("ninguém ainda (fique de frente para a câmera, com luz)") });
      };
      const relogio = setInterval(atualizar, 700);
      const corpo = el("div", { class: "ajustes" }, liga, estado,
        el("div", { class: "lnux-rotulo" }, "O que rastrear"),
        marcar("Rosto e expressões (boca, piscar, sobrancelhas, cabeça)", cfg.rosto, mudar("rosto", true)),
        marcar("Olhos (para onde você olha)", cfg.olhos, mudar("olhos")),
        marcar("Corpo: tronco, ombros e braços", cfg.corpo, mudar("corpo", true)),
        marcar("Mãos e dedos", cfg.maos, mudar("maos", true)),
        marcar("Pernas e postura inteira (o corpo todo precisa aparecer)", cfg.pernas, mudar("pernas")),
        el("div", { class: "lnux-rotulo" }, "Como"),
        marcar("Espelhar (como num espelho)", cfg.espelhar, mudar("espelhar"), "Ligado: sua mão direita mexe a mão do lado direito da tela. Desligado: a mão direita da personagem."),
        marcar("Mostrar a câmera no canto", cfg.previa, mudar("previa")),
        faixa("Suavizar o movimento", 0, 1, 0.05, cfg.suavizar, mudar("suavizar"), (v) => (v < 0.25 ? " rápido" : v > 0.7 ? " macio" : " médio")),
        botao("Calibrar (olhe para a tela)", () => { LNUX.aviso(captura.calibrar() ? "Pronto: essa posição da cabeça agora é a de olhar para a frente." : "Ligue a câmera e apareça nela primeiro.", captura.cabecaCrua ? "ok" : "alerta"); }),
        el("details", {}, el("summary", {}, "Câmera e desempenho"),
          el("div", { class: "ajustes", style: { marginTop: "8px" } }, cameras,
            escolha("Precisão do corpo", [["lite", "Leve (mais rápido)"], ["full", "Completa (mais firme, mais pesada)"]], cfg.modeloCorpo, mudar("modeloCorpo", true)),
            escolha("Processar com", [["auto", "Automático (placa de vídeo, se der)"], ["cpu", "Processador (se o rastreamento sair torto)"]], cfg.delegado, mudar("delegado", true)),
            escolha("Quadros por segundo", [[30, "30 (mais solto)"], [20, "20"], [12, "12 (poupa bateria)"]], cfg.fps, (v) => mudar("fps")(+v)))),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Na primeira vez são baixados os arquivos do rastreamento (uns 25 MB com tudo ligado); depois funciona sem internet. " +
          "No celular, desligue o que não usar (as mãos são o mais pesado). A imagem da câmera é processada no aparelho e não é enviada nem guardada."));
      painel("captura", "Captura de movimento", corpo, { aoFechar: () => clearInterval(relogio), atualizar });
      atualizar();
      listarCameras();
    }

    // ── Pacotes de movimento ────────────────────────────────────────
    const andar = () => { try { return JSON.parse(pref("andar", "{}")) || {}; } catch (e) { return {}; } };
    /** Põe no cenário os movimentos escolhidos para parado/andar/correr/pular. */
    async function aplicarAndar() {
      const p = palco();
      if (!p || !p.mundo) return;
      const escolhidos = andar(), clips = {};
      for (const [estado] of ESTADOS_ANDAR) if (escolhidos[estado]) { try { clips[estado] = await C.movimentos.clip(escolhidos[estado]); } catch (e) { /* foi apagado */ } }
      p.mundo.definirClips(clips);
    }
    let repetir = pref("mov-repetir", "1") === "1", velocidade = +pref("mov-velocidade", "1") || 1, tocandoId = null;
    async function tocar(id) {
      if (!exigirVRM()) return;
      const clip = await C.movimentos.clip(id);
      tocandoId = id;
      palco().tocarMovimento(clip, { repetir, velocidade, transicao: 0.35, info: { tipo: "movimento", id, nome: clip.name } });
      if (aberto && aberto.atualizar) aberto.atualizar();
    }
    function parar() { tocandoId = null; if (ehVRM()) palco().pararMovimento(0.35); if (aberto && aberto.atualizar) aberto.atualizar(); }
    async function importarMovimentos() {
      const arqs = await LNUX.arquivos.abrir({ titulo: "Importar movimentos (.vrma, .fbx, .bvh, .glb ou um ZIP com vários)", aceitar: ".vrma,.fbx,.bvh,.glb,.gltf,.zip", multiplos: true });
      if (!arqs.length) return null;
      const mapa = new Map();
      for (const a of arqs) mapa.set(a.nome, await a.blob());
      return receberMovimentos(mapa);
    }
    async function receberMovimentos(mapa) {
      await C.prepararVRM();
      const prog = LNUX.progresso("Lendo os movimentos");
      let r;
      try { prog.definir(0.3, "Convertendo para o esqueleto do VRM..."); r = await C.movimentos.importar(mapa); } finally { prog.fechar(); }
      // pelo nome (idle, walk, run, jump), os primeiros já ficam como o andar do cenário
      const escolhidos = andar(), usados = [];
      for (const m of r.novos) { const e = C.movimentos.palpite(m.nome); if (e && !escolhidos[e]) { escolhidos[e] = m.id; usados.push(C.t("\"{nome}\" ao {estado}", { nome: m.nome, estado: C.t(ESTADOS_ANDAR.find((x) => x[0] === e)[1]) })); } }
      if (usados.length) { gravarPref("andar", JSON.stringify(escolhidos)); await aplicarAndar(); }
      if (r.novos.length) LNUX.aviso(C.t(r.novos.length > 1 ? "{n} movimentos importados." : "1 movimento importado.", { n: r.novos.length }) + (usados.length ? " " + C.t("No cenário: {lista}.", { lista: usados.join(C.t(", ")) }) : ""), "ok", 7000);
      if (r.erros.length) LNUX.dialogo({ titulo: "Movimentos que não abriram", corpo: el("div", { class: "ajustes" }, ...r.erros.map((t) => el("p", { style: { margin: 0 } }, t))), largo: true, botoes: [{ rotulo: "Entendi", primario: true, valor: true }] });
      if (aberto && aberto.atualizar) aberto.atualizar();
      return r;
    }
    /** Ligar os ossos do arquivo aos do VRM, à mão. */
    async function janelaOssos(mov) {
      const info = await C.movimentos.ossos(mov.id);
      if (!info) { LNUX.aviso("Os .vrma já vêm no esqueleto do VRM: não há o que ligar.", "info"); return; }
      const atualMapa = { ...(info.mapa || info.automatico) };
      const linha = (n) => {
        const s = el("select", { class: "lnux-selecao", "aria-label": C.nomeDoOsso(n) }, el("option", { value: "" }, "— (não ligar)"), ...info.ossos.map((o) => el("option", { value: o, selected: atualMapa[n] === o }, o)));
        s.addEventListener("change", () => { if (s.value) atualMapa[n] = s.value; else delete atualMapa[n]; });
        return el("div", { class: "linha-osso" }, el("span", {}, C.nomeDoOsso(n)), s);
      };
      const principais = C.OSSOS_VRM.filter((n) => !C.DEDOS_VRM.some((d) => n.includes(d)));
      const dedos = C.OSSOS_VRM.filter((n) => C.DEDOS_VRM.some((d) => n.includes(d)));
      const corpo = el("div", { class: "ajustes" },
        el("p", { class: "fraco", style: { margin: 0 } }, C.t("\"{nome}\" tem {n} ossos. O WEBC liga pelos nomes; se um membro mexe errado (ou não mexe), escolha aqui o osso certo do arquivo para cada osso da personagem.", { nome: mov.nome, n: info.ossos.length })),
        el("div", { class: "tabela-ossos" }, principais.map(linha)),
        el("details", {}, el("summary", {}, "Dedos"), el("div", { class: "tabela-ossos", style: { marginTop: "8px" } }, dedos.map(linha))));
      const r = await LNUX.dialogo({ titulo: "Ossos do movimento", corpo, largo: true, botoes: [{ rotulo: "Voltar ao automático", valor: "auto" }, "espaco", { rotulo: "Cancelar", valor: null }, { rotulo: "Salvar", primario: true, valor: "salvar" }] });
      if (!r) return;
      try {
        const clip = await C.movimentos.definirMapa(mov.id, r === "auto" ? null : atualMapa);
        LNUX.aviso("Ligação dos ossos guardada.", "ok");
        await aplicarAndar();
        if (tocandoId === mov.id && clip) tocar(mov.id);
      } catch (e) { LNUX.erro(e); }
    }
    async function painelMovimentos() {
      if (!exigirVRM()) return;
      const lista = el("div", { class: "lista-movimentos" });
      const atualizar = async () => {
        const l = await C.movimentos.lista(), escolhidos = andar();
        const info = palco().anim && palco().anim.info;
        if (!(info && info.tipo === "movimento" && palco().anim.tocando)) tocandoId = null;
        if (!l.length) { lista.replaceChildren(el("p", { class: "fraco", style: { margin: 0 } }, "Nenhum movimento ainda. Importe um pacote: .vrma (VRM Animation), .fbx (Mixamo), .bvh, .glb com animação, ou um ZIP com vários.")); return; }
        const grupos = new Map();
        for (const m of l) { const g = m.pacote || "Avulsos"; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(m); }
        lista.replaceChildren(...[...grupos].flatMap(([g, itens]) => [
          el("div", { class: "lnux-rotulo grupo" }, g, el("button", { class: "lnux-botao icone pequeno plano", type: "button", title: C.t("Apagar o pacote \"{nome}\"", { nome: g }), "aria-label": "Apagar pacote", html: LNUX.icone("lixo"),
            onclick: async () => { if (!(await LNUX.confirmar("Apagar pacote", C.t("Apagar os {n} movimentos de \"{nome}\"?", { n: itens.length, nome: g }), { rotulo: "Apagar", perigo: true }))) return; if (itens.some((m) => m.id === tocandoId)) parar(); await C.movimentos.apagar(itens.map((m) => m.id)); await aplicarAndar(); atualizar(); } })),
          ...itens.map((m) => {
            const usos = ESTADOS_ANDAR.filter(([e]) => escolhidos[e] === m.id).map(([, n]) => n);
            const menu = el("button", { class: "lnux-botao icone pequeno plano", type: "button", title: "Mais", "aria-label": "Mais opções de " + m.nome }, "⋯");
            menu.addEventListener("click", () => {
              const r = menu.getBoundingClientRect();
              LNUX.abrirMenu([
                { grupo: "No cenário, usar ao" },
                ...ESTADOS_ANDAR.map(([e, n]) => ({ rotulo: n, marcado: () => andar()[e] === m.id, acao: async () => { const a = andar(); if (a[e] === m.id) delete a[e]; else a[e] = m.id; gravarPref("andar", JSON.stringify(a)); await aplicarAndar(); atualizar(); } })),
                "-",
                { rotulo: "Ossos...", acao: () => janelaOssos(m), ativo: () => m.tipo !== "vrma" },
                { rotulo: "Renomear...", acao: async () => { const n = await LNUX.perguntar("Renomear movimento", { valor: m.nome }); if (n && n.trim()) { await C.movimentos.renomear(m.id, n.trim()); atualizar(); } } },
                { rotulo: "Apagar", acao: async () => { if (tocandoId === m.id) parar(); await C.movimentos.apagar(m.id); await aplicarAndar(); atualizar(); } },
              ], r.left, r.bottom + 4, menu);
            });
            return el("div", { class: "linha-movimento" + (tocandoId === m.id ? " tocando" : "") },
              el("button", { class: "lnux-botao icone pequeno" + (tocandoId === m.id ? " primario" : ""), type: "button", title: tocandoId === m.id ? "Parar" : "Tocar", "aria-label": (tocandoId === m.id ? "Parar " : "Tocar ") + m.nome,
                html: LNUX.icone(tocandoId === m.id ? "parar" : "play"), onclick: () => (tocandoId === m.id ? parar() : tocar(m.id).catch(LNUX.erro)) }),
              el("span", { class: "nome", title: m.nome }, m.nome, usos.length ? el("small", { class: "fraco" }, " · ao " + usos.join(", ")) : null),
              el("span", { class: "fraco mono pequeno" }, m.duracao >= 0.2 ? m.duracao.toFixed(1) + " s" : "pose"), menu);
          }),
        ]));
      };
      const corpo = el("div", { class: "ajustes" },
        el("div", { class: "linha" }, botao("Importar...", importarMovimentos, "primario"), botao("Parar", parar)),
        el("div", { class: "linha" }, marcar("Repetir", repetir, (v) => { repetir = v; gravarPref("mov-repetir", v ? "1" : "0"); if (tocandoId) tocar(tocandoId); })),
        faixa("Velocidade", 0.25, 2, 0.05, velocidade, (v) => { velocidade = v; gravarPref("mov-velocidade", v); if (ehVRM()) palco().anim.definirVelocidade(v); }, (v) => " " + v.toFixed(2) + "×"),
        lista,
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Os movimentos servem para qualquer personagem VRoid e ficam guardados neste aparelho. Se os braços ou as pernas ficarem fora do lugar, corrija em Movimento › Ajustar esqueleto (vale para todos os movimentos) ou em ⋯ › Ossos (a ligação de um movimento)."));
      painel("movimentos", "Pacotes de movimento", corpo, { atualizar });
      atualizar();
    }

    // ── Cenário ─────────────────────────────────────────────────────
    function alternarAndar(ligar) {
      if (!exigirVRM()) return false;
      const m = palco().mundo;
      if (ligar === undefined) ligar = !m.andando;
      if (ligar) {
        m.entrar();
        if (!pref("andar-dica", "")) { gravarPref("andar-dica", "1"); LNUX.aviso("Andar: W A S D ou as setas · Shift corre · Espaço pula · arraste para girar a câmera · a rodinha aproxima. No celular, use o direcional da tela.", "info", 9000); }
      } else m.sair();
      ctx.aoMudar();
      if (aberto && aberto.atualizar) aberto.atualizar();
      return m.andando;
    }
    /** Voar (atravessar as paredes): sozinho, sempre; numa sala, só quem criou. */
    function alternarVoo(ligar) {
      if (!exigirVRM()) return false;
      const m = palco().mundo;
      if (ligar === undefined) ligar = !m.voando;
      if (ligar && !m.podeVoar()) { LNUX.aviso("Na sala, só quem criou pode voar (atravessar as paredes).", "alerta"); return false; }
      const estava = m.andando;
      m.alternarVoo(ligar);
      if (m.voando && !pref("voo-dica", "")) { gravarPref("voo-dica", "1"); LNUX.aviso("Voando: anda para onde a câmera olha, Espaço sobe, C desce, Shift vai mais rápido, V para de voar. Achou o lugar? Cenário › \"Começar aqui\".", "info", 9000); }
      if (estava !== m.andando) ctx.aoMudar();
      if (aberto && aberto.atualizar) aberto.atualizar();
      return m.voando;
    }
    async function abrirMapaGuardado(id, { avisar = true } = {}) {
      const p = palco();
      if (!p || !p.mundo) return false;
      if (!id) { p.mundo.tirarMapa(); gravarPref("mapa", ""); return true; }
      const reg = (await C.mapas.lista()).find((x) => x.id === id), arquivos = reg && (await C.mapas.ler(id));
      if (!arquivos) { gravarPref("mapa", ""); if (avisar) LNUX.aviso("Esse cenário não está mais guardado.", "alerta"); return false; }
      const r = await p.mundo.abrirMapa(arquivos, reg);
      if (!reg.ajuste || !reg.ajuste.escala) { reg.ajuste = { ...p.mundo.info.ajuste }; await C.mapas.atualizar(reg); }
      gravarPref("mapa", id);
      if (avisar) LNUX.aviso(C.t("Cenário \"{nome}\": {n} triângulos, {x} × {z} m.", { nome: reg.nome, n: r.triangulos.toLocaleString(), x: r.tamanho[0], z: r.tamanho[2] }), "ok");
      return true;
    }
    /** Escolhe os arquivos de um cenário (o modelo e o que vier junto: texturas, .mtl, .bin). */
    async function escolherMapa(titulo) {
      const arqs = await LNUX.arquivos.abrir({ titulo, aceitar: C.conversor.ACEITAR, multiplos: true });
      if (!arqs.length) return null;
      const entrada = new Map();
      for (const a of arqs) entrada.set(a.nome, await a.blob());
      return { entrada, nome: LNUX.nomeSemExtensao((arqs.find((a) => C.conversor.MODELO.test(a.nome) || /\.(zip|unitypackage)$/i.test(a.nome)) || arqs[0]).nome) };
    }
    /**
     * Qualquer formato aceito → .glb. Abre ZIP e .unitypackage, explica o que não abre (.vrcw), pergunta qual modelo é o
     * mapa quando há vários e converte. Devolve {glb, nome, triangulos, avisos, como} ou null (cancelou ou não abre).
     */
    async function converterEntrada(entrada, nome) {
      let arquivos;
      try { arquivos = await C.mapas.preparar(entrada); }
      catch (e) {
        if (!e.explicacao) throw e;
        LNUX.dialogo({ titulo: "Esse arquivo não abre aqui", corpo: e.message, largo: true, botoes: [{ rotulo: "Entendi", primario: true, valor: true }] });
        return null;
      }
      const modelos = C.conversor.modelos(arquivos);
      if (!modelos.length) { LNUX.aviso("Não achei um modelo 3D nesses arquivos (" + C.conversor.FORMATOS.map((f) => "." + f[0]).join(", ") + ").", "alerta", 8000); return null; }
      let principal = modelos[0];
      if (modelos.length > 1) {
        const s = el("select", { class: "lnux-selecao", size: Math.min(10, modelos.length), style: { width: "100%" } }, modelos.map((m, i) => el("option", { value: m, selected: i === 0 }, `${m} (${LNUX.bytes(arquivos.get(m).size)})`)));
        const ok = await LNUX.dialogo({ titulo: "Qual modelo é o cenário?", largo: true, corpo: el("div", { class: "ajustes" },
          el("p", { class: "fraco", style: { margin: 0 } }, C.t("O pacote tem {n} modelos. Escolha o que é o mapa (em geral, o maior). Os outros (objetos soltos) não são colocados.", { n: modelos.length })), s),
          botoes: [{ rotulo: "Cancelar", valor: false }, { rotulo: "Converter", primario: true, valor: true }] });
        if (!ok) return null;
        principal = s.value || modelos[0];
      }
      const prog = LNUX.progresso("Convertendo para .glb");
      try {
        const r = await C.conversor.paraGLB(arquivos, principal, { aoProgresso: (f, t) => prog.definir(f, t) });
        return { ...r, nome: nome || LNUX.nomeSemExtensao(principal.split("/").pop()), origem: principal };
      } finally { prog.fechar(); }
    }
    const avisarConversao = (r) => {
      const partes = [C.t(r.triangulos ? "\"{nome}\" convertido {como}: {tamanho}, {n} triângulos." : "\"{nome}\" convertido {como}: {tamanho}.", { nome: r.nome, como: C.t(r.como), tamanho: LNUX.bytes(r.glb.size), n: (r.triangulos || 0).toLocaleString() })];
      LNUX.aviso(partes.concat(r.avisos).join(" "), r.avisos.length ? "alerta" : "ok", r.avisos.length ? 14000 : 6000);
    };
    async function importarMapa() {
      if (!exigirVRM()) return;
      const e = await escolherMapa("Abrir cenário: .blend, .glb, .gltf, .fbx, .obj, .dae, .stl, .ply, .3ds, .3mf, .usdz, ZIP ou .unitypackage");
      return e && receberMapa(e.entrada, e.nome);
    }
    /** Converte e usa como cenário (o mapa fica guardado em .glb). */
    async function receberMapa(entrada, nome) {
      const r = await converterEntrada(entrada, nome);
      if (!r) return;
      const arquivo = r.nome + ".glb";
      const reg = await C.mapas.guardar(r.nome, new Map([[arquivo, r.glb]]), arquivo);
      $carregando(true, "Abrindo o cenário...");
      try { await abrirMapaGuardado(reg.id, { avisar: false }); avisarConversao(r); }
      catch (e) { await C.mapas.apagar(reg.id); throw e; }
      finally { $carregando(false); }
      if (aberto && aberto.atualizar) aberto.atualizar();
    }
    /** Só converte: escolhe um mapa de qualquer formato e salva o .glb (sem usar como cenário). */
    async function converterMapa() {
      const e = await escolherMapa("Converter um mapa para .glb (Blender .blend, .fbx, .obj, .dae, .stl, .ply, .3ds, .3mf, .usdz, glTF, ZIP, .unitypackage)");
      if (!e) return null;
      const r = await converterEntrada(e.entrada, e.nome);
      if (!r) return null;
      avisarConversao(r);
      await LNUX.arquivos.salvar(r.glb, r.nome + ".glb", { titulo: "Salvar o mapa convertido (.glb)" });
      return r;
    }
    /** Salva num arquivo .glb o cenário que está aberto. */
    async function salvarMapa() {
      const m = palco().mundo;
      if (!m.info || !m.info.id) { LNUX.aviso("Abra um cenário primeiro.", "alerta"); return; }
      const arquivos = await C.mapas.ler(m.info.id);
      let glb = arquivos && arquivos.size === 1 && /\.glb$/i.test(m.info.principal) ? arquivos.get(m.info.principal) : null;
      if (!glb && arquivos) { const prog = LNUX.progresso("Convertendo para .glb"); try { glb = (await C.conversor.paraGLB(arquivos, m.info.principal, { aoProgresso: (f, t) => prog.definir(f, t) })).glb; } finally { prog.fechar(); } }
      if (glb) await LNUX.arquivos.salvar(glb, m.info.nome.replace(/[^\p{L}\p{N} _.-]+/gu, "") + ".glb", { titulo: "Salvar o cenário (.glb)" });
    }
    const $carregando = (sim, texto) => { const c = document.querySelector("#palco-carregando"); if (c) { c.textContent = texto || ""; c.hidden = !sim; } };
    async function painelCenario() {
      if (!exigirVRM()) return;
      const m = palco().mundo;
      const anda = botao("", () => alternarAndar());
      const mapas = el("select", { class: "lnux-selecao", "aria-label": "Cenário" });
      const ajustes = el("div", { class: "ajustes" });
      const voo = botao("", () => alternarVoo());
      const avisoSala = el("p", { class: "fraco pequeno aviso-sala-cenario", style: { margin: 0 }, hidden: true });
      const doDisco = el("div", { class: "linha" });
      // guarda o ajuste: no aparelho (os cenários guardados) e, numa sala de quem mexe, vai para todos
      // a luz: sol, céu, hora do dia, as luzes do mapa e a luz calculada por raios (js/luzes.js)
      const luz = C.painelDeLuz({ palco, mexe: () => { const n = ctx.naSala && ctx.naSala(); return !n || n.dono; }, salvarAjuste: () => salvarAjuste() });
      const salvarAjuste = LNUX.adiar(async () => {
        if (!m.info) return;
        const naSala = ctx.naSala && ctx.naSala();
        if (naSala && naSala.dono && naSala.mapa && ctx.ajusteDaSala) ctx.ajusteDaSala(m.info.ajuste);
        else if (m.info.id) await C.mapas.atualizar({ id: m.info.id, ajuste: m.info.ajuste });
      }, 400);
      const atualizar = async () => {
        luz.atualizar();
        anda.textContent = m.andando ? "Voltar ao retrato" : "Andar pelo cenário";
        anda.classList.toggle("primario", !m.andando);
        const naSala = ctx.naSala && ctx.naSala(), mexe = !naSala || naSala.dono;
        voo.textContent = m.voando ? "Parar de voar" : "Voar (atravessar as paredes)";
        voo.setAttribute("aria-pressed", String(!!m.voando));
        voo.disabled = !m.podeVoar();
        voo.title = m.podeVoar() ? "V liga e desliga · Espaço sobe · C desce · Shift vai mais rápido" : "Na sala, só quem criou pode voar.";
        avisoSala.hidden = !naSala;
        avisoSala.textContent = !naSala ? "" : naSala.dono
          ? "Você está na sua sala: o tamanho, o giro, a posição e o começo do cenário vão para todos. Para trocar o cenário, use Sala › Trocar o cenário da sala."
          : "Na sala, o cenário é o de quem criou: só essa pessoa muda o tamanho, a posição e o começo, e só ela pode voar.";
        mapas.disabled = !!naSala; // na sala, abrir outro cenário aqui só mudaria para mim
        for (const b of doDisco.querySelectorAll("button")) b.disabled = !!naSala;
        const l = await C.mapas.lista(), id = m.info ? m.info.id : "";
        mapas.replaceChildren(el("option", { value: "" }, naSala && m.info ? C.t("{nome} (o da sala)", { nome: m.info.nome }) : "Sem cenário (chão simples)"), ...l.map((x) => el("option", { value: x.id, selected: x.id === id }, `${x.nome} (${LNUX.bytes(x.tamanho)})`)));
        if (!m.info) { ajustes.replaceChildren(); return; }
        const a = m.info.ajuste;
        if (!Array.isArray(a.posicao)) a.posicao = [0, 0, 0];
        // a posição: o mapa anda e a personagem fica onde está (bom para encaixar o mapa em volta dela)
        const tam = m.caixa.getSize(new window.THREE.Vector3()), alcance = Math.max(10, Math.ceil(Math.max(tam.x, tam.y, tam.z) * 1.2));
        const eixo = (rotulo, i) => faixa(rotulo, -alcance, alcance, 0.05, a.posicao[i] || 0, (v) => { a.posicao[i] = v; m.aplicarAjuste(); salvarAjuste(); }, (v) => " " + (+v).toFixed(2) + " m");
        const tamanho = el("input", { class: "lnux-entrada", type: "number", min: 0.0001, step: "any", value: a.escala, "aria-label": "Tamanho do cenário" });
        tamanho.addEventListener("change", () => { a.escala = Math.max(1e-4, +tamanho.value || 1); m.aplicarAjuste(); a.partida = null; m.partida(); palco().enquadrar(); salvarAjuste(); });
        const vezes = (k) => botao(k < 1 ? "÷ 10" : "× 10", () => { tamanho.value = +(a.escala * k).toPrecision(4); tamanho.dispatchEvent(new Event("change")); }, "pequeno");
        ajustes.replaceChildren(
          el("div", { class: "linha" }, el("label", { class: "lnux-campo" }, el("span", {}, "Tamanho (1 = como veio)"), tamanho), vezes(0.1), vezes(10)),
          faixa("Girar o cenário", 0, 355, 5, a.giro || 0, (v) => { a.giro = v; m.aplicarAjuste(); salvarAjuste(); }, (v) => " " + v + "°"),
          marcar("O mapa veio deitado (Z para cima)", a.deitado, (v) => { a.deitado = v; a.partida = null; m.aplicarAjuste(); m.partida(); palco().enquadrar(); salvarAjuste(); }, "Arquivos de programas em que o Z aponta para cima (.stl, .ply, alguns .obj) aparecem deitados: marque para levantar."),
          el("details", { class: "posicao-mapa", open: !!(a.posicao[0] || a.posicao[1] || a.posicao[2]) }, el("summary", {}, "Posição do mapa"),
            el("div", { class: "ajustes", style: { marginTop: "8px" } },
              el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Move o mapa inteiro; a personagem fica onde está. Útil para encaixar o mapa em volta dela (depois, \"Começar aqui\")."),
              eixo("Para os lados (X)", 0), eixo("Para cima e para baixo (Y)", 1), eixo("Para a frente e para trás (Z)", 2),
              botao("Zerar a posição", () => { a.posicao = [0, 0, 0]; m.aplicarAjuste(); salvarAjuste(); atualizar(); }, "pequeno"))),
          el("div", { class: "linha" },
            botao("Começar aqui", () => { m.marcarPartida(); salvarAjuste(); LNUX.aviso("Ponto de partida guardado: é aqui que ela aparece neste cenário" + (naSala ? " (para todos da sala)." : "."), "ok"); }, "pequeno"),
            ((b) => { b.dataset.sempre = "1"; return b; })(botao("Voltar ao começo", () => m.partida(), "pequeno")),
            botao("Esquecer o começo", () => { a.partida = null; m.partida(); salvarAjuste(); }, "pequeno")));
        // quem só visita a sala vê o ajuste, mas não mexe ("Voltar ao começo" continua valendo)
        if (!mexe) for (const c of ajustes.querySelectorAll("input, button")) if (!c.dataset.sempre) c.disabled = true;
      };
      mapas.addEventListener("change", async () => { $carregando(true, "Abrindo o cenário..."); try { await abrirMapaGuardado(mapas.value); } catch (e) { LNUX.erro(e); } finally { $carregando(false); } atualizar(); });
      doDisco.append(botao("Abrir cenário...", importarMapa), botao("Salvar em .glb", salvarMapa),
        botao("Apagar este", async () => { if (!m.info || !m.info.id) return; const id = m.info.id; if (!(await LNUX.confirmar("Apagar cenário", C.t("Apagar \"{nome}\" deste navegador?", { nome: m.info.nome }), { rotulo: "Apagar", perigo: true }))) return; m.tirarMapa(); await C.mapas.apagar(id); gravarPref("mapa", ""); atualizar(); }));
      const corpo = el("div", { class: "ajustes" }, el("div", { class: "linha" }, anda, voo),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "W A S D ou as setas andam · Shift corre · Espaço pula · V voa (Espaço sobe, C desce) · arrastar gira a câmera · a rodinha aproxima. No celular aparece um direcional."),
        avisoSala,
        el("label", { class: "lnux-campo" }, el("span", {}, "Cenário"), mapas),
        doDisco,
        ajustes,
        luz,
        faixa("Velocidade ao andar", 0.5, 2.5, 0.1, m.cfg.velocidade, (v) => { m.cfg.velocidade = v; m.salvarCfg(); }, (v) => " " + v.toFixed(1) + "×"),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Abre e converte para .glb: " + C.conversor.FORMATOS.map((f) => "." + f[0]).join(", ") + ", ZIP e .unitypackage. O .blend é convertido pelo Blender do aparelho (com a ponte) ou, sem ele, pelo leitor próprio."),
        botao("Só converter um mapa para .glb...", converterMapa),
        el("details", {}, el("summary", {}, "Mapas do VRChat e do Unity"),
          el("p", { class: "fraco pequeno", style: { margin: "8px 0 0" } }, "Um mundo publicado do VRChat (.vrcw) é um pacote fechado do motor Unity e não abre fora dele. O que abre aqui: o cenário exportado em glTF/GLB " +
            "(no Unity, com o UnityGLTF ou \"Export GLB\"), o arquivo .blend do Blender, modelos .fbx, .obj e .dae, um ZIP com o modelo e as texturas, ou o .unitypackage do mundo — o WEBC abre o pacote, " +
            "lista os modelos de dentro e converte para .glb (as peças soltas de uma cena montada no Unity não são reposicionadas). Use só mapas que você tem o direito de usar.")));
      painel("cenario", "Cenário", corpo, { atualizar });
      atualizar();
    }

    // ── Ajustar esqueleto ───────────────────────────────────────────
    function painelEsqueleto() {
      if (!exigirVRM()) return;
      const p = palco(), a = ctx.atual();
      const ajuste = JSON.parse(JSON.stringify(p.ajuste));
      const aplicar = () => { p.definirAjuste(ajuste); a.esqueleto = JSON.parse(JSON.stringify(ajuste)); ctx.salvar(); };
      const ossos = C.OSSOS_VRM.filter((n) => p.nos[n]);
      let osso = "leftUpperArm", espelhar = true;
      const eixos = ["X", "Y", "Z"].map((eixo, i) => faixa(eixo, -90, 90, 1, 0, (v) => {
        const r = (ajuste.ossos[osso] = ajuste.ossos[osso] || [0, 0, 0]);
        r[i] = v;
        const par = C.ossoEspelhado(osso);
        if (espelhar && par !== osso && p.nos[par]) ajuste.ossos[par] = [r[0], -r[1], -r[2]]; // o outro lado é o espelho
        aplicar();
      }, (v) => " " + v + "°"));
      const rotular = () => {
        const braco = /Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Little/.test(osso), pe = /Foot|Toes/.test(osso);
        const nomes = braco ? ["Torcer (X)", "Para a frente / trás (Y)", "Para cima / baixo (Z)"] : pe ? ["Ponta para cima / baixo (X)", "Virar para dentro / fora (Y)", "Tombar de lado (Z)"]
          : ["Inclinar para a frente / trás (X)", "Girar (Y)", "Inclinar para os lados (Z)"];
        const r = ajuste.ossos[osso] || [0, 0, 0];
        eixos.forEach((f, i) => { f.querySelector("span").firstChild.textContent = nomes[i]; f.definir(r[i] || 0); });
        p.destacarOsso(osso);
      };
      const seletor = el("select", { class: "lnux-selecao", "aria-label": "Osso" }, ossos.map((n) => el("option", { value: n, selected: n === osso }, C.nomeDoOsso(n))));
      seletor.addEventListener("change", () => { osso = seletor.value; rotular(); });
      const proporcao = (rotulo, k) => faixa(rotulo, 0.5, 1.6, 0.01, ajuste.escala[k], (v) => { ajuste.escala[k] = v; aplicar(); }, (v) => " " + Math.round(v * 100) + "%");
      const bracos = faixa("Braços em descanso (0° = abertos em T, 90° = colados no corpo)", 0, 90, 1, ajuste.bracos, (v) => { ajuste.bracos = v; aplicar(); }, (v) => " " + v + "°");
      const corpo = el("div", { class: "ajustes" },
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Corrige o esqueleto desta personagem. Vale para tudo: a pose parada, os pacotes de movimento e a captura pela câmera. Fica guardado com ela."),
        bracos,
        el("details", { open: true }, el("summary", {}, "Proporções"), el("div", { class: "ajustes", style: { marginTop: "8px" } },
          proporcao("Altura (a personagem inteira)", "geral"), proporcao("Cabeça", "cabeca"), proporcao("Braços", "bracos"), proporcao("Mãos", "maos"), proporcao("Pernas", "pernas"))),
        el("details", { open: true }, el("summary", {}, "Correção por osso"), el("div", { class: "ajustes", style: { marginTop: "8px" } },
          el("label", { class: "lnux-campo" }, el("span", {}, "Osso"), seletor), ...eixos,
          marcar("Espelhar no outro lado", espelhar, (v) => { espelhar = v; }),
          el("div", { class: "linha" }, botao("Zerar este osso", () => { delete ajuste.ossos[osso]; const par = C.ossoEspelhado(osso); if (espelhar && par !== osso) delete ajuste.ossos[par]; aplicar(); rotular(); }, "pequeno"),
            botao("Zerar tudo", async () => { if (!(await LNUX.confirmar("Zerar o ajuste", "Voltar o esqueleto ao que veio no modelo (braços, proporções e todos os ossos)?", { rotulo: "Zerar" }))) return;
              Object.assign(ajuste, C.ajustePadrao()); aplicar(); fechar(); painelEsqueleto(); }, "pequeno")))),
        marcar("Mostrar o esqueleto", true, (v) => { p.mostrarEsqueleto(v); if (v) p.destacarOsso(osso); }));
      p.mostrarEsqueleto(true);
      painel("esqueleto", "Ajustar esqueleto", corpo, { aoFechar: () => p.mostrarEsqueleto(false) });
      rotular();
    }

    // ── para a tela ─────────────────────────────────────────────────
    /** Quando uma personagem VRoid abre: o cenário e os movimentos de andar que estavam em uso voltam. */
    async function aoAbrirPersonagem() {
      fechar();
      if (!ehVRM()) return;
      const p = palco(), id = pref("mapa", "");
      try {
        if (id && !(p.mundo.info && p.mundo.info.id === id)) await abrirMapaGuardado(id, { avisar: false });
        await aplicarAndar();
      } catch (e) { console.warn("cenário", e); }
    }
    const itensDoMenu = () => [
      { rotulo: "Captura de movimento (câmera)...", acao: painelCaptura, ativo: ehVRM },
      { rotulo: "Câmera ligada", marcado: () => captura.ligada, acao: () => alternarCaptura(), ativo: ehVRM },
      "-",
      { rotulo: "Pacotes de movimento...", acao: painelMovimentos, ativo: ehVRM },
      { rotulo: "Parar o movimento", acao: parar, ativo: () => ehVRM() && palco().anim.tocando },
      "-",
      { rotulo: "Andar pelo cenário (W A S D)", marcado: () => ehVRM() && palco().mundo.andando, acao: () => alternarAndar(), ativo: ehVRM },
      { rotulo: "Voar, atravessando as paredes (V)", marcado: () => ehVRM() && palco().mundo.voando, acao: () => alternarVoo(), ativo: () => ehVRM() && palco().mundo.podeVoar() },
      { rotulo: "Cenário (mapa)...", acao: painelCenario, ativo: ehVRM },
      { rotulo: "Converter mapa para .glb...", acao: () => converterMapa().catch(LNUX.erro) },
      "-",
      { rotulo: "Ajustar esqueleto...", acao: painelEsqueleto, ativo: ehVRM },
    ];
    return { painelCaptura, painelMovimentos, painelCenario, painelEsqueleto, alternarCaptura, alternarAndar, alternarVoo, tocar, parar, importarMovimentos, receberMovimentos, importarMapa, receberMapa, converterMapa, salvarMapa,
      abrirMapaGuardado, aplicarAndar, aoAbrirPersonagem, itensDoMenu, fechar, atualizar: () => { if (aberto && aberto.atualizar) aberto.atualizar(); }, get aberto() { return aberto && aberto.id; } };
  };
})();
