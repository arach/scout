import { memo } from 'react';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import type { ViewType } from './types';

interface AppHeaderProps {
  currentView: ViewType;
  isSidebarExpanded: boolean;
  onToggleSidebar: () => void;
}

/**
 * Application header component that displays the current view title
 * and sidebar toggle controls.
 * 
 * @component
 * @example
 * ```tsx
 * <AppHeader 
 *   currentView="record"
 *   isSidebarExpanded={true}
 *   onToggleSidebar={() => setExpanded(!expanded)}
 * />
 * ```
 */
export const AppHeader = memo<AppHeaderProps>(({
  currentView,
  isSidebarExpanded,
  onToggleSidebar
}) => {
  const viewTitles: Record<ViewType, string> = {
    record: 'Recording',
    transcripts: 'Transcripts',
    settings: 'Settings',
    stats: 'Stats',
    dictionary: 'Dictionary',
    webhooks: 'Webhooks',
    'audio-testing': 'Audio Testing'
  };

  return (
    <div className="view-header">
      <div className="view-header-left">
        {!isSidebarExpanded ? (
          <button
            className="sidebar-toggle-button"
            onClick={onToggleSidebar}
            title="Show Sidebar"
            aria-label="Show Sidebar"
          >
            <ChevronRight size={16} />
          </button>
        ) : (
          <button
            className="sidebar-close-button"
            onClick={onToggleSidebar}
            title="Hide Sidebar"
            aria-label="Hide Sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>
      <div className="view-header-center">
        <h1 className="view-title">{viewTitles[currentView]}</h1>
      </div>
      <div className="view-header-right">
        {/* Reserved for future controls */}
      </div>
    </div>
  );
});

AppHeader.displayName = 'AppHeader';