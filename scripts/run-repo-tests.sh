#!/usr/bin/env bash
# Run workspace unit tests without discovering packaged Electron output under
# apps/electron/release/ (electron-builder copies *.test.ts into the .app bundle).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mapfile -t TEST_FILES < <(
  find packages apps scripts -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \) \
    ! -path '*/node_modules/*' \
    ! -path 'apps/electron/release/*' \
    ! -path 'apps/electron/dist/*' \
    ! -path '*/dist/*' \
    | sort
)

if [ "${#TEST_FILES[@]}" -eq 0 ]; then
  echo "run-repo-tests: no test files found"
  exit 1
fi

bun test "${TEST_FILES[@]}"

while IFS= read -r -d '' f; do
  bun test "$f" || exit 1
done < <(find . -name '*.isolated.ts' -not -path './node_modules/*' -not -path './apps/electron/release/*' -not -path './apps/electron/dist/*' -not -path './dist/*' -print0)
