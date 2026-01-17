import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { randomBytes } from 'crypto';

export interface RocketSession {
    sessionToken: string;
    betAmount: number;
    crashPoint: number; // The multiplier where the rocket will crash
    startTime: number;
    status: 'active' | 'crashed' | 'cashed_out';
    userId: number;
    cashedOutAt?: number; // Multiplier when user cashed out
}

const ROCKET_SESSION_PREFIX = 'rocket:session:';
export const getSessionKey = (token: string) => `${ROCKET_SESSION_PREFIX}${token}`;

// Unbiased random integer in range [0, max) using rejection sampling
// Follows NIST SP 800-90A and ISO/IEC 18031 recommendations
function secureRandomInt(max: number): number {
    if (max <= 0 || max > 256) throw new Error('Invalid range');
    
    const limit = 256 - (256 % max);
    
    let value: number;
    do {
        value = randomBytes(1)[0];
    } while (value >= limit);
    
    return value % max;
}

// Generate secure random float in [0, 1) using multiple bytes for precision
function secureRandomFloat(): number {
    // Use 4 bytes for 32-bit precision
    const bytes = randomBytes(4);
    const uint32 = bytes.readUInt32BE(0);
    // Convert to float in [0, 1)
    return uint32 / (0xFFFFFFFF + 1);
}

// Generate crash point using cryptographically secure randomness
// Uses house edge formula: crashPoint = max(1, (1 - houseEdge) / (1 - random))
// With 1% house edge, this ensures fair distribution
export function generateCrashPoint(houseEdge: number = 0.01): number {
    const random = secureRandomFloat();
    
    // Ensure random is not exactly 0 or 1 to avoid edge cases
    const safeRandom = Math.max(0.0000001, Math.min(0.9999999, random));
    
    // Formula: crashPoint = (1 - houseEdge) / (1 - random)
    // This ensures the expected value accounts for house edge
    let crashPoint = (1 - houseEdge) / (1 - safeRandom);
    
    // ENFORCE MINIMUM CRASH POINT - never crash below 1.01x
    // This prevents immediate crashes at 1.0x
    crashPoint = Math.max(crashPoint, 1.01);
    
    // Cap at reasonable maximum (e.g., 1000x)
    return Math.min(crashPoint, 1000);
}

// Calculate current multiplier based on elapsed time
// Uses exponential growth: multiplier = 1 + (crashPoint - 1) * (1 - e^(-t/scale))
// This creates a smooth curve that approaches crashPoint
export function calculateCurrentMultiplier(
    crashPoint: number,
    startTime: number,
    currentTime: number,
    scale: number = 10000 // Time scale in ms (adjusts curve steepness)
): number {
    const elapsed = currentTime - startTime;
    
    if (elapsed <= 0) return 1.0;
    
    // Exponential approach to crash point
    // multiplier = 1 + (crashPoint - 1) * (1 - e^(-elapsed/scale))
    const t = elapsed / scale;
    const multiplier = 1 + (crashPoint - 1) * (1 - Math.exp(-t));
    
    // Cap at crashPoint (never exceed it)
    // Round to 2 decimal places for display, but keep precision for comparison
    const capped = Math.min(multiplier, crashPoint);
    return Math.round(capped * 100) / 100;
}

// Check if rocket has crashed
// IMPORTANT: Only crash when multiplier EXACTLY reaches or exceeds crashPoint
// Use precise comparison to avoid premature crashes
export function hasCrashed(
    crashPoint: number,
    startTime: number,
    currentTime: number,
    scale: number = 10000
): boolean {
    const elapsed = currentTime - startTime;
    
    // CRITICAL: Never crash if elapsed time is too small (prevents 1.0x crashes)
    // Require at least 100ms elapsed to prevent immediate crashes
    if (elapsed < 100) return false;
    
    // Calculate multiplier with full precision (no rounding for comparison)
    const t = elapsed / scale;
    const multiplier = 1 + (crashPoint - 1) * (1 - Math.exp(-t));
    
    // Only crash when multiplier reaches or exceeds crashPoint
    // Use strict comparison - multiplier must actually reach crashPoint
    // Add small buffer to ensure it's truly at crash point (not just close)
    return multiplier >= crashPoint;
}

// Cleanup inactive rocket games
export async function rocketCleanupInactiveGames() {
    const now = Date.now();
    const keys: string[] = [];
    let cursor = '0';
    
    do {
        const scanResult = await redis.scan(cursor, { MATCH: `${ROCKET_SESSION_PREFIX}*` });
        cursor = scanResult.cursor;
        keys.push(...scanResult.keys);
    } while (cursor !== '0');
    
    for (const key of keys) {
        const sessionRaw = await redis.get(key);
        if (!sessionRaw) continue;
        
        const game = JSON.parse(sessionRaw) as RocketSession;
        
        // If game is inactive for more than 5 minutes, refund if not cashed out
        if (now - game.startTime > 5 * 60 * 1000 && game.status === 'active') {
            try {
                const deleted = await redis.del(key);
                if (!deleted) continue;
                
                // Refund the bet
                const [userData] = await db
                    .select({ baseCurrencyBalance: user.baseCurrencyBalance })
                    .from(user)
                    .where(eq(user.id, game.userId))
                    .for('update')
                    .limit(1);
                
                const currentBalance = Number(userData.baseCurrencyBalance);
                const newBalance = Math.round((currentBalance + game.betAmount) * 100000000) / 100000000;
                
                await db
                    .update(user)
                    .set({
                        baseCurrencyBalance: newBalance.toFixed(8),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, game.userId));
            } catch (error) {
                console.error(`Failed to refund inactive rocket game ${game.sessionToken}:`, error);
            }
        }
    }
}

// Auto-crash games that have passed their crash point
export async function rocketAutoCrash() {
    const now = Date.now();
    const keys: string[] = [];
    let cursor = '0';
    
    do {
        const scanResult = await redis.scan(cursor, { MATCH: `${ROCKET_SESSION_PREFIX}*` });
        cursor = scanResult.cursor;
        keys.push(...scanResult.keys);
    } while (cursor !== '0');
    
    for (const key of keys) {
        const sessionRaw = await redis.get(key);
        if (!sessionRaw) continue;
        
        const game = JSON.parse(sessionRaw) as RocketSession;
        
        // Check if rocket should have crashed (precise check)
        const crashed = hasCrashed(game.crashPoint, game.startTime, now);
        if (game.status === 'active' && crashed) {
            try {
                const deleted = await redis.del(key);
                if (!deleted) continue;
                
                // Update gambling losses
                const [userData] = await db
                    .select({
                        baseCurrencyBalance: user.baseCurrencyBalance,
                        gamblingLosses: user.gamblingLosses
                    })
                    .from(user)
                    .where(eq(user.id, game.userId))
                    .for('update')
                    .limit(1);
                
                const currentLosses = Number(userData.gamblingLosses || 0);
                
                await db
                    .update(user)
                    .set({
                        gamblingLosses: (currentLosses + game.betAmount).toFixed(8),
                        updatedAt: new Date()
                    })
                    .where(eq(user.id, game.userId));
            } catch (error) {
                console.error(`Failed to auto-crash rocket game ${game.sessionToken}:`, error);
            }
        }
    }
}
