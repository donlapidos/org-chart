/**
 * Chart Editor Application Logic
 * Handles chart editing, node management, and d3-org-chart integration
 */

(function ensureGlobalToast() {
    if (typeof window === 'undefined') return;
    if (window.toast) return;

    console.warn('[ChartEditor] Global toast not found. Installing fallback.');
    window.toast = {
        success: (msg) => alert(`Success: ${msg}`),
        error: (msg) => alert(`Error: ${msg}`),
        warning: (msg) => alert(`Warning: ${msg}`),
        info: (msg) => alert(`Info: ${msg}`),
        confirm: ({ message, title = 'Confirm' }) =>
            Promise.resolve(window.confirm(`${title}\n\n${message}`))
    };
})();

class ChartEditor {
    constructor() {
        this.chartId = null;
        this.chart = null;
        this.chartData = null;
        this.orgChart = null;
        this.editingNodeId = null;
        this.autoSaveTimer = null;
        this.draftMembers = []; // Draft state for node editing (new or existing)

        // Permission fields from API
        this.isReadOnly = false;
        this.userRole = null;
        this.canEdit = true;
        this.isOwner = false;

        this.init();
    }

    /**
     * Ensure hierarchy always has exactly one root and no dangling parents
     * @param {Object} options
     * @param {boolean} options.persist - whether to save fixes immediately
     */
    repairHierarchy({ persist = false } = {}) {
        if (!this.chartData || !Array.isArray(this.chartData.nodes) || this.chartData.nodes.length === 0) {
            return;
        }

        const nodes = this.chartData.nodes;
        const idToNode = new Map(nodes.map(node => [node.id, node]));
        let changed = false;

        nodes.forEach(node => {
            if (node.parentId === '') {
                node.parentId = null;
                changed = true;
            }
            if (node.parentId && (!idToNode.has(node.parentId) || node.parentId === node.id)) {
                node.parentId = null;
                changed = true;
            }
        });

        let roots = nodes.filter(node => !node.parentId);
        if (roots.length === 0) {
            nodes[0].parentId = null;
            roots = [nodes[0]];
            changed = true;
        }

        const canonicalRootId = roots[0].id;
        if (roots.length > 1) {
            roots.slice(1).forEach(node => {
                node.parentId = canonicalRootId;
                changed = true;
            });
        }

        if (changed) {
            console.warn('Org chart hierarchy contained invalid references and was automatically corrected.');
            if (persist && this.chartId) {
                const updated = storage.updateChart(this.chartId, { nodes });
                if (updated) {
                    this.chartData = updated;
                }
            }
        }
    }

    /**
     * Collect descendant ids for a node to avoid cycles
     * @param {string} nodeId
     * @returns {Set<string>}
     */
    getDescendantIds(nodeId) {
        const descendants = new Set();
        if (!nodeId || !this.chartData || !Array.isArray(this.chartData.nodes)) {
            return descendants;
        }

        const childrenMap = this.chartData.nodes.reduce((map, node) => {
            if (node.parentId) {
                if (!map[node.parentId]) {
                    map[node.parentId] = [];
                }
                map[node.parentId].push(node.id);
            }
            return map;
        }, {});

        const stack = [...(childrenMap[nodeId] || [])];
        while (stack.length) {
            const current = stack.pop();
            if (descendants.has(current)) {
                continue;
            }
            descendants.add(current);
            const kids = childrenMap[current];
            if (kids) {
                kids.forEach(childId => {
                    if (!descendants.has(childId)) {
                        stack.push(childId);
                    }
                });
            }
        }

        return descendants;
    }

    /**
     * Initialize the editor
     */
    async init() {
        this.ensureToastSystem();
        // Get chart ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        const chartId = urlParams.get('id');

        if (!chartId) {
            let cachedId = null;
            try {
                cachedId = sessionStorage.getItem('lastChartId');
            } catch (error) {
                cachedId = null;
            }

            if (cachedId) {
                let recoveryAttempted = false;
                try {
                    recoveryAttempted = sessionStorage.getItem('chartIdRecoveryAttempted') === 'true';
                } catch (error) {
                    recoveryAttempted = false;
                }

                if (!recoveryAttempted) {
                    try {
                        sessionStorage.setItem('chartIdRecoveryAttempted', 'true');
                    } catch (error) {
                        // Ignore storage errors
                    }

                    const url = new URL(window.location.href);
                    url.searchParams.set('id', cachedId);
                    window.location.replace(url.toString());
                    return;
                }
            }

            try {
                sessionStorage.removeItem('chartIdRecoveryAttempted');
            } catch (error) {
                // Ignore storage errors
            }

            window.toast.error('No chart ID provided');
            window.location.href = 'index.html';
            return;
        }

        this.chartId = chartId;
        try {
            sessionStorage.setItem('lastChartId', this.chartId);
            sessionStorage.removeItem('chartIdRecoveryAttempted');
        } catch (error) {
            // Ignore storage errors
        }

        // Load chart data from API
        await this.loadChart();

        // Initialize auto-save (only if editable)
        if (!this.isReadOnly) {
            this.setupAutoSave();
        }
    }

    ensureToastSystem() {
        if (typeof window.toast === 'undefined') {
            console.warn('[ChartEditor] Toast system not found. Installing fallback.');
            window.toast = {
                success: (msg) => alert(`Success: ${msg}`),
                error: (msg) => alert(`Error: ${msg}`),
                warning: (msg) => alert(`Warning: ${msg}`),
                info: (msg) => alert(`Info: ${msg}`),
                confirm: ({ message, title = 'Confirm' }) => Promise.resolve(window.confirm(`${title}\n\n${message}`))
            };
        }
    }

    /**
     * Load chart from backend API
     */
    async loadChart() {
        try {
            // Show loading state
            const saveStatus = document.getElementById('saveStatus');
            if (saveStatus) {
                saveStatus.textContent = 'Loading chart...';
                saveStatus.className = 'save-status saving';
            }

            // Fetch chart from backend
            const response = await window.apiClient.getChart(this.chartId);

            if (!response || !response.chart) {
                window.toast.error('Chart not found');
                window.location.href = 'index.html';
                return;
            }

            // Unpack the API response structure
            const chartDoc = response.chart;
            const data = chartDoc.data || {};

            // Store chart metadata (id, ownerId, name) separately
            this.chartMeta = {
                id: chartDoc.id,
                ownerId: chartDoc.ownerId,
                name: chartDoc.name
            };

            // Store chart data (the actual chart content)
            this.chartData = {
                chartName: chartDoc.name || data.chartName || 'Untitled Chart',
                description: data.description || '',
                departmentTag: data.departmentTag || '',
                coverId: data.coverId || null, // Stable cover ID for export matching
                coverOrderIndex: data.coverOrderIndex ?? null, // Order within cover group
                exportOrder: data.exportOrder ?? null, // Optional explicit export order (deprecated)
                layout: data.layout || 'top',
                nodes: Array.isArray(data.nodes) ? data.nodes : [],
                connections: data.connections || [],
                viewState: data.viewState || {}
            };

            // No auto-assignment: coverId must be explicitly set by user via settings modal
            // This prevents mis-grouping on autosave

            // Derive permission fields from userRole (defensive approach)
            const role = (response.userRole || '').toLowerCase();
            this.userRole = role || null;

            // Determine ownership and editing capability from role
            this.isOwner = role === 'owner';
            this.canEdit = role === 'owner' || role === 'editor';
            this.isReadOnly = role === 'viewer';

            // If backend explicitly provides isReadOnly, use that as override
            if (response.isReadOnly !== undefined) {
                this.isReadOnly = response.isReadOnly === true;
            }

            // Log permission state for debugging
            console.log('[ChartEditor] Permissions:', {
                userRole: this.userRole,
                isOwner: this.isOwner,
                canEdit: this.canEdit,
                isReadOnly: this.isReadOnly
            });

            // Guard: Check if nodes array is empty
            if (this.chartData.nodes.length === 0) {
                window.toast.warning('This chart has no nodes. Add a node to get started.');
                // Continue loading - user can add nodes
            }

            // Ensure stored hierarchy is valid (auto-heal if needed)
            if (this.chartData.nodes.length > 0) {
                this.repairHierarchy({ persist: false }); // Don't persist immediately on load
            }

            // Update UI with chart name from metadata (authoritative source)
            document.getElementById('chartTitle').textContent = this.chartMeta.name;
            document.title = `${this.chartMeta.name} - Chart Editor`;

            // Set layout
            if (this.chartData.layout) {
                document.getElementById('layoutSelect').value = this.chartData.layout;
            }

            // Update UI based on permissions
            this.updateEditingUIState();

            // Initialize org chart (only if we have nodes)
            if (this.chartData.nodes.length > 0) {
                this.initOrgChart();
            } else {
                // Show empty state message in chartCanvas
                const chartContainer = document.getElementById('chartCanvas');
                if (chartContainer) {
                    chartContainer.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 400px; color: #666;">
                            <svg style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.3;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="9" y1="9" x2="15" y2="9"></line>
                                <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">No nodes in this chart</h3>
                            <p style="margin: 0; font-size: 14px;">Click "Add Node" to create the first node.</p>
                        </div>
                    `;
                }
            }

            // Update save status
            if (saveStatus) {
                saveStatus.textContent = this.isReadOnly ? 'Read-only mode' : 'All changes saved';
                saveStatus.className = this.isReadOnly ? 'save-status' : 'save-status saved';
            }

        } catch (error) {
            console.error('Failed to load chart:', error);

            // Handle specific error cases
            if (error.message === 'Unauthorized') {
                // Already redirected by apiClient
                return;
            }

            if (error.message.includes('403') || error.message.includes('Forbidden')) {
                window.toast.error('You don\'t have permission to access this chart');
                setTimeout(() => window.location.href = 'index.html', 2000);
                return;
            }

            if (error.message.includes('404') || error.message.includes('not found')) {
                window.toast.error('Chart not found');
                setTimeout(() => window.location.href = 'index.html', 2000);
                return;
            }

            // Generic error
            window.toast.error(`Failed to load chart: ${error.message}`);
            setTimeout(() => window.location.href = 'index.html', 2000);
        }
    }

    /**
     * Update UI state based on editing permissions
     */
    updateEditingUIState() {
        const readonly = this.isReadOnly || !this.canEdit;

        // Disable/enable all editing controls
        const controls = [
            'addNodeBtn',
            'saveBtn',
            'settingsBtn'
            // Note: shareBtn and deleteBtn not yet implemented in HTML
        ];

        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                if (readonly) {
                    element.disabled = true;
                    element.style.opacity = '0.5';
                    element.style.cursor = 'not-allowed';
                    element.title = 'You don\'t have permission to edit this chart';
                } else {
                    element.disabled = false;
                    element.style.opacity = '';
                    element.style.cursor = '';
                    element.title = '';
                }
            }
        });

        // Disable layout select for viewers
        const layoutSelect = document.getElementById('layoutSelect');
        if (layoutSelect) {
            layoutSelect.disabled = readonly;
        }

        // Show read-only banner if applicable
        if (readonly) {
            this.showReadOnlyBanner();
        }

        // Disable node clicking for editing if read-only
        if (readonly) {
            this.isReadOnlyMode = true;
        }
    }

    /**
     * Show read-only banner
     */
    showReadOnlyBanner() {
        // Check if banner already exists
        if (document.getElementById('readOnlyBanner')) {
            return;
        }

        const banner = document.createElement('div');
        banner.id = 'readOnlyBanner';
        banner.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: #fff3cd;
            color: #856404;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const icon = document.createElement('span');
        icon.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
        `;

        const text = document.createElement('span');
        text.textContent = this.userRole === 'VIEWER'
            ? 'Viewing in read-only mode'
            : 'You have read-only access to this chart';

        banner.appendChild(icon);
        banner.appendChild(text);
        document.body.appendChild(banner);

        // Auto-hide after 5 seconds
        setTimeout(() => {
            banner.style.transition = 'opacity 0.3s';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 300);
        }, 5000);
    }

    /**
     * Initialize d3-org-chart
     */
    initOrgChart() {
        const self = this;

        // Clear any empty state message before rendering
        const chartCanvas = document.getElementById('chartCanvas');
        if (chartCanvas) {
            chartCanvas.innerHTML = '';
        }

        // Transform data for d3-org-chart format
        const chartNodes = this.chartData.nodes.map(node => ({
            id: node.id,
            parentId: node.parentId || '',
            members: node.members || [],
            meta: node.meta || {},
            _expanded: true,
            // Legacy fields for backward compatibility
            name: node.name,
            title: node.title,
            department: node.department || (node.meta && node.meta.department)
        }));

        // Create org chart instance
        this.orgChart = new d3.OrgChart()
            .container('#chartCanvas')
            .data(chartNodes)
            .nodeWidth(() => 250)
            .nodeHeight((d) => {
                const node = d.data || d;
                return OrgNodeRenderer.calculateNodeHeight(node);
            })
            .childrenMargin(() => 80)
            .compactMarginBetween(() => 25)
            .compactMarginPair(() => 100)
            .compact(false)
            .layout(this.chartData.layout || 'top')
            .onNodeClick((d) => {
                // Only allow editing if not in read-only mode
                if (!self.isReadOnly && self.canEdit) {
                    self.editNode(d.data.id);
                } else {
                    window.toast.info('This chart is read-only. You cannot make changes.');
                }
            })
            .nodeContent((d) => OrgNodeRenderer.renderNodeContent(d))
            .render();
    }

    /**
     * Setup auto-save functionality
     */
    setupAutoSave() {
        // Auto-save every 30 seconds
        this.autoSaveTimer = setInterval(() => {
            this.saveChart(false);
        }, 30000);
    }

    /**
     * Save chart to backend API
     */
    async saveChart(showNotification = true) {
        if (!this.chartData) return;

        // Check if read-only
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot save: You have read-only access to this chart');
            return;
        }

        // Update save status
        const saveStatus = document.getElementById('saveStatus');
        if (saveStatus) {
            saveStatus.textContent = 'Saving...';
            saveStatus.className = 'save-status saving';
        }

        // Get current chart data from d3-org-chart
        if (this.orgChart) {
            const currentData = this.orgChart.data();
            this.chartData.nodes = currentData.map(node => {
                // Preserve the existing node structure (already has members or migrated)
                const existingNode = this.chartData.nodes.find(n => n.id === node.id);
                if (existingNode) {
                    // Keep existing node data (members structure intact)
                    return {
                        ...existingNode,
                        parentId: node.parentId || null
                    };
                }
                // Shouldn't happen, but fallback
                return node;
            });
        }

        try {
            // Save to backend API
            // Use chartMeta.name as authoritative source, fallback to chartData.chartName
            const chartName = this.chartMeta?.name || this.chartData.chartName;
            await window.apiClient.updateChart(
                this.chartId,
                chartName,
                this.chartData
            );

            // Update save status
            if (saveStatus) {
                saveStatus.textContent = 'All changes saved';
                saveStatus.className = 'save-status saved';
            }

            if (showNotification) {
                window.toast.success('Chart saved successfully!');
            }

        } catch (error) {
            console.error('Failed to save chart:', error);

            // Update save status
            if (saveStatus) {
                saveStatus.textContent = 'Save failed';
                saveStatus.className = 'save-status error';
            }

            // Handle specific errors
            if (error.message.includes('403') || error.message.includes('Forbidden')) {
                window.toast.error('You don\'t have permission to edit this chart');
            } else if (error.message === 'Unauthorized') {
                // Already redirected by apiClient
            } else {
                window.toast.error(`Failed to save chart: ${error.message}`);
            }
        }
    }

    /**
     * Show add node sidebar
     */
    addNode() {
        // Prevent adding nodes in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot add nodes: You have read-only access to this chart');
            return;
        }

        this.editingNodeId = null;
        document.getElementById('sidebarTitle').textContent = 'Add Node';
        document.getElementById('nodeAction').value = 'add';
        document.getElementById('deleteNodeBtn').style.display = 'none';

        // Clear department
        document.getElementById('nodeDepartment').value = '';

        // Populate parent dropdown
        this.populateParentDropdown();

        // Initialize draft with empty members
        this.draftMembers = [];

        // Render empty role builder
        this.renderRoleBuilder(this.draftMembers);

        this.showSidebar();
    }

    /**
     * Edit existing node
     */
    editNode(nodeId) {
        // Prevent editing nodes in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot edit nodes: You have read-only access to this chart');
            return;
        }

        const node = this.chartData.nodes.find(n => n.id === nodeId);

        if (!node) {
            window.toast.error('Node not found');
            return;
        }

        this.editingNodeId = nodeId;
        document.getElementById('sidebarTitle').textContent = 'Edit Node';
        document.getElementById('nodeAction').value = 'edit';

        // Populate parent dropdown
        this.populateParentDropdown(nodeId);
        document.getElementById('nodeParent').value = node.parentId || '';

        // Populate department
        const department = node.meta?.department || node.department || '';
        document.getElementById('nodeDepartment').value = department;

        // Copy existing members to draft (deep copy to avoid mutation)
        const members = node.members || [];
        this.draftMembers = JSON.parse(JSON.stringify(members));

        // Render role builder with draft members
        this.renderRoleBuilder(this.draftMembers);

        document.getElementById('deleteNodeBtn').style.display = 'block';

        this.showSidebar();
    }

    /**
     * Get display name for a node (for dropdowns and confirmations)
     */
    getNodeDisplayName(node) {
        // Check if new format (has members)
        if (node.members && node.members.length > 0) {
            const department = node.meta?.department || 'Unit';
            const firstRole = node.members[0];
            const firstPerson = firstRole?.entries?.[0]?.name || 'Unnamed';
            const peopleCount = node.members.reduce((sum, role) => sum + (role.entries?.length || 0), 0);

            if (peopleCount === 1) {
                return `${firstPerson} (${firstRole.roleLabel || 'Role'})`;
            } else {
                return `${department} (${peopleCount} people)`;
            }
        }

        // Legacy format
        return `${node.name || 'Unnamed'} (${node.title || 'No Title'})`;
    }

    /**
     * Populate parent dropdown
     */
    populateParentDropdown(excludeNodeId = null) {
        const select = document.getElementById('nodeParent');
        select.innerHTML = '<option value="">-- Top Level (No Manager) --</option>';

        // Get all nodes except the one being edited (to prevent circular references)
        const availableNodes = this.chartData.nodes.filter(node =>
            node.id !== excludeNodeId
        );

        availableNodes.forEach(node => {
            const option = document.createElement('option');
            option.value = node.id;
            option.textContent = this.getNodeDisplayName(node);
            select.appendChild(option);
        });
    }

    /**
     * Save node
     */
    saveNode(event) {
        event.preventDefault();

        // Prevent saving nodes in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot save changes: You have read-only access to this chart');
            return;
        }

        const nodeId = this.editingNodeId || storage.generateNodeId();
        const action = document.getElementById('nodeAction').value;
        const parentSelect = document.getElementById('nodeParent');
        const parentId = parentSelect.value ? parentSelect.value : null;

        const roots = (this.chartData?.nodes || []).filter(n => n.id !== nodeId && !n.parentId);

        if (!parentId && roots.length > 0) {
            window.toast.warning('Only one top-level node is allowed. Please choose a manager under "Reports To".');
            return;
        }

        if (parentId === nodeId) {
            window.toast.warning('A node cannot report to itself.');
            return;
        }

        if (parentId && this.editingNodeId) {
            const descendants = this.getDescendantIds(nodeId);
            if (descendants.has(parentId)) {
                window.toast.warning('You selected a descendant as the manager, which would create a cycle.');
                return;
            }
        }

        // Collect members data from the role builder
        const members = this.collectRoleBuilderData();

        if (members.length === 0) {
            window.toast.warning('Please add at least one person to this node');
            return;
        }

        // Preserve existing meta data when editing, only update department
        const existingNode = this.editingNodeId
            ? this.chartData.nodes.find(n => n.id === nodeId)
            : null;

        const nodeData = {
            id: nodeId,
            parentId: parentId,
            members: members,
            meta: {
                ...((existingNode && existingNode.meta) || {}), // Preserve all existing meta fields
                department: document.getElementById('nodeDepartment').value.trim()
            }
        };

        if (action === 'add') {
            // Add new node
            this.chartData.nodes.push(nodeData);
        } else {
            // Update existing node
            const index = this.chartData.nodes.findIndex(n => n.id === nodeId);
            if (index !== -1) {
                this.chartData.nodes[index] = nodeData;
            }
        }

        this.repairHierarchy({ persist: false });

        // Initialize orgChart if this is the first node
        if (!this.orgChart) {
            this.initOrgChart();
        } else {
            // Re-render the chart
            this.orgChart.data(this.chartData.nodes).render();
        }

        this.saveChart(false);
        this.closeSidebar();
    }

    /**
     * Delete node
     */
    async deleteNode() {
        if (!this.editingNodeId) return;

        // Prevent deleting nodes in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot delete nodes: You have read-only access to this chart');
            return;
        }

        const node = this.chartData.nodes.find(n => n.id === this.editingNodeId);
        if (!node) return;

        // Check if node has children
        const hasChildren = this.chartData.nodes.some(n => n.parentId === this.editingNodeId);

        const nodeName = this.getNodeDisplayName(node);
        let confirmMessage = `Delete "${nodeName}"?`;
        if (hasChildren) {
            confirmMessage = `"${nodeName}" has subordinates. Deleting this node will also delete all subordinates. Continue?`;
        }

        const confirmed = await window.toast.confirm({
            message: confirmMessage,
            title: 'Delete Node',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });

        if (!confirmed) {
            return;
        }

        // Remove node and all descendants
        this.removeNodeAndDescendants(this.editingNodeId);

        // Ensure hierarchy still has a valid root
        this.repairHierarchy({ persist: false });

        // Update org chart
        this.orgChart.data(this.chartData.nodes).render();

        this.saveChart(false);
        this.closeSidebar();
        window.toast.success('Node deleted successfully');
    }

    /**
     * Remove node and all its descendants recursively
     */
    removeNodeAndDescendants(nodeId) {
        // Find all children
        const children = this.chartData.nodes.filter(n => n.parentId === nodeId);

        // Recursively remove children
        children.forEach(child => {
            this.removeNodeAndDescendants(child.id);
        });

        // Remove the node itself
        this.chartData.nodes = this.chartData.nodes.filter(n => n.id !== nodeId);
    }

    /**
     * Show sidebar
     */
    showSidebar() {
        const sidebar = document.getElementById('nodeSidebar');
        sidebar.classList.add('active');

        // Apply department styling to sidebar if chart has a department tag
        if (this.chartData && this.chartData.departmentTag) {
            const deptLower = this.chartData.departmentTag.toLowerCase();
            let deptCategory = 'default';

            if (['engineering', 'product', 'tech', 'development'].some(k => deptLower.includes(k))) {
                deptCategory = 'engineering';
            } else if (['sales', 'revenue', 'business'].some(k => deptLower.includes(k))) {
                deptCategory = 'sales';
            } else if (['marketing', 'brand'].some(k => deptLower.includes(k))) {
                deptCategory = 'marketing';
            } else if (['operations', 'ops'].some(k => deptLower.includes(k))) {
                deptCategory = 'operations';
            } else if (['finance', 'accounting'].some(k => deptLower.includes(k))) {
                deptCategory = 'finance';
            } else if (['hr', 'people', 'human'].some(k => deptLower.includes(k))) {
                deptCategory = 'hr';
            } else if (['it', 'information', 'technology', 'digital'].some(k => deptLower.includes(k))) {
                deptCategory = 'it';
            } else if (['legal', 'compliance', 'law'].some(k => deptLower.includes(k))) {
                deptCategory = 'legal';
            } else if (['admin', 'administration', 'executive'].some(k => deptLower.includes(k))) {
                deptCategory = 'admin';
            }

            sidebar.setAttribute('data-department', deptCategory);
        } else {
            sidebar.setAttribute('data-department', 'default');
        }
    }

    /**
     * Close sidebar
     */
    closeSidebar() {
        const sidebar = document.getElementById('nodeSidebar');

        // Release accessibility focus trap and remove inert from background
        if (window.accessibilityManager) {
            window.accessibilityManager.releaseFocusTrap(sidebar);
        }

        sidebar.classList.remove('active');
        this.editingNodeId = null;
        this.draftMembers = []; // Clear draft state on cancel
    }

    /**
     * Expand all nodes
     */
    expandAll() {
        this.orgChart.expandAll();
    }

    /**
     * Collapse all nodes
     */
    collapseAll() {
        this.orgChart.collapseAll();
    }

    /**
     * Zoom in
     */
    zoomIn() {
        this.orgChart.zoomIn();
    }

    /**
     * Zoom out
     */
    zoomOut() {
        this.orgChart.zoomOut();
    }

    /**
     * Fit to screen
     */
    fitToScreen() {
        this.orgChart.fit();
    }

    /**
     * Change layout
     */
    changeLayout(layout) {
        // Prevent layout changes in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot change layout: You have read-only access to this chart');
            return;
        }

        this.chartData.layout = layout;
        this.orgChart.layout(layout).render().fit();
        this.saveChart(false);
    }

    /**
     * Analyze chart structure to determine optimal canvas size
     * Returns { depth, maxBreadth, totalNodes, layoutParams, canvasSize }
     */
    analyzeChartStructure(nodes) {
        if (!nodes || nodes.length === 0) {
            return {
                depth: 1,
                maxBreadth: 1,
                totalNodes: 0,
                layoutParams: {
                    nodeWidth: 250,
                    childrenMargin: 80,
                    compactMarginBetween: 25,
                    compactMarginPair: 100
                },
                canvasSize: { width: 2000, height: 1500 }
            };
        }

        // Build parent-child relationships
        const nodeMap = new Map();
        nodes.forEach(node => nodeMap.set(node.id, node));

        // Assign levels via BFS
        const queue = [];
        const visited = new Set();
        const levelCounts = new Map();

        const rootNodes = nodes.filter(n => !n.parentId || !nodeMap.has(n.parentId));
        rootNodes.forEach(root => {
            queue.push({ nodeId: root.id, level: 0 });
            visited.add(root.id);
        });

        let maxDepth = 0;
        while (queue.length > 0) {
            const { nodeId, level } = queue.shift();
            maxDepth = Math.max(maxDepth, level);
            levelCounts.set(level, (levelCounts.get(level) || 0) + 1);

            const children = nodes.filter(n => n.parentId === nodeId && !visited.has(n.id));
            children.forEach(child => {
                queue.push({ nodeId: child.id, level: level + 1 });
                visited.add(child.id);
            });
        }

        const depth = maxDepth + 1;
        const maxBreadth = Math.max(...Array.from(levelCounts.values()), 1);
        const totalNodes = nodes.length;

        // Fixed layout parameters matching the editor (lines 448-455) for consistency
        // Ensures single-chart exports have the same spacing as the editor and bulk exports
        const nodeWidth = 250;
        const childrenMargin = 80;
        const compactMarginBetween = 25;
        const compactMarginPair = 100;

        // Calculate dynamic canvas size
        const baseCaptureWidth = 2000;
        const baseCaptureHeight = 1128;

        // Estimate dimensions based on structure
        const estimatedWidth = maxBreadth * (nodeWidth + compactMarginBetween) + 400;
        const avgNodeHeight = 120;
        const estimatedHeight = depth * (avgNodeHeight + childrenMargin) + 300;

        const captureWidth = Math.min(Math.max(baseCaptureWidth, estimatedWidth), 4500);
        const captureHeight = Math.min(Math.max(baseCaptureHeight, estimatedHeight), 3500);

        return {
            depth,
            maxBreadth,
            totalNodes,
            layoutParams: {
                nodeWidth,
                childrenMargin,
                compactMarginBetween,
                compactMarginPair
            },
            canvasSize: { width: captureWidth, height: captureHeight }
        };
    }

    /**
     * Get resolved CSS variables (same as bulk export)
     */
    getResolvedCSSVariables() {
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position: absolute; visibility: hidden;';
        document.body.appendChild(tempDiv);

        const computedStyle = getComputedStyle(tempDiv);

        const variables = {
            // Standard UI variables
            '--primary-color': computedStyle.getPropertyValue('--primary-color') || '#2563eb',
            '--primary-hover': computedStyle.getPropertyValue('--primary-hover') || '#1d4ed8',
            '--secondary-color': computedStyle.getPropertyValue('--secondary-color') || '#64748b',
            '--success-color': computedStyle.getPropertyValue('--success-color') || '#10b981',
            '--danger-color': computedStyle.getPropertyValue('--danger-color') || '#ef4444',
            '--warning-color': computedStyle.getPropertyValue('--warning-color') || '#f59e0b',
            '--background': computedStyle.getPropertyValue('--background') || '#ffffff',
            '--background-secondary': computedStyle.getPropertyValue('--background-secondary') || '#f8fafc',
            '--border-color': computedStyle.getPropertyValue('--border-color') || '#e2e8f0',
            '--text-primary': computedStyle.getPropertyValue('--text-primary') || '#1e293b',
            '--text-secondary': computedStyle.getPropertyValue('--text-secondary') || '#64748b',
            '--shadow-sm': computedStyle.getPropertyValue('--shadow-sm') || '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            '--shadow-md': computedStyle.getPropertyValue('--shadow-md') || '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            '--shadow-lg': computedStyle.getPropertyValue('--shadow-lg') || '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            '--radius': computedStyle.getPropertyValue('--radius') || '8px',
            '--radius-sm': computedStyle.getPropertyValue('--radius-sm') || '4px',
            '--radius-lg': computedStyle.getPropertyValue('--radius-lg') || '12px',
            '--primary-500': computedStyle.getPropertyValue('--primary-500') || '#0085f2',
            '--primary-700': computedStyle.getPropertyValue('--primary-700') || '#0066bd',
            '--accent-500': computedStyle.getPropertyValue('--accent-500') || '#ff6900',
            // RRC Brand Colors
            '--rrc-blue': computedStyle.getPropertyValue('--rrc-blue') || '#0085f2',
            '--rrc-blue-light': computedStyle.getPropertyValue('--rrc-blue-light') || '#D3ECFE',
            '--rrc-blue-lighter': computedStyle.getPropertyValue('--rrc-blue-lighter') || '#e6f5ff',
            '--rrc-blue-dark': computedStyle.getPropertyValue('--rrc-blue-dark') || '#0066bd',
            '--rrc-blue-darker': computedStyle.getPropertyValue('--rrc-blue-darker') || '#004d8f',
            '--rrc-orange': computedStyle.getPropertyValue('--rrc-orange') || '#ff6900',
            '--rrc-orange-alt': computedStyle.getPropertyValue('--rrc-orange-alt') || '#fe6c19',
            '--rrc-orange-light': computedStyle.getPropertyValue('--rrc-orange-light') || '#FFF1E8',
            '--rrc-orange-lighter': computedStyle.getPropertyValue('--rrc-orange-lighter') || '#fff8f3',
            '--rrc-orange-dark': computedStyle.getPropertyValue('--rrc-orange-dark') || '#cc5400',
            '--rrc-green-light': computedStyle.getPropertyValue('--rrc-green-light') || '#7ed957',
            '--rrc-green': computedStyle.getPropertyValue('--rrc-green') || '#4caf50',
            '--rrc-green-dark': computedStyle.getPropertyValue('--rrc-green-dark') || '#2e7d32',
            '--rrc-neutral-dark': computedStyle.getPropertyValue('--rrc-neutral-dark') || '#303030',
            '--rrc-neutral-light': computedStyle.getPropertyValue('--rrc-neutral-light') || '#abb8c3',
            '--rrc-neutral-lighter': computedStyle.getPropertyValue('--rrc-neutral-lighter') || '#e5e9ec'
        };

        document.body.removeChild(tempDiv);
        return variables;
    }

    /**
     * Resolve CSS variables in stylesheet
     */
    resolveCSSVariables(cssText, variables) {
        let resolved = cssText;
        for (const [varName, value] of Object.entries(variables)) {
            const regex = new RegExp(`var\\(${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
            resolved = resolved.replace(regex, value.trim());
        }
        return resolved;
    }

    /**
     * Inject node styles into SVG (same as bulk export)
     */
    injectNodeStyles(svgNode, resolvedCSS) {
        if (!svgNode) return;
        try {
            const styleId = 'export-node-styles';
            if (svgNode.querySelector(`#${styleId}`)) {
                return;
            }
            const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleEl.id = styleId;
            styleEl.textContent = resolvedCSS;
            svgNode.insertBefore(styleEl, svgNode.firstChild);
        } catch (error) {
            console.warn('Failed to inject node styles into SVG', error);
        }
    }

    /**
     * Render chart off-screen with injected styles for consistent exports
     * Uses dynamic canvas sizing based on chart complexity to prevent over-compression
     * @param {number} scale - Export scale factor (1.0 = base, 2.0 = high quality)
     * @returns {Promise<string>} Base64 data URL of the rendered chart
     */
    async renderChartOffScreen(scale = 2.0) {
        // Fetch and combine stylesheets
        const [baseResponse, modernResponse] = await Promise.all([
            fetch('css/styles.css'),
            fetch('css/modernization-styles.css')
        ]);

        const baseCSS = await baseResponse.text();
        const modernCSS = modernResponse.ok ? await modernResponse.text() : '';

        // Get OrgNodeRenderer styles (critical for node header bar + styling)
        const nodeRendererCSS = typeof OrgNodeRenderer !== 'undefined' && OrgNodeRenderer.getNodeStyles
            ? OrgNodeRenderer.getNodeStyles()
            : '';

        const combinedCSS = `${baseCSS}\n\n/* Modernization Styles */\n${modernCSS}\n\n/* Node Renderer Styles */\n${nodeRendererCSS}`;

        // Resolve CSS variables for SVG injection
        const cssVariables = this.getResolvedCSSVariables();
        const resolvedCSS = this.resolveCSSVariables(combinedCSS, cssVariables);

        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
            console.log('[Export] Fonts loaded before measurement');
        }

        // Analyze chart structure for dynamic canvas sizing
        const analysis = this.analyzeChartStructure(this.chartData.nodes || []);
        const captureWidth = analysis.canvasSize.width;
        const captureHeight = analysis.canvasSize.height;

        console.log(`[Export] Chart analysis: ${analysis.totalNodes} nodes, depth=${analysis.depth}, breadth=${analysis.maxBreadth}`);
        console.log(`[Export] Canvas size: ${captureWidth}×${captureHeight}px (prevents fit() compression)`);

        // Create hidden container
        const container = document.createElement('div');
        container.id = 'temp-export-container';
        container.style.cssText = `
            position: fixed;
            left: -9999px;
            top: -9999px;
            width: ${captureWidth}px;
            height: ${captureHeight}px;
            overflow: hidden;
            visibility: hidden;
            pointer-events: none;
        `;

        // Inject styles
        const styleTag = document.createElement('style');
        styleTag.textContent = combinedCSS;
        container.appendChild(styleTag);

        const canvasDiv = document.createElement('div');
        canvasDiv.id = 'temp-chart-canvas';
        canvasDiv.style.cssText = `width: ${captureWidth}px; height: ${captureHeight}px;`;

        // Apply CSS variables directly to the export container as custom properties
        // This ensures any var() references in inline styles or dynamic CSS resolve correctly
        for (const [varName, value] of Object.entries(cssVariables)) {
            canvasDiv.style.setProperty(varName, value.trim());
        }

        container.appendChild(canvasDiv);
        document.body.appendChild(container);

        try {
            // Prepare chart data
            const chartNodes = this.chartData.nodes.map(node => ({
                id: node.id,
                parentId: node.parentId || '',
                members: node.members || [],
                meta: node.meta || {},
                _expanded: true,
                name: node.name,
                title: node.title,
                department: node.department || (node.meta && node.meta.department)
            }));

            // Use fixed layout parameters from analysis (matching editor)
            const params = analysis.layoutParams;

            // Render chart off-screen
            const tempChart = new d3.OrgChart()
                .container('#temp-chart-canvas')
                .data(chartNodes)
                .svgWidth(captureWidth)
                .svgHeight(captureHeight)
                .nodeWidth(() => params.nodeWidth)
                .nodeHeight((d) => OrgNodeRenderer.calculateNodeHeight(d.data || d))
                .childrenMargin(() => params.childrenMargin)
                .compactMarginBetween(() => params.compactMarginBetween)
                .compactMarginPair(() => params.compactMarginPair)
                .compact(false)
                .layout(this.chartData.layout || 'top')
                .nodeContent((d) => OrgNodeRenderer.renderNodeContent(d))
                .render();

            // Wait for render to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Fit chart to view (non-animated but still async)
            // CRITICAL: Even with animate:false, fit uses async transitions
            // Must wait for onCompleted callback before exporting
            await new Promise(resolve => {
                tempChart.fit({ animate: false, onCompleted: resolve });
            });
            console.log('[Export] fit() completed, transforms applied');

            // Optional: wait one more frame for safety
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Inject resolved CSS into SVG before export (critical for styling)
            const svgNode = canvasDiv.querySelector('svg');
            if (svgNode) {
                this.injectNodeStyles(svgNode, resolvedCSS);
                console.log('[Export] Injected resolved CSS variables into SVG');
            }

            // Capture as image
            // Use full: false since we already called fit() manually above
            return new Promise((resolve, reject) => {
                tempChart.exportImg({
                    full: false,
                    save: false,
                    scale: scale,
                    onLoad: (base64) => {
                        tempChart.clear();
                        container.remove();
                        resolve(base64);
                    }
                });
            });
        } catch (error) {
            container.remove();
            throw error;
        }
    }

    /**
     * Export as PNG with title
     */
    async exportPNG() {
        try {
            const base64 = await this.renderChartOffScreen(2.0);
            const chartName = this.chartData.chartName || 'Org Chart';

            // Load the chart image and add title
            const img = new Image();
            img.onload = () => {
                const titleHeight = 60; // Space for title at top
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height + titleHeight;
                const ctx = canvas.getContext('2d');

                // Fill white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw title
                ctx.fillStyle = '#1e293b';
                ctx.font = 'bold 36px "Space Grotesk", "Roboto", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(chartName, canvas.width / 2, titleHeight / 2);

                // Draw chart image below title
                ctx.drawImage(img, 0, titleHeight);

                // Download
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `${chartName}.png`;
                a.click();
            };
            img.src = base64;
        } catch (error) {
            console.error('PNG export failed:', error);
            window.toast.error('Failed to export PNG');
        }
    }

    /**
     * Export as JPEG with title
     */
    async exportJPEG() {
        try {
            const base64 = await this.renderChartOffScreen(2.0);
            const chartName = this.chartData.chartName || 'Org Chart';

            // Convert PNG to JPEG with title
            const img = new Image();
            img.onload = () => {
                const titleHeight = 60; // Space for title at top
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height + titleHeight;
                const ctx = canvas.getContext('2d');

                // Fill white background for JPEG
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw title
                ctx.fillStyle = '#1e293b';
                ctx.font = 'bold 36px "Space Grotesk", "Roboto", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(chartName, canvas.width / 2, titleHeight / 2);

                // Draw chart image below title
                ctx.drawImage(img, 0, titleHeight);

                // Convert to JPEG and download
                canvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${chartName}.jpg`;
                    a.click();
                    URL.revokeObjectURL(url);
                }, 'image/jpeg', 0.95);
            };
            img.src = base64;
        } catch (error) {
            console.error('JPEG export failed:', error);
            window.toast.error('Failed to export JPEG');
        }
    }

    /**
     * Export as PDF with auto page sizing for readability
     * Includes chart title at top center, matching bulk export styling
     */
    async exportPDF() {
        try {
            const base64 = await this.renderChartOffScreen(2.0);
            const { jsPDF } = window.jspdf;
            const img = new Image();
            const chartName = this.chartData.chartName || 'Org Chart';

            img.onload = async () => {
                const imgWidth = img.width;
                const imgHeight = img.height;

                // Default page dimensions (A4 landscape) in mm
                const defaultPageWidth = 297;
                const defaultPageHeight = 210;

                // Minimum scale to maintain text readability (0.8 = 80% of original size)
                const MIN_SCALE = 0.8;

                // Title area: title centered at 22mm from top, with 35mm total header zone
                const titleY = 22; // mm from top where title is drawn
                const headerZone = 35; // mm reserved for title area

                // Reasonable margins in mm
                const margins = {
                    left: 15,
                    right: 15,
                    top: headerZone, // Chart starts below header zone
                    bottom: 15
                };

                // Available space on default page (for chart image)
                const availableWidth = defaultPageWidth - margins.left - margins.right;
                const availableHeight = defaultPageHeight - margins.top - margins.bottom;

                // Calculate scale to fit image on default page
                const scaleX = availableWidth / (imgWidth * 0.264583); // Convert px to mm (1px = 0.264583mm at 96dpi)
                const scaleY = availableHeight / (imgHeight * 0.264583);
                let scale = Math.min(scaleX, scaleY);

                let pdfWidth = defaultPageWidth;
                let pdfHeight = defaultPageHeight;

                // If scale is too small, grow the page to maintain minimum readable scale
                if (scale < MIN_SCALE) {
                    scale = MIN_SCALE;
                    const scaledWidthMm = imgWidth * 0.264583 * scale;
                    const scaledHeightMm = imgHeight * 0.264583 * scale;
                    pdfWidth = scaledWidthMm + margins.left + margins.right;
                    pdfHeight = scaledHeightMm + margins.top + margins.bottom;
                    console.log(`[Export] Scale too small, increasing page from ${defaultPageWidth}×${defaultPageHeight}mm to ${Math.round(pdfWidth)}×${Math.round(pdfHeight)}mm (scale: ${scale.toFixed(2)})`);
                }

                // Calculate final dimensions and position
                const scaledWidth = imgWidth * 0.264583 * scale;
                const scaledHeight = imgHeight * 0.264583 * scale;
                const x = (pdfWidth - scaledWidth) / 2;

                // Recalculate available height for potentially resized page
                const actualAvailableHeight = pdfHeight - margins.top - margins.bottom;
                // Center image vertically in the available space below header
                const imageY = margins.top + (actualAvailableHeight - scaledHeight) / 2;

                // Create PDF with appropriate page size
                const orientation = pdfWidth > pdfHeight ? 'l' : 'p';
                const pdf = new jsPDF({
                    orientation: orientation,
                    unit: 'mm',
                    format: [pdfWidth, pdfHeight]
                });

                // Register fonts and draw title (matching bulk export styling)
                try {
                    if (window.ExportTemplate && window.ExportTemplate.registerExportFonts) {
                        const config = await window.ExportTemplate.registerExportFonts(pdf);
                        const headingFontFamily = config.fonts?.heading?.family || config.fonts?.primary?.family || 'helvetica';
                        pdf.setFont(headingFontFamily, 'bold');
                        pdf.setFontSize(22); // Slightly larger for better visibility
                    } else {
                        // Fallback if ExportTemplate not available
                        pdf.setFont('helvetica', 'bold');
                        pdf.setFontSize(22);
                    }
                } catch (fontError) {
                    console.warn('[Export] Could not load export fonts, using fallback:', fontError);
                    pdf.setFont('helvetica', 'bold');
                    pdf.setFontSize(22);
                }

                // Draw title centered in header zone
                pdf.setTextColor(30, 41, 59); // Dark slate color (#1e293b)
                pdf.text(chartName, pdfWidth / 2, titleY, { align: 'center' });

                // Add chart image below header zone, centered
                pdf.addImage(img, 'PNG', x, imageY, scaledWidth, scaledHeight);
                pdf.save(`${chartName}.pdf`);
            };

            img.src = base64;
        } catch (error) {
            console.error('PDF export failed:', error);
            window.toast.error('Failed to export PDF');
        }
    }

    /**
     * Show chart settings modal
     */
    async showChartSettings() {
        document.getElementById('settingsChartName').value = this.chartData.chartName;
        document.getElementById('settingsDepartment').value = this.chartData.departmentTag || '';
        document.getElementById('settingsCoverOrderIndex').value = this.chartData.coverOrderIndex ?? '';

        // Populate cover selector
        await this.populateCoverSelector();

        const modal = document.getElementById('settingsModal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    /**
     * Load cover options from mapping file and populate selector
     */
    async populateCoverSelector() {
        const selector = document.getElementById('settingsCoverId');
        if (!selector) return;

        try {
            // Load cover image mapping
            const response = await fetch('assets/export/cover-image-mapping.json');
            const mapping = await response.json();

            // Clear existing options except default
        selector.innerHTML = '<option value="">Cover</option>';

            // Add options from coverImages
            if (mapping.coverImages && Array.isArray(mapping.coverImages)) {
                mapping.coverImages.forEach(cover => {
                    const option = document.createElement('option');
                    option.value = cover.id;

                    // Create a friendly display name from the ID
                    const displayName = cover.label || cover.id
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');

                    option.textContent = displayName;
                    selector.appendChild(option);
                });
            }

            // Set current value
            selector.value = this.chartData.coverId || '';
        } catch (error) {
            console.error('[ChartEditor] Failed to load cover options:', error);
        }
    }

    /**
     * Close settings modal
     */
    closeSettingsModal() {
        const modal = document.getElementById('settingsModal');

        // Release accessibility focus trap and remove inert from background
        if (window.accessibilityManager) {
            window.accessibilityManager.releaseFocusTrap(modal);
        }

        modal.classList.remove('active');
        modal.style.display = 'none';
    }

    /**
     * Save chart settings
     */
    saveSettings(event) {
        event.preventDefault();

        // Prevent changing settings in read-only mode
        if (this.isReadOnly || !this.canEdit) {
            window.toast.warning('Cannot modify settings: You have read-only access to this chart');
            return;
        }

        this.chartData.chartName = document.getElementById('settingsChartName').value.trim();
        this.chartData.departmentTag = document.getElementById('settingsDepartment').value.trim();

        // Save selected coverId (explicit user choice, stable regardless of department)
        const selectedCoverId = document.getElementById('settingsCoverId')?.value || '';
        this.chartData.coverId = selectedCoverId || null;

        // Save coverOrderIndex (order within cover group)
        const coverOrderIndexValue = document.getElementById('settingsCoverOrderIndex')?.value;
        const parsedValue = coverOrderIndexValue && !isNaN(parseInt(coverOrderIndexValue))
            ? parseInt(coverOrderIndexValue)
            : null;
        // Enforce >= 1, ignore 0/negative values (they would sort incorrectly)
        this.chartData.coverOrderIndex = (parsedValue && parsedValue >= 1) ? parsedValue : null;

        // Sync chartMeta to prevent stale name in saveChart
        if (this.chartMeta) {
            this.chartMeta.name = this.chartData.chartName;
        }

        document.getElementById('chartTitle').textContent = this.chartData.chartName;
        document.title = `${this.chartData.chartName} - Chart Editor`;

        this.saveChart(false);
        this.closeSettingsModal();
    }

    /**
     * Render role builder UI with current members data
     * Uses DOM APIs to prevent XSS in form fields
     */
    renderRoleBuilder(members = []) {
        const container = document.getElementById('rolesContainer');
        container.innerHTML = '';

        members.forEach((roleGroup, roleIndex) => {
            // Create role group container
            const roleDiv = document.createElement('div');
            roleDiv.className = 'role-group';

            // Create role header
            const roleHeader = document.createElement('div');
            roleHeader.className = 'role-group-header';

            // Create role label input (safe - uses .value property)
            const roleLabelInput = document.createElement('input');
            roleLabelInput.type = 'text';
            roleLabelInput.className = 'form-input role-label-input';
            roleLabelInput.placeholder = 'Role Title';
            roleLabelInput.value = roleGroup.roleLabel || ''; // Safe assignment via property
            roleLabelInput.dataset.roleIndex = roleIndex;

            // Create delete role button
            const deleteRoleBtn = document.createElement('button');
            deleteRoleBtn.type = 'button';
            deleteRoleBtn.className = 'btn btn-ghost-danger btn-sm';
            deleteRoleBtn.innerHTML = `
                <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            `;
            deleteRoleBtn.title = 'Remove role';
            deleteRoleBtn.onclick = () => this.removeRole(roleIndex);

            roleHeader.appendChild(roleLabelInput);
            roleHeader.appendChild(deleteRoleBtn);
            roleDiv.appendChild(roleHeader);

            // Create people container
            const peopleContainer = document.createElement('div');
            peopleContainer.className = 'people-container';
            peopleContainer.id = `peopleContainer${roleIndex}`;

            // Render people in this role
            roleGroup.entries.forEach((person, personIndex) => {
                const personDiv = document.createElement('div');
                personDiv.className = 'person-entry';

                // Create horizontal container for avatar + name + delete button
                const inputRow = document.createElement('div');
                inputRow.className = 'person-entry-row';

                // Avatar with initials
                const avatar = document.createElement('div');
                avatar.className = 'avatar sm';
                const initials = this.getInitials(person.name || '');
                avatar.textContent = initials;
                avatar.title = person.name || 'Unnamed';

                // Name input (fills available space)
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'form-input';
                nameInput.placeholder = 'Name *';
                nameInput.value = person.name || '';
                nameInput.required = true;
                nameInput.dataset.roleIndex = roleIndex;
                nameInput.dataset.personIndex = personIndex;
                nameInput.dataset.field = 'name';

                // Update avatar when name changes
                nameInput.addEventListener('input', (e) => {
                    const newInitials = this.getInitials(e.target.value);
                    avatar.textContent = newInitials;
                    avatar.title = e.target.value;
                });

                // Hidden field to preserve photoUrl (must stay in DOM)
                const photoUrlInput = document.createElement('input');
                photoUrlInput.type = 'hidden';
                photoUrlInput.value = person.photoUrl || '';
                photoUrlInput.dataset.roleIndex = roleIndex;
                photoUrlInput.dataset.personIndex = personIndex;
                photoUrlInput.dataset.field = 'photoUrl';

                // Compact delete button (icon only) with SVG
                const deletePersonBtn = document.createElement('button');
                deletePersonBtn.type = 'button';
                deletePersonBtn.className = 'btn btn-ghost-danger btn-sm';
                deletePersonBtn.innerHTML = `
                    <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                `;
                deletePersonBtn.title = 'Remove person';  // Tooltip for accessibility
                deletePersonBtn.onclick = () => this.removePerson(roleIndex, personIndex);

                inputRow.appendChild(avatar);
                inputRow.appendChild(nameInput);
                inputRow.appendChild(deletePersonBtn);

                personDiv.appendChild(inputRow);
                personDiv.appendChild(photoUrlInput);  // Hidden field outside the flex row

                peopleContainer.appendChild(personDiv);
            });

            roleDiv.appendChild(peopleContainer);

            // Create "Add Person" button
            const addPersonBtn = document.createElement('button');
            addPersonBtn.type = 'button';
            addPersonBtn.className = 'btn btn-neutral btn-sm';
            addPersonBtn.innerHTML = `
                <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="8.5" cy="7" r="4"></circle>
                    <line x1="20" y1="8" x2="20" y2="14"></line>
                    <line x1="23" y1="11" x2="17" y2="11"></line>
                </svg>
                Add Person
            `;
            addPersonBtn.onclick = () => this.addPersonToRole(roleIndex);

            roleDiv.appendChild(addPersonBtn);
            container.appendChild(roleDiv);
        });
    }

    /**
     * Capture current sidebar inputs into draftMembers so typing isn't lost
     */
    captureDraftMembersFromUI() {
        const container = document.getElementById('rolesContainer');
        if (!container) return;

        const draft = [];
        container.querySelectorAll('.role-group').forEach(roleEl => {
            const roleInput = roleEl.querySelector('.role-label-input');
            const roleLabel = roleInput ? roleInput.value : '';

            const entries = [];
            // Find all person entries within this role
            const personEntries = roleEl.querySelectorAll('.person-entry');
            personEntries.forEach(personEl => {
                const nameInput = personEl.querySelector('input[data-field="name"]');
                const photoUrlInput = personEl.querySelector('input[data-field="photoUrl"]');

                entries.push({
                    name: nameInput ? nameInput.value || '' : '',
                    photoUrl: photoUrlInput ? photoUrlInput.value || '' : ''
                });
            });

            draft.push({
                roleLabel,
                entries: entries.length ? entries : [{ name: '', photoUrl: '' }]
            });
        });

        this.draftMembers = draft;
    }

    /**
     * Add a new empty role
     */
    addRole() {
        this.captureDraftMembersFromUI();

        // Works for both new and existing nodes via draft state
        this.draftMembers.push({
            roleLabel: '',
            entries: [{ name: '', email: '', phone: '', photoUrl: '' }]
        });

        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Remove a role by index
     */
    removeRole(roleIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        window.toast.confirm({
            message: 'Remove this entire role and all people in it?',
            title: 'Remove Role',
            confirmText: 'Remove',
            cancelText: 'Cancel'
        }).then((confirmed) => {
            if (confirmed) {
                this.draftMembers.splice(roleIndex, 1);
                this.renderRoleBuilder(this.draftMembers);
            }
        });
    }

    /**
     * Add a person to a specific role
     */
    addPersonToRole(roleIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        this.draftMembers[roleIndex].entries.push({ name: '', photoUrl: '' });
        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Remove a person from a role
     */
    removePerson(roleIndex, personIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        this.draftMembers[roleIndex].entries.splice(personIndex, 1);

        // If role is now empty, remove it
        if (this.draftMembers[roleIndex].entries.length === 0) {
            this.draftMembers.splice(roleIndex, 1);
        }

        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Get initials from a name (e.g., "John Doe" -> "JD")
     */
    getInitials(name) {
        if (!name || !name.trim()) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0].charAt(0).toUpperCase();
        }
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    /**
     * Collect data from role builder form
     * Preserves all metadata: name, email, phone, photoUrl
     */
    collectRoleBuilderData() {
        const members = [];
        const roleLabelInputs = document.querySelectorAll('.role-label-input');

        roleLabelInputs.forEach(input => {
            const roleIndex = parseInt(input.dataset.roleIndex);
            const roleLabel = input.value.trim(); // No fallback - allow blank titles

            // Get all person entries for this role
            const personEntries = document.querySelectorAll(`.person-entry`);
            const entries = [];

            personEntries.forEach(personEl => {
                const nameInput = personEl.querySelector(`input[data-role-index="${roleIndex}"][data-field="name"]`);
                if (!nameInput) return; // Not for this role

                const emailInput = personEl.querySelector(`input[data-role-index="${roleIndex}"][data-field="email"]`);
                const phoneInput = personEl.querySelector(`input[data-role-index="${roleIndex}"][data-field="phone"]`);
                const photoUrlInput = personEl.querySelector(`input[data-role-index="${roleIndex}"][data-field="photoUrl"]`);

                const name = nameInput.value.trim();
                if (!name) return; // Skip empty names

                entries.push({
                    name: name,
                    email: emailInput ? emailInput.value.trim() : '',
                    phone: phoneInput ? phoneInput.value.trim() : '',
                    photoUrl: photoUrlInput ? photoUrlInput.value : ''
                });
            });

            // Keep role if it has a title OR has entries (allow title-only roles)
            if (roleLabel || entries.length > 0) {
                members.push({ roleLabel, entries });
            }
        });

        return members;
    }
}

// Initialize editor when DOM is loaded
let editor;
document.addEventListener('DOMContentLoaded', () => {
    editor = new ChartEditor();
});

// Save before unload
window.addEventListener('beforeunload', (e) => {
    if (editor) {
        editor.saveChart(false);
    }
});
