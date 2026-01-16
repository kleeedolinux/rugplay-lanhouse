import { env } from '$env/dynamic/private';
import { PUBLIC_WEBSOCKET_URL } from '$env/static/public';

// Convert ws:// to http:// for API calls
function getWebSocketApiUrl(): string {
	const wsUrl = PUBLIC_WEBSOCKET_URL || 'ws://localhost:8080';
	return wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}

async function broadcastToWebSocket(endpoint: string, data: unknown): Promise<boolean> {
	const apiKey = env.WEBSOCKET_API_KEY;
	if (!apiKey) {
		console.warn(`WEBSOCKET_API_KEY not configured - ${endpoint} not broadcast`);
		return false;
	}

	try {
		const response = await fetch(`${getWebSocketApiUrl()}${endpoint}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			console.error(`Failed to broadcast to ${endpoint}:`, await response.text());
			return false;
		}
		return true;
	} catch (error) {
		console.error(`Error broadcasting to ${endpoint}:`, error);
		return false;
	}
}

export async function broadcastGamblingActivity(activityData: unknown): Promise<boolean> {
	return broadcastToWebSocket('/api/broadcast/gambling', activityData);
}

export async function broadcastTrade(tradeData: unknown, isLarge = false): Promise<boolean> {
	return broadcastToWebSocket('/api/broadcast/trade', { data: tradeData, isLarge });
}

export async function broadcastPrice(coinSymbol: string, priceData: unknown): Promise<boolean> {
	return broadcastToWebSocket('/api/broadcast/price', { coinSymbol, data: priceData });
}

export async function broadcastComment(coinSymbol: string, commentData: unknown): Promise<boolean> {
	return broadcastToWebSocket('/api/broadcast/comment', { coinSymbol, data: commentData });
}

export async function broadcastNotification(userId: string, notificationData: unknown): Promise<boolean> {
	return broadcastToWebSocket('/api/broadcast/notification', { userId, data: notificationData });
}
