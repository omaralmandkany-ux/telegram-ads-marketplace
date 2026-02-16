// Userbot Service - Uses GramJS (MTProto) to fetch real channel statistics
// Bot API cannot access channel analytics; only MTProto can.
// NOTE: All GramJS imports are dynamic to avoid Firebase deployment timeouts

import { Timestamp } from '../firebase';
import { ChannelStats, GraphPoint, FollowerPoint, ViewSharePoint, PostInteraction } from '../types';

// Get a short-lived MTProto client using the stored StringSession
async function getClient(): Promise<any> {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');

    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    const sessionStr = process.env.TELEGRAM_STRING_SESSION || '';

    if (!apiId || !apiHash || !sessionStr) {
        throw new Error('Userbot credentials not configured');
    }

    const session = new StringSession(sessionStr);
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 3,
        useWSS: false,
    });

    await client.connect();
    return client;
}

// Parse a Telegram StatsGraph into usable JSON data
// Handles StatsGraph (has json.data), StatsGraphAsync (needs loading), and StatsGraphError
async function parseGraph(client: any, graph: any): Promise<any | null> {
    const { Api } = await import('telegram');

    if (!graph) return null;

    // StatsGraphError — no data available
    if (graph instanceof Api.StatsGraphError) {
        console.log('StatsGraph error:', graph.error);
        return null;
    }

    // StatsGraphAsync — need to load the data
    if (graph instanceof Api.StatsGraphAsync) {
        try {
            const loaded = await client.invoke(
                new Api.stats.LoadAsyncGraph({ token: graph.token })
            );
            return parseGraph(client, loaded);
        } catch (e: any) {
            console.log('Failed to load async graph:', e.message);
            return null;
        }
    }

    // StatsGraph — has json.data
    if (graph instanceof Api.StatsGraph) {
        try {
            const jsonStr = graph.json?.data;
            if (!jsonStr) return null;
            return JSON.parse(jsonStr);
        } catch (e: any) {
            console.log('Failed to parse graph JSON:', e.message);
            return null;
        }
    }

    // Fallback: try to access json.data directly
    try {
        if (graph.json && graph.json.data) return JSON.parse(graph.json.data);
        if (graph.data) return JSON.parse(graph.data);
    } catch { /* ignore */ }

    return null;
}

// Convert Telegram timestamp (seconds) to ISO date string
function tsToDate(ts: number): string {
    return new Date(ts * 1000).toISOString().split('T')[0];
}

// Extract language chart from parsed graph data
function extractLanguageChart(parsed: any): Record<string, number> | undefined {
    if (!parsed || !parsed.columns || !parsed.names) return undefined;

    const chart: Record<string, number> = {};
    for (let i = 1; i < parsed.columns.length; i++) {
        const colId = parsed.columns[i][0];
        const name = parsed.names[colId] || `lang_${i}`;
        const values = parsed.columns[i].slice(1) as number[];
        const lastValue = values[values.length - 1] || 0;
        if (lastValue > 0) chart[name] = lastValue;
    }
    return Object.keys(chart).length > 0 ? chart : undefined;
}

// Extract growth graph (single-line: subscriber count over time)
function extractGrowthGraph(parsed: any): GraphPoint[] | undefined {
    if (!parsed || !parsed.columns || parsed.columns.length < 2) return undefined;

    const timestamps = parsed.columns[0].slice(1) as number[]; // x-axis
    // Find the "y0" column (total followers)
    let values: number[] | null = null;
    for (let i = 1; i < parsed.columns.length; i++) {
        values = parsed.columns[i].slice(1) as number[];
        break; // take first data column
    }
    if (!values || !timestamps.length) return undefined;

    // Filter to last 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const points: GraphPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const tsMs = timestamps[i]; // Telegram uses milliseconds for x-axis in chart data
        const actualTs = tsMs > 1e12 ? tsMs : tsMs * 1000; // handle both ms and seconds
        if (actualTs >= thirtyDaysAgo) {
            points.push({
                date: new Date(actualTs).toISOString().split('T')[0],
                value: values[i] || 0,
            });
        }
    }
    return points.length > 0 ? points : undefined;
}

// Extract followers joined/left graph (two-line graph)
function extractFollowersGraph(parsed: any): FollowerPoint[] | undefined {
    if (!parsed || !parsed.columns || parsed.columns.length < 3) return undefined;

    const timestamps = parsed.columns[0].slice(1) as number[];
    // Identify joined vs left columns by name
    const names = parsed.names || {};
    let joinedCol: number[] = [];
    let leftCol: number[] = [];

    for (let i = 1; i < parsed.columns.length; i++) {
        const colId = parsed.columns[i][0];
        const colName = (names[colId] || '').toLowerCase();
        const vals = parsed.columns[i].slice(1) as number[];
        if (colName.includes('joined') || colName.includes('new')) {
            joinedCol = vals;
        } else if (colName.includes('left')) {
            leftCol = vals;
        } else if (i === 1) {
            joinedCol = vals; // fallback: first data col = joined
        } else if (i === 2) {
            leftCol = vals; // fallback: second data col = left
        }
    }

    if (!joinedCol.length) return undefined;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const points: FollowerPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const actualTs = timestamps[i] > 1e12 ? timestamps[i] : timestamps[i] * 1000;
        if (actualTs >= thirtyDaysAgo) {
            points.push({
                date: new Date(actualTs).toISOString().split('T')[0],
                joined: joinedCol[i] || 0,
                left: Math.abs(leftCol[i] || 0),
            });
        }
    }
    return points.length > 0 ? points : undefined;
}

// Extract views & shares graph
function extractViewsSharesGraph(parsed: any): ViewSharePoint[] | undefined {
    if (!parsed || !parsed.columns || parsed.columns.length < 2) return undefined;

    const timestamps = parsed.columns[0].slice(1) as number[];
    const names = parsed.names || {};
    let viewsCol: number[] = [];
    let sharesCol: number[] = [];

    for (let i = 1; i < parsed.columns.length; i++) {
        const colId = parsed.columns[i][0];
        const colName = (names[colId] || '').toLowerCase();
        const vals = parsed.columns[i].slice(1) as number[];
        if (colName.includes('view')) {
            viewsCol = vals;
        } else if (colName.includes('share')) {
            sharesCol = vals;
        } else if (i === 1) {
            viewsCol = vals;
        } else if (i === 2) {
            sharesCol = vals;
        }
    }

    if (!viewsCol.length) return undefined;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const points: ViewSharePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const actualTs = timestamps[i] > 1e12 ? timestamps[i] : timestamps[i] * 1000;
        if (actualTs >= thirtyDaysAgo) {
            points.push({
                date: new Date(actualTs).toISOString().split('T')[0],
                views: viewsCol[i] || 0,
                shares: sharesCol[i] || 0,
            });
        }
    }
    return points.length > 0 ? points : undefined;
}

// Extract new member source breakdown (multi-column bar chart → aggregate)
function extractMemberSources(parsed: any): Record<string, number> | undefined {
    if (!parsed || !parsed.columns || !parsed.names) return undefined;

    const sources: Record<string, number> = {};
    for (let i = 1; i < parsed.columns.length; i++) {
        const colId = parsed.columns[i][0];
        const name = parsed.names[colId] || `source_${i}`;
        const values = parsed.columns[i].slice(1) as number[];
        // Sum all values for total from this source
        const total = values.reduce((s: number, v: number) => s + v, 0);
        if (total > 0) sources[name] = total;
    }
    return Object.keys(sources).length > 0 ? sources : undefined;
}

// Extract views-by-hour distribution (24 values, one per hour)
function extractViewsByHour(parsed: any): number[] | undefined {
    if (!parsed || !parsed.columns || parsed.columns.length < 2) return undefined;

    // The views-by-hour graph typically has columns: ["x", 0..23], ["y0", v0..v23]
    for (let i = 1; i < parsed.columns.length; i++) {
        const vals = parsed.columns[i].slice(1) as number[];
        if (vals.length >= 24) {
            return vals.slice(0, 24);
        }
    }
    return undefined;
}

// Extract StatsPercentValue (e.g. enabled_notifications)
function extractPercentValue(statVal: any): number | undefined {
    if (!statVal) return undefined;
    // StatsPercentValue has .part and .total
    if (statVal.part !== undefined && statVal.total !== undefined && statVal.total > 0) {
        return Math.round((statVal.part / statVal.total) * 100);
    }
    // Or direct percentage
    if (typeof statVal === 'number') return statVal;
    return undefined;
}

// Fetch full channel statistics using MTProto
export async function fetchFullChannelStats(channelId: number): Promise<ChannelStats> {
    const { Api } = await import('telegram');
    let client: any = null;

    try {
        client = await getClient();

        // Resolve the channel entity
        const entity = await client.getEntity(channelId);
        if (!(entity instanceof Api.Channel)) {
            throw new Error('Not a channel');
        }

        // Get full channel info
        const fullChannel = await client.invoke(
            new Api.channels.GetFullChannel({ channel: entity })
        );
        const full = fullChannel.fullChat as any;
        const subscribers = full.participantsCount || 0;

        // Fetch recent messages to calculate real average views
        const messages = await client.invoke(
            new Api.messages.GetHistory({
                peer: entity,
                limit: 50,
                offsetId: 0,
                offsetDate: 0,
                addOffset: 0,
                maxId: 0,
                minId: 0,
                hash: BigInt(0) as any,
            })
        );

        let totalViews = 0;
        let postCount = 0;
        const recentPosts: PostInteraction[] = [];

        if ('messages' in messages) {
            for (const msg of messages.messages) {
                if (msg instanceof Api.Message && msg.views) {
                    totalViews += msg.views;
                    postCount++;
                    if (recentPosts.length < 20) {
                        recentPosts.push({
                            msgId: msg.id,
                            views: msg.views || 0,
                            forwards: msg.forwards || 0,
                        });
                    }
                }
            }
        }

        const avgViews = postCount > 0 ? Math.round(totalViews / postCount) : 0;
        const avgReach = Math.round(avgViews * 0.85);

        // Initialize optional fields
        let premiumSubscribers: number | undefined;
        let languageChart: Record<string, number> | undefined;
        let growthGraph: GraphPoint[] | undefined;
        let followersGraph: FollowerPoint[] | undefined;
        let viewsSharesGraph: ViewSharePoint[] | undefined;
        let newMemberSources: Record<string, number> | undefined;
        let viewsByHour: number[] | undefined;
        let enabledNotifications: number | undefined;

        // Try to get broadcast stats for all graphs
        try {
            console.log(`Fetching broadcast stats for channel ${channelId} (${subscribers} subs)...`);
            const stats = await client.invoke(
                new Api.stats.GetBroadcastStats({
                    channel: entity,
                    dark: false,
                })
            );

            if (stats) {
                console.log('Broadcast stats received. Graphs:', {
                    growthGraph: stats.growthGraph?.className,
                    followersGraph: stats.followersGraph?.className,
                    muteGraph: stats.muteGraph?.className,
                    viewsBySourceGraph: stats.viewsBySourceGraph?.className,
                    newFollowersBySourceGraph: stats.newFollowersBySourceGraph?.className,
                    languagesGraph: stats.languagesGraph?.className,
                    interactionsGraph: stats.interactionsGraph?.className,
                    viewsByHourGraph: stats.ivInteractionsGraph?.className,
                });

                // 1. Growth graph (subscriber count over time)
                const growthData = await parseGraph(client, stats.growthGraph);
                if (growthData) {
                    growthGraph = extractGrowthGraph(growthData);
                    console.log('Growth graph:', growthGraph?.length, 'points');
                }

                // 2. Followers joined/left
                const followersData = await parseGraph(client, stats.followersGraph);
                if (followersData) {
                    followersGraph = extractFollowersGraph(followersData);
                    console.log('Followers graph:', followersGraph?.length, 'points');
                }

                // 3. Views & Shares (interactions graph)
                const interactionsData = await parseGraph(client, stats.interactionsGraph);
                if (interactionsData) {
                    viewsSharesGraph = extractViewsSharesGraph(interactionsData);
                    console.log('Views/Shares graph:', viewsSharesGraph?.length, 'points');
                }

                // 4. Views by source → also try as views+shares
                const viewsBySourceData = await parseGraph(client, stats.viewsBySourceGraph);
                if (viewsBySourceData && !viewsSharesGraph) {
                    viewsSharesGraph = extractViewsSharesGraph(viewsBySourceData);
                }

                // 5. New member sources
                const memberSourceData = await parseGraph(client, stats.newFollowersBySourceGraph);
                if (memberSourceData) {
                    newMemberSources = extractMemberSources(memberSourceData);
                    console.log('Member sources:', newMemberSources);
                }

                // 6. Language distribution
                const langData = await parseGraph(client, stats.languagesGraph);
                if (langData) {
                    languageChart = extractLanguageChart(langData);
                    console.log('Language chart:', languageChart);
                }

                // 7. Views by hour
                const viewsByHourData = await parseGraph(client, stats.topHoursGraph);
                if (viewsByHourData) {
                    viewsByHour = extractViewsByHour(viewsByHourData);
                    console.log('Views by hour:', viewsByHour?.length, 'hours');
                }

                // 8. Enabled notifications percentage
                enabledNotifications = extractPercentValue(stats.enabledNotifications);

                // 9. Recent post interactions from stats
                if (stats.recentMessageInteractions?.length) {
                    for (const interaction of stats.recentMessageInteractions) {
                        const existing = recentPosts.find(p => p.msgId === interaction.msgId);
                        if (existing) {
                            existing.views = interaction.views || existing.views;
                            existing.forwards = interaction.forwards || existing.forwards;
                        }
                    }
                }
            }
        } catch (statsError: any) {
            console.log('GetBroadcastStats failed:', statsError?.message);
            if (statsError?.errorMessage) {
                console.log('Telegram error:', statsError.errorMessage);
            }
        }

        const result: ChannelStats = {
            subscribers,
            avgViews,
            avgReach,
            lastUpdated: Timestamp.now(),
        };

        // Only add optional fields if they have values (Firestore doesn't like undefined)
        if (premiumSubscribers !== undefined) result.premiumSubscribers = premiumSubscribers;
        if (languageChart) result.languageChart = languageChart;
        if (growthGraph) result.growthGraph = growthGraph;
        if (followersGraph) result.followersGraph = followersGraph;
        if (viewsSharesGraph) result.viewsSharesGraph = viewsSharesGraph;
        if (newMemberSources) result.newMemberSources = newMemberSources;
        if (viewsByHour) result.viewsByHour = viewsByHour;
        if (recentPosts.length > 0) result.recentPosts = recentPosts;
        if (enabledNotifications !== undefined) result.enabledNotifications = enabledNotifications;

        return result;
    } finally {
        if (client) {
            await client.disconnect();
        }
    }
}

// Check if userbot credentials are configured
export function isUserbotConfigured(): boolean {
    return !!(
        process.env.TELEGRAM_API_ID &&
        process.env.TELEGRAM_API_HASH &&
        process.env.TELEGRAM_STRING_SESSION
    );
}
