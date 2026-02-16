// Layout Component with Top Bar and Bottom Navigation

import { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon';
import TopBar from './TopBar';

interface LayoutProps {
    children: ReactNode;
}

function Layout({ children }: LayoutProps) {
    const location = useLocation();

    // Hide bottom nav on detail pages
    const hideNav = ['/channels/', '/requests/', '/deals/'].some(path =>
        location.pathname.includes(path) && location.pathname !== '/channels' &&
        location.pathname !== '/requests' && location.pathname !== '/deals'
    );

    return (
        <div className="app">
            {/* Top Bar - Always visible */}
            <TopBar />

            <main className="page">
                {children}
            </main>

            {!hideNav && (
                <nav className="bottom-nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon"><Icon name="home" size={22} /></span>
                        <span className="nav-label">Home</span>
                    </NavLink>

                    <NavLink to="/channels" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon"><Icon name="megaphone" size={22} /></span>
                        <span className="nav-label">Channels</span>
                    </NavLink>

                    <NavLink to="/requests" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon"><Icon name="requests" size={22} /></span>
                        <span className="nav-label">Requests</span>
                    </NavLink>

                    <NavLink to="/deals" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon"><Icon name="deals" size={22} /></span>
                        <span className="nav-label">Deals</span>
                    </NavLink>

                    <NavLink to="/wallet" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon"><Icon name="wallet" size={22} /></span>
                        <span className="nav-label">Wallet</span>
                    </NavLink>
                </nav>
            )}
        </div>
    );
}

export default Layout;
