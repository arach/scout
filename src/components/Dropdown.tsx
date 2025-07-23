import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './Dropdown.css';

type DropdownOption = string | { value: string; label: string };

interface DropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: DropdownOption[];
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
}

export function Dropdown({ 
    value, 
    onChange, 
    options, 
    disabled = false,
    placeholder = "Select an option",
    className,
    style
}: DropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
    };

    const getOptionValue = (option: DropdownOption): string => {
        return typeof option === 'string' ? option : option.value;
    };

    const getOptionLabel = (option: DropdownOption): string => {
        return typeof option === 'string' ? option : option.label;
    };

    const findSelectedLabel = (): string => {
        const selectedOption = options.find(opt => getOptionValue(opt) === value);
        return selectedOption ? getOptionLabel(selectedOption) : placeholder;
    };

    const displayValue = value ? findSelectedLabel() : placeholder;

    return (
        <div className={`dropdown-container ${className || ''}`} ref={dropdownRef} style={style}>
            <button
                className={`dropdown-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                type="button"
            >
                <span className="dropdown-value">{displayValue}</span>
                <ChevronDown 
                    size={16} 
                    className={`dropdown-chevron ${isOpen ? 'open' : ''}`}
                />
            </button>
            
            {isOpen && !disabled && (
                <div className="dropdown-menu">
                    {options.map((option, index) => {
                        const optionValue = getOptionValue(option);
                        const optionLabel = getOptionLabel(option);
                        
                        return optionLabel === '---' ? (
                            <div key={`separator-${index}`} className="dropdown-separator" />
                        ) : (
                            <button
                                key={optionValue}
                                className={`dropdown-option ${value === optionValue ? 'selected' : ''}`}
                                onClick={() => handleSelect(optionValue)}
                                type="button"
                            >
                                <span className="dropdown-option-text">{optionLabel}</span>
                                {value === optionValue && (
                                    <Check size={16} className="dropdown-check" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}