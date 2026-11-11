#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LNUX-APPs — servidor local: entrega os apps web e faz a PONTE LOCAL entre eles e o aparelho.

Os apps são só HTML, CSS e JavaScript e funcionam sozinhos no navegador. Mas o navegador não deixa um site
mexer nas pastas do aparelho, rodar o ffmpeg ou ler a bateria. A ponte faz isso por eles, por uma API em
/api/, sempre neste mesmo endereço:

  • arquivos: listar pastas, ler (com Range, para tocar vídeos grandes), gravar, copiar, mover, apagar;
  • ffmpeg: converter (MP4, WebM, GIF, MP3, OGG, Opus, M4A, FLAC, WAV) em segundo plano, com progresso,
    e ler as informações de uma mídia (ffprobe);
  • aparelho: bateria, área de transferência, notificação, falar um texto, vibrar e dados do sistema
    (no Termux pelo Termux:API; nas distros por /sys, wl-copy/xclip, notify-send, espeak-ng);
  • comandos: rodar um programa e devolver a saída — DESLIGADO, a menos que você ligue (--permitir-comandos).

Segurança:
  • escuta só em 127.0.0.1 (o próprio aparelho), a menos que você peça --endereco 0.0.0.0;
  • cada pedido à API precisa da chave (token) guardada em ~/.lnux-apps/ponte.json (permissão 600). O LNUX
    abre os apps com "#token=..." no endereço; o app guarda a chave e manda no cabeçalho X-Ponte-Token;
  • só aceita o endereço "localhost" ou um IP no cabeçalho Host (bloqueia o ataque de "DNS rebinding", em que
    um site da internet tenta falar com servidores do seu aparelho);
  • pedidos que mudam algo vindos de outra origem (Origin diferente) são recusados;
  • só mexe nas pastas liberadas: a pasta pessoal (e, no Android, o armazenamento interno) e as que você
    acrescentar com --raiz ou em ponte.json ("raizes").

Uso:
    python3 servidor/lnux_apps.py                       # porta 8095, com a ponte
    python3 servidor/lnux_apps.py --porta 9000 --abrir  # abre a página inicial no navegador
    python3 servidor/lnux_apps.py --sem-ponte           # só os apps, sem acesso ao aparelho
    python3 servidor/lnux_apps.py --mostrar-token       # mostra a chave e sai

Só precisa do Python 3.9 ou mais novo (biblioteca padrão). O ffmpeg é opcional.
"""
from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSAO = "1.0.0"
RAIZ_APPS = Path(__file__).resolve().parent.parent
HOME = Path(os.path.realpath(Path.home()))
DADOS = Path(os.environ.get("LNUX_APPS_DADOS") or (Path.home() / ".lnux-apps"))
TERMUX = bool(os.environ.get("TERMUX_VERSION")) or os.environ.get("PREFIX", "").startswith("/data/data/com.termux")

# Tipos que o mimetypes do Python às vezes não conhece (ou conhece errado, conforme o sistema)
TIPOS = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg",
    ".wav": "audio/wav", ".flac": "audio/flac", ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8",
    ".pdf": "application/pdf", ".zip": "application/zip",
}

# Perfis de conversão do ffmpeg: argumentos de saída e a extensão. Só estes existem: os apps não mandam
# argumentos soltos para o ffmpeg (isso abriria a porta para ler arquivos de fora das pastas liberadas).
PERFIS = {
    "mp4": (["-c:v", "libx264", "-preset", "veryfast", "-crf", "{crf}", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"], "mp4"),
    "webm": (["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "{crf_vp9}", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"], "webm"),
    "gif": (["-an", "-vf", "fps={fps},scale={largura}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"], "gif"),
    "mp3": (["-vn", "-c:a", "libmp3lame", "-q:a", "2"], "mp3"),
    "ogg": (["-vn", "-c:a", "libvorbis", "-q:a", "5"], "ogg"),
    "opus": (["-vn", "-c:a", "libopus", "-b:a", "128k"], "opus"),
    "m4a": (["-vn", "-c:a", "aac", "-b:a", "192k"], "m4a"),
    "flac": (["-vn", "-c:a", "flac"], "flac"),
    "wav": (["-vn", "-c:a", "pcm_s16le"], "wav"),
    # Para TOCAR no navegador o que ele não abre (o VLC-Web usa): "faixa" escolhe a faixa de áudio (0, 1...)
    # tocar-copia: copia a imagem (H.264, HEVC, VP9, AV1) e só converte o som para AAC — bem rápido
    "tocar-copia": (["-map", "0:v:0?", "-map", "0:a:{faixa}?", "-sn", "-dn", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                     "-ac", "2", "-movflags", "+faststart"], "mp4"),
    # tocar: converte tudo (MPEG-2, VC-1, WMV, XviD...) para H.264 + AAC
    "tocar": (["-map", "0:v:0?", "-map", "0:a:{faixa}?", "-sn", "-dn", "-c:v", "libx264", "-preset", "veryfast", "-crf", "{crf}",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart"], "mp4"),
    # só uma faixa de áudio (para tocar junto com o vídeo, trocando o idioma) e uma legenda embutida em WebVTT
    "faixa-audio": (["-vn", "-sn", "-dn", "-map", "0:a:{faixa}", "-c:a", "aac", "-b:a", "192k", "-ac", "2"], "m4a"),
    "legenda-vtt": (["-vn", "-an", "-dn", "-map", "0:s:{faixa}", "-c:s", "webvtt"], "vtt"),
}

MAX_TAREFAS_JUNTAS = 2


# ── IA: chaves guardadas no aparelho e um repasse seguro ───────────────
# Os apps de IA (Companhia) falam com provedores de texto e de voz. A chave fica num arquivo do aparelho
# (~/.lnux-apps/ia.json, permissão 600), nunca volta para o navegador e só é mandada para o endereço em que foi
# cadastrada. O repasse só vai para provedores conhecidos (HTTPS) ou para programas do próprio aparelho
# (Ollama, LM Studio, llama.cpp, VoiceStudio, claude-code-router...) e para os endereços que você liberar.
IA_HOSTS = {"api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "openrouter.ai", "api.groq.com",
            "api.deepseek.com", "api.mistral.ai", "api.x.ai", "api.together.xyz", "api.fireworks.ai", "api.cerebras.ai",
            "api.elevenlabs.io"}
# Como cada provedor recebe a chave (o resto usa "Authorization: Bearer")
IA_CABECALHO = {"anthropic": ("x-api-key", "{}"), "gemini": ("x-goog-api-key", "{}"), "elevenlabs": ("xi-api-key", "{}")}
# Cabeçalhos que o app pode mandar adiante (os de autenticação a ponte põe sozinha)
IA_REPASSAR = {"content-type", "accept", "anthropic-version", "anthropic-beta", "openai-beta", "http-referer", "x-title"}
LIVE2D_CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
# Companhia, captura de movimento: o WebAssembly e os modelos do MediaPipe Tasks Vision (Google, Apache-2.0) somam
# ~30 MB e não vêm no repositório. A ponte baixa uma vez das fontes oficiais (o pacote do npm e os modelos
# publicados pelo Google) e guarda em ~/.lnux-apps/mediapipe/<versão>/; depois a captura funciona sem internet.
MEDIAPIPE_VERSAO = "1.2.2"
MEDIAPIPE_PACOTE = f"https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-{MEDIAPIPE_VERSAO}.tgz"
MEDIAPIPE_MODELOS = "https://storage.googleapis.com/mediapipe-models/"
MEDIAPIPE_ARQUIVOS = {  # nome → ("pacote", caminho dentro do .tgz) ou ("modelo", caminho no endereço dos modelos)
    "vision_wasm_internal.js": ("pacote", "package/wasm/vision_wasm_internal.js"),
    "vision_wasm_internal.wasm": ("pacote", "package/wasm/vision_wasm_internal.wasm"),
    "face_landmarker.task": ("modelo", "face_landmarker/face_landmarker/float16/1/face_landmarker.task"),
    "pose_landmarker_lite.task": ("modelo", "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"),
    "pose_landmarker_full.task": ("modelo", "pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"),
    "hand_landmarker.task": ("modelo", "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"),
}
MEDIAPIPE_TRAVA = threading.Lock()


def baixar_para(url: str, destino: Path, limite: int):
    """Baixa um arquivo grande aos pedaços (para um temporário, que só vira o destino quando termina)."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(destino.name + ".baixando")
    total = 0
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "LNUX-APPs/" + VERSAO}), timeout=120) as r, open(tmp, "wb") as f:
            while True:
                bloco = r.read(256 * 1024)
                if not bloco:
                    break
                total += len(bloco)
                if total > limite:
                    raise ErroPonte(502, "O arquivo baixado é maior do que o esperado.")
                f.write(bloco)
        os.replace(tmp, destino)
    except (urllib.error.URLError, OSError) as e:
        raise ErroPonte(502, f"Não consegui baixar {url.rsplit('/', 1)[-1]} ({getattr(e, 'reason', e)}). Tem internet?")
    finally:
        if tmp.exists():
            tmp.unlink()


def ia_carregar() -> dict:
    try:
        dados = json.loads((DADOS / "ia.json").read_text("utf-8"))
        return dados if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        return {}


def ia_salvar(dados: dict):
    DADOS.mkdir(parents=True, exist_ok=True)
    alvo = DADOS / "ia.json"
    tmp = alvo.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    os.replace(tmp, alvo)
    os.chmod(alvo, 0o600)


def host_do_url(url: str) -> tuple:
    """(esquema, host:porta em minúsculas, host sem porta) de um endereço http(s)."""
    partes = urllib.parse.urlsplit(url)
    if partes.scheme not in ("http", "https") or not partes.hostname:
        raise ErroPonte(400, "O endereço precisa começar com http:// ou https://.")
    porta = partes.port or (443 if partes.scheme == "https" else 80)
    return partes.scheme, f"{partes.hostname.lower()}:{porta}", partes.hostname.lower()


def ia_host_permitido(url: str, extras: list) -> bool:
    esquema, host_porta, host = host_do_url(url)
    if host in ("127.0.0.1", "localhost", "::1") or host.startswith("127."):
        return True  # programas do próprio aparelho
    if host_porta in extras or host in extras:
        return True  # liberado pela pessoa (ex.: o Ollama de outro computador da casa)
    return esquema == "https" and host in IA_HOSTS


class ErroPonte(Exception):
    """Erro com o código HTTP e uma mensagem em português para mostrar no app."""

    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


# ── Configuração (chave e pastas liberadas) ─────────────────────────────

def carregar_config() -> dict:
    """Lê ~/.lnux-apps/ponte.json; cria com uma chave nova na primeira vez (permissão 600)."""
    DADOS.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(DADOS, 0o700)
    except OSError:
        pass
    arquivo = DADOS / "ponte.json"
    config: dict = {}
    if arquivo.exists():
        try:
            config = json.loads(arquivo.read_text("utf-8"))
        except (OSError, ValueError):
            config = {}
    if not re.fullmatch(r"[A-Za-z0-9_-]{24,}", str(config.get("token", ""))):
        config["token"] = secrets.token_urlsafe(24)
        config.setdefault("raizes", [])
        config.setdefault("comandos", False)
        temporario = arquivo.with_suffix(".tmp")
        temporario.write_text(json.dumps(config, ensure_ascii=False, indent=2), "utf-8")
        os.chmod(temporario, 0o600)
        os.replace(temporario, arquivo)
    return config


def pastas_do_usuario() -> dict:
    """Atalhos das pastas comuns (só as que existem): Pessoal, Downloads, Músicas, Vídeos, Imagens, Documentos."""
    if TERMUX:
        s = HOME / "storage"
        nomes = {"Downloads": s / "downloads", "Músicas": s / "music", "Vídeos": s / "movies", "Imagens": s / "pictures",
                 "Câmera": s / "dcim", "Documentos": s / "shared" / "Documents", "Armazenamento": s / "shared"}
    else:
        xdg = {}
        arquivo = Path(os.environ.get("XDG_CONFIG_HOME") or HOME / ".config") / "user-dirs.dirs"
        try:
            for linha in arquivo.read_text("utf-8").splitlines():
                m = re.match(r'XDG_(\w+)_DIR="(.*)"', linha.strip())
                if m:
                    xdg[m.group(1)] = Path(m.group(2).replace("$HOME", str(HOME)))
        except OSError:
            pass
        nomes = {"Downloads": xdg.get("DOWNLOAD", HOME / "Downloads"), "Músicas": xdg.get("MUSIC", HOME / "Music"),
                 "Vídeos": xdg.get("VIDEOS", HOME / "Videos"), "Imagens": xdg.get("PICTURES", HOME / "Pictures"),
                 "Documentos": xdg.get("DOCUMENTS", HOME / "Documents")}
    saida = {"Pessoal": str(HOME)}
    for rotulo, p in nomes.items():
        if p.is_dir():
            saida[rotulo] = os.path.realpath(p)
    return saida


class Ponte:
    """O estado da ponte: chave, pastas liberadas, tarefas do ffmpeg."""

    def __init__(self, ligada: bool, raizes_extras: list, permitir_comandos: bool, hosts_extras: tuple = (), sem_comandos: bool = False):
        self.ligada = ligada
        self.config = carregar_config() if ligada else {}
        self.token = self.config.get("token", "")
        # --sem-comandos vale mais que a configuração (ex.: servidor aberto pela internet, por um túnel)
        self.comandos = bool(permitir_comandos or self.config.get("comandos")) and not sem_comandos
        # domínios aceitos no Host/Origin além de localhost e IPs: o endereço de um túnel (cloudflared...)
        self.hosts_extras = tuple(nome_do_host(h) for h in hosts_extras if h)
        self.temporarios = DADOS / "tmp"
        if ligada:  # antes de montar a lista: na primeira vez a pasta ainda não existe e ficaria de fora
            self.temporarios.mkdir(parents=True, exist_ok=True)
        candidatos = [HOME, self.temporarios]
        if TERMUX or Path("/storage/emulated/0").is_dir():
            candidatos += [Path("/storage/emulated/0"), Path("/sdcard")]
        candidatos += [Path(os.path.expanduser(r)) for r in [*self.config.get("raizes", []), *raizes_extras]]
        self.raizes = []
        for c in candidatos:
            real = Path(os.path.realpath(c))
            if real.is_dir() and real not in self.raizes:
                self.raizes.append(real)
        self.tarefas: dict = {}
        self.trava = threading.Lock()
        self.vagas = threading.Semaphore(MAX_TAREFAS_JUNTAS)
        if ligada:
            self.limpar_temporarios()

    def limpar_temporarios(self, horas: float = 24):
        """Apaga os temporários (envios e conversões) com mais de um dia."""
        limite = time.time() - horas * 3600
        for f in self.temporarios.glob("*"):
            try:
                if f.is_file() and f.stat().st_mtime < limite:
                    f.unlink()
            except OSError:
                pass

    def dentro(self, caminho: Path) -> bool:
        return any(caminho == r or r in caminho.parents for r in self.raizes)

    def resolver(self, caminho: str, existir: bool = True) -> Path:
        """Caminho do app → caminho real, conferindo que está numa pasta liberada (atalhos são seguidos)."""
        if not caminho or not isinstance(caminho, str) or "\x00" in caminho:
            raise ErroPonte(400, "Faltou o caminho.")
        p = Path(os.path.expanduser(caminho))
        if not p.is_absolute():
            p = HOME / p
        real = Path(os.path.realpath(p))
        if not self.dentro(real):
            raise ErroPonte(403, f"{caminho} está fora das pastas liberadas para a ponte "
                                 f"({', '.join(str(r) for r in self.raizes)}).")
        if existir and not real.exists():
            raise ErroPonte(404, f"Não existe: {caminho}")
        return real

    def estado(self) -> dict:
        return {
            "ponte": True, "versao": VERSAO, "sistema": nome_do_sistema(), "termux": TERMUX, "home": str(HOME),
            "raizes": [str(r) for r in self.raizes], "pastas": pastas_do_usuario(), "temporarios": str(self.temporarios),
            "recursos": {
                "ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe")),
                "termux_api": bool(shutil.which("termux-battery-status")), "comandos": self.comandos,
                "area_de_transferencia": bool(comando_area("ler")), "notificacoes": bool(shutil.which("termux-notification") or shutil.which("notify-send")),
                "voz": bool(comando_voz("teste")), "vibrar": bool(shutil.which("termux-vibrate")),
                # Companhia: proxy das APIs de IA (com as chaves guardadas aqui) e o núcleo do Live2D já baixado
                "ia": True, "live2d_core": (DADOS / "live2d" / "live2dcubismcore.min.js").is_file(),
                # Companhia: guarda os arquivos do rastreamento pela câmera (MediaPipe)
                "mediapipe": MEDIAPIPE_VERSAO,
            },
            "perfis": sorted(PERFIS),
        }


# ── Aparelho (bateria, área de transferência, notificação, voz) ─────────

def nome_do_sistema() -> str:
    if TERMUX:
        return "Termux (Android)"
    try:
        for linha in Path("/etc/os-release").read_text("utf-8").splitlines():
            if linha.startswith("PRETTY_NAME="):
                return linha.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return f"{platform.system()} {platform.release()}".strip()


def rodar(cmd: list, entrada: str | None = None, tempo: float = 10) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, input=entrada, capture_output=True, text=True, timeout=tempo)


def bateria() -> dict:
    if shutil.which("termux-battery-status"):
        try:
            d = json.loads(rodar(["termux-battery-status"], tempo=8).stdout)
            estados = {"CHARGING": "carregando", "DISCHARGING": "descarregando", "FULL": "cheia", "NOT_CHARGING": "parada"}
            return {"disponivel": True, "percentual": d.get("percentage"), "estado": estados.get(d.get("status"), "desconhecido"),
                    "temperatura": d.get("temperature"), "na_tomada": d.get("plugged") not in (None, "UNPLUGGED")}
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    base = Path("/sys/class/power_supply")
    resultado: dict = {"disponivel": False}
    na_tomada = None
    try:
        fontes = sorted(base.iterdir())
    except OSError:
        fontes = []
    for f in fontes:
        try:
            tipo = (f / "type").read_text().strip()
            if tipo == "Mains":
                na_tomada = (f / "online").read_text().strip() == "1"
            elif tipo == "Battery" and not resultado["disponivel"]:
                estado = (f / "status").read_text().strip().lower()
                resultado = {"disponivel": True, "percentual": int((f / "capacity").read_text().strip()),
                             "estado": {"charging": "carregando", "discharging": "descarregando", "full": "cheia",
                                        "not charging": "parada"}.get(estado, "desconhecido")}
        except (OSError, ValueError):
            continue
    if resultado["disponivel"]:
        resultado["na_tomada"] = na_tomada if na_tomada is not None else resultado["estado"] in ("carregando", "cheia")
    return resultado


def sistema() -> dict:
    d: dict = {"sistema": nome_do_sistema(), "nucleos": os.cpu_count(), "python": platform.python_version()}
    try:
        d["carga"] = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        pass
    try:
        mem = {}
        for linha in Path("/proc/meminfo").read_text().splitlines():
            chave, valor = linha.split(":", 1)
            mem[chave] = int(valor.split()[0]) * 1024
        d["memoria"] = {"total": mem.get("MemTotal"), "disponivel": mem.get("MemAvailable", mem.get("MemFree"))}
    except (OSError, ValueError):
        pass
    try:
        d["ligado_ha"] = float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        pass
    uso = shutil.disk_usage(HOME)
    d["disco"] = {"total": uso.total, "livre": uso.free}
    return d


def comando_area(acao: str) -> list | None:
    """Comando da área de transferência do sistema ('ler' ou 'escrever')."""
    wayland = bool(os.environ.get("WAYLAND_DISPLAY"))
    opcoes = {
        "ler": [["termux-clipboard-get"], ["wl-paste", "-n"] if wayland else None, ["xclip", "-o", "-selection", "clipboard"], ["xsel", "-ob"]],
        "escrever": [["termux-clipboard-set"], ["wl-copy"] if wayland else None, ["xclip", "-selection", "clipboard"], ["xsel", "-ib"]],
    }[acao]
    for cmd in opcoes:
        if cmd and shutil.which(cmd[0]) and (cmd[0].startswith("termux") or os.environ.get("DISPLAY") or wayland):
            return cmd
    return None


def comando_voz(texto: str) -> list | None:
    if shutil.which("termux-tts-speak"):
        return ["termux-tts-speak", texto]
    if shutil.which("espeak-ng"):
        return ["espeak-ng", "-v", "pt-br", texto]
    if shutil.which("spd-say"):
        return ["spd-say", "-l", "pt", texto]
    return None


# ── ffmpeg ──────────────────────────────────────────────────────────────

def duracao_da_midia(caminho: Path) -> float:
    if not shutil.which("ffprobe"):
        return 0.0
    try:
        r = rodar(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(caminho)], tempo=20)
        return float(r.stdout.strip() or 0)
    except (ValueError, OSError, subprocess.SubprocessError):
        return 0.0


def info_da_midia(caminho: Path) -> dict:
    if not shutil.which("ffprobe"):
        raise ErroPonte(501, "O ffprobe (do ffmpeg) não está instalado.")
    r = rodar(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(caminho)], tempo=30)
    if r.returncode != 0:
        raise ErroPonte(422, "O ffprobe não reconheceu este arquivo como mídia.")
    dados = json.loads(r.stdout or "{}")
    saida: dict = {"duracao": float(dados.get("format", {}).get("duration") or 0), "formato": dados.get("format", {}).get("format_name"),
                   "audios": [], "legendas": []}
    # Todas as faixas de áudio e de legenda, na ordem de "0:a:N" e "0:s:N" (o "faixa" dos perfis de tocar)
    textuais = {"subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "microdvd", "subviewer", "subviewer1", "sami", "realtext", "stl", "jacosub", "mpl2", "pjs", "vplayer"}
    for s in dados.get("streams", []):
        tags = s.get("tags") or {}
        if s.get("codec_type") == "audio":
            saida["audios"].append({"indice": len(saida["audios"]), "codec": s.get("codec_name"), "canais": s.get("channels"),
                                    "idioma": tags.get("language"), "titulo": tags.get("title"),
                                    "padrao": bool((s.get("disposition") or {}).get("default"))})
        elif s.get("codec_type") == "subtitle":
            saida["legendas"].append({"indice": len(saida["legendas"]), "codec": s.get("codec_name"), "idioma": tags.get("language"),
                                      "titulo": tags.get("title"), "texto": s.get("codec_name") in textuais,
                                      "forcada": bool((s.get("disposition") or {}).get("forced"))})
    for s in dados.get("streams", []):
        if s.get("codec_type") == "video" and "video" not in saida:
            fps = 0.0
            try:
                num, den = (s.get("avg_frame_rate") or "0/1").split("/")
                fps = float(num) / float(den) if float(den) else 0.0
            except ValueError:
                pass
            saida["video"] = {"codec": s.get("codec_name"), "largura": s.get("width"), "altura": s.get("height"), "fps": round(fps, 3)}
        elif s.get("codec_type") == "audio" and "audio" not in saida:
            saida["audio"] = {"codec": s.get("codec_name"), "canais": s.get("channels"), "taxa": int(s.get("sample_rate") or 0)}
    return saida


def _inteiro(opcoes: dict, chave: str, padrao: int, minimo: int, maximo: int) -> int:
    try:
        return max(minimo, min(maximo, int(opcoes.get(chave, padrao))))
    except (TypeError, ValueError):
        return padrao


class Tarefa:
    """Uma conversão do ffmpeg rodando em segundo plano."""

    def __init__(self, ponte: Ponte, entrada: Path, saida: Path, perfil: str, opcoes: dict):
        self.id = uuid.uuid4().hex[:12]
        self.ponte, self.entrada, self.saida, self.perfil = ponte, entrada, saida, perfil
        self.estado = "na_fila"
        self.progresso = 0.0
        self.erro = ""
        self.processo: subprocess.Popen | None = None
        self.criada = time.time()
        args, _ = PERFIS[perfil]
        valores = {"crf": _inteiro(opcoes, "crf", 23, 0, 51), "crf_vp9": _inteiro(opcoes, "crf", 32, 0, 63),
                   "fps": _inteiro(opcoes, "fps", 12, 1, 60), "largura": _inteiro(opcoes, "largura", 480, 16, 7680),
                   "faixa": _inteiro(opcoes, "faixa", 0, 0, 99)}
        self.argumentos = [a.format(**valores) if "{" in a else a for a in args]

    def resumo(self) -> dict:
        d = {"id": self.id, "estado": self.estado, "progresso": round(self.progresso, 4), "perfil": self.perfil}
        if self.estado == "pronto":
            d["saida"] = str(self.saida)
            d["tamanho"] = self.saida.stat().st_size if self.saida.exists() else 0
        if self.erro:
            d["erro"] = self.erro
        return d

    def rodar(self):
        with self.ponte.vagas:
            if self.estado == "cancelado":
                return
            self.estado = "rodando"
            duracao = duracao_da_midia(self.entrada)
            parcial = self.saida.with_name(self.saida.name + ".parcial." + self.saida.suffix.lstrip("."))
            cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(self.entrada), *self.argumentos,
                   "-progress", "pipe:1", "-nostats", str(parcial)]
            fim_do_log: list = []
            try:
                self.processo = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
                leitor = threading.Thread(target=lambda: fim_do_log.extend(self.processo.stderr.read().splitlines()[-12:]), daemon=True)
                leitor.start()
                for linha in self.processo.stdout:
                    if linha.startswith("out_time_us=") and duracao > 0:
                        try:
                            self.progresso = min(0.999, int(linha.split("=", 1)[1]) / 1e6 / duracao)
                        except ValueError:
                            pass
                codigo = self.processo.wait()
                leitor.join(timeout=5)
                if self.estado == "cancelado":
                    parcial.unlink(missing_ok=True)
                    return
                if codigo != 0:
                    parcial.unlink(missing_ok=True)
                    self.estado = "erro"
                    self.erro = "O ffmpeg não conseguiu converter: " + (" ".join(fim_do_log[-3:]) or f"código {codigo}")
                    return
                os.replace(parcial, self.saida)
                self.progresso = 1.0
                self.estado = "pronto"
            except OSError as e:
                self.estado = "erro"
                self.erro = f"Não deu para rodar o ffmpeg: {e}"

    def cancelar(self):
        if self.estado in ("pronto", "erro"):
            return
        self.estado = "cancelado"
        if self.processo and self.processo.poll() is None:
            self.processo.terminate()


# ── Servidor HTTP ───────────────────────────────────────────────────────

def nome_seguro(nome: str, padrao: str = "arquivo") -> str:
    nome = re.sub(r"[^\w.\- ()\[\]]+", "_", os.path.basename(nome or ""), flags=re.UNICODE).strip(" .")
    return nome[:120] or padrao


def nome_do_host(host: str) -> str:
    """'exemplo.com:443' → 'exemplo.com' (minúsculas, sem a porta)."""
    host = (host or "").strip().lower()
    if host.startswith("["):
        return host.split("]", 1)[0] + "]"
    return host.rsplit(":", 1)[0] if ":" in host else host


def host_valido(host: str, extras: tuple = ()) -> bool:
    """Só 'localhost', um IP ou um domínio liberado de propósito (o de um túnel, com --permitir-host): qualquer
    outro nome de domínio aqui é sinal de DNS rebinding."""
    host = (host or "").strip().lower()
    if host.startswith("["):  # IPv6: [::1]:8095
        return "]" in host
    nome = nome_do_host(host)
    if nome in ("localhost", "localhost.") or nome in extras:
        return True
    return bool(re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", nome))


class Manipulador(BaseHTTPRequestHandler):
    server_version = "LNUX-APPs/" + VERSAO
    protocol_version = "HTTP/1.1"
    ponte: Ponte  # definido no servidor

    # Menos barulho no terminal: só erros e pedidos que mudam algo
    def log_message(self, formato, *args):
        if getattr(self, "_registrar", True):
            sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), formato % args))

    # ── respostas

    def responder_json(self, dados, status: int = 200, cabecalhos: dict | None = None):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (cabecalhos or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corpo)

    def erro(self, status: int, mensagem: str):
        # Fecha a conexão: um pedido recusado pode ter deixado o corpo sem ler, e ele embaralharia o próximo
        self.close_connection = True
        self.responder_json({"erro": mensagem}, status, {"Connection": "close"})

    def enviar_arquivo(self, caminho: Path, tipo: str, cache: str = "no-cache"):
        """Manda um arquivo, com suporte a Range (os players de vídeo pedem pedaços)."""
        tamanho = caminho.stat().st_size
        inicio, fim = 0, tamanho - 1
        faixa = self.headers.get("Range", "")
        status = 200
        if faixa:
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", faixa.strip())
            if not m or (not m.group(1) and not m.group(2)):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{tamanho}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if m.group(1):
                inicio = int(m.group(1))
                fim = min(int(m.group(2)), tamanho - 1) if m.group(2) else tamanho - 1
            else:  # bytes=-500: os últimos 500
                inicio = max(0, tamanho - int(m.group(2)))
            if inicio > fim or inicio >= tamanho:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{tamanho}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(fim - inicio + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {inicio}-{fim}/{tamanho}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(caminho, "rb") as f:
            f.seek(inicio)
            falta = fim - inicio + 1
            while falta > 0:
                bloco = f.read(min(256 * 1024, falta))
                if not bloco:
                    break
                try:
                    self.wfile.write(bloco)
                except (BrokenPipeError, ConnectionResetError):
                    return  # o player trocou de pedaço: normal
                falta -= len(bloco)

    # ── entrada

    def ler_corpo(self, limite: int = 2 * 1024 * 1024) -> bytes:
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho > limite:
            raise ErroPonte(413, "Pedido grande demais.")
        self._corpo_lido = True
        return self.rfile.read(tamanho) if tamanho else b""

    def ler_json(self) -> dict:
        corpo = self.ler_corpo()
        if not corpo:
            return {}
        try:
            dados = json.loads(corpo)
        except ValueError:
            raise ErroPonte(400, "O corpo do pedido não é um JSON válido.")
        if not isinstance(dados, dict):
            raise ErroPonte(400, "Esperava um objeto JSON.")
        return dados

    def receber_para(self, destino: Path):
        """Grava o corpo do pedido num arquivo, em pedaços (serve para arquivos grandes)."""
        if "Content-Length" not in self.headers:
            raise ErroPonte(411, "Faltou o tamanho do arquivo (Content-Length).")
        falta = int(self.headers["Content-Length"])
        self._corpo_lido = True
        parcial = destino.with_name(destino.name + f".enviando-{uuid.uuid4().hex[:6]}")
        try:
            with open(parcial, "wb") as f:
                while falta > 0:
                    bloco = self.rfile.read(min(256 * 1024, falta))
                    if not bloco:
                        raise ErroPonte(400, "O envio foi interrompido.")
                    f.write(bloco)
                    falta -= len(bloco)
            os.replace(parcial, destino)
        finally:
            if parcial.exists():
                parcial.unlink()

    def parametros(self) -> dict:
        return {k: v[-1] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    # ── verbos

    def do_GET(self):
        self.tratar()

    def do_HEAD(self):
        self.tratar()

    def do_POST(self):
        self.tratar()

    def do_PUT(self):
        self.tratar()

    def do_DELETE(self):
        self.tratar()

    def tratar(self):
        caminho = urllib.parse.urlsplit(self.path).path
        self._corpo_lido = False
        try:
            if caminho.startswith("/api/") or caminho == "/api":
                self._registrar = self.command not in ("GET", "HEAD")
                self.api(caminho[5:])
            elif self.command in ("GET", "HEAD"):
                self._registrar = False
                self.estatico(caminho)
            else:
                self.erro(405, "Método não permitido aqui.")
        except ErroPonte as e:
            self.erro(e.status, e.mensagem)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except subprocess.TimeoutExpired:
            self.erro(504, "O programa demorou demais para responder.")
        except Exception as e:  # erro inesperado: avisa o app e deixa o rastro no terminal
            import traceback
            traceback.print_exc()
            try:
                self.erro(500, f"Erro inesperado na ponte: {e}")
            except OSError:
                pass
        finally:
            self.descartar_corpo()

    def descartar_corpo(self):
        """Se a resposta saiu sem ler o corpo do pedido, ele não pode sobrar na conexão (viraria o "próximo
        pedido"): descarta se for pequeno; se for grande, fecha a conexão."""
        if self._corpo_lido:
            return
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = 0
        if not tamanho:
            return
        if tamanho <= 64 * 1024:
            try:
                self.rfile.read(tamanho)
                return
            except OSError:
                pass
        self.close_connection = True

    # ── arquivos dos apps

    def estatico(self, caminho_url: str):
        partes = [p for p in urllib.parse.unquote(caminho_url).split("/") if p]
        if any(p.startswith(".") or "\\" in p or "\x00" in p for p in partes):
            return self.erro(404, "Não encontrado.")
        alvo = RAIZ_APPS.joinpath(*partes) if partes else RAIZ_APPS
        real = Path(os.path.realpath(alvo))
        if real != RAIZ_APPS and RAIZ_APPS not in real.parents:
            return self.erro(404, "Não encontrado.")
        if real.is_dir():
            if not caminho_url.endswith("/"):
                self.send_response(301)
                self.send_header("Location", caminho_url + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            real = real / "index.html"
        if not real.is_file():
            return self.erro(404, "Não encontrado.")
        tipo = TIPOS.get(real.suffix.lower()) or mimetypes.guess_type(real.name)[0] or "application/octet-stream"
        self.enviar_arquivo(real, tipo)

    # ── API da ponte

    def autorizado(self, permitir_cookie: bool) -> bool:
        token = self.ponte.token
        if not token:
            return False
        enviado = self.headers.get("X-Ponte-Token", "")
        if enviado and hmac.compare_digest(enviado.encode(), token.encode()):
            return True
        if permitir_cookie:
            for parte in self.headers.get("Cookie", "").split(";"):
                nome, _, valor = parte.strip().partition("=")
                if nome == "lnux_ponte" and hmac.compare_digest(valor.encode(), token.encode()):
                    return True
        return False

    def api(self, rota: str):
        if not host_valido(self.headers.get("Host", ""), self.ponte.hosts_extras):
            raise ErroPonte(403, "Endereço não permitido (use localhost ou o IP do aparelho).")
        if not self.ponte.ligada:
            if rota == "estado":
                return self.responder_json({"ponte": False, "versao": VERSAO, "motivo": "o servidor foi iniciado sem a ponte"})
            raise ErroPonte(404, "A ponte está desligada neste servidor.")
        origem = self.headers.get("Origin")
        if origem and self.command not in ("GET", "HEAD"):
            netloc = urllib.parse.urlsplit(origem).netloc.lower()
            # atrás de um túnel, o Host pode chegar como localhost e o Origin como o endereço público liberado
            if netloc != self.headers.get("Host", "").lower() and nome_do_host(netloc) not in self.ponte.hosts_extras:
                raise ErroPonte(403, "Pedido de outro site recusado.")
        # O cookie só vale para LER arquivos (é o que <video src> e <img src> precisam); o resto exige o cabeçalho
        so_leitura = self.command in ("GET", "HEAD") and rota in ("arquivo", "live2d/core")
        if not self.autorizado(permitir_cookie=so_leitura):
            raise ErroPonte(401, "Falta a chave da ponte. Abra o app pelo LNUX (🌐 Apps Web), que já manda a chave.")

        p = self.parametros()
        m = self.command
        if rota == "estado" and m == "GET":
            return self.responder_json(self.ponte.estado())
        if rota == "entrar" and m == "POST":
            cookie = f"lnux_ponte={self.ponte.token}; Path=/api/; HttpOnly; SameSite=Strict"
            return self.responder_json({"ok": True}, cabecalhos={"Set-Cookie": cookie})
        if rota == "pastas" and m == "GET":
            return self.responder_json(self.listar(p.get("caminho") or "~", p.get("ocultos") == "1"))
        if rota == "info" and m == "GET":
            return self.responder_json(self.info(self.ponte.resolver(p.get("caminho", ""))))
        if rota == "arquivo" and m in ("GET", "HEAD"):
            alvo = self.ponte.resolver(p.get("caminho", ""))
            if not alvo.is_file():
                raise ErroPonte(400, "Isso é uma pasta, não um arquivo.")
            return self.enviar_arquivo(alvo, TIPOS.get(alvo.suffix.lower()) or mimetypes.guess_type(alvo.name)[0] or "application/octet-stream")
        if rota == "arquivo" and m == "PUT":
            return self.gravar(p.get("caminho", ""), p.get("sobrescrever") == "1")
        if rota == "temporario" and m == "PUT":
            destino = self.ponte.temporarios / f"{uuid.uuid4().hex[:8]}-{nome_seguro(p.get('nome', ''), 'envio')}"
            self.receber_para(destino)
            return self.responder_json({"caminho": str(destino), "tamanho": destino.stat().st_size}, 201)
        if rota == "criar-pasta" and m == "POST":
            alvo = self.ponte.resolver(self.ler_json().get("caminho", ""), existir=False)
            alvo.mkdir(parents=True, exist_ok=True)
            return self.responder_json({"caminho": str(alvo)}, 201)
        if rota in ("mover", "copiar") and m == "POST":
            return self.mover_ou_copiar(self.ler_json(), copiar=rota == "copiar")
        if rota == "apagar" and m == "POST":
            return self.apagar(self.ler_json())
        if rota == "midia" and m == "GET":
            return self.responder_json(info_da_midia(self.ponte.resolver(p.get("caminho", ""))))
        if rota == "converter" and m == "POST":
            return self.converter(self.ler_json())
        if rota.startswith("tarefas/"):
            tarefa = self.ponte.tarefas.get(rota.split("/", 1)[1])
            if not tarefa:
                raise ErroPonte(404, "Essa conversão não existe (o servidor foi reiniciado?).")
            if m == "DELETE":
                tarefa.cancelar()
            return self.responder_json(tarefa.resumo())
        if rota == "bateria" and m == "GET":
            return self.responder_json(bateria())
        if rota == "sistema" and m == "GET":
            return self.responder_json(sistema())
        if rota == "area-de-transferencia":
            return self.area_de_transferencia(m)
        if rota == "notificar" and m == "POST":
            d = self.ler_json()
            titulo, texto = str(d.get("titulo") or "LNUX-APPs")[:200], str(d.get("texto") or "")[:2000]
            if shutil.which("termux-notification"):
                rodar(["termux-notification", "--title", titulo, "--content", texto])
            elif shutil.which("notify-send"):
                rodar(["notify-send", titulo, texto])
            else:
                raise ErroPonte(501, "Não achei como mandar notificações neste sistema (instale o libnotify / notify-send).")
            return self.responder_json({"ok": True})
        if rota == "falar" and m == "POST":
            cmd = comando_voz(str(self.ler_json().get("texto") or "")[:5000])
            if not cmd:
                raise ErroPonte(501, "Nenhum leitor de texto instalado (termux-tts-speak, espeak-ng ou spd-say).")
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return self.responder_json({"ok": True})
        if rota == "vibrar" and m == "POST":
            if not shutil.which("termux-vibrate"):
                raise ErroPonte(501, "Vibrar só funciona no celular, com o Termux:API.")
            ms = max(10, min(5000, int(self.ler_json().get("ms") or 200)))
            rodar(["termux-vibrate", "-d", str(ms)])
            return self.responder_json({"ok": True})
        if rota == "executar" and m == "POST":
            return self.executar(self.ler_json())
        if rota == "ia/chaves":
            return self.ia_chaves(m)
        if rota == "ia/proxy" and m == "POST":
            return self.ia_repassar(self.ler_json())
        if rota == "live2d/core":
            return self.live2d_core(m)
        if rota == "mediapipe" or rota.startswith("mediapipe/"):
            return self.mediapipe(m, rota[10:])
        raise ErroPonte(404, f"A ponte não conhece /api/{rota} ({m}).")

    # ── ações

    def ia_chaves(self, metodo: str):
        """GET: quais provedores têm chave (sem mostrar a chave). PUT: guarda ou apaga uma chave, ou os endereços extras."""
        dados = ia_carregar()
        chaves = dados.setdefault("chaves", {})
        if metodo == "PUT":
            d = self.ler_json()
            if "hosts" in d:
                hosts = [str(h).strip().lower() for h in (d.get("hosts") or []) if str(h).strip()]
                if any(not re.fullmatch(r"[a-z0-9.\-]+(:\d{1,5})?", h) for h in hosts):
                    raise ErroPonte(400, "Endereço extra inválido (use só nome ou IP e porta, ex.: 192.168.0.10:11434).")
                dados["hosts"] = hosts[:20]
            if "provedor" in d:
                provedor = str(d.get("provedor", ""))
                if not re.fullmatch(r"[a-z0-9\-]{1,40}", provedor):
                    raise ErroPonte(400, "Nome de provedor inválido.")
                chave = str(d.get("chave") or "").strip()
                if not chave:
                    chaves.pop(provedor, None)
                else:
                    if len(chave) > 400 or any(c in chave for c in "\r\n"):
                        raise ErroPonte(400, "Chave inválida.")
                    _, host_porta, _ = host_do_url(str(d.get("url", "")))
                    chaves[provedor] = {"chave": chave, "host": host_porta, "data": time.strftime("%Y-%m-%d")}
            ia_salvar(dados)
        elif metodo != "GET":
            raise ErroPonte(405, "Use GET ou PUT.")
        return self.responder_json({"provedores": {k: {"host": v.get("host"), "data": v.get("data")} for k, v in chaves.items()},
                                    "hosts": dados.get("hosts", [])})

    def ia_repassar(self, d: dict):
        """Repassa um pedido para um provedor de IA/voz, com a chave guardada, devolvendo a resposta em pedaços
        (as respostas "ao vivo", SSE, chegam ao app enquanto a IA escreve)."""
        url = str(d.get("url", ""))
        metodo = str(d.get("metodo") or "POST").upper()
        if metodo not in ("GET", "POST"):
            raise ErroPonte(400, "Só GET ou POST.")
        dados = ia_carregar()
        if not ia_host_permitido(url, dados.get("hosts", [])):
            raise ErroPonte(403, f"A ponte não repassa para {host_do_url(url)[2]}: só para provedores de IA conhecidos, "
                                 "programas do próprio aparelho e os endereços que você liberar (Companhia › IA).")
        cab = {k: str(v) for k, v in (d.get("cabecalhos") or {}).items() if k.lower() in IA_REPASSAR}
        cab["User-Agent"] = "LNUX-APPs/" + VERSAO
        provedor = str(d.get("provedor") or "")
        guardada = (dados.get("chaves") or {}).get(provedor)
        if guardada and guardada.get("host") == host_do_url(url)[1]:
            # o cabeçalho da chave depende do jeito da API (provedores extras dizem o "tipo": anthropic, gemini...)
            tipo = str(d.get("tipo") or "")
            nome, modelo = IA_CABECALHO.get(provedor) or IA_CABECALHO.get(tipo) or ("Authorization", "Bearer {}")
            cab[nome] = modelo.format(guardada["chave"])
        corpo = d.get("corpo")
        if corpo is not None and not isinstance(corpo, str):
            corpo = json.dumps(corpo, ensure_ascii=False)
        pedido = urllib.request.Request(url, data=corpo.encode("utf-8") if corpo is not None else None, method=metodo, headers=cab)
        local = host_do_url(url)[2] in ("127.0.0.1", "localhost", "::1") or host_do_url(url)[2].startswith("127.")
        abridor = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()
        try:
            resposta = abridor.open(pedido, timeout=float(d.get("tempo") or 300))
            status = resposta.status
        except urllib.error.HTTPError as e:
            resposta, status = e, e.code
        except (urllib.error.URLError, OSError) as e:
            motivo = getattr(e, "reason", e)
            raise ErroPonte(502, f"Não consegui falar com {host_do_url(url)[1]}: {motivo}. "
                                 + ("O programa está ligado nesse endereço?" if local else "Tem internet?"))
        self.send_response(status)
        self.send_header("Content-Type", resposta.headers.get("Content-Type") or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        ler = getattr(resposta, "read1", None) or resposta.read
        try:
            while True:
                bloco = ler(16384)
                if not bloco:
                    break
                self.wfile.write(b"%x\r\n%s\r\n" % (len(bloco), bloco))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        finally:
            resposta.close()

    def live2d_core(self, metodo: str):
        """O núcleo do Live2D (Cubism Core) é da Live2D Inc. e não vem junto: a ponte baixa uma vez do site oficial
        (ou recebe o arquivo que você baixou) e guarda em ~/.lnux-apps/live2d/."""
        destino = DADOS / "live2d" / "live2dcubismcore.min.js"
        if metodo in ("GET", "HEAD"):
            if not destino.is_file():
                raise ErroPonte(404, "O núcleo do Live2D ainda não foi baixado.")
            return self.enviar_arquivo(destino, "text/javascript; charset=utf-8")
        if metodo == "POST":  # baixar do site oficial
            try:
                with urllib.request.urlopen(urllib.request.Request(LIVE2D_CORE_URL, headers={"User-Agent": "LNUX-APPs/" + VERSAO}), timeout=60) as r:
                    dados = r.read(4 * 1024 * 1024)
            except (urllib.error.URLError, OSError) as e:
                raise ErroPonte(502, f"Não consegui baixar o núcleo do Live2D ({getattr(e, 'reason', e)}). Tem internet?")
        elif metodo == "PUT":  # o arquivo que a pessoa baixou do site da Live2D
            dados = self.ler_corpo(limite=4 * 1024 * 1024)
        else:
            raise ErroPonte(405, "Use GET, POST (baixar) ou PUT (enviar o arquivo).")
        if b"Live2DCubismCore" not in dados[:200000]:
            raise ErroPonte(400, "Esse arquivo não é o live2dcubismcore.min.js do Live2D.")
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(dados)
        return self.responder_json({"ok": True, "tamanho": len(dados)})

    def mediapipe(self, metodo: str, nome: str):
        """Os arquivos do rastreamento pela câmera (Companhia): GET /api/mediapipe diz quais já estão guardados,
        GET /api/mediapipe/<nome> entrega um, POST /api/mediapipe {"arquivos": [...]} baixa os que faltam."""
        pasta = DADOS / "mediapipe" / MEDIAPIPE_VERSAO
        if metodo in ("GET", "HEAD") and nome:
            if nome not in MEDIAPIPE_ARQUIVOS:
                raise ErroPonte(404, "A ponte não tem esse arquivo do rastreamento.")
            alvo = pasta / nome
            if not alvo.is_file():
                raise ErroPonte(404, "Esse arquivo do rastreamento ainda não foi baixado.")
            return self.enviar_arquivo(alvo, TIPOS.get(alvo.suffix.lower()) or "application/octet-stream")
        if metodo == "POST" and not nome:
            pedidos = [str(n) for n in (self.ler_json().get("arquivos") or [])]
            if not pedidos or any(n not in MEDIAPIPE_ARQUIVOS for n in pedidos):
                raise ErroPonte(400, "Diga quais arquivos do rastreamento baixar: " + ", ".join(MEDIAPIPE_ARQUIVOS))
            with MEDIAPIPE_TRAVA:  # um pedido de cada vez (o pacote do npm traz dois arquivos)
                faltam = [n for n in pedidos if not (pasta / n).is_file()]
                if any(MEDIAPIPE_ARQUIVOS[n][0] == "pacote" for n in faltam):
                    pacote = pasta / "pacote.tgz"
                    baixar_para(MEDIAPIPE_PACOTE, pacote, 80 * 1024 * 1024)
                    try:
                        with tarfile.open(pacote, "r:gz") as tgz:
                            for n, (origem, dentro) in MEDIAPIPE_ARQUIVOS.items():
                                if origem != "pacote":
                                    continue
                                membro = tgz.extractfile(dentro)
                                if membro is None:
                                    raise ErroPonte(502, f"O pacote do MediaPipe veio sem {dentro}.")
                                tmp = pasta / (n + ".baixando")
                                with open(tmp, "wb") as f:
                                    shutil.copyfileobj(membro, f)
                                os.replace(tmp, pasta / n)
                    except (tarfile.TarError, KeyError, OSError) as e:
                        raise ErroPonte(502, f"O pacote do MediaPipe veio com defeito ({e}).")
                    finally:
                        pacote.unlink(missing_ok=True)
                for n in faltam:
                    if MEDIAPIPE_ARQUIVOS[n][0] == "modelo":
                        baixar_para(MEDIAPIPE_MODELOS + MEDIAPIPE_ARQUIVOS[n][1], pasta / n, 60 * 1024 * 1024)
        elif not (metodo == "GET" and not nome):
            raise ErroPonte(405, "Use GET (ver ou pegar) ou POST (baixar).")
        return self.responder_json({"versao": MEDIAPIPE_VERSAO,
                                    "arquivos": {n: ((pasta / n).stat().st_size if (pasta / n).is_file() else None) for n in MEDIAPIPE_ARQUIVOS}})

    def listar(self, caminho: str, ocultos: bool) -> dict:
        pasta = self.ponte.resolver(caminho)
        if not pasta.is_dir():
            raise ErroPonte(400, "Isso não é uma pasta.")
        itens = []
        try:
            entradas = list(os.scandir(pasta))
        except PermissionError:
            raise ErroPonte(403, f"Sem permissão para abrir {pasta}.")
        for e in entradas:
            if not ocultos and e.name.startswith("."):
                continue
            try:
                eh_pasta = e.is_dir()
                st = e.stat()
            except OSError:
                continue
            itens.append({"nome": e.name, "caminho": str(pasta / e.name), "tipo": "pasta" if eh_pasta else "arquivo",
                          "tamanho": 0 if eh_pasta else st.st_size, "modificado": int(st.st_mtime)})
        itens.sort(key=lambda i: (i["tipo"] != "pasta", i["nome"].lower()))
        return {"caminho": str(pasta), "pai": str(pasta.parent) if self.ponte.dentro(pasta.parent) else None, "itens": itens}

    def info(self, alvo: Path) -> dict:
        st = alvo.stat()
        return {"nome": alvo.name, "caminho": str(alvo), "tipo": "pasta" if alvo.is_dir() else "arquivo",
                "tamanho": st.st_size, "modificado": int(st.st_mtime),
                "mime": TIPOS.get(alvo.suffix.lower()) or mimetypes.guess_type(alvo.name)[0]}

    def gravar(self, caminho: str, sobrescrever: bool):
        destino = self.ponte.resolver(caminho, existir=False)
        if destino.is_dir():
            raise ErroPonte(400, "Já existe uma pasta com esse nome.")
        if destino.exists() and not sobrescrever:
            raise ErroPonte(409, f"Já existe {destino.name}.")
        if not destino.parent.is_dir():
            raise ErroPonte(404, f"A pasta {destino.parent} não existe.")
        self.receber_para(destino)
        return self.responder_json({"caminho": str(destino), "tamanho": destino.stat().st_size}, 201)

    def mover_ou_copiar(self, d: dict, copiar: bool):
        origem = self.ponte.resolver(str(d.get("de", "")))
        destino = self.ponte.resolver(str(d.get("para", "")), existir=False)
        if destino.exists() and not d.get("sobrescrever"):
            raise ErroPonte(409, f"Já existe {destino.name}.")
        if origem.is_dir() and (destino == origem or origem in destino.parents):
            raise ErroPonte(400, "Não dá para pôr uma pasta dentro dela mesma.")
        if copiar:
            if origem.is_dir():
                shutil.copytree(origem, destino, dirs_exist_ok=bool(d.get("sobrescrever")))
            else:
                shutil.copy2(origem, destino)
        else:
            shutil.move(str(origem), str(destino))
        return self.responder_json({"caminho": str(destino)})

    def apagar(self, d: dict):
        alvo = self.ponte.resolver(str(d.get("caminho", "")))
        if alvo in self.ponte.raizes:
            raise ErroPonte(403, "Não dá para apagar uma das pastas principais.")
        if alvo.is_dir():
            if any(alvo.iterdir()) and not d.get("recursivo"):
                raise ErroPonte(409, "A pasta não está vazia.")
            shutil.rmtree(alvo)
        else:
            alvo.unlink()
        return self.responder_json({"ok": True})

    def converter(self, d: dict):
        if not shutil.which("ffmpeg"):
            raise ErroPonte(501, "O ffmpeg não está instalado (no LNUX: ⚙️ Sistema › Instalar dependências).")
        perfil = str(d.get("perfil", ""))
        if perfil not in PERFIS:
            raise ErroPonte(400, f"Formato desconhecido: {perfil}. Os que existem: {', '.join(sorted(PERFIS))}.")
        entrada = self.ponte.resolver(str(d.get("entrada", "")))
        if not entrada.is_file():
            raise ErroPonte(400, "A entrada precisa ser um arquivo.")
        extensao = PERFIS[perfil][1]
        if d.get("saida"):
            saida = self.ponte.resolver(str(d["saida"]), existir=False)
            if saida.exists() and not d.get("sobrescrever"):
                raise ErroPonte(409, f"Já existe {saida.name}.")
            if not saida.parent.is_dir():
                raise ErroPonte(404, f"A pasta {saida.parent} não existe.")
        else:
            saida = self.ponte.temporarios / f"{nome_seguro(entrada.stem)[:60]}-{uuid.uuid4().hex[:6]}.{extensao}"
        if saida == entrada:
            raise ErroPonte(400, "A saída não pode ser o próprio arquivo de entrada.")
        tarefa = Tarefa(self.ponte, entrada, saida, perfil, d.get("opcoes") or {})
        with self.ponte.trava:
            # guarda só as 50 mais recentes
            for velha in sorted(self.ponte.tarefas.values(), key=lambda t: t.criada)[:-49]:
                if velha.estado not in ("rodando", "na_fila"):
                    self.ponte.tarefas.pop(velha.id, None)
            self.ponte.tarefas[tarefa.id] = tarefa
        threading.Thread(target=tarefa.rodar, daemon=True).start()
        return self.responder_json(tarefa.resumo(), 202)

    def area_de_transferencia(self, metodo: str):
        if metodo == "GET":
            cmd = comando_area("ler")
            if not cmd:
                raise ErroPonte(501, "Não achei a área de transferência (instale wl-clipboard ou xclip; no celular, o Termux:API).")
            return self.responder_json({"texto": rodar(cmd).stdout})
        if metodo == "POST":
            cmd = comando_area("escrever")
            if not cmd:
                raise ErroPonte(501, "Não achei a área de transferência (instale wl-clipboard ou xclip; no celular, o Termux:API).")
            rodar(cmd, entrada=str(self.ler_json().get("texto", "")))
            return self.responder_json({"ok": True})
        raise ErroPonte(405, "Use GET ou POST.")

    def executar(self, d: dict):
        if not self.ponte.comandos:
            raise ErroPonte(403, "Rodar comandos está desligado na ponte. Para ligar: inicie o servidor com "
                                 "--permitir-comandos (ou \"comandos\": true em ~/.lnux-apps/ponte.json).")
        cmd = d.get("comando")
        if not isinstance(cmd, list) or not cmd or not all(isinstance(c, str) for c in cmd):
            raise ErroPonte(400, "O comando precisa ser uma lista de textos, ex.: [\"ls\", \"-l\"].")
        pasta = self.ponte.resolver(str(d.get("pasta") or "~"))
        tempo = max(1, min(600, int(d.get("tempo") or 60)))
        try:
            r = subprocess.run(cmd, cwd=pasta, capture_output=True, timeout=tempo)
        except FileNotFoundError:
            raise ErroPonte(404, f"Programa não encontrado: {cmd[0]}")
        corta = lambda b: b[-1_000_000:].decode("utf-8", "replace")
        return self.responder_json({"codigo": r.returncode, "saida": corta(r.stdout), "erros": corta(r.stderr)})


def criar_servidor(endereco: str, porta: int, ponte: Ponte) -> ThreadingHTTPServer:
    classe = type("ManipuladorComPonte", (Manipulador,), {"ponte": ponte})
    servidor = ThreadingHTTPServer((endereco, porta), classe)
    servidor.daemon_threads = True
    return servidor


def ip_local() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def abrir_navegador(url: str):
    for cmd in (["termux-open-url", url], ["xdg-open", url], ["open", url]):
        if shutil.which(cmd[0]):
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    import webbrowser
    webbrowser.open(url)


def main(argv: list | None = None) -> int:
    ap = argparse.ArgumentParser(description="Servidor dos LNUX-APPs, com a ponte local para o aparelho.")
    ap.add_argument("--porta", type=int, default=int(os.environ.get("LNUX_APPS_PORTA", 8095)))
    ap.add_argument("--endereco", default="127.0.0.1", help="127.0.0.1 = só este aparelho (padrão); 0.0.0.0 = a rede toda")
    ap.add_argument("--sem-ponte", action="store_true", help="só entrega os apps, sem acesso a arquivos e ao aparelho")
    ap.add_argument("--permitir-comandos", action="store_true", help="deixa os apps rodarem programas (cuidado)")
    ap.add_argument("--raiz", action="append", default=[], help="libera mais uma pasta para a ponte (pode repetir)")
    ap.add_argument("--abrir", action="store_true", help="abre a página inicial no navegador")
    ap.add_argument("--mostrar-token", action="store_true", help="mostra a chave da ponte e sai")
    ap.add_argument("--permitir-host", action="append", default=[], metavar="DOMINIO",
                    help="aceita este domínio no endereço (o de um túnel, ex.: abc.trycloudflare.com); pode repetir")
    ap.add_argument("--sem-comandos", action="store_true", help="nunca deixa os apps rodarem programas (mesmo se a configuração deixar)")
    args = ap.parse_args(argv)

    if args.mostrar_token:
        print(carregar_config()["token"])
        return 0
    ponte = Ponte(not args.sem_ponte, args.raiz, args.permitir_comandos and not args.sem_comandos, args.permitir_host, args.sem_comandos)
    try:
        servidor = criar_servidor(args.endereco, args.porta, ponte)
    except OSError as e:
        print(f"Não deu para usar a porta {args.porta}: {e}. Já tem outro servidor nela? Use --porta.", file=sys.stderr)
        return 1
    base = f"http://127.0.0.1:{args.porta}/"
    url = base + (f"#token={ponte.token}" if ponte.ligada else "")
    print(f"LNUX-APPs {VERSAO} — {nome_do_sistema()}")
    print(f"  Abra: {url}")
    if args.endereco == "0.0.0.0":
        print(f"  Na rede: http://{ip_local()}:{args.porta}/  (a ponte ainda exige a chave)")
    for h in ponte.hosts_extras:
        print(f"  Aceitando também o endereço https://{h}/ (túnel)" + ("  (a ponte ainda exige a chave)" if ponte.ligada else ""))
    if ponte.ligada:
        print(f"  Ponte ligada · pastas liberadas: {', '.join(str(r) for r in ponte.raizes)}")
        print(f"  ffmpeg: {'sim' if shutil.which('ffmpeg') else 'não instalado'} · comandos: {'LIGADOS' if ponte.comandos else 'desligados'}")
    else:
        print("  Ponte desligada: os apps funcionam só com o que o navegador oferece.")
    print("  Para parar: Ctrl+C")
    sys.stdout.flush()
    if args.abrir:
        abrir_navegador(url)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nParando.")
    finally:
        for t in list(ponte.tarefas.values()):
            t.cancelar()
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
