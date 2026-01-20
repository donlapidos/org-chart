const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * DELETE /api/v1/charts/{chartId}
 *
 * Soft delete a chart (moves to deleted_charts collection with 90-day TTL)
 * Requires OWNER role
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;

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
        const rateCheck = await checkRateLimit(effectiveUserId, 'DELETE_CHART', client);
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
        const authResult = await canAccessChart(chartId, effectiveUserId, ROLES.OWNER, client);
        if (!authResult.allowed) {
            logWarn('Chart delete access denied', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                reason: authResult.reason
            });

            context.res = {
                status: authResult.reason === 'Chart not found' ? 404 : 403,
                body: { error: authResult.reason }
            };
            return;
        }

        // 6. Perform soft delete with transaction for atomicity
        const db = client.db('orgchart');
        const charts = db.collection('charts');
        const deletedCharts = db.collection('deleted_charts');

        // Retrieve the chart before deletion
        const chart = await charts.findOne({ id: chartId });

        if (!chart) {
            context.res = {
                status: 404,
                body: { error: 'Chart not found' }
            };
            return;
        }

        // Use transaction to ensure atomicity (both operations succeed or both fail)
        const session = client.startSession();

        // Declare dates outside transaction scope so they're accessible after
        const deletedAt = new Date();
        const expiresAt = new Date(deletedAt.getTime() + (90 * 24 * 60 * 60 * 1000)); // 90 days

        try {
            await session.withTransaction(async () => {
                // Move to deleted_charts collection with TTL (90 days)
                await deletedCharts.insertOne({
                    ...chart,
                    deletedAt: deletedAt,
                    deletedBy: effectiveUserId,
                    expiresAt: expiresAt  // TTL index will auto-delete after 90 days
                }, { session });

                // Remove from active charts collection
                await charts.deleteOne({ id: chartId }, { session });
            });
        } finally {
            await session.endSession();
        }

        logInfo('Chart soft deleted successfully', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            chartName: chart.name,
            expiresAt: expiresAt.toISOString()
        });

        // 7. Log success
        logFunctionExecution('DeleteChart', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 8. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: true,
                message: 'Chart deleted successfully',
                chartId: chartId,
                recoveryPeriod: '90 days',
                expiresAt: expiresAt.toISOString(),
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('DeleteChart failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('DeleteChart', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to delete chart',
                correlationId
            }
        };
    }
};
