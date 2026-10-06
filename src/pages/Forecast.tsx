import { useMemo, useState } from 'react'
import type { UsuarioApp } from '../types'
import { temVisaoComercial } from '../lib/permissoes'
import { mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, totalInformadoForecast, filtrarForecast, agruparForecastClientes, colunasRelatorioForecast, type ForecastLinha } from '../lib/forecastDraft'
import { linhasDosPlanos, type ForecastDados } from '../lib/forecastSupabase'
import './forecast.css'
const kg = (valor: number) => valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const somaExibida = (linhas: ForecastLinha[], meses: string[]) => { const valor = totalInformadoForecast(linhas, meses); return valor == null ? '—' : kg(valor) }
type Vendedor = { id: string; nome: string }
type Mes = ReturnType<typeof mesesForecast>[number]

function TabelaMensal({ linhas, meses, vendedores, produtos, editar, remover }: {
  linhas: ForecastLinha[]; meses: Mes[]; vendedores: Vendedor[]; produtos: ForecastDados['produtos']
  editar?: (id: string, mes: string, valor: string) => void
  remover?: (id: string) => void
}) {
  const idsMeses = meses.map(m => m.id)
  return <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Produtos e quantidades mensais">
    <table className="forecast-table"><thead><tr><th scope="col">Produto</th>{meses.map(m => <th scope="col" key={m.id}>{m.label}<small>kg</small></th>)}<th scope="col">Total kg</th>{remover && <th scope="col">Ações</th>}</tr></thead>
      <tbody>{linhas.map(linha => {
        const produto = produtos.find(p => p.id === linha.produtoId) || {nome: 'Produto indisponível no cadastro', codigo: linha.produtoId}
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


export function Forecast({ usuario, dados }: { usuario: UsuarioApp; dados: ForecastDados }) {
  const gestao = temVisaoComercial(usuario)
  const vendedores = dados.vendedores
  const clientesCadastro = dados.clientes
  const produtosCadastro = dados.produtos
  const [inicio, setInicio] = useState(mesAtualForecast)
  const linhas = linhasDosPlanos(dados.planos)
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState<'clientes' | 'consolidado' | 'relatorio'>('clientes')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [produtoFiltro, setProdutoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [exportando, setExportando] = useState(false)
  const meses = useMemo(() => mesesForecast(inicio), [inicio])
  const idsMeses = meses.map(m => m.id)
  const visiveis = filtrarForecast(linhas, { clienteId: clienteFiltro, produtoId: produtoFiltro, vendedorId: gestao ? vendedorFiltro : (usuario.vendedor_id || 'sem-vendedor') })
  const preenchidas = visiveis.reduce((n, linha) => n + meses.filter(m => quantidadeForecast(linha.quantidades[m.id]) !== null).length, 0)
  const invalidas = visiveis.some(linha => meses.some(m => Boolean(linha.quantidades[m.id]?.trim()) && quantidadeForecast(linha.quantidades[m.id]) === null))
  const grupos = produtosCadastro.map(produto => ({ produto, linhas: visiveis.filter(linha => linha.produtoId === produto.id) })).filter(grupo => grupo.linhas.length)
  const clientes = agruparForecastClientes(visiveis)
  const relatorio = colunasRelatorioForecast(visiveis, meses, vendedores, clientesCadastro, produtosCadastro)
  const total = totalForecast(visiveis, idsMeses)
  const maximoMes = Math.max(1, ...idsMeses.map(mes => totalForecast(visiveis, [mes])))
  async function exportar() {
    if (invalidas || !visiveis.length || exportando) return
    setExportando(true); setAviso('')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const detalhe = workbook.addWorksheet('Relatório forecast')
      detalhe.addRows([relatorio.cabecalho, ...relatorio.linhas])
      const sobre = workbook.addWorksheet('Leia primeiro')
      sobre.addRows([['COLORNET — FORECAST — HOMOLOGAÇÃO'], ['Previsões de teste salvas no Supabase da homologação.'], ['Ambiente de testes. Este relatório não gera pedidos ou movimentações de estoque.'], ['Unidade', 'kg'], ['Período', `${meses[0].label} a ${meses[11].label}`], ['Cliente', clientesCadastro.find(c => c.id === clienteFiltro)?.nome || 'Todos'], ['Produto', produtosCadastro.find(p => p.id === produtoFiltro)?.codigo || 'Todos'], ['Vendedor', vendedores.find(v => v.id === (gestao ? vendedorFiltro : (usuario.vendedor_id || 'sem-vendedor')))?.nome || 'Todos disponíveis'], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })]])
      sobre.getColumn(1).width = 75; sobre.getColumn(2).width = 42
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
      const link = document.createElement('a'); link.href = url; link.download = `ColorNet_Forecast_HOMOLOGACAO_${inicio}.xlsx`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setAviso('Relatório Excel gerado com as previsões da homologação e os filtros selecionados.')
    } catch { setAviso('Não foi possível gerar o Excel. Tente novamente.') }
    finally { setExportando(false) }
  }
  return <section className="page forecast-page">
    <div className="page-header"><div><span className="eyebrow">PLANEJAMENTO COMERCIAL</span><h1>Consultar forecast</h1><p>Analise as previsões e gere o relatório por vendedor, cliente, produto e mês.</p></div>
      <button type="button" className="secondary-button" onClick={exportar} disabled={exportando || invalidas || !visiveis.length}>{exportando ? 'Gerando Excel...' : 'Gerar relatório Excel'}</button></div>
    <div className="forecast-demo"><strong>Forecast em teste · homologação</strong><p>Previsões salvas no Supabase da homologação, disponíveis conforme as permissões do seu perfil. Para incluir ou editar, use Lançar forecast.</p></div>
    {aviso && <div className="alert" role="status">{aviso}</div>}
    <div className="forecast-toolbar"><div className="forecast-tabs" aria-label="Visualização do forecast">
      <button type="button" aria-pressed={aba === 'clientes'} onClick={() => { setAba('clientes'); setAviso('') }}>Por cliente</button>
      <button type="button" aria-pressed={aba === 'relatorio'} onClick={() => setAba('relatorio')}>Relatório em colunas</button>
      {gestao && <button type="button" aria-pressed={aba === 'consolidado'} onClick={() => { setAba('consolidado'); setAviso('') }}>Por produto</button>}
    </div><label className="forecast-period">Início dos 12 meses<input type="month" min="2020-01" max="2100-01" value={inicio} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setInicio(e.target.value) }} /></label></div>

    <>
      <div className="form-card forecast-filter-card"><div className="forecast-filters">
        {gestao && <label>Filtrar por vendedor<select value={vendedorFiltro} onChange={e => setVendedorFiltro(e.target.value)}><option value="">Todos os vendedores</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
        <label>Filtrar por cliente<select value={clienteFiltro} onChange={e => setClienteFiltro(e.target.value)}><option value="">Todos os clientes</option>{clientesCadastro.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.codigo}</option>)}</select></label>
        <label>Filtrar por produto<select value={produtoFiltro} onChange={e => setProdutoFiltro(e.target.value)}><option value="">Todos os produtos</option>{produtosCadastro.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => { setClienteFiltro(''); setProdutoFiltro(''); setVendedorFiltro('') }}>Limpar filtros</button>
      </div></div>
      <div className="forecast-metrics">
        <div><span>Previsto no período</span><strong>{kg(total)} <small>kg</small></strong><p>Conforme os filtros selecionados</p></div>
        <div><span>Clientes</span><strong>{clientes.length}</strong><p>Com linhas de planejamento</p></div>
        <div><span>Produtos / códigos</span><strong>{grupos.length}</strong><p>Cada variante tem sua previsão</p></div>
        <div><span>Preenchimento</span><strong>{visiveis.length ? Math.round(preenchidas / (visiveis.length * 12) * 100) : 0}%</strong><p>{preenchidas} de {visiveis.length * 12} campos mensais</p></div>
      </div>
    </>

    {invalidas && <p className="forecast-invalid" role="alert">Há quantidades a revisar. Use valores de 0 a 999.999.999 kg, com até 3 casas decimais. Corrija antes de exportar.</p>}

    {aba === 'clientes' && <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>Previsões por cliente</h2><p>Clique no cliente para consultar os produtos e as quantidades mensais. Os filtros se aplicam também aos detalhes.</p></div><span>{meses[0].label} — {meses[11].label}</span></div>
      <div className="forecast-client-head" aria-hidden="true"><span>Cliente / responsável</span><span>Produtos</span><span>Total previsto</span><span /></div>
      {clientes.map(grupo => {
        const cliente = clientesCadastro.find(c => c.id === grupo.clienteId)!
        const responsaveis = vendedores.filter(v => grupo.linhas.some(l => l.vendedorId === v.id))
        return <details className="forecast-client" key={cliente.id}><summary>
          <span><strong>{cliente.nome}</strong><small>{cliente.codigo} · {responsaveis.map(v => v.nome).join(', ')}</small></span>
          <span className="forecast-client-count">{new Set(grupo.linhas.map(l => l.produtoId)).size} produto(s)</span>
          <span className="forecast-client-total">{somaExibida(grupo.linhas, idsMeses)} kg</span><span className="forecast-chevron" aria-hidden="true">⌄</span>
        </summary><div className="forecast-client-detail">
          <div className="forecast-client-actions"><span>Produtos e quantidades • {cliente.nome}</span></div>
          <TabelaMensal linhas={grupo.linhas} meses={meses} vendedores={vendedores} produtos={produtosCadastro} />
          <div className="forecast-grid-footer">↔ Role a tabela para consultar os 12 meses.</div>
        </div></details>
      })}
      {!clientes.length && <div className="forecast-empty"><strong>Nenhuma previsão encontrada</strong><p>Ajuste os filtros ou use Lançar forecast no menu comercial.</p></div>}
    </div>}

    {aba === 'relatorio' && <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>Relatório de forecast</h2><p>Uma linha por vendedor, cliente e produto. Cada mês ocupa uma coluna, com quantidades em kg.</p></div></div>
      <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Relatório de forecast em colunas"><table className="forecast-flat-report"><thead><tr>{relatorio.cabecalho.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
        <tbody>{relatorio.linhas.map((linha, i) => <tr key={visiveis[i].id}>{linha.map((valor, j) => <td key={j}>{valor == null ? '—' : typeof valor === 'number' ? kg(valor) : valor}</td>)}</tr>)}{!visiveis.length && <tr><td colSpan={18}>Nenhuma previsão nos filtros selecionados.</td></tr>}</tbody>
      </table></div><div className="forecast-grid-footer">O botão “Gerar relatório Excel” exporta estas mesmas colunas e respeita os filtros acima.</div>
    </div>}
    {aba === 'consolidado' && gestao && <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>Demanda prevista por produto</h2><p>Soma dos clientes e vendedores filtrados, separada por código.</p></div></div>
      <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Consolidado mensal por produto"><table className="forecast-table"><thead><tr><th scope="col">Produto / Código</th>{meses.map(m => <th scope="col" key={m.id}>{m.label}<small>kg</small></th>)}<th scope="col">Total kg</th></tr></thead>
        <tbody>{grupos.map(grupo => <tr key={grupo.produto.id}><th scope="row"><strong>{grupo.produto.nome}</strong><code>{grupo.produto.codigo}</code></th>{meses.map(m => <td key={m.id}>{somaExibida(grupo.linhas, [m.id])}</td>)}<td className="forecast-row-total">{somaExibida(grupo.linhas, idsMeses)}</td></tr>)}
          {!grupos.length && <tr><td className="empty-cell" colSpan={14}>Nenhuma previsão nos filtros selecionados.</td></tr>}</tbody>
        {grupos.length > 0 && <tfoot><tr><th scope="row">Total previsto (kg)</th>{meses.map(m => <td key={m.id}>{somaExibida(visiveis, [m.id])}</td>)}<td>{somaExibida(visiveis, idsMeses)}</td></tr></tfoot>}
      </table></div>
    </div>}
    {<div className="form-card forecast-chart"><h2>Distribuição mensal prevista</h2><p>Quantidades previstas, conforme os filtros acima.</p><div className="forecast-bars">{meses.map(m => { const valor = totalForecast(visiveis, [m.id]); return <div key={m.id}><span>{somaExibida(visiveis, [m.id])}</span><div className="forecast-bar-track"><div style={{ height: (valor / maximoMes * 100) + '%' }} /></div><small>{m.label}</small></div> })}</div></div>}
  </section>
}

