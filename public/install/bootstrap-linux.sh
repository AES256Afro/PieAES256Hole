#!/usr/bin/env bash
set -euo pipefail

PRODUCT="Pie AES256 Hole"
ROLE="appliance"
APPLIANCE_HOSTNAME="$(hostname -s)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="${2:?--role requires a value}"; shift 2 ;;
    --hostname) APPLIANCE_HOSTNAME="${2:?--hostname requires a value}"; shift 2 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

say() { printf '\n[%s] %s\n' "$PRODUCT" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'This installer is for Linux.\n' >&2
  exit 2
fi
if [[ ! -r /etc/os-release ]]; then
  printf 'Cannot identify this Linux distribution.\n' >&2
  exit 3
fi

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu|raspbian) ;;
  *) printf 'Supported appliance systems are Debian, Ubuntu, and Raspberry Pi OS. Found: %s\n' "${ID:-unknown}" >&2; exit 4 ;;
esac

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
say "Checking ${PRETTY_NAME:-Linux} on $(uname -m)"

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg openssl

if ! have tailscale; then
  say "Installing Tailscale from tailscale.com"
  curl --fail --location --silent --show-error \
    https://tailscale.com/install.sh --output "$TEMP_DIR/install-tailscale.sh"
  sudo sh "$TEMP_DIR/install-tailscale.sh"
fi

if ! sudo tailscale status >/dev/null 2>&1; then
  say "Authenticate this device with Tailscale"
  if [[ "$ROLE" == "appliance" ]]; then
    sudo tailscale up --accept-dns=false --hostname="$APPLIANCE_HOSTNAME"
  else
    sudo tailscale up
  fi
fi

if ! have docker; then
  say "Installing Docker Engine from Docker's official apt repository"
  CONFLICTS="$(dpkg-query -W -f='${binary:Package}\n' docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc 2>/dev/null || true)"
  if [[ -n "$CONFLICTS" ]]; then
    printf 'Conflicting container packages were found:\n%s\n' "$CONFLICTS" >&2
    printf 'Remove or migrate them deliberately before this installer changes Docker.\n' >&2
    exit 30
  fi

  sudo install -m 0755 -d /etc/apt/keyrings
  DOCKER_ID="$ID"
  [[ "$DOCKER_ID" == "raspbian" ]] && DOCKER_ID="debian"
  sudo curl --fail --location --silent --show-error \
    "https://download.docker.com/linux/${DOCKER_ID}/gpg" \
    --output /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc

  ARCH="$(dpkg --print-architecture)"
  CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  if [[ -z "$CODENAME" ]]; then
    printf 'Could not determine the distribution codename.\n' >&2
    exit 31
  fi
  printf '%s\n' \
    "Types: deb" \
    "URIs: https://download.docker.com/linux/${DOCKER_ID}" \
    "Suites: ${CODENAME}" \
    "Components: stable" \
    "Architectures: ${ARCH}" \
    "Signed-By: /etc/apt/keyrings/docker.asc" \
    | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo systemctl enable --now tailscaled docker
if ! sudo docker info >/dev/null 2>&1; then
  printf 'Docker was installed but its daemon is not responding.\n' >&2
  exit 32
fi

TAILSCALE_IP="$(tailscale ip -4 2>/dev/null || sudo tailscale ip -4)"
PIHOLE_DIR="/opt/pieaes256hole/pihole"
PIHOLE_PASSWORD_FILE="${PIHOLE_DIR}/pihole_webpasswd"
say "Installing Pi-hole in Docker"
sudo install -d -m 0700 "${PIHOLE_DIR}/etc-pihole"
if ! sudo test -s "$PIHOLE_PASSWORD_FILE"; then
  openssl rand -base64 24 | tr -d '\n' | sudo tee "$PIHOLE_PASSWORD_FILE" >/dev/null
  printf '\n' | sudo tee -a "$PIHOLE_PASSWORD_FILE" >/dev/null
fi
sudo chmod 600 "$PIHOLE_PASSWORD_FILE"

WEB_PORT=80
if ! sudo docker container inspect pihole >/dev/null 2>&1; then
  if sudo ss -lntu | awk '{print $5}' | grep -Eq '(^|:)53$'; then
    if systemctl is-active --quiet systemd-resolved; then
      say "Releasing DNS port 53 from the systemd-resolved stub"
      sudo install -d -m 0755 /etc/systemd/resolved.conf.d
      printf '[Resolve]\nDNSStubListener=no\n' | sudo tee /etc/systemd/resolved.conf.d/pieaes256hole-no-stub.conf >/dev/null
      if [[ -L /etc/resolv.conf || -e /etc/resolv.conf ]]; then
        readlink /etc/resolv.conf 2>/dev/null | sudo tee /var/lib/pieaes256hole-resolv-conf.previous >/dev/null || true
      fi
      sudo rm -f /etc/resolv.conf
      sudo ln -s /run/systemd/resolve/resolv.conf /etc/resolv.conf
      sudo systemctl restart systemd-resolved
    fi
  fi
  if sudo ss -lntu | awk '{print $5}' | grep -Eq '(^|:)53$'; then
    printf 'DNS port 53 remains in use by another service. Pi-hole was not started to avoid disrupting it.\n' >&2
    exit 40
  fi
  if sudo ss -lnt | awk '{print $4}' | grep -Eq '(^|:)80$'; then
    WEB_PORT=8080
  fi
elif sudo docker port pihole 80/tcp >/dev/null 2>&1; then
  WEB_PORT="$(sudo docker port pihole 80/tcp | head -n1 | sed 's/.*://')"
fi

TIMEZONE="$(timedatectl show --property=Timezone --value 2>/dev/null || true)"
[[ -n "$TIMEZONE" ]] || TIMEZONE="UTC"
sudo tee "${PIHOLE_DIR}/compose.yaml" >/dev/null <<EOF
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
sudo chmod 600 "${PIHOLE_DIR}/compose.yaml"
sudo docker compose -f "${PIHOLE_DIR}/compose.yaml" pull
sudo docker compose -f "${PIHOLE_DIR}/compose.yaml" up -d

for _ in {1..60}; do
  curl --fail --silent --output /dev/null "http://127.0.0.1:${WEB_PORT}/admin/" && break
  sleep 2
done
if ! curl --fail --silent --output /dev/null "http://127.0.0.1:${WEB_PORT}/admin/"; then
  sudo docker compose -f "${PIHOLE_DIR}/compose.yaml" logs --tail=80 pihole >&2
  printf 'Pi-hole did not become ready. Its data was preserved at %s.\n' "$PIHOLE_DIR" >&2
  exit 41
fi
PIHOLE_ADMIN_URL="http://${TAILSCALE_IP}:${WEB_PORT}/admin/"

STATUS_DIR="/var/lib/pieaes256hole"
sudo install -d -m 0750 "$STATUS_DIR"
sudo tee "$STATUS_DIR/bootstrap-status.json" >/dev/null <<EOF
{
  "schemaVersion": 1,
  "platform": "linux",
  "role": "${ROLE}",
  "distribution": "${ID}",
  "tailscaleInstalled": true,
  "tailscaleAuthenticated": true,
  "tailscaleIPv4": "${TAILSCALE_IP}",
  "dockerInstalled": true,
  "dockerRunning": true,
  "dockerCompose": true,
  "piholeInstalled": true,
  "piholeRunning": true,
  "piholeAdminUrl": "${PIHOLE_ADMIN_URL}",
  "piholePasswordFile": "${PIHOLE_PASSWORD_FILE}"
}
EOF

say "Bootstrap complete"
printf 'Tailscale address: %s\n' "$TAILSCALE_IP"
printf 'Docker: %s\n' "$(sudo docker --version)"
printf 'Compose: %s\n' "$(sudo docker compose version)"
printf 'Pi-hole admin: %s\n' "$PIHOLE_ADMIN_URL"
printf 'Admin password file: %s\n' "$PIHOLE_PASSWORD_FILE"
printf 'This device is authenticated and running Pi-hole.\n'

say "Installing the private appliance controller"
CONTROLLER_INSTALLER="$TEMP_DIR/install-controller-linux.sh"
curl --fail --location --silent --show-error \
  https://raw.githubusercontent.com/AES256Afro/PieAES256Hole/main/public/install/install-controller-linux.sh \
  --output "$CONTROLLER_INSTALLER"
sudo bash "$CONTROLLER_INSTALLER"
