#!/usr/bin/env bash
# kiro-wrapper.sh — Wraps kiro-cli, captures output, and prints a formatted summary.
# When running inside IntelliJ (via execute_terminal_command), emits structured
# IDE action directives that the JetBrains agent can parse and execute via MCP tools.
#
# Usage:
#   ./kiro-wrapper.sh chat "Add error handling to index.ts"
#   ./kiro-wrapper.sh chat --resume "Fix the type error"
#   ./kiro-wrapper.sh --auto-open-files chat "Refactor browser agent"
#   ./kiro-wrapper.sh --validate-build chat "Add new endpoint"
#   ./kiro-wrapper.sh --auto-open-files --validate-build chat "..."
#   ./kiro-wrapper.sh <any kiro-cli args...>

set -euo pipefail

# ── Flags ──────────────────────────────────────────────────────────────────────
AUTO_OPEN=false
VALIDATE_BUILD=false
KIRO_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto-open-files)  AUTO_OPEN=true; shift ;;
    --validate-build)   VALIDATE_BUILD=true; shift ;;
    *)                  KIRO_ARGS+=("$1"); shift ;;
  esac
done

# ── IDE detection ──────────────────────────────────────────────────────────────
# When the JetBrains agent runs this via execute_terminal_command, TERMINAL_EMULATOR
# or INTELLIJ_ENVIRONMENT_READER is typically set. Also check for the MCP port.
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

# ── Run kiro-cli ───────────────────────────────────────────────────────────────
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

kiro-cli "${KIRO_ARGS[@]}" 2>&1 | tee "$tmpfile"
exit_code=${PIPESTATUS[0]}

# ── Extract file lists ─────────────────────────────────────────────────────────
all_files=$(grep -oE "[a-zA-Z0-9_./-]+\\.($FILE_EXTS)" "$tmpfile" | sort -u || true)
created_files=$(grep -oE "(creat|generat|wrote|writing)[a-z]* +[^ ]+\\.($FILE_EXTS)" "$tmpfile" | sed 's/^[a-z]* //' | sort -u || true)
edited_files=$(grep -oE "(edit|modif|updat|chang|replac|rewrit)[a-z]* +[^ ]+\\.($FILE_EXTS)" "$tmpfile" | sed 's/^[a-z]* //' | sort -u || true)

# Combine created + edited as "changed files"
changed_files=$(printf '%s\n%s' "$created_files" "$edited_files" | grep -v '^$' | sort -u || true)

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══════════════════════════════════════════${RESET}"
echo -e "${BLUE}         KIRO SESSION SUMMARY${RESET}"
echo -e "${BLUE}═══════════════════════════════════════════${RESET}"

# Status
if [ "$exit_code" -eq 0 ]; then
  echo -e "${GREEN}Status: ✅ Completed successfully${RESET}"
else
  echo -e "${YELLOW}Status: ⚠️  Exited with code $exit_code${RESET}"
fi

# Result summary
summary=$(grep -iE '(summary|result|done|completed|finished|created|updated|modified|generated)' "$tmpfile" | tail -10 || true)
if [ -n "$summary" ]; then
  echo ""
  echo -e "${CYAN}Result Summary:${RESET}"
  echo "$summary" | sed 's/^/  /'
fi

# Files created
if [ -n "$created_files" ]; then
  echo ""
  echo -e "${GREEN}Generated / Created:${RESET}"
  echo "$created_files" | sed 's/^/  📄 /'
fi

# Files edited
if [ -n "$edited_files" ]; then
  echo ""
  echo -e "${YELLOW}Edits / Modifications:${RESET}"
  echo "$edited_files" | sed 's/^/  ✏️  /'
fi

# All referenced files
if [ -n "$all_files" ]; then
  echo ""
  echo -e "${CYAN}Files Referenced:${RESET}"
  echo "$all_files" | sed 's/^/  📁 /'
fi

# Key changes (bullet/numbered items)
changes=$(grep -iE '^\s*([-*•]|[0-9]+[.)]) ' "$tmpfile" | head -15 || true)
if [ -n "$changes" ]; then
  echo ""
  echo -e "${CYAN}Key Changes:${RESET}"
  echo "$changes" | sed 's/^/  /'
fi

# ── IDE Integration ────────────────────────────────────────────────────────────
# Emit a structured JSON block that the JetBrains agent can parse and act on.
# The agent reads terminal output and can call open_file_in_editor, reformat_file,
# build_project, get_file_problems via its MCP tools.

if is_ide_context || [ "$AUTO_OPEN" = true ] || [ "$VALIDATE_BUILD" = true ]; then
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════${RESET}"
  echo -e "${BLUE}         IDE INTEGRATION${RESET}"
  echo -e "${BLUE}═══════════════════════════════════════════${RESET}"

  if is_ide_context; then
    echo -e "${CYAN}IDE context detected${RESET}"
  fi

  # Build a list of IDE actions as structured directives
  actions=()

  # Auto-open changed files
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

  # Validate build
  if [ "$VALIDATE_BUILD" = true ]; then
    echo ""
    echo -e "${CYAN}Build validation requested${RESET}"
    actions+=("build")
    # Check problems for changed files
    if [ -n "$changed_files" ]; then
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        actions+=("problems:$f")
      done <<< "$changed_files"
    fi
  fi

  # Emit the structured directive block for the JetBrains agent to parse.
  # Format: JSON array between markers so the agent can reliably extract it.
  if [ ${#actions[@]} -gt 0 ]; then
    echo ""
    echo "--- KIRO_IDE_ACTIONS_BEGIN ---"
    echo "{"
    echo "  \"exit_code\": $exit_code,"

    # changed_files as JSON array
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

    # actions as JSON array
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
    echo "--- KIRO_IDE_ACTIONS_END ---"

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
