import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Brain, RefreshCw, ChevronDown, ChevronUp, Clock, FileText, ListChecks, Type } from 'lucide-react';
import { LLMOutput } from '../types/llm';
import './TranscriptAIInsights.css';

interface TranscriptAIInsightsProps {
  transcriptId: number;
}

export const TranscriptAIInsights: React.FC<TranscriptAIInsightsProps> = ({ transcriptId }) => {
  const [llmOutputs, setLLMOutputs] = useState<LLMOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLLMOutputs();
  }, [transcriptId]);

  const loadLLMOutputs = async () => {
    try {
      setLoading(true);
      const outputs = await invoke<LLMOutput[]>('get_llm_outputs_for_transcript', { transcriptId });
      setLLMOutputs(outputs);
      
      // Auto-expand the first output
      if (outputs.length > 0) {
        setExpandedOutputs(new Set([outputs[0].prompt_id]));
      }
    } catch (error) {
      console.error('Failed to load LLM outputs:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (promptId: string) => {
    setExpandedOutputs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(promptId)) {
        newSet.delete(promptId);
      } else {
        newSet.add(promptId);
      }
      return newSet;
    });
  };

  const regenerateOutput = async (promptId: string) => {
    // TODO: Implement regeneration
    console.log('Regenerate output for prompt:', promptId);
  };

  const getPromptIcon = (promptId: string) => {
    switch (promptId) {
      case 'summarize':
        return <FileText size={16} />;
      case 'bullet_points':
        return <ListChecks size={16} />;
      case 'action_items':
        return <ListChecks size={16} />;
      case 'fix_grammar':
        return <Type size={16} />;
      default:
        return <Brain size={16} />;
    }
  };

  const formatProcessingTime = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="ai-insights-loading">
        <Brain size={20} className="ai-loading-icon" />
        <span>Loading AI insights...</span>
      </div>
    );
  }

  if (llmOutputs.length === 0) {
    return (
      <div className="ai-insights-empty">
        <Brain size={24} />
        <p>No AI insights available</p>
        <p className="ai-insights-hint">
          Enable AI post-processing in settings to generate insights
        </p>
      </div>
    );
  }

  return (
    <div className="ai-insights-container">
      {llmOutputs.map((output) => {
        const isExpanded = expandedOutputs.has(output.prompt_id);
        
        return (
          <div key={output.id} className="ai-insight-item">
            <button
              className="ai-insight-header"
              onClick={() => toggleExpanded(output.prompt_id)}
            >
              <div className="ai-insight-title">
                {getPromptIcon(output.prompt_id)}
                <span>{output.prompt_name}</span>
              </div>
              <div className="ai-insight-meta">
                <span className="ai-processing-time">
                  <Clock size={12} />
                  {formatProcessingTime(output.processing_time_ms)}
                </span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>
            
            {isExpanded && (
              <div className="ai-insight-content">
                <div className="ai-output-text">
                  {output.output_text.split('\n').map((line, index) => (
                    <p key={index}>{line || '\u00A0'}</p>
                  ))}
                </div>
                
                <div className="ai-insight-footer">
                  <div className="ai-model-info">
                    <span className="ai-model-name">{output.model_used}</span>
                    <span className="ai-model-params">
                      temp: {output.temperature} • {output.max_tokens} tokens
                    </span>
                  </div>
                  <button
                    className="ai-regenerate-button"
                    onClick={() => regenerateOutput(output.prompt_id)}
                    title="Regenerate this insight"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};