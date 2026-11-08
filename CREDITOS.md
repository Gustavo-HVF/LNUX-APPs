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

## O resto

- **Código do LNUX-APPs** (`comum/`, `apps/`, `servidor/`, `tests/`): licença MIT (arquivo `LICENSE`).
- **Ícones**: desenhos próprios, em `comum/lnux.js` (traço de 24×24).
- **Bibliotecas de terceiros**: nenhuma no lote 1. Os apps usam só o que o navegador já tem (Canvas, WebGL2,
  Web Audio, MediaRecorder, IndexedDB). O codificador de GIF (`comum/gif.js`) e o ZIP (`comum/zip.js`) foram escritos
  aqui, seguindo as especificações públicas dos formatos (GIF89a e o APPNOTE do ZIP).
- **ffmpeg** (opcional, na ponte local): não é distribuído com o LNUX-APPs; a ponte só chama o `ffmpeg`
  instalado no aparelho.
