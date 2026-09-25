import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Filial } from '../types'
import type { VendedorAdmin } from './AdminNovoUsuario'

export function AdminExportacao({ vendedores, filiais, comercial = false }: { vendedores: VendedorAdmin[]; filiais: Filial[]; comercial?: boolean }) {
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [vendedor, setVendedor] = useState('')
  const [filial, setFilial] = useState('')
  const [status, setStatus] = useState('')
  const [exportando, setExportando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const emAndamento = useRef(false)

  async function exportar(event: FormEvent) {
    event.preventDefault()
    if (emAndamento.current) return
    setErro(''); setMensagem('')
    if (inicio && fim && inicio > fim) { setErro('A data final deve ser igual ou posterior à inicial.'); return }
    emAndamento.current = true; setExportando(true)
    try {
      const { data, error } = await supabase.rpc(comercial ? 'exportar_pedidos_comercial_v1' : 'admin_exportar_pedidos_v1', {
        p_data_inicio: inicio || null, p_data_fim: fim || null, p_vendedor_id: vendedor || null,
        p_filial_id: filial || null, p_status: status || null,
      })
      if (error) throw new Error(error.code === '57014'
        ? 'A consulta demorou além do permitido. Selecione um período menor e tente novamente.'
        : 'Não foi possível consultar o relatório. ' + error.message)
      const { gerarExcelPedidos, validarRelatorio } = await import('../lib/relatorioPedidos')
      const relatorio = validarRelatorio(data)
      if (!relatorio.pedidos.length) { setMensagem('Nenhum pedido encontrado para os filtros selecionados.'); return }
      const bytes = await gerarExcelPedidos(relatorio)
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Colornet_Pedidos_${relatorio.gerado_em.slice(0,10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setMensagem(`Arquivo gerado com ${relatorio.pedidos.length} pedido(s) e ${relatorio.itens.length} item(ns).`)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao gerar o Excel. Nenhum arquivo foi gerado.') }
    finally { emAndamento.current = false; setExportando(false) }
  }

  return <div className="form-card">
    <div className="section-title"><span>↓</span><div><strong>Relatório de pedidos</strong><small>{comercial ? 'Excel com pedidos de todos os vendedores, itens, cancelamentos e reservas.' : 'Excel completo com pedidos, itens, cancelamentos, reservas e registros de e-mail.'}</small></div></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {mensagem && <div className="alert success" role="status">{mensagem}</div>}
    <form onSubmit={exportar}>
      <fieldset disabled={exportando} className="admin-fieldset">
        <div className="form-grid compact">
          <div className="field"><label htmlFor="rel-inicio">Criados a partir de</label><input id="rel-inicio" type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></div>
          <div className="field"><label htmlFor="rel-fim">Criados até</label><input id="rel-fim" type="date" value={fim} min={inicio || undefined} onChange={e => setFim(e.target.value)} /></div>
          <div className="field"><label htmlFor="rel-status">Status</label><select id="rel-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos, inclusive cancelados</option>{['ABERTO','ENVIADO','FATURADO','CANCELADO'].map(s => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="rel-vendedor">Vendedor</label><select id="rel-vendedor" value={vendedor} onChange={e => setVendedor(e.target.value)}><option value="">Todos os vendedores</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}{v.ativo ? '' : ' (inativo)'}</option>)}</select></div>
          <div className="field"><label htmlFor="rel-filial">Filial</label><select id="rel-filial" value={filial} onChange={e => setFilial(e.target.value)}><option value="">Todas as filiais</option>{filiais.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></div>
        </div>
        <p className="field-help">Sem datas, inclui todo o histórico. O período considera o horário de Brasília. Valores separados por moeda e status.</p>
        <button type="submit" className="primary-button">{exportando ? 'Preparando Excel...' : 'Baixar Excel (.xlsx)'}</button>
      </fieldset>
    </form>
  </div>
}
