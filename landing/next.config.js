/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Configure for GitHub Pages
  basePath: process.env.NODE_ENV === 'production' ? '/scout' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/scout' : '',
  // Handle trailing slashes consistently
  trailingSlash: true,
}

module.exports = nextConfig