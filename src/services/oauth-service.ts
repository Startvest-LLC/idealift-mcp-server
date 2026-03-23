import crypto from 'crypto';
import { getPool, sql } from './db.js';

/**
 * OAuth 2.0 Service for ChatGPT Integration
 *
 * Implements OAuth 2.0 Authorization Code flow for authenticating
 * ChatGPT users with IdeaLift workspaces.
 *
 * Tokens are persisted to the database to survive restarts/deployments.
 */

class OAuthService {
  // Configuration from environment
  private validClientIds: string[];
  private clientSecret: string;
  private validRedirectUris: string[];
  private allowedDomains: string[];
  private authCodeExpiry = 10 * 60 * 1000; // 10 minutes
  private accessTokenExpiry = 60 * 60 * 1000; // 1 hour
  private refreshTokenExpiry = 30 * 24 * 60 * 60 * 1000; // 30 days

  // In-memory fallback for when DB is unavailable
  private memoryAuthCodes: Map<string, {
    chatgptState: string;
    clientId: string;
    redirectUri: string;
    expiresAt: number;
    scopes: string[];
    idealiftUserId?: string;
    workspaceId?: string;
  }> = new Map();

  private memoryAccessTokens: Map<string, {
    idealiftUserId?: string;
    workspaceId?: string;
    clientId: string;
    expiresAt: number;
    scopes: string[];
  }> = new Map();

  private memoryRefreshTokens: Map<string, {
    idealiftUserId?: string;
    workspaceId?: string;
    clientId: string;
    expiresAt: number;
  }> = new Map();

  private dbAvailable = false;

  constructor() {
    this.validClientIds = [
      'idealift-chatgpt',
      'idealift-chatgpt-v2',
    ];
    this.clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
    this.validRedirectUris = [
      'https://chatgpt.com/aip/oauth/callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chat.openai.com/aip/oauth/callback',
      'https://platform.openai.com/oauth/callback',
      'https://chatgpt.com/aip/g/oauth/callback',
    ];

    // Also accept any chatgpt.com or openai.com redirect URI
    this.allowedDomains = ['chatgpt.com', 'openai.com', 'chat.openai.com', 'platform.openai.com'];

    // Initialize database connection
    this.initDb();

    // Cleanup expired tokens every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private async initDb(): Promise<void> {
    try {
      if (process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD) {
        await getPool();
        this.dbAvailable = true;
        console.log('[OAuth] Database persistence enabled');
      } else {
        console.log('[OAuth] Database not configured, using in-memory storage (tokens will not persist)');
      }
    } catch (error) {
      console.error('[OAuth] Database connection failed, using in-memory fallback:', error);
      this.dbAvailable = false;
    }
  }

  private isValidClientId(clientId: string): boolean {
    return this.validClientIds.includes(clientId);
  }

  private isValidRedirectUri(redirectUri: string): boolean {
    // First check exact match
    if (this.validRedirectUris.includes(redirectUri)) {
      return true;
    }

    // Then check if it's from an allowed domain
    try {
      const url = new URL(redirectUri);
      const isAllowedDomain = this.allowedDomains.some(domain =>
        url.hostname === domain || url.hostname.endsWith('.' + domain)
      );
      if (isAllowedDomain) {
        console.log('[OAuth] Accepted redirect_uri from allowed domain:', url.hostname);
        return true;
      }
    } catch {
      // Invalid URL
    }

    console.log('[OAuth] Rejected redirect_uri:', redirectUri);
    console.log('[OAuth] Valid URIs:', this.validRedirectUris);
    console.log('[OAuth] Allowed domains:', this.allowedDomains);
    return false;
  }

  private generateToken(length = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Handle authorization request (Step 1 of OAuth flow)
   */
  async authorize(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    scope?: string;
    responseType: string;
  }): Promise<{ redirectUrl?: string; error?: string; errorDescription?: string }> {
    const { clientId, redirectUri, state, scope, responseType } = params;

    console.log('[OAuth] Authorize request', { clientId, redirectUri, scope });

    if (!this.isValidClientId(clientId)) {
      return { error: 'invalid_client', errorDescription: 'Invalid client_id' };
    }

    if (!this.isValidRedirectUri(redirectUri)) {
      return { error: 'invalid_request', errorDescription: 'Invalid redirect_uri' };
    }

    if (responseType !== 'code') {
      return { error: 'unsupported_response_type', errorDescription: 'Only authorization code flow is supported' };
    }

    const authCode = this.generateToken();
    const expiresAt = new Date(Date.now() + this.authCodeExpiry);
    const scopes = scope ? scope.split(' ') : ['read', 'write'];

    // Store in database
    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        await pool.request()
          .input('code', sql.NVarChar, authCode)
          .input('clientId', sql.NVarChar, clientId)
          .input('redirectUri', sql.NVarChar, redirectUri)
          .input('chatgptState', sql.NVarChar, state)
          .input('scopes', sql.NVarChar, scopes.join(' '))
          .input('expiresAt', sql.DateTime2, expiresAt)
          .query(`
            INSERT INTO IdeaLift_ChatGPTAuthCodes (Code, ClientId, RedirectUri, ChatGPTState, Scopes, ExpiresAt)
            VALUES (@code, @clientId, @redirectUri, @chatgptState, @scopes, @expiresAt)
          `);
      } catch (error) {
        console.error('[OAuth] Failed to store auth code in DB:', error);
        // Fall back to memory
        this.memoryAuthCodes.set(authCode, {
          chatgptState: state,
          clientId,
          redirectUri,
          expiresAt: expiresAt.getTime(),
          scopes,
        });
      }
    } else {
      this.memoryAuthCodes.set(authCode, {
        chatgptState: state,
        clientId,
        redirectUri,
        expiresAt: expiresAt.getTime(),
        scopes,
      });
    }

    console.log('[OAuth] Auth code generated', { authCode: authCode.substring(0, 8) + '...' });

    const idealiftAuthUrl = process.env.IDEALIFT_APP_URL || 'https://idealift-app.azurewebsites.net';
    const loginUrl = new URL('/chatgpt/authorize', idealiftAuthUrl);
    loginUrl.searchParams.set('oauth_code', authCode);
    loginUrl.searchParams.set('state', state);

    return { redirectUrl: loginUrl.toString() };
  }

  /**
   * Complete authorization after user logs in to IdeaLift
   */
  async completeAuthorization(
    authCode: string,
    userId: string,
    workspaceId: string
  ): Promise<{ redirectUrl?: string; error?: string }> {
    let authData: { chatgptState: string; redirectUri: string; clientId: string; expiresAt: number } | null = null;

    // Try database first
    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('code', sql.NVarChar, authCode)
          .query(`
            SELECT ChatGPTState, RedirectUri, ClientId, ExpiresAt
            FROM IdeaLift_ChatGPTAuthCodes
            WHERE Code = @code
          `);

        if (result.recordset.length > 0) {
          const row = result.recordset[0];
          authData = {
            chatgptState: row.ChatGPTState,
            redirectUri: row.RedirectUri,
            clientId: row.ClientId,
            expiresAt: new Date(row.ExpiresAt).getTime(),
          };

          // Update with user info
          await pool.request()
            .input('code', sql.NVarChar, authCode)
            .input('userId', sql.NVarChar, userId)
            .input('workspaceId', sql.NVarChar, workspaceId)
            .query(`
              UPDATE IdeaLift_ChatGPTAuthCodes
              SET IdealiftUserId = @userId, WorkspaceId = @workspaceId
              WHERE Code = @code
            `);
        }
      } catch (error) {
        console.error('[OAuth] DB error in completeAuthorization:', error);
      }
    }

    // Fall back to memory
    if (!authData) {
      const memData = this.memoryAuthCodes.get(authCode);
      if (memData) {
        authData = memData;
        memData.idealiftUserId = userId;
        memData.workspaceId = workspaceId;
      }
    }

    if (!authData) {
      return { error: 'Invalid or expired authorization code' };
    }

    if (Date.now() > authData.expiresAt) {
      return { error: 'Authorization code expired' };
    }

    const redirectUrl = new URL(authData.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', authData.chatgptState);

    console.log('[OAuth] Authorization completed', { userId, authCode: authCode.substring(0, 8) + '...' });

    return { redirectUrl: redirectUrl.toString() };
  }

  /**
   * Exchange authorization code for access token (Step 2 of OAuth flow)
   */
  async token(params: {
    code?: string;
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
    grantType: string;
    refreshToken?: string;
  }): Promise<{
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  }> {
    const { code, clientId, clientSecret, redirectUri, grantType, refreshToken } = params;

    console.log('[OAuth] Token request', { grantType, clientId });

    if (grantType === 'refresh_token' && refreshToken) {
      return this.refreshAccessToken(refreshToken);
    }

    if (grantType !== 'authorization_code') {
      return { error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token grant types are supported' };
    }

    if (!this.isValidClientId(clientId) || clientSecret !== this.clientSecret) {
      return { error: 'invalid_client', error_description: 'Invalid client credentials' };
    }

    if (!code) {
      return { error: 'invalid_request', error_description: 'Missing authorization code' };
    }

    // Get auth code data
    let authData: {
      idealiftUserId?: string;
      workspaceId?: string;
      clientId: string;
      redirectUri: string;
      expiresAt: number;
      scopes: string[];
    } | null = null;

    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('code', sql.NVarChar, code)
          .query(`
            SELECT IdealiftUserId, WorkspaceId, ClientId, RedirectUri, ExpiresAt, Scopes
            FROM IdeaLift_ChatGPTAuthCodes
            WHERE Code = @code
          `);

        if (result.recordset.length > 0) {
          const row = result.recordset[0];
          authData = {
            idealiftUserId: row.IdealiftUserId,
            workspaceId: row.WorkspaceId,
            clientId: row.ClientId,
            redirectUri: row.RedirectUri,
            expiresAt: new Date(row.ExpiresAt).getTime(),
            scopes: row.Scopes.split(' '),
          };

          // Delete used auth code
          await pool.request()
            .input('code', sql.NVarChar, code)
            .query('DELETE FROM IdeaLift_ChatGPTAuthCodes WHERE Code = @code');
        }
      } catch (error) {
        console.error('[OAuth] DB error getting auth code:', error);
      }
    }

    // Fall back to memory
    if (!authData) {
      const memData = this.memoryAuthCodes.get(code);
      if (memData) {
        authData = memData;
        this.memoryAuthCodes.delete(code);
      }
    }

    if (!authData) {
      return { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' };
    }

    if (Date.now() > authData.expiresAt) {
      return { error: 'invalid_grant', error_description: 'Authorization code expired' };
    }

    if (redirectUri && redirectUri !== authData.redirectUri) {
      return { error: 'invalid_grant', error_description: 'Redirect URI mismatch' };
    }

    // Generate tokens
    const accessToken = this.generateToken();
    const newRefreshToken = this.generateToken();
    const accessExpiry = new Date(Date.now() + this.accessTokenExpiry);
    const refreshExpiry = new Date(Date.now() + this.refreshTokenExpiry);

    // Store tokens in database
    if (this.dbAvailable) {
      try {
        const pool = await getPool();

        // Store access token
        await pool.request()
          .input('token', sql.NVarChar, accessToken)
          .input('clientId', sql.NVarChar, clientId)
          .input('userId', sql.NVarChar, authData.idealiftUserId || null)
          .input('workspaceId', sql.NVarChar, authData.workspaceId || null)
          .input('scopes', sql.NVarChar, authData.scopes.join(' '))
          .input('expiresAt', sql.DateTime2, accessExpiry)
          .query(`
            INSERT INTO IdeaLift_ChatGPTAccessTokens (Token, ClientId, IdealiftUserId, WorkspaceId, Scopes, ExpiresAt)
            VALUES (@token, @clientId, @userId, @workspaceId, @scopes, @expiresAt)
          `);

        // Store refresh token
        await pool.request()
          .input('token', sql.NVarChar, newRefreshToken)
          .input('clientId', sql.NVarChar, clientId)
          .input('userId', sql.NVarChar, authData.idealiftUserId || null)
          .input('workspaceId', sql.NVarChar, authData.workspaceId || null)
          .input('expiresAt', sql.DateTime2, refreshExpiry)
          .query(`
            INSERT INTO IdeaLift_ChatGPTRefreshTokens (Token, ClientId, IdealiftUserId, WorkspaceId, ExpiresAt)
            VALUES (@token, @clientId, @userId, @workspaceId, @expiresAt)
          `);
      } catch (error) {
        console.error('[OAuth] DB error storing tokens:', error);
        // Fall back to memory
        this.memoryAccessTokens.set(accessToken, {
          idealiftUserId: authData.idealiftUserId,
          workspaceId: authData.workspaceId,
          clientId,
          expiresAt: accessExpiry.getTime(),
          scopes: authData.scopes,
        });
        this.memoryRefreshTokens.set(newRefreshToken, {
          idealiftUserId: authData.idealiftUserId,
          workspaceId: authData.workspaceId,
          clientId,
          expiresAt: refreshExpiry.getTime(),
        });
      }
    } else {
      this.memoryAccessTokens.set(accessToken, {
        idealiftUserId: authData.idealiftUserId,
        workspaceId: authData.workspaceId,
        clientId,
        expiresAt: accessExpiry.getTime(),
        scopes: authData.scopes,
      });
      this.memoryRefreshTokens.set(newRefreshToken, {
        idealiftUserId: authData.idealiftUserId,
        workspaceId: authData.workspaceId,
        clientId,
        expiresAt: refreshExpiry.getTime(),
      });
    }

    console.log('[OAuth] Access token generated', { userId: authData.idealiftUserId, dbPersisted: this.dbAvailable });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTokenExpiry / 1000),
      refresh_token: newRefreshToken,
      scope: authData.scopes.join(' '),
    };
  }

  /**
   * Refresh an access token
   */
  private async refreshAccessToken(refreshToken: string): Promise<{
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }> {
    let refreshData: {
      idealiftUserId?: string;
      workspaceId?: string;
      clientId: string;
      expiresAt: number;
    } | null = null;

    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('token', sql.NVarChar, refreshToken)
          .query(`
            SELECT IdealiftUserId, WorkspaceId, ClientId, ExpiresAt
            FROM IdeaLift_ChatGPTRefreshTokens
            WHERE Token = @token
          `);

        if (result.recordset.length > 0) {
          const row = result.recordset[0];
          refreshData = {
            idealiftUserId: row.IdealiftUserId,
            workspaceId: row.WorkspaceId,
            clientId: row.ClientId,
            expiresAt: new Date(row.ExpiresAt).getTime(),
          };
        }
      } catch (error) {
        console.error('[OAuth] DB error getting refresh token:', error);
      }
    }

    if (!refreshData) {
      refreshData = this.memoryRefreshTokens.get(refreshToken) || null;
    }

    if (!refreshData) {
      return { error: 'invalid_grant', error_description: 'Invalid refresh token' };
    }

    if (Date.now() > refreshData.expiresAt) {
      if (this.dbAvailable) {
        try {
          const pool = await getPool();
          await pool.request()
            .input('token', sql.NVarChar, refreshToken)
            .query('DELETE FROM IdeaLift_ChatGPTRefreshTokens WHERE Token = @token');
        } catch (e) { /* ignore */ }
      }
      this.memoryRefreshTokens.delete(refreshToken);
      return { error: 'invalid_grant', error_description: 'Refresh token expired' };
    }

    // Generate new access token
    const accessToken = this.generateToken();
    const accessExpiry = new Date(Date.now() + this.accessTokenExpiry);

    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        await pool.request()
          .input('token', sql.NVarChar, accessToken)
          .input('clientId', sql.NVarChar, refreshData.clientId)
          .input('userId', sql.NVarChar, refreshData.idealiftUserId || null)
          .input('workspaceId', sql.NVarChar, refreshData.workspaceId || null)
          .input('scopes', sql.NVarChar, 'read write')
          .input('expiresAt', sql.DateTime2, accessExpiry)
          .query(`
            INSERT INTO IdeaLift_ChatGPTAccessTokens (Token, ClientId, IdealiftUserId, WorkspaceId, Scopes, ExpiresAt)
            VALUES (@token, @clientId, @userId, @workspaceId, @scopes, @expiresAt)
          `);
      } catch (error) {
        console.error('[OAuth] DB error storing refreshed token:', error);
        this.memoryAccessTokens.set(accessToken, {
          idealiftUserId: refreshData.idealiftUserId,
          workspaceId: refreshData.workspaceId,
          clientId: refreshData.clientId,
          expiresAt: accessExpiry.getTime(),
          scopes: ['read', 'write'],
        });
      }
    } else {
      this.memoryAccessTokens.set(accessToken, {
        idealiftUserId: refreshData.idealiftUserId,
        workspaceId: refreshData.workspaceId,
        clientId: refreshData.clientId,
        expiresAt: accessExpiry.getTime(),
        scopes: ['read', 'write'],
      });
    }

    console.log('[OAuth] Access token refreshed', { userId: refreshData.idealiftUserId });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTokenExpiry / 1000),
    };
  }

  /**
   * Validate an access token
   */
  async validateAccessToken(token: string): Promise<{ userId?: string; workspaceId?: string; scopes: string[] } | null> {
    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('token', sql.NVarChar, token)
          .query(`
            SELECT IdealiftUserId, WorkspaceId, Scopes, ExpiresAt
            FROM IdeaLift_ChatGPTAccessTokens
            WHERE Token = @token
          `);

        if (result.recordset.length > 0) {
          const row = result.recordset[0];
          if (new Date(row.ExpiresAt).getTime() > Date.now()) {
            return {
              userId: row.IdealiftUserId,
              workspaceId: row.WorkspaceId,
              scopes: row.Scopes.split(' '),
            };
          } else {
            // Expired, delete it
            await pool.request()
              .input('token', sql.NVarChar, token)
              .query('DELETE FROM IdeaLift_ChatGPTAccessTokens WHERE Token = @token');
          }
        }
      } catch (error) {
        console.error('[OAuth] DB error validating token:', error);
      }
    }

    // Fall back to memory
    const tokenData = this.memoryAccessTokens.get(token);
    if (!tokenData) return null;

    if (Date.now() > tokenData.expiresAt) {
      this.memoryAccessTokens.delete(token);
      return null;
    }

    return {
      userId: tokenData.idealiftUserId,
      workspaceId: tokenData.workspaceId,
      scopes: tokenData.scopes,
    };
  }

  /**
   * Revoke a token
   */
  async revokeToken(token: string): Promise<void> {
    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        await pool.request()
          .input('token', sql.NVarChar, token)
          .query('DELETE FROM IdeaLift_ChatGPTAccessTokens WHERE Token = @token');
        await pool.request()
          .input('token', sql.NVarChar, token)
          .query('DELETE FROM IdeaLift_ChatGPTRefreshTokens WHERE Token = @token');
      } catch (error) {
        console.error('[OAuth] DB error revoking token:', error);
      }
    }
    this.memoryAccessTokens.delete(token);
    this.memoryRefreshTokens.delete(token);
    console.log('[OAuth] Token revoked');
  }

  /**
   * Cleanup expired tokens
   */
  private async cleanup(): Promise<void> {
    const now = new Date();
    let cleaned = 0;

    if (this.dbAvailable) {
      try {
        const pool = await getPool();

        const authResult = await pool.request()
          .input('now', sql.DateTime2, now)
          .query('DELETE FROM IdeaLift_ChatGPTAuthCodes WHERE ExpiresAt < @now');
        cleaned += authResult.rowsAffected[0] || 0;

        const accessResult = await pool.request()
          .input('now', sql.DateTime2, now)
          .query('DELETE FROM IdeaLift_ChatGPTAccessTokens WHERE ExpiresAt < @now');
        cleaned += accessResult.rowsAffected[0] || 0;

        const refreshResult = await pool.request()
          .input('now', sql.DateTime2, now)
          .query('DELETE FROM IdeaLift_ChatGPTRefreshTokens WHERE ExpiresAt < @now');
        cleaned += refreshResult.rowsAffected[0] || 0;
      } catch (error) {
        console.error('[OAuth] DB cleanup error:', error);
      }
    }

    // Also clean memory
    const nowMs = now.getTime();
    for (const [code, data] of this.memoryAuthCodes.entries()) {
      if (nowMs > data.expiresAt) {
        this.memoryAuthCodes.delete(code);
        cleaned++;
      }
    }
    for (const [token, data] of this.memoryAccessTokens.entries()) {
      if (nowMs > data.expiresAt) {
        this.memoryAccessTokens.delete(token);
        cleaned++;
      }
    }
    for (const [token, data] of this.memoryRefreshTokens.entries()) {
      if (nowMs > data.expiresAt) {
        this.memoryRefreshTokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[OAuth] Cleanup: removed ${cleaned} expired tokens`);
    }
  }

  /**
   * Get the most recent valid access token info
   * @deprecated Use getMostRecentTokenForSubject() instead to avoid multi-user race condition.
   */
  async getMostRecentToken(): Promise<{ userId?: string; workspaceId?: string } | null> {
    console.warn('[OAuth] DEPRECATED: getMostRecentToken() called — use getMostRecentTokenForSubject() to avoid race conditions');

    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('now', sql.DateTime2, new Date())
          .query(`
            SELECT TOP 1 IdealiftUserId, WorkspaceId
            FROM IdeaLift_ChatGPTAccessTokens
            WHERE ExpiresAt > @now
            ORDER BY ExpiresAt DESC
          `);

        if (result.recordset.length > 0) {
          return {
            userId: result.recordset[0].IdealiftUserId,
            workspaceId: result.recordset[0].WorkspaceId,
          };
        }
      } catch (error) {
        console.error('[OAuth] DB error getting most recent token:', error);
      }
    }

    // Fall back to memory
    let mostRecent: { userId?: string; workspaceId?: string; expiresAt: number } | null = null;
    const now = Date.now();

    for (const [, data] of this.memoryAccessTokens.entries()) {
      if (data.expiresAt > now) {
        if (!mostRecent || data.expiresAt > mostRecent.expiresAt) {
          mostRecent = {
            userId: data.idealiftUserId,
            workspaceId: data.workspaceId,
            expiresAt: data.expiresAt,
          };
        }
      }
    }

    return mostRecent ? { userId: mostRecent.userId, workspaceId: mostRecent.workspaceId } : null;
  }

  /**
   * Get the most recent valid access token scoped to a specific ChatGPT subject.
   * This prevents the multi-user race condition where getMostRecentToken() returns
   * another user's token.
   */
  async getMostRecentTokenForSubject(chatgptSubjectId: string): Promise<{ userId?: string; workspaceId?: string } | null> {
    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('now', sql.DateTime2, new Date())
          .input('subjectId', sql.NVarChar, chatgptSubjectId)
          .query(`
            SELECT TOP 1 IdealiftUserId, WorkspaceId
            FROM IdeaLift_ChatGPTAccessTokens
            WHERE ExpiresAt > @now
              AND ChatGPTSubjectId = @subjectId
            ORDER BY ExpiresAt DESC
          `);

        if (result.recordset.length > 0) {
          return {
            userId: result.recordset[0].IdealiftUserId,
            workspaceId: result.recordset[0].WorkspaceId,
          };
        }
      } catch (error) {
        console.error('[OAuth] DB error getting token for subject:', error);
      }
    }

    // Fall back to memory — check in-memory tokens tagged with this subject
    let mostRecent: { userId?: string; workspaceId?: string; expiresAt: number } | null = null;
    const now = Date.now();

    for (const [, data] of this.memoryAccessTokens.entries()) {
      if (data.expiresAt > now && (data as Record<string, unknown>).chatgptSubjectId === chatgptSubjectId) {
        if (!mostRecent || data.expiresAt > mostRecent.expiresAt) {
          mostRecent = {
            userId: data.idealiftUserId,
            workspaceId: data.workspaceId,
            expiresAt: data.expiresAt,
          };
        }
      }
    }

    return mostRecent ? { userId: mostRecent.userId, workspaceId: mostRecent.workspaceId } : null;
  }

  /**
   * Link a ChatGPT subject ID to the most recent unclaimed token (within 5-min window).
   * This bootstraps the subject→token link on the first tool call after OAuth completes.
   * Only claims tokens that have no ChatGPTSubjectId yet, preventing cross-user leaks.
   */
  async linkSubjectToRecentToken(chatgptSubjectId: string): Promise<boolean> {
    if (!this.dbAvailable) {
      // In-memory: tag the most recent unclaimed token
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;

      let bestToken: string | null = null;
      let bestExpiry = 0;

      for (const [token, data] of this.memoryAccessTokens.entries()) {
        const record = data as Record<string, unknown>;
        if (
          data.expiresAt > now &&
          !record.chatgptSubjectId &&
          data.expiresAt > bestExpiry &&
          (data.expiresAt - this.accessTokenExpiry) * 1000 > fiveMinAgo // created within 5 min
        ) {
          bestToken = token;
          bestExpiry = data.expiresAt;
        }
      }

      if (bestToken) {
        const record = this.memoryAccessTokens.get(bestToken) as Record<string, unknown>;
        if (record) {
          record.chatgptSubjectId = chatgptSubjectId;
          console.log('[OAuth] Linked subject to in-memory token', { chatgptSubjectId });
          return true;
        }
      }
      return false;
    }

    try {
      const pool = await getPool();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Claim the most recent unclaimed token created within the last 5 minutes
      const result = await pool.request()
        .input('subjectId', sql.NVarChar, chatgptSubjectId)
        .input('now', sql.DateTime2, new Date())
        .input('fiveMinAgo', sql.DateTime2, fiveMinAgo)
        .query(`
          UPDATE TOP(1) IdeaLift_ChatGPTAccessTokens
          SET ChatGPTSubjectId = @subjectId
          WHERE ChatGPTSubjectId IS NULL
            AND ExpiresAt > @now
            AND ExpiresAt >= DATEADD(MINUTE, -5, DATEADD(HOUR, 1, @now))
          ;
          SELECT @@ROWCOUNT as updated
        `);

      const updated = result.recordset?.[0]?.updated || 0;
      if (updated > 0) {
        console.log('[OAuth] Linked subject to DB token', { chatgptSubjectId, updated });
        return true;
      }

      return false;
    } catch (error) {
      console.error('[OAuth] DB error linking subject to token:', error);
      return false;
    }
  }

  /**
   * Get OAuth stats for health check
   */
  async getStats(): Promise<{ authCodes: number; accessTokens: number; refreshTokens: number; dbConnected: boolean }> {
    let dbCounts = { authCodes: 0, accessTokens: 0, refreshTokens: 0 };

    if (this.dbAvailable) {
      try {
        const pool = await getPool();
        const result = await pool.request().query(`
          SELECT
            (SELECT COUNT(*) FROM IdeaLift_ChatGPTAuthCodes) as authCodes,
            (SELECT COUNT(*) FROM IdeaLift_ChatGPTAccessTokens) as accessTokens,
            (SELECT COUNT(*) FROM IdeaLift_ChatGPTRefreshTokens) as refreshTokens
        `);
        if (result.recordset.length > 0) {
          dbCounts = result.recordset[0];
        }
      } catch (error) {
        console.error('[OAuth] DB error getting stats:', error);
      }
    }

    return {
      authCodes: dbCounts.authCodes + this.memoryAuthCodes.size,
      accessTokens: dbCounts.accessTokens + this.memoryAccessTokens.size,
      refreshTokens: dbCounts.refreshTokens + this.memoryRefreshTokens.size,
      dbConnected: this.dbAvailable,
    };
  }
}

// Export singleton instance
export const oauthService = new OAuthService();
