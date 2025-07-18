import Link from 'next/link';

const blogPosts = [
  {
    title: "Building Sub-300ms Transcription: The Journey to Progressive Processing",
    slug: "progressive-transcription-300ms",
    date: "July 18, 2024",
    excerpt: "How we rebuilt Scout's transcription pipeline to deliver instant results while improving quality in the background. A story of questioning assumptions and achieving 85-94% latency reduction."
  },
  {
    title: "Introducing Scout SDK: The Voice Layer for Desktop Apps",
    slug: "scout-sdk-announcement", 
    date: "January 30, 2025",
    excerpt: "Scout SDK is an embeddable voice layer that brings intelligent, local-first voice capabilities to any desktop application."
  }
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">
          Scout Blog
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-12">
          Engineering insights, product updates, and stories from building a local-first dictation app.
        </p>
        
        <div className="space-y-8">
          {blogPosts.map((post) => (
            <article 
              key={post.slug}
              className="border-b border-gray-200 dark:border-gray-700 pb-8"
            >
              <Link 
                href={`/blog/${post.slug}`}
                className="block hover:bg-gray-50 dark:hover:bg-gray-800 -mx-4 px-4 py-4 rounded-lg transition-colors"
              >
                <time className="text-sm text-gray-500 dark:text-gray-400">
                  {post.date}
                </time>
                <h2 className="text-2xl font-semibold mt-2 mb-3 text-gray-900 dark:text-white">
                  {post.title}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {post.excerpt}
                </p>
                <span className="text-blue-600 dark:text-blue-400 font-medium mt-3 inline-block">
                  Read more →
                </span>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}