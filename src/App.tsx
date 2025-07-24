import { AppProviders } from './contexts/AppProviders';
import { AppContent } from './components/AppContent';
import "./App.css";

/**
 * Main App component - now a lightweight wrapper that provides context providers
 * and renders the main application content. This reduces the component from 912 lines
 * to under 20 lines by extracting state management to context providers.
 */
function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

export default App;