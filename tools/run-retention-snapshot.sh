#!/bin/sh
# Private, bounded daily inventory. No application bootstrap, network, mail or cleanup.
# Keep retention-audit.php beside this file. Requires Linux flock, realpath and stat.
set -u
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
umask 077

fail() { printf '%s\n' "retention snapshot failed: $1" >&2; exit 1; }
usage() {
    printf '%s\n' 'Usage: sh run-retention-snapshot.sh --php /absolute/php --data-dir /private/data --docroot /web/root --output-dir /private/0700-output'
}
if [ "$#" -eq 1 ] && [ "$1" = '--help' ]; then usage; exit 0; fi
php_bin= data_dir= docroot= output_dir=
while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] || fail invalid_arguments
    case "$1" in
        --php) [ -z "$php_bin" ] || fail invalid_arguments; php_bin=$2 ;;
        --data-dir) [ -z "$data_dir" ] || fail invalid_arguments; data_dir=$2 ;;
        --docroot) [ -z "$docroot" ] || fail invalid_arguments; docroot=$2 ;;
        --output-dir) [ -z "$output_dir" ] || fail invalid_arguments; output_dir=$2 ;;
        *) fail invalid_arguments ;;
    esac
    shift 2
done
for value in "$php_bin" "$data_dir" "$docroot" "$output_dir"; do
    case "$value" in /*) ;; *) fail absolute_paths_required ;; esac
    if printf '%s' "$value" | LC_ALL=C grep '[[:cntrl:]]' >/dev/null; then fail invalid_path; fi
done
[ -f "$php_bin" ] && [ -x "$php_bin" ] || fail php_unavailable
for utility in flock realpath stat mktemp; do command -v "$utility" >/dev/null 2>&1 || fail utility_unavailable; done
for directory in "$data_dir" "$docroot" "$output_dir"; do
    [ -d "$directory" ] && [ ! -L "$directory" ] || fail unsafe_directory
    canonical=$(realpath -e -- "$directory" 2>/dev/null) || fail unsafe_directory
    [ "$canonical" = "$directory" ] || fail unsafe_directory
done
case "$data_dir/" in "$docroot/"*) fail overlapping_directories ;; esac
case "$docroot/" in "$data_dir/"*) fail overlapping_directories ;; esac
case "$output_dir/" in "$docroot/"*|"$data_dir/"*) fail overlapping_directories ;; esac
case "$docroot/" in "$output_dir/"*) fail overlapping_directories ;; esac
case "$data_dir/" in "$output_dir/"*) fail overlapping_directories ;; esac
owner=$(id -u) || fail owner_unavailable
[ "$(stat -c '%u %a' -- "$output_dir" 2>/dev/null)" = "$owner 700" ] || fail output_not_private
script_dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd) || fail audit_unavailable
audit="$script_dir/retention-audit.php"
[ -f "$audit" ] && [ ! -L "$audit" ] && [ -r "$audit" ] || fail audit_unavailable

safe_file() {
    [ ! -L "$1" ] || return 1
    if [ -e "$1" ]; then
        [ -f "$1" ] && [ "$(stat -c '%h %u %a' -- "$1" 2>/dev/null)" = "1 $owner 600" ] || return 1
        [ "$(stat -c '%s' -- "$1" 2>/dev/null)" -le 65536 ] || return 1
    fi
}
lock="$output_dir/inventory.lock"
latest="$output_dir/latest.json"
previous="$output_dir/previous.json"
for target in "$lock" "$latest" "$previous"; do safe_file "$target" || fail unsafe_output; done
# The coordination inode is permanent. A busy invocation exits without changing reports.
exec 9>>"$lock" || fail lock_unavailable
flock -E 75 -n 9
lock_exit=$?
case "$lock_exit" in 0) ;; 75) exit 0 ;; *) fail lock_failed ;; esac
for target in "$lock" "$latest" "$previous"; do safe_file "$target" || fail unsafe_output; done

raw= staged= saved=
cleanup() {
    for scratch in "$raw" "$staged" "$saved"; do
        [ -z "$scratch" ] || rm -f -- "$scratch"
    done
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
raw=$(mktemp "$output_dir/.retention-raw.XXXXXX") || fail temporary_file_failed
staged=$(mktemp "$output_dir/.retention-staged.XXXXXX") || fail temporary_file_failed
# The audit has its own entry/time/read budget; file-size limit also bounds unexpected output.
(ulimit -f 128; "$php_bin" -n "$audit" --data-dir "$data_dir" --docroot "$docroot" --max-entries 10000 --max-seconds 5) >"$raw" 2>/dev/null
audit_exit=$?
"$php_bin" -n -r '
    $raw = @file_get_contents($argv[1], false, null, 0, 32769);
    $audit = is_string($raw) && strlen($raw) <= 32768 ? json_decode($raw, true, 32) : null;
    $exit = (int)$argv[2];
    $valid = is_array($audit) && ($audit["tool"] ?? null) === "voltguard-retention-audit/1"
        && is_bool($audit["ok"] ?? null)
        && (($audit["ok"] === true && is_bool($audit["complete"] ?? null) && is_array($audit["groups"] ?? null) && in_array($exit, [0, 1], true))
            || ($audit["ok"] === false && is_string($audit["error"] ?? null) && in_array($exit, [1, 2], true)));
    $value = ["tool" => "voltguard-retention-snapshot/1", "checkedAt" => gmdate("c"),
        "ok" => $valid && $exit === 0 && ($audit["complete"] ?? false) === true, "auditExitCode" => $exit];
    if ($valid) $value["audit"] = $audit;
    else $value["error"] = "audit_output_invalid_or_process_failed";
    echo json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
    exit($valid ? 0 : 3);
' "$raw" "$audit_exit" >"$staged" 2>/dev/null
encoding_exit=$?
case "$encoding_exit" in 0|3) ;; *) fail report_encoding_failed ;; esac
safe_file "$staged" || fail unsafe_output
for target in "$latest" "$previous"; do safe_file "$target" || fail unsafe_output; done
if [ -e "$latest" ]; then
    saved=$(mktemp "$output_dir/.retention-previous.XXXXXX") || fail temporary_file_failed
    cp -P -- "$latest" "$saved" || fail previous_copy_failed
    safe_file "$saved" || fail unsafe_output
    mv -f -- "$saved" "$previous" || fail previous_publish_failed
    saved=
fi
mv -f -- "$staged" "$latest" || fail report_publish_failed
staged=
[ "$encoding_exit" -ne 3 ] || [ "$audit_exit" -ne 0 ] || exit 1
exit "$audit_exit"
