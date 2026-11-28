# Bibliotecas de terceiros da Companhia

## pixi.js 6.5.10 (pixi.min.js)

```
The MIT License

Copyright (c) 2013-2017 Mathew Groves, Chad Engler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## pixi-live2d-display 0.4.0 (pixi-live2d-display-cubism4.min.js)

```
MIT License

Copyright (c) 2020 Guan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Live2D Cubism Core (NÃO incluído)

O núcleo do Live2D (live2dcubismcore.min.js) é da Live2D Inc., sob a Live2D Proprietary Software License
(https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html). Ele não vem neste repositório:
o app baixa do site oficial (pela ponte, uma vez) ou usa o arquivo que você mesmo baixar.

## three.js 0.180.0, @pixiv/three-vrm 3.5.5, @pixiv/three-vrm-animation 3.5.5 e three-mesh-bvh 0.9.1 (three-vrm-pacote.min.js)

Montados num arquivo só por `tools/montar_vrm.sh` (esbuild), para abrir personagens VRoid (`.vrm`), tocar
movimentos (`.vrma`, `.fbx`, `.bvh`, `.glb`) e abrir cenários (`.glb`, `.fbx`, `.obj`) com colisão.
Os avisos de licença das partes também estão no fim do próprio arquivo. Do three.js entram, além do núcleo, os
carregadores GLTFLoader, FBXLoader (com o fflate), BVHLoader, OBJLoader, MTLLoader, ColladaLoader, STLLoader, PLYLoader,
TDSLoader, 3MFLoader, USDZLoader e DRACOLoader, o exportador GLTFExporter, o decodificador Meshopt, o zstddec e o
RoomEnvironment (todos MIT, dos autores do three.js, salvo indicação abaixo).

### three.js

```
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @pixiv/three-vrm

```
Copyright (c) 2019-2026 pixiv Inc.

MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### @pixiv/three-vrm-animation

A mesma licença MIT do @pixiv/three-vrm, acima (Copyright (c) 2019-2026 pixiv Inc.).

### three-mesh-bvh

```
MIT License

Copyright (c) 2018 Garrett Johnson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### fflate (dentro do FBXLoader) e meshoptimizer (decodificador Meshopt)

- fflate 0.8.2 — Copyright (c) 2023 Arjun Barrett — licença MIT (https://github.com/101arrowz/fflate/blob/master/LICENSE).
- meshoptimizer (meshopt_decoder) — Copyright (C) 2016-2024, Arseny Kapoulkine — licença MIT
  (https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md).

- zstddec (decodificador zstd em WebAssembly, para os `.blend` compactados) — Copyright (c) 2020 Don McCurdy —
  licença MIT (https://github.com/donmccurdy/zstddec). O WebAssembly dele é o descompactador do
  [Zstandard](https://github.com/facebook/zstd) — Copyright (c) Meta Platforms, Inc. and affiliates — licença BSD
  de 3 cláusulas (https://github.com/facebook/zstd/blob/dev/LICENSE).

As três primeiras usam o mesmo texto da licença MIT reproduzido acima, com o aviso de direitos de cada autor.

## MediaPipe Tasks Vision 1.2.2 (mediapipe-visao.min.js)

O código JavaScript do `@mediapipe/tasks-vision` (Copyright The MediaPipe Authors), montado por
`tools/montar_vrm.sh` junto com o pequeno programa do Worker da Companhia (`tools/companhia_visao_entrada.js`).
Licença **Apache License, Version 2.0**: https://www.apache.org/licenses/LICENSE-2.0 — o arquivo foi montado
(empacotado e minificado) a partir do pacote original, sem mudar o código do MediaPipe.

```
Copyright 2022 The MediaPipe Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

O WebAssembly (`vision_wasm_internal.*`) e os modelos (`face_landmarker.task`, `pose_landmarker_*.task`,
`hand_landmarker.task`), também Apache-2.0, **não vêm neste repositório**: a ponte (ou o navegador) baixa do
pacote oficial no npm e de `storage.googleapis.com/mediapipe-models` na primeira vez que a captura é ligada.
Veja o aviso de privacidade do MediaPipe em https://goo.gle/mediapipe-privacy — na Companhia a imagem da câmera
é processada no aparelho e não é enviada.

## Draco (draco/draco_wasm_wrapper.js e draco/draco_decoder.wasm)

O decodificador de malhas [Draco](https://github.com/google/draco), copiado de `three/examples/jsm/libs/draco/gltf/`
(three.js 0.180.0), para abrir cenários `.glb` comprimidos. Copyright The Draco Authors (Google) — licença
**Apache License, Version 2.0** (https://www.apache.org/licenses/LICENSE-2.0), com o mesmo aviso reproduzido acima.

## Basis Universal — transcodificador (basis/basis_transcoder.js e basis/basis_transcoder.wasm)

O transcodificador de texturas [Basis Universal](https://github.com/BinomialLLC/basis_universal), copiado de
`three/examples/jsm/libs/basis/` (three.js 0.180.0), para abrir cenários com texturas KTX2 (KHR_texture_basisu).
Copyright © 2016–2026 Binomial LLC — licença **Apache License, Version 2.0**
(https://www.apache.org/licenses/LICENSE-2.0). "Basis Universal" é marca registrada da Binomial LLC.

## ktx2-encoder e Basis Universal — codificador (ktx2-codificador.min.js e ktx2/basis_encoder.wasm)

O codificador de texturas KTX2 [ktx2-encoder](https://github.com/gz65555/ktx2-encoder) 0.6.0 (Copyright Hu Song —
licença **MIT**), empacotado sem alterações por `tools/montar_vrm.sh` (entrada `tools/companhia_ktx2_entrada.js`), com
o codificador [Basis Universal](https://github.com/BinomialLLC/basis_universal) compilado para WebAssembly que vem no
pacote (`dist/basis/basis_encoder.wasm`). O Basis Universal é licenciado sob a **Apache License, Version 2.0**
(https://www.apache.org/licenses/LICENSE-2.0); o aviso dele, reproduzido como a licença pede:

```
Basis Universal™ Supercompressed GPU Texture Compression Library

Copyright © 2016–2026 Binomial LLC.
All rights reserved except as granted under the Apache 2.0 license
(https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE).
"Basis Universal" is a trademark of Binomial LLC.

The documents in the Basis Universal wiki, and the Basis Universal library,
example, and tool source code, fall under the Apache 2.0 license, unless
otherwise explicitly indicated.

Redistributions or derivative works must include a readable copy of the
attribution notices from this NOTICE file (see Apache License 2.0 §4(d)).
```

Só é baixado quando a pessoa escolhe gravar o cenário com texturas KTX2 (js/ktx2.js).
