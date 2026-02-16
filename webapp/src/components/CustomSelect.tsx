// Custom Select Dropdown Component - Professional styled dropdown

import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

interface SelectOption {
    value: string;
    label: string;
    icon?: string; // Icon name (e.g., 'timer', 'megaphone') instead of emoji
}

interface CustomSelectProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

function CustomSelect({ options, value, onChange, placeholder = 'Select...', className = '' }: CustomSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const selectedOption = options.find(opt => opt.value === value);

    return (
        <div className={`custom-select ${isOpen ? 'open' : ''} ${className}`} ref={selectRef}>
            <div
                className="custom-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="custom-select-value">
                    {selectedOption ? (
                        <>
                            {selectedOption.icon && <span className="custom-select-icon"><Icon name={selectedOption.icon} size={16} /></span>}
                            {selectedOption.label}
                        </>
                    ) : (
                        <span className="custom-select-placeholder">{placeholder}</span>
                    )}
                </span>
                <span className={`custom-select-arrow ${isOpen ? 'open' : ''}`}>
                    <Icon name="chevronDown" size={16} />
                </span>
            </div>

            {isOpen && (
                <div className="custom-select-dropdown">
                    {options.map((option) => (
                        <div
                            key={option.value}
                            className={`custom-select-option ${option.value === value ? 'selected' : ''}`}
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                        >
                            {option.icon && <span className="custom-select-icon"><Icon name={option.icon} size={16} /></span>}
                            <span>{option.label}</span>
                            {option.value === value && <span className="custom-select-check"><Icon name="check" size={14} /></span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default CustomSelect;
