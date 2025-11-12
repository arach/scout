import type { Metadata } from "next"
import { Silkscreen, IBM_Plex_Mono, Crimson_Pro } from "next/font/google"
import "./globals.css"

const silkscreen = Silkscreen({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-silkscreen",
  weight: ["400", "700"],
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
  weight: ["300", "400", "500", "600"],
})

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-crimson-pro",
  weight: ["300", "400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Scout - Local-First Voice Recording & Transcription for Mac",
  description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required. Fast, secure, and completely free.",
  keywords: ["voice recording", "transcription", "Mac app", "privacy", "local AI", "Whisper", "dictation", "speech to text"],
  authors: [{ name: "Scout" }],
  metadataBase: new URL('https://openscout.app'),
  openGraph: {
    type: "website",
    url: "https://openscout.app/",
    title: "Scout - Local-First Voice Recording & Transcription",
    description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
    images: [{
      url: "https://openscout.app/og-image.png",
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
    images: ["https://openscout.app/og-image.png"],
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
}: any) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${ibmPlexMono.variable} ${crimsonPro.variable} antialiased`}>
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
                "url": "https://openscout.app/"
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
      <body>{children}</body>
    </html>
  )
}