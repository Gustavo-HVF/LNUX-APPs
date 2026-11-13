/*
 * Companhia — vídeo numa tela dentro do cenário: um link do YouTube, Vimeo, Twitch ou de um arquivo de vídeo (.mp4,
 * .webm) vira uma tela em 3D na frente da personagem. A tela segue a personagem (fica sempre na frente dela) ou fica
 * parada no lugar. Numa sala, todos veem a tela de cada um, no mesmo lugar e no mesmo pedaço do vídeo.
 *
 * Como aparece: os sites de vídeo só deixam tocar pelo player deles (um <iframe>), e o que passa num <iframe> de
 * outro site não pode virar textura do WebGL. Então a tela é o próprio player numa camada logo atrás do palco, posta
 * em 3D com transformações do CSS que acompanham a câmera (como o CSS3DRenderer do three.js, MIT). Na cena, no lugar
 * da tela, há um "furo": um retângulo que pinta transparente onde ele aparece. Quem estiver na frente da tela (uma
 * personagem, uma parede) é desenhado por cima, e o player só aparece pelo furo. Atrás, uma moldura de verdade.
 * Com o mouse em cima da tela, os cliques vão para o player (no celular, o toque seguinte, por 5 segundos).
 *
 * O relógio: o servidor da sala guarda quando o vídeo começou (ou onde parou); cada um calcula "agora está no
 * segundo tal" com o relógio do servidor. Pausar, continuar e pular passam pelo servidor; o player de cada um vai
 * para o mesmo ponto (no YouTube e no Vimeo, pelos comandos do próprio player; no arquivo, direto no <video>).
 * Fora de uma sala, o mesmo vale só para mim, sem servidor. O som diminui com a distância (menos o da minha tela
 * que me segue); dá para silenciar ou esconder as telas dos outros.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const LARG = 960, ALT = 540; // o tamanho do player em pixels (a tela em 3D é ele em escala)
  const TAMANHOS = [[1.2, "Pequena"], [2, "Média"], [3.2, "Grande"], [5, "Cinema"], [8, "Telão"]];
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const pref = (k, padrao) => LNUX.preferencia.ler("companhia.video." + k, padrao);
  const gravarPref = (k, v) => LNUX.preferencia.gravar("companhia.video." + k, String(v));

  // ── Links ────────────────────────────────────────────────────────────

  /** "90", "90s", "1m30s", "1h2m3s" → segundos. */
  function tempoDoLink(v) {
    if (!v) return 0;
    if (/^\d+(\.\d+)?$/.test(v)) return +v;
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }
  /**
   * O que é o link: {tipo: youtube | vimeo | twitch | arquivo, ..., em (segundo de início), site} ou null (não serve).
   * Só os sites conhecidos viram um player (montado aqui a partir do código do vídeo, nunca o link cru num <iframe>).
   */
  function interpretar(texto) {
    let u;
    try { u = new URL(String(texto || "").trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    const partes = u.pathname.split("/").filter(Boolean);
    if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
      const ID = /^[A-Za-z0-9_-]{11}$/;
      let id = host === "youtu.be" ? partes[0] : partes[0] === "watch" ? u.searchParams.get("v") : ["embed", "shorts", "live", "v"].includes(partes[0]) ? partes[1] : null;
      if (!ID.test(id || "")) id = null;
      const lista = /^[A-Za-z0-9_-]{10,64}$/.test(u.searchParams.get("list") || "") ? u.searchParams.get("list") : null;
      if (!id && !lista) return null;
      return { tipo: "youtube", id, lista, em: tempoDoLink(u.searchParams.get("t") || u.searchParams.get("start")), site: "YouTube" };
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const m = /(?:^|\/)(\d{5,12})(?:\/([0-9a-f]{6,20}))?\/?$/.exec(u.pathname);
      if (!m) return null;
      return { tipo: "vimeo", id: m[1], h: m[2] || (/^[0-9a-f]{6,20}$/.test(u.searchParams.get("h") || "") ? u.searchParams.get("h") : null), em: tempoDoLink((u.hash.match(/t=([\dhms.]+)/) || [])[1]), site: "Vimeo" };
    }
    if (host === "twitch.tv" || host === "player.twitch.tv") {
      if (partes[0] === "videos" && /^\d{5,14}$/.test(partes[1] || "")) return { tipo: "twitch", video: partes[1], em: tempoDoLink(u.searchParams.get("t")), site: "Twitch" };
      const canal = host === "player.twitch.tv" ? u.searchParams.get("channel") : partes.length === 1 ? partes[0] : null;
      if (canal && /^[A-Za-z0-9_]{3,25}$/.test(canal)) return { tipo: "twitch", canal: canal.toLowerCase(), em: 0, site: "Twitch", aoVivo: true };
      return null;
    }
    if (/\.(mp4|webm|ogv|ogg|m4v|mov)$/i.test(u.pathname)) return { tipo: "arquivo", url: u.href, em: tempoDoLink((u.hash.match(/t=([\d.]+)/) || [])[1]), site: u.hostname };
    return null;
  }
  /** O endereço do player do site, começando no segundo t. */
  function endereco(d, t, { mudo = false } = {}) {
    const s = Math.max(0, Math.floor(t));
    if (d.tipo === "youtube") {
      const q = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0", enablejsapi: "1", origin: location.origin, start: String(s) });
      if (mudo) q.set("mute", "1");
      if (d.lista) q.set("list", d.lista);
      return `https://www.youtube-nocookie.com/embed/${d.id || "videoseries"}?${q}`;
    }
    if (d.tipo === "vimeo") {
      const q = new URLSearchParams({ autoplay: "1", playsinline: "1" });
      if (d.h) q.set("h", d.h);
      if (mudo) q.set("muted", "1");
      return `https://player.vimeo.com/video/${d.id}?${q}#t=${s}s`;
    }
    if (d.tipo === "twitch") {
      const q = new URLSearchParams({ parent: location.hostname, autoplay: "true", muted: mudo ? "true" : "false" });
      if (d.video) { q.set("video", "v" + d.video); q.set("time", `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m${s % 60}s`); } else q.set("channel", d.canal);
      return `https://player.twitch.tv/?${q}`;
    }
    return d.url;
  }

  // ── A camada em 3D (CSS) por cima do palco ───────────────────────────

  const n = (v) => (Math.abs(v) < 1e-10 ? 0 : +v.toFixed(6));
  class Camada {
    constructor(conteiner) {
      this.el = el("div", { class: "camada-telas" });
      this.vista = el("div", { class: "camada-telas-vista" });
      this.cam = el("div", { class: "camada-telas-cam" });
      this.vista.append(this.cam);
      this.el.append(this.vista);
      conteiner.append(this.el);
      this._m = new window.THREE.Matrix4();
      this._e = new window.THREE.Matrix4();
    }
    /** Põe a câmera do CSS igual à do palco e cada tela no lugar dela. */
    desenhar(camera, telas) {
      const W = this.el.clientWidth, H = this.el.clientHeight;
      if (!W || !H) return;
      camera.updateMatrixWorld();
      const fov = camera.projectionMatrix.elements[5] * H / 2, v = camera.view && camera.view.enabled ? camera.view : null;
      this.vista.style.transform = v ? `translate(${-v.offsetX * (W / v.width)}px, ${-v.offsetY * (H / v.height)}px) scale(${v.fullWidth / v.width}, ${v.fullHeight / v.height})` : "";
      const e = camera.matrixWorldInverse.elements, escala = v ? v.height / v.fullHeight : 1;
      // a origem no meio da tela; o ponto do mundo (vista da câmera, com o Y para baixo) a "fov" pixels de distância
      this.cam.style.transform = `translate(${W / 2}px, ${H / 2}px) perspective(${fov}px) scale(${escala}) translateZ(${fov}px) matrix3d(${[e[0], -e[1], e[2], e[3], e[4], -e[5], e[6], e[7], e[8], -e[9], e[10], e[11], e[12], -e[13], e[14], e[15]].map(n).join(",")})`;
      for (const t of telas) {
        if (!t.visivel) continue;
        const s = t.largura / LARG, m = this._m.copy(t.ancora.matrixWorld).multiply(this._e.makeScale(s, s, s)).elements;
        t.el.style.transform = `translate(-50%, -50%) matrix3d(${[m[0], m[1], m[2], m[3], -m[4], -m[5], -m[6], -m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15]].map(n).join(",")})`;
      }
    }
    descartar() { this.el.remove(); }
  }

  // ── Uma tela ─────────────────────────────────────────────────────────

  class Tela {
    constructor(chave, camada, cena) {
      const T = window.THREE;
      this.chave = chave;
      this.estado = null;
      this.desc = null;
      this.midia = null;
      this.visivel = false;
      this.volume = -1;
      this.largura = 2;
      this.ancora = new T.Object3D();
      this.moldura = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0x14161c, roughness: 0.55, metalness: 0.2 }));
      this.moldura.position.z = -0.035;
      // o furo: pinta (0, 0, 0, 0) onde a tela aparece, e o player (atrás do palco) aparece por ali
      this.furo = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({ vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(0.0); }", blending: T.NoBlending }));
      this.furo.userData.tela = chave;
      this.placa = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      this.ancora.add(this.moldura, this.furo, this.placa);
      cena.add(this.ancora);
      this.caixa = el("div", { class: "tela-midia" });
      this.el = el("div", { class: "tela-video", style: { width: LARG + "px", height: ALT + "px", visibility: "hidden" }, dataset: { tela: chave } }, this.caixa);
      camada.cam.append(this.el);
      this.primeira = true;
      this.alvo = new T.Vector3();
      this.rumo = 0;
      this._v = new T.Vector3();
      this._n = new T.Vector3();
    }
    /** O nome em cima da tela (de quem é e de que site), numa plaquinha da cena. */
    escreverPlaca(texto, alto) {
      if (texto === this.textoPlaca && this.placa.material.map) { this.placa.position.set(-this.largura / 2 + this.placa.scale.x / 2, alto / 2 + 0.16, 0); return; }
      this.textoPlaca = texto;
      const tela = document.createElement("canvas"), g = tela.getContext("2d");
      g.font = "600 34px system-ui, sans-serif";
      const w = Math.min(1024, Math.ceil(g.measureText(texto).width) + 44);
      tela.width = w;
      tela.height = 56;
      g.font = "600 34px system-ui, sans-serif";
      g.fillStyle = "rgba(10, 12, 18, .8)";
      g.beginPath();
      g.roundRect ? g.roundRect(0, 0, w, 56, 28) : g.rect(0, 0, w, 56);
      g.fill();
      g.fillStyle = "#fff";
      g.textBaseline = "middle";
      g.fillText(texto, 22, 29);
      if (this.placa.material.map) this.placa.material.map.dispose();
      const tex = new window.THREE.CanvasTexture(tela);
      tex.colorSpace = window.THREE.SRGBColorSpace;
      this.placa.material.map = tex;
      this.placa.material.needsUpdate = true;
      const h = 0.2;
      this.placa.scale.set(h * w / 56, h, 1);
      this.placa.position.set(-this.largura / 2 + this.placa.scale.x / 2, alto / 2 + 0.16, 0);
    }
    /** O segundo do vídeo agora, pelo relógio do servidor (ou o meu, fora da sala). */
    tempo() {
      const e = this.estado;
      return e.pausado !== null && e.pausado !== undefined ? e.pausado : Math.max(0, Date.now() / 1000 + (e.desvio || 0) - e.inicio);
    }
    aplicar(e, { nome, mudo }) {
      const antes = this.estado;
      this.estado = e;
      this.mudo = mudo;
      this.largura = limitar(+e.tamanho || 2, 0.5, 12);
      const alto = this.largura * ALT / LARG;
      this.moldura.scale.set(this.largura + 0.08, alto + 0.08, 0.05);
      this.furo.scale.set(this.largura, alto, 1);
      const desc = interpretar(e.url);
      this.escreverPlaca(`📺 ${nome}${desc ? " · " + desc.site : ""}`, alto);
      if (!desc) { this.desc = null; this.midia = null; this.caixa.replaceChildren(el("p", { class: "tela-aviso" }, "Este link não abre aqui.")); return; }
      if (!antes || antes.url !== e.url || !this.midia) this.montar(desc);
      else if (antes.pausado !== e.pausado || Math.abs((antes.inicio || 0) - (e.inicio || 0)) > 0.5) this.sincronizar();
    }
    montar(desc) {
      this.desc = desc;
      this.volume = -1;
      if (desc.tipo === "arquivo") {
        const v = el("video", { src: desc.url, playsinline: true, controls: true, preload: "auto" });
        v.muted = !!this.mudo;
        v.addEventListener("loadedmetadata", () => this.sincronizar());
        this.midia = v;
      } else {
        const f = el("iframe", { src: endereco(desc, this.tempo(), { mudo: this.mudo }), title: "Vídeo: " + desc.site, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
          allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" });
        // o player só ouve os comandos depois de carregar: aí vai para o ponto certo (se estiver pausado) e pega o volume
        f.addEventListener("load", () => setTimeout(() => { this.volume = -1; if (this.estado && this.estado.pausado !== null && this.estado.pausado !== undefined) this.sincronizar(); }, 900));
        this.midia = f;
      }
      this.caixa.replaceChildren(this.midia);
    }
    /** Os comandos do player do site: tocar, pausar, ir (segundo), volume (0 a 100). */
    comandar(func, valor) {
      const d = this.desc, f = this.midia;
      if (!d || !f) return;
      if (d.tipo === "arquivo") {
        if (func === "tocar") f.play().catch(() => {});
        else if (func === "pausar") f.pause();
        else if (func === "ir" && Math.abs(f.currentTime - valor) > 1) { try { f.currentTime = valor; } catch (e) { /* ainda sem duração */ } }
        else if (func === "volume") { f.volume = limitar(valor / 100, 0, 1); f.muted = valor <= 0; }
        return;
      }
      const w = f.contentWindow;
      if (!w) return;
      if (d.tipo === "youtube") {
        const manda = (fn, args = []) => w.postMessage(JSON.stringify({ event: "command", func: fn, args }), "https://www.youtube-nocookie.com");
        if (func === "volume") { manda(valor > 0 ? "unMute" : "mute"); manda("setVolume", [Math.round(valor)]); return; }
        const c = { tocar: ["playVideo", []], pausar: ["pauseVideo", []], ir: ["seekTo", [valor, true]] }[func];
        if (c) manda(c[0], c[1]);
      } else if (d.tipo === "vimeo") {
        const manda = (c) => w.postMessage(JSON.stringify(c), "https://player.vimeo.com");
        if (func === "volume") { manda({ method: "setMuted", value: valor <= 0 }); manda({ method: "setVolume", value: limitar(valor / 100, 0, 1) }); return; }
        const c = { tocar: { method: "play" }, pausar: { method: "pause" }, ir: { method: "setCurrentTime", value: valor } }[func];
        if (c) manda(c);
      } // Twitch: sem comandos de fora (o tempo vai no endereço)
    }
    /** O player vai para o ponto do relógio (e pausa ou toca, como estiver). */
    sincronizar() {
      if (!this.desc || this.desc.aoVivo || !this.estado) return;
      const e = this.estado, t = this.tempo();
      if (this.desc.tipo === "twitch") { this.montar(this.desc); return; }
      this.comandar("ir", t);
      this.comandar(e.pausado !== null && e.pausado !== undefined ? "pausar" : "tocar");
    }
    /** Onde a tela fica neste quadro: alvo = {pos, rumo} (já calculado); suave quando segue a personagem. */
    mover(dt, pos, rumo, suave) {
      const a = this.ancora;
      if (this.primeira || !suave) { a.position.copy(pos); this.rumo = rumo; this.primeira = false; }
      else {
        a.position.lerp(pos, 1 - Math.exp(-dt * 3.5));
        let d = rumo - this.rumo;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.rumo += d * (1 - Math.exp(-dt * 2.5));
      }
      a.rotation.set(0, this.rumo, 0);
      a.updateMatrixWorld(true);
    }
    /** O player aparece só com a tela de frente e inteira na frente da câmera (quem está na frente dela, o furo resolve). */
    conferir(camera, mostrar) {
      const a = this.ancora;
      let ver = mostrar && !!this.estado;
      this.moldura.visible = this.placa.visible = mostrar;
      if (ver) {
        const paraCam = this._v.copy(camera.position).sub(a.position);
        const frente = this._n.set(0, 0, 1).applyQuaternion(a.quaternion);
        if (frente.dot(paraCam) <= 0) ver = false; // de costas: só a moldura
      }
      if (ver) {
        // os quatro cantos na frente da câmera (um canto atrás dela deixaria a tela torta no CSS)
        const w = this.largura / 2, h = this.largura * ALT / LARG / 2;
        for (const [x, y] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
          const p = this._v.set(x, y, 0).applyMatrix4(a.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
          if (p.z > -camera.near * 2) { ver = false; break; }
        }
      }
      this.furo.visible = ver;
      if (ver !== this.visivel) { this.visivel = ver; this.el.style.visibility = ver ? "visible" : "hidden"; }
    }
    /** O volume (0 a 100), só quando muda bastante (os comandos vão por mensagem para o player). */
    definirVolume(v) {
      v = Math.round(limitar(v, 0, 100));
      if (Math.abs(v - this.volume) < 4 && !(v === 0 && this.volume !== 0)) return;
      this.volume = v;
      this.comandar("volume", v);
    }
    descartar() {
      this.el.remove();
      this.ancora.parent && this.ancora.parent.remove(this.ancora);
      for (const o of [this.moldura, this.furo, this.placa]) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
  }

  // ── As telas de todos e os controles da minha ───────────────────────

  class Videos {
    /** sala: () => a Sala (js/sala.js) ou null; area: onde vai a barra de controles. */
    constructor({ sala, area }) {
      this.sala = sala;
      this.area = area;
      this.palco = null;
      this.camada = null;
      this.telas = new Map();      // "eu" ou o id da pessoa → Tela
      this.meu = null;             // o meu vídeo: {url, modo, pos, rumo, tamanho, inicio, pausado, n, desvio, daSala}
      this.mudo = pref("mudo", "0") === "1";
      this.verOutros = pref("ver-outros", "1") === "1";
      this.somOutros = pref("som-outros", "1") === "1";
      this._v = null;
    }
    ligar(palco) {
      if (this.palco === palco || !palco) return;
      const T = window.THREE;
      this.palco = palco;
      this.camada = new Camada(palco.conteiner);
      this._v = new T.Vector3();
      palco.on("quadro", (dt) => { try { this.quadro(dt); } catch (e) { console.error(e); } });
      // o player fica atrás do palco: com o mouse em cima de uma tela, o palco deixa os cliques passarem para ele
      const c = palco.conteiner, raio = new T.Raycaster(), ponto = new T.Vector2();
      const sobreTela = (e) => {
        const furos = [...this.telas.values()].filter((t) => t.visivel).map((t) => t.furo);
        if (!furos.length) return false;
        const r = c.getBoundingClientRect();
        ponto.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raio.setFromCamera(ponto, palco.camera);
        return raio.intersectObjects(furos, false).length > 0;
      };
      c.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && !e.buttons) this.passar(sobreTela(e)); });
      c.addEventListener("pointerleave", () => { if (!this.tPassar) this.passar(false); });
      c.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" || !sobreTela(e)) return;
        this.passar(true); // no celular: o próximo toque vai para o player
        clearTimeout(this.tPassar);
        this.tPassar = setTimeout(() => { this.tPassar = null; this.passar(false); }, 5000);
      });
    }
    passar(sim) {
      if (this.passando === sim || !this.palco) return;
      this.passando = sim;
      this.palco.view.style.pointerEvents = sim ? "none" : "";
    }
    /** O palco 3D some (abriu uma personagem Live2D): as telas somem junto (e o som para). */
    mostrar(sim) {
      if (this.camada) this.camada.el.hidden = !sim;
      if (!sim) { for (const t of this.telas.values()) t.descartar(); this.telas.clear(); }
    }
    naSala() { const s = this.sala(); return s && s.dentro ? s : null; }
    podePor() { const s = this.naSala(); return !s || !s.info || s.info.videos !== "dono" || !!s.chave; }

    // ── o meu vídeo: abrir, mexer, fechar ──
    async pedir(acao, dados = {}) {
      const s = this.naSala();
      let r;
      if (s) {
        r = await s.mandarVideo(acao, dados);
        r = r.video === null ? null : { ...r, desvio: r.agora - Date.now() / 1000, daSala: true, recebido: Date.now() };
      } else r = this.local(acao, dados);
      this.meu = r;
      this.desenharBarra();
      return r;
    }
    /** Fora de uma sala: as mesmas contas do servidor, com o meu relógio. */
    local(acao, d) {
      const agora = Date.now() / 1000, tempo = (x) => (x.pausado !== null ? x.pausado : Math.max(0, agora - x.inicio));
      if (acao === "fechar") return null;
      let v = this.meu ? { ...this.meu } : null;
      if (acao === "abrir") v = { url: d.url, inicio: agora - (d.em || 0), pausado: null };
      if (!v) throw new Error("Você não tem um vídeo na tela.");
      if (acao === "abrir" || acao === "lugar") Object.assign(v, { modo: d.modo === "parada" ? "parada" : "seguir", pos: d.pos || [0, 0, 0], rumo: d.rumo || 0, tamanho: limitar(+d.tamanho || 2, 0.5, 12) });
      else if (acao === "pausar" && v.pausado === null) v.pausado = tempo(v);
      else if (acao === "continuar" && v.pausado !== null) { v.inicio = agora - v.pausado; v.pausado = null; }
      else if (acao === "pular") {
        const t = "em" in d ? Math.max(0, d.em) : Math.max(0, tempo(v) + d.mais);
        if (v.pausado !== null) v.pausado = t; else v.inicio = agora - t;
      }
      return { ...v, n: (v.n || 0) + 1, desvio: 0, daSala: false };
    }
    /** Onde a minha tela está agora (para deixá-la parada ali, ou mandar à sala ao entrar). */
    lugarAgora() {
      const t = this.telas.get("eu");
      if (t && !t.primeira) return { pos: t.ancora.position.toArray().map((v) => +v.toFixed(3)), rumo: +t.rumo.toFixed(4) };
      const alvo = this.alvoSeguindo(this.palco.raiz.position, this.palco.mundo.cam.giro, this.palco.altura, (this.meu && this.meu.tamanho) || +pref("tamanho", "2"));
      return { pos: alvo.pos.toArray().map((v) => +v.toFixed(3)), rumo: +alvo.rumo.toFixed(4) };
    }
    async abrir(url, { modo = "seguir", tamanho = 2 } = {}) {
      const d = interpretar(url);
      if (!d) throw new Error("Esse link não abre aqui: use um link do YouTube, Vimeo, Twitch ou de um arquivo de vídeo (.mp4, .webm).");
      if (!this.podePor()) throw new Error("Nesta sala, só quem criou põe vídeos na tela.");
      const m = this.palco && this.palco.mundo;
      if (!m || !this.palco.vrm) throw new Error("Abra uma personagem (ou entre numa sala) para ver o vídeo no cenário.");
      if (!m.andando) m.entrar(); // a tela fica no cenário, na frente dela
      gravarPref("tamanho", tamanho);
      gravarPref("modo", modo);
      // "parada": ali na frente dela, de onde está agora
      const lugar = this.lugarDeAbrir(tamanho);
      return this.pedir("abrir", { url: url.trim(), em: d.em || 0, modo, tamanho, ...lugar });
    }
    lugarDeAbrir(tamanho) {
      const a = this.alvoSeguindo(this.palco.raiz.position, this.palco.mundo.cam.giro, this.palco.altura, tamanho);
      return { pos: a.pos.toArray().map((v) => +v.toFixed(3)), rumo: +a.rumo.toFixed(4) };
    }
    async trocarModo(modo) {
      if (!this.meu) return;
      gravarPref("modo", modo);
      await this.pedir("lugar", { modo, tamanho: this.meu.tamanho, ...this.lugarAgora() });
    }
    async trocarTamanho(tamanho) {
      if (!this.meu) return;
      gravarPref("tamanho", tamanho);
      await this.pedir("lugar", { modo: this.meu.modo, tamanho, pos: this.meu.pos, rumo: this.meu.rumo });
    }
    /** Traz a tela parada para a frente da personagem de novo. */
    async trazer() { if (this.meu) await this.pedir("lugar", { modo: this.meu.modo, tamanho: this.meu.tamanho, ...this.lugarDeAbrir(this.meu.tamanho) }); }
    pausar() { return this.meu ? this.pedir(this.meu.pausado !== null && this.meu.pausado !== undefined ? "continuar" : "pausar") : null; }
    pular(mais) { return this.meu ? this.pedir("pular", { mais }) : null; }
    async fechar() { if (this.meu) await this.pedir("fechar"); }
    /** Todas as telas voltam ao ponto do relógio (se alguém mexeu no player com os controles do site). */
    sincronizarTodas() { for (const t of this.telas.values()) t.sincronizar(); }
    alternarMudo() { this.mudo = !this.mudo; gravarPref("mudo", this.mudo ? "1" : "0"); this.desenharBarra(); }
    definirVerOutros(v) { this.verOutros = !!v; gravarPref("ver-outros", v ? "1" : "0"); }
    definirSomOutros(v) { this.somOutros = !!v; gravarPref("som-outros", v ? "1" : "0"); }

    /** Entrou ou saiu de uma sala: o meu vídeo vai junto (entrando) ou continua só para mim (saindo). */
    async aoMudarSala() {
      const s = this.naSala(), m = this.meu;
      if (!m) return;
      if (s && !m.daSala) {
        if (!this.podePor()) { this.meu = null; this.desenharBarra(); return; }
        const t = m.pausado !== null ? m.pausado : Math.max(0, Date.now() / 1000 + (m.desvio || 0) - m.inicio);
        try {
          await this.pedir("abrir", { url: m.url, em: t, modo: m.modo, tamanho: m.tamanho, ...this.lugarAgora() });
          if (m.pausado !== null) await this.pedir("pausar");
        } catch (e) { console.warn("vídeo", e); }
      } else if (!s && m.daSala) {
        // fora da sala, o relógio passa a ser o meu (o vídeo continua do mesmo ponto)
        this.meu = { ...m, inicio: m.inicio - (m.desvio || 0), desvio: 0, daSala: false };
        this.desenharBarra();
      }
    }

    // ── a cada quadro ──
    /**
     * A tela que segue: depois da personagem, na direção em que a câmera de quem pôs o vídeo olha, virada para essa
     * câmera (giro: o ângulo da câmera em volta dela, como em js/mundo.js). Sem o giro, na frente da personagem.
     * A distância e a altura dependem do tamanho dela e da tela.
     */
    alvoSeguindo(pos, giro, altura, tamanho, rumo = 0) {
      const T = window.THREE, esc = (altura || 1.5) / 1.5, alto = tamanho * ALT / LARG;
      const dist = 1.3 * esc + tamanho * 0.62, y = Math.max(altura * 1.02, alto / 2 + 0.25 * esc);
      const virada = typeof giro === "number" ? giro : rumo + Math.PI; // para onde a frente da tela aponta
      return { pos: new T.Vector3(pos.x - Math.sin(virada) * dist, pos.y + y, pos.z - Math.cos(virada) * dist), rumo: virada };
    }
    quadro(dt) {
      const p = this.palco;
      if (!p || !this.camada) return;
      const s = this.naSala(), m = p.mundo;
      // a sala tirou o meu vídeo (quem criou deixou só ele pôr vídeos)
      if (s && this.meu && this.meu.daSala && s.meuVideo === 0 && Date.now() - this.meu.recebido > 2500) {
        this.meu = null;
        this.desenharBarra();
        LNUX.aviso("O seu vídeo saiu da tela: nesta sala, agora só quem criou põe vídeos.", "alerta", 7000);
      }
      const quero = new Map();
      if (this.meu && p.vrm) quero.set("eu", { estado: this.meu, nome: "Você", pos: p.raiz.position, giro: m ? m.cam.giro : null, rumo: m ? m.rumo : 0, altura: p.altura, meu: true });
      if (s) for (const r of s.remotos.values()) if (r.video && this.verOutros) quero.set(r.id, { estado: r.video, nome: r.nome, pos: r.grupo.position, giro: r.giroCam, rumo: r.rumo, altura: r.altura });
      for (const [k, t] of this.telas) if (!quero.has(k)) { t.descartar(); this.telas.delete(k); }
      const cam = p.camera, ver = !!(m && m.andando);
      cam.updateMatrixWorld();
      for (const [k, q] of quero) {
        let t = this.telas.get(k);
        if (!t) { t = new Tela(k, this.camada, p.cena); this.telas.set(k, t); }
        const mudo = q.meu ? this.mudo : !this.somOutros;
        if (t.estado !== q.estado || t.mudo !== mudo) t.aplicar(q.estado, { nome: q.nome, mudo });
        const e = q.estado;
        if (e.modo === "parada") t.mover(dt, this._v.fromArray(e.pos || [0, 0, 0]), +e.rumo || 0, false);
        else { const a = this.alvoSeguindo(q.pos, q.giro, q.altura, t.largura, q.rumo); t.mover(dt, a.pos, a.rumo, true); }
        t.conferir(cam, ver);
        // o som: a minha tela que me segue, cheio; as outras diminuem com a distância até a câmera
        if (mudo) t.definirVolume(0);
        else if (q.meu && e.modo !== "parada") t.definirVolume(100);
        else {
          const esc = (p.altura || 1.5) / 1.5, d = cam.position.distanceTo(t.ancora.position);
          t.definirVolume(100 * limitar(1 - Math.max(0, d - 3 * esc - t.largura) / (22 * esc), 0, 1));
        }
      }
      this.camada.desenhar(cam, this.telas.values());
    }

    // ── a tela de abrir e a barra de controles ──
    async janela() {
      if (!this.podePor()) { LNUX.aviso("Nesta sala, só quem criou põe vídeos na tela.", "alerta"); return null; }
      const link = el("input", { class: "lnux-entrada", type: "url", inputmode: "url", "aria-label": "Link do vídeo", placeholder: "https://www.youtube.com/watch?v=...", value: this.meu ? this.meu.url : "" });
      const tam = el("select", { class: "lnux-selecao", "aria-label": "Tamanho da tela" }, TAMANHOS.map(([v, r]) => el("option", { value: v, selected: v === +((this.meu && this.meu.tamanho) || pref("tamanho", "2")) }, `${r} (${v} m)`)));
      let modo = (this.meu && this.meu.modo) || pref("modo", "seguir");
      const botaoModo = (valor, rotulo, dica) => el("button", { type: "button", class: "lnux-botao" + (modo === valor ? " ativa" : ""), "data-modo-tela": valor, title: dica, "aria-pressed": String(modo === valor),
        onclick: (ev) => { modo = valor; for (const b of ev.currentTarget.parentElement.children) { b.classList.toggle("ativa", b.dataset.modoTela === valor); b.setAttribute("aria-pressed", String(b.dataset.modoTela === valor)); } } }, rotulo);
      const erro = el("p", { class: "conta-msg erro", role: "alert", hidden: true });
      const s = this.naSala();
      const corpo = el("div", { class: "ajustes janela-video" },
        el("label", { class: "lnux-campo" }, el("span", {}, "Link do vídeo"), link,
          el("small", { class: "fraco" }, "YouTube, Vimeo, Twitch ou um arquivo de vídeo (.mp4, .webm). O vídeo vem direto do site dele.")),
        el("label", { class: "lnux-campo" }, el("span", {}, "Tamanho da tela"), tam),
        el("div", { class: "lnux-campo" }, el("span", {}, "A tela"), el("div", { class: "lnux-segmentos" },
          botaoModo("seguir", "🚶 Segue a personagem", "A tela fica sempre na frente dela, aonde ela for"),
          botaoModo("parada", "📌 Fica parada aqui", "A tela fica neste lugar do cenário"))),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, s ? "Na sala, todos veem a sua tela e o mesmo pedaço do vídeo; pausar e pular vale para todos." : "Clique no cenário para voltar a andar depois de mexer no player."),
        erro);
      const r = await LNUX.dialogo({ titulo: "Vídeo na tela", corpo, botoes: [{ rotulo: "Cancelar", valor: null }, { rotulo: this.meu ? "Trocar o vídeo" : "Mostrar", primario: true,
        antes: () => { if (interpretar(link.value)) return true; erro.textContent = "Esse link não abre aqui: use um link do YouTube, Vimeo, Twitch ou de um arquivo de vídeo (.mp4, .webm)."; erro.hidden = false; link.focus(); return false; }, valor: () => "ok" }] });
      if (r !== "ok") return null;
      try { return await this.abrir(link.value, { modo, tamanho: +tam.value }); } catch (e) { LNUX.erro(e); return null; }
    }
    desenharBarra() {
      const m = this.meu;
      if (!m) { if (this.barra) { this.barra.remove(); this.barra = null; } return; }
      const d = interpretar(m.url) || { site: "vídeo" }, pausado = m.pausado !== null && m.pausado !== undefined;
      const b = (rotulo, dica, acao, extra = {}) => el("button", { type: "button", class: "lnux-botao pequeno", title: dica, "aria-label": dica, onclick: async () => { try { await acao(); } catch (e) { LNUX.erro(e); } }, ...extra }, rotulo);
      const tam = el("select", { class: "lnux-selecao pequeno", "aria-label": "Tamanho da tela" }, TAMANHOS.map(([v, r]) => el("option", { value: v, selected: v === +m.tamanho }, r)));
      tam.addEventListener("change", () => this.trocarTamanho(+tam.value).catch(LNUX.erro));
      if (!this.barra) { this.barra = el("div", { class: "barra-video", role: "toolbar", "aria-label": "O seu vídeo" }); this.area.append(this.barra); }
      const extra = { class: "lnux-botao pequeno extra" }; // no celular, só com o "⋯"
      tam.classList.add("extra");
      const modo = el("span", { class: "rotulo-longo" }, m.modo === "parada" ? " Parada" : " Seguindo");
      this.barra.replaceChildren(...LNUX.filhos(
        el("span", { class: "barra-video-titulo" }, "📺 " + d.site),
        d.aoVivo ? null : b(pausado ? "▶" : "⏸", pausado ? "Continuar (para todos)" : "Pausar (para todos)", () => this.pausar(), { "data-acao": "pausar" }),
        d.aoVivo ? null : b("−10s", "Voltar 10 segundos", () => this.pular(-10), extra),
        d.aoVivo ? null : b("+10s", "Pular 10 segundos", () => this.pular(10), extra),
        d.aoVivo ? null : b("⟳", "Sincronizar (voltar ao ponto de todos)", () => this.sincronizarTodas(), extra),
        b([m.modo === "parada" ? "📌" : "🚶", modo], m.modo === "parada" ? "A tela está parada: clique para ela seguir a personagem" : "A tela segue a personagem: clique para deixá-la parada aqui",
          () => this.trocarModo(m.modo === "parada" ? "seguir" : "parada"), { "data-acao": "modo" }),
        m.modo === "parada" ? b("↩", "Trazer a tela para a frente dela", () => this.trazer(), extra) : null,
        tam,
        b(this.mudo ? "🔇" : "🔊", this.mudo ? "Ligar o som" : "Tirar o som", () => this.alternarMudo()),
        b("🔗", "Trocar o vídeo", () => this.janela(), extra),
        b("⋯", "Mais controles", () => { this.barra.classList.toggle("aberta"); this.desenharBarra(); }, { class: "lnux-botao pequeno so-celular", "aria-expanded": String(this.barra.classList.contains("aberta")) }),
        b("✕", "Fechar o vídeo", () => this.fechar(), { "data-acao": "fechar" })));
    }
  }

  C.video = { interpretar, endereco, tempoDoLink, TAMANHOS };
  C.Videos = Videos;
})();
