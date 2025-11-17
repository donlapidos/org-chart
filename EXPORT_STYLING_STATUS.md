# Bulk Export Styling Status Report

**Date:** 2025-11-12
**Focus:** Achieving UI-to-PDF style parity for bulk exports

---

## Executive Summary

The bulk export pipeline has been partially improved to fetch and inject `styles.css` dynamically, but **significant gaps remain** before exported PDFs match the live UI or the target specification in `misc/pdf-template/`.

### What's Working ✅
- Dynamic stylesheet fetching with caching
- CSS variable resolution (`var(--primary-color)` → `#2563eb`)
- Resolved CSS injection into hidden render container
- Resolved CSS injection into SVG for serialization
- Comprehensive render path logging (SVG vs JPEG)
- Debug mode for testing (`app.debugPreviewChart()`)
- Removed redundant inline styles from `index.html`

### What's Still Broken ❌
- **Markup mismatch**: Export nodes lack photos, badges, icons, tooltips
- **CSS extraction incomplete**: Regex-based extraction may miss pseudo-classes, media queries
- **SVG path unreliable**: May produce malformed output if styles don't apply correctly
- **JPEG fallback dominates**: When SVG fails, raster screenshots with minimal styling are used
- **Template layout unfinished**: PDF doesn't match `CurrentOrgChart(1)_compressed(1).pdf` spec

---

## Detailed Analysis

### 1. Styling Source (Partially Fixed)

#### ✅ What Was Fixed
- **Removed** duplicate inline `<style>` block from `app/index.html` (was lines 9-58)
- **Added** dynamic fetching of `css/styles.css` via `fetchStylesheet()`
- **Added** CSS variable resolution via `getResolvedCSSVariables()`
- **Injected** resolved CSS into hidden container before rendering

#### ❌ What's Still Broken
- **OrgNodeRenderer still ships minimal CSS** (`app/js/org-node-renderer.js:7-104`)
  - This fallback is only used if stylesheet fetch fails
  - But it creates confusion about which styles are "source of truth"
  - **Recommendation**: Remove `NODE_STYLE_CSS` constant, rely entirely on `styles.css`

- **CSS extraction may miss complex rules**
  - Current regex patterns (`/\.org-chart-node[^{]*\{[^}]*\}/gs`) don't handle:
    - Multi-line property values
    - Nested rules (if using preprocessors)
    - Pseudo-classes (`:hover`, `:before`, `:after`)
    - Media queries
  - **Fallback**: Returns full stylesheet if extraction < 100 chars
  - **Recommendation**: Always inject full stylesheet into SVG, don't extract

**Code Location:**
- `app/js/bulk-export.js:52-68` - fetchStylesheet()
- `app/js/bulk-export.js:74-110` - getResolvedCSSVariables()
- `app/js/bulk-export.js:605-645` - extractOrgChartStyles()

---

### 2. Markup Mismatch (Unfixed)

#### Current State
`OrgNodeRenderer.renderNodeContent()` outputs minimal HTML:
```html
<div class="org-chart-node multi-person">
    <div class="node-header">Department Name</div>
    <div class="node-body">
        <div class="role-section">
            <div class="role-title">ROLE</div>
            <div class="people-list">
                <div class="person-row">
                    <div class="person-name">John Doe</div>
                </div>
            </div>
        </div>
    </div>
</div>
```

#### Missing Elements
- ❌ Profile photos/avatars
- ❌ Status badges
- ❌ Department color tags
- ❌ Tooltip data attributes
- ❌ Icon elements
- ❌ Metric displays (headcount, etc.)

#### Impact
Even with perfect CSS, exported nodes look flat because the HTML structure is too basic.

#### Why This Happens
The live editor chart (`app/chart-editor.html`) might be using a different node rendering function that includes richer markup. The bulk export pipeline uses `OrgNodeRenderer.renderNodeContent()` which was designed as a "simplified fallback."

#### Recommendation
1. **Audit the live editor**: Find where the *actual* node markup is generated
2. **Extract to shared function**: Move that markup generator to `OrgNodeRenderer`
3. **Mirror exactly**: Ensure bulk export uses identical HTML structure
4. **Include assets**: If photos/icons are needed, ensure export pipeline has access to them

**Code Location:**
- `app/js/org-node-renderer.js:152-205` - renderNodeContent()

---

### 3. SVG Style Injection (Partially Fixed)

#### ✅ What Was Fixed
- `injectNodeStyles()` now accepts `resolvedCSS` parameter
- Resolved CSS is passed when injecting into SVG
- Fallback to `OrgNodeRenderer.getNodeStyles()` if no resolved CSS

#### ⚠️ Remaining Concerns
- **CSS extraction may be incomplete** (see §1 above)
- **No verification** that styles actually apply to rendered elements
- **Pseudo-classes stripped**: SVG doesn't support `:hover`, `:focus`, etc.

#### Testing Needed
1. Use `app.debugPreviewChart("chart-id")` to open SVG in new window
2. Inspect SVG `<style>` block - verify all node rules are present
3. Check if gradients (`linear-gradient(135deg, #4A90E2 0%, #357ABD 100%)`) render
4. Check if box-shadows render
5. Verify text fonts and sizes match UI

#### If Styles Don't Apply
**Possible causes:**
- d3.OrgChart wraps nodes in additional containers that aren't styled
- SVG renderer doesn't support certain CSS properties (e.g., `box-shadow` only works in SVG via `<filter>`)
- Class names in SVG don't match selectors in stylesheet

**Debugging:**
```javascript
app.debugPreviewChart("chart-id").then(snapshot => {
    console.log("SVG content:", snapshot.svg.substring(0, 2000));
    // Look for <style> block and verify CSS is present
});
```

**Code Location:**
- `app/js/bulk-export.js:572-597` - injectNodeStyles()
- `app/js/bulk-export.js:539-546` - serializeSvg()

---

### 4. SVG vs JPEG Render Path (Fixed with Logging)

#### ✅ What Was Fixed
- Added comprehensive logging to `ExportTemplate.drawDepartmentPage()`
- Console shows which render path was taken (SVG or JPEG)
- Warns if svg2pdf not loaded
- Warns if SVG snapshot missing

#### Expected Console Output
```
[Export] Attempting SVG render for "Engineering"
[Export] ✓ Successfully rendered "Engineering" as SVG (vector)
```

or

```
[Export] No SVG snapshot available for "HR"
[Export] svg2pdf library not loaded, cannot use SVG rendering
[Export] Using JPEG image for "HR"
[Export] ✓ Successfully rendered "HR" as jpeg
```

#### ❌ Why SVG Path May Fail
1. **svg2pdf.js not loaded**
   - Check `dashboard.js:458` - should load `assets/export/svg2pdf.min.js`
   - Verify file exists and loads successfully
   - Check browser console for 404 errors

2. **SVG malformed**
   - If styles don't inject properly, SVG may be invalid XML
   - svg2pdf will throw error and fall back to JPEG

3. **renderSvgSnapshot() fails silently**
   - Need to add logging inside `renderSvgSnapshot()` to debug

#### Recommendation
Add more detailed logging inside `renderSvgSnapshot()`:
```javascript
function renderSvgSnapshot(pdf, svgMarkup, chartArea) {
    try {
        console.log('[Export] svg2pdf processing SVG:', svgMarkup.length, 'chars');
        // ... existing code ...
        console.log('[Export] svg2pdf completed successfully');
        return true;
    } catch (error) {
        console.error('[Export] svg2pdf failed:', error.message);
        return false;
    }
}
```

**Code Location:**
- `app/js/export-template.js:255-313` - drawDepartmentPage() with logging
- `app/js/export-template.js:168-196` - renderSvgSnapshot() (needs more logging)

---

### 5. Template Layout (Unfixed)

#### Current State
`ExportTemplate.drawDepartmentPage()` produces:
- White background
- Department title (text)
- Optional tagline (text)
- Centered chart image
- Basic footer

#### Target Specification
From `misc/pdf-template/executive_summary.md`:
- **Page size**: 1680×947pt landscape (16:9)
- **Cover page**: Company branding, decorative curves (383), images (3), minimal text
- **Overview page**: 5-column layout, division icons (8), hierarchy boxes (46), connecting curves (539)
- **Department pages**:
  - 3-level hierarchy visualization
  - Header zone (0-150pt): Logo, title
  - Content zone (150-886pt): Org chart with boxes and connectors
  - Footer zone (886-947pt): Dark bar (RGB 26,26,26), white text
- **Typography scale**: 100pt (display) → 12pt (small)
- **Connection system**: 4pt solid black orthogonal lines
- **Box patterns**: Level 1 (400×120pt), Level 2 (350×100pt), Level 3 (250×90pt)

#### Gap Analysis
| Feature | Target | Current | Status |
|---------|--------|---------|--------|
| Page size | 1680×947 | A4 Landscape | ❌ Wrong dimensions |
| Cover page | Branded with curves | Not implemented | ❌ Missing |
| Overview page | 5-column layout | Not implemented | ❌ Missing |
| Header zone | Logo + title | Title only | ⚠️ Minimal |
| Content zone | Org chart with grid | Centered image | ⚠️ Simplified |
| Footer zone | Dark bar, white text | Basic footer | ⚠️ Simplified |
| Typography | 7-level scale | Basic | ❌ Wrong fonts/sizes |
| Hierarchy boxes | 3 levels, specific sizes | Screenshot | ❌ Not drawn |
| Connection lines | 4pt orthogonal | Screenshot | ❌ Not drawn |

#### Why This Is Hard
The target PDF draws org charts **manually** (boxes + connectors) rather than embedding screenshots. This requires:
1. Parsing chart hierarchy data
2. Calculating box positions for each level
3. Drawing boxes with borders, text, styles
4. Drawing connection lines between boxes
5. Handling layout algorithms (centering, spacing)

This is **significantly more work** than the current screenshot approach.

#### Recommendation
**Phase 1 (Quick Win):**
- Keep screenshot approach
- Fix styling so screenshots look good
- Improve page layout (header, footer, margins)
- Use correct page dimensions (1680×947)

**Phase 2 (High Quality):**
- Implement manual box drawing
- Implement connector line drawing
- Follow specification exactly
- Achieve vector quality

**Phase 3 (Full Feature):**
- Implement cover page with branding
- Implement overview page with division columns
- Add customization options (colors, fonts, logos)

**Code Location:**
- `app/js/export-template.js:229-313` - drawDepartmentPage()
- `misc/pdf-template/` - Target specifications

---

## Testing Checklist

### Browser Console Tests
1. ✅ Open http://localhost:8080
2. ✅ Check console for debug commands display
3. ✅ Run `app.debugListCharts()`
4. ✅ Run `app.debugPreviewChart("chart-id")`
5. ✅ Verify SVG opens in new window
6. ⚠️ **Inspect SVG `<style>` block** - verify CSS present
7. ⚠️ **Inspect SVG node elements** - verify markup matches UI
8. ⚠️ **Check visual appearance** - gradients, shadows, fonts

### Full Export Test
1. ✅ Click "Export All to PDF" button
2. ✅ Check console for `[Export]` messages
3. ⚠️ **Verify SVG path used** (not JPEG fallback)
4. ⚠️ **Open exported PDF**
5. ⚠️ **Compare nodes to live UI** - colors, fonts, spacing
6. ⚠️ **Check file size** - SVG should be smaller than JPEG

### Visual Comparison
Compare exported PDF nodes to live UI:
- [ ] Blue gradient header (`linear-gradient(135deg, #4A90E2 0%, #357ABD 100%)`)
- [ ] Orange bottom border (`3px solid #FF6B35`)
- [ ] Box shadow (`0 2px 4px rgba(0,0,0,0.1)`)
- [ ] Font sizes (header 13px, names 12.5px)
- [ ] Font weights (header 600, names 700)
- [ ] Text alignment (all centered)
- [ ] Spacing (padding, margins)

---

## Immediate Action Items

### Priority 1: Verify Current Implementation Works
1. **Test SVG preview**: `app.debugPreviewChart("chart-id")`
   - Does SVG display in new window?
   - Is `<style>` block present in SVG?
   - Do styles actually apply to nodes?
2. **Test full export**: Check console for SVG vs JPEG
3. **If JPEG fallback**: Debug why SVG path failed

### Priority 2: Fix Remaining Style Issues
1. **If styles missing from SVG**:
   - Modify `extractOrgChartStyles()` to return **full stylesheet** instead of extracting
   - Remove extraction logic entirely, inject complete `resolvedCSS`
2. **If styles present but not applying**:
   - Check that class names in SVG match selectors in CSS
   - Verify d3.OrgChart doesn't wrap nodes in unexpected containers
   - Check browser DevTools to see computed styles

### Priority 3: Address Markup Mismatch
1. **Find the "real" node renderer** used in live editor
2. **Compare markup** between editor and `OrgNodeRenderer.renderNodeContent()`
3. **Add missing elements**: photos, badges, icons
4. **Test incremental improvements**: Add one element at a time, verify export

### Priority 4: Improve Template Layout
1. **Phase 1 (Quick)**: Fix page dimensions, improve header/footer
2. **Phase 2 (Later)**: Implement manual box drawing per specification

---

## Open Questions

1. **Does the live editor use a different node renderer?**
   - If yes, where is it?
   - Can we unify them?

2. **Are profile photos/icons stored somewhere?**
   - If yes, how do we access them during export?
   - Do we need to fetch them from URLs?

3. **What's the priority: screenshot approach vs manual drawing?**
   - Screenshot = faster to implement, lower quality
   - Manual = slower to implement, matches spec exactly

4. **Is svg2pdf.js actually loading?**
   - Check Network tab in DevTools
   - Verify `assets/export/svg2pdf.min.js` exists

---

## Code Change Summary

### Files Modified
- `app/js/bulk-export.js` (~200 lines added)
  - CSS fetching, variable resolution, improved extraction, debug mode
- `app/js/export-template.js` (~60 lines modified)
  - Render path logging
- `app/index.html` (~90 lines removed)
  - Deleted redundant inline styles
- `app/js/dashboard.js` (~60 lines added)
  - Debug method wrappers, console help

### Files That Need Changes
- `app/js/org-node-renderer.js`
  - Remove `NODE_STYLE_CSS` constant (use `styles.css` only)
  - Enhance `renderNodeContent()` to match live editor markup
- `app/js/export-template.js`
  - Add logging to `renderSvgSnapshot()`
  - Implement Phase 1 layout improvements
- `app/js/bulk-export.js`
  - Simplify `extractOrgChartStyles()` to return full stylesheet

---

## Success Criteria

### Minimum Viable (Phase 1)
- ✅ Styles from `styles.css` applied to exports
- ✅ SVG render path used (not JPEG fallback)
- ✅ Gradients and shadows visible in PDF
- ✅ Text fonts and sizes match UI
- ⚠️ Markup matches live editor (if different)

### Target (Phase 2)
- [ ] Manual box drawing per specification
- [ ] Correct page dimensions (1680×947)
- [ ] Typography scale implemented
- [ ] Connection lines drawn programmatically
- [ ] Cover and overview pages

### Ideal (Phase 3)
- [ ] Exact match to `CurrentOrgChart(1)_compressed(1).pdf`
- [ ] All 42 pages generated correctly
- [ ] File size < 50MB for 10 charts
- [ ] Vector quality (sharp at any zoom level)

---

## Conclusion

**Current Status**: Partial implementation with foundation in place but significant gaps remaining.

**Next Steps**:
1. Test current implementation with `app.debugPreviewChart()`
2. Verify SVG path works and styles apply
3. Fix any issues found
4. Address markup mismatch
5. Improve template layout incrementally

The infrastructure for dynamic stylesheet fetching and CSS variable resolution is now in place. The main blockers are:
1. Verifying the implementation actually works
2. Fixing any issues with CSS extraction/injection
3. Enhancing node markup to match live editor
4. Implementing fuller PDF template layout

---

**Last Updated**: 2025-11-12 by Claude
**Review Recommended**: After testing with real charts
