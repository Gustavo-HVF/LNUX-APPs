# Companhia

Converse com personagens **Live2D** (o mesmo tipo de modelo que o **VTube Studio** usa) ou **VRoid** (`.vrm`, em 3D). Ela responde
num chat (com uma IA na nuvem, uma IA local ou o motor local, sem IA), **fala** com a voz que você escolher,
**reage com o rosto e o corpo** ao que diz, **sente os toques** (cafuné, cutucar, puxar a orelha, cócegas) e
**lembra** de você, porque as conversas ficam guardadas no próprio aparelho.

Só HTML, CSS e JavaScript, como os outros apps do LNUX-APPs. Com a **ponte local** (abrindo pelo LNUX), as
chaves das IAs ficam guardadas no aparelho, as IAs e vozes locais funcionam sem configurar nada no navegador e
a memória pode ter uma cópia numa pasta do aparelho.

## Primeiros passos

1. **Importe uma personagem**: *Personagem › Importar ZIP* (ou *Importar pasta*, ou arraste o ZIP para a tela).
   Vale qualquer modelo Live2D **Cubism 3 ou 4** (`.model3.json` + `.moc3` + texturas). Dos modelos do VTube
   Studio, a Companhia aproveita também o `.vtube.json`: os **atalhos de expressão** (viram botões embaixo da
   personagem), o **movimento parado**, o **ícone** e a ligação dos parâmetros extras (sorriso nos olhos, boca
   de lado, bochecha inflada...). Para **trocar de personagem**, *Personagem › Trocar* (cada uma tem a própria
   conversa e memória).
2. **Converse.** Sem configurar nada, o **motor local** responde o básico (cumprimentos, "que horas são",
   "qual meu nome"...) sem gastar nada. Para uma conversa de verdade, ligue uma IA em *IA › Provedores*.
3. **Voz**: *Voz › Configurar*. O 🎤 ao lado da caixa de texto escuta você; **Mãos livres** abre o microfone
   sozinho depois que ela fala, então dá para conversar só por voz.

## Personagens VRoid (.vrm) e troca de roupa

Personagens feitas no **VRoid Studio** (ou qualquer modelo **VRM 0.x / 1.0**) abrem num palco 3D, com o
[three.js](https://threejs.org) e o [three-vrm](https://github.com/pixiv/three-vrm), a biblioteca oficial da pixiv.
Basta *Personagem › Importar ZIP ou .vrm* (ou arrastar o arquivo). No VRoid Studio, use **Exportar como VRM**.
O núcleo do Live2D não é preciso para elas.

- **Tudo que as Live2D fazem:** conversa, voz, memória, as 15 emoções (nas expressões do VRM: happy, sad, angry,
  relaxed, surprised...), boca acompanhando a voz, piscar, olhar, gestos no esqueleto (concordar, negar, acenar,
  pular...) e toques. Aqui as áreas de toque seguem o corpo sozinhas (cabeça, orelhas, rosto, ombros, mãos, barriga
  e pés).
- **Troca de roupa** (o botão 👗 no palco, ou *Personagem › Roupas*):
  - **Várias roupas:** cada roupa é um `.vrm` da mesma personagem. No VRoid Studio, vista outra roupa e exporte de
    novo; depois use *Adicionar roupa (.vrm)*. Um ZIP com vários `.vrm` vira uma personagem com várias roupas.
    Pela conversa também dá: "troca de roupa" (sem gastar tokens).
  - **Peças:** as peças de roupa do modelo (Tops, Bottoms, Onepiece, Shoes, acessórios...) podem ser escondidas.
    O VRoid apaga a pele que a roupa cobre, então pode aparecer um buraco.
  - **Cores e estampas:** a textura de uma peça pode ser trocada por outra imagem no mesmo molde, como as versões
    de cor que vêm nos pacotes de roupa do VRoid (ex.: `Black.female/Dress.Black.png` e
    `White.female/Dress.White.png`). Guarde essas texturas em *Roupas › Guardar texturas para trocar* e escolha em
    cada peça. Se o modelo foi exportado com as texturas juntas num atlas, a imagem não encaixa.
  - Tudo fica guardado: ao abrir de novo, a roupa, as peças e as texturas continuam como estavam. *Exportar
    personagem* gera um ZIP com as roupas e as texturas, que dá para importar em outro aparelho.
- **Item de roupa do VRoid Studio (`.vroidcustomitem`):** não é uma personagem. Ele guarda ajustes das roupas que
  só existem dentro do VRoid Studio, então **só abre lá**. Aplique o item na personagem no VRoid Studio e exporte
  como VRM. Se você importar o pacote do item com uma personagem VRoid aberta, a Companhia explica isso e oferece
  guardar as texturas PNG do pacote como variações de cor.
- **Licença:** o `.vrm` traz a licença do autor. Se ela não deixa redistribuir, a Companhia avisa ao importar e ao
  exportar.
- O pacote do three.js com o three-vrm (`vendor/three-vrm-pacote.min.js`, ~0,9 MB) só carrega quando uma
  personagem VRoid abre. Para montar de novo: `sh tools/montar_vrm.sh`.

Nos modelos **Live2D**, as roupas e os acessórios que o autor separou ficam nas expressões (como os atalhos do
VTube Studio). Quando o nome parece roupa (clothe, outfit, hat...), elas também aparecem no botão 👗.

## IA: provedores e economia de tokens

| Provedor | Como |
|---|---|
| **ChatGPT (OpenAI)**, **Claude (Anthropic)**, **Gemini (Google)** | chave da API de cada um |
| **OpenRouter**, **Groq**, **DeepSeek**, **Mistral**, **xAI (Grok)**, **Together**, **Fireworks**, **Cerebras** | chave da API |
| **IA local**: **Ollama**, **LM Studio**, **llama.cpp** (`llama-server`) | roda no aparelho/computador; nada sai para a internet |
| **claude-code-router** | o roteador ([musistudio/claude-code-router](https://github.com/musistudio/claude-code-router)) ligado no aparelho (`ccr start`, porta 3456) vira um provedor: ele escolhe o modelo pelas regras dele |
| **Outro** | qualquer servidor compatível com a API da OpenAI (ou com a da Anthropic / Gemini) |

*Listar modelos* mostra os modelos do provedor, para não precisar decorar nomes. *Testar* faz um pedido curto.

**Para gastar menos** (a ideia vem do claude-code-router): em *IA › Rotas*, cada tipo de tarefa vai para um
modelo:

- **Padrão**: a conversa do dia a dia.
- **Leve**: reações aos toques, saudações e a análise da memória. Use um modelo barato ou local.
- **Pensar**: perguntas difíceis (explicar, calcular, comparar, código). Pode ser um modelo mais forte.
- **Contexto longo**: quando o contexto passa do limite que você definir.

E mais: o **motor local** responde o simples sem chamar a IA (0 tokens), e o contexto vai enxuto. Ele leva o
perfil, o resumo da memória, só os fatos e trechos antigos que têm a ver com a mensagem (busca BM25) e as
últimas trocas (8, por padrão). As reações a toque pela IA têm um intervalo mínimo; no meio, ela usa falas
prontas. No Claude, o perfil vai com *prompt caching*. No rodapé da conversa aparece quantos pedidos foram à IA
e quantos o motor local respondeu.

**Chaves.** Com a ponte, a chave fica em `~/.lnux-apps/ia.json` (permissão 600) e é a ponte que faz o pedido:
a chave nunca passa pelo navegador. Ela só é enviada para o mesmo endereço em que foi cadastrada. A ponte só
repassa para os provedores conhecidos, para programas do próprio aparelho (`127.0.0.1`) e para os endereços da
rede que você liberar. Sem a ponte, a chave fica guardada no navegador e o pedido vai direto ao provedor (a
tela avisa).

## Emoções, gestos e expressões

A IA escreve marcas no começo das frases, por exemplo `[feliz][acenar] Oi!`, e pode mudar no meio:
`[surpresa] Sério? [rindo] Que engraçado!`. As marcas não aparecem no chat nem são faladas, e o rosto muda na
hora em que chegam.

- **15 emoções**: neutra, feliz, rindo, tímida, triste, chorando, brava, surpresa, assustada, pensativa,
  apaixonada, animada, sonolenta, provocadora, confusa. Cada uma mexe nos parâmetros padrão do Live2D (boca,
  olhos, sobrancelhas, ângulo da cabeça e do corpo, bochecha corada) dentro dos limites do próprio modelo, então
  funciona em qualquer modelo. Algumas têm movimento próprio (rir, soluçar, tremer, cochilar).
- **12 gestos do corpo**: concordar, negar, inclinar, pular, tremer, suspirar, piscar, olhar em volta,
  encolher, aproximar, acenar, desviar o olhar.
- **Expressões do modelo** (`.exp3.json`): em *Personagem › Emoções*, cada emoção liga as expressões que você
  marcar (lágrimas, corações, estrelinhas...); a Companhia já sugere pelo nome. Os botões embaixo da
  personagem ligam e desligam à mão, várias ao mesmo tempo, como os atalhos do VTube Studio.
- Se a IA esquecer as marcas, a emoção é adivinhada pelo texto. Ações escritas como `*sorri*` também viram
  emoção ou gesto.
- Sempre: piscar, respirar, olhar para o seu dedo ou mouse, e a **boca acompanhando a voz**.

## Toques

Toque, toque duas vezes, segure, faça carinho (vai e volta) ou puxe:

| Área | Por exemplo |
|---|---|
| Cabeça | cafuné, bagunçar o cabelo |
| Chapéu / topo | mexer, tentar tirar |
| Orelhas | carinho, puxar (provocação) |
| Rosto e bochechas | cutucar, apertar, carinho |
| Ombros e braços | chamar a atenção, massagem |
| Mãos | "toca aqui", segurar a mão |
| Barriga e pés | cócegas |

Carinho aumenta o **afeto** (o coração no alto da tela), e provocação diminui. Provocar várias vezes seguidas
deixa ela brava; muito carinho, apaixonada. O afeto muda o jeito dela tratar você. As áreas se ajustam em
*Personagem › Áreas de toque* (arraste os retângulos) e aparecem em *Exibir › Mostrar áreas de toque*.

## Voz

| Gerador | |
|---|---|
| **Voz do navegador** | grátis; a boca mexe no ritmo das palavras |
| **ElevenLabs** | `eleven_flash_v2_5` (rápido e pela metade do preço), `eleven_multilingual_v2`, `eleven_v3` (entende emoções como `[laughs]`) |
| **OpenAI TTS** | `gpt-4o-mini-tts` muda o tom conforme a emoção; usa a mesma chave da IA |
| **VoiceStudio** | o [VoiceStudio](https://github.com/debpalash/VoiceStudio), de debpalash, rodando no aparelho (`http://127.0.0.1:3900`): vozes clonadas e desenhadas, sem internet. A Companhia usa a API dele, compatível com a da OpenAI |
| **Outro compatível com OpenAI** | Kokoro-FastAPI, openedai-speech... |
| **Voz do aparelho (ponte)** | `termux-tts-speak` ou `espeak` |

A resposta é falada **frase por frase**: a próxima frase é gerada enquanto a atual toca. A emoção muda o jeito
de falar. As frases curtas ficam guardadas, para não gastar créditos de novo. Cada personagem pode ter a própria voz
(*Personagem › Voz desta personagem*). Se o gerador falhar, a voz do navegador fala no lugar.

**Ouvir** usa o reconhecimento de fala do navegador (Chrome, Edge, Safari). No Chrome ele usa a internet.

## Memória

- Todas as conversas e toques ficam no **IndexedDB deste aparelho**, separados por personagem.
- **Ao abrir o app**, as mensagens que ainda não foram analisadas são relidas:
  - A **análise local** (sempre, 0 tokens) acha seu nome, idade, onde mora, trabalho, estudo, gostos, o que não
    gosta, favoritos, aniversário, bichos, pessoas da família e planos ("amanhã tenho prova").
  - Com uma IA, a **rota leve** atualiza também o **resumo** e o **afeto**, em blocos e só quando há conversa nova
    suficiente.
- Ela **cumprimenta** lembrando de você e pergunta dos planos ("e aí, como foi a prova?") quando você volta
  depois de um tempo.
- *Conversa › O que ela lembra*: ver e corrigir os fatos, o resumo e o afeto, ensinar algo, reanalisar, apagar.
  Também dá para **exportar e importar** (JSON) e, com a ponte, **copiar para uma pasta do aparelho**
  (`~/LNUX/Companhia/`), inclusive sozinho ao sair. *Conversa › Histórico* procura em tudo.
- *Conversa › Nova conversa* começa um assunto novo: o contexto recente recomeça, e a memória continua.

## Layouts e exibir

**Personagem e conversa** (lado a lado), **Foco na personagem** (a conversa flutua por cima) e **Celular**
(personagem em cima, conversa embaixo; entra sozinho em tela pequena). Também dá para:

- enquadrar em **Rosto**, **Busto** ou **Corpo**, com zoom pela rodinha do mouse e *Posição e tamanho*;
- trocar o fundo (inclusive tela verde, para gravar a tela, ou uma imagem sua);
- salvar uma foto PNG da personagem.

## Texturas grandes (personagem preta ou lenta)

Muitos modelos vêm com texturas enormes. O do VTube Studio usado nos testes, por exemplo, tem uma de
**4096 × 8192 px**, que ocupa 128 MB na placa de vídeo. Vários celulares só aceitam texturas de até 4096 px, ou não
têm memória de vídeo para isso. Aí a textura não sobe e a personagem aparece **toda preta**. Para evitar isso:

- **Ao abrir**, as texturas maiores que o limite viram uma cópia menor: até **2048 px no celular** e até
  **4096 px no computador**, nunca acima do que a placa de vídeo aceita. As coordenadas de textura do Live2D vão
  de 0 a 1, então a cópia serve no lugar da original, e na tela quase não muda. A cópia fica guardada no
  navegador, para não refazer a cada vez.
- **Depois do primeiro desenho**, a Companhia confere se as texturas chegaram à placa de vídeo. Se vierem pretas,
  ela tenta de novo com metade do tamanho, avisa e guarda o tamanho que funcionou.
- Se a placa de vídeo reiniciar por falta de memória, a personagem é recarregada com texturas menores.
- Trocar de personagem libera as texturas da anterior na memória de vídeo.
- *Exibir › Qualidade das texturas* (ou *Ajuda › Diagnóstico*) mostra a placa de vídeo, o maior tamanho que ela
  aceita, a memória do aparelho e o tamanho original e o usado de cada textura. Ali dá para escolher **Automática**,
  **Original**, **Alta (4096)**, **Média (2048)** ou **Leve (1024)** para cada personagem.

## O núcleo do Live2D (importante)

Os modelos Live2D precisam do **Live2D Cubism Core**, que é da Live2D Inc. e tem licença própria. Por isso ele
**não vem junto** com o LNUX-APPs. A Companhia carrega o núcleo na primeira fonte que der certo:

1. A cópia guardada pela ponte (`~/.lnux-apps/live2d/`). A ponte baixa do site oficial uma vez e depois funciona
   sem internet.
2. O arquivo que você escolheu, guardado no navegador.
3. `apps/companhia/vendor/live2dcubismcore.min.js`, se você puser lá (está no `.gitignore`).
4. O site oficial da Live2D (precisa de internet).

Sem internet e sem a ponte, baixe o [Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) e escolha
o `live2dcubismcore.min.js` no aviso da tela. Usar o núcleo significa aceitar a licença da Live2D.

## Os modelos são dos autores deles

Os modelos que você importa ficam **só no seu aparelho**, e nada é enviado. Muitos modelos (como os vendidos no
BOOTH) proíbem redistribuir. Quando o `.vtube.json` diz "não compartilhar", a Companhia avisa ao importar e ao
exportar. O ZIP exportado (com um `companhia.json` com perfil, emoções, áreas e voz) é para levar a personagem
para outro aparelho seu.

## Arquivos

```
index.html, companhia.css
js/vrm.js          palco 3D para personagens VRoid (.vrm): expressões, gestos nos ossos, toques, peças e texturas
js/live2d.js       palco: núcleo, carregar o modelo (texturas no tamanho que a placa aguenta), sinais → parâmetros,
                   emoções, gestos, piscar, olhar, boca, toques
js/personagens.js  importar (ZIP, pasta, ponte), ler o vtube.json, guardar, trocar, exportar
js/ia.js           provedores, chaves, transporte (ponte/direto), streaming, roteador, marcas [emoção], motor local
js/voz.js          geradores de voz, fila frase a frase, boca pelo som, cache, reconhecimento de fala
js/memoria.js      IndexedDB, análise local e pela IA, BM25, visitas, exportar/importar, cópia no aparelho
js/reacoes.js      reações aos toques (área × gesto)
js/app.js          a tela: conversa, menus, janelas de ajustes
vendor/            pixi.js 6 e pixi-live2d-display (MIT); three.js + three-vrm (MIT, three-vrm-pacote.min.js)
                   — o Cubism Core não vem junto
```

Teste no Chromium (precisa de um modelo e do núcleo, que não estão no repositório):

```bash
LNUX_TESTE_MODELO=/caminho/modelo.zip LNUX_TESTE_NUCLEO=/caminho/live2dcubismcore.min.js python3 tests/testar_navegador.py companhia
```

As personagens VRoid têm um teste próprio, que baixa o modelo de exemplo da pixiv (ou usa `LNUX_TESTE_VRM`):

```bash
python3 tests/testar_navegador.py companhia_vrm
```

## O que ainda não faz

- **Modelos Cubism 2** (`.moc` / `model.json`) não abrem; só Cubism 3 e 4.
- **Itens de roupa do VRoid Studio** (`.vroidcustomitem`) só abrem no VRoid Studio. Aqui entram a personagem
  exportada (`.vrm`) e as texturas do pacote.
- **Animações `.vrma`** e as físicas de roupa além das do próprio VRM (spring bones) ainda não estão incluídas.
- **IA rodando dentro do navegador** (WebLLM/WebGPU) não está incluída: modelos assim pesam vários GB e não
  rodam na maioria dos celulares. A IA local é pelo Ollama, LM Studio ou llama.cpp, que rodam no aparelho ou num
  computador da rede.
- **Ouvir** depende do navegador (o Firefox não tem reconhecimento de fala). A transcrição por API (Whisper)
  ainda não está ligada.
- **Rastreamento pela câmera** (como no VTube Studio) e **movimentos `.motion3.json`** além do movimento parado
  ainda não estão incluídos.
- Os modelos de exemplo e o núcleo do Live2D não vêm junto (licenças).
