import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
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
    <>
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-7 h-7 bg-gray-900 dark:bg-white rounded-md flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-white dark:text-gray-900 font-semibold text-sm">S</span>
              </div>
              <span className="text-lg font-light tracking-tight">Scout</span>
            </Link>
            <nav className="flex items-center gap-8">
              <Link href="/" className="text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                Home
              </Link>
              <Link href="/blog" className="text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                Blog
              </Link>
              <Link href="https://github.com/arach/scout" target="_blank" className="text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1">
                GitHub
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            </nav>
          </div>
        </div>
      </header>

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
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-6 text-sm font-light text-gray-500">
            {date && <time>{date}</time>}
            {date && <span className="text-gray-300 dark:text-gray-700">•</span>}
            <span>{readTime} min read</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-normal tracking-tight text-gray-900 dark:text-white leading-tight">
            {title}
          </h1>
        </header>
        
        {/* Article content */}
        <div 
          className="
            prose prose-base 
            prose-gray dark:prose-invert 
            max-w-none
            
            /* Headings */
            prose-headings:font-normal 
            prose-headings:tracking-tight
            prose-h2:text-2xl 
            prose-h2:mt-8 
            prose-h2:mb-4
            prose-h3:text-xl 
            prose-h3:mt-6 
            prose-h3:mb-3
            
            /* Paragraphs and text */
            prose-p:font-normal 
            prose-p:text-gray-700 
            dark:prose-p:text-gray-300
            prose-p:leading-normal
            prose-p:text-[15px]
            prose-strong:font-medium
            
            /* Links */
            prose-a:text-gray-900
            dark:prose-a:text-white
            prose-a:underline
            prose-a:decoration-gray-300
            dark:prose-a:decoration-gray-700
            prose-a:underline-offset-2
            prose-a:transition-colors
            hover:prose-a:decoration-gray-500
            dark:hover:prose-a:decoration-gray-500
            
            /* Lists */
            prose-li:font-normal
            prose-li:text-gray-700
            dark:prose-li:text-gray-300
            prose-li:text-[15px]
            
            /* Quotes */
            prose-blockquote:font-light
            prose-blockquote:border-gray-300
            dark:prose-blockquote:border-gray-700
            prose-blockquote:text-gray-700
            dark:prose-blockquote:text-gray-300
            
            /* Code */
            prose-code:font-normal
            prose-code:text-xs
            prose-code:bg-gray-100
            dark:prose-code:bg-gray-800
            prose-code:text-gray-700
            dark:prose-code:text-gray-300
            prose-code:px-1.5
            prose-code:py-0.5
            prose-code:rounded-md
            prose-code:before:content-none
            prose-code:after:content-none
            
            /* Code blocks */
            prose-pre:bg-gray-50
            dark:prose-pre:bg-gray-900
            prose-pre:text-gray-800
            dark:prose-pre:text-gray-100
            prose-pre:border
            prose-pre:border-gray-200
            dark:prose-pre:border-gray-800
            prose-pre:shadow-sm
            
            /* Tables */
            prose-table:font-light
            prose-th:font-medium
            prose-th:text-gray-900
            dark:prose-th:text-white
            prose-td:text-gray-700
            dark:prose-td:text-gray-300
            
            /* Horizontal rules */
            prose-hr:border-gray-200
            dark:prose-hr:border-gray-800
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </>
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