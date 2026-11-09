#!/bin/sh
# Monta apps/companhia/vendor/three-vrm-pacote.min.js: three.js + GLTFLoader + three-vrm (pixiv) num arquivo só,
# para a Companhia abrir personagens VRoid (.vrm) sem ferramentas de build no aparelho.
# Precisa do Node.js (npm). Uso: sh tools/montar_vrm.sh
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm install --silent three@0.180.0 @pixiv/three-vrm@3.5.5 esbuild@0.25.0
cp "$RAIZ/tools/companhia_vrm_entrada.js" entrada.js
npx esbuild entrada.js --bundle --minify --format=iife --legal-comments=eof --outfile="$RAIZ/apps/companhia/vendor/three-vrm-pacote.min.js"
rm -rf "$TMP"
echo "Pronto: apps/companhia/vendor/three-vrm-pacote.min.js"
