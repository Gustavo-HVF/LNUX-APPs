// Ajuda dos testes do WEBC: os menus. No chat bot (modo conversa), a barra de menus do app; no jogo, a janela Opções
// (o ☰), em que os mesmos itens ficam nas seções Personagem, Sala, Ajuda e Gráfico.
const SECAO = { Personagem: "personagem", Movimento: "personagem", Sala: "sala", Conta: "sala", Ajuda: "ajuda", Exibir: "grafico" };
// itens que, no jogo, ficam em outro lugar
const NO_JOGO = { "Cenário (mapa)...": ["grafico", "Luz, sombras e luzes do mapa..."], "Voar, atravessando as paredes (V)": ["sala", "Voar, atravessando as paredes (V)"] };

function menus(pagina) {
  const jogando = () => pagina.evaluate(() => document.documentElement.dataset.modo === "jogar");
  const fecharOpcoes = async () => { if (await pagina.locator(".jogo-opcoes").count()) await pagina.click(".jogo-opcoes-fechar"); };
  const abrirSecao = async (topo, item) => {
    const [secao, rotulo] = NO_JOGO[item] || [SECAO[topo], item];
    await fecharOpcoes();
    await pagina.click("#jogo-menu");
    await pagina.click(`.jogo-opcoes [data-secao="${secao}"]`);
    return pagina.locator(`.jogo-opcoes-lista button:has(.rotulo:text-is("${rotulo}"))`);
  };
  return {
    /** Clica num item (topo › item). No jogo, os que ligam e desligam deixam a janela aberta: ela é fechada depois. */
    async menu(topo, item) {
      if (await jogando()) {
        const b = await abrirSecao(topo, item);
        await b.click();
        await fecharOpcoes();
        return;
      }
      await pagina.click(`.lnux-menubar > button:text-is("${topo}")`);
      await pagina.click(`.lnux-menu button:has(.rotulo:text-is("${item}"))`);
    },
    /** Se o item existe e se está ligado (sem clicar nele). */
    async itemDoMenu(topo, item) {
      if (await jogando()) {
        const b = await abrirSecao(topo, item);
        const r = { existe: (await b.count()) > 0, ativo: (await b.count()) > 0 && !(await b.isDisabled()) };
        await fecharOpcoes();
        return r;
      }
      await pagina.click(`.lnux-menubar > button:text-is("${topo}")`);
      const b = pagina.locator(`.lnux-menu button:has(.rotulo:text-is("${item}"))`);
      const r = { existe: (await b.count()) > 0, ativo: (await b.count()) > 0 && !(await b.isDisabled()) };
      if (await pagina.locator(".lnux-menu").count()) await pagina.click(`.lnux-menubar > button:text-is("${topo}")`);
      return r;
    },
    /** Os nomes do que está no topo: os menus (chat bot) ou as seções da janela Opções (jogo). */
    async topo() {
      if (await jogando()) {
        await fecharOpcoes();
        await pagina.click("#jogo-menu");
        const s = await pagina.locator(".jogo-opcoes [data-secao]").evaluateAll((l) => l.map((b) => b.dataset.secao));
        await fecharOpcoes();
        return s;
      }
      return pagina.locator(".lnux-menubar > button").allTextContents();
    },
    fecharOpcoes,
  };
}
/** Quem joga sem conta já tem o nome guardado (como quem já passou pela tela de entrar). */
const nomeGuardado = (contexto, nome) => contexto.addInitScript((n) => { try { if (!localStorage.getItem("companhia.sala-nome")) localStorage.setItem("companhia.sala-nome", n); } catch (e) { /* sem armazenamento */ } }, nome);

module.exports = { menus, nomeGuardado };
