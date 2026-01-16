# Rugplay Website


This is the main website component of Rugplay, built with SvelteKit. It handles the user interface, trading functionality, and market visualization.

## Development

### Prerequisites

- Node.js (LTS version)
- Redis running in the background
- OpenRouter API key (for AI features)
- AWS S3/B2 Storage (for file uploads)

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Key variables to configure:
- `PUBLIC_BETTER_AUTH_URL`: Set to `http://localhost:3002` if you want to deploy
- `OPENROUTER_API_KEY`: Your OpenRouter API key for AI features
- AWS credentials (optional but recommended)

### Running in Development

```bash
npm install
npm run dev
```

The development server will be available at http://localhost:5173

### Building for Production

```bash
npm run build
npm run preview
```

### Deploying to PaaS (Platform as a Service)

If you're deploying to a PaaS that only supports port 80 (like Railway, Render, Fly.io, etc.), configure your environment variables as follows:

#### Environment Variables for PaaS

```bash
# Authentication
PRIVATE_BETTER_AUTH_SECRET=your_super_secret_auth_key_here
PUBLIC_BETTER_AUTH_URL=https://seu-dominio.com  # Use HTTPS and your actual domain (no port needed, port 80/443 is default)

# Google OAuth - Update these in Google Cloud Console
# Add your production callback URL:
# https://seu-dominio.com/api/auth/callback/google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**Important Notes:**
- **PUBLIC_BETTER_AUTH_URL**: Use your production domain with `https://` (or `http://` if SSL is not available). Do NOT include a port number since port 80 (HTTP) and 443 (HTTPS) are the default ports.
  - ✅ Correct: `https://rugplay.com` or `http://rugplay.com`
  - ❌ Wrong: `https://rugplay.com:80` or `http://localhost:3002`

- **Google OAuth Configuration**: Make sure to add your production callback URL in the [Google Cloud Console](https://console.cloud.google.com/auth/clients):
  - `https://seu-dominio.com/api/auth/callback/google` (or `http://` if not using SSL)

- **Port Configuration**: Most PaaS platforms automatically handle port 80/443, so you don't need to specify it in the URL.

#### Quick Setup Script

Use the setup script to configure everything:

```bash
npm run setup
```

This will:
1. Install all dependencies
2. Sync SvelteKit
3. Push database schema
4. Run migrations
5. Build the application

Then start the application:

```bash
npm run start
```

## Project Structure

- `src/routes/`: Page components and API endpoints
- `src/lib/`: Shared components and utilities
- `src/lib/components/`: Reusable UI components
- `static/`: Static assets (images, fonts, etc.)

## Features

- User authentication and profile management
- Real-time trading interface
- Market visualization with Treemap
- Leaderboards and statistics
- Integration with websocket server for live updates

## Contributing

1. Make sure Redis is running
2. Start the websocket server (see `websocket/README.md`)
3. Run the website in development mode
4. Make your changes
5. Test thoroughly
6. Submit a pull request
