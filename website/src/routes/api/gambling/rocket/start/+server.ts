import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey, generateCrashPoint } from '$lib/server/games/rocket';
import { validateBetAmount } from '$lib/utils';
import { randomBytes } from 'crypto';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    try {
        const { betAmount } = await request.json();
        const userId = Number(session.user.id);

        // Validate bet amount on backend
        if (typeof betAmount !== 'number' || isNaN(betAmount) || !isFinite(betAmount)) {
            return json({ error: 'Invalid bet amount' }, { status: 400 });
        }

        if (betAmount <= 0) {
            return json({ error: 'Bet amount must be greater than 0' }, { status: 400 });
        }

        const MAX_BET = 1000000;
        if (betAmount > MAX_BET) {
            return json({ error: `Maximum bet amount is ${MAX_BET.toLocaleString()}` }, { status: 400 });
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

            // Generate crash point with cryptographically secure randomness
            const crashPoint = generateCrashPoint(0.01); // 1% house edge

            // Generate session token with crypto
            const sessionToken = randomBytes(16).toString('hex');
            const now = Date.now();
            const newBalance = roundedBalance - roundedBet;

            // Store game state in Redis with 1 hour expiry
            await redis.set(
                getSessionKey(sessionToken),
                JSON.stringify({
                    sessionToken,
                    betAmount: roundedBet,
                    crashPoint,
                    startTime: now,
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

            return { sessionToken, newBalance, crashPoint };
        });

        return json({
            sessionToken: result.sessionToken,
            newBalance: result.newBalance
            // Don't send crashPoint to client - it's secret!
        });
    } catch (e) {
        console.error('Rocket start error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};
