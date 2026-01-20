/**
 * Global Role Management Utilities
 *
 * Global roles (viewer, editor, admin) serve as defaults when users are NOT in chart-level permissions.
 * Chart-level permissions always override global roles.
 *
 * Priority order for access:
 * 1. Chart owner - highest priority
 * 2. Explicit chart permissions (from chart.permissions array)
 * 3. Global role - applies only when user not in chart permissions
 * 4. Public chart access - lowest priority
 */

/**
 * Global role definitions
 */
const GLOBAL_ROLES = {
    VIEWER: 'viewer',
    EDITOR: 'editor',
    ADMIN: 'admin'
};

/**
 * Global role hierarchy (higher number = more permissions)
 */
const GLOBAL_ROLE_HIERARCHY = {
    [GLOBAL_ROLES.ADMIN]: 3,
    [GLOBAL_ROLES.EDITOR]: 2,
    [GLOBAL_ROLES.VIEWER]: 1
};

/**
 * Get environment variable admin user IDs
 * Format: ADMIN_USER_IDS='user-id-1,user-id-2,user-id-3'
 *
 * @returns {Array<string>} Array of admin user IDs
 */
function getAdminUserIds() {
    const adminIds = process.env.ADMIN_USER_IDS || '';
    return adminIds.split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);
}

/**
 * Get user's global role (checks env var first, then database)
 *
 * @param {string} userId - User ID from Azure AD
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<string|null>} Global role or null if none assigned
 */
async function getUserGlobalRole(userId, client) {
    if (!userId) {
        return null;
    }

    // 1. Check environment variable for bootstrap admins
    const adminIds = getAdminUserIds();
    if (adminIds.includes(userId)) {
        return GLOBAL_ROLES.ADMIN;
    }

    // 2. Check database for assigned role
    try {
        const db = client.db('orgchart');
        const userRoles = db.collection('user_roles');

        const userRole = await userRoles.findOne({ userId: userId });

        if (userRole && userRole.role) {
            return userRole.role;
        }
    } catch (error) {
        console.error('Error fetching user global role:', error);
        return null;
    }

    // 3. Default: no global role (null)
    return null;
}

/**
 * Check if user has required global role or higher
 *
 * @param {string} userId - User ID
 * @param {string} requiredRole - Minimum required role
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<boolean>} True if user has sufficient global role
 */
async function hasGlobalRole(userId, requiredRole, client) {
    const userRole = await getUserGlobalRole(userId, client);

    if (!userRole) {
        return false;
    }

    const userLevel = GLOBAL_ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = GLOBAL_ROLE_HIERARCHY[requiredRole] || 0;

    return userLevel >= requiredLevel;
}

/**
 * Set user's global role (admin only operation)
 *
 * @param {string} targetUserId - User to grant role to
 * @param {string} role - Role to grant (viewer/editor/admin)
 * @param {string} grantedBy - Admin user ID
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<object>} { success: boolean, message: string }
 */
async function setUserGlobalRole(targetUserId, role, grantedBy, client) {
    // Validate role
    if (!Object.values(GLOBAL_ROLES).includes(role)) {
        return {
            success: false,
            message: `Invalid role. Must be one of: ${Object.values(GLOBAL_ROLES).join(', ')}`
        };
    }

    const db = client.db('orgchart');
    const userRoles = db.collection('user_roles');

    try {
        await userRoles.updateOne(
            { userId: targetUserId },
            {
                $set: {
                    userId: targetUserId,
                    role: role,
                    grantedBy: grantedBy,
                    grantedAt: new Date()
                }
            },
            { upsert: true }
        );

        return {
            success: true,
            message: `User ${targetUserId} granted ${role} role`
        };
    } catch (error) {
        console.error('Error setting global role:', error);
        return {
            success: false,
            message: 'Failed to set user role'
        };
    }
}

/**
 * Remove user's global role
 *
 * @param {string} targetUserId - User to remove role from
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<object>} { success: boolean, message: string }
 */
async function removeUserGlobalRole(targetUserId, client) {
    const db = client.db('orgchart');
    const userRoles = db.collection('user_roles');

    try {
        const result = await userRoles.deleteOne({ userId: targetUserId });

        if (result.deletedCount > 0) {
            return {
                success: true,
                message: `Removed global role from ${targetUserId}`
            };
        }

        return {
            success: false,
            message: `No global role found for ${targetUserId}`
        };
    } catch (error) {
        console.error('Error removing global role:', error);
        return {
            success: false,
            message: 'Failed to remove user role'
        };
    }
}

/**
 * List all users with global roles
 *
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<Array>} Array of user role objects
 */
async function listAllGlobalRoles(client) {
    const db = client.db('orgchart');
    const userRoles = db.collection('user_roles');

    try {
        const roles = await userRoles
            .find({})
            .sort({ grantedAt: -1 })
            .toArray();

        return roles;
    } catch (error) {
        console.error('Error listing global roles:', error);
        throw error;
    }
}

module.exports = {
    GLOBAL_ROLES,
    GLOBAL_ROLE_HIERARCHY,
    getUserGlobalRole,
    hasGlobalRole,
    setUserGlobalRole,
    removeUserGlobalRole,
    listAllGlobalRoles,
    getAdminUserIds
};
