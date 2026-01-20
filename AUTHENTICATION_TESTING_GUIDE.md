# Authentication & Role Testing Guide

## Overview
This guide walks through testing the complete authentication and authorization system with real Azure AD users.

**Current Configuration**:
- ✅ `ALLOW_ANONYMOUS: "false"` - Real auth required
- ✅ `ADMIN_USER_IDS: ""` - No hardcoded admins
- ✅ Functions host restarted with auth enabled
- ✅ SWA CLI running on port 4280

---

## Step 1: ✅ Disable Anonymous/Dev Auth (COMPLETED)

**Changes Made**:
```json
{
  "ALLOW_ANONYMOUS": "false",
  "ADMIN_USER_IDS": ""
}
```

**Verification**:
Direct API calls to port 7071 now return:
```json
{
  "error": "Server configuration error: Authentication not properly configured"
}
```

This is correct - the API now requires authentication headers from SWA.

---

## Step 2: Access Through SWA (Port 4280)

### Why This Matters
- The API trusts SWA's `/.auth/me` principal
- Direct calls to port 7071 bypass authentication
- **Always test via http://localhost:4280**

### SWA CLI Status
Currently running:
```bash
swa start app --api-devserver-url http://localhost:7071 --port 4280
```

### Access URLs
- ✅ **Use this**: http://localhost:4280
- ❌ **Don't use**: http://localhost:7071 (bypasses SWA auth)

---

## Step 3: Get Real User IDs

### 3a. Sign In to the Application

1. Open browser to: http://localhost:4280
2. You'll be redirected to Azure AD login (or already signed in)
3. Complete authentication flow

### 3b. Get Your User ID

Open browser console (F12) and run:

```javascript
fetch('/.auth/me')
  .then(r => r.json())
  .then(d => {
    const principal = d.clientPrincipal;
    console.log('==========================================');
    console.log('User ID:', principal.userId);
    console.log('User Name:', principal.userDetails);
    console.log('Identity Provider:', principal.identityProvider);
    console.log('==========================================');
    console.log('Copy this User ID for role assignment:');
    console.log(principal.userId);
  });
```

**Expected Output**:
```
==========================================
User ID: 1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p
User Name: lionel@example.com
Identity Provider: aad
==========================================
Copy this User ID for role assignment:
1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p
```

### 3c. Copy the User ID
Copy the `userId` value (it's a GUID like `1a2b3c4d-...`)

---

## Step 4: Assign Roles to Real Users

### 4a. Grant Yourself Admin Role

**Via Admin Panel** (if you can access it):
1. Navigate to: http://localhost:4280/admin.html
2. Click "Global Roles" tab
3. Paste your userId in "User ID or Email" field
4. Select "Admin (full access)" from dropdown
5. Click "Grant Role"

**Via API (if Admin Panel is inaccessible)**:
```bash
# Replace YOUR_USER_ID with the actual GUID from step 3b
curl -X POST http://localhost:7071/api/v1/admin/users/YOUR_USER_ID/role \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

### 4b. Create Test Viewer Account

**Option A: Use a Second Real Account**
1. Sign out from http://localhost:4280
2. Sign in with a different Azure AD account
3. Get that account's userId (repeat step 3b)
4. Sign back in as admin
5. Grant viewer role to the second account's userId

**Option B: Use Test User IDs**
For testing without a second account, you can assign roles to test IDs that don't exist yet:
```bash
curl -X POST http://localhost:7071/api/v1/admin/users/test-viewer-001/role \
  -H "Content-Type: application/json" \
  -d '{"role":"viewer"}'
```

---

## Step 5: Verify Role Enforcement

### 5a. Test as Admin

**Signed in as admin account**:

1. **Create a Chart**:
   - Go to http://localhost:4280
   - Click "Create New Chart"
   - Add some nodes
   - Save the chart (note the chart ID from URL)

2. **Verify Admin Capabilities**:
   - ✅ Can create charts
   - ✅ Can edit own charts
   - ✅ Can delete own charts
   - ✅ Can share charts
   - ✅ Can access Admin Panel

3. **Check API Response**:
   Open console and check a GET request:
   ```javascript
   fetch('/api/v1/charts')
     .then(r => r.json())
     .then(d => console.log(d));
   ```

   Should show charts with `userRole: "admin"` or `canEdit: true`

### 5b. Test as Viewer

**If using a second account**:
1. Sign out from http://localhost:4280
2. Sign in with the viewer account

**Test Viewer Restrictions**:

1. **Try to Create Chart**:
   - Should see dashboard but may not have "Create" button (UI gating)
   - If you manually POST to `/api/v1/charts`, should get **403 Forbidden**

2. **Try to Edit Admin's Chart**:
   - Navigate to the chart created by admin (if shared)
   - Try to save changes
   - **Expected**: 403 error from API

3. **Try to Delete Chart**:
   - Try to delete a chart you don't own
   - **Expected**: 403 error or UI prevents it

4. **Try to Access Admin Panel**:
   - Go to http://localhost:4280/admin.html
   - **Expected**: 403 error or redirect

### 5c. Test Console Commands

**Check Current User**:
```javascript
fetch('/.auth/me')
  .then(r => r.json())
  .then(d => console.log('Current user:', d.clientPrincipal.userId));
```

**Check User's Role in Chart Response**:
```javascript
fetch('/api/v1/charts')
  .then(r => r.json())
  .then(d => {
    console.log('User Role:', d.charts[0]?.userRole);
    console.log('Can Edit:', d.charts[0]?.canEdit);
    console.log('Is Owner:', d.charts[0]?.isOwner);
  });
```

**Try Forbidden Operation as Viewer**:
```javascript
// Should fail with 403
fetch('/api/v1/admin/users', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
})
  .then(r => r.json())
  .then(d => console.log(d))
  .catch(e => console.error('Expected 403:', e));
```

---

## Step 6: Test Sharing & Permissions

### 6a. Share Chart with Viewer

**As admin**:
1. Open a chart you created
2. Click "Share" button
3. Enter the viewer's userId (from step 3b)
4. Select "Viewer" role
5. Click "Share"

### 6b. Verify Viewer Can Access

**As viewer account**:
1. Refresh http://localhost:4280
2. Should see the shared chart in "Shared with me" section
3. Open the chart - should be able to view
4. Try to edit - should get 403 error

### 6c. Test Editor Role

**As admin**:
1. Share a chart with userId as "Editor"
2. Sign in as that user
3. Should be able to:
   - ✅ View the chart
   - ✅ Edit the chart
   - ✅ Save changes
   - ❌ Delete the chart (only owner can delete)
   - ❌ Share the chart (only owner can share)

---

## Common Testing Scenarios

### Scenario 1: Viewer Tries to Edit Shared Chart

**Setup**:
- Admin creates Chart A
- Admin shares Chart A with Viewer (view-only)

**Test**:
1. Sign in as Viewer
2. Open Chart A
3. Try to modify nodes
4. Click Save
5. **Expected**: API returns 403 Forbidden

**UI Behavior**:
- Chart editor may allow typing (client-side)
- Save button triggers API call
- API rejects with 403
- Toast shows error message

### Scenario 2: Editor Modifies Shared Chart

**Setup**:
- Admin creates Chart B
- Admin shares Chart B with Editor (can edit)

**Test**:
1. Sign in as Editor
2. Open Chart B
3. Modify nodes
4. Click Save
5. **Expected**: ✅ Success - changes saved

### Scenario 3: Non-Owner Tries to Delete

**Setup**:
- Admin creates Chart C
- Admin shares Chart C with Editor

**Test**:
1. Sign in as Editor
2. Try to delete Chart C
3. **Expected**: 403 Forbidden (only owner can delete)

### Scenario 4: Non-Admin Accesses Admin Panel

**Test**:
1. Sign in as Viewer or Editor (not Admin)
2. Navigate to http://localhost:4280/admin.html
3. **Expected**: 403 Forbidden

---

## Debugging Authentication Issues

### Issue: Always Getting 403

**Check**:
1. Are you accessing via http://localhost:4280 (not 7071)?
2. Are you signed in? Check `/.auth/me` in console
3. Does your userId have a role assigned? Check Admin Panel or database

**Fix**:
```javascript
// Verify your current auth state
fetch('/.auth/me').then(r => r.json()).then(console.log);

// Check if you have a role
fetch('/api/v1/admin/users')
  .then(r => r.json())
  .then(d => console.log('Users with roles:', d.users));
```

### Issue: Getting Mock User (dev-user-001)

**Problem**: `ALLOW_ANONYMOUS` is still true

**Fix**:
1. Check `api/local.settings.json` - should be `"ALLOW_ANONYMOUS": "false"`
2. Restart Functions host: `cd api && func start --port 7071`
3. Verify: Direct call to 7071 should fail

### Issue: Can't Access /.auth/me

**Problem**: Not going through SWA

**Fix**:
- Use http://localhost:4280 (not 7071)
- Ensure SWA CLI is running: `swa start app --api-devserver-url http://localhost:7071 --port 4280`

### Issue: Getting Different userId Each Time

**Problem**: Azure AD test accounts may have unstable IDs

**Fix**:
- Use production Azure AD accounts
- Or grant roles by email instead of ID (requires backend change)
- For testing, manually query current userId before each test session

---

## Expected API Responses

### Authenticated Admin
```json
{
  "charts": [...],
  "userRole": "admin",
  "isAdmin": true
}
```

### Authenticated Viewer
```json
{
  "charts": [...],
  "userRole": "viewer",
  "isAdmin": false
}
```

### Chart with Owner Permission
```json
{
  "chart": {...},
  "userRole": "OWNER",
  "canEdit": true,
  "isOwner": true
}
```

### Chart with Editor Permission
```json
{
  "chart": {...},
  "userRole": "EDITOR",
  "canEdit": true,
  "isOwner": false
}
```

### Chart with Viewer Permission
```json
{
  "chart": {...},
  "userRole": "VIEWER",
  "canEdit": false,
  "isOwner": false,
  "isReadOnly": true
}
```

### Unauthorized Access (403)
```json
{
  "error": "Access denied: Admin role required"
}
```

---

## Quick Command Reference

```javascript
// Get current user
fetch('/.auth/me').then(r => r.json()).then(console.log);

// Get user's role from API
fetch('/api/v1/charts').then(r => r.json()).then(d => console.log(d));

// List all users with global roles (admin only)
fetch('/api/v1/admin/users').then(r => r.json()).then(console.log);

// Test forbidden operation
fetch('/api/v1/admin/users', {method: 'GET'})
  .then(r => r.json())
  .then(console.log);
```

```bash
# Grant admin role (direct to Functions, bypasses auth)
curl -X POST http://localhost:7071/api/v1/admin/users/YOUR_USER_ID/role \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'

# Grant viewer role
curl -X POST http://localhost:7071/api/v1/admin/users/VIEWER_USER_ID/role \
  -H "Content-Type: application/json" \
  -d '{"role":"viewer"}'

# List all roles (must have auth headers or go through SWA)
curl http://localhost:7071/api/v1/admin/users
```

---

## Testing Checklist

### Initial Setup
- [x] `ALLOW_ANONYMOUS: "false"` in api/local.settings.json
- [x] `ADMIN_USER_IDS: ""` (empty)
- [x] Functions host restarted
- [x] SWA CLI running on port 4280

### Authentication
- [ ] Sign in via http://localhost:4280
- [ ] Get userId from `/.auth/me`
- [ ] Verify userId is a GUID (not "dev-user-001")

### Role Assignment
- [ ] Grant admin role to your userId
- [ ] Verify role appears in Admin Panel
- [ ] Create test viewer account/userId
- [ ] Grant viewer role to test account

### Admin Testing
- [ ] Create a chart as admin
- [ ] Edit own chart
- [ ] Delete own chart
- [ ] Share chart with viewer
- [ ] Access Admin Panel

### Viewer Testing
- [ ] Sign in as viewer
- [ ] View shared chart
- [ ] Try to edit shared chart (should fail with 403)
- [ ] Try to delete chart (should fail)
- [ ] Try to access Admin Panel (should fail)

### Editor Testing (optional)
- [ ] Share chart with editor role
- [ ] Sign in as editor
- [ ] Edit shared chart (should succeed)
- [ ] Try to delete shared chart (should fail)

---

## Next Steps

After completing local testing:

1. **Deploy to Azure**:
   - Set `ALLOW_ANONYMOUS: "false"` in Azure App Settings
   - Configure Azure AD authentication in SWA
   - Migrate database connection string to App Settings
   - Test authentication flow in staging

2. **Production Considerations**:
   - Remove test/dev user IDs from database
   - Assign real admin roles to production users
   - Monitor authentication failures
   - Set up audit logging

3. **Optional UI Improvements**:
   - Add client-side role checks to hide/disable forbidden actions
   - Show "Read-only" banner on charts user can't edit
   - Disable save button for viewers
   - Add loading states during auth checks

---

**Status**: ✅ Local development configured with real authentication. Ready to test with actual Azure AD users.
