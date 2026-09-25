# Rascunhos e conversão de cotações — homologação

## Comportamento

- Novo Pedido e Nova Cotação salvam automaticamente campos, produtos e identificador de envio no navegador, por até sete dias. A retomada exige escolher Restaurar ou Descartar.
- As chaves são separadas por ambiente, usuário e tipo de documento. Não há sincronização entre dispositivos. Limpar os dados do navegador elimina os rascunhos. Eles não reservam estoque.
- Uma aba com revisão antiga não pode substituir outra revisão nem recriar um rascunho já concluído. O identificador de envio é preservado para evitar duplicidade após uma falha de conexão.
- Cotações aprovadas e válidas abrem a conversão com cliente, vendedor, moeda, prazo, frete, observações, itens e quantidades preenchidos. A filial vem do cabeçalho ou da origem única dos itens, quando ativa. Origem ausente/mista exige seleção; quantidades ausentes exigem preenchimento. Entrega e transportadora são opcionais e só são preenchidas se existirem no documento.
- NET, preço final, IPI e metadados fiscais são copiados exclusivamente do documento aprovado no banco, sem consultar as regras atuais de preço. Valores e justificativas manuais já aprovados são preservados. A cotação original permanece íntegra e recebe o vínculo com o pedido.
- O servidor valida usuário ativo, autoria ou perfil de gestão, aprovação, carteira atual, produtos, validade e prazo/frete. Proposta vencida ou sem os preços/impostos necessários requer nova proposta. Uma tela antiga com recálculo diferente exige atualizar a página antes de confirmar.
- A criação usa as rotinas existentes de reserva imediata e futura. Repetir a conversão retorna o pedido já vinculado, sem movimentar estoque novamente. Cancelar o pedido não libera uma segunda conversão da mesma cotação.
- Pedidos restaurados conferem os preços antes do envio. Mudanças no cálculo exigem nova revisão.

## Aplicação e validação

Aplicado apenas ao Supabase de homologação `nqyddagfawklfqwumlie`:

1. `20260924121003_converter_cotacao_pedido.sql`.
2. `20260924121618_restore_commercial_rpc_execute.sql`.

A segunda migração corrige permissões preexistentes nas chamadas de cálculo e criação de cotação. Os wrappers públicos permanecem SECURITY INVOKER, com referências privadas resolvidas na criação. As implementações conferem identidade ativa e carteira; o schema privado não recebe USAGE para authenticated e anon não recebe EXECUTE.

Validação em 24/09/2026:

- 71 testes automatizados passaram; compilação TypeScript e build passaram.
- Teste transacional no banco de homologação criou cotação pela RPC v4, converteu, repetiu a conversão e verificou vínculo/idempotência. A subtransação foi desfeita; contagens de pedidos e movimentos de estoque permaneceram iguais. A sequência de numeração pode avançar durante testes mesmo com rollback.
- Navegador com API simulada: campos restaurados após recarga, revisão da conversão preservada ao sair/voltar, quantidade obrigatória, edição invalida confirmação, criação concluída, sem erros de console.
- O verificador de segurança não encontrou novos avisos após as migrações. Permanecem avisos anteriores sobre extensões em public, wrappers legados e proteção contra senhas vazadas; não foram alterados por este pacote.

## Liberação

Destino deste pacote: branch `homologacao`. `main` e produção permanecem separados.

Antes de promover para produção, validar o pacote na interface publicada, concluir o aceite do convite de acesso com o usuário e preparar as migrações/configurações de Auth e SMTP do ambiente de produção. A recuperação e o login já foram confirmados pelo usuário na homologação; o novo convite ainda aguarda confirmação humana.

O endereço de produção continua `https://colornet-comercial.vercel.app/`; o domínio corporativo exige DNS da empresa e não faz parte desta entrega.

## Correção de 25/09/2026 — preços aprovados

- Migração: `20260925162819_preservar_cotacao_aprovada_no_pedido.sql`, aplicada somente na homologação.
- As três rotinas privadas `criar_pedido_cotacao*` preservam as mesmas reservas imediatas/futuras e idempotência da criação v3/v4. Mudanças futuras de alocação devem ser sincronizadas entre essas rotinas e as de pedidos comuns. Nenhuma delas é executável diretamente por anon/authenticated.
- As rotinas de pedidos comuns não foram alteradas. A única entrada de conversão continua validando a cotação aprovada e usando seu ID como chave.
- Rascunhos antigos permanecem disponíveis; campos antigos de preço não substituem o documento aprovado. Filial vazia do rascunho aproveita a origem da proposta.
- E-mail da decisão: “Aprovado por: usuário” ou “Recusado por: usuário”, tanto em texto quanto HTML. Função da homologação atualizada sem reenviar decisões anteriores.
- Validação: 109 testes, TypeScript e build passaram. Navegador simulado confirmou preenchimento, restauração, invalidação da confirmação ao editar e criação sem chamada de recálculo.
- Teste transacional real preservou 2.500 KG, NET USD 8,05, final USD 9,24 e total USD 23.100,00. Repetição retornou o mesmo pedido. Rollback confirmado: pedidos 11, itens 8, movimentos imediatos 9, futuros 4 e chaves 11 antes/depois; a sequência de numeração avançou uma posição. Cotação de teste segue disponível para conversão.
- Verificador de segurança sem novas ocorrências; hashes das rotinas comuns iguais antes/depois. Produção não alterada.
