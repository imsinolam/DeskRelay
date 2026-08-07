# Security Policy

DeskRelay can read local coding-agent conversations, send messages into real tasks, relay attachments, and expose a password-protected mobile interface. Treat it as a local administration tool, not as a general public website.

## Reporting a vulnerability

Do not post credentials, setup links, task IDs, logs, screenshots, private repository names, server addresses, or exploit details in a public issue. Use the repository's **Security → Advisories → Report a vulnerability** flow. If that flow is unavailable, open a minimal issue without sensitive evidence and ask the maintainer for a private contact channel.

## Sensitive local data

The default runtime directory is `~/.deskrelay`. It can contain:

- WeChat login credentials and synchronization state;
- recipient and context tokens;
- workspace/task mappings and queued messages;
- mobile authentication hashes and session secrets;
- logs, downloaded attachments and local file paths.

Never commit, upload, back up to a public bucket, or attach this directory to an issue. Rotate WeChat login state, the mobile password, Relay device token, SSH keys and affected Agent credentials if runtime data or a setup link is exposed.

## Connection model

DeskRelay has three remote paths:

- **WeChat ClawBot**: the Mac actively long-polls WeChat iLink;
- **LAN web**: the browser directly connects to the Mac inside the local network;
- **Public web**: the Mac actively long-polls a self-hosted DeskRelay Relay.

The public mode follows the same outbound-connection principle as ClawBot, but it does not reuse WeChat infrastructure. Neither ClawBot nor Relay requires an inbound connection to a local Mac port.

## Public mobile access

- Prefer LAN-only mode when internet access is unnecessary.
- For internet access, run the DeskRelay application Relay behind HTTPS and let the Mac initiate the connection with `DESKRELAY_RELAY_URL`.
- Do not publish the local DeskRelay port with cloudflared, SSH reverse forwarding, ngrok, frp, or another generic TCP/HTTP tunnel.
- Bind the Relay process to the server loopback address and expose only the Nginx/Caddy HTTPS endpoint.
- Keep the Relay device token separate from the browser mobile password; store both outside the repository and rotate either credential after exposure.
- Do not log request URIs containing setup parameters, cookies, request bodies, task content, attachments or device credentials.
- Relay requests must remain limited to DeskRelay `/api/` routes. Do not add arbitrary URL proxying, target host selection, TCP forwarding or local port selection.
- Preserve command IDs, expiry checks and the local command journal so retries cannot execute a non-idempotent action twice.
- The Relay must never create an independent CLI/ACP fallback session. If the computer or real Agent owner is unavailable, report it as offline or unavailable.

### Relay trust boundary

The application Relay reduces exposure compared with a generic tunnel, but it is not end-to-end encrypted. HTTPS protects traffic in transit; the Relay process and a server administrator with sufficient privileges can still access requests and responses while they are being forwarded.

Use a server you control and trust, minimize administrator access, keep the operating system and dependencies updated, disable request-body logging, and prefer LAN mode for highly sensitive work.

See [Mobile web and public access](../docs/guides/remote-access.md) for the deployment and verification checklist.

## Supported versions

| Version | Security updates |
| --- | --- |
| 2.x | Supported |
| 1.x and earlier | Not supported |

Security fixes are made on the current release line. Reproduce issues on the latest release or current `main` before reporting when possible.
