// Page Header Component

import { useNavigate } from 'react-router-dom';
import { useEffect, ReactNode } from 'react';
import { useTelegram } from '../contexts/TelegramContext';
import Icon from './Icon';

interface HeaderProps {
    title: string;
    showBack?: boolean;
    backTo?: string;
    action?: {
        label: string | ReactNode;
        onClick: () => void;
    };
}

function Header({ title, showBack = false, backTo, action }: HeaderProps) {
    const navigate = useNavigate();
    const { showBackButton, hideBackButton } = useTelegram();

    useEffect(() => {
        if (showBack) {
            showBackButton(() => {
                if (backTo) {
                    navigate(backTo);
                } else {
                    navigate(-1);
                }
            });
        }

        return () => {
            hideBackButton();
        };
    }, [showBack, backTo]);

    const handleBack = () => {
        if (backTo) {
            navigate(backTo);
        } else {
            navigate(-1);
        }
    };

    return (
        <header className="header">
            {showBack && (
                <button className="header-back" onClick={handleBack}>
                    <Icon name="arrowLeft" size={20} />
                </button>
            )}
            <h1 className="header-title">{title}</h1>
            {action && (
                <button className="btn btn-sm btn-secondary" onClick={action.onClick}>
                    {action.label}
                </button>
            )}
            {!action && showBack && <div style={{ width: 40 }} />}
        </header>
    );
}

export default Header;
