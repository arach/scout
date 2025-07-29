import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { BarChart3, Gauge, Package, CheckCircle, Sparkles, Download } from 'lucide-react';
import './ModelManager.css';
import './shared/ModelCard.css';

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
  
  const formatSize = (mb: number): string => {
    if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

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
      const unlisten = await safeEventListen<{
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
      unlisten();

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
      <div className="model-list model-grid">
        {models.map(model => {
          const progress = downloading[model.id];
          const isDownloading = !!progress;
          
          // Determine quality label based on model
          let qualityLabel = null;
          let qualityClass = '';
          
          if (!model.active) {
            if (model.id === 'tiny.en') {
              qualityLabel = 'Included';
              qualityClass = 'included';
            } else if (model.id === 'base.en') {
              qualityLabel = 'Recommended';
              qualityClass = 'recommended';
            }
          }
          
          return (
            <div key={model.id} className={`model-card ${model.active ? 'active' : ''}`}>
              <div className="model-card-header">
                <h3 className="model-name">{model.name}</h3>
              </div>
              
              {/* Status badges positioned in top-right */}
              {model.active && (
                <div className="model-status">
                  <span className="model-badge active">
                    <CheckCircle size={12} />
                    Active
                  </span>
                </div>
              )}
              
              {qualityLabel && !model.active && model.downloaded && (
                <div className="model-status">
                  <span className={`model-badge ${qualityClass}`}>
                    {qualityLabel}
                  </span>
                </div>
              )}
              
              <div className="model-details">
                <div className="model-stat">
                  <Gauge size={12} className="stat-icon" />
                  <span>Speed: {model.speed}</span>
                </div>
                <div className="model-stat">
                  <BarChart3 size={12} className="stat-icon" />
                  <span>Accuracy: {model.accuracy}</span>
                </div>
                <div className="model-stat">
                  <Package size={12} className="stat-icon" />
                  <span>Size: {formatSize(model.size_mb)}</span>
                </div>
              </div>
              
              {/* Action buttons positioned in top-right */}
              {!model.downloaded && !isDownloading && (
                <div className="model-actions">
                  <button 
                    className="model-btn model-btn-primary"
                    onClick={() => downloadModel(model)}
                  >
                    <Download size={12} />
                    <span>Download</span>
                  </button>
                </div>
              )}
              
              {isDownloading && (
                <div className="model-actions">
                  <div className="model-download-progress">
                    <div className="model-progress-bar">
                      <div 
                        className="model-progress-fill"
                        style={{ width: `${progress.progress}%` }}
                      />
                    </div>
                    <span className="model-progress-text">
                      {progress.downloadedMb.toFixed(1)} / {progress.totalMb.toFixed(1)} MB
                    </span>
                  </div>
                </div>
              )}
              
              {model.downloaded && !model.active && (
                <div className="model-actions">
                  <button 
                    className="model-btn model-btn-secondary"
                    onClick={() => setActiveModel(model.id)}
                  >
                    <CheckCircle size={12} />
                    <span>Use Model</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};