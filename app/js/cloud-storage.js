/**
 * Cloud Storage Module
 *
 * Handles cloud-based chart persistence using Azure Functions backend
 * Works alongside localStorage for hybrid local/cloud storage
 */

class CloudStorage {
    constructor() {
        this.syncEnabled = false;
        this.lastSyncTime = null;
    }

    /**
     * Check if cloud storage is available (user is authenticated)
     */
    isAvailable() {
        return window.apiClient && window.apiClient.isAuthenticated;
    }

    /**
     * Enable auto-sync for charts
     */
    enableSync() {
        this.syncEnabled = true;
        console.log('Cloud sync enabled');
    }

    /**
     * Disable auto-sync
     */
    disableSync() {
        this.syncEnabled = false;
        console.log('Cloud sync disabled');
    }

    /**
     * Save a chart to the cloud
     * @param {string} chartId - Chart ID (optional for new charts)
     * @param {string} name - Chart name
     * @param {object} data - Chart data (nodes, layout, etc.)
     * @returns {Promise<object>} Save result with chartId
     */
    async saveChart(chartId, name, data) {
        if (!this.isAvailable()) {
            throw new Error('Cloud storage not available. Please log in.');
        }

        try {
            let result;

            if (chartId) {
                // Update existing chart
                result = await window.apiClient.updateChart(chartId, name, data);
                window.toast?.success('Chart saved to cloud');
            } else {
                // Create new chart
                result = await window.apiClient.createChart(name, data);
                window.toast?.success('Chart created and saved to cloud');
            }

            this.lastSyncTime = new Date();
            return result;

        } catch (error) {
            console.error('Failed to save chart to cloud:', error);
            window.toast?.error(`Cloud save failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Load a chart from the cloud
     * @param {string} chartId - Chart ID
     * @returns {Promise<object>} Chart data
     */
    async loadChart(chartId) {
        if (!this.isAvailable()) {
            throw new Error('Cloud storage not available. Please log in.');
        }

        try {
            const chart = await window.apiClient.getChart(chartId);
            console.log('Chart loaded from cloud:', chart.name);
            return chart;

        } catch (error) {
            console.error('Failed to load chart from cloud:', error);
            window.toast?.error(`Cloud load failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all charts from the cloud
     * @returns {Promise<Array>} Array of chart metadata
     */
    async getAllCharts() {
        if (!this.isAvailable()) {
            return [];
        }

        try {
            const response = await window.apiClient.getCharts();
            // Handle both old (array) and new (object with .charts) response formats
            const charts = Array.isArray(response) ? response : (response?.charts || []);
            console.log(`Loaded ${charts.length} charts from cloud`);
            this.lastSyncTime = new Date();
            return charts;

        } catch (error) {
            console.error('Failed to get charts from cloud:', error);
            window.toast?.error(`Failed to load cloud charts: ${error.message}`);
            return [];
        }
    }

    /**
     * Delete a chart from the cloud (soft delete with 90-day recovery)
     * @param {string} chartId - Chart ID
     * @returns {Promise<object>} Delete result
     */
    async deleteChart(chartId) {
        if (!this.isAvailable()) {
            throw new Error('Cloud storage not available. Please log in.');
        }

        try {
            const result = await window.apiClient.deleteChart(chartId);
            window.toast?.info(`Chart deleted (recoverable for 90 days)`);
            return result;

        } catch (error) {
            console.error('Failed to delete chart from cloud:', error);
            window.toast?.error(`Cloud delete failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Share a chart with another user
     * @param {string} chartId - Chart ID
     * @param {string} userEmail - User email to share with
     * @param {string} role - Role to grant ('viewer' or 'editor')
     * @returns {Promise<object>} Share result
     */
    async shareChart(chartId, userEmail, role = 'viewer') {
        if (!this.isAvailable()) {
            throw new Error('Cloud storage not available. Please log in.');
        }

        try {
            // In production, you'd need to resolve email to userId via an API call
            // For now, we'll use email as userId (this should be updated later)
            const result = await window.apiClient.shareChart(chartId, userEmail, role);
            window.toast?.success(`Chart shared with ${userEmail} as ${role}`);
            return result;

        } catch (error) {
            console.error('Failed to share chart:', error);
            window.toast?.error(`Share failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Sync local chart to cloud
     * @param {string} localChartId - Local chart ID
     * @param {object} chartData - Full chart object from localStorage
     * @returns {Promise<object>} Sync result
     */
    async syncLocalToCloud(localChartId, chartData) {
        if (!this.isAvailable()) {
            return { synced: false, reason: 'Not authenticated' };
        }

        try {
            // Check if chart already has a cloud ID (stored in metadata)
            const cloudChartId = chartData.cloudId || null;

            const result = await this.saveChart(
                cloudChartId,
                chartData.name,
                {
                    nodes: chartData.nodes,
                    layout: chartData.layout || 'vertical',
                    theme: chartData.theme || 'default',
                    metadata: {
                        localId: localChartId,
                        lastModified: chartData.lastModified || new Date().toISOString(),
                        createdAt: chartData.createdAt || new Date().toISOString()
                    }
                }
            );

            // Update local storage with cloud ID
            if (result.chartId && window.storage) {
                const updatedChart = {
                    ...chartData,
                    cloudId: result.chartId,
                    lastSynced: new Date().toISOString()
                };
                window.storage.updateChart(localChartId, updatedChart);
            }

            return { synced: true, cloudChartId: result.chartId };

        } catch (error) {
            console.error('Sync failed:', error);
            return { synced: false, reason: error.message };
        }
    }

    /**
     * Sync cloud chart to local storage
     * @param {string} cloudChartId - Cloud chart ID
     * @returns {Promise<object>} Sync result
     */
    async syncCloudToLocal(cloudChartId) {
        if (!this.isAvailable()) {
            return { synced: false, reason: 'Not authenticated' };
        }

        try {
            const cloudChart = await this.loadChart(cloudChartId);

            // Check if chart already exists locally
            const localId = cloudChart.data.metadata?.localId;
            let localChartId;

            if (localId && window.storage.getChart(localId)) {
                // Update existing local chart
                localChartId = localId;
                window.storage.updateChart(localId, {
                    name: cloudChart.name,
                    nodes: cloudChart.data.nodes,
                    layout: cloudChart.data.layout,
                    theme: cloudChart.data.theme,
                    cloudId: cloudChartId,
                    lastModified: cloudChart.lastModified,
                    lastSynced: new Date().toISOString()
                });
            } else {
                // Create new local chart
                const newChart = window.storage.createChart({
                    name: cloudChart.name,
                    nodes: cloudChart.data.nodes,
                    layout: cloudChart.data.layout,
                    theme: cloudChart.data.theme,
                    cloudId: cloudChartId,
                    lastModified: cloudChart.lastModified,
                    lastSynced: new Date().toISOString()
                });
                localChartId = newChart.id;
            }

            return { synced: true, localChartId };

        } catch (error) {
            console.error('Sync from cloud failed:', error);
            return { synced: false, reason: error.message };
        }
    }

    /**
     * Get sync status
     * @returns {object} Sync status information
     */
    getSyncStatus() {
        return {
            enabled: this.syncEnabled,
            available: this.isAvailable(),
            lastSync: this.lastSyncTime,
            authenticated: window.apiClient?.isAuthenticated || false,
            user: window.currentUser?.userDetails || null
        };
    }
}

// Create global instance
window.cloudStorage = new CloudStorage();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CloudStorage;
}
