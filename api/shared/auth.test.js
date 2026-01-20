const { authenticateRequest, requireAuth, parseClientPrincipal } = require('./auth');

describe('Auth Module', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env
    process.env = originalEnv;
  });

  describe('parseClientPrincipal', () => {
    it('should parse valid base64-encoded principal', () => {
      const principal = {
        userId: 'user123',
        userDetails: 'user@example.com',
        identityProvider: 'aad',
        userRoles: ['authenticated'],
        claims: []
      };
      const encoded = Buffer.from(JSON.stringify(principal)).toString('base64');

      const result = parseClientPrincipal(encoded);

      expect(result).toEqual({
        userId: 'user123',
        userDetails: 'user@example.com',
        identityProvider: 'aad',
        userRoles: ['authenticated'],
        claims: []
      });
    });

    it('should return null for invalid base64', () => {
      const result = parseClientPrincipal('not-valid-base64!!!');
      expect(result).toBeNull();
    });

    it('should return null for missing userId', () => {
      const principal = {
        userDetails: 'user@example.com',
        userRoles: ['authenticated']
      };
      const encoded = Buffer.from(JSON.stringify(principal)).toString('base64');

      const result = parseClientPrincipal(encoded);
      expect(result).toBeNull();
    });

    it('should return null for missing userRoles', () => {
      const principal = {
        userId: 'user123',
        userDetails: 'user@example.com'
      };
      const encoded = Buffer.from(JSON.stringify(principal)).toString('base64');

      const result = parseClientPrincipal(encoded);
      expect(result).toBeNull();
    });
  });

  describe('authenticateRequest', () => {
    it('should allow requests when ALLOW_ANONYMOUS is true', () => {
      process.env.ALLOW_ANONYMOUS = 'true';

      const req = { headers: {} };
      const result = authenticateRequest(req);

      expect(result.authenticated).toBe(true);
      expect(result.isLocalDev).toBe(true);
      expect(result.user.userId).toBe('dev-user-001');
    });

    it('should reject when ALLOW_ANONYMOUS is false and no headers', () => {
      process.env.ALLOW_ANONYMOUS = 'false';
      delete process.env.WEBSITE_INSTANCE_ID;

      const req = { headers: {} };
      const result = authenticateRequest(req);

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('configuration error');
    });

    it('should authenticate with x-ms-client-principal header', () => {
      process.env.ALLOW_ANONYMOUS = 'false';
      process.env.WEBSITE_INSTANCE_ID = 'azure-instance-123';

      const principal = {
        userId: 'user123',
        userDetails: 'user@example.com',
        identityProvider: 'aad',
        userRoles: ['authenticated'],
        claims: []
      };
      const encoded = Buffer.from(JSON.stringify(principal)).toString('base64');

      const req = {
        headers: {
          'x-ms-client-principal': encoded
        }
      };

      const result = authenticateRequest(req);

      expect(result.authenticated).toBe(true);
      expect(result.user.userId).toBe('user123');
      expect(result.user.userEmail).toBe('user@example.com');
    });

    it('should authenticate with individual headers as fallback', () => {
      process.env.ALLOW_ANONYMOUS = 'false';
      process.env.WEBSITE_INSTANCE_ID = 'azure-instance-123';

      const req = {
        headers: {
          'x-ms-client-principal-id': 'user456',
          'x-ms-client-principal-name': 'user@example.com'
        }
      };

      const result = authenticateRequest(req);

      expect(result.authenticated).toBe(true);
      expect(result.user.userId).toBe('user456');
      expect(result.user.userEmail).toBe('user@example.com');
    });
  });

  describe('requireAuth', () => {
    it('should return user when authenticated', () => {
      process.env.ALLOW_ANONYMOUS = 'true';

      const context = {};
      const req = { headers: {} };

      const user = requireAuth(context, req);

      expect(user).not.toBeNull();
      expect(user.userId).toBe('dev-user-001');
      expect(context.res).toBeUndefined();
    });

    it('should set 401 response when not authenticated', () => {
      process.env.ALLOW_ANONYMOUS = 'false';
      delete process.env.WEBSITE_INSTANCE_ID;

      const context = {};
      const req = { headers: {} };

      const user = requireAuth(context, req);

      expect(user).toBeNull();
      expect(context.res.status).toBe(401);
      expect(context.res.body.error).toBeTruthy();
    });
  });
});
