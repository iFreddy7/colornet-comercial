import { supabase } from './supabase'
import type { DocumentoCotacao } from './cotacaoPdf'
import { preencherFiliaisCotacao } from './filiaisFaturamento'

export async function prepararDocumentoCotacaoPdf(documento: DocumentoCotacao) {
  const { data, error } = await supabase.from('filiais').select('id,codigo,nome,uf')
  if (error) throw new Error('Não foi possível consultar os dados da filial para o PDF. Tente novamente.')
  return preencherFiliaisCotacao(documento, data || [])
}
