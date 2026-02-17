// TON Wallet Service - handles all TON blockchain operations

import TonWeb from 'tonweb';
import { config, tonAmounts, collections } from '../config';
import { db, Timestamp } from '../firebase';
import { Wallet } from '../types';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

// Lazy initialize TonWeb to prevent deployment timeout
let _tonweb: any = null;
function getTonWeb(): any {
    if (!_tonweb) {
        _tonweb = new TonWeb(
            new TonWeb.HttpProvider(
                config.tonNetwork === 'mainnet'
                    ? 'https://toncenter.com/api/v2/jsonRPC'
                    : 'https://testnet.toncenter.com/api/v2/jsonRPC',
                { apiKey: config.tonApiKey }
            )
        );
    }
    return _tonweb;
}

// Simple encryption for storing private keys
// In production, use Firebase Secret Manager or KMS
const RAW_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-32bytes!!';
// Derive a proper 32-byte key using SHA-256 hash (handles any input length)
const ENCRYPTION_KEY = crypto.createHash('sha256').update(RAW_ENCRYPTION_KEY).digest();

function encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift()!, 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

// Generate a new wallet
export async function generateWallet(ownerId: string, type: 'user' | 'deal'): Promise<Wallet> {
    try {
        const tonweb = getTonWeb();
        // Generate new key pair
        const keyPair = TonWeb.utils.nacl.sign.keyPair();

        // Create wallet
        const WalletClass = tonweb.wallet.all.v4R2;
        const wallet = new WalletClass(tonweb.provider, {
            publicKey: keyPair.publicKey,
        });

        const address = await wallet.getAddress();
        // Use NON-BOUNCEABLE format (UQ prefix) for escrow wallets
        // Bounceable (EQ) addresses bounce payments back if contract isn't deployed!
        const addressString = address.toString(true, true, false);

        // Create wallet record
        const walletDoc: Wallet = {
            id: uuidv4(),
            type,
            ownerId,
            address: addressString,
            publicKey: TonWeb.utils.bytesToHex(keyPair.publicKey),
            encryptedSecretKey: encrypt(TonWeb.utils.bytesToHex(keyPair.secretKey)),
            balance: 0,
            createdAt: Timestamp.now(),
        };

        // Save to Firestore
        await db.collection(collections.wallets).doc(walletDoc.id).set(walletDoc);

        return walletDoc;
    } catch (error) {
        console.error('Error generating wallet:', error);
        throw new Error('Failed to generate wallet');
    }
}

// Get wallet balance
export async function getWalletBalance(address: string): Promise<number> {
    try {
        const tonweb = getTonWeb();
        const balance = await tonweb.getBalance(address);
        // Convert from nanoTON to TON
        return parseFloat(TonWeb.utils.fromNano(balance));
    } catch (error) {
        console.error('Error getting wallet balance:', error);
        return 0;
    }
}

// Check for incoming transaction
export async function checkIncomingPayment(
    address: string,
    expectedAmount: number,
    sinceTimestamp: number
): Promise<{ received: boolean; amount: number; txHash?: string }> {
    try {
        const tonweb = getTonWeb();
        const transactions = await tonweb.provider.getTransactions(address, 10);

        for (const tx of transactions) {
            const txTime = tx.utime * 1000;
            if (txTime < sinceTimestamp) continue;

            // Check if it's an incoming transaction
            if (tx.in_msg && tx.in_msg.value) {
                const amount = parseFloat(TonWeb.utils.fromNano(tx.in_msg.value));

                // Allow 1% tolerance for amount
                if (amount >= expectedAmount * 0.99) {
                    return {
                        received: true,
                        amount,
                        txHash: tx.transaction_id?.hash,
                    };
                }
            }
        }

        return { received: false, amount: 0 };
    } catch (error) {
        console.error('Error checking incoming payment:', error);
        return { received: false, amount: 0 };
    }
}

// Send TON from wallet
export async function sendTon(
    fromWalletId: string,
    toAddress: string,
    amount: number,
    comment?: string,
    sendAll: boolean = false
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        const tonweb = getTonWeb();
        // Get wallet from Firestore
        const walletDoc = await db.collection(collections.wallets).doc(fromWalletId).get();
        if (!walletDoc.exists) {
            return { success: false, error: 'Wallet not found' };
        }

        const wallet = walletDoc.data() as Wallet;

        // Decrypt secret key
        const secretKeyHex = decrypt(wallet.encryptedSecretKey);
        const secretKey = TonWeb.utils.hexToBytes(secretKeyHex);
        const publicKey = TonWeb.utils.hexToBytes(wallet.publicKey);

        const keyPair = { publicKey, secretKey };

        // Create wallet instance
        const WalletClass = tonweb.wallet.all.v4R2;
        const walletInstance = new WalletClass(tonweb.provider, {
            publicKey: keyPair.publicKey,
        });

        // Get seqno - handle undeployed wallets gracefully
        let seqno = 0;
        try {
            const result = await walletInstance.methods.seqno().call();
            seqno = result || 0;
        } catch (e) {
            console.log('Wallet not yet deployed on-chain, using seqno 0 (will deploy with first tx)');
            seqno = 0;
        }

        // sendMode: 
        // 3 = pay fees separately + ignore errors (for normal transfers)
        // 128+32 = send ALL remaining balance + destroy account (for last transfer)
        const sendMode = sendAll ? (128 + 32) : 3;

        // Create transfer
        // Round to 9 decimal places (nanoTON) to avoid floating point errors like 0.039999999999999994
        const safeAmount = sendAll ? '0' : parseFloat(amount.toFixed(9)).toString();
        const transfer = walletInstance.methods.transfer({
            secretKey: keyPair.secretKey,
            toAddress,
            amount: TonWeb.utils.toNano(safeAmount),
            seqno,
            payload: comment,
            sendMode,
        });

        // Send transaction
        const result = await transfer.send();
        console.log(`TON transfer sent: ${amount} TON to ${toAddress}, seqno=${seqno}, sendAll=${sendAll}, result:`, result);

        // Get transaction hash (simplified)
        const txHash = `tx_${Date.now()}`;

        return { success: true, txHash };
    } catch (error: any) {
        console.error('Error sending TON:', error);
        return { success: false, error: error.message || 'Failed to send TON' };
    }
}

// Calculate platform fee
export function calculateFee(amount: number): number {
    return amount * (tonAmounts.platformFeePercent / 100);
}

// Get amount after fee
export function getAmountAfterFee(amount: number): number {
    return amount - calculateFee(amount);
}

// Release escrow funds to channel owner and platform fee to platform wallet
export async function releaseEscrow(
    dealId: string,
    escrowWalletId: string,
    recipientAddress: string,
    amount: number
): Promise<{ success: boolean; error?: string }> {
    const amountAfterFee = getAmountAfterFee(amount);
    const feeAmount = calculateFee(amount);

    // Step 1: Send payment to channel owner (amount minus fee minus gas reserve)
    const gasReserve = 0.01; // Reserve ~0.01 TON for second transfer gas (actual cost ~0.005)
    const channelOwnerAmount = amountAfterFee - gasReserve;

    const paymentResult = await sendTon(
        escrowWalletId,
        recipientAddress,
        channelOwnerAmount,
        `Payment for deal ${dealId}`
    );

    if (!paymentResult.success) {
        console.error(`Failed to send payment to channel owner for deal ${dealId}:`, paymentResult.error);
        return paymentResult;
    }

    // Step 2: Send ALL remaining balance (platform fee + gas leftover) to platform wallet
    if (tonAmounts.platformWalletAddress) {
        // Wait for seqno to increment on blockchain
        await new Promise(resolve => setTimeout(resolve, 30000));

        const feeResult = await sendTon(
            escrowWalletId,
            tonAmounts.platformWalletAddress,
            0, // Amount ignored when sendAll=true
            `Platform fee for deal ${dealId}`,
            true // sendAll = true: sends ALL remaining and destroys wallet
        );

        if (!feeResult.success) {
            console.error(`Failed to send platform fee for deal ${dealId}:`, feeResult.error);
        }
    }

    // Update deal status
    await db.collection(collections.deals).doc(dealId).update({
        status: 'completed',
        platformFee: feeAmount,
        updatedAt: Timestamp.now(),
    });

    return { success: true };
}

// Refund escrow to advertiser
export async function refundEscrow(
    dealId: string,
    escrowWalletId: string,
    advertiserAddress: string,
    amount: number
): Promise<{ success: boolean; error?: string }> {
    // Use sendAll=true to send ALL balance back and destroy the escrow wallet
    // This avoids issues where exact amount != actual balance (due to fees)
    const result = await sendTon(
        escrowWalletId,
        advertiserAddress,
        0, // Amount ignored when sendAll=true
        `Refund for deal ${dealId}`,
        true // sendAll = true: sends ALL remaining balance and destroys wallet
    );

    if (result.success) {
        // Update deal status
        await db.collection(collections.deals).doc(dealId).update({
            status: 'refunded',
            updatedAt: Timestamp.now(),
        });
    }

    return result;
}

// Format TON address for display
export function formatAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Validate TON address
export function isValidTonAddress(address: string): boolean {
    try {
        // Basic validation
        return address.length >= 48 && (address.startsWith('EQ') || address.startsWith('UQ') || address.startsWith('0:'));
    } catch {
        return false;
    }
}
