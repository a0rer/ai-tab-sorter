# Zen Project Tidy

A Sine Mod for Zen Browser that sorts your tabs into **your own project folders** with one click. Local-first, with an optional Gemini AI fallback for tabs that aren't a clear keyword/domain match.

## Why this exists

Existing tidy mods use AI to invent group names. That fails for programming workflows where context matters:
- A Proxmox thread on Reddit belongs to **selfhosting**, not "Reddit".
- A GitHub issue belongs to the project it relates to, not "GitHub".

Zen Project Tidy lets you define projects with keywords, domains, and example tabs. It matches tabs locally first and moves them into Zen folders (or tab groups). For ambiguous tabs, you can optionally enable Gemini to decide based on title and URL.

## Features

- One sparkle button on the pinned-tabs divider
- Project-defined sorting, not AI-discovered
- Local TF-IDF + keyword/domain matching
- Optional Gemini AI fallback for ambiguous tabs
- Caches Gemini decisions locally so repeat sorts are free
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

- **Shift+click** the button to run **AI project discovery**: Gemini analyzes tabs across *all* workspaces, suggests project categories, and sorts tabs after you confirm.

## Debug

Open the Browser Console and run:

```js
ZenProjectTidy.exportTabs()
```

This copies a markdown list of every sortable tab to your clipboard, which is useful for debugging grouping or pasting into an AI chat.

## Learning

If learning is enabled, the mod records which tabs you manually move into or out of project folders and adjusts future matching. Corrections are stored locally in `zen.project.tidy.history`.

## Output modes

- **Folders** (default): pins tabs and places them in `zen-folder` containers.
- **Groups**: uses native Zen tab groups instead.

## Optional Gemini fallback

Set these in Sine preferences or `about:config`:

- `zen.project.tidy.gemini.enabled` — enable Gemini for ambiguous tabs.
- `zen.project.tidy.gemini.key` — your Gemini API key.
- `zen.project.tidy.gemini.model` — model name (default: `gemini-3.6-flash`).

When enabled, tabs that don't confidently match locally are sent to Gemini in **one batched request**. The result is cached by hostname+title, so the same tab only costs an API call once. If Gemini fails or is disabled, the mod falls back to the local score or skips the tab.

## Limitations

- Normal sort works on the current workspace only; cross-workspace discovery requires Gemini.
- Zen folders require a recent Zen build with folder support.
- Matching quality depends on the keywords/examples you provide.
- Gemini fallback requires an internet connection and a Google API key.

## License

MIT
