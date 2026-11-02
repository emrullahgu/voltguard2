# VoltGuard trusted offline CI runtime. Dependency downloads happen only at image build.
# Compiler versions and all transitive integrity hashes are pinned in runtime/package-lock.json.
# The embedded manifest hashes make a compiler lock update change the Dockerfile image tag.
FROM node:24-bookworm-slim AS test-runtime
WORKDIR /opt/voltguard-ci
COPY runtime/package.json runtime/package-lock.json ./
RUN printf '%s  package.json\n%s  package-lock.json\n' \
      '6ab30d1352b8c8283860438847be6eb851d3f4f8521939629591b8ac46914656' \
      '1d3bcf08195f23614f6775698806264f657d3b16091aa467b9d978e5160069c5' | sha256sum -c - \
 && npm ci --prefix /opt/voltguard-ci --ignore-scripts --no-fund --no-audit --registry=https://registry.npmjs.org \
 && node -e 'const a=require("node:assert/strict");a.equal(require("typescript").version,"6.0.3");a.equal(require("@babel/core").version,"7.29.7");'
FROM php:8.3-cli-bookworm
LABEL voltguard-ci=1
COPY --from=test-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=test-runtime /opt/voltguard-ci/node_modules /opt/voltguard-ci/node_modules
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
