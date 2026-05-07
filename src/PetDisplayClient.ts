/**
 * PetDisplayClient — runs in a separate terminal window.
 * Connects to the pi-pets server via Unix socket and renders
 * frames directly to stdout. Supports both image (Kitty) and text modes.
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import type { PetDisplayMessage } from "./PetDisplayServer.js";

// ─── Kitty encoder ──────────────────────────────────────────

function encodeKittyFrame(
  base64: string,
  cols: number,
  rows: number,
  imageId: number,
): string {
  // a=T: transmit & display, C=0: don't move cursor, q=1: quiet (no response)
  const params = `a=T,C=0,f=100,q=1,c=${cols},r=${rows},i=${imageId}`;
  const CHUNK_SIZE = 4096;

  if (base64.length <= CHUNK_SIZE) {
    return `\x1b_G${params};${base64}\x1b\\`;
  }

  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const last = offset + CHUNK_SIZE >= base64.length;
    if (first) {
      parts.push(`\x1b_G${params},m=1;${chunk}\x1b\\`);
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

function deleteKittyImage(imageId: number): string {
  // a=d: delete placement, d=I: delete by image ID
  return `\x1b_Ga=d,d=I,i=${imageId}\x1b\\`;
}

// ─── Display client ─────────────────────────────────────────

export function runDisplayClient(socketPath: string): void {
  // Hide cursor, enter alt screen, clear
  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J");

  const cleanup = () => {
    process.stdout.write("\x1b[?1049l");
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const socket = createConnection(socketPath);

  socket.on("error", (err) => {
    process.stderr.write(`pi-pets: cannot connect to ${socketPath}: ${err.message}\n`);
    cleanup();
  });

  const rl = createInterface({ input: socket, crlfDelay: Infinity });

  // Track current image ID for explicit delete before frame
  let currentImageId: number | null = null;
  let isImageMode: boolean | null = null;

  rl.on("line", (line: string) => {
    let msg: PetDisplayMessage;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === "close") { cleanup(); return; }
    if (msg.type === "clear") { process.stdout.write("\x1b[2J"); return; }

    if (msg.type === "frame") {
      // Move to top-left
      process.stdout.write("\x1b[H");

      if (msg.mode === "image" && msg.base64 && msg.imageId !== undefined) {
        // Delete old image placement before rendering new frame (prevents stacking)
        if (currentImageId !== null && currentImageId === msg.imageId) {
          process.stdout.write(deleteKittyImage(msg.imageId));
        }

        const seq = encodeKittyFrame(msg.base64, msg.cols ?? 24, msg.rows ?? 12, msg.imageId);
        process.stdout.write(seq);
        currentImageId = msg.imageId;
        isImageMode = true;

        // Move cursor below image for status bar
        process.stdout.write(`\x1b[${(msg.rows ?? 12) + 1};1H`);

      } else if (msg.mode === "text" && msg.textLines) {
        // Text mode (ASCII pets)
        if (isImageMode && currentImageId !== null) {
          process.stdout.write(deleteKittyImage(currentImageId));
          currentImageId = null;
        }
        isImageMode = false;

        for (const textLine of msg.textLines) {
          process.stdout.write(textLine + "\r\n");
        }
      }

      // Status bar
      const bar = `${hbar("♥", msg.happiness)}  ${hbar("🍖", msg.fullness)}  ${hbar("⚡", msg.energy)}`;
      process.stdout.write(bar + "\r\n");
    }
  });

  socket.on("close", cleanup);
  socket.on("end", cleanup);

  console.log(`pi-pets display — connected to ${socketPath}`);
}

function hbar(icon: string, pct: number): string {
  const w = 5;
  const filled = Math.round((pct / 100) * w);
  return `${icon}${"█".repeat(filled)}${"░".repeat(w - filled)} ${Math.round(pct)}%`;
}
