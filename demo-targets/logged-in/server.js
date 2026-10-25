/**
 * INTENTIONALLY INSECURE — local demo only.
 * Do not deploy this process anywhere public.
 * It signs in two throwaway users and then ignores object ownership, admin role, and plan.
 */
const http = require("node:http");
const { randomBytes } = require("node:crypto");

const PORT = Number(process.env.PORT || 4013);
let proof = "";
const sessions = new Map();

const users = {
  "alice@example.test": {
    id: "u_alice",
    email: "alice@example.test",
    password: "test-password-alice",
    plan: "free",
    role: "user",
    note: "alice-private-note-alpha",
  },
  "bob@example.test": {
    id: "u_bob",
    email: "bob@example.test",
    password: "test-password-bob",
    plan: "free",
    role: "user",
    note: "bob-private-note-bravo",
  },
};

const directory = [
  ...Object.values(users),
  { id: "u_carol", email: "carol@example.test", plan: "free", role: "user", note: "carol-private-note-charlie" },
];

function userJwt(user) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email: user.email, role: user.role, api_key: "embedded-demo-claim" })).toString("base64url");
  return `${header}.${payload}.none`;
}

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${title}</title></head>
<body>
  <p style="background:#ffef6b;color:#3a2a00;padding:12px;font-family:sans-serif">INTENTIONALLY INSECURE LOCAL DEMO. Do not deploy this app.</p>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

function loginPage() {
  return page(
    "Sign in",
    `<form method="post" action="/login">
      <label>Email <input type="email" name="email" autocomplete="username" /></label>
      <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
      <button type="submit">Log in</button>
    </form>`,
  );
}

function appPage(user) {
  const jwt = userJwt(user);
  return page(
    "Home",
    `<p>Signed in as a test account.</p>
    <a href="/api/notes/${user.id}">My note</a>
    <a href="/admin">Admin</a>
    <a href="/api/admin/users">Users</a>
    <a href="/api/premium">Premium</a>
    <a href="/api/me">Me</a>
    <a href="/rest/v1/users?select=id,email&limit=5">Rows</a>
    <a href="/rtdb/users.json">Live data</a>
    <script src="/assets/private.js"></script>
    <script>localStorage.setItem("access_token", ${JSON.stringify(jwt)});</script>`,
  );
}

function currentUser(req) {
  const header = String(req.headers.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (bearer && sessions.has(bearer)) return sessions.get(bearer);
  if (bearer.includes(".")) {
    try {
      const payload = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString("utf8"));
      return Object.values(users).find((user) => user.email === payload.email) || null;
    } catch {
      // not a token we understand
    }
  }
  const cookie = String(req.headers.cookie || "");
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (match && sessions.has(decodeURIComponent(match[1]))) return sessions.get(decodeURIComponent(match[1]));
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function parseForm(raw, contentType) {
  if ((contentType || "").includes("json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { ...securityHeaders(), ...headers });
    res.end(body);
  };
  const user = currentUser(req);

  if (req.method === "POST" && url.pathname === "/_demo/install-proof") {
    const raw = await readBody(req);
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
    return;
  }

  if (url.pathname === "/.well-known/vibecheck-verify.txt") {
    send(200, proof, { "content-type": "text/plain" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/login") {
    send(200, loginPage(), { "content-type": "text/html; charset=utf-8" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/login") {
    const raw = await readBody(req);
    const fields = parseForm(raw, req.headers["content-type"]);
    const account = users[String(fields.email || fields.username || "")];
    if (!account || account.password !== String(fields.password || "")) {
      send(401, loginPage(), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    const token = randomBytes(16).toString("hex");
    sessions.set(token, account);
    send(302, "", {
      location: "/app",
      "set-cookie": `session=${token}; HttpOnly; Path=/`,
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(200, page("Logged-in demo", `<p>This fixture is local only.</p><a href="/login">Log in</a>`), {
      "content-type": "text/html; charset=utf-8",
    });
    return;
  }

  if (!user) {
    if (url.pathname === "/app") {
      send(302, "", { location: "/login" });
      return;
    }
    send(401, JSON.stringify({ error: "unauthorized" }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/app") {
    send(200, appPage(user), { "content-type": "text/html; charset=utf-8" });
    return;
  }

  if (url.pathname === "/assets/private.js") {
    send(200, `const PRIVATE_API_KEY = "sk_test_authonlydemokey000000000000000";\n`, {
      "content-type": "application/javascript",
    });
    return;
  }

  if (url.pathname === "/api/me" || url.pathname === "/api/user" || url.pathname === "/api/profile") {
    send(200, JSON.stringify({ id: user.id, email: user.email, plan: user.plan, role: user.role }), {
      "content-type": "application/json",
    });
    return;
  }

  if (url.pathname.startsWith("/api/notes/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/notes/".length));
    const row = directory.find((entry) => entry.id === id);
    if (!row) {
      send(404, JSON.stringify({ error: "not found" }), { "content-type": "application/json" });
      return;
    }
    send(200, JSON.stringify({ id: row.id, email: row.email, note: row.note }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/admin") {
    send(
      200,
      page("Admin", `<div data-admin-panel="true"><p>All accounts</p><ul>${directory.map((entry) => `<li>${entry.email}</li>`).join("")}</ul></div>`),
      { "content-type": "text/html; charset=utf-8" },
    );
    return;
  }

  if (url.pathname === "/api/admin" || url.pathname === "/api/admin/users") {
    send(200, JSON.stringify(directory.map((entry) => ({ id: entry.id, email: entry.email, role: entry.role }))), {
      "content-type": "application/json",
    });
    return;
  }

  if (url.pathname === "/api/premium" || url.pathname === "/premium" || url.pathname === "/api/pro") {
    send(200, JSON.stringify({ access: "premium", lesson: "paid lesson body" }), { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/rest/v1/users") {
    send(200, JSON.stringify(directory.map((entry) => ({ id: entry.id, email: entry.email }))), {
      "content-type": "application/json",
    });
    return;
  }

  if (url.pathname === "/rtdb/users.json" || url.pathname === "/rtdb/.json") {
    const body = {};
    for (const entry of directory) body[entry.id] = { email: entry.email };
    send(200, JSON.stringify(body), { "content-type": "application/json" });
    return;
  }

  send(404, JSON.stringify({ error: "not found" }), { "content-type": "application/json" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`logged-in demo listening on ${PORT}`);
});
