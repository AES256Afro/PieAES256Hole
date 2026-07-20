type ProxyPayload = {
  baseUrl?: string;
  path?: string;
  method?: string;
  sid?: string;
  body?: string;
};

const allowedOperations = new Set([
  "GET /auth",
  "POST /auth",
  "GET /info/version",
  "GET /lists?type=block",
  "POST /lists?type=block",
  "POST /lists:batchDelete",
  "POST /action/gravity",
  "POST /domains/allow/exact",
]);

const encodedDomain = "(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:%2e|\\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:(?:%2e|\\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*";
const domainOperations = [
  new RegExp(`^GET /search/${encodedDomain}\\?partial=false&N=20$`, "i"),
  new RegExp(`^DELETE /domains/allow/exact/${encodedDomain}$`, "i"),
];

function isAllowedOperation(method: string, path: string) {
  const operation = `${method} ${path}`;
  return allowedOperations.has(operation) || domainOperations.some((pattern) => pattern.test(operation));
}

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}

function isPrivateHost(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "::1" || value.endsWith(".local") || value.endsWith(".ts.net") || isPrivateIPv4(value);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const consoleUrl = new URL(request.url);
  if (!isPrivateHost(consoleUrl.hostname)) {
    return jsonError("Pi-hole management is available only from a local, private-network, or Tailscale-hosted console.", 403);
  }

  let payload: ProxyPayload;
  try {
    payload = await request.json() as ProxyPayload;
  } catch {
    return jsonError("Invalid proxy request.", 400);
  }

  if (!payload.baseUrl || !payload.path) return jsonError("The Pi-hole address and API path are required.", 400);

  let baseUrl: URL;
  try {
    baseUrl = new URL(payload.baseUrl);
  } catch {
    return jsonError("The Pi-hole address is invalid.", 400);
  }

  if (!isPrivateHost(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    return jsonError("Only private LAN and Tailscale Pi-hole addresses are allowed.", 403);
  }

  const method = (payload.method || "GET").toUpperCase();
  if (!isAllowedOperation(method, payload.path)) return jsonError("That Pi-hole operation is not allowed by the local proxy.", 403);

  const upstreamUrl = new URL(`/api${payload.path}`, baseUrl.origin);
  const headers = new Headers({ Accept: "application/json, text/plain" });
  if (payload.sid) headers.set("X-FTL-SID", payload.sid);
  if (payload.body !== undefined) headers.set("Content-Type", "application/json");

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" ? undefined : payload.body,
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonError("The local console could not reach Pi-hole over the private network.", 502);
  }
}
