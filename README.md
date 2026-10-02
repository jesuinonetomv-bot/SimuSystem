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
