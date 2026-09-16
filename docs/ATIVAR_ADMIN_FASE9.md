# Ativar cadastro de usuários e relatórios no ADMIN

Esta versão acrescenta “Novo usuário” e “Relatório de pedidos” ao Painel ADMIN.
A instalação no Supabase é feita uma única vez pelo responsável técnico. Depois,
os administradores criam contas e baixam relatórios diretamente pelo portal.

O endereço dos vendedores continua sendo https://colornet-comercial.pages.dev/.

## 1. Instalar as funções do banco

1. Abra o projeto Supabase que já atende o portal.
2. Entre em **SQL Editor → New query**.
3. Abra [202609160001_admin_usuarios_relatorios.sql](../supabase/migrations/202609160001_admin_usuarios_relatorios.sql), copie o conteúdo completo e execute.
4. Aguarde a conclusão sem erro.

O script cria a consulta de relatórios, o provisionamento de perfis e a auditoria.
Não cria contas de teste nem altera pedidos existentes. Pode ser reaplicado.
O banco deve conter as fases 4, 5 e 7 já usadas pelo portal.

## 2. Publicar a função de criação de contas

1. No mesmo projeto, abra **Edge Functions → Deploy a new function → Via Editor**.
2. Use exatamente o nome **admin-criar-usuario**.
3. Substitua o conteúdo de `index.ts` pelo arquivo [index.ts](../supabase/functions/admin-criar-usuario/index.ts) desta versão e publique.
4. Nas configurações dessa função, desative a verificação automática de JWT legado
   (**Verify JWT / Enforce JWT verification**, conforme o painel apresentar).

Essa configuração é específica desta função: o próprio código valida o token com
`auth.getUser` e consulta se o solicitante é um ADMIN ativo. Requisições sem sessão,
de vendedor, gerente ou ADMIN inativo são recusadas. A configuração equivalente
para a CLI está em `supabase/config.toml`.

O TypeScript vai em **Edge Functions**, não no SQL Editor.

| Arquivo | Onde usar |
|---|---|
| `202609160001_admin_usuarios_relatorios.sql` | SQL Editor |
| `supabase/functions/admin-criar-usuario/index.ts` | Editor da Edge Function |

Não coloque chave secreta no Cloudflare nem em variáveis `VITE_`.
A função usa `SUPABASE_URL` e `SUPABASE_SECRET_KEYS` do ambiente Supabase,
com suporte à variável legada `SUPABASE_SERVICE_ROLE_KEY`. As variáveis de servidor
são fornecidas pelo ambiente das Edge Functions.

Alternativa para quem usa a CLI, na raiz do repositório e conectado ao projeto correto:

```sh
supabase functions deploy admin-criar-usuario
```

## 3. Publicar o painel atualizado

Depois dos passos anteriores, integre o pull request desta versão à branch `main`
pelo botão **Merge pull request** no GitHub. O Cloudflare recebe o commit, compila
e publica no endereço habitual. Aguarde o status de sucesso.

As alterações no Supabase não são publicadas pelo Cloudflare: os passos 1 e 2
são necessários mesmo depois de enviar o código ao GitHub.

## 4. Validar pelo portal

1. Abra o endereço estável, atualize a página e entre como ADMIN.
2. Em **Painel ADMIN → Novo usuário**, informe nome, e-mail, perfil, vendedor
   vinculado e uma senha inicial de pelo menos 12 caracteres.
3. O vínculo é obrigatório para VENDEDOR e precisa apontar para um vendedor ativo
   já cadastrado. Libera sua carteira; não transfere clientes de outros vendedores.
4. Crie uma conta de teste sob seu controle. A sessão do ADMIN deve permanecer aberta.
5. Entre com a nova conta em outra janela. Confira carteira, pedidos e ausência
   do Painel ADMIN para quem não é ADMIN.
6. A criação não envia e-mail automaticamente. Informe a senha inicial ao titular.
   Ele pode usar **Esqueci minha senha** para escolher outra senha.
7. Um e-mail já utilizado deve ser recusado, preservando a conta existente.
8. Em **Relatório de pedidos**, escolha os filtros e clique **Baixar Excel (.xlsx)**.
9. Compare um pedido com vários itens e um cancelado. O resumo separa moedas e
   status; o total de cada pedido aparece uma vez na aba Pedidos.
10. Desative a conta de teste quando terminar.

GERENTE mantém as permissões existentes; esta versão não o transforma em ADMIN
nem amplia sua carteira.

## Conteúdo do Excel

| Aba | Conteúdo |
|---|---|
| Resumo | Quantidade e valores separados por moeda e status |
| Pedidos | Cabeçalho completo, cliente, vendedor, filial, prazo, frete e cancelamento |
| Itens | Produtos, quantidades, NET, preço final, ICMS, IPI e observações |
| Historico | Eventos e motivos registrados no pedido |
| Estoque | Movimentos de reserva e estorno imediato |
| Previsoes | Reservas e estornos das entradas futuras |
| Emails | Registros de envio, destinatários e resultados |
| Informacoes | Filtros, instante da consulta e explicação das colunas |

Sem datas, inclui todo o histórico, sem o limite de 100 pedidos da tela.
O período usa dias de Brasília, incluindo o dia inicial e o final completos.
Cadastros associados refletem seu estado atual; preços, impostos e condições
são os valores gravados no pedido. Uma única consulta mantém consistência entre abas.
Relatórios excepcionalmente grandes podem precisar de período menor para respeitar
memória, tempo de consulta e limites do Excel. Não há truncamento silencioso.

## Validação executada

- `npm test`: 25 testes aprovados em Node 24, PostgreSQL local (PGlite) e leitura real dos XLSX.
- `npm run build`: TypeScript e Vite aprovados com configurações fictícias.
- `deno check supabase/functions/admin-criar-usuario/index.ts`: aprovado.
- Auth real e configurações do projeto publicado ainda precisam da conferência
  do passo 4; os testes de Auth usaram um serviço simulado.
- Nenhum usuário real foi criado, nenhum e-mail enviado e nenhum pedido modificado nos testes.

Referências: [criação administrativa de contas](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[editor de Edge Functions](https://supabase.com/docs/guides/functions/quickstart-dashboard),
[autenticação das funções](https://supabase.com/docs/guides/functions/auth),
[variáveis do servidor](https://supabase.com/docs/guides/functions/secrets).
