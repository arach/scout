'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';

export default function Header() {
  const pathname = usePathname();
  
  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 bg-gray-900 dark:bg-white rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-white dark:text-gray-900 font-semibold text-sm">S</span>
            </div>
            <span className="text-lg font-light tracking-tight text-gray-900 dark:text-white">Scout</span>
          </Link>
          <nav className="flex items-center gap-8">
            <Link 
              href="/" 
              className={`text-sm font-light transition-colors ${
                pathname === '/' 
                  ? 'text-gray-900 dark:text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Home
            </Link>
            <Link 
              href="/blog" 
              className={`text-sm font-light transition-colors ${
                pathname.startsWith('/blog') 
                  ? 'text-gray-900 dark:text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Blog
            </Link>
            <Link 
              href="/sdk" 
              className={`text-sm font-light transition-colors ${
                pathname.startsWith('/sdk') 
                  ? 'text-gray-900 dark:text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              SDK
            </Link>
            <Link 
              href="https://github.com/arach/scout" 
              target="_blank" 
              className="text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
            >
              GitHub
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
            <div className="ml-2">
              <ThemeToggle />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}