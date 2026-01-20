const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canPerformAction } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * DELETE /api/v1/charts/{chartId}/share-link
 *
 * Revoke shareable link for a chart (owner only)
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;

    // 1. Authentication check (required - only owners can revoke)
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;

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
        // 3. Get DB client
        client = await getCosmosClient();

        // 4. Rate limiting
        const rateCheck = await checkRateLimit(effectiveUserId, 'SHARE_LINK_REVOKE', client);
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

        // 5. Authorization check (requires OWNER role)
        const authResult = await canPerformAction(chartId, effectiveUserId, 'share', client);
        if (!authResult.allowed) {
            logWarn('User not authorized to revoke share link', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                reason: authResult.reason
            });

            context.res = {
                status: 403,
                body: { error: authResult.reason || 'Only chart owners can revoke share links' }
            };
            return;
        }

        // 6. Revoke all active links for this chart
        const db = client.db('orgchart');
        const shareLinks = db.collection('chart_share_links');

        const result = await shareLinks.updateMany(
            {
                chartId: chartId,
                revokedAt: null
            },
            {
                $set: { revokedAt: new Date() }
            }
        );

        if (result.modifiedCount === 0) {
            logWarn('No active share links to revoke', {
                correlationId,
                chartId,
                userId: effectiveUserId
            });

            context.res = {
                status: 404,
                body: { error: 'No active share links found for this chart' }
            };
            return;
        }

        logInfo('Share link(s) revoked', {
            correlationId,
            chartId,
            userId: effectiveUserId,
            revokedCount: result.modifiedCount
        });

        // 7. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: true,
                message: `Revoked ${result.modifiedCount} share link(s)`,
                revokedCount: result.modifiedCount,
                remaining: rateCheck.remaining
            }
        };

        logFunctionExecution('RevokeShareLink', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            revokedCount: result.modifiedCount
        });

    } catch (error) {
        logError('RevokeShareLink failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            error: error.message,
            stack: error.stack
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to revoke share link',
                correlationId
            }
        };

        logFunctionExecution('RevokeShareLink', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });
    }
};
