#!/bin/bash
# fellis.eu - Debian Server Setup Script
# Run as root or with sudo

set -e

echo "=== fellis.eu Debian Server Setup ==="

# --- 1. System packages ---
echo "[1/7] Installing system packages..."
apt update
apt install -y curl git nginx mariadb-server mariadb-client build-essential ufw

# --- 2. Node.js 22.x ---
echo "[2/7] Installing Node.js 22.x..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
else
  echo "Node.js already installed: $(node -v)"
fi

# --- 3. MariaDB setup ---
echo "[3/7] Setting up MariaDB..."
systemctl enable mariadb
systemctl start mariadb

# Create database and user (edit password as needed)
DB_NAME="fellis_eu"
DB_USER="fellis"
DB_PASS="CHANGE_ME_TO_A_STRONG_PASSWORD"

mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# Import schema
if [ -f /var/www/fellis.eu/server/schema.sql ]; then
  mysql ${DB_NAME} < /var/www/fellis.eu/server/schema.sql
  echo "Database schema imported."
fi

# --- 4. Application directory ---
echo "[4/7] Setting up application directory..."
mkdir -p /var/www/fellis.eu/uploads
chown -R www-data:www-data /var/www/fellis.eu/uploads
chmod 755 /var/www/fellis.eu/uploads

# --- 5. Install npm dependencies ---
echo "[5/7] Installing npm dependencies..."
cd /var/www/fellis.eu
npm install

cd /var/www/fellis.eu/server
npm install

# --- 6. Build frontend ---
echo "[6/7] Building frontend..."
cd /var/www/fellis.eu
npx vite build

# --- 7. Create .env file ---
echo "[7/7] Creating server .env..."
if [ ! -f /var/www/fellis.eu/server/.env ]; then
  cat > /var/www/fellis.eu/server/.env <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
PORT=3001
EOF
  echo ".env created. Edit /var/www/fellis.eu/server/.env to add Facebook credentials if needed."
else
  echo ".env already exists, skipping."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your project files to /var/www/fellis.eu/"
echo "  2. Edit /var/www/fellis.eu/server/.env (set DB password, Facebook keys)"
echo "  3. Install the nginx config: cp /var/www/fellis.eu/nginx-fellis.conf /etc/nginx/sites-available/fellis.eu"
echo "  4. Enable the site: ln -s /etc/nginx/sites-available/fellis.eu /etc/nginx/sites-enabled/"
echo "  5. Remove default: rm -f /etc/nginx/sites-enabled/default"
echo "  6. Install the systemd service: cp /var/www/fellis.eu/fellis.service /etc/systemd/system/"
echo "  7. Start the service: systemctl enable --now fellis"
echo "  8. Reload nginx: systemctl reload nginx"
echo "  9. Set up SSL: apt install certbot python3-certbot-nginx && certbot --nginx -d fellis.eu -d www.fellis.eu"
