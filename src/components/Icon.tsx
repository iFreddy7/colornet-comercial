const paths = {
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  plus: 'M12 5v14M5 12h14',
  orders: 'M8 5H5v16h14V5h-3M9 3h6v4H9zM8 12h8M8 16h5',
  quote: 'M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5',
  products: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5',
  clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  reports: 'M4 3v18h17M8 16v-4M13 16V8M18 16V5',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7zM8 12l3 3 5-6',
  logout: 'M9 5H4v14h5M10 12h11M17 8l4 4-4 4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  trend: 'm3 17 6-6 4 4 8-10M15 5h6v6',
  money: 'M12 2v20M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
