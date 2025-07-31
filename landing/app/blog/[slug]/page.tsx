import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import '../blog.css';

// Configure marked for better code highlighting
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Generate static params for all blog posts
export async function generateStaticParams() {
  const blogDir = path.join(process.cwd(), 'app/blog');
  const files = fs.readdirSync(blogDir);
  
  const slugs = files
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      slug: file.replace('.md', '')
    }));
    
  return slugs;
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const filePath = path.join(process.cwd(), 'app/blog', `${slug}.md`);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    notFound();
  }
  
  // Read and parse markdown
  const markdown = fs.readFileSync(filePath, 'utf-8');
  const html = marked(markdown);
  
  // Extract title and date from markdown
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Scout Blog';
  const dateMatch = markdown.match(/^\*([^*]+)\*$/m);
  const date = dateMatch ? dateMatch[1] : '';
  
  // Calculate read time (rough estimate: 200 words per minute)
  const wordCount = markdown.split(/\s+/).length;
  const readTime = Math.ceil(wordCount / 200);
  
  return (
    <article className="max-w-4xl mx-auto px-6 py-12">
        {/* Back button */}
        <Link 
          href="/blog"
          className="inline-flex items-center gap-2 text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to blog
        </Link>
        
        {/* Article header */}
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-8 text-sm text-gray-500 dark:text-gray-400">
            {date && <time className="font-normal">{date}</time>}
            {date && <span className="text-gray-300 dark:text-gray-700">·</span>}
            <span className="font-normal">{readTime} min read</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
            {title}
          </h1>
        </header>
        
        {/* Article content */}
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
            prose-h2:text-3xl 
            prose-h2:mt-12 
            prose-h2:mb-6
            prose-h3:text-xl 
            prose-h3:mt-8 
            prose-h3:mb-4
            prose-h4:text-lg
            prose-h4:mt-6
            prose-h4:mb-3
            
            /* Paragraphs and text */
            prose-p:text-gray-600 
            dark:prose-p:text-gray-400
            prose-p:leading-[1.8]
            prose-p:mb-6
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
            prose-ul:my-6
            prose-ol:my-6
            prose-li:text-gray-600
            dark:prose-li:text-gray-400
            prose-li:leading-[1.8]
            prose-li:my-2
            prose-ul:list-disc
            prose-ol:list-decimal
            
            /* Quotes */
            prose-blockquote:border-l-4
            prose-blockquote:border-gray-400
            prose-blockquote:pl-6
            prose-blockquote:py-2
            prose-blockquote:my-8
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
            prose-pre:bg-gray-50
            dark:prose-pre:bg-gray-900
            prose-pre:text-gray-800
            dark:prose-pre:text-gray-200
            prose-pre:border
            prose-pre:border-gray-200
            dark:prose-pre:border-gray-800
            prose-pre:rounded-lg
            prose-pre:shadow-sm
            prose-pre:my-6
            
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
            prose-hr:my-12
            
            /* Images */
            prose-img:rounded-lg
            prose-img:shadow-md
            prose-img:my-8
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
    </article>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const filePath = path.join(process.cwd(), 'app/blog', `${slug}.md`);
  
  if (!fs.existsSync(filePath)) {
    return {
      title: 'Post Not Found - Scout Blog'
    };
  }
  
  const markdown = fs.readFileSync(filePath, 'utf-8');
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Scout Blog';
  
  return {
    title: `${title} - Scout Blog`,
    description: markdown.slice(0, 160).replace(/[#*\n]/g, ' ').trim()
  };
}