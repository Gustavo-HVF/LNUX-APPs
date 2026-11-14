/*
 * WEBC — temas: o do WEBC (preto e branco) e os mesmos temas do VLC-Web (cores, papel de parede, efeitos de fundo e
 * fontes), em temas/vlc-web-temas.css. O tema fica no <html data-skin="..."> e as cores do app (as do LNUX e as do
 * WEBC) passam a vir dele (companhia.css). A paleta (o botão no alto) abre a galeria.
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const { el } = LNUX;
  const CHAVE = "webc.tema";
  // id, [nome em pt, en, ja], base (claro/escuro), cor da amostra, fontes do Google Fonts (só quando o tema é usado)
  const TEMAS = [
    ["webc", ["WEBC (preto e branco)", "WEBC (black and white)", "WEBC（白黒）"], "light", "#000000", "Lato:wght@400;700;900"],
    ["default", ["VLC Web escuro", "VLC Web dark", "VLC Web ダーク"], "dark", "#17181b"],
    ["light", ["VLC Web claro", "VLC Web light", "VLC Web ライト"], "light", "#eceef1"],
    ["glass", ["Vidro (Glassmorphism)", "Glass (glassmorphism)", "ガラス（グラスモーフィズム）"], "dark", "#1d1b4b"],
    ["aero", ["Frutiger Aero", "Frutiger Aero", "フルティガーエアロ"], "light", "#2f9fe6", "Nunito:wght@400;600;700"],
    ["dreamcore", ["Dreamcore", "Dreamcore", "ドリームコア"], "light", "#ffd1f0", "Quicksand:wght@400;500;600;700"],
    ["vaporwave", ["Vaporwave", "Vaporwave", "ヴェイパーウェイヴ"], "dark", "#4b1d6e"],
    ["synthwave", ["Synthwave (Outrun)", "Synthwave (Outrun)", "シンセウェイヴ（アウトラン）"], "dark", "#120022", "Orbitron:wght@500;700"],
    ["cyberpunk", ["Cyberpunk", "Cyberpunk", "サイバーパンク"], "dark", "#0b0b0f", "Share+Tech+Mono"],
    ["y2k", ["Y2K cromado", "Chrome Y2K", "Y2K クローム"], "light", "#dfe3ea"],
    ["aluminum", ["Alumínio escovado", "Brushed aluminum", "ヘアライン加工アルミ"], "light", "#c9ccd1"],
    ["neumorphism", ["Neumorfismo", "Neumorphism", "ニューモーフィズム"], "light", "#e0e5ec"],
    ["material", ["Material You", "Material You", "Material You"], "light", "#fdf8fd", "Roboto:wght@400;500;700"],
    ["acrylic", ["Acrílico (Fluent)", "Acrylic (Fluent)", "アクリル（Fluent）"], "dark", "#101418"],
    ["brutalism", ["Neobrutalismo", "Neubrutalism", "ネオブルータリズム"], "light", "#fff6dc", "Space+Grotesk:wght@400;500;700"],
    ["terminal", ["Terminal (fósforo verde)", "Terminal (green phosphor)", "ターミナル（緑の蛍光）"], "dark", "#000000", "VT323"],
    ["pixel", ["8-bit (pixel art)", "8-bit (pixel art)", "8ビット（ドット絵）"], "dark", "#1b1b3a", "Press+Start+2P"],
    ["cottagecore", ["Cottagecore", "Cottagecore", "コテージコア"], "light", "#f6efe2", "Lora:wght@400;600;700"],
    ["cafe", ["Lo-fi café", "Lo-fi café", "ローファイ・カフェ"], "dark", "#241914", "Nunito:wght@400;600;700"],
    ["ocean", ["Oceano profundo", "Deep ocean", "深海"], "dark", "#021526"],
    ["forest", ["Floresta", "Forest", "森"], "dark", "#0d1b14"],
    ["sunset", ["Pôr do sol", "Sunset", "夕焼け"], "dark", "#7b2ff7"],
    ["sakura", ["Sakura", "Sakura", "桜"], "light", "#fff0f5", "Nunito:wght@400;600;700"],
    ["galaxy", ["Galáxia", "Galaxy", "銀河"], "dark", "#05030f"],
    ["nord", ["Nórdico (Nord)", "Nord", "ノルド"], "dark", "#2e3440"],
    ["dracula", ["Drácula", "Dracula", "ドラキュラ"], "dark", "#282a36"],
    ["solarized", ["Solarizado claro", "Solarized light", "ソラライズド・ライト"], "light", "#fdf6e3"],
    ["contrast", ["Alto contraste", "High contrast", "ハイコントラスト"], "dark", "#000000"],
    ["amoled", ["AMOLED (preto puro)", "AMOLED (pure black)", "AMOLED（純黒）"], "dark", "#000000"],
    ["web1", ["Retrô 95 (Web 1.0)", "Retro 95 (Web 1.0)", "レトロ95（Web 1.0）"], "light", "#008080"],
    ["liminal", ["Liminal (Backrooms)", "Liminal (Backrooms)", "リミナル（バックルーム）"], "light", "#cdbd73"],
    ["steampunk", ["Steampunk", "Steampunk", "スチームパンク"], "dark", "#2a1d14", "Cinzel:wght@500;700"],
  ].map(([id, nomes, base, cor, fontes]) => ({ id, nomes, base, cor, fontes }));

  const nomeDo = (t) => t.nomes[{ pt: 0, en: 1, ja: 2 }[C.idioma || "pt"] || 0];
  const lerTema = () => { try { const v = localStorage.getItem(CHAVE); if (TEMAS.some((t) => t.id === v)) return v; } catch (e) { /* sem armazenamento */ } return "webc"; };

  /** O efeito de fundo dos temas (bolhas, estrelas, grade...): a camada #skin-fx do VLC-Web. */
  function garantirEfeitos() {
    if (!document.getElementById("skin-fx")) document.body.prepend(el("div", { id: "skin-fx", "aria-hidden": "true" }));
  }
  const fontesCarregadas = new Set();
  function carregarFontes(t) {
    if (!t.fontes || fontesCarregadas.has(t.fontes)) return;
    fontesCarregadas.add(t.fontes);
    document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${t.fontes}&display=swap` }));
  }
  C.temas = {
    TEMAS,
    get atual() { return lerTema(); },
    nome: nomeDo,
    aplicar(id = lerTema()) {
      const t = TEMAS.find((x) => x.id === id) || TEMAS[0];
      const raiz = document.documentElement;
      raiz.dataset.skin = t.id;
      raiz.dataset.tema = t.base === "light" ? "claro" : "escuro"; // as cores do LNUX seguem (claro ou escuro) e o tema por cima
      raiz.style.colorScheme = t.base;
      LNUX.preferencia.gravar("lnux.tema", t.base === "light" ? "claro" : "escuro"); // o LNUX segue o claro ou escuro do tema
      carregarFontes(t);
      if (document.body) garantirEfeitos(); else document.addEventListener("DOMContentLoaded", garantirEfeitos, { once: true });
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = t.cor;
      return t;
    },
    definir(id) {
      try { localStorage.setItem(CHAVE, id); } catch (e) { /* sem armazenamento */ }
      LNUX.preferencia.gravar("lnux.tema", TEMAS.find((x) => x.id === id) && TEMAS.find((x) => x.id === id).base === "light" ? "claro" : "escuro");
      return this.aplicar(id);
    },
  };

  /** O ícone da paleta (em SVG, sem emoji). */
  C.iconePaleta = (tam = 22) => {
    const s = el("span", { class: "icone-paleta", "aria-hidden": "true" });
    s.innerHTML = `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">` +
      '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/>' +
      '<circle cx="7.5" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="14.5" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="17.3" cy="10.6" r="1.4" fill="currentColor" stroke="none"/></svg>';
    return s;
  };

  /** A galeria de temas (abre embaixo do botão que pediu). */
  C.escolherTema = function (botao) {
    const velho = document.querySelector(".galeria-temas");
    if (velho) { velho.remove(); return; }
    const atual = lerTema();
    const lista = el("div", { class: "galeria-temas", role: "listbox", "aria-label": C.t("Temas") },
      el("div", { class: "galeria-titulo" }, C.iconePaleta(18), el("b", {}, C.t("Temas")), el("span", { class: "fraco pequeno" }, C.t("os mesmos do VLC-Web"))),
      el("div", { class: "galeria-grade" }, TEMAS.map((t) => el("button", { type: "button", role: "option", class: "tema-opcao" + (t.id === atual ? " ativo" : ""), "aria-selected": String(t.id === atual), "data-tema": t.id,
        onclick: () => { C.temas.definir(t.id); fechar(); } },
      el("span", { class: "amostra-tema", "data-skin": t.id, "aria-hidden": "true" }, el("span", { class: "amostra-painel" }), el("span", { class: "amostra-destaque" })),
      el("span", { class: "nome-tema" }, nomeDo(t))))));
    document.body.append(lista);
    const r = botao.getBoundingClientRect();
    lista.style.top = Math.round(r.bottom + 8) + "px";
    lista.style.right = Math.max(8, Math.round(innerWidth - r.right)) + "px";
    const fora = (e) => { if (!lista.contains(e.target) && !botao.contains(e.target)) fechar(); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    function fechar() { lista.remove(); document.removeEventListener("pointerdown", fora, true); document.removeEventListener("keydown", tecla); }
    setTimeout(() => { document.addEventListener("pointerdown", fora, true); document.addEventListener("keydown", tecla); }, 0);
    const ativo = lista.querySelector(".ativo");
    if (ativo) ativo.focus();
  };
  C.temas.aplicar();

  /** Tira a tela de abertura do WEBC (data-carregando): quando a tela de entrar, o site ou o chat bot já estão prontos.
   *  Até lá, o layout do app (o do chat bot) não aparece. */
  C.paginaPronta = () => {
    const raiz = document.documentElement;
    if (!("carregando" in raiz.dataset)) return;
    delete raiz.dataset.carregando;
    const abrindo = document.querySelector(".webc-abrindo");
    if (abrindo) { abrindo.classList.add("saindo"); setTimeout(() => abrindo.remove(), 400); }
  };
  setTimeout(C.paginaPronta, 15000); // se algo der errado, não fica preso na abertura
})();
