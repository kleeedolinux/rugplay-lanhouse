import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '$lib/server/redis';
import { randomBytes } from 'crypto';

export interface RocketSession {
    sessionToken: string;
    betAmount: number;
    crashPoint: number;
    startTime: number;
    status: 'active' | 'crashed' | 'cashed_out';
    userId: number;
    cashedOutAt?: number;
}

const ROCKET_SESSION_PREFIX = 'rocket:session:';
export const getSessionKey = (token: string) => `${ROCKET_SESSION_PREFIX}${token}`;

// Generate secure random float in [0, 1) using multiple bytes for precision
function secureRandomFloat(): number {
    const bytes = randomBytes(4);
    const uint32 = bytes.readUInt32BE(0);
    return uint32 / (0xFFFFFFFF + 1);
}

// Generate crash point using cryptographically secure randomness
// Formula ajustada para distribuição mais realista
export function generateCrashPoint(houseEdge: number = 0.01): number {
    const random = secureRandomFloat();
    
    // Proteção contra valores extremos
    const safeRandom = Math.max(0.00001, Math.min(0.99999, random));
    
    // Fórmula: crashPoint = (1 / (1 - random)) * (1 - houseEdge)
    // Isso cria uma distribuição exponencial mais controlada
    let crashPoint = (1 / (1 - safeRandom)) * (1 - houseEdge);
    
    // IMPORTANTE: Garantir crash mínimo de 1.01x
    crashPoint = Math.max(crashPoint, 1.01);
    
    // Limitar a 100x para manter o jogo mais equilibrado
    crashPoint = Math.min(crashPoint, 100);
    
    // Arredondar para 2 casas decimais
    return Math.round(crashPoint * 100) / 100;
}

// Calculate current multiplier based on elapsed time
export function calculateCurrentMultiplier(
    crashPoint: number,
    startTime: number,
    currentTime: number,
    growthRate: number = 0.1 // Crescimento de 0.1x por segundo
): number {
    const elapsed = currentTime - startTime;
    
    if (elapsed <= 0) return 1.0;
    
    // Crescimento LINEAR: multiplier = 1 + (elapsed_in_seconds * growthRate)
    // Isso garante um crescimento previsível e controlado
    const elapsedSeconds = elapsed / 1000;
    const multiplier = 1 + (elapsedSeconds * growthRate);
    
    // NUNCA exceder o crashPoint
    const capped = Math.min(multiplier, crashPoint);
    
    // Arredondar para 2 casas decimais
    return Math.round(capped * 100) / 100;
}

// Check if rocket has crashed
export function hasCrashed(
    crashPoint: number,
    startTime: number,
    currentTime: number,
    growthRate: number = 0.1
): boolean {
    const elapsed = currentTime - startTime;
    
    // Nunca crashar antes de 100ms
    if (elapsed < 100) return false;
    
    // Calcular multiplicador atual SEM arredondamento para comparação precisa
    const elapsedSeconds = elapsed / 1000;
    const currentMultiplier = 1 + (elapsedSeconds * growthRate);
    
    // Crashar quando o multiplicador atual atingir ou ultrapassar o crashPoint
    // Usar margem de 0.005 para evitar problemas de precisão float
    return currentMultiplier >= (crashPoint - 0.005);
}

// Get time when rocket will crash (útil para debugging e auto-crash)
export function getTimeToCrash(crashPoint: number, growthRate: number = 0.1): number {
    // crashPoint = 1 + (seconds * growthRate)
    // seconds = (crashPoint - 1) / growthRate
    const secondsUntilCrash = (crashPoint - 1) / growthRate;
    return secondsUntilCrash * 1000; // Retornar em ms
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
        
        // Se o jogo está inativo por mais de 5 minutos, reembolsar se não fez cashout
        if (now - game.startTime > 5 * 60 * 1000 && game.status === 'active') {
            try {
                const deleted = await redis.del(key);
                if (!deleted) continue;
                
                // Reembolsar a aposta
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
        
        // Verificar se o foguete deveria ter crashado
        if (game.status === 'active' && hasCrashed(game.crashPoint, game.startTime, now)) {
            try {
                // Atualizar status para crashed
                game.status = 'crashed';
                await redis.set(key, JSON.stringify(game), { EX: 300 }); // Manter por 5 min
                
                // Atualizar perdas de gambling
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
