import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeEventListen } from '../lib/safeEventListener';
import { LLMModel, LLMDownloadProgress } from '../types/llm';
import { ModelCard, renderLLMSpecs } from './shared/ModelCard';
import './LLMModelManager.css';

export const LLMModelManager: React.FC = () => {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<{ [key: string]: LLMDownloadProgress }>({});
  // const [modelsDir, setModelsDir] = useState<string>(''); // Unused variable

  useEffect(() => {
    loadModels();
    // getModelsDir(); // Commented out since modelsDir is unused

    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    const setupListeners = async () => {
      // Listen for download progress events
      unlistenProgress = await safeEventListen<{
        model_id: string;
        progress: number;
        downloaded_bytes: number;
        total_bytes: number;
      }>('llm-download-progress', (event) => {
        const { model_id, progress, downloaded_bytes, total_bytes } = event.payload;
        setDownloading(prev => ({
          ...prev,
          [model_id]: {
            modelId: model_id,
            progress,
            downloadedMb: downloaded_bytes / (1024 * 1024),
            totalMb: total_bytes / (1024 * 1024)
          }
        }));
      });

      // Listen for download complete events
      unlistenComplete = await safeEventListen<{ model_id: string }>('llm-model-downloaded', (event) => {
        setDownloading(prev => {
          const updated = { ...prev };
          delete updated[event.payload.model_id];
          return updated;
        });
        loadModels(); // Reload to update downloaded status
      });
    };

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, []);


  const loadModels = async () => {
    try {
      const availableModels = await invoke<LLMModel[]>('get_available_llm_models');
      setModels(availableModels);
    } catch (error) {
      console.error('Failed to load LLM models:', error);
    } finally {
      setLoading(false);
    }
  };

  // Commented out since modelsDir is unused
  // const getModelsDir = async () => {
  //   try {
  //     const dir = await invoke<string>('get_models_dir');
  //     setModelsDir(dir);
  //   } catch (error) {
  //     console.error('Failed to get models directory:', error);
  //   }
  // };

  const downloadModel = async (modelId: string) => {
    try {
      setDownloading(prev => ({
        ...prev,
        [modelId]: {
          modelId,
          progress: 0,
          downloadedMb: 0,
          totalMb: 0
        }
      }));
      await invoke('download_llm_model', { modelId });
    } catch (error) {
      console.error('Failed to download model:', error);
      setDownloading(prev => {
        const updated = { ...prev };
        delete updated[modelId];
        return updated;
      });
    }
  };

  const selectModel = async (modelId: string) => {
    try {
      await invoke('set_active_llm_model', { modelId });
      await loadModels();
    } catch (error) {
      console.error('Failed to select model:', error);
    }
  };

  // Commented out unused function
  // const deleteModel = async (modelId: string) => {
  //   try {
  //     // For now, users can manually delete from the models folder
  //     // We could add a delete command later if needed
  //     console.log('Delete model:', modelId);
  //   } catch (error) {
  //     console.error('Failed to delete model:', error);
  //   }
  // };

  if (loading) {
    return <div className="llm-model-manager-loading">Loading models...</div>;
  }

  return (
    <div className="llm-model-manager">
      <div className="model-grid">
        {models.map((model) => {
          const isDownloading = downloading[model.id] !== undefined;
          const progress = downloading[model.id];

          return (
            <ModelCard
              key={model.id}
              model={model}
              type="llm"
              isDownloading={isDownloading}
              downloadProgress={progress}
              onDownload={(m) => downloadModel(m.id)}
              onSelect={selectModel}
              renderSpecs={renderLLMSpecs}
            />
          );
        })}
      </div>
      
      {models.length === 0 && (
        <div className="llm-no-models">
          <p>No LLM models available.</p>
          <p className="llm-models-hint">
            Models will appear here once the backend is configured.
          </p>
        </div>
      )}
    </div>
  );
};