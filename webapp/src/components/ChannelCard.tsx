// Channel Card Component

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Channel, formatNumber } from '../lib/api';
import Icon from './Icon';

interface ChannelCardProps {
    channel: Channel;
    showPrice?: boolean;
}

function ChannelCard({ channel, showPrice = true }: ChannelCardProps) {
    const [imageError, setImageError] = useState(false);

    // Get first letter for avatar fallback
    const avatarLetter = (channel.title || channel.username || 'C')[0].toUpperCase();

    // Show photo only if exists and no error
    const showPhoto = channel.photoUrl && !imageError;

    return (
        <Link to={`/channels/${channel.id}`} className="card card-clickable channel-card">
            {showPhoto ? (
                <img
                    src={channel.photoUrl}
                    alt={channel.title}
                    className="channel-avatar"
                    style={{ objectFit: 'cover' }}
                    onError={() => setImageError(true)}
                />
            ) : (
                <div className="channel-avatar">{avatarLetter}</div>
            )}

            <div className="channel-info">
                <div className="channel-name">{channel.title}</div>
                {channel.username && (
                    <div className="channel-username">@{channel.username}</div>
                )}

                <div className="channel-stats">
                    <span><Icon name="users" size={14} /> {formatNumber(channel.stats.subscribers)}</span>
                    {!channel.botIsAdmin && (
                        <span className="text-warning"><Icon name="warning" size={14} /> Bot not admin</span>
                    )}
                </div>

                {showPrice && channel.pricing.post && (
                    <div className="mt-sm">
                        <span className="price-tag price-tag-ton">
                            <Icon name="ton" size={14} /> {channel.pricing.post.price} TON
                        </span>
                    </div>
                )}
            </div>
        </Link>
    );
}

export default ChannelCard;
