export function Loading({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{texto}</span>
    </div>
  )
}
