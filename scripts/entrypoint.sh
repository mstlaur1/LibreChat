#!/bin/sh
# Ashwater AI entrypoint — patches MCP fetch tool then starts the server.

echo "[ashwater] Pre-warming mcp-server-fetch cache..."
if ! uvx --from mcp-server-fetch python3 -c "pass"; then
  echo "[ashwater] WARNING: failed to pre-warm mcp-server-fetch cache"
fi

echo "[ashwater] Patching mcp-server-fetch with content cleaning..."
if ! python3 /app/scripts/patch-mcp-fetch.py; then
  echo "[ashwater] WARNING: MCP fetch patch failed — content cleaning disabled"
fi

echo "[ashwater] Starting LibreChat..."
exec node /app/api/server/index.js
