const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { shareChart, revokeAccess, ROLES } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * POST /api/v1/charts/{chartId}/share - Grant or update permissions
 * DELETE /api/v1/charts/{chartId}/share - Revoke permissions
 *
 * Manage chart sharing and permissions
 * Requires OWNER role
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;
    const method = req.method.toUpperCase();
    const isRevoke = method === 'DELETE';

    // 1. Authentication check
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;
    const effectiveUserEmail = user.userEmail;
    const isLocalDev = user.isLocalDev;

    // 2. Validate chart ID
    if (!isValidChartId(chartId)) {
        logWarn('Invalid chart ID format', {
            correlationId,
            userId: effectiveUserId,
            chartId
        });

        context.res = {
            status: 400,
            body: { error: 'Invalid chart ID format' }
        };
        return;
    }

    let client;
    try {
        // 3. Get reusable DB client
        client = await getCosmosClient();

        // 4. Rate limiting
        const rateCheck = await checkRateLimit(effectiveUserId, 'SHARE_CHART', client);
        if (!rateCheck.allowed) {
            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: {
                    error: rateCheck.message,
                    retryAfter: rateCheck.retryAfter
                }
            };
            return;
        }

        if (isRevoke) {
            // DELETE: Revoke access
            const { targetUserId } = req.body;

            if (!targetUserId) {
                context.res = {
                    status: 400,
                    body: { error: 'targetUserId is required' }
                };
                return;
            }

            const result = await revokeAccess(chartId, effectiveUserId, targetUserId, client);

            if (!result.success) {
                logWarn('Revoke access failed', {
                    correlationId,
                    userId: effectiveUserId,
                    chartId,
                    targetUserId,
                    reason: result.message
                });

                context.res = {
                    status: result.message.includes('not found') ? 404 : 400,
                    body: { error: result.message }
                };
                return;
            }

            logInfo('Access revoked successfully', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                targetUserId
            });

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Correlation-Id': correlationId
                },
                body: {
                    success: true,
                    message: result.message,
                    remaining: rateCheck.remaining
                }
            };

        } else {
            // POST: Grant or update access
            const { targetUserId, role } = req.body;

            if (!targetUserId) {
                context.res = {
                    status: 400,
                    body: { error: 'targetUserId is required' }
                };
                return;
            }

            if (!role) {
                context.res = {
                    status: 400,
                    body: { error: 'role is required (viewer or editor)' }
                };
                return;
            }

            const result = await shareChart(chartId, effectiveUserId, targetUserId, role, client);

            if (!result.success) {
                logWarn('Share chart failed', {
                    correlationId,
                    userId: effectiveUserId,
                    chartId,
                    targetUserId,
                    role,
                    reason: result.message
                });

                context.res = {
                    status: result.message.includes('not found') ? 404 : 400,
                    body: { error: result.message }
                };
                return;
            }

            logInfo('Chart shared successfully', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                targetUserId,
                role
            });

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Correlation-Id': correlationId
                },
                body: {
                    success: true,
                    message: result.message,
                    remaining: rateCheck.remaining
                }
            };
        }

        // 5. Log success
        logFunctionExecution('ShareChart', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            action: isRevoke ? 'revoke' : 'grant',
            userEmail: effectiveUserEmail,
            isLocalDev
        });

    } catch (error) {
        logError('ShareChart failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            action: isRevoke ? 'revoke' : 'grant',
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('ShareChart', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to manage chart sharing',
                correlationId
            }
        };
    }
};
