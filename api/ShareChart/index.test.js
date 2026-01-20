/**
 * Tests for ShareChart Azure Function
 */

// Mock dependencies before requiring the handler
jest.mock('../shared/cosmos');
jest.mock('../shared/rateLimiter');
jest.mock('../shared/authorization');
jest.mock('../shared/logger');
jest.mock('../shared/auth');
jest.mock('../shared/validation');

const shareChartHandler = require('./index');
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { shareChart, revokeAccess } = require('../shared/authorization');
const { requireAuth } = require('../shared/auth');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { isValidChartId } = require('../shared/validation');

describe('ShareChart Handler', () => {
    let mockContext;
    let mockRequest;
    let mockClient;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock context
        mockContext = {
            res: null,
            log: jest.fn()
        };

        // Mock client
        mockClient = {
            db: jest.fn()
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

    describe('Grant Access (POST)', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: {
                    chartId: 'chart-123'
                },
                body: {
                    targetUserId: 'target-user-456',
                    role: 'VIEWER'
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
        });

        it('should grant access successfully', async () => {
            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully with VIEWER role'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(shareChart).toHaveBeenCalledWith(
                'chart-123',
                'user-123',
                'target-user-456',
                'VIEWER',
                mockClient
            );

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.success).toBe(true);
            expect(mockContext.res.body.remaining).toBe(99);
            expect(logInfo).toHaveBeenCalledWith(
                'Chart shared successfully',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    targetUserId: 'target-user-456',
                    role: 'VIEWER'
                })
            );
        });

        it('should grant EDITOR role', async () => {
            mockRequest.body.role = 'EDITOR';

            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully with EDITOR role'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(shareChart).toHaveBeenCalledWith(
                'chart-123',
                'user-123',
                'target-user-456',
                'EDITOR',
                mockClient
            );

            expect(mockContext.res.status).toBe(200);
        });

        it('should return 400 if targetUserId is missing', async () => {
            mockRequest.body.targetUserId = undefined;

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('targetUserId is required');
            expect(shareChart).not.toHaveBeenCalled();
        });

        it('should return 400 if role is missing', async () => {
            mockRequest.body.role = undefined;

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('role is required (viewer or editor)');
            expect(shareChart).not.toHaveBeenCalled();
        });

        it('should return 404 if chart not found', async () => {
            shareChart.mockResolvedValue({
                success: false,
                message: 'Chart not found'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
            expect(logWarn).toHaveBeenCalledWith(
                'Share chart failed',
                expect.objectContaining({
                    reason: 'Chart not found'
                })
            );
        });

        it('should return 400 for other failures', async () => {
            shareChart.mockResolvedValue({
                success: false,
                message: 'Invalid role specified'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('Invalid role specified');
        });

        it('should include correlation ID in response', async () => {
            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.headers['X-Correlation-Id']).toBe('corr-123');
        });
    });

    describe('Revoke Access (DELETE)', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'DELETE',
                params: {
                    chartId: 'chart-123'
                },
                body: {
                    targetUserId: 'target-user-456'
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
        });

        it('should revoke access successfully', async () => {
            revokeAccess.mockResolvedValue({
                success: true,
                message: 'Access revoked successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(revokeAccess).toHaveBeenCalledWith(
                'chart-123',
                'user-123',
                'target-user-456',
                mockClient
            );

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.success).toBe(true);
            expect(logInfo).toHaveBeenCalledWith(
                'Access revoked successfully',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    targetUserId: 'target-user-456'
                })
            );
        });

        it('should return 400 if targetUserId is missing', async () => {
            mockRequest.body.targetUserId = undefined;

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('targetUserId is required');
            expect(revokeAccess).not.toHaveBeenCalled();
        });

        it('should return 404 if chart not found', async () => {
            revokeAccess.mockResolvedValue({
                success: false,
                message: 'Chart not found'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.error).toBe('Chart not found');
        });

        it('should return 400 for other failures', async () => {
            revokeAccess.mockResolvedValue({
                success: false,
                message: 'User does not have access to this chart'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.error).toBe('User does not have access to this chart');
        });
    });

    describe('Authentication', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {}
            };
        });

        it('should reject unauthenticated requests', async () => {
            requireAuth.mockReturnValue(null);

            await shareChartHandler(mockContext, mockRequest);

            expect(requireAuth).toHaveBeenCalledWith(mockContext, mockRequest);
            expect(shareChart).not.toHaveBeenCalled();
            expect(revokeAccess).not.toHaveBeenCalled();
        });
    });

    describe('Validation', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: { chartId: 'invalid!@#' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };
        });

        it('should reject invalid chart ID format', async () => {
            isValidChartId.mockReturnValue(false);

            await shareChartHandler(mockContext, mockRequest);

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
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };
        });

        it('should enforce rate limits', async () => {
            checkRateLimit.mockResolvedValue({
                allowed: false,
                message: 'Rate limit exceeded',
                retryAfter: 60
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(429);
            expect(mockContext.res.headers['Retry-After']).toBe('60');
            expect(mockContext.res.body.error).toBe('Rate limit exceeded');
        });

        it('should pass correct operation type to rate limiter', async () => {
            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(checkRateLimit).toHaveBeenCalledWith('user-123', 'SHARE_CHART', mockClient);
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };
        });

        it('should handle database errors gracefully', async () => {
            const dbError = new Error('Database connection failed');
            shareChart.mockRejectedValue(dbError);

            await shareChartHandler(mockContext, mockRequest);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.error).toBe('Failed to manage chart sharing');
            expect(mockContext.res.body.correlationId).toBe('corr-123');
            expect(logError).toHaveBeenCalledWith(
                'ShareChart failed',
                expect.objectContaining({
                    userId: 'user-123',
                    chartId: 'chart-123',
                    action: 'grant',
                    error: 'Database connection failed'
                })
            );
        });

        it('should log execution metrics on error', async () => {
            const dbError = new Error('Database error');
            shareChart.mockRejectedValue(dbError);

            await shareChartHandler(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'ShareChart',
                'user-123',
                expect.any(Number),
                false,
                expect.objectContaining({
                    chartId: 'chart-123',
                    error: 'Database error'
                })
            );
        });

        it('should log revoke action in error', async () => {
            mockRequest.method = 'DELETE';

            const dbError = new Error('Database error');
            revokeAccess.mockRejectedValue(dbError);

            await shareChartHandler(mockContext, mockRequest);

            expect(logError).toHaveBeenCalledWith(
                'ShareChart failed',
                expect.objectContaining({
                    action: 'revoke'
                })
            );
        });
    });

    describe('Logging', () => {
        beforeEach(() => {
            mockRequest = {
                method: 'POST',
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };
        });

        it('should log successful grant execution with metrics', async () => {
            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'ShareChart',
                'user-123',
                expect.any(Number),
                true,
                expect.objectContaining({
                    correlationId: 'corr-123',
                    chartId: 'chart-123',
                    action: 'grant',
                    userEmail: 'user@example.com'
                })
            );
        });

        it('should log successful revoke execution with metrics', async () => {
            mockRequest.method = 'DELETE';

            revokeAccess.mockResolvedValue({
                success: true,
                message: 'Access revoked successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(logFunctionExecution).toHaveBeenCalledWith(
                'ShareChart',
                'user-123',
                expect.any(Number),
                true,
                expect.objectContaining({
                    action: 'revoke'
                })
            );
        });
    });

    describe('HTTP Methods', () => {
        it('should handle POST for granting access', async () => {
            mockRequest = {
                method: 'post',  // lowercase
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456', role: 'VIEWER' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };

            shareChart.mockResolvedValue({
                success: true,
                message: 'Chart shared successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(shareChart).toHaveBeenCalled();
            expect(revokeAccess).not.toHaveBeenCalled();
        });

        it('should handle DELETE for revoking access', async () => {
            mockRequest = {
                method: 'delete',  // lowercase
                params: { chartId: 'chart-123' },
                body: { targetUserId: 'target-456' },
                headers: {
                    'x-ms-client-principal': Buffer.from(JSON.stringify({
                        userId: 'user-123',
                        userDetails: 'user@example.com'
                    })).toString('base64')
                }
            };

            revokeAccess.mockResolvedValue({
                success: true,
                message: 'Access revoked successfully'
            });

            await shareChartHandler(mockContext, mockRequest);

            expect(revokeAccess).toHaveBeenCalled();
            expect(shareChart).not.toHaveBeenCalled();
        });
    });
});
