import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Scout - Local-First Voice Recording & Transcription for Mac",
  description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required. Fast, secure, and completely free.",
  keywords: ["voice recording", "transcription", "Mac app", "privacy", "local AI", "Whisper", "dictation", "speech to text"],
  authors: [{ name: "Scout" }],
  metadataBase: new URL('https://arach.github.io/scout'),
  openGraph: {
    type: "website",
    url: "https://arach.github.io/scout/",
    title: "Scout - Local-First Voice Recording & Transcription",
    description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
    images: [{ 
      url: "https://arach.github.io/scout/og-image",
      width: 1200,
      height: 630,
      alt: "Scout - Local-First Voice Transcription"
    }],
    siteName: "Scout",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Scout - Local-First Voice Recording & Transcription",
    description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
    images: ["https://arach.github.io/scout/og-image"],
    creator: "@arach",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Counter.dev Analytics - 100% free, privacy-friendly */}
        <script src="https://cdn.counter.dev/script.js" data-id="a12a7689-236b-4ccf-9422-18a39a239553" data-utcoffset="-4"></script>
        {/* Structured Data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Scout",
              "description": "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
              "applicationCategory": "ProductivityApplication",
              "operatingSystem": "macOS 11.0 or later",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "author": {
                "@type": "Organization",
                "name": "Scout",
                "url": "https://arach.github.io/scout/"
              },
              "datePublished": "2025-01-30",
              "softwareVersion": "0.1.0",
              "fileSize": "6.6MB",
              "requirements": "macOS 11.0+, 4GB RAM, 500MB-5GB storage",
              "featureList": [
                "Push-to-Talk Recording with Global Hotkeys",
                "Real-Time Voice Transcription",
                "100% Local Processing",
                "Multiple Whisper Model Support",
                "Voice Activity Detection",
                "Transcript Database with Search",
                "Export to JSON, Text, Markdown"
              ]
            })
          }}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}