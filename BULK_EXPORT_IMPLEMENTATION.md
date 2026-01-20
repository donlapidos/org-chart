# Bulk PDF Export Feature - Implementation Guide

**Feature:** Export all org charts into a single combined PDF document

**Output Format:** Similar to `CurrentOrgChart (1).pdf` - each chart on its own page with title and metadata

---

## Overview

This feature allows users to export all organizational charts in the application into a single PDF file. Each chart appears on its own page with:
- Chart title and metadata (department, node count, last modified)
- Full chart visualization as PNG image
- Page numbers and navigation
- Cover page with export timestamp

---

## Files Created

### 1. Core Module
- **`app/js/bulk-export.js`** - Main BulkExportManager class (✅ Created)

### 2. Files to Modify
- **`app/index.html`** - Add export button to dashboard
- **`app/js/dashboard.js`** - Initialize and wire up the export manager
- **`app/chart-editor.html`** - Optional: Add export button to editor toolbar

---

## Step 1: Update Dashboard HTML

Add the "Export All Charts" button to the dashboard header toolbar.

### File: `app/index.html`

**Find this section (around line 17-27):**
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

**Replace with:**
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

**Also add the script import before closing `</body>` tag:**
```html
    <!-- Scripts -->
    <script src="js/storage.js"></script>
    <script src="js/dashboard.js"></script>
    <script src="js/bulk-export.js"></script> <!-- ADD THIS LINE -->
</body>
```

---

## Step 2: Update Dashboard JavaScript

Initialize the BulkExportManager and add the export method.

### File: `app/js/dashboard.js`

**Add this at the top of the `DashboardApp` class constructor (around line 6-12):**
```javascript
class DashboardApp {
    constructor() {
        this.currentFilter = '';
        this.currentDepartment = '';
        this.editingChartId = null;
        this.bulkExportManager = null; // ADD THIS LINE
        this.init();
    }
```

**Add this to the `init()` method (around line 14-17):**
```javascript
init() {
    this.loadDepartments();
    this.renderCharts();
    this.initializeBulkExport(); // ADD THIS LINE
}
```

**Add these new methods at the end of the class (before closing brace):**
```javascript
/**
 * Initialize bulk export manager
 */
initializeBulkExport() {
    // Wait for BulkExportManager to be available
    if (typeof BulkExportManager !== 'undefined') {
        this.bulkExportManager = new BulkExportManager(storage);
        window.bulkExportManager = this.bulkExportManager; // For modal cancel button
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

    // Confirm with user
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

## Step 3: Load Dependencies in Chart Editor (Required for Rendering)

The bulk export needs access to d3-org-chart styles and rendering. Make sure these are loaded.

### File: `app/chart-editor.html`

**Verify these scripts are present (they should be already):**
```html
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-flextree@2.1.2/build/d3-flextree.js"></script>
<script src="https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="../build/d3-org-chart.js"></script>
```

These libraries must be loaded globally for the bulk export to work from the dashboard.

---

## Step 4: Add Global Dependencies to Dashboard

The dashboard needs the same libraries for rendering charts.

### File: `app/index.html`

**Add these scripts BEFORE the existing script tags (around line 118-123):**
```html
    <!-- D3 and Org Chart Dependencies (needed for bulk export) -->
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/d3-flextree@2.1.2/build/d3-flextree.js"></script>
    <script src="https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="../build/d3-org-chart.js"></script>

    <!-- Scripts -->
    <script src="js/storage.js"></script>
    <script src="js/dashboard.js"></script>
    <script src="js/bulk-export.js"></script>
</body>
```

---

## Step 5: Add Org Chart Styles to Dashboard

The bulk export renders charts off-screen but still needs CSS styles.

### File: `app/index.html`

**Add this in the `<head>` section after the existing stylesheet:**
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dynamic Org Chart Creator - Dashboard</title>
    <link rel="stylesheet" href="css/styles.css">

    <!-- ADD THIS BLOCK -->
    <style>
        /* Styles needed for org chart rendering in bulk export */
        .org-chart-node {
            background: white;
            border: 2px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1rem;
            transition: all 0.2s ease;
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
            letter-spacing: 0.3px;
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

        /* Legacy node styles */
        .org-chart-node.legacy .node-name {
            font-weight: 600;
            font-size: 1rem;
            margin-bottom: 0.25rem;
        }

        .org-chart-node.legacy .node-title {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;
        }

        .org-chart-node.legacy .node-department {
            font-size: 0.75rem;
            color: var(--primary-color);
            font-weight: 500;
        }
    </style>
</head>
```

---

## Step 6: Optional - Add Export Button to Chart Editor Toolbar

Allow users to export all charts from within the editor view.

### File: `app/chart-editor.html`

**Find the toolbar section (around line 310-354) and add this button:**
```html
<div class="editor-toolbar">
    <!-- Existing buttons -->
    <button class="btn btn-secondary btn-sm" onclick="editor.addNode()" title="Add New Node">
        ➕ Add Node
    </button>
    <!-- ... other buttons ... -->

    <!-- ADD THIS BUTTON -->
    <div class="toolbar-separator"></div>

    <button class="btn btn-secondary btn-sm" onclick="exportAllFromEditor()" title="Export All Charts to PDF">
        📑 Export All
    </button>
</div>
```

**Add this script at the bottom before closing `</body>`:**
```html
<script>
    // Function to export all charts from editor view
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
            window.bulkExportManager = manager; // For cancel button
            await manager.exportAllCharts();
        }
    }
</script>
```

**Add the bulk-export.js script:**
```html
    <script src="../build/d3-org-chart.js"></script>
    <script src="js/storage.js"></script>
    <script src="js/chart-editor.js"></script>
    <script src="js/bulk-export.js"></script> <!-- ADD THIS LINE -->
</body>
```

---

## Testing the Feature

### Test Case 1: Basic Export (Happy Path)

1. Open the dashboard: `http://localhost:8080/app/index.html`
2. Ensure you have at least 2-3 charts created
3. Click "📄 Export All to PDF" button
4. Confirm the export in the dialog
5. **Expected:**
   - Progress modal appears showing "Fetching charts..."
   - Progress bar animates from 0% to 100%
   - Status updates for each chart: "Rendering 'Chart Name'..."
   - Modal shows "Complete!" at 100%
   - Success toast notification appears
   - PDF downloads as `currentorgchart(1).pdf`
6. **Verify PDF Contents:**
   - Cover page with title, timestamp, and chart count
   - Each chart on its own page
   - Chart title and metadata at top of each page
   - Full chart visualization below metadata
   - Page numbers at bottom (Page X of Y)

### Test Case 2: No Charts Available

1. Clear all charts (or use fresh localStorage)
2. Click "Export All to PDF"
3. **Expected:** Alert saying "No charts available to export"

### Test Case 3: Single Chart Export

1. Have only 1 chart in the system
2. Click "Export All to PDF"
3. **Expected:**
   - Confirmation: "Export all 1 chart to PDF?"
   - PDF with cover page + 1 chart page

### Test Case 4: Cancel During Export

1. Have multiple charts (5+)
2. Click "Export All to PDF"
3. Immediately click "Cancel" button in progress modal
4. **Expected:**
   - Confirmation dialog: "Are you sure you want to cancel?"
   - If confirmed, export stops
   - Modal closes
   - No PDF downloaded

### Test Case 5: Chart Rendering Failure

**Simulate failure by temporarily breaking a chart's data:**
1. Open browser DevTools → Application → Local Storage
2. Find one chart and corrupt its nodes array (change to invalid JSON)
3. Try exporting all charts
4. **Expected:**
   - Progress modal shows which chart failed
   - Dialog asks: "Failed to render chart 'X'. Continue with remaining charts?"
   - If user clicks "Yes", export continues with other charts
   - If user clicks "No", export aborts

### Test Case 6: Large Charts (Performance Test)

1. Create a chart with 50+ nodes
2. Export all charts including this large one
3. **Expected:**
   - Progress bar shows each chart individually
   - Large chart takes longer but completes
   - No browser freezing or crashes
   - PDF contains full chart (scaled to fit)

### Test Case 7: Multi-Person Nodes

1. Create charts with multi-person nodes (multiple roles, multiple people)
2. Export all charts
3. **Expected:**
   - Multi-person nodes render correctly in PDF
   - Department headers visible
   - Role sections properly formatted
   - All names visible and readable

### Test Case 8: Different Layouts

1. Create charts with different layouts:
   - Vertical (top-down)
   - Vertical (bottom-up)
   - Horizontal (left-right)
   - Horizontal (right-left)
2. Export all charts
3. **Expected:**
   - Each layout renders correctly in its orientation
   - All charts fit on A4 landscape pages
   - No clipping or overflow

---

## Troubleshooting

### Issue: "BulkExportManager is not defined"

**Cause:** Script not loaded or loaded in wrong order

**Fix:**
1. Verify `bulk-export.js` is included in HTML
2. Ensure it loads AFTER storage.js
3. Check browser console for script errors

### Issue: Progress modal doesn't appear

**Cause:** Modal CSS not loaded

**Fix:**
1. Verify `styles.css` contains `.modal` and `.modal.active` classes
2. Check that modal HTML is being created (inspect DOM)

### Issue: Charts render as blank images

**Cause:** Missing d3-org-chart library or styles

**Fix:**
1. Verify all dependencies loaded in dashboard:
   - d3.v7.min.js
   - d3-flextree
   - d3-org-chart.js
2. Verify org chart CSS styles present
3. Check browser console for errors

### Issue: PDF contains only cover page

**Cause:** Charts failed to capture or rendering timeout too short

**Fix:**
1. Increase timeout in `renderChartOffScreen()` (line ~162):
   ```javascript
   setTimeout(() => {
       // Capture chart...
   }, 2000); // Increase from 1000 to 2000ms
   ```
2. Check console for render errors

### Issue: "Export failed: Chart data is undefined"

**Cause:** Storage method not compatible

**Fix:**
1. Verify `storage.getChartsArray()` returns valid array
2. Check that charts have required fields (chartName, nodes, etc.)

### Issue: PDF images are low quality

**Cause:** Image scaling issues

**Fix:**
1. Increase render container size in `renderChartOffScreen()`:
   ```javascript
   canvasDiv.style.cssText = `
       width: 3000px;  // Increase from 2000px
       height: 3000px; // Increase from 2000px
       ...
   `;
   ```

### Issue: Export hangs on specific chart

**Cause:** Chart has invalid data or circular references

**Fix:**
1. Use browser DevTools to identify which chart
2. Check that chart's nodes array is valid
3. Verify no circular parent-child references
4. Check console for specific error

---

## Performance Considerations

### Memory Management

The bulk export creates temporary DOM elements and large image data URLs. For optimal performance:

1. **Batch Size:** Current implementation processes all charts sequentially
   - Good for: Up to 50 charts
   - For 50+: Consider adding batch processing with memory cleanup

2. **Image Quality vs Size:**
   - Current: Full quality PNG exports
   - Trade-off: Larger file size but better quality
   - Alternative: Reduce DPI for smaller files

3. **Browser Limitations:**
   - Canvas size limits: ~16,384px (browser-dependent)
   - Memory: Each chart PNG can be 5-10MB in memory
   - Recommendation: Warn users if exporting >20 large charts

### Optimization Options

**For future implementation if needed:**

```javascript
// Add to BulkExportManager constructor
this.maxConcurrent = 1; // Process one chart at a time
this.cleanupInterval = 5; // Cleanup memory every 5 charts

// Modify exportAllCharts to add cleanup
if ((i + 1) % this.cleanupInterval === 0) {
    await this.forceGarbageCollection();
    await new Promise(resolve => setTimeout(resolve, 100));
}

forceGarbageCollection() {
    // Clear captured charts from memory periodically
    if (this.capturedCharts.length > 10) {
        // Keep only last 10 in memory during processing
        this.capturedCharts = this.capturedCharts.slice(-10);
    }
}
```

---

## Future Enhancements

### Phase 2 Features (Optional)

1. **Export Options Dialog:**
   ```javascript
   // Allow users to choose:
   - Page orientation (landscape/portrait)
   - Page size (A4, Letter, Legal)
   - Image quality (high, medium, low)
   - Include/exclude charts (checkbox list)
   ```

2. **Batch Selection:**
   ```javascript
   // Allow exporting only selected charts
   - Add checkboxes to chart cards
   - "Export Selected" button
   - "Select All/None" toggles
   ```

3. **Custom Cover Page:**
   ```javascript
   // Allow customization:
   - Company logo
   - Custom title
   - Additional metadata
   - Organization info
   ```

4. **Email Integration:**
   ```javascript
   // Send PDF via email
   - "Export and Email" button
   - Recipient input
   - Custom message
   - Uses mailto: or backend API
   ```

5. **Cloud Storage:**
   ```javascript
   // Save to cloud services
   - Google Drive integration
   - Dropbox integration
   - OneDrive integration (for Microsoft SSO users)
   ```

6. **Scheduled Exports:**
   ```javascript
   // Automatic exports
   - Daily/weekly/monthly schedule
   - Email delivery
   - Archive management
   ```

---

## Firebase Integration Notes

When migrating to Firebase, update the `fetchAllCharts()` method:

```javascript
async fetchAllCharts() {
    // For Firestore
    if (this.storage.db) {
        const chartsRef = collection(this.storage.db, 'charts');
        const q = query(chartsRef, orderBy('chartName', 'asc'));
        const snapshot = await getDocs(q);

        const charts = [];
        snapshot.forEach(doc => {
            charts.push(doc.data());
        });

        return charts;
    }

    // For localStorage (current)
    if (typeof this.storage.getChartsArray === 'function') {
        return this.storage.getChartsArray();
    }

    throw new Error('Storage method not available');
}
```

---

## Summary Checklist

Before marking this feature complete:

- [ ] `bulk-export.js` created and added to project
- [ ] Dashboard HTML updated with export button
- [ ] Dashboard JS updated with export method
- [ ] All dependencies (d3, jsPDF, etc.) loaded in dashboard
- [ ] Org chart CSS styles added to dashboard
- [ ] Tested with 0 charts (shows error)
- [ ] Tested with 1 chart (works)
- [ ] Tested with multiple charts (works)
- [ ] Tested cancel functionality
- [ ] Tested with multi-person nodes
- [ ] Tested with different layouts
- [ ] Verified PDF format matches reference
- [ ] Progress modal displays correctly
- [ ] Success toast appears after completion
- [ ] PDF downloads with correct filename
- [ ] All charts render correctly in PDF
- [ ] Page numbers present
- [ ] Cover page included
- [ ] No console errors during export

---

## Code Maintenance

### Adding New Chart Types

If new node types are added to the app:

1. Update `renderNodeContent()` in `bulk-export.js`
2. Update `calculateNodeHeight()` if needed
3. Add corresponding CSS styles to dashboard
4. Test export with new node types

### Modifying PDF Layout

To change page layout or styling:

1. Edit `addCoverPage()` for cover page design
2. Edit `addChartHeader()` for chart metadata layout
3. Edit `addChartImage()` for image sizing/positioning
4. Edit `addPageFooter()` for page number styling

### Error Handling

All errors are logged to console and shown to user. To add custom error handling:

```javascript
try {
    await this.renderChartOffScreen(chart);
} catch (error) {
    // Custom error handling
    if (error.message.includes('Canvas')) {
        // Handle canvas errors
    } else if (error.message.includes('Timeout')) {
        // Handle timeout errors
    } else {
        // Generic error
    }
}
```

---

## Support & Documentation

For questions or issues:
1. Check browser console for detailed error messages
2. Verify all dependencies are loaded (Network tab in DevTools)
3. Test in different browsers (Chrome, Firefox, Edge)
4. Review this implementation guide
5. Check FIREBASE_MIGRATION_PLAN.md for future considerations

---

**Implementation Status:** Ready for Development
**Estimated Time:** 1-2 hours
**Testing Time:** 30-60 minutes
**Complexity:** Medium
