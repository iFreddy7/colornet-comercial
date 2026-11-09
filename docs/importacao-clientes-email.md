# Cadastro de clientes por e-mail

Enviar exatamente um anexo XLSX para comercial.colornet@gmail.com com assunto `Cadastro de clientes`.
Remetentes autorizados: jrodrigues@colornet.com.br e marcia@colornet.com.br.
O gatilho existente do Apps Script verifica os e-mails a cada hora. Não é necessário publicar o frontend.

## Contrato do arquivo

Layout Protheus da planilha clientes 09.11.xlsx. Código na coluna B, loja na C e vendedor obrigatoriamente na AD (cabeçalho Vendedor). O código é vinculado a vendedores.codigo_protheus ativo. Abas idênticas são consolidadas; conflitos para o mesmo código/loja bloqueiam o arquivo inteiro. Códigos/lojas diferentes não são mesclados por CNPJ.

Vendedor vazio preserva a carteira de cliente existente. Novo cliente precisa de vendedor. Código de vendedor desconhecido/inativo bloqueia a importação. Ausência de cliente no arquivo não o exclui. Status Inativo desativa cadastro existente, sem apagar histórico.

Atualiza nome, endereço, contato e carteira; não sobrescreve a configuração fiscal de clientes existentes. Novos clientes entram com cálculo fiscal manual até conferência. As colunas fiscais não devem ser inferidas apenas pelo nome do cliente.

## Segurança e operação

O endpoint ingest-email-xlsx exige x-ingest-secret e rejeita configuração sem segredo. A operação CLIENTES valida também o remetente. A função aplicar_clientes_email é exclusiva de service_role, com SECURITY INVOKER e search_path vazio. O payload nunca é enviado pelo frontend.

Cada aplicação cria snapshot de todos os clientes em private.clientes_email_backups, na mesma transação. Reenvio com o mesmo email_id não reaplica. E-mail anterior ao último aplicado é rejeitado. Erro cancela o arquivo inteiro. Limites: 15 MB e 10.000 clientes únicos.

A ponte Apps Script mantém IMPORT_APPLY_CLIENTES=true, reconhece o assunto, exige um único XLSX e oferece testarClientesPorEmail (simulação) e aplicarClientesAgora (aplicação isolada). As demais integrações mantêm suas flags. Registros de resultado ficam em integracao_execucoes, tipo CLIENTES. Não há e-mail automático de confirmação nesta versão.

## Validação em 09/11/2026

Parser: testes sintéticos para AD, zeros, duplicatas, conflitos, lojas distintas e entradas inválidas; arquivo real: 1.153 clientes únicos e 2.306 repetições idênticas entre abas. Banco: aplicação em transação revertida, idempotência, vendedor inválido, arquivo antigo e permissões verificados.

Aplicação inicial: 2 novos, 508 cadastros atualizados, 2 carteiras alteradas, 10 vínculos preservados por AD vazia. BERNARDI E SOUTO (53844444/0001) foi vinculado a Francisco (000014) por instrução explícita do usuário, pois AD estava vazia. Backup inicial: clientes-0911-validado.

A função de ingestão foi baseada no código efetivamente publicado (v29), preservando correções de estoque/previsão que ainda não constavam no arquivo do repositório.
