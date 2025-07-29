import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../contexts/SettingsContext';

export function useHotkeyCapture() {
  const { state, actions } = useSettings();
  const [capturedKeys, setCapturedKeys] = useState<string[]>([]);

  const startCapturingHotkey = useCallback(() => {
    actions.startCapturingHotkey();
    setCapturedKeys([]);
  }, [actions]);

  const startCapturingPushToTalkHotkey = useCallback(() => {
    actions.startCapturingPushToTalkHotkey();
    setCapturedKeys([]);
  }, [actions]);

  const updateHotkey = useCallback(async (newHotkey: string) => {
    try {
      await invoke('set_global_shortcut', { shortcut: newHotkey });
      localStorage.setItem('scout-hotkey', newHotkey);
      
      // Clear the status after 3 seconds
      setTimeout(() => {
        actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'idle' });
      }, 3000);
    } catch (error) {
      console.error('Failed to update shortcut:', error);
      actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'error' });
      
      setTimeout(() => {
        actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'idle' });
      }, 3000);
    }
  }, [actions]);

  const updatePushToTalkHotkey = useCallback(async (newHotkey: string) => {
    try {
      await invoke('set_push_to_talk_shortcut', { shortcut: newHotkey });
      localStorage.setItem('scout-push-to-talk-hotkey', newHotkey);
      
      setTimeout(() => {
        actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'idle' });
      }, 3000);
    } catch (error) {
      console.error('Failed to update push-to-talk shortcut:', error);
      actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'error' });
      
      setTimeout(() => {
        actions.dispatch({ type: 'SET_HOTKEY_UPDATE_STATUS', payload: 'idle' });
      }, 3000);
    }
  }, [actions]);

  const stopCapturingHotkey = useCallback(() => {
    actions.stopCapturingHotkey();
    if (capturedKeys.length > 0) {
      // Convert captured keys to Tauri format
      const convertedKeys = capturedKeys.map(key => {
        // For cross-platform compatibility, convert Cmd to CmdOrCtrl when it's alone
        if (key === 'Cmd') return 'CmdOrCtrl';
        // CmdOrCtrl stays as is (already handled in capture)
        return key;
      });
      const newHotkey = convertedKeys.join('+');
      actions.dispatch({ type: 'UPDATE_CAPTURED_HOTKEY', payload: newHotkey });
      // Auto-save the hotkey
      updateHotkey(newHotkey);
    }
    setCapturedKeys([]);
  }, [actions, capturedKeys, updateHotkey]);

  const stopCapturingPushToTalkHotkey = useCallback(() => {
    actions.stopCapturingPushToTalkHotkey();
    if (capturedKeys.length > 0) {
      const convertedKeys = capturedKeys.map(key => {
        if (key === 'Cmd') return 'CmdOrCtrl';
        return key;
      });
      const newHotkey = convertedKeys.join('+');
      actions.dispatch({ type: 'UPDATE_CAPTURED_PUSH_TO_TALK_HOTKEY', payload: newHotkey });
      // Auto-save the hotkey
      updatePushToTalkHotkey(newHotkey);
    }
    setCapturedKeys([]);
  }, [actions, capturedKeys, updatePushToTalkHotkey]);

  // Keyboard event handlers
  useEffect(() => {
    if (!state.shortcuts.isCapturingHotkey && !state.shortcuts.isCapturingPushToTalkHotkey) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const keys: string[] = [];
      
      // Detect CmdOrCtrl vs individual modifiers
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        // Only Cmd or Ctrl is pressed (no other modifiers)
        keys.push('CmdOrCtrl');
      } else {
        // Build up the modifier combination
        if (e.metaKey) keys.push('Cmd');
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
      }
      
      // Add the actual key if it's not a modifier
      if (e.key && !['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key)) {
        let key = e.key;
        
        // Handle Escape specially to cancel capture
        if (key === 'Escape') {
          if (state.shortcuts.isCapturingHotkey) {
            stopCapturingHotkey();
          } else if (state.shortcuts.isCapturingPushToTalkHotkey) {
            stopCapturingPushToTalkHotkey();
          }
          return;
        }
        
        // Capitalize single letters
        if (key.length === 1) {
          key = key.toUpperCase();
        }
        
        // Map special keys to their common names
        const keyMap: Record<string, string> = {
          ' ': 'Space',
          'ArrowUp': 'Up',
          'ArrowDown': 'Down',
          'ArrowLeft': 'Left',
          'ArrowRight': 'Right',
          'Enter': 'Return',
          'Tab': 'Tab',
          'Backspace': 'Backspace',
          'Delete': 'Delete',
          'Home': 'Home',
          'End': 'End',
          'Insert': 'Insert',
          'PageUp': 'PageUp',
          'PageDown': 'PageDown',
        };
        
        if (keyMap[key]) {
          key = keyMap[key];
        }
        
        keys.push(key);
      }
      
      if (keys.length > 0) {
        setCapturedKeys(keys);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Only stop capturing when a non-modifier key is released
      // This allows capturing complex modifier combinations
      const isModifierKey = ['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key);
      
      if (!isModifierKey && capturedKeys.length > 0) {
        if (state.shortcuts.isCapturingHotkey) {
          stopCapturingHotkey();
        } else if (state.shortcuts.isCapturingPushToTalkHotkey) {
          stopCapturingPushToTalkHotkey();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    state.shortcuts.isCapturingHotkey, 
    state.shortcuts.isCapturingPushToTalkHotkey, 
    capturedKeys,
    stopCapturingHotkey,
    stopCapturingPushToTalkHotkey
  ]);

  return {
    startCapturingHotkey,
    startCapturingPushToTalkHotkey,
    stopCapturingHotkey,
    stopCapturingPushToTalkHotkey,
    capturedKeys
  };
}