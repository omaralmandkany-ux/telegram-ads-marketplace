// Session Generator - Run this script ONCE to generate a StringSession for the userbot
// Usage: npx ts-node scripts/generate-session.ts

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function question(q: string): Promise<string> {
    return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
    console.log('=== Telegram UserBot Session Generator ===\n');

    const apiId = parseInt(await question('Enter API ID: '));
    const apiHash = await question('Enter API Hash: ');

    const session = new StringSession('');
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 3,
    });

    await client.start({
        phoneNumber: async () => await question('Enter phone number: '),
        password: async () => await question('Enter 2FA password (if any): '),
        phoneCode: async () => await question('Enter the code you received: '),
        onError: (err) => console.error('Error:', err),
    });

    console.log('\n✅ Login successful!\n');
    console.log('Your StringSession (save this in .env as TELEGRAM_STRING_SESSION):');
    console.log('\n' + client.session.save() + '\n');

    // Test it works
    const me = await client.getMe();
    console.log(`Logged in as: ${(me as any).firstName} ${(me as any).lastName || ''} (@${(me as any).username || 'N/A'})`);

    await client.disconnect();
    rl.close();
}

main().catch(console.error);
