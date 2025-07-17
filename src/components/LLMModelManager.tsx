import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Brain, Gauge, Package, CheckCircle, Download } from 'lucide-react';
import { LLMModel, LLMDownloadProgress } from '../types/llm';
import './LLMModelManager.css';

export const LLMModelManager: React.FC = () => {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<{ [key: string]: LLMDownloadProgress }>({});
  // const [modelsDir, setModelsDir] = useState<string>(''); // Unused variable

  useEffect(() => {
    loadModels();
    // getModelsDir(); // Commented out since modelsDir is unused

    // Listen for download progress events
    const unlistenProgress = listen<{
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
    const unlistenComplete = listen<{ model_id: string }>('llm-model-downloaded', (event) => {
      setDownloading(prev => {
        const updated = { ...prev };
        delete updated[event.payload.model_id];
        return updated;
      });
      loadModels(); // Reload to update downloaded status
    });

    return () => {
      unlistenProgress.then(fn => fn());
      unlistenComplete.then(fn => fn());
    };
  }, []);

  const formatSize = (mb: number): string => {
    if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  const formatParameters = (params: string): string => {
    return params;
  };

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
      <div className="llm-models-grid">
        {models.map((model) => {
          const isDownloading = downloading[model.id] !== undefined;
          const progress = downloading[model.id];

          return (
            <div key={model.id} className={`llm-model-card ${model.active ? 'active' : ''}`}>
              <div className="llm-model-header">
                <h4>{model.name}</h4>
                {model.active && (
                  <span className="active-indicator">
                    <CheckCircle size={12} />
                    Active
                  </span>
                )}
              </div>
              
              <p className="llm-model-description">{model.description}</p>
              
              <div className="llm-model-specs">
                <div className="llm-spec">
                  <Brain size={14} />
                  <span>{formatParameters(model.parameters)}</span>
                </div>
                <div className="llm-spec">
                  <Package size={14} />
                  <span>{formatSize(model.size_mb)}</span>
                </div>
                <div className="llm-spec">
                  <Gauge size={14} />
                  <span>{model.speed}</span>
                </div>
              </div>

              {isDownloading ? (
                <div className="llm-download-progress">
                  <div className="llm-progress-bar">
                    <div 
                      className="llm-progress-fill" 
                      style={{ width: `${progress?.progress || 0}%` }}
                    />
                  </div>
                  <span className="llm-progress-text">
                    {progress ? `${formatSize(progress.downloadedMb)} / ${formatSize(progress.totalMb)}` : 'Starting...'}
                  </span>
                </div>
              ) : model.downloaded ? (
                <div className="llm-model-actions">
                  {model.active ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Already Active</span>
                  ) : (
                    <button 
                      className="llm-select-button"
                      onClick={() => selectModel(model.id)}
                    >
                      <CheckCircle size={14} />
                      Use Model
                    </button>
                  )}
                </div>
              ) : (
                <div className="llm-model-actions">
                  <button 
                    className="llm-download-button"
                    onClick={() => downloadModel(model.id)}
                  >
                    <Download size={14} />
                    Download
                  </button>
                </div>
              )}
            </div>
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