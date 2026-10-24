#!/bin/sh
# CI konteynerinde çalışır (tools/ci/voltguard-ci.sh). Mühendislik araçlarının testleri derleme çıktısını
# (tools/engineering/dist, storage-map.json — git'te yok) okuduğundan önce derleme yapılır; yayınlanan
# araclar/ klasörü commit'teki hâliyle aynı kalmalıdır, aksi hâlde derleme commit edilmemiş demektir.
set -eu
node tools/build-engineering.cjs > /tmp/build-engineering.log 2>&1 || { cat /tmp/build-engineering.log; exit 1; }
# Çevrimdışı ZIP dosya zaman damgalarını taşır, her derlemede baytları değişir; içerik karşılaştırması dışında tutulur
changed="$(git status --porcelain -- araclar ':!araclar/downloads/*.zip')"
if [ -n "$changed" ]; then
  echo "araclar/ derlemesi commit'teki hâlinden farklı (node tools/build-engineering.cjs çalıştırıp commit edin):"
  echo "$changed" | head -20
  exit 1
fi
exec node tools/test.cjs
