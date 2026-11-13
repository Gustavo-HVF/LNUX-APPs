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
    python3 servidor/lnux_apps.py --so-app companhia    # publica só a Companhia (salas e loja; sem os outros apps)
    python3 servidor/lnux_apps.py --mostrar-token       # mostra a chave e sai

Publicar um app sozinho (--so-app): o endereço entrega só esse app (a página inicial dos Apps Web e os outros apps
não abrem) e quem chega pela rede ou pela internet (um túnel) nunca usa a ponte, nem com a chave: só as salas e a
loja da Companhia. A chave da ponte só vale para quem abre no próprio aparelho (127.0.0.1).

Só precisa do Python 3.9 ou mais novo (biblioteca padrão). O ffmpeg é opcional.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
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

# Companhia, cenários: converter .blend (Blender) para .glb. Quando o Blender está instalado no aparelho (o programa
# "blender", ou o módulo "bpy" do Python), a ponte pede a ele que abra o arquivo e exporte em glTF: sai igual ao que
# o Blender mostra, com os modificadores aplicados. Sem ele, a Companhia usa o leitor próprio (mais simples).
# O arquivo é aberto sem rodar os scripts que ele traz (--disable-autoexec) e só o exportador de glTF é chamado.
BLENDER_SCRIPT = r"""
import bpy, os, sys
saida = sys.argv[sys.argv.index("--") + 1]
try:  # texturas que ficaram ao lado do arquivo (em qualquer subpasta)
    bpy.ops.file.find_missing_files(directory=os.path.dirname(bpy.data.filepath))
except Exception:
    pass
opcoes = dict(filepath=saida, export_format="GLB", export_apply=True, export_cameras=False, export_lights=False, export_animations=False)
while True:
    try:
        bpy.ops.export_scene.gltf(**opcoes)
        break
    except TypeError as e:  # uma opcao que esta versao do Blender nao tem
        sobra = [k for k in opcoes if k != "filepath" and k in str(e)]
        if not sobra:
            raise
        for k in sobra:
            opcoes.pop(k)
"""
BLENDER_ACHADO: dict = {}
BLENDER_TRAVA = threading.Lock()

# Companhia, salas: jogar com outras pessoas no mesmo cenário. A sala fica na memória deste servidor. Quem abre a
# Companhia por este servidor vê a lista das salas públicas e entra; cria uma sala quem tem a chave da ponte e, se o
# dono deixar ("salas_visitantes" em ponte.json, ligado por padrão), qualquer um que chegou pelo link. Quem cria
# escolhe nome, descrição, se a sala é pública (aparece na lista) ou privada (só com o link), senha, quantas pessoas
# cabem, se tem bate-papo e o cenário (enviado ou um mundo da loja). O código da sala só dá acesso a ela (o
# cenário, as personagens, as posições e o bate-papo), nunca às pastas do aparelho. Os arquivos da sala ficam em
# ~/.lnux-apps/tmp/salas/<código>/ e somem quando ela fecha.
SALAS: dict = {}
SALAS_TRAVA = threading.Lock()
SALA_MAXIMO = 12           # salas ao mesmo tempo
SALA_POR_PESSOA = 3        # salas abertas ao mesmo tempo por quem não é o dono (pelo endereço de quem criou)
SALA_PESSOAS = 16          # pessoas por sala (no máximo; quem cria pode pôr menos)
RESERVA_DISCO = 300 * 1024 * 1024  # envios (cenário, personagens, loja) não podem deixar o aparelho com menos que isto livre
SALA_SUMIU = 20            # segundos sem notícia de uma pessoa: ela saiu
SALA_VAZIA = 900           # segundos sem ninguém: a sala fecha
SALA_LETRAS = "abcdefghjkmnpqrstuvwxyz23456789"  # sem as que se confundem (i, l, o, 0, 1)

# Companhia, loja: personagens, mundos e animações guardados NESTE aparelho, numa pasta própria (~/.lnux-apps/loja,
# ou "loja" em ponte.json, ou --loja), com uma subpasta por tipo. Quem entra pelo link vê a loja, experimenta (a
# prévia 3D é no navegador dela), baixa para usar e, se o dono deixar, publica as suas. Arquivos postos à mão nas
# subpastas também aparecem. É a única pasta do aparelho que os visitantes alcançam.
LOJA_TIPOS = {  # tipo → (subpasta, extensões aceitas)
    "personagem": ("personagens", (".vrm",)),
    "mundo": ("mundos", (".glb",)),
    "animacao": ("animacoes", (".vrma", ".bvh", ".fbx", ".glb")),
}
LOJA_MINIATURA = 3 * 1024 * 1024
LOJA_TRAVA = threading.Lock()


class Sala:
    def __init__(self, codigo: str, nome: str, pasta: Path, origem: str = ""):
        self.codigo, self.nome, self.pasta = codigo, nome, pasta
        self.chave = secrets.token_urlsafe(18)   # de quem criou: trocar o cenário, mudar as opções e fechar a sala
        self.origem = origem                     # de onde veio quem criou (para o limite de salas por pessoa)
        self.criada = int(time.time())
        self.descricao = ""
        self.publica = True                      # aparece na lista; privada: só com o link (o código)
        self.senha = ""                          # hash da senha (vazio: sem senha)
        self.max = SALA_PESSOAS
        self.bate_papo = True
        self.criador = ""                        # o nome de quem criou (aparece na lista)
        self.miniatura = 0                       # versão da miniatura (0: sem)
        self.vista = time.time()
        self.pessoas: dict = {}                  # id → {nome, segredo, visto, estado, avatar}
        self.mensagens: list = []
        self.n = 0
        self.mapa: dict | None = None            # {nome, tamanho, versao, ajuste}
        self.versao_mapa = 0
        self.videos = "todos"                    # quem pode pôr um vídeo na tela: "todos" ou "dono" (só quem criou)
        self.n_video = 0                         # a versão dos vídeos (cada mudança ganha um número novo)
        self.trava = threading.Lock()

    def resumo(self) -> dict:
        return {"codigo": self.codigo, "nome": self.nome, "descricao": self.descricao, "pessoas": len(self.pessoas), "max": self.max,
                "publica": self.publica, "senha": bool(self.senha), "bate_papo": self.bate_papo, "criador": self.criador,
                "criada": self.criada, "miniatura": self.miniatura, "mapa": self.mapa, "videos": self.videos}

    def configurar(self, d: dict):
        """As opções de quem cria (ou de quem criou, depois): o que vier no pedido muda; o resto fica."""
        if "nome" in d:
            self.nome = sala_texto(d.get("nome"), 40) or self.nome
        if "descricao" in d:
            self.descricao = sala_texto(d.get("descricao"), 200)
        if "publica" in d:
            self.publica = bool(d["publica"])
        if "senha" in d:
            senha = str(d.get("senha") or "")[:64]
            self.senha = hashlib.sha256((self.codigo + ":" + senha).encode()).hexdigest() if senha else ""
        if "max" in d:
            try:
                self.max = max(2, min(SALA_PESSOAS, int(d["max"])))
            except (TypeError, ValueError):
                pass
        if "bate_papo" in d:
            self.bate_papo = bool(d["bate_papo"])
        if "criador" in d and not self.criador:
            self.criador = sala_texto(d.get("criador"), 24)
        if "videos" in d:
            self.videos = "dono" if d.get("videos") == "dono" else "todos"
            if self.videos == "dono":  # os vídeos de quem não criou somem
                for j in self.pessoas.values():
                    if not j.get("dono"):
                        j["video"] = None

    def senha_confere(self, senha) -> bool:
        if not self.senha:
            return True
        tentativa = hashlib.sha256((self.codigo + ":" + str(senha or "")[:64]).encode()).hexdigest()
        return hmac.compare_digest(tentativa.encode(), self.senha.encode())

    def limpar(self, agora: float):
        """Tira quem parou de dar notícia (fechou a aba, perdeu a internet)."""
        for pid in [i for i, j in self.pessoas.items() if agora - j["visto"] > SALA_SUMIU]:
            self.tirar(pid)

    def tirar(self, pid: str):
        if self.pessoas.pop(pid, None) is not None:
            (self.pasta / f"avatar-{pid}.vrm").unlink(missing_ok=True)
            (self.pasta / f"aparencia-{pid}.json").unlink(missing_ok=True)
            for f in self.pasta.glob(f"textura-{pid}-*"):
                f.unlink(missing_ok=True)


# ── Companhia: contas (cadastro, código por e-mail, entrar, perfil) ─────
# As contas ficam NESTE aparelho: ~/.lnux-apps/contas/contas.json (permissão 600) e as fotos em contas/midia/. A
# senha é guardada só como hash (PBKDF2-SHA256, com sal); os códigos e as sessões também só como hash. O código de
# verificação vai por e-mail, pela conta de e-mail do dono do servidor (SMTP, configurada por ele na Companhia:
# ~/.lnux-apps/email.json, permissão 600). A idade mínima (13 anos por padrão) e "só entra quem tem conta" são do dono.
CONTAS_TRAVA = threading.Lock()
CONTA_ITERACOES = 150_000
CONTA_SESSAO_DIAS = 60
CODIGO_VALE = 15 * 60          # o código vale 15 minutos
CODIGO_TENTATIVAS = 5
CODIGO_ESPERA = 60             # segundos entre um envio e outro
CODIGO_POR_HORA = 5
CONTA_PENDENTE_DIAS = 2        # cadastro sem confirmar o código some depois de 2 dias
CONTA_MIDIA = 5 * 1024 * 1024  # foto e capa do perfil
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}")
TENTATIVAS: dict = {}          # chave → [instantes] (entrar errado, cadastros): contra quem tenta adivinhar


def hash_senha(senha: str, sal: bytes | None = None) -> dict:
    sal = sal or secrets.token_bytes(16)
    return {"sal": sal.hex(), "hash": hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, CONTA_ITERACOES).hex(), "it": CONTA_ITERACOES}


def senha_confere(senha: str, guardada: dict) -> bool:
    try:
        feito = hashlib.pbkdf2_hmac("sha256", str(senha).encode("utf-8"), bytes.fromhex(guardada["sal"]), int(guardada.get("it", CONTA_ITERACOES))).hex()
    except (KeyError, ValueError, TypeError):
        return False
    return hmac.compare_digest(feito, guardada.get("hash", ""))


def resumo_hash(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def esconder_email(email: str) -> str:
    nome, _, dominio = email.partition("@")
    return (nome[:2] + "***" if len(nome) > 2 else nome[:1] + "***") + "@" + dominio


def contar_tentativa(chave: str, limite: int, janela: float) -> None:
    """Recusa (429) quem passou do limite de tentativas na janela (em segundos)."""
    agora = time.time()
    lista = [t for t in TENTATIVAS.get(chave, []) if agora - t < janela]
    if len(lista) >= limite:
        TENTATIVAS[chave] = lista
        raise ErroPonte(429, "Tentativas demais. Espere alguns minutos e tente de novo.")
    lista.append(agora)
    TENTATIVAS[chave] = lista


class Contas:
    """O cadastro das pessoas (contas.json): contas, códigos pendentes e sessões."""

    def __init__(self, pasta: Path):
        self.pasta = pasta
        self.arquivo = pasta / "contas.json"
        self.midia = pasta / "midia"
        self.dados: dict | None = None

    def ler(self) -> dict:
        if self.dados is None:
            try:
                self.dados = json.loads(self.arquivo.read_text("utf-8"))
            except (OSError, ValueError):
                self.dados = {}
            for k in ("contas", "codigos", "sessoes"):
                self.dados.setdefault(k, {})
        d, agora = self.dados, time.time()
        # limpeza: cadastros nunca confirmados, códigos e sessões vencidos
        for cid in [i for i, c in d["contas"].items() if not c.get("verificada") and agora - c.get("criada", 0) > CONTA_PENDENTE_DIAS * 86400]:
            d["contas"].pop(cid, None)
        for k in [k for k, c in d["codigos"].items() if agora > c.get("expira", 0) + 3600]:
            d["codigos"].pop(k, None)
        for k in [k for k, x in d["sessoes"].items() if agora - x.get("vista", 0) > CONTA_SESSAO_DIAS * 86400 or x.get("conta") not in d["contas"]]:
            d["sessoes"].pop(k, None)
        return d

    def gravar(self) -> None:
        self.pasta.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.pasta, 0o700)
        except OSError:
            pass
        temporario = self.arquivo.with_suffix(".tmp")
        temporario.write_text(json.dumps(self.dados, ensure_ascii=False, indent=1), "utf-8")
        os.chmod(temporario, 0o600)
        os.replace(temporario, self.arquivo)

    def por_email(self, email: str) -> dict | None:
        return next((c for c in self.ler()["contas"].values() if c["email"] == email), None)

    def nova_sessao(self, conta: dict) -> str:
        token = secrets.token_urlsafe(32)
        self.ler()["sessoes"][resumo_hash(token)] = {"conta": conta["id"], "criada": int(time.time()), "vista": int(time.time())}
        return token

    def da_sessao(self, token: str) -> dict | None:
        if not token:
            return None
        d = self.ler()
        x = d["sessoes"].get(resumo_hash(token))
        if not x:
            return None
        conta = d["contas"].get(x["conta"])
        if conta and time.time() - x.get("vista", 0) > 3600:
            x["vista"] = int(time.time())
        return conta

    @staticmethod
    def perfil_publico(c: dict) -> dict:
        p = c.get("perfil", {})
        return {"id": c["id"], "nome": c["nome"], "bio": p.get("bio", ""), "pronomes": p.get("pronomes", ""), "local": p.get("local", ""),
                "links": p.get("links", []), "cor": p.get("cor", ""), "foto": p.get("foto", 0), "capa": p.get("capa", 0), "desde": c.get("criada", 0)}

    @classmethod
    def perfil_proprio(cls, c: dict) -> dict:
        return {**cls.perfil_publico(c), "email": c["email"], "idade": c.get("idade"), "verificada": bool(c.get("verificada"))}


CONTAS: dict = {}  # pasta → Contas (uma por pasta de dados)


def contas_de(dados: Path) -> Contas:
    pasta = dados / "contas"
    if str(pasta) not in CONTAS:
        CONTAS[str(pasta)] = Contas(pasta)
    return CONTAS[str(pasta)]


def email_config() -> dict:
    try:
        return json.loads((DADOS / "email.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def email_configurado(cfg: dict | None = None) -> bool:
    cfg = cfg if cfg is not None else email_config()
    return bool(cfg.get("servidor") and cfg.get("remetente"))


def mandar_email(para: str, assunto: str, texto: str) -> None:
    """Manda um e-mail pela conta de e-mail que o dono configurou (SMTP)."""
    import smtplib
    import ssl
    from email.message import EmailMessage
    from email.utils import formataddr
    cfg = email_config()
    if not email_configurado(cfg):
        raise ErroPonte(503, "O dono deste servidor ainda não configurou o envio de e-mails (Companhia › Contas › E-mail).")
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = formataddr((cfg.get("nome") or "Companhia", cfg["remetente"]))
    msg["To"] = para
    msg.set_content(texto)
    seguranca, porta = cfg.get("seguranca", "starttls"), int(cfg.get("porta") or (465 if cfg.get("seguranca") == "ssl" else 587))
    try:
        if seguranca == "ssl":
            conexao = smtplib.SMTP_SSL(cfg["servidor"], porta, context=ssl.create_default_context(), timeout=25)
        else:
            conexao = smtplib.SMTP(cfg["servidor"], porta, timeout=25)
            if seguranca == "starttls":
                conexao.starttls(context=ssl.create_default_context())
        with conexao:
            if cfg.get("usuario"):
                conexao.login(cfg["usuario"], cfg.get("senha", ""))
            conexao.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        raise ErroPonte(502, f"Não consegui mandar o e-mail ({type(e).__name__}: {e}). Confira o e-mail do servidor (Companhia › Contas › E-mail).")


def cabe_no_disco(pasta: Path, tamanho: int) -> None:
    """Recusa um envio que deixaria o aparelho quase sem espaço (é o único limite de tamanho)."""
    try:
        livre = shutil.disk_usage(pasta).free
    except OSError:
        return
    if tamanho > livre - RESERVA_DISCO:
        raise ErroPonte(507, f"Não cabe: o aparelho que guarda isso tem só {max(0, livre - RESERVA_DISCO) // (1024 * 1024)} MB livres para envios.")


def formato_confere(caminho: Path, ext: str) -> bool:
    """O começo do arquivo bate com o formato (um .vrm é mesmo um glTF, um .bvh começa por HIERARCHY...)."""
    try:
        with open(caminho, "rb") as f:
            cabeca = f.read(4096)
    except OSError:
        return False
    if ext in (".vrm", ".glb", ".vrma"):
        return cabeca[:4] == b"glTF"
    if ext == ".bvh":
        return cabeca.lstrip(b"\xef\xbb\xbf \t\r\n").upper().startswith(b"HIERARCHY")
    if ext == ".fbx":
        return cabeca.startswith(b"Kaydara FBX Binary") or b"FBXHeaderExtension" in cabeca or cabeca.lstrip().startswith(b"; FBX")
    return False


def tipo_de_imagem(dados: bytes) -> str | None:
    if dados.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if dados.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return "webp"
    return None


def segundos_do_video(valor, negativo: bool = False) -> float:
    """Um tempo do vídeo em segundos (de 0 a 24 horas; com negativo, pode voltar)."""
    try:
        t = float(valor or 0)
    except (TypeError, ValueError):
        raise ErroPonte(400, "Tempo do vídeo inválido.")
    if not math.isfinite(t):
        raise ErroPonte(400, "Tempo do vídeo inválido.")
    return max(-86400.0 if negativo else 0.0, min(86400.0, t))


def lugar_do_video(d: dict) -> dict:
    """Onde fica a tela: seguindo a personagem de quem pôs (modo "seguir") ou parada num lugar (pos, rumo); e a largura."""
    try:
        pos = [float(x) for x in (d.get("pos") or [0, 0, 0])]
        rumo = float(d.get("rumo") or 0)
        tamanho = float(d.get("tamanho") or 2)
    except (TypeError, ValueError):
        raise ErroPonte(400, "Lugar da tela inválido.")
    if len(pos) != 3 or not all(math.isfinite(x) and abs(x) < 1e5 for x in pos + [rumo, tamanho]):
        raise ErroPonte(400, "Lugar da tela inválido.")
    return {"modo": "parada" if d.get("modo") == "parada" else "seguir", "pos": [round(x, 3) for x in pos], "rumo": round(rumo, 4),
            "tamanho": round(max(0.5, min(12.0, tamanho)), 2)}


def sala_texto(valor, limite: int) -> str:
    """Um texto vindo de fora: sem caracteres de controle, com tamanho máximo."""
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(valor or "")).strip()[:limite]


def salas_limpar(agora: float):
    with SALAS_TRAVA:
        for codigo in [c for c, sala in SALAS.items() if not sala.pessoas and agora - sala.vista > SALA_VAZIA]:
            shutil.rmtree(SALAS.pop(codigo).pasta, ignore_errors=True)


def blender_programa(conferir_bpy: bool = True) -> tuple | None:
    """("blender", caminho do programa) ou ("bpy", python com o módulo bpy), ou None. LNUX_APPS_BLENDER aponta outro."""
    if "resposta" in BLENDER_ACHADO:
        return BLENDER_ACHADO["resposta"]
    escolhido = os.environ.get("LNUX_APPS_BLENDER", "").strip()
    candidatos = [escolhido] if escolhido else []
    candidatos += [shutil.which("blender") or "", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender",
                   str(HOME / ".local/share/flatpak/exports/bin/org.blender.Blender"), "/Applications/Blender.app/Contents/MacOS/Blender"]
    for c in candidatos:
        if c and (shutil.which(c) or Path(c).is_file()):
            if "python" in Path(c).name.lower():  # um Python que tem o módulo bpy (pip install bpy)
                BLENDER_ACHADO["resposta"] = ("bpy", c)
            else:
                BLENDER_ACHADO["resposta"] = ("blender", shutil.which(c) or c)
            return BLENDER_ACHADO["resposta"]
    if not conferir_bpy:
        return None
    try:  # o módulo bpy no mesmo Python da ponte (demora um pouco para conferir; fica guardado)
        tem = subprocess.run([sys.executable, "-c", "import bpy"], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.SubprocessError):
        tem = False
    BLENDER_ACHADO["resposta"] = ("bpy", sys.executable) if tem else None
    return BLENDER_ACHADO["resposta"]


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


def gravar_config(config: dict) -> None:
    """Grava ~/.lnux-apps/ponte.json (permissão 600)."""
    arquivo = DADOS / "ponte.json"
    temporario = arquivo.with_suffix(".tmp")
    temporario.write_text(json.dumps(config, ensure_ascii=False, indent=2), "utf-8")
    os.chmod(temporario, 0o600)
    os.replace(temporario, arquivo)


def app_do_catalogo(app_id: str) -> dict | None:
    """O app com esse id no apps.json (com o "caminho" dele), ou None."""
    try:
        dados = json.loads((RAIZ_APPS / "apps.json").read_text("utf-8"))
    except (OSError, ValueError):
        return None
    for a in dados.get("apps", []):
        if isinstance(a, dict) and a.get("id") == app_id and a.get("caminho"):
            return a
    return None


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

    def __init__(self, ligada: bool, raizes_extras: list, permitir_comandos: bool, hosts_extras: tuple = (), sem_comandos: bool = False,
                 so_app: dict | None = None, loja: str | None = None):
        self.ligada = ligada
        self.config = carregar_config() if ligada else {}
        self.token = self.config.get("token", "")
        # --so-app: o endereço entrega só este app ({id, caminho, ...} do apps.json), e a ponte só vale no próprio aparelho
        self.so_app = so_app
        # a loja da Companhia (personagens, mundos e animações que as pessoas publicam neste aparelho)
        self.loja = Path(os.path.expanduser(loja or self.config.get("loja") or str(DADOS / "loja")))
        # --sem-comandos vale mais que a configuração (ex.: servidor aberto pela internet, por um túnel)
        self.comandos = bool(permitir_comandos or self.config.get("comandos")) and not sem_comandos
        # domínios aceitos no Host/Origin além de localhost e IPs: o endereço de um túnel (cloudflared...)
        self.hosts_extras = tuple(nome_do_host(h) for h in hosts_extras if h)
        self.temporarios = DADOS / "tmp"
        if ligada:  # antes de montar a lista: na primeira vez a pasta ainda não existe e ficaria de fora
            self.temporarios.mkdir(parents=True, exist_ok=True)
            shutil.rmtree(self.temporarios / "salas", ignore_errors=True)  # as salas vivem na memória: o que ficou é de antes
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
                elif f.is_dir() and f.name.startswith("blender-") and f.stat().st_mtime < limite:
                    shutil.rmtree(f, ignore_errors=True)  # conversões do Blender que ficaram para trás
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
                # Companhia: converter cenários .blend com o Blender do aparelho (a rota existe; /api/blender diz se ele está instalado)
                "blender": True,
                # Companhia: salas para jogar com outras pessoas (quem recebe o link entra sem a chave da ponte)
                "salas": True,
                # Companhia: a loja de personagens, mundos e animações guardada neste aparelho
                "loja": True,
            },
            "perfis": sorted(PERFIS),
            "so_app": self.so_app["id"] if self.so_app else None,
        }

    def publico(self) -> dict:
        """O que qualquer um pode saber deste servidor (sem a chave): o que ele oferece aos visitantes."""
        return {"versao": VERSAO, "so_app": self.so_app["id"] if self.so_app else None, "ponte": self.ligada,
                "salas": self.ligada, "salas_criar": self.ligada and self.salas_visitantes(),
                "contas": self.ligada, "contas_email": self.ligada and email_configurado(), "exigir_conta": self.ligada and self.exigir_conta(),
                "idade_minima": self.idade_minima(),
                "loja": self.ligada, "loja_publicar": self.ligada and self.loja_publicar()}

    def idade_minima(self) -> int:
        try:
            return max(0, min(99, int(self.config.get("contas_idade_minima", 13))))
        except (TypeError, ValueError):
            return 13

    def exigir_conta(self) -> bool:
        return bool(self.config.get("contas_exigir", False))

    def salas_visitantes(self) -> bool:
        """Quem chega pelo link (sem a chave) pode criar salas? Ligado por padrão; o dono desliga."""
        return self.config.get("salas_visitantes", True) is not False

    def loja_publicar(self) -> bool:
        return self.config.get("loja_publicar", True) is not False


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

    def enviar_arquivo(self, caminho: Path, tipo: str, cache: str = "no-cache", cabecalhos: dict | None = None):
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
        for k, v in (cabecalhos or {}).items():
            self.send_header(k, v)
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

    def redirecionar(self, destino: str):
        self.send_response(302)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def estatico(self, caminho_url: str):
        partes = [p for p in urllib.parse.unquote(caminho_url).split("/") if p]
        if any(p.startswith(".") or "\\" in p or "\x00" in p for p in partes):
            return self.erro(404, "Não encontrado.")
        if self.ponte.so_app:
            # publicado sozinho: só este app e o que ele usa (comum/); a página inicial e os outros apps não existem aqui
            app = self.ponte.so_app["caminho"].strip("/")
            rel = "/".join(partes)
            if rel in ("", "index.html", "apps", "apps/index.html"):
                return self.redirecionar("/" + app + "/")
            if rel == "apps.json":
                corpo = json.dumps({"apps": [self.ponte.so_app]}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(corpo)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(corpo)
                return
            if not (rel == app or rel.startswith(app + "/") or rel.startswith("comum/") or rel in ("CREDITOS.md", "LICENSE")):
                return self.erro(404, "Este endereço só tem a " + str(self.ponte.so_app.get("nome") or "página publicada") + ".")
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

    def do_proprio_aparelho(self) -> bool:
        """O pedido vem de um navegador neste aparelho (127.0.0.1), não da rede nem da internet por um túnel (o
        cloudflared também conecta de 127.0.0.1, mas o pedido chega com o endereço público e os cabeçalhos da Cloudflare)."""
        if self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return False
        if any(self.headers.get(h) for h in ("Cf-Connecting-Ip", "Cf-Ray", "X-Forwarded-For", "X-Forwarded-Host", "Forwarded", "X-Real-Ip")):
            return False
        return nome_do_host(self.headers.get("Host", "")) not in self.ponte.hosts_extras

    def autorizado(self, permitir_cookie: bool) -> bool:
        token = self.ponte.token
        if not token:
            return False
        if self.ponte.so_app and not self.do_proprio_aparelho():
            return False  # publicado sozinho: de fora, nem a chave abre a ponte (só as salas e a loja)
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
        if rota == "publico" and self.command in ("GET", "HEAD"):
            return self.responder_json(self.ponte.publico())
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
        # As salas da Companhia têm acesso próprio: criar exige a chave da ponte; entrar, só o código da sala
        if rota == "sala" or rota.startswith("sala/"):
            return self.sala(self.command, rota[5:])
        if rota in ("salas", "salas/ajustes"):
            return self.salas(self.command, rota)
        # As contas também: cadastro, código, entrar e perfil, sem a chave da ponte (os ajustes são do dono)
        if rota == "contas" or rota.startswith("contas/"):
            return self.contas(self.command, rota[7:])
        # A loja também: ver e baixar, qualquer um; publicar, se o dono deixar; apagar, o dono ou quem publicou
        if rota == "loja" or rota.startswith("loja/"):
            return self.loja(self.command, rota[5:])
        # O cookie só vale para LER arquivos (é o que <video src> e <img src> precisam); o resto exige o cabeçalho
        so_leitura = self.command in ("GET", "HEAD") and rota in ("arquivo", "live2d/core")
        if not self.autorizado(permitir_cookie=so_leitura):
            if self.ponte.so_app and not self.do_proprio_aparelho():
                raise ErroPonte(403, "Este endereço publica só a " + str(self.ponte.so_app.get("nome") or "página") + ": daqui não dá para usar o aparelho (só as salas e a loja).")
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
        if rota == "blender" or rota.startswith("blender/"):
            return self.blender(m, rota[8:])
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

    def sala(self, m: str, resto: str):
        """Salas da Companhia (jogar com outras pessoas). POST /api/sala cria (com a chave da ponte) e devolve o código;
        o resto usa só o código: GET /api/sala/<código> (o que a sala tem), .../mapa (GET; PUT de quem criou),
        .../config, .../entrar, .../avatar (PUT o meu; GET .../avatar/<id> o de alguém), .../estado (mando o meu, recebo
        o de todos e as mensagens novas), .../falar, .../sair e DELETE /api/sala/<código> (quem criou fecha)."""
        agora = time.time()
        salas_limpar(agora)
        partes = [x for x in resto.split("/") if x]
        if not partes:
            if m != "POST":
                raise ErroPonte(405, "Use POST para criar uma sala (e GET /api/salas para ver as abertas).")
            dono = self.autorizado(False)
            if not dono and not self.ponte.salas_visitantes():
                raise ErroPonte(403, "O dono deste servidor não está deixando criar salas por aqui. Entre numa das salas abertas.")
            conta = self.conta_da_sessao()
            if not dono and not conta and self.ponte.exigir_conta():
                raise ErroPonte(401, "Este servidor pede uma conta: entre ou crie a sua para criar uma sala.")
            d = self.ler_json()
            if conta:
                d["criador"] = conta["nome"]
            origem = self.origem_do_pedido()
            with SALAS_TRAVA:
                if len(SALAS) >= SALA_MAXIMO:
                    raise ErroPonte(429, f"Este servidor já tem {SALA_MAXIMO} salas abertas. Entre numa delas ou espere uma fechar.")
                if not dono and sum(1 for x in SALAS.values() if x.origem == origem) >= SALA_POR_PESSOA:
                    raise ErroPonte(429, f"Você já tem {SALA_POR_PESSOA} salas abertas neste servidor. Feche uma antes de criar outra.")
                codigo = "".join(secrets.choice(SALA_LETRAS) for _ in range(8))
                pasta = self.ponte.temporarios / "salas" / codigo
                shutil.rmtree(pasta, ignore_errors=True)
                pasta.mkdir(parents=True, exist_ok=True)
                nova = SALAS[codigo] = Sala(codigo, "Sala", pasta, "" if dono else origem)
                nova.configurar({"nome": "Sala", **d})
            # os endereços por onde outras pessoas alcançam este servidor: o túnel liberado e a rede de casa
            enderecos = [f"https://{h}" for h in self.ponte.hosts_extras]
            if self.server.server_address[0] not in ("127.0.0.1", "::1", "localhost"):
                enderecos.append(f"http://{ip_local()}:{self.server.server_address[1]}")
            return self.responder_json({**nova.resumo(), "chave": nova.chave, "enderecos": enderecos}, 201)
        sala = SALAS.get(partes[0].lower())
        if not sala:
            raise ErroPonte(404, "Essa sala não existe mais (quem criou fechou, ou o servidor foi reiniciado).")
        sala.vista = agora
        acao = partes[1] if len(partes) > 1 else ""
        p = self.parametros()

        def dono():
            chave = self.headers.get("X-Sala-Chave", "")
            if not (chave and hmac.compare_digest(chave.encode(), sala.chave.encode())) and not self.autorizado(False):
                raise ErroPonte(403, "Só quem criou a sala pode fazer isso.")

        def pessoa(dados: dict) -> dict:
            j = sala.pessoas.get(str(dados.get("id", "")))
            if not j or not hmac.compare_digest(str(dados.get("segredo", "")).encode(), j["segredo"].encode()):
                raise ErroPonte(403, "Você não está mais nesta sala (ficou tempo demais sem resposta). Entre de novo.")
            j["visto"] = agora
            return j

        if not acao and m == "GET":
            return self.responder_json(sala.resumo())
        if not acao and m == "DELETE":
            dono()
            with SALAS_TRAVA:
                SALAS.pop(sala.codigo, None)
            shutil.rmtree(sala.pasta, ignore_errors=True)
            return self.responder_json({"ok": True})
        if acao == "mapa" and m in ("GET", "HEAD"):
            if not sala.mapa:
                raise ErroPonte(404, "Esta sala não tem cenário (é o chão simples).")
            return self.enviar_arquivo(sala.pasta / "mapa.glb", "model/gltf-binary")
        if acao == "mapa" and m == "PUT":
            dono()
            cabe_no_disco(sala.pasta, int(self.headers.get("Content-Length") or 0))
            self.receber_para(sala.pasta / "mapa.glb")
            try:  # o ajuste do mapa (tamanho, giro, posição, começo) vem junto, no endereço: chega a todos ao mesmo tempo que o arquivo
                ajuste = json.loads(p.get("ajuste") or "{}")
            except ValueError:
                ajuste = {}
            if not isinstance(ajuste, dict) or len(json.dumps(ajuste)) >= 2000:
                ajuste = {}
            with sala.trava:
                sala.versao_mapa += 1
                # "arquivo": a versão do .glb (um ajuste novo muda só "versao": quem está na sala não baixa o cenário de novo)
                sala.mapa = {"nome": sala_texto(p.get("nome"), 80) or "Cenário", "tamanho": (sala.pasta / "mapa.glb").stat().st_size,
                             "versao": sala.versao_mapa, "arquivo": sala.versao_mapa, "ajuste": ajuste}
            return self.responder_json(sala.resumo(), 201)
        if acao == "mapa" and m == "POST":  # um mundo da loja vira o cenário (sem precisar enviar o arquivo)
            dono()
            ident = str(self.ler_json().get("loja") or "")
            with LOJA_TRAVA:
                item = next((i for i in self.loja_itens() if i["id"] == ident and i["tipo"] == "mundo"), None)
            if not item:
                raise ErroPonte(404, "Esse mundo não está mais na loja.")
            cabe_no_disco(sala.pasta, item["tamanho"])
            shutil.copyfile(item["_arq"], sala.pasta / "mapa.glb")
            with sala.trava:
                sala.versao_mapa += 1
                sala.mapa = {"nome": item["nome"], "tamanho": item["tamanho"], "versao": sala.versao_mapa, "arquivo": sala.versao_mapa, "ajuste": {}, "loja": item["id"]}
                if item["_mini"]:
                    for e in ("png", "jpg", "webp"):
                        (sala.pasta / f"miniatura.{e}").unlink(missing_ok=True)
                    shutil.copyfile(item["_mini"], sala.pasta / ("miniatura" + item["_mini"].suffix))
                    sala.miniatura += 1
            return self.responder_json(sala.resumo(), 201)
        if acao == "miniatura" and m == "PUT":
            dono()
            dados = self.ler_corpo(LOJA_MINIATURA)
            ext = tipo_de_imagem(dados)
            if not ext:
                raise ErroPonte(400, "A miniatura precisa ser PNG, JPEG ou WebP.")
            for e in ("png", "jpg", "webp"):
                (sala.pasta / f"miniatura.{e}").unlink(missing_ok=True)
            (sala.pasta / f"miniatura.{ext}").write_bytes(dados)
            with sala.trava:
                sala.miniatura += 1
            return self.responder_json(sala.resumo(), 201)
        if acao == "miniatura" and m in ("GET", "HEAD"):
            arquivo = next((sala.pasta / f"miniatura.{e}" for e in ("png", "jpg", "webp") if (sala.pasta / f"miniatura.{e}").is_file()), None)
            if not arquivo:
                raise ErroPonte(404, "Esta sala não tem miniatura.")
            return self.enviar_arquivo(arquivo, {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[arquivo.suffix], cache="private, max-age=3600")
        if acao == "mapa" and m == "DELETE":
            dono()
            with sala.trava:
                sala.versao_mapa += 1
                sala.mapa = None
            (sala.pasta / "mapa.glb").unlink(missing_ok=True)
            return self.responder_json(sala.resumo())
        if acao == "config" and m == "POST":
            dono()
            d = self.ler_json()
            with sala.trava:
                sala.configurar({k: v for k, v in d.items() if k != "criador"})
                if sala.mapa and isinstance(d.get("ajuste"), dict) and len(json.dumps(d["ajuste"])) < 2000:
                    sala.versao_mapa += 1
                    sala.mapa = {**sala.mapa, "ajuste": d["ajuste"], "versao": sala.versao_mapa}
            return self.responder_json(sala.resumo())
        if acao == "entrar" and m == "POST":
            d = self.ler_json()
            conta = self.conta_da_sessao()
            if not conta and self.ponte.exigir_conta() and not self.autorizado(False):
                raise ErroPonte(401, "Este servidor pede uma conta: entre ou crie a sua para jogar.")
            nome = (conta["nome"] if conta else "") or sala_texto(d.get("nome"), 24) or "Visitante"
            chave = self.headers.get("X-Sala-Chave", "")
            de_quem_criou = bool(chave and hmac.compare_digest(chave.encode(), sala.chave.encode()))
            if not de_quem_criou and not sala.senha_confere(d.get("senha")):
                time.sleep(0.4)  # sem pressa para quem tenta adivinhar
                raise ErroPonte(403, "Senha errada." if d.get("senha") else "Esta sala tem senha.")
            with sala.trava:
                sala.limpar(agora)
                if len(sala.pessoas) >= sala.max:
                    raise ErroPonte(429, f"A sala está cheia ({sala.max} pessoas).")
                pid = secrets.token_hex(4)
                sala.pessoas[pid] = {"nome": nome, "segredo": secrets.token_urlsafe(12), "visto": agora, "estado": {}, "avatar": 0, "aparencia": 0,
                                     "conta": conta["id"] if conta else None, "dono": de_quem_criou, "video": None}
            return self.responder_json({"id": pid, "segredo": sala.pessoas[pid]["segredo"], "mensagens": sala.n, **sala.resumo()}, 201)
        if acao == "avatar" and m == "PUT":
            j = pessoa(p)
            cabe_no_disco(sala.pasta, int(self.headers.get("Content-Length") or 0))
            self.receber_para(sala.pasta / f"avatar-{p['id']}.vrm")
            j["avatar"] += 1
            return self.responder_json({"avatar": j["avatar"]}, 201)
        # a aparência de cada um (o ajuste do esqueleto, as peças escondidas e as texturas trocadas): os outros a veem igual
        if acao == "aparencia" and m == "PUT":
            j = pessoa(p)
            dados = self.ler_corpo(256 * 1024)
            try:
                ap = json.loads(dados or b"{}")
            except ValueError:
                raise ErroPonte(400, "A aparência não é um JSON válido.")
            if not isinstance(ap, dict):
                raise ErroPonte(400, "Esperava um objeto JSON.")
            (sala.pasta / f"aparencia-{p['id']}.json").write_text(json.dumps(ap, ensure_ascii=False), "utf-8")
            j["aparencia"] += 1
            return self.responder_json({"aparencia": j["aparencia"]}, 201)
        if acao == "aparencia" and m in ("GET", "HEAD") and len(partes) == 3:
            arquivo = sala.pasta / f"aparencia-{partes[2]}.json"
            if partes[2] not in sala.pessoas or not arquivo.is_file():
                raise ErroPonte(404, "Essa pessoa não mandou a aparência.")
            return self.enviar_arquivo(arquivo, "application/json; charset=utf-8")
        # o vídeo de cada um (um link do YouTube, Vimeo, Twitch ou de um arquivo de vídeo), numa tela que todos veem.
        # O servidor guarda o link, o lugar da tela e o relógio (quando o vídeo começou ou onde parou), para todos
        # verem o mesmo pedaço. Quem mostra o vídeo é o navegador de cada um, direto do site do vídeo.
        if acao == "video" and m == "POST":
            d = self.ler_json()
            j = pessoa(d)
            if sala.videos == "dono" and not j.get("dono"):
                raise ErroPonte(403, "Nesta sala, só quem criou põe vídeos na tela.")
            op = str(d.get("acao") or "")
            with sala.trava:
                v = dict(j["video"]) if j.get("video") else None
                tempo = (lambda x: x["pausado"] if x["pausado"] is not None else max(0.0, agora - x["inicio"]))
                if op == "fechar":
                    j["video"] = None
                    return self.responder_json({"video": None, "agora": agora})
                if op == "abrir":
                    url = str(d.get("url") or "").strip()
                    if not re.fullmatch(r"https?://[^\s<>\"'`]{4,600}", url, re.I):
                        raise ErroPonte(400, "Esse link não serve: cole o endereço do vídeo (começa com https://).")
                    v = {"url": url, "inicio": agora - segundos_do_video(d.get("em")), "pausado": None}
                elif not v:
                    raise ErroPonte(404, "Você não tem um vídeo na tela.")
                if op in ("abrir", "lugar"):
                    v.update(lugar_do_video(d))
                elif op == "pausar":
                    if v["pausado"] is None:
                        v["pausado"] = tempo(v)
                elif op == "continuar":
                    if v["pausado"] is not None:
                        v["inicio"], v["pausado"] = agora - v["pausado"], None
                elif op == "pular":  # "em": para o segundo tal; "mais": anda (ou volta) tantos segundos
                    t = segundos_do_video(d["em"]) if "em" in d else max(0.0, tempo(v) + max(-86400.0, min(86400.0, segundos_do_video(d.get("mais"), negativo=True))))
                    if v["pausado"] is not None:
                        v["pausado"] = t
                    else:
                        v["inicio"] = agora - t
                elif op != "abrir":
                    raise ErroPonte(400, "Ação de vídeo desconhecida.")
                sala.n_video += 1
                v["n"] = sala.n_video
                j["video"] = v
            return self.responder_json({**v, "agora": agora})
        if acao == "video" and m in ("GET", "HEAD") and len(partes) == 3:
            j = sala.pessoas.get(partes[2])
            if not j or not j.get("video"):
                raise ErroPonte(404, "Essa pessoa não tem um vídeo na tela.")
            return self.responder_json({**j["video"], "agora": time.time()})
        if acao == "textura" and m == "PUT":
            pessoa(p)
            n = str(p.get("n", ""))
            if not re.fullmatch(r"\d{1,3}", n) or int(n) > 255:
                raise ErroPonte(400, "Número de textura inválido.")
            cabe_no_disco(sala.pasta, int(self.headers.get("Content-Length") or 0))
            destino = sala.pasta / f"textura-{p['id']}-{n}"
            self.receber_para(destino)
            with open(destino, "rb") as f:
                ext = tipo_de_imagem(f.read(16))
            if not ext:
                destino.unlink(missing_ok=True)
                raise ErroPonte(400, "A textura precisa ser PNG, JPEG ou WebP.")
            return self.responder_json({"ok": True}, 201)
        if acao == "textura" and m in ("GET", "HEAD") and len(partes) == 4:
            if partes[2] not in sala.pessoas or not re.fullmatch(r"\d{1,3}", partes[3]):
                raise ErroPonte(404, "Essa textura não existe.")
            arquivo = sala.pasta / f"textura-{partes[2]}-{partes[3]}"
            if not arquivo.is_file():
                raise ErroPonte(404, "Essa textura não existe.")
            with open(arquivo, "rb") as f:
                ext = tipo_de_imagem(f.read(16)) or "png"
            return self.enviar_arquivo(arquivo, {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}[ext], cache="private, max-age=3600")
        if acao == "avatar" and m in ("GET", "HEAD") and len(partes) == 3:
            arquivo = sala.pasta / f"avatar-{partes[2]}.vrm"
            if partes[2] not in sala.pessoas or not arquivo.is_file():
                raise ErroPonte(404, "Essa pessoa não mandou o avatar.")
            return self.enviar_arquivo(arquivo, "model/gltf-binary")
        if m != "POST" or acao not in ("estado", "falar", "sair"):
            raise ErroPonte(404, f"A sala não conhece /{acao} ({m}).")
        if int(self.headers.get("Content-Length") or 0) > 24 * 1024:
            raise ErroPonte(413, "Pedido grande demais para a sala.")
        d = self.ler_json()
        with sala.trava:
            j = pessoa(d)
            if acao == "sair":
                sala.tirar(str(d["id"]))
                return self.responder_json({"ok": True})
            if acao == "falar":
                if not sala.bate_papo:
                    raise ErroPonte(403, "O bate-papo desta sala está desligado.")
                texto = sala_texto(d.get("texto"), 300)
                if not texto:
                    raise ErroPonte(400, "Faltou o texto.")
                sala.n += 1
                sala.mensagens.append({"n": sala.n, "de": str(d["id"]), "nome": j["nome"], "texto": texto})
                del sala.mensagens[:-200]
                return self.responder_json({"n": sala.n})
            if isinstance(d.get("estado"), dict):
                j["estado"] = d["estado"]
            sala.limpar(agora)
            try:
                desde = int(d.get("desde") or 0)
            except (TypeError, ValueError):
                desde = 0
            return self.responder_json({
                "pessoas": [{"id": i, "nome": x["nome"], "avatar": x["avatar"], "aparencia": x.get("aparencia", 0), "conta": x.get("conta"), "estado": x["estado"],
                             "video": (x.get("video") or {}).get("n", 0)}
                            for i, x in sala.pessoas.items()],
                "mensagens": [msg for msg in sala.mensagens if msg["n"] > desde][-50:],
                "mapa": sala.versao_mapa if sala.mapa else 0, "nome": sala.nome, "bate_papo": sala.bate_papo, "videos": sala.videos})

    # ── loja da Companhia

    def loja_itens(self) -> list:
        """Os itens da loja: os publicados (uma pasta <id>/ com item.json, o arquivo e a miniatura) e os arquivos
        postos à mão direto nas subpastas (personagens/, mundos/, animacoes/)."""
        itens = []
        for tipo, (sub, exts) in LOJA_TIPOS.items():
            pasta = self.ponte.loja / sub
            if not pasta.is_dir():
                continue
            for f in pasta.iterdir():
                if f.name.startswith("."):
                    continue
                try:
                    if f.is_dir():
                        if not re.fullmatch(r"[0-9a-f]{12}", f.name):
                            continue
                        dados = json.loads((f / "item.json").read_text("utf-8"))
                        arq = f / nome_seguro(str(dados.get("arquivo", "")))
                        if not arq.is_file() or arq.suffix.lower() not in exts:
                            continue
                        mini = next((f / ("miniatura." + e) for e in ("png", "jpg", "webp") if (f / ("miniatura." + e)).is_file()), None)
                        itens.append({"id": f.name, "tipo": tipo, "nome": str(dados.get("nome") or arq.stem), "descricao": str(dados.get("descricao") or ""),
                                      "autor": str(dados.get("autor") or ""), "arquivo": arq.name, "tamanho": arq.stat().st_size,
                                      "criado": int(dados.get("criado") or arq.stat().st_mtime), "miniatura": int(mini.stat().st_mtime) if mini else 0,
                                      "solto": False, "_arq": arq, "_mini": mini, "_pasta": f, "_segredo": str(dados.get("segredo") or "")})
                    elif f.is_file() and f.suffix.lower() in exts and ".enviando-" not in f.name:
                        ident = "a" + hashlib.sha1(f"{sub}/{f.name}".encode("utf-8", "surrogateescape")).hexdigest()[:11]
                        # a miniatura de um arquivo posto à mão fica numa pasta escondida ao lado (.miniaturas/<id>.png)
                        lado = pasta / ".miniaturas"
                        mini = next((lado / f"{ident}.{e}" for e in ("png", "jpg", "webp") if (lado / f"{ident}.{e}").is_file()), None)
                        itens.append({"id": ident, "tipo": tipo, "nome": f.stem, "descricao": "", "autor": "", "arquivo": f.name,
                                      "tamanho": f.stat().st_size, "criado": int(f.stat().st_mtime), "miniatura": int(mini.stat().st_mtime) if mini else 0,
                                      "solto": True, "_arq": f, "_mini": mini, "_pasta": None, "_segredo": ""})
                except (OSError, ValueError, TypeError, AttributeError):
                    continue
        itens.sort(key=lambda x: -x["criado"])
        return itens

    def loja(self, m: str, resto: str):
        """A loja da Companhia. GET /api/loja (a lista), GET /api/loja/<id>[/arquivo|/miniatura], PUT /api/loja/<tipo>
        (publicar: o arquivo no corpo; nome, descrição, autor e o nome do arquivo no endereço; devolve o segredo de quem
        publicou), PUT /api/loja/<id>/miniatura, DELETE /api/loja/<id> e POST /api/loja/config (o dono)."""
        partes = [x for x in resto.split("/") if x]
        p = self.parametros()
        dono = self.autorizado(False)
        publico = lambda item: {k: v for k, v in item.items() if not k.startswith("_")}
        if not partes and m in ("GET", "HEAD"):
            return self.responder_json({"itens": [publico(i) for i in self.loja_itens()], "publicar": self.ponte.loja_publicar(), "dono": dono,
                                        **({"pasta": str(self.ponte.loja)} if dono else {})})
        if partes == ["config"] and m == "POST":
            if not dono:
                raise ErroPonte(403, "Só o dono da loja (com a chave da ponte, neste aparelho) muda isso.")
            d = self.ler_json()
            if "publicar" in d:
                self.ponte.config["loja_publicar"] = bool(d["publicar"])
                gravar_config(self.ponte.config)
            return self.responder_json({"publicar": self.ponte.loja_publicar()})
        if len(partes) == 1 and partes[0] in LOJA_TIPOS and m in ("PUT", "POST"):
            return self.loja_publicar(partes[0], p, dono)
        with LOJA_TRAVA:
            item = next((i for i in self.loja_itens() if i["id"] == partes[0]), None) if partes else None
        if not item:
            raise ErroPonte(404, "Esse item não está mais na loja.")
        acao = partes[1] if len(partes) > 1 else ""

        def pode_mexer() -> bool:
            if dono:
                return True
            segredo = self.headers.get("X-Loja-Segredo", "")
            return bool(segredo and item["_segredo"] and hmac.compare_digest(hashlib.sha256(segredo.encode()).hexdigest().encode(), item["_segredo"].encode()))

        if not acao and m == "GET":
            return self.responder_json(publico(item))
        if acao == "arquivo" and m in ("GET", "HEAD"):
            return self.enviar_arquivo(item["_arq"], "application/octet-stream", cache="private, max-age=600",
                                       cabecalhos={"Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(item["arquivo"])})
        if acao == "miniatura" and m in ("GET", "HEAD"):
            if not item["_mini"]:
                raise ErroPonte(404, "Esse item não tem miniatura.")
            tipo_img = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[item["_mini"].suffix]
            return self.enviar_arquivo(item["_mini"], tipo_img, cache="private, max-age=86400")
        if acao == "miniatura" and m == "PUT":
            if not (dono if item["solto"] else pode_mexer()):
                raise ErroPonte(403, "Só quem publicou (ou o dono da loja) troca a miniatura.")
            dados = self.ler_corpo(LOJA_MINIATURA)
            ext = tipo_de_imagem(dados)
            if not ext:
                raise ErroPonte(400, "A miniatura precisa ser PNG, JPEG ou WebP.")
            if item["solto"]:
                pasta, base = item["_arq"].parent / ".miniaturas", item["id"]
                pasta.mkdir(exist_ok=True)
            else:
                pasta, base = item["_pasta"], "miniatura"
            for e in ("png", "jpg", "webp"):
                (pasta / f"{base}.{e}").unlink(missing_ok=True)
            temporario = pasta / f".miniatura-{uuid.uuid4().hex[:6]}"
            temporario.write_bytes(dados)
            os.replace(temporario, pasta / f"{base}.{ext}")
            return self.responder_json({"ok": True}, 201)
        if not acao and m == "DELETE":
            if item["solto"]:
                if not dono:
                    raise ErroPonte(403, "Só o dono da loja apaga um arquivo posto à mão.")
                item["_arq"].unlink(missing_ok=True)
                if item["_mini"]:
                    item["_mini"].unlink(missing_ok=True)
            else:
                if not pode_mexer():
                    raise ErroPonte(403, "Só quem publicou (ou o dono da loja) apaga.")
                shutil.rmtree(item["_pasta"], ignore_errors=True)
            return self.responder_json({"ok": True})
        raise ErroPonte(404, f"A loja não conhece /{acao} ({m}).")

    def loja_publicar(self, tipo: str, p: dict, dono: bool):
        if not dono and not self.ponte.loja_publicar():
            raise ErroPonte(403, "O dono desta loja não está aceitando publicações agora.")
        sub, exts = LOJA_TIPOS[tipo]
        nome_arq = nome_seguro(p.get("arquivo", ""), "arquivo")
        ext = Path(nome_arq).suffix.lower()
        if ext not in exts:
            raise ErroPonte(400, f"Na loja, {sub} são arquivos {', '.join(exts)}.")
        if "Content-Length" not in self.headers or int(self.headers.get("Content-Length") or 0) <= 0:
            raise ErroPonte(400, "Faltou o arquivo.")
        pasta_tipo = self.ponte.loja / sub
        pasta_tipo.mkdir(parents=True, exist_ok=True)
        cabe_no_disco(pasta_tipo, int(self.headers["Content-Length"]))
        ident = secrets.token_hex(6)
        pasta = pasta_tipo / ident
        pasta.mkdir()
        try:
            self.receber_para(pasta / nome_arq)
            if not formato_confere(pasta / nome_arq, ext):
                raise ErroPonte(400, f"Esse arquivo não é um {ext} de verdade.")
            segredo = secrets.token_urlsafe(18)
            dados = {"nome": sala_texto(p.get("nome"), 60) or Path(nome_arq).stem, "descricao": sala_texto(p.get("descricao"), 600),
                     "autor": sala_texto(p.get("autor"), 40), "arquivo": nome_arq, "criado": int(time.time()),
                     "segredo": hashlib.sha256(segredo.encode()).hexdigest()}
            (pasta / "item.json").write_text(json.dumps(dados, ensure_ascii=False, indent=2), "utf-8")
        except BaseException:
            shutil.rmtree(pasta, ignore_errors=True)
            raise
        item = next(i for i in self.loja_itens() if i["id"] == ident)
        return self.responder_json({"item": {k: v for k, v in item.items() if not k.startswith("_")}, "segredo": segredo}, 201)

    def conta_da_sessao(self) -> dict | None:
        """A conta de quem pede (pelo cabeçalho X-Conta-Sessao), ou None."""
        if not self.ponte.ligada:
            return None
        with CONTAS_TRAVA:
            return contas_de(DADOS).da_sessao(self.headers.get("X-Conta-Sessao", ""))

    def mandar_codigo(self, cadastro: Contas, conta: dict, motivo: str) -> None:
        """Gera e manda por e-mail o código de 6 dígitos (cadastro: confirmar o e-mail; senha: trocar a senha)."""
        d, agora, chave = cadastro.ler(), time.time(), motivo + ":" + conta["email"]
        atual = d["codigos"].get(chave, {})
        envios = [t for t in atual.get("envios", []) if agora - t < 3600]
        if envios and agora - envios[-1] < CODIGO_ESPERA:
            raise ErroPonte(429, f"Espere {int(CODIGO_ESPERA - (agora - envios[-1])) + 1} segundos para pedir outro código.")
        if len(envios) >= CODIGO_POR_HORA:
            raise ErroPonte(429, "Códigos demais para este e-mail na última hora. Tente mais tarde.")
        codigo = f"{secrets.randbelow(10 ** 6):06d}"
        d["codigos"][chave] = {"hash": resumo_hash(chave + ":" + codigo), "expira": agora + CODIGO_VALE, "tentativas": 0, "envios": envios + [agora]}
        cadastro.gravar()
        para_que = "confirmar o seu e-mail e terminar o cadastro" if motivo == "cadastro" else "criar uma senha nova"
        try:
            self._mandar_codigo_email(conta, codigo, para_que)
        except ErroPonte:
            d["codigos"].pop(chave, None)  # não chegou: dá para pedir de novo na hora
            cadastro.gravar()
            raise

    @staticmethod
    def _mandar_codigo_email(conta: dict, codigo: str, para_que: str) -> None:
        mandar_email(conta["email"], f"Seu código da Companhia: {codigo}",
                     f"Olá, {conta['nome']}!\n\nO seu código para {para_que} na Companhia é:\n\n    {codigo}\n\n"
                     f"Ele vale por {CODIGO_VALE // 60} minutos. Se não foi você que pediu, ignore este e-mail.\n")

    def conferir_codigo(self, cadastro: Contas, email: str, motivo: str, codigo: str) -> None:
        d, chave = cadastro.ler(), motivo + ":" + email
        c = d["codigos"].get(chave)
        if not c or time.time() > c["expira"]:
            raise ErroPonte(410, "Esse código venceu. Peça outro.")
        if c["tentativas"] >= CODIGO_TENTATIVAS:
            raise ErroPonte(429, "Tentativas demais com esse código. Peça outro.")
        if not hmac.compare_digest(resumo_hash(chave + ":" + re.sub(r"\D", "", str(codigo or ""))), c["hash"]):
            c["tentativas"] += 1
            cadastro.gravar()
            raise ErroPonte(403, f"Código errado. Faltam {CODIGO_TENTATIVAS - c['tentativas']} tentativas.")
        d["codigos"].pop(chave, None)

    def contas(self, m: str, resto: str):
        """As contas da Companhia (veja Contas). Sem a chave: cadastro, verificar, reenviar, entrar, sair, eu, perfil,
        midia, senha, recuperar, redefinir, apagar, perfil/<id>, midia/<id>/<foto|capa>, config. Com a chave (o dono):
        ajustes, email-teste, lista, conta/<id>."""
        partes = [x for x in resto.split("/") if x]
        acao = partes[0] if partes else ""
        dono = self.autorizado(False)
        origem = self.origem_do_pedido()

        def corpo() -> dict:
            return self.ler_json()

        def email_de(d) -> str:
            email = str(d.get("email") or "").strip().lower()
            if not EMAIL_RE.fullmatch(email) or len(email) > 254:
                raise ErroPonte(400, "Esse e-mail não parece certo.")
            return email

        def senha_de(d, campo="senha") -> str:
            senha = str(d.get(campo) or "")
            if len(senha) < 8:
                raise ErroPonte(400, "A senha precisa ter pelo menos 8 caracteres.")
            if len(senha) > 200:
                raise ErroPonte(400, "Senha comprida demais.")
            return senha

        with CONTAS_TRAVA:
            cadastro = contas_de(DADOS)
            d = cadastro.ler()
            sessao = self.headers.get("X-Conta-Sessao", "")
            eu = cadastro.da_sessao(sessao)

            def exigir_eu() -> dict:
                if not eu:
                    raise ErroPonte(401, "Entre na sua conta primeiro (ou a sessão venceu).")
                return eu

            if acao == "config" and m == "GET":
                return self.responder_json({"email": email_configurado(), "idade_minima": self.ponte.idade_minima(), "exigir_conta": self.ponte.exigir_conta()})
            if acao == "cadastro" and m == "POST":
                contar_tentativa("cadastro:" + origem, 10, 3600)
                b = corpo()
                nome = sala_texto(b.get("nome"), 30)
                if len(nome) < 2:
                    raise ErroPonte(400, "Diga o seu nome (pelo menos 2 letras).")
                email, senha = email_de(b), senha_de(b)
                try:
                    idade = int(b.get("idade"))
                except (TypeError, ValueError):
                    raise ErroPonte(400, "Diga a sua idade.")
                if idade < self.ponte.idade_minima():
                    raise ErroPonte(403, f"Para criar uma conta aqui, é preciso ter pelo menos {self.ponte.idade_minima()} anos.")
                if idade > 120:
                    raise ErroPonte(400, "Essa idade não parece certa.")
                if not email_configurado():
                    raise ErroPonte(503, "O dono deste servidor ainda não configurou o envio de e-mails, então ainda não dá para criar contas.")
                conta = cadastro.por_email(email)
                if conta and conta.get("verificada"):
                    raise ErroPonte(409, "Já existe uma conta com esse e-mail. Entre nela (ou use \"Esqueci a senha\").")
                if not conta:
                    conta = {"id": secrets.token_hex(6), "email": email, "criada": int(time.time()), "verificada": False, "perfil": {}}
                    d["contas"][conta["id"]] = conta
                conta.update({"nome": nome, "idade": idade, "senha": hash_senha(senha)})
                cadastro.gravar()
                self.mandar_codigo(cadastro, conta, "cadastro")
                return self.responder_json({"pendente": True, "email": esconder_email(email)}, 201)
            if acao == "verificar" and m == "POST":
                b = corpo()
                email = email_de(b)
                conta = cadastro.por_email(email)
                if not conta:
                    raise ErroPonte(404, "Não achei um cadastro com esse e-mail.")
                self.conferir_codigo(cadastro, email, "cadastro", b.get("codigo"))
                conta["verificada"] = True
                token = cadastro.nova_sessao(conta)
                cadastro.gravar()
                return self.responder_json({"sessao": token, "conta": Contas.perfil_proprio(conta)})
            if acao == "reenviar" and m == "POST":
                email = email_de(corpo())
                conta = cadastro.por_email(email)
                if conta and not conta.get("verificada"):
                    self.mandar_codigo(cadastro, conta, "cadastro")
                return self.responder_json({"ok": True, "email": esconder_email(email)})
            if acao == "entrar" and m == "POST":
                b = corpo()
                email = email_de(b)
                contar_tentativa("entrar:" + email, 8, 900)
                contar_tentativa("entrar-de:" + origem, 30, 900)
                conta = cadastro.por_email(email)
                if not conta or not senha_confere(str(b.get("senha") or ""), conta.get("senha", {})):
                    time.sleep(0.4)
                    raise ErroPonte(401, "E-mail ou senha errados.")
                if not conta.get("verificada"):
                    try:
                        self.mandar_codigo(cadastro, conta, "cadastro")
                    except ErroPonte as e:
                        if e.status != 429:
                            raise
                    self.close_connection = True
                    return self.responder_json({"erro": "Falta confirmar o e-mail: mandamos um código para ele.", "pendente": True, "email": esconder_email(email)}, 403)
                TENTATIVAS.pop("entrar:" + email, None)
                token = cadastro.nova_sessao(conta)
                cadastro.gravar()
                return self.responder_json({"sessao": token, "conta": Contas.perfil_proprio(conta)})
            if acao == "sair" and m == "POST":
                if sessao:
                    d["sessoes"].pop(resumo_hash(sessao), None)
                    cadastro.gravar()
                return self.responder_json({"ok": True})
            if acao == "eu" and m == "GET":
                return self.responder_json(Contas.perfil_proprio(exigir_eu()))
            if acao == "perfil" and len(partes) == 1 and m == "POST":
                c, b = exigir_eu(), corpo()
                perfil = c.setdefault("perfil", {})
                if "nome" in b:
                    nome = sala_texto(b.get("nome"), 30)
                    if len(nome) < 2:
                        raise ErroPonte(400, "O nome precisa ter pelo menos 2 letras.")
                    c["nome"] = nome
                for campo, limite in (("bio", 300), ("pronomes", 30), ("local", 60)):
                    if campo in b:
                        perfil[campo] = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]+", " ", str(b.get(campo) or "")).strip()[:limite]
                if "cor" in b:
                    cor = str(b.get("cor") or "")
                    perfil["cor"] = cor if re.fullmatch(r"#[0-9a-fA-F]{6}", cor) else ""
                if "links" in b:
                    links = [str(x).strip()[:200] for x in (b.get("links") or []) if str(x).strip()][:3]
                    if any(not re.match(r"https?://[^\s]+$", x) for x in links):
                        raise ErroPonte(400, "Os links precisam começar com http:// ou https://.")
                    perfil["links"] = links
                cadastro.gravar()
                return self.responder_json(Contas.perfil_proprio(c))
            if acao == "perfil" and len(partes) == 2 and m == "GET":
                c = d["contas"].get(partes[1])
                if not c or not c.get("verificada"):
                    raise ErroPonte(404, "Essa conta não existe.")
                return self.responder_json(Contas.perfil_publico(c))
            if acao == "midia" and len(partes) == 1 and m in ("PUT", "DELETE"):
                c, tipo = exigir_eu(), self.parametros().get("tipo", "foto")
                if tipo not in ("foto", "capa"):
                    raise ErroPonte(400, "Tipo de imagem desconhecido (foto ou capa).")
                for e in ("png", "jpg", "webp"):
                    (cadastro.midia / f"{c['id']}-{tipo}.{e}").unlink(missing_ok=True)
                perfil = c.setdefault("perfil", {})
                if m == "DELETE":
                    perfil[tipo] = 0
                else:
                    dados = self.ler_corpo(CONTA_MIDIA)
                    ext = tipo_de_imagem(dados)
                    if not ext:
                        raise ErroPonte(400, "A imagem precisa ser PNG, JPEG ou WebP.")
                    cadastro.midia.mkdir(parents=True, exist_ok=True)
                    (cadastro.midia / f"{c['id']}-{tipo}.{ext}").write_bytes(dados)
                    perfil[tipo] = int(time.time() * 1000) % 2_000_000_000
                cadastro.gravar()
                return self.responder_json(Contas.perfil_proprio(c))
            if acao == "midia" and len(partes) == 3 and m in ("GET", "HEAD"):
                c = d["contas"].get(partes[1])
                if not c or partes[2] not in ("foto", "capa"):
                    raise ErroPonte(404, "Essa imagem não existe.")
                arquivo = next((cadastro.midia / f"{c['id']}-{partes[2]}.{e}" for e in ("png", "jpg", "webp") if (cadastro.midia / f"{c['id']}-{partes[2]}.{e}").is_file()), None)
                if not arquivo:
                    raise ErroPonte(404, "Essa imagem não existe.")
                return self.enviar_arquivo(arquivo, {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[arquivo.suffix], cache="private, max-age=600")
            if acao == "senha" and m == "POST":
                c, b = exigir_eu(), corpo()
                if not senha_confere(str(b.get("atual") or ""), c.get("senha", {})):
                    time.sleep(0.4)
                    raise ErroPonte(403, "A senha atual está errada.")
                c["senha"] = hash_senha(senha_de(b, "nova"))
                for k in [k for k, x in d["sessoes"].items() if x["conta"] == c["id"] and k != resumo_hash(sessao)]:
                    d["sessoes"].pop(k, None)  # as outras sessões saem
                cadastro.gravar()
                return self.responder_json({"ok": True})
            if acao == "recuperar" and m == "POST":
                contar_tentativa("recuperar:" + origem, 10, 3600)
                email = email_de(corpo())
                conta = cadastro.por_email(email)
                if conta and conta.get("verificada"):
                    self.mandar_codigo(cadastro, conta, "senha")
                # a mesma resposta com ou sem conta (não dá para descobrir quem tem conta)
                return self.responder_json({"ok": True, "email": esconder_email(email)})
            if acao == "redefinir" and m == "POST":
                b = corpo()
                email = email_de(b)
                conta = cadastro.por_email(email)
                if not conta or not conta.get("verificada"):
                    raise ErroPonte(410, "Esse código venceu. Peça outro.")
                self.conferir_codigo(cadastro, email, "senha", b.get("codigo"))
                conta["senha"] = hash_senha(senha_de(b))
                for k in [k for k, x in d["sessoes"].items() if x["conta"] == conta["id"]]:
                    d["sessoes"].pop(k, None)
                token = cadastro.nova_sessao(conta)
                cadastro.gravar()
                return self.responder_json({"sessao": token, "conta": Contas.perfil_proprio(conta)})
            if acao == "apagar" and m == "POST":
                c = exigir_eu()
                if not senha_confere(str(corpo().get("senha") or ""), c.get("senha", {})):
                    time.sleep(0.4)
                    raise ErroPonte(403, "A senha está errada.")
                self.apagar_conta(cadastro, c["id"])
                return self.responder_json({"ok": True})
            # ── do dono do servidor
            if acao in ("ajustes", "email-teste", "lista", "conta"):
                if not dono:
                    raise ErroPonte(403, "Só o dono do servidor (com a chave da ponte, neste aparelho) mexe nisso.")
                if acao == "ajustes" and m == "GET":
                    cfg = email_config()
                    return self.responder_json({"email": {k: cfg.get(k, "") for k in ("servidor", "porta", "seguranca", "usuario", "remetente", "nome")} | {"tem_senha": bool(cfg.get("senha")), "configurado": email_configurado(cfg)},
                                                "idade_minima": self.ponte.idade_minima(), "exigir_conta": self.ponte.exigir_conta(), "contas": sum(1 for c in d["contas"].values() if c.get("verificada")),
                                                "pasta": str(cadastro.pasta)})
                if acao == "ajustes" and m == "POST":
                    b = corpo()
                    if isinstance(b.get("email"), dict):
                        e, cfg = b["email"], email_config()
                        for k in ("servidor", "usuario", "remetente", "nome"):
                            if k in e:
                                cfg[k] = str(e.get(k) or "").strip()[:200]
                        if "porta" in e:
                            try:
                                cfg["porta"] = max(1, min(65535, int(e.get("porta") or 0))) if e.get("porta") else ""
                            except (TypeError, ValueError):
                                raise ErroPonte(400, "Porta inválida.")
                        if "seguranca" in e:
                            if e["seguranca"] not in ("ssl", "starttls", "nenhuma"):
                                raise ErroPonte(400, "Segurança: ssl, starttls ou nenhuma.")
                            cfg["seguranca"] = e["seguranca"]
                        if e.get("senha"):
                            cfg["senha"] = str(e["senha"])[:500]
                        if cfg.get("remetente") and not EMAIL_RE.fullmatch(cfg["remetente"]):
                            raise ErroPonte(400, "O remetente precisa ser um e-mail.")
                        arquivo = DADOS / "email.json"
                        temporario = arquivo.with_suffix(".tmp")
                        temporario.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), "utf-8")
                        os.chmod(temporario, 0o600)
                        os.replace(temporario, arquivo)
                    if "idade_minima" in b:
                        try:
                            self.ponte.config["contas_idade_minima"] = max(0, min(99, int(b["idade_minima"])))
                        except (TypeError, ValueError):
                            raise ErroPonte(400, "Idade mínima inválida.")
                    if "exigir_conta" in b:
                        self.ponte.config["contas_exigir"] = bool(b["exigir_conta"])
                    gravar_config(self.ponte.config)
                    return self.responder_json({"ok": True, "email": email_configurado(), "idade_minima": self.ponte.idade_minima(), "exigir_conta": self.ponte.exigir_conta()})
                if acao == "email-teste" and m == "POST":
                    para = email_de({"email": corpo().get("para")})
                    mandar_email(para, "Teste da Companhia", "Este é um e-mail de teste do servidor da Companhia: o envio dos códigos está funcionando.\n")
                    return self.responder_json({"ok": True})
                if acao == "lista" and m == "GET":
                    lista = [{"id": c["id"], "nome": c["nome"], "email": c["email"], "idade": c.get("idade"), "criada": c.get("criada"), "verificada": bool(c.get("verificada"))}
                             for c in d["contas"].values()]
                    return self.responder_json({"contas": sorted(lista, key=lambda x: -(x["criada"] or 0))})
                if acao == "conta" and len(partes) == 2 and m == "DELETE":
                    if partes[1] not in d["contas"]:
                        raise ErroPonte(404, "Essa conta não existe.")
                    self.apagar_conta(cadastro, partes[1])
                    return self.responder_json({"ok": True})
        raise ErroPonte(404, f"As contas não conhecem /{resto} ({m}).")

    @staticmethod
    def apagar_conta(cadastro: Contas, cid: str) -> None:
        d = cadastro.ler()
        d["contas"].pop(cid, None)
        for k in [k for k, x in d["sessoes"].items() if x["conta"] == cid]:
            d["sessoes"].pop(k, None)
        for f in cadastro.midia.glob(f"{cid}-*"):
            f.unlink(missing_ok=True)
        cadastro.gravar()

    def origem_do_pedido(self) -> str:
        """De onde vem o pedido: o endereço de verdade de quem está do outro lado (pela Cloudflare, o Cf-Connecting-Ip)."""
        if self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1") and self.headers.get("Cf-Connecting-Ip"):
            return str(self.headers.get("Cf-Connecting-Ip"))[:64]
        return self.client_address[0]

    def salas(self, m: str, rota: str):
        """GET /api/salas: as salas públicas deste servidor (a lista para entrar) e se quem pede pode criar uma.
        POST /api/salas/ajustes: o dono decide se quem chega pelo link cria salas."""
        dono = self.autorizado(False)
        salas_limpar(time.time())
        if rota == "salas" and m in ("GET", "HEAD"):
            with SALAS_TRAVA:
                lista = [x.resumo() for x in SALAS.values() if x.publica]
            lista.sort(key=lambda x: (-x["pessoas"], -x["criada"]))
            return self.responder_json({"salas": lista, "criar": dono or self.ponte.salas_visitantes(), "visitantes_criam": self.ponte.salas_visitantes(),
                                        "dono": dono, "abertas": len(SALAS), "maximo": SALA_MAXIMO, "pessoas_max": SALA_PESSOAS})
        if rota == "salas/ajustes" and m == "POST":
            if not dono:
                raise ErroPonte(403, "Só o dono do servidor (com a chave da ponte, neste aparelho) muda isso.")
            d = self.ler_json()
            if "visitantes_criam" in d:
                self.ponte.config["salas_visitantes"] = bool(d["visitantes_criam"])
                gravar_config(self.ponte.config)
            return self.responder_json({"visitantes_criam": self.ponte.salas_visitantes()})
        raise ErroPonte(404, f"/api/{rota} não aceita {m}.")

    def blender(self, metodo: str, resto: str):
        """Converter .blend em .glb com o Blender do aparelho. GET /api/blender diz se há Blender; PUT /api/blender/<lote>/<nome>
        envia um arquivo (o .blend e as texturas dele) para uma pasta temporária; POST /api/blender/<lote> converte
        ({"principal": nome enviado} ou {"entrada": caminho de um .blend numa pasta liberada}); DELETE apaga a pasta."""
        if metodo == "GET" and not resto:
            achado = blender_programa()
            return self.responder_json({"disponivel": bool(achado), "como": achado[0] if achado else None,
                                        "programa": Path(achado[1]).name if achado else None})
        lote, _, nome = resto.partition("/")
        if not re.fullmatch(r"[a-z0-9]{6,32}", lote):
            raise ErroPonte(400, "Lote inválido.")
        pasta = self.ponte.temporarios / f"blender-{lote}"
        if metodo == "PUT" and nome:
            pasta.mkdir(parents=True, exist_ok=True)
            destino = pasta / nome_seguro(urllib.parse.unquote(nome), "arquivo")
            self.receber_para(destino)
            return self.responder_json({"nome": destino.name, "tamanho": destino.stat().st_size}, 201)
        if metodo == "DELETE" and not nome:
            shutil.rmtree(pasta, ignore_errors=True)
            return self.responder_json({"ok": True})
        if metodo != "POST" or nome:
            raise ErroPonte(405, "Use GET (tem Blender?), PUT (enviar), POST (converter) ou DELETE (limpar).")
        d = self.ler_json()
        if d.get("entrada"):
            entrada = self.ponte.resolver(str(d["entrada"]))
        else:
            entrada = pasta / nome_seguro(str(d.get("principal") or ""), "")
        if not entrada.is_file() or entrada.suffix.lower() != ".blend":
            raise ErroPonte(400, "Diga qual é o arquivo .blend a converter.")
        achado = blender_programa()
        if not achado:
            raise ErroPonte(501, "O Blender não está instalado neste aparelho (nem o módulo bpy do Python).")
        pasta.mkdir(parents=True, exist_ok=True)
        saida = pasta / (entrada.stem + ".glb")
        saida.unlink(missing_ok=True)
        if achado[0] == "blender":
            cmd = [achado[1], "--background", "--factory-startup", "--disable-autoexec", str(entrada), "--python-expr", BLENDER_SCRIPT, "--", str(saida)]
        else:
            abrir = "import bpy, sys\nbpy.ops.wm.open_mainfile(filepath=sys.argv[1], use_scripts=False)\n"
            cmd = [achado[1], "-c", abrir + BLENDER_SCRIPT, str(entrada), "--", str(saida)]
        inicio = time.time()
        with BLENDER_TRAVA:  # uma conversão de cada vez (o Blender usa bastante memória)
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=str(entrada.parent))
            except subprocess.TimeoutExpired:
                raise ErroPonte(504, "O Blender demorou demais para converter esse arquivo (mais de 15 minutos).")
            except OSError as e:
                raise ErroPonte(500, f"Não consegui rodar o Blender: {e}")
        if not saida.is_file() or saida.stat().st_size < 20:
            linhas = [l for l in ((r.stderr or "") + "\n" + (r.stdout or "")).splitlines() if l.strip()]
            raise ErroPonte(500, "O Blender não conseguiu exportar esse arquivo: " + (linhas[-1][:300] if linhas else "sem explicação"))
        return self.responder_json({"saida": str(saida), "tamanho": saida.stat().st_size, "segundos": round(time.time() - inicio, 1), "como": achado[0]})

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
    ap.add_argument("--so-app", metavar="ID", help="publica só este app (ex.: companhia): sem a página inicial nem os outros apps, "
                                                   "e de fora (rede, túnel) a ponte não abre nem com a chave — só as salas e a loja")
    ap.add_argument("--loja", metavar="PASTA", help="a pasta da loja da Companhia (padrão: ~/.lnux-apps/loja)")
    args = ap.parse_args(argv)

    if args.mostrar_token:
        print(carregar_config()["token"])
        return 0
    so_app = None
    if args.so_app:
        so_app = app_do_catalogo(args.so_app)
        if not so_app:
            print(f"Não achei o app '{args.so_app}' no apps.json.", file=sys.stderr)
            return 2
    ponte = Ponte(not args.sem_ponte, args.raiz, args.permitir_comandos and not args.sem_comandos, args.permitir_host, args.sem_comandos,
                  so_app=so_app, loja=args.loja)
    try:
        servidor = criar_servidor(args.endereco, args.porta, ponte)
    except OSError as e:
        print(f"Não deu para usar a porta {args.porta}: {e}. Já tem outro servidor nela? Use --porta.", file=sys.stderr)
        return 1
    base = f"http://127.0.0.1:{args.porta}/" + (so_app["caminho"].strip("/") + "/" if so_app else "")
    url = base + (f"#token={ponte.token}" if ponte.ligada else "")
    print(f"LNUX-APPs {VERSAO} — {nome_do_sistema()}")
    print(f"  Abra: {url}")
    if so_app:
        print(f"  Publicando só: {so_app.get('nome') or so_app['id']} (sem a página inicial nem os outros apps; de fora, só as salas e a loja)")
        if ponte.ligada:
            print(f"  Loja: {ponte.loja}")
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
