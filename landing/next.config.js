/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // No basePath needed for custom domain deployment
  // The site will be served from the root at scout.arach.dev
  // Handle trailing slashes consistently
  trailingSlash: true,
  // Skip TypeScript and ESLint checks during build (run separately if needed)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig