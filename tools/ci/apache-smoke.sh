#!/usr/bin/env bash
# Apache 2.4 + PHP 8.3 hazırlık ortamında duman testi (Ubuntu sunucuda, Docker ile; canlıya dokunmaz).
# Verilen commit'i cPanel deploy'una benzer biçimde (yalnız yayınlanan klasörler) bir docroot'a kopyalar, .htaccess
# kurallarıyla çalışan geçici bir php:8.3-apache konteyneri başlatır, tools/ci/apache-smoke-client.php'yi konteyner
# içinden (loopback) çalıştırır ve konteyneri siler. Veri klasörü docroot dışındadır (/data).
#   tools/ci/apache-smoke.sh <commit|dal> [günlük-dosyası]
set -euo pipefail
REF="${1:-claude/site-polish}"
HOME_DIR="${VG_CI_HOME:-$HOME/servisler/voltguard-ci}"
CLIENT="$(cd "$(dirname "$0")" && pwd)/apache-smoke-client.php"
LOG="${2:-$HOME_DIR/logs/apache-smoke-$(date +%Y%m%d-%H%M%S).log}"
NAME="vg-apache-smoke-$$"
work="$(mktemp -d "$HOME_DIR/apache.XXXXXX")"
# Konteyner (www-data) veri klasörüne yazar; ana kullanıcı silemeyeceği için önce konteyner içinden temizlenir
cleanup() { docker exec "$NAME" sh -c 'rm -rf /data/* /data/.[!.]*' >/dev/null 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$work" || true; }
trap cleanup EXIT

git -C "$HOME_DIR/mirror.git" fetch -q --prune
git clone -q --no-checkout "$HOME_DIR/mirror.git" "$work/src"
git -C "$work/src" -c advice.detachedHead=false checkout -q "$REF"
sha="$(git -C "$work/src" rev-parse --short HEAD)"

# Deploy kopyası: .cpanel.yml'nin web köküne koyduğu içerik (tools/, .git, txt/ hariç). Duman istemcisi ve
# editör CLI'si için tools/ ayrıca docroot DIŞINA (/srv/repo) bağlanır.
mkdir -p "$work/docroot" "$work/data"
( cd "$work/src" && tar --exclude=./.git --exclude=./tools --exclude=./txt --exclude=./.claude --exclude=./voltguardekleyelim -cf - . ) | tar -C "$work/docroot" -xf -
chmod -R a+rX "$work/docroot"; chmod 0777 "$work/data"

cat > "$work/vg.conf" <<'CONF'
<Directory /var/www/html>
    AllowOverride All
    Require all granted
</Directory>
ErrorDocument 404 /404.html
CONF

docker run -d --name "$NAME" --network none \
  -e VG_DATA_DIR=/data \
  -v "$work/docroot:/var/www/html:ro" -v "$work/src/tools:/srv/repo/tools:ro" -v "$work/src/api:/srv/repo/api:ro" \
  -v "$CLIENT:/srv/smoke-client.php:ro" -v "$work/data:/data" -v "$work/vg.conf:/etc/apache2/conf-enabled/vg.conf:ro" \
  php:8.3-apache sh -c 'a2enmod -q rewrite headers expires deflate >/dev/null && echo "SetEnv VG_DATA_DIR /data" > /etc/apache2/conf-enabled/vgenv.conf && apache2-foreground' >/dev/null
for i in $(seq 1 30); do docker exec "$NAME" sh -c 'php -r "exit(@file_get_contents(\"http://localhost/robots.txt\")===false?1:0);"' 2>/dev/null && break; sleep 1; done

{
  echo "# Apache duman testi — commit $sha — $(date -Iseconds)"
  docker exec "$NAME" sh -c 'apache2 -v | head -1; php -v | head -1; apache2ctl -M 2>/dev/null | grep -E "rewrite|headers|expires|deflate|setenvif|mime|dir" | tr -d " " | tr "\n" " "; echo'
  # İstemci: editör CLI /srv/repo/tools altındadır; istemci /var/www/html/tools yolunu bekler → bağlantı
  docker exec -u www-data -e VG_DATA_DIR=/data "$NAME" sh -c 'sed "s#/var/www/html/tools/#/srv/repo/tools/#" /srv/smoke-client.php > /tmp/c.php && php /tmp/c.php'
} 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}
echo "günlük: $LOG"
exit "$status"
