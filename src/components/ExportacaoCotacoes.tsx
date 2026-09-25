import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { situacoesCotacao } from '../lib/aprovacaoCotacao'
import type { VendedorAdmin } from './AdminNovoUsuario'

export function ExportacaoCotacoes({ vendedores }: { vendedores: VendedorAdmin[] }) {
  const [inicio, setInicio] = useState(''), [fim, setFim] = useState(''), [vendedor, setVendedor] = useState(''), [cliente, setCliente] = useState(''), [status, setStatus] = useState('')
  const [exportando, setExportando] = useState(false), [erro, setErro] = useState(''), [mensagem, setMensagem] = useState('')
  const trava = useRef(false)
  async function exportar(e: FormEvent) {
    e.preventDefault()
    if (trava.current) return
    setErro(''); setMensagem('')
    if (inicio && fim && inicio > fim) { setErro('A data final deve ser igual ou posterior à inicial.'); return }
    trava.current = true; setExportando(true)
    try {
      const { data, error } = await supabase.rpc('exportar_cotacoes_comercial_v1', { p_data_inicio: inicio || null, p_data_fim: fim || null, p_vendedor_id: vendedor || null, p_cliente: cliente.trim() || null, p_status: status || null })
      if (error) throw new Error(error.code === '57014' ? 'A consulta demorou além do permitido. Selecione um período menor.' : error.message)
      const { gerarExcelCotacoes, validarRelatorioCotacoes } = await import('../lib/relatorioCotacoes')
      const relatorio = validarRelatorioCotacoes(data)
      if (!relatorio.cotacoes.length) { setMensagem('Nenhuma cotação encontrada para os filtros selecionados.'); return }
      const bytes = await gerarExcelCotacoes(relatorio)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `Colornet_Cotacoes_${relatorio.gerado_em.slice(0,10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setMensagem(`Arquivo gerado com ${relatorio.cotacoes.length} cotação(ões) e ${relatorio.itens.length} item(ns).`)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível gerar o relatório.') }
    finally { trava.current = false; setExportando(false) }
  }
  return <div className="form-card">
    <div className="section-title"><span>↓</span><div><strong>Relatório de cotações</strong><small>Excel com propostas, itens, avaliações e motivos de reprovação.</small></div></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}{mensagem && <div className="alert success" role="status">{mensagem}</div>}
    <form onSubmit={exportar}><fieldset className="admin-fieldset" disabled={exportando}><div className="form-grid compact">
      <div className="field"><label htmlFor="cot-rel-inicio">Emitidas a partir de</label><input id="cot-rel-inicio" type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></div>
      <div className="field"><label htmlFor="cot-rel-fim">Emitidas até</label><input id="cot-rel-fim" type="date" min={inicio || undefined} value={fim} onChange={e => setFim(e.target.value)} /></div>
      <div className="field"><label htmlFor="cot-rel-status">Situação da cotação</label><select id="cot-rel-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todas as situações</option>{Object.entries(situacoesCotacao).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor="cot-rel-vendedor">Vendedor da cotação</label><select id="cot-rel-vendedor" value={vendedor} onChange={e => setVendedor(e.target.value)}><option value="">Todos os vendedores</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}{v.ativo ? '' : ' (inativo)'}</option>)}</select></div>
      <div className="field"><label htmlFor="cot-rel-cliente">Cliente da cotação</label><input id="cot-rel-cliente" value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nome do cliente" maxLength={180} /></div>
    </div><p className="field-help">Sem datas, inclui todo o histórico. Período em horário de Brasília. Totais separados por moeda e situação.</p>
    <button type="submit" className="primary-button">{exportando ? 'Preparando Excel...' : 'Baixar cotações (.xlsx)'}</button></fieldset></form>
  </div>
}
