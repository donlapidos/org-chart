# Bulk PDF Export - Quick Code Snippets

Copy and paste these exact code snippets into the specified files.

---

## File 1: app/index.html

### Snippet 1A - Add to `<head>` section (after line 7)

```html
<!-- Org Chart Dependencies for Bulk Export -->
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-flextree@2.1.2/build/d3-flextree.js"></script>
<script src="https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="../build/d3-org-chart.js"></script>

<style>
    /* Org Chart Node Styles for Bulk Export */
    .org-chart-node {
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        padding: 1rem;
    }

    .org-chart-node.multi-person {
        background: white;
        border: 2px solid #e0e0e0;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .org-chart-node .node-header {
        background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%);
        color: white;
        padding: 10px 14px;
        font-weight: 600;
        font-size: 13px;
        border-bottom: 3px solid #FF6B35;
        text-align: center;
    }

    .org-chart-node .node-body {
        padding: 12px;
        background: white;
    }

    .org-chart-node .role-section {
        margin-bottom: 14px;
        padding-bottom: 10px;
        border-bottom: 1px solid #f0f0f0;
    }

    .org-chart-node .role-section:last-child {
        margin-bottom: 0;
        border-bottom: none;
        padding-bottom: 0;
    }

    .org-chart-node .role-title {
        font-size: 11px;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 6px;
        font-weight: 500;
        text-align: center;
    }

    .org-chart-node .people-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .org-chart-node .person-row {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
    }

    .org-chart-node .person-name {
        font-weight: 700;
        font-size: 12.5px;
        color: #000;
        line-height: 1.4;
        width: 100%;
    }

    .org-chart-node.legacy .node-name {
        font-weight: 600;
        font-size: 1rem;
        margin-bottom: 0.25rem;
    }

    .org-chart-node.legacy .node-title {
        font-size: 0.875rem;
        color: #64748b;
        margin-bottom: 0.25rem;
    }

    .org-chart-node.legacy .node-department {
        font-size: 0.75rem;
        color: #2563eb;
        font-weight: 500;
    }
</style>
```

### Snippet 1B - Replace toolbar section (around lines 17-27)

**FIND THIS:**
```html
<div class="toolbar-group">
    <button class="btn btn-secondary btn-sm" onclick="app.exportAllData()">
        <span>💾</span> Backup Data
    </button>
    <button class="btn btn-secondary btn-sm" onclick="app.importData()">
        <span>📥</span> Import Data
    </button>
    <button class="btn btn-primary" onclick="app.showCreateModal()">
        <span>➕</span> New Chart
    </button>
</div>
```

**REPLACE WITH:**
```html
<div class="toolbar-group">
    <button class="btn btn-secondary btn-sm" onclick="app.exportAllChartsToPDF()">
        <span>📄</span> Export All to PDF
    </button>
    <button class="btn btn-secondary btn-sm" onclick="app.exportAllData()">
        <span>💾</span> Backup Data
    </button>
    <button class="btn btn-secondary btn-sm" onclick="app.importData()">
        <span>📥</span> Import Data
    </button>
    <button class="btn btn-primary" onclick="app.showCreateModal()">
        <span>➕</span> New Chart
    </button>
</div>
```

### Snippet 1C - Add script import (before closing `</body>` tag)

**FIND THIS (around line 120-123):**
```html
    <!-- Scripts -->
    <script src="js/storage.js"></script>
    <script src="js/dashboard.js"></script>
</body>
```

**REPLACE WITH:**
```html
    <!-- Scripts -->
    <script src="js/storage.js"></script>
    <script src="js/dashboard.js"></script>
    <script src="js/bulk-export.js"></script>
</body>
```

---

## File 2: app/js/dashboard.js

### Snippet 2A - Add to constructor (around line 6-12)

**FIND THIS:**
```javascript
class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.init();
    }
```

**REPLACE WITH:**
```javascript
class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.bulkExportManager = null;
        this.init();
    }
```

### Snippet 2B - Add to init() method (around line 14-17)

**FIND THIS:**
```javascript
init() {
    this.loadDepartments();
    this.renderCharts();
}
```

**REPLACE WITH:**
```javascript
init() {
    this.loadDepartments();
    this.renderCharts();
    this.initializeBulkExport();
}
```

### Snippet 2C - Add these methods at the END of the class (before closing `}`)

**ADD THESE METHODS (around line 365, before the closing brace):**

```javascript
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
     * Export all charts to PDF
     */
    async exportAllChartsToPDF() {
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
```

---

## File 3: app/chart-editor.html (OPTIONAL)

### Snippet 3A - Add to toolbar (around line 343)

**FIND THIS:**
```html
<div class="toolbar-separator"></div>

<button class="btn btn-secondary btn-sm" onclick="editor.exportPNG()" title="Export as PNG">
    🖼️ PNG
</button>
```

**ADD BEFORE IT:**
```html
<button class="btn btn-secondary btn-sm" onclick="exportAllFromEditor()" title="Export All Charts to PDF">
    📑 Export All
</button>

<div class="toolbar-separator"></div>
```

### Snippet 3B - Add script before closing `</body>` (around line 460)

**FIND THIS:**
```html
    <script src="../build/d3-org-chart.js"></script>
    <script src="js/storage.js"></script>
    <script src="js/chart-editor.js"></script>
</body>
```

**REPLACE WITH:**
```html
    <script src="../build/d3-org-chart.js"></script>
    <script src="js/storage.js"></script>
    <script src="js/chart-editor.js"></script>
    <script src="js/bulk-export.js"></script>

    <script>
        // Export all charts from editor view
        async function exportAllFromEditor() {
            if (!storage || typeof BulkExportManager === 'undefined') {
                alert('Export not available');
                return;
            }

            const manager = new BulkExportManager(storage);
            const charts = storage.getChartsArray();

            if (charts.length === 0) {
                alert('No charts available to export');
                return;
            }

            const confirmed = confirm(
                `Export all ${charts.length} chart${charts.length !== 1 ? 's' : ''} to PDF?`
            );

            if (confirmed) {
                window.bulkExportManager = manager;
                await manager.exportAllCharts();
            }
        }
    </script>
</body>
```

---

## Testing Commands

After implementing the above changes, test with these steps:

### 1. Start the server
```bash
python -m http.server 8080
```

### 2. Open dashboard
```
http://localhost:8080/app/index.html
```

### 3. Test scenarios

#### Test 1: Basic export
- Create 2-3 charts
- Click "📄 Export All to PDF"
- Confirm dialog
- Wait for progress modal
- Verify PDF downloads

#### Test 2: Check PDF contents
- Open downloaded `currentorgchart(1).pdf`
- Verify cover page with timestamp
- Verify each chart on its own page
- Verify page numbers

#### Test 3: Cancel during export
- Have 5+ charts
- Click export
- Immediately click "Cancel"
- Confirm cancellation

#### Test 4: No charts
- Clear all charts
- Click export
- Should show "No charts available"

---

## Browser Console Verification

After implementing, open browser DevTools Console and verify:

```javascript
// Check if BulkExportManager is loaded
console.log(typeof BulkExportManager); // Should output: "function"

// Check if app has bulkExportManager
console.log(app.bulkExportManager); // Should output: BulkExportManager instance

// Check if dependencies are loaded
console.log(typeof d3); // Should output: "object"
console.log(typeof jsPDF); // Should output: "undefined" (it's window.jspdf)
console.log(typeof window.jspdf); // Should output: "object"
```

---

## Common Issues & Quick Fixes

### Issue: "BulkExportManager is not defined"
**Fix:** Verify `bulk-export.js` is loaded in HTML

### Issue: Progress modal doesn't show
**Fix:** Check browser console for CSS errors

### Issue: Blank PDF pages
**Fix:** Verify org chart CSS styles are in dashboard HTML

### Issue: "Cannot read property 'exportImg' of undefined"
**Fix:** Verify d3-org-chart.js is loaded

### Issue: Export button does nothing
**Fix:** Check `initializeBulkExport()` is called in `init()`

---

## File Locations Summary

```
org-chart/
├── app/
│   ├── index.html              ← Modify (3 places)
│   ├── chart-editor.html       ← Modify (2 places) [OPTIONAL]
│   └── js/
│       ├── dashboard.js        ← Modify (3 places)
│       ├── bulk-export.js      ← NEW FILE (already created)
│       ├── storage.js          ← No changes
│       └── chart-editor.js     ← No changes
```

---

## Commit Message Template

```
feat: Add bulk PDF export for all org charts

- Add BulkExportManager class to handle multi-chart PDF export
- Add "Export All to PDF" button to dashboard toolbar
- Implement off-screen chart rendering for capture
- Add progress modal with cancel functionality
- Include cover page with metadata and page numbers
- Output format: currentorgchart(1).pdf with one chart per page

Files changed:
- app/js/bulk-export.js (new)
- app/index.html (add export button, dependencies, styles)
- app/js/dashboard.js (add export methods)
- app/chart-editor.html (optional toolbar button)
```

---

## Quick Implementation Checklist

- [ ] Copy `bulk-export.js` to `app/js/` (already done)
- [ ] Add Snippet 1A to `app/index.html` head
- [ ] Add Snippet 1B to `app/index.html` toolbar
- [ ] Add Snippet 1C to `app/index.html` scripts
- [ ] Add Snippet 2A to `app/js/dashboard.js` constructor
- [ ] Add Snippet 2B to `app/js/dashboard.js` init()
- [ ] Add Snippet 2C to `app/js/dashboard.js` end of class
- [ ] Optional: Add Snippet 3A to `app/chart-editor.html`
- [ ] Optional: Add Snippet 3B to `app/chart-editor.html`
- [ ] Test in browser (no console errors)
- [ ] Test export with multiple charts
- [ ] Verify PDF format and content

**Estimated time:** 15-30 minutes

---

**Ready to implement!** Just copy-paste the snippets above into the specified files and test.
