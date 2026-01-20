/**
 * Tests for GetCharts Azure Function
 */

// Mock dependencies before requiring the handler
jest.mock('../shared/cosmos');
jest.mock('../shared/rateLimiter');
jest.mock('../shared/logger');
jest.mock('../shared/auth');
jest.mock('../shared/globalRoles');

const getCharts = require('./index');
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { requireAuth } = require('../shared/auth');
const { getUserGlobalRole } = require('../shared/globalRoles');
const { logFunctionExecution, logError, generateCorrelationId } = require('../shared/logger');

describe('GetCharts Handler', () => {
    let mockContext;
    let mockRequest;
    let mockClient;
    let mockDb;
    let mockCollection;
    let mockCursor;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock context
        mockContext = {
            res: null,
            log: jest.fn()
        };

        // Mock request with default query params
        mockRequest = {
            query: {},
            headers: {
                'x-ms-client-principal': Buffer.from(JSON.stringify({
                    userId: 'user-123',
                    userDetails: 'user@example.com',
                    identityProvider: 'aad',
                    userRoles: ['authenticated']
                })).toString('base64')
            }
        };

        // Mock cursor
        mockCursor = {
            project: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn()
        };

        // Mock database
        mockCollection = {
            find: jest.fn().mockReturnValue(mockCursor),
            countDocuments: jest.fn()
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection)
        };

        mockClient = {
            db: jest.fn().mockReturnValue(mockDb)
        };

        // Default mock implementations
        getCosmosClient.mockResolvedValue(mockClient);

        requireAuth.mockReturnValue({
            userId: 'user-123',
            userEmail: 'user@example.com',
            isLocalDev: false
        });

        getUserGlobalRole.mockResolvedValue(null);

        checkRateLimit.mockResolvedValue({
            allowed: true,
            remaining: 99
        });

        generateCorrelationId.mockReturnValue('corr-123');
    });

    describe('Successful Retrieval', () => {
        it('should return owned charts with default pagination', async () => {
            const mockCharts = [
                {
                    id: 'chart-1',
                    name: 'Chart 1',
                    ownerId: 'user-123',
                    lastModified: new Date('2025-01-01'),
                    createdAt: new Date('2024-12-01'),
                    permissions: [{ userId: 'user-123', role: 'OWNER' }]
                },
                {
                    id: 'chart-2',
                    name: 'Chart 2',
                    ownerId: 'user-123',
                    lastModified: new Date('2025-01-02'),
                    createdAt: new Date('2024-12-02'),
                    permissions: [{ userId: 'user-123', role: 'OWNER' }]
                }
            ];

            mockCollection.countDocuments.mockResolvedValue(2);
            mockCursor.toArray.mockResolvedValue(mockCharts);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.charts).toHaveLength(2);
            expect(mockContext.res.body.charts[0].userRole).toBe('owner');
            expect(mockContext.res.body.charts[0].sharedWith).toBe(1);
            expect(mockContext.res.body.pagination.total).toBe(2);
            expect(mockContext.res.body.pagination.hasMore).toBe(false);
        });

        it('should return shared charts with correct role', async () => {
            const mockCharts = [
                {
                    id: 'chart-shared',
                    name: 'Shared Chart',
                    ownerId: 'other-user',
                    lastModified: new Date('2025-01-01'),
                    createdAt: new Date('2024-12-01'),
                    permissions: [
                        { userId: 'other-user', role: 'OWNER' },
                        { userId: 'user-123', role: 'EDITOR' }
                    ]
                }
            ];

            mockCollection.countDocuments.mockResolvedValue(1);
            mockCursor.toArray.mockResolvedValue(mockCharts);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.charts[0].userRole).toBe('EDITOR');
            expect(mockContext.res.body.charts[0].sharedWith).toBeUndefined(); // Not owner
        });

        it('should return mixed owned and shared charts', async () => {
            const mockCharts = [
                {
                    id: 'chart-owned',
                    name: 'Owned',
                    ownerId: 'user-123',
                    lastModified: new Date(),
                    createdAt: new Date(),
                    permissions: [{ userId: 'user-123', role: 'OWNER' }]
                },
                {
                    id: 'chart-shared',
                    name: 'Shared',
                    ownerId: 'other-user',
                    lastModified: new Date(),
                    createdAt: new Date(),
                    permissions: [
                        { userId: 'other-user', role: 'OWNER' },
                        { userId: 'user-123', role: 'VIEWER' }
                    ]
                }
            ];

            mockCollection.countDocuments.mockResolvedValue(2);
            mockCursor.toArray.mockResolvedValue(mockCharts);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.charts[0].userRole).toBe('owner');
            expect(mockContext.res.body.charts[0].sharedWith).toBeDefined();
            expect(mockContext.res.body.charts[1].userRole).toBe('VIEWER');
            expect(mockContext.res.body.charts[1].sharedWith).toBeUndefined();
        });
    });

    describe('Pagination', () => {
        it('should apply custom limit and offset', async () => {
            mockRequest.query = { limit: '10', offset: '5' };

            mockCollection.countDocuments.mockResolvedValue(100);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.skip).toHaveBeenCalledWith(5);
            expect(mockCursor.limit).toHaveBeenCalledWith(10);
            expect(mockContext.res.body.pagination.limit).toBe(10);
            expect(mockContext.res.body.pagination.offset).toBe(5);
        });

        it('should enforce max limit of 100', async () => {
            mockRequest.query = { limit: '500' };

            mockCollection.countDocuments.mockResolvedValue(10);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.limit).toHaveBeenCalledWith(100);
            expect(mockContext.res.body.pagination.limit).toBe(100);
        });

        it('should default to limit 50 and offset 0', async () => {
            mockCollection.countDocuments.mockResolvedValue(10);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.skip).toHaveBeenCalledWith(0);
            expect(mockCursor.limit).toHaveBeenCalledWith(50);
        });

        it('should calculate hasMore correctly', async () => {
            mockRequest.query = { limit: '10', offset: '0' };

            mockCollection.countDocuments.mockResolvedValue(25);
            mockCursor.toArray.mockResolvedValue(new Array(10).fill({}));

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.body.pagination.hasMore).toBe(true);
        });

        it('should handle negative offset gracefully', async () => {
            mockRequest.query = { offset: '-5' };

            mockCollection.countDocuments.mockResolvedValue(10);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.skip).toHaveBeenCalledWith(0);
            expect(mockContext.res.body.pagination.offset).toBe(0);
        });
    });

    describe('Sorting', () => {
        it('should sort by lastModified descending by default', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.sort).toHaveBeenCalledWith({ lastModified: -1 });
        });

        it('should sort by name ascending', async () => {
            mockRequest.query = { sortBy: 'name', sortOrder: 'asc' };

            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.sort).toHaveBeenCalledWith({ name: 1 });
        });

        it('should sort by createdAt descending', async () => {
            mockRequest.query = { sortBy: 'createdAt', sortOrder: 'desc' };

            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
        });

        it('should reject invalid sort fields', async () => {
            mockRequest.query = { sortBy: 'malicious; DROP TABLE charts;' };

            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            // Should fallback to lastModified
            expect(mockCursor.sort).toHaveBeenCalledWith({ lastModified: -1 });
        });
    });

    describe('Authentication', () => {
        it('should reject unauthenticated requests', async () => {
            requireAuth.mockReturnValue(null);

            await getCharts(mockContext, mockRequest);

            expect(requireAuth).toHaveBeenCalledWith(mockContext, mockRequest);
            expect(mockCollection.find).not.toHaveBeenCalled();
        });
    });

    describe('Rate Limiting', () => {
        it('should enforce rate limits', async () => {
            checkRateLimit.mockResolvedValue({
                allowed: false,
                message: 'Rate limit exceeded',
                retryAfter: 60
            });

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(429);
            expect(mockContext.res.headers['Retry-After']).toBe('60');
            expect(mockContext.res.body.error).toBe('Rate limit exceeded');
        });

        it('should pass correct operation type to rate limiter', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(checkRateLimit).toHaveBeenCalledWith('user-123', 'GET_CHARTS', mockClient, mockRequest);
        });
    });

    describe('Database Query', () => {
        it('should query for all charts (authenticated users can view all)', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            // All authenticated users can view all charts
            expect(mockCollection.find).toHaveBeenCalledWith({});
        });

        it('should project only necessary fields', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.project).toHaveBeenCalledWith({
                id: 1,
                name: 1,
                ownerId: 1,
                lastModified: 1,
                createdAt: 1,
                permissions: 1,
                isPublic: 1,
                _id: 0
            });
        });
    });

    describe('Include Data', () => {
        it('should include data in projection when includeData is true', async () => {
            mockRequest.query = { includeData: 'true' };
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockCursor.project).toHaveBeenCalledWith(expect.objectContaining({
                data: 1
            }));
        });

        it('should include chart data in response when includeData is true', async () => {
            mockRequest.query = { includeData: 'true' };

            const mockCharts = [
                {
                    id: 'chart-1',
                    name: 'Chart 1',
                    ownerId: 'user-123',
                    lastModified: new Date('2025-01-01'),
                    createdAt: new Date('2024-12-01'),
                    permissions: [{ userId: 'user-123', role: 'OWNER' }],
                    data: { nodes: [{ id: 'n1' }] }
                }
            ];

            mockCollection.countDocuments.mockResolvedValue(1);
            mockCursor.toArray.mockResolvedValue(mockCharts);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.charts[0].data).toEqual({ nodes: [{ id: 'n1' }] });
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors gracefully', async () => {
            const dbError = new Error('Database connection failed');
            mockCollection.countDocuments.mockRejectedValue(dbError);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.error).toBe('Failed to retrieve charts');
            expect(mockContext.res.body.correlationId).toBe('corr-123');
            expect(logError).toHaveBeenCalledWith(
                'GetCharts failed',
                expect.objectContaining({
                    userId: 'user-123',
                    error: 'Database connection failed'
                })
            );
        });

        it('should log execution metrics on error', async () => {
            const dbError = new Error('Database error');
            mockCollection.find.mockImplementation(() => {
                throw dbError;
            });

            await getCharts(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'GetCharts',
                'user-123',
                expect.any(Number),
                false,
                expect.objectContaining({
                    error: 'Database error'
                })
            );
        });
    });

    describe('Response Format', () => {
        it('should include correlation ID in headers', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.headers['X-Correlation-Id']).toBe('corr-123');
        });

        it('should include rate limit remaining count', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.body.remaining).toBe(99);
        });

        it('should return empty array when no charts exist', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);
            mockCursor.toArray.mockResolvedValue([]);

            await getCharts(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.charts).toEqual([]);
            expect(mockContext.res.body.pagination.total).toBe(0);
        });
    });

    describe('Logging', () => {
        it('should log successful execution with metrics', async () => {
            const mockCharts = [
                { id: '1', name: 'Chart 1', ownerId: 'user-123', permissions: [] }
            ];

            mockCollection.countDocuments.mockResolvedValue(1);
            mockCursor.toArray.mockResolvedValue(mockCharts);

            await getCharts(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'GetCharts',
                'user-123',
                expect.any(Number),
                true,
                expect.objectContaining({
                    correlationId: 'corr-123',
                    chartCount: 1,
                    totalCount: 1,
                    userEmail: 'user@example.com'
                })
            );
        });
    });
});
