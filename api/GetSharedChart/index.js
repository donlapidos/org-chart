const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { isValidToken } = require('../shared/validation');
const { logFunctionExecution, logError, logWarn, logInfo, generateCorrelationId } = require('../shared/logger');
const { requireOptionalAuth } = require('../shared/auth');

/**
 * GET /api/v1/shared/{token}
 *
 * Retrieve chart data via shareable link (anonymous access allowed)
 * SECURITY CRITICAL: Never returns permissions array or ownerId
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const token = req.params.token;

    // 1. Optional authentication (allows anonymous)
    const user = requireOptionalAuth(context, req);
    const effectiveUserId = user?.userId || null;
    const isAnonymous = !user;

    // 2. Validate token format
    if (!isValidToken(token)) {
        logWarn('Invalid token format', {
            correlationId,
            token: token ? token.substring(0, 8) + '...' : 'null',
            isAnonymous
        });

        context.res = {
            status: 400,
            body: {
                error: 'Invalid token format',
                errorType: 'INVALID_TOKEN'
            }
        };
        return;
    }

    let client;
    try {
        // 3. Get DB client
        client = await getCosmosClient();

        // 4. Rate limiting (IP-based for anonymous, userId-based for authenticated)
        const rateCheck = await checkRateLimit(effectiveUserId, 'SHARE_LINK_GET', client, req);
        if (!rateCheck.allowed) {
            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: {
                    error: rateCheck.message,
                    retryAfter: rateCheck.retryAfter,
                    errorType: 'RATE_LIMIT'
                }
            };
            return;
        }

        // 5. Look up share link
        const db = client.db('orgchart');
        const shareLinks = db.collection('chart_share_links');

        const shareLink = await shareLinks.findOne({ token: token });

        if (!shareLink) {
            logWarn('Share link not found', {
                correlationId,
                token: token.substring(0, 8) + '...',  // Log partial token only
                isAnonymous
            });

            context.res = {
                status: 404,
                body: {
                    error: 'Share link not found',
                    errorType: 'NOT_FOUND'
                }
            };
            return;
        }

        // 6. Check if link is revoked
        if (shareLink.revokedAt) {
            logWarn('Share link revoked', {
                correlationId,
                tokenId: shareLink.id,
                chartId: shareLink.chartId,
                revokedAt: shareLink.revokedAt,
                isAnonymous
            });

            context.res = {
                status: 403,
                body: {
                    error: 'This share link has been revoked',
                    errorType: 'REVOKED',
                    revokedAt: shareLink.revokedAt
                }
            };
            return;
        }

        // 7. Check if link is expired
        if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
            logWarn('Share link expired', {
                correlationId,
                tokenId: shareLink.id,
                chartId: shareLink.chartId,
                expiresAt: shareLink.expiresAt,
                isAnonymous
            });

            context.res = {
                status: 403,
                body: {
                    error: 'This share link has expired',
                    errorType: 'EXPIRED',
                    expiresAt: shareLink.expiresAt
                }
            };
            return;
        }

        // 8. Retrieve chart data
        const charts = db.collection('charts');

        // SECURITY CRITICAL: Use projection to exclude sensitive fields
        const chart = await charts.findOne(
            { id: shareLink.chartId },
            {
                projection: {
                    _id: 0,           // MongoDB internal ID
                    permissions: 0,   // NEVER expose permissions array
                    ownerId: 0        // NEVER expose owner ID
                }
            }
        );

        if (!chart) {
            // Chart was deleted but link still exists
            logWarn('Chart not found for valid share link', {
                correlationId,
                tokenId: shareLink.id,
                chartId: shareLink.chartId,
                isAnonymous
            });

            context.res = {
                status: 404,
                body: {
                    error: 'Chart no longer exists',
                    errorType: 'CHART_DELETED'
                }
            };
            return;
        }

        // 9. Update access tracking (fire-and-forget, don't await)
        shareLinks.updateOne(
            { id: shareLink.id },
            {
                $set: { lastAccessedAt: new Date() },
                $inc: { accessCount: 1 }
            }
        ).catch(err => {
            // Don't fail the request if tracking update fails
            logError('Failed to update access tracking', {
                correlationId,
                tokenId: shareLink.id,
                error: err.message
            });
        });

        // 10. Log successful access
        logInfo('Shared chart accessed', {
            correlationId,
            tokenId: shareLink.id,
            chartId: shareLink.chartId,
            isAnonymous,
            userId: effectiveUserId
        });

        // 11. Return sanitized chart data
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Correlation-Id': correlationId,
                'Cache-Control': 'private, max-age=300'  // Cache for 5 minutes
            },
            body: {
                chart: chart,
                isSharedView: true,
                isReadOnly: true,
                userRole: 'viewer',
                remaining: rateCheck.remaining
            }
        };

        logFunctionExecution('GetSharedChart', effectiveUserId || 'anonymous', startTime, true, {
            correlationId,
            chartId: shareLink.chartId,
            isAnonymous
        });

    } catch (error) {
        logError('GetSharedChart failed', {
            correlationId,
            token: token ? token.substring(0, 8) + '...' : 'null',
            isAnonymous,
            error: error.message,
            stack: error.stack
        });

        context.res = {
            status: 500,
            headers: { 'X-Correlation-Id': correlationId },
            body: {
                error: 'Failed to retrieve shared chart',
                correlationId,
                errorType: 'SERVER_ERROR'
            }
        };

        logFunctionExecution('GetSharedChart', effectiveUserId || 'anonymous', startTime, false, {
            correlationId,
            isAnonymous,
            error: error.message
        });
    }
};
