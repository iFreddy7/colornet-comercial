import { useMemo, useState } from 'react'
import type { UsuarioApp } from '../types'
import { APP_ENV_LABEL } from '../lib/env'
import { temVisaoComercial } from '../lib/permissoes'
import { Icon } from '../components/Icon'
import { clientesExemplo, produtosExemplo, exemploForecast, lerForecast, mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, totalInformadoForecast, type ForecastLinha } from '../lib/forecastDraft'
import './forecast.css'

const kg = (valor: number) => valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const somaExibida = (linhas: ForecastLinha[], meses: string[]) => { const valor = totalInformadoForecast(linhas, meses); return valor == null ? '—' : kg(valor) }
export function Forecast({ usuario }: { usuario: UsuarioApp }) {
  const gestao = temVisaoComercial(usuario)
  const vendedores = gestao ? [{ id: 'demo-a', nome: 'Vendedor exemplo A' }, { id: 'demo-b', nome: 'Vendedor exemplo B' }] : [{ id: usuario.id, nome: usuario.nome || 'Minha previsão' }]
  const storageKey = `colornet:forecast-demo:v1:${APP_ENV_LABEL}:${usuario.id}:${usuario.perfil}`
  const [inicio, setInicio] = useState(mesAtualForecast)
  const [inicial] = useState(() => {
    try { return { salvo: lerForecast(localStorage.getItem(storageKey), vendedores.map(v => v.id)), erro: '' } }
    catch { return { salvo: null, erro: 'O navegador não permite salvar o rascunho. Exporte para Excel antes de fechar.' } }
  })
  const [linhas, setLinhas] = useState<ForecastLinha[]>(() => inicial.salvo?.linhas ?? exemploForecast(inicio, vendedores.map(v => v.id)))
  const [salvoEm, setSalvoEm] = useState(inicial.salvo?.salvoEm || '')
  const [erro, setErro] = useState(inicial.erro)
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState<'preencher' | 'consolidado'>('preencher')
  const [busca, setBusca] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [novo, setNovo] = useState(false)
  const [clienteId, setClienteId] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [vendedorId, setVendedorId] = useState(vendedores[0].id)
  const [exportando, setExportando] = useState(false)
  const meses = useMemo(() => mesesForecast(inicio), [inicio])
  const idsMeses = meses.map(m => m.id)
  const filtro = busca.trim().toLocaleLowerCase('pt-BR')
  const visiveis = linhas.filter(linha => (!vendedorFiltro || linha.vendedorId === vendedorFiltro) && [clientesExemplo.find(c => c.id === linha.clienteId), produtosExemplo.find(p => p.id === linha.produtoId)].some(item => `${item?.nome} ${item?.codigo}`.toLocaleLowerCase('pt-BR').includes(filtro)))
  const preenchidas = visiveis.reduce((n, linha) => n + meses.filter(m => quantidadeForecast(linha.quantidades[m.id]) !== null).length, 0)
  const invalidas = visiveis.some(linha => meses.some(m => Boolean(linha.quantidades[m.id]?.trim()) && quantidadeForecast(linha.quantidades[m.id]) === null))
  const grupos = produtosExemplo.map(produto => ({ produto, linhas: visiveis.filter(linha => linha.produtoId === produto.id) })).filter(grupo => grupo.linhas.length)
  const total = totalForecast(visiveis, idsMeses)
  const maximoMes = Math.max(1, ...idsMeses.map(mes => totalForecast(visiveis, [mes])))

  function salvar(proximas: ForecastLinha[]) {
    setLinhas(proximas)
    try {
      const agora = new Date().toISOString()
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, linhas: proximas, salvoEm: agora }))
      setSalvoEm(agora); setErro('')
    } catch { setErro('Não foi possível salvar neste navegador. Mantenha a tela aberta e exporte o rascunho para Excel.') }
  }
  function adicionar() {
    if (!clienteId || !produtoId) { setAviso('Selecione cliente e produto para adicionar a previsão.'); return }
    if (linhas.some(l => l.clienteId === clienteId && l.produtoId === produtoId && l.vendedorId === vendedorId)) { setAviso('Essa combinação já está na grade. Preencha os meses na linha existente.'); return }
    if (linhas.length >= 200) { setAviso('Este rascunho permite até 200 linhas.'); return }
    salvar([...linhas, { id: crypto.randomUUID(), clienteId, produtoId, vendedorId, quantidades: {} }])
    setNovo(false); setClienteId(''); setProdutoId(''); setBusca(''); setVendedorFiltro(''); setAba('preencher'); setAviso('Linha adicionada. Preencha as quantidades previstas em kg.')
  }
  async function exportar() {
    if (invalidas || !visiveis.length || exportando) return
    setExportando(true); setAviso('')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sobre = workbook.addWorksheet('Leia primeiro')
      sobre.addRows([['COLORNET — FORECAST DEMONSTRATIVO'], ['Dados fictícios para avaliação do rascunho da homologação.'], ['Não representa previsões reais ou pedidos.'], ['Unidade', 'kg'], ['Período', `${meses[0].label} a ${meses[11].label}`], ['Filtro de busca', busca || 'Todos'], ['Vendedor', vendedores.find(v => v.id === vendedorFiltro)?.nome || 'Todos disponíveis'], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })]])
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
    <div className="page-header"><div><span className="eyebrow">PLANEJAMENTO COMERCIAL</span><h1>Forecast de vendas</h1><p>Previsão mensal por cliente e produto, em kg.</p></div>
      <button type="button" className="secondary-button" onClick={exportar} disabled={exportando || invalidas || !visiveis.length}>{exportando ? 'Gerando Excel...' : 'Exportar Excel'}</button></div>
    <div className="forecast-demo"><strong>Rascunho demonstrativo · homologação</strong><p>Clientes, vendedores e volumes de exemplo. As alterações ficam apenas neste navegador, para este usuário. O consolidado reúne somente as linhas deste rascunho.</p></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {aviso && <div className="alert" role="status">{aviso}</div>}
    <div className="forecast-filters">
      <label>Início dos 12 meses<input type="month" min="2020-01" max="2100-01" value={inicio} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setInicio(e.target.value) }} /></label>
      <label className="forecast-search">Cliente, produto ou código<input type="search" placeholder="Pesquisar neste rascunho..." value={busca} onChange={e => setBusca(e.target.value)} /></label>
      {gestao && <label>Vendedor<select value={vendedorFiltro} onChange={e => setVendedorFiltro(e.target.value)}><option value="">Todos os vendedores de exemplo</option>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
    </div>
    <div className="forecast-metrics">
      <div><span>Previsto no período</span><strong>{kg(total)} <small>kg</small></strong><p>Conforme os filtros selecionados</p></div>
      <div><span>Clientes</span><strong>{new Set(visiveis.map(l => l.clienteId)).size}</strong><p>Com linhas de planejamento</p></div>
      <div><span>Produtos / códigos</span><strong>{grupos.length}</strong><p>Cada variante tem sua previsão</p></div>
      <div><span>Preenchimento</span><strong>{visiveis.length ? Math.round(preenchidas / (visiveis.length * 12) * 100) : 0}%</strong><p>{preenchidas} de {visiveis.length * 12} campos mensais</p></div>
    </div>
    <div className="forecast-toolbar"><div className="forecast-tabs" aria-label="Visualização do forecast">
      <button type="button" aria-pressed={aba === 'preencher'} onClick={() => setAba('preencher')}>Preenchimento</button>
      {gestao && <button type="button" aria-pressed={aba === 'consolidado'} onClick={() => setAba('consolidado')}>Consolidado por produto</button>}
    </div><button type="button" className="primary-button" onClick={() => { setNovo(!novo); setAviso('') }}><Icon name={novo ? 'close' : 'plus'} />{novo ? 'Fechar inclusão' : 'Adicionar previsão'}</button></div>
    {novo && <div className="form-card forecast-add"><h2>Nova linha de previsão</h2><div className="forecast-filters">
      {gestao && <label>Vendedor da previsão<select value={vendedorId} onChange={e => setVendedorId(e.target.value)}>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
      <label>Cliente da previsão<select value={clienteId} onChange={e => setClienteId(e.target.value)}><option value="">Selecione o cliente de exemplo</option>{clientesExemplo.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.codigo}</option>)}</select></label>
      <label>Produto da previsão<select value={produtoId} onChange={e => setProdutoId(e.target.value)}><option value="">Selecione o produto de exemplo</option>{produtosExemplo.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label>
    </div><button type="button" className="primary-button" onClick={adicionar}>Adicionar à grade</button></div>}
    <div className="forecast-grid-card">
      <div className="forecast-grid-heading"><div><h2>{aba === 'preencher' ? 'Planejamento mês a mês' : 'Demanda prevista por produto'}</h2><p>{aba === 'preencher' ? 'Digite as quantidades em kg. Vazio = não informado; 0 = sem venda prevista.' : 'Soma das previsões dos clientes e vendedores filtrados, separada por código.'}</p></div><span>{meses[0].label} — {meses[11].label}</span></div>
      {invalidas && <p className="forecast-invalid" role="alert">Revise os campos destacados: use valores de 0 a 999.999.999 kg, com até 3 casas decimais. Corrija antes de exportar.</p>}
      <div className="forecast-table-wrap" tabIndex={0} role="region" aria-label="Grade de previsão mensal com rolagem horizontal">
        <table className="forecast-table"><thead><tr><th scope="col">{aba === 'preencher' ? 'Cliente / Produto' : 'Produto / Código'}</th>{meses.map(m => <th scope="col" key={m.id}>{m.label}<small>kg</small></th>)}<th scope="col">Total kg</th>{aba === 'preencher' && <th scope="col">Ações</th>}</tr></thead>
          <tbody>{aba === 'preencher' ? visiveis.map(linha => {
            const cliente = clientesExemplo.find(c => c.id === linha.clienteId)!, produto = produtosExemplo.find(p => p.id === linha.produtoId)!
            return <tr key={linha.id}><th scope="row"><strong>{cliente.nome}</strong><span>{produto.nome}</span><code>{produto.codigo}</code><small>{vendedores.find(v => v.id === linha.vendedorId)?.nome}</small></th>
              {meses.map(m => { const valor = linha.quantidades[m.id] ?? ''; const invalido = Boolean(valor.trim()) && quantidadeForecast(valor) === null; return <td key={m.id}><input type="text" inputMode="decimal" maxLength={20} aria-label={`${cliente.nome}, ${produto.codigo}, ${m.label}, kg`} aria-invalid={invalido} placeholder="—" value={valor} onChange={e => salvar(linhas.map(l => l.id === linha.id ? { ...l, quantidades: { ...l.quantidades, [m.id]: e.target.value } } : l))} /></td> })}
              <td className="forecast-row-total">{somaExibida([linha], idsMeses)}</td><td><button type="button" className="danger-link" aria-label={`Remover previsão de ${cliente.nome}, ${produto.codigo}`} onClick={() => { if (window.confirm('Remover esta linha do rascunho demonstrativo?')) salvar(linhas.filter(l => l.id !== linha.id)) }}>Remover</button></td></tr>
          }) : grupos.map(grupo => <tr key={grupo.produto.id}><th scope="row"><strong>{grupo.produto.nome}</strong><code>{grupo.produto.codigo}</code><small>{new Set(grupo.linhas.map(l => l.clienteId)).size} cliente(s)</small></th>{meses.map(m => <td key={m.id}>{somaExibida(grupo.linhas, [m.id])}</td>)}<td className="forecast-row-total">{somaExibida(grupo.linhas, idsMeses)}</td></tr>)}
          {!visiveis.length && <tr><td className="empty-cell" colSpan={aba === 'preencher' ? 15 : 14}>Nenhuma previsão neste filtro. Adicione uma linha ou ajuste a busca.</td></tr>}</tbody>
          {visiveis.length > 0 && <tfoot><tr><th scope="row">Total previsto (kg)</th>{meses.map(m => <td key={m.id}>{somaExibida(visiveis, [m.id])}</td>)}<td>{somaExibida(visiveis, idsMeses)}</td>{aba === 'preencher' && <td />}</tr></tfoot>}
        </table>
      </div><div className="forecast-grid-footer"><span>↔ Role a grade para consultar todos os meses.</span><span role="status">{salvoEm ? `Salvo neste navegador às ${new Date(salvoEm).toLocaleTimeString('pt-BR')}` : 'Edite uma quantidade para salvar seu rascunho.'}</span></div>
    </div>
    <div className="form-card forecast-chart"><h2>Distribuição mensal prevista</h2><p>Volumes demonstrativos, conforme os filtros acima.</p><div className="forecast-bars">{meses.map(m => { const valor = totalForecast(visiveis, [m.id]); return <div key={m.id}><span>{somaExibida(visiveis, [m.id])}</span><div className="forecast-bar-track"><div style={{ height: `${valor / maximoMes * 100}%` }} /></div><small>{m.label}</small></div> })}</div></div>
  </section>
}
