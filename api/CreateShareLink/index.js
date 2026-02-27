const crypto = require('crypto');
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canPerformAction } = require('../shared/authorization');
const { isValidChartId } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireAuth } = require('../shared/auth');

/**
 * POST /api/v1/charts/{chartId}/share-link
 * Query params: ?regenerate=true (optional, forces new token)
 *
 * Create or retrieve shareable link for a chart (owner only)
 * Idempotent: Returns existing token if one exists (unless regenerate=true)
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const chartId = req.params.chartId;
    const regenerate = req.query.regenerate === 'true';

    // 1. Authentication check (required - only owners can create links)
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
        const rateCheck = await checkRateLimit(effectiveUserId, 'SHARE_LINK_CREATE', client);
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
            logWarn('User not authorized to create share link', {
                correlationId,
                userId: effectiveUserId,
                chartId,
                reason: authResult.reason
            });

            context.res = {
                status: 403,
                body: { error: authResult.reason || 'Only chart owners can create share links' }
            };
            return;
        }

        // 6. Check if active link already exists
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

        // If exists and not regenerating, return existing
        if (existingLink && !regenerate) {
            logInfo('Returning existing share link', {
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
                    isNew: false,
                    remaining: rateCheck.remaining
                }
            };

            logFunctionExecution('CreateShareLink', effectiveUserId, startTime, true, {
                correlationId,
                chartId,
                existingToken: true
            });

            return;
        }

        // 7. If regenerating, revoke old link
        if (existingLink && regenerate) {
            await shareLinks.updateOne(
                { id: existingLink.id },
                { $set: { revokedAt: new Date() } }
            );

            logInfo('Revoked old share link for regeneration', {
                correlationId,
                chartId,
                oldTokenId: existingLink.id,
                userId: effectiveUserId
            });
        }

        // 8. Create new share link
        const newLink = {
            id: crypto.randomUUID(),
            token: crypto.randomUUID(),
            chartId: chartId,
            createdBy: effectiveUserId,
            createdAt: new Date(),
            revokedAt: null,
            expiresAt: null,  // No expiration for now (Phase 1)
            lastAccessedAt: null,
            accessCount: 0,
            role: 'viewer'
        };

        await shareLinks.insertOne(newLink);

        logInfo('Created new share link', {
            correlationId,
            chartId,
            tokenId: newLink.id,
            createdBy: effectiveUserId
        });

        // 9. Return response
        context.res = {
            status: 201,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId
            },
            body: {
                token: newLink.token,
                url: `${getBaseUrl(req)}/shared.html?token=${newLink.token}`,
                createdAt: newLink.createdAt,
                expiresAt: newLink.expiresAt,
                isNew: true,
                remaining: rateCheck.remaining
            }
        };

        logFunctionExecution('CreateShareLink', effectiveUserId, startTime, true, {
            correlationId,
            chartId,
            regenerate
        });

    } catch (error) {
        logError('CreateShareLink failed', {
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
                error: 'Failed to create share link',
                correlationId
            }
        };

        logFunctionExecution('CreateShareLink', effectiveUserId, startTime, false, {
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
    // Prefer explicit env var (required for Azure SWA BYO backend — x-forwarded-host is unreliable)
    if (process.env.FRONTEND_URL) {
        return process.env.FRONTEND_URL.replace(/\/$/, '');
    }

    // In Azure SWA, use x-forwarded-host or fallback
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:4280';

    // Detect local development (localhost or 127.0.0.1)
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = req.headers['x-forwarded-proto'] || (isLocalhost ? 'http' : 'https');

    return `${protocol}://${host}`;
}
