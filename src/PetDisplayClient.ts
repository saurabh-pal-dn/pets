/**
 * PetDisplayClient — runs in a separate terminal window.
 * Uses double-buffered Kitty image IDs so each frame cleanly replaces
 * the previous one with no stacking and no explicit deletes.
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { encodeKitty } from "@mariozechner/pi-tui";
import type { PetDisplayMessage } from "./PetDisplayServer.js";

// ─── Double-buffered image IDs ──────────────────────────────

/** Manages alternating image IDs per emotion for flicker-free replacement */
class ImageIdBuffer {
  private ids = new Map<string, [number, number]>();
  private toggle = new Map<string, boolean>();
  private nextId = 100;

  /** Get the image ID to use for this frame (alternates between two IDs per emotion) */
  get(emotion: string): number {
    if (!this.ids.has(emotion)) {
      this.ids.set(emotion, [this.nextId++, this.nextId++]);
      this.toggle.set(emotion, false);
    }
    const [a, b] = this.ids.get(emotion)!;
    const useA = this.toggle.get(emotion)!;
    this.toggle.set(emotion, !useA);
    return useA ? a : b;
  }
}

// ─── Display client ─────────────────────────────────────────

export function runDisplayClient(socketPath: string): void {
  // Hide cursor, enter alt screen, clear
  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J");

  const cleanup = () => {
    // Delete all kitty images and exit alt screen
    process.stdout.write("\x1b_Ga=d,d=a\x1b\\");
    process.stdout.write("\x1b[?1049l");
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const socket = createConnection(socketPath);

  socket.on("error", (err) => {
    process.stderr.write(
      `pi-pets: cannot connect to ${socketPath}: ${err.message}\n`,
    );
    cleanup();
  });

  const rl = createInterface({ input: socket, crlfDelay: Infinity });
  const idBuf = new ImageIdBuffer();

  rl.on("line", (line: string) => {
    let msg: PetDisplayMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

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

      if (msg.mode === "image" && msg.base64) {
        // Alternating image IDs — each frame uses a different ID
        // so the previous frame is automatically replaced
        const imageId = idBuf.get(msg.emotion);
        const cols = msg.cols ?? 25;
        const rows = msg.rows ?? 13;
        const seq = encodeKitty(msg.base64, { columns: cols, rows, imageId });
        process.stdout.write(seq);
      } else if (msg.mode === "text" && msg.textLines) {
        for (const textLine of msg.textLines) {
          process.stdout.write(`\x1b[2K${textLine}\r\n`);
        }
      }
    }
  });

  socket.on("close", cleanup);
  socket.on("end", cleanup);

  console.log(`pi-pets display — connected to ${socketPath}`);
}
