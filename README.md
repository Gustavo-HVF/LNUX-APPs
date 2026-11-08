# LNUX-APPs

Apps web do [LNUX](https://github.com/Gustavo-HVF/Termux-Toons): programas de criação que abrem no navegador do
celular ou do computador, feitos só com **HTML, CSS e JavaScript**. Funcionam sozinhos no navegador e, com a
**ponte local**, também usam as pastas do aparelho, o ffmpeg e recursos como bateria, notificações e área de
transferência.

| App | O que faz | Inspirado em |
|---|---|---|
| 🎬 **Vídeo** | Editor de vídeo com linha do tempo de várias trilhas: cortar, aparar, mover; cor (com "looks" prontos), movimento, transições, títulos animados, legendas SRT, velocidade e áudio com fades; exporta em WebM, ou MP4 e GIF pela ponte | [FilmCraft](https://github.com/storytold/filmcraft) |
| ✨ **Efeitos** | Animação de títulos e gráficos: camadas de texto, forma, partículas, imagem e vídeo; quadros-chave com suavização (freando, quicando, elástico...); 12 animações prontas, 7 modelos, "tremer", desfoque, brilho, sombra e modos de mistura; exporta GIF e PNG (no navegador), WebM, ou MP4 pela ponte | [EffectCraft](https://github.com/storytold/effectcraft) |
| 🎚️ **Som** | Estúdio de áudio multipistas: gravar pelo microfone, importar, cortar, aparar, fades, normalizar, inverter; mixer com volume, pan, mudo e solo; EQ de 3 bandas, compressor, eco e reverb por trilha; BPM, grade e metrônomo; loop; exporta WAV (16/24 bits) e, pela ponte, MP3, OGG, Opus, FLAC e M4A, ou uma trilha por arquivo | [SoundCraft](https://github.com/storytold/soundcraft) |

Vêm mais: editor de código (Monaco), VLC-Web, dois sites de mensagens, escritório (texto, planilha,
apresentação, PDF), imagem (foto, vetor, revelação, animação), design e técnico (diagramação, interface, CAD,
texturas e materiais 3D) e um estúdio de IA. A página inicial mostra os prontos e os que estão por vir
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
| ffmpeg | Converter em segundo plano, com progresso: MP4, WebM, GIF, MP3, OGG, Opus, M4A, FLAC, WAV; e ler as informações de uma mídia (ffprobe) |
| Aparelho | Bateria, área de transferência, notificação, falar um texto, vibrar e dados do sistema (Termux:API no celular; /sys, wl-copy/xclip, notify-send e espeak-ng nas distros) |
| Comandos | Rodar um programa e devolver a saída: **desligado**, a não ser que você ligue |

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
| Tocar / pausar | Espaço | Espaço, K | Espaço |
| Separar no cursor | S | S | — |
| Ferramenta de corte | C | C | — |
| Gravar | R | — | — |
| Loop / metrônomo | L / M | — | — |
| Novo texto | — | T | T |
| Marcador | — | M | — |
| Quadro a quadro | — | ← → | ← → |
| Quadro-chave anterior/próximo | — | — | J / K |
| Apagar / duplicar | Del / Ctrl+D | Del (Shift+Del fecha o buraco) / Ctrl+D | Del / Ctrl+D |
| Exportar | Ctrl+E | Ctrl+E | Ctrl+E |

## O que as versões web não fazem (ainda)

São versões leves. Do que os originais têm, ficou de fora, entre outros: no **Vídeo**, edição de três pontos,
monitor de origem, curvas e rodas de cor, máscaras, chroma key, estabilização, mixer de áudio com automação e
intercâmbio com outros editores (XML); no **Efeitos**, Lottie, expressões em JavaScript, máscaras, 3D, pinos de
marionete e parentesco entre camadas; no **Som**, MIDI e instrumentos, automação, mais de 3 bandas de EQ,
gravação com punch-in e plugins. A exportação de vídeo é gravada enquanto toca (por isso leva o tempo do vídeo
e pede a aba aberta na frente).

## Para quem mexe no código

```
index.html            página inicial (lê apps.json)
apps.json             catálogo dos apps (o LNUX também lê, para montar o menu 🌐 Apps Web)
comum/lnux.css        temas (variáveis), densidade e componentes
comum/lnux.js         temas, layouts, menus, atalhos, paleta, diálogos, desfazer, ponte, abrir/salvar, IndexedDB
comum/zip.js          ZIP (salvar e abrir projetos)
comum/gif.js          codificador de GIF animado
apps/<id>/            cada app: index.html, CSS, motor e interface
servidor/lnux_apps.py servidor + ponte local
tests/                testes
```

Um app novo: crie `apps/<id>/index.html` com `comum/lnux.css` e `comum/lnux.js`, chame
`LNUX.iniciar({app, nome, layouts, menus, inspirado})` e acrescente o app em `apps.json`.

```bash
python3 tests/testar_servidor.py     # a ponte: chave, DNS rebinding, pastas liberadas, Range, ffmpeg... (só Python)
python3 tests/testar_navegador.py    # os apps no Chromium de verdade (precisa do Node + Playwright e do ffmpeg)
```

## Licença

MIT ([LICENSE](LICENSE)). Créditos dos apps originais em [CREDITOS.md](CREDITOS.md).
