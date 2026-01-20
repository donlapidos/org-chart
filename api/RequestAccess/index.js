const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/v1/charts/{chartId}/access-requests
 *
 * Request access to a chart
 * Creates a pending access request for chart owner to review
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;

    // 1. Authentication check (required for access requests)
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

    // 3. Validate request body
    const requestedRole = req.body?.requestedRole || 'editor';
    const reason = req.body?.reason || ''; // Optional, defaults to empty string

    // Validate role
    const validRoles = ['viewer', 'editor'];
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

    // Validate reason length only if provided
    if (reason && reason.length > 500) {
        context.res = {
            status: 400,
            body: { error: 'Reason must be 500 characters or less' }
        };
        return;
    }

    let client;
    try {
        // 4. Get reusable DB client
        client = await getCosmosClient();

        // 5. Rate limiting
        const rateCheck = await checkRateLimit(effectiveUserId, 'REQUEST_ACCESS', client);
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

        // 6. Verify chart exists
        const db = client.db('orgchart');
        const charts = db.collection('charts');
        const accessRequests = db.collection('access_requests');

        const chart = await charts.findOne({ id: chartId });

        if (!chart) {
            context.res = {
                status: 404,
                body: { error: 'Chart not found' }
            };
            return;
        }

        // 7. Check if user is already the owner
        if (chart.ownerId === effectiveUserId) {
            context.res = {
                status: 400,
                body: { error: 'You are already the owner of this chart' }
            };
            return;
        }

        // 8. Check if user already has permissions
        const existingPermission = chart.permissions?.find(p => p.userId === effectiveUserId);
        if (existingPermission) {
            context.res = {
                status: 400,
                body: {
                    error: `You already have ${existingPermission.role} access to this chart`,
                    currentRole: existingPermission.role
                }
            };
            return;
        }

        // 9. Check for existing pending request and upsert
        const existingRequest = await accessRequests.findOne({
            chartId: chartId,
            requesterId: effectiveUserId,
            status: 'pending'
        });

        const now = new Date();
        let requestId;
        let isUpdate = false;

        if (existingRequest) {
            // Update existing pending request
            requestId = existingRequest.id;
            isUpdate = true;

            await accessRequests.updateOne(
                { id: requestId },
                {
                    $set: {
                        requestedRole: requestedRole,
                        reason: reason.trim(),
                        requestedAt: now,
                        reviewedBy: null,
                        reviewedAt: null,
                        reviewNotes: null,
                        status: 'pending'
                    }
                }
            );
        } else {
            // 10. Create new access request
            requestId = uuidv4();

            const accessRequest = {
                id: requestId,
                chartId: chartId,
                chartName: chart.name,
                chartOwnerId: chart.ownerId,
                requesterId: effectiveUserId,
                requesterEmail: effectiveUserEmail,
                requestedRole: requestedRole,
                reason: reason.trim(),
                status: 'pending',
                requestedAt: now,
                reviewedBy: null,
                reviewedAt: null,
                reviewNotes: null
            };

            await accessRequests.insertOne(accessRequest);
        }

        logInfo(isUpdate ? 'Access request updated' : 'Access request created', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            requestId,
            requestedRole,
            isUpdate
        });

        // 11. Log success
        logFunctionExecution('RequestAccess', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            requestId,
            requestedRole,
            isUpdate,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 12. Return response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: true,
                requestId: requestId,
                message: isUpdate
                    ? 'Access request updated successfully'
                    : 'Access request submitted successfully',
                status: 'pending',
                isUpdate: isUpdate,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('RequestAccess failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('RequestAccess', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to create access request',
                correlationId
            }
        };
    }
};
