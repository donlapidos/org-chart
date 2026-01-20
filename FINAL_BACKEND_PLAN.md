# Final Backend Plan: Azure Static Web Apps + Serverless Architecture

**Document Version:** 1.0 (Production Ready)
**Last Updated:** January 2025
**Purpose:** Complete implementation guide for org-chart backend using Azure Static Web Apps with production-grade refinements

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Production Refinements](#5-production-refinements)
6. [Complete API Implementation](#6-complete-api-implementation)
7. [Database Schema](#7-database-schema)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Deployment Guide](#9-deployment-guide)
10. [Monitoring & Observability](#10-monitoring--observability)
11. [Security Implementation](#11-security-implementation)
12. [Disaster Recovery](#12-disaster-recovery)
13. [Cost Analysis](#13-cost-analysis)
14. [Testing Strategy](#14-testing-strategy)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Executive Summary

### The Challenge
Build a backend for the org-chart application that provides:
- Microsoft SSO authentication
- Chart data persistence
- Minimal operational overhead (developer not familiar with backend)

### The Solution
**Azure Static Web Apps (SWA) + Azure Functions + Cosmos DB Serverless**

### Why This Architecture?
| Requirement | Solution | Benefit |
|-------------|----------|---------|
| **Microsoft SSO** | Built-in SWA authentication | Zero-code auth, no JWT validation |
| **Data Persistence** | Cosmos DB Serverless (MongoDB API) | Pay-per-use, auto-scaling |
| **Low Maintenance** | Serverless Functions | No server management, auto-deploy |
| **Cost Efficiency** | <$1-25/month | vs $280-480/month traditional approach |
| **Developer Experience** | 3 simple functions | vs 12-week Express.js implementation |

### Implementation Timeline
- **Week 1:** Local development setup (no Azure account needed)
- **Week 2:** Database integration with Cosmos DB
- **Week 3:** Azure deployment and production launch

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       │ HTTPS
       ▼
┌────────────────────────────────────────┐
│   Azure Static Web App                 │
│  ┌──────────────────────────────────┐  │
│  │  Frontend (HTML/JS/CSS/D3.js)    │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Built-in Auth (/.auth/*)        │  │
│  │  - Azure AD Login                │  │
│  │  - Session Management            │  │
│  └──────────────────────────────────┘  │
└────────────┬───────────────────────────┘
             │
             │ Authenticated Requests
             ▼
┌────────────────────────────────────────┐
│   Azure Functions (Serverless API)     │
│  ┌──────────────────────────────────┐  │
│  │  GET /api/v1/GetCharts           │  │
│  │  POST /api/v1/SaveChart          │  │
│  │  DELETE /api/v1/DeleteChart      │  │
│  │  POST /api/v1/ShareChart         │  │
│  └──────────────────────────────────┘  │
└────────────┬───────────────────────────┘
             │
             │ MongoDB Driver
             ▼
┌────────────────────────────────────────┐
│   Cosmos DB for MongoDB (Serverless)   │
│  ┌──────────────────────────────────┐  │
│  │  charts collection               │  │
│  │  rate_limits collection          │  │
│  │  deleted_charts collection       │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### Request Flow

```
1. User navigates to https://orgchart.company.com
   ↓
2. SWA serves static frontend files
   ↓
3. User clicks "Login"
   ↓
4. Browser redirects to /.auth/login/aad
   ↓
5. Azure AD authentication flow
   ↓
6. User authenticated, session cookie set
   ↓
7. Frontend calls /api/v1/GetCharts
   ↓
8. SWA validates session, injects user headers
   ↓
9. Azure Function executes with userId available
   ↓
10. Function queries Cosmos DB, filtered by userId
   ↓
11. Response returned to browser
```

---

## 3. Technology Stack

### Frontend (Unchanged)
- **Framework:** Vanilla JavaScript
- **Visualization:** D3.js v7
- **Build:** No build step required (static files)

### Backend
- **Hosting:** Azure Static Web Apps (Free or Standard tier)
- **API:** Azure Functions (Node.js 18 runtime)
- **Database:** Azure Cosmos DB for MongoDB (Serverless mode)
- **Authentication:** Built-in SWA Azure AD provider

### Development Tools
- **Local Development:** Azure SWA CLI (`@azure/static-web-apps-cli`)
- **Package Manager:** npm
- **Version Control:** Git + GitHub
- **CI/CD:** GitHub Actions (auto-generated)

### Monitoring & Operations
- **Logging:** Application Insights
- **Alerts:** Azure Monitor
- **Backup:** Cosmos DB Continuous Backup

---

## 4. Project Structure

```
org-chart/
├── app/                          # Existing frontend (unchanged)
│   ├── index.html
│   ├── chart-editor.html
│   ├── js/
│   │   ├── dashboard.js
│   │   ├── chart-editor.js
│   │   └── org-node-renderer.js
│   ├── css/
│   └── vendor/
│
├── api/                          # NEW: Backend functions
│   ├── shared/                   # Shared modules
│   │   ├── cosmos.js            # Database connection (reusable)
│   │   ├── validation.js        # Input validation
│   │   ├── rateLimiter.js       # Rate limiting logic
│   │   ├── authorization.js     # Permission checks
│   │   └── logger.js            # Structured logging
│   │
│   ├── GetCharts/               # List all user's charts
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── GetChart/                # Get single chart
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── SaveChart/               # Create/update chart
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── DeleteChart/             # Delete chart (soft delete)
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── ShareChart/              # Manage permissions
│   │   ├── function.json
│   │   └── index.js
│   │
│   └── package.json             # Backend dependencies
│
├── .github/
│   └── workflows/
│       ├── azure-static-web-apps.yml  # Auto-generated deployment
│       └── security.yml               # Security scanning
│
├── staticwebapp.config.json     # SWA routing & auth rules
├── .eslintrc.js                 # Linting + security rules
├── package.json                 # Root dependencies
└── README.md

```

---

## 5. Production Refinements

### Overview of 8 Critical Refinements

| # | Refinement | Impact | Implementation Priority |
|---|------------|--------|------------------------|
| 1 | Connection Reuse | 90% latency reduction | **Critical** |
| 2 | Input Validation & Rate Limiting | Prevent abuse, control costs | **Critical** |
| 3 | Multi-Environment Config | Safe deployments | **High** |
| 4 | RBAC & Chart Sharing | Enable collaboration | **High** |
| 5 | Monitoring & Structured Logging | Production debugging | **Critical** |
| 6 | Backup & DR | Business continuity | **High** |
| 7 | Security Scanning | Prevent vulnerabilities | **High** |
| 8 | Future Graph Integration | Extensibility | **Medium** |

**Important Note on Rate Limiting:**
While Azure Static Web Apps provides built-in DDoS protection at the platform level, **per-user rate limiting is implemented in your Azure Functions code** (not the platform). This ensures granular control over:
- Requests per minute/hour per user
- Chart size limits (MAX_CHART_SIZE)
- Operation-specific limits (saves, exports, deletes)
- Cost control for Cosmos DB RU consumption

See Refinement #2 below for the complete `rateLimiter.js` implementation using Cosmos DB as the rate limit store.

### Refinement 1: Connection Reuse (Critical)

**Problem:** Azure Functions are stateless. Opening new MongoDB connections on every request:
- Adds 100-500ms latency
- Wastes Cosmos DB RUs ($$$)
- Can exhaust connection pools

**Solution:** Module-scoped connection singleton

**File:** `api/shared/cosmos.js`
```javascript
const { MongoClient } = require('mongodb');

let client = null;
let clientPromise = null;

/**
 * Get or reuse MongoDB client connection
 * Connections are reused across function invocations in the same container
 */
async function getCosmosClient() {
    // Check if existing connection is still alive
    if (client && client.topology && client.topology.isConnected()) {
        return client;
    }

    // Create new connection if needed
    if (!clientPromise) {
        const connectionString = process.env.COSMOS_CONNECTION_STRING;

        if (!connectionString) {
            throw new Error('COSMOS_CONNECTION_STRING environment variable not set');
        }

        client = new MongoClient(connectionString, {
            maxPoolSize: 10,              // Max concurrent connections
            minPoolSize: 2,               // Keep 2 connections warm
            maxIdleTimeMS: 60000,         // Close idle connections after 60s
            serverSelectionTimeoutMS: 5000,
            retryWrites: true,
            retryReads: true
        });

        clientPromise = client.connect();
    }

    await clientPromise;
    return client;
}

/**
 * Gracefully close connection (for cleanup, rarely needed)
 */
async function closeCosmosClient() {
    if (client) {
        await client.close();
        client = null;
        clientPromise = null;
    }
}

module.exports = { getCosmosClient, closeCosmosClient };
```

**Benefits:**
- First request: ~200ms (connection establishment)
- Subsequent requests: ~5-10ms (connection reused)
- Saves ~$50-100/month in RU costs

---

### Refinement 2: Input Validation & Rate Limiting

**File:** `api/shared/validation.js`
```javascript
const MAX_CHART_SIZE = 5 * 1024 * 1024;  // 5MB limit
const MAX_NODE_COUNT = 1000;              // Reasonable org chart limit
const MAX_NAME_LENGTH = 200;

/**
 * Validate chart payload before saving
 * @param {Object} chartData - Chart data from request body
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateChartPayload(chartData) {
    const errors = [];

    // Size check
    const payloadSize = JSON.stringify(chartData).length;
    if (payloadSize > MAX_CHART_SIZE) {
        errors.push(
            `Chart too large: ${(payloadSize / 1024 / 1024).toFixed(2)}MB exceeds 5MB limit`
        );
    }

    // Node count check (prevent massive charts)
    if (chartData.data?.nodes && chartData.data.nodes.length > MAX_NODE_COUNT) {
        errors.push(
            `Too many nodes: ${chartData.data.nodes.length} exceeds limit of ${MAX_NODE_COUNT}`
        );
    }

    // Required fields
    if (!chartData.id || typeof chartData.id !== 'string') {
        errors.push('Missing or invalid chart ID');
    }

    if (!chartData.name || typeof chartData.name !== 'string') {
        errors.push('Missing chart name');
    } else if (chartData.name.length > MAX_NAME_LENGTH) {
        errors.push(`Chart name too long (max ${MAX_NAME_LENGTH} characters)`);
    }

    // Validate data structure
    if (!chartData.data || typeof chartData.data !== 'object') {
        errors.push('Missing chart data');
    } else {
        if (!Array.isArray(chartData.data.nodes)) {
            errors.push('Chart data must contain nodes array');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize chart name (prevent XSS)
 */
function sanitizeChartName(name) {
    return name
        .replace(/[<>]/g, '')  // Remove HTML tags
        .trim()
        .substring(0, MAX_NAME_LENGTH);
}

module.exports = {
    validateChartPayload,
    sanitizeChartName,
    MAX_CHART_SIZE,
    MAX_NODE_COUNT
};
```

**File:** `api/shared/rateLimiter.js`
```javascript
/**
 * Rate limiting using Cosmos DB as storage
 * Prevents abuse and controls Cosmos DB RU costs
 */

const RATE_LIMITS = {
    SAVE_CHART: { max: 100, windowMs: 60 * 60 * 1000, name: '1 hour' },    // 100 saves/hour
    GET_CHARTS: { max: 500, windowMs: 60 * 60 * 1000, name: '1 hour' },    // 500 reads/hour
    DELETE_CHART: { max: 20, windowMs: 60 * 60 * 1000, name: '1 hour' },   // 20 deletes/hour
    SHARE_CHART: { max: 50, windowMs: 60 * 60 * 1000, name: '1 hour' }     // 50 shares/hour
};

/**
 * Check if user has exceeded rate limit for action
 * @param {string} userId - User ID from headers
 * @param {string} action - Action type (SAVE_CHART, GET_CHARTS, etc)
 * @param {MongoClient} client - Cosmos DB client
 */
async function checkRateLimit(userId, action, client) {
    const limit = RATE_LIMITS[action];
    if (!limit) {
        return { allowed: true };  // No limit defined
    }

    const db = client.db('orgchart');
    const rateLimits = db.collection('rate_limits');

    const now = new Date();
    const windowStart = new Date(now.getTime() - limit.windowMs);

    try {
        // Count requests in current window
        const count = await rateLimits.countDocuments({
            userId: userId,
            action: action,
            timestamp: { $gte: windowStart }
        });

        if (count >= limit.max) {
            const resetTime = new Date(windowStart.getTime() + limit.windowMs);
            return {
                allowed: false,
                message: `Rate limit exceeded: ${limit.max} ${action} requests per ${limit.name}`,
                retryAfter: Math.ceil((resetTime - now) / 1000),  // Seconds until reset
                limit: limit.max,
                current: count
            };
        }

        // Record this request
        await rateLimits.insertOne({
            userId: userId,
            action: action,
            timestamp: now,
            // TTL index will auto-delete after window expires
            expiresAt: new Date(now.getTime() + limit.windowMs)
        });

        return {
            allowed: true,
            remaining: limit.max - count - 1,
            limit: limit.max
        };

    } catch (error) {
        // On error, allow request (fail open) but log the issue
        console.error('Rate limit check failed:', error);
        return { allowed: true, error: 'Rate limit check failed' };
    }
}

/**
 * Create TTL index on rate_limits collection (run once at setup)
 */
async function createRateLimitIndexes(client) {
    const db = client.db('orgchart');
    const rateLimits = db.collection('rate_limits');

    await rateLimits.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }  // TTL index - auto-delete expired docs
    );

    await rateLimits.createIndex(
        { userId: 1, action: 1, timestamp: 1 }  // Query optimization
    );
}

module.exports = {
    checkRateLimit,
    createRateLimitIndexes,
    RATE_LIMITS
};
```

---

### Refinement 3: Multi-Environment Configuration

**File:** `staticwebapp.config.json`
```json
{
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/login",
      "redirect": "/.auth/login/aad"
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/.auth/*", "/assets/*"]
  },
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad",
      "statusCode": 302
    },
    "403": {
      "rewrite": "/403.html"
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "mimeTypes": {
    ".json": "application/json",
    ".pdf": "application/pdf"
  }
}
```

**Environment Strategy:**

| Environment | Branch | SWA Resource | Cosmos DB | Purpose |
|-------------|--------|--------------|-----------|---------|
| **Development** | `develop` | `orgchart-dev` | `orgchart-cosmos-dev` | Feature testing |
| **Staging** | `staging` | `orgchart-staging` | `orgchart-cosmos-staging` | Pre-production validation |
| **Production** | `main` | `orgchart-prod` | `orgchart-cosmos-prod` | Live user traffic |

**GitHub Actions Workflow:**

**File:** `.github/workflows/azure-static-web-apps.yml`
```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - main
      - develop
      - staging
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main
      - develop

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy

    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true

      - name: Determine Environment
        id: env
        run: |
          if [[ "${{ github.ref }}" == "refs/heads/main" ]]; then
            echo "env_name=production" >> $GITHUB_OUTPUT
            echo "swa_token=${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_PROD }}" >> $GITHUB_OUTPUT
          elif [[ "${{ github.ref }}" == "refs/heads/staging" ]]; then
            echo "env_name=staging" >> $GITHUB_OUTPUT
            echo "swa_token=${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING }}" >> $GITHUB_OUTPUT
          else
            echo "env_name=development" >> $GITHUB_OUTPUT
            echo "swa_token=${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_DEV }}" >> $GITHUB_OUTPUT
          fi

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Install API Dependencies
        run: cd api && npm install

      - name: Build And Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ steps.env.outputs.swa_token }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/app"
          api_location: "/api"
          output_location: ""

  close_pull_request_job:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_DEV }}
          action: "close"
```

**Azure Portal Configuration (per environment):**

```bash
# Production Application Settings
COSMOS_CONNECTION_STRING=mongodb://orgchart-cosmos-prod...
ENVIRONMENT_NAME=production
MAX_CHART_SIZE=5242880
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
NODE_ENV=production

# Development Application Settings
COSMOS_CONNECTION_STRING=mongodb://orgchart-cosmos-dev...
ENVIRONMENT_NAME=development
MAX_CHART_SIZE=10485760  # Allow larger charts in dev
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
NODE_ENV=development
```

---

### Refinement 4: RBAC & Chart-Level Permissions

**Extended Cosmos DB Schema:**

```javascript
// charts collection document
{
  "_id": ObjectId("..."),
  "id": "chart_abc123",                   // User-facing ID
  "ownerId": "user-guid-from-aad",       // Creator (Partition Key)
  "name": "Executive Team 2025",
  "createdAt": ISODate("2025-01-15T10:00:00Z"),
  "lastModified": ISODate("2025-01-24T12:00:00Z"),
  "sizeBytes": 245678,

  // Access control
  "permissions": {
    "owner": "user-guid-from-aad",
    "editors": [
      "user-guid-2",
      "user-guid-3"
    ],
    "viewers": [
      "user-guid-4",
      "azure-ad-group-id-all-employees"    // Future: AD group support
    ],
    "public": false,                        // Public link sharing
    "publicLinkToken": null                 // Random token for public access
  },

  // Chart data
  "data": {
    "nodes": [...],
    "layout": "top",
    "theme": "default"
  },

  // Metadata
  "version": 2,
  "deleted": false,
  "deletedAt": null
}
```

**File:** `api/shared/authorization.js`
```javascript
/**
 * Authorization helpers for chart-level permissions
 */

const ROLES = {
    OWNER: 'owner',
    EDITOR: 'editor',
    VIEWER: 'viewer',
    PUBLIC: 'public',
    NONE: 'none'
};

/**
 * Check if user can access chart with required role
 * @param {string} chartId - Chart ID
 * @param {string} userId - User ID from auth headers
 * @param {string} requiredRole - Minimum role required (owner/editor/viewer)
 * @param {MongoClient} client - Cosmos DB client
 * @param {string} publicToken - Optional public access token
 */
async function canAccessChart(chartId, userId, requiredRole, client, publicToken = null) {
    const db = client.db('orgchart');
    const charts = db.collection('charts');

    // Fetch chart
    const chart = await charts.findOne({
        id: chartId,
        deleted: false  // Exclude soft-deleted charts
    });

    if (!chart) {
        return {
            allowed: false,
            reason: 'Chart not found',
            role: ROLES.NONE
        };
    }

    // Check public access with token
    if (publicToken && chart.permissions.public && chart.permissions.publicLinkToken === publicToken) {
        if (requiredRole === ROLES.VIEWER) {
            return {
                allowed: true,
                reason: 'Public access',
                role: ROLES.PUBLIC,
                chart: sanitizeChartForRole(chart, ROLES.PUBLIC)
            };
        } else {
            return {
                allowed: false,
                reason: 'Public access is view-only',
                role: ROLES.PUBLIC
            };
        }
    }

    // Require authentication for non-public access
    if (!userId) {
        return {
            allowed: false,
            reason: 'Authentication required',
            role: ROLES.NONE
        };
    }

    // Owner has full access
    if (chart.permissions.owner === userId) {
        return {
            allowed: true,
            reason: 'Owner access',
            role: ROLES.OWNER,
            chart: chart
        };
    }

    // Check editor access
    if (chart.permissions.editors && chart.permissions.editors.includes(userId)) {
        if (requiredRole === ROLES.OWNER) {
            return {
                allowed: false,
                reason: 'Owner access required',
                role: ROLES.EDITOR
            };
        }
        return {
            allowed: true,
            reason: 'Editor access',
            role: ROLES.EDITOR,
            chart: chart
        };
    }

    // Check viewer access
    if (chart.permissions.viewers && chart.permissions.viewers.includes(userId)) {
        if (requiredRole === ROLES.OWNER || requiredRole === ROLES.EDITOR) {
            return {
                allowed: false,
                reason: `${requiredRole} access required`,
                role: ROLES.VIEWER
            };
        }
        return {
            allowed: true,
            reason: 'Viewer access',
            role: ROLES.VIEWER,
            chart: sanitizeChartForRole(chart, ROLES.VIEWER)
        };
    }

    // No access
    return {
        allowed: false,
        reason: 'Insufficient permissions',
        role: ROLES.NONE
    };
}

/**
 * Remove sensitive fields based on user role
 */
function sanitizeChartForRole(chart, role) {
    const sanitized = { ...chart };

    // Public and viewer roles don't see full permissions
    if (role === ROLES.PUBLIC || role === ROLES.VIEWER) {
        delete sanitized.permissions.publicLinkToken;
        delete sanitized.permissions.editors;
        delete sanitized.permissions.viewers;
    }

    return sanitized;
}

/**
 * Generate random public access token
 */
function generatePublicToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

module.exports = {
    canAccessChart,
    sanitizeChartForRole,
    generatePublicToken,
    ROLES
};
```

---

### Refinement 5: Monitoring & Structured Logging

**File:** `api/shared/logger.js`
```javascript
const appInsights = require('applicationinsights');

// Initialize Application Insights
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    appInsights.setup()
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true)
        .setUseDiskRetryCaching(true)
        .start();
}

const client = appInsights.defaultClient;

/**
 * Structured logging for consistent observability
 * @param {string} level - Log level (INFO, WARN, ERROR)
 * @param {string} message - Log message
 * @param {Object} properties - Structured properties (userId, chartId, etc)
 */
function logStructured(level, message, properties = {}) {
    const timestamp = new Date().toISOString();

    const logEntry = {
        timestamp,
        level,
        message,
        environment: process.env.ENVIRONMENT_NAME || 'unknown',
        ...properties
    };

    // Console logging (captured by Azure Functions runtime)
    const logMethod = level === 'ERROR' ? console.error :
                     level === 'WARN' ? console.warn :
                     console.log;
    logMethod(JSON.stringify(logEntry));

    // Application Insights tracking
    if (client) {
        const commonProps = {
            level,
            environment: process.env.ENVIRONMENT_NAME,
            ...properties
        };

        if (level === 'ERROR') {
            const error = properties.error instanceof Error ?
                properties.error :
                new Error(message);
            client.trackException({
                exception: error,
                properties: commonProps
            });
        } else {
            client.trackEvent({
                name: message,
                properties: commonProps
            });
        }

        // Track custom metrics
        if (properties.latencyMs) {
            client.trackMetric({
                name: 'FunctionLatency',
                value: properties.latencyMs,
                properties: { action: properties.action }
            });
        }
    }
}

/**
 * Log function execution
 */
function logFunctionExecution(functionName, userId, startTime, success, error = null) {
    const latencyMs = Date.now() - startTime;

    logStructured(
        success ? 'INFO' : 'ERROR',
        `${functionName}_${success ? 'SUCCESS' : 'FAILED'}`,
        {
            function: functionName,
            userId,
            latencyMs,
            success,
            error: error?.message,
            stack: error?.stack
        }
    );
}

module.exports = {
    logStructured,
    logFunctionExecution
};
```

---

### Refinement 6: Backup & Disaster Recovery

**Enable Continuous Backup (Azure CLI):**
```bash
# Enable continuous backup on Cosmos DB (30-day point-in-time restore)
az cosmosdb update \
  --name orgchart-cosmos-prod \
  --resource-group orgchart-rg \
  --backup-policy-type Continuous \
  --continuous-tier Continuous30Days

# Verify backup is enabled
az cosmosdb show \
  --name orgchart-cosmos-prod \
  --resource-group orgchart-rg \
  --query "backupPolicy"
```

**Soft Delete Implementation:**

**File:** `api/DeleteChart/index.js` (excerpt)
```javascript
// Soft delete instead of hard delete
async function softDeleteChart(chartId, userId, client) {
    const db = client.db('orgchart');
    const charts = db.collection('charts');
    const deletedCharts = db.collection('deleted_charts');

    // Move to deleted_charts collection
    const chart = await charts.findOne({ id: chartId, ownerId: userId });

    if (!chart) {
        throw new Error('Chart not found or access denied');
    }

    // Copy to deleted_charts with deletion metadata
    await deletedCharts.insertOne({
        ...chart,
        deletedAt: new Date(),
        deletedBy: userId,
        originalId: chart._id,
        // Auto-delete after 90 days (TTL index)
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    });

    // Mark as deleted in main collection
    await charts.updateOne(
        { id: chartId, ownerId: userId },
        {
            $set: {
                deleted: true,
                deletedAt: new Date(),
                deletedBy: userId
            }
        }
    );

    return { success: true, recoverable: true, recoveryDeadline: '90 days' };
}
```

**Disaster Recovery Procedures:**

**RPO/RTO Targets:**
| Scenario | RPO | RTO | Procedure |
|----------|-----|-----|-----------|
| **Accidental deletion** | 0 (soft delete) | 5 minutes | Restore from `deleted_charts` |
| **Database corruption** | 5 minutes | 30 minutes | Point-in-time restore via Portal |
| **Region outage** | 5 minutes | 1 hour | Automatic failover (if geo-redundancy enabled) |

**Quarterly Restore Drill Checklist:**
```markdown
## Q1 2025 Restore Drill (January 15)

### Pre-Drill Setup
- [ ] Identify test chart for deletion
- [ ] Document current state (node count, last modified)
- [ ] Notify team of drill window

### Drill Execution
1. [ ] Delete test chart via UI
2. [ ] Verify soft delete in `deleted_charts` collection
3. [ ] Start timer
4. [ ] Restore chart using API or Portal
5. [ ] Stop timer, record RTO
6. [ ] Verify data integrity (compare node count, structure)

### Post-Drill
- [ ] Document actual RTO: _______
- [ ] Identify issues encountered
- [ ] Update runbook if needed
- [ ] Share results with team

**Target RTO:** 5 minutes
**Actual RTO:** _______
**Status:** ☐ Pass ☐ Fail
```

---

### Refinement 7: Security Scanning

**File:** `api/package.json`
```json
{
  "name": "orgchart-api",
  "version": "1.0.0",
  "description": "Azure Functions API for org chart",
  "scripts": {
    "start": "func start",
    "test": "jest",
    "lint": "eslint --ext .js .",
    "lint:security": "eslint --ext .js . --plugin security",
    "audit:deps": "npm audit --audit-level=moderate",
    "audit:secrets": "echo 'Running secret scan...' && trufflehog git file://. --only-verified",
    "security:full": "npm run lint:security && npm run audit:deps && npm run audit:secrets"
  },
  "dependencies": {
    "mongodb": "^6.3.0",
    "applicationinsights": "^2.9.1"
  },
  "devDependencies": {
    "eslint": "^8.56.0",
    "eslint-plugin-security": "^2.1.0",
    "@azure/functions": "^4.0.0"
  }
}
```

**File:** `.eslintrc.js`
```javascript
module.exports = {
    env: {
        node: true,
        es2021: true
    },
    extends: [
        'eslint:recommended',
        'plugin:security/recommended'
    ],
    plugins: ['security'],
    parserOptions: {
        ecmaVersion: 2021
    },
    rules: {
        // Security rules
        'security/detect-object-injection': 'error',
        'security/detect-non-literal-regexp': 'warn',
        'security/detect-unsafe-regex': 'error',
        'security/detect-buffer-noassert': 'error',
        'security/detect-child-process': 'error',
        'security/detect-disable-mustache-escape': 'error',
        'security/detect-eval-with-expression': 'error',
        'security/detect-no-csrf-before-method-override': 'error',
        'security/detect-non-literal-fs-filename': 'warn',
        'security/detect-non-literal-require': 'error',
        'security/detect-possible-timing-attacks': 'warn',
        'security/detect-pseudoRandomBytes': 'error',

        // General best practices
        'no-console': 'off',  // We use console for logging in Azure Functions
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'prefer-const': 'error',
        'no-var': 'error'
    }
};
```

**File:** `.github/workflows/security.yml`
```yaml
name: Security Scan

on:
  push:
    branches: [main, develop, staging]
  pull_request:
    branches: [main, develop]
  schedule:
    # Run weekly security scan
    - cron: '0 0 * * 0'

jobs:
  security:
    runs-on: ubuntu-latest
    name: Security Checks

    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0  # Full history for secret scanning

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Install Dependencies
        run: |
          cd api
          npm install

      - name: ESLint Security Check
        run: |
          cd api
          npm run lint:security

      - name: Dependency Audit
        run: |
          cd api
          npm audit --audit-level=high
        continue-on-error: true  # Don't fail build on advisories

      - name: Secret Scanning
        run: |
          pip install trufflehog
          trufflehog git file://. --since-commit HEAD~10 --only-verified --fail
        continue-on-error: false  # Always fail on secrets

      - name: OWASP ZAP Baseline Scan
        if: github.ref == 'refs/heads/develop'
        uses: zaproxy/action-baseline@v0.7.0
        with:
          target: 'https://orgchart-dev.azurestaticapps.net'
          rules_file_name: '.zap/rules.tsv'
          cmd_options: '-a'

      - name: Upload ZAP Report
        if: github.ref == 'refs/heads/develop'
        uses: actions/upload-artifact@v2
        with:
          name: zap-report
          path: report_html.html
```

---

### Refinement 8: Future Graph Integration Readiness

**File:** `api/shared/graphClient.js` (Placeholder)
```javascript
/**
 * Microsoft Graph API client (future implementation)
 *
 * Use cases:
 * 1. Check Azure AD group membership for chart permissions
 * 2. Auto-populate org charts from directory
 * 3. Fetch user profile photos
 * 4. Validate group IDs when sharing
 */

const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');

let graphClient = null;

/**
 * Initialize Graph client with Managed Identity
 * (To be implemented when Azure AD group support is needed)
 */
async function getGraphClient() {
    if (graphClient) {
        return graphClient;
    }

    // TODO: Implement when needed
    // Option 1: Use Azure Functions Managed Identity
    // Option 2: Use On-Behalf-Of flow with user's access token

    throw new Error('Microsoft Graph integration not yet enabled');
}

/**
 * Check if user is member of Azure AD group (transitive)
 * @param {string} userId - User object ID
 * @param {string} groupId - Group object ID
 */
async function checkGroupMembership(userId, groupId) {
    const client = await getGraphClient();

    try {
        const response = await client
            .api(`/users/${userId}/transitiveMemberOf`)
            .get();

        return response.value.some(group => group.id === groupId);
    } catch (error) {
        console.error('Group membership check failed:', error);
        return false;
    }
}

/**
 * Get user's basic profile (name, email, photo)
 */
async function getUserProfile(userId) {
    const client = await getGraphClient();

    const profile = await client
        .api(`/users/${userId}`)
        .select('displayName,mail,userPrincipalName')
        .get();

    return profile;
}

module.exports = {
    getGraphClient,
    checkGroupMembership,
    getUserProfile
};
```

**When to implement:**
- User requests: "Share chart with 'All Employees' Azure AD group"
- Need to validate group IDs before adding to permissions
- Auto-populate org chart from company directory

---

## 6. Complete API Implementation

### GetCharts Function

**File:** `api/GetCharts/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get"],
      "route": "v1/charts"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**File:** `api/GetCharts/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { checkRateLimit } = require('../shared/rateLimiter');
const { logStructured, logFunctionExecution } = require('../shared/logger');

/**
 * GET /api/charts
 * List all charts owned by or shared with the authenticated user
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const userId = req.headers['x-ms-client-principal-id'];
    const userEmail = req.headers['x-ms-client-principal-name'];

    // Authentication check
    if (!userId) {
        context.res = {
            status: 401,
            body: { error: 'Authentication required' }
        };
        return;
    }

    logStructured('INFO', 'GET_CHARTS_STARTED', {
        userId,
        userEmail,
        requestId: context.invocationId
    });

    try {
        const client = await getCosmosClient();

        // Rate limiting
        const rateCheck = await checkRateLimit(userId, 'GET_CHARTS', client);
        if (!rateCheck.allowed) {
            logStructured('WARN', 'RATE_LIMIT_EXCEEDED', {
                userId,
                action: 'GET_CHARTS',
                limit: rateCheck.limit,
                current: rateCheck.current
            });

            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: {
                    error: rateCheck.message,
                    retryAfter: rateCheck.retryAfter
                }
            };
            return;
        }

        const db = client.db('orgchart');
        const charts = db.collection('charts');

        // Query charts where user is owner, editor, or viewer
        const userCharts = await charts.find({
            $or: [
                { 'permissions.owner': userId },
                { 'permissions.editors': userId },
                { 'permissions.viewers': userId }
            ],
            deleted: false  // Exclude soft-deleted charts
        })
        .project({
            id: 1,
            name: 1,
            lastModified: 1,
            createdAt: 1,
            sizeBytes: 1,
            'permissions.owner': 1,
            'data.nodes': { $size: '$data.nodes' }  // Just count, not full data
        })
        .sort({ lastModified: -1 })
        .limit(100)  // Prevent massive responses
        .toArray();

        // Determine user's role for each chart
        const chartsWithRoles = userCharts.map(chart => ({
            ...chart,
            role: chart.permissions.owner === userId ? 'owner' :
                  chart.permissions.editors?.includes(userId) ? 'editor' : 'viewer',
            nodeCount: chart.data?.nodes || 0
        }));

        logFunctionExecution('GetCharts', userId, startTime, true);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            },
            body: {
                charts: chartsWithRoles,
                count: chartsWithRoles.length,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logFunctionExecution('GetCharts', userId, startTime, false, error);

        context.res = {
            status: 500,
            body: { error: 'Failed to fetch charts' }
        };
    }
};
```

---

### GetChart Function (Single Chart)

**File:** `api/GetChart/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get"],
      "route": "v1/charts/{chartId}"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**File:** `api/GetChart/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { logStructured, logFunctionExecution } = require('../shared/logger');

/**
 * GET /api/charts/{chartId}
 * Get single chart with full data
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const userId = req.headers['x-ms-client-principal-id'];
    const chartId = req.params.chartId;
    const publicToken = req.query.token;  // For public link access

    if (!chartId) {
        context.res = {
            status: 400,
            body: { error: 'Chart ID required' }
        };
        return;
    }

    logStructured('INFO', 'GET_CHART_STARTED', {
        userId: userId || 'anonymous',
        chartId,
        hasPublicToken: !!publicToken
    });

    try {
        const client = await getCosmosClient();

        // Authorization check
        const authResult = await canAccessChart(
            chartId,
            userId,
            ROLES.VIEWER,  // Minimum role required
            client,
            publicToken
        );

        if (!authResult.allowed) {
            logStructured('WARN', 'ACCESS_DENIED', {
                userId,
                chartId,
                reason: authResult.reason
            });

            context.res = {
                status: 403,
                body: { error: authResult.reason }
            };
            return;
        }

        logFunctionExecution('GetChart', userId, startTime, true);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, max-age=60'  // Cache for 1 minute
            },
            body: {
                chart: authResult.chart,
                yourRole: authResult.role,
                canEdit: authResult.role === ROLES.OWNER || authResult.role === ROLES.EDITOR
            }
        };

    } catch (error) {
        logFunctionExecution('GetChart', userId, startTime, false, error);

        context.res = {
            status: 500,
            body: { error: 'Failed to fetch chart' }
        };
    }
};
```

---

### SaveChart Function

**File:** `api/SaveChart/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "put"],
      "route": "v1/charts/{chartId?}"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**File:** `api/SaveChart/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { validateChartPayload, sanitizeChartName } = require('../shared/validation');
const { checkRateLimit } = require('../shared/rateLimiter');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { logStructured, logFunctionExecution } = require('../shared/logger');

/**
 * POST /api/charts (create new)
 * PUT /api/charts/{chartId} (update existing)
 *
 * Save or update a chart
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const userId = req.headers['x-ms-client-principal-id'];
    const userEmail = req.headers['x-ms-client-principal-name'];
    const chartId = req.params.chartId || req.body?.id;
    const isUpdate = !!req.params.chartId;

    // Authentication required
    if (!userId) {
        context.res = {
            status: 401,
            body: { error: 'Authentication required' }
        };
        return;
    }

    logStructured('INFO', 'SAVE_CHART_STARTED', {
        userId,
        chartId,
        isUpdate,
        payloadSize: JSON.stringify(req.body).length
    });

    try {
        const client = await getCosmosClient();

        // Rate limiting
        const rateCheck = await checkRateLimit(userId, 'SAVE_CHART', client);
        if (!rateCheck.allowed) {
            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: { error: rateCheck.message }
            };
            return;
        }

        // Input validation
        const validation = validateChartPayload(req.body);
        if (!validation.valid) {
            logStructured('WARN', 'VALIDATION_FAILED', {
                userId,
                chartId,
                errors: validation.errors
            });

            context.res = {
                status: 400,
                body: {
                    error: 'Validation failed',
                    details: validation.errors
                }
            };
            return;
        }

        // For updates, check if user has edit permission
        if (isUpdate) {
            const authResult = await canAccessChart(
                chartId,
                userId,
                ROLES.EDITOR,  // Require editor or owner role
                client
            );

            if (!authResult.allowed) {
                context.res = {
                    status: 403,
                    body: { error: authResult.reason }
                };
                return;
            }
        }

        const db = client.db('orgchart');
        const charts = db.collection('charts');

        const now = new Date();
        const chartData = {
            id: chartId,
            name: sanitizeChartName(req.body.name),
            lastModified: now,
            data: req.body.data,
            sizeBytes: JSON.stringify(req.body).length
        };

        if (isUpdate) {
            // Update existing chart
            const result = await charts.updateOne(
                { id: chartId },
                {
                    $set: chartData,
                    $inc: { version: 1 }  // Increment version
                }
            );

            if (result.matchedCount === 0) {
                context.res = {
                    status: 404,
                    body: { error: 'Chart not found' }
                };
                return;
            }
        } else {
            // Create new chart
            await charts.insertOne({
                ...chartData,
                ownerId: userId,  // Partition key
                createdAt: now,
                createdBy: userEmail,
                permissions: {
                    owner: userId,
                    editors: [],
                    viewers: [],
                    public: false,
                    publicLinkToken: null
                },
                version: 1,
                deleted: false
            });
        }

        logFunctionExecution('SaveChart', userId, startTime, true);

        context.res = {
            status: isUpdate ? 200 : 201,
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                success: true,
                chartId: chartId,
                message: isUpdate ? 'Chart updated' : 'Chart created',
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logFunctionExecution('SaveChart', userId, startTime, false, error);

        context.res = {
            status: 500,
            body: { error: 'Failed to save chart' }
        };
    }
};
```

---

### DeleteChart Function

**File:** `api/DeleteChart/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["delete"],
      "route": "v1/charts/{chartId}"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**File:** `api/DeleteChart/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { canAccessChart, ROLES } = require('../shared/authorization');
const { checkRateLimit } = require('../shared/rateLimiter');
const { logStructured, logFunctionExecution } = require('../shared/logger');

/**
 * DELETE /api/charts/{chartId}
 * Soft delete a chart (recoverable for 90 days)
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const userId = req.headers['x-ms-client-principal-id'];
    const chartId = req.params.chartId;

    if (!userId) {
        context.res = {
            status: 401,
            body: { error: 'Authentication required' }
        };
        return;
    }

    if (!chartId) {
        context.res = {
            status: 400,
            body: { error: 'Chart ID required' }
        };
        return;
    }

    logStructured('INFO', 'DELETE_CHART_STARTED', {
        userId,
        chartId
    });

    try {
        const client = await getCosmosClient();

        // Rate limiting
        const rateCheck = await checkRateLimit(userId, 'DELETE_CHART', client);
        if (!rateCheck.allowed) {
            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: { error: rateCheck.message }
            };
            return;
        }

        // Only owner can delete
        const authResult = await canAccessChart(
            chartId,
            userId,
            ROLES.OWNER,
            client
        );

        if (!authResult.allowed) {
            context.res = {
                status: 403,
                body: { error: 'Only chart owner can delete' }
            };
            return;
        }

        const db = client.db('orgchart');
        const charts = db.collection('charts');
        const deletedCharts = db.collection('deleted_charts');

        const chart = authResult.chart;

        // Copy to deleted_charts (with 90-day TTL)
        await deletedCharts.insertOne({
            ...chart,
            deletedAt: new Date(),
            deletedBy: userId,
            originalId: chart._id,
            // TTL index will auto-delete after 90 days
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        });

        // Mark as deleted in main collection
        await charts.updateOne(
            { id: chartId },
            {
                $set: {
                    deleted: true,
                    deletedAt: new Date(),
                    deletedBy: userId
                }
            }
        );

        logFunctionExecution('DeleteChart', userId, startTime, true);

        context.res = {
            status: 200,
            body: {
                success: true,
                message: 'Chart deleted',
                recoverable: true,
                recoveryDeadline: '90 days',
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logFunctionExecution('DeleteChart', userId, startTime, false, error);

        context.res = {
            status: 500,
            body: { error: 'Failed to delete chart' }
        };
    }
};
```

---

### ShareChart Function

**File:** `api/ShareChart/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post"],
      "route": "v1/charts/{chartId}/share"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**File:** `api/ShareChart/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { canAccessChart, generatePublicToken, ROLES } = require('../shared/authorization');
const { checkRateLimit } = require('../shared/rateLimiter');
const { logStructured, logFunctionExecution } = require('../shared/logger');

/**
 * POST /api/charts/{chartId}/share
 * Manage chart sharing permissions
 *
 * Body: {
 *   action: 'add_editor' | 'add_viewer' | 'remove_access' | 'enable_public' | 'disable_public',
 *   targetUserId: 'user-guid' (for add/remove),
 *   targetRole: 'editor' | 'viewer' (for add)
 * }
 */
module.exports = async function (context, req) {
    const startTime = Date.now();
    const userId = req.headers['x-ms-client-principal-id'];
    const chartId = req.params.chartId;
    const { action, targetUserId, targetRole } = req.body || {};

    if (!userId) {
        context.res = {
            status: 401,
            body: { error: 'Authentication required' }
        };
        return;
    }

    if (!chartId || !action) {
        context.res = {
            status: 400,
            body: { error: 'Chart ID and action required' }
        };
        return;
    }

    logStructured('INFO', 'SHARE_CHART_STARTED', {
        userId,
        chartId,
        action,
        targetUserId
    });

    try {
        const client = await getCosmosClient();

        // Rate limiting
        const rateCheck = await checkRateLimit(userId, 'SHARE_CHART', client);
        if (!rateCheck.allowed) {
            context.res = {
                status: 429,
                headers: { 'Retry-After': rateCheck.retryAfter.toString() },
                body: { error: rateCheck.message }
            };
            return;
        }

        // Only owner can manage sharing
        const authResult = await canAccessChart(
            chartId,
            userId,
            ROLES.OWNER,
            client
        );

        if (!authResult.allowed) {
            context.res = {
                status: 403,
                body: { error: 'Only chart owner can manage sharing' }
            };
            return;
        }

        const db = client.db('orgchart');
        const charts = db.collection('charts');

        let updateOperation = {};

        switch (action) {
            case 'add_editor':
                if (!targetUserId) {
                    context.res = {
                        status: 400,
                        body: { error: 'targetUserId required' }
                    };
                    return;
                }
                updateOperation = {
                    $addToSet: { 'permissions.editors': targetUserId },
                    $pull: { 'permissions.viewers': targetUserId }  // Remove from viewers if present
                };
                break;

            case 'add_viewer':
                if (!targetUserId) {
                    context.res = {
                        status: 400,
                        body: { error: 'targetUserId required' }
                    };
                    return;
                }
                updateOperation = {
                    $addToSet: { 'permissions.viewers': targetUserId }
                };
                break;

            case 'remove_access':
                if (!targetUserId) {
                    context.res = {
                        status: 400,
                        body: { error: 'targetUserId required' }
                    };
                    return;
                }
                updateOperation = {
                    $pull: {
                        'permissions.editors': targetUserId,
                        'permissions.viewers': targetUserId
                    }
                };
                break;

            case 'enable_public':
                const token = generatePublicToken();
                updateOperation = {
                    $set: {
                        'permissions.public': true,
                        'permissions.publicLinkToken': token
                    }
                };
                break;

            case 'disable_public':
                updateOperation = {
                    $set: {
                        'permissions.public': false,
                        'permissions.publicLinkToken': null
                    }
                };
                break;

            default:
                context.res = {
                    status: 400,
                    body: { error: 'Invalid action' }
                };
                return;
        }

        const result = await charts.updateOne(
            { id: chartId },
            updateOperation
        );

        if (result.matchedCount === 0) {
            context.res = {
                status: 404,
                body: { error: 'Chart not found' }
            };
            return;
        }

        // Fetch updated chart to return public link if enabled
        const updatedChart = await charts.findOne({ id: chartId });
        const publicLink = updatedChart.permissions.public ?
            `${process.env.BASE_URL}/chart/${chartId}?token=${updatedChart.permissions.publicLinkToken}` :
            null;

        logFunctionExecution('ShareChart', userId, startTime, true);

        context.res = {
            status: 200,
            body: {
                success: true,
                message: 'Permissions updated',
                publicLink: publicLink,
                remaining: rateCheck.remaining
            }
        };

    } catch (error) {
        logFunctionExecution('ShareChart', userId, startTime, false, error);

        context.res = {
            status: 500,
            body: { error: 'Failed to update permissions' }
        };
    }
};
```

---

## 7. Database Schema

### Collections Overview

```javascript
// Database: orgchart

// Collection: charts (main data)
{
  _id: ObjectId,           // Cosmos DB internal ID
  id: String,              // User-facing ID (UUID)
  ownerId: String,         // Partition key (Azure AD user ID)
  name: String,
  createdAt: Date,
  lastModified: Date,
  sizeBytes: Number,
  permissions: {
    owner: String,
    editors: [String],
    viewers: [String],
    public: Boolean,
    publicLinkToken: String
  },
  data: {
    nodes: [Object],
    layout: String,
    theme: String
  },
  version: Number,
  deleted: Boolean,
  deletedAt: Date,
  deletedBy: String
}

// Collection: rate_limits (ephemeral)
{
  userId: String,
  action: String,
  timestamp: Date,
  expiresAt: Date          // TTL index
}

// Collection: deleted_charts (90-day recovery)
{
  ...chart,               // All fields from original chart
  deletedAt: Date,
  deletedBy: String,
  originalId: ObjectId,
  expiresAt: Date         // TTL index (90 days)
}
```

### Index Strategy

```javascript
// Create indexes (run once during setup)
async function createIndexes() {
    const client = await getCosmosClient();
    const db = client.db('orgchart');

    // charts collection
    await db.collection('charts').createIndexes([
        // Partition key (automatic in Cosmos DB)
        { key: { ownerId: 1 } },

        // Query by ID
        { key: { id: 1 }, unique: true },

        // Find shared charts
        { key: { 'permissions.editors': 1 } },
        { key: { 'permissions.viewers': 1 } },

        // List non-deleted charts
        { key: { deleted: 1, lastModified: -1 } }
    ]);

    // rate_limits collection
    await db.collection('rate_limits').createIndexes([
        // TTL index (auto-delete expired entries)
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },

        // Query by user and action
        { key: { userId: 1, action: 1, timestamp: 1 } }
    ]);

    // deleted_charts collection
    await db.collection('deleted_charts').createIndexes([
        // TTL index (90-day retention)
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },

        // Query by owner for recovery
        { key: { deletedBy: 1, deletedAt: -1 } }
    ]);
}
```

---

## 8. Authentication & Authorization

### Built-in SWA Authentication

**Login Flow:**
```
1. User clicks "Login" → redirect to /.auth/login/aad
2. Azure AD login page
3. User authenticates
4. Redirect back to app with session cookie
5. All subsequent requests include auth headers:
   - x-ms-client-principal-id (User GUID)
   - x-ms-client-principal-name (Email)
```

### Configuring Azure AD (Entra ID) Authentication

**Step-by-Step Azure Portal Configuration:**

1. **Navigate to your Static Web App**
   - Azure Portal → Resource Groups → `orgchart-rg` → `orgchart-prod`

2. **Open Authentication Settings**
   - Left sidebar → **Settings** → **Authentication**
   - Or search for "Authentication" in the resource search bar

3. **Add Identity Provider**
   - Click **+ Add provider** button
   - Select **Microsoft** from the dropdown

4. **Configure Provider Settings**

   **Option A: Quick Setup (Recommended for Most Cases)**
   ```
   Provider: Microsoft
   App registration type: Create new app registration
   Name: Org Chart App
   Supported account types: Current tenant - Single tenant

   ✅ Click "Add"
   ```

   This automatically creates:
   - Azure AD App Registration
   - Client ID and secret
   - Redirect URIs
   - Required API permissions

   **Option B: Use Existing App Registration (Advanced)**
   ```
   If you already have an App Registration:

   1. Get your Application (client) ID from Azure AD
   2. Create a client secret in the App Registration
   3. Add redirect URI: https://YOUR-SWA-NAME.azurestaticapps.net/.auth/login/aad/callback
   4. In SWA, select "Provide the details of an existing app registration"
   5. Enter:
      - Application (client) ID: (from step 1)
      - Client secret: (from step 2)
      - Tenant ID: (from Azure AD)
   ```

5. **Configure Allowed External Redirect URLs (Optional)**
   - If using custom domains, add them here
   - Example: `https://orgchart.company.com/.auth/login/aad/callback`

6. **Test Authentication**
   - Navigate to: `https://YOUR-SWA-NAME.azurestaticapps.net/.auth/login/aad`
   - You should be redirected to Microsoft sign-in page
   - After sign-in, you should be redirected back to your app

**Verification Steps:**

```bash
# Test /.auth/me endpoint
curl https://YOUR-SWA-NAME.azurestaticapps.net/.auth/me

# Expected response (when authenticated):
{
  "clientPrincipal": {
    "identityProvider": "aad",
    "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "userDetails": "user@company.com",
    "userRoles": ["authenticated", "anonymous"],
    "claims": [...]
  }
}
```

**Common Authentication Issues:**

| Issue | Solution |
|-------|----------|
| **Redirect loop** | Check redirect URI matches exactly (including https://) |
| **"AADSTS50011" error** | Reply URL mismatch - verify in App Registration |
| **Users outside tenant can access** | Change to "Single tenant" in App Registration |
| **/.auth/me returns null** | Session cookie not set - check browser dev tools |

**Frontend Integration:**

**File:** `app/js/auth.js`
```javascript
/**
 * Check if user is authenticated
 */
async function checkAuth() {
    try {
        const response = await fetch('/.auth/me');
        const payload = await response.json();

        if (payload.clientPrincipal) {
            return {
                authenticated: true,
                userId: payload.clientPrincipal.userId,
                userDetails: payload.clientPrincipal.userDetails,
                identityProvider: payload.clientPrincipal.identityProvider,
                claims: payload.clientPrincipal.claims
            };
        }

        return { authenticated: false };
    } catch (error) {
        console.error('Auth check failed:', error);
        return { authenticated: false };
    }
}

/**
 * Redirect to login
 */
function login() {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' +
        encodeURIComponent(window.location.pathname);
}

/**
 * Logout
 */
function logout() {
    window.location.href = '/.auth/logout';
}

/**
 * Initialize auth on page load
 */
async function initAuth() {
    const auth = await checkAuth();

    if (!auth.authenticated) {
        // Show login prompt
        document.getElementById('loginPrompt').style.display = 'block';
        document.getElementById('appContent').style.display = 'none';
    } else {
        // User is logged in, show app
        document.getElementById('loginPrompt').style.display = 'none';
        document.getElementById('appContent').style.display = 'block';
        document.getElementById('userEmail').textContent = auth.userDetails;

        // Store user info for API calls
        window.currentUser = auth;
    }
}

// Run on page load
document.addEventListener('DOMContentLoaded', initAuth);
```

---

## 9. Deployment Guide

### Prerequisites
1. Azure subscription
2. GitHub account
3. Azure CLI installed (optional, but recommended)
4. Node.js 18+ installed locally

### Step 1: Local Development Setup

```bash
# Clone your repo
cd org-chart

# Install Azure SWA CLI
npm install -g @azure/static-web-apps-cli

# Create API folder structure
mkdir -p api/shared
mkdir -p api/GetCharts api/GetChart api/SaveChart api/DeleteChart api/ShareChart

# Install API dependencies
cd api
npm init -y
npm install mongodb applicationinsights

# Install dev dependencies
npm install --save-dev eslint eslint-plugin-security @azure/functions

# Return to root
cd ..
```

### Step 2: Local Testing

```bash
# Start local development server
# This simulates the full Azure SWA environment with auth
swa start app --api-location api --port 8080

# Opens http://localhost:8080
# You'll see a fake login screen for testing
```

### Step 3: Create Azure Resources

**Option A: Azure Portal (GUI)**

1. Go to [Azure Portal](https://portal.azure.com)
2. Create Resource → "Static Web App"
3. Basics:
   - Subscription: Your subscription
   - Resource Group: Create new "orgchart-rg"
   - Name: "orgchart-prod"
   - Region: East US 2
   - Plan: Free (start here, upgrade to Standard if needed)
4. Deployment:
   - Source: GitHub
   - Organization: Your GitHub username
   - Repository: org-chart
   - Branch: main
   - Build Presets: Custom
   - App location: `/app`
   - API location: `/api`
   - Output location: `` (leave empty)
5. Review + Create

**Option B: Azure CLI (Automated)**

```bash
# Login to Azure
az login

# Create resource group
az group create --name orgchart-rg --location eastus2

# Create Cosmos DB (Serverless)
az cosmosdb create \
  --name orgchart-cosmos-prod \
  --resource-group orgchart-rg \
  --locations regionName=eastus2 \
  --kind MongoDB \
  --server-version 4.2 \
  --capabilities EnableServerless \
  --backup-policy-type Continuous

# Get Cosmos DB connection string
az cosmosdb keys list \
  --name orgchart-cosmos-prod \
  --resource-group orgchart-rg \
  --type connection-strings \
  --query "connectionStrings[0].connectionString" \
  --output tsv

# Create Static Web App
az staticwebapp create \
  --name orgchart-prod \
  --resource-group orgchart-rg \
  --source https://github.com/YOUR_USERNAME/org-chart \
  --location eastus2 \
  --branch main \
  --app-location "/app" \
  --api-location "/api" \
  --login-with-github
```

### Step 4: Configure Application Settings

In Azure Portal:
1. Go to Static Web App → Configuration → Application settings
2. Add settings:

```
COSMOS_CONNECTION_STRING=mongodb://orgchart-cosmos-prod:...
ENVIRONMENT_NAME=production
MAX_CHART_SIZE=5242880
APPLICATIONINSIGHTS_CONNECTION_STRING=(get from App Insights resource)
BASE_URL=https://orgchart-prod.azurestaticapps.net
```

### Step 5: Configure Azure AD Authentication

In Azure Portal:
1. Static Web App → Authentication
2. Identity Provider: Azure Active Directory
3. Choose:
   - **Option A (Easier):** Use default Azure AD config (allows any user in your tenant)
   - **Option B (Restricted):** Create custom App Registration (for specific user control)

**Option B Steps:**
```bash
# Create Azure AD app registration
az ad app create \
  --display-name "Org Chart App" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://orgchart-prod.azurestaticapps.net/.auth/login/aad/callback"

# Note the Application (client) ID and configure in SWA
```

### Step 6: Initialize Database

Create a one-time setup function:

**File:** `api/Setup/index.js`
```javascript
const { getCosmosClient } = require('../shared/cosmos');
const { createRateLimitIndexes } = require('../shared/rateLimiter');

module.exports = async function (context, req) {
    // Protect this endpoint
    const setupKey = req.query.setupKey;
    if (setupKey !== process.env.SETUP_KEY) {
        context.res = { status: 403, body: 'Forbidden' };
        return;
    }

    try {
        const client = await getCosmosClient();

        // Create indexes
        await createRateLimitIndexes(client);

        // Create initial collections
        const db = client.db('orgchart');
        await db.createCollection('charts');
        await db.createCollection('deleted_charts');

        context.res = {
            status: 200,
            body: { success: true, message: 'Database initialized' }
        };
    } catch (error) {
        context.res = {
            status: 500,
            body: { error: error.message }
        };
    }
};
```

Call once after deployment:
```bash
curl "https://orgchart-prod.azurestaticapps.net/api/setup?setupKey=YOUR_SECRET_KEY"
```

### Step 7: Verify Deployment

1. Visit https://orgchart-prod.azurestaticapps.net
2. Click "Login"
3. Authenticate with Azure AD
4. Create a test chart
5. Check Application Insights for logs

---

## 10. Monitoring & Observability

### 10.1 Application Insights Setup
1.  Create **Application Insights** resource in Azure.
2.  Copy **Connection String**.
3.  Add to SWA **Configuration** > **Application Settings**:
    *   `APPLICATIONINSIGHTS_CONNECTION_STRING` = `<your-connection-string>`

### 10.2 Debugging with Log Analytics (Kusto Queries)

**Find recent errors:**
```kusto
exceptions
| where timestamp > ago(24h)
| order by timestamp desc
| project timestamp, problemId, outerMessage, customDimensions
```

**Monitor API Performance (Latency):**
```kusto
requests
| where timestamp > ago(24h)
| where name startswith "GET" or name startswith "POST"
| summarize p95_duration = percentile(duration, 95), count() by name
| order by p95_duration desc
```

**Trace a specific user session:**
```kusto
traces
| where customDimensions.userId == "specific-user-guid"
| order by timestamp desc
```

### Alerts Configuration

```bash
# Alert on high error rate
az monitor metrics alert create \
  --name high-error-rate \
  --resource-group orgchart-rg \
  --scopes /subscriptions/.../resourceGroups/orgchart-rg/providers/Microsoft.Web/sites/orgchart-prod \
  --condition "avg requests/failed > 10" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action email-oncall@company.com

# Alert on slow API responses
az monitor metrics alert create \
  --name slow-api-response \
  --resource-group orgchart-rg \
  --scopes /subscriptions/.../resourceGroups/orgchart-rg/providers/Microsoft.Web/sites/orgchart-prod \
  --condition "avg requests/duration > 2000" \
  --window-size 10m \
  --evaluation-frequency 5m
```

---

## 11. Security Implementation

### Security Checklist

- [x] Authentication: Built-in Azure AD (zero-code)
- [x] Authorization: Chart-level permissions (owner/editor/viewer)
- [x] Input Validation: Payload size, node count, required fields
- [x] Rate Limiting: Per-user, per-action limits
- [x] SQL Injection: N/A (using MongoDB with parameterized queries)
- [x] XSS Prevention: Chart names sanitized, CSP headers
- [x] CSRF Protection: Built-in with SWA session cookies
- [x] Secret Management: Connection strings in App Settings (not code)
- [x] HTTPS: Automatic with SWA (free SSL)
- [x] Security Headers: X-Frame-Options, X-Content-Type-Options
- [x] Dependency Scanning: npm audit in CI/CD
- [x] Secret Scanning: TruffleHog in GitHub Actions
- [x] Static Analysis: ESLint security plugin
- [x] OWASP ZAP: Baseline scan on staging

### Security Testing Timeline

**When security testing happens during the 3-week implementation:**

| Week | Milestone | Security Activity | Blocker? |
|------|-----------|-------------------|----------|
| **Week 1** | Local Development | • Secret scanning (TruffleHog pre-commit hook)<br>• ESLint security plugin in IDE | ❌ Non-blocking |
| **Week 2** | Database Integration | • Dependency audit (`npm audit`)<br>• Static analysis in CI (blocks PR merge)<br>• OWASP ZAP baseline on develop branch | ⚠️ Blocks PR if critical |
| **Week 3 - Day 1-2** | Pre-Deployment | • **OWASP ZAP full scan on staging**<br>• Penetration test (external firm, optional)<br>• Fix all high/critical findings | ✅ **Blocks production deployment** |
| **Week 3 - Day 3** | Production Go-Live | • Final security sign-off<br>• Enable security monitoring | Required for launch |
| **Post-Launch** | Ongoing | • Weekly npm audit<br>• Quarterly pen test<br>• Continuous secret scanning | Ongoing |

**Security Gate Criteria:**

Before deploying to **production**, all of the following must pass:

```
✅ No critical/high npm audit findings
✅ OWASP ZAP scan shows 0 high-risk issues
✅ No secrets in git history (TruffleHog clean)
✅ ESLint security rules passing
✅ External pen test completed (if budget allows)
✅ Security sign-off from team lead
```

**OWASP ZAP Scan Schedule:**

```bash
# Week 2: Automated baseline scan on every commit to develop
# Runs in GitHub Actions (see .github/workflows/security.yml)
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://orgchart-dev.azurestaticapps.net \
  -r zap_report.html

# Week 3 Day 1: Full scan before production (manual trigger)
docker run -t owasp/zap2docker-stable zap-full-scan.py \
  -t https://orgchart-staging.azurestaticapps.net \
  -r zap_full_report.html \
  -I  # Fail on warnings
```

**External Penetration Test (Optional but Recommended):**

If budget allows (~$2,000-$5,000), hire external firm for:
- Week 3 Day 1-2 (before production)
- Scope: Authentication, API endpoints, data access controls
- Deliverable: Report with findings + remediation plan
- Timeline: 2 days testing + 1 day report

Recommended firms: [Cobalt.io](https://cobalt.io), [Synack](https://www.synack.com), [HackerOne](https://www.hackerone.com)

### Content Security Policy

Add to `staticwebapp.config.json`:
```json
{
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.azurestaticapps.net https://*.applicationinsights.azure.com"
  }
}
```

---

## 12. Disaster Recovery

### Backup Strategy

| Backup Type | Frequency | Retention | Storage |
|-------------|-----------|-----------|---------|
| **Continuous Backup** | Every 5 minutes | 30 days | Cosmos DB (built-in) |
| **Soft Deletes** | On deletion | 90 days | deleted_charts collection |
| **Database Snapshot** | Manual | As needed | Cosmos DB restore points |

### Recovery Procedures

**Scenario 1: User Accidentally Deletes Chart**

```javascript
// Restore from deleted_charts collection
async function restoreDeletedChart(chartId, userId, client) {
    const db = client.db('orgchart');
    const charts = db.collection('charts');
    const deletedCharts = db.collection('deleted_charts');

    const deletedChart = await deletedCharts.findOne({
        id: chartId,
        deletedBy: userId
    });

    if (!deletedChart) {
        throw new Error('Chart not found in deleted_charts');
    }

    // Remove deletion metadata
    delete deletedChart.deletedAt;
    delete deletedChart.deletedBy;
    delete deletedChart.expiresAt;
    delete deletedChart.originalId;

    // Restore to main collection
    await charts.updateOne(
        { id: chartId },
        {
            $set: {
                ...deletedChart,
                deleted: false,
                deletedAt: null,
                deletedBy: null
            }
        },
        { upsert: true }
    );

    return { success: true, message: 'Chart restored' };
}
```

**Scenario 2: Database Corruption**

```bash
# Point-in-time restore via Azure Portal
# 1. Go to Cosmos DB → Backup & Restore
# 2. Select restore point (any time in last 30 days)
# 3. Choose target account name (create new)
# 4. Restore takes ~1-2 hours
# 5. Update connection string in SWA config
# 6. Restart functions
```

**Scenario 3: Region Outage**

If Cosmos DB has geo-redundancy enabled:
```bash
# Automatic failover to secondary region
# Manual failover (if needed):
az cosmosdb failover-priority-change \
  --name orgchart-cosmos-prod \
  --resource-group orgchart-rg \
  --failover-policies eastus2=0 westus2=1
```

### Quarterly Disaster Recovery Drill Schedule

**Purpose:** Ensure team can execute recovery procedures within RPO/RTO targets.

**Drill Calendar:**

| Quarter | Date | Scenario | Owner | Success Criteria |
|---------|------|----------|-------|------------------|
| **Q1** | January 15 | Soft Delete Restore | SRE Team Lead | Chart restored < 5 min |
| **Q2** | April 15 | Point-in-Time Restore | Platform Engineer | Database restored < 30 min, data validated |
| **Q3** | July 15 | Full DB Corruption | DevOps Lead | Complete restore < 2 hours |
| **Q4** | October 15 | Region Failover (simulated) | Cloud Architect | Failover < 1 hour, no data loss |

**Drill Execution Template:**

```markdown
## DR Drill Report: Q1 2025 (Soft Delete Restore)

**Date:** January 15, 2025
**Scenario:** Accidental chart deletion by user
**Owner:** Jane Smith (SRE Team Lead)
**Participants:** 3 engineers

### Pre-Drill
- [ ] Select test chart for deletion (Chart ID: chart_test_q1)
- [ ] Document current state (50 nodes, last modified Jan 10)
- [ ] Notify team of drill window (2 PM - 3 PM)

### Execution
1. **Delete Chart** (2:00 PM)
   - User deleted via UI
   - Confirmed in `deleted_charts` collection

2. **Start Recovery** (2:05 PM)
   - Executed restore function
   - Monitored logs in Application Insights

3. **Verify Restore** (2:08 PM)
   - Chart visible in UI
   - Node count: 50 ✅
   - Data integrity: Passed ✅

### Results
- **Actual RTO:** 8 minutes ✅ (Target: < 15 min)
- **RPO:** 0 (soft delete) ✅
- **Issues:** None

### Action Items
- [x] Update runbook with actual times
- [ ] Add automated restore endpoint for support team
- [ ] Schedule next drill (Q2: Point-in-Time Restore)

**Status:** ✅ PASS
**Sign-off:** Jane Smith, SRE Team Lead
```

**Post-Drill Actions:**
1. Update runbooks based on lessons learned
2. Address any issues discovered during drill
3. Share drill report with leadership
4. Schedule next quarter's drill

**Drill Metrics Tracking:**

| Drill | Target RTO | Actual RTO | Target RPO | Actual RPO | Pass/Fail |
|-------|-----------|-----------|-----------|-----------|-----------|
| Q1 2025 Soft Delete | 15 min | 8 min | 0 | 0 | ✅ Pass |
| Q2 2025 Point-in-Time | 30 min | TBD | 5 min | TBD | Pending |
| Q3 2025 Full Restore | 2 hours | TBD | 1 hour | TBD | Pending |
| Q4 2025 Failover | 1 hour | TBD | 5 min | TBD | Pending |

---

## 13. Cost Analysis

### Monthly Cost Breakdown (Estimates)

**Low Traffic (100 users, 5K API calls/month):**
| Service | Tier | Cost |
|---------|------|------|
| Static Web App | Free | $0.00 |
| Azure Functions | Consumption (within free grant) | $0.00 |
| Cosmos DB | Serverless (10GB storage, 100K RUs) | $0.30 |
| Application Insights | Basic (5GB ingestion) | $0.00 |
| **Total** | | **$0.30/month** |

**Medium Traffic (500 users, 50K API calls/month):**
| Service | Tier | Cost |
|---------|------|------|
| Static Web App | Free | $0.00 |
| Azure Functions | Consumption (1M executions) | $0.00 |
| Cosmos DB | Serverless (50GB storage, 1M RUs) | $15.00 |
| Application Insights | Basic (10GB ingestion) | $0.00 |
| **Total** | | **$15.00/month** |

**High Traffic (2000 users, 200K API calls/month):**
| Service | Tier | Cost |
|---------|------|------|
| Static Web App | Standard (custom domain, SLA) | $9.00 |
| Azure Functions | Consumption (5M executions) | $5.00 |
| Cosmos DB | Serverless (200GB storage, 5M RUs) | $75.00 |
| Application Insights | Basic (25GB ingestion) | $5.00 |
| **Total** | | **$94.00/month** |

### Cost Optimization Tips

1. **Enable Cosmos DB TTL** on rate_limits and deleted_charts to auto-delete old data
2. **Use SWA Free Tier** until you need custom domains or enterprise SLA
3. **Monitor RU Consumption** and optimize queries (add indexes)
4. **Set budget alerts** in Azure Cost Management

---

## 14. Testing Strategy

### Local Testing

**File:** `api/tests/saveChart.test.js` (example)
```javascript
const { getCosmosClient } = require('../shared/cosmos');

describe('SaveChart Function', () => {
    let client;

    beforeAll(async () => {
        client = await getCosmosClient();
    });

    test('should create new chart', async () => {
        const mockContext = {
            invocationId: 'test-123',
            log: { info: jest.fn(), error: jest.fn() }
        };

        const mockReq = {
            headers: {
                'x-ms-client-principal-id': 'test-user-123',
                'x-ms-client-principal-name': 'test@example.com'
            },
            body: {
                id: 'chart_test_123',
                name: 'Test Chart',
                data: {
                    nodes: [{ id: 1, name: 'CEO' }],
                    layout: 'top'
                }
            }
        };

        const SaveChart = require('../SaveChart');
        await SaveChart(mockContext, mockReq);

        expect(mockContext.res.status).toBe(201);
        expect(mockContext.res.body.success).toBe(true);
    });
});
```

Run tests:
```bash
cd api
npm test
```

### Integration Testing

```bash
# Test local API with SWA CLI
swa start app --api-location api --port 8080

# In another terminal, run integration tests
curl http://localhost:8080/api/v1/charts \
  -H "X-MS-CLIENT-PRINCIPAL-ID: test-user" \
  -H "X-MS-CLIENT-PRINCIPAL-NAME: test@example.com"
```

---

## 15. Troubleshooting

### Common Issues

**Issue: Functions not loading**
```bash
# Check function.json files exist
ls -R api/

# Check package.json in api folder
cat api/package.json

# Redeploy
git add api/
git commit -m "Fix functions"
git push
```

**Issue: Cosmos DB connection fails**
```javascript
// Test connection string
const { MongoClient } = require('mongodb');

async function testConnection() {
    const connectionString = process.env.COSMOS_CONNECTION_STRING;
    const client = new MongoClient(connectionString);

    try {
        await client.connect();
        console.log('✅ Connected to Cosmos DB');

        const db = client.db('orgchart');
        const collections = await db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
    } finally {
        await client.close();
    }
}

testConnection();
```

**Issue: Authentication not working**
```
# Check SWA auth configuration
az staticwebapp show \
  --name orgchart-prod \
  --resource-group orgchart-rg \
  --query "customDomains"
```

**Issue: CORS errors**
- SWA handles CORS automatically for same-origin requests
- For custom domains, configure in `staticwebapp.config.json`

---

## Appendix A: Quick Reference

### Common Commands

```bash
# Local development
swa start app --api-location api --port 8080

# Deploy to production
git push origin main

# View logs
az webapp log tail --name orgchart-prod --resource-group orgchart-rg

# Restart functions
az staticwebapp functions restart \
  --name orgchart-prod \
  --resource-group orgchart-rg
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/charts` | List all user's charts |
| GET | `/api/v1/charts/{id}` | Get single chart |
| POST | `/api/v1/charts` | Create new chart |
| PUT | `/api/v1/charts/{id}` | Update chart |
| DELETE | `/api/v1/charts/{id}` | Delete chart (soft delete) |
| POST | `/api/v1/charts/{id}/share` | Manage permissions |

**Note:** All routes are versioned (`/api/v1/...`) to allow future API evolution without breaking existing clients.

### Environment Variables

| Variable | Example | Required |
|----------|---------|----------|
| `COSMOS_CONNECTION_STRING` | `mongodb://...` | Yes |
| `ENVIRONMENT_NAME` | `production` | Yes |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `InstrumentationKey=...` | Recommended |
| `MAX_CHART_SIZE` | `5242880` | No (has default) |
| `BASE_URL` | `https://orgchart.company.com` | No |

---

## Appendix B: Migration Checklist

### Pre-Migration
- [ ] Set up dev environment
- [ ] Test locally with sample data
- [ ] Create Azure resources (SWA, Cosmos DB)
- [ ] Configure auth (Azure AD)
- [ ] Set up monitoring (App Insights)

### Migration Day
- [ ] Deploy to production
- [ ] Initialize database (run Setup function)
- [ ] Verify authentication works
- [ ] Create test chart
- [ ] Monitor logs for errors
- [ ] Load test with multiple users

### Post-Migration
- [ ] Enable continuous backup
- [ ] Configure alerts
- [ ] Schedule first DR drill
- [ ] Document runbooks
- [ ] Train support team

---

**Document End**

*Last Updated: January 2025*
*Version: 1.0*
*For questions or issues, create a GitHub issue in the repository.*
