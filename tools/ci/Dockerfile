# VoltGuard CI test ortamı (Ubuntu sunucudaki tools/ci/voltguard-ci.sh kullanır).
# Yereldeki PHP 8.3 ile aynı sürüm: resmi php imajında ctype, fileinfo, mbstring, openssl, session, sodium vb.
# derlemeye gömülüdür; testlerin "php -n" (ini'siz) çağrıları da bu yüzden eklenti kaybetmez.
FROM php:8.3-cli-bookworm
LABEL voltguard-ci=1
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/bin/python3 /usr/local/bin/python \
 && ln -s /usr/local/bin/php /usr/local/bin/php-ci
ENV VG_PHP=/usr/local/bin/php \
    HOME=/tmp \
    TZ=Europe/Istanbul
WORKDIR /src
CMD ["node", "tools/test.cjs"]
