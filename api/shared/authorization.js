const { getUserGlobalRole, GLOBAL_ROLES } = require('./globalRoles');

/**
 * Chart-level role definitions
 */
const ROLES = {
    OWNER: 'owner',
    EDITOR: 'editor',
    VIEWER: 'viewer'
};

/**
 * Role hierarchy (higher roles inherit lower role permissions)
 */
const ROLE_HIERARCHY = {
    [ROLES.OWNER]: 3,
    [ROLES.EDITOR]: 2,
    [ROLES.VIEWER]: 1
};

/**
 * Check if a user has access to a chart with a specific minimum role
 *
 * This function implements a priority-based access control system:
 * 1. Chart owner (highest priority)
 * 2. Explicit chart permissions (from chart.permissions array)
 * 3. Global role as fallback (when user NOT in chart permissions)
 * 4. Default authenticated viewer (any authenticated user can view)
 *
 * NOTE: Anonymous access is no longer supported. All users must authenticate.
 * The isPublic field is maintained for backward compatibility but does not grant access.
 *
 * @param {string} chartId - The chart ID
 * @param {string} userId - The user's ID from Azure AD (required, no null)
 * @param {string} requiredRole - The minimum required role (OWNER, EDITOR, or VIEWER)
 * @param {MongoClient} client - The MongoDB client
 * @returns {Promise<object>} { allowed: boolean, userRole?: string, source?: string, reason?: string }
 */
async function canAccessChart(chartId, userId, requiredRole, client) {
    try {
        const db = client.db('orgchart');
        const charts = db.collection('charts');

        // Find the chart
        const chart = await charts.findOne({ id: chartId });

        if (!chart) {
            return {
                allowed: false,
                reason: 'Chart not found'
            };
        }

        // Require authentication - no anonymous access
        if (!userId) {
            return {
                allowed: false,
                reason: 'Authentication required'
            };
        }

        // AUTHENTICATED USERS: Check in priority order

        // 1. Check if user is the owner (highest priority)
        if (chart.ownerId === userId) {
            return {
                allowed: true,
                userRole: ROLES.OWNER,
                source: 'owner'
            };
        }

        // 2. Check if user has explicit chart-level permissions
        const userPermission = chart.permissions?.find(p => p.userId === userId);

        if (userPermission) {
            // Chart permissions override global roles
            const userRoleLevel = ROLE_HIERARCHY[userPermission.role] || 0;
            const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;

            if (userRoleLevel >= requiredRoleLevel) {
                return {
                    allowed: true,
                    userRole: userPermission.role,
                    source: 'chart-permission'
                };
            }

            return {
                allowed: false,
                reason: `Access denied: Requires ${requiredRole} role, but user has ${userPermission.role}`,
                userRole: userPermission.role,
                source: 'chart-permission'
            };
        }

        // 3. Check global role as fallback (when user NOT in chart permissions)
        const globalRole = await getUserGlobalRole(userId, client);

        if (globalRole) {
            // Map global roles to chart-level roles
            // Global admin → chart-level editor (can edit all charts)
            // Global editor → chart-level editor (can edit all charts)
            // Global viewer → chart-level viewer (can view all charts)
            let mappedRole;
            if (globalRole === GLOBAL_ROLES.ADMIN || globalRole === GLOBAL_ROLES.EDITOR) {
                mappedRole = ROLES.EDITOR;
            } else if (globalRole === GLOBAL_ROLES.VIEWER) {
                mappedRole = ROLES.VIEWER;
            }

            if (mappedRole) {
                const globalRoleLevel = ROLE_HIERARCHY[mappedRole] || 0;
                const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;

                if (globalRoleLevel >= requiredRoleLevel) {
                    return {
                        allowed: true,
                        userRole: mappedRole,
                        source: 'global-role'
                    };
                }
            }
        }

        // 4. Default: All authenticated users have viewer access
        // This replaces the previous public chart access model
        if (requiredRole === ROLES.VIEWER) {
            return {
                allowed: true,
                userRole: ROLES.VIEWER,
                source: 'authenticated-user'
            };
        }

        // Non-viewer actions (edit, delete, share) require explicit permissions
        return {
            allowed: false,
            reason: 'Access denied: No permissions for this chart'
        };

    } catch (error) {
        console.error('Authorization check error:', error);
        return {
            allowed: false,
            reason: 'Authorization check failed'
        };
    }
}

/**
 * Check if a user can perform a specific action on a chart
 *
 * @param {string} chartId - The chart ID
 * @param {string} userId - The user's ID from Azure AD
 * @param {string} action - The action to check (e.g., 'read', 'edit', 'delete', 'share')
 * @param {MongoClient} client - The MongoDB client
 * @returns {Promise<object>} { allowed: boolean, reason?: string }
 */
async function canPerformAction(chartId, userId, action, client) {
    const actionRoleMap = {
        'read': ROLES.VIEWER,
        'edit': ROLES.EDITOR,
        'delete': ROLES.OWNER,
        'share': ROLES.OWNER,
        'export': ROLES.VIEWER
    };

    const requiredRole = actionRoleMap[action];

    if (!requiredRole) {
        return {
            allowed: false,
            reason: `Unknown action: ${action}`
        };
    }

    return await canAccessChart(chartId, userId, requiredRole, client);
}

/**
 * Add or update a user's permission for a chart
 *
 * @param {string} chartId - The chart ID
 * @param {string} ownerId - The owner's user ID (for validation)
 * @param {string} targetUserId - The user to grant permissions to
 * @param {string} role - The role to grant (VIEWER or EDITOR)
 * @param {MongoClient} client - The MongoDB client
 * @param {boolean} bypassOwnerCheck - If true, skip ownership verification (for admin approvals)
 * @returns {Promise<object>} { success: boolean, message?: string }
 */
async function shareChart(chartId, ownerId, targetUserId, role, client, bypassOwnerCheck = false) {
    // Validate role
    if (role !== ROLES.VIEWER && role !== ROLES.EDITOR) {
        return {
            success: false,
            message: 'Invalid role. Must be "viewer" or "editor"'
        };
    }

    // Can't share with yourself
    if (ownerId === targetUserId) {
        return {
            success: false,
            message: 'Cannot share chart with yourself'
        };
    }

    const db = client.db('orgchart');
    const charts = db.collection('charts');

    try {
        // Verify chart exists and (optionally) verify ownership
        let chart;
        if (bypassOwnerCheck) {
            // Admin bypass: only check chart exists, not ownership
            chart = await charts.findOne({ id: chartId });
        } else {
            // Normal flow: verify ownership
            chart = await charts.findOne({ id: chartId, ownerId: ownerId });
        }

        if (!chart) {
            return {
                success: false,
                message: bypassOwnerCheck
                    ? 'Chart not found'
                    : 'Chart not found or you do not have permission to share it'
            };
        }

        // Check if permission already exists
        const existingPermission = chart.permissions?.find(p => p.userId === targetUserId);

        if (existingPermission) {
            // Update existing permission
            await charts.updateOne(
                { id: chartId, 'permissions.userId': targetUserId },
                {
                    $set: {
                        'permissions.$.role': role,
                        'permissions.$.updatedAt': new Date()
                    },
                    $currentDate: { lastModified: true }
                }
            );

            return {
                success: true,
                message: `Updated ${targetUserId}'s role to ${role}`
            };
        } else {
            // Add new permission
            await charts.updateOne(
                { id: chartId },
                {
                    $push: {
                        permissions: {
                            userId: targetUserId,
                            role: role,
                            grantedAt: new Date()
                        }
                    },
                    $currentDate: { lastModified: true }
                }
            );

            return {
                success: true,
                message: `Granted ${role} access to ${targetUserId}`
            };
        }

    } catch (error) {
        console.error('Share chart error:', error);
        return {
            success: false,
            message: 'Failed to share chart'
        };
    }
}

/**
 * Remove a user's permission for a chart
 *
 * @param {string} chartId - The chart ID
 * @param {string} ownerId - The owner's user ID (for validation)
 * @param {string} targetUserId - The user to revoke permissions from
 * @param {MongoClient} client - The MongoDB client
 * @returns {Promise<object>} { success: boolean, message?: string }
 */
async function revokeAccess(chartId, ownerId, targetUserId, client) {
    const db = client.db('orgchart');
    const charts = db.collection('charts');

    try {
        // Verify ownership
        const chart = await charts.findOne({ id: chartId, ownerId: ownerId });

        if (!chart) {
            return {
                success: false,
                message: 'Chart not found or you do not have permission to modify it'
            };
        }

        // Remove permission
        const result = await charts.updateOne(
            { id: chartId },
            {
                $pull: {
                    permissions: { userId: targetUserId }
                },
                $currentDate: { lastModified: true }
            }
        );

        if (result.modifiedCount > 0) {
            return {
                success: true,
                message: `Revoked access for ${targetUserId}`
            };
        } else {
            return {
                success: false,
                message: `No permissions found for ${targetUserId}`
            };
        }

    } catch (error) {
        console.error('Revoke access error:', error);
        return {
            success: false,
            message: 'Failed to revoke access'
        };
    }
}

module.exports = {
    ROLES,
    canAccessChart,
    canPerformAction,
    shareChart,
    revokeAccess
};
