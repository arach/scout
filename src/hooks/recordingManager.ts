// Global singleton to manage recording state across all component instances
class RecordingManager {
  private static instance: RecordingManager;
  private isRecording = false;
  private isStarting = false;
  private lastStartTime = 0;
  private listeners = new Set<() => void>();

  static getInstance(): RecordingManager {
    if (!RecordingManager.instance) {
      RecordingManager.instance = new RecordingManager();
    }
    return RecordingManager.instance;
  }

  canStartRecording(): boolean {
    const now = Date.now();
    // Prevent rapid starts within 500ms
    if (now - this.lastStartTime < 500) {
      console.log('RecordingManager: Ignoring rapid start request');
      return false;
    }
    
    if (this.isStarting || this.isRecording) {
      console.log('RecordingManager: Already starting or recording');
      return false;
    }
    
    return true;
  }

  setStarting(value: boolean) {
    this.isStarting = value;
    if (value) {
      this.lastStartTime = Date.now();
    }
    this.notifyListeners();
  }

  setRecording(value: boolean) {
    this.isRecording = value;
    this.notifyListeners();
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isStarting: this.isStarting
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  reset() {
    this.isRecording = false;
    this.isStarting = false;
    this.notifyListeners();
  }
}

export const recordingManager = RecordingManager.getInstance();