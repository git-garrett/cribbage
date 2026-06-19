# Cribbage Server Setup on Rocky Linux

This deploys the static client and the Model 13 API on one small Rocky Linux Nanode. The Node process serves `dist/` and handles `/api/*`; Caddy sits in front for HTTPS.

## 1. Base Packages

```bash
sudo dnf update -y
sudo dnf install -y git curl firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 2. Install Node 22

Node 22 is recommended because the server can use the built-in SQLite module.

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node --version
npm --version
```

## 3. Install Caddy

```bash
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable @caddy/caddy -y
sudo dnf install -y caddy
sudo systemctl enable --now caddy
```

## 4. Build the App Off-Box

Do not build this app on a 1 GB Nanode. The Vite/Rollup build loads large model artifacts and can be killed by the Linux OOM killer. Build on a laptop, workstation, or CI runner, then upload the generated artifacts.

The easiest path is the deploy helper:

```bash
scripts/deploy-nanode.sh deploy
```

By default it targets `root@45.79.111.69` using `../2019.private`, builds locally, uploads the artifact, installs the systemd unit, writes the Caddy reverse proxy for `cribbage.strongcribbage.com`, `strongcribbage.com`, and `www.strongcribbage.com`, restarts services, and checks health.

On the build machine:

```bash
cd /path/to/cribbage
git checkout server
npm ci
npm run build:deploy
npm run package:server
```

This creates `cribbage-server-13.0.0.tgz` containing:

- `dist/` static client
- `server-dist/` Node server bundle
- `package.json`
- this setup document

Upload it:

```bash
scp cribbage-server-13.0.0.tgz YOUR_USER@your-domain.example.com:/tmp/
```

## 5. Deploy the App

```bash
sudo mkdir -p /opt/cribbage /var/lib/cribbage
sudo chown -R "$USER":"$USER" /opt/cribbage /var/lib/cribbage
tar -xzf /tmp/cribbage-server-13.0.0.tgz -C /opt/cribbage
```

No `npm ci` or `npm run build:*` step is required on the Nanode for this artifact deploy. The server bundle uses Node built-ins and the bundled generated files.

## 6. Configure systemd

Create `/etc/systemd/system/cribbage.service`:

```ini
[Unit]
Description=Cribbage Model 13 API and static client
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cribbage
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=CRIBBAGE_STATIC_DIR=/opt/cribbage/dist
Environment=CRIBBAGE_DB_PATH=/var/lib/cribbage/cribbage-server.sqlite
Environment=NODE_OPTIONS=--max-old-space-size=512
ExecStart=/usr/bin/node --experimental-sqlite /opt/cribbage/server-dist/server.mjs
Restart=always
RestartSec=3
User=YOUR_USER
Group=YOUR_USER

[Install]
WantedBy=multi-user.target
```

Then start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cribbage
sudo systemctl status cribbage
curl http://127.0.0.1:8787/health
```

## 7. Configure Caddy

Set `/etc/caddy/Caddyfile`:

```caddyfile
cribbage.strongcribbage.com, strongcribbage.com, www.strongcribbage.com {
	reverse_proxy 127.0.0.1:8787
}
```

Then reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://cribbage.strongcribbage.com/health
```

The Node server serves the game app on `cribbage.strongcribbage.com` and a lightweight coming-soon page on `strongcribbage.com` / `www.strongcribbage.com`.

## 8. Operating Notes

- The public app defaults to simple mode. Use `?full=1` or `?mode=full` to expose the full local app UI.
- Use `?tag=anything` to attach an arbitrary tag to uploaded game logs.
- Use `?local=1` to bypass the server AI API and run AI locally in the browser.
- Game uploads are stored in `/var/lib/cribbage/cribbage-server.sqlite`.
- Server AI request logs are stored in the same SQLite database under `ai_requests`.
- Back up `/var/lib/cribbage/cribbage-server.sqlite` and its WAL files.

## 9. Updating

Use the helper:

```bash
scripts/deploy-nanode.sh deploy
```

Or, if you already built and packaged locally:

```bash
scripts/deploy-nanode.sh deploy --skip-build
```

Manual equivalent on the build machine:

```bash
cd /path/to/cribbage
git pull
npm ci
npm run build:deploy
npm run package:server
scp cribbage-server-13.0.0.tgz YOUR_USER@your-domain.example.com:/tmp/
```

On the Nanode:

```bash
sudo systemctl stop cribbage
sudo rm -rf /opt/cribbage/dist /opt/cribbage/server-dist /opt/cribbage/package.json
tar -xzf /tmp/cribbage-server-13.0.0.tgz -C /opt/cribbage
sudo systemctl start cribbage
curl http://127.0.0.1:8787/health
```

## 10. Pulling Production Data Down

To pull the production SQLite database and service health into a timestamped local folder:

```bash
scripts/deploy-nanode.sh pull
```

This writes to `production-pulls/<timestamp>/`, which is intentionally ignored by git.

## 11. If You Must Build on the Nanode

Prefer not to. If you have no other option, add temporary swap first and expect the build to be slow:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
```

Then try the build. Remove the swap file afterward if you do not want it to persist:

```bash
sudo swapoff /swapfile
sudo rm /swapfile
```
