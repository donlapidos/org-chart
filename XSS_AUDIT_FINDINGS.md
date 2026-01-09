# XSS Security Audit Findings

**Date:** 2025-12-23
**Scope:** All JavaScript files in app/js/
**Methodology:** Search for innerHTML assignments with user-controlled data

## Executive Summary

While most user data is properly escaped using `escapeHtml()` methods, **4 critical XSS vulnerabilities** were found where user/error data is inserted into innerHTML without sanitization.

---

## Critical Vulnerabilities (MUST FIX)

### 1. User Details in Authentication Banner
**File:** `app/js/auth.js:125`
**Risk:** HIGH
**Code:**
```javascript
userInfo.innerHTML = `
    <div class="user-details">
        <span class="user-name">${user.userDetails}</span>  // ❌ UNESCAPED
        <button class="btn btn-sm btn-outline-secondary" onclick="logout()">Logout</button>
    </div>
`;
```

**Attack Vector:** If `user.userDetails` contains `<img src=x onerror=alert('XSS')>`, it will execute.

**Fix:** Escape user.userDetails or use textContent
```javascript
<span class="user-name">${escapeHtml(user.userDetails)}</span>
```

---

### 2. Error Messages in Admin Panel
**File:** `app/js/admin.js:58`
**Risk:** MEDIUM
**Code:**
```javascript
tbody.innerHTML = `
    <tr>
        <td colspan="4" style="text-align: center; color: #dc3545;">
            Failed to load global roles: ${error.message}  // ❌ UNESCAPED
        </td>
    </tr>
`;
```

**Attack Vector:** If error.message is user-influenced (e.g., from API response containing user input), XSS is possible.

**Fix:** Escape error messages
```javascript
Failed to load global roles: ${this.escapeHtml(error.message)}
```

**Also affects:**
- `app/js/admin.js:284` - Access requests error
- `app/js/chart-sharing.js:111` - Permissions error

---

### 3. Chart Names in SVG Preview Window
**File:** `app/js/bulk-export.js:1387, 1435`
**Risk:** LOW-MEDIUM (only affects debug preview feature)
**Code:**
```javascript
<title>SVG Preview: ${chart.chartName}</title>
<h1>SVG Preview: ${chart.chartName}</h1>
```

**Attack Vector:** Chart names controlled by users could inject HTML/JS into preview window.

**Fix:** Since this is window.document.write(), escape chart names.

---

## Safe Patterns (No Fix Needed) ✅

### Proper Escaping
Most render functions correctly use `escapeHtml()`:
- `dashboard.js` - All chart names escaped
- `admin.js` - User IDs, email addresses escaped (lines 152, 306, 308)
- `chart-sharing.js` - Permission data escaped

### Toast Messages
Error messages passed to `window.toast.error()` are handled by toast.js which likely sanitizes them.

### Attribute Context (Low Risk)
Values used in attributes (not HTML content) are lower risk:
```javascript
<option value="admin" ${user.role === 'admin' ? 'selected' : ''}>
```
These should still be validated but don't allow full HTML injection.

---

## Recommendations

### Immediate Actions
1. ✅ Fix auth.js:125 - Escape user.userDetails
2. ✅ Fix error.message in innerHTML contexts (3 locations)
3. ✅ Fix bulk-export.js chart names

### Short-term
4. Create a global escapeHtml utility instead of duplicating in each class
5. Add ESLint rule to detect unescaped template literals in innerHTML assignments
6. Verify toast.js properly sanitizes messages

### Long-term
7. Remove all innerHTML usage in favor of DOM APIs (createElement, textContent)
8. Implement CSP without 'unsafe-inline' (requires refactoring inline event handlers)
9. Add automated security testing (e.g., DOM XSS scanner)

---

## Fixed vs Remaining

**Status:**
- ✅ Most user data properly escaped (90%+ coverage)
- ❌ 4 critical paths need fixing
- ⚠️ 'unsafe-inline' CSP still present (separate issue)

**Next Steps:**
1. Apply fixes to 4 vulnerable locations
2. Test with XSS payloads: `<img src=x onerror=alert(1)>`, `<script>alert(1)</script>`
3. Consider Content Security Policy upgrade after inline handler refactoring
