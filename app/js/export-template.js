/**
 * Export template helpers responsible for recreating the branded PDF layout.
 * These helpers are consumed by BulkExportManager when assembling the final PDF.
 */
(function (global) {
    const CONFIG_URL = 'assets/export/export-template-config.json';
    const FONT_CACHE = new Map();
    const state = {
        configPromise: null,
    };

    async function loadTemplateConfig() {
        if (!state.configPromise) {
            state.configPromise = fetch(CONFIG_URL).then((res) => {
                if (!res.ok) {
                    throw new Error(`Failed to load template config (${CONFIG_URL})`);
                }
                return res.json();
            });
        }
        return state.configPromise;
    }

    async function fetchFontBase64(fontPath) {
        if (FONT_CACHE.has(fontPath)) {
            return FONT_CACHE.get(fontPath);
        }
        const response = await fetch(fontPath);
        if (!response.ok) {
            throw new Error(`Failed to load font ${fontPath}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binary);
        FONT_CACHE.set(fontPath, base64);
        return base64;
    }

    async function registerExportFonts(pdf) {
        const config = await loadTemplateConfig();
        if (pdf.__exportTemplateFontsRegistered) {
            return config;
        }
        const fonts = config.fonts.primary;
        const regularBase64 = await fetchFontBase64(fonts.files.regular);
        const semiBase64 = await fetchFontBase64(fonts.files.semibold);
        pdf.addFileToVFS('Roboto-Regular.ttf', regularBase64);
        pdf.addFont('Roboto-Regular.ttf', fonts.family, 'normal');
        pdf.addFileToVFS('Roboto-Bold.ttf', semiBase64);
        pdf.addFont('Roboto-Bold.ttf', fonts.family, 'bold');

        const headingFonts = config.fonts.heading;
        if (headingFonts && headingFonts.files) {
            const headingRegularBase64 = await fetchFontBase64(headingFonts.files.regular);
            const headingSemiBase64 = await fetchFontBase64(headingFonts.files.semibold);
            pdf.addFileToVFS('SpaceGrotesk-Regular.ttf', headingRegularBase64);
            pdf.addFont('SpaceGrotesk-Regular.ttf', headingFonts.family, 'normal');
            pdf.addFileToVFS('SpaceGrotesk-SemiBold.ttf', headingSemiBase64);
            pdf.addFont('SpaceGrotesk-SemiBold.ttf', headingFonts.family, 'bold');
        }
        pdf.__exportTemplateFontsRegistered = true;
        return config;
    }

    function drawFooter(pdf, config, pageNumber, totalPages, meta = {}) {
        const footer = config.footer;
        const page = config.page;
        pdf.setFillColor(config.palette.footer);
        pdf.rect(
            0,
            page.heightPt - footer.heightPt,
            page.widthPt,
            footer.heightPt,
            'F'
        );
        pdf.setFont(config.fonts.primary.family, 'normal');
        pdf.setFontSize(footer.textPt);
        pdf.setTextColor(255, 255, 255);
        const footerText = [
            meta.classification || 'CONFIDENTIAL',
            meta.url || 'www.RRCcompanies.com',
            `Page ${pageNumber} / ${totalPages}`,
        ].join('   •   ');
        pdf.text(footerText, page.widthPt / 2, page.heightPt - footer.heightPt / 2 + 5, {
            align: footer.alignment,
        });
    }

    function drawLogo(pdf, config) {
        if (!config.logo || !config.logo.path) return Promise.resolve();
        return fetch(config.logo.path)
            .then((res) => res.blob())
            .then((blob) => new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = async function () {
                    try {
                        let dataUrl = reader.result;
                        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/svg')) {
                            dataUrl = await rasterizeSvg(dataUrl);
                        }
                        if (dataUrl) {
                            pdf.addImage(
                                dataUrl,
                                'PNG',
                                config.logo.positionPt.x,
                                config.logo.positionPt.y,
                                config.logo.sizePt.width,
                                config.logo.sizePt.height
                            );
                        }
                    } finally {
                        resolve();
                    }
                };
                reader.readAsDataURL(blob);
            }))
            .catch(() => {
                // Silently ignore if logo missing
            });
    }

    function rasterizeSvg(svgDataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width || 400;
                canvas.height = img.height || 200;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = svgDataUrl;
        });
    }

    function renderSvgSnapshot(pdf, svgMarkup, area, bounds = null, scaleInfo = null) {
        if (!window.svg2pdf || !svgMarkup) {
            return false;
        }
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
            const svgElement = doc.documentElement;

            // Use computed scale factors if available for optimal fill
            let renderX, renderY, renderWidth, renderHeight, viewBox;
            if (bounds && scaleInfo) {
                // Apply optimal scaling to crop whitespace and fill page
                renderWidth = scaleInfo.finalWidth;
                renderHeight = scaleInfo.finalHeight;

                // Smart positioning based on aspect ratio
                const aspectRatio = renderWidth / renderHeight;

                if (aspectRatio > 2.0) {
                    // Extra-wide chart: anchor higher
                    renderX = area.x + scaleInfo.offsetX;
                    renderY = area.y + Math.min(scaleInfo.offsetY, 20);
                } else if (aspectRatio < 0.8) {
                    // Tall chart: center horizontally, anchor near top
                    renderX = area.x + (area.width - renderWidth) / 2;
                    renderY = area.y + 20;
                } else {
                    // Balanced chart: center both axes
                    renderX = area.x + scaleInfo.offsetX;
                    renderY = area.y + scaleInfo.offsetY;
                }

                // Set viewBox to crop to content bounds
                viewBox = `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`;
                console.log(`[Export] SVG viewBox cropped to content: ${viewBox}, scaled ${scaleInfo.scale.toFixed(2)}x [AR: ${aspectRatio.toFixed(2)}]`);
            } else {
                // Fallback to old behavior
                renderX = area.x;
                renderY = area.y;
                renderWidth = area.width;
                renderHeight = area.height;
                if (!svgElement.getAttribute('viewBox')) {
                    const w = svgElement.getAttribute('width');
                    const h = svgElement.getAttribute('height');
                    viewBox = `0 0 ${w} ${h}`;
                } else {
                    viewBox = svgElement.getAttribute('viewBox');
                }
            }

            svgElement.setAttribute('width', renderWidth);
            svgElement.setAttribute('height', renderHeight);
            svgElement.setAttribute('viewBox', viewBox);

            window.svg2pdf(svgElement, pdf, {
                x: renderX,
                y: renderY,
                width: renderWidth,
                height: renderHeight,
                preserveAspectRatio: 'xMidYMid meet'
            });
            return true;
        } catch (err) {
            console.warn('SVG render failed', err);
            return false;
        }
    }

    async function drawCoverPage(pdf, meta = {}) {
        const config = await registerExportFonts(pdf);
        pdf.setFillColor(config.palette.background);
        pdf.rect(0, 0, config.page.widthPt, config.page.heightPt, 'F');
        await drawLogo(pdf, config);

        pdf.setTextColor(config.palette.text);
        pdf.setFont(config.fonts.primary.family, 'bold');
        pdf.setFontSize(config.fonts.primary.scalePt.display);
        const headlineY = config.page.heightPt * 0.35;
        pdf.text(meta.company || 'RRC', config.page.marginsPt.left, headlineY);
        pdf.text(meta.companySecondary || 'COMPANIES', config.page.marginsPt.left, headlineY + 110);

        pdf.setFontSize(config.fonts.primary.scalePt.h1);
        pdf.text(meta.title || 'Organizational Chart', config.page.marginsPt.left, headlineY + 190);

        pdf.setFont(config.fonts.primary.family, 'normal');
        pdf.setFontSize(config.fonts.primary.scalePt.bodySmall);
        const dateText = meta.updated
            ? `Updated as of ${meta.updated}`
            : 'Updated as of 30 Oct 2025';
        pdf.text(dateText, config.page.marginsPt.left, config.page.heightPt - config.footer.heightPt - 30);

        drawFooter(pdf, config, meta.pageNumber || 1, meta.totalPages || 1, meta);
    }

    async function drawOverviewPage(pdf, divisions = [], meta = {}) {
        const config = await registerExportFonts(pdf);
        pdf.setFillColor(config.palette.background);
        pdf.rect(0, 0, config.page.widthPt, config.page.heightPt, 'F');

        pdf.setFont(config.fonts.primary.family, 'bold');
        pdf.setFontSize(config.fonts.primary.scalePt.h1);
        pdf.text(meta.title || 'Company Overview', config.page.widthPt / 2, 80, {
            align: 'center',
        });

        const columns = config.overviewColumns;
        const startX = config.page.marginsPt.left;
        const columnWidth = columns.widthPt;
        const gutter = columns.gutterPt;
        const yStart = config.page.zones.content.yPt + 40;

        divisions.slice(0, columns.count).forEach((division, index) => {
            const x = startX + index * (columnWidth + gutter);
            pdf.setDrawColor(0);
            pdf.setLineWidth(1);
            pdf.rect(x, yStart, columnWidth, 600);

            pdf.setFontSize(config.fonts.primary.scalePt.h2);
            pdf.text(division.name || `Division ${index + 1}`, x + columnWidth / 2, yStart + 30, {
                align: 'center',
            });

            pdf.setFontSize(config.fonts.primary.scalePt.body);
            const entries = division.entries || [];
            entries.forEach((entry, idx) => {
                const y = yStart + 60 + idx * 24;
                if (y > yStart + 560) return;
                pdf.text(entry, x + 20, y);
            });
        });

        drawFooter(pdf, config, meta.pageNumber || 2, meta.totalPages || 2, meta);
    }

    async function drawDepartmentPage(pdf, department, snapshot, meta = {}) {
        const config = await registerExportFonts(pdf);

        // Use actual PDF page dimensions (global max size set by assemblePDF)
        // This ensures all pages are the same size - no custom sizing per chart
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        pdf.setFillColor(config.palette.background);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setTextColor(config.palette.text);

        // Define content area with minimal insets to maximize chart visibility
        const insets = {
            left: 60,
            right: 60,
            top: 130,  // Space for title + optional tagline
            bottom: 60
        };

        const availableWidth = pageWidth - insets.left - insets.right;
        const availableHeight = pageHeight - insets.top - insets.bottom;

        const chartArea = {
            x: insets.left,
            y: insets.top,
            width: availableWidth,
            height: availableHeight
        };

        let rendered = false;
        let renderMethod = 'none';

        // Prefer raster rendering for PDFs (more reliable for HTML-based org chart nodes)
        // SVG rendering disabled to avoid svg2pdf issues with complex HTML foreignObject elements
        // If SVG is needed in the future, set PREFER_SVG_EXPORT = true
        const PREFER_SVG_EXPORT = false;

        if (PREFER_SVG_EXPORT && snapshot?.svg && window.svg2pdf) {
            console.log(`[Export] Attempting SVG render for "${department.name}"`);
            rendered = renderSvgSnapshot(pdf, snapshot.svg, chartArea, snapshot.bounds, snapshot.scale);
            if (rendered) {
                renderMethod = 'svg';
                console.log(`[Export] ✓ Successfully rendered "${department.name}" as SVG (vector)`);
            } else {
                console.warn(`[Export] ✗ SVG render failed for "${department.name}", falling back to raster`);
            }
        }

        // Use raster image (PNG) - primary export method
        // PNG preserves line fidelity; reduced scale (1.5x) keeps size under jsPDF string limit
        if (!rendered) {
            const imageVariant = snapshot?.primary || snapshot?.preview;
            if (imageVariant?.dataUrl) {
                console.log(`[Export] Using ${imageVariant.format || 'raster'} image for "${department.name}"`);

                // Always compute scale from image dimensions to fit actual chartArea
                // (precomputed snapshot.scale may not match global page size)
                const snapshotWidth = imageVariant.width || snapshot?.bounds?.width || chartArea.width;
                const snapshotHeight = imageVariant.height || snapshot?.bounds?.height || chartArea.height;

                // Scale to fit within chart area with 98% fill for maximum page usage
                const scaleX = chartArea.width / snapshotWidth;
                const scaleY = chartArea.height / snapshotHeight;
                const scale = Math.min(scaleX, scaleY) * 0.98;

                const renderWidth = snapshotWidth * scale;
                const renderHeight = snapshotHeight * scale;

                // Center the chart in available area
                const x = chartArea.x + (chartArea.width - renderWidth) / 2;
                const y = chartArea.y + (chartArea.height - renderHeight) / 2;

                console.log(`[Export] Scale ${scale.toFixed(2)}x: ${Math.round(snapshotWidth)}×${Math.round(snapshotHeight)}px → ${Math.round(renderWidth)}×${Math.round(renderHeight)}pt at (${Math.round(x)}, ${Math.round(y)})`);


                pdf.addImage(
                    imageVariant.dataUrl,
                    imageVariant.format || 'PNG',
                    x,
                    y,
                    renderWidth,
                    renderHeight
                );

                // Draw title and tagline AFTER chart to ensure they appear on top (PDF z-order)
                const headingFontFamily = config.fonts.heading?.family || config.fonts.primary.family;
                const headingX = pageWidth / 2;
                pdf.setFont(headingFontFamily, 'bold');
                pdf.setFontSize(config.fonts.primary.scalePt.h1);
                pdf.text(department.name || 'Department', headingX, 100, { align: 'center' });

                if (department.tagline) {
                    pdf.setFont(config.fonts.primary.family, 'normal');
                    pdf.setFontSize(config.fonts.primary.scalePt.body);
                    pdf.text(department.tagline, headingX, 130, { align: 'center' });
                }

                rendered = true;
                renderMethod = imageVariant.format?.toLowerCase() || 'raster';
                console.log(`[Export] ✓ Successfully rendered "${department.name}" as ${renderMethod}`);
            } else {
                console.error(`[Export] No image data available for "${department.name}"`);
            }
        }

        if (!rendered) {
            console.error(`[Export] Failed to render "${department.name}" - no valid snapshot data`);
            pdf.setDrawColor(0);
            pdf.setLineWidth(0.5);
            pdf.rect(chartArea.x, chartArea.y, chartArea.width, chartArea.height);
            pdf.setFont(config.fonts.primary.family, 'normal');
            pdf.setFontSize(config.fonts.primary.scalePt.body);
            pdf.text('Org chart snapshot pending…', pageWidth / 2, chartArea.y + 40, {
                align: 'center',
            });
        }

        // Draw footer with actual page dimensions
        const footerConfig = { ...config, page: { ...config.page, widthPt: pageWidth, heightPt: pageHeight } };
        drawFooter(pdf, footerConfig, meta.pageNumber || 3, meta.totalPages || 3, meta);
    }

    /**
     * Draw a full-page cover image (section divider)
     * @param {jsPDF} pdf - PDF instance
     * @param {string} imagePath - Path to the cover image
     * @param {Object} meta - Metadata (pageNumber, totalPages, etc.)
     */
    async function drawCoverImagePage(pdf, imagePath, meta = {}) {
        const config = await registerExportFonts(pdf);

        // Use actual PDF page dimensions (supports global max page size)
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Set background
        pdf.setFillColor(config.palette.background);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        try {
            // Fetch and add the cover image
            const response = await fetch(imagePath);
            if (!response.ok) {
                throw new Error(`Failed to load cover image: ${response.statusText}`);
            }

            const blob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            // Add image to fill the entire page (uses actual page dimensions)
            pdf.addImage(
                dataUrl,
                'PNG',
                0,
                0,
                pageWidth,
                pageHeight
            );

            console.log(`[Export] ✓ Added cover image: ${imagePath} (${Math.round(pageWidth)}×${Math.round(pageHeight)}pt)`);
        } catch (error) {
            console.error(`[Export] Failed to load cover image "${imagePath}":`, error);

            // Fallback: display a placeholder
            pdf.setFont(config.fonts.primary.family, 'bold');
            pdf.setFontSize(config.fonts.primary.scalePt.h1);
            pdf.setTextColor(config.palette.text);
            pdf.text('Section Cover', pageWidth / 2, pageHeight / 2, {
                align: 'center',
            });
        }

        // Note: Cover images typically have their own footer/branding, so we skip drawFooter here
        // If you want to add a footer, uncomment the line below:
        // drawFooter(pdf, config, meta.pageNumber || 1, meta.totalPages || 1, meta);
    }

    global.ExportTemplate = {
        loadTemplateConfig,
        registerExportFonts,
        drawCoverPage,
        drawOverviewPage,
        drawDepartmentPage,
        drawCoverImagePage,
        drawFooter,
    };
})(window);
