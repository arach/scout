import React from 'react';

// Format keyboard shortcuts as JSX with button/box styling
export const formatShortcutJSX = (shortcut: string) => {
    const keyMap: { [key: string]: string } = {
        'CmdOrCtrl': '⌘',  // Will show Cmd on Mac, Ctrl on Windows/Linux
        'Cmd': '⌘',
        'Command': '⌘',
        'Ctrl': 'Ctrl',
        'Control': 'Ctrl',
        'Shift': '⇧',
        'Alt': '⌥',
        'Option': '⌥',
        'Tab': '⇥',
        'Enter': '⏎',
        'Return': '⏎',
        'Delete': '⌫',
        'Backspace': '⌫',
        'Escape': 'Esc',
        'Esc': 'Esc',
        'Space': '␣',
        'Up': '↑',
        'Down': '↓',
        'Left': '←',
        'Right': '→'
    };
    
    const keys = shortcut.split('+').map(key => key.trim());
    
    return (
        <>
            {keys.map((key, index) => (
                <React.Fragment key={index}>
                    {index > 0 && <span className="key-separator">+</span>}
                    <kbd className="keyboard-key">
                        {keyMap[key] || key}
                    </kbd>
                </React.Fragment>
            ))}
        </>
    );
};