const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * GET /api/v1/charts/{chartId}
 *
 * Retrieve a specific chart by ID
 * - All authenticated users can view any chart (implicit viewer role)
 * - Read-only mode for viewers; edit mode for editors/owners
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;

    // 1. Authentication check (required)
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

        // 4. Rate limiting (IP-based for anonymous, userId-based for authenticated)
        const rateCheck = await checkRateLimit(effectiveUserId, 'GET_CHART', client, req);
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

        // 5. Authorization check (requires VIEWER role)
        const authResult = await canAccessChart(chartId, effectiveUserId, ROLES.VIEWER, client);
        if (!authResult.allowed) {
            logWarn('Chart access denied', {
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

        // 6. Retrieve chart from database
        const db = client.db('orgchart');
        const charts = db.collection('charts');

        const chart = await charts.findOne(
            { id: chartId },
            { projection: { _id: 0 } }  // Exclude MongoDB internal ID
        );

        if (!chart) {
            logWarn('Chart not found in database', {
                correlationId,
                userId: effectiveUserId,
                chartId
            });

            context.res = {
                status: 404,
                body: { error: 'Chart not found' }
            };
            return;
        }

        // 7. Sanitize chart data based on user role
        // SECURITY: Never expose permissions array to non-owner users
        const isOwner = chart.ownerId === effectiveUserId;
        const sanitizedChart = {
            ...chart,
            permissions: isOwner ? chart.permissions : undefined
        };

        // Determine if chart is read-only for this user
        const isReadOnly = authResult.userRole === ROLES.VIEWER;

        // 8. Log success
        logFunctionExecution('GetChart', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            userRole: authResult.userRole,
            roleSource: authResult.source,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 9. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                chart: sanitizedChart,
                userRole: authResult.userRole,
                roleSource: authResult.source,
                isReadOnly: isReadOnly,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('GetChart failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('GetChart', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to retrieve chart',
                correlationId
            }
        };
    }
};
