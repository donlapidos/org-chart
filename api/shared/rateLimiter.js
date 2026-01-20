/**
 * Rate limiting configuration
 * NOTE: This is implemented in code, not at the Azure platform level.
 * Azure SWA provides DDoS protection, but per-user limits are enforced here.
 */
const RATE_LIMITS = {
    SAVE_CHART: {
        max: 100,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    GET_CHARTS: {
        max: 500,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    GET_CHART: {
        max: 1000,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    DELETE_CHART: {
        max: 20,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    SHARE_CHART: {
        max: 50,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    EXPORT_CHART: {
        max: 5,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    // Share link operations
    SHARE_LINK_CREATE: {
        max: 20,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    SHARE_LINK_GET: {
        max: 200,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    SHARE_LINK_GET_META: {
        max: 100,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    SHARE_LINK_REVOKE: {
        max: 20,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    // Anonymous user limits (IP-based, more restrictive)
    ANONYMOUS_GET_CHARTS: {
        max: 100,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    ANONYMOUS_GET_CHART: {
        max: 200,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    REQUEST_ACCESS: {
        max: 10,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    },
    ADMIN_OPERATION: {
        max: 100,
        windowMs: 60 * 60 * 1000,  // 1 hour
        name: '1 hour'
    }
};

/**
 * Extract IP address from request headers
 *
 * @param {object} req - Azure Function request
 * @returns {string} IP address
 */
function getClientIp(req) {
    // Azure SWA/Functions provides forwarded IP in x-forwarded-for
    const forwardedFor = req.headers['x-forwarded-for'];

    if (forwardedFor) {
        // x-forwarded-for may contain multiple IPs (client, proxy1, proxy2)
        // The first one is the original client
        return forwardedFor.split(',')[0].trim();
    }

    // Fallback to other headers
    return req.headers['x-client-ip'] ||
           req.headers['x-real-ip'] ||
           'unknown';
}

/**
 * Check if user has exceeded rate limit for a specific action
 *
 * Uses atomic operations to prevent race conditions in concurrent requests.
 * Maintains a single counter document per user+action+window.
 * Supports both authenticated (userId-based) and anonymous (IP-based) rate limiting.
 *
 * @param {string|null} userId - The user's ID from Azure AD (null for anonymous)
 * @param {string} action - The action being rate limited (e.g., 'SAVE_CHART')
 * @param {MongoClient} client - The MongoDB client
 * @param {object} req - Azure Function request (for IP extraction if anonymous)
 * @returns {Promise<object>} { allowed: boolean, remaining?: number, message?: string, retryAfter?: number }
 */
async function checkRateLimit(userId, action, client, req = null) {
    let limit = RATE_LIMITS[action];
    let identifier = userId;

    // For anonymous users, use IP-based rate limiting with stricter limits
    if (!userId) {
        if (!req) {
            // If no request object, can't get IP - fail open with warning
            console.warn('Rate limiter: No userId or request object provided');
            return { allowed: true };
        }

        identifier = getClientIp(req);

        // Use anonymous-specific limits if available
        const anonymousAction = `ANONYMOUS_${action}`;
        if (RATE_LIMITS[anonymousAction]) {
            limit = RATE_LIMITS[anonymousAction];
            action = anonymousAction;
        }
    }

    // If no limit defined for this action, allow it
    if (!limit) {
        return { allowed: true };
    }

    const db = client.db('orgchart');
    const rateLimits = db.collection('rate_limits');

    const now = new Date();

    // Create a unique key for this time window (bucket by hour for 1-hour windows)
    // This ensures we have one document per identifier+action+window
    const windowKey = Math.floor(now.getTime() / limit.windowMs);
    const docId = `${identifier}:${action}:${windowKey}`;

    // Calculate when this window started (aligned to window boundaries)
    const windowStart = new Date(windowKey * limit.windowMs);

    try {
        // Atomically increment counter or create document if it doesn't exist
        const result = await rateLimits.findOneAndUpdate(
            {
                id: docId
            },
            {
                $inc: { count: 1 },
                $setOnInsert: {
                    id: docId,
                    userId: identifier,  // May be userId or IP address
                    action: action,
                    windowStart: windowStart,
                    expiresAt: new Date(windowStart.getTime() + limit.windowMs + 60000) // TTL + 1 min buffer
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        // findOneAndUpdate returns { value: {...}, lastErrorObject: {...} }
        // In older MongoDB drivers it's .value, in newer ones it might be different
        const doc = result.value || result;

        if (!doc || !doc.count) {
            // Fallback: if we can't read the count, fail open
            console.warn('Rate limiter: Could not read count from result', result);
            return { allowed: true };
        }

        const currentCount = doc.count;

        // Check if limit exceeded
        if (currentCount > limit.max) {
            // Calculate when this window expires
            const resetTime = new Date(doc.windowStart.getTime() + limit.windowMs);
            const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);

            return {
                allowed: false,
                message: `Rate limit exceeded: ${limit.max} ${action} requests per ${limit.name}`,
                retryAfter: Math.max(1, retryAfterSeconds) // At least 1 second
            };
        }

        return {
            allowed: true,
            remaining: Math.max(0, limit.max - currentCount)
        };

    } catch (error) {
        // On error, log but allow the request (fail open)
        console.error('Rate limiter error:', error);
        return { allowed: true };
    }
}

/**
 * Initialize rate limiting collection with TTL index
 * Should be called during deployment setup
 *
 * @param {MongoClient} client - The MongoDB client
 */
async function initializeRateLimitCollection(client) {
    const db = client.db('orgchart');
    const rateLimits = db.collection('rate_limits');

    // Create TTL index to automatically delete expired entries
    await rateLimits.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
    );

    // Create unique index on id to prevent duplicate documents
    await rateLimits.createIndex(
        { id: 1 },
        { unique: true }
    );

    // Create compound index for efficient queries
    await rateLimits.createIndex(
        { userId: 1, action: 1, windowStart: 1 }
    );

    console.log('Rate limiting collection initialized with TTL index and unique constraints');
}

module.exports = {
    checkRateLimit,
    initializeRateLimitCollection,
    getClientIp,  // NEW: Export for testing
    RATE_LIMITS
};
