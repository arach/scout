"use client"

import { DevToolbar, DevToolbarSection, DevToolbarInfo, DevToolbarButton } from "@arach/devbar"
import { Settings, Palette, Layers } from "lucide-react"

interface ClientDevBarProps {
  opacity: number
  setOpacity: (value: number) => void
  blur: number
  setBlur: (value: number) => void
  showBackdrop: boolean
  setShowBackdrop: (value: boolean) => void
  videoOpacity: number
  setVideoOpacity: (value: number) => void
  shadowOpacity: number
  setShadowOpacity: (value: number) => void
  theme: 'cream' | 'dark' | 'blue'
  setTheme: (value: 'cream' | 'dark' | 'blue') => void
}

export function ClientDevBar({
  opacity,
  setOpacity,
  blur,
  setBlur,
  showBackdrop,
  setShowBackdrop,
  videoOpacity,
  setVideoOpacity,
  shadowOpacity,
  setShadowOpacity,
  theme,
  setTheme,
}: ClientDevBarProps) {
  // Remove the mounting check - let the DevToolbar handle its own mounting

  const themes = {
    cream: {
      bg: 'rgb(252,248,232)',
      shadow: 'rgba(252,248,232,0.4)',
    },
    dark: {
      bg: 'rgb(30,30,30)',
      shadow: 'rgba(0,0,0,0.3)',
    },
    blue: {
      bg: 'rgb(219,234,254)',
      shadow: 'rgba(59,130,246,0.2)',
    },
  }

  const devToolbarTabs = [
    {
      id: 'backdrop',
      label: 'Backdrop',
      icon: Layers,
      content: (
        <DevToolbarSection title="Backdrop Controls">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400">Show Backdrop</span>
              <button
                onClick={() => setShowBackdrop(!showBackdrop)}
                className={`w-10 h-5 rounded-full transition-colors ${
                  showBackdrop ? 'bg-green-600' : 'bg-gray-700'
                }`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${
                  showBackdrop ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400">Opacity</span>
                <span className="text-gray-300">{opacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${opacity}%, #374151 ${opacity}%, #374151 100%)`
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400">Blur</span>
                <span className="text-gray-300">{blur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={blur}
                onChange={(e) => setBlur(Number(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${blur * 5}%, #374151 ${blur * 5}%, #374151 100%)`
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400">Shadow</span>
                <span className="text-gray-300">{shadowOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={shadowOpacity}
                onChange={(e) => setShadowOpacity(Number(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${shadowOpacity}%, #374151 ${shadowOpacity}%, #374151 100%)`
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400">Video Opacity</span>
                <span className="text-gray-300">{videoOpacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={videoOpacity}
                onChange={(e) => setVideoOpacity(Number(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #10b981 0%, #10b981 ${videoOpacity}%, #374151 ${videoOpacity}%, #374151 100%)`
                }}
              />
            </div>
          </div>
        </DevToolbarSection>
      ),
    },
    {
      id: 'palette',
      label: 'Palette',
      icon: Palette,
      content: (
        <DevToolbarSection title="Theme Presets">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(themes).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => setTheme(key as any)}
                  className={`p-2 rounded border text-[10px] capitalize transition-all ${
                    theme === key
                      ? 'border-blue-500 bg-gray-800'
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div
                    className="w-full h-8 rounded mb-1"
                    style={{ backgroundColor: value.bg }}
                  />
                  {key}
                </button>
              ))}
            </div>

            <DevToolbarInfo label="Current theme" value={theme} />
            <DevToolbarInfo label="Backdrop blend" value={`${opacity}% opacity`} />
            <DevToolbarInfo label="Blur effect" value={`${blur}px`} />
            <DevToolbarInfo label="Video layer" value={`${videoOpacity}% opacity`} />
          </div>
        </DevToolbarSection>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      content: (
        <DevToolbarSection title="Current Configuration">
          <div className="space-y-3">
            <DevToolbarInfo label="Backdrop" value={showBackdrop ? 'Enabled' : 'Disabled'} />
            <DevToolbarInfo label="Opacity" value={`${opacity}%`} />
            <DevToolbarInfo label="Blur" value={`${blur}px`} />
            <DevToolbarInfo label="Shadow" value={`${shadowOpacity}%`} />
            <DevToolbarInfo label="Video" value={`${videoOpacity}% opacity`} />
            <DevToolbarInfo label="Theme" value={theme} />

            <div className="pt-2 border-t border-gray-700">
              <DevToolbarButton
                onClick={() => {
                  setOpacity(67);
                  setBlur(5);
                  setVideoOpacity(20);
                  setShadowOpacity(40);
                  setTheme('cream');
                }}
                variant="default"
                className="w-full"
              >
                Reset to Defaults
              </DevToolbarButton>
            </div>
          </div>
        </DevToolbarSection>
      ),
    },
  ]

  return (
    <DevToolbar
      tabs={devToolbarTabs}
      position="bottom-right"
      defaultTab="backdrop"
      theme="dark"
      title="Scout Dev"
      width="320px"
      maxHeight="400px"
      hideInProduction={false}
    />
  )
}
