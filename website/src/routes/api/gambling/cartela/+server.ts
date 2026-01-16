import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { publishGamblingActivity } from '$lib/server/gambling-activity';
import { validateBetAmount } from '$lib/utils';

// 25 Programming Language Groups (like Jogo do Bicho animals)
// Each group has 4 numbers (00-99 divided into 25 groups)
// Icons are from /languageicons/{folder}/{folder}-original.svg
const PROGRAMMING_GROUPS = [
    { id: 1, name: 'Python', icon: '/languageicons/python/python-original.svg', numbers: [1, 2, 3, 4] },
    { id: 2, name: 'JavaScript', icon: '/languageicons/javascript/javascript-original.svg', numbers: [5, 6, 7, 8] },
    { id: 3, name: 'TypeScript', icon: '/languageicons/typescript/typescript-original.svg', numbers: [9, 10, 11, 12] },
    { id: 4, name: 'Rust', icon: '/languageicons/rust/rust-original.svg', numbers: [13, 14, 15, 16] },
    { id: 5, name: 'Go', icon: '/languageicons/go/go-original.svg', numbers: [17, 18, 19, 20] },
    { id: 6, name: 'Java', icon: '/languageicons/java/java-original.svg', numbers: [21, 22, 23, 24] },
    { id: 7, name: 'C++', icon: '/languageicons/cplusplus/cplusplus-original.svg', numbers: [25, 26, 27, 28] },
    { id: 8, name: 'C#', icon: '/languageicons/csharp/csharp-original.svg', numbers: [29, 30, 31, 32] },
    { id: 9, name: 'Ruby', icon: '/languageicons/ruby/ruby-original.svg', numbers: [33, 34, 35, 36] },
    { id: 10, name: 'PHP', icon: '/languageicons/php/php-original.svg', numbers: [37, 38, 39, 40] },
    { id: 11, name: 'Swift', icon: '/languageicons/swift/swift-original.svg', numbers: [41, 42, 43, 44] },
    { id: 12, name: 'Kotlin', icon: '/languageicons/kotlin/kotlin-original.svg', numbers: [45, 46, 47, 48] },
    { id: 13, name: 'Scala', icon: '/languageicons/scala/scala-original.svg', numbers: [49, 50, 51, 52] },
    { id: 14, name: 'Elixir', icon: '/languageicons/elixir/elixir-original.svg', numbers: [53, 54, 55, 56] },
    { id: 15, name: 'Haskell', icon: '/languageicons/haskell/haskell-original.svg', numbers: [57, 58, 59, 60] },
    { id: 16, name: 'Clojure', icon: '/languageicons/clojure/clojure-original.svg', numbers: [61, 62, 63, 64] },
    { id: 17, name: 'Lua', icon: '/languageicons/lua/lua-original.svg', numbers: [65, 66, 67, 68] },
    { id: 18, name: 'Perl', icon: '/languageicons/perl/perl-original.svg', numbers: [69, 70, 71, 72] },
    { id: 19, name: 'R', icon: '/languageicons/r/r-original.svg', numbers: [73, 74, 75, 76] },
    { id: 20, name: 'Julia', icon: '/languageicons/julia/julia-original.svg', numbers: [77, 78, 79, 80] },
    { id: 21, name: 'Dart', icon: '/languageicons/dart/dart-original.svg', numbers: [81, 82, 83, 84] },
    { id: 22, name: 'Zig', icon: '/languageicons/zig/zig-original.svg', numbers: [85, 86, 87, 88] },
    { id: 23, name: 'Nim', icon: '/languageicons/nim/nim-original.svg', numbers: [89, 90, 91, 92] },
    { id: 24, name: 'OCaml', icon: '/languageicons/ocaml/ocaml-original.svg', numbers: [93, 94, 95, 96] },
    { id: 25, name: 'Erlang', icon: '/languageicons/erlang/erlang-original.svg', numbers: [97, 98, 99, 0] },
];

// Bet types and their multipliers
const BET_TYPES = {
    group: { multiplier: 18, description: 'Bet on a programming language group' },
    dozen: { multiplier: 60, description: 'Bet on exact last 2 digits (dezena)' },
    hundred: { multiplier: 600, description: 'Bet on exact last 3 digits (centena)' },
    thousand: { multiplier: 4000, description: 'Bet on exact last 4 digits (milhar)' },
    duque_group: { multiplier: 19, description: 'Bet on 2 groups appearing in top 5' },
    terno_group: { multiplier: 130, description: 'Bet on 3 groups appearing in top 5' },
};

type BetType = keyof typeof BET_TYPES;

// Generate cryptographically secure random number
function generateSecureRandom(max: number): number {
    const bytes = randomBytes(4);
    const value = bytes.readUInt32BE(0);
    return value % max;
}

// Generate 5 random 4-digit numbers (like the lottery draw)
function generateDraw(): number[] {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
        // Generate 4-digit number (0000-9999)
        results.push(generateSecureRandom(10000));
    }
    return results;
}

// Get group from a number (last 2 digits determine the group)
function getGroupFromNumber(num: number): typeof PROGRAMMING_GROUPS[0] {
    const lastTwo = num % 100;
    // Find which group contains this number
    for (const group of PROGRAMMING_GROUPS) {
        if (group.numbers.includes(lastTwo % 100 === 0 ? 0 : ((lastTwo - 1) % 100) + 1) ||
            group.numbers.includes(lastTwo)) {
            // Recalculate: numbers 01-04 = group 1, 05-08 = group 2, etc.
            const groupIndex = lastTwo === 0 ? 25 : Math.ceil(lastTwo / 4);
            return PROGRAMMING_GROUPS[groupIndex - 1];
        }
    }
    // Fallback calculation
    const groupIndex = lastTwo === 0 ? 25 : Math.ceil(lastTwo / 4);
    return PROGRAMMING_GROUPS[Math.min(groupIndex - 1, 24)];
}

// Check if bet wins
function checkWin(
    betType: BetType,
    betValue: number | number[],
    drawResults: number[]
): { won: boolean; matchedPrize?: number; matchedValue?: number } {
    const firstPrize = drawResults[0];

    switch (betType) {
        case 'group': {
            // Check if the selected group matches the first prize
            const drawnGroup = getGroupFromNumber(firstPrize);
            if (drawnGroup.id === betValue) {
                return { won: true, matchedPrize: 1, matchedValue: firstPrize };
            }
            return { won: false };
        }

        case 'dozen': {
            // Check if last 2 digits match
            const lastTwo = firstPrize % 100;
            if (lastTwo === betValue) {
                return { won: true, matchedPrize: 1, matchedValue: firstPrize };
            }
            return { won: false };
        }

        case 'hundred': {
            // Check if last 3 digits match
            const lastThree = firstPrize % 1000;
            if (lastThree === betValue) {
                return { won: true, matchedPrize: 1, matchedValue: firstPrize };
            }
            return { won: false };
        }

        case 'thousand': {
            // Check if all 4 digits match
            if (firstPrize === betValue) {
                return { won: true, matchedPrize: 1, matchedValue: firstPrize };
            }
            return { won: false };
        }

        case 'duque_group': {
            // Check if both selected groups appear in top 5
            const selectedGroups = betValue as number[];
            const drawnGroups = drawResults.map(n => getGroupFromNumber(n).id);
            const matches = selectedGroups.filter(g => drawnGroups.includes(g));
            if (matches.length === 2) {
                return { won: true, matchedPrize: 0 };
            }
            return { won: false };
        }

        case 'terno_group': {
            // Check if all 3 selected groups appear in top 5
            const selectedGroups = betValue as number[];
            const drawnGroups = drawResults.map(n => getGroupFromNumber(n).id);
            const matches = selectedGroups.filter(g => drawnGroups.includes(g));
            if (matches.length === 3) {
                return { won: true, matchedPrize: 0 };
            }
            return { won: false };
        }

        default:
            return { won: false };
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
        if (betType === 'group') {
            if (!Number.isInteger(betValue) || betValue < 1 || betValue > 25) {
                return json({ error: 'Invalid group selection (1-25)' }, { status: 400 });
            }
        } else if (betType === 'dozen') {
            if (!Number.isInteger(betValue) || betValue < 0 || betValue > 99) {
                return json({ error: 'Invalid dozen (00-99)' }, { status: 400 });
            }
        } else if (betType === 'hundred') {
            if (!Number.isInteger(betValue) || betValue < 0 || betValue > 999) {
                return json({ error: 'Invalid hundred (000-999)' }, { status: 400 });
            }
        } else if (betType === 'thousand') {
            if (!Number.isInteger(betValue) || betValue < 0 || betValue > 9999) {
                return json({ error: 'Invalid thousand (0000-9999)' }, { status: 400 });
            }
        } else if (betType === 'duque_group') {
            if (!Array.isArray(betValue) || betValue.length !== 2 ||
                !betValue.every(v => Number.isInteger(v) && v >= 1 && v <= 25)) {
                return json({ error: 'Invalid duque selection (2 groups, 1-25)' }, { status: 400 });
            }
        } else if (betType === 'terno_group') {
            if (!Array.isArray(betValue) || betValue.length !== 3 ||
                !betValue.every(v => Number.isInteger(v) && v >= 1 && v <= 25)) {
                return json({ error: 'Invalid terno selection (3 groups, 1-25)' }, { status: 400 });
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

            // Generate the draw
            const drawResults = generateDraw();

            // Check if bet wins
            const winResult = checkWin(betType as BetType, betValue, drawResults);
            const multiplier = BET_TYPES[betType as BetType].multiplier;

            const won = winResult.won;
            const payout = won ? roundedBet * multiplier : 0;
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

            // Get groups for each drawn number
            const drawnGroups = drawResults.map(n => getGroupFromNumber(n));

            return {
                won,
                drawResults,
                drawnGroups: drawnGroups.map(g => ({ id: g.id, name: g.name, icon: g.icon })),
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
            'cartela',
            1500
        );

        return json(result);
    } catch (e) {
        console.error('Cartela API error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};

// GET endpoint to return the groups info
export const GET: RequestHandler = async () => {
    return json({
        groups: PROGRAMMING_GROUPS,
        betTypes: Object.entries(BET_TYPES).map(([key, value]) => ({
            type: key,
            ...value
        }))
    });
};
