import React from 'react';
import { 
  BarChart3, 
  Gauge, 
  Package, 
  CheckCircle, 
  Download,
  Brain,
  FileText,
  Zap,
  ExternalLink,
  X
} from 'lucide-react';
import './ModelCard.css';

export type ModelType = 'whisper' | 'llm';

export interface BaseModel {
  id: string;
  name: string;
  size_mb: number;
  description: string;
  downloaded: boolean;
  active: boolean;
  speed: string;
  coreml_downloaded?: boolean;
  coreml_url?: string;
}

export interface ModelCardProps<T extends BaseModel> {
  model: T;
  type: ModelType;
  isDownloading: boolean;
  downloadProgress?: {
    progress: number;
    downloadedMb: number;
    totalMb: number;
  };
  onDownload: (model: T) => void;
  onSelect: (modelId: string) => void;
  onCancelDownload?: (modelId: string) => void;
  renderSpecs?: (model: T) => React.ReactNode;
  isDownloadingCoreML?: boolean;
}

export function ModelCard<T extends BaseModel>({
  model,
  isDownloading,
  downloadProgress,
  onDownload,
  onSelect,
  onCancelDownload,
  renderSpecs,
  isDownloadingCoreML
}: ModelCardProps<T>) {
  const formatSize = (mb: number): string => {
    if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  const isClickableForDownload = !model.downloaded && !isDownloading;

  return (
    <div 
      className={`model-card ${model.active ? 'active' : ''} ${isClickableForDownload ? 'not-installed' : ''}`}
      onClick={isClickableForDownload ? () => onDownload(model) : undefined}
    >
      <div className="model-card-header">
        <h3 className="model-name">{model.name}</h3>
        <div className="model-status-pills">
          {model.downloaded && (
            <span className="model-status-pill installed">
              <CheckCircle size={10} />
              Installed
            </span>
          )}
          {model.downloaded && model.coreml_downloaded && (
            <span className="model-status-pill accelerated">
              <Zap size={10} />
              CoreML Accelerated
            </span>
          )}
          {isClickableForDownload && (
            <span className="model-status-pill download-hint">
              <Download size={10} />
              {model.size_mb >= 1000 ? `Download ${formatSize(model.size_mb)}` : 'Click to Install'}
            </span>
          )}
        </div>
      </div>
      
      {/* Model description */}
      <p className="model-description">{model.description}</p>
      
      {/* Model specifications */}
      <div className="model-details">
        <div className="model-stat">
          <Gauge size={12} className="stat-icon" />
          <span>Speed: {model.speed}</span>
        </div>
        <div className="model-stat">
          <Package size={12} className="stat-icon" />
          <span>Size: {formatSize(model.size_mb)}</span>
        </div>
        {renderSpecs && renderSpecs(model)}
      </div>
      
      {/* Hugging Face link - positioned consistently */}
      <a 
        href={`https://huggingface.co/ggerganov/whisper.cpp`}
        target="_blank"
        rel="noopener noreferrer"
        className="model-hf-link"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="model-hf-url">https://huggingface.co/ggerganov/whisper.cpp</span>
        <ExternalLink size={12} />
      </a>
      
      {/* Spacer to push buttons to bottom */}
      <div className="model-spacer" />
      
      {/* Action section - always render div to maintain consistent spacing */}
      <div className="model-actions">
        {(model.downloaded || isDownloading) && (
          <>
          {model.downloaded && !model.active && !isDownloading && (
            <button 
              className="model-btn model-btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(model.id);
              }}
            >
              <CheckCircle size={14} />
              <span>Use Model</span>
            </button>
          )}
          
          {model.downloaded && !model.coreml_downloaded && model.coreml_url && !isDownloading && (
          <button 
            className="model-btn model-btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(model);
            }}
          >
            <Zap size={14} />
            <span>Apply Acceleration</span>
          </button>
        )}
        
      
        {isDownloading && downloadProgress && (
          <div className="model-download-progress">
            <div className="model-progress-container">
              <div className="model-progress-bar">
                <div 
                  className="model-progress-fill"
                  style={{ width: `${downloadProgress.progress}%` }}
                />
              </div>
              {onCancelDownload && (
                <button 
                  className="model-btn-cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelDownload(model.id);
                  }}
                  title="Cancel download"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="model-progress-text">
              {isDownloadingCoreML ? 'Core ML: ' : ''}{formatSize(downloadProgress.downloadedMb)} / {formatSize(downloadProgress.totalMb)}
            </span>
          </div>
        )}
        </>
      )}
      </div>
    </div>
  );
}

// Specific render functions for different model types
export const renderWhisperSpecs = (model: any) => (
  <>
    <div className="model-stat">
      <BarChart3 size={12} className="stat-icon" />
      <span>Accuracy: {model.accuracy}</span>
    </div>
  </>
);

export const renderLLMSpecs = (model: any) => (
  <>
    <div className="model-stat">
      <Brain size={12} className="stat-icon" />
      <span>{model.parameters} params</span>
    </div>
    <div className="model-stat">
      <FileText size={12} className="stat-icon" />
      <span>Context: {model.context_length.toLocaleString()} tokens</span>
    </div>
  </>
);