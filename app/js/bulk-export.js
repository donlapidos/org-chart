/**
 * Bulk Export Manager - Export All Charts to Single PDF
 * Renders each chart off-screen and combines into one PDF document
 */

class BulkExportManager {
    constructor(storage) {
        this.storage = storage;
        this.isExporting = false;
        this.shouldCancel = false;
        this.currentChart = 0;
        this.totalCharts = 0;
        this.capturedCharts = [];
        this.templateConfigPromise = null;
        this.stylesheetCache = null;
        this.cssVariablesCache = null;

        // Minimum scale to maintain text readability (0.8 = 80% of original size)
        this.MIN_EXPORT_SCALE = 0.8;

        // Create hidden container for rendering
        this.setupHiddenContainer();
    }

    /**
     * Create hidden DOM container for off-screen rendering
     */
    setupHiddenContainer() {
        // Remove existing if present
        const existing = document.getElementById('bulk-export-container');
        if (existing) {
            existing.remove();
        }

        // Create new hidden container
        const container = document.createElement('div');
        container.id = 'bulk-export-container';
        container.style.cssText = `
            position: fixed;
            left: -9999px;
            top: -9999px;
            width: 0;
            height: 0;
            overflow: hidden;
            visibility: hidden;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    /**
     * Fetch and cache the main stylesheet content
     * Includes both base styles and modernization styles for consistent rendering
     * @returns {Promise<string>} The CSS content
     */
    async fetchStylesheet() {
        if (this.stylesheetCache) {
            return this.stylesheetCache;
        }

        try {
            // Fetch both base styles and modernization styles in parallel
            const [baseResponse, modernResponse] = await Promise.all([
                fetch('css/styles.css'),
                fetch('css/modernization-styles.css')
            ]);

            if (!baseResponse.ok) {
                throw new Error(`Failed to fetch styles.css: ${baseResponse.statusText}`);
            }

            const baseCSS = await baseResponse.text();

            // Modernization styles are optional - continue if not found
            let modernCSS = '';
            if (modernResponse.ok) {
                modernCSS = await modernResponse.text();
            } else {
                console.warn('modernization-styles.css not found, using base styles only');
            }

            // Combine stylesheets (modernization styles override base if there are conflicts)
            this.stylesheetCache = `${baseCSS}\n\n/* Modernization Styles */\n${modernCSS}`;
            return this.stylesheetCache;
        } catch (error) {
            console.warn('Failed to fetch stylesheets, using fallback styles', error);
            return '';
        }
    }

    /**
     * Extract and resolve CSS variables from the stylesheet
     * @returns {Object} Map of CSS variable names to resolved values
     */
    async getResolvedCSSVariables() {
        if (this.cssVariablesCache) {
            return this.cssVariablesCache;
        }

        // Create a temporary element to compute CSS variables
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position: absolute; visibility: hidden;';
        document.body.appendChild(tempDiv);

        const computedStyle = getComputedStyle(tempDiv);

        // Extract ALL CSS variables from :root (including RRC brand colors)
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

            // Primary/Accent color scale - CRITICAL for node header gradients
            '--primary-500': computedStyle.getPropertyValue('--primary-500') || '#0085f2',
            '--primary-700': computedStyle.getPropertyValue('--primary-700') || '#0066bd',
            '--accent-500': computedStyle.getPropertyValue('--accent-500') || '#ff6900',

            // RRC Brand Colors - critical for node styling
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

        this.cssVariablesCache = variables;
        return variables;
    }

    /**
     * Resolve CSS variables in a stylesheet string
     * @param {string} cssText - The CSS content with variables
     * @param {Object} variables - Map of variable names to values
     * @returns {string} CSS with resolved variables
     */
    resolveCSSVariables(cssText, variables) {
        let resolved = cssText;

        // Replace all var(--variable-name) with actual values
        for (const [varName, value] of Object.entries(variables)) {
            const regex = new RegExp(`var\\(${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
            resolved = resolved.replace(regex, value.trim());
        }

        return resolved;
    }

    async getTemplateConfig() {
        if (typeof ExportTemplate === 'undefined') {
            throw new Error('Export template helpers not loaded.');
        }
        if (!this.templateConfigPromise) {
            this.templateConfigPromise = ExportTemplate.loadTemplateConfig();
        }
        return this.templateConfigPromise;
    }

    /**
     * Main export function - orchestrates entire process
     * @param {string} quality - Quality setting: 'low', 'medium', 'high'
     */
    async exportAllCharts(quality = 'medium') {
        if (this.isExporting) {
            alert('Export already in progress');
            return;
        }

        // Quality to scale mapping (lower scale = smaller file size)
        // PNG format preserves line fidelity; scale 1.5 keeps images under jsPDF string limit
        const qualitySettings = {
            'low': { scale: 1.0, compression: 0.75, format: 'PNG' },     // ~1-2 MB per chart, draft quality
            'medium': { scale: 1.5, compression: 0.95, format: 'PNG' },  // ~2-4 MB per chart, good fidelity
            'high': { scale: 2.0, compression: 0.95, format: 'PNG' },    // ~5-8 MB per chart, high fidelity
            'print': { scale: 2.5, compression: 0.98, format: 'PNG' }    // ~10-15 MB per chart, print-ready quality
        };

        this.exportQuality = qualitySettings[quality] || qualitySettings.medium;

        try {
            this.isExporting = true;
            this.shouldCancel = false;
            this.currentChart = 0;
            this.capturedCharts = [];

            // Show progress modal
            this.showProgressModal();

            // Step 1: Fetch all charts
            this.updateProgress('Fetching charts...', 0);
            const charts = await this.fetchAllCharts();

            if (charts.length === 0) {
                throw new Error('No charts found to export');
            }

            this.totalCharts = charts.length;
            this.updateProgress(`Found ${charts.length} charts`, 0);

            // Guard: large exports + PNG can exceed JS string limits in jsPDF
            const LARGE_EXPORT_THRESHOLD = 30;
            if (charts.length >= LARGE_EXPORT_THRESHOLD && this.exportQuality.format === 'PNG') {
                const previousQuality = { ...this.exportQuality };
                this.exportQuality = {
                    ...this.exportQuality,
                    format: 'JPEG',
                    compression: Math.min(this.exportQuality.compression, 0.9),
                    scale: Math.min(this.exportQuality.scale, 1.5)
                };
                console.warn(`[Export] Large export (${charts.length} charts). Switching from ${previousQuality.format} to JPEG at ${this.exportQuality.scale}x to prevent PDF memory errors.`);
                window.toast?.warning?.(
                    `Large export detected (${charts.length} charts). Using JPEG at ${this.exportQuality.scale}x to avoid PDF memory limits.`
                );
            }

            // Step 2: Render and capture each chart
            for (let i = 0; i < charts.length; i++) {
                if (this.shouldCancel) {
                    throw new Error('Export cancelled by user');
                }

                this.currentChart = i + 1;
                const chart = charts[i];

                this.updateProgress(
                    `Rendering "${chart.chartName}"...`,
                    (i / charts.length) * 80 // 0-80% for rendering
                );

                try {
                    const snapshot = await this.renderChartOffScreen(chart);
                    this.capturedCharts.push({
                        id: chart.chartId,
                        title: chart.chartName,
                        department: chart.departmentTag || '',
                        description: chart.description || '',
                        nodeCount: chart.nodes?.length || 0,
                        peopleCount: this.countPeople(chart.nodes),
                        lastModified: chart.lastModified,
                        coverId: chart.coverId || null,
                        coverOrderIndex: chart.coverOrderIndex ?? null,
                        createdAt: chart.createdAt || chart.lastModified,
                        chartData: chart,
                        snapshot
                    });
                } catch (error) {
                    console.error(`Failed to render chart "${chart.chartName}":`, error);

                    // Ask user if they want to continue
                    const shouldContinue = confirm(
                        `Failed to render chart "${chart.chartName}".\n\nError: ${error.message}\n\nContinue with remaining charts?`
                    );

                    if (!shouldContinue) {
                        throw new Error('Export aborted after chart rendering failure');
                    }
                }
            }

            if (this.capturedCharts.length === 0) {
                throw new Error('No charts were successfully rendered');
            }

            // Step 3: Assemble PDF
            this.updateProgress('Assembling PDF document...', 85);
            const pdf = await this.assemblePDF();

            // Step 4: Download
            this.updateProgress('Downloading...', 95);
            await this.downloadPDF(pdf);

            this.updateProgress('Complete!', 100);

            // Show success message
            setTimeout(() => {
                this.hideProgressModal();
                this.showSuccessMessage(this.capturedCharts.length);
            }, 1000);

        } catch (error) {
            console.error('Bulk export error:', error);
            this.hideProgressModal();
            alert(`Export failed: ${error.message}`);
        } finally {
            this.isExporting = false;
            this.cleanup();
        }
    }

    /**
     * Fetch all charts from storage
     * Supports both localStorage (current) and Firebase/Firestore (future)
     *
     * @returns {Promise<Array>} Array of chart objects
     */
    async fetchAllCharts() {
        // Priority 1: API client (Cosmos DB via Azure Functions)
        if (window.apiClient && typeof window.apiClient.getCharts === 'function') {
            let allChartMetadata = null;

            // Try to fetch from API
            try {
                // Pagination loop: fetch all pages of charts
                allChartMetadata = [];
                let offset = 0;
                let hasMore = true;
                const limit = 100; // Max allowed by API

                while (hasMore) {
                    const response = await window.apiClient.getCharts({ limit, offset, includeData: true });
                    const chartList = Array.isArray(response) ? response : (response?.charts || []);

                    allChartMetadata = allChartMetadata.concat(chartList);

                    // Check pagination info
                    if (response.pagination) {
                        hasMore = response.pagination.hasMore;
                        offset += limit;
                        console.log(`[BulkExport] Fetched ${chartList.length} charts (${allChartMetadata.length} total, hasMore: ${hasMore})`);
                    } else {
                        // No pagination info - assume single page
                        hasMore = false;
                    }
                }

                console.log(`[BulkExport] API returned ${allChartMetadata.length} total charts`);
            } catch (error) {
                console.error('[BulkExport] API call failed:', error);
                allChartMetadata = null;  // Signal API failure
            }

            // If API succeeded, process the data (do NOT fall back to localStorage)
            if (allChartMetadata !== null) {
                console.log('[BulkExport] Using API charts only (not using localStorage)');

                // Export all charts returned by the API (viewer access is sufficient for export)
                const exportableCharts = allChartMetadata.filter(chartMeta => chartMeta && chartMeta.id);
                console.log(`[BulkExport] Charts available for export: ${exportableCharts.length}`);

                // NOTE: If includeData is not supported by the backend, chartMeta.data will be missing.
                // Fall back to per-chart fetches in that case.
                const chartsWithData = new Array(exportableCharts.length);
                const chartsNeedingFetch = [];

                exportableCharts.forEach((chartMeta, index) => {
                    const chartData = chartMeta.data;

                    if (chartData && typeof chartData === 'object') {
                        chartsWithData[index] = {
                            chartId: chartMeta.id,
                            chartName: chartMeta.name || chartData.chartName || 'Untitled',
                            departmentTag: chartData.departmentTag || '',
                            description: chartData.description || '',
                            coverId: chartData.coverId || null,
                            coverOrderIndex: chartData.coverOrderIndex ?? null,
                            exportOrder: chartData.exportOrder ?? null,
                            nodes: chartData.nodes || [],
                            layout: chartData.layout || 'top',
                            viewState: chartData.viewState || {},
                            lastModified: chartMeta.lastModified || chartData.lastModified,
                            createdAt: chartMeta.createdAt || chartData.createdAt || chartMeta.lastModified
                        };
                    } else {
                        chartsNeedingFetch.push({ chartMeta, index });
                    }
                });

                if (chartsNeedingFetch.length > 0) {
                    console.warn(`[BulkExport] includeData unavailable for ${chartsNeedingFetch.length} charts; falling back to per-chart fetch.`);
                }

                for (const { chartMeta, index } of chartsNeedingFetch) {
                    try {
                        const fullResponse = await window.apiClient.getChart(chartMeta.id);
                        const fullChart = fullResponse.chart || fullResponse;
                        const chartData = fullChart.data || {};

                        chartsWithData[index] = {
                            chartId: chartMeta.id,
                            chartName: chartMeta.name || chartData.chartName || 'Untitled',
                            departmentTag: chartData.departmentTag || '',
                            description: chartData.description || '',
                            coverId: chartData.coverId || null,
                            coverOrderIndex: chartData.coverOrderIndex ?? null,
                            exportOrder: chartData.exportOrder ?? null,
                            nodes: chartData.nodes || [],
                            layout: chartData.layout || 'top',
                            viewState: chartData.viewState || {},
                            lastModified: chartMeta.lastModified || fullChart.lastModified,
                            createdAt: chartMeta.createdAt || chartData.createdAt || chartMeta.lastModified
                        };
                    } catch (error) {
                        console.warn(`[BulkExport] Failed to fetch chart ${chartMeta.id}:`, error);
                        // Skip this chart but continue with others
                    }
                }

                const apiCharts = chartsWithData.filter(Boolean);
                console.log(`[BulkExport] Returning ${apiCharts.length} API charts`);
                return apiCharts;
            }
        }

        // Priority 2: localStorage (legacy/fallback - only used if API unavailable or failed)
        console.log('[BulkExport] Falling back to localStorage');
        if (typeof this.storage.getChartsArray === 'function') {
            return this.storage.getChartsArray();
        }

        // Priority 3: Firestore (future implementation with authentication)
        if (typeof this.storage.getAllCharts === 'function') {
            try {
                // Check if user is authenticated (Firebase)
                if (this.storage.getCurrentUser && typeof this.storage.getCurrentUser === 'function') {
                    const currentUser = this.storage.getCurrentUser();

                    if (!currentUser) {
                        throw new Error('User not authenticated. Please sign in to export charts.');
                    }

                    // Verify user is active/whitelisted
                    if (this.storage.isUserActive && typeof this.storage.isUserActive === 'function') {
                        const isActive = await this.storage.isUserActive(currentUser.uid);
                        if (!isActive) {
                            throw new Error('Your account is not active. Please contact an administrator.');
                        }
                    }

                    // Get user role for permission checking
                    let userRole = 'viewer'; // Default to most restrictive
                    if (this.storage.getUserRole && typeof this.storage.getUserRole === 'function') {
                        userRole = await this.storage.getUserRole(currentUser.uid);
                    }

                    // Note: For bulk export, we fetch ALL charts since all authenticated users
                    // can view all charts (per the shared dashboard model in FIREBASE_MIGRATION_PLAN.md)
                    // The role only affects create/edit/delete permissions, not viewing
                    console.log(`[BulkExport] User ${currentUser.email} (${userRole}) fetching all charts for export`);
                }

                // Fetch all charts from Firestore
                const charts = await this.storage.getAllCharts();

                // Convert object to array if needed
                const chartsArray = Array.isArray(charts) ? charts : Object.values(charts);

                // Filter out any invalid/null entries
                return chartsArray.filter(chart => chart && chart.chartId && chart.chartName);

            } catch (error) {
                console.error('[BulkExport] Firebase fetch error:', error);
                throw new Error(`Failed to fetch charts: ${error.message}`);
            }
        }

        throw new Error('Storage method not available');
    }

    /**
     * Measure the actual content bounding box of an SVG including nodes and links
     * Returns the tight bounds of all chart elements in SVG coordinate space.
     *
     * FIX: Uses CTM (Current Transformation Matrix) instead of fragile regex parsing
     * to correctly compute element positions in SVG coordinate space.
     */
    measureSvgContentBounds(svgElement) {
        console.log('=== MEASURING SVG CONTENT BOUNDS (CTM method) ===');
        if (!svgElement) {
            console.error('[Bounds] No SVG element provided');
            return null;
        }

        try {
            const svgRect = svgElement.getBoundingClientRect();
            const originalWidth = svgRect.width || parseInt(svgElement.getAttribute('width')) || 2000;
            const originalHeight = svgRect.height || parseInt(svgElement.getAttribute('height')) || 1128;

            // Use tighter selectors to avoid nested elements and defs
            const nodesWrapper = svgElement.querySelector('g.nodes-wrapper');
            const linksWrapper = svgElement.querySelector('g.links-wrapper');

            const nodeElements = nodesWrapper ? nodesWrapper.querySelectorAll(':scope > g.node') : [];
            const linkElements = linksWrapper ? linksWrapper.querySelectorAll(':scope > path.link') : [];

            console.log(`[Bounds] Found ${nodeElements.length} nodes, ${linkElements.length} links`);

            if (nodeElements.length === 0) {
                console.log('[Bounds] No nodes found, using SVG dimensions');
                return {
                    x: 0,
                    y: 0,
                    width: originalWidth,
                    height: originalHeight,
                    originalWidth,
                    originalHeight,
                    margin: 20
                };
            }

            // Get the SVG's CTM to use as reference for inverse transforms
            const svgCTM = svgElement.getScreenCTM();
            if (!svgCTM) {
                console.warn('[Bounds] Could not get SVG CTM, falling back to SVG dimensions');
                return {
                    x: 0, y: 0, width: originalWidth, height: originalHeight,
                    originalWidth, originalHeight, margin: 20
                };
            }
            const svgCTMInverse = svgCTM.inverse();

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            /**
             * Transform a point from element's local coordinate space to SVG coordinate space
             * using the element's CTM (Current Transformation Matrix).
             */
            const transformPointToSvg = (element, localX, localY) => {
                const elementCTM = element.getScreenCTM();
                if (!elementCTM) return null;

                // Transform local point to screen coordinates
                const screenX = elementCTM.a * localX + elementCTM.c * localY + elementCTM.e;
                const screenY = elementCTM.b * localX + elementCTM.d * localY + elementCTM.f;

                // Transform screen coordinates back to SVG coordinate space
                const svgX = svgCTMInverse.a * screenX + svgCTMInverse.c * screenY + svgCTMInverse.e;
                const svgY = svgCTMInverse.b * screenX + svgCTMInverse.d * screenY + svgCTMInverse.f;

                return { x: svgX, y: svgY };
            };

            /**
             * Get the effective scale from an element's CTM
             */
            const getEffectiveScale = (element) => {
                const ctm = element.getScreenCTM();
                if (!ctm) return 1;
                // Scale is the magnitude of the transform's a/d components
                return Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b);
            };

            // Process nodes using CTM
            nodeElements.forEach(node => {
                try {
                    const bbox = node.getBBox();
                    const scale = getEffectiveScale(node);

                    // Transform all four corners of the bounding box
                    const corners = [
                        { x: bbox.x, y: bbox.y },
                        { x: bbox.x + bbox.width, y: bbox.y },
                        { x: bbox.x, y: bbox.y + bbox.height },
                        { x: bbox.x + bbox.width, y: bbox.y + bbox.height }
                    ];

                    corners.forEach(corner => {
                        const svgPoint = transformPointToSvg(node, corner.x, corner.y);
                        if (svgPoint) {
                            minX = Math.min(minX, svgPoint.x);
                            minY = Math.min(minY, svgPoint.y);
                            maxX = Math.max(maxX, svgPoint.x);
                            maxY = Math.max(maxY, svgPoint.y);
                        }
                    });
                } catch (e) {
                    console.warn('[Bounds] Error processing node:', e.message);
                }
            });

            // Process links using CTM
            linkElements.forEach(link => {
                try {
                    const bbox = link.getBBox();

                    // Transform all four corners
                    const corners = [
                        { x: bbox.x, y: bbox.y },
                        { x: bbox.x + bbox.width, y: bbox.y },
                        { x: bbox.x, y: bbox.y + bbox.height },
                        { x: bbox.x + bbox.width, y: bbox.y + bbox.height }
                    ];

                    corners.forEach(corner => {
                        const svgPoint = transformPointToSvg(link, corner.x, corner.y);
                        if (svgPoint) {
                            minX = Math.min(minX, svgPoint.x);
                            minY = Math.min(minY, svgPoint.y);
                            maxX = Math.max(maxX, svgPoint.x);
                            maxY = Math.max(maxY, svgPoint.y);
                        }
                    });
                } catch (e) {
                    // Skip links that can't be measured
                }
            });

            // Add minimal padding around content for visual breathing room
            const padding = 20;

            console.log(`[Bounds] Before padding: minX=${minX.toFixed(1)}, minY=${minY.toFixed(1)}, maxX=${maxX.toFixed(1)}, maxY=${maxY.toFixed(1)}`);

            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;

            console.log(`[Bounds] Final SVG bounds: x=${minX.toFixed(1)}, y=${minY.toFixed(1)}, w=${contentWidth.toFixed(1)}, h=${contentHeight.toFixed(1)}`);
            console.log(`[Bounds] SVG viewport: ${originalWidth}×${originalHeight}`);

            // Log overlap check for debugging
            const overlapX = Math.max(0, Math.min(maxX, originalWidth) - Math.max(minX, 0));
            const overlapY = Math.max(0, Math.min(maxY, originalHeight) - Math.max(minY, 0));
            const overlapArea = overlapX * overlapY;
            const contentArea = contentWidth * contentHeight;
            const overlapPercent = contentArea > 0 ? (overlapArea / contentArea * 100).toFixed(1) : 0;
            console.log(`[Bounds] Overlap with viewport: ${overlapPercent}% (${overlapX.toFixed(0)}×${overlapY.toFixed(0)}px)`);

            return {
                x: minX,
                y: minY,
                width: contentWidth,
                height: contentHeight,
                originalWidth,
                originalHeight,
                margin: padding
            };
        } catch (error) {
            console.error('=== ERROR IN MEASURE BOUNDS ===', error);
            console.error('[Export] Failed to measure SVG bounds:', error.message, error.stack);
            return {
                x: 0,
                y: 0,
                width: 2000,
                height: 1128,
                originalWidth: 2000,
                originalHeight: 1128,
                margin: 20
            };
        }
    }

    /**
     * Measure overlay bounds relative to SVG container
     * @param {HTMLElement} overlay - The .export-node-overlay element
     * @param {SVGElement} svgNode - The SVG element for reference positioning
     * @returns {Object} Bounds {x, y, width, height} or null if not measurable
     */
    measureDomNodeBounds(svgNode) {
        if (!svgNode) {
            return null;
        }

        const nodeElements = svgNode.querySelectorAll('g.node');
        if (!nodeElements.length) {
            return null;
        }

        const svgRect = svgNode.getBoundingClientRect();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        nodeElements.forEach(nodeEl => {
            const rect = nodeEl.getBoundingClientRect();
            const x = rect.left - svgRect.left;
            const y = rect.top - svgRect.top;
            const right = x + rect.width;
            const bottom = y + rect.height;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, bottom);
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            return null;
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Measure overlay bounds relative to SVG container
     * @param {HTMLElement} overlay - The .export-node-overlay element
     * @param {SVGElement} svgNode - The SVG element for reference positioning
     * @returns {Object} Bounds {x, y, width, height} or null if not measurable
     */
    measureOverlayBounds(overlay, svgNode) {
        if (!overlay || !svgNode) {
            return null;
        }

        const nodeWrappers = overlay.querySelectorAll(':scope > div');
        if (nodeWrappers.length === 0) {
            return null;
        }

        const svgRect = svgNode.getBoundingClientRect();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        nodeWrappers.forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            // Position relative to SVG
            const x = rect.left - svgRect.left;
            const y = rect.top - svgRect.top;
            const right = x + rect.width;
            const bottom = y + rect.height;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, bottom);
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            return null;
        }

        const bounds = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };

        console.log(`[Overlay Bounds] ${nodeWrappers.length} wrappers: x=${bounds.x.toFixed(1)}, y=${bounds.y.toFixed(1)}, w=${bounds.width.toFixed(1)}, h=${bounds.height.toFixed(1)}`);
        return bounds;
    }

    /**
     * Disable or expand clip paths so wide charts are not cropped during export.
     * This is export-only and does not affect the editor view.
     */
    disableSvgClipPaths(svgNode, fallbackWidth, fallbackHeight) {
        if (!svgNode) {
            return;
        }

        const rect = svgNode.getBoundingClientRect();
        const svgWidth = fallbackWidth || rect.width || parseInt(svgNode.getAttribute('width')) || 2000;
        const svgHeight = fallbackHeight || rect.height || parseInt(svgNode.getAttribute('height')) || 1128;
        const expand = Math.max(svgWidth, svgHeight) * 2;

        const clipPaths = svgNode.querySelectorAll('clipPath');
        clipPaths.forEach(cp => {
            const clipRect = cp.querySelector('rect');
            if (clipRect) {
                clipRect.setAttribute('x', -expand);
                clipRect.setAttribute('y', -expand);
                clipRect.setAttribute('width', svgWidth + (expand * 2));
                clipRect.setAttribute('height', svgHeight + (expand * 2));
            } else {
                const ns = 'http://www.w3.org/2000/svg';
                const newRect = document.createElementNS(ns, 'rect');
                newRect.setAttribute('x', -expand);
                newRect.setAttribute('y', -expand);
                newRect.setAttribute('width', svgWidth + (expand * 2));
                newRect.setAttribute('height', svgHeight + (expand * 2));
                cp.appendChild(newRect);
            }
        });

        const clippedNodes = svgNode.querySelectorAll('[clip-path], g.nodes-wrapper, g.links-wrapper');
        clippedNodes.forEach(el => {
            if (el.hasAttribute('clip-path')) {
                el.setAttribute('data-export-clip-path', el.getAttribute('clip-path') || '');
                el.removeAttribute('clip-path');
            }
            el.style.clipPath = 'none';
        });

        if (clipPaths.length || clippedNodes.length) {
            console.log(`[Export] Disabled clip paths: defs=${clipPaths.length}, elements=${clippedNodes.length}`);
        }
    }

    getChartTransformTargets(svgNode) {
        if (!svgNode) {
            return [];
        }

        const centerG = svgNode.querySelector('.centerG');
        if (centerG) {
            return [centerG];
        }

        const nodesWrapper = svgNode.querySelector('g.nodes-wrapper');
        const linksWrapper = svgNode.querySelector('g.links-wrapper');

        if (nodesWrapper && linksWrapper && nodesWrapper.parentElement && nodesWrapper.parentElement === linksWrapper.parentElement) {
            return [nodesWrapper.parentElement];
        }

        const targets = [];
        if (nodesWrapper) {
            targets.push(nodesWrapper);
        }
        if (linksWrapper && linksWrapper !== nodesWrapper) {
            targets.push(linksWrapper);
        }
        return targets;
    }

    applyTransformToTargets(targets, translateX, translateY, scale) {
        if (!targets || targets.length === 0) {
            return;
        }
        const transformValue = scale < 1
            ? `translate(${translateX}, ${translateY}) scale(${scale})`
            : `translate(${translateX}, ${translateY})`;
        targets.forEach((target) => {
            target.setAttribute('transform', transformValue);
        });
    }

    /**
     * Compute union of SVG bounds and overlay bounds
     * @param {Object} svgBounds - Bounds from measureSvgContentBounds
     * @param {Object} overlayBounds - Bounds from measureOverlayBounds
     * @returns {Object} Union bounds
     */
    computeUnionBounds(svgBounds, overlayBounds) {
        if (!overlayBounds) {
            return svgBounds;
        }

        const minX = Math.min(svgBounds.x, overlayBounds.x);
        const minY = Math.min(svgBounds.y, overlayBounds.y);
        const maxX = Math.max(svgBounds.x + svgBounds.width, overlayBounds.x + overlayBounds.width);
        const maxY = Math.max(svgBounds.y + svgBounds.height, overlayBounds.y + overlayBounds.height);

        const unionBounds = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            originalWidth: svgBounds.originalWidth,
            originalHeight: svgBounds.originalHeight,
            margin: svgBounds.margin
        };

        console.log(`[Union Bounds] SVG: ${svgBounds.width.toFixed(0)}×${svgBounds.height.toFixed(0)}, Overlay: ${overlayBounds.width.toFixed(0)}×${overlayBounds.height.toFixed(0)}, Union: ${unionBounds.width.toFixed(0)}×${unionBounds.height.toFixed(0)}`);
        return unionBounds;
    }

    /**
     * Compute optimal scale to fill target area while maintaining aspect ratio
     * Aims for 90% fill to leave some margin for aesthetics
     * Ensures no negative offsets (which cause cropping)
     */
    computeOptimalScale(contentBounds, targetWidth, targetHeight, fillPercentage = 0.9) {
        if (!contentBounds || contentBounds.width <= 0 || contentBounds.height <= 0) {
            return { scale: 1, offsetX: 0, offsetY: 0, finalWidth: targetWidth, finalHeight: targetHeight };
        }

        const targetFillWidth = targetWidth * fillPercentage;
        const targetFillHeight = targetHeight * fillPercentage;

        // Calculate scale to fit within target dimensions
        const scaleX = targetFillWidth / contentBounds.width;
        const scaleY = targetFillHeight / contentBounds.height;

        // Use the smaller scale to ensure content fits (never crops)
        let scale = Math.min(scaleX, scaleY);

        // Calculate scaled dimensions
        let scaledWidth = contentBounds.width * scale;
        let scaledHeight = contentBounds.height * scale;

        // If scaled dimensions exceed target, reduce scale further
        if (scaledWidth > targetWidth || scaledHeight > targetHeight) {
            const adjustedScaleX = targetWidth / contentBounds.width;
            const adjustedScaleY = targetHeight / contentBounds.height;
            scale = Math.min(adjustedScaleX, adjustedScaleY) * 0.95; // 95% to ensure margin
            scaledWidth = contentBounds.width * scale;
            scaledHeight = contentBounds.height * scale;
        }

        // Calculate centered position (guaranteed non-negative)
        const offsetX = Math.max(0, (targetWidth - scaledWidth) / 2);
        const offsetY = Math.max(0, (targetHeight - scaledHeight) / 2);

        return {
            scale,
            offsetX,
            offsetY,
            finalWidth: scaledWidth,
            finalHeight: scaledHeight
        };
    }

    /**
     * Calculate required page size to maintain minimum readable scale
     * If the computed scale is below MIN_EXPORT_SCALE, grow the page instead of shrinking the chart
     *
     * @param {object} contentBounds - Chart content bounds {x, y, width, height}
     * @param {object} scaleInfo - Result from computeOptimalScale()
     * @param {object} defaultPageSize - Default page dimensions {width, height} in points
     * @param {object} insets - Page insets {left, right, top, bottom} in points
     * @returns {object} {pageWidth, pageHeight, scale, offsetX, offsetY} - Custom page dimensions if needed
     */
    computePageSizeForMinScale(contentBounds, scaleInfo, defaultPageSize, insets) {
        // If scale is acceptable, use default page size
        if (scaleInfo.scale >= this.MIN_EXPORT_SCALE) {
            return {
                pageWidth: defaultPageSize.width,
                pageHeight: defaultPageSize.height,
                scale: scaleInfo.scale,
                offsetX: scaleInfo.offsetX,
                offsetY: scaleInfo.offsetY,
                finalWidth: scaleInfo.finalWidth,
                finalHeight: scaleInfo.finalHeight,
                wasResized: false
            };
        }

        // Scale is too small - calculate required page size to maintain MIN_EXPORT_SCALE
        const requiredScale = this.MIN_EXPORT_SCALE;
        const scaledWidth = contentBounds.width * requiredScale;
        const scaledHeight = contentBounds.height * requiredScale;

        // Add insets to get total page size
        const requiredPageWidth = scaledWidth + insets.left + insets.right;
        const requiredPageHeight = scaledHeight + insets.top + insets.bottom;

        // Calculate offsets (center the chart in the available area)
        const availableWidth = requiredPageWidth - insets.left - insets.right;
        const availableHeight = requiredPageHeight - insets.top - insets.bottom;
        const offsetX = (availableWidth - scaledWidth) / 2;
        const offsetY = (availableHeight - scaledHeight) / 2;

        console.log(`[Export] Scale ${scaleInfo.scale.toFixed(2)} too small, increasing page from ${defaultPageSize.width}×${defaultPageSize.height}pt to ${Math.round(requiredPageWidth)}×${Math.round(requiredPageHeight)}pt (scale: ${requiredScale})`);

        return {
            pageWidth: requiredPageWidth,
            pageHeight: requiredPageHeight,
            scale: requiredScale,
            offsetX: Math.max(0, offsetX),
            offsetY: Math.max(0, offsetY),
            finalWidth: scaledWidth,
            finalHeight: scaledHeight,
            wasResized: true
        };
    }

    /**
     * Analyze chart structure to determine optimal layout parameters
     * Returns { depth, maxBreadth, totalNodes, layoutParams }
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
                }
            };
        }

        // Build parent-child relationships and level assignments
        const nodeMap = new Map();
        const levelCounts = new Map();  // Track nodes per level
        const nodeLevels = new Map();   // Track which level each node is at

        nodes.forEach(node => {
            // Support both id/parentId and nodeId/parentNodeId
            const nodeId = node.id ?? node.nodeId;
            nodeMap.set(nodeId, node);
        });

        // Assign levels via BFS to count nodes per level accurately
        const queue = [];
        const visited = new Set();

        // Start from root nodes (nodes with no parent or invalid parent)
        const rootNodes = nodes.filter(n => {
            const parentId = n.parentId ?? n.parentNodeId;
            return !parentId || !nodeMap.has(parentId);
        });
        rootNodes.forEach(root => {
            const rootId = root.id ?? root.nodeId;
            queue.push({ nodeId: rootId, level: 0 });
            visited.add(rootId);
        });

        let maxDepth = 0;

        while (queue.length > 0) {
            const { nodeId, level } = queue.shift();
            nodeLevels.set(nodeId, level);
            maxDepth = Math.max(maxDepth, level);

            // Increment count for this level
            levelCounts.set(level, (levelCounts.get(level) || 0) + 1);

            // Find children and add to queue
            const children = nodes.filter(n => {
                const nId = n.id ?? n.nodeId;
                const nParentId = n.parentId ?? n.parentNodeId;
                return nParentId === nodeId && !visited.has(nId);
            });
            children.forEach(child => {
                const childId = child.id ?? child.nodeId;
                queue.push({ nodeId: childId, level: level + 1 });
                visited.add(childId);
            });
        }

        const depth = maxDepth + 1;  // Number of levels (0-indexed, so +1)
        const maxBreadth = Math.max(...Array.from(levelCounts.values()), 1);  // Max nodes at any level
        const totalNodes = nodes.length;

        // Fixed layout parameters matching the editor for consistency
        // Using the same values as chart-editor.js:448-455 ensures exports match the editor view
        const nodeWidth = 250;
        const childrenMargin = 80;
        const compactMarginBetween = 25;
        const compactMarginPair = 100;

        return {
            depth,
            maxBreadth,
            totalNodes,
            layoutParams: {
                nodeWidth,
                childrenMargin,
                compactMarginBetween,
                compactMarginPair
            }
        };
    }

    /**
     * Measure node heights in a hidden DOM container to avoid foreignObject clipping.
     */
    measureNodeHeights(chartNodes, nodeWidth, resolvedCSS, cssVariables) {
        if (!Array.isArray(chartNodes) || chartNodes.length === 0) {
            return;
        }

        const renderer = this.getNodeRenderer();
        const measureContainer = document.createElement('div');
        measureContainer.style.cssText = `
            position: absolute;
            left: -99999px;
            top: -99999px;
            visibility: hidden;
            width: ${nodeWidth}px;
        `;

        const styleTag = document.createElement('style');
        const nodeRendererCSS = typeof OrgNodeRenderer !== 'undefined' && OrgNodeRenderer.getNodeStyles
            ? OrgNodeRenderer.getNodeStyles()
            : '';
        styleTag.textContent = `${resolvedCSS}\n${nodeRendererCSS}\n.org-chart-node.multi-person{overflow:visible !important;}`;
        measureContainer.appendChild(styleTag);

        if (cssVariables) {
            for (const [varName, value] of Object.entries(cssVariables)) {
                measureContainer.style.setProperty(varName, value.trim());
            }
        }

        document.body.appendChild(measureContainer);

        try {
            chartNodes.forEach(node => {
                const wrapper = document.createElement('div');
                wrapper.style.cssText = `width: ${nodeWidth}px;`;
                wrapper.innerHTML = renderer.renderNodeContent({ data: node, width: nodeWidth });
                measureContainer.appendChild(wrapper);

                const measuredHeight = Math.ceil(wrapper.scrollHeight || wrapper.offsetHeight || 0);
                if (measuredHeight > 0) {
                    node.__measuredHeight = measuredHeight;
                }

                measureContainer.removeChild(wrapper);
            });
        } finally {
            document.body.removeChild(measureContainer);
        }
    }

    /**
     * Render a single chart off-screen and capture as image
     */
    async renderChartOffScreen(chartData) {
        console.log('=== RENDER CHART OFF-SCREEN ===');
        console.log(`[Export] Chart: "${chartData.chartName || chartData.name}"`);
        console.log(`[Export] Capture method: ${typeof html2canvas === 'function' ? 'html2canvas (DOM-based)' : 'SVG exportImg (fallback)'}`);

        const renderer = this.getNodeRenderer();
        const config = await this.getTemplateConfig();
        const viewState = chartData.viewState || {};
        const chartNodes = this.prepareChartNodes(chartData);

        // Analyze chart structure for canvas sizing
        const analysis = this.analyzeChartStructure(chartData.nodes || []);
        console.log(`[Export] Structure: ${analysis.totalNodes} nodes, depth=${analysis.depth}, breadth=${analysis.maxBreadth}`);
        console.log(`[Export] Fixed layout (matches editor): nodeWidth=${analysis.layoutParams.nodeWidth}, childrenMargin=${analysis.layoutParams.childrenMargin}, compactMarginBetween=${analysis.layoutParams.compactMarginBetween}`);

        // Dynamic canvas sizing: larger canvas for complex charts prevents fit() from over-compressing
        const baseCaptureWidth = config.images?.captureWidthPx || 2000;
        const baseCaptureHeight = config.images?.captureHeightPx || 1128;

        // Estimate minimum required dimensions based on tree structure
        const params = analysis.layoutParams;

        // Width: maxBreadth nodes × (nodeWidth + spacing) + padding for connectors
        const estimatedWidth = analysis.maxBreadth * (params.nodeWidth + params.compactMarginBetween) + 400;

        // Height: depth levels × (avg node height + childrenMargin) + padding
        const avgNodeHeight = 120;  // Estimate based on multi-person nodes
        const estimatedHeight = analysis.depth * (avgNodeHeight + params.childrenMargin) + 300;

        // Use larger of base or estimated size (with max limits to prevent memory issues)
        const captureWidth = Math.min(Math.max(baseCaptureWidth, estimatedWidth), 4500);
        const captureHeight = Math.min(Math.max(baseCaptureHeight, estimatedHeight), 3500);

        if (captureWidth > baseCaptureWidth || captureHeight > baseCaptureHeight) {
            console.log(`[Export] ⚠️ Canvas enlarged: ${captureWidth}×${captureHeight}px (base: ${baseCaptureWidth}×${baseCaptureHeight}px) to prevent compression`);
        } else {
            console.log(`[Export] Canvas size: ${captureWidth}×${captureHeight}px (sufficient for tree)`);
        }

        // For export: preserve collapsed/expanded state but ignore zoom/pan
        // This ensures consistent framing across all charts
        const shouldApplyCollapsedState = this.hasCollapsedNodes(viewState);

        // Fetch and prepare styles with resolved CSS variables
        const stylesheetCSS = await this.fetchStylesheet();
        const cssVariables = await this.getResolvedCSSVariables();
        const resolvedCSS = this.resolveCSSVariables(stylesheetCSS, cssVariables);

        // CRITICAL: Wait for fonts BEFORE any measurement to ensure text wrapping is accurate
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
            console.log('[Export] Fonts loaded before measurement');
        }

        // Pre-measure node heights to avoid foreignObject clipping on long names
        this.measureNodeHeights(chartNodes, analysis.layoutParams.nodeWidth, resolvedCSS, cssVariables);

        return new Promise((resolve, reject) => {
            const container = document.getElementById('bulk-export-container');

            // Create temporary canvas div
            const canvasDiv = document.createElement('div');
            canvasDiv.id = 'temp-chart-canvas';
            canvasDiv.style.cssText = `
                width: ${captureWidth}px;
                height: ${captureHeight}px;
                position: absolute;
                left: 0;
                top: 0;
            `;

            // Inject the full stylesheet into the canvas div for proper rendering
            const styleTag = document.createElement('style');
            styleTag.id = 'export-injected-styles';

            // Combine main stylesheet CSS with OrgNodeRenderer styles for node parity with editor
            const nodeRendererCSS = typeof OrgNodeRenderer !== 'undefined' && OrgNodeRenderer.getNodeStyles
                ? OrgNodeRenderer.getNodeStyles()
                : '';
            styleTag.textContent = resolvedCSS + '\n\n/* OrgNodeRenderer Styles */\n' + this.resolveCSSVariables(nodeRendererCSS, cssVariables);
            canvasDiv.appendChild(styleTag);

            // Apply CSS variables directly to the export container as custom properties
            // This ensures any var() references in inline styles or dynamic CSS resolve correctly
            for (const [varName, value] of Object.entries(cssVariables)) {
                canvasDiv.style.setProperty(varName, value.trim());
            }

            container.appendChild(canvasDiv);

            try {
                // TWO-PASS LAYOUT: First render with estimated heights, then measure and re-render
                const params = analysis.layoutParams;

                // PASS 1: Initial render with estimated heights
                let tempChart = new d3.OrgChart()
                    .container('#temp-chart-canvas')
                    .data(chartNodes)
                    .svgWidth(captureWidth)
                    .svgHeight(captureHeight)
                    .nodeWidth(() => params.nodeWidth)
                    .nodeHeight((d) => {
                        const node = d.data || d;
                        return node.__measuredHeight || renderer.calculateNodeHeight(node);
                    })
                    .childrenMargin(() => params.childrenMargin)
                    .compactMarginBetween(() => params.compactMarginBetween)
                    .compactMarginPair(() => params.compactMarginPair)
                    .compact(false)
                    .duration(0)
                    .layout(chartData.layout || 'top')
                    .nodeContent((d) => renderer.renderNodeContent(d))
                    .render();

                // Wait for initial render to complete
                const maxWait = this.calculateRenderTimeout(chartData);
                this.waitForChartRender(canvasDiv, maxWait)
                    .then(async () => {
                        // Wait for layout to settle after initial render
                        await new Promise(resolve => requestAnimationFrame(() => {
                            requestAnimationFrame(resolve);
                        }));

                        // PASS 2: Measure actual DOM heights from rendered nodes
                        const svgNode = canvasDiv.querySelector('svg');
                        const nodeElements = svgNode.querySelectorAll('g.node');
                        let heightsChanged = false;
                        let maxMeasuredHeight = 0;
                        let effectiveCaptureWidth = captureWidth;   // Track if canvas width was resized
                        let effectiveCaptureHeight = captureHeight; // Track if canvas height was resized
                        const MAX_CAPTURE_WIDTH = 4500;  // Prevent memory issues

                        nodeElements.forEach(nodeEl => {
                            const datum = d3.select(nodeEl).datum();
                            if (!datum) return;

                            // Find the foreignObject or inner content element
                            const foreignObject = nodeEl.querySelector('foreignObject');
                            const innerContent = foreignObject?.querySelector('.org-chart-node');

                            if (innerContent) {
                                const rect = innerContent.getBoundingClientRect();
                                const measuredHeight = Math.ceil(rect.height);

                                // Store on datum.data for nodeHeight callback
                                if (datum.data) {
                                    const oldHeight = datum.data.__measuredHeight || renderer.calculateNodeHeight(datum.data);
                                    const effectiveHeight = Math.max(oldHeight, measuredHeight);
                                    if (measuredHeight > oldHeight + 2) {
                                        datum.data.__measuredHeight = measuredHeight;
                                        heightsChanged = true;
                                    }
                                    maxMeasuredHeight = Math.max(maxMeasuredHeight, effectiveHeight);
                                }
                            }
                        });

                        console.log(`[Export] Measured ${nodeElements.length} nodes, heightsChanged=${heightsChanged}, maxHeight=${maxMeasuredHeight}`);

                        // If heights changed significantly, re-render with measured heights
                        if (heightsChanged) {
                            console.log('[Export] Re-rendering with measured heights...');

                            // Recompute canvas size based on actual measured heights
                            const newEstimatedHeight = analysis.depth * (maxMeasuredHeight + params.childrenMargin) + 300;
                            const newCaptureHeight = Math.min(Math.max(captureHeight, newEstimatedHeight), 3500);

                            if (newCaptureHeight > captureHeight) {
                                canvasDiv.style.height = `${newCaptureHeight}px`;
                                effectiveCaptureHeight = newCaptureHeight;
                                console.log(`[Export] Canvas height increased: ${captureHeight} → ${newCaptureHeight}px`);
                            }

                            // Clear and re-render with measured heights
                            tempChart.clear();
                            tempChart = new d3.OrgChart()
                                .container('#temp-chart-canvas')
                                .data(chartNodes)
                                .svgWidth(effectiveCaptureWidth)
                                .svgHeight(newCaptureHeight)
                                .nodeWidth(() => params.nodeWidth)
                                .nodeHeight((d) => {
                                    const node = d.data || d;
                                    return node.__measuredHeight || renderer.calculateNodeHeight(node);
                                })
                                .childrenMargin(() => params.childrenMargin)
                                .compactMarginBetween(() => params.compactMarginBetween)
                                .compactMarginPair(() => params.compactMarginPair)
                                .compact(false)
                                .duration(0)
                                .layout(chartData.layout || 'top')
                                .nodeContent((d) => renderer.renderNodeContent(d))
                                .render();

                            // Wait for re-render to complete
                            await this.waitForChartRender(canvasDiv, maxWait);
                            await new Promise(resolve => requestAnimationFrame(() => {
                                requestAnimationFrame(resolve);
                            }));
                        }

                        // PASS 3: Measure actual content bounds (including links/strokes) and expand canvas if needed
                        // Use measureSvgContentBounds() for accurate measurement including all strokes
                        const svgAfterHeight = canvasDiv.querySelector('svg');
                        let preCenterBounds = this.measureSvgContentBounds(svgAfterHeight);
                        const widthPadding = 100; // Extra padding for safety

                        if (preCenterBounds) {
                            const requiredWidth = preCenterBounds.width + (widthPadding * 2);
                            const heightPadding = 120; // Extra padding for safety
                            const MAX_CAPTURE_HEIGHT = 3500;
                            const requiredHeight = preCenterBounds.height + (heightPadding * 2);

                            let needsResize = false;
                            let newWidth = effectiveCaptureWidth;
                            let newHeight = effectiveCaptureHeight;

                            if (requiredWidth > effectiveCaptureWidth && requiredWidth <= MAX_CAPTURE_WIDTH) {
                                newWidth = Math.min(requiredWidth + 100, MAX_CAPTURE_WIDTH);
                                needsResize = true;
                                console.log(`[Export] Content width ${preCenterBounds.width.toFixed(0)}px (bounds) exceeds canvas, expanding: ${effectiveCaptureWidth} ? ${newWidth}px`);
                            }

                            if (requiredHeight > effectiveCaptureHeight && requiredHeight <= MAX_CAPTURE_HEIGHT) {
                                newHeight = Math.min(requiredHeight + 100, MAX_CAPTURE_HEIGHT);
                                needsResize = true;
                                console.log(`[Export] Content height ${preCenterBounds.height.toFixed(0)}px (bounds) exceeds canvas, expanding: ${effectiveCaptureHeight} ? ${newHeight}px`);
                            }

                            if (needsResize) {
                                // Update canvas and re-render with new dimensions
                                canvasDiv.style.width = `${newWidth}px`;
                                canvasDiv.style.height = `${newHeight}px`;
                                effectiveCaptureWidth = newWidth;
                                effectiveCaptureHeight = newHeight;

                                tempChart.clear();
                                tempChart = new d3.OrgChart()
                                    .container('#temp-chart-canvas')
                                    .data(chartNodes)
                                    .svgWidth(effectiveCaptureWidth)
                                    .svgHeight(effectiveCaptureHeight)
                                    .nodeWidth(() => params.nodeWidth)
                                    .nodeHeight((d) => {
                                        const node = d.data || d;
                                        return node.__measuredHeight || renderer.calculateNodeHeight(node);
                                    })
                                    .childrenMargin(() => params.childrenMargin)
                                    .compactMarginBetween(() => params.compactMarginBetween)
                                    .compactMarginPair(() => params.compactMarginPair)
                                    .compact(false)
                                    .duration(0)
                                    .layout(chartData.layout || 'top')
                                    .nodeContent((d) => renderer.renderNodeContent(d))
                                    .render();

                                await this.waitForChartRender(canvasDiv, maxWait);
                                await new Promise(resolve => requestAnimationFrame(() => {
                                    requestAnimationFrame(resolve);
                                }));

                                // Re-measure bounds after expansion
                                preCenterBounds = this.measureSvgContentBounds(canvasDiv.querySelector('svg'));
                            }
                        }

                        // CENTER WITH OPTIONAL SCALE-DOWN: Use measureSvgContentBounds for accurate positioning
                        const svgNodeFinal = canvasDiv.querySelector('svg');
                        const transformTargets = this.getChartTransformTargets(svgNodeFinal);

                        if (transformTargets.length && preCenterBounds) {
                            const svgWidth = parseInt(svgNodeFinal.getAttribute('width')) || effectiveCaptureWidth;
                            const svgHeight = parseInt(svgNodeFinal.getAttribute('height')) || effectiveCaptureHeight;

                            const contentPadding = 40; // Padding on each side
                            const availableWidth = svgWidth - (contentPadding * 2);
                            const availableHeight = svgHeight - (contentPadding * 2);

                            // Only scale down if content exceeds available space (very wide charts)
                            let scale = 1;
                            if (preCenterBounds.width > availableWidth || preCenterBounds.height > availableHeight) {
                                const scaleX = availableWidth / preCenterBounds.width;
                                const scaleY = availableHeight / preCenterBounds.height;
                                scale = Math.min(scaleX, scaleY, 1); // Never scale up, only down
                                console.log(`[Export] Content ${preCenterBounds.width.toFixed(0)}×${preCenterBounds.height.toFixed(0)} exceeds available ${availableWidth.toFixed(0)}×${availableHeight.toFixed(0)}, scaling to ${scale.toFixed(3)}`);
                            }

                            // Calculate translation using bounds.x/bounds.y for accurate positioning
                            const scaledWidth = preCenterBounds.width * scale;
                            const scaledHeight = preCenterBounds.height * scale;
                            let translateX = (svgWidth - scaledWidth) / 2 - preCenterBounds.x * scale;
                            let translateY = (svgHeight - scaledHeight) / 2 - preCenterBounds.y * scale;

                            // Apply initial transform
                            this.applyTransformToTargets(transformTargets, translateX, translateY, scale);
                            if (scale < 1) {
                                console.log(`[Export] Centered + scaled chart: translate(${translateX.toFixed(0)}, ${translateY.toFixed(0)}) scale(${scale.toFixed(3)})`);
                            } else {
                                console.log(`[Export] Centered chart: translate(${translateX.toFixed(0)}, ${translateY.toFixed(0)}), bounds ${preCenterBounds.width.toFixed(0)}×${preCenterBounds.height.toFixed(0)}`);
                            }

                            // Wait for transform to apply
                            await new Promise(resolve => requestAnimationFrame(resolve));

                            // POST-CENTER CORRECTION: Re-measure and adjust if content is still outside
                            const postCenterBounds = this.measureSvgContentBounds(svgNodeFinal);
                            if (postCenterBounds) {
                                let correctionNeeded = false;
                                let deltaX = 0;
                                let deltaY = 0;

                                // Check X bounds
                                if (postCenterBounds.x < contentPadding) {
                                    deltaX = contentPadding - postCenterBounds.x;
                                    correctionNeeded = true;
                                } else if (postCenterBounds.x + postCenterBounds.width > svgWidth - contentPadding) {
                                    deltaX = (svgWidth - contentPadding) - (postCenterBounds.x + postCenterBounds.width);
                                    correctionNeeded = true;
                                }

                                // Check Y bounds
                                if (postCenterBounds.y < contentPadding) {
                                    deltaY = contentPadding - postCenterBounds.y;
                                    correctionNeeded = true;
                                } else if (postCenterBounds.y + postCenterBounds.height > svgHeight - contentPadding) {
                                    deltaY = (svgHeight - contentPadding) - (postCenterBounds.y + postCenterBounds.height);
                                    correctionNeeded = true;
                                }

                                if (correctionNeeded) {
                                    translateX += deltaX;
                                    translateY += deltaY;
                                    console.log(`[Export] Post-center correction: deltaX=${deltaX.toFixed(0)}, deltaY=${deltaY.toFixed(0)}`);

                                    this.applyTransformToTargets(transformTargets, translateX, translateY, scale);
                                }
                            }

                            // DOM bounds correction: use actual rendered node boxes for edge cases
                            await new Promise(resolve => requestAnimationFrame(resolve));
                            let domBounds = this.measureDomNodeBounds(svgNodeFinal);
                            if (domBounds) {
                                // If DOM bounds still exceed available space, reduce scale further
                                const domScaleX = availableWidth / domBounds.width;
                                const domScaleY = availableHeight / domBounds.height;
                                const domScaleAdjustment = Math.min(domScaleX, domScaleY, 1);

                                if (domScaleAdjustment < 0.999) {
                                    scale *= domScaleAdjustment;

                                    const adjustedWidth = preCenterBounds.width * scale;
                                    const adjustedHeight = preCenterBounds.height * scale;
                                    translateX = (svgWidth - adjustedWidth) / 2 - preCenterBounds.x * scale;
                                    translateY = (svgHeight - adjustedHeight) / 2 - preCenterBounds.y * scale;

                                    console.log(`[Export] DOM bounds scale adjust: ${domScaleAdjustment.toFixed(3)}, new scale ${scale.toFixed(3)}`);

                                    this.applyTransformToTargets(transformTargets, translateX, translateY, scale);
                                    await new Promise(resolve => requestAnimationFrame(resolve));
                                    domBounds = this.measureDomNodeBounds(svgNodeFinal);
                                }

                                let domCorrectionNeeded = false;
                                let domDeltaX = 0;
                                let domDeltaY = 0;

                                if (domBounds.x < contentPadding) {
                                    domDeltaX = contentPadding - domBounds.x;
                                    domCorrectionNeeded = true;
                                } else if (domBounds.x + domBounds.width > svgWidth - contentPadding) {
                                    domDeltaX = (svgWidth - contentPadding) - (domBounds.x + domBounds.width);
                                    domCorrectionNeeded = true;
                                }

                                if (domBounds.y < contentPadding) {
                                    domDeltaY = contentPadding - domBounds.y;
                                    domCorrectionNeeded = true;
                                } else if (domBounds.y + domBounds.height > svgHeight - contentPadding) {
                                    domDeltaY = (svgHeight - contentPadding) - (domBounds.y + domBounds.height);
                                    domCorrectionNeeded = true;
                                }

                                if (domCorrectionNeeded) {
                                    translateX += domDeltaX;
                                    translateY += domDeltaY;
                                    console.log(`[Export] DOM bounds correction: deltaX=${domDeltaX.toFixed(0)}, deltaY=${domDeltaY.toFixed(0)}`);

                                    this.applyTransformToTargets(transformTargets, translateX, translateY, scale);
                                }
                            }
                        }

                        this.disableSvgClipPaths(svgNodeFinal, effectiveCaptureWidth, effectiveCaptureHeight);

                        // Wait for centering to settle
                        await new Promise(resolve => requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                requestAnimationFrame(resolve);
                            });
                        }));
                        console.log('[Export] Layout and centering settled');

                        this.injectNodeStyles(svgNodeFinal, resolvedCSS);
                        this.forceSvgVisibility(svgNodeFinal);

                        // Build overlay BEFORE measuring bounds so we can compute union
                        const overlayResult = this.buildHtmlNodeOverlay(canvasDiv);
                        const overlayElement = overlayResult?.overlay;
                        const overlayCleanupFn = overlayResult?.cleanup;

                        // Wait for overlay layout to settle
                        await new Promise(resolve => requestAnimationFrame(() => {
                            requestAnimationFrame(resolve);
                        }));
                        console.log('[Export] Overlay layout settled');

                        // Measure SVG content bounds
                        const svgBounds = this.measureSvgContentBounds(svgNodeFinal);
                        console.log('[Export] SVG bounds:', JSON.stringify(svgBounds));

                        // Measure overlay bounds and compute union
                        const overlayBounds = this.measureOverlayBounds(overlayElement, svgNodeFinal);
                        const rawBounds = this.computeUnionBounds(svgBounds, overlayBounds);
                        console.log('[Export] Union bounds:', JSON.stringify(rawBounds));

                        // Add padding with asymmetric "bleed" for text/box-shadow
                        // Do NOT clamp to 0 - cropImageToBounds handles negative coords safely
                        const basePadding = 20;
                        const extra = { left: 12, right: 12, top: 10, bottom: 20 }; // Extra bleed for edge cases

                        let contentBounds = {
                            x: rawBounds.x - basePadding - extra.left,
                            y: rawBounds.y - basePadding - extra.top,
                            width: rawBounds.width + (basePadding * 2) + extra.left + extra.right,
                            height: rawBounds.height + (basePadding * 2) + extra.top + extra.bottom,
                            originalWidth: rawBounds.originalWidth,
                            originalHeight: rawBounds.originalHeight,
                            margin: rawBounds.margin
                        };
                        console.log('[Export] Content bounds with padding:', JSON.stringify(contentBounds));

                        // Guard against invalid bounds
                        if (contentBounds.width <= 0 || contentBounds.height <= 0) {
                            console.warn(`[Export] Content bounds invalid (${contentBounds.width}×${contentBounds.height}), using raw bounds`);
                            contentBounds = {
                                x: rawBounds.x - basePadding,
                                y: rawBounds.y - basePadding,
                                width: rawBounds.width + (basePadding * 2),
                                height: rawBounds.height + (basePadding * 2),
                                originalWidth: rawBounds.originalWidth,
                                originalHeight: rawBounds.originalHeight,
                                margin: rawBounds.margin
                            };
                            console.log('[Export] Fallback bounds:', JSON.stringify(contentBounds));
                        }

                        // Define page insets (margins for legibility while maximizing chart area)
                        // IMPORTANT: Must EXACTLY match export-template.js insets for consistent scale calculation
                        // Page: 1680×947pt landscape (16:9)
                        const pageWidth = config.page?.widthPt || 1680;
                        const pageHeight = config.page?.heightPt || 947;

                        // Use conservative top inset to account for optional department taglines
                        // This matches export-template.js which uses 130 when tagline present, 120 otherwise
                        const insets = {
                            left: 60,    // Space for page edge
                            right: 60,   // Space for page edge
                            top: 130,    // Space for title + optional tagline (conservative)
                            bottom: 60   // Space for footer
                        };

                        const availableWidth = pageWidth - insets.left - insets.right;   // ~1560pt
                        const availableHeight = pageHeight - insets.top - insets.bottom; // ~757pt

                        // Compute optimal scale to fill 98% of available area (maximize page usage)
                        const scaleInfo = this.computeOptimalScale(
                            contentBounds,
                            availableWidth,
                            availableHeight,
                            0.98  // Fill 98% for maximum page usage (reduced whitespace)
                        );

                        // Check if scale is too small - if so, grow the page to maintain readability
                        const pageSizeInfo = this.computePageSizeForMinScale(
                            contentBounds,
                            scaleInfo,
                            { width: pageWidth, height: pageHeight },
                            insets
                        );

                        // Use the effective scale (either original or resized for readability)
                        const effectiveScale = pageSizeInfo.wasResized ? pageSizeInfo : scaleInfo;

                        console.log(`[Export] Chart "${chartData.chartName || chartData.name}": content ${Math.round(contentBounds.width)}×${Math.round(contentBounds.height)}px, scale ${effectiveScale.scale.toFixed(2)}x ${pageSizeInfo.wasResized ? '(page resized for readability)' : 'to fill page'}`);

                        // Diagnostic: Check bounds vs capture area overlap
                        const captureArea = effectiveCaptureWidth * effectiveCaptureHeight;
                        const boundsArea = contentBounds.width * contentBounds.height;
                        const boundsInCapture = (
                            contentBounds.x >= 0 &&
                            contentBounds.y >= 0 &&
                            contentBounds.x + contentBounds.width <= effectiveCaptureWidth &&
                            contentBounds.y + contentBounds.height <= effectiveCaptureHeight
                        );
                        console.log(`[Export] Bounds check: ${boundsInCapture ? 'INSIDE' : 'OUTSIDE/PARTIAL'} capture area (${effectiveCaptureWidth}×${effectiveCaptureHeight}px)`);
                        console.log(`[Export] Bounds area: ${(boundsArea / captureArea * 100).toFixed(1)}% of capture area`);

                        try {
                            const base64Image = await this.captureChartImage(
                                tempChart,
                                canvasDiv,
                                this.exportQuality.scale,
                                effectiveCaptureWidth,
                                effectiveCaptureHeight,
                                { overlayAlreadyBuilt: true } // Overlay built earlier for union bounds
                            );

                            if (!base64Image) {
                                throw new Error('Chart capture failed');
                            }

                            // Validate bounds before cropping
                            const boundsValid = contentBounds &&
                                Number.isFinite(contentBounds.x) &&
                                Number.isFinite(contentBounds.y) &&
                                Number.isFinite(contentBounds.width) &&
                                Number.isFinite(contentBounds.height) &&
                                contentBounds.width > 0 &&
                                contentBounds.height > 0;

                            console.log('[Export] Bounds valid:', boundsValid);
                            console.log('[Export] Base64 image length:', base64Image?.length || 0);

                            // Crop image to content bounds to remove whitespace
                            // Pass exportQuality.scale to convert SVG bounds to raster pixel coordinates
                            // If bounds are invalid, cropImageToBounds will return the original image
                            const cropBounds = boundsValid ? contentBounds : {
                                x: 0,
                                y: 0,
                                width: contentBounds?.originalWidth || effectiveCaptureWidth,
                                height: contentBounds?.originalHeight || effectiveCaptureHeight
                            };
                            console.log('[Export] Crop bounds:', JSON.stringify(cropBounds));

                            const croppedResult = await this.cropImageToBounds(
                                base64Image,
                                cropBounds,
                                this.exportQuality.scale
                            );

                            console.log('[Export] Cropped result:', croppedResult ? `${croppedResult.width}×${croppedResult.height}` : 'null');

                            if (!boundsValid) {
                                console.warn('[Export] Invalid content bounds, using full image:', contentBounds);
                            }

                            // Primary image: PNG for high-quality display and PDF (crisp lines)
                            // Using smaller viewport (1600×900) to keep PNG size under jsPDF string limit
                            const compressedImage = await this.compressImage(
                                croppedResult.dataUrl,
                                this.exportQuality.compression,
                                'PNG'  // Always PNG for line fidelity
                            );

                            const previewImage = await this.resizeImageDataUrl(
                                compressedImage,
                                config.images?.previewWidthPx || 800
                            );

                            const svgMarkup = svgNodeFinal ? this.serializeSvg(svgNodeFinal, resolvedCSS) : null;

                            // Use cropped dimensions for accurate PDF placement
                            resolve({
                                primary: {
                                    dataUrl: compressedImage,
                                    format: 'PNG',
                                    width: croppedResult.width,
                                    height: croppedResult.height
                                },
                                preview: previewImage,
                                svg: svgMarkup,
                                // Include bounds and effective scale metadata for PDF placement
                                // effectiveScale is either the optimal scale or MIN_SCALE if page was resized
                                bounds: contentBounds,
                                scale: effectiveScale,
                                // Include page size information for variable-sized PDF pages
                                pageSize: pageSizeInfo
                            });
                        } finally {
                            // Clean up overlay
                            if (typeof overlayCleanupFn === 'function') {
                                overlayCleanupFn();
                            }
                            tempChart.clear();
                            canvasDiv.remove();
                        }
                    })
                    .catch((waitError) => {
                        // Clean up on error too
                        try {
                            if (typeof overlayCleanupFn === 'function') {
                                overlayCleanupFn();
                            }
                            tempChart.clear();
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        canvasDiv.remove();
                        reject(waitError);
                    });

            } catch (error) {
                canvasDiv.remove();
                reject(error);
            }
        });
    }

    /**
     * Calculate optimal render timeout based on chart complexity
     */
    calculateRenderTimeout(chartData) {
        const nodeCount = chartData.nodes?.length || 0;

        if (nodeCount < 10) return 500;      // Small charts: 0.5s
        if (nodeCount < 30) return 800;      // Medium charts: 0.8s
        if (nodeCount < 50) return 1200;     // Large charts: 1.2s
        if (nodeCount < 100) return 1800;    // Very large: 1.8s
        return 2500;                         // Huge charts: 2.5s
    }

    /**
     * Wait for the chart to finish rendering by monitoring node stability
     */
    waitForChartRender(container, timeoutMs = 1500) {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            let lastNodeCount = -1;
            let stableFrames = 0;

            const check = () => {
                if (!container.isConnected) {
                    reject(new Error('Chart container removed before render completed'));
                    return;
                }

                const nodeCount = container.querySelectorAll('.node').length;

                if (nodeCount > 0 && nodeCount === lastNodeCount) {
                    stableFrames += 1;
                } else {
                    stableFrames = 0;
                }

                lastNodeCount = nodeCount;

                if (nodeCount > 0 && stableFrames >= 2) {
                    resolve();
                    return;
                }

                if (performance.now() - start > timeoutMs) {
                    reject(new Error('Chart render timed out'));
                    return;
                }

                requestAnimationFrame(check);
            };

            requestAnimationFrame(check);
        });
    }

    /**
     * Capture chart as a raster image, preferring DOM capture for foreignObject content.
     * FIX: Move container off-screen instead of using opacity:0 which can produce blank captures.
     * @param {Object} options - Optional settings
     * @param {boolean} options.overlayAlreadyBuilt - Skip building overlay if already built
     */
    async captureChartImage(tempChart, canvasDiv, scale, captureWidth, captureHeight, options = {}) {
        if (typeof html2canvas === 'function') {
            console.log('[Export] Using html2canvas capture path');
            const container = document.getElementById('bulk-export-container');
            const previousStyles = container ? {
                visibility: container.style.visibility,
                overflow: container.style.overflow,
                width: container.style.width,
                height: container.style.height,
                left: container.style.left,
                top: container.style.top,
                opacity: container.style.opacity,
                zIndex: container.style.zIndex,
                position: container.style.position
            } : null;

            if (container) {
                // FIX: Keep opacity at 1 and visibility visible for proper html2canvas capture
                // Move container off-screen using negative position instead of opacity:0
                container.style.position = 'fixed';
                container.style.visibility = 'visible';
                container.style.overflow = 'visible';
                container.style.width = `${captureWidth}px`;
                container.style.height = `${captureHeight}px`;
                // Position off-screen but keep opacity=1 so html2canvas renders correctly
                container.style.left = `-${captureWidth + 100}px`;
                container.style.top = '0';
                container.style.opacity = '1';  // CRITICAL: Must be 1 for html2canvas
                container.style.zIndex = '-9999';
            }

            // Skip overlay building if already built earlier (for union bounds measurement)
            let overlayCleanup = null;
            if (!options.overlayAlreadyBuilt) {
                const overlayResult = this.buildHtmlNodeOverlay(canvasDiv);
                overlayCleanup = overlayResult?.cleanup;
            }

            try {
                // Wait for all fonts to be loaded before capture to avoid fallback font rendering
                if (document.fonts && document.fonts.ready) {
                    await document.fonts.ready;
                    console.log('[Export] Fonts loaded, proceeding with capture');
                }

                const canvas = await html2canvas(canvasDiv, {
                    backgroundColor: '#ffffff',
                    scale,
                    useCORS: true,
                    logging: false,
                    foreignObjectRendering: false
                });
                console.log(`[Export] html2canvas captured: ${canvas.width}×${canvas.height}px`);
                return canvas.toDataURL('image/png', 0.95);
            } catch (error) {
                console.warn('[Export] html2canvas capture failed, falling back to SVG export', error);
            } finally {
                if (typeof overlayCleanup === 'function') {
                    overlayCleanup();
                }
                if (container && previousStyles) {
                    container.style.position = previousStyles.position;
                    container.style.visibility = previousStyles.visibility;
                    container.style.overflow = previousStyles.overflow;
                    container.style.width = previousStyles.width;
                    container.style.height = previousStyles.height;
                    container.style.left = previousStyles.left;
                    container.style.top = previousStyles.top;
                    container.style.opacity = previousStyles.opacity;
                    container.style.zIndex = previousStyles.zIndex;
                }
            }
        }

        console.log('[Export] Using SVG exportImg fallback path');
        return new Promise((resolve) => {
            tempChart.exportImg({
                full: false,
                save: false,
                scale,
                onLoad: resolve
            });
        });
    }

    /**
     * Build an HTML overlay that positions node content over the SVG.
     * FIX: Uses getBoundingClientRect() for accurate DOM-space positioning
     * instead of fragile regex transform parsing.
     */
    buildHtmlNodeOverlay(canvasDiv) {
        const svgNode = canvasDiv.querySelector('svg');
        if (!svgNode || typeof d3 === 'undefined') {
            console.log('[Overlay] No SVG or d3 available, skipping overlay');
            return null;
        }

        const nodes = svgNode.querySelectorAll('g.node');
        if (!nodes.length) {
            console.log('[Overlay] No nodes found, skipping overlay');
            return null;
        }

        const renderer = this.getNodeRenderer();

        // Get SVG's bounding rect for relative positioning
        const svgRect = svgNode.getBoundingClientRect();
        const canvasRect = canvasDiv.getBoundingClientRect();
        const svgWidth = svgRect.width || parseInt(svgNode.getAttribute('width')) || 2000;
        const svgHeight = svgRect.height || parseInt(svgNode.getAttribute('height')) || 1128;

        console.log(`[Overlay] Building overlay for ${nodes.length} nodes, SVG: ${svgWidth}×${svgHeight}`);

        const overlay = document.createElement('div');
        overlay.className = 'export-node-overlay';
        overlay.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: ${svgWidth}px;
            height: ${svgHeight}px;
            pointer-events: none;
        `;

        // Hide foreignObjects to avoid duplicate rendering
        const foreignObjects = Array.from(svgNode.querySelectorAll('foreignObject'));
        const previousDisplays = new Map();
        foreignObjects.forEach((fo) => {
            previousDisplays.set(fo, fo.style.display);
            fo.style.display = 'none';
        });

        // Get SVG CTM for consistent coordinate transforms
        const svgCTM = svgNode.getScreenCTM();
        const svgCTMInverse = svgCTM ? svgCTM.inverse() : null;

        nodes.forEach((nodeEl) => {
            const datum = d3.select(nodeEl).datum();
            if (!datum) {
                return;
            }

            // Get node dimensions from datum
            const nodeWidth = datum.width || 250;
            const nodeHeight = datum.height || 150;

            // FIX: Use getBoundingClientRect for accurate DOM positioning
            // This automatically accounts for ALL transforms (chart, center-group, node)
            const nodeRect = nodeEl.getBoundingClientRect();

            // Position relative to the SVG element (which is at the origin of canvasDiv)
            const finalX = nodeRect.left - svgRect.left;
            const finalY = nodeRect.top - svgRect.top;
            const finalWidth = nodeRect.width;
            const finalHeight = nodeRect.height;

            // Fallback: if getBoundingClientRect returns invalid values, use CTM
            if (!Number.isFinite(finalX) || !Number.isFinite(finalY) || finalWidth <= 0 || finalHeight <= 0) {
                console.warn('[Overlay] Invalid rect for node, skipping');
                return;
            }

            const nodeWrapper = document.createElement('div');
            // FIX: Use fixed height from measured layout to match link positions
            // The two-pass measurement ensures datum.height reflects actual text wrap height
            nodeWrapper.style.cssText = `
                position: absolute;
                left: ${finalX}px;
                top: ${finalY}px;
                width: ${finalWidth}px;
                height: ${finalHeight}px;
                overflow: visible;
                pointer-events: none;
            `;

            // Render at logical size - height already accounts for wrapped text via measurement pass
            nodeWrapper.innerHTML = renderer.renderNodeContent(datum);
            overlay.appendChild(nodeWrapper);
        });

        canvasDiv.appendChild(overlay);
        console.log(`[Overlay] Created overlay with ${overlay.children.length} node wrappers`);

        // Return both overlay element (for bounds measurement) and cleanup function
        return {
            overlay,
            cleanup: () => {
                overlay.remove();
                foreignObjects.forEach((fo) => {
                    fo.style.display = previousDisplays.get(fo) || '';
                });
            }
        };
    }

    /**
     * Crop image to content bounds to remove whitespace
     * @param {string} base64Image - Base64 data URL
     * @param {object} bounds - Content bounds in SVG units {x, y, width, height}
     * @param {number} scale - Export scale factor (e.g., 1.5 or 2.0) to convert SVG units to raster pixels
     * @returns {Promise<object>} Cropped image data: {dataUrl, width, height}
     */
    async cropImageToBounds(base64Image, bounds, scale) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                console.log(`[Crop] Image loaded: ${img.width}×${img.height}, scale=${scale}`);
                console.log(`[Crop] Input bounds:`, JSON.stringify(bounds));

                // Convert SVG bounds to raster pixel coordinates by applying scale factor
                const scaledX = bounds.x * scale;
                const scaledY = bounds.y * scale;
                const scaledWidth = bounds.width * scale;
                const scaledHeight = bounds.height * scale;

                console.log(`[Crop] Scaled coords: x=${scaledX}, y=${scaledY}, w=${scaledWidth}, h=${scaledHeight}`);

                if (!Number.isFinite(scaledX) || !Number.isFinite(scaledY) || !Number.isFinite(scaledWidth) || !Number.isFinite(scaledHeight)) {
                    console.warn('[Export] Invalid bounds values, returning original image');
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                const scaledMaxX = scaledX + scaledWidth;
                const scaledMaxY = scaledY + scaledHeight;

                // Guard rail: If bounds are completely outside image, skip cropping
                if (scaledMaxX <= 0 || scaledMaxY <= 0 || scaledX >= img.width || scaledY >= img.height) {
                    console.warn('[Crop] Bounds completely outside image, skipping crop');
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                // Guard rail: If bounds are suspiciously small (< 5% of image), likely an error - skip crop
                const boundsArea = scaledWidth * scaledHeight;
                const imageArea = img.width * img.height;
                const boundsRatio = boundsArea / imageArea;

                if (boundsRatio < 0.05) {
                    console.warn(`[Crop] Bounds suspiciously small (${(boundsRatio * 100).toFixed(1)}% of image), likely calculation error - skipping crop`);
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                // Guard rail: If bounds are extremely large (> 150% of image), likely an error - skip crop
                if (boundsRatio > 1.5) {
                    console.warn(`[Crop] Bounds larger than image (${(boundsRatio * 100).toFixed(1)}% of image), likely calculation error - skipping crop`);
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                // Preserve desired bounds size, pad with white if bounds extend outside the image
                const destX = Math.max(0, Math.ceil(-scaledX));
                const destY = Math.max(0, Math.ceil(-scaledY));
                const destWidth = Math.ceil(scaledWidth);
                const destHeight = Math.ceil(scaledHeight);

                const sourceX = Math.max(0, scaledX);
                const sourceY = Math.max(0, scaledY);
                const sourceWidth = Math.min(img.width - sourceX, destWidth - destX);
                const sourceHeight = Math.min(img.height - sourceY, destHeight - destY);

                if (!Number.isFinite(destWidth) || !Number.isFinite(destHeight) || destWidth <= 0 || destHeight <= 0) {
                    console.warn(`[Export] Invalid destination dimensions (${destWidth}x${destHeight}), returning original image`);
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                // Guard against invalid source dimensions
                if (sourceWidth <= 0 || sourceHeight <= 0) {
                    console.warn(`[Export] Invalid crop dimensions (${sourceWidth}x${sourceHeight}), returning original image`);
                    resolve({
                        dataUrl: base64Image,
                        width: img.width,
                        height: img.height
                    });
                    return;
                }

                // Return content-sized snapshot (no fixed viewport)
                // Page sizing is handled in export-template.js for consistent scale calculations
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(destWidth);
                canvas.height = Math.round(destHeight);

                const ctx = canvas.getContext('2d');

                // Fill with white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw cropped content
                console.log(`[Crop] Drawing image: src(${sourceX}, ${sourceY}, ${sourceWidth}, ${sourceHeight}) -> dest(${destX}, ${destY}, ${sourceWidth}, ${sourceHeight})`);
                ctx.drawImage(
                    img,
                    sourceX, sourceY,        // Source position (in raster pixels)
                    sourceWidth, sourceHeight, // Source size (in raster pixels)
                    destX, destY,              // Destination position
                    sourceWidth, sourceHeight  // Destination size
                );

                // Convert to base64 and return with content dimensions
                const result = {
                    dataUrl: canvas.toDataURL('image/png', 0.95),
                    width: Math.round(destWidth),
                    height: Math.round(destHeight)
                };
                console.log(`[Crop] Returning content-sized image: ${result.width}×${result.height}`);
                resolve(result);
            };
            img.onerror = reject;
            img.src = base64Image;
        });
    }

    /**
     * Compress image to reduce file size
     */
    async compressImage(base64Image, quality = 0.8, format = 'JPEG') {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF'; // White background
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);

                // Use PNG for sharper text/lines (no compression artifacts), JPEG for smaller files
                const mimeType = format === 'PNG' ? 'image/png' : 'image/jpeg';
                const compressed = canvas.toDataURL(mimeType, quality);
                resolve(compressed);
            };
            img.onerror = () => {
                console.warn('Image compression failed, using original');
                resolve(base64Image);
            };
            img.src = base64Image;
        });
    }

    async resizeImageDataUrl(base64Image, targetWidth = 800) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.width / img.height;
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetWidth / ratio;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({
                    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
                    format: 'JPEG',
                    width: canvas.width,
                    height: canvas.height
                });
            };
            img.onerror = () => resolve(null);
            img.src = base64Image;
        });
    }

    serializeSvg(svgNode, resolvedCSS = null) {
        if (!svgNode) return null;
        const clone = svgNode.cloneNode(true);
        // Inject styles into the clone (will skip if already present)
        this.injectNodeStyles(clone, resolvedCSS);
        const serializer = new XMLSerializer();
        return serializer.serializeToString(clone);
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

    getNodeRenderer() {
        if (typeof OrgNodeRenderer === 'undefined') {
            throw new Error('Org node renderer not loaded');
        }
        return OrgNodeRenderer;
    }

    injectNodeStyles(svgNode, resolvedCSS = null) {
        if (!svgNode) return;
        try {
            const styleId = 'bulk-export-node-styles';
            if (svgNode.querySelector(`#${styleId}`)) {
                return;
            }
            const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleEl.id = styleId;

            // Use resolved CSS if provided, otherwise fall back to basic renderer styles
            if (resolvedCSS) {
                // Extract only org-chart-node related styles for SVG injection
                const orgChartStyles = this.extractOrgChartStyles(resolvedCSS);
                styleEl.textContent = orgChartStyles;
            } else {
                const renderer = this.getNodeRenderer();
                styleEl.textContent = renderer.getNodeStyles();
            }

            svgNode.insertBefore(styleEl, svgNode.firstChild);
        } catch (error) {
            console.warn('Failed to inject node styles into SVG', error);
        }
    }

    forceSvgVisibility(svgNode) {
        if (!svgNode) return;
        try {
            const visibleElements = svgNode.querySelectorAll('g.node, path.link, path.connection');
            visibleElements.forEach((el) => {
                el.style.opacity = '1';
                el.setAttribute('opacity', '1');
            });

            const foreignObjects = svgNode.querySelectorAll('foreignObject');
            foreignObjects.forEach((fo) => {
                if (fo.style.display === 'none') {
                    fo.style.display = '';
                }
                fo.style.visibility = 'visible';
                fo.style.opacity = '1';
            });
        } catch (error) {
            console.warn('Failed to force SVG visibility', error);
        }
    }

    /**
     * Extract org-chart-node styles from the full stylesheet using CSS parser
     * This is more robust than line-by-line parsing and handles complex selectors
     * @param {string} cssText - Full CSS content with resolved variables
     * @returns {string} Filtered CSS containing only node styles
     */
    extractOrgChartStyles(cssText) {
        try {
            // For SVG injection, we need to include ALL styles that could affect nodes
            // Rather than fragile string parsing, use a regex-based approach
            // that captures complete rule blocks

            const relevantPatterns = [
                /\.org-chart-node[^{]*\{[^}]*\}/gs,
                /\.node-[^{]*\{[^}]*\}/gs,
                /\.role-[^{]*\{[^}]*\}/gs,
                /\.person-[^{]*\{[^}]*\}/gs,
                /\.people-[^{]*\{[^}]*\}/gs,
                /\.multi-person[^{]*\{[^}]*\}/gs,
                /\.legacy[^{]*\{[^}]*\}/gs
            ];

            let extractedCSS = '';

            for (const pattern of relevantPatterns) {
                const matches = cssText.match(pattern);
                if (matches) {
                    extractedCSS += matches.join('\n\n');
                }
            }

            // If extraction failed or found nothing, fall back to full stylesheet
            // Better to include too much than too little
            if (!extractedCSS || extractedCSS.trim().length < 100) {
                console.warn('[BulkExport] CSS extraction returned minimal content, using full stylesheet');
                return cssText;
            }

            console.log(`[BulkExport] Extracted ${extractedCSS.length} characters of node styles`);
            return extractedCSS;

        } catch (error) {
            console.error('[BulkExport] CSS extraction failed, using full stylesheet:', error);
            // Safer to include everything than miss critical styles
            return cssText;
        }
    }

    prepareChartNodes(chartData) {
        const nodes = Array.isArray(chartData.nodes) ? chartData.nodes : [];

        // Force full expansion for exports - ignore viewState.collapsedNodes
        // This ensures all charts export with the complete tree visible, regardless of
        // how the user had the chart collapsed when saving
        return nodes.map(node => {
            return {
                id: node.id,
                parentId: node.parentId || '',
                members: node.members || [],
                meta: node.meta || {},
                _expanded: true,  // Always expand for exports
                name: node.name,
                title: node.title,
                department: node.department || (node.meta && node.meta.department)
            };
        });
    }

    /**
     * Check if viewState contains collapsed nodes
     */
    hasCollapsedNodes(viewState = {}) {
        return Array.isArray(viewState.collapsedNodes) && viewState.collapsedNodes.length > 0;
    }

    /**
     * Apply only collapsed/expanded state, ignoring zoom/pan
     * This preserves user's expand/collapse intent while ensuring consistent framing
     */
    applyCollapsedState(chartInstance, viewState = {}) {
        if (!chartInstance || typeof chartInstance.setExpanded !== 'function') {
            return;
        }
        if (!Array.isArray(viewState.collapsedNodes) || viewState.collapsedNodes.length === 0) {
            return;
        }

        // Collapse the nodes that were collapsed in the editor
        // Pass false to setExpanded to collapse the node
        viewState.collapsedNodes.forEach(nodeId => {
            chartInstance.setExpanded(nodeId, false);
        });
    }

    /**
     * @deprecated Use applyCollapsedState instead - this respects zoom/pan which causes whitespace issues
     */
    shouldRespectViewport(viewState = {}) {
        if (!viewState) return false;
        const hasCollapsed = Array.isArray(viewState.collapsedNodes) && viewState.collapsedNodes.length > 0;
        const zoomChanged = typeof viewState.zoom === 'number' && Math.abs(viewState.zoom - 1) > 0.01;
        const pan = viewState.pan || {};
        const panChanged = (typeof pan.x === 'number' && Math.abs(pan.x) > 1) ||
            (typeof pan.y === 'number' && Math.abs(pan.y) > 1);
        return hasCollapsed || zoomChanged || panChanged;
    }

    /**
     * @deprecated Use applyCollapsedState instead
     */
    applyViewStateTransform(chartInstance, viewState = {}) {
        if (!chartInstance || typeof chartInstance.getChartState !== 'function') {
            return;
        }
        if (typeof d3 === 'undefined' || typeof d3.zoomIdentity === 'undefined') {
            return;
        }
        const state = chartInstance.getChartState();
        if (!state || !state.svg || !state.zoomBehavior) {
            return;
        }

        const zoom = typeof viewState.zoom === 'number' ? viewState.zoom : (state.lastTransform?.k || 1);
        const pan = viewState.pan || {};
        const translateX = typeof pan.x === 'number' ? pan.x : (state.lastTransform?.x || 0);
        const translateY = typeof pan.y === 'number' ? pan.y : (state.lastTransform?.y || 0);

        const transform = d3.zoomIdentity.translate(translateX, translateY).scale(zoom);
        state.lastTransform = transform;

        try {
            state.svg.call(state.zoomBehavior.transform, transform);
        } catch (error) {
            console.warn('Failed to apply view state transform', error);
        }
    }

    /**
     * Load cover image mapping configuration
     * @returns {Promise<Object>} Cover image mapping config
     */
    async loadCoverImageMapping() {
        try {
            const response = await fetch('assets/export/cover-image-mapping.json');
            if (!response.ok) {
                console.warn('[Export] Cover image mapping not found, proceeding without cover images');
                return null;
            }
            const mapping = await response.json();
            console.log(`[Export] Loaded ${mapping.coverImages?.length || 0} cover image mappings`);
            return mapping;
        } catch (error) {
            console.warn('[Export] Failed to load cover image mapping:', error);
            return null;
        }
    }

    /**
     * Find matching cover image for a chart
     * @param {Object} chart - Chart data
     * @param {Object} mapping - Cover image mapping config
     * @returns {string} Cover image file path (always returns a value, fallback if no match)
     */
    findCoverImageForChart(chart, mapping) {
        const fallback = mapping?.fallbackImage || 'assets/cover-images/Slide1.png';

        if (!mapping || !mapping.coverImages) {
            console.log(`[Export] No mapping available, using fallback: ${fallback}`);
            return fallback;
        }

        const chartName = chart.title || chart.chartName || '';
        const chartDept = chart.department || chart.departmentTag || '';
        const chartCoverId = chart.coverId || chart.chartData?.coverId;

        // Warn if coverId is missing (should be set on all charts)
        if (!chartCoverId) {
            console.warn(`[Export] Chart "${chartName}" missing coverId - using legacy fallback matching. Set coverId in chart settings for stable export.`);
        }

        // Priority 1: Check for stable coverId (preferred method)
        if (chartCoverId) {
            const coverByIdMatch = mapping.coverImages.find(c => c.id === chartCoverId);
            if (coverByIdMatch) {
                console.log(`[Export] Matched chart "${chartName}" to cover image "${coverByIdMatch.file}" by coverId: ${chartCoverId}`);
                return coverByIdMatch.file;
            } else {
                console.warn(`[Export] Chart "${chartName}" has coverId "${chartCoverId}" but no matching cover found`);
            }
        }

        // Priority 2: Legacy fallback - check chart name matches
        for (const coverImage of mapping.coverImages) {
            if (coverImage.matchNames && Array.isArray(coverImage.matchNames)) {
                for (const matchName of coverImage.matchNames) {
                    if (chartName.toLowerCase().includes(matchName.toLowerCase())) {
                        console.log(`[Export] Matched chart "${chartName}" to cover image "${coverImage.file}" by name (legacy)`);
                        return coverImage.file;
                    }
                }
            }

            // Priority 3: Legacy fallback - check department matches
            if (coverImage.matchDepartments && Array.isArray(coverImage.matchDepartments)) {
                for (const matchDept of coverImage.matchDepartments) {
                    if (chartDept.toLowerCase().includes(matchDept.toLowerCase())) {
                        console.log(`[Export] Matched chart "${chartName}" (dept: "${chartDept}") to cover image "${coverImage.file}" by department (legacy)`);
                        return coverImage.file;
                    }
                }
            }
        }

        console.log(`[Export] No cover image match found for chart "${chartName}" (dept: "${chartDept}", coverId: "${chartCoverId || 'none'}"), using fallback: ${fallback}`);
        return fallback;
    }

    /**
     * Assemble all captured charts into a single PDF
     */
    async assemblePDF() {
        if (!window.jspdf) {
            throw new Error('jsPDF is not loaded');
        }
        if (typeof ExportTemplate === 'undefined') {
            throw new Error('Export template helpers not loaded');
        }

        const config = await this.getTemplateConfig();
        const { jsPDF } = window.jspdf;
        const includeOverview = false; // Overview page removed from export

        // Load cover image mapping
        const coverImageMapping = await this.loadCoverImageMapping();

        // Get document cover image
        const documentCover = coverImageMapping?.documentCoverImage || 'assets/cover-images/Slide1.png';

        // Pre-process charts to add cover info
        const chartsWithCoverInfo = this.capturedCharts.map(chart => {
            const coverImage = this.findCoverImageForChart(chart, coverImageMapping);
            const coverId = chart.coverId || chart.chartData?.coverId;
            return {
                ...chart,
                coverImagePath: coverImage,
                coverId: coverId
            };
        });

        // Compute global max page size from all captured charts
        // This ensures ALL pages (covers + charts) use the same dimensions - no cropping
        const defaultWidth = config.page.widthPt;
        const defaultHeight = config.page.heightPt;
        let maxPageWidth = defaultWidth;
        let maxPageHeight = defaultHeight;

        this.capturedCharts.forEach(c => {
            const ps = c.snapshot?.pageSize;
            if (ps?.wasResized) {
                maxPageWidth = Math.max(maxPageWidth, ps.pageWidth);
                maxPageHeight = Math.max(maxPageHeight, ps.pageHeight);
            }
        });

        console.log(`[Export] Global page size: ${Math.round(maxPageWidth)}×${Math.round(maxPageHeight)}pt (default: ${defaultWidth}×${defaultHeight}pt)`);

        // Group charts by coverId
        const coverOrder = coverImageMapping?.coverOrder || [];
        const chartGroups = new Map(); // Map<coverId, charts[]>

        chartsWithCoverInfo.forEach(chart => {
            const coverId = chart.coverId || 'no-cover';
            if (!chartGroups.has(coverId)) {
                chartGroups.set(coverId, []);
            }
            chartGroups.get(coverId).push(chart);
        });

        // Sort charts within each group by coverOrderIndex, then createdAt, then chartId
        for (const [coverId, charts] of chartGroups.entries()) {
            charts.sort((a, b) => {
                // Priority 1: Sort by coverOrderIndex (numeric, lower first, undefined/null last)
                const aOrder = a.coverOrderIndex ?? a.chartData?.coverOrderIndex ?? Infinity;
                const bOrder = b.coverOrderIndex ?? b.chartData?.coverOrderIndex ?? Infinity;
                if (aOrder !== bOrder) {
                    return aOrder - bOrder;
                }

                // Priority 2: Sort by creation date (deterministic)
                const aDate = new Date(a.createdAt || a.chartData?.createdAt || a.lastModified || 0);
                const bDate = new Date(b.createdAt || b.chartData?.createdAt || b.lastModified || 0);
                if (aDate.getTime() !== bDate.getTime()) {
                    return aDate - bDate;
                }

                // Priority 3: Sort by chartId (stable tie-breaker)
                return (a.id || a.chartId || '').localeCompare(b.id || b.chartId || '');
            });
        }

        // Sort groups by coverOrder position
        const sortedCoverIds = Array.from(chartGroups.keys()).sort((a, b) => {
            if (a === 'no-cover' && b !== 'no-cover') return -1;
            if (b === 'no-cover' && a !== 'no-cover') return 1;
            const aIndex = coverOrder.indexOf(a);
            const bIndex = coverOrder.indexOf(b);

            // Both in order: sort by position
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            // Only a in order: a goes first
            if (aIndex !== -1) return -1;
            // Only b in order: b goes first
            if (bIndex !== -1) return 1;
            // Neither in order: alphabetical
            return a.localeCompare(b);
        });

        console.log(`[Export] Organized ${chartsWithCoverInfo.length} charts into ${sortedCoverIds.length} cover groups`);

        // Filter to groups that will actually render a cover (exclude 'no-cover')
        const coverGroups = sortedCoverIds.filter(id => id !== 'no-cover');

        // Warn about charts missing coverId (non-blocking)
        const noCoverCharts = chartGroups.get('no-cover');
        if (noCoverCharts && noCoverCharts.length > 0) {
            console.warn(`[Export] ${noCoverCharts.length} chart(s) missing coverId - will export without cover page`);
        }

        // Get first cover group's cover to check for duplicate with document cover
        const firstCoverGroupId = coverGroups[0];
        const firstCoverGroupCover = firstCoverGroupId && chartGroups.get(firstCoverGroupId)?.[0]?.coverImagePath;
        const skipFirstGroupCover = firstCoverGroupCover === documentCover;

        // Calculate total pages: 1 (doc cover) + actual covers + all charts
        // groupCoverCount = number of groups that will render a cover (excludes 'no-cover' and skip-first logic)
        const groupCoverCount = coverGroups.length - (skipFirstGroupCover ? 1 : 0);
        const totalPages = 1 + groupCoverCount + this.capturedCharts.length;

        if (skipFirstGroupCover) {
            console.log(`[Export] Skipping first group cover to avoid duplicate (both use ${documentCover})`);
        }

        // Initialize jsPDF with global max page size (ensures all pages are same size)
        const pdf = new jsPDF({
            orientation: 'l',
            unit: 'pt',
            format: [maxPageWidth, maxPageHeight]
        });

        let pageNumber = 1;

        // First page: Main document cover
        await ExportTemplate.drawCoverImagePage(pdf, documentCover, {
            pageNumber,
            totalPages,
            classification: 'CONFIDENTIAL',
            url: 'www.RRCcompanies.com'
        });

        // Render each cover group
        for (let groupIndex = 0; groupIndex < sortedCoverIds.length; groupIndex++) {
            const coverId = sortedCoverIds[groupIndex];
            const groupCharts = chartGroups.get(coverId);
            const isNoCoverGroup = coverId === 'no-cover';
            const isFirstCoverGroup = coverId === firstCoverGroupId;

            if (!groupCharts || groupCharts.length === 0) continue;

            // Get cover image for this group (all charts in group have same cover)
            const groupCover = groupCharts[0].coverImagePath;

            // Insert ONE cover page per group
            // Skip if: (1) no-cover group (would be duplicate Slide1), OR
            //          (2) first cover group and its cover matches document cover
            const shouldSkipCover = isNoCoverGroup || (isFirstCoverGroup && skipFirstGroupCover);

            if (!shouldSkipCover) {
                pdf.addPage();
                pageNumber += 1;
                await ExportTemplate.drawCoverImagePage(pdf, groupCover, {
                    pageNumber,
                    totalPages,
                    classification: 'CONFIDENTIAL',
                    url: 'www.RRCcompanies.com'
                });
                console.log(`[Export] Inserted cover page "${groupCover}" for group "${coverId}" (${groupCharts.length} charts)`);
            } else {
                const reason = isNoCoverGroup
                    ? 'charts missing coverId (would duplicate document cover)'
                    : 'already shown as document cover';
                console.log(`[Export] Skipped cover for group "${coverId}" (${reason})`);
            }

            // Render all charts in this group
            for (const captured of groupCharts) {
                // All pages use global max size (no custom dimensions per chart)
                pdf.addPage();
                pageNumber += 1;
                await ExportTemplate.drawDepartmentPage(
                    pdf,
                    {
                        name: captured.title,
                        tagline: captured.department || '',
                        stats: {
                            nodes: captured.nodeCount,
                            people: captured.peopleCount,
                            updated: this.formatDateForDisplay(captured.lastModified)
                        },
                        chartData: captured.chartData,
                        tags: captured.tags || []
                    },
                    captured.snapshot,
                    {
                        pageNumber,
                        totalPages,
                        classification: 'CONFIDENTIAL',
                        url: 'www.RRCcompanies.com'
                    }
                );
                console.log(`[Export] Rendered chart "${captured.title}" (order: ${captured.coverOrderIndex ?? 'auto'})`);
            }
        }

        return pdf;
    }

    shouldIncludeOverviewPage() {
        return this.capturedCharts.some(chart => !!chart.department);
    }

    buildOverviewDivisions() {
        const divisionsMap = new Map();
        this.capturedCharts.forEach((chart) => {
            const key = chart.department || 'General';
            if (!divisionsMap.has(key)) {
                divisionsMap.set(key, new Set());
            }
            divisionsMap.get(key).add(chart.title);
        });
        return Array.from(divisionsMap.entries()).map(([name, titles]) => ({
            name,
            entries: Array.from(titles)
        }));
    }

    getLatestUpdatedDate() {
        const timestamps = this.capturedCharts
            .map(chart => chart.lastModified ? new Date(chart.lastModified) : null)
            .filter(Boolean)
            .sort((a, b) => b - a);
        const latest = timestamps[0] || new Date();
        return latest.toLocaleDateString('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    formatDateForDisplay(dateValue) {
        if (!dateValue) return null;
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    /**
     * Download the PDF
     */
    async downloadPDF(pdf) {
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `currentorgchart(1).pdf`;
        pdf.save(filename);
    }

    /**
     * Show progress modal
     */
    showProgressModal() {
        // Remove existing modal if present
        const existing = document.getElementById('bulk-export-modal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'bulk-export-modal';
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2 class="modal-title">Exporting All Charts</h2>
                </div>
                <div class="modal-body">
                    <p id="export-status" style="margin-bottom: 1rem;">Initializing...</p>

                    <div class="progress-bar-container" style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                        <div id="export-progress-bar" class="progress-bar" style="width: 0%; height: 100%; background: var(--primary-color); transition: width 0.3s ease;"></div>
                    </div>

                    <p id="export-percentage" style="text-align: center; margin-top: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">0%</p>

                    <div id="export-details" style="margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
                        <!-- Chart details will appear here -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-danger" onclick="bulkExportManager.cancel()">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    /**
     * Update progress modal
     */
    updateProgress(message, percentage) {
        const statusEl = document.getElementById('export-status');
        const progressBar = document.getElementById('export-progress-bar');
        const percentageEl = document.getElementById('export-percentage');
        const detailsEl = document.getElementById('export-details');

        if (statusEl) statusEl.textContent = message;
        if (progressBar) progressBar.style.width = `${percentage}%`;
        if (percentageEl) percentageEl.textContent = `${Math.round(percentage)}%`;

        if (detailsEl && this.totalCharts > 0) {
            detailsEl.textContent = `Chart ${this.currentChart} of ${this.totalCharts}`;
        }
    }

    /**
     * Hide progress modal
     */
    hideProgressModal() {
        const modal = document.getElementById('bulk-export-modal');
        if (modal) {
            modal.remove();
        }
    }

    /**
     * Show success message
     */
    showSuccessMessage(chartCount) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--success-color);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">✅</span>
                <div>
                    <div style="font-weight: 600;">Export Complete!</div>
                    <div style="font-size: 0.875rem; opacity: 0.9;">
                        ${chartCount} chart${chartCount !== 1 ? 's' : ''} exported to PDF
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 5000);

        // Add animation styles if not present
        if (!document.getElementById('toast-animations')) {
            const style = document.createElement('style');
            style.id = 'toast-animations';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Cancel export
     */
    cancel() {
        if (confirm('Are you sure you want to cancel the export?')) {
            this.shouldCancel = true;
        }
    }

    /**
     * Debug method: Preview a single chart's SVG export
     * Opens the SVG in a new window for visual inspection
     * @param {string} chartId - The ID of the chart to preview
     * @returns {Promise} Resolves when preview is opened
     */
    async debugPreviewChart(chartId) {
        console.log(`[Debug] Previewing chart: ${chartId}`);

        try {
            // Fetch the chart
            const charts = await this.fetchAllCharts();
            const chart = charts.find(c => c.chartId === chartId);

            if (!chart) {
                throw new Error(`Chart not found: ${chartId}`);
            }

            console.log(`[Debug] Found chart: "${chart.chartName}"`);

            // Set quality to high for preview (PNG to avoid JPEG artifacts)
            this.exportQuality = { scale: 2.0, compression: 0.9, format: 'PNG' };

            // Render the chart off-screen
            console.log('[Debug] Rendering chart off-screen...');
            const snapshot = await this.renderChartOffScreen(chart);

            if (!snapshot.svg) {
                throw new Error('No SVG snapshot generated');
            }

            console.log('[Debug] SVG generated successfully');
            console.log('[Debug] SVG size:', snapshot.svg.length, 'characters');

            // Open the SVG in a new window
            const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
            const previewWindow = window.open('', '_blank');
            previewWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SVG Preview: ${escapeHtml(chart.chartName)}</title>
                    <style>
                        body {
                            margin: 0;
                            padding: 20px;
                            background: #f5f5f5;
                            font-family: system-ui, -apple-system, sans-serif;
                        }
                        .header {
                            background: white;
                            padding: 15px 20px;
                            border-radius: 8px;
                            margin-bottom: 20px;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        }
                        .header h1 {
                            margin: 0 0 5px 0;
                            font-size: 18px;
                            color: #333;
                        }
                        .header p {
                            margin: 0;
                            font-size: 13px;
                            color: #666;
                        }
                        .svg-container {
                            background: white;
                            padding: 20px;
                            border-radius: 8px;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                            overflow: auto;
                        }
                        .stats {
                            display: flex;
                            gap: 20px;
                            margin-top: 5px;
                        }
                        .stat {
                            font-size: 12px;
                            color: #888;
                        }
                        .stat strong {
                            color: #333;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>SVG Preview: ${escapeHtml(chart.chartName)}</h1>
                        <p>Debug preview of exported SVG with resolved styles</p>
                        <div class="stats">
                            <span class="stat"><strong>Nodes:</strong> ${chart.nodes?.length || 0}</span>
                            <span class="stat"><strong>SVG Size:</strong> ${Math.round(snapshot.svg.length / 1024)} KB</span>
                            <span class="stat"><strong>Image Format:</strong> ${snapshot.primary.format}</span>
                            <span class="stat"><strong>Resolution:</strong> ${snapshot.primary.width}×${snapshot.primary.height}</span>
                        </div>
                    </div>
                    <div class="svg-container">
                        ${snapshot.svg}
                    </div>
                </body>
                </html>
            `);
            previewWindow.document.close();

            console.log('[Debug] Preview window opened successfully');
            return snapshot;

        } catch (error) {
            console.error('[Debug] Preview failed:', error);
            alert(`Preview failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Debug method: List all available charts for preview
     * @returns {Promise<Array>} Array of chart objects with id and name
     */
    async debugListCharts() {
        try {
            const charts = await this.fetchAllCharts();
            console.log('[Debug] Available charts:');
            charts.forEach((chart, index) => {
                console.log(`  ${index + 1}. ${chart.chartId} - "${chart.chartName}" (${chart.nodes?.length || 0} nodes)`);
            });
            return charts.map(c => ({ id: c.chartId, name: c.chartName, nodes: c.nodes?.length || 0 }));
        } catch (error) {
            console.error('[Debug] Failed to list charts:', error);
            throw error;
        }
    }

    /**
     * Cleanup temporary elements
     */
    cleanup() {
        const container = document.getElementById('bulk-export-container');
        if (container) {
            container.innerHTML = '';
        }
        this.capturedCharts = [];
        this.currentChart = 0;
        this.totalCharts = 0;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BulkExportManager;
}
