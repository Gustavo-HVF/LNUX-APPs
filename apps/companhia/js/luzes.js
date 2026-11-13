/*
 * Companhia — as luzes do cenário.
 *
 *   - Achar as luzes do mapa: as lâmpadas que vêm no arquivo (glTF, FBX, Blender: pontuais e spots), as superfícies
 *     que brilham (materiais emissivos: lâmpadas, neon, janelas acesas, telas) e as peças com nome de luz (lâmpada,
 *     luminária, vela, lanterna, tocha, fogueira...). Mais as que a pessoa põe à mão ("Pôr uma luz aqui").
 *   - Em tempo real: de cada ponto sai uma luz de verdade. Para não pesar, ficam acesas só as mais perto da personagem
 *     (quantas, a pessoa escolhe); elas trocam devagar enquanto ela anda. As mais perto podem fazer sombra.
 *   - Luz calculada por raios (ray tracing): uma vez, cada pedacinho do mapa lança raios para cada luz (com sombras
 *     suaves, porque a luz tem tamanho), para o sol e para o céu (o céu só entra por onde dá para vê-lo: janelas,
 *     portas), e mais um rebote (a luz que bate numa parede clareia o que está em volta). O resultado fica pintado
 *     nos vértices do mapa (os triângulos grandes são divididos antes, para caber detalhe), e o mapa passa a custar
 *     quase nada para desenhar. As personagens continuam com a luz em tempo real. Fica guardado com o cenário.
 *
 * Os raios usam a mesma árvore da colisão (three-mesh-bvh, MIT).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const ehCelular = () => (window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  // uma pausa curta entre os pedaços do cálculo (a tela continua respondendo, sem esperar um quadro inteiro a cada vez)
  const esperarQuadro = () => new Promise((ok) => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); });

  // nomes de peças que costumam ser luz (sem acento, em pedaços: "Lamp_01" → lamp)
  const NOMES_LUZ = new Set(["lamp", "lampada", "lampadas", "light", "lights", "luz", "luzes", "luminaria", "luminarias", "lustre", "abajur", "chandelier", "sconce", "arandela", "bulb", "bulbs",
    "spotlight", "holofote", "refletor", "poste", "streetlight", "streetlamp", "lantern", "lanterna", "lampiao", "neon", "led", "candle", "candles", "vela", "velas", "torch", "tocha", "fire",
    "fogo", "fogueira", "campfire", "bonfire", "lareira", "fireplace", "brazier", "braseiro"]);
  const NOMES_FOGO = new Set(["candle", "candles", "vela", "velas", "torch", "tocha", "fire", "fogo", "fogueira", "campfire", "bonfire", "lareira", "fireplace", "brazier", "braseiro"]);
  const NOMES_NAO = new Set(["switch", "interruptor", "probe", "map", "mapa", "volume", "blocker", "col", "collider", "trigger", "button", "botao", "off", "lightmap", "baked", "shadow", "sombra"]);
  const pedacos = (nome) => String(nome || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(Boolean);

  const QUALIDADES = {
    rapida: { rotulo: "Rápida", triangulos: 60000, ceu: 6 },
    boa: { rotulo: "Boa", triangulos: 180000, ceu: 10 },
    alta: { rotulo: "Alta", triangulos: 450000, ceu: 16 },
  };
  const padrao = () => ({ ligadas: true, forca: 1, alcance: 1, juntas: ehCelular() ? 4 : 8, sombras: 0, nomes: true,
    raios: { qualidade: ehCelular() ? "rapida" : "boa", suave: 2, ceu: true, rebatida: 0.7, sozinho: false } });

  /** A cor média de uma textura (pequena, num canvas), já em cor linear. */
  const mediasDeTextura = new WeakMap();
  function mediaDaTextura(tex) {
    if (!tex || !tex.image) return null;
    if (mediasDeTextura.has(tex)) return mediasDeTextura.get(tex);
    let cor = null;
    try {
      const tela = document.createElement("canvas");
      tela.width = tela.height = 8;
      const g = tela.getContext("2d", { willReadFrequently: true });
      g.drawImage(tex.image, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4, lin = (v) => Math.pow(v / n / 255, 2.2);
      cor = new window.THREE.Color(lin(r), lin(gg), lin(b));
    } catch (e) { cor = null; }
    mediasDeTextura.set(tex, cor);
    return cor;
  }
  /** O brilho próprio de um material (emissivo): {cor, lum} ou null. */
  function brilhoDoMaterial(m) {
    if (!m || !m.emissive) return null;
    const c = m.emissive.clone().multiplyScalar(m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity);
    if (m.emissiveMap) { const media = mediaDaTextura(m.emissiveMap); if (media) c.multiply(media); }
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return lum >= 0.04 ? { cor: c, lum } : null;
  }
  const materiaisDe = (o) => [].concat((o.userData.luzOriginal ? o.userData.luzOriginal.material : o.material) || []);
  const geometriaDe = (o) => (o.userData.luzOriginal ? o.userData.luzOriginal.geometry : o.geometry);

  /**
   * Os triângulos de uma malha (no espaço m: a matriz que leva ao espaço do mapa), só os dos materiais aceitos.
   * Para cada um: área, centro e normal. Malhas enormes são amostradas (no máximo 20 mil triângulos), com a área
   * corrigida. Devolve {area, tris: [{a, c: Vector3, n: Vector3}]}.
   */
  function triangulosDe(o, m, aceita = () => true, guardar = true) {
    const T = window.THREE, g = geometriaDe(o), pos = g.attributes.position, idx = g.index;
    const total = (idx ? idx.count : pos.count) / 3;
    const faixas = [];
    const mats = materiaisDe(o);
    if (Array.isArray(o.material) && g.groups && g.groups.length) {
      for (const gr of g.groups) if (aceita(mats[gr.materialIndex])) faixas.push([Math.floor(gr.start / 3), Math.floor((gr.start + gr.count) / 3)]);
    } else if (aceita(mats[0])) faixas.push([0, total]);
    const n = faixas.reduce((s, [a, b]) => s + (b - a), 0);
    const passo = Math.max(1, Math.ceil(n / 20000));
    const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
    const tris = [];
    let area = 0;
    const v = (i) => (idx ? idx.getX(i) : i);
    for (const [a, b] of faixas) {
      for (let t = a; t < b; t += passo) {
        va.fromBufferAttribute(pos, v(3 * t)).applyMatrix4(m);
        vb.fromBufferAttribute(pos, v(3 * t + 1)).applyMatrix4(m);
        vc.fromBufferAttribute(pos, v(3 * t + 2)).applyMatrix4(m);
        const nn = e1.subVectors(vb, va).cross(e2.subVectors(vc, va));
        const ar = nn.length() / 2;
        if (!(ar > 0)) continue;
        area += ar * passo;
        if (guardar) tris.push({ a: ar * passo, c: new T.Vector3().add(va).add(vb).add(vc).divideScalar(3), n: nn.clone().normalize() });
      }
    }
    return { area, tris };
  }

  class LuzesDoMapa {
    constructor(mundo) {
      this.mundo = mundo;
      this.palco = mundo.palco;
      this.fontes = [];          // {id, tipo: arquivo | brilho | nome | minha, nome, local, pos, cor, forca, alcance, raio, normal, cone, ligada}
      this.doArquivo = [];       // as luzes que vieram no arquivo (tiradas da cena: quem acende é o conjunto abaixo)
      this.conjunto = [];        // as luzes de verdade na cena: [{luz: PointLight, fonte, proxima}]
      this.assado = false;       // a luz calculada por raios está no mapa
      this.desatualizado = false;
      this.info = null;          // o que achou: {arquivo, brilho, nome, minha, pintado}
      this.calculo = null;       // {raios, segundos, quando}
      this.espera = 0;
      this.cfg = padrao();
      try { const salvo = JSON.parse(LNUX.preferencia.ler("companhia.luzes", "{}")); Object.assign(this.cfg, salvo, { raios: { ...this.cfg.raios, ...(salvo.raios || {}) } }); } catch (e) { /* padrão */ }
    }
    salvarCfg() { LNUX.preferencia.gravar("companhia.luzes", JSON.stringify(this.cfg)); }
    definir(mudancas) {
      const antes = JSON.stringify([this.cfg.nomes]), raios = this.cfg.raios;
      Object.assign(this.cfg, mudancas);
      this.cfg.raios = { ...padrao().raios, ...raios, ...(mudancas.raios || {}) }; // mudar uma opção do cálculo não apaga as outras
      this.salvarCfg();
      if (JSON.stringify([this.cfg.nomes]) !== antes && this.mundo.mapa) this.achar();
      this.espera = 0;
      this.palco.emit("luzes", this);
    }

    // ── achar as luzes ───────────────────────────────────────────────
    /** O mapa acabou de abrir (antes do ajuste): tira as luzes do arquivo da cena (guarda o que elas eram) e procura as outras. */
    preparar(objeto) {
      const T = window.THREE;
      this.limpar();
      objeto.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(objeto.matrixWorld).invert(), v = new T.Vector3();
      const luzes = [];
      objeto.traverse((o) => { if (o.isLight) luzes.push(o); });
      this.doArquivo = [];
      for (const l of luzes) {
        if (l.isPointLight || l.isSpotLight) {
          const local = l.getWorldPosition(new T.Vector3()).applyMatrix4(inv);
          let cone = null;
          if (l.isSpotLight) {
            l.target.updateMatrixWorld(true);
            const alvo = l.target.getWorldPosition(new T.Vector3()).applyMatrix4(inv);
            const angulo = limitar(l.angle || Math.PI / 4, 0.02, Math.PI / 2);
            cone = { dir: alvo.sub(local).normalize(), fora: Math.cos(angulo), dentro: Math.cos(angulo * (1 - limitar(l.penumbra || 0, 0, 1))) };
            if (!(cone.dir.lengthSq() > 0.5)) cone.dir = new T.Vector3(0, -1, 0);
          }
          this.doArquivo.push({ nome: l.name || (l.isSpotLight ? "Spot" : "Lâmpada"), local, cor: l.color.clone(), base: l.intensity, distancia: l.distance || 0, cone });
        }
        if (l.parent) l.parent.remove(l);
        if (l.target && l.target.parent) l.target.parent.remove(l.target);
      }
      void v;
      this.achar(objeto);
    }
    /** Procura as luzes (as do arquivo, as que brilham, as pelo nome e as minhas) e calcula onde estão no mundo. */
    achar(objeto = this.mundo.mapa) {
      const T = window.THREE;
      if (!objeto) { this.fontes = []; return; }
      const salvas = this.mundo.mapa === objeto && this.mundo.info ? this.mundo.info.ajuste : {};
      const fontes = [];
      // 1. do arquivo: a força de cada uma em relação às outras (os programas exportam em unidades muito diferentes)
      const bases = this.doArquivo.map((f) => f.base).filter((b) => b > 0).sort((a, b) => a - b), mediana = bases.length ? bases[Math.floor(bases.length / 2)] : 1;
      this.doArquivo.forEach((f, i) => fontes.push({ id: `arquivo:${i}:${f.nome}`, tipo: "arquivo", nome: f.nome, local: f.local.clone(), cor: f.cor.clone(),
        forca: 6 * limitar((f.base || mediana) / mediana, 0.25, 4), alcance: f.distancia > 0 ? f.distancia : 0, raio: 0.08, normal: null, cone: f.cone }));
      // 2. o que brilha e 3. os nomes
      objeto.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(objeto.matrixWorld).invert(), m = new T.Matrix4();
      let areaTotal = 0, areaBrilho = 0;
      const brilhos = [], pelosNomes = [];
      objeto.traverse((o) => {
        if (!o.isMesh || !geometriaDe(o) || !geometriaDe(o).attributes.position) return;
        m.multiplyMatrices(inv, o.matrixWorld);
        areaTotal += triangulosDe(o, m, () => true, false).area;
        let melhor = null;
        for (const mat of materiaisDe(o)) { const b = brilhoDoMaterial(mat); if (b && (!melhor || b.lum > melhor.lum)) melhor = b; }
        if (melhor) {
          const { area, tris } = triangulosDe(o, m, (mat) => !!brilhoDoMaterial(mat));
          if (area <= 0) return;
          areaBrilho += area;
          // malhas grandes (uma faixa de neon, um teto de luz) viram várias luzes, uma a cada 2,5 m
          const celulas = new Map();
          for (const t of tris) {
            const k = `${Math.floor(t.c.x / 2.5)},${Math.floor(t.c.y / 2.5)},${Math.floor(t.c.z / 2.5)}`;
            let c = celulas.get(k);
            if (!c) celulas.set(k, (c = { a: 0, c: new T.Vector3(), n: new T.Vector3(), min: t.c.clone(), max: t.c.clone() }));
            c.a += t.a;
            c.c.addScaledVector(t.c, t.a);
            c.n.addScaledVector(t.n, t.a);
            c.min.min(t.c);
            c.max.max(t.c);
          }
          let i = 0;
          for (const c of [...celulas.values()].sort((a, b) => b.a - a.a).slice(0, 24)) {
            c.c.divideScalar(c.a);
            const nm = c.n.length() / c.a; // perto de 1: um painel virado para um lado; perto de 0: uma lâmpada redonda
            const normal = nm > 0.6 ? c.n.clone().normalize() : null;
            const pos = normal ? c.c.clone().addScaledVector(normal, 0.04) : c.c.clone();
            const cor = melhor.cor.clone(), maior = Math.max(cor.r, cor.g, cor.b) || 1;
            brilhos.push({ id: `brilho:${o.name || o.id}:${i++}`, tipo: "brilho", nome: o.name || (materiaisDe(o)[0] && materiaisDe(o)[0].name) || "Brilho", local: pos, cor: cor.multiplyScalar(1 / maior),
              forca: 3 * limitar(melhor.lum, 0.25, 3) * limitar(Math.sqrt(c.a / 0.05), 0.35, 2.5), alcance: 0, raio: limitar(c.max.distanceTo(c.min) / 2, 0.04, 1.2), normal, cone: null });
          }
          return;
        }
        // pelos nomes (a peça e o pai dela), se não for grande demais
        if (this.cfg.nomes) {
          const ps = [...pedacos(o.name), ...pedacos(o.parent && o.parent.name)];
          if (!ps.some((p) => NOMES_LUZ.has(p)) || ps.some((p) => NOMES_NAO.has(p))) return;
          const caixa = new T.Box3().setFromBufferAttribute(geometriaDe(o).attributes.position).applyMatrix4(m), tam = caixa.getSize(new T.Vector3());
          if (Math.max(tam.x, tam.y, tam.z) > 6) return;
          const fogo = ps.some((p) => NOMES_FOGO.has(p));
          pelosNomes.push({ id: `nome:${o.name || o.id}`, tipo: "nome", nome: o.name || o.parent.name, local: caixa.getCenter(new T.Vector3()), cor: new T.Color(fogo ? 0xff9a40 : 0xffd8a8),
            forca: fogo ? 4 : 5, alcance: 0, raio: limitar(Math.max(tam.x, tam.y, tam.z) / 2, 0.05, 0.8), normal: null, cone: null });
        }
      });
      // um mapa com brilho em quase tudo já vem com a luz pintada (comum em mundos exportados do Unity): aí o brilho não vira luz
      const pintado = areaTotal > 0 && areaBrilho / areaTotal > 0.4;
      // junta as que estão quase no mesmo lugar (uma lâmpada de várias peças)
      const juntar = (lista) => {
        const r = [];
        for (const f of lista) {
          const perto = r.find((g) => g.local.distanceTo(f.local) < 0.5);
          if (!perto) { r.push(f); continue; }
          const s = perto.forca + f.forca;
          perto.local.multiplyScalar(perto.forca / s).addScaledVector(f.local, f.forca / s);
          perto.forca = Math.min(18, s);
          perto.raio = Math.max(perto.raio, f.raio);
        }
        return r;
      };
      if (!pintado) fontes.push(...juntar(brilhos));
      fontes.push(...juntar(pelosNomes.filter((f) => !fontes.some((g) => g.local.distanceTo(f.local) < 0.8))));
      // as minhas (postas à mão), guardadas no ajuste do cenário
      ((salvas && salvas.luzes) || []).forEach((l, i) => {
        if (!Array.isArray(l.p)) return;
        fontes.push({ id: `minha:${i}`, tipo: "minha", nome: `Minha luz ${i + 1}`, local: new T.Vector3().fromArray(l.p), cor: new T.Color(l.cor || "#ffe2b8"), forca: 6 * limitar(+l.forca || 1, 0.05, 20),
          alcance: 0, raio: 0.1, normal: null, cone: null, indice: i });
      });
      // as mais fortes primeiro; no máximo 256
      fontes.sort((a, b) => (b.tipo === "minha") - (a.tipo === "minha") || b.forca - a.forca);
      this.fontes = fontes.slice(0, 256);
      this.chaveAjuste = JSON.stringify([(salvas && salvas.luzes) || [], (salvas && salvas.luzesDesligadas) || []]);
      const desligadas = new Set((salvas && salvas.luzesDesligadas) || []);
      for (const f of this.fontes) f.ligada = !desligadas.has(f.id);
      this.info = { arquivo: this.fontes.filter((f) => f.tipo === "arquivo").length, brilho: this.fontes.filter((f) => f.tipo === "brilho").length,
        nome: this.fontes.filter((f) => f.tipo === "nome").length, minha: this.fontes.filter((f) => f.tipo === "minha").length, pintado };
      this.atualizarMundo();
      if (this.assado) this.desatualizado = true;
      this.espera = 0;
      this.palco.emit("luzes", this);
    }
    /** As posições no mundo (o mapa pode ter mudado de tamanho, giro ou lugar). */
    atualizarMundo() {
      const T = window.THREE, mapa = this.mundo.mapa;
      if (!mapa) return;
      mapa.updateMatrixWorld(true);
      const esc = mapa.scale.x || 1;
      for (const f of this.fontes) {
        f.pos = f.local.clone().applyMatrix4(mapa.matrixWorld);
        f.normalMundo = f.normal ? f.normal.clone().transformDirection(mapa.matrixWorld) : null;
        f.coneMundo = f.cone ? { ...f.cone, dir: f.cone.dir.clone().transformDirection(mapa.matrixWorld) } : null;
        f.raioMundo = f.raio * (f.tipo === "minha" ? 1 : esc);
        f.alcanceMundo = f.alcance > 0 ? f.alcance * esc : 0;
      }
      void T;
    }
    /** O ajuste do cenário mudou por fora (o dono da sala): as minhas luzes e as desligadas vêm dele (só refaz se mudaram). */
    lerAjuste() {
      const a = (this.mundo.info && this.mundo.info.ajuste) || {}, k = JSON.stringify([a.luzes || [], a.luzesDesligadas || []]);
      if (this.mundo.mapa && k !== this.chaveAjuste) this.achar();
    }
    /** O cenário abriu: com "calcular sozinho", calcula (o guardado é na hora; sem ele, em segundo plano, avisando o progresso). */
    aoAbrir() {
      if (!this.cfg.raios.sozinho) return;
      const mapa = this.mundo.mapa;
      setTimeout(() => {
        if (this.mundo.mapa !== mapa || this.emCalculo) return;
        this.calcular({ aoProgresso: (f, t) => this.palco.emit("luz-calculo", f, t), cancelado: () => this.mundo.mapa !== mapa })
          .catch((e) => console.warn("luz calculada", e)).finally(() => this.palco.emit("luz-calculo", null));
      }, 400);
    }
    antesDoAjuste() { if (this.assado) { this.tirarCalculo(); this.desatualizado = true; } }
    depoisDoAjuste() { this.atualizarMundo(); this.espera = 0; }
    /** O ajuste guardado das luzes (as minhas e as desligadas), para quem chama gravar. */
    lugarParaMinha() {
      const T = window.THREE, p = this.palco, mapa = this.mundo.mapa;
      const frente = new T.Vector3(Math.sin(this.mundo.rumo), 0, Math.cos(this.mundo.rumo));
      const mundo = p.raiz.position.clone().addScaledVector(frente, 0.6 * (p.altura / 1.5)).add(new T.Vector3(0, p.altura * 1.25, 0));
      return mundo.applyMatrix4(new T.Matrix4().copy(mapa.matrixWorld).invert());
    }
    limpar() {
      this.tirarCalculo();
      this.refazerConjunto(0);
      this.fontes = [];
      this.doArquivo = [];
      this.info = null;
      this.calculo = null;
      this.desatualizado = false;
    }

    // ── em tempo real: as mais perto acesas ───────────────────────────
    refazerConjunto(n) {
      const T = window.THREE, cena = this.palco.cena;
      while (this.conjunto.length > n) { const s = this.conjunto.pop(); cena.remove(s.luz); s.luz.dispose && s.luz.dispose(); }
      while (this.conjunto.length < n) {
        const luz = new T.PointLight(0xffffff, 0, 0, 2);
        luz.userData.daCompanhia = true;
        cena.add(luz);
        this.conjunto.push({ luz, fonte: null, proxima: null });
      }
      this.sombrasFeitas = -1;
    }
    quadro(dt) {
      const m = this.mundo, cfg = this.cfg;
      const quantas = m.mapa && cfg.ligadas && this.fontes.some((f) => f.ligada) ? cfg.juntas : 0;
      if (this.conjunto.length !== quantas) this.refazerConjunto(quantas);
      if (!quantas) return;
      // as sombras: as primeiras do conjunto (as mais perto) fazem sombra
      const sombras = this.palco.renderer.shadowMap.enabled ? Math.min(cfg.sombras, quantas) : 0;
      if (sombras !== this.sombrasFeitas) {
        this.sombrasFeitas = sombras;
        const tam = ehCelular() ? 512 : 1024;
        this.conjunto.forEach((s, i) => {
          s.luz.castShadow = i < sombras;
          if (s.luz.castShadow) { s.luz.shadow.mapSize.set(tam, tam); s.luz.shadow.bias = -0.002; s.luz.shadow.normalBias = 0.03; s.luz.shadow.camera.near = 0.05; }
        });
        this.palco.cena.traverse((o) => { if (o.isMesh) for (const mt of [].concat(o.material || [])) mt.needsUpdate = true; });
      }
      this.espera -= dt;
      if (this.espera <= 0) { this.espera = 0.25; this.escolher(sombras); }
      const k = 1 - Math.exp(-dt * 6);
      for (const s of this.conjunto) {
        const l = s.luz;
        if (s.fonte !== s.proxima) {
          // troca devagar: apaga, muda de lugar e acende de novo
          l.intensity = Math.max(0, l.intensity - dt * 6 * Math.max(1, l.intensity));
          if (l.intensity <= 0.02) { s.fonte = s.proxima; l.intensity = 0; if (s.fonte) this.vestir(l, s.fonte); }
        } else if (s.fonte) {
          this.vestir(l, s.fonte);
          l.intensity += (s.fonte.forca * cfg.forca - l.intensity) * k;
        } else l.intensity = 0;
      }
    }
    vestir(l, f) {
      l.position.copy(f.pos);
      l.color.copy(f.cor);
      l.distance = (f.alcanceMundo || 12) * this.cfg.alcance;
      if (l.castShadow) l.shadow.camera.far = l.distance;
    }
    /** Escolhe as mais importantes para onde a personagem está: as fortes e perto. As de sombra ficam nas primeiras vagas. */
    escolher(sombras) {
      const ref = this.mundo.andando ? this.mundo.cam.alvo : this.palco.raiz.position, cfg = this.cfg;
      const notas = [];
      for (const f of this.fontes) {
        if (!f.ligada || !f.pos) continue;
        const d2 = f.pos.distanceToSquared(ref), alc = (f.alcanceMundo || 12) * cfg.alcance;
        if (d2 > (alc + 15) * (alc + 15)) continue;
        notas.push([f.forca / (0.5 + d2), f]);
      }
      notas.sort((a, b) => b[0] - a[0]);
      const escolhidas = notas.slice(0, this.conjunto.length).map((x) => x[1]);
      const sobra = new Set(escolhidas);
      // as de sombra vão para as primeiras vagas; as outras ficam onde já estavam (sem trocar à toa)
      escolhidas.slice(0, sombras).forEach((f, i) => { this.conjunto[i].proxima = f; sobra.delete(f); });
      const livres = [];
      for (let i = sombras; i < this.conjunto.length; i++) {
        const s = this.conjunto[i];
        if (s.proxima && sobra.has(s.proxima)) sobra.delete(s.proxima); else livres.push(s);
      }
      const resto = [...sobra];
      for (const s of livres) s.proxima = resto.shift() || null;
    }

    // ── luz calculada por raios (ray tracing) ─────────────────────────
    /** A chave do cálculo: muda quando o mapa, as luzes, o sol, o céu ou a qualidade mudam (para usar o guardado). */
    chaveDoCalculo() {
      const p = this.palco, a = (this.mundo.info && this.mundo.info.ajuste) || {}, c = p.luzCfg, r = this.cfg.raios;
      return JSON.stringify({ v: 1, a: [a.escala, a.giro, a.deitado, a.posicao], f: this.fontes.filter((f) => f.ligada).map((f) => [f.id, +f.forca.toFixed(3), f.local.toArray().map((v) => +v.toFixed(3))]),
        forca: this.cfg.forca, alcance: this.cfg.alcance, sol: p.luzSol ? [c.sol, c.altura, c.forcaSol, c.corSol] : null, ceu: [c.forcaCeu, c.corCeu, c.chaoCeu, p.luzSol],
        r: [r.qualidade, r.suave, r.ceu, r.rebatida] });
    }
    tirarCalculo() {
      if (!this.mundo.mapa) { this.assado = false; return; }
      const feitos = new Set();
      this.mundo.mapa.traverse((o) => {
        const orig = o.userData.luzOriginal;
        if (!orig) return;
        if (o.geometry !== orig.geometry) o.geometry.dispose();
        for (const mt of [].concat(o.material)) if (mt.userData.assado && !feitos.has(mt)) { feitos.add(mt); mt.dispose(); }
        o.geometry = orig.geometry;
        o.material = orig.material;
        delete o.userData.luzOriginal;
      });
      if (this.assado) { this.assado = false; this.palco.definirLuz({}); this.palco.emit("luzes", this); }
    }
    /**
     * Calcula. aoProgresso(fração, texto); cancelado() → true para parar. Devolve {raios, segundos, guardado}.
     * Roda aos pedaços (14 ms por quadro), então a tela continua viva.
     */
    async calcular(opcoes = {}) {
      if (this.emCalculo) throw new Error("A luz já está sendo calculada.");
      this.emCalculo = true;
      try { return await this.calcularAgora(opcoes); } finally { this.emCalculo = false; }
    }
    async calcularAgora({ aoProgresso = () => {}, cancelado: pediuParar = () => false } = {}) {
      const T = window.THREE, mundo = this.mundo, mapa = mundo.mapa, arvore = mundo.colisor && mundo.colisor.geometry.boundsTree;
      if (!mapa || !arvore) throw new Error("Abra um cenário primeiro.");
      // para se a pessoa cancelar, trocar de mapa ou mexer no tamanho/lugar dele no meio
      const cancelado = () => pediuParar() || mundo.mapa !== mapa || !mundo.colisor || mundo.colisor.geometry.boundsTree !== arvore;
      this.tirarCalculo();
      const inicio = performance.now(), r = this.cfg.raios, q = QUALIDADES[r.qualidade] || QUALIDADES.boa;
      const chave = this.chaveDoCalculo(), id = mundo.info && mundo.info.id;
      mapa.updateMatrixWorld(true);
      // 1. as malhas e o tamanho dos pedaços (os triângulos grandes são divididos, até o limite da qualidade)
      const malhas = [];
      mapa.traverse((o) => { if (o.isMesh && o.visible && !o.isSkinnedMesh && o.geometry && o.geometry.attributes.position) malhas.push(o); });
      let area = 0, tris = 0;
      for (const o of malhas) { area += triangulosDe(o, o.matrixWorld, () => true, false).area; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
      const lado = tris >= q.triangulos ? Infinity : Math.max(0.2, Math.sqrt((4.4 * area) / Math.max(1, q.triangulos - tris)));
      aoProgresso(0.01, "Preparando o mapa...");
      const tempos = {};
      let marca = performance.now();
      const partes = [];
      const unicos = new Map(), pos = [], nor = [], dupla = [];
      const nm = new T.Matrix3(), v = new T.Vector3(), n = new T.Vector3();
      let restam = q.triangulos * 1.3;
      for (const o of malhas) {
        const escala = new T.Vector3().setFromMatrixScale(o.matrixWorld), esc = Math.max(escala.x, escala.y, escala.z) || 1;
        const geo = subdividir(o.geometry, lado / esc, restam);
        restam -= geo.attributes.position.count / 3;
        nm.getNormalMatrix(o.matrixWorld);
        const P = geo.attributes.position, N = geo.attributes.normal, qtd = P.count, mapaV = new Uint32Array(qtd);
        const duas = [].concat(o.material).some((mt) => mt && mt.side === T.DoubleSide);
        const brilha = [].concat(o.material).every((mt) => !mt || !!brilhoDoMaterial(mt)) ? 2 : 0; // a própria lâmpada não reflete luz no rebote
        for (let i = 0; i < qtd; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
          if (N) n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
          // a mesma posição (em centímetros) com a mesma normal é o mesmo ponto: calcula uma vez só
          const kp = (Math.round(v.x * 100) + 2097152) + (Math.round(v.z * 100) + 2097152) * 4194304; // x e z (< 2^44, exato)
          const kn = (Math.round(v.y * 100) + 1048576) * 4913 + (Math.round(n.x * 8) + 8) + (Math.round(n.y * 8) + 8) * 17 + (Math.round(n.z * 8) + 8) * 289; // y e a normal
          let porNormal = unicos.get(kp);
          if (!porNormal) unicos.set(kp, (porNormal = new Map()));
          let u = porNormal.get(kn);
          if (u === undefined) { u = pos.length / 3; porNormal.set(kn, u); pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); dupla.push((duas ? 1 : 0) | brilha); }
          mapaV[i] = u;
        }
        partes.push({ o, geo, mapaV });
        if (cancelado()) { for (const p of partes) p.geo.dispose(); return null; }
        await esperarQuadro();
      }
      unicos.clear();
      tempos.preparar = (performance.now() - marca) / 1000;
      const total = pos.length / 3;
      let E = null, raios = 0;
      // 2. o guardado (o mesmo mapa, as mesmas luzes e a mesma qualidade): não precisa calcular de novo
      if (id) {
        const g = await LNUX.guardado.ler("companhia.luzcalc." + id);
        if (g && g.chave === chave && g.total === total && g.cores && g.cores.length === total * 3) E = g.cores;
      }
      if (!E) {
        const res = await this.tracar({ pos, nor, dupla, total, arvore, q, r, aoProgresso, cancelado, lado });
        if (!res || !res.E) { for (const p of partes) p.geo.dispose(); return null; }
        E = res.E;
        raios = res.raios;
        if (id) LNUX.guardado.gravar("companhia.luzcalc." + id, { chave, total, cores: E }).catch(() => {});
      }
      // 3. pinta: a cor de cada vértice é a luz que chega nele (quem brilha continua com o material dele)
      if (cancelado()) { for (const p of partes) p.geo.dispose(); return null; }
      aoProgresso(0.99, "Pintando o mapa...");
      const assados = new Map();
      const assar = (mt) => {
        if (!mt || brilhoDoMaterial(mt)) return mt;
        if (assados.has(mt)) return assados.get(mt);
        const b = new T.MeshBasicMaterial({ name: mt.name, map: mt.map || null, color: mt.color ? mt.color.clone() : new T.Color(1, 1, 1), vertexColors: true, transparent: mt.transparent,
          opacity: mt.opacity, alphaTest: mt.alphaTest, alphaMap: mt.alphaMap || null, side: mt.side, depthWrite: mt.depthWrite, depthTest: mt.depthTest });
        b.userData.assado = true;
        assados.set(mt, b);
        return b;
      };
      for (const { o, geo, mapaV } of partes) {
        const qtd = mapaV.length, cores = new Float32Array(qtd * 3), orig = geo.attributes.color;
        const usaCorOrig = !!orig && [].concat(o.material).some((mt) => mt && mt.vertexColors);
        for (let i = 0; i < qtd; i++) {
          const u = mapaV[i] * 3;
          let cr = E[u] / Math.PI, cg = E[u + 1] / Math.PI, cb = E[u + 2] / Math.PI;
          if (usaCorOrig) { cr *= orig.getX(i); cg *= orig.getY(i); cb *= orig.getZ(i); }
          cores[i * 3] = cr; cores[i * 3 + 1] = cg; cores[i * 3 + 2] = cb;
        }
        geo.setAttribute("color", new T.BufferAttribute(cores, 3));
        o.userData.luzOriginal = { geometry: o.geometry, material: o.material };
        o.geometry = geo;
        o.material = Array.isArray(o.material) ? o.material.map(assar) : assar(o.material);
      }
      this.assado = true;
      this.desatualizado = false;
      this.calculo = { raios, segundos: (performance.now() - inicio) / 1000, guardado: !raios, vertices: total, tempos };
      this.palco.definirLuz({});
      this.palco.emit("luzes", this);
      return this.calculo;
    }
    /** Os raios: para cada ponto, a luz direta (de cada luz, do sol e do céu) e depois o rebote. Devolve {E, raios}. */
    /**
     * Tira o chuvisco (poucos raios por ponto dão pontos vizinhos um pouco diferentes): cada ponto vira a média dos
     * vizinhos perto dele e virados para o mesmo lado (a borda das sombras fica um pouco mais macia).
     */
    async suavizar(E, pos, nor, total, lado, cancelado) {
      const raio = limitar(Number.isFinite(lado) ? lado * 1.1 : 0.35, 0.15, 0.6), r2 = raio * raio;
      const num = (cx, cy, cz) => (cx + 65536) + (cy + 65536) * 131072 + (cz + 65536) * 17179869184; // três inteiros num número só (cabe exato: < 2^53)
      const grade = new Map();
      for (let i = 0; i < total; i++) {
        const k = num(Math.floor(pos[i * 3] / raio), Math.floor(pos[i * 3 + 1] / raio), Math.floor(pos[i * 3 + 2] / raio));
        let l = grade.get(k);
        if (!l) grade.set(k, (l = []));
        l.push(i);
      }
      const S = new Float32Array(total * 3);
      for (let i = 0; i < total; ) {
        const fim = performance.now() + 30;
        for (; i < total && performance.now() < fim; i++) {
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
          const cx = Math.floor(x / raio), cy = Math.floor(y / raio), cz = Math.floor(z / raio);
          let sr = 0, sg = 0, sb = 0, sw = 0;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            const l = grade.get(num(cx + a, cy + b, cz + c));
            if (!l) continue;
            for (const j of l) {
              const dx = pos[j * 3] - x, dy = pos[j * 3 + 1] - y, dz = pos[j * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > r2 || nx * nor[j * 3] + ny * nor[j * 3 + 1] + nz * nor[j * 3 + 2] < 0.85) continue;
              const w = 1 - Math.sqrt(d2) / raio + 0.05;
              sr += E[j * 3] * w; sg += E[j * 3 + 1] * w; sb += E[j * 3 + 2] * w; sw += w;
            }
          }
          S[i * 3] = sr / sw; S[i * 3 + 1] = sg / sw; S[i * 3 + 2] = sb / sw;
        }
        if (cancelado()) return null;
        await esperarQuadro();
      }
      return S;
    }
    async tracar({ pos, nor, dupla, total, arvore, q, r, aoProgresso, cancelado, lado }) {
      const T = window.THREE, p = this.palco, c = p.luzCfg;
      const ray = new T.Ray();
      let raios = 0;
      // o caminho até a luz está livre? (bater na própria lâmpada, perto do centro dela, não conta como sombra)
      const livre = (ox, oy, oz, dx, dy, dz, longe, L) => {
        raios++;
        ray.origin.set(ox, oy, oz);
        ray.direction.set(dx, dy, dz);
        const h = arvore.raycastFirst(ray, T.DoubleSide, 0, longe);
        if (!h || h.distance >= longe) return true;
        if (!L) return false;
        const qx = h.point.x - L.x, qy = h.point.y - L.y, qz = h.point.z - L.z;
        return qx * qx + qy * qy + qz * qz <= (L.raio * 1.3 + 0.02) * (L.raio * 1.3 + 0.02);
      };
      // as luzes (no mundo)
      const luzes = this.fontes.filter((f) => f.ligada && f.pos).map((f) => {
        const forca = f.forca * this.cfg.forca, alc = (f.alcanceMundo || 12) * this.cfg.alcance;
        return { x: f.pos.x, y: f.pos.y, z: f.pos.z, r: f.cor.r * forca, g: f.cor.g * forca, b: f.cor.b * forca, lum: forca, alc, alc2: alc * alc, raio: f.raioMundo || 0.08,
          n: f.normalMundo, cone: f.coneMundo };
      });
      // o sol e o céu (como estão na tela agora)
      const sol = p.luzSol ? (() => {
        const a = c.sol * Math.PI / 180, h = limitar(c.altura, 10, 88) * Math.PI / 180, cor = new T.Color(c.corSol || "#fff1dc").multiplyScalar(2.6 * (c.forcaSol ?? 1));
        return { x: Math.sin(a) * Math.cos(h), y: Math.sin(h), z: Math.cos(a) * Math.cos(h), cor };
      })() : null;
      const ceu = p.luzCeu.color.clone().multiplyScalar(p.luzCeu.intensity), chao = p.luzCeu.groundColor.clone().multiplyScalar(p.luzCeu.intensity);
      const M = q.ceu, S = limitar(r.suave | 0, 1, 4), longeCeu = 200;
      const E1 = new Float32Array(total * 3);
      const caixa = new T.Box3();
      for (let i = 0; i < total; i++) caixa.expandByPoint(v3(pos, i));
      const tamGrade = Math.max(0.5, caixa.getSize(new T.Vector3()).length() / 600);
      const celula = (x, y, z) => (Math.floor((x - caixa.min.x) / tamGrade) & 0x3ff) | ((Math.floor((y - caixa.min.y) / tamGrade) & 0x3ff) << 10) | ((Math.floor((z - caixa.min.z) / tamGrade) & 0x3ff) << 20);
      const batidas = new Int32Array(total * M).fill(-1);
      let aleat = 12345;
      const rnd = () => { aleat = (aleat * 1664525 + 1013904223) >>> 0; return aleat / 4294967296; };
      const t1 = new T.Vector3(), t2 = new T.Vector3(), nn = new T.Vector3();
      // 1ª passada: a luz direta e o céu
      for (let i = 0; i < total; ) {
        const fim = performance.now() + 30;
        for (; i < total && performance.now() < fim; i++) {
          const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
          let nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
          const duas = (dupla[i] & 1) === 1;
          let er = 0, eg = 0, eb = 0;
          for (const L of luzes) {
            const dx = L.x - px, dy = L.y - py, dz = L.z - pz, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > L.alc2) continue;
            const d = Math.sqrt(d2), lx = dx / d, ly = dy / d, lz = dz / d;
            let ndl = nx * lx + ny * ly + nz * lz, lado = 1;
            if (ndl < 0 && duas) { ndl = -ndl; lado = -1; }
            if (ndl <= 0) continue;
            const x4 = (d / L.alc) ** 4;
            let f = (1 - x4) * (1 - x4) / Math.max(d2, (L.raio + 0.25) * (L.raio + 0.25));
            if (L.n) f *= Math.max(0.15, -(L.n.x * lx + L.n.y * ly + L.n.z * lz));
            if (L.cone) { const cc = -(L.cone.dir.x * lx + L.cone.dir.y * ly + L.cone.dir.z * lz); f *= limitar((cc - L.cone.fora) / Math.max(1e-3, L.cone.dentro - L.cone.fora), 0, 1); }
            const forca = L.lum * ndl * f;
            if (forca < 0.003) continue;
            // sombra suave: raios para pontos diferentes da luz (ela tem tamanho)
            const ox = px + nx * lado * 0.012, oy = py + ny * lado * 0.012, oz = pz + nz * lado * 0.012;
            let vis = 0;
            for (let s = 0; s < S; s++) {
              let jx = 0, jy = 0, jz = 0;
              if (S > 1) { jx = (rnd() * 2 - 1) * L.raio * 0.7; jy = (rnd() * 2 - 1) * L.raio * 0.7; jz = (rnd() * 2 - 1) * L.raio * 0.7; }
              const tx = L.x + jx - ox, ty = L.y + jy - oy, tz = L.z + jz - oz, td = Math.sqrt(tx * tx + ty * ty + tz * tz);
              if (livre(ox, oy, oz, tx / td, ty / td, tz / td, td, L)) vis++;
            }
            if (!vis) continue;
            const k = ndl * f * vis / S;
            er += L.r * k; eg += L.g * k; eb += L.b * k;
          }
          if (sol) {
            let ndl = nx * sol.x + ny * sol.y + nz * sol.z, lado = 1;
            if (ndl < 0 && duas) { ndl = -ndl; lado = -1; }
            if (ndl > 0 && livre(px + nx * lado * 0.012, py + ny * lado * 0.012, pz + nz * lado * 0.012, sol.x, sol.y, sol.z, 1e4)) { er += sol.cor.r * ndl; eg += sol.cor.g * ndl; eb += sol.cor.b * ndl; }
          }
          // o céu: raios em volta da normal; o que escapa traz a cor do céu (ou do chão, para baixo); o que bate guarda onde
          if (duas && ny < -0.2) { nx = -nx; ny = -ny; nz = -nz; }
          nn.set(nx, ny, nz);
          (Math.abs(nx) < 0.9 ? t1.set(1, 0, 0) : t1.set(0, 1, 0)).cross(nn).normalize();
          t2.crossVectors(nn, t1);
          const ox = px + nx * 0.012, oy = py + ny * 0.012, oz = pz + nz * 0.012;
          let cr = 0, cg = 0, cb = 0;
          for (let s = 0; s < M; s++) {
            const u1 = (s + rnd()) / M, u2 = rnd(), rr = Math.sqrt(u1), fi = 2 * Math.PI * u2, a = rr * Math.cos(fi), b = rr * Math.sin(fi), z = Math.sqrt(1 - u1);
            const dx = t1.x * a + t2.x * b + nx * z, dy = t1.y * a + t2.y * b + ny * z, dz = t1.z * a + t2.z * b + nz * z;
            if (!r.ceu) { if (dy > 0) { const m = 0.5 + 0.5 * dy; cr += chao.r + (ceu.r - chao.r) * m; cg += chao.g + (ceu.g - chao.g) * m; cb += chao.b + (ceu.b - chao.b) * m; } continue; }
            raios++;
            ray.origin.set(ox, oy, oz);
            ray.direction.set(dx, dy, dz);
            const h = arvore.raycastFirst(ray, T.DoubleSide, 0, longeCeu);
            if (!h) { const m = 0.5 + 0.5 * dy; cr += chao.r + (ceu.r - chao.r) * m; cg += chao.g + (ceu.g - chao.g) * m; cb += chao.b + (ceu.b - chao.b) * m; }
            else if (h.distance < 40) batidas[i * M + s] = celula(h.point.x, h.point.y, h.point.z);
          }
          er += cr / M; eg += cg / M; eb += cb / M;
          E1[i * 3] = er; E1[i * 3 + 1] = eg; E1[i * 3 + 2] = eb;
        }
        aoProgresso(0.03 + 0.85 * (i / total), `Lançando os raios: ${Math.round((i / total) * 100)}% (${(raios / 1e6).toFixed(1)} milhão de raios)`);
        if (cancelado()) return null;
        await esperarQuadro();
      }
      // 2ª passada: o rebote. A luz que chegou em cada lugar (média por célula) volta para quem "viu" aquele lugar.
      const lums = [];
      for (let i = 0; i < total; i += Math.max(1, Math.floor(total / 4000))) if (!(dupla[i] & 2)) lums.push(E1[i * 3] + E1[i * 3 + 1] + E1[i * 3 + 2]);
      lums.sort((a, b) => a - b);
      const teto = Math.max(0.3, (lums[Math.floor(lums.length * 0.95)] || 1) * 1.5); // o que passa disso é um pico perto de uma luz: não volta inteiro
      const grade = new Map();
      for (let i = 0; i < total; i++) {
        if (dupla[i] & 2) continue;
        const k = celula(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        let g = grade.get(k);
        if (!g) grade.set(k, (g = [0, 0, 0, 0]));
        const soma = E1[i * 3] + E1[i * 3 + 1] + E1[i * 3 + 2], corte = soma > teto ? teto / soma : 1;
        g[0] += E1[i * 3] * corte; g[1] += E1[i * 3 + 1] * corte; g[2] += E1[i * 3 + 2] * corte; g[3]++;
      }
      const E = new Float32Array(total * 3), albedo = 0.5 * limitar(r.rebatida, 0, 2);
      for (let i = 0; i < total; i++) {
        let br = 0, bg = 0, bb = 0;
        if (albedo > 0) {
          for (let s = 0; s < M; s++) {
            const k = batidas[i * M + s];
            if (k < 0) continue;
            const g = grade.get(k);
            if (g) { br += g[0] / g[3]; bg += g[1] / g[3]; bb += g[2] / g[3]; }
          }
        }
        E[i * 3] = E1[i * 3] + albedo * br / M + 0.01;
        E[i * 3 + 1] = E1[i * 3 + 1] + albedo * bg / M + 0.01;
        E[i * 3 + 2] = E1[i * 3 + 2] + albedo * bb / M + 0.012;
      }
      aoProgresso(0.95, "Tirando o chuvisco...");
      return { E: await this.suavizar(E, pos, nor, total, lado, cancelado), raios };
    }
  }
  const v3 = (arr, i) => new window.THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);

  /**
   * Divide os triângulos maiores que "lado" (no espaço da malha) pela metade do lado maior, até caberem (com um limite
   * de triângulos). Todos os atributos são interpolados (a normal é normalizada de novo). Devolve uma geometria nova,
   * sem índice, com os grupos (materiais) refeitos.
   */
  function subdividir(geo, lado, limite) {
    const T = window.THREE, g = geo.index ? geo.toNonIndexed() : geo;
    const nomes = Object.keys(g.attributes), itens = nomes.map((k) => g.attributes[k].itemSize), passo = itens.reduce((a, b) => a + b, 0);
    const ini = [];
    let o = 0;
    for (const t of itens) { ini.push(o); o += t; }
    const iNormal = nomes.indexOf("normal"), iPos = nomes.indexOf("position");
    const P = g.attributes.position, nTri = P.count / 3;
    const fontes = nomes.map((k) => { const at = g.attributes[k]; return at.isInterleavedBufferAttribute || at.normalized ? { at } : { arr: at.array, n: at.itemSize }; });
    const ler = (i) => {
      const v = new Float32Array(passo);
      for (let a = 0; a < fontes.length; a++) {
        const f = fontes[a], o = ini[a];
        if (f.arr) { const b = i * f.n; for (let c = 0; c < f.n; c++) v[o + c] = f.arr[b + c]; }
        else for (let c = 0; c < f.at.itemSize; c++) v[o + c] = f.at.getComponent(i, c);
      }
      return v;
    };
    const saida = [];
    const grupos = (g.groups && g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }]).map((gr) => ({ ...gr }));
    const lado2 = lado * lado;
    let feitos = 0;
    const dist2 = (a, b) => { const p = ini[iPos]; const x = a[p] - b[p], y = a[p + 1] - b[p + 1], z = a[p + 2] - b[p + 2]; return x * x + y * y + z * z; };
    const meio = (a, b) => { const m = new Float32Array(passo); for (let c = 0; c < passo; c++) m[c] = (a[c] + b[c]) / 2; if (iNormal >= 0) { const q = ini[iNormal]; const l = Math.hypot(m[q], m[q + 1], m[q + 2]) || 1; m[q] /= l; m[q + 1] /= l; m[q + 2] /= l; } return m; };
    const novosGrupos = [];
    for (const gr of grupos) {
      const comeco = saida.length;
      const fila = [];
      for (let t = Math.floor(gr.start / 3); t < Math.floor((gr.start + gr.count) / 3) && t < nTri; t++) fila.push([ler(3 * t), ler(3 * t + 1), ler(3 * t + 2), 0]);
      for (let cab = 0; cab < fila.length; cab++) {
        const [a, b, c, prof] = fila[cab];
        fila[cab] = null;
        const ab = dist2(a, b), bc = dist2(b, c), ca = dist2(c, a), maior = Math.max(ab, bc, ca);
        if (maior <= lado2 || prof >= 14 || feitos + (fila.length - cab) > limite) { saida.push(a, b, c); feitos++; continue; }
        if (maior === ab) { const m = meio(a, b); fila.push([a, m, c, prof + 1], [m, b, c, prof + 1]); }
        else if (maior === bc) { const m = meio(b, c); fila.push([a, b, m, prof + 1], [a, m, c, prof + 1]); }
        else { const m = meio(c, a); fila.push([a, b, m, prof + 1], [m, b, c, prof + 1]); }
      }
      novosGrupos.push({ start: comeco, count: saida.length - comeco, materialIndex: gr.materialIndex || 0 });
    }
    const nova = new T.BufferGeometry();
    nomes.forEach((k, a) => {
      if (k === "color") return; // a cor dos vértices é a luz calculada (a original é multiplicada nela)
      const arr = new Float32Array(saida.length * itens[a]);
      for (let i = 0; i < saida.length; i++) for (let c = 0; c < itens[a]; c++) arr[i * itens[a] + c] = saida[i][ini[a] + c];
      nova.setAttribute(k, new T.BufferAttribute(arr, itens[a]));
    });
    if (nomes.includes("color")) {
      const a = nomes.indexOf("color"), arr = new Float32Array(saida.length * 3);
      for (let i = 0; i < saida.length; i++) for (let c = 0; c < 3; c++) arr[i * 3 + c] = c < itens[a] ? saida[i][ini[a] + c] : 1;
      nova.setAttribute("color", new T.BufferAttribute(arr, 3));
    }
    if (geo.groups && geo.groups.length) for (const gr of novosGrupos) nova.addGroup(gr.start, gr.count, gr.materialIndex);
    if (g !== geo) g.dispose();
    nova.computeBoundingBox();
    nova.computeBoundingSphere();
    return nova;
  }

  // ── o painel (vai dentro de Movimento › Cenário) ─────────────────────

  /**
   * O pedaço do painel do cenário sobre a luz. ctx: {palco: () => Palco3D, mexe: () => pode mexer no mapa (não é
   * visita numa sala), salvarAjuste: () => guarda o ajuste do cenário (e manda à sala, se for o dono)}.
   * Devolve o elemento, com .atualizar().
   */
  C.painelDeLuz = function (ctx) {
    const p = () => ctx.palco(), L = () => p().mundo.luzes;
    const faixa = (rotulo, min, max, passo, valor, aoMudar, mostrar = (v) => v) => {
      const num = el("span", { class: "valor mono" }, mostrar(valor));
      const i = el("input", { type: "range", min, max, step: passo, value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => { num.textContent = mostrar(+i.value); aoMudar(+i.value); });
      return el("label", { class: "lnux-campo faixa" }, el("span", {}, rotulo, num), i);
    };
    const marcar = (rotulo, valor, aoMudar, dica) => {
      const c = el("input", { type: "checkbox", checked: !!valor, "aria-label": rotulo });
      c.addEventListener("change", () => aoMudar(c.checked));
      return el("label", { class: "lnux-alternar", title: dica || "" }, c, rotulo);
    };
    const escolha = (rotulo, opcoes, valor, aoMudar) => {
      const s = el("select", { class: "lnux-selecao", "aria-label": rotulo }, opcoes.map(([v, r]) => el("option", { value: v, selected: String(v) === String(valor) }, r)));
      s.addEventListener("change", () => aoMudar(s.value));
      return el("label", { class: "lnux-campo" }, el("span", {}, rotulo), s);
    };
    const cor = (rotulo, valor, aoMudar) => {
      const i = el("input", { type: "color", class: "lnux-entrada", value: valor, "aria-label": rotulo });
      i.addEventListener("input", () => aoMudar(i.value));
      return el("label", { class: "lnux-campo cor-luz" }, el("span", {}, rotulo), i);
    };
    const botao = (rotulo, acao, classes = "") => el("button", { class: "lnux-botao " + classes, type: "button", onclick: async () => { try { await acao(); } catch (e) { LNUX.erro(e); } } }, rotulo);
    const x = (v) => " " + (+v).toFixed(2).replace(/\.?0+$/, "") + "×";

    const sol = el("div", { class: "ajustes" }), mapa = el("div", { class: "ajustes" }), raios = el("div", { class: "ajustes" });
    const raiz = el("div", { class: "ajustes painel-luz" },
      el("details", { open: true, class: "luz-sol" }, el("summary", {}, "Luz e sombras"), sol),
      el("details", { open: true, class: "luz-mapa" }, el("summary", {}, "Luzes do mapa"), mapa),
      el("details", { open: true, class: "luz-raios" }, el("summary", {}, "Luz calculada por raios (ray tracing)"), raios));

    const HORAS = {
      dia: { forcaSol: 1, corSol: "#fff1dc", forcaCeu: 1, corCeu: "#cfe2ff", chaoCeu: "#8a7d6c", exposicao: 1, altura: 55 },
      tarde: { forcaSol: 0.85, corSol: "#ffae6b", forcaCeu: 0.55, corCeu: "#ffc6a3", chaoCeu: "#6b5446", exposicao: 1.1, altura: 12 },
      noite: { forcaSol: 0.07, corSol: "#a9bcff", forcaCeu: 0.1, corCeu: "#3a4a85", chaoCeu: "#1d1d28", exposicao: 1.4, altura: 50 },
    };
    function desenharSol() {
      const c = p().luzCfg, defina = (m) => p().definirLuz(m);
      const hora = el("div", { class: "lnux-segmentos horas-luz", role: "group", "aria-label": "Hora do dia" },
        ...[["dia", "☀️ Dia"], ["tarde", "🌇 Fim de tarde"], ["noite", "🌙 Noite"]].map(([k, r]) => el("button", { type: "button", class: "lnux-botao" + (c.hora === k ? " ativa" : ""), "data-hora": k,
          onclick: () => { defina({ ...HORAS[k], hora: k }); desenharSol(); } }, r)));
      sol.replaceChildren(
        marcar("Luz e sombras realistas (no cenário)", c.realista, (v) => { defina({ realista: v }); }, "Um sol com sombra, céu e tons naturais. Desligado, a luz de frente de sempre (mais leve)."),
        marcar("Sombras", c.sombras, (v) => defina({ sombras: v }), "As sombras pesam: no celular, desligue se ficar lento."),
        hora,
        faixa("Direção do sol", 0, 355, 5, c.sol, (v) => defina({ sol: v }), (v) => " " + v + "°"),
        faixa("Altura do sol", 10, 85, 1, c.altura, (v) => defina({ altura: v }), (v) => " " + v + "°"),
        el("details", { class: "luz-avancado" }, el("summary", {}, "Avançado: sol, céu, exposição e sombra"), el("div", { class: "ajustes", style: { marginTop: "8px" } },
          el("div", { class: "linha" }, faixa("Força do sol", 0, 3, 0.05, c.forcaSol, (v) => defina({ forcaSol: v, hora: "" }), x), cor("Cor do sol", c.corSol, (v) => defina({ corSol: v, hora: "" }))),
          el("div", { class: "linha" }, faixa("Força do céu", 0, 3, 0.05, c.forcaCeu, (v) => defina({ forcaCeu: v, hora: "" }), x), cor("Cor do céu", c.corCeu, (v) => defina({ corCeu: v, hora: "" })),
            cor("Cor do chão", c.chaoCeu, (v) => defina({ chaoCeu: v, hora: "" }))),
          faixa("Exposição (claro ou escuro)", 0.2, 3, 0.05, c.exposicao, (v) => defina({ exposicao: v }), x),
          escolha("Tom das cores", [["neutro", "Neutro (natural)"], ["aces", "Cinema (ACES)"], ["agx", "AgX (suave)"], ["nenhum", "Sem ajuste"]], c.tom, (v) => defina({ tom: v })),
          escolha("Qualidade da sombra do sol", [["baixa", "Baixa (leve)"], ["media", "Média"], ["alta", "Alta (nítida, pesa)"]], c.qualidadeSombra, (v) => defina({ qualidadeSombra: v })),
          botao("Voltar ao padrão", () => { defina({ ...HORAS.dia, hora: "dia", tom: "neutro", qualidadeSombra: ehCelular() ? "baixa" : "media" }); desenharSol(); }, "pequeno"))));
    }
    function desenharMapa() {
      const l = L(), m = p().mundo, cfg = l.cfg, i = l.info, mexe = ctx.mexe();
      if (!m.mapa) { mapa.replaceChildren(el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Abra um cenário para achar as luzes dele.")); return; }
      const partes = i ? [i.arquivo && `${i.arquivo} do arquivo`, i.brilho && `${i.brilho} que brilham`, i.nome && `${i.nome} pelo nome`, i.minha && `${i.minha} suas`].filter(Boolean) : [];
      const resumo = l.fontes.length ? `Achei ${l.fontes.length} ${l.fontes.length === 1 ? "luz" : "luzes"}: ${partes.join(", ")}.` : "Não achei nenhuma luz neste mapa: ponha uma com \"Pôr uma luz aqui\".";
      const ajuste = m.info.ajuste;
      const gravar = () => { ctx.salvarAjuste(); l.achar(); desenharMapa(); };
      const corNova = el("input", { type: "color", class: "lnux-entrada", value: "#ffe2b8", "aria-label": "Cor da luz nova" });
      const lista = el("div", { class: "lista-luzes" }, l.fontes.map((f) => {
        const c = el("input", { type: "checkbox", checked: f.ligada, disabled: !mexe, "aria-label": "Acesa: " + f.nome });
        c.addEventListener("change", () => {
          const d = new Set(ajuste.luzesDesligadas || []);
          if (c.checked) d.delete(f.id); else d.add(f.id);
          ajuste.luzesDesligadas = [...d];
          gravar();
        });
        const icone = { arquivo: "💡", brilho: "✨", nome: "🏷️", minha: "📍" }[f.tipo];
        return el("div", { class: "linha luz-item", "data-tipo": f.tipo }, el("label", { class: "lnux-alternar" }, c, `${icone} ${f.nome}`),
          el("span", { class: "amostra-cor", style: { background: "#" + f.cor.getHexString() }, title: "Cor" }),
          f.tipo === "minha" && mexe ? botao("✕", () => { ajuste.luzes.splice(f.indice, 1); gravar(); }, "pequeno") : null);
      }));
      mapa.replaceChildren(...LNUX.filhos(
        el("p", { class: "pequeno resumo-luzes", style: { margin: 0 } }, resumo),
        i && i.pintado ? el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Este mapa já vem com a luz pintada (quase tudo nele brilha): o que brilha não virou luz.") : null,
        marcar("Acender as luzes do mapa", cfg.ligadas, (v) => { l.definir({ ligadas: v }); }),
        el("div", { class: "linha" },
          faixa("Força das luzes do mapa", 0.1, 6, 0.05, cfg.forca, (v) => { l.definir({ forca: v }); if (l.assado) l.desatualizado = true; }, x),
          faixa("Alcance", 0.3, 4, 0.05, cfg.alcance, (v) => { l.definir({ alcance: v }); if (l.assado) l.desatualizado = true; }, x)),
        el("div", { class: "linha" },
          escolha("Acesas ao mesmo tempo (as mais perto)", [[2, "2"], [4, "4"], [8, "8"], [12, "12"], [16, "16"]], cfg.juntas, (v) => l.definir({ juntas: +v })),
          escolha("Sombras das luzes do mapa", [[0, "Nenhuma"], [1, "A mais perto"], [2, "As 2 mais perto"]], cfg.sombras, (v) => l.definir({ sombras: +v }))),
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "As sombras das luzes do mapa precisam de \"Luz e sombras realistas\" e \"Sombras\" ligadas, e pesam: cada uma desenha a cena mais seis vezes."),
        marcar("Achar também pelos nomes das peças (lâmpada, vela, lanterna...)", cfg.nomes, (v) => { l.definir({ nomes: v }); desenharMapa(); }),
        mexe ? el("div", { class: "linha" }, corNova, botao("📍 Pôr uma luz aqui", () => {
          ajuste.luzes = ajuste.luzes || [];
          if (ajuste.luzes.length >= 32) throw new Error("No máximo 32 luzes suas por cenário.");
          ajuste.luzes.push({ p: l.lugarParaMinha().toArray().map((v) => +v.toFixed(3)), cor: corNova.value, forca: 1 });
          gravar();
          LNUX.aviso("Luz posta acima e na frente da personagem.", "ok");
        }, "pequeno")) : el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Na sala, só quem criou acende, apaga e põe luzes no mapa."),
        l.fontes.length ? el("details", { class: "luz-lista" }, el("summary", {}, `Lista das luzes (${l.fontes.length})`), lista) : null));
    }
    let calculando = null;
    function desenharRaios() {
      const l = L(), m = p().mundo, r = l.cfg.raios, defina = (mud) => { l.definir({ raios: mud }); };
      const estado = !m.mapa ? "Abra um cenário primeiro." : calculando ? "Calculando..." : l.assado ? (l.desatualizado ? "A luz calculada está desatualizada (o mapa ou as luzes mudaram): calcule de novo."
        : `Luz calculada${l.calculo ? (l.calculo.guardado ? " (a guardada)" : ` com ${(l.calculo.raios / 1e6).toFixed(1)} milhão de raios em ${l.calculo.segundos.toFixed(1)} s`) : ""}.`) : "Ainda não calculada: o mapa usa a luz em tempo real.";
      raios.replaceChildren(
        el("p", { class: "fraco pequeno", style: { margin: 0 } }, "Cada pedacinho do mapa lança raios para cada luz, para o sol e para o céu: as sombras de todas as luzes, a luz do céu só entrando por janelas e portas, e o rebote da luz nas paredes. Calcula uma vez (pode levar um tempo) e fica guardado; depois o mapa fica até mais leve. As personagens continuam com a luz em tempo real."),
        el("div", { class: "linha" },
          escolha("Qualidade", Object.entries(QUALIDADES).map(([k, q]) => [k, q.rotulo]), r.qualidade, (v) => defina({ qualidade: v })),
          escolha("Sombras suaves", [[1, "Duras (1 raio)"], [2, "Suaves (2 raios)"], [4, "Bem suaves (4 raios)"]], r.suave, (v) => defina({ suave: +v }))),
        marcar("O céu só entra por onde dá para vê-lo (janelas, portas)", r.ceu, (v) => defina({ ceu: v })),
        faixa("Rebote da luz", 0, 2, 0.05, r.rebatida, (v) => defina({ rebatida: v }), x),
        marcar("Calcular sozinho ao abrir um cenário", r.sozinho, (v) => defina({ sozinho: v }), "Com a luz já guardada, é na hora; sem, calcula em segundo plano."),
        el("p", { class: "pequeno estado-raios", style: { margin: 0 } }, estado),
        el("div", { class: "linha" },
          botao(l.assado ? "Calcular de novo" : "Calcular a luz", () => calcularComProgresso(), "primario pequeno calcular-luz"),
          l.assado ? botao("Tirar a luz calculada", () => { l.tirarCalculo(); desenharRaios(); }, "pequeno") : null));
      for (const b of raios.querySelectorAll("button")) b.disabled = !m.mapa || !!calculando;
    }
    async function calcularComProgresso() {
      let parar = false;
      const prog = LNUX.progresso("Luz calculada por raios", { aoCancelar: () => { parar = true; } });
      calculando = true;
      desenharRaios();
      try {
        const r = await L().calcular({ aoProgresso: (f, t) => prog.definir(f, t), cancelado: () => parar });
        if (r) LNUX.aviso(r.guardado ? "Luz calculada (a guardada)." : `Luz calculada: ${(r.raios / 1e6).toFixed(1)} milhão de raios em ${r.segundos.toFixed(1)} s.`, "ok");
      } finally { calculando = null; prog.fechar(); desenharRaios(); }
    }
    raiz.atualizar = () => { desenharSol(); desenharMapa(); desenharRaios(); };
    raiz.atualizar();
    return raiz;
  };
  C.luzes = { QUALIDADES, brilhoDoMaterial, subdividir, pedacos };
  C.LuzesDoMapa = LuzesDoMapa;
})();
