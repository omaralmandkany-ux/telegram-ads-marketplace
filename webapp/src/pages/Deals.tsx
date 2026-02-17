// Deals Page - List user's deals with modern design

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../contexts/TelegramContext';
import { api, Deal } from '../lib/api';
import DealCard from '../components/DealCard';
import EmptyState from '../components/EmptyState';
import Loading from '../components/Loading';
import Icon from '../components/Icon';

type DealFilter = 'all' | 'active' | 'completed';

function Deals() {
    const navigate = useNavigate();
    const { hapticFeedback } = useTelegram();

    const [deals, setDeals] = useState<Deal[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<DealFilter>('all');

    useEffect(() => {
        loadDeals();
    }, [filter]);

    const loadDeals = async () => {
        setIsLoading(true);
        try {
            let endpoint = '/deals';
            if (filter === 'active') {
                endpoint = '/deals?status=pending_acceptance,pending_payment,payment_received,creative_pending,creative_submitted,creative_revision,creative_approved,scheduled,posted';
            } else if (filter === 'completed') {
                endpoint = '/deals?status=completed';
            }

            const response = await api.get<{ data: Deal[] }>(endpoint);

            if (response.success && response.data) {
                const rawData = response.data as any;
                let dealsData: Deal[] = rawData.data || rawData || [];

                // Client-side filter if status filtering not working
                if (filter === 'active') {
                    dealsData = dealsData.filter((d: Deal) =>
                        !['completed', 'cancelled', 'refunded'].includes(d.status)
                    );
                } else if (filter === 'completed') {
                    dealsData = dealsData.filter((d: Deal) =>
                        ['completed', 'cancelled', 'refunded'].includes(d.status)
                    );
                }

                // Sort by date (newest first)
                dealsData.sort((a, b) =>
                    new Date(b.updatedAt || b.createdAt).getTime() -
                    new Date(a.updatedAt || a.createdAt).getTime()
                );

                setDeals(dealsData);
            }
        } catch (error) {
            console.error('Error loading deals:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>

            <div className="container">
                {/* Filter Tabs */}
                <div className="section">
                    <div className="flex gap-sm">
                        <button
                            className={`btn flex-1 btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFilter('all')}
                        >
                            All
                        </button>
                        <button
                            className={`btn flex-1 btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFilter('active')}
                        >
                            Active
                        </button>
                        <button
                            className={`btn flex-1 btn-sm ${filter === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFilter('completed')}
                        >
                            Completed
                        </button>
                    </div>
                </div>

                {/* Column Headers */}
                {!isLoading && deals.length > 0 && (
                    <div className="deals-columns">
                        <span className="deals-col-channel">Channel</span>
                        <span className="deals-col-price">Price</span>
                        <span className="deals-col-type">Status</span>
                    </div>
                )}

                {/* Results */}
                {isLoading ? (
                    <Loading />
                ) : deals.length === 0 ? (
                    <EmptyState
                        icon={<Icon name="deals" size={48} color="var(--text-muted)" />}
                        title="No deals yet"
                        message={
                            filter === 'all'
                                ? "Start by browsing channels or creating an ad request."
                                : filter === 'active'
                                    ? "No active deals at the moment."
                                    : "No completed deals yet."
                        }
                        action={{
                            label: 'Browse Channels',
                            onClick: () => {
                                hapticFeedback('light');
                                navigate('/channels');
                            }
                        }}
                    />
                ) : (
                    <div className="deals-list">
                        {deals.map(deal => (
                            <DealCard key={deal.id} deal={deal} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Deals;
