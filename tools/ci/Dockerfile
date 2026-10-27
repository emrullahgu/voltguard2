# VoltGuard trusted offline CI runtime. Dependency downloads happen only at image build.
# Compiler versions and all transitive integrity hashes are pinned in runtime/package-lock.json.
# The embedded manifest hashes make a compiler lock update change the Dockerfile image tag.
FROM node:24-bookworm-slim AS test-runtime
WORKDIR /opt/voltguard-ci
COPY runtime/package.json runtime/package-lock.json ./
RUN printf '%s  package.json\n%s  package-lock.json\n' \
      'eec8926916ebc1d349cd22ed7b2b9a97522b119c8f3fd0560eb4fadc9e7c5376' \
      '534accc822ba62b23206b82126425341c7c297befcc1a7c5e180edb2fccb0fc8' | sha256sum -c - \
 && npm ci --prefix /opt/voltguard-ci --ignore-scripts --no-fund --no-audit --registry=https://registry.npmjs.org \
 && node -e 'const a=require("node:assert/strict");a.equal(require("typescript").version,"6.0.3");a.equal(require("@babel/core").version,"7.29.0");'
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
