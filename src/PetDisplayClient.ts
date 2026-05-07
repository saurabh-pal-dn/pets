/**
 * PetDisplayClient — runs in a separate terminal window.
 * Connects to the pi-pets server via Unix socket and renders
 * Kitty protocol images directly to stdout.
 *
 * Usage: npx tsx bin/pi-pets-display.ts <socket-path>
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import type { PetDisplayMessage } from "./PetDisplayServer.js";

// ─── Kitty encoder (a=T, C=0 — no cursor advancement) ───────

function encodeKittyFrame(
  base64: string,
  cols: number,
  rows: number,
  imageId: number,
): string {
  const params = [`a=T`, `C=0`, `f=100`, `q=2`, `c=${cols}`, `r=${rows}`, `i=${imageId}`];
  const CHUNK_SIZE = 4096;

  if (base64.length <= CHUNK_SIZE) {
    return `\x1b_G${params.join(",")};${base64}\x1b\\`;
  }

  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const last = offset + CHUNK_SIZE >= base64.length;
    if (first) {
      parts.push(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`);
      first = false;
    } else if (last) {
      parts.push(`\x1b_Gm=0;${chunk}\x1b\\`);
    } else {
      parts.push(`\x1b_Gm=1;${chunk}\x1b\\`);
    }
    offset += CHUNK_SIZE;
  }
  return parts.join("");
}

// ─── Status bar ─────────────────────────────────────────────

function statusBar(happiness: number, fullness: number, energy: number): string {
  const h = `♥${hbar(happiness)}`;
  const f = `🍖${hbar(fullness)}`;
  const e = `⚡${hbar(energy)}`;
  return `${h}  ${f}  ${e}`;
}

function hbar(pct: number): string {
  const w = 5;
  const filled = Math.round((pct / 100) * w);
  return `${"█".repeat(filled)}${"░".repeat(w - filled)} ${Math.round(pct)}%`;
}

// ─── Main ───────────────────────────────────────────────────

export function runDisplayClient(socketPath: string): void {
  // Hide cursor, clear screen, enter alt screen
  process.stdout.write("\x1b[?25l");   // hide cursor
  process.stdout.write("\x1b[?1049h"); // enter alt screen
  process.stdout.write("\x1b[2J");     // clear

  // Ensure cursor is restored on exit
  const cleanup = () => {
    process.stdout.write("\x1b[?1049l"); // exit alt screen
    process.stdout.write("\x1b[?25h");   // show cursor
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  const socket = createConnection(socketPath);

  socket.on("error", (err) => {
    process.stderr.write(`pi-pets: cannot connect to ${socketPath}: ${err.message}\n`);
    cleanup();
  });

  const rl = createInterface({ input: socket, crlfDelay: Infinity });

  rl.on("line", (line: string) => {
    let msg: PetDisplayMessage;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === "close") {
      cleanup();
      return;
    }

    if (msg.type === "clear") {
      process.stdout.write("\x1b[2J");
      return;
    }

    if (msg.type === "frame") {
      // Move cursor to top-left
      process.stdout.write("\x1b[H");

      // Emit Kitty image
      const seq = encodeKittyFrame(msg.base64, msg.cols, msg.rows, msg.imageId);
      process.stdout.write(seq);

      // Move cursor below image
      const cursorRow = msg.rows + 1;
      process.stdout.write(`\x1b[${cursorRow};1H`);

      // Status bar
      process.stdout.write(statusBar(msg.happiness, msg.fullness, msg.energy));

      // Ensure output is flushed
    }
  });

  socket.on("close", cleanup);
  socket.on("end", cleanup);

  console.log(`pi-pets display — connected to ${socketPath}`);
}
