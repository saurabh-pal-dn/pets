/**
 * pi-pets — Core type definitions
 */

// ─── Emotions ───────────────────────────────────────────────

export type Emotion =
  | "idle"
  | "happy"
  | "thinking"
  | "working"
  | "coding"
  | "success"
  | "error"
  | "sad"
  | "excited"
  | "sleepy"
  | "hungry"
  | "curious"
  | "shocked"
  | "greeting"
  | "sleeping"
  | "eating"
  | "playing"
  | (string & {}); // allow custom emotions

/** The 9 standard emotions for image-based pets (row order in sprite sheets) */
export const STANDARD_EMOTIONS = [
  "idle",
  "happy",
  "thinking",
  "working",
  "success",
  "error",
  "sad",
  "excited",
  "sleeping",
] as const;

export type StandardEmotion = (typeof STANDARD_EMOTIONS)[number];

// ─── Sprite Types ───────────────────────────────────────────

export type SpriteType = "ascii" | "emoji" | "image";

export interface SpriteSet {
  /** Array of string frames (ASCII/emoji) */
  frames: string[];
  /** Duration per frame in ms (defaults to pet's animationSpeed) */
  frameDuration?: number;
  /** Whether to loop the animation (default true) */
  loop?: boolean;
  /** Type of sprite data */
  type: "ascii" | "emoji";
}

/** Image-based sprite — frames are paths to PNG files (relative to pet directory) */
export interface ImageSpriteSet {
  /** Array of file paths relative to pet base dir, e.g. ["sprites/idle/0.png", ...] */
  frames: string[];
  /** Duration per frame in ms */
  frameDuration?: number;
  /** Whether to loop (default true) */
  loop?: boolean;
  type: "image";
}

export type AnySpriteSet = SpriteSet | ImageSpriteSet;

export type SpriteMap = Partial<Record<Emotion, AnySpriteSet>>;

// ─── Pet Behaviors ──────────────────────────────────────────

export interface ReactionConfig {
  /** Emotion to trigger */
  emotion: Emotion;
  /** How long to hold this emotion in ms (0 = one-shot animation) */
  duration: number;
  /** Priority — higher numbers interrupt lower ones */
  priority: number;
}

export interface PetBehaviors {
  /** Probability of a random idle animation (0–1) */
  idleChance?: number;
  /** Interval in ms between random idle animations */
  idleInterval?: number;
  /** Custom reaction overrides for specific event types */
  reactions?: Record<string, ReactionConfig>;
}

// ─── Pet Definition ─────────────────────────────────────────

export interface PetDefinition {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Author name */
  author: string;
  /** Sprite sets keyed by emotion */
  sprites: SpriteMap;
  /** Width of the sprite area in characters (ASCII) or pixels (image) */
  frameWidth: number;
  /** Height of the sprite area in lines (ASCII) or pixels (image) */
  frameHeight: number;
  /** Default frame duration in ms */
  animationSpeed: number;
  /** Overall sprite type preference: "ascii" | "emoji" | "image" */
  spriteType?: SpriteType;
  /** Behavior customization */
  behaviors?: PetBehaviors;
  /** Path to the pet directory (populated at load time) */
  _baseDir?: string;
}

// ─── Pet State ──────────────────────────────────────────────

export interface PetAttributes {
  /** Happiness: 0 (miserable) → 100 (ecstatic) */
  happiness: number;
  /** Hunger: 0 (full) → 100 (starving) */
  hunger: number;
  /** Energy: 0 (exhausted) → 100 (fully rested) */
  energy: number;
  /** Affection toward user: 0 (distant) → 100 (devoted) */
  affection: number;
}

export interface PetState {
  /** Current emotional state */
  emotion: Emotion;
  /** Numeric attributes */
  attributes: PetAttributes;
  /** Custom name given by user */
  customName: string | null;
  /** Timestamp of last state update */
  lastUpdate: number;
  /** Timestamp of last interaction with user */
  lastInteraction: number;
  /** Whether the pet is currently visible */
  visible: boolean;
  /** Total session time the pet has been active (ms) */
  totalActiveTime: number;
}

// ─── Stimuli (Internal Events) ──────────────────────────────

export type StimulusType =
  | "session_start"
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "thinking"
  | "tool_start"
  | "tool_success"
  | "tool_error"
  | "bash_command"
  | "edit_file"
  | "write_file"
  | "read_file"
  | "model_change"
  | "thinking_level_change"
  | "user_feed"
  | "user_play"
  | "user_pet"
  | "user_scold"
  | "user_switch"
  | "idle_tick"
  | "energy_tick"
  | "hunger_tick";

export interface PetStimulus {
  type: StimulusType;
  /** Optional intensity 0–1 (e.g., how big the tool output was) */
  intensity?: number;
  /** Optional metadata */
  meta?: Record<string, unknown>;
}

// ─── Reaction (Output of EventMapper) ───────────────────────

export interface PetReaction {
  emotion: Emotion;
  duration: number;
  priority: number;
}

// ─── Animation Frame ────────────────────────────────────────

export interface AnimationFrame {
  /** The sprite lines to render */
  lines: string[];
  /** Current frame index */
  frameIndex: number;
  /** Total frames in this animation */
  totalFrames: number;
  /** The emotion this frame belongs to */
  emotion: Emotion;
}

// ─── Pet Instance ───────────────────────────────────────────

export interface PetInstance {
  definition: PetDefinition;
  state: PetState;
}

// ─── Constants ──────────────────────────────────────────────

export const DEFAULT_ATTRIBUTES: PetAttributes = {
  happiness: 75,
  hunger: 20,
  energy: 90,
  affection: 60,
};

export const DEFAULT_ANIMATION_SPEED = 500; // ms per frame

export const ATTRIBUTE_DECAY_INTERVAL = 4_000; // ms between attribute ticks (2.5x baseline of 10s)
export const HUNGER_INCREASE_RATE = 1.25; // per tick (2.5x)
export const ENERGY_DECREASE_RATE = 0.75; // per tick while active (2.5x)
export const ENERGY_REGEN_RATE = 2.5; // per tick while idle (2.5x)
export const HAPPINESS_DECAY_RATE = 0.25; // per tick while ignored (2.5x)
