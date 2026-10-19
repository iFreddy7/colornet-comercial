-- Restaura o contrato utilizado pela Edge Function admin-criar-usuario.
-- A implementação privada já valida administrador, identidade e nonce de criação.
create or replace function public.admin_finalizar_novo_usuario(
  p_administrador_id uuid, p_usuario_id uuid, p_criacao_id uuid,
  p_nome text, p_email text, p_perfil text, p_vendedor_id uuid
) returns void language sql security invoker set search_path = ''
begin atomic
  select private.admin_finalizar_novo_usuario_impl(p_administrador_id, p_usuario_id,
    p_criacao_id, p_nome, p_email, p_perfil, p_vendedor_id);
end;
revoke all on function public.admin_finalizar_novo_usuario(uuid,uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function private.admin_finalizar_novo_usuario_impl(uuid,uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.admin_finalizar_novo_usuario(uuid,uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function private.admin_finalizar_novo_usuario_impl(uuid,uuid,uuid,text,text,text,uuid) to service_role;
notify pgrst, 'reload schema';
