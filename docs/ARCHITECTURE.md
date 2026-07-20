# Architecture

## Product model

Pie AES256 Hole has two surfaces:

1. A Linux shelf appliance that runs DNS filtering and network services without an interactive login.
2. A responsive admin console reached from an enrolled macOS, Windows, Linux, or mobile device.

The browser console is the shared GUI. Small native setup assistants may later handle discovery, privilege elevation, and client enrollment, but they should not duplicate the product UI.

## Runtime components

- **Pi-hole v6** provides DNS filtering and its supported administrative interfaces.
- **Control service** will be a small Go service with an embedded production frontend.
- **Privileged helper** exposes a narrow, auditable operation set for systemd, firewall, DNS, and routes.
- **SQLite** stores setup state, audit events, catalog metadata, and aggregate statistics.
- **Tailscale** is the default remote-access path and tailnet DNS transport.
- **WireGuard** is an optional self-managed remote-access path.
- **Provider adapters** isolate Proton, NordVPN, and AdGuard VPN egress behavior.

## Bootstrap boundary

Platform bootstrap scripts perform requirement detection and installation before the setup state machine begins. They authenticate Tailscale, install Docker when missing, generate a protected Pi-hole administrator password, write an idempotent Compose deployment with persistent configuration, pull the pinned official Pi-hole image, start it with `restart: unless-stopped`, and verify the admin endpoint. The Linux appliance path enables host services at boot and emits `/var/lib/pieaes256hole/bootstrap-status.json`; desktop test appliances use a per-user application-data directory.

The browser console verifies Pi-hole v6 through `/api/auth` and `/api/info/version`. It holds the short-lived Pi-hole session ID in memory, uses `/api/lists` for blocklist changes, and invokes `/api/action/gravity` after a change. It records which URLs it added and uses `/api/lists:batchDelete` for a scoped rollback; pre-existing lists are preserved. The administrator password is cleared after authentication and is never persisted by this console.

The browser still cannot read the appliance filesystem or invoke privileged host commands. A future local control service will verify the signed bootstrap status and expose typed Docker, systemd, Tailscale, firewall, DNS, and reboot health endpoints. Browser reachability checks are clearly labeled and never substitute for host inspection.

The console must never synthesize a LAN hostname or admin URL. An appliance address begins empty, is supplied by discovery or the user, and must respond before it can appear in the handoff. Browser-only reachability is not sufficient to identify Pi-hole; authoritative product and version verification belongs to the local control service.

## Trust boundaries

- The browser never executes shell commands.
- Pi-hole credentials travel directly from the browser to the user-selected Pi-hole address and are not sent to the hosted console.
- The control service never runs as root.
- The privileged helper accepts typed operations, not arbitrary commands.
- Provider secrets and tunnel private keys are encrypted at rest.
- The admin service binds to explicitly selected LAN and private-overlay interfaces.
- Public ingress is disabled by default.

## Setup state machine

Each operation advances through `planned`, `backed_up`, `applying`, `verifying`, and `committed`. Failure before commit triggers a rollback. Network changes also start an independent watchdog timer so loss of the web session cannot strand the appliance.

## Networking model

Remote access, DNS filtering, and internet egress are separate user choices. They must use distinct routes and health checks. Management traffic always receives a recovery route that bypasses optional commercial VPN egress.

## Supported server baseline

The first supported target is a 64-bit Raspberry Pi OS or Debian appliance using systemd and wired Ethernet. Ubuntu LTS follows using the same service model. Other server operating systems are out of scope until the recovery and integration suites can cover them.
