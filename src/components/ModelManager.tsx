import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { ModelCard, renderWhisperSpecs } from './shared/ModelCard';
import './ModelManager.css';

// Braille spinner component
const BrailleSpinner: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
    }, 100);
    return () => clearInterval(interval);
  }, []);
  
  return <span className="braille-spinner">{frames[frame]}</span>;
};

interface WhisperModel {
  id: string;
  name: string;
  size_mb: number;
  description: string;
  url: string;
  filename: string;
  coreml_url?: string;
  coreml_filename?: string;
  speed: string;
  accuracy: string;
  downloaded: boolean;
  coreml_downloaded: boolean;
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
  const [checkingCoreML, setCheckingCoreML] = useState(false);

  useEffect(() => {
    loadModels();
    getModelsDir();
    checkForMissingCoreML();
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

    // Check if we're downloading just Core ML
    const isCoreMlOnly = model.downloaded && !model.coreml_downloaded && model.coreml_url;
    
    // Initialize progress with appropriate size
    const downloadSize = isCoreMlOnly ? Math.round(model.size_mb * 0.1) : model.size_mb; // Core ML is ~10% of model size
    setDownloading(prev => ({
      ...prev,
      [model.id]: { modelId: model.id, progress: 0, downloadedMb: 0, totalMb: downloadSize }
    }));

    try {
      // Set up progress listener
      const unlisten = await safeEventListen<{
        url: string;
        downloaded: number;
        total: number;
        progress: number;
      }>('download-progress', (event) => {
        // Handle both GGML and Core ML download progress
        if (event.payload.url === model.url || event.payload.url === model.coreml_url) {
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

      if (isCoreMlOnly) {
        // Download only Core ML for this specific model
        await invoke('download_coreml_for_model', { modelId: model.id });
      } else {
        // Download both GGML and Core ML
        await invoke('download_model', {
          modelName: model.id,
          modelUrl: model.url
        });
      }

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

  const cancelDownload = async (modelId: string) => {
    try {
      await invoke('cancel_model_download', { modelId });
      // Remove from downloading state
      setDownloading(prev => {
        const newState = { ...prev };
        delete newState[modelId];
        return newState;
      });
    } catch (error) {
      console.error('Failed to cancel download:', error);
    }
  };

  const checkForMissingCoreML = async () => {
    try {
      setCheckingCoreML(true);
      const missingModels = await invoke<string[]>('check_and_download_missing_coreml_models');
      
      if (missingModels.length > 0) {
        console.log(`Downloaded Core ML models for: ${missingModels.join(', ')}`);
        // Reload models to update Core ML status
        await loadModels();
      }
    } catch (error) {
      console.error('Failed to check for missing Core ML models:', error);
    } finally {
      setCheckingCoreML(false);
    }
  };

  if (loading) {
    return <div className="model-manager-loading">Loading models...</div>;
  }

  return (
    <div className="model-manager">
      {checkingCoreML && (
        <div className="model-manager-notice">
          <BrailleSpinner />
          <span>Checking for Core ML acceleration...</span>
        </div>
      )}
      <div className="model-grid">
        {models.map(model => {
          const progress = downloading[model.id];
          const isDownloading = !!progress;
          const isDownloadingCoreML = isDownloading && model.downloaded && !model.coreml_downloaded;
          
          return (
            <ModelCard
              key={model.id}
              model={model}
              type="whisper"
              isDownloading={isDownloading}
              downloadProgress={progress}
              onDownload={downloadModel}
              onSelect={setActiveModel}
              onCancelDownload={cancelDownload}
              renderSpecs={renderWhisperSpecs}
              isDownloadingCoreML={isDownloadingCoreML}
            />
          );
        })}
      </div>
    </div>
  );
};