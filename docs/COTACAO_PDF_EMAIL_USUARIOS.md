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

## Identidade visual e faturamento — 25/09/2026

- PDF: título da coluna `Produto`, quadro de faturamento à esquerda e cliente à direita. Azul `#19337f`, vermelho `#c91943` e verde `#069b61` acompanham a identidade do portal.
- As unidades exibem razão social, CNPJ, inscrição estadual, endereço e CEP da ficha cadastral de 27/05/2025 fornecida pela ColorNet. A identificação pública fica em `src/lib/filiaisFaturamento.ts`, associada ao código da unidade (0101 Matriz-SP, 0102 Filial-Itajaí, 0103 Filial-Mauá), nunca ao código da regra fiscal.
- O PDF consulta `filiais` com a sessão do usuário para resolver os IDs de cada ambiente. Cotações com mais de uma origem mostram as unidades no quadro e a filial correspondente em cada item. Origem ausente continua como “A confirmar”. Dados e preços da cotação permanecem intactos.
- E-mails de aprovação/reprovação seguem as mesmas cores, preservando `Aprovado por` / `Recusado por`, motivo e destinatários. A mudança é apenas visual.
- Os modelos `cotacao-confirmacao` e `pedido-confirmacao` também foram alinhados no código. Essas duas funções não estão implantadas na homologação; seus envios seguem desabilitados nesse ambiente. Publicá-las na produção faz parte da promoção futura, com a configuração existente do gateway.
- Sem migração de banco. Nesta etapa, publicar apenas o frontend e `cotacao-decisao-email` na homologação. A função mantém `verify_jwt=false` e sua autenticação interna com `getUser` e validação de Gerente/Diretor ativo.

Validação: 114 testes, TypeScript e build; conferência visual de PDF real, cotações com três unidades e sete páginas; prévias locais dos e-mails aprovado/reprovado, sem novos disparos. O PDF preserva quantidades ausentes e totais existentes.
