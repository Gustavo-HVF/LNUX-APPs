#!/bin/sh
# Monta os pacotes de bibliotecas da Companhia, para ela funcionar sem ferramentas de build no aparelho:
#   apps/companhia/vendor/three-vrm-pacote.min.js   three.js + carregadores (glTF, FBX, BVH, OBJ, Draco, Meshopt) +
#                                                   three-vrm + three-vrm-animation (pixiv) + three-mesh-bvh
#   apps/companhia/vendor/mediapipe-visao.min.js    MediaPipe Tasks Vision (rastreamento pela câmera), como Worker
#   apps/companhia/vendor/draco/                    o decodificador Draco (para cenários .glb comprimidos)
# O WebAssembly e os modelos do MediaPipe (~30 MB) não vêm no repositório: a ponte (ou o navegador) baixa na
# primeira vez que a captura de movimento é ligada.
# Precisa do Node.js (npm). Uso: sh tools/montar_vrm.sh
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$RAIZ/apps/companhia/vendor"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm install --silent three@0.180.0 @pixiv/three-vrm@3.5.5 @pixiv/three-vrm-animation@3.5.5 three-mesh-bvh@0.9.1 @mediapipe/tasks-vision@1.2.2 esbuild@0.25.0
cp "$RAIZ/tools/companhia_vrm_entrada.js" entrada.js
cp "$RAIZ/tools/companhia_visao_entrada.js" visao.js
npx esbuild entrada.js --bundle --minify --format=iife --legal-comments=eof --outfile="$VENDOR/three-vrm-pacote.min.js"
npx esbuild visao.js --bundle --minify --format=iife --legal-comments=eof --outfile="$VENDOR/mediapipe-visao.min.js" \
  --banner:js="/*! MediaPipe Tasks Vision 1.2.2 - Copyright The MediaPipe Authors - Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0) - empacotado sem alteracoes com o Worker da Companhia (tools/companhia_visao_entrada.js, MIT) por tools/montar_vrm.sh do LNUX-APPs */"
mkdir -p "$VENDOR/draco"
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm "$VENDOR/draco/"
rm -rf "$TMP"
echo "Pronto: three-vrm-pacote.min.js, mediapipe-visao.min.js e draco/ em apps/companhia/vendor/"
