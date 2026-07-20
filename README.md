# Pie AES256 Hole

Pie AES256 Hole is a guided setup and management console for a small Linux appliance running Pi-hole, private remote access, curated blocklists, and optional VPN egress.

The current milestone combines automated bootstrap scripts with a private, appliance-hosted browser console that authenticates to Pi-hole v6, installs reviewed protection profiles through Pi-hole's supported API, rebuilds gravity, checks important services, and can remove only the changes it made.

## What works now

- Responsive five-step onboarding flow.
- Tailscale, WireGuard, and local-only connection choices.
- Balanced, Heavy, and Maximum protection profiles backed by a reviewed HaGeZi catalog.
- Shelf-device discovery form and safety messaging.
- Direct Pi-hole v6 API and version verification.
- In-memory Pi-hole authentication through a private-console-only local proxy; the administrator password is never persisted.
- Idempotent list application, gravity rebuild, and scoped rollback.
- Reddit, Stremio, Steam, and Facebook reachability checks after a profile change.
- Real prerequisite bootstrap scripts for macOS, Debian-family Linux appliances, and Windows.
- Tailscale authentication placed before appliance discovery and configuration.
- Linux controller container bound only to localhost, started before login, and published privately with persistent Tailscale Serve HTTPS.
- “Why was this blocked?” inspection with exact-domain allow and one-click undo.
- Keyboard-accessible native controls and reduced-motion support.
- Server-rendered smoke test and production build.

## Product boundaries

- The appliance server targets Raspberry Pi OS, Debian, and Ubuntu.
- macOS, Windows, and Linux are setup and enrolled-client platforms.
- Tailscale is the first remote-access integration.
- Native WireGuard and commercial VPN egress follow after safe rollback is proven.
- The admin console is private by default and must not be exposed directly to the public internet.

## Local development

Requires Node.js 22.13 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

## Bootstrap scripts

The GUI provides platform-specific downloads and copyable commands for:

- `public/install/bootstrap-macos.sh`
- `public/install/bootstrap-linux.sh`
- `public/install/bootstrap-windows.ps1`
- `public/install/install-controller-linux.sh`

The scripts detect existing requirements before installing anything. They use official Tailscale, Docker, and Pi-hole sources; request administrator approval only for system changes; require acceptance of Docker Desktop's separate terms; authenticate Tailscale before appliance setup; deploy persistent Pi-hole with a generated password and restart policy; and write a status JSON file for the future local control service.

The production shelf appliance path uses Linux, Docker Engine, and Compose. macOS and Windows can run a local test appliance through Docker Desktop, but Docker Desktop startup still depends on the desktop operating system's login/startup behavior. A controller-only installation may skip Docker and Pi-hole with `--skip-docker` on macOS or `-SkipDocker` on Windows.

The Linux bootstrap also installs the controller as a restartable Docker service on `127.0.0.1:3000` and publishes it only inside the authenticated tailnet with Tailscale Serve. The web console uses a same-origin proxy to call Pi-hole's supported HTTP API without weakening Pi-hole's CORS policy. The proxy accepts only a fixed set of typed Pi-hole operations, private LAN or Tailscale targets, and consoles hosted on localhost, private addresses, `.local`, or `.ts.net`. The public Sites deployment refuses management requests.

Validation:

```bash
pnpm test
pnpm lint
```

## Planned repository shape

```text
app/                 onboarding and management console
catalog/             curated blocklist metadata
docs/                architecture, threat model, and roadmap
cmd/                 future Go service and helper entrypoints
internal/            future appliance integration packages
installers/          future macOS, Windows, and Linux setup assistants
tests/               UI, integration, routing, and recovery tests
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for milestones and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the intended appliance design.

## Safety promise

Every DNS, firewall, and routing change must be previewed, backed up, tested, and automatically reverted when the console cannot confirm connectivity.
