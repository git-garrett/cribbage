# Remote workbench

`https://workbench.strongcribbage.com` uses Cloudflare Tunnel and Access.
Cloudflare authenticates the visitor, then an outbound connector on the Mac
forwards the request to `127.0.0.1:8766`. The Mac still supplies the live reports
and must remain awake, logged in, and online. This change replaces only the
Linode web gateway; it does not move training or databases into the cloud.

Access uses an email one-time PIN, allows only `founder@evenvision.com`, and
expires sessions after 12 hours. Protect the entire hostname, including assets,
health and APIs. Do not add public bypass policies. The connector also validates
Access JWTs for this application's audience, so a missing edge policy fails
closed. The backend binds only to loopback and remains owned by
`scripts/local-runtime.sh`; the connector does not start or stop training.

## Deployment

Follow `production-workflow.md`: branch, PR, review, required checks, merge,
then deploy these files from a clean synchronized `master`. Do not run
`deploy-nanode.sh`, which deploys the separate game application.

Use the `status_monitor` project's credential-backed provisioning helpers.
Keep tokens, cookies and private backups outside Git and tool output. Use the
existing account; do not purchase plans, servers, backups or add-ons without
separate spending approval. Cloudflare Tunnel and Access Free cover this one
user. Check account subscriptions before and after configuration.

1. Create the Access organization if absent using
   `POST /accounts/ACCOUNT/access/organizations`. Set name `Strong Cribbage`,
   auth domain `strongcribbage.cloudflareaccess.com`, and session `12h`.
   Create or reuse the `onetimepin` identity provider.
2. Create a `self_hosted` Access application for
   `workbench.strongcribbage.com`, with only that identity provider. Add one
   Allow policy whose include rule is exactly
   `{"email":{"email":"founder@evenvision.com"}}`. Record the application's
   ID and audience tag. Verify there are no bypass or allow-everyone policies.
3. Create a remotely managed tunnel named `strongcribbage-workbench` with
   `config_src: cloudflare`. Configure its ingress as below, replacing `AUD`:

   ```json
   {
     "config": {
       "ingress": [
         {
           "hostname": "workbench.strongcribbage.com",
           "service": "http://127.0.0.1:8766",
           "originRequest": {
             "httpHostHeader": "127.0.0.1:8766",
             "access": {
               "required": true,
               "teamName": "strongcribbage",
               "audTag": ["AUD"]
             }
           }
         },
         {"service": "http_status:404"}
       ]
     }
   }
   ```

   The Host rewrite is required by the backend's DNS-rebinding protection.
   Save the tunnel token in an owner-only file, never a command argument.
4. Download the official `cloudflared` release for the Mac's architecture,
   verify its SHA-256 against the release asset digest, and install the binary
   in a persistent location. Use version 2025.4.0 or newer for `--token-file`.
   Run `python3 scripts/remote-workbench/install-cloudflare.py BINARY TOKEN_FILE`.
   It installs `com.strongcribbage.workbench-cloudflare`, reconnects after
   interruptions/login, and retains the old SSH service during verification.
5. Save the existing DNS record for rollback. After confirming the Access
   policy and a healthy connector, replace only the workbench record with a
   proxied CNAME to `TUNNEL_ID.cfargotunnel.com`, TTL automatic. Leave the game
   application's DNS and server unchanged.

## Verification and retirement

Check anonymous `/`, `/health`, `/api/jobs`, `/api/report`, `/app.js`,
`/style.css` and `/favicon.svg`: each must require Access authentication without
returning workbench data. In Safari, sign in with the allowed email and verify
both size-study models and a fresh report. Verify JSON archive/elevate requests
still require `X-Workbench-Request: 1`, and cross-origin forms cannot write.
Confirm the backend listens only on loopback. Restart the connector and check
that fresh authenticated requests recover. Check subscriptions remain free.
If a temporary service token was used for API verification, remove its policy
and revoke the token before declaring migration complete.

Keep the old gateway available until these checks pass. If they fail, restore
the saved A record and keep the old SSH connector running. The legacy gateway
configuration is documented in [remote-workbench-legacy.md](remote-workbench-legacy.md).

After successful verification, save a private copy of the dedicated gateway's
configuration and deployment metadata. Confirm no other DNS records or services
use it. Unload and remove `com.strongcribbage.workbench-tunnel.plist`, then delete
only the dedicated workbench Nanode and its unused firewall. Shutting it down
alone does not stop Linode charges. Do not buy a snapshot for retirement. Keep
the Mac backend and training supervisor running.

For connector status, use
`launchctl print gui/$(id -u)/com.strongcribbage.workbench-cloudflare`.
The warning log is `~/.config/strongcribbage-workbench/cloudflare.log`; rotate it
if needed. Token credentials are stored mode 0600 under the same private
directory. Updates are deliberate: verify a new official binary, replace it and
restart the connector. To revoke remote access, stop this connector or remove
the Access allow policy; neither action affects compute jobs.

References: [Tunnel API setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/),
[Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[Token-file support](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/#token-file).
