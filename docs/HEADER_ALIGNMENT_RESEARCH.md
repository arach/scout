# Header & Content Alignment Research Report

## Current Situation Analysis

Scout currently has three competing center points:
1. **Window title** - Centered in the entire window
2. **Header title** - Centered within the header (which starts after the sidebar)
3. **Content** - Offset by the sidebar width

This creates visual misalignment where nothing feels truly centered.

## Industry Approaches to Header/Sidebar Layouts

### 1. **Full-Width Header (Slack, Discord, Teams)**
```
┌─────────────────────────────────────┐
│          Header (Full Width)        │
├─────┬───────────────────────────────┤
│ Bar │      Main Content Area        │
└─────┴───────────────────────────────┘
```
- **Pros**: True center alignment for header elements
- **Cons**: Sidebar feels disconnected from header
- **Example**: Slack places workspace switcher in header, not sidebar

### 2. **No Header Approach (VSCode, Obsidian)**
```
┌─────┬────────────────────────────────┐
│     │   Content starts immediately   │
│ Bar │   Title/controls in content    │
│     │                                │
└─────┴────────────────────────────────┘
```
- **Pros**: Maximum vertical space, clean look
- **Cons**: Less structure, harder to add global controls
- **Example**: VSCode puts file name in editor tabs, not header

### 3. **Offset Header (Notion, Linear)**
```
┌─────┬───────────────────────────────┐
│ Bar │         Header Area           │
│     ├───────────────────────────────┤
│     │      Main Content Area        │
└─────┴───────────────────────────────┘
```
- **Pros**: Header and content align perfectly
- **Cons**: Asymmetric with window chrome
- **Example**: Notion's header flows with sidebar

### 4. **Dual Header (Figma, Adobe CC)**
```
┌─────────────────────────────────────┐
│        Global App Header            │
├─────┬───────────────────────────────┤
│ Bar │    Document Header            │
│     ├───────────────────────────────┤
│     │      Main Content Area        │
└─────┴───────────────────────────────┘
```
- **Pros**: Clear hierarchy, global vs document controls
- **Cons**: Uses more vertical space
- **Example**: Figma has app controls up top, file controls below

### 5. **Floating/Overlay Elements (Spotify, Apple Music)**
```
┌─────┬───────────────────────────────┐
│     │  ┌─────────────────┐          │
│ Bar │  │ Floating Header │          │
│     │  └─────────────────┘          │
│     │      Main Content Area        │
└─────┴───────────────────────────────┘
```
- **Pros**: Content can scroll under, modern feel
- **Cons**: Can obscure content, complexity
- **Example**: Spotify's now playing bar

## Alignment Strategies

### 1. **True Center** (Window-relative)
- Center based on full window width
- Used by: Apple apps, Windows apps
- Best for: Single-purpose apps

### 2. **Content Center** (Sidebar-aware)
- Center based on (window width - sidebar width)
- Used by: Notion, Linear, Craft
- Best for: Content-focused apps

### 3. **Optical Center** (Weighted)
- Slightly left of true center to account for sidebar
- Used by: Some design tools
- Best for: Balanced appearance

### 4. **Left-Aligned** (No centering)
- Embrace the asymmetry
- Used by: Slack (channel names), Discord
- Best for: Information-dense apps

## Recommendations for Scout

### Option 1: **Remove Header** (VSCode-style)
```typescript
// Move view title into sidebar or content area
// Use breadcrumbs or tabs for navigation
```
- Maximizes vertical space
- Eliminates alignment conflict
- Modern, minimal aesthetic

### Option 2: **Full-Width Header** (Slack-style)
```typescript
// Header spans entire window
// Sidebar starts below header
```
- True center alignment possible
- Space for global controls
- Traditional, familiar pattern

### Option 3: **Embrace Offset** (Notion-style)
```typescript
// Header starts after sidebar
// All content aligns to same grid
```
- Consistent alignment throughout
- Current implementation (refined)
- Accept asymmetry as design choice

### Option 4: **Smart Headers** (Context-aware)
```typescript
// Different views get different treatments
// Recording: No header (maximum space)
// Transcripts: Header with controls
// Settings: Embedded title
```
- Optimize per use case
- Best UX for each view
- More complex to implement

## Scout-Specific Considerations

1. **Recording View**: Needs maximum space for status/waveform
2. **Transcripts View**: Benefits from search/filter in header
3. **Settings View**: Title could be in content (like current modal)
4. **Mobile/Responsive**: Header pattern must scale down

## Recommended Solution

**Hybrid Approach**:
1. Remove standalone header
2. Embed view titles in content where needed
3. Move search to sidebar (collapsible when narrow)
4. Use breadcrumbs for navigation depth

This would:
- Eliminate centering conflicts
- Maximize vertical space
- Maintain functionality
- Scale well to mobile

## Implementation Priority

1. **Quick Fix**: Adjust current header to optical center
2. **Medium Term**: Test headerless design in one view
3. **Long Term**: Implement smart headers per view

## Visual Examples from Other Apps

- **Linear**: Header flows with sidebar, search in sidebar
- **Notion**: Offset header, embraces asymmetry  
- **Obsidian**: No header, controls in content
- **Height**: Minimal header, left-aligned elements
- **Things 3**: No header, navigation in sidebar
- **Bear**: Title in content, no separate header

The trend in modern apps is toward **less chrome** and **more content**, with controls appearing contextually rather than persistently.