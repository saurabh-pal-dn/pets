/**
 * PetDisplayClient — runs in a separate terminal window.
 * All frames for an emotion share one Kitty image ID.
 * Kitty auto-replaces old placement when same ID is re-transmitted.
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { encodeKitty } from "@mariozechner/pi-tui";
import type { PetDisplayMessage } from "./PetDisplayServer.js";

// ─── Display client ─────────────────────────────────────────

export function runDisplayClient(socketPath: string): void {
  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J");

  const cleanup = () => {
    process.stdout.write("\x1b_Ga=d,d=a\x1b\\"); // delete all images
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
      process.stdout.write("\x1b_Ga=d,d=a\x1b\\");
      process.stdout.write("\x1b[2J");
      return;
    }

    if (msg.type === "frame") {
      process.stdout.write("\x1b[H"); // cursor to top-left

      if (msg.mode === "image" && msg.base64 && msg.imageId !== undefined) {
        const seq = encodeKitty(msg.base64, {
          columns: msg.cols ?? 25,
          rows: msg.rows ?? 13,
          imageId: msg.imageId,
        });
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
