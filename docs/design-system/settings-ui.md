# Settings UI Design System

This document outlines the design principles and patterns for the Scout settings interface.

## Section Organization

### Hierarchy
1. **Recording & Audio** - All recording-related settings including:
   - Toggle Recording shortcut
   - Push-to-Talk shortcut (no enable toggle needed)
   - Sound effects settings with inline preview
   - Auto-copy and auto-paste options
2. **Display & Interface** - Visual and UI preferences:
   - Recording indicator position
   - Recording indicator style  
3. **Themes** - Theme selection (not collapsible)
4. **Transcription Models** - Model management (collapsible)
5. **Post-processing** - AI enhancement settings (collapsible)

### Section Structure
```tsx
<div className="settings-section">
  <div className="settings-section-header-row">
    <h3 className="settings-section-title">Section Title</h3>
    {/* Optional action button aligned to right */}
  </div>
  {/* Section content */}
</div>
```

## Title Conventions

### Rules
- **Every section must have a title** (no exceptions)
- Use **sentence case** (e.g., "Recording & Audio" not "RECORDING & AUDIO")
- Font size: **16px**
- Font weight: **600** (semi-bold)
- Color: `var(--text-primary)`
- No letter-spacing or text-transform

### CSS
```css
.settings-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
```

## Spacing Guidelines

- **Between sections**: 24px margin
- **Inside sections**: 16-20px padding
- **Below section titles**: 20px margin
- **Between settings**: 16px gap

## Push-to-Talk Pattern

Instead of an enable/disable toggle:
- Always show the shortcut capture interface
- "Not Set" indicates inactive state
- Provide a "Clear" button to remove shortcuts
- Hint text explains the behavior when a shortcut is set

Example:
```tsx
<div className="setting-item">
  <label>Push-to-Talk</label>
  <div className="hotkey-input-group">
    <div className="hotkey-display">
      {shortcut ? formatShortcutJSX(shortcut) : 'Not Set'}
    </div>
    <button>Capture</button>
    {shortcut && <button className="clear-button">Clear</button>}
  </div>
  <p className="setting-hint">
    When set, hold this key while speaking to record
  </p>
</div>
```

## Collapsible Sections

Reserved for content-heavy sections:
- Transcription Models
- Post-processing

Regular sections should not be collapsible to maintain quick access to common settings.

## Component Patterns

### Setting Item
```tsx
<div className="setting-item">
  <label>Setting Name</label>
  {/* Control (input, dropdown, etc.) */}
  <p className="setting-hint">Helper text explaining the setting</p>
</div>
```

### Checkbox Settings
```tsx
<div className="setting-item">
  <label>
    <input type="checkbox" checked={value} onChange={handler} />
    <span>Setting label</span>
  </label>
  <p className="setting-hint">Description</p>
</div>
```

### Keyboard Shortcuts
```tsx
<div className="hotkey-input-group">
  <div className="hotkey-display">
    {/* Display formatted shortcut or "Not Set" */}
  </div>
  <button>Capture</button>
  {hasShortcut && <button className="clear-button">Clear</button>}
</div>
```

## Color Tokens

Settings use these semantic color tokens:
- Section background: `var(--bg-secondary)`
- Section borders: `var(--border-primary)`
- Title text: `var(--text-primary)`
- Hint text: `var(--text-secondary)`
- Active elements: `var(--accent-primary)`

## Accessibility

- All inputs must have associated labels
- Keyboard navigation should follow logical order
- Focus states must be clearly visible
- Settings should be operable with keyboard only

## Design Rationale

### Grouping Decisions
- **Recording & Audio** combines all recording-related settings to avoid separation of related shortcuts
- Push-to-talk doesn't need an enable toggle - presence of a shortcut indicates it's active
- Themes moved up in hierarchy as a primary setting users frequently access

### Consistency Improvements
- All sections now have visible titles using consistent styling
- Removed mixed conventions (some with titles, some without)
- Standardized spacing between sections and settings

### User Feedback Integration
- Renamed "Overlay" to "Recording Indicator" for clarity
- Removed "Appearance" as a buried collapsible section
- Simplified push-to-talk by removing unnecessary toggle
- Consolidated keyboard shortcuts in one location