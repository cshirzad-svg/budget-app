#!/usr/bin/env bash
# Установка бота «Бюджет в конвертах» на свой сервер (Ubuntu). Запускать от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/cshirzad-svg/budget-app/main/server/setup.sh)
set -euo pipefail
REPO=https://github.com/cshirzad-svg/budget-app.git
APP=/opt/konverty
DATA=/var/lib/konverty
ENVF=/etc/konverty.env
DOMAIN=konverty.app

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запусти от root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a==22&&b>=13)?0:1)'; }

say "Ставлю программы"
apt-get update -y
apt-get install -y git curl ca-certificates ufw gnupg sudo
if ! node_ok; then
  apt-get install -y nodejs || true
  if ! node_ok; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi
echo "Node $(node -v)"
if ! command -v caddy >/dev/null; then
  apt-get install -y caddy || {
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy; }
fi

say "Скачиваю код бота"
if [ -d "$APP/.git" ]; then git -C "$APP" fetch -q origin && git -C "$APP" reset -q --hard origin/main; else git clone -q "$REPO" "$APP"; fi

id konverty >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin konverty
mkdir -p "$DATA" && chown -R konverty:konverty "$DATA" && chmod 700 "$DATA"

if [ ! -s "$ENVF" ]; then
  say "Секреты (то, что вставляешь, не видно на экране — это нормально, просто нажми Enter)"
  read -rsp "Токен бота от @BotFather: " BOT_TOKEN; echo
  read -rp  "Cloudflare Account ID: " CF_ACCOUNT_ID
  read -rsp "Cloudflare API-токен Workers AI: " CF_AI_TOKEN; echo
  umask 077
  printf 'BOT_TOKEN=%s\nCF_ACCOUNT_ID=%s\nCF_AI_TOKEN=%s\nKONVERTY_DATA=%s\n' "$BOT_TOKEN" "$CF_ACCOUNT_ID" "$CF_AI_TOKEN" "$DATA" > "$ENVF"
  chown root:konverty "$ENVF"; chmod 640 "$ENVF"
fi

NODEFLAGS="--disable-warning=ExperimentalWarning"
node -e 'require("node:sqlite")' 2>/dev/null || NODEFLAGS="$NODEFLAGS --experimental-sqlite"

say "Переношу данные из Cloudflare"
if [ ! -s "$DATA/konverty.db" ] || [ "${REIMPORT:-0}" = 1 ]; then
  systemctl stop konverty 2>/dev/null || true
  sudo -u konverty bash -c "set -a; . $ENVF; set +a; node $NODEFLAGS $APP/server/import.mjs https://$DOMAIN"
else echo "База уже есть, пропускаю (REIMPORT=1 — перенести заново)"; fi

say "Сервис бота"
cat > /etc/systemd/system/konverty.service <<UNIT
[Unit]
Description=Budget envelopes bot and site
After=network-online.target
Wants=network-online.target
[Service]
User=konverty
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=/usr/bin/env node $NODEFLAGS $APP/server/run.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT

cat > /usr/local/bin/konverty-update <<UPD
#!/usr/bin/env bash
# Автообновление: если в GitHub новый код — забрать и перезапустить
set -e
cd $APP
git fetch -q origin main
if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/main)" ]; then
  git reset -q --hard origin/main
  systemctl restart konverty
  echo "обновлено до \$(git rev-parse --short HEAD)"
fi
UPD
chmod +x /usr/local/bin/konverty-update
cat > /etc/systemd/system/konverty-update.service <<UNIT
[Unit]
Description=Update bot from GitHub
[Service]
Type=oneshot
ExecStart=/usr/local/bin/konverty-update
UNIT
cat > /etc/systemd/system/konverty-update.timer <<UNIT
[Unit]
Description=Check bot updates every 2 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT

say "HTTPS (Caddy)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN, www.$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
CADDY

ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now konverty konverty-update.timer
systemctl restart caddy
sleep 3
say "Проверка"
systemctl is-active konverty && curl -s -o /dev/null -w "Бот на сервере отвечает: HTTP %{http_code}\n" -H "Host: $DOMAIN" http://127.0.0.1:8787/
echo
echo "ГОТОВО ✅  Напиши Claude: «сервер готов»."
