# Org Chart Application (Pilot)

An internal web app for creating, managing, and exporting organizational charts. This repo contains a static frontend (`app/`) and an Azure Functions API (`api/`) backed by a MongoDB-compatible database.

For architecture, data model, and operational details, see:
`../TECHNICAL_DOCUMENTATION.md`

## Key Features

- Dashboard to create, edit, duplicate, and delete charts
- Node editor with roles and multi-person entries per node
- Search and filtering
- Export to PNG/JPEG/PDF (single chart) and bulk PDF export
- Share links and access requests
- Role-based access (viewer, editor, owner, admin)

## Quick Links

- Dashboard: `app/index.html`
- Chart editor: `app/chart-editor.html`
- Admin console: `app/admin.html`
- Shared view: `app/shared.html?token=...`

## Configuration (Production)

Environment variables required for the API:
- `COSMOS_CONNECTION_STRING`
- `ALLOW_ANONYMOUS=false`
- `ADMIN_USER_IDS` (comma-separated Azure AD object IDs)
- `APPLICATIONINSIGHTS_CONNECTION_STRING` (optional)

Static Web App settings:
- App location: `app`
- API location: `api`
- Output location: (blank)
- Config file: `app/staticwebapp.config.json`

## Local Development

Start SWA locally (frontend + API):
```bash
npm run dev:swa
```

The SWA dev server typically runs at `http://localhost:4280`.

## Testing

Run API tests:
```bash
cd api
npm ci
npm test
```

## Notes

- Authentication uses Microsoft Entra ID via Azure Static Web Apps.
- All API endpoints require authentication except shared-view endpoints.
- Admin access is bootstrapped using `ADMIN_USER_IDS`.
