import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from '@sveltejs/kit';
import { ONE_HOUR_MS, calculateHourlyReward } from '$lib/server/rewards';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw error(401, 'Not authenticated');

    const userId = Number(session.user.id);
    const now = new Date();

    return await db.transaction(async (tx) => {
        const [currentUser] = await tx.select({
            id: user.id,
            baseCurrencyBalance: user.baseCurrencyBalance,
            lastHourlyRewardClaim: user.lastHourlyRewardClaim,
            totalRewardsClaimed: user.totalRewardsClaimed,
            loginStreak: user.loginStreak,
            prestigeLevel: user.prestigeLevel
        })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
            .limit(1);

        if (!currentUser) throw error(404, 'User not found');

        if (currentUser.lastHourlyRewardClaim) {
            const timeSinceLastClaim = now.getTime() - currentUser.lastHourlyRewardClaim.getTime();
            if (timeSinceLastClaim < ONE_HOUR_MS) {
                return json({
                    error: 'Hourly reward not yet available',
                    canClaim: false,
                    timeRemaining: ONE_HOUR_MS - timeSinceLastClaim
                }, { status: 429 });
            }
        }

        const currentStreak = Math.max(currentUser.loginStreak || 0, 1);
        const reward = calculateHourlyReward(currentStreak, currentUser.prestigeLevel || 0);

        const newBalance = parseFloat(currentUser.baseCurrencyBalance || '0') + reward.total;
        const newTotalRewards = parseFloat(currentUser.totalRewardsClaimed || '0') + reward.total;

        await tx.update(user)
            .set({
                baseCurrencyBalance: newBalance.toFixed(8),
                lastHourlyRewardClaim: now,
                totalRewardsClaimed: newTotalRewards.toFixed(8)
            })
            .where(eq(user.id, currentUser.id));

        return json({
            success: true,
            rewardAmount: reward.total,
            baseReward: reward.base,
            prestigeBonus: reward.prestigeBonus,
            prestigeLevel: currentUser.prestigeLevel || 0,
            newBalance,
            totalRewardsClaimed: newTotalRewards,
            loginStreak: currentStreak,
            nextClaimTime: new Date(now.getTime() + ONE_HOUR_MS)
        });
    });
};
