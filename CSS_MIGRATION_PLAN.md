# CSS Migration Plan

This document outlines the migration from 29 individual CSS files to a consolidated, organized structure.

## New CSS Architecture

```
src/styles/
├── index.css              # Main entry point
├── base/
│   ├── reset.css         # CSS reset and base element styles
│   ├── typography.css    # Font system and text utilities
│   └── layout.css        # Layout utilities and containers
├── components/
│   ├── buttons.css       # Button variants and states
│   ├── forms.css         # Input, select, checkbox styles
│   ├── modals.css        # Modal and dialog styles
│   └── cards.css         # Card component styles
├── utils/
│   ├── animations.css    # Keyframes and animation utilities
│   └── transitions.css   # Transition utilities
├── layouts/
│   ├── sidebar.css       # Sidebar component styles
│   ├── header.css        # Header/toolbar styles
│   └── overlay.css       # Overlay positioning
├── features/
│   ├── recording.css     # Recording-specific styles
│   ├── transcripts.css   # Transcript views and items
│   ├── settings.css      # Settings panel styles
│   └── onboarding.css    # Onboarding flow styles
└── themes/
    └── theme-overrides.css # Theme-specific overrides

```

## Migration Steps

### Phase 1: Base Infrastructure ✅
- [x] Create folder structure
- [x] Create base CSS files (reset, typography, layout)
- [x] Create utility files (animations, transitions)
- [x] Create component files (buttons, forms, modals)
- [x] Create index.css entry point

### Phase 2: Component Migration (In Progress)
- [ ] Migrate Sidebar.css → layouts/sidebar.css
- [ ] Migrate RecordView.css → features/recording.css
- [ ] Migrate TranscriptsView.css + TranscriptItem.css → features/transcripts.css
- [ ] Migrate SettingsView.css → features/settings.css
- [ ] Migrate OnboardingFlow.css → features/onboarding.css

### Phase 3: Smaller Components
- [ ] Merge MicrophoneSelector.css + MicrophoneQuickPicker.css → components/microphone.css
- [ ] Merge WaveformPlayer.css + SimpleAudioPlayer.css → components/audio-players.css
- [ ] Migrate Dropdown.css → components/dropdown.css
- [ ] Migrate Tooltip.css → components/tooltip.css
- [ ] Migrate ModelManager.css + LLMSettings.css → features/ai-settings.css

### Phase 4: Cleanup
- [ ] Remove duplicate styles
- [ ] Extract common patterns
- [ ] Update component imports to use new structure
- [ ] Delete old CSS files
- [ ] Update build process if needed

## Benefits of New Architecture

1. **Reduced Files**: From 29 files to ~15-20 organized files
2. **Better Organization**: Clear separation of concerns
3. **Easier Maintenance**: Related styles grouped together
4. **Consistent Patterns**: Shared utilities and components
5. **Theme Support**: Cleaner theme variable usage
6. **Performance**: Single import reduces HTTP requests

## Migration Guidelines

1. **Preserve Functionality**: Ensure all existing styles work as before
2. **Remove Duplication**: Identify and consolidate duplicate styles
3. **Use CSS Variables**: Convert hard-coded values to variables where appropriate
4. **Document Changes**: Add comments for complex styles
5. **Test Thoroughly**: Check all components after migration

## Component Import Updates

After migration, update component imports:

```typescript
// Old
import './TranscriptsView.css';

// New - components will rely on App.css importing the consolidated styles
// No individual CSS imports needed
```

## Next Steps

1. Start with Phase 2 component migrations
2. Test each component after migration
3. Run the app to ensure no visual regressions
4. Continue with smaller components
5. Final cleanup and optimization