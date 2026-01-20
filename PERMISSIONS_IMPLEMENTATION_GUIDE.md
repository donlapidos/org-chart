# Permissions & Access Management Implementation Guide

## Overview

This guide documents the complete permissions and access management system for the Org Chart application, including global roles, chart-level permissions, and access request workflows.

## Architecture

### Permission Hierarchy (Priority Order)

1. **Chart Owner** - Full control over a specific chart
2. **Chart Permissions** - Explicit sharing (editor/viewer)
3. **Global Roles** - Admin, Editor, or Viewer across all charts
4. **Default Authenticated Viewer** - All authenticated users can view all charts (read-only)

### Role Definitions

#### Chart-Level Roles
- **Owner**: Full control - can edit, delete, and share the chart
- **Editor**: Can edit chart content but cannot delete or share
- **Viewer**: Read-only access to view the chart

#### Global Roles
- **Admin**: Full access to all charts + user management + access request review
- **Editor**: Can edit all charts
- **Viewer**: Read-only access to all charts

## Backend API Endpoints

All endpoints require Azure Static Web Apps authentication (`/.auth/login/aad`).

### 1. Global Role Management (Admin Only)

#### Grant Global Role
```
POST /api/v1/admin/users/{userId}/role
Content-Type: application/json

{
  "role": "admin" | "editor" | "viewer"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "userId": "user-123",
  "role": "admin"
}
```

#### Revoke Global Role
```
DELETE /api/v1/admin/users/{userId}/role
```

**Response**: `200 OK`
```json
{
  "success": true,
  "userId": "user-123"
}
```

#### Bootstrap Admins
Set environment variable:
```
ADMIN_USER_IDS=user-id-1,user-id-2,user-id-3
```

### 2. Chart Sharing (Owner Only)

#### Share Chart
```
POST /api/v1/charts/{chartId}/share
Content-Type: application/json

{
  "targetUserId": "user-456",
  "role": "editor" | "viewer"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "chartId": "chart-123",
  "targetUserId": "user-456",
  "role": "editor"
}
```

#### Revoke Access
```
DELETE /api/v1/charts/{chartId}/share
Content-Type: application/json

{
  "targetUserId": "user-456"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "chartId": "chart-123",
  "targetUserId": "user-456"
}
```

### 3. Access Requests

#### Request Access
```
POST /api/v1/charts/{chartId}/access-requests
Content-Type: application/json

{
  "requestedRole": "editor" | "viewer",
  "reason": "Optional explanation"
}
```

**Response**: `201 Created`
```json
{
  "success": true,
  "requestId": "req-789",
  "chartId": "chart-123",
  "status": "pending"
}
```

#### List Access Requests
```
GET /api/v1/access-requests?status=pending
```

**Response**: `200 OK`
```json
{
  "requests": [
    {
      "id": "req-789",
      "chartId": "chart-123",
      "chartName": "Engineering Org",
      "requesterId": "user-456",
      "requesterEmail": "user@example.com",
      "requestedRole": "editor",
      "reason": "Need to update team structure",
      "status": "pending",
      "createdAt": "2025-12-10T01:00:00Z"
    }
  ]
}
```

**Query Parameters:**
- `status`: Filter by status (`pending`, `approved`, `denied`)
- Admins see all requests
- Owners see requests for their charts
- Users see their own requests

#### Review Access Request
```
PUT /api/v1/access-requests/{requestId}
Content-Type: application/json

{
  "action": "approve" | "deny",
  "notes": "Optional review notes"
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "requestId": "req-789",
  "status": "approved",
  "reviewedBy": "owner-123",
  "reviewedAt": "2025-12-10T02:00:00Z"
}
```

### 4. Chart Operations

#### Get Charts (All Authenticated Users)
```
GET /api/v1/charts
```

**Response**: `200 OK`
```json
{
  "charts": [
    {
      "id": "chart-123",
      "name": "Engineering Org",
      "ownerId": "user-123",
      "lastModified": "2025-12-10T01:00:00Z",
      "createdAt": "2025-12-01T00:00:00Z",
      "userRole": "owner",
      "sharedWith": 5
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1,
    "hasMore": false
  }
}
```

#### Get Chart (Authenticated Users - Viewer+)
```
GET /api/v1/charts/{chartId}
```

**Response**: `200 OK`
```json
{
  "chart": {
    "id": "chart-123",
    "name": "Engineering Org",
    "ownerId": "user-123",
    "data": { ... },
    "permissions": [ ... ],  // Only visible to owner
    "lastModified": "2025-12-10T01:00:00Z"
  },
  "userRole": "viewer",
  "isReadOnly": true
}
```

#### Create/Update Chart (Editor+)
```
POST /api/v1/charts
PUT /api/v1/charts/{chartId}
Content-Type: application/json

{
  "name": "Chart Name",
  "data": { ... }
}
```

#### Delete Chart (Owner Only)
```
DELETE /api/v1/charts/{chartId}
```

## Frontend Implementation

### Admin Panel (`/admin.html`)

Features:
- Grant/revoke global roles to users
- View and review access requests
- Filter requests by status (pending/approved/denied)

**Access**: Available to users with global admin role

**Usage**:
1. Navigate to Admin Panel link in dashboard header
2. Enter user ID or email to grant role
3. Select role (admin/editor/viewer)
4. Click "Grant Role"

### Chart Sharing

Features:
- Share charts with specific users
- Set permissions (editor/viewer)
- View current permissions
- Revoke access from users

**Access**: Only chart owners can share

**Usage**:
1. Open a chart you own
2. Click "Share" button on chart card
3. Enter user ID or email
4. Select role (editor/viewer)
5. Click "Share"

### Access Requests

Features:
- Request editor access to charts
- View your pending/approved/denied requests
- Owners/admins review and approve/deny requests

**Usage**:
1. As a viewer, click "Request Access" on chart card
2. Select desired role (editor/viewer)
3. Provide reason for request
4. Wait for owner/admin review

### Dashboard Permissions Display

Each chart card shows:
- **Role Badge**: Owner (red), Editor (blue), or Viewer (green)
- **Conditional Buttons**:
  - Owners: Edit, Share, Duplicate, Delete
  - Editors: Edit, Duplicate
  - Viewers: View, Request Access, Duplicate

## Configuration

### Static Web App Config (`staticwebapp.config.json`)

All API routes require authentication:

```json
{
  "routes": [
    {
      "route": "/api/v1/charts",
      "methods": ["GET"],
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/api/v1/admin/*",
      "allowedRoles": ["authenticated"]
    }
  ]
}
```

### Environment Variables

**Optional - Bootstrap Admins**:
```
ADMIN_USER_IDS=user-id-1,user-id-2
```

**Required - Database**:
```
COSMOS_CONNECTION_STRING=mongodb://...
```

**Optional - Anonymous Access (Local Dev Only)**:
```
ALLOW_ANONYMOUS=true
```

## Development Setup

### Local Development with SWA CLI

1. **Start Azure Functions Backend**:
```bash
cd api
func start --port 7071
```

2. **Start SWA CLI**:
```bash
swa start app --api-devserver-url http://localhost:7071 --port 4280
```

3. **Access Application**:
- Dashboard: http://localhost:4280
- Admin Panel: http://localhost:4280/admin.html
- Mock Login: http://localhost:4280/.auth/login/aad

### cURL Examples

#### Grant Admin Role
```bash
curl -X POST http://localhost:7071/api/v1/admin/users/user-456/role \
  -H "Content-Type: application/json" \
  -H "x-ms-client-principal: $(echo '{"userId":"admin-123","userDetails":"admin@example.com","userRoles":["authenticated"]}' | base64)" \
  -d '{"role":"admin"}'
```

#### Share Chart
```bash
curl -X POST http://localhost:7071/api/v1/charts/chart-123/share \
  -H "Content-Type: application/json" \
  -H "x-ms-client-principal: $(echo '{"userId":"owner-123","userDetails":"owner@example.com"}' | base64)" \
  -d '{"targetUserId":"user-456","role":"editor"}'
```

#### Request Access
```bash
curl -X POST http://localhost:7071/api/v1/charts/chart-123/access-requests \
  -H "Content-Type: application/json" \
  -H "x-ms-client-principal: $(echo '{"userId":"user-456","userDetails":"user@example.com"}' | base64)" \
  -d '{"requestedRole":"editor","reason":"Need to update team structure"}'
```

#### Approve Request
```bash
curl -X PUT http://localhost:7071/api/v1/access-requests/req-789 \
  -H "Content-Type: application/json" \
  -H "x-ms-client-principal: $(echo '{"userId":"owner-123","userDetails":"owner@example.com"}' | base64)" \
  -d '{"action":"approve","notes":"Approved for Q1 updates"}'
```

## Security Features

1. **Authentication Required**: All API endpoints require Azure SWA authentication
2. **Role-Based Access Control**: Hierarchical permission system
3. **Audit Logging**: All operations logged with correlation IDs
4. **Rate Limiting**: Request throttling per user/action
5. **Input Validation**: XSS prevention, SQL injection protection
6. **Soft Deletes**: 90-day recovery period for deleted charts

## File Structure

```
app/
├── admin.html                      # Admin panel UI
├── index.html                      # Main dashboard
├── js/
│   ├── admin.js                    # Admin panel logic
│   ├── api-client.js               # API communication
│   ├── auth.js                     # Authentication handling
│   ├── chart-sharing.js            # Sharing modal & logic
│   └── dashboard.js                # Dashboard with permissions UI
└── staticwebapp.config.json        # SWA routing & auth config

api/
├── GetCharts/                      # List charts (viewer+)
├── GetChart/                       # Get single chart (viewer+)
├── SaveChart/                      # Create/update (editor+)
├── DeleteChart/                    # Delete chart (owner)
├── ShareChart/                     # Share/revoke (owner)
├── RequestAccess/                  # Request access (authenticated)
├── GetAccessRequests/              # List requests (role-based)
├── ReviewAccessRequest/            # Approve/deny (owner/admin)
├── ManageUserRole/                 # Grant/revoke global roles (admin)
└── shared/
    ├── authorization.js            # Permission hierarchy logic
    ├── globalRoles.js              # Global role management
    └── auth.js                     # Authentication utilities
```

## Behavior Summary

- ✅ All authenticated users can **view** any chart (implicit viewer)
- ✅ **Editing** requires chart-level editor/owner or global editor/admin
- ✅ **Deleting** requires chart owner role
- ✅ **Sharing** requires chart owner role
- ✅ `isPublic` flag is **ignored** (all access requires authentication)
- ✅ Access requests provide workflow for permission elevation
- ✅ Admins have full access + user management capabilities

## Next Steps

1. Connect to Cosmos DB (update `COSMOS_CONNECTION_STRING`)
2. Deploy to Azure Static Web Apps
3. Configure Azure AD authentication
4. Set `ADMIN_USER_IDS` for initial administrators
5. Test permission workflows end-to-end
