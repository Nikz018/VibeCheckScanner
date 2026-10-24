# Intentionally insecure demo targets

These three apps are **local fixtures** for recording a VibeCheck demo and for the pipeline smoke test.

**Do not deploy them.** Do not put them on a public host, a preview URL, or a tunnel. They ship open tables, fake secrets, missing headers, and other issues on purpose. The secrets are synthetic and are not live credentials.

| Service | Default port | What it demonstrates |
| --- | --- | --- |
| `open-backend` | 4010 | Public client key, service-role key in JavaScript, readable table, open Firebase-style data, listable bucket, directory listing |
| `paywall` | 4011 | Client-side premium flag, admin role in signup code, unauthenticated admin data, sequential user ids, unsigned payment webhook, open AI route, login with no throttle, open redirect |
| `leaky-basics` | 4012 | Missing browser headers, wildcard CORS with credentials, insecure cookie, public `.env`, `.git`, source map, debug route, stack trace, reflected markup, `innerHTML`, public manifest with known-vulnerable versions |

Each app accepts `POST /_demo/install-proof` with `{ "token": "vc_..." }` and serves that token at `/.well-known/vibecheck-verify.txt`. The token lives in process memory and disappears when the process stops. The product UI can install it for you when `ALLOW_LOCAL_TARGETS=true`.

Run them with Docker Compose from the repo root, or without Docker:

```bash
npm run demos
```

Then prove ownership and scan:

- http://127.0.0.1:4010
- http://127.0.0.1:4011
- http://127.0.0.1:4012
