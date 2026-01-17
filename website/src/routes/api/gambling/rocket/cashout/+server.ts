import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { getSessionKey, calculateCurrentMultiplier, hasCrashed } from '$lib/server/games/rocket';
import { publishGamblingActivity } from '$lib/server/gambling-activity';

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

        // Validate session token
        if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length !== 32) {
            return json({ error: 'Invalid session token' }, { status: 400 });
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

        const now = Date.now();
        
        // Check if rocket has crashed FIRST (precise check)
        const crashed = hasCrashed(game.crashPoint, game.startTime, now);
        
        if (crashed) {
            // Rocket crashed - delete session and update losses
            await redis.del(sessionKey);
            
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

                const currentLosses = Number(userData.gamblingLosses || 0);

                await tx
                    .update(user)
                    .set({
                        gamblingLosses: (currentLosses + game.betAmount).toFixed(8),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, userId));

                return { currentBalance: Number(userData.baseCurrencyBalance) };
            });

            await publishGamblingActivity(userId, game.betAmount, false, 'rocket', 500);

            // Calculate exact crash multiplier for display
            const crashMultiplier = calculateCurrentMultiplier(game.crashPoint, game.startTime, now);
            
            return json({
                crashed: true,
                newBalance: result.currentBalance,
                amountWagered: game.betAmount,
                payout: 0,
                multiplier: crashMultiplier
            });
        }
        
        // Calculate current multiplier for cashout (only if not crashed)
        const currentMultiplier = calculateCurrentMultiplier(game.crashPoint, game.startTime, now);
        
        // Calculate payout
        const payout = Math.round(game.betAmount * currentMultiplier * 100000000) / 100000000;
        const netResult = payout - game.betAmount;
        const isWin = netResult > 0;

        // Delete session atomically to prevent double cashout
        const deleted = await redis.del(sessionKey);
        if (!deleted) {
            return json({ error: 'Session already processed' }, { status: 400 });
        }

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

        // Only publish activity if bet is significant
        if (game.betAmount >= 1000) {
            await publishGamblingActivity(userId, isWin ? payout : game.betAmount, isWin, 'rocket', 500);
        }

        return json({
            crashed: false,
            newBalance: result.newBalance,
            payout,
            amountWagered: game.betAmount,
            multiplier: currentMultiplier
        });
    } catch (e) {
        console.error('Rocket cashout error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};
