/*
 * Companhia — o que segura a pessoa no cenário, e as plantas que dobram quando alguém passa.
 *
 * Antes, toda malha do mapa virava parede: grama, folhas, heras e flores travavam quem andava. Agora cada malha é
 * "sólida", "planta" (atravessa e dobra) ou "nada" (atravessa e fica parada):
 *   1. o que a conversão deixou escrito vale primeiro (userData.webc, que vem nos "extras" do .glb): numa cena do
 *      Unity, só o que tinha colisor sólido colide (js/unity-cena.js), e as peças "só colisão" ficam invisíveis;
 *   2. sem isso (um .glb, .fbx, .blend qualquer), a malha é planta se o nome dela, de um pai ou do material diz
 *      (grass, grama, leaf, folha, plant, ivy, hera, flower, flor, bush, arbusto, fern, vine, weed, moss, petal,
 *      foliage, reed, clover, 草, 葉, 花...), ou se é uma peça pequena de material recortado (alphaTest: o jeito de
 *      fazer folhas e capim com imagem), menos grades, cercas e telas, que continuam sólidas;
 *   3. o resto colide como antes.
 * As plantas ganham um efeito no desenho (no shader, sem custo de física): balançam com o vento e se afastam de quem
 * passa por elas (até 8 pessoas: eu e as mais perto), mais na ponta do que na base.
 *
 * C.colisao = { preparar(mapa) → {plantas, soColisao}, colide(malha) → bool, ehPlanta(malha) → bool, atualizar(plantas, pessoas, tempo) }
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  // as palavras curtas só valem inteiras ("hay" não pega "display", "reed" não pega "screen", "vine" não pega "divine")
  const PLANTA = /grass|grama|capim|relva|lawn|leaf|leaves|leafs|folha|folhag|foliage|plant|ivy(?![a-z])|(?<![a-z])(gras|hay|fern|reed|vine|weed|moss|alga|trigo|hera|flor|flores|feno|junco|musgo|palha|trevo)(?![a-z])|hera_|flower|blossom|petal|p[eé]tala|bush|arbusto|shrub|samambaia|trepadeira|clover|wheat|straw|seaweed|kelp|cattail|bamboo_?leaf|草|葉|花|芝|苔|蔦|ツタ|植物/i;
  const SOLIDO = /fence|cerca|grade|grid|wire|tela|net\b|rede|railing|corrim|gate|port[aã]o|wall|parede|window|janela|glass|vidro|floor|ch[aã]o|piso|ground|terrain|terreno|trunk|tronco|log\b|vase|vaso|pot\b|planter|floreira|bench|banco/i;
  const MAX_PESSOAS = 8;

  const webcDe = (o) => { for (let x = o, i = 0; x && i < 40; x = x.parent, i++) if (x.userData && x.userData.webc && ("colide" in x.userData.webc || x.userData.webc.soColisao)) return x.userData.webc; return null; };
  const nomes = (o) => {
    const ps = [];
    for (let x = o, i = 0; x && i < 6; x = x.parent, i++) if (x.name) ps.push(x.name);
    for (const m of [].concat(o.material || [])) if (m && m.name) ps.push(m.name);
    if (o.geometry && o.geometry.name) ps.push(o.geometry.name);
    return ps.join(" ");
  };
  /** A malha tem cara de planta (pelo nome ou por ser uma peça pequena e recortada)? */
  function ehPlanta(o) {
    const w = webcDe(o);
    if (w && w.planta !== undefined) return !!w.planta;
    const n = nomes(o);
    if (SOLIDO.test(n) && !/leaf|leaves|folha|grass|grama/i.test(n)) return false;
    if (PLANTA.test(n)) return true;
    // recortado (imagem com buracos) e pequeno: capim, folhas, flores feitas com "cartões"
    const mats = [].concat(o.material || []);
    if (!mats.some((m) => m && m.alphaTest > 0 && m.map)) return false;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const s = new window.THREE.Vector3();
    o.getWorldScale(s);
    const t = o.geometry.boundingBox.getSize(new window.THREE.Vector3()).multiply(s);
    return Math.max(t.x, t.y, t.z) < 3.5;
  }
  /** A malha segura a pessoa? */
  function colide(o) {
    const w = webcDe(o);
    if (w) return w.soColisao ? true : w.colide !== false;
    return !o.userData.planta;
  }

  /** O efeito de dobrar e balançar no material (uma cópia por malha: cada uma tem a base e a altura dela). */
  function dobrar(o, uniformes) {
    const T = window.THREE;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox, local = { uBase: { value: b.min.y }, uAlto: { value: Math.max(1e-3, b.max.y - b.min.y) } };
    const trocar = (m) => {
      if (!m || m.userData.dobra) return m;
      const n = m.clone();
      n.userData.dobra = true;
      n.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniformes, local);
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", `#include <common>
uniform vec4 uPessoas[${MAX_PESSOAS}];
uniform float uTempo;
uniform float uVento;
uniform float uBase;
uniform float uAlto;`)
          .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float hh = clamp((transformed.y - uBase) / uAlto, 0.0, 1.0);
  hh = hh * hh;
  vec4 wpos = modelMatrix * vec4(transformed, 1.0);
  vec3 desl = vec3(0.0);
  // o vento: uma onda que passa pelo mapa
  float onda = sin(uTempo * 1.7 + wpos.x * 0.55 + wpos.z * 0.35) + 0.5 * sin(uTempo * 2.9 + wpos.x * 1.3 - wpos.z * 0.9);
  desl.x += onda * uVento * hh;
  desl.z += onda * uVento * 0.6 * hh;
  // quem passa: empurra para longe, mais na ponta
  for (int i = 0; i < ${MAX_PESSOAS}; i++) {
    vec4 p = uPessoas[i];
    if (p.w <= 0.0) continue;
    vec2 d = wpos.xz - p.xz;
    float dist = length(d);
    float alcance = p.w;
    if (dist < alcance && wpos.y > p.y - 0.3 && wpos.y < p.y + 2.2) {
      float f = 1.0 - dist / alcance;
      vec2 dir = dist > 1e-4 ? d / dist : vec2(1.0, 0.0);
      float k = f * f * hh * alcance * 0.9;
      desl.xz += dir * k;
      desl.y -= k * 0.45;
    }
  }
  transformed += inverse(mat3(modelMatrix)) * desl;
}`);
      };
      n.customProgramCacheKey = () => "webc-planta";
      return n;
    };
    o.material = Array.isArray(o.material) ? o.material.map(trocar) : trocar(o.material);
    o.frustumCulled = false; // o desenho mexe: a caixa original pode ficar pequena
  }

  C.colisao = {
    ehPlanta, colide, MAX_PESSOAS,
    /**
     * Separa o mapa: marca as plantas (userData.planta), põe o efeito de dobrar nelas e esconde as peças "só colisão".
     * Devolve {plantas: [malha], soColisao: [malha], uniformes} para atualizar a cada quadro.
     */
    preparar(mapa) {
      const T = window.THREE;
      const uniformes = { uPessoas: { value: Array.from({ length: MAX_PESSOAS }, () => new T.Vector4(0, -1e5, 0, 0)) }, uTempo: { value: 0 }, uVento: { value: 0.035 } };
      const plantas = [], soColisao = [];
      mapa.updateMatrixWorld(true);
      mapa.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        const w = webcDe(o);
        if (w && w.soColisao) { o.visible = false; o.userData.soColisao = true; soColisao.push(o); return; }
        if (o.isSkinnedMesh) return;
        // numa cena do Unity, o que não colide é planta só se tiver cara (o resto: enfeites, que ficam parados)
        const planta = w && w.colide === false ? ehPlanta(o) || PLANTA.test(nomes(o)) : (!w || w.colide !== true) && ehPlanta(o);
        if (!planta) return;
        o.userData.planta = true;
        dobrar(o, uniformes);
        plantas.push(o);
      });
      // as peças só de colisão ficam fora do desenho mas continuam no mapa (para a colisão); visible falso esconde
      for (const o of soColisao) o.visible = true, o.material = new T.MeshBasicMaterial({ visible: false }), o.castShadow = o.receiveShadow = false;
      return { plantas, soColisao, uniformes };
    },
    /** A cada quadro: o tempo do vento e onde estão as pessoas (as mais perto primeiro). pessoas: [{p: Vector3, raio}] */
    atualizar(estado, pessoas, tempo) {
      if (!estado || !estado.plantas.length) return;
      const u = estado.uniformes;
      u.uTempo.value = tempo;
      const lista = u.uPessoas.value;
      for (let i = 0; i < MAX_PESSOAS; i++) {
        const p = pessoas[i];
        if (p) lista[i].set(p.p.x, p.p.y, p.p.z, Math.max(0.35, (p.raio || 0.25) * 2.4));
        else lista[i].set(0, -1e5, 0, 0);
      }
    },
  };
})();
