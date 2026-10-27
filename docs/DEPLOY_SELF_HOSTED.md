# Deploy VibeCheck on one Linux VM

This is the public-server setup. One VM runs the site, the scan worker, Postgres, Redis, and automatic HTTPS. The same files work on ARM64 and x86. You do not change code when you move providers.

Start on AWS. The later sections are for a paid VPS, and a short Oracle path.

`docker compose up` in the project root is for your laptop. It also starts intentionally insecure demo apps. Do not use that file on a server. The server file is `docker-compose.prod.yml`. It does not include those apps.

## What you will do yourself

The AWS account already exists. The repo still cannot click the console, buy a domain, or see your passwords. You still have to:

1. Confirm the console is in Asia Pacific (Mumbai) and that the credit balance is still about $140.
2. Create a budget alert.
3. Launch one Ubuntu EC2 instance, a key pair, a security group, and one Elastic IP.
4. Point your domain at that IP with Cloudflare.
5. SSH in, install Docker, copy `.env.example` to `.env`, and paste secrets you generate on the VM.
6. Create the Dodo webhook and paste `DODO_WEBHOOK_SECRET`.
7. Add SMTP so sign-in email works.
8. Before January 18, 2027, either upgrade to the Paid plan or copy a backup to another host.

Everything after Docker is installed is `bash scripts/deploy.sh`.

## Your AWS account

You are already on the new Free plan, in **ap-south-1 (Mumbai)**, with about **$140** of credits left. Free access ends **January 18, 2027**. That is about 85 days from late October 2026. When the date arrives, or if the credits hit zero first, AWS closes the account. You are not billed on the Free plan unless you upgrade to Paid. After closure you have 90 days to upgrade and get the data back. After those 90 days AWS deletes the account. The checklist is [Before January 18, 2027](#before-january-18-2027).

Sign in at [https://console.aws.amazon.com/](https://console.aws.amazon.com/). In the top bar, set the Region to **Asia Pacific (Mumbai) ap-south-1** and leave it there. The instance, the disk, the security group, and the Elastic IP all have to be in Mumbai. Open **Billing and Cost Management → Credits** and confirm the balance is still about $140 before you launch anything else. This guide assumes this server is the only thing spending those credits.

## What 85 days costs in Mumbai

These rates are from AWS's own price list for Asia Pacific (Mumbai), published 2026-10-23 (offer `20261023221355`), and from the [VPC public IPv4 price](https://aws.amazon.com/vpc/pricing/). They are not a quote of your final bill. Tax, data transfer, and snapshots are not in the total.

| Piece | Published rate | 85 days |
| --- | --- | --- |
| `t4g.medium`, Linux, 2 vCPU, 4 GiB | $0.0224 per hour | 2,040 hours × $0.0224 = **$45.70** |
| One public IPv4 (the Elastic IP on the running instance) | $0.005 per hour in every commercial region, including Mumbai | 2,040 × $0.005 = **$10.20** |
| 30 GB gp3, baseline only (3,000 IOPS and 125 MB/s included) | $0.0912 per GB-month | 30 × $0.0912 × (2,040 / 730) = **$7.65** |

**About $63.55** of the $140. That leaves about **$76** for data transfer out, a snapshot or two, and a mistake. A quiet site should land well under the credits. Do not add a second instance, a NAT gateway, or extra disks.

A 730-hour month of this same stack is about $16.35 (instance) + $3.65 (IPv4) + $2.74 (30 GB gp3) = **about $23**. The budget in the next step uses $30 so a normal month stays quiet and an extra resource sends email.

`t4g.large` (8 GiB) is $0.0448 per hour here, about $91 of compute alone. You do not need it. `t3.medium` (x86, 4 GiB) is also $0.0448 per hour, about $109 with the disk and the IPv4. That still fits in $140, but the leftover is under $31, which is not comfortable once the site sends traffic. Prefer `t4g.medium`.

## 1. Set a budget alert

Do this before the instance exists.

1. Open **Billing and Cost Management → Budgets → Create budget**.
2. Choose a monthly cost budget of **$30**. That is above the about $23 this one server should cost, and below a surprise second bill.
3. Add your email. Alert at 50%, 80%, and 100%.
4. Create the budget.

An email means look at **Bills** and **EC2 → Instances** in Mumbai before you launch anything else. The Free plan still will not charge the card. The email means credits are leaving faster than this server alone.

Skip console tasks that launch another server, a database, or a NAT gateway. This setup is one EC2 instance.

## 2. Key pair

You need this before the instance starts. EC2 shows the private key only once.

1. EC2 → **Key pairs** → **Create key pair**.
2. Name: `vibecheck`. Type: **ED25519**. Format: **.pem**.
3. Create it and store the downloaded file somewhere private. On your computer:

```bash
chmod 600 ~/Downloads/vibecheck.pem
```

You can also connect from the browser with EC2 Instance Connect. Keep the key anyway. If the browser connect fails, the key is the way in.

## 3. Security group

The security group is the firewall AWS applies before traffic reaches Ubuntu.

1. EC2 → **Security groups** → **Create security group**.
2. Name: `vibecheck`. VPC: the default VPC.
3. Inbound rules:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | **My IP** | Only your current computer can log in |
| HTTP | 80 | Anywhere IPv4 (`0.0.0.0/0`) and Anywhere IPv6 (`::/0`) | Certificate checks and HTTPS redirect |
| HTTPS | 443 | Anywhere IPv4 and Anywhere IPv6 | The site |

4. Leave the outbound rule that allows all outbound traffic. The server has to reach the internet to download Docker images, send mail, and scan sites your users submit.
5. Create the security group.

**My IP** is your home or office address. If your ISP changes it, SSH starts failing and you edit this rule. Do not open port 22 to the whole internet.

EC2 Instance Connect from the browser does not come from your house. It comes from an AWS address in Mumbai. As of this writing the published range for `EC2_INSTANCE_CONNECT` in `ap-south-1` is `13.233.177.0/29`. Confirm it before you rely on it, because AWS can change it:

```bash
curl -fsSL https://ip-ranges.amazonaws.com/ip-ranges.json | python3 -c 'import json,sys; data=json.load(sys.stdin);
[print(p["ip_prefix"]) for p in data["prefixes"] if p.get("service")=="EC2_INSTANCE_CONNECT" and p.get("region")=="ap-south-1"]'
```

If browser connect fails with a timeout, add one more SSH rule whose source is that prefix. SSH from your laptop with the `.pem` file still uses **My IP** only.

Do not open 5432 or 6379. Postgres and Redis stay inside Docker.

## 4. Launch the instance

EC2 → **Instances** → **Launch instances**. Stay in **Asia Pacific (Mumbai)**.

- **Name:** `vibecheck`
- **Application and OS Images:** Ubuntu Server 24.04 LTS. Pick the **64-bit (Arm)** architecture. The AMI name includes arm64. An x86 Ubuntu image will not boot on Graviton.
- **Instance type:** **`t4g.medium`**. Graviton, 2 vCPU, 4 GiB. In Mumbai that is $0.0224 per hour, and the 85-day total above stays near $64 including disk and the public IPv4. The Compose memory limits are sized for this machine.
- **Key pair:** `vibecheck`
- **Network settings:** **Select existing security group** → `vibecheck`. Do not let the wizard create a group that only allows SSH. Turn on **Auto-assign public IP**. You will replace that address with an Elastic IP in the next step.
- **Storage:** one **30 GB gp3** volume. Leave IOPS and throughput at the baseline (3,000 IOPS and 125 MB/s). Raising either one adds a separate charge that is not in the $64 estimate. Do not add a second disk.
- Check the summary. It should be one instance, 30 GB, and it should not ask you to switch to the Paid plan.
- **Launch**.

### If the wizard hides t4g.medium

Accounts opened on or after July 15, 2025 sometimes only list Free tier eligible types: `t4g.micro`, `t4g.small`, `t3.micro`, `t3.small`, `c7i-flex.large`, and `m7i-flex.large` ([EC2 Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)). `t4g.medium` is not on that list. If the launch page refuses it, use **`t4g.small`** instead. In Mumbai that is $0.0112 per hour (2 vCPU, 2 GiB), about $41 for 85 days with the same 30 GB disk and one public IPv4. Add the 4 GB swap file in the Docker section before the first build. Scans still run. A scan at the same time as a PDF download can run out of memory.

Do not launch `c7i-flex.large` or `m7i-flex.large`. They are much larger than this app needs.

### x86 instead of Graviton

Same files, no code changes. In Mumbai, Linux shared-tenancy on-demand (same price list):

- `t3.small` is $0.0224 per hour and 2 GiB. Same compute cost as `t4g.medium`, half the memory. Use it only if Arm is unavailable, and add the 4 GB swap file.
- `t3.medium` is $0.0448 per hour and 4 GiB. About $109 for 85 days with disk and IPv4. That fits in $140 and leaves under $31. Skip it unless you have looked at the credit balance and you accept the thinner margin.

Use Ubuntu Server 24.04 **64-bit (x86)** for either t3 type, the same security group, and one 30 GB gp3 volume at the baseline.

## 5. Elastic IP

A normal public IP changes when you stop the instance. DNS would break. An Elastic IP stays yours until you release it.

1. EC2 → **Elastic IPs** → **Allocate Elastic IP address** → Allocate. The region must still be Mumbai.
2. Select the new address → **Actions** → **Associate Elastic IP address**. Pick the `vibecheck` instance. Allow reassociation if asked.
3. Associating it releases the temporary public IP. You now have one public IPv4, not two. Copy the Elastic IP. That is the address you put in DNS and use for SSH.

**What it costs.** On the [Amazon VPC pricing page](https://aws.amazon.com/vpc/pricing/), under Public IPv4 Address, AWS lists an hourly charge of **$0.005** for an in-use public IPv4 address and the same **$0.005** for an idle one. The page says that rate applies in all commercial regions, which includes Mumbai. An Elastic IP you allocated and forgot, and one attached to the running instance, both use that rate. On the Free plan this spends credits. It does not charge the card unless you upgrade to Paid.

Allocate **one** Elastic IP, keep it associated with the running instance, and release it when you delete the server. Stopping the instance does not release the address, so the hourly credit use continues.

## 6. Connect

EC2 → Instances → select `vibecheck` → **Connect** → **EC2 Instance Connect** → **Connect**.

You should get a terminal as `ubuntu`. If it times out, your security group is missing the Instance Connect range from step 3. Use the key from your computer instead:

```bash
ssh -i ~/Downloads/vibecheck.pem ubuntu@ELASTIC_IP
```

Replace `ELASTIC_IP` with the address from step 5.

Ubuntu on AWS does not add the extra firewall Oracle uses. Check local firewall status:

```bash
sudo ufw status
```

If it says `inactive`, leave it that way. The security group is already the firewall. If it says `active`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 7. Swap, Docker, and the app

A 4 GB machine can run the stack. The first image build is heavier than a running site, because it compiles the app and downloads a headless browser. Add swap first.

On a machine with about 4 GB of RAM:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

On a 2 GB `t4g.small` or `t3.small`, use `fallocate -l 4G` instead of `2G`.

Install Docker (this works on Arm and x86 Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Close the Instance Connect tab and connect again so the `docker` group applies. Then:

```bash
docker compose version
```

If that says the command is missing, you are still in the old session.

Clone and configure:

```bash
git clone https://github.com/Nikz018/VibeCheckScanner.git
cd VibeCheckScanner
cp .env.example .env
```

Generate three different secrets. Run this three times and paste each result into a different line. Do not reuse one value. The command prints the secret so you can copy it. Nothing in the deploy script prints it back.

```bash
openssl rand -hex 32
```

Edit the file:

```bash
nano .env
```

Set these. Descriptions for every variable are in `.env.example`.

| Variable | Production value |
| --- | --- |
| `APP_URL` | `https://scan.example.com` with your real host, no slash at the end |
| `NEXT_PUBLIC_SITE_URL` | The same value as `APP_URL` |
| `SITE_ADDRESS` | `scan.example.com` with no `https://` |
| `ACME_EMAIL` | Your email, for certificate expiry notices |
| `SESSION_SECRET` | First `openssl` result |
| `POSTGRES_PASSWORD` | Second `openssl` result. Letters and numbers only, which this command already produces. Set it now. Changing it after the first successful start does not update the database that is already on disk. |
| `POSTGRES_USER` | `vibecheck` |
| `POSTGRES_DB` | `vibecheck` |
| `DATABASE_URL` | `postgresql://vibecheck:THE_SAME_PASSWORD@postgres:5432/vibecheck` |
| `REDIS_URL` | `redis://redis:6379` |
| `CREDENTIALS_ENCRYPTION_KEY` | Third `openssl` result. This is 32 bytes, written as 64 hex characters. Signed-in scans cannot store a test password without it. |
| `DEV_EXPOSE_MAGIC_LINK` | `false` |
| `ALLOW_LOCAL_TARGETS` | `false` |
| `NODE_ENV` | `production` |
| `PAYMENT_PROVIDER` | `dodo` |
| `DODO_ENV` | Leave the value copied from `.env.example` until you mean to charge a real card, then set `live_mode` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Your mail provider. See below. |
| `DODO_PAYMENTS_API_KEY`, `DODO_WEBHOOK_SECRET` | From the Dodo dashboard, after the site has HTTPS. |
| `WORKER_CONCURRENCY` | `1` |

Leave Stripe blank unless `PAYMENT_PROVIDER=stripe`. Leave `PLAYWRIGHT_CHANNEL` empty. Leave `PLAYWRIGHT_BROWSERS_PATH` unset. The images set that path themselves.

`Ctrl+O`, Enter, `Ctrl+X` saves and closes nano.

Point DNS before the first start if you can (next section). Caddy retries the certificate, so you can also start now and point DNS a few minutes later.

```bash
bash scripts/deploy.sh
```

That script checks `.env` without printing secrets, pulls the latest commit, builds the images one at a time, and starts the stack. The first build downloads a headless browser and can take a long time on a small VM. Later deploys are the same command.

When it finishes:

```bash
docker compose -f docker-compose.prod.yml ps
```

`postgres`, `redis`, `web`, `worker`, and `caddy` should be running. `migrate` should have exited with code 0. That step applies the Prisma migrations, including the `ScanCredential` table.

## 8. Cloudflare

Use a domain you own. Caddy gets a real certificate only for a hostname that points at this VM. An IP address alone is not enough.

1. Create a free Cloudflare account and add the domain. At your registrar, set the nameservers Cloudflare shows you. Wait until Cloudflare says the domain is active.
2. **DNS** → **Add record**.
   - Type: **A**
   - Name: `scan` if the site should be `scan.example.com`, or `@` for the bare domain
   - IPv4 address: the **Elastic IP**
   - Proxy status: **DNS only** (grey cloud)
3. Do not add an AAAA record unless the VM has a public IPv6 that you control. A wrong AAAA record makes certificate requests fail.
4. From your computer:

```bash
dig +short scan.example.com
```

The answer must be the Elastic IP. Then on the VM, if you have not started yet, run `bash scripts/deploy.sh`. If it is already up:

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

Open `https://scan.example.com/api/health`. You want:

```json
{"ok":true}
```

The first certificate often takes two or three minutes. If the browser says the certificate is untrusted, wait and reload. Check `docker compose -f docker-compose.prod.yml logs caddy` if it is still failing after ten minutes.

### DNS only or proxied

**DNS only (grey cloud) is the setup to use first.** Visitors talk to Caddy directly. Caddy completes the normal HTTP certificate check on port 80.

**Proxied (orange cloud)** hides the VM's IP behind Cloudflare. Do this only after HTTPS already works:

1. Cloudflare → **SSL/TLS** → set the mode to **Full (strict)**.
2. Then turn the proxy on for the A record.

**Flexible** causes a redirect loop, because Cloudflare talks plain HTTP to Caddy while Caddy redirects HTTP to HTTPS. Do not use Flexible.

If you turn the orange cloud on before a certificate exists, the HTTP check usually still reaches Caddy, but grey-cloud-first is the path that fails less often. Leave **Authenticated Origin Pulls** off unless you have also configured Caddy for it. This file does not.

## 9. Dodo webhook

Checkout stays disabled until both the API key and the webhook secret are set. The free teaser still runs.

1. In [Dodo Payments](https://app.dodopayments.com), create three products if this is not the account that already owns the test product IDs in `.env.example`. Prices are tax-exclusive: $49 once, $99 once, and $29 per month.
2. **Developer → API Keys**. Paste the key into `DODO_PAYMENTS_API_KEY`.
3. **Developer → Webhooks**. Endpoint URL:

```text
https://scan.example.com/api/dodo/webhook
```

Use your real host. Copy that endpoint's signing secret into `DODO_WEBHOOK_SECRET`.

4. Keep `DODO_ENV` at the value copied from `.env.example` until a real card should be charged. Then set `live_mode` and create live products.
5. On the VM, run `bash scripts/deploy.sh` again so the containers pick up the new values.

The deploy script prints the webhook URL. It does not print the secret.

If you use Stripe instead, set `PAYMENT_PROVIDER=stripe` and the `STRIPE_*` variables from `.env.example`. The Stripe webhook path is `https://scan.example.com/api/stripe/webhook`.

## 10. Email

Production does not show the sign-in link on the page. If `SMTP_HOST` is empty, nobody can sign in.

Use any provider that gives you SMTP. A typical transactional account (Brevo, Mailgun, Amazon SES, or similar) has a free or cheap tier. In `.env`:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-smtp-password
EMAIL_FROM="VibeCheck <scans@your-domain>"
```

Port `465` turns on implicit TLS. Port `587` uses STARTTLS. After saving, run `bash scripts/deploy.sh` and request a magic link on the site. The message should arrive. The link's host must be `https://` plus `SITE_ADDRESS`, because `APP_URL` is that origin.

Monitoring alerts are stored in the dashboard either way. SMTP also emails them.

## 11. Backups

`bash scripts/deploy.sh` installs a cron job for 03:15 UTC:

```bash
bash scripts/backup-postgres.sh
```

Dumps land in `backups/` as compressed custom-format files. The folder is kept out of git. Files older than `BACKUP_RETENTION_DAYS` (default 14) are deleted. The log is `backups/backup.log`.

Copy a fresh dump off the VM once a week. The VM disk is the only copy until you do.

```bash
bash scripts/backup-postgres.sh
ls -l backups
```

From your computer:

```bash
scp -i ~/Downloads/vibecheck.pem ubuntu@ELASTIC_IP:~/VibeCheckScanner/backups/vibecheck-STAMP.dump .
```

Restore on this same VM replaces the live database. It asks for `--yes` so it cannot run by accident:

```bash
bash scripts/restore-postgres.sh backups/vibecheck-STAMP.dump --yes
```

That stops the site, loads the dump, and starts the stack again.

## 12. Updates

On the VM, from the repo directory:

```bash
bash scripts/deploy.sh
```

That is `git pull` plus `docker compose -f docker-compose.prod.yml up -d --build`. Database migrations run before the site accepts traffic.

If you change `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, you must run that script. Those two values are built into the web image. Other `.env` values are read at startup, and the same script recreates the containers.

## Before January 18, 2027

Put January 4, 2027 on your calendar (two weeks before the Free plan ends). Do the work while SSH still works. On January 18, 2027, or earlier if the credits hit zero, AWS closes the account. The [Free Tier FAQ](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html) says you then have 90 days to upgrade to Paid to reopen it. After 90 days the account and its contents are deleted. Copying files out after closure means upgrading first. Take the backup before January 18.

Checklist, either path:

- [ ] `bash scripts/backup-postgres.sh` succeeds and `backups/` has a new `.dump` file.
- [ ] That dump and `.env` are on your computer, not only on the VM.
- [ ] Billing → Credits still shows a balance, or you already decided to upgrade or leave.
- [ ] You picked one of the two options below. Do not do both halfway (do not terminate the instance before the new host answers `{"ok":true}`).

### Stay on AWS and upgrade to Paid

1. Copy the dump and `.env` off the VM first, even if you are staying.
2. In Billing, upgrade the account to the **Paid** plan before January 18, 2027. The instance, Elastic IP, disk, and data stay where they are. No code change and no DNS change.
3. After the upgrade, usage the remaining credits do not cover is billed. The Mumbai rates in the cost section are the ones to re-read. Keep the $30 monthly budget. A month of this one server is about $23 before data transfer.
4. Confirm `https://scan.example.com/api/health` still returns `{"ok":true}`.

### Move to Hostinger, DigitalOcean, or another VPS

Same Docker files. No code changes. A 2 vCPU / 4 GB machine is the small size. More memory makes the headless browser less likely to be killed.

1. On AWS, run `bash scripts/backup-postgres.sh`.
2. From your computer, copy the dump and `.env`. Do not email them and do not commit them.

```bash
scp -i ~/Downloads/vibecheck.pem ubuntu@ELASTIC_IP:~/VibeCheckScanner/backups/vibecheck-STAMP.dump .
scp -i ~/Downloads/vibecheck.pem ubuntu@ELASTIC_IP:~/VibeCheckScanner/.env .
```

3. Create the new VM with Ubuntu 24.04, public IPv4, ports 22 (your IP), 80, and 443. Arm or x86 both work.
   - **Hostinger:** VPS → the firewall or hPanel → allow TCP 22, 80, and 443.
   - **DigitalOcean:** create a cloud firewall with those inbound ports and attach it to the droplet. On the droplet, if `sudo ufw status` is active, allow the same ports.
   - **Hetzner:** create a firewall with those inbound ports and attach it to the server.
4. Install Docker the same way as step 7. Clone the repo. Move `.env` into the clone. Move the dump into `backups/`. Do not change the application code.
5. Start Postgres, then restore:

```bash
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml ps
bash scripts/restore-postgres.sh backups/vibecheck-STAMP.dump --yes
```

The restore command starts the rest of the stack when it finishes. If you prefer, `bash scripts/deploy.sh` after the restore is also fine.

6. In Cloudflare, change the A record to the **new** IP. Leave it DNS only until `https://scan.example.com/api/health` works, then you can proxy it with **Full (strict)** as in the Cloudflare section.
7. Sign in and open a scan you know exists, so you can see the restore worked.
8. Back in AWS: terminate the EC2 instance, delete the 30 GB volume if termination did not delete it, and **release** the Elastic IP. Releasing the address stops the public IPv4 credit use. Confirm Billing shows no running instance and no unattached Elastic IP.

## Oracle Cloud, if you use it later

Oracle's current Always Free Ampere allowance is 1,500 OCPU hours and 9,000 GB hours per month, which Oracle documents as 2 OCPUs and 12 GB of memory for a `VM.Standard.A1.Flex` instance ([Always Free resources](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)). Use Ubuntu 24.04 aarch64, 2 OCPU, 12 GB RAM, and a 50 GB boot volume. The home region cannot be changed later. Some regions say they are out of capacity. Try another availability domain, or another home region, before you put a card on a paid shape.

Open ports in **both** places:

1. The subnet security list (or network security group): ingress TCP 80 and TCP 443 from `0.0.0.0/0`. Port 22 is usually already open. Keep SSH limited to your IP if you can find that field.
2. Ubuntu's own firewall. Oracle's Ubuntu image rejects new connections even when the security list allows them. Run:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
sudo ip6tables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo ip6tables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo ip6tables-save | sudo tee /etc/iptables/rules.v6 >/dev/null
```

If `/etc/iptables` does not exist yet: `sudo apt-get install -y iptables-persistent`, then run the save commands again. Do not put a rule after the existing REJECT line. Inserting at position 1, as above, keeps it in front of REJECT. Leave the SSH rule in place or you will lock yourself out.

Then install Docker, clone, fill `.env`, and run `bash scripts/deploy.sh` exactly as on AWS. No code changes.

## Troubleshooting

**Launch wizard says the Free plan cannot use this instance.** Pick `t4g.small` (Arm) or `t3.small` (x86), add the larger swap file, and continue. The Compose file does not change.

**`deploy.sh` says a variable is missing.** It names the variable and not the value. Fix that line in `.env`.

**Build is killed.** The VM ran out of memory during the image build. Add the swap file and run `bash scripts/deploy.sh` again.

**Health page does not load.** `dig +short` must show the Elastic IP. Security group must allow 80 and 443 from anywhere. `docker compose -f docker-compose.prod.yml ps` should show `caddy` and `web` running. Then read `docker compose -f docker-compose.prod.yml logs --tail=80 caddy web`.

**Browser SSH times out, laptop SSH works.** Add the Mumbai EC2 Instance Connect prefix on port 22. Your **My IP** rule can stay.

**Sign-in does nothing.** `SMTP_HOST` is empty or the provider rejected the password. Magic links are not printed on the production login page.

**Certificate failed.** The A record was proxied too early, or an AAAA record points somewhere else. Set DNS only, delete the bad AAAA, restart Caddy.

**Headless browser failed inside the worker.** The worker image installs Playwright's Chromium for the CPU it was built on. Confirm with:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint node worker -e "const {chromium}=require('playwright'); (async()=>{ const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); const p=await b.newPage(); await p.setContent('<h1>ok</h1>'); const t=await p.textContent('h1'); console.log(t); await b.close(); })().catch((e)=>{ console.error(e&&e.message?e.message:'launch failed'); process.exit(1); });"
```

On the instance, that command prints `ok`. The image installs Playwright's Chromium for the CPU it was built for: the arm64 build on Graviton, the amd64 build on x86. Reports shown to customers do not name that browser. An emulator of the arm64 image can crash inside Chromium even when the browser file is the arm64 build. Run this check on the instance.
