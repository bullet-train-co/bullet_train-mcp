#!/usr/bin/env tsx
/**
 * Bullet Train Multi-Tenant MCP Server
 *
 * This server provides:
 * 1. OAuth 2.0 endpoints that proxy to Bullet Train
 * 2. MCP server that uses Bearer tokens from incoming requests
 * 3. Full ChatGPT integration support
 */

import express from 'express';
import axios from 'axios';
import * as http from 'http';
import {
  OpenAPIServer,
  BearerTokenAuthProvider,
  StreamableHttpServerTransport
} from './src/index.js';

// Configuration
const BULLET_TRAIN_BASE_URL = process.env.BULLET_TRAIN_BASE_URL || 'http://localhost:3000';
const BULLET_TRAIN_API_VERSION = process.env.BULLET_TRAIN_API_VERSION || 'v1';
const BULLET_TRAIN_API_URL = `${BULLET_TRAIN_BASE_URL}/api/${BULLET_TRAIN_API_VERSION}`;
const BULLET_TRAIN_OPENAPI_SPEC = `${BULLET_TRAIN_API_URL}/openapi.yaml`;
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3001', 10);
const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${SERVER_PORT}`;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable Express's default error handler for cleaner integration
app.set('env', 'production');

// CORS headers for OAuth flow
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

/**
 * OAuth 2.0 Discovery Endpoints
 */

// OAuth Protected Resource Discovery
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: PUBLIC_URL,
    authorization_servers: [PUBLIC_URL],
    bearer_methods_supported: ['header']
  });
});

// OAuth Authorization Server Metadata
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_URL}/oauth/token`,
    grant_types_supported: ['authorization_code', 'client_credentials'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic']
  });
});

/**
 * OAuth 2.0 Authorization Endpoint
 * Redirects to Bullet Train's authorization page
 */
app.get('/oauth/authorize', async (req, res) => {
  try {
    const { client_id, redirect_uri, state, response_type, resource } = req.query;

    console.error('OAuth authorize request:', { client_id, redirect_uri, state, response_type, resource });

    // Validate required parameters
    if (!client_id || !redirect_uri || !state) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters: client_id, redirect_uri, or state'
      });
    }

    // Build Bullet Train authorization URL
    const bulletTrainAuthUrl = new URL(`${BULLET_TRAIN_BASE_URL}/oauth/authorize`);
    bulletTrainAuthUrl.searchParams.set('client_id', client_id as string);
    bulletTrainAuthUrl.searchParams.set('redirect_uri', redirect_uri as string);
    bulletTrainAuthUrl.searchParams.set('state', state as string);
    bulletTrainAuthUrl.searchParams.set('response_type', response_type as string || 'code');

    console.error('Redirecting to Bullet Train:', bulletTrainAuthUrl.toString());

    // Redirect to Bullet Train's authorization endpoint
    res.redirect(bulletTrainAuthUrl.toString());
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error during authorization'
    });
  }
});

/**
 * OAuth 2.0 Token Endpoint
 * Proxies token exchange to Bullet Train
 */
app.post('/oauth/token', async (req, res) => {
  try {
    const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;

    console.error('OAuth token request:', { grant_type, code, client_id, redirect_uri });

    // Validate required parameters
    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing client_id or client_secret'
      });
    }

    if (grant_type === 'authorization_code' && !code) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing authorization code'
      });
    }

    // Forward token request to Bullet Train
    const tokenResponse = await axios.post(
      `${BULLET_TRAIN_BASE_URL}/oauth/token`,
      {
        grant_type,
        code,
        redirect_uri,
        client_id,
        client_secret
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        // Convert to URL-encoded format
        transformRequest: [(data) => {
          return Object.keys(data)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key] || '')}`)
            .join('&');
        }]
      }
    );

    console.error('Bullet Train token response:', {
      status: tokenResponse.status,
      token_type: tokenResponse.data?.token_type,
      expires_in: tokenResponse.data?.expires_in
    });

    // Return Bullet Train's token directly to the client
    res.json(tokenResponse.data);
  } catch (error) {
    console.error('Token exchange error:', error);

    if (axios.isAxiosError(error) && error.response) {
      // Forward Bullet Train's error response
      return res.status(error.response.status).json(error.response.data);
    }

    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error during token exchange'
    });
  }
});

/**
 * Status check endpoint (separate from MCP transport's /health)
 */
app.get('/status', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    bulletTrain: {
      baseUrl: BULLET_TRAIN_BASE_URL,
      apiVersion: BULLET_TRAIN_API_VERSION,
      apiUrl: BULLET_TRAIN_API_URL
    },
    publicUrl: PUBLIC_URL
  });
});

/**
 * Root endpoint - server info
 */
app.get('/', (req, res) => {
  res.json({
    name: 'Bullet Train MCP Server',
    version: '1.0.0',
    description: 'Multi-tenant MCP server for Bullet Train API',
    endpoints: {
      mcp: `${PUBLIC_URL}/mcp`,
      oauth: {
        authorize: `${PUBLIC_URL}/oauth/authorize`,
        token: `${PUBLIC_URL}/oauth/token`,
        discovery: `${PUBLIC_URL}/.well-known/oauth-authorization-server`
      },
      status: `${PUBLIC_URL}/status`
    }
  });
});

/**
 * Start the server
 */
async function main() {
  try {
    // Create MCP server with BearerTokenAuthProvider
    // Note: apiBaseUrl uses the versioned API URL, while OAuth uses the base URL
    const mcpServer = new OpenAPIServer({
      name: 'Bullet Train MCP Server',
      version: '1.0.0',
      apiBaseUrl: BULLET_TRAIN_API_URL,
      openApiSpec: BULLET_TRAIN_OPENAPI_SPEC,
      specInputMethod: 'url',
      authProvider: new BearerTokenAuthProvider(),
      transportType: 'http',
      httpPort: SERVER_PORT,
      httpHost: SERVER_HOST,
      endpointPath: '/mcp',
      toolsMode: 'all'
    });

    // Create MCP transport (creates its own HTTP server)
    const mcpTransport = new StreamableHttpServerTransport(
      SERVER_PORT,
      SERVER_HOST,
      '/mcp'
    );

    // Start MCP server
    await mcpServer.start(mcpTransport);

    // Get the HTTP server from the transport and add Express middleware
    // We'll use Express as middleware on top of the MCP server
    const httpServer = (mcpTransport as any).server as http.Server;

    // Remove MCP's request handler temporarily
    const mcpHandler = httpServer.listeners('request')[0] as any;
    httpServer.removeAllListeners('request');

    // Add Express first, then MCP handler for /mcp only
    httpServer.on('request', (req, res) => {
      // Let Express handle non-MCP routes
      if (!req.url?.startsWith('/mcp')) {
        app(req, res);
      } else {
        // Pass MCP routes to the MCP handler
        mcpHandler(req, res);
      }
    });

    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║   Bullet Train Multi-Tenant MCP Server                     ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`🚀 Server running at: ${PUBLIC_URL}`);
    console.error('');
    console.error('📡 Endpoints:');
    console.error(`   MCP:                ${PUBLIC_URL}/mcp`);
    console.error(`   OAuth Authorize:    ${PUBLIC_URL}/oauth/authorize`);
    console.error(`   OAuth Token:        ${PUBLIC_URL}/oauth/token`);
    console.error(`   Discovery:          ${PUBLIC_URL}/.well-known/oauth-authorization-server`);
    console.error(`   Status:             ${PUBLIC_URL}/status`);
    console.error('');
    console.error('🔗 Bullet Train API:');
    console.error(`   Base URL:           ${BULLET_TRAIN_BASE_URL}`);
    console.error(`   API Version:        ${BULLET_TRAIN_API_VERSION}`);
    console.error(`   API URL:            ${BULLET_TRAIN_API_URL}`);
    console.error(`   OpenAPI Spec:       ${BULLET_TRAIN_OPENAPI_SPEC}`);
    console.error('');
    console.error('✅ Ready for ChatGPT connections!');
    console.error('');
    console.error('💡 Next steps:');
    console.error('   1. If using ngrok/tunneling: Update PUBLIC_URL environment variable');
    console.error('   2. Add this server to ChatGPT with your Bullet Train credentials');
    console.error('   3. Each user will authenticate with their own Bullet Train client ID/secret');
    console.error('');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.error('Shutting down gracefully...');
      await mcpTransport.close();
      console.error('Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run the server
main();
