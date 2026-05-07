/**
 * PetRegistry — discovers and loads pet definitions from:
 *   1. Built-in pets (bundled with the package)
 *   2. User global pets (~/.pi/agent/pets/)
 *   3. Project-local pets (.pi/pets/)
 *
 * Supports both ASCII sprites (text files) and image sprites (PNG files or sprite sheets).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { PetDefinition, SpriteMap, AnySpriteSet, ImageSpriteSet } from "./types.js";
import {
  STANDARD_SPRITESHEET,
  STANDARD_ROW_EMOTIONS,
} from "./SpriteSheetLoader.js";
import type { SpriteSheetConfig } from "./SpriteSheetLoader.js";

// ─── Types for pet.json manifest ─────────────────────────────

interface PetManifest {
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  author?: string;
  spriteType?: string;
  frameWidth?: number;
  frameHeight?: number;
  animationSpeed?: number;
  behaviors?: PetDefinition["behaviors"];
  // Sprite sheet mode (codex-pet-share format)
  spritesheet?: string;
  spritesheetPath?: string;
  spritesheetConfig?: SpriteSheetConfig & { rowEmotions?: string[]; mimeType?: string };
  // Individual text/PNG mode
  sprites?: Record<string, SpriteEntry>;
}

interface SpriteEntry {
  type?: string;
  file?: string;
  frames?: string[];
  frameDuration?: number;
  loop?: boolean;
}

// ─── Public types ───────────────────────────────────────────

export interface PetLoadError {
  path: string;
  error: string;
}

export interface PetRegistryResult {
  pets: PetDefinition[];
  errors: PetLoadError[];
}

/** Metadata about how a pet was loaded — used by the extension to post-process */
export interface PetLoadMeta {
  /** Pet ID */
  petId: string;
  /** Path to the sprite sheet file (if applicable) */
  spriteSheetPath?: string;
  /** The sprite sheet config (if applicable) */
  spriteSheetConfig?: SpriteSheetConfig;
  /** MIME type of the sprite sheet */
  spriteSheetMime?: string;
  /** Row → emotion mapping */
  rowEmotions?: string[];
}

// ─── Registry ───────────────────────────────────────────────

export class PetRegistry {
  private pets: Map<string, PetDefinition> = new Map();
  private errors: PetLoadError[] = [];
  /** Metadata for image-based pets that need post-processing */
  private metas: Map<string, PetLoadMeta> = new Map();

  // ─── Public API ───────────────────────────────────────────

  discover(cwd?: string): PetRegistryResult {
    this.pets.clear();
    this.errors = [];
    this.metas.clear();

    const packageDir = (() => {
      try {
        return import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
      } catch {
        return dirname(fileURLToPath(import.meta.url));
      }
    })();

    this.discoverFrom(join(packageDir, "..", "pets"), "builtin");
    this.discoverFrom(join(homedir(), ".pi", "agent", "pets"), "user");

    if (cwd) {
      this.discoverFrom(join(cwd, ".pi", "pets"), "project");
    }

    return { pets: Array.from(this.pets.values()), errors: [...this.errors] };
  }

  get(id: string): PetDefinition | undefined {
    return this.pets.get(id);
  }

  list(): string[] {
    return Array.from(this.pets.keys());
  }

  getAll(): PetDefinition[] {
    return Array.from(this.pets.values());
  }

  getDefault(): PetDefinition | undefined {
    return this.pets.get("cat") ?? this.pets.values().next().value;
  }

  /** Get load metadata for an image-based pet (for post-processing with sharp) */
  getMeta(id: string): PetLoadMeta | undefined {
    return this.metas.get(id);
  }

  /** Get all image-based pet IDs that need sprite sheet processing */
  getImagePetIds(): string[] {
    return Array.from(this.metas.keys());
  }

  registerPet(pet: PetDefinition, source: string): void {
    if (!pet.sprites.idle || pet.sprites.idle.frames.length === 0) {
      this.errors.push({
        path: `programmatic:${pet.id}`,
        error: "Pet must have at least an 'idle' sprite",
      });
      return;
    }
    if (source === "project" || !this.pets.has(pet.id)) {
      this.pets.set(pet.id, pet);
    }
  }

  // ─── Private discovery ────────────────────────────────────

  private discoverFrom(dir: string, source: string): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try { if (!statSync(fullPath).isDirectory()) continue; } catch { continue; }

      const manifestPath = join(fullPath, "pet.json");
      if (existsSync(manifestPath)) {
        this.loadJsonPet(manifestPath, fullPath, source);
        continue;
      }

      // TypeScript pet definition
      const tsPath = join(fullPath, "index.ts");
      if (existsSync(tsPath)) {
        this.loadTypeScriptPet(tsPath, source);
      }
    }
  }

  private loadJsonPet(manifestPath: string, baseDir: string, source: string): void {
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const m = JSON.parse(raw) as PetManifest;

      if (!m.id) {
        this.errors.push({ path: manifestPath, error: "Missing required field: id" });
        return;
      }

      const name = m.name ?? m.displayName ?? m.id;
      const spriteType = m.spriteType ?? "ascii";

      // ── Sprite sheet mode ────────────────────────────
      if (spriteType === "image") {
        const sheetPath = m.spritesheet ?? m.spritesheetPath;
        if (sheetPath) {
          this.loadSpriteSheetPet(m, name, baseDir, sheetPath, source);
          return;
        }
        // Individual PNG frames mode
        this.loadImagePet(m, name, baseDir, source);
        return;
      }

      // ── ASCII/emoji mode ─────────────────────────────
      this.loadAsciiPet(m, name, baseDir, source);

    } catch (err) {
      this.errors.push({ path: manifestPath, error: String(err) });
    }
  }

  // ── ASCII pet loader ──────────────────────────────────────

  private loadAsciiPet(
    m: PetManifest, name: string, baseDir: string, source: string,
  ): void {
    const sprites: SpriteMap = {};
    if (m.sprites) {
      for (const [emotion, config] of Object.entries(m.sprites)) {
        if (!config) continue;

        let frames: string[] = [];
        if (config.frames && Array.isArray(config.frames)) {
          frames = config.frames;
        } else if (config.file) {
          const spritePath = join(baseDir, config.file);
          if (existsSync(spritePath)) {
            const content = readFileSync(spritePath, "utf-8");
            frames = content
              .split(/\n\n+/)
              .map((f) => f.replace(/\n?$/, "").trimEnd())
              .filter((f) => f.length > 0);
          } else {
            this.errors.push({ path: spritePath, error: `File not found: ${config.file}` });
          }
        }

        if (frames.length > 0) {
          sprites[emotion] = {
            frames,
            frameDuration: config.frameDuration ?? m.animationSpeed,
            loop: config.loop !== false,
            type: (config.type as "ascii" | "emoji") ?? "ascii",
          };
        }
      }
    }

    const pet = this.buildPet(m, name, baseDir, sprites, "ascii");
    this.upsertPet(pet, source, "idle");
  }

  // ── Image (individual PNGs) loader ─────────────────────────

  private loadImagePet(
    m: PetManifest, name: string, baseDir: string, source: string,
  ): void {
    const sprites: SpriteMap = {};
    if (m.sprites) {
      for (const [emotion, config] of Object.entries(m.sprites)) {
        if (!config) continue;

        const paths: string[] = config.frames ?? [];
        const resolved = paths.map((p) => join(baseDir, p));

        const existing = resolved.filter((p) => existsSync(p));
        if (existing.length === 0) continue;

        sprites[emotion] = {
          frames: existing,
          frameDuration: config.frameDuration ?? m.animationSpeed,
          loop: config.loop !== false,
          type: "image",
        } as ImageSpriteSet;
      }
    }

    const pet = this.buildPet(m, name, baseDir, sprites, "image");
    this.upsertPet(pet, source, "idle");
  }

  // ── Sprite sheet loader ───────────────────────────────────

  private loadSpriteSheetPet(
    m: PetManifest, name: string, baseDir: string, sheetRelPath: string, source: string,
  ): void {
    const sheetPath = join(baseDir, sheetRelPath);
    if (!existsSync(sheetPath)) {
      this.errors.push({ path: sheetPath, error: `Sprite sheet not found: ${sheetRelPath}` });
      return;
    }

    const cfg = m.spritesheetConfig ?? STANDARD_SPRITESHEET;
    const rowEmotions = cfg.rowEmotions ?? STANDARD_ROW_EMOTIONS;
    const mimeType = cfg.mimeType ?? "image/webp";

    // Build placeholder sprites from the grid config.
    // Actual base64 data is loaded async later via SpriteSheetLoader.
    const sprites: SpriteMap = {};
    const frameCounts = cfg.framesPerRow ?? STANDARD_SPRITESHEET.framesPerRow;

    for (let row = 0; row < (cfg.rows ?? 9); row++) {
      const emotion = rowEmotions[row] ?? `row_${row}`;
      const count = frameCounts[row] ?? (cfg.cols ?? 8);
      // Placeholder frames — will be replaced after async load
      sprites[emotion] = {
        frames: new Array(count).fill(""),
        frameDuration: m.animationSpeed,
        loop: true,
        type: "image",
      } as ImageSpriteSet;
    }

    const pet = this.buildPet(m, name, baseDir, sprites, "image");
    this.upsertPet(pet, source, "idle");

    // Store metadata for async post-processing
    this.metas.set(m.id, {
      petId: m.id,
      spriteSheetPath: sheetPath,
      spriteSheetConfig: cfg,
      spriteSheetMime: mimeType,
      rowEmotions,
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  private buildPet(
    m: PetManifest, name: string, baseDir: string,
    sprites: SpriteMap, spriteType: string,
  ): PetDefinition {
    return {
      id: m.id,
      name,
      description: m.description ?? `${name} pet`,
      author: m.author ?? "unknown",
      sprites,
      frameWidth: m.frameWidth ?? (spriteType === "image" ? 192 : 20),
      frameHeight: m.frameHeight ?? (spriteType === "image" ? 208 : 6),
      animationSpeed: m.animationSpeed ?? (spriteType === "image" ? 200 : 500),
      spriteType: spriteType as PetDefinition["spriteType"],
      behaviors: m.behaviors,
      _baseDir: baseDir,
    };
  }

  private upsertPet(pet: PetDefinition, source: string, _requiredEmotion: string): void {
    if (source === "project" || !this.pets.has(pet.id)) {
      this.pets.set(pet.id, pet);
    }
  }

  private loadTypeScriptPet(_tsPath: string, _source: string): void {
    // Handled by extension at load time via registerPet()
  }
}
