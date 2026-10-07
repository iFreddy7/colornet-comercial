import { useState } from 'react'
import type { UsuarioApp } from '../types'
import { APP_ENV_LABEL } from '../lib/env'
import { temVisaoComercial } from '../lib/permissoes'
import { lerForecast, mesesForecast, mesAtualForecast, quantidadeForecast, totalForecast, type ForecastLinha } from '../lib/forecastDraft'
import { carregarPlano, salvarForecast, linhasDosPlanos, type ForecastDados } from '../lib/forecastSupabase'
import './forecast.css'

type Formulario = { clienteId: string; vendedorId: string; inicio: string; itens: ForecastLinha[]; produtoId: string; quantidades: Record<string, string>; editandoId: string; revisao: number | null }
export function LancarForecast({ usuario, onConsultar, dados }: { usuario: UsuarioApp; onConsultar: () => void; dados: ForecastDados }) {
  const gestao = temVisaoComercial(usuario)
  const vendedores = dados.vendedores.filter(v => v.ativo && (gestao || v.id === usuario.vendedor_id))
  const clientesCadastro = dados.clientes
  const produtosCadastro = dados.produtos
  const draftKey = 'colornet:forecast-supabase-form:v1:' + APP_ENV_LABEL + ':' + usuario.id + ':' + usuario.perfil
  const vazio = (): Formulario => ({ clienteId: '', vendedorId: vendedores[0].id, inicio: mesAtualForecast(), itens: [], produtoId: '', quantidades: {}, editandoId: '', revisao: null })
  const [form, setForm] = useState<Formulario>(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw || raw.length > 1_000_000) return vazio()
      const salvo = JSON.parse(raw)
      if (!salvo || !(salvo.revisao == null || (Number.isSafeInteger(salvo.revisao) && salvo.revisao >= 0)) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(salvo.inicio) || !vendedores.some(v => v.id === salvo.vendedorId) || (salvo.clienteId && !clientesCadastro.some(c => c.id === salvo.clienteId))) return vazio()
      const itens = lerForecast(JSON.stringify({ version: 1, salvoEm: new Date().toISOString(), linhas: salvo.itens }), vendedores.map(v => v.id), clientesCadastro, produtosCadastro)
      if (!itens || itens.linhas.some(l => l.clienteId !== salvo.clienteId || l.vendedorId !== salvo.vendedorId)) return vazio()
      if (salvo.produtoId && !produtosCadastro.some(p => p.id === salvo.produtoId)) return vazio()
      if (!salvo.quantidades || typeof salvo.quantidades !== 'object' || Array.isArray(salvo.quantidades) || Object.entries(salvo.quantidades).some(([m, q]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || typeof q !== 'string' || q.length > 20)) return vazio()
      if (typeof salvo.editandoId !== 'string' || (salvo.editandoId && !itens.linhas.some(l => l.id === salvo.editandoId))) return vazio()
      return { ...salvo, itens: itens.linhas }
    } catch { return vazio() }
  })
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [revisando, setRevisando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState(() => {
    const selecionado = clientesCadastro.find(c => c.id === form.clienteId)
    return selecionado ? `${selecionado.codigo} — ${selecionado.nome}` : ''
  })
  const [buscaProduto, setBuscaProduto] = useState('')
  const [salvo, setSalvo] = useState(false)
  const meses = mesesForecast(form.inicio)
  const idsMeses = meses.map(m => m.id)
  const cliente = clientesCadastro.find(c => c.id === form.clienteId)
  const normalizarBusca = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ')
  const termoCliente = normalizarBusca(buscaCliente)
  const clientesEncontrados = clientesCadastro.filter(c => c.ativo && [c.nome, c.codigo, c.nomeFantasia || ''].some(valor => normalizarBusca(valor).includes(termoCliente)))
  const vendedor = vendedores.find(v => v.id === form.vendedorId)
  const kg = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

  function alterar(patch: Partial<Formulario>) {
    const contextoMudou = (patch.clienteId != null && patch.clienteId !== form.clienteId) || (patch.vendedorId != null && patch.vendedorId !== form.vendedorId) || (patch.inicio != null && patch.inicio !== form.inicio)
    const proximo = { ...form, ...patch, revisao: contextoMudou ? null : patch.revisao === undefined ? form.revisao : patch.revisao }
    setForm(proximo); setErro(''); setAviso(''); setSalvo(false)
    try { localStorage.setItem(draftKey, JSON.stringify(proximo)) }
    catch { setErro('Não foi possível guardar o rascunho neste navegador. Mantenha esta tela aberta até salvar o forecast.') }
  }
  async function carregarExistente() {
    if (ocupado) return
    setOcupado(true); setErro('')
    try {
      const plano = await carregarPlano(form.clienteId, form.vendedorId)
      const base = plano ? linhasDosPlanos([plano]) : []
      const itens = base.filter(l => idsMeses.some(m => l.quantidades[m]?.trim())).map(l => ({ ...l, quantidades: Object.fromEntries(idsMeses.map(m => [m, l.quantidades[m] || ''])) }))
      alterar({ itens, produtoId: '', quantidades: {}, editandoId: '', revisao: plano?.revisao || 0 })
      setRevisando(false)
      setAviso(itens.length ? 'Previsão carregada do Supabase. Revise antes de salvar alterações.' : 'Ainda não há quantidades salvas para este período. Inclua os produtos.')
    } catch (e) { setErro((e as {message?:string})?.message || 'Não foi possível carregar a previsão.') }
    finally { setOcupado(false) }
  }
  function adicionarProduto() {
    if (dados.planos.some(p => p.cliente_id === form.clienteId && p.vendedor_id === form.vendedorId) && form.revisao == null) { setErro('Já existe uma previsão deste cliente e vendedor. Carregue a previsão existente antes de editar.'); return }
    if (!clientesCadastro.some(c => c.id === form.clienteId && c.ativo) || !produtosCadastro.some(p => p.id === form.produtoId && p.ativo)) { setErro('Selecione cliente e produto ativos.'); return }
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
  async function salvar() {
    if (ocupado) return
    setOcupado(true); setErro('')
    try {
      await salvarForecast(form.clienteId, form.vendedorId, form.inicio, form.itens, form.revisao ?? 0)
      setSalvo(true); setRevisando(false); setErro(''); setAviso('Forecast salvo no Supabase da homologação. Já está disponível para consulta e relatório.')
      try { localStorage.removeItem(draftKey) } catch { /* O forecast já foi salvo no servidor. */ }
    } catch (e) { setErro((e as {message?:string})?.message || 'Não foi possível salvar no Supabase. Seu formulário foi preservado.') }
    finally { setOcupado(false) }
  }
  return <section className="page forecast-page">
    <div className="page-header"><div><span className="eyebrow">PLANEJAMENTO COMERCIAL</span><h1>Lançar forecast</h1><p>Preencha os dados, adicione os produtos e revise antes de salvar.</p></div></div>
    <div className="forecast-demo"><strong>Forecast em teste · homologação</strong><p>Cadastros reais da homologação. Ao salvar, a previsão fica no Supabase e pode ser consultada pelos usuários autorizados. O rascunho ainda não enviado fica neste navegador.</p></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {aviso && <div className="alert" role="status">{aviso}</div>}
    {salvo ? <div className="form-card forecast-success"><h2>Forecast salvo</h2><p>{cliente?.nome} · {vendedor?.nome} · {meses[0].label} a {meses[11].label}</p><button type="button" className="primary-button" onClick={onConsultar}>Consultar forecast e gerar relatório</button><button type="button" className="secondary-button" onClick={() => alterar(vazio())}>Lançar outro forecast</button></div> : revisando ? <div className="form-card">
      <div className="section-title"><span>✓</span><div><strong>Revisão do forecast</strong><small>Confira as informações antes de salvar.</small></div></div>
      <p><strong>Cliente:</strong> {cliente?.nome} · {cliente?.codigo}</p><p><strong>Vendedor:</strong> {vendedor?.nome}</p><p><strong>Período:</strong> {meses[0].label} a {meses[11].label} · Quantidades em kg</p>
      <div className="forecast-table-wrap"><table className="forecast-table"><thead><tr><th>Produto</th>{meses.map(m => <th key={m.id}>{m.label}</th>)}<th>Total kg</th></tr></thead><tbody>{form.itens.map(l => <tr key={l.id}><th><strong>{produtosCadastro.find(p => p.id === l.produtoId)?.nome}</strong><code>{produtosCadastro.find(p => p.id === l.produtoId)?.codigo}</code></th>{meses.map(m => <td key={m.id}>{quantidadeForecast(l.quantidades[m.id]) == null ? '—' : kg(quantidadeForecast(l.quantidades[m.id])!)}</td>)}<td>{kg(totalForecast([l], idsMeses))}</td></tr>)}</tbody></table></div>
      <p className="forecast-save-note">Ao salvar, esta lista substituirá a previsão deste cliente e vendedor nos 12 meses selecionados. Outros clientes, vendedores e períodos serão preservados.</p>
      <div className="forecast-form-actions">{erro && <button type="button" className="secondary-button" disabled={ocupado} onClick={() => void carregarExistente()}>Recarregar previsão salva</button>}<button type="button" className="secondary-button" disabled={ocupado} onClick={() => setRevisando(false)}>Voltar e editar</button><button type="button" className="primary-button" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? 'Salvando...' : 'Salvar forecast'}</button></div>
    </div> : <form onSubmit={e => { e.preventDefault(); revisar() }}>
      <fieldset className="forecast-fieldset" disabled={ocupado}><div className="form-card"><div className="section-title"><span>1</span><div><strong>Dados do forecast</strong><small>Cliente, responsável e período do planejamento.</small></div></div>
        <div className="field autocomplete-wrap forecast-product-field">
          <label htmlFor="forecast-cliente">Cliente *</label>
          <input id="forecast-cliente" type="search" autoComplete="off" required
            value={form.clienteId ? `${cliente?.codigo || ''} — ${cliente?.nome || ''}` : buscaCliente}
            disabled={form.itens.length > 0 || Boolean(form.editandoId)}
            onChange={e => { setBuscaCliente(e.target.value); alterar({ clienteId: '', produtoId: '', quantidades: {} }) }}
            placeholder={gestao ? 'Pesquise qualquer cliente...' : 'Pesquise sua carteira...'} />
          {termoCliente && !form.clienteId && <div className="autocomplete" role="region" aria-label="Clientes encontrados">
            {clientesEncontrados.slice(0, 50).map(c => <button type="button" key={c.id} onClick={() => { alterar({ clienteId: c.id }); setBuscaCliente('') }}>
              <strong>{c.codigo} — {c.nome}</strong>{c.nomeFantasia && <span>{c.nomeFantasia}</span>}
            </button>)}
            {!clientesEncontrados.length && <div className="autocomplete-empty" role="status">Nenhum cliente disponível para seu acesso.</div>}
            {clientesEncontrados.length > 50 && <div className="autocomplete-empty">Mostrando 50 de {clientesEncontrados.length} clientes. Digite mais para refinar a busca.</div>}
          </div>}
        </div>
        <div className="forecast-filters">
          {gestao && <label>Vendedor responsável *<select disabled={form.itens.length > 0 || Boolean(form.editandoId)} value={form.vendedorId} onChange={e => alterar({ vendedorId: e.target.value })}>{vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></label>}
          <label>Início dos 12 meses *<input type="month" required min="2020-01" max="2099-01" disabled={form.itens.length > 0 || Boolean(form.produtoId)} value={form.inicio} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) alterar({ inicio: e.target.value }) }} /></label>
        </div>
        <div className="forecast-form-meta"><span>Responsável: <strong>{vendedor?.nome}</strong></span><span>Quantidades em <strong>kg</strong></span><span>{meses[0].label} a {meses[11].label}</span></div>
        {form.clienteId && !form.itens.length && !form.produtoId && <button type="button" className="secondary-button forecast-load" onClick={() => void carregarExistente()}>Carregar previsão existente para editar</button>}
        {form.itens.length > 0 && <p className="forecast-save-note">Cliente, vendedor e período ficam fixos enquanto houver itens neste formulário.</p>}
      </div>
      <div className="form-card"><div className="section-title"><span>2</span><div><strong>{form.editandoId ? 'Editar produto' : 'Adicionar produto'}</strong><small>Selecione o produto e informe as quantidades previstas para cada mês.</small></div></div>
        <label className="forecast-product-field">Buscar produto<input type="search" value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)} placeholder="Nome ou código do produto" /></label>
        <label className="forecast-product-field">Produto *<select disabled={!form.clienteId} value={form.produtoId} onChange={e => alterar({ produtoId: e.target.value })}><option value="">{form.clienteId ? 'Selecione o produto e código' : 'Selecione primeiro o cliente'}</option>{produtosCadastro.filter(p => p.ativo && (!buscaProduto || (p.nome + ' ' + p.codigo).toLocaleLowerCase('pt-BR').includes(buscaProduto.toLocaleLowerCase('pt-BR')) || p.id === form.produtoId)).map(p => <option key={p.id} value={p.id}>{p.nome} · {p.codigo}</option>)}</select></label>
        {form.produtoId && <><div className="forecast-month-fields">{meses.map(m => <label key={m.id}>{m.label}<small>Quantidade (kg)</small><input type="text" inputMode="decimal" maxLength={20} aria-label={'Quantidade ' + m.label} value={form.quantidades[m.id] || ''} placeholder="Não informado" onChange={e => alterar({ quantidades: { ...form.quantidades, [m.id]: e.target.value } })} /></label>)}</div><p className="forecast-save-note">Preencha os meses com venda prevista. Use 0 para indicar que não haverá venda; deixe vazio se ainda não souber.</p>
          <div className="forecast-form-actions"><button type="button" className="primary-button" onClick={adicionarProduto}>{form.editandoId ? 'Salvar alterações do produto' : 'Adicionar produto ao forecast'}</button><button type="button" className="secondary-button" onClick={() => alterar({ produtoId: '', quantidades: {}, editandoId: '' })}>Cancelar {form.editandoId ? 'edição' : 'inclusão'}</button></div></>}
      </div>
      <div className="form-card"><div className="section-title"><span>3</span><div><strong>Itens do forecast</strong><small>{form.itens.length} produto(s) adicionado(s).</small></div></div>
        <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Código</th><th>Meses informados</th><th>Total kg</th><th>Ações</th></tr></thead><tbody>{form.itens.map(l => <tr key={l.id}><td>{produtosCadastro.find(p => p.id === l.produtoId)?.nome}</td><td>{produtosCadastro.find(p => p.id === l.produtoId)?.codigo}</td><td>{idsMeses.filter(m => quantidadeForecast(l.quantidades[m]) !== null).length} de 12</td><td>{kg(totalForecast([l], idsMeses))}</td><td><button type="button" className="secondary-button" disabled={Boolean(form.produtoId)} onClick={() => alterar({ produtoId: l.produtoId, quantidades: { ...l.quantidades }, editandoId: l.id })}>Editar</button><button type="button" className="danger-link" disabled={Boolean(form.produtoId)} onClick={() => alterar({ itens: form.itens.filter(i => i.id !== l.id) })}>Excluir</button></td></tr>)}{!form.itens.length && <tr><td colSpan={5} className="empty-cell">Nenhum produto adicionado.</td></tr>}</tbody></table></div>
        <div className="forecast-form-actions"><strong>Total previsto: {kg(totalForecast(form.itens, idsMeses))} kg</strong><button type="submit" className="primary-button" disabled={!form.itens.length}>Revisar forecast</button></div>
      </div>
      </fieldset>
    </form>}
  </section>
}

