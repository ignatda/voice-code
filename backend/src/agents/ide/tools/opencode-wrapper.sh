#!/usr/bin/env bash
# opencode-wrapper.sh — Wraps opencode, captures output, and prints a formatted summary.
# When running inside IntelliJ (via execute_terminal_command), emits structured
# IDE action directives that the JetBrains agent can parse and execute via MCP tools.
#
# Usage:
#   ./opencode-wrapper.sh run "Add error handling to index.ts"
#   ./opencode-wrapper.sh -c run "Fix the type error"
#   ./opencode-wrapper.sh --auto-open-files run "Refactor browser agent"
#   ./opencode-wrapper.sh --validate-build run "Add new endpoint"
#   ./opencode-wrapper.sh --auto-open-files --validate-build run "..."
#   ./opencode-wrapper.sh <any opencode args...>

set -euo pipefail

# ── Flags ──────────────────────────────────────────────────────────────────────
AUTO_OPEN=false
VALIDATE_BUILD=false
OPENCODE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto-open-files)  AUTO_OPEN=true; shift ;;
    --validate-build)   VALIDATE_BUILD=true; shift ;;
    *)                  OPENCODE_ARGS+=("$1"); shift ;;
  esac
done

# ── IDE detection ──────────────────────────────────────────────────────────────
is_ide_context() {
  [[ -n "${INTELLIJ_ENVIRONMENT_READER:-}" ]] ||
  [[ -n "${TERMINAL_EMULATOR:-}" && "${TERMINAL_EMULATOR:-}" == *JetBrains* ]] ||
  [[ -n "${JEDITERM_USER_RCFILE:-}" ]] ||
  [[ -n "${IJ_MCP_SERVER_PORT:-}" ]]
}

# ── Colors ─────────────────────────────────────────────────────────────────────
BLUE='\033[1;34m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
RED='\033[1;31m'
RESET='\033[0m'

FILE_EXTS='ts|tsx|js|jsx|json|sh|md|css|html|py|yaml|yml|toml|vue|svelte'

# ── Run opencode ───────────────────────────────────────────────────────────────
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

opencode "${OPENCODE_ARGS[@]}" 2>&1 | tee "$tmpfile"
exit_code=${PIPESTATUS[0]}

# ── Extract file lists ─────────────────────────────────────────────────────────
all_files=$(grep -oE "[a-zA-Z0-9_./-]+\\.($FILE_EXTS)" "$tmpfile" | sort -u || true)
created_files=$(grep -oE "(creat|generat|wrote|writing)[a-z]* +[^ ]+\\.($FILE_EXTS)" "$tmpfile" | sed 's/^[a-z]* //' | sort -u || true)
edited_files=$(grep -oE "(edit|modif|updat|chang|replac|rewrit)[a-z]* +[^ ]+\\.($FILE_EXTS)" "$tmpfile" | sed 's/^[a-z]* //' | sort -u || true)
changed_files=$(printf '%s\n%s' "$created_files" "$edited_files" | grep -v '^$' | sort -u || true)

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══════════════════════════════════════════${RESET}"
echo -e "${BLUE}       OPENCODE SESSION SUMMARY${RESET}"
echo -e "${BLUE}═══════════════════════════════════════════${RESET}"

if [ "$exit_code" -eq 0 ]; then
  echo -e "${GREEN}Status: ✅ Completed successfully${RESET}"
else
  echo -e "${YELLOW}Status: ⚠️  Exited with code $exit_code${RESET}"
fi

summary=$(grep -iE '(summary|result|done|completed|finished|created|updated|modified|generated)' "$tmpfile" | tail -10 || true)
if [ -n "$summary" ]; then
  echo ""
  echo -e "${CYAN}Result Summary:${RESET}"
  echo "$summary" | sed 's/^/  /'
fi

if [ -n "$created_files" ]; then
  echo ""
  echo -e "${GREEN}Generated / Created:${RESET}"
  echo "$created_files" | sed 's/^/  📄 /'
fi

if [ -n "$edited_files" ]; then
  echo ""
  echo -e "${YELLOW}Edits / Modifications:${RESET}"
  echo "$edited_files" | sed 's/^/  ✏️  /'
fi

if [ -n "$all_files" ]; then
  echo ""
  echo -e "${CYAN}Files Referenced:${RESET}"
  echo "$all_files" | sed 's/^/  📁 /'
fi

changes=$(grep -iE '^\s*([-*•]|[0-9]+[.)]) ' "$tmpfile" | head -15 || true)
if [ -n "$changes" ]; then
  echo ""
  echo -e "${CYAN}Key Changes:${RESET}"
  echo "$changes" | sed 's/^/  /'
fi

# ── IDE Integration ────────────────────────────────────────────────────────────
if is_ide_context || [ "$AUTO_OPEN" = true ] || [ "$VALIDATE_BUILD" = true ]; then
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════${RESET}"
  echo -e "${BLUE}         IDE INTEGRATION${RESET}"
  echo -e "${BLUE}═══════════════════════════════════════════${RESET}"

  if is_ide_context; then
    echo -e "${CYAN}IDE context detected${RESET}"
  fi

  actions=()

  if [ "$AUTO_OPEN" = true ] && [ -n "$changed_files" ]; then
    echo ""
    echo -e "${CYAN}Files to open & reformat in editor:${RESET}"
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      echo -e "  📂 $f"
      actions+=("open:$f")
      actions+=("reformat:$f")
    done <<< "$changed_files"
  fi

  if [ "$VALIDATE_BUILD" = true ]; then
    echo ""
    echo -e "${CYAN}Build validation requested${RESET}"
    actions+=("build")
    if [ -n "$changed_files" ]; then
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        actions+=("problems:$f")
      done <<< "$changed_files"
    fi
  fi

  if [ ${#actions[@]} -gt 0 ]; then
    echo ""
    echo "--- OPENCODE_IDE_ACTIONS_BEGIN ---"
    echo "{"
    echo "  \"exit_code\": $exit_code,"

    printf '  "changed_files": ['
    first=true
    if [ -n "$changed_files" ]; then
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        if [ "$first" = true ]; then first=false; else printf ','; fi
        printf '"%s"' "$f"
      done <<< "$changed_files"
    fi
    echo '],'

    printf '  "actions": ['
    first=true
    for a in "${actions[@]}"; do
      if [ "$first" = true ]; then first=false; else printf ','; fi
      printf '"%s"' "$a"
    done
    echo '],'

    echo "  \"auto_open\": $AUTO_OPEN,"
    echo "  \"validate_build\": $VALIDATE_BUILD"
    echo "}"
    echo "--- OPENCODE_IDE_ACTIONS_END ---"

    echo ""
    echo -e "${YELLOW}⚡ IDE actions emitted. The JetBrains agent will execute:${RESET}"
    for a in "${actions[@]}"; do
      case "$a" in
        open:*)     echo -e "  📂 Open: ${a#open:}" ;;
        reformat:*) echo -e "  🔧 Reformat: ${a#reformat:}" ;;
        build)      echo -e "  🏗️  Run build validation" ;;
        problems:*) echo -e "  🔍 Check problems: ${a#problems:}" ;;
      esac
    done
  fi
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════${RESET}"

exit "$exit_code"
