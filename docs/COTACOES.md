# Cotações e listas de preço

No menu, use **Nova Cotação / Lista**, informe título, cliente, filial, moeda e produtos. Exemplo: “Lista de preço cliente X - Setembro 2026”. Filial é mantida por ser necessária ao cálculo fiscal. Quantidade mantém o comportamento dos pedidos; para lista de preços unitários, informe 1 KG por item.

Transportadora, prazo de pagamento, data de entrega, frete e observações de transporte não são solicitados. A cotação não cria pedido, não envia e-mail e não reserva estoque imediato ou futuro.

Após salvar, consulte **Minhas Cotações** (vendedor) ou **Todas as Cotações** (ADMIN). Pesquise pelo título ou cliente; ADMIN também filtra por nome de vendedor. A listagem é paginada, 25 documentos por página. **Ver itens** consulta o documento salvo e **Baixar PDF** gera um arquivo para envio manual ao cliente.

O PDF apresenta título, referência, data em Brasília, cliente, vendedor, filial, moeda, produtos, quantidades, preços unitários finais, ICMS, IPI, totais e observações gerais. Faixas internas, NET e aprovações internas não são impressos. Valores e nomes são preservados na data da gravação, mesmo que cadastros mudem depois.

Somente o autor ou um ADMIN ativo pode ler a cotação. Um ADMIN pode criar para qualquer carteira; vendedores só criam para sua carteira. A gravação recalcula impostos no servidor com a mesma função dos pedidos, valida preços manuais e impede duplicidade por identificador de envio. Não há alteração/exclusão direta do documento salvo nesta versão; edição, duplicação e conversão em pedido ficam para evolução posterior.

Validação: testes automatizados de permissões, idempotência, valores e validações de entrada; criação/leitura no banco real em transação revertida, sem efeitos em pedidos ou estoque. PDF com múltiplas páginas renderizado e revisado.
