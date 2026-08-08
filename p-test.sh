#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tsx_bin="$script_dir/node_modules/.bin/tsx"
caller_dir=${INIT_CWD:-$PWD}

if [ ! -x "$tsx_bin" ]; then
  echo "p-test.sh requires repository dependencies. Run npm install --ignore-scripts first." >&2
  exit 1
fi

cd "$caller_dir"
exec "$tsx_bin" "$script_dir/packages/coding-agent/src/cli.ts" "$@"
