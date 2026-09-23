-- RLS policies execute these identity helpers as the authenticated caller.
-- Both functions read only the current auth.uid(), not caller-supplied IDs.
-- Keep private schema USAGE and all write/admin functions unchanged.
revoke execute on function private.is_admin() from public, anon;
revoke execute on function private.current_vendedor_id() from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_vendedor_id() to authenticated;
