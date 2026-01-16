import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey } from '$lib/server/games/mines';
import { validateBetAmount } from '$lib/utils';
import { randomBytes } from 'crypto';
import type { RequestHandler } from './$types';

// Fisher-Yates shuffle with crypto randomness for mine positions
function generateMinePositions(mineCount: number): number[] {
    const tiles = Array.from({ length: 25 }, (_, i) => i);
    const bytes = randomBytes(25);
    
    // Fisher-Yates shuffle using crypto random bytes
    for (let i = tiles.length - 1; i > 0; i--) {
        const j = bytes[i] % (i + 1);
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    
    return tiles.slice(0, mineCount);
}

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    try {
        const { betAmount, mineCount } = await request.json();
        const userId = Number(session.user.id);

        if (!mineCount || mineCount < 3 || mineCount > 24) {
            return json({ error: 'Invalid mine count' }, { status: 400 });
        }

        const roundedBet = validateBetAmount(betAmount);

        const result = await db.transaction(async (tx) => {
            const [userData] = await tx
                .select({ baseCurrencyBalance: user.baseCurrencyBalance })
                .from(user)
                .where(eq(user.id, userId))
                .for('update')
                .limit(1);

            const currentBalance = Number(userData.baseCurrencyBalance);
            const roundedBalance = Math.round(currentBalance * 100000000) / 100000000;

            if (roundedBet > roundedBalance) {
                throw new Error(`Insufficient funds. You need $${roundedBet.toFixed(2)} but only have $${roundedBalance.toFixed(2)}`);
            }

            // Generate mine positions with crypto randomness
            const minePositions = generateMinePositions(mineCount);

            // Generate session token with crypto
            const sessionToken = randomBytes(16).toString('hex');
            const now = Date.now();
            const newBalance = roundedBalance - roundedBet;

            // Store game state in Redis with 1 hour expiry
            await redis.set(
                getSessionKey(sessionToken),
                JSON.stringify({
                    betAmount: roundedBet,
                    mineCount,
                    minePositions,
                    revealedTiles: [],
                    startTime: now,
                    currentMultiplier: 1,
                    status: 'active',
                    userId
                }),
                { EX: 3600 }
            );

            // Update user balance
            await tx
                .update(user)
                .set({
                    baseCurrencyBalance: newBalance.toFixed(8),
                    updatedAt: new Date()
                })
                .where(eq(user.id, userId));

            return { sessionToken, newBalance };
        });

        return json(result);
    } catch (e) {
        console.error('Mines start error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};