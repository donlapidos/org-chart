const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { hasGlobalRole, listAllGlobalRoles, GLOBAL_ROLES } = require('../shared/globalRoles');
const { logFunctionExecution, logError, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * GET /api/v1/admin/users - List all users with global roles
 *
 * Admin-only operation to view all users with assigned global roles
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
        const rateCheck = await checkRateLimit(effectiveUserId, 'ADMIN_OPERATION', client);
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

        // 4. Authorization check - require ADMIN role
        const isAdmin = await hasGlobalRole(effectiveUserId, GLOBAL_ROLES.ADMIN, client);
        if (!isAdmin) {
            context.res = {
                status: 403,
                body: { error: 'Access denied: Admin role required' }
            };
            return;
        }

        // 5. Fetch all users with global roles
        const userRoles = await listAllGlobalRoles(client);

        // 6. Log success
        logFunctionExecution('GetGlobalRoles', effectiveUserId, startTime, true, {
            correlationId,
            userCount: userRoles.length,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 7. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                users: userRoles.map(role => ({
                    userId: role.userId,
                    role: role.role,
                    grantedBy: role.grantedBy,
                    grantedAt: role.grantedAt
                })),
                count: userRoles.length,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('GetGlobalRoles failed', {
            correlationId,
            userId: effectiveUserId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('GetGlobalRoles', effectiveUserId, startTime, false, {
            correlationId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to fetch global roles',
                correlationId
            }
        };
    }
};
