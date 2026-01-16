import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { redis } from '$lib/server/redis';
import { getSessionKey, getEndedGameKey } from '$lib/server/games/mines';

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

        if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length < 16) {
            return json({ error: 'Invalid session token' }, { status: 400 });
        }

        // Check if game is still active (positions should NOT be revealed)
        const activeSessionKey = getSessionKey(sessionToken);
        const activeSession = await redis.get(activeSessionKey);

        if (activeSession) {
            const game = JSON.parse(activeSession);
            
            // Verify ownership even for active games
            if (game.userId !== userId) {
                return json({ error: 'Unauthorized' }, { status: 403 });
            }

            // Game is still active - don't reveal positions
            return json({ 
                error: 'Game is still active. Complete the game to see mine positions.',
                gameActive: true,
                revealedCount: game.revealedTiles?.length || 0
            }, { status: 400 });
        }

        // Check for ended game positions
        const endedGameKey = getEndedGameKey(sessionToken);
        const endedGameData = await redis.get(endedGameKey);

        if (endedGameData) {
            const data = JSON.parse(endedGameData);

            // Verify ownership
            if (data.userId !== userId) {
                return json({ error: 'Unauthorized' }, { status: 403 });
            }

            return json({
                minePositions: data.minePositions,
                result: data.result,
                endedAt: data.endedAt
            });
        }

        // No active or ended game found
        return json({ 
            error: 'Game session not found or expired. Positions are only available for 5 minutes after game ends.',
            expired: true
        }, { status: 404 });

    } catch (e) {
        console.error('Mines positions error:', e);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
