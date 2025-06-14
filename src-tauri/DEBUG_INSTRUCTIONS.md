# Debugging Scout Transcription Issues

I've added extensive logging to help debug why transcripts aren't showing. Here's what you need to do:

## 1. Run the Application with Console Output

Run the app in development mode to see all console logs:

```bash
npm run tauri dev
```

## 2. Check Both Console Outputs

You'll need to monitor TWO console outputs:

1. **Browser Console** (in the app window):
   - Right-click in the app window and select "Inspect Element" or "Developer Tools"
   - Go to the Console tab
   - You should see logs like:
     - "Starting transcription..."
     - "Transcript received: ..."
     - "Transcript length: ..."

2. **Terminal Console** (where you ran `npm run tauri dev`):
   - This shows the Rust backend logs
   - You should see logs like:
     - "=== Starting transcription for file: ..."
     - "Audio path: ..."
     - "Audio file size: ... bytes"
     - "Model path: ..."
     - "Transcriber: Loading audio file..."
     - "Transcriber: Audio loaded, ... samples"
     - "Transcriber: Running full transcription..."
     - "Transcriber: Found ... segments"
     - "Transcription complete. Result length: ... characters"

## 3. What to Look For

### If transcription is working but not displaying:
- Check if "Transcript received:" shows actual text in browser console
- Check if "Save transcript result:" shows a successful save
- Check if the transcript list updates after recording

### If transcription is failing:
- Look for ERROR messages in the terminal console
- Common issues:
  - "Audio file not found" - recording didn't save properly
  - "Whisper model not found" - model needs to be downloaded
  - "Failed to create whisper context" - model file might be corrupted
  - "Failed to transcribe" - audio format issue

### If no segments are found:
- Terminal will show "Transcriber: Found 0 segments"
- This means Whisper didn't detect any speech in the audio
- Try speaking louder or closer to the microphone

## 4. Test Recording

1. Click "Start Recording"
2. Say something clearly like "Testing one two three, this is a test recording"
3. Click "Stop Recording"
4. Watch both consoles for the logging output

## 5. Share the Logs

If it's still not working, please share:
1. All logs from the terminal console (especially any ERROR lines)
2. All logs from the browser console
3. Whether the audio file size shows as > 0 bytes

This will help identify exactly where the process is failing.