import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Pie AES256 Hole onboarding console", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Pie AES256 Hole/);
  assert.match(html, /Check once/);
  assert.match(html, /Tailscale/);
  assert.match(html, /Docker/);
  assert.match(html, /Copy &amp; run command/);
  assert.match(html, /Private by default/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
