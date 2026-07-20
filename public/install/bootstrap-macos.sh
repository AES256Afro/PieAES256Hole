#!/bin/bash
set -euo pipefail

PRODUCT="Pie AES256 Hole"
STATUS_DIR="${HOME}/.pieaes256hole"
STATUS_FILE="${STATUS_DIR}/bootstrap-status.json"
INSTALL_DOCKER=true
INSTALL_PIHOLE=true

for argument in "$@"; do
  case "$argument" in
    --skip-docker) INSTALL_DOCKER=false; INSTALL_PIHOLE=false ;;
    --skip-pihole) INSTALL_PIHOLE=false ;;
  esac
done

say() { printf '\n[%s] %s\n' "$PRODUCT" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This installer is for macOS.\n' >&2
  exit 2
fi

mkdir -p "$STATUS_DIR"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

say "Checking this Mac"
MACOS_VERSION="$(sw_vers -productVersion)"
ARCH="$(uname -m)"
printf 'macOS %s on %s\n' "$MACOS_VERSION" "$ARCH"

if ! xcode-select -p >/dev/null 2>&1; then
  say "Apple Command Line Tools are required"
  xcode-select --install || true
  printf 'Finish the Apple installer, then run this script again.\n'
  exit 10
fi

TAILSCALE_INSTALLED=false
if have tailscale || [[ -d /Applications/Tailscale.app ]]; then
  TAILSCALE_INSTALLED=true
else
  say "Installing Tailscale from pkgs.tailscale.com"
  curl --fail --location --silent --show-error \
    "https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg" \
    --output "$TEMP_DIR/Tailscale.pkg"
  sudo installer -pkg "$TEMP_DIR/Tailscale.pkg" -target /
  TAILSCALE_INSTALLED=true
fi

say "Opening Tailscale authentication"
open -a Tailscale || true

TAILSCALE_CLI=""
if have tailscale; then
  TAILSCALE_CLI="$(command -v tailscale)"
elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
  TAILSCALE_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi

TAILSCALE_AUTHENTICATED=false
if [[ -n "$TAILSCALE_CLI" ]]; then
  if "$TAILSCALE_CLI" status >/dev/null 2>&1; then
    TAILSCALE_AUTHENTICATED=true
  else
    printf 'Your browser may open. Sign in on the official Tailscale page.\n'
    "$TAILSCALE_CLI" up || true
    if "$TAILSCALE_CLI" status >/dev/null 2>&1; then
      TAILSCALE_AUTHENTICATED=true
    fi
  fi
else
  printf 'Complete sign-in in the Tailscale app, then run this script again to verify it.\n'
fi

DOCKER_INSTALLED=false
DOCKER_RUNNING=false
if have docker || [[ -d /Applications/Docker.app ]]; then
  DOCKER_INSTALLED=true
elif [[ "$INSTALL_DOCKER" == true ]]; then
  say "Docker Desktop is missing"
  printf 'Docker Desktop has separate license terms. Review them at:\n'
  printf 'https://www.docker.com/legal/docker-subscription-service-agreement/\n\n'
  if [[ -t 0 ]]; then
    read -r -p "Install Docker Desktop and accept its displayed terms? [y/N] " REPLY
  else
    REPLY="n"
  fi
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    case "$ARCH" in
      arm64) DOCKER_ARCH="arm64" ;;
      x86_64) DOCKER_ARCH="amd64" ;;
      *) printf 'Unsupported Mac architecture: %s\n' "$ARCH" >&2; exit 3 ;;
    esac
    curl --fail --location --silent --show-error \
      "https://desktop.docker.com/mac/main/${DOCKER_ARCH}/Docker.dmg" \
      --output "$TEMP_DIR/Docker.dmg"
    hdiutil attach "$TEMP_DIR/Docker.dmg" -nobrowse -quiet
    trap 'hdiutil detach /Volumes/Docker -quiet >/dev/null 2>&1 || true; rm -rf "$TEMP_DIR"' EXIT
    sudo /Volumes/Docker/Docker.app/Contents/MacOS/install \
      --accept-license --user="$(id -un)"
    hdiutil detach /Volumes/Docker -quiet
    trap 'rm -rf "$TEMP_DIR"' EXIT
    DOCKER_INSTALLED=true
    open -a Docker
  fi
fi

if [[ "$DOCKER_INSTALLED" == true ]]; then
  have docker || export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
  if ! docker info >/dev/null 2>&1; then
    open -a Docker || true
    say "Waiting for Docker Desktop"
    for _ in {1..60}; do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  docker info >/dev/null 2>&1 && DOCKER_RUNNING=true
fi

PIHOLE_INSTALLED=false
PIHOLE_RUNNING=false
PIHOLE_ADMIN_URL=""
PIHOLE_PASSWORD_FILE=""

if [[ "$INSTALL_PIHOLE" == true && "$DOCKER_RUNNING" == true ]]; then
  say "Installing Pi-hole in Docker"
  PIHOLE_DIR="${STATUS_DIR}/pihole"
  PIHOLE_PASSWORD_FILE="${PIHOLE_DIR}/pihole_webpasswd"
  mkdir -p "${PIHOLE_DIR}/etc-pihole"
  chmod 700 "$PIHOLE_DIR"
  if [[ ! -s "$PIHOLE_PASSWORD_FILE" ]]; then
    umask 077
    openssl rand -base64 24 | tr -d '\n' > "$PIHOLE_PASSWORD_FILE"
    printf '\n' >> "$PIHOLE_PASSWORD_FILE"
  fi
  chmod 600 "$PIHOLE_PASSWORD_FILE"

  WEB_PORT=80
  if ! docker container inspect pihole >/dev/null 2>&1; then
    if lsof -nP -iTCP:53 -sTCP:LISTEN -iUDP:53 2>/dev/null | tail -n +2 | grep -q .; then
      printf 'DNS port 53 is already in use. Pi-hole was not started to avoid disrupting the existing DNS service.\n' >&2
      exit 40
    fi
    if lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .; then
      WEB_PORT=8080
    fi
  elif docker port pihole 80/tcp >/dev/null 2>&1; then
    WEB_PORT="$(docker port pihole 80/tcp | head -n1 | sed 's/.*://')"
  fi

  TIMEZONE="$(readlink /etc/localtime 2>/dev/null | sed 's#^.*/zoneinfo/##')"
  [[ -n "$TIMEZONE" ]] || TIMEZONE="UTC"
  cat > "${PIHOLE_DIR}/compose.yaml" <<EOF
services:
  pihole:
    container_name: pihole
    image: pihole/pihole:2026.05.0
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "${WEB_PORT}:80/tcp"
    environment:
      TZ: "${TIMEZONE}"
      WEBPASSWORD_FILE: pihole_webpasswd
      FTLCONF_dns_listeningMode: "all"
      FTLCONF_dns_upstreams: "1.1.1.1;9.9.9.9"
    volumes:
      - ./etc-pihole:/etc/pihole
    secrets:
      - pihole_webpasswd
    restart: unless-stopped
secrets:
  pihole_webpasswd:
    file: ./pihole_webpasswd
EOF
  chmod 600 "${PIHOLE_DIR}/compose.yaml"
  docker compose -f "${PIHOLE_DIR}/compose.yaml" pull
  docker compose -f "${PIHOLE_DIR}/compose.yaml" up -d
  PIHOLE_INSTALLED=true

  for _ in {1..60}; do
    curl --fail --silent --output /dev/null "http://127.0.0.1:${WEB_PORT}/admin/" && break
    sleep 2
  done
  if curl --fail --silent --output /dev/null "http://127.0.0.1:${WEB_PORT}/admin/"; then
    PIHOLE_RUNNING=true
    TAILSCALE_IP="$($TAILSCALE_CLI ip -4 2>/dev/null || true)"
    [[ -n "$TAILSCALE_IP" ]] || TAILSCALE_IP="localhost"
    PIHOLE_ADMIN_URL="http://${TAILSCALE_IP}:${WEB_PORT}/admin/"
  else
    docker compose -f "${PIHOLE_DIR}/compose.yaml" logs --tail=80 pihole >&2
    printf 'Pi-hole did not become ready. Its data was preserved at %s.\n' "$PIHOLE_DIR" >&2
    exit 41
  fi
fi

cat > "$STATUS_FILE" <<EOF
{
  "schemaVersion": 1,
  "platform": "macos",
  "role": "local-test-appliance",
  "commandLineTools": true,
  "tailscaleInstalled": ${TAILSCALE_INSTALLED},
  "tailscaleAuthenticated": ${TAILSCALE_AUTHENTICATED},
  "dockerInstalled": ${DOCKER_INSTALLED},
  "dockerRunning": ${DOCKER_RUNNING},
  "piholeInstalled": ${PIHOLE_INSTALLED},
  "piholeRunning": ${PIHOLE_RUNNING},
  "piholeAdminUrl": "${PIHOLE_ADMIN_URL}",
  "piholePasswordFile": "${PIHOLE_PASSWORD_FILE}"
}
EOF

say "Bootstrap check complete"
printf 'Status saved to %s\n' "$STATUS_FILE"
if [[ "$TAILSCALE_AUTHENTICATED" != true ]]; then
  printf 'Action needed: finish Tailscale sign-in, then run this script again.\n'
  exit 20
fi
if [[ "$INSTALL_DOCKER" == true && "$DOCKER_RUNNING" != true ]]; then
  printf 'Action needed: finish Docker Desktop first-run setup, then run this script again.\n'
  exit 21
fi
if [[ "$INSTALL_PIHOLE" == true && "$PIHOLE_RUNNING" != true ]]; then
  printf 'Action needed: Pi-hole is not running. Review the installer output.\n'
  exit 22
fi
printf 'Pi-hole admin: %s\n' "$PIHOLE_ADMIN_URL"
printf 'Admin password file: %s\n' "$PIHOLE_PASSWORD_FILE"
printf 'This Mac is ready as a local test appliance. Docker Desktop still requires a user login after reboot.\n'
