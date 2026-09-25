import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { temVisaoComercial } from '../lib/permissoes'
import type { Filial, UsuarioApp } from '../types'
import type { VendedorAdmin } from '../components/AdminNovoUsuario'
import { AdminExportacao } from '../components/AdminExportacao'
import { Loading } from '../components/Loading'
import { ExportacaoCotacoes } from '../components/ExportacaoCotacoes'

export function Relatorios({ usuario }: { usuario: UsuarioApp }) {
  const [dados, setDados] = useState<{ vendedores: VendedorAdmin[]; filiais: Filial[] } | null>(null)
  const [erro, setErro] = useState('')
  const permitido = temVisaoComercial(usuario)

  useEffect(() => {
    if (!permitido) return
    let ativo = true
    setDados(null); setErro('')
    Promise.all([
      supabase.from('vendedores').select('id,nome,codigo_protheus,ativo').order('nome'),
      supabase.from('filiais').select('id,codigo,nome,uf,ativo').order('nome'),
    ]).then(([vendedores, filiais]) => {
      if (!ativo) return
      if (vendedores.error || filiais.error) {
        setErro('Não foi possível carregar os filtros. Atualize a página e tente novamente.')
        return
      }
      setDados({ vendedores: vendedores.data as VendedorAdmin[], filiais: filiais.data as Filial[] })
    }).catch(() => { if (ativo) setErro('Não foi possível carregar os filtros. Tente novamente.') })
    return () => { ativo = false }
  }, [permitido, usuario.id])

  if (!permitido) return <div className="alert error">Acesso restrito à gestão comercial.</div>
  return <section className="page">
    <div className="page-header"><div><span className="eyebrow">GESTÃO COMERCIAL</span>
      <h1>Relatórios comerciais</h1><p>Consulte e exporte pedidos e cotações de todos os vendedores e clientes.</p>
    </div></div>
    {erro && <div className="alert error" role="alert">{erro}</div>}
    {!dados && !erro && <Loading texto="Carregando filtros..." />}
    {dados && <><ExportacaoCotacoes vendedores={dados.vendedores} /><AdminExportacao {...dados} comercial /></>}
  </section>
}
