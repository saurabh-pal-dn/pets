/**
 * pi-pets — Virtual pet companion extension for pi coding agent.
 *
 * Image-based pets render in a separate terminal window via Unix socket IPC.
 * ASCII pets use the standard widget system.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { detectCapabilities } from "@mariozechner/pi-tui";
import { PetStateMachine } from "../src/PetStateMachine.js";
import { EventMapper } from "../src/EventMapper.js";
import { PetAnimationEngine } from "../src/PetAnimationEngine.js";
import { PetRegistry } from "../src/PetRegistry.js";
import { createPetWidgetRenderer } from "../src/PetRenderer.js";
import { ImageCache } from "../src/PetImageRenderer.js";
import { PetDisplayServer } from "../src/PetDisplayServer.js";
import { loadSpriteSheet } from "../src/SpriteSheetLoader.js";
import { registerCommands } from "../src/commands.js";
import {
  getImageDimensions,
  calculateImageRows,
  getCellDimensions,
} from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import type { WidgetRef } from "../src/PetRenderer.js";
import type {
  PetDefinition,
  PetStimulus,
  ImageSpriteSet,
} from "../src/types.js";
import type { PetDisplayFrame } from "../src/PetDisplayServer.js";

const WIDGET_KEY = "pi-pets";
const PERSIST_KEY = "pi-pets-state";

export default async function (pi: ExtensionAPI) {
  const registry = new PetRegistry();
  let stateMachine: PetStateMachine | null = null;
  let animationEngine: PetAnimationEngine | null = null;
  let currentPet: PetDefinition | null = null;
  let imageCache: ImageCache | null = null;
  let displayServer: PetDisplayServer | null = null;

  const widgetRef: WidgetRef = { tui: null };
  let widgetFactory: ReturnType<typeof createPetWidgetRenderer> | null = null;
  let lastCtx: { ui: { setWidget: (k: string, f: unknown) => void } } | null =
    null;

  // Terminal capabilities (detected lazily)
  let terminalHasImages: boolean | null = null;

  // Memoized dimensions for frame sending
  let frameCols = 24;
  let frameRows = 12;
  let suppressFrames = false;

  // ── Display server management ─────────────────────────────

  async function startDisplayServer(): Promise<void> {
    if (displayServer) return;
    displayServer = new PetDisplayServer();
    displayServer.onConnect(() => {
      clearWidget();
    });
    displayServer.onDisconnect(() => {
      if (lastCtx) mountWidget(lastCtx);
    });
    await displayServer.start();
  }

  async function stopDisplayServer(): Promise<void> {
    if (!displayServer) return;
    await displayServer.stop();
    displayServer = null;
  }

  function sendDisplayFrame(): void {
    if (suppressFrames) return;
    if (!displayServer || !displayServer.hasClients) return;
    if (!animationEngine || !stateMachine || !currentPet) return;

    const frame = animationEngine.getFrameData();
    const state = stateMachine.getState();
    const isImage = currentPet.spriteType === "image" && imageCache;

    if (isImage && imageCache) {
      const frames = imageCache.getFrames(frame.emotion);
      const imageId = imageCache.getImageId(frame.emotion);
      if (!frames || imageId === undefined) return;

      const msg: PetDisplayFrame = {
        type: "frame",
        mode: "image",
        emotion: frame.emotion,
        base64: frames[frame.frameIndex % frames.length]!,
        cols: frameCols,
        rows: frameRows,
        imageId,
        happiness: Math.round(state.attributes.happiness),
        fullness: Math.round(100 - state.attributes.hunger),
        energy: Math.round(state.attributes.energy),
      };
      displayServer.sendFrame(msg);
    } else {
      // ASCII text mode
      const animFrame = animationEngine.getCurrentFrame();
      const msg: PetDisplayFrame = {
        type: "frame",
        mode: "text",
        emotion: frame.emotion,
        textLines: animFrame.lines,
        happiness: Math.round(state.attributes.happiness),
        fullness: Math.round(100 - state.attributes.hunger),
        energy: Math.round(state.attributes.energy),
      };
      displayServer.sendFrame(msg);
    }
  }

  function getDisplayCommand(): string {
    if (!displayServer) return "";
    const cwd = process.cwd();
    return `npx tsx ${cwd}/bin/pi-pets-display.ts ${displayServer.path}`;
  }

  function autoSpawnDisplay(): void {
    if (!displayServer) return;
    const cmd = getDisplayCommand();
    console.log("[pi-pets] Auto-spawning display terminal...");
    const proc = spawn(
      "ghostty",
      [
        "--window-width=25",
        "--window-height=13",
        "--title=pi-pets",
        "-e",
        "sh",
        "-c",
        cmd,
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    proc.on("error", () => {
      console.log("[pi-pets] Could not auto-spawn. Run manually:", cmd);
    });
    proc.unref();
  }

  // ── Widget/display mounting ───────────────────────────────

  function mountWidget(ctx: {
    ui: { setWidget: (k: string, f: unknown) => void };
  }) {
    if (!stateMachine || !animationEngine || !currentPet) return;

    // Never show widget in pi when display server has clients
    if (displayServer?.hasClients) {
      // Clear any existing widget
      try {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      } catch {
        /* ignore */
      }
      return;
    }

    // ASCII widget fallback (when no display client is connected)
    widgetFactory = createPetWidgetRenderer(
      () => animationEngine!.getCurrentFrame(),
      () => currentPet!,
      () => stateMachine!.getState(),
      widgetRef,
      { placement: "aboveEditor" },
    );
    ctx.ui.setWidget(WIDGET_KEY, widgetFactory);
  }

  function clearWidget(): void {
    if (!lastCtx) return;
    try {
      (lastCtx.ui.setWidget as (k: string, f: unknown) => void)(
        WIDGET_KEY,
        undefined,
      );
    } catch {
      /* ignore type issues */
    }
  }

  // ── Stimulus ──────────────────────────────────────────────

  function applyStimulus(stimulus: PetStimulus): void {
    if (!stateMachine || !animationEngine) return;
    const reaction = new EventMapper().mapStimulus(stimulus);
    if (
      reaction.priority >= animationEngine.getCurrentPriority() ||
      stimulus.type.startsWith("user_")
    ) {
      const emotion = stateMachine.applyStimulus(stimulus);
      stateMachine.setEmotion(emotion);
      animationEngine.applyReaction(reaction);
    } else {
      stateMachine.applyStimulus(stimulus);
    }
  }

  // ── Pet switching ─────────────────────────────────────────

  async function switchPet(petId: string): Promise<boolean> {
    const pet = registry.get(petId);
    if (!pet) return false;

    const isImage = pet.spriteType === "image";

    currentPet = pet;
    animationEngine?.switchPet(pet);
    stateMachine?.applyStimulus({ type: "user_switch" });

    // Flush old images before showing new pet
    suppressFrames = true;
    displayServer?.sendClear();
    await new Promise((r) => setTimeout(r, 300));
    suppressFrames = false;

    // Manage image cache
    if (isImage && terminalHasImages === true) {
      imageCache = await buildImageCache(pet);
    } else if (!isImage) {
      imageCache = null;
    }

    return true;
  }

  async function buildImageCache(pet: PetDefinition): Promise<ImageCache> {
    const cache = new ImageCache();

    const meta = registry.getMeta(pet.id);
    if (meta?.spriteSheetPath) {
      try {
        const frames = await loadSpriteSheet(
          meta.spriteSheetPath,
          meta.spriteSheetConfig,
          meta.spriteSheetMime ?? "image/webp",
        );
        for (const [emotion, base64Frames] of frames) {
          cache.set(emotion, base64Frames, "image/png");
        }
        // Memoize dimensions from first frame
        const firstFrame = cache.getFrames("idle");
        if (firstFrame && firstFrame[0]) {
          const dims = getImageDimensions(firstFrame[0], "image/png");
          if (dims) {
            frameRows = calculateImageRows(
              dims,
              frameCols,
              getCellDimensions(),
            );
          }
        }
        return cache;
      } catch (err) {
        console.error("[pi-pets] Failed to load sprite sheet:", err);
      }
    }

    // Individual PNG files
    for (const [emotion, spriteSet] of Object.entries(pet.sprites)) {
      if (!spriteSet || spriteSet.type !== "image") continue;
      const imgSet = spriteSet as ImageSpriteSet;
      const base64Frames: string[] = [];
      for (const filePath of imgSet.frames) {
        try {
          const { readFileSync } = await import("node:fs");
          base64Frames.push(readFileSync(filePath).toString("base64"));
        } catch {
          /* skip missing */
        }
      }
      if (base64Frames.length > 0)
        cache.set(emotion, base64Frames, "image/png");
    }
    return cache;
  }

  // ── session_start ─────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    lastCtx = ctx as typeof lastCtx;

    // Detect terminal capabilities (TUI is now initialized)
    if (terminalHasImages === null) {
      try {
        const caps = detectCapabilities();
        terminalHasImages = caps.images !== null;
        console.log(
          "[pi-pets] Terminal: images=" +
            caps.images +
            " trueColor=" +
            caps.trueColor,
        );
      } catch {
        terminalHasImages = false;
      }
    }

    const result = registry.discover(ctx.cwd);
    for (const e of result.errors) {
      ctx.ui.notify(`pi-pets: ${e.path}: ${e.error}`, "warning");
    }

    const defaultPet = registry.getDefault();
    if (!defaultPet) {
      ctx.ui.notify("pi-pets: No pets found!", "warning");
      return;
    }

    // Restore state
    let savedState: Record<string, unknown> | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      const custom = entry as {
        type: string;
        customType?: string;
        data?: { state?: unknown; petId?: string };
      };
      if (custom.type === "custom" && custom.customType === PERSIST_KEY) {
        savedState = custom.data as Record<string, unknown> | undefined;
        break;
      }
    }

    const savedPetId = savedState?.petId as string | undefined;
    currentPet = savedPetId
      ? (registry.get(savedPetId) ?? defaultPet)
      : defaultPet;

    // Init state machine
    stateMachine = savedState?.state
      ? PetStateMachine.fromJSON(
          savedState.state as Parameters<typeof PetStateMachine.fromJSON>[0],
        )
      : new PetStateMachine();

    // Init image cache & display server for image pets
    if (currentPet.spriteType === "image" && terminalHasImages === true) {
      imageCache = await buildImageCache(currentPet);
    }
    // Always start display server — all pets render there when client connected
    await startDisplayServer();

    // Init animation engine (frame callback → send display frame OR widget render)
    animationEngine = new PetAnimationEngine(currentPet, () => {
      if (displayServer?.hasClients) {
        sendDisplayFrame();
      } else {
        widgetRef.tui?.requestRender();
      }
    });
    animationEngine.start();

    stateMachine.startDecay((emotion) => {
      animationEngine?.setEmotion(emotion, 0);
    });

    // Don't mount widget yet — only if display client disconnects

    // Auto-spawn the display terminal
    autoSpawnDisplay();

    applyStimulus({ type: "session_start" });

    // const mode =
    //   currentPet.spriteType === "image" && terminalHasImages === true
    //     ? "🖼️"
    //     : "📝";
    // ctx.ui.notify(
    //   `${mode} pi-pets loaded! ${currentPet.name} is ready.`,
    //   "info",
    // );
  });

  // ── Agent Events ──────────────────────────────────────────

  pi.on("agent_start", () => {
    applyStimulus({ type: "agent_start" });
  });
  pi.on("agent_end", () => {
    applyStimulus({ type: "agent_end" });
  });
  pi.on("turn_start", () => {
    applyStimulus({ type: "turn_start" });
  });
  pi.on("turn_end", () => {
    applyStimulus({ type: "turn_end" });
  });

  pi.on("message_update", (event) => {
    if (
      event.assistantMessageEvent.type === "thinking_delta" ||
      event.assistantMessageEvent.type === "thinking_start"
    ) {
      applyStimulus({ type: "thinking" });
    }
  });

  pi.on("tool_call", (event) => {
    applyStimulus(EventMapper.fromToolCall(event.toolName, false));
  });

  pi.on("tool_result", (event) => {
    applyStimulus({
      type: event.isError ? "tool_error" : "tool_success",
      intensity: 1,
    });
  });

  pi.on("model_select", () => {
    applyStimulus({ type: "model_change" });
  });
  pi.on("thinking_level_select", (event) => {
    const intensity =
      event.level === "xhigh"
        ? 1.0
        : event.level === "high"
          ? 0.8
          : event.level === "medium"
            ? 0.6
            : event.level === "low"
              ? 0.4
              : event.level === "minimal"
                ? 0.2
                : 0;
    applyStimulus({ type: "thinking_level_change", intensity });
  });

  // ── Session Shutdown ─────────────────────────────────────

  pi.on("session_shutdown", async () => {
    await stopDisplayServer();
    if (stateMachine && currentPet) {
      pi.appendEntry(PERSIST_KEY, {
        state: stateMachine.toJSON(),
        petId: currentPet.id,
      });
    }
    animationEngine?.dispose();
    stateMachine?.stopDecay();
    animationEngine = null;
    stateMachine = null;
    imageCache = null;
    widgetRef.tui = null;
  });

  // ── Register Commands ─────────────────────────────────────

  registerCommands(pi, {
    get stateMachine() {
      if (!stateMachine) throw new Error("pi-pets not initialized yet");
      return stateMachine;
    },
    registry,
    get animationEngine() {
      if (!animationEngine) throw new Error("pi-pets not initialized yet");
      return animationEngine;
    },
    switchPet: async (id: string) => await switchPet(id),
    getState: () =>
      stateMachine?.getState() ?? {
        emotion: "idle" as const,
        attributes: { happiness: 0, hunger: 0, energy: 0, affection: 0 },
        customName: null,
        lastUpdate: 0,
        lastInteraction: 0,
        visible: true,
        totalActiveTime: 0,
      },
    widgetKey: WIDGET_KEY,
    mountWidget: (ctx: {
      ui: { setWidget: (k: string, f: unknown) => void };
    }) => {
      mountWidget(ctx);
    },
    // Image display helpers
    getDisplayCommand: () => getDisplayCommand(),
    startDisplay: async () => {
      if (currentPet?.spriteType === "image" && terminalHasImages === true) {
        if (!imageCache) imageCache = await buildImageCache(currentPet);
        await startDisplayServer();
      }
    },
    stopDisplay: async () => {
      await stopDisplayServer();
    },
    autoSpawnDisplay: () => {
      autoSpawnDisplay();
    },
  });

  console.log(
    "[pi-pets] Extension loaded. Images: " +
      (terminalHasImages === null
        ? "detecting..."
        : terminalHasImages
          ? "enabled"
          : "unavailable"),
  );
}
