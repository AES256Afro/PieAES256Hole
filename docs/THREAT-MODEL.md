# Threat model

## Protected assets

- DNS query history and client identities.
- Pi-hole administrative sessions.
- Tailscale enrollment credentials.
- WireGuard and provider private keys.
- Firewall, routing, and resolver configuration.
- Backup and recovery material.

## Primary risks

- Public exposure of the admin interface or DNS resolver.
- Command injection through imported configuration or blocklist values.
- DNS or IPv6 leaks around a commercial VPN tunnel.
- Loss of management access after a firewall or route change.
- Malicious or compromised blocklist updates.
- Secrets appearing in logs or diagnostic downloads.
- Cross-site request forgery or session theft from the admin console.

## Required controls

- Local or private-overlay access by default; no public listener.
- Strong local administrator credential, passkey support, and recovery codes.
- Typed privileged operations with strict input validation.
- Encrypted secret storage and comprehensive redaction tests.
- Signed catalog metadata, HTTPS retrieval, checksums, and change thresholds.
- Automatic network rollback watchdog independent of the browser session.
- IPv4, IPv6, DNS, and management-path verification before commit.
- Audit events for authentication and every configuration mutation.
- Rate limiting and origin protection on administrative endpoints.

## Out of scope for the first release

- Defending a fully compromised root operating system.
- Public multi-tenant hosting.
- Anonymous remote administration.
- Automatic router firmware changes.
