#!/usr/bin/env bash
set -euo pipefail

# Copy the prod database over the dev database.
#
# Credentials never live in this file. Set them in the environment, or put them
# in scripts/.sync.env (gitignored), which this script sources when it exists:
#
#   PROD_URI=mongodb+srv://<read-only-user>:<pass>@<cluster>/prod
#   DEV_URI=mongodb+srv://<user>:<pass>@<cluster>/test
#
# Use a READ-ONLY Atlas database user for PROD_URI. This script only ever reads
# from prod, and a read-only user makes that structural rather than aspirational.
#
# The restore runs with --drop, so the target database is replaced wholesale and
# anything hand-seeded in dev is destroyed. Prod and dev share a cluster, so
# ALLOWED_DEV_DBS is what stands between a mistyped DEV_URI and dropping prod.

ALLOWED_DEV_DBS="test dev"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/.sync.env"

usage() {
  cat <<'USAGE'
Usage: sync-prod-to-dev.sh [-y|--yes]

Dumps the prod database and restores it over the dev database.

  -y, --yes   Skip the confirmation prompt.
  -h, --help  Show this message.

Requires PROD_URI and DEV_URI in the environment or in scripts/.sync.env.
USAGE
}

assume_yes=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes)  assume_yes=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "sync: unknown argument '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

# ─── Load credentials ────────────────────────────────────────────────
# Anything already exported wins over the file, so a one-off override works:
#   DEV_URI=... ./scripts/sync-prod-to-dev.sh
pre_prod_uri="${PROD_URI:-}"
pre_dev_uri="${DEV_URI:-}"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi
if [[ -n "$pre_prod_uri" ]]; then PROD_URI="$pre_prod_uri"; fi
if [[ -n "$pre_dev_uri" ]];  then DEV_URI="$pre_dev_uri";   fi

for var in PROD_URI DEV_URI; do
  if [[ -z "${!var:-}" ]]; then
    echo "sync: $var is not set. Export it, or add it to $env_file" >&2
    exit 1
  fi
done

for tool in mongodump mongorestore mongosh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "sync: $tool not found on PATH" >&2; exit 1; }
done

# ─── Work out which databases we are pointing at ─────────────────────
# mongodb+srv://user:pass@host/dbname?opts -> dbname
db_name_from_uri() {
  local after_host="${1##*@}"     # host/dbname?opts
  after_host="${after_host%%\?*}" # host/dbname
  case "$after_host" in
    */*) printf '%s' "${after_host#*/}" ;;
    *)   printf '%s' "" ;;
  esac
}

PROD_DB="$(db_name_from_uri "$PROD_URI")"
DEV_DB="$(db_name_from_uri "$DEV_URI")"

[[ -n "$PROD_DB" ]] || { echo "sync: PROD_URI has no database name in its path" >&2; exit 1; }
[[ -n "$DEV_DB"  ]] || { echo "sync: DEV_URI has no database name in its path" >&2; exit 1; }

# ─── Guard rail ──────────────────────────────────────────────────────
# The restore is destructive and prod lives on the same cluster, so refuse to
# write anywhere that is not an explicitly known dev database.
case " $ALLOWED_DEV_DBS " in
  *" $DEV_DB "*) ;;
  *)
    echo "sync: refusing to restore into database '$DEV_DB'." >&2
    echo "      Allowed targets: $ALLOWED_DEV_DBS" >&2
    echo "      Check DEV_URI, or add '$DEV_DB' to ALLOWED_DEV_DBS if it really is a dev database." >&2
    exit 1
    ;;
esac

if [[ "$PROD_DB" == "$DEV_DB" ]]; then
  echo "sync: PROD_URI and DEV_URI both point at database '$PROD_DB'. Refusing." >&2
  exit 1
fi

# ─── Confirm ─────────────────────────────────────────────────────────
echo "About to DROP and replace database '$DEV_DB' with a copy of '$PROD_DB'."
if (( ! assume_yes )); then
  if [[ ! -t 0 ]]; then
    echo "sync: not a terminal; re-run with --yes to confirm non-interactively." >&2
    exit 1
  fi
  read -r -p "Type '$DEV_DB' to continue: " reply
  [[ "$reply" == "$DEV_DB" ]] || { echo "sync: aborted."; exit 1; }
fi

# ─── Dump, restore, verify ───────────────────────────────────────────
DUMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/prod-dump.XXXXXX")"
cleanup() { rm -rf "$DUMP_DIR"; }
trap cleanup EXIT

# Dump the whole database rather than a hand-maintained collection list, so a
# new model never silently goes missing from dev.
echo "==> Dumping '$PROD_DB'..."
mongodump --uri="$PROD_URI" --out="$DUMP_DIR" --quiet

if [[ ! -d "$DUMP_DIR/$PROD_DB" ]]; then
  echo "sync: dump produced nothing for '$PROD_DB'" >&2
  exit 1
fi

echo "==> Restoring into '$DEV_DB' (--drop)..."
mongorestore --uri="$DEV_URI" --drop --quiet "$DUMP_DIR/$PROD_DB/"

echo "==> Document counts in '$DEV_DB':"
mongosh "$DEV_URI" --quiet --eval '
  db.getCollectionNames().sort().forEach(c => print("    " + c.padEnd(24) + db[c].countDocuments()));
'

echo "==> Done."
