#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes do servidor e da ponte local (servidor/lnux_apps.py), só com a biblioteca padrão.

Sobe o servidor numa porta livre, com uma pasta pessoal TEMPORÁRIA (não mexe nos seus arquivos), e confere:
arquivos dos apps, chave da ponte, proteção contra outros sites e DNS rebinding, pastas liberadas (inclusive
atalhos para fora), leitura com Range, gravação sem sobrescrever, mover/copiar/apagar, envio temporário,
conversão com o ffmpeg (se estiver instalado), comandos desligados/ligados, o modo sem ponte, as salas e a loja da
Companhia, as contas (cadastro com o código por e-mail, entrar, perfil, trocar a senha; com um servidor de e-mail de
mentira) e o modo que publica só um app (--so-app), em que quem chega pela internet nunca usa a ponte.

Uso:  python3 tests/testar_servidor.py
"""
from __future__ import annotations

import http.client
import json
import os
import struct
import sys
import tempfile
import threading
import time
import urllib.parse
import wave
from pathlib import Path

PASTA_TESTE = Path(tempfile.mkdtemp(prefix="lnux-apps-teste-"))
os.environ["HOME"] = str(PASTA_TESTE / "casa")
os.environ["LNUX_APPS_DADOS"] = str(PASTA_TESTE / "dados")
os.environ.pop("TERMUX_VERSION", None)
(PASTA_TESTE / "casa").mkdir()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "servidor"))
import lnux_apps  # noqa: E402  (precisa do HOME trocado antes)

CASA = Path(os.path.realpath(PASTA_TESTE / "casa"))
CASOS = []


def caso(nome):
    def registrar(f):
        CASOS.append((nome, f))
        return f
    return registrar


class Servidor:
    def __init__(self, ligada=True, comandos=False, hosts=(), sem_comandos=False, so_app=None, loja=None):
        self.ponte = lnux_apps.Ponte(ligada, [], comandos, hosts, sem_comandos, so_app=lnux_apps.app_do_catalogo(so_app) if so_app else None, loja=loja)
        self.http = lnux_apps.criar_servidor("127.0.0.1", 0, self.ponte)
        self.porta = self.http.server_address[1]
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def pedir(self, metodo, caminho, corpo=None, cabecalhos=None, token=True, json_corpo=None):
        c = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=20)
        h = {"Host": f"127.0.0.1:{self.porta}"}
        if token and self.ponte.token:
            h["X-Ponte-Token"] = self.ponte.token
        if json_corpo is not None:
            corpo = json.dumps(json_corpo).encode()
            h["Content-Type"] = "application/json"
        h.update(cabecalhos or {})
        c.request(metodo, caminho, body=corpo, headers=h)
        r = c.getresponse()
        dados = r.read()
        c.close()
        return r.status, dict(r.getheaders()), dados

    def json(self, metodo, caminho, **kw):
        status, cab, dados = self.pedir(metodo, caminho, **kw)
        return status, (json.loads(dados) if dados else None), cab

    def parar(self):
        self.http.shutdown()
        self.http.server_close()


def q(caminho):
    import urllib.parse
    return urllib.parse.quote(str(caminho))


S = Servidor()


@caso("Apps: entrega os arquivos com o tipo certo e esconde pastas ocultas e caminhos para fora")
def _():
    status, cab, dados = S.pedir("GET", "/comum/lnux.js", token=False)
    assert status == 200 and cab["Content-Type"].startswith("text/javascript") and b"LNUX" in dados
    assert S.pedir("GET", "/.git/config", token=False)[0] == 404
    assert S.pedir("GET", "/comum/../../../etc/passwd", token=False)[0] == 404
    assert S.pedir("GET", "/%2e%2e/%2e%2e/etc/passwd", token=False)[0] == 404
    status, cab, _ = S.pedir("GET", "/comum", token=False)
    assert status == 301 and cab["Location"] == "/comum/"


@caso("Chave: sem a chave ou com a chave errada a ponte recusa (401)")
def _():
    assert S.pedir("GET", "/api/estado", token=False)[0] == 401
    assert S.pedir("GET", "/api/estado", token=False, cabecalhos={"X-Ponte-Token": "errada" * 5})[0] == 401
    status, estado, _ = S.json("GET", "/api/estado")
    assert status == 200 and estado["ponte"] is True and str(CASA) in estado["raizes"]


@caso("DNS rebinding e outros sites: Host com nome de domínio e Origin diferente são recusados")
def _():
    assert S.pedir("GET", "/api/estado", cabecalhos={"Host": "site-malicioso.com:%d" % S.porta})[0] == 403
    assert S.pedir("GET", "/api/estado", cabecalhos={"Host": "localhost:%d" % S.porta})[0] == 200
    status, _, _ = S.pedir("POST", "/api/criar-pasta", json_corpo={"caminho": "~/x"}, cabecalhos={"Origin": "https://site-malicioso.com"})
    assert status == 403
    status, _, _ = S.pedir("POST", "/api/criar-pasta", json_corpo={"caminho": "~/de-mesma-origem"},
                           cabecalhos={"Origin": f"http://127.0.0.1:{S.porta}"})
    assert status == 201


@caso("Cookie: /api/entrar cria o cookie, que serve só para LER arquivos (não para gravar)")
def _():
    (CASA / "musica.txt").write_text("lá lá lá", "utf-8")
    status, _, cab = S.json("POST", "/api/entrar", json_corpo={})
    cookie = cab["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
    valor = cookie.split(";")[0]
    status, _, dados = S.pedir("GET", "/api/arquivo?caminho=" + q(CASA / "musica.txt"), token=False, cabecalhos={"Cookie": valor})
    assert status == 200 and dados.decode() == "lá lá lá"
    status, _, _ = S.pedir("PUT", "/api/arquivo?caminho=" + q(CASA / "novo.txt"), corpo=b"x", token=False, cabecalhos={"Cookie": valor})
    assert status == 401


@caso("Conexão reaproveitada: um corpo que a ponte não leu não vira o \"próximo pedido\"")
def _():
    c = http.client.HTTPConnection("127.0.0.1", S.porta, timeout=10)
    h = {"Host": f"127.0.0.1:{S.porta}", "X-Ponte-Token": S.ponte.token, "Content-Type": "application/json"}
    for _ in range(3):  # entrar não lê o corpo; recusa sem chave também não
        c.request("POST", "/api/entrar", body=b'{"x": 1}', headers=h)
        assert c.getresponse().read() and True
        c.request("PUT", "/api/arquivo?caminho=~/z.txt", body=b"abc", headers={"Host": h["Host"]})
        r = c.getresponse(); r.read()
        assert r.status == 401
        if r.getheader("Connection") == "close":
            c.close()
            c = http.client.HTTPConnection("127.0.0.1", S.porta, timeout=10)
        c.request("GET", "/api/estado", headers=h)
        r = c.getresponse()
        assert r.status == 200 and json.loads(r.read())["ponte"] is True
    c.close()


@caso("Pastas: lista pastas primeiro, esconde ocultos (a não ser que peça) e mostra tamanhos")
def _():
    (CASA / "Fotos").mkdir(exist_ok=True)
    (CASA / ".segredo").write_text("x")
    (CASA / "b.txt").write_text("12345")
    status, r, _ = S.json("GET", "/api/pastas?caminho=~")
    nomes = [i["nome"] for i in r["itens"]]
    tipos = [i["tipo"] for i in r["itens"]]
    assert status == 200 and tipos == sorted(tipos, key=lambda x: x != "pasta"), tipos  # pastas antes dos arquivos
    assert "Fotos" in nomes and ".segredo" not in nomes and "b.txt" in nomes
    assert next(i for i in r["itens"] if i["nome"] == "b.txt")["tamanho"] == 5
    _, r, _ = S.json("GET", "/api/pastas?caminho=~&ocultos=1")
    assert ".segredo" in [i["nome"] for i in r["itens"]]


@caso("Fora das pastas liberadas: /etc e um atalho que aponta para fora são recusados (403)")
def _():
    assert S.pedir("GET", "/api/arquivo?caminho=/etc/passwd")[0] == 403
    assert S.pedir("GET", "/api/pastas?caminho=" + q("~/../.."))[0] == 403
    os.symlink("/etc", CASA / "atalho-etc")
    assert S.pedir("GET", "/api/arquivo?caminho=" + q(CASA / "atalho-etc" / "passwd"))[0] == 403
    assert S.pedir("PUT", "/api/arquivo?caminho=" + q(CASA / "atalho-etc" / "novo"), corpo=b"x")[0] == 403


@caso("Arquivo: lê inteiro, um pedaço (Range 206), o fim (bytes=-3) e recusa pedaço impossível (416)")
def _():
    (CASA / "abc.bin").write_bytes(b"0123456789")
    url = "/api/arquivo?caminho=" + q(CASA / "abc.bin")
    assert S.pedir("GET", url)[2] == b"0123456789"
    status, cab, dados = S.pedir("GET", url, cabecalhos={"Range": "bytes=2-5"})
    assert status == 206 and dados == b"2345" and cab["Content-Range"] == "bytes 2-5/10"
    assert S.pedir("GET", url, cabecalhos={"Range": "bytes=-3"})[2] == b"789"
    assert S.pedir("GET", url, cabecalhos={"Range": "bytes=50-"})[0] == 416


@caso("Gravar: cria, não sobrescreve sem pedir (409), sobrescreve quando pede e exige a pasta existir")
def _():
    url = "/api/arquivo?caminho=" + q(CASA / "nota.txt")
    assert S.pedir("PUT", url, corpo="primeira".encode())[0] == 201
    assert S.pedir("PUT", url, corpo=b"segunda")[0] == 409
    assert (CASA / "nota.txt").read_text("utf-8") == "primeira"
    assert S.pedir("PUT", url + "&sobrescrever=1", corpo=b"segunda")[0] == 201
    assert (CASA / "nota.txt").read_text() == "segunda"
    assert S.pedir("PUT", "/api/arquivo?caminho=" + q(CASA / "nao-existe" / "x.txt"), corpo=b"x")[0] == 404
    assert not list(CASA.glob("*.enviando*"))


@caso("Mover, copiar e apagar: protege as pastas principais e pastas cheias")
def _():
    (CASA / "origem.txt").write_text("conteúdo", "utf-8")
    assert S.json("POST", "/api/copiar", json_corpo={"de": "~/origem.txt", "para": "~/copia.txt"})[0] == 200
    assert S.json("POST", "/api/copiar", json_corpo={"de": "~/origem.txt", "para": "~/copia.txt"})[0] == 409
    assert S.json("POST", "/api/mover", json_corpo={"de": "~/copia.txt", "para": "~/Fotos/movida.txt"})[0] == 200
    assert (CASA / "Fotos" / "movida.txt").read_text("utf-8") == "conteúdo" and not (CASA / "copia.txt").exists()
    assert S.json("POST", "/api/apagar", json_corpo={"caminho": "~/Fotos"})[0] == 409
    assert S.json("POST", "/api/apagar", json_corpo={"caminho": "~"})[0] == 403
    assert S.json("POST", "/api/apagar", json_corpo={"caminho": "~/Fotos", "recursivo": True})[0] == 200
    assert not (CASA / "Fotos").exists()


@caso("Envio temporário: vai para ~/.lnux-apps/tmp com um nome seguro")
def _():
    status, r, _ = S.json("PUT", "/api/temporario?nome=" + q("../../gravação.webm"), corpo=b"abc")
    assert status == 201
    caminho = Path(r["caminho"])
    assert caminho.parent == S.ponte.temporarios and caminho.name.endswith("gravação.webm") and caminho.read_bytes() == b"abc"


def wav_de_teste(destino: Path, segundos=1.0, taxa=8000):
    with wave.open(str(destino), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        import math
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / taxa))) for i in range(int(segundos * taxa))))


@caso("ffmpeg: converte WAV para MP3 em segundo plano, com progresso, e informa a mídia (ffprobe)")
def _():
    import shutil
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return "pulado (sem o ffmpeg)"
    wav_de_teste(CASA / "tom.wav", 2.0)
    status, info, _ = S.json("GET", "/api/midia?caminho=" + q(CASA / "tom.wav"))
    assert status == 200 and abs(info["duracao"] - 2.0) < 0.1 and info["audio"]["canais"] == 1
    status, t, _ = S.json("POST", "/api/converter", json_corpo={"entrada": "~/tom.wav", "perfil": "mp3"})
    assert status == 202
    for _ in range(100):
        _, t, _ = S.json("GET", "/api/tarefas/" + t["id"])
        if t["estado"] in ("pronto", "erro"):
            break
        time.sleep(0.1)
    assert t["estado"] == "pronto", t
    saida = Path(t["saida"])
    assert saida.suffix == ".mp3" and saida.stat().st_size > 1000 and saida.parent == S.ponte.temporarios
    assert not list(S.ponte.temporarios.glob("*.parcial.*"))
    # com destino escolhido, sem sobrescrever
    status, t2, _ = S.json("POST", "/api/converter", json_corpo={"entrada": "~/tom.wav", "perfil": "ogg", "saida": "~/tom.ogg"})
    assert status == 202
    for _ in range(100):
        _, t2, _ = S.json("GET", "/api/tarefas/" + t2["id"])
        if t2["estado"] in ("pronto", "erro"):
            break
        time.sleep(0.1)
    assert t2["estado"] == "pronto" and (CASA / "tom.ogg").exists()
    assert S.json("POST", "/api/converter", json_corpo={"entrada": "~/tom.wav", "perfil": "ogg", "saida": "~/tom.ogg"})[0] == 409


@caso("ffmpeg: lista as faixas e prepara para tocar (copiar a imagem, outra faixa de áudio, legenda embutida)")
def _():
    import shutil
    import subprocess
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return "pulado (sem o ffmpeg)"
    srt = CASA / "leg.srt"
    srt.write_text("1\n00:00:00,500 --> 00:00:01,500\nOlá, legenda\n", "utf-8")
    f = ["ffmpeg", "-loglevel", "error", "-y"]
    # MKV com H.264, duas faixas de áudio (português em AC-3 e inglês em MP3) e uma legenda SRT
    subprocess.run([*f, "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=2", "-f", "lavfi", "-i", "sine=frequency=300:duration=2",
                    "-f", "lavfi", "-i", "sine=frequency=900:duration=2", "-i", str(srt), "-map", "0", "-map", "1", "-map", "2", "-map", "3",
                    "-c:v", "libx264", "-c:a:0", "ac3", "-c:a:1", "libmp3lame", "-c:s", "srt",
                    "-metadata:s:a:0", "language=por", "-metadata:s:a:1", "language=eng", "-metadata:s:s:0", "language=por",
                    str(CASA / "filme.mkv")], check=True)
    status, info, _ = S.json("GET", "/api/midia?caminho=" + q(CASA / "filme.mkv"))
    assert status == 200 and info["video"]["codec"] == "h264", info
    assert [a["idioma"] for a in info["audios"]] == ["por", "eng"] and info["audios"][0]["codec"] == "ac3", info["audios"]
    assert len(info["legendas"]) == 1 and info["legendas"][0]["texto"] and info["legendas"][0]["idioma"] == "por"

    def converter(perfil, opcoes):
        status, t, _ = S.json("POST", "/api/converter", json_corpo={"entrada": "~/filme.mkv", "perfil": perfil, "opcoes": opcoes})
        assert status == 202, t
        for _ in range(300):
            _, t, _ = S.json("GET", "/api/tarefas/" + t["id"])
            if t["estado"] in ("pronto", "erro"):
                break
            time.sleep(0.1)
        assert t["estado"] == "pronto", t
        return Path(t["saida"])

    def sonda(caminho):
        r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(caminho)], capture_output=True, text=True)
        return json.loads(r.stdout)["streams"]

    mp4 = converter("tocar-copia", {"faixa": 1})
    fluxos = sonda(mp4)
    assert mp4.suffix == ".mp4" and [x["codec_name"] for x in fluxos] == ["h264", "aac"], fluxos
    assert fluxos[1]["channels"] == 2
    m4a = converter("faixa-audio", {"faixa": 0})
    assert [x["codec_name"] for x in sonda(m4a)] == ["aac"]
    vtt = converter("legenda-vtt", {"faixa": 0})
    texto = vtt.read_text("utf-8")
    assert vtt.suffix == ".vtt" and texto.startswith("WEBVTT") and "Olá, legenda" in texto, texto
    status, _, dados = S.pedir("GET", "/api/arquivo?caminho=" + q(vtt) + "&filename=x.vtt")
    assert status == 200 and b"WEBVTT" in dados, (status, dados[:200])   # parâmetros a mais no endereço são ignorados


def provedor_falso():
    """Um "provedor de IA" no próprio aparelho: responde em pedaços (SSE) e conta o que recebeu."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    recebidos = []

    class Falso(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def do_POST(self):
            corpo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            recebidos.append({"caminho": self.path, "auth": self.headers.get("Authorization"), "xi": self.headers.get("xi-api-key"), "x_api": self.headers.get("x-api-key"),
                              "cookie": self.headers.get("Cookie"), "ponte": self.headers.get("X-Ponte-Token"), "corpo": corpo})
            if self.path.endswith("/erro"):
                dados = b'{"error": {"message": "chave errada"}}'
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for pedaco in ("Olá", ", tudo", " bem?"):
                self.wfile.write(('data: {"choices":[{"delta":{"content":"%s"}}]}\n\n' % pedaco).encode())
                self.wfile.flush()
                time.sleep(0.05)
            self.wfile.write(b"data: [DONE]\n\n")
            self.close_connection = True

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Falso)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, recebidos


@caso("IA: guarda a chave no aparelho sem mostrá-la e o repasse injeta a chave só no endereço cadastrado, em pedaços")
def _():
    srv, recebidos = provedor_falso()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        status, r, _ = S.json("PUT", "/api/ia/chaves", json_corpo={"provedor": "teste", "chave": "sk-segredo-123", "url": base + "/v1"})
        assert status == 200 and r["provedores"]["teste"]["host"] == f"127.0.0.1:{srv.server_address[1]}", r
        assert "sk-segredo" not in json.dumps(r)
        arq = lnux_apps.DADOS / "ia.json"
        assert arq.stat().st_mode & 0o777 == 0o600 and "sk-segredo-123" in arq.read_text()
        status, _, dados = S.pedir("POST", "/api/ia/proxy", json_corpo={"url": base + "/v1/chat/completions", "provedor": "teste",
                                   "cabecalhos": {"Content-Type": "application/json", "Authorization": "Bearer roubada", "Cookie": "x=1"},
                                   "corpo": {"model": "m", "stream": True}})
        assert status == 200 and dados.count(b"data:") == 4 and b"[DONE]" in dados, dados
        ultimo = recebidos[-1]
        assert ultimo["auth"] == "Bearer sk-segredo-123" and ultimo["cookie"] is None and ultimo["ponte"] is None, ultimo
        assert json.loads(ultimo["corpo"]) == {"model": "m", "stream": True}
        # a chave de um provedor não vai para outro endereço
        srv2, recebidos2 = provedor_falso()
        try:
            S.pedir("POST", "/api/ia/proxy", json_corpo={"url": f"http://127.0.0.1:{srv2.server_address[1]}/v1/x", "provedor": "teste", "corpo": "{}"})
            assert recebidos2[-1]["auth"] is None
        finally:
            srv2.shutdown()
        # erro do provedor chega ao app com o código certo
        status, _, dados = S.pedir("POST", "/api/ia/proxy", json_corpo={"url": base + "/erro", "provedor": "teste", "corpo": "{}"})
        assert status == 401 and b"chave errada" in dados
        # ElevenLabs recebe a chave no cabeçalho próprio
        S.json("PUT", "/api/ia/chaves", json_corpo={"provedor": "elevenlabs", "chave": "xi-123", "url": base})
        S.pedir("POST", "/api/ia/proxy", json_corpo={"url": base + "/v1/text-to-speech/x", "provedor": "elevenlabs", "corpo": "{}"})
        assert recebidos[-1]["xi"] == "xi-123" and recebidos[-1]["auth"] is None
        # um provedor extra no jeito da Anthropic (ex.: claude-code-router) recebe a chave em x-api-key
        S.json("PUT", "/api/ia/chaves", json_corpo={"provedor": "ccr", "chave": "ccr-9", "url": base})
        S.pedir("POST", "/api/ia/proxy", json_corpo={"url": base + "/v1/messages", "provedor": "ccr", "tipo": "anthropic", "corpo": "{}"})
        assert recebidos[-1]["x_api"] == "ccr-9" and recebidos[-1]["auth"] is None
        # a ponte avisa que tem o repasse de IA
        _, estado, _ = S.json("GET", "/api/estado")
        assert estado["recursos"]["ia"] is True and "live2d_core" in estado["recursos"]
        # apagar
        status, r, _ = S.json("PUT", "/api/ia/chaves", json_corpo={"provedor": "teste", "chave": ""})
        assert "teste" not in r["provedores"]
    finally:
        srv.shutdown()


@caso("IA: o repasse recusa endereços que não são de IA, sem a chave da ponte e de outro site")
def _():
    status, r, _ = S.json("POST", "/api/ia/proxy", json_corpo={"url": "https://example.com/roubar", "corpo": "{}"})
    assert status == 403 and "não repassa" in r["erro"]
    assert S.json("POST", "/api/ia/proxy", json_corpo={"url": "http://api.openai.com/v1/x"})[0] == 403  # sem HTTPS
    assert S.json("POST", "/api/ia/proxy", json_corpo={"url": "file:///etc/passwd"})[0] == 400
    assert S.json("POST", "/api/ia/proxy", json_corpo={"url": "https://api.openai.com/v1/x"}, token=False)[0] == 401
    assert S.json("POST", "/api/ia/proxy", json_corpo={"url": "https://api.openai.com/v1/x"}, cabecalhos={"Origin": "http://mal.example"})[0] == 403
    assert S.json("GET", "/api/ia/chaves", token=False)[0] == 401
    # endereço extra liberado pela pessoa (ex.: o Ollama de outro computador)
    status, r, _ = S.json("PUT", "/api/ia/chaves", json_corpo={"hosts": ["192.168.0.10:11434"]})
    assert status == 200 and r["hosts"] == ["192.168.0.10:11434"]
    assert lnux_apps.ia_host_permitido("http://192.168.0.10:11434/api/chat", r["hosts"]) and not lnux_apps.ia_host_permitido("http://192.168.0.11:11434/", r["hosts"])
    assert S.json("PUT", "/api/ia/chaves", json_corpo={"hosts": ["a b"]})[0] == 400
    S.json("PUT", "/api/ia/chaves", json_corpo={"hosts": []})


@caso("Live2D: guarda o núcleo enviado pela pessoa e entrega para o <script> (com o cookie)")
def _():
    assert S.pedir("GET", "/api/live2d/core")[0] == 404
    assert S.pedir("PUT", "/api/live2d/core", corpo=b"alert(1)", cabecalhos={"Content-Type": "text/javascript"})[0] == 400
    nucleo = b"/* Live2D */ var Live2DCubismCore; (function(){})();"
    assert S.pedir("PUT", "/api/live2d/core", corpo=nucleo)[0] == 200
    status, cab, dados = S.pedir("GET", "/api/live2d/core", token=False, cabecalhos={"Cookie": "lnux_ponte=" + S.ponte.token})
    assert status == 200 and dados == nucleo and cab["Content-Type"].startswith("text/javascript")
    assert S.pedir("PUT", "/api/live2d/core", corpo=nucleo, token=False, cabecalhos={"Cookie": "lnux_ponte=" + S.ponte.token})[0] == 401


@caso("MediaPipe: a ponte baixa uma vez os arquivos do rastreamento (pacote do npm e modelos), guarda e entrega")
def _():
    import io
    import tarfile
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    # um "npm" e um "depósito de modelos" de mentira
    pacote = io.BytesIO()
    with tarfile.open(fileobj=pacote, mode="w:gz") as tgz:
        for nome, dados in (("package/wasm/vision_wasm_internal.js", b"// carregador"), ("package/wasm/vision_wasm_internal.wasm", b"\0asm\1\0\0\0"), ("package/README.md", b"x")):
            info = tarfile.TarInfo(nome)
            info.size = len(dados)
            tgz.addfile(info, io.BytesIO(dados))
    pedidos = []

    class Fonte(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            pedidos.append(self.path)
            corpo = pacote.getvalue() if self.path == "/pacote.tgz" else b"modelo do rosto" if self.path.endswith("/face_landmarker.task") else None
            self.send_response(200 if corpo is not None else 404)
            self.send_header("Content-Length", str(len(corpo or b"")))
            self.end_headers()
            self.wfile.write(corpo or b"")

    fonte = ThreadingHTTPServer(("127.0.0.1", 0), Fonte)
    threading.Thread(target=fonte.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{fonte.server_address[1]}"
    antes = lnux_apps.MEDIAPIPE_PACOTE, lnux_apps.MEDIAPIPE_MODELOS
    lnux_apps.MEDIAPIPE_PACOTE, lnux_apps.MEDIAPIPE_MODELOS = base + "/pacote.tgz", base + "/modelos/"
    try:
        status, r, _ = S.json("GET", "/api/mediapipe")
        assert status == 200 and r["versao"] == lnux_apps.MEDIAPIPE_VERSAO and all(v is None for v in r["arquivos"].values())
        assert S.pedir("GET", "/api/mediapipe/face_landmarker.task")[0] == 404  # ainda não baixou
        assert S.pedir("GET", "/api/mediapipe/ia.json")[0] == 404 and S.pedir("GET", "/api/mediapipe/..%2Fia.json")[0] == 404  # só os nomes da lista
        assert S.json("POST", "/api/mediapipe", json_corpo={"arquivos": ["../ponte.json"]})[0] == 400
        assert S.json("POST", "/api/mediapipe", json_corpo={"arquivos": ["face_landmarker.task"]}, token=False)[0] == 401
        assert S.json("POST", "/api/mediapipe", json_corpo={"arquivos": ["hand_landmarker.task"]})[0] == 502  # a fonte não tem: erro explicado
        status, r, _ = S.json("POST", "/api/mediapipe", json_corpo={"arquivos": ["vision_wasm_internal.wasm", "face_landmarker.task"]})
        assert status == 200 and r["arquivos"]["vision_wasm_internal.wasm"] == 8 and r["arquivos"]["vision_wasm_internal.js"] == 13 and r["arquivos"]["face_landmarker.task"] == 15
        assert r["arquivos"]["hand_landmarker.task"] is None
        status, cab, dados = S.pedir("GET", "/api/mediapipe/vision_wasm_internal.wasm")
        assert status == 200 and dados == b"\0asm\1\0\0\0" and cab["Content-Type"] == "application/wasm"
        assert S.pedir("GET", "/api/mediapipe/face_landmarker.task")[2] == b"modelo do rosto"
        # o que já está guardado não é baixado de novo
        n = len(pedidos)
        assert S.json("POST", "/api/mediapipe", json_corpo={"arquivos": ["vision_wasm_internal.js", "face_landmarker.task"]})[0] == 200 and len(pedidos) == n
        assert not list((Path(os.environ["LNUX_APPS_DADOS"]) / "mediapipe").rglob("*.baixando")) and not list((Path(os.environ["LNUX_APPS_DADOS"]) / "mediapipe").rglob("*.tgz"))
        assert S.json("GET", "/api/estado")[1]["recursos"]["mediapipe"] == lnux_apps.MEDIAPIPE_VERSAO
    finally:
        lnux_apps.MEDIAPIPE_PACOTE, lnux_apps.MEDIAPIPE_MODELOS = antes
        fonte.shutdown()


@caso("Blender: a ponte converte .blend com o Blender do aparelho (sem rodar os scripts do arquivo) e limpa depois")
def _():
    import stat
    # um "blender" de mentira: grava um .glb e anota como foi chamado
    falso = PASTA_TESTE / "blender"
    falso.write_text("#!" + sys.executable + "\nimport sys, json\nargs = sys.argv[1:]\nsaida = args[args.index('--') + 1]\n"
                     "open(saida, 'wb').write(b'glTF' + bytes(20))\nopen(saida + '.chamada', 'w').write(json.dumps(args))\n", "utf-8")
    falso.chmod(falso.stat().st_mode | stat.S_IEXEC)
    antes = os.environ.get("LNUX_APPS_BLENDER")
    os.environ["LNUX_APPS_BLENDER"] = str(falso)
    lnux_apps.BLENDER_ACHADO.clear()
    try:
        status, r, _ = S.json("GET", "/api/blender")
        assert status == 200 and r["disponivel"] is True and r["como"] == "blender", r
        assert S.json("GET", "/api/estado")[1]["recursos"]["blender"] is True
        assert S.pedir("PUT", "/api/blender/lote01/cena.blend", corpo=b"BLENDER-v305", token=False)[0] == 401
        assert S.pedir("PUT", "/api/blender/../cena.blend", corpo=b"x")[0] in (400, 404)
        assert S.pedir("PUT", "/api/blender/lote01/cena.blend", corpo=b"BLENDER-v305")[0] == 201
        assert S.pedir("PUT", "/api/blender/lote01/..%2F..%2Ffora.png", corpo=b"png")[0] == 201  # o nome é limpo: fica dentro da pasta do lote
        pasta = Path(os.environ["LNUX_APPS_DADOS"]) / "tmp" / "blender-lote01"
        assert sorted(f.name for f in pasta.iterdir()) == ["cena.blend", "fora.png"]
        assert S.json("POST", "/api/blender/lote01", json_corpo={"principal": "fora.png"})[0] == 400  # só .blend
        assert S.json("POST", "/api/blender/lote01", json_corpo={"entrada": "/etc/passwd"})[0] == 403  # fora das pastas liberadas
        status, r, _ = S.json("POST", "/api/blender/lote01", json_corpo={"principal": "cena.blend"})
        assert status == 200 and r["tamanho"] == 24 and r["como"] == "blender", r
        chamada = json.loads(Path(r["saida"] + ".chamada").read_text())
        assert "--background" in chamada and "--disable-autoexec" in chamada and "--python-expr" in chamada and chamada[chamada.index("--python-expr") + 1] == lnux_apps.BLENDER_SCRIPT
        assert "export_scene.gltf" in lnux_apps.BLENDER_SCRIPT and "exec(" not in lnux_apps.BLENDER_SCRIPT
        status, _, dados = S.pedir("GET", "/api/arquivo?caminho=" + r["saida"])
        assert status == 200 and dados[:4] == b"glTF"
        # um .blend de uma pasta liberada (escolhido pela janela de pastas) também serve
        (CASA / "mapa.blend").write_bytes(b"BLENDER-v305")
        status, r2, _ = S.json("POST", "/api/blender/lote02", json_corpo={"entrada": "~/mapa.blend"})
        assert status == 200 and Path(r2["saida"]).name == "mapa.glb"
        for lote in ("lote01", "lote02"):
            assert S.json("DELETE", f"/api/blender/{lote}")[0] == 200
        assert not pasta.exists() and (CASA / "mapa.blend").exists()
        # sem Blender no aparelho: a rota diz que não há (a Companhia usa o leitor próprio)
        os.environ["LNUX_APPS_BLENDER"] = ""
        lnux_apps.BLENDER_ACHADO["resposta"] = None
        assert S.json("GET", "/api/blender")[1]["disponivel"] is False
        S.pedir("PUT", "/api/blender/lote03/cena.blend", corpo=b"BLENDER-v305")
        status, r, _ = S.json("POST", "/api/blender/lote03", json_corpo={"principal": "cena.blend"})
        assert status == 501 and "Blender" in r["erro"]
        S.json("DELETE", "/api/blender/lote03")
    finally:
        lnux_apps.BLENDER_ACHADO.clear()
        if antes is None:
            os.environ.pop("LNUX_APPS_BLENDER", None)
        else:
            os.environ["LNUX_APPS_BLENDER"] = antes


PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c63f8cfc0f01f0005000201" "d6a3a45b0000000049454e44ae426082")


@caso("Salas: quem tem o código entra sem a chave, troca posições e mensagens, e não alcança mais nada")
def _():
    status, sala, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Praça\n<b>"})
    assert status == 201 and len(sala["codigo"]) == 8 and sala["nome"] == "Praça <b>" and sala["chave"] and sala["mapa"] is None, sala
    c, chave = sala["codigo"], sala["chave"]
    visita = dict(token=False)  # daqui em diante, como quem recebeu o link: sem a chave da ponte
    assert S.json("GET", "/api/sala/naoexiste", **visita)[0] == 404
    status, info, _ = S.json("GET", f"/api/sala/{c}", **visita)
    assert status == 200 and info["pessoas"] == 0 and "chave" not in info
    # o cenário: só quem criou manda
    assert S.pedir("PUT", f"/api/sala/{c}/mapa?nome=praca", corpo=b"glTF-mapa", **visita)[0] == 403
    assert S.pedir("GET", f"/api/sala/{c}/mapa", **visita)[0] == 404
    assert S.pedir("PUT", f"/api/sala/{c}/mapa?nome=praca", corpo=b"glTF-mapa", cabecalhos={"X-Sala-Chave": chave}, **visita)[0] == 201
    # o ajuste (tamanho, giro, posição, começo) pode vir junto com o arquivo, no endereço; um ajuste depois muda só a versão, não o arquivo
    ajuste = urllib.parse.quote(json.dumps({"escala": 1.5, "posicao": [0, -2, 0]}))
    status, r, _ = S.json("PUT", f"/api/sala/{c}/mapa?nome=praca&ajuste={ajuste}", corpo=b"glTF-mapa", cabecalhos={"X-Sala-Chave": chave}, **visita)
    assert status == 201 and r["mapa"]["ajuste"] == {"escala": 1.5, "posicao": [0, -2, 0]} and r["mapa"]["arquivo"] == r["mapa"]["versao"], r
    arquivo = r["mapa"]["arquivo"]
    r = S.json("POST", f"/api/sala/{c}/config", json_corpo={"ajuste": {"escala": 2}}, cabecalhos={"X-Sala-Chave": chave}, **visita)[1]
    assert r["mapa"]["ajuste"] == {"escala": 2} and r["mapa"]["arquivo"] == arquivo and r["mapa"]["versao"] == arquivo + 1, r
    assert S.json("PUT", f"/api/sala/{c}/mapa?nome=praca&ajuste=nao-e-json", corpo=b"glTF-mapa", cabecalhos={"X-Sala-Chave": chave}, **visita)[1]["mapa"]["ajuste"] == {}
    S.json("POST", f"/api/sala/{c}/config", json_corpo={"ajuste": {"escala": 2}}, cabecalhos={"X-Sala-Chave": chave}, **visita)
    status, cab, dados = S.pedir("GET", f"/api/sala/{c}/mapa", **visita)
    assert status == 200 and dados == b"glTF-mapa" and cab["Content-Type"] == "model/gltf-binary"
    # duas pessoas entram
    _, ana, _ = S.json("POST", f"/api/sala/{c}/entrar", json_corpo={"nome": "Ana"}, **visita)
    _, bia, _ = S.json("POST", f"/api/sala/{c}/entrar", json_corpo={"nome": "Bia" + "x" * 60}, **visita)
    assert ana["id"] != bia["id"] and len(bia["segredo"]) >= 12
    eu = lambda j, **mais: {"id": j["id"], "segredo": j["segredo"], **mais}
    status, r, _ = S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(ana, estado={"p": [1, 0, 2], "r": 0.5, "e": "andando"}), **visita)
    assert status == 200 and [x["nome"] for x in r["pessoas"]] == ["Ana", "Bia" + "x" * 21] and r["mapa"] == 5 and all("segredo" not in x for x in r["pessoas"])
    status, r, _ = S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia, estado={"p": [0, 0, 0]}), **visita)
    assert next(x for x in r["pessoas"] if x["id"] == ana["id"])["estado"] == {"p": [1, 0, 2], "r": 0.5, "e": "andando"}
    # ninguém se passa por outra pessoa
    assert S.json("POST", f"/api/sala/{c}/estado", json_corpo={"id": ana["id"], "segredo": bia["segredo"], "estado": {}}, **visita)[0] == 403
    assert S.json("POST", f"/api/sala/{c}/falar", json_corpo={"id": ana["id"], "segredo": "errado", "texto": "oi"}, **visita)[0] == 403
    # bate-papo: cada um recebe só o que ainda não viu
    assert S.json("POST", f"/api/sala/{c}/falar", json_corpo=eu(ana, texto="  Oi,\tBia!  " + "z" * 400), **visita)[1]["n"] == 1
    assert S.json("POST", f"/api/sala/{c}/falar", json_corpo=eu(ana, texto="   "), **visita)[0] == 400
    _, r, _ = S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia, desde=0), **visita)
    assert len(r["mensagens"]) == 1 and r["mensagens"][0]["nome"] == "Ana" and r["mensagens"][0]["texto"].startswith("Oi, Bia!") and len(r["mensagens"][0]["texto"]) == 300
    assert S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia, desde=1), **visita)[1]["mensagens"] == []
    # avatar: cada um manda o seu; os outros pegam pelo id
    assert S.pedir("PUT", f"/api/sala/{c}/avatar?id={ana['id']}&segredo=errado", corpo=b"vrm", **visita)[0] == 403
    assert S.pedir("PUT", f"/api/sala/{c}/avatar?id={ana['id']}&segredo={ana['segredo']}", corpo=b"vrm-da-ana", **visita)[0] == 201
    assert S.pedir("GET", f"/api/sala/{c}/avatar/{ana['id']}", **visita)[2] == b"vrm-da-ana"
    assert S.pedir("GET", f"/api/sala/{c}/avatar/{bia['id']}", **visita)[0] == 404 and S.pedir("GET", f"/api/sala/{c}/avatar/..%2Fmapa.glb", **visita)[0] == 404
    assert S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia), **visita)[1]["pessoas"][0]["avatar"] == 1
    # vídeo na tela: o link, o lugar da tela e o relógio (todos veem o mesmo pedaço)
    video = lambda j, **mais: S.json("POST", f"/api/sala/{c}/video", json_corpo=eu(j, **mais), **visita)
    yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert video(ana, acao="abrir", url="javascript:alert(1)")[0] == 400 and video(ana, acao="abrir", url="https://x.com/<script>")[0] == 400
    assert video(ana, acao="pausar")[0] == 404  # ainda sem vídeo
    status, v, _ = video(ana, acao="abrir", url=yt, modo="seguir", tamanho=99, em=12)
    assert status == 200 and v["url"] == yt and v["modo"] == "seguir" and v["tamanho"] == 12 and v["pausado"] is None and 11.5 < v["agora"] - v["inicio"] < 13, v
    n = v["n"]
    pessoas = S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia), **visita)[1]["pessoas"]
    assert next(x for x in pessoas if x["id"] == ana["id"])["video"] == n and next(x for x in pessoas if x["id"] == bia["id"])["video"] == 0
    assert S.json("GET", f"/api/sala/{c}/video/{ana['id']}", **visita)[1]["url"] == yt and S.json("GET", f"/api/sala/{c}/video/{bia['id']}", **visita)[0] == 404
    v = video(ana, acao="pausar")[1]
    assert 11.5 < v["pausado"] < 14 and v["n"] > n
    assert 41.5 < video(ana, acao="pular", mais=30)[1]["pausado"] < 44
    assert video(ana, acao="pular", mais=-999)[1]["pausado"] == 0 and video(ana, acao="pular", em=5)[1]["pausado"] == 5
    v = video(ana, acao="continuar")[1]
    assert v["pausado"] is None and 4.5 < v["agora"] - v["inicio"] < 6
    v = video(ana, acao="lugar", modo="parada", pos=[1, 2.5, -3], rumo=1.5, tamanho=0.1)[1]
    assert v["modo"] == "parada" and v["pos"] == [1, 2.5, -3] and v["rumo"] == 1.5 and v["tamanho"] == 0.5 and v["url"] == yt
    assert video(ana, acao="lugar", pos=[1, "x", 3])[0] == 400 and video(ana, acao="pular", mais="nan")[0] == 400 and video(ana, acao="outra")[0] == 400
    assert S.json("POST", f"/api/sala/{c}/video", json_corpo={"id": ana["id"], "segredo": bia["segredo"], "acao": "fechar"}, **visita)[0] == 403
    assert video(bia, acao="abrir", url="https://vimeo.com/76979871")[0] == 200
    # quem criou deixa só ele pôr vídeos: os dos outros somem
    assert S.json("POST", f"/api/sala/{c}/config", json_corpo={"videos": "dono"}, cabecalhos={"X-Sala-Chave": chave}, **visita)[1]["videos"] == "dono"
    assert S.json("GET", f"/api/sala/{c}/video/{bia['id']}", **visita)[0] == 404 and video(bia, acao="abrir", url=yt)[0] == 403
    assert S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia), **visita)[1]["videos"] == "dono"
    _, dona, _ = S.json("POST", f"/api/sala/{c}/entrar", json_corpo={"nome": "Dona"}, cabecalhos={"X-Sala-Chave": chave}, **visita)
    assert video(dona, acao="abrir", url=yt)[0] == 200 and video(dona, acao="fechar")[1]["video"] is None
    S.json("POST", f"/api/sala/{c}/sair", json_corpo=eu(dona), **visita)
    S.json("POST", f"/api/sala/{c}/config", json_corpo={"videos": "todos"}, cabecalhos={"X-Sala-Chave": chave}, **visita)
    # o código da sala não abre o resto da ponte
    assert S.json("GET", "/api/pastas?caminho=~", cabecalhos={"X-Sala-Chave": chave}, **visita)[0] == 401
    assert S.json("POST", "/api/sala/" + c + "/estado", json_corpo=eu(ana), cabecalhos={"Origin": "http://mal.example"}, **visita)[0] == 403
    assert S.pedir("POST", f"/api/sala/{c}/estado", corpo=b"x" * 30000, cabecalhos={"Content-Type": "application/json"}, **visita)[0] == 413
    # quem some por um tempo sai sozinho; quem sai, sai na hora
    lnux_apps.SALAS[c].pessoas[bia["id"]]["visto"] -= lnux_apps.SALA_SUMIU + 1
    _, r, _ = S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(ana), **visita)
    assert [x["nome"] for x in r["pessoas"]] == ["Ana"]
    assert S.json("POST", f"/api/sala/{c}/estado", json_corpo=eu(bia), **visita)[0] == 403
    assert S.json("POST", f"/api/sala/{c}/sair", json_corpo=eu(ana), **visita)[0] == 200
    pasta = lnux_apps.SALAS[c].pasta
    assert not (pasta / f"avatar-{ana['id']}.vrm").exists() and (pasta / "mapa.glb").exists()
    # fechar: só quem criou
    assert S.json("DELETE", f"/api/sala/{c}", **visita)[0] == 403
    assert S.json("DELETE", f"/api/sala/{c}", cabecalhos={"X-Sala-Chave": chave}, **visita)[0] == 200
    assert S.json("GET", f"/api/sala/{c}", **visita)[0] == 404 and not pasta.exists()
    # uma sala vazia há um tempo é fechada sozinha
    _, velha, _ = S.json("POST", "/api/sala", json_corpo={})
    lnux_apps.SALAS[velha["codigo"]].vista -= lnux_apps.SALA_VAZIA + 1
    S.json("GET", "/api/sala/qualquer", **visita)
    assert velha["codigo"] not in lnux_apps.SALAS
    assert S.json("GET", "/api/estado")[1]["recursos"]["salas"] is True


@caso("Salas: qualquer um cria (se o dono deixar), com as opções: pública ou privada, senha, quantas pessoas, bate-papo")
def _():
    visita = dict(token=False)
    fora = {"Cf-Connecting-Ip": "203.0.113.7"}
    status, lista, _ = S.json("GET", "/api/salas", **visita)
    assert status == 200 and lista["criar"] is True and lista["visitantes_criam"] is True and lista["dono"] is False
    # uma visita cria uma sala pública, com senha, para 3 pessoas e sem bate-papo
    status, a, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Corrida", "descricao": "Quem chega primeiro\nganha", "publica": True, "senha": "1234",
                                                           "max": 3, "bate_papo": False, "criador": "Ana"}, cabecalhos=fora, **visita)
    assert status == 201 and a["chave"] and a["descricao"] == "Quem chega primeiro ganha" and a["senha"] is True and a["max"] == 3 and a["bate_papo"] is False and a["criador"] == "Ana", a
    # e uma privada (não aparece na lista; entra quem tem o código)
    _, b, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Só nós", "publica": False, "max": 99}, cabecalhos=fora, **visita)
    assert b["max"] == lnux_apps.SALA_PESSOAS and b["publica"] is False
    lista = S.json("GET", "/api/salas", **visita)[1]["salas"]
    assert [x["codigo"] for x in lista] == [a["codigo"]] and "chave" not in json.dumps(lista) and all(x["publica"] for x in lista)
    assert S.json("GET", f"/api/sala/{b['codigo']}", **visita)[1]["nome"] == "Só nós"
    # a senha: sem ela ou errada, não entra; quem criou entra sem (pela chave da sala)
    assert S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Bia"}, **visita)[0] == 403
    assert S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Bia", "senha": "4321"}, **visita)[0] == 403
    status, ana, _ = S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Ana"}, cabecalhos={"X-Sala-Chave": a["chave"]}, **visita)
    assert status == 201
    _, bia, _ = S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Bia", "senha": "1234"}, **visita)
    _, cia, _ = S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Cia", "senha": "1234"}, **visita)
    assert S.json("POST", f"/api/sala/{a['codigo']}/entrar", json_corpo={"nome": "Dani", "senha": "1234"}, **visita)[0] == 429  # cheia: 3 pessoas
    # sem bate-papo
    assert S.json("POST", f"/api/sala/{a['codigo']}/falar", json_corpo={"id": bia["id"], "segredo": bia["segredo"], "texto": "oi"}, **visita)[0] == 403
    # quem criou muda as opções depois (e só ela)
    assert S.json("POST", f"/api/sala/{a['codigo']}/config", json_corpo={"bate_papo": True}, **visita)[0] == 403
    r = S.json("POST", f"/api/sala/{a['codigo']}/config", json_corpo={"bate_papo": True, "senha": "", "max": 4, "publica": False, "criador": "Outra"},
               cabecalhos={"X-Sala-Chave": a["chave"]}, **visita)[1]
    assert r["bate_papo"] and not r["senha"] and r["max"] == 4 and not r["publica"] and r["criador"] == "Ana", r
    assert S.json("POST", f"/api/sala/{a['codigo']}/falar", json_corpo={"id": cia["id"], "segredo": cia["segredo"], "texto": "agora sim"}, **visita)[0] == 200
    assert S.json("GET", "/api/salas", **visita)[1]["salas"] == []
    # um mundo da loja vira o cenário (sem enviar o arquivo), com a miniatura dele
    _, mundo, _ = S.json("PUT", "/api/loja/mundo?nome=Pista&arquivo=pista.glb", corpo=b"glTF" + b"p" * 64, **visita)
    assert S.pedir("PUT", f"/api/loja/{mundo['item']['id']}/miniatura", corpo=PNG, cabecalhos={"X-Loja-Segredo": mundo["segredo"]}, **visita)[0] == 201
    assert S.json("POST", f"/api/sala/{a['codigo']}/mapa", json_corpo={"loja": mundo["item"]["id"]}, **visita)[0] == 403
    status, r, _ = S.json("POST", f"/api/sala/{a['codigo']}/mapa", json_corpo={"loja": mundo["item"]["id"]}, cabecalhos={"X-Sala-Chave": a["chave"]}, **visita)
    assert status == 201 and r["mapa"]["nome"] == "Pista" and r["miniatura"] == 1 and r["mapa"]["ajuste"] == {} and r["mapa"]["arquivo"] == r["mapa"]["versao"], r
    assert S.pedir("GET", f"/api/sala/{a['codigo']}/mapa", **visita)[2] == b"glTF" + b"p" * 64
    assert S.pedir("GET", f"/api/sala/{a['codigo']}/miniatura", **visita)[2] == PNG
    assert S.json("POST", f"/api/sala/{a['codigo']}/mapa", json_corpo={"loja": "000000000000"}, cabecalhos={"X-Sala-Chave": a["chave"]}, **visita)[0] == 404
    # a miniatura enviada por quem criou (só imagem)
    assert S.pedir("PUT", f"/api/sala/{b['codigo']}/miniatura", corpo=b"<svg/>", cabecalhos={"X-Sala-Chave": b["chave"]}, **visita)[0] == 400
    assert S.pedir("PUT", f"/api/sala/{b['codigo']}/miniatura", corpo=PNG, cabecalhos={"X-Sala-Chave": b["chave"]}, **visita)[0] == 201
    # limite de salas abertas por pessoa (o dono não tem)
    _, c3, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Três"}, cabecalhos=fora, **visita)
    assert S.json("POST", "/api/sala", json_corpo={"nome": "Quatro"}, cabecalhos=fora, **visita)[0] == 429
    assert S.json("POST", "/api/sala", json_corpo={"nome": "Outra pessoa"}, cabecalhos={"Cf-Connecting-Ip": "198.51.100.4"}, **visita)[0] == 201
    # o dono fecha a criação para os visitantes (e só ele pode)
    assert S.json("POST", "/api/salas/ajustes", json_corpo={"visitantes_criam": False}, **visita)[0] == 403
    assert S.json("POST", "/api/salas/ajustes", json_corpo={"visitantes_criam": False})[1] == {"visitantes_criam": False}
    assert S.json("POST", "/api/sala", json_corpo={"nome": "X"}, cabecalhos={"Cf-Connecting-Ip": "192.0.2.1"}, **visita)[0] == 403
    assert S.json("GET", "/api/salas", **visita)[1]["criar"] is False and S.json("GET", "/api/salas")[1]["criar"] is True
    assert S.json("GET", "/api/publico", **visita)[1]["salas_criar"] is False
    assert S.json("POST", "/api/sala", json_corpo={"nome": "Do dono"})[0] == 201
    S.json("POST", "/api/salas/ajustes", json_corpo={"visitantes_criam": True})
    for codigo in list(lnux_apps.SALAS):
        lnux_apps.SALAS.pop(codigo)
    assert S.json("DELETE", f"/api/loja/{mundo['item']['id']}")[0] == 200  # a loja volta vazia para o caso dela


class SMTPFalso:
    """Um servidor de e-mail de mentira (só o necessário do SMTP): guarda o que chega para o teste ler o código."""

    def __init__(self):
        import socketserver
        caixa = self.mensagens = []
        autenticacoes = self.autenticacoes = []

        class Manipulador(socketserver.StreamRequestHandler):
            def handle(self):
                escrever = lambda t: self.wfile.write((t + "\r\n").encode())
                escrever("220 falso ESMTP")
                while True:
                    linha = self.rfile.readline()
                    if not linha:
                        return
                    cmd = linha.decode("utf-8", "replace").strip()
                    up = cmd.upper()
                    if up.startswith(("EHLO", "HELO")):
                        escrever("250-falso")
                        escrever("250 AUTH PLAIN LOGIN")
                    elif up.startswith("AUTH"):
                        autenticacoes.append(cmd)
                        escrever("235 ok")
                    elif up == "DATA":
                        escrever("354 manda")
                        linhas = []
                        while True:
                            l = self.rfile.readline()
                            if l in (b".\r\n", b".\n", b""):
                                break
                            linhas.append(l)
                        caixa.append(b"".join(linhas).decode("utf-8", "replace"))
                        escrever("250 ok")
                    elif up == "QUIT":
                        escrever("221 tchau")
                        return
                    else:
                        escrever("250 ok")

        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self.servidor = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Manipulador)
        self.servidor.daemon_threads = True
        self.porta = self.servidor.server_address[1]
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()

    def ultima(self):
        import email
        import email.policy
        return email.message_from_string(self.mensagens[-1], policy=email.policy.default)

    def codigo(self):
        import re
        return re.search(r"\b(\d{6})\b", self.ultima()["Subject"]).group(1)

    def parar(self):
        self.servidor.shutdown()
        self.servidor.server_close()


@caso("Contas: cadastro com o código por e-mail, entrar, perfil (foto, bio...), esqueci a senha, apagar; tudo guardado no aparelho")
def _():
    import re
    import stat
    smtp = SMTPFalso()
    visita = dict(token=False)
    try:
        sem = {"nome": "Ana", "email": "ana@exemplo.com", "senha": "segredo123", "idade": 20}
        # sem o e-mail do servidor configurado, não dá para criar conta
        assert S.json("GET", "/api/contas/config", **visita)[1]["email"] is False
        assert S.json("POST", "/api/contas/cadastro", json_corpo=sem, **visita)[0] == 503
        # o dono configura o e-mail (a senha do e-mail fica no aparelho e nunca volta)
        assert S.json("GET", "/api/contas/ajustes", **visita)[0] == 403
        assert S.json("POST", "/api/contas/ajustes", json_corpo={"email": {"servidor": "x"}}, **visita)[0] == 403
        r = S.json("POST", "/api/contas/ajustes", json_corpo={"email": {"servidor": "127.0.0.1", "porta": smtp.porta, "seguranca": "nenhuma", "usuario": "dono",
                                                                         "senha": "senha-do-email", "remetente": "dono@exemplo.com", "nome": "Servidor da Praça"}})[1]
        assert r["email"] is True
        aj = S.json("GET", "/api/contas/ajustes")[1]
        assert aj["email"]["configurado"] and aj["email"]["tem_senha"] and "senha-do-email" not in json.dumps(aj) and aj["idade_minima"] == 13
        assert (os.stat(Path(os.environ["LNUX_APPS_DADOS"]) / "email.json").st_mode & 0o777) == 0o600
        assert S.json("POST", "/api/contas/email-teste", json_corpo={"para": "dono@exemplo.com"})[0] == 200
        assert smtp.ultima()["To"] == "dono@exemplo.com" and smtp.autenticacoes, smtp.autenticacoes
        assert S.json("GET", "/api/publico", **visita)[1]["contas_email"] is True
        # cadastro: confere os dados
        assert S.json("POST", "/api/contas/cadastro", json_corpo={**sem, "email": "ana@"}, **visita)[0] == 400
        assert S.json("POST", "/api/contas/cadastro", json_corpo={**sem, "senha": "curta"}, **visita)[0] == 400
        assert S.json("POST", "/api/contas/cadastro", json_corpo={**sem, "idade": 11}, **visita)[0] == 403  # menos que a idade mínima
        status, r, _ = S.json("POST", "/api/contas/cadastro", json_corpo={**sem, "email": "Ana@Exemplo.com"}, **visita)
        assert status == 201 and r["pendente"] and r["email"] == "an***@exemplo.com", r
        msg = smtp.ultima()
        assert msg["To"] == "ana@exemplo.com" and "Servidor da Praça" in msg["From"] and re.search(r"\b\d{6}\b", msg.get_content()), msg
        codigo = smtp.codigo()
        # antes de confirmar, não entra (e não manda outro código antes de 1 minuto)
        status, r, _ = S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "segredo123"}, **visita)
        assert status == 403 and r["pendente"], r
        assert S.json("POST", "/api/contas/reenviar", json_corpo={"email": "ana@exemplo.com"}, **visita)[0] == 429
        errado = "000000" if codigo != "000000" else "111111"
        assert S.json("POST", "/api/contas/verificar", json_corpo={"email": "ana@exemplo.com", "codigo": errado}, **visita)[0] == 403
        status, r, _ = S.json("POST", "/api/contas/verificar", json_corpo={"email": "ana@exemplo.com", "codigo": codigo}, **visita)
        assert status == 200 and len(r["sessao"]) > 30 and r["conta"]["email"] == "ana@exemplo.com" and r["conta"]["idade"] == 20 and r["conta"]["verificada"], r
        sessao = r["sessao"]
        assert S.json("POST", "/api/contas/verificar", json_corpo={"email": "ana@exemplo.com", "codigo": codigo}, **visita)[0] == 410  # o código só vale uma vez
        assert S.json("POST", "/api/contas/cadastro", json_corpo=sem, **visita)[0] == 409
        # o que fica no aparelho: senha, código e sessão só como hash, com permissão 600
        arquivo = Path(os.environ["LNUX_APPS_DADOS"]) / "contas" / "contas.json"
        texto = arquivo.read_text()
        assert (os.stat(arquivo).st_mode & 0o777) == 0o600 and "segredo123" not in texto and sessao not in texto and codigo not in texto
        # entrar
        assert S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "errada123"}, **visita)[0] == 401
        status, r, _ = S.json("POST", "/api/contas/entrar", json_corpo={"email": "ANA@exemplo.com", "senha": "segredo123"}, **visita)
        assert status == 200 and r["conta"]["nome"] == "Ana"
        eu = {"X-Conta-Sessao": sessao}
        assert S.json("GET", "/api/contas/eu", **visita)[0] == 401 and S.json("GET", "/api/contas/eu", cabecalhos=eu, **visita)[1]["email"] == "ana@exemplo.com"
        # perfil: nome, bio, pronomes, local, links, cor, foto e capa
        r = S.json("POST", "/api/contas/perfil", json_corpo={"nome": "Ana Clara", "bio": "Gosto de dançar\n<b>e de jogar</b>", "pronomes": "ela/dela", "local": "Recife",
                                                            "links": ["https://exemplo.com/ana"], "cor": "#ff8800"}, cabecalhos=eu, **visita)[1]
        assert r["nome"] == "Ana Clara" and r["bio"] == "Gosto de dançar\n<b>e de jogar</b>" and r["links"] == ["https://exemplo.com/ana"] and r["cor"] == "#ff8800"
        assert S.json("POST", "/api/contas/perfil", json_corpo={"links": ["javascript:alert(1)"]}, cabecalhos=eu, **visita)[0] == 400
        assert S.json("POST", "/api/contas/perfil", json_corpo={"bio": "x"}, **visita)[0] == 401
        assert S.pedir("PUT", "/api/contas/midia?tipo=foto", corpo=b"<svg/>", cabecalhos=eu, **visita)[0] == 400
        assert S.pedir("PUT", "/api/contas/midia?tipo=foto", corpo=PNG, cabecalhos=eu, **visita)[0] == 200
        assert S.pedir("PUT", "/api/contas/midia?tipo=capa", corpo=PNG, cabecalhos=eu, **visita)[0] == 200
        cid = r["id"]
        publico = S.json("GET", f"/api/contas/perfil/{cid}", **visita)[1]
        assert publico["nome"] == "Ana Clara" and publico["foto"] and publico["capa"] and "email" not in publico and "idade" not in publico
        status, cab, dados = S.pedir("GET", f"/api/contas/midia/{cid}/foto", **visita)
        assert status == 200 and cab["Content-Type"] == "image/png" and dados == PNG
        assert (Path(os.environ["LNUX_APPS_DADOS"]) / "contas" / "midia" / f"{cid}-foto.png").is_file()
        # nas salas: quem entra com a conta aparece com o nome e a conta dela
        _, sala, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Da Ana", "criador": "outro nome"}, cabecalhos=eu, **visita)
        assert sala["criador"] == "Ana Clara"
        _, eu_na_sala, _ = S.json("POST", f"/api/sala/{sala['codigo']}/entrar", json_corpo={"nome": "qualquer"}, cabecalhos={**eu, "X-Sala-Chave": sala["chave"]}, **visita)
        pessoas = S.json("POST", f"/api/sala/{sala['codigo']}/estado", json_corpo={"id": eu_na_sala["id"], "segredo": eu_na_sala["segredo"]}, **visita)[1]["pessoas"]
        assert pessoas[0]["nome"] == "Ana Clara" and pessoas[0]["conta"] == cid
        # o dono pode exigir conta para jogar
        S.json("POST", "/api/contas/ajustes", json_corpo={"exigir_conta": True})
        assert S.json("POST", f"/api/sala/{sala['codigo']}/entrar", json_corpo={"nome": "Sem conta"}, **visita)[0] == 401
        assert S.json("POST", "/api/sala", json_corpo={"nome": "X"}, cabecalhos={"Cf-Connecting-Ip": "192.0.2.9"}, **visita)[0] == 401
        assert S.json("POST", f"/api/sala/{sala['codigo']}/entrar", json_corpo={}, cabecalhos=eu, **visita)[0] == 201
        assert S.json("GET", "/api/publico", **visita)[1]["exigir_conta"] is True
        S.json("POST", "/api/contas/ajustes", json_corpo={"exigir_conta": False})
        S.json("DELETE", f"/api/sala/{sala['codigo']}", cabecalhos={"X-Sala-Chave": sala["chave"]}, **visita)
        # trocar a senha (as outras sessões saem)
        _, outra, _ = S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "segredo123"}, **visita)
        assert S.json("POST", "/api/contas/senha", json_corpo={"atual": "errada123", "nova": "novasenha1"}, cabecalhos=eu, **visita)[0] == 403
        assert S.json("POST", "/api/contas/senha", json_corpo={"atual": "segredo123", "nova": "novasenha1"}, cabecalhos=eu, **visita)[0] == 200
        assert S.json("GET", "/api/contas/eu", cabecalhos={"X-Conta-Sessao": outra["sessao"]}, **visita)[0] == 401 and S.json("GET", "/api/contas/eu", cabecalhos=eu, **visita)[0] == 200
        # esqueci a senha: a mesma resposta com ou sem conta; o código chega; a senha nova vale e as sessões antigas saem
        enviados = len(smtp.mensagens)
        assert S.json("POST", "/api/contas/recuperar", json_corpo={"email": "ninguem@exemplo.com"}, **visita)[1]["ok"] and len(smtp.mensagens) == enviados
        assert S.json("POST", "/api/contas/recuperar", json_corpo={"email": "ana@exemplo.com"}, **visita)[1]["ok"] and len(smtp.mensagens) == enviados + 1
        assert S.json("POST", "/api/contas/redefinir", json_corpo={"email": "ana@exemplo.com", "codigo": "123", "senha": "outrasenha2"}, **visita)[0] == 403
        status, r, _ = S.json("POST", "/api/contas/redefinir", json_corpo={"email": "ana@exemplo.com", "codigo": smtp.codigo(), "senha": "outrasenha2"}, **visita)
        assert status == 200 and r["sessao"]
        assert S.json("GET", "/api/contas/eu", cabecalhos=eu, **visita)[0] == 401
        assert S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "outrasenha2"}, **visita)[0] == 200
        eu = {"X-Conta-Sessao": r["sessao"]}
        # tentativas demais de senha: espera
        for _ in range(8):
            S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "chutando1"}, **visita)
        assert S.json("POST", "/api/contas/entrar", json_corpo={"email": "ana@exemplo.com", "senha": "outrasenha2"}, **visita)[0] == 429
        lnux_apps.TENTATIVAS.clear()
        # o dono vê a lista; a pessoa apaga a própria conta (com a senha), e as fotos somem
        lista = S.json("GET", "/api/contas/lista")[1]["contas"]
        assert [c["email"] for c in lista] == ["ana@exemplo.com"] and S.json("GET", "/api/contas/lista", **visita)[0] == 403
        assert S.json("POST", "/api/contas/apagar", json_corpo={"senha": "errada123"}, cabecalhos=eu, **visita)[0] == 403
        assert S.json("POST", "/api/contas/apagar", json_corpo={"senha": "outrasenha2"}, cabecalhos=eu, **visita)[0] == 200
        assert S.json("GET", f"/api/contas/perfil/{cid}", **visita)[0] == 404 and not list((Path(os.environ["LNUX_APPS_DADOS"]) / "contas" / "midia").glob(f"{cid}-*"))
        # um cadastro nunca confirmado some depois de 2 dias
        S.json("POST", "/api/contas/cadastro", json_corpo={**sem, "email": "bia@exemplo.com", "nome": "Bia"}, **visita)
        cadastro = lnux_apps.contas_de(lnux_apps.DADOS)
        next(c for c in cadastro.ler()["contas"].values() if c["email"] == "bia@exemplo.com")["criada"] -= 3 * 86400
        assert not any(c["email"] == "bia@exemplo.com" for c in cadastro.ler()["contas"].values())
    finally:
        smtp.parar()
        lnux_apps.TENTATIVAS.clear()


@caso("Salas: a personagem e o cenário não têm limite de tamanho (só o espaço livre do aparelho)")
def _():
    _, sala, _ = S.json("POST", "/api/sala", json_corpo={"nome": "Grande"})
    c, chave = sala["codigo"], sala["chave"]
    _, ana, _ = S.json("POST", f"/api/sala/{c}/entrar", json_corpo={"nome": "Ana"}, token=False)
    grande = b"glTF" + b"\0" * (45 * 1024 * 1024)  # passa dos 40 MB de antes
    assert S.pedir("PUT", f"/api/sala/{c}/avatar?id={ana['id']}&segredo={ana['segredo']}", corpo=grande, token=False)[0] == 201
    assert len(S.pedir("GET", f"/api/sala/{c}/avatar/{ana['id']}", token=False)[2]) == len(grande)
    antes = lnux_apps.RESERVA_DISCO
    lnux_apps.RESERVA_DISCO = 1 << 62  # um aparelho sem espaço: recusa com 507, sem gravar nada
    try:
        assert S.pedir("PUT", f"/api/sala/{c}/mapa?nome=x", corpo=b"glTF", cabecalhos={"X-Sala-Chave": chave}, token=False)[0] == 507
    finally:
        lnux_apps.RESERVA_DISCO = antes
    assert S.json("DELETE", f"/api/sala/{c}", cabecalhos={"X-Sala-Chave": chave}, token=False)[0] == 200




@caso("Loja: ver e baixar sem a chave; publicar (com o segredo de quem publicou); miniatura; apagar; formatos conferidos")
def _():
    visita = dict(token=False)
    status, loja, _ = S.json("GET", "/api/loja", **visita)
    assert status == 200 and loja["itens"] == [] and loja["publicar"] is True and loja["dono"] is False and "pasta" not in loja
    assert S.json("GET", "/api/loja")[1]["pasta"] == str(S.ponte.loja)  # o dono vê onde fica a pasta
    # publicar: o arquivo no corpo; o resto no endereço
    vrm = b"glTF\x02\x00\x00\x00" + b"x" * 500
    status, r, _ = S.json("PUT", "/api/loja/personagem?nome=Ana%0A%3Cb%3E&descricao=Uma%20personagem&autor=Bia&arquivo=..%2F..%2Fana.vrm", corpo=vrm, **visita)
    assert status == 201 and len(r["segredo"]) >= 20 and r["item"]["nome"] == "Ana <b>" and r["item"]["arquivo"] == "ana.vrm" and r["item"]["tamanho"] == len(vrm), r
    ana, segredo = r["item"], r["segredo"]
    assert (S.ponte.loja / "personagens" / ana["id"] / "ana.vrm").is_file() and segredo not in (S.ponte.loja / "personagens" / ana["id"] / "item.json").read_text()
    assert S.json("PUT", "/api/loja/personagem?arquivo=ana.exe", corpo=vrm, **visita)[0] == 400
    assert S.json("PUT", "/api/loja/personagem?arquivo=ana.vrm", corpo=b"<html>nada</html>", **visita)[0] == 400
    assert S.json("PUT", "/api/loja/animacao?arquivo=ana.vrm", corpo=vrm, **visita)[0] == 400
    assert S.json("PUT", "/api/loja/coisa?arquivo=a.vrm", corpo=vrm, **visita)[0] == 404
    assert len([x for x in (S.ponte.loja / "personagens").iterdir() if x.is_dir()]) == 1  # o que foi recusado não ficou
    assert S.json("PUT", "/api/loja/animacao?nome=Dan%C3%A7a&arquivo=danca.bvh", corpo=b"HIERARCHY\nROOT Hips\n", **visita)[0] == 201
    assert S.json("PUT", "/api/loja/animacao?arquivo=samba.fbx", corpo=b"; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n}", **visita)[0] == 201
    _, mundo, _ = S.json("PUT", "/api/loja/mundo?nome=Pra%C3%A7a&arquivo=praca.glb", corpo=b"glTF" + b"m" * 100)
    # a lista e o arquivo
    _, loja, _ = S.json("GET", "/api/loja", **visita)
    assert sorted(i["tipo"] for i in loja["itens"]) == ["animacao", "animacao", "mundo", "personagem"] and all("segredo" not in json.dumps(i) for i in loja["itens"])
    status, cab, dados = S.pedir("GET", f"/api/loja/{ana['id']}/arquivo", **visita)
    assert status == 200 and dados == vrm and cab["Content-Type"] == "application/octet-stream" and cab["Content-Disposition"].startswith("attachment")
    assert S.pedir("GET", "/api/loja/..%2F..%2Fponte.json/arquivo", **visita)[0] == 404 and S.pedir("GET", "/api/loja/000000000000/arquivo", **visita)[0] == 404
    # miniatura: só quem publicou (pelo segredo) ou o dono
    assert S.pedir("PUT", f"/api/loja/{ana['id']}/miniatura", corpo=PNG, cabecalhos={"X-Loja-Segredo": "errado"}, **visita)[0] == 403
    assert S.pedir("PUT", f"/api/loja/{ana['id']}/miniatura", corpo=b"<svg onload=x>", cabecalhos={"X-Loja-Segredo": segredo}, **visita)[0] == 400
    assert S.pedir("PUT", f"/api/loja/{ana['id']}/miniatura", corpo=PNG, cabecalhos={"X-Loja-Segredo": segredo}, **visita)[0] == 201
    status, cab, dados = S.pedir("GET", f"/api/loja/{ana['id']}/miniatura", **visita)
    assert status == 200 and cab["Content-Type"] == "image/png" and dados == PNG
    assert S.json("GET", f"/api/loja/{ana['id']}", **visita)[1]["miniatura"] > 0
    # apagar: quem publicou (pelo segredo) ou o dono; os outros não
    assert S.json("DELETE", f"/api/loja/{ana['id']}", cabecalhos={"X-Loja-Segredo": "errado"}, **visita)[0] == 403
    assert S.json("DELETE", f"/api/loja/{mundo['item']['id']}", cabecalhos={"X-Loja-Segredo": segredo}, **visita)[0] == 403
    assert S.json("DELETE", f"/api/loja/{ana['id']}", cabecalhos={"X-Loja-Segredo": segredo}, **visita)[0] == 200
    assert S.json("DELETE", f"/api/loja/{mundo['item']['id']}")[0] == 200
    assert not (S.ponte.loja / "personagens" / ana["id"]).exists()
    # arquivos postos à mão na pasta aparecem; a miniatura deles e apagar, só o dono
    (S.ponte.loja / "mundos" / "parque.glb").write_bytes(b"glTF" + b"p" * 50)
    (S.ponte.loja / "mundos" / "leia-me.txt").write_text("não é da loja")
    _, loja, _ = S.json("GET", "/api/loja", **visita)
    solto = next(i for i in loja["itens"] if i["arquivo"] == "parque.glb")
    assert solto["solto"] and solto["nome"] == "parque" and solto["tipo"] == "mundo" and not any(i["arquivo"] == "leia-me.txt" for i in loja["itens"])
    assert S.pedir("GET", f"/api/loja/{solto['id']}/arquivo", **visita)[2] == b"glTF" + b"p" * 50
    assert S.pedir("PUT", f"/api/loja/{solto['id']}/miniatura", corpo=PNG, **visita)[0] == 403
    assert S.pedir("PUT", f"/api/loja/{solto['id']}/miniatura", corpo=PNG)[0] == 201
    assert S.json("GET", f"/api/loja/{solto['id']}", **visita)[1]["miniatura"] > 0
    assert S.json("DELETE", f"/api/loja/{solto['id']}", **visita)[0] == 403
    assert S.json("DELETE", f"/api/loja/{solto['id']}")[0] == 200 and not (S.ponte.loja / "mundos" / "parque.glb").exists()
    assert not list((S.ponte.loja / "mundos" / ".miniaturas").iterdir())
    # o dono fecha a loja para publicações (e só ele)
    assert S.json("POST", "/api/loja/config", json_corpo={"publicar": False}, **visita)[0] == 403
    assert S.json("POST", "/api/loja/config", json_corpo={"publicar": False})[1] == {"publicar": False}
    assert S.json("PUT", "/api/loja/animacao?arquivo=b.bvh", corpo=b"HIERARCHY", **visita)[0] == 403
    assert S.json("PUT", "/api/loja/animacao?arquivo=b.bvh", corpo=b"HIERARCHY")[0] == 201
    assert S.json("GET", "/api/publico", **visita)[1]["loja_publicar"] is False
    assert lnux_apps.carregar_config()["loja_publicar"] is False
    S.json("POST", "/api/loja/config", json_corpo={"publicar": True})
    # sem espaço no aparelho: recusa
    antes = lnux_apps.RESERVA_DISCO
    lnux_apps.RESERVA_DISCO = 1 << 62
    try:
        assert S.json("PUT", "/api/loja/mundo?arquivo=c.glb", corpo=b"glTF", **visita)[0] == 507
    finally:
        lnux_apps.RESERVA_DISCO = antes
    # a loja não abre o resto da ponte, nem é alcançada de outro site
    assert S.json("GET", "/api/pastas?caminho=~", cabecalhos={"X-Loja-Segredo": segredo}, **visita)[0] == 401
    assert S.json("PUT", "/api/loja/animacao?arquivo=d.bvh", corpo=b"HIERARCHY", cabecalhos={"Origin": "http://mal.example"}, **visita)[0] == 403
    assert S.json("GET", "/api/estado")[1]["recursos"]["loja"] is True


@caso("Só a Companhia (--so-app): sem a página inicial nem os outros apps; de fora, nem a chave abre a ponte")
def _():
    T = Servidor(hosts=("abc.trycloudflare.com",), sem_comandos=True, so_app="companhia")
    try:
        visita = dict(token=False)
        fora = {"Host": "abc.trycloudflare.com", "Cf-Connecting-Ip": "203.0.113.9", "Cf-Ray": "8a1b2c3d4e5f-GRU"}
        for caminho in ("/", "/index.html", "/apps/"):
            status, cab, _ = T.pedir("GET", caminho, cabecalhos=fora, **visita)
            assert status == 302 and cab["Location"] == "/apps/companhia/", (caminho, status)
        assert T.pedir("GET", "/apps/companhia/", cabecalhos=fora, **visita)[0] == 200
        assert T.pedir("GET", "/apps/companhia/js/loja.js", cabecalhos=fora, **visita)[0] == 200
        assert T.pedir("GET", "/comum/lnux.js", cabecalhos=fora, **visita)[0] == 200
        for caminho in ("/apps/video/", "/apps/som/index.html", "/README.md", "/servidor/lnux_apps.py", "/tests/testar_servidor.py"):
            assert T.pedir("GET", caminho, cabecalhos=fora, **visita)[0] == 404, caminho
        apps = json.loads(T.pedir("GET", "/apps.json", cabecalhos=fora, **visita)[2])
        assert [a["id"] for a in apps["apps"]] == ["companhia"]
        publico = T.json("GET", "/api/publico", cabecalhos=fora, **visita)[1]
        assert publico["so_app"] == "companhia" and publico["salas"] and publico["loja"]
        # no próprio aparelho, com a chave: a ponte funciona (é o dono, criando a sala)
        assert T.json("GET", "/api/estado")[1]["so_app"] == "companhia"
        assert T.json("GET", "/api/pastas?caminho=~")[0] == 200
        status, sala, _ = T.json("POST", "/api/sala", json_corpo={"nome": "Praça"})
        assert status == 201 and sala["enderecos"] == ["https://abc.trycloudflare.com"]
        # pelo túnel, mesmo com a chave: nada da ponte (nem ler arquivos pelo cookie, nem criar sala)
        for metodo, caminho in (("GET", "/api/estado"), ("GET", "/api/pastas?caminho=~"), ("GET", f"/api/arquivo?caminho={q(CASA)}"), ("POST", "/api/entrar")):
            status = T.pedir(metodo, caminho, cabecalhos=fora)[0]
            assert status == 403, (caminho, status)
        assert T.pedir("GET", f"/api/arquivo?caminho={q(CASA)}", cabecalhos={**fora, "Cookie": f"lnux_ponte={T.ponte.token}"}, **visita)[0] == 403
        assert T.json("GET", "/api/salas", cabecalhos=fora)[1]["dono"] is False  # a chave pelo túnel não faz de ninguém o dono
        status, dela, _ = T.json("POST", "/api/sala", json_corpo={"nome": "Da visita"}, cabecalhos={**fora, "Origin": "https://abc.trycloudflare.com"}, **visita)
        assert status == 201 and dela["enderecos"] == ["https://abc.trycloudflare.com"]  # pelo link isolado, quem chega cria a sala
        # nem fingindo ser do aparelho: um repasse (X-Forwarded-For) ou o endereço público entregam
        assert T.pedir("GET", "/api/pastas?caminho=~", cabecalhos={"X-Forwarded-For": "203.0.113.9"})[0] == 403
        assert T.pedir("GET", "/api/pastas?caminho=~", cabecalhos={"Host": "abc.trycloudflare.com"})[0] == 403
        # o que os visitantes usam funciona pelo túnel: a sala e a loja
        _, ana, _ = T.json("POST", f"/api/sala/{sala['codigo']}/entrar", json_corpo={"nome": "Ana"}, cabecalhos={**fora, "Origin": "https://abc.trycloudflare.com"}, **visita)
        assert ana["id"]
        assert T.json("GET", "/api/loja", cabecalhos=fora, **visita)[0] == 200
        assert T.json("PUT", "/api/loja/animacao?arquivo=v.bvh", corpo=b"HIERARCHY", cabecalhos={**fora, "Origin": "https://abc.trycloudflare.com"}, **visita)[0] == 201
        assert T.json("GET", "/api/loja", cabecalhos=fora)[1]["dono"] is False  # a chave pelo túnel não faz de ninguém o dono
    finally:
        T.parar()
    # o servidor de sempre (sem --so-app) continua igual: a página inicial existe e a chave vale pelo endereço liberado
    U = Servidor(hosts=("abc.trycloudflare.com",))
    try:
        assert U.pedir("GET", "/", token=False)[0] == 200 and U.pedir("GET", "/apps/video/", token=False)[0] == 200
        assert U.json("GET", "/api/estado", cabecalhos={"Host": "abc.trycloudflare.com"})[0] == 200
        assert U.json("GET", "/api/publico", token=False)[1]["so_app"] is None
    finally:
        U.parar()


@caso("ffmpeg: recusa formato desconhecido e entrada fora das pastas liberadas")
def _():
    import shutil
    if not shutil.which("ffmpeg"):
        return "pulado (sem o ffmpeg)"
    assert S.json("POST", "/api/converter", json_corpo={"entrada": "~/nota.txt", "perfil": "exe"})[0] == 400
    assert S.json("POST", "/api/converter", json_corpo={"entrada": "/etc/passwd", "perfil": "mp3"})[0] == 403


@caso("Comandos: desligados por padrão (403); ligados, rodam e devolvem a saída")
def _():
    assert S.json("POST", "/api/executar", json_corpo={"comando": ["echo", "oi"]})[0] == 403
    s2 = Servidor(comandos=True)
    try:
        status, r, _ = s2.json("POST", "/api/executar", json_corpo={"comando": ["echo", "oi"]})
        assert status == 200 and r["codigo"] == 0 and r["saida"].strip() == "oi"
        assert s2.json("POST", "/api/executar", json_corpo={"comando": "echo oi"})[0] == 400
        assert s2.json("POST", "/api/executar", json_corpo={"comando": ["programa-que-nao-existe-123"]})[0] == 404
    finally:
        s2.parar()


@caso("Túnel: --permitir-host aceita só o domínio do túnel (Host e Origin) e --sem-comandos desliga os comandos")
def _():
    T = Servidor(comandos=True, hosts=("abc-def.trycloudflare.com",), sem_comandos=True)
    try:
        # o endereço do túnel passa (a chave continua obrigatória)
        status, r, _ = T.json("GET", "/api/estado", cabecalhos={"Host": "abc-def.trycloudflare.com"})
        assert status == 200 and r["ponte"] is True, (status, r)
        status, _, _ = T.pedir("GET", "/api/estado", cabecalhos={"Host": "abc-def.trycloudflare.com"}, token=False)
        assert status == 401, status
        # outro domínio continua recusado (DNS rebinding)
        status, _, _ = T.pedir("GET", "/api/estado", cabecalhos={"Host": "outro.trycloudflare.com"})
        assert status == 403, status
        # atrás do túnel o Host pode chegar como localhost e o Origin como o endereço público: aceito só se for o liberado
        status, _, _ = T.pedir("POST", "/api/entrar", json_corpo={}, cabecalhos={"Origin": "https://abc-def.trycloudflare.com"})
        assert status == 200, status
        status, _, _ = T.pedir("POST", "/api/entrar", json_corpo={}, cabecalhos={"Origin": "https://malicioso.example"})
        assert status == 403, status
        # comandos: pedidos com --permitir-comandos, mas --sem-comandos vale mais
        status, _, _ = T.pedir("POST", "/api/executar", json_corpo={"comando": ["echo", "oi"]})
        assert status == 403 and T.ponte.comandos is False, status
    finally:
        T.parar()


@caso("Aparelho: sistema e bateria respondem (a bateria pode não existir neste computador)")
def _():
    status, r, _ = S.json("GET", "/api/sistema")
    assert status == 200 and r["nucleos"] >= 1 and r["disco"]["total"] > 0
    status, b, _ = S.json("GET", "/api/bateria")
    assert status == 200 and "disponivel" in b


@caso("Sem ponte: os apps abrem, /api/estado diz que a ponte está desligada e o resto não existe")
def _():
    s3 = Servidor(ligada=False)
    try:
        assert s3.pedir("GET", "/comum/lnux.css", token=False)[0] == 200
        status, r, _ = s3.json("GET", "/api/estado", token=False)
        assert status == 200 and r["ponte"] is False
        assert s3.pedir("GET", "/api/pastas?caminho=~", token=False)[0] == 404
    finally:
        s3.parar()


@caso("Chave: fica em ~/.lnux-apps/ponte.json com permissão 600 e é a mesma ao reiniciar")
def _():
    arquivo = Path(os.environ["LNUX_APPS_DADOS"]) / "ponte.json"
    assert (arquivo.stat().st_mode & 0o777) == 0o600
    assert lnux_apps.carregar_config()["token"] == S.ponte.token


def main() -> int:
    ok = falhou = pulados = 0
    for nome, f in CASOS:
        try:
            r = f()
            if isinstance(r, str) and r.startswith("pulado"):
                pulados += 1
                print(f"  ⏭  {nome}: {r}")
            else:
                ok += 1
                print(f"  ✔ {nome}")
        except Exception as e:  # mostra qual verificação falhou
            import traceback
            falhou += 1
            print(f"  ✖ {nome}\n    {type(e).__name__}: {e}")
            traceback.print_exc(limit=3)
    S.parar()
    print(f"\n{ok} ok · {falhou} falharam · {pulados} pulados")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(main())
