/**
 * pi-pets — Public API
 *
 * Use these exports to create custom pets programmatically
 * in your own extensions or pi packages.
 */

// Types
export type {
  Emotion,
  StandardEmotion,
  SpriteType,
  SpriteSet,
  ImageSpriteSet,
  AnySpriteSet,
  SpriteMap,
  ReactionConfig,
  PetBehaviors,
  PetDefinition,
  PetAttributes,
  PetState,
  PetStimulus,
  StimulusType,
  PetReaction,
  AnimationFrame,
  PetInstance,
} from "./types.js";
export { STANDARD_EMOTIONS } from "./types.js";

// Constants
export {
  DEFAULT_ATTRIBUTES,
  DEFAULT_ANIMATION_SPEED,
  ATTRIBUTE_DECAY_INTERVAL,
} from "./types.js";

// Core classes
export { PetStateMachine } from "./PetStateMachine.js";
export { EventMapper } from "./EventMapper.js";
export { PetAnimationEngine } from "./PetAnimationEngine.js";
export { PetRegistry } from "./PetRegistry.js";
export type { PetLoadError, PetRegistryResult, PetLoadMeta } from "./PetRegistry.js";

// Renderers
export { createPetWidgetRenderer } from "./PetRenderer.js";
export type { RendererPlacement, RendererOptions, WidgetRef, TuiHandle } from "./PetRenderer.js";
export { createPetImageRenderer, ImageCache } from "./PetImageRenderer.js";
export type { ImageRendererOptions } from "./PetImageRenderer.js";

// IPC (separate terminal display)
export { PetDisplayServer } from "./PetDisplayServer.js";
export type { PetDisplayFrame, PetDisplayMessage, PetDisplayCommand } from "./PetDisplayServer.js";
export { runDisplayClient } from "./PetDisplayClient.js";

// Sprite sheet support
export { loadSpriteSheet, loadImageFrames, STANDARD_SPRITESHEET, STANDARD_ROW_EMOTIONS } from "./SpriteSheetLoader.js";
export type { SpriteSheetConfig } from "./SpriteSheetLoader.js";

/**
 * Quick helper to define a pet programmatically.
 *
 * @example
 * ```typescript
 * import { definePet } from "pi-pets";
 *
 * const myPet = definePet({
 *   id: "my-pet",
 *   name: "My Pet",
 *   sprites: {
 *     idle: { frames: ["(o_o)"], type: "ascii" },
 *   },
 * });
 * ```
 */
export function definePet(pet: import("./types.js").PetDefinition): import("./types.js").PetDefinition {
  return pet;
}
