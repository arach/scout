import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const blogPosts = [
  {
    title: "Building a Production-Ready Transcription Service: The Architecture Behind Scout's Transcriber",
    slug: "scout-transcriber-architecture",
    date: "August 21, 2025",
    excerpt: "How we built a hybrid Rust-Python architecture that bridges system-level performance with ML ecosystem richness. A deep dive into queue-based communication, MessagePack serialization, and the trade-offs of production transcription.",
    readTime: "12 min read",
    tags: ["Architecture", "Rust", "Python", "ZeroMQ"]
  },
  {
    title: "Building Sub-300ms Transcription with Progressive Processing",
    slug: "progressive-transcription-300ms",
    date: "July 18, 2024",
    excerpt: "Combining Whisper's fast-but-loose Tiny model with the accurate-but-slow Medium model. How we built progressive transcription for instant feedback with background refinement.",
    readTime: "6 min read",
    tags: ["Engineering", "Performance", "Whisper"]
  },
  {
    title: "Introducing Scout SDK: The Voice Layer for Desktop Apps",
    slug: "scout-sdk-announcement", 
    date: "January 30, 2025",
    excerpt: "Scout SDK is an embeddable voice layer that brings intelligent, local-first voice capabilities to any desktop application.",
    readTime: "5 min read",
    tags: ["Product", "SDK", "Launch"]
  }
];

export default function BlogPage() {
  return (
    <>
      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-3">
          Engineering Blog
        </h1>
        <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed max-w-3xl">
          Technical deep dives on building high-performance local voice transcription. 
          Architecture decisions, performance optimizations, and implementation details.
        </p>
      </div>
        
      {/* Posts */}
      <div className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid gap-1">
          {blogPosts.map((post, index) => (
            <article 
              key={post.slug}
              className="group"
            >
              <Link 
                href={`/blog/${post.slug}`}
                className="block py-6 px-2 -mx-2 hover:bg-gray-50 dark:hover:bg-gray-900/50 rounded-xl transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <time className="text-sm font-normal text-gray-500 dark:text-gray-400">
                        {post.date}
                      </time>
                      <span className="text-gray-300 dark:text-gray-700">·</span>
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                        {post.readTime}
                      </span>
                    </div>
                    <h2 className="text-lg md:text-xl font-semibold tracking-tight text-gray-900 dark:text-white mb-2 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                      {post.title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">
                      {post.excerpt}
                    </p>
                    <div className="flex items-center gap-2 mt-4">
                      {post.tags.map(tag => (
                        <span 
                          key={tag}
                          className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="hidden md:block">
                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                      <ArrowUpRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors" />
                    </div>
                  </div>
                </div>
              </Link>
              {index < blogPosts.length - 1 && (
                <div className="border-b border-gray-100 dark:border-gray-800" />
              )}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}