# Companhia

Converse com personagens **Live2D** (o mesmo tipo de modelo que o **VTube Studio** usa) ou **VRoid** (`.vrm`, em 3D). Ela responde
num chat (com uma IA na nuvem, uma IA local ou o motor local, sem IA), **fala** com a voz que você escolher,
**reage com o rosto e o corpo** ao que diz, **sente os toques** (cafuné, cutucar, puxar a orelha, cócegas) e
**lembra** de você, porque as conversas ficam guardadas no próprio aparelho.

Nas personagens VRoid há ainda o menu **Movimento**: **captura de movimento** pela câmera (rosto, olhos, tronco,
braços, mãos, dedos e pernas), **pacotes de movimento** (`.vrma`, `.fbx`, `.bvh`), **cenários** para andar
(W A S D, Espaço pula), com **luz e sombras realistas** (dá para desligar), um **conversor de mapas** para `.glb`
(inclusive `.blend`, do Blender) e **ajuste do esqueleto**. Avatares do **Unity / VRChat** (`.unitypackage`,
`.fbx`) são convertidos para `.vrm` ao importar.

Ao abrir, a Companhia pergunta o que você quer fazer: **conversar com a personagem** (o chat bot) ou **jogar com
outras pessoas** numa **sala**, pelo link, sem chat bot nem nenhuma função de IA. A **loja** do servidor tem
personagens, mundos e animações para ver em 3D, usar e publicar; e o servidor pode publicar **só a Companhia**,
sem os outros apps e sem a ponte para quem vem de fora.

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

## Conversar ou jogar com outras pessoas

Ao abrir, aparece a **tela de início**: a página inteira, escura, com um cartão no meio para **entrar na conta**
(e-mail e senha, *Esqueci a senha*, *Criar uma conta* e o código que chega por e-mail, tudo no próprio cartão).
Quem já entrou neste navegador vê a foto e **Continuar**. Embaixo do cartão, quantas salas estão abertas agora.

- **Entrar** (ou **Jogar sem conta**, quando o servidor deixa): o modo de jogar, com outras pessoas, numa sala. Neste
  modo **não há chat bot nem nenhuma função de IA**: somem os menus Conversa, IA e Voz, a memória, as respostas da
  personagem e os toques com reação; quem fala são as pessoas, num bate-papo por texto. Se o dono do servidor
  exige conta, "Jogar sem conta" some.
- **Conversar com a personagem** (no alto e no rodapé): o chat bot, como descrito no resto deste guia (IA ou motor
  local, voz, toques, memória).

Sem contas no servidor (ou com a página aberta sem ele), o cartão oferece só jogar e conversar. A escolha fica no
endereço (`#modo=conversa` ou `#modo=jogar`, e aí a tela de início não aparece); *Ajuda › Trocar de modo* volta a ela.
Quem abre o link de uma sala (`#sala=código`) já cai no modo de jogar.

### Salas

Ao jogar, aparece a **lista de salas** deste servidor (como a lista de servidores de um jogo): a miniatura do
cenário, o nome, a descrição, quem criou, quantas pessoas estão e cabem (👥 2/8), um 🔒 nas que têm senha e
"Cheia" nas lotadas. Ela se atualiza sozinha. Em cima ficam o **seu nome** e a **sua personagem** (uma das suas,
`.vrm`, ZIP ou avatar do Unity; uma da loja, com 🛍️; ou o boneco simples).

- **Entrar**: um clique na sala (pede a senha, se tiver). Uma sala **privada** não aparece na lista: entra quem
  tiver o link, que abre a Companhia já com ela em destaque ("A sala do seu link"); dá também para colar o link.
- **Criar** (＋ Criar sala): **não precisa da ponte**. Pelo link isolado (veja "Site publicado só com a
  Companhia"), quem chega cria a sala dele, se o dono do servidor deixar: ele vê na lista a opção *Deixar quem
  entra pelo link criar salas* (ligada por padrão). As opções:
  - **nome** e **descrição**;
  - **pública** (aparece na lista) ou **privada** (só com o link);
  - **senha** (opcional);
  - **quantas pessoas** cabem (de 2 a 16);
  - **bate-papo** por texto, ligado ou não;
  - **quem pode pôr vídeos na tela**: todos (padrão) ou só quem criou;
  - o **cenário**: o chão simples, um dos seus (*Movimento › Cenário*) ou um **mundo da loja**, com a prévia em
    3D antes de escolher. A miniatura da sala na lista é tirada dessa prévia.
- **Depois de criar**, aparece o link da sala para mandar. Quem criou continua dona dela neste navegador:
  *Sala › Opções da sala* muda tudo (inclusive tirar a senha ou fechar o bate-papo, que trava a caixa de texto de
  todos), *Trocar o cenário da sala* (também pelos mundos da loja), *Ajustar o cenário da sala* (tamanho, posição e
  onde se nasce, para todos), *Voar* (só quem criou atravessa as paredes) e *Fechar a sala para todos*.
- **Na sala**: cada pessoa anda com a própria personagem (W A S D, Shift, Espaço). Os outros veem você andar,
  correr, pular, **acenar** e mudar de **expressão** (os botões 👋 😀 😂 😮 😢 😠 😐) e, com a captura de movimento
  ligada, mexer os braços, as mãos e o rosto. O **bate-papo** aparece na conversa e num balão em cima da cabeça.
- **Personagens dos outros**: cada um aparece com a personagem que escolheu (o `.vrm` passa pelo servidor da sala uma
  vez, sem limite de tamanho). Enquanto ela não chega, aparece um boneco simples. Você não precisa ter a personagem
  dos outros, nem eles a sua: ela vai junto ao entrar.
- **A aparência vale para todos**: o que você muda na personagem aparece igual para os outros, na hora: o tamanho e as
  proporções (*Movimento › Ajustar esqueleto*: altura, cabeça, braços, mãos, pernas), os braços em descanso, as
  correções dos ossos, as peças de roupa escondidas, as texturas trocadas e a roupa vestida.
- **Para pessoas de fora**: use no LNUX *🧩 Apps Web › 💬 Publicar só a Companhia* (veja "Site publicado só com a
  Companhia", abaixo): o link abre só a Companhia, sem a ponte. A sala fica no servidor do aparelho de quem criou e
  existe enquanto ele estiver ligado. Na rede de casa também dá (`--endereco 0.0.0.0`).
- **Vídeo numa tela**: veja "Vídeo na tela", abaixo.
- Limites: 12 salas abertas no servidor (3 por pessoa, menos o dono) e até 16 pessoas por sala. O cenário e as
  personagens não têm limite de tamanho; só não podem deixar o aparelho do servidor com menos de 300 MB livres. Quem
  some por 20 segundos sai da sala; uma sala vazia fecha depois de 15 minutos.

### Vídeo na tela

O botão **📺** (embaixo do palco) ou *Sala › Vídeo na tela* põe um vídeo numa **tela dentro do cenário**, na frente
da sua personagem. Serve um link do **YouTube** (vídeo, *shorts*, ao vivo ou playlist; o `t=` do link vale), do
**Vimeo**, da **Twitch** (canal ao vivo ou vídeo) ou de um **arquivo de vídeo** (`.mp4`, `.webm`, `.ogv`, `.mov`).
Outros sites não abrem: a tela só monta o player oficial de cada site, nunca uma página qualquer.

- **A tela**: *🚶 Segue a personagem* (fica sempre depois dela, na direção em que a sua câmera olha, aonde você
  for) ou *📌 Fica parada aqui* (no lugar do cenário onde estava; *↩* traz de volta para a frente dela). Cinco
  tamanhos: pequena (1,2 m), média, grande, cinema e telão (8 m).
- **A barra de controles** (só para quem pôs o vídeo): pausar ou continuar, voltar e pular 10 segundos,
  sincronizar, seguir ou parada, o tamanho, o som, trocar o vídeo e fechar. Com o mouse em cima da tela, os
  cliques vão para o próprio player (no celular, o toque seguinte, por 5 segundos); clique no cenário para voltar a
  andar.
- **Na sala, todos veem**: a tela de cada um aparece para os outros no mesmo lugar e no **mesmo pedaço do vídeo**
  (o servidor guarda quando o vídeo começou ou onde parou, e cada um calcula o ponto pelo relógio do servidor).
  Pausar, pular e continuar valem para todos. Quem entra depois pega o vídeo no ponto em que está. Quem pôs o vídeo
  e sai da sala continua com ele só para si.
- **O som** das telas paradas e das dos outros diminui com a distância. *Sala › Som das telas dos outros* deixa as
  dos outros mudas e *Ver as telas dos outros* as esconde (só para você).
- **Quem pode pôr vídeo**: nas opções da sala, *Quem entra pode pôr vídeos na tela*. Desligado, só quem criou põe; as
  telas dos outros somem na hora.
- Como funciona: os sites de vídeo só deixam tocar pelo player deles, que não pode virar textura do 3D. Então o player
  fica numa camada logo atrás do palco, posta em 3D junto com a câmera, e a cena abre um "furo" onde a tela aparece:
  quem estiver na frente dela (uma personagem, uma parede) aparece por cima, como num lugar de verdade. O vídeo vem
  direto do site dele para cada pessoa (o servidor só guarda o link, o lugar e o relógio). O YouTube abre pelo
  endereço sem cookies (`youtube-nocookie.com`). A Twitch só deixa o player em endereços `https` (como o do túnel).

### Contas e perfil

Dá para jogar sem conta, mas com uma conta você aparece com o **nome, a foto e o perfil** para os outros. Na lista
de salas (ou no menu *Conta*):

- **Criar conta**: nome, idade, e-mail e senha (pelo menos 8 caracteres). Chega por e-mail um **código de 6
  dígitos** (vale 15 minutos); com ele a conta é confirmada e você já entra. Dá para pedir outro código depois de 1
  minuto. A idade mínima é 13 anos (o dono do servidor pode mudar).
- **Entrar** com o e-mail e a senha; **Esqueci a senha** manda um código para criar uma senha nova. Com a conta, o
  nome no jogo é o dela.
- **Meu perfil**: foto (recortada em quadrado) e capa, nome, bio, pronomes, cidade, até 3 links e uma cor; também
  trocar a senha, sair e apagar a conta. Em *Sala › Pessoas na sala*, quem tem conta aparece com a foto, e um clique
  abre o perfil (sem o e-mail e a idade, que só a própria pessoa e o dono veem).
- **Onde fica**: tudo no aparelho de quem tem o servidor, em `~/.lnux-apps/contas/` (`contas.json`, permissão 600, e
  as fotos em `midia/`). A senha, os códigos e as sessões ficam só como hash (a senha com PBKDF2-SHA256). Este
  navegador guarda só a sessão.
- **Para o dono** (*Contas e e-mail*, na lista de salas, ou *Conta › Contas e e-mail do servidor*): o **e-mail que
  manda os códigos** — uma conta de e-mail sua (Gmail, Outlook, Yahoo ou outro servidor SMTP). No Gmail, crie uma
  "senha de app" (Conta Google › Segurança › Senhas de app) e use no lugar da senha normal; ela fica só no aparelho
  (`~/.lnux-apps/email.json`, permissão 600) e nunca volta para a tela. Há um botão de e-mail de teste. Também: a
  idade mínima, **só entra nas salas quem tem conta**, e a lista das contas (com a opção de apagar uma).
- Sem o e-mail configurado, dá para jogar e entrar, mas não para criar contas.

### Loja: personagens, mundos e animações

A **loja** (*Personagem › Loja*, *Sala › Loja* ou os botões 🛍️ na janela da sala) mostra o que está guardado no
aparelho de quem tem o servidor, como uma vitrine: abas (personagens, mundos, animações), busca e cartões com a
miniatura.

- **Ver antes de usar**: ao abrir um item, ele aparece em **3D**: a personagem de pé (arraste para girar, a rodinha
  aproxima), o mundo visto de cima e a animação num boneco.
- **Usar**: a personagem vira uma das suas (na janela da sala, já fica escolhida), o mundo vai para *Movimento ›
  Cenário* (e pode ser o cenário de uma sala) e a animação para *Movimento › Pacotes de movimento*. *Baixar o
  arquivo* guarda o `.vrm`, `.glb`, `.vrma`, `.bvh` ou `.fbx`.
- **Publicar** (＋ Publicar): uma das suas personagens, um dos seus cenários ou movimentos, ou um arquivo do aparelho
  (avatares do Unity viram `.vrm`; mapas de qualquer formato viram `.glb`). A miniatura é tirada da prévia. Quem
  publicou pode apagar o que é seu (neste navegador).
- **O dono da loja** (quem abre no aparelho do servidor, com a ponte) apaga qualquer item, decide se quem entra
  pelo link pode publicar e vê onde fica a pasta: `~/.lnux-apps/loja` (ou `"loja"` em `ponte.json`, ou `--loja`),
  com as subpastas `personagens`, `mundos` e `animacoes`. Arquivos postos à mão nelas também aparecem na loja; as
  miniaturas que faltam o dono gera sozinho ao abrir a loja.
- É a única pasta do aparelho que os visitantes alcançam. O formato de cada arquivo é conferido ao publicar.

### Site publicado só com a Companhia

O servidor pode publicar **só a Companhia** (`python3 servidor/lnux_apps.py --so-app companhia`; no LNUX, *🧩 Apps
Web › 💬 Publicar só a Companhia*, que também liga o túnel):

- O endereço abre direto na Companhia; a página inicial dos Apps Web e os outros apps **não existem** nele, e o
  botão dos Apps Web some.
- De fora (pela rede ou pela internet, pelo túnel) a **ponte não abre, nem com a chave**: só as salas e a loja.
  Quem chega pelo link vê a lista de salas, entra e cria a sua (se o dono deixar). A chave só vale para quem abre
  no próprio aparelho do servidor (`127.0.0.1`).
- O link para as pessoas nunca leva a chave.

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
- O pacote do three.js com o three-vrm (`vendor/three-vrm-pacote.min.js`, ~1 MB) só carrega quando uma
  personagem VRoid abre. Para montar de novo: `sh tools/montar_vrm.sh`.
- Abrem os modelos **VRM 0.x** (VRoid Studio estável) e **VRM 1.0**.

Nos modelos **Live2D**, as roupas e os acessórios que o autor separou ficam nas expressões (como os atalhos do
VTube Studio). Quando o nome parece roupa (clothe, outfit, hat...), elas também aparecem no botão 👗.

## Avatares do Unity e do VRChat (.unitypackage, .fbx)

*Personagem › Importar avatar do Unity* (ou arrastar o arquivo para a tela) aceita o **`.unitypackage`** de um
avatar (como os do VRChat e os vendidos no BOOTH), um **ZIP** com o `.unitypackage` dentro, um **`.fbx`** com as
texturas ao lado (num ZIP) ou um **`.glb`** com esqueleto. O avatar é **convertido para `.vrm`** (VRM 1.0) no
próprio aparelho e vira uma personagem como as do VRoid: conversa, roupas, captura de movimento, pacotes de
movimento, andar e salas. Se o pacote já traz um `.vrm`, é ele que entra.

- **Esqueleto**: os ossos de pessoa vêm da ficha que o Unity guarda ao lado do `.fbx` (o `.meta`, com o avatar
  "Humanoid") ou, sem ela, dos nomes dos ossos (mixamo, Unity, VRoid, Blender: `Left arm`, `Left elbow`,
  `Left knee`...). O avatar é posto **de pé, de frente, em metros** (os `.fbx` costumam vir em centímetros), sem as
  escalas escondidas no esqueleto, com os braços e as pernas na **pose em T** (avatares em A também servem).
- **Materiais e texturas**: os materiais `.mat` do Unity são ligados às texturas do pacote (pela ficha e pelo
  nome): cor, textura principal, recorte (cabelo, cílios), transparência, dois lados e brilho próprio. Entram no
  estilo de desenho das personagens VRoid (MToon). PNG e JPEG entram como vieram; **TGA** e **PSD** (do Photoshop)
  são convertidos. Num avatar convertido, cada material é uma peça em *Personagem › Roupas* (para esconder o que
  sobrar ou trocar a textura).
- **Rosto**: as formas do rosto viram expressões do VRM: boca (`vrc.v_aa`, `vrc.v_oh`..., `あ`, `A`), piscar
  (`vrc.blink`, `まばたき`), alegre (`Joy`, `笑い`), brava, triste, surpresa; outras como `照れ` (rubor), lágrima e
  língua viram atalhos. Só as formas usadas ficam no arquivo.
- **Balanço**: os ossos soltos de **cabelo, saia, rabo, orelhas e fitas** (pelo nome) ganham balanço, com
  colisores na cabeça, no corpo e nas coxas. Os olhos (ossos `LeftEye`/`RightEye`) seguem a pessoa.
- Antes de importar, um **resumo** mostra o que foi reconhecido (ossos, expressões, texturas, balanço) e o que não
  veio. Se o pacote tem mais de um modelo, a Companhia pergunta qual é o avatar.
- **Não vêm**: os efeitos dos shaders do Unity (lilToon, Poiyomi: contornos, brilhos, matcaps), as físicas do
  VRChat (PhysBones, que ficam no prefab, não no modelo), as animações, os menus e as peças ligadas ou desligadas
  pelo prefab.
- **Licença**: um pacote do Unity não diz o que o autor deixa fazer, e avatares comprados quase nunca deixam
  redistribuir. O `.vrm` convertido fica marcado como **"não redistribuir"**: a personagem fica só neste aparelho e
  a Companhia avisa antes de mandá-la para outras pessoas numa sala. Confira os termos de quem fez o avatar.

## Movimento: captura, pacotes de movimento, cenário e esqueleto (personagens VRoid)

O menu **Movimento** (ou o botão 🎬 no palco) vale para as personagens VRoid, que têm esqueleto. Os painéis abrem ao
lado da personagem, para ver o resultado enquanto você mexe.

### Captura de movimento (câmera)

*Movimento › Captura de movimento* liga a câmera do aparelho e a personagem passa a fazer o que você faz:

| O que rastreia | Como aparece na personagem |
|---|---|
| **Rosto e expressões** | piscar (cada olho), boca (aa, ih, ou, ee, oh), sorriso, sobrancelhas, olhos arregalados e a cabeça (virar, inclinar, abaixar). Nos modelos do VRoid, o sorriso e as sobrancelhas usam as formas separadas do rosto (`Fcl_BRW_*`, `Fcl_MTH_*`, `Fcl_EYE_*`), então sorrir não fecha os olhos. Modelos com as 52 formas do ARKit ("perfect sync") recebem as 52 direto |
| **Olhos** | para onde você olha (os olhos da personagem acompanham) |
| **Corpo** | tronco (inclinar e girar), ombros (subir, um mais alto que o outro) e braços (ombro, cotovelo e pulso) |
| **Mãos e dedos** | o pulso e cada falange dos cinco dedos, das duas mãos |
| **Pernas e postura inteira** | quadril, joelhos e pés, com os pés mantidos no chão (agachar desce o quadril). Precisa do corpo inteiro na câmera; fica desligado por padrão |

- **Espelhar** (ligado por padrão): como num espelho, sua mão direita mexe a mão do lado direito da tela.
  Desligado, sua mão direita mexe a mão direita da personagem.
- **Suavizar** tira o tremido; **Calibrar** faz da posição atual da cabeça o "olhando para a frente".
- A janelinha no canto mostra a câmera com os pontos achados (dá para esconder).
- Em *Câmera e desempenho*: qual câmera, precisão do corpo (leve ou completa), processar pela placa de vídeo ou
  pelo processador e quantos quadros por segundo. No celular, desligue o que não usar (as mãos pesam mais).
- **A imagem não sai do aparelho.** O rastreamento é o [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/guide)
  (Google, Apache-2.0), rodando no próprio navegador, num Worker (o desenho da personagem não trava). Nada é enviado
  nem gravado.
- **Arquivos do rastreamento.** O WebAssembly e os modelos do MediaPipe somam uns 30 MB (uns 25 MB com tudo ligado
  no modo leve) e não vêm no repositório. Na primeira vez eles são buscados nesta ordem: na cópia guardada no
  navegador; na **ponte** (que baixa das fontes oficiais uma vez e guarda em `~/.lnux-apps/mediapipe/`); ou direto da
  internet (e aí ficam guardados no navegador). Depois disso a captura funciona sem internet.
- A câmera só abre em **endereço seguro**: `http://127.0.0.1` / `localhost` (como o LNUX abre) ou `https` (o túnel).
- Com a captura ligada a personagem continua conversando: a boca soma a voz dela com a sua, e as emoções da
  conversa continuam valendo no rosto.

### Pacotes de movimento

*Movimento › Pacotes de movimento › Importar* (ou arraste o arquivo para o palco):

| Formato | |
|---|---|
| **`.vrma`** | VRM Animation, o formato oficial de movimentos do VRM (os pacotes da pixiv/VRoid vêm assim). Pode trazer expressões do rosto |
| **`.fbx`** | animações do [Mixamo](https://www.mixamo.com) e de outros programas, com ou sem a malha junto |
| **`.bvh`** | captura de movimento |
| **`.glb` / `.gltf`** | modelos com animação: cada animação do arquivo vira um movimento |
| **`.zip`** | um pacote com vários desses |

- Cada movimento serve para **qualquer personagem** VRoid (e para todas as roupas dela): ele é guardado como
  rotação de cada osso do VRM a partir da pose em T, e o quadril em "alturas do quadril".
- Nos `.fbx`, `.bvh` e `.glb`, o esqueleto do arquivo é reconhecido pelos **nomes dos ossos** (Mixamo, Unity/VRM,
  VRoid, Unreal, Blender, BVH da CMU...). A Companhia corrige sozinha para onde o esqueleto do arquivo olha e se
  ele descansa em T ou em A. Se um membro mexer errado, **⋯ › Ossos...** deixa ligar à mão cada osso da
  personagem a um osso do arquivo.
- **Repetir**, **velocidade** e **parar**; a emoção e a boca continuam funcionando por cima do movimento.
- **No cenário:** em ⋯ dá para usar um movimento ao **ficar parada, andar, correr ou pular**. Os nomes `idle`,
  `walk`, `run` e `jump` já são ligados sozinhos ao importar.
- Não abre: `.vmd` (MikuMikuDance) e `.anim` do Unity (que guarda "músculos" do Unity, não ossos).

### Cenário e andar

*Movimento › Cenário (mapa)* abre um modelo 3D como lugar: **`.blend`** (Blender), **`.glb` / `.gltf`** (com Draco
e Meshopt), **`.fbx`**, **`.obj`**, **`.dae`**, **`.stl`**, **`.ply`**, **`.3ds`**, **`.3mf`**, **`.usdz`**, um **ZIP** com
o modelo e as texturas, ou um **`.unitypackage`** (a Companhia abre o pacote e lista os modelos de dentro). Tudo
é **convertido para `.glb`** ao abrir (veja "Converter mapas", abaixo). No retrato o cenário aparece atrás da
personagem; em **Andar pelo cenário** ela anda por ele:

| | |
|---|---|
| **W A S D** ou as setas | andar (em relação à câmera) |
| **Shift** | correr |
| **Espaço** | pular |
| **V** | voar, atravessando as paredes (numa sala, só quem criou): **Espaço** sobe, **C** desce, **Shift** mais rápido |
| arrastar | girar a câmera (ela não atravessa as paredes) |
| rodinha | aproximar e afastar |
| celular | direcional, botão de correr e botão de pulo na tela; voando, 🕊 e os botões de subir e descer |

- A personagem é uma cápsula que desliza no chão, nas paredes, nas rampas e nos degraus baixos. As malhas do mapa
  são juntadas numa árvore ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)), então mapas grandes
  não pesam a cada quadro. Caiu para fora do mapa, volta ao começo.
- **Onde ela nasce**: no ponto de partida guardado ou, sem ele, no chão do meio do mapa. Num **mapa fechado** (uma
  casa, um salão com teto), o primeiro chão que se vê de cima é o telhado; por isso vale o chão que tem um teto por
  perto e onde ela cabe em pé: ela nasce **dentro**, não em cima. Se ainda não for o lugar certo, **voe** até lá
  (V, ou o botão *Voar* do painel) e use **Começar aqui**.
- **Tamanho** (os `.fbx` costumam vir em centímetros: use ÷ 10 / × 10), **girar**, **O mapa veio deitado** (para
  arquivos com o Z para cima, como `.stl` e `.ply`), **Posição do mapa** (X, Y e Z: o mapa inteiro anda e a
  personagem fica onde está, bom para encaixar o mapa em volta dela), **Começar aqui** (o ponto de partida) e a
  **velocidade** de andar ficam guardados por cenário. Sem cenário, há um chão simples.
- **Voar** (V): sem gravidade e atravessando as paredes, para entrar num mapa fechado, achar um lugar e marcar o
  começo. Parou de voar onde não há chão, cai e volta ao começo. Sozinho, sempre pode; **numa sala, só quem criou**
  (para quem visita, o V avisa e o botão some).
- **Na sala**, o cenário é o de quem criou: só essa pessoa muda o tamanho, o giro, a posição e o começo (*Sala ›
  Ajustar o cenário da sala*), e o ajuste chega a todos na hora, **sem baixar o mapa de novo** (quem estava andando
  volta ao começo, para não ficar dentro de uma parede). Para quem visita, esses controles ficam travados.
- Andar tem um movimento próprio (andar, correr, pular); os movimentos de um pacote podem ficar no lugar.
  A captura pela câmera funciona junto: você anda com as teclas e os braços e o rosto seguem a câmera.
- Rosto / Busto / Corpo voltam ao retrato.

### Luz e sombras

No cenário (com um mapa aberto ou andando), a **luz realista** troca a luz de frente por um **sol que faz sombra**:
a personagem, as outras pessoas da sala e o próprio mapa fazem e recebem sombra, com céu azulado, chão quente e
tons mais naturais. No painel *Cenário* (e em *Exibir*):

- **Luz e sombras realistas**: liga e desliga tudo (desligada, volta a luz simples de antes, mais leve).
- **Sombras**: só as sombras (o sol continua). Sem elas, volta a sombra redonda embaixo da personagem.
- **Direção do sol** e **altura do sol** (de 10° a 85°: baixo, sombras compridas; alto, sombras curtas).

A escolha fica guardada. No **celular** começa desligada, porque as sombras pesam; ligue se o aparelho aguentar.
No retrato de conversa (sem cenário) a luz é sempre a de frente.

### Converter mapas para `.glb`

O `.glb` (glTF binário, com as texturas dentro) é o formato em que a Companhia guarda e abre os cenários. Qualquer
mapa aberto em *Cenário › Abrir cenário* é convertido para ele; **Salvar em .glb** entrega o arquivo convertido, e
*Movimento › Converter mapa para .glb* (ou **Só converter**, no painel) converte e salva sem trocar o cenário.

| De | Como |
|---|---|
| **`.blend`** (Blender) | **Com a ponte e o Blender instalado no aparelho** (o programa `blender` ou o módulo `bpy` do Python; `LNUX_APPS_BLENDER` aponta outro), é o próprio Blender que abre o arquivo e exporta: sai igual ao que ele mostra, com os modificadores aplicados. O arquivo é aberto sem rodar os scripts que traz. **Sem o Blender** (no celular, por exemplo), entra o **leitor próprio** de `.blend`, que roda no navegador |
| `.fbx`, `.obj` (+ `.mtl`), `.dae`, `.stl`, `.ply`, `.3ds`, `.3mf`, `.usdz` | pelos carregadores do three.js; os materiais viram materiais do glTF |
| `.gltf` com `.bin` e texturas soltas, `.glb` | juntados num arquivo só |
| `.zip`, `.unitypackage` | abertos antes; se houver vários modelos, você escolhe qual é o mapa |

O **leitor próprio de `.blend`** lê o "DNA" que cada arquivo traz (a descrição das estruturas da versão que o
gravou), então abre arquivos do Blender 2.6 ao 5.x, compactados (gzip ou zstd) ou não. Ele tira: as malhas, a
posição de cada objeto no mundo (inclusive filhos de outros objetos), o mapa UV, os materiais (cor, rugosidade,
metal e a imagem ligada à cor do Principled BSDF) e as texturas embutidas no arquivo (ou as que vierem junto, pelo
nome). **Não tira**: modificadores (espelho, matriz, subdivisão...), curvas, textos, metaballs, instâncias de
coleção, partículas e animações — para isso, use a conversão pelo Blender (instale o Blender e abra a Companhia
pelo LNUX) ou, no Blender, *Arquivo › Exportar › glTF 2.0*. A Companhia avisa quando converteu pelo leitor próprio.
Se as texturas do `.blend` ficam em arquivos separados, escolha as imagens junto com ele (ou embuta no Blender:
*Arquivo › Dados externos › Empacotar recursos*).

**Mapas do VRChat.** Um mundo publicado do VRChat (`.vrcw`) é um pacote fechado do motor Unity: malhas, materiais,
shaders e scripts num formato do próprio motor, que não abre fora dele (e baixar o mundo de outra pessoa fere os
termos do VRChat). O que dá para usar aqui são os **arquivos do projeto** do mundo: o `.blend` do Blender, os
modelos `.fbx`/`.obj`/`.dae` (direto ou de dentro do `.unitypackage`) ou a cena exportada do Unity com o
[UnityGLTF](https://github.com/KhronosGroup/UnityGLTF) ("Export scene as GLB") — a Companhia converte para `.glb`. De um `.unitypackage`, a Companhia
abre **um modelo** como mapa; as peças soltas de uma cena montada no Unity (`.unity`, prefabs) não são
reposicionadas, e os materiais do Unity (`.mat`, shaders) não são convertidos — as texturas entram quando o
próprio modelo aponta para elas. Use só mapas que você tem o direito de usar.

### Ajustar esqueleto

*Movimento › Ajustar esqueleto* corrige o esqueleto de cada personagem. Vale para tudo (a pose parada, os
pacotes de movimento e a captura) e fica guardado com ela (e vai junto no ZIP exportado):

- **Braços em descanso**: de 0° (abertos em T) a 90° (colados no corpo). O padrão é 69°.
- **Proporções**: altura, cabeça, braços, mãos e pernas (com pernas mais compridas, o quadril sobe e os pés
  continuam no chão).
- **Correção por osso**: escolha o osso (ele fica marcado no esqueleto desenhado na tela) e gire em X, Y e Z;
  **Espelhar no outro lado** aplica o mesmo no osso do outro lado. Serve, por exemplo, para os braços de um pacote
  de movimento que atravessam a roupa, ombros caídos ou pés virados.

### O defeito dos braços para cima (VRM 0.x)

Os modelos **VRM 0.x** (os exportados pelo VRoid Studio "estável") olham para −Z e têm o braço esquerdo em −X; o
VRM 1.0 olha para +Z com o braço esquerdo em +X. A Companhia girava o modelo inteiro, mas as rotações dos ossos
continuavam espelhadas: nesses modelos os braços iam para **cima** em vez de para baixo, e a cabeça e o tronco
inclinavam ao contrário. Agora a pose é montada num espaço só (o do VRM 1.0) e convertida no fim, para os dois
tipos. Nos VRM 0.x do VRoid, a expressão "Surprised" (que vem como expressão própria) também passou a valer
como a "surpresa" padrão.


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
js/vrm.js          palco 3D para personagens VRoid (.vrm): a pose em camadas (descanso, movimento, captura, gestos,
                   ajuste do esqueleto), expressões, toques, peças e texturas
js/captura.js      captura de movimento: câmera → MediaPipe (num Worker) → ossos, dedos, olhos e expressões do VRM
js/movimentos.js   pacotes de movimento: .vrma, .fbx, .bvh e .glb viram movimentos que servem em qualquer personagem
js/mundo.js        cenário (mapas), colisão, andar (W A S D, Espaço), voar (V), onde nascer, câmera em terceira pessoa e controles de toque
js/conversor.js    conversor de mapas: .blend, .fbx, .obj, .dae, .stl, .ply, .3ds, .3mf, .usdz e glTF → .glb
js/avatar.js       conversor de avatares: .unitypackage, .fbx e .glb com esqueleto → personagem .vrm (ossos, pose em T,
                   materiais .mat do Unity, texturas TGA/PSD, expressões, balanço)
js/sala.js         salas para jogar com outras pessoas: entrar, as personagens dos outros, posições, bate-papo
js/video.js        vídeo numa tela do cenário (YouTube, Vimeo, Twitch, arquivo): segue a personagem ou fica parada, igual para todos da sala
js/salas.js        a lista de salas (como a de servidores) e o formulário de criar uma sala com as opções
js/inicio.js       a tela de início: o cartão de entrar na conta (ou jogar sem conta) e o caminho para o chat bot
js/contas.js       contas: criar com o código por e-mail, entrar, esqueci a senha, perfil (foto, capa, bio...) e os
                   ajustes do dono (o e-mail que manda os códigos, idade mínima, exigir conta)
js/loja.js         loja de personagens, mundos e animações do servidor, com a prévia em 3D (a vitrine) e publicar
js/blend.js        leitor de arquivos .blend (Blender 2.6 ao 5.x), sem depender do Blender nem do navegador
js/estudio.js      os painéis do menu Movimento (captura, movimentos, cenário, esqueleto)
js/live2d.js       palco: núcleo, carregar o modelo (texturas no tamanho que a placa aguenta), sinais → parâmetros,
                   emoções, gestos, piscar, olhar, boca, toques
js/personagens.js  importar (ZIP, pasta, ponte), ler o vtube.json, guardar, trocar, exportar
js/ia.js           provedores, chaves, transporte (ponte/direto), streaming, roteador, marcas [emoção], motor local
js/voz.js          geradores de voz, fila frase a frase, boca pelo som, cache, reconhecimento de fala
js/memoria.js      IndexedDB, análise local e pela IA, BM25, visitas, exportar/importar, cópia no aparelho
js/reacoes.js      reações aos toques (área × gesto)
js/app.js          a tela: conversa, menus, janelas de ajustes
vendor/            pixi.js 6 e pixi-live2d-display (MIT); three.js + three-vrm + three-vrm-animation + three-mesh-bvh
                   (MIT, three-vrm-pacote.min.js); MediaPipe Tasks Vision (Apache-2.0, mediapipe-visao.min.js) e o
                   decodificador Draco (Apache-2.0, draco/) — o Cubism Core e os ~30 MB do MediaPipe não vêm junto
```

Teste no Chromium (precisa de um modelo e do núcleo, que não estão no repositório):

```bash
LNUX_TESTE_MODELO=/caminho/modelo.zip LNUX_TESTE_NUCLEO=/caminho/live2dcubismcore.min.js python3 tests/testar_navegador.py companhia
```

As personagens VRoid têm testes próprios, que baixam o modelo de exemplo da pixiv (ou usam `LNUX_TESTE_VRM`):

```bash
python3 tests/testar_navegador.py companhia_vrm     # importar, roupas, emoções, toques
python3 tests/testar_navegador.py companhia_corpo   # menu Movimento
python3 tests/testar_navegador.py companhia_mapas   # conversor de mapas (.blend e outros → .glb)
python3 tests/testar_navegador.py companhia_sala    # salas: duas pessoas (dois navegadores) na mesma sala
python3 tests/testar_navegador.py companhia_avatar  # avatares do Unity (.unitypackage, .fbx) → .vrm
python3 tests/testar_navegador.py companhia_loja    # loja (publicar, prévia 3D, usar) e o site publicado sozinho
python3 tests/testar_navegador.py companhia_contas  # contas: código por e-mail (servidor de e-mail de mentira), perfil
```

O `companhia_sala` abre dois navegadores: um cria a sala com um cenário, o outro entra pelo link, e os dois se
veem andar, acenar, mudar de expressão e conversar; confere também que o modo de jogar não tem nada de IA. O
`companhia_avatar` monta um avatar no jeito dos do VRChat (`.fbx` em centímetros, de costas, braços em A, ossos
com nomes do Blender, formas do rosto, materiais `.mat` e texturas PNG, TGA e PSD) e confere a personagem
convertida: de frente, braços para baixo, pés no chão, textura do lado certo, expressões, balanço e licença.

O `companhia_corpo` monta os próprios arquivos de teste (um boneco VRM 0.x só de ossos, um `.bvh`, um cenário
`.glb` e um `.unitypackage`), então a maior parte roda sem internet: braços para baixo no VRM 0.x, captura com
resultados de mentira (braço, dedos, espelho, pernas), movimentos, andar/correr/pular/parede, esqueleto. Com
internet ele ainda usa o modelo e o `.vrma` de exemplo da pixiv (rosto) e faz a captura de verdade: uma foto de
exemplo do MediaPipe vira a câmera do Chromium e a personagem copia a pose (`LNUX_TESTE_SEM_CAMERA=1` pula).

O `companhia_mapas` usa dois `.blend` de verdade guardados em `tests/dados/` (salvos pelo Blender 4.2 e pelo 5.3,
que gravam as malhas de jeitos diferentes; `gerar_blend.py` mostra como foram feitos) e monta os outros formatos
na hora. Se o aparelho tiver o Blender (ou o módulo `bpy`), ele confere também a conversão feita por ele.

## O que ainda não faz

- **Modelos Cubism 2** (`.moc` / `model.json`) não abrem; só Cubism 3 e 4.
- **Itens de roupa do VRoid Studio** (`.vroidcustomitem`) só abrem no VRoid Studio. Aqui entram a personagem
  exportada (`.vrm`) e as texturas do pacote.
- **Mundos publicados do VRChat** (`.vrcw`) e cenas montadas do Unity não abrem; só os arquivos do projeto
  (`.blend`, `.fbx`, `.obj`, glTF...; veja "Mapas do VRChat"). Texturas KTX2/Basis nos `.glb` ainda não abrem.
- **`.blend` sem o Blender instalado**: o leitor próprio não aplica modificadores nem lê curvas, textos, instâncias
  de coleção e materiais além do Principled simples (veja "Converter mapas"). `.max`, `.c4d` e `.ma/.mb` não abrem:
  exporte desses programas em `.fbx` ou glTF.
- **Movimentos `.vmd`** (MikuMikuDance) e **`.anim`** do Unity não abrem; converta para `.vrma`, `.fbx` ou `.bvh`.
- **Captura de movimento**: é de uma câmera só, então a profundidade (um braço para a frente, as pernas) é
  estimada; mãos muito rápidas ou escondidas somem por instantes; uma pessoa por vez. Não há ainda gravação da
  captura em arquivo nem entrada de rastreadores externos (VMC/OSC).
- As físicas de roupa além das do próprio VRM (spring bones) ainda não estão incluídas. Nos avatares do Unity, as
  físicas do VRChat (PhysBones) e os efeitos dos shaders (lilToon, Poiyomi) não vêm; o balanço é dado pelos nomes
  dos ossos.
- **Salas**: só bate-papo por texto (ainda não há voz entre as pessoas) e a sala vive no servidor de quem criou:
  para pessoas de fora, o servidor precisa estar num endereço que elas alcancem (o túnel do LNUX ou a rede de casa).
- **Loja**: não há preço, avaliações nem contas: quem publica é identificado só pelo nome que escreve.
- **IA rodando dentro do navegador** (WebLLM/WebGPU) não está incluída: modelos assim pesam vários GB e não
  rodam na maioria dos celulares. A IA local é pelo Ollama, LM Studio ou llama.cpp, que rodam no aparelho ou num
  computador da rede.
- **Ouvir** depende do navegador (o Firefox não tem reconhecimento de fala). A transcrição por API (Whisper)
  ainda não está ligada.
- Nas personagens **Live2D**, o rastreamento pela câmera e os **movimentos `.motion3.json`** além do movimento
  parado ainda não estão incluídos (a captura de movimento é das personagens VRoid).
- Os modelos de exemplo e o núcleo do Live2D não vêm junto (licenças).
