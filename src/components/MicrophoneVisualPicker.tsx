import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface MicrophoneVisualPickerProps {
  selectedMic: string;
  onMicChange: (mic: string) => void;
  disabled?: boolean;
}

export function MicrophoneVisualPicker({ selectedMic, onMicChange, disabled = false }: MicrophoneVisualPickerProps) {
  const [availableMics, setAvailableMics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const audioDataRef = useRef<number[]>(new Array(50).fill(0));

  // Load available microphone devices
  useEffect(() => {
    const loadMicrophones = async () => {
      try {
        const devices = await invoke<string[]>('get_audio_devices');
        setAvailableMics(devices);
        
        // If current selection is not in the list, select the first available
        if (devices.length > 0 && !devices.includes(selectedMic)) {
          onMicChange(devices[0]);
        }
      } catch (error) {
        console.error('Failed to load microphone devices:', error);
        setAvailableMics(['Default microphone']);
      } finally {
        setLoading(false);
      }
    };

    loadMicrophones();
  }, [selectedMic, onMicChange]);

  // Simulate audio level monitoring (in real app, this would come from the audio recorder)
  useEffect(() => {
    if (!isExpanded) return;

    const interval = setInterval(() => {
      // Simulate varying audio levels
      const baseLevel = 0.1;
      const variation = Math.random() * 0.3;
      const newLevel = Math.min(1, baseLevel + variation);
      setAudioLevel(newLevel);
      
      // Update audio data for waveform
      audioDataRef.current.push(newLevel);
      audioDataRef.current.shift();
    }, 50);

    return () => clearInterval(interval);
  }, [isExpanded]);

  // Draw waveform
  useEffect(() => {
    if (!isExpanded || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = canvas.width / audioDataRef.current.length;
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, 'rgba(74, 158, 255, 0.8)');
      gradient.addColorStop(1, 'rgba(74, 158, 255, 0.2)');
      
      ctx.fillStyle = gradient;
      
      audioDataRef.current.forEach((value, index) => {
        const barHeight = value * canvas.height * 0.8;
        const x = index * barWidth;
        const y = (canvas.height - barHeight) / 2;
        
        ctx.fillRect(x, y, barWidth - 1, barHeight);
      });
      
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isExpanded]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>Loading devices...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <button
        style={{
          ...styles.toggleButton,
          ...(isExpanded ? styles.toggleButtonExpanded : {}),
          ...(disabled ? styles.disabled : {})
        }}
        onClick={() => !disabled && setIsExpanded(!isExpanded)}
        disabled={disabled}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
        <span style={styles.buttonText}>{selectedMic}</span>
        <svg 
          width="12" 
          height="12" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
          style={{
            ...styles.chevron,
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
          }}
        >
          <polyline points="6,9 12,15 18,9"/>
        </svg>
      </button>

      {isExpanded && (
        <div style={styles.expandedContent}>
          <div style={styles.visualizer}>
            <canvas
              ref={canvasRef}
              width={240}
              height={60}
              style={styles.canvas}
            />
            <div style={styles.levelIndicator}>
              <div 
                style={{
                  ...styles.levelBar,
                  width: `${audioLevel * 100}%`
                }}
              />
            </div>
          </div>

          <div style={styles.deviceList}>
            {availableMics.map((mic) => (
              <button
                key={mic}
                style={{
                  ...styles.deviceItem,
                  ...(mic === selectedMic ? styles.deviceItemSelected : {}),
                  ...(disabled ? styles.disabled : {})
                }}
                onClick={() => !disabled && onMicChange(mic)}
                disabled={disabled}
              >
                <div style={styles.deviceInfo}>
                  <div style={styles.deviceName}>{mic}</div>
                  {mic === selectedMic && (
                    <div style={styles.activeIndicator}>
                      <span style={styles.activeDot}></span>
                      Active
                    </div>
                  )}
                </div>
                <div style={styles.deviceLevel}>
                  {mic === selectedMic && (
                    <div style={styles.miniLevelBar}>
                      <div 
                        style={{
                          ...styles.miniLevelFill,
                          width: `${audioLevel * 100}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div style={styles.footer}>
            <div style={styles.hint}>
              Select a microphone to use for recording
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Embedded styles - completely self-contained
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'relative',
    width: '100%',
    marginTop: '16px',
  },
  
  toggleButton: {
    width: '100%',
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  
  toggleButtonExpanded: {
    background: 'rgba(74, 158, 255, 0.1)',
    borderColor: 'rgba(74, 158, 255, 0.3)',
  },
  
  buttonText: {
    flex: 1,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  
  chevron: {
    transition: 'transform 0.2s ease',
  },
  
  expandedContent: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    background: '#1a1a1a',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    overflow: 'hidden',
    zIndex: 1000,
  },
  
  visualizer: {
    padding: '12px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  
  canvas: {
    width: '100%',
    height: '60px',
    borderRadius: '4px',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  
  levelIndicator: {
    marginTop: '8px',
    height: '2px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '1px',
    overflow: 'hidden',
  },
  
  levelBar: {
    height: '100%',
    background: 'linear-gradient(to right, #4a9eff, #66b3ff)',
    transition: 'width 0.05s ease-out',
  },
  
  deviceList: {
    maxHeight: '200px',
    overflowY: 'auto',
  },
  
  deviceItem: {
    width: '100%',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    border: 'none',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  
  deviceItemSelected: {
    background: 'rgba(74, 158, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  
  deviceInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    flex: 1,
  },
  
  deviceName: {
    fontWeight: 500,
  },
  
  activeIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: '#4a9eff',
  },
  
  activeDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#4a9eff',
    display: 'inline-block',
  },
  
  deviceLevel: {
    width: '60px',
  },
  
  miniLevelBar: {
    height: '3px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '1.5px',
    overflow: 'hidden',
  },
  
  miniLevelFill: {
    height: '100%',
    background: '#4a9eff',
    transition: 'width 0.05s ease-out',
  },
  
  footer: {
    padding: '12px 16px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  
  hint: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  
  loadingText: {
    padding: '8px 12px',
    fontSize: '13px',
    color: 'rgba(255, 255, 255, 0.5)',
  },
};