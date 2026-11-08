/*
 * Vídeo — compositor WebGL2: monta cada quadro na placa de vídeo.
 *
 * Para cada trilha de vídeo (de baixo para cima) e cada clipe visível no instante t:
 *   1. a imagem do clipe (quadro do <video>, <img>, texto/forma desenhados num canvas, cor sólida, ou — na camada de
 *      ajuste — a própria imagem montada até ali) vira uma textura;
 *   2. passa pela cadeia de efeitos do clipe (um shader por efeito, alternando entre duas texturas);
 *   3. entra na imagem final pelo shader de composição, que faz a transformação inversa (posição, escala, rotação,
 *      ponto de ancoragem), o recorte, a opacidade, o modo de mistura e a máscara da transição.
 * Convenção: em todas as texturas a linha 0 é o ALTO da imagem (uv.y = 0 em cima); só o desenho final na tela vira.
 */
(function () {
  "use strict";
  const V = (window.V = window.V || {});

  const VERT = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  const CABECA_EFEITO = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTam;
uniform float uTempo;
out vec4 saida;
vec4 amostra(vec2 uv) { return texture(uTex, clamp(uv, vec2(0.0), vec2(1.0))); }
`;

  const MISTURA_GLSL = `
vec3 misturar(int m, vec3 b, vec3 s) {
  if (m == 1) return min(b, s);
  if (m == 2) return b * s;
  if (m == 3) return 1.0 - min(vec3(1.0), (1.0 - b) / max(s, 1e-4));
  if (m == 4) return max(b, s);
  if (m == 5) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 6) return min(vec3(1.0), b / max(1.0 - s, 1e-4));
  if (m == 7) return min(vec3(1.0), b + s);
  if (m == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 9) return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (sqrt(b) - b), step(0.5, s));
  if (m == 10) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (m == 11) return abs(b - s);
  if (m == 12) return b + s - 2.0 * b * s;
  if (m == 13) return max(vec3(0.0), b - s);
  if (m >= 14) {
    vec3 hb = rgb2hsv(b), hs = rgb2hsv(s);
    if (m == 14) return hsv2rgb(vec3(hs.x, hb.y, hb.z));
    if (m == 15) return hsv2rgb(vec3(hb.x, hs.y, hb.z));
    if (m == 16) { vec3 r = hsv2rgb(vec3(hs.x, hs.y, hb.z)); return r + (luma(b) - luma(r)); }
    vec3 r = b + (luma(s) - luma(b)); return clamp(r, 0.0, 1.0);
  }
  return s;
}`;

  const COMPOSICAO = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCamada, uFundo;
uniform vec2 uSaida;        // tamanho da imagem final (px)
uniform vec2 uTamCamada;    // tamanho da camada (px)
uniform mat3 uInversa;      // px da saída (y para baixo) → px da camada
uniform vec4 uRecorte;      // esquerda, topo, direita, baixo (0..1)
uniform float uSuavizar, uOpacidade, uProg, uDir;
uniform int uMistura, uTrans, uLado;
out vec4 saida;
//GLSL_COMUM
${MISTURA_GLSL}
float mascaraTransicao(vec2 s) { // s: 0..1 na tela, y para baixo
  if (uTrans == 0 || uLado == 0) return 1.0;
  float p = uProg, borda = 0.015;
  int d = int(uDir + 0.5);
  float x = d == 0 ? s.x : d == 1 ? 1.0 - s.x : d == 2 ? s.y : 1.0 - s.y;
  vec2 c = (s - 0.5) * vec2(uSaida.x / uSaida.y, 1.0);
  if (uTrans == 7) return 1.0 - smoothstep(p - borda, p + borda, x);                       // limpar
  if (uTrans == 8) return 1.0 - smoothstep(p / 2.0 - borda, p / 2.0 + borda, abs(s.x - 0.5)); // portas
  if (uTrans == 9) return step(fract(s.y * 10.0), p);                                       // persianas
  if (uTrans == 10) { float a = atan(c.x, -c.y) / 6.2831853 + 0.5; return step(a, p); }     // relógio
  if (uTrans == 11) return 1.0 - smoothstep(p * 1.05 - borda, p * 1.05 + borda, length(c) / 1.02); // íris
  if (uTrans == 12) return 1.0 - smoothstep(p * 1.6 - borda, p * 1.6 + borda, abs(c.x) + abs(c.y)); // losango
  return 1.0;
}
void main() {
  vec2 px = vec2(vUv.x * uSaida.x, vUv.y * uSaida.y);
  vec4 fundo = texture(uFundo, vUv);
  vec3 q = uInversa * vec3(px, 1.0);
  vec2 uv = q.xy / uTamCamada;
  float dentro = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 cam = texture(uCamada, clamp(uv, 0.0, 1.0));
  // recorte com borda suave (uSuavizar em px da camada)
  vec2 sv = vec2(uSuavizar) / uTamCamada + 1e-5;
  float r = smoothstep(uRecorte.x, uRecorte.x + sv.x, uv.x) * smoothstep(uRecorte.y, uRecorte.y + sv.y, uv.y)
          * (1.0 - smoothstep(1.0 - uRecorte.z - sv.x, 1.0 - uRecorte.z, uv.x)) * (1.0 - smoothstep(1.0 - uRecorte.w - sv.y, 1.0 - uRecorte.w, uv.y));
  float a = cam.a * dentro * r * uOpacidade * mascaraTransicao(vUv);
  vec3 m = misturar(uMistura, fundo.rgb, cam.rgb);
  saida = vec4(mix(fundo.rgb, m, a), 1.0);
}`;

  const COPIA = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uVirar;
out vec4 saida;
void main() { saida = texture(uTex, vec2(vUv.x, uVirar > 0.5 ? 1.0 - vUv.y : vUv.y)); }`;

  const COR_SOLIDA = `#version 300 es
precision highp float;
uniform vec4 uCor;
out vec4 saida;
void main() { saida = uCor; }`;

  const composicaoFonte = () => COMPOSICAO.replace("//GLSL_COMUM", V.GLSL_COMUM);
  const IDS_MISTURA = Object.fromEntries(["normal", "escurecer", "multiplicar", "superexpor", "clarear", "tela", "subexpor", "adicao", "sobrepor",
    "luz-suave", "luz-forte", "diferenca", "exclusao", "subtrair", "matiz", "saturacao", "cor", "luminosidade"].map((id, i) => [id, i]));
  const IDS_TRANSICAO = { dissolver: 1, preto: 2, branco: 3, desfocar: 4, empurrar: 5, deslizar: 6, limpar: 7, portas: 8, persianas: 9,
    relogio: 10, iris: 11, "iris-losango": 12, zoom: 13, girar: 14 };

  const hexParaRgb = (h) => { const n = parseInt(String(h || "#000000").slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

  // ── Matrizes 3×3 (coluna por coluna, como o GLSL espera) ─────────────
  const mul = (a, b) => {
    const r = new Float32Array(9);
    for (let c = 0; c < 3; c++) for (let l = 0; l < 3; l++) r[c * 3 + l] = a[l] * b[c * 3] + a[3 + l] * b[c * 3 + 1] + a[6 + l] * b[c * 3 + 2];
    return r;
  };
  const translacao = (x, y) => new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);
  const escala = (x, y) => new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);
  const rotacao = (rad) => { const c = Math.cos(rad), s = Math.sin(rad); return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]); };

  // ── Desenho de textos e formas (canvas 2D; também usado nas miniaturas) ─

  function quebrarTexto(ctx, texto, largura) {
    const linhas = [];
    for (const paragrafo of String(texto).split("\n")) {
      let atual = "";
      for (const palavra of paragrafo.split(/\s+/)) {
        const teste = atual ? atual + " " + palavra : palavra;
        if (ctx.measureText(teste).width > largura && atual) { linhas.push(atual); atual = palavra; } else atual = teste;
      }
      linhas.push(atual);
    }
    return linhas;
  }
  const suave = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  /** Desenha um clipe de texto ou forma num canvas do tamanho do projeto (W×H), no instante tLocal do clipe. */
  function desenharGrafico(ctx, c, tLocal, W, H) {
    ctx.clearRect(0, 0, W, H);
    if (c.tipo === "forma") {
      const f = c.forma;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      if (f.sombra) { ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = H * 0.02; ctx.shadowOffsetY = H * 0.008; }
      ctx.beginPath();
      if (f.tipo === "elipse") ctx.ellipse(0, 0, f.largura / 2, f.altura / 2, 0, 0, Math.PI * 2);
      else if (f.tipo === "linha") { ctx.moveTo(-f.largura / 2, 0); ctx.lineTo(f.largura / 2, 0); }
      else if (ctx.roundRect) ctx.roundRect(-f.largura / 2, -f.altura / 2, f.largura, f.altura, Math.min(f.raio || 0, f.largura / 2, f.altura / 2));
      else ctx.rect(-f.largura / 2, -f.altura / 2, f.largura, f.altura);
      if (f.tipo !== "linha" && f.preenchimento) {
        if (f.gradiente) { const g = ctx.createLinearGradient(-f.largura / 2, 0, f.largura / 2, 0); g.addColorStop(0, f.preenchimento); g.addColorStop(1, f.gradiente); ctx.fillStyle = g; }
        else ctx.fillStyle = f.preenchimento;
        ctx.fill();
      }
      const esp = f.tipo === "linha" ? Math.max(1, f.espessura || 6) : f.espessura;
      if (esp > 0) { ctx.shadowColor = "transparent"; ctx.lineWidth = esp; ctx.lineCap = "round"; ctx.strokeStyle = f.contorno || "#fff"; ctx.stroke(); }
      ctx.restore();
      return;
    }
    const tx = c.texto;
    if (!tx || !tx.conteudo) return;
    const tamanho = (tx.tamanho || 7) / 100 * H;
    ctx.save();
    ctx.font = `${tx.italico ? "italic " : ""}${tx.negrito ? "700" : "400"} ${tamanho}px ${tx.fonte || "system-ui, sans-serif"}`;
    const linhas = quebrarTexto(ctx, tx.conteudo, W * (tx.animacao === "letreiro" ? 100 : 0.88));
    const alturaLinha = tamanho * (tx.entrelinha || 1.22);
    const largura = Math.max(1, ...linhas.map((l) => ctx.measureText(l).width));
    const altura = linhas.length * alturaLinha;
    let cx = W / 2, cy = ({ cima: 0.13, meio: 0.5, baixo: 0.85 }[tx.posicao] ?? 0.5) * H;
    let alfa = 1, esc = 1, visiveis = Infinity;
    const anim = tx.animacao || "nenhuma", dur = Math.min(0.6, c.duracao / 3);
    if (anim === "aparecer") alfa = suave(tLocal / dur);
    else if (anim === "subir") { const p = suave(tLocal / dur); alfa = p; cy += (1 - p) * tamanho; }
    else if (anim === "zoom") { const p = suave(tLocal / dur); alfa = p; esc = 0.7 + 0.3 * p; }
    else if (anim === "digitar") visiveis = Math.floor((tLocal / Math.max(0.3, Math.min(c.duracao * 0.6, tx.conteudo.length * 0.05))) * tx.conteudo.length);
    else if (anim === "rolar") cy = H + altura / 2 - (tLocal / Math.max(0.1, c.duracao)) * (H + altura); // créditos subindo
    else if (anim === "letreiro") cx = W + largura / 2 - (tLocal / Math.max(0.1, c.duracao)) * (W + largura); // letreiro andando
    ctx.globalAlpha = alfa;
    ctx.translate(cx, cy);
    ctx.scale(esc, esc);
    ctx.textAlign = tx.alinhamento || "center";
    ctx.textBaseline = "middle";
    const x = ctx.textAlign === "left" ? -largura / 2 : ctx.textAlign === "right" ? largura / 2 : 0;
    if (tx.fundo && tx.fundo.ligado) {
      const folga = tamanho * 0.35;
      ctx.save();
      ctx.globalAlpha = alfa * (tx.fundo.opacidade ?? 0.6);
      ctx.fillStyle = tx.fundo.cor || "#000";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-largura / 2 - folga, -altura / 2 - folga * 0.6, largura + folga * 2, altura + folga * 1.2, folga * 0.5); else ctx.rect(-largura / 2 - folga, -altura / 2 - folga * 0.6, largura + folga * 2, altura + folga * 1.2);
      ctx.fill();
      ctx.restore();
    }
    if (tx.sombra) { ctx.shadowColor = "rgba(0,0,0,.75)"; ctx.shadowBlur = tamanho * 0.18; ctx.shadowOffsetY = tamanho * 0.05; }
    ctx.fillStyle = tx.cor || "#fff";
    if (tx.contorno) { ctx.lineWidth = tamanho * (tx.espessuraContorno || 8) / 100; ctx.strokeStyle = tx.corContorno || "#000"; ctx.lineJoin = "round"; }
    let restam = visiveis;
    linhas.forEach((linha, i) => {
      if (restam <= 0) return;
      const parte = restam === Infinity ? linha : linha.slice(0, restam);
      restam -= linha.length + 1;
      const y = -altura / 2 + alturaLinha * (i + 0.5);
      if (tx.contorno) ctx.strokeText(parte, x, y);
      ctx.fillText(parte, x, y);
    });
    ctx.restore();
  }

  // ── O compositor ─────────────────────────────────────────────────────

  class Render {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      this.ok = !!this.gl;
      if (!this.ok) return;
      const gl = this.gl;
      this.programas = new Map();
      this.texturas = new Map(); // chave → {tex, w, h}
      this.livres = []; // texturas+fbos temporários {tex, fbo, w, h}
      this.vao = gl.createVertexArray();
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.canvasGrafico = document.createElement("canvas");
      this.curvas = new Map(); // uid do efeito → {tex, assinatura}
      this.erros = new Set();
    }

    // ── recursos

    programa(chave, frag) {
      let p = this.programas.get(chave);
      if (p) return p;
      const gl = this.gl;
      const compilar = (tipo, src) => {
        const s = gl.createShader(tipo);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader ${chave}: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Programa ${chave}: ${gl.getProgramInfoLog(prog)}`);
      p = { prog, unif: new Map() };
      this.programas.set(chave, p);
      return p;
    }
    u(p, nome) {
      if (!p.unif.has(nome)) p.unif.set(nome, this.gl.getUniformLocation(p.prog, nome));
      return p.unif.get(nome);
    }

    novaTextura(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return tex;
    }
    /** Textura + framebuffer temporários (reaproveitados entre quadros). */
    alvo(w, h) {
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      const i = this.livres.findIndex((x) => x.w === w && x.h === h);
      if (i >= 0) return this.livres.splice(i, 1)[0];
      const gl = this.gl;
      const tex = this.novaTextura(w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w, h };
    }
    devolver(a) { if (a) this.livres.push(a); }

    /** Sobe a imagem de um elemento (video, img, canvas) para a textura da chave. */
    subir(chave, fonte, w, h) {
      const gl = this.gl;
      let t = this.texturas.get(chave);
      if (!t) { t = { tex: this.novaTextura(1, 1), w: 0, h: 0 }; this.texturas.set(chave, t); }
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fonte);
        t.w = w; t.h = h;
      } catch (e) { return null; }
      return t;
    }
    esquecer(chave) {
      const t = this.texturas.get(chave);
      if (t) { this.gl.deleteTexture(t.tex); this.texturas.delete(chave); }
    }

    passe(prog, destino, w, h) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, destino ? destino.fbo : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog.prog);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    usarTextura(prog, nome, tex, unidade) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unidade);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.u(prog, nome), unidade);
    }

    // ── efeitos

    programaDoEfeito(def) {
      const unifs = def.params.filter((p) => !p.grupo).map((p) => `uniform ${p.tipo === "cor" ? "vec3" : "float"} u_${p.id};`).join("\n");
      return this.programa("fx:" + def.id, CABECA_EFEITO + V.GLSL_COMUM + unifs + "\n" + def.glsl + "\nvoid main() { saida = efeito(vUv); }");
    }

    /** Roda um efeito; devolve o alvo novo (o de entrada é devolvido ao chamador). */
    aplicarEfeito(def, params, fonte, w, h, tempo, uid) {
      const gl = this.gl;
      let prog;
      try { prog = this.programaDoEfeito(def); } catch (e) {
        if (!this.erros.has(def.id)) { console.error(e); this.erros.add(def.id); }
        return null;
      }
      let atual = fonte, criados = [];
      const passes = def.passes || 1;
      for (let passe = 0; passe < passes; passe++) {
        const destino = this.alvo(w, h);
        gl.useProgram(prog.prog);
        this.usarTextura(prog, "uTex", atual.tex, 0);
        gl.uniform2f(this.u(prog, "uTam"), w, h);
        gl.uniform1f(this.u(prog, "uTempo"), tempo);
        gl.uniform1f(this.u(prog, "uPasse"), passe);
        for (const p of def.params) {
          if (p.grupo) continue;
          const v = params[p.id];
          if (p.tipo === "cor") gl.uniform3fv(this.u(prog, "u_" + p.id), hexParaRgb(v));
          else gl.uniform1f(this.u(prog, "u_" + p.id), p.tipo === "sim" ? (v ? 1 : 0) : +v || 0);
        }
        if (def.curvas) this.usarTextura(prog, "uCurvas", this.texturaCurvas(uid, params._curvas), 1);
        this.passe(prog, destino, w, h);
        criados.push(destino);
        atual = destino;
      }
      for (const c of criados.slice(0, -1)) this.devolver(c);
      return atual;
    }

    texturaCurvas(uid, curvas) {
      const gl = this.gl;
      const assinatura = JSON.stringify(curvas || null);
      let c = this.curvas.get(uid);
      if (c && c.assinatura === assinatura) return c.tex;
      if (!c) { c = { tex: gl.createTexture() }; this.curvas.set(uid, c); }
      gl.activeTexture(gl.TEXTURE3); // unidade à parte: não pode trocar a textura da imagem que já está ligada na 0
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, V.tabelaDasCurvas(curvas || V.curvasPadrao()));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      c.assinatura = assinatura;
      return c.tex;
    }

    // ── o quadro

    /**
     * Desenha o projeto no instante t. fontes(clipe) → {el, w, h, chave} da imagem do clipe (ou null).
     * opcoes: {escala (resolução de reprodução 0..1), semEfeitos}
     */
    desenhar(projeto, t, fontes, opcoes = {}) {
      const gl = this.gl;
      const esc = opcoes.escala || 1;
      const W = Math.max(2, Math.round(projeto.largura * esc)), H = Math.max(2, Math.round(projeto.altura * esc));
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      let acum = this.alvo(W, H);
      // fundo
      const cor = this.programa("cor", COR_SOLIDA);
      gl.useProgram(cor.prog);
      gl.uniform4f(this.u(cor, "uCor"), ...hexParaRgb(projeto.fundo || "#000000"), 1);
      this.passe(cor, acum, W, H);

      const trilhasVideo = projeto.trilhas.filter((x) => x.tipo === "video");
      for (let i = trilhasVideo.length - 1; i >= 0; i--) {
        const trilha = trilhasVideo[i];
        if (trilha.oculta) continue;
        for (const item of this.itensDaTrilha(projeto, trilha.id, t)) {
          acum = this.desenharItem(projeto, item, t, acum, W, H, esc, fontes, opcoes);
        }
      }
      // na tela (virando)
      const copia = this.programa("copia", COPIA);
      gl.useProgram(copia.prog);
      this.usarTextura(copia, "uTex", acum.tex, 0);
      gl.uniform1f(this.u(copia, "uVirar"), 1);
      this.passe(copia, null, W, H);
      this.ultimo = acum;
      if (this.anterior && this.anterior !== acum) this.devolver(this.anterior);
      this.anterior = acum;
    }

    /**
     * Itens a desenhar numa trilha no instante t: os clipes visíveis e, nas transições, os dois lados.
     * Cada item: {clipe, trans?: {tipo, prog, lado (0 = sai, 1 = entra), dir}}
     */
    itensDaTrilha(projeto, trilha, t) {
      const itens = [];
      const transicoes = (projeto.transicoes || []).filter((x) => x.trilha === trilha);
      const porId = (id) => projeto.clipes.find((c) => c.id === id);
      const emTransicao = new Set();
      for (const tr of transicoes) {
        const a = tr.a && porId(tr.a), b = tr.b && porId(tr.b);
        let de, ate;
        if (a && b) { const corte = b.inicio; de = corte - tr.duracao / 2; ate = corte + tr.duracao / 2; }
        else if (b) { de = b.inicio; ate = b.inicio + tr.duracao; }
        else if (a) { de = V.fim(a) - tr.duracao; ate = V.fim(a); }
        else continue;
        if (t < de || t >= ate) continue;
        const prog = (t - de) / Math.max(1e-6, ate - de);
        if (a) { itens.push({ clipe: a, trans: { tipo: tr.tipo, prog: b ? prog : 1 - prog, lado: b ? 0 : 1, dir: tr.direcao || 0, doisLados: !!b } }); emTransicao.add(a.id); }
        if (b) { itens.push({ clipe: b, trans: { tipo: tr.tipo, prog, lado: 1, dir: tr.direcao || 0, doisLados: !!a } }); emTransicao.add(b.id); }
      }
      const normais = projeto.clipes.filter((c) => c.trilha === trilha && c.ativo !== false && !emTransicao.has(c.id) && t >= c.inicio && t < V.fim(c));
      return [...normais, ...itens.map((x) => x)].map((x) => (x.clipe ? x : { clipe: x }));
    }

    desenharItem(projeto, item, t, acum, W, H, esc, fontes, opcoes) {
      const gl = this.gl;
      const c = item.clipe;
      const tLocal = t - c.inicio;
      // 1) a imagem do clipe
      let camada = null, cw, ch, temporario = null;
      if (c.tipo === "ajuste") {
        cw = W; ch = H;
        camada = { tex: acum.tex };
      } else if (c.tipo === "cor") {
        cw = W; ch = H;
        temporario = this.alvo(W, H);
        const p = this.programa("cor", COR_SOLIDA);
        gl.useProgram(p.prog);
        gl.uniform4f(this.u(p, "uCor"), ...hexParaRgb(c.cor), 1);
        this.passe(p, temporario, W, H);
        camada = temporario;
      } else if (c.tipo === "texto" || c.tipo === "forma") {
        const cv = this.canvasGrafico;
        if (cv.width !== projeto.largura || cv.height !== projeto.altura) { cv.width = projeto.largura; cv.height = projeto.altura; }
        desenharGrafico(cv.getContext("2d"), c, tLocal, projeto.largura, projeto.altura);
        const tx = this.subir("g:" + c.id, cv, projeto.largura, projeto.altura);
        if (!tx) return acum;
        camada = tx; cw = projeto.largura; ch = projeto.altura;
      } else {
        const f = fontes(c, t);
        if (!f || !f.w || !f.h) return acum;
        const tx = this.subir("m:" + c.id, f.el, f.w, f.h);
        if (!tx) return acum;
        camada = tx; cw = f.w; ch = f.h;
      }
      // 2) efeitos (em resolução limitada, para não pesar)
      const limite = Math.max(W, H) * 1.25;
      const fator = Math.min(1, limite / Math.max(cw, ch));
      const ew = Math.max(1, Math.round(cw * fator)), eh = Math.max(1, Math.round(ch * fator));
      let atual = camada, propria = temporario;
      const efeitos = (c.efeitos || []).filter((fx) => fx.ativo && !fx.audio);
      const transBlur = item.trans && item.trans.tipo === "desfocar" ? Math.sin(Math.PI * Math.min(1, Math.max(0, item.trans.prog))) * 30 * esc : 0;
      if (!opcoes.semEfeitos && (efeitos.length || transBlur > 0.3)) {
        if (fator < 1 || c.tipo === "ajuste") { // copia reduzindo (e, na camada de ajuste, desacoplando do acumulado)
          const d = this.alvo(ew, eh);
          const copia = this.programa("copia", COPIA);
          gl.useProgram(copia.prog);
          this.usarTextura(copia, "uTex", atual.tex, 0);
          gl.uniform1f(this.u(copia, "uVirar"), 0);
          this.passe(copia, d, ew, eh);
          if (propria) this.devolver(propria);
          atual = propria = d;
        }
        const lista = efeitos.map((fx) => ({ def: V.definicaoEfeito(fx.id), params: { ...V.paramsNoTempo(c, fx, tLocal), _curvas: fx.curvas }, uid: fx.uid })).filter((x) => x.def && x.def.glsl);
        if (transBlur > 0.3) lista.push({ def: V.definicaoEfeito("desfoque-gaussiano"), params: { intensidade: transBlur, direcao: 0 }, uid: "trans" });
        for (const fx of lista) {
          const r = this.aplicarEfeito(fx.def, fx.params, atual, ew, eh, t, fx.uid);
          if (!r) continue;
          if (propria) this.devolver(propria);
          atual = propria = r;
        }
      }
      // 3) composição
      const novo = this.alvo(W, H);
      const p = this.programa("composicao", composicaoFonte());
      gl.useProgram(p.prog);
      this.usarTextura(p, "uCamada", atual.tex, 0);
      this.usarTextura(p, "uFundo", acum.tex, 1);
      gl.uniform2f(this.u(p, "uSaida"), W, H);
      gl.uniform2f(this.u(p, "uTamCamada"), cw, ch);
      const ehQuadroTodo = c.tipo === "ajuste" || c.tipo === "cor";
      gl.uniformMatrix3fv(this.u(p, "uInversa"), false, this.matrizInversa(projeto, c, tLocal, cw, ch, esc, item.trans, W, H, ehQuadroTodo));
      const r = (k) => Math.min(1, Math.max(0, (V.valor(c, "rec." + k, tLocal) || 0) / 100));
      gl.uniform4f(this.u(p, "uRecorte"), r("esquerda"), r("topo"), r("direita"), r("baixo"));
      gl.uniform1f(this.u(p, "uSuavizar"), Math.max(0, V.valor(c, "rec.suavizar", tLocal) || 0));
      let opac = Math.min(1, Math.max(0, (V.valor(c, "opac.valor", tLocal) ?? 100) / 100));
      const tr = item.trans;
      let tipoTrans = 0;
      if (tr) {
        tipoTrans = IDS_TRANSICAO[tr.tipo] || 1;
        if (tr.lado === 1 && ["dissolver", "desfocar", "zoom", "girar"].includes(tr.tipo)) opac *= Math.min(1, Math.max(0, tr.prog));
        if (tr.tipo === "preto" || tr.tipo === "branco") opac *= tr.lado === 0 ? 1 : Math.max(0, tr.prog * 2 - 1);
      }
      gl.uniform1f(this.u(p, "uOpacidade"), opac);
      gl.uniform1i(this.u(p, "uMistura"), IDS_MISTURA[(c.opac && c.opac.mistura) || "normal"] || 0);
      gl.uniform1i(this.u(p, "uTrans"), tipoTrans);
      gl.uniform1i(this.u(p, "uLado"), tr ? tr.lado : 0);
      gl.uniform1f(this.u(p, "uProg"), tr ? Math.min(1, Math.max(0, tr.prog)) : 0);
      gl.uniform1f(this.u(p, "uDir"), tr ? tr.dir : 0);
      this.passe(p, novo, W, H);
      if (propria) this.devolver(propria);
      if (acum !== this.anterior) this.devolver(acum);
      // mergulhar no preto/branco: depois do clipe que sai, uma camada da cor por cima
      if (tr && (tr.tipo === "preto" || tr.tipo === "branco") && tr.lado === 0) {
        const k = tr.doisLados ? Math.min(1, tr.prog * 2) : tr.prog;
        return this.cobrir(novo, tr.tipo === "preto" ? [0, 0, 0] : [1, 1, 1], k, W, H);
      }
      if (tr && (tr.tipo === "preto" || tr.tipo === "branco") && tr.lado === 1 && !tr.doisLados) {
        return this.cobrir(novo, tr.tipo === "preto" ? [0, 0, 0] : [1, 1, 1], 1 - tr.prog, W, H);
      }
      return novo;
    }

    cobrir(acum, rgb, quanto, W, H) {
      if (quanto <= 0) return acum;
      const gl = this.gl;
      const novo = this.alvo(W, H);
      const p = this.programa("composicao", composicaoFonte());
      const solido = this.alvo(2, 2);
      const cor = this.programa("cor", COR_SOLIDA);
      gl.useProgram(cor.prog);
      gl.uniform4f(this.u(cor, "uCor"), ...rgb, 1);
      this.passe(cor, solido, 2, 2);
      gl.useProgram(p.prog);
      this.usarTextura(p, "uCamada", solido.tex, 0);
      this.usarTextura(p, "uFundo", acum.tex, 1);
      gl.uniform2f(this.u(p, "uSaida"), W, H);
      gl.uniform2f(this.u(p, "uTamCamada"), W, H);
      gl.uniformMatrix3fv(this.u(p, "uInversa"), false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
      gl.uniform4f(this.u(p, "uRecorte"), 0, 0, 0, 0);
      gl.uniform1f(this.u(p, "uSuavizar"), 0);
      gl.uniform1f(this.u(p, "uOpacidade"), Math.min(1, quanto));
      gl.uniform1i(this.u(p, "uMistura"), 0);
      gl.uniform1i(this.u(p, "uTrans"), 0);
      gl.uniform1i(this.u(p, "uLado"), 0);
      this.passe(p, novo, W, H);
      this.devolver(solido);
      if (acum !== this.anterior) this.devolver(acum);
      return novo;
    }

    /** px da saída → px da camada: o inverso de [transição na tela] · [posição · rotação · escala · (−âncora)]. */
    matrizInversa(projeto, c, tLocal, cw, ch, esc, tr, W, H, quadroTodo) {
      const v = (k, padrao) => { const x = V.valor(c, "mov." + k, tLocal); return x === undefined || x === null ? padrao : x; };
      let px = v("posX", projeto.largura / 2) * esc, py = v("posY", projeto.altura / 2) * esc;
      const s = v("escala", 100) / 100;
      const sx = (c.mov && c.mov.uniforme === false ? v("escalaLargura", 100) / 100 : s) * esc * (quadroTodo ? 1 / esc : 1);
      const sy = s * esc * (quadroTodo ? 1 / esc : 1);
      const rot = (v("rotacao", 0) * Math.PI) / 180;
      const ax = v("ancoraX", cw / 2), ay = v("ancoraY", ch / 2);
      // transição: deslocamento, zoom e giro na tela
      let tela = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      if (tr) {
        const p = Math.min(1, Math.max(0, tr.prog));
        // de onde o clipe que entra vem: da esquerda, da direita, de cima, de baixo
        const [fx, fy] = [[-1, 0], [1, 0], [0, -1], [0, 1]][tr.dir] || [-1, 0];
        const entra = translacao(fx * (1 - p) * W, fy * (1 - p) * H);
        if (tr.tipo === "empurrar") tela = tr.lado === 1 ? entra : translacao(-fx * p * W, -fy * p * H); // o que sai é empurrado
        else if (tr.tipo === "deslizar" && tr.lado === 1) tela = entra;
        else if ((tr.tipo === "zoom" || tr.tipo === "girar") && tr.lado === 1) {
          const k = Math.max(0.001, tr.tipo === "zoom" ? 0.3 + 0.7 * p : p);
          tela = mul(translacao(W / 2, H / 2), mul(tr.tipo === "girar" ? rotacao((1 - p) * Math.PI) : new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), mul(escala(k, k), translacao(-W / 2, -H / 2))));
        }
      }
      const direta = mul(tela, mul(translacao(px, py), mul(rotacao(rot), mul(escala(sx, sy), translacao(-ax, -ay)))));
      return inverter(direta);
    }

    /** Imagem reduzida do último quadro, para os escopos (RGBA, linha 0 em cima). */
    amostra(w = 256, h = 144) {
      if (!this.ultimo) return null;
      const gl = this.gl;
      const d = this.alvo(w, h);
      const copia = this.programa("copia", COPIA);
      gl.useProgram(copia.prog);
      this.usarTextura(copia, "uTex", this.ultimo.tex, 0);
      gl.uniform1f(this.u(copia, "uVirar"), 0);
      this.passe(copia, d, w, h);
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.devolver(d);
      return { w, h, px };
    }
  }

  /** Inversa de uma matriz 3×3 guardada coluna por coluna. */
  function inverter(m) {
    const [a, b, c, d, e, f, g, h, i] = m; // colunas (a b c), (d e f), (g h i) → linhas: [a d g], [b e h], [c f i]
    const det = a * (e * i - h * f) - d * (b * i - h * c) + g * (b * f - e * c);
    const k = Math.abs(det) < 1e-12 ? 0 : 1 / det;
    return new Float32Array([
      (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
      (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
      (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
    ]);
  }

  Object.assign(V, { Render, desenharGrafico, hexParaRgb, IDS_MISTURA });
})();
