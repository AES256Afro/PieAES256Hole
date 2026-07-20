import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/install/", import.meta.url);

test("macOS bootstrap installs from official sources and requires Tailscale", async () => {
  const script = await readFile(new URL("bootstrap-macos.sh", root), "utf8");
  assert.match(script, /pkgs\.tailscale\.com\/stable/);
  assert.match(script, /desktop\.docker\.com\/mac\/main/);
  assert.match(script, /tailscaleAuthenticated/);
  assert.match(script, /Docker Desktop has separate license terms/);
  assert.match(script, /pihole\/pihole:2026\.05\.0/);
  assert.match(script, /restart: unless-stopped/);
  assert.match(script, /piholeAdminUrl/);
});

test("Linux bootstrap targets the appliance and starts services", async () => {
  const script = await readFile(new URL("bootstrap-linux.sh", root), "utf8");
  assert.match(script, /debian\|ubuntu\|raspbian/);
  assert.match(script, /tailscale up --accept-dns=false/);
  assert.match(script, /download\.docker\.com\/linux/);
  assert.match(script, /systemctl enable --now tailscaled docker/);
  assert.match(script, /WEBPASSWORD_FILE: pihole_webpasswd/);
  assert.match(script, /pihole\/pihole:2026\.05\.0/);
});

test("Windows bootstrap uses elevation, winget, and unattended Tailscale", async () => {
  const script = await readFile(new URL("bootstrap-windows.ps1", root), "utf8");
  assert.match(script, /Tailscale\.Tailscale/);
  assert.match(script, /Docker\.DockerDesktop/);
  assert.match(script, /--unattended=true/);
  assert.match(script, /-Verb RunAs/);
  assert.match(script, /pihole\/pihole:2026\.05\.0/);
  assert.match(script, /piholeRunning/);
});

test("the handoff never invents an appliance hostname", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /useState\(["']pieaes256hole\.local["']\)/);
  assert.match(page, /serverCheck !== "passed"/);
  assert.match(page, /proxyPiHoleFetch\(baseUrl, "\/auth"/);
  assert.match(page, /proxyPiHoleFetch\(baseUrl, "\/info\/version"/);
  assert.match(page, /href=\{verifiedAdminUrl\}/);
});

test("protection catalog uses reviewed HTTPS lists and safe rollback", async () => {
  const catalog = JSON.parse(await readFile(new URL("../catalog/blocklists.json", import.meta.url), "utf8"));
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/pihole/route.ts", import.meta.url), "utf8");

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.maintainer.license, "GPL-3.0");
  assert.ok(catalog.lists.length >= 6);
  assert.ok(catalog.lists.every((list) => list.url.startsWith("https://")));
  assert.deepEqual(catalog.profiles.find((profile) => profile.id === "heavy").listIds, ["hagezi-pro", "hagezi-tif-medium"]);
  assert.match(route, /X-FTL-SID/);
  assert.match(page, /\/lists:batchDelete/);
  assert.match(page, /\/action\/gravity/);
  assert.doesNotMatch(page, /setTimeout\(\(\) => \{\s*setTesting/);
});

test("the Pi-hole proxy is restricted to private consoles and typed operations", async () => {
  const route = await readFile(new URL("../app/api/pihole/route.ts", import.meta.url), "utf8");
  assert.match(route, /isPrivateHost\(consoleUrl\.hostname\)/);
  assert.match(route, /isPrivateHost\(baseUrl\.hostname\)/);
  assert.match(route, /allowedOperations/);
  assert.match(route, /GET \/auth/);
  assert.match(route, /POST \/lists:batchDelete/);
  assert.doesNotMatch(route, /Access-Control-Allow-Origin/);
});
