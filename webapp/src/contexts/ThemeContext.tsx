// Theme Context - handles dark/light mode and language preferences

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';
type Language = 'en' | 'ar';

interface ThemeContextType {
    theme: Theme;
    language: Language;
    toggleTheme: () => void;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
    en: {
        // Navigation
        home: 'Home',
        channels: 'Channels',
        requests: 'Requests',
        deals: 'Deals',
        wallet: 'Wallet',
        settings: 'Settings',

        // Common
        balance: 'Balance',
        browse_channels: 'Browse Channels',
        ad_requests: 'Ad Requests',
        admin_panel: 'Admin Panel',
        my_channels: 'My Channels',
        active_deals: 'Active Deals',
        total_reach: 'Total Reach',

        // Settings
        dark_mode: 'Dark Mode',
        language: 'Language',
        english: 'English',
        arabic: 'العربية',

        // Actions
        save: 'Save',
        cancel: 'Cancel',
        confirm: 'Confirm',
        close: 'Close',
    },
    ar: {
        // Navigation
        home: 'الرئيسية',
        channels: 'القنوات',
        requests: 'الطلبات',
        deals: 'الصفقات',
        wallet: 'المحفظة',
        settings: 'الإعدادات',

        // Common
        balance: 'الرصيد',
        browse_channels: 'تصفح القنوات',
        ad_requests: 'طلبات الإعلانات',
        admin_panel: 'لوحة الإدارة',
        my_channels: 'قنواتي',
        active_deals: 'الصفقات النشطة',
        total_reach: 'إجمالي الوصول',

        // Settings
        dark_mode: 'الوضع الداكن',
        language: 'اللغة',
        english: 'English',
        arabic: 'العربية',

        // Actions
        save: 'حفظ',
        cancel: 'إلغاء',
        confirm: 'تأكيد',
        close: 'إغلاق',
    },
};

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('theme') as Theme;
        return saved || 'dark';
    });

    const [language, setLanguageState] = useState<Language>(() => {
        const saved = localStorage.getItem('language') as Language;
        return saved || 'en';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', language);
        localStorage.setItem('language', language);
    }, [language]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    const setLanguage = (lang: Language) => {
        setLanguageState(lang);
    };

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return (
        <ThemeContext.Provider value={{ theme, language, toggleTheme, setLanguage, t }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
