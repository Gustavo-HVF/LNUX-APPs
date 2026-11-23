/*
 * WEBC — a mochila: o item que a personagem leva na mão (ou na cabeça, nas costas...) dentro do jogo.
 *
 *   - segurar(id): abre o item guardado (js/itens.js), aplica o ajuste de encaixe que a pessoa fez (se fez) e prende
 *     no osso; guardar() tira. E usa (segurando, o lançador dispara sem parar); G esconde e mostra.
 *   - A mira: com um lançador na mão aparece a mira no meio da tela, e o tiro vai para onde a câmera aponta (o ponto
 *     do cenário que a câmera vê no meio da tela).
 *   - paraSala(): o que vai no estado da sala (na mão ou não, o ajuste, as luzes ligadas, os usos com a mira).
 *
 * C.poseDeSegurar(pose, osso, mirar): a mão fechada em volta do cabo e, depois de um disparo, o braço para a frente.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const arred = (v) => Math.round(v * 1000) / 1000;
  const reduzir = () => "reduzir" in document.documentElement.dataset || !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  let _q = null, _e = null;
  /** A mão que segura (os dedos dobrados) e, com mirar > 0, o braço apontando para a frente. */
  C.poseDeSegurar = function (pose, osso, mirar = 0) {
    if (osso !== "rightHand" && osso !== "leftHand") return;
    const T = window.THREE;
    _q = _q || new T.Quaternion();
    _e = _e || new T.Euler();
    const lado = osso === "rightHand" ? "right" : "left", s = lado === "right" ? 1 : -1;
    const dobrar = (n, x, y, z) => { if (pose[n]) pose[n].multiply(_q.setFromEuler(_e.set(x, y, z))); };
    for (const dedo of ["Index", "Middle", "Ring", "Little"]) {
      dobrar(lado + dedo + "Proximal", 0, 0, s * 1.0);
      dobrar(lado + dedo + "Intermediate", 0, 0, s * 1.2);
      dobrar(lado + dedo + "Distal", 0, 0, s * 0.8);
    }
    dobrar(lado + "ThumbMetacarpal", 0, -s * 0.35, 0);
    dobrar(lado + "ThumbProximal", 0, -s * 0.5, s * 0.2);
    dobrar(lado + "ThumbDistal", 0, 0, s * 0.4);
    if (mirar > 0.001) {
      // o braço para a frente (no T, o braço direito aponta para -X; girar 90° em Y leva para +Z)
      const braco = _q.setFromEuler(_e.set(0, s * Math.PI / 2, 0)).clone();
      if (pose[lado + "UpperArm"]) pose[lado + "UpperArm"].slerp(braco, mirar);
      if (pose[lado + "LowerArm"]) pose[lado + "LowerArm"].slerp(new T.Quaternion(), mirar);
      if (pose[lado + "Hand"]) pose[lado + "Hand"].slerp(new T.Quaternion(), mirar);
    }
  };

  /**
   * ctx: {palco() (o palco 3D), jogando() (se está no modo de jogar, dentro do jogo), aoMudar()}.
   */
  C.Mochila = function (ctx) {
    let naMao = null;   // {reg, chave, blob, vivo}
    let usos = 0, mira = null, segurando = false, visivel = true, mirarAte = 0, abrindo = null;
    const elMira = el("div", { class: "mira-item", hidden: true, "aria-hidden": "true" });
    document.body.append(elMira);

    const chaveDe = (reg) => (reg.loja ? "loja:" + reg.loja : reg.id);
    function ctxDoItem() {
      const p = ctx.palco();
      return { cena: p.cena, colisor: () => p.mundo && p.mundo.colisor, outros: () => (p.mundo && p.mundo.outros ? p.mundo.outros() : []), reduzir: reduzir() };
    }
    /** Põe um item guardado na mão (ou onde o encaixe mandar). */
    async function segurar(id) {
      const p = ctx.palco();
      if (!p || !p.vrm) throw new Error(C.t("Abra uma personagem VRoid (.vrm) para segurar itens."));
      const reg = (await C.itens.lista()).find((x) => x.id === id);
      const blob = reg && (await C.itens.ler(id));
      if (!blob) throw new Error(C.t("Esse item não está mais guardado."));
      const minha = (abrindo = {});
      const { def, malhas, animacoes } = await C.abrirItem(blob);
      if (abrindo !== minha) return null;
      const aj = C.itens.ajuste(chaveDe(reg));
      if (aj) def.encaixe = C.limparItem({ encaixe: aj }).encaixe;
      guardar(false);
      const vivo = new C.ItemVivo(def, malhas, animacoes, ctxDoItem());
      naMao = { reg, chave: chaveDe(reg), blob, vivo };
      visivel = true;
      encaixar();
      try { localStorage.setItem("webc.item.mao", id); } catch (e) { /* sem armazenamento */ }
      ctx.aoMudar();
      return naMao;
    }
    function encaixar() {
      const p = ctx.palco();
      if (!naMao || !p || !p.vrm) return;
      C.encaixarItem(naMao.vivo, p.nos, !!p.v0);
      naMao.osso = p.nos;
      p.segurando = visivel ? naMao.vivo.encaixe.osso : null;
    }
    /** Tira o item da mão. */
    function guardar(avisar = true) {
      const p = ctx.palco();
      if (naMao) { naMao.vivo.descartar(); C.desencaixarItem(naMao.vivo); }
      naMao = null;
      segurando = false;
      if (p) p.segurando = null;
      elMira.hidden = true;
      if (avisar) { try { localStorage.removeItem("webc.item.mao"); } catch (e) { /* sem armazenamento */ } ctx.aoMudar(); }
    }
    /** G: esconde e mostra o item (sem tirar da mochila). */
    function alternarVisivel() {
      if (!naMao) return false;
      visivel = !visivel;
      naMao.vivo.raiz.visible = visivel;
      if (!visivel) { naMao.vivo.soltarUso(); segurando = false; }
      const p = ctx.palco();
      if (p) p.segurando = visivel ? naMao.vivo.encaixe.osso : null;
      ctx.aoMudar();
      return visivel;
    }
    /** Para onde a câmera aponta (o meio da tela): o primeiro ponto do cenário, ou um ponto longe. */
    function pontoDaMira() {
      const T = window.THREE, p = ctx.palco(), cam = p.camera;
      const raio = new T.Ray(cam.getWorldPosition(new T.Vector3()), new T.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new T.Quaternion())));
      const colisor = p.mundo && p.mundo.colisor;
      const toque = colisor ? colisor.geometry.boundsTree.raycastFirst(raio, T.DoubleSide) : null;
      return toque && toque.distance < 120 ? toque.point.clone() : raio.at(40, new T.Vector3());
    }
    /** E: usar (luzes, rajadas, animações, disparos). */
    function usar() {
      if (!naMao || !visivel) return false;
      const vivo = naMao.vivo;
      mira = vivo.temLancador ? pontoDaMira() : null;
      vivo.usar(mira);
      usos++;
      segurando = true;
      if (vivo.temLancador) mirarAte = performance.now() + 900;
      ctx.aoMudar(true);
      return true;
    }
    function soltar() { if (naMao) naMao.vivo.soltarUso(); segurando = false; }

    /** A cada quadro: o item anda, a mira acompanha a câmera e o braço aponta depois de atirar. */
    function quadro(dt) {
      const p = ctx.palco();
      if (!naMao || !p) { elMira.hidden = true; return; }
      if (p.vrm && naMao.vivo.base && !estaNoCorpo(naMao.vivo.base, p.vrm.scene)) encaixar(); // trocou de personagem (ou de roupa)
      if (segurando && naMao.vivo.temLancador) { mira = pontoDaMira(); naMao.vivo.mira = mira; }
      naMao.vivo.atualizar(dt);
      p.mirarItem = Math.max(0, Math.min(1, (mirarAte - performance.now()) / 300));
      elMira.hidden = !(naMao.vivo.temLancador && visivel && ctx.jogando() && p.mundo && p.mundo.andando);
    }
    const estaNoCorpo = (o, cena) => { for (let x = o; x; x = x.parent) if (x === cena) return true; return false; };

    /** O que vai para a sala (no estado de cada troca). */
    function paraSala() {
      if (!naMao) return null;
      const vivo = naMao.vivo, e = vivo.encaixe;
      return { on: visivel ? 1 : 0, aj: { osso: e.osso, pos: e.pos.map(arred), rot: e.rot.map(arred), escala: arred(e.escala) }, lz: vivo.luzesLigadas, u: [usos, ...(mira ? [arred(mira.x), arred(mira.y), arred(mira.z)] : [])], s: segurando ? 1 : 0 };
    }
    /** Troca o encaixe do item que está na mão (o ajuste da pessoa acabou de mudar). */
    function aplicarAjuste(encaixe) { if (naMao) { naMao.vivo.aplicarEncaixe(encaixe); encaixar(); ctx.aoMudar(); } }

    return {
      segurar, guardar, alternarVisivel, usar, soltar, quadro, paraSala, aplicarAjuste,
      get naMao() { return naMao; }, get visivel() { return visivel; }, get blob() { return naMao ? naMao.blob : null; },
      /** O item que estava na mão da última vez (para voltar com ele). */
      ultimo() { try { return localStorage.getItem("webc.item.mao"); } catch (e) { return null; } },
    };
  };
})();
