import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0F172A',
          backgroundImage: 'radial-gradient(circle at 25% 25%, #1E293B 0%, transparent 50%), radial-gradient(circle at 75% 75%, #1E293B 0%, transparent 50%)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
          {/* Logo - we'll use the actual image */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div
              style={{
                width: 120,
                height: 120,
                backgroundColor: '#7C3AED',
                borderRadius: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 64,
                fontWeight: 'bold',
                color: 'white',
              }}
            >
              S
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 80, fontWeight: 'bold', color: 'white' }}>Scout</div>
              <div style={{ fontSize: 32, color: '#94A3B8', marginTop: -10 }}>v0.1.0</div>
            </div>
          </div>
          
          {/* Tagline */}
          <div style={{ fontSize: 48, color: '#E2E8F0', textAlign: 'center', maxWidth: 900 }}>
            Local-First Voice Recording & Transcription
          </div>
          
          {/* Features */}
          <div style={{ display: 'flex', gap: 48, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 36 }}>🔒</div>
              <div style={{ fontSize: 28, color: '#CBD5E1' }}>100% Private</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 36 }}>⚡</div>
              <div style={{ fontSize: 28, color: '#CBD5E1' }}>Sub-300ms</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 36 }}>🎯</div>
              <div style={{ fontSize: 28, color: '#CBD5E1' }}>Power User Ready</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}