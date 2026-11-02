# GitHub App for the site + code scan

This is the one-time setup for the $99 plan. Customers connect one repository. VibeCheck can read that repository. It cannot change it.

The real values go in `.env` on the server. `.env.example` lists the names. Do not commit `.env`.

## Create the app

1. Open [https://github.com/settings/apps/new](https://github.com/settings/apps/new). Use your own account, or the organization that should own the app.
2. GitHub App name: `VibeCheck` (or another name that is not already taken).
3. Homepage URL: your site, for example `https://scan.example.com`.
4. Callback URL: `https://scan.example.com/api/github/callback`. Use your real origin.
5. Setup URL: the same callback URL, `https://scan.example.com/api/github/callback`. Check “Redirect on update” so a later install comes back to VibeCheck.
6. Webhook: check Active. Webhook URL: `https://scan.example.com/api/github/webhook`.
7. Webhook secret: click the generator, or run `openssl rand -hex 32`. Copy it. You will paste it into `.env` as `GITHUB_APP_WEBHOOK_SECRET`.
8. Repository permissions: **Contents: Read-only**. Leave every other permission as No access. Do not grant write, administration, or secrets.
9. Where can this app be installed: Any account, if customers use their own GitHub accounts.
10. Click Create GitHub App.

## Copy the four values

1. On the app page, copy the **App ID** into `GITHUB_APP_ID`.
2. The public slug is the last part of `https://github.com/apps/<slug>`. Put that slug in `GITHUB_APP_SLUG`.
3. Scroll to Private keys and click **Generate a private key**. GitHub downloads a `.pem` file. Open it in a text editor. Put the whole file in `GITHUB_APP_PRIVATE_KEY`. In `.env`, replace each line break with the two characters `\n` so it stays on one line. Keep the `BEGIN` and `END` lines.
4. Paste the webhook secret into `GITHUB_APP_WEBHOOK_SECRET`.

Optional: `CODE_SCAN_LLM_API_KEY` rewrites the plain-English explanations. Leave it empty to keep the built-in wording. Detection does not call a model. Each scan is capped at 1200 tokens.

Restart the web process and the worker after saving `.env`.

## What the customer does

1. They prove they own the website (the DNS or well-known file already used for a site scan).
2. They buy the $99 site + code scan.
3. They click Connect GitHub and choose **Only select repositories**, then tick one repo.
4. VibeCheck clones a shallow copy into a temporary folder, scans it, and deletes that copy. The report keeps short excerpts with secrets masked. The code is not stored and is not used for training.

If they remove the app from that repository, the webhook drops the connection.
