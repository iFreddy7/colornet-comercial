// Fonte: embalagens.xlsx, Planilha1 A2:B21, fornecida em 21/10/2026.
const pesos: Record<string, number> = {
 BD10:10, BD20:20, BD25:25, SC05:5, SC10:10, SC20:20, SC25:25,
 TB180:180, TB190:190, TB200:200, TB210:210,
 CX03:3, CX05:5, CX10:10, CX20:20, CX25:25,
 BR20:20, BR25:25, BR50:50, IBCK:1000,
}
export function pesoEmbalagem(codigo?: string | null): number | null {
 const normalizado=(codigo||'').trim().toUpperCase()
 const sufixo=Object.keys(pesos).find(key=>normalizado.endsWith(key))
 return sufixo ? pesos[sufixo] : null
}
export function descricaoEmbalagem(codigo?: string | null): string {
 const peso=pesoEmbalagem(codigo)
 return peso == null ? 'Embalagem: não informada' : `Embalagem: ${peso.toLocaleString('pt-BR')} kg`
}

