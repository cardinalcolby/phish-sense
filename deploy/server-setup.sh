#!/usr/bin/env bash
# One-time setup for the Vultr Ubuntu server. Run as root:
#   sudo bash server-setup.sh
# Afterwards, every merge to main is deployed by .github/workflows/deploy.yml.
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/var/www/phish-sense
SERVICE=phishsense
PORT=3000

# 1. Node.js 24, nginx, rsync, firewall
apt-get update
apt-get install -y curl ca-certificates rsync nginx ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# 2. Deploy user (CI logs in as this user)
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# Let the deploy user restart the app and read its logs, nothing else.
cat > /etc/sudoers.d/$DEPLOY_USER <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE, /usr/bin/journalctl -u $SERVICE *
EOF
chmod 440 /etc/sudoers.d/$DEPLOY_USER
visudo -cf /etc/sudoers.d/$DEPLOY_USER

# 3. App folder
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

# 4. systemd service (keeps the app running and restarts it on crash/reboot)
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=PhishSense
After=network.target

[Service]
User=$DEPLOY_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
Environment=NODE_ENV=production PORT=$PORT
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE

# 5. nginx reverse proxy on port 80 -> app
cat > /etc/nginx/sites-available/$SERVICE <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 6. Firewall: SSH + HTTP(S) only (port 3000 stays private)
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "Done. Next:"
echo "  1. Add the CI public key to /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "  2. Create $APP_DIR/.env (see .env.example), owned by $DEPLOY_USER, chmod 600"
