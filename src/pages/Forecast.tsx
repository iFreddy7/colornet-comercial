import { useMemo, useState } from 'react'
import type { UsuarioApp } from '../types'
import { APP_ENV_LABEL } from '../lib/env'
import { temVisaoComercial } from '../lib/permissoes'
import { Icon } from '../components/Icon'
import { clientesExemplo, produtosExemplo, exemploForecast, lerForecast, mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, totalInformadoForecast, filtrarForecast, agruparForecastClientes, type ForecastLinha } from '../lib/forecastDraft'
import './forecast.css'

const kg = (valor: number) => valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const somaExibida = (linhas: ForecastLinha[], meses: string[]) => { const valor = totalInformadoForecast(linhas, meses); return valor == null ? '—' : kg(valor) }
type Vendedor = { id: string; nome: string }
type Mes = ReturnType<typeof mesesForecast>[number]

function TabelaMensal({ linhas, meses, vendedores, editar, remover }: {
  linhas: ForecastLinha[]; meses: Mes[]; vendedores: Vendedor[]
  editar?: (id: string, mes: string, valor: string) => void
  remover?: (id: string) => void
}) {
  const idsMeses = meses.map(m => m.id)
  return <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Produtos e quantidades mensais">
    <table className="forecast-table"><thead><tr><th scope="col">Produto</th>{meses.map(m => <th scope="col" key={m.id}>{m.label}<small>kg</small></th>)}<th scope="col">Total kg</th>{remover && <th scope="col">Ações</th>}</tr></thead>
      <tbody>{linhas.map(linha => {
        const produto = produtosExemplo.find(p => p.id === linha.produtoId)!
        const vendedor = vendedores.find(v => v.id === linha.vendedorId)?.nome || ''
        return <tr key={linha.id}><th scope="row"><strong>{produto.nome}</strong><code>{produto.codigo}</code><small>{vendedor}</small></th>
          {meses.map(m => {
            const valor = linha.quantidades[m.id] ?? ''
            const invalido = Boolean(valor.trim()) && quantidadeForecast(valor) === null
            return <td key={m.id}>{editar ? <input type="text" inputMode="decimal" maxLength={20} aria-label={produto.codigo + ', ' + m.label + ', kg'} aria-invalid={invalido} placeholder="—" value={valor} onChange={e => editar(linha.id, m.id, e.target.value)} /> : invalido ? <span className="forecast-invalid-cell">Revisar</span> : somaExibida([linha], [m.id])}</td>
          })}
          <td className="forecast-row-total">{somaExibida([linha], idsMeses)}</td>{remover && <td><button type="button" className="danger-link" aria-label={'Remover produto ' + produto.codigo} onClick={() => remover(linha.id)}>Remover</button></td>}</tr>
      })}
      {!linhas.length && <tr><td className="empty-cell" colSpan={remover ? 15 : 14}>Adicione um produto para preencher as quantidades mês a mês.</td></tr>}</tbody>
      {linhas.length > 0 && <tfoot><tr><th scope="row">Total previsto (kg)</th>{meses.map(m => <td key={m.id}>{somaExibida(linhas, [m.id])}</td>)}<td>{somaExibida(linhas, idsMeses)}</td>{remover && <td />}</tr></tfoot>}
    </table>
  </div>
}

export function Forecast({ usuario }: { usuario: UsuarioApp }) {
  const gestao = temVisaoComercial(usuario)
  const vendedores = gestao ? [{ id: 'demo-a', nome: 'Vendedor exemplo A' }, { id: 'demo-b', nome: 'Vendedor exemplo B' }] : [{ id: usuario.id, nome: usuario.nome || 'Minha previsão' }]
  const storageKey = 'colornet:forecast-demo:v1:' + APP_ENV_LABEL + ':' + usuario.id + ':' + usuario.perfil
  const [inicio, setInicio] = useState(mesAtualForecast)
  const [inicial] = useState(() => {
    try { return { salvo: lerForecast(localStorage.getItem(storageKey), vendedores.map(v => v.id)), erro: '' } }
    catch { return { salvo: null, erro: 'O navegador não permite salvar o rascunho. Exporte para Excel antes de fechar.' } }
  })
  const [linhas, setLinhas] = useState<ForecastLinha[]>(() => inicial.salvo?.linhas ?? exemploForecast(inicio, vendedores.map(v => v.id)))
  const [salvoEm, setSalvoEm] = useState(inicial.salvo?.salvoEm || '')
  const [erro, setErro] = useState(inicial.erro)
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState<'clientes' | 'preencher' | 'consolidado'>('clientes')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [produtoFiltro, setProdutoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [vendedorId, setVendedorId] = useState(vendedores[0].id)
  const [incluirProduto, setIncluirProduto] = useState(false)
  const [removida, setRemovida] = useState<ForecastLinha | null>(null)
  const [exportando, setExportando] = useState(false)
  const meses = useMemo(() => mesesForecast(inicio), [inicio])
  const idsMeses = meses.map(m => m.id)
  const consulta = filtrarForecast(linhas, { clienteId: clienteFiltro, produtoId: produtoFiltro, vendedorId: gestao ? vendedorFiltro : usuario.id })
  const edicao = clienteId ? filtrarForecast(linhas, { clienteId, vendedorId: gestao ? vendedorId : usuario.id }) : []
  const visiveis = aba === 'preencher' ? edicao : consulta
  const preenchidas = visiveis.reduce((n, linha) => n + meses.filter(m => quantidadeForecast(linha.quantidades[m.id]) !== null).length, 0)
  const invalidas = visiveis.some(linha => meses.some(m => Boolean(linha.quantidades[m.id]?.trim()) && quantidadeForecast(linha.quantidades[m.id]) === null))
  const grupos = produtosExemplo.map(produto => ({ produto, linhas: visiveis.filter(linha => linha.produtoId === produto.id) })).filter(grupo => grupo.linhas.length)
  const clientes = agruparForecastClientes(consulta)
  const total = totalForecast(visiveis, idsMeses)
  const maximoMes = Math.max(1, ...idsMeses.map(mes => totalForecast(visiveis, [mes])))
  const statusSalvo = salvoEm ? 'Salvo neste navegador às ' + new Date(salvoEm).toLocaleTimeString('pt-BR') : 'As quantidades são salvas automaticamente neste navegador.'

  function salvar(proximas: ForecastLinha[]) {
    setLinhas(proximas)
    try {
      const agora = new Date().toISOString()
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, linhas: proximas, salvoEm: agora }))
      setSalvoEm(agora); setErro('')
    } catch { setErro('Não foi possível salvar neste navegador. Mantenha a tela aberta e exporte o rascunho para Excel.') }
  }
  function abrirPreenchimento(cliente = clienteFiltro, vendedor = vendedorFiltro || vendedores[0].id) {
    setClienteId(cliente); setVendedorId(gestao ? vendedor : usuario.id)
    setProdutoId(''); setIncluirProduto(false); setAviso(''); setAba('preencher')
  }
  function adicionar() {
    if (!clienteId || !produtoId) { setAviso('Selecione o cliente e o produto para continuar.'); return }
    if (edicao.some(l => l.produtoId === produtoId)) { setAviso('Esse produto já está na previsão deste cliente e vendedor. Edite a linha existente.'); return }
    if (linhas.length >= 200) { setAviso('Este rascunho permite até 200 linhas.'); return }
    salvar([...linhas, { id: crypto.randomUUID(), clienteId, produtoId, vendedorId: gestao ? vendedorId : usuario.id, quantidades: {} }])
    setRemovida(null); setProdutoId(''); setIncluirProduto(false); setAviso('Produto adicionado. Preencha as quantidades previstas em kg.')
  }
  function remover(id: string) {
    setRemovida(linhas.find(l => l.id === id) || null)
    salvar(linhas.filter(l => l.id !== id))
    setAviso('Produto removido do rascunho.')
  }
  async function exportar() {
    if (invalidas || !visiveis.length || exportando) return
    setExportando(true); setAviso('')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sobre = workbook.addWorksheet('Leia primeiro')
      sobre.addRows([['COLORNET — FORECAST DEMONSTRATIVO'], ['Dados fictícios para avaliação do rascunho da homologação.'], ['Não representa previsões reais ou pedidos.'], ['Unidade', 'kg'], ['Período', `${meses[0].label} a ${meses[11].label}`], ['Cliente', clientesExemplo.find(c => c.id === (aba === 'preencher' ? clienteId : clienteFiltro))?.nome || 'Todos'], ['Produto', aba === 'preencher' ? 'Todos do cliente selecionado' : produtosExemplo.find(p => p.id === produtoFiltro)?.codigo || 'Todos'], ['Vendedor', vendedores.find(v => v.id === (aba === 'preencher' ? vendedorId : vendedorFiltro))?.nome || 'Todos disponíveis'], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })]])
      sobre.getColumn(1).width = 75; sobre.getColumn(2).width = 42
      const detalhe = workbook.addWorksheet('Previsão por cliente')
      detalhe.addRow(['Vendedor', 'Cliente', 'Código cliente', 'Produto', 'Código produto', ...meses.map(m => m.label), 'Total kg'])
      visiveis.forEach(linha => {
        const cliente = clientesExemplo.find(c => c.id === linha.clienteId)!, produto = produtosExemplo.find(p => p.id === linha.produtoId)!
        detalhe.addRow([vendedores.find(v => v.id === linha.vendedorId)?.nome, cliente.nome, cliente.codigo, produto.nome, produto.codigo, ...meses.map(m => quantidadeForecast(linha.quantidades[m.id])), totalInformadoForecast([linha], idsMeses)])
      })
      const consolidado = workbook.addWorksheet('Consolidado por produto')
      consolidado.addRow(['Produto', 'Código produto', ...meses.map(m => m.label), 'Total kg'])
      grupos.forEach(grupo => consolidado.addRow([grupo.produto.nome, grupo.produto.codigo, ...meses.map(m => totalInformadoForecast(grupo.linhas, [m.id])), totalInformadoForecast(grupo.linhas, idsMeses)]))
      for (const [sheet, inicioNumero] of [[detalhe, 6], [consolidado, 3]] as const) {
        sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: inicioNumero - 1 }]
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } }
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19337F' } }
        sheet.columns.forEach((column, i) => { column.width = i < inicioNumero - 1 ? 30 : 15; if (i >= inicioNumero - 1) column.numFmt = '#,##0.###' })
      }
      const buffer = await workbook.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a'); link.href = url; link.download = `ColorNet_Forecast_DEMONSTRATIVO_${inicio}.xlsx`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setAviso('Excel gerado com os filtros selecionados e a identificação de dados demonstrativos.')
    } catch { setAviso('Não foi possível gerar o Excel. Tente novamente.') }
    finally { setExportando(false) }
  }
  return <section className="page forecast-page">
    <div className="page-header"><div><span className="eyebrow">PLANEJAMENTO COMERCIAL</span><h1>{aba === 'preencher' ? 'Planejamento de demanda' : 'Forecast de vendas'}</h1><p>{aba === 'preencher' ? 'Informe a quantidade prevista de cada produto, mês a mês, para o cliente selecionado.' : 'Acompanhe a previsão mensal por cliente, produto e vendedor.'}</p></div>
      <button type="button" className="secondary-button" onClick={exportar} disabled={exportando || invalidas || !visiveis.length}>{exportando ? 'Gerando Excel...' : 'Exportar Excel'}</button></div>
    <div className="forecast-demo"><strong>Rascunho demonstrativo · homologação</strong><p>Dados de exemplo. As alterações ficam apenas neste navegador, para este usuário, e ainda não são compartilhadas com outros usuários.</p></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {aviso && <div className="alert" role="status">{aviso}{removida && <button type="button" className="secondary-button forecast-undo" onClick={() => { salvar([...linhas, removida]); setRemovida(null); setAviso('Produto restaurado com suas quantidades.')}}>Desfazer remoção</button>}</div>}
    <div className="forecast-toolbar"><div className="forecast-tabs" aria-label="Visualização do forecast">
      <button type="button" aria-pressed={aba === 'clientes'} onClick={() => { setAba('clientes'); setAviso('') }}>Por cliente</button>
      <button type="button" aria-pressed={aba === 'preencher'} onClick={() => abrirPreenchimento()}>Preencher previsão</button>
      {gestao && <button type="button" aria-pressed={aba === 'consolidado'} onClick={() => { setAba('consolidado'); setAviso('') }}>Por produto</button>}
    </div><label className="forecast-period">Início dos 12 meses<input type="month" min="2020-01" max="2100-01" value={inicio} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setInicio(e.target.value) }} /></label></div>

    {aba !== 'preencher' && <>
      <div className="form-card forecast-filter-card"><div className="forecast-filters">
        {gestao && <label>Filtrar por vendedor<select value={vendedorFiltro} onChange={e => setVendedorFiltro(e.target.value)}><option value="">Todos os vendedores</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
        <label>Filtrar por cliente<select value={clienteFiltro} onChange={e => setClienteFiltro(e.target.value)}><option value="">Todos os clientes</option>{clientesExemplo.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.codigo}</option>)}</select></label>
        <label>Filtrar por produto<select value={produtoFiltro} onChange={e => setProdutoFiltro(e.target.value)}><option value="">Todos os produtos</option>{produtosExemplo.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => { setClienteFiltro(''); setProdutoFiltro(''); setVendedorFiltro('') }}>Limpar filtros</button>
      </div></div>
      <div className="forecast-metrics">
        <div><span>Previsto no período</span><strong>{kg(total)} <small>kg</small></strong><p>Conforme os filtros selecionados</p></div>
        <div><span>Clientes</span><strong>{clientes.length}</strong><p>Com linhas de planejamento</p></div>
        <div><span>Produtos / códigos</span><strong>{grupos.length}</strong><p>Cada variante tem sua previsão</p></div>
        <div><span>Preenchimento</span><strong>{visiveis.length ? Math.round(preenchidas / (visiveis.length * 12) * 100) : 0}%</strong><p>{preenchidas} de {visiveis.length * 12} campos mensais</p></div>
      </div>
    </>}

    {invalidas && <p className="forecast-invalid" role="alert">Há quantidades a revisar. Use valores de 0 a 999.999.999 kg, com até 3 casas decimais. Corrija antes de exportar.</p>}

    {aba === 'clientes' && <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>Previsões por cliente</h2><p>Clique no cliente para consultar os produtos e as quantidades mensais. Os filtros se aplicam também aos detalhes.</p></div><span>{meses[0].label} — {meses[11].label}</span></div>
      <div className="forecast-client-head" aria-hidden="true"><span>Cliente / responsável</span><span>Produtos</span><span>Total previsto</span><span /></div>
      {clientes.map(grupo => {
        const cliente = clientesExemplo.find(c => c.id === grupo.clienteId)!
        const responsaveis = vendedores.filter(v => grupo.linhas.some(l => l.vendedorId === v.id))
        return <details className="forecast-client" key={cliente.id}><summary>
          <span><strong>{cliente.nome}</strong><small>{cliente.codigo} · {responsaveis.map(v => v.nome).join(', ')}</small></span>
          <span className="forecast-client-count">{new Set(grupo.linhas.map(l => l.produtoId)).size} produto(s)</span>
          <span className="forecast-client-total">{somaExibida(grupo.linhas, idsMeses)} kg</span><span className="forecast-chevron" aria-hidden="true">⌄</span>
        </summary><div className="forecast-client-detail">
          <div className="forecast-client-actions"><span>Produtos e quantidades • {cliente.nome}</span>{responsaveis.map(v => <button type="button" className="secondary-button" key={v.id} onClick={() => abrirPreenchimento(cliente.id, v.id)}>{gestao ? 'Editar previsão de ' + v.nome : 'Editar minha previsão'}</button>)}</div>
          <TabelaMensal linhas={grupo.linhas} meses={meses} vendedores={vendedores} />
          <div className="forecast-grid-footer">↔ Role a tabela para consultar os 12 meses.</div>
        </div></details>
      })}
      {!clientes.length && <div className="forecast-empty"><strong>Nenhuma previsão encontrada</strong><p>Ajuste os filtros ou comece a preencher a previsão de um cliente.</p><button type="button" className="primary-button" onClick={() => abrirPreenchimento()}>Preencher previsão</button></div>}
    </div>}

    {aba === 'preencher' && <>
      <div className="form-card forecast-customer-form"><div className="forecast-filters">
        <label>Cliente da previsão<select value={clienteId} onChange={e => { setClienteId(e.target.value); setProdutoId(''); setIncluirProduto(false); setAviso('') }}><option value="">Selecione o cliente</option>{clientesExemplo.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.codigo}</option>)}</select></label>
        {gestao && <label>Vendedor responsável<select value={vendedorId} onChange={e => { setVendedorId(e.target.value); setProdutoId(''); setAviso('') }}>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
      </div><div className="forecast-form-meta"><span>Responsável: <strong>{vendedores.find(v => v.id === vendedorId)?.nome}</strong></span><span>Horizonte: <strong>12 meses</strong></span><span>Unidade: <strong>kg</strong></span><span role="status">{statusSalvo}</span></div></div>
      {clienteId ? <div className="forecast-grid-card">
        <div className="forecast-grid-heading"><div><h2>Produtos e quantidades</h2><p>Vazio = não informado; 0 = sem venda prevista. As alterações são salvas automaticamente.</p></div><button type="button" className="primary-button" onClick={() => { setIncluirProduto(!incluirProduto); setAviso('') }}><Icon name={incluirProduto ? 'close' : 'plus'} />{incluirProduto ? 'Fechar inclusão' : 'Adicionar produto'}</button></div>
        {incluirProduto && <div className="forecast-product-add"><label>Produto para adicionar<select value={produtoId} onChange={e => setProdutoId(e.target.value)}><option value="">Selecione o produto e código</option>{produtosExemplo.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label><button type="button" className="primary-button" onClick={adicionar}>Adicionar à previsão</button></div>}
        <TabelaMensal linhas={edicao} meses={meses} vendedores={vendedores} editar={(id, mes, valor) => salvar(linhas.map(l => l.id === id ? { ...l, quantidades: { ...l.quantidades, [mes]: valor } } : l))} remover={remover} />
        <div className="forecast-grid-footer"><span>↔ Role a tabela para preencher os 12 meses.</span><strong>Total do cliente neste vendedor: {somaExibida(edicao, idsMeses)} kg</strong></div>
      </div> : <div className="forecast-empty form-card"><h2>Comece pelo cliente</h2><p>Selecione o cliente acima. Depois, adicione os produtos e preencha as quantidades de cada mês.</p></div>}
      <div className="forecast-editor-footer"><button type="button" className="secondary-button" onClick={() => { setAba('clientes'); setClienteFiltro(clienteId); setVendedorFiltro(gestao ? vendedorId : ''); setProdutoFiltro(''); setAviso('') }}>Ver previsão por cliente</button><span role="status">{statusSalvo}</span></div>
    </>}

    {aba === 'consolidado' && gestao && <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>Demanda prevista por produto</h2><p>Soma dos clientes e vendedores filtrados, separada por código.</p></div></div>
      <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Consolidado mensal por produto"><table className="forecast-table"><thead><tr><th scope="col">Produto / Código</th>{meses.map(m => <th scope="col" key={m.id}>{m.label}<small>kg</small></th>)}<th scope="col">Total kg</th></tr></thead>
        <tbody>{grupos.map(grupo => <tr key={grupo.produto.id}><th scope="row"><strong>{grupo.produto.nome}</strong><code>{grupo.produto.codigo}</code></th>{meses.map(m => <td key={m.id}>{somaExibida(grupo.linhas, [m.id])}</td>)}<td className="forecast-row-total">{somaExibida(grupo.linhas, idsMeses)}</td></tr>)}
          {!grupos.length && <tr><td className="empty-cell" colSpan={14}>Nenhuma previsão nos filtros selecionados.</td></tr>}</tbody>
        {grupos.length > 0 && <tfoot><tr><th scope="row">Total previsto (kg)</th>{meses.map(m => <td key={m.id}>{somaExibida(visiveis, [m.id])}</td>)}<td>{somaExibida(visiveis, idsMeses)}</td></tr></tfoot>}
      </table></div>
    </div>}
    {aba !== 'preencher' && <div className="form-card forecast-chart"><h2>Distribuição mensal prevista</h2><p>Volumes demonstrativos, conforme os filtros acima.</p><div className="forecast-bars">{meses.map(m => { const valor = totalForecast(visiveis, [m.id]); return <div key={m.id}><span>{somaExibida(visiveis, [m.id])}</span><div className="forecast-bar-track"><div style={{ height: (valor / maximoMes * 100) + '%' }} /></div><small>{m.label}</small></div> })}</div></div>}
  </section>
}
