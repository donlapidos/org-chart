/**
 * Tests for DeleteChart Azure Function
 */

// Mock dependencies before requiring the handler
jest.mock('../shared/cosmos');
jest.mock('../shared/rateLimiter');
jest.mock('../shared/authorization');
jest.mock('../shared/logger');
jest.mock('../shared/auth');
jest.mock('../shared/validation');

const deleteChart = require('./index');
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { requireAuth } = require('../shared/auth');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { isValidChartId } = require('../shared/validation');

describe('DeleteChart Handler', () => {
    let mockContext;
    let mockRequest;
    let mockClient;
    let mockDb;
    let mockChartsCollection;
    let mockDeletedChartsCollection;
    let mockSession;

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

        // Mock session
        mockSession = {
            withTransaction: jest.fn(async (callback) => await callback()),
            endSession: jest.fn()
        };

        // Mock database collections
        mockChartsCollection = {
            findOne: jest.fn(),
            deleteOne: jest.fn()
        };

        mockDeletedChartsCollection = {
            insertOne: jest.fn()
        };

        mockDb = {
            collection: jest.fn((name) => {
                if (name === 'charts') return mockChartsCollection;
                if (name === 'deleted_charts') return mockDeletedChartsCollection;
                return null;
            })
        };

        mockClient = {
            db: jest.fn().mockReturnValue(mockDb),
            startSession: jest.fn().mockReturnValue(mockSession)
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

    describe('Successful Deletion', () => {
        it('should soft delete chart and move to deleted_charts', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123',
                data: { nodes: [] },
                permissions: [{ userId: 'user-123', role: 'OWNER' }]
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            // Verify transaction was used
            expect(mockClient.startSession).toHaveBeenCalled();
            expect(mockSession.withTransaction).toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();

            // Verify chart was moved to deleted_charts
            expect(mockDeletedChartsCollection.insertOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'chart-123',
                    name: 'Test Chart',
                    deletedBy: 'user-123',
                    deletedAt: expect.any(Date),
                    expiresAt: expect.any(Date)
                }),
                expect.any(Object)
            );

            // Verify chart was removed from active charts
            expect(mockChartsCollection.deleteOne).toHaveBeenCalledWith(
                { id: 'chart-123' },
                expect.any(Object)
            );

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.success).toBe(true);
            expect(mockContext.res.body.recoveryPeriod).toBe('90 days');
        });

        it('should calculate expiresAt as 90 days from now', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            const beforeDelete = Date.now();
            await deleteChart(mockContext, mockRequest);
            const afterDelete = Date.now();

            const expiresAtStr = mockContext.res.body.expiresAt;
            const expiresAt = new Date(expiresAtStr).getTime();

            const expectedMin = beforeDelete + (90 * 24 * 60 * 60 * 1000);
            const expectedMax = afterDelete + (90 * 24 * 60 * 60 * 1000);

            expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
            expect(expiresAt).toBeLessThanOrEqual(expectedMax);
        });

        it('should include correlation ID in response', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.headers['X-Correlation-Id']).toBe('corr-123');
        });

        it('should log successful deletion', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(logInfo).toHaveBeenCalledWith(
                'Chart soft deleted successfully',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    chartName: 'Test Chart'
                })
            );
        });
    });

    describe('Authentication', () => {
        it('should reject unauthenticated requests', async () => {
            requireAuth.mockReturnValue(null);

            await deleteChart(mockContext, mockRequest);

            expect(requireAuth).toHaveBeenCalledWith(mockContext, mockRequest);
            expect(mockChartsCollection.findOne).not.toHaveBeenCalled();
        });
    });

    describe('Validation', () => {
        it('should reject invalid chart ID format', async () => {
            mockRequest.params.chartId = 'invalid!@#';
            isValidChartId.mockReturnValue(false);

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('Invalid chart ID format');
            expect(logWarn).toHaveBeenCalledWith(
                'Invalid chart ID format',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'invalid!@#'
                })
            );
        });
    });

    describe('Rate Limiting', () => {
        it('should enforce rate limits', async () => {
            checkRateLimit.mockResolvedValue({
                allowed: false,
                message: 'Rate limit exceeded',
                retryAfter: 60
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(429);
            expect(mockContext.res.headers['Retry-After']).toBe('60');
            expect(mockContext.res.body.error).toBe('Rate limit exceeded');
        });

        it('should pass correct operation type to rate limiter', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(checkRateLimit).toHaveBeenCalledWith('user-123', 'DELETE_CHART', mockClient);
        });
    });

    describe('Authorization', () => {
        it('should require OWNER role', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(canAccessChart).toHaveBeenCalledWith('chart-123', 'user-123', ROLES.OWNER, mockClient);
        });

        it('should deny access to non-owners', async () => {
            canAccessChart.mockResolvedValue({
                allowed: false,
                reason: 'Insufficient permissions'
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(403);
            expect(mockContext.res.body.error).toBe('Insufficient permissions');
            expect(logWarn).toHaveBeenCalledWith(
                'Chart delete access denied',
                expect.objectContaining({
                    userId: 'user-123',
                    reason: 'Insufficient permissions'
                })
            );
        });

        it('should return 404 for non-existent chart', async () => {
            canAccessChart.mockResolvedValue({
                allowed: false,
                reason: 'Chart not found'
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
        });

        it('should return 404 if chart not found in database after auth check', async () => {
            mockChartsCollection.findOne.mockResolvedValue(null);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
        });
    });

    describe('Transaction Handling', () => {
        it('should end session even if transaction fails', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            // Simulate transaction error
            mockSession.withTransaction.mockRejectedValue(new Error('Transaction failed'));

            await deleteChart(mockContext, mockRequest);

            // Session should still be ended
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should pass session to database operations', async () => {
            const mockChart = {
                id: 'chart-123',
                name: 'Test Chart',
                ownerId: 'user-123'
            };

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(mockDeletedChartsCollection.insertOne).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({ session: mockSession })
            );

            expect(mockChartsCollection.deleteOne).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({ session: mockSession })
            );
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors gracefully', async () => {
            const dbError = new Error('Database connection failed');
            getCosmosClient.mockRejectedValue(dbError);

            await deleteChart(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.error).toBe('Failed to delete chart');
            expect(mockContext.res.body.correlationId).toBe('corr-123');
            expect(logError).toHaveBeenCalledWith(
                'DeleteChart failed',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    error: 'Database connection failed'
                })
            );
        });

        it('should log execution metrics on error', async () => {
            const dbError = new Error('Database error');
            mockChartsCollection.findOne.mockRejectedValue(dbError);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'DeleteChart',
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

            mockChartsCollection.findOne.mockResolvedValue(mockChart);

            canAccessChart.mockResolvedValue({
                allowed: true,
                userRole: 'OWNER'
            });

            await deleteChart(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'DeleteChart',
                'user-123',
                expect.any(Number),
                true,
                expect.objectContaining({
                    correlationId: 'corr-123',
                    chartId: 'chart-123',
                    userEmail: 'user@example.com'
                })
            );
        });
    });
});
