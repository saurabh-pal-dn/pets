/**
 * PetRenderer — renders the pet as a pi TUI widget.
 * Displays the current sprite frame, pet name, and status bars.
 *
 * The widget re-renders when the animation engine fires frame changes
 * via `onFrameChange` → `tui.requestRender()`.
 */

import type { AnimationFrame, PetDefinition, PetState } from "./types.js";

export type RendererPlacement = "aboveEditor" | "belowEditor";

export interface RendererOptions {
  placement: RendererPlacement;
  showStatusBars: boolean;
  showName: boolean;
  maxWidth: number;
}

const DEFAULT_OPTIONS: RendererOptions = {
  placement: "aboveEditor",
  showStatusBars: true,
  showName: false,
  maxWidth: 40,
};

/** Lightweight TUI handle — just the requestRender method we need */
export interface TuiHandle {
  requestRender(): void;
}

/**
 * Mutable ref that the widget factory populates when pi calls it with the TUI instance.
 * The animation engine uses this to trigger re-renders.
 */
export interface WidgetRef {
  tui: TuiHandle | null;
}

/**
 * Creates a render factory for ctx.ui.setWidget().
 *
 * @param getFrame - returns the current animation frame from the engine
 * @param getPet - returns the current pet definition
 * @param getState - returns the current pet state from the state machine
 * @param widgetRef - mutable ref populated with the TUI handle when the widget is mounted
 * @param options - rendering options
 */
export function createPetWidgetRenderer(
  getFrame: () => AnimationFrame,
  getPet: () => PetDefinition,
  getState: () => PetState,
  widgetRef: WidgetRef,
  options: Partial<RendererOptions> = {},
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Return a factory function that pi calls with (tui, theme)
  return (tui: TuiHandle, _theme: unknown) => {
    // Store tui ref so the animation engine can trigger re-renders
    widgetRef.tui = tui;

    return {
      render: (width: number): string[] => {
        const frame = getFrame();
        const pet = getPet();
        const state = getState();

        const lines: string[] = [];
        const availableWidth = Math.min(width, opts.maxWidth);

        // ── Pet sprite ─────────────────────────────────
        const spriteLines = frame.lines;
        const spriteWidth = Math.max(
          ...spriteLines.map((l) => visibleLength(l)),
          1,
        );
        const leftPad = Math.max(
          0,
          Math.floor((availableWidth - spriteWidth) / 2),
        );

        for (const line of spriteLines) {
          const padded = " ".repeat(leftPad) + line;
          lines.push(truncate(padded, availableWidth));
        }

        // ── Status bars ────────────────────────────────
        if (opts.showStatusBars) {
          lines.push("");
          lines.push(
            renderStatusBar("♥ ", state.attributes.happiness, availableWidth),
          );
          lines.push(
            renderStatusBar(
              "🍖",
              100 - state.attributes.hunger,
              availableWidth,
            ),
          );
          lines.push(
            renderStatusBar("⚡", state.attributes.energy, availableWidth),
          );
        }

        return lines;
      },

      invalidate: () => {
        // No internal cache — render() always computes fresh.
        // The TUI framework handles its own caching.
      },
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function renderStatusBar(icon: string, value: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  const barWidth = Math.max(2, width - 6);
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return ` ${icon} ${bar} ${Math.round(clamped)}%`;
}

// ─── Character width utilities ───────────────────────────────

function visibleLength(str: string): number {
  const stripped = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  return [...stripped].length;
}

function truncate(str: string, maxLen: number): string {
  const chars = [...str];
  if (chars.length <= maxLen) return str;
  return chars.slice(0, maxLen).join("");
}
