# Technical Documentation

This document describes the production architecture, data model, and operational details for the Org Chart application.

## System Overview

- Frontend: static web app served from `app/`
- Backend: Azure Functions API in `api/`
- Database: MongoDB-compatible (Azure Cosmos DB for MongoDB API or MongoDB Atlas)
- Authentication: Azure Static Web Apps (SWA) + Microsoft Entra ID (Azure AD)

## Architecture

```
User Browser
  -> app/index.html (dashboard)
  -> app/chart-editor.html (editor)
  -> app/admin.html (admin)
  -> app/shared.html (share-view)
     |
     v
SWA Auth (/.auth/*) -> API requests (/api/v1/*)
     |
     v
Azure Functions (api/*) -> MongoDB (orgchart DB)
```

Key frontend modules:
- `app/js/dashboard.js`: dashboard UI, chart list, bulk export, access requests
- `app/js/chart-editor.js`: editor UI, node CRUD, single export
- `app/js/bulk-export.js`: off-screen rendering, PDF assembly, bulk export pipeline
- `app/js/export-template.js`: PDF template sizing and placement
- `app/js/api-client.js`: API client for `/api/v1`
- `app/js/auth.js`: SWA auth integration
- `app/js/org-node-renderer.js`: node HTML rendering + sizing

## Authentication and Authorization

- SWA handles login via `/.auth/login/aad`
- Frontend checks session via `/.auth/me`
- All API endpoints require authentication, except `/api/v1/shared/*`
- Role hierarchy:
  - Owner: chart owner (highest for that chart)
  - Chart permissions: per-chart permissions array (viewer/editor)
  - Global roles: `viewer`, `editor`, `admin` (from `user_roles`)
  - Authenticated default: viewer if no other role applies

Important behavior:
- GET `/api/v1/charts` returns all charts for authenticated users (viewer access).
  If strict per-chart isolation is required, this must be changed in the API.

Admin bootstrap:
- Set `ADMIN_USER_IDS` (Azure AD object IDs) to seed initial admins.

## Data Model

Database: `orgchart`

Collections:
- `charts`: primary chart documents
- `deleted_charts`: soft deletes with TTL
- `rate_limits`: rate limit counters with TTL
- `user_roles`: global roles (viewer/editor/admin)
- `access_requests`: chart-level access requests
- `chart_share_links`: share tokens

Chart document (MongoDB):
```json
{
  "id": "uuid",
  "ownerId": "aad-user-id",
  "name": "Chart Name",
  "data": {
    "chartName": "Chart Name",
    "departmentTag": "Engineering",
    "coverId": "management-team",
    "coverOrderIndex": 2,
    "nodes": [ /* Node objects */ ],
    "layout": "top",
    "viewState": { "zoom": 1, "pan": { "x": 0, "y": 0 }, "collapsedNodes": [] }
  },
  "permissions": [{ "userId": "aad-id", "role": "editor" }],
  "isPublic": false,
  "createdAt": "2025-01-01T00:00:00Z",
  "lastModified": "2025-01-01T00:00:00Z"
}
```

Node object (current multi-person format):
```json
{
  "id": "node-uuid",
  "parentId": "parent-uuid or null",
  "members": [
    {
      "roleLabel": "Role Title",
      "entries": [
        { "name": "Full Name", "email": "", "phone": "", "photoUrl": "" }
      ]
    }
  ],
  "meta": {
    "department": "Department",
    "notes": ""
  }
}
```

## API Endpoints

All routes are under `/api/v1`:

Charts
- `GET /charts` (list charts)
- `GET /charts/{chartId}` (chart details)
- `POST /charts` (create)
- `PUT /charts/{chartId}` (update)
- `DELETE /charts/{chartId}` (soft delete)

Sharing
- `POST /charts/{chartId}/share` (grant chart-level role)
- `DELETE /charts/{chartId}/share` (revoke chart-level role)
- `POST /charts/{chartId}/share-link` (create share link)
- `GET /charts/{chartId}/share-link` (get existing share link)
- `DELETE /charts/{chartId}/share-link` (revoke share link)
- `GET /shared/{token}` (public share view)

Access requests
- `POST /charts/{chartId}/access-requests` (request access)
- `GET /access-requests` (list requests for owner/admin)
- `PUT /access-requests/{requestId}` (approve/deny)

Admin
- `GET /admin/users` (list global roles)
- `POST /admin/users/{userId}/role` (grant global role)
- `DELETE /admin/users/{userId}/role` (revoke global role)

## Export Pipeline

Single-chart exports:
- From editor (PNG, JPEG, PDF)
- Uses off-screen rendering with injected CSS variables and node styles

Bulk export:
- Fetches all charts (API)
- Renders off-screen and assembles PDF using `export-template.js`
- Cover matching uses `coverId` from chart data
- Export quality scales:
  - low: scale 1.0 (PNG)
  - medium: scale 1.5 (PNG)
  - high: scale 2.0 (PNG)
  - print: scale 2.5 (PNG)

## Configuration

SWA configuration file:
- `app/staticwebapp.config.json`
- Route protection and CSP headers are defined here

Required environment variables:
- `COSMOS_CONNECTION_STRING`
- `ALLOW_ANONYMOUS` (set to `false` in production)
- `ADMIN_USER_IDS` (comma-separated Azure AD object IDs)
- `APPLICATIONINSIGHTS_CONNECTION_STRING` (optional)

## Deployment (Azure Static Web Apps)

Recommended SWA settings:
- App location: `app`
- API location: `api`
- Output location: (blank)

The SWA action deploys the static site and Azure Functions together.

## Local Development

Run SWA locally:
```bash
npm run dev:swa
```

API tests:
```bash
cd api
npm ci
npm test
```

## Observability

- Azure Functions log to Application Insights when configured
- Correlation IDs are included in API responses and logs

## Operational Notes

- Rate limits are enforced per user and stored in `rate_limits`
- Deleted charts are soft-deleted and stored for 90 days in `deleted_charts`
- Share links are stored in `chart_share_links` and can be revoked
