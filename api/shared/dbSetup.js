/**
 * Database Setup and Initialization
 *
 * Sets up MongoDB collections with proper indexes, partition keys, and TTL settings
 * This should be run once during deployment or on first function execution
 */

const { logInfo, logError } = require('./logger');

let isInitialized = false;

/**
 * Initialize all database collections with proper indexes and configuration
 */
async function initializeDatabase(client) {
    // Only run once per function app instance
    if (isInitialized) {
        return { success: true, message: 'Database already initialized' };
    }

    try {
        const db = client.db('orgchart');

        // 1. Setup charts collection
        await setupChartsCollection(db);

        // 2. Setup deleted_charts collection with TTL
        await setupDeletedChartsCollection(db);

        // 3. Setup rate_limits collection with TTL
        await setupRateLimitsCollection(db);

        // 4. Setup user_roles collection
        await setupUserRolesCollection(db);

        // 5. Setup access_requests collection
        await setupAccessRequestsCollection(db);

        // 6. Setup chart_share_links collection
        await setupShareLinksCollection(db);

        isInitialized = true;

        logInfo('Database initialization completed successfully', {
            collections: ['charts', 'deleted_charts', 'rate_limits', 'user_roles', 'access_requests', 'chart_share_links']
        });

        return {
            success: true,
            message: 'Database initialized successfully',
            collections: ['charts', 'deleted_charts', 'rate_limits', 'user_roles', 'access_requests', 'chart_share_links']
        };

    } catch (error) {
        logError('Database initialization failed', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Setup charts collection with indexes
 *
 * Partition Strategy: Using ownerId as the partition key for optimal query performance
 * All queries filter by ownerId or include it in $or clauses
 */
async function setupChartsCollection(db) {
    const charts = db.collection('charts');

    // Create indexes for optimal query performance
    const indexes = [
        // Primary index on id (unique)
        { key: { id: 1 }, name: 'idx_id', unique: true },

        // Index on ownerId for fast owner queries
        { key: { ownerId: 1 }, name: 'idx_ownerId' },

        // Index on permissions.userId for fast shared chart queries
        { key: { 'permissions.userId': 1 }, name: 'idx_permissions_userId' },

        // Compound index for GetCharts query optimization
        { key: { ownerId: 1, lastModified: -1 }, name: 'idx_owner_modified' },

        // Index on lastModified for sorting
        { key: { lastModified: -1 }, name: 'idx_lastModified' }
    ];

    for (const index of indexes) {
        try {
            await charts.createIndex(index.key, {
                name: index.name,
                unique: index.unique || false,
                background: true // Create in background to avoid blocking
            });
            logInfo(`Created index: ${index.name} on charts collection`);
        } catch (error) {
            // Index might already exist, log but continue
            if (error.code !== 85) { // 85 = IndexOptionsConflict
                logError(`Failed to create index ${index.name}`, { error: error.message });
            }
        }
    }

    logInfo('Charts collection setup completed', {
        indexes: indexes.map(i => i.name)
    });
}

/**
 * Setup deleted_charts collection with TTL index
 *
 * Soft-deleted charts are kept for 90 days, then automatically removed
 */
async function setupDeletedChartsCollection(db) {
    const deletedCharts = db.collection('deleted_charts');

    // Create TTL index to auto-delete after 90 days
    try {
        await deletedCharts.createIndex(
            { expiresAt: 1 },
            {
                name: 'idx_ttl_expiresAt',
                expireAfterSeconds: 0, // Expire when expiresAt time is reached
                background: true
            }
        );
        logInfo('Created TTL index on deleted_charts.expiresAt');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create TTL index on deleted_charts', { error: error.message });
        }
    }

    // Create index on deletedBy for query optimization
    try {
        await deletedCharts.createIndex(
            { deletedBy: 1 },
            { name: 'idx_deletedBy', background: true }
        );
        logInfo('Created index on deleted_charts.deletedBy');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create deletedBy index', { error: error.message });
        }
    }

    logInfo('Deleted charts collection setup completed');
}

/**
 * Setup rate_limits collection with TTL index
 *
 * Rate limit entries expire after their window duration
 */
async function setupRateLimitsCollection(db) {
    const rateLimits = db.collection('rate_limits');

    // Create TTL index to auto-expire old rate limit entries
    try {
        await rateLimits.createIndex(
            { expiresAt: 1 },
            {
                name: 'idx_ttl_expiresAt',
                expireAfterSeconds: 0,
                background: true
            }
        );
        logInfo('Created TTL index on rate_limits.expiresAt');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create TTL index on rate_limits', { error: error.message });
        }
    }

    // Create compound index on userId + action for rate limit lookups
    try {
        await rateLimits.createIndex(
            { userId: 1, action: 1 },
            { name: 'idx_userId_action', background: true }
        );
        logInfo('Created compound index on rate_limits (userId, action)');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create userId_action index', { error: error.message });
        }
    }

    logInfo('Rate limits collection setup completed');
}

/**
 * Setup user_roles collection with indexes
 *
 * Stores global application-level roles (viewer, editor, admin)
 */
async function setupUserRolesCollection(db) {
    const userRoles = db.collection('user_roles');

    // Create unique index on userId
    try {
        await userRoles.createIndex(
            { userId: 1 },
            {
                name: 'idx_userId',
                unique: true,
                background: true
            }
        );
        logInfo('Created unique index on user_roles.userId');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create userId index on user_roles', { error: error.message });
        }
    }

    // Create index on role for querying users by role
    try {
        await userRoles.createIndex(
            { role: 1 },
            { name: 'idx_role', background: true }
        );
        logInfo('Created index on user_roles.role');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create role index', { error: error.message });
        }
    }

    // Create index on grantedAt for audit queries
    try {
        await userRoles.createIndex(
            { grantedAt: -1 },
            { name: 'idx_grantedAt', background: true }
        );
        logInfo('Created index on user_roles.grantedAt');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create grantedAt index', { error: error.message });
        }
    }

    logInfo('User roles collection setup completed');
}

/**
 * Setup access_requests collection with indexes
 *
 * Stores user requests for chart-level permissions
 */
async function setupAccessRequestsCollection(db) {
    const accessRequests = db.collection('access_requests');

    // Create unique index on id
    try {
        await accessRequests.createIndex(
            { id: 1 },
            {
                name: 'idx_id',
                unique: true,
                background: true
            }
        );
        logInfo('Created unique index on access_requests.id');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create id index on access_requests', { error: error.message });
        }
    }

    // Create compound index on chartId + requesterId for duplicate prevention
    try {
        await accessRequests.createIndex(
            { chartId: 1, requesterId: 1, status: 1 },
            {
                name: 'idx_chart_requester_status',
                background: true
            }
        );
        logInfo('Created compound index on access_requests (chartId, requesterId, status)');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create compound index on access_requests', { error: error.message });
        }
    }

    // Create index on chartId for owner queries
    try {
        await accessRequests.createIndex(
            { chartId: 1, status: 1 },
            { name: 'idx_chartId_status', background: true }
        );
        logInfo('Created index on access_requests (chartId, status)');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create chartId_status index', { error: error.message });
        }
    }

    // Create index on requesterId for user's own requests
    try {
        await accessRequests.createIndex(
            { requesterId: 1, requestedAt: -1 },
            { name: 'idx_requesterId_requestedAt', background: true }
        );
        logInfo('Created index on access_requests (requesterId, requestedAt)');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create requesterId_requestedAt index', { error: error.message });
        }
    }

    // Create index on status + requestedAt for admin queries
    try {
        await accessRequests.createIndex(
            { status: 1, requestedAt: -1 },
            { name: 'idx_status_requestedAt', background: true }
        );
        logInfo('Created index on access_requests (status, requestedAt)');
    } catch (error) {
        if (error.code !== 85) {
            logError('Failed to create status_requestedAt index', { error: error.message });
        }
    }

    logInfo('Access requests collection setup completed');
}

/**
 * Setup chart_share_links collection with indexes
 *
 * Stores shareable public links for charts (revocable, view-only)
 */
async function setupShareLinksCollection(db) {
    const shareLinks = db.collection('chart_share_links');

    const indexes = [
        // Primary index on id (unique)
        { key: { id: 1 }, name: 'idx_id', unique: true },

        // CRITICAL: Unique index on token for fast anonymous lookups
        { key: { token: 1 }, name: 'idx_token', unique: true },

        // Index on chartId + revokedAt for finding active links
        { key: { chartId: 1, revokedAt: 1 }, name: 'idx_chartId_revoked' },

        // Compound index for active link queries (not revoked, not expired)
        { key: { chartId: 1, revokedAt: 1, expiresAt: 1 }, name: 'idx_active_links' },

        // TTL index for auto-deletion of expired links
        { key: { expiresAt: 1 }, name: 'idx_ttl_expiresAt', expireAfterSeconds: 0 },

        // Index on createdBy for user's created links
        { key: { createdBy: 1, createdAt: -1 }, name: 'idx_createdBy' }
    ];

    for (const index of indexes) {
        try {
            await shareLinks.createIndex(index.key, {
                name: index.name,
                unique: index.unique || false,
                expireAfterSeconds: index.expireAfterSeconds,
                background: true
            });
            logInfo(`Created index: ${index.name} on chart_share_links collection`);
        } catch (error) {
            if (error.code !== 85) {
                logError(`Failed to create index ${index.name} on chart_share_links`, { error: error.message });
            }
        }
    }

    logInfo('Chart share links collection setup completed', {
        indexes: indexes.map(i => i.name)
    });
}

/**
 * Check if database is initialized
 */
function isDatabaseInitialized() {
    return isInitialized;
}

/**
 * Force re-initialization (useful for testing or migrations)
 */
function resetInitializationFlag() {
    isInitialized = false;
}

module.exports = {
    initializeDatabase,
    isDatabaseInitialized,
    resetInitializationFlag,
    setupChartsCollection,
    setupDeletedChartsCollection,
    setupRateLimitsCollection,
    setupUserRolesCollection,
    setupAccessRequestsCollection,
    setupShareLinksCollection
};
