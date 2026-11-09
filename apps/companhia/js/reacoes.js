/*
 * Companhia — reações aos toques. Cada área do corpo + gesto (tocar, tocar duas vezes, segurar, carinho, puxar)
 * vira uma reação: emoção, gesto do corpo, mudança de afeto e uma fala pronta (zero tokens). Com IA ligada e
 * "toques com IA", de tempos em tempos a fala vem da rota leve, levando em conta a conversa.
 *
 * Tudo é carinho (cafuné, segurar a mão, massagem no ombro) ou provocação de brincadeira (cutucar a bochecha,
 * puxar a orelha, mexer no chapéu, cócegas). Repetir provocação deixa ela brava; repetir carinho, apaixonada.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const R = (tipo, emocao, gesto, afeto, descricao, falas, quente) => ({ tipo, emocao, gesto, afeto, descricao, falas, quente });

  /** zona → gesto → reação. "quente": falas para quando o afeto está alto. */
  const REACOES = {
    cabeca: {
      carinho: R("carinho", "feliz", "inclinar", 2, "fez cafuné na sua cabeça", ["Hehe... cafuné é bom demais.", "Hmm... continua, só mais um pouquinho.", "Assim eu vou ficar mal acostumada~"], ["Ahh... eu amo quando você faz isso.", "Fica assim comigo um tempinho, vai?"]),
      tocar: R("atencao", "surpresa", "piscar", 0.5, "deu um toquinho na sua cabeça", ["Hm? Que foi?", "Oi, oi! Tô aqui.", "Me chamou?"]),
      tocar2: R("provocacao", "brava", "negar", -0.5, "deu dois tapinhas na sua cabeça", ["Ei! Não sou tambor!", "Para de bater na minha cabeça, hmpf!"]),
      segurar: R("carinho", "timida", "encolher", 1, "ficou com a mão parada na sua cabeça", ["...Sua mão é quentinha.", "Vai ficar com a mão aí, é?"]),
      puxar: R("provocacao", "brava", "tremer", -1, "bagunçou o seu cabelo", ["Ahh, meu cabelo! Demorei pra arrumar!", "Você bagunçou tudo!"]),
    },
    chapeu: {
      tocar: R("atencao", "surpresa", "olhar-em-volta", 0, "mexeu no seu chapéu", ["Cuidado com o chapéu!", "Ei, o chapéu é importante!"]),
      tocar2: R("provocacao", "provocadora", "inclinar", 0, "ficou batendo no seu chapéu", ["Tá curioso com o chapéu, é?", "Quer um igual? Não te dou o meu."]),
      puxar: R("provocacao", "brava", "tremer", -1.5, "tentou puxar o seu chapéu", ["Devolve meu chapéu!!", "Não tira o chapéu! Sem ele eu... ah, deixa pra lá. DEVOLVE!"]),
      carinho: R("carinho", "confusa", "inclinar", 0.5, "fez carinho no seu chapéu", ["Você tá... alisando o chapéu?", "Hehe, o chapéu agradece."]),
      segurar: R("provocacao", "assustada", "encolher", -0.5, "segurou o seu chapéu", ["N-não puxa, tá?", "Segura com cuidado!"]),
    },
    orelhas: {
      tocar: R("atencao", "surpresa", "tremer", 0, "tocou na sua orelha", ["Eep!", "A orelha não, é sensível!"]),
      carinho: R("carinho", "timida", "encolher", 1, "fez carinho na sua orelha", ["Ah... orelha é sensível, sabia?", "Faz cócegas... mas é gostoso."]),
      puxar: R("provocacao", "brava", "tremer", -2, "puxou a sua orelha", ["Ai ai ai! A orelha não!", "Solta! Isso dói, sabia?"]),
      tocar2: R("provocacao", "provocadora", "negar", -0.5, "ficou cutucando a sua orelha", ["Para de cutucar minha orelha!", "Tá achando graça, é?"]),
      segurar: R("provocacao", "timida", "encolher", 0, "segurou a sua orelha", ["V-você vai soltar quando?"]),
    },
    rosto: {
      tocar: R("provocacao", "timida", "desviar", 0, "cutucou a sua bochecha", ["Ficou me cutucando por quê?", "Hm! Minha bochecha não é botão."]),
      tocar2: R("provocacao", "provocadora", "inclinar", 0, "cutucou a sua bochecha duas vezes", ["Cutuca de novo pra você ver...", "Tá se divertindo, né?"]),
      puxar: R("provocacao", "brava", "negar", -1.5, "apertou e puxou a sua bochecha", ["Minhas bochechas não são massinha!", "Aiii, solta minha bochecha!"]),
      carinho: R("carinho", "apaixonada", "inclinar", 2, "fez carinho no seu rosto", ["...Sua mão é quentinha.", "Assim eu fico vermelha..."], ["Eu gosto quando você faz isso.", "Fica mais um pouco..."]),
      segurar: R("carinho", "timida", "desviar", 1, "segurou o seu rosto com carinho", ["O-o que foi? Tem algo no meu rosto?", "Você tá me olhando muito..."]),
    },
    ombros: {
      tocar: R("atencao", "surpresa", "olhar-em-volta", 0.5, "tocou no seu ombro para chamar a atenção", ["Hm? Quer minha atenção?", "Oi! Tô aqui."]),
      tocar2: R("atencao", "feliz", "concordar", 0.5, "deu dois tapinhas no seu ombro", ["Tá, tá, tô ouvindo!", "Que foi, que foi?"]),
      carinho: R("carinho", "feliz", "suspirar", 1.5, "fez massagem no seu ombro", ["Massagem? Pode continuar~", "Ahh... eu tava precisando disso."]),
      segurar: R("carinho", "feliz", "aproximar", 1, "segurou o seu ombro", ["Tô aqui com você.", "Pode se apoiar em mim."]),
      puxar: R("atencao", "confusa", "aproximar", 0, "puxou você pelo braço", ["Pra onde você quer me levar?", "Calma, calma, tô indo!"]),
    },
    maos: {
      tocar: R("atencao", "feliz", "acenar", 0.5, "tocou na sua mão (um 'toca aqui')", ["Toca aqui!", "Hehe, toca aqui!"]),
      tocar2: R("atencao", "animada", "pular", 0.5, "fez um 'toca aqui' duplo com você", ["De novo! Toca aqui!"]),
      segurar: R("carinho", "timida", "desviar", 2, "segurou a sua mão", ["...Pode segurar minha mão, tá?", "Sua mão é maior que a minha..."], ["Não solta, tá?", "Eu gosto de ficar de mãos dadas com você."]),
      carinho: R("carinho", "timida", "encolher", 1.5, "fez carinho na sua mão", ["Hehe... faz cócegas.", "Que mãozinha carinhosa."]),
      puxar: R("atencao", "surpresa", "aproximar", 0, "puxou você pela mão", ["Ei! Aonde a gente vai?", "Tá bom, eu vou junto!"]),
    },
    barriga: {
      tocar: R("cocegas", "rindo", "encolher", 0.5, "cutucou a sua barriga", ["Hihi! Para!", "Ei! Isso faz cócegas!"]),
      tocar2: R("cocegas", "rindo", "tremer", 0.5, "cutucou a sua barriga duas vezes", ["Hahaha, para, para!"]),
      carinho: R("cocegas", "rindo", "tremer", 1, "fez cócegas na sua barriga", ["Hahaha! Cócegas não! Para, para!", "Kkkk eu não aguento! Para!"]),
      segurar: R("cocegas", "rindo", "encolher", 0, "deixou a mão na sua barriga, ameaçando cócegas", ["Nem pense em fazer cócegas!", "Eu sei o que você vai fazer..."]),
      puxar: R("cocegas", "rindo", "tremer", 0, "fez cócegas na sua barriga", ["Hahaha, não!"]),
    },
    pes: {
      tocar: R("cocegas", "rindo", "pular", 0.5, "fez cócegas no seu pé", ["Kyaa! Meus pés não!!", "Hihi, pé tem cócegas!"]),
      carinho: R("cocegas", "rindo", "tremer", 0.5, "fez cócegas nos seus pés", ["Hahaha! Para com isso!", "Não! Os pés não! Kkkk"]),
      puxar: R("provocacao", "assustada", "tremer", -1, "puxou o seu pé", ["Ei! Vou cair!", "Solta meu pé!"]),
      segurar: R("cocegas", "assustada", "encolher", 0, "segurou o seu pé", ["Se fizer cócegas eu chuto, hein!"]),
      tocar2: R("cocegas", "rindo", "pular", 0.5, "fez cócegas no seu pé duas vezes", ["Kkkk para!"]),
    },
  };
  C.REACOES = REACOES;
  C.GESTOS_TOQUE = { tocar: "tocar", tocar2: "tocar duas vezes", segurar: "segurar", carinho: "fazer carinho / esfregar", puxar: "puxar / arrastar" };

  const sorteio = (l) => l[Math.floor(Math.random() * l.length)];
  const historico = []; // [{t, tipo}]

  /**
   * Decide a reação a um toque. afeto: -100..100. Devolve {emocao, gesto, afeto (variação), fala (com marcas), descricao, tipo}.
   */
  C.reagirAoToque = function ({ zona, gesto }, afeto = 0, personalizadas = null) {
    const agora = Date.now();
    const tabela = Object.assign({}, REACOES[zona] || REACOES.ombros, (personalizadas || {})[zona] || {});
    const r = tabela[gesto] || tabela.tocar || REACOES.ombros.tocar;
    while (historico.length && agora - historico[0].t > 30000) historico.shift();
    historico.push({ t: agora, tipo: r.tipo });
    const provocacoes = historico.filter((h) => h.tipo === "provocacao").length;
    const carinhos = historico.filter((h) => h.tipo === "carinho").length;
    let { emocao, afeto: delta } = r;
    let fala = sorteio(afeto >= 50 && r.quente ? r.quente : r.falas);
    let gestoCorpo = r.gesto;
    if (r.tipo === "provocacao" && provocacoes >= 4) {
      emocao = "brava"; delta -= 1.5; gestoCorpo = "negar";
      fala = sorteio(["Tá bom, chega! Assim eu fico brava de verdade.", "Hmpf! Não falo mais com você... por cinco segundos.", "Você não cansa de me provocar, né?!"]);
    } else if (r.tipo === "carinho" && carinhos >= 5) {
      emocao = "apaixonada";
      fala = sorteio(["Você tá cheio de carinho hoje... eu gosto.", "Assim eu me apaixono, hein?", "Hmm... não para não."]);
    } else if (r.tipo === "provocacao" && afeto < -30) {
      emocao = "brava";
      fala = sorteio(["De novo?! Hmpf.", "Você só sabe me provocar."]);
    }
    return { emocao, gesto: gestoCorpo, afeto: delta, fala: `[${emocao}][${gestoCorpo}] ${fala}`, descricao: r.descricao, tipo: r.tipo, provocacoes, carinhos };
  };
})();
