import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './MicrophoneQuickPicker.css';

interface MicrophoneQuickPickerProps {
  selectedMic: string;
  onMicChange: (mic: string) => void;
  isOpen: boolean;
  onClose: () => void;
  anchorElement: HTMLElement | null;
}

export function MicrophoneQuickPicker({ 
  selectedMic, 
  onMicChange, 
  isOpen, 
  onClose,
  anchorElement 
}: MicrophoneQuickPickerProps) {
  const [availableMics, setAvailableMics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load available microphone devices
  useEffect(() => {
    const loadMicrophones = async () => {
      try {
        const devices = await invoke<string[]>('get_audio_devices');
        setAvailableMics(devices);
      } catch (error) {
        console.error('Failed to load microphone devices:', error);
        setAvailableMics(['Default microphone']);
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      loadMicrophones();
    }
  }, [isOpen]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          anchorElement && !anchorElement.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, anchorElement]);

  // Calculate position relative to anchor element
  const getPosition = () => {
    if (!anchorElement) return { top: 0, left: 0 };
    
    const rect = anchorElement.getBoundingClientRect();
    const dropdownWidth = 240; // Approximate width of dropdown
    
    // Position below the gear icon and center it horizontally
    return {
      top: rect.bottom + 8, // 8px spacing below the gear
      left: rect.left + (rect.width / 2) - (dropdownWidth / 2), // Center horizontally
    };
  };

  if (!isOpen) return null;

  const position = getPosition();

  return (
    <div 
      ref={dropdownRef}
      className="mic-quick-picker"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {loading ? (
        <div className="mic-quick-picker-loading">Loading devices...</div>
      ) : (
        <>
          <div className="mic-quick-picker-header">Select Microphone</div>
          <div className="mic-quick-picker-list">
            {availableMics.map((mic) => (
              <button
                key={mic}
                className={`mic-quick-picker-item ${mic === selectedMic ? 'selected' : ''}`}
                onClick={() => {
                  onMicChange(mic);
                  onClose();
                }}
              >
                <svg 
                  className="mic-icon" 
                  width="14" 
                  height="14" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <span className="mic-name">{mic}</span>
                {mic === selectedMic && (
                  <svg 
                    className="check-icon" 
                    width="14" 
                    height="14" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                  >
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}