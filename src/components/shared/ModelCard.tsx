import React from 'react';
import { 
  BarChart3, 
  Gauge, 
  Package, 
  CheckCircle, 
  Download,
  Brain,
  FileText,
  Zap
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
  renderSpecs?: (model: T) => React.ReactNode;
  isDownloadingCoreML?: boolean;
}

export function ModelCard<T extends BaseModel>({
  model,
  isDownloading,
  downloadProgress,
  onDownload,
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
        <h3 className="model-name">
          <span>{model.name}</span>
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
                Click to Install
              </span>
            )}
          </div>
        </h3>
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
      
      {/* Spacer to push buttons to bottom */}
      <div className="model-spacer" />
      
      {/* Action section - only show when there are actions */}
      {(model.downloaded || isDownloading) && (
        <div className="model-actions">
          {model.downloaded && !model.coreml_downloaded && model.coreml_url && !isDownloading && (
          <button 
            className="model-btn model-btn-secondary"
            onClick={() => onDownload(model)}
          >
            <Zap size={14} />
            <span>Apply Acceleration</span>
          </button>
        )}
        
      
        {isDownloading && downloadProgress && (
          <div className="model-download-progress">
            <div className="model-progress-bar">
              <div 
                className="model-progress-fill"
                style={{ width: `${downloadProgress.progress}%` }}
              />
            </div>
            <span className="model-progress-text">
              {isDownloadingCoreML ? 'Core ML: ' : ''}{formatSize(downloadProgress.downloadedMb)} / {formatSize(downloadProgress.totalMb)}
            </span>
          </div>
        )}
        </div>
      )}
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