-- Hardening aplicado antes da passagem para produção.
-- Remove execução direta de funções que só devem ser disparadas por trigger/event trigger
-- e fixa search_path em funções auxiliares.

alter function public.norm_import_text(text) set search_path = '';
alter function public.handle_new_auth_user() set search_path = '';

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
