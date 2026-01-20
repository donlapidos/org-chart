const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { hasGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');
const { logFunctionExecution, logError, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * GET /api/v1/access-requests
 *
 * List access requests
 * - Admins: See all requests
 * - Chart owners: See requests for their charts
 * - Regular users: See their own requests
 *
 * Query parameters:
 * - status: Filter by status (pending, approved, denied)
 * - limit: Max results (default 50, max 100)
 * - offset: Pagination offset (default 0)
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    // 1. Authentication check
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;
    const effectiveUserEmail = user.userEmail;
    const isLocalDev = user.isLocalDev;

    let client;
    try {
        // 2. Get reusable DB client
        client = await getCosmosClient();

        // 3. Rate limiting
        const rateCheck = await checkRateLimit(effectiveUserId, 'GET_CHARTS', client);
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

        // 4. Check if user is admin
        const isAdmin = await hasGlobalRole(effectiveUserId, GLOBAL_ROLES.ADMIN, client);

        // 5. Parse query parameters
        const statusFilter = req.query.status || null;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);

        // Validate status filter
        const validStatuses = ['pending', 'approved', 'denied'];
        if (statusFilter && !validStatuses.includes(statusFilter)) {
            context.res = {
                status: 400,
                body: {
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
                    validStatuses: validStatuses
                }
            };
            return;
        }

        // 6. Build query based on user role
        const db = client.db('orgchart');
        const accessRequests = db.collection('access_requests');
        const charts = db.collection('charts');

        let query;
        if (isAdmin) {
            // Admins see all requests
            query = statusFilter ? { status: statusFilter } : {};
        } else {
            // Find charts owned by this user
            const ownedCharts = await charts.find({ ownerId: effectiveUserId })
                .project({ id: 1, _id: 0 })
                .toArray();
            const ownedChartIds = ownedCharts.map(c => c.id);

            // Non-admins see:
            // 1. Requests for charts they own (to review)
            // 2. Their own requests (to track status)
            query = {
                $or: [
                    { chartOwnerId: effectiveUserId },  // Requests for their charts
                    { requesterId: effectiveUserId }     // Their own requests
                ]
            };

            if (statusFilter) {
                query.status = statusFilter;
            }
        }

        // 7. Get total count for pagination
        const totalCount = await accessRequests.countDocuments(query);

        // 8. Fetch access requests
        const requests = await accessRequests.find(query)
            .project({ _id: 0 })
            .sort({ requestedAt: -1 })  // Most recent first
            .skip(offset)
            .limit(limit)
            .toArray();

        // 9. Enrich requests with user's perspective
        const enrichedRequests = requests.map(request => ({
            ...request,
            isOwner: request.chartOwnerId === effectiveUserId,
            isRequester: request.requesterId === effectiveUserId,
            canReview: isAdmin || request.chartOwnerId === effectiveUserId
        }));

        // 10. Log success
        logFunctionExecution('GetAccessRequests', effectiveUserId, startTime, true, {
            correlationId,
            requestCount: enrichedRequests.length,
            totalCount: totalCount,
            statusFilter,
            isAdmin,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 11. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                requests: enrichedRequests,
                pagination: {
                    count: enrichedRequests.length,
                    total: totalCount,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + enrichedRequests.length < totalCount
                },
                isAdmin: isAdmin,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('GetAccessRequests failed', {
            correlationId,
            userId: effectiveUserId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('GetAccessRequests', effectiveUserId, startTime, false, {
            correlationId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to retrieve access requests',
                correlationId
            }
        };
    }
};
