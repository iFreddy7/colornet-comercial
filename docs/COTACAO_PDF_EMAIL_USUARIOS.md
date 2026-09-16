# Cotação — PDF, confirmação interna e vendedores Protheus

## Implementado

- PDF com cabeçalho **COTAÇÃO**.
- Preço NET e Preço Final separados no PDF.
- Validade da proposta no formulário, snapshot e PDF.
- Prazo de pagamento no formulário, snapshot e PDF.
- Confirmação interna **Cotação Incluída** com corpo detalhado e PDF anexo.
- Destinatário principal: vendedor responsável.
- Cópias padrão do gateway: `jrodrigues@colornet.com.br` e `marcia@colornet.com.br`.
- Edge Function `cotacao-confirmacao`, protegida por JWT e com log/idempotência.
- Cadastro de vendedor Protheus pelo Painel ADMIN para casos em que o ERP possui o vendedor, mas o portal ainda não.
- Nova RPC `criar_cotacao_v3` com validação server-side de validade e prazo.

## Banco / Supabase

Migration: `20260916183000_cotacao_validade_prazo_email_v3.sql`

Adiciona:
- `cotacoes.validade`
- `cotacoes.prazo_pagamento_id`
- `email_logs.cotacao_id`
- RPC `public.criar_cotacao_v3`
- RPC `public.admin_cadastrar_vendedor`

## Passo manual obrigatório — Gmail / Apps Script

O Web App do Apps Script que hoje envia confirmação de pedidos precisa aceitar também a ação de cotação e anexos PDF.

Use o arquivo:

`docs/EMAIL_GATEWAY_PEDIDOS_COTACOES.gs`

Substitua o código do gateway atual por esse arquivo e publique **uma nova versão do Web App**, mantendo a mesma URL de implantação se possível.

Script Properties esperadas:

- `GMAIL_BRIDGE_SECRET` — manter o mesmo segredo já usado pelo Supabase.
- `EMAIL_CC_PEDIDOS` — pode manter o valor atual.
- `EMAIL_CC_COTACOES=jrodrigues@colornet.com.br,marcia@colornet.com.br`
- `EMAIL_REPLY_TO=jrodrigues@colornet.com.br` (ou outro endereço aprovado).

Depois do redeploy, a função `cotacao-confirmacao` enviará o PDF por esse gateway.

## Teste recomendado

1. Cadastrar um vendedor de homologação pelo Painel ADMIN, se necessário.
2. Criar cotação com validade e prazo.
3. Inserir um item com quantidade e um sem quantidade, se quiser validar ambos os formatos.
4. Salvar a cotação.
5. Conferir o e-mail do vendedor + João + Márcia.
6. Conferir o PDF anexo: NET, Final, validade, prazo e cabeçalho COTAÇÃO.
7. Conferir `email_logs` com `tipo=CONFIRMACAO_COTACAO` e `status=ENVIADO`.

## Observação de implantação

O banco e a Edge Function podem ser aplicados independentemente do frontend. O frontend deve ser publicado somente após homologação visual/funcional do branch.
