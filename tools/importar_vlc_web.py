#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Traz o VLC Web (https://github.com/Gustavo-HVF/VLC-WEB) para apps/vlc-web/ do LNUX-APPs.

O VLC Web é mantido no repositório próprio dele. Este script copia a versão web (sem o app Android) e acrescenta
a integração com o LNUX-APPs, que fica separada em apps/vlc-web/lnux/ (este script não mexe nela):
  - no index.html, entram comum/lnux.js (cliente da ponte local) e lnux/integracao.js + lnux/integracao.css;
  - ORIGEM.json guarda de qual commit veio a cópia.
Nenhum outro arquivo do VLC Web é alterado: para atualizar, é só rodar de novo.

Uso:
    python3 tools/importar_vlc_web.py                      # baixa (git clone) a versão mais nova do GitHub
    python3 tools/importar_vlc_web.py --de ../VLC-WEB      # usa uma cópia que já está no computador
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "apps" / "vlc-web"
REPO = "https://github.com/Gustavo-HVF/VLC-WEB"
# O que é a versão web do VLC Web (o resto — android-app, .github, tools — fica de fora)
ITENS = ["index.html", "receiver.html", "manifest.webmanifest", "favicon.ico", "README.md", "css", "js", "vendor", "assets"]
PROPRIOS = {"lnux", "ORIGEM.json"}  # da integração: nunca apagados

# Pontos de encaixe no index.html (se o VLC Web mudar e eles sumirem, o script para e avisa)
ENCAIXES = [
    ('<link rel="stylesheet" href="css/skins.css">',
     '<link rel="stylesheet" href="css/skins.css">\n  <link rel="stylesheet" href="lnux/integracao.css"><!-- LNUX-APPs -->'),
    ('<script src="js/app.js"></script>',
     '<script src="js/app.js"></script>\n'
     '  <!-- LNUX-APPs: ponte local (pastas do aparelho, ffmpeg) — tools/importar_vlc_web.py -->\n'
     '  <script src="../../comum/lnux.js"></script>\n'
     '  <script src="lnux/integracao.js"></script>'),
]


def rodar(*cmd, pasta=None) -> str:
    return subprocess.run(cmd, cwd=pasta, check=True, capture_output=True, text=True).stdout.strip()


def importar(origem: Path) -> dict:
    faltando = [i for i in ITENS if not (origem / i).exists()]
    if faltando:
        raise SystemExit(f"Isso não parece o VLC Web (faltam: {', '.join(faltando)}): {origem}")
    html = (origem / "index.html").read_text("utf-8")
    for antes, _ in ENCAIXES:
        if html.count(antes) != 1:
            raise SystemExit(f"O index.html do VLC Web mudou: não achei (uma vez só) {antes!r}. Ajuste ENCAIXES neste script.")
    DESTINO.mkdir(parents=True, exist_ok=True)
    # tira a cópia anterior (menos a integração)
    for velho in DESTINO.iterdir():
        if velho.name in PROPRIOS:
            continue
        shutil.rmtree(velho) if velho.is_dir() else velho.unlink()
    for item in ITENS:
        fonte = origem / item
        if fonte.is_dir():
            shutil.copytree(fonte, DESTINO / item, ignore=shutil.ignore_patterns(".DS_Store", "Thumbs.db", "node_modules"))
        else:
            shutil.copy2(fonte, DESTINO / item)
    for antes, depois in ENCAIXES:
        html = html.replace(antes, depois)
    (DESTINO / "index.html").write_text(html, "utf-8")
    commit = ""
    try:
        commit = rodar("git", "rev-parse", "HEAD", pasta=origem)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    origem_info = {"repositorio": REPO, "commit": commit, "importado_em": time.strftime("%Y-%m-%d"),
                   "copiados": ITENS, "nota": "Não edite os arquivos copiados: a integração fica em lnux/. Para atualizar: python3 tools/importar_vlc_web.py"}
    (DESTINO / "ORIGEM.json").write_text(json.dumps(origem_info, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return origem_info


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(description="Copia o VLC Web para apps/vlc-web e liga a integração com o LNUX-APPs.")
    ap.add_argument("--de", type=Path, help="pasta do VLC Web já baixada (padrão: baixa do GitHub)")
    a = ap.parse_args(argv)
    if a.de:
        info = importar(a.de.resolve())
    else:
        with tempfile.TemporaryDirectory() as tmp:
            print(f"Baixando {REPO}...")
            rodar("git", "clone", "--depth", "1", REPO, str(Path(tmp) / "vlc-web"))
            info = importar(Path(tmp) / "vlc-web")
    print(f"VLC Web copiado para {DESTINO.relative_to(RAIZ)} (commit {info['commit'][:7] or 'desconhecido'}).")
    if not (DESTINO / "lnux" / "integracao.js").exists():
        print("Atenção: falta apps/vlc-web/lnux/integracao.js (a integração com a ponte).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
