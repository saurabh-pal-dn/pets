/**
 * PetDisplayClient — runs in a separate terminal window.
 * Each frame gets a unique Kitty image ID. The previous frame's ID
 * is explicitly deleted before the new one is placed.
 * Only one image on screen per emotion, guaranteed.
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

  // Track previous image ID per emotion so we can delete it
  const prevIds = new Map<string, number>();
  let idCounter = 1;

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
      // Delete all images and reset tracking
      process.stdout.write("\x1b_Ga=d,d=a\x1b\\");
      process.stdout.write("\x1b[2J");
      prevIds.clear();
      return;
    }

    if (msg.type === "frame") {
      process.stdout.write("\x1b[H"); // cursor to (0,0)

      if (msg.mode === "image" && msg.base64) {
        // Delete the PREVIOUS image for this emotion
        const prevId = prevIds.get(msg.emotion);
        if (prevId !== undefined) {
          process.stdout.write(`\x1b_Ga=d,d=I,i=${prevId}\x1b\\`);
        }

        // Assign a fresh unique ID and transmit
        const newId = idCounter++;
        prevIds.set(msg.emotion, newId);

        const seq = encodeKitty(msg.base64, {
          columns: msg.cols ?? 25,
          rows: msg.rows ?? 12,
          imageId: newId,
        });
        process.stdout.write(seq);
      } else if (msg.mode === "text" && msg.textLines) {
        // Delete any lingering images
        if (prevIds.size > 0) {
          process.stdout.write("\x1b_Ga=d,d=a\x1b\\");
          prevIds.clear();
        }
        for (const textLine of msg.textLines) {
          process.stdout.write(`\x1b[2K${textLine}\r\n`);
        }
      }
    }
  });

  socket.on("close", cleanup);
  socket.on("end", cleanup);

  // console.log(`pi-pets display — connected to ${socketPath}`);
}
