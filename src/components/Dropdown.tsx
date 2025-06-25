import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './Dropdown.css';

interface DropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: string[];
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

    const handleSelect = (option: string) => {
        onChange(option);
        setIsOpen(false);
    };

    const displayValue = value || placeholder;

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
                    {options.map((option) => (
                        option === '---' ? (
                            <div key={option} className="dropdown-separator" />
                        ) : (
                            <button
                                key={option}
                                className={`dropdown-option ${value === option ? 'selected' : ''}`}
                                onClick={() => handleSelect(option)}
                                type="button"
                            >
                                <span className="dropdown-option-text">{option}</span>
                                {value === option && (
                                    <Check size={16} className="dropdown-check" />
                                )}
                            </button>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}