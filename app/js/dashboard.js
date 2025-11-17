/**
 * Dashboard Application Logic
 * Handles chart listing, creation, and management
 */

class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.bulkExportManager = null;
        this.exportDependenciesLoaded = false;
        this.init();
    }

    init() {
        this.loadDepartments();
        this.renderCharts();
        this.setupEventDelegation();
        // initializeBulkExport() is now called after lazy loading dependencies
    }

    /**
     * Setup event delegation for chart cards
     * Fixes XSS vulnerability by removing inline event handlers
     */
    setupEventDelegation() {
        const container = document.getElementById('chartsContainer');

        // Delegate chart card clicks
        container.addEventListener('click', (e) => {
            // Handle chart card click (open chart)
            const card = e.target.closest('.chart-card');
            if (card && !e.target.closest('.chart-card-actions')) {
                const chartId = card.dataset.chartId;
                if (chartId) {
                    this.openChart(chartId);
                }
                return;
            }

            // Handle action button clicks
            const button = e.target.closest('button[data-action]');
            if (button) {
                e.stopPropagation();
                const action = button.dataset.action;
                const chartId = button.dataset.chartId;

                if (!chartId) return;

                switch (action) {
                    case 'edit':
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
                }
            }
        });
    }

    /**
     * Load all department tags into filter dropdown
     */
    loadDepartments() {
        const departments = storage.getAllDepartments();
        const filterSelect = document.getElementById('departmentFilter');
        const datalist = document.getElementById('departmentList');

        // Clear existing options (except "All Departments")
        filterSelect.innerHTML = '<option value="">All Departments</option>';
        datalist.innerHTML = '';

        // Add department options
        departments.forEach(dept => {
            // Add to filter dropdown
            const option = document.createElement('option');
            option.value = dept;
            option.textContent = dept;
            filterSelect.appendChild(option);

            // Add to datalist for autocomplete
            const datalistOption = document.createElement('option');
            datalistOption.value = dept;
            datalist.appendChild(datalistOption);
        });
    }

    /**
     * Render all charts
     */
    renderCharts() {
        let charts = storage.getChartsArray();

        // Apply filters
        if (this.currentFilter) {
            charts = storage.searchCharts(this.currentFilter);
        }

        if (this.currentDepartment) {
            charts = charts.filter(chart => chart.departmentTag === this.currentDepartment);
        }

        const container = document.getElementById('chartsContainer');
        const emptyState = document.getElementById('emptyState');

        if (charts.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        const html = `
            <div class="grid grid-cols-3">
                ${charts.map(chart => this.renderChartCard(chart)).join('')}
            </div>
        `;

        container.innerHTML = html;
    }

    /**
     * Render a single chart card
     */
    renderChartCard(chart) {
        // Defensive guard for missing lastModified field
        const lastModified = chart.lastModified
            ? new Date(chart.lastModified).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            : 'No date';

        const nodeCount = chart.nodes ? chart.nodes.length : 0;

        // Calculate total people count from multi-person nodes
        let totalPeople = 0;
        if (chart.nodes) {
            chart.nodes.forEach(node => {
                if (node.members && Array.isArray(node.members)) {
                    // New format: count all people in all roles
                    node.members.forEach(roleGroup => {
                        if (roleGroup.entries) {
                            totalPeople += roleGroup.entries.length;
                        }
                    });
                } else if (node.name) {
                    // Legacy format: one person per node
                    totalPeople += 1;
                }
            });
        }

        // Escape chartId for use in data attribute
        const escapedChartId = this.escapeHtml(chart.chartId);

        return `
            <div class="chart-card" data-chart-id="${escapedChartId}">
                <div class="chart-card-header">
                    <div>
                        <h3 class="chart-card-title">${this.escapeHtml(chart.chartName)}</h3>
                        ${chart.departmentTag ? `<span class="chart-card-tag">${this.escapeHtml(chart.departmentTag)}</span>` : ''}
                    </div>
                </div>
                <div class="chart-card-meta">
                    <span>📅 ${lastModified}</span>
                    <span>📦 ${nodeCount} nodes</span>
                    <span>👥 ${totalPeople} people</span>
                </div>
                ${chart.description ? `
                    <p class="chart-card-description">${this.escapeHtml(chart.description)}</p>
                ` : ''}
                <div class="chart-card-actions">
                    <button class="btn btn-secondary btn-sm" data-action="edit" data-chart-id="${escapedChartId}">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="duplicate" data-chart-id="${escapedChartId}">
                        📋 Duplicate
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="settings" data-chart-id="${escapedChartId}">
                        ⚙️ Settings
                    </button>
                    <button class="btn btn-danger btn-sm" data-action="delete" data-chart-id="${escapedChartId}">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
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
     * Filter charts by department
     */
    filterByDepartment(department) {
        this.currentDepartment = department;
        this.renderCharts();
    }

    /**
     * Show create chart modal
     */
    showCreateModal() {
        this.editingChartId = null;
        document.getElementById('modalTitle').textContent = 'Create New Chart';
        document.getElementById('chartForm').reset();
        document.getElementById('chartId').value = '';
        document.querySelector('#chartForm button[type="submit"]').textContent = 'Create Chart';
        this.showModal();
    }

    /**
     * Edit chart metadata
     */
    editChartMetadata(chartId) {
        const chart = storage.getChart(chartId);
        if (!chart) {
            alert('Chart not found');
            return;
        }

        this.editingChartId = chartId;
        document.getElementById('modalTitle').textContent = 'Edit Chart Settings';
        document.getElementById('chartName').value = chart.chartName;
        document.getElementById('departmentTag').value = chart.departmentTag || '';
        document.getElementById('description').value = chart.description || '';
        document.getElementById('chartId').value = chartId;
        document.querySelector('#chartForm button[type="submit"]').textContent = 'Save Changes';
        this.showModal();
    }

    /**
     * Show modal
     */
    showModal() {
        document.getElementById('chartModal').classList.add('active');
    }

    /**
     * Close modal
     */
    closeModal() {
        document.getElementById('chartModal').classList.remove('active');
        document.getElementById('chartForm').reset();
        this.editingChartId = null;
    }

    /**
     * Save chart (create or update)
     */
    saveChart(event) {
        event.preventDefault();

        const chartName = document.getElementById('chartName').value.trim();
        const departmentTag = document.getElementById('departmentTag').value.trim();
        const description = document.getElementById('description').value.trim();
        const chartId = this.editingChartId;

        if (!chartName) {
            alert('Please enter a chart name');
            return;
        }

        if (chartId) {
            // Update existing chart metadata
            storage.updateChart(chartId, {
                chartName,
                departmentTag,
                description
            });
        } else {
            // Create new chart with a default root node (new multi-person format)
            const newChart = storage.createChart({
                chartName,
                departmentTag,
                description,
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
            });

            // Redirect to chart editor
            window.location.href = `chart-editor.html?id=${newChart.chartId}`;
            return;
        }

        this.closeModal();
        this.loadDepartments();
        this.renderCharts();
    }

    /**
     * Open chart in editor
     */
    openChart(chartId) {
        window.location.href = `chart-editor.html?id=${chartId}`;
    }

    /**
     * Duplicate chart
     */
    duplicateChart(chartId) {
        if (confirm('Create a duplicate of this chart?')) {
            const duplicated = storage.duplicateChart(chartId);
            if (duplicated) {
                this.renderCharts();
                alert('Chart duplicated successfully!');
            } else {
                alert('Failed to duplicate chart');
            }
        }
    }

    /**
     * Delete chart
     */
    deleteChart(chartId) {
        const chart = storage.getChart(chartId);
        if (!chart) return;

        if (confirm(`Are you sure you want to delete "${chart.chartName}"? This cannot be undone.`)) {
            if (storage.deleteChart(chartId)) {
                this.renderCharts();
                this.loadDepartments();
            } else {
                alert('Failed to delete chart');
            }
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
     * Import data from backup
     */
    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = event.target.result;
                    if (confirm('This will replace all existing data. Continue?')) {
                        if (storage.importData(data)) {
                            alert('Data imported successfully!');
                            this.loadDepartments();
                            this.renderCharts();
                        } else {
                            alert('Failed to import data. Please check the file format.');
                        }
                    }
                } catch (error) {
                    alert('Failed to import data: ' + error.message);
                }
            };
            reader.readAsText(file);
        };

        input.click();
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
                { url: 'https://d3js.org/d3.v7.min.js', check: () => typeof d3 !== 'undefined' },
                { url: 'https://cdn.jsdelivr.net/npm/d3-flextree@2.1.2/build/d3-flextree.js', check: () => typeof d3.flextree !== 'undefined' },
                { url: 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js', check: () => typeof html2canvas !== 'undefined' },
                { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', check: () => typeof window.jspdf !== 'undefined' },
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
            alert(`Failed to load export libraries: ${error.message}\n\nPlease check your internet connection and try again.`);
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
        // Lazy load dependencies first
        const loaded = await this.loadExportDependencies();
        if (!loaded) {
            return; // Loading failed, error already shown
        }

        if (!this.bulkExportManager) {
            alert('Export manager not initialized');
            return;
        }

        const charts = storage.getChartsArray();

        if (charts.length === 0) {
            alert('No charts available to export');
            return;
        }

        const confirmed = confirm(
            `Export all ${charts.length} chart${charts.length !== 1 ? 's' : ''} to PDF?\n\n` +
            `This may take a few moments depending on chart complexity.`
        );

        if (!confirmed) {
            return;
        }

        try {
            await this.bulkExportManager.exportAllCharts();
        } catch (error) {
            console.error('Bulk export failed:', error);
            alert(`Export failed: ${error.message}`);
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
            alert('Export manager not initialized');
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
            alert('Export manager not initialized');
            return;
        }

        try {
            const charts = await this.bulkExportManager.debugListCharts();
            console.log('\n📊 To preview a chart, use:');
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
        console.log('%c📊 Org Chart Dashboard', 'font-size: 16px; font-weight: bold; color: #2563eb;');
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
