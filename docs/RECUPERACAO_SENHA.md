# Recuperação de senha

## Ambientes separados

| Ambiente | Branch | Supabase | Portal estável |
| --- | --- | --- | --- |
| Produção | main | duojavyrugezvlvuuwag | https://colornet-comercial.vercel.app |
| Homologação | homologacao | nqyddagfawklfqwumlie | https://homologacao.colornet-comercial.pages.dev |

Na Vercel: Production deve publicar somente main com PRODUCAO e o Supabase de produção; Preview deve usar HOMOLOGACAO e o Supabase de homologação. Use o alias estável da branch homologacao, confirmado no painel, em vez de um endereço temporário de commit. Não use o domínio corporativo até confirmar DNS e HTTPS. As validações existentes de build e cliente continuam ativas.

## Configuração obrigatória no Supabase Auth, em cada projeto

1. Em Authentication → URL Configuration, use como **Site URL** o portal HTTPS estável desse ambiente, sem localhost. Não copie a URL de produção para homologação.
2. Em **Redirect URLs**, adicione a URL exata do portal com `/?recovery=1`: `https://homologacao.colornet-comercial.pages.dev/?recovery=1` na homologação; `https://colornet-comercial.vercel.app/?recovery=1` na produção. Autorize separadamente o alias HTTPS estável da Vercel se ele também for utilizado. Preserve URLs antigas em uso durante a transição. Evite curingas amplos.
3. Publique e valide primeiro o novo frontend. Somente depois configure **Reset password** com o conteúdo de `supabase/templates/recovery.html`. O template usa RedirectTo e TokenHash, nunca uma URL fixa de localhost. Requests do portal sempre enviam RedirectTo. Para disparos manuais pelo painel, informe explicitamente o redirect do ambiente ou use o fluxo do portal.
4. Configure também **Invite user** com `supabase/templates/invite.html`. Convites usam SiteURL (o portal estável do próprio projeto) e TokenHash com `type=invite`; funcionam pelo painel mesmo sem RedirectTo. Manter o convite padrão com ConfirmationURL ainda permite que verificadores automáticos consumam o link antes do usuário. Convites antigos não são alterados: emita um novo para uma conta ainda não confirmada; contas já confirmadas devem usar recuperação.
5. Verifique o SMTP e a expiração configurada do token. Não aumente a validade para tentar mascarar links já consumidos. Desabilite o rastreamento de links no provedor SMTP.
6. Na função administrativa `admin-gerar-link-senha`, APP_URL opcional deve ser a origem HTTPS estável do mesmo ambiente. Sem APP_URL, a função escolhe Cloudflare na homologação e Vercel na produção, conforme a tabela acima. Publique essa função apenas depois do frontend.

## Cadastros importados sem conta de acesso

Copiar `public.usuarios` para homologação não copia as contas do Auth. O botão administrativo confere o ID e o e-mail da identidade antes de gerar o link. Sessão expirada, indisponibilidade e conta ausente têm mensagens próprias.

Somente na homologação, um ADMIN ativo pode escolher **Criar acesso e gerar link** após a mensagem de conta ausente. A ação cria a identidade pelo Auth Admin API com o mesmo UUID e e-mail do cadastro, sem definir senha nem confirmar previamente o e-mail. O trigger `handle_new_auth_user` usa `ON CONFLICT(id) DO NOTHING`, preservando o perfil, vendedor e referências existentes. Um conflito de e-mail é bloqueado; não se remapeiam identidades automaticamente. A verificação do link de recuperação confirma o e-mail e permite que a própria pessoa defina a senha.

A criação exige uma solicitação explícita e não está habilitada em produção. Não envia e-mail: o administrador compartilha o link com a pessoa correta. Se a conta for criada mas a geração falhar, uma nova tentativa reaproveita a identidade, sem apagar o cadastro. O link é temporário; gerar outro substitui o anterior.

O código não consegue corrigir sozinho uma Site URL/allowlist remota incorreta: um redirect rejeitado pelo Supabase pode cair na Site URL. Configurar apenas VITE_* não modifica essas opções do Auth. O template e este documento são arquivos versionados; não aplicam automaticamente configuração ao projeto hospedado.

## Comportamento

- Login/Primeiro acesso enviam um redirect explícito na própria origem, com caminho estável e sem carregar parâmetros antigos.
- O retorno captura os parâmetros antes do cliente Supabase, valida a sessão no servidor e impede troca com uma sessão antiga quando o link é inválido.
- Links antigos com access_token/refresh_token continuam suportados. Links com token_hash esperam um clique explícito antes de verifyOtp; a leitura automática do e-mail não consome o token. PKCE também é tratado sem tentar consumir o código duas vezes.
- Erros no hash ou query, inclusive otp_expired sem type, exibem mensagem em português e Solicitar novo link.
- Tokens são retirados da barra de endereço; não são gravados em logs. Só o identificador de usuário e um prazo de 15 minutos são guardados em sessionStorage para permitir recarregar a tela após validação. A sessão continua sendo verificada pelo servidor.
- A senha só é enviada após validação de tamanho, confirmação e identidade. Após sucesso, encerra a sessão local e volta ao login.

## Verificação antes de promover

O login também depende de as policies conseguirem executar `private.is_admin()` e `private.current_vendedor_id()`. A migração `20260923201942_restore_rls_identity_helper_execute.sql` concede EXECUTE somente a authenticated e mantém anon/PUBLIC sem acesso. As funções consultam apenas auth.uid(); USAGE do schema privado, funções de escrita e as policies permanecem inalteradas. Ao validar, execute a leitura de usuarios sob o papel authenticated com o sub de uma conta de teste: deve retornar o próprio perfil, sem outros perfis, para VENDEDOR. Uma consulta como postgres não testa RLS.

1. Rodar npm ci, npm test e npm run build com as variáveis de homologação. Conferir que builds com branch/ambiente trocados falham.
2. Abrir o alias de homologação: testar link expirado, malformado, vazio e usuário já autenticado com link inválido. Nenhum deve permitir salvar senha.
3. Com conta de teste exclusiva da homologação, solicitar e receber e-mail; confirmar origem, projeto e template. Abrir primeiro sem clicar em Continuar (token não consumido), depois confirmar, salvar e entrar com a nova senha. Conferir recarga da página, reutilização do link e senha antiga recusada.
4. Testar o link administrativo somente com usuário de teste, mantendo a autorização ADMIN ativo.
5. Após aprovação e teste completo, transportar somente os arquivos desta correção para uma branch baseada em main. Não mesclar toda homologacao: as branches contêm outras diferenças. Configuração e template de produção só devem ser atualizados depois que o frontend de produção for compatível.

Referências: https://supabase.com/docs/guides/auth/passwords ; https://supabase.com/docs/guides/auth/redirect-urls ; https://supabase.com/docs/guides/auth/auth-email-templates
