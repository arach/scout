import React from 'react';
import { 
  BarChart3, 
  Gauge, 
  Package, 
  CheckCircle, 
  Download,
  Brain,
  FileText
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
  qualityLabel?: {
    text: string;
    className: string;
  };
  onDownload: (model: T) => void;
  onSelect: (modelId: string) => void;
  renderSpecs?: (model: T) => React.ReactNode;
}

export function ModelCard<T extends BaseModel>({
  model,
  isDownloading,
  downloadProgress,
  qualityLabel,
  onDownload,
  onSelect,
  renderSpecs
}: ModelCardProps<T>) {
  const formatSize = (mb: number): string => {
    if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  return (
    <div className={`model-card ${model.active ? 'active' : ''}`}>
      <div className="model-card-header">
        <h3 className="model-name">{model.name}</h3>
      </div>
      
      {/* Status badges */}
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
          <span className={`model-badge ${qualityLabel.className}`}>
            {qualityLabel.text}
          </span>
        </div>
      )}
      
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
      
      {/* Action buttons */}
      {!model.downloaded && !isDownloading && (
        <div className="model-actions">
          <button 
            className="model-btn model-btn-primary"
            onClick={() => onDownload(model)}
          >
            <Download size={12} />
            <span>Download</span>
          </button>
        </div>
      )}
      
      {isDownloading && downloadProgress && (
        <div className="model-actions">
          <div className="model-download-progress">
            <div className="model-progress-bar">
              <div 
                className="model-progress-fill"
                style={{ width: `${downloadProgress.progress}%` }}
              />
            </div>
            <span className="model-progress-text">
              {formatSize(downloadProgress.downloadedMb)} / {formatSize(downloadProgress.totalMb)}
            </span>
          </div>
        </div>
      )}
      
      {model.downloaded && !model.active && (
        <div className="model-actions">
          <button 
            className="model-btn model-btn-secondary"
            onClick={() => onSelect(model.id)}
          >
            <CheckCircle size={12} />
            <span>Use Model</span>
          </button>
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
      <span>{model.parameters}</span>
    </div>
    <div className="model-stat">
      <FileText size={12} className="stat-icon" />
      <span>Context: {model.context_length.toLocaleString()} tokens</span>
    </div>
  </>
);