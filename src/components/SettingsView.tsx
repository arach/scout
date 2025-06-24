import { Fragment, useState, useRef, useEffect } from 'react';
import { Sparkles, FolderOpen, ArrowUpLeft, ArrowUp, ArrowUpRight, ArrowLeft, ArrowRight, ArrowDownLeft, ArrowDown, ArrowDownRight } from 'lucide-react';
import { ModelManager } from './ModelManager';
import { invoke } from '@tauri-apps/api/core';
import { formatShortcut } from '../lib/formatShortcut';
import { formatShortcutJSX } from '../lib/formatShortcutJSX';
import './SettingsView.css';

interface SettingsViewProps {
    hotkey: string;
    isCapturingHotkey: boolean;
    hotkeyUpdateStatus: 'idle' | 'success' | 'error';
    pushToTalkHotkey: string;
    isCapturingPushToTalkHotkey: boolean;
    vadEnabled: boolean;
    overlayPosition: string;
    autoCopy: boolean;
    autoPaste: boolean;
    visualMicPicker: boolean;
    theme: 'light' | 'dark' | 'system';
    stopCapturingHotkey: () => void;
    startCapturingHotkey: () => void;
    startCapturingPushToTalkHotkey: () => void;
    stopCapturingPushToTalkHotkey: () => void;
    toggleVAD: () => void;
    updateOverlayPosition: (position: string) => void;
    toggleAutoCopy: () => void;
    toggleAutoPaste: () => void;
    toggleVisualMicPicker: () => void;
    updateTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export function SettingsView({
    hotkey,
    isCapturingHotkey,
    hotkeyUpdateStatus,
    pushToTalkHotkey,
    isCapturingPushToTalkHotkey,
    vadEnabled,
    overlayPosition,
    autoCopy,
    autoPaste,
    visualMicPicker,
    theme,
    stopCapturingHotkey,
    startCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey,
    toggleVAD,
    updateOverlayPosition,
    toggleAutoCopy,
    toggleAutoPaste,
    toggleVisualMicPicker,
    updateTheme,
}: SettingsViewProps) {
    const [isModelManagerExpanded, setIsModelManagerExpanded] = useState(false);
    const modelSectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isModelManagerExpanded && modelSectionRef.current) {
            // Small delay to ensure the content is rendered
            setTimeout(() => {
                modelSectionRef.current?.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest'
                });
            }, 100);
        }
    }, [isModelManagerExpanded]);

    const openModelsFolder = async () => {
        try {
            await invoke('open_models_folder');
        } catch (error) {
            console.error('Failed to open models folder:', error);
        }
    };

    return (
        <div className="settings-view">
            <div className="settings-body">
                {/* Shortcuts Section - Two Columns */}
                <div className="settings-section">
                    <div className="settings-two-column">
                        <div className="setting-item">
                            <label>Toggle Recording Shortcut</label>
                            <div className="hotkey-input-group">
                                <div className={`hotkey-display ${isCapturingHotkey ? 'capturing' : ''}`}>
                                    {isCapturingHotkey ? (
                                        <span className="capturing-text">Press shortcut keys...</span>
                                    ) : (
                                        <span className="hotkey-keys" title={hotkey}>
                                            {formatShortcutJSX(hotkey)}
                                        </span>
                                    )}
                                </div>
                                {isCapturingHotkey ? (
                                    <button onClick={stopCapturingHotkey} className="cancel-button">
                                        Cancel
                                    </button>
                                ) : (
                                    <button onClick={startCapturingHotkey}>
                                        Capture
                                    </button>
                                )}
                            </div>
                            <p className="setting-hint">
                                Click "Capture" and press your desired shortcut combination
                            </p>
                            {hotkeyUpdateStatus === 'success' && (
                                <p className="setting-success">✓ Shortcut updated successfully!</p>
                            )}
                            {hotkeyUpdateStatus === 'error' && (
                                <p className="setting-error">Failed to update shortcut. Please try a different combination.</p>
                            )}
                        </div>

                        <div className="setting-item">
                            <label>Push-to-Talk Shortcut</label>
                            <div className="hotkey-input-group">
                                <div className={`hotkey-display ${isCapturingPushToTalkHotkey ? 'capturing' : ''}`}>
                                    {isCapturingPushToTalkHotkey ? (
                                        <span className="capturing-text">Press shortcut keys...</span>
                                    ) : (
                                        <span className="hotkey-keys" title={pushToTalkHotkey}>
                                            {formatShortcutJSX(pushToTalkHotkey)}
                                        </span>
                                    )}
                                </div>
                                {isCapturingPushToTalkHotkey ? (
                                    <button onClick={stopCapturingPushToTalkHotkey} className="cancel-button">
                                        Cancel
                                    </button>
                                ) : (
                                    <button onClick={startCapturingPushToTalkHotkey}>
                                        Capture
                                    </button>
                                )}
                            </div>
                            <p className="setting-hint">
                                Auto-stops recording after 10 seconds or press again to stop early
                            </p>
                        </div>
                    </div>
                </div>

                {/* Clipboard Settings - Two Columns */}
                <div className="settings-section">
                    <div className="settings-two-column">
                        <div className="setting-item">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={autoCopy}
                                    onChange={toggleAutoCopy}
                                />
                                Auto-copy to clipboard
                            </label>
                            <p className="setting-hint">
                                Automatically copy transcribed text to clipboard
                            </p>
                        </div>

                        <div className="setting-item">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={autoPaste}
                                    onChange={toggleAutoPaste}
                                />
                                Auto-paste
                            </label>
                            <p className="setting-hint">
                                Automatically paste transcribed text into active application
                            </p>
                        </div>
                    </div>
                </div>

                {/* Automation Settings - Two Columns */}
                <div className="settings-section">
                    <div className="settings-two-column">
                        <div className="setting-item">
                            <label>Overlay Position</label>
                            <div className="overlay-position-grid">
                                <button
                                    className={`position-button ${overlayPosition === 'top-left' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('top-left')}
                                    title="Top Left"
                                >
                                    <ArrowUpLeft size={18} />
                                </button>
                                <button
                                    className={`position-button ${overlayPosition === 'top-center' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('top-center')}
                                    title="Top Center"
                                >
                                    <ArrowUp size={18} />
                                </button>
                                <button
                                    className={`position-button ${overlayPosition === 'top-right' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('top-right')}
                                    title="Top Right"
                                >
                                    <ArrowUpRight size={18} />
                                </button>

                                <button
                                    className={`position-button ${overlayPosition === 'left-center' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('left-center')}
                                    title="Left Center"
                                >
                                    <ArrowLeft size={18} />
                                </button>
                                <div className="position-button-spacer"></div>
                                <button
                                    className={`position-button ${overlayPosition === 'right-center' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('right-center')}
                                    title="Right Center"
                                >
                                    <ArrowRight size={18} />
                                </button>

                                <button
                                    className={`position-button ${overlayPosition === 'bottom-left' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('bottom-left')}
                                    title="Bottom Left"
                                >
                                    <ArrowDownLeft size={18} />
                                </button>
                                <button
                                    className={`position-button ${overlayPosition === 'bottom-center' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('bottom-center')}
                                    title="Bottom Center"
                                >
                                    <ArrowDown size={18} />
                                </button>
                                <button
                                    className={`position-button ${overlayPosition === 'bottom-right' ? 'active' : ''}`}
                                    onClick={() => updateOverlayPosition('bottom-right')}
                                    title="Bottom Right"
                                >
                                    <ArrowDownRight size={18} />
                                </button>
                            </div>
                            <p className="setting-hint">
                                Choose where the recording indicator appears on your screen
                            </p>
                        </div>
                        
                        <div className="setting-item">
                            <label>Theme</label>
                            <div className="theme-selector">
                                <button
                                    className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                                    onClick={() => updateTheme('light')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                                        <path d="M8 1V3M8 13V15M15 8H13M3 8H1M12.95 3.05L11.54 4.46M4.46 11.54L3.05 12.95M12.95 12.95L11.54 11.54M4.46 4.46L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                    Light
                                </button>
                                <button
                                    className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                                    onClick={() => updateTheme('dark')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M8.5 2C5.46 2 3 4.46 3 7.5C3 10.54 5.46 13 8.5 13C10.83 13 12.82 11.45 13.56 9.3C13.19 9.42 12.8 9.5 12.38 9.5C10.17 9.5 8.38 7.71 8.38 5.5C8.38 4.31 8.89 3.24 9.69 2.5C9.3 2.18 8.91 2 8.5 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                                    </svg>
                                    Dark
                                </button>
                                <button
                                    className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                                    onClick={() => updateTheme('system')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="2" y="3" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                                        <path d="M5 13L6 15M10 13L11 15M4 15H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                    System
                                </button>
                            </div>
                            <p className="setting-hint">
                                Choose your preferred color theme or follow system settings
                            </p>
                        </div>
                        
                        <div className="setting-item">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={vadEnabled}
                                    onChange={toggleVAD}
                                />
                                Voice Activity Detection
                            </label>
                            <p className="setting-hint">
                                Automatically start recording when you speak
                            </p>
                        </div>

                        <div className="setting-item">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={visualMicPicker}
                                    onChange={toggleVisualMicPicker}
                                />
                                Visual Microphone Picker (Experimental)
                            </label>
                            <p className="setting-hint">
                                Use an enhanced visual interface for microphone selection with live audio visualization
                            </p>
                        </div>
                    </div>
                </div>

                {/* Model Manager - Full Width Collapsible */}
                <div className="settings-section model-manager-full-width" ref={modelSectionRef}>
                    <div className="collapsible-section">
                            <div className="collapsible-header-wrapper" style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                width: '100%'
                            }}>
                                <div 
                                    className="collapsible-header"
                                    onClick={() => setIsModelManagerExpanded(!isModelManagerExpanded)}
                                    style={{
                                        flex: 1,
                                        cursor: 'pointer'
                                    }}
                                >
                                    <div>
                                        <h3>
                                            <span className={`collapse-arrow ${isModelManagerExpanded ? 'expanded' : ''}`}>
                                                ▶
                                            </span>
                                            Transcription Models
                                            <span className="ai-badge">
                                                (AI)
                                                <Sparkles size={16} className="sparkle-icon" />
                                            </span>
                                        </h3>
                                        <p className="collapsible-subtitle">
                                            Download and manage AI models for transcription
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    className="open-models-folder-link"
                                    onClick={openModelsFolder}
                                    title="Add your own .bin model files here"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 10px',
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                        color: '#6b7280',
                                        border: '1px solid rgba(0, 0, 0, 0.08)',
                                        borderRadius: '5px',
                                        fontSize: '12px',
                                        fontWeight: '400',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        marginLeft: 'auto',
                                        alignSelf: 'center'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
                                        e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.12)';
                                        e.currentTarget.style.color = '#4b5563';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.04)';
                                        e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)';
                                        e.currentTarget.style.color = '#6b7280';
                                    }}
                                >
                                    <FolderOpen size={12} />
                                    Open Models Folder
                                </button>
                            </div>
                    </div>
                    {isModelManagerExpanded && (
                        <div className="collapsible-content">
                            <ModelManager />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
} 