import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load SSL certificates from the certificate folder if they exist
 * Certificate folder is in website/certificate
 */
function loadCertificates() {
	// Try multiple possible paths
	const possiblePaths = [
		join(__dirname, '../../../../certificate'), // From src/lib/server/db to website/certificate
		join(process.cwd(), 'certificate'), // From current working directory
		join(process.cwd(), 'website', 'certificate'), // If running from project root
	];

	let certDir: string | undefined;
	for (const path of possiblePaths) {
		if (existsSync(path)) {
			certDir = path;
			break;
		}
	}

	if (!certDir) {
		return undefined;
	}

	const files = readdirSync(certDir);
	let cert: string | undefined;
	let key: string | undefined;
	let ca: string | undefined;

	for (const file of files) {
		const filePath = join(certDir, file);
		const ext = file.split('.').pop()?.toLowerCase();
		const content = readFileSync(filePath, 'utf8');

		if (ext === 'pem') {
			// .pem files can contain both certificate and private key
			if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
				// Extract private key from PEM file
				const keyMatch = content.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/);
				if (keyMatch && !key) {
					key = keyMatch[0];
				}
				
				// Extract certificate from PEM file
				const certMatch = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
				if (certMatch && !cert) {
					cert = certMatch[0];
				}
			} else if (content.includes('BEGIN CERTIFICATE')) {
				// Just a certificate, use as cert or CA
				if (!cert) {
					cert = content;
				} else if (!ca) {
					ca = content;
				}
			}
		} else if (ext === 'key') {
			key = content;
		} else if (ext === 'crt') {
			// .crt files are usually CA certificates
			ca = content;
		}
	}

	// If we have any certificates, return SSL config
	if (cert || key || ca) {
		console.log(`[SSL] Found certificates in ${certDir}:`);
		console.log(`[SSL]   - Certificate: ${cert ? 'YES (' + cert.length + ' chars)' : 'NO'}`);
		console.log(`[SSL]   - Private Key: ${key ? 'YES (' + key.length + ' chars)' : 'NO'}`);
		console.log(`[SSL]   - CA Certificate: ${ca ? 'YES (' + ca.length + ' chars)' : 'NO'}`);
		
		// Ensure we have both cert and key for client certificate authentication
		if (cert && key) {
			return {
				cert,
				key,
				ca,
				rejectUnauthorized: ca ? true : false // Only reject if we have CA to verify against
			};
		} else if (cert || ca) {
			// If we only have cert or CA, use it for server verification
			return {
				ca: ca || cert,
				rejectUnauthorized: true
			};
		}
	}

	return undefined;
}

const sslConfig = loadCertificates();

// Determine SSL configuration
// If certificates are available, use them
// Otherwise, if DATABASE_URL suggests SSL is required (cloud providers), use SSL without strict verification
function getSslConfig() {
	if (sslConfig) {
		return sslConfig;
	}

	// Check if DATABASE_URL suggests SSL is required (common for cloud providers)
	const dbUrl = env.DATABASE_URL || '';
	const requiresSsl = dbUrl.includes('sslmode=require') || 
	                    dbUrl.includes('ssl=true') ||
	                    // Common cloud provider patterns
	                    dbUrl.includes('amazonaws.com') ||
	                    dbUrl.includes('neon.tech') ||
	                    dbUrl.includes('supabase.co') ||
	                    dbUrl.includes('railway.app') ||
	                    dbUrl.includes('render.com') ||
	                    dbUrl.includes('squarecloud.app');

	if (requiresSsl) {
		// Use SSL but don't reject unauthorized certificates (for cloud providers)
		return {
			rejectUnauthorized: false
		};
	}

	return false;
}

// Get DATABASE_URL - don't modify it, postgres.js handles SSL via the ssl option
function getDatabaseUrl() {
	const dbUrl = env.DATABASE_URL || '';
	
	// Remove any invalid parameters that might cause issues
	// postgres.js doesn't support clientcert=1 in the URL
	let cleanUrl = dbUrl;
	
	// Remove clientcert parameter if present (not a valid PostgreSQL connection string parameter)
	cleanUrl = cleanUrl.replace(/[?&]clientcert=\d+/g, '');
	cleanUrl = cleanUrl.replace(/\?&/, '?'); // Fix double separators
	cleanUrl = cleanUrl.replace(/[?&]$/, ''); // Remove trailing separators
	
	return cleanUrl;
}

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
    client: postgres.Sql | undefined;
};

const databaseUrl = getDatabaseUrl();
const sslConfigResult = getSslConfig();

const client = globalForDb.client ?? postgres(databaseUrl, {
	ssl: sslConfigResult || undefined
});
if (env.NODE_ENV !== 'production') globalForDb.client = client;

export const db = drizzle(client, { schema });