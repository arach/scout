import { memo } from 'react';
import { useEnhancedSettings } from '../../hooks/useEnhancedSettings';
import { Dropdown } from '../Dropdown';
import { 
  ArrowUpLeft, ArrowUp, ArrowUpRight, 
  ArrowLeft, ArrowRight, 
  ArrowDownLeft, ArrowDown, ArrowDownRight 
} from 'lucide-react';
import './DisplayInterfaceSettings.css';

export const DisplayInterfaceSettings = memo(function DisplayInterfaceSettings() {
  const { state, actions } = useEnhancedSettings();
  const { ui } = state;

  return (
    <div className="display-interface-settings">
      <div className="settings-two-column">
        <div className="setting-item">
          <label>Recording Indicator Position</label>
          <div className="overlay-position-grid">
            <button
              className={`position-button ${ui.overlayPosition === 'top-left' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('top-left')}
              title="Top Left"
            >
              <ArrowUpLeft size={18} />
            </button>
            <button
              className={`position-button ${ui.overlayPosition === 'top-center' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('top-center')}
              title="Top Center"
            >
              <ArrowUp size={18} />
            </button>
            <button
              className={`position-button ${ui.overlayPosition === 'top-right' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('top-right')}
              title="Top Right"
            >
              <ArrowUpRight size={18} />
            </button>

            <button
              className={`position-button ${ui.overlayPosition === 'left-center' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('left-center')}
              title="Left Center"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="position-button-spacer"></div>
            <button
              className={`position-button ${ui.overlayPosition === 'right-center' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('right-center')}
              title="Right Center"
            >
              <ArrowRight size={18} />
            </button>

            <button
              className={`position-button ${ui.overlayPosition === 'bottom-left' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('bottom-left')}
              title="Bottom Left"
            >
              <ArrowDownLeft size={18} />
            </button>
            <button
              className={`position-button ${ui.overlayPosition === 'bottom-center' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('bottom-center')}
              title="Bottom Center"
            >
              <ArrowDown size={18} />
            </button>
            <button
              className={`position-button ${ui.overlayPosition === 'bottom-right' ? 'active' : ''}`}
              onClick={() => actions.updateOverlayPosition('bottom-right')}
              title="Bottom Right"
            >
              <ArrowDownRight size={18} />
            </button>
          </div>
        </div>
        
        <div className="setting-item">
          <label>Recording Indicator Style</label>
          <Dropdown
            value={ui.overlayTreatment}
            onChange={(value) => actions.updateOverlayTreatment(value as any)}
            options={[
              { value: 'particles', label: 'Particles' },
              { value: 'pulsingDot', label: 'Pulsing Dot' },
              { value: 'animatedWaveform', label: 'Waveform' },
              { value: 'gradientOrb', label: 'Gradient Orb' },
              { value: 'floatingBubbles', label: 'Floating Bubbles' }
            ]}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
});