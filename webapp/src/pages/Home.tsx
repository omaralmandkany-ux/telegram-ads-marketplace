// Home Page - Premium Dashboard

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useTelegram } from '../contexts/TelegramContext';
import { api, Channel, Deal, AdRequest } from '../lib/api';
import ChannelCard from '../components/ChannelCard';
import DealCard from '../components/DealCard';
import Loading from '../components/Loading';
import Icon from '../components/Icon';

const APP_VERSION = 'v2.4.0';

function Home() {

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
                const adminRes = await api.get<{ isAdmin: boolean }>('/admin/check');
                if (adminRes.success && (adminRes.data as any)?.isAdmin) {
                    setIsAdmin(true);
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

            {/* Ad Banner */}
            <div className="section mt-md">
                <div
                    className="card"
                    style={{
                        background: 'linear-gradient(135deg, #1a1c2e 0%, #2d1b4e 50%, #1a1c2e 100%)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                        borderRadius: '16px',
                        padding: '24px',
                        cursor: 'pointer',
                        position: 'relative',
                        overflow: 'hidden',
                        textAlign: 'center',
                    }}
                    onClick={() => {
                        hapticFeedback('light');
                        navigate('/channels');
                    }}
                >
                    {/* Decorative glow */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        left: '-50%',
                        width: '200%',
                        height: '200%',
                        background: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)',
                        pointerEvents: 'none',
                    }} />

                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        marginBottom: '8px',
                        position: 'relative',
                    }}>
                        <Icon name="megaphone" size={28} color="#a78bfa" />
                        <span style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #a78bfa, #c084fc)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                        }}>
                            Put Your Ad Here
                        </span>
                    </div>
                    <p style={{
                        color: '#9ca3af',
                        fontSize: '13px',
                        margin: 0,
                        position: 'relative',
                    }}>
                        Reach thousands of subscribers through Telegram channels
                    </p>
                    <div style={{
                        marginTop: '14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 20px',
                        background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                        borderRadius: '20px',
                        color: 'white',
                        fontSize: '13px',
                        fontWeight: 600,
                        position: 'relative',
                    }}>
                        Browse Channels <Icon name="chevronRight" size={14} />
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="section">
                <div className="quick-actions">
                    <button
                        className="quick-action"
                        onClick={() => {
                            hapticFeedback('light');
                            navigate('/channels/new');
                        }}
                        style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#0d1117' }}
                    >
                        <span className="quick-action-icon" style={{ color: '#0d1117' }}><Icon name="plus" size={22} /></span>
                        <span className="quick-action-label" style={{ color: '#0d1117' }}>Add Channel</span>
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

            {/* My Channels */}
            <div className="section">
                <div className="section-header">
                    <h3 className="section-title">My Channels</h3>
                    {myChannels.length > 0 && (
                        <Link to="/my-channels" className="text-sm text-accent">View All</Link>
                    )}
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
