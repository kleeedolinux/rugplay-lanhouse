import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { publishGamblingActivity } from '$lib/server/gambling-activity';
import { validateBetAmount } from '$lib/utils';

// All available themed icons for roulette
const ROULETTE_SYMBOLS = [
    'bliptext',
    'bussin',
    'griddycode',
    'lyntr',
    'subterfuge',
    'twoblade',
    'wattesigma',
    'webx'
];

// Bet types and their multipliers
const BET_TYPES = {
    single: { multiplier: 8, description: 'Bet on a single icon' },
    pair: { multiplier: 4, description: 'Bet on 2 icons' },
    trio: { multiplier: 2.67, description: 'Bet on 3 icons' },
    quartet: { multiplier: 2, description: 'Bet on 4 icons' },
    half: { multiplier: 2, description: 'Bet on half the wheel (4 icons)' }
};

type BetType = keyof typeof BET_TYPES;

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

// Generate winning symbol using cryptographically secure randomness
function generateWinningSymbol(): string {
    const index = secureRandomInt(ROULETTE_SYMBOLS.length);
    return ROULETTE_SYMBOLS[index];
}

// Check if bet wins
function checkWin(
    betType: BetType,
    betValue: string | string[],
    winningSymbol: string
): boolean {
    switch (betType) {
        case 'single':
            return betValue === winningSymbol;
        
        case 'pair':
            return Array.isArray(betValue) && betValue.length === 2 && betValue.includes(winningSymbol);
        
        case 'trio':
            return Array.isArray(betValue) && betValue.length === 3 && betValue.includes(winningSymbol);
        
        case 'quartet':
            return Array.isArray(betValue) && betValue.length === 4 && betValue.includes(winningSymbol);
        
        case 'half':
            return Array.isArray(betValue) && betValue.length === 4 && betValue.includes(winningSymbol);
        
        default:
            return false;
    }
}

export const POST: RequestHandler = async ({ request }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    try {
        const { amount, betType, betValue } = await request.json();

        // Validate bet type
        if (!betType || !BET_TYPES[betType as BetType]) {
            return json({ error: 'Invalid bet type' }, { status: 400 });
        }

        // Validate bet value based on type
        if (betType === 'single') {
            if (!ROULETTE_SYMBOLS.includes(betValue)) {
                return json({ error: 'Invalid symbol selection' }, { status: 400 });
            }
        } else if (betType === 'pair') {
            if (!Array.isArray(betValue) || betValue.length !== 2 ||
                !betValue.every(v => ROULETTE_SYMBOLS.includes(v))) {
                return json({ error: 'Invalid pair selection (2 icons)' }, { status: 400 });
            }
        } else if (betType === 'trio') {
            if (!Array.isArray(betValue) || betValue.length !== 3 ||
                !betValue.every(v => ROULETTE_SYMBOLS.includes(v))) {
                return json({ error: 'Invalid trio selection (3 icons)' }, { status: 400 });
            }
        } else if (betType === 'quartet') {
            if (!Array.isArray(betValue) || betValue.length !== 4 ||
                !betValue.every(v => ROULETTE_SYMBOLS.includes(v))) {
                return json({ error: 'Invalid quartet selection (4 icons)' }, { status: 400 });
            }
        } else if (betType === 'half') {
            if (!Array.isArray(betValue) || betValue.length !== 4 ||
                !betValue.every(v => ROULETTE_SYMBOLS.includes(v))) {
                return json({ error: 'Invalid half selection (4 icons)' }, { status: 400 });
            }
        }

        const roundedBet = validateBetAmount(amount);
        const userId = Number(session.user.id);

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
            const roundedBalance = Math.round(currentBalance * 100000000) / 100000000;

            if (roundedBet > roundedBalance) {
                throw new Error(`Insufficient funds. You need $${roundedBet.toFixed(2)} but only have $${roundedBalance.toFixed(2)}`);
            }

            // Generate winning symbol with cryptographically secure randomness
            const winningSymbol = generateWinningSymbol();

            // Check if bet wins
            const won = checkWin(betType as BetType, betValue, winningSymbol);
            const multiplier = BET_TYPES[betType as BetType].multiplier;
            const payout = won ? Math.round(roundedBet * multiplier * 100000000) / 100000000 : 0;
            const newBalance = roundedBalance - roundedBet + payout;

            // Calculate gambling stats
            const netResult = payout - roundedBet;
            const isWin = netResult > 0;

            const updateData: Record<string, string | Date> = {
                baseCurrencyBalance: newBalance.toFixed(8),
                updatedAt: new Date()
            };

            if (isWin) {
                updateData.gamblingWins = (Number(userData.gamblingWins || 0) + netResult).toFixed(8);
            } else {
                updateData.gamblingLosses = (Number(userData.gamblingLosses || 0) + Math.abs(netResult)).toFixed(8);
            }

            await tx.update(user).set(updateData).where(eq(user.id, userId));

            return {
                won,
                winningSymbol,
                newBalance,
                payout,
                amountWagered: roundedBet,
                multiplier: won ? multiplier : 0,
                betType,
                betValue
            };
        });

        await publishGamblingActivity(
            userId,
            result.won ? result.payout : result.amountWagered,
            result.won,
            'roulette',
            2000
        );

        return json(result);
    } catch (e) {
        console.error('Roulette API error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};

// GET endpoint to return the symbols and bet types info
export const GET: RequestHandler = async () => {
    return json({
        symbols: ROULETTE_SYMBOLS,
        betTypes: Object.entries(BET_TYPES).map(([key, value]) => ({
            type: key,
            ...value
        }))
    });
};
