// Channels Page - Restructured Filters
import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, Channel, formatNumber, AdRequest } from '../lib/api';
import Header from '../components/Header';
import EmptyState from '../components/EmptyState';
import Loading from '../components/Loading';
import Icon from '../components/Icon';
import './Channels.css';

type TabType = 'marketplace' | 'myads';
type SortType = 'subscribers_desc' | 'subscribers_asc' | 'price_desc' | 'price_asc' | 'newest' | 'oldest';
type CategoryType = 'all' | 'crypto' | 'tech' | 'lifestyle' | 'news' | 'entertainment' | 'education' | 'general';

const CATEGORIES = [
    { value: 'all', label: 'All Categories', icon: 'market' },
    { value: 'crypto', label: 'Crypto', icon: 'dollar' },
    { value: 'tech', label: 'Tech', icon: 'settings' },
    { value: 'lifestyle', label: 'Lifestyle', icon: 'star' },
    { value: 'news', label: 'News', icon: 'fileText' },
    { value: 'entertainment', label: 'Entertainment', icon: 'eye' },
    { value: 'education', label: 'Education', icon: 'info' },
    { value: 'general', label: 'General', icon: 'megaphone' },
];

const SORT_OPTIONS = [
    { value: 'subscribers_desc', label: 'Subscribers ↓' },
    { value: 'subscribers_asc', label: 'Subscribers ↑' },
    { value: 'price_desc', label: 'Price ↓' },
    { value: 'price_asc', label: 'Price ↑' },
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
];

function Channels() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();

    const [channels, setChannels] = useState<Channel[]>([]);
    const [myRequests, setMyRequests] = useState<AdRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<TabType>('marketplace');

    // Dropdowns
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);

    // Filters
    const [sortBy, setSortBy] = useState<SortType>('subscribers_desc');
    const [category, setCategory] = useState<CategoryType>('all');

    // Range filters
    const [minSubscribers, setMinSubscribers] = useState('');
    const [maxSubscribers, setMaxSubscribers] = useState('');
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');

    useEffect(() => {
        if (activeTab === 'marketplace') {
            loadChannels();
        } else {
            loadMyRequests();
        }
    }, [activeTab]);

    const loadChannels = async () => {
        setIsLoading(true);
        try {
            const response = await api.get<{ data: Channel[] }>('/channels');
            if (response.success && response.data) {
                const data = response.data as any;
                setChannels(data.data || data || []);
            }
        } catch (error) {
            console.error('Error loading channels:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadMyRequests = async () => {
        setIsLoading(true);
        try {
            const response = await api.get<{ data: AdRequest[] }>('/requests/mine');
            if (response.success && response.data) {
                const data = response.data as any;
                setMyRequests(data.data || data || []);
            }
        } catch (error) {
            console.error('Error loading requests:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Filter and sort channels
    const filteredChannels = useMemo(() => {
        let result = [...channels];

        // Search filter
        if (search.trim()) {
            const searchLower = search.toLowerCase();
            result = result.filter(ch =>
                ch.title?.toLowerCase().includes(searchLower) ||
                ch.username?.toLowerCase().includes(searchLower)
            );
        }

        // Category filter
        if (category !== 'all') {
            result = result.filter(ch => (ch as any).category === category);
        }

        // Subscribers range filter
        if (minSubscribers) {
            result = result.filter(ch => ch.stats.subscribers >= parseInt(minSubscribers));
        }
        if (maxSubscribers) {
            result = result.filter(ch => ch.stats.subscribers <= parseInt(maxSubscribers));
        }

        // Price range filter
        if (minPrice) {
            result = result.filter(ch => (ch.pricing?.post?.price || 0) >= parseFloat(minPrice));
        }
        if (maxPrice) {
            result = result.filter(ch => (ch.pricing?.post?.price || 0) <= parseFloat(maxPrice));
        }

        // Sorting
        switch (sortBy) {
            case 'subscribers_desc':
                result.sort((a, b) => b.stats.subscribers - a.stats.subscribers);
                break;
            case 'subscribers_asc':
                result.sort((a, b) => a.stats.subscribers - b.stats.subscribers);
                break;
            case 'price_desc':
                result.sort((a, b) => (b.pricing?.post?.price || 0) - (a.pricing?.post?.price || 0));
                break;
            case 'price_asc':
                result.sort((a, b) => (a.pricing?.post?.price || 0) - (b.pricing?.post?.price || 0));
                break;
            case 'newest':
                result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
            case 'oldest':
                result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                break;
        }

        return result;
    }, [channels, search, category, minSubscribers, maxSubscribers, minPrice, maxPrice, sortBy]);

    const handleChannelClick = (channelId: string) => {
        hapticFeedback('light');
        navigate(`/channels/${channelId}`);
    };

    const handleTabChange = (tab: TabType) => {
        setActiveTab(tab);
        hapticFeedback('light');
    };

    const closeAllDropdowns = () => {
        setShowSortDropdown(false);
        setShowCategoryDropdown(false);
        setShowFiltersDropdown(false);
    };

    const clearFilters = () => {
        setSearch('');
        setCategory('all');
        setMinSubscribers('');
        setMaxSubscribers('');
        setMinPrice('');
        setMaxPrice('');
        setSortBy('subscribers_desc');
        hapticFeedback('light');
    };

    const hasActiveFilters = category !== 'all' || minSubscribers || maxSubscribers || minPrice || maxPrice;
    const currentCategoryLabel = CATEGORIES.find(c => c.value === category)?.label || 'All';

    return (
        <div className="channels-page" onClick={closeAllDropdowns}>
            <Header title="Ads Marketplace" />

            <div className="container">
                {/* Tabs */}
                <div className="tabs-container">
                    <button
                        className={`tab-btn ${activeTab === 'marketplace' ? 'active' : ''}`}
                        onClick={() => handleTabChange('marketplace')}
                    >
                        Marketplace
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'myads' ? 'active' : ''}`}
                        onClick={() => handleTabChange('myads')}
                    >
                        My Ads
                    </button>
                </div>

                {activeTab === 'marketplace' ? (
                    <>
                        {/* Search */}
                        <div className="search-box" onClick={(e) => e.stopPropagation()}>
                            <Icon name="search" size={18} color="#6e7681" />
                            <input
                                type="text"
                                placeholder="Search channels..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>

                        {/* Filter Buttons Row */}
                        <div className="filter-row" onClick={(e) => e.stopPropagation()}>
                            {/* Sort By Dropdown */}
                            <div className="dropdown-wrapper">
                                <button
                                    className="pill-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeAllDropdowns();
                                        setShowSortDropdown(!showSortDropdown);
                                    }}
                                >
                                    Sort By ▾
                                </button>
                                {showSortDropdown && (
                                    <div className="dropdown-menu">
                                        {SORT_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                className={sortBy === opt.value ? 'active' : ''}
                                                onClick={() => {
                                                    setSortBy(opt.value as SortType);
                                                    setShowSortDropdown(false);
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Category Dropdown */}
                            <div className="dropdown-wrapper">
                                <button
                                    className={`pill-btn ${category !== 'all' ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeAllDropdowns();
                                        setShowCategoryDropdown(!showCategoryDropdown);
                                    }}
                                >
                                    {category === 'all' ? 'Category' : currentCategoryLabel} ▾
                                </button>
                                {showCategoryDropdown && (
                                    <div className="dropdown-menu">
                                        {CATEGORIES.map(cat => (
                                            <button
                                                key={cat.value}
                                                className={category === cat.value ? 'active' : ''}
                                                onClick={() => {
                                                    setCategory(cat.value as CategoryType);
                                                    setShowCategoryDropdown(false);
                                                }}
                                            >
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Filter Button with Range Options */}
                            <div className="dropdown-wrapper">
                                <button
                                    className={`pill-btn filter-icon-btn ${hasActiveFilters ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeAllDropdowns();
                                        setShowFiltersDropdown(!showFiltersDropdown);
                                    }}
                                >
                                    <Icon name="filter" size={16} />
                                </button>
                                {showFiltersDropdown && (
                                    <div className="dropdown-menu filter-menu" onClick={(e) => e.stopPropagation()}>
                                        <div className="filter-section">
                                            <div className="filter-title">Subscribers Range</div>
                                            <div className="filter-inputs">
                                                <input
                                                    type="number"
                                                    placeholder="Min"
                                                    value={minSubscribers}
                                                    onChange={(e) => setMinSubscribers(e.target.value)}
                                                />
                                                <span>-</span>
                                                <input
                                                    type="number"
                                                    placeholder="Max"
                                                    value={maxSubscribers}
                                                    onChange={(e) => setMaxSubscribers(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="filter-section">
                                            <div className="filter-title">Price Range (TON)</div>
                                            <div className="filter-inputs">
                                                <input
                                                    type="number"
                                                    placeholder="Min"
                                                    value={minPrice}
                                                    onChange={(e) => setMinPrice(e.target.value)}
                                                />
                                                <span>-</span>
                                                <input
                                                    type="number"
                                                    placeholder="Max"
                                                    value={maxPrice}
                                                    onChange={(e) => setMaxPrice(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            className="apply-btn"
                                            onClick={() => setShowFiltersDropdown(false)}
                                        >
                                            Apply Filters
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Active Filters Indicator */}
                        {hasActiveFilters && (
                            <div className="active-filters">
                                {category !== 'all' && <span className="filter-tag">{currentCategoryLabel}</span>}
                                {(minSubscribers || maxSubscribers) && (
                                    <span className="filter-tag">
                                        Subs: {minSubscribers || '0'} - {maxSubscribers || '∞'}
                                    </span>
                                )}
                                {(minPrice || maxPrice) && (
                                    <span className="filter-tag">
                                        Price: {minPrice || '0'} - {maxPrice || '∞'} TON
                                    </span>
                                )}
                                <button className="clear-btn" onClick={clearFilters}>Clear</button>
                            </div>
                        )}

                        {/* Section Label */}
                        <div className="section-label">
                            {filteredChannels.length} CHANNELS {hasActiveFilters ? '(FILTERED)' : ''}
                        </div>

                        {/* Results */}
                        {isLoading ? (
                            <Loading />
                        ) : filteredChannels.length === 0 ? (
                            <EmptyState
                                icon={<Icon name="megaphone" size={48} color="var(--text-muted)" />}
                                title="No channels found"
                                message={hasActiveFilters ? "Try different filters." : "No channels available."}
                                action={hasActiveFilters ? { label: 'Clear Filters', onClick: clearFilters } : undefined}
                            />
                        ) : (
                            <div className="channels-list">
                                {filteredChannels.map(channel => (
                                    <ChannelCardCompact
                                        key={channel.id}
                                        channel={channel}
                                        onClick={() => handleChannelClick(channel.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    /* My Ads Tab */
                    <>
                        <div className="section-label" style={{ marginTop: 16 }}>MY AD REQUESTS</div>
                        {isLoading ? (
                            <Loading />
                        ) : myRequests.length === 0 ? (
                            <EmptyState
                                icon={<Icon name="requests" size={48} color="var(--text-muted)" />}
                                title="No ad requests"
                                message="You haven't created any ad requests yet."
                                action={{
                                    label: 'Create Request',
                                    onClick: () => navigate('/requests/new')
                                }}
                            />
                        ) : (
                            <div className="channels-list">
                                {myRequests.map(req => (
                                    <div key={req.id} className="request-card" onClick={() => navigate(`/requests/${req.id}`)}>
                                        <div className="request-title">{req.title}</div>
                                        <div className="request-budget">{req.budget.min}-{req.budget.max} TON</div>
                                        <div className="request-status">{req.status}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// Compact Channel Card
interface ChannelCardCompactProps {
    channel: Channel;
    onClick: () => void;
}

function ChannelCardCompact({ channel, onClick }: ChannelCardCompactProps) {
    const [imageError, setImageError] = useState(false);
    const avatarLetter = (channel.title || 'C')[0].toUpperCase();
    const showPhoto = channel.photoUrl && !imageError;
    const price = channel.pricing?.post?.price || 0;
    const categoryLabel = CATEGORIES.find(c => c.value === (channel as any).category)?.label || 'General';

    return (
        <div className="ch-card" onClick={onClick}>
            <div className="ch-avatar">
                {showPhoto ? (
                    <img src={channel.photoUrl} alt="" onError={() => setImageError(true)} />
                ) : (
                    <span>{avatarLetter}</span>
                )}
                <div className="ch-indicator"></div>
            </div>

            <div className="ch-info">
                <div className="ch-name">{channel.title}</div>
                <div className="ch-meta">
                    <span className="ch-badge">{categoryLabel.replace(/^.+\s/, '')}</span>
                    <span className="ch-lang">• English</span>
                </div>
                <div className="ch-stats">
                    <span><Icon name="users" size={12} /> Subscribers <b>{formatNumber(channel.stats.subscribers)}</b></span>
                    <span><Icon name="eye" size={12} /> Views <b>{formatNumber(channel.stats.avgViews)}</b></span>
                </div>
            </div>

            <div className="ch-price">
                <div className="ch-price-amount">{price} TON</div>
                <div className="ch-price-label">per post</div>
            </div>

            <div className="ch-view-btn">
                View Channel <Icon name="chevronRight" size={14} />
            </div>
        </div>
    );
}

export default Channels;
