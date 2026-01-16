import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { 
    TWELVE_HOURS_MS, 
    ONE_HOUR_MS, 
    calculateStreak, 
    calculateDailyReward, 
    calculateHourlyReward 
} from '$lib/server/rewards';

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw error(401, 'Not authenticated');

    const userId = Number(session.user.id);
    const now = new Date();

    return await db.transaction(async (tx) => {
        const [currentUser] = await tx.select({
            id: user.id,
            baseCurrencyBalance: user.baseCurrencyBalance,
            lastRewardClaim: user.lastRewardClaim,
            totalRewardsClaimed: user.totalRewardsClaimed,
            loginStreak: user.loginStreak,
            prestigeLevel: user.prestigeLevel
        })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
            .limit(1);

        if (!currentUser) throw error(404, 'User not found');

        if (currentUser.lastRewardClaim) {
            const timeSinceLastClaim = now.getTime() - currentUser.lastRewardClaim.getTime();
            if (timeSinceLastClaim < TWELVE_HOURS_MS) {
                return json({
                    error: 'Daily reward not yet available',
                    canClaim: false,
                    timeRemaining: TWELVE_HOURS_MS - timeSinceLastClaim
                }, { status: 429 });
            }
        }

        const newStreak = calculateStreak(currentUser.lastRewardClaim, currentUser.loginStreak || 0);
        const reward = calculateDailyReward(newStreak, currentUser.prestigeLevel || 0);

        const newBalance = parseFloat(currentUser.baseCurrencyBalance || '0') + reward.total;
        const newTotalRewards = parseFloat(currentUser.totalRewardsClaimed || '0') + reward.total;

        await tx.update(user)
            .set({
                baseCurrencyBalance: newBalance.toFixed(8),
                lastRewardClaim: now,
                totalRewardsClaimed: newTotalRewards.toFixed(8),
                loginStreak: newStreak
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
            loginStreak: newStreak,
            nextClaimTime: new Date(now.getTime() + TWELVE_HOURS_MS)
        });
    });
};

export const GET: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw error(401, 'Not authenticated');

    const [currentUser] = await db.select({
        id: user.id,
        lastRewardClaim: user.lastRewardClaim,
        lastHourlyRewardClaim: user.lastHourlyRewardClaim,
        totalRewardsClaimed: user.totalRewardsClaimed,
        loginStreak: user.loginStreak,
        prestigeLevel: user.prestigeLevel
    })
        .from(user)
        .where(eq(user.id, Number(session.user.id)))
        .limit(1);

    if (!currentUser) throw error(404, 'User not found');

    const now = Date.now();
    const lastDaily = currentUser.lastRewardClaim?.getTime() || 0;
    const lastHourly = currentUser.lastHourlyRewardClaim?.getTime() || 0;

    const dailyTimeRemaining = Math.max(0, TWELVE_HOURS_MS - (now - lastDaily));
    const hourlyTimeRemaining = Math.max(0, ONE_HOUR_MS - (now - lastHourly));

    const potentialStreak = calculateStreak(currentUser.lastRewardClaim, currentUser.loginStreak || 0);
    const dailyReward = calculateDailyReward(potentialStreak, currentUser.prestigeLevel || 0);
    const hourlyReward = calculateHourlyReward(Math.max(currentUser.loginStreak || 0, 1), currentUser.prestigeLevel || 0);

    return json({
        // Daily
        canClaim: dailyTimeRemaining === 0,
        rewardAmount: dailyReward.total,
        baseReward: dailyReward.base,
        prestigeBonus: dailyReward.prestigeBonus,
        timeRemaining: dailyTimeRemaining,
        nextClaimTime: dailyTimeRemaining > 0 ? new Date(lastDaily + TWELVE_HOURS_MS) : null,
        // Hourly
        canClaimHourly: hourlyTimeRemaining === 0,
        hourlyRewardAmount: hourlyReward.total,
        hourlyBaseReward: hourlyReward.base,
        hourlyPrestigeBonus: hourlyReward.prestigeBonus,
        hourlyTimeRemaining,
        nextHourlyClaimTime: hourlyTimeRemaining > 0 ? new Date(lastHourly + ONE_HOUR_MS) : null,
        // Common
        prestigeLevel: currentUser.prestigeLevel || 0,
        totalRewardsClaimed: Number(currentUser.totalRewardsClaimed || 0),
        lastRewardClaim: currentUser.lastRewardClaim,
        lastHourlyRewardClaim: currentUser.lastHourlyRewardClaim,
        loginStreak: currentUser.loginStreak || 0
    });
};
