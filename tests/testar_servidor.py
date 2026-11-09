#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes do servidor e da ponte local (servidor/lnux_apps.py), só com a biblioteca padrão.

Sobe o servidor numa porta livre, com uma pasta pessoal TEMPORÁRIA (não mexe nos seus arquivos), e confere:
arquivos dos apps, chave da ponte, proteção contra outros sites e DNS rebinding, pastas liberadas (inclusive
atalhos para fora), leitura com Range, gravação sem sobrescrever, mover/copiar/apagar, envio temporário,
conversão com o ffmpeg (se estiver instalado), comandos desligados/ligados e o modo sem ponte.

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
    def __init__(self, ligada=True, comandos=False):
        self.ponte = lnux_apps.Ponte(ligada, [], comandos)
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
