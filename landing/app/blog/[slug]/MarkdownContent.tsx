'use client';

import { useEffect, useState } from 'react';
import CodeBlock from './CodeBlock';

interface MarkdownContentProps {
  html: string;
}

export default function MarkdownContent({ html }: MarkdownContentProps) {
  const [processedContent, setProcessedContent] = useState<React.ReactNode[]>([]);

  useEffect(() => {
    // Create a temporary div to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    const elements: React.ReactNode[] = [];
    let key = 0;

    // Process all elements
    const processNode = (node: Node): React.ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        
        // Check if it's a code block
        if (element.tagName === 'PRE') {
          const codeElement = element.querySelector('code');
          if (codeElement) {
            // Extract language from class name
            const className = codeElement.className || '';
            const languageMatch = className.match(/language-(\w+)/);
            const language = languageMatch ? languageMatch[1] : 'text';
            const code = codeElement.textContent || '';
            
            return <CodeBlock key={key++} code={code} language={language} />;
          }
        }

        // For other elements, recreate them with their content
        const Tag = element.tagName.toLowerCase() as keyof JSX.IntrinsicElements;
        const children = Array.from(element.childNodes).map(processNode);
        
        // Preserve classes and other attributes
        const props: any = {
          key: key++,
          className: element.className,
        };

        // Handle specific elements
        if (element.tagName === 'A') {
          props.href = (element as HTMLAnchorElement).href;
          props.target = '_blank';
          props.rel = 'noopener noreferrer';
        }

        return <Tag {...props}>{children}</Tag>;
      }

      return null;
    };

    // Process all child nodes
    const content = Array.from(tempDiv.childNodes).map(processNode);
    setProcessedContent(content);
  }, [html]);

  return (
    <div className="prose prose-lg prose-gray dark:prose-invert max-w-none">
      {processedContent}
    </div>
  );
}