/**
 * Chart Sharing Module
 * Handles chart-level permission management
 */

class ChartSharingManager {
    constructor(chartId) {
        this.chartId = chartId;
        this.permissions = [];
    }

    /**
     * Show sharing modal for a chart
     */
    async showSharingModal() {
        // Create modal HTML
        const modal = this.createSharingModal();
        document.body.appendChild(modal);

        // Load current permissions
        await this.loadPermissions();

        // Show modal
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }

    /**
     * Create sharing modal HTML
     */
    createSharingModal() {
        const modal = document.createElement('div');
        modal.id = 'sharingModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h2>Share Chart</h2>
                    <button class="modal-close" onclick="chartSharingManager.closeSharingModal()">&times;</button>
                </div>

                <div class="modal-body">
                    <!-- Share Form -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-bottom: 12px;">Share with User</h3>
                        <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 8px;">
                            <input
                                type="text"
                                id="shareUserIdInput"
                                class="form-control"
                                placeholder="User ID or Email"
                            >
                            <select id="shareRoleSelect" class="form-control">
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                            </select>
                            <button class="btn btn-primary" onclick="chartSharingManager.shareChart()">
                                Share
                            </button>
                        </div>
                    </div>

                    <!-- Current Permissions List -->
                    <div>
                        <h3 style="margin-bottom: 12px;">Current Permissions</h3>
                        <div id="permissionsList">
                            <p style="color: #888; text-align: center;">Loading...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeSharingModal();
            }
        });

        return modal;
    }

    /**
     * Load current permissions for the chart
     */
    async loadPermissions() {
        const container = document.getElementById('permissionsList');

        try {
            // Get chart details including permissions
            const response = await window.apiClient.getChart(this.chartId);
            this.permissions = response.chart?.permissions || [];

            if (this.permissions.length === 0) {
                container.innerHTML = `
                    <p style="color: #888; text-align: center;">
                        No additional permissions set. Share this chart to collaborate.
                    </p>
                `;
                return;
            }

            const html = this.permissions.map(perm => this.renderPermission(perm)).join('');
            container.innerHTML = html;

        } catch (error) {
            console.error('Failed to load permissions:', error);
            container.innerHTML = `
                <p style="color: #dc3545; text-align: center;">
                    Failed to load permissions: ${this.escapeHtml(error.message)}
                </p>
            `;
        }
    }

    /**
     * Render a single permission entry
     */
    renderPermission(permission) {
        // Normalize role to uppercase for case-insensitive comparison
        const role = (permission.role || '').toUpperCase();
        const isOwner = role === 'OWNER';
        const canEdit = role === 'OWNER' || role === 'EDITOR';
        const capability = canEdit ? 'Can Edit' : 'View Only';
        const roleColor = canEdit ? '#e3f2fd' : '#f5f5f5';
        const textColor = canEdit ? '#1976d2' : '#757575';

        return `
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                margin-bottom: 8px;
            ">
                <div>
                    <div style="font-weight: 600;">${this.escapeHtml(permission.userEmail || permission.userId)}</div>
                    <div style="
                        display: inline-block;
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        color: ${textColor};
                        background-color: ${roleColor};
                        margin-top: 4px;
                    ">
                        ${capability}
                    </div>
                </div>
                ${!isOwner ? `
                    <button
                        class="btn btn-sm btn-danger"
                        onclick="chartSharingManager.revokeAccess('${this.escapeHtml(permission.userId)}')"
                    >
                        Revoke
                    </button>
                ` : `
                    <span style="color: #888; font-size: 12px;">You</span>
                `}
            </div>
        `;
    }

    /**
     * Share chart with a user
     */
    async shareChart() {
        const userIdInput = document.getElementById('shareUserIdInput');
        const roleSelect = document.getElementById('shareRoleSelect');

        const targetUserId = userIdInput.value.trim();
        const role = roleSelect.value;

        if (!targetUserId) {
            window.toast.warning('Please enter a user ID or email');
            return;
        }

        try {
            await window.apiClient.shareChart(this.chartId, targetUserId, role);

            window.toast.success(`Chart shared with ${targetUserId} as ${role}`);
            userIdInput.value = '';

            // Reload permissions
            await this.loadPermissions();

        } catch (error) {
            console.error('Failed to share chart:', error);
            window.toast.error(`Failed to share chart: ${error.message}`);
        }
    }

    /**
     * Revoke access from a user
     */
    async revokeAccess(userId) {
        const confirmed = await window.toast.confirm({
            message: `Remove ${userId}'s access to this chart?`,
            title: 'Revoke Access',
            confirmText: 'Revoke',
            cancelText: 'Cancel'
        });

        if (!confirmed) {
            return;
        }

        try {
            await window.apiClient.revokeAccess(this.chartId, userId);

            window.toast.success(`Access revoked for ${userId}`);

            // Reload permissions
            await this.loadPermissions();

        } catch (error) {
            console.error('Failed to revoke access:', error);
            window.toast.error(`Failed to revoke access: ${error.message}`);
        }
    }

    /**
     * Close sharing modal
     */
    closeSharingModal() {
        const modal = document.getElementById('sharingModal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => modal.remove(), 300);
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

// Global instance
let chartSharingManager = null;

/**
 * Show sharing modal for a chart
 */
function showChartSharing(chartId) {
    chartSharingManager = new ChartSharingManager(chartId);
    chartSharingManager.showSharingModal();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChartSharingManager;
}
