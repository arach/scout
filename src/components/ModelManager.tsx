import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './ModelManager.css';

interface WhisperModel {
  id: string;
  name: string;
  size_mb: number;
  description: string;
  url: string;
  filename: string;
  speed: string;
  accuracy: string;
  downloaded: boolean;
  active: boolean;
}

interface DownloadProgress {
  modelId: string;
  progress: number;
  downloadedMb: number;
  totalMb: number;
}

export const ModelManager: React.FC = () => {
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<{ [key: string]: DownloadProgress }>({});
  const [modelsDir, setModelsDir] = useState<string>('');

  useEffect(() => {
    loadModels();
    getModelsDir();
  }, []);

  const loadModels = async () => {
    try {
      const availableModels = await invoke<WhisperModel[]>('get_available_models');
      setModels(availableModels);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const getModelsDir = async () => {
    try {
      const dir = await invoke<string>('get_models_dir');
      setModelsDir(dir);
    } catch (error) {
      console.error('Failed to get models directory:', error);
    }
  };

  const downloadModel = async (model: WhisperModel) => {
    if (!modelsDir) return;

    // Initialize progress
    setDownloading(prev => ({
      ...prev,
      [model.id]: { modelId: model.id, progress: 0, downloadedMb: 0, totalMb: model.size_mb }
    }));

    try {
      // Set up progress listener
      const unlisten = await listen<{
        url: string;
        downloaded: number;
        total: number;
        progress: number;
      }>('download-progress', (event) => {
        if (event.payload.url === model.url) {
          const downloadedMb = event.payload.downloaded / 1048576;
          const totalMb = event.payload.total / 1048576;
          
          setDownloading(prev => ({
            ...prev,
            [model.id]: { 
              modelId: model.id, 
              progress: event.payload.progress, 
              downloadedMb, 
              totalMb 
            }
          }));
        }
      });

      // Construct destination path
      const destPath = `${modelsDir}/${model.filename}`;

      // Start download using backend service
      await invoke('download_file', {
        url: model.url,
        destPath: destPath
      });

      // Cleanup listener
      await unlisten();

      // Remove from downloading state
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });

      // Reload models to update download status
      await loadModels();
    } catch (error) {
      console.error('Failed to download model:', error);
      
      // Remove from downloading state
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });

      alert(`Failed to download ${model.name}: ${error}`);
    }
  };

  const setActiveModel = async (modelId: string) => {
    try {
      await invoke('set_active_model', { modelId });
      await loadModels();
    } catch (error) {
      console.error('Failed to set active model:', error);
      alert(`Failed to set active model: ${error}`);
    }
  };

  if (loading) {
    return <div className="model-manager-loading">Loading models...</div>;
  }

  return (
    <div className="model-manager">
      <div className="model-manager-header">
        <h3>Whisper Models</h3>
        <p className="model-manager-subtitle">
          Download better models for improved accuracy. The base model is included by default.
        </p>
      </div>
      
      <div className="model-list">
        {models.map(model => {
          const progress = downloading[model.id];
          const isDownloading = !!progress;
          
          return (
            <div key={model.id} className={`model-item ${model.active ? 'active' : ''}`}>
              <div className="model-info">
                <div className="model-header">
                  <h4>{model.name}</h4>
                  <span className="model-size">{model.size_mb} MB</span>
                </div>
                <p className="model-description">{model.description}</p>
                <div className="model-stats">
                  <span className="model-speed">Speed: {model.speed}</span>
                  <span className="model-accuracy">Accuracy: {model.accuracy}</span>
                </div>
              </div>
              
              <div className="model-actions">
                {!model.downloaded && !isDownloading && (
                  <button 
                    className="btn btn-download"
                    onClick={() => downloadModel(model)}
                  >
                    Download
                  </button>
                )}
                
                {isDownloading && (
                  <div className="download-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill"
                        style={{ width: `${progress.progress}%` }}
                      />
                    </div>
                    <span className="progress-text">
                      {progress.downloadedMb.toFixed(1)} / {progress.totalMb.toFixed(1)} MB
                    </span>
                  </div>
                )}
                
                {model.downloaded && !model.active && (
                  <button 
                    className="btn btn-activate"
                    onClick={() => setActiveModel(model.id)}
                  >
                    Use This Model
                  </button>
                )}
                
                {model.active && (
                  <span className="model-active-badge">Active</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};