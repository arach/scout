import { AppContext } from '../types/transcript';
import './AppContextDisplay.css';

interface AppContextDisplayProps {
  appContext: AppContext | null;
  variant?: 'inline' | 'detailed';
}

export function AppContextDisplay({ appContext, variant = 'inline' }: AppContextDisplayProps) {
  if (!appContext) {
    return null;
  }

  if (variant === 'inline') {
    return (
      <span className="app-context-inline" title={`Bundle ID: ${appContext.bundle_id}`}>
        {appContext.name}
      </span>
    );
  }

  return (
    <div className="app-context-detailed">
      <div className="app-context-name">{appContext.name}</div>
      <div className="app-context-bundle-id">{appContext.bundle_id}</div>
    </div>
  );
}