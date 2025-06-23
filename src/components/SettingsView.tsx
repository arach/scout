import React, { Fragment } from 'react';
import { ModelManager } from './ModelManager';
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
    stopCapturingHotkey: () => void;
    startCapturingHotkey: () => void;
    startCapturingPushToTalkHotkey: () => void;
    stopCapturingPushToTalkHotkey: () => void;
    updateHotkey: (hotkey: string) => void;
    toggleVAD: () => void;
    updateOverlayPosition: (position: string) => void;
    toggleAutoCopy: () => void;
    toggleAutoPaste: () => void;
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
    stopCapturingHotkey,
    startCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingPushToTalkHotkey,
    updateHotkey,
    toggleVAD,
    updateOverlayPosition,
    toggleAutoCopy,
    toggleAutoPaste,
}: SettingsViewProps) {
    return (
        <div className="settings-view">
            <h1>Settings</h1>
            <div className="settings-body">
                <div className="setting-item">
                    <label>Toggle Recording Shortcut</label>
                    <div className="hotkey-input-group">
                        <div className={`hotkey-display ${isCapturingHotkey ? 'capturing' : ''}`}>
                            {isCapturingHotkey ? (
                                <span className="capturing-text">Press shortcut keys...</span>
                            ) : (
                                <span className="hotkey-keys">
                                    {hotkey.split('+').map((key, idx) => (
                                        <Fragment key={idx}>
                                            {idx > 0 && <span className="plus">+</span>}
                                            <kbd>{key}</kbd>
                                        </Fragment>
                                    ))}
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
                                <span className="hotkey-keys">
                                    {pushToTalkHotkey.split('+').map((key, idx) => (
                                        <Fragment key={idx}>
                                            {idx > 0 && <span className="plus">+</span>}
                                            <kbd>{key}</kbd>
                                        </Fragment>
                                    ))}
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


                <div className="setting-item">
                    <label>Overlay Position</label>
                    <div className="overlay-position-grid">
                        <button
                            className={`position-button ${overlayPosition === 'top-left' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('top-left')}
                            title="Top Left"
                        >↖</button>
                        <button
                            className={`position-button ${overlayPosition === 'top-center' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('top-center')}
                            title="Top Center"
                        >↑</button>
                        <button
                            className={`position-button ${overlayPosition === 'top-right' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('top-right')}
                            title="Top Right"
                        >↗</button>

                        <button
                            className={`position-button ${overlayPosition === 'left-center' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('left-center')}
                            title="Left Center"
                        >←</button>
                        <button
                            className="position-button center" disabled
                        >●</button>
                        <button
                            className={`position-button ${overlayPosition === 'right-center' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('right-center')}
                            title="Right Center"
                        >→</button>

                        <button
                            className={`position-button ${overlayPosition === 'bottom-left' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('bottom-left')}
                            title="Bottom Left"
                        >↙</button>
                        <button
                            className={`position-button ${overlayPosition === 'bottom-center' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('bottom-center')}
                            title="Bottom Center"
                        >↓</button>
                        <button
                            className={`position-button ${overlayPosition === 'bottom-right' ? 'active' : ''}`}
                            onClick={() => updateOverlayPosition('bottom-right')}
                            title="Bottom Right"
                        >↘</button>
                    </div>
                    <p className="setting-hint">
                        Choose where the recording indicator appears on your screen
                    </p>
                </div>


                <div className="setting-item model-manager-section">
                    <ModelManager />
                </div>
            </div>
        </div>
    );
} 