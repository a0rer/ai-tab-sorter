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
- Local TF-IDF + keyword/domain/example matching
- Structured URL signals for GitHub, Reddit, StackOverflow, etc.
- Optional Gemini or Ollama AI fallback for ambiguous tabs
- Caches AI decisions locally so repeat sorts are free
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
    "keywords": "proxmox truenas pfsense homelab selfhosted server vm docker unraid nas kvm virtualization",
    "domains": ["reddit.com/r/selfhosted", "reddit.com/r/homelab"],
    "examples": [
      "Proxmox VE - Dashboard",
      "TrueNAS Scale",
      "reddit.com/r/selfhosted"
    ],
    "color": "#ff8844"
  },
  "programming": {
    "keywords": "typescript react node python golang rust kubernetes docker github gitlab ci cd",
    "domains": [
      "github.com/a0rer",
      "github.com/facebook/react",
      "stackoverflow.com/questions/tagged/reactjs"
    ],
    "examples": [
      "GitHub - facebook/react",
      "Stack Overflow - React hooks",
      "TypeScript documentation"
    ],
    "rules": [
      "github.com/facebook/react",
      "stackoverflow.com/questions/tagged/reactjs",
      "regex:github\\.com/.*/(react|next\.js|vite)"
    ],
    "color": "#4488ff"
  },
  "obsidian portfolio": {
    "keywords": "obsidian markdown portfolio website cv resume",
    "domains": [],
    "examples": [],
    "color": "#44aa77"
  }
}
```

### Fields

- `keywords` — space-separated terms. Literal matches in title/URL get a strong boost.
- `domains` — URL paths that should match this project. Full paths beat domain-only matches.
- `examples` — example titles or URLs that belong to this project. Very strong signal.
- `rules` — explicit substring or regex rules checked against title and URL. Strongest signal.
  - Plain text: `"r/selfhosted"` matches if title or URL contains that substring.
  - Regex: `"regex:github\\.com/.*/react"` matches with a regular expression.
- `color` — optional color hint for the folder/group.

### Treating projects as topics

You don't have to limit projects to one codebase. A "project" can be any topic you want tabs grouped by — `devops`, `frontend`, `selfhosting`, `career`, etc. Use `keywords`, `domains`, and `examples` to teach the matcher what each topic looks like.

## Usage

Click the sparkle button on the divider between pinned and normal tabs. Ungrouped tabs are matched to your projects and moved into folders (or groups).

- **Right-click any tab** and choose **Project Tidy → Sort tabs into projects** to sort the current workspace.
- Choose **Project Tidy → Discover categories with AI** to run AI project discovery.
- **Shift+click** the sparkle button to run **AI project discovery**: the configured AI provider analyzes tabs across *all* workspaces, suggests project categories, and sorts tabs after you confirm.

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

## Optional AI fallback

Set these in Sine preferences or `about:config`:

- `zen.project.tidy.ai.provider` — choose `gemini` or `ollama`.
- `zen.project.tidy.gemini.enabled` — enable AI fallback for ambiguous tabs.

### Gemini

- `zen.project.tidy.gemini.key` — your Gemini API key.
- `zen.project.tidy.gemini.model` — model name (default: `gemini-3.6-flash`).

### Ollama (local)

- `zen.project.tidy.ollama.url` — Ollama server URL (default: `http://localhost:11434`).
- `zen.project.tidy.ollama.model` — model name (default: `llama3.2`).
- `zen.project.tidy.ollama.key` — API key (optional). Only needed if you secured Ollama with `OLLAMA_API_KEY` or run it behind a reverse proxy that requires a `Bearer` token.

When enabled, tabs that don't confidently match locally are sent to the selected provider in **one batched request**. The result is cached by hostname+title, so the same tab only costs an API call once. If the AI request fails or is disabled, the mod falls back to the local score or skips the tab.

## Limitations

- Normal sort works on the current workspace only; cross-workspace discovery requires an AI provider.
- Zen folders require a recent Zen build with folder support.
- Matching quality depends on the keywords/examples you provide.
- Gemini fallback requires an internet connection and a Google API key; Ollama runs locally.

## License

MIT
