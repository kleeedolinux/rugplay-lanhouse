import { error } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET({ params, request }) {
    const path = params.path;
    
    if (!path) {
        throw error(400, 'Path is required');
    }

    // Security: prevent path traversal
    if (path.includes('..') || path.startsWith('/')) {
        throw error(400, 'Invalid path');
    }

    try {
        const uploadsDir = join(process.cwd(), 'uploads');
        const filePath = join(uploadsDir, path);

        // Ensure file is within uploads directory
        if (!filePath.startsWith(uploadsDir)) {
            throw error(403, 'Access denied');
        }

        if (!existsSync(filePath)) {
            throw error(404, 'File not found');
        }

        const buffer = readFileSync(filePath);
        
        // Determine content type from file extension
        let contentType = 'application/octet-stream';
        if (path.endsWith('.webp')) {
            contentType = 'image/webp';
        } else if (path.endsWith('.png')) {
            contentType = 'image/png';
        } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (path.endsWith('.gif')) {
            contentType = 'image/gif';
        }

        let cacheControl: string;
        
        if (path.includes('coins/') || path.includes('coin')) {
            cacheControl = 'public, max-age=31536000, immutable';
        } else if (path.includes('avatars/') || path.includes('avatar')) {
            cacheControl = 'public, max-age=60';
        } else {
            cacheControl = 'public, max-age=86400';
        }

        return new Response(buffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': cacheControl,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    } catch (e: any) {
        if (e.status) {
            throw e;
        }
        console.error('File proxy error:', e);
        throw error(500, 'Failed to serve file');
    }
}
