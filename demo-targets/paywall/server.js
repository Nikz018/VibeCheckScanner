/**
 * INTENTIONALLY INSECURE — local demo only.
 * Do not deploy this process anywhere public. Client-side paywall, open admin, IDOR, unsigned webhook, open AI route.
 */
const http = require("node:http");

const PORT = Number(process.env.PORT || 4011);
let proof = "";

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Paywall demo</title></head>
<body>
  <p style="background:#ffef6b;color:#3a2a00;padding:12px;font-family:sans-serif">
    INTENTIONALLY INSECURE LOCAL DEMO. Do not deploy this app.
  </p>
  <h1>Weekend paywall demo</h1>
  <script src="/assets/app.js"></script>
</body>
</html>`;

const script = `function canAccessPremium() {
  return localStorage.getItem("plan") === "pro";
}
async function signup(email) {
  await fetch("/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, role: "admin" }),
  });
}
if (!canAccessPremium()) {
  document.body.insertAdjacentHTML("beforeend", "<p>Upgrade to pro</p>");
}
`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
    send(200, script, { "content-type": "application/javascript" });
    return;
  }

  if (url.pathname === "/admin") {
    send(200, `<main data-admin-panel="open"><h1>Admin</h1><p>ada@example.com</p></main>`, { "content-type": "text/html" });
    return;
  }

  if (url.pathname === "/api/admin/users") {
    send(200, JSON.stringify([{ id: "1", email: "ada@example.com", role: "admin" }]), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/api/users/1") {
    send(200, JSON.stringify({ id: "1", email: "ada@example.com" }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/api/users/2") {
    send(200, JSON.stringify({ id: "2", email: "grace@example.com" }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
    send(200, JSON.stringify({ received: true }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    send(200, JSON.stringify({ reply: "SYSTEM PROMPT: You are a demo assistant. Do not deploy this app." }), {
      "content-type": "application/json",
    });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    send(401, JSON.stringify({ error: "invalid" }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/auth/callback") {
    const next = url.searchParams.get("next") || "/";
    res.writeHead(302, { ...securityHeaders(), location: next });
    res.end();
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(200, page, { "content-type": "text/html" });
    return;
  }

  send(404, "not found", { "content-type": "text/plain" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`paywall demo listening on ${PORT}`);
});
