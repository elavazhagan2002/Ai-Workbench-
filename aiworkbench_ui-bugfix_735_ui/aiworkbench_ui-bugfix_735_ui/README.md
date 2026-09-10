# AI Governance Workbench – Frontend

React-based UI for the AI Governance Workbench application: domains, use cases, status workflow, audit, and settings. Connects to the backend API for authentication and data.

## Requirements

- Node.js 18+
- npm (or compatible package manager)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run the backend**

   The frontend proxies `/api` to the backend. Start the backend from the `backend` directory (see **backend/README.md**).

3. **Run the dev server**

   ```bash
   npm run dev
   ```

   The app is served at the URL shown in the terminal (e.g. `http://localhost:5174`). API requests to `/api` are proxied to the backend (default `http://localhost:8002`).

## Scripts

| Script       | Description                    |
| ------------ | ------------------------------ |
| `npm run dev`      | Start Vite dev server          |
| `npm run build`    | Production build (output in `dist/`) |
| `npm run preview`  | Preview production build       |
| `npm run lint`     | Run ESLint                     |
| `npm run typecheck`| TypeScript check (no emit)     |

## Project structure

```
.
├── public/           # Static assets (favicon, illustrations)
├── src/
│   ├── assets/       # Images (e.g. logo for PDF export)
│   ├── components/   # Reusable UI (Header, Toast, UseCaseStateView, etc.)
│   ├── contexts/     # AuthContext, ThemeContext
│   ├── lib/          # API client (api.ts)
│   ├── pages/        # Login, Domains, UseCases, UseCaseDetail, UseCaseEdit, AuditLog, Settings
│   ├── types/        # TypeScript types
│   ├── utils/        # Logger and helpers
│   ├── App.tsx       # Root app and routing
│   ├── main.tsx      # Entry point
│   └── index.css     # Global and Tailwind styles
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.app.json
└── vite.config.ts    # Vite config and /api proxy to backend
```

## Features

- **Authentication:** Client login and user sign-in; session handled via HTTP-only cookies. Forgot-password uses email passcode verification followed by a user-chosen new password. Sign-in over plain HTTP is blocked in production except localhost.
- **Domains:** List domains, open use cases, edit domain (owner or permission), assign users to domain (inline panel; owner or admin).
- **Use cases:** List by domain, create/edit/delete (permissions and domain-owner rules). Status workflow via interactive boxes: New → Analysis → Review → Approved/Rejected. Technical/Business owner dropdowns use role-based eligible endpoints.
- **Use case detail:** View use case, solution design overview, risks, data requirements, comments. PDF export with logo, date, page numbers, audit trail (use-case–scoped), technical/business owner.
- **Audit:** Global audit log (requires `audit_access`).
- **Settings:** Users and roles (requires `settings_access`). User deactivation/activation (no self-deactivation).
- **Theme:** Light/dark mode via ThemeContext.

## Tech stack

- **React 18** with TypeScript  
- **Vite 7** – build and dev server  
- **Tailwind CSS** – styling  
- **Lucide React** – icons  
- **jsPDF** – PDF export on use case detail  

## Configuration

- The dev server proxies `/api` to the backend (see `vite.config.ts`). Backend URL is configurable there for local development.
- All secrets (e.g. client credentials) must be provided via environment or backend configuration; never commit them. See **backend/README.md**.

## Production deployment and security headers

For production, build static assets and serve them with nginx (see `deploy/nginx/aiworkbench.conf` in the repo root):

```bash
npm run build
```

Do **not** expose `npm run dev` on the public internet. The dev server serves source files and Vite HMR endpoints that pen-test tools flag as informational/low findings.

The Vite dev and preview servers add security headers via `vite.securityHeaders.ts`. Production nginx must set the same headers (CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, cache control, and `server_tokens off`).

## Backend

API, authentication, and configuration are documented in **backend/README.md**. Run the backend from the `backend` directory before using the frontend.
