# Backend Implementation Plan
## Dynamic Org Chart Creator - Enterprise Architecture

**Document Version:** 1.0
**Last Updated:** January 2025
**Status:** Planning Phase

---

## Executive Summary

This document outlines the comprehensive backend architecture plan for transitioning the Dynamic Org Chart Creator from a client-side localStorage application to an enterprise-ready, cloud-hosted solution with Microsoft SSO authentication, multi-user support, and scalable data storage.

### Key Objectives
- Implement Microsoft Azure AD SSO for secure authentication
- Migrate from localStorage to cloud database (Firebase/Firestore)
- Enable multi-user collaboration and chart sharing
- Deploy to corporate subdomain with production-grade security
- Establish observability, monitoring, and support processes

---

## 1. Authentication & Identity Management

### 1.1 Microsoft SSO Integration (Azure AD/Entra ID)

#### Overview
Integrate OAuth 2.0/OpenID Connect authentication using Azure Active Directory to leverage existing corporate credentials.

#### Technical Requirements
- **Azure AD App Registration**: Register application in Azure portal
- **Redirect URIs**: Configure callback URLs for authentication flow
- **API Permissions**: Request necessary Microsoft Graph permissions
- **Token Management**: Implement secure token storage and refresh mechanisms

#### Authentication Flow
```
1. User navigates to orgchart.company.com
2. Application redirects to Azure AD login
3. User authenticates with Microsoft credentials (+ MFA if enforced)
4. Azure AD returns authorization code
5. Backend exchanges code for access token
6. Backend validates token and creates session
7. User accesses application with authenticated session
```

#### Implementation Components

**Frontend:**
- Use MSAL.js (Microsoft Authentication Library) for browser-based auth
- Handle redirect callbacks
- Store tokens securely (memory, not localStorage)
- Implement silent token refresh

**Backend:**
- Validate JWT tokens from Azure AD
- Extract user claims (OID, UPN, email, groups)
- Map Azure AD user to internal user profile
- Maintain secure sessions (HttpOnly cookies)

#### Security Considerations
- **Token Storage**: Never store access tokens in localStorage
- **Token Lifetime**: Use short-lived access tokens (1 hour)
- **Refresh Tokens**: Rotate refresh tokens on each use
- **Session Management**: Implement secure session cookies (HttpOnly, Secure, SameSite=Strict)
- **Logout Flow**: Clear both local and Azure AD sessions

### 1.2 Authorization & Permissions

#### Role-Based Access Control (RBAC)

**Roles:**
- **Chart Owner**: Full control over charts they create
- **Editor**: Can modify charts they have access to
- **Viewer**: Read-only access to shared charts
- **Administrator**: Manage all charts and users

**Permission Matrix:**

| Action | Owner | Editor | Viewer | Admin |
|--------|-------|--------|--------|-------|
| Create Chart | ✓ | ✓ | ✗ | ✓ |
| View Own Chart | ✓ | ✓ | ✓ | ✓ |
| Edit Own Chart | ✓ | ✗ | ✗ | ✓ |
| Delete Own Chart | ✓ | ✗ | ✗ | ✓ |
| Share Chart | ✓ | ✗ | ✗ | ✓ |
| View Shared Chart | ✓ | ✓ | ✓ | ✓ |
| Edit Shared Chart | Owner only | ✓ | ✗ | ✓ |
| View All Charts | ✗ | ✗ | ✗ | ✓ |
| Manage Users | ✗ | ✗ | ✗ | ✓ |

#### Chart Sharing Model

**Sharing Options:**
1. **Private**: Only chart owner can access
2. **Shared with Users**: Specific users granted access
3. **Shared with Groups**: Azure AD security groups granted access
4. **Organization-Wide**: All authenticated users in tenant can view

**Implementation:**
```javascript
// Chart access control structure
{
  chartId: "chart_123",
  ownerId: "user@company.com",
  visibility: "shared", // private | shared | org-wide
  permissions: {
    users: {
      "user2@company.com": "editor",
      "user3@company.com": "viewer"
    },
    groups: {
      "sg-hr-team": "viewer",
      "sg-managers": "editor"
    }
  }
}
```

### 1.3 Azure AD Group Integration

#### Group-Based Access Provisioning

**Use Case**: Automatically grant chart access based on Azure AD group membership.

**Implementation Strategy:**
1. **Graph API Integration**: Fetch user's group memberships via Microsoft Graph
2. **Group Sync**: Periodic sync of group members to application database
3. **Dynamic Permissions**: Evaluate permissions at request time based on current group membership
4. **SCIM Provisioning** (Optional): Implement SCIM 2.0 endpoints for enterprise provisioning

**Example:**
```
User joins "HR Leadership" group in Azure AD
→ Automatically granted viewer access to all charts tagged "HR"
→ No manual permission assignment needed
```

---

## 2. Backend Architecture

### 2.1 Technology Stack Recommendation

#### **Option A: Node.js + Express (Recommended)**

**Pros:**
- Matches existing JavaScript frontend stack
- Large ecosystem of libraries
- Easy integration with Firebase
- Fast development cycle

**Cons:**
- Single-threaded (use clustering for scale)
- Less mature than enterprise Java/.NET

**Tech Stack:**
- Runtime: Node.js 20 LTS
- Framework: Express.js 4.x
- Authentication: @azure/msal-node
- Database Client: Firebase Admin SDK
- Session Store: Redis (for distributed sessions)

#### **Option B: Azure Functions (Serverless)**

**Pros:**
- No server management
- Auto-scaling
- Pay-per-execution pricing
- Native Azure AD integration

**Cons:**
- Cold start latency
- Vendor lock-in
- Complex debugging

**Use Case:** Lightweight API, event-driven architecture

#### **Option C: .NET Core (Enterprise Standard)**

**Pros:**
- Strong typing (C#)
- Mature Azure integration
- High performance
- Enterprise support

**Cons:**
- Different language from frontend
- Heavier runtime

**Use Case:** Organizations with existing .NET infrastructure

**Decision:** **Node.js + Express** for Phase 1 (familiarity, speed), re-evaluate for Phase 2 based on scale requirements.

### 2.2 Backend Service Components

#### API Gateway (Express Server)

**Responsibilities:**
- Route HTTP requests to appropriate handlers
- Authenticate requests (validate JWT tokens)
- Authorize actions (check user permissions)
- Rate limiting and request validation
- Error handling and logging

**API Endpoints Structure:**
```
/api/auth
  POST /login          - Initiate SSO login
  POST /logout         - End user session
  POST /refresh        - Refresh access token
  GET  /me             - Get current user profile

/api/charts
  GET    /             - List user's charts (with filters)
  POST   /             - Create new chart
  GET    /:id          - Get chart by ID
  PUT    /:id          - Update chart
  DELETE /:id          - Delete chart
  POST   /:id/share    - Share chart with users/groups

/api/users
  GET    /me           - Get current user profile
  PUT    /me           - Update user preferences
  GET    /:id          - Get user by ID (admin only)

/api/admin
  GET    /charts       - List all charts (admin)
  GET    /users        - List all users (admin)
  GET    /audit-logs   - View audit logs (admin)
  POST   /permissions  - Grant/revoke permissions (admin)
```

#### Authentication Service

**Responsibilities:**
- Handle OAuth 2.0 flow with Azure AD
- Validate access tokens
- Manage refresh tokens
- Create and manage user sessions
- Implement logout

**Key Functions:**
- `initiateLogin()` - Redirect to Azure AD
- `handleCallback()` - Exchange code for token
- `validateToken()` - Verify JWT signature and claims
- `refreshToken()` - Get new access token using refresh token
- `logout()` - Clear session and revoke tokens

#### Chart Service

**Responsibilities:**
- CRUD operations on chart data
- Enforce ownership and permissions
- Validate chart structure
- Track modifications (audit log)

**Key Functions:**
- `createChart(userId, chartData)` - Create new chart
- `getChart(userId, chartId)` - Retrieve chart with permission check
- `updateChart(userId, chartId, updates)` - Update chart with validation
- `deleteChart(userId, chartId)` - Soft delete chart
- `shareChart(ownerId, chartId, permissions)` - Grant access to users/groups

#### User Service

**Responsibilities:**
- Manage user profiles
- Sync with Azure AD user data
- Track user preferences
- Handle user lifecycle (provision, deprovision)

**Key Functions:**
- `provisionUser(azureAdUser)` - Create user on first login (JIT provisioning)
- `getUserProfile(userId)` - Get user details
- `updatePreferences(userId, preferences)` - Save user settings
- `getUserGroups(userId)` - Fetch group memberships via Graph API

#### Permission Service

**Responsibilities:**
- Evaluate access control rules
- Check user permissions on resources
- Resolve group-based permissions
- Cache permission decisions

**Key Functions:**
- `canAccess(userId, chartId, action)` - Check if user can perform action
- `getAccessibleCharts(userId)` - List charts user can access
- `grantPermission(chartId, principal, role)` - Add permission
- `revokePermission(chartId, principal)` - Remove permission

---

## 3. Data Storage Migration

### 3.1 Current State: localStorage

**Problems:**
- Data locked to single browser on single device
- No multi-user access or collaboration
- No backup or disaster recovery
- Data lost if browser cache cleared
- No server-side validation

**Data Structure (Current):**
```javascript
localStorage.setItem('orgCharts', JSON.stringify({
  chart_123: {
    chartId: "chart_123",
    chartName: "Executive Team",
    nodes: [...],
    createdAt: "2024-01-15T10:00:00Z",
    lastModified: "2024-01-20T14:30:00Z"
  }
}));
```

### 3.2 Target State: Cloud Database (Firebase/Firestore)

**Why Firebase/Firestore:**
- Real-time sync capabilities
- Flexible NoSQL document store
- Built-in security rules
- Google Cloud infrastructure
- Easy integration with Node.js
- Automatic scaling

**Alternative Options:**
- **Azure Cosmos DB**: Better Azure integration, higher cost
- **MongoDB Atlas**: Mature, flexible, good for complex queries
- **PostgreSQL + Supabase**: Relational option, good for structured data

**Decision:** **Firestore** for real-time sync, scalability, and existing team familiarity.

### 3.3 New Data Model

#### Collections Structure

**Users Collection:**
```javascript
// Collection: users/{userId}
{
  userId: "abc123", // Azure AD Object ID (OID)
  email: "user@company.com",
  displayName: "John Doe",
  tenantId: "contoso.com",
  azureGroups: ["sg-hr-team", "sg-managers"],
  preferences: {
    theme: "dark",
    defaultLayout: "top"
  },
  createdAt: Timestamp,
  lastLogin: Timestamp
}
```

**Charts Collection:**
```javascript
// Collection: charts/{chartId}
{
  chartId: "chart_123",
  ownerId: "abc123",
  ownerEmail: "user@company.com",
  tenantId: "contoso.com",

  // Chart metadata
  chartName: "Executive Team",
  departmentTag: "Leadership",
  description: "C-Suite organizational structure",

  // Timestamps
  createdAt: Timestamp,
  lastModified: Timestamp,
  lastModifiedBy: "abc123",

  // Nodes data
  nodes: [
    {
      id: "node_1",
      parentId: null,
      members: [
        {
          roleLabel: "Chief Executive Officer",
          entries: [
            { name: "Jane Smith", email: "jane@company.com", phone: "", photoUrl: "" }
          ]
        }
      ],
      meta: { department: "Executive", notes: "" }
    }
  ],

  // View state
  viewState: {
    zoom: 1,
    pan: { x: 0, y: 0 },
    collapsedNodes: []
  },
  layout: "top",

  // Access control
  visibility: "shared", // private | shared | org-wide
  permissions: {
    users: {
      "user2@company.com": "editor",
      "user3@company.com": "viewer"
    },
    groups: {
      "sg-hr-team": "viewer"
    }
  }
}
```

**Audit Logs Collection:**
```javascript
// Collection: audit_logs/{logId}
{
  logId: "log_456",
  timestamp: Timestamp,
  userId: "abc123",
  userEmail: "user@company.com",

  action: "CHART_UPDATED", // CHART_CREATED | CHART_DELETED | CHART_SHARED | etc.

  resourceType: "chart",
  resourceId: "chart_123",

  changes: {
    field: "nodes",
    oldValue: {...},
    newValue: {...}
  },

  metadata: {
    ipAddress: "10.0.1.42",
    userAgent: "Mozilla/5.0...",
    correlationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

**Deleted Charts Collection (Soft Delete):**
```javascript
// Collection: deleted_charts/{chartId}
{
  // Same structure as charts collection, plus:
  deletedAt: Timestamp,
  deletedBy: "abc123",
  retentionUntil: Timestamp, // Auto-delete after 90 days
  originalChartId: "chart_123"
}
```

### 3.4 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(chart) {
      return request.auth.uid == chart.ownerId;
    }

    function hasPermission(chart, requiredRole) {
      return chart.permissions.users[request.auth.token.email] == requiredRole
          || chart.permissions.groups.keys().hasAny(request.auth.token.groups);
    }

    function isSameTenant(chart) {
      return request.auth.token.tenant_id == chart.tenantId;
    }

    // Charts collection rules
    match /charts/{chartId} {
      allow read: if isAuthenticated()
                  && isSameTenant(resource.data)
                  && (isOwner(resource.data)
                      || hasPermission(resource.data, 'viewer')
                      || hasPermission(resource.data, 'editor')
                      || resource.data.visibility == 'org-wide');

      allow create: if isAuthenticated()
                    && request.resource.data.ownerId == request.auth.uid;

      allow update: if isAuthenticated()
                    && isSameTenant(resource.data)
                    && (isOwner(resource.data)
                        || hasPermission(resource.data, 'editor'));

      allow delete: if isAuthenticated()
                    && isOwner(resource.data);
    }

    // Users collection rules
    match /users/{userId} {
      allow read: if isAuthenticated() && request.auth.uid == userId;
      allow write: if isAuthenticated() && request.auth.uid == userId;
    }

    // Audit logs (read-only)
    match /audit_logs/{logId} {
      allow read: if isAuthenticated();
      allow write: if false; // Only backend can write
    }
  }
}
```

### 3.5 Database Indexing Strategy

**Required Indexes:**

1. **Charts by Owner** (for user's chart list)
   - Collection: `charts`
   - Fields: `ownerId ASC`, `lastModified DESC`

2. **Charts by Shared Users** (for shared charts)
   - Collection: `charts`
   - Fields: `permissions.users MAP`, `lastModified DESC`

3. **Charts by Department** (for filtering)
   - Collection: `charts`
   - Fields: `tenantId ASC`, `departmentTag ASC`, `lastModified DESC`

4. **Charts by Tenant** (for admin view)
   - Collection: `charts`
   - Fields: `tenantId ASC`, `createdAt DESC`

5. **Audit Logs by User** (for user activity history)
   - Collection: `audit_logs`
   - Fields: `userId ASC`, `timestamp DESC`

6. **Audit Logs by Chart** (for chart history)
   - Collection: `audit_logs`
   - Fields: `resourceId ASC`, `timestamp DESC`

---

## 4. Data Migration Strategy

### 4.1 Migration Phases

#### Phase 1: User Onboarding (First Login After Backend Launch)

**Flow:**
```
1. User logs in with SSO (first time with new backend)
2. Backend checks if user exists in Firestore
3. If new user: JIT provision (create user profile)
4. Frontend detects localStorage data exists
5. Show migration prompt: "Found X charts in browser. Migrate to cloud?"
6. If accepted:
   a. Frontend reads all charts from localStorage
   b. Backend API: POST /api/charts/migrate with chart data
   c. Backend validates and saves to Firestore with user as owner
   d. Mark localStorage as migrated (flag to prevent re-prompt)
7. User now sees charts in cloud-synced dashboard
```

**Migration API Endpoint:**
```javascript
POST /api/charts/migrate
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  charts: [
    { chartId: "chart_1", chartName: "Team A", nodes: [...], ... },
    { chartId: "chart_2", chartName: "Team B", nodes: [...], ... }
  ]
}

Response:
{
  success: true,
  migratedCount: 2,
  results: [
    { chartId: "chart_1", status: "migrated", newId: "chart_abc" },
    { chartId: "chart_2", status: "migrated", newId: "chart_def" }
  ]
}
```

#### Phase 2: Bulk Migration (Optional, for IT Admin)

**Use Case:** IT wants to pre-migrate charts for all users before launch.

**Process:**
1. Export all localStorage data from test users
2. Create CSV/JSON mapping: `email → chartsData`
3. Backend admin script: For each user, create charts in Firestore
4. Send email notification: "Your charts are now available in cloud"

#### Phase 3: Data Format Migration (Ongoing)

**Node Format Evolution:**
- V1: Single-person nodes (legacy)
- V2: Multi-person nodes (current)
- V3: (Future) Enhanced metadata, attachments, etc.

**Strategy:** Automatic migration on load (already implemented in `storage.js:migrateNode()`)

### 4.2 Rollback Plan

**If migration fails or critical bug discovered:**

1. **Backend Rollback:**
   - Revert to previous backend version
   - Charts in Firestore remain intact

2. **Frontend Fallback:**
   - Re-enable localStorage mode
   - Users can export charts from cloud
   - Import back to localStorage if needed

3. **Data Preservation:**
   - Never delete localStorage data automatically
   - Keep for 30 days after successful migration
   - Allow manual cleanup via settings

---

## 5. Subdomain & Hosting Configuration

### 5.1 Infrastructure Setup

#### Domain Configuration

**Subdomain:** `orgchart.company.com`

**DNS Records:**
```
Type: CNAME
Name: orgchart
Value: orgchart-app.azurewebsites.net (or static hosting endpoint)
TTL: 3600
```

**SSL/TLS Certificate:**
- Use Azure App Service Managed Certificate (auto-renewal)
- Or Let's Encrypt wildcard cert for `*.company.com`
- Enforce HTTPS (redirect HTTP → HTTPS)
- Use TLS 1.3 minimum

#### Hosting Options

**Option A: Azure Static Web Apps + Azure Functions**
- Frontend: Static assets served from CDN
- Backend: Azure Functions for API
- Built-in CI/CD from GitHub
- Custom domain support
- Free SSL certificates

**Option B: Azure App Service (Web App)**
- Single deployment for frontend + backend
- Auto-scaling support
- Integrated with Azure AD
- Easier monitoring via Application Insights

**Option C: Separate Services**
- Frontend: Azure Blob Storage + Azure CDN
- Backend: Azure App Service or Container Instances
- More complex but better separation of concerns

**Recommendation:** **Option A (Static Web Apps)** for Phase 1 (fast deployment, lower cost), migrate to Option B if scaling needs increase.

### 5.2 CORS Configuration

**Required for Separate Frontend/Backend Domains:**

```javascript
// Backend CORS settings
const corsOptions = {
  origin: [
    'https://orgchart.company.com',
    'http://localhost:8080' // Development only
  ],
  credentials: true, // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID']
};

app.use(cors(corsOptions));
```

### 5.3 Environment Configuration

**Environment Variables:**

```bash
# Azure AD Configuration
AZURE_AD_CLIENT_ID=abc123
AZURE_AD_CLIENT_SECRET=xyz789 # Store in Azure Key Vault
AZURE_AD_TENANT_ID=contoso.onmicrosoft.com
AZURE_AD_REDIRECT_URI=https://orgchart.company.com/api/auth/callback

# Firebase Configuration
FIREBASE_PROJECT_ID=orgchart-prod
FIREBASE_CLIENT_EMAIL=firebase-admin@orgchart.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..." # Store in Key Vault

# Application Settings
NODE_ENV=production
PORT=3000
SESSION_SECRET=random-secret-key # Generate securely, store in Key Vault
REDIS_URL=redis://cache.company.com:6379

# Monitoring
APPINSIGHTS_CONNECTION_STRING=InstrumentationKey=...

# Feature Flags
ENABLE_BULK_EXPORT=true
MAX_CHARTS_PER_USER=100
MAX_NODES_PER_CHART=500
```

**Separate Environments:**
- **Development:** `orgchart-dev.company.com`
- **Staging:** `orgchart-staging.company.com`
- **Production:** `orgchart.company.com`

---

## 6. Security Hardening

### 6.1 Content Security Policy (CSP)

**Strict CSP Headers:**

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'nonce-{random}';
  img-src 'self' data: blob: https:;
  font-src 'self';
  connect-src 'self'
    https://login.microsoftonline.com
    https://graph.microsoft.com
    https://firestore.googleapis.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
```

**Implementation:**
1. Remove all inline event handlers (`onclick`, `onchange`)
2. Move to `addEventListener()` in JavaScript
3. Use nonces for necessary inline scripts/styles
4. Test with browser CSP violation reporting

### 6.2 Additional Security Headers

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### 6.3 Input Validation & Sanitization

**Server-Side Validation:**

```javascript
// Example: Create chart validation
const createChartSchema = Joi.object({
  chartName: Joi.string().min(1).max(100).required(),
  departmentTag: Joi.string().max(50).optional(),
  description: Joi.string().max(500).optional(),
  nodes: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      parentId: Joi.string().allow(null),
      members: Joi.array().items(
        Joi.object({
          roleLabel: Joi.string().required(),
          entries: Joi.array().items(
            Joi.object({
              name: Joi.string().required(),
              email: Joi.string().email().optional(),
              phone: Joi.string().optional(),
              photoUrl: Joi.string().uri().optional()
            })
          )
        })
      ).required()
    })
  ).max(500) // Max 500 nodes per chart
});

app.post('/api/charts', async (req, res) => {
  const { error, value } = createChartSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  // Proceed with validated data
});
```

**XSS Prevention:**
- Use DOM API methods (already implemented in `chart-editor.js`)
- Never use `innerHTML` with user-provided data
- Sanitize any HTML content (if allowing rich text in future)

**SQL Injection Prevention:**
- Not applicable (using Firestore, not SQL)
- Still validate input types and ranges

### 6.4 Rate Limiting

**API Rate Limits:**

```javascript
const rateLimit = require('express-rate-limit');

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: 'Too many requests, please try again later.'
});

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 minutes
  skipSuccessfulRequests: true
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
```

**Export Rate Limits:**
```javascript
// Limit expensive operations
const exportLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 exports per minute per user
  keyGenerator: (req) => req.user.id // Per-user limit
});

app.use('/api/charts/:id/export', exportLimiter);
```

### 6.5 Secrets Management

**Azure Key Vault Integration:**

```javascript
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

const credential = new DefaultAzureCredential();
const client = new SecretClient('https://orgchart-vault.vault.azure.net', credential);

async function getSecret(secretName) {
  const secret = await client.getSecret(secretName);
  return secret.value;
}

// Load secrets at startup
const config = {
  azureClientSecret: await getSecret('azure-ad-client-secret'),
  firebasePrivateKey: await getSecret('firebase-private-key'),
  sessionSecret: await getSecret('session-secret')
};
```

**Never commit secrets to Git:**
- Use `.env` files (gitignored) for local development
- Use Azure Key Vault for production
- Rotate secrets regularly (quarterly)

---

## 7. Observability & Monitoring

### 7.1 Logging Strategy

#### Structured Logging Format

**JSON Log Structure:**
```json
{
  "timestamp": "2025-01-15T14:32:10.482Z",
  "level": "INFO",
  "message": "CHART_UPDATED",
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "userId": "user@company.com",
  "tenantId": "contoso.com",
  "chartId": "chart_123",
  "duration": 145,
  "context": {
    "ipAddress": "10.0.1.42",
    "userAgent": "Mozilla/5.0...",
    "route": "/api/charts/123",
    "method": "PUT"
  }
}
```

#### Log Levels & Categories

**ERROR:** System failures, unhandled exceptions
- Authentication failures (invalid tokens)
- Database connection errors
- Unhandled promise rejections

**WARN:** Potential issues, security events
- Unauthorized access attempts
- Rate limit exceeded
- Invalid input validation

**INFO:** Normal operations, business events
- User login/logout
- Chart created/updated/deleted
- Permission granted/revoked

**DEBUG:** Detailed diagnostic information
- API request/response details
- Database query execution times
- Token refresh operations

#### Correlation IDs

**Implementation:**
```javascript
// Middleware to generate correlation ID
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

// Include in all logs
logger.info('Chart created', {
  correlationId: req.correlationId,
  userId: req.user.id,
  chartId: newChart.id
});
```

**Frontend Integration:**
```javascript
// Include correlation ID in API calls
fetch('/api/charts', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Correlation-ID': window.correlationId || crypto.randomUUID()
  }
});
```

### 7.2 Application Insights Configuration

**Setup:**
```javascript
const appInsights = require('applicationinsights');
appInsights.setup(process.env.APPINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectExceptions(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectConsole(true)
  .start();

// Custom telemetry
appInsights.defaultClient.trackEvent({
  name: 'ChartExported',
  properties: {
    userId: user.id,
    chartId: chart.id,
    format: 'PDF',
    nodeCount: chart.nodes.length
  },
  measurements: {
    exportDuration: 2500, // milliseconds
    fileSizeBytes: 1024000
  }
});
```

**Key Metrics to Track:**
- API response times (p50, p95, p99)
- Chart rendering performance
- Export success rate
- Authentication success rate
- Database query duration
- Error rates by endpoint
- Active user count
- Concurrent sessions

### 7.3 Alerting Rules

**Critical Alerts (PagerDuty/Teams):**
- Application down (5xx error rate > 5%)
- Authentication service unavailable
- Database connection failures
- More than 10 failed auth attempts from same IP

**High Priority Alerts (Email):**
- API response time > 3 seconds (p95)
- Export failure rate > 2%
- Disk space > 80% used
- Memory usage > 80%

**Medium Priority (Dashboard Only):**
- Unusual spike in chart creations (> 100 in 1 hour)
- Large export file size (> 50MB)
- Slow database queries (> 5 seconds)

---

## 8. Multi-Tenant Architecture

### 8.1 Tenant Isolation Strategy

**Model: Shared Database, Tenant ID Filtering**

**Why This Model:**
- Simpler management (single database)
- Lower operational overhead
- Sufficient for internal enterprise use
- Easier to implement cross-tenant features (if needed)

**Tenant Identification:**
- Use Azure AD Tenant ID from JWT token
- Every chart, user, log tagged with `tenantId`
- Firestore rules enforce tenant boundary

**Alternative (If Needed):**
- **Separate Collections per Tenant**: Higher isolation, more complex queries
- **Separate Databases**: Maximum isolation, for external partners/B2B

### 8.2 Azure AD Group Provisioning

**SCIM Provisioning (Optional Advanced Feature):**

**Use Case:** External partners get Azure AD B2B guest accounts, automatically provisioned to org chart app.

**SCIM Endpoints to Implement:**
```
POST   /scim/Users           - Create user
GET    /scim/Users/{id}      - Get user details
PATCH  /scim/Users/{id}      - Update user (group changes)
DELETE /scim/Users/{id}      - Deprovision user
GET    /scim/Groups          - List groups
```

**Flow:**
```
1. User added to "Org Chart Viewers" group in Azure AD
2. Azure AD sends SCIM webhook to app
3. Backend auto-grants viewer access to published charts
4. User logs in, immediately sees charts
```

**Simpler Alternative (Recommended for Phase 1):**
- Sync groups via Microsoft Graph API (scheduled job)
- Check group membership at login/permission check time
- No SCIM server needed

---

## 9. Support & Lifecycle Processes

### 9.1 User Support Tiers

**Tier 1: Self-Service**
- In-app help center (`/help` route)
- FAQ section
- Video tutorials
- Keyboard shortcuts reference
- Known issues & workarounds

**Tier 2: Helpdesk Ticket**
- Issue reporting form in app
- Categories: Bug, Feature Request, Access Issue, Performance
- Auto-capture: userId, chartId, browser info, correlationId
- Integration with Jira/Azure DevOps

**Tier 3: Engineering Escalation**
- Critical bugs (data loss, app down)
- Security incidents
- Performance degradation

### 9.2 Change Management

**Release Cadence:**
- **Hotfix**: On-demand (critical bugs/security)
- **Patch**: Weekly (bug fixes)
- **Minor**: Bi-weekly (new features)
- **Major**: Quarterly (breaking changes)

**Breaking Change Protocol:**
```
Timeline for Breaking Changes:
T-12 weeks: Announce in changelog + email users
T-8 weeks:  Deploy side-by-side (feature flag for new version)
T-4 weeks:  Make new version default, keep old as opt-in
T-0 weeks:  Remove old code
T+4 weeks:  Retrospective on migration issues
```

**Feature Flags:**
```javascript
const featureFlags = {
  newExportDesign: {
    enabled: true,
    rollout: 25% // Gradual rollout to 25% of users
  },
  realtimeCollaboration: {
    enabled: false // Coming soon
  },
  bulkImport: {
    enabled: true,
    allowlist: ['admin@company.com'] // Limited beta
  }
};
```

### 9.3 Data Retention Policy

**Active Charts:**
- Retained indefinitely while user account active

**Deleted Charts (Soft Delete):**
- Moved to `deleted_charts` collection
- Retained for 90 days (allow recovery)
- Auto-purged after 90 days via scheduled cleanup job

**Audit Logs:**
- Retained for 2 years (compliance requirement)
- Immutable storage (append-only)
- Exportable for legal discovery

**User Data on Account Deletion:**
```javascript
// GDPR "Right to Erasure" implementation
async function deleteUserData(userId, adminId) {
  // 1. Export user data (for compliance record)
  const userExport = await exportAllUserData(userId);
  await archiveToStorage(userExport);

  // 2. Anonymize charts (preserve org structure)
  await db.collection('charts')
    .where('ownerId', '==', userId)
    .update({
      ownerId: 'DELETED_USER',
      ownerEmail: '[REDACTED]'
    });

  // 3. Delete PII
  await db.collection('users').doc(userId).delete();

  // 4. Audit log
  await auditLog.record('USER_DELETED', {
    userId,
    requestedBy: adminId,
    reason: 'GDPR request'
  });
}
```

### 9.4 Legal Hold Process

**Scenario:** Legal department requests preservation of user data.

**Implementation:**
```javascript
// Create legal hold
await db.collection('legal_holds').add({
  holdId: 'LH-2025-001',
  userId: 'user@company.com',
  requestedBy: 'legal@company.com',
  reason: 'Litigation case #12345',
  startDate: new Date(),
  endDate: null, // Open-ended
  affectedResources: ['charts', 'audit_logs']
});

// Block automated deletions
async function beforeDelete(chartId) {
  const chart = await getChart(chartId);
  const holds = await db.collection('legal_holds')
    .where('userId', '==', chart.ownerId)
    .where('endDate', '==', null)
    .get();

  if (!holds.empty) {
    throw new Error('Cannot delete: resource under legal hold');
  }
}
```

---

## 10. Deployment & DevOps

### 10.1 CI/CD Pipeline

**Azure DevOps Pipeline:**

```yaml
# azure-pipelines.yml
trigger:
  - main
  - develop

stages:
  - stage: Build
    jobs:
      - job: BuildFrontend
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '20.x'
          - script: npm ci
          - script: npm run build
          - script: npm test
          - publish: dist/
            artifact: frontend

      - job: BuildBackend
        steps:
          - script: npm ci
          - script: npm test
          - script: npm run build
          - publish: backend/
            artifact: backend

  - stage: DeployStaging
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/develop')
    jobs:
      - deployment: DeployToStaging
        environment: staging
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'orgchart-staging'
                    package: '$(Pipeline.Workspace)/backend'

  - stage: DeployProduction
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - deployment: DeployToProduction
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'orgchart-prod'
                    package: '$(Pipeline.Workspace)/backend'
```

### 10.2 Blue-Green Deployment

**Strategy:**
1. Deploy new version to "green" slot
2. Run smoke tests against green slot
3. If tests pass, swap green ↔ blue (zero downtime)
4. If tests fail, delete green slot (rollback without impact)

**Azure App Service Slots:**
- **Production Slot**: `orgchart.company.com` (blue)
- **Staging Slot**: `orgchart-staging.azurewebsites.net` (green)

### 10.3 Database Migrations

**Firestore Schema Changes:**

Since Firestore is schemaless, "migrations" are handled via:

1. **Additive Changes**: Add new fields, old code ignores them
2. **Backward-Compatible Reads**: Backend reads both old and new format
3. **Lazy Migration**: Migrate data on first read/write
4. **Batch Migration**: Background job updates all documents

**Example: Adding `tags` field to charts:**
```javascript
// Phase 1: Backend supports both with and without tags
function getChart(chartId) {
  const chart = await db.collection('charts').doc(chartId).get();
  return {
    ...chart.data(),
    tags: chart.data().tags || [] // Default to empty if not present
  };
}

// Phase 2: Background job adds tags to all charts
async function migrateAddTags() {
  const batch = db.batch();
  const charts = await db.collection('charts').where('tags', '==', undefined).get();

  charts.forEach(doc => {
    batch.update(doc.ref, { tags: [] });
  });

  await batch.commit();
}
```

### 10.4 Monitoring Dashboard

**Key Metrics:**
- Uptime (target: 99.9%)
- API response time (p50, p95, p99)
- Error rate
- Active users
- Charts created/edited today
- Export success rate

**Tools:**
- Azure Application Insights Dashboard
- Custom Power BI dashboard (optional)
- Grafana + Prometheus (if self-hosted)

---

## 11. Threat Modeling & Security Testing

### 11.1 STRIDE Threat Analysis

**Spoofing Identity:**
- **Threat**: Attacker steals Azure AD token
- **Mitigation**: Short-lived tokens, MFA enforcement, IP binding
- **Test**: Token replay attack, should be rejected after expiration

**Tampering with Data:**
- **Threat**: Modify chart JSON in transit
- **Mitigation**: HTTPS with HSTS, server-side validation
- **Test**: Send malicious payload, should be rejected

**Repudiation:**
- **Threat**: User denies creating/deleting chart
- **Mitigation**: Immutable audit logs with timestamps
- **Test**: Verify audit log captured action

**Information Disclosure:**
- **Threat**: Unauthorized access to charts via ID guessing
- **Mitigation**: Permission checks on every request, UUIDs not sequential IDs
- **Test**: User A tries to access User B's chart, should get 403

**Denial of Service:**
- **Threat**: Upload massive chart (10,000 nodes)
- **Mitigation**: Max node limit (500), rate limiting
- **Test**: Attempt to create oversized chart, should be rejected

**Elevation of Privilege:**
- **Threat**: Viewer modifies chart they should only read
- **Mitigation**: Permission check on every write operation
- **Test**: Viewer sends PUT request, should get 403

### 11.2 Penetration Testing Checklist

**Pre-Launch Testing:**
- [ ] OWASP ZAP automated scan
- [ ] Manual authentication bypass attempts
- [ ] IDOR (Insecure Direct Object Reference) testing
- [ ] Input fuzzing (malformed JSON, SQL injection attempts)
- [ ] XSS injection attempts (script tags in chart names)
- [ ] CSRF token validation
- [ ] Rate limiting enforcement
- [ ] Session management (logout, timeout)

**Post-Launch (Annually):**
- [ ] External penetration test by security firm
- [ ] Red team exercise
- [ ] Dependency vulnerability scan (npm audit, Snyk)
- [ ] Secrets scanning (check for leaked keys)

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

**Week 1-2: Backend Setup**
- [ ] Set up Azure AD app registration
- [ ] Create Node.js + Express backend skeleton
- [ ] Implement OAuth 2.0 authentication flow
- [ ] Deploy to Azure App Service (staging)
- [ ] Test SSO login end-to-end

**Week 3-4: Data Layer**
- [ ] Set up Firebase/Firestore project
- [ ] Implement API endpoints (charts CRUD)
- [ ] Add user provisioning (JIT)
- [ ] Implement permission checks
- [ ] Write Firestore security rules

### Phase 2: Migration (Weeks 5-6)

**Week 5: Frontend Integration**
- [ ] Update frontend to call backend APIs
- [ ] Implement token management (MSAL.js)
- [ ] Add migration prompt for localStorage data
- [ ] Test chart sync (create, edit, delete)

**Week 6: Testing & Refinement**
- [ ] End-to-end testing (auth, CRUD, permissions)
- [ ] Performance testing (load testing with 100 concurrent users)
- [ ] Fix bugs identified in testing
- [ ] User acceptance testing (UAT) with pilot group

### Phase 3: Production Launch (Week 7-8)

**Week 7: Deploy to Production**
- [ ] Configure subdomain DNS
- [ ] Set up SSL certificate
- [ ] Deploy backend to production Azure
- [ ] Deploy frontend to production
- [ ] Configure monitoring and alerts

**Week 8: Post-Launch Support**
- [ ] Monitor application performance
- [ ] Respond to user feedback
- [ ] Fix any critical bugs
- [ ] Document known issues
- [ ] Plan for next iteration

### Phase 4: Enhancements (Weeks 9-12)

**Optional Features:**
- [ ] Chart sharing with external users (B2B)
- [ ] Real-time collaboration (see others' cursors)
- [ ] Version history (rollback to previous versions)
- [ ] Advanced export options (vector PDFs, Atlas mode)
- [ ] Admin dashboard (user management, analytics)

---

## 13. Cost Estimation

### Infrastructure Costs (Monthly, USD)

**Azure Services:**
- App Service (Basic B1): $55/month
- Azure AD Premium P1 (if needed for advanced features): $6/user/month
- Application Insights: ~$10/month (based on usage)
- Azure Key Vault: $0.03/10,000 transactions
- **Subtotal:** ~$70-80/month + per-user AAD costs

**Firebase/Firestore:**
- Document reads: 50,000 free, then $0.06 per 100,000
- Document writes: 20,000 free, then $0.18 per 100,000
- Storage: 1 GB free, then $0.18/GB
- Network egress: 10 GB free, then $0.12/GB
- **Estimated:** $20-50/month for 100-500 active users

**Total Estimated Monthly Cost:** $100-150 for up to 500 users

**Scaling Costs:**
- 1,000 users: ~$250/month
- 5,000 users: ~$500/month

---

## 14. Success Metrics

### Key Performance Indicators (KPIs)

**User Adoption:**
- Active users per month
- Charts created per month
- Average charts per user
- User retention rate (monthly)

**Performance:**
- API response time (p95 < 500ms)
- Chart load time (< 2 seconds)
- Export success rate (> 98%)
- Uptime (> 99.9%)

**Security:**
- Failed authentication attempts
- Permission violations
- Security incidents (target: 0)

**Support:**
- Average ticket resolution time
- User satisfaction score (CSAT)
- Bug report volume

---

## 15. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|---------|-----------|
| Azure AD integration issues | Medium | High | Extensive testing, fallback to email/password auth |
| Data migration failures | Medium | High | Comprehensive testing, rollback plan, keep localStorage |
| Performance issues at scale | Low | Medium | Load testing, caching strategy, database optimization |
| Security breach | Low | Critical | Penetration testing, security reviews, audit logs |
| User resistance to change | Medium | Medium | Training, communication, migration support |
| Budget overrun | Low | Medium | Regular cost monitoring, optimize resource usage |
| Third-party service outage (Azure/Firebase) | Low | High | Multi-region deployment, backup data export |

---

## 16. Next Steps

### Immediate Actions (This Week)

1. **Stakeholder Approval**: Present this plan to leadership for approval
2. **Team Assembly**: Identify developers, assign roles
3. **Azure AD Setup**: Register application in Azure portal
4. **Firebase Setup**: Create Firebase project, configure Firestore

### Short-Term (Next 2 Weeks)

1. **Backend Development**: Start building authentication service
2. **API Design**: Finalize API endpoint specifications
3. **Security Review**: Conduct threat modeling workshop
4. **Testing Strategy**: Define test cases, set up test environments

### Long-Term (Next 3 Months)

1. **Pilot Launch**: Deploy to staging, pilot with 10-20 users
2. **Iterate**: Incorporate feedback, fix issues
3. **Production Launch**: Full deployment to all users
4. **Post-Launch**: Monitor, support, iterate on features

---

## Appendix A: Glossary

- **Azure AD**: Azure Active Directory, Microsoft's cloud-based identity service
- **Firestore**: Google's NoSQL cloud database
- **JWT**: JSON Web Token, used for secure authentication
- **MSAL**: Microsoft Authentication Library
- **OAuth 2.0**: Industry-standard authorization protocol
- **RBAC**: Role-Based Access Control
- **SCIM**: System for Cross-domain Identity Management
- **SSO**: Single Sign-On

## Appendix B: References

- [Azure AD Authentication Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/)
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Azure Well-Architected Framework](https://docs.microsoft.com/en-us/azure/architecture/framework/)

---

**Document End**

*This plan is a living document and will be updated as the project progresses.*
