/**
 * INTENTIONALLY INSECURE — local demo only.
 * Do not deploy this process anywhere public. Missing headers, public .env, git metadata, source map, stack traces.
 */
const http = require("node:http");

const PORT = Number(process.env.PORT || 4012);
let proof = "";

const envFile = `OPENAI_API_KEY=sk-demo-not-real-key-aaaaaaaaaaaaaaaa
STRIPE_SECRET_KEY=sk_test_demo_not_real_000000000000
RESEND_API_KEY=re_demo_not_real_key_000000
`;

const manifest = JSON.stringify(
  {
    name: "leaky-demo",
    private: true,
    dependencies: {
      lodash: "4.17.15",
      jsonwebtoken: "8.5.1",
      minimist: "1.2.5",
    },
  },
  null,
  2,
);

const sourceMap = JSON.stringify({
  version: 3,
  file: "app.js",
  sources: ["src/app.js"],
  sourcesContent: ["document.getElementById('out').innerHTML = location.hash;"],
  mappings: "AAAA",
});

function page(query) {
  const reflected = query ? `<p>You searched for ${query}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Leaky basics demo</title></head>
<body>
  <p style="background:#ffef6b;color:#3a2a00;padding:12px;font-family:sans-serif">
    INTENTIONALLY INSECURE LOCAL DEMO. Do not deploy this app.
  </p>
  <h1>Missing headers demo</h1>
  ${reflected}
  <div id="out"></div>
  <script src="/assets/app.js"></script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const loose = {
    "access-control-allow-origin": "*",
    "access-control-allow-credentials": "true",
  };
  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      ...loose,
      "set-cookie": "session=insecure-demo; Path=/",
      ...headers,
    });
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

  if (url.pathname === "/.env") {
    send(200, envFile, { "content-type": "text/plain" });
    return;
  }

  if (url.pathname === "/.git/HEAD") {
    send(200, "ref: refs/heads/main\n", { "content-type": "text/plain" });
    return;
  }

  if (url.pathname === "/assets/app.js") {
    send(200, "document.getElementById('out').innerHTML = location.hash;\n", { "content-type": "application/javascript" });
    return;
  }

  if (url.pathname === "/assets/app.js.map") {
    send(200, sourceMap, { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/package.json") {
    send(200, manifest, { "content-type": "application/json" });
    return;
  }

  if (url.pathname === "/debug") {
    send(200, "debug route\nNODE_ENV=development\nprocess.env dumped for the demo\n", { "content-type": "text/plain" });
    return;
  }

  if (url.pathname === "/api/error") {
    const stack = "Error: cannot read property\n    at handler (/app/server.js:10:1)\n    at Layer (/app/node_modules/router/index.js:1:1)\n";
    send(500, stack, { "content-type": "text/plain" });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(200, page(url.searchParams.get("q")), { "content-type": "text/html" });
    return;
  }

  send(404, "not found", { "content-type": "text/plain" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`leaky-basics demo listening on ${PORT}`);
});
