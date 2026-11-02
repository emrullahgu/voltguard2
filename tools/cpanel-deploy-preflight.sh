#!/bin/sh
# Run from the Git checkout before any deployment target is changed.
# PHP 8.3+ can lint several files per process; no application code is executed.
set -u
fail() { printf '%s\n' "cPanel preflight failed - $1" >&2; exit 1; }
php_bin=php
case "$#" in
    0) ;;
    2) [ "$1" = '--php' ] || fail invalid_arguments; php_bin=$2 ;;
    *) fail invalid_arguments ;;
esac
php_bin=$(command -v "$php_bin" 2>/dev/null) || fail php_cli_unavailable
case "$php_bin" in /*) ;; *) fail absolute_php_path_required ;; esac
[ -x "$php_bin" ] || fail php_cli_unavailable
"$php_bin" -n -r 'exit(PHP_SAPI === "cli" && PHP_VERSION_ID >= 80300 ? 0 : 1);' >/dev/null 2>&1 || fail php_83_cli_required
command -v find >/dev/null 2>&1 || fail find_unavailable
root=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd) || fail source_root_unavailable
cd "$root" || fail source_root_unavailable

# Match the recipe's named sources. Reject every source link, including nested
# static assets, so a copied link cannot expose files outside the Git checkout.
directories='fonts css js assets public api bilgi hizmetler akademi sor mm hesap calisan hesaplama araclar voltsim volthaber magaza'
files='.htaccess contact.php index.html 404.html manifest.json robots.txt llms.txt sitemap.xml sw.js'
for directory in $directories; do
    [ -d "$directory" ] && [ ! -L "$directory" ] && [ -r "$directory" ] && [ -x "$directory" ] || fail required_directory_missing_or_linked
done
for file in $files; do
    [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] || fail required_file_missing_or_linked
done
walk_sources() {
    for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        [ ! -L "$entry" ] || fail linked_source
        if [ -d "$entry" ]; then
            [ -r "$entry" ] && [ -x "$entry" ] || fail unreadable_source
            walk_sources "$entry"
        elif [ -f "$entry" ]; then
            [ -r "$entry" ] || fail unreadable_source
        else
            fail nonregular_source
        fi
    done
}
for directory in $directories; do walk_sources "$directory"; done
# Root HTML is copied by a glob, so validate every matching member as well.
for file in ./*.html; do
    [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] || fail unsafe_root_html
done
# find's batched -exec form returns failure if any PHP invocation fails.
# Requiring PHP>=8.3 prevents older versions from silently checking only file one.
find contact.php api calisan volthaber magaza -type f -name '*.php' -exec "$php_bin" -n -l '{}' + >/dev/null 2>&1 || fail php_syntax_check_failed
printf '%s\n' 'cPanel preflight passed'
