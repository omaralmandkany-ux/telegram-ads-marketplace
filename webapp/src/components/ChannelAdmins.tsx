// Channel Admins Management Component

import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import Icon from './Icon';

interface AdminPermissions {
    canPostMessages: boolean;
    canDeleteMessages: boolean;
    canEditMessages: boolean;
    canManageChat: boolean;
    canRestrictMembers: boolean;
    canPromoteMembers: boolean;
}

interface ChannelAdmin {
    userId: string;
    telegramId: number;
    username?: string;
    firstName: string;
    lastName?: string;
    role: 'creator' | 'admin';
    permissions: AdminPermissions;
    syncedAt: any;
}

interface ChannelAdminsProps {
    channelId: string;
    adminDetails?: ChannelAdmin[];
    onSync?: () => void;
}

function ChannelAdmins({ channelId, adminDetails = [], onSync }: ChannelAdminsProps) {
    const { showError, showSuccess } = useToast();
    const [isSyncing, setIsSyncing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [admins, setAdmins] = useState<ChannelAdmin[]>(adminDetails);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const response = await api.post<any>(`/channels/${channelId}/admins/sync`);
            if (response.success && response.data) {
                setAdmins(response.data.adminDetails || []);
                showSuccess(`Synced ${response.data.totalAdmins} admins (${response.data.registeredUsers} registered users)`);
                onSync?.();
            } else {
                showError(response.error || 'Failed to sync admins');
            }
        } catch (error: any) {
            showError(error.message || 'Failed to sync admins');
        } finally {
            setIsSyncing(false);
        }
    };

    const getRoleBadge = (role: string) => {
        if (role === 'creator') {
            return <span className="badge badge-success"><Icon name="starFilled" size={12} /> Owner</span>;
        }
        return <span className="badge badge-info"><Icon name="shield" size={12} /> Admin</span>;
    };

    const getRegistrationStatus = (userId: string) => {
        if (userId) {
            return <span className="badge badge-success" style={{ fontSize: '10px' }}><Icon name="check" size={10} /> Registered</span>;
        }
        return <span className="badge badge-warning" style={{ fontSize: '10px' }}>Not registered</span>;
    };

    return (
        <div className="card">
            <div
                className="flex justify-between items-center"
                onClick={() => setIsExpanded(!isExpanded)}
                style={{ cursor: 'pointer' }}
            >
                <div className="flex items-center gap-sm">
                    <Icon name="users" size={20} />
                    <span className="font-semibold">Channel Admins</span>
                    <span className="badge badge-secondary">{admins.length}</span>
                </div>
                <Icon name={isExpanded ? 'arrowDown' : 'arrowRight'} size={16} />
            </div>

            {isExpanded && (
                <div className="mt-md">
                    {/* Sync Button */}
                    <button
                        className="btn btn-secondary btn-sm btn-block mb-md"
                        onClick={handleSync}
                        disabled={isSyncing}
                    >
                        {isSyncing ? (
                            <><Icon name="loader" size={14} /> Syncing...</>
                        ) : (
                            <><Icon name="refresh" size={14} /> Sync from Telegram</>
                        )}
                    </button>

                    {/* Admin List */}
                    {admins.length === 0 ? (
                        <div className="text-center text-secondary py-md">
                            <p>No admins synced yet.</p>
                            <p className="text-sm">Click "Sync from Telegram" to fetch admins.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-sm">
                            {admins.map((admin, index) => (
                                <div
                                    key={admin.telegramId || index}
                                    className="card"
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        background: 'var(--color-bg-secondary)'
                                    }}
                                >
                                    <div className="flex justify-between items-center mb-xs">
                                        <div className="flex items-center gap-sm">
                                            <span className="font-medium">
                                                {admin.firstName} {admin.lastName || ''}
                                            </span>
                                            {getRoleBadge(admin.role)}
                                        </div>
                                        {getRegistrationStatus(admin.userId)}
                                    </div>

                                    {admin.username && (
                                        <div className="text-sm text-secondary">
                                            @{admin.username}
                                        </div>
                                    )}

                                    {/* Permissions */}
                                    <div className="flex flex-wrap gap-xs mt-sm">
                                        {admin.permissions.canPostMessages && (
                                            <span className="badge" style={{ fontSize: '10px', padding: '2px 6px' }}><Icon name="post" size={10} /> Post</span>
                                        )}
                                        {admin.permissions.canDeleteMessages && (
                                            <span className="badge" style={{ fontSize: '10px', padding: '2px 6px' }}><Icon name="trash" size={10} /> Delete</span>
                                        )}
                                        {admin.permissions.canEditMessages && (
                                            <span className="badge" style={{ fontSize: '10px', padding: '2px 6px' }}><Icon name="edit" size={10} /> Edit</span>
                                        )}
                                        {admin.permissions.canManageChat && (
                                            <span className="badge" style={{ fontSize: '10px', padding: '2px 6px' }}><Icon name="gear" size={10} /> Manage</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Info */}
                    <p className="text-xs text-muted mt-md">
                        <Icon name="info" size={12} /> Only registered users can manage deals. Sync regularly to keep admin list updated.
                    </p>
                </div>
            )}
        </div>
    );
}

export default ChannelAdmins;
