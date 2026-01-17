import { auth } from '$lib/auth';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { redis } from '$lib/server/redis';
import { getSessionKey, calculateCurrentMultiplier, hasCrashed } from '$lib/server/games/rocket';

export const GET: RequestHandler = async ({ request, url }) => {
    const session = await auth.api.getSession({
        headers: request.headers
    });

    if (!session?.user) {
        throw error(401, 'Not authenticated');
    }

    const userId = Number(session.user.id);
    const sessionToken = url.searchParams.get('sessionToken');

    if (!sessionToken) {
        return json({ error: 'Missing sessionToken parameter' }, { status: 400 });
    }

    try {
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
            return json({ 
                multiplier: 0,
                crashed: true,
                status: game.status 
            });
        }

        const now = Date.now();
        
        // Check crash status FIRST with precise calculation
        const crashed = hasCrashed(game.crashPoint, game.startTime, now);
        
        // Calculate multiplier for display (only if not crashed)
        const currentMultiplier = crashed 
            ? game.crashPoint // If crashed, show exact crash point
            : calculateCurrentMultiplier(game.crashPoint, game.startTime, now);

        // If crashed, update game status in Redis (atomic update)
        if (crashed && game.status === 'active') {
            // Mark as crashed in Redis to prevent further actions
            game.status = 'crashed';
            await redis.set(sessionKey, JSON.stringify(game), { EX: 3600 });
        }

        return json({
            multiplier: currentMultiplier,
            crashed,
            status: crashed ? 'crashed' : 'active',
            elapsed: now - game.startTime
        });
    } catch (e) {
        console.error('Rocket status error:', e);
        const errorMessage = e instanceof Error ? e.message : 'Internal server error';
        return json({ error: errorMessage }, { status: 400 });
    }
};
