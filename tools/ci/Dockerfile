# VoltGuard CI test ortamı (Ubuntu sunucudaki tools/ci/voltguard-ci.sh kullanır).
# Yereldeki PHP 8.3 ile aynı sürüm: resmi php imajında ctype, fileinfo, mbstring, openssl, session, sodium vb.
# derlemeye gömülüdür; testlerin "php -n" (ini'siz) çağrıları da bu yüzden eklenti kaybetmez.
# Saha servis testleri derlenebilir TypeScript kaynağını çalıştırır. Kilitli sürüm
# ve SHA-512 tools/saha-app/package-lock.json ile aynıdır; yalnız güvenilen imaj
# kurulurken indirilir. PR/test çalışırken npm veya ağ erişimi gerekmez.
FROM node:24-bookworm-slim AS test-typescript
RUN node -e 'const fs=require("node:fs"),crypto=require("node:crypto");(async()=>{const r=await fetch("https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz");if(!r.ok)throw new Error("Pinned TypeScript download failed");const data=Buffer.from(await r.arrayBuffer());if(crypto.createHash("sha512").update(data).digest("base64")!=="y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==")throw new Error("Pinned TypeScript integrity failed");fs.writeFileSync("/tmp/typescript.tgz",data);})()' \
 && mkdir -p /opt/voltguard-ci/node_modules/typescript \
 && tar -xzf /tmp/typescript.tgz --strip-components=1 -C /opt/voltguard-ci/node_modules/typescript \
 && rm /tmp/typescript.tgz
FROM php:8.3-cli-bookworm
LABEL voltguard-ci=1
COPY --from=test-typescript /usr/local/bin/node /usr/local/bin/node
COPY --from=test-typescript /opt/voltguard-ci/node_modules/typescript /opt/voltguard-ci/node_modules/typescript
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/bin/python3 /usr/local/bin/python \
 && ln -s /usr/local/bin/php /usr/local/bin/php-ci
ENV VG_PHP=/usr/local/bin/php \
    NODE_PATH=/opt/voltguard-ci/node_modules \
    HOME=/tmp \
    TZ=Europe/Istanbul
WORKDIR /src
CMD ["node", "tools/test.cjs"]
