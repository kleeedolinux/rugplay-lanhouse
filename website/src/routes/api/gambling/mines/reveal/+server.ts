import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { calculateMultiplier, getSessionKey } from '$lib/server/games/mines';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { publishGamblingActivity } from '$lib/server/gambling-activity';
import { storeEndedGamePositions } from '../pos/+server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    const userId = Number(session.user.id);

    try {
        const { sessionToken, tileIndex } = await request.json();

        if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex > 24) {
            return json({ error: 'Invalid tileIndex' }, { status: 400 });
        }

        const sessionKey = getSessionKey(sessionToken);
        const sessionRaw = await redis.get(sessionKey);
        
        if (!sessionRaw) {
            return json({ error: 'Invalid session' }, { status: 400 });
        }

        const game = JSON.parse(sessionRaw);

        if (game.userId !== userId) {
            return json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (game.status !== 'active') {
            return json({ error: 'Game is not active' }, { status: 400 });
        }

        if (game.revealedTiles.includes(tileIndex)) {
            return json({ error: 'Tile already revealed' }, { status: 400 });
        }

        // Hit a mine - Loss
        if (game.minePositions.includes(tileIndex)) {
            const deleted = await redis.del(sessionKey);
            if (!deleted) {
                return json({ error: 'Session already processed' }, { status: 400 });
            }

            // Update gambling losses in DB
            const result = await db.transaction(async (tx) => {
                const [userData] = await tx
                    .select({
                        baseCurrencyBalance: user.baseCurrencyBalance,
                        gamblingLosses: user.gamblingLosses
                    })
                    .from(user)
                    .where(eq(user.id, userId))
                    .for('update')
                    .limit(1);

                const currentBalance = Number(userData.baseCurrencyBalance);
                const currentLosses = Number(userData.gamblingLosses || 0);

                await tx
                    .update(user)
                    .set({
                        gamblingLosses: (currentLosses + game.betAmount).toFixed(8),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, userId));

                return { currentBalance };
            });

            // Store ended game positions for pos endpoint
            await storeEndedGamePositions(sessionToken, game.minePositions, userId, 'lost');

            // Publish gambling activity for loss
            await publishGamblingActivity(userId, game.betAmount, false, 'mines', 500);

            return json({
                hitMine: true,
                minePositions: game.minePositions,
                newBalance: result.currentBalance,
                status: 'lost',
                amountWagered: game.betAmount
            });
        }

        // Safe tile
        game.revealedTiles.push(tileIndex);
        game.currentMultiplier = calculateMultiplier(
            game.revealedTiles.length,
            game.mineCount,
            game.betAmount
        );

        // Won by revealing all safe tiles
        if (game.revealedTiles.length === 25 - game.mineCount) {
            const deleted = await redis.del(sessionKey);
            if (!deleted) {
                return json({ error: 'Session already processed' }, { status: 400 });
            }

            const result = await db.transaction(async (tx) => {
                const [userData] = await tx
                    .select({
                        baseCurrencyBalance: user.baseCurrencyBalance,
                        gamblingWins: user.gamblingWins
                    })
                    .from(user)
                    .where(eq(user.id, userId))
                    .for('update')
                    .limit(1);

                const currentBalance = Number(userData.baseCurrencyBalance);
                const payout = Math.round(game.betAmount * game.currentMultiplier * 100000000) / 100000000;
                const newBalance = Math.round((currentBalance + payout) * 100000000) / 100000000;
                const netWin = payout - game.betAmount;

                await tx
                    .update(user)
                    .set({
                        baseCurrencyBalance: newBalance.toFixed(8),
                        gamblingWins: (Number(userData.gamblingWins || 0) + netWin).toFixed(8),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, userId));

                return { newBalance, payout };
            });

            // Store ended game positions for pos endpoint
            await storeEndedGamePositions(sessionToken, game.minePositions, userId, 'won');

            await publishGamblingActivity(userId, result.payout, true, 'mines', 500);

            return json({
                hitMine: false,
                currentMultiplier: game.currentMultiplier,
                status: 'won',
                newBalance: result.newBalance,
                payout: result.payout,
                minePositions: game.minePositions
            });
        }

        // Continue game - update Redis atomically
        await redis.set(sessionKey, JSON.stringify(game), { EX: 3600 });

        return json({
            hitMine: false,
            currentMultiplier: game.currentMultiplier,
            status: 'active'
        });
    } catch (e) {
        console.error('Mines reveal error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};