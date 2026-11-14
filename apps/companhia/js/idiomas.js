/*
 * WEBC — idiomas: português, English e 日本語.
 *
 *   - C.t("texto em português", {var}) devolve o texto no idioma escolhido ({var} é trocado pelo valor). O código
 *     novo usa sempre C.t.
 *   - O resto da página é traduzido sozinho: um observador olha cada texto, cada placeholder, title, aria-label e
 *     alt que aparece na página e, se ele está no dicionário (js/textos.js), troca pelo do idioma. Também vale para
 *     textos com partes que mudam (números, nomes), pelos padrões do dicionário. Trocar de idioma traduz de novo o
 *     que já está na tela, sem recarregar.
 *   - O que as pessoas escrevem (nomes de salas, mensagens, bios) não é traduzido: fica dentro de translate="no".
 *
 * O idioma escolhido fica guardado; na primeira vez, vem do navegador (japonês, inglês ou português; outro: inglês).
 */
(function () {
  "use strict";
  const C = (window.C = window.C || {});
  const IDIOMAS = { pt: { nome: "Português", lang: "pt-BR", curto: "PT" }, en: { nome: "English", lang: "en", curto: "EN" }, ja: { nome: "日本語", lang: "ja", curto: "日本語" } };
  const CHAVE = "webc.idioma";
  const ATRIBUTOS = ["placeholder", "title", "aria-label", "alt"];

  function detectar() {
    try { const s = localStorage.getItem(CHAVE); if (IDIOMAS[s]) return s; } catch (e) { /* sem armazenamento */ }
    for (const l of navigator.languages || [navigator.language || ""]) {
      const c = String(l).toLowerCase().slice(0, 2);
      if (IDIOMAS[c]) return c;
    }
    return "en";
  }
  let idioma = detectar();
  const ouvintes = [];
  let mapa = null; // texto em português → [inglês, japonês]

  function dicionario() {
    if (!mapa) {
      mapa = new Map();
      for (const [pt, tr] of Object.entries(C.TEXTOS || {})) mapa.set(pt, tr);
    }
    return mapa;
  }
  /** O texto no idioma (sem as variáveis). null: não está no dicionário. ctx: o contexto (data-ctx de quem está em
   *  volta), para palavras que mudam de sentido: "Entrar" é fazer login, mas no cartão de uma sala é entrar nela. */
  function procurar(pt, ctx) {
    if (idioma === "pt") return pt;
    const k = idioma === "en" ? 0 : 1;
    const tr = (ctx && dicionario().get(ctx + "|" + pt)) || dicionario().get(pt);
    if (tr && tr[k]) return tr[k];
    for (const [re, ...trs] of C.PADROES || []) {
      const m = re.exec(pt);
      if (m) {
        const alvo = trs[k];
        if (!alvo) return null;
        // as partes que mudam podem estar no dicionário também ("{1} pessoas" com "Praça" no meio fica como está)
        return alvo.replace(/\$(\d)/g, (_, i) => { const parte = m[+i] || ""; const t = dicionario().get(parte); return t && t[k] ? t[k] : parte; });
      }
    }
    return null;
  }
  C.t = function (pt, vars) {
    let s = procurar(pt);
    if (s === null) s = pt;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k]))) : s;
  };
  C.IDIOMAS = IDIOMAS;
  Object.defineProperty(C, "idioma", { get: () => idioma });
  C.aoMudarIdioma = (f) => { ouvintes.push(f); return () => { const i = ouvintes.indexOf(f); if (i >= 0) ouvintes.splice(i, 1); }; };

  // ── o tradutor da página ─────────────────────────────────────────────

  // o que a pessoa escreve (o texto de uma caixa de texto) nunca é traduzido; os atributos dela (placeholder...) são
  const protegido = (no) => {
    for (let e = no.nodeType === 1 ? no : no.parentElement; e; e = e.parentElement) {
      if (e === no && e.tagName === "TEXTAREA") continue;
      if (e.getAttribute && e.getAttribute("translate") === "no") return true;
      const t = e.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "TEXTAREA" || t === "CODE" || t === "PRE" || e.isContentEditable) return true;
    }
    return false;
  };
  const contexto = (e) => { const c = e && e.closest && e.closest("[data-ctx]"); return c ? c.dataset.ctx : ""; };
  function traduzirTexto(n) {
    const atual = n.data;
    if (n.__tr !== undefined && atual === n.__tr) return; // é a nossa tradução: nada mudou
    if (!/\S/.test(atual)) return;
    n.__pt = atual; // um texto novo (o app escreveu): este é o original
    const nucleo = atual.trim();
    const tr = idioma === "pt" ? null : procurar(nucleo, contexto(n.parentElement));
    if (tr === null || tr === nucleo) { n.__tr = undefined; return; }
    const ini = atual.indexOf(nucleo);
    n.__tr = atual.slice(0, ini) + tr + atual.slice(ini + nucleo.length);
    n.data = n.__tr;
  }
  function traduzirAtributos(e) {
    for (const a of ATRIBUTOS) {
      if (!e.hasAttribute(a)) continue;
      const v = e.getAttribute(a);
      e.__atrTr = e.__atrTr || {};
      e.__atrPt = e.__atrPt || {};
      if (e.__atrTr[a] !== undefined && v === e.__atrTr[a]) continue;
      e.__atrPt[a] = v;
      const tr = idioma === "pt" || !v ? null : procurar(v.trim(), contexto(e));
      if (tr === null || tr === v) { e.__atrTr[a] = undefined; continue; }
      e.__atrTr[a] = tr;
      e.setAttribute(a, tr);
    }
  }
  function traduzirArvore(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { if (!protegido(raiz)) traduzirTexto(raiz); return; }
    if (raiz.nodeType !== 1 && raiz.nodeType !== 11) return;
    if (raiz.nodeType === 1 && protegido(raiz)) return;
    if (raiz.nodeType === 1) traduzirAtributos(raiz);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && (n.getAttribute("translate") === "no" || /^(SCRIPT|STYLE|CODE|PRE)$/.test(n.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) { if (n.parentElement && n.parentElement.tagName !== "TEXTAREA") traduzirTexto(n); } else traduzirAtributos(n);
    }
  }
  /** Volta tudo ao original (português) e traduz de novo: ao trocar de idioma. */
  function retraduzir() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) { if (n.__pt !== undefined && n.__tr !== undefined && n.data === n.__tr) n.data = n.__pt; n.__tr = undefined; }
      else if (n.__atrPt) { for (const [a, v] of Object.entries(n.__atrPt)) if (n.__atrTr && n.__atrTr[a] !== undefined && n.getAttribute(a) === n.__atrTr[a]) n.setAttribute(a, v); n.__atrTr = {}; }
    }
    traduzirArvore(document.body);
  }
  let observador = null;
  function ligar() {
    if (observador || !document.body) return;
    observador = new MutationObserver((lista) => {
      for (const m of lista) {
        if (m.type === "childList") for (const n of m.addedNodes) traduzirArvore(n);
        else if (m.type === "characterData") { if (!protegido(m.target)) traduzirTexto(m.target); }
        else if (m.type === "attributes" && !protegido(m.target)) traduzirAtributos(m.target);
      }
    });
    observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
    traduzirArvore(document.body);
  }
  /** O título da aba também. */
  let tituloPt = null;
  function traduzirTitulo() {
    if (tituloPt === null || (document.title !== tituloPt && document.title !== C.t(tituloPt))) tituloPt = document.title;
    const alvo = C.t(tituloPt);
    if (document.title !== alvo) document.title = alvo; // só muda se precisar (mudar avisa o observador de novo)
  }

  C.definirIdioma = function (novo) {
    if (!IDIOMAS[novo]) return;
    idioma = novo;
    try { localStorage.setItem(CHAVE, novo); } catch (e) { /* sem armazenamento */ }
    document.documentElement.lang = IDIOMAS[novo].lang;
    document.documentElement.dataset.idioma = novo;
    retraduzir();
    traduzirTitulo();
    for (const f of ouvintes) { try { f(novo); } catch (e) { console.error(e); } }
  };
  document.documentElement.lang = IDIOMAS[idioma].lang;
  document.documentElement.dataset.idioma = idioma;
  if (document.body) ligar(); else document.addEventListener("DOMContentLoaded", ligar);
  new MutationObserver(() => traduzirTitulo()).observe(document.querySelector("title") || document.head, { childList: true, characterData: true, subtree: true });
})();
