#!/usr/bin/env bash
# Kill all child processes of the backend and any kiro-cli|opencode processes.
# Called by the backend on "stop" command.

BACKEND_PID=$$

# Kill all kiro-cli processes
pkill -f 'kiro-cli' 2>/dev/null || true

# Kill all opencode processes
pkill -f 'opencode' 2>/dev/null || true

# Kill child process trees of the node backend (our parent)
PARENT_PID=$PPID
if [ -n "$PARENT_PID" ] && [ "$PARENT_PID" != "1" ]; then
  # Get all descendant PIDs except the backend itself and this script
  for pid in $(pgrep -P "$PARENT_PID" 2>/dev/null); do
    # Don't kill the backend node process or this script
    [ "$pid" = "$PARENT_PID" ] && continue
    [ "$pid" = "$BACKEND_PID" ] && continue
    kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
fi
