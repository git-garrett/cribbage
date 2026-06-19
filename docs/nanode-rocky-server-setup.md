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

## 4. Deploy the App

```bash
sudo mkdir -p /opt/cribbage /var/lib/cribbage
sudo chown -R "$USER":"$USER" /opt/cribbage /var/lib/cribbage
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPO.git /opt/cribbage
cd /opt/cribbage
git checkout server
npm ci
npm run build:deploy
```

Replace the repo URL with the actual repository remote.

## 5. Configure systemd

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

## 6. Configure Caddy

Set `/etc/caddy/Caddyfile`:

```caddyfile
your-domain.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

Then reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://your-domain.example.com/health
```

## 7. Operating Notes

- The public app defaults to simple mode. Use `?full=1` or `?mode=full` to expose the full local app UI.
- Use `?tag=anything` to attach an arbitrary tag to uploaded game logs.
- Use `?local=1` to bypass the server AI API and run AI locally in the browser.
- Game uploads are stored in `/var/lib/cribbage/cribbage-server.sqlite`.
- Server AI request logs are stored in the same SQLite database under `ai_requests`.
- Back up `/var/lib/cribbage/cribbage-server.sqlite` and its WAL files.

## 8. Updating

```bash
cd /opt/cribbage
git pull
npm ci
npm run build:deploy
sudo systemctl restart cribbage
curl http://127.0.0.1:8787/health
```
