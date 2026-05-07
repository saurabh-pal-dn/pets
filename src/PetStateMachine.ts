/**
 * PetStateMachine — manages pet attributes (happiness, hunger, energy, affection)
 * and determines the current emotional state.
 */

import type {
  Emotion,
  PetAttributes,
  PetState,
  PetStimulus,
} from "./types.js";
import {
  ATTRIBUTE_DECAY_INTERVAL,
  DEFAULT_ATTRIBUTES,
  ENERGY_DECREASE_RATE,
  ENERGY_REGEN_RATE,
  HAPPINESS_DECAY_RATE,
  HUNGER_INCREASE_RATE,
} from "./types.js";

export class PetStateMachine {
  private state: PetState;
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private activeSince: number | null = null;

  constructor(savedState?: Partial<PetState>) {
    this.state = {
      emotion: "idle",
      attributes: { ...DEFAULT_ATTRIBUTES, ...savedState?.attributes },
      customName: savedState?.customName ?? null,
      lastUpdate: savedState?.lastUpdate ?? Date.now(),
      lastInteraction: savedState?.lastInteraction ?? Date.now(),
      visible: savedState?.visible ?? true,
      totalActiveTime: savedState?.totalActiveTime ?? 0,
    };
  }

  // ─── Public API ───────────────────────────────────────────

  getState(): Readonly<PetState> {
    return this.state;
  }

  setCustomName(name: string | null): void {
    this.state.customName = name;
    this.state.lastInteraction = Date.now();
  }

  setVisible(visible: boolean): void {
    this.state.visible = visible;
  }

  /** Apply a stimulus and return the resulting emotion */
  applyStimulus(stimulus: PetStimulus): Emotion {
    const now = Date.now();

    switch (stimulus.type) {
      // ── User interactions ─────────────────────────
      case "user_feed":
        this.state.attributes.hunger = Math.max(0, this.state.attributes.hunger - 25);
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + 10);
        this.state.attributes.energy = Math.min(100, this.state.attributes.energy + 5);
        this.state.attributes.affection = Math.min(100, this.state.attributes.affection + 5);
        this.state.lastInteraction = now;
        return "eating";

      case "user_play":
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + 20);
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 15);
        this.state.attributes.hunger = Math.min(100, this.state.attributes.hunger + 5);
        this.state.attributes.affection = Math.min(100, this.state.attributes.affection + 10);
        this.state.lastInteraction = now;
        return "playing";

      case "user_pet":
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + 15);
        this.state.attributes.affection = Math.min(100, this.state.attributes.affection + 10);
        this.state.attributes.energy = Math.min(100, this.state.attributes.energy + 3);
        this.state.lastInteraction = now;
        return "happy";

      case "user_scold":
        this.state.attributes.happiness = Math.max(0, this.state.attributes.happiness - 20);
        this.state.attributes.affection = Math.max(0, this.state.attributes.affection - 15);
        this.state.lastInteraction = now;
        return "sad";

      case "user_switch":
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + 5);
        this.state.lastInteraction = now;
        return "curious";

      // ── Agent events ───────────────────────────────
      case "session_start":
        return this.state.attributes.affection > 70 ? "greeting" : "curious";

      case "agent_start":
        this.markActive(now);
        return "curious";

      case "agent_end":
        this.markIdle(now);
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + 2);
        return this.resolveBaseEmotion();

      case "turn_start":
        return "curious";

      case "turn_end":
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 2);
        this.state.attributes.hunger = Math.min(100, this.state.attributes.hunger + 1);
        return this.resolveBaseEmotion();

      // ── Thinking ───────────────────────────────────
      case "thinking":
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 0.5);
        return "thinking";

      // ── Tool events ────────────────────────────────
      case "tool_start":
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 1);
        return "working";

      case "tool_success":
        this.state.attributes.happiness = Math.min(100, this.state.attributes.happiness + (stimulus.intensity ?? 3) * 5);
        return this.state.attributes.happiness > 85 ? "excited" : "success";

      case "tool_error":
        this.state.attributes.happiness = Math.max(0, this.state.attributes.happiness - (stimulus.intensity ?? 3) * 3);
        return "error";

      case "bash_command":
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 2);
        return "working";

      case "edit_file":
      case "write_file":
        this.state.attributes.energy = Math.max(0, this.state.attributes.energy - 1);
        return "coding";

      case "read_file":
        return "curious";

      // ── Model / thinking changes ───────────────────
      case "model_change":
        return "curious";

      case "thinking_level_change":
        return stimulus.intensity && stimulus.intensity > 0.7 ? "shocked" : "curious";

      // ── Decay ticks ────────────────────────────────
      case "hunger_tick":
        this.state.attributes.hunger = Math.min(100, this.state.attributes.hunger + HUNGER_INCREASE_RATE);
        if (this.state.attributes.hunger > 80) return "hungry";
        return this.resolveBaseEmotion();

      case "energy_tick":
        if (this.activeSince !== null) {
          this.state.attributes.energy = Math.max(0, this.state.attributes.energy - ENERGY_DECREASE_RATE);
        } else {
          this.state.attributes.energy = Math.min(100, this.state.attributes.energy + ENERGY_REGEN_RATE);
        }
        if (this.state.attributes.energy < 15) return "sleepy";
        return this.resolveBaseEmotion();

      case "idle_tick":
        this.state.attributes.happiness = Math.max(0, this.state.attributes.happiness - HAPPINESS_DECAY_RATE);
        if (this.lastInteractionWasLongAgo(now)) {
          this.state.attributes.affection = Math.max(0, this.state.attributes.affection - 0.5);
        }
        return this.resolveBaseEmotion();

      default:
        return this.state.emotion;
    }
  }

  /** Start the attribute decay loop */
  startDecay(onTick: (emotion: Emotion) => void): void {
    if (this.decayTimer) return;

    this.decayTimer = setInterval(() => {
      const now = Date.now();

      // Idle tick always runs
      const idleEmotion = this.applyStimulus({ type: "idle_tick" });
      if (idleEmotion !== this.state.emotion) {
        this.state.emotion = idleEmotion;
        onTick(idleEmotion);
      }

      // Hunger tick always runs
      const hungerEmotion = this.applyStimulus({ type: "hunger_tick" });
      if (hungerEmotion !== this.state.emotion) {
        this.state.emotion = hungerEmotion;
        onTick(hungerEmotion);
      }

      // Energy tick always runs
      const energyEmotion = this.applyStimulus({ type: "energy_tick" });
      if (energyEmotion !== this.state.emotion) {
        this.state.emotion = energyEmotion;
        onTick(energyEmotion);
      }

      this.state.lastUpdate = now;
    }, ATTRIBUTE_DECAY_INTERVAL);
  }

  /** Stop the decay loop */
  stopDecay(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  /** Set emotion directly (for animation-driven overrides) */
  setEmotion(emotion: Emotion): void {
    this.state.emotion = emotion;
  }

  /** Get a serializable snapshot for persistence */
  toJSON(): PetState {
    return { ...this.state };
  }

  /** Restore from a saved snapshot */
  static fromJSON(json: PetState): PetStateMachine {
    return new PetStateMachine(json);
  }

  // ─── Private ──────────────────────────────────────────────

  private resolveBaseEmotion(): Emotion {
    const a = this.state.attributes;
    if (a.hunger > 80) return "hungry";
    if (a.energy < 15) return "sleepy";
    if (a.happiness < 20) return "sad";
    if (a.happiness > 85) return "happy";
    return "idle";
  }

  private markActive(now: number): void {
    this.activeSince = now;
  }

  private markIdle(now: number): void {
    if (this.activeSince !== null) {
      this.state.totalActiveTime += now - this.activeSince;
      this.activeSince = null;
    }
  }

  private lastInteractionWasLongAgo(now: number): boolean {
    return now - this.state.lastInteraction > 5 * 60 * 1000; // 5 minutes
  }
}
