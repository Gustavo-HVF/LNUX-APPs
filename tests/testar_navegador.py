#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes dos apps no navegador de verdade (Chromium), com o Playwright.

Gera mídias de teste com o ffmpeg (vídeo, áudio e imagem), sobe o servidor numa porta livre com pastas
TEMPORÁRIAS (não mexe nos seus arquivos nem na sua chave da ponte) e roda tests/navegador/testar_<app>.js:
importar pela ponte, editar, desfazer, tocar, gravar (microfone simulado), exportar (WAV, MP3, MP4, GIF,
PNG) conferindo os arquivos com o ffprobe e o Pillow, recarregar a página e o layout de celular.

Precisa de: Node.js com o Playwright (npm i -g playwright; npx playwright install chromium), ffmpeg e,
para conferir os GIF/PNG, o Pillow do Python (pip install pillow).

Uso:
    python3 tests/testar_navegador.py              # todos (som, vídeo, compositor e áudio do vídeo, efeitos, VLC-Web, Companhia)
    python3 tests/testar_navegador.py som video    # só alguns

A Companhia precisa de um modelo Live2D e do núcleo do Live2D, que não vêm no repositório (licenças); sem eles,
o teste dela é pulado:
    LNUX_TESTE_MODELO=modelo.zip LNUX_TESTE_NUCLEO=live2dcubismcore.min.js python3 tests/testar_navegador.py companhia
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
APPS = ["som", "video", "render", "audio", "efeitos", "vlc", "companhia", "companhia_vrm", "companhia_corpo", "companhia_mapas", "companhia_sala", "companhia_avatar"]  # render e audio: partes do Vídeo testadas sozinhas


def porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def gerar_midias(pasta: Path):
    pasta.mkdir(parents=True, exist_ok=True)
    f = ["ffmpeg", "-loglevel", "error", "-y"]
    subprocess.run([*f, "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-ac", "2", str(pasta / "tom.wav")], check=True)
    subprocess.run([*f, "-f", "lavfi", "-i", "sine=frequency=550:duration=2", str(pasta / "musica.mp3")], check=True)
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(pasta / "video.mp4")], check=True)
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3", "-c:v", "libvpx", "-b:v", "500k", str(pasta / "clipe.webm")], check=True)
    subprocess.run([*f, "-f", "lavfi", "-i", "color=c=orange:size=400x300", "-frames:v", "1", str(pasta / "foto.png")], check=True)
    # VLC-Web: filme com legenda ao lado, MKV dublado (som AC-3 que o navegador não toca, 2ª faixa em inglês e
    # legenda embutida) e um AVI antigo (MPEG-4 Part 2), numa pasta à parte
    vlc = pasta / "vlc"
    vlc.mkdir(exist_ok=True)
    (vlc / "filme.srt").write_text("1\n00:00:00,500 --> 00:00:09,000\nLegenda do filme\n", "utf-8")
    (pasta / "embutida.srt").write_text("1\n00:00:00,200 --> 00:00:09,000\nOlá, legenda embutida\n", "utf-8")
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=20", "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(vlc / "filme.mp4")], check=True)
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=20", "-f", "lavfi", "-i", "sine=frequency=300:duration=20",
                    "-f", "lavfi", "-i", "sine=frequency=1000:duration=20", "-i", str(pasta / "embutida.srt"), "-map", "0", "-map", "1", "-map", "2", "-map", "3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a:0", "ac3", "-c:a:1", "libmp3lame", "-c:s", "srt",
                    "-metadata:s:a:0", "language=por", "-metadata:s:a:1", "language=eng", "-metadata:s:s:0", "language=por", str(vlc / "dublado.mkv")], check=True)
    (pasta / "embutida.srt").unlink()
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=6", "-f", "lavfi", "-i", "sine=frequency=500:duration=6",
                    "-c:v", "mpeg4", "-c:a", "libmp3lame", str(vlc / "antigo.avi")], check=True)
    (pasta / "saida").mkdir(exist_ok=True)


def main(argv: list) -> int:
    escolhidos = argv or APPS
    faltando = [p for p in ("node", "ffmpeg", "ffprobe") if not shutil.which(p)]
    if faltando:
        print(f"⏭  Pulado: falta {', '.join(faltando)}.")
        return 0
    if subprocess.run(["node", "-e", "require('playwright')"], capture_output=True).returncode != 0:
        print("⏭  Pulado: o Node não acha o Playwright (npm i -g playwright && npx playwright install chromium).")
        return 0
    with tempfile.TemporaryDirectory(prefix="lnux-apps-navegador-") as tmp:
        tmp = Path(tmp)
        gerar_midias(tmp / "midias")
        env = {**os.environ, "LNUX_APPS_DADOS": str(tmp / "dados")}
        porta = porta_livre()
        servidor = subprocess.Popen([sys.executable, str(RAIZ / "servidor" / "lnux_apps.py"), "--porta", str(porta), "--raiz", str(tmp)],
                                    env=env, stdout=subprocess.DEVNULL, stderr=open(tmp / "servidor.log", "w"))
        try:
            for _ in range(50):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{porta}/apps.json", timeout=1)
                    break
                except OSError:
                    time.sleep(0.1)
            token = subprocess.run([sys.executable, str(RAIZ / "servidor" / "lnux_apps.py"), "--mostrar-token"], env=env, capture_output=True, text=True).stdout.strip()
            ambiente = {**os.environ, "LNUX_TESTE_BASE": f"http://127.0.0.1:{porta}", "LNUX_TESTE_TOKEN": token,
                        "LNUX_TESTE_MIDIAS": str(tmp / "midias"), "LNUX_TESTE_SAIDA": str(tmp)}
            falhou = []
            for app in escolhidos:
                print(f"\n── {app} ──")
                r = subprocess.run(["node", str(RAIZ / "tests" / "navegador" / f"testar_{app}.js")], env=ambiente, timeout=600)
                if r.returncode != 0:
                    falhou.append(app)
        finally:
            servidor.terminate()
            servidor.wait(timeout=10)
    print("\n" + ("✔ Todos os apps passaram." if not falhou else f"✖ Falharam: {', '.join(falhou)}"))
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
