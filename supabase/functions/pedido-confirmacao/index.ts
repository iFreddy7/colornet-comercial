import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}

function money(v: unknown, moeda: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda === 'BRL' ? 'BRL' : 'USD',
  }).format(Number(v || 0))
}

function secretKey() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) throw new Error('SUPABASE_SECRET_KEYS ausente')
  const keys = JSON.parse(raw)
  return keys.default || Object.values(keys)[0]
}

function dataHoraBrasilia(value: string | null | undefined) {
  if (!value) return '—'
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return 'Horário sem fuso'
  const instante = new Date(value)
  if (!Number.isFinite(instante.getTime())) return 'Horário inválido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Sao_Paulo',
  }).format(instante)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token) return Response.json({ erro: 'Não autenticado.' }, { status: 401, headers: cors })

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, secretKey() as string, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return Response.json({ erro: 'Sessão inválida.' }, { status: 401, headers: cors })

    const body = await req.json()
    const pedidoId = body?.pedido_id
    if (!pedidoId) throw new Error('pedido_id obrigatório')

    const { data: perfil } = await admin.from('usuarios').select('perfil,ativo').eq('id', userData.user.id).single()
    const { data: pedido, error: pe } = await admin.from('pedidos').select(`
      id,numero,created_at,created_by,moeda,subtotal,valor_ipi,total,transportadora,data_entrega,observacoes_transporte,observacoes,
      clientes (codigo,razao_social,municipio,uf),
      vendedores (nome,email),
      filiais (nome,uf),
      prazos_pagamento (descricao),
      fretes (descricao)
    `).eq('id', pedidoId).single()

    if (pe || !pedido) throw pe || new Error('Pedido não encontrado')
    if (perfil?.perfil !== 'ADMIN' && pedido.created_by !== userData.user.id) {
      return Response.json({ erro: 'Sem permissão.' }, { status: 403, headers: cors })
    }

    const { data: sent } = await admin.from('email_logs').select('id')
      .eq('pedido_id', pedidoId).eq('tipo', 'CONFIRMACAO_PEDIDO').eq('status', 'ENVIADO').maybeSingle()
    if (sent) return Response.json({ sucesso: true, ja_enviado: true }, { headers: cors })

    const { data: itens, error: ie } = await admin.from('pedido_itens').select(`
      quantidade,preco_net,preco_final,ipi,valor_ipi,total_item,
      produtos (codigo_protheus,nome)
    `).eq('pedido_id', pedidoId)
    if (ie) throw ie

    const vendedor: any = Array.isArray(pedido.vendedores) ? pedido.vendedores[0] : pedido.vendedores
    const cliente: any = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes
    const filial: any = Array.isArray(pedido.filiais) ? pedido.filiais[0] : pedido.filiais
    const prazo: any = Array.isArray(pedido.prazos_pagamento) ? pedido.prazos_pagamento[0] : pedido.prazos_pagamento
    const frete: any = Array.isArray(pedido.fretes) ? pedido.fretes[0] : pedido.fretes
    const to = vendedor?.email || userData.user.email
    if (!to) throw new Error('O pedido não possui e-mail de vendedor.')

    const rows = (itens || []).map((i: any) => {
      const p = Array.isArray(i.produtos) ? i.produtos[0] : i.produtos
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #ddd">${esc(p?.nome)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${esc(p?.codigo_protheus || 'SEM CÓDIGO')}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${Number(i.quantidade).toLocaleString('pt-BR')}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${money(i.preco_net, pedido.moeda)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${money(i.preco_final, pedido.moeda)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${(Number(i.ipi || 0) * 100).toFixed(2)}%</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${money(i.total_item, pedido.moeda)}</td>
      </tr>`
    }).join('')

    const html = `<div style="font-family:Arial,sans-serif;color:#29243a;max-width:900px;margin:auto">
      <div style="background:#5b3cc4;color:white;padding:18px 22px;border-radius:12px 12px 0 0">
        <h2 style="margin:0">Pedido ${esc(pedido.numero)}</h2><p style="margin:5px 0 0">ColorNet Comercial</p>
      </div>
      <div style="padding:20px;border:1px solid #e5e0ef;border-top:0">
        <p><b>Data/hora do pedido (Brasília):</b> ${esc(dataHoraBrasilia(pedido.created_at))}</p>
        <p><b>Vendedor:</b> ${esc(vendedor?.nome)}</p>
        <p><b>Cliente:</b> ${esc(cliente?.codigo)} — ${esc(cliente?.razao_social)} • ${esc(cliente?.municipio)}/${esc(cliente?.uf)}</p>
        <p><b>Filial:</b> ${esc(filial?.nome)} • <b>Prazo:</b> ${esc(prazo?.descricao || '—')} • <b>Frete:</b> ${esc(frete?.descricao || '—')}</p>
        <p><b>Entrega:</b> ${esc(pedido.data_entrega || '—')} • <b>Transportadora:</b> ${esc(pedido.transportadora || '—')}</p>
        <table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:18px">
          <thead><tr style="background:#f1edff;text-align:left">
            <th style="padding:8px">Produto</th><th style="padding:8px">Código</th><th style="padding:8px">Qtd.</th>
            <th style="padding:8px">NET</th><th style="padding:8px">Final</th><th style="padding:8px">IPI</th><th style="padding:8px">Total</th>
          </tr></thead><tbody>${rows}</tbody>
        </table>
        <h3 style="text-align:right;color:#32225f">Total: ${money(pedido.total, pedido.moeda)}</h3>
        ${pedido.observacoes_transporte ? `<p><b>Transporte:</b> ${esc(pedido.observacoes_transporte)}</p>` : ''}
        ${pedido.observacoes ? `<p><b>Observações:</b> ${esc(pedido.observacoes)}</p>` : ''}
        <p style="color:#777;font-size:11px;margin-top:24px">Gerado automaticamente pelo ColorNet Comercial.</p>
      </div>
    </div>`

    const subject = `Pedido ${pedido.numero} - ${cliente?.razao_social || 'Cliente'}`
    const bridgeUrl = Deno.env.get('GMAIL_BRIDGE_URL')
    const bridgeSecret = Deno.env.get('GMAIL_BRIDGE_SECRET')
    if (!bridgeUrl || !bridgeSecret) throw new Error('Configure GMAIL_BRIDGE_URL e GMAIL_BRIDGE_SECRET nos Secrets da Edge Function.')

    const bridgeResponse = await fetch(bridgeUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CONFIRMACAO_PEDIDO', secret: bridgeSecret, pedido_id: pedido.id, numero: pedido.numero, to, subject, htmlBody: html }),
    })
    const bridgeText = await bridgeResponse.text()
    let bridgeResult: any
    try { bridgeResult = JSON.parse(bridgeText) }
    catch { bridgeResult = { ok: false, erro: `Resposta inválida do Apps Script: ${bridgeText.slice(0, 500)}` } }

    if (!bridgeResponse.ok || !bridgeResult?.ok) {
      await admin.from('email_logs').insert({ pedido_id: pedidoId, tipo: 'CONFIRMACAO_PEDIDO', destinatarios: [to], cc: [], status: 'ERRO', erro: JSON.stringify(bridgeResult) })
      throw new Error(`Gateway Gmail: ${bridgeResult?.erro || 'Falha desconhecida.'}`)
    }

    await admin.from('email_logs').insert({ pedido_id: pedidoId, tipo: 'CONFIRMACAO_PEDIDO', destinatarios: [to], cc: bridgeResult.cc || [], status: 'ENVIADO', provider_id: 'GOOGLE_MAILAPP' })
    return Response.json({ sucesso: true, provider: 'GOOGLE_MAILAPP', quota_restante: bridgeResult.quota_restante ?? null }, { headers: cors })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500, headers: cors })
  }
})
