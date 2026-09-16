# ColorNet Comercial — GitHub e Cloudflare Pages

## Fase 9 — usuários e Excel no ADMIN

Para ativar esta versão, siga [o passo a passo da Fase 9](docs/ATIVAR_ADMIN_FASE9.md)
antes de publicar o painel atualizado. Ele inclui a migração SQL e a Edge Function
`admin-criar-usuario`, instaladas uma única vez no Supabase.

Veja também [como funcionam as atualizações e a futura aba de cotações](docs/ATUALIZACOES_E_COTACOES.md).
Os testes desta fase podem ser executados com `npm test` (Node 24).

Frontend completo com as correções fiscais, horário de Brasília, reserva de
estoque e cancelamento já validados no projeto. O ciclo de criar pedido,
reservar estoque, cancelar e estornar foi confirmado por João antes desta etapa.

O código está preparado para publicação. Ainda é necessário enviar ao GitHub,
conectar o Cloudflare e preencher as variáveis com o projeto Supabase existente.

| Componente | Função nesta instalação |
| --- | --- |
| GitHub privado | Código-fonte e histórico de alterações |
| Cloudflare Pages | Site e publicação a partir da branch `main` |
| Supabase existente | Login, dados, cálculos, pedidos, reservas e funções de e-mail |
| Integração de e-mail existente | Recebimento dos relatórios e envio das confirmações |

## 1. Enviar o projeto ao GitHub

Nome sugerido para o repositório: `colornet-comercial`, com visibilidade **Private**.
Se já existir um repositório para esse portal, use-o em vez de criar outro.

Pela conexão do GitHub no ChatGPT, podemos continuar o envio e as próximas
alterações por aqui. A conta precisa estar conectada e ter acesso ao repositório.

Também é possível enviar pelo navegador:

1. Extraia o ZIP em uma pasta nova.
2. No GitHub, crie o repositório privado. O pacote já contém README e regras de
   arquivos; deixe desmarcada a criação desses arquivos no formulário.
3. No repositório vazio, escolha **uploading an existing file**; se já houver
   arquivos, use **Add file → Upload files**.
4. Envie o CONTEÚDO da pasta `colornet_github_cloudflare`, incluindo `src`,
   `public`, `package.json`, `package-lock.json`, os arquivos de configuração
   e os arquivos que começam com ponto. A raiz do repositório deve mostrar
   `package.json` diretamente, sem uma pasta extra acima dele.
5. Grave o primeiro commit em `main`, com a mensagem
   `Preparar portal Colornet para Cloudflare Pages`.

O pacote contém apenas um modelo vazio de configuração. Seu `.env` preenchido
fica no PC; os valores usados pela hospedagem são cadastrados no Cloudflare.
As regras de `.gitignore` protegem o fluxo com Git, mas não filtram um upload
manual feito pelo navegador.

[Criação de repositórios](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
e [envio de arquivos](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

## 2. Conectar o Cloudflare Pages

No painel Cloudflare, abra **Workers & Pages → Create application → Pages →
Import from an existing Git repository**. Autorize o acesso ao repositório
do portal e selecione-o. Use estas configurações:

| Campo | Valor |
| --- | --- |
| Production branch | `main` |
| Framework preset | `React (Vite)`; se ausente, preencha os campos abaixo |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Vazio, quando `package.json` está na raiz |
| Node | Linha 24, definida no arquivo `.node-version` |

O projeto usa Node 24 LTS e o lockfile mantém as versões das dependências.
O primeiro passo é a integração Git; não é necessário carregar `dist` manualmente.
O Cloudflare compila o projeto e atribui um endereço `pages.dev` após publicar.

[Configuração de build](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[versão do Node no Cloudflare](https://developers.cloudflare.com/pages/configuration/build-image/)
e [ciclo LTS do Node](https://nodejs.org/en/about/previous-releases).

## 3. Cadastrar as variáveis antes do primeiro build

Use os valores do `.env` que já funciona no seu PC, apontando para o MESMO
projeto Supabase. Cadastre no ambiente **Production** do projeto Pages:

| Variável | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | URL completa HTTPS do projeto Supabase atual |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública atual, preferencialmente `sb_publishable_...` |
| `VITE_APP_ENV` | `HOMOLOGACAO` durante a conferência inicial do novo endereço |

O ambiente “Production” do Cloudflare identifica a branch publicada. Já
`VITE_APP_ENV` controla o rótulo visual do portal: não cria outro banco, não
simula pedidos e não muda o destino dos e-mails. Os dados e operações continuam
no Supabase indicado pelas duas primeiras variáveis.

Escolha **Save and Deploy** depois de preencher os campos. Em publicações
seguintes, alterações nas variáveis exigem um novo build para entrar no site.
O rótulo pode passar para `PRODUCAO` após a conferência do endereço publicado.

Uma chave `sb_secret_...` ou `service_role` pertence ao backend e não deve ser
usada nessa configuração. O build verifica esse caso e interrompe a publicação.
Ele também informa quando faltar uma das três variáveis. A chave pública
identifica o aplicativo; o acesso aos dados continua dependendo do login e das
regras já existentes no Supabase.

[Variáveis no build do Vite](https://vite.dev/guide/env-and-mode) e
[tipos de chave do Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## 4. Autorizar o endereço novo no login

Depois de obter o endereço estável do projeto, por exemplo
`https://NOME-DO-PROJETO.pages.dev`, abra no Supabase:
**Authentication → URL Configuration**.

1. Defina **Site URL** como o endereço estável HTTPS do portal.
2. Acrescente em **Redirect URLs** o endereço raiz exato com barra final,
   por exemplo `https://NOME-DO-PROJETO.pages.dev/`.
3. Durante a transição, mantenha também o endereço de desenvolvimento já
   autorizado se ainda for usá-lo para recuperar senhas.

O login e o admin usam o endereço da página atual para recuperação de senha.
Essa autorização permite que o link recebido retorne ao portal publicado.
O endereço estável é o do projeto, e não a URL temporária de um commit.

[URLs permitidas e Site URL do Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

## 5. Conferir no endereço publicado

Entre com seu usuário e confira:

- carregamento dos clientes e produtos;
- cálculo de SILVER NET 3891 com o código AL031.2BD25;
- horário dos pedidos em Brasília;
- reserva ao SALVAR um pedido de teste e estorno ao cancelá-lo;
- recuperação de senha e retorno ao endereço novo;
- confirmação de pedido pelo fluxo de e-mail já existente.

O teste no endereço hospedado ainda precisa ser realizado com sua sessão.
O pacote conserva o frontend atualizado; não é preciso reaplicar os SQLs
fiscais, de reserva ou de recuperação dos pedidos antigos para mudar a hospedagem.

Após essa conferência, altere `VITE_APP_ENV` para `PRODUCAO`, refaça o deploy
e distribua o endereço estável aos vendedores.

## Manutenção depois da migração

As alterações de código passam pelo GitHub. A integração do Cloudflare recompila
e publica a branch configurada mantendo o endereço do projeto. Uma branch
separada permite revisar a alteração antes de colocá-la em `main`.

Por enquanto, desative builds automáticos de branches de preview em
**Settings → Builds → Branch control**. Podemos habilitá-los depois com um
Supabase de testes: usar o mesmo banco em uma URL de preview continua operando
nos dados atuais, mesmo com o rótulo HOMOLOGAÇÃO.

[Integração GitHub e controle de branches no Pages](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).

## Executar no PC

Com Node 24 LTS instalado, crie `.env.local` a partir de `.env.example`, preencha
os valores e execute no terminal da pasta do projeto:

```bash
npm ci
npm run dev
```

Para conferir o pacote compilado localmente:

```bash
npm run build
npm run preview
```

O Pages já oferece o fallback de SPA necessário ao React. O arquivo
`public/_headers` acrescenta os cabeçalhos usados pelo portal, e `robots.txt`
solicita que os mecanismos de busca não indexem o site; o controle de acesso
continua sendo o login e as permissões do banco.

[Comportamento de SPA](https://developers.cloudflare.com/pages/configuration/serving-pages/)
e [cabeçalhos do Pages](https://developers.cloudflare.com/pages/configuration/headers/).

## Validação deste pacote

Compilação completa aprovada com Node 24.19.0 e Vite 8.3.0. Foram conferidos
sete cenários de configuração, incluindo builds de produção/homologação,
campos ausentes e rejeição de chaves de backend. As credenciais desses testes
eram fictícias; o teste de login e operações no endereço Cloudflare permanece
para depois da publicação. O registro está em `validacao/resultado_migracao.json`.
