// Empty State Component - Supports icon names or ReactNode icons

import { ReactNode } from 'react';
import Icon from './Icon';

interface EmptyStateProps {
    icon: string | ReactNode; // Icon name OR ReactNode (for backward compatibility)
    title: string;
    message: string;
    action?: {
        label: string | ReactNode;
        onClick: () => void;
    };
}

function EmptyState({ icon, title, message, action }: EmptyStateProps) {
    return (
        <div className="empty-state">
            <div className="empty-state-icon">
                {typeof icon === 'string' ? <Icon name={icon} size={48} /> : icon}
            </div>
            <h3 className="empty-state-title">{title}</h3>
            <p className="empty-state-text">{message}</p>
            {action && (
                <button className="btn btn-primary" onClick={action.onClick}>
                    {action.label}
                </button>
            )}
        </div>
    );
}

export default EmptyState;
