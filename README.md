# SimuSystem Web

Protótipo vetorial e responsivo do simulador de manobras do sistema elétrico.

## Recursos

- Diagramas SVG das telas SE-56A-1, SE-56C-1 e Geral Alunorte
- Estados aberto/fechado persistidos no navegador
- Confirmação de comandos e contador de erros
- Zoom para celular
- PWA com funcionamento offline

Abra `index.html` ou publique o repositório com GitHub Pages.

> Uso exclusivo para treinamento. Não utilizar para operação em tempo real.

## Aplicativo Android

O aplicativo Android abre a versão publicada do simulador e mantém o login
e as funções de operador e administrador. Precisa de internet e recebe as
atualizações do site automaticamente. Código, requisitos e instruções de
compilação estão em [android/README.md](android/README.md).

## Fluxo animado no unifilar (v41)

O botão **Fluxo animado**, junto à legenda, liga e desliga as setas no próprio
diagrama. **P · MW** mostra potência ativa em vermelho e **Q · MVAr** mostra
potência reativa em azul. Os canais podem ser exibidos separadamente. A
preferência fica salva no navegador e a função chega ao APK pela atualização
do site.

As setas acompanham as manobras e os perfis de carga/geração. O sinal é
independente para P e Q: exportação inverte P e uma carga capacitiva ou banco
de capacitores pode inverter Q. Não há setas em transferências nulas, ilhas
sem fonte ou através de disjuntores/seccionadoras abertos. A topologia e os
conectores entre abas são os mesmos utilizados pela análise das manobras.
As setas não capturam toques nem prejudicam seleção, arraste ou zoom. A
animação pausa em segundo plano e respeita a preferência de movimento reduzido.

Esta visualização distribui os valores P/Q do modelo de treinamento por
conservação de potência, sem perdas, com as impedâncias cadastradas em uma
base comum. Não é uma solução AC: Q usa a mesma alocação linear, sem resolver
as magnitudes e os ângulos de tensão. O estudo AC continua no botão **Fluxo de
carga**. Em um ciclo apenas de conexões ideais, o sentido nos ramos internos
fica indefinido e as respectivas setas são omitidas; os alimentadores com
fluxo determinado continuam visíveis. Dados inválidos ou um intercâmbio
forçado incompatível com o balanço também são indicados, sem fabricar fluxo.

## Saída e segundo plano (v40)

O botão **Sair** encerra a sessão de operador ou administrador e retorna à
visualização, com os comandos bloqueados. As janelas abertas e a senha
digitada são fechadas/limpas. Após **5 minutos em segundo plano**, a sessão
também é encerrada. O retorno verifica a hora de saída mesmo se o Android
tiver suspendido os temporizadores. A política também vale para uma aba do
site deixada em segundo plano e para os formulários de entrada.

O encerramento bloqueia a operação antes de aguardar a gravação do histórico.
O registro final fica na fila do Firebase e sua cópia local é mantida até a
confirmação. Uma sessão anterior recuperada respeita o horário de encerramento
e o limite de segundo plano. O botão e a expiração chegam ao APK existente
pela atualização do site.

## Toque, seleção e movimento (v42)

Na operação, o faceplate abre ao completar um clique ou toque sem arraste.
O clique de seleção é consumido antes de abrir a janela, impedindo que o
mesmo toque acione ABRIR, FECHAR ou outro controle do faceplate. O comando
exige uma nova ação no botão de confirmação. Fechar a janela pelo botão,
por Cancelar ou pela tecla Esc cancela o equipamento pendente.
Pequenas oscilações do dedo são toleradas. Arrastar com o mouse move a tela;
no celular permanece a rolagem pelo dedo. Arraste, rolagem, cancelamento do
gesto e zoom com dois dedos não abrem faceplate. O reconhecimento usa pixels
da tela, independentemente do zoom do diagrama, e acompanha as atualizações
das medições sem perder o equipamento tocado. A edição dos componentes pelo
administrador mantém seus controles de seleção e movimentação.

## Análise interna das manobras (v38)

A janela do operador mostra a confirmação do comando, sem relatório de
caminhos, impedâncias ou identificadores internos. A análise ocorre ao
confirmar cada manobra e considera os terminais, todos os disjuntores e os
conectores entre telas. Transformadores mantêm terminais distintos de
primário e secundário.

O fechamento de um anel energizado sem impedância gera alarme e registra a
manobra no histórico de erros. O simulador calcula as aberturas que desfazem
esse anel e preservam as cargas ativas. Essa condição gera alarme; ela não
abre um disjuntor automaticamente. Um anel desenergizado não gera esse alarme.

Na abertura, o simulador compara a alimentação de cada carga antes e depois
do comando. A presença de um anel não libera todos os disjuntores: um
alimentador fora do anel continua podendo interromper sua carga. A abertura
do secundário de um transformador em paralelo pode transferir a alimentação
para o outro transformador. Se uma manobra causar energização reversa de um
transformador, a proteção do treinamento calcula e abre os disjuntores que
isolam seu secundário, inclusive quando estão em outra tela. A detecção usa
a alimentação independente de cada enrolamento, sem considerar o próprio
transformador como uma fonte no outro lado.

A impedância utiliza Z% dos transformadores e R/X cadastrados nas linhas.
Uma conexão apenas desenhada não recebe impedância de transferência pelos
valores genéricos de exibição. Impedâncias em bases diferentes não são
somadas. Os cálculos de abertura verificam continuidade da alimentação e
energização reversa; não substituem estudo de seletividade, fluxo de carga
ou sincronismo. A presença de impedância não comprova compatibilidade de
tensão, taps, fase ou grupo vetorial. Os monitoramentos de sobrecarga e as
lógicas do Control Building continuam atuando.

No Control Building estão disponíveis as variáveis booleanas **Anel fechado**,
**Paralelismo de transformadores** e **Paralelismo de fontes** para disjuntores
e seccionadoras. Use valor **sim**/**não** em comparação ou transição. Elas
descrevem a ligação com o equipamento fechado. Os alarmes de anel sem
impedância, perda de alimentação de cargas e energização reversa não exigem
criar uma lógica manual. Intertravamentos, condições de manutenção e
inibições de alarme configuradas no Control Building são respeitados.

Para validar sem instalar dependências:

- `npm run check`
- `npm test`

A publicação pelo GitHub Pages executa a validação e os testes antes de enviar
a atualização.
