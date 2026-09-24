# Rascunhos e conversão de cotações — homologação

## Comportamento

- Novo Pedido e Nova Cotação salvam automaticamente campos, produtos e identificador de envio no navegador, por até sete dias. A retomada exige escolher Restaurar ou Descartar.
- As chaves são separadas por ambiente, usuário e tipo de documento. Não há sincronização entre dispositivos. Limpar os dados do navegador elimina os rascunhos. Eles não reservam estoque.
- Uma aba com revisão antiga não pode substituir outra revisão nem recriar um rascunho já concluído. O identificador de envio é preservado para evitar duplicidade após uma falha de conexão.
- Cotações válidas podem gerar um pedido após selecionar filial, preencher todas as quantidades, recalcular os impostos e confirmar a revisão. NET e moeda da proposta são preservados; a tributação corresponde à filial do pedido.
- Preços manuais continuam exigindo observação/aprovação. A cotação original permanece íntegra e recebe o vínculo com o pedido.
- O servidor valida usuário ativo, autoria/admin, carteira atual, produtos, validade, prazo/frete e cálculo confirmado. Cotação vencida ou sem validade requer nova proposta.
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
