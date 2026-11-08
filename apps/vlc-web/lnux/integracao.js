/*
 * VLC Web no LNUX-APPs — integração com a ponte local (servidor/lnux_apps.py).
 *
 * O VLC Web vem do repositório próprio dele (github.com/Gustavo-HVF/VLC-WEB), copiado sem mudanças por
 * tools/importar_vlc_web.py. Este arquivo só ACRESCENTA, por cima da API do app (VW.app):
 *  · Mídia › Abrir das pastas do aparelho: navega nas pastas liberadas e toca direto do aparelho, sem copiar
 *    nada para o navegador (o servidor atende pedidos parciais, então dá para avançar em filmes grandes); as
 *    legendas com o mesmo nome entram junto; listas .m3u/.pls/.xspf da pasta também abrem;
 *  · o que o navegador não toca (AVI, WMV, MPEG-2, MKV com HEVC ou som AC-3/DTS...), as outras faixas de áudio
 *    e as legendas embutidas: o ffmpeg do aparelho prepara, em vez do FFmpeg WebAssembly (que baixa ~31 MB
 *    e precisa caber na memória do navegador);
 *  · Mídia › Converter pelo ffmpeg do aparelho;
 *  · salvar capturas, gravações, conversões, legendas e listas direto numa pasta do aparelho;
 *  · na primeira vez, o tema segue o do LNUX-APPs; Mídia › Todos os apps volta para a página inicial.
 * Sem a ponte (página aberta fora do LNUX), só o "Todos os apps" e o tema aparecem: o resto do VLC Web
 * funciona como sempre.
 */
(function (VW) {
  'use strict';
  const U = VW.util, el = U.el;
  const L = window.LNUX;
  if (!U || !L) return;
  const P = L.ponte;

  // ── Tema: na primeira vez, segue o tema escolhido no LNUX-APPs ─────────
  (function temaInicial() {
    const ajustes = U.store.get('settings', {}) || {};
    if (ajustes.skin) return; // a pessoa já escolheu um tema no VLC Web
    const lnux = L.preferencia.ler('lnux.tema', 'sistema');
    const skin = { sistema: 'auto', escuro: 'default', claro: 'light', sepia: 'cafe', oceano: 'ocean', contraste: 'contrast' }[lnux];
    if (!skin) return;
    ajustes.skin = skin;
    U.store.set('settings', ajustes);
    if (skin !== 'auto') document.documentElement.setAttribute('data-skin', skin);
  })();

  // ── Pedidos aos arquivos do aparelho levam a chave da ponte ─────────────
  // O VLC Web lê os metadados (faixas, capítulos) por pedidos parciais feitos sem cookie (credentials: "omit");
  // nos endereços da própria ponte, a chave vai no cabeçalho (os de outros sites não mudam).
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function (entrada, init) {
    try {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada && entrada.url;
      if (P._token && url && caminhoDaUrl(url) !== null) {
        init = Object.assign({}, init);
        const h = new Headers(init.headers || (entrada instanceof Request ? entrada.headers : undefined));
        if (!h.has('X-Ponte-Token')) h.set('X-Ponte-Token', P._token);
        init.headers = h;
      }
    } catch (e) { /* segue sem a chave */ }
    return fetchOriginal(entrada, init);
  };

  // ── Endereços da ponte ─────────────────────────────────────────────────
  const nomeDe = (caminho) => String(caminho).split('/').filter(Boolean).pop() || caminho;
  const pastaDe = (caminho) => String(caminho).replace(/\/[^/]*\/?$/, '') || '/';
  const juntar = (pasta, nome) => pasta.replace(/\/$/, '') + '/' + nome;
  /** URL absoluta de um arquivo do aparelho (o filename= dá o nome certo ao VLC Web). */
  const urlDe = (caminho, nome) => location.origin + P.url(caminho) + '&filename=' + encodeURIComponent(nome || nomeDe(caminho));
  function caminhoDaUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname === '/api/arquivo') return u.searchParams.get('caminho');
    } catch (e) { /* não é endereço */ }
    return null;
  }
  const original = new WeakMap(); // item → caminho do arquivo original (quando o item toca uma versão convertida)
  const caminhoDe = (item) => (item && (original.get(item) || (item.url && caminhoDaUrl(item.url)))) || null;
  const temFfmpeg = () => P.disponivel && P.tem('ffmpeg') && P.tem('ffprobe');

  const infos = new Map();
  /** Faixas do arquivo (ffprobe na ponte), guardadas por caminho. */
  async function infoDe(caminho) {
    if (!infos.has(caminho)) infos.set(caminho, P.midia(caminho).catch((e) => { infos.delete(caminho); throw e; }));
    return infos.get(caminho);
  }
  /** As faixas no formato que o VLC Web usa em item.probe (menu Áudio › Faixa de áudio). */
  function probeDe(info) {
    return {
      duration: info.duracao,
      streams: [
        ...(info.video ? [{ type: 'video', codec: info.video.codec }] : []),
        ...(info.audios || []).map((a) => ({ type: 'audio', codec: a.codec, lang: a.idioma || '', title: a.titulo || '', layout: a.canais, default: a.padrao, sampleRate: 0 })),
      ],
    };
  }
  const faixaPadrao = (info) => Math.max(0, (info.audios || []).findIndex((a) => a.padrao));

  // ── Conversões no ffmpeg do aparelho (com a barra de progresso do VLC Web) ──
  let tarefa = null; // AbortController da conversão em andamento
  const prontos = new Map(); // "caminho|perfil|faixa" → saída (não converte duas vezes o mesmo)
  async function converter(caminho, perfil, opcoes, rotulo) {
    const chave = `${caminho}|${perfil}|${JSON.stringify(opcoes || {})}`;
    if (prontos.has(chave)) return prontos.get(chave);
    const app = VW.app;
    const ctrl = new AbortController();
    tarefa = ctrl;
    app.player.emit('ffmpeg-progress', { p: -1, label: rotulo + ' (ffmpeg do aparelho)…' });
    try {
      const r = await P.converter({ entrada: caminho, perfil, opcoes }, (f) => app.player.emit('ffmpeg-progress', { p: f > 0 ? f : -1, label: rotulo + ' (ffmpeg do aparelho)' }), ctrl.signal);
      prontos.set(chave, r.saida);
      return r.saida;
    } finally {
      if (tarefa === ctrl) tarefa = null;
      app.player.emit('ffmpeg-progress', null);
    }
  }

  // Formatos que o navegador nunca abre: o ffmpeg do aparelho prepara antes de tentar tocar
  const EXT_DIFICEIS = new Set(['avi', 'divx', 'xvid', 'wmv', 'asf', 'flv', 'mpg', 'mpeg', 'm2v', 'vob', 'ts', 'm2ts', 'mts', 'rm', 'rmvb',
    'wma', 'ape', 'ac3', 'eac3', 'dts', 'amr', 'ra', 'au', 'mpc', 'wv', 'tta']);
  /** A imagem deste codec toca no navegador? (HEVC depende do aparelho) */
  function videoTocavel(codec) {
    if (['h264', 'vp8', 'vp9', 'av1'].includes(codec)) return true;
    if (codec === 'hevc') { try { return !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'); } catch (e) { return false; } }
    return false;
  }
  /** Antes de abrir um arquivo do aparelho: precisa do ffmpeg? (extensão difícil ou imagem em codec que não toca) */
  async function precisaPreparar(caminho) {
    const ext = U.ext(nomeDe(caminho));
    if (EXT_DIFICEIS.has(ext)) return true;
    if (!['mkv', 'mp4', 'm4v', 'mov', 'webm', '3gp', 'ogv'].includes(ext)) return false;
    try { const info = await infoDe(caminho); return !!(info.video && !videoTocavel(info.video.codec)); } catch (e) { return false; }
  }

  /** Prepara para tocar um arquivo do aparelho que o navegador não abre (imagem ou som). */
  async function prepararPelaPonte(item, opts = {}) {
    const app = VW.app, p = app.player;
    const caminho = caminhoDe(item);
    const resumeAt = opts.resumeAt ?? (p.item === item ? p.currentTime : 0);
    try {
      const info = await infoDe(caminho);
      if (!info.video && !(info.audios || []).length) throw new Error('o arquivo não tem imagem nem som que o ffmpeg reconheça');
      item.probe = probeDe(info);
      // a imagem já toca e só o som não sai: prepara só a faixa de áudio (bem mais rápido)
      if (opts.audioOnly && p.item === item && p.state !== 'error' && (info.audios || []).length) {
        await faixaPelaPonte(item, opts.audioIndex ?? faixaPadrao(info));
        return;
      }
      if ((p.item === item || opts.abrir) && p.media) p.media.pause();
      const faixa = opts.audioIndex ?? faixaPadrao(info);
      // H.264/HEVC/VP9/AV1: só troca o "envelope" e converte o som (segundos); o resto converte a imagem também
      const video = info.video && info.video.codec;
      const copiar = !video || ['h264', 'hevc', 'vp9', 'av1'].includes(video);
      let saida;
      try {
        saida = await converter(caminho, copiar ? 'tocar-copia' : 'tocar', { faixa }, copiar ? 'Preparando para tocar' : 'Convertendo para tocar');
      } catch (e) {
        if (!copiar || /cancelad/i.test(e.message)) throw e;
        saida = await converter(caminho, 'tocar', { faixa }, 'Convertendo para tocar'); // o MP4 não aceitou a cópia
      }
      original.set(item, caminho);
      item.url = urlDe(saida, U.stripExt(nomeDe(caminho)) + (info.video ? '.mp4' : '.m4a'));
      item.info = null; item.remote = null; item.audioCache = {}; item.audioIndex = null;
      item.probe = probeDe(info);
      if (opts.abrir || !p.item || p.item === item) p.open(item, { startTime: resumeAt, autoplay: opts.autoplay ?? true });
      p.emit('osd', 'Pronto: tocando o que o ffmpeg do aparelho preparou');
      VW.log.info('lnux', `Preparado pela ponte (${copiar ? 'cópia da imagem' : 'conversão completa'}): ${caminho}`);
    } catch (e) {
      if (/cancelad/i.test(e.message || '')) { p.emit('osd', 'Conversão cancelada'); return; }
      p.fail('ffmpeg do aparelho: ' + (e.message || e));
    }
  }

  /** Outra faixa de áudio do arquivo original: o ffmpeg do aparelho separa e ela toca junto com o vídeo. */
  async function faixaPelaPonte(item, i) {
    const p = VW.app.player;
    const caminho = caminhoDe(item);
    try {
      const info = await infoDe(caminho);
      item.probe = item.probe || probeDe(info);
      const a = (info.audios || [])[i] || {};
      const saida = await converter(caminho, 'faixa-audio', { faixa: i }, `Separando a faixa de áudio ${i + 1}${a.idioma ? ' (' + U.langName(a.idioma) + ')' : ''}`);
      if (p.item !== item) return false;
      item.audioCache = item.audioCache || {};
      item.audioCache[i] = urlDe(saida, `faixa-${i + 1}.m4a`);
      item.audioIndex = i;
      p.suggested = true; // o problema de som (se havia) foi resolvido
      p.startSlave(item.audioCache[i], 'track');
      p.emit('osd', `Faixa de áudio ${i + 1}${a.idioma ? ' — ' + U.langName(a.idioma) : ''}`);
      p.emit('tracks');
      return true;
    } catch (e) {
      if (!/cancelad/i.test(e.message || '')) p.emit('error', 'Não foi possível preparar a faixa de áudio: ' + (e.message || e));
      return false;
    }
  }

  /** Legenda embutida (texto) → WebVTT pelo ffmpeg do aparelho → entra como legenda do item. */
  async function legendaEmbutida(item, leg) {
    const p = VW.app.player;
    try {
      const saida = await converter(caminhoDe(item), 'legenda-vtt', { faixa: leg.indice }, 'Separando a legenda');
      const texto = await P.ler(saida, 'texto');
      const nome = `${U.stripExt(nomeDe(caminhoDe(item)))}.${leg.idioma || 'faixa' + (leg.indice + 1)}.vtt`;
      const arquivo = new File([texto], nome, { type: 'text/vtt' });
      if (leg.titulo) arquivo._label = leg.titulo;
      if (leg.idioma) arquivo._lang = leg.idioma;
      if (p.item !== item) return;
      await p.addSubtitleFile(arquivo);
      p.emit('osd', 'Legenda: ' + (leg.titulo || U.langName(leg.idioma || '') || 'faixa ' + (leg.indice + 1)));
    } catch (e) {
      if (!/cancelad/i.test(e.message || '')) VW.app.error('Não foi possível separar a legenda: ' + (e.message || e));
    }
  }

  // ── Salvar no aparelho ──────────────────────────────────────────────────
  const baixarPeloNavegador = U.download;
  function pastaPadrao(nome) {
    const pastas = (P.estado && P.estado.pastas) || {};
    const k = U.kindOf(nome);
    const pref = { image: ['Imagens', 'Câmera'], video: ['Vídeos'], audio: ['Músicas'] }[k] || ['Downloads'];
    for (const p of [...pref, 'Downloads', 'Documentos']) if (pastas[p]) return pastas[p];
    return U.store.get('lnux-salvar', '') || (P.estado && P.estado.home) || '~';
  }
  function salvarNoAparelho(blob, nomeSugerido) {
    const W = VW.ui.Win, F = VW.ui.F;
    const pastas = Object.entries((P.estado && P.estado.pastas) || {});
    const nome = F.text(String(nomeSugerido || 'arquivo').replace(/[\\/:*?"<>|]/g, '_'), null, { 'aria-label': 'Nome do arquivo' });
    const pasta = F.text(U.store.get('lnux-salvar-' + (U.kindOf(nomeSugerido) || 'outro'), '') || pastaPadrao(nomeSugerido), null, { 'aria-label': 'Pasta' });
    const atalhos = el('div', { class: 'lnux-atalhos' }, ...pastas.map(([rot, c]) => F.button(rot, () => { pasta.value = c; }, 'small')));
    const w = new W({ title: 'Salvar', icon: 'save', modal: true, width: 520, className: 'lnux-salvar' });
    w.body.append(F.row('Nome', nome), F.row('Pasta', pasta), atalhos,
      el('p', { class: 'f-hint' }, `${U.fmtBytes(blob.size)} · vai direto para a pasta do aparelho (pela ponte do LNUX).`));
    const salvar = async (sobrescrever) => {
      const destino = juntar(pasta.value.trim() || pastaPadrao(nomeSugerido), nome.value.trim() || nomeSugerido);
      try {
        await P.gravar(destino, blob, { sobrescrever });
        U.store.set('lnux-salvar-' + (U.kindOf(nomeSugerido) || 'outro'), pastaDe(destino));
        w.close();
        VW.app.notify('Salvo em ' + destino, [['Mostrar na pasta', () => abrirPastas(pastaDe(destino))]], { icon: 'save', timeout: 7000 });
      } catch (e) {
        if (e.status === 409 && !sobrescrever) {
          const r = await F.message('Substituir?', `Já existe <b>${U.escapeHtml(destino)}</b>. Substituir pelo novo?`, [['sim', 'Substituir'], ['nao', 'Cancelar']]);
          if (r === 'sim') salvar(true);
          return;
        }
        VW.app.error('Não deu para salvar: ' + e.message);
      }
    };
    nome.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(false); });
    w.footer.append(F.button('Baixar pelo navegador', () => { w.close(); baixarPeloNavegador(blob, nome.value || nomeSugerido); }),
      F.button('Cancelar', () => w.close()), F.button('Salvar no aparelho', () => salvar(false), 'primary'));
    w.show();
    setTimeout(() => { nome.focus(); nome.setSelectionRange(0, Math.max(0, nome.value.lastIndexOf('.'))); }, 50);
  }

  // ── Pastas do aparelho ──────────────────────────────────────────────────

  /** Itens de lista de reprodução para arquivos do aparelho (com as legendas de mesmo nome da pasta). */
  async function entradasDe(arquivos, vizinhos) {
    const legendas = vizinhos.filter((i) => i.tipo !== 'pasta' && U.isSubtitleFile(i.nome));
    const saida = [];
    for (const a of [...arquivos].sort((x, y) => U.naturalCompare(x.nome, y.nome))) {
      const kind = U.kindOf(a.nome);
      if (kind === 'playlist') { saida.push(...(await listaDoAparelho(a))); continue; }
      if (!['video', 'audio', 'image'].includes(kind)) continue;
      const minhas = VW.app.settings.get('subsAutoload') ? legendas.filter((s) => VW.subtitles.matchesMedia(s.nome, a.nome)) : [];
      const subs = [];
      for (const s of minhas) {
        try { subs.push(new File([await P.ler(s.caminho, 'blob')], s.nome)); } catch (e) { VW.log.warn('lnux', `Legenda ${s.nome}: ${e.message}`); }
      }
      saida.push({ url: urlDe(a.caminho), title: U.stripExt(a.nome), subs });
    }
    return saida;
  }
  /** .m3u/.pls/.xspf do aparelho: os caminhos relativos apontam para a mesma pasta. */
  async function listaDoAparelho(a) {
    const texto = await P.ler(a.caminho, 'texto');
    const pasta = pastaDe(a.caminho);
    return VW.playlistFormats.parse(texto, a.nome).map((e) => {
      const loc = String(e.location || '').trim();
      if (/^[a-z][a-z0-9+.-]+:\/\//i.test(loc) && !/^file:/i.test(loc)) return { url: loc, title: e.title, duration: e.duration };
      let c = decodeURIComponent(loc.replace(/^file:\/+/i, '/')).replace(/\\/g, '/');
      if (!c.startsWith('/')) c = juntar(pasta, c);
      return { url: urlDe(c), title: e.title || U.stripExt(nomeDe(c)), duration: e.duration };
    });
  }
  async function tocarDoAparelho(arquivos, vizinhos, play = true) {
    const app = VW.app, p = app.player;
    // só legendas, com algo tocando: entram como legenda do que está tocando
    if (arquivos.length && arquivos.every((a) => U.isSubtitleFile(a.nome)) && p.item) {
      for (const s of arquivos) await p.addSubtitleFile(new File([await P.ler(s.caminho, 'blob')], s.nome));
      return;
    }
    const entradas = await entradasDe(arquivos, vizinhos);
    if (!entradas.length) { app.error('Nenhuma mídia entre os arquivos escolhidos.'); return; }
    const itens = p.enqueue(entradas, { play });
    app.controls.osd(play ? `Tocando ${itens.length > 1 ? itens.length + ' itens' : '"' + itens[0].title + '"'}` : `${itens.length} item(ns) na lista`);
  }

  function abrirPastas(inicio) {
    const W = VW.ui.Win, F = VW.ui.F;
    const existente = W.get('lnux-pastas');
    if (existente) { existente.focus(); if (inicio) existente.ir(inicio); return; }
    const estado = P.estado || {};
    let atual = inicio || U.store.get('lnux-pasta', '') || (estado.pastas && (estado.pastas['Vídeos'] || estado.pastas['Músicas'])) || estado.home || '~';
    let itens = [], ocultos = false, todos = false, pedido = 0, ultimo = -1;
    const escolhidos = new Set();
    const campo = F.text('', null, { 'aria-label': 'Pasta', class: 'lnux-caminho' });
    const lista = el('div', { class: 'lnux-lista', role: 'listbox', 'aria-multiselectable': 'true', tabindex: '0', 'aria-label': 'Arquivos' });
    const rodape = el('span', { class: 'lnux-info' });
    const w = new W({ title: 'Pastas do aparelho', icon: 'folder', width: 680, height: 560, modal: true, className: 'lnux-pastas' });
    const visiveis = () => itens.filter((i) => i.tipo === 'pasta' || todos || ['video', 'audio', 'image', 'sub', 'playlist'].includes(U.kindOf(i.nome)));
    const arquivosEscolhidos = () => itens.filter((i) => escolhidos.has(i.caminho));
    async function ir(caminho) {
      const meu = ++pedido;
      lista.classList.add('carregando');
      try {
        const r = await P.listar(caminho, ocultos);
        if (meu !== pedido) return;
        atual = r.caminho; itens = r.itens; escolhidos.clear(); ultimo = -1;
        campo.value = atual;
        U.store.set('lnux-pasta', atual);
        desenhar();
      } catch (e) { VW.app.error(e.message); }
      finally { if (meu === pedido) lista.classList.remove('carregando'); }
    }
    w.ir = ir;
    function desenhar() {
      const vis = visiveis();
      const linhas = [];
      if (atual !== '/') linhas.push(el('div', { class: 'lnux-item pasta', role: 'option', onclick: () => ir(pastaDe(atual)) }, U.icon('folder'), el('span', { class: 'n' }, '..'), el('span', { class: 't' }, 'pasta de cima')));
      vis.forEach((it, i) => {
        const pasta = it.tipo === 'pasta', kind = U.kindOf(it.nome);
        const ic = pasta ? 'folder' : { video: 'film', audio: 'music', image: 'image', sub: 'subtitle', playlist: 'playlist' }[kind] || 'file';
        const linha = el('div', { class: 'lnux-item' + (pasta ? ' pasta' : '') + (escolhidos.has(it.caminho) ? ' sel' : ''), role: 'option', 'aria-selected': String(escolhidos.has(it.caminho)), title: it.nome },
          U.icon(ic), el('span', { class: 'n' }, it.nome), el('span', { class: 't' }, pasta ? '' : U.fmtBytes(it.tamanho)));
        linha.addEventListener('click', (e) => {
          if (pasta) { ir(it.caminho); return; }
          if (e.shiftKey && ultimo >= 0) { const [a, b] = [Math.min(ultimo, i), Math.max(ultimo, i)]; for (let k = a; k <= b; k++) if (vis[k].tipo !== 'pasta') escolhidos.add(vis[k].caminho); }
          else if (e.ctrlKey || e.metaKey) { escolhidos.has(it.caminho) ? escolhidos.delete(it.caminho) : escolhidos.add(it.caminho); }
          else { escolhidos.clear(); escolhidos.add(it.caminho); }
          ultimo = i;
          desenhar();
        });
        linha.addEventListener('dblclick', () => { if (!pasta) { tocarDoAparelho([it], itens, true); w.close(); } });
        linhas.push(linha);
      });
      if (!vis.length) linhas.push(el('div', { class: 'lnux-vazio' }, todos ? '(pasta vazia)' : '(nenhuma mídia aqui — marque "Todos os arquivos" para ver o resto)'));
      lista.replaceChildren(...linhas);
      const n = arquivosEscolhidos().length, midias = vis.filter((i) => ['video', 'audio', 'image'].includes(U.kindOf(i.nome))).length;
      rodape.textContent = n ? `${n} escolhido(s)` : `${midias} mídia(s) nesta pasta`;
    }
    lista.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && arquivosEscolhidos().length) { e.preventDefault(); tocarDoAparelho(arquivosEscolhidos(), itens, true); w.close(); }
      if (e.key === 'Backspace') { e.preventDefault(); ir(pastaDe(atual)); }
    });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ir(campo.value.trim()); } });
    const atalhos = el('div', { class: 'lnux-atalhos' }, ...Object.entries(estado.pastas || {}).map(([rot, c]) => F.button(rot, () => ir(c), 'small')));
    const opcoes = el('div', { class: 'lnux-opcoes' },
      el('label', {}, el('input', { type: 'checkbox', onchange: (e) => { todos = e.target.checked; desenhar(); } }), ' Todos os arquivos'),
      el('label', {}, el('input', { type: 'checkbox', onchange: (e) => { ocultos = e.target.checked; ir(atual); } }), ' Ocultos'));
    w.body.append(el('div', { class: 'lnux-barra' }, F.button('↑', () => ir(pastaDe(atual)), 'small', { title: 'Pasta de cima', 'aria-label': 'Pasta de cima' }), campo, F.button('Ir', () => ir(campo.value.trim()), 'small')),
      atalhos, lista, el('div', { class: 'lnux-pe' }, rodape, opcoes));
    const tocarPasta = (play) => {
      const midias = itens.filter((i) => i.tipo !== 'pasta' && ['video', 'audio', 'image'].includes(U.kindOf(i.nome)));
      if (!midias.length) { VW.app.error('Nenhuma mídia nesta pasta.'); return; }
      tocarDoAparelho(midias, itens, play); w.close();
    };
    const usarEscolhidos = (play) => {
      const a = arquivosEscolhidos();
      if (!a.length) { VW.app.controls.osd('Escolha um ou mais arquivos (Ctrl ou Shift para vários)'); return; }
      tocarDoAparelho(a, itens, play); w.close();
    };
    w.footer.append(F.button('Tocar a pasta toda', () => tocarPasta(true)), F.button('Adicionar à lista', () => usarEscolhidos(false)), F.button('Tocar', () => usarEscolhidos(true), 'primary'));
    W.open('lnux-pastas', () => w);
    ir(atual);
    setTimeout(() => lista.focus({ preventScroll: true }), 60);
  }

  // ── Converter pelo ffmpeg do aparelho ───────────────────────────────────
  const PERFIS = [
    ['tocar-copia', 'MP4 rápido (copia a imagem, som em AAC)', 'mp4'], ['mp4', 'MP4 (H.264 + AAC)', 'mp4'], ['webm', 'WebM (VP9 + Opus)', 'webm'],
    ['mp3', 'MP3 (só o som)', 'mp3'], ['m4a', 'M4A / AAC (só o som)', 'm4a'], ['ogg', 'OGG Vorbis (só o som)', 'ogg'], ['opus', 'Opus (só o som)', 'opus'],
    ['flac', 'FLAC (som sem perdas)', 'flac'], ['wav', 'WAV (som sem compressão)', 'wav'], ['gif', 'GIF animado', 'gif'],
  ];
  async function converterNoAparelho() {
    const app = VW.app, W = VW.ui.Win, F = VW.ui.F;
    const item = app.player.item;
    const caminho = caminhoDe(item);
    if (!caminho) {
      F.message('Converter pelo ffmpeg do aparelho', 'Abra um arquivo pelas <b>pastas do aparelho</b> (menu Mídia) e depois volte aqui. Arquivos escolhidos pelo navegador usam <b>Mídia › Converter / salvar…</b>.', [['abrir', 'Abrir as pastas do aparelho'], ['ok', 'Fechar']])
        .then((r) => { if (r === 'abrir') abrirPastas(); });
      return;
    }
    let info = null;
    try { info = await infoDe(caminho); } catch (e) { /* segue sem as faixas */ }
    const perfil = F.select(PERFIS.map(([v, n]) => [v, n]), 'mp4');
    const qualidade = F.select([['18', 'Alta'], ['23', 'Boa'], ['28', 'Leve']], '23');
    const faixas = ((info && info.audios) || []).map((a, i) => [String(i), `Faixa ${i + 1}${a.idioma ? ' — ' + U.langName(a.idioma) : ''}${a.codec ? ' (' + U.codecName(a.codec) + ')' : ''}`]);
    const faixa = F.select(faixas.length ? faixas : [['0', 'Faixa 1']], String(info ? faixaPadrao(info) : 0));
    const saida = F.text('', null, { 'aria-label': 'Arquivo de saída' });
    const extDe = (v) => (PERFIS.find((x) => x[0] === v) || [, , 'mp4'])[2];
    const sugerir = () => { saida.value = juntar(pastaDe(caminho), U.stripExt(nomeDe(caminho)) + (perfil.value === 'tocar-copia' ? '-rapido' : '') + '.' + extDe(perfil.value)); };
    const linhaQual = F.row('Qualidade', qualidade), linhaFaixa = F.row('Faixa de áudio', faixa);
    const atualizar = () => { sugerir(); linhaQual.hidden = !['mp4', 'webm'].includes(perfil.value); linhaFaixa.hidden = perfil.value !== 'tocar-copia' || faixas.length < 2; };
    perfil.addEventListener('change', atualizar);
    const progresso = F.progress();
    progresso.hidden = true;
    const w = new W({ title: 'Converter pelo ffmpeg do aparelho', icon: 'convert', modal: true, width: 560 });
    w.body.append(F.row('Arquivo', el('span', { class: 'lnux-quebra' }, caminho)), F.row('Formato', perfil), linhaQual, linhaFaixa, F.row('Salvar como', saida), progresso,
      el('p', { class: 'f-hint' }, 'Roda no aparelho (bem mais rápido que no navegador e sem limite de tamanho). Pode fechar esta janela: a conversão continua e avisa quando terminar.'));
    atualizar();
    const ir = F.button('Converter', async () => {
      ir.disabled = true; progresso.hidden = false; progresso.set(-1);
      const opcoes = { crf: perfil.value === 'webm' ? { 18: 28, 23: 32, 28: 38 }[qualidade.value] : +qualidade.value, faixa: +faixa.value };
      try {
        const { id } = await P.pedir('POST', 'converter', { json: { entrada: caminho, perfil: perfil.value, saida: saida.value.trim(), opcoes } });
        for (;;) {
          const t = await P.pedir('GET', 'tarefas/' + id);
          progresso.set(t.progresso > 0 ? t.progresso : -1);
          if (t.estado === 'pronto') {
            w.close();
            app.notify('Convertido: ' + t.saida, [['Tocar', () => tocarDoAparelho([{ nome: nomeDe(t.saida), caminho: t.saida }], [], true)], ['Mostrar na pasta', () => abrirPastas(pastaDe(t.saida))]], { icon: 'convert', timeout: 12000 });
            return;
          }
          if (t.estado === 'erro' || t.estado === 'cancelado') throw new Error(t.erro || 'a conversão foi cancelada');
          await U.sleep(600);
        }
      } catch (e) {
        ir.disabled = false; progresso.hidden = true;
        if (e.status === 409) app.error('Já existe um arquivo com esse nome: escolha outro em "Salvar como".');
        else app.error('Não deu para converter: ' + e.message);
      }
    }, 'primary');
    w.footer.append(F.button('Fechar', () => w.close()), ir);
    w.show();
  }

  // ── Ligar tudo no VLC Web ───────────────────────────────────────────────

  function ligar(app) {
    const p = app.player, S = app.settings;
    // os pontos do player que usam o FFmpeg WebAssembly passam a usar o ffmpeg do aparelho nos arquivos dele
    const orig = {
      suggestFFmpeg: p.suggestFFmpeg.bind(p), playWithFFmpeg: p.playWithFFmpeg.bind(p), ensureLocal: p.ensureLocal.bind(p),
      useAudioTrack: p.useAudioTrack.bind(p), cancelTasks: p.cancelTasks.bind(p),
    };
    const peloAparelho = (item) => temFfmpeg() && !!caminhoDe(item);
    // abrir um arquivo do aparelho em formato que o navegador não toca: prepara antes (sem a tentativa que falha)
    const abrir = p.open.bind(p);
    p.open = async function (item, opts = {}) {
      const c = item && !item.stream && !original.has(item) && caminhoDaUrl(item.url || '');
      if (c && temFfmpeg() && S.get('ffmpegMode') !== 'never' && !item._lnuxVisto) {
        item._lnuxVisto = true;
        if (await precisaPreparar(c)) {
          this.emit('osd', 'Formato que o navegador não toca: preparando pelo ffmpeg do aparelho…');
          return prepararPelaPonte(item, { abrir: true, resumeAt: opts.startTime, autoplay: opts.autoplay });
        }
      }
      return abrir(item, opts);
    };
    p.suggestFFmpeg = function (item, reason, soft, autoOk) {
      if (!peloAparelho(item) || S.get('ffmpegMode') === 'never') return orig.suggestFFmpeg(item, reason, soft, autoOk);
      if (this.suggested) return;
      this.suggested = true;
      VW.log.info('lnux', reason + ' → ffmpeg do aparelho');
      prepararPelaPonte(item, { audioOnly: !!soft });
    };
    p.playWithFFmpeg = function (item, opts = {}) { item = item || this.item; return peloAparelho(item) ? prepararPelaPonte(item, opts) : orig.playWithFFmpeg(item, opts); };
    p.ensureLocal = function (item, opts) { return peloAparelho(item) ? Promise.resolve(true) : orig.ensureLocal(item, opts); }; // não precisa baixar
    p.useAudioTrack = function (item, i) { return peloAparelho(item) ? faixaPelaPonte(item, i) : orig.useAudioTrack(item, i); };
    p.cancelTasks = function () { if (tarefa) tarefa.abort(); return orig.cancelTasks(); };
    // ao abrir um arquivo do aparelho, lê as faixas pelo ffprobe (menu Áudio › Faixa de áudio completo, até em AVI e MKV)
    p.on('item', (item) => {
      const c = caminhoDe(item);
      if (!c || !P.tem('ffprobe') || item.probe) return;
      infoDe(c).then((info) => {
        if ((info.audios || []).length > 1 && !item.probe) { item.probe = probeDe(info); p.emit('tracks'); }
        const textos = (info.legendas || []).filter((l) => l.texto);
        if (textos.length && p.item === item) p.emit('osd', `${textos.length} legenda(s) dentro do arquivo: menu Legenda › Legendas embutidas`);
      }).catch(() => {});
    });

    // ações (aparecem nos atalhos e na lista de teclas) e menus
    const A = app.actions;
    A.define('lnux-pastas', { label: 'Abrir das pastas do aparelho…', run: () => abrirPastas(), keys: ['Ctrl+Alt+O'], category: 'Mídia' });
    A.define('lnux-converter', { label: 'Converter pelo ffmpeg do aparelho…', run: () => converterNoAparelho(), keys: [], category: 'Mídia' });
    A.define('lnux-apps', { label: 'Todos os apps (LNUX-APPs)', run: () => { location.href = '../../'; }, keys: [], category: 'Mídia' });
    const embrulhar = (id, f) => {
      const def = app.menu.defs.find((d) => d.id === id);
      if (!def) return;
      const antes = def.items;
      def.items = () => f(antes());
      if (app.menus && app.menus[id]) { const m = app.menus[id]; app.menus[id] = () => f(m()); }
    };
    embrulhar('media', (itens) => {
      const extras = [];
      if (P.disponivel) {
        extras.push({ label: 'Abrir das pastas do aparelho…', icon: 'folder', shortcut: 'lnux-pastas', hint: 'ponte do LNUX', action: () => abrirPastas() });
        if (temFfmpeg()) extras.push({ label: 'Converter pelo ffmpeg do aparelho…', icon: 'convert', action: () => converterNoAparelho(), disabled: !caminhoDe(p.item) });
        if (temFfmpeg() && caminhoDe(p.item)) extras.push({ label: 'Preparar pelo ffmpeg do aparelho (formato que não toca)', icon: 'codec', action: () => prepararPelaPonte(p.item, {}) });
      }
      const i = itens.findIndex((x) => x && x.shortcut === 'open-network');
      const saida = [...itens];
      saida.splice(i >= 0 ? i : 3, 0, ...extras);
      const sair = saida.findIndex((x) => x && x.shortcut === 'quit');
      saida.splice(sair >= 0 ? sair : saida.length, 0, { label: 'Todos os apps (LNUX-APPs)', icon: 'library', action: () => { location.href = '../../'; } });
      return saida;
    });
    embrulhar('subtitle', (itens) => {
      const c = caminhoDe(p.item);
      if (!c || !temFfmpeg()) return itens;
      const info = infos.get(c);
      // o ffprobe pode ainda estar respondendo: mostra o que já se sabe
      let resolvido = null;
      if (info) info.then((d) => { resolvido = d; });
      return [...itens, { sep: true }, {
        label: 'Legendas embutidas (pelo ffmpeg do aparelho)', icon: 'subtitle',
        submenu: () => {
          if (!resolvido) { infoDe(c).then((d) => { resolvido = d; }); return [{ label: 'Lendo as faixas do arquivo… (abra de novo)', disabled: true }]; }
          const l = (resolvido.legendas || []);
          if (!l.length) return [{ label: 'Este arquivo não tem legendas dentro', disabled: true }];
          return l.map((x) => ({
            label: `${x.titulo || 'Faixa ' + (x.indice + 1)}${x.idioma ? ' — ' + U.langName(x.idioma) : ''}${x.forcada ? ' (forçada)' : ''}${x.texto ? '' : ' — em imagem (não dá para separar)'}`,
            disabled: !x.texto, action: () => legendaEmbutida(p.item, x),
          }));
        },
      }];
    });
    app.menu.render();

    // salvar (capturas, gravações, conversões, legendas, listas) numa pasta do aparelho
    if (P.disponivel) U.download = (blob, nome) => salvarNoAparelho(blob, nome);

    // botão na tela de boas-vindas e selo na barra de status
    const boasVindas = U.$('.welcome-actions');
    if (boasVindas && P.disponivel) {
      const b = el('button', { type: 'button', class: 'btn big', title: 'Pastas do aparelho (pela ponte do LNUX)', onclick: () => abrirPastas() }, U.icon('folder-plus'), 'Pastas do aparelho');
      b.dataset.lnux = 'pastas';
      boasVindas.prepend(b);
    }
    const status = U.$('#statusbar');
    if (status) {
      const selo = el('button', { type: 'button', class: 'status-rate lnux-selo' + (P.disponivel ? ' ligada' : ''),
        title: P.disponivel ? 'Ponte do LNUX ligada: pastas do aparelho' + (temFfmpeg() ? ' e ffmpeg' : '') + '. Clique para abrir as pastas.' : 'Sem a ponte do LNUX (' + (P.motivo || 'desligada') + '). Abra o VLC-Web pelo LNUX › 🧩 Apps Web para usar as pastas do aparelho.',
        onclick: () => (P.disponivel ? abrirPastas() : VW.ui.F.message('Ponte do LNUX', U.escapeHtml(selo.title))) }, P.disponivel ? 'Ponte' : 'Sem ponte');
      status.insertBefore(selo, U.$('#status-rate'));
    }
    VW.log.info('lnux', P.disponivel ? `Ponte do LNUX ligada (${temFfmpeg() ? 'com' : 'sem'} ffmpeg)` : 'Sem a ponte do LNUX: ' + (P.motivo || 'desligada'));
    VW.lnux = { abrirPastas, tocarDoAparelho, converterNoAparelho, prepararPelaPonte, faixaPelaPonte, legendaEmbutida, salvarNoAparelho, caminhoDe, urlDe, pronto: true };
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const app = VW.app;
    if (!app) return; // o VLC Web não iniciou (o erro já aparece na tela)
    try { await P.verificar(); } catch (e) { /* sem ponte */ }
    try { ligar(app); } catch (e) { console.error(e); VW.log && VW.log.error('lnux', 'Integração com a ponte: ' + e.message); }
  });
})(window.VW = window.VW || {});
