/**
 * Storage Module - Handles all data persistence operations
 * Uses localStorage for V1, easily upgradeable to Firestore
 */

class ChartStorage {
    constructor() {
        this.storageKey = 'orgCharts';
        this.initStorage();
    }

    /**
     * Initialize storage if it doesn't exist
     */
    initStorage() {
        if (!localStorage.getItem(this.storageKey)) {
            localStorage.setItem(this.storageKey, JSON.stringify({}));
        }
    }

    /**
     * Generate unique ID for charts
     */
    generateId() {
        return `chart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate unique ID for nodes
     */
    generateNodeId() {
        return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Migrate legacy node to new multi-person format
     * @param {Object} node - Legacy node object
     * @returns {Object} Migrated node object
     */
    migrateNode(node) {
        // Check if already migrated (has members field)
        if (node.members && Array.isArray(node.members)) {
            return node;
        }

        // Migrate legacy single-person node
        const migratedNode = {
            id: node.id,
            parentId: node.parentId || null,
            members: [],
            meta: {
                department: node.department || '',
                notes: node.description || ''
            }
        };

        // Convert legacy name/title to first member
        if (node.name || node.title) {
            migratedNode.members.push({
                roleLabel: node.title || 'Team Member',
                entries: [{
                    name: node.name || 'Unnamed',
                    email: node.email || '',
                    phone: node.phone || '',
                    photoUrl: ''
                }]
            });
        }

        return migratedNode;
    }

    /**
     * Create a new chart
     * @param {Object} chartData - Chart data
     * @returns {Object} Created chart object
     */
    createChart(chartData) {
        const charts = this.getAllCharts();
        const chartId = this.generateId();

        // Migrate nodes to new format if needed
        let nodes = chartData.nodes || [];
        nodes = nodes.map(node => this.migrateNode(node));

        const newChart = {
            chartId: chartId,
            chartName: chartData.chartName || 'Untitled Chart',
            departmentTag: chartData.departmentTag || '',
            description: chartData.description || '',
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            nodes: nodes,
            viewState: chartData.viewState || {
                zoom: 1,
                pan: { x: 0, y: 0 },
                collapsedNodes: []
            },
            layout: chartData.layout || 'top',
            connections: chartData.connections || []
        };

        charts[chartId] = newChart;
        localStorage.setItem(this.storageKey, JSON.stringify(charts));

        return newChart;
    }

    /**
     * Read/Get a chart by ID
     * @param {string} chartId - Chart ID
     * @returns {Object|null} Chart object or null if not found
     */
    getChart(chartId) {
        const charts = this.getAllCharts();
        const chart = charts[chartId] || null;

        // Auto-migrate nodes on load
        if (chart && chart.nodes) {
            chart.nodes = chart.nodes.map(node => this.migrateNode(node));
        }

        return chart;
    }

    /**
     * Get all charts
     * @returns {Object} All charts
     */
    getAllCharts() {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : {};
    }

    /**
     * Get charts as array sorted by last modified
     * @returns {Array} Array of chart objects
     */
    getChartsArray() {
        const charts = this.getAllCharts();
        return Object.values(charts).sort((a, b) =>
            new Date(b.lastModified) - new Date(a.lastModified)
        );
    }

    /**
     * Update an existing chart
     * @param {string} chartId - Chart ID
     * @param {Object} updates - Updates to apply
     * @returns {Object|null} Updated chart or null if not found
     */
    updateChart(chartId, updates) {
        const charts = this.getAllCharts();

        if (!charts[chartId]) {
            console.error(`Chart ${chartId} not found`);
            return null;
        }

        charts[chartId] = {
            ...charts[chartId],
            ...updates,
            lastModified: new Date().toISOString()
        };

        localStorage.setItem(this.storageKey, JSON.stringify(charts));
        return charts[chartId];
    }

    /**
     * Delete a chart
     * @param {string} chartId - Chart ID
     * @returns {boolean} Success status
     */
    deleteChart(chartId) {
        const charts = this.getAllCharts();

        if (!charts[chartId]) {
            console.error(`Chart ${chartId} not found`);
            return false;
        }

        delete charts[chartId];
        localStorage.setItem(this.storageKey, JSON.stringify(charts));
        return true;
    }

    /**
     * Duplicate a chart
     * @param {string} chartId - Chart ID to duplicate
     * @returns {Object|null} New duplicated chart or null if original not found
     */
    duplicateChart(chartId) {
        const originalChart = this.getChart(chartId);

        if (!originalChart) {
            console.error(`Chart ${chartId} not found`);
            return null;
        }

        const duplicateData = {
            ...originalChart,
            chartName: `${originalChart.chartName} (Copy)`,
        };

        delete duplicateData.chartId;
        delete duplicateData.createdAt;
        delete duplicateData.lastModified;

        return this.createChart(duplicateData);
    }

    /**
     * Search charts by name or department
     * @param {string} query - Search query
     * @returns {Array} Matching charts
     */
    searchCharts(query) {
        const charts = this.getChartsArray();
        const lowerQuery = query.toLowerCase();

        return charts.filter(chart =>
            chart.chartName.toLowerCase().includes(lowerQuery) ||
            (chart.departmentTag && chart.departmentTag.toLowerCase().includes(lowerQuery)) ||
            (chart.description && chart.description.toLowerCase().includes(lowerQuery))
        );
    }

    /**
     * Get charts by department tag
     * @param {string} departmentTag - Department tag
     * @returns {Array} Matching charts
     */
    getChartsByDepartment(departmentTag) {
        const charts = this.getChartsArray();
        return charts.filter(chart => chart.departmentTag === departmentTag);
    }

    /**
     * Get all unique department tags
     * @returns {Array} Array of unique department tags
     */
    getAllDepartments() {
        const charts = this.getChartsArray();
        const departments = new Set();

        charts.forEach(chart => {
            if (chart.departmentTag) {
                departments.add(chart.departmentTag);
            }
        });

        return Array.from(departments).sort();
    }

    /**
     * Export all data as JSON (for backup)
     * @returns {string} JSON string of all data
     */
    exportAllData() {
        return localStorage.getItem(this.storageKey);
    }

    /**
     * Import data from JSON (for restore)
     * @param {string} jsonData - JSON string to import
     * @returns {boolean} Success status
     */
    importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            localStorage.setItem(this.storageKey, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Failed to import data:', error);
            return false;
        }
    }

    /**
     * Clear all charts (use with caution!)
     * @returns {boolean} Success status
     */
    clearAllCharts() {
        if (confirm('Are you sure you want to delete ALL charts? This cannot be undone!')) {
            localStorage.setItem(this.storageKey, JSON.stringify({}));
            return true;
        }
        return false;
    }
}

// Export for use in other modules
const storage = new ChartStorage();
