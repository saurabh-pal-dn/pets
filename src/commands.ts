/**
 * Commands — registers /pet commands with the pi extension API.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PetStateMachine } from "./PetStateMachine.js";
import type { PetRegistry } from "./PetRegistry.js";
import type { PetAnimationEngine } from "./PetAnimationEngine.js";
import type { PetState } from "./types.js";

export interface CommandDeps {
  stateMachine: PetStateMachine;
  registry: PetRegistry;
  animationEngine: PetAnimationEngine;
  switchPet: (id: string) => Promise<boolean>;
  getState: () => PetState;
  widgetKey: string;
  mountWidget: (ctx: {
    ui: { setWidget: (key: string, factory: unknown) => void };
  }) => void;
  getDisplayCommand: () => string;
  startDisplay: () => Promise<void>;
  stopDisplay: () => Promise<void>;
  autoSpawnDisplay: () => void;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  // Lazy accessors — pet may not be initialized yet (e.g., print mode)
  const getSafeDeps = () => {
    try {
      return {
        stateMachine: deps.stateMachine,
        animationEngine: deps.animationEngine,
        ok: true as const,
      };
    } catch {
      return { ok: false as const };
    }
  };

  const registry = deps.registry;
  const switchPet = deps.switchPet;
  const getState = deps.getState;
  const widgetKey = deps.widgetKey;
  const mountWidget = deps.mountWidget;
  const getDisplayCommand = deps.getDisplayCommand;
  const startDisplay = deps.startDisplay;
  const stopDisplay = deps.stopDisplay;
  const autoSpawnDisplay = deps.autoSpawnDisplay;
  // stateMachine and animationEngine accessed via getSafeDeps()

  // ── /pet ──────────────────────────────────────────────────
  pi.registerCommand("pet", {
    description: "Show pet status and available actions",
    handler: async (_args, ctx) => {
      if (!getSafeDeps().ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const state = getState();
      const petName = state.customName ?? "Pet";
      const a = state.attributes;
      const cmd = getDisplayCommand();

      ctx.ui.notify(
        [
          `${petName} is feeling ${state.emotion}`,
          `♥ Happiness: ${a.happiness}%  🍖 Fullness: ${100 - a.hunger}%  ⚡ Energy: ${a.energy}%  💕 Affection: ${a.affection}%`,
          ``,
          `Available: /pet status | feed | play | pet | switch <name> | list | hide | show | rename <name>`,
          cmd ? `\n📺 Display: ${cmd}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        "info",
      );
    },
  });

  // ── /pet status ───────────────────────────────────────────
  pi.registerCommand("pet:status", {
    description: "Show detailed pet status",
    handler: async (_args, ctx) => {
      if (!getSafeDeps().ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const state = getState();
      const safe = getSafeDeps();
      const petName =
        state.customName ??
        (safe.ok ? safe.stateMachine.getState().customName : null) ??
        "Pet";
      const cmd = getDisplayCommand();

      ctx.ui.notify(
        [
          `═══ ${petName} Status ═══`,
          `Mood: ${state.emotion}`,
          `♥ Happiness:  ${bar(state.attributes.happiness)} ${state.attributes.happiness}%`,
          `🍖 Fullness:   ${bar(100 - state.attributes.hunger)} ${100 - state.attributes.hunger}%`,
          `⚡ Energy:     ${bar(state.attributes.energy)} ${state.attributes.energy}%`,
          `💕 Affection:  ${bar(state.attributes.affection)} ${state.attributes.affection}%`,
          `Active time: ${formatDuration(state.totalActiveTime)}`,
          cmd ? `\n📺 Display command:\n  ${cmd}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        "info",
      );
    },
  });

  // ── /pet feed ─────────────────────────────────────────────
  pi.registerCommand("pet:feed", {
    description: "Feed your pet",
    handler: async (_args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const emotion = safe.stateMachine.applyStimulus({ type: "user_feed" });
      safe.stateMachine.setEmotion(emotion);
      safe.animationEngine.applyReaction({
        emotion,
        duration: 3000,
        priority: 6,
      });
      ctx.ui.notify("🍖 Om nom nom! Your pet is eating happily.", "success");
    },
  });

  // ── /pet play ─────────────────────────────────────────────
  pi.registerCommand("pet:play", {
    description: "Play with your pet",
    handler: async (_args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const emotion = safe.stateMachine.applyStimulus({ type: "user_play" });
      safe.stateMachine.setEmotion(emotion);
      safe.animationEngine.applyReaction({
        emotion,
        duration: 4000,
        priority: 6,
      });
      ctx.ui.notify("🎾 Your pet is playing happily!", "success");
    },
  });

  // ── /pet pet ──────────────────────────────────────────────
  pi.registerCommand("pet:pet", {
    description: "Pet your pet (increases affection)",
    handler: async (_args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const emotion = safe.stateMachine.applyStimulus({ type: "user_pet" });
      safe.stateMachine.setEmotion(emotion);
      safe.animationEngine.applyReaction({
        emotion,
        duration: 2000,
        priority: 6,
      });
      ctx.ui.notify("♥ Your pet appreciates the affection!", "success");
    },
  });

  // ── /pet switch ───────────────────────────────────────────
  pi.registerCommand("pet:switch", {
    description: "Switch to a different pet",
    handler: async (args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const petId = args?.trim();
      if (!petId) {
        const pets = registry.list();
        if (pets.length === 0) {
          ctx.ui.notify("No pets available.", "error");
          return;
        }
        ctx.ui.notify(
          `Available pets: ${pets.join(", ")}\nUse /pet switch <name>`,
          "info",
        );
        return;
      }

      const switched = await switchPet(petId);
      if (switched) {
        const pet = registry.get(petId)!;
        safe.stateMachine.applyStimulus({ type: "user_switch" });
        mountWidget(ctx);

        const cmd = getDisplayCommand();
        if (cmd) {
          ctx.ui.notify(`✨ Switched to ${pet.name}!`, "success");
          ctx.ui.notify(`📺 Display: ${cmd}`, "success");
        } else {
          ctx.ui.notify(`✨ Switched to ${pet.name}!`, "success");
        }
      } else {
        const available = registry.list().join(", ");
        ctx.ui.notify(
          `Pet "${petId}" not found. Available: ${available}`,
          "error",
        );
      }
    },
  });

  // ── /pet list ─────────────────────────────────────────────
  pi.registerCommand("pet:list", {
    description: "List all available pets",
    handler: async (_args, ctx) => {
      const pets = registry.getAll();
      // pet:list only uses registry — doesn't need initialized pet
      if (pets.length === 0) {
        ctx.ui.notify("No pets found. Add pets to ~/.pi/agent/pets/", "info");
        return;
      }

      const currentPet =
        deps.stateMachine.getState().customName ?? registry.getDefault()?.name;
      const lines = pets.map(
        (p) =>
          `${p.id === registry.getDefault()?.id && currentPet === p.name ? "★" : " "} ${p.id.padEnd(12)} ${p.name.padEnd(16)} ${p.description}`,
      );
      ctx.ui.notify(`Available pets:\n${lines.join("\n")}`, "info");
    },
  });

  // ── /pet hide ─────────────────────────────────────────────
  pi.registerCommand("pet:hide", {
    description: "Hide the pet (close display or widget)",
    handler: async (_args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify("pi-pets not initialized yet.", "warning");
        return;
      }
      safe.stateMachine.setVisible(false);

      // Close display server if running
      await stopDisplay();
      // Remove widget
      ctx.ui.setWidget(
        widgetKey,
        undefined as unknown as Parameters<typeof ctx.ui.setWidget>[1],
      );
      ctx.ui.notify("Pet hidden. Use /pet show to bring it back.", "info");
    },
  });

  // ── /pet show ─────────────────────────────────────────────
  pi.registerCommand("pet:show", {
    description: "Show the pet display / widget",
    handler: async (_args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify("pi-pets not initialized yet.", "warning");
        return;
      }
      safe.stateMachine.setVisible(true);

      const cmd = getDisplayCommand();
      if (cmd) {
        // Image pet — auto-spawn display
        await startDisplay();
        autoSpawnDisplay();
        ctx.ui.notify(`📺 Spawning pet display...`, "info");
      } else {
        // ASCII pet — remount widget
        mountWidget(ctx);
        ctx.ui.notify("🐱 Pet is back!", "success");
      }
    },
  });

  // ── /pet rename ───────────────────────────────────────────
  pi.registerCommand("pet:rename", {
    description: "Give your pet a custom name",
    handler: async (args, ctx) => {
      const safe = getSafeDeps();
      if (!safe.ok) {
        ctx.ui.notify(
          "pi-pets not initialized yet. Start a session first.",
          "warning",
        );
        return;
      }
      const newName = args?.trim();
      if (!newName) {
        ctx.ui.notify("Usage: /pet rename <name>", "error");
        return;
      }
      safe.stateMachine.setCustomName(newName);
      ctx.ui.notify(`Your pet is now named "${newName}"!`, "success");
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function bar(value: number): string {
  const filled = Math.round(value / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
