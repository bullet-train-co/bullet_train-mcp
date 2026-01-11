# Bullet Train Multi-Tenant MCP Server Setup

This guide shows you how to run a multi-tenant MCP server that integrates with your Bullet Train API and ChatGPT.

## Architecture

```
ChatGPT Client
    ↓ (OAuth flow)
Your MCP Server (this)
    ├─ OAuth endpoints → Proxy to Bullet Train
    └─ MCP endpoint → Uses Bearer tokens from ChatGPT
        ↓ (with user's token)
Bullet Train API
```

Each ChatGPT user provides their own Bullet Train client ID and secret. The server proxies OAuth to Bullet Train and uses the resulting tokens for API calls.

## Quick Start

### 1. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.bullet-train.example .env
```

Edit `.env` with your Bullet Train API details:

```bash
# Your Bullet Train API
BULLET_TRAIN_BASE_URL=http://localhost:3000
BULLET_TRAIN_API_VERSION=v1  # Optional, defaults to v1. Set to v2 for API v2.

# Where this MCP server will run
SERVER_PORT=3001
SERVER_HOST=0.0.0.0

# Public URL (important for OAuth redirects)
PUBLIC_URL=http://localhost:3001
```

### 2. Start Your Bullet Train API

Make sure your Bullet Train API is running at the configured URL (default: `http://localhost:3000`).

### 3. Start the MCP Server

```bash
npm run start:bullet-train
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║   Bullet Train Multi-Tenant MCP Server                     ║
╚════════════════════════════════════════════════════════════╝

🚀 Server running at: http://localhost:3001

📡 Endpoints:
   MCP:                http://localhost:3001/mcp
   OAuth Authorize:    http://localhost:3001/oauth/authorize
   OAuth Token:        http://localhost:3001/oauth/token
   Discovery:          http://localhost:3001/.well-known/oauth-authorization-server
   Health:             http://localhost:3001/health

✅ Ready for ChatGPT connections!
```

## Testing Locally with ChatGPT

### Option A: Using ngrok (Recommended)

ChatGPT needs a publicly accessible URL. Use ngrok to tunnel to your local server:

```bash
# Install ngrok
brew install ngrok

# Start tunnel
ngrok http 3001
```

Ngrok will give you a public URL like `https://abc123.ngrok-free.app`

Update your `.env`:

```bash
PUBLIC_URL=https://abc123.ngrok-free.app
```

Restart the server:

```bash
npm run start:bullet-train
```

### Option B: Direct Connection (Advanced)

If you have a public IP or are running on a server accessible to ChatGPT, update `PUBLIC_URL` to your server's address.

## Connecting to ChatGPT

1. **Open ChatGPT** and go to Settings → Custom GPTs → Add MCP Server

2. **Enter Server Details:**
   - **Server URL**: Your PUBLIC_URL (e.g., `https://abc123.ngrok-free.app`)
   - **Authentication**: OAuth 2.0
   - **Client ID**: User's Bullet Train Client ID (e.g., `_lbeHVEagmrglXnvjBfHv_WOg309XvJiGf35QrB1oT4`)
   - **Client Secret**: User's Bullet Train Client Secret (e.g., `QG1JXfxCuA-CGcbzIuzKDSav3FHpF-c86LIv2UOALe4`)

3. **Authorize**: ChatGPT will redirect the user to Bullet Train's authorization page

4. **Done!** ChatGPT can now call your Bullet Train API on behalf of the user

## How It Works

### OAuth Flow

1. **User adds server in ChatGPT** with their Bullet Train credentials
2. **ChatGPT discovers OAuth endpoints** via `/.well-known/oauth-authorization-server`
3. **ChatGPT redirects to** `/oauth/authorize`
   - Your server forwards to Bullet Train's authorize endpoint
4. **User approves in Bullet Train**
5. **Bullet Train redirects back** with authorization code
6. **ChatGPT exchanges code for token** at `/oauth/token`
   - Your server proxies the request to Bullet Train
   - Bullet Train returns an access token
7. **ChatGPT stores the token** and includes it on every MCP request

### MCP Request Flow

1. **ChatGPT → Your Server**: `POST /mcp` with `Authorization: Bearer <bullet_train_token>`
2. **Transport Layer**: Extracts Bearer token from header, stores in AsyncLocalStorage
3. **BearerTokenAuthProvider**: Reads token from AsyncLocalStorage
4. **API Call**: Makes request to Bullet Train with user's token
5. **Response**: Returns data back to ChatGPT

## Multi-Tenancy

Each user's requests are automatically isolated:

- ✅ **Per-user authentication**: Each ChatGPT user provides their own credentials
- ✅ **Token isolation**: AsyncLocalStorage ensures tokens don't leak between requests
- ✅ **Concurrent users**: Handles multiple users making requests simultaneously
- ✅ **No server-side storage**: Tokens are managed by ChatGPT and Bullet Train

## Troubleshooting

### ChatGPT can't reach the server

- ✅ Check that `PUBLIC_URL` is publicly accessible
- ✅ Verify ngrok tunnel is running
- ✅ Ensure firewall allows incoming connections on your port

### OAuth flow fails

- ✅ Verify Bullet Train API is running and accessible
- ✅ Check client ID and secret are correct
- ✅ Look at server logs for error messages
- ✅ Ensure redirect URIs match
- ✅ Make sure `BULLET_TRAIN_BASE_URL` does NOT include `/api/v1` (OAuth endpoints are at the root)

### API calls return 401

- ✅ Token may have expired - ChatGPT should refresh automatically
- ✅ Check Bullet Train token endpoint is working
- ✅ Verify Bearer token is being passed correctly

### Check server health

```bash
curl http://localhost:3001/health
```

Should return:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-10T...",
  "bulletTrain": "http://localhost:3000",
  "publicUrl": "http://localhost:3001"
}
```

## Production Deployment

For production:

1. **Deploy to a server** (AWS, GCP, Heroku, etc.)
2. **Set PUBLIC_URL** to your production domain
3. **Use HTTPS** (required for ChatGPT OAuth)
4. **Set up monitoring** for health endpoint
5. **Configure rate limiting** if needed
6. **Update Bullet Train** OAuth settings with production URLs

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BULLET_TRAIN_BASE_URL` | Base URL of your Bullet Train API (no `/api/v1`) | `http://localhost:3000` | Yes |
| `BULLET_TRAIN_API_VERSION` | API version to use | `v1` | No |
| `SERVER_PORT` | Port for MCP server | `3001` | No |
| `SERVER_HOST` | Host to bind to | `0.0.0.0` | No |
| `PUBLIC_URL` | Public URL for OAuth redirects | `http://localhost:{PORT}` | Yes |

## Example: Testing with curl

```bash
# Get a Bullet Train token
TOKEN=$(curl -s -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" | jq -r '.access_token')

# Initialize MCP session
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "id": 1,
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'
```

## Support

For issues:
- Check server logs for detailed error messages
- Verify Bullet Train API is accessible
- Test OAuth flow manually with curl
- Ensure all environment variables are set correctly
