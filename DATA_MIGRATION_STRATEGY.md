# Data Migration Strategy: localStorage → Azure Cosmos DB

**Version:** 1.0
**Date:** 2025-12-23
**Status:** Active migration in progress

---

## Overview

The Org Chart application is migrating from **client-side localStorage** to **cloud-based Azure Cosmos DB** to enable:
- Multi-user collaboration
- Cross-device synchronization
- Role-based access control
- Soft delete and data recovery
- Centralized backups

**Migration approach:** Dual-persistence with gradual phase-out of localStorage.

---

## Architecture

### Before (Legacy)
```
User → Browser → localStorage
                 ↓
          JSON.stringify(chart)
```

**Limitations:**
- Single user per browser
- No sharing between devices
- No collaboration
- 5-10MB storage limit

### After (Target)
```
User → Browser → API Client → Azure Functions → Cosmos DB
                                                  ↓
                                            NoSQL Collections:
                                            - charts
                                            - users
                                            - global_roles
                                            - deleted_charts
```

**Benefits:**
- Multi-user collaboration
- Unlimited storage
- Fine-grained permissions
- Audit logging
- 99.99% SLA uptime

### Current (Transitional)
```
User → Dashboard
       ↓
       ├─→ API Client (authenticated users) → Cosmos DB
       └─→ Storage.js fallback (legacy/offline) → localStorage
```

**Dual-persistence rules:**
1. **Authenticated users:** Always use Cosmos DB (API client)
2. **Anonymous users:** Read-only localStorage fallback for backward compatibility
3. **Migration prompt:** One-time offer to migrate localStorage data to cloud

---

## Data Model Comparison

### localStorage Format
**Key:** `orgChart_{chartId}`
**Value:** JSON string
```json
{
  "chartId": "550e8400-e29b-41d4-a716-446655440000",
  "chartName": "Engineering Team",
  "departmentTag": "Engineering",
  "description": "Q4 2025 org structure",
  "nodes": [
    {
      "id": "node_1",
      "parentId": null,
      "members": [...],
      "meta": {...}
    }
  ],
  "layout": "top",
  "viewState": {...},
  "lastModified": "2025-01-20T14:30:00Z"
}
```

**Metadata Key:** `orgChartsMetadata`
**Value:** Array of chart summaries

### Cosmos DB Format
**Collection:** `charts`
**Document ID:** UUID v4
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ownerId": "azure-ad-object-id",
  "ownerEmail": "user@company.com",
  "name": "Engineering Team",
  "data": {
    "chartName": "Engineering Team",
    "departmentTag": "Engineering",
    "description": "Q4 2025 org structure",
    "nodes": [...],
    "layout": "top",
    "viewState": {...}
  },
  "permissions": [
    {
      "userId": "another-user-id",
      "role": "EDITOR",
      "grantedAt": "2025-01-15T10:00:00Z"
    }
  ],
  "createdAt": "2025-01-15T10:00:00Z",
  "lastModified": "2025-01-20T14:30:00Z",
  "lastModifiedBy": "azure-ad-object-id",
  "isDeleted": false
}
```

**Key differences:**
- Chart data nested under `data` property
- Owner tracking (`ownerId`, `ownerEmail`)
- Permissions array for sharing
- Audit fields (`createdAt`, `lastModifiedBy`)
- Soft delete flag (`isDeleted`)

---

## Migration Flow

### Phase 1: Detection (✅ DONE)
**File:** `app/js/api-client.js`, `app/js/storage.js`

1. **On dashboard load:**
   - Check if user is authenticated
   - If authenticated, check localStorage for unmigrated charts
   - Prompt user with migration banner

2. **Detection logic:**
   ```javascript
   const hasLocalCharts = localStorage.getItem('orgChartsMetadata') !== null;
   const isAuthenticated = await apiClient.isUserAuthenticated();
   const migrationComplete = localStorage.getItem('cloudMigrationComplete') === 'true';

   if (hasLocalCharts && isAuthenticated && !migrationComplete) {
       showMigrationPrompt();
   }
   ```

### Phase 2: Migration (IN PROGRESS)
**Trigger:** User clicks "Migrate to Cloud" button

**Steps:**
1. Read all charts from localStorage
2. For each chart:
   ```javascript
   const localChart = JSON.parse(localStorage.getItem(`orgChart_${chartId}`));

   // Transform to Cosmos DB format
   const cloudChart = {
       name: localChart.chartName,
       data: {
           chartName: localChart.chartName,
           departmentTag: localChart.departmentTag,
           description: localChart.description,
           nodes: localChart.nodes,
           layout: localChart.layout,
           viewState: localChart.viewState
       }
   };

   // Upload to Cosmos DB via API
   await apiClient.saveChart(cloudChart);
   ```

3. Set migration flag:
   ```javascript
   localStorage.setItem('cloudMigrationComplete', 'true');
   localStorage.setItem('cloudMigrationDate', new Date().toISOString());
   ```

4. **DO NOT DELETE localStorage data** (keep as backup for 30 days)

### Phase 3: Coexistence (CURRENT)
**Duration:** 30 days after migration
**Behavior:**
- All saves go to Cosmos DB only
- localStorage remains read-only
- Migration banner hidden after completion

**Code locations:**
- `app/js/api-client.js` - Cloud operations
- `app/js/storage.js` - localStorage fallback
- `app/js/dashboard.js` - Migration UI

### Phase 4: Cleanup (FUTURE)
**After:** 30 days
**Action:** Remove localStorage cleanup prompt

```javascript
// Check migration age
const migrationDate = localStorage.getItem('cloudMigrationDate');
const daysSinceMigration = (Date.now() - new Date(migrationDate)) / (1000 * 60 * 60 * 24);

if (daysSinceMigration > 30) {
    // Offer to clear old localStorage data
    if (confirm('Your charts have been in the cloud for 30+ days. Clear old local data?')) {
        clearLocalStorageCharts();
    }
}
```

---

## Rollback Strategy

### If migration fails mid-process:
1. **localStorage data is never deleted** during migration
2. User can retry migration
3. Partial uploads are idempotent (UUID-based, can be re-uploaded)

### If Cosmos DB becomes unavailable:
1. **Fallback to localStorage read-only mode**
2. Display banner: "Cloud storage unavailable. Working in offline mode."
3. Queue saves in IndexedDB for later sync (future enhancement)

### Emergency rollback:
```javascript
// Admin can force localStorage mode
localStorage.setItem('forceLocalStorageMode', 'true');
// Next page load will use localStorage as primary storage
```

---

## Code Locations

### Migration Logic
- **`app/js/api-client.js`**
  - `getCharts()` - Tries cloud first, falls back to localStorage
  - `saveChart()` - Saves to cloud for authenticated users
  - Migration detection

- **`app/js/storage.js`**
  - `loadAllCharts()` - Reads from localStorage
  - `saveChartData()` - Writes to localStorage (legacy)
  - Node format migration (V1 → V2)

- **`app/js/dashboard.js`**
  - `renderCharts()` - Displays charts from cloud/local
  - Migration prompt UI
  - Dual-source chart loading

### Backend
- **`api/SaveChart/index.js`**
  - Accepts migrated charts
  - Validates ownership
  - Generates UUIDs for new charts

---

## Testing Checklist

### Pre-migration
- [ ] Verify localStorage contains charts
- [ ] Verify user is authenticated
- [ ] Verify migration prompt appears

### During migration
- [ ] All charts uploaded successfully
- [ ] No data loss (compare localStorage vs Cosmos DB)
- [ ] Chart names, departments, nodes preserved
- [ ] Migration flag set in localStorage

### Post-migration
- [ ] Dashboard loads charts from cloud
- [ ] Edits save to cloud only
- [ ] localStorage remains untouched (backup)
- [ ] No migration prompt shown again

### Edge cases
- [ ] Partial migration failure (retry works)
- [ ] Duplicate chart IDs handled
- [ ] Special characters in chart names preserved
- [ ] Large charts (100+ nodes) migrate successfully

---

## Monitoring

### Metrics to track
1. **Migration completion rate:** % of users who complete migration
2. **Migration failures:** Errors during upload
3. **Data consistency:** localStorage vs Cosmos DB diff
4. **Rollback frequency:** How often users fall back to localStorage

### Logging
```javascript
console.log('[Migration] Starting migration of', chartsCount, 'charts');
console.log('[Migration] Uploaded chart:', chartId, chartName);
console.log('[Migration] Completed successfully. Migrated', successCount, 'of', totalCount);
console.error('[Migration] Failed to upload chart:', chartId, error);
```

---

## Future Enhancements

1. **Automatic conflict resolution**
   - If chart exists in both localStorage and cloud, show diff
   - Let user choose which version to keep

2. **Progressive migration**
   - Migrate charts in background, one at a time
   - Show progress indicator

3. **Export before migration**
   - Offer to download JSON backup of localStorage data
   - Safety measure for paranoid users

4. **IndexedDB queue for offline edits**
   - When Cosmos DB unavailable, queue saves locally
   - Auto-sync when connection restored

---

## Security Considerations

### During migration
- ✅ Validate user authentication before allowing upload
- ✅ Assign charts to authenticated user's ID
- ✅ Never expose other users' chart IDs
- ✅ Validate chart data structure on server

### Post-migration
- ✅ localStorage readable only by same-origin scripts
- ✅ Cosmos DB access controlled by Azure AD tokens
- ✅ API validates ownership on every request

---

## Summary

**Current state:**
- ✅ Dual persistence active
- ✅ Authenticated users use Cosmos DB
- ⚠️ Migration prompt needs implementation
- ⚠️ localStorage cleanup after 30 days pending

**Next actions:**
1. Implement migration prompt UI in dashboard
2. Test migration with real user data
3. Monitor migration success rate
4. Plan localStorage deprecation timeline
