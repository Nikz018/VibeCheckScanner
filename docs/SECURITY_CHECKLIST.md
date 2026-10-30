# VibeCheck security checklist

This document is the coverage map for the MVP scanner. The typed source of truth is `CHECK_CATALOG` in `src/lib/catalog.ts`. Customer reports never include this mapping and never name the libraries used to collect evidence.

Standards referenced below:

- OWASP Top 10 (2021)
- OWASP API Security Top 10 (2023), when the check is about an API or backend
- OWASP ASVS 4.0 chapter
- CWE

Active scans run only after the account proves domain ownership (DNS TXT or `/.well-known/vibecheck-verify.txt`) and checks the consent box. Probes are read-only except for tiny unauthenticated POSTs used to see whether a webhook, login, or AI route rejects bad input, and except the single login request when a paid scan is given throwaway test accounts. The worker never sends PUT, PATCH, or DELETE. Signed-in checks replay and compare with GET and HEAD only.

Paid full reports can include those signed-in checks. The customer supplies up to two throwaway test accounts, or a session cookie or bearer token for each. The free teaser does not run them. Credentials are encrypted with CREDENTIALS_ENCRYPTION_KEY and deleted when the scan finishes or after 24 hours. Reports mask secrets, cookies, and tokens.

## Families

| Family id | Customer label |
| --- | --- |
| `secrets` | Secrets & leaked credentials |
| `cloud_backend` | Cloud backends & storage |
| `access_control` | Access control |
| `injection_xss` | Injection & XSS |
| `auth_session` | Authentication & session |
| `transport_headers` | Transport & headers |
| `info_disclosure` | Information disclosure |
| `dependencies` | Dependencies |

## Headline top 10

These themes sort first in paid reports. They sit on top of the full catalog. They do not replace it. A free preview shows the lowest-severity finding, not the headline rank.

1. **Open Supabase or Firebase data** — Tables or realtime data readable or writable with the public client key. Checks: `supabase_rls_disabled`, `firebase_rules_open`.
2. **Secrets in the client or a public env file** — Service-role keys, provider secret keys, and NEXT_PUBLIC_ / VITE_ leaks. Checks: `secret_in_client`, `secret_in_public_path`.
3. **Admin without server-side auth** — Admin pages, APIs, or tables that answer with no session. Checks: `admin_surface_open`.
4. **Guessable object ids** — Sequential ids that return another user's data to a read-only request. Checks: `idor_sequential_ids`.
5. **Public storage buckets** — Buckets or upload folders that can be listed. Checks: `public_storage_bucket`.
6. **Browser paywalls and unsigned webhooks** — Premium flags checked only in the client, or a payment webhook with no signature check. Checks: `client_side_paywall`, `stripe_webhook_unsigned`.
7. **Open AI endpoints** — Model routes with no auth, no rate limit, or a system-prompt leak. Checks: `llm_endpoint_open`, `llm_prompt_leak`, `llm_missing_rate_limit`.
8. **Exposed project files** — .env, .git, source maps, and debug or test routes. Checks: `exposed_dotenv`, `exposed_git`, `exposed_sourcemap`, `exposed_debug_route`.
9. **Weak auth configuration** — Client-side admin roles, unlimited login attempts, and open redirects. Checks: `signup_privileged_role`, `login_missing_rate_limit`, `open_redirect`.
10. **Headers, CORS, cookies, and verbose errors** — Wildcard CORS with credentials, missing CSP or HSTS, insecure cookies, stack traces. Checks: `cors_credential_wildcard`, `missing_csp`, `missing_hsts`, `insecure_cookies`, `verbose_errors`.

## Checks

### Secrets & leaked credentials (`secrets`)

Private keys and service credentials that shipped in public bundles or files.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `secret_in_client` | `secrets` | critical | 2 | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V8 Data Protection | CWE-798 |
| `secret_in_public_path` | `exposure` | critical | 2 | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V8 Data Protection | CWE-538 |

### Cloud backends & storage (`cloud_backend`)

Supabase, Firebase, and buckets left open to the public client.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `supabase_rls_disabled` | `supabase` | critical | 1 | A01:2021 Broken Access Control | API1:2023 Broken Object Level Authorization | V4 Access Control | CWE-284 |
| `firebase_rules_open` | `firebase` | critical | 1 | A01:2021 Broken Access Control | API1:2023 Broken Object Level Authorization | V4 Access Control | CWE-732 |
| `public_storage_bucket` | `storage` | high | 5 | A01:2021 Broken Access Control | API8:2023 Security Misconfiguration | V4 Access Control | CWE-284 |
| `directory_listing` | `storage` | medium | — | A01:2021 Broken Access Control | API8:2023 Security Misconfiguration | V4 Access Control | CWE-548 |
| `auth_backend_cross_user` | `authenticated` | critical | — | A01:2021 Broken Access Control | API1:2023 Broken Object Level Authorization | V4 Access Control | CWE-284 |

### Access control (`access_control`)

Admin surfaces, object ids, and features enforced only in the browser.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin_surface_open` | `access` | critical | 3 | A01:2021 Broken Access Control | API5:2023 Broken Function Level Authorization | V4 Access Control | CWE-284 |
| `idor_sequential_ids` | `access` | high | 4 | A01:2021 Broken Access Control | API1:2023 Broken Object Level Authorization | V4 Access Control | CWE-639 |
| `client_side_paywall` | `access` | high | 6 | A01:2021 Broken Access Control | API6:2023 Unrestricted Access to Sensitive Business Flows | V4 Access Control | CWE-602 |
| `llm_endpoint_open` | `llm` | high | 7 | A01:2021 Broken Access Control | API4:2023 Unrestricted Resource Consumption | V4 Access Control | CWE-284 |
| `llm_missing_rate_limit` | `llm` | medium | 7 | A04:2021 Insecure Design | API4:2023 Unrestricted Resource Consumption | V4 Access Control | CWE-770 |
| `auth_idor_bola` | `authenticated` | high | — | A01:2021 Broken Access Control | API1:2023 Broken Object Level Authorization | V4 Access Control | CWE-639 |
| `auth_vertical_privilege` | `authenticated` | critical | — | A01:2021 Broken Access Control | API5:2023 Broken Function Level Authorization | V4 Access Control | CWE-285 |
| `auth_paywall_bypass` | `authenticated` | high | — | A01:2021 Broken Access Control | API6:2023 Unrestricted Access to Sensitive Business Flows | V4 Access Control | CWE-639 |

### Injection & XSS (`injection_xss`)

Untrusted input that comes back as HTML, plus prompt leakage from AI routes.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `llm_prompt_leak` | `llm` | high | 7 | A03:2021 Injection | API8:2023 Security Misconfiguration | V5 Validation, Sanitization and Encoding | CWE-200 |
| `reflected_xss` | `injection` | high | — | A03:2021 Injection | API8:2023 Security Misconfiguration | V5 Validation, Sanitization and Encoding | CWE-79 |
| `dom_xss_sink` | `injection` | medium | — | A03:2021 Injection | API8:2023 Security Misconfiguration | V5 Validation, Sanitization and Encoding | CWE-79 |

### Authentication & session (`auth_session`)

Signup, login, callbacks, and webhook authenticity.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stripe_webhook_unsigned` | `authcfg` | high | 6 | A08:2021 Software and Data Integrity Failures | API2:2023 Broken Authentication | V2 Authentication | CWE-345 |
| `signup_privileged_role` | `authcfg` | high | 9 | A07:2021 Identification and Authentication Failures | API2:2023 Broken Authentication | V2 Authentication | CWE-269 |
| `login_missing_rate_limit` | `authcfg` | medium | 9 | A07:2021 Identification and Authentication Failures | API4:2023 Unrestricted Resource Consumption | V2 Authentication | CWE-307 |
| `open_redirect` | `authcfg` | medium | 9 | A01:2021 Broken Access Control | API8:2023 Security Misconfiguration | V3 Session Management | CWE-601 |
| `auth_session_weakness` | `authenticated` | medium | — | A07:2021 Identification and Authentication Failures | API2:2023 Broken Authentication | V3 Session Management | CWE-613 |

### Transport & headers (`transport_headers`)

HTTPS, browser security headers, CORS, and cookie flags.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cors_credential_wildcard` | `headers` | high | 10 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V9 Communications | CWE-942 |
| `missing_csp` | `headers` | medium | 10 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-693 |
| `missing_hsts` | `headers` | medium | 10 | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V9 Communications | CWE-319 |
| `insecure_cookies` | `headers` | medium | 10 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V3 Session Management | CWE-614 |
| `weak_tls` | `headers` | high | — | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V9 Communications | CWE-326 |
| `missing_frame_protection` | `headers` | low | — | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-1021 |
| `missing_content_type_options` | `headers` | low | — | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-693 |
| `missing_referrer_policy` | `headers` | low | — | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-200 |
| `mixed_content` | `page-content` | medium | — | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V9 Communications | CWE-319 |
| `insecure_form` | `page-content` | medium | — | A02:2021 Cryptographic Failures | API8:2023 Security Misconfiguration | V9 Communications | CWE-319 |

### Information disclosure (`info_disclosure`)

Env files, git metadata, source maps, debug routes, and stack traces.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `exposed_dotenv` | `exposure` | critical | 8 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-538 |
| `exposed_git` | `exposure` | high | 8 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-538 |
| `exposed_sourcemap` | `exposure` | medium | 8 | A05:2021 Security Misconfiguration | API9:2023 Improper Inventory Management | V14 Configuration | CWE-540 |
| `exposed_debug_route` | `exposure` | medium | 8 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V14 Configuration | CWE-489 |
| `verbose_errors` | `exposure` | medium | 10 | A05:2021 Security Misconfiguration | API8:2023 Security Misconfiguration | V7 Error Handling and Logging | CWE-209 |
| `exposed_package_manifest` | `exposure` | low | — | A05:2021 Security Misconfiguration | API9:2023 Improper Inventory Management | V14 Configuration | CWE-538 |
| `client_backend_config` | `secrets` | info | — | A05:2021 Security Misconfiguration | API9:2023 Improper Inventory Management | V14 Configuration | CWE-200 |
| `auth_sensitive_exposure` | `authenticated` | high | — | A01:2021 Broken Access Control | API3:2023 Broken Object Property Level Authorization | V8 Data Protection | CWE-200 |

### Dependencies (`dependencies`)

Library versions visible on public pages and scripts, and in a public package.json when one is present.

| Check | Module | Severity | Headline | OWASP Top 10 | OWASP API Top 10 | ASVS | CWE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `vulnerable_dependency` | `dependencies` | high | — | A06:2021 Vulnerable and Outdated Components | API8:2023 Security Misconfiguration | V10 Malicious Code | CWE-1395 |

## What a customer report shows

Reports group findings by the eight families and include a coverage row for each family: ran, pass, findings, not run, or not completed. A paid finding shows a title, severity, evidence, impact, the exact location that was tested, the request and a short redacted response, steps to reproduce, and a copy-paste fix. The owner of an unlocked scan can download that report as a PDF or as a Markdown file to paste into an AI coding assistant. The free teaser keeps one finding, the lowest severity, in full detail, plus the true total and the count for each severity. Every other finding is left out of the page, the download, and the email. Score, scan date, and the public badge are derived from severities. The badge and share page show the score out of 100 and the date only, and they switch to a rescan-needed state 30 days after the scan.

## What this scan does not cover

- Business-logic flaws, such as a workflow that does the wrong thing for a valid user.
- Write or delete abuse. Probes are read-only, so a bug that only appears when data is changed is not proven.
- Private source and lockfiles. Library versions are read only from pages and scripts the site already serves, and from a public package.json when one is present.
- Load testing and brute-force testing.
- Mobile apps and backends that are not part of this web origin.
- Subdomains and other hosts are not crawled. Pages beyond the page limit are not scanned.

A manual pentest is a better fit when you need those covered in depth.
