import { ReactNode } from 'react';
import { RecordingProvider } from './RecordingContext';
import { AudioProvider } from './AudioContext';
import { TranscriptProvider } from './TranscriptContext';
import { UIProvider } from './UIContext';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Combined provider component that wraps the app with all necessary contexts
 * in the correct hierarchical order for optimal performance and data flow
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <AudioProvider>
      <TranscriptProvider>
        <UIProvider>
          <RecordingProvider>
            {children}
          </RecordingProvider>
        </UIProvider>
      </TranscriptProvider>
    </AudioProvider>
  );
}