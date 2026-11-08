# Créditos

## Crafting Apps, da storytold (ArtCraft Team)

Vários apps do LNUX-APPs são **reescritas próprias e bem mais simples**, em HTML, CSS e JavaScript, de apps
da organização [storytold](https://github.com/storytold) no GitHub (os "Crafting Apps", da ArtCraft Team). Os
originais são programas completos escritos em Rust; as versões daqui foram feitas do zero a partir da
descrição das funções nos READMEs deles. Não copiam código, textos, ícones, fontes, imagens, nomes nem logos.

Os originais são distribuídos sob a licença **MIT** ou a **Apache 2.0**, à escolha de quem usa (veja os
arquivos `LICENSE-MIT`, `LICENSE-APACHE` e `NOTICE` de cada repositório). O **nome ArtCraft, a marca e os
logos** são da ArtCraft Team, não fazem parte dessas licenças e **não são usados** aqui. Por isso os apps
daqui têm nomes próprios.

| App do LNUX-APPs | Inspirado em | Aviso de direitos do original | Licença do original |
|---|---|---|---|
| Vídeo (`apps/video`) | [FilmCraft](https://github.com/storytold/filmcraft) | Copyright (c) 2026 ArtCraft Team and the FilmCraft contributors | MIT ou Apache-2.0 |
| Efeitos (`apps/efeitos`) | [EffectCraft](https://github.com/storytold/effectcraft) | Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors | MIT ou Apache-2.0 |
| Som (`apps/som`) | [SoundCraft](https://github.com/storytold/soundcraft) | Copyright (c) 2026 ArtCraft Team and the SoundCraft contributors | MIT ou Apache-2.0 |

A lista de funções do **Vídeo** (Origem, ferramentas, Controles de efeito, Cor, escopos, mixer, legendas...)
segue o README e a documentação do FilmCraft no GitHub, que por sua vez imita o fluxo do Adobe Premiere Pro.
Nomes de painéis e atalhos de teclado parecidos com os do Premiere são convenções de edição de vídeo; nenhum
código, imagem ou texto da Adobe é usado. As fórmulas de loudness seguem a recomendação pública EBU R128 / ITU-R
BS.1770 (filtro K e janelas de 400 ms e 3 s).

Os próximos lotes vão acrescentar aqui os créditos de WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft,
VectorCraft, LightCraft, AniCraft, DesignCraft, FigCraft, CADCraft, TextureCraft, MaterialCraft e ArtCraft,
conforme cada versão ficar pronta (a lista dos planejados está em `apps.json`).

## VLC-Web

- **Código** (`apps/vlc-web/`, menos `lnux/`): o [VLC Web](https://github.com/Gustavo-HVF/VLC-WEB), de
  Gustavo-HVF, copiado sem mudanças por `tools/importar_vlc_web.py` (o commit de origem fica em
  `apps/vlc-web/ORIGEM.json`). A integração com a ponte (`apps/vlc-web/lnux/`) foi escrita aqui.
- É um projeto independente, **inspirado** no VLC media player: não usa código do VLC e não é afiliado nem
  endossado pela VideoLAN. "VLC" e o cone são marcas da VideoLAN.
- **Bibliotecas que vêm junto** (em `apps/vlc-web/vendor/`): [hls.js](https://github.com/video-dev/hls.js)
  (Apache-2.0), [dash.js](https://github.com/Dash-Industry-Forum/dash.js) (BSD-3-Clause) e o carregador do
  [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (MIT). O núcleo do FFmpeg em WebAssembly (LGPL/GPL)
  só é baixado de cdn.jsdelivr.net quando usado sem a ponte; com a ponte, usa o `ffmpeg` do aparelho.
- **Serviços que ele pode usar** (só quando você pede): diretório de rádios [radio-browser.info](https://www.radio-browser.info/),
  busca de legendas no OpenSubtitles, SubDL e SubSource (com a sua chave), tradução pelo MyMemory ou
  LibreTranslate, e fontes do Google Fonts em alguns temas (SIL OFL/Apache).

## O resto

- **Código do LNUX-APPs** (`comum/`, `apps/`, `servidor/`, `tests/`): licença MIT (arquivo `LICENSE`).
- **Ícones**: desenhos próprios, em `comum/lnux.js` (traço de 24×24).
- **Bibliotecas de terceiros**: nenhuma nos apps do lote 1 (as do VLC-Web estão na seção dele). Os apps usam só o que o navegador já tem (Canvas, WebGL2,
  Web Audio, MediaRecorder, IndexedDB). O codificador de GIF (`comum/gif.js`) e o ZIP (`comum/zip.js`) foram escritos
  aqui, seguindo as especificações públicas dos formatos (GIF89a e o APPNOTE do ZIP).
- **ffmpeg** (opcional, na ponte local): não é distribuído com o LNUX-APPs; a ponte só chama o `ffmpeg`
  instalado no aparelho.
