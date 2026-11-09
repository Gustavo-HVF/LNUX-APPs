# LNUX-APPs

Apps web do [LNUX](https://github.com/Gustavo-HVF/Termux-Toons): programas de criação que abrem no navegador do
celular ou do computador, feitos só com **HTML, CSS e JavaScript**. Funcionam sozinhos no navegador e, com a
**ponte local**, também usam as pastas do aparelho, o ffmpeg e recursos como bateria, notificações e área de
transferência.

| App | O que faz | Inspirado em |
|---|---|---|
| 🎬 **Vídeo** | Editor de vídeo no jeito do Premiere: espaços de trabalho (Edição, Montagem, Cor, Efeitos, Áudio, Legendas, Celular), monitor de Origem com entrada/saída, Inserir e Sobrescrever, 11 ferramentas (ondulação, rolante, slip, slide, navalha, esticar...), 31 efeitos de vídeo e 11 de áudio com quadros-chave e gráfico de velocidade, Cor (Lumetri) com curvas, rodas, HSL e escopos, 14 transições, mixer com loudness (LUFS), legendas SRT/VTT, gráficos prontos; exporta WebM, GIF, PNG, WAV, e MP4/MP3 pela ponte | [FilmCraft](https://github.com/storytold/filmcraft) |
| ✨ **Efeitos** | Animação de títulos e gráficos: camadas de texto, forma, partículas, imagem e vídeo; quadros-chave com suavização (freando, quicando, elástico...); 12 animações prontas, 7 modelos, "tremer", desfoque, brilho, sombra e modos de mistura; exporta GIF e PNG (no navegador), WebM, ou MP4 pela ponte | [EffectCraft](https://github.com/storytold/effectcraft) |
| ▶️ **VLC-Web** | Player de vídeo e música completo (o [VLC Web](https://github.com/Gustavo-HVF/VLC-WEB), do mesmo autor): lista de reprodução, legendas em 10 formatos com busca online e tradução, equalizador de 10 bandas e efeitos de áudio, filtros de vídeo em WebGL, faixas de áudio, A→B, capítulos, gravação, conversão, transmissão, rádios e podcasts, 31 temas e 9 layouts. **Com a ponte**: toca direto das pastas do aparelho e usa o ffmpeg dele para AVI, WMV, MKV com AC-3/DTS, outras faixas de áudio e legendas embutidas | [VLC media player](https://www.videolan.org/vlc/) (projeto independente, sem código do VLC) |
| 💬 **Companhia** | Converse com personagens **Live2D** (os modelos do **VTube Studio**: importe o ZIP e troque quando quiser): chat com **ChatGPT, Claude, Gemini**, OpenRouter, Groq, DeepSeek, Mistral, **IA local** (Ollama, LM Studio, llama.cpp) ou o **claude-code-router**, com rotas que economizam tokens e um motor local que responde o simples sem IA; **voz** (navegador, ElevenLabs, OpenAI, **VoiceStudio** no aparelho) com a boca sincronizada; 15 emoções e 12 gestos que seguem a conversa; **toques** (cafuné, cutucar, puxar a orelha, cócegas); **memória** guardada no aparelho e relida ao abrir. Detalhes em [`apps/companhia/README.md`](apps/companhia/README.md) | [AIRI](https://github.com/moeru-ai/airi), [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) e [claude-code-router](https://github.com/musistudio/claude-code-router) (só ideias) |
| 🎚️ **Som** | Estúdio de áudio multipistas: gravar pelo microfone, importar, cortar, aparar, fades, normalizar, inverter; mixer com volume, pan, mudo e solo; EQ de 3 bandas, compressor, eco e reverb por trilha; BPM, grade e metrônomo; loop; exporta WAV (16/24 bits) e, pela ponte, MP3, OGG, Opus, FLAC e M4A, ou uma trilha por arquivo | [SoundCraft](https://github.com/storytold/soundcraft) |

Vêm mais: editor de código (Monaco), dois sites de mensagens, escritório (texto, planilha,
apresentação, PDF), imagem (foto, vetor, revelação, animação), design e técnico (diagramação, interface, CAD,
texturas e materiais 3D) e um estúdio de IA de imagem. A página inicial mostra os prontos e os que estão por vir
(lista completa em [`apps.json`](apps.json)).

Os apps inspirados nos Crafting Apps da storytold são reescritas próprias e **bem mais simples** que os
originais (que são programas profissionais, em Rust, com anos de trabalho): veja [CREDITOS.md](CREDITOS.md).

## Como abrir

**Pelo LNUX** (o jeito mais fácil): menu **🌐 Apps Web**. O LNUX baixa este repositório, liga o servidor com a
ponte e abre o app no navegador, já com a chave da ponte.

**Sozinho**, em qualquer aparelho com Python 3.9 ou mais novo:

```bash
git clone https://github.com/Gustavo-HVF/LNUX-APPs
```

```bash
cd LNUX-APPs
```

```bash
python3 servidor/lnux_apps.py --abrir
```

O servidor mostra o endereço (`http://127.0.0.1:8095/#token=...`). O `#token=` é a chave da ponte: o app guarda
e tira da barra de endereço. Sem a chave (ou com `--sem-ponte`), os apps abrem do mesmo jeito, só sem acesso
às pastas e ao ffmpeg.

Para o ffmpeg (exportar MP4, MP3, GIF pela ponte e abrir formatos que o navegador não conhece): no Termux,
`pkg install ffmpeg`; no Debian/Ubuntu, `sudo apt install ffmpeg`.

## A ponte local

O navegador não deixa um site mexer nas pastas do aparelho. A ponte (`servidor/lnux_apps.py`, só biblioteca
padrão do Python) faz isso pelos apps, numa API em `/api/`:

| O que | Para quê |
|---|---|
| Pastas e arquivos | Abrir e salvar direto nas pastas (Downloads, Músicas, Vídeos...), com uma janela de pastas própria; ler com Range (vídeos grandes tocam sem baixar inteiros) |
| ffmpeg | Converter em segundo plano, com progresso: MP4, WebM, GIF, MP3, OGG, Opus, M4A, FLAC, WAV; preparar para tocar o que o navegador não abre (copiando a imagem quando dá), separar uma faixa de áudio ou uma legenda embutida; e ler as informações de uma mídia, com todas as faixas de áudio e legenda (ffprobe) |
| Aparelho | Bateria, área de transferência, notificação, falar um texto, vibrar e dados do sistema (Termux:API no celular; /sys, wl-copy/xclip, notify-send e espeak-ng nas distros) |
| Comandos | Rodar um programa e devolver a saída: **desligado**, a não ser que você ligue |
| IA (Companhia) | Guardar as chaves das APIs de IA e voz no aparelho (`~/.lnux-apps/ia.json`, permissão 600) e repassar os pedidos com a chave, ao vivo (streaming): só para provedores conhecidos (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, ElevenLabs), programas do próprio aparelho (`127.0.0.1`, como Ollama e VoiceStudio) e endereços da rede que você liberar. A chave só vai para o endereço em que foi cadastrada e nunca volta ao navegador. Também guarda o núcleo do Live2D (baixado do site oficial uma vez) |

**Segurança.** Escuta só no próprio aparelho (`127.0.0.1`), a não ser que você peça `--endereco 0.0.0.0`.
Cada pedido precisa da chave guardada em `~/.lnux-apps/ponte.json` (permissão 600). Recusa nomes de domínio no
cabeçalho `Host`, o que bloqueia o *DNS rebinding*, e recusa pedidos que mudam algo vindos de outro site.
Só mexe nas pastas liberadas: a pessoal, o armazenamento interno no Android e as que você acrescentar.
A conversão usa perfis prontos, sem argumentos soltos para o ffmpeg. A câmera e o microfone vêm do próprio
navegador (que pergunta antes), não da ponte.

```bash
python3 servidor/lnux_apps.py --porta 9000                 # outra porta
python3 servidor/lnux_apps.py --raiz /mnt/hd               # libera mais uma pasta (pode repetir)
python3 servidor/lnux_apps.py --sem-ponte                  # só os apps, sem acesso ao aparelho
python3 servidor/lnux_apps.py --permitir-comandos          # deixa os apps rodarem programas (cuidado)
python3 servidor/lnux_apps.py --mostrar-token              # mostra a chave e sai
```

Em `~/.lnux-apps/ponte.json` dá para deixar fixo: `"raizes": ["/mnt/hd"]` e `"comandos": true`. Os arquivos
temporários das conversões ficam em `~/.lnux-apps/tmp` e são apagados depois de um dia.

## Em todos os apps

- **Aparência** (botão ◐ no canto): tema **Do sistema, Escuro, Claro, Sépia, Oceano ou Alto contraste**
  (vale para todos os apps), **tamanho dos controles** (compacto, normal ou confortável para toque) e
  **layout** de cada app (por exemplo, no Som: Edição e mixer, Edição, Mixagem ou Simples). Tudo fica salvo
  no navegador. No celular, o layout próprio para tela pequena entra sozinho.
- **Paleta de comandos**: `Ctrl+Shift+P` (ou F1) acha qualquer comando pelo nome. *Ajuda › Atalhos de
  teclado* lista todos os atalhos.
- **Desfazer e refazer** (`Ctrl+Z`, `Ctrl+Shift+Z`) em tudo.
- **Nada se perde**: o projeto fica guardado no navegador a cada mudança e volta quando você abre o app de novo.
  *Salvar projeto* gera um arquivo único (um ZIP com o projeto e as mídias): `.lnuxsom`, `.lnuxvideo`,
  `.lnuxefeitos`.
- **Abrir e salvar**: com a ponte, numa janela com as pastas do aparelho (ou pelo navegador, se preferir);
  sem ela, pelo navegador (baixar).

### Atalhos principais

| | Som | Vídeo | Efeitos |
|---|---|---|---|
| Tocar / pausar | Espaço | Espaço; J, K, L (para trás, parar, para a frente; repetir acelera) | Espaço |
| Separar no cursor | S | Ctrl+K (Ctrl+Shift+K: todas as trilhas) | — |
| Ferramenta de corte | C | C (navalha) | — |
| Gravar | R | — | — |
| Loop / metrônomo | L / M | — | — |
| Novo texto | — | T (ferramenta Texto) | T |
| Marcador | — | M (Shift+M: próximo) | — |
| Quadro a quadro | — | ← → (Shift: 5 quadros); ↑ ↓ pontos de edição | ← → |
| Quadro-chave anterior/próximo | — | ◀ ▶ nos Controles de efeito | J / K |
| Apagar / duplicar | Del / Ctrl+D | Del, Shift+Del (fecha o buraco); Alt+arrastar duplica | Del / Ctrl+D |
| Exportar | Ctrl+E | Ctrl+M ou Ctrl+E (Shift+E: o quadro) | Ctrl+E |

### O Vídeo em detalhe

Feito a partir das funções do FilmCraft (que imita o Premiere Pro). A tela tem a **Origem**, o **monitor de
programa**, os **Controles de efeito**, o **Projeto**, as **ferramentas**, a **linha do tempo** e os
**medidores**, arrumados em espaços de trabalho (barra de cima: Edição, Montagem, Cor, Efeitos, Áudio,
Legendas e gráficos; no celular, o espaço Celular, com abas embaixo).

- **Montagem (edição de três pontos)**: dois cliques numa mídia do Projeto abrem a Origem; `I` e `O` marcam
  a entrada e a saída; `,` insere (empurra o resto) e `.` sobrescreve no cursor, nas trilhas marcadas como
  origem (botões **V** e **A** no começo de cada trilha). Botões *Vídeo* e *Áudio* escolhem levar só um dos dois.
  Arrastar do Projeto ou da Origem para a linha do tempo também funciona (com Ctrl, insere).
- **Sequência**: `I`/`O` na sequência marcam o trecho; `;` levanta (deixa o buraco) e `'` extrai (fecha);
  `X` marca o clipe; marcadores coloridos com nome, comentário e duração (painel Marcadores, exporta CSV).
- **Ferramentas**: Seleção (V), Selecionar para a frente (A), Ondulação (B), Rolante (N), Esticar
  velocidade (R), Navalha (C), Slip (Y), Slide (U), Mão (H), Zoom (Z) e Texto (T). Encaixe (S) nos cortes, no
  cursor e nos marcadores; seleção vinculada (o vídeo e o som do mesmo arquivo andam juntos; Alt pega só um);
  seleção por laço; trilhas com trava, olho, mudo, solo e altura dupla (dois cliques no nome); linha **Mix**.
- **Controles de efeito**: Movimento (posição, escala, largura da escala, rotação, ponto de ancoragem),
  Opacidade (com 18 modos de mistura), Recorte, Tempo (velocidade), Volume e Panorama, e os efeitos do clipe
  com o botão **fx** (liga/desliga para comparar), ordem e voltar ao padrão. O **relógio** liga a animação;
  ◀ ◆ ▶ andam e põem quadros-chave; os valores azuis mudam arrastando; a faixa à direita mostra os
  quadros-chave (arrastar move, botão direito escolhe Linear, Bezier, Facilitar ou Segurar); clicar no nome
  abre o **gráfico de valor e de velocidade**.
- **No monitor**: arrastar move o clipe escolhido, os cantos mudam a escala, a bolinha de cima gira; guias
  de área segura; zoom e resolução de reprodução; exportar o quadro.
- **Efeitos** (painel com busca e predefinições): Cor (Lumetri), brilho e contraste, matiz e saturação,
  tingir, duotone, preto e branco, sépia, desfoques (gaussiano, direcional, zoom, lente), nitidez, ruído,
  chroma key, luma key, máscara, brilho (glow), aberração cromática, VHS, posterizar, mosaico, inverter,
  bordas, relevo, espelhar, ondulação, redemoinho, esferizar, tremer a câmera, barras de cinema e gradiente.
  No áudio: ganho, EQ de 3 bandas, passa-alta, passa-baixa, tirar o zumbido da rede, voz mais clara,
  compressor, limitador, eco, reverb e mono. Camadas de ajuste aplicam efeitos em tudo o que está embaixo.
- **Cor**: correção básica (com **Auto**), criativo (looks), **curvas** RGB, **rodas de cor**
  (sombras, meios-tons, realces), **HSL secundária** com conta-gotas e vinheta; **Escopos**: forma de onda,
  parade RGB, vetorscópio e histograma.
- **Transições**: dissolver, preto, branco, desfocar, empurrar, deslizar, cortina, portas, persianas,
  relógio, íris, losango, zoom e girar; fades de áudio de potência e de ganho constantes. `Ctrl+D` e
  `Ctrl+Shift+D` põem a padrão no corte mais perto do cursor; as bordas da transição mudam a duração.
- **Áudio**: forma de onda nos clipes, linha amarela de volume (arrastar; Ctrl+clique cria quadro-chave),
  **Mixer** com volume, panorama, mudo e solo por trilha e o mestre, medidores de pico e **loudness EBU R128**
  (momentâneo, curto, integrado); exportar só o áudio com normalização para -14, -16 ou -23 LUFS.
- **Legendas e gráficos**: painel Texto com as legendas (criar no cursor, editar, importar e exportar SRT e
  VTT, copiar o estilo para todas); Gráficos essenciais com modelos (título, terço inferior, créditos subindo,
  letreiro, formas, cor sólida, camada de ajuste, barras de cinema, vinheta) e o editor de texto e forma.
- **Projeto**: pastas, ícones ou lista, rótulos de cor, busca, trocar ou reencontrar o arquivo de uma mídia;
  Navegador de mídia (pastas do aparelho, pela ponte), Metadados, Informações e Histórico (voltar a qualquer passo).
- **Guardar**: tudo fica no navegador, com **versões automáticas** a cada 3 minutos (Arquivo › Versões);
  projetos da versão anterior do app são convertidos sozinhos.

### O VLC-Web e a ponte

O VLC-Web é o [VLC Web](https://github.com/Gustavo-HVF/VLC-WEB) inteiro (o README dele, com todos os recursos e
atalhos, está em [`apps/vlc-web/README.md`](apps/vlc-web/README.md)). Ele vem do repositório próprio dele sem
mudar o código: `python3 tools/importar_vlc_web.py` copia a versão mais nova (sem o app Android) e só acrescenta
ao `index.html` as três linhas que carregam a integração, que fica à parte em `apps/vlc-web/lnux/`. Sem a ponte, ele funciona exatamente como no site dele.
Com a ponte (aberto pelo LNUX):

- **Mídia › Abrir das pastas do aparelho** (`Ctrl+Alt+O`, ou o botão na tela inicial): navega nas pastas e toca
  direto do aparelho, sem copiar para o navegador; dá para avançar em filmes grandes (pedidos parciais). As
  legendas com o mesmo nome entram junto, e listas `.m3u`, `.pls` e `.xspf` da pasta também abrem.
- **O que o navegador não toca** (AVI, WMV, FLV, MPEG-2, VOB, TS, WMA, APE...) o ffmpeg do aparelho prepara
  antes de tocar. Em MKV e MP4 com H.264, HEVC, VP9 ou AV1 ele só troca o "envelope" e converte o som: leva
  segundos, mesmo em filme longo. Som em AC-3, E-AC-3 ou DTS: só a faixa de áudio é convertida, e o vídeo segue.
- **Áudio › Faixa de áudio**: as outras faixas (outro idioma, comentários) saem pelo ffmpeg do aparelho, sem
  baixar o arquivo (no navegador puro, o VLC Web precisa baixar o arquivo inteiro e usar o FFmpeg WebAssembly).
- **Legenda › Legendas embutidas**: separa as legendas de texto de dentro do MKV/MP4 (as de imagem, como PGS e
  VobSub, não dá).
- **Mídia › Converter pelo ffmpeg do aparelho**: MP4 (normal ou rápido, copiando a imagem), WebM, MP3, M4A,
  OGG, Opus, FLAC, WAV e GIF, salvando na pasta que você escolher.
- **Salvar** (capturas de imagem, gravações, conversões, legendas, listas) pergunta a pasta do aparelho; o
  "Baixar pelo navegador" continua lá.
- Na primeira vez, o tema segue o do LNUX-APPs (escuro, claro, sépia, oceano, alto contraste); depois vale o
  que você escolher entre os 31 temas do VLC Web. *Mídia › Todos os apps* volta para a página inicial.

## O que as versões web não fazem (ainda)

São versões leves. Do que os originais têm, ficou de fora, entre outros: no **Vídeo**, máscaras desenhadas
à mão e rastreamento, estabilização, remapeamento de tempo (velocidade variável) e tocar ao contrário,
várias sequências e sequências aninhadas, multicâmera, proxies, LUTs `.cube`, trajetória de movimento
desenhada no monitor, gravação da automação do mixer, transcrição automática da fala e intercâmbio com
outros editores (XML/EDL/AAF); no **Efeitos**, Lottie, expressões em JavaScript, máscaras, 3D, pinos de
marionete e parentesco entre camadas; no **Som**, MIDI e instrumentos, automação, mais de 3 bandas de EQ,
gravação com punch-in e plugins; na **Companhia**, modelos Live2D Cubism 2, IA rodando dentro do navegador
(WebLLM), rastreamento pela câmera e os movimentos `.motion3.json` além do movimento parado. A exportação de vídeo (WebM/MP4) é gravada enquanto toca (por isso leva o
tempo do vídeo e pede a aba aberta na frente); GIF, PNG e áudio são feitos quadro a quadro, sem tocar.

## Para quem mexe no código

```
index.html            página inicial (lê apps.json)
apps.json             catálogo dos apps (o LNUX também lê, para montar o menu 🌐 Apps Web)
comum/lnux.css        temas (variáveis), densidade e componentes
comum/lnux.js         temas, layouts, menus, atalhos, paleta, diálogos, desfazer, ponte, abrir/salvar, IndexedDB
comum/zip.js          ZIP (salvar e abrir projetos)
comum/gif.js          codificador de GIF animado
apps/<id>/            cada app: index.html, CSS, motor e interface
apps/companhia/       live2d.js (palco), personagens.js, ia.js (provedores, roteador, motor local), voz.js,
                      memoria.js, reacoes.js, app.js — vendor/ tem pixi.js e pixi-live2d-display (MIT)
apps/vlc-web/         cópia do VLC Web (não editar: tools/importar_vlc_web.py atualiza) + lnux/ (integração)
apps/video/           catalogo.js (efeitos e quadros-chave), edicao.js (inserir, ondulação, slip...), render.js
                      (compositor WebGL2), audio.js (Web Audio, LUFS), linha.js, controles.js, paineis.js, video.js
servidor/lnux_apps.py servidor + ponte local
tools/                importar_vlc_web.py (traz a versão mais nova do VLC Web)
tests/                testes
```

Um app novo: crie `apps/<id>/index.html` com `comum/lnux.css` e `comum/lnux.js`, chame
`LNUX.iniciar({app, nome, layouts, menus, inspirado})` e acrescente o app em `apps.json`.

```bash
python3 tests/testar_servidor.py     # a ponte: chave, DNS rebinding, pastas liberadas, Range, ffmpeg... (só Python)
node tests/testar_edicao.js          # a álgebra de edição do Vídeo (inserir, extrair, ondulação, rolante, slip, slide...)
python3 tests/testar_navegador.py    # os apps no Chromium de verdade (precisa do Node + Playwright e do ffmpeg)
# a Companhia precisa de um modelo e do núcleo do Live2D (não vêm no repositório):
LNUX_TESTE_MODELO=modelo.zip LNUX_TESTE_NUCLEO=live2dcubismcore.min.js python3 tests/testar_navegador.py companhia
```

## Licença

MIT ([LICENSE](LICENSE)). Créditos dos apps originais em [CREDITOS.md](CREDITOS.md).
