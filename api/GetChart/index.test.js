/**
 * Tests for GetChart Azure Function
 */

// Mock dependencies before requiring the handler
jest.mock('../shared/cosmos');
jest.mock('../shared/rateLimiter');
jest.mock('../shared/authorization');
jest.mock('../shared/logger');
jest.mock('../shared/auth');
jest.mock('../shared/validation');

const getChart = require('./index');
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { requireAuth } = require('../shared/auth');
const { logFunctionExecution, logError, logWarn, generateCorrelationId } = require('../shared/logger');
const { isValidChartId } = require('../shared/validation');

describe('GetChart Handler', () => {
    let mockContext;
    let mockRequest;
    let mockClient;
    let mockDb;
    let mockCollection;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock context
        mockContext = {
            res: null,
            log: jest.fn()
        };

        // Mock request
        mockRequest = {
            params: {
                chartId: 'chart-123'
            },
            headers: {
                'x-ms-client-principal': Buffer.from(JSON.stringify({
                    userId: 'user-123',
                    userDetails: 'user@example.com',
                    identityProvider: 'aad',
                    userRoles: ['authenticated']
                })).toString('base64')
            }
        };

        // Mock database
        mockCollection = {
            findOne: jest.fn()
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

        checkRateLimit.mockResolvedValue({
            allowed: true,
            remaining: 99
        });

        generateCorrelationId.mockReturnValue('corr-123');

        isValidChartId.mockReturnValue(true);
    });

    describe('Successful Retrieval', () => {
        it('should return chart with permissions for owner', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123',
                data: { nodes: [] },
                permissions: [
                    { userId: 'user-123', role: 'OWNER' },
                    { userId: 'viewer-456', role: 'VIEWER' }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.chart).toEqual(mockChart);
            expect(mockContext.res.body.chart.permissions).toBeDefined();
            expect(mockContext.res.body.userRole).toBe('OWNER');
            expect(mockContext.res.body.remaining).toBe(99);
        });

        it('should return chart without permissions for non-owner', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'owner-999',
                data: { nodes: [] },
                permissions: [
                    { userId: 'owner-999', role: 'OWNER' },
                    { userId: 'user-123', role: 'VIEWER' }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'VIEWER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.chart.id).toBe('chart-123');
            expect(mockContext.res.body.chart.permissions).toBeUndefined();
            expect(mockContext.res.body.userRole).toBe('VIEWER');
        });

        it('should include correlation ID in response headers', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123',
                data: { nodes: [] }
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.headers['X-Correlation-Id']).toBe('corr-123');
        });
    });

    describe('Authentication', () => {
        it('should reject unauthenticated requests', async () => {
            requireAuth.mockReturnValue(null);

            await getChart(mockContext, mockRequest);

            // requireAuth sets context.res, so we just verify it was called
            expect(requireAuth).toHaveBeenCalledWith(mockContext, mockRequest);
            expect(mockCollection.findOne).not.toHaveBeenCalled();
        });
    });

    describe('Validation', () => {
        it('should reject invalid chart ID format', async () => {
            mockRequest.params.chartId = 'invalid-id-with-special-chars!@#';
            isValidChartId.mockReturnValue(false);

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('Invalid chart ID format');
            expect(logWarn).toHaveBeenCalledWith(
                'Invalid chart ID format',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'invalid-id-with-special-chars!@#'
                })
            );
        });

        it('should reject empty chart ID', async () => {
            mockRequest.params.chartId = '';
            isValidChartId.mockReturnValue(false);

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('Invalid chart ID format');
        });
    });

    describe('Rate Limiting', () => {
        it('should enforce rate limits', async () => {
            checkRateLimit.mockResolvedValue({
                allowed: false,
                message: 'Rate limit exceeded',
                retryAfter: 60
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(429);
            expect(mockContext.res.headers['Retry-After']).toBe('60');
            expect(mockContext.res.body.error).toBe('Rate limit exceeded');
            expect(mockContext.res.body.retryAfter).toBe(60);
        });

        it('should pass correct operation type to rate limiter', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(checkRateLimit).toHaveBeenCalledWith('user-123', 'GET_CHART', mockClient, mockRequest);
        });
    });

    describe('Authorization', () => {
        it('should deny access if user lacks VIEWER role', async () => {
            canAccessChart.mockResolvedValue({
                allowed: false,
                reason: 'Insufficient permissions'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(403);
            expect(mockContext.res.body.error).toBe('Insufficient permissions');
            expect(logWarn).toHaveBeenCalledWith(
                'Chart access denied',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    reason: 'Insufficient permissions'
                })
            );
        });

        it('should return 404 for non-existent chart', async () => {
            canAccessChart.mockResolvedValue({
                allowed: false,
                reason: 'Chart not found'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
        });

        it('should check VIEWER role requirement', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'VIEWER'
            });

            await getChart(mockContext, mockRequest);

            expect(canAccessChart).toHaveBeenCalledWith('chart-123', 'user-123', ROLES.VIEWER, mockClient);
        });
    });

    describe('Database Operations', () => {
        it('should query with correct chart ID', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockCollection.findOne).toHaveBeenCalledWith(
                { id: 'chart-123' },
                { projection: { _id: 0 } }
            );
        });

        it('should return 404 if chart not found in database', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors gracefully', async () => {
            const dbError = new Error('Database connection failed');
            mockCollection.findOne.mockRejectedValue(dbError);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.error).toBe('Failed to retrieve chart');
            expect(mockContext.res.body.correlationId).toBe('corr-123');
            expect(logError).toHaveBeenCalledWith(
                'GetChart failed',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    error: 'Database connection failed'
                })
            );
        });

        it('should log execution metrics on error', async () => {
            const dbError = new Error('Database error');
            mockCollection.findOne.mockRejectedValue(dbError);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'GetChart',
                'user-123',
                expect.any(Number),
                false,
                expect.objectContaining({
                    chartId: 'chart-123',
                    error: 'Database error'
                })
            );
        });
    });

    describe('Logging', () => {
        it('should log successful execution with metrics', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await getChart(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'GetChart',
                'user-123',
                expect.any(Number),
                true,
                expect.objectContaining({
                    correlationId: 'corr-123',
                    chartId: 'chart-123',
                    userRole: 'OWNER',
                    userEmail: 'user@example.com'
                })
            );
        });
    });
});
