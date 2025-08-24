'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function BlogContent({ html }: { html: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    // Add copy buttons to all code blocks after component mounts
    const codeBlocks = document.querySelectorAll('pre');
    
    codeBlocks.forEach((block, index) => {
      // Skip if button already exists
      if (block.querySelector('.copy-button')) return;
      
      // Create wrapper div for positioning
      block.style.position = 'relative';
      
      // Create copy button
      const button = document.createElement('button');
      button.className = 'copy-button';
      button.setAttribute('data-index', String(index));
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(226, 232, 240, 0.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      
      // Style the button
      Object.assign(button.style, {
        position: 'absolute',
        top: '12px',
        right: '12px',
        padding: '8px',
        background: 'rgba(51, 65, 85, 0.6)',
        border: '1px solid rgba(71, 85, 105, 0.5)',
        borderRadius: '6px',
        color: 'rgba(226, 232, 240, 0.9)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: '0',
        transition: 'all 0.2s',
        zIndex: '10',
        backdropFilter: 'blur(8px)',
      });
      
      // Add hover effects
      block.addEventListener('mouseenter', () => {
        button.style.opacity = '1';
      });
      
      block.addEventListener('mouseleave', () => {
        if (copiedIndex !== index) {
          button.style.opacity = '0';
        }
      });
      
      button.addEventListener('mouseenter', () => {
        button.style.background = 'rgba(71, 85, 105, 0.8)';
        button.style.borderColor = 'rgba(100, 116, 139, 0.8)';
        button.style.transform = 'scale(1.05)';
      });
      
      button.addEventListener('mouseleave', () => {
        button.style.background = 'rgba(51, 65, 85, 0.6)';
        button.style.borderColor = 'rgba(71, 85, 105, 0.5)';
        button.style.transform = 'scale(1)';
      });
      
      // Add click handler
      button.addEventListener('click', async () => {
        const code = block.querySelector('code')?.textContent || '';
        await navigator.clipboard.writeText(code);
        
        // Show check icon
        setCopiedIndex(index);
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        button.style.background = 'rgba(34, 197, 94, 0.2)';
        button.style.color = 'rgb(34, 197, 94)';
        
        // Reset after 2 seconds
        setTimeout(() => {
          setCopiedIndex(null);
          button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          `;
          button.style.background = 'rgba(30, 41, 59, 0.5)';
          button.style.color = 'rgba(226, 232, 240, 0.8)';
          button.style.opacity = '0';
        }, 2000);
      });
      
      block.appendChild(button);
    });
  }, [html, copiedIndex]);

  return (
    <div 
      className="
        prose prose-lg 
        prose-gray dark:prose-invert 
        max-w-none
        
        /* Base font */
        prose-base:font-normal
        
        /* Headings */
        prose-headings:font-semibold 
        prose-headings:tracking-tight
        prose-h2:text-2xl 
        prose-h2:mt-8 
        prose-h2:mb-4
        prose-h3:text-lg 
        prose-h3:mt-6 
        prose-h3:mb-3
        prose-h4:text-base
        prose-h4:mt-4
        prose-h4:mb-2
        
        /* Paragraphs and text */
        prose-p:text-gray-600 
        dark:prose-p:text-gray-400
        prose-p:leading-[1.7]
        prose-p:mb-4
        prose-strong:font-semibold
        prose-strong:text-gray-900
        dark:prose-strong:text-white
        
        /* Links */
        prose-a:text-gray-700
        dark:prose-a:text-gray-300
        prose-a:no-underline
        prose-a:font-medium
        prose-a:transition-all
        hover:prose-a:text-gray-900
        dark:hover:prose-a:text-gray-100
        prose-a:relative
        prose-a:after:content-['']
        prose-a:after:absolute
        prose-a:after:left-0
        prose-a:after:bottom-0
        prose-a:after:w-full
        prose-a:after:h-px
        prose-a:after:bg-gray-600/30
        dark:prose-a:after:bg-gray-400/30
        prose-a:after:scale-x-0
        prose-a:after:origin-left
        prose-a:after:transition-transform
        hover:prose-a:after:scale-x-100
        
        /* Lists */
        prose-ul:my-4
        prose-ol:my-4
        prose-li:text-gray-600
        dark:prose-li:text-gray-400
        prose-li:leading-[1.7]
        prose-li:my-1
        prose-ul:list-disc
        prose-ol:list-decimal
        
        /* Quotes */
        prose-blockquote:border-l-4
        prose-blockquote:border-gray-400
        prose-blockquote:pl-6
        prose-blockquote:py-2
        prose-blockquote:my-6
        prose-blockquote:text-gray-600
        dark:prose-blockquote:text-gray-400
        prose-blockquote:italic
        
        /* Code */
        prose-code:font-mono
        prose-code:text-sm
        prose-code:bg-gray-100
        dark:prose-code:bg-gray-800/50
        prose-code:text-gray-700
        dark:prose-code:text-gray-300
        prose-code:px-1.5
        prose-code:py-0.5
        prose-code:rounded
        prose-code:before:content-none
        prose-code:after:content-none
        
        /* Code blocks */
        prose-pre:bg-gray-900
        prose-pre:text-gray-200
        prose-pre:border
        prose-pre:border-gray-800
        prose-pre:rounded-lg
        prose-pre:shadow-sm
        prose-pre:my-4
        prose-pre:relative
        prose-pre:group
        
        /* Tables */
        prose-table:my-8
        prose-th:font-semibold
        prose-th:text-gray-900
        dark:prose-th:text-white
        prose-th:text-left
        prose-td:text-gray-600
        dark:prose-td:text-gray-400
        
        /* Horizontal rules */
        prose-hr:border-gray-200
        dark:prose-hr:border-gray-800
        prose-hr:my-8
        
        /* Images */
        prose-img:rounded-lg
        prose-img:shadow-md
        prose-img:my-6
      "
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}