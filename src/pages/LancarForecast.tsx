import { useState } from 'react'
import type { UsuarioApp } from '../types'
import { APP_ENV_LABEL } from '../lib/env'
import { temVisaoComercial } from '../lib/permissoes'
import { clientesExemplo, produtosExemplo, exemploForecast, lerForecast, mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, atualizarForecastPeriodo, type ForecastLinha } from '../lib/forecastDraft'
import './forecast.css'

type Formulario = { clienteId: string; vendedorId: string; inicio: string; itens: ForecastLinha[]; produtoId: string; quantidades: Record<string, string>; editandoId: string }
export function LancarForecast({ usuario, onConsultar }: { usuario: UsuarioApp; onConsultar: () => void }) {
  const gestao = temVisaoComercial(usuario)
  const vendedores = gestao ? [{ id: 'demo-a', nome: 'Vendedor exemplo A' }, { id: 'demo-b', nome: 'Vendedor exemplo B' }] : [{ id: usuario.id, nome: usuario.nome || 'Minha previsão' }]
  const storageKey = 'colornet:forecast-demo:v1:' + APP_ENV_LABEL + ':' + usuario.id + ':' + usuario.perfil
  const draftKey = storageKey + ':formulario'
  const vazio = (): Formulario => ({ clienteId: '', vendedorId: vendedores[0].id, inicio: mesAtualForecast(), itens: [], produtoId: '', quantidades: {}, editandoId: '' })
  const [form, setForm] = useState<Formulario>(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw || raw.length > 1_000_000) return vazio()
      const salvo = JSON.parse(raw)
      if (!salvo || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(salvo.inicio) || !vendedores.some(v => v.id === salvo.vendedorId) || (salvo.clienteId && !clientesExemplo.some(c => c.id === salvo.clienteId))) return vazio()
      const itens = lerForecast(JSON.stringify({ version: 1, salvoEm: new Date().toISOString(), linhas: salvo.itens }), vendedores.map(v => v.id))
      if (!itens || itens.linhas.some(l => l.clienteId !== salvo.clienteId || l.vendedorId !== salvo.vendedorId)) return vazio()
      if (salvo.produtoId && !produtosExemplo.some(p => p.id === salvo.produtoId)) return vazio()
      if (!salvo.quantidades || typeof salvo.quantidades !== 'object' || Array.isArray(salvo.quantidades) || Object.entries(salvo.quantidades).some(([m, q]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || typeof q !== 'string' || q.length > 20)) return vazio()
      if (typeof salvo.editandoId !== 'string' || (salvo.editandoId && !itens.linhas.some(l => l.id === salvo.editandoId))) return vazio()
      return { ...salvo, itens: itens.linhas }
    } catch { return vazio() }
  })
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [revisando, setRevisando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const meses = mesesForecast(form.inicio)
  const idsMeses = meses.map(m => m.id)
  const cliente = clientesExemplo.find(c => c.id === form.clienteId)
  const vendedor = vendedores.find(v => v.id === form.vendedorId)
  const kg = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

  function alterar(patch: Partial<Formulario>) {
    const proximo = { ...form, ...patch }
    setForm(proximo); setErro(''); setAviso(''); setSalvo(false)
    try { localStorage.setItem(draftKey, JSON.stringify(proximo)) }
    catch { setErro('Não foi possível guardar o rascunho neste navegador. Mantenha esta tela aberta até salvar o forecast.') }
  }
  function carregarExistente() {
    try {
      const base = lerForecast(localStorage.getItem(storageKey), vendedores.map(v => v.id))?.linhas ?? exemploForecast(mesAtualForecast(), vendedores.map(v => v.id))
      const itens = base.filter(l => l.clienteId === form.clienteId && l.vendedorId === form.vendedorId && idsMeses.some(m => l.quantidades[m]?.trim())).map(l => ({ ...l, quantidades: Object.fromEntries(idsMeses.map(m => [m, l.quantidades[m] || ''])) }))
      alterar({ itens, produtoId: '', quantidades: {}, editandoId: '' })
      setAviso(itens.length ? 'Previsão carregada para edição. A consulta só muda após revisar e salvar.' : 'Não há previsão salva para este cliente, vendedor e período.')
    } catch { setErro('Não foi possível carregar a previsão salva neste navegador.') }
  }
  function adicionarProduto() {
    if (!form.clienteId || !form.produtoId) { setErro('Selecione o cliente e o produto.'); return }
    if (idsMeses.some(m => Boolean(form.quantidades[m]?.trim()) && quantidadeForecast(form.quantidades[m]) === null)) { setErro('Revise as quantidades. Informe números de 0 a 999.999.999, com até 3 casas decimais.'); return }
    if (!idsMeses.some(m => quantidadeForecast(form.quantidades[m]) !== null)) { setErro('Informe a quantidade de pelo menos um mês. Zero é permitido.'); return }
    if (form.itens.some(l => l.produtoId === form.produtoId && l.id !== form.editandoId)) { setErro('Esse código já foi adicionado. Use Editar no item existente.'); return }
    if (!form.editandoId && form.itens.length >= 200) { setErro('Este rascunho permite até 200 produtos.'); return }
    const item: ForecastLinha = { id: form.editandoId || crypto.randomUUID(), clienteId: form.clienteId, vendedorId: form.vendedorId, produtoId: form.produtoId, quantidades: { ...form.quantidades } }
    alterar({ itens: form.editandoId ? form.itens.map(l => l.id === form.editandoId ? item : l) : [...form.itens, item], produtoId: '', quantidades: {}, editandoId: '' })
    setAviso('Produto incluído no formulário. Revise e salve para aparecer na consulta.')
  }
  function revisar() {
    if (!form.clienteId || !form.itens.length) { setErro('Selecione o cliente e adicione pelo menos um produto.'); return }
    if (form.produtoId || form.editandoId) { setErro('Conclua a inclusão ou edição do produto antes de revisar.'); return }
    if (form.itens.some(l => !idsMeses.some(m => quantidadeForecast(l.quantidades[m]) !== null) || idsMeses.some(m => Boolean(l.quantidades[m]?.trim()) && quantidadeForecast(l.quantidades[m]) === null))) { setErro('Revise as quantidades dos itens. Cada produto precisa de pelo menos um mês válido.'); return }
    setErro(''); setAviso(''); setRevisando(true)
  }
  function salvar() {
    try {
      const base = lerForecast(localStorage.getItem(storageKey), vendedores.map(v => v.id))?.linhas ?? exemploForecast(mesAtualForecast(), vendedores.map(v => v.id))
      const proximas = atualizarForecastPeriodo(base, form.itens, form.clienteId, form.vendedorId, idsMeses)
      if (proximas.length > 200) { setErro('O limite de 200 linhas do rascunho foi atingido.'); return }
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, linhas: proximas, salvoEm: new Date().toISOString() }))
      setSalvo(true); setRevisando(false); setErro(''); setAviso('Forecast salvo. Ele já pode ser consultado e exportado neste navegador.')
      try { localStorage.removeItem(draftKey) } catch { /* O forecast já foi salvo. */ }
    } catch { setErro('Não foi possível salvar o forecast neste navegador. Nenhuma confirmação de salvamento foi recebida.') }
  }
  return <section className="page forecast-page">
    <div className="page-header"><div><span className="eyebrow">PLANEJAMENTO COMERCIAL</span><h1>Lançar forecast</h1><p>Preencha os dados, adicione os produtos e revise antes de salvar.</p></div></div>
    <div className="forecast-demo"><strong>Rascunho demonstrativo · homologação</strong><p>Dados de exemplo, salvos apenas neste navegador. O formulário só entra na consulta após clicar em “Salvar forecast”.</p></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {aviso && <div className="alert" role="status">{aviso}</div>}
    {salvo ? <div className="form-card forecast-success"><h2>Forecast salvo</h2><p>{cliente?.nome} · {vendedor?.nome} · {meses[0].label} a {meses[11].label}</p><button type="button" className="primary-button" onClick={onConsultar}>Consultar forecast e gerar relatório</button><button type="button" className="secondary-button" onClick={() => alterar(vazio())}>Lançar outro forecast</button></div> : revisando ? <div className="form-card">
      <div className="section-title"><span>✓</span><div><strong>Revisão do forecast</strong><small>Confira as informações antes de salvar.</small></div></div>
      <p><strong>Cliente:</strong> {cliente?.nome} · {cliente?.codigo}</p><p><strong>Vendedor:</strong> {vendedor?.nome}</p><p><strong>Período:</strong> {meses[0].label} a {meses[11].label} · Quantidades em kg</p>
      <div className="forecast-table-wrap"><table className="forecast-table"><thead><tr><th>Produto</th>{meses.map(m => <th key={m.id}>{m.label}</th>)}<th>Total kg</th></tr></thead><tbody>{form.itens.map(l => <tr key={l.id}><th><strong>{produtosExemplo.find(p => p.id === l.produtoId)?.nome}</strong><code>{produtosExemplo.find(p => p.id === l.produtoId)?.codigo}</code></th>{meses.map(m => <td key={m.id}>{quantidadeForecast(l.quantidades[m.id]) == null ? '—' : kg(quantidadeForecast(l.quantidades[m.id])!)}</td>)}<td>{kg(totalForecast([l], idsMeses))}</td></tr>)}</tbody></table></div>
      <p className="forecast-save-note">Ao salvar, esta lista substituirá a previsão deste cliente e vendedor nos 12 meses selecionados. Outros clientes, vendedores e períodos serão preservados.</p>
      <div className="forecast-form-actions"><button type="button" className="secondary-button" onClick={() => setRevisando(false)}>Voltar e editar</button><button type="button" className="primary-button" onClick={salvar}>Salvar forecast</button></div>
    </div> : <form onSubmit={e => { e.preventDefault(); revisar() }}>
      <div className="form-card"><div className="section-title"><span>1</span><div><strong>Dados do forecast</strong><small>Cliente, responsável e período do planejamento.</small></div></div>
        <div className="forecast-filters">
          <label>Cliente *<select required disabled={form.itens.length > 0 || Boolean(form.editandoId)} value={form.clienteId} onChange={e => alterar({ clienteId: e.target.value })}><option value="">Selecione o cliente</option>{clientesExemplo.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.codigo}</option>)}</select></label>
          {gestao && <label>Vendedor responsável *<select disabled={form.itens.length > 0 || Boolean(form.editandoId)} value={form.vendedorId} onChange={e => alterar({ vendedorId: e.target.value })}>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
          <label>Início dos 12 meses *<input type="month" required min="2020-01" max="2099-01" disabled={form.itens.length > 0 || Boolean(form.produtoId)} value={form.inicio} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) alterar({ inicio: e.target.value }) }} /></label>
        </div>
        <div className="forecast-form-meta"><span>Responsável: <strong>{vendedor?.nome}</strong></span><span>Quantidades em <strong>kg</strong></span><span>{meses[0].label} a {meses[11].label}</span></div>
        {form.clienteId && !form.itens.length && !form.produtoId && <button type="button" className="secondary-button forecast-load" onClick={carregarExistente}>Carregar previsão existente para editar</button>}
        {form.itens.length > 0 && <p className="forecast-save-note">Cliente, vendedor e período ficam fixos enquanto houver itens neste formulário.</p>}
      </div>
      <div className="form-card"><div className="section-title"><span>2</span><div><strong>{form.editandoId ? 'Editar produto' : 'Adicionar produto'}</strong><small>Selecione o produto e informe as quantidades previstas para cada mês.</small></div></div>
        <label className="forecast-product-field">Produto *<select disabled={!form.clienteId} value={form.produtoId} onChange={e => alterar({ produtoId: e.target.value })}><option value="">{form.clienteId ? 'Selecione o produto e código' : 'Selecione primeiro o cliente'}</option>{produtosExemplo.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label>
        {form.produtoId && <><div className="forecast-month-fields">{meses.map(m => <label key={m.id}>{m.label}<small>Quantidade (kg)</small><input type="text" inputMode="decimal" maxLength={20} aria-label={'Quantidade ' + m.label} value={form.quantidades[m.id] || ''} placeholder="Não informado" onChange={e => alterar({ quantidades: { ...form.quantidades, [m.id]: e.target.value } })} /></label>)}</div><p className="forecast-save-note">Preencha os meses com venda prevista. Use 0 para indicar que não haverá venda; deixe vazio se ainda não souber.</p>
          <div className="forecast-form-actions"><button type="button" className="primary-button" onClick={adicionarProduto}>{form.editandoId ? 'Salvar alterações do produto' : 'Adicionar produto ao forecast'}</button><button type="button" className="secondary-button" onClick={() => alterar({ produtoId: '', quantidades: {}, editandoId: '' })}>Cancelar {form.editandoId ? 'edição' : 'inclusão'}</button></div></>}
      </div>
      <div className="form-card"><div className="section-title"><span>3</span><div><strong>Itens do forecast</strong><small>{form.itens.length} produto(s) adicionado(s).</small></div></div>
        <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Código</th><th>Meses informados</th><th>Total kg</th><th>Ações</th></tr></thead><tbody>{form.itens.map(l => <tr key={l.id}><td>{produtosExemplo.find(p => p.id === l.produtoId)?.nome}</td><td>{produtosExemplo.find(p => p.id === l.produtoId)?.codigo}</td><td>{idsMeses.filter(m => quantidadeForecast(l.quantidades[m]) !== null).length} de 12</td><td>{kg(totalForecast([l], idsMeses))}</td><td><button type="button" className="secondary-button" disabled={Boolean(form.produtoId)} onClick={() => alterar({ produtoId: l.produtoId, quantidades: { ...l.quantidades }, editandoId: l.id })}>Editar</button><button type="button" className="danger-link" disabled={Boolean(form.produtoId)} onClick={() => alterar({ itens: form.itens.filter(i => i.id !== l.id) })}>Excluir</button></td></tr>)}{!form.itens.length && <tr><td colSpan={5} className="empty-cell">Nenhum produto adicionado.</td></tr>}</tbody></table></div>
        <div className="forecast-form-actions"><strong>Total previsto: {kg(totalForecast(form.itens, idsMeses))} kg</strong><button type="submit" className="primary-button" disabled={!form.itens.length}>Revisar forecast</button></div>
      </div>
    </form>}
  </section>
}
