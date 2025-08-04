import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const updateMenuPosition = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setMenuPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width
            });
        }
    };

    const handleToggle = () => {
        if (!disabled) {
            if (!isOpen) {
                updateMenuPosition();
            }
            setIsOpen(!isOpen);
        }
    };

    const handleSelect = (optionValue: string, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
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
        <>
            <div className={`dropdown-container ${className || ''}`} style={style}>
                <button
                    ref={triggerRef}
                    className={`dropdown-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
                    onClick={handleToggle}
                    disabled={disabled}
                    type="button"
                >
                    <span className="dropdown-value">{displayValue}</span>
                    <ChevronDown 
                        size={16} 
                        className={`dropdown-chevron ${isOpen ? 'open' : ''}`}
                    />
                </button>
            </div>
            
            {isOpen && !disabled && createPortal(
            <>
                <div className="dropdown-backdrop" />
                <div 
                    ref={dropdownRef}
                    className="dropdown-menu dropdown-menu-portal"
                    style={{
                        position: 'fixed',
                        top: menuPosition.top,
                        left: menuPosition.left,
                        width: menuPosition.width,
                        zIndex: 10000
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                >
                {options.map((option, index) => {
                    const optionValue = getOptionValue(option);
                    const optionLabel = getOptionLabel(option);
                    
                    return optionLabel === '---' ? (
                        <div key={`separator-${index}`} className="dropdown-separator" />
                    ) : (
                        <button
                            key={optionValue}
                            className={`dropdown-option ${value === optionValue ? 'selected' : ''}`}
                            onClick={(e) => handleSelect(optionValue, e)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
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
            </>,
            document.body
        )}
        </>
    );
}