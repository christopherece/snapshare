# Deploying SnapShare to a VPS (Docker + nginx)

```
 phones / TV ──HTTPS──► nginx (host) ─┬─► snap.topitsolutions.co.nz  → backend  127.0.0.1:3030  (API, WS, /join guest app, /host, /slideshow)
                                      └─► snap-media.topitsolutions.co.nz → RustFS   127.0.0.1:9030  (uploads, photos)
                                            Postgres stays inside Docker (not exposed)
```

**You need:** a Linux VPS (2 GB RAM recommended, ~10 GB free disk per 100-guest event), Docker with the
compose plugin, nginx, and two DNS **A records** pointing at the VPS's public IP:

| Name | Type | Value |
|---|---|---|
| `snap.topitsolutions.co.nz` | A | VPS IP |
| `snap-media.topitsolutions.co.nz` | A | VPS IP |

(Add matching `AAAA` records too if the VPS has IPv6.)

### CPU check (AVX)

Bun 1.4 needs AVX/AVX2. In the server, run `grep -c avx2 /proc/cpuinfo` — anything above `0` is fine.
If it prints `0`:

**a) Proxmox VM, physical CPU has AVX2** (check on the *Proxmox host*: `grep -c avx2 /proc/cpuinfo`):
the VM's default CPU type (`x86-64-v2-AES`/`kvm64`) hides it.

1. Proxmox web UI → select the VM → **Hardware** → **Processors** → *Edit* → **Type: `host`**
   (or `x86-64-v3` if you migrate VMs between different hosts) → OK.
2. **Shut down** the VM and **start** it again (a reboot from inside the VM is not enough).
3. In the VM, `grep -c avx2 /proc/cpuinfo` should now be above `0`.

Same from the Proxmox host shell: `qm set <VMID> --cpu host`, then `qm shutdown <VMID> && qm start <VMID>`.

**b) The physical CPU has no AVX** (e.g. Intel Celeron J4125 / N5105 / J6412, Pentium Silver):
use Bun's no-AVX build. In `.env`, uncomment:

```bash
BUN_VERSION=1.2.23
BUN_BASELINE=1
```

then build as normal. (Fully tested; dependency versions are resolved at build time instead of
from the lockfile, which older Bun can't read.)

## 1. Get the code

```bash
# Private repo: use a GitHub personal access token as the password, or an SSH deploy key.
git clone https://github.com/christopherece/snapshare.git
cd snapshare
```

## 2. Configure

```bash
cp .env.production.example .env
nano .env
```

- Domains are already set to `snap.` / `snap-media.topitsolutions.co.nz`.
- Fill the 3 `CHANGE_ME` secrets — run `openssl rand -hex 32` once for each.
- The backend listens on `127.0.0.1:3030` and storage on `127.0.0.1:9030` (chosen to avoid the usual
  3000/9000). Check they're free with `sudo ss -ltnp | grep -E ':(3030|9030) '` — if either is taken,
  change `BACKEND_PORT` / `S3_PORT` and the matching `proxy_pass` lines in `deploy/nginx/snapshare.conf`.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # backend should become "healthy"
curl http://127.0.0.1:3030/health                   # {"ok":true}
```

Database tables are created automatically on first start.

## 4. nginx + HTTPS

```bash
sudo cp deploy/nginx/snapshare.conf /etc/nginx/sites-available/snapshare.conf
sudo ln -s /etc/nginx/sites-available/snapshare.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d snap.topitsolutions.co.nz -d snap-media.topitsolutions.co.nz
```

### Using Nginx Proxy Manager instead

NPM runs in Docker, so `127.0.0.1` inside it is NPM itself. In `.env` set `BIND_ADDRESS=172.17.0.1`
(the Docker host's bridge address), run `docker compose -f docker-compose.prod.yml up -d`, then add two
**Proxy Hosts**:

| Domain | Scheme | Forward host | Port | Websockets | Advanced tab |
|---|---|---|---|---|---|
| `snap.topitsolutions.co.nz` | http | `172.17.0.1` | `3030` | **ON** | `proxy_buffering off;` `proxy_read_timeout 3600s;` |
| `snap-media.topitsolutions.co.nz` | http | `172.17.0.1` | `9030` | off | `client_max_body_size 25m;` `proxy_request_buffering off;` |

On each: **SSL** tab → *Request a new certificate* → enable **Force SSL** and **HTTP/2**.
Check `ip -4 addr show docker0` shows `172.17.0.1`; if not, use that interface's address.

## 5. Check it

- `https://snap.topitsolutions.co.nz/host` → create your host account and an event.
- Scan the event QR code with a phone → the guest web app opens (`/join/<code>`), with the live camera.
- Open the slideshow from the dashboard on a TV/laptop.

Guests need nothing installed. The native app is optional.

## 6. (Optional) Native app

In `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=https://snap.topitsolutions.co.nz`, then build the app with EAS
(`bunx eas build`). The guest web app links to it via `/open/<code>` (`APP_LINK_TEMPLATE`).

## Who can host events

Registration is **invite-only** (`REGISTRATION=invite`). The account in `ADMIN_EMAIL` is made admin on
every start; on a brand-new install the first account to register becomes admin.

Admins get a **Team** page in the dashboard: create single-use invite links (1–30 days), see every host
and their event count, disable an account (signs them out immediately), or make someone admin.

## Updating

```bash
cd snapshare
git pull
docker compose -f docker-compose.prod.yml up -d --build    # migrations run automatically
```

## Backups (do this before a real event)

```bash
# Database
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U snapshare snapshare | gzip > db-$(date +%F).sql.gz
# Photos (Docker volume)
docker run --rm -v snapshare_s3data:/data -v "$PWD":/backup alpine tar czf /backup/photos-$(date +%F).tgz -C /data .
```

## Useful commands

```bash
docker compose -f docker-compose.prod.yml logs -f backend     # live logs
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml down                # stop (data is kept in volumes)
```

## Notes

- Run **one** backend container. Rate limiting, live updates and the image queue live in-process
  (see "Scaling notes" in README.md before adding replicas).
- `docker compose down -v` **deletes all photos and data** — never use `-v` in production unless you mean it.
- Firewall: only ports 80/443 (and SSH) need to be open; 3030/9030 are bound to 127.0.0.1.
