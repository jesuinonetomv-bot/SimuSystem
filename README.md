# SimuSystem Web

Protótipo vetorial e responsivo do simulador de manobras do sistema elétrico.

## Curto-circuito ANSI / IEC (v46)

Em **Estudos → Curto-circuito · ANSI / IEC**, configure casos de falta trifásica
nas barras do estado atual ou em um exemplo independente. O painel reúne
Configuração, Fontes, Ajustes, Alertas e Resultados. Casos são salvos localmente
por modelo; JSON transfere os parâmetros entre aparelhos. CSV e o relatório
copiado incluem parâmetros, pendências, hipóteses, contribuições e correntes
dos ramos. O navegador também oferece impressão; o WebView usa cópia de texto.

IEC: condições máxima, mínima e `c` personalizado; tolerância BT de 6%/10%;
correções opcionais K_T/K_G das equações de referência IEC 60909-0:2016.
A impedância da rede externa inclui seu fator `c`, preservando o MVA de curto
informado na própria barra. O mínimo exige MVA e X/R mínimos da concessionária
e temperatura final quando há resistência de linha. R cadastrada é referida
a 20 °C e corrigida por `1 + 0,004 × (temperatura − 20)` somente no mínimo.

ANSI: rede de ½ ciclo, rede de 1,5–4 ciclos e rede de 30 ciclos. Geradores
síncronos usam X″d nos dois primeiros períodos e X′d no último; a resistência
derivada de X″d/X/R é mantida. X/R é calculado com redes R e X separadas.
O nominal conserva `c = 1`, sem correções IEC. Neste módulo, os transformadores
usam a relação nominal. O cálculo antigo permanece disponível como API de
compatibilidade, com suas hipóteses originais.

Fontes podem seguir a operação, participar ou ficar fora apenas no caso; isso
não fecha contatos. Ajustes usam uma cópia e não comandam dispositivos. Dados
necessários ausentes impedem o cálculo da ilha correspondente, sem impedâncias
ou capacidades arbitrárias. Correntes das fontes são somadas como fasores na
base da barra de falta; a corrente local também aparece. Ramos mostram ambos
os lados, com conversão de tensão nos transformadores.

Pico, componente DC, RMS assimétrica e corrente térmica são **estimativas do
equivalente R-L com AC constante**, pelo pior ângulo de início. O pico maximiza
a envoltória no primeiro ciclo; DC e RMS usam o tempo escolhido e o efeito
térmico é integrado na duração informada. Não são fatores ANSI MFi/NACD nem
correntes de interrupção IEC normativas. Capacidades simétrica/de pico das
barras recebem comparação preliminar; o mínimo IEC e os períodos ANSI de
interrupção/30 ciclos não avaliam a capacidade momentânea. Correntes individuais
de disjuntores fundidos em contatos ideais não são determinadas.

Escopo: sequência positiva, fontes síncronas/rede externa, linhas e
transformadores de dois enrolamentos. Sem motores, inversores, K_S de unidades
gerador-transformador, decaimento AC, faltas desequilibradas, aterramento ou
certificação integral ANSI/IEC, incluindo IEC 60909-0:2026.
O exemplo foi criado com valores didáticos próprios; os PDFs de referência
não são distribuídos no repositório.

## Casos de estudo e temas (v45.1)

Em **Exibição → Tema do unifilar**, selecione ETAP · AC, SimuSystem · clássico
ou personalize as cores. O padrão AC usa preto para energizado, cinza para
desenergizado, vermelho para seleção/alarmes e magenta para atenção. Aberto
continua identificável pelo contato e símbolo vazados. Manutenção tem cor
própria e mantém seus sinais. A prévia só é conservada ao clicar em **Salvar
tema**; fechar a janela restaura o tema salvo neste aparelho.

Em **Estudos → Fluxo de carga**, a janela reúne Configuração, Cargas, Geração,
Alertas e Resultados. Os casos são salvos por diagrama, neste aparelho; o JSON
pode ser copiado, baixado e importado em outro dispositivo. Cada caso usa a
topologia e os contatos atuais sobre uma cópia: não comanda equipamentos nem
altera os dados da operação. O exemplo didático de três barras é separado do
sistema publicado e nunca pode ser aplicado ao unifilar da operação.

Fatores globais/individuais multiplicam demanda e geração do momento. É
possível estudar variação de tap e fatores de R/X das linhas cadastradas.
Geradores aceitam Auto, PQ (P/Q fixos), PV (controle de tensão) e Referência.
PV calcula Q e, quando atinge limites reativos cadastrados, passa a PQ no
estudo e resolve novamente o fluxo. Auto conserva o comportamento anterior:
P/Q fixos com rede externa e uma referência na ilha de geradores. Referência
balanceia a ilha, portanto seus MW/MVAr resultantes não são os programados.
Não há despacho ótimo, curva completa de capacidade, controle de frequência
ou limitação automática do gerador de referência; violações cadastradas são
apresentadas nos alertas. Controles PV não mudam o estudo de curto trifásico.

Resultados incluem tensão em kV/%, ângulo, P/Q líquido das barras, fluxo,
corrente em cada lado do ramo e perdas ativas/reativas. Sobrecarga de TF usa
o maior MVA das pontas / MVA nominal; linhas usam a maior corrente / ampacidade
cadastrada. Geradores usam MVA calculado / MVA nominal. Limites ausentes,
fontes ideais no mesmo nó, ilhas sem fonte e hipóteses aparecem como pendentes.
Os limites iniciais de alerta são exemplos editáveis. Resultados sem
convergência são provisórios e não podem ser mostrados no unifilar.

Há relatório CSV, cópia do relatório e impressão/PDF no navegador. No APK,
CSV/JSON são exportados por cópia de texto; para download/PDF use o navegador.
Antes de aplicar ou exportar um cálculo, o programa confere se o modelo e os
parâmetros continuam iguais. Cálculos aplicados saem do unifilar quando o
estado muda. Alertas de estudo apenas destacam os equipamentos; não geram
manobras, disparos ou erros no histórico do operador.

Referências de implementação de controles PV/PQ e limites reativos:

- [MATPOWER — runpf e conversão de PV para PQ](https://matpower.org/docs/ref/matpower7.1/lib/runpf.html)
- [pandapower — fluxo AC, modelos e limites](https://pandapower.readthedocs.io/en/stable/powerflow/ac.html)

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

## Bancada de modelagem, operação e estudos (v44)

Apresentação inspirada em ferramentas de estudos elétricos: fundo claro,
condutores finos, barramentos destacados, símbolos compactos, TAGs e dados
nominais em azul, medições em vermelho. A posição dos terminais e as conexões
existentes são preservadas. Em **Exibição**, escolha medições compactas,
completas ou ocultas e ligue/desligue os dados nominais de fontes e transformadores. O diagrama continua
livre de botões sobrepostos.

A navegação superior reúne **Modelagem**, **Operação** e **Estudos**.
Modelagem exige o acesso de administrador e mantém as ferramentas de
inserção, conexão e edição. Operação permite iniciar o treinamento e abrir
faceplates; a troca de administrador para operador passa pelo botão **Sair**.
Estudos são somente leitura e não concedem acesso a comandos ou edição.

**Fluxo de carga AC:** Newton-Raphson, Gauss-Seidel e desacoplado rápido
(indicado para redes com X/R alto). O modelo agora reutiliza o grafo de
terminais das manobras, incluindo contatos abertos e conectores entre abas.
Não cria uma fonte em ilhas desligadas. Z% dos transformadores é convertido
para a potência-base do estudo; o tap e a corrente do enrolamento primário
entram no cálculo das perdas. Geradores têm P/Q prescritos, salvo a fonte de
referência da ilha. A v45 acrescenta controle PV e limites reativos configurados. Valores não
convergidos são identificados e não podem ser aplicados ao unifilar.

**Curto trifásico:** corrente inicial simétrica nas barras pela impedância
Thevenin de sequência positiva, obtida da inversa da matriz de admitâncias.
Cadastre o MVA de curto da rede e X/R; para geradores, potência nominal,
X″d (%) e X/R. A contribuição do gerador usa X″d como reatância. Todas as
fontes em operação na ilha precisam ter dados válidos. Dados ausentes
aparecem como pendentes; uma fonte desconhecida não é simplesmente excluída.
São considerados c = 1 e tensão nominal pré-falta, sem motores, impedância
de falta, componente contínua ou correções IEC de equipamentos. Não é um
estudo IEC 60909 completo e não fornece corrente de pico/interrupção.

**Curvas de proteção:** comparação genérica tempo × corrente em escala
logarítmica. Curvas IEC inversa normal, muito inversa, extremamente inversa
e tempo definido, com TMS, elemento instantâneo e tempo do disjuntor.
Os ajustes podem ser manuais (os valores iniciais são exemplos) ou
cadastrados nos dados elétricos dos disjuntores. A margem é B − A na
corrente de avaliação, com ambas as correntes primárias referidas ao mesmo
lado. Não inclui tolerâncias, TC ou divisão de corrente, não certifica
seletividade da rede e não dispara equipamentos na operação.

Os relatórios indicam hipóteses e dados padrão utilizados. R/X não
cadastrados numa linha desenhada significam conexão ideal; X/R padrão do
transformador/fonte é 10 e fica identificado quando não foi salvo.
**Mostrar no unifilar** aplica as tensões AC ou correntes de curto somente
à visualização local. Os resultados são retirados quando o estado do modelo
muda, para não mostrar um cálculo antigo como atual.

Referências dos métodos:

- [Diagrama unifilar e DataBlocks — ETAP](https://etap.com/product/electrical-single-line-diagram)
- [Curvas IEC inversas — Schneider Electric](https://productinfo.se.com/advc-operationsmanual/pkr39809_advc_operations-manual/English/BM_ADVC3%20Operations%20Manual_0000999204.xml/$/TPC_ADVC3_OM_AppendixDIEC255InverseTimeTablesCPT_0001060607)
- [Fonte equivalente e corrente de curto — documentação pandapower](https://pandapower.readthedocs.io/en/v3.1.1/shortcircuit/ikss.html)

Esses módulos são para treinamento, com as simplificações acima; não
representam equivalência ao ETAP nem validação para projeto elétrico.
A atualização chega ao site e ao APK existente pela versão web.

## Tela livre e opções de exibição (v43)

O diagrama fica sem botões ou legenda sobre os equipamentos. Na barra
superior, **Exibição** abre as opções de zoom, ajuste à tela, legenda e fluxo
animado. Feche essa janela para voltar ao diagrama livre. O zoom com dois
dedos continua disponível no celular. As mensagens ficam em uma faixa fora
da área do diagrama; os controles de cenário da engenharia também ficam em
**Exibição**. A mudança chega ao site e ao APK existente pela atualização web.

## Fluxo animado no unifilar (v41)

O botão **Fluxo animado**, em **Exibição**, liga e desliga as setas no próprio
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
