// Channel Detail Page - Matching Reference Design with Real Data
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { useAuth } from '../contexts/AuthContext';
import { api, Channel, formatNumber } from '../lib/api';
import Header from '../components/Header';
import Loading from '../components/Loading';
import Icon from '../components/Icon';
import ChannelAdmins from '../components/ChannelAdmins';
import { useConfirm } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import './ChannelDetail.css';

type FormatType = 'post' | 'permanent' | 'story';

interface FormatOption {
    id: FormatType;
    name: string;
    description: string;
    price: number;
    usdPrice: number;
    icon: string;
}

function ChannelDetail() {
    const { channelId } = useParams<{ channelId: string }>();
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();
    const { user } = useAuth();
    const { showConfirm } = useConfirm();
    const { showError, showSuccess } = useToast();
    const [tonConnectUI] = useTonConnectUI();
    const userWalletAddress = useTonAddress();

    const [channel, setChannel] = useState<Channel | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedFormat, setSelectedFormat] = useState<FormatType>('post');
    const [imageError, setImageError] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [growthData, setGrowthData] = useState<any[]>([]);

    // Pricing edit modal
    const [showPricingModal, setShowPricingModal] = useState(false);
    const [editPostPrice, setEditPostPrice] = useState('');
    const [isSavingPrice, setIsSavingPrice] = useState(false);

    // Brief fields for deal modal
    const [showDealModal, setShowDealModal] = useState(false);
    const [suggestedText, setSuggestedText] = useState('');
    const [publishTime, setPublishTime] = useState('');
    const [additionalNotes, setAdditionalNotes] = useState('');
    const [suggestedImageUrl, setSuggestedImageUrl] = useState('');
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isCreatingDeal, setIsCreatingDeal] = useState(false);

    const isOwner = channel?.admins.includes(user?.id || '');

    useEffect(() => {
        loadChannel();
    }, [channelId]);

    // Load growth data after channel loads
    useEffect(() => {
        if (channel?.id) {
            api.get<any>(`/channels/${channel.id}/growth`)
                .then(res => {
                    if (res.success && res.data) {
                        const data = (res.data as any).data || res.data || [];
                        setGrowthData(Array.isArray(data) ? data : []);
                    }
                })
                .catch(() => { });
        }
    }, [channel?.id]);

    const loadChannel = async () => {
        if (!channelId) return;
        setIsLoading(true);
        try {
            const response = await api.get<Channel>(`/channels/${channelId}`);
            if (response.success && response.data) {
                setChannel(response.data);
            }
        } catch (error) {
            console.error('Error loading channel:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showError('Image must be less than 5MB');
            return;
        }
        setIsUploadingImage(true);
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result as string;
                const response = await api.post<any>('/upload', {
                    data: base64Data,
                    mimeType: file.type,
                    filename: file.name,
                });
                if (response.success && response.data?.url) {
                    setSuggestedImageUrl(response.data.url);
                    hapticFeedback('success');
                } else {
                    showError(response.error || 'Failed to upload image');
                }
                setIsUploadingImage(false);
            };
            reader.onerror = () => {
                showError('Failed to read image');
                setIsUploadingImage(false);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            showError('Image upload failed');
            setIsUploadingImage(false);
        }
    };

    const handleCreateDeal = async () => {
        if (!channel) return;

        const format = getFormats().find(f => f.id === selectedFormat);
        if (!format) return;

        // Validate price is set
        if (!format.price || format.price <= 0) {
            hapticFeedback('error');
            showError('This channel has not set pricing yet. Contact the channel owner.');
            return;
        }

        // Check wallet connection first
        if (!userWalletAddress) {
            tonConnectUI.openModal();
            showError('Please connect your wallet first');
            return;
        }

        hapticFeedback('medium');

        const confirmed = await showConfirm({
            title: 'Create & Pay',
            message: `Create a deal and pay ${format.price} TON for ${format.name}?\nPayment will be sent to escrow immediately.`,
            confirmText: `Pay ${format.price} TON`,
            type: 'success'
        });

        if (!confirmed) return;

        setIsCreatingDeal(true);

        try {
            // Step 1: Create the deal
            const payload: Record<string, any> = {
                channelId: channel.id,
                sourceType: 'listing',
                amount: format.price,
                format: selectedFormat === 'permanent' ? 'post' : selectedFormat,
            };

            if (suggestedText.trim()) payload.suggestedText = suggestedText.trim();
            if (publishTime) payload.publishTime = publishTime;
            if (additionalNotes.trim()) payload.additionalNotes = additionalNotes.trim();
            if (suggestedImageUrl) {
                payload.suggestedImageUrl = suggestedImageUrl;
                payload.publishWithImage = true;
            }

            const response = await api.post<any>('/deals', payload);

            if (!response.success || !response.data) {
                hapticFeedback('error');
                showError(response.error || 'Failed to create deal');
                setIsCreatingDeal(false);
                return;
            }

            const newDeal = response.data;
            const escrowAddress = newDeal.escrowWalletAddress || newDeal.paymentAddress;

            if (!escrowAddress || escrowAddress.startsWith('DEMO_')) {
                // Demo mode or no escrow - just navigate
                hapticFeedback('success');
                showSuccess('Deal created successfully!');
                setShowDealModal(false);
                navigate(`/deals/${newDeal.id}`);
                setIsCreatingDeal(false);
                return;
            }

            // Step 2: Send payment via TonConnect
            const amountInNanoTon = Math.floor(format.price * 1_000_000_000).toString();

            const transaction = {
                validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min
                messages: [
                    {
                        address: escrowAddress,
                        amount: amountInNanoTon,
                    },
                ],
            };

            await tonConnectUI.sendTransaction(transaction);

            hapticFeedback('success');
            showSuccess('Payment sent! Confirming...');

            // Step 3: Navigate to deal page immediately
            setShowDealModal(false);
            navigate(`/deals/${newDeal.id}`);

            // Step 4: Auto-poll for payment confirmation in background
            let attempts = 0;
            const maxAttempts = 40; // ~60s
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const result = await api.post<any>(`/deals/${newDeal.id}/check-payment`, {
                        advertiserWalletAddress: userWalletAddress,
                    });
                    if (result.success && result.data?.paymentReceived) {
                        clearInterval(pollInterval);
                        showSuccess('✅ Payment confirmed!');
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                    }
                } catch {
                    if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                    }
                }
            }, 1500);

        } catch (error: any) {
            hapticFeedback('error');
            if (error.message?.includes('Cancelled')) {
                showError('Payment cancelled. Deal was created but not paid. You can pay from the deal page.');
                // Still navigate to the deal even if payment was cancelled
            } else {
                showError(error.message || 'Failed to create deal');
            }
        }
        setIsCreatingDeal(false);
    };

    const handleRefreshStats = async () => {
        if (!channel) return;
        hapticFeedback('light');
        try {
            const response = await api.post<Channel>(`/channels/${channel.id}/refresh`);
            if (response.success && response.data) {
                setChannel(response.data);
                hapticFeedback('success');
                showSuccess('Stats refreshed!');
            }
        } catch (error) {
            hapticFeedback('error');
        }
    };

    const handleOpenPricingModal = () => {
        if (!channel) return;
        // Pre-fill with current price
        const currentPrice = channel.pricing?.post?.price || 0;
        setEditPostPrice(currentPrice.toString());
        setShowEditModal(false);
        setShowPricingModal(true);
    };

    const handleSavePricing = async () => {
        if (!channel) return;
        setIsSavingPrice(true);
        hapticFeedback('light');

        try {
            const newPrice = parseFloat(editPostPrice) || 0;
            const response = await api.put<Channel>(`/channels/${channel.id}`, {
                pricing: {
                    post: {
                        price: newPrice,
                        duration: '24h'
                    }
                }
            });

            if (response.success && response.data) {
                setChannel(response.data);
                hapticFeedback('success');
                showSuccess('Pricing updated successfully!');
                setShowPricingModal(false);
            } else {
                showError(response.error || 'Failed to update pricing');
            }
        } catch (error: any) {
            hapticFeedback('error');
            showError(error.message || 'Failed to update pricing');
        } finally {
            setIsSavingPrice(false);
        }
    };

    const getFormats = (): FormatOption[] => {
        if (!channel) return [];
        const formats: FormatOption[] = [];

        // Debug logging - check what structure we get from API
        console.log('Full channel object:', channel);
        console.log('Channel pricing:', JSON.stringify(channel.pricing, null, 2));

        // Get pricing - handle different possible structures
        const pricing = channel.pricing || {};
        const postPrice = pricing.post?.price ?? (pricing as any).postPrice ?? 0;
        const storyPrice = pricing.story?.price ?? (pricing as any).storyPrice ?? 0;

        // Show post formats if post pricing exists (even if 0)
        if (pricing.post || (pricing as any).postPrice !== undefined) {
            formats.push({
                id: 'post',
                name: '1/24h Post',
                description: '1 hour top, 24 hours feed',
                price: postPrice,
                usdPrice: postPrice * 5,
                icon: 'post'
            });
            formats.push({
                id: 'permanent',
                name: 'Permanent Post',
                description: 'Never deleted',
                price: Math.round(postPrice * 1.67),
                usdPrice: Math.round(postPrice * 1.67 * 5),
                icon: 'pin'
            });
        }

        // Show story format if story pricing exists
        if (pricing.story || (pricing as any).storyPrice !== undefined) {
            formats.push({
                id: 'story',
                name: 'Story (24h)',
                description: 'High visibility',
                price: storyPrice,
                usdPrice: storyPrice * 5,
                icon: '📷'
            });
        }

        return formats;
    };

    if (isLoading) return <Loading />;

    if (!channel) {
        return (
            <div>
                <Header title="Channel" showBack />
                <div className="container">
                    <div className="empty-state">
                        <div className="empty-state-icon"><Icon name="close" size={48} color="var(--accent-red)" /></div>
                        <h3 className="empty-state-title">Channel not found</h3>
                    </div>
                </div>
            </div>
        );
    }

    const avatarLetter = (channel.title || 'C')[0].toUpperCase();
    const showPhoto = channel.photoUrl && !imageError;
    const formats = getFormats();
    const selectedFormatData = formats.find(f => f.id === selectedFormat);
    const category = (channel as any).category || 'general';
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

    // Real stats from channel data
    const subscribers = channel.stats?.subscribers ?? null;
    const avgViews = channel.stats?.avgViews ?? null;
    const premiumPct = channel.stats?.premiumSubscribers ?? null;
    const languageChart = channel.stats?.languageChart ?? null;
    const enabledNotifs = channel.stats?.enabledNotifications ?? null;
    // ERR = views / subscribers ratio
    const err = (subscribers && avgViews && subscribers > 0)
        ? (avgViews / subscribers).toFixed(1)
        : null;

    // Use MTProto growth graph or fallback to Firestore growth snapshots
    const effectiveGrowthData = channel.stats?.growthGraph && channel.stats.growthGraph.length >= 2
        ? channel.stats.growthGraph
        : growthData.map((d: any) => ({ date: d.date, value: d.subscribers || 0 }));

    // SVG chart rendering helper
    const renderLineChart = (
        data: { x: number; y: number }[],
        _W: number, H: number, PAD: number,
        color: string, fillGradientId: string
    ) => {
        if (data.length < 2) return null;
        const pts = data.map(d => `${d.x},${d.y}`);
        const lineStr = pts.join(' ');
        const areaStr = `${data[0].x},${H - PAD} ${lineStr} ${data[data.length - 1].x},${H - PAD}`;
        return (
            <>
                <defs>
                    <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon points={areaStr} fill={`url(#${fillGradientId})`} />
                <polyline points={lineStr} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
        );
    };

    // Normalize data points for a chart
    const normalizePoints = (values: number[], W: number, H: number, PAD: number) => {
        const minV = Math.min(...values);
        const maxV = Math.max(...values);
        const range = maxV - minV || 1;
        return values.map((v, i) => ({
            x: PAD + (i / Math.max(values.length - 1, 1)) * (W - 2 * PAD),
            y: H - PAD - ((v - minV) / range) * (H - 2 * PAD),
        }));
    };

    // Language chart colors (Telegram-style)
    const langColors = ['#3390ec', '#5ac8fa', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#8e8e93'];

    return (
        <div className="channel-detail-page">
            <Header
                title="Channel Stats"
                showBack
                backTo="/channels"
                action={isOwner ? { label: 'Edit', onClick: () => setShowEditModal(true) } : undefined}
            />

            <div className="container">
                {/* Hero Section */}
                <div className="channel-hero">
                    <div className="hero-avatar">
                        {showPhoto ? (
                            <img src={channel.photoUrl} alt="" onError={() => setImageError(true)} />
                        ) : (
                            <span>{avatarLetter}</span>
                        )}
                        <div className="avatar-indicator"></div>
                    </div>
                    <h1 className="hero-title">{channel.title}</h1>
                    <p className="hero-subtitle">
                        @{channel.username} • {categoryLabel}
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="stats-grid-4">
                    <div className="stat-box-new">
                        <div className="stat-icon"><Icon name="users" size={16} /></div>
                        <div className="stat-label-new">Subscribers</div>
                        <div className="stat-value-new">
                            {subscribers !== null ? formatNumber(subscribers) : 'N/A'}
                        </div>
                    </div>
                    <div className="stat-box-new">
                        <div className="stat-icon"><Icon name="eye" size={16} /></div>
                        <div className="stat-label-new">Avg Views</div>
                        <div className="stat-value-new">
                            {avgViews !== null ? formatNumber(avgViews) : 'N/A'}
                        </div>
                    </div>
                    <div className="stat-box-new">
                        <div className="stat-icon"><Icon name="chart" size={16} /></div>
                        <div className="stat-label-new">ERR</div>
                        <div className="stat-value-new">
                            {err !== null ? `${err}x` : 'N/A'}
                        </div>
                    </div>
                    <div className="stat-box-new">
                        <div className="stat-icon"><Icon name="star" size={16} /></div>
                        <div className="stat-label-new">Premium</div>
                        <div className="stat-value-new">
                            {premiumPct !== null ? `${premiumPct}%` : (subscribers && subscribers < 500 ? '<500' : 'N/A')}
                        </div>
                    </div>
                </div>

                {/* Enabled Notifications */}
                {enabledNotifs !== null && (
                    <div className="section-card" style={{ marginBottom: 12 }}>
                        <div className="section-card-header">
                            <span className="section-card-title">🔔 Enabled Notifications</span>
                            <span className="chart-badge">Verified</span>
                        </div>
                        <div style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
                                    <div style={{ width: `${enabledNotifs}%`, height: '100%', background: 'var(--accent)', borderRadius: 8, transition: 'width 0.5s' }} />
                                </div>
                                <span style={{ fontWeight: 700, fontSize: 14 }}>{enabledNotifs}%</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Language Distribution - Pie Chart */}
                {languageChart && Object.keys(languageChart).length > 0 && (() => {
                    const entries = Object.entries(languageChart).sort(([, a], [, b]) => b - a);
                    const total = entries.reduce((s, [, v]) => s + v, 0);
                    let cumulativeAngle = 0;

                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">🌍 Language Distribution</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 20 }}>
                                {/* SVG Pie Chart */}
                                <svg viewBox="0 0 120 120" width="120" height="120" style={{ flexShrink: 0 }}>
                                    {entries.map(([lang, count], i) => {
                                        const pct = count / total;
                                        const startAngle = cumulativeAngle;
                                        cumulativeAngle += pct * 360;
                                        const endAngle = cumulativeAngle;
                                        const largeArc = pct > 0.5 ? 1 : 0;
                                        const rads = (a: number) => (a - 90) * Math.PI / 180;
                                        const x1 = 60 + 50 * Math.cos(rads(startAngle));
                                        const y1 = 60 + 50 * Math.sin(rads(startAngle));
                                        const x2 = 60 + 50 * Math.cos(rads(endAngle));
                                        const y2 = 60 + 50 * Math.sin(rads(endAngle));
                                        const color = langColors[i % langColors.length];
                                        if (pct < 0.01) return null;
                                        if (pct >= 0.999) {
                                            return <circle key={lang} cx="60" cy="60" r="50" fill={color} />;
                                        }
                                        return (
                                            <path
                                                key={lang}
                                                d={`M60,60 L${x1},${y1} A50,50 0 ${largeArc},1 ${x2},${y2} Z`}
                                                fill={color}
                                            />
                                        );
                                    })}
                                    <circle cx="60" cy="60" r="28" fill="var(--bg-secondary)" />
                                </svg>
                                {/* Legend */}
                                <div style={{ flex: 1 }}>
                                    {entries.slice(0, 6).map(([lang, count], i) => {
                                        const pct = Math.round((count / total) * 100);
                                        return (
                                            <div key={lang} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: langColors[i % langColors.length], flexShrink: 0 }} />
                                                <span style={{ flex: 1 }}>{lang}</span>
                                                <span style={{ fontWeight: 600, opacity: 0.8 }}>{pct}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* New Member Sources */}
                {channel.stats?.newMemberSources && Object.keys(channel.stats.newMemberSources).length > 0 && (() => {
                    const sources = channel.stats.newMemberSources!;
                    const entries = Object.entries(sources).sort(([, a], [, b]) => b - a);
                    const maxVal = Math.max(...entries.map(([, v]) => v));
                    const sourceIcons: Record<string, string> = {
                        'Groups': '👥', 'PM': '💬', 'Channels': '📢',
                        'Search': '🔍', 'Other': '📎', 'Mentions': '🏷️',
                    };
                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">📊 New Member Sources</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '12px 16px' }}>
                                {entries.map(([source, count]) => (
                                    <div key={source} style={{ marginBottom: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                                            <span>{sourceIcons[source] || '📎'} {source}</span>
                                            <span style={{ fontWeight: 600 }}>{formatNumber(count)}</span>
                                        </div>
                                        <div style={{ background: 'var(--bg-tertiary)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                            <div style={{ width: `${(count / maxVal) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.5s' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                {/* Growth Chart */}
                <div className="section-card">
                    <div className="section-card-header">
                        <span className="section-card-title">📈 Growth (30d)</span>
                        <span className="chart-badge">{channel.stats?.growthGraph ? 'Verified' : 'Tracked'}</span>
                    </div>
                    <div className="growth-chart" id="growth-chart-container">
                        {effectiveGrowthData.length >= 2 ? (() => {
                            const W = 320, H = 120, PAD = 20;
                            const subs = effectiveGrowthData.map((d: any) => d.value || d.subscribers || 0);
                            const points = normalizePoints(subs, W, H, PAD);
                            const change = subs[subs.length - 1] - subs[0];
                            const changeStr = change >= 0 ? `+${formatNumber(change)}` : `-${formatNumber(Math.abs(change))}`;
                            const color = change >= 0 ? '#22c55e' : '#ef4444';
                            return (
                                <div>
                                    <svg viewBox={`0 0 ${W} ${H}`} className="growth-svg">
                                        {renderLineChart(points, W, H, PAD, color, 'growthGrad')}
                                    </svg>
                                    <div className="growth-summary">
                                        <span className={`growth-change ${change >= 0 ? 'positive' : 'negative'}`}>
                                            {changeStr}
                                        </span>
                                        <span className="growth-period">over {effectiveGrowthData.length} days</span>
                                    </div>
                                </div>
                            );
                        })() : (
                            <div className="chart-placeholder">
                                <Icon name="chart" size={32} color="#6e7681" />
                                {subscribers !== null && subscribers < 500 ? (
                                    <>
                                        <span>Channel needs 500+ subscribers</span>
                                        <small>Telegram's analytics API requires at least 500 subscribers to provide growth charts, language distribution, and other detailed statistics.</small>
                                    </>
                                ) : (
                                    <>
                                        <span>Loading analytics...</span>
                                        <small>Detailed growth data will be fetched from Telegram's verified analytics.</small>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Followers Joined/Left */}
                {channel.stats?.followersGraph && channel.stats.followersGraph.length >= 2 && (() => {
                    const data = channel.stats.followersGraph!;
                    const W = 320, H = 100, PAD = 20;
                    const barW = Math.max(2, (W - 2 * PAD) / data.length - 2);
                    const maxVal = Math.max(...data.map(d => Math.max(d.joined, d.left)), 1);
                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">👥 Followers</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '8px 16px' }}>
                                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
                                    {data.map((d, i) => {
                                        const x = PAD + (i / data.length) * (W - 2 * PAD);
                                        const joinedH = (d.joined / maxVal) * (H - 2 * PAD);
                                        const leftH = (d.left / maxVal) * (H - 2 * PAD);
                                        return (
                                            <g key={i}>
                                                <rect x={x} y={H - PAD - joinedH} width={barW * 0.45} height={joinedH} fill="#22c55e" rx="1" opacity="0.8" />
                                                <rect x={x + barW * 0.5} y={H - PAD - leftH} width={barW * 0.45} height={leftH} fill="#ef4444" rx="1" opacity="0.8" />
                                            </g>
                                        );
                                    })}
                                </svg>
                                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 12, marginTop: 4 }}>
                                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#22c55e', borderRadius: 2, marginRight: 4 }} />Joined</span>
                                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#ef4444', borderRadius: 2, marginRight: 4 }} />Left</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Views and Shares */}
                {channel.stats?.viewsSharesGraph && channel.stats.viewsSharesGraph.length >= 2 && (() => {
                    const data = channel.stats.viewsSharesGraph!;
                    const W = 320, H = 120, PAD = 20;
                    const views = data.map(d => d.views);
                    const shares = data.map(d => d.shares);
                    const allVals = [...views, ...shares];
                    const minV = Math.min(...allVals);
                    const maxV = Math.max(...allVals);
                    const range = maxV - minV || 1;
                    const norm = (vals: number[]) => vals.map((v, i) => ({
                        x: PAD + (i / Math.max(vals.length - 1, 1)) * (W - 2 * PAD),
                        y: H - PAD - ((v - minV) / range) * (H - 2 * PAD),
                    }));
                    const viewPts = norm(views);
                    const sharePts = norm(shares);
                    const totalViews = views.reduce((s, v) => s + v, 0);
                    const totalShares = shares.reduce((s, v) => s + v, 0);
                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">👁 Views and Shares</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '8px 16px' }}>
                                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
                                    {renderLineChart(viewPts, W, H, PAD, '#3390ec', 'viewsGrad')}
                                    <polyline
                                        points={sharePts.map(p => `${p.x},${p.y}`).join(' ')}
                                        fill="none" stroke="#ff9500" strokeWidth="2" strokeLinecap="round" strokeDasharray="4,3"
                                    />
                                </svg>
                                <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between', fontSize: 12, marginTop: 4, padding: '0 4px' }}>
                                    <span><span style={{ display: 'inline-block', width: 8, height: 3, background: '#3390ec', borderRadius: 2, marginRight: 4 }} />Views: {formatNumber(totalViews)}</span>
                                    <span><span style={{ display: 'inline-block', width: 8, height: 3, background: '#ff9500', borderRadius: 2, marginRight: 4, borderTop: '1px dashed #ff9500' }} />Shares: {formatNumber(totalShares)}</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Views by Hour */}
                {channel.stats?.viewsByHour && channel.stats.viewsByHour.length >= 24 && (() => {
                    const hours = channel.stats.viewsByHour!;
                    const maxH = Math.max(...hours, 1);
                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">🕐 Views by Hour</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '12px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
                                    {hours.map((v, i) => (
                                        <div
                                            key={i}
                                            style={{
                                                flex: 1,
                                                height: `${(v / maxH) * 100}%`,
                                                minHeight: 2,
                                                background: v === maxH ? '#3390ec' : 'rgba(51,144,236,0.4)',
                                                borderRadius: '2px 2px 0 0',
                                                transition: 'height 0.3s',
                                            }}
                                            title={`${i}:00 — ${v}%`}
                                        />
                                    ))}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Recent Posts Performance */}
                {channel.stats?.recentPosts && channel.stats.recentPosts.length > 0 && (() => {
                    const posts = channel.stats.recentPosts!.slice(0, 10);
                    const maxViews = Math.max(...posts.map(p => p.views), 1);
                    return (
                        <div className="section-card">
                            <div className="section-card-header">
                                <span className="section-card-title">📊 Recent Posts</span>
                                <span className="chart-badge">Verified</span>
                            </div>
                            <div style={{ padding: '12px 16px' }}>
                                {posts.map((post, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 20, textAlign: 'right' }}>#{i + 1}</span>
                                        <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                            <div style={{ width: `${(post.views / maxViews) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
                                            👁 {formatNumber(post.views)}
                                        </span>
                                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'right' }}>
                                            ↗ {formatNumber(post.forwards)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                {/* Channel Admins (for owners) */}
                {isOwner && (
                    <div className="section-card">
                        <h3 className="section-card-title">Channel Management</h3>
                        <ChannelAdmins
                            channelId={channel.id}
                            adminDetails={(channel as any).adminDetails || []}
                            onSync={loadChannel}
                        />
                        <div className="flex gap-sm mt-md">
                            <button
                                className="btn btn-secondary btn-sm flex-1"
                                onClick={handleRefreshStats}
                            >
                                <Icon name="refresh" size={14} /> Refresh Stats
                            </button>
                            <button
                                className="btn btn-primary btn-sm flex-1"
                                onClick={handleOpenPricingModal}
                            >
                                <Icon name="dollar" size={16} /> Edit Pricing
                            </button>
                        </div>
                    </div>
                )}

                {/* Available Formats */}
                {formats.length > 0 && (
                    <>
                        <h3 className="formats-title">Available Formats</h3>
                        <div className="formats-list">
                            {formats.map(format => (
                                <div
                                    key={format.id}
                                    className={`format-card ${selectedFormat === format.id ? 'selected' : ''}`}
                                    onClick={() => { setSelectedFormat(format.id); hapticFeedback('light'); }}
                                >
                                    <div className="format-icon">{format.icon}</div>
                                    <div className="format-info">
                                        <div className="format-name">{format.name}</div>
                                        <div className="format-desc">{format.description}</div>
                                    </div>
                                    <div className="format-pricing">
                                        <div className="format-price">{Math.round(format.price)} TON</div>
                                        <div className="format-usd">~${Math.round(format.usdPrice)}</div>
                                    </div>
                                    <div className={`format-radio ${selectedFormat === format.id ? 'checked' : ''}`}></div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* No Pricing Message */}
                {formats.length === 0 && (
                    <div className="section-card">
                        <p className="no-pricing-msg">No pricing set for this channel yet.</p>
                    </div>
                )}

                {/* Spacer for bottom button */}
                <div style={{ height: '100px' }}></div>
            </div>

            {/* Create Deal Button (fixed at bottom) - For non-owners */}
            {formats.length > 0 && !isOwner && (
                <div className="bottom-action-bar">
                    <button
                        className="create-deal-btn"
                        onClick={() => setShowDealModal(true)}
                    >
                        Create Deal → {selectedFormatData ? `${Math.round(selectedFormatData.price)} TON` : ''}
                    </button>
                </div>
            )}

            {/* Edit Modal for Owners */}
            {showEditModal && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Channel</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)}>×</button>
                        </div>
                        <div className="modal-content">
                            <p className="text-secondary mb-lg">
                                Channel editing is done through Telegram. You can:
                            </p>
                            <div className="edit-options">
                                <button
                                    className="btn btn-secondary btn-block mb-md"
                                    onClick={() => {
                                        window.open(`https://t.me/${channel.username}`, '_blank');
                                        setShowEditModal(false);
                                    }}
                                >
                                    <Icon name="external" size={16} /> Open Channel in Telegram
                                </button>
                                <button
                                    className="btn btn-secondary btn-block mb-md"
                                    onClick={handleRefreshStats}
                                >
                                    <Icon name="refresh" size={14} /> Refresh Stats from Telegram
                                </button>
                                <button
                                    className="btn btn-primary btn-block"
                                    onClick={() => { navigate('/my-channels'); setShowEditModal(false); }}
                                >
                                    View All My Channels
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Deal Modal */}
            {showDealModal && (
                <div className="modal-overlay" onClick={() => setShowDealModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Create Deal</h3>
                            <button className="modal-close" onClick={() => setShowDealModal(false)}>×</button>
                        </div>

                        <div className="modal-content">
                            <div className="deal-summary">
                                <span>{selectedFormatData?.name}</span>
                                <span className="deal-price">{Math.round(selectedFormatData?.price || 0)} TON</span>
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Icon name="edit" size={14} /> Suggested Ad Text (Optional)
                                </label>
                                <textarea
                                    className="form-textarea"
                                    value={suggestedText}
                                    onChange={e => setSuggestedText(e.target.value)}
                                    placeholder="Write your suggested ad text here..."
                                    rows={3}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Icon name="calendar" size={14} /> Preferred Publish Time - UTC (Optional)
                                </label>
                                <input
                                    type="datetime-local"
                                    className="form-input"
                                    value={publishTime}
                                    onChange={e => setPublishTime(e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Icon name="message" size={14} /> Additional Notes (Optional)
                                </label>
                                <textarea
                                    className="form-textarea"
                                    value={additionalNotes}
                                    onChange={e => setAdditionalNotes(e.target.value)}
                                    placeholder="Any special requirements or notes..."
                                    rows={2}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <Icon name="image" size={14} /> Suggested Image (Optional)
                                </label>
                                {suggestedImageUrl ? (
                                    <div className="image-preview">
                                        <img src={suggestedImageUrl} alt="Suggested" />
                                        <button className="remove-image-btn" onClick={() => setSuggestedImageUrl('')}>
                                            <Icon name="close" size={12} /> Remove
                                        </button>
                                    </div>
                                ) : (
                                    <label className="upload-btn">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleImageUpload}
                                            disabled={isUploadingImage}
                                        />
                                        {isUploadingImage ? 'Uploading...' : <><Icon name="upload" size={14} /> Upload Image</>}
                                    </label>
                                )}
                            </div>

                            <button
                                className="btn btn-ton btn-block"
                                onClick={handleCreateDeal}
                                disabled={isCreatingDeal || isUploadingImage}
                            >
                                {isCreatingDeal ? '⏳ Processing...' : <><Icon name="ton" size={16} /> Create & Pay {Math.round(selectedFormatData?.price || 0)} TON</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Pricing Modal */}
            {showPricingModal && (
                <div className="modal-overlay" onClick={() => setShowPricingModal(false)}>
                    <div className="modal deal-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3><Icon name="dollar" size={18} /> Edit Pricing</h3>
                            <button className="modal-close" onClick={() => setShowPricingModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Post Price (TON)</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    placeholder="e.g., 0.1"
                                    value={editPostPrice}
                                    onChange={(e) => setEditPostPrice(e.target.value)}
                                    step="0.01"
                                    min="0"
                                />
                                <small className="text-secondary">
                                    Permanent Post will be {Math.round(parseFloat(editPostPrice || '0') * 1.67 * 100) / 100} TON
                                </small>
                            </div>

                            <div className="flex gap-sm mt-lg">
                                <button
                                    className="btn btn-secondary flex-1"
                                    onClick={() => setShowPricingModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary flex-1"
                                    onClick={handleSavePricing}
                                    disabled={isSavingPrice}
                                >
                                    {isSavingPrice ? 'Saving...' : 'Save Pricing'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ChannelDetail;
