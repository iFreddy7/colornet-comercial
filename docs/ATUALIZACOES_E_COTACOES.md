# Atualizações, acesso aos dados e próximas funções

## Como entram as atualizações

O GitHub guarda os arquivos e seu histórico. O Cloudflare compila a branch `main`
e publica o portal. O Supabase guarda contas, clientes, produtos, pedidos e regras
do banco.

O fluxo de manutenção é:

1. Preparar a alteração em uma branch e abrir um pull request.
2. Executar os testes e a compilação; conferir as mudanças.
3. Quando houver novas funções ou estruturas no Supabase, instalar primeiro
   alterações compatíveis com a versão atual, preservando o banco existente.
4. Integrar a alteração à `main`.
5. Aguardar a publicação automática do Cloudflare e conferir o portal.

O link dos vendedores continua sendo **https://colornet-comercial.pages.dev/**.
Links com um identificador antes do nome do projeto servem à prévia de uma publicação.

Uma aba aberta continua executando o código que carregou. O vendedor pode concluir
o que está fazendo e atualizar a página para receber a versão nova.
Atualizar o frontend não exclui os pedidos: eles permanecem no Supabase.

Edge Functions e migrações SQL têm publicação própria no Supabase. No fluxo atual,
enviar esses arquivos ao GitHub registra sua versão, mas não os instala no Supabase.
Essa automação pode ser adicionada depois.

Para recuperar uma versão anterior da interface, podemos reverter o commit no
GitHub e publicar novamente. Isso não desfaz migrações ou dados do banco; por isso
as alterações de banco devem manter compatibilidade e ter backup.

Referência: [integração Git do Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/git-integration/).

## Onde ficam os dados dos pedidos

O banco é PostgreSQL no Supabase. O responsável pelo projeto pode consultá-lo em
**Table Editor**, principalmente nas tabelas:

| Tabela | Dados |
|---|---|
| `pedidos` | Número, cliente, vendedor, filial, moeda, condições, totais, status e cancelamento |
| `pedido_itens` | Produtos, quantidades, preços, impostos e observações por item |
| `pedido_eventos` | Histórico das operações registradas |
| `movimentos_estoque` | Reserva e estorno do estoque imediato |
| `movimentos_previsao` | Reserva e estorno das entradas futuras |
| `email_logs` | Resultados dos envios de confirmação |

O administrador do portal usa **Painel ADMIN → Relatório de pedidos → Baixar Excel**
para reunir esses dados. O relatório é somente leitura: não muda pedido ou estoque.

## Aba de cotações — próxima implementação

Podemos acrescentar **Cotações** como uma nova aba do mesmo portal, mantendo login
e endereço. Essa função ainda não foi implementada nesta versão.

Ela pode reutilizar clientes, vendedores, produtos, preços e cálculo fiscal já
homologado. Terá suas próprias tabelas (`cotacoes` e `cotacao_itens`), numeração,
validade, observações, histórico e permissões por vendedor/ADMIN.

Sequência de implementação:

1. Criar, editar e duplicar rascunhos; consultar histórico por vendedor.
2. Registrar validade e status: rascunho, enviada, aceita, expirada ou cancelada.
3. Gerar PDF e enviar a cotação, preservando conteúdo e preços de cada versão.
4. Converter a cotação aprovada em pedido, registrando o vínculo entre ambos.

A cotação não reserva estoque por si só. Na conversão, o sistema consulta a
disponibilidade atual e cria o pedido pelas funções de reserva já utilizadas.
Essa conversão precisa impedir duplicidade e conferir preços/regras quando a
cotação estiver vencida. O tratamento de condições negociadas e validade será
definido antes dessa etapa, sem alterar automaticamente acordos aprovados.

Outras evoluções possíveis: acompanhamento de faturamento, anexos de ordens de
compra, gráficos comerciais e instalação como aplicativo (PWA).
