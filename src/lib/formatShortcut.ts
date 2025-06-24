// Format keyboard shortcuts with proper symbols
export const formatShortcut = (shortcut: string) => {
    const keyMap: { [key: string]: string } = {
        'Cmd': '⌘',
        'Command': '⌘',
        'Ctrl': '⌃',
        'Control': '⌃',
        'Shift': '⇧',
        'Alt': '⌥',
        'Option': '⌥',
        'Tab': '⇥',
        'Enter': '⏎',
        'Return': '⏎',
        'Delete': '⌫',
        'Backspace': '⌫',
        'Escape': '⎋',
        'Esc': '⎋',
        'Space': '␣',
        'Up': '↑',
        'Down': '↓',
        'Left': '←',
        'Right': '→'
    };
    
    return shortcut.split('+').map(key => {
        const trimmedKey = key.trim();
        return keyMap[trimmedKey] || trimmedKey;
    }).join(' ');
};