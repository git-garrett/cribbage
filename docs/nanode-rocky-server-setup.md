# Cribbage Server Setup on Rocky Linux

This deploys the static browser client and native Rust API on one small Rocky Linux Nanode. Caddy serves `dist/` and proxies `/api/*` and `/health` to the Rust process.

## 1. Base Packages

```bash
sudo dnf update -y
sudo dnf install -y git curl firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 2. Install Rust for the native production build

The deployment archive contains the Rust API source and checked-in runtime
assets. It is compiled on the x86_64 Nanode so the release binary matches the
production architecture. Node is not required on the server.

```bash
sudo dnf install -y rust cargo gcc
rustc --version
cargo --version
```

## 3. Install Caddy

```bash
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable @caddy/caddy -y
sudo dnf install -y caddy
sudo systemctl enable --now caddy
```

## 4. Build the Browser Client Off-Box

Do not build the browser client on a 1 GB Nanode. Build the Vite client on a
laptop, workstation, or CI runner, then upload the generated artifact. The
small native Rust API is compiled on the Nanode from the package's locked
source tree to produce the correct Linux binary.

The easiest path is the deploy helper:

```bash
scripts/deploy-nanode.sh deploy
```

By default it targets `root@172.239.170.10` using `../../keys/strongcribbage_admin_ed25519`, builds locally, uploads the artifact, installs the systemd unit, writes the Caddy routes for the game at `cribbage.strongcribbage.com` and the public landing page at `strongcribbage.com`, restarts services, and checks health.

The helper accepts deployments only from a clean local `master` that exactly
matches `origin/master`. It runs the Python, TypeScript, and Rust checks and
build, compiles the Git commit into the server binary, and verifies that both
the host-local and public health endpoints report the same commit.

On the build machine:

```bash
cd /path/to/cribbage
git switch master
git pull --ff-only origin master
npm ci
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm run qa:predeploy
```

This creates `cribbage-server-16.0.0.tgz` containing:

- `dist/` static client
- Rust workspace source and lockfile, compiled on the Nanode with `cargo
  build --locked --release`
- Rust-owned runtime lookup tables under `rust/cribbage-shadow-engine/assets/`
- this setup document

Upload it:

```bash
scp cribbage-server-16.0.0.tgz YOUR_USER@your-domain.example.com:/tmp/
```

## 5. Deploy the App

```bash
sudo mkdir -p /opt/cribbage /var/lib/cribbage
sudo chown -R "$USER":"$USER" /opt/cribbage /var/lib/cribbage
tar -xzf /tmp/cribbage-server-16.0.0.tgz -C /opt/cribbage
```

No `npm ci` or Node runtime is required on the Nanode. The deploy helper runs
the locked Rust release build there after unpacking the artifact.

## 6. Configure systemd

Create `/etc/systemd/system/cribbage.service`:

```ini
[Unit]
Description=Cribbage Rust API and static client
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cribbage
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=CRIBBAGE_MODEL_ROOT=/opt/cribbage
Environment=CRIBBAGE_DATA_DIR=/var/lib/cribbage
Environment=CRIBBAGE_REQUIRE_AUTH=true
Environment=CRIBBAGE_PUBLIC_ORIGIN=https://cribbage.strongcribbage.com
Environment=CRIBBAGE_MAIL_FROM=hello@strongcribbage.com
Environment="CRIBBAGE_MAIL_FROM_NAME=Strong Cribbage"
Environment=CRIBBAGE_MAIL_REPLY_TO=founder@evenvision.com
EnvironmentFile=-/etc/cribbage/cribbage.env
ExecStart=/opt/cribbage/rust/target/release/cribbage-api
Restart=always
RestartSec=3
User=cribbage
Group=cribbage
UMask=0077
CapabilityBoundingSet=
RemoveIPC=true
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectHome=true
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
ProtectSystem=strict
ReadWritePaths=/var/lib/cribbage
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
ProtectClock=true
ProtectControlGroups=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

Create `/etc/cribbage/cribbage.env` before starting the service. Keep it owned
by root and outside the deployment archive:

```dotenv
SENDGRID_API_KEY=SG_REPLACE_ME
CRIBBAGE_AUTH_PEPPER=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
CRIBBAGE_AUTH_ADMIN_KEY=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
```

```bash
sudo chown root:root /etc/cribbage/cribbage.env
sudo chmod 600 /etc/cribbage/cribbage.env
```

The API refuses to start in required-authentication mode without the SendGrid
key and authentication pepper. The admin key protects invitation issuance and
is never sent to the browser.

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
cribbage.strongcribbage.com {
	encode zstd gzip
	@api path /api/* /health
	handle @api {
		reverse_proxy 127.0.0.1:8787
	}
	root * /opt/cribbage/dist
	@assets path /assets/*
	handle @assets {
		file_server
	}
	handle {
		header Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
		try_files {path} /index.html
		file_server
	}
}

strongcribbage.com {
	encode zstd gzip
	root * /opt/cribbage/dist
	try_files {path} /coming-soon.html
	file_server
}
```

Then reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://cribbage.strongcribbage.com/health
```

Caddy serves the browser client and routes `/api/*` and `/health` to the Rust
API only on `cribbage.strongcribbage.com`. HTML is never cached, and missing
hashed assets return 404 instead of falling through to `index.html`. Deploys
retain earlier hashed assets so a client with older HTML can finish loading.
The apex domain serves the public landing page in `dist/coming-soon.html`.

## 8. Operating Notes

- The public app defaults to the Rust-backed browser client.
- Use `?tag=anything` to attach an arbitrary tag to uploaded game logs.
- The browser no longer contains a local AI engine; all gameplay decisions use the Rust API.
- Completed-game leaderboard records persist in `/var/lib/cribbage/leaderboard-games.tsv`.

## 9. Updating

Use the helper:

```bash
scripts/deploy-nanode.sh deploy
```

Manual equivalent on the build machine:

```bash
cd /path/to/cribbage
git switch master
git pull --ff-only origin master
npm ci
npm run qa:predeploy
scp cribbage-server-16.0.0.tgz YOUR_USER@your-domain.example.com:/tmp/
```

On the Nanode:

```bash
sudo systemctl stop cribbage
sudo rm -rf /opt/cribbage/dist /opt/cribbage/server-dist /opt/cribbage/package.json /opt/cribbage/rust
tar -xzf /tmp/cribbage-server-16.0.0.tgz -C /opt/cribbage
cd /opt/cribbage/rust && cargo build --locked --release --manifest-path cribbage-api/Cargo.toml
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
