// Toast Notification Component - Replaces browser alerts

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Icon from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
    showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, message, type }]);

        // Auto-dismiss after 3 seconds
        setTimeout(() => removeToast(id), 3000);
    }, [removeToast]);

    const showSuccess = useCallback((message: string) => showToast(message, 'success'), [showToast]);
    const showError = useCallback((message: string) => showToast(message, 'error'), [showToast]);
    const showInfo = useCallback((message: string) => showToast(message, 'info'), [showToast]);

    const getIcon = (type: ToastType) => {
        switch (type) {
            case 'success': return <Icon name="check" size={16} />;
            case 'error': return <Icon name="close" size={16} />;
            case 'warning': return <Icon name="warning" size={16} />;
            case 'info': return <Icon name="info" size={16} />;
        }
    };

    return (
        <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo }}>
            {children}

            {/* Toast Container */}
            <div className="toast-container">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`toast toast-${toast.type}`}
                        onClick={() => removeToast(toast.id)}
                    >
                        <span className="toast-icon">{getIcon(toast.type)}</span>
                        <span className="toast-message">{toast.message}</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}
