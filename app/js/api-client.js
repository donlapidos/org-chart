/**
 * API Client for Org Chart Backend
 *
 * Handles all communication with Azure Functions backend
 * Automatically includes authentication headers from SWA
 */

const API_BASE_URL = '/api/v1';

class APIClient {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
    }

    /**
     * Check if user is authenticated and get user info
     * @returns {Promise<object|null>} User info or null if not authenticated
     */
    async checkAuth() {
        try {
            const response = await fetch('/.auth/me');
            const payload = await response.json();

            if (payload.clientPrincipal) {
                this.currentUser = {
                    userId: payload.clientPrincipal.userId,
                    userDetails: payload.clientPrincipal.userDetails,
                    identityProvider: payload.clientPrincipal.identityProvider,
                    userRoles: payload.clientPrincipal.userRoles
                };
                this.isAuthenticated = true;
                return this.currentUser;
            }

            this.isAuthenticated = false;
            return null;
        } catch (error) {
            console.error('Auth check failed:', error);
            this.isAuthenticated = false;
            return null;
        }
    }

    /**
     * Redirect to login page
     * @param {string} redirectPath - Path to redirect to after login (default: current page)
     */
    login(redirectPath = null) {
        // Use current path if not specified
        const redirect = redirectPath || window.location.pathname + window.location.search;

        // Use replace() instead of href to prevent login page from appearing in history
        // This way, clicking back won't return to the raw Azure login URL
        window.location.replace(`/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(redirect)}`);
    }

    /**
     * Redirect to logout page
     */
    logout() {
        window.location.href = '/.auth/logout';
    }

    /**
     * Make API request (supports both authenticated and anonymous)
     * @private
     */
    async _request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;

        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            credentials: 'same-origin' // Include cookies for SWA auth
        };

        const finalOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, finalOptions);

            // Handle 401 Unauthorized
            if (response.status === 401) {
                console.warn('Unauthorized - redirecting to login');
                // Redirect back to current page after login for all methods
                const currentPath = window.location.pathname + window.location.search;
                this.login(currentPath);
                throw new Error('Unauthorized');
            }

            // Handle 429 Rate Limit
            if (response.status === 429) {
                const data = await response.json();
                const retryAfter = data.retryAfter || 60;
                throw new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
            }

            // Parse response
            const contentType = response.headers.get('content-type');
            let data;

            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            if (!response.ok) {
                throw new Error(data.error || data.message || `HTTP ${response.status}`);
            }

            return data;

        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    }

    // ============================================
    // Chart Operations
    // ============================================

    /**
     * Get all charts accessible to the user
     * @param {Object} params - Query parameters (limit, offset, sortBy, sortOrder, includeData)
     * @returns {Promise<Object>} Response with charts array and pagination info
     */
    async getCharts(params = {}) {
        // Build query string from params (limit, offset, sortBy, sortOrder)
        const queryParams = new URLSearchParams();
        if (params.limit) queryParams.set('limit', params.limit);
        if (params.offset !== undefined) queryParams.set('offset', params.offset);
        if (params.sortBy) queryParams.set('sortBy', params.sortBy);
        if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
        if (params.includeData !== undefined) queryParams.set('includeData', params.includeData ? 'true' : 'false');

        const queryString = queryParams.toString();
        const url = queryString ? `/charts?${queryString}` : '/charts';

        const response = await this._request(url, {
            method: 'GET'
        });

        // Return full response with pagination info
        return response;
    }

    /**
     * Get a specific chart by ID
     * @param {string} chartId - The chart ID
     * @returns {Promise<object>} Full response with chart, isReadOnly, userRole, etc.
     */
    async getChart(chartId) {
        return await this._request(`/charts/${chartId}`, {
            method: 'GET'
        });
    }

    /**
     * Create a new chart
     * @param {string} name - Chart name
     * @param {object} data - Chart data (nodes, connections, etc.)
     * @returns {Promise<object>} Created chart info
     */
    async createChart(name, data) {
        return await this._request('/charts', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                data: data
            })
        });
    }

    /**
     * Update an existing chart
     * @param {string} chartId - The chart ID
     * @param {string} name - Chart name
     * @param {object} data - Chart data
     * @returns {Promise<object>} Update result
     */
    async updateChart(chartId, name, data) {
        return await this._request(`/charts/${chartId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: name,
                data: data
            })
        });
    }

    /**
     * Delete a chart (soft delete with 90-day recovery)
     * @param {string} chartId - The chart ID
     * @returns {Promise<object>} Delete result
     */
    async deleteChart(chartId) {
        return await this._request(`/charts/${chartId}`, {
            method: 'DELETE'
        });
    }

    /**
     * Share a chart with another user
     * @param {string} chartId - The chart ID
     * @param {string} targetUserId - User ID to share with
     * @param {string} role - Role to grant ('viewer' or 'editor')
     * @returns {Promise<object>} Share result
     */
    async shareChart(chartId, targetUserId, role) {
        return await this._request(`/charts/${chartId}/share`, {
            method: 'POST',
            body: JSON.stringify({
                targetUserId: targetUserId,
                role: role
            })
        });
    }

    /**
     * Revoke access to a chart
     * @param {string} chartId - The chart ID
     * @param {string} targetUserId - User ID to revoke access from
     * @returns {Promise<object>} Revoke result
     */
    async revokeAccess(chartId, targetUserId) {
        return await this._request(`/charts/${chartId}/share`, {
            method: 'DELETE',
            body: JSON.stringify({
                targetUserId: targetUserId
            })
        });
    }

    /**
     * Get existing shareable link for a chart (no creation side effects)
     * @param {string} chartId - The chart ID
     * @returns {Promise<object>} Share link info (token, url, createdAt, etc.) or throws 404
     */
    async getShareLink(chartId) {
        return await this._request(`/charts/${chartId}/share-link`, {
            method: 'GET'
        });
    }

    /**
     * Create or get shareable link for a chart
     * @param {string} chartId - The chart ID
     * @param {boolean} regenerate - Force regenerate new token
     * @returns {Promise<object>} Share link info (token, url, createdAt, etc.)
     */
    async createShareLink(chartId, regenerate = false) {
        const queryParam = regenerate ? '?regenerate=true' : '';
        return await this._request(`/charts/${chartId}/share-link${queryParam}`, {
            method: 'POST'
        });
    }

    /**
     * Revoke shareable link for a chart
     * @param {string} chartId - The chart ID
     * @returns {Promise<object>} Revoke result
     */
    async revokeShareLink(chartId) {
        return await this._request(`/charts/${chartId}/share-link`, {
            method: 'DELETE'
        });
    }

    /**
     * Get chart data via shareable link (anonymous access)
     * @param {string} token - The share link token
     * @returns {Promise<object>} Chart data
     */
    async getSharedChart(token) {
        const url = `/api/v1/shared/${token}`;  // Full path (not using API_BASE_URL prefix)

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Don't redirect to login on 401 (anonymous access)
        if (response.status === 404 || response.status === 403) {
            const data = await response.json();
            throw new Error(data.error || 'Unable to access this chart');
        }

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Request access to a chart
     * @param {string} chartId - The chart ID
     * @param {string} requestedRole - Role to request ('viewer' or 'editor')
     * @param {string} reason - Optional reason for requesting access
     * @returns {Promise<object>} Request result
     */
    async requestAccess(chartId, requestedRole, reason = '') {
        const payload = { requestedRole: requestedRole };

        // Only include reason if provided
        if (reason) {
            payload.reason = reason;
        }

        return await this._request(`/charts/${chartId}/access-requests`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    /**
     * Get access requests (for chart owners and admins)
     * @param {string} status - Optional status filter ('pending', 'approved', 'denied')
     * @returns {Promise<object>} Access requests
     */
    async getAccessRequests(status = null) {
        const queryParams = status ? `?status=${status}` : '';
        return await this._request(`/access-requests${queryParams}`, {
            method: 'GET'
        });
    }

    /**
     * Review an access request (approve or deny)
     * @param {string} requestId - The request ID
     * @param {string} action - 'approve' or 'deny'
     * @param {string} notes - Optional review notes
     * @param {string} grantedRole - Optional role to grant (viewer/editor) - defaults to requested role
     * @returns {Promise<object>} Review result
     */
    async reviewAccessRequest(requestId, action, notes = '', grantedRole = null) {
        const payload = { action: action };

        // Only include notes if provided
        if (notes) {
            payload.notes = notes;
        }

        // Only include grantedRole if provided (for approvals)
        if (grantedRole) {
            payload.grantedRole = grantedRole;
        }

        return await this._request(`/access-requests/${requestId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    // ============================================
    // Helper Methods
    // ============================================

    /**
     * Get current user info
     * @returns {object|null} Current user or null if not authenticated
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Check if user is authenticated
     * @returns {boolean} True if user is authenticated
     */
    isUserAuthenticated() {
        return this.isAuthenticated;
    }

    /**
     * Format error message for display
     * @param {Error} error - The error object
     * @returns {string} Formatted error message
     */
    formatError(error) {
        if (error.message) {
            return error.message;
        }
        return 'An unexpected error occurred. Please try again.';
    }

    /**
     * Show toast notification (requires toast.js)
     * @param {string} message - Message to display
     * @param {string} type - Type of toast ('success', 'error', 'info')
     */
    showToast(message, type = 'info') {
        if (window.toast && window.toast[type]) {
            window.toast[type](message);
        } else {
            // Fallback to console if toast not available
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Create global instance
window.apiClient = new APIClient();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIClient;
}
