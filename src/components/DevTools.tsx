import { useState, useEffect } from 'react';
import './DevTools.css';

interface DevToolsProps {
  audioLevel: number;
  selectedMic: string;
  isRecording: boolean;
  isProcessing: boolean;
}

export function DevTools({ audioLevel, selectedMic, isRecording, isProcessing }: DevToolsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMicLevel, setShowMicLevel] = useState(false);
  const [showConsoleLog, setShowConsoleLog] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Only show in development
  const isDev = import.meta.env.DEV;
  if (!isDev) return null;

  const handleToggle = () => {
    setIsAnimating(true);
    setIsOpen(!isOpen);
    setTimeout(() => {
      setIsAnimating(false);
    }, 150);
  };

  const getButtonClass = () => {
    let className = "dev-tools-button";
    if (isAnimating) {
      className += isOpen ? " collapsing" : " expanding";
    }
    if (isOpen && !isAnimating) {
      className += " active";
    }
    return className;
  };

  // Console logging effect
  useEffect(() => {
    if (showConsoleLog) {
      console.log('[DevTools] Audio Level:', {
        level: audioLevel.toFixed(6),
        device: selectedMic,
        recording: isRecording,
        processing: isProcessing,
        timestamp: new Date().toISOString()
      });
    }
  }, [showConsoleLog, audioLevel, selectedMic, isRecording, isProcessing]);

  return (
    <>
      {/* DEV Button - Circular with Animation */}
      <button 
        className={getButtonClass()}
        onClick={handleToggle}
        title="Developer Tools"
      >
        DEV
      </button>

      {/* Dev Tools Panel - Simplified */}
      {isOpen && (
        <div className="dev-tools-panel">
          <div className="dev-tools-header">
            <h3>Dev Tools</h3>
            <button 
              className="dev-tools-close"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>
          
          <div className="dev-tools-content">
            {/* Primary Feature: Mic Level Toggle */}
            <div className="dev-tool-item primary">
              <label className="dev-tool-checkbox">
                <input
                  type="checkbox"
                  checked={showMicLevel}
                  onChange={(e) => setShowMicLevel(e.target.checked)}
                />
                <span className="checkbox-label">Show Mic Level Overlay</span>
              </label>
            </div>

            {/* Logging Controls */}
            <div className="dev-tool-section">
              <h4>Logging</h4>
              <div className="dev-tool-item">
                <label className="dev-tool-checkbox">
                  <input
                    type="checkbox"
                    checked={showConsoleLog}
                    onChange={(e) => setShowConsoleLog(e.target.checked)}
                  />
                  <span className="checkbox-label">Enable Audio Level Console Logs</span>
                </label>
              </div>
            </div>

            {/* Quick Audio State */}
            <div className="dev-tool-section">
              <h4>Current Status</h4>
              <div className="status-grid">
                <span className="status-label">State:</span>
                <span className={`status-badge ${isRecording ? 'recording' : 'idle'}`}>
                  {isRecording ? 'RECORDING' : 'IDLE'}
                </span>
                
                <span className="status-label">Process:</span>
                <span className={`status-badge ${isProcessing ? 'processing' : 'ready'}`}>
                  {isProcessing ? 'PROCESSING' : 'READY'}
                </span>
                
                <span className="status-label">Audio Level:</span>
                <span className="audio-level-mini">
                  {audioLevel.toFixed(3)}
                </span>

                <span className="status-label">Device:</span>
                <span className="device-name-mini">
                  {selectedMic.length > 12 ? selectedMic.substring(0, 12) + '...' : selectedMic}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mic Level Overlay */}
      {showMicLevel && (
        <div className="mic-level-overlay">
          <div className="mic-level-header">Audio Monitor</div>
          <div className="mic-level-row">
            <span className="mic-level-label">Level:</span>
            <span className="mic-level-value">{audioLevel.toFixed(6)}</span>
          </div>
          <div className="mic-level-bar">
            <div 
              className="mic-level-fill"
              style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
            />
          </div>
          <div className="mic-level-row">
            <span className="mic-level-label">Device:</span>
            <span className="mic-level-device">{selectedMic.length > 18 ? selectedMic.substring(0, 18) + '...' : selectedMic}</span>
          </div>
          <div className="mic-level-row">
            <span className="mic-level-label">Status:</span>
            <span className="mic-level-status">
              {isRecording ? 'RECORDING' : 'IDLE'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}