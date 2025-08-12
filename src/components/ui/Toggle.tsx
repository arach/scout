import React from 'react';
import './Toggle.css';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  size?: 'small' | 'medium' | 'large';
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  size = 'medium'
}) => {
  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const toggleElement = (
    <button
      className={`toggle toggle-${size} ${checked ? 'toggle-checked' : ''} ${disabled ? 'toggle-disabled' : ''}`}
      onClick={handleToggle}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span className="toggle-slider" />
    </button>
  );

  if (label || description) {
    return (
      <div className="toggle-wrapper">
        <div className="toggle-content">
          {label && <label className="toggle-label">{label}</label>}
          {description && <p className="toggle-description">{description}</p>}
        </div>
        {toggleElement}
      </div>
    );
  }

  return toggleElement;
};