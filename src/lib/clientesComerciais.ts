import type { SupabaseClient } from '@supabase/supabase-js'
import type { Cliente } from '../types'

// A API limita cada resposta; limit(1500) não garante os 1500 registros.
// Todas as páginas usam a sessão do usuário e continuam sujeitas às regras de carteira.
export async function carregarClientesComerciais(client: SupabaseClient): Promise<{
  data: Cliente[]; error: { message: string } | null
}> {
  const clientes: Cliente[] = []
  const ids = new Set<string>()
  let total: number | null = null
  try {
    do {
      const { data, error, count } = await client.from('clientes')
        .select('id,codigo,loja,razao_social,nome_fantasia,municipio,uf,calculo_automatico,vendedor_id,ativo', { count: 'exact' })
        .eq('ativo', true)
        .order('razao_social').order('id')
        .range(clientes.length, clientes.length + 499)
      if (error) return { data: [], error }
      if (count == null || (total != null && count !== total)) {
        throw new Error('A lista de clientes mudou ou ficou incompleta. Atualize a página para tentar novamente.')
      }
      total = count
      if ((!data?.length && clientes.length < total) || (data ?? []).some(c => ids.has(c.id))) {
        throw new Error('Não foi possível carregar todos os clientes. Atualize a página para tentar novamente.')
      }
      for (const cliente of data ?? []) {
        ids.add(cliente.id)
        clientes.push(cliente as Cliente)
      }
    } while (clientes.length < total)
    return { data: clientes, error: null }
  } catch (error) {
    return { data: [], error: { message: error instanceof Error ? error.message : 'Não foi possível carregar os clientes.' } }
  }
}
