/** One entry per command; unavailable commands remain discoverable. */
export const COMPOSER_SHORTCUTS = [
 { name: '/ask', args: '@agent question', description: 'Hand a question to an agent in the room', action: 'ask' },
 { name: '/invite', args: '@person', description: 'Invite someone to this room', action: 'invite' },
 { name: '/dm', args: '@name', description: 'Open a direct chat', action: 'dm' },
 { name: '/topic', args: 'text', description: "Set the room’s topic", action: null },
 { name: '/remind', args: 'when what', description: 'Remind yourself or the room', action: null },
 { name: '/mute', args: '', description: 'Quiet this room', action: null },
] as const;
export function filterShortcuts(draft: string) {
 const needle = draft.replace(/^\//, '').split(/\s/)[0]?.toLowerCase() ?? '';
 return COMPOSER_SHORTCUTS.filter(command => command.name.slice(1).includes(needle));
}
