# AI Workbench – Backend

FastAPI-based API for the AI Workbench application: domains, use cases, users, roles, permissions, and audit logging.

## Requirements

- Python 3.10+
- SQLite (default) or MySQL
- Redis (registration OTP, login MFA, and password reset token storage)

## Setup

1. **Install dependencies**

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Environment configuration**

   Create a `.env` file in the `backend` directory. Do not commit `.env` or any file containing secrets.

   - Set `ENVIRONMENT`, `SECRET_KEY`, `JWT_SECRET_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, and database vars via `.env`. In production, the app rejects default placeholder secrets.
   - Set `REDIS_HOST`, `REDIS_PORT`, and `REDIS_DB` for registration OTP, login MFA, and password reset token storage.
   - Optional: `ADMIN_EMAIL` and `ADMIN_INIT_PASSWORD` for initial admin bootstrap (use only in controlled setups; never commit real values).

3. **Run the server**

   ```bash
   cd backend
   python run.py
   ```

   Or with uvicorn:

   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
   ```

   API base: `http://localhost:8002`

## API documentation

With the server running:

- **Swagger UI:** `http://localhost:8002/doc`
- **ReDoc:** `http://localhost:8002/redoc`
- **OpenAPI JSON:** `http://localhost:8002/openapi.json`

## Authentication

- **Client credentials:** The frontend obtains a JWT via `/api/auth/client-login` (client ID/secret). Configure in env; never commit secrets.
- **User sign-in:** Users sign in at `/api/auth/signin`; the API sets an HTTP-only session cookie. Sign-in is rate-limited per email (failed attempts only).
- **Forgot password reset:** The frontend calls `/api/auth/forgot-password` to send an email passcode, `/api/auth/forgot-password/verify-passcode` to verify the passcode and receive a short-lived `reset_token`, then `/api/auth/reset-password` with the email, `reset_token`, and user-chosen `new_password`. The password is not changed until the final reset request succeeds.
- **Protected routes:** Most API routes require a valid JWT in the `Authorization: Bearer <token>` header; pre-session auth routes note any client-JWT requirement below. User-specific routes also require the session cookie.

### Login MFA and production proxy IP handling

Login MFA trusts a user's IP only after a successful email passcode challenge. The backend resolves the client IP from `X-Forwarded-For` / `X-Real-IP` only when the immediate peer is configured in `TRUSTED_PROXY_CIDRS`; otherwise it uses `request.client.host`.

For EC2 with Nginx on the same host proxying to Uvicorn on `127.0.0.1`, keep this in backend `.env`:

```env
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

Use a sanitized API proxy header block:

```nginx
location /api {
    proxy_pass http://127.0.0.1:8002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    proxy_cookie_path / /;
    proxy_pass_header Set-Cookie;
}
```

If an AWS Load Balancer is in front of Nginx, configure Nginx to trust only the ALB/VPC subnet before setting those proxy headers:

```nginx
set_real_ip_from <ALB_OR_VPC_PRIVATE_CIDR>;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Do not pass client-supplied `X-Forwarded-For` through blindly. Avoid `$proxy_add_x_forwarded_for` for the backend `/api` location unless Nginx `real_ip` is correctly configured and the backend `TRUSTED_PROXY_CIDRS` includes only trusted proxy networks.

Login MFA challenge state is stored in Redis under `login_mfa:*` keys. All backend instances must use the same Redis. The current session store is in-process, so multi-process or multi-instance deployments also need sticky routing or a Redis-backed session store.

**Pre-session authentication routes:**

- `GET /` – root
- `GET /api/health` – health check
- `GET /doc`, `GET /redoc`, `GET /openapi.json` – docs
- `POST /api/auth/client-login` – client credentials
- `POST /api/auth/signin` – user sign-in (requires client JWT)
- `POST /api/auth/forgot-password` – send password reset passcode (requires client JWT, rate-limited)
- `POST /api/auth/forgot-password/verify-passcode` – verify reset passcode and return reset token (requires client JWT)
- `POST /api/auth/reset-password` – set a new user-chosen password after passcode verification (requires client JWT)
- `POST /api/auth/refresh` – refresh token

## Project structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, middleware, routes
│   ├── api/
│   │   └── v1/
│   │       ├── auth.py      # Sign-in, client-login, refresh, password reset
│   │       ├── domains.py   # Domains, domain access, eligible owners
│   │       ├── use_cases.py # Use cases, data, risks, comments, audit-logs
│   │       ├── settings.py  # Users, roles, permissions, system config
│   │       └── audit.py     # Global audit log (requires audit_access)
│   ├── core/
│   │   ├── config.py        # Settings from env
│   │   ├── database.py      # Engine, session, migrations
│   │   ├── security.py      # Password hashing, JWT, client credentials
│   │   ├── authorization.py # Permission and role checks
│   │   ├── password_reset.py # One-time reset token storage
│   │   └── logging_config.py
│   ├── middleware/
│   │   ├── auth_middleware.py   # JWT validation
│   │   └── logging_middleware.py
│   ├── models/              # SQLAlchemy models
│   ├── services/
│   │   └── init_service.py  # Default permissions, roles, admin bootstrap
│   └── utils/
│       └── email.py         # Branded email sending
├── migrations/
│   └── 001_baseline.sql     # Baseline schema and seed data
├── run.py
├── requirements.txt
└── README.md
```

## Database

- **Default:** SQLite; database file path is configurable via `SQLITE_DATABASE_PATH`.
- **MySQL:** Set `DATABASE_TYPE=mysql` and the corresponding MySQL env variables (`MYSQL_HOST`, `MYSQL_USER`, etc.). Supply credentials via env only.
- **Migrations:** Baseline schema and seed data are in `migrations/001_baseline.sql`. The app runs programmatic migrations for missing columns (see `app/core/database.py`).

## Features

- Domains and domain access (owners, eligible owners, assign users)
- Use cases: CRUD, status workflow (New → Analysis → Review → Approved/Rejected), risks, data requirements, comments
- Use-case–scoped audit logs (no global audit permission required) and global audit log (requires audit_access)
- Users, roles, permissions; optional admin bootstrap via env
- Password hashing (PBKDF2-HMAC-SHA256, portable across machines), JWT access/refresh, HTTP-only session cookies
- CORS, request/response logging, redaction of sensitive fields in logs

## Docker

- Use the provided Dockerfile and docker-compose files; configure via env files (e.g. `.env.docker`). Do not bake secrets into images.

## Security notes

- Passwords are hashed with PBKDF2-HMAC-SHA256 from the Python standard library (machine-independent; salt embedded in the stored hash). Legacy bcrypt hashes are still accepted for verification until users are reset.
- Sensitive request bodies (e.g. sign-in, forgot-password, reset-password) and headers (e.g. Authorization) are redacted or masked in logs.
- All secrets (JWT keys, client secret, DB passwords, admin bootstrap) must be supplied via environment or secure config; never hardcode or commit them.
- API responses include standard security headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` in production, etc.) via `SecurityHeadersMiddleware`.

### Production hardening (ZAP / pen test)

Use the reference nginx site config at `deploy/nginx/aiworkbench.conf`:

- Set `server_tokens off;` to hide nginx version information.
- Serve the Vite **production** build (`npm run build` output in `dist/`), not the Vite dev server.
- Block public access to dev-only paths (`/src`, `/node_modules`, `/@vite`, etc.).
- Apply HSTS, CSP, anti-clickjacking (`X-Frame-Options` / `frame-ancestors`), and `X-Content-Type-Options: nosniff` on all responses.
- Use explicit cache directives: long-lived immutable caching for hashed static assets; `no-store` for HTML and API JSON.

If the frontend is scanned while running `npm run dev` behind nginx, ZAP will report dev-only findings (Vite HMR `?token=` in WebSocket URLs, exposed source files, library timestamp false positives). Those are resolved by serving the production build.
