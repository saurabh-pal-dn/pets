/**
 * SpriteSheetLoader — extracts individual frames from a sprite sheet image
 * and returns them as base64-encoded PNG strings for the Kitty protocol.
 *
 * Sprite sheet format:
 *   - 8 columns × 9 rows grid
 *   - Frame dimensions: totalWidth/8 × totalHeight/9
 *   - Variable frame counts per row (not all 8 columns are used)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Sprite Sheet Config ────────────────────────────────────

export interface SpriteSheetConfig {
  /** Number of columns in the grid */
  cols: number;
  /** Number of rows in the grid */
  rows: number;
  /** Number of valid frames per row (0-indexed). Frames beyond this are empty/transparent. */
  framesPerRow: number[];
}

/** The standard 8×9 sprite sheet config used by codex-pet-share pets */
export const STANDARD_SPRITESHEET: SpriteSheetConfig = {
  cols: 8,
  rows: 9,
  framesPerRow: [6, 8, 8, 4, 5, 8, 6, 6, 6],
};

/** Maps sprite sheet row indices (0-8) to pi-pets emotions */
export const STANDARD_ROW_EMOTIONS: string[] = [
  "idle",      // Row 0 — IDLE (6 frames)
  "working",   // Row 1 — RUN RIGHT (8 frames)
  "thinking",  // Row 2 — RUN LEFT (8 frames)
  "excited",   // Row 3 — WAVING (4 frames)
  "success",   // Row 4 — JUMPING (5 frames)
  "error",     // Row 5 — FAILED (8 frames)
  "sad",       // Row 6 — WAITING (6 frames)
  "happy",     // Row 7 — RUNNING (6 frames)
  "sleeping",  // Row 8 — REVIEW (6 frames)
];

// ─── Loader ─────────────────────────────────────────────────

/**
 * Extracts frames from a sprite sheet and returns them as base64-encoded image strings.
 *
 * Uses sharp for image processing (must be installed as a dependency).
 * Falls back to a pure-JS WebP/PNG header reader if sharp is unavailable
 * (but frame extraction won't work without sharp).
 */
export async function loadSpriteSheet(
  imagePath: string,
  config: SpriteSheetConfig = STANDARD_SPRITESHEET,
  mimeType: string = "image/png",
): Promise<Map<string, string[]>> {
  // Dynamic import — sharp is optional
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new Error(
      "Sprite sheet loading requires 'sharp'. Install it: npm install sharp"
    );
  }

  const buffer = readFileSync(imagePath);
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Cannot read dimensions from ${imagePath}`);
  }

  const frameW = Math.floor(metadata.width / config.cols);
  const frameH = Math.floor(metadata.height / config.rows);

  const frames = new Map<string, string[]>();

  for (let row = 0; row < config.rows; row++) {
    const emotion = STANDARD_ROW_EMOTIONS[row] ?? `row_${row}`;
    const frameCount = config.framesPerRow[row] ?? config.cols;
    const rowFrames: string[] = [];

    for (let col = 0; col < frameCount; col++) {
      const x = col * frameW;
      const y = row * frameH;

      const pngBuffer = await sharp(buffer)
        .extract({ left: x, top: y, width: frameW, height: frameH })
        .png()
        .toBuffer();

      rowFrames.push(pngBuffer.toString("base64"));
    }

    frames.set(emotion, rowFrames);
  }

  return frames;
}

/**
 * Synchronous version that reads from a pre-extracted directory of PNGs.
 * Directory structure: <baseDir>/<emotion>/0.png, 1.png, ...
 */
export function loadImageFrames(
  baseDir: string,
  emotion: string,
  count: number,
): string[] {
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const path = join(baseDir, emotion, `${i}.png`);
      const buf = readFileSync(path);
      frames.push(buf.toString("base64"));
    } catch {
      // Frame doesn't exist — stop
      break;
    }
  }
  return frames;
}
