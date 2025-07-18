import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

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

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const filePath = path.join(process.cwd(), 'app/blog', `${params.slug}.md`);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    notFound();
  }
  
  // Read and parse markdown
  const markdown = fs.readFileSync(filePath, 'utf-8');
  const html = marked(markdown);
  
  // Extract title from first H1
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Scout Blog';
  
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <article className="max-w-4xl mx-auto px-4 py-16">
        <div className="mb-8">
          <a 
            href="/blog"
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            ← Back to blog
          </a>
        </div>
        
        <div 
          className="prose prose-lg dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </div>
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const filePath = path.join(process.cwd(), 'app/blog', `${params.slug}.md`);
  
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