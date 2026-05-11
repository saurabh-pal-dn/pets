/**
 * PetImageRenderer — renders image-based pets in a pi widget
 * using raw Kitty protocol escape sequences.
 *
 * Uses a=T with C=1 and p=1 to place images at the cursor.
 * Each frame gets a unique imageId per the Kitty spec — no caching glitches.
 */

import {
  getImageDimensions,
  allocateImageId,
  calculateImageRows,
  getCellDimensions,
} from "@mariozechner/pi-tui";
import type { AnimationFrame, PetState } from "./types.js";
import type { WidgetRef } from "./PetRenderer.js";

// ─── Image cache ────────────────────────────────────────────

export class ImageCache {
  private cache = new Map<string, string[]>();
  /** emotion → array of unique imageIds (one per frame) */
  private imageIds = new Map<string, number[]>();

  set(emotion: string, frames: string[], _mimeType: string): void {
    this.cache.set(emotion, frames);
    // Allocate a unique imageId for EACH frame (not shared across the emotion)
    const ids: number[] = [];
    for (let i = 0; i < frames.length; i++) {
      ids.push(allocateImageId());
    }
    this.imageIds.set(emotion, ids);
  }

  getFrames(emotion: string): string[] | undefined {
    return this.cache.get(emotion) ?? this.cache.get("idle");
  }

  getImageId(emotion: string, frameIndex: number): number | undefined {
    const ids = this.imageIds.get(emotion) ?? this.imageIds.get("idle");
    if (!ids || ids.length === 0) return undefined;
    return ids[frameIndex % ids.length];
  }

  has(emotion: string): boolean {
    return (this.cache.get(emotion)?.length ?? 0) > 0;
  }

  invalidateAll(): void {}
}

// ─── Custom Kitty encoder (a=p, C=0 — no cursor movement) ───

function encodeKittyFrame(
  base64Data: string,
  cols: number,
  rows: number,
  imageId: number,
): string {
  // a=T: transmit & display, C=1: move cursor after, p=1: placement ID
  // q=1: quiet mode (no terminal response)
  const params = [
    `a=T`,
    `C=1`,
    `p=1`,
    `f=100`,
    `q=1`,
    `c=${cols}`,
    `r=${rows}`,
    `i=${imageId}`,
  ];

  const CHUNK_SIZE = 4096;
  if (base64Data.length <= CHUNK_SIZE) {
    return `\x1b_G${params.join(",")};${base64Data}\x1b\\`;
  }

  // Multi-chunk transmission
  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < base64Data.length) {
    const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
    const last = offset + CHUNK_SIZE >= base64Data.length;
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

// ─── Widget factory ─────────────────────────────────────────

export function createPetImageWidget(
  getFrame: () => AnimationFrame,
  getState: () => PetState,
  imageCache: ImageCache,
  widgetRef: WidgetRef,
) {
  // Memoize dimensions to avoid re-calculating every frame
  let memoRows = 0;
  let memoCols = 0;
  let memoWidth = -1;

  return (tui: { requestRender: () => void }) => {
    widgetRef.tui = tui;

    // Track previous image ID per emotion for explicit delete-before-draw
    const prevIds = new Map<string, number>();
    let mounted = false;

    return {
      render: (width: number): string[] => {
        const frame = getFrame();
        const state = getState();
        const frameIdx = frame.frameIndex;
        const frames = imageCache.getFrames(frame.emotion);
        const imageId = imageCache.getImageId(frame.emotion, frameIdx);

        if (!frames || frames.length === 0 || imageId === undefined) {
          return [""];
        }

        const lines: string[] = [];

        // On mount: delete all lingering images from previous sessions
        if (!mounted) {
          mounted = true;
          lines.push(`\x1b_Ga=d,d=a\x1b\\`);
        }

        // Delete the PREVIOUS frame's placement for this emotion
        const prevId = prevIds.get(frame.emotion);
        if (prevId !== undefined && prevId !== imageId) {
          lines.push(`\x1b_Ga=d,d=I,i=${prevId}\x1b\\`);
        }
        prevIds.set(frame.emotion, imageId);

        const base64 = frames[frame.frameIndex % frames.length]!;
        const dims = getImageDimensions(base64, "image/png") ?? {
          widthPx: 192,
          heightPx: 208,
        };

        // Calculate columns/rows — memoize for stable widget height
        const maxCols = Math.min(24, Math.floor(width * 0.6));
        if (width !== memoWidth) {
          memoCols = maxCols;
          memoRows = calculateImageRows(dims, memoCols, getCellDimensions());
          memoWidth = width;
        }
        const cols = memoCols;
        const rows = memoRows;

        // Generate Kitty escape sequence for the new frame
        const sequence = encodeKittyFrame(base64, cols, rows, imageId);
        lines.push(sequence);

        // Pad to fill image height (stable widget size, no re-layout)
        for (let i = 1; i < rows; i++) {
          lines.push("");
        }

        // Status bar
        const h = Math.round(state.attributes.happiness);
        const f = Math.round(100 - state.attributes.hunger);
        const e = Math.round(state.attributes.energy);
        lines.push(`♥${hbar(h)} 🍖${hbar(f)} ⚡${hbar(e)}`);
        return lines;
      },

      invalidate: () => {
        memoWidth = -1; // force recalc on next render
        // On unmount-ish: delete all images
        // (Widget invalidate is called on theme changes; no true unmount hook exists)
      },
    };
  };
}

function hbar(pct: number): string {
  const w = 5;
  const filled = Math.round((pct / 100) * w);
  return `${"█".repeat(filled)}${"░".repeat(w - filled)} ${pct}%`;
}
