"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import Image from "next/image"
import { SDKNav } from "@/components/sdk-nav"

export default function BadgesPage() {
  const badges = [
    {
      name: "Dark Theme",
      file: "powered-by-scout.svg",
      description: "For dark themed applications",
      bg: "bg-gray-900"
    },
    {
      name: "Light Theme",
      file: "powered-by-scout-light.svg",
      description: "For light themed applications",
      bg: "bg-gray-100"
    },
    {
      name: "Compact",
      file: "powered-by-scout-compact.svg",
      description: "Space-efficient version",
      bg: "bg-gray-900"
    }
  ]

  const downloadBadge = (filename: string) => {
    const link = document.createElement('a')
    link.href = `/badges/${filename}`
    link.download = filename
    link.click()
  }

  return (
    <>
      <SDKNav />
      <div className="container mx-auto px-6 py-20 max-w-4xl">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Powered by Scout Badges</h1>
        <p className="text-muted-foreground">
          Show your users that your app uses Scout for voice capabilities
        </p>
      </div>

      <div className="space-y-8">
        {badges.map((badge) => (
          <Card key={badge.file}>
            <CardHeader>
              <CardTitle>{badge.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{badge.description}</p>
            </CardHeader>
            <CardContent>
              <div className={`rounded-lg p-8 ${badge.bg} flex items-center justify-center mb-4`}>
                <img
                  src={`/badges/${badge.file}`}
                  alt={badge.name}
                  className="max-w-full"
                />
              </div>
              <div className="flex gap-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => downloadBadge(badge.file)}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download SVG
                </Button>
                <code className="text-xs bg-secondary px-3 py-2 rounded">
                  /badges/{badge.file}
                </code>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-12 bg-secondary/50">
        <CardHeader>
          <CardTitle>Usage Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Placement</h3>
            <p className="text-sm text-muted-foreground">
              Place the badge in your app's settings, about page, or near voice input controls.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Sizing</h3>
            <p className="text-sm text-muted-foreground">
              Maintain the aspect ratio. Minimum width: 120px for readability.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Linking</h3>
            <p className="text-sm text-muted-foreground">
              Make the badge clickable and link to{" "}
              <code className="bg-background px-1 rounded">https://scout-app.dev</code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-12 text-center">
        <h2 className="text-2xl font-bold mb-4">React Component</h2>
        <Card>
          <CardContent className="p-0">
            <pre className="p-6 overflow-x-auto text-xs">
              <code>{`import { PoweredByScout } from '@scout/react';

// In your component
<PoweredByScout theme="dark" />
<PoweredByScout theme="light" />
<PoweredByScout compact />`}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  )
}