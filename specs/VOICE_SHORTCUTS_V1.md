# Scout Voice Shortcuts v1.0 Product Spec

## Overview
Add immediate voice commands to Scout's dictation flow using "Scout [action]" syntax. Commands execute locally, synchronously, and are removed from final transcript.

## Core Commands

| Pattern | Action | Example |
|---------|--------|---------|
| `Scout copy` | Copy transcript to clipboard | "Meeting notes... Scout copy" |
| `Scout send to [app]` | Send to app via clipboard | "Action items... Scout send to Slack" |
| `Scout save` | Save transcript with timestamp | "Daily standup... Scout save" |
| `Scout delete` | Remove last sentence | "This is wrong... Scout delete" |

## Technical Implementation

### Command Detection Pipeline
```rust
pub fn process_transcript(raw_text: &str) -> ProcessedTranscript {
    if let Some((command, cleaned_text)) = extract_scout_command(raw_text) {
        execute_command(command);
        ProcessedTranscript { text: cleaned_text, command_executed: Some(command) }
    } else {
        ProcessedTranscript { text: raw_text.to_string(), command_executed: None }
    }
}
```

### Pattern Matching (Naive)
```rust
fn parse_command(input: &str) -> Option<ScoutCommand> {
    let lower = input.to_lowercase();
    if lower.contains("copy") { return Some(ScoutCommand::Copy); }
    if lower.contains("send") || lower.contains("slack") { 
        return Some(ScoutCommand::SendToApp("slack".to_string())); 
    }
    if lower.contains("save") { return Some(ScoutCommand::Save); }
    if lower.contains("delete") { return Some(ScoutCommand::Delete); }
    None
}
```

## User Experience

### Flow
1. User dictates: "Take notes about the project timeline"
2. User adds: "Scout copy that" 
3. System: Copies transcript, removes command from text
4. Toast: "📋 Copied to clipboard"
5. Final transcript: "Take notes about the project timeline"

### Settings
```json
{
    "voice_shortcuts": {
        "enabled": false,
        "supported_apps": ["slack", "notion", "discord"]
    }
}
```

### UI Feedback
- ✅ Toast notifications for all commands
- ❌ Error messages for failed/unknown commands
- 📋 📨 💾 Icons for visual clarity

## App Integrations
Simple clipboard + app activation pattern:
```rust
pub fn send_to_slack(text: &str) -> Result<(), String> {
    clipboard::copy(text);
    app_activator::open_app("Slack");
    Ok(())
}
```

## Success Criteria
- Commands execute <200ms
- Zero false positives on normal "scout" mentions
- Command phrases always removed from transcript
- No impact on transcription performance

## Implementation Timeline
- **Week 1**: Core command detection pipeline
- **Week 2**: Copy/Save/Delete commands + feedback
- **Week 3**: App integrations (Slack, Notion, Discord)
- **Week 4**: Polish, testing, edge cases

## Out of Scope (v1)
- Multiple commands per session
- Command chaining/composition
- LLM/DSPy integration
- Custom user commands
- Complex parameter parsing