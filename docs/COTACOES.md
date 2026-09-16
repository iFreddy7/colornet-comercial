# Cotações e listas de preço

Em **Nova Cotação / Lista**, informe título, cliente, moeda e produtos. Quantidade é opcional: vazia significa preço unitário, não 1 KG. Sem quantidade em todos os itens, não há total geral; itens com quantidade continuam mostrando seus totais. Nos pedidos, a quantidade permanece obrigatória.

A cotação não solicita nem imprime filial de faturamento. Cada produto usa internamente a origem com **maior saldo imediato disponível**, descontadas as reservas; empate resolvido pelo código da filial. A regra fiscal homologada recebe essa origem e a UF do cliente. A lista pode combinar SC e SP. Previsões futuras não são usadas como estoque imediato. Sem saldo em qualquer origem, é necessário informar NET, final e aprovação manual. As cotações não reservam estoque.

Preencha **NET ou preço final (sem IPI)**: o último campo editado comanda o cálculo. Direto: final = NET / divisor. Inverso: NET = final × divisor. São utilizados os mesmos divisores homologados (4%: 0,8712; 7%: 0,8440; 12%: 0,7986; 18%: 0,7442). NET inverso tem quatro casas decimais e final tem duas; o servidor verifica a consistência do retorno. O inverso também está disponível nos pedidos, respeitando a filial selecionada no pedido. Sem regra/divisor automático válido, os dois preços devem ser informados e aprovados manualmente.

A gravação revalida estoque e impostos. Se a origem/regra/preço mudou desde a inclusão, remova e adicione novamente o item para revisar. Os valores já gravados ficam preservados, sem atualização retroativa.

**Minhas Cotações** mostra documentos do autor; **Todas as Cotações** permite ao ADMIN filtrar por título, cliente e vendedor. **Baixar PDF** gera o documento para envio manual ao cliente com produto/código, NCM, Colour Index quando cadastrado, NET e final, além de quantidades e totais quando informados. NET é exibido com quatro casas para preservar o cálculo inverso. Faixas internas e observações de aprovação não são impressas. Não há envio automático de e-mail.

O banco não possuía Colour Index. O novo campo começa vazio: ADMIN pode cadastrá-lo em **Produtos → Editar Colour Index**, conforme o cadastro técnico do fabricante. Não é inferido do nome, NCM ou código. Novas cotações registram o valor cadastrado; cotações anteriores preservam o documento original.

Validação: testes de origem por saldo líquido, 4/7/12/18%, ida/volta com arredondamento, lista mista com quantidades opcionais, mudança de estoque, permissões, metadados e idempotência. Teste de navegador local com API simulada em `tests/browser/precos.mjs` (Playwright; build de homologação com URL build-validation.invalid e preview na porta 4173). PDF multipágina renderizado para revisão visual.
