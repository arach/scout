import { memo, useId } from 'react';

interface AccessibleRangeProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  hint?: string;
  formatValue?: (value: number) => string;
  ariaValueText?: (value: number) => string;
}

export const AccessibleRange = memo(function AccessibleRange({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled = false,
  hint,
  formatValue = (v) => v.toString(),
  ariaValueText
}: AccessibleRangeProps) {
  const id = useId();
  const hintId = useId();
  
  return (
    <div className="setting-item">
      <label htmlFor={id}>{label}</label>
      <div className="range-input-container">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={ariaValueText ? ariaValueText(value) : formatValue(value)}
        />
        <span className="range-value-display" aria-hidden="true">
          {formatValue(value)}
        </span>
      </div>
      {hint && (
        <p id={hintId} className="setting-hint">
          {hint}
        </p>
      )}
    </div>
  );
});