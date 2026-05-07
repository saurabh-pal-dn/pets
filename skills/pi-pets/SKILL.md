# pi-pets

Use this skill when the user mentions their pet, companion, or virtual friend in pi.

## About the Pet

The user has a virtual pet living in their pi terminal. The pet reacts to coding activity automatically. The user can interact with it using `/pet` commands.

## Available Commands

- `/pet` — Show pet status and available commands
- `/pet status` — Show detailed stats (happiness, hunger, energy, affection)
- `/pet feed` — Feed the pet (reduces hunger)
- `/pet play` — Play with the pet (increases happiness, uses energy)
- `/pet pet` — Pet the pet (increases affection and happiness)
- `/pet switch <name>` — Switch to a different pet species
- `/pet list` — List all available pets
- `/pet hide` — Hide the pet
- `/pet show` — Show the pet
- `/pet rename <name>` — Give the pet a custom name

## Behavior

- The pet gets hungry over time — remind the user to feed it occasionally
- The pet gets tired from coding — suggest `/pet play` or breaks when energy is low
- The pet's mood reflects the coding session: happy on successes, sad on errors
- You can talk about the pet naturally in conversation
- If the user says they're stuck or frustrated, note how the pet is reacting too

## When to Use This Skill

- User asks about their pet or companion
- User wants to know how the pet is doing
- User wants to interact with or customize the pet
- You notice the pet might be hungry or tired based on visible indicators
- The user seems frustrated or happy — you can reference the pet's matching mood
