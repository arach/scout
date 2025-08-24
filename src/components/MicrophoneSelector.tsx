import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './MicrophoneSelector.css';

interface AudioDeviceInfo {
  name: string;
  index: number;
  sample_rates: number[];
  channels: number;
}

interface MicrophoneSelectorProps {
  selectedMic: string;
  onMicChange: (mic: string) => void;
  disabled?: boolean;
}

export function MicrophoneSelector({ selectedMic, onMicChange, disabled = false }: MicrophoneSelectorProps) {
  const [availableMics, setAvailableMics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load available microphone devices
  useEffect(() => {
    const loadMicrophones = async () => {
      console.log('[MicrophoneSelector] Starting to load microphones...');
      try {
        // Try to get detailed device info first
        console.log('[MicrophoneSelector] Calling get_audio_devices_detailed...');
        const detailedDevices = await invoke<AudioDeviceInfo[]>('get_audio_devices_detailed');
        console.log('[MicrophoneSelector] Detailed devices received:', detailedDevices);
        
        const deviceNames = detailedDevices.map(d => d.name);
        console.log('[MicrophoneSelector] Device names extracted:', deviceNames);
        setAvailableMics(deviceNames);
        
        // If current selection is not in the list, select the first available
        if (deviceNames.length > 0 && !deviceNames.includes(selectedMic)) {
          console.log('[MicrophoneSelector] Current selection not in list, selecting first device:', deviceNames[0]);
          onMicChange(deviceNames[0]);
        }
      } catch (error) {
        console.error('[MicrophoneSelector] Failed to load detailed devices, falling back:', error);
        try {
          // Fallback to simple device list
          console.log('[MicrophoneSelector] Calling get_audio_devices (fallback)...');
          const devices = await invoke<string[]>('get_audio_devices');
          console.log('[MicrophoneSelector] Simple devices received:', devices);
          setAvailableMics(devices);
          
          if (devices.length > 0 && !devices.includes(selectedMic)) {
            console.log('[MicrophoneSelector] Selecting first device from fallback:', devices[0]);
            onMicChange(devices[0]);
          }
        } catch (fallbackError) {
          console.error('[MicrophoneSelector] Failed to load microphone devices:', fallbackError);
          setAvailableMics(['Default microphone']);
        }
      } finally {
        setLoading(false);
        console.log('[MicrophoneSelector] Loading complete');
      }
    };

    loadMicrophones();
  }, [selectedMic, onMicChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (loading) {
    return (
      <div className="microphone-selector loading">
        <span>Loading devices...</span>
      </div>
    );
  }

  return (
    <div className="microphone-selector" ref={dropdownRef}>
      <button
        className="mic-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        type="button"
      >
        <div className="mic-select-content">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span className="mic-select-text">{selectedMic || 'Select microphone'}</span>
          <span className={`mic-select-icon ${isOpen ? 'open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6,9 12,15 18,9"/>
            </svg>
          </span>
        </div>
      </button>
      
      {isOpen && (
        <div className="mic-select-popup">
          {availableMics.map((mic) => (
            <button
              key={mic}
              className={`mic-select-item ${mic === selectedMic ? 'selected' : ''}`}
              onClick={() => {
                onMicChange(mic);
                setIsOpen(false);
              }}
              type="button"
            >
              <span className="mic-select-item-text">{mic}</span>
              {mic === selectedMic && (
                <svg className="mic-select-indicator" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}