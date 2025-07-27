# Dictionary Feature

Scout's dictionary feature allows you to define custom words, phrases, or acronyms that should be automatically replaced in your transcriptions. This is particularly useful for:

- Technical terms that Whisper might not recognize correctly
- Company names or product names with specific capitalization
- Acronyms that should be expanded
- Common mishearings that need correction

## How It Works

Scout uses a **post-processing replacement system** that runs after Whisper completes the transcription. This approach:

1. Receives the transcribed text from Whisper
2. Applies your dictionary rules in order
3. Tracks each replacement for analytics
4. Returns the corrected text

### Why Post-Processing?

Unlike traditional speech recognition systems (Dragon, Otter.ai) that train the acoustic model, Scout works with Whisper's pre-trained models. This means:

- ✅ **Instant updates** - No training required
- ✅ **Works with any model** - Tiny, Base, Small, Medium, or Large
- ✅ **Complex replacements** - Supports regex patterns and multi-word phrases
- ✅ **Zero performance impact** - Doesn't slow down transcription
- ❌ **Can't fix missing words** - If Whisper doesn't hear it, we can't replace it

## Dictionary Entry Types

### 1. Exact Match
Simple string replacement anywhere in the text.

```
"api" → "API"
Result: "The api documentation" → "The API documentation"
```

### 2. Word Match
Only replaces whole words (respects word boundaries).

```
"acme" → "ACME Corporation" (word match)
Result: "I work at acme" → "I work at ACME Corporation"
        "acme's products" → "ACME Corporation's products"
        "pacmega" → "pacmega" (not replaced)
```

### 3. Phrase Match
Flexible matching that handles punctuation variations.

```
"machine learning" → "Machine Learning"
Result: Works with "machine learning", "machine-learning", "machine, learning"
```

### 4. Regex Match
Advanced pattern matching for complex replacements.

```
Pattern: "\b(\d{3})[ -]?(\d{3})[ -]?(\d{4})\b"
Replace: "($1) $2-$3"
Result: "Call 5551234567" → "Call (555) 123-4567"
```

## Database Schema

Dictionary entries are stored in SQLite with full tracking capabilities:

### dictionary_entries table
- `id`: Unique identifier
- `original_text`: Text to search for
- `replacement_text`: Text to replace with
- `match_type`: exact, word, phrase, or regex
- `is_case_sensitive`: Whether to match case exactly
- `is_enabled`: Toggle entries on/off without deleting
- `category`: Optional grouping (e.g., "Medical", "Legal", "Tech")
- `description`: Notes about why this entry exists
- `usage_count`: How many times it's been used
- `created_at` / `updated_at`: Timestamps

### dictionary_match_history table
Every replacement is logged for analytics:
- `transcript_id`: Which transcript was affected
- `dictionary_entry_id`: Which dictionary entry was used
- `match_position`: Where in the text it was found
- `original_matched_text`: What was actually matched
- `replaced_text`: What it was replaced with

## Usage Analytics

Scout tracks every dictionary replacement, enabling insights like:

- **Most used entries**: Which replacements happen most often
- **Unused entries**: Which entries never match (candidates for deletion)
- **Match patterns**: When and where replacements occur
- **Debugging**: See exactly what was replaced in each transcript

Example analytics query:
```sql
-- Top 10 most used dictionary entries this month
SELECT 
    de.original_text,
    de.replacement_text,
    COUNT(dmh.id) as usage_count
FROM dictionary_entries de
JOIN dictionary_match_history dmh ON de.id = dmh.dictionary_entry_id
WHERE dmh.created_at > datetime('now', '-1 month')
GROUP BY de.id
ORDER BY usage_count DESC
LIMIT 10;
```

## API Commands

The dictionary feature exposes these commands to the frontend:

### get_dictionary_entries
Retrieve all dictionary entries or filter by enabled status.

```typescript
const entries = await invoke('get_dictionary_entries', { 
    enabledOnly: true 
});
```

### save_dictionary_entry
Create a new dictionary entry.

```typescript
const entryId = await invoke('save_dictionary_entry', {
    originalText: "ml",
    replacementText: "machine learning",
    matchType: "word",
    isCaseSensitive: false,
    category: "Tech",
    description: "Common ML abbreviation"
});
```

### update_dictionary_entry
Modify an existing entry.

```typescript
await invoke('update_dictionary_entry', {
    id: entryId,
    replacementText: "Machine Learning (ML)",
    isEnabled: true
});
```

### delete_dictionary_entry
Remove an entry permanently.

```typescript
await invoke('delete_dictionary_entry', { id: entryId });
```

### test_dictionary_replacement
Test replacements without saving to database.

```typescript
const result = await invoke('test_dictionary_replacement', {
    text: "I'm learning ml and ai at acme"
});
// Returns: "I'm learning Machine Learning (ML) and AI at ACME Corporation"
```

### get_dictionary_matches_for_transcript
See all replacements made in a specific transcript.

```typescript
const matches = await invoke('get_dictionary_matches_for_transcript', {
    transcriptId: 123
});
```

## Best Practices

### 1. Start Simple
Begin with exact or word matches before moving to complex regex patterns.

### 2. Use Categories
Group related entries (Medical, Legal, Company Names) for easier management.

### 3. Test First
Use `test_dictionary_replacement` to verify your patterns work correctly.

### 4. Monitor Usage
Regularly review analytics to remove unused entries and refine popular ones.

### 5. Order Matters
Longer phrases are processed first to avoid partial replacements. For example:
- "machine learning model" → "ML Model"
- "machine learning" → "ML"

The first rule will match before the second, preserving the full phrase.

### 6. Case Sensitivity
- Use case-insensitive for acronyms: "api" → "API"
- Use case-sensitive for names: "Mike" → "Michael" (not "mike")

## Examples

### Tech Industry
```
"api" → "API" (word match)
"ui" → "UI" (word match)
"ux" → "UX" (word match)
"saas" → "SaaS" (word match)
"k8s" → "Kubernetes" (exact match)
"repo" → "repository" (word match)
```

### Medical Field
```
"bp" → "blood pressure" (word match)
"dx" → "diagnosis" (word match)
"hx" → "history" (word match)
"tx" → "treatment" (word match)
```

### Company Specific
```
"acme" → "ACME Corporation" (word match)
"q1" → "Q1 2024" (word match, update quarterly)
"ceo" → "CEO Jane Smith" (word match)
```

### Phone Numbers (Regex)
```
Pattern: "\b(\d{3})(\d{3})(\d{4})\b"
Replace: "($1) $2-$3"
```

## Limitations

1. **Post-processing only**: Can't fix words Whisper doesn't hear
2. **No pronunciation training**: Can't teach Whisper how to hear new words
3. **Processing order**: Complex overlapping rules may conflict
4. **Performance**: Very large dictionaries (>10,000 entries) may impact speed

## Future Enhancements

Potential improvements being considered:

1. **Phonetic matching**: Match based on how words sound
2. **Context awareness**: Different replacements based on surrounding words
3. **Import/Export**: Share dictionaries between users
4. **Auto-learning**: Suggest entries based on common corrections
5. **Team sync**: Share dictionaries across organizations