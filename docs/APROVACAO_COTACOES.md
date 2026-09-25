# Relatório e avaliação de cotações

Gerente e Diretor ativos podem aprovar ou reprovar propostas ainda não convertidas. O motivo da reprovação é obrigatório (até 2000 caracteres). A decisão fica imutável, com autor e data. Para revisar uma proposta reprovada, emita uma nova cotação com as condições corrigidas. ADMIN continua acessando os relatórios, sem assumir o papel de aprovador.

A conversão em pedido exige situação APROVADA no servidor. Cotações antigas ainda não convertidas começam PENDENTE; pedidos já gerados são preservados, inclusive a repetição idempotente da conversão. A avaliação não reserva estoque.

Em Relatórios, a exportação de cotações aceita período de emissão (Brasília), vendedor, cliente e situação. O Excel contém Resumo, Cotacoes, Itens e Informacoes. Moedas e situações são somadas separadamente; listas unitárias sem quantidade mantêm total nulo. A consulta usa uma resposta JSON única para evitar o corte padrão de mil linhas do PostgREST.

## Avisos

Cada decisão cria uma única entrada na fila privada dentro da mesma transação. Após registrar a decisão, a interface solicita o envio à Edge Function `cotacao-decisao-email`. Os destinatários são obtidos no servidor: e-mail cadastrado em vendedores, jrodrigues@colornet.com.br e marcia@colornet.com.br, sem duplicação. Nenhum destinatário, HTML ou decisão é aceito do navegador.

A autenticação é feita por `auth.getUser` e consulta do perfil ativo no banco em cada envio. A reserva revalida o perfil e usa bloqueio da cotação, token por tentativa e intervalo mínimo de 30 segundos. Somente service_role executa as operações da fila. JWT inválido, vendedor, ADMIN e perfil inativo não enviam decisões.

Configure, exclusivamente nos Secrets da Edge Function:

- `COTACOES_SMTP_USER`: Gmail remetente completo.
- `COTACOES_SMTP_PASSWORD`: senha de app dessa conta (não a senha comum).

O transporte usa smtp.gmail.com, porta 465 com TLS e validação de certificado. Não há senha no código, no navegador ou nos logs. A configuração do Supabase Auth é independente. Homologação identifica os avisos no assunto com [HOMOLOGAÇÃO].

Implante com autenticação própria (`verify_jwt=false`): o corpo valida a sessão com Supabase Auth e as permissões no banco. Isso também permite o diagnóstico com a secret key moderna do próprio projeto, enviada pelo painel Supabase, sem JWT legado. O diagnóstico aceita apenas `{"acao":"verificar_smtp"}`, verifica a conexão e não envia mensagens. A chave de serviço não pode usar essa rota para aprovar cotações.

Sucesso de SMTP significa aceitação pelo servidor de e-mail, não confirmação de leitura ou entrega na caixa de entrada. Falhas explícitas permitem reenviar apenas aos destinatários ainda não aceitos. Resultado incerto ou execução interrompida há mais de cinco minutos exige conferir o recebimento antes de qualquer intervenção administrativa na fila. Nunca reinicie uma tentativa incerta automaticamente.

A interface mostra os avisos pendentes e permite que Gerente/Diretor tente novamente. A fila permanece gravada se o navegador fechar entre a decisão e o envio; não há processador periódico nesta versão. A decisão permanece salva em todos esses casos.

## Validação e implantação

As migrações `20260925150228_aprovacao_relatorio_cotacoes.sql` e `20260925150446_exigir_aprovacao_conversao.sql` foram aplicadas apenas no projeto de homologação nqyddagfawklfqwumlie. Os nomes foram exportados com as versões geradas pelo Supabase; o executável local do CLI falhou por permissão no diretório de configuração. Produção e main permanecem fora desta implantação.

Testes cobrem autorização, motivo, imutabilidade, idempotência, fila, envio parcial/incerto, origem dos destinatários, HTML escapado, relatório com mais de mil propostas, Excel e bloqueio de conversão sem pedido/reserva. A verificação visual usa dados fictícios sem chamadas externas. A validação final de recebimento deve ser feita com uma cotação de teste avaliada por Gerente/Diretor.

A fila privada tem RLS sem política deliberadamente (nega acesso direto). Avisos prévios do Advisor sobre extensões no schema public, funções legadas e proteção de senhas não foram alterados. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.

Em 25/09/2026, o diagnóstico remoto retornou HTTP 200, configurado=true e conexao=true após o responsável cadastrar uma nova senha de app. Esse diagnóstico não enviou e-mail; o recebimento real ainda depende da avaliação de uma cotação de teste por Gerente/Diretor.
