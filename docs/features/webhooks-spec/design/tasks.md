# Design Engineering Tasks - Webhooks

## Overview
Design the user interface and experience for webhook configuration, testing, and monitoring within Scout's VSCode-inspired theme.

## Prerequisites
- Review the [webhook specification](../../webhooks-spec.md)
- Understand Scout's existing design language
- Coordinate with Frontend Engineer on component requirements

## Task Breakdown

### 1. Webhook Settings UI Design (1 day)

**Deliverable**: Figma mockups for webhook settings panel

**Requirements**:
- Design webhook list view with enable/disable toggles
- Create add/edit webhook form design
- Design empty state for no webhooks
- Include hover states and interactions
- Follow Scout's VSCode-inspired dark theme

**Design Specifications**:
- **List Item**: URL, description, status indicator, test button, edit/delete actions
- **Form Fields**: URL input with validation states, description textarea, enabled toggle
- **Visual Hierarchy**: Clear distinction between enabled/disabled webhooks
- **Responsive**: Adapt to different settings panel widths

**Components to Design**:
```
WebhookListItem
├── Status Indicator (green/gray dot)
├── URL (primary text)
├── Description (secondary text)
├── Last Triggered (timestamp)
├── Actions
│   ├── Test Button
│   ├── Edit Icon
│   └── Delete Icon
└── Enable Toggle
```

### 2. Webhook Test Experience (0.5 days)

**Deliverable**: Test flow mockups and feedback states

**Requirements**:
- Design test button states (idle, loading, success, error)
- Create test result modal/popover
- Show sample payload preview
- Design success/error feedback

**States to Design**:
- **Idle**: "Test" button
- **Loading**: Spinner with "Testing..." text
- **Success**: Green checkmark with "200 OK" and response time
- **Error**: Red X with error message and retry option

### 3. Webhook Logs Interface (1 day)

**Deliverable**: Log viewer design with filtering and detail views

**Requirements**:
- Design log table/list with key information
- Create filter UI for status, date, webhook
- Design expanded log detail view
- Show retry attempts clearly

**Log Entry Design**:
```
LogEntry
├── Status Icon (success/failure)
├── Webhook URL
├── Timestamp
├── Response Time
├── Status Code
├── Retry Badge (if applicable)
└── Expand Arrow
```

**Expanded View**:
- Request headers
- Response headers
- Error details
- Payload size
- Full timestamp

### 4. Error States & Edge Cases (0.5 days)

**Deliverable**: Error state designs for all user flows

**Error States**:
- Invalid URL input
- Network connection failure
- Server error responses
- Timeout errors
- No webhooks configured
- No logs available

**Design Principles**:
- Clear error messages with actionable next steps
- Consistent iconography for error types
- Helpful suggestions for resolution

### 5. User Flow Documentation (0.5 days)

**Deliverable**: User journey maps and interaction flows

**Key Flows**:
1. **First-time Setup**: Discover → Add → Test → Save
2. **Debugging Flow**: View Logs → Identify Issue → Edit → Re-test
3. **Management Flow**: View List → Toggle/Edit/Delete

**Flow Diagrams**:
- State diagrams for webhook lifecycle
- Interaction flow for testing
- Error recovery paths

### 6. Component Library Integration (0.5 days)

**Deliverable**: Component specifications for development

**Requirements**:
- Map designs to Scout's existing components
- Identify new components needed
- Provide spacing, color, and typography tokens
- Create reusable patterns

**Style Guide**:
```
Colors:
- Success: #28a745 (green)
- Error: #dc3545 (red)
- Warning: #ffc107 (amber)
- Disabled: #6c757d (gray)
- Primary: #007acc (VSCode blue)

Spacing:
- List item padding: 12px
- Form field spacing: 16px
- Section margins: 24px

Typography:
- URL: 14px monospace
- Description: 12px regular
- Timestamps: 11px muted
```

### 7. Documentation & Handoff (0.5 days)

**Deliverable**: Design documentation and asset export

**Requirements**:
- Export all icons in SVG format
- Create animation specifications
- Document interaction patterns
- Provide implementation notes

## Design Principles

### Visual Hierarchy
1. **Primary**: Webhook URL and status
2. **Secondary**: Description and last triggered
3. **Tertiary**: Actions and metadata

### Accessibility
- Minimum contrast ratio 4.5:1
- Focus indicators for keyboard navigation
- Clear success/error color coding with icons
- Descriptive labels for screen readers

### Interaction Patterns
- Immediate feedback for all actions
- Progressive disclosure for advanced options
- Inline editing where possible
- Confirmation for destructive actions

## Component Specifications

### WebhookListItem
```
Height: 64px
Padding: 12px 16px
Border: 1px solid rgba(255,255,255,0.1)
Hover: Background rgba(255,255,255,0.05)
```

### Form Elements
```
Input Height: 32px
Border Radius: 4px
Focus Border: 2px solid #007acc
Error Border: 2px solid #dc3545
```

### Buttons
```
Primary: bg-#007acc, hover-#005a9e
Secondary: bg-transparent, border-1px
Danger: bg-#dc3545, hover-#c82333
```

## Responsive Behavior

### Settings Panel Width
- **Narrow (<600px)**: Stack actions vertically
- **Medium (600-900px)**: Standard layout
- **Wide (>900px)**: Show additional metadata

### Mobile Considerations
- Larger touch targets (44px minimum)
- Simplified action menus
- Full-screen forms on small screens

## Integration Notes

### With Frontend Team
- Provide Figma component library
- Create interactive prototypes for complex flows
- Document animation timings and easing

### With Backend Team
- Understand technical constraints
- Design within performance limitations
- Consider loading states for slow operations

## Timeline

- **Total**: 4 days
- Mockups can begin immediately
- User testing after initial implementation
- Iterations based on feedback

## Deliverables Checklist

- [ ] Webhook settings panel mockups
- [ ] Add/Edit form designs
- [ ] Test flow and states
- [ ] Log viewer interface
- [ ] Error states for all flows
- [ ] User journey documentation
- [ ] Component specifications
- [ ] Icon set (add, edit, delete, test, success, error)
- [ ] Interactive Figma prototype
- [ ] Design handoff documentation