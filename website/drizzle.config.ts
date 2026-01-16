import { defineConfig } from 'drizzle-kit';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

/**
 * Load SSL certificates from the certificate folder if they exist
 */
function loadCertificates() {
	// Try multiple possible paths (drizzle-kit runs from the config file's directory)
	const possiblePaths = [
		join(process.cwd(), 'certificate'), // From current working directory (usually where config is)
		join(process.cwd(), 'website', 'certificate'), // If running from project root
		join(process.cwd(), '..', 'certificate'), // If config is in a subdirectory
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
			// Validate that cert and key are in correct PEM format
			const certValid = cert.includes('BEGIN CERTIFICATE') && cert.includes('END CERTIFICATE');
			const keyValid = key.includes('BEGIN') && key.includes('PRIVATE KEY') && key.includes('END');
			
			if (!certValid || !keyValid) {
				console.error('[SSL] Warning: Certificate or key format may be invalid');
			}
			
			// For client certificate authentication, we need cert, key, and optionally ca
			// postgres-js expects these as strings (PEM format)
			const sslConfig: any = {
				cert: cert.trim(),
				key: key.trim()
			};
			
			// Add CA if available
			if (ca) {
				sslConfig.ca = ca.trim();
			}
			
			// rejectUnauthorized controls whether to verify server certificate
			// For client cert auth, we typically want to verify the server
			sslConfig.rejectUnauthorized = !!ca;
			
			console.log('[SSL] SSL config prepared with client certificate authentication');
			return sslConfig;
		} else if (cert || ca) {
			// If we only have cert or CA, use it for server verification
			return {
				ca: (ca || cert)?.trim(),
				rejectUnauthorized: true
			};
		}
	}

	return undefined;
}

const sslConfig = loadCertificates();

// Determine SSL configuration and modify DATABASE_URL if needed
// If certificates are available, use them
// Otherwise, if DATABASE_URL suggests SSL is required (cloud providers), use SSL without strict verification
function getSslConfig() {
	if (sslConfig) {
		console.log('[SSL] Using certificates for SSL connection');
		return sslConfig;
	}

	// Check if DATABASE_URL suggests SSL is required (common for cloud providers)
	const dbUrl = process.env.DATABASE_URL || '';
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
		console.log('[SSL] SSL required but no certificates found, using SSL without strict verification');
		// Use SSL but don't reject unauthorized certificates (for cloud providers)
		return {
			rejectUnauthorized: false
		};
	}

	return false;
}

// Get DATABASE_URL - clean it from invalid parameters
function getDatabaseUrl() {
	let dbUrl = process.env.DATABASE_URL || '';
	
	// Remove clientcert parameter if present (not a valid PostgreSQL connection string parameter)
	// postgres.js and drizzle-kit handle SSL via the ssl option, not URL parameters
	dbUrl = dbUrl.replace(/[?&]clientcert=\d+/g, '');
	dbUrl = dbUrl.replace(/\?&/, '?'); // Fix double separators
	dbUrl = dbUrl.replace(/[?&]$/, ''); // Remove trailing separators
	
	// Add sslmode=require if SSL is required and not already present
	const requiresSsl = !!sslConfig || 
	                    dbUrl.includes('squarecloud.app') ||
	                    dbUrl.includes('amazonaws.com') ||
	                    dbUrl.includes('neon.tech') ||
	                    dbUrl.includes('supabase.co');
	
	if (requiresSsl && !dbUrl.includes('sslmode=')) {
		const separator = dbUrl.includes('?') ? '&' : '?';
		dbUrl = `${dbUrl}${separator}sslmode=require`;
		console.log('[SSL] Added sslmode=require to DATABASE_URL');
	}
	
	return dbUrl;
}

const sslConfigResult = getSslConfig();
const databaseUrl = getDatabaseUrl();

console.log('[SSL] Final SSL config:', sslConfigResult ? 'enabled' : 'disabled');
if (sslConfigResult) {
	console.log('[SSL] SSL config keys:', Object.keys(sslConfigResult));
	console.log('[SSL] Has cert:', !!sslConfigResult.cert);
	console.log('[SSL] Has key:', !!sslConfigResult.key);
	console.log('[SSL] Has ca:', !!sslConfigResult.ca);
	
	// Validate certificate format
	if (sslConfigResult.cert) {
		const certValid = sslConfigResult.cert.includes('BEGIN CERTIFICATE') && sslConfigResult.cert.includes('END CERTIFICATE');
		console.log('[SSL] Certificate format valid:', certValid);
	}
	if (sslConfigResult.key) {
		const keyValid = sslConfigResult.key.includes('BEGIN') && sslConfigResult.key.includes('PRIVATE KEY') && sslConfigResult.key.includes('END');
		console.log('[SSL] Key format valid:', keyValid);
	}
}

// Parse DATABASE_URL to extract connection parameters
function parseDatabaseUrl(url: string) {
	try {
		const urlObj = new URL(url);
		return {
			host: urlObj.hostname,
			port: parseInt(urlObj.port) || 5432,
			database: urlObj.pathname.slice(1), // Remove leading '/'
			username: urlObj.username,
			password: urlObj.password
		};
	} catch (error) {
		console.error('[SSL] Failed to parse DATABASE_URL:', error);
		return null;
	}
}


// drizzle-kit configuration
// When we have SSL certificates, pass individual connection parameters with SSL
// Otherwise, use url (drizzle-kit will handle SSL via URL parameters)
const dbParams = parseDatabaseUrl(process.env.DATABASE_URL || '');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',

	dbCredentials: (sslConfigResult && sslConfigResult.cert && sslConfigResult.key && dbParams)
		? {
			// Pass individual parameters with SSL when we have client certificates
			host: dbParams.host,
			port: dbParams.port,
			database: dbParams.database,
			user: dbParams.username,
			password: dbParams.password,
			ssl: {
				cert: sslConfigResult.cert,
				key: sslConfigResult.key,
				ca: sslConfigResult.ca,
				rejectUnauthorized: sslConfigResult.rejectUnauthorized !== false
			}
		}
		: { 
			// Fallback to URL-based connection
			url: databaseUrl,
			ssl: sslConfigResult || undefined
		},

	verbose: true,
	strict: true,
	dialect: 'postgresql'
});
