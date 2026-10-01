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

## Análise de fechamento (v37)

Ao selecionar um disjuntor ou uma seccionadora aberta como operador, a janela
do comando mostra a análise elétrica prevista: energização, paralelismo de
fontes, paralelismo de transformadores ou fechamento de anel. O caminho
alternativo é procurado com o equipamento comandado aberto, respeitando os
terminais explícitos, o estado dos demais disjuntores e os conectores entre
telas. Transformadores mantêm terminais distintos de primário e secundário.

A impedância utiliza Z% dos transformadores e R/X das linhas configuradas no
modelo; valores padrão são identificados na janela. Impedâncias em bases
diferentes não são somadas. Anel sem impedância significa ausência de
impedância série no modelo. Impedância presente não comprova compatibilidade
da manobra. O estudo não verifica diferença de fase, sequência de fases nem
sincronismo, e não valida tensão, taps ou grupo vetorial para paralelismo.

No Control Building estão disponíveis as variáveis booleanas **Anel fechado**,
**Paralelismo de transformadores** e **Paralelismo de fontes** para disjuntores
e seccionadoras. Use valor **sim**/**não** em comparação ou transição. Elas
descrevem a ligação com o equipamento fechado. A análise, por si só, não cria
alarme, erro ou bloqueio; essas ações continuam configuradas nas lógicas.

Para validar sem instalar dependências:

- `npm run check`
- `npm test`

A publicação pelo GitHub Pages executa a validação e os testes antes de enviar
a atualização.
