# Multiboard Sync Service - Production Deployment

This guide shows how to deploy on Ubuntu/Debian with systemd. It assumes a VPS with sudo access.

## Prerequisites
- Ubuntu/Debian VPS
- Redis installed and listening on localhost (or secure network)
- PostgreSQL databases reachable
- Domain and Nginx (optional for HTTPS)
- You will deploy a compiled binary (Go not required on VPS)

## Build locally
- From repo root:
  - chmod +x scripts/build.sh
  - ./scripts/build.sh
- Output: bin/multiboard-sync-service

## Prepare VPS
- Create user and directories:
  - sudo useradd --system --no-create-home --shell /usr/sbin/nologin multiboard
  - sudo mkdir -p /opt/multiboard-sync-service/bin /opt/multiboard-sync-service/cmd/server/static
  - sudo mkdir -p /var/lib/multiboard-sync-service/dumps /var/lib/multiboard-sync-service/backups
  - sudo mkdir -p /var/log/multiboard-sync-service
  - sudo chown -R multiboard:multiboard /opt/multiboard-sync-service /var/lib/multiboard-sync-service /var/log/multiboard-sync-service
  - sudo chmod 750 /opt/multiboard-sync-service
- Create environment file:
  - Copy .env.production.example, fill in secrets
  - Upload to VPS as /opt/multiboard-sync-service/.env
  - sudo chown multiboard:multiboard /opt/multiboard-sync-service/.env
  - sudo chmod 640 /opt/multiboard-sync-service/.env

## Deploy
- Ensure your local binary exists: bin/multiboard-sync-service
- Run:
  - chmod +x scripts/deploy.sh
  - ./scripts/deploy.sh user@host [ssh_port]
- This copies the binary and static files, installs the systemd unit, and enables the service.

## Start service
- On VPS:
  - sudo systemctl daemon-reload
  - sudo systemctl enable --now multiboard-sync-service
  - sudo systemctl status multiboard-sync-service --no-pager
  - Logs: sudo tail -n 200 /var/log/multiboard-sync-service/service.log

## Verify
- Ensure Redis is reachable from the service
- Health: curl http://127.0.0.1:8080/health
- Static UI should be available at /

## Nginx (optional, HTTPS)
- Install: sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx
- Copy deployment/nginx/multiboard-sync-service.conf to /etc/nginx/sites-available/multiboard-sync-service (edit server_name)
- sudo ln -s /etc/nginx/sites-available/multiboard-sync-service /etc/nginx/sites-enabled/multiboard-sync-service
- sudo mkdir -p /var/www/certbot
- sudo nginx -t && sudo systemctl reload nginx
- Issue certificate: sudo certbot --nginx -d your.domain.tld
- Enable firewall (optional): sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
- If using Nginx, do not expose port 8080 publicly.

## Updates
- Rebuild locally: ./scripts/build.sh
- Redeploy: ./scripts/deploy.sh user@host
- Restart: sudo systemctl restart multiboard-sync-service

## Troubleshooting
- Permission denied: check ownership of /opt, /var/lib, /var/log paths and .env perms (640)
- Port in use: adjust PORT in .env or free port
- Redis errors: verify REDIS_URL, Redis is running and accessible
- Check logs: /var/log/multiboard-sync-service/service.log and service.err

## Notes
- Service auto-restarts and starts on boot via systemd
- Dumps are stored under /var/lib/multiboard-sync-service/dumps
- Static files are served from /opt/multiboard-sync-service/cmd/server/static
