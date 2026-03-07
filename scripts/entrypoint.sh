#!/bin/sh
# Ashwater AI entrypoint — patches MCP fetch tool then starts the server.

echo "[ashwater] Patching mcp-server-fetch with content cleaning..."
uvx --from mcp-server-fetch python3 -c "pass" 2>/dev/null
python3 /app/scripts/patch-mcp-fetch.py

echo "[ashwater] Starting LibreChat..."
exec node /app/api/server/index.js
