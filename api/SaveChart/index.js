const { getCosmosClient } = require('../shared/cosmos');
const { validateChartPayload, sanitizeChartName, isValidChartId, validatePermissions, sanitizePermissions, normalizeIsPublic } = require('../shared/validation');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { getUserGlobalRole, GLOBAL_ROLES } = require('../shared/globalRoles');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/v1/charts - Create new chart
 * PUT /api/v1/charts/{chartId} - Update existing chart
 *
 * Creates or updates a chart
 * For updates, requires at least EDITOR role
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;
    const isUpdate = !!chartId;
    const method = req.method.toUpperCase();

    // 1. Authentication check
    const user = requireAuth(context, req);
    if (!user) {
        return; // requireAuth sets context.res
    }

    const effectiveUserId = user.userId;
    const effectiveUserEmail = user.userEmail;
    const isLocalDev = user.isLocalDev;

    // 2. Validate chart ID for updates
    if (isUpdate && !isValidChartId(chartId)) {
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
        const rateCheck = await checkRateLimit(effectiveUserId, 'SAVE_CHART', client);
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

        // 5a. Permission check for creation (only admin/editor can create new charts)
        if (!isUpdate) {
            const globalRole = await getUserGlobalRole(effectiveUserId, client);
            const canCreate = globalRole === GLOBAL_ROLES.ADMIN || globalRole === GLOBAL_ROLES.EDITOR;

            if (!canCreate) {
                logWarn('Chart creation denied - insufficient global role', {
                    correlationId,
                    userId: effectiveUserId,
                    globalRole
                });

                context.res = {
                    status: 403,
                    body: { error: 'You do not have permission to create charts. Contact an admin to be granted editor access.' }
                };
                return;
            }
        }

        // 5. Input validation
        const validation = validateChartPayload(req.body);
        if (!validation.valid) {
            logWarn('Chart validation failed', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                errors: validation.errors
            });

            context.res = {
                status: 400,
                body: {
                    error: 'Validation failed',
                    details: validation.errors
                }
            };
            return;
        }

        // 5b. Validate permissions if provided
        if (req.body.permissions) {
            const permissionValidation = validatePermissions(req.body.permissions);
            if (!permissionValidation.valid) {
                logWarn('Permission validation failed', {
                    correlationId,
                    userId: effectiveUserId,
                    chartId,
                    errors: permissionValidation.errors
                });

                context.res = {
                    status: 400,
                    body: {
                        error: 'Permission validation failed',
                        details: permissionValidation.errors
                    }
                };
                return;
            }
        }

        // 6. Authorization check for updates
        if (isUpdate) {
            const authResult = await canAccessChart(chartId, effectiveUserId, ROLES.EDITOR, client);
            if (!authResult.allowed) {
                logWarn('Chart update access denied', {
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
        }

        // 7. Prepare chart document
        const db = client.db('orgchart');
        const charts = db.collection('charts');

        const now = new Date();
        const finalChartId = isUpdate ? chartId : uuidv4();

        // Note: isPublic is always forced to false (anonymous access no longer supported)
        const chartDocument = {
            id: finalChartId,
            ownerId: effectiveUserId,
            name: sanitizeChartName(req.body.name),
            data: req.body.data,
            lastModified: now,
            permissions: sanitizePermissions(req.body.permissions, effectiveUserId),
            isPublic: false  // Always false - no public/anonymous access
        };

        // 8. Save to database
        if (isUpdate) {
            // Update existing chart
            const updateFields = {
                name: chartDocument.name,
                data: chartDocument.data,
                lastModified: chartDocument.lastModified
            };

            // isPublic is not updateable - always forced to false
            // Remove the field from updates to avoid confusion

            const result = await charts.updateOne(
                { id: finalChartId },
                { $set: updateFields }
            );

            if (result.matchedCount === 0) {
                context.res = {
                    status: 404,
                    body: { error: 'Chart not found' }
                };
                return;
            }

            logInfo('Chart updated successfully', {
                correlationId,
                userId: effectiveUserId,
                chartId: finalChartId,
                chartName: chartDocument.name
            });

        } else {
            // Create new chart
            chartDocument.createdAt = now;

            await charts.insertOne(chartDocument);

            logInfo('Chart created successfully', {
                correlationId,
                userId: effectiveUserId,
                chartId: finalChartId,
                chartName: chartDocument.name
            });
        }

        // 9. Log success
        logFunctionExecution('SaveChart', effectiveUserId, startTime, true, {
            correlationId,
            chartId: finalChartId,
            isUpdate,
            method,
            userEmail: effectiveUserEmail,
            isLocalDev
        });

        // 10. Return response
        context.res = {
            status: isUpdate ? 200 : 201,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                success: true,
                chartId: finalChartId,
                message: isUpdate ? 'Chart updated successfully' : 'Chart created successfully',
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logError('SaveChart failed', {
            correlationId,
            userId: effectiveUserId,
            chartId,
            isUpdate,
            error: error.message,
            stack: error.stack
        });

        logFunctionExecution('SaveChart', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            isUpdate,
            error: error.message
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to save chart',
                correlationId
            }
        };
    }
};
