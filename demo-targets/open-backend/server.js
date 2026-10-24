/**
 * INTENTIONALLY INSECURE — local demo only.
 * Do not deploy this process anywhere public. It exists so VibeCheck can record a scan.
 */
const http = require("node:http");

const PORT = Number(process.env.PORT || 4010);
let proof = "";

function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, ref: "demo" })).toString("base64url");
  return `${header}.${payload}.demo`;
}

const anonKey = jwt("anon");
const serviceKey = jwt("service_role");

function banner(title) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body>
  <p style="background:#ffef6b;color:#3a2a00;padding:12px;font-family:sans-serif">
    INTENTIONALLY INSECURE LOCAL DEMO. Do not deploy this app. It is not a real backend.
  </p>
  <h1>${title}</h1>
  <script src="/assets/app.js"></script>
</body>
</html>`;
}

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { ...securityHeaders(), ...headers });
    res.end(body);
  };

  if (req.method === "POST" && url.pathname === "/_demo/install-proof") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        const token = JSON.parse(raw).token;
        if (!/^vc_[a-f0-9]{32}$/.test(token)) {
          send(400, "bad token", { "content-type": "text/plain" });
          return;
        }
        proof = token;
        send(200, JSON.stringify({ ok: true }), { "content-type": "application/json" });
      } catch {
        send(400, "bad json", { "content-type": "text/plain" });
      }
    });
    return;
  }

  if (url.pathname === "/.well-known/vibecheck-verify.txt") {
    send(200, proof, { "content-type": "text/plain" });
    return;
  }

  if (url.pathname === "/assets/app.js") {
    const body = `const SUPABASE_URL = "http://${host}";
const SUPABASE_ANON_KEY = "${anonKey}";
const SUPABASE_SERVICE_ROLE_KEY = "${serviceKey}";
const FIREBASE_DATABASE_URL = "http://${host}/rtdb";
const FIREBASE_PROJECT_ID = "demo-local";
const NEXT_PUBLIC_STRIPE_SECRET = "sk_test_demo_not_real_000000000000000";
console.log("demo open backend", SUPABASE_URL);
`;
    send(200, body, { "content-type": "application/javascript" });
    return;
  }

  if (url.pathname === "/rest/v1/users") {
    if (req.method === "OPTIONS") {
      send(204, "", { allow: "GET, POST, PATCH, DELETE", "access-control-allow-methods": "GET, POST, PATCH, DELETE" });
      return;
    }
    if (!req.headers.apikey) {
      send(401, JSON.stringify({ message: "missing client key" }), { "content-type": "application/json" });
      return;
    }
    send(200, JSON.stringify([
      { id: "1", email: "ada@example.com" },
      { id: "2", email: "grace@example.com" },
    ]), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/storage/v1/bucket") {
    if (!req.headers.apikey) {
      send(401, JSON.stringify({ message: "missing client key" }), { "content-type": "application/json" });
      return;
    }
    send(200, JSON.stringify([{ id: "avatars", name: "avatars", public: true }]), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/rtdb/.json") {
    send(200, JSON.stringify({ users: { 1: { email: "ada@example.com" } } }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/uploads/") {
    send(200, "<html><body>Index of /uploads<br/>secret.txt</body></html>", { "content-type": "text/html" });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(200, banner("Open backend demo"), { "content-type": "text/html" });
    return;
  }

  send(404, "not found", { "content-type": "text/plain" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`open-backend demo listening on ${PORT}`);
});
