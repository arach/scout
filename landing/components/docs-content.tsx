"use client"

import { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-rust'; 
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-sql';

interface DocsContentProps {
  content: string;
  className?: string;
}

export function DocsContent({ content, className = '' }: DocsContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Highlight code blocks after content is rendered
    if (contentRef.current) {
      Prism.highlightAllUnder(contentRef.current);
    }
  }, [content]);

  return (
    <div 
      ref={contentRef}
      className={`prose prose-slate dark:prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}