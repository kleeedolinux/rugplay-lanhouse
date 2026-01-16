import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { processImage } from './image.js';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Get env vars (optional - may not be defined)
const PRIVATE_B2_KEY_ID = env.PRIVATE_B2_KEY_ID || '';
const PRIVATE_B2_APP_KEY = env.PRIVATE_B2_APP_KEY || '';
const PUBLIC_B2_BUCKET = publicEnv.PUBLIC_B2_BUCKET || '';
const PUBLIC_B2_ENDPOINT = publicEnv.PUBLIC_B2_ENDPOINT || '';
const PUBLIC_B2_REGION = publicEnv.PUBLIC_B2_REGION || 'us-east-1';
const PUBLIC_BETTER_AUTH_URL = publicEnv.PUBLIC_BETTER_AUTH_URL || '';

// Check if S3 is configured (all required env vars must be present and non-empty)
const isS3Configured = Boolean(
	PRIVATE_B2_KEY_ID && PRIVATE_B2_KEY_ID.trim() !== '' &&
	PRIVATE_B2_APP_KEY && PRIVATE_B2_APP_KEY.trim() !== '' &&
	PUBLIC_B2_BUCKET && PUBLIC_B2_BUCKET.trim() !== '' &&
	PUBLIC_B2_ENDPOINT && PUBLIC_B2_ENDPOINT.trim() !== ''
);

// Filesystem storage path
const UPLOADS_DIR = join(process.cwd(), 'uploads');
const AVATARS_DIR = join(UPLOADS_DIR, 'avatars');
const COINS_DIR = join(UPLOADS_DIR, 'coins');

// Ensure upload directories exist
if (!isS3Configured) {
	[UPLOADS_DIR, AVATARS_DIR, COINS_DIR].forEach(dir => {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	});
}

// Get base URL for file serving
function getBaseUrl(): string {
	if (isS3Configured && PUBLIC_B2_ENDPOINT) {
		return `${PUBLIC_B2_ENDPOINT}/${PUBLIC_B2_BUCKET}`;
	}
	// Use the app's base URL for local file serving
	const baseUrl = PUBLIC_BETTER_AUTH_URL || 'http://localhost:5173';
	return `${baseUrl}/api/proxy/files`;
}

// S3 Client (only if configured)
let s3Client: any = null;
if (isS3Configured) {
	try {
		const { S3Client } = await import('@aws-sdk/client-s3');
		s3Client = new S3Client({
			endpoint: PUBLIC_B2_ENDPOINT,
			region: PUBLIC_B2_REGION,
			credentials: {
				accessKeyId: PRIVATE_B2_KEY_ID,
				secretAccessKey: PRIVATE_B2_APP_KEY
			},
			forcePathStyle: true,
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});
		console.log('Using S3 for file storage');
	} catch (error) {
		console.warn('S3 not available, using filesystem storage:', error);
	}
} else {
	console.log('Using filesystem storage (S3 not configured)');
}

export async function generatePresignedUrl(key: string, contentType: string): Promise<string> {
	if (isS3Configured && s3Client) {
		const { PutObjectCommand } = await import('@aws-sdk/client-s3');
		const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
		const command = new PutObjectCommand({
			Bucket: PUBLIC_B2_BUCKET,
			Key: key,
			ContentType: contentType
		});
		return getSignedUrl(s3Client, command, { expiresIn: 3600 });
	}
	
	// For filesystem, return a URL that can be used for upload
	return `${getBaseUrl()}/${key}?upload=true`;
}

export async function deleteObject(key: string): Promise<void> {
	if (isS3Configured && s3Client) {
		const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
		const command = new DeleteObjectCommand({
			Bucket: PUBLIC_B2_BUCKET,
			Key: key
		});
		await s3Client.send(command);
		return;
	}

	// Filesystem: delete the file
	const filePath = join(UPLOADS_DIR, key);
	if (existsSync(filePath)) {
		unlinkSync(filePath);
	}
}

export async function generateDownloadUrl(key: string): Promise<string> {
	if (isS3Configured && s3Client) {
		const { GetObjectCommand } = await import('@aws-sdk/client-s3');
		const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
		const command = new GetObjectCommand({
			Bucket: PUBLIC_B2_BUCKET,
			Key: key
		});
		return getSignedUrl(s3Client, command, { expiresIn: 3600 });
	}

	// Filesystem: return local file URL
	return `${getBaseUrl()}/${key}`;
}

export async function uploadProfilePicture(
    identifier: string, // Can be user ID or a unique ID from social provider
    body: Uint8Array,
    contentType: string,
): Promise<string> {
    if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType.toLowerCase())) {
        throw new Error('Unsupported image format. Only JPEG, PNG, GIF, and WebP are allowed.');
    }

    const processedImage = await processImage(Buffer.from(body));
    const key = `avatars/${identifier}.webp`;

    if (isS3Configured && s3Client) {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const command = new PutObjectCommand({
            Bucket: PUBLIC_B2_BUCKET,
            Key: key,
            Body: processedImage.buffer,
            ContentType: processedImage.contentType,
            ContentLength: processedImage.size,
        });
        await s3Client.send(command);
    } else {
        // Filesystem: save to disk
        const filePath = join(AVATARS_DIR, `${identifier}.webp`);
        writeFileSync(filePath, processedImage.buffer);
    }

    return key;
}

export async function uploadCoinIcon(
    coinSymbol: string,
    body: Uint8Array,
    contentType: string,
): Promise<string> {
    if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType.toLowerCase())) {
        throw new Error('Unsupported image format. Only JPEG, PNG, GIF, and WebP are allowed.');
    }

    const processedImage = await processImage(Buffer.from(body));
    const key = `coins/${coinSymbol.toLowerCase()}.webp`;

    if (isS3Configured && s3Client) {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const command = new PutObjectCommand({
            Bucket: PUBLIC_B2_BUCKET,
            Key: key,
            Body: processedImage.buffer,
            ContentType: processedImage.contentType,
            ContentLength: processedImage.size,
        });
        await s3Client.send(command);
    } else {
        // Filesystem: save to disk
        const filePath = join(COINS_DIR, `${coinSymbol.toLowerCase()}.webp`);
        writeFileSync(filePath, processedImage.buffer);
    }

    return key;
}

export { s3Client };