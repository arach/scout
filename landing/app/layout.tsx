import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Scout - Local-First Voice Recording & Transcription for Mac",
  description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required. Fast, secure, and completely free.",
  keywords: ["voice recording", "transcription", "Mac app", "privacy", "local AI", "Whisper", "dictation", "speech to text"],
  authors: [{ name: "Scout" }],
  openGraph: {
    type: "website",
    url: "https://scout-app.dev/",
    title: "Scout - Local-First Voice Recording & Transcription",
    description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
    images: [{ url: "https://scout-app.dev/og-image.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scout - Local-First Voice Recording & Transcription",
    description: "Privacy-focused voice recording and transcription app for Mac. Local processing with Whisper AI, no cloud required.",
    images: ["https://scout-app.dev/og-image.png"],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}