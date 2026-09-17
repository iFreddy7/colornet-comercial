# Fluxo de ambientes

## Produção

- Branch: `main`
- Cloudflare Pages: produção
- `VITE_APP_ENV=PRODUCAO`
- Alterações só entram aqui após homologação e aprovação explícita.

## Homologação

- Branch: `homologacao`
- Usada para desenvolvimento, correções e testes futuros.
- `VITE_APP_ENV=HOMOLOGACAO` no ambiente Preview do Cloudflare Pages.
- Mudanças devem ser validadas nesta branch antes de promover para `main`.

## Fluxo recomendado

1. Implementar e versionar alterações em `homologacao`.
2. Aguardar o workflow `Validate` concluir com sucesso.
3. Testar a versão Preview do Cloudflare Pages.
4. Após aprovação explícita, promover as alterações para `main`.
5. Validar o deploy de produção em `https://colornet-comercial.pages.dev`.

> Observação: como o repositório privado está no GitHub Free, a proteção obrigatória da `main` não é aplicada. O processo depende de disciplina operacional: não fazer alterações diretas na `main` durante o desenvolvimento.
