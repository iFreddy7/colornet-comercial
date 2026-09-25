import { useRef, useState } from 'react'
import type { UsuarioApp } from '../types'
import { supabase } from '../lib/supabase'
import { podeAvaliarCotacao, situacoesAviso, situacoesCotacao, type Avaliacao } from '../lib/aprovacaoCotacao'

export function AvaliacaoCotacao({ cotacao, usuario, atualizar }: { cotacao: Avaliacao; usuario: UsuarioApp; atualizar: () => Promise<void> }) {
  const [decisao, setDecisao] = useState<'APROVADA' | 'REPROVADA' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const trava = useRef(false)
  const permitido = podeAvaliarCotacao(usuario)

  async function enviarAviso() {
    const { data, error } = await supabase.functions.invoke('cotacao-decisao-email', { body: { cotacao_id: cotacao.id } })
    if (error) { setMensagem('A decisão está salva. O aviso ainda não foi confirmado; atualize e tente enviar novamente.'); return }
    setMensagem(data?.erro || (data?.aguarde ? 'Aguarde 30 segundos antes de uma nova tentativa.' : ''))
  }
  async function executar(registrar: boolean) {
    if (trava.current) return
    if (registrar && (!decisao || (decisao === 'REPROVADA' && !motivo.trim()))) { setErro('Informe o motivo da reprovação.'); return }
    trava.current = true; setOcupado(true); setErro(''); setMensagem('')
    try {
      if (registrar) {
        const { error } = await supabase.rpc('decidir_cotacao', { p_cotacao_id: cotacao.id, p_decisao: decisao, p_motivo: decisao === 'REPROVADA' ? motivo.trim() : null })
        if (error) throw new Error(error.message)
        setDecisao(null); setMotivo('')
      }
      await enviarAviso()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível confirmar a operação. Atualize a cotação antes de tentar novamente.') }
    finally { await atualizar(); trava.current = false; setOcupado(false) }
  }

  return <div className="quote-review">
    <div className="section-title"><span>✓</span><div><strong>Avaliação comercial</strong><small>{situacoesCotacao[cotacao.aprovacao_status]}</small></div></div>
    {cotacao.aprovacao_em && <p>Decisão de <strong>{cotacao.aprovacao_nome}</strong>, em {new Date(cotacao.aprovacao_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília).</p>}
    {cotacao.aprovacao_motivo && <p className="quote-reason"><strong>Motivo da reprovação:</strong><br />{cotacao.aprovacao_motivo}</p>}
    {cotacao.aprovacao_status !== 'PENDENTE' && <p className="field-help">{situacoesAviso[cotacao.aviso_status]}</p>}
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {mensagem && <div className="alert info" role="status">{mensagem}</div>}
    {cotacao.aprovacao_status === 'PENDENTE' && cotacao.pedido_convertido_id && <p>Esta cotação foi convertida em pedido antes da avaliação.</p>}
    {permitido && cotacao.aprovacao_status === 'PENDENTE' && !cotacao.pedido_convertido_id && <>
      {!decisao ? <div className="quote-actions"><button className="primary-button" disabled={ocupado} onClick={() => setDecisao('APROVADA')}>Aprovar cotação</button><button className="secondary-button" disabled={ocupado} onClick={() => setDecisao('REPROVADA')}>Reprovar cotação</button></div> : <form onSubmit={e => { e.preventDefault(); void executar(true) }}>
        <fieldset className="admin-fieldset" disabled={ocupado}>
          <p>Confirmar a {decisao === 'APROVADA' ? 'aprovação' : 'reprovação'} da cotação <strong>{cotacao.numero}</strong>? A decisão ficará registrada e o aviso será enviado ao vendedor, a João e à Márcia.</p>
          {decisao === 'REPROVADA' && <div className="field"><label htmlFor="cotacao-motivo">Motivo da reprovação</label><textarea id="cotacao-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={2000} required rows={4} /><small>{motivo.length}/2000 caracteres</small></div>}
          <div className="quote-actions"><button className="primary-button" type="submit">{ocupado ? 'Registrando e enviando...' : `Confirmar ${decisao === 'APROVADA' ? 'aprovação' : 'reprovação'}`}</button><button type="button" className="secondary-button" onClick={() => { setDecisao(null); setErro('') }}>Voltar</button></div>
        </fieldset>
      </form>}
    </>}
    {permitido && cotacao.aprovacao_status !== 'PENDENTE' && ['PENDENTE','ERRO'].includes(cotacao.aviso_status) && <button className="secondary-button" disabled={ocupado} onClick={() => void executar(false)}>{ocupado ? 'Enviando...' : 'Enviar aviso pendente'}</button>}
    {cotacao.aprovacao_status !== 'PENDENTE' && <button className="secondary-button" disabled={ocupado} onClick={() => void atualizar()}>Atualizar situação</button>}
  </div>
}
