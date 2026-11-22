# Prompt: refazer o LNUX para a web e colocá-lo dentro do jogo WEBC

> Copie tudo abaixo da linha e cole na outra IA. Ela precisa de acesso aos dois repositórios
> (`Gustavo-HVF/Termux-Toons` e `Gustavo-HVF/LNUX-APPs`).

---

## Quem você é e o que vai fazer

Você é um engenheiro sênior de front-end e de jogos web (WebGL/three.js). Sua tarefa é **refazer o LNUX para a
web** — hoje ele é um programa de terminal em Python — e **colocar essa versão dentro do WEBC**, o jogo
multijogador em 3D que já existe no repositório LNUX-APPs. Antes de escrever código, leia os arquivos indicados
abaixo e respeite o estilo que já está lá. Escreva o código, os comentários, os textos da tela e os commits em
**português do Brasil**, no mesmo tom simples dos READMEs (frases curtas, sem jargão quando dá).

## 1. O que existe hoje

### 1.1 O LNUX (repositório `Termux-Toons`)

- Um programa Python só, `lnux.py` (~37.600 linhas, só biblioteca padrão; Python 3.9+), com menu em tela cheia no
  terminal (curses): setas, Enter, Esc, toque/arrasto no Termux:Float, e uma **busca** de opções.
- Roda no **Android (Termux)** e em distros Linux. Tudo o que muda entre sistemas está em perfis JSON em
  `distros/` (gerenciador de pacotes, nomes de pacotes, pastas, `sudo`/`doas`, serviços, **recursos**). O menu
  **esconde o que o sistema não tem** (por exemplo, sensores, SMS e infravermelho só no Termux).
- Configuração em `~/.lnux/config.json`. Cada função **pergunta antes** de instalar o que precisa.
- O menu principal tem 19 seções:
  1. Servidor web / API pessoal · 2. Bots Telegram/Discord 24h · 3. Scraping e monitoramento ·
  4. Rede e segurança · 5. Linux com proot-distro / distros em contêineres · 6. Arquivos e backup ·
  7. Música, rádio e podcasts · 8. Vídeos (TikTok, YouTube) · 9. Compartilhar filme por link · 10. Utilitários ·
  11. Mensagens secretas · 12. Celular e sistema · 13. Internet e comunicação · 14. Apps Web ·
  15. Meus dados na internet · 16. Inteligência artificial · 17. Diversão e aprendizado ·
  18. Programação e servidores · 19. Sistema e manutenção.
- Leia: `README.md` (seções "O que tem no menu", "Navegação", "Linha de comando", "Apps Web"), `distros/README.md`,
  `menu_principal()` perto do fim de `lnux.py` e os testes em `tests/` (`verificar_menus.py`,
  `testar_menus_por_sistema.py`).

### 1.2 O LNUX-APPs e a ponte local (repositório `LNUX-APPs`)

- Apps web feitos **só com HTML, CSS e JavaScript**, **sem etapa de build** (sem npm/bundler no app final, sem
  TypeScript, sem React). Cada app é uma pasta em `apps/<id>/` com `index.html` carregando scripts em ordem.
- `comum/lnux.js` é a biblioteca comum (objeto global `LNUX`): `LNUX.el(...)` para criar elementos, temas,
  barra de menus, **paleta de comandos** (Ctrl+Shift+P), diálogos, desfazer/refazer, IndexedDB e o **cliente da
  ponte**. `comum/zip.js` e `comum/gif.js` também são comuns.
- `apps.json` é o catálogo (id, nome, ícone, categoria, caminho, `estado`, `ponte: nao|opcional|necessaria`).
- `servidor/lnux_apps.py` (~3.500 linhas, só biblioteca padrão) serve os apps e a **ponte** em `/api/`: pastas e
  arquivos (com Range), ffmpeg com perfis prontos, bateria/notificação/área de transferência/TTS (Termux:API ou
  equivalentes do Linux), comandos (**desligados por padrão**), chaves de IA guardadas no aparelho, salas, contas,
  loja e Sketchfab.
- **Segurança da ponte (não pode piorar):** escuta em `127.0.0.1`; cada pedido precisa da chave de
  `~/.lnux-apps/ponte.json` (600); recusa nomes de domínio no `Host` (contra DNS rebinding), a não ser os liberados
  com `--permitir-host`; recusa pedidos que mudam algo vindos de outra origem; só mexe nas pastas liberadas; o
  ffmpeg só com perfis prontos, nunca argumentos soltos. Com `--so-app companhia`, **quem vem de fora só alcança as
  salas, a loja e as contas**.

### 1.3 O WEBC (`apps/companhia/`, id do app `companhia`)

Leia `apps/companhia/README.md` inteiro antes de começar. Fatos técnicos:

- **Gráficos:** não é OpenGL nativo — é **WebGL 2 pelo three.js r180**, empacotado junto com o
  **@pixiv/three-vrm** (core, MToon, spring bone, node constraint, v0compat) e o **three-vrm-animation** em
  `vendor/three-vrm-pacote.min.js`, exposto como `window.THREE`. Também no pacote: **three-mesh-bvh** (colisão e
  raios), carregadores glTF/FBX/OBJ, **Draco** (`vendor/draco/`). Não troque por WebGPU nem por outra engine.
- **Personagens:** **VRoid / VRM** (`.vrm` 0.x e 1.0, em 3D, com troca de roupa, peças e cores) e **Live2D**
  (Cubism 3/4, modelos do VTube Studio) por **pixi.js 6.5.10 + pixi-live2d-display 0.4.0**. Avatares do Unity/VRChat
  (`.unitypackage`, `.fbx`) viram `.vrm` ao importar. Animações `.vrma`, `.fbx`, `.bvh`.
- **Captura de movimento:** MediaPipe (`vendor/mediapipe-visao.min.js`), rosto, olhos, tronco, braços, mãos, dedos,
  pernas; IK própria em `js/ik.js`.
- **Mundo:** `js/mundo.js` — mapa `.glb/.gltf/.fbx/.obj`, personagem como **cápsula** com colisão por BVH, W A S D,
  Shift corre, Espaço pula, V voa (só quem criou a sala), câmera em terceira pessoa (arrastar gira, rodinha
  aproxima), direcional na tela no celular. `js/luzes.js` — luzes do mapa em tempo real (só as mais perto), sombras e
  **luz calculada por raios** guardada nos vértices. Conversor de mapas (`.blend` pelo Blender do aparelho).
- **Multijogador:** `js/sala.js` + `/api/sala` no servidor. **Não é WebSocket**: cada cliente faz uma troca HTTP a
  cada **~120 ms** mandando o próprio estado compacto (`p` posição, `r` rumo, `e` andar/correr/pular, `emo`,
  `g` gesto, `c` câmera e, com captura ligada, `pose`/`rosto`) e recebendo o de todos e as mensagens novas. Limites:
  12 salas (3 por pessoa), 16 pessoas por sala, sala vazia fecha em 15 min. O vídeo numa tela sincroniza só link,
  lugar e relógio.
- **Site:** `js/webc.js` (cabeçalho, início com Loja/Sala/Perfil, Chat bot, Novidades, Widgets, transições, tela de
  carregamento), `js/loja.js`, `js/salas.js`, `js/contas.js`, `js/widgets.js`, `js/jogo.js` (a tela dentro do jogo:
  barra com logo e ☰, expressões 1–9, bate-papo, vídeo, janela **Opções** com Personagem, Sala, Ajuda,
  Acessibilidade, Gráfico e Controle).
- **Padrões de código:** cada arquivo é um IIFE com `"use strict"` e pendura o que exporta em
  `window.C` (`const C = (window.C = window.C || {})`); construtores no formato `C.Jogo(ctx)`; textos sempre por
  `C.t("texto", vars)` com tradução em **português, inglês e japonês** (`js/textos.js`, `js/idiomas.js`); temas do
  VLC-Web (`temas/vlc-web-temas.css`, `data-skin`); **ícones em SVG próprios, sem emoji** na interface do WEBC;
  respeita `prefers-reduced-motion` e Opções › Acessibilidade.
- **Regra de privacidade do site:** **nada no site do WEBC fala do LNUX nem do aparelho que serve as salas** (há
  teste para isso). Leve isso em conta no nome e nos textos da integração (veja 2.3).
- **Testes:** Playwright no Chromium em `tests/navegador/` (rodar com
  `python3 tests/testar_navegador.py <nome>`), mais `tests/testar_servidor.py`. Veja
  `tests/navegador/testar_companhia_webc.js` como modelo (vários navegadores = várias pessoas, SMTP de mentira).

## 2. O que construir

### 2.1 O LNUX Web (um app novo em `apps/lnux/`)

Uma versão web do LNUX que **reproduz a experiência do menu** e as funções que fazem sentido no navegador:

- **Interface:** um "terminal bonito" — tela escura com fonte monoespaçada, o logo em ASCII do LNUX, a lista de
  seções com os mesmos emojis/nomes e a mesma navegação (↑ ↓, Enter/→, Esc/←/q, Espaço para marcar, Home/End/PgUp/PgDn,
  confirmações Sim/Não com ← →), mais **toque e clique** (celular primeiro) e a **busca** de opções. Use
  `comum/lnux.js` (temas, paleta de comandos, diálogos).
- **Os menus vêm de dados, não de código espalhado:** crie um catálogo JSON (`apps/lnux/menus.json`) com cada seção,
  opção, descrição, **recursos exigidos** (os mesmos nomes dos perfis em `distros/*.json`) e **onde roda**:
  `navegador` (só JS), `ponte` (precisa de `servidor/lnux_apps.py`) ou `terminal` (só no LNUX de verdade).
  Escreva um script em `tools/` que **gere esse catálogo a partir do `lnux.py`** (ou o mantenha conferido por teste),
  para os dois não divergirem.
- **Esconda o que não funciona**, como o LNUX faz: sem ponte, as opções `ponte` aparecem desativadas com "precisa
  abrir pelo LNUX"; as `terminal` mostram o comando equivalente (`lnux <comando>`) para copiar.
- **Primeiro, só no navegador** (sem ponte): utilitários (calculadora, conversores, gerador de senha, QR code,
  cronômetro), Mensagens secretas (mesma cifra do `lnux.py`, com teste de compatibilidade cruzada:
  o que um cifra o outro decifra), player de rádio/podcast, Diversão e aprendizado (jogos de texto), e o atalho para
  os outros apps web (Vídeo, Som, Efeitos, VLC-Web, WEBC).
- **Depois, com a ponte:** arquivos e backup (pela API de pastas que já existe), bateria/notificação/TTS/área de
  transferência, ffmpeg (perfis prontos), estado dos serviços tmux, IA (pelas chaves já guardadas). Para cada
  função nova que precise de endpoint, **acrescente um endpoint específico e estreito** em `servidor/lnux_apps.py`
  — nunca um "rodar comando qualquer". Comandos livres só com `--permitir-comandos`, como hoje.
- **Fora do escopo** (deixe como `terminal`): rede e segurança ofensiva/varredura, root/`su`, proot-distro,
  infravermelho, SMS, modem, e tudo que exige o app Termux.
- Registre o app em `apps.json` (`"ponte": "opcional"`), com ícone e categoria.

### 2.2 Dentro do jogo WEBC

Leve o LNUX Web para dentro das salas como um **objeto do mundo**, não como uma página solta:

1. **Um computador/terminal 3D no mapa.** Um modelo leve (feito em código com `THREE.BoxGeometry` etc. ou um `.glb`
   pequeno e próprio em `apps/companhia/img/` ou `vendor/`), com a tela emissiva (entra no sistema de luzes de
   `js/luzes.js` como superfície que brilha). Quem criou a sala põe e tira o terminal pelo menu Sala (como o
   "vídeo numa tela"), e a posição é **igual para todos** (sincronize como o vídeo: só tipo, lugar e rumo, pela troca
   de 120 ms ou por um endpoint próprio em `/api/sala/<código>/...`).
2. **Interagir:** chegar perto mostra "E para usar" (no celular, um botão); a personagem vira para a tela e toca um
   gesto de digitar (um `.vrma` próprio ou animação procedural nos braços com `js/ik.js`); a tela do terminal abre
   como **janela por cima do jogo** (no estilo da janela Opções de `js/jogo.js`), e Esc fecha. Enquanto ela está
   aberta, W A S D e os números 1–9 **não** mexem a personagem.
3. **A tela no mundo mostra o que se faz:** desenhe o terminal num `<canvas>` 2D e use como `THREE.CanvasTexture` na
   tela do monitor (atualize no máximo ~10 vezes por segundo, só quando muda e só se estiver perto da câmera), para
   os outros verem "alguém usando o computador". Mande para os outros só um resumo (a seção aberta), nunca dados
   pessoais.
4. **Segurança dentro da sala (obrigatório):** visitantes (quem entra só com o código da sala, ou de fora por túnel)
   **nunca** chegam à ponte. No terminal do jogo, eles só têm as funções `navegador`. As funções `ponte` aparecem
   **só para o dono do servidor** (quem tem a chave) e só no navegador dele. Nenhuma ação de um visitante pode
   disparar algo no aparelho do dono.
5. **Minijogos no terminal (opcional, bom para a sala):** os jogos de "Diversão e aprendizado" que dão para jogar
   junto (quiz, forca, jogo da velha) com o placar visível para quem está perto, sincronizado pela sala.

### 2.3 Nome e textos dentro do WEBC

Por causa da regra "o site não fala do LNUX nem do aparelho", **dentro do WEBC** chame o objeto por um nome neutro
(sugestão: "Terminal" / "Terminal" / "ターミナル"), sem citar o LNUX, o Termux nem o servidor. O app separado em
`apps/lnux/` pode usar o nome LNUX normalmente. Todo texto novo do WEBC vai para as três línguas via `C.t`.

## 3. Regras técnicas

- Só HTML/CSS/JS do navegador, sem build, sem CDN em tempo de execução: biblioteca nova vai para `vendor/` com a
  licença em `vendor/LICENCAS.md` (só MIT/BSD/Apache e parecidas). Prefira escrever do zero a acrescentar
  dependência.
- Reaproveite: `window.THREE` do pacote que já existe (não carregue outro three.js), `LNUX.el`, a janela de
  diálogos, os temas, `C.t`, o cliente `pedir()` de `js/sala.js`.
- Desempenho no celular é prioridade: nada de laço novo de `requestAnimationFrame` (use o quadro de `js/sala.js` /
  `js/mundo.js`), texturas pequenas, nenhum material ou geometria criado a cada quadro, libere com `dispose()`.
- Acessibilidade: tudo usável só pelo teclado e só pelo toque, `aria-*` nos controles, foco preso na janela aberta,
  `prefers-reduced-motion` respeitado, contraste nos temas de alto contraste.
- O `lnux.py` continua funcionando igual: se mexer nele, é só para o menu **🧩 Apps Web** abrir o novo app e
  para o gerador do catálogo.
- Mudanças no `servidor/lnux_apps.py` mantêm todas as proteções da seção 1.2 e ganham teste em
  `tests/testar_servidor.py`.

## 4. Como entregar

Trabalhe em etapas pequenas, cada uma com commit próprio e testes passando:

1. Ler e resumir o que encontrou (menus do `lnux.py`, recursos dos perfis, pontos de integração no WEBC) e
   propor o formato de `menus.json` antes de codar.
2. `apps/lnux/` com a navegação, a busca e as funções `navegador`; registrar em `apps.json`.
3. Funções com a ponte + endpoints novos + testes do servidor.
4. O terminal 3D no WEBC: objeto, aproximar/usar, janela, `CanvasTexture`, sincronização na sala, restrições
   para visitantes.
5. Minijogos compartilhados (se der tempo).
6. Atualizar os READMEs (`README.md` do LNUX-APPs, `apps/companhia/README.md` e o do Termux-Toons) no mesmo estilo.

**Testes que precisam existir (Playwright, em `tests/navegador/`):**

- `testar_lnux.js`: navegar só pelo teclado e só pelo toque, busca, opções escondidas sem ponte, Mensagens secretas
  compatíveis com o `lnux.py` (gere o texto cifrado pelo Python no teste).
- `testar_companhia_terminal.js`: dono e visitante em navegadores separados; o dono põe o terminal; os dois o veem
  no mesmo lugar; o visitante abre e **não** vê nem consegue chamar nada da ponte (confira também direto na API);
  W A S D não move a personagem com a janela aberta; os textos aparecem em pt/en/ja; e o teste existente de que o
  site não fala do LNUX continua passando.
- Rode também os testes que já existem do WEBC (`testar_companhia_*.js`) para não quebrar nada.

**No fim, me diga:** o que ficou pronto, o que ficou de fora e por quê, quais testes rodaram (com o resultado) e
qualquer risco de segurança que você notou.
