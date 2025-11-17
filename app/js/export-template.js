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

    function renderSvgSnapshot(pdf, svgMarkup, area) {
        if (!window.svg2pdf || !svgMarkup) {
            return false;
        }
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
            const svgElement = doc.documentElement;
            svgElement.setAttribute('width', area.width);
            svgElement.setAttribute('height', area.height);
            if (!svgElement.getAttribute('viewBox')) {
                const w = svgElement.getAttribute('width');
                const h = svgElement.getAttribute('height');
                svgElement.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
            window.svg2pdf(svgElement, pdf, {
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
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
        pdf.setFillColor(config.palette.background);
        pdf.rect(0, 0, config.page.widthPt, config.page.heightPt, 'F');
        pdf.setTextColor(config.palette.text);

        pdf.setFont(config.fonts.primary.family, 'bold');
        pdf.setFontSize(config.fonts.primary.scalePt.h1);
        pdf.text(department.name || 'Department', config.page.marginsPt.left, 100);

        if (department.tagline) {
            pdf.setFont(config.fonts.primary.family, 'normal');
            pdf.setFontSize(config.fonts.primary.scalePt.body);
            pdf.text(department.tagline, config.page.marginsPt.left, 130);
        }

        const chartMarginTop = department.tagline ? 150 : 140;
        const availableWidth = config.page.widthPt - config.page.marginsPt.left - config.page.marginsPt.right;
        const availableHeight = config.page.heightPt - chartMarginTop - config.footer.heightPt - 40;
        const chartArea = {
            x: config.page.marginsPt.left,
            y: chartMarginTop,
            width: availableWidth,
            height: availableHeight
        };

        let rendered = false;
        let renderMethod = 'none';

        // Attempt SVG rendering first (vector, high quality)
        if (snapshot?.svg && window.svg2pdf) {
            console.log(`[Export] Attempting SVG render for "${department.name}"`);
            rendered = renderSvgSnapshot(pdf, snapshot.svg, chartArea);
            if (rendered) {
                renderMethod = 'svg';
                console.log(`[Export] ✓ Successfully rendered "${department.name}" as SVG (vector)`);
            } else {
                console.warn(`[Export] ✗ SVG render failed for "${department.name}", falling back to raster`);
            }
        } else {
            if (!snapshot?.svg) {
                console.warn(`[Export] No SVG snapshot available for "${department.name}"`);
            }
            if (!window.svg2pdf) {
                console.warn('[Export] svg2pdf library not loaded, cannot use SVG rendering');
            }
        }

        // Fallback to raster image (JPEG/PNG)
        if (!rendered) {
            const imageVariant = snapshot?.primary || snapshot?.preview;
            if (imageVariant?.dataUrl) {
                console.log(`[Export] Using ${imageVariant.format || 'raster'} image for "${department.name}"`);
                const aspect = imageVariant.width && imageVariant.height
                    ? imageVariant.width / imageVariant.height
                    : config.images.targetAspect;
                let renderWidth = chartArea.width;
                let renderHeight = renderWidth / aspect;
                if (renderHeight > chartArea.height) {
                    renderHeight = chartArea.height;
                    renderWidth = renderHeight * aspect;
                }
                const x = chartArea.x + (chartArea.width - renderWidth) / 2;
                pdf.addImage(
                    imageVariant.dataUrl,
                    imageVariant.format || 'PNG',
                    x,
                    chartArea.y,
                    renderWidth,
                    renderHeight
                );
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
            pdf.text('Org chart snapshot pending…', config.page.widthPt / 2, chartArea.y + 40, {
                align: 'center',
            });
        }

        drawFooter(pdf, config, meta.pageNumber || 3, meta.totalPages || 3, meta);
    }

    global.ExportTemplate = {
        loadTemplateConfig,
        registerExportFonts,
        drawCoverPage,
        drawOverviewPage,
        drawDepartmentPage,
        drawFooter,
    };
})(window);
