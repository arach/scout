'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50" style={{
      backgroundColor: 'rgba(253, 252, 248, 0.95)',
      borderBottom: '1px solid #E8E2D5',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 1px 3px 0 rgba(139, 105, 87, 0.05)'
    }}>
      <div className="max-w-5xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform" style={{
              backgroundColor: '#8B6957'
            }}>
              <span className="font-silkscreen font-bold text-sm" style={{ color: '#FDFCF8' }}>S</span>
            </div>
            <span className="font-silkscreen text-base font-bold tracking-tight" style={{ color: '#2A2520' }}>Scout</span>
          </Link>
          <nav className="flex items-center gap-8">
            <Link
              href="/"
              className="text-sm font-light transition-colors"
              style={{
                color: pathname === '/' ? '#2A2520' : '#8B6957'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = pathname === '/' ? '#2A2520' : '#8B6957'}
            >
              Home
            </Link>
            <Link
              href="/blog"
              className="text-sm font-light transition-colors"
              style={{
                color: pathname.startsWith('/blog') ? '#2A2520' : '#8B6957'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = pathname.startsWith('/blog') ? '#2A2520' : '#8B6957'}
            >
              Blog
            </Link>
            <Link
              href="/sdk"
              className="text-sm font-light transition-colors"
              style={{
                color: pathname.startsWith('/sdk') ? '#2A2520' : '#8B6957'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = pathname.startsWith('/sdk') ? '#2A2520' : '#8B6957'}
            >
              SDK
            </Link>
            <Link
              href="https://github.com/arach/scout"
              target="_blank"
              className="text-sm font-light transition-colors flex items-center gap-1.5"
              style={{ color: '#8B6957' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2A2520'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8B6957'}
            >
              GitHub
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}