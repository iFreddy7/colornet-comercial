# Cadastro de clientes por e-mail

Enviar exatamente um anexo XLSX para comercial.colornet@gmail.com com assunto `Cadastro de clientes`.
Remetentes autorizados: jrodrigues@colornet.com.br e marcia@colornet.com.br.
O gatilho existente do Apps Script verifica os e-mails a cada hora. Não é necessário publicar o frontend.

## Contrato do arquivo

Layout Protheus da planilha clientes 09.11.xlsx. Código na coluna B, loja na C e vendedor obrigatoriamente na AD (cabeçalho Vendedor). O código é vinculado a vendedores.codigo_protheus ativo. Abas idênticas são consolidadas; conflitos para o mesmo código/loja bloqueiam o arquivo inteiro. Códigos/lojas diferentes não são mesclados por CNPJ.

Vendedor vazio preserva a carteira de cliente existente. Novo cliente precisa de vendedor. Código de vendedor desconhecido/inativo bloqueia a importação. Ausência de cliente no arquivo não o exclui. Status Inativo desativa cadastro existente, sem apagar histórico.

Atualiza nome, endereço, contato, carteira e os campos fiscais suportados pelo portal. A leitura fiscal usa CNPJ/CPF (A), Tipo (I), Estado (J), IE (AA), País (AB), SUFRAMA (BN), desconto SUFRAMA (CE), grupo de clientes (CG), município de Zona Franca (CZ) e indicador Contribuinte (FF). Complemento vem de DP. Os cabeçalhos fiscais são obrigatórios para impedir deslocamento de colunas.

Por determinação do usuário em 09/11, `Cons.Final` é tratado como `Revendedor`, inclusive na atualização de clientes existentes. Não se aplica essa conversão às exportações. Contribuinte explicitamente `Nao` impede cálculo automático; indicador vazio utiliza presença de IE, conforme o critério já utilizado no cadastro comercial. CNPJ/CPF tem dígitos verificadores conferidos; IE é verificada quanto ao preenchimento/formato, sem consulta cadastral à SEFAZ.

Cadastros com documento válido, UF nacional, IE, contribuinte e tipo reconhecido são habilitados automaticamente. Exportação, falta de IE, documento inválido, Zona Franca/SUFRAMA e tipos não reconhecidos permanecem manuais, com motivo registrado. Restrições manuais personalizadas preexistentes são preservadas. As validações do produto e da operação continuam no motor fiscal do portal.

## Segurança e operação

O endpoint ingest-email-xlsx exige x-ingest-secret e rejeita configuração sem segredo. A operação CLIENTES valida também o remetente. A função aplicar_clientes_email é exclusiva de service_role, com SECURITY INVOKER e search_path vazio. O payload nunca é enviado pelo frontend.

Cada aplicação cria snapshot de todos os clientes em private.clientes_email_backups, na mesma transação. Reenvio com o mesmo email_id não reaplica. E-mail anterior ao último aplicado é rejeitado. Erro cancela o arquivo inteiro. Limites: 15 MB e 10.000 clientes únicos.

A ponte Apps Script mantém IMPORT_APPLY_CLIENTES=true, reconhece o assunto, exige um único XLSX e oferece testarClientesPorEmail (simulação) e aplicarClientesAgora (aplicação isolada). As demais integrações mantêm suas flags. Registros de resultado ficam em integracao_execucoes, tipo CLIENTES. Não há e-mail automático de confirmação nesta versão.

## Validação em 09/11/2026

Parser: testes sintéticos para AD, zeros, duplicatas, conflitos, lojas distintas e entradas inválidas; arquivo real: 1.153 clientes únicos e 2.306 repetições idênticas entre abas. Banco: aplicação em transação revertida, idempotência, vendedor inválido, arquivo antigo e permissões verificados.

Aplicação inicial: 2 novos, 508 cadastros atualizados, 2 carteiras alteradas, 10 vínculos preservados por AD vazia. BERNARDI E SOUTO (53844444/0001) foi vinculado a Francisco (000014) por instrução explícita do usuário, pois AD estava vazia. Backup inicial: clientes-0911-validado.

A função de ingestão foi baseada no código efetivamente publicado (v29), preservando correções de estoque/previsão que ainda não constavam no arquivo do repositório.

Complemento fiscal: 43 cadastros ajustados; 1.107 habilitados e 46 manuais (31 exportação, 10 sem IE, 4 Zona Franca/SUFRAMA, 1 documento inválido). WECKERLE Mogi e BERNARDI E SOUTO testados com cálculo automático nas duas filiais ativas. Novos cadastros testados em transação revertida; seis testes do leitor/parser/regras fiscais aprovados. A mesma classificação é aplicada nas próximas importações.
