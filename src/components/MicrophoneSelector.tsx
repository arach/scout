import { useState, useEffect } from 'react';
import { Select } from '@base-ui-components/react/select';
import { invoke } from '@tauri-apps/api/core';
import './MicrophoneSelector.css';

interface MicrophoneSelectorProps {
  selectedMic: string;
  onMicChange: (mic: string) => void;
  disabled?: boolean;
}

export function MicrophoneSelector({ selectedMic, onMicChange, disabled = false }: MicrophoneSelectorProps) {
  const [availableMics, setAvailableMics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="microphone-selector loading">
        <span>Loading devices...</span>
      </div>
    );
  }

  return (
    <div className="microphone-selector">
      <Select.Root 
        value={selectedMic} 
        onValueChange={onMicChange} 
        disabled={disabled}
      >
        <Select.Trigger className="mic-select-trigger">
          <div className="mic-select-content">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <Select.Value className="mic-select-value" placeholder="Select microphone" />
            <span className="mic-select-text">{selectedMic}</span>
            <Select.Icon className="mic-select-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6,9 12,15 18,9"/>
              </svg>
            </Select.Icon>
          </div>
        </Select.Trigger>
        
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup className="mic-select-popup">
              {availableMics.map((mic) => (
                <Select.Item key={mic} value={mic} className="mic-select-item">
                  <Select.ItemText>{mic}</Select.ItemText>
                  <Select.ItemIndicator className="mic-select-indicator">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}