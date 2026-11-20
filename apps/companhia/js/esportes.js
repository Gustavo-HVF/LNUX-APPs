/*
 * WEBC — os cinco minijogos de esporte (o motor, a página e os controles ficam em js/minijogos.js).
 *
 *   Tênis    simples ou duplas, contagem de verdade (15, 30, 40, iguais, vantagem), partida de 1, 3 ou 5 games;
 *   Beisebol entradas completas: você rebate (o CPU arremessa) e depois arremessa (o CPU rebate); bolas, strikes,
 *            eliminações, bases e corridas;
 *   Boliche  10 rodadas com strike, spare e a 10ª com bola extra; os pinos se derrubam uns aos outros;
 *   Golfe    percursos de 3, 9 ou 18 buracos sorteados (fairway, rough, areia, água, green com caída e vento);
 *   Boxe     3 rounds contra o adversário: jab e direto, guarda, esquiva, knockdowns e decisão por pontos.
 *
 * Os cenários e os bonecos são originais (feitos aqui, com formas simples). Cada jogo usa a "entrada" do motor: com o
 * mouse e o teclado (mirar, clicar, segurar para carregar a força) ou com a câmera de movimento (o golpe é o movimento
 * rápido do braço; a força é a velocidade; inclinar o corpo esquiva ou mira; as mãos no rosto são a guarda).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const t = (s, v) => (C.t ? C.t(s, v) : s);
  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const G = 9.8;
  const { el } = LNUX;

  /** A câmera vai suave até a posição e o ponto para onde olha. */
  function seguidor(camera, T) {
    const olhar = new T.Vector3(), pos = new T.Vector3();
    let primeiro = true;
    return (p, o, dt, rapidez = 4) => {
      if (primeiro) { pos.copy(p); olhar.copy(o); primeiro = false; }
      const k = 1 - Math.exp(-dt * rapidez);
      pos.lerp(p, k); olhar.lerp(o, k);
      camera.position.copy(pos);
      camera.lookAt(olhar);
    };
  }
  /** A velocidade para ir de a até b em "tempo" segundos, com a gravidade. */
  function lancamento(a, b, tempo) {
    return { x: (b.x - a.x) / tempo, y: (b.y - a.y + 0.5 * G * tempo * tempo) / tempo, z: (b.z - a.z) / tempo };
  }
  const dicaControles = (modo, mouse, camera) => (modo === "camera" ? camera : mouse);
  const aleatorio = (s) => C.minijogos.aleatorio(s);

  // ═════════════════════════════ TÊNIS ═════════════════════════════

  const TENIS = { meio: 11.885, simples: 4.115, duplas: 5.485, saque: 6.4, rede: 0.914, raio: 0.04 };

  function criarTenis(ctx) {
    const { T, cena, camera, entrada, hud, som } = ctx;
    const duplas = ctx.opcoes.modo === "duplas", meta = Math.ceil((+ctx.opcoes.games || 3) / 2);
    const larg = duplas ? TENIS.duplas : TENIS.simples, L = TENIS.meio;
    ctx.ceu({ cima: "#3f9cff", baixo: "#cdeeff", perto: 70, longe: 220 });
    ctx.luzes({ raio: 22, de: [14, 26, 10] });
    // o chão, a quadra (azul) e as linhas
    const grama = ctx.malha(new T.PlaneGeometry(160, 160), "#6dbf4b", { sombra: false });
    grama.rotation.x = -Math.PI / 2;
    cena.add(grama);
    const fundo = ctx.malha(new T.PlaneGeometry(TENIS.duplas * 2 + 8, L * 2 + 12), "#2f8a63", { sombra: false });
    fundo.rotation.x = -Math.PI / 2; fundo.position.y = 0.005;
    const quadra = ctx.malha(new T.PlaneGeometry(TENIS.duplas * 2, L * 2), "#2c62c9", { sombra: false });
    quadra.rotation.x = -Math.PI / 2; quadra.position.y = 0.01;
    cena.add(fundo, quadra);
    const branco = ctx.mat("#ffffff");
    const linha = (x1, z1, x2, z2) => {
      const c = Math.hypot(x2 - x1, z2 - z1), m = new T.Mesh(new T.BoxGeometry(x1 === x2 ? 0.06 : c, 0.01, z1 === z2 ? 0.06 : c), branco);
      m.position.set((x1 + x2) / 2, 0.016, (z1 + z2) / 2); m.receiveShadow = true; cena.add(m);
    };
    for (const s of [-1, 1]) {
      linha(-TENIS.duplas, s * L, TENIS.duplas, s * L);
      linha(-TENIS.simples, s * TENIS.saque, TENIS.simples, s * TENIS.saque);
      linha(s * TENIS.duplas, -L, s * TENIS.duplas, L);
      linha(s * TENIS.simples, -L, s * TENIS.simples, L);
    }
    linha(0, -TENIS.saque, 0, TENIS.saque);
    // a rede
    for (const s of [-1, 1]) { const poste = ctx.malha(new T.CylinderGeometry(0.05, 0.05, 1.07, 10), "#e9edf3"); poste.position.set(s * (TENIS.duplas + 0.6), 0.535, 0); cena.add(poste); }
    const rede = new T.Mesh(new T.PlaneGeometry((TENIS.duplas + 0.6) * 2, TENIS.rede), new T.MeshBasicMaterial({ color: "#20242c", transparent: true, opacity: 0.55, side: T.DoubleSide }));
    rede.position.y = TENIS.rede / 2;
    const fita = ctx.malha(new T.BoxGeometry((TENIS.duplas + 0.6) * 2, 0.06, 0.03), "#ffffff");
    fita.position.y = TENIS.rede;
    cena.add(rede, fita);
    // a torcida, a cerca e a cadeira do juiz
    const torcidas = [ctx.arquibancada({ largura: 30, filas: 6, x: -(TENIS.duplas + 9), z: 0, giro: Math.PI / 2, semente: 3 }), ctx.arquibancada({ largura: 30, filas: 6, x: TENIS.duplas + 9, z: 0, giro: -Math.PI / 2, semente: 5 })];
    for (const s of [-1, 1]) { const cerca = ctx.malha(new T.BoxGeometry(TENIS.duplas * 2 + 8, 2.2, 0.15), "#1f5c44"); cerca.position.set(0, 1.1, s * (L + 6)); cena.add(cerca); }
    const cadeira = ctx.malha(new T.BoxGeometry(0.8, 2.2, 0.8), "#e2c35a"); cadeira.position.set(-(TENIS.duplas + 1.6), 1.1, 0); cena.add(cadeira);
    const juiz = ctx.boneco({ cor: "#f7f7f7", calca: "#222" }); juiz.grupo.position.set(-(TENIS.duplas + 1.6), 2.2, 0); juiz.grupo.rotation.y = Math.PI / 2; juiz.alto = -0.3;
    for (let i = 0; i < 14; i++) ctx.arvore(lerp(-40, 40, i / 13), -(L + 22 + (i % 3) * 4), 1.2 + (i % 4) * 0.2);

    // os jogadores: time +1 (você, perto da câmera, em z > 0) e time -1 (o CPU, em z < 0)
    const raquete = (cor) => {
      const g = new T.Group();
      const cabo = ctx.malha(new T.CylinderGeometry(0.018, 0.022, 0.3, 8), "#333");
      cabo.position.y = -0.12;
      const aro = ctx.malha(new T.TorusGeometry(0.13, 0.016, 8, 22), cor);
      aro.position.y = -0.42; aro.scale.y = 1.25;
      const cordas = new T.Mesh(new T.CircleGeometry(0.125, 18), new T.MeshBasicMaterial({ color: "#f3f3e8", transparent: true, opacity: 0.55, side: T.DoubleSide }));
      cordas.position.y = -0.42; cordas.scale.y = 1.25;
      g.add(cabo, aro, cordas);
      return g;
    };
    const jogadores = [];
    const novo = (time, humano, cor, xBase) => {
      const b = ctx.boneco({ cor, calca: time > 0 ? "#f2f2f2" : "#253047" });
      b.segurar(raquete(time > 0 ? "#ff7a1a" : "#7a5cff"));
      b.grupo.rotation.y = time > 0 ? Math.PI : 0;
      const j = { b, time, humano, xBase, x: xBase, z: time * (L + 0.6), alvo: { x: xBase, z: time * (L + 0.6) }, golpes: 0 };
      jogadores.push(j);
      return j;
    };
    const voce = novo(1, true, ctx.cor, duplas ? 2.4 : 0);
    if (duplas) novo(1, true, "#22b07d", -2.4);
    novo(-1, false, "#ff5a5f", duplas ? -2.4 : 0);
    if (duplas) novo(-1, false, "#ffb020", 2.4);
    const bola = ctx.malha(new T.SphereGeometry(TENIS.raio, 14, 10), "#e2f53c");
    const sombraBola = new T.Mesh(new T.CircleGeometry(0.05, 12), new T.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.25 }));
    sombraBola.rotation.x = -Math.PI / 2;
    cena.add(bola, sombraBola);

    const b = { p: new T.Vector3(), v: new T.Vector3(), quiques: 0, batedor: 0, ladoQuique: 0, viva: false, saque: false, lancada: 0, falta: 0, previsto: null };
    const placar = { pontos: [0, 0], games: [0, 0], sacador: 1, fim: false, pontosJogados: 0, golpesVoce: 0, trocas: 0 };
    const idx = (time) => (time > 0 ? 0 : 1);
    let fase = "saque", espera = 1.2, mensagem = null;
    const seguir = seguidor(camera, T);

    function textoPontos() {
      const [a, c] = placar.pontos;
      const nomes = ["0", "15", "30", "40"];
      if (a >= 3 && c >= 3) return a === c ? t("Iguais") : t("Vantagem: {quem}", { quem: a > c ? t("Você") : t("CPU") });
      return `${nomes[Math.min(3, a)]} – ${nomes[Math.min(3, c)]}`;
    }
    function desenharPlacar() {
      hud.placar([el("span", { class: "mj-chip" }, t("Games {a} – {b}", { a: placar.games[0], b: placar.games[1] })), el("span", { class: "mj-chip forte", "data-pontos": placar.pontos.join("-") }, textoPontos()),
        el("span", { class: "mj-chip" }, placar.sacador > 0 ? t("Saque: você") : t("Saque: CPU"))]);
    }
    function posicionarParaSaque() {
      const lado = placar.pontosJogados % 2 === 0 ? 1 : -1; // pontos pares: do lado direito (de quem saca)
      for (const j of jogadores) {
        const doSacador = j.time === placar.sacador;
        const principal = jogadores.find((x) => x.time === j.time) === j;
        let x = j.xBase, z = j.time * (L + 0.5);
        if (duplas && !principal) z = j.time * (doSacador ? 4 : L + 0.5); // o parceiro de quem saca fica perto da rede
        if (principal) x = doSacador ? lado * j.time * 1.2 : lado * j.time * 2.6;
        if (!duplas && !doSacador) x = lado * j.time * 2.4;
        j.x = j.alvo.x = x; j.z = j.alvo.z = z;
      }
      b.viva = false; b.saque = true; b.quiques = 0; b.lancada = 0; b.batedor = 0;
      const s = sacador();
      b.p.set(s.x + s.time * -0.35, 1.0, s.z);
      b.v.set(0, 0, 0);
    }
    const sacador = () => jogadores.find((j) => j.time === placar.sacador);
    /** O ponto vai para o time "time". */
    function ponto(time, motivo) {
      if (fase === "morta") return;
      fase = "morta"; espera = 1.8; b.viva = false;
      placar.pontos[idx(time)]++;
      placar.pontosJogados++;
      som(time > 0 ? "ponto" : "erro");
      if (time > 0) torcidas.forEach((tc) => tc.comemorar());
      mensagem = motivo;
      const [a, c] = placar.pontos;
      if ((a >= 4 || c >= 4) && Math.abs(a - c) >= 2) {
        const venceu = a > c ? 1 : -1;
        placar.games[idx(venceu)]++;
        placar.pontos = [0, 0];
        placar.pontosJogados = 0;
        placar.sacador = -placar.sacador;
        hud.aviso(venceu > 0 ? t("Game seu!") : t("Game do CPU"), 1700, venceu > 0 ? "bom" : "ruim");
        if (placar.games[idx(venceu)] >= meta) {
          placar.fim = true;
          setTimeout(() => ctx.fim({ vitoria: venceu > 0, forcaCPU: ctx.forcaCPU, recorde: { valor: placar.trocas, melhor: "maior", rotulo: t("troca de {n} bolas", { n: placar.trocas }) }, titulo: venceu > 0 ? t("Você venceu!") : t("O CPU venceu"),
            subtitulo: t("Games {a} – {b}", { a: placar.games[0], b: placar.games[1] }), linhas: [t("Rebatidas suas: {n}", { n: placar.golpesVoce }), t("Maior troca de bola: {n}", { n: placar.trocas })] }), 1400);
        }
      } else hud.aviso(motivo + " · " + textoPontos(), 1500, time > 0 ? "bom" : "ruim");
      desenharPlacar();
    }
    /** Prevê onde a bola vai estar (simula a física) e escolhe o ponto de rebater do lado de "time". */
    function prever(time) {
      const p = b.p.clone(), v = b.v.clone();
      let quiques = b.ladoQuique === time ? b.quiques : 0, tAc = 0, pouso = null;
      for (let i = 0; i < 240; i++) {
        const dt = 1 / 60;
        v.y -= G * dt; p.addScaledVector(v, dt); tAc += dt;
        if (p.y <= TENIS.raio && v.y < 0) {
          p.y = TENIS.raio; v.y *= -0.72; v.x *= 0.82; v.z *= 0.82;
          if (Math.sign(p.z) === time) { quiques++; if (!pouso) pouso = { x: p.x, z: p.z }; }
        }
        if (Math.sign(p.z) === time && quiques >= 1 && p.y > 0.35 && p.y < 1.5 && v.y < 1) return { x: p.x, z: p.z, t: tAc, pouso };
        if (quiques >= 2) break;
      }
      return pouso ? { x: pouso.x, z: pouso.z + time * 2, t: tAc, pouso } : null;
    }
    /** O jogador j bate na bola. qualidade 0 a 1; direcao -1 (esquerda de quem bate) a 1; forca 0 a 1. */
    function rebater(j, qualidade, direcao, forca, saque = false) {
      const destino = -j.time, r = Math.random;
      let tx, tz;
      if (saque) {
        const lado = placar.pontosJogados % 2 === 0 ? 1 : -1; // na diagonal
        tx = -lado * j.time * lerp(0.6, TENIS.simples - 0.4, limitar(0.5 + direcao * 0.5));
        tz = destino * lerp(2.5, TENIS.saque - 0.4, 0.4 + 0.5 * forca);
      } else {
        tx = limitar(direcao, -1, 1) * j.time * (larg - 0.5) * 0.9; // a direita de quem bate: +x para o time +1 (olha para -z)
        tz = destino * lerp(6, L - 0.6, limitar(0.35 + 0.5 * forca + (r() - 0.5) * 0.2));
      }
      const erro = (1 - qualidade) * (saque ? 2.2 : 3.2);
      tx += (r() - 0.5) * erro * 1.6;
      tz += destino * (r() - 0.35) * erro;
      let tempo = lerp(1.45, 0.8, forca) * (saque ? 0.85 : 1);
      const de = { x: b.p.x, y: Math.max(0.6, b.p.y), z: b.p.z }, para = { x: tx, y: TENIS.raio, z: tz };
      let v;
      for (let k = 0; k < 10; k++) { // passa por cima da rede (se a qualidade deixar)
        v = lancamento(de, para, tempo);
        const tn = -de.z / v.z, alt = de.y + v.y * tn - 0.5 * G * tn * tn;
        if (alt > TENIS.rede + 0.15 || qualidade < 0.25) break;
        tempo += 0.12;
      }
      b.p.set(de.x, de.y, de.z);
      b.v.set(v.x, v.y, v.z);
      b.quiques = 0; b.ladoQuique = 0; b.batedor = j.time; b.viva = true; b.saque = saque;
      j.golpes++;
      som("bola");
      placar.trocaAtual = (placar.trocaAtual || 0) + 1;
      placar.trocas = Math.max(placar.trocas, placar.trocaAtual);
      b.previsto = prever(destino);
    }
    const animarGolpe = (j, saque) => j.b.animar(saque
      ? [{ t: 0, pose: { ombroD: [-2.9, 0, -0.3], tronco: [0.15, 0.3, 0] } }, { t: 0.5, pose: { ombroD: [-3.0, 0, -0.2], tronco: [-0.2, 0, 0] } }, { t: 1, pose: { ombroD: [-0.9, 0, -0.5], tronco: [0.25, -0.4, 0] } }]
      : [{ t: 0, pose: { ombroD: [-0.3, 0, -1.3], tronco: [0, 0.9, 0] } }, { t: 0.45, pose: { ombroD: [-1.3, 0, -1.2], tronco: [0, -0.4, 0] } }, { t: 1, pose: { ombroD: [-1.9, 0, -0.5], tronco: [0, -0.9, 0] } }], saque ? 0.45 : 0.36);
    /** Quem do meu time cuida desta bola (nas duplas, o mais perto de onde ela vai chegar). */
    function responsavel(time) {
      const meus = jogadores.filter((j) => j.time === time);
      if (!b.previsto || meus.length < 2) return meus[0];
      return meus.reduce((a, c) => (Math.abs(c.x - b.previsto.x) + Math.abs(c.z - b.previsto.z) * 0.3 < Math.abs(a.x - b.previsto.x) + Math.abs(a.z - b.previsto.z) * 0.3 ? c : a));
    }
    // você bate: com o clique (ou Espaço) ou com o movimento do braço (câmera)
    function golpeHumano(forcaCamera = null, dxCamera = 0) {
      if (placar.fim) return;
      if (fase === "saque" && placar.sacador > 0 && b.saque) {
        const j = sacador();
        if (!b.lancada) { b.lancada = performance.now(); b.v.set(0, 4.6, 0); b.p.y = 1.2; animarGolpe(j, true); return; } // o primeiro toque joga a bola para cima
        const alt = b.p.y, q = limitar(1 - Math.abs(alt - 2.3) / 1.4);
        animarGolpe(j, true);
        if (alt < 1.3) return;
        if (q < 0.3 && Math.random() < 0.7) return falta(j, t("Saque na rede"));
        rebater(j, 0.55 + q * 0.45, entrada.mira.x + dxCamera * 0.6, forcaCamera ?? 0.7, true);
        fase = "jogo";
        return;
      }
      if (fase !== "jogo" || !b.viva || b.batedor > 0 && Math.sign(b.p.z) < 0) {
        const j = responsavel(1); if (j && !j.b.animando) animarGolpe(j, false);
        return;
      }
      const j = responsavel(1);
      animarGolpe(j, false);
      // onde a bola vai estar daqui a pouco (a raquete leva um instante para chegar)
      const fut = b.p.clone().addScaledVector(b.v, 0.08), contato = new T.Vector3(j.x + 0.55, 1.0, j.z - 0.4);
      const dz = fut.z - contato.z, dx = fut.x - contato.x;
      const pode = Math.sign(b.p.z) > 0 && b.batedor < 0 && b.quiques <= 1 && fut.y < 2.6 && Math.abs(dx) < 1.9 && dz > -1.6 && dz < 1.3;
      if (!pode) return;
      const atraso = limitar(dz / 1.3, -1, 1); // < 0: cedo; > 0: tarde
      const q = limitar(1 - Math.pow(Math.abs(atraso), 1.4) * 0.8 - Math.max(0, Math.abs(dx) - 1.1) * 0.5);
      const forca = forcaCamera ?? limitar(0.45 + (entrada.mira.y + 1) * 0.22);
      rebater(j, q, limitar(entrada.mira.x * 0.8 + atraso * 0.55 + dxCamera * 0.5, -1, 1), forca); // cedo puxa para a esquerda
      placar.golpesVoce++;
      if (q > 0.85) hud.aviso(t("Perfeito!"), 700, "bom");
    }
    function falta(j, motivo) {
      b.falta++;
      if (b.falta >= 2) { b.falta = 0; ponto(-j.time, t("Dupla falta")); return; }
      hud.aviso(motivo + " · " + t("Segundo saque"), 1300, "ruim");
      som("erro");
      fase = "morta"; espera = 1.1; mensagem = "falta";
    }
    entrada.on("toque", () => golpeHumano());
    entrada.on("golpe", (g) => golpeHumano(g.forca, g.dx));

    function atualizarIA(dt) {
      for (const j of jogadores) {
        if (j.humano && fase === "jogo") {
          // os seus andam sozinhos até a bola (você só precisa acertar o tempo do golpe e mirar)
          if (b.batedor < 0 && b.previsto && responsavel(1) === j) { j.alvo.x = b.previsto.x - 0.55; j.alvo.z = Math.max(1.5, b.previsto.z + 0.4); }
          else { j.alvo.x = j.xBase; j.alvo.z = duplas && j !== voce ? 5 : L - 0.5; }
        }
        if (!j.humano && fase === "jogo") {
          if (b.batedor > 0 && b.previsto && responsavel(-1) === j) { j.alvo.x = b.previsto.x + 0.55; j.alvo.z = Math.min(-1.5, b.previsto.z - 0.4); }
          else { j.alvo.x = j.xBase; j.alvo.z = duplas && jogadores.filter((x) => x.time < 0)[1] === j ? -5 : -(L - 0.5); }
          // a IA bate quando a bola chega perto
          const contato = new T.Vector3(j.x - 0.55, 1.0, j.z + 0.4);
          if (b.viva && b.batedor > 0 && Math.sign(b.p.z) < 0 && b.quiques <= 1 && b.p.y < 2.4 && b.p.distanceTo(contato) < 1.0 && b.v.z < 0 && (b.quiques === 1 || Math.abs(b.p.z) < 6)) {
            const fora = b.previsto && b.previsto.pouso && (Math.abs(b.previsto.pouso.x) > larg + 0.05 || b.previsto.pouso.z < -L - 0.05);
            const ia = ctx.ia, prec = ia ? ia.precisao : 0.6;
            if (fora && Math.random() < 0.6 + 0.35 * prec) continue; // deixa a bola ir para fora (o fraco às vezes rebate)
            const veloz = limitar((b.v.length() - 14) / 14);
            const acerta = Math.random() > (0.08 + veloz * 0.25) * (1.6 - prec);
            animarGolpe(j, false);
            const lado = ia ? limitar(lerp(-0.9, 0.9, Math.random()) + ia.lado * 0.25, -0.95, 0.95) : lerp(-0.9, 0.9, Math.random());
            rebater(j, acerta ? lerp(0.55 + 0.2 * prec, 0.8 + 0.18 * prec, Math.random()) : 0.15, lado, lerp(0.3, 0.6 + 0.3 * (ia ? ia.potencia : 0.5), Math.random()));
          }
        }
        // anda até o alvo
        const dx = j.alvo.x - j.x, dz = j.alvo.z - j.z, d = Math.hypot(dx, dz), vel = j.humano ? 7.5 : 5.2 + 2 * (ctx.ia ? ctx.ia.velocidade : 0.5);
        const passo = Math.min(d, vel * dt);
        if (d > 0.01) { j.x += (dx / d) * passo; j.z += (dz / d) * passo; }
        j.b.andando = limitar(d / 1.2) * (passo > 0.001 ? 1 : 0);
        j.b.grupo.position.set(j.x, 0, j.z);
        j.b.atualizar(dt);
      }
    }
    function fisica(dt) {
      if (fase === "saque" && b.saque) {
        const s = sacador();
        if (!b.lancada) { b.p.set(s.x - s.time * 0.35, 1.0, s.z - s.time * 0.2); return; }
        b.v.y -= G * dt; b.p.addScaledVector(b.v, dt);
        if (b.p.y < 0.9) { b.lancada = 0; b.v.set(0, 0, 0); } // não bateu: joga de novo
        return;
      }
      if (!b.viva) return;
      const antes = b.p.z;
      b.v.y -= G * dt;
      b.p.addScaledVector(b.v, dt);
      if (Math.sign(antes) !== Math.sign(b.p.z) && b.p.y < TENIS.rede + TENIS.raio && Math.abs(b.p.x) < TENIS.duplas + 0.6) { // na rede
        b.p.z = antes; b.v.set(b.v.x * 0.2, 0, -b.v.z * 0.15);
        if (b.saque) return falta(jogadores.find((j) => j.time === b.batedor), t("Na rede"));
        return ponto(-b.batedor, t("Na rede"));
      }
      if (b.p.y <= TENIS.raio && b.v.y < 0) {
        b.p.y = TENIS.raio; b.v.y *= -0.72; b.v.x *= 0.82; b.v.z *= 0.82;
        som("quique");
        const lado = Math.sign(b.p.z) || 1;
        if (lado !== b.ladoQuique) { b.ladoQuique = lado; b.quiques = 0; }
        b.quiques++;
        if (lado === b.batedor) return ponto(-b.batedor, t("Quicou do seu lado"));
        if (b.quiques === 1) {
          const dentro = b.saque
            ? Math.abs(b.p.z) <= TENIS.saque + 0.05 && Math.abs(b.p.x) <= TENIS.simples + 0.05 && Math.sign(b.p.x) === -(placar.pontosJogados % 2 === 0 ? 1 : -1) * b.batedor
            : Math.abs(b.p.z) <= L + 0.05 && Math.abs(b.p.x) <= larg + 0.05;
          if (!dentro) {
            if (b.saque) return falta(jogadores.find((j) => j.time === b.batedor), t("Fora"));
            return ponto(-b.batedor, t("Fora!"));
          }
          b.saque = false;
          b.previsto = prever(lado);
        } else if (b.quiques >= 2) return ponto(b.batedor, b.batedor > 0 ? t("Ponto seu!") : t("Ponto do CPU"));
      }
      if (Math.abs(b.p.z) > L + 9 || Math.abs(b.p.x) > TENIS.duplas + 9) ponto(b.quiques ? b.batedor : -b.batedor, b.quiques ? t("Ponto!") : t("Fora!"));
    }
    posicionarParaSaque();
    desenharPlacar();
    hud.aviso(duplas ? t("Duplas — você saca") : t("Simples — você saca"), 1800);
    return {
      dica: (modo) => dicaControles(modo,
        t("Clique (ou Espaço) para jogar a bola e de novo para sacar. Na troca, clique quando a bola chegar; o mouse mira (alto = bola mais longa)."),
        t("Faça o movimento do saque (dois movimentos: jogar a bola e bater). Na troca, gire o braço quando a bola chegar; mais rápido = mais forte. A mão mira.")),
      atualizar(dt) {
        const passos = 3;
        for (let i = 0; i < passos; i++) fisica(dt / passos);
        atualizarIA(dt);
        if (fase === "saque" && placar.sacador < 0 && b.saque) {
          espera -= dt;
          if (espera <= 0 && !b.lancada) { b.lancada = performance.now(); b.v.set(0, 4.6, 0); b.p.y = 1.2; animarGolpe(sacador(), true); }
          else if (b.lancada && b.p.y > 2.1 && b.v.y < 0.4) {
            if (Math.random() < 0.08) { falta(sacador(), t("Saque fora")); }
            else { rebater(sacador(), lerp(0.75, 1, Math.random()), lerp(-1, 1, Math.random()), lerp(0.5, 0.85, Math.random()), true); fase = "jogo"; }
          }
        }
        if (fase === "morta") {
          espera -= dt;
          if (espera <= 0 && !placar.fim) {
            if (mensagem !== "falta") b.falta = 0;
            placar.trocaAtual = 0;
            fase = "saque"; espera = 1.3; posicionarParaSaque();
          }
        }
        bola.position.copy(b.p);
        sombraBola.position.set(b.p.x, 0.02, b.p.z);
        sombraBola.visible = b.p.y < 6;
        for (const tc of torcidas) tc.atualizar(dt);
        juiz.atualizar(dt);
        const alvoX = limitar(voce.x * 0.4, -2, 2);
        seguir(new T.Vector3(alvoX, 5.4, L + 8.5), new T.Vector3(alvoX * 0.5, 0.4, -3), dt, 3);
      },
      estado: () => ({ fase, placar: JSON.parse(JSON.stringify(placar)), bola: { viva: b.viva, batedor: b.batedor, quiques: b.quiques, z: b.p.z, y: b.p.y, saque: b.saque, lancada: !!b.lancada },
        jogadores: jogadores.length, golpes: jogadores.map((j) => j.golpes), texto: textoPontos() }),
      // para os testes: põe a bola chegando a você, pronta para rebater
      bolaParaVoce(longe = 1.4, vel = 9) {
        fase = "jogo"; b.saque = false; b.viva = true; b.batedor = -1; b.ladoQuique = 1; b.quiques = 1;
        const j = responsavel(1); b.p.set(j.x + 0.55, 1.0, j.z - longe); b.v.set(0, 0.5, vel);
      },
    };
  }

  // ════════════════════════════ BOLICHE ════════════════════════════

  const BOLICHE = { meia: 0.527, canaleta: 0.762, cabeca: -18.29, raioBola: 0.109, raioPino: 0.06, fosso: -19.35 };
  /**
   * Os pontos de uma partida de boliche. jogadas: os pinos de cada bola, em ordem. Devolve {quadros: [{bolas: [..],
   * marcas: ["X", "/", "-", "7"...], total (acumulado, ou null enquanto falta bola para saber)}], total}.
   */
  function pontosBoliche(jogadas) {
    const quadros = [];
    let i = 0, soma = 0, pendente = false;
    const marca = (p) => (p === 10 ? "X" : p ? String(p) : "-");
    for (let q = 0; q < 10; q++) {
      const f = { bolas: [], marcas: [], total: null };
      if (q < 9) {
        if (i >= jogadas.length) { quadros.push(f); continue; }
        if (jogadas[i] === 10) {
          f.bolas = [10]; f.marcas = ["X"];
          if (jogadas[i + 2] !== undefined && !pendente) { soma += 10 + jogadas[i + 1] + jogadas[i + 2]; f.total = soma; } else pendente = true;
          i += 1;
        } else {
          f.bolas = jogadas.slice(i, i + 2);
          f.marcas = [jogadas[i] ? String(jogadas[i]) : "-"];
          if (jogadas[i + 1] !== undefined) {
            const spare = jogadas[i] + jogadas[i + 1] === 10;
            f.marcas.push(spare ? "/" : jogadas[i + 1] ? String(jogadas[i + 1]) : "-");
            if (pendente) { /* um quadro antes ainda espera bolas */ }
            else if (spare) { if (jogadas[i + 2] !== undefined) { soma += 10 + jogadas[i + 2]; f.total = soma; } else pendente = true; }
            else { soma += jogadas[i] + jogadas[i + 1]; f.total = soma; }
          } else pendente = true;
          i += 2;
        }
      } else {
        const b = (f.bolas = jogadas.slice(i, i + 3));
        if (b[0] !== undefined) f.marcas.push(marca(b[0]));
        if (b[1] !== undefined) f.marcas.push(b[0] === 10 ? marca(b[1]) : b[0] + b[1] === 10 ? "/" : marca(b[1]).replace("X", "10"));
        if (b[2] !== undefined) {
          if (b[0] === 10 && b[1] !== 10) f.marcas.push(b[1] + b[2] === 10 ? "/" : marca(b[2])); // o 2º não foi strike: os pinos que sobraram
          else f.marcas.push(marca(b[2])); // pinos novos (depois de strike ou spare)
        }
        const precisa = b.length >= 2 && b[0] + b[1] < 10 ? 2 : 3;
        if (b.length >= precisa && !pendente) { soma += b.reduce((a, c) => a + c, 0); f.total = soma; }
      }
      quadros.push(f);
    }
    return { quadros, total: soma };
  }
  /** Quantas bolas cabem no quadro 10 (2, ou 3 com strike ou spare) e quantos pinos ficam em pé para a próxima. */
  function decimoQuadro(bolas) {
    if (bolas.length === 0) return { acabou: false, novos: true };
    if (bolas.length === 1) return { acabou: false, novos: bolas[0] === 10 };
    if (bolas.length === 2) {
      if (bolas[0] === 10) return { acabou: false, novos: bolas[1] === 10 };
      if (bolas[0] + bolas[1] === 10) return { acabou: false, novos: true };
      return { acabou: true };
    }
    return { acabou: true };
  }

  function criarBoliche(ctx) {
    const { T, cena, camera, entrada, hud, som } = ctx;
    const peso = { leve: 0.85, media: 1, pesada: 1.15 }[ctx.opcoes.bola] || 1;
    cena.background = new T.Color("#1b1f3a");
    cena.fog = new T.Fog("#1b1f3a", 26, 60);
    cena.add(new T.HemisphereLight("#fff2e0", "#3a3550", 1.4));
    const luz = new T.DirectionalLight("#ffffff", 1.6);
    luz.position.set(2, 8, 4); luz.target.position.set(0, 0, -10);
    luz.castShadow = true; luz.shadow.mapSize.set(1024, 1024);
    Object.assign(luz.shadow.camera, { left: -4, right: 4, top: 12, bottom: -24, near: 1, far: 40 });
    cena.add(luz, luz.target);
    const holofote = new T.PointLight("#fff3d6", 30, 12, 1.6); holofote.position.set(0, 3, BOLICHE.cabeca + 1.5); cena.add(holofote);
    // a pista (madeira clara), as canaletas, as pistas vizinhas, as paredes e as faixas coloridas
    const madeira = (() => {
      const c = document.createElement("canvas"); c.width = 128; c.height = 1024;
      const g = c.getContext("2d");
      for (let i = 0; i < 39; i++) { g.fillStyle = i % 2 ? "#e7c08a" : "#dcb27a"; g.fillRect(i * (128 / 39), 0, 128 / 39 + 1, 1024); }
      g.fillStyle = "rgba(120,60,20,.5)";
      for (const [z, n] of [[0.81, 7], [0.69, 5]]) for (let k = 0; k < n; k++) { const x = 64 + (k - (n - 1) / 2) * 13; g.beginPath(); g.moveTo(x, z * 1024 - 10); g.lineTo(x - 5, z * 1024 + 6); g.lineTo(x + 5, z * 1024 + 6); g.fill(); }
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4; return tex;
    })();
    const pistas = [];
    for (const dx of [-2.4, 0, 2.4]) {
      const p = ctx.malha(new T.BoxGeometry(BOLICHE.meia * 2, 0.1, 24), ctx.mat("#ffffff", { mapa: madeira }), { sombra: false });
      p.position.set(dx, -0.05, -8.5); cena.add(p); pistas.push(p);
      for (const s of [-1, 1]) {
        const can = ctx.malha(new T.CylinderGeometry(0.12, 0.12, 24, 12, 1, true, 0, Math.PI), "#9aa3b8", { sombra: false });
        can.rotation.set(Math.PI / 2, 0, Math.PI); can.position.set(dx + s * 0.645, 0.0, -8.5); cena.add(can);
      }
      const separador = ctx.malha(new T.BoxGeometry(0.25, 0.25, 22), "#3a3f63"); separador.position.set(dx + 1.2, 0.12, -9.5); cena.add(separador);
    }
    const parede = ctx.malha(new T.BoxGeometry(12, 4, 0.3), "#262b52"); parede.position.set(0, 1.4, BOLICHE.fosso - 1.5); cena.add(parede);
    const mascara = ctx.malha(new T.BoxGeometry(8, 1.2, 0.2), "#ff4d8d", { emissivo: "#661133" }); mascara.position.set(0, 1.9, BOLICHE.fosso - 0.2); cena.add(mascara);
    for (const [cor, y] of [["#38d9ff", 2.6], ["#ffd23f", 2.9]]) { const f = ctx.malha(new T.BoxGeometry(12, 0.08, 0.05), cor, { emissivo: cor }); f.position.set(0, y, BOLICHE.fosso - 1.3); cena.add(f); }
    for (const s of [-1, 1]) { const lado = ctx.malha(new T.BoxGeometry(0.3, 3.4, 30), "#2f3566"); lado.position.set(s * 4.2, 1.6, -9); cena.add(lado); }
    const chao = ctx.malha(new T.PlaneGeometry(10, 8), "#4a3b7a", { sombra: false }); chao.rotation.x = -Math.PI / 2; chao.position.set(0, -0.09, 3); cena.add(chao);
    // os pinos
    const perfil = [[0, 0], [0.026, 0], [0.045, 0.06], [0.06, 0.13], [0.058, 0.2], [0.04, 0.27], [0.022, 0.32], [0.024, 0.34], [0.03, 0.36], [0.025, 0.38], [0, 0.381]].map(([x, y]) => new T.Vector2(x * 1.0, y));
    const geoPino = new T.LatheGeometry(perfil, 16), geoFaixa = new T.TorusGeometry(0.025, 0.0055, 6, 16);
    const matPino = ctx.mat("#fbfbf6"), matFaixa = ctx.mat("#e23b3b");
    const posPinos = [];
    for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) posPinos.push([(i - r / 2) * 0.3048, BOLICHE.cabeca - r * 0.264]);
    for (const dx of [-2.4, 2.4]) for (const [x, z] of posPinos) { const m = new T.Mesh(geoPino, matPino); m.position.set(dx + x, 0, z); cena.add(m); }
    const pinos = posPinos.map(([x, z]) => {
      const g = new T.Group(), m = new T.Mesh(geoPino, matPino), f1 = new T.Mesh(geoFaixa, matFaixa), f2 = new T.Mesh(geoFaixa, matFaixa);
      m.castShadow = true; f1.rotation.x = f2.rotation.x = Math.PI / 2; f1.position.y = 0.29; f2.position.y = 0.305; f1.scale.setScalar(0.92); f2.scale.setScalar(0.98);
      g.add(m, f1, f2); cena.add(g);
      return { g, x0: x, z0: z, x, z, vx: 0, vz: 0, caido: false, contado: false, fora: false, tomba: 0, eixo: new T.Vector3(1, 0, 0) };
    });
    // a bola e quem joga
    const bolaG = new T.Group();
    const bolaM = ctx.malha(new T.SphereGeometry(BOLICHE.raioBola, 24, 18), ctx.cor);
    bolaG.add(bolaM);
    for (const [x, y] of [[-0.025, 0.06], [0.025, 0.06], [0, 0.02]]) { const furo = new T.Mesh(new T.CircleGeometry(0.012, 10), new T.MeshBasicMaterial({ color: "#111" })); furo.position.set(x, y, Math.sqrt(BOLICHE.raioBola ** 2 - x * x - y * y) + 0.001); furo.lookAt(furo.position.clone().multiplyScalar(2)); bolaM.add(furo); }
    cena.add(bolaG);
    const jogador = ctx.boneco({ cor: ctx.cor, calca: "#2b2b3c" });
    jogador.grupo.rotation.y = Math.PI;
    const mira = new T.Mesh(new T.ConeGeometry(0.07, 0.25, 3), new T.MeshBasicMaterial({ color: "#ffe04d", transparent: true, opacity: 0.85 }));
    mira.rotation.x = -Math.PI / 2; cena.add(mira);
    const seguir = seguidor(camera, T);

    const jogo = { jogadas: [], quadro: 0, bolaNoQuadro: 0, emPe: 10, fase: "mirando", posX: 0, b: { x: 0, z: 0, vx: 0, vz: 0, curva: 0, giro: 0, canaleta: false }, espera: 0, ultimo: null, lancamentos: 0 };
    function arrumarPinos(todos) {
      for (const p of pinos) {
        if (todos) { p.caido = false; p.fora = false; p.contado = false; p.x = p.x0; p.z = p.z0; p.tomba = 0; }
        if (p.caido || p.fora) { p.g.visible = false; p.contado = true; continue; } // a máquina tira os caídos
        p.vx = p.vz = 0; p.g.visible = true; p.g.rotation.set(0, 0, 0); p.g.position.set(p.x, 0, p.z);
      }
    }
    function desenharPlacar() {
      const r = pontosBoliche(jogo.jogadas);
      const tabela = el("div", { class: "mj-boliche", role: "table", "aria-label": t("Placar do boliche") },
        ...r.quadros.map((f, k) => el("div", { class: "mj-quadro" + (k === jogo.quadro && jogo.fase !== "fim" ? " atual" : ""), role: "cell", "data-quadro": k + 1 },
          el("span", { class: "mj-quadro-n" }, String(k + 1)),
          el("span", { class: "mj-quadro-bolas" }, ...[0, 1, 2].slice(0, k === 9 ? 3 : 2).map((i) => el("i", {}, f.marcas[i] || ""))),
          el("b", { class: "mj-quadro-total" }, f.total === null ? "" : String(f.total)))));
      hud.placar([tabela]);
      return r;
    }
    function lancar(forca, curva) {
      if (jogo.fase !== "mirando") return;
      jogo.fase = "andando";
      jogo.espera = 0.75;
      jogo.forca = forca; jogo.curva = curva;
      jogador.animar([{ t: 0, pose: { ombroD: [0.2, 0, -0.1] } }, { t: 0.45, pose: { ombroD: [1.1, 0, -0.1], tronco: [0.25, 0, 0] } }, { t: 0.85, pose: { ombroD: [-1.0, 0, -0.1], tronco: [0.45, 0, 0], pernaE: [-0.7, 0, 0], pernaD: [0.5, 0, 0] } }, { t: 1, pose: { ombroD: [-1.6, 0, -0.1], tronco: [0.4, 0, 0], pernaE: [-0.7, 0, 0], pernaD: [0.5, 0, 0] } }], 0.9);
    }
    entrada.on("solta", (s) => lancar(s.forca, s.dx));
    entrada.on("golpe", (g) => lancar(g.forca, g.dx));
    function soltarBola() {
      const v = lerp(5.2, 9.2, limitar(jogo.forca)) * (jogo.forca < 0.04 ? 0.8 : 1) * (peso > 1 ? 0.97 : peso < 1 ? 1.04 : 1);
      jogo.b = { x: jogo.posX, z: -0.3, vx: 0, vz: -v, curva: limitar(jogo.curva, -1, 1) * 1.9, giro: 0, canaleta: false };
      jogo.fase = "rolando";
      jogo.lancamentos++;
      som("rolar");
    }
    function colisao(a, ra, ma, c, rc, mc, restituicao) {
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), min = ra + rc;
      if (d >= min || d < 1e-6) return false;
      const nx = dx / d, nz = dz / d, sobra = min - d;
      const total = ma + mc;
      a.x -= nx * sobra * (mc / total); a.z -= nz * sobra * (mc / total);
      c.x += nx * sobra * (ma / total); c.z += nz * sobra * (ma / total);
      const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
      if (rel > 0) return true;
      const j = -(1 + restituicao) * rel / (1 / ma + 1 / mc);
      a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
      c.vx += (j / mc) * nx; c.vz += (j / mc) * nz;
      // um pouco de espalhamento (os pinos não são cilindros perfeitos)
      const lateral = (Math.random() - 0.5) * 0.25 * Math.abs(rel);
      c.vx += -nz * lateral; c.vz += nx * lateral;
      return true;
    }
    function derrubar(p) {
      if (p.caido) return;
      p.caido = true;
      const v = Math.hypot(p.vx, p.vz) || 1;
      p.eixo.set(-p.vz / v, 0, p.vx / v).normalize();
      if (!p.eixo.lengthSq()) p.eixo.set(1, 0, 0);
    }
    function passoFisica(dt) {
      const b = jogo.b, mBola = 7 * peso, mPino = 1.5;
      if (jogo.fase === "rolando") {
        if (!b.canaleta) {
          if (b.z < -5.5) b.vx += b.curva * dt; // a bola pega efeito no fim da pista (onde não tem óleo)
          b.x += b.vx * dt; b.z += b.vz * dt;
          if (Math.abs(b.x) > BOLICHE.meia - 0.03 && b.z > BOLICHE.cabeca + 0.5) { b.canaleta = true; b.x = Math.sign(b.x) * 0.645; b.vx = 0; hud.aviso(t("Canaleta"), 1200, "ruim"); som("erro"); }
        } else { b.z += b.vz * dt; }
        b.giro += (b.vz * dt) / BOLICHE.raioBola;
        if (!b.canaleta) for (const p of pinos) if (!p.fora && p.g.visible) { if (colisao(b, BOLICHE.raioBola, mBola, p, BOLICHE.raioPino, mPino, 0.7)) { if (!jogo.bateu) { som("pinos"); jogo.bateu = true; } } }
        if (b.z < BOLICHE.fosso) { jogo.fase = "pinos"; jogo.espera = 2.2; }
      }
      for (let i = 0; i < pinos.length; i++) {
        const p = pinos[i];
        if (p.fora || !p.g.visible) continue;
        for (let k = i + 1; k < pinos.length; k++) { const o = pinos[k]; if (!o.fora && o.g.visible) colisao(p, p.caido ? 0.09 : BOLICHE.raioPino, mPino, o, o.caido ? 0.09 : BOLICHE.raioPino, mPino, 0.55); }
      }
      for (const p of pinos) {
        if (p.fora || !p.g.visible) continue;
        const v = Math.hypot(p.vx, p.vz);
        if (v > 0.32 || Math.hypot(p.x - p.x0, p.z - p.z0) > 0.05) derrubar(p);
        if (v > 0) { const f = Math.max(0, v - (p.caido ? 2.6 : 3.5) * dt) / v; p.vx *= f; p.vz *= f; }
        p.x += p.vx * dt; p.z += p.vz * dt;
        if (p.z < BOLICHE.fosso || Math.abs(p.x) > BOLICHE.meia + 0.05) { derrubar(p); p.fora = true; }
      }
    }
    function contar() {
      let novos = 0;
      for (const p of pinos) if ((p.caido || p.fora) && !p.contado) { p.contado = true; novos++; }
      // split (js/esportes-nucleo.js): só na 1ª bola de um jogo de pinos completo
      const N = C.esportesNucleo, cheio = jogo.quadro < 9 ? jogo.bolaNoQuadro === 0 : decimoQuadro(pontosBoliche(jogo.jogadas).quadros[9].bolas).novos;
      const resto = N ? N.mascara(pinos.map((p) => !p.caido && !p.fora)) : 0;
      const split = !!(N && cheio && novos < 10 && N.ehSplit(resto));
      if (split) jogo.splits = (jogo.splits || 0) + 1;
      jogo.ultimoSplit = split ? N.nomeSplit(resto) : null;
      const avisoPinos = () => hud.aviso(split ? t("Split {p}! {n} pinos", { p: jogo.ultimoSplit, n: novos }) : novos ? t("{n} pinos", { n: novos }) : t("Nenhum pino"), split ? 1500 : 1100);
      jogo.jogadas.push(novos);
      jogo.ultimo = novos;
      const q = jogo.quadro;
      let proximoQuadro = false, todos = false;
      if (q < 9) {
        if (jogo.bolaNoQuadro === 0 && novos === 10) { hud.aviso(t("STRIKE!"), 1800, "bom"); som("torcida"); proximoQuadro = true; }
        else if (jogo.bolaNoQuadro === 1) { const soma = jogo.jogadas[jogo.jogadas.length - 2] + novos; if (soma === 10) { hud.aviso(t("SPARE!"), 1600, "bom"); som("ponto"); } else avisoPinos(); proximoQuadro = true; }
        else avisoPinos();
      } else {
        const f = pontosBoliche(jogo.jogadas).quadros[9], ultima = f.marcas[f.marcas.length - 1];
        const d = decimoQuadro(f.bolas);
        if (ultima === "X") { hud.aviso(t("STRIKE!"), 1600, "bom"); som("torcida"); }
        else if (ultima === "/") { hud.aviso(t("SPARE!"), 1600, "bom"); som("ponto"); }
        else avisoPinos();
        if (d.acabou) { jogo.fase = "fim"; const r = desenharPlacar(); setTimeout(() => ctx.fim({ vitoria: r.total >= 100, titulo: t("{n} pontos", { n: r.total }), recorde: { valor: r.total, melhor: "maior", rotulo: t("{n} pontos", { n: r.total }) }, subtitulo: r.total >= 200 ? t("Jogo incrível!") : r.total >= 120 ? t("Belo jogo!") : t("Fim das 10 rodadas"), linhas: [t("Strikes: {n}", { n: r.quadros.reduce((a, f) => a + f.marcas.filter((m) => m === "X").length, 0) }), t("Spares: {n}", { n: r.quadros.reduce((a, f) => a + f.marcas.filter((m) => m === "/").length, 0) }), t("Splits: {n}", { n: jogo.splits || 0 })] }), 1600); return; }
        todos = d.novos;
        jogo.bolaNoQuadro++;
        arrumarPinos(todos);
        jogo.fase = "mirando";
        desenharPlacar();
        return;
      }
      if (proximoQuadro) { jogo.quadro++; jogo.bolaNoQuadro = 0; todos = true; } else jogo.bolaNoQuadro++;
      arrumarPinos(todos);
      jogo.fase = "mirando";
      desenharPlacar();
    }
    arrumarPinos(true);
    desenharPlacar();
    hud.aviso(t("Rodada 1"), 1200);
    return {
      dica: (modo) => dicaControles(modo,
        t("O mouse escolhe onde ficar na pista. Segure o clique (ou Espaço) para dar força e solte para jogar; puxar o mouse para o lado ao soltar dá efeito."),
        t("Incline o corpo (ou mova a mão) para escolher onde ficar. Faça o movimento de jogar a bola por baixo: a velocidade do braço é a força; terminar o braço para o lado dá efeito.")),
      atualizar(dt) {
        const passos = 6;
        if (jogo.fase === "mirando") {
          jogo.posX = limitar((entrada.modo === "camera" ? entrada.lado * 0.4 + entrada.mira.x * 0.25 : entrada.mira.x * 0.42), -0.42, 0.42);
          hud.barra(entrada.apertado ? entrada.carga : null, t("Força"));
          jogador.grupo.position.set(jogo.posX - 0.25, 0, 2.2);
          bolaG.position.set(jogo.posX, 0.42, 2.0);
          mira.visible = true; mira.position.set(jogo.posX, 0.02, -2);
        } else mira.visible = false;
        if (jogo.fase === "andando") {
          jogo.espera -= dt;
          jogador.grupo.position.z = lerp(0.3, 2.2, limitar(jogo.espera / 0.75));
          bolaG.position.set(jogo.posX, 0.42, jogador.grupo.position.z - 0.2);
          hud.barra(null);
          if (jogo.espera <= 0) soltarBola();
        }
        if (jogo.fase === "rolando" || jogo.fase === "pinos") {
          for (let i = 0; i < passos; i++) passoFisica(dt / passos);
          const b = jogo.b;
          bolaG.position.set(b.x, BOLICHE.raioBola - (b.canaleta ? 0.06 : 0), b.z);
          bolaG.rotation.x = b.giro;
          bolaG.visible = b.z > BOLICHE.fosso - 0.4;
          if (jogo.fase === "pinos") {
            jogo.espera -= dt;
            const parados = pinos.every((p) => p.fora || !p.g.visible || Math.hypot(p.vx, p.vz) < 0.03);
            if (jogo.espera <= 0 && parados) { jogo.bateu = false; contar(); }
          }
        }
        for (const p of pinos) {
          if (!p.g.visible) continue;
          if (p.caido) p.tomba = Math.min(Math.PI / 2, p.tomba + dt * 7);
          p.g.position.set(p.x, p.caido ? 0.04 : 0, p.z);
          p.g.quaternion.setFromAxisAngle(p.eixo, p.tomba);
          if (p.fora && p.z < BOLICHE.fosso - 0.3) p.g.visible = false;
        }
        jogador.atualizar(dt);
        const b = jogo.b, rolando = jogo.fase === "rolando" || jogo.fase === "pinos";
        if (rolando) {
          const z = Math.max(b.z + 3.2, BOLICHE.cabeca + 3.4);
          seguir(new T.Vector3(b.x * 0.5, 1.3, z), new T.Vector3(b.x * 0.3, 0.2, Math.min(b.z - 4, BOLICHE.cabeca)), dt, 3);
        } else seguir(new T.Vector3(jogo.posX * 0.5 + 0.75, 2.1, 5.4), new T.Vector3(jogo.posX * 0.3, 0.2, -12), dt, 3); // por cima do ombro direito
      },
      estado: () => ({ fase: jogo.fase, quadro: jogo.quadro + 1, bola: jogo.bolaNoQuadro + 1, jogadas: jogo.jogadas.slice(), total: pontosBoliche(jogo.jogadas).total, lancamentos: jogo.lancamentos, splits: jogo.splits || 0, ultimoSplit: jogo.ultimoSplit || null,
        emPe: pinos.filter((p) => !p.caido && !p.fora && p.g.visible).length, ultimo: jogo.ultimo }),
      /** Para os testes: joga uma bola na hora (forca 0 a 1, curva -1 a 1). */
      lancar,
    };
  }

  // ════════════════════════════ BEISEBOL ═══════════════════════════

  const ZONA = { x: 0.24, baixo: 0.5, alto: 1.15 };
  const ARREMESSOS = { rapida: { nome: "Rápida", vel: 27, quebra: 0, arco: 0.25 }, curva: { nome: "Curva", vel: 22, quebra: 0.7, arco: 0.5 }, lenta: { nome: "Lenta", vel: 17.5, quebra: -0.15, arco: 0.9 } };
  /**
   * O que acontece com uma rebatida. q: a qualidade do contato (0 a 1); atraso: o tempo do golpe (< 0 cedo, > 0 tarde,
   * em segundos); forca: 0 a 1; r: o sorteio. Devolve {tipo: falta|eliminado|simples|dupla|tripla|homerun, distancia,
   * angulo (graus, 0 = centro, < 0 = campo esquerdo), elevacao, velocidade}.
   */
  function rebatida(q, atraso, forca, r = Math.random) {
    const velocidade = 18 + 30 * q * (0.6 + 0.4 * forca);
    const elevacao = q > 0.75 ? lerp(12, 36, r()) : q > 0.4 ? lerp(-6, 50, r()) : lerp(-12, 70, r());
    const angulo = limitar(atraso / 0.11, -1.4, 1.4) * 46 + (r() - 0.5) * 16;
    const rad = (elevacao * Math.PI) / 180;
    const distancia = Math.max(2, (velocidade * velocidade * Math.sin(2 * Math.max(0.05, rad))) / G * 0.64);
    const voo = (2 * velocidade * Math.sin(Math.max(0.05, rad))) / G;
    const base = { distancia, angulo, elevacao, velocidade, voo };
    if (Math.abs(angulo) > 45) return { ...base, tipo: "falta" };
    if (distancia > 74 + Math.abs(angulo) * 0.25 && elevacao > 15) return { ...base, tipo: "homerun" };
    if (elevacao > 28 && voo > 2.2) return { ...base, tipo: r() < limitar(0.92 - (distancia - 55) / 60) ? "eliminado" : distancia > 66 ? "dupla" : "simples", alta: true };
    if (elevacao < 8) return { ...base, tipo: r() < limitar(0.85 - (velocidade - 28) / 30) ? "eliminado" : "simples", chao: true };
    if (distancia < 50) return { ...base, tipo: r() < 0.3 ? "eliminado" : "simples" };
    if (distancia < 64) return { ...base, tipo: r() < 0.2 ? "eliminado" : "dupla" };
    return { ...base, tipo: r() < 0.15 ? "eliminado" : distancia > 70 ? "tripla" : "dupla" };
  }

  function criarBeisebol(ctx) {
    const { T, cena, camera, entrada, hud, som } = ctx;
    const entradas = +ctx.opcoes.entradas || 3;
    ctx.ceu({ cima: "#3d8fff", baixo: "#dff3ff", perto: 90, longe: 260 });
    ctx.luzes({ raio: 50, centro: [0, 0, -30], de: [20, 40, 18] });
    // o campo: a grama (com faixas), o diamante de terra, as linhas, as bases, o montinho e o muro
    const grama = (() => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 512;
      const g = c.getContext("2d");
      for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#4fae3f" : "#5bbd49"; g.fillRect(0, i * 32, 512, 32); }
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(6, 6); return tex;
    })();
    const chao = ctx.malha(new T.CircleGeometry(130, 48), ctx.mat("#ffffff", { mapa: grama }), { sombra: false });
    chao.rotation.x = -Math.PI / 2; cena.add(chao);
    const terra = "#c98d55";
    const diamante = ctx.malha(new T.PlaneGeometry(30, 30), terra, { sombra: false });
    diamante.rotation.set(-Math.PI / 2, 0, Math.PI / 4); diamante.position.set(0, 0.01, -19.4); cena.add(diamante);
    const gramaDentro = ctx.malha(new T.PlaneGeometry(22, 22), "#5bbd49", { sombra: false });
    gramaDentro.rotation.set(-Math.PI / 2, 0, Math.PI / 4); gramaDentro.position.set(0, 0.015, -19.4); cena.add(gramaDentro);
    const montinho = ctx.malha(new T.CylinderGeometry(2.6, 2.9, 0.25, 24), terra); montinho.position.set(0, 0.12, -18.44); cena.add(montinho);
    const circulo = ctx.malha(new T.CircleGeometry(4, 24), terra, { sombra: false }); circulo.rotation.x = -Math.PI / 2; circulo.position.set(0, 0.02, 0); cena.add(circulo);
    const branco = ctx.mat("#ffffff");
    for (const s of [-1, 1]) { const l = new T.Mesh(new T.BoxGeometry(0.1, 0.01, 100), branco); l.position.set(s * 35.4, 0.03, -35.4); l.rotation.y = s * Math.PI / 4; cena.add(l); }
    const bases = [[19.4, -19.4], [0, -38.8], [-19.4, -19.4]];
    for (const [x, z] of bases) { const bs = ctx.malha(new T.BoxGeometry(0.4, 0.08, 0.4), "#ffffff"); bs.position.set(x, 0.04, z); bs.rotation.y = Math.PI / 4; cena.add(bs); }
    const placa = ctx.malha(new T.CylinderGeometry(0.3, 0.3, 0.03, 5), "#ffffff"); placa.position.set(0, 0.03, 0); cena.add(placa);
    const muroGeo = new T.CylinderGeometry(80, 80, 3, 48, 1, true, -Math.PI * 0.27, Math.PI * 0.54);
    const muro = ctx.malha(muroGeo, ctx.mat("#1f6e4a", {}), { sombra: false }); muro.material.side = T.DoubleSide; muro.position.set(0, 1.5, 0); muro.rotation.y = Math.PI; cena.add(muro);
    const torcidas = [];
    for (let i = -2; i <= 2; i++) { const a = i * 0.22; torcidas.push(ctx.arquibancada({ largura: 30, filas: 7, x: Math.sin(a) * 92, z: -Math.cos(a) * 92, giro: -a, semente: 11 + i })); }
    torcidas.push(ctx.arquibancada({ largura: 30, filas: 6, x: -30, z: 14, giro: Math.PI * 0.75, semente: 21 }), ctx.arquibancada({ largura: 30, filas: 6, x: 30, z: 14, giro: -Math.PI * 0.75, semente: 23 }));
    const telao = ctx.malha(new T.BoxGeometry(18, 7, 0.6), "#1d2233"); telao.position.set(0, 11, -104); cena.add(telao);
    for (let i = 0; i < 18; i++) ctx.arvore(lerp(-110, 110, i / 17), -118 - (i % 3) * 5, 2);
    // as pessoas: o arremessador, o rebatedor, o receptor e os defensores
    const voceCor = ctx.cor, cpuCor = "#d9443b";
    const taco = () => { const g = new T.Group(); const m = ctx.malha(new T.CylinderGeometry(0.035, 0.018, 0.86, 10), "#c08a50"); m.position.y = -0.4; g.add(m); return g; };
    const arremessador = ctx.boneco({ cor: cpuCor }); arremessador.grupo.position.set(0, 0.25, -18.44);
    const rebatedor = ctx.boneco({ cor: voceCor }); rebatedor.grupo.position.set(-0.75, 0, 0.1); rebatedor.grupo.rotation.y = -Math.PI / 2;
    const tacoM = rebatedor.segurar(taco());
    const receptor = ctx.boneco({ cor: cpuCor }); receptor.grupo.position.set(0, 0, 1.4); receptor.grupo.rotation.y = Math.PI; receptor.alto = -0.35;
    const POSICOES = [[19, -27], [10, -34], [-10, -34], [-19, -27], [-30, -62], [0, -70], [30, -62]];
    const defensores = POSICOES.map(([x, z]) => { const d = ctx.boneco({ cor: cpuCor }); d.grupo.position.set(x, 0, z); d.casa = [x, z]; return d; });
    const corredores = [0, 1, 2].map(() => { const c = ctx.boneco({ cor: voceCor, escala: 0.95 }); c.grupo.visible = false; return c; });
    const bola = ctx.malha(new T.SphereGeometry(0.06, 12, 10), "#fbfbf3");
    cena.add(bola);
    const zona = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(ZONA.x * 2, ZONA.alto - ZONA.baixo)), new T.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 }));
    zona.position.set(0, (ZONA.alto + ZONA.baixo) / 2, 0.05); cena.add(zona);
    const alvo = new T.Mesh(new T.RingGeometry(0.05, 0.075, 18), new T.MeshBasicMaterial({ color: "#ffd23f" }));
    alvo.position.set(0, 0.85, 0.06); cena.add(alvo);
    const seguir = seguidor(camera, T);

    const p = { entrada: 1, topo: true, corridas: [0, 0], fora: 0, bolas: 0, strikes: 0, bases: [false, false, false], fase: "pronto", espera: 1.6, tipo: "rapida",
      arremesso: null, voo: null, mensagem: "", fim: false, rebatidas: 0, porEntrada: [[], []], eliminadosPorStrike: 0, arremessos: 0, golpes: 0 };
    const rebatendo = () => p.topo; // em cima (▲) você rebate; embaixo (▼) você arremessa
    function trocarUniformes() { // o peito e os braços têm a cor do time: quem rebate e quem defende trocam a cada metade
      const ataque = rebatendo() ? voceCor : cpuCor, defesa = rebatendo() ? cpuCor : voceCor;
      for (const b of [arremessador, receptor, ...defensores]) b.grupo.traverse((o) => { if (o.userData.uniforme) o.material.color.set(defesa); });
      for (const b of [rebatedor, ...corredores]) b.grupo.traverse((o) => { if (o.userData.uniforme) o.material.color.set(ataque); });
    }
    function desenharPlacar() {
      const bases = p.bases.map((b) => (b ? "◆" : "◇")).join("");
      hud.placar([el("span", { class: "mj-chip" }, t("Entrada {n}", { n: p.entrada }) + (p.topo ? " ▲" : " ▼")),
        el("span", { class: "mj-chip forte", "data-corridas": p.corridas.join("-") }, t("Você {a} × {b} CPU", { a: p.corridas[0], b: p.corridas[1] })),
        el("span", { class: "mj-chip" }, t("B{b} S{s} · {o} fora", { b: p.bolas, s: p.strikes, o: p.fora })),
        el("span", { class: "mj-chip mj-bases", title: t("Bases") }, bases),
        rebatendo() ? null : el("span", { class: "mj-chip" }, t("Arremesso: {tipo}", { tipo: t(ARREMESSOS[p.tipo].nome) }))]);
    }
    function anotar(n) {
      const lado = rebatendo() ? 0 : 1;
      p.corridas[lado] += n;
      p.porEntrada[lado][p.entrada - 1] = (p.porEntrada[lado][p.entrada - 1] || 0) + n;
      if (n > 0) { som(lado === 0 ? "torcida" : "erro"); if (lado === 0) torcidas.forEach((tc) => tc.comemorar()); }
    }
    /** Os corredores andam "n" bases (forcado: só quem é empurrado, como na base por bolas). Devolve as corridas. */
    function avancar(n, forcado = false) {
      let corridas = 0;
      if (forcado) {
        if (p.bases[0] && p.bases[1] && p.bases[2]) corridas++;
        if (p.bases[0] && p.bases[1]) p.bases[2] = true;
        if (p.bases[0]) p.bases[1] = true;
        p.bases[0] = true;
        return corridas;
      }
      const novas = [false, false, false];
      for (let i = 2; i >= 0; i--) if (p.bases[i]) { const d = i + n; if (d >= 3) corridas++; else novas[d] = true; }
      if (n >= 4) corridas++; else novas[n - 1] = true;
      p.bases = novas;
      return corridas;
    }
    function proximoRebatedor() { p.bolas = 0; p.strikes = 0; p.fase = "pronto"; p.espera = 1.5; }
    /** O time da casa passou à frente no fim da última entrada (ou numa extra): o jogo acaba na hora (walk-off). */
    function viradaFinal() {
      if (p.topo || p.entrada < entradas || p.corridas[1] <= p.corridas[0]) return false;
      desenharPlacar(); fimDeJogo(); return true;
    }
    function eliminado(texto) {
      p.fora++;
      hud.aviso(texto, 1500, rebatendo() ? "ruim" : "bom");
      if (p.fora >= 3) return trocarLado();
      proximoRebatedor();
    }
    function fimDeJogo() {
      p.fim = true; p.fase = "fim";
      const [a, b] = p.corridas, venceu = a > b;
      const tabela = el("table", { class: "mj-tabela" },
        el("tr", {}, el("th", {}, ""), ...Array.from({ length: p.entrada }, (_, i) => el("th", {}, String(i + 1))), el("th", {}, "R")),
        ...[[t("Você"), 0], [t("CPU"), 1]].map(([n, k]) => el("tr", {}, el("th", {}, n), ...Array.from({ length: p.entrada }, (_, i) => el("td", {}, p.porEntrada[k][i] === undefined ? (k === 1 && i === p.entrada - 1 && !p.jogouUltima ? "x" : "0") : String(p.porEntrada[k][i]))), el("td", {}, String(p.corridas[k])))));
      setTimeout(() => ctx.fim({ vitoria: venceu, empate: a === b, forcaCPU: ctx.forcaCPU, recorde: { valor: a, melhor: "maior", rotulo: t("{n} corridas", { n: a }) },
        titulo: a === b ? t("Empate") : venceu ? t("Você venceu!") : t("O CPU venceu"), subtitulo: t("Você {a} × {b} CPU", { a, b }), tabela,
        linhas: [t("Rebatidas válidas: {n}", { n: p.rebatidas }), t("Eliminações por strike: {n}", { n: p.eliminadosPorStrike }), t("Queimadas duplas: {n}", { n: p.duplas || 0 })] }), 1500);
    }
    function trocarLado() {
      p.fora = 0; p.bases = [false, false, false];
      const ultima = p.entrada >= entradas;
      if (p.topo) {
        if (ultima && p.corridas[1] > p.corridas[0]) return fimDeJogo(); // o CPU já ganhou: a última metade nem é jogada
        p.topo = false; hud.aviso(t("Agora você arremessa"), 1800);
      } else {
        p.jogouUltima = true;
        if (ultima && p.corridas[0] !== p.corridas[1]) return fimDeJogo();
        if (p.entrada >= entradas + 3) return fimDeJogo(); // muitas entradas extras: fica no empate
        p.entrada++; p.topo = true; p.jogouUltima = false;
        hud.aviso(p.entrada > entradas ? t("Entrada extra!") : t("Entrada {n}: você rebate", { n: p.entrada }), 1800);
      }
      trocarUniformes();
      proximoRebatedor();
      p.espera = 2.2;
      desenharPlacar();
    }
    /** O CPU (ou você) solta o arremesso: tipo, o alvo na placa (x, y) e o fator de velocidade. */
    function arremessar(tipo, x, y, fator = 1) {
      const a = ARREMESSOS[tipo];
      const de = new T.Vector3(0.25, 1.85, -17.6), para = new T.Vector3(x, y, 0);
      const tempo = de.distanceTo(para) / (a.vel * fator);
      p.arremesso = { tipo, de, para, tempo, t: 0, a, x, y, naZona: Math.abs(x) <= ZONA.x + 0.04 && y >= ZONA.baixo - 0.04 && y <= ZONA.alto + 0.04, golpe: null, decidiu: false };
      p.fase = "arremesso";
      p.arremessos++;
      arremessador.animar([{ t: 0, pose: { ombroD: [-2.8, 0, -0.3], tronco: [-0.2, 0.4, 0] } }, { t: 0.6, pose: { ombroD: [-2.6, 0, -0.3], tronco: [0.3, -0.3, 0] } }, { t: 1, pose: { ombroD: [-0.6, 0, -0.2], tronco: [0.5, -0.5, 0] } }], 0.35);
      som("bola");
    }
    const posArremesso = (a, tt) => {
      const u = limitar(tt / a.tempo, 0, 1.4), pos = a.de.clone().lerp(a.para, u);
      pos.y += Math.sin(Math.PI * Math.min(1, u)) * a.a.arco;
      pos.x += a.a.quebra * u * (1 - u) * -1.6 * (u <= 1 ? 1 : 0);
      if (u > 1) { pos.z = (u - 1) * a.tempo * a.a.vel; pos.y = a.para.y - (u - 1) * 2; }
      return pos;
    };
    function balancoTaco() {
      rebatedor.animar([{ t: 0, pose: { tronco: [0, 0.7, 0], ombroD: [-1.2, 0, -0.9], ombroE: [-1.2, 0, 0.6] } }, { t: 0.4, pose: { tronco: [0, -0.4, 0], ombroD: [-1.4, 0, -0.2], ombroE: [-1.3, 0, 0.2] } }, { t: 1, pose: { tronco: [0, -1.2, 0], ombroD: [-1.1, 0, 0.6], ombroE: [-1.0, 0, 0.9] } }], 0.32);
    }
    function golpe(forcaCamera = null) {
      if (!rebatendo() || p.fase !== "arremesso" || !p.arremesso || p.arremesso.golpe) { if (rebatendo() && !rebatedor.animando && p.fase !== "voo") balancoTaco(); return; }
      balancoTaco();
      p.golpes++;
      const a = p.arremesso, contato = a.tempo * 0.97; // o melhor momento: a bola chegando na frente da placa
      const atraso = a.t + 0.1 - contato; // o taco leva ~0,1 s para chegar
      a.golpe = { atraso, forca: forcaCamera ?? 0.75 };
    }
    entrada.on("toque", () => { if (rebatendo()) golpe(); });
    entrada.on("golpe", (g) => { if (rebatendo()) golpe(g.forca); else arremessoHumano(g.forca); });
    entrada.on("solta", (s) => { if (!rebatendo()) arremessoHumano(s.forca); });
    entrada.on("tecla", ({ codigo }) => {
      if (rebatendo()) return;
      const lista = Object.keys(ARREMESSOS), i = lista.indexOf(p.tipo);
      if (codigo === "KeyQ") p.tipo = lista[(i + lista.length - 1) % lista.length];
      else if (codigo === "KeyE") p.tipo = lista[(i + 1) % lista.length];
      else if (codigo === "Digit1") p.tipo = "rapida"; else if (codigo === "Digit2") p.tipo = "curva"; else if (codigo === "Digit3") p.tipo = "lenta";
      else return;
      desenharPlacar();
    });
    function alvoHumano() { return { x: limitar(entrada.mira.x * 0.55, -0.55, 0.55), y: limitar(0.83 + entrada.mira.y * 0.6, 0.2, 1.5) }; }
    function arremessoHumano(forca) {
      if (rebatendo() || p.fase !== "mirando") return;
      const a = alvoHumano(), erro = 0.05 + (1 - limitar(forca)) * 0.04;
      arremessar(p.tipo, a.x + (Math.random() - 0.5) * erro, a.y + (Math.random() - 0.5) * erro, lerp(0.85, 1.12, limitar(forca)));
    }
    /** Decide o fim de um arremesso: rebatida, strike ou bola. */
    function resolver() {
      const a = p.arremesso;
      let g = a.golpe;
      if (!rebatendo() && !a.decidiu) { // o CPU rebate (ou não)
        a.decidiu = true;
        const prec = ctx.ia ? ctx.ia.precisao : 0.6; // o rebatedor melhor escolhe melhor
        const quer = Math.random() < (a.naZona ? 0.6 + 0.25 * prec : 0.42 - 0.25 * prec);
        if (quer) {
          const dificil = (a.a.vel * (a.tempo ? a.de.distanceTo(a.para) / a.tempo / a.a.vel : 1) - 17) / 12;
          const sigma = (0.035 + limitar(dificil) * 0.045 + Math.abs(a.a.quebra) * 0.02) * (1.5 - (ctx.ia ? ctx.ia.precisao : 0.6));
          g = { atraso: (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 2.2, forca: lerp(0.5, 0.95, Math.random()) };
          balancoTaco();
        }
      }
      if (g) {
        const erro = Math.abs(g.atraso);
        let q = erro < 0.03 ? 1 : erro < 0.07 ? lerp(0.85, 0.55, (erro - 0.03) / 0.04) : erro < 0.12 ? lerp(0.45, 0.15, (erro - 0.07) / 0.05) : 0;
        if (!a.naZona) q *= 0.6;
        if (q <= 0.05) return strike(true);
        const r = rebatida(q, g.atraso, g.forca);
        return iniciarVoo(r);
      }
      if (a.naZona) return strike(false);
      p.bolas++;
      hud.aviso(t("Bola {n}", { n: p.bolas }), 900);
      if (p.bolas >= 4) { const c = avancar(1, true); anotar(c); hud.aviso(t("Base por bolas"), 1400, rebatendo() ? "bom" : "ruim"); if (viradaFinal()) return; proximoRebatedor(); }
      else { p.fase = "pronto"; p.espera = 1.1; }
      desenharPlacar();
    }
    function strike(balancou) {
      p.strikes++;
      som(balancou ? "erro" : "apito");
      if (p.strikes >= 3) { p.eliminadosPorStrike += rebatendo() ? 0 : 1; eliminado(t("Strike 3! Eliminado")); }
      else { hud.aviso(balancou ? t("Errou! Strike {n}", { n: p.strikes }) : t("Strike {n}", { n: p.strikes }), 1000, rebatendo() ? "ruim" : "bom"); p.fase = "pronto"; p.espera = 1.1; }
      desenharPlacar();
    }
    function iniciarVoo(r) {
      som("rebatida");
      const ang = (r.angulo * Math.PI) / 180, ele = (r.elevacao * Math.PI) / 180;
      const dir = new T.Vector3(Math.sin(ang), 0, -Math.cos(ang));
      const v = r.velocidade * 0.8;
      p.voo = { r, pos: new T.Vector3(0.2, 1.0, -0.6), vel: new T.Vector3(dir.x * v * Math.cos(ele), v * Math.sin(Math.max(-0.1, ele)), dir.z * v * Math.cos(ele)), t: 0, alcance: r.distancia, dir, quique: 0 };
      p.fase = "voo"; p.espera = 3.4;
    }
    function fimDoVoo() {
      const r = p.voo.r;
      p.voo = null;
      if (r.tipo === "falta") {
        if (p.strikes < 2) p.strikes++;
        hud.aviso(t("Bola fora (falta)"), 1100);
        p.fase = "pronto"; p.espera = 1.2; desenharPlacar();
        return;
      }
      if (r.tipo === "eliminado") {
        // queimada dupla ou voo de sacrifício (js/esportes-nucleo.js)
        const N = C.esportesNucleo, e = N ? N.eliminacao({ bases: p.bases, fora: p.fora, alta: !!r.alta, distancia: r.distancia || 0, defesa: rebatendo() ? (ctx.ia ? ctx.ia.precisao : 0.5) : 0.5 }) : { tipo: "simples" };
        if (e.tipo === "dupla") { p.bases = e.bases; p.fora++; p.duplas = (p.duplas || 0) + 1; eliminado(t("Queimada dupla!")); desenharPlacar(); return; }
        if (e.tipo === "sacrificio") { p.bases = e.bases; anotar(1); if (viradaFinal()) return; eliminado(t("Voo de sacrifício: +1 corrida")); desenharPlacar(); return; }
        eliminado(r.alta ? t("Pegou no ar! Eliminado") : t("Eliminado na base")); desenharPlacar(); return;
      }
      const bases = { simples: 1, dupla: 2, tripla: 3, homerun: 4 }[r.tipo];
      const c = avancar(bases);
      anotar(c);
      if (rebatendo()) p.rebatidas++;
      hud.aviso({ simples: t("Simples!"), dupla: t("Dupla!"), tripla: t("Tripla!"), homerun: t("HOME RUN!") }[r.tipo] + (c ? " " + t("+{n} corrida(s)", { n: c }) : ""), 1800, rebatendo() ? "bom" : "ruim");
      // o time da casa vira o jogo na última entrada: acaba na hora
      if (viradaFinal()) return;
      proximoRebatedor();
      desenharPlacar();
    }
    trocarUniformes();
    desenharPlacar();
    hud.aviso(t("Entrada 1: você rebate"), 1800);
    return {
      dica: (modo) => (rebatendo()
        ? dicaControles(modo, t("Rebata: clique (ou Espaço) quando a bola chegar. Cedo manda para a esquerda, tarde para a direita."), t("Rebata: gire os braços quando a bola chegar; mais rápido = mais forte."))
        : dicaControles(modo, t("Arremesse: o mouse mira na zona; Q/E (ou 1, 2, 3) trocam o arremesso; segure e solte o clique para jogar."), t("Arremesse: a mão mira na zona; faça o movimento de arremessar (a velocidade do braço é a força). Q/E trocam o arremesso."))),
      atualizar(dt) {
        const pausa = p.fase === "pronto" || p.fase === "mirando";
        if (p.fase === "pronto") {
          p.espera -= dt;
          if (p.espera <= 0) {
            if (rebatendo()) {
              const tipos = ["rapida", "rapida", "curva", "lenta"], tipo = tipos[Math.floor(Math.random() * tipos.length)];
              const naZona = Math.random() < 0.55 + 0.2 * (ctx.ia ? ctx.ia.precisao : 0.6);
              const x = naZona ? lerp(-ZONA.x, ZONA.x, Math.random()) : (Math.random() < 0.5 ? -1 : 1) * lerp(ZONA.x + 0.08, ZONA.x + 0.3, Math.random());
              const y = naZona ? lerp(ZONA.baixo, ZONA.alto, Math.random()) : Math.random() < 0.5 ? lerp(0.2, ZONA.baixo - 0.06, Math.random()) : lerp(ZONA.alto + 0.06, 1.45, Math.random());
              arremessar(tipo, x, y);
            } else { p.fase = "mirando"; hud.dica(this.dica(entrada.modo)); }
          }
        }
        if (p.fase === "mirando") {
          const a = alvoHumano();
          alvo.position.set(a.x, a.y, 0.06);
          hud.barra(entrada.apertado ? entrada.carga : null, t("Força"));
        } else if (!rebatendo()) hud.barra(null);
        alvo.visible = p.fase === "mirando";
        if (p.fase === "arremesso") {
          const a = p.arremesso;
          a.t += dt;
          bola.position.copy(posArremesso(a, a.t));
          if (a.golpe && Math.abs(a.t - a.tempo * 0.97) < 0.02 + dt) resolver();
          else if (a.t >= a.tempo * 1.05 && p.fase === "arremesso") resolver();
        } else if (p.fase === "voo" && p.voo) {
          const v = p.voo;
          v.t += dt;
          v.vel.y -= G * dt * 0.62;
          v.pos.addScaledVector(v.vel, dt * 1.25);
          if (v.pos.y < 0.06) { v.pos.y = 0.06; if (v.vel.y < 0) { v.vel.y *= -0.35; v.vel.x *= 0.6; v.vel.z *= 0.6; v.quique++; } }
          if (v.r.tipo === "homerun" && v.pos.length() > 80) v.vel.multiplyScalar(0.97);
          bola.position.copy(v.pos);
          // o defensor mais perto corre para a bola
          let perto = null, dm = 1e9;
          for (const d of defensores) { const dd = Math.hypot(d.grupo.position.x - v.pos.x, d.grupo.position.z - v.pos.z); if (dd < dm) { dm = dd; perto = d; } }
          if (perto && v.r.tipo !== "homerun") { const dx = v.pos.x - perto.grupo.position.x, dz = v.pos.z - perto.grupo.position.z, d = Math.hypot(dx, dz); if (d > 0.5) { perto.grupo.position.x += (dx / d) * 7 * dt; perto.grupo.position.z += (dz / d) * 7 * dt; perto.andando = 1; perto.grupo.rotation.y = Math.atan2(dx, dz); } }
          p.espera -= dt;
          if (p.espera <= 0 || (v.quique >= 3) || (v.r.tipo === "falta" && v.t > 1.6)) { for (const d of defensores) { d.grupo.position.set(d.casa[0], 0, d.casa[1]); d.andando = 0; d.grupo.rotation.y = 0; } fimDoVoo(); }
        } else if (pausa) bola.position.set(0.25, 1.75, -17.7);
        // os corredores nas bases
        corredores.forEach((c, i) => { c.grupo.visible = p.bases[i]; if (p.bases[i]) c.grupo.position.set(bases[i][0] + 0.8, 0, bases[i][1]); c.atualizar(dt); });
        for (const b of [arremessador, rebatedor, receptor, ...defensores]) b.atualizar(dt);
        for (const tc of torcidas) tc.atualizar(dt);
        tacoM.visible = true;
        if (p.fase === "voo" && p.voo) seguir(new T.Vector3(p.voo.pos.x * 0.55, 6 + p.voo.pos.y * 0.3, p.voo.pos.z * 0.55 + 12), p.voo.pos, dt, 2.5);
        else if (rebatendo()) seguir(new T.Vector3(0.35, 1.9, 4.2), new T.Vector3(0, 1.1, -16), dt, 3);
        else seguir(new T.Vector3(0.6, 2.6, -22.8), new T.Vector3(0, 0.9, 0), dt, 3);
        receptor.grupo.visible = !(rebatendo() && p.fase !== "voo"); // rebatendo, a câmera fica atrás dele
        zona.visible = p.fase !== "voo";
      },
      estado: () => ({ fase: p.fase, entrada: p.entrada, topo: p.topo, corridas: p.corridas.slice(), fora: p.fora, bolas: p.bolas, strikes: p.strikes, bases: p.bases.slice(), tipo: p.tipo, arremessos: p.arremessos, golpes: p.golpes, fim: p.fim, duplas: p.duplas || 0 }),
      /** Para os testes: pula a metade da entrada (como 3 eliminações). */
      trocarLado,
    };
  }

  // ═════════════════════════════ GOLFE ═════════════════════════════

  const TACOS = [{ nome: "Driver", max: 230, loft: 11, rola: 0.34 }, { nome: "Madeira 3", max: 205, loft: 15, rola: 0.3 }, { nome: "Ferro 5", max: 168, loft: 24, rola: 0.22 },
    { nome: "Ferro 7", max: 142, loft: 32, rola: 0.17 }, { nome: "Ferro 9", max: 116, loft: 42, rola: 0.12 }, { nome: "Wedge", max: 86, loft: 52, rola: 0.07 }, { nome: "Putter", max: 25, loft: 0, rola: 1 }];
  const PUTTER = TACOS.length - 1;
  const PARES = [4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
  const ATRITO = { green: 0.9, fairway: 2.4, tee: 2.4, rough: 6.5, areia: 15 };
  const SAIDA = { green: 1, fairway: 1, tee: 1, rough: 0.82, areia: 0.55 };
  const NOMES_RESULTADO = { "-3": "Albatroz!", "-2": "Eagle!", "-1": "Birdie!", 0: "Par", 1: "Bogey", 2: "Bogey duplo" };

  /** Sorteia um buraco (o mesmo para a mesma semente): o caminho do fairway, o green, a areia, a água e a caída do green. */
  function buracoDe(n, semente, total) {
    const r = aleatorio(semente * 131 + n * 977 + 17);
    const par = total === 3 ? [4, 3, 5][n] : PARES[n % PARES.length];
    const comprimento = par === 3 ? r.entre(115, 165) : par === 4 ? r.entre(265, 345) : r.entre(410, 470);
    const curva = par === 3 ? r.entre(-8, 8) : r.entre(-1, 1) * comprimento * 0.2;
    const p0 = { x: 0, z: 0 }, p1 = { x: curva, z: -comprimento * 0.5 }, p2 = { x: curva * r.entre(0.2, 1.3), z: -comprimento * 0.97 };
    const pontos = [];
    for (let i = 0; i <= 48; i++) { const s = i / 48, a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s; pontos.push({ x: a * p0.x + b * p1.x + c * p2.x, z: a * p0.z + b * p1.z + c * p2.z, s }); }
    const raioGreen = r.entre(11, 15);
    const green = { x: p2.x, z: p2.z, r: raioGreen };
    const ang = r() * Math.PI * 2, dist = r.entre(0, raioGreen * 0.55);
    const copo = { x: green.x + Math.cos(ang) * dist, z: green.z + Math.sin(ang) * dist };
    const largura = r.entre(13, 17), inicioFairway = par === 3 ? 0.6 : 0.1;
    const areias = [], aguas = [];
    const ultimo = pontos[pontos.length - 2], dirFim = Math.atan2(p2.x - ultimo.x, p2.z - ultimo.z);
    for (let k = 0; k < r.inteiro(1, 2); k++) {
      const a = dirFim + Math.PI + (k ? -1 : 1) * r.entre(0.6, 1.5);
      areias.push({ x: green.x + Math.sin(a) * (raioGreen + 4.5), z: green.z + Math.cos(a) * (raioGreen + 4.5), rx: r.entre(4, 6), rz: r.entre(2.6, 3.8), giro: a });
    }
    if (par > 3) {
      const alvo = r.entre(205, 235), i = pontos.findIndex((pt) => Math.hypot(pt.x, pt.z) > alvo);
      if (i > 0) { const pt = pontos[i], q = pontos[i - 1], nx = -(pt.z - q.z), nz = pt.x - q.x, nl = Math.hypot(nx, nz) || 1, lado = r() < 0.5 ? -1 : 1;
        areias.push({ x: pt.x + (nx / nl) * lado * (largura + 1), z: pt.z + (nz / nl) * lado * (largura + 1), rx: r.entre(6, 9), rz: r.entre(3, 4.5), giro: Math.atan2(nx, nz) }); }
    }
    if (r() < (par === 3 ? 0.5 : 0.4)) {
      const s = par === 3 ? r.entre(0.35, 0.55) : r.entre(0.38, 0.6), pt = pontos[Math.round(s * 48)];
      const agua = { x: pt.x + r.entre(-0.5, 0.5) * largura, z: pt.z, rx: r.entre(10, 16), rz: r.entre(5, 8), giro: r.entre(-0.4, 0.4) };
      if (Math.hypot(agua.x - green.x, agua.z - green.z) > raioGreen + agua.rx + 4 && Math.hypot(agua.x, agua.z) > 40) aguas.push(agua);
    }
    const inclinacao = { x: r.entre(-1, 1) * 0.2, z: r.entre(-1, 1) * 0.2 };
    return { n, par, comprimento, pontos, green, copo, largura, inicioFairway, areias, aguas, inclinacao };
  }
  const naElipse = (e, x, z) => { const dx = x - e.x, dz = z - e.z, c = Math.cos(e.giro), s = Math.sin(e.giro); const u = dx * c - dz * s, v = dx * s + dz * c; return (u * u) / (e.rx * e.rx) + (v * v) / (e.rz * e.rz) <= 1; };
  /** O ponto do caminho mais perto de (x, z): a distância e onde (0 = tee, 1 = green). */
  function pertoDoCaminho(h, x, z) {
    let melhor = { d: 1e9, s: 0 };
    const p = h.pontos;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
      const k = limitar(((x - a.x) * vx + (z - a.z) * vz) / l2);
      const d = Math.hypot(x - (a.x + vx * k), z - (a.z + vz * k));
      if (d < melhor.d) melhor = { d, s: a.s + (b.s - a.s) * k, k };
    }
    if (melhor.s <= 0 && z > 0) melhor.s = -z / 100;
    return melhor;
  }
  /** Onde a bola está: green, fairway, tee, rough, areia, agua ou fora. */
  function superficie(h, x, z) {
    for (const a of h.aguas) if (naElipse(a, x, z)) return "agua";
    for (const a of h.areias) if (naElipse(a, x, z)) return "areia";
    if (Math.hypot(x - h.green.x, z - h.green.z) < h.green.r) return "green";
    if (Math.abs(x) < 3.2 && Math.abs(z) < 2.4) return "tee";
    const p = pertoDoCaminho(h, x, z);
    if (p.d > h.largura + 48 || p.s < -0.12 || Math.hypot(x - h.green.x, z - h.green.z) > 75 && p.s > 0.99) return "fora";
    if (p.d < h.largura && p.s >= h.inicioFairway && p.s <= 0.985) return "fairway";
    return "rough";
  }

  function criarGolfe(ctx) {
    const { T, cena, camera, entrada, hud, som } = ctx;
    const total = +ctx.opcoes.buracos || 3, semente = ctx.opcoes.semente || Math.floor(Math.random() * 1e6);
    ctx.ceu({ cima: "#48a6ff", baixo: "#e3f5ff", perto: 120, longe: 520 });
    const { sol } = ctx.luzes({ raio: 26, de: [16, 30, 10] });
    const chao = ctx.malha(new T.PlaneGeometry(1600, 1600), "#4f9b3c", { sombra: false });
    chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; cena.add(chao);
    const r0 = aleatorio(semente);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, d = r0.entre(380, 520), m = ctx.malha(new T.SphereGeometry(r0.entre(60, 120), 18, 12), i % 2 ? "#5aa848" : "#4a9640", { sombra: false }); m.position.set(Math.cos(a) * d, -30, Math.sin(a) * d - 200); m.scale.y = 0.6; cena.add(m); }
    const bola = ctx.malha(new T.SphereGeometry(0.07, 14, 10), "#ffffff");
    cena.add(bola);
    const marcador = new T.Mesh(new T.ConeGeometry(0.25, 0.5, 4), new T.MeshBasicMaterial({ color: "#ffe14d" }));
    marcador.rotation.x = Math.PI; cena.add(marcador);
    const golfista = ctx.boneco({ cor: ctx.cor, calca: "#e8e2cf" });
    const taco = new T.Group(); { const haste = ctx.malha(new T.CylinderGeometry(0.012, 0.012, 1.0, 6), "#c9ced8"); haste.position.y = -0.5; const cabeca = ctx.malha(new T.BoxGeometry(0.1, 0.05, 0.05), "#30343c"); cabeca.position.set(0.03, -1.0, 0); taco.add(haste, cabeca); }
    golfista.segurar(taco);
    const linhaMira = new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: 40 }, () => new T.Vector3())), new T.LineDashedMaterial({ color: "#ffffff", dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.85 }));
    linhaMira.frustumCulled = false;
    const anel = new T.Mesh(new T.RingGeometry(1.4, 1.9, 24), new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 }));
    anel.rotation.x = -Math.PI / 2;
    cena.add(linhaMira, anel);
    const seguir = seguidor(camera, T);
    let grupoBuraco = null, bandeira = null, h = null;
    const est = { buraco: 0, tacadas: 0, cartao: [], fase: "mirando", taco: 0, ajuste: 0, x: 0, z: 0, y: 0, vel: new T.Vector3(), anterior: { x: 0, z: 0 }, vento: { x: 0, z: 0 }, espera: 0, curva: 0, mira: 0, totalTacadas: 0 };

    function construirBuraco() {
      if (grupoBuraco) { grupoBuraco.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); }); cena.remove(grupoBuraco); }
      h = buracoDe(est.buraco, semente, total);
      const g = (grupoBuraco = new T.Group());
      cena.add(g);
      // o fairway: uma faixa com listras ao longo do caminho
      const pos = [], cores = [], c1 = new T.Color("#7fd35f"), c2 = new T.Color("#74c956");
      const p = h.pontos.filter((pt) => pt.s >= h.inicioFairway - 0.02 && pt.s <= 0.99);
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * h.largura, nz = dx / l * h.largura;
        const q = [[a.x + nx, a.z + nz], [a.x - nx, a.z - nz], [b.x + nx, b.z + nz], [b.x - nx, b.z - nz]];
        for (const k of [0, 1, 2, 2, 1, 3]) { pos.push(q[k][0], 0.02, q[k][1]); const c = i % 2 ? c1 : c2; cores.push(c.r, c.g, c.b); }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new T.Float32BufferAttribute(cores, 3));
      geo.computeVertexNormals();
      const fairway = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }));
      fairway.receiveShadow = true; g.add(fairway);
      for (const pt of [p[0], p[p.length - 1]]) { const ponta = ctx.malha(new T.CircleGeometry(h.largura, 24), "#79cf5b", { sombra: false }); ponta.rotation.x = -Math.PI / 2; ponta.position.set(pt.x, 0.019, pt.z); g.add(ponta); }
      const disco = (x, z, rx, rz, giro, cor, y, op = {}) => { const m = ctx.malha(new T.CircleGeometry(1, 32), cor, { sombra: false, ...op }); m.rotation.set(-Math.PI / 2, 0, giro); m.scale.set(rx, rz, 1); m.position.set(x, y, z); g.add(m); return m; };
      disco(h.green.x, h.green.z, h.green.r + 1.6, h.green.r + 1.6, 0, "#5fc24c", 0.024);
      disco(h.green.x, h.green.z, h.green.r, h.green.r, 0, "#86e06a", 0.03);
      for (const a of h.areias) disco(a.x, a.z, a.rx, a.rz, -a.giro, "#f0dca2", 0.034);
      for (const a of h.aguas) { disco(a.x, a.z, a.rx + 0.8, a.rz + 0.8, -a.giro, "#e9d9a5", 0.033); disco(a.x, a.z, a.rx, a.rz, -a.giro, "#3c9de6", 0.04, { transparente: true, opacidade: 0.92 }); }
      const tee = ctx.malha(new T.BoxGeometry(6, 0.06, 4.4), "#8fdc72", { sombra: false }); tee.position.set(0, 0.03, 0); g.add(tee);
      for (const x of [-2.2, 2.2]) { const m = ctx.malha(new T.SphereGeometry(0.13, 10, 8), "#ff4d4d"); m.position.set(x, 0.12, -1); g.add(m); }
      const copo = new T.Mesh(new T.CircleGeometry(0.11, 16), new T.MeshBasicMaterial({ color: "#14181f" })); copo.rotation.x = -Math.PI / 2; copo.position.set(h.copo.x, 0.034, h.copo.z); g.add(copo);
      bandeira = new T.Group();
      const haste = ctx.malha(new T.CylinderGeometry(0.025, 0.025, 2.4, 8), "#f4f4f4"); haste.position.y = 1.2;
      const pano = ctx.malha(new T.PlaneGeometry(0.8, 0.5), "#ff3b3b"); pano.material.side = T.DoubleSide; pano.position.set(0.4, 2.15, 0);
      bandeira.add(haste, pano); bandeira.position.set(h.copo.x, 0, h.copo.z); g.add(bandeira);
      // as árvores dos dois lados (duas malhas só, com cópias)
      const r = aleatorio(semente + est.buraco * 31), arvores = [];
      for (let i = 0; i < h.pontos.length - 1; i += 1) {
        const a = h.pontos[i], b = h.pontos[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        for (const lado of [-1, 1]) {
          if (r() < 0.25) continue;
          const d = h.largura + r.entre(9, 34), x = a.x + (-dz / l) * d * lado, z = a.z + (dx / l) * d * lado;
          if (Math.hypot(x - h.green.x, z - h.green.z) < h.green.r + 8 || h.aguas.some((w) => naElipse({ ...w, rx: w.rx + 3, rz: w.rz + 3 }, x, z)) || Math.hypot(x, z) < 12) continue;
          arvores.push([x, z, r.entre(0.9, 1.6)]);
        }
      }
      const troncos = new T.InstancedMesh(new T.CylinderGeometry(0.25, 0.35, 2.4, 7), ctx.mat("#8a5a35"), arvores.length);
      const copas = new T.InstancedMesh(new T.SphereGeometry(1.9, 10, 8), ctx.mat("#3e9a49"), arvores.length);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Vector3();
      arvores.forEach(([x, z, s], i) => {
        troncos.setMatrixAt(i, m4.compose(new T.Vector3(x, 1.2 * s, z), q, e.set(s, s, s)));
        copas.setMatrixAt(i, m4.compose(new T.Vector3(x, 3.6 * s, z), q, e.set(s, s * 1.2, s)));
        copas.setColorAt(i, new T.Color(r() < 0.5 ? "#3e9a49" : "#4fae55"));
      });
      troncos.castShadow = copas.castShadow = true;
      g.add(troncos, copas);
      // o vento deste buraco
      const va = r() * Math.PI * 2, vv = r.entre(0, 5.5);
      est.vento = { x: Math.sin(va) * vv, z: -Math.cos(va) * vv };
      est.x = 0; est.z = 0.6; est.y = 0; est.tacadas = 0; est.fase = "mirando"; est.ajuste = 0;
      est.anterior = { x: est.x, z: est.z };
      escolherTaco();
      hud.aviso(t("Buraco {n} · Par {p} · {m} m", { n: est.buraco + 1, p: h.par, m: Math.round(h.comprimento) }), 2200);
    }
    const distCopo = () => Math.hypot(h.copo.x - est.x, h.copo.z - est.z);
    const lie = () => superficie(h, est.x, est.z);
    function escolherTaco() {
      if (lie() === "green") { est.taco = PUTTER; return; }
      const d = distCopo(), f = SAIDA[lie()] || 1;
      let escolhido = 0;
      for (let i = 0; i < PUTTER; i++) if (TACOS[i].max * f >= d * 0.98) escolhido = i;
      est.taco = escolhido;
    }
    /** Para onde mirar antes do ajuste: a bandeira, se alcança; senão, o caminho do fairway na distância do taco. */
    function anguloBase() {
      const f = est.taco === PUTTER ? 1 : SAIDA[lie()] || 1, alcance = TACOS[est.taco].max * f;
      let alvo = h.copo;
      if (distCopo() > alcance * 1.04 && est.taco !== PUTTER) {
        const meu = pertoDoCaminho(h, est.x, est.z).s;
        alvo = h.pontos.find((pt) => pt.s > meu && Math.hypot(pt.x - est.x, pt.z - est.z) >= alcance * 0.95) || h.copo;
      }
      return Math.atan2(alvo.x - est.x, -(alvo.z - est.z));
    }
    const direcao = (a) => new T.Vector3(Math.sin(a), 0, -Math.cos(a));
    function bater(forca, dx) {
      if (est.fase !== "mirando") return;
      est.fase = "balanco";
      est.forca = limitar(forca); est.dx = limitar(dx || 0, -1, 1);
      const putt = est.taco === PUTTER;
      est.espera = putt ? 0.4 : 0.66;
      golfista.animar(putt
        ? [{ t: 0, pose: { ombroD: [-0.45, 0, 0.35], ombroE: [-0.45, 0, -0.35] } }, { t: 0.55, pose: { ombroD: [-0.2, 0, 0.55], ombroE: [-0.25, 0, -0.15], tronco: [0, 0.2, 0] } }, { t: 1, pose: { ombroD: [-0.7, 0, 0.15], ombroE: [-0.7, 0, -0.5], tronco: [0, -0.2, 0] } }]
        : [{ t: 0, pose: { ombroD: [-0.5, 0, 0.3], ombroE: [-0.5, 0, -0.3] } }, { t: 0.55, pose: { tronco: [0, 1.15, 0], ombroD: [-2.4, 0, -0.6], ombroE: [-2.2, 0, 0.2] } }, { t: 0.75, pose: { tronco: [0, 0, 0], ombroD: [-0.5, 0, 0.3], ombroE: [-0.5, 0, -0.3] } }, { t: 1, pose: { tronco: [0, -1.3, 0], ombroD: [-2.3, 0, 0.4], ombroE: [-2.5, 0, 0.8] } }], putt ? 0.65 : 0.9);
    }
    function soltarBola() {
      const putt = est.taco === PUTTER, a = est.mira + (putt ? 0 : (Math.random() - 0.5) * 0.05 * (0.4 + est.forca) + est.dx * 0.1);
      const d = direcao(a);
      est.anterior = { x: est.x, z: est.z };
      est.tacadas++; est.totalTacadas++;
      est.direcaoVoo = d.clone();
      som(putt ? "quique" : "rebatida");
      if (putt) { const v = 6.7 * est.forca; est.vel.set(d.x * v, 0, d.z * v); est.fase = "rolando"; return; }
      const taco = TACOS[est.taco], carry = Math.max(4, taco.max * est.forca * (SAIDA[lie()] || 1)), th = (taco.loft * Math.PI) / 180;
      // a velocidade que, sem vento, leva a bola à distância do taco com o backspin dele (js/esportes-nucleo.js)
      const N = C.esportesNucleo, giro = 220 + taco.loft * 6;
      const v0 = N ? N.velocidadePara(carry, taco.loft, giro, N.BOLAS.golfe) : Math.sqrt((carry * G) / Math.sin(2 * th));
      est.vel.set(d.x * v0 * Math.cos(th), v0 * Math.sin(th), d.z * v0 * Math.cos(th));
      const eixo = N ? N.eixoBackspin(d) : { x: 0, y: 0, z: 0 };
      est.giro = { x: eixo.x * giro, y: -est.dx * 260, z: eixo.z * giro }; // efeito para o lado: puxar para a direita curva para a direita
      est.curva = N ? 0 : est.dx * 5;
      est.y = 0.05;
      est.fase = "voo";
    }
    entrada.on("solta", (s) => bater(s.forca, s.dx));
    entrada.on("golpe", (g) => bater(g.forca, g.dx));
    entrada.on("tecla", ({ codigo }) => {
      if (est.fase !== "mirando") return;
      if (codigo === "KeyQ") est.taco = Math.max(0, est.taco - 1);
      else if (codigo === "KeyE") est.taco = Math.min(PUTTER, est.taco + 1);
    });
    function penalidade(texto) {
      est.tacadas++; est.totalTacadas++;
      hud.aviso(texto, 1800, "ruim"); som("erro");
      est.x = est.anterior.x; est.z = est.anterior.z; est.y = 0; est.vel.set(0, 0, 0);
      est.fase = "parada"; est.espera = 1.4;
    }
    function noBuraco() {
      est.fase = "buraco"; est.espera = 2.8; est.vel.set(0, 0, 0);
      const dif = est.tacadas - h.par;
      est.cartao.push({ par: h.par, tacadas: est.tacadas });
      som("buraco");
      hud.aviso(est.tacadas === 1 ? t("Hole in one!") : t(NOMES_RESULTADO[dif] || (dif > 0 ? "+{n}" : "{n}"), { n: dif }), 2400, dif <= 0 ? "bom" : "");
    }
    function rolar(dt) {
      const sup = lie(), v = Math.hypot(est.vel.x, est.vel.z);
      if (sup === "agua") return penalidade(t("Na água! +1 tacada"));
      if (sup === "fora") return penalidade(t("Fora dos limites! +1 tacada"));
      if (sup === "green") { est.vel.x += h.inclinacao.x * dt; est.vel.z += h.inclinacao.z * dt; }
      const nv = Math.max(0, v - (ATRITO[sup] || 3) * dt);
      if (v > 0) { est.vel.x *= nv / v; est.vel.z *= nv / v; }
      est.x += est.vel.x * dt; est.z += est.vel.z * dt;
      const dc = distCopo();
      if (dc < 0.11) {
        if (nv < 2.3) return noBuraco();
        est.vel.multiplyScalar(0.7); est.vel.applyAxisAngle(new T.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6); // bateu na borda
      }
      if (nv < 0.05) { est.fase = "parada"; est.espera = 0.7; est.vel.set(0, 0, 0); }
    }
    function voar(dt) {
      const N = C.esportesNucleo;
      if (N && est.giro) {
        // gravidade, resistência do ar com o vento e o efeito Magnus, em passos pequenos
        const pos = { x: est.x, y: est.y, z: est.z }, vento = { x: est.vento.x, y: 0, z: est.vento.z }, n = 4;
        for (let i = 0; i < n; i++) N.passo(pos, est.vel, est.giro, vento, N.BOLAS.golfe, dt / n);
        est.x = pos.x; est.y = pos.y; est.z = pos.z;
      } else {
        est.vel.y -= G * dt;
        est.vel.x += est.vento.x * 0.32 * dt; est.vel.z += est.vento.z * 0.32 * dt;
        const d = est.direcaoVoo; est.vel.x += -d.z * est.curva * dt; est.vel.z += d.x * est.curva * dt; // efeito (gancho ou slice)
        est.x += est.vel.x * dt; est.y += est.vel.y * dt; est.z += est.vel.z * dt;
      }
      if (est.y <= 0) {
        est.y = 0;
        const sup = lie();
        if (sup === "agua") return penalidade(t("Na água! +1 tacada"));
        if (sup === "fora") return penalidade(t("Fora dos limites! +1 tacada"));
        som("quique");
        const h2 = Math.hypot(est.vel.x, est.vel.z), rola = TACOS[est.taco].rola * (sup === "rough" ? 0.4 : sup === "areia" ? 0.05 : 1) * h2;
        est.vel.set((est.vel.x / (h2 || 1)) * rola, 0, (est.vel.z / (h2 || 1)) * rola);
        est.fase = "rolando";
        if (sup === "areia") hud.aviso(t("Na areia"), 1200);
      }
    }
    function proximo() {
      if (est.fase === "buraco") {
        est.buraco++;
        if (est.buraco >= total) return terminar();
        return construirBuraco();
      }
      if (est.tacadas >= h.par + 5) { hud.aviso(t("Limite de tacadas: próximo buraco"), 1800); est.cartao.push({ par: h.par, tacadas: est.tacadas }); est.fase = "buraco"; est.espera = 2; return; }
      est.fase = "mirando"; est.ajuste = 0; escolherTaco();
    }
    function terminar() {
      est.fase = "fim";
      const soma = est.cartao.reduce((a, c) => a + c.tacadas, 0), pares = est.cartao.reduce((a, c) => a + c.par, 0), dif = soma - pares;
      const tabela = el("table", { class: "mj-tabela" },
        el("tr", {}, el("th", {}, t("Buraco")), ...est.cartao.map((_, i) => el("th", {}, String(i + 1))), el("th", {}, t("Total"))),
        el("tr", {}, el("th", {}, t("Par")), ...est.cartao.map((c) => el("td", {}, String(c.par))), el("td", {}, String(pares))),
        el("tr", {}, el("th", {}, t("Você")), ...est.cartao.map((c) => el("td", { class: c.tacadas < c.par ? "abaixo" : c.tacadas > c.par ? "acima" : "" }, String(c.tacadas))), el("td", {}, String(soma))));
      ctx.fim({ vitoria: dif <= 0, recorde: { valor: dif, melhor: "menor", variante: total, rotulo: t("{d} em {b} buracos", { d: dif > 0 ? "+" + dif : dif === 0 ? "par" : String(dif), b: total }) }, titulo: dif === 0 ? t("No par!") : dif < 0 ? t("{n} abaixo do par!", { n: -dif }) : t("{n} acima do par", { n: dif }), subtitulo: t("{n} tacadas em {b} buracos", { n: soma, b: total }), tabela });
    }
    function desenharPlacar() {
      const setas = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"], va = Math.atan2(est.vento.x, -est.vento.z), vv = Math.hypot(est.vento.x, est.vento.z);
      const seta = setas[((Math.round((va - est.mira) / (Math.PI / 4)) % 8) + 8) % 8];
      const feitas = est.cartao.reduce((a, c) => a + c.tacadas - c.par, 0);
      hud.placar([el("span", { class: "mj-chip" }, t("Buraco {n}/{t}", { n: est.buraco + 1, t: total }) + " · " + t("Par {p}", { p: h.par })),
        el("span", { class: "mj-chip forte", "data-tacadas": est.tacadas }, t("Tacada {n}", { n: est.tacadas + (est.fase === "mirando" ? 1 : 0) })),
        el("span", { class: "mj-chip" }, t("{m} m da bandeira", { m: Math.round(distCopo()) })),
        el("span", { class: "mj-chip", "data-taco": est.taco }, t(TACOS[est.taco].nome) + " (Q/E)"),
        el("span", { class: "mj-chip" }, t("Vento {v} m/s", { v: vv.toFixed(1) }) + " " + (vv > 0.3 ? seta : "")),
        el("span", { class: "mj-chip" }, t("Total {n}", { n: feitas > 0 ? "+" + feitas : String(feitas) }))]);
    }
    construirBuraco();
    let tempoPlacar = 0;
    return {
      dica: (modo) => dicaControles(modo,
        t("O mouse (ou A/D) ajusta a mira; Q/E trocam o taco. Segure o clique (ou Espaço) para a força e solte para bater; puxar o mouse para o lado ao soltar faz a bola curvar."),
        t("Incline o corpo para ajustar a mira; Q/E trocam o taco. Faça o movimento da tacada: a velocidade dos braços é a força (devagar no green).")),
      atualizar(dt) {
        if (est.fase === "mirando") {
          est.ajuste = limitar(est.ajuste + entrada.lado * dt * 0.5, -0.9, 0.9);
          est.mira = anguloBase() + est.ajuste + (entrada.modo === "mouse" ? entrada.mira.x * 0.45 : 0);
          hud.barra(entrada.apertado ? entrada.carga : null, t("Força"));
        } else hud.barra(null);
        if (est.fase === "balanco") { est.espera -= dt; if (est.espera <= 0) soltarBola(); }
        const passos = 4;
        for (let i = 0; i < passos; i++) { if (est.fase === "voo") voar(dt / passos); else if (est.fase === "rolando") rolar(dt / passos); }
        if (est.fase === "parada" || est.fase === "buraco") { est.espera -= dt; if (est.espera <= 0) proximo(); }
        // a mira: a linha até onde a bola cai (ou, no green, o caminho da bola com a caída)
        const d = direcao(est.mira), mirando = est.fase === "mirando";
        linhaMira.visible = anel.visible = mirando;
        if (mirando) {
          const pts = linhaMira.geometry.attributes.position, putt = est.taco === PUTTER;
          if (putt) {
            let x = est.x, z = est.z, v = 6.7 * (entrada.apertado ? Math.max(0.05, entrada.carga) : Math.min(1, Math.sqrt(distCopo() * 2 * ATRITO.green) / 6.7)), vx = d.x * v, vz = d.z * v;
            for (let i = 0; i < 40; i++) { pts.setXYZ(i, x, 0.06, z); for (let k = 0; k < 4; k++) { const sp = Math.hypot(vx, vz); if (sp < 0.05) break; vx += h.inclinacao.x * 0.05; vz += h.inclinacao.z * 0.05; const nv = Math.max(0, sp - ATRITO.green * 0.05); vx *= nv / sp; vz *= nv / sp; x += vx * 0.05; z += vz * 0.05; } }
            anel.position.set(x, 0.05, z); anel.scale.setScalar(0.25);
          } else {
            const alcance = TACOS[est.taco].max * (SAIDA[lie()] || 1) * (entrada.apertado ? Math.max(0.05, entrada.carga) : 1);
            for (let i = 0; i < 40; i++) pts.setXYZ(i, est.x + d.x * alcance * (i / 39), 0.08, est.z + d.z * alcance * (i / 39));
            anel.position.set(est.x + d.x * alcance, 0.06, est.z + d.z * alcance); anel.scale.setScalar(1 + alcance / 150);
          }
          pts.needsUpdate = true;
          linhaMira.computeLineDistances();
          linhaMira.geometry.computeBoundingSphere();
        }
        bola.position.set(est.x, est.y + 0.07, est.z);
        marcador.position.set(est.x, est.y + 1.6 + Math.sin(performance.now() / 300) * 0.15, est.z);
        marcador.visible = est.fase !== "voo";
        // o golfista ao lado da bola, de frente para ela (a bandeira fica à esquerda dele)
        const f = new T.Vector3(-d.z, 0, d.x);
        if (mirando || est.fase === "balanco") { golfista.grupo.visible = true; golfista.grupo.position.set(est.x - f.x * 0.75, 0, est.z - f.z * 0.75); golfista.grupo.rotation.y = Math.atan2(f.x, f.z); }
        golfista.atualizar(dt);
        if (bandeira) bandeira.children[1].rotation.y = Math.sin(performance.now() / 400) * 0.25;
        sol.position.set(est.x + 16, 30, est.z + 10); sol.target.position.set(est.x, 0, est.z);
        tempoPlacar -= dt;
        if (tempoPlacar <= 0) { desenharPlacar(); tempoPlacar = 0.2; }
        const putt = est.taco === PUTTER && mirando;
        if (est.fase === "voo" || est.fase === "rolando") {
          const vd = est.direcaoVoo || d;
          seguir(new T.Vector3(est.x - vd.x * 11, 4 + est.y * 0.4, est.z - vd.z * 11), new T.Vector3(est.x, est.y, est.z), dt, est.fase === "voo" ? 3 : 2);
        } else seguir(new T.Vector3(est.x - d.x * (putt ? 3.6 : 6.5), putt ? 1.5 : 2.6, est.z - d.z * (putt ? 3.6 : 6.5)), new T.Vector3(est.x + d.x * (putt ? 5 : 24), 0, est.z + d.z * (putt ? 5 : 24)), dt, 3);
      },
      estado: () => ({ fase: est.fase, buraco: est.buraco + 1, total, par: h.par, tacadas: est.tacadas, cartao: est.cartao.slice(), taco: TACOS[est.taco].nome, distancia: distCopo(), lie: lie(), x: est.x, z: est.z, semente }),
      /** Para os testes: bate na hora (forca 0 a 1). */
      bater,
      /** Para os testes: põe a bola em (x, z) (ex.: na beira do buraco). */
      colocar(x, z) { est.x = x; est.z = z; est.fase = "mirando"; escolherTaco(); },
      get buracoAtual() { return h; },
    };
  }

  // ══════════════════════════════ BOXE ══════════════════════════════

  const NIVEIS = { facil: { agressao: 0.6, defesa: 0.25, dano: 0.75, aviso: 0.7, vida: 90 }, medio: { agressao: 1, defesa: 0.45, dano: 1.15, aviso: 0.55, vida: 120 }, dificil: { agressao: 1.4, defesa: 0.62, dano: 1.5, aviso: 0.4, vida: 150 } };
  const FOLEGO = { E: 16, D: 25, recupera: 15 }; // socar cansa: o jab gasta menos que o direto; o fôlego volta sozinho
  const ROUND = 60;

  /** O adversário entre o fácil (força 0) e o difícil (força 1), passando pelo médio. */
  function nivelPara(forca) {
    const f = limitar(forca), [a, b, k] = f < 0.5 ? [NIVEIS.facil, NIVEIS.medio, f / 0.5] : [NIVEIS.medio, NIVEIS.dificil, (f - 0.5) / 0.5];
    return Object.fromEntries(Object.keys(a).map((c) => [c, lerp(a[c], b[c], k)]));
  }
  function criarBoxe(ctx) {
    const { T, cena, camera, entrada, hud, som } = ctx;
    const auto = ctx.opcoes.nivel === "auto";
    const nivel = auto ? nivelPara(ctx.forcaCPU) : NIVEIS[ctx.opcoes.nivel] || NIVEIS.medio;
    const forcaLuta = auto ? ctx.forcaCPU : { facil: 0.2, medio: 0.5, dificil: 0.85 }[ctx.opcoes.nivel] ?? 0.5;
    cena.background = new T.Color("#11131c");
    cena.fog = new T.Fog("#11131c", 12, 34);
    cena.add(new T.HemisphereLight("#cfd8ff", "#2a2233", 0.9));
    const foco = new T.SpotLight("#fff4e0", 220, 22, 0.62, 0.45, 1.4);
    foco.position.set(0, 9, 1.5); foco.target.position.set(0, 0, 0); foco.castShadow = true; foco.shadow.mapSize.set(1024, 1024);
    cena.add(foco, foco.target);
    // o ringue: a lona, a saia, os postes dos cantos e as cordas
    const lona = ctx.malha(new T.BoxGeometry(7, 1, 7), "#e9eef7"); lona.position.y = -0.5; cena.add(lona);
    const saia = ctx.malha(new T.BoxGeometry(7.4, 0.9, 7.4), "#1d3a8a"); saia.position.y = -0.62; cena.add(saia);
    const chao = ctx.malha(new T.PlaneGeometry(60, 60), "#24232e", { sombra: false }); chao.rotation.x = -Math.PI / 2; chao.position.y = -1; cena.add(chao);
    const cantos = [[3.2, 3.2, "#d93b3b"], [-3.2, 3.2, "#2f6bd9"], [3.2, -3.2, "#f2f2f2"], [-3.2, -3.2, "#f2f2f2"]];
    for (const [x, z, c] of cantos) { const poste = ctx.malha(new T.CylinderGeometry(0.09, 0.09, 1.5, 10), c); poste.position.set(x, 0.75, z); cena.add(poste); }
    for (const y of [0.45, 0.85, 1.25]) for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) {
      const pa = cantos[a], pb = cantos[b], c = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const corda = ctx.malha(new T.CylinderGeometry(0.025, 0.025, c, 6), y === 0.85 ? "#f2f2f2" : "#d93b3b", { sombra: false });
      corda.position.set((pa[0] + pb[0]) / 2, y, (pa[1] + pb[1]) / 2); corda.rotation.set(Math.PI / 2, 0, Math.atan2(pb[0] - pa[0], pb[1] - pa[1]) === 0 ? 0 : Math.PI / 2);
      if (pa[0] === pb[0]) corda.rotation.set(Math.PI / 2, 0, 0); else corda.rotation.set(0, 0, Math.PI / 2);
      cena.add(corda);
    }
    const torcidas = [];
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2, tc = ctx.arquibancada({ largura: 16, filas: 6, x: Math.sin(a) * 9, z: Math.cos(a) * 9, giro: a + Math.PI, semente: 40 + i, cor: "#3a3d52" }); tc.grupo.position.y = -1; torcidas.push(tc); }
    // o adversário (de frente para você) e as suas luvas (na frente da câmera)
    const op = ctx.boneco({ cor: "#ff5a5f", calca: "#2a2a3a", luvas: "#d62f2f" });
    op.grupo.position.set(0, 0, -1.15);
    const luvaMat = ctx.mat(ctx.cor);
    const luvas = { E: new T.Mesh(new T.SphereGeometry(0.1, 18, 14), luvaMat), D: new T.Mesh(new T.SphereGeometry(0.1, 18, 14), luvaMat) };
    for (const l of Object.values(luvas)) { l.scale.set(0.85, 0.78, 1.05); camera.add(l); }
    cena.add(camera);
    const flash = el("div", { class: "mj-flash" });
    ctx.elemento.append(flash);
    const vidas = el("div", { class: "mj-vidas" },
      el("div", { class: "mj-vida eu" }, el("b", {}, t("Você")), el("span", { class: "barra" }, el("i")), el("span", { class: "barra folego", title: t("Fôlego") }, el("i"))),
      el("div", { class: "mj-round" }, el("b"), el("span")),
      el("div", { class: "mj-vida cpu" }, el("b", {}, t("CPU")), el("span", { class: "barra" }, el("i"))));
    hud.placar([vidas]);
    const seguir = seguidor(camera, T);

    const luta = { round: 1, tempo: ROUND, vida: [100, nivel.vida], quedas: [0, 0], folego: 100, pontos: [0, 0], fase: "inicio", espera: 1.8, contagem: 0, caido: null, levantar: 0, socos: 0, acertos: 0, bloqueios: 0, esquivas: 0 };
    const o = { estado: "parado", t: 0.8, mao: "D", alvo: "cabeca", guarda: null, x: 0, alvoX: 0, seguidos: 0 };
    const eu = { soco: { E: 0, D: 0 }, alvo: { E: "cabeca", D: "cabeca" }, forca: { E: 0.6, D: 0.6 }, acertou: { E: true, D: true }, tremor: 0 };
    function desenharVidas() {
      vidas.querySelector(".eu i").style.width = Math.max(0, luta.vida[0]) + "%";
      vidas.querySelector(".cpu i").style.width = Math.max(0, (luta.vida[1] / nivel.vida) * 100) + "%";
      vidas.querySelector(".folego i").style.width = Math.max(0, luta.folego) + "%";
      const s = Math.max(0, Math.ceil(luta.tempo));
      vidas.querySelector(".mj-round b").textContent = t("Round {n}", { n: luta.round });
      vidas.querySelector(".mj-round span").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    function socar(mao, forca, altura) {
      if (luta.fase === "contagem" && luta.caido === "eu") { luta.levantar++; return; }
      if (luta.fase !== "luta" || eu.soco[mao] > 0) return;
      if (luta.folego < FOLEGO[mao]) { if (!eu.avisouFolego) { hud.aviso(t("Sem fôlego! Respire um pouco"), 900, "ruim"); eu.avisouFolego = true; } return; }
      eu.avisouFolego = false;
      luta.folego -= FOLEGO[mao];
      eu.soco[mao] = 0.3; eu.acertou[mao] = false;
      eu.alvo[mao] = altura > -0.15 ? "cabeca" : "corpo";
      eu.forca[mao] = forca;
      luta.socos++;
    }
    entrada.on("toque", (x) => socar(x.mao, 0.6, entrada.mira.y));
    entrada.on("golpe", (g) => socar(g.mao, g.forca, g.altura ?? 0.2));
    function resolverSoco(mao) {
      const alvo = eu.alvo[mao], forca = eu.forca[mao];
      if (o.estado === "caido") return;
      // o adversário pode se defender na hora
      if ((o.estado === "parado" || o.estado === "guarda") && Math.random() < nivel.defesa * 0.7) {
        if (Math.random() < 0.4) { o.estado = "esquiva"; o.t = 0.35; o.lado = Math.random() < 0.5 ? -1 : 1; }
        else { o.estado = "guarda"; o.guarda = alvo === "cabeca" ? "alta" : "baixa"; o.t = Math.max(o.t, 0.6); }
      }
      if (o.estado === "esquiva") { hud.aviso(t("Ele esquivou"), 600); return; }
      // preparando o soco, ele se cobre: só no fim da preparação dá para contra-atacar (no começo, o soco é bloqueado e o ataque segue)
      if (o.estado === "preparo" && o.t > o.preparo * 0.35) { luta.vida[1] -= 0.8; som("defesa"); luta.bloqueios++; return; }
      if (o.estado === "guarda" && ((o.guarda === "alta" && alvo === "cabeca") || (o.guarda === "baixa" && alvo === "corpo"))) {
        luta.vida[1] -= 0.8; som("defesa"); luta.bloqueios++; return;
      }
      const contra = o.estado === "preparo" || o.estado === "recupera";
      let dano = (mao === "E" ? 4.5 : 7.5) * (0.6 + 0.8 * forca) * (alvo === "cabeca" ? 1.2 : 1) * (contra ? 1.6 : 1) * (o.estado === "atordoado" ? 1.3 : 1);
      luta.vida[1] -= dano;
      luta.pontos[0] += contra ? 2 : 1;
      luta.acertos++;
      som("soco");
      o.seguidos++;
      if (contra) hud.aviso(t("Contra-ataque!"), 800, "bom");
      if (luta.vida[1] <= 0) return derrubar("cpu");
      if (contra && o.estado !== "atordoado") { o.estado = "atordoado"; o.t = 1.1; o.seguidos = 0; }
      else if (o.estado === "atordoado") { /* continua tonto até o tempo acabar */ }
      else if (o.seguidos >= 2 && Math.random() < 0.45 + nivel.defesa) { o.estado = "guarda"; o.guarda = alvo === "cabeca" ? "alta" : "baixa"; o.t = lerp(0.7, 1.1, Math.random()); o.seguidos = 0; } // fecha a guarda depois de apanhar
      else { o.estado = "atingido"; o.t = 0.3; }
      void dano;
    }
    function socoDoAdversario() {
      if (entrada.guarda) { luta.vida[0] -= 1.5 * nivel.dano; som("defesa"); luta.bloqueios++; o.estado = "recupera"; o.t = 0.4; return; }
      if (Math.abs(entrada.lado) > 0.45) { luta.esquivas++; hud.aviso(t("Esquivou!"), 700, "bom"); o.estado = "recupera"; o.t = 0.95; return; }
      const dano = (o.mao === "D" ? 10 : 7) * nivel.dano * (0.85 + Math.random() * 0.3);
      luta.vida[0] -= dano;
      luta.pontos[1] += 1;
      som("soco");
      eu.tremor = 0.35;
      flash.classList.remove("ativo"); void flash.offsetWidth; flash.classList.add("ativo");
      o.estado = "recupera"; o.t = 0.35;
      if (luta.vida[0] <= 0) derrubar("eu");
    }
    function derrubar(quem) {
      const k = quem === "eu" ? 0 : 1;
      luta.quedas[k]++;
      luta.fase = "contagem"; luta.caido = quem; luta.contagem = 0; luta.espera = 1; luta.levantar = 0;
      som("sino");
      hud.aviso(quem === "eu" ? t("Você caiu! Aperte (ou soque) várias vezes para levantar") : t("Knockdown!"), 2000, quem === "eu" ? "ruim" : "bom");
      if (quem === "cpu") { o.estado = "caido"; torcidas.forEach((tc) => tc.comemorar(2.5)); }
    }
    function fimDaLuta(vitoria, titulo, sub) {
      luta.fase = "fim";
      ctx.fim({ vitoria, empate: titulo === t("Empate nos pontos"), forcaCPU: forcaLuta, recorde: { valor: luta.acertos, melhor: "maior", rotulo: t("{n} socos certos", { n: luta.acertos }) }, titulo, subtitulo: sub, linhas: [t("Socos: {n} · acertos: {a}", { n: luta.socos, a: luta.acertos }), t("Defesas: {d} · esquivas: {e}", { d: luta.bloqueios, e: luta.esquivas }), t("Knockdowns: você {a} × {b} CPU", { a: luta.quedas[1], b: luta.quedas[0] })] });
    }
    function contar(dt) {
      luta.espera -= dt;
      if (luta.espera > 0) return;
      luta.espera = 1;
      luta.contagem++;
      hud.aviso(String(luta.contagem), 800);
      if (luta.caido === "cpu") {
        const levanta = luta.quedas[1] < 3 && luta.contagem >= 4 + luta.quedas[1] * 2 && Math.random() < 0.85;
        if (levanta) { luta.vida[1] = nivel.vida * (0.62 - luta.quedas[1] * 0.1); o.estado = "parado"; o.t = 1; luta.fase = "luta"; luta.caido = null; hud.aviso(t("Ele levantou!"), 1200); return; }
        if (luta.contagem >= 10 || luta.quedas[1] >= 3) return fimDaLuta(true, t("Nocaute! Você venceu!"), luta.quedas[1] >= 3 ? t("3 knockdowns (nocaute técnico)") : t("Ele não levantou"));
      } else {
        const precisa = 5 + luta.quedas[0] * 3;
        if (luta.quedas[0] < 3 && luta.levantar >= precisa) { luta.vida[0] = 45 - luta.quedas[0] * 10; luta.fase = "luta"; luta.caido = null; hud.aviso(t("De pé! Continue"), 1200, "bom"); return; }
        if (luta.contagem >= 10 || luta.quedas[0] >= 3) return fimDaLuta(false, t("Nocaute… o CPU venceu"), luta.quedas[0] >= 3 ? t("3 knockdowns (nocaute técnico)") : t("Você não levantou a tempo"));
      }
    }
    function fimDoRound() {
      som("sino");
      if (luta.round >= 3) {
        const [a, b] = [luta.pontos[0] + luta.quedas[1] * 5, luta.pontos[1] + luta.quedas[0] * 5];
        return fimDaLuta(a > b, a === b ? t("Empate nos pontos") : a > b ? t("Vitória por pontos!") : t("Derrota por pontos"), t("Pontos: você {a} × {b} CPU", { a, b }));
      }
      luta.fase = "intervalo"; luta.espera = 3;
      hud.aviso(t("Fim do round {n}", { n: luta.round }), 2000);
    }
    function poseAdversario(tempo) {
      const base = { ombroD: [-2.0, 0, 0.38], ombroE: [-2.0, 0, -0.38], tronco: [0.1, 0, 0], cabeca: [0, 0, 0] };
      const p = { ...base };
      const flashLuva = (on) => op.mao[o.mao].children[0] && op.mao[o.mao].children[0].material.emissive && op.mao[o.mao].children[0].material.emissive.set(on ? "#ff2a2a" : "#000000");
      flashLuva(false);
      switch (o.estado) {
        case "guarda": if (o.guarda === "baixa") { p.ombroD = [-1.25, 0, 0.45]; p.ombroE = [-1.25, 0, -0.45]; } else { p.ombroD = [-2.35, 0, 0.5]; p.ombroE = [-2.35, 0, -0.5]; } break;
        case "preparo": p[o.mao === "D" ? "ombroD" : "ombroE"] = o.mao === "D" ? [-1.1, 0, -0.35] : [-1.1, 0, 0.35]; p.tronco = [0.1, o.mao === "D" ? 0.45 : -0.45, 0]; flashLuva(Math.sin(tempo * 30) > 0); break;
        case "soco": p[o.mao === "D" ? "ombroD" : "ombroE"] = [-1.57, 0, o.mao === "D" ? 0.12 : -0.12]; p.tronco = [0.3, o.mao === "D" ? -0.4 : 0.4, 0]; break;
        case "atingido": p.cabeca = [-0.45, 0, 0]; p.tronco = [-0.2, 0, 0]; break;
        case "atordoado": p.ombroD = [-0.7, 0, 0.1]; p.ombroE = [-0.7, 0, -0.1]; p.tronco = [-0.1, 0, Math.sin(tempo * 7) * 0.2]; p.cabeca = [0.2, 0, Math.sin(tempo * 5) * 0.3]; break;
        case "esquiva": p.tronco = [0.2, 0, (o.lado || 1) * 0.45]; break;
        case "caido": p.ombroD = [-0.2, 0, -1.2]; p.ombroE = [-0.2, 0, 1.2]; break;
        default: break;
      }
      op.pose(p);
      op.corpo.rotation.x += ((o.estado === "caido" ? -1.45 : 0) - op.corpo.rotation.x) * 0.15;
    }
    let tempoTotal = 0;
    desenharVidas();
    return {
      dica: (modo) => dicaControles(modo,
        t("Botão esquerdo (ou K/Espaço) = soco direito; botão direito (ou J) = jab esquerdo. O mouse alto mira o rosto, baixo o corpo. S/Shift = guarda; A/D = esquivar. Quando a luva dele piscar, defenda ou esquive — e contra-ataque!"),
        t("Soque de verdade com cada mão (mão alta = rosto, baixa = corpo). As duas mãos na frente do rosto = guarda; incline o corpo para esquivar. Quando a luva dele piscar, defenda ou esquive — e contra-ataque!")),
      atualizar(dt) {
        tempoTotal += dt;
        if (luta.fase === "inicio") { luta.espera -= dt; if (luta.espera <= 0) { luta.fase = "luta"; som("sino"); hud.aviso(t("Round {n} — Lute!", { n: luta.round }), 1300); } }
        else if (luta.fase === "intervalo") {
          luta.espera -= dt;
          if (luta.espera <= 0) { luta.round++; luta.tempo = ROUND; luta.vida = [Math.min(100, luta.vida[0] + 15), Math.min(nivel.vida, luta.vida[1] + nivel.vida * 0.15)]; luta.folego = 100; o.estado = "parado"; o.t = 1; luta.fase = "luta"; som("sino"); hud.aviso(t("Round {n} — Lute!", { n: luta.round }), 1300); }
        } else if (luta.fase === "contagem") contar(dt);
        else if (luta.fase === "luta") {
          luta.tempo -= dt;
          luta.folego = Math.min(100, luta.folego + FOLEGO.recupera * dt * (entrada.guarda ? 1.4 : 1));
          if (luta.tempo <= 0) fimDoRound();
          // a IA do adversário
          o.t -= dt;
          o.x += (o.alvoX - o.x) * Math.min(1, dt * 3);
          if (o.t <= 0) {
            const r = Math.random();
            switch (o.estado) {
              case "parado":
                if (r < 0.42 * nivel.agressao) { o.estado = "preparo"; o.mao = Math.random() < 0.55 ? "D" : "E"; o.t = o.preparo = nivel.aviso; o.seguidos = 0; }
                else if (r < 0.42 * nivel.agressao + nivel.defesa) { o.estado = "guarda"; o.guarda = Math.random() < 0.6 ? "alta" : "baixa"; o.t = lerp(0.8, 1.6, Math.random()); }
                else { o.alvoX = lerp(-0.45, 0.45, Math.random()); o.t = lerp(0.35, 0.9, Math.random()); }
                break;
              case "preparo": o.estado = "soco"; o.t = 0.16; break;
              case "soco": socoDoAdversario(); break;
              default: o.estado = "parado"; o.t = lerp(0.3, 0.8, Math.random() / nivel.agressao); o.guarda = null;
            }
          }
        }
        // os seus socos (a luva vai e volta; o acerto conta no meio do caminho)
        for (const mao of ["E", "D"]) {
          if (eu.soco[mao] > 0) { eu.soco[mao] -= dt; if (!eu.acertou[mao] && eu.soco[mao] < 0.2) { eu.acertou[mao] = true; if (luta.fase === "luta") resolverSoco(mao); } }
          const k = eu.soco[mao] > 0 ? Math.sin(limitar(1 - eu.soco[mao] / 0.3) * Math.PI) : 0, s = mao === "E" ? -1 : 1;
          const guarda = entrada.guarda && k === 0;
          const yAlvo = eu.alvo[mao] === "corpo" ? -0.32 : -0.12;
          luvas[mao].position.set(lerp(guarda ? s * 0.13 : s * 0.24, s * 0.05, k), lerp(guarda ? -0.07 : -0.24, yAlvo, k), lerp(guarda ? -0.36 : -0.5, -0.98, k));
        }
        poseAdversario(tempoTotal);
        op.grupo.position.x = o.x + (o.estado === "esquiva" ? (o.lado || 1) * 0.25 : 0);
        op.grupo.position.z = -1.15 + (o.estado === "soco" ? 0.2 : 0);
        op.atualizar(dt);
        for (const tc of torcidas) tc.atualizar(dt);
        eu.tremor = Math.max(0, eu.tremor - dt);
        const tremor = eu.tremor > 0 ? (Math.random() - 0.5) * 0.06 : 0;
        const caido = luta.caido === "eu";
        seguir(new T.Vector3(entrada.lado * 0.38 + tremor, caido ? 0.5 : 1.62 + tremor, 1.1), new T.Vector3(o.x * 0.5, caido ? 2.5 : 1.42, -1.1), dt, caido ? 2 : 9);
        camera.rotation.z += -entrada.lado * 0.12;
        desenharVidas();
      },
      estado: () => ({ fase: luta.fase, round: luta.round, tempo: luta.tempo, vida: luta.vida.slice(), folego: luta.folego, vidaMaxima: nivel.vida, quedas: luta.quedas.slice(), pontos: luta.pontos.slice(), oponente: o.estado, socos: luta.socos, acertos: luta.acertos, bloqueios: luta.bloqueios, esquivas: luta.esquivas }),
      /** Para os testes: põe o adversário num estado (parado, guarda, preparo...) por alguns segundos. */
      forcarAdversario(estado, segundos = 2, extra = {}) { Object.assign(o, { estado, t: segundos, preparo: segundos }, extra); },
      pularTempo(s) { luta.tempo = s; },
      parar() { flash.remove(); },
    };
  }

  C.esportes = { pontosBoliche, decimoQuadro, rebatida, buracoDe, superficie, nivelPara, criarTenis, criarBoliche, criarBeisebol, criarGolfe, criarBoxe };

  C.minijogos.registrar({
    id: "tenis", nome: "Tênis", cor: "#2c62c9", descricao: "Partidas de simples ou duplas, com saque, troca de bola e a contagem do tênis.",
    opcoes: [{ id: "modo", rotulo: "Modo", padrao: "simples", valores: [{ v: "simples", rotulo: "Simples" }, { v: "duplas", rotulo: "Duplas" }] },
      { id: "games", rotulo: "Partida", padrao: 3, valores: [{ v: 1, rotulo: "1 game" }, { v: 3, rotulo: "Melhor de 3" }, { v: 5, rotulo: "Melhor de 5" }] }],
    criar: criarTenis,
  });
  C.minijogos.registrar({
    id: "beisebol", nome: "Beisebol", cor: "#d9443b", descricao: "Jogo completo: você rebate e depois arremessa. Bolas, strikes, bases e corridas.",
    opcoes: [{ id: "entradas", rotulo: "Entradas", padrao: 3, valores: [{ v: 1, rotulo: "1 entrada" }, { v: 3, rotulo: "3 entradas" }, { v: 9, rotulo: "9 entradas" }] }],
    criar: (ctx) => C.esportes.criarBeisebol(ctx),
  });
  C.minijogos.registrar({
    id: "boliche", nome: "Boliche", cor: "#8a4dff", descricao: "10 rodadas para derrubar os pinos, com strike, spare e a bola extra na última.",
    opcoes: [{ id: "bola", rotulo: "Bola", padrao: "media", valores: [{ v: "leve", rotulo: "Leve" }, { v: "media", rotulo: "Média" }, { v: "pesada", rotulo: "Pesada" }] }],
    criar: criarBoliche,
  });
  C.minijogos.registrar({
    id: "golfe", nome: "Golfe", cor: "#2fa35a", descricao: "Percursos de 3, 9 ou 18 buracos, com vento, areia, água e o green.",
    opcoes: [{ id: "buracos", rotulo: "Percurso", padrao: 3, valores: [{ v: 3, rotulo: "3 buracos" }, { v: 9, rotulo: "9 buracos" }, { v: 18, rotulo: "18 buracos" }] }],
    criar: (ctx) => C.esportes.criarGolfe(ctx),
  });
  C.minijogos.registrar({
    id: "boxe", nome: "Boxe", cor: "#f08a24", descricao: "Lutas de 3 rounds contra o adversário: soque, defenda e esquive.",
    opcoes: [{ id: "nivel", rotulo: "Adversário", padrao: "auto", valores: [{ v: "auto", rotulo: "Pela habilidade" }, { v: "facil", rotulo: "Fácil" }, { v: "medio", rotulo: "Médio" }, { v: "dificil", rotulo: "Difícil" }] }],
    criar: (ctx) => C.esportes.criarBoxe(ctx),
  });
})();
