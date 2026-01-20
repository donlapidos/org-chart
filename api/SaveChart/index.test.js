/**
 * Integration test for SaveChart function
 *
 * This test focuses on preventing regressions like the userId reference bug
 * that caused 500 errors on successful save operations.
 */

const saveChart = require('./index');
const { requireAuth } = require('../shared/auth');
const { checkRateLimit } = require('../shared/rateLimiter');
const { validateChartPayload, isValidChartId } = require('../shared/validation');
const { getUserGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');

// Mock dependencies
jest.mock('../shared/auth');
jest.mock('../shared/rateLimiter');
jest.mock('../shared/validation');
jest.mock('../shared/authorization');
jest.mock('../shared/globalRoles', () => ({
  GLOBAL_ROLES: {
    VIEWER: 'viewer',
    EDITOR: 'editor',
    ADMIN: 'admin'
  },
  getUserGlobalRole: jest.fn()
}));
jest.mock('../shared/logger', () => ({
  logFunctionExecution: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
  logInfo: jest.fn(),
  generateCorrelationId: () => 'test-correlation-id'
}));
jest.mock('../shared/cosmos');

describe('SaveChart Function', () => {
  let mockContext;
  let mockRequest;
  let mockClient;
  let mockCollection;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock context
    mockContext = {
      res: null
    };

    // Setup mock request
    mockRequest = {
      method: 'POST',
      params: {},
      body: {
        name: 'Test Chart',
        data: { nodes: [], connections: [] }
      },
      headers: {}
    };

    // Setup mock MongoDB
    mockCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'chart123' }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: jest.fn()
    };

    mockClient = {
      db: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(mockCollection)
      })
    };

    // Mock getCosmosClient
    const { getCosmosClient } = require('../shared/cosmos');
    getCosmosClient.mockResolvedValue(mockClient);

    // Default mock behaviors
    requireAuth.mockReturnValue({
      userId: 'test-user-123',
      userEmail: 'test@example.com',
      isLocalDev: false
    });

    checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 99
    });

    validateChartPayload.mockReturnValue({
      valid: true,
      errors: []
    });

    isValidChartId.mockReturnValue(true);
    getUserGlobalRole.mockResolvedValue(GLOBAL_ROLES.EDITOR);
  });

  describe('Successful Chart Creation', () => {
    it('should create chart and return 201 without crashing', async () => {
      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(201);
      expect(mockContext.res.body.success).toBe(true);
      expect(mockContext.res.body.chartId).toBeTruthy();

      // Verify no ReferenceError was thrown
      expect(mockCollection.insertOne).toHaveBeenCalled();
    });

    it('should not reference undefined userId variable', async () => {
      // This is the regression test for the bug
      const { logInfo } = require('../shared/logger');

      await saveChart(mockContext, mockRequest);

      // Verify logInfo was called (would crash if userId was undefined)
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Chart created successfully'),
        expect.objectContaining({
          userId: 'test-user-123'  // Should use effectiveUserId
        })
      );
    });
  });

  describe('Successful Chart Update', () => {
    beforeEach(() => {
      mockRequest.method = 'PUT';
      mockRequest.params.chartId = '123e4567-e89b-42d3-a456-426614174000';  // Valid UUID v4

      const { canAccessChart } = require('../shared/authorization');
      canAccessChart.mockResolvedValue({ allowed: true });
    });

    it('should update chart and return 200 without crashing', async () => {
      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(200);
      expect(mockContext.res.body.success).toBe(true);

      // Verify no ReferenceError was thrown
      expect(mockCollection.updateOne).toHaveBeenCalled();
    });

    it('should not reference undefined userId in update path', async () => {
      const { logInfo } = require('../shared/logger');

      await saveChart(mockContext, mockRequest);

      // Verify logInfo was called with correct userId
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Chart updated successfully'),
        expect.objectContaining({
          userId: 'test-user-123'
        })
      );
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      requireAuth.mockReturnValue(null);
      mockContext.res = { status: 401, body: { error: 'Unauthorized' } };

      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(401);
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('Creation Authorization', () => {
    it('should reject creation when user lacks global role', async () => {
      getUserGlobalRole.mockResolvedValue(GLOBAL_ROLES.VIEWER);

      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(403);
      expect(mockContext.res.body.error).toContain('permission');
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limiting', () => {
    it('should reject when rate limit exceeded', async () => {
      checkRateLimit.mockResolvedValue({
        allowed: false,
        message: 'Rate limit exceeded',
        retryAfter: 3600
      });

      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(429);
      expect(mockContext.res.body.error).toContain('Rate limit');
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('Validation Errors', () => {
    it('should return 400 for invalid payload', async () => {
      validateChartPayload.mockReturnValue({
        valid: false,
        errors: ['Chart name is required']
      });

      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(400);
      expect(mockContext.res.body.error).toBe('Validation failed');
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it('should not crash on validation error (userId reference check)', async () => {
      const { logWarn } = require('../shared/logger');

      validateChartPayload.mockReturnValue({
        valid: false,
        errors: ['Invalid data']
      });

      await saveChart(mockContext, mockRequest);

      // Should have logged with correct userId
      expect(logWarn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'test-user-123'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockCollection.insertOne.mockRejectedValue(new Error('DB error'));

      await saveChart(mockContext, mockRequest);

      expect(mockContext.res.status).toBe(500);
      expect(mockContext.res.body.error).toContain('Failed to save chart');
    });

    it('should log errors with correct userId', async () => {
      const { logError } = require('../shared/logger');
      mockCollection.insertOne.mockRejectedValue(new Error('DB error'));

      await saveChart(mockContext, mockRequest);

      expect(logError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'test-user-123'
        })
      );
    });
  });
});
