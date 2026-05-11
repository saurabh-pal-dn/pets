# pi-pets

A virtual pet companion for [pi coding agent](https://github.com/badlogic/pi-mono) — a tiny friend that lives in your terminal and reacts to your coding activity.

When pi thinks, your pet thinks. When commands succeed, your pet celebrates. When errors happen, your pet looks sad. It's a Tamagotchi for your terminal.

## Quick Start

```bash
pi install npm:pi-pets
```

Or run directly:

```bash
pi -e ./extensions/pi-pets.ts
```

## Pets Included by default

| Pet          | Type  | Description                            |
| ------------ | ----- | -------------------------------------- |
| 🐱 **Cat**   | ASCII | A curious feline coding companion      |
| 🐶 **Dog**   | ASCII | An enthusiastic canine coding buddy    |
| 🤖 **Robot** | ASCII | A logical bot companion who loves code |

ASCII pets render in pi's terminal. Sprite pets render via a separate Ghostty terminal window.

## How It Works

The pet watches your pi session and reacts:

| pi Event                           | Pet Reaction           |
| ---------------------------------- | ---------------------- |
| Agent starts working               | Curious / excited      |
| LLM thinking                       | Thinking animation     |
| Tool execution (bash, edit, write) | Working animation      |
| Tool succeeds                      | Celebration 🎉         |
| Tool fails                         | Sad / error expression |
| Session starts                     | Greeting               |
| Idle too long                      | Sleepy / hungry        |

The pet has attributes that change over time:

- **Happiness** — goes up on successes and play, down on errors
- **Hunger** — increases while working, decreases with `/pet feed`
- **Energy** — depletes with activity, regenerates while idle
- **Affection** — grows with interaction, fades when ignored

The pet never dies — it just looks sad or sleepy until you care for it.

## Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `/pet`               | Show pet status and available commands |
| `/pet status`        | Detailed stats with bar graphs         |
| `/pet feed`          | Feed your pet (reduces hunger)         |
| `/pet play`          | Play with your pet (boosts happiness)  |
| `/pet pet`           | Pet your pet (increases affection)     |
| `/pet switch <name>` | Switch to a different pet              |
| `/pet list`          | List all available pets                |
| `/pet hide`          | Hide the pet display                   |
| `/pet show`          | Show the pet display                   |
| `/pet rename <name>` | Give your pet a custom name            |

## Architecture

```
┌──────────────────────┐
│   pi terminal         │
│                      │
│  pi-pets extension   │
│  ├─ PetStateMachine  │── emotion/attribute engine
│  ├─ PetAnimationEngine│── frame timing, sprite selection
│  ├─ EventMapper      │── pi events → pet stimuli
│  └─ PetRegistry      │── pet discovery & loading
│                      │
└──────────┬───────────┘
           │
    ┌──────┴──────┬──────────────────┐
    ▼             ▼                  ▼
┌────────┐  ┌───────────┐  ┌─────────────────┐
│ ASCII   │  │ OpenPets  │  │ Pet Display     │
│ Widget  │  │ Desktop   │  │ Terminal        │
│ (TUI)   │  │ App (IPC)* │  │ (Unix Socket)   │
└────────┘  └───────────┘  └─────────────────┘

* work in progress
```

Two working rendering backends, selected automatically:

1. **Pet display terminal** — Kitty protocol images in a separate Ghostty window
1. **ASCII widget** — text-based pet in pi's TUI (fallback)

## OpenPets Integration

For the best experience, install the [OpenPets desktop app](https://github.com/alvinunreal/openpets/releases/latest). pi-pets detects it automatically and sends state changes over Unix socket IPC — no Kitty protocol issues, no terminal window management, just a clean floating pet. This implementation is incomplete, and would be supported soon.

```bash
# Download and install OpenPets
open https://github.com/alvinunreal/openpets/releases/latest
# Launch it once — it stays in the menu bar
```

## Creating Custom Pets

### ASCII Pets

Create a directory with a `pet.json` manifest and sprite text files:

```
~/.pi/agent/pets/my-pet/
├── pet.json
└── sprites/
    ├── idle.txt
    ├── happy.txt
    ├── thinking.txt
    └── ...
```

**pet.json:**

```json
{
  "id": "my-pet",
  "name": "My Pet",
  "description": "A custom pet",
  "author": "Your Name",
  "frameWidth": 20,
  "frameHeight": 5,
  "animationSpeed": 500,
  "sprites": {
    "idle": { "file": "sprites/idle.txt", "loop": true },
    "happy": { "file": "sprites/happy.txt", "frameDuration": 400 },
    "thinking": { "file": "sprites/thinking.txt" }
  }
}
```

**Sprite files** are text files with frames separated by blank lines:

```
  /\___/\
 (  o o  )
 (  =^=  )
  ═══════

  /\___/\
 (  - -  )
 (  =^=  )
  ═══════
```

### Image Pets (Sprite Sheets)

Use the Codex sprite sheet format — a WebP/PNG grid with 8 columns × 9 rows:

```
~/.pi/agent/pets/my-pet/
├── pet.json
└── spritesheet.webp
```

```json
{
  "id": "my-pet",
  "name": "My Pet",
  "spriteType": "image",
  "frameWidth": 192,
  "frameHeight": 208,
  "animationSpeed": 200,
  "spritesheet": "spritesheet.webp",
  "spritesheetConfig": {
    "cols": 8,
    "rows": 9,
    "framesPerRow": [6, 8, 8, 4, 5, 8, 6, 6, 6],
    "rowEmotions": [
      "idle",
      "working",
      "thinking",
      "excited",
      "success",
      "error",
      "sad",
      "happy",
      "sleeping"
    ]
  }
}
```

| Row | Emotion    | Frames | Description                |
| --- | ---------- | ------ | -------------------------- |
| 0   | `idle`     | 6      | Default state              |
| 1   | `working`  | 8      | Tool execution (RUN RIGHT) |
| 2   | `thinking` | 8      | LLM generating (RUN LEFT)  |
| 3   | `excited`  | 4      | Big celebration (WAVING)   |
| 4   | `success`  | 5      | Tool success (JUMPING)     |
| 5   | `error`    | 8      | Tool failure (FAILED)      |
| 6   | `sad`      | 6      | Low happiness (WAITING)    |
| 7   | `happy`    | 6      | High happiness (RUNNING)   |
| 8   | `sleeping` | 6      | Low energy (REVIEW)        |

## Programmatic API

```typescript
import {
  PetStateMachine,
  PetAnimationEngine,
  PetRegistry,
  EventMapper,
  PetDisplayServer,
  OpenPetsClient,
  loadSpriteSheet,
  ImageCache,
  createPetWidgetRenderer,
  STANDARD_SPRITESHEET,
  STANDARD_ROW_EMOTIONS,
} from "pi-pets";
```

All public types and classes are exported from `src/index.ts`.

## Requirements

- **pi coding agent** (`@mariozechner/pi-coding-agent`)
- **Node.js** ≥ 22
- **OpenPets desktop app** (optional, for image pets)
- **Ghostty/Kitty terminal** (optional, for standalone pet display)

## Project Structure

```
pi-pets/
├── extensions/pi-pets.ts     ← Main extension entry point
├── bin/pi-pets-display.ts    ← Standalone display client
├── src/
│   ├── types.ts              ← All type definitions
│   ├── PetStateMachine.ts    ← Emotion/attribute engine
│   ├── PetAnimationEngine.ts ← Frame timing, priority queue
│   ├── EventMapper.ts        ← pi events → pet stimuli
│   ├── PetRegistry.ts        ← Pet discovery & loading
│   ├── PetRenderer.ts        ← ASCII widget renderer
│   ├── PetImageRenderer.ts   ← Kitty image renderer
│   ├── SpriteSheetLoader.ts  ← WebP sprite sheet → base64 PNG
│   ├── PetDisplayServer.ts   ← Unix socket server (IPC)
│   ├── PetDisplayClient.ts   ← Terminal display client
│   ├── OpenPetsClient.ts     ← OpenPets desktop integration
│   ├── commands.ts           ← All /pet slash commands
│   └── index.ts              ← Public API exports
├── pets/                     ← Built-in pets
│   ├── cat/ dog/ robot/     ← ASCII pets
│   └── slavik/ nukie/ homelander/ ← Image pets
├── skills/pi-pets/SKILL.md   ← LLM interaction skill
└── package.json
```

## License

MIT
