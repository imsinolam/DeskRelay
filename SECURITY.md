# Security Policy

WeRelay can read local coding-agent conversations, send messages into real tasks, relay attachments, and expose a password-protected mobile interface. Treat it as a local administration tool, not as a public website.

## Reporting a vulnerability

Do not post credentials, setup links, task IDs, logs, screenshots, private repository names, server addresses, or exploit details in a public issue. Use the repository's **Security → Advisories → Report a vulnerability** flow. If that flow is unavailable, open a minimal issue that contains no sensitive evidence and asks the maintainer for a private contact channel.

## Sensitive local data

The default runtime directory is `~/.werelay`. It can contain:

- WeChat login credentials and synchronization state;
- recipient and context tokens;
- workspace/task mappings and queued messages;
- mobile authentication hashes and session secrets;
- logs, downloaded attachments and local file paths.

Never commit, upload, back up to a public bucket, or attach this directory to an issue. Rotate WeChat login state, the mobile password, SSH keys and any affected agent credentials if the directory or a setup link is exposed.

On POSIX systems, WeRelay enforces `0700` on runtime directories and `0600` on state, token, log, and attachment files, including atomic temporary files. Startup repairs permissions left by older installations. Windows deployments must rely on the current user account and appropriate filesystem ACLs.

## Public mobile access

- Prefer LAN-only mode when remote access is unnecessary.
- For internet access, run the WeRelay application relay behind HTTPS and let the Mac initiate the connection with `WERELAY_RELAY_URL`.
- Do not publish the local WeRelay port with cloudflared, SSH reverse forwarding, ngrok, frp, or another generic TCP/HTTP tunnel.
- Bind the public Relay process to the server loopback address and expose only the Nginx/Caddy HTTPS endpoint.
- Keep the Relay device token separate from the browser mobile password, store both outside the repository, and rotate either credential after exposure.
- Do not log full request URIs, cookies, request bodies, task content, setup tokens, or device credentials.
- The Relay must forward only WeRelay application APIs and must never create an independent CLI/ACP fallback session.
- The computer remains the owner of all tasks. If it sleeps, shuts down, or loses the active connection, the public page must report that the computer is offline rather than fall back to a hosted copy.

See [docs/架构设计/局域网与公网访问.md](docs/架构设计/局域网与公网访问.md) for a hardened reference deployment.

## Supported versions

| Version | Security updates |
| --- | --- |
| 2.x | Supported |
| 1.x and earlier | Not supported |

Security fixes are made on the current release line. Reproduce issues on the latest release or current `main` before reporting when possible.
