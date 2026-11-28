#!/bin/sh
# Monta os pacotes de bibliotecas da Companhia, para ela funcionar sem ferramentas de build no aparelho:
#   apps/companhia/vendor/three-vrm-pacote.min.js   three.js + carregadores (glTF, FBX, BVH, OBJ, Draco, Meshopt) +
#                                                   three-vrm + three-vrm-animation (pixiv) + three-mesh-bvh
#   apps/companhia/vendor/mediapipe-visao.min.js    MediaPipe Tasks Vision (rastreamento pela câmera), como Worker
#   apps/companhia/vendor/draco/                    o decodificador Draco (para cenários .glb comprimidos)
#   apps/companhia/vendor/basis/                    o transcodificador Basis Universal (para abrir texturas KTX2)
#   apps/companhia/vendor/ktx2-codificador.min.js   o codificador KTX2 (ktx2-encoder + Basis Universal), baixado só
#   apps/companhia/vendor/ktx2/                     quando a pessoa escolhe gravar o cenário com texturas KTX2
# O WebAssembly e os modelos do MediaPipe (~30 MB) não vêm no repositório: a ponte (ou o navegador) baixa na
# primeira vez que a captura de movimento é ligada.
# Precisa do Node.js (npm). Uso: sh tools/montar_vrm.sh
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$RAIZ/apps/companhia/vendor"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm install --silent three@0.180.0 @pixiv/three-vrm@3.5.5 @pixiv/three-vrm-animation@3.5.5 three-mesh-bvh@0.9.1 @mediapipe/tasks-vision@1.2.2 ktx2-encoder@0.6.0 esbuild@0.25.0
cp "$RAIZ/tools/companhia_vrm_entrada.js" entrada.js
cp "$RAIZ/tools/companhia_visao_entrada.js" visao.js
cp "$RAIZ/tools/companhia_ktx2_entrada.js" ktx2.js
npx esbuild entrada.js --bundle --minify --format=iife --legal-comments=eof --outfile="$VENDOR/three-vrm-pacote.min.js"
npx esbuild visao.js --bundle --minify --format=iife --legal-comments=eof --outfile="$VENDOR/mediapipe-visao.min.js" \
  --banner:js="/*! MediaPipe Tasks Vision 1.2.2 - Copyright The MediaPipe Authors - Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0) - empacotado sem alteracoes com o Worker da Companhia (tools/companhia_visao_entrada.js, MIT) por tools/montar_vrm.sh do LNUX-APPs */"
npx esbuild ktx2.js --bundle --minify --format=iife --external:module --define:import.meta.url=location.href --legal-comments=eof --outfile="$VENDOR/ktx2-codificador.min.js"
mkdir -p "$VENDOR/basis" "$VENDOR/ktx2"
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.js node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm "$VENDOR/basis/"
cp node_modules/ktx2-encoder/dist/basis/basis_encoder.wasm "$VENDOR/ktx2/"
mkdir -p "$VENDOR/draco"
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm "$VENDOR/draco/"
rm -rf "$TMP"
echo "Pronto: three-vrm-pacote.min.js, mediapipe-visao.min.js, ktx2-codificador.min.js, draco/, basis/ e ktx2/ em apps/companhia/vendor/"
