# Deploying SnapShare to a VPS (Docker + nginx)

```
 phones / TV ──HTTPS──► nginx (host) ─┬─► snap.example.com  → backend  127.0.0.1:3030  (API, WS, /join guest app, /host, /slideshow)
                                      └─► media.example.com → RustFS   127.0.0.1:9000  (uploads, photos)
                                            Postgres stays inside Docker (not exposed)
```

**You need:** a Linux VPS (2 GB RAM recommended, ~10 GB free disk per 100-guest event), Docker with the
compose plugin, nginx, and two DNS **A records** pointing at the VPS — e.g. `snap.example.com` and `media.example.com`.

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

- Replace `snap.example.com` / `media.example.com` with your domains (5 places).
- Fill every `CHANGE_ME` with a random secret — run `openssl rand -hex 32` once for each.
- The backend listens on `127.0.0.1:3030` and storage on `127.0.0.1:9000`. If either is taken on the VPS,
  change `BACKEND_PORT` / `S3_PORT` and the matching `proxy_pass` lines in the nginx config.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # backend should become "healthy"
curl http://127.0.0.1:3030/health                   # {"ok":true}
```

Database tables are created automatically on first start.

## 4. nginx + HTTPS

```bash
sed -i 's/snap.example.com/YOUR-APP-DOMAIN/; s/media.example.com/YOUR-MEDIA-DOMAIN/' deploy/nginx/snapshare.conf
sudo cp deploy/nginx/snapshare.conf /etc/nginx/sites-available/snapshare.conf
sudo ln -s /etc/nginx/sites-available/snapshare.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR-APP-DOMAIN -d YOUR-MEDIA-DOMAIN
```

## 5. Check it

- `https://YOUR-APP-DOMAIN/host` → create your host account and an event.
- Scan the event QR code with a phone → the guest web app opens (`/join/<code>`), with the live camera.
- Open the slideshow from the dashboard on a TV/laptop.

Guests need nothing installed. The native app is optional.

## 6. (Optional) Native app

In `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=https://YOUR-APP-DOMAIN`, then build the app with EAS
(`bunx eas build`). The guest web app links to it via `/open/<code>` (`APP_LINK_TEMPLATE`).

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
- Firewall: only ports 80/443 (and SSH) need to be open; 3030/9000 are bound to 127.0.0.1.
