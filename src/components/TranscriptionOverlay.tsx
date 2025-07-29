import { useState, useEffect, useRef, useCallback } from 'react';
import { safeEventListen } from '../lib/safeEventListener';
import { useResizable } from '../hooks/useResizable';
import { useTheme } from '../themes/useTheme';
import { useSettings } from '../hooks/useSettings';
import { useAudioLevel } from '../contexts/AudioContext';
import './TranscriptionOverlay.css';

interface TranscriptionChunk {
  id: number;
  text: string;
  timestamp: number;
  isPartial: boolean;
  isDecrypting?: boolean;
}

interface TranscriptionState {
  completedText: string;          // Top: Solid paragraph of completed transcription
  decryptingChunks: {             // Middle: Active chunks being decrypted
    id: string;
    originalText: string;
    scrambledText: string;
    progress: number;
    timestamp: number;
  }[];
  anticipatedText: string;        // Bottom: Live scrambled preview of incoming speech
  lastActivity: number;
}

interface TranscriptionOverlayProps {
  isVisible: boolean;
  isRecording: boolean;
  onClose: () => void;
  onSaveEdits?: (editedText: string) => void;
  onDiscardEdits?: () => void;
  mode?: 'teleprompter' | 'editor';
}

export function TranscriptionOverlay({
  isVisible,
  isRecording,
  onClose,
  onSaveEdits,
  onDiscardEdits,
  mode = 'teleprompter'
}: TranscriptionOverlayProps) {
  // Get audio level from the subscription hook
  const audioLevel = useAudioLevel();
  const { theme } = useTheme();
  const { overlayPosition } = useSettings();
  
  // Calculate position based on user settings (user setting takes precedence over theme)
  const getPositionFromTheme = useCallback(() => {
    const position = overlayPosition || theme.layout.overlayPosition || 'top-right';
    const padding = 20;
    const overlayWidth = 600;
    const overlayHeight = 400;
    
    switch (position) {
      case 'top-left': return { x: padding, y: padding };
      case 'top-center': return { x: window.innerWidth / 2 - overlayWidth / 2, y: padding };
      case 'top-right': return { x: window.innerWidth - overlayWidth - padding, y: padding };
      case 'center-left': return { x: padding, y: window.innerHeight / 2 - overlayHeight / 2 };
      case 'center': return { x: window.innerWidth / 2 - overlayWidth / 2, y: window.innerHeight / 2 - overlayHeight / 2 };
      case 'center-right': return { x: window.innerWidth - overlayWidth - padding, y: window.innerHeight / 2 - overlayHeight / 2 };
      case 'bottom-left': return { x: padding, y: window.innerHeight - overlayHeight - padding };
      case 'bottom-center': return { x: window.innerWidth / 2 - overlayWidth / 2, y: window.innerHeight - overlayHeight - padding };
      case 'bottom-right': return { x: window.innerWidth - overlayWidth - padding, y: window.innerHeight - overlayHeight - padding };
      default: return { x: window.innerWidth - overlayWidth - padding, y: padding }; // Default to top-right
    }
  }, [overlayPosition, theme.layout.overlayPosition]);
  
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>({
    completedText: '',
    decryptingChunks: [],
    anticipatedText: '',
    lastActivity: 0
  });
  const [editedText, setEditedText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [hasEdits, setHasEdits] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [currentMode, setCurrentMode] = useState<'teleprompter' | 'editor'>(mode);
  const [position, setPosition] = useState(() => {
    const savedPos = localStorage.getItem('scout-overlay-position-xy');
    if (savedPos) {
      try {
        return JSON.parse(savedPos);
      } catch {}
    }
    return getPositionFromTheme();
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [speechActivity, setSpeechActivity] = useState<{
    isActive: boolean;
    lastActivityTime: number;
    currentPattern: string;
  }>({ isActive: false, lastActivityTime: 0, currentPattern: '' });
  
  // Only log speech activity when overlay is visible and active
  if (process.env.NODE_ENV === 'development' && isVisible && isRecording) {
    console.debug('Speech activity state:', speechActivity);
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const teleprompterRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Make the overlay resizable
  const { isResizing } = useResizable({
    minWidth: 300,
    maxWidth: 800,
    defaultWidth: currentMode === 'teleprompter' ? 600 : 500,
  });

  // Generate scrambled text for decryption effect
  const scrambleText = (text: string): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    return text.split('').map(char => {
      if (char === ' ') return ' ';
      if (char.match(/[.!?]/)) return char;
      return chars[Math.floor(Math.random() * chars.length)];
    }).join('');
  };

  // Generate realistic speech-pattern scrambles based on audio activity
  const generateSpeechPattern = (audioLevel: number, duration: number = 1000): string => {
    // Approximate words based on audio level and duration
    const wordCount = Math.max(1, Math.floor((audioLevel * 10) + (duration / 800)));
    const words = [];
    
    for (let i = 0; i < wordCount; i++) {
      // Generate word-like scrambles (3-8 characters)
      const wordLength = Math.floor(Math.random() * 6) + 3;
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
      const scrambledWord = Array.from({ length: wordLength }, () => 
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
      words.push(scrambledWord);
    }
    
    return words.join(' ');
  };

  // Decrypt text gradually with elegant character reveal
  const decryptText = (original: string, scrambled: string, progress: number): string => {
    const chars = original.split('');
    const scrambledChars = scrambled.split('');
    const decryptedLength = Math.floor(chars.length * progress);
    
    return chars.map((char, index) => {
      if (index < decryptedLength) return char;
      return scrambledChars[index] || char;
    }).join('');
  };

  // Enhanced text reveal animation with mio.xyz-style effects

  // Split text into sentences

  // Combine all text for editor mode
  const fullText = transcriptionState.completedText + 
    transcriptionState.decryptingChunks.map(chunk => chunk.originalText).join(' ');

  // Update edited text when sentences change
  useEffect(() => {
    if (!hasEdits) {
      setEditedText(fullText);
      setOriginalText(fullText);
    }
  }, [fullText, hasEdits]);
  
  // Update position when theme overlay position changes
  useEffect(() => {
    const savedPos = localStorage.getItem('scout-overlay-position-xy');
    if (!savedPos && !isDragging) {
      // Only auto-update position if user hasn't manually positioned it
      setPosition(getPositionFromTheme());
    }
  }, [overlayPosition, theme.layout.overlayPosition, isDragging, getPositionFromTheme]);

  // Real-time audio level monitoring for immediate speech feedback
  useEffect(() => {
    if (!isVisible || currentMode !== 'teleprompter' || !isRecording) return;

    const SPEECH_THRESHOLD = 0.01; // Minimum audio level to trigger speech pattern
    const SPEECH_TIMEOUT = 1500; // Clear anticipated text after 1.5s of silence
    
    let lastAudioLevel = 0;
    let speechTimer: NodeJS.Timeout;

    // Monitor audio levels for immediate feedback
    const monitorSpeech = () => {
      const currentAudioLevel = audioLevel; // Use real audio level from props
      
      if (currentAudioLevel > SPEECH_THRESHOLD && Math.abs(currentAudioLevel - lastAudioLevel) > 0.005) {
        // Speech detected - update anticipated text at bottom
        const pattern = generateSpeechPattern(currentAudioLevel, 800);
        const now = Date.now();
        
        setTranscriptionState(prev => ({
          ...prev,
          anticipatedText: pattern,
          lastActivity: now
        }));

        setSpeechActivity({
          isActive: true,
          lastActivityTime: now,
          currentPattern: pattern
        });

        // Clear any existing timeout
        if (speechTimer) clearTimeout(speechTimer);
        
        // Set timeout to clear anticipated text
        speechTimer = setTimeout(() => {
          setTranscriptionState(prev => ({
            ...prev,
            anticipatedText: ''
          }));
          setSpeechActivity(prev => ({ ...prev, isActive: false }));
        }, SPEECH_TIMEOUT);
      }
      
      lastAudioLevel = currentAudioLevel;
    };

    // Start monitoring speech patterns
    const interval = setInterval(monitorSpeech, 150); // Check every 150ms

    return () => {
      clearInterval(interval);
      if (speechTimer) clearTimeout(speechTimer);
    };
  }, [isVisible, currentMode, isRecording, audioLevel]);

  // Enhanced chunk animation with mio.xyz-style text reveal
  const animateChunkDecryption = (chunkId: string, originalText: string) => {
    // TODO: Get animation type from settings
    const animationType = 'scramble' as 'scramble' | 'typewriter';
    if (animationType === 'typewriter') {
      // Character-by-character reveal animation
      const chars = originalText.split('');
      const revealDuration = Math.min(2000, chars.length * 30); // 30ms per char, max 2s
      const charDelay = revealDuration / chars.length;
    
    // Add chunk with empty text initially
    setTranscriptionState(prev => ({
      ...prev,
      decryptingChunks: [...prev.decryptingChunks, {
        id: chunkId,
        originalText,
        scrambledText: '',
        progress: 0,
        timestamp: Date.now()
      }],
      anticipatedText: '' // Clear anticipated text when real transcription arrives
    }));

    // Reveal characters one by one
    let revealedCount = 0;
    const revealInterval = setInterval(() => {
      revealedCount++;
      const revealedText = originalText.slice(0, revealedCount);
      const progress = revealedCount / chars.length;
      
      setTranscriptionState(prev => ({
        ...prev,
        decryptingChunks: prev.decryptingChunks.map(chunk => 
          chunk.id === chunkId 
            ? { ...chunk, scrambledText: revealedText, progress }
            : chunk
        )
      }));
      
      if (revealedCount >= chars.length) {
        clearInterval(revealInterval);
        
        // Move to completed after a brief pause
        setTimeout(() => {
          setTranscriptionState(prev => ({
            ...prev,
            completedText: prev.completedText + (prev.completedText ? ' ' : '') + originalText,
            decryptingChunks: prev.decryptingChunks.filter(chunk => chunk.id !== chunkId)
          }));
        }, 300);
      }
    }, charDelay);
    } else {
      // Original scramble effect
      const scrambled = scrambleText(originalText);
      const duration = 2500; // 2.5 seconds for satisfying decryption
      const steps = 35;
      const stepDuration = duration / steps;
      let step = 0;

      // Add chunk to decrypting zone
      setTranscriptionState(prev => ({
        ...prev,
        decryptingChunks: [...prev.decryptingChunks, {
          id: chunkId,
          originalText,
          scrambledText: scrambled,
          progress: 0,
          timestamp: Date.now()
        }],
        anticipatedText: '' // Clear anticipated text when real transcription arrives
      }));

      const decrypt = () => {
        step++;
        const progress = Math.pow(step / steps, 0.7); // Easing curve for smoother animation
        const currentText = decryptText(originalText, scrambled, progress);
        
        setTranscriptionState(prev => ({
          ...prev,
          decryptingChunks: prev.decryptingChunks.map(chunk => 
            chunk.id === chunkId 
              ? { ...chunk, scrambledText: currentText, progress }
              : chunk
          )
        }));

        if (step >= steps) {
          // Decryption complete - move to completed text and remove from decrypting
          setTranscriptionState(prev => ({
            ...prev,
            completedText: prev.completedText + (prev.completedText ? ' ' : '') + originalText,
            decryptingChunks: prev.decryptingChunks.filter(chunk => chunk.id !== chunkId)
          }));
        } else {
          setTimeout(decrypt, stepDuration);
        }
      };

      setTimeout(decrypt, stepDuration);
    }
  };

  // Listen for transcription events
  useEffect(() => {
    if (!isVisible) return;

    let mounted = true;
    let unsubscribeChunks: (() => void) | undefined;
    let unsubscribeComplete: (() => void) | undefined;

    const setupListeners = async () => {
      // Listen for partial transcription chunks (5-second ring buffer chunks)
      unsubscribeChunks = await safeEventListen('transcription-chunk', (event) => {
        if (!mounted) return;
        
        try {
          const chunk = event.payload as TranscriptionChunk;
          if (currentMode === 'teleprompter' && chunk.text.trim()) {
            // Add chunk to decryption zone (middle of hourglass)
            const chunkId = `chunk-${chunk.id}-${Date.now()}`;
            animateChunkDecryption(chunkId, chunk.text.trim());
          }
        } catch (error) {
          console.error('Error handling transcription chunk:', error);
        }
      });

      // Listen for complete transcripts (final full transcription)
      unsubscribeComplete = await safeEventListen('transcript-created', (event) => {
        if (!mounted) return;
        
        try {
          const transcript = event.payload as any;
          
          if (currentMode === 'teleprompter' && transcript.text.trim()) {
            // If this is a complete transcription and we have decrypting chunks, 
            // we can either replace them or append final text
            const finalChunkId = `final-${Date.now()}`;
            animateChunkDecryption(finalChunkId, transcript.text.trim());
          } else if (currentMode === 'editor') {
            // Editor mode - just append to completed text
            setTranscriptionState(prev => ({
              ...prev,
              completedText: prev.completedText + (prev.completedText ? ' ' : '') + transcript.text.trim()
            }));
          }
        } catch (error) {
          console.error('Error handling transcript-created:', error);
        }
      });
    };

    setupListeners();

    return () => {
      mounted = false;
      if (unsubscribeChunks) unsubscribeChunks();
      if (unsubscribeComplete) unsubscribeComplete();
    };
  }, [isVisible, currentMode]);

  // Handle text edits
  const handleTextChange = (text: string) => {
    setEditedText(text);
    setHasEdits(text !== originalText);
  };

  // Save edits
  const handleSaveEdits = () => {
    if (onSaveEdits) {
      onSaveEdits(editedText);
    }
    setOriginalText(editedText);
    setHasEdits(false);
  };

  // Discard edits
  const handleDiscardEdits = () => {
    setEditedText(originalText);
    setHasEdits(false);
    if (onDiscardEdits) {
      onDiscardEdits();
    }
  };

  // Clear all text (start fresh)
  const handleClear = () => {
    setTranscriptionState({
      completedText: '',
      decryptingChunks: [],
      anticipatedText: '',
      lastActivity: 0
    });
    setEditedText('');
    setOriginalText('');
    setHasEdits(false);
  };

  // Switch between modes
  const toggleMode = () => {
    setCurrentMode(prev => prev === 'teleprompter' ? 'editor' : 'teleprompter');
  };

  // Drag functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    if (headerRef.current && headerRef.current.contains(e.target as Node)) {
      setIsDragging(true);
      const rect = overlayRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const newPosition = {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      };
      setPosition(newPosition);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    // Save custom position to localStorage
    localStorage.setItem('scout-overlay-position-xy', JSON.stringify(position));
  };

  // Add drag event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  // Auto-scroll to show latest content
  useEffect(() => {
    if (currentMode === 'teleprompter' && teleprompterRef.current) {
      // Scroll to bottom to show latest transcription
      teleprompterRef.current.scrollTop = teleprompterRef.current.scrollHeight;
    } else if (currentMode === 'editor' && textareaRef.current && !hasEdits) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [transcriptionState, editedText, hasEdits, currentMode]);

  if (!isVisible) return null;

  return (
    <div
      ref={overlayRef}
      className={`transcription-overlay ${isMinimized ? 'minimized' : ''} ${isResizing ? 'resizing' : ''} ${isDragging ? 'dragging' : ''} ${theme.id === 'minimal-overlay' ? 'minimal-theme' : ''}`}
      style={{
        position: 'fixed',
        top: `${position.y}px`,
        left: `${position.x}px`,
        zIndex: 9999,
        opacity: theme.layout.overlayOpacity || 1,
        backgroundColor: theme.id === 'minimal-overlay' ? 'rgba(0, 0, 0, 0.8)' : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div ref={headerRef} className="transcription-overlay-header">
        <div className="overlay-title">
          <div className="title-text">
            {currentMode === 'teleprompter' ? 'Live Teleprompter' : 'Transcription Editor'}
          </div>
          <div className="title-status">
            {isRecording ? (
              <span className="status-recording">
                <span className="status-dot recording"></span>
                Recording
              </span>
            ) : (
              <span className="status-idle">
                <span className="status-dot idle"></span>
                Ready
              </span>
            )}
          </div>
        </div>
        
        <div className="overlay-controls">
          <button
            className={`overlay-button mode-toggle ${currentMode}`}
            onClick={toggleMode}
            title={`Switch to ${currentMode === 'teleprompter' ? 'editor' : 'teleprompter'} mode`}
          >
            {currentMode === 'teleprompter' ? '📝' : '📺'}
          </button>
          <button
            className="overlay-button minimize"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? '⬆️' : '⬇️'}
          </button>
          <button
            className="overlay-button close"
            onClick={onClose}
            title="Close overlay"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <div className="transcription-overlay-content">
          
          {/* Teleprompter Mode - Hourglass Pattern */}
          {currentMode === 'teleprompter' && (
            <div 
              ref={teleprompterRef}
              className="teleprompter-view hourglass"
            >
              {!transcriptionState.completedText && transcriptionState.decryptingChunks.length === 0 && !transcriptionState.anticipatedText ? (
                <div className="teleprompter-placeholder">
                  {isRecording 
                    ? "Transcription will appear here as you speak..." 
                    : "Start recording to see live transcription"}
                </div>
              ) : (
                <div className="hourglass-container">
                  {/* All text flows inline in a single paragraph */}
                  
                  {/* Completed text - no wrapper div */}
                  {transcriptionState.completedText && (
                    <span className="completed-text">
                      {transcriptionState.completedText}
                    </span>
                  )}
                  
                  {/* Add space between sections only if needed */}
                  {transcriptionState.completedText && transcriptionState.decryptingChunks.length > 0 && ' '}
                  
                  {/* Decrypting chunks inline */}
                  {transcriptionState.decryptingChunks.map((chunk, index) => (
                    <span key={chunk.id}>
                      <span
                        className={`decrypting-chunk ${chunk.progress === 1 ? 'revealed' : 'revealing'}`}
                        data-reveal-id={chunk.id}
                        style={{
                          '--reveal-progress': chunk.progress,
                        } as React.CSSProperties}
                      >
                        {chunk.scrambledText}
                      </span>
                      {/* Add space after chunk if not last */}
                      {index < transcriptionState.decryptingChunks.length - 1 && ' '}
                    </span>
                  ))}
                  
                  {/* Add space before anticipated text */}
                  {(transcriptionState.completedText || transcriptionState.decryptingChunks.length > 0) && 
                   transcriptionState.anticipatedText && ' '}
                  
                  {/* Anticipated text inline */}
                  {transcriptionState.anticipatedText && (
                    <span className="anticipated-text">
                      {transcriptionState.anticipatedText}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Editor Mode */}
          {currentMode === 'editor' && (
            <div className="transcription-text-container">
              <textarea
                ref={textareaRef}
                className="transcription-text"
                value={editedText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder={isRecording ? "Transcription will appear here as you speak..." : "Start recording to see transcription"}
                spellCheck={true}
              />
              
              {/* Overlay indicators */}
              <div className="text-overlay-indicators">
                {hasEdits && (
                  <div className="edit-indicator">
                    <span className="edit-dot"></span>
                    Edited
                  </div>
                )}
                
                {transcriptionState.decryptingChunks.length > 0 && (
                  <div className="partial-indicator">
                    <span className="partial-dot"></span>
                    Processing...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="transcription-overlay-actions">
            <div className="action-group left">
              <button
                className="action-button clear"
                onClick={handleClear}
                disabled={!transcriptionState.completedText && transcriptionState.decryptingChunks.length === 0}
                title="Clear all text"
              >
                Clear
              </button>
              
              <button
                className="action-button copy"
                onClick={() => navigator.clipboard.writeText(currentMode === 'editor' ? editedText : fullText)}
                disabled={!fullText.trim()}
                title="Copy to clipboard"
              >
                Copy
              </button>
            </div>

            {/* Only show edit controls in editor mode */}
            {currentMode === 'editor' && hasEdits && (
              <div className="action-group right">
                <button
                  className="action-button discard"
                  onClick={handleDiscardEdits}
                  title="Discard changes"
                >
                  Discard
                </button>
                <button
                  className="action-button save"
                  onClick={handleSaveEdits}
                  title="Save edits"
                >
                  Save Edits
                </button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="transcription-overlay-stats">
            <span className="stat">
              {currentMode === 'editor' 
                ? editedText.trim().split(/\s+/).filter(w => w.length > 0).length
                : fullText.trim().split(/\s+/).filter(w => w.length > 0).length
              } words
            </span>
            <span className="stat">
              {transcriptionState.decryptingChunks.length} decrypting
            </span>
            <span className="stat">
              {currentMode} mode
            </span>
            {currentMode === 'editor' && hasEdits && (
              <span className="stat edited">
                Modified
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

