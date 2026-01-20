const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canPerformAction } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * GET /api/v1/charts/{chartId}/share-link
 *
 * Get existing shareable link for a chart (owner only)
 * Returns 404 if no active link exists (no creation side effects)
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;

    // 1. Authentication check (required - only owners can view links)
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
        const rateCheck = await checkRateLimit(effectiveUserId, 'SHARE_LINK_GET_META', client);
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

        // 5. Authorization check (requires OWNER role for share action)
        const authResult = await canPerformAction(chartId, effectiveUserId, 'share', client);
        if (!authResult.allowed) {
            logWarn('User not authorized to view share link', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                reason: authResult.reason
            });

            context.res = {
                status: 403,
                body: { error: authResult.reason || 'Only chart owners can view share links' }
            };
            return;
        }

        // 6. Look up existing active link
        const db = client.db('orgchart');
        const shareLinks = db.collection('chart_share_links');

        const existingLink = await shareLinks.findOne({
            chartId: chartId,
            revokedAt: null,
            $or: [
                { expiresAt: null },
                { expiresAt: { $gt: new Date() } }
            ]
        });

        // 7. Return 404 if no active link exists
        if (!existingLink) {
            logInfo('No active share link found', {
                correlationId,
                chartId,
                userId: effectiveUserId
            });

            context.res = {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Correlation-Id': correlationId
                },
                body: {
                    error: 'No active share link found for this chart',
                    errorType: 'NO_ACTIVE_LINK',
                    remaining: rateCheck.remaining
                }
            };

            logFunctionExecution('GetShareLink', effectiveUserId, startTime, true, {
                correlationId,
                chartId,
                found: false
            });

            return;
        }

        // 8. Return existing link
        logInfo('Share link retrieved', {
            correlationId,
            chartId,
            tokenId: existingLink.id,
            userId: effectiveUserId
        });

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                token: existingLink.token,
                url: `${getBaseUrl(req)}/shared.html?token=${existingLink.token}`,
                createdAt: existingLink.createdAt,
                expiresAt: existingLink.expiresAt,
                accessCount: existingLink.accessCount || 0,
                lastAccessedAt: existingLink.lastAccessedAt,
                remaining: rateCheck.remaining
            }
        };

        logFunctionExecution('GetShareLink', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            found: true
        });

    } catch (error) {
        logError('GetShareLink failed', {
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
                error: 'Failed to retrieve share link',
                correlationId
            }
        };

        logFunctionExecution('GetShareLink', effectiveUserId, startTime, false, {
            correlationId,
            chartId,
            error: error.message
        });
    }
};

/**
 * Helper to construct base URL for share links
 *
 * @param {object} req - Azure Function request
 * @returns {string} Base URL (protocol + host)
 */
function getBaseUrl(req) {
    // In Azure SWA, use x-forwarded-host or fallback
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:4280';

    // Detect local development (localhost or 127.0.0.1)
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = req.headers['x-forwarded-proto'] || (isLocalhost ? 'http' : 'https');

    return `${protocol}://${host}`;
}
