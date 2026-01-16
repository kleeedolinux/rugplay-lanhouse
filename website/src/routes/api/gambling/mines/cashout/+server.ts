import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey } from '$lib/server/games/mines';
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
        const { sessionToken } = await request.json();
        const sessionKey = getSessionKey(sessionToken);
        const sessionRaw = await redis.get(sessionKey);

        if (!sessionRaw) {
            return json({ error: 'Invalid session' }, { status: 400 });
        }

        const game = JSON.parse(sessionRaw);

        if (game.userId !== userId) {
            return json({ error: 'Unauthorized' }, { status: 403 });
        }

        const deleted = await redis.del(sessionKey);
        if (!deleted) {
            return json({ error: 'Session already processed' }, { status: 400 });
        }

        const isAbort = game.revealedTiles.length === 0;
        const payout = isAbort ? game.betAmount : Math.round(game.betAmount * game.currentMultiplier * 100000000) / 100000000;
        const netResult = payout - game.betAmount;
        const isWin = netResult > 0;

        const result = await db.transaction(async (tx) => {
            const [userData] = await tx
                .select({
                    baseCurrencyBalance: user.baseCurrencyBalance,
                    gamblingLosses: user.gamblingLosses,
                    gamblingWins: user.gamblingWins
                })
                .from(user)
                .where(eq(user.id, userId))
                .for('update')
                .limit(1);

            const currentBalance = Number(userData.baseCurrencyBalance);
            const newBalance = Math.round((currentBalance + payout) * 100000000) / 100000000;

            const updateData: Record<string, string | Date> = {
                baseCurrencyBalance: newBalance.toFixed(8),
                updatedAt: new Date()
            };

            if (isWin) {
                updateData.gamblingWins = (Number(userData.gamblingWins || 0) + netResult).toFixed(8);
            } else if (netResult < 0) {
                updateData.gamblingLosses = (Number(userData.gamblingLosses || 0) + Math.abs(netResult)).toFixed(8);
            }

            await tx.update(user).set(updateData).where(eq(user.id, userId));

            return { newBalance };
        });

        // Store ended game positions for pos endpoint
        await storeEndedGamePositions(sessionToken, game.minePositions, userId, 'cashout');

        // Only publish activity if not an abort and bet is significant
        if (!isAbort) {
            await publishGamblingActivity(userId, isWin ? payout : game.betAmount, isWin, 'mines', 500);
        }

        return json({
            newBalance: result.newBalance,
            payout,
            amountWagered: game.betAmount,
            isAbort,
            minePositions: game.minePositions
        });
    } catch (e) {
        console.error('Mines cashout error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};