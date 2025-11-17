#!/usr/bin/env bash

set -euo pipefail

SNIPPETS_DIR="packages/webzjs-wallet/snippets"
WASM_THREAD_DIR=$(find "$SNIPPETS_DIR" -type d -name "wasm_thread-*" | head -n 1 || true)

if [[ -z "$WASM_THREAD_DIR" ]]; then
    echo "Error: Could not find wasm_thread directory under $SNIPPETS_DIR" >&2
    exit 1
fi

TARGET_DIR="$WASM_THREAD_DIR/src/wasm32/js"
TARGET_FILE="$TARGET_DIR/web_worker_module.bundler.js"

mkdir -p "$TARGET_DIR"

cat > "$TARGET_FILE" <<'EOL'
// Import the wasm-bindgen shim and the thread entry point from the main package.
import init, { wasm_thread_entry_point } from "../../../../../";

// Wait for the main thread to send us the shared module, memory, and work context.
self.onmessage = (event) => {
  const [module, memory, worker, _threadKey] = event.data;
  init(module, memory)
    .then(() => {
      wasm_thread_entry_point(worker);
    })
    .catch((error) => {
      console.error("Failed to initialize wasm worker:", error);
      // Re-throw asynchronously so the main thread can capture the failure.
      setTimeout(() => {
        throw error;
      });
      throw error;
    });
};

self.onunhandledrejection = (event) => {
  console.error("Worker unhandled rejection:", event.reason);
  throw event.reason;
};

self.onerror = (event) => {
  console.error("Worker error:", event.message);
  throw event.error ?? event.message;
};
EOL

echo "Added worker module to: $TARGET_FILE"
