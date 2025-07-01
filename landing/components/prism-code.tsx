"use client"

import { useEffect } from 'react'
import Prism from 'prismjs'

// Import the languages we need
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'

// Import the theme CSS
import 'prismjs/themes/prism-tomorrow.css'

interface PrismCodeProps {
  code: string
  language: string
  className?: string
}

export function PrismCode({ code, language, className = '' }: PrismCodeProps) {
  useEffect(() => {
    Prism.highlightAll()
  }, [code, language])

  return (
    <pre className={`language-${language} ${className}`}>
      <code className={`language-${language}`}>
        {code}
      </code>
    </pre>
  )
}