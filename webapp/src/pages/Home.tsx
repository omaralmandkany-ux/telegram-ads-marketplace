// Home Page - Premium Dashboard

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTelegram } from '../contexts/TelegramContext';
import { api, Channel, Deal, AdRequest, formatNumber } from '../lib/api';
import ChannelCard from '../components/ChannelCard';
import DealCard from '../components/DealCard';
import Loading from '../components/Loading';
import Icon from '../components/Icon';

const APP_VERSION = 'v2.3.0';

function Home() {
    const { user } = useAuth();
    const { hapticFeedback } = useTelegram();
    const navigate = useNavigate();

    const [myChannels, setMyChannels] = useState<Channel[]>([]);
    const [activeDeals, setActiveDeals] = useState<Deal[]>([]);
    const [latestRequests, setLatestRequests] = useState<AdRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        setIsLoading(true);
        try {
            const [channelsRes, dealsRes, requestsRes] = await Promise.all([
                api.get<Channel[]>('/channels/mine'),
                api.get<Deal[]>('/deals?limit=3'),
                api.get<{ data: AdRequest[] }>('/requests?limit=3'),
            ]);

            if (channelsRes.success) setMyChannels((channelsRes.data as Channel[]) || []);
            if (dealsRes.success) setActiveDeals((dealsRes.data as Deal[]) || []);
            if (requestsRes.success) {
                const rawData = requestsRes.data as any;
                setLatestRequests(rawData?.data || rawData || []);
            }

            // Check admin status
            try {
                console.log('Checking admin status...');
                const adminRes = await api.get<{ isAdmin: boolean }>('/admin/check');
                console.log('Admin check response:', adminRes);
                if (adminRes.success && (adminRes.data as any)?.isAdmin) {
                    console.log('User IS admin!');
                    setIsAdmin(true);
                } else {
                    console.log('User is NOT admin - response:', adminRes);
                }
            } catch (adminError) {
                console.error('Admin check error:', adminError);
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return <Loading />;
    }

    return (
        <div className="container animate-fadeIn">

            {/* Hero Section */}
            <div className="section mt-md">
                <div className="card hero-card">
                    <div className="flex items-center gap-md mb-md">
                        <div className="channel-avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                            {user?.firstName?.charAt(0) || <Icon name="user" size={18} />}
                        </div>
                        <div>
                            <h3 className="text-lg">Welcome, {user?.firstName}!</h3>
                            <p className="text-sm text-primary" style={{ opacity: 0.9 }}>
                                Telegram Ads Marketplace
                            </p>
                        </div>
                    </div>

                    <div className="quick-actions mt-lg">
                        <button
                            className="quick-action"
                            onClick={() => {
                                hapticFeedback('light');
                                navigate('/channels');
                            }}
                        >
                            <span className="quick-action-icon"><Icon name="megaphone" size={22} /></span>
                            <span className="quick-action-label">Browse Channels</span>
                        </button>
                        <button
                            className="quick-action"
                            onClick={() => {
                                hapticFeedback('light');
                                navigate('/requests');
                            }}
                        >
                            <span className="quick-action-icon"><Icon name="requests" size={22} /></span>
                            <span className="quick-action-label">Ad Requests</span>
                        </button>
                        {isAdmin && (
                            <button
                                className="quick-action"
                                onClick={() => {
                                    hapticFeedback('light');
                                    navigate('/admin');
                                }}
                                style={{ background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)' }}
                            >
                                <span className="quick-action-icon"><Icon name="admin" size={22} /></span>
                                <span className="quick-action-label">Admin Panel</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="section">
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-value">{myChannels.length}</div>
                        <div className="stat-label">My Channels</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{activeDeals.length}</div>
                        <div className="stat-label">Active Deals</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">
                            {myChannels.reduce((sum, ch) => sum + ch.stats.subscribers, 0) > 0
                                ? formatNumber(myChannels.reduce((sum, ch) => sum + ch.stats.subscribers, 0))
                                : '0'}
                        </div>
                        <div className="stat-label">Total Reach</div>
                    </div>
                </div>
            </div>

            {/* My Channels */}
            <div className="section">
                <div className="section-header">
                    <h3 className="section-title">My Channels</h3>
                    <Link to="/my-channels" className="text-sm text-accent">View All</Link>
                </div>

                {myChannels.length === 0 ? (
                    <div className="card text-center">
                        <div className="empty-state-icon"><Icon name="megaphone" size={48} color="var(--text-muted)" /></div>
                        <p className="text-secondary mb-md">You haven't registered any channels yet</p>
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                hapticFeedback('light');
                                navigate('/channels/new');
                            }}
                        >
                            <Icon name="plus" size={18} /> Register Your Channel
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-sm">
                        {myChannels.slice(0, 2).map(channel => (
                            <ChannelCard key={channel.id} channel={channel} showPrice={false} />
                        ))}
                    </div>
                )}
            </div>

            {/* Active Deals */}
            {activeDeals.length > 0 && (
                <div className="section">
                    <div className="section-header">
                        <h3 className="section-title">Active Deals</h3>
                        <Link to="/deals" className="text-sm text-accent">View All</Link>
                    </div>
                    <div className="flex flex-col gap-sm">
                        {activeDeals.map(deal => (
                            <DealCard key={deal.id} deal={deal} />
                        ))}
                    </div>
                </div>
            )}

            {/* Latest Requests */}
            {latestRequests.length > 0 && (
                <div className="section">
                    <div className="section-header">
                        <h3 className="section-title">Ad Requests</h3>
                        <Link to="/requests" className="text-sm text-accent">View All</Link>
                    </div>
                    <div className="flex flex-col gap-sm">
                        {latestRequests.slice(0, 2).map(request => (
                            <Link key={request.id} to={`/requests/${request.id}`} className="card card-clickable">
                                <div className="flex justify-between items-start mb-sm">
                                    <div className="font-semibold">{request.title}</div>
                                    <span className="badge badge-info">{request.preferredFormat}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="price-tag">
                                        {request.budget.min === request.budget.max
                                            ? `${request.budget.min} TON`
                                            : `${request.budget.min}-${request.budget.max} TON`}
                                    </span>
                                    <span className="text-xs text-muted">
                                        {request.applicants.length} applicant{request.applicants.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Version */}
            <div className="section text-center">
                <span className="text-xs text-muted">{APP_VERSION}</span>
            </div>
        </div>
    );
}

export default Home;
