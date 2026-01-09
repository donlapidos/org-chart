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
     * @returns {Promise<string>} The CSS content
     */
    async fetchStylesheet() {
        if (this.stylesheetCache) {
            return this.stylesheetCache;
        }

        try {
            const response = await fetch('css/styles.css');
            if (!response.ok) {
                throw new Error(`Failed to fetch stylesheet: ${response.statusText}`);
            }
            this.stylesheetCache = await response.text();
            return this.stylesheetCache;
        } catch (error) {
            console.warn('Failed to fetch styles.css, using fallback styles', error);
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

        // Extract common CSS variables from :root
        const variables = {
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
            '--radius-lg': computedStyle.getPropertyValue('--radius-lg') || '12px'
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
        const qualitySettings = {
            'low': { scale: 1.0, compression: 0.7 },      // ~1-2 MB per chart
            'medium': { scale: 1.5, compression: 0.8 },   // ~3-5 MB per chart
            'high': { scale: 2.0, compression: 0.9 }      // ~8-12 MB per chart
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

                // Filter to only charts owned by the current user
                const currentUserId = window.apiClient?.currentUser?.userId || window.currentUser?.userId;
                const ownedCharts = allChartMetadata.filter(chartMeta => {
                    // Check userRole if available (preferred method)
                    if (chartMeta.userRole) {
                        return chartMeta.userRole === 'owner';
                    }
                    // Fallback: check ownerId directly
                    if (chartMeta.ownerId && currentUserId) {
                        return chartMeta.ownerId === currentUserId;
                    }
                    // If we can't determine ownership, exclude the chart to be safe
                    console.warn(`[BulkExport] Cannot determine ownership for chart ${chartMeta.id}, excluding from export`);
                    return false;
                });

                console.log(`[BulkExport] Charts owned by current user: ${ownedCharts.length}`);

                // NOTE: If includeData is not supported by the backend, chartMeta.data will be missing.
                // Fall back to per-chart fetches in that case.
                const chartsWithData = new Array(ownedCharts.length);
                const chartsNeedingFetch = [];

                ownedCharts.forEach((chartMeta, index) => {
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
     * Measure the actual content bounding box of an SVG by inspecting node positions
     * Returns the tight bounds of all .node elements, removing excess whitespace
     */
    measureSvgContentBounds(svgElement) {
        if (!svgElement) {
            return null;
        }

        try {
            // Find all node elements in the SVG
            const nodeElements = svgElement.querySelectorAll('.node, .node-group, [class*="node"]');

            if (nodeElements.length === 0) {
                // Fallback: use SVG dimensions if no nodes found
                const svgRect = svgElement.getBoundingClientRect();
                return {
                    x: 0,
                    y: 0,
                    width: svgRect.width || parseInt(svgElement.getAttribute('width')) || 2000,
                    height: svgRect.height || parseInt(svgElement.getAttribute('height')) || 1128,
                    originalWidth: svgRect.width || parseInt(svgElement.getAttribute('width')) || 2000,
                    originalHeight: svgRect.height || parseInt(svgElement.getAttribute('height')) || 1128,
                    margin: 50
                };
            }

            // Calculate bounding box by examining all node transforms
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            nodeElements.forEach(node => {
                const bbox = node.getBBox();
                const transform = node.getAttribute('transform');

                // Parse translate values from transform
                let tx = 0, ty = 0;
                if (transform) {
                    const translateMatch = transform.match(/translate\s*\(\s*([^,\s]+)[\s,]+([^)]+)\)/);
                    if (translateMatch) {
                        tx = parseFloat(translateMatch[1]) || 0;
                        ty = parseFloat(translateMatch[2]) || 0;
                    }
                }

                const left = tx + bbox.x;
                const right = left + bbox.width;
                const top = ty + bbox.y;
                const bottom = top + bbox.height;

                minX = Math.min(minX, left);
                minY = Math.min(minY, top);
                maxX = Math.max(maxX, right);
                maxY = Math.max(maxY, bottom);
            });

            // Add configurable padding around content
            const padding = 50; // pixels
            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;

            const svgRect = svgElement.getBoundingClientRect();
            const originalWidth = svgRect.width || parseInt(svgElement.getAttribute('width')) || 2000;
            const originalHeight = svgRect.height || parseInt(svgElement.getAttribute('height')) || 1128;

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
            console.warn('[Export] Failed to measure SVG bounds:', error);
            // Return safe defaults
            return {
                x: 0,
                y: 0,
                width: 2000,
                height: 1128,
                originalWidth: 2000,
                originalHeight: 1128,
                margin: 50
            };
        }
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

        // Adaptive layout parameters based on tree characteristics
        // Start with generous base values to prevent overlaps
        let nodeWidth = 250;
        let childrenMargin = 100;   // Vertical spacing between parent and children (increased from 80)
        let compactMarginBetween = 40;  // Horizontal spacing between siblings (increased from 25)
        let compactMarginPair = 120;    // Spacing between sibling groups (increased from 100)

        // Adjust based on breadth (max nodes at any level)
        if (maxBreadth > 10) {
            // Very wide tree: smaller nodes, more spacing
            nodeWidth = 200;
            compactMarginBetween = 50;   // Critical: extra spacing for wide levels
            compactMarginPair = 140;
            childrenMargin = 110;
        } else if (maxBreadth > 7) {
            // Wide tree: moderate reduction, increased spacing
            nodeWidth = 220;
            compactMarginBetween = 45;
            compactMarginPair = 130;
            childrenMargin = 105;
        } else if (maxBreadth > 4) {
            // Medium tree: slight adjustments
            nodeWidth = 235;
            compactMarginBetween = 42;
            compactMarginPair = 125;
        }

        // Adjust based on depth (number of levels)
        if (depth > 6) {
            // Very deep tree: increase vertical spacing significantly
            childrenMargin = 120;
        } else if (depth > 4) {
            childrenMargin = 110;
        }

        // For dense trees, add extra padding everywhere
        const density = totalNodes / (depth * maxBreadth || 1);
        if (density > 1.5) {
            childrenMargin += 20;
            compactMarginBetween += 15;
            compactMarginPair += 20;
        }

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
     * Render a single chart off-screen and capture as image
     */
    async renderChartOffScreen(chartData) {
        const renderer = this.getNodeRenderer();
        const config = await this.getTemplateConfig();
        const viewState = chartData.viewState || {};
        const chartNodes = this.prepareChartNodes(chartData);

        // Analyze chart structure for adaptive spacing
        const analysis = this.analyzeChartStructure(chartData.nodes || []);
        console.log(`[Export] Chart "${chartData.name}": ${analysis.totalNodes} nodes, depth=${analysis.depth}, breadth=${analysis.maxBreadth}`);
        console.log(`[Export] Adaptive layout: nodeWidth=${analysis.layoutParams.nodeWidth}, childrenMargin=${analysis.layoutParams.childrenMargin}, compactMarginBetween=${analysis.layoutParams.compactMarginBetween}`);

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
            styleTag.textContent = resolvedCSS;
            canvasDiv.appendChild(styleTag);

            container.appendChild(canvasDiv);

            try {
                // Create temporary org chart instance with adaptive spacing and dynamic sizing
                const params = analysis.layoutParams;
                const tempChart = new d3.OrgChart()
                    .container('#temp-chart-canvas')
                    .data(chartNodes)
                    .svgWidth(captureWidth)    // Use dynamic canvas width
                    .svgHeight(captureHeight)  // Use dynamic canvas height
                    .nodeWidth(() => params.nodeWidth)
                    .nodeHeight((d) => renderer.calculateNodeHeight(d.data || d))
                    .childrenMargin(() => params.childrenMargin)
                    .compactMarginBetween(() => params.compactMarginBetween)
                    .compactMarginPair(() => params.compactMarginPair)
                    .compact(false)
                    .layout(chartData.layout || 'top')
                    .nodeContent((d) => renderer.renderNodeContent(d))
                    .render();

                // Wait for chart to finish rendering before capture
                const maxWait = this.calculateRenderTimeout(chartData);
                this.waitForChartRender(canvasDiv, maxWait)
                    .then(() => {
                        // For export: skip collapsed state to always show full org tree
                        // Users can manually collapse in editor, but exports should be comprehensive
                        // TODO: Add user preference toggle for "Respect current view" vs "Full tree"

                        // Explicitly call fit() to ensure all nodes are visible and properly framed
                        // Because we sized the canvas based on tree complexity, fit() won't need to
                        // compress the spacing - it will just center/position the content
                        if (typeof tempChart.fit === 'function') {
                            tempChart.fit();
                            console.log(`[Export] Called fit() to center content (canvas is sized for tree complexity)`);
                        }

                        // Wait a moment for fit() to complete
                        setTimeout(() => {
                            const svgNode = canvasDiv.querySelector('svg');
                            this.injectNodeStyles(svgNode, resolvedCSS);

                            // Measure SVG content bounds AFTER fit() for accurate dimensions
                            const contentBounds = this.measureSvgContentBounds(svgNode);

                            // Define page insets (margins for legibility while maximizing chart area)
                            // Page: 1680×947pt landscape (16:9)
                            const pageWidth = config.page?.width || 1680;
                            const pageHeight = config.page?.height || 947;
                            const insets = {
                                left: 80,    // Space for page edge
                                right: 80,   // Space for page edge
                                top: 140,    // Space for department title
                                bottom: 70   // Space for footer
                            };

                            const availableWidth = pageWidth - insets.left - insets.right;   // ~1520pt
                            const availableHeight = pageHeight - insets.top - insets.bottom; // ~737pt

                            // Compute optimal scale to fill 95% of available area (aggressive but safe)
                            const scaleInfo = this.computeOptimalScale(
                                contentBounds,
                                availableWidth,
                                availableHeight,
                                0.95  // Fill 95% for maximum page usage
                            );

                            console.log(`[Export] Chart "${chartData.name}": content ${Math.round(contentBounds.width)}×${Math.round(contentBounds.height)}px, scale ${scaleInfo.scale.toFixed(2)}x to fill page`);

                            // Always use full: true to call chart.fit() for consistent framing
                            tempChart.exportImg({
                                full: true,
                                save: false,
                                scale: this.exportQuality.scale,
                            onLoad: async (base64Image) => {
                                try {
                                    const compressedImage = await this.compressImage(
                                        base64Image,
                                        this.exportQuality.compression
                                    );

                                    const previewImage = await this.resizeImageDataUrl(
                                        compressedImage,
                                        config.images?.previewWidthPx || 800
                                    );

                                    const svgMarkup = svgNode ? this.serializeSvg(svgNode, resolvedCSS) : null;

                                    const format = compressedImage.startsWith('data:image/png') ? 'PNG' : 'JPEG';

                                    resolve({
                                        primary: {
                                            dataUrl: compressedImage,
                                            format,
                                            width: captureWidth,
                                            height: captureHeight
                                        },
                                        preview: previewImage,
                                        svg: svgMarkup,
                                        // Include bounds and scale metadata for PDF placement
                                        bounds: contentBounds,
                                        scale: scaleInfo
                                    });
                                } finally {
                                    tempChart.clear();
                                    canvasDiv.remove();
                                }
                            }
                        });
                        }, 200); // Wait 200ms for fit() to complete
                    })
                    .catch((waitError) => {
                        // Clean up on error too
                        try {
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
     * Compress image to reduce file size
     */
    async compressImage(base64Image, quality = 0.8) {
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

                // Convert to JPEG with compression
                const compressed = canvas.toDataURL('image/jpeg', quality);
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
        const viewState = chartData.viewState || {};
        const collapsedSet = new Set(
            Array.isArray(viewState.collapsedNodes) ? viewState.collapsedNodes : []
        );

        return nodes.map(node => {
            const explicit = typeof node._expanded === 'boolean' ? node._expanded : null;
            const shouldExpand = node.parentId ? !collapsedSet.has(node.id) : true;
            return {
                id: node.id,
                parentId: node.parentId || '',
                members: node.members || [],
                meta: node.meta || {},
                _expanded: explicit !== null ? explicit : shouldExpand,
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

        const pdf = new jsPDF({
            orientation: 'l',
            unit: 'pt',
            format: [config.page.widthPt, config.page.heightPt]
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

            // Set quality to high for preview
            this.exportQuality = { scale: 2.0, compression: 0.9 };

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
