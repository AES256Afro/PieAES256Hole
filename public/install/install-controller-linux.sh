#!/usr/bin/env bash
set -euo pipefail

PRODUCT="Pie AES256 Hole controller"
SOURCE_ARCHIVE="https://github.com/AES256Afro/PieAES256Hole/archive/refs/heads/main.tar.gz"
INSTALL_ROOT="/opt/pieaes256hole/controller"
SOURCE_DIR="${INSTALL_ROOT}/source"
COMPOSE_FILE="${INSTALL_ROOT}/compose.yaml"

say() { printf '\n[%s] %s\n' "$PRODUCT" "$1"; }
fail() { printf '\n[%s] %s\n' "$PRODUCT" "$1" >&2; exit "${2:-1}"; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ "$(uname -s)" == "Linux" ]] || fail "This controller installer is for Linux." 2
if [[ "$EUID" -ne 0 ]]; then
  have sudo || fail "Run this installer from an administrator account with sudo." 3
  exec sudo bash "$0" "$@"
fi

have curl || fail "curl is required. Run the main Linux bootstrap first." 10
have tar || fail "tar is required. Run the main Linux bootstrap first." 11
have docker || fail "Docker is missing. Run the main Linux bootstrap first." 12
have tailscale || fail "Tailscale is missing. Run the main Linux bootstrap first." 13
docker info >/dev/null 2>&1 || fail "Docker is installed but its daemon is not running." 14
tailscale status >/dev/null 2>&1 || fail "Authenticate this device with Tailscale before installing the controller." 15

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

say "Downloading the reviewed controller source"
curl --fail --location --silent --show-error "$SOURCE_ARCHIVE" --output "$TEMP_DIR/source.tar.gz"
mkdir -p "$TEMP_DIR/unpacked"
tar -xzf "$TEMP_DIR/source.tar.gz" --strip-components=1 -C "$TEMP_DIR/unpacked"
test -s "$TEMP_DIR/unpacked/Dockerfile" || fail "The controller archive did not contain its Dockerfile." 20

say "Building the local controller image"
install -d -m 0755 "$INSTALL_ROOT"
rm -rf "$SOURCE_DIR"
mv "$TEMP_DIR/unpacked" "$SOURCE_DIR"
docker build --pull --tag pieaes256hole-controller:local "$SOURCE_DIR"

cat >"$COMPOSE_FILE" <<'EOF'
services:
  controller:
    container_name: pieaes256hole-controller
    image: pieaes256hole-controller:local
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped
EOF
chmod 0644 "$COMPOSE_FILE"
docker compose -f "$COMPOSE_FILE" up -d

say "Waiting for the controller"
for _ in {1..60}; do
  curl --fail --silent --output /dev/null http://127.0.0.1:3000/ && break
  sleep 2
done
if ! curl --fail --silent --output /dev/null http://127.0.0.1:3000/; then
  docker compose -f "$COMPOSE_FILE" logs --tail=100 controller >&2
  fail "The controller did not become ready. Its source remains in ${SOURCE_DIR}." 21
fi

say "Publishing private HTTPS access through Tailscale Serve"
if ! tailscale serve --bg --yes --https=443 http://127.0.0.1:3000; then
  printf '\nTailscale needs one tailnet approval before HTTPS can be enabled.\n' >&2
  printf 'Open the approval link printed above, then rerun:\n' >&2
  printf '  sudo tailscale serve --bg --https=443 http://127.0.0.1:3000\n' >&2
  exit 22
fi

DNS_NAME="$(tailscale status --json | sed -n 's/.*"DNSName": "\([^"]*\)".*/\1/p' | head -n1 | sed 's/\.$//')"
[[ -n "$DNS_NAME" ]] || fail "The controller is running, but Tailscale did not report its MagicDNS name." 23
CONTROLLER_URL="https://${DNS_NAME}"

install -d -m 0750 /var/lib/pieaes256hole
cat >/var/lib/pieaes256hole/controller-status.json <<EOF
{
  "schemaVersion": 1,
  "controllerRunning": true,
  "startOnBoot": true,
  "tailscaleServe": true,
  "controllerUrl": "${CONTROLLER_URL}"
}
EOF
chmod 0640 /var/lib/pieaes256hole/controller-status.json

say "Controller installation complete"
printf 'Private controller: %s\n' "$CONTROLLER_URL"
printf 'It starts before login and is reachable only by devices allowed on this tailnet.\n'
