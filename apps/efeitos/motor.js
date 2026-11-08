/*
 * Efeitos — motor: calcula o valor animado de cada propriedade e desenha a composição.
 *
 * Uma composição tem camadas (a primeira da lista fica por cima). Cada camada tem propriedades
 * (posição, escala, rotação, opacidade, desenho do contorno, desfoque, brilho, sombra, matiz). Uma
 * propriedade pode ter quadros-chave (tempo, valor, suavização) e um "tremer" (variação aleatória suave).
 * Tudo é determinístico: o mesmo instante sempre dá a mesma imagem, então dá para exportar quadro a quadro.
 */
(function () {
  "use strict";

  // ── Suavizações (de 0 a 1 → de 0 a 1) ───────────────────────────────

  const SUAVIZACOES = {
    linear: { nome: "Linear", f: (x) => x },
    suave: { nome: "Suave (entra e sai devagar)", f: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) },
    entrada: { nome: "Acelerando", f: (x) => x * x * x },
    saida: { nome: "Freando", f: (x) => 1 - Math.pow(1 - x, 3) },
    pulo: { nome: "Quicando", f: (x) => {
      const n = 7.5625, d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    } },
    elastico: { nome: "Elástico", f: (x) => (x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1) },
    passar: { nome: "Passa do ponto e volta", f: (x) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); } },
    segurar: { nome: "Segurar (pula de valor)", f: () => 0 },
  };

  const PROPRIEDADES = {
    x: { nome: "Horizontal", passo: 1, unidade: " px" },
    y: { nome: "Vertical", passo: 1, unidade: " px" },
    escala: { nome: "Tamanho", passo: 1, unidade: "%", min: 0 },
    rotacao: { nome: "Girar", passo: 1, unidade: "°" },
    opacidade: { nome: "Opacidade", passo: 1, unidade: "%", min: 0, max: 100 },
    desenho: { nome: "Desenho do contorno", passo: 1, unidade: "%", min: 0, max: 100 },
    desfoque: { nome: "Desfoque", passo: 0.5, unidade: " px", min: 0 },
    brilho: { nome: "Brilho (glow)", passo: 1, unidade: " px", min: 0 },
    sombra: { nome: "Sombra", passo: 1, unidade: " px", min: 0 },
    matiz: { nome: "Matiz", passo: 1, unidade: "°" },
  };

  /** Ruído suave (valor entre -1 e 1) para o "tremer". */
  function ruido(x, semente) {
    const h = (n) => { const s = Math.sin(n * 127.1 + semente * 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return h(i) * (1 - u) + h(i + 1) * u;
  }

  /** Valor de uma propriedade da camada no instante t (quadros-chave + tremer). */
  function valor(camada, prop, t) {
    const chaves = camada.anim && camada.anim[prop];
    let v = camada.props[prop];
    if (chaves && chaves.length) {
      if (t <= chaves[0].t) v = chaves[0].v;
      else if (t >= chaves[chaves.length - 1].t) v = chaves[chaves.length - 1].v;
      else {
        for (let i = 0; i < chaves.length - 1; i++) {
          const a = chaves[i], b = chaves[i + 1];
          if (t >= a.t && t < b.t) {
            const f = (SUAVIZACOES[a.s] || SUAVIZACOES.suave).f((t - a.t) / (b.t - a.t));
            v = a.v + (b.v - a.v) * f;
            break;
          }
        }
      }
    }
    const tr = camada.tremer && camada.tremer[prop];
    if (tr && tr.amplitude) v += tr.amplitude * ruido(t * (tr.frequencia || 2), prop.length * 7 + (camada.semente || 1));
    return v;
  }

  // ── Números aleatórios repetíveis (para as partículas) ─────────────

  function aleatorio(semente) {
    let a = semente >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── Desenho ─────────────────────────────────────────────────────────

  function caminhoDaForma(ctx, f) {
    const w = f.largura, h = f.altura;
    ctx.beginPath();
    if (f.tipo === "elipse" || f.tipo === "anel") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (f.tipo === "estrela" || f.tipo === "poligono") {
      const n = Math.max(3, f.pontas || 5), pts = f.tipo === "estrela" ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / pts;
        const raio = f.tipo === "estrela" && i % 2 ? 0.45 : 1;
        const x = Math.cos(ang) * (w / 2) * raio, y = Math.sin(ang) * (h / 2) * raio;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    } else if (f.tipo === "linha") { ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); }
    else if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(f.raio || 0, w / 2, h / 2));
    else ctx.rect(-w / 2, -h / 2, w, h);
  }
  function perimetro(f) {
    const w = f.largura, h = f.altura;
    if (f.tipo === "linha") return w;
    if (f.tipo === "elipse" || f.tipo === "anel") return Math.PI * (3 * (w + h) / 2 - Math.sqrt((3 * w + h) * (w + 3 * h)) / 2);
    if (f.tipo === "estrela") return (f.pontas || 5) * 2 * Math.hypot(w / 2 * 0.55, h / 2 * 0.55) * 1.1;
    if (f.tipo === "poligono") return (f.pontas || 5) * 2 * (w / 2) * Math.sin(Math.PI / (f.pontas || 5));
    return 2 * (w + h);
  }

  function desenharForma(ctx, c, desenho) {
    const f = c.forma;
    const progresso = Math.max(0, Math.min(1, desenho / 100));
    caminhoDaForma(ctx, f);
    if (f.tipo !== "linha" && f.tipo !== "anel" && f.preenchimento && progresso > 0) {
      ctx.save();
      ctx.globalAlpha *= progresso < 1 ? progresso * progresso : 1;
      if (f.gradiente) {
        const g = ctx.createLinearGradient(-f.largura / 2, -f.altura / 2, f.largura / 2, f.altura / 2);
        g.addColorStop(0, f.preenchimento); g.addColorStop(1, f.gradiente);
        ctx.fillStyle = g;
      } else ctx.fillStyle = f.preenchimento;
      ctx.fill();
      ctx.restore();
    }
    const espessura = f.tipo === "linha" || f.tipo === "anel" ? Math.max(1, f.espessura || 8) : f.espessura;
    if (espessura > 0) {
      ctx.lineWidth = espessura;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = f.tipo === "linha" || f.tipo === "anel" ? (f.contorno || f.preenchimento) : f.contorno;
      if (progresso < 1) { const p = perimetro(f); ctx.setLineDash([p * progresso, p * 2]); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Mede e posiciona cada letra do texto (para animar letra por letra). */
  function layoutDoTexto(ctx, tx) {
    ctx.font = `${tx.peso || 700} ${tx.tamanho}px ${tx.fonte || "system-ui, sans-serif"}`;
    const linhas = String(tx.conteudo || "").split("\n");
    const alturaLinha = tx.tamanho * (tx.entrelinha || 1.2);
    const espac = (tx.espacamento || 0) * tx.tamanho / 100;
    const letras = [];
    let largura = 0;
    const larguras = linhas.map((l) => [...l].reduce((s, ch) => s + ctx.measureText(ch).width + espac, 0) - (l.length ? espac : 0));
    largura = Math.max(1, ...larguras);
    let indice = 0, palavra = 0;
    linhas.forEach((linha, li) => {
      const lw = larguras[li];
      let x = tx.alinhamento === "left" ? -largura / 2 : tx.alinhamento === "right" ? largura / 2 - lw : -lw / 2;
      const y = -((linhas.length - 1) * alturaLinha) / 2 + li * alturaLinha;
      for (const ch of linha) {
        const w = ctx.measureText(ch).width;
        if (ch === " ") palavra++;
        letras.push({ ch, x: x + w / 2, y, w, i: indice++, palavra });
        x += w + espac;
      }
      palavra++;
    });
    return { letras, largura, altura: linhas.length * alturaLinha, total: indice, palavras: palavra };
  }

  function desenharTexto(ctx, c, t) {
    const tx = c.texto;
    const lay = layoutDoTexto(ctx, tx);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tx.cor || "#fff";
    if (tx.contorno) { ctx.strokeStyle = tx.corContorno || "#000"; ctx.lineWidth = Math.max(1, tx.tamanho * 0.06); ctx.lineJoin = "round"; }
    const desde = t - c.inicio;
    const dur = Math.max(0.05, tx.duracaoAnim || 1);
    const anim = tx.animacao || "nenhuma";
    const base = ctx.globalAlpha;
    for (const L of lay.letras) {
      if (L.ch === " ") continue;
      let dy = 0, alfa = 1, esc = 1;
      if (anim === "digitar") { if (L.i >= Math.floor((desde / dur) * lay.total)) continue; }
      else if (anim === "letras-sobem") {
        const p = Math.max(0, Math.min(1, (desde - (L.i / Math.max(1, lay.total)) * dur * 0.6) / (dur * 0.4)));
        const e = SUAVIZACOES.saida.f(p);
        dy = (1 - e) * tx.tamanho * 0.8; alfa = e;
      } else if (anim === "onda") dy = Math.sin(desde * 5 - L.i * 0.45) * tx.tamanho * 0.12;
      else if (anim === "por-palavra") { const p = Math.max(0, Math.min(1, (desde - (L.palavra / Math.max(1, lay.palavras)) * dur) / 0.25)); alfa = p; esc = 0.8 + 0.2 * SUAVIZACOES.saida.f(p); }
      else if (anim === "pular") { const p = Math.max(0, Math.min(1, (desde - (L.i / Math.max(1, lay.total)) * dur * 0.7) / (dur * 0.3))); esc = SUAVIZACOES.elastico.f(p); alfa = p > 0 ? 1 : 0; }
      if (alfa <= 0) continue;
      ctx.globalAlpha = base * alfa;
      if (esc !== 1) { ctx.save(); ctx.translate(L.x, L.y + dy); ctx.scale(esc, esc); if (tx.contorno) ctx.strokeText(L.ch, 0, 0); ctx.fillText(L.ch, 0, 0); ctx.restore(); }
      else { if (tx.contorno) ctx.strokeText(L.ch, L.x, L.y + dy); ctx.fillText(L.ch, L.x, L.y + dy); }
    }
    ctx.globalAlpha = base;
  }

  function desenharParticulas(ctx, c, t, W, H) {
    const p = c.particulas;
    const rnd0 = aleatorio(p.semente || 1);
    const cores = (p.cores && p.cores.length ? p.cores : [p.cor || "#ffd166"]);
    const desde = t - c.inicio;
    const vida = Math.max(0.3, p.vida || 2.5);
    const n = Math.min(2000, p.quantidade || 60);
    for (let i = 0; i < n; i++) {
      const r = aleatorio(Math.floor(rnd0() * 1e9) + i * 977);
      const nasce = p.direcao === "explosao" ? 0 : (i / n) * vida;
      let idade = desde - nasce;
      if (p.direcao !== "explosao") idade = ((idade % vida) + vida) % vida;
      if (idade < 0 || idade > vida || (p.direcao === "explosao" && desde < 0)) continue;
      const fr = idade / vida;
      let x = 0, y = 0;
      const vel = (p.velocidade || 200) * (0.5 + r());
      if (p.direcao === "neve") {
        x = (r() - 0.5) * W * 1.1 - c.props.x + W / 2; // espalhado na tela toda
        y = -H / 2 - 20 + idade * vel * 0.5 - c.props.y + H / 2 + (r() - 0.5) * 40;
        x += Math.sin(idade * 2 + i) * 20;
      } else if (p.direcao === "explosao") {
        const ang = r() * Math.PI * 2;
        x = Math.cos(ang) * vel * idade; y = Math.sin(ang) * vel * idade + 140 * idade * idade;
      } else {
        const espalhar = (p.espalhar ?? 40) * Math.PI / 180;
        const base = p.direcao === "baixo" ? Math.PI / 2 : p.direcao === "direita" ? 0 : p.direcao === "esquerda" ? Math.PI : -Math.PI / 2;
        const ang = base + (r() - 0.5) * espalhar;
        x = Math.cos(ang) * vel * idade; y = Math.sin(ang) * vel * idade + (p.gravidade || 0) * idade * idade;
      }
      const tam = (p.tamanho || 6) * (0.6 + r() * 0.8) * (p.direcao === "neve" ? 1 : 1 - fr * 0.5);
      ctx.globalAlpha = (1 - fr) * (fr < 0.1 ? fr * 10 : 1);
      ctx.fillStyle = cores[Math.floor(r() * cores.length)];
      if (p.forma === "quadrado" || p.forma === "confete") {
        ctx.save(); ctx.translate(x, y); ctx.rotate(r() * 6 + idade * (p.forma === "confete" ? 6 : 0));
        ctx.fillRect(-tam / 2, -tam / (p.forma === "confete" ? 4 : 2), tam, p.forma === "confete" ? tam / 2 : tam); ctx.restore();
      } else { ctx.beginPath(); ctx.arc(x, y, tam / 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  class Motor {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.midias = new Map(); // id → {el, imagem}
    }

    /** Desenha a composição no instante t. */
    desenhar(comp, t, { transparente = false } = {}) {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";
      ctx.clearRect(0, 0, W, H);
      if (!transparente && !comp.transparente) { ctx.fillStyle = comp.fundo || "#000"; ctx.fillRect(0, 0, W, H); }
      for (let i = comp.camadas.length - 1; i >= 0; i--) {
        const c = comp.camadas[i];
        if (!c.visivel || t < c.inicio || t >= c.fim) continue;
        this.desenharCamada(c, t, W, H);
      }
    }

    desenharCamada(c, t, W, H) {
      const ctx = this.ctx;
      const v = (p) => valor(c, p, t);
      const opac = Math.max(0, Math.min(100, v("opacidade"))) / 100;
      if (opac <= 0) return;
      const desenhar = () => {
        if (c.tipo === "forma") desenharForma(ctx, c, v("desenho"));
        else if (c.tipo === "texto") desenharTexto(ctx, c, t);
        else if (c.tipo === "particulas") desenharParticulas(ctx, c, t, W, H);
        else if (c.tipo === "imagem" || c.tipo === "video") {
          const m = this.midias.get(c.midia);
          if (!m) return;
          const w = m.imagem ? m.el.naturalWidth : m.el.videoWidth, h = m.imagem ? m.el.naturalHeight : m.el.videoHeight;
          if (w && h) ctx.drawImage(m.el, -w / 2, -h / 2, w, h);
        }
      };
      const filtros = [];
      const desf = v("desfoque"), sombra = v("sombra"), matiz = v("matiz"), brilho = v("brilho");
      if (desf > 0) filtros.push(`blur(${desf}px)`);
      if (matiz) filtros.push(`hue-rotate(${matiz}deg)`);
      if (sombra > 0) filtros.push(`drop-shadow(0 ${sombra * 0.4}px ${sombra}px rgba(0,0,0,.6))`);
      const transformar = () => {
        ctx.translate(v("x"), v("y"));
        ctx.rotate((v("rotacao") * Math.PI) / 180);
        const e = Math.max(0, v("escala")) / 100;
        ctx.scale(e, e);
      };
      // brilho: uma cópia desfocada e somada por baixo
      if (brilho > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = opac * 0.9;
        ctx.filter = `blur(${brilho}px)`;
        transformar();
        desenhar();
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = c.mistura || "source-over";
      ctx.globalAlpha = opac;
      ctx.filter = filtros.length ? filtros.join(" ") : "none";
      transformar();
      desenhar();
      ctx.restore();
    }

    /** Caixa da camada (sem a transformação), para o contorno e as alças no visor. */
    caixa(c) {
      if (c.tipo === "forma") return { w: c.forma.largura + (c.forma.espessura || 0), h: c.forma.tipo === "linha" ? Math.max(12, c.forma.espessura || 8) : c.forma.altura + (c.forma.espessura || 0) };
      if (c.tipo === "texto") { const l = layoutDoTexto(this.ctx, c.texto); return { w: l.largura + c.texto.tamanho * 0.2, h: l.altura }; }
      if (c.tipo === "imagem" || c.tipo === "video") {
        const m = this.midias.get(c.midia);
        if (m) { const w = m.imagem ? m.el.naturalWidth : m.el.videoWidth, h = m.imagem ? m.el.naturalHeight : m.el.videoHeight; if (w && h) return { w, h }; }
        return { w: 200, h: 120 };
      }
      return { w: 60, h: 60 };
    }
  }

  window.EfeitosMotor = { Motor, SUAVIZACOES, PROPRIEDADES, valor };
})();
