/*
 * Companhia — pacotes de movimento para as personagens VRoid (.vrm).
 *
 * Abre movimentos prontos e toca em qualquer personagem:
 *
 *   .vrma        VRM Animation (o formato oficial de movimentos do VRM; os pacotes da pixiv/VRoid vêm assim)
 *   .fbx         animações do Mixamo e de outros programas (com ou sem a malha junto)
 *   .bvh         captura de movimento (BVH)
 *   .glb/.gltf   modelos com animação (um movimento por animação do arquivo)
 *   .zip         um pacote com vários desses
 *
 * Cada movimento vira um AnimationClip no "espaço canônico" do palco 3D (js/vrm.js): rotação de cada osso do VRM
 * em relação ao pai, a partir da pose em T, e o quadril em "alturas do quadril". Assim ele não depende do tamanho
 * nem do esqueleto da personagem, e vale também para as roupas dela.
 *
 * Os .vrma já vêm nesse espaço. Para os outros, o esqueleto do arquivo é reconhecido pelos nomes dos ossos
 * (Mixamo, Unity/VRM, VRoid, Unreal, Blender, BVH da CMU...) e o movimento é passado osso a osso: o quanto cada
 * osso girou no mundo desde a pose de repouso do arquivo, aplicado sobre a pose em T do VRM — corrigindo antes
 * para onde o esqueleto do arquivo olha e se ele descansa em T ou em A. Quando um osso é reconhecido errado, a
 * ligação pode ser corrigida à mão (Movimento › Pacotes de movimento › Ossos...).
 *
 * Tudo fica guardado só neste aparelho (IndexedDB). Não abre: .vmd (MikuMikuDance) e .anim do Unity (que guarda
 * "músculos" do Unity, não ossos).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const LISTA = "companhia:movimentos";
  const chave = (id) => "companhia:mov:" + id;
  const TIPOS = { vrma: "vrma", fbx: "fbx", bvh: "bvh", glb: "glb", gltf: "glb" };
  const tipoDe = (nome) => TIPOS[(String(nome).match(/\.([^./\\]+)$/) || [, ""])[1].toLowerCase()] || null;
  const semExt = (n) => String(n).split("/").pop().replace(/\.[^.]+$/, "");
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const QPS = 30;

  // ── Reconhecer o esqueleto pelos nomes ──────────────────────────────

  /** "mixamorig:LeftHandIndex1", "J_Bip_L_Index1", "index_01_l", "Left Index Proximal" → {lado, base} */
  function partir(nome) {
    let n = String(nome).replace(/^.*[:|]/, "");
    let lado = null;
    if (/left/i.test(n)) lado = "left"; else if (/right/i.test(n)) lado = "right";
    else if (/(^|[_.\-\s])l([_.\-\s]|$)/i.test(n) || /^l[A-Z]/.test(n) || /[a-z0-9]L$/.test(n) || /_L_/.test(n)) lado = "left";
    else if (/(^|[_.\-\s])r([_.\-\s]|$)/i.test(n) || /^r[A-Z]/.test(n) || /[a-z0-9]R$/.test(n) || /_R_/.test(n)) lado = "right";
    n = n.replace(/left|right/gi, "").replace(/(^|[_.\-\s])[lr](?=[_.\-\s]|$)/gi, "$1").replace(/^[lr](?=[A-Z])/, "").replace(/([a-z0-9])[LR]$/, "$1");
    const base = n.toLowerCase().replace(/^(mixamorig\d*|j_bip_c_|j_bip_|j_adj_|j_sec_|bip0*1|valvebiped_?bip0*1_?|def[-_]|org[-_]|cc_base_)/, "").replace(/[^a-z0-9]/g, "");
    return { lado, base };
  }
  const IGNORAR = /(^|[_\s.-])ik([_\s.-]|$)|twist|roll|helper|nub$|_end$|end$|site$|attach|socket|weapon|prop/i;

  /**
   * ossos: [{nome, pai}] na ordem da árvore (pais antes dos filhos). Devolve {ossoDoVRM: nomeNoArquivo}.
   */
  C.mapearOssos = function (ossos) {
    const mapa = {}, coluna = [];
    const por = (vrm, nome) => { if (!mapa[vrm]) mapa[vrm] = nome; };
    for (const { nome } of ossos) {
      if (IGNORAR.test(nome)) continue;
      const { lado, base } = partir(nome);
      const L = lado || "";
      // dedos (antes da mão: "LeftHandIndex1")
      const dedo = base.match(/thumb|index|middle|ring|pinky|little/);
      if (dedo) {
        if (!lado) continue;
        const d = { thumb: "Thumb", index: "Index", middle: "Middle", ring: "Ring", pinky: "Little", little: "Little" }[dedo[0]];
        const resto = base.slice(base.indexOf(dedo[0]) + dedo[0].length);
        const palavra = (resto.match(/metacarpal|proximal|intermediate|distal/) || [])[0], num = resto.match(/\d+/);
        let parte = null;
        if (palavra && d === "Thumb") {
          // nomes do Unity/VRM 0.x (proximal, intermediate, distal) ou do VRM 1.0 (metacarpal, proximal, distal)
          const antigo = ossos.some((o) => /thumb.*intermediate/i.test(o.nome));
          parte = antigo ? { proximal: "Metacarpal", intermediate: "Proximal", distal: "Distal" }[palavra] : { metacarpal: "Metacarpal", proximal: "Proximal", distal: "Distal" }[palavra];
        } else if (palavra) parte = { proximal: "Proximal", intermediate: "Intermediate", distal: "Distal" }[palavra];
        else if (num) parte = d === "Thumb" ? ["Metacarpal", "Proximal", "Distal"][+num[0] - 1] : ["Proximal", "Intermediate", "Distal"][+num[0] - 1];
        if (parte) por(L + d + parte, nome);
        continue;
      }
      if (/toe/.test(base)) { if (lado) por(L + "Toes", nome); continue; }
      if (/foot|ankle/.test(base)) { if (lado) por(L + "Foot", nome); continue; }
      if (/hipjoint/.test(base)) continue;
      if (/upleg|upperleg|thigh/.test(base)) { if (lado) por(L + "UpperLeg", nome); continue; }
      if (/lowerleg|leg|calf|shin|knee/.test(base)) { if (lado) por(L + "LowerLeg", nome); continue; }
      if (/shoulder|clavicle|collar/.test(base)) { if (lado) por(L + "Shoulder", nome); continue; }
      if (/forearm|lowerarm|elbow/.test(base)) { if (lado) por(L + "LowerArm", nome); continue; }
      if (/arm/.test(base)) { if (lado) por(L + "UpperArm", nome); continue; }
      if (/hand|wrist/.test(base)) { if (lado) por(L + "Hand", nome); continue; }
      if (/eye|jaw|hair|skirt|bust|breast|tail|ear/.test(base)) continue;
      if (/head/.test(base)) { por("head", nome); continue; }
      if (/neck/.test(base)) { por("neck", nome); continue; }
      if (/hips|pelvis|^hip$/.test(base)) { por("hips", nome); continue; }
      if (/spine|chest|torso|waist|abdomen|lowerback|upperbody/.test(base)) { coluna.push(nome); continue; }
    }
    // a coluna, de baixo para cima: 1 osso = spine; 2 = spine, chest; 3 ou mais = spine, chest ... upperChest
    if (coluna[0]) mapa.spine = coluna[0];
    if (coluna.length === 2) mapa.chest = coluna[1];
    if (coluna.length >= 3) { mapa.chest = coluna[1]; mapa.upperChest = coluna[coluna.length - 1]; }
    return mapa;
  };

  // ── Arquivo → esqueleto + animações ─────────────────────────────────

  /** Lê um arquivo de movimento. Devolve {vrma: [VRMAnimation]} ou {raiz: Object3D, clips: [AnimationClip]}. */
  async function abrirArquivo(tipo, blob) {
    const T = window.THREE, V = window.CompanhiaVRM;
    await C.prepararVRM();
    const gerente = new window.THREE.LoadingManager();
    gerente.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : PIXEL)); // as texturas não interessam aqui
    if (tipo === "vrma" || tipo === "glb") {
      const carregador = new V.GLTFLoader(gerente);
      carregador.register((parser) => new V.VRMAnimationLoaderPlugin(parser));
      carregador.setMeshoptDecoder(V.MeshoptDecoder);
      const url = URL.createObjectURL(blob);
      let gltf;
      try { gltf = await carregador.loadAsync(url); } finally { URL.revokeObjectURL(url); }
      const vrma = gltf.userData.vrmAnimations || [];
      if (vrma.length) return { vrma };
      if (tipo === "vrma") throw new Error("Esse .vrma não tem nenhuma animação do VRM dentro.");
      if (!gltf.animations.length) throw new Error("Esse .glb não tem animação (é só um modelo).");
      return { raiz: gltf.scene, clips: gltf.animations };
    }
    if (tipo === "fbx") {
      const raiz = new V.FBXLoader(gerente).parse(await blob.arrayBuffer(), "");
      if (!raiz.animations || !raiz.animations.length) throw new Error("Esse .fbx não tem animação (é só um modelo).");
      return { raiz, clips: raiz.animations };
    }
    if (tipo === "bvh") {
      const r = new V.BVHLoader().parse(await blob.text());
      const raiz = new T.Group();
      raiz.add(r.skeleton.bones[0]);
      return { raiz, clips: [r.clip] };
    }
    throw new Error("Tipo de movimento desconhecido.");
  }

  /** Os ossos de um esqueleto carregado, na ordem da árvore: [{nome, pai, no}]. */
  function listarOssos(raiz) {
    const ossos = [];
    raiz.traverse((o) => { if (o.isBone || (o.type === "Object3D" && o.children.length && o !== raiz) || o.type === "Group") { if (o !== raiz && o.name) ossos.push({ nome: o.name, pai: o.parent ? o.parent.name : "", no: o }); } });
    return ossos;
  }

  // ── VRM Animation → clip canônico ───────────────────────────────────
  function clipDoVRMA(a, nome) {
    const T = window.THREE, tracks = [];
    for (const [osso, t] of a.humanoidTracks.rotation) if (C.PAIS_VRM[osso] !== undefined) tracks.push(new T.QuaternionKeyframeTrack(osso + ".quaternion", t.times, t.values));
    const hips = a.humanoidTracks.translation.get("hips");
    const h = a.restHipsPosition, alt = Math.abs(h.y) > 1e-6 ? h.y : 1;
    if (hips) {
      const v = new Float32Array(hips.values.length);
      for (let i = 0; i < v.length; i += 3) { v[i] = (hips.values[i] - h.x) / alt; v[i + 1] = (hips.values[i + 1] - h.y) / alt; v[i + 2] = (hips.values[i + 2] - h.z) / alt; }
      tracks.push(new T.VectorKeyframeTrack("hips.position", hips.times, v));
    }
    for (const [exp, t] of a.expressionTracks.preset) if (C.PRESETS_VRM.has(exp)) tracks.push(new T.NumberKeyframeTrack("expr." + exp, t.times, t.values));
    if (!tracks.length) throw new Error("Esse .vrma não mexe em nenhum osso.");
    return new T.AnimationClip(nome, a.duration, tracks);
  }

  // ── Esqueleto qualquer → clip canônico ──────────────────────────────
  /** Direção de cada osso do VRM na pose em T (espaço canônico); os outros herdam a correção do pai. */
  const DIRECAO_T = { spine: [0, 1, 0], chest: [0, 1, 0], upperChest: [0, 1, 0], neck: [0, 1, 0] };
  for (const [l, s] of [["left", 1], ["right", -1]]) {
    Object.assign(DIRECAO_T, { [l + "UpperArm"]: [s, 0, 0], [l + "LowerArm"]: [s, 0, 0], [l + "Hand"]: [s, 0, 0], [l + "UpperLeg"]: [0, -1, 0], [l + "LowerLeg"]: [0, -1, 0] });
  }
  /** O filho que diz para onde o osso aponta. */
  const FILHO = { spine: ["chest", "upperChest", "neck"], chest: ["upperChest", "neck"], upperChest: ["neck"], neck: ["head"] };
  for (const l of ["left", "right"]) {
    Object.assign(FILHO, { [l + "UpperArm"]: [l + "LowerArm"], [l + "LowerArm"]: [l + "Hand"], [l + "Hand"]: [l + "MiddleProximal", l + "IndexProximal"], [l + "UpperLeg"]: [l + "LowerLeg"], [l + "LowerLeg"]: [l + "Foot"] });
  }

  /**
   * Passa uma animação de um esqueleto qualquer para o espaço canônico do VRM.
   * mapa: {ossoDoVRM: nomeNoArquivo}. Devolve o AnimationClip (30 quadros por segundo).
   */
  function retargetar(raiz, clip, mapa, nome) {
    const T = window.THREE;
    const nos = {};
    for (const [vrm, n] of Object.entries(mapa)) { const no = n && raiz.getObjectByName(n); if (no && C.PAIS_VRM[vrm] !== undefined) nos[vrm] = no; }
    if (!nos.hips || Object.keys(nos).length < 6) throw new Error("Não reconheci o esqueleto desse arquivo (achei só: " + (Object.keys(nos).join(", ") || "nada") + "). Dá para ligar os ossos à mão em Ossos...");
    const ossos = C.OSSOS_VRM.filter((n) => nos[n]); // pais antes dos filhos
    const paiDe = (n) => { let p = C.PAIS_VRM[n]; while (p && !nos[p]) p = C.PAIS_VRM[p]; return p || null; };
    // 1. pose de repouso do arquivo
    raiz.updateMatrixWorld(true);
    const repQ = {}, repP = {};
    for (const n of ossos) { repQ[n] = nos[n].getWorldQuaternion(new T.Quaternion()); repP[n] = nos[n].getWorldPosition(new T.Vector3()); }
    // 2. para onde o esqueleto do arquivo olha: X = do lado direito para o esquerdo, Y = do quadril para a cabeça
    const pe = nos.leftUpperLeg && nos.rightUpperLeg ? ["leftUpperLeg", "rightUpperLeg"] : nos.leftUpperArm && nos.rightUpperArm ? ["leftUpperArm", "rightUpperArm"] : null;
    const topo = ["head", "neck", "upperChest", "chest", "spine"].find((n) => nos[n]);
    let G = new T.Quaternion();
    if (pe && topo) {
      const x = new T.Vector3().subVectors(repP[pe[0]], repP[pe[1]]).normalize();
      const y = new T.Vector3().subVectors(repP[topo], repP.hips);
      y.addScaledVector(x, -y.dot(x)).normalize();
      const z = new T.Vector3().crossVectors(x, y);
      if (x.lengthSq() > 0.5 && y.lengthSq() > 0.5) G = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z)).invert();
    }
    const Ginv = G.clone().invert();
    // 3. correção do repouso (T ou A): a rotação que leva a pose em T do VRM à pose de repouso do arquivo
    const R0 = {};
    for (const n of ossos) {
      const filho = (FILHO[n] || []).find((f) => nos[f]);
      const pai = paiDe(n);
      if (DIRECAO_T[n] && filho) {
        const dir = new T.Vector3().subVectors(repP[filho], repP[n]);
        if (dir.lengthSq() > 1e-10) { R0[n] = new T.Quaternion().setFromUnitVectors(new T.Vector3(...DIRECAO_T[n]), dir.normalize().applyQuaternion(G)); continue; }
      }
      R0[n] = pai && !/UpperLeg|Shoulder|hips/.test(n) && C.PAIS_VRM[n] !== "hips" ? R0[pai].clone() : new T.Quaternion();
    }
    // medida do arquivo: do quadril ao tornozelo (para o sobe-e-desce e o deslocamento do quadril)
    const cima = new T.Vector3(0, 1, 0).applyQuaternion(Ginv);
    const tornozelo = nos.leftFoot ? "leftFoot" : nos.rightFoot ? "rightFoot" : nos.leftLowerLeg ? "leftLowerLeg" : null;
    const perna = tornozelo ? Math.abs(new T.Vector3().subVectors(repP.hips, repP[tornozelo]).dot(cima)) : 0;
    const alturaQuadril = perna > 1e-6 ? perna / (tornozelo.endsWith("Foot") ? 0.9 : 0.5) : 1;
    // 4. amostra a animação
    const mixer = new T.AnimationMixer(raiz);
    const acao = mixer.clipAction(clip);
    acao.play();
    const dur = Math.max(1 / QPS, clip.duration), N = Math.max(2, Math.ceil(dur * QPS) + 1);
    const tempos = new Float32Array(N), valores = {}, quadril = new Float32Array(N * 3), pes = [];
    for (const n of ossos) valores[n] = new Float32Array(N * 4);
    const W = {}, anterior = {}, p = new T.Vector3();
    for (let i = 0; i < N; i++) {
      const t = Math.min(dur, i / QPS);
      tempos[i] = t;
      mixer.setTime(Math.min(t, clip.duration - 1e-4));
      raiz.updateMatrixWorld(true);
      for (const n of ossos) {
        // quanto o osso girou no mundo desde o repouso, visto do espaço canônico, por cima da correção do repouso
        const giro = nos[n].getWorldQuaternion(new T.Quaternion()).multiply(repQ[n].clone().invert());
        W[n] = G.clone().multiply(giro).multiply(Ginv).multiply(R0[n]);
        const pai = paiDe(n);
        const local = pai ? W[pai].clone().invert().multiply(W[n]) : W[n].clone();
        if (anterior[n] && anterior[n].dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        anterior[n] = local;
        local.toArray(valores[n], i * 4);
      }
      nos.hips.getWorldPosition(p);
      quadril[i * 3] = p.x; quadril[i * 3 + 1] = p.y; quadril[i * 3 + 2] = p.z;
      let baixo = Infinity;
      for (const n of ["leftFoot", "rightFoot"]) if (nos[n]) baixo = Math.min(baixo, nos[n].getWorldPosition(new T.Vector3()).dot(cima));
      pes.push(baixo);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(raiz);
    // 5. quadril: de lado e para a frente, a partir de onde começa; para cima, a altura sobre o pé mais baixo do movimento
    const chao = Math.min(...pes.filter(Number.isFinite));
    const p0 = new T.Vector3(quadril[0], quadril[1], quadril[2]);
    const anda = new T.Vector3();
    for (let i = 0; i < N; i++) {
      p.set(quadril[i * 3], quadril[i * 3 + 1], quadril[i * 3 + 2]);
      const alt = Number.isFinite(chao) ? p.dot(cima) - chao - perna : p.dot(cima) - repP.hips.dot(cima);
      anda.subVectors(p, p0).applyQuaternion(G);
      quadril[i * 3] = anda.x / alturaQuadril;
      quadril[i * 3 + 1] = alt / alturaQuadril;
      quadril[i * 3 + 2] = anda.z / alturaQuadril;
    }
    const tracks = ossos.map((n) => new T.QuaternionKeyframeTrack(n + ".quaternion", tempos, valores[n]));
    tracks.push(new T.VectorKeyframeTrack("hips.position", tempos, quadril));
    return new T.AnimationClip(nome, dur, tracks);
  }

  // ── Biblioteca (guardada no aparelho) ───────────────────────────────
  const prontos = new Map(); // id → AnimationClip

  C.movimentos = {
    tipoDe,
    async lista() { return (await LNUX.guardado.ler(LISTA)) || []; },
    /**
     * Importa arquivos (Map nome → Blob; os ZIP são abertos). Devolve {novos: [registro], erros: [texto]}.
     * Um arquivo com várias animações vira vários movimentos.
     */
    async importar(arquivos, pacote = "") {
      const entrada = new Map();
      for (const [nome, blob] of arquivos) {
        if (/\.zip$/i.test(nome)) { for (const [c, b] of await LNUX.Zip.ler(blob)) if (!/(^|\/)(__MACOSX|\.)/.test(c)) entrada.set(c, { blob: b, pacote: pacote || semExt(nome) }); }
        else entrada.set(nome, { blob, pacote });
      }
      const novos = [], erros = [];
      const l = await C.movimentos.lista();
      for (const [caminho, { blob, pacote: pac }] of entrada) {
        const tipo = tipoDe(caminho);
        if (!tipo) { if (/\.(vmd|anim)$/i.test(caminho)) erros.push(`${caminho.split("/").pop()}: esse formato não abre aqui (.vmd é do MikuMikuDance; .anim é do Unity). Converta para .vrma, .fbx ou .bvh.`); continue; }
        try {
          const aberto = await abrirArquivo(tipo, blob);
          let partes = aberto.vrma ? aberto.vrma.map((a, i) => ({ i, dur: a.duration })) : aberto.clips.map((c, i) => ({ i, dur: c.duration, nomeClip: c.name }));
          // os .fbx do Mixamo trazem junto uma "animação" de um quadro só (a pose em T): não é um movimento
          if (tipo === "fbx" && partes.some((x) => x.dur > 0.2)) partes = partes.filter((x) => x.dur > 0.2);
          const mapa = aberto.raiz ? C.mapearOssos(listarOssos(aberto.raiz)) : null;
          for (const parte of partes) {
            const id = LNUX.id("mv");
            const base = semExt(caminho), varios = partes.length > 1;
            const reg = { id, nome: varios ? `${base} · ${parte.nomeClip && !/^(mixamo\.com|take ?\d*|animation)$/i.test(parte.nomeClip) ? parte.nomeClip : parte.i + 1}` : base, pacote: pac || "", tipo, indice: parte.i, duracao: +parte.dur.toFixed(2), criado: Date.now(), mapa: null };
            // já converte (para avisar na hora se o esqueleto não foi reconhecido)
            prontos.set(id, aberto.vrma ? clipDoVRMA(aberto.vrma[parte.i], reg.nome) : retargetar(aberto.raiz, aberto.clips[parte.i], mapa, reg.nome));
            await LNUX.guardado.gravar(chave(id), { blob, tipo, indice: parte.i });
            l.push(reg);
            novos.push(reg);
          }
        } catch (e) { erros.push(`${caminho.split("/").pop()}: ${e.message}`); }
      }
      await LNUX.guardado.gravar(LISTA, l);
      return { novos, erros };
    },
    /** O AnimationClip (canônico) de um movimento guardado. */
    async clip(id) {
      if (prontos.has(id)) return prontos.get(id);
      const reg = (await C.movimentos.lista()).find((x) => x.id === id), dados = await LNUX.guardado.ler(chave(id));
      if (!reg || !dados) throw new Error("Esse movimento não está mais guardado.");
      const aberto = await abrirArquivo(dados.tipo, dados.blob);
      const clip = aberto.vrma ? clipDoVRMA(aberto.vrma[dados.indice || 0], reg.nome)
        : retargetar(aberto.raiz, aberto.clips[dados.indice || 0], reg.mapa || C.mapearOssos(listarOssos(aberto.raiz)), reg.nome);
      prontos.set(id, clip);
      return clip;
    },
    /** Para a janela "Ossos...": os ossos do arquivo e a ligação em uso. null para os .vrma (não precisam). */
    async ossos(id) {
      const reg = (await C.movimentos.lista()).find((x) => x.id === id), dados = await LNUX.guardado.ler(chave(id));
      if (!reg || !dados || dados.tipo === "vrma") return null;
      const aberto = await abrirArquivo(dados.tipo, dados.blob);
      if (!aberto.raiz) return null;
      const lista = listarOssos(aberto.raiz).map((o) => o.nome);
      return { ossos: lista, automatico: C.mapearOssos(listarOssos(aberto.raiz)), mapa: reg.mapa };
    },
    /** Guarda a ligação dos ossos corrigida à mão (null = volta à automática) e refaz o movimento. */
    async definirMapa(id, mapa) {
      const l = await C.movimentos.lista(), reg = l.find((x) => x.id === id);
      if (!reg) return null;
      const anterior = reg.mapa, pronto = prontos.get(id);
      reg.mapa = mapa;
      await LNUX.guardado.gravar(LISTA, l);
      prontos.delete(id);
      try { return await C.movimentos.clip(id); }
      catch (e) { // a ligação não serve (faltou o quadril, por exemplo): fica como estava, e o erro explica
        reg.mapa = anterior;
        await LNUX.guardado.gravar(LISTA, l);
        if (pronto) prontos.set(id, pronto);
        throw e;
      }
    },
    async renomear(id, nome) { const l = await C.movimentos.lista(), reg = l.find((x) => x.id === id); if (reg) { reg.nome = nome; await LNUX.guardado.gravar(LISTA, l); } },
    async apagar(ids) {
      ids = [].concat(ids);
      for (const id of ids) { prontos.delete(id); await LNUX.guardado.apagar(chave(id)); }
      await LNUX.guardado.gravar(LISTA, (await C.movimentos.lista()).filter((x) => !ids.includes(x.id)));
    },
    /** Pelo nome do arquivo, para que serve no cenário: parado, andando, correndo ou pulando (ou null). */
    palpite(nome) {
      const n = String(nome).toLowerCase();
      if (/jump|pul[oa]|salto/.test(n)) return "pulando";
      if (/run|sprint|jog|corr/.test(n)) return "correndo";
      if (/walk|andar|andando|caminh/.test(n)) return "andando";
      if (/idle|stand|parad|breath|espera/.test(n)) return "parado";
      return null;
    },
    _retargetar: retargetar, _abrir: abrirArquivo, _listarOssos: listarOssos,
  };
})();
