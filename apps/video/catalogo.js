/*
 * Vídeo — catálogo: efeitos de vídeo (shaders WebGL2), transições, efeitos de áudio, modos de mistura e a
 * matemática dos quadros-chave. Tudo aqui é "dado + funções puras": o render.js e o audio.js usam.
 *
 * Um efeito de vídeo tem parâmetros (número, cor, escolha, sim/não) e um trecho GLSL com a função
 *   vec4 efeito(vec2 uv)   — pode usar amostra(uv), uTam (tamanho em px), uTempo (s) e u_<parâmetro>
 * Efeitos com "passes": 2 rodam duas vezes (uPasse = 0 e 1), para desfoques separáveis.
 */
(function (raiz) {
  "use strict";
  const V = (raiz.V = raiz.V || {});

  // ── Parâmetros ──────────────────────────────────────────────────────
  // n: número (min, max, padrao, passo, unidade) · cor: "#rrggbb" · escolha: opcoes [[valor, nome]] · sim: booleano
  const n = (id, nome, min, max, padrao, passo = 1, unidade = "") => ({ id, nome, tipo: "n", min, max, padrao, passo, unidade });
  const cor = (id, nome, padrao) => ({ id, nome, tipo: "cor", padrao });
  const escolha = (id, nome, opcoes, padrao = 0) => ({ id, nome, tipo: "escolha", opcoes, padrao });
  const sim = (id, nome, padrao = false) => ({ id, nome, tipo: "sim", padrao });
  const grupo = (nome) => ({ grupo: nome });

  const LOOKS = [[0, "Nenhum"], [1, "Cinema quente"], [2, "Azul-petróleo e laranja"], [3, "Preto e branco"], [4, "Filme desbotado"],
    [5, "Vintage"], [6, "Frio"], [7, "Noir"], [8, "Vívido"]];

  // Funções GLSL comuns a todos os efeitos
  const GLSL_COMUM = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float aleat(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

  /**
   * Efeitos de vídeo. "categoria" agrupa no painel Efeitos (como no FilmCraft). "lumetri": true = o efeito de cor
   * completo, editado também no painel Cor.
   */
  const EFEITOS_VIDEO = [
    {
      id: "cor", nome: "Cor (Lumetri)", categoria: "Cor", lumetri: true,
      params: [
        grupo("Correção básica"),
        n("temperatura", "Temperatura", -100, 100, 0), n("tinta", "Tinta", -100, 100, 0),
        n("exposicao", "Exposição", -5, 5, 0, 0.05), n("contraste", "Contraste", -100, 100, 0),
        n("realces", "Realces", -100, 100, 0), n("sombras", "Sombras", -100, 100, 0),
        n("brancos", "Brancos", -100, 100, 0), n("pretos", "Pretos", -100, 100, 0),
        n("saturacao", "Saturação", 0, 200, 100), n("vibracao", "Vibração", -100, 100, 0),
        grupo("Criativo"),
        escolha("look", "Look", LOOKS), n("intensidade", "Intensidade do look", 0, 100, 100),
        n("desbotado", "Filme desbotado", 0, 100, 0), n("nitidez", "Nitidez", 0, 100, 0),
        grupo("Rodas de cor"),
        n("sombrasX", "Sombras: cor ↔", -1, 1, 0, 0.01), n("sombrasY", "Sombras: cor ↕", -1, 1, 0, 0.01), n("sombrasL", "Sombras: luz", -100, 100, 0),
        n("mediosX", "Meios-tons: cor ↔", -1, 1, 0, 0.01), n("mediosY", "Meios-tons: cor ↕", -1, 1, 0, 0.01), n("mediosL", "Meios-tons: luz", -100, 100, 0),
        n("realcesX", "Realces: cor ↔", -1, 1, 0, 0.01), n("realcesY", "Realces: cor ↕", -1, 1, 0, 0.01), n("realcesL", "Realces: luz", -100, 100, 0),
        grupo("HSL secundária"),
        sim("hsl", "Ligada"), n("hslMatiz", "Matiz da chave", 0, 360, 120), n("hslLargura", "Faixa de matiz", 1, 180, 30),
        n("hslSatMin", "Saturação mínima", 0, 100, 15), n("hslLumMin", "Luz mínima", 0, 100, 5), n("hslLumMax", "Luz máxima", 0, 100, 95),
        n("hslSuave", "Suavidade", 0, 50, 10), sim("hslMostrar", "Mostrar a máscara"),
        n("hslGirar", "Correção: girar matiz", -180, 180, 0), n("hslSat", "Correção: saturação", -100, 100, 0), n("hslLuz", "Correção: luz", -100, 100, 0),
        grupo("Vinheta"),
        n("vinheta", "Quantidade", -100, 100, 0), n("vinPonto", "Ponto médio", 0, 100, 50), n("vinRedondo", "Arredondamento", -100, 100, 0), n("vinSuave", "Suavidade", 0, 100, 50),
      ],
      curvas: true, // tem o editor de curvas RGB (vira a textura uCurvas)
      glsl: `
uniform sampler2D uCurvas;
vec3 aplicarCurvas(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return vec3(texture(uCurvas, vec2(c.r, 0.5)).r, texture(uCurvas, vec2(c.g, 0.5)).g, texture(uCurvas, vec2(c.b, 0.5)).b);
}
vec3 corDaRoda(float x, float y) { // ponto no disco → deslocamento de cor (soma zero)
  float a = atan(y, x), r = clamp(length(vec2(x, y)), 0.0, 1.0);
  vec3 h = hsv2rgb(vec3(a / 6.2831853, 1.0, 1.0));
  return (h - vec3(dot(h, vec3(1.0 / 3.0)))) * r * 0.35;
}
vec4 efeito(vec2 uv) {
  vec4 orig = amostra(uv);
  vec3 c = orig.rgb;
  if (u_nitidez > 0.0) {
    vec2 px = 1.0 / uTam;
    vec3 viz = (amostra(uv + vec2(px.x, 0.0)).rgb + amostra(uv - vec2(px.x, 0.0)).rgb + amostra(uv + vec2(0.0, px.y)).rgb + amostra(uv - vec2(0.0, px.y)).rgb) * 0.25;
    c += (c - viz) * u_nitidez / 25.0;
  }
  // temperatura e tinta
  c *= vec3(1.0 + u_temperatura / 300.0 + u_tinta / 600.0, 1.0 - u_tinta / 300.0, 1.0 - u_temperatura / 300.0 + u_tinta / 600.0);
  c *= pow(2.0, u_exposicao);
  float l = luma(c);
  // realces / sombras / brancos / pretos (curvas suaves em torno da luminância)
  float wS = 1.0 - smoothstep(0.0, 0.5, l), wR = smoothstep(0.5, 1.0, l);
  c += c * (u_sombras / 100.0) * wS * 0.8 + (u_realces / 100.0) * wR * 0.35;
  c = (c + u_pretos / 400.0) / max(0.05, 1.0 - u_brancos / 300.0 + u_pretos / 400.0); // brancos +: realces mais claros; pretos +: pretos mais claros
  c = (c - 0.5) * (1.0 + u_contraste / 100.0) + 0.5;
  // rodas de cor (lift / gamma / gain)
  l = clamp(luma(c), 0.0, 1.0);
  vec3 ws = vec3(1.0 - smoothstep(0.0, 0.45, l)), wm = vec3(1.0 - abs(l - 0.5) * 2.0), wh = vec3(smoothstep(0.55, 1.0, l));
  c += corDaRoda(u_sombrasX, u_sombrasY) * ws + corDaRoda(u_mediosX, u_mediosY) * wm + corDaRoda(u_realcesX, u_realcesY) * wh;
  c += (u_sombrasL * ws + u_mediosL * wm + u_realcesL * wh) / 250.0;
  // saturação e vibração
  l = luma(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, u_saturacao / 100.0 * (1.0 + u_vibracao / 100.0 * (1.0 - sat)));
  // looks
  vec3 look = c;
  int lk = int(u_look + 0.5);
  if (lk == 1) look = c * vec3(1.08, 1.0, 0.86) + vec3(0.02, 0.01, 0.0);
  else if (lk == 2) { float m = luma(c); look = mix(c, mix(vec3(0.0, 0.32, 0.36), vec3(1.0, 0.62, 0.35), smoothstep(0.1, 0.9, m)) * (m * 1.3 + 0.1), 0.45); }
  else if (lk == 3) look = vec3(luma(c));
  else if (lk == 4) look = mix(vec3(luma(c)), c, 0.6) * 0.85 + 0.12;
  else if (lk == 5) look = mix(vec3(luma(c)), c, 0.55) * vec3(1.1, 0.98, 0.8) + vec3(0.05, 0.03, 0.0);
  else if (lk == 6) look = c * vec3(0.88, 0.98, 1.12);
  else if (lk == 7) { float m = luma(c); look = vec3(smoothstep(0.08, 0.92, m)); }
  else if (lk == 8) look = mix(vec3(luma(c)), c, 1.45) * 1.03;
  c = mix(c, look, u_intensidade / 100.0);
  c = mix(c, c * 0.82 + 0.12, u_desbotado / 100.0);
  c = aplicarCurvas(c);
  // HSL secundária
  if (u_hsl > 0.5) {
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    float dh = abs(fract(h.x - u_hslMatiz / 360.0 + 0.5) - 0.5) * 360.0;
    float s = u_hslSuave + 0.001;
    float k = (1.0 - smoothstep(u_hslLargura, u_hslLargura + s, dh)) * smoothstep(u_hslSatMin / 100.0 - s / 100.0, u_hslSatMin / 100.0 + 0.001, h.y)
            * smoothstep(u_hslLumMin / 100.0 - s / 100.0, u_hslLumMin / 100.0 + 0.001, h.z) * (1.0 - smoothstep(u_hslLumMax / 100.0, u_hslLumMax / 100.0 + s / 100.0, h.z));
    if (u_hslMostrar > 0.5) return vec4(vec3(k), orig.a);
    vec3 h2 = vec3(fract(h.x + u_hslGirar / 360.0), clamp(h.y * (1.0 + u_hslSat / 100.0), 0.0, 1.0), clamp(h.z * (1.0 + u_hslLuz / 100.0), 0.0, 1.0));
    c = mix(c, hsv2rgb(h2), k);
  }
  // vinheta
  if (u_vinheta != 0.0) {
    vec2 d = (uv - 0.5) * 2.0;
    float aspecto = uTam.x / uTam.y;
    d.x *= mix(1.0, aspecto, (u_vinRedondo + 100.0) / 200.0);
    float r = length(d) / mix(1.0, 1.42, (u_vinRedondo + 100.0) / 200.0);
    float v = smoothstep(u_vinPonto / 100.0, u_vinPonto / 100.0 + 0.05 + u_vinSuave / 100.0, r);
    c = u_vinheta < 0.0 ? c * (1.0 + u_vinheta / 100.0 * v) : mix(c, vec3(1.0), u_vinheta / 100.0 * v);
  }
  return vec4(clamp(c, 0.0, 1.0), orig.a);
}`,
    },
    {
      id: "brilho-contraste", nome: "Brilho e contraste", categoria: "Ajuste de cor",
      params: [n("brilho", "Brilho", -100, 100, 0), n("contraste", "Contraste", -100, 100, 0)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); c.rgb = (c.rgb + u_brilho / 200.0 - 0.5) * (1.0 + u_contraste / 100.0) + 0.5; return vec4(clamp(c.rgb, 0.0, 1.0), c.a); }`,
    },
    {
      id: "matiz-saturacao", nome: "Matiz e saturação", categoria: "Ajuste de cor",
      params: [n("matiz", "Matiz", -180, 180, 0, 1, "°"), n("saturacao", "Saturação", -100, 100, 0), n("luz", "Luminosidade", -100, 100, 0), sim("colorir", "Colorir (tingir tudo de uma cor)")],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec3 h = rgb2hsv(c.rgb);
  if (u_colorir > 0.5) h = vec3(fract(u_matiz / 360.0 + 1.0), clamp(0.5 + u_saturacao / 200.0, 0.0, 1.0), h.z);
  else h = vec3(fract(h.x + u_matiz / 360.0), clamp(h.y * (1.0 + u_saturacao / 100.0), 0.0, 1.0), h.z);
  vec3 r = hsv2rgb(h); r = u_luz > 0.0 ? mix(r, vec3(1.0), u_luz / 100.0) : r * (1.0 + u_luz / 100.0); return vec4(r, c.a); }`,
    },
    {
      id: "tingir", nome: "Tingir", categoria: "Ajuste de cor",
      params: [cor("escuro", "Pretos viram", "#000000"), cor("claro", "Brancos viram", "#ffffff"), n("quantidade", "Quantidade", 0, 100, 100)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec3 t = mix(u_escuro, u_claro, luma(c.rgb)); return vec4(mix(c.rgb, t, u_quantidade / 100.0), c.a); }`,
    },
    {
      id: "duotone", nome: "Duas cores (duotone)", categoria: "Ajuste de cor",
      params: [cor("cor1", "Sombras", "#1b1464"), cor("cor2", "Luzes", "#ff7a59"), n("quantidade", "Quantidade", 0, 100, 100)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); float l = smoothstep(0.05, 0.95, luma(c.rgb)); return vec4(mix(c.rgb, mix(u_cor1, u_cor2, l), u_quantidade / 100.0), c.a); }`,
    },
    {
      id: "preto-branco", nome: "Preto e branco", categoria: "Ajuste de cor",
      params: [n("quantidade", "Quantidade", 0, 100, 100), n("contraste", "Contraste", -100, 100, 10)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); float l = (luma(c.rgb) - 0.5) * (1.0 + u_contraste / 100.0) + 0.5; return vec4(mix(c.rgb, vec3(clamp(l, 0.0, 1.0)), u_quantidade / 100.0), c.a); }`,
    },
    {
      id: "sepia", nome: "Sépia", categoria: "Ajuste de cor",
      params: [n("quantidade", "Quantidade", 0, 100, 100)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec3 s = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131))); return vec4(mix(c.rgb, min(s, 1.0), u_quantidade / 100.0), c.a); }`,
    },
    {
      id: "desfoque-gaussiano", nome: "Desfoque gaussiano", categoria: "Desfoque e nitidez", passes: 2,
      params: [n("intensidade", "Intensidade", 0, 200, 10, 0.5, " px"), escolha("direcao", "Direção", [[0, "Os dois sentidos"], [1, "Horizontal"], [2, "Vertical"]])],
      glsl: `uniform float uPasse;
vec4 efeito(vec2 uv) {
  int dir = int(u_direcao + 0.5);
  if ((uPasse < 0.5 && dir == 2) || (uPasse > 0.5 && dir == 1) || u_intensidade < 0.3) return amostra(uv);
  vec2 passo = (uPasse < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) / uTam;
  float sigma = u_intensidade / 2.0;
  vec4 soma = vec4(0.0); float peso = 0.0;
  for (int i = -16; i <= 16; i++) {
    float x = float(i) * sigma / 6.0;
    float w = exp(-0.5 * x * x / (sigma * sigma / 9.0 + 0.0001));
    soma += amostra(uv + passo * x) * w; peso += w;
  }
  return soma / peso;
}`,
    },
    {
      id: "desfoque-direcional", nome: "Desfoque de movimento", categoria: "Desfoque e nitidez",
      params: [n("angulo", "Direção", 0, 360, 0, 1, "°"), n("distancia", "Distância", 0, 200, 20, 1, " px")],
      glsl: `vec4 efeito(vec2 uv) { float a = radians(u_angulo); vec2 d = vec2(cos(a), sin(a)) * u_distancia / uTam; vec4 s = vec4(0.0);
  for (int i = 0; i < 32; i++) s += amostra(uv + d * (float(i) / 31.0 - 0.5)); return s / 32.0; }`,
    },
    {
      id: "desfoque-zoom", nome: "Desfoque de zoom", categoria: "Desfoque e nitidez",
      params: [n("quantidade", "Quantidade", 0, 100, 20), n("centroX", "Centro ↔", 0, 100, 50, 1, "%"), n("centroY", "Centro ↕", 0, 100, 50, 1, "%")],
      glsl: `vec4 efeito(vec2 uv) { vec2 c = vec2(u_centroX, u_centroY) / 100.0; vec4 s = vec4(0.0);
  for (int i = 0; i < 32; i++) { float k = 1.0 - u_quantidade / 100.0 * 0.4 * float(i) / 31.0; s += amostra(c + (uv - c) * k); } return s / 32.0; }`,
    },
    {
      id: "desfoque-lente", nome: "Desfoque de lente (bokeh)", categoria: "Desfoque e nitidez",
      params: [n("raio", "Raio", 0, 60, 8, 0.5, " px"), n("realce", "Brilho das luzes", 0, 100, 40)],
      glsl: `vec4 efeito(vec2 uv) { vec4 s = vec4(0.0); float p = 0.0;
  for (int i = 0; i < 64; i++) { float r = sqrt(float(i) / 63.0) * u_raio; float a = float(i) * 2.39996; vec4 c = amostra(uv + vec2(cos(a), sin(a)) * r / uTam);
    float w = 1.0 + pow(luma(c.rgb), 4.0) * u_realce / 10.0; s += c * w; p += w; } return s / p; }`,
    },
    {
      id: "nitidez", nome: "Nitidez", categoria: "Desfoque e nitidez",
      params: [n("quantidade", "Quantidade", 0, 300, 50), n("raio", "Raio", 0.5, 5, 1, 0.1, " px")],
      glsl: `vec4 efeito(vec2 uv) { vec2 d = u_raio / uTam; vec4 c = amostra(uv);
  vec4 b = (amostra(uv + vec2(d.x, 0.0)) + amostra(uv - vec2(d.x, 0.0)) + amostra(uv + vec2(0.0, d.y)) + amostra(uv - vec2(0.0, d.y))) * 0.25;
  return vec4(clamp(c.rgb + (c.rgb - b.rgb) * u_quantidade / 100.0, 0.0, 1.0), c.a); }`,
    },
    {
      id: "ruido", nome: "Granulação de filme", categoria: "Ruído e granulação",
      params: [n("quantidade", "Quantidade", 0, 100, 20), n("tamanho", "Tamanho do grão", 1, 8, 1.5, 0.1), sim("colorido", "Colorido")],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec2 p = floor(uv * uTam / u_tamanho) + floor(uTempo * 24.0) * 7.31;
  vec3 g = u_colorido > 0.5 ? vec3(aleat(p), aleat(p + 3.1), aleat(p + 5.7)) : vec3(aleat(p));
  return vec4(clamp(c.rgb + (g - 0.5) * u_quantidade / 100.0 * 0.5, 0.0, 1.0), c.a); }`,
    },
    {
      id: "chroma-key", nome: "Chave de cor (fundo verde)", categoria: "Chaveamento",
      params: [cor("cor", "Cor do fundo", "#00b140"), n("tolerancia", "Tolerância", 0, 100, 30), n("suavidade", "Suavidade da borda", 0, 100, 10),
        n("derramamento", "Tirar o verde das bordas", 0, 100, 50), sim("mostrarMatte", "Mostrar a máscara (preto e branco)")],
      glsl: `vec2 cbcr(vec3 c) { return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
vec4 efeito(vec2 uv) { vec4 c = amostra(uv); float d = distance(cbcr(c.rgb), cbcr(u_cor)) * 4.0;
  float t = u_tolerancia / 100.0, s = u_suavidade / 100.0 + 0.001;
  float a = smoothstep(t, t + s, d);
  if (u_mostrarMatte > 0.5) return vec4(vec3(a * c.a), 1.0);
  vec3 r = c.rgb;
  if (u_derramamento > 0.0) { // reduz o canal dominante da cor de fundo
    vec3 k = normalize(u_cor + 0.0001); float dom = dot(r, k) - (r.r + r.g + r.b - dot(r, k)) * 0.5;
    r -= k * max(0.0, dom) * (1.0 - a) * u_derramamento / 100.0 * 1.5;
  }
  return vec4(clamp(r, 0.0, 1.0), c.a * a); }`,
    },
    {
      id: "luma-key", nome: "Chave de luminância", categoria: "Chaveamento",
      params: [n("limiar", "Limiar", 0, 100, 15), n("suavidade", "Suavidade", 0, 100, 10), sim("inverter", "Tirar as partes claras (em vez das escuras)")],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); float l = luma(c.rgb); float t = u_limiar / 100.0, s = u_suavidade / 100.0 + 0.001;
  float a = u_inverter > 0.5 ? 1.0 - smoothstep(1.0 - t - s, 1.0 - t, l) : smoothstep(t, t + s, l); return vec4(c.rgb, c.a * a); }`,
    },
    {
      id: "mascara", nome: "Máscara (elipse ou retângulo)", categoria: "Chaveamento",
      params: [escolha("forma", "Forma", [[0, "Elipse"], [1, "Retângulo"]]), n("centroX", "Centro ↔", 0, 100, 50, 1, "%"), n("centroY", "Centro ↕", 0, 100, 50, 1, "%"),
        n("largura", "Largura", 1, 150, 60, 1, "%"), n("altura", "Altura", 1, 150, 60, 1, "%"), n("suavidade", "Borda suave", 0, 50, 5, 0.5, "%"), sim("inverter", "Inverter")],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec2 d = (uv - vec2(u_centroX, u_centroY) / 100.0) / (vec2(u_largura, u_altura) / 200.0);
  float r = int(u_forma + 0.5) == 0 ? length(d) : max(abs(d.x), abs(d.y));
  float s = u_suavidade / 25.0 + 0.0001; float m = 1.0 - smoothstep(1.0 - s, 1.0, r); if (u_inverter > 0.5) m = 1.0 - m; return vec4(c.rgb, c.a * m); }`,
    },
    {
      id: "brilho-glow", nome: "Brilho (glow)", categoria: "Estilizar",
      params: [n("limiar", "Só as partes acima de", 0, 100, 60), n("raio", "Raio", 1, 60, 15, 0.5, " px"), n("intensidade", "Intensidade", 0, 300, 100)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); vec3 g = vec3(0.0); float t = u_limiar / 100.0;
  for (int i = 0; i < 48; i++) { float r = sqrt(float(i) / 47.0) * u_raio; float a = float(i) * 2.39996; vec3 s = amostra(uv + vec2(cos(a), sin(a)) * r / uTam).rgb;
    g += max(s - t, 0.0) / max(1.0 - t, 0.01); }
  return vec4(clamp(c.rgb + g / 48.0 * u_intensidade / 100.0, 0.0, 1.0), c.a); }`,
    },
    {
      id: "aberracao", nome: "Aberração cromática", categoria: "Estilizar",
      params: [n("quantidade", "Quantidade", 0, 40, 4, 0.5, " px")],
      glsl: `vec4 efeito(vec2 uv) { vec2 d = (uv - 0.5) * u_quantidade / uTam * 2.0; vec4 c = amostra(uv);
  return vec4(amostra(uv + d).r, c.g, amostra(uv - d).b, c.a); }`,
    },
    {
      id: "vhs", nome: "Fita VHS", categoria: "Estilizar",
      params: [n("quantidade", "Quantidade", 0, 100, 60), n("linhas", "Linhas", 0, 100, 40)],
      glsl: `vec4 efeito(vec2 uv) { float q = u_quantidade / 100.0;
  float onda = (aleat(vec2(floor(uv.y * 80.0), floor(uTempo * 15.0))) - 0.5) * 0.006 * q;
  vec2 u2 = uv + vec2(onda, 0.0);
  vec3 c = vec3(amostra(u2 + vec2(0.003 * q, 0.0)).r, amostra(u2).g, amostra(u2 - vec2(0.003 * q, 0.0)).b);
  c = mix(c, vec3(luma(c)), 0.25 * q);
  c *= 1.0 - u_linhas / 100.0 * 0.25 * (0.5 + 0.5 * sin(uv.y * uTam.y * 1.5));
  c += (aleat(uv * uTam + uTempo) - 0.5) * 0.12 * q;
  return vec4(clamp(c, 0.0, 1.0), amostra(uv).a); }`,
    },
    {
      id: "posterizar", nome: "Posterizar", categoria: "Estilizar",
      params: [n("niveis", "Níveis por cor", 2, 32, 5)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); float k = max(2.0, u_niveis) - 1.0; return vec4(floor(c.rgb * k + 0.5) / k, c.a); }`,
    },
    {
      id: "mosaico", nome: "Mosaico (pixelizar)", categoria: "Estilizar",
      params: [n("blocos", "Blocos na largura", 4, 300, 40)],
      glsl: `vec4 efeito(vec2 uv) { vec2 n = vec2(u_blocos, u_blocos * uTam.y / uTam.x); return amostra((floor(uv * n) + 0.5) / n); }`,
    },
    {
      id: "inverter", nome: "Inverter cores", categoria: "Estilizar",
      params: [n("quantidade", "Quantidade", 0, 100, 100)],
      glsl: `vec4 efeito(vec2 uv) { vec4 c = amostra(uv); return vec4(mix(c.rgb, 1.0 - c.rgb, u_quantidade / 100.0), c.a); }`,
    },
    {
      id: "bordas", nome: "Contornos (detectar bordas)", categoria: "Estilizar",
      params: [n("intensidade", "Intensidade", 0, 400, 150), sim("inverter", "Fundo branco")],
      glsl: `vec4 efeito(vec2 uv) { vec2 p = 1.0 / uTam;
  float gx = luma(amostra(uv + vec2(p.x, 0.0)).rgb) - luma(amostra(uv - vec2(p.x, 0.0)).rgb);
  float gy = luma(amostra(uv + vec2(0.0, p.y)).rgb) - luma(amostra(uv - vec2(0.0, p.y)).rgb);
  float e = clamp(length(vec2(gx, gy)) * u_intensidade / 50.0, 0.0, 1.0); return vec4(vec3(u_inverter > 0.5 ? 1.0 - e : e), amostra(uv).a); }`,
    },
    {
      id: "relevo", nome: "Relevo", categoria: "Estilizar",
      params: [n("intensidade", "Intensidade", 0, 300, 100), n("angulo", "Direção da luz", 0, 360, 135, 1, "°")],
      glsl: `vec4 efeito(vec2 uv) { float a = radians(u_angulo); vec2 d = vec2(cos(a), sin(a)) / uTam;
  float e = (luma(amostra(uv + d).rgb) - luma(amostra(uv - d).rgb)) * u_intensidade / 50.0; return vec4(vec3(0.5 + e), amostra(uv).a); }`,
    },
    {
      id: "espelhar", nome: "Espelhar", categoria: "Distorcer",
      params: [escolha("eixo", "Lado", [[0, "Esquerda → direita"], [1, "Direita → esquerda"], [2, "Em cima → embaixo"], [3, "Embaixo → em cima"]])],
      glsl: `vec4 efeito(vec2 uv) { int e = int(u_eixo + 0.5); vec2 u = uv;
  if (e == 0 && u.x > 0.5) u.x = 1.0 - u.x; if (e == 1 && u.x < 0.5) u.x = 1.0 - u.x;
  if (e == 2 && u.y > 0.5) u.y = 1.0 - u.y; if (e == 3 && u.y < 0.5) u.y = 1.0 - u.y; return amostra(u); }`,
    },
    {
      id: "ondulacao", nome: "Ondulação", categoria: "Distorcer",
      params: [n("amplitude", "Altura da onda", 0, 100, 10, 0.5, " px"), n("comprimento", "Largura da onda", 5, 500, 60, 1, " px"), n("velocidade", "Velocidade", -10, 10, 1, 0.1),
        escolha("direcao", "Direção", [[0, "Horizontal"], [1, "Vertical"]])],
      glsl: `vec4 efeito(vec2 uv) { vec2 p = uv * uTam; float f = 6.2831853 / u_comprimento;
  if (int(u_direcao + 0.5) == 0) p.x += sin(p.y * f + uTempo * u_velocidade * 3.0) * u_amplitude; else p.y += sin(p.x * f + uTempo * u_velocidade * 3.0) * u_amplitude;
  return amostra(p / uTam); }`,
    },
    {
      id: "redemoinho", nome: "Redemoinho", categoria: "Distorcer",
      params: [n("angulo", "Giro", -720, 720, 180, 1, "°"), n("raio", "Raio", 1, 100, 50, 1, "%")],
      glsl: `vec4 efeito(vec2 uv) { vec2 a = vec2(uTam.x / uTam.y, 1.0); vec2 d = (uv - 0.5) * a; float r = length(d), R = u_raio / 100.0;
  if (r < R) { float g = radians(u_angulo) * pow(1.0 - r / R, 2.0); d = mat2(cos(g), -sin(g), sin(g), cos(g)) * d; } return amostra(d / a + 0.5); }`,
    },
    {
      id: "esferizar", nome: "Olho de peixe (esferizar)", categoria: "Distorcer",
      params: [n("quantidade", "Quantidade", -100, 100, 40), n("raio", "Raio", 10, 100, 60, 1, "%")],
      glsl: `vec4 efeito(vec2 uv) { vec2 a = vec2(uTam.x / uTam.y, 1.0); vec2 d = (uv - 0.5) * a; float r = length(d), R = u_raio / 100.0;
  if (r < R) { float k = max(r / R, 0.0001); d *= pow(k, u_quantidade / 100.0 * 0.9); } return amostra(d / a + 0.5); }`,
    },
    {
      id: "tremer-camera", nome: "Câmera tremendo", categoria: "Distorcer",
      params: [n("intensidade", "Intensidade", 0, 100, 25), n("frequencia", "Rapidez", 0.2, 20, 4, 0.1)],
      glsl: `float suave(float t, float s) { float i = floor(t), f = fract(t); return mix(aleat(vec2(i, s)), aleat(vec2(i + 1.0, s)), f * f * (3.0 - 2.0 * f)) - 0.5; }
vec4 efeito(vec2 uv) { float q = u_intensidade / 100.0; float t = uTempo * u_frequencia;
  vec2 d = vec2(suave(t, 1.3), suave(t, 7.1)) * 0.06 * q; float g = suave(t, 3.7) * 0.05 * q; float z = 1.0 + 0.12 * q;
  vec2 u = (uv - 0.5) / z; u = mat2(cos(g), -sin(g), sin(g), cos(g)) * u; return amostra(u + 0.5 + d); }`,
    },
    {
      id: "barras-cinema", nome: "Barras de cinema", categoria: "Gerar",
      params: [escolha("proporcao", "Proporção", [[2.39, "2,39:1 (cinema)"], [2.0, "2:1"], [1.85, "1,85:1"], [1.33, "4:3"], [1.0, "1:1"]], 2.39), cor("cor", "Cor", "#000000")],
      glsl: `vec4 efeito(vec2 uv) { float a = uTam.x / uTam.y; vec4 c = amostra(uv);
  if (u_proporcao >= a) { float h = a / u_proporcao; if (abs(uv.y - 0.5) > h / 2.0) return vec4(u_cor, 1.0); }
  else { float w = u_proporcao / a; if (abs(uv.x - 0.5) > w / 2.0) return vec4(u_cor, 1.0); } return c; }`,
    },
    {
      id: "gradiente", nome: "Rampa de gradiente", categoria: "Gerar",
      params: [cor("cor1", "Cor do começo", "#ff5f6d"), cor("cor2", "Cor do fim", "#2b5876"), n("angulo", "Ângulo", 0, 360, 90, 1, "°"), n("mistura", "Misturar com a imagem", 0, 100, 40)],
      glsl: `vec4 efeito(vec2 uv) { float a = radians(u_angulo); float t = clamp(dot(uv - 0.5, vec2(cos(a), sin(a))) + 0.5, 0.0, 1.0); vec4 c = amostra(uv);
  return vec4(mix(mix(u_cor1, u_cor2, t), c.rgb, u_mistura / 100.0), max(c.a, 1.0 - u_mistura / 100.0)); }`,
    },
  ];

  // ── Transições ──────────────────────────────────────────────────────
  // Viram uma máscara/deslocamento na composição (render.js): o clipe que sai (A) e o que entra (B).
  const TRANSICOES = [
    { id: "dissolver", nome: "Dissolução cruzada", categoria: "Dissolver" },
    { id: "preto", nome: "Mergulhar no preto", categoria: "Dissolver" },
    { id: "branco", nome: "Mergulhar no branco", categoria: "Dissolver" },
    { id: "desfocar", nome: "Dissolver desfocando", categoria: "Dissolver" },
    { id: "empurrar", nome: "Empurrar", categoria: "Deslizar", direcao: true },
    { id: "deslizar", nome: "Deslizar por cima", categoria: "Deslizar", direcao: true },
    { id: "limpar", nome: "Cortina (limpar)", categoria: "Limpar", direcao: true },
    { id: "portas", nome: "Portas abrindo", categoria: "Limpar" },
    { id: "persianas", nome: "Persianas", categoria: "Limpar" },
    { id: "relogio", nome: "Relógio", categoria: "Limpar" },
    { id: "iris", nome: "Íris redonda", categoria: "Íris" },
    { id: "iris-losango", nome: "Íris em losango", categoria: "Íris" },
    { id: "zoom", nome: "Zoom", categoria: "Zoom" },
    { id: "girar", nome: "Girar entrando", categoria: "Zoom" },
  ];
  const DIRECOES = [[0, "Da esquerda"], [1, "Da direita"], [2, "De cima"], [3, "De baixo"]];

  // ── Efeitos de áudio (Web Audio) ────────────────────────────────────
  const EFEITOS_AUDIO = [
    { id: "ganho", nome: "Ganho", categoria: "Volume", params: [n("db", "Ganho", -40, 24, 0, 0.5, " dB")] },
    { id: "eq", nome: "Equalizador (3 bandas)", categoria: "Filtro e EQ",
      params: [n("graves", "Graves", -18, 18, 0, 0.5, " dB"), n("fGraves", "Frequência dos graves", 40, 500, 150, 1, " Hz"),
        n("medios", "Médios", -18, 18, 0, 0.5, " dB"), n("fMedios", "Frequência dos médios", 200, 6000, 1200, 10, " Hz"), n("q", "Largura (Q)", 0.2, 8, 1, 0.1),
        n("agudos", "Agudos", -18, 18, 0, 0.5, " dB"), n("fAgudos", "Frequência dos agudos", 1500, 16000, 5000, 50, " Hz")] },
    { id: "passa-alta", nome: "Cortar graves (passa-alta)", categoria: "Filtro e EQ", params: [n("freq", "Abaixo de", 20, 2000, 100, 1, " Hz")] },
    { id: "passa-baixa", nome: "Cortar agudos (passa-baixa)", categoria: "Filtro e EQ", params: [n("freq", "Acima de", 500, 20000, 8000, 10, " Hz")] },
    { id: "zumbido", nome: "Tirar o zumbido da rede elétrica", categoria: "Restauração",
      params: [escolha("rede", "Rede", [[60, "60 Hz (Brasil)"], [50, "50 Hz (Europa)"]], 60), n("harmonicos", "Harmônicos", 1, 6, 4)] },
    { id: "voz", nome: "Voz mais clara", categoria: "Restauração", params: [n("quantidade", "Quantidade", 0, 100, 60)] },
    { id: "compressor", nome: "Compressor", categoria: "Dinâmica",
      params: [n("limiar", "Limiar", -60, 0, -20, 1, " dB"), n("razao", "Razão", 1, 20, 4, 0.5, ":1"), n("ataque", "Ataque", 0, 200, 5, 1, " ms"),
        n("liberacao", "Liberação", 10, 1000, 200, 10, " ms"), n("ganho", "Ganho depois", 0, 24, 3, 0.5, " dB")] },
    { id: "limitador", nome: "Limitador", categoria: "Dinâmica", params: [n("teto", "Teto", -20, 0, -1, 0.5, " dB")] },
    { id: "eco", nome: "Eco (atraso)", categoria: "Atraso e eco",
      params: [n("tempo", "Tempo", 10, 2000, 300, 10, " ms"), n("retorno", "Repetições", 0, 90, 35, 1, "%"), n("mistura", "Mistura", 0, 100, 30, 1, "%")] },
    { id: "reverb", nome: "Reverb (sala)", categoria: "Reverb", params: [n("tamanho", "Tamanho da sala", 0.3, 8, 2, 0.1, " s"), n("mistura", "Mistura", 0, 100, 25, 1, "%")] },
    { id: "mono", nome: "Juntar em mono", categoria: "Canais", params: [] },
  ];
  const TRANSICOES_AUDIO = [
    { id: "potencia", nome: "Fade cruzado (potência constante)" },
    { id: "ganho", nome: "Fade cruzado (ganho constante)" },
  ];

  const MISTURAS = [["normal", "Normal"], ["escurecer", "Escurecer"], ["multiplicar", "Multiplicar"], ["superexpor", "Superexposição de cor"],
    ["clarear", "Clarear"], ["tela", "Tela"], ["subexpor", "Subexposição de cor"], ["adicao", "Adição (somar luz)"],
    ["sobrepor", "Sobrepor"], ["luz-suave", "Luz suave"], ["luz-forte", "Luz forte"], ["diferenca", "Diferença"], ["exclusao", "Exclusão"],
    ["subtrair", "Subtrair"], ["matiz", "Matiz"], ["saturacao", "Saturação"], ["cor", "Cor"], ["luminosidade", "Luminosidade"]];

  // ── Propriedades fixas de todo clipe (as "fx" Movimento, Opacidade, Recorte, Volume) ─────

  const PROPRIEDADES = {
    "mov.posX": { nome: "Posição X", passo: 1, unidade: "" }, "mov.posY": { nome: "Posição Y", passo: 1, unidade: "" },
    "mov.escala": { nome: "Escala", passo: 0.1, unidade: "%", min: 0 }, "mov.escalaLargura": { nome: "Largura da escala", passo: 0.1, unidade: "%", min: 0 },
    "mov.rotacao": { nome: "Rotação", passo: 0.1, unidade: "°" },
    "mov.ancoraX": { nome: "Ponto de ancoragem X", passo: 1, unidade: "" }, "mov.ancoraY": { nome: "Ponto de ancoragem Y", passo: 1, unidade: "" },
    "opac.valor": { nome: "Opacidade", passo: 0.1, unidade: "%", min: 0, max: 100 },
    "rec.esquerda": { nome: "Esquerda", passo: 0.1, unidade: "%", min: 0, max: 100 }, "rec.topo": { nome: "Em cima", passo: 0.1, unidade: "%", min: 0, max: 100 },
    "rec.direita": { nome: "Direita", passo: 0.1, unidade: "%", min: 0, max: 100 }, "rec.baixo": { nome: "Embaixo", passo: 0.1, unidade: "%", min: 0, max: 100 },
    "rec.suavizar": { nome: "Suavizar bordas", passo: 0.5, unidade: " px", min: 0 },
    "audio.nivel": { nome: "Nível", passo: 0.1, unidade: " dB", max: 15 }, "audio.pan": { nome: "Panorama", passo: 1, unidade: "", min: -100, max: 100 },
  };

  // ── Quadros-chave ───────────────────────────────────────────────────
  // Cada quadro-chave: {t (s, desde o começo do clipe), v, i}; i = linear | bezier | facilitar | segurar.
  // A curva é uma Hermite cúbica: a inclinação em cada quadro depende do tipo — linear: a do trecho;
  // bezier: média dos vizinhos (Catmull-Rom) limitada para não passar do ponto (Fritsch–Carlson);
  // facilitar: zero (chega e sai devagar); segurar: mantém o valor até o próximo.
  const INTERPOLACOES = [["linear", "Linear"], ["bezier", "Bezier (suave)"], ["facilitar", "Facilitar (entrar e sair devagar)"], ["segurar", "Segurar (pula de valor)"]];

  function inclinacoes(ch) {
    const m = new Array(ch.length).fill(0);
    const trecho = (i) => (ch[i + 1].v - ch[i].v) / Math.max(1e-6, ch[i + 1].t - ch[i].t);
    for (let k = 0; k < ch.length; k++) {
      const antes = k > 0 ? trecho(k - 1) : null, depois = k < ch.length - 1 ? trecho(k) : null;
      const tipo = ch[k].i || "linear";
      if (tipo === "facilitar" || tipo === "segurar") m[k] = 0;
      else if (tipo === "linear") m[k] = null; // usa a do próprio trecho (ver valorChaves)
      else {
        if (antes === null || depois === null) m[k] = antes ?? depois ?? 0;
        else if (antes * depois <= 0) m[k] = 0;
        else {
          const media = (ch[k + 1].v - ch[k - 1].v) / Math.max(1e-6, ch[k + 1].t - ch[k - 1].t);
          m[k] = Math.sign(media) * Math.min(Math.abs(media), 3 * Math.abs(antes), 3 * Math.abs(depois));
        }
      }
    }
    return m;
  }

  /** Valor numa lista de quadros-chave (ordenada) no instante t. */
  function valorChaves(ch, t) {
    if (!ch || !ch.length) return undefined;
    if (t <= ch[0].t) return ch[0].v;
    const ult = ch[ch.length - 1];
    if (t >= ult.t) return ult.v;
    let k = 0;
    while (k < ch.length - 2 && t >= ch[k + 1].t) k++;
    const a = ch[k], b = ch[k + 1];
    if ((a.i || "linear") === "segurar") return a.v;
    const dt = Math.max(1e-6, b.t - a.t), u = (t - a.t) / dt, s = (b.v - a.v) / dt;
    if ((a.i || "linear") === "linear" && (b.i || "linear") === "linear") return a.v + (b.v - a.v) * u;
    const m = ch._m || (ch._m = inclinacoes(ch));
    const ma = m[k] === null ? s : m[k], mb = m[k + 1] === null ? s : m[k + 1];
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * dt * ma + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * dt * mb;
  }
  /** Depois de mexer nos quadros-chave: reordena e joga fora as inclinações guardadas. */
  function ajeitarChaves(ch) {
    ch.sort((a, b) => a.t - b.t);
    delete ch._m;
    return ch;
  }

  /** Lê/escreve o valor "fixo" de uma propriedade pelo caminho ("mov.escala", "fx.<uid>.<param>"). */
  function alvoDoCaminho(clipe, caminho) {
    const partes = caminho.split(".");
    if (partes[0] === "fx") {
      const fx = (clipe.efeitos || []).find((e) => e.uid === partes[1]);
      return fx ? { obj: fx.params, chave: partes[2] } : null;
    }
    const grupos = { mov: "mov", opac: "opac", rec: "rec", audio: "audio" };
    const obj = clipe[grupos[partes[0]]];
    return obj ? { obj, chave: partes[1] } : null;
  }
  function valorFixo(clipe, caminho) {
    const a = alvoDoCaminho(clipe, caminho);
    return a ? a.obj[a.chave] : undefined;
  }
  function definirFixo(clipe, caminho, v) {
    const a = alvoDoCaminho(clipe, caminho);
    if (a) a.obj[a.chave] = v;
  }

  /** Valor de uma propriedade do clipe no instante tLocal (s desde o começo do clipe). */
  function valor(clipe, caminho, tLocal) {
    const ch = clipe.anim && clipe.anim[caminho];
    if (ch && ch.length) return valorChaves(ch, tLocal);
    return valorFixo(clipe, caminho);
  }

  /** Parâmetros de um efeito no instante tLocal (os animados vêm dos quadros-chave). */
  function paramsNoTempo(clipe, fx, tLocal) {
    const saida = {};
    for (const [k, v] of Object.entries(fx.params)) {
      const ch = clipe.anim && clipe.anim[`fx.${fx.uid}.${k}`];
      saida[k] = ch && ch.length ? valorChaves(ch, tLocal) : v;
    }
    return saida;
  }

  function definicaoEfeito(id) {
    return EFEITOS_VIDEO.find((e) => e.id === id) || EFEITOS_AUDIO.find((e) => e.id === id);
  }
  /** Um efeito novo com os valores padrão. */
  function novoEfeito(id, audio = false) {
    const def = (audio ? EFEITOS_AUDIO : EFEITOS_VIDEO).find((e) => e.id === id);
    if (!def) throw new Error("Efeito desconhecido: " + id);
    const params = {};
    for (const p of def.params) if (!p.grupo) params[p.id] = p.padrao;
    const fx = { uid: Math.random().toString(36).slice(2, 9), id, ativo: true, audio, params };
    if (def.curvas) fx.curvas = curvasPadrao();
    return fx;
  }
  const curvasPadrao = () => ({ mestre: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });

  /** Curva monotônica (Fritsch–Carlson) por pontos [[x, y]] → função. Usada nas curvas RGB. */
  function curvaMonotonica(pontos) {
    const p = [...pontos].sort((a, b) => a[0] - b[0]);
    if (p.length < 2) return (x) => x;
    const n = p.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (x) => {
      if (x <= p[0][0]) return p[0][1];
      if (x >= p[n - 1][0]) return p[n - 1][1];
      let i = 0;
      while (i < n - 2 && x > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], u = (x - p[i][0]) / h, u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * m[i + 1];
    };
  }
  /** As 4 curvas → tabela RGBA de 256 posições (o mestre vem antes de cada canal). */
  function tabelaDasCurvas(curvas) {
    const f = { m: curvaMonotonica(curvas.mestre), r: curvaMonotonica(curvas.r), g: curvaMonotonica(curvas.g), b: curvaMonotonica(curvas.b) };
    const t = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = f.m(i / 255);
      const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
      t[i * 4] = c(f.r(x)); t[i * 4 + 1] = c(f.g(x)); t[i * 4 + 2] = c(f.b(x)); t[i * 4 + 3] = 255;
    }
    return t;
  }
  const curvasNeutras = (curvas) => ["mestre", "r", "g", "b"].every((k) => curvas[k].length === 2 && curvas[k][0][0] === 0 && curvas[k][0][1] === 0 && curvas[k][1][0] === 1 && curvas[k][1][1] === 1);

  Object.assign(V, {
    GLSL_COMUM, EFEITOS_VIDEO, EFEITOS_AUDIO, TRANSICOES, TRANSICOES_AUDIO, DIRECOES, MISTURAS, PROPRIEDADES, INTERPOLACOES, LOOKS,
    valorChaves, ajeitarChaves, valor, valorFixo, definirFixo, paramsNoTempo, definicaoEfeito, novoEfeito, curvasPadrao,
    curvaMonotonica, tabelaDasCurvas, curvasNeutras,
  });
  if (typeof module !== "undefined") module.exports = V;
})(typeof window !== "undefined" ? window : globalThis);
