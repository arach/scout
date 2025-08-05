import { memo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './AudioTestingView.css';

export const AudioTestingView = memo(function AudioTestingView() {
  const [isSimpleRecording, setIsSimpleRecording] = useState(false);
  const [isScoutRecording, setIsScoutRecording] = useState(false);
  const [isTestingDeviceConfig, setIsTestingDeviceConfig] = useState(false);
  const [isTestingMultiple, setIsTestingMultiple] = useState(false);
  const [isTestingArtificial, setIsTestingArtificial] = useState(false);
  const [voiceTestResults, setVoiceTestResults] = useState<any>(null);
  const [audioBlobUrls, setAudioBlobUrls] = useState<{[key: string]: string}>({});
  const [_corruptionAnalysis, _setCorruptionAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPureRecording, setIsPureRecording] = useState(false);
  const [isClassicRecording, setIsClassicRecording] = useState(false);
  const [isRingBufferNoCallbacks, setIsRingBufferNoCallbacks] = useState(false);
  const [isSimpleCallbackTest, setIsSimpleCallbackTest] = useState(false);

  const runSimpleTestRecording = async () => {
    if (isSimpleRecording) return;
    
    try {
      setIsSimpleRecording(true);
      const result = await invoke<string>('test_simple_recording');
      alert(`Simple test recording complete!\n\n${result}\n\nCheck the recordings folder and listen to the WAV file.`);
    } catch (error) {
      console.error('Simple test recording failed:', error);
      alert(`Simple test recording failed: ${error}`);
    } finally {
      setIsSimpleRecording(false);
    }
  };

  const runScoutPipelineRecording = async () => {
    if (isScoutRecording) return;
    
    try {
      setIsScoutRecording(true);
      const result = await invoke<string>('test_scout_pipeline_recording');
      alert(`Scout pipeline test recording complete!\n\n${result}\n\nCheck the recordings folder and listen to the WAV file.`);
    } catch (error) {
      console.error('Scout pipeline test recording failed:', error);
      alert(`Scout pipeline test recording failed: ${error}`);
    } finally {
      setIsScoutRecording(false);
    }
  };

  const runDeviceConfigTest = async () => {
    if (isTestingDeviceConfig) return;
    
    try {
      setIsTestingDeviceConfig(true);
      const result = await invoke<string>('test_device_config_consistency');
      alert(`Device config consistency test complete!\n\n${result}`);
    } catch (error) {
      console.error('Device config test failed:', error);
      alert(`Device config test failed: ${error}`);
    } finally {
      setIsTestingDeviceConfig(false);
    }
  };

  const runMultipleScoutTest = async () => {
    if (isTestingMultiple) return;
    
    try {
      setIsTestingMultiple(true);
      const result = await invoke<string>('test_multiple_scout_recordings');
      alert(`Multiple Scout recordings test complete!\n\n${result}\n\nCheck the recordings folder and compare the WAV files - do they get progressively worse?`);
    } catch (error) {
      console.error('Multiple Scout test failed:', error);
      alert(`Multiple Scout test failed: ${error}`);
    } finally {
      setIsTestingMultiple(false);
    }
  };

  const runArtificialMismatchTest = async () => {
    if (isTestingArtificial) return;
    
    try {
      setIsTestingArtificial(true);
      const result = await invoke<any>('test_voice_with_sample_rate_mismatch');
      
      // Create blob URLs for each recording
      const blobUrls: {[key: string]: string} = {};
      for (const recording of result.recordings) {
        try {
          const audioData = await invoke<number[]>('serve_audio_file', { filePath: recording.filepath });
          const blob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });
          blobUrls[recording.filepath] = URL.createObjectURL(blob);
        } catch (error) {
          console.error(`Failed to load audio for ${recording.filepath}:`, error);
        }
      }
      
      setAudioBlobUrls(blobUrls);
      setVoiceTestResults(result);
    } catch (error) {
      console.error('Voice mismatch test failed:', error);
      alert(`Voice mismatch test failed: ${error}`);
    } finally {
      setIsTestingArtificial(false);
    }
  };

  // @ts-ignore - Unused function kept for future use
  const _analyzeCorruptedRecordings = async () => {
    if (isAnalyzing) return;
    
    try {
      setIsAnalyzing(true);
      
      // Analyze the two corrupted recordings you identified
      const files = [
        '/Users/arach/Library/Application Support/com.jdi.scout/recordings/recording_20250803_132341.wav',
        '/Users/arach/Library/Application Support/com.jdi.scout/recordings/recording_20250803_132335.wav'
      ];
      
      const analyses = [];
      for (const filePath of files) {
        try {
          const analysis = await invoke<any>('analyze_audio_corruption', { filePath });
          analyses.push(analysis);
        } catch (error) {
          console.error(`Failed to analyze ${filePath}:`, error);
          analyses.push({ 
            file_path: filePath, 
            error: String(error),
            health_score: { overall: 'ERROR' }
          });
        }
      }
      
      _setCorruptionAnalysis(analyses);
    } catch (error) {
      console.error('Corruption analysis failed:', error);
      alert(`Corruption analysis failed: ${error}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startPureRecording = async () => {
    if (isPureRecording) return;
    
    try {
      setIsPureRecording(true);
      const result = await invoke<string>('start_recording_no_transcription');
      alert(`Pure recording started: ${result}`);
    } catch (error) {
      console.error('Pure recording start failed:', error);
      alert(`Pure recording start failed: ${error}`);
      setIsPureRecording(false);
    }
  };

  const stopPureRecording = async () => {
    if (!isPureRecording) return;
    
    try {
      const result = await invoke<string>('stop_recording_no_transcription');
      alert(`Pure recording stopped: ${result}`);
    } catch (error) {
      console.error('Pure recording stop failed:', error);
      alert(`Pure recording stop failed: ${error}`);
    } finally {
      setIsPureRecording(false);
    }
  };

  const startClassicRecording = async () => {
    if (isClassicRecording) return;
    
    try {
      setIsClassicRecording(true);
      const result = await invoke<string>('start_recording_classic_strategy');
      alert(`Classic strategy recording started: ${result}`);
    } catch (error) {
      console.error('Classic strategy recording start failed:', error);
      alert(`Classic strategy recording start failed: ${error}`);
      setIsClassicRecording(false);
    }
  };

  const stopClassicRecording = async () => {
    if (!isClassicRecording) return;
    
    try {
      const result = await invoke<string>('stop_recording');
      alert(`Classic strategy recording stopped: ${result}`);
    } catch (error) {
      console.error('Classic strategy recording stop failed:', error);
      alert(`Classic strategy recording stop failed: ${error}`);
    } finally {
      setIsClassicRecording(false);
    }
  };

  const startRingBufferNoCallbacks = async () => {
    if (isRingBufferNoCallbacks) return;
    
    try {
      setIsRingBufferNoCallbacks(true);
      const result = await invoke<string>('start_recording_ring_buffer_no_callbacks');
      alert(`Ring buffer (no callbacks) recording started: ${result}`);
    } catch (error) {
      console.error('Ring buffer no callbacks recording start failed:', error);
      alert(`Ring buffer no callbacks recording start failed: ${error}`);
      setIsRingBufferNoCallbacks(false);
    }
  };

  const stopRingBufferNoCallbacks = async () => {
    if (!isRingBufferNoCallbacks) return;
    
    try {
      const result = await invoke<string>('stop_recording');
      alert(`Ring buffer (no callbacks) recording stopped: ${result}`);
    } catch (error) {
      console.error('Ring buffer no callbacks recording stop failed:', error);
      alert(`Ring buffer no callbacks recording stop failed: ${error}`);
    } finally {
      setIsRingBufferNoCallbacks(false);
    }
  };

  const startSimpleCallbackTest = async () => {
    if (isSimpleCallbackTest) return;
    
    try {
      setIsSimpleCallbackTest(true);
      const result = await invoke<string>('start_recording_simple_callback_test');
      alert(`Simple callback test started: ${result}`);
    } catch (error) {
      console.error('Simple callback test start failed:', error);
      alert(`Simple callback test start failed: ${error}`);
      setIsSimpleCallbackTest(false);
    }
  };

  const stopSimpleCallbackTest = async () => {
    if (!isSimpleCallbackTest) return;
    
    try {
      const result = await invoke<string>('stop_recording');
      alert(`Simple callback test stopped: ${result}`);
    } catch (error) {
      console.error('Simple callback test stop failed:', error);
      alert(`Simple callback test stop failed: ${error}`);
    } finally {
      setIsSimpleCallbackTest(false);
    }
  };

  return (
    <div className="grid-container">
      <div className="grid-content grid-content--audio-testing">
        <div className="audio-testing-header">
          <h1>🧪 Audio Testing</h1>
          <p className="audio-testing-subtitle">
            Test raw audio recording without any processing, strategies, or transcription
          </p>
        </div>

        <div className="audio-testing-section">
          {/* Pure Recording Controls */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>🎙️ Pure Recording Controls</h3>
              <p className="test-card-description">
                Use Scout's main AudioRecorder WITHOUT any transcription components, sample callbacks, 
                or processing. This bypasses the entire transcription pipeline to isolate the audio corruption issue.
              </p>
            </div>
            
            <div className="test-card-content">
              {!isPureRecording ? (
                <button
                  onClick={startPureRecording}
                  disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple || isTestingArtificial}
                  className="test-recording-button scout-pipeline"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Start Pure Main Recording
                  </>
                </button>
              ) : (
                <button
                  onClick={stopPureRecording}
                  className="test-recording-button recording"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    </svg>
                    Stop Pure Recording
                  </>
                </button>
              )}
            </div>
            
            <div className="test-instructions">
              <h4>💡 How to use:</h4>
              <ol>
                <li>Click "Start Pure Main Recording" to begin recording without transcription</li>
                <li>Speak normally for 10-15 seconds</li>
                <li>Click "Stop Pure Recording" to finish</li>
                <li>Make multiple recordings to test for progressive degradation</li>
                <li>Compare the resulting WAV files - if they're clean, the issue is in transcription pipeline</li>
              </ol>
              <div className="test-note">
                <strong>Key difference:</strong> This uses Scout's main AudioRecorder but completely bypasses 
                all transcription components, sample callbacks, and the RecordingWorkflow that sets up the corruption pipeline.
              </div>
            </div>
          </div>

          {/* Classic Strategy Recording Controls */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>📝 Classic Strategy Recording</h3>
              <p className="test-card-description">
                Use Scout's recording workflow but force CLASSIC strategy instead of progressive. 
                This removes ring buffer, real-time chunking, and sample callbacks - but keeps transcription.
              </p>
            </div>
            
            <div className="test-card-content">
              {!isClassicRecording ? (
                <button
                  onClick={startClassicRecording}
                  disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple || isTestingArtificial || isPureRecording}
                  className="test-recording-button config-test"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Start Classic Strategy
                  </>
                </button>
              ) : (
                <button
                  onClick={stopClassicRecording}
                  className="test-recording-button recording"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    </svg>
                    Stop Classic Recording
                  </>
                </button>
              )}
            </div>
            
            <div className="test-instructions">
              <h4>📋 Classic vs Progressive:</h4>
              <ul>
                <li><strong>Progressive (current):</strong> Ring buffer + real-time chunking + sample callbacks</li>
                <li><strong>Classic (this test):</strong> Record → Stop → Process WAV file → Transcribe</li>
              </ul>
              <div className="test-note">
                <strong>Test Result:</strong> If classic strategy recordings are clean but regular recordings are corrupted, 
                the issue is specifically in the ring buffer/progressive pipeline components.
              </div>
            </div>
          </div>

          {/* Ring Buffer Without Callbacks */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>🔄 Ring Buffer WITHOUT Sample Callbacks</h3>
              <p className="test-card-description">
                Use ring buffer strategy but DISABLE the sample callbacks that forward audio to transcription. 
                This tests if the issue is in the callback system vs the ring buffer itself.
              </p>
            </div>
            
            <div className="test-card-content">
              {!isRingBufferNoCallbacks ? (
                <button
                  onClick={startRingBufferNoCallbacks}
                  disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple || isTestingArtificial || isPureRecording || isClassicRecording}
                  className="test-recording-button multiple-test"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Start Ring Buffer (No Callbacks)
                  </>
                </button>
              ) : (
                <button
                  onClick={stopRingBufferNoCallbacks}
                  className="test-recording-button recording"
                >
                  <>
                    <svg
                      width="20"
      	              height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    </svg>
                    Stop Ring Buffer Recording
                  </>
                </button>
              )}
            </div>
            
            <div className="test-instructions">
              <h4>🎯 What this tests:</h4>
              <ul>
                <li><strong>Keeps:</strong> Ring buffer, progressive strategy, real-time processing</li>
                <li><strong>Removes:</strong> Sample callbacks that forward audio to transcription</li>
              </ul>
              <div className="test-note">
                <strong>If this is clean:</strong> The issue is specifically in the sample callback forwarding system.<br/>
                <strong>If this is corrupted:</strong> The issue is in the ring buffer or progressive strategy itself.
              </div>
            </div>
          </div>

          {/* Simple Callback Test */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>🔍 Simple Callback Test</h3>
              <p className="test-card-description">
                Use ring buffer strategy with MINIMAL sample callback that only counts samples - no processing, 
                no .to_vec(), no channel forwarding. This isolates the exact corruption point.
              </p>
            </div>
            
            <div className="test-card-content">
              {!isSimpleCallbackTest ? (
                <button
                  onClick={startSimpleCallbackTest}
                  disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple || isTestingArtificial || isPureRecording || isClassicRecording || isRingBufferNoCallbacks}
                  className="test-recording-button artificial-test"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Start Simple Callback Test
                  </>
                </button>
              ) : (
                <button
                  onClick={stopSimpleCallbackTest}
                  className="test-recording-button recording"
                >
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    </svg>
                    Stop Simple Callback Test
                  </>
                </button>
              )}
            </div>
            
            <div className="test-instructions">
              <h4>🔬 Isolation Strategy:</h4>
              <ul>
                <li><strong>Keeps:</strong> Ring buffer strategy, progressive transcription, sample callbacks</li>
                <li><strong>Simplifies:</strong> Callback just counts samples - no samples.to_vec(), no channel forwarding</li>
              </ul>
              <div className="test-note">
                <strong>If this is clean:</strong> Corruption happens in samples.to_vec() or channel forwarding.<br/>
                <strong>If this is corrupted:</strong> Corruption happens in the callback system itself or ring buffer.
              </div>
            </div>
          </div>

          {/* Artificial Sample Rate Mismatch Test */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>🎯 Test Your Voice with Artificial Mismatch</h3>
              <p className="test-card-description">
                Records YOUR VOICE 3 times with Scout's recorder, then artificially corrupts recordings 2&3 
                to simulate sample rate mismatches. Compare how your voice sounds!
              </p>
            </div>
            
            <div className="test-card-content">
              <button
                onClick={runArtificialMismatchTest}
                disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple || isTestingArtificial}
                className={`test-recording-button artificial-test ${isTestingArtificial ? 'recording' : ''}`}
              >
                {isTestingArtificial ? (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <circle cx="12" cy="12" r="10"/>
                      <path d="m15 9-6 6"/>
                      <path d="m21 21-6-6"/>
                    </svg>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    Reproduce Issue
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Simple Test Recording */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>Simple Test Recording</h3>
              <p className="test-card-description">
                Records 3 seconds of audio directly to WAV file - no buffers, no strategies, no processing.
                Uses basic cpal + hound approach.
              </p>
            </div>
            
            <div className="test-card-content">
              <button
                onClick={runSimpleTestRecording}
                disabled={isSimpleRecording || isScoutRecording}
                className={`test-recording-button ${isSimpleRecording ? 'recording' : ''}`}
              >
                {isSimpleRecording ? (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <circle cx="12" cy="12" r="10"/>
                      <path d="m15 9-6 6"/>
                      <path d="m21 21-6-6"/>
                    </svg>
                    Recording...
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Simple Test Recording
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Scout Pipeline Test Recording */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>Scout Pipeline Test Recording</h3>
              <p className="test-card-description">
                Records 3 seconds using Scout's EXACT same AudioRecorder system - same as main recordings 
                but without transcription. This will reproduce the exact same issue.
              </p>
            </div>
            
            <div className="test-card-content">
              <button
                onClick={runScoutPipelineRecording}
                disabled={isSimpleRecording || isScoutRecording}
                className={`test-recording-button scout-pipeline ${isScoutRecording ? 'recording' : ''}`}
              >
                {isScoutRecording ? (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <circle cx="12" cy="12" r="10"/>
                      <path d="m15 9-6 6"/>
                      <path d="m21 21-6-6"/>
                    </svg>
                    Recording...
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    Scout Pipeline Test
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Multiple Scout Recordings Test */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>Multiple Scout Recordings Test</h3>
              <p className="test-card-description">
                Records 3 consecutive recordings using Scout's AudioRecorder system to test
                for progressive degradation. This should reproduce the issue if it exists.
              </p>
            </div>
            
            <div className="test-card-content">
              <button
                onClick={runMultipleScoutTest}
                disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig || isTestingMultiple}
                className={`test-recording-button multiple-test ${isTestingMultiple ? 'recording' : ''}`}
              >
                {isTestingMultiple ? (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <circle cx="12" cy="12" r="10"/>
                      <path d="m15 9-6 6"/>
                      <path d="m21 21-6-6"/>
                    </svg>
                    Recording 3x...
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12h18m-9-9v18"/>
                    </svg>
                    Test 3 Recordings
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Device Config Consistency Test */}
          <div className="test-card">
            <div className="test-card-header">
              <h3>Device Config Consistency Test</h3>
              <p className="test-card-description">
                Tests if the audio device is returning consistent configuration between queries.
                This helps diagnose progressive degradation issues.
              </p>
            </div>
            
            <div className="test-card-content">
              <button
                onClick={runDeviceConfigTest}
                disabled={isSimpleRecording || isScoutRecording || isTestingDeviceConfig}
                className={`test-recording-button config-test ${isTestingDeviceConfig ? 'recording' : ''}`}
              >
                {isTestingDeviceConfig ? (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="recording-icon"
                    >
                      <circle cx="12" cy="12" r="10"/>
                      <path d="m15 9-6 6"/>
                      <path d="m21 21-6-6"/>
                    </svg>
                    Testing...
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 12l2 2 4-4"/>
                      <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.03 0 3.87.67 5.37 1.8"/>
                    </svg>
                    Test Device Config  
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="test-instructions">
            <h4>How to use:</h4>
            <ol>
              <li>Run "Device Config Consistency Test" first to see if device config changes</li>
              <li>Then run "Simple Test Recording" - this should produce clean audio</li>
              <li>Finally run "Scout Pipeline Test" - this uses Scout's exact recording system</li>
              <li>Compare the two WAV files in your recordings folder</li>
              <li>If Simple sounds good but Scout Pipeline sounds bad, the issue is in Scout's recording pipeline</li>
            </ol>
            <div className="test-note">
              <strong>Purpose:</strong> This isolates whether the audio corruption is in Scout's complex recording system 
              (AudioRecorder, worker threads, device monitoring, validation) vs basic audio capture, and whether device 
              configuration is changing between recordings.
            </div>
          </div>

          {/* Voice Test Results */}
          {voiceTestResults && (
            <div className="voice-test-results">
              <h4>🎤 Voice Test Results</h4>
              <p>{voiceTestResults.summary}</p>
              <div className="audio-players">
                {voiceTestResults.recordings.map((recording: any) => (
                  <div key={recording.index} className="audio-player-card">
                    <div className="audio-player-header">
                      <h5>Recording {recording.index}</h5>
                      <span className="audio-description">{recording.description}</span>
                    </div>
                    <audio controls className="audio-player">
                      <source src={audioBlobUrls[recording.filepath] || `file://${recording.filepath}`} type="audio/wav" />
                      Your browser does not support the audio element.
                    </audio>
                    <div className="audio-filename">{recording.filename}</div>
                  </div>
                ))}
              </div>
              <div className="test-note">
                <strong>Listen and Compare:</strong> Recording 1 should sound like your normal voice. 
                If Recordings 2&3 sound like your degradation issue (slower/deeper), we've found the root cause!
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});