#!/usr/bin/env npx tsx
/**
 * pi-pets display client entry point.
 *
 * Usage:
 *   npx tsx bin/pi-pets-display.ts <socket-path>
 *
 * The socket path is printed by pi when the pet is loaded:
 *   [pi-pets] Display server listening on /tmp/pi-pets-xxxx.sock
 */

import { runDisplayClient } from "../src/PetDisplayClient.js";

const socketPath = process.argv[2];

if (!socketPath) {
  console.error("Usage: npx tsx bin/pi-pets-display.ts <socket-path>");
  process.exit(1);
}

runDisplayClient(socketPath);
