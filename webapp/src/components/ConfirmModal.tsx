// Confirm Modal Component - Replaces browser confirm() dialogs

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'default' | 'danger' | 'success';
}

interface ConfirmContextType {
    showConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within a ConfirmProvider');
    }
    return context;
}

interface ConfirmState extends ConfirmOptions {
    isOpen: boolean;
    resolve: ((value: boolean) => void) | null;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ConfirmState>({
        isOpen: false,
        message: '',
        resolve: null,
    });

    const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setState({
                isOpen: true,
                ...options,
                resolve,
            });
        });
    }, []);

    const handleClose = (result: boolean) => {
        if (state.resolve) {
            state.resolve(result);
        }
        setState(prev => ({ ...prev, isOpen: false, resolve: null }));
    };

    const getTypeStyles = () => {
        switch (state.type) {
            case 'danger':
                return 'confirm-modal-danger';
            case 'success':
                return 'confirm-modal-success';
            default:
                return '';
        }
    };

    return (
        <ConfirmContext.Provider value={{ showConfirm }}>
            {children}

            {/* Confirm Modal Overlay */}
            {state.isOpen && (
                <div className="confirm-overlay" onClick={() => handleClose(false)}>
                    <div
                        className={`confirm-modal ${getTypeStyles()}`}
                        onClick={e => e.stopPropagation()}
                    >
                        {state.title && (
                            <h3 className="confirm-title">{state.title}</h3>
                        )}
                        <p className="confirm-message">{state.message}</p>
                        <div className="confirm-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => handleClose(false)}
                            >
                                {state.cancelText || 'Cancel'}
                            </button>
                            <button
                                className={`btn ${state.type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => handleClose(true)}
                            >
                                {state.confirmText || 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}
