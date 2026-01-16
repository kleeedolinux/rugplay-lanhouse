import { env } from '$env/dynamic/private';
import { building } from '$app/environment';

// Get REDIS_URL (optional - may not be defined)
const REDIS_URL = env.REDIS_URL || '';

// In-memory cache implementation
class InMemoryCache {
	private data = new Map<string, { value: string; expiresAt?: number }>();
	private subscribers = new Map<string, Set<(message: string) => void>>();
	private maxSize = 10000; // Limit cache size to prevent memory issues

	private cleanup() {
		const now = Date.now();
		for (const [key, entry] of this.data.entries()) {
			if (entry.expiresAt && entry.expiresAt < now) {
				this.data.delete(key);
			}
		}

		// If cache is too large, remove oldest entries
		if (this.data.size > this.maxSize) {
			const entries = Array.from(this.data.entries());
			entries.sort((a, b) => (a[1].expiresAt || 0) - (b[1].expiresAt || 0));
			const toRemove = entries.slice(0, this.data.size - this.maxSize);
			for (const [key] of toRemove) {
				this.data.delete(key);
			}
		}
	}

	async set(key: string, value: string, options?: { EX?: number }): Promise<void> {
		this.cleanup();
		const expiresAt = options?.EX ? Date.now() + options.EX * 1000 : undefined;
		this.data.set(key, { value, expiresAt });
	}

	async get(key: string): Promise<string | null> {
		this.cleanup();
		const entry = this.data.get(key);
		if (!entry) return null;
		if (entry.expiresAt && entry.expiresAt < Date.now()) {
			this.data.delete(key);
			return null;
		}
		return entry.value;
	}

	async del(key: string): Promise<number> {
		const existed = this.data.has(key);
		this.data.delete(key);
		return existed ? 1 : 0;
	}

	async exists(key: string): Promise<number> {
		this.cleanup();
		const entry = this.data.get(key);
		if (!entry) return 0;
		if (entry.expiresAt && entry.expiresAt < Date.now()) {
			this.data.delete(key);
			return 0;
		}
		return 1;
	}

	async publish(channel: string, message: string): Promise<number> {
		// Store published messages for potential subscribers (in-memory pub/sub simulation)
		const subscribers = this.subscribers.get(channel);
		if (subscribers) {
			for (const callback of subscribers) {
				try {
					callback(message);
				} catch (error) {
					console.error('Error in subscriber callback:', error);
				}
			}
		}
		// Return number of subscribers (simulate Redis behavior)
		return subscribers ? subscribers.size : 0;
	}

	async eval(script: string, options: { keys?: string[]; arguments?: string[] }): Promise<unknown> {
		// Simple Lua script interpreter for common operations
		const { keys = [], arguments: args = [] } = options;
		
		// Handle the mines game script pattern
		if (script.includes('redis.call("exists"') && script.includes('redis.call("set"')) {
			if (keys.length > 0) {
				const key = keys[0];
				const exists = await this.exists(key);
				if (exists === 1 && args.length > 0) {
					await this.set(key, args[0]);
					return 1;
				}
				return 0;
			}
		}
		
		// Default: return 0 for unknown scripts
		return 0;
	}

	subscribe(channel: string, callback: (message: string) => void): void {
		if (!this.subscribers.has(channel)) {
			this.subscribers.set(channel, new Set());
		}
		this.subscribers.get(channel)!.add(callback);
	}

	unsubscribe(channel: string, callback: (message: string) => void): void {
		const subscribers = this.subscribers.get(channel);
		if (subscribers) {
			subscribers.delete(callback);
			if (subscribers.size === 0) {
				this.subscribers.delete(channel);
			}
		}
	}
}

// Use Redis if available, otherwise use in-memory cache
let redis: InMemoryCache | any;

// Check if REDIS_URL is properly configured (not empty string)
const isRedisConfigured = Boolean(REDIS_URL && REDIS_URL.trim() !== '');

if (isRedisConfigured && !building) {
	try {
		const { createClient } = await import('redis');
		const client = createClient({ url: REDIS_URL });
		client.on('error', (err: any) => console.error('Redis Client Error:', err));
		await client.connect().catch(console.error);
		redis = client;
		console.log('Using Redis for caching');
	} catch (error) {
		console.warn('Redis not available, using in-memory cache:', error);
		redis = new InMemoryCache();
	}
} else {
	redis = new InMemoryCache();
	if (!building) {
		console.log('Using in-memory cache (Redis not configured)');
	}
}

export { redis };
