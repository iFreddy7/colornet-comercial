# Fluxo de ambientes

## Produção

- Branch: `main`
- Cloudflare Pages: `https://colornet-comercial.pages.dev`
- Supabase: `duojavyrugezvlvuuwag`
- `VITE_APP_ENV=PRODUCAO`
- Alterações só entram aqui após homologação e aprovação explícita.

## Homologação

- Branch: `homologacao`
- Cloudflare Pages: `https://homologacao.colornet-comercial.pages.dev`
- Supabase: `nqyddagfawklfqwumlie`
- `VITE_APP_ENV=HOMOLOGACAO`
- Mudanças devem ser validadas nesta branch antes de promover para `main`.

## Proteções contra mistura de ambientes

O projeto possui duas verificações independentes:

1. **No build:** o Cloudflare informa a branch em `CF_PAGES_BRANCH`. A `main` só aceita o Supabase de produção; qualquer branch Preview só aceita o Supabase de homologação.
2. **No navegador:** o cliente valida novamente o project ref da URL do Supabase conforme o domínio acessado.

Se uma variável de ambiente for configurada incorretamente, o build falha ou o aplicativo bloqueia a inicialização. O objetivo é impedir que uma tela de homologação grave dados em produção.

## Variáveis no Cloudflare Pages

### Production

```text
VITE_APP_ENV=PRODUCAO
VITE_SUPABASE_URL=https://duojavyrugezvlvuuwag.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key de produção>
```

### Preview

```text
VITE_APP_ENV=HOMOLOGACAO
VITE_SUPABASE_URL=https://nqyddagfawklfqwumlie.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key de homologação>
```

## Auth e Edge Functions

Cada ambiente possui Auth, banco e Edge Functions próprios. Usuários de produção não devem ser copiados com senha para homologação. Na homologação devem existir contas de teste independentes.

Funções que disparam e-mail ou recebem integrações externas devem permanecer isoladas para não produzir efeitos reais durante testes.

## Fluxo recomendado

1. Implementar e versionar alterações em `homologacao`.
2. Aguardar o workflow `Validate` concluir com sucesso.
3. Testar a versão Preview.
4. Após aprovação explícita, promover para `main`.
5. Validar o deploy de produção.

> O repositório privado está no GitHub Free; portanto a proteção obrigatória da `main` depende de disciplina operacional.
