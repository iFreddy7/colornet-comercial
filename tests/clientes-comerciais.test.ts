import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { carregarClientesComerciais } from '../src/lib/clientesComerciais.ts'

function api(total: number, cap = 1000, failure?: 'error' | 'empty' | 'changed' | 'duplicate') {
  const calls: URL[] = []
  const rows = Array.from({ length: total }, (_, i) => ({
    id: String(i), razao_social: i >= 1059 && i <= 1061 ? 'VIBRANTZ' : `Cliente ${i}`,
    codigo: String(i), loja: i === 1061 ? '0003' : '0001', uf: i === 1059 ? 'EX' : 'SP', ativo: true,
  }))
  const client = createClient('https://example.supabase.co', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url)
      assert.equal(url.pathname, '/rest/v1/clientes')
      assert.equal(url.searchParams.get('ativo'), 'eq.true')
      assert.equal(url.searchParams.get('order'), 'razao_social.asc,id.asc')
      assert.equal(new Headers(init?.headers).get('apikey'), 'public-test-key')
      const start = Number(url.searchParams.get('offset') || 0)
      const size = Math.min(Number(url.searchParams.get('limit')), cap)
      if (start && failure === 'error') return new Response(JSON.stringify({message:'Falha de rede',code:'TEST'}), {status:503})
      const page = start && failure === 'empty' ? [] : rows.slice(start, start + size)
      if (start && failure === 'duplicate' && page.length) page[0] = rows[0]
      const count = start && failure === 'changed' ? total + 1 : total
      return new Response(JSON.stringify(page), {status:200, headers:{
        'content-type':'application/json', 'content-range': page.length ? `${start}-${start + page.length - 1}/${count}` : `*/${count}`,
      }})
    } },
  })
  return { client, calls }
}

test('Inclui Vibrantz local/exportação e clientes além de 1000 e 1500, sem confundir lojas', async () => {
  const {client,calls}=api(1601)
  const result=await carregarClientesComerciais(client)
  assert.equal(result.error,null); assert.equal(result.data.length,1601)
  assert.deepEqual(result.data.filter(c=>c.razao_social==='VIBRANTZ').map(c=>[c.uf,c.loja]),[['EX','0001'],['SP','0001'],['SP','0003']])
  assert.deepEqual(calls.map(c=>c.searchParams.get('offset')),['0','500','1000','1500'])
})

test('Limite da API menor que a página solicitada não trunca a carteira', async () => {
  const {client}=api(751,200)
  const result=await carregarClientesComerciais(client)
  assert.equal(result.error,null);assert.equal(result.data.length,751)
})

test('Carteira restrita ou vazia retorna somente os registros autorizados pela API', async () => {
  for (const count of [0,12,500]) {
    const {client,calls}=api(count)
    const result=await carregarClientesComerciais(client)
    assert.equal(result.error,null);assert.equal(result.data.length,count);assert.equal(calls.length,1)
  }
})

test('Falha na segunda página não apresenta uma carteira parcial como completa', async () => {
  for (const failure of ['error','empty','changed','duplicate'] as const) {
    const {client}=api(1115,500,failure)
    const result=await carregarClientesComerciais(client)
    assert.ok(result.error?.message);assert.deepEqual(result.data,[])
  }
})
