import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: cors })
}

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char] || char))
}

function money(value: unknown, moeda: string, casas = 2) {
  const numero = Number(value)
  if (!Number.isFinite(numero)) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda === 'BRL' ? 'BRL' : 'USD',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(numero)
}

function dataBr(value: unknown) {
  if (!value) return '—'
  const iso = String(value).slice(0, 10)
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : esc(value)
}

function dataHoraBrasilia(value: string | null | undefined) {
  if (!value) return '—'
  const instante = new Date(value)
  if (!Number.isFinite(instante.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: 'America/Sao_Paulo',
  }).format(instante)
}

function serverKey() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw) {
    const keys = JSON.parse(raw)
    const key = keys.default || Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('Chave de servidor ausente no ambiente da função.')
}

function emailInterno(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase()
  return /^[^\s@]+@colornet\.com\.br$/i.test(email) ? email : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { erro: 'Método não permitido.' })

  try {
    const authorization = req.headers.get('authorization') || ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return reply(401, { erro: 'Entre novamente no portal.' })
    }

    const token = authorization.replace(/^Bearer\s+/i, '')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth.user) return reply(401, { erro: 'Sessão inválida.' })

    const raw = await req.text()
    if (raw.length > 16_500_000) return reply(413, { erro: 'PDF maior que o limite de envio.' })

    let body: Record<string, unknown>
    try { body = JSON.parse(raw) } catch { return reply(400, { erro: 'Requisição inválida.' }) }

    const cotacaoId = String(body.cotacao_id || '').trim()
    const pdfNome = String(body.pdf_nome || '').trim().replace(/[\\/]/g, '_')
    const pdfBase64 = String(body.pdf_base64 || '').trim()

    if (!/^[0-9a-f-]{36}$/i.test(cotacaoId)) return reply(400, { erro: 'cotacao_id inválido.' })
    if (!pdfNome || !pdfNome.toLowerCase().endsWith('.pdf') || pdfNome.length > 180) {
      return reply(400, { erro: 'Nome do PDF inválido.' })
    }
    if (!pdfBase64 || pdfBase64.length > 15_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(pdfBase64)) {
      return reply(400, { erro: 'PDF inválido ou maior que o limite.' })
    }

    const { data: perfil, error: perfilError } = await admin
      .from('usuarios')
      .select('perfil,ativo')
      .eq('id', auth.user.id)
      .single()

    if (perfilError || !perfil?.ativo) return reply(403, { erro: 'Usuário inativo ou sem perfil.' })

    const { data: cotacao, error: cotacaoError } = await admin
      .from('cotacoes')
      .select('id,numero,created_at,created_by,cliente_nome,vendedor_nome,vendedor_id,moeda,documento,vendedores(nome,email)')
      .eq('id', cotacaoId)
      .single()

    if (cotacaoError || !cotacao) return reply(404, { erro: 'Cotação não encontrada.' })
    if (perfil.perfil !== 'ADMIN' && cotacao.created_by !== auth.user.id) {
      return reply(403, { erro: 'Sem permissão para esta cotação.' })
    }

    const { data: jaEnviado } = await admin
      .from('email_logs')
      .select('id')
      .eq('cotacao_id', cotacaoId)
      .eq('tipo', 'CONFIRMACAO_COTACAO')
      .eq('status', 'ENVIADO')
      .maybeSingle()

    if (jaEnviado) return reply(200, { sucesso: true, ja_enviado: true })

    const vendedor: any = Array.isArray(cotacao.vendedores)
      ? cotacao.vendedores[0]
      : cotacao.vendedores
    const to = emailInterno(vendedor?.email)
    if (!to) throw new Error('O vendedor da cotação não possui e-mail @colornet.com.br válido.')

    const doc: any = cotacao.documento || {}
    const itens: any[] = Array.isArray(doc.itens) ? doc.itens : []
    const prazo = doc.prazo_pagamento?.descricao || '—'
    const validade = dataBr(doc.validade)

    const rows = itens.map((item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #ddd">${esc(item.produto)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd">${esc(item.codigo || 'SEM CÓDIGO')}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${item.quantidade == null ? '—' : Number(item.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(item.preco_net, cotacao.moeda, 4)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(item.preco_final, cotacao.moeda)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${(Number(item.ipi || 0) * 100).toFixed(2)}%</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${item.total_item == null ? '—' : money(item.total_item, cotacao.moeda)}</td>
      </tr>
    `).join('')

    const totalHtml = doc.total == null ? '' : `
      <div style="margin-top:18px;text-align:right">
        <div>Subtotal: <b>${money(doc.subtotal, cotacao.moeda)}</b></div>
        <div>IPI: <b>${money(doc.valor_ipi, cotacao.moeda)}</b></div>
        <div style="font-size:18px;margin-top:5px">Total: <b>${money(doc.total, cotacao.moeda)}</b></div>
      </div>
    `

    const html = `
      <div style="font-family:Arial,sans-serif;color:#29243a;max-width:960px;margin:auto">
        <div style="background:#5b3cc4;color:white;padding:18px 22px;border-radius:12px 12px 0 0">
          <h2 style="margin:0">Cotação Incluída</h2>
          <p style="margin:5px 0 0">${esc(cotacao.numero)} • ColorNet Comercial</p>
        </div>
        <div style="padding:20px;border:1px solid #e5e0ef;border-top:0">
          <p><b>Emissão (Brasília):</b> ${esc(dataHoraBrasilia(cotacao.created_at))}</p>
          <p><b>Vendedor:</b> ${esc(vendedor?.nome || cotacao.vendedor_nome)}</p>
          <p><b>Cliente:</b> ${esc(doc.cliente?.codigo)} — ${esc(doc.cliente?.nome || cotacao.cliente_nome)}</p>
          <p><b>Validade da proposta:</b> ${validade} • <b>Prazo de pagamento:</b> ${esc(prazo)}</p>
          <p><b>Moeda:</b> ${cotacao.moeda === 'BRL' ? 'Real (R$)' : 'Dólar americano (US$)'}</p>

          <table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:18px">
            <thead><tr style="background:#f1edff;text-align:left">
              <th style="padding:8px">Produto</th><th style="padding:8px">Código</th><th style="padding:8px;text-align:right">Qtd.</th>
              <th style="padding:8px;text-align:right">Preço NET</th><th style="padding:8px;text-align:right">Preço Final</th>
              <th style="padding:8px;text-align:right">IPI</th><th style="padding:8px;text-align:right">Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${totalHtml}
          ${doc.observacoes ? `<p><b>Observações:</b> ${esc(doc.observacoes)}</p>` : ''}
          <p style="color:#777;font-size:11px;margin-top:24px">O PDF oficial da cotação segue em anexo.</p>
        </div>
      </div>
    `

    const subject = `Cotação Incluída - ${cotacao.numero} - ${doc.cliente?.nome || cotacao.cliente_nome}`
    const bridgeUrl = Deno.env.get('GMAIL_BRIDGE_URL')
    const bridgeSecret = Deno.env.get('GMAIL_BRIDGE_SECRET')
    if (!bridgeUrl || !bridgeSecret) throw new Error('Gateway Gmail não configurado.')

    const bridgeResponse = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CONFIRMACAO_COTACAO',
        secret: bridgeSecret,
        cotacao_id: cotacao.id,
        numero: cotacao.numero,
        to,
        subject,
        htmlBody: html,
        attachments: [{ name: pdfNome, mimeType: 'application/pdf', base64: pdfBase64 }],
      }),
    })

    const bridgeText = await bridgeResponse.text()
    let bridgeResult: any
    try { bridgeResult = JSON.parse(bridgeText) } catch {
      bridgeResult = { ok: false, erro: `Resposta inválida do gateway: ${bridgeText.slice(0, 500)}` }
    }

    if (!bridgeResponse.ok || !bridgeResult?.ok) {
      await admin.from('email_logs').insert({
        cotacao_id: cotacaoId,
        tipo: 'CONFIRMACAO_COTACAO',
        destinatarios: [to],
        cc: [],
        status: 'ERRO',
        erro: JSON.stringify(bridgeResult),
      })
      throw new Error(`Gateway Gmail: ${bridgeResult?.erro || 'Falha desconhecida.'}`)
    }

    await admin.from('email_logs').insert({
      cotacao_id: cotacaoId,
      tipo: 'CONFIRMACAO_COTACAO',
      destinatarios: [to],
      cc: bridgeResult.cc || [],
      status: 'ENVIADO',
      provider_id: 'GOOGLE_MAILAPP',
    })

    return reply(200, {
      sucesso: true,
      provider: 'GOOGLE_MAILAPP',
      quota_restante: bridgeResult.quota_restante ?? null,
    })
  } catch (error) {
    console.error('cotacao-confirmacao:', error instanceof Error ? error.message : String(error))
    return reply(500, { erro: error instanceof Error ? error.message : 'Falha no envio da cotação.' })
  }
})
