import { AppProviders } from './contexts/AppProviders';
import { AppContent } from './components/AppContent';
import { ErrorBoundary } from './components/ErrorBoundary';
import "./App.css";

/**
 * Main App component - now a lightweight wrapper that provides context providers
 * and renders the main application content. This reduces the component from 912 lines
 * to under 20 lines by extracting state management to context providers.
 */
function App() {
  return (
    <ErrorBoundary 
      name="App"
      onError={(error, errorInfo) => {
        // Could send to error tracking service here
        console.error('App-level error:', error, errorInfo);
      }}
    >
      <AppProviders>
        <AppContent />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;