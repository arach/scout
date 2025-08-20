"use client"

import { useEffect, useState, useRef } from 'react'
import Prism from 'prismjs'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Import the languages we need
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'

// Import custom theme CSS
import '@/app/prism-custom.css'

interface PrismCodeProps {
  code: string
  language: string
  className?: string
}

export function PrismCode({ code, language, className = '' }: PrismCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (isMounted && preRef.current) {
      // Only highlight the specific element to avoid hydration issues
      Prism.highlightElement(preRef.current.querySelector('code') as Element)
    }
  }, [code, language, isMounted])

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Ensure consistent class name order
  const preClassName = `overflow-x-auto language-${language}${className ? ' ' + className : ''}`

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background/90"
        onClick={copyToClipboard}
      >
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
      <pre 
        ref={preRef}
        className={preClassName}
        tabIndex={0}
        suppressHydrationWarning
      >
        <code className={`language-${language}`}>
          {code}
        </code>
      </pre>
    </div>
  )
}