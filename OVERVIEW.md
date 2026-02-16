# Telegram Ads Marketplace - Project Overview

## Introduction

This document provides a technical overview of the Telegram Ads Marketplace, a Mini App that connects Telegram channel owners with advertisers through a secure escrow-based deal flow.

## System Design

### Core Concepts

1. **Dual-Entry Marketplace**
   - Channel owners list their channels with pricing
   - Advertisers create campaign requests
   - Both entry points converge into a unified deal workflow

2. **Escrow Payment Flow**
   - Unique TON wallet generated per deal
   - Funds held until post is verified
   - Automatic release on successful delivery
   - Refund on timeout/dispute

3. **Creative Approval Workflow**
   - Advertiser provides brief/preferences
   - Channel owner creates and submits creative
   - Advertiser approves or requests changes
   - Auto-posting on approval

### Key Design Decisions

#### 1. Firebase as Backend
**Rationale**: Firebase provides:
- Serverless Cloud Functions (no infrastructure management)
- Firestore (real-time NoSQL database)
- Hosting (static files + CDN)
- Built-in authentication support
- Easy scaling

**Trade-offs**: 
- Vendor lock-in
- Limited query capabilities vs SQL
- Cold start latency

#### 2. Per-Deal Escrow Wallets
**Rationale**: 
- Each deal gets its own wallet for clear fund tracking
- Easier audit trail
- Reduces risk of fund mixing

**Trade-offs**:
- More wallet management overhead
- Small dust amounts may remain in wallets

#### 3. Telegram Bot for Messaging
**Rationale**: 
- Leverage Telegram's native notification system
- Users already in Telegram ecosystem
- No need to build in-app notification system

**Trade-offs**:
- Messaging tied to bot, not mini app
- Rate limits apply

#### 4. Simplified Post Verification
**Current Approach**: Check if post exists via message ID
**Limitations**: Cannot easily detect content modifications
**Future**: Store content hash, use channel webhook for edit detection

### Security Considerations

1. **Admin Verification**: Re-check channel admin status before financial operations
2. **Init Data Validation**: Verify Telegram WebApp hash on all API calls
3. **Encrypted Keys**: Private keys encrypted at rest in Firestore
4. **Firestore Rules**: Strict read/write access based on user roles

### Scalability Notes

- Firestore scales automatically
- Cloud Functions scale per request
- Scheduled functions run on fixed intervals
- Consider Pub/Sub for high-volume payment monitoring

## Data Model

### Collections

| Collection | Purpose |
|------------|---------|
| users | User profiles and wallet addresses |
| channels | Registered channels with stats and pricing |
| adRequests | Advertiser campaign briefs |
| deals | Deal lifecycle and state |
| wallets | Encrypted wallet keys and balances |

### Deal States

```
pending_payment → payment_received → creative_pending → 
creative_submitted → creative_approved → scheduled → 
posted → verified → completed
```

## Known Limitations

1. **Channel Statistics (500+ subs)**: Telegram's `stats.GetBroadcastStats` API requires channels with 500+ subscribers. Channels below this threshold will only show basic stats (subscribers, avg views, ERR, recent posts) via Bot API fallback.

2. **MTProto Userbot**: We use a personal Telegram account via GramJS (MTProto) to fetch verified channel analytics. This requires a valid `TELEGRAM_STRING_SESSION`. The userbot account (@PHo_iraq) must be added as admin to channels.

3. **Rate Limits**: Telegram Bot API has rate limits. Heavy usage may require:
   - Request queuing
   - Multiple bot instances

4. **TON Integration**: Uses TON Center API. For production, consider:
   - Running own TON node
   - Using TON Access for better reliability
   - Implementing smart contract escrow
 

## Deployment Checklist

- [ ] Create Firebase project
- [ ] Enable Firestore
- [ ] Deploy Firestore indexes
- [ ] Configure Functions environment
- [ ] Deploy Functions
- [ ] Build and deploy webapp
- [ ] Set bot webhook
- [ ] Test end-to-end flow
- [ ] Configure TON for mainnet

## Future Roadmap

### Phase 1 (Current MVP)
- ✅ Channel registration
- ✅ Ad request creation
- ✅ Deal workflow
- ✅ Escrow payments
- ✅ Auto-posting
- ✅ Basic verification

### Phase 2
- [x] Enhanced analytics via MTProto (growth, followers, views/shares, language, member sources, views by hour)
- [x] Userbot integration for verified channel statistics
- [ ] Rating system
- [ ] Multi-media support
- [ ] Smart contract escrow

### Phase 3
- [ ] API for external integrations
- [ ] Bulk operations
- [ ] Advanced reporting
- [ ] Mobile app (optional)

## Contact

For questions or support, reach out via Telegram or open an issue on GitHub.
