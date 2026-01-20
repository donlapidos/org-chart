const { checkRateLimit, RATE_LIMITS } = require('./rateLimiter');

describe('Rate Limiter', () => {
  let mockClient;
  let mockCollection;
  let mockDb;

  beforeEach(() => {
    // Create mock MongoDB client
    mockCollection = {
      findOneAndUpdate: jest.fn()
    };

    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection)
    };

    mockClient = {
      db: jest.fn().mockReturnValue(mockDb)
    };
  });

  describe('checkRateLimit', () => {
    it('should allow request when under limit', async () => {
      // Mock successful increment with count under limit
      mockCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          id: 'user123:SAVE_CHART:123',
          userId: 'user123',
          action: 'SAVE_CHART',
          count: 1,
          windowStart: new Date()
        }
      });

      const result = await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // SAVE_CHART limit is 100
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should block request when limit exceeded', async () => {
      const windowStart = new Date();

      // Mock increment that exceeds limit
      mockCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          id: 'user123:SAVE_CHART:123',
          userId: 'user123',
          action: 'SAVE_CHART',
          count: 101,
          windowStart: windowStart
        }
      });

      const result = await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('Rate limit exceeded');
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should use atomic findOneAndUpdate with $inc', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          id: 'user123:SAVE_CHART:123',
          count: 5,
          windowStart: new Date()
        }
      });

      await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('user123:SAVE_CHART:')
        }),
        expect.objectContaining({
          $inc: { count: 1 },
          $setOnInsert: expect.any(Object)
        }),
        expect.objectContaining({
          upsert: true,
          returnDocument: 'after'
        })
      );
    });

    it('should handle missing value gracefully', async () => {
      // Mock response without value
      mockCollection.findOneAndUpdate.mockResolvedValue({
        lastErrorObject: { n: 1, updatedExisting: true }
      });

      const result = await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      // Should fail open
      expect(result.allowed).toBe(true);
    });

    it('should fail open on database errors', async () => {
      mockCollection.findOneAndUpdate.mockRejectedValue(new Error('DB connection failed'));

      const result = await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      expect(result.allowed).toBe(true);
    });

    it('should align windows to boundaries', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          count: 1,
          windowStart: new Date()
        }
      });

      await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      // Verify the windowStart in $setOnInsert is aligned to a time boundary
      const call = mockCollection.findOneAndUpdate.mock.calls[0];
      const setOnInsert = call[1].$setOnInsert;
      const windowMs = RATE_LIMITS.SAVE_CHART.windowMs;

      // The windowStart should be aligned to a boundary (divisible by windowMs)
      expect(setOnInsert.windowStart.getTime() % windowMs).toBe(0);

      // The windowStart should be in the recent past (within the last hour)
      const now = Date.now();
      expect(setOnInsert.windowStart.getTime()).toBeLessThanOrEqual(now);
      expect(setOnInsert.windowStart.getTime()).toBeGreaterThan(now - 3600000);
    });

    it('should return correct remaining count', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          count: 50,
          windowStart: new Date()
        }
      });

      const result = await checkRateLimit('user123', 'SAVE_CHART', mockClient);

      expect(result.remaining).toBe(50); // 100 - 50
    });

    it('should handle undefined action gracefully', async () => {
      const result = await checkRateLimit('user123', 'UNKNOWN_ACTION', mockClient);

      expect(result.allowed).toBe(true);
      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
