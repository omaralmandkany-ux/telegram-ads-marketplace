// Telegram WebApp Context - provides access to Telegram Mini App SDK

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

interface TelegramWebApp {
    ready: () => void;
    close: () => void;
    expand: () => void;
    MainButton: {
        text: string;
        color: string;
        textColor: string;
        isVisible: boolean;
        isActive: boolean;
        show: () => void;
        hide: () => void;
        enable: () => void;
        disable: () => void;
        setText: (text: string) => void;
        onClick: (callback: () => void) => void;
        offClick: (callback: () => void) => void;
        showProgress: (leaveActive?: boolean) => void;
        hideProgress: () => void;
    };
    BackButton: {
        isVisible: boolean;
        show: () => void;
        hide: () => void;
        onClick: (callback: () => void) => void;
        offClick: (callback: () => void) => void;
    };
    HapticFeedback: {
        impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        selectionChanged: () => void;
    };
    themeParams: {
        bg_color?: string;
        text_color?: string;
        hint_color?: string;
        link_color?: string;
        button_color?: string;
        button_text_color?: string;
        secondary_bg_color?: string;
    };
    colorScheme: 'light' | 'dark';
    initData: string;
    initDataUnsafe: {
        query_id?: string;
        user?: TelegramUser;
        auth_date: number;
        hash: string;
    };
    isExpanded: boolean;
    viewportHeight: number;
    viewportStableHeight: number;
    platform: string;
    showAlert: (message: string, callback?: () => void) => void;
    showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
    showPopup: (params: {
        title?: string;
        message: string;
        buttons?: Array<{
            id?: string;
            type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
            text?: string;
        }>;
    }, callback?: (buttonId: string) => void) => void;
    openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
    openTelegramLink: (url: string) => void;
    setHeaderColor: (color: string) => void;
    setBackgroundColor: (color: string) => void;
}

declare global {
    interface Window {
        Telegram?: {
            WebApp: TelegramWebApp;
        };
    }
}

interface TelegramContextType {
    webApp: TelegramWebApp | null;
    user: TelegramUser | null;
    initData: string;
    isReady: boolean;
    colorScheme: 'light' | 'dark';
    showMainButton: (text: string, onClick: () => void) => void;
    hideMainButton: () => void;
    showBackButton: (onClick: () => void) => void;
    hideBackButton: () => void;
    hapticFeedback: (type: 'success' | 'error' | 'warning' | 'light' | 'medium' | 'heavy') => void;
    showAlert: (message: string) => Promise<void>;
    showConfirm: (message: string) => Promise<boolean>;
}

const TelegramContext = createContext<TelegramContextType | null>(null);

export function TelegramProvider({ children }: { children: ReactNode }) {
    const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
    const [user, setUser] = useState<TelegramUser | null>(null);
    const [initData, setInitData] = useState<string>('');
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const tg = window.Telegram?.WebApp;

        if (tg) {
            tg.ready();
            tg.expand();

            // Apply theme
            document.body.classList.add('tg-theme');
            if (tg.themeParams.bg_color) {
                document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color);
            }
            if (tg.themeParams.text_color) {
                document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color);
            }
            if (tg.themeParams.hint_color) {
                document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color);
            }
            if (tg.themeParams.button_color) {
                document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color);
            }
            if (tg.themeParams.secondary_bg_color) {
                document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color);
            }

            // Set header color
            tg.setHeaderColor('#1a1a2e');
            tg.setBackgroundColor('#1a1a2e');

            setWebApp(tg);
            setUser(tg.initDataUnsafe.user || null);
            setInitData(tg.initData);
            setIsReady(true);
        } else {
            // Development mode - create mock data
            console.warn('Telegram WebApp not available, using mock data');
            setUser({
                id: 123456789,
                first_name: 'Test',
                last_name: 'User',
                username: 'testuser',
            });
            setIsReady(true);
        }
    }, []);

    const showMainButton = (text: string, onClick: () => void) => {
        if (webApp?.MainButton) {
            webApp.MainButton.setText(text);
            webApp.MainButton.onClick(onClick);
            webApp.MainButton.show();
        }
    };

    const hideMainButton = () => {
        if (webApp?.MainButton) {
            webApp.MainButton.hide();
        }
    };

    const showBackButton = (onClick: () => void) => {
        if (webApp?.BackButton) {
            webApp.BackButton.onClick(onClick);
            webApp.BackButton.show();
        }
    };

    const hideBackButton = () => {
        if (webApp?.BackButton) {
            webApp.BackButton.hide();
        }
    };

    const hapticFeedback = (type: 'success' | 'error' | 'warning' | 'light' | 'medium' | 'heavy') => {
        if (webApp?.HapticFeedback) {
            if (['success', 'error', 'warning'].includes(type)) {
                webApp.HapticFeedback.notificationOccurred(type as 'success' | 'error' | 'warning');
            } else {
                webApp.HapticFeedback.impactOccurred(type as 'light' | 'medium' | 'heavy');
            }
        }
    };

    const showAlert = (message: string): Promise<void> => {
        return new Promise((resolve) => {
            // Telegram limits popup message to 256 characters
            const truncatedMessage = message.length > 250
                ? message.substring(0, 247) + '...'
                : message;

            if (webApp) {
                webApp.showAlert(truncatedMessage, resolve);
            } else {
                alert(truncatedMessage);
                resolve();
            }
        });
    };

    const showConfirm = (message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            // Telegram limits popup message to 256 characters
            const truncatedMessage = message.length > 250
                ? message.substring(0, 247) + '...'
                : message;

            if (webApp) {
                webApp.showConfirm(truncatedMessage, resolve);
            } else {
                resolve(confirm(truncatedMessage));
            }
        });
    };

    const value: TelegramContextType = {
        webApp,
        user,
        initData,
        isReady,
        colorScheme: webApp?.colorScheme || 'dark',
        showMainButton,
        hideMainButton,
        showBackButton,
        hideBackButton,
        hapticFeedback,
        showAlert,
        showConfirm,
    };

    return (
        <TelegramContext.Provider value={value}>
            {children}
        </TelegramContext.Provider>
    );
}

export function useTelegram() {
    const context = useContext(TelegramContext);
    if (!context) {
        throw new Error('useTelegram must be used within a TelegramProvider');
    }
    return context;
}
