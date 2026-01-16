import type { ServerWebSocket } from 'bun';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

const HEARTBEAT_INTERVAL = 30_000;

type WebSocketData = {
	coinSymbol?: string;
	userId?: string;
	lastActivity: number;
};

// In-memory stores for WebSocket connections
const coinSockets = new Map<string, Set<ServerWebSocket<WebSocketData>>>();
const userSockets = new Map<string, Set<ServerWebSocket<WebSocketData>>>();
const pingIntervals = new WeakMap<ServerWebSocket<WebSocketData>, NodeJS.Timeout>();

// In-memory cache for recent messages (optimized with size limits)
const MAX_CACHE_SIZE = 1000;
const messageCache = new Map<string, { data: string; timestamp: number }>();

// Optimized message broadcasting functions
function broadcastToCoin(coinSymbol: string, message: string) {
	const sockets = coinSockets.get(coinSymbol);
	if (!sockets || sockets.size === 0) return;

	const openSockets: ServerWebSocket<WebSocketData>[] = [];
	for (const ws of sockets) {
		if (ws.readyState === WebSocket.OPEN) {
			openSockets.push(ws);
		}
	}

	// Batch send to all open sockets
	for (const ws of openSockets) {
		try {
			ws.send(message);
		} catch (error) {
			console.error('Error sending message to socket:', error);
		}
	}
}

function broadcastToUser(userId: string, message: string) {
	const sockets = userSockets.get(userId);
	if (!sockets || sockets.size === 0) return;

	const openSockets: ServerWebSocket<WebSocketData>[] = [];
	for (const ws of sockets) {
		if (ws.readyState === WebSocket.OPEN) {
			openSockets.push(ws);
		}
	}

	for (const ws of openSockets) {
		try {
			ws.send(message);
		} catch (error) {
			console.error('Error sending message to socket:', error);
		}
	}
}

function broadcastToAll(message: string) {
	const allSockets = new Set<ServerWebSocket<WebSocketData>>();

	for (const sockets of coinSockets.values()) {
		for (const ws of sockets) {
			if (ws.readyState === WebSocket.OPEN) {
				allSockets.add(ws);
			}
		}
	}

	for (const sockets of userSockets.values()) {
		for (const ws of sockets) {
			if (ws.readyState === WebSocket.OPEN) {
				allSockets.add(ws);
			}
		}
	}

	for (const ws of allSockets) {
		try {
			ws.send(message);
		} catch (error) {
			console.error('Error broadcasting to socket:', error);
		}
	}
}

// Public API for publishing messages (can be called from other services)
export function publishComment(coinSymbol: string, commentData: unknown) {
	const message = typeof commentData === 'string' ? commentData : JSON.stringify(commentData);
	broadcastToCoin(coinSymbol, message);
	
	// Cache the message
	const cacheKey = `comments:${coinSymbol}`;
	messageCache.set(cacheKey, { data: message, timestamp: Date.now() });
	cleanupCache();
}

export function publishPrice(coinSymbol: string, priceData: unknown) {
	const priceMessage = JSON.stringify({
		type: 'price_update',
		coinSymbol,
		...(typeof priceData === 'object' && priceData !== null ? priceData : { data: priceData })
	});
	
	broadcastToCoin(coinSymbol, priceMessage);
	
	// Cache the message
	const cacheKey = `prices:${coinSymbol}`;
	messageCache.set(cacheKey, { data: priceMessage, timestamp: Date.now() });
	cleanupCache();
}

export function publishNotification(userId: string, notificationData: unknown) {
	const message = typeof notificationData === 'string' ? notificationData : JSON.stringify(notificationData);
	broadcastToUser(userId, message);
	
	// Cache the message
	const cacheKey = `notifications:${userId}`;
	messageCache.set(cacheKey, { data: message, timestamp: Date.now() });
	cleanupCache();
}

export function publishTrade(tradeData: unknown, isLarge = false) {
	const message = typeof tradeData === 'string' ? tradeData : JSON.stringify(tradeData);
	broadcastToAll(message);
	
	// Cache the message
	const cacheKey = isLarge ? 'trades:large' : 'trades:all';
	messageCache.set(cacheKey, { data: message, timestamp: Date.now() });
	cleanupCache();
}

export function publishGamblingActivity(activityData: unknown) {
	const eventMessage = JSON.stringify({
		type: 'gambling_activity',
		...(typeof activityData === 'object' && activityData !== null ? activityData : { data: activityData })
	});
	
	broadcastToAll(eventMessage);
	
	// Cache the message
	messageCache.set('gambling:activity', { data: eventMessage, timestamp: Date.now() });
	cleanupCache();
}

// Cleanup old cache entries to prevent memory leaks
function cleanupCache() {
	if (messageCache.size <= MAX_CACHE_SIZE) return;

	const entries = Array.from(messageCache.entries());
	entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
	
	const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
	for (const [key] of toRemove) {
		messageCache.delete(key);
	}
}

// Periodic cache cleanup
setInterval(cleanupCache, HEARTBEAT_INTERVAL * 2);

function handleSetCoin(ws: ServerWebSocket<WebSocketData>, coinSymbol: string) {
	if (ws.data.coinSymbol) {
		const prev = coinSockets.get(ws.data.coinSymbol);
		if (prev) {
			prev.delete(ws);
			if (prev.size === 0) {
				coinSockets.delete(ws.data.coinSymbol);
			}
		}
	}

	ws.data.coinSymbol = coinSymbol;

	if (!coinSockets.has(coinSymbol)) {
		coinSockets.set(coinSymbol, new Set([ws]));
	} else {
		coinSockets.get(coinSymbol)!.add(ws);
	}
}

function handleSetUser(ws: ServerWebSocket<WebSocketData>, userId: string) {
	if (ws.data.userId) {
		const prev = userSockets.get(ws.data.userId);
		if (prev) {
			prev.delete(ws);
			if (prev.size === 0) {
				userSockets.delete(ws.data.userId);
			}
		}
	}

	ws.data.userId = userId;

	if (!userSockets.has(userId)) {
		userSockets.set(userId, new Set([ws]));
	} else {
		userSockets.get(userId)!.add(ws);
	}
}

function checkConnections() {
	const now = Date.now();
	for (const [coinSymbol, sockets] of coinSockets.entries()) {
		const staleSockets = Array.from(sockets).filter(ws => now - ws.data.lastActivity > HEARTBEAT_INTERVAL * 2);
		for (const socket of staleSockets) {
			socket.terminate();
		}
	}
}

setInterval(checkConnections, HEARTBEAT_INTERVAL);

const server = Bun.serve<WebSocketData, undefined>({
	port: Number(process.env.PORT) || 8080,

	fetch(request, server) {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return new Response(JSON.stringify({
				status: 'ok',
				timestamp: new Date().toISOString(),
				activeConnections: Array.from(coinSockets.values()).reduce((total, set) => total + set.size, 0)
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const upgraded = server.upgrade(request, {
			data: {
				coinSymbol: undefined,
				lastActivity: Date.now()
			}
		});

		return upgraded ? undefined : new Response('Upgrade failed', { status: 500 });
	},

	websocket: {
		message(ws, msg) {
			ws.data.lastActivity = Date.now();

			if (typeof msg !== 'string') return;

			try {
				const data = JSON.parse(msg) as {
					type: string;
					coinSymbol?: string;
					userId?: string;
				};

				if (data.type === 'set_coin' && data.coinSymbol) {
					handleSetCoin(ws, data.coinSymbol);
				} else if (data.type === 'set_user' && data.userId) {
					handleSetUser(ws, data.userId);
				} else if (data.type === 'pong') {
					ws.data.lastActivity = Date.now();
				}
			} catch (error) {
				console.error('Message parsing error:', error);
			}
		},
		open(ws) {
			const interval = setInterval(() => {
				if (ws.readyState === 1) {
					ws.data.lastActivity = Date.now();
					ws.send(JSON.stringify({ type: 'ping' }));
				} else {
					clearInterval(interval);
				}
			}, HEARTBEAT_INTERVAL);

			pingIntervals.set(ws, interval);
		}, close(ws) {
			const interval = pingIntervals.get(ws);
			if (interval) {
				clearInterval(interval);
				pingIntervals.delete(ws);
			}

			if (ws.data.coinSymbol) {
				const sockets = coinSockets.get(ws.data.coinSymbol);
				if (sockets) {
					sockets.delete(ws);
					if (sockets.size === 0) {
						coinSockets.delete(ws.data.coinSymbol);
					}
				}
			}

			if (ws.data.userId) {
				const sockets = userSockets.get(ws.data.userId);
				if (sockets) {
					sockets.delete(ws);
					if (sockets.size === 0) {
						userSockets.delete(ws.data.userId);
					}
				}
			}
		}
	}
});

console.log(`WebSocket server running on port ${server.port}`);
console.log('Server listening for connections...');
console.log('Health check available at: http://localhost:8080/health');
