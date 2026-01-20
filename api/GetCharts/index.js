const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { logFunctionExecution, logError, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');
const { getUserGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');
const { ROLES } = require('../shared/authorization');

/**
 * GET /api/v1/charts
 *
 * List all charts accessible to the user
 * - All authenticated users can view all charts (implicit viewer role)
 * - User-specific roles (owner/editor) determined by permissions and global roles
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();

    // 1. Authentication check (required)
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

        // 3. Rate limiting (IP-based for anonymous, userId-based for authenticated)
        const rateCheck = await checkRateLimit(effectiveUserId, 'GET_CHARTS', client, req);
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

        // 4. Parse pagination parameters
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Default 50, max 100
        const offset = Math.max(parseInt(req.query.offset) || 0, 0); // Default 0
        const sortField = req.query.sortBy || 'lastModified'; // Default sort by lastModified
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1; // Default descending
        const includeDataRaw = (req.query.includeData || '').toString().toLowerCase();
        const includeData = includeDataRaw === 'true' || includeDataRaw === '1';

        // Validate sort field to prevent injection
        const allowedSortFields = ['lastModified', 'createdAt', 'name'];
        const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'lastModified';

        // 5. Query database for charts
        const db = client.db('orgchart');
        const charts = db.collection('charts');

        // All authenticated users can see all charts
        // No filtering by ownership or permissions at query level
        const query = {};

        // Get total count for pagination metadata
        const totalCount = await charts.countDocuments(query);

        const projection = {
            id: 1,
            name: 1,
            ownerId: 1,
            lastModified: 1,
            createdAt: 1,
            permissions: 1,
            isPublic: 1,
            _id: 0  // Exclude MongoDB internal ID
        };

        if (includeData) {
            projection.data = 1;
        }

        // Find all charts
        const userCharts = await charts.find(query)
            .project(projection)
            .sort({ [finalSortField]: sortOrder })
            .skip(offset)
            .limit(limit)
            .toArray();

        // 5b. Get user's global role
        const globalRole = await getUserGlobalRole(effectiveUserId, client);

        // 5c. Enrich each chart with user's role and permissions info
        const enrichedCharts = userCharts.map(chart => {
            let userRole = 'viewer';
            let roleSource = 'authenticated-user';

            // Determine user's role for this chart (priority order)
            if (chart.ownerId === effectiveUserId) {
                userRole = 'owner';
                roleSource = 'owner';
            } else {
                // Check chart-level permissions first
                const permission = chart.permissions?.find(p => p.userId === effectiveUserId);
                if (permission) {
                    userRole = permission.role;
                    roleSource = 'chart-permission';
                } else if (globalRole) {
                    // Fallback to global role
                    if (globalRole === GLOBAL_ROLES.ADMIN || globalRole === GLOBAL_ROLES.EDITOR) {
                        userRole = 'editor';
                        roleSource = 'global-role';
                    } else if (globalRole === GLOBAL_ROLES.VIEWER) {
                        userRole = 'viewer';
                        roleSource = 'global-role';
                    }
                }
                // Default: authenticated users get viewer (roleSource already set)
            }

            const responseChart = {
                id: chart.id,
                name: chart.name,
                ownerId: chart.ownerId,
                lastModified: chart.lastModified,
                createdAt: chart.createdAt,
                userRole: userRole,
                roleSource: roleSource,
                isPublic: chart.isPublic || false,
                sharedWith: chart.ownerId === effectiveUserId ? chart.permissions?.length || 0 : undefined
            };

            if (includeData) {
                responseChart.data = chart.data || {};
            }

            return responseChart;
        });

        // 6. Log success
        logFunctionExecution('GetCharts', effectiveUserId, startTime, true, {
            correlationId,
            chartCount: enrichedCharts.length,
            totalCount: totalCount,
            limit: limit,
            offset: offset,
            includeData: includeData,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 7. Return response with pagination metadata
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                charts: enrichedCharts,
                pagination: {
                    count: enrichedCharts.length,
                    total: totalCount,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + enrichedCharts.length < totalCount
                },
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('GetCharts failed', {
            correlationId,
            userId: effectiveUserId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('GetCharts', effectiveUserId, startTime, false, {
            correlationId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to retrieve charts',
                correlationId
            }
        };
    }
};
