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

## Companhia

- **Código** (`apps/companhia/`, menos `vendor/`): escrito aqui (MIT). Nenhum código dos projetos abaixo foi
  copiado; deles vieram ideias.
- **Bibliotecas que vêm junto** (em `apps/companhia/vendor/`, licenças em `vendor/LICENCAS.md`):
  [pixi.js](https://github.com/pixijs/pixijs) 6.5.10 (MIT, Mat Groves / PixiJS) e
  [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) 0.4.0 (MIT, Guan), que traz partes do
  Cubism Framework da Live2D (licença aberta da Live2D para o Framework).
- **Personagens VRoid** (`vendor/three-vrm-pacote.min.js`, montado por `tools/montar_vrm.sh`): [three.js](https://github.com/mrdoob/three.js)
  0.180.0 (MIT, autores do three.js) e [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) 3.5.5 (MIT, pixiv Inc.).
  Os testes usam o modelo de exemplo `VRM1_Constraint_Twist_Sample.vrm` da pixiv, baixado do repositório do
  three-vrm na hora (redistribuição e modificação permitidas, crédito não exigido); ele não fica no repositório.
  VRoid e VRM são marcas da pixiv Inc.; o `.vroidcustomitem` é um formato do VRoid Studio e não é lido pela Companhia.
- **Movimento das personagens VRoid** (captura, pacotes de movimento, cenário), no mesmo pacote
  `three-vrm-pacote.min.js`: [@pixiv/three-vrm-animation](https://github.com/pixiv/three-vrm) 3.5.5 (MIT, pixiv
  Inc.), para os movimentos `.vrma`; os carregadores do three.js para `.fbx`, `.bvh`, `.obj` e glTF com Draco e
  Meshopt (MIT, autores do three.js; o FBXLoader traz o [fflate](https://github.com/101arrowz/fflate), MIT, Arjun
  Barrett; o decodificador [meshoptimizer](https://github.com/zeux/meshoptimizer), MIT, Arseny Kapoulkine); e o
  [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.9.1 (MIT, Garrett Johnson), para a colisão com
  o cenário. Em `vendor/draco/` fica o decodificador [Draco](https://github.com/google/draco) (Apache-2.0, Google),
  copiado do three.js.
- **Conversor de mapas**: o leitor de `.blend` (`js/blend.js`) foi escrito aqui, a partir do próprio formato do
  arquivo (ele traz a descrição das suas estruturas, o "DNA"); não usa código do Blender. Quando o Blender está
  instalado, a ponte só o chama para exportar em glTF. Os outros formatos passam pelos carregadores e pelo
  exportador de glTF do three.js (MIT), que entram no mesmo pacote, com o
  [zstddec](https://github.com/donmccurdy/zstddec) (MIT, Don McCurdy; traz o zstd, BSD, Meta) para os `.blend`
  compactados. Os dois `.blend` de `tests/dados/` foram feitos aqui, com o Blender 4.2 e o 5.3 (`gerar_blend.py`).
  Blender é marca da Blender Foundation.
- **Captura de movimento pela câmera**: [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe)
  1.2.2 (Apache-2.0, The MediaPipe Authors / Google). O código JavaScript vem em `vendor/mediapipe-visao.min.js`
  (montado por `tools/montar_vrm.sh`); o WebAssembly e os modelos (rosto, corpo e mãos) **não vêm no repositório**:
  são baixados na primeira vez do pacote oficial no npm e de `storage.googleapis.com/mediapipe-models`. O cálculo
  que passa os pontos do MediaPipe para os ossos do VRM foi escrito aqui; a ideia vem do
  [Kalidokit](https://github.com/yeemachine/kalidokit) (MIT, yeemachine) e do VSeeFace/VTube Studio, sem código deles.
  O jeito de passar animações do Mixamo para o VRM segue o exemplo do three-vrm (MIT), generalizado aqui para
  outros esqueletos; o jeito de a cápsula colidir com o cenário segue o exemplo do three-mesh-bvh (MIT).
  Os testes usam, baixados na hora e fora do repositório, o `test.vrma` do three-vrm e a foto `pose.jpg` dos
  arquivos de teste do MediaPipe. VRChat e Unity são marcas dos seus donos; a Companhia não abre mundos
  publicados do VRChat nem usa código ou arquivos deles. Mixamo é marca da Adobe.
- **Live2D Cubism Core** (`live2dcubismcore.min.js`): da Live2D Inc., sob a *Live2D Proprietary Software License*.
  **Não é distribuído** com o LNUX-APPs: a Companhia baixa do site oficial da Live2D (ou usa o arquivo que a
  pessoa escolhe). Usar o núcleo significa aceitar a licença da Live2D. Live2D e Cubism são marcas da Live2D Inc.
- **Ideias e referências** (todos MIT ou mais livres):
  - [claude-code-router](https://github.com/musistudio/claude-code-router), de musistudio: rotas por tarefa
    (default, background, think, longContext), que viraram as rotas Padrão, Leve, Pensar e Contexto longo. Ele
    também pode ser usado como provedor.
  - [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber): marcas de emoção no texto da IA
    ligadas às expressões do modelo.
  - [AIRI](https://github.com/moeru-ai/airi) (moeru-ai): companheira virtual com Live2D, voz e memória.
  - [waifu-companion](https://github.com/waifuai/waifu-companion) (MIT-0): companhia só no navegador, com motor
    local e memória.
  - [charivo](https://github.com/zeikar/charivo) (zeikar): personagem Live2D com LLM e TTS.
- **[VoiceStudio](https://github.com/debpalash/VoiceStudio)**, de debpalash (AGPL-3.0): gerador de voz que roda
  no aparelho. A Companhia **só conversa com a API HTTP dele** (compatível com a da OpenAI). Nenhum código do
  VoiceStudio é copiado ou distribuído, então a AGPL não se aplica ao LNUX-APPs.
- **Serviços que ela pode usar** (só os que você configurar, com a sua chave): OpenAI, Anthropic, Google
  Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras e ElevenLabs. O formato
  `.vtube.json` é do VTube Studio (DenchiSoft), sem afiliação.
- **Modelos Live2D**: nenhum vem junto. Os que você importa são dos autores deles e ficam só no seu aparelho.

## O resto

- **Código do LNUX-APPs** (`comum/`, `apps/`, `servidor/`, `tests/`): licença MIT (arquivo `LICENSE`).
- **Ícones**: desenhos próprios, em `comum/lnux.js` (traço de 24×24).
- **Bibliotecas de terceiros**: nenhuma nos apps do lote 1 (as do VLC-Web e da Companhia estão nas seções deles). Os apps usam só o que o navegador já tem (Canvas, WebGL2,
  Web Audio, MediaRecorder, IndexedDB). O codificador de GIF (`comum/gif.js`) e o ZIP (`comum/zip.js`) foram escritos
  aqui, seguindo as especificações públicas dos formatos (GIF89a e o APPNOTE do ZIP).
- **ffmpeg** (opcional, na ponte local): não é distribuído com o LNUX-APPs; a ponte só chama o `ffmpeg`
  instalado no aparelho.
