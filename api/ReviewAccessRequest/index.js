const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { hasGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');
const { shareChart } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * PUT /api/v1/access-requests/{requestId}
 *
 * Review an access request (approve or deny)
 * - Chart owners can review requests for their charts
 * - Admins can review any request
 *
 * Request body:
 * - action: 'approve' or 'deny'
 * - notes: Optional review notes
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const requestId = req.params.requestId;

    // 1. Authentication check
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;
    const effectiveUserEmail = user.userEmail;
    const isLocalDev = user.isLocalDev;

    // 2. Validate request ID (UUID format)
    if (!isValidChartId(requestId)) {  // Reusing UUID validation
        logWarn('Invalid request ID format', {
            correlationId,
            userId: effectiveUserId,
            requestId
        });

        context.res = {
            status: 400,
            body: { error: 'Invalid request ID format' }
        };
        return;
    }

    // 3. Validate request body
    const action = req.body?.action;
    const reviewNotes = req.body?.notes || ''; // Optional, defaults to empty string
    const grantedRole = req.body?.grantedRole; // Optional role override for approvals

    if (!action || !['approve', 'deny'].includes(action)) {
        context.res = {
            status: 400,
            body: {
                error: 'Invalid action. Must be "approve" or "deny"',
                validActions: ['approve', 'deny']
            }
        };
        return;
    }

    // Validate review notes length only if provided
    if (reviewNotes && reviewNotes.length > 500) {
        context.res = {
            status: 400,
            body: { error: 'Review notes must be 500 characters or less' }
        };
        return;
    }

    // Validate grantedRole if provided (only for approvals)
    if (grantedRole && !['viewer', 'editor'].includes(grantedRole)) {
        context.res = {
            status: 400,
            body: {
                error: 'Invalid granted role. Must be "viewer" or "editor"',
                validRoles: ['viewer', 'editor']
            }
        };
        return;
    }

    let client;
    try {
        // 4. Get reusable DB client
        client = await getCosmosClient();

        // 5. Rate limiting
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

        // 6. Check if user is admin
        const isAdmin = await hasGlobalRole(effectiveUserId, GLOBAL_ROLES.ADMIN, client);

        // 7. Fetch the access request
        const db = client.db('orgchart');
        const accessRequests = db.collection('access_requests');

        const request = await accessRequests.findOne({ id: requestId });

        if (!request) {
            context.res = {
                status: 404,
                body: { error: 'Access request not found' }
            };
            return;
        }

        // 8. Verify request is still pending
        if (request.status !== 'pending') {
            context.res = {
                status: 400,
                body: {
                    error: `Request has already been ${request.status}`,
                    currentStatus: request.status,
                    reviewedBy: request.reviewedBy,
                    reviewedAt: request.reviewedAt
                }
            };
            return;
        }

        // 9. Authorization check
        // Only chart owner or admin can review
        const isChartOwner = request.chartOwnerId === effectiveUserId;

        if (!isChartOwner && !isAdmin) {
            logWarn('Unauthorized review attempt', {
                correlationId,
                userId: effectiveUserId,
                requestId,
                chartOwnerId: request.chartOwnerId
            });

            context.res = {
                status: 403,
                body: { error: 'Access denied: You must be the chart owner or admin to review this request' }
            };
            return;
        }

        // 10. If approving, grant chart permission FIRST before marking approved
        let shareResult = null;
        const roleToGrant = action === 'approve' ? (grantedRole || request.requestedRole) : null;

        if (action === 'approve') {
            // Admin bypass: Allow admins to approve any chart without ownership check
            shareResult = await shareChart(
                request.chartId,
                request.chartOwnerId,  // Use chart owner ID for authorization
                request.requesterId,
                roleToGrant,
                client,
                isAdmin  // Bypass ownership check if reviewer is admin
            );

            if (!shareResult.success) {
                logError('Failed to grant permission during approval', {
                    correlationId,
                    requestId,
                    chartId: request.chartId,
                    grantedRole: roleToGrant,
                    error: shareResult.message
                });

                // Don't mark as approved if permission grant failed - leave as pending
                context.res = {
                    status: 500,
                    body: {
                        error: 'Failed to grant chart permission. Request remains pending.',
                        details: shareResult.message
                    }
                };
                return;
            }

            // Note: This only grants chart-level permissions.
            // Global roles are managed separately via the Global Roles tab.
        }

        // 11. Update request status AFTER successful permission grant (for approvals)
        const now = new Date();
        const newStatus = action === 'approve' ? 'approved' : 'denied';

        await accessRequests.updateOne(
            { id: requestId },
            {
                $set: {
                    status: newStatus,
                    reviewedBy: effectiveUserId,
                    reviewedAt: now,
                    reviewNotes: reviewNotes.trim()
                }
            }
        );

        const roleGranted = action === 'approve' ? (grantedRole || request.requestedRole) : null;

        logInfo('Access request reviewed', {
            correlationId,
            reviewerId: effectiveUserId,
            requestId,
            chartId: request.chartId,
            action: action,
            requesterId: request.requesterId,
            requestedRole: request.requestedRole,
            grantedRole: roleGranted
        });

        // 12. Log success
        logFunctionExecution('ReviewAccessRequest', effectiveUserId, startTime, true, {
            correlationId,
            requestId,
            action,
            isAdmin,
            isChartOwner,
            requestedRole: request.requestedRole,
            grantedRole: roleGranted,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 13. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: true,
                requestId: requestId,
                action: action,
                status: newStatus,
                message: action === 'approve'
                    ? `Access granted: ${request.requesterId} now has ${roleGranted} access`
                    : 'Access request denied',
                grantedRole: roleGranted,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('ReviewAccessRequest failed', {
            correlationId,
            userId: effectiveUserId,
            requestId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('ReviewAccessRequest', effectiveUserId, startTime, false, {
            correlationId,
            requestId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to review access request',
                correlationId
            }
        };
    }
};
