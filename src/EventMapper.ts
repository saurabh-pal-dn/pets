/**
 * EventMapper — maps pi extension API events to internal PetStimulus types
 * and produces PetReaction outputs for the animation engine.
 */

import type {
  Emotion,
  PetReaction,
  PetStimulus,
  StimulusType,
} from "./types.js";

// ─── Default Reaction Map ───────────────────────────────────

const DEFAULT_REACTIONS: Record<StimulusType, PetReaction> = {
  session_start:          { emotion: "curious",    duration: 2500, priority: 3 },
  agent_start:            { emotion: "curious",    duration: 1500, priority: 3 },
  agent_end:              { emotion: "idle",       duration: 0,    priority: 1 },
  turn_start:             { emotion: "curious",    duration: 800,  priority: 2 },
  turn_end:               { emotion: "idle",       duration: 0,    priority: 1 },
  thinking:               { emotion: "thinking",   duration: 0,    priority: 4 },
  tool_start:             { emotion: "working",    duration: 0,    priority: 4 },
  tool_success:           { emotion: "success",    duration: 2000, priority: 5 },
  tool_error:             { emotion: "error",      duration: 2500, priority: 5 },
  bash_command:           { emotion: "working",    duration: 0,    priority: 4 },
  edit_file:              { emotion: "coding",     duration: 0,    priority: 4 },
  write_file:             { emotion: "coding",     duration: 0,    priority: 4 },
  read_file:              { emotion: "curious",    duration: 1000, priority: 2 },
  model_change:           { emotion: "curious",    duration: 1500, priority: 3 },
  thinking_level_change:  { emotion: "curious",    duration: 1500, priority: 3 },
  user_feed:              { emotion: "eating",     duration: 3000, priority: 6 },
  user_play:              { emotion: "playing",    duration: 4000, priority: 6 },
  user_pet:               { emotion: "happy",      duration: 2000, priority: 6 },
  user_scold:             { emotion: "sad",        duration: 3000, priority: 6 },
  user_switch:            { emotion: "curious",    duration: 2000, priority: 6 },
  idle_tick:              { emotion: "idle",       duration: 0,    priority: 0 },
  energy_tick:            { emotion: "idle",       duration: 0,    priority: 0 },
  hunger_tick:            { emotion: "idle",       duration: 0,    priority: 0 },
};

// ─── EventMapper Class ──────────────────────────────────────

export class EventMapper {
  private reactions: Record<string, PetReaction>;

  constructor(customReactions?: Record<string, PetReaction>) {
    this.reactions = { ...DEFAULT_REACTIONS, ...customReactions };
  }

  /** Map a stimulus to a reaction */
  mapStimulus(stimulus: PetStimulus): PetReaction {
    const reaction = this.reactions[stimulus.type];
    if (!reaction) {
      return { emotion: "idle", duration: 0, priority: 0 };
    }
    return { ...reaction };
  }

  /** Check if a stimulus should interrupt the current animation */
  shouldInterrupt(
    currentPriority: number,
    currentEmotion: Emotion,
    newReaction: PetReaction,
  ): boolean {
    // Same emotion never interrupts itself
    if (currentEmotion === newReaction.emotion) return false;
    // Higher priority interrupts lower
    return newReaction.priority > currentPriority;
  }

  /** Create a stimulus from a pi tool call */
  static fromToolCall(toolName: string, isError: boolean): PetStimulus {
    const type = isError ? "tool_error" : "tool_success";

    // Map tool names to more specific stimulus types
    let specificType: StimulusType = "tool_start";
    if (toolName === "bash") specificType = "bash_command";
    else if (toolName === "edit") specificType = "edit_file";
    else if (toolName === "write") specificType = "write_file";
    else if (toolName === "read") specificType = "read_file";

    if (!isError) {
      // For success, keep the specific tool type but note it's a success
      return { type: specificType === "tool_start" ? "tool_success" : specificType, intensity: 1 };
    }

    return { type: "tool_error", intensity: 1 };
  }

  /** Get the default reaction map (for customization) */
  static getDefaultReactions(): Record<StimulusType, PetReaction> {
    return { ...DEFAULT_REACTIONS };
  }
}
