/*
 * Vídeo — motor: monta cada quadro no canvas e mantém vídeos e áudios em sincronia.
 *
 * Cada clipe de mídia tem o seu próprio elemento <video>/<audio>/<img> (criado quando chega perto de
 * aparecer). Enquanto toca, o relógio é o do navegador; a cada quadro, cada elemento é ajustado para o
 * ponto certo da mídia (e corrigido se escorregar mais de 0,25 s). O som de todos passa pelo Web Audio,
 * para ter volume, fades e para entrar na exportação (gravada do canvas + áudio pelo MediaRecorder).
 */
(function () {
  "use strict";

  const LOOKS = {
    nenhum: {},
    "preto-e-branco": { saturacao: -1, contraste: 0.1 },
    quente: { temperatura: 0.45, saturacao: 0.1 },
    frio: { temperatura: -0.45 },
    vintage: { saturacao: -0.35, contraste: -0.1, temperatura: 0.3, vinheta: 0.5, brilho: 0.05 },
    vivido: { saturacao: 0.45, contraste: 0.15 },
    cinema: { contraste: 0.2, saturacao: -0.15, temperatura: -0.15, vinheta: 0.35 },
    desbotado: { contraste: -0.25, brilho: 0.08, saturacao: -0.2 },
  };

  const suave = (x) => x * x * (3 - 2 * x);

  /** Fator de 0 a 1 de uma transição de entrada/saída, e o deslocamento que ela causa. */
  function efeitoTransicao(c, t) {
    let alfa = 1, dx = 0, escala = 1, cortina = 1;
    const aplicar = (tr, p, saindo) => {
      if (!tr || tr.tipo === "nenhuma" || p >= 1) return;
      const q = suave(Math.max(0, p));
      if (tr.tipo === "dissolver") alfa *= q;
      else if (tr.tipo === "deslizar") dx += (1 - q) * (saindo ? -1 : 1);
      else if (tr.tipo === "zoom") { escala *= 0.6 + 0.4 * q; alfa *= q; }
      else if (tr.tipo === "cortina") cortina = Math.min(cortina, q);
    };
    const desde = t - c.inicio, ate = c.inicio + c.duracao - t;
    if (c.entradaTr && c.entradaTr.duracao > 0) aplicar(c.entradaTr, desde / c.entradaTr.duracao, false);
    if (c.saidaTr && c.saidaTr.duracao > 0) aplicar(c.saidaTr, ate / c.saidaTr.duracao, true);
    return { alfa, dx, escala, cortina };
  }

  /** Volume de um clipe num instante (fades de áudio). */
  function volumeDoClipe(c, t) {
    if (c.mudo) return 0;
    const desde = t - c.inicio, ate = c.inicio + c.duracao - t;
    let f = 1;
    if (c.fadeIn > 0) f = Math.min(f, Math.max(0, desde / c.fadeIn));
    if (c.fadeOut > 0) f = Math.min(f, Math.max(0, ate / c.fadeOut));
    return Math.max(0, (c.volume ?? 1) * f);
  }

  function filtroDeCor(cor) {
    if (!cor) return "none";
    const partes = [];
    if (cor.brilho) partes.push(`brightness(${(1 + cor.brilho).toFixed(3)})`);
    if (cor.contraste) partes.push(`contrast(${(1 + cor.contraste).toFixed(3)})`);
    if (cor.saturacao) partes.push(`saturate(${Math.max(0, 1 + cor.saturacao).toFixed(3)})`);
    if (cor.matiz) partes.push(`hue-rotate(${Math.round(cor.matiz)}deg)`);
    if (cor.desfoque) partes.push(`blur(${cor.desfoque.toFixed(1)}px)`);
    return partes.length ? partes.join(" ") : "none";
  }

  /** Quebra um texto em linhas que caibam na largura. */
  function quebrarTexto(ctx, texto, largura) {
    const linhas = [];
    for (const paragrafo of String(texto).split("\n")) {
      let atual = "";
      for (const palavra of paragrafo.split(/\s+/)) {
        const teste = atual ? atual + " " + palavra : palavra;
        if (ctx.measureText(teste).width > largura && atual) { linhas.push(atual); atual = palavra; }
        else atual = teste;
      }
      linhas.push(atual);
    }
    return linhas;
  }

  class Motor {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.urls = new Map(); // id da mídia → URL (objeto do navegador ou da ponte)
      this.elementos = new Map(); // id do clipe → {el, ganho}
      this.tocando = false;
      this.audio = null;
      this.aoTerminar = null;
      this.exportando = false;
    }

    garantirAudio() {
      if (!this.audio) {
        const A = window.AudioContext || window.webkitAudioContext;
        this.audio = new A();
        this.mestre = this.audio.createGain();
        this.mestre.connect(this.audio.destination);
        this.destinoGravacao = this.audio.createMediaStreamDestination();
        this.mestre.connect(this.destinoGravacao);
      }
      if (this.audio.state === "suspended") this.audio.resume();
      return this.audio;
    }

    /** Elemento de mídia de um clipe (cria na primeira vez). */
    elemento(clipe, midia) {
      let item = this.elementos.get(clipe.id);
      const url = this.urls.get(clipe.midia);
      if (item && item.url === url) return item;
      if (item) this.descartar(clipe.id);
      if (!url || !midia) return null;
      let el;
      if (midia.tipo === "imagem") {
        el = new Image();
        el.decoding = "async";
        el.src = url;
        item = { el, url, imagem: true };
      } else {
        el = document.createElement(midia.tipo === "audio" ? "audio" : "video");
        el.preload = "auto";
        el.playsInline = true;
        el.src = url;
        item = { el, url };
        try {
          const a = this.garantirAudio();
          item.fonte = a.createMediaElementSource(el);
          item.ganho = a.createGain();
          item.fonte.connect(item.ganho).connect(this.mestre);
        } catch (e) {
          el.muted = true; // sem Web Audio: pelo menos não toca alto demais
        }
      }
      this.elementos.set(clipe.id, item);
      return item;
    }

    descartar(id) {
      const item = this.elementos.get(id);
      if (!item) return;
      try { if (!item.imagem) { item.el.pause(); item.el.removeAttribute("src"); item.el.load(); } } catch (e) { /* ok */ }
      try { item.ganho && item.ganho.disconnect(); } catch (e) { /* ok */ }
      this.elementos.delete(id);
    }

    /** Joga fora os elementos dos clipes que não existem mais (ou estão longe do cursor). */
    limpar(projeto, t) {
      for (const id of [...this.elementos.keys()]) {
        const c = projeto.clipes.find((x) => x.id === id);
        if (!c || t < c.inicio - 20 || t > c.inicio + c.duracao + 20) this.descartar(id);
      }
    }

    tempoDaMidia(c, t) {
      return c.entrada + (t - c.inicio) * (c.velocidade || 1);
    }

    /**
     * Ajusta todos os elementos para o instante t. tocando=true: dá play/pausa e corrige o escorregão;
     * tocando=false: só posiciona (e devolve uma Promise que resolve quando os quadros chegaram).
     */
    sincronizar(projeto, t, tocando) {
      const espera = [];
      const trilhas = new Map(projeto.trilhas.map((x) => [x.id, x]));
      for (const c of projeto.clipes) {
        if (c.tipo === "texto") continue;
        const midia = projeto.midias[c.midia];
        if (!midia) continue;
        const perto = t >= c.inicio - 1.5 && t < c.inicio + c.duracao;
        if (!perto && !this.elementos.has(c.id)) continue;
        const item = this.elemento(c, midia);
        if (!item || item.imagem) continue;
        const el = item.el;
        const ativo = t >= c.inicio && t < c.inicio + c.duracao;
        const trilha = trilhas.get(c.trilha);
        const audivel = ativo && trilha && !trilha.mudo;
        if (item.ganho) item.ganho.gain.value = audivel ? volumeDoClipe(c, t) : 0;
        const alvo = this.tempoDaMidia(c, Math.max(t, c.inicio));
        if (!ativo) {
          if (!el.paused) el.pause();
          // pré-carrega o começo do clipe que vai entrar
          if (t < c.inicio && Math.abs(el.currentTime - c.entrada) > 0.05 && el.readyState >= 1) el.currentTime = c.entrada;
          continue;
        }
        el.playbackRate = c.velocidade || 1;
        if (tocando) {
          if (el.paused) {
            if (Math.abs(el.currentTime - alvo) > 0.05) el.currentTime = alvo;
            const p = el.play();
            if (p && p.catch) p.catch(() => {});
          } else if (Math.abs(el.currentTime - alvo) > 0.25) {
            el.currentTime = alvo;
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - alvo) > 0.02) {
            espera.push(new Promise((r) => {
              const pronto = () => { el.removeEventListener("seeked", pronto); r(); };
              el.addEventListener("seeked", pronto);
              setTimeout(pronto, 1500);
            }));
            try { el.currentTime = alvo; } catch (e) { /* ainda sem metadados */ }
          }
        }
      }
      return Promise.all(espera);
    }

    pausarTudo() {
      for (const item of this.elementos.values()) if (!item.imagem && !item.el.paused) item.el.pause();
    }

    /** Desenha o quadro do instante t. */
    desenhar(projeto, t, { guias = false } = {}) {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.fillStyle = projeto.fundo || "#000";
      ctx.fillRect(0, 0, W, H);
      // trilhas de vídeo: a de baixo na lista primeiro (fica embaixo na imagem)
      const trilhasVideo = projeto.trilhas.filter((x) => x.tipo === "video" && !x.oculta);
      for (let i = trilhasVideo.length - 1; i >= 0; i--) {
        const tr = trilhasVideo[i];
        for (const c of projeto.clipes) {
          if (c.trilha !== tr.id || t < c.inicio || t >= c.inicio + c.duracao) continue;
          if (c.tipo === "texto") this.desenharTexto(projeto, c, t);
          else this.desenharMidia(projeto, c, t);
        }
      }
      ctx.restore();
      if (guias) this.desenharGuias();
    }

    retanguloDaMidia(projeto, c, largura, altura) {
      const W = this.canvas.width, H = this.canvas.height;
      const ajuste = Math.min(W / largura, H / altura); // cabe inteiro na tela
      const m = c.mov || {};
      const escala = ajuste * (m.escala ?? 1);
      const w = largura * escala, h = altura * escala;
      return { cx: W / 2 + (m.x || 0) * W, cy: H / 2 + (m.y || 0) * H, w, h };
    }

    desenharMidia(projeto, c, t) {
      const midia = projeto.midias[c.midia];
      if (!midia || midia.tipo === "audio") return;
      const item = this.elementos.get(c.id) || this.elemento(c, midia);
      if (!item) return;
      const el = item.el;
      const largura = item.imagem ? el.naturalWidth : el.videoWidth;
      const altura = item.imagem ? el.naturalHeight : el.videoHeight;
      if (!largura || !altura || (!item.imagem && el.readyState < 2)) return;
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      const r = this.retanguloDaMidia(projeto, c, largura, altura);
      const tr = efeitoTransicao(c, t);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (c.mov?.opacidade ?? 1) * tr.alfa));
      if (tr.cortina < 1) { ctx.beginPath(); ctx.rect(0, 0, W * tr.cortina, H); ctx.clip(); }
      ctx.translate(r.cx + tr.dx * W, r.cy);
      ctx.rotate(((c.mov?.rotacao || 0) * Math.PI) / 180);
      ctx.scale(tr.escala, tr.escala);
      ctx.filter = filtroDeCor(c.cor);
      ctx.drawImage(el, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.filter = "none";
      const cor = c.cor || {};
      if (cor.temperatura) {
        ctx.globalCompositeOperation = "soft-light";
        ctx.globalAlpha *= Math.min(1, Math.abs(cor.temperatura));
        ctx.fillStyle = cor.temperatura > 0 ? "#ff8a1e" : "#1e7bff";
        ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = Math.max(0, Math.min(1, (c.mov?.opacidade ?? 1) * tr.alfa));
      }
      if (cor.vinheta) {
        const g = ctx.createRadialGradient(0, 0, Math.min(r.w, r.h) * 0.25, 0, 0, Math.hypot(r.w, r.h) / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, cor.vinheta)})`);
        ctx.fillStyle = g;
        ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      }
      ctx.restore();
    }

    /** Retângulo ocupado por um texto (para clicar e arrastar no monitor). */
    medirTexto(c) {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, tx = c.texto;
      const tamanho = (tx.tamanho || 6) / 100 * H;
      ctx.save();
      ctx.font = `${tx.negrito ? "700" : "400"} ${tamanho}px ${tx.fonte || "system-ui, sans-serif"}`;
      const linhas = quebrarTexto(ctx, tx.conteudo || "", W * 0.86);
      const largura = Math.max(...linhas.map((l) => ctx.measureText(l).width), 1);
      ctx.restore();
      const alturaLinha = tamanho * 1.25;
      const altura = linhas.length * alturaLinha;
      const base = { cima: 0.12, meio: 0.5, baixo: 0.86 }[tx.posicao] ?? 0.86;
      const cx = W / 2 + (c.mov?.x || 0) * W;
      const cy = base * H + (c.mov?.y || 0) * H;
      return { linhas, tamanho, alturaLinha, largura, altura, cx, cy };
    }

    desenharTexto(projeto, c, t) {
      const tx = c.texto;
      if (!tx || !tx.conteudo) return;
      const ctx = this.ctx, W = this.canvas.width;
      const m = this.medirTexto(c);
      const tr = efeitoTransicao(c, t);
      const desde = t - c.inicio;
      let alfa = (c.mov?.opacidade ?? 1) * tr.alfa, dy = 0, escala = (c.mov?.escala ?? 1) * tr.escala, visiveis = Infinity;
      const anim = tx.animacao || "nenhuma", dur = Math.min(0.6, c.duracao / 3);
      if (anim === "aparecer") alfa *= suave(Math.min(1, desde / dur));
      if (anim === "subir") { const p = suave(Math.min(1, desde / dur)); alfa *= p; dy = (1 - p) * m.tamanho; }
      if (anim === "zoom") { const p = suave(Math.min(1, desde / dur)); escala *= 0.7 + 0.3 * p; alfa *= p; }
      if (anim === "digitar") visiveis = Math.floor((desde / Math.max(0.3, Math.min(c.duracao * 0.6, (tx.conteudo.length * 0.05)))) * tx.conteudo.length);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alfa));
      ctx.translate(m.cx + tr.dx * W, m.cy + dy);
      ctx.rotate(((c.mov?.rotacao || 0) * Math.PI) / 180);
      ctx.scale(escala, escala);
      ctx.font = `${tx.negrito ? "700" : "400"} ${m.tamanho}px ${tx.fonte || "system-ui, sans-serif"}`;
      ctx.textAlign = tx.alinhamento || "center";
      ctx.textBaseline = "middle";
      const x = ctx.textAlign === "left" ? -m.largura / 2 : ctx.textAlign === "right" ? m.largura / 2 : 0;
      if (tx.fundo && tx.fundo.ligado) {
        const folga = m.tamanho * 0.35;
        ctx.fillStyle = tx.fundo.cor || "#000";
        ctx.globalAlpha *= tx.fundo.opacidade ?? 0.6;
        const rr = (ctx.roundRect ? (a, b, w, h) => { ctx.beginPath(); ctx.roundRect(a, b, w, h, folga * 0.6); ctx.fill(); } : (a, b, w, h) => ctx.fillRect(a, b, w, h));
        rr(-m.largura / 2 - folga, -m.altura / 2 - folga * 0.6, m.largura + folga * 2, m.altura + folga * 1.2);
        ctx.globalAlpha = Math.max(0, Math.min(1, alfa));
      }
      if (tx.sombra) { ctx.shadowColor = "rgba(0,0,0,.75)"; ctx.shadowBlur = m.tamanho * 0.18; ctx.shadowOffsetY = m.tamanho * 0.05; }
      ctx.fillStyle = tx.cor || "#fff";
      if (tx.contorno) { ctx.lineWidth = m.tamanho * 0.08; ctx.strokeStyle = tx.corContorno || "#000"; ctx.lineJoin = "round"; }
      let restam = visiveis;
      m.linhas.forEach((linha, i) => {
        if (restam <= 0) return;
        const parte = restam === Infinity ? linha : linha.slice(0, restam);
        restam -= linha.length + 1;
        const y = -m.altura / 2 + m.alturaLinha * (i + 0.5);
        if (tx.contorno) ctx.strokeText(parte, x, y);
        ctx.fillText(parte, x, y);
      });
      ctx.restore();
    }

    desenharGuias() {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = Math.max(1, W / 960);
      ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); // área segura de ação
      ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8); // área segura de títulos
      ctx.beginPath(); ctx.moveTo(W / 2, H * 0.47); ctx.lineTo(W / 2, H * 0.53); ctx.moveTo(W * 0.48, H / 2); ctx.lineTo(W * 0.52, H / 2); ctx.stroke();
      ctx.restore();
    }

    /** Clipe visível (o de cima) num ponto do canvas, para clicar e arrastar no monitor. */
    clipeNoPonto(projeto, t, x, y) {
      const trilhasVideo = projeto.trilhas.filter((v) => v.tipo === "video" && !v.oculta);
      for (const tr of trilhasVideo) {
        const ativos = projeto.clipes.filter((c) => c.trilha === tr.id && t >= c.inicio && t < c.inicio + c.duracao).reverse();
        for (const c of ativos) {
          let r;
          if (c.tipo === "texto") {
            const m = this.medirTexto(c);
            r = { cx: m.cx, cy: m.cy, w: m.largura + m.tamanho, h: m.altura + m.tamanho * 0.5 };
          } else {
            const midia = projeto.midias[c.midia];
            const item = this.elementos.get(c.id);
            if (!midia || midia.tipo === "audio" || !item) continue;
            const w = item.imagem ? item.el.naturalWidth : item.el.videoWidth, h = item.imagem ? item.el.naturalHeight : item.el.videoHeight;
            if (!w || !h) continue;
            r = this.retanguloDaMidia(projeto, c, w, h);
          }
          if (Math.abs(x - r.cx) <= r.w / 2 && Math.abs(y - r.cy) <= r.h / 2) return c;
        }
      }
      return null;
    }
  }

  window.VideoMotor = { Motor, LOOKS, volumeDoClipe, filtroDeCor };
})();
