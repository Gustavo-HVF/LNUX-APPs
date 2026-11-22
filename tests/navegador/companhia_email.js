// Contas nos testes do navegador, sem e-mail de verdade: um servidor SMTP de mentira (guarda o que chega) e criar uma
// conta pela API com o código que chegou nele. O dono (com a chave da ponte) aponta o e-mail do servidor para ele.
//
//   const smtp = await smtpFalso();
//   await configurarEmail(dono, smtp.porta);
//   const id = await criarConta(smtp, pessoa, "Nome", "nome@exemplo.com");  // e a pessoa já entra com ela
//   await apagarConta(pessoa);                                              // no fim (o nome volta a ficar livre)
const net = require("net");
const { execFileSync } = require("child_process");

const SENHA = "segredo123";

/** Um servidor de e-mail de mentira: guarda o que chega. */
function smtpFalso() {
  const caixa = [];
  const srv = net.createServer((s) => {
    let dados = false, buf = "", msg = [];
    s.write("220 falso ESMTP\r\n");
    s.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (dados) { if (l === ".") { dados = false; caixa.push(msg.join("\r\n")); msg = []; s.write("250 ok\r\n"); } else msg.push(l); continue; }
        const u = l.toUpperCase();
        if (u.startsWith("EHLO") || u.startsWith("HELO")) s.write("250-falso\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (u.startsWith("AUTH")) s.write("235 ok\r\n");
        else if (u === "DATA") { dados = true; s.write("354 manda\r\n"); }
        else if (u === "QUIT") { s.write("221 tchau\r\n"); s.end(); }
        else s.write("250 ok\r\n");
      }
    });
    s.on("error", () => {});
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, porta: srv.address().port, caixa })));
}

/** O assunto e o destinatário do e-mail (lidos pelo Python, que entende a codificação dos cabeçalhos). */
function lerEmail(bruto) {
  const saida = execFileSync("python3", ["-c", "import email, email.policy, json, sys\nm = email.message_from_string(sys.stdin.read(), policy=email.policy.default)\n" +
    "print(json.dumps({'assunto': str(m['Subject']), 'para': str(m['To'])}))"], { input: bruto });
  return JSON.parse(saida.toString("utf8"));
}

/** O dono (a página aberta com a chave da ponte) manda os códigos pelo SMTP de mentira. */
function configurarEmail(dono, porta) {
  return dono.ev((p) => C.contas.salvarAjustes({ email: { servidor: "127.0.0.1", porta: p, seguranca: "nenhuma", usuario: "dono@exemplo.com", senha: "x", remetente: "dono@exemplo.com", nome: "WEBC" } }), porta);
}

/** Cria uma conta pela API (com o código que chega no e-mail de mentira) e entra com ela. Devolve o id da conta. */
async function criarConta(smtp, p, nome, email) {
  const antes = smtp.caixa.length;
  await p.ev(([n, e, s]) => C.contas.cadastrar({ nome: n, email: e, senha: s, idade: 22 }), [nome, email, SENHA]);
  for (let i = 0; i < 100 && smtp.caixa.length <= antes; i++) await new Promise((r) => setTimeout(r, 100));
  const m = lerEmail(smtp.caixa[smtp.caixa.length - 1]);
  const codigo = (m.assunto.match(/\b(\d{6})\b/) || [])[1];
  return p.ev(([e, c]) => C.contas.verificar(e, c).then((x) => x.id), [email, codigo]);
}

/** Apaga a conta com que a pessoa entrou (se entrou). */
function apagarConta(p) {
  return p.ev(async (s) => { await C.contas.carregar(); if (C.contas.eu) await C.contas.apagar(s); }, SENHA).catch(() => {});
}

module.exports = { smtpFalso, lerEmail, configurarEmail, criarConta, apagarConta, SENHA };
