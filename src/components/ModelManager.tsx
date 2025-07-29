import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { ModelCard, renderWhisperSpecs } from './shared/ModelCard';
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
      <div className="model-grid">
        {models.map(model => {
          const progress = downloading[model.id];
          const isDownloading = !!progress;
          
          // Determine quality label based on model
          let qualityLabel = undefined;
          
          if (!model.active) {
            if (model.id === 'tiny.en') {
              qualityLabel = { text: 'Included', className: 'included' };
            } else if (model.id === 'base.en') {
              qualityLabel = { text: 'Recommended', className: 'recommended' };
            }
          }
          
          return (
            <ModelCard
              key={model.id}
              model={model}
              type="whisper"
              isDownloading={isDownloading}
              downloadProgress={progress}
              qualityLabel={qualityLabel}
              onDownload={downloadModel}
              onSelect={setActiveModel}
              renderSpecs={renderWhisperSpecs}
            />
          );
        })}
      </div>
    </div>
  );
};