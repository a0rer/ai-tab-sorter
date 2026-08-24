# Zen Project Tidy

A Sine Mod for Zen Browser that sorts your tabs into **your own project folders** with one click. No AI runtime, no cloud, no external dependencies.

## Why this exists

Existing tidy mods use AI to invent group names. That fails for programming workflows where context matters:
- A Proxmox thread on Reddit belongs to **selfhosting**, not "Reddit".
- A GitHub issue belongs to the project it relates to, not "GitHub".

Zen Project Tidy lets you define projects with keywords, domains, and example tabs. It matches tabs locally and moves them into Zen folders (or tab groups).

## Features

- One sparkle button on the pinned-tabs divider
- Project-defined sorting, not AI-discovered
- Pure client-side TF-IDF + keyword matching
- Learns from corrections (optional)
- Falls back to tab groups if Zen folders are unavailable
- No `browser.ml.enabled` required

## Installation

1. Install [Sine](https://github.com/CosmoCreeper/Sine) in Zen Browser.
2. Add this repository to Sine:
   ```
   https://github.com/a0rer/ai-tab-sorter
   ```
3. Enable the mod in `about:preferences` → Zen Mods.

## Configuration

Open Sine preferences for the mod or edit `zen.project.tidy.projects` in `about:config`.

Example project config:

```json
{
  "selfhosting": {
    "keywords": "proxmox truenas pfsense homelab selfhosted server vm docker",
    "domains": ["reddit.com/r/selfhosted", "reddit.com/r/homelab"],
    "color": "#ff8844"
  },
  "obsidian portfolio": {
    "keywords": "obsidian markdown portfolio website cv resume",
    "domains": [],
    "color": "#4488ff"
  }
}
```

### Fields

- `keywords` — space-separated terms. Literal matches in title/URL get a strong boost.
- `domains` — URL paths that should match this project.
- `color` — optional color hint for the folder/group.

## Usage

Click the sparkle button on the divider between pinned and normal tabs. Ungrouped tabs are matched to your projects and moved into folders (or groups).

Right-click the button for options.

## Learning

If learning is enabled, the mod records which tabs you manually move into or out of project folders and adjusts future matching. Corrections are stored locally in `zen.project.tidy.history`.

## Output modes

- **Folders** (default): pins tabs and places them in `zen-folder` containers.
- **Groups**: uses native Zen tab groups instead.

## Limitations

- Works on the current workspace only.
- Zen folders require a recent Zen build with folder support.
- Matching quality depends on the keywords/examples you provide.

## License

MIT
