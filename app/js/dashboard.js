/**
 * Dashboard Application Logic
 * Handles chart listing, creation, and management
 */

class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.editingChartSource = null;
        this.cachedCharts = [];
        this.bulkExportManager = null;
        this.exportDependenciesLoaded = false;
        this.apiUnavailable = false;
        this.exportPreflightState = null;
        this.deletedCharts = []; // Stack for undo functionality
        this.undoTimeout = null; // Timer for auto-clearing undo
        this.init();
    }

    init() {
        // Verify toast system is available
        this.ensureToastSystem();

        // Update UI based on authentication state
        this.updateUIForAuthState();

        // Show skeleton loading state initially
        this.showSkeletonLoading();

        // Small delay to allow skeleton to render
        setTimeout(() => {
            this.renderCharts();
            this.setupEventDelegation();
            // initializeBulkExport() is now called after lazy loading dependencies
        }, 100);
    }

    /**
     * Update UI elements based on authentication state
     */
    updateUIForAuthState() {
        const isAuthenticated = window.apiClient?.isUserAuthenticated();
        const newChartBtn = document.querySelector('[data-action="new-chart"]');
        const loginPrompt = document.getElementById('loginPrompt');

        if (!isAuthenticated) {
            // Hide "New Chart" button for anonymous users
            if (newChartBtn) {
                newChartBtn.style.display = 'none';
            }

            // Show login prompt banner if it doesn't exist
            if (!loginPrompt) {
                const banner = document.createElement('div');
                banner.id = 'loginPrompt';
                banner.className = 'login-prompt-banner';
                banner.innerHTML = `
                    <div class="login-prompt-content">
                        <svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                        </svg>
                        <span>You're browsing as a guest. <a href="/.auth/login/aad">Sign in</a> to create and edit charts.</span>
                    </div>
                `;

                const header = document.querySelector('.header-content') || document.querySelector('header');
                if (header && header.parentElement) {
                    header.parentElement.insertBefore(banner, header.nextSibling);
                }
            }
        } else {
            // Ensure "New Chart" button is visible for authenticated users
            if (newChartBtn) {
                newChartBtn.style.display = '';
            }

            // Remove login prompt if exists
            if (loginPrompt) {
                loginPrompt.remove();
            }
        }
    }

    /**
     * Ensure toast notification system is initialized
     * Falls back to native confirm/alert if toast not available
     */
    ensureToastSystem() {
        if (typeof window.toast === 'undefined') {
            console.error('âš ï¸ Toast notification system not initialized. Using fallback methods.');

            // Create minimal fallback toast system
            window.toast = {
                success: (msg) => {
                    console.log('âœ… SUCCESS:', msg);
                    alert(`âœ… ${msg}`);
                },
                error: (msg) => {
                    console.error('âŒ ERROR:', msg);
                    alert(`âŒ Error: ${msg}`);
                },
                warning: (msg) => {
                    console.warn('âš ï¸ WARNING:', msg);
                    alert(`âš ï¸ ${msg}`);
                },
                info: (msg) => {
                    console.info('â„¹ï¸ INFO:', msg);
                    alert(`â„¹ï¸ ${msg}`);
                },
                confirm: ({ message, title = 'Confirm' }) => {
                    return Promise.resolve(
                        window.confirm(`${title}\n\n${message}`)
                    );
                }
            };
        }
    }

    /**
     * Show warning banner when API server is unavailable
     * This helps users understand their charts aren't deleted, just inaccessible
     */
    showApiUnavailableWarning() {
        // Only show once per session
        if (this._apiWarningShown) return;
        this._apiWarningShown = true;

        // Create warning banner
        const banner = document.createElement('div');
        banner.id = 'api-unavailable-banner';
        banner.style.cssText = `
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 8px;
            padding: 16px 20px;
            margin: 16px auto;
            max-width: 800px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;
        banner.innerHTML = `
            <span style="font-size: 24px;">⚠️</span>
            <div style="flex: 1;">
                <strong style="color: #92400e; display: block; margin-bottom: 4px;">API Server Unavailable</strong>
                <p style="color: #78350f; margin: 0; font-size: 14px; line-height: 1.5;">
                    Cannot connect to the chart server. Your charts are safely stored in the cloud — they are not deleted.
                    <br><strong>To fix:</strong> Start the API server with <code style="background: #fde68a; padding: 2px 6px; border-radius: 4px;">swa start app --api-location api</code> from the project root.
                </p>
            </div>
            <button onclick="this.parentElement.remove()" style="background: none; border: none; cursor: pointer; font-size: 18px; color: #92400e; padding: 0;">✕</button>
        `;

        // Insert at top of main content
        const container = document.getElementById('chartsContainer') || document.querySelector('main');
        if (container) {
            container.insertAdjacentElement('beforebegin', banner);
        }

        // Also log to console for developers
        console.warn(
            '%c API Server Not Running ',
            'background: #f59e0b; color: #000; padding: 4px 8px; border-radius: 4px;',
            '\nCharts are stored in MongoDB Atlas (cloud) - your data is safe.',
            '\n\nTo start the API:',
            '\n  cd api && npm run start',
            '\n  OR: swa start app --api-location api'
        );
    }

    clearApiUnavailableWarning() {
        const banner = document.getElementById('api-unavailable-banner');
        if (banner) {
            banner.remove();
        }
        this._apiWarningShown = false;
    }

    /**
     * Enable/disable chart creation controls for viewer-only users
     */
    updateCreateButtonsState() {
        const allowCreate = !!this.userCanCreate;
        const buttons = document.querySelectorAll('button[onclick*="showCreateModal"]');

        buttons.forEach(btn => {
            btn.disabled = !allowCreate;
            btn.classList.toggle('disabled', !allowCreate);
            if (!allowCreate) {
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.title = 'You have view-only access. Request editor permissions to create charts.';
                btn.setAttribute('aria-disabled', 'true');
            } else {
                btn.style.opacity = '';
                btn.style.cursor = '';
                btn.title = 'Create new chart';
                btn.removeAttribute('aria-disabled');
            }
        });
    }

    updateExportButtonsState() {
        const exportBtn = document.querySelector('button[onclick="app.exportAllChartsToPDF()"]');
        if (!exportBtn) {
            return;
        }

        const canExport = !this.apiUnavailable;
        exportBtn.disabled = !canExport;
        if (!canExport) {
            exportBtn.setAttribute('aria-disabled', 'true');
            exportBtn.title = 'Export unavailable while the chart server is offline.';
        } else {
            exportBtn.removeAttribute('aria-disabled');
            exportBtn.title = 'Export all charts to PDF';
        }
    }

    /**
     * Show skeleton loading cards
     */
    showSkeletonLoading() {
        const container = document.getElementById('chartsContainer');
        const emptyState = document.getElementById('emptyState');
        emptyState.style.display = 'none';

        const skeletonHTML = `
            <div class="charts-grid">
                ${Array(6).fill(0).map(() => `
                    <div class="chart-card">
                        <div class="chart-card-header">
                            <div class="flex-1">
                                <div class="skeleton skeleton-text skeleton-title"></div>
                                <div class="skeleton skeleton-text skeleton-subtitle mt-1"></div>
                            </div>
                        </div>
                        <div class="chart-card-meta">
                            <div class="skeleton skeleton-text skeleton-meta"></div>
                            <div class="skeleton skeleton-text skeleton-meta"></div>
                            <div class="skeleton skeleton-text skeleton-meta"></div>
                        </div>
                        <div class="skeleton skeleton-text skeleton-desc"></div>
                        <div class="skeleton skeleton-text skeleton-desc short"></div>
                    </div>
                `).join('')}
            </div>
        `;

        container.innerHTML = skeletonHTML;
    }

    /**
     * Setup event delegation for chart cards
     * Fixes XSS vulnerability by removing inline event handlers
     */
    setupEventDelegation() {
        const container = document.getElementById('chartsContainer');

        // Delegate chart card clicks
        container.addEventListener('click', (e) => {
            console.log('ðŸ–±ï¸ Click detected on:', e.target);

            // CRITICAL: Handle action button clicks FIRST (before card click)
            const button = e.target.closest('button[data-action]');
            if (button) {
                console.log('ðŸŽ¯ Action button clicked:', button.dataset.action);
                e.preventDefault();
                e.stopPropagation();

                const action = button.dataset.action;
                const chartId = button.dataset.chartId;

                if (!chartId) {
                    console.error('âŒ Button missing chartId:', button);
                    return;
                }

                console.log(`ðŸ”§ Executing action: ${action} on chart: ${chartId}`);

                switch (action) {
                    case 'edit':
                        this.openChart(chartId);
                        break;
                    case 'view':
                        this.openChart(chartId);
                        break;
                    case 'duplicate':
                        this.duplicateChart(chartId);
                        break;
                    case 'settings':
                        this.editChartMetadata(chartId);
                        break;
                    case 'delete':
                        this.deleteChart(chartId);
                        break;
                    case 'request-access':
                        this.requestAccess(chartId);
                        break;
                    case 'share':
                        showChartSharing(chartId);
                        break;
                    default:
                        console.warn('âš ï¸ Unknown action:', action);
                }
                return; // Stop here, don't process card click
            }

            // Check if clicked inside action menu area (prevent card open)
            if (e.target.closest('.chart-card-menu') ||
                e.target.closest('.chart-card-actions-mobile')) {
                console.log('ðŸš« Click inside action menu - ignoring card click');
                return;
            }

            // Handle chart card click (open chart)
            const card = e.target.closest('.chart-card');
            if (card) {
                const chartId = card.dataset.chartId;
                if (chartId) {
                    console.log('ðŸ“‚ Opening chart:', chartId);
                    this.openChart(chartId);
                } else {
                    console.warn('âš ï¸ Card missing chartId:', card);
                }
                return;
            }

            console.log('â„¹ï¸ Click on non-interactive element');
        });
    }

    countPeople(nodes = []) {
        if (!Array.isArray(nodes)) {
            return 0;
        }
        return nodes.reduce((total, node) => {
            if (node.members && Array.isArray(node.members)) {
                const memberCount = node.members.reduce((sum, role) => {
                    return sum + (role.entries ? role.entries.length : 0);
                }, 0);
                return total + memberCount;
            }
            if (node.name) {
                return total + 1;
            }
            return total;
        }, 0);
    }

    /**
     * Render all charts (using API client for both authenticated and anonymous)
     */
    async renderCharts() {
        const container = document.getElementById('chartsContainer');
        const emptyState = document.getElementById('emptyState');
        const isAuthenticated = window.apiClient?.isUserAuthenticated();

        try {
            let charts = [];

            // Use API client to fetch charts (works for both authenticated and anonymous)
            if (window.apiClient) {
                try {
                    const resp = await window.apiClient.getCharts({ includeData: true });
                    // Handle both array and object response shapes
                    const apiCharts = Array.isArray(resp) ? resp : (resp?.charts || []);
                    this.apiUnavailable = false;
                    this.clearApiUnavailableWarning();

                    // Transform API response to dashboard format
                    charts = apiCharts.map(chart => {
                        const nodeData = chart.data?.nodes || chart.nodes || [];
                        const nodeCount = Number.isFinite(chart.nodeCount)
                            ? chart.nodeCount
                            : (Array.isArray(nodeData) ? nodeData.length : 0);
                        const peopleCount = Number.isFinite(chart.peopleCount)
                            ? chart.peopleCount
                            : this.countPeople(nodeData);

                        return ({
                        chartId: chart.id,
                        cloudId: chart.id,
                        chartName: chart.name,
                        name: chart.name,
                        nodes: [], // Keep cards light; use counts instead of full node data
                        nodeCount,
                        peopleCount,
                        lastModified: chart.lastModified,
                        createdAt: chart.createdAt,
                        // Extract departmentTag from all possible locations
                        departmentTag: chart.data?.departmentTag || chart.data?.metadata?.departmentTag || chart.departmentTag || '',
                        source: 'api',
                        synced: true,
                        userRole: chart.userRole,
                        roleSource: chart.roleSource,
                        isPublic: chart.isPublic,
                        sharedWith: chart.sharedWith
                        });
                    });
                } catch (error) {
                    console.warn('Could not load charts from API:', error);

                    // Detect API server not running (connection refused / failed to fetch)
                    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
                        // Show user-friendly warning that API is down
                        this.apiUnavailable = true;
                        this.showApiUnavailableWarning();
                    }

                    // Don't show login prompts for server errors (500)
                    // 401 errors are automatically handled by api-client (redirects to login)
                    // Just continue to show empty state or local charts
                }
            }

            // Fallback to local storage for backward compatibility
            // Only show local charts with valid UUID IDs (others can't be opened)
            if (charts.length === 0 && isAuthenticated) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                const localCharts = storage.getChartsArray();

                // Filter out charts with invalid IDs and warn user
                const invalidCharts = localCharts.filter(chart => !uuidRegex.test(chart.chartId));
                if (invalidCharts.length > 0) {
                    console.warn(`Found ${invalidCharts.length} local charts with invalid IDs that cannot be opened:`,
                        invalidCharts.map(c => ({ id: c.chartId, name: c.chartName })));
                }

                charts = localCharts
                    .filter(chart => uuidRegex.test(chart.chartId))
                    .map(chart => ({
                        ...chart,
                        nodeCount: Array.isArray(chart.nodes) ? chart.nodes.length : 0,
                        peopleCount: this.countPeople(chart.nodes),
                        source: 'local',
                        synced: false,
                        userRole: 'owner'
                    }));

                // Show warning if we filtered out charts
                if (invalidCharts.length > 0) {
                    window.toast?.warning(
                        `${invalidCharts.length} old chart${invalidCharts.length > 1 ? 's' : ''} ` +
                        `cannot be displayed (incompatible format). Create new charts to replace them.`
                    );
                }
            }

            // Determine if user appears able to create (owner/editor on any chart)
            const hasEditorRole = charts.some(chart => {
                const role = (chart.userRole || '').toLowerCase();
                return role === 'owner' || role === 'editor';
            });
            const allViewer = charts.length > 0 && charts.every(chart => (chart.userRole || '').toLowerCase() === 'viewer');
            // If no charts, assume allow (new editors/admins with no charts yet)
            this.userCanCreate = hasEditorRole || !allViewer;
            if (this.apiUnavailable) {
                this.userCanCreate = false;
            }
            this.updateCreateButtonsState();
            this.updateExportButtonsState();
            this.updateRoleChip(this.getEffectiveRole(charts));

            // Apply search filter
            if (this.currentFilter) {
                const filterLower = this.currentFilter.toLowerCase();
                charts = charts.filter(chart =>
                    (chart.chartName && chart.chartName.toLowerCase().includes(filterLower)) ||
                    (chart.departmentTag && chart.departmentTag.toLowerCase().includes(filterLower))
                );
            }

            this.cachedCharts = charts;

                if (charts.length === 0) {
                    container.innerHTML = '';
                    emptyState.style.display = 'block';

                if (this.apiUnavailable) {
                    emptyState.innerHTML = `
                        <h2>Charts temporarily unavailable</h2>
                        <p>We couldn't reach the chart server. Your charts are safely stored in the cloud.</p>
                        <p>Please try again in a moment or contact your administrator.</p>
                    `;
                    return;
                }

                // Update empty state message for anonymous users
                if (!isAuthenticated) {
                    emptyState.innerHTML = `
                        <h2>No public charts found</h2>
                        <p>There are no publicly shared charts available.</p>
                        <p><a href="/.auth/login/aad" class="btn btn-primary">Sign in</a> to create and manage your own charts.</p>
                    `;
                } else {
                    // Restore default empty state for authenticated users
                    emptyState.innerHTML = `
                        <h2>No charts yet</h2>
                        <p>Create your first organizational chart to get started.</p>
                        <button class="btn btn-primary" onclick="app.showCreateModal()">Create New Chart</button>
                    `;
                    this.updateCreateButtonsState();
                }
                return;
            }

            emptyState.style.display = 'none';

            const html = `
                <div class="charts-grid">
                    ${charts.map((chart, index) => this.renderChartCard(chart, index)).join('')}
                </div>
            `;

            container.innerHTML = html;

        } catch (error) {
            console.error('Error rendering charts:', error);
            container.innerHTML = '<p style="color: red;">Error loading charts. Please refresh the page.</p>';
        }
    }

    getEffectiveRole(charts = []) {
        if (!Array.isArray(charts) || charts.length === 0) {
            return this.userCanCreate ? 'Editor' : 'Viewer';
        }

        let hasEditor = false;
        let hasViewer = false;

        for (const chart of charts) {
            const role = (chart.userRole || '').toLowerCase();
            if (role === 'owner') {
                return 'Owner';
            }
            if (role === 'editor') {
                hasEditor = true;
            } else if (role === 'viewer') {
                hasViewer = true;
            }
        }

        if (hasEditor) {
            return 'Editor';
        }
        if (hasViewer) {
            return 'Viewer';
        }
        return this.userCanCreate ? 'Editor' : '';
    }

    updateRoleChip(role) {
        const chip = document.getElementById('user-role-chip');
        const isAuthenticated = window.apiClient?.isUserAuthenticated();
        if (!chip || !isAuthenticated || !role) {
            if (chip) {
                chip.style.display = 'none';
            }
            return;
        }

        chip.textContent = role;
        chip.title = `Role: ${role}`;
        chip.setAttribute('aria-label', `Role: ${role}`);
        chip.style.display = 'inline-flex';
    }

    /**
     * Merge local and cloud charts
     * Cloud charts take precedence for matching cloudId
     */
    mergeCharts(localCharts, cloudCharts) {
        const merged = new Map();

        // Add all local charts
        localCharts.forEach(chart => {
            const key = chart.cloudId || chart.chartId;
            merged.set(key, {
                ...chart,
                source: 'local',
                synced: !!chart.cloudId
            });
        });

        // Add/update with cloud charts
        cloudCharts.forEach(cloudChart => {
            const key = cloudChart.id;
            const existing = merged.get(key);

            merged.set(key, {
                chartId: cloudChart.id,
                cloudId: cloudChart.id,
                name: cloudChart.name,
                nodes: cloudChart.data?.nodes || [],
                lastModified: cloudChart.lastModified,
                createdAt: cloudChart.createdAt || cloudChart.lastModified,
                departmentTag: cloudChart.data?.metadata?.departmentTag || '',
                source: 'cloud',
                synced: true,
                userRole: cloudChart.userRole,
                sharedWith: cloudChart.sharedWith
            });
        });

        return Array.from(merged.values()).sort((a, b) =>
            new Date(b.lastModified) - new Date(a.lastModified)
        );
    }

    /**
     * Render a single chart card with alternating neutral accent colors
     * @param {Object} chart - The chart data
     * @param {number} index - The card index (for alternating colors)
     */
    renderChartCard(chart, index = 0) {
        // Defensive guard for missing lastModified field
        const lastModified = chart.lastModified
            ? new Date(chart.lastModified).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            : 'No date';

        const nodeCount = Number.isFinite(chart.nodeCount)
            ? chart.nodeCount
            : (chart.nodes ? chart.nodes.length : (chart.data?.nodes?.length || 0));

        const totalPeople = Number.isFinite(chart.peopleCount)
            ? chart.peopleCount
            : this.countPeople(chart.nodes || chart.data?.nodes || []);

        // Determine user's role and permissions (backend logic unchanged)
        const userRole = chart.userRole || 'viewer';
        const isOwner = userRole === 'owner' || userRole === 'OWNER';
        const canEdit = isOwner || userRole === 'editor' || userRole === 'EDITOR';
        const isViewer = userRole === 'viewer' || userRole === 'VIEWER';

        // UI capability indicator (presentation only)
        const capability = canEdit ? 'Editable' : 'Read-only';

        // Escape chartId for use in data attribute
        const escapedChartId = this.escapeHtml(chart.chartId);

        // Determine department category for styling
        const departmentLower = (chart.departmentTag || '').toLowerCase();
        let pillVariant = '';
        let deptCategory = 'default';

        if (['engineering', 'product', 'tech', 'development'].some(keyword => departmentLower.includes(keyword))) {
            pillVariant = 'primary';
            deptCategory = 'engineering';
        } else if (['sales', 'revenue', 'business'].some(keyword => departmentLower.includes(keyword))) {
            pillVariant = 'success';
            deptCategory = 'sales';
        } else if (['marketing', 'brand'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'marketing';
        } else if (['operations', 'ops'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'operations';
        } else if (['finance', 'accounting'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'finance';
        } else if (['hr', 'people', 'human'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'hr';
        } else if (['it', 'information', 'technology', 'digital'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'it';
        } else if (['legal', 'compliance', 'law'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'legal';
        } else if (['admin', 'administration', 'executive'].some(keyword => departmentLower.includes(keyword))) {
            deptCategory = 'admin';
        }

        // Determine alternating accent color based on card index (not department)
        const cardAccent = index % 2 === 0 ? 'var(--card-accent-a)' : 'var(--card-accent-b)';

        return `
            <div class="chart-card" data-chart-id="${escapedChartId}" data-department="${deptCategory}" style="--card-accent: ${cardAccent};">
                <div class="chart-card-header">
                    <div>
                        <h3 class="chart-card-title">${this.escapeHtml(chart.chartName)}</h3>
                        <div class="chart-card-tags">
                            ${chart.departmentTag ? `<span class="pill-tag ${pillVariant}">${this.escapeHtml(chart.departmentTag)}</span>` : ''}
                            ${!chart.departmentTag ? `
                                <span class="pill-tag" style="background-color: ${canEdit ? '#e3f2fd' : '#f5f5f5'}; color: ${canEdit ? '#1976d2' : '#757575'}; font-size: 11px;">
                                    ${capability}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                    <div class="chart-card-menu">
                        <button class="action-menu-trigger" data-action="settings" data-chart-id="${escapedChartId}" title="Chart Settings" aria-label="Chart Settings">
                            <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l0 0a2 2 0 1 1-2.83 2.83l0 0a1.65 1.65 0 0 0-1.82.33 1.65 1.65 0 0 0-.5 1.57 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.22 1.65 1.65 0 0 0-1.82-.33l0 0a2 2 0 1 1-2.83-2.83l0 0a1.65 1.65 0 0 0-.33-1.82 1.65 1.65 0 0 0-1.57-.5 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.22-1 1.65 1.65 0 0 0 .33-1.82l0 0a2 2 0 1 1 2.83-2.83l0 0a1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0 .5-1.57 2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.22 1.65 1.65 0 0 0 1.82.33l0 0a2 2 0 1 1 2.83 2.83l0 0a1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 0 1.57.5 2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.22 1z"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="chart-card-meta">
                    <span class="chart-card-meta-item">
                        <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${lastModified}
                    </span>
                    <span class="chart-card-meta-item">
                        <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        </svg>
                        ${nodeCount} nodes
                    </span>
                    <span class="chart-card-meta-item">
                        <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        ${totalPeople} people
                    </span>
                    ${chart.synced ? `
                        <span class="chart-card-meta-item" style="color: var(--success-color);" title="Synced to cloud">
                            <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor">
                                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                <polyline points="16 14 12 10 8 14" stroke-width="2"></polyline>
                            </svg>
                            Cloud
                        </span>
                    ` : `
                        <span class="chart-card-meta-item" style="color: var(--text-muted);" title="Local only - not synced">
                            <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor">
                                <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path>
                                <line x1="1" y1="1" x2="23" y2="23" stroke-width="2"></line>
                            </svg>
                            Local
                        </span>
                    `}
                </div>
                ${chart.description ? `
                    <p class="chart-card-description text-sm text-muted">${this.escapeHtml(chart.description)}</p>
                ` : ''}

                <!-- Desktop Action Buttons (hidden on mobile) -->
                <div class="chart-card-actions">
                    ${canEdit ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-chart-id="${escapedChartId}" title="Edit Chart" aria-label="Edit ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Edit</span>
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-outline-secondary" data-action="view" data-chart-id="${escapedChartId}" title="View Chart" aria-label="View ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">View</span>
                        </button>
                    `}
                    ${isOwner ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="share" data-chart-id="${escapedChartId}" title="Share Chart" aria-label="Share ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Share</span>
                        </button>
                    ` : ''}
                    ${isViewer ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="request-access" data-chart-id="${escapedChartId}" title="Request Editor Access" aria-label="Request Access to ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Request Access</span>
                        </button>
                    ` : ''}
                    ${canEdit ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="duplicate" data-chart-id="${escapedChartId}" title="Duplicate Chart" aria-label="Duplicate ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Duplicate</span>
                        </button>
                    ` : ''}
                    ${isOwner ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="delete" data-chart-id="${escapedChartId}" title="Delete Chart" aria-label="Delete ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Delete</span>
                        </button>
                    ` : ''}
                </div>

                <!-- Mobile Action Buttons (always visible on touch devices) -->
                <div class="chart-card-actions-mobile">
                    ${canEdit ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-chart-id="${escapedChartId}" title="Edit Chart" aria-label="Edit ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Edit</span>
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-outline-secondary" data-action="view" data-chart-id="${escapedChartId}" title="View Chart" aria-label="View ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">View</span>
                        </button>
                    `}
                    ${isOwner ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="share" data-chart-id="${escapedChartId}" title="Share Chart" aria-label="Share ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Share</span>
                        </button>
                    ` : ''}
                    ${isViewer ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="request-access" data-chart-id="${escapedChartId}" title="Request Editor Access" aria-label="Request Access to ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Request Access</span>
                        </button>
                    ` : ''}
                    ${canEdit ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="duplicate" data-chart-id="${escapedChartId}" title="Duplicate Chart" aria-label="Duplicate ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Duplicate</span>
                        </button>
                    ` : ''}
                    ${isOwner ? `
                        <button class="btn btn-sm btn-outline-secondary" data-action="delete" data-chart-id="${escapedChartId}" title="Delete Chart" aria-label="Delete ${this.escapeHtml(chart.chartName)}">
                            <span class="btn-label">Delete</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    getDepartmentAccentColor(category = 'default') {
        const accentMap = {
            engineering: 'var(--dept-engineering)',
            sales: 'var(--dept-sales)',
            marketing: 'var(--dept-marketing)',
            operations: 'var(--dept-operations)',
            finance: 'var(--dept-finance)',
            hr: 'var(--dept-hr)',
            it: 'var(--dept-it)',
            legal: 'var(--dept-legal)',
            admin: 'var(--dept-admin)',
            default: 'var(--dept-default)'
        };
        return accentMap[category] || accentMap.default;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Filter charts by search query
     */
    filterCharts(query) {
        this.currentFilter = query;
        this.renderCharts();
    }

    /**
     * Show create chart modal
     */
    async showCreateModal() {
        this.editingChartId = null;
        this.editingChartSource = null;
        document.getElementById('modalTitle').textContent = 'Create New Chart';
        document.getElementById('chartForm').reset();
        document.getElementById('chartId').value = '';
        await this.populateCoverSelector('');
        document.getElementById('settingsCoverOrderIndex').value = '';
        document.querySelector('#chartForm button[type="submit"]').textContent = 'Create Chart';
        this.showModal();
    }

    /**
     * Edit chart metadata
     */
    async editChartMetadata(chartId) {
        const cachedChart = (this.cachedCharts || []).find(chart => chart.chartId === chartId);
        const chart = cachedChart || storage.getChart(chartId);
        if (!chart) {
            window.toast.error('Chart not found');
            return;
        }

        this.editingChartId = chartId;
        this.editingChartSource = cachedChart?.source || chart.source || 'local';
        let chartName = chart.chartName || chart.name || '';
        let departmentTag =
            chart.departmentTag ||
            chart.chartData?.departmentTag ||
            chart.chartData?.metadata?.departmentTag ||
            '';
        let coverId = chart.coverId || chart.chartData?.coverId || '';
        let coverOrderIndex = chart.coverOrderIndex ?? chart.chartData?.coverOrderIndex ?? '';

        if (this.editingChartSource === 'api' && window.apiClient) {
            try {
                const response = await window.apiClient.getChart(chartId);
                const chartPayload = response.chart || response;
                const chartData = chartPayload.data || chartPayload.chart?.data;

                chartName = chartPayload.name || chartPayload.chart?.name || chartName;

                if (chartData) {
                    departmentTag = chartData.departmentTag || chartData.metadata?.departmentTag || departmentTag;
                    coverId = chartData.coverId || coverId;
                    coverOrderIndex = chartData.coverOrderIndex ?? coverOrderIndex;
                }
            } catch (error) {
                console.warn('Failed to load chart details for settings:', error);
            }
        }

        document.getElementById('modalTitle').textContent = 'Edit Chart Settings';
        document.getElementById('chartName').value = chartName;
        document.getElementById('departmentTag').value = departmentTag;
        document.getElementById('chartId').value = chartId;
        await this.populateCoverSelector(coverId);
        document.getElementById('settingsCoverOrderIndex').value = coverOrderIndex ?? '';
        document.querySelector('#chartForm button[type="submit"]').textContent = 'Save Changes';
        this.showModal();
    }

    async populateCoverSelector(selectedCoverId = '') {
        const selector = document.getElementById('settingsCoverId');
        if (!selector) return;

        try {
            if (!this.coverImageMapping) {
                const response = await fetch('assets/export/cover-image-mapping.json');
                this.coverImageMapping = await response.json();
            }

            const mapping = this.coverImageMapping;
            selector.innerHTML = '<option value="">Cover</option>';

            if (mapping.coverImages && Array.isArray(mapping.coverImages)) {
                mapping.coverImages.forEach((cover) => {
                    const option = document.createElement('option');
                    option.value = cover.id;

                    const displayName = cover.label || cover.id
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');

                    option.textContent = displayName;
                    selector.appendChild(option);
                });
            }

            selector.value = selectedCoverId || '';
            this.bindCoverOrderToggle();
            this.updateCoverOrderState();
        } catch (error) {
            console.error('[Dashboard] Failed to load cover options:', error);
        }
    }

    bindCoverOrderToggle() {
        const selector = document.getElementById('settingsCoverId');
        if (!selector || selector.dataset.coverToggleBound) return;

        selector.addEventListener('change', () => {
            this.updateCoverOrderState();
        });
        selector.dataset.coverToggleBound = 'true';
    }

    updateCoverOrderState() {
        const selector = document.getElementById('settingsCoverId');
        const orderInput = document.getElementById('settingsCoverOrderIndex');
        if (!selector || !orderInput) return;

        const hasCover = Boolean(selector.value);
        orderInput.disabled = !hasCover;
        if (!hasCover) {
            orderInput.value = '';
        }
    }

    /**
     * Show modal
     */
    showModal() {
        const modal = document.getElementById('chartModal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    /**
     * Close modal
     */
    closeModal() {
        const modal = document.getElementById('chartModal');

        // Release accessibility focus trap and remove inert from background
        if (window.accessibilityManager) {
            window.accessibilityManager.releaseFocusTrap(modal);
        }

        modal.classList.remove('active');
        modal.style.display = 'none';
        document.getElementById('chartForm').reset();
        this.editingChartId = null;
        this.editingChartSource = null;
    }

    /**
     * Save chart (create or update)
     */
    async saveChart(event) {
        event.preventDefault();

        const chartName = document.getElementById('chartName').value.trim();
        const departmentTag = document.getElementById('departmentTag').value.trim();
        const coverId = document.getElementById('settingsCoverId')?.value || '';
        const coverOrderIndexValue = document.getElementById('settingsCoverOrderIndex')?.value;
        const coverOrderIndexParsed = coverOrderIndexValue ? parseInt(coverOrderIndexValue, 10) : NaN;
        const coverOrderIndex = Number.isFinite(coverOrderIndexParsed) && coverOrderIndexParsed >= 1
            ? coverOrderIndexParsed
            : null;
        const chartId = this.editingChartId;

        if (!chartName) {
            window.toast.warning('Please enter a chart name');
            return;
        }

        if (chartId) {
            if (this.editingChartSource === 'api' && window.apiClient) {
                try {
                    const response = await window.apiClient.getChart(chartId);
                    const chartPayload = response.chart || response;
                    const chartData = chartPayload.data || chartPayload.chart?.data;

                    if (!chartData) {
                        throw new Error('Chart data not found');
                    }

                    const updatedData = {
                        ...chartData,
                        chartName,
                        departmentTag,
                        coverId: coverId || null,
                        coverOrderIndex,
                        metadata: {
                            ...(chartData.metadata || {}),
                            departmentTag
                        }
                    };

                    await window.apiClient.updateChart(chartId, chartName, updatedData);
                    window.toast?.success('Chart updated successfully');
                    this.closeModal();
                    this.renderCharts();
                    return;
                } catch (error) {
                    console.error('Failed to update API chart metadata:', error);
                    window.toast?.error('Failed to update chart');
                    return;
                }
            }

            // Update existing local chart metadata
            storage.updateChart(chartId, {
                chartName,
                departmentTag,
                coverId: coverId || null,
                coverOrderIndex
            });
            this.closeModal();
            this.renderCharts();
        } else {
            // Create new chart via API (not localStorage)
            if (!window.apiClient?.isUserAuthenticated()) {
                window.toast.error('You must be signed in to create charts');
                window.apiClient?.login();
                return;
            }

            // Prepare chart data with default root node
            const chartData = {
                chartName,
                departmentTag,
                coverId: coverId || null,
                coverOrderIndex,
                nodes: [
                    {
                        id: storage.generateNodeId(),
                        parentId: null,
                        members: [
                            {
                                roleLabel: 'Chief Executive Officer',
                                entries: [
                                    {
                                        name: 'CEO Name',
                                        email: '',
                                        phone: '',
                                        photoUrl: ''
                                    }
                                ]
                            }
                        ],
                        meta: {
                            department: departmentTag || 'Executive',
                            notes: ''
                        }
                    }
                ]
            };

            try {
                // Create chart via API
                const response = await window.apiClient.createChart(chartName, chartData);

                // Get the UUID chart ID from response
                const newChartId = response.chartId || response.id;

                if (!newChartId) {
                    throw new Error('API did not return a valid chart ID');
                }

                // Close modal and redirect to editor with UUID
                this.closeModal();
                this.navigateToChartEditor(newChartId);

            } catch (error) {
                console.error('Failed to create chart:', error);

                if (error.message === 'Unauthorized') {
                    // Already redirected by apiClient
                    return;
                }

                // Show error to user
                window.toast.error(`Failed to create chart: ${error.message}`);

                // Don't fall back to localStorage - this would create charts that can't be opened
                // The user should try again or contact support
            }
        }
    }

    /**
     * Navigate to the chart editor and persist the last chart ID for recovery
     */
    navigateToChartEditor(chartId) {
        if (!chartId) {
            return;
        }

        try {
            sessionStorage.setItem('lastChartId', chartId);
        } catch (error) {
            // Ignore storage errors (e.g., private mode)
        }

        window.location.href = `chart-editor.html?id=${encodeURIComponent(chartId)}`;
    }

    /**
     * Open chart in editor
     */
    openChart(chartId) {
        // Validate that chartId is a UUID (backend requirement)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(chartId)) {
            console.warn('Invalid chart ID format:', chartId);
            window.toast.error(
                'This chart uses an old format and cannot be opened in the editor. ' +
                'Please create a new chart or contact support for migration assistance.'
            );
            return;
        }

        this.navigateToChartEditor(chartId);
    }

    /**
     * Duplicate chart
     */
    async duplicateChart(chartId) {
        const confirmed = await window.toast.confirm({
            message: 'Create a duplicate of this chart?',
            title: 'Duplicate Chart',
            confirmText: 'Duplicate',
            cancelText: 'Cancel'
        });

        if (confirmed) {
            // Check if this is a UUID (API chart) vs legacy localStorage ID
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chartId);

            if (isUUID && window.apiClient) {
                // API chart: fetch, duplicate via API, redirect
                try {
                    const response = await window.apiClient.getChart(chartId);
                    const originalChart = response.chart || response;

                    // Ensure we have chart data
                    const chartData = originalChart.data || originalChart.chart?.data;
                    if (!chartData) {
                        throw new Error('Chart data not found in response');
                    }

                    // Create duplicate with " (Copy)" suffix
                    const duplicateName = `${originalChart.name || chartData.chartName || 'Untitled'} (Copy)`;

                    // Call createChart with separate name and data parameters
                    const createResponse = await window.apiClient.createChart(duplicateName, chartData);
                    window.toast.success('Chart duplicated successfully!');

                    // Use chartId or id from response
                    const newChartId = createResponse.chartId || createResponse.id;
                    this.navigateToChartEditor(newChartId);
                } catch (error) {
                    console.error('Failed to duplicate API chart:', error);
                    window.toast.error(`Failed to duplicate chart: ${error.message}`);
                }
            } else {
                // Legacy localStorage chart
                const duplicated = storage.duplicateChart(chartId);
                if (duplicated) {
                    this.renderCharts();
                    window.toast.success('Chart duplicated successfully!');
                } else {
                    window.toast.error('Failed to duplicate chart');
                }
            }
        }
    }

    /**
     * Delete chart (via API for cloud charts, localStorage for local charts)
     */
    async deleteChart(chartId) {
        console.log('ðŸ—‘ï¸ deleteChart called with chartId:', chartId);

        // Verify toast system is available
        if (!window.toast || !window.toast.confirm) {
            console.error('âŒ Toast system not available - using fallback');
            const fallback = window.confirm('Toast system not loaded. Delete anyway?');
            if (!fallback) {
                console.log('User cancelled deletion (fallback)');
                return;
            }
        }

        // Check if this is a UUID (API chart) or local chart
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isApiChart = uuidRegex.test(chartId);

        // Get chart name from the rendered card for confirmation
        const card = document.querySelector(`[data-chart-id="${chartId}"]`);
        const chartName = card?.querySelector('.chart-card-title')?.textContent || 'this chart';

        console.log(`ðŸ“‹ Deleting ${isApiChart ? 'API' : 'local'} chart:`, chartName);

        // Add loading state to card
        this.setCardLoadingState(chartId, true);

        // Confirm deletion
        let confirmed = false;
        try {
            const message = isApiChart
                ? `Are you sure you want to delete "${chartName}"?\n\nThis chart will be soft-deleted and can be recovered within 90 days.`
                : `Are you sure you want to delete "${chartName}"?\n\nThis is a local chart and will be permanently deleted.`;

            confirmed = await window.toast.confirm({
                message: message,
                title: 'Delete Chart',
                confirmText: 'Delete',
                cancelText: 'Cancel'
            });
        } catch (error) {
            console.error('âŒ Confirmation dialog error:', error);
            confirmed = window.confirm(`Delete "${chartName}"?`);
        }

        console.log('User confirmed deletion:', confirmed);

        if (!confirmed) {
            // Remove loading state
            this.setCardLoadingState(chartId, false);
            return;
        }

        // Backend (API) deletion path (no undo)
        if (isApiChart && window.apiClient) {
            try {
                await window.apiClient.deleteChart(chartId);

                // Remove loading state
                this.setCardLoadingState(chartId, false);

                // Refresh list (undo not supported for API deletes)
                await this.renderCharts();

                window.toast?.success('Chart deleted successfully.');
                return;
            } catch (error) {
                console.error('Deletion failed:', error);

                this.setCardLoadingState(chartId, false);

                if (error.message === 'Unauthorized') {
                    // Already redirected by apiClient
                    return;
                }

                if (error.message.includes('403') || error.message.includes('Forbidden')) {
                    window.toast?.error("You don't have permission to delete this chart");
                } else if (error.message.includes('404') || error.message.includes('not found')) {
                    window.toast?.error('Chart not found. It may have already been deleted.');
                } else {
                    window.toast?.error(`Failed to delete chart: ${error.message}`);
                }
                return;
            }
        }

        // Local (legacy) deletion path with undo
        const chart = storage.getChart(chartId);
        if (!chart) {
            console.error(`Chart not found: ${chartId}`);
            window.toast?.error('Chart not found. It may have already been deleted.');
            this.setCardLoadingState(chartId, false);
            return;
        }

        // Store deleted chart for undo (deep copy to avoid reference issues)
        const chartBackup = JSON.parse(JSON.stringify(chart));

        let deleteSuccess = false;
        try {
            deleteSuccess = storage.deleteChart(chartId);
            console.log('Local storage deletion successful');
        } catch (error) {
            console.error('Storage deletion failed:', error);
            this.setCardLoadingState(chartId, false);
            window.toast?.error(`Failed to delete chart: ${error.message}. Try refreshing the page.`);
            return;
        }

        if (deleteSuccess) {
            console.log('Deletion successful');

            // Remove loading state
            this.setCardLoadingState(chartId, false);

            // Add to undo stack
            this.deletedCharts.push({
                chart: chartBackup,
                timestamp: Date.now()
            });

            // Re-render
            this.renderCharts();

            // Show success with undo option
            this.showUndoNotification(chartBackup);

            // Auto-clear undo after 10 seconds
            if (this.undoTimeout) {
                clearTimeout(this.undoTimeout);
            }
            this.undoTimeout = setTimeout(() => {
                this.clearUndoStack();
            }, 10000);

        } else {
            console.error(`storage.deleteChart returned false for chartId: ${chartId}`);

            // Remove loading state
            this.setCardLoadingState(chartId, false);

            // Check if chart still exists
            const stillExists = storage.getChart(chartId);
            const errorMsg = stillExists
                ? 'Failed to delete chart. Storage error occurred.'
                : 'Deletion status unclear. Chart may have been deleted.';

            // Show inline error on card
            this.showCardError(chartId, errorMsg);

            // Also show toast
            if (window.toast) {
                window.toast.error(errorMsg + ' Check console for details.');
            } else {
                alert(errorMsg);
            }

            // Suggest refresh after delay
            setTimeout(() => {
                const shouldRefresh = window.confirm(
                    'Storage may be in an inconsistent state. Refresh the page to see current state?'
                );
                if (shouldRefresh) {
                    window.location.reload();
                }
            }, 2000);
        }

    }

    /**
     * Show undo notification with custom toast or banner
     */
    showUndoNotification(deletedChart) {
        // Create custom undo banner
        const banner = document.createElement('div');
        banner.id = 'undoBanner';
        banner.className = 'undo-banner';
        banner.innerHTML = `
            <div class="undo-banner-content">
                <span class="undo-banner-message">
                    <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <polyline points="1 4 1 10 7 10"></polyline>
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                    </svg>
                    Chart "${this.escapeHtml(deletedChart.chartName)}" deleted
                </span>
                <button class="btn btn-sm btn-ghost" onclick="app.undoDelete()">
                    Undo
                </button>
                <button class="btn btn-sm btn-ghost" onclick="app.dismissUndoBanner()">
                    Ã—
                </button>
            </div>
        `;

        // Remove existing banner if present
        const existing = document.getElementById('undoBanner');
        if (existing) {
            existing.remove();
        }

        // Add banner to page
        document.body.appendChild(banner);

        // Fade in animation
        requestAnimationFrame(() => {
            banner.style.opacity = '1';
            banner.style.transform = 'translateY(0)';
        });
    }

    /**
     * Undo the last delete operation
     */
    undoDelete() {
        if (this.deletedCharts.length === 0) {
            window.toast.warning('Nothing to undo');
            return;
        }

        // Get most recent deletion
        const deletion = this.deletedCharts.pop();
        const chart = deletion.chart;

        // Restore chart to storage
        try {
            // Use storage internal method or re-create
            const charts = JSON.parse(localStorage.getItem('orgCharts') || '{}');
            charts[chart.chartId] = chart;
            localStorage.setItem('orgCharts', JSON.stringify(charts));

            // Re-render
            this.renderCharts();

            // Show success
            window.toast.success(`Chart "${chart.chartName}" restored`);

            // Dismiss undo banner
            this.dismissUndoBanner();

            // Clear timeout
            if (this.undoTimeout) {
                clearTimeout(this.undoTimeout);
            }

        } catch (error) {
            console.error('Failed to restore chart:', error);
            window.toast.error(`Failed to restore chart: ${error.message}`);

            // Put it back on the stack
            this.deletedCharts.push(deletion);
        }
    }

    /**
     * Dismiss undo banner
     */
    dismissUndoBanner() {
        const banner = document.getElementById('undoBanner');
        if (banner) {
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(-20px)';
            setTimeout(() => banner.remove(), 300);
        }
    }

    /**
     * Clear undo stack (called after timeout)
     */
    clearUndoStack() {
        this.deletedCharts = [];
        this.dismissUndoBanner();
    }

    /**
     * Set loading state on a chart card
     * @param {string} chartId - The chart ID
     * @param {boolean} loading - Whether to show loading state
     */
    setCardLoadingState(chartId, loading) {
        const card = document.querySelector(`[data-chart-id="${this.escapeHtml(chartId)}"]`);
        if (!card) {
            console.warn(`Card not found for chartId: ${chartId}`);
            return;
        }

        if (loading) {
            card.classList.add('card-loading');
            card.setAttribute('aria-busy', 'true');

            // Disable action buttons
            const buttons = card.querySelectorAll('button[data-action]');
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
            });
        } else {
            card.classList.remove('card-loading');
            card.removeAttribute('aria-busy');

            // Re-enable action buttons
            const buttons = card.querySelectorAll('button[data-action]');
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.removeAttribute('aria-disabled');
            });
        }
    }

    /**
     * Show inline error on a chart card
     * @param {string} chartId - The chart ID
     * @param {string} errorMessage - The error message to display
     */
    showCardError(chartId, errorMessage) {
        const card = document.querySelector(`[data-chart-id="${this.escapeHtml(chartId)}"]`);
        if (!card) {
            console.warn(`Card not found for chartId: ${chartId}`);
            return;
        }

        // Remove any existing error
        const existingError = card.querySelector('.card-error');
        if (existingError) {
            existingError.remove();
        }

        // Create error element
        const errorEl = document.createElement('div');
        errorEl.className = 'card-error';
        errorEl.setAttribute('role', 'alert');
        errorEl.innerHTML = `
            <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>${this.escapeHtml(errorMessage)}</span>
            <button class="card-error-dismiss" onclick="this.parentElement.remove()" aria-label="Dismiss error">
                Ã—
            </button>
        `;

        // Insert error at top of card
        card.insertBefore(errorEl, card.firstChild);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (errorEl.parentNode) {
                errorEl.remove();
            }
        }, 5000);
    }

    /**
     * Request access to a chart
     */
    async requestAccess(chartId) {
        if (!window.apiClient?.isUserAuthenticated()) {
            // Redirect to login if not authenticated
            window.apiClient.login();
            return;
        }

        try {
            // Send minimal payload (role only, no reason)
            const result = await window.apiClient.requestAccess(chartId, 'editor');

            if (result.success) {
                const message = result.isUpdate
                    ? 'Your pending access request has been updated. The chart owner will be notified.'
                    : 'Access request submitted successfully. The chart owner will be notified.';
                window.toast?.success(message);
            } else {
                window.toast?.error(result.message || 'Failed to submit access request');
            }
        } catch (error) {
            console.error('Error requesting access:', error);

            // Handle 409 Conflict gracefully
            if (error.message && (error.message.includes('409') || error.message.includes('already have a pending'))) {
                window.toast?.info('You already have a pending access request for this chart. Please wait for the owner to review it.');
                return;
            }

            window.toast?.error('Failed to submit access request: ' + error.message);
        }
    }

    /**
     * Export all data as backup
     */
    exportAllData() {
        const data = storage.exportAllData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `org-charts-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Initialize bulk export manager
     */
    initializeBulkExport() {
        if (typeof BulkExportManager !== 'undefined') {
            this.bulkExportManager = new BulkExportManager(storage);
            window.bulkExportManager = this.bulkExportManager;
        } else {
            console.warn('BulkExportManager not loaded');
        }
    }

    /**
     * Lazy load export dependencies (d3, jsPDF, html2canvas, etc.)
     * Only loads once, then caches for subsequent exports
     */
    async loadExportDependencies() {
        // If already loaded, skip
        if (this.exportDependenciesLoaded) {
            return true;
        }

        // Show loading overlay
        this.showLoadingOverlay('Loading export libraries...');

        try {
            // Define all dependencies in order
            // Add cache-busting timestamp for local files
            const cacheBuster = `?v=${Date.now()}`;
            const dependencies = [
                { url: `vendor/d3.v7.min.js${cacheBuster}`, check: () => typeof d3 !== 'undefined' },
                { url: `vendor/d3-flextree.js${cacheBuster}`, check: () => typeof d3.flextree !== 'undefined' },
                { url: `vendor/html2canvas.min.js${cacheBuster}`, check: () => typeof html2canvas !== 'undefined' },
                { url: `vendor/jspdf.umd.min.js${cacheBuster}`, check: () => typeof window.jspdf !== 'undefined' },
                { url: `assets/export/svg2pdf.min.js${cacheBuster}`, check: () => typeof window.svg2pdf !== 'undefined' },
                { url: `js/d3-org-chart.js${cacheBuster}`, check: () => typeof d3 !== 'undefined' && typeof d3.OrgChart !== 'undefined' },
                { url: `js/export-template.js${cacheBuster}`, check: () => typeof ExportTemplate !== 'undefined' },
                { url: `js/bulk-export.js${cacheBuster}`, check: () => typeof BulkExportManager !== 'undefined' }
            ];

            // Load each dependency sequentially
            for (const dep of dependencies) {
                await this.loadScript(dep.url, dep.check);
            }

            // Initialize the bulk export manager now that dependencies are loaded
            this.initializeBulkExport();

            this.exportDependenciesLoaded = true;
            this.hideLoadingOverlay();
            return true;

        } catch (error) {
            this.hideLoadingOverlay();
            console.error('Failed to load export dependencies:', error);
            window.toast.error(`Failed to load export libraries: ${error.message}. Please check your internet connection and try again.`);
            return false;
        }
    }

    /**
     * Load a single script dynamically
     */
    loadScript(url, checkFunction) {
        return new Promise((resolve, reject) => {
            // Check if already loaded by checking the global object
            if (checkFunction && checkFunction()) {
                console.log(`[Dashboard] Script already loaded: ${url}`);
                resolve();
                return;
            }

            // Check if script tag already exists in DOM
            const baseUrl = url.split('?')[0]; // Remove query params for comparison
            const existingScript = Array.from(document.querySelectorAll('script')).find(s =>
                s.src && (s.src.includes(baseUrl) || s.src === url)
            );

            if (existingScript) {
                console.log(`[Dashboard] Script tag already exists for: ${url}`);
                // Script tag exists but check failed - might be loading
                // Wait for it to load
                setTimeout(() => {
                    if (checkFunction && checkFunction()) {
                        resolve();
                    } else {
                        reject(new Error(`Script tag exists but check still fails: ${url}`));
                    }
                }, 500);
                return;
            }

            console.log(`[Dashboard] Loading script: ${url}`);
            const script = document.createElement('script');
            script.src = url;
            script.async = false; // Load in order

            script.onload = () => {
                // Wait a bit for the script to initialize
                setTimeout(() => {
                    if (checkFunction && !checkFunction()) {
                        reject(new Error(`Script loaded but check failed: ${url}`));
                    } else {
                        console.log(`[Dashboard] Successfully loaded: ${url}`);
                        resolve();
                    }
                }, 100);
            };

            script.onerror = () => {
                reject(new Error(`Failed to load script: ${url}`));
            };

            document.head.appendChild(script);
        });
    }

    /**
     * Show loading overlay with message
     */
    showLoadingOverlay(message) {
        let overlay = document.getElementById('loadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                color: white;
                font-size: 18px;
                font-weight: 600;
            `;
            document.body.appendChild(overlay);
        }
        overlay.textContent = message;
        overlay.style.display = 'flex';
    }

    /**
     * Hide loading overlay
     */
    hideLoadingOverlay() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Export all charts to PDF
     */
    async exportAllChartsToPDF() {
        if (this.apiUnavailable) {
            window.toast?.warning('Export unavailable while the chart server is offline.');
            return;
        }
        await this.showExportPreflight();
    }

    async showExportPreflight() {
        const chartCount = await this.getExportChartCount();
        if (!chartCount) {
            window.toast?.warning('No charts available to export');
            return;
        }

        const recommendedQuality = this.getRecommendedExportQuality(chartCount);
        this.exportPreflightState = {
            chartCount,
            recommendedQuality,
            selectedQuality: recommendedQuality
        };

        const options = document.getElementById('exportPreflightOptions');
        const qualitySelect = document.getElementById('exportPreflightQuality');
        const customizeBtn = document.getElementById('exportPreflightCustomize');
        const confirmBtn = document.getElementById('exportPreflightConfirm');

        if (options) {
            options.classList.add('hidden');
        }
        if (qualitySelect) {
            qualitySelect.value = recommendedQuality;
        }
        if (customizeBtn) {
            customizeBtn.textContent = 'Choose Quality...';
        }
        if (confirmBtn) {
            confirmBtn.textContent = 'Export (Recommended)';
        }

        this.updateExportPreflightSummary(recommendedQuality);
        this.showExportPreflightModal();
    }

    showExportPreflightModal() {
        const modal = document.getElementById('exportPreflightModal');
        if (!modal) {
            return;
        }
        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    closeExportPreflight() {
        const modal = document.getElementById('exportPreflightModal');
        if (!modal) {
            return;
        }
        modal.classList.remove('active');
        modal.style.display = 'none';
        this.exportPreflightState = null;
    }

    toggleExportPreflightOptions() {
        const options = document.getElementById('exportPreflightOptions');
        const confirmBtn = document.getElementById('exportPreflightConfirm');
        const customizeBtn = document.getElementById('exportPreflightCustomize');
        const qualitySelect = document.getElementById('exportPreflightQuality');

        if (!options) {
            return;
        }

        const willShow = options.classList.contains('hidden');
        options.classList.toggle('hidden', !willShow);

        if (confirmBtn) {
            confirmBtn.textContent = willShow ? 'Export' : 'Export (Recommended)';
        }
        if (customizeBtn) {
            customizeBtn.textContent = willShow ? 'Use Recommended' : 'Choose Quality...';
        }

        if (!willShow && this.exportPreflightState) {
            const recommendedQuality = this.exportPreflightState.recommendedQuality;
            this.exportPreflightState.selectedQuality = recommendedQuality;
            if (qualitySelect) {
                qualitySelect.value = recommendedQuality;
            }
            this.updateExportPreflightSummary(recommendedQuality);
        }
    }

    updateExportPreflightQuality(quality) {
        if (!this.exportPreflightState) {
            return;
        }
        this.exportPreflightState.selectedQuality = quality;
        this.updateExportPreflightSummary(quality);
    }

    updateExportPreflightSummary(quality) {
        if (!this.exportPreflightState) {
            return;
        }

        const chartCount = this.exportPreflightState.chartCount;
        const countEl = document.getElementById('exportPreflightCount');
        const sizeEl = document.getElementById('exportPreflightSize');
        const recEl = document.getElementById('exportPreflightRecommendation');
        const warnEl = document.getElementById('exportPreflightWarning');

        if (countEl) {
            countEl.textContent = chartCount;
        }
        if (recEl) {
            recEl.textContent = this.getQualityLabel(this.exportPreflightState.recommendedQuality);
        }

        const estimate = this.getExportSizeEstimate(chartCount, quality);
        if (sizeEl) {
            sizeEl.textContent = estimate.label;
        }
        if (warnEl) {
            warnEl.textContent = estimate.warning;
        }
    }

    getQualityLabel(quality) {
        if (!quality) return '';
        return quality.charAt(0).toUpperCase() + quality.slice(1);
    }

    getRecommendedExportQuality(chartCount) {
        if (chartCount >= 30) {
            return 'medium';
        }
        if (chartCount >= 15) {
            return 'medium';
        }
        return 'high';
    }

    getExportSizeEstimate(chartCount, quality) {
        const perChartMb = {
            low: 1.5,
            medium: 3,
            high: 6,
            print: 12
        };

        const estimateMb = Math.round((perChartMb[quality] || 3) * chartCount);
        let label = 'Medium';
        if (estimateMb <= 25) {
            label = `Small (~${estimateMb} MB)`;
        } else if (estimateMb <= 80) {
            label = `Medium (~${estimateMb} MB)`;
        } else if (estimateMb <= 160) {
            label = `Large (~${estimateMb} MB)`;
        } else {
            label = `Very large (~${estimateMb} MB)`;
        }

        let warning = '';
        if (chartCount >= 20 && (quality === 'high' || quality === 'print')) {
            warning = 'High quality may fail on large exports. Balanced is safer.';
        } else if (chartCount >= 30) {
            warning = 'Large export detected. Balanced quality is recommended for reliability.';
        }

        return { label, warning };
    }

    async getExportChartCount() {
        if (window.apiClient) {
            try {
                const response = await window.apiClient.getCharts({ limit: 1, offset: 0, includeData: false });
                if (Array.isArray(response)) {
                    return response.length;
                }
                if (response?.pagination?.total !== undefined) {
                    return response.pagination.total;
                }
                if (Array.isArray(response?.charts)) {
                    return response.charts.length;
                }
            } catch (error) {
                console.warn('[Dashboard] Failed to fetch chart count for export preflight:', error);
            }
        }

        if (Array.isArray(this.cachedCharts) && this.cachedCharts.length > 0) {
            return this.cachedCharts.length;
        }

        return storage.getChartsArray().length;
    }

    async confirmExportPreflight() {
        if (!this.exportPreflightState) {
            return;
        }

        const quality = this.exportPreflightState.selectedQuality || this.exportPreflightState.recommendedQuality;
        this.closeExportPreflight();

        await this.startExportWithQuality(quality);
    }

    async startExportWithQuality(quality = 'medium') {
        // Lazy load dependencies first
        const loaded = await this.loadExportDependencies();
        if (!loaded) {
            return; // Loading failed, error already shown
        }

        if (!this.bulkExportManager) {
            window.toast.error('Export manager not initialized');
            return;
        }

        // Get charts from the same source that bulk export will use
        let charts;
        try {
            charts = await this.bulkExportManager.fetchAllCharts();
            console.log(`[Dashboard] Export modal using ${charts.length} charts from bulk export data source`);
        } catch (error) {
            console.warn('[Dashboard] Failed to fetch charts from bulk export, falling back to localStorage:', error);
            charts = storage.getChartsArray();
        }

        if (charts.length === 0) {
            window.toast.warning('No charts available to export');
            return;
        }

        try {
            await this.bulkExportManager.exportAllCharts(quality);
        } catch (error) {
            console.error('Bulk export failed:', error);
            window.toast.error(`Export failed: ${error.message}`);
        }
    }

    /**
     * Debug: Preview a single chart's SVG export
     * Usage: app.debugPreviewChart('chart-id')
     */
    async debugPreviewChart(chartId) {
        // Lazy load dependencies first
        const loaded = await this.loadExportDependencies();
        if (!loaded) {
            return;
        }

        if (!this.bulkExportManager) {
            window.toast.error('Export manager not initialized');
            return;
        }

        try {
            await this.bulkExportManager.debugPreviewChart(chartId);
        } catch (error) {
            console.error('Preview failed:', error);
        }
    }

    /**
     * Debug: List all available charts
     * Usage: app.debugListCharts()
     */
    async debugListCharts() {
        // Lazy load dependencies first
        const loaded = await this.loadExportDependencies();
        if (!loaded) {
            return;
        }

        if (!this.bulkExportManager) {
            window.toast.error('Export manager not initialized');
            return;
        }

        try {
            const charts = await this.bulkExportManager.debugListCharts();
            console.log('\nðŸ“Š To preview a chart, use:');
            console.log('app.debugPreviewChart("chart-id")\n');
            return charts;
        } catch (error) {
            console.error('List charts failed:', error);
        }
    }
}

// Initialize app when DOM is loaded
let app;

console.log('[Dashboard] Script loaded at', new Date().toISOString());

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Dashboard] DOMContentLoaded event fired');

    try {
        app = new DashboardApp();
        console.log('[Dashboard] App initialized successfully');

        // Make app globally accessible
        window.app = app;
        console.log('[Dashboard] App attached to window.app');

        // Show debug commands in console
        console.log('%cðŸ“Š Org Chart Dashboard', 'font-size: 16px; font-weight: bold; color: #2563eb;');
        console.log('%cDebug Commands Available:', 'font-weight: bold; margin-top: 10px;');
        console.log('  %capp.debugListCharts()%c        - List all available charts', 'color: #10b981; font-family: monospace;', 'color: inherit;');
        console.log('  %capp.debugPreviewChart(id)%c   - Preview a single chart SVG export', 'color: #10b981; font-family: monospace;', 'color: inherit;');
        console.log('\n%cExample:', 'font-weight: bold;');
        console.log('  %capp.debugListCharts()%c to see available charts', 'color: #f59e0b; font-family: monospace;', 'color: inherit;');
        console.log('  %capp.debugPreviewChart("your-chart-id")%c to test export styling\n', 'color: #f59e0b; font-family: monospace;', 'color: inherit;');
    } catch (error) {
        console.error('[Dashboard] Failed to initialize app:', error);
        throw error;
    }
});


