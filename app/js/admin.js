/**
 * Admin Panel Application
 * Manages global roles and access requests
 */

class AdminApp {
    constructor() {
        this.globalRolesCache = []; // Cache for filtering
        this.init();
    }

    async init() {
        // Check if user is authenticated and has admin access
        const user = await window.apiClient.checkAuth();

        if (!user) {
            window.location.href = '/.auth/login/aad?post_login_redirect_uri=/admin.html';
            return;
        }

        // Load data
        await this.loadGlobalRoles();
        await this.loadAccessRequests();

        // Wire up search input
        const searchInput = document.getElementById('globalRolesSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterGlobalRoles(e.target.value);
            });
        }
    }

    /**
     * Load users with global roles
     */
    async loadGlobalRoles() {
        const tbody = document.getElementById('globalRolesTableBody');

        try {
            const response = await window.apiClient._request('/admin/users', {
                method: 'GET'
            });

            const users = response.users || [];

            // Cache the full list for filtering
            this.globalRolesCache = users;

            // Render the full list initially
            this.renderGlobalRoles(users);

        } catch (error) {
            console.error('Failed to load global roles:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: #dc3545;">
                        Failed to load global roles: ${this.escapeHtml(error.message)}
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Render global roles table
     */
    renderGlobalRoles(users) {
        const tbody = document.getElementById('globalRolesTableBody');

        if (users.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: #888;">
                        No global roles assigned yet.<br>
                        Use the form above to grant roles.
                    </td>
                </tr>
            `;
            return;
        }

        const html = users.map(user => this.renderUserRole(user)).join('');
        tbody.innerHTML = html;
    }

    /**
     * Filter global roles by search query
     */
    filterGlobalRoles(query) {
        const searchResultsCount = document.getElementById('searchResultsCount');
        const trimmedQuery = query.trim().toLowerCase();

        // If query is empty, show all users
        if (!trimmedQuery) {
            this.renderGlobalRoles(this.globalRolesCache);
            searchResultsCount.style.display = 'none';
            return;
        }

        // Filter users by userId or role (case-insensitive)
        const filteredUsers = this.globalRolesCache.filter(user => {
            const userId = (user.userId || '').toLowerCase();
            const role = (user.role || '').toLowerCase();

            return userId.includes(trimmedQuery) || role.includes(trimmedQuery);
        });

        // Update results count
        if (filteredUsers.length === 0) {
            searchResultsCount.textContent = `No results found for "${query}"`;
            searchResultsCount.style.display = 'block';
        } else if (filteredUsers.length === this.globalRolesCache.length) {
            searchResultsCount.style.display = 'none';
        } else {
            searchResultsCount.textContent = `Showing ${filteredUsers.length} of ${this.globalRolesCache.length} users`;
            searchResultsCount.style.display = 'block';
        }

        // Render filtered results
        if (filteredUsers.length === 0) {
            const tbody = document.getElementById('globalRolesTableBody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: #888;">
                        No users match your search.<br>
                        Try a different search term.
                    </td>
                </tr>
            `;
        } else {
            this.renderGlobalRoles(filteredUsers);
        }
    }

    /**
     * Render a single user role row
     */
    renderUserRole(user) {
        const roleColors = {
            'admin': 'var(--pill-admin)',
            'editor': 'var(--pill-editor)',
            'viewer': 'var(--pill-viewer)'
        };

        const roleColor = roleColors[user.role] || '#6b7280';
        const grantedDate = new Date(user.grantedAt).toLocaleDateString();
        const selectId = `role-select-${this.escapeHtml(user.userId)}`;

        return `
            <tr>
                <td>${this.escapeHtml(user.userId)}</td>
                <td>
                    <span class="role-badge ${user.role}" style="background: ${roleColor};">
                        ${user.role}
                    </span>
                </td>
                <td>${grantedDate}</td>
                <td>
                    <div class="role-update-inline">
                        <select id="${selectId}" class="form-control compact-select">
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
                            <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                            <option value="none">Remove role</option>
                        </select>
                        <button
                            class="btn btn-sm btn-outline-secondary"
                            onclick="adminApp.updateUserRole('${this.escapeHtml(user.userId)}', '${selectId}')"
                        >
                            Update
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Grant a global role to a user
     */
    async grantRole() {
        const userIdInput = document.getElementById('userIdInput');
        const roleSelect = document.getElementById('roleSelect');

        const userId = userIdInput.value.trim();
        const role = roleSelect.value;

        if (!userId) {
            window.toast.warning('Please enter a user ID or email');
            return;
        }

        try {
            const response = await window.apiClient._request(`/admin/users/${encodeURIComponent(userId)}/role`, {
                method: 'POST',
                body: JSON.stringify({ role })
            });

            window.toast.success(`Successfully granted ${role} role to ${userId}`);
            userIdInput.value = '';

            // Reload and preserve search state
            const searchInput = document.getElementById('globalRolesSearch');
            const currentQuery = searchInput ? searchInput.value : '';
            await this.loadGlobalRoles();
            if (currentQuery) {
                this.filterGlobalRoles(currentQuery);
            }

        } catch (error) {
            console.error('Failed to grant role:', error);
            window.toast.error(`Failed to grant role: ${error.message}`);
        }
    }

    /**
     * Update (or remove) a user's global role from the table dropdown
     */
    async updateUserRole(userId, selectId) {
        const select = document.getElementById(selectId);
        if (!select) {
            window.toast.error('Could not find role selector for this user');
            return;
        }

        const role = select.value;
        const isRemoval = role === 'none';

        try {
            if (isRemoval) {
                await window.apiClient._request(`/admin/users/${encodeURIComponent(userId)}/role`, {
                    method: 'DELETE'
                });
                window.toast.success(`Removed global role from ${userId}`);
            } else {
                await window.apiClient._request(`/admin/users/${encodeURIComponent(userId)}/role`, {
                    method: 'POST',
                    body: JSON.stringify({ role })
                });
                window.toast.success(`Updated ${userId} to ${role}`);
            }

            // Reload and preserve search state
            const searchInput = document.getElementById('globalRolesSearch');
            const currentQuery = searchInput ? searchInput.value : '';
            await this.loadGlobalRoles();
            if (currentQuery) {
                this.filterGlobalRoles(currentQuery);
            }
        } catch (error) {
            console.error('Failed to update role:', error);
            window.toast.error(`Failed to update role: ${error.message}`);
        }
    }

    /**
     * Load access requests
     */
    async loadAccessRequests() {
        const container = document.getElementById('accessRequestsContainer');
        const filter = document.querySelector('input[name="requestFilter"]:checked').value;

        try {
            const response = await window.apiClient.getAccessRequests(filter || null);
            const requests = response.requests || [];

            if (requests.length === 0) {
                container.innerHTML = `
                    <p style="color: #888; text-align: center;">
                        No ${filter || 'access'} requests found.
                    </p>
                `;
                return;
            }

            const html = requests.map(request => this.renderAccessRequest(request)).join('');
            container.innerHTML = html;

        } catch (error) {
            console.error('Failed to load access requests:', error);
            container.innerHTML = `
                <p style="color: #dc3545; text-align: center;">
                    Failed to load access requests: ${this.escapeHtml(error.message)}
                </p>
            `;
        }
    }

    /**
     * Render a single access request card
     */
    renderAccessRequest(request) {
        const isPending = request.status === 'pending';
        const statusClass = request.status || 'pending';

        // Convert role to capability language for UI
        const capability = (request.requestedRole === 'editor' || request.requestedRole === 'EDITOR')
            ? 'edit access'
            : 'view access';

        return `
            <div class="access-request-card">
                <div class="header">
                    <div>
                        <strong>${this.escapeHtml(request.requesterEmail || request.requesterId)}</strong>
                        requests <strong>${capability}</strong> to
                        <strong>${this.escapeHtml(request.chartName || request.chartId)}</strong>
                    </div>
                    <span class="status ${statusClass}">${request.status || 'pending'}</span>
                </div>

                ${request.reason ? `
                    <div style="margin-bottom: 12px;">
                        <strong>Reason:</strong> ${this.escapeHtml(request.reason)}
                    </div>
                ` : ''}

                <div style="font-size: 12px; color: #888; margin-bottom: 12px;">
                    Requested: ${new Date(request.createdAt).toLocaleString()}
                    ${request.reviewedAt ? `<br>Reviewed: ${new Date(request.reviewedAt).toLocaleString()}` : ''}
                </div>

                ${request.reviewNotes ? `
                    <div style="font-size: 12px; margin-bottom: 12px;">
                        <strong>Review Notes:</strong> ${this.escapeHtml(request.reviewNotes)}
                    </div>
                ` : ''}

                ${isPending ? `
                    <div class="role-select-wrapper">
                        <label for="role-select-${request.id}" class="sr-only">Grant role</label>
                        <select id="role-select-${request.id}" class="compact-select">
                            <option value="viewer" ${request.requestedRole === 'viewer' ? 'selected' : ''}>Viewer</option>
                            <option value="editor" ${request.requestedRole === 'editor' ? 'selected' : ''}>Editor</option>
                        </select>
                        <button class="btn btn-sm btn-success" onclick="adminApp.reviewRequest('${request.id}', 'approve')">
                            Approve
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="adminApp.reviewRequest('${request.id}', 'deny')">
                            Deny
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Review an access request (approve or deny)
     */
    async reviewRequest(requestId, action) {
        try {
            let grantedRole = null;

            // If approving, get the selected role from the dropdown
            if (action === 'approve') {
                const roleSelector = document.getElementById(`role-select-${requestId}`);
                if (roleSelector) {
                    grantedRole = roleSelector.value;
                }
            }

            // Send decision with optional granted role
            await window.apiClient.reviewAccessRequest(requestId, action, '', grantedRole);

            window.toast.success(`Request ${action}d successfully`);
            await this.loadAccessRequests();

        } catch (error) {
            console.error(`Failed to ${action} request:`, error);
            window.toast.error(`Failed to ${action} request: ${error.message}`);
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is loaded
let adminApp;

document.addEventListener('DOMContentLoaded', () => {
    adminApp = new AdminApp();
    window.adminApp = adminApp;
});
