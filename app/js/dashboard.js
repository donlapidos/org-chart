/**
 * Dashboard Application Logic
 * Handles chart listing, creation, and management
 */

class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.init();
    }

    init() {
        this.loadDepartments();
        this.renderCharts();
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
        const lastModified = new Date(chart.lastModified).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

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

        return `
            <div class="chart-card" onclick="app.openChart('${chart.chartId}')">
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
                <div class="chart-card-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="app.openChart('${chart.chartId}')">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="app.duplicateChart('${chart.chartId}')">
                        📋 Duplicate
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="app.editChartMetadata('${chart.chartId}')">
                        ⚙️ Settings
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteChart('${chart.chartId}')">
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
}

// Initialize app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new DashboardApp();
});
