# AI Workbench – AWS EC2 Deployment

This guide covers deploying and upgrading the AI Workbench on an EC2 instance with **Nginx** in front, using an **EBS volume** at `/data` for the database and documents. Only **ports 80 (HTTP), 443 (HTTPS), and 22 (SSH)** should be open on the instance.

**Domain:** `https://aiworkbench.sciagen.ai` (HTTP redirects to HTTPS)

The app uses **two separate repositories**: one for the **backend** (FastAPI) and one for the **frontend** (Vite/React). All steps below assume you deploy and manage these manually (no helper deployment scripts).

---

## Architecture

| Component | Role |
|-----------|------|
| **Nginx** | Listens on 80/443; serves frontend static files from `/var/www/aiworkbench/ui/dist` and proxies `/api` to backend |
| **Frontend** | Production build (`npm run build` → `dist/`); copied to `/var/www/aiworkbench/ui/dist` and served by Nginx |
| **Backend** | FastAPI (uvicorn) on `127.0.0.1:8002`; pm2 process `backend` (backend repo) |
| **Database** | SQLite at `/data/ai_workbench.db` (EBS) – **never overwritten on upgrade** |
| **Documents** | `/data/file_storage` (EBS) – use case reference documents |

**Do not** expose the Vite dev server (`npm run dev`) on the public internet. Serve the production build only.

---

## Nginx site config (reference file)

The production Nginx configuration lives in the **backend** repository:

```text
backend/deploy/nginx/aiworkbench.conf
```

That file includes:

- HTTP → HTTPS redirect
- Static file serving for the Vite production build
- `/api` reverse proxy to `127.0.0.1:8002`
- Security headers (HSTS, CSP, `X-Frame-Options`, `X-Content-Type-Options`, cache control)
- Blocks for dev-only paths (`/src`, `/node_modules`, `/@vite`, etc.)
- `server_tokens off;`

Before installing, review the comments at the top of the file and replace hostname, SSL certificate paths, and the frontend root path if your environment differs.

---

## Prerequisites

- **EC2 instance** (e.g. Amazon Linux 2 or Ubuntu) with Elastic IP **40.192.20.35**
- **EBS volume** mounted at **`/data`** (database and file storage)
- **DNS**: `aiworkbench.sciagen.ai` → Elastic IP
- **Security group**: allow inbound **22** (SSH), **80** (HTTP), **443** (HTTPS); do not expose 5174 or 8002

On the instance:

- **Nginx** installed (`nginx -v`)
- **Node.js** (LTS) and **npm** (for frontend build)
- **Python 3.10+** and **pip** (for backend)
- **uvicorn** (e.g. `pip install uvicorn` or in backend `requirements.txt`)
- **pm2** globally (`npm install -g pm2`) to manage the backend process

---

## First-time Installation

The steps below assume:

- Ubuntu-based EC2 instance
- You deploy into `/home/ubuntu/aiworkbench`
- You use `/data` (EBS) for the database and file storage

### Step 1 – Install Nginx

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

Ensure only ports **22, 80, 443** are open in the EC2 security group.

### Step 2 – Clone the repositories

Clone the combined `aiworkbench` directory, then clone frontend and backend into it:

```bash
cd /home/ubuntu
mkdir -p aiworkbench
cd aiworkbench

git clone https://github.com/rudhrainfosolution/aiworkbench_ui frontend
git clone https://github.com/rudhrainfosolution/aiworkbench_api backend
```

You should end up with:

- `/home/ubuntu/aiworkbench/frontend`
- `/home/ubuntu/aiworkbench/backend`

### Step 3 – Check that `/data` is mounted

The EBS volume must be mounted at `/data` **before** you start the app:

```bash
ls -ld /data
df -h | grep /data
```

If `/data` is missing or not a separate volume, mount your EBS disk there (for example):

```bash
# Example only – adjust /dev/xvdf or device name for your environment
sudo mkfs -t ext4 /dev/xvdf          # only once for a new volume
sudo mkdir -p /data
sudo mount /dev/xvdf /data
sudo chown ubuntu:ubuntu /data
```

Add an `/etc/fstab` entry so `/data` is mounted automatically on reboot.

### Step 4 – Setup Node, Python, and dependencies

#### Frontend (Node)

```bash
cd /home/ubuntu/aiworkbench/frontend
npm install
VITE_API_URL=/api npm run build
```

This generates a `dist/` folder under `frontend`.

Copy the build output to the Nginx web root:

```bash
sudo mkdir -p /var/www/aiworkbench/ui
sudo rsync -a --delete dist/ /var/www/aiworkbench/ui/dist/
sudo chown -R www-data:www-data /var/www/aiworkbench
```

#### Backend (Python)

Always create the virtual environment **inside the backend folder** and install dependencies into it:

```bash
cd /home/ubuntu/aiworkbench/backend

python3 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt  # if present
```

If there is no `requirements.txt`, install at least:

```bash
pip install fastapi uvicorn sqlalchemy pydantic pydantic-settings
```

### Step 5 – Configure environment variables

In the backend folder, create `.env` from the sample:

```bash
cd /home/ubuntu/aiworkbench/backend
cp .env_sample .env
nano .env
```

Set at least:

- `ENVIRONMENT=production`
- `SQLITE_DATABASE_PATH=/data/ai_workbench.db`
- `FILE_STORAGE_ROOT=/data/file_storage`
- `SECRET_KEY=` (strong random value)
- `JWT_SECRET_KEY=` (strong random value)
- `CLIENT_ID=ai-workbench-frontend`
- `CLIENT_SECRET=` (strong random value; must match frontend usage)
- `CORS_ORIGINS=https://aiworkbench.sciagen.ai`

Do **not** commit `.env` into git. This file stays only on the server.

Make sure file storage directory exists:

```bash
mkdir -p /data/file_storage/use_case_docs
```

### Step 6 – Configure pm2 (backend only)

Install pm2 globally if needed:

```bash
sudo npm install -g pm2
```

Start the backend from the backend directory:

```bash
cd /home/ubuntu/aiworkbench/backend
source .venv/bin/activate

pm2 start "python3" --name backend -- -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

This runs the backend only on `127.0.0.1:8002` (not publicly accessible), which Nginx will proxy to.

Save the pm2 process list so it restarts on reboot:

```bash
pm2 save
pm2 startup   # follow the printed instruction to enable pm2 at boot
```

### Step 7 – Install the Nginx site config

Copy the reference config from the backend repo and enable it:

```bash
sudo cp /home/ubuntu/aiworkbench/backend/deploy/nginx/aiworkbench.conf \
  /etc/nginx/sites-available/aiworkbench

sudo ln -sf /etc/nginx/sites-available/aiworkbench /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # optional, if you want only this site
```

Edit the file if your hostname, certificate paths, or frontend root differ from the defaults:

```bash
sudo nano /etc/nginx/sites-available/aiworkbench
```

### Step 8 – Enable HTTPS with Certbot (Let's Encrypt)

The reference Nginx config expects Let's Encrypt certificate files at:

```text
/etc/letsencrypt/live/aiworkbench.sciagen.ai/fullchain.pem
/etc/letsencrypt/live/aiworkbench.sciagen.ai/privkey.pem
```

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

If certificates do not exist yet, obtain them before enabling the full HTTPS config. For a first-time install you can temporarily comment out the HTTPS `server` block in the config, run:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --nginx -d aiworkbench.sciagen.ai
```

Then restore the full config from `backend/deploy/nginx/aiworkbench.conf` and reload Nginx.

Test automatic renewal:

```bash
sudo certbot renew --dry-run
```

Reload Nginx after any config change:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 9 – Verify services

Check that the backend is running:

```bash
pm2 list
pm2 logs backend
```

Confirm Nginx is serving the site:

```bash
sudo systemctl status nginx
curl -I https://aiworkbench.sciagen.ai
curl -I https://aiworkbench.sciagen.ai/api/health
```

You should see:

- `https://aiworkbench.sciagen.ai` → UI loads from static files
- `https://aiworkbench.sciagen.ai/api/health` → API health check (if exposed)

---

## Upgrade

**Goal:** Deploy a new version safely without losing data in `/data`.

### Step 1 – Stop the backend

```bash
pm2 stop backend || true
```

### Step 2 – Backup the database

Create a backup of the SQLite database under `/data`, or use WinSCP to copy it to your local machine:

```bash
cd /data
cp ai_workbench.db ai_workbench.db.backup-$(date +%Y%m%d-%H%M%S)
```

You can also use `rsync` or copy the file off the instance for extra safety.

### Step 3 – Get latest code (by tag)

Update **backend**:

```bash
cd /home/ubuntu/aiworkbench/backend
git fetch --all --tags
git checkout <release-tag>
```

Update **frontend**:

```bash
cd /home/ubuntu/aiworkbench/frontend
git fetch --all --tags
git checkout <release-tag>
```

Replace `<release-tag>` with the specific version you want to deploy (for example, `v1.1.1`).

Reinstall dependencies if needed (especially if `requirements.txt` or `package.json` changed):

```bash
# Backend: ensure venv exists and install deps into it
cd /home/ubuntu/aiworkbench/backend
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Frontend: rebuild and publish static assets
cd /home/ubuntu/aiworkbench/frontend
npm install
VITE_API_URL=/api npm run build
sudo rsync -a --delete dist/ /var/www/aiworkbench/ui/dist/
sudo chown -R www-data:www-data /var/www/aiworkbench
```

If the Nginx config changed in the release, copy the updated file:

```bash
sudo cp /home/ubuntu/aiworkbench/backend/deploy/nginx/aiworkbench.conf \
  /etc/nginx/sites-available/aiworkbench
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4 – Restart the backend

```bash
cd /home/ubuntu/aiworkbench/backend
source .venv/bin/activate

pm2 delete backend || true
pm2 start "python3" --name backend -- \
  -m uvicorn app.main:app --host 127.0.0.1 --port 8002

pm2 save
```

Verify:

```bash
pm2 list
pm2 logs backend
```

Finally, confirm that:

- `https://aiworkbench.sciagen.ai` serves the new frontend
- Existing data is still present (the DB file in `/data` was not touched)

---

## Data protection summary

| Path | Action on deploy/upgrade |
|------|--------------------------|
| `/data/ai_workbench.db` | **Never** overwritten or replaced; backend uses it via `.env` |
| `/data/file_storage/` | Only `mkdir -p`; existing files never deleted by deploy steps |
| Backend `.env` | Not overwritten if it already exists (secrets preserved) |

---

## Troubleshooting

- **502 Bad Gateway:** Backend not running. Check `pm2 list`, logs with `pm2 logs backend`, and restart with `pm2 restart backend`.
- **API 404 / CORS:** Ensure `CORS_ORIGINS` in backend `.env` includes `https://aiworkbench.sciagen.ai`, and Nginx is proxying `/api` to `http://127.0.0.1:8002`.
- **Database missing:** Backend creates `/data/ai_workbench.db` on first start if the path is set in `.env` and `/data` is writable. Ensure EBS is mounted at `/data` and the app user can write there.
- **Session/cookies:** Nginx and the app use the same host; ensure `proxy_cookie_path / /` and `proxy_pass_header Set-Cookie` are in the `/api` block (they are in `deploy/nginx/aiworkbench.conf`).
- **ZAP / pen-test findings on dev paths:** If the frontend was previously proxied to `npm run dev`, scanners may report exposed source maps, HMR tokens, or `/node_modules`. Serve the production build from `/var/www/aiworkbench/ui/dist` using the reference Nginx config.
- **Stale UI after upgrade:** Hard-refresh the browser or confirm `rsync --delete` ran so old hashed assets were removed from `/var/www/aiworkbench/ui/dist`.

---

## File layout (reference, two repos)

```text
/home/ubuntu/aiworkbench/
├── backend/                          # Backend repo
│   ├── app/
│   │   └── main.py
│   ├── deploy/nginx/aiworkbench.conf # Reference Nginx site config
│   ├── .env                          # Secrets (do not overwrite on upgrade)
│   └── requirements.txt
│
└── frontend/                         # Frontend repo
    ├── package.json
    ├── src/
    └── dist/                         # Created by npm run build

/data/                                # EBS volume
├── ai_workbench.db                   # SQLite DB – never overwrite
└── file_storage/
    └── use_case_docs/

/var/www/aiworkbench/ui/dist/         # Nginx document root (copied from frontend dist/)
/etc/nginx/sites-available/aiworkbench
```
