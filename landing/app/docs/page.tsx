"use client"

import dynamic from 'next/dynamic'

// Dynamically import the docs content to avoid build errors when docs aren't generated yet
const DocsPageContent = dynamic(() => import('./docs-page-content'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-500">Loading documentation...</p>
      </div>
    </div>
  )
})

export default function DocsPage() {
  return <DocsPageContent />
}