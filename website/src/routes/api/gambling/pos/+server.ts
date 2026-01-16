import { auth } from '$lib/auth';
import { error, json } from '@sveltejs/kit';
import { redis } from '$lib/server/redis';
import { getSessionKey } from '$lib/server/games/mines';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const session = await auth.api.getSession({
    headers: request.headers
  });

  if (!session?.user) {
    throw error(401, 'Not authenticated');
  }

  try {
    const { sessionToken } = await request.json();
    const userId = Number(session.user.id);

    const sessionRaw = await redis.get(getSessionKey(sessionToken));
    const game = sessionRaw ? JSON.parse(sessionRaw) : null;

    if (!game) {
      return json({ error: 'Invalid session' }, { status: 400 });
    }

    if (game.userId !== userId) {
      return json({ error: 'Unauthorized: Session belongs to another user' }, { status: 403 });
    }

    return json({
      minePositions: game.minePositions
    });

  } catch (e) {
    console.error('Mines positions error:', e);
    const errorMessage = e instanceof Error ? e.message : 'Internal server error';
    return json({ error: errorMessage }, { status: 400 });
  }
};
