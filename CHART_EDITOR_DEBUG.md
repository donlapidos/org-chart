# Chart Editor - Blank Canvas Debugging Guide

## 🔍 Symptoms
- Delete button works ✅
- Clicking a card opens the editor ✅
- Chart canvas is blank/not visible ❌

---

## 🧪 Diagnostic Steps

### Step 1: Check URL Parameters
When you click a card, the URL should look like:
```
http://localhost/chart-editor.html?id=chart-abc123
```

**Check in browser:**
1. Click a chart card
2. Look at URL bar
3. Should have `?id=SOMETHING`

**If missing `?id=`:**
- Problem: chartId not being passed
- Fix: Check `openChart()` method in dashboard.js

**Console check:**
```javascript
// On editor page
const urlParams = new URLSearchParams(window.location.search);
console.log('Chart ID from URL:', urlParams.get('id'));
// Should show: chart-abc123 or similar
```

---

### Step 2: Check Chart Data Loads

**Open chart-editor.html → Console:**
```javascript
// Get chartId from URL
const urlParams = new URLSearchParams(window.location.search);
const chartId = urlParams.get('id');
console.log('Chart ID:', chartId);

// Check if chart exists in storage
const chart = storage.getChart(chartId);
console.log('Chart data:', chart);

// Should show:
// {
//   chartId: "...",
//   chartName: "...",
//   nodes: [...],
//   departmentTag: "...",
//   ...
// }
```

**If chart is null:**
- Problem: Chart doesn't exist in storage
- Check localStorage: `localStorage.getItem('orgCharts')`

**If chart exists but nodes is empty:**
- Problem: Chart has no nodes
- Create a new chart with default node

---

### Step 3: Check Canvas Element

**Console:**
```javascript
const canvas = document.getElementById('chartCanvas');
console.log('Canvas element:', canvas);
console.log('Canvas visible:', canvas.offsetHeight > 0);
console.log('Canvas innerHTML:', canvas.innerHTML);
```

**Expected:**
- Canvas element exists
- Height > 0 (not collapsed)
- Contains SVG after chart loads

**If canvas is empty:**
- Check if `editor.initOrgChart()` was called
- Check console for errors

---

### Step 4: Check D3 Org Chart Initialization

**Console:**
```javascript
// Check if editor instance exists
console.log('Editor:', window.editor);
console.log('Org chart:', window.editor.orgChart);

// Check chart data
console.log('Chart data:', window.editor.chartData);
console.log('Nodes:', window.editor.chartData?.nodes);
```

**If editor is undefined:**
- ChartEditor class didn't initialize
- Check console for JavaScript errors

**If chartData is null:**
- Chart failed to load from storage
- Check Step 2 again

---

### Step 5: Check for JavaScript Errors

**Open Console → Look for red errors:**

Common errors:
```
❌ Uncaught TypeError: Cannot read property 'nodes' of null
   → Chart data didn't load

❌ Uncaught ReferenceError: d3 is not defined
   → D3.js library didn't load

❌ Uncaught TypeError: d3.OrgChart is not a constructor
   → d3-org-chart.js didn't load

❌ repairHierarchy: nodes is not iterable
   → Chart data structure is broken
```

---

### Step 6: Inspect Chart Canvas

**Right-click canvas → Inspect Element:**

Expected structure:
```html
<div id="chartCanvas" class="chart-canvas">
    <svg width="..." height="...">
        <g class="chart-container">
            <!-- Chart nodes here -->
        </g>
    </svg>
</div>
```

**If no SVG:**
- D3 org chart didn't render
- Check if `orgChart.render()` was called

**If SVG but no nodes:**
- Chart data is empty or malformed
- Check `chartData.nodes` array

---

## 🔧 Common Fixes

### Fix 1: Chart Has No Nodes

**Console:**
```javascript
const chart = storage.getChart(urlParams.get('id'));
if (!chart.nodes || chart.nodes.length === 0) {
    console.error('Chart has no nodes!');

    // Add a default root node
    chart.nodes = [{
        id: storage.generateNodeId(),
        parentId: null,
        members: [{
            roleLabel: 'CEO',
            entries: [{
                name: 'CEO Name',
                email: '',
                phone: '',
                photoUrl: ''
            }]
        }],
        meta: { department: '', notes: '' }
    }];

    storage.updateChart(chart.chartId, chart);
    console.log('Added default node, refresh page');
}
```

Then refresh the editor.

---

### Fix 2: D3 Library Not Loaded

**Check in console:**
```javascript
console.log('D3 loaded:', typeof d3 !== 'undefined');
console.log('D3 OrgChart loaded:', typeof d3.OrgChart !== 'undefined');
```

**If false:**
Check `chart-editor.html` has these script tags:
```html
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="js/d3-org-chart.js"></script>
```

---

### Fix 3: Canvas Has No Height

**Console:**
```javascript
const canvas = document.getElementById('chartCanvas');
console.log('Canvas height:', canvas.offsetHeight);

// If 0, set manually
canvas.style.height = '600px';
canvas.style.minHeight = '600px';
```

**Or add CSS:**
```css
.chart-canvas {
    min-height: 600px;
    width: 100%;
}
```

---

### Fix 4: Chart Data Corrupted

**Check chart structure:**
```javascript
const chart = storage.getChart(urlParams.get('id'));

// Validate structure
console.log('Has chartId:', !!chart.chartId);
console.log('Has nodes array:', Array.isArray(chart.nodes));
console.log('Node count:', chart.nodes?.length);

// Check first node
const firstNode = chart.nodes?.[0];
console.log('First node:', firstNode);
console.log('Has members:', Array.isArray(firstNode?.members));
```

**If structure is wrong:**
- Export data: `storage.exportAllData()`
- Delete corrupted chart
- Re-import or create new chart

---

## 🐛 Debugging Workflow

**1. Open chart-editor.html with a chart ID**
```
http://localhost/chart-editor.html?id=chart-xyz
```

**2. Open browser console (F12)**

**3. Run diagnostic script:**
```javascript
(function diagnoseChart() {
    console.log('=== CHART EDITOR DIAGNOSTICS ===\n');

    // 1. URL
    const urlParams = new URLSearchParams(window.location.search);
    const chartId = urlParams.get('id');
    console.log('1. Chart ID from URL:', chartId);
    if (!chartId) {
        console.error('❌ No chart ID in URL!');
        return;
    }

    // 2. Chart data
    const chart = storage.getChart(chartId);
    console.log('2. Chart exists:', !!chart);
    if (!chart) {
        console.error('❌ Chart not found in storage!');
        return;
    }
    console.log('   Chart name:', chart.chartName);
    console.log('   Nodes:', chart.nodes?.length || 0);

    // 3. Editor instance
    console.log('3. Editor instance:', !!window.editor);
    if (!window.editor) {
        console.error('❌ ChartEditor not initialized!');
        return;
    }

    // 4. Canvas
    const canvas = document.getElementById('chartCanvas');
    console.log('4. Canvas element:', !!canvas);
    console.log('   Canvas height:', canvas?.offsetHeight);
    console.log('   Has SVG:', !!canvas?.querySelector('svg'));

    // 5. D3
    console.log('5. D3 loaded:', typeof d3 !== 'undefined');
    console.log('   D3.OrgChart loaded:', typeof d3?.OrgChart !== 'undefined');

    // 6. Org chart instance
    console.log('6. OrgChart instance:', !!window.editor?.orgChart);

    console.log('\n=== DIAGNOSTICS COMPLETE ===');

    // Summary
    if (chart && chart.nodes?.length > 0 && canvas && typeof d3 !== 'undefined') {
        console.log('✅ Everything looks good! Chart should be visible.');
        console.log('If not visible, check CSS or run: editor.orgChart.render()');
    }
})();
```

**4. Read the output:**
- All ✅ means chart should work
- Any ❌ shows where the problem is

---

## 📊 Expected Console Output (Working Chart)

```
=== CHART EDITOR DIAGNOSTICS ===

1. Chart ID from URL: chart-abc123
2. Chart exists: true
   Chart name: Engineering Team
   Nodes: 5
3. Editor instance: true
4. Canvas element: true
   Canvas height: 600
   Has SVG: true
5. D3 loaded: true
   D3.OrgChart loaded: true
6. OrgChart instance: true

=== DIAGNOSTICS COMPLETE ===
✅ Everything looks good! Chart should be visible.
```

---

## 🚨 Common Issues & Solutions

### Issue: "Chart not found in storage"
**Cause:** Chart was deleted or ID is wrong
**Fix:** Go back to dashboard, verify chart exists

### Issue: "Nodes: 0"
**Cause:** Chart has no nodes
**Fix:** Run Fix 1 above to add default node

### Issue: "D3 loaded: false"
**Cause:** Script tag missing or blocked
**Fix:** Check chart-editor.html has D3 script tags

### Issue: "Canvas height: 0"
**Cause:** CSS issue, canvas collapsed
**Fix:** Add min-height to .chart-canvas

### Issue: "Has SVG: false"
**Cause:** orgChart.render() didn't run
**Fix:**
```javascript
window.editor.orgChart.render();
```

### Issue: White screen, no errors
**Cause:** CSS hiding content
**Fix:** Check for `display: none` or `opacity: 0`

---

## 🔍 Advanced Debugging

### Re-initialize Chart Manually

If chart exists but doesn't render:
```javascript
// Force re-initialization
window.editor.loadChart();
window.editor.initOrgChart();

// Or just re-render
window.editor.orgChart.render();
```

### Inspect Chart Data Structure

```javascript
const chart = storage.getChart(urlParams.get('id'));
console.log(JSON.stringify(chart, null, 2));

// Look for:
// - nodes array
// - each node has id, parentId, members
// - members is array of role groups
// - each role group has roleLabel and entries
```

### Check Hierarchy Repair

```javascript
// Run repair manually
window.editor.repairHierarchy({ persist: true });
console.log('Hierarchy repaired');

// Re-render
window.editor.orgChart.render();
```

---

## 📝 Next Steps

1. **Run the diagnostic script** (copy from "Debugging Workflow" above)
2. **Note which checks fail** (❌)
3. **Apply the corresponding fix**
4. **Refresh and test again**

If all diagnostics pass but chart still isn't visible, share:
- Console output from diagnostic script
- Screenshot of blank canvas
- Any console errors (red text)

This will help identify the exact issue!
