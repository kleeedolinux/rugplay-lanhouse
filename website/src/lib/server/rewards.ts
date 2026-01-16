// Reward system constants and utilities

export const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
export const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;

export const REWARD_TIERS = [
    20000,  // Day 1
    22000,  // Day 2
    24000,  // Day 3
    26000,  // Day 4
    28000,  // Day 5
    30000,  // Day 6
    33000,  // Day 7
    36000,  // Day 8
    39000,  // Day 9
    42000,  // Day 10
    45000,  // Day 11
    48000,  // Day 12
    52000,  // Day 13
    56000,  // Day 14
    60000,  // Day 15
    65000,  // Day 16
    70000,  // Day 17
    75000,  // Day 18
    80000,  // Day 19
    85000,  // Day 20
    90000,  // Day 21
    95000,  // Day 22
    100000, // Day 23
    105000, // Day 24
    110000, // Day 25
    115000, // Day 26
    120000, // Day 27
    125000, // Day 28
    130000, // Day 29
    150000  // Day 30+
];

export const PRESTIGE_MULTIPLIERS: Record<number, number> = {
    0: 1.0,    // No prestige
    1: 1.25,   // 25% bonus
    2: 1.5,    // 50% bonus
    3: 1.75,   // 75% bonus
    4: 2.0,    // 100% bonus
    5: 2.5,    // 150% bonus
};

export function getPrestigeMultiplier(prestigeLevel: number): number {
    return PRESTIGE_MULTIPLIERS[prestigeLevel] || 1.0;
}

export function calculateStreak(lastClaim: Date | null, currentStreak: number): number {
    if (!lastClaim) return 1;
    const timeSinceLastClaim = Date.now() - lastClaim.getTime();
    if (timeSinceLastClaim > THIRTY_SIX_HOURS_MS) return 1;
    if (timeSinceLastClaim >= TWELVE_HOURS_MS) return currentStreak + 1;
    return currentStreak;
}

export function calculateReward(streak: number, prestigeLevel: number = 0, divisor: number = 1): { total: number; base: number; prestigeBonus: number } {
    const tierIndex = Math.min(Math.max(streak - 1, 0), REWARD_TIERS.length - 1);
    const base = Math.floor(REWARD_TIERS[tierIndex] / divisor);
    const prestigeMultiplier = getPrestigeMultiplier(prestigeLevel);
    const prestigeBonus = Math.floor(base * (prestigeMultiplier - 1));
    const total = base + prestigeBonus;
    return { total, base, prestigeBonus };
}

// Daily reward (full amount)
export const calculateDailyReward = (streak: number, prestigeLevel: number = 0) => 
    calculateReward(streak, prestigeLevel, 1);

// Hourly reward (50% of daily)
export const calculateHourlyReward = (streak: number, prestigeLevel: number = 0) => 
    calculateReward(streak, prestigeLevel, 2);
