import Link from "next/link"

export function SDKNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm" style={{
      backgroundColor: 'rgba(253, 252, 248, 0.95)',
      borderBottom: '1px solid #E8E2D5',
      boxShadow: '0 1px 3px 0 rgba(139, 105, 87, 0.05)'
    }}>
      <nav className="px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform" style={{
              backgroundColor: '#8B6957'
            }}>
              <span className="font-silkscreen font-bold text-sm" style={{ color: '#FDFCF8' }}>S</span>
            </div>
            <span className="font-silkscreen text-base font-bold tracking-tight" style={{ color: '#2A2520' }}>Scout SDK</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/sdk" className="font-sans text-sm font-light transition-colors" style={{ color: '#8B6957' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8B6957'}>
              Overview
            </Link>
            <Link href="/docs" className="font-sans text-sm font-light transition-colors" style={{ color: '#8B6957' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8B6957'}>
              Docs
            </Link>
            <Link href="/sdk/badges" className="font-sans text-sm font-light transition-colors" style={{ color: '#8B6957' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8B6957'}>
              Badges
            </Link>
            <Link href="https://github.com/arach/scout-sdk" target="_blank" className="font-sans text-sm font-light transition-colors" style={{ color: '#8B6957' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8B6957'}>
              GitHub
            </Link>
          </div>
        </div>
      </nav>
    </header>
  )
}