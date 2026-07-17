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

By default it targets `root@172.239.170.10` using `../../keys/strongcribbage_admin_ed25519`, builds locally, uploads the artifact, installs the systemd unit, writes the Caddy reverse proxy for `cribbage.strongcribbage.com` and `strongcribbage.com`, restarts services, and checks health.

On the build machine:

```bash
cd /path/to/cribbage
git checkout server
npm ci
npm run build:deploy
npm run package:server
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
cribbage.strongcribbage.com, strongcribbage.com {
	encode zstd gzip
	@api path /api/* /health
	handle @api {
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		root * /opt/cribbage/dist
		try_files {path} /index.html
		file_server
	}
}
```

Then reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://cribbage.strongcribbage.com/health
```

Caddy serves the browser client and the Rust API handles only game routes.

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
