# Estúdio de itens do WEBC — o pedido, melhorado

> O pedido original: "uma área de criação de itens, com um estúdio: luz (como uma lanterna que interage com o
> ambiente), carregar e editar um modelo 3D, partículas, projéteis (como balas), mais de 20 funções de edição e
> reposicionar o item no corpo (com uma mão de boneco de referência), para quem baixar já receber o item na mão — e
> quem baixou também poder reposicionar". Abaixo, o pedido reescrito e ampliado, como foi construído.

## 1. O que é

Uma página nova do site do WEBC, **CRIAR**, com o **Estúdio de itens**: a pessoa monta um objeto que a personagem
**carrega e usa** dentro das salas — uma lanterna, uma arma de bolhas, uma varinha com faíscas, um guarda-chuva, um
chapéu, uma mochila, uma tocha. O item é feito de **partes** (modelos 3D, formas prontas, luzes, emissores de
partículas e lançadores de projéteis), tem um **encaixe** no corpo e **reações** quando a pessoa o usa (tecla **E**).

Um item pronto pode ser **guardado** (no aparelho), **testado** no próprio estúdio, **usado** numa sala (os outros veem
e veem o que ele faz) e **publicado na loja** (categoria nova: **Itens**), onde os outros baixam e usam.

## 2. As partes

| Parte | O que dá para mudar |
|---|---|
| **Modelo 3D** (`.glb`, `.gltf`, `.fbx`, `.obj`, ZIP) | posição, giro, tamanho, cor por cima, brilho, opacidade, as animações do arquivo (tocar ao usar) |
| **Forma pronta** (cubo, esfera, cilindro, cone, cápsula, toro, plano, anel) | tamanho por eixo, cor, metal, rugosidade, brilho (emissão), opacidade, aramado, faces chapadas, textura (imagem) |
| **Luz** (lanterna, lâmpada) | cor, força, alcance, abertura e suavidade do cone, sombra, cone visível no ar, piscar, ligar e desligar ao usar |
| **Partículas** (fumaça, faísca, fogo, neve, bolhas, confete, estrelas, magia) | quantidade por segundo, rajada ao usar, vida, velocidade, abertura, gravidade, arrasto, tamanho (início → fim), cor (início → fim), forma, brilho somado, no mundo ou presas no item |
| **Lançador de projéteis** (pistola, laser, bolhas, fogos, bola de neve) | velocidade, gravidade, alcance (vida), cadência, quantos por tiro, dispersão, tamanho, cor, rastro, brilho, quiques, faíscas no impacto, clarão no cano, recuo |

## 3. As funções de edição (mais de 20)

1. Adicionar forma pronta (8 formas) · 2. Importar modelo 3D (com o conversor do WEBC) · 3. Adicionar luz/lanterna ·
4. Adicionar partículas (8 modelos prontos) · 5. Adicionar lançador (5 modelos prontos) · 6. Selecionar clicando na
cena ou na lista de partes · 7. **Mover** arrastando (no plano da câmera ou travado num eixo) · 8. **Girar** arrastando ·
9. **Redimensionar** arrastando · 10. Valores exatos (posição, giro, tamanho) · 11. Encaixar na grade (passo de 1 cm e
15°) · 12. Duplicar · 13. Apagar · 14. Espelhar (X, Y ou Z) · 15. Centralizar no item · 16. Pôr no chão (a base em
y = 0) · 17. Renomear · 18. Esconder e mostrar · 19. Subir e descer na lista (ordem) · 20. Cor, metal, rugosidade,
brilho, opacidade, aramado e faces chapadas · 21. Textura de uma imagem · 22. Desfazer e refazer (Ctrl+Z, Ctrl+Y) ·
23. Atalhos (W mover, E girar, R tamanho, X/Y/Z eixo, Del apagar, Ctrl+D duplicar, F focar) · 24. Modo **Testar**
(usar o item no estúdio, contra uma parede de teste) · 25. Foto do item para a loja (tirada da cena) · 26. Exportar
`.glb` e importar um item de volta.

## 4. O encaixe no corpo

- **Onde**: mão direita, mão esquerda, cabeça, peito, costas, quadril, pé direito, pé esquerdo.
- **Como**: posição, giro e tamanho em relação ao osso, ajustados com a **mão de boneco** (uma mão em pose de
  segurar, desenhada em formas simples) aparecendo no lugar do osso, e com o **boneco inteiro** ao lado para ver o
  conjunto. Os mesmos controles (arrastar, eixos, valores exatos) valem para o encaixe.
- **Quem cria** define o encaixe padrão: quem baixa já recebe o item no lugar certo.
- **Quem baixou** pode **ajustar no próprio corpo** (o modelo dela pode ter mãos maiores ou menores): o ajuste fica
  guardado no aparelho dela, por item, e vale também para o que os outros veem na sala. "Voltar ao do criador"
  desfaz.

## 5. No jogo

- **Opções › Itens**: os meus itens e os baixados da loja; **Segurar** equipa, **Ajustar no meu corpo** abre o
  encaixe, **Guardar** tira da mão.
- Teclas: **E** usa (segurando, o lançador dispara sem parar, na cadência dele); **G** guarda e mostra o item.
- A mira: com um lançador na mão aparece a mira no meio da tela; o tiro sai do cano e vai para onde a câmera aponta
  (em terceira ou primeira pessoa).
- Os projéteis batem no cenário (a mesma colisão do andar) e nas pessoas da sala (só o efeito, sem dano), quicam se
  o item mandar, e soltam faíscas no impacto.
- A luz da lanterna é uma luz de verdade: ilumina o cenário, as personagens e faz sombra.

## 6. Na sala (os outros veem)

- O arquivo do item vai para a sala como o avatar (`PUT /api/sala/<código>/item`) e os outros o baixam uma vez.
- O estado de cada um leva o mínimo: se está na mão, o ajuste do encaixe, quais luzes estão ligadas e um contador
  de usos com a direção da mira — cada um desenha os tiros e as partículas no próprio aparelho.

## 7. Segurança e desempenho (o item dos outros é dado, nunca código)

- O item é um `.glb` com a ficha (as partes que não são malha) em `extras`. Ao abrir, **todo número é conferido e
  limitado** (partículas por item, projéteis vivos, cadência mínima, alcance, força da luz), e nada vira código.
- Limites por item: 2.000 partículas vivas, 80 projéteis vivos, 4 luzes, 25 MB.
- Com "reduzir movimento" (sistema ou Opções › Acessibilidade): sem piscar e com menos partículas.

## 8. Ideias para depois

Sons ao usar (com limite de volume), itens com duas mãos (encaixe duplo), itens no mapa (colocar no chão e pegar),
trocar itens com amigos, animação de segurar própria por item, físicas (o item cai ao soltar).
