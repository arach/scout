import { useState, useRef, useEffect, memo } from 'react';
import { Sparkles, FolderOpen, ArrowUpLeft, ArrowUp, ArrowUpRight, ArrowLeft, ArrowRight, ArrowDownLeft, ArrowDown, ArrowDownRight, Brain } from 'lucide-react';
import { ModelManager } from './ModelManager';
import { LLMSettings } from './LLMSettings';
import { Dropdown } from './Dropdown';
import { ThemeSelector } from './ThemeSelector';
import { invoke } from '@tauri-apps/api/core';
import { formatShortcutJSX } from '../lib/formatShortcutJSX';
import { LLMSettings as LLMSettingsType } from '../types/llm';
import { ThemeVariant } from '../themes/types';
import './SettingsView.css';
import './SettingsView-spacing.css';

interface SettingsViewProps {
    hotkey: string;
    isCapturingHotkey: boolean;
    hotkeyUpdateStatus: 'idle' | 'success' | 'error';
    pushToTalkHotkey: string;
    isCapturingPushToTalkHotkey: boolean;
    vadEnabled: boolean;
    overlayPosition: string;
    overlayTreatment: string;
    autoCopy: boolean;
    autoPaste: boolean;
    theme: 'light' | 'dark' | 'system';
    selectedTheme?: ThemeVariant;
    soundEnabled: boolean;
    startSound: string;
    stopSound: string;
    successSound: string;
    completionSoundThreshold: number;
    llmSettings: LLMSettingsType;
    stopCapturingHotkey: () => void;
    startCapturingHotkey: () => void;
    startCapturingPushToTalkHotkey: () => void;
    stopCapturingPushToTalkHotkey: () => void;
    toggleVAD: () => void;
    updateOverlayPosition: (position: string) => void;
    updateOverlayTreatment: (treatment: string) => void;
    toggleAutoCopy: () => void;
    toggleAutoPaste: () => void;
    updateTheme: (theme: 'light' | 'dark' | 'system') => void;
    updateSelectedTheme?: (theme: ThemeVariant) => void;
    toggleSoundEnabled: () => void;
    updateStartSound: (sound: string) => void;
    updateStopSound: (sound: string) => void;
    updateSuccessSound: (sound: string) => void;
    updateCompletionSoundThreshold: (threshold: number) => void;
    updateLLMSettings: (settings: Partial<LLMSettingsType>) => void;
}

export const SettingsView = memo(function SettingsView({
    hotkey,
    isCapturingHotkey,
    hotkeyUpdateStatus,
    pushToTalkHotkey,
    isCapturingPushToTalkHotkey,
    vadEnabled,
    overlayPosition,
    overlayTreatment,
    autoCopy,
    autoPaste,
    // theme,
    selectedTheme,
    soundEnabled,
    startSound,
    stopSound,
    successSound,
    completionSoundThreshold,
    llmSettings,
    stopCapturingHotkey,
    startCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey,
    toggleVAD,
    updateOverlayPosition,
    updateOverlayTreatment,
    toggleAutoCopy,
    toggleAutoPaste,
    // updateTheme,
    updateSelectedTheme,
    toggleSoundEnabled,
    updateStartSound,
    updateStopSound,
    updateSuccessSound,
    updateCompletionSoundThreshold,
    updateLLMSettings,
}: SettingsViewProps) {
    const [isModelManagerExpanded, setIsModelManagerExpanded] = useState(false);
    const [isLLMSettingsExpanded, setIsLLMSettingsExpanded] = useState(false);
    const modelSectionRef = useRef<HTMLDivElement>(null);
    const llmSectionRef = useRef<HTMLDivElement>(null);
    const [availableSounds, setAvailableSounds] = useState<string[]>([]);
    const [isPreviewingSound, setIsPreviewingSound] = useState(false);

    useEffect(() => {
        // Fetch available sounds
        invoke<string[]>('get_available_sounds')
            .then(sounds => setAvailableSounds(sounds))
            .catch(console.error);
    }, []);

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

    useEffect(() => {
        if (isLLMSettingsExpanded && llmSectionRef.current) {
            // Small delay to ensure the content is rendered
            setTimeout(() => {
                llmSectionRef.current?.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest'
                });
            }, 100);
        }
    }, [isLLMSettingsExpanded]);

    const openModelsFolder = async () => {
        try {
            await invoke('open_models_folder');
        } catch (error) {
            console.error('Failed to open models folder:', error);
        }
    };

    const previewSoundFlow = async () => {
        if (isPreviewingSound) return;
        
        console.log('Preview button clicked!');
        try {
            setIsPreviewingSound(true);
            await invoke('preview_sound_flow');
        } catch (error) {
            console.error('Failed to preview sound flow:', error);
            // Reset immediately on error
            setIsPreviewingSound(false);
            alert('Failed to preview sounds. Make sure the app is fully loaded.');
            return;
        }
        
        // Reset after the preview duration (2.5 seconds total) only on success
        setTimeout(() => {
            setIsPreviewingSound(false);
        }, 2500);
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

                {/* Sound Settings */}
                <div className="settings-section">
                    <div className="settings-section-header-row">
                        <h3 className="settings-section-header">Sound Settings</h3>
                        <button
                            onClick={previewSoundFlow}
                            disabled={!soundEnabled || isPreviewingSound}
                            className={`preview-sound-button ${isPreviewingSound ? 'playing' : ''}`}
                        >
                            {isPreviewingSound ? (
                                <>
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        style={{
                                            animation: 'spin 1s linear infinite'
                                        }}
                                    >
                                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                                    </svg>
                                    Playing...
                                </>
                            ) : (
                                <>
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                    </svg>
                                    Preview
                                </>
                            )}
                        </button>
                    </div>
                    <div className="setting-item" style={{ marginBottom: '20px' }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={soundEnabled}
                                onChange={toggleSoundEnabled}
                            />
                            Enable sound effects
                        </label>
                        <p className="setting-hint">
                            Play sounds when starting, stopping, and completing transcription
                        </p>
                    </div>

                    {/* Sound Flow */}
                    <div className="setting-item">
                        <label>Sound flow</label>
                        <div className="sound-flow-container">
                            <div className="sound-flow-item">
                                <div className="sound-flow-label">Start</div>
                                <Dropdown
                                    value={startSound}
                                    onChange={updateStartSound}
                                    options={availableSounds}
                                    disabled={!soundEnabled}
                                    style={{ width: '140px' }}
                                />
                            </div>
                            <div className="sound-flow-arrow">→</div>
                            <div className="sound-flow-item">
                                <div className="sound-flow-label">Stop</div>
                                <Dropdown
                                    value={stopSound}
                                    onChange={updateStopSound}
                                    options={availableSounds}
                                    disabled={!soundEnabled}
                                    style={{ width: '140px' }}
                                />
                            </div>
                            <div className="sound-flow-arrow">→</div>
                            <div className="sound-flow-item">
                                <div className="sound-flow-label">Complete</div>
                                <Dropdown
                                    value={successSound}
                                    onChange={updateSuccessSound}
                                    options={availableSounds}
                                    disabled={!soundEnabled}
                                    style={{ width: '140px' }}
                                />
                            </div>
                        </div>
                        <p className="setting-hint">
                            Sounds played during the recording and transcription process
                        </p>
                    </div>

                    {/* Completion Threshold */}
                    <div className="setting-item">
                        <label>Completion sound threshold</label>
                        <div className="range-input-container">
                            <input
                                type="range"
                                min="0"
                                max="10000"
                                step="500"
                                value={completionSoundThreshold}
                                onChange={(e) => updateCompletionSoundThreshold(Number(e.target.value))}
                                disabled={!soundEnabled}
                            />
                            <span className="range-value-display">
                                {(completionSoundThreshold / 1000).toFixed(1)}s
                            </span>
                        </div>
                        <p className="setting-hint">
                            Only play completion sound when processing takes longer than this duration
                        </p>
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
                            <label>Overlay Treatment</label>
                            <Dropdown
                                value={overlayTreatment}
                                onChange={updateOverlayTreatment}
                                options={[
                                    { value: 'particles', label: 'Particles' },
                                    { value: 'pulsingDot', label: 'Pulsing Dot' },
                                    { value: 'animatedWaveform', label: 'Waveform' },
                                    { value: 'gradientOrb', label: 'Gradient Orb' },
                                    { value: 'floatingBubbles', label: 'Floating Bubbles' }
                                ]}
                                style={{ width: '100%' }}
                            />
                            <p className="setting-hint">
                                Visual style of the recording indicator
                            </p>
                        </div>
                        
                        <div className="setting-item">
                            <ThemeSelector 
                                currentTheme={selectedTheme}
                                onThemeChange={updateSelectedTheme}
                            />
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

                    </div>
                </div>

                {/* Model Manager - Full Width Collapsible */}
                <div className="settings-section model-manager-full-width" ref={modelSectionRef}>
                    <div className="collapsible-section">
                            <div className="collapsible-header-wrapper">
                                <div 
                                    className="collapsible-header"
                                    onClick={() => setIsModelManagerExpanded(!isModelManagerExpanded)}
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

                {/* LLM Settings - Full Width Collapsible */}
                <div className="settings-section model-manager-full-width" ref={llmSectionRef}>
                    <div className="collapsible-section">
                        <div className="collapsible-header-wrapper">
                            <div 
                                className="collapsible-header"
                                onClick={() => setIsLLMSettingsExpanded(!isLLMSettingsExpanded)}
                            >
                                <div>
                                    <h3>
                                        <span className={`collapse-arrow ${isLLMSettingsExpanded ? 'expanded' : ''}`}>
                                            ▶
                                        </span>
                                        AI Processing
                                        <span className="ai-badge">
                                            (AI)
                                            <Brain size={16} className="sparkle-icon" />
                                        </span>
                                    </h3>
                                    <p className="collapsible-subtitle">
                                        Enhance transcripts with summaries and insights
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    {isLLMSettingsExpanded && (
                        <div className="collapsible-content">
                            <LLMSettings 
                                settings={llmSettings}
                                onUpdateSettings={updateLLMSettings}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}); 