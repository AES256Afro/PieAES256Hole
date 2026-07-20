# Roadmap

## M0 — Experience and bootstrap prototype (complete)

- Interactive onboarding flow.
- Connection and protection choices.
- Safety, privacy, and recovery language.
- Responsive layout and production smoke test.
- Platform bootstrap scripts for missing requirements.
- Tailscale authentication before appliance discovery.
- Explicit access handoff after final checks.

## M1 — Pi-hole API protection control (current)

- Verify Pi-hole v6 rather than accepting generic web reachability.
- Authenticate with a short-lived in-memory session.
- Apply reviewed Balanced, Heavy, and Maximum profiles idempotently.
- Add optional Apple and Microsoft native telemetry lists.
- Validate manual list URLs, rebuild gravity, and roll back only newly added lists.
- Check Reddit, Stremio, Steam, and Facebook reachability after changes.
- Install the console on the Linux appliance with start-on-boot and private Tailscale HTTPS.
- Explain list matches for one domain, add an exact allow, and undo it.

## M2 — Read-only appliance inspection

- Discover a Linux device over the LAN.
- Pair with a one-time code and SSH host-key confirmation.
- Detect operating system, architecture, DNS port conflicts, storage, Pi-hole, Tailscale, firewall, and systemd.
- Produce an installation plan without changing the device.

## M3 — Safe Pi-hole installation

- Install or adopt Pi-hole on Raspberry Pi OS and Debian.
- Create configuration backups before mutation.
- Stream structured progress to the console.
- Configure service startup, firewall boundaries, and admin recovery.
- Verify operation after reboot.

## M4 — Tailscale onboarding

- Capture the official browser sign-in URL.
- Configure a stable device name and private DNS.
- Generate LAN, Tailscale IP, and MagicDNS admin links.
- Produce device enrollment links and QR codes.
- Test DNS from an enrolled client.

## M5 — Protection catalog expansion

- Signed blocklist catalog with license and provenance metadata.
- Essential, Balanced, Strict, Family, and Security-only profiles.
- Manual URL import, validation, overlap analysis, and health scoring.
- Per-device groups, expiring temporary allows, and query-log correlation.

## M6 — Native WireGuard

- Client profile and QR generation.
- Split and full tunnel modes.
- Key revocation and rotation.
- IPv4/IPv6 leak tests and rollback watchdog.

## M7 — Commercial VPN egress

- Proton standard WireGuard configuration import.
- NordVPN official Linux client or supported OpenVPN configuration.
- AdGuard VPN supported IPsec or TrustTunnel integration.
- Per-device egress policy, kill switch, and failover.

## M8 — Analytics and operations

- Incremental long-term DNS statistics inspired by PiHoleLongTermStats.
- Health timeline, backups, restore, updates, diagnostics, and storage controls.
- Signed release packages and Raspberry Pi/x86 appliance images.
