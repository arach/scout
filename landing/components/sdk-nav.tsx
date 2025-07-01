import Link from "next/link"

export function SDKNav() {
  return (
    <header className="fixed top-0 w-full z-50 bg-background/95 backdrop-blur-sm border-b">
      <nav className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold">S</span>
            </div>
            <span className="text-xl font-semibold">Scout SDK</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/sdk" className="text-muted-foreground hover:text-foreground transition-colors">
              Overview
            </Link>
            <Link href="/sdk/badges" className="text-muted-foreground hover:text-foreground transition-colors">
              Badges
            </Link>
            <Link href="https://github.com/arach/scout-sdk" target="_blank" className="text-muted-foreground hover:text-foreground transition-colors">
              GitHub
            </Link>
          </div>
        </div>
      </nav>
    </header>
  )
}