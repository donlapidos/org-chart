/**
 * Validation rules for chart payloads
 */
const VALIDATION_RULES = {
    MAX_CHART_SIZE_BYTES: 5 * 1024 * 1024,  // 5MB
    MAX_CHART_NAME_LENGTH: 100,
    MAX_NODES: 1000,
    MAX_NODE_NAME_LENGTH: 200,
    MIN_CHART_NAME_LENGTH: 1
};

/**
 * Validate chart payload structure and size
 *
 * @param {object} payload - The chart data to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateChartPayload(payload) {
    const errors = [];

    // Check payload exists
    if (!payload) {
        return { valid: false, errors: ['Payload is required'] };
    }

    // Check payload size (approximate)
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > VALIDATION_RULES.MAX_CHART_SIZE_BYTES) {
        errors.push(`Chart exceeds maximum size of ${VALIDATION_RULES.MAX_CHART_SIZE_BYTES / 1024 / 1024}MB`);
    }

    // Validate chart name
    if (!payload.name || typeof payload.name !== 'string') {
        errors.push('Chart name is required and must be a string');
    } else {
        const trimmedName = payload.name.trim();
        if (trimmedName.length < VALIDATION_RULES.MIN_CHART_NAME_LENGTH) {
            errors.push('Chart name cannot be empty');
        }
        if (trimmedName.length > VALIDATION_RULES.MAX_CHART_NAME_LENGTH) {
            errors.push(`Chart name exceeds maximum length of ${VALIDATION_RULES.MAX_CHART_NAME_LENGTH} characters`);
        }
    }

    // Validate chart data structure
    if (!payload.data || typeof payload.data !== 'object') {
        errors.push('Chart data is required and must be an object');
    } else {
        // Validate nodes if present
        if (payload.data.nodes) {
            if (!Array.isArray(payload.data.nodes)) {
                errors.push('Chart nodes must be an array');
            } else if (payload.data.nodes.length > VALIDATION_RULES.MAX_NODES) {
                errors.push(`Chart exceeds maximum of ${VALIDATION_RULES.MAX_NODES} nodes`);
            } else {
                // Validate individual nodes
                payload.data.nodes.forEach((node, index) => {
                    if (!node.id) {
                        errors.push(`Node at index ${index} is missing required 'id' field`);
                    }
                    if (node.name && typeof node.name === 'string' && node.name.length > VALIDATION_RULES.MAX_NODE_NAME_LENGTH) {
                        errors.push(`Node at index ${index} has name exceeding ${VALIDATION_RULES.MAX_NODE_NAME_LENGTH} characters`);
                    }
                });
            }
        }
    }

    // Validate isPublic field (optional, kept for backward compatibility)
    // NOTE: isPublic no longer controls access - all charts require authentication
    if (payload.hasOwnProperty('isPublic')) {
        if (typeof payload.isPublic !== 'boolean') {
            errors.push('isPublic must be a boolean value (true or false)');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize chart name by trimming and removing dangerous characters
 *
 * @param {string} name - The chart name to sanitize
 * @returns {string} Sanitized chart name
 */
function sanitizeChartName(name) {
    if (typeof name !== 'string') {
        return '';
    }

    return name
        .trim()
        .replace(/[<>]/g, '')  // Remove potential HTML tags
        .substring(0, VALIDATION_RULES.MAX_CHART_NAME_LENGTH);
}

/**
 * Validate chart ID format (UUID v4)
 *
 * @param {string} chartId - The chart ID to validate
 * @returns {boolean} True if valid UUID v4
 */
function isValidChartId(chartId) {
    if (!chartId || typeof chartId !== 'string') {
        return false;
    }

    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(chartId);
}

/**
 * Validate share link token format (UUID v4)
 *
 * @param {string} token - The share link token to validate
 * @returns {boolean} True if valid UUID v4
 */
function isValidToken(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }

    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(token);
}

/**
 * Validate permissions array structure
 *
 * @param {Array} permissions - The permissions array to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validatePermissions(permissions) {
    const errors = [];

    // Permissions are optional
    if (!permissions) {
        return { valid: true, errors: [] };
    }

    // Must be an array if provided
    if (!Array.isArray(permissions)) {
        return { valid: false, errors: ['Permissions must be an array'] };
    }

    // Maximum 100 permissions per chart (prevent abuse)
    if (permissions.length > 100) {
        errors.push('Chart cannot have more than 100 permission entries');
    }

    // Validate each permission entry
    permissions.forEach((permission, index) => {
        // Must be an object
        if (!permission || typeof permission !== 'object') {
            errors.push(`Permission at index ${index} must be an object`);
            return;
        }

        // Must have userId
        if (!permission.userId || typeof permission.userId !== 'string') {
            errors.push(`Permission at index ${index} is missing required 'userId' field`);
        }

        // Must have role
        if (!permission.role || typeof permission.role !== 'string') {
            errors.push(`Permission at index ${index} is missing required 'role' field`);
        } else {
            // Role must be 'viewer' or 'editor'
            const validRoles = ['viewer', 'editor'];
            if (!validRoles.includes(permission.role.toLowerCase())) {
                errors.push(`Permission at index ${index} has invalid role '${permission.role}'. Must be 'viewer' or 'editor'`);
            }
        }

        // Validate grantedAt if present
        if (permission.grantedAt) {
            const grantedAtDate = new Date(permission.grantedAt);
            if (isNaN(grantedAtDate.getTime())) {
                errors.push(`Permission at index ${index} has invalid 'grantedAt' date`);
            }
        }

        // Validate grantedBy if present
        if (permission.grantedBy && typeof permission.grantedBy !== 'string') {
            errors.push(`Permission at index ${index} has invalid 'grantedBy' field (must be string)`);
        }
    });

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize permissions array by normalizing roles and adding metadata
 *
 * @param {Array} permissions - The permissions array to sanitize
 * @param {string} grantedBy - User ID who granted the permissions
 * @returns {Array} Sanitized permissions array
 */
function sanitizePermissions(permissions, grantedBy) {
    if (!Array.isArray(permissions)) {
        return [];
    }

    return permissions.map(permission => ({
        userId: permission.userId.trim(),
        role: permission.role.toLowerCase(),
        grantedAt: permission.grantedAt || new Date().toISOString(),
        grantedBy: permission.grantedBy || grantedBy
    }));
}

/**
 * Validate isPublic field
 * NOTE: Kept for backward compatibility. isPublic no longer controls access.
 *
 * @param {any} isPublic - The isPublic value to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateIsPublic(isPublic) {
    const errors = [];

    // isPublic is optional - if not provided, defaults to false
    if (isPublic !== undefined && isPublic !== null) {
        if (typeof isPublic !== 'boolean') {
            errors.push('isPublic must be a boolean value (true or false)');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Normalize isPublic value (always returns false)
 * NOTE: Anonymous access is no longer supported. This function always returns false
 * regardless of input to prevent public/anonymous chart access.
 *
 * @param {any} isPublic - The isPublic value to normalize (ignored)
 * @returns {boolean} Always false
 */
function normalizeIsPublic(isPublic) {
    // Always return false - no public/anonymous access allowed
    return false;
}

module.exports = {
    validateChartPayload,
    sanitizeChartName,
    isValidChartId,
    isValidToken,
    validatePermissions,
    sanitizePermissions,
    validateIsPublic,
    normalizeIsPublic,
    VALIDATION_RULES
};
