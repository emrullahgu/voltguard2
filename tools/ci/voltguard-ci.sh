#!/usr/bin/env bash
# VoltGuard CI: Ubuntu sunucuda systemd zamanlayıcısıyla birkaç dakikada bir çalışır.
# main dalının ve bu depodan açılmış (fork olmayan) açık PR'ların son commit'lerini bulur, her yeni commit için
# testleri ağsız, kaynak sınırlı bir Docker konteynerinde çalıştırır ve sonucu GitHub'a commit durumu
# ("voltguard-ci") olarak yazar. GitHub Actions'a bağlı değildir.
#
# Dizin (VG_CI_HOME, varsayılan ~/servisler/voltguard-ci):
#   token        GitHub ince ayarlı erişim anahtarı (yalnız bu depo, Commit statuses: Read and write), chmod 600
#   image/       Dockerfile (tools/ci/Dockerfile kopyası)   mirror.git   deponun yansısı      state/   test edilmiş commit'ler      logs/   son 60 test çıktısı
set -euo pipefail

REPO="emrullahgu/voltguard2"
CONTEXT="voltguard-ci"
HOME_DIR="${VG_CI_HOME:-$HOME/servisler/voltguard-ci}"
API="https://api.github.com/repos/$REPO"
TIMEOUT="${VG_CI_TIMEOUT:-1200}"

mkdir -p "$HOME_DIR/state" "$HOME_DIR/logs"
exec 9>"$HOME_DIR/.lock"
flock -n 9 || exit 0                       # önceki çalıştırma sürüyorsa çık
TOKEN="$(tr -d '[:space:]' < "$HOME_DIR/token")"

api() {
  curl -fsS --retry 2 -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
       -H "X-GitHub-Api-Version: 2022-11-28" "$@"
}
set_status() {  # sha durum açıklama
  api -X POST "$API/statuses/$1" \
      -d "$(jq -nc --arg s "$2" --arg d "${3:0:140}" --arg c "$CONTEXT" '{state:$s, description:$d, context:$c}')" >/dev/null
}

# Test edilecek commit'ler: main + aynı depodan açılmış PR başları (fork PR'ları sunucuda kod çalıştırmasın)
targets="$( { api "$API/branches/main" | jq -r '.commit.sha + " main"'
              api "$API/pulls?state=open&per_page=50" | jq -r --arg r "$REPO" '.[] | select(.head.repo.full_name == $r) | .head.sha + " " + .head.ref'
            } | sort -u -k1,1 )"

[ -d "$HOME_DIR/mirror.git" ] || git clone -q --mirror "https://github.com/$REPO.git" "$HOME_DIR/mirror.git"
git -C "$HOME_DIR/mirror.git" fetch -q --prune

while read -r sha ref; do
  [ -n "$sha" ] && [ ! -e "$HOME_DIR/state/$sha" ] || continue
  log="$HOME_DIR/logs/$(date +%Y%m%d-%H%M%S)-${sha:0:10}.log"
  work="$(mktemp -d "$HOME_DIR/work.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  set_status "$sha" pending "Testler çalışıyor ($ref)"

  git clone -q --no-checkout "$HOME_DIR/mirror.git" "$work/src"   # yerel klon (nesneler kopyalanır): konteynerde git çalışır
  git -C "$work/src" -c advice.detachedHead=false checkout -q "$sha"
  # İmaj sunucuya kurulmuş Dockerfile'dan kurulur (PR'daki Dockerfile kullanılmaz); değişmedikçe yeniden kurulmaz
  tag="voltguard-ci:$(sha256sum "$HOME_DIR/image/Dockerfile" | cut -c1-12)"
  docker image inspect "$tag" >/dev/null 2>&1 || docker build -q -t "$tag" "$HOME_DIR/image" >/dev/null

  started=$(date +%s); rc=0
  timeout "$TIMEOUT" docker run --rm --network none --cpus 2 --memory 2g --pids-limit 512 \
      --security-opt no-new-privileges --user "$(id -u):$(id -g)" \
      -v "$work/src:/src" "$tag" > "$log" 2>&1 || rc=$?
  secs=$(( $(date +%s) - started ))
  pass=$(grep -aoP '(ℹ|#) pass \K\d+' "$log" | tail -1 || true)
  fail=$(grep -aoP '(ℹ|#) fail \K\d+' "$log" | tail -1 || true)

  if [ "$rc" -eq 0 ]; then
    set_status "$sha" success "${pass:-?} test geçti · ${secs} sn"
  elif [ "$rc" -eq 124 ]; then
    set_status "$sha" error "Zaman aşımı (${TIMEOUT} sn) · günlük: $(basename "$log")"
  else
    set_status "$sha" failure "${fail:-?} test başarısız, ${pass:-?} geçti · günlük: $(basename "$log")"
  fi
  touch "$HOME_DIR/state/$sha"
  rm -rf "$work"; trap - EXIT
done <<< "$targets"

# Eski günlük ve durum kayıtlarını temizle
ls -1t "$HOME_DIR/logs"/*.log 2>/dev/null | tail -n +61 | xargs -r rm -f
find "$HOME_DIR/state" -type f -mtime +30 -delete
docker image prune -af --filter "label=voltguard-ci=1" --filter "until=720h" >/dev/null 2>&1 || true
