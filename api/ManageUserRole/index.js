const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { hasGlobalRole, setUserGlobalRole, removeUserGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * POST /api/v1/admin/users/{userId}/role - Grant global role to user
 * DELETE /api/v1/admin/users/{userId}/role - Revoke global role from user
 *
 * Admin-only operation to manage global application roles
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const targetUserId = req.params.userId;
    const method = req.method.toUpperCase();
    const isGrant = method === 'POST';

    // 1. Authentication check
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;
    const effectiveUserEmail = user.userEmail;
    const isLocalDev = user.isLocalDev;

    // 2. Validate target user ID
    if (!targetUserId || typeof targetUserId !== 'string') {
        context.res = {
            status: 400,
            body: { error: 'Invalid user ID' }
        };
        return;
    }

    let client;
    try {
        // 3. Get reusable DB client
        client = await getCosmosClient();

        // 4. Rate limiting
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

        // 5. Authorization check - require ADMIN role
        const isAdmin = await hasGlobalRole(effectiveUserId, GLOBAL_ROLES.ADMIN, client);
        if (!isAdmin) {
            logWarn('Non-admin attempted role management', {
                correlationId,
                userId: effectiveUserId,
                targetUserId,
                method
            });

            context.res = {
                status: 403,
                body: { error: 'Access denied: Admin role required' }
            };
            return;
        }

        let result;
        if (isGrant) {
            // POST - Grant role
            const requestedRole = req.body?.role;

            if (!requestedRole) {
                context.res = {
                    status: 400,
                    body: { error: 'Role is required in request body' }
                };
                return;
            }

            // Validate role
            const validRoles = Object.values(GLOBAL_ROLES);
            if (!validRoles.includes(requestedRole)) {
                context.res = {
                    status: 400,
                    body: {
                        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
                        validRoles: validRoles
                    }
                };
                return;
            }

            // Grant role
            result = await setUserGlobalRole(targetUserId, requestedRole, effectiveUserId, client);

            if (result.success) {
                logInfo('Global role granted', {
                    correlationId,
                    adminUserId: effectiveUserId,
                    targetUserId,
                    role: requestedRole
                });
            }

        } else {
            // DELETE - Revoke role
            result = await removeUserGlobalRole(targetUserId, client);

            if (result.success) {
                logInfo('Global role revoked', {
                    correlationId,
                    adminUserId: effectiveUserId,
                    targetUserId
                });
            }
        }

        // 6. Log success
        logFunctionExecution('ManageUserRole', effectiveUserId, startTime, result.success, {
            correlationId,
            targetUserId,
            method,
            success: result.success,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 7. Return response
        context.res = {
            status: result.success ? 200 : 400,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: result.success,
                message: result.message,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('ManageUserRole failed', {
            correlationId,
            userId: effectiveUserId,
            targetUserId,
            method,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('ManageUserRole', effectiveUserId, startTime, false, {
            correlationId,
            targetUserId,
            method,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to manage user role',
                correlationId
            }
        };
    }
};
