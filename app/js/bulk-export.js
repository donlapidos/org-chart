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
        // For localStorage (current implementation)
        if (typeof this.storage.getChartsArray === 'function') {
            return this.storage.getChartsArray();
        }

        // For Firestore (future implementation with authentication)
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
     * Render a single chart off-screen and capture as image
     */
    async renderChartOffScreen(chartData) {
        const renderer = this.getNodeRenderer();
        const config = await this.getTemplateConfig();
        const captureWidth = config.images?.captureWidthPx || 2000;
        const captureHeight = config.images?.captureHeightPx || 1128;
        const viewState = chartData.viewState || {};
        const chartNodes = this.prepareChartNodes(chartData);
        const respectViewport = this.shouldRespectViewport(viewState);

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
                // Create temporary org chart instance
                const tempChart = new d3.OrgChart()
                    .container('#temp-chart-canvas')
                    .data(chartNodes)
                    .nodeWidth(() => 250)
                    .nodeHeight((d) => renderer.calculateNodeHeight(d.data || d))
                    .childrenMargin(() => 80)
                    .compactMarginBetween(() => 25)
                    .compactMarginPair(() => 100)
                    .compact(false)
                    .layout(chartData.layout || 'top')
                    .nodeContent((d) => renderer.renderNodeContent(d))
                    .render();

                // Wait for chart to finish rendering before capture
                const maxWait = this.calculateRenderTimeout(chartData);
                this.waitForChartRender(canvasDiv, maxWait)
                    .then(() => {
                        if (respectViewport) {
                            this.applyViewStateTransform(tempChart, viewState);
                        }

                        const svgNode = canvasDiv.querySelector('svg');
                        this.injectNodeStyles(svgNode, resolvedCSS);

                        tempChart.exportImg({
                            full: !respectViewport,
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
                                        svg: svgMarkup
                                    });
                                } finally {
                                    tempChart.clear();
                                    canvasDiv.remove();
                                }
                            }
                        });
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

    shouldRespectViewport(viewState = {}) {
        if (!viewState) return false;
        const hasCollapsed = Array.isArray(viewState.collapsedNodes) && viewState.collapsedNodes.length > 0;
        const zoomChanged = typeof viewState.zoom === 'number' && Math.abs(viewState.zoom - 1) > 0.01;
        const pan = viewState.pan || {};
        const panChanged = (typeof pan.x === 'number' && Math.abs(pan.x) > 1) ||
            (typeof pan.y === 'number' && Math.abs(pan.y) > 1);
        return hasCollapsed || zoomChanged || panChanged;
    }

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
        const includeOverview = this.shouldIncludeOverviewPage();
        const totalPages = 1 + (includeOverview ? 1 : 0) + this.capturedCharts.length;

        const pdf = new jsPDF({
            orientation: 'l',
            unit: 'pt',
            format: [config.page.widthPt, config.page.heightPt]
        });

        let pageNumber = 1;
        const updatedText = this.getLatestUpdatedDate();

        await ExportTemplate.drawCoverPage(pdf, {
            company: 'RRC',
            companySecondary: 'COMPANIES',
            title: 'Organizational Chart',
            updated: updatedText,
            totalPages,
            pageNumber,
            classification: 'CONFIDENTIAL',
            url: 'www.RRCcompanies.com'
        });

        if (includeOverview) {
            pdf.addPage();
            pageNumber += 1;
            await ExportTemplate.drawOverviewPage(pdf, this.buildOverviewDivisions(), {
                title: 'Company Overview',
                totalPages,
                pageNumber,
                classification: 'CONFIDENTIAL',
                url: 'www.RRCcompanies.com'
            });
        }

        for (const captured of this.capturedCharts) {
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
            const previewWindow = window.open('', '_blank');
            previewWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SVG Preview: ${chart.chartName}</title>
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
                        <h1>SVG Preview: ${chart.chartName}</h1>
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
