/**
 * Authentication and authorization utilities
 *
 * SECURITY MODEL:
 * ===============
 * This application uses Azure Static Web Apps (SWA) with integrated Azure Functions.
 *
 * 1. Function-Level Protection:
 *    - All functions have authLevel: "function" in function.json
 *    - Direct calls require a function key (?code=xxx)
 *    - Azure SWA automatically provides the function key when proxying requests
 *    - This prevents direct function access from untrusted sources
 *
 * 2. User Authentication (via SWA EasyAuth):
 *    - SWA handles user authentication at the platform level
 *    - Authenticated requests include these headers:
 *      * x-ms-client-principal: Base64-encoded JSON with user claims
 *      * x-ms-client-principal-id: User's unique ID
 *      * x-ms-client-principal-name: User's email/name
 *    - These headers are trusted because:
 *      a) Direct function access is blocked (requires function key)
 *      b) Only SWA can call the functions (has the key)
 *      c) SWA validates the user before adding these headers
 *
 * 3. Defense in Depth:
 *    - Even if someone obtains a function key, they still can't impersonate users
 *      without also compromising the SWA authentication layer
 *    - Application-level authorization (ROLES) provides additional protection
 *    - Rate limiting prevents abuse
 *
 * DEPLOYMENT REQUIREMENTS:
 * ========================
 * - Functions MUST be deployed as part of Azure Static Web Apps (not standalone)
 * - Function keys MUST be kept secret (managed by Azure, not in code)
 * - SWA authentication MUST be enabled and configured
 * - ALLOW_ANONYMOUS should ONLY be true for local development
 */

/**
 * Helper functions to read environment variables dynamically
 * This allows tests to override environment variables
 */
function getAllowAnonymous() {
    return process.env.ALLOW_ANONYMOUS === 'true';
}

function getWebsiteInstanceId() {
    return process.env.WEBSITE_INSTANCE_ID;
}

/**
 * Parse and validate the x-ms-client-principal header
 * This header is base64-encoded JSON containing user claims
 *
 * @param {string} principalHeader - The x-ms-client-principal header value
 * @returns {object|null} Parsed principal or null if invalid
 */
function parseClientPrincipal(principalHeader) {
    if (!principalHeader) {
        return null;
    }

    try {
        const buffer = Buffer.from(principalHeader, 'base64');
        const principal = JSON.parse(buffer.toString('utf-8'));

        // Validate required fields
        if (!principal.userId || !principal.userRoles || !Array.isArray(principal.userRoles)) {
            return null;
        }

        return {
            userId: principal.userId,
            userDetails: principal.userDetails,
            identityProvider: principal.identityProvider,
            userRoles: principal.userRoles,
            claims: principal.claims || []
        };
    } catch (error) {
        return null;
    }
}

/**
 * Extract and validate authenticated user from request headers
 *
 * @param {object} req - Azure Function request object
 * @returns {object} { authenticated: boolean, user?: object, error?: string }
 */
function authenticateRequest(req) {
    const ALLOW_ANONYMOUS = getAllowAnonymous();
    const WEBSITE_INSTANCE_ID = getWebsiteInstanceId();

    // Check if anonymous access is explicitly allowed (local dev only)
    if (ALLOW_ANONYMOUS) {
        // Return mock user for local development
        return {
            authenticated: true,
            user: {
                userId: 'dev-user-001',
                userEmail: 'developer@local.dev',
                isLocalDev: true
            },
            isLocalDev: true
        };
    }

    // Try to parse the x-ms-client-principal header (most secure)
    // This works both in Azure (with WEBSITE_INSTANCE_ID) and local SWA CLI (without it)
    const principalHeader = req.headers['x-ms-client-principal'];
    const principal = parseClientPrincipal(principalHeader);

    if (principal) {
        // Valid principal found - works in both Azure and local SWA CLI
        const isLocalSwa = !WEBSITE_INSTANCE_ID;
        return {
            authenticated: true,
            user: {
                userId: principal.userId,
                userEmail: principal.userDetails,
                identityProvider: principal.identityProvider,
                roles: principal.userRoles,
                isLocalDev: isLocalSwa
            },
            isLocalDev: isLocalSwa
        };
    }

    // Fallback: Check individual headers (less secure, but SWA provides these)
    // These should only be trusted when the request comes through SWA routing
    const userId = req.headers['x-ms-client-principal-id'];
    const userEmail = req.headers['x-ms-client-principal-name'];

    if (userId) {
        // We have a user ID - trust it if we're in Azure OR local SWA CLI
        const isLocalSwa = !WEBSITE_INSTANCE_ID;
        return {
            authenticated: true,
            user: {
                userId: userId,
                userEmail: userEmail || 'unknown',
                isLocalDev: isLocalSwa
            },
            isLocalDev: isLocalSwa
        };
    }

    // No valid authentication headers found
    // Only now check if we're in an invalid configuration state
    if (!WEBSITE_INSTANCE_ID && !ALLOW_ANONYMOUS) {
        // Missing both Azure environment and anonymous flag - likely misconfigured
        return {
            authenticated: false,
            error: 'Server configuration error: Authentication not properly configured. Set ALLOW_ANONYMOUS=true for local dev or use SWA CLI for local auth testing.'
        };
    }

    // No valid authentication found
    return {
        authenticated: false,
        error: 'Authentication required'
    };
}

/**
 * Middleware function to authenticate requests
 * Returns early with 401 if authentication fails
 *
 * @param {object} context - Azure Function context
 * @param {object} req - Azure Function request
 * @returns {object|null} User object if authenticated, null if rejected (context.res is set)
 */
function requireAuth(context, req) {
    const authResult = authenticateRequest(req);

    if (!authResult.authenticated) {
        const ALLOW_ANONYMOUS = getAllowAnonymous();
        const WEBSITE_INSTANCE_ID = getWebsiteInstanceId();

        context.res = {
            status: 401,
            body: {
                error: authResult.error || 'Authentication required',
                hint: ALLOW_ANONYMOUS === false && !WEBSITE_INSTANCE_ID
                    ? 'Set ALLOW_ANONYMOUS=true for local development'
                    : 'Please sign in to access this resource'
            }
        };
        return null;
    }

    return authResult.user;
}

/**
 * Optional authentication middleware
 * Returns user object if authenticated, or null if anonymous (without setting error response)
 * Use this for endpoints that support both authenticated and anonymous access
 *
 * @param {object} context - Azure Function context
 * @param {object} req - Azure Function request
 * @returns {object|null} User object if authenticated, null if anonymous
 */
function requireOptionalAuth(context, req) {
    const authResult = authenticateRequest(req);

    if (authResult.authenticated) {
        return authResult.user;
    }

    // For anonymous users, return null WITHOUT setting error response
    // This allows the handler to proceed with anonymous/public access
    return null;
}

module.exports = {
    authenticateRequest,
    requireAuth,
    requireOptionalAuth,  // NEW
    parseClientPrincipal
};
