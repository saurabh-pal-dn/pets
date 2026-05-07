/**
 * PetAnimationEngine — manages the animation priority queue, frame timing,
 * and sprite selection based on the current emotional state.
 */

import type {
  AnimationFrame,
  Emotion,
  PetDefinition,
  PetReaction,
  AnySpriteSet,
} from "./types.js";

interface AnimationEntry {
  emotion: Emotion;
  /** Absolute time when this animation expires */
  expiresAt: number;
  priority: number;
  /** Whether this is a persistent state (duration: 0) */
  persistent: boolean;
}

export class PetAnimationEngine {
  private pet: PetDefinition;
  private currentEmotion: Emotion = "idle";
  private currentPriority = 0;
  private animationQueue: AnimationEntry[] = [];
  private frameIndex = 0;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameTime = 0;
  private onFrameChange?: (frame: AnimationFrame) => void;

  constructor(pet: PetDefinition, onFrameChange?: (frame: AnimationFrame) => void) {
    this.pet = pet;
    this.onFrameChange = onFrameChange;
  }

  // ─── Public API ───────────────────────────────────────────

  /** Apply a reaction — may interrupt current animation */
  applyReaction(reaction: PetReaction): void {
    const now = Date.now();

    // Check if persistent (duration 0 means hold until replaced)
    const persistent = reaction.duration === 0;
    const expiresAt = persistent ? Infinity : now + reaction.duration;

    const entry: AnimationEntry = {
      emotion: reaction.emotion,
      expiresAt,
      priority: reaction.priority,
      persistent,
    };

    // If higher priority, clear queue and insert at front
    if (reaction.priority > this.currentPriority) {
      this.animationQueue = [entry];
      this.switchTo(reaction.emotion, reaction.priority);
      return;
    }

    // If same priority, queue behind current
    if (reaction.priority === this.currentPriority) {
      // Replace non-persistent entries of same priority
      this.animationQueue = this.animationQueue.filter(
        (e) => e.persistent || e.priority > reaction.priority,
      );
      this.animationQueue.push(entry);
      return;
    }

    // Lower priority — add to end of queue
    this.animationQueue.push(entry);
  }

  /** Force a specific emotion (used by state machine decay ticks) */
  setEmotion(emotion: Emotion, priority = 0): void {
    if (this.currentEmotion === emotion) return;
    this.switchTo(emotion, priority);
  }

  /** Get the current animation frame */
  getCurrentFrame(): AnimationFrame {
    const spriteSet = this.getSpriteSet(this.currentEmotion);
    if (!spriteSet || spriteSet.frames.length === 0) {
      const idleSet = this.pet.sprites.idle;
      if (idleSet && idleSet.frames.length > 0) {
        return this.buildFrame(idleSet, 0, "idle");
      }
      return {
        lines: ["(no sprite)"],
        frameIndex: 0,
        totalFrames: 1,
        emotion: this.currentEmotion,
      };
    }

    const frameIdx = this.frameIndex % spriteSet.frames.length;
    return this.buildFrame(spriteSet, frameIdx, this.currentEmotion);
  }

  /** Get emotion + frame index (used by image renderer) */
  getFrameData(): { emotion: Emotion; frameIndex: number; totalFrames: number } {
    const spriteSet = this.getSpriteSet(this.currentEmotion);
    const total = spriteSet?.frames.length ?? 1;
    return {
      emotion: this.currentEmotion,
      frameIndex: this.frameIndex % total,
      totalFrames: total,
    };
  }

  /** Raw access for renderers that need the sprite frames directly */
  getCurrentSpriteSet(): AnySpriteSet | undefined {
    return this.getSpriteSet(this.currentEmotion);
  }

  /** Start the animation timer */
  start(): void {
    if (this.frameTimer) return;
    this.lastFrameTime = Date.now();

    this.frameTimer = setInterval(() => {
      this.tick();
    }, this.pet.animationSpeed / 2); // Check twice per frame for accuracy
  }

  /** Stop the animation timer */
  stop(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  /** Switch to a different pet definition */
  switchPet(pet: PetDefinition): void {
    this.pet = pet;
    this.frameIndex = 0;
    this.currentEmotion = "idle";
    this.currentPriority = 0;
    this.animationQueue = [];
  }

  /** Get the current emotion */
  getCurrentEmotion(): Emotion {
    return this.currentEmotion;
  }

  /** Get the current priority */
  getCurrentPriority(): number {
    return this.currentPriority;
  }

  /** Clean up */
  dispose(): void {
    this.stop();
    this.onFrameChange = undefined;
  }

  // ─── Private ──────────────────────────────────────────────

  private tick(): void {
    const now = Date.now();
    this.pruneExpired(now);

    // If queue is empty, revert to idle
    if (this.animationQueue.length === 0) {
      if (this.currentEmotion !== "idle") {
        this.switchTo("idle", 0);
      }
    }

    // Advance frame if enough time has passed
    const spriteSet = this.getSpriteSet(this.currentEmotion);
    const frameDuration = spriteSet?.frameDuration ?? this.pet.animationSpeed;

    if (now - this.lastFrameTime >= frameDuration) {
      this.frameIndex++;
      this.lastFrameTime = now;
      this.emitFrame();
    }
  }

  private pruneExpired(now: number): void {
    this.animationQueue = this.animationQueue.filter((entry) => {
      if (entry.persistent) return true;
      return now < entry.expiresAt;
    });

    // If current one expired, pop next
    if (this.animationQueue.length > 0) {
      const next = this.animationQueue[0]!;
      if (next.emotion !== this.currentEmotion) {
        this.switchTo(next.emotion, next.priority);
      }
    }
  }

  private switchTo(emotion: Emotion, priority: number): void {
    this.currentEmotion = emotion;
    this.currentPriority = priority;
    this.frameIndex = 0;
    this.lastFrameTime = Date.now();
    this.emitFrame();
  }

  private getSpriteSet(emotion: Emotion): AnySpriteSet | undefined {
    if (this.pet.sprites[emotion]) return this.pet.sprites[emotion];
    const fallbacks: Emotion[] = ["idle", "happy", "curious"];
    for (const fb of fallbacks) {
      if (this.pet.sprites[fb]) return this.pet.sprites[fb];
    }
    return undefined;
  }

  private buildFrame(
    spriteSet: AnySpriteSet,
    frameIdx: number,
    emotion: Emotion,
  ): AnimationFrame {
    const frame = spriteSet.frames[frameIdx]!;
    if (spriteSet.type === "image") {
      // Image sprites — the frame is a file path or base64 string
      return {
        lines: [],
        frameIndex: frameIdx,
        totalFrames: spriteSet.frames.length,
        emotion,
      };
    }
    // ASCII/emoji sprites — split text frame by newlines
    return {
      lines: frame.split("\n"),
      frameIndex: frameIdx,
      totalFrames: spriteSet.frames.length,
      emotion,
    };
  }

  private emitFrame(): void {
    if (this.onFrameChange) {
      this.onFrameChange(this.getCurrentFrame());
    }
  }
}
