// Deal Card Component - Redesigned list view with channel info and activity

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Deal } from '../lib/api';
import Icon from './Icon';
import './DealCard.css';

interface DealCardProps {
    deal: Deal;
}

function DealCard({ deal }: DealCardProps) {
    const [imageError, setImageError] = useState(false);

    // Get channel name and first letter for avatar
    const channelName = deal.channel?.title || deal.channel?.username || `Deal #${deal.id.slice(0, 6)}`;
    const channelUsername = deal.channel?.username ? `@${deal.channel.username}` : `#${deal.id.slice(0, 6)}`;
    const avatarLetter = channelName.charAt(0).toUpperCase();
    const channelPhoto = deal.channel?.photoUrl;

    // Format the date with time - handle Firestore Timestamp and string
    const formatDateTime = (dateInput: any) => {
        if (!dateInput) return '';

        let date: Date;

        // Handle Firestore Timestamp
        if (dateInput && typeof dateInput === 'object' && dateInput._seconds) {
            date = new Date(dateInput._seconds * 1000);
        } else if (dateInput && typeof dateInput === 'object' && dateInput.seconds) {
            date = new Date(dateInput.seconds * 1000);
        } else if (dateInput && typeof dateInput.toDate === 'function') {
            date = dateInput.toDate();
        } else {
            date = new Date(dateInput);
        }

        // Check if date is valid
        if (isNaN(date.getTime())) {
            return '';
        }

        const day = date.getDate();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getMonth()];
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${day} ${month} ${hours}:${minutes}:${seconds}`;
    };

    // Get activity color based on status
    const getActivityColor = () => {
        if (['completed', 'verified', 'posted'].includes(deal.status)) return 'activity-success';
        if (['cancelled', 'refunded', 'disputed'].includes(deal.status)) return 'activity-danger';
        if (['pending_payment', 'creative_pending'].includes(deal.status)) return 'activity-warning';
        return 'activity-info';
    };

    // Get activity label
    const getActivityLabel = () => {
        const labels: Record<string, string> = {
            pending_payment: 'Payment Pending',
            payment_received: 'Funded',
            creative_pending: 'Awaiting Creative',
            creative_submitted: 'Creative Review',
            creative_approved: 'Approved',
            scheduled: 'Scheduled',
            posted: 'Posted',
            completed: 'Completed',
            cancelled: 'Cancelled',
            refunded: 'Refunded',
            disputed: 'Disputed'
        };
        return labels[deal.status] || deal.status;
    };

    return (
        <Link to={`/deals/${deal.id}`} className="deal-item">
            {/* Channel Avatar */}
            <div className="deal-avatar">
                {channelPhoto && !imageError ? (
                    <img
                        src={channelPhoto}
                        alt={channelName}
                        className="deal-avatar-img"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    avatarLetter
                )}
            </div>

            {/* Channel Info */}
            <div className="deal-info">
                <div className="deal-channel-name">{channelName}</div>
                <div className="deal-channel-username">{channelUsername}</div>
            </div>

            {/* Price */}
            <div className="deal-price">
                <span className="deal-price-amount">
                    <Icon name="ton" size={14} color="var(--accent-color)" />
                    {deal.amount}
                </span>
                <span className="deal-price-time">{formatDateTime(deal.updatedAt || deal.createdAt)}</span>
            </div>

            {/* Activity Type */}
            <div className={`deal-activity ${getActivityColor()}`}>
                {getActivityLabel()}
            </div>

            {/* Arrow */}
            <div className="deal-arrow">
                <Icon name="chevronRight" size={18} color="var(--text-muted)" />
            </div>
        </Link>
    );
}

export default DealCard;

