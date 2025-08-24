import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import BlogContent from './BlogContent';
import '../blog.css';
import Prism from 'prismjs';
// Import dark theme as base for token structure
import 'prismjs/themes/prism-dark.css';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

// Configure marked with Prism.js highlighting
const marked = new Marked(
  markedHighlight({
    highlight(code, lang) {
      // Handle text/plain for ASCII diagrams
      if (lang === 'text' || lang === 'plain' || lang === 'txt') {
        return code; // Don't highlight, but preserve formatting
      }
      
      // Map common language aliases
      const langMap: { [key: string]: string } = {
        'js': 'javascript',
        'ts': 'typescript',
        'py': 'python',
        'rb': 'ruby',
        'yml': 'yaml',
        'sh': 'bash',
        'shell': 'bash'
      };
      
      const mappedLang = langMap[lang] || lang;
      
      if (Prism.languages[mappedLang]) {
        try {
          return Prism.highlight(code, Prism.languages[mappedLang], mappedLang);
        } catch (e) {
          console.warn(`Failed to highlight ${mappedLang}:`, e);
          return code;
        }
      }
      return code;
    }
  })
);

marked.setOptions({
  gfm: true,
  breaks: true
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
  const html = await marked.parse(markdown);
  
  // Extract title and date from markdown
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Scout Blog';
  const dateMatch = markdown.match(/^\*([^*]+)\*$/m);
  const date = dateMatch ? dateMatch[1] : '';
  
  // Calculate read time (rough estimate: 200 words per minute)
  const wordCount = markdown.split(/\s+/).length;
  const readTime = Math.ceil(wordCount / 200);
  
  return (
    <article className="max-w-4xl mx-auto px-6 py-8">
        {/* Back button */}
        <Link 
          href="/blog"
          className="inline-flex items-center gap-2 text-sm font-light text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to blog
        </Link>
        
        {/* Article header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4 text-sm text-gray-500 dark:text-gray-400">
            {date && <time className="font-normal">{date}</time>}
            {date && <span className="text-gray-300 dark:text-gray-700">·</span>}
            <span className="font-normal">{readTime} min read</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
            {title}
          </h1>
        </header>
        
        {/* Article content */}
        <BlogContent html={html} />
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