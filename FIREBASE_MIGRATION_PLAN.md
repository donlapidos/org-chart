# Firebase Migration Plan - RRC Org Chart Application

**Document Version:** 1.0
**Last Updated:** November 10, 2025
**Status:** Planning Phase - Implementation Pending

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Authentication Flow](#authentication-flow)
4. [Data Model](#data-model)
5. [Security Rules](#security-rules)
6. [Role-Based Access Control](#role-based-access-control)
7. [Implementation Phases](#implementation-phases)
8. [Code Changes Required](#code-changes-required)
9. [Admin Panel](#admin-panel)
10. [Critical Considerations](#critical-considerations)
11. [Cost Estimates](#cost-estimates)
12. [Migration Checklist](#migration-checklist)

---

## Executive Summary

### Current State
- **Storage:** localStorage (client-side only)
- **Authentication:** None
- **Deployment:** Local development server
- **Users:** Single user per browser

### Target State
- **Storage:** Firebase Firestore (cloud-based, shared)
- **Authentication:** Microsoft SSO with email whitelist
- **Deployment:** Firebase Hosting at subdomain
- **Users:** Multiple users with role-based access

### Access Model
- **Single Shared Dashboard:** All authenticated users see all charts
- **Whitelist-Based:** Only approved email addresses can access
- **Role-Based Actions:** Admin/Editor/Viewer roles control what users can DO

### Timeline Estimate
**2-4 weeks** (1 developer, part-time)

### Cost Estimate
**$0-10/month** for typical usage (<100 users, <1000 charts)

---

## Architecture Overview

### High-Level Flow
```
User navigates to orgchart.yourdomain.com
              ↓
         Shows login.html
              ↓
  User clicks "Sign in with Microsoft"
              ↓
       Microsoft SSO popup
              ↓
     User authenticates with Azure AD
              ↓
   Firebase receives OAuth token
              ↓
Check user.email against /config/access whitelist
              ↓
         ✅ Email in whitelist?
              ↓ YES
Check if /users/{uid} exists
              ↓
   NO → Create user doc with role: 'viewer'
   YES → Update lastLogin timestamp
              ↓
    Redirect to dashboard (index.html)
              ↓
   Load all charts from Firestore
              ↓
Render UI based on user.role:
  - Admin: Full controls
  - Editor: Create/edit/delete own charts
  - Viewer: Read-only + export
```

### Technology Stack
```
Frontend:
  - HTML/CSS/JavaScript (no framework)
  - D3.js v7 + d3-org-chart library
  - Firebase SDK v10.x

Backend/Services:
  - Firebase Authentication (Microsoft OAuth)
  - Cloud Firestore (NoSQL database)
  - Firebase Hosting (static site CDN)
  - Firestore Security Rules (authorization)

Integration:
  - Microsoft Azure AD (identity provider)
  - Custom subdomain (orgchart.yourdomain.com)
```

---

## Authentication Flow

### Step-by-Step Process

#### 1. Login Page (login.html)
```javascript
// Minimal login page
<div class="login-container">
  <h1>RRC Org Chart</h1>
  <button onclick="auth.signIn()" class="btn btn-primary">
    Sign in with Microsoft
  </button>
</div>
```

#### 2. Microsoft SSO Popup
```javascript
// app/js/auth.js
import { getAuth, signInWithPopup, OAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

class AuthManager {
  async signIn() {
    const provider = new OAuthProvider('microsoft.com');
    provider.setCustomParameters({
      tenant: 'YOUR_TENANT_ID', // From Azure AD
      prompt: 'select_account'
    });

    const result = await signInWithPopup(this.auth, provider);
    const user = result.user;

    // Critical: Check whitelist BEFORE allowing access
    const isAllowed = await this.checkWhitelist(user.email);

    if (!isAllowed) {
      await this.auth.signOut();
      this.showAccessDenied(user.email);
      return null;
    }

    await this.initializeUser(user);
    window.location.href = '/index.html';
  }

  async checkWhitelist(email) {
    const configRef = doc(this.db, 'config', 'access');
    const configSnap = await getDoc(configRef);

    if (!configSnap.exists()) {
      console.error('Whitelist not configured!');
      return false;
    }

    const { allowedEmails, allowedDomains } = configSnap.data();

    // Check exact email match
    if (allowedEmails.includes(email)) {
      return true;
    }

    // Optional: Check domain match
    if (allowedDomains && allowedDomains.length > 0) {
      const domain = '@' + email.split('@')[1];
      return allowedDomains.includes(domain);
    }

    return false;
  }

  async initializeUser(user) {
    const userRef = doc(this.db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // First login - create user document
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || '',
        role: 'viewer', // Default role
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date()
      });
    } else {
      // Returning user - update lastLogin
      await setDoc(userRef, {
        lastLogin: new Date()
      }, { merge: true });
    }
  }
}
```

#### 3. Protected Route Guard
```javascript
// app/js/router.js - Runs on every page load
import { getAuth, onAuthStateChanged } from 'firebase/auth';

class Router {
  constructor() {
    this.auth = getAuth();
    this.setupAuthGuard();
  }

  setupAuthGuard() {
    onAuthStateChanged(this.auth, async (user) => {
      if (!user) {
        // Not logged in
        if (window.location.pathname !== '/login.html') {
          window.location.href = '/login.html';
        }
        return;
      }

      // Logged in - verify still allowed and active
      const isAllowed = await this.verifyAccess(user);

      if (!isAllowed) {
        await this.auth.signOut();
        window.location.href = '/login.html?error=access_revoked';
        return;
      }

      // Valid user - load their role
      const role = await this.getUserRole(user.uid);
      sessionStorage.setItem('userRole', role);
      sessionStorage.setItem('userId', user.uid);

      // Continue to requested page
    });
  }

  async verifyAccess(user) {
    // Check whitelist (in case removed since login)
    const configRef = doc(db, 'config', 'access');
    const configSnap = await getDoc(configRef);
    const { allowedEmails } = configSnap.data();

    if (!allowedEmails.includes(user.email)) {
      return false;
    }

    // Check if user is still active
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || !userSnap.data().isActive) {
      return false;
    }

    return true;
  }

  async getUserRole(uid) {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    return userSnap.exists() ? userSnap.data().role : 'viewer';
  }
}
```

### Critical Auth Considerations

⚠️ **Token Caching Issue:**
- Firebase Auth tokens can remain valid for up to 1 hour after a user is removed from whitelist
- **Solution:** Always check `isActive` flag on every Firestore operation
- **Solution:** Re-verify whitelist on page load (implemented in `verifyAccess()`)
- **Solution:** Admin can set `isActive: false` to immediately block user (checked by Security Rules)

⚠️ **Session Management:**
- Don't trust `sessionStorage.userRole` alone - it's client-side
- Always fetch fresh role from Firestore when performing privileged actions
- Security Rules provide final enforcement regardless of client state

---

## Data Model

### Firestore Collections Structure

```javascript
/config
  /access (document)
    - allowedEmails: string[]        // List of allowed email addresses
    - allowedDomains: string[]       // Optional: ['@company.com']
    - lastModified: timestamp
    - modifiedBy: string             // userId of admin who changed it

/users
  /{userId} (document)
    - email: string                  // user@company.com
    - displayName: string            // John Doe
    - photoURL: string               // Profile picture URL from Microsoft
    - role: string                   // 'admin' | 'editor' | 'viewer'
    - isActive: boolean              // Can be set false to block access
    - createdAt: timestamp
    - lastLogin: timestamp

/charts
  /{chartId} (document)
    - chartId: string                // Same as document ID
    - chartName: string              // "Engineering Org - Q4 2025"
    - departmentTag: string          // "Engineering"
    - description: string            // Optional description
    - createdAt: timestamp
    - lastModified: timestamp
    - createdBy: string              // userId of creator
    - createdByName: string          // Display name of creator
    - nodes: array                   // Existing node structure (unchanged)
    - viewState: object              // zoom, pan, collapsedNodes
    - layout: string                 // 'top' | 'bottom' | 'left' | 'right'

/activityLog
  /{logId} (document)
    - userId: string
    - userEmail: string
    - userName: string
    - action: string                 // 'create' | 'update' | 'delete' | 'whitelist_add' | 'whitelist_remove' | 'role_change'
    - chartId: string                // If applicable
    - chartName: string              // If applicable
    - targetUserId: string           // For user management actions
    - oldValue: string               // For role changes
    - newValue: string               // For role changes
    - timestamp: timestamp
    - ipAddress: string              // Optional
```

### Node Structure (Unchanged)
```javascript
// This stays exactly as-is
{
  id: "node_xyz",
  parentId: "parent_id" or null,
  members: [
    {
      roleLabel: "Chief Executive Officer",
      entries: [
        { name: "John Doe", email: "", phone: "", photoUrl: "" }
      ]
    }
  ],
  meta: {
    department: "Executive",
    notes: ""
  }
}
```

### Data Model Considerations

⚠️ **Whitelist Array Size:**
- Firestore arrays have practical limits (~10k items)
- Each read of `/config/access` fetches entire `allowedEmails` array
- **Threshold:** If whitelist exceeds ~500 emails, consider alternatives:

**Alternative 1: Domain-Only Whitelist**
```javascript
/config/access
  - allowedDomains: ['@company.com', '@subsidiary.com']
  - blockedEmails: ['contractor@company.com'] // Exceptions
```

**Alternative 2: Approved Users Collection**
```javascript
/approvedUsers/{email} (document)
  - approved: true
  - approvedBy: userId
  - approvedAt: timestamp

// Faster lookups, better for large lists
const approved = await getDoc(doc(db, 'approvedUsers', email));
return approved.exists() && approved.data().approved;
```

⚠️ **Chart Node Arrays:**
- Current implementation stores `nodes` as array in chart document
- Works fine up to ~1000 nodes per chart
- If you need >1000 nodes, consider subcollection:
```javascript
/charts/{chartId}/nodes/{nodeId}
```

---

## Security Rules

### Complete Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ========================================
    // HELPER FUNCTIONS
    // ========================================

    function isSignedIn() {
      return request.auth != null;
    }

    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function getUserRole() {
      return getUserData().role;
    }

    function isActive() {
      return getUserData().isActive == true;
    }

    function isAdmin() {
      return isSignedIn() && getUserRole() == 'admin' && isActive();
    }

    function isEditor() {
      return isSignedIn() && (getUserRole() == 'editor' || getUserRole() == 'admin') && isActive();
    }

    function isViewer() {
      return isSignedIn() && isActive();
    }

    function isOwner(chartData) {
      return request.auth.uid == chartData.createdBy;
    }

    // ========================================
    // ACCESS CONTROL CONFIG
    // ========================================

    match /config/access {
      // Anyone authenticated can read whitelist (needed for login check)
      allow read: if isSignedIn();

      // Only admins can modify whitelist
      allow write: if isAdmin();
    }

    // ========================================
    // USERS COLLECTION
    // ========================================

    match /users/{userId} {
      // All authenticated users can read all user profiles
      // (needed for "created by" display, admin panel, etc.)
      allow read: if isViewer();

      // Users can create their own document on first login
      allow create: if isSignedIn() && request.auth.uid == userId;

      // Users can update their own profile (displayName, photoURL, lastLogin)
      allow update: if isSignedIn() && (
        // User updating themselves (limited fields)
        (request.auth.uid == userId &&
         !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'isActive'])) ||
        // Admin updating anyone (including role, isActive)
        isAdmin()
      );

      // Only admins can delete users
      allow delete: if isAdmin();
    }

    // ========================================
    // CHARTS COLLECTION
    // ========================================

    match /charts/{chartId} {
      // All active users can read all charts
      allow read: if isViewer();

      // Editors and admins can create charts
      allow create: if isEditor() &&
                      request.resource.data.createdBy == request.auth.uid;

      // Editors can update any chart (collaborative model)
      // Admins can update any chart
      allow update: if isEditor();

      // Admins can delete any chart
      // Editors can delete only their own charts
      allow delete: if isActive() && (
        isAdmin() ||
        (isEditor() && isOwner(resource.data))
      );
    }

    // ========================================
    // ACTIVITY LOG
    // ========================================

    match /activityLog/{logId} {
      // Only admins can read activity logs
      allow read: if isAdmin();

      // Any active user can create log entries
      // (triggered by app on their own actions)
      allow create: if isActive();

      // Logs are immutable once created
      allow update, delete: if false;
    }
  }
}
```

### Security Rules Testing

Firebase Console allows testing rules:
```javascript
// Test: Can viewer create chart?
simulate: create
path: /databases/(default)/documents/charts/test123
auth: { uid: 'viewer_user_id' }
resource: { data: { chartName: 'Test' } }
// Expected: DENY

// Test: Can editor create chart?
simulate: create
path: /databases/(default)/documents/charts/test123
auth: { uid: 'editor_user_id' }
resource: { data: { chartName: 'Test', createdBy: 'editor_user_id' } }
// Expected: ALLOW

// Test: Can inactive user read?
simulate: read
path: /databases/(default)/documents/charts/test123
auth: { uid: 'inactive_user_id' }
// Expected: DENY (isActive check fails)
```

---

## Role-Based Access Control

### Role Definitions

| Role | Create Charts | Edit Any Chart | Delete Own Charts | Delete Any Chart | Manage Users | View Activity Log |
|------|--------------|----------------|-------------------|------------------|--------------|-------------------|
| **Viewer** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Editor** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### UI Implementation by Role

#### Dashboard (index.html)

```javascript
// app/js/dashboard.js - Modified renderChartCard()

renderChartCard(chart) {
  const userRole = sessionStorage.getItem('userRole');
  const currentUserId = sessionStorage.getItem('userId');
  const isOwner = chart.createdBy === currentUserId;

  // Role-based button visibility
  const showEdit = userRole === 'admin' || userRole === 'editor';
  const showDelete = userRole === 'admin' || (userRole === 'editor' && isOwner);
  const showDuplicate = userRole === 'admin' || userRole === 'editor';
  const showCreate = userRole === 'admin' || userRole === 'editor';

  return `
    <div class="chart-card" onclick="app.openChart('${chart.chartId}')">
      <div class="chart-card-header">
        <h3>${this.escapeHtml(chart.chartName)}</h3>
        ${chart.departmentTag ? `<span class="tag">${this.escapeHtml(chart.departmentTag)}</span>` : ''}
        <span class="created-by">by ${this.escapeHtml(chart.createdByName)}</span>
      </div>

      <div class="chart-card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-secondary" onclick="app.openChart('${chart.chartId}')">
          👁️ View
        </button>

        ${showEdit ? `
          <button class="btn btn-sm btn-secondary" onclick="app.openChart('${chart.chartId}')">
            ✏️ Edit
          </button>
        ` : ''}

        ${showDuplicate ? `
          <button class="btn btn-sm btn-secondary" onclick="app.duplicateChart('${chart.chartId}')">
            📋 Duplicate
          </button>
        ` : ''}

        ${showDelete ? `
          <button class="btn btn-sm btn-danger" onclick="app.deleteChart('${chart.chartId}')">
            🗑️ Delete
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// Hide "New Chart" button for viewers
showCreateButton() {
  const userRole = sessionStorage.getItem('userRole');
  const createBtn = document.getElementById('createChartBtn');

  if (userRole === 'viewer') {
    createBtn.style.display = 'none';
  }
}
```

#### Chart Editor (chart-editor.html)

```javascript
// app/js/chart-editor.js

async init() {
  // Load chart...

  // Check user role
  const userRole = sessionStorage.getItem('userRole');
  const isReadOnly = userRole === 'viewer';

  if (isReadOnly) {
    this.enableReadOnlyMode();
  }
}

enableReadOnlyMode() {
  // Hide all edit controls
  document.querySelectorAll('.edit-control').forEach(el => {
    el.style.display = 'none';
  });

  // Disable node clicking for edit
  this.orgChart.onNodeClick(() => {
    // Do nothing
  });

  // Show read-only banner
  const banner = document.createElement('div');
  banner.className = 'read-only-banner';
  banner.innerHTML = `
    <span>📖 You are viewing this chart in read-only mode</span>
  `;
  document.querySelector('.editor-header').prepend(banner);

  // Keep export buttons visible (viewers can export)
  document.querySelectorAll('.export-btn').forEach(el => {
    el.style.display = 'inline-flex';
  });
}
```

### Critical RBAC Considerations

⚠️ **Role Caching:**
```javascript
// WRONG: Trusting client-side cache alone
const role = sessionStorage.getItem('userRole');
if (role === 'admin') {
  deleteChart(); // Dangerous!
}

// CORRECT: Re-fetch role before privileged action
async deleteChart(chartId) {
  // Double-check role server-side
  const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
  const currentRole = userDoc.data().role;

  if (currentRole !== 'admin' && currentRole !== 'editor') {
    alert('You do not have permission to delete charts');
    return;
  }

  // Firestore rules provide final enforcement
  await deleteDoc(doc(db, 'charts', chartId));
}
```

⚠️ **Mid-Session Role Changes:**
- Admin demotes user from "editor" to "viewer"
- User still has page open with "editor" UI
- **Solution:** Re-check role on every page load (router.js)
- **Solution:** Firestore rules are final authority
- **Optional:** Add real-time listener for role changes:

```javascript
// Listen for role changes while user is active
onSnapshot(doc(db, 'users', auth.currentUser.uid), (snapshot) => {
  const newRole = snapshot.data().role;
  const oldRole = sessionStorage.getItem('userRole');

  if (newRole !== oldRole) {
    sessionStorage.setItem('userRole', newRole);

    // Show notification
    alert(`Your role has been changed to ${newRole}. Page will reload.`);
    location.reload();
  }
});
```

---

## Implementation Phases

### Phase 1: Setup & Configuration (3-5 days)

#### Day 1: Firebase Project Setup
- [ ] Create Firebase project in Google Cloud Console
- [ ] Enable Firebase Authentication
- [ ] Enable Cloud Firestore
- [ ] Enable Firebase Hosting
- [ ] Install Firebase CLI: `npm install -g firebase-tools`
- [ ] Run `firebase login` and `firebase init`

#### Day 2: Microsoft Azure AD Configuration
- [ ] Register application in Azure AD portal
- [ ] Configure redirect URIs:
  - `https://orgchart.yourdomain.com/__/auth/handler`
  - `http://localhost:8080/__/auth/handler` (for testing)
- [ ] Copy Client ID and Tenant ID
- [ ] Add to Firebase Authentication → Sign-in providers → Microsoft

#### Day 3: Domain Configuration
- [ ] Request subdomain from IT: `orgchart.yourdomain.com`
- [ ] Add custom domain in Firebase Hosting
- [ ] Update DNS records (provided by Firebase)
- [ ] Wait for SSL provisioning (automatic, ~24 hours)

#### Day 4: Initial Data Setup
```javascript
// Run in Firebase Console → Firestore

// 1. Create access whitelist
db.collection('config').doc('access').set({
  allowedEmails: [
    'your.email@company.com',  // Add yourself first
    'admin2@company.com'
  ],
  allowedDomains: [],  // Optional
  lastModified: new Date(),
  modifiedBy: 'system'
});

// 2. Test login, then manually promote yourself to admin
db.collection('users').doc('YOUR_USER_ID').update({
  role: 'admin'
});
```

#### Day 5: Test Authentication
- [ ] Deploy test version to Firebase Hosting
- [ ] Test Microsoft SSO login
- [ ] Verify whitelist check works
- [ ] Verify access denial for non-whitelisted emails
- [ ] Confirm user document creation

---

### Phase 2: Code Migration (5-7 days)

#### Day 1-2: Storage Layer Replacement

**Create new Firestore storage module:**

```javascript
// app/js/firestore-storage.js (NEW FILE)
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot
} from 'firebase/firestore';

class FirestoreStorage {
  constructor(auth) {
    this.db = getFirestore();
    this.auth = auth;
  }

  // Generate IDs (same as before)
  generateId() {
    return doc(collection(this.db, 'charts')).id;
  }

  generateNodeId() {
    return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create chart (async version)
  async createChart(chartData) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const chartId = this.generateId();
    const chartRef = doc(this.db, 'charts', chartId);

    const newChart = {
      chartId: chartId,
      chartName: chartData.chartName || 'Untitled Chart',
      departmentTag: chartData.departmentTag || '',
      description: chartData.description || '',
      createdAt: new Date(),
      lastModified: new Date(),
      createdBy: user.uid,
      createdByName: user.displayName || user.email,
      nodes: chartData.nodes || [],
      viewState: chartData.viewState || {
        zoom: 1,
        pan: { x: 0, y: 0 },
        collapsedNodes: []
      },
      layout: chartData.layout || 'top',
      connections: chartData.connections || []
    };

    await setDoc(chartRef, newChart);

    // Log activity
    await this.logActivity('create', chartId, chartData.chartName);

    return newChart;
  }

  // Get chart (async version)
  async getChart(chartId) {
    const chartRef = doc(this.db, 'charts', chartId);
    const chartSnap = await getDoc(chartRef);

    if (!chartSnap.exists()) {
      return null;
    }

    return chartSnap.data();
  }

  // Get all charts (async version)
  async getAllCharts() {
    const chartsRef = collection(this.db, 'charts');
    const q = query(chartsRef, orderBy('lastModified', 'desc'));
    const snapshot = await getDocs(q);

    const charts = [];
    snapshot.forEach(doc => {
      charts.push(doc.data());
    });

    return charts;
  }

  // Update chart (async version)
  async updateChart(chartId, updates) {
    const chartRef = doc(this.db, 'charts', chartId);

    await updateDoc(chartRef, {
      ...updates,
      lastModified: new Date()
    });

    // Log activity
    await this.logActivity('update', chartId);

    return await this.getChart(chartId);
  }

  // Delete chart (async version)
  async deleteChart(chartId) {
    const chart = await this.getChart(chartId);

    await deleteDoc(doc(this.db, 'charts', chartId));

    // Log activity
    await this.logActivity('delete', chartId, chart?.chartName);

    return true;
  }

  // Log activity
  async logActivity(action, chartId = null, chartName = null) {
    const user = this.auth.currentUser;
    if (!user) return;

    const logRef = doc(collection(this.db, 'activityLog'));
    await setDoc(logRef, {
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName || user.email,
      action: action,
      chartId: chartId,
      chartName: chartName,
      timestamp: new Date()
    });
  }

  // Real-time listener for charts
  onChartsChange(callback) {
    const chartsRef = collection(this.db, 'charts');
    const q = query(chartsRef, orderBy('lastModified', 'desc'));

    return onSnapshot(q, (snapshot) => {
      const charts = [];
      snapshot.forEach(doc => {
        charts.push(doc.data());
      });
      callback(charts);
    });
  }
}

export default FirestoreStorage;
```

**Update existing files to use async/await:**

```javascript
// app/js/dashboard.js - Update all storage calls

// OLD (sync):
const charts = storage.getAllCharts();

// NEW (async):
const charts = await storage.getAllCharts();

// OLD (sync):
storage.createChart(chartData);

// NEW (async):
await storage.createChart(chartData);
```

#### Day 3-4: Update Dashboard

```javascript
// app/js/dashboard.js - Key changes

class DashboardApp {
  constructor() {
    this.storage = null; // Will be FirestoreStorage
    this.unsubscribe = null; // For real-time listener
  }

  async init() {
    // Wait for auth
    this.storage = new FirestoreStorage(auth);

    // Setup real-time updates
    this.unsubscribe = this.storage.onChartsChange((charts) => {
      this.renderCharts(charts);
    });
  }

  async saveChart(event) {
    event.preventDefault();

    // Show loading
    this.showLoading();

    try {
      const chartData = {
        chartName: document.getElementById('chartName').value.trim(),
        departmentTag: document.getElementById('departmentTag').value.trim(),
        description: document.getElementById('description').value.trim(),
        nodes: [/* default node */]
      };

      const newChart = await this.storage.createChart(chartData);

      // Redirect to editor
      window.location.href = `chart-editor.html?id=${newChart.chartId}`;

    } catch (error) {
      console.error('Error creating chart:', error);
      alert('Failed to create chart. Please try again.');
    } finally {
      this.hideLoading();
    }
  }

  async deleteChart(chartId) {
    try {
      await this.storage.deleteChart(chartId);
      // UI will auto-update via real-time listener
    } catch (error) {
      console.error('Error deleting chart:', error);
      alert('Failed to delete chart. Please try again.');
    }
  }
}
```

#### Day 5-6: Update Chart Editor

```javascript
// app/js/chart-editor.js - Key changes

class ChartEditor {
  async loadChart() {
    try {
      this.chartData = await this.storage.getChart(this.chartId);

      if (!this.chartData) {
        alert('Chart not found');
        window.location.href = 'index.html';
        return;
      }

      // Update UI...
      this.initOrgChart();

    } catch (error) {
      console.error('Error loading chart:', error);
      alert('Failed to load chart');
      window.location.href = 'index.html';
    }
  }

  async saveChart(showNotification = true) {
    if (!this.chartData) return;

    try {
      await this.storage.updateChart(this.chartId, this.chartData);

      if (showNotification) {
        this.showSaveSuccess();
      }

    } catch (error) {
      console.error('Error saving chart:', error);
      this.showSaveError();
    }
  }
}
```

#### Day 7: Add Login/Logout UI

**Create login page:**

```html
<!-- app/login.html (NEW FILE) -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign In - RRC Org Chart</title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        .login-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: var(--background-secondary);
        }
        .login-card {
            background: white;
            padding: 3rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            text-align: center;
            max-width: 400px;
        }
        .login-card h1 {
            margin-bottom: 1rem;
        }
        .login-card p {
            color: var(--text-secondary);
            margin-bottom: 2rem;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-card">
            <h1>RRC Org Chart</h1>
            <p>Sign in with your Microsoft account to access organizational charts</p>
            <button id="signInBtn" class="btn btn-primary btn-lg">
                Sign in with Microsoft
            </button>
            <div id="errorMessage" style="display: none; color: red; margin-top: 1rem;"></div>
        </div>
    </div>

    <script type="module">
        import { authManager } from './js/auth.js';

        document.getElementById('signInBtn').addEventListener('click', async () => {
            try {
                await authManager.signIn();
            } catch (error) {
                document.getElementById('errorMessage').textContent =
                    'Sign in failed. Please try again.';
                document.getElementById('errorMessage').style.display = 'block';
            }
        });

        // Check for error in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('error') === 'access_revoked') {
            document.getElementById('errorMessage').textContent =
                'Your access has been revoked. Please contact your administrator.';
            document.getElementById('errorMessage').style.display = 'block';
        }
    </script>
</body>
</html>
```

**Add sign-out button to header:**

```html
<!-- Update app/index.html and app/chart-editor.html -->
<div class="header-content">
    <div>
        <h1>Dynamic Org Chart Creator</h1>
    </div>
    <div class="toolbar-group">
        <span id="userDisplay" class="user-display"></span>
        <button class="btn btn-secondary btn-sm" onclick="authManager.signOut()">
            Sign Out
        </button>
    </div>
</div>

<script type="module">
    import { authManager } from './js/auth.js';

    // Display current user
    const user = authManager.getCurrentUser();
    document.getElementById('userDisplay').textContent =
        user.displayName || user.email;
</script>
```

---

### Phase 3: Security & Testing (3-4 days)

#### Day 1: Deploy Security Rules
- [ ] Copy security rules to Firebase Console
- [ ] Test each rule manually
- [ ] Verify role-based access works
- [ ] Test whitelist enforcement
- [ ] Test `isActive` flag blocking

#### Day 2: End-to-End Testing
- [ ] Test login flow with whitelisted email
- [ ] Test login rejection with non-whitelisted email
- [ ] Test chart CRUD as admin
- [ ] Test chart CRUD as editor
- [ ] Test read-only mode as viewer
- [ ] Test role change mid-session
- [ ] Test access revocation (`isActive: false`)

#### Day 3: Performance Testing
- [ ] Load dashboard with 100+ charts
- [ ] Test chart with 500+ nodes
- [ ] Verify auto-save doesn't lag
- [ ] Check real-time updates work
- [ ] Monitor Firestore read/write counts

#### Day 4: Error Handling
- [ ] Add try-catch to all async operations
- [ ] Add loading states
- [ ] Add user-friendly error messages
- [ ] Test offline behavior
- [ ] Test quota exceeded scenarios

---

### Phase 4: Admin Panel (3-4 days)

See [Admin Panel](#admin-panel) section for full implementation.

---

### Phase 5: Deployment & Go-Live (2-3 days)

#### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Security rules deployed
- [ ] Custom domain configured
- [ ] SSL certificate active
- [ ] Whitelist populated with initial users
- [ ] At least one admin user configured
- [ ] Backup of localStorage data exported
- [ ] Migration script tested

#### Deployment Steps
```bash
# 1. Build (if using bundler - optional)
npm run build

# 2. Deploy to Firebase
firebase deploy

# 3. Verify deployment
curl https://orgchart.yourdomain.com

# 4. Test login
# Manual testing in browser

# 5. Monitor for errors
# Check Firebase Console → Firestore → Usage
# Check Firebase Console → Authentication → Users
```

#### Migration Day
- [ ] Announce maintenance window
- [ ] Export all localStorage data from production users
- [ ] Upload data to Firestore via migration script
- [ ] Verify all charts loaded correctly
- [ ] Notify users of new URL
- [ ] Provide quick-start guide

---

## Admin Panel

### Admin Panel Implementation

#### File: app/admin.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - RRC Org Chart</title>
    <link rel="stylesheet" href="css/styles.css">
    <link rel="stylesheet" href="css/admin.css">
</head>
<body>
    <header class="header">
        <div class="header-content">
            <div>
                <h1>Admin Panel</h1>
                <p>User and access management</p>
            </div>
            <div class="toolbar-group">
                <a href="index.html" class="btn btn-secondary">← Back to Dashboard</a>
                <span id="userDisplay"></span>
                <button class="btn btn-secondary btn-sm" onclick="authManager.signOut()">Sign Out</button>
            </div>
        </div>
    </header>

    <div class="container">
        <!-- User Management Section -->
        <section class="admin-section">
            <h2>👥 User Management</h2>
            <div class="table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Display Name</th>
                            <th>Role</th>
                            <th>Last Login</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="usersTableBody">
                        <!-- Populated by JS -->
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Access Whitelist Section -->
        <section class="admin-section">
            <h2>🔐 Access Control</h2>
            <div class="whitelist-container">
                <h3>Allowed Email Addresses</h3>
                <div id="emailList" class="email-list">
                    <!-- Populated by JS -->
                </div>
                <form id="addEmailForm" class="add-email-form">
                    <input
                        type="email"
                        id="newEmail"
                        class="form-input"
                        placeholder="user@company.com"
                        required
                    >
                    <button type="submit" class="btn btn-primary">Add Email</button>
                </form>
                <p class="form-help">
                    Current whitelist size: <strong id="whitelistSize">0</strong> emails
                </p>
            </div>
        </section>

        <!-- Activity Log Section -->
        <section class="admin-section">
            <h2>📋 Recent Activity</h2>
            <div class="activity-container">
                <div class="filters">
                    <select id="activityFilter" class="form-select">
                        <option value="all">All Actions</option>
                        <option value="create">Chart Created</option>
                        <option value="update">Chart Updated</option>
                        <option value="delete">Chart Deleted</option>
                        <option value="role_change">Role Changed</option>
                        <option value="whitelist_add">Email Added</option>
                        <option value="whitelist_remove">Email Removed</option>
                    </select>
                    <select id="timeFilter" class="form-select">
                        <option value="24h">Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                        <option value="all">All Time</option>
                    </select>
                </div>
                <div id="activityLog" class="activity-log">
                    <!-- Populated by JS -->
                </div>
            </div>
        </section>
    </div>

    <script type="module" src="js/admin.js"></script>
</body>
</html>
```

#### File: app/js/admin.js

```javascript
import { authManager } from './auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
  Timestamp
} from 'firebase/firestore';

class AdminPanel {
  constructor() {
    this.db = getFirestore();
    this.auth = authManager.auth;
  }

  async init() {
    // Verify admin role
    const role = await authManager.getUserRole();
    if (role !== 'admin') {
      alert('Access denied. Admin privileges required.');
      window.location.href = '/index.html';
      return;
    }

    // Display current user
    const user = this.auth.currentUser;
    document.getElementById('userDisplay').textContent =
      user.displayName || user.email;

    // Load data
    await this.loadUsers();
    await this.loadWhitelist();
    await this.loadActivityLog();

    // Setup event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.getElementById('addEmailForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addEmail();
    });

    document.getElementById('activityFilter').addEventListener('change', () => {
      this.loadActivityLog();
    });

    document.getElementById('timeFilter').addEventListener('change', () => {
      this.loadActivityLog();
    });
  }

  // ==========================================
  // USER MANAGEMENT
  // ==========================================

  async loadUsers() {
    const usersSnap = await getDocs(collection(this.db, 'users'));
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    usersSnap.forEach(doc => {
      const user = doc.data();
      const row = this.createUserRow(doc.id, user);
      tbody.appendChild(row);
    });
  }

  createUserRow(userId, user) {
    const tr = document.createElement('tr');

    const lastLogin = user.lastLogin?.toDate()
      ? new Date(user.lastLogin.toDate()).toLocaleString()
      : 'Never';

    tr.innerHTML = `
      <td>${user.email}</td>
      <td>${user.displayName || 'N/A'}</td>
      <td>
        <select
          class="form-select"
          data-user-id="${userId}"
          onchange="admin.changeRole('${userId}', this.value)"
        >
          <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>${lastLogin}</td>
      <td>
        <span class="status-badge ${user.isActive ? 'status-active' : 'status-inactive'}">
          ${user.isActive ? 'Active' : 'Disabled'}
        </span>
      </td>
      <td>
        <button
          class="btn btn-sm ${user.isActive ? 'btn-danger' : 'btn-secondary'}"
          onclick="admin.toggleUserStatus('${userId}', ${!user.isActive}, '${user.email}')"
        >
          ${user.isActive ? 'Disable' : 'Enable'}
        </button>
      </td>
    `;

    return tr;
  }

  async changeRole(userId, newRole) {
    try {
      const userDoc = await getDoc(doc(this.db, 'users', userId));
      const oldRole = userDoc.data().role;
      const userEmail = userDoc.data().email;

      await updateDoc(doc(this.db, 'users', userId), { role: newRole });

      // Log activity
      await this.logAdminActivity('role_change', null, null, userId, oldRole, newRole);

      alert(`Role updated: ${userEmail} is now ${newRole}`);
      await this.loadActivityLog(); // Refresh log

    } catch (error) {
      console.error('Error changing role:', error);
      alert('Failed to update role');
    }
  }

  async toggleUserStatus(userId, enable, email) {
    const action = enable ? 'enable' : 'disable';
    if (!confirm(`${action.toUpperCase()} access for ${email}?`)) {
      return;
    }

    try {
      await updateDoc(doc(this.db, 'users', userId), {
        isActive: enable
      });

      // Log activity
      await this.logAdminActivity(
        enable ? 'user_enabled' : 'user_disabled',
        null, null, userId
      );

      alert(`User ${enable ? 'enabled' : 'disabled'} successfully`);
      await this.loadUsers(); // Refresh table

    } catch (error) {
      console.error('Error toggling user status:', error);
      alert('Failed to update user status');
    }
  }

  // ==========================================
  // WHITELIST MANAGEMENT
  // ==========================================

  async loadWhitelist() {
    const configSnap = await getDoc(doc(this.db, 'config', 'access'));
    const { allowedEmails } = configSnap.data();

    document.getElementById('whitelistSize').textContent = allowedEmails.length;

    const emailList = document.getElementById('emailList');
    emailList.innerHTML = '';

    allowedEmails.sort().forEach(email => {
      const div = document.createElement('div');
      div.className = 'email-item';
      div.innerHTML = `
        <span class="email-text">${email}</span>
        <button
          class="btn btn-sm btn-danger"
          onclick="admin.removeEmail('${email}')"
        >
          Remove
        </button>
      `;
      emailList.appendChild(div);
    });
  }

  async addEmail() {
    const input = document.getElementById('newEmail');
    const email = input.value.trim().toLowerCase();

    if (!email) return;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address');
      return;
    }

    try {
      const configRef = doc(this.db, 'config', 'access');
      await updateDoc(configRef, {
        allowedEmails: arrayUnion(email),
        lastModified: new Date(),
        modifiedBy: this.auth.currentUser.uid
      });

      // Log activity
      await this.logAdminActivity('whitelist_add', null, null, null, null, email);

      input.value = '';
      alert(`Added ${email} to whitelist`);
      await this.loadWhitelist();
      await this.loadActivityLog();

    } catch (error) {
      console.error('Error adding email:', error);
      alert('Failed to add email to whitelist');
    }
  }

  async removeEmail(email) {
    if (!confirm(`Remove ${email} from whitelist?\n\nThis will immediately revoke their access.`)) {
      return;
    }

    try {
      const configRef = doc(this.db, 'config', 'access');
      await updateDoc(configRef, {
        allowedEmails: arrayRemove(email),
        lastModified: new Date(),
        modifiedBy: this.auth.currentUser.uid
      });

      // Log activity
      await this.logAdminActivity('whitelist_remove', null, null, null, email, null);

      alert(`Removed ${email} from whitelist`);
      await this.loadWhitelist();
      await this.loadActivityLog();

    } catch (error) {
      console.error('Error removing email:', error);
      alert('Failed to remove email from whitelist');
    }
  }

  // ==========================================
  // ACTIVITY LOG
  // ==========================================

  async loadActivityLog() {
    const activityFilter = document.getElementById('activityFilter').value;
    const timeFilter = document.getElementById('timeFilter').value;

    let q = query(
      collection(this.db, 'activityLog'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    // Apply action filter
    if (activityFilter !== 'all') {
      q = query(
        collection(this.db, 'activityLog'),
        where('action', '==', activityFilter),
        orderBy('timestamp', 'desc'),
        limit(100)
      );
    }

    const snapshot = await getDocs(q);
    const logContainer = document.getElementById('activityLog');
    logContainer.innerHTML = '';

    // Apply time filter
    const now = new Date();
    const timeThresholds = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      'all': Infinity
    };
    const threshold = timeThresholds[timeFilter];

    snapshot.forEach(doc => {
      const log = doc.data();
      const timestamp = log.timestamp?.toDate();

      // Filter by time
      if (now - timestamp > threshold) return;

      const logEntry = this.createLogEntry(log);
      logContainer.appendChild(logEntry);
    });

    if (logContainer.children.length === 0) {
      logContainer.innerHTML = '<p class="empty-message">No activity to display</p>';
    }
  }

  createLogEntry(log) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    const timestamp = log.timestamp?.toDate()
      ? new Date(log.timestamp.toDate()).toLocaleString()
      : 'Unknown time';

    const message = this.formatLogMessage(log);
    const icon = this.getActionIcon(log.action);

    div.innerHTML = `
      <span class="log-icon">${icon}</span>
      <div class="log-details">
        <div class="log-message">${message}</div>
        <div class="log-meta">
          <span class="log-user">${log.userName || log.userEmail}</span>
          <span class="log-time">${timestamp}</span>
        </div>
      </div>
    `;

    return div;
  }

  formatLogMessage(log) {
    switch (log.action) {
      case 'create':
        return `Created chart <strong>${log.chartName || 'Untitled'}</strong>`;
      case 'update':
        return `Updated chart <strong>${log.chartName || 'Untitled'}</strong>`;
      case 'delete':
        return `Deleted chart <strong>${log.chartName || 'Untitled'}</strong>`;
      case 'role_change':
        return `Changed role from <strong>${log.oldValue}</strong> to <strong>${log.newValue}</strong>`;
      case 'whitelist_add':
        return `Added <strong>${log.newValue}</strong> to whitelist`;
      case 'whitelist_remove':
        return `Removed <strong>${log.oldValue}</strong> from whitelist`;
      case 'user_enabled':
        return `Enabled user access`;
      case 'user_disabled':
        return `Disabled user access`;
      default:
        return log.action;
    }
  }

  getActionIcon(action) {
    const icons = {
      'create': '✨',
      'update': '✏️',
      'delete': '🗑️',
      'role_change': '👤',
      'whitelist_add': '➕',
      'whitelist_remove': '➖',
      'user_enabled': '✅',
      'user_disabled': '🚫'
    };
    return icons[action] || '📝';
  }

  async logAdminActivity(action, chartId = null, chartName = null, targetUserId = null, oldValue = null, newValue = null) {
    const user = this.auth.currentUser;
    const logRef = doc(collection(this.db, 'activityLog'));

    await setDoc(logRef, {
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName || user.email,
      action: action,
      chartId: chartId,
      chartName: chartName,
      targetUserId: targetUserId,
      oldValue: oldValue,
      newValue: newValue,
      timestamp: new Date()
    });
  }
}

// Initialize admin panel
const admin = new AdminPanel();
document.addEventListener('DOMContentLoaded', () => {
  admin.init();
});

// Export for inline onclick handlers
window.admin = admin;
```

#### File: app/css/admin.css (NEW FILE)

```css
/* Admin Panel Styles */

.admin-section {
  background: white;
  border-radius: var(--radius);
  padding: 2rem;
  margin-bottom: 2rem;
  box-shadow: var(--shadow-sm);
}

.admin-section h2 {
  margin-bottom: 1.5rem;
  font-size: 1.25rem;
  font-weight: 600;
}

/* User Table */
.table-container {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
}

.admin-table th {
  text-align: left;
  padding: 0.75rem;
  background: var(--background-secondary);
  font-weight: 600;
  font-size: 0.875rem;
  border-bottom: 2px solid var(--border-color);
}

.admin-table td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.admin-table tr:hover {
  background: var(--background-secondary);
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-active {
  background: #d1fae5;
  color: #065f46;
}

.status-inactive {
  background: #fee2e2;
  color: #991b1b;
}

/* Whitelist Manager */
.whitelist-container h3 {
  font-size: 1rem;
  margin-bottom: 1rem;
}

.email-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1rem;
}

.email-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  background: var(--background-secondary);
  border-radius: var(--radius-sm);
}

.email-text {
  font-family: monospace;
  font-size: 0.875rem;
}

.add-email-form {
  display: flex;
  gap: 0.5rem;
}

.add-email-form input {
  flex: 1;
}

/* Activity Log */
.filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.activity-log {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 1rem;
}

.log-entry {
  display: flex;
  gap: 1rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--background-secondary);
  border-radius: var(--radius-sm);
}

.log-icon {
  font-size: 1.5rem;
}

.log-details {
  flex: 1;
}

.log-message {
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.log-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.empty-message {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
}
```

---

## Critical Considerations

### 1. Token Caching & Revoked Access

**Problem:**
- User logs in at 9:00 AM
- Admin removes their email from whitelist at 9:30 AM
- User's Firebase Auth token is valid until 10:00 AM
- User can still access app for 30 minutes!

**Solutions Implemented:**

1. **Check `isActive` flag on every Firestore operation** (enforced by Security Rules)
2. **Re-verify whitelist on page load** (implemented in `router.js`)
3. **Admin sets `isActive: false`** to immediately block (checked by all Security Rules)

**Best Practice:**
```javascript
// When removing user, admin should:
// 1. Remove from whitelist
await updateDoc(doc(db, 'config', 'access'), {
  allowedEmails: arrayRemove(email)
});

// 2. Set user as inactive (immediate block)
const userSnapshot = await getDocs(
  query(collection(db, 'users'), where('email', '==', email))
);
userSnapshot.forEach(async (userDoc) => {
  await updateDoc(doc(db, 'users', userDoc.id), {
    isActive: false
  });
});
```

### 2. Whitelist Array Size Limits

**Firestore Constraints:**
- Maximum document size: 1 MB
- Arrays cost 1 read per document, regardless of size
- Arrays are fetched entirely, not paginated

**Current Implementation:**
- Store `allowedEmails` as array in `/config/access`
- Works well up to ~500 emails (~20 KB)

**When to Switch Architectures:**

**Threshold: 500+ emails**

**Option A: Domain-Based Whitelist**
```javascript
/config/access
  - allowedDomains: ['@company.com']
  - blockedEmails: ['contractor@company.com'] // Exceptions

// Check logic
function isAllowed(email) {
  const domain = '@' + email.split('@')[1];
  return allowedDomains.includes(domain) && !blockedEmails.includes(email);
}
```

**Option B: Approved Users Collection**
```javascript
/approvedUsers/{email}
  - approved: true
  - approvedBy: userId
  - approvedAt: timestamp

// Check logic (faster, scales to millions)
const approvedDoc = await getDoc(doc(db, 'approvedUsers', email));
return approvedDoc.exists() && approvedDoc.data().approved;
```

**Migration Plan:**
```javascript
// Script to migrate from array to collection
async function migrateWhitelist() {
  const config = await getDoc(doc(db, 'config', 'access'));
  const { allowedEmails } = config.data();

  for (const email of allowedEmails) {
    await setDoc(doc(db, 'approvedUsers', email), {
      approved: true,
      approvedBy: 'migration_script',
      approvedAt: new Date()
    });
  }

  console.log(`Migrated ${allowedEmails.length} emails`);
}
```

### 3. Role Caching & Mid-Session Changes

**Scenario:**
- User opens editor at 9:00 AM as "editor"
- Admin changes their role to "viewer" at 9:15 AM
- User still sees edit buttons until page refresh

**Solutions:**

1. **Always re-check role on page load** (implemented)
2. **Cache role in sessionStorage but verify on privileged actions** (implemented)
3. **Optional: Real-time role listener** (recommended for production):

```javascript
// Add to app initialization
import { doc, onSnapshot } from 'firebase/firestore';

function watchUserRole(userId) {
  return onSnapshot(doc(db, 'users', userId), (snapshot) => {
    const newRole = snapshot.data().role;
    const cachedRole = sessionStorage.getItem('userRole');

    if (newRole !== cachedRole) {
      sessionStorage.setItem('userRole', newRole);

      // Show notification
      showNotification({
        title: 'Role Changed',
        message: `Your role has been changed to ${newRole}. Some features may be limited.`,
        type: 'warning',
        action: () => location.reload()
      });
    }
  });
}

// Call on dashboard/editor init
const unsubscribe = watchUserRole(auth.currentUser.uid);
```

**Cost Consideration:**
- Real-time listener = 1 read per change
- For 100 users, if admin changes 10 roles/day = 10 reads/day
- Cost: negligible (<$0.01/month)

### 4. Admin Panel Activity Logging

**Current Implementation:**
- Logs chart CRUD operations
- Does NOT log whitelist changes
- Does NOT log role changes

**Recommended Enhancement:**
Log all admin actions, especially security-related:

```javascript
// Enhanced logging for whitelist changes
async addEmail(email) {
  // ... existing code ...

  await setDoc(doc(collection(this.db, 'activityLog')), {
    userId: this.auth.currentUser.uid,
    userEmail: this.auth.currentUser.email,
    userName: this.auth.currentUser.displayName,
    action: 'whitelist_add',
    chartId: null,
    chartName: null,
    targetUserId: null,
    oldValue: null,
    newValue: email, // Email that was added
    timestamp: new Date()
  });
}

// Enhanced logging for role changes
async changeRole(userId, newRole) {
  const userDoc = await getDoc(doc(this.db, 'users', userId));
  const oldRole = userDoc.data().role;

  // ... update role ...

  await setDoc(doc(collection(this.db, 'activityLog')), {
    userId: this.auth.currentUser.uid,
    userEmail: this.auth.currentUser.email,
    userName: this.auth.currentUser.displayName,
    action: 'role_change',
    chartId: null,
    chartName: null,
    targetUserId: userId, // User whose role was changed
    oldValue: oldRole,
    newValue: newRole,
    timestamp: new Date()
  });
}
```

**Why This Matters:**
- Compliance/audit requirements
- Security incident investigation
- Admin accountability
- Troubleshooting access issues

---

## Cost Estimates

### Firestore Pricing (Pay-as-you-go)

**Free Tier (per day):**
- 50,000 document reads
- 20,000 document writes
- 20,000 document deletes
- 1 GB stored data

**Paid Tier (after free tier):**
- Reads: $0.06 per 100,000
- Writes: $0.18 per 100,000
- Deletes: $0.02 per 100,000
- Storage: $0.18 per GB/month

### Typical Usage Patterns

#### Scenario 1: Small Team (10 users, 50 charts)

**Daily Operations:**
- Login: 10 users × 2 reads (whitelist + user doc) = 20 reads
- Dashboard load: 10 users × 50 charts = 500 reads
- Chart edits: 5 edits/day × 1 write = 5 writes
- Auto-save: 5 edits × 10 auto-saves = 50 writes
- Activity logs: 55 writes

**Monthly Total:**
- Reads: 15,600 (within free tier)
- Writes: 3,300 (within free tier)
- **Cost: $0/month**

#### Scenario 2: Medium Team (50 users, 200 charts)

**Daily Operations:**
- Login: 50 × 2 = 100 reads
- Dashboard load: 50 × 200 = 10,000 reads
- Chart edits: 20 × 1 = 20 writes
- Auto-save: 20 × 10 = 200 writes
- Activity logs: 220 writes

**Monthly Total:**
- Reads: 303,000 (253,000 over free tier)
- Writes: 13,200 (7,200 over free tier)
- **Cost: ~$1.50/month**

#### Scenario 3: Large Team (100 users, 1000 charts)

**Daily Operations:**
- Login: 100 × 2 = 200 reads
- Dashboard load: 100 × 1000 = 100,000 reads
- Chart edits: 50 × 1 = 50 writes
- Auto-save: 50 × 10 = 500 writes
- Activity logs: 550 writes

**Monthly Total:**
- Reads: 3,006,000 (2,506,000 over free tier)
- Writes: 33,000 (27,000 over free tier)
- **Cost: ~$5-7/month**

### Firebase Hosting

- **Free tier:** 10 GB storage, 360 MB/day bandwidth
- **Paid:** $0.026 per GB bandwidth
- **Typical cost:** $0-2/month (static files, minimal bandwidth)

### Firebase Authentication

- **Free tier:** 50,000 MAU (Monthly Active Users)
- **Paid:** $0.0025 per MAU over 50k
- **Typical cost:** $0/month (up to 50k users)

### **Total Estimated Costs:**

| Users | Charts | Firestore | Hosting | Auth | Total/Month |
|-------|--------|-----------|---------|------|-------------|
| 10    | 50     | $0        | $0      | $0   | **$0**      |
| 50    | 200    | $1-2      | $0      | $0   | **$1-2**    |
| 100   | 1,000  | $5-7      | $1      | $0   | **$6-8**    |
| 500   | 5,000  | $25-30    | $2      | $0   | **$27-32**  |

### Cost Optimization Tips

1. **Reduce Dashboard Reads:**
```javascript
// Instead of loading all charts every time
const charts = await getAllCharts(); // 1000 reads

// Use real-time listener (only pays for changes)
onSnapshot(collection(db, 'charts'), (snapshot) => {
  // Only charged for changed documents
});
```

2. **Paginate Large Lists:**
```javascript
// Load charts in pages
const q = query(
  collection(db, 'charts'),
  orderBy('lastModified', 'desc'),
  limit(20) // Only load 20 at a time
);
```

3. **Cache Whitelist:**
```javascript
// Cache whitelist in localStorage for 1 hour
const cachedWhitelist = localStorage.getItem('whitelist');
const cacheTime = localStorage.getItem('whitelistTime');

if (cachedWhitelist && Date.now() - cacheTime < 3600000) {
  // Use cache (avoid Firestore read)
  return JSON.parse(cachedWhitelist);
} else {
  // Fetch fresh (1 Firestore read)
  const whitelist = await getWhitelist();
  localStorage.setItem('whitelist', JSON.stringify(whitelist));
  localStorage.setItem('whitelistTime', Date.now());
  return whitelist;
}
```

4. **Debounce Auto-Save:**
```javascript
// Instead of saving every 30 seconds
setInterval(() => this.saveChart(), 30000); // 120 writes/hour

// Save only when user stops typing (300ms delay)
const debouncedSave = debounce(() => this.saveChart(), 300);
onNodeEdit(() => debouncedSave());
```

---

## Migration Checklist

### Pre-Migration

- [ ] Review this entire document
- [ ] Get approval from stakeholders
- [ ] Request Azure AD registration from IT
- [ ] Request subdomain from networking team
- [ ] Confirm budget approval (~$10-50/month)
- [ ] Schedule migration date/time
- [ ] Backup all existing localStorage data

### Week 1: Setup

- [ ] Create Firebase project
- [ ] Configure Microsoft authentication
- [ ] Setup custom domain
- [ ] Deploy security rules
- [ ] Create initial whitelist
- [ ] Test authentication flow

### Week 2: Development

- [ ] Create firestore-storage.js
- [ ] Update dashboard.js for async
- [ ] Update chart-editor.js for async
- [ ] Create login.html
- [ ] Create auth.js and router.js
- [ ] Add sign-out buttons

### Week 3: Testing

- [ ] Test all user flows
- [ ] Test all three roles (admin/editor/viewer)
- [ ] Test whitelist enforcement
- [ ] Test access revocation
- [ ] Performance testing with large datasets
- [ ] Security rules testing

### Week 4: Admin Panel & Polish

- [ ] Build admin panel (admin.html, admin.js)
- [ ] Add activity logging
- [ ] Add loading states
- [ ] Add error handling
- [ ] User documentation
- [ ] Admin training

### Week 5: Deployment

- [ ] Final testing on staging
- [ ] Deploy to production
- [ ] Announce to users
- [ ] Monitor for errors
- [ ] Provide support during rollout

### Post-Migration

- [ ] Monitor Firebase costs
- [ ] Collect user feedback
- [ ] Optimize based on usage patterns
- [ ] Plan future enhancements
- [ ] Schedule quarterly security reviews

---

## Conclusion

This migration plan provides a complete roadmap from localStorage-based local app to Firebase-powered multi-user web application with Microsoft SSO.

**Key Takeaways:**

1. **Firebase is the right choice** for this use case (simple, cost-effective, fast)
2. **Shared dashboard model** simplifies architecture significantly
3. **Role-based access** provides necessary control without complexity
4. **Security is enforced at multiple layers** (whitelist, isActive flag, Firestore rules)
5. **Estimated timeline: 2-4 weeks** (1 developer, part-time)
6. **Estimated cost: $0-10/month** for typical usage

**Critical Success Factors:**

- Thorough testing of authentication and authorization
- Clear communication with users about migration
- Monitoring during first week of production
- Admin training on user management
- Regular security rule audits

---

**Document Status:** Ready for Implementation
**Next Review:** After Phase 1 completion
**Owner:** Development Team
**Approver:** Project Stakeholder
