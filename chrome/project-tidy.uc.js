// ==UserScript==
// @name          Zen Project Tidy
// @description   Sort tabs into user-defined project folders with local-first matching and optional AI fallback (Gemini or Ollama).
// @ignorecache
// ==/UserScript==

(() => {
  "use strict";
  try {

  const PREF_ENABLED = "zen.project.tidy.enabled";
  const PREF_SHOW_BUTTON = "zen.project.tidy.showButton";
  const PREF_LEARNING = "zen.project.tidy.learning";
  const PREF_THRESHOLD = "zen.project.tidy.threshold";
  const PREF_PROJECTS = "zen.project.tidy.projects";
  const PREF_HISTORY = "zen.project.tidy.history";
  const PREF_OUTPUT_MODE = "zen.project.tidy.outputMode";
  const PREF_GEMINI_ENABLED = "zen.project.tidy.gemini.enabled";
  const PREF_GEMINI_KEY = "zen.project.tidy.gemini.key";
  const PREF_GEMINI_MODEL = "zen.project.tidy.gemini.model";
  const PREF_GEMINI_CACHE = "zen.project.tidy.gemini.cache";

  const PREF_AI_PROVIDER = "zen.project.tidy.ai.provider";
  const PREF_OLLAMA_URL = "zen.project.tidy.ollama.url";
  const PREF_OLLAMA_MODEL = "zen.project.tidy.ollama.model";
  const PREF_OLLAMA_KEY = "zen.project.tidy.ollama.key";

  const MAX_GEMINI_CACHE = 300;

  const DEFAULT_PROJECTS = {
    selfhosting: {
      keywords: "proxmox truenas pfsense homelab selfhosted server vm docker",
      domains: ["reddit.com/r/selfhosted", "reddit.com/r/homelab"],
      color: "#ff8844",
    },
    "obsidian portfolio": {
      keywords: "obsidian markdown portfolio website cv resume",
      domains: [],
      color: "#4488ff",
    },
  };

  const STOP_WORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
    "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man",
    "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let",
    "put", "say", "she", "too", "use", "with", "have", "this", "will", "your",
    "from", "they", "know", "want", "been", "good", "much", "some", "time", "very",
    "when", "come", "here", "just", "like", "long", "make", "many", "over", "such",
    "take", "than", "them", "well", "were", "what", "www", "com", "org", "net",
    "http", "https", "html", "php", "asp", "jsp",
  ]);

  // ---------------------------------------------------------------------------
  // Preferences helpers
  // ---------------------------------------------------------------------------

  function getBoolPref(key, def) {
    try {
      return Services.prefs.getBoolPref(key);
    } catch {
      return def;
    }
  }

  function getIntPref(key, def) {
    try {
      return Services.prefs.getIntPref(key);
    } catch {
      return def;
    }
  }

  function getCharPref(key, def) {
    try {
      return Services.prefs.getStringPref(key);
    } catch {
      return def;
    }
  }

  function setCharPref(key, value) {
    try {
      Services.prefs.setStringPref(key, value);
    } catch (e) {
      console.error(`[ZenProjectTidy] Failed to set pref ${key}:`, e);
    }
  }

  function clone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  function loadProjects() {
    const raw = getCharPref(PREF_PROJECTS, "");
    if (!raw) return clone(DEFAULT_PROJECTS);
    try {
      const parsed = JSON.parse(raw);
      return Object.keys(parsed).length ? parsed : clone(DEFAULT_PROJECTS);
    } catch (e) {
      console.error("[ZenProjectTidy] Failed to parse projects pref:", e);
      return clone(DEFAULT_PROJECTS);
    }
  }

  function saveProjects(projects) {
    setCharPref(PREF_PROJECTS, JSON.stringify(projects));
  }

  function loadHistory() {
    const raw = getCharPref(PREF_HISTORY, "{}");
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function saveHistory(history) {
    setCharPref(PREF_HISTORY, JSON.stringify(history));
  }

  function loadGeminiCache() {
    const raw = getCharPref(PREF_GEMINI_CACHE, "{}");
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function saveGeminiCache(cache) {
    const keys = Object.keys(cache);
    if (keys.length > MAX_GEMINI_CACHE) {
      const toRemove = keys.length - MAX_GEMINI_CACHE;
      for (let i = 0; i < toRemove; i++) {
        delete cache[keys[i]];
      }
    }
    setCharPref(PREF_GEMINI_CACHE, JSON.stringify(cache));
  }

  function cacheKey(tab) {
    try {
      const u = new URL(getTabUrl(tab));
      const host = u.hostname.toLowerCase();
      const title = getTabTitle(tab)
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return `${host}|${title.slice(0, 80)}`;
    } catch {
      return getTabTitle(tab).toLowerCase().trim().slice(0, 80) || "unknown";
    }
  }

  // ---------------------------------------------------------------------------
  // Text utilities
  // ---------------------------------------------------------------------------

  function tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  function buildDocument(tab) {
    const title = getTabTitle(tab);
    const url = getTabUrl(tab);
    let urlText = "";
    try {
      const u = new URL(url);
      urlText = `${u.hostname} ${u.pathname} ${u.searchParams.toString()}`;
    } catch {}
    return `${title} ${urlText}`;
  }

  function termFrequency(tokens) {
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    return freq;
  }

  function tokenizeAndTf(docs) {
    return docs.map((doc) => {
      const tokens = tokenize(doc);
      return { tokens, tf: termFrequency(tokens) };
    });
  }

  function computeTfIdfVectors(tokenizedDocs) {
    const docCount = tokenizedDocs.length || 1;
    const df = {};
    for (const { tokens } of tokenizedDocs) {
      for (const t of new Set(tokens)) {
        df[t] = (df[t] || 0) + 1;
      }
    }
    const idf = {};
    for (const t of Object.keys(df)) {
      idf[t] = Math.log(docCount / df[t]);
    }
    return tokenizedDocs.map(({ tf }) => {
      const vec = {};
      for (const t of Object.keys(idf)) {
        const v = (tf[t] || 0) * idf[t];
        if (v !== 0) vec[t] = v;
      }
      return vec;
    });
  }

  function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const terms = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const t of terms) {
      const av = a[t] || 0;
      const bv = b[t] || 0;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ---------------------------------------------------------------------------
  // Tab helpers
  // ---------------------------------------------------------------------------

  function getTabTitle(tab) {
    if (!tab?.isConnected) return "";
    try {
      return (
        tab.getAttribute("label") ||
        tab.querySelector(".tab-label, .tab-text")?.textContent ||
        ""
      ).trim();
    } catch {
      return "";
    }
  }

  function getTabUrl(tab) {
    if (!tab?.isConnected) return "";
    try {
      const browser =
        tab.linkedBrowser || tab._linkedBrowser || gBrowser?.getBrowserForTab?.(tab);
      return browser?.currentURI?.spec || "";
    } catch {
      return "";
    }
  }

  function getWorkspaceId(tab) {
    return tab?.getAttribute?.("zen-workspace-id") || gZenWorkspaces?.activeWorkspace || "";
  }

  function getSortableTabs(workspaceId) {
    if (!gBrowser?.tabs) return [];
    return Array.from(gBrowser.tabs).filter((tab) => {
      if (!tab?.isConnected) return false;
      if (tab.pinned) return false;
      if (tab.hasAttribute("zen-empty-tab")) return false;
      if (tab.hasAttribute("zen-glance-tab")) return false;
      if (tab.hasAttribute("zen-essential")) return false;
      if (getWorkspaceId(tab) !== workspaceId) return false;
      return true;
    });
  }

  function getAllWorkspaceIds() {
    if (!gBrowser?.tabs) return [];
    const ids = new Set();
    for (const tab of gBrowser.tabs) {
      const ws = getWorkspaceId(tab);
      if (ws) ids.add(ws);
    }
    return Array.from(ids);
  }

  function exportTabs() {
    const workspaceIds = getAllWorkspaceIds();
    const out = [];
    for (const ws of workspaceIds) {
      const tabs = getSortableTabs(ws);
      if (!tabs.length) continue;
      out.push(`Workspace: ${ws}`);
      for (const tab of tabs) {
        const title = getTabTitle(tab);
        const url = getTabUrl(tab);
        if (!title && !url) continue;
        out.push(`- ${title || "(no title)"} | ${url || "(no url)"}`);
      }
    }
    const text = out.join("\n");
    console.log("[ZenProjectTidy] Tab list:\n" + text);
    try {
      const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
      clip.copyString(text);
      showToast("Tab list copied to clipboard");
    } catch (e) {
      showToast("Tab list logged to console");
    }
    return text;
  }

  function buildProjectDocument(name, cfg, history) {
    const parts = [name, cfg.keywords || ""];
    if (cfg.domains?.length) parts.push(cfg.domains.join(" "));

    const hist = history[name];
    if (hist?.positives?.length) {
      parts.push(...hist.positives.slice(-10));
    }

    return parts.join(" ");
  }

  function extractKeywordSet(projects) {
    const map = {};
    for (const [name, cfg] of Object.entries(projects)) {
      const set = new Set();
      for (const src of [name, cfg.keywords || ""]) {
        for (const t of tokenize(src)) set.add(t);
      }
      map[name] = set;
    }
    return map;
  }

  function scoreAllTabs(tabs, projects, history) {
    const projectEntries = Object.entries(projects);
    const projectDocs = projectEntries.map(([name, cfg]) =>
      buildProjectDocument(name, cfg, history)
    );
    const tabDocs = tabs.map(buildDocument);
    const allDocs = [...projectDocs, ...tabDocs];
    const allVectors = computeTfIdfVectors(tokenizeAndTf(allDocs));
    const projectVectors = allVectors.slice(0, projectDocs.length);
    const tabVectors = allVectors.slice(projectDocs.length);

    const keywordSets = extractKeywordSet(projects);
    const projectNames = projectEntries.map(([name]) => name);
    const results = new Map();

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabVec = tabVectors[i];
      const tabDoc = tabDocs[i];
      const tabTokens = new Set(tokenize(tabDoc));
      const url = getTabUrl(tab).toLowerCase();
      const scores = [];

      for (let p = 0; p < projectVectors.length; p++) {
        const name = projectNames[p];
        const vec = projectVectors[p];
        let score = cosineSimilarity(tabVec, vec);

        // Boost literal keyword matches in title/URL
        const keywords = keywordSets[name];
        let keywordHits = 0;
        for (const kw of keywords) {
          if (tabTokens.has(kw) || url.includes(kw)) keywordHits++;
        }
        score += Math.min(keywordHits * 0.25, 0.75);

        // Boost exact domain/path matches
        const domains = projects[name].domains || [];
        for (const d of domains) {
          const dl = d.toLowerCase();
          if (url.includes(dl)) score += 0.45;
          else if (dl.includes("/") && url.includes(dl.split("/")[0])) score += 0.12;
        }

        // Penalize negative examples
        const negatives = history[name]?.negatives || [];
        for (const neg of negatives) {
          const negTokens = new Set(tokenize(neg));
          let overlap = 0;
          for (const t of tabTokens) if (negTokens.has(t)) overlap++;
          if (overlap >= 2) score -= 0.2;
          else if (overlap === 1) score -= 0.08;
        }

        scores.push({ name, score });
      }

      scores.sort((a, b) => b.score - a.score);
      results.set(tab, scores);
    }

    return results;
  }

  function getAiProvider() {
    return getCharPref(PREF_AI_PROVIDER, "gemini");
  }

  function aiFallbackEnabled() {
    return getBoolPref(PREF_GEMINI_ENABLED, false);
  }

  function buildClassifyPrompt(tabs, projectNames) {
    const lines = tabs.map((tab, i) => {
      const title = getTabTitle(tab).replace(/\s+/g, " ").trim();
      const url = getTabUrl(tab);
      return `${i}: ${title} | ${url}`;
    });
    return `Classify each browser tab into exactly one of these projects: ${projectNames.join(", ")}.
Use the title and URL. Respond with a JSON object mapping each number to a project name, or an empty string if no project fits.

Tabs:
${lines.join("\n")}`;
  }

  function buildClassifySchema(count) {
    const schema = {
      type: "object",
      description:
        "Maps each tab index to the best matching project name, or an empty string if none match.",
      properties: {},
      required: [],
    };
    for (let i = 0; i < count; i++) {
      schema.properties[String(i)] = { type: "string", nullable: true };
      schema.required.push(String(i));
    }
    return schema;
  }

  function parseClassifyResponse(text, tabs, projectNames) {
    const parsed = JSON.parse(text);
    const map = new Map();
    for (const [idxStr, name] of Object.entries(parsed)) {
      const idx = parseInt(idxStr, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= tabs.length) continue;
      if (name && projectNames.includes(String(name))) {
        map.set(tabs[idx], String(name));
      } else {
        map.set(tabs[idx], null);
      }
    }
    return map;
  }

  function postJson(target, payload, timeoutMs = 60000, headers = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", target, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.timeout = timeoutMs;
      xhr.ontimeout = () => reject(new Error("AI request timed out"));
      xhr.onerror = () => reject(new Error(`AI request failed: ${xhr.statusText || "network error"}`));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(`AI HTTP ${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.send(payload);
    });
  }

  async function geminiClassifyTabs(tabs, projects) {
    const apiKey = getCharPref(PREF_GEMINI_KEY, "").trim();
    if (!apiKey) throw new Error("No Gemini API key configured");

    const model = getCharPref(PREF_GEMINI_MODEL, "gemini-3.6-flash");
    const projectNames = Object.keys(projects);
    if (!projectNames.length || !tabs.length) return new Map();

    const BATCH_SIZE = 25;
    const results = new Map();

    for (let start = 0; start < tabs.length; start += BATCH_SIZE) {
      const batch = tabs.slice(start, start + BATCH_SIZE);
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: buildClassifyPrompt(batch, projectNames) }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: buildClassifySchema(batch.length),
          temperature: 0.1,
        },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const batchResults = await aiClassifyWithRetry(url, body, "Gemini", batch, projectNames);
      for (const [tab, project] of batchResults.entries()) {
        results.set(tab, project);
      }
    }

    return results;
  }

  function getOllamaHeaders() {
    const key = getCharPref(PREF_OLLAMA_KEY, "").trim();
    if (!key) return {};
    return { Authorization: `Bearer ${key}` };
  }

  async function ollamaClassifyTabs(tabs, projects) {
    const baseUrl = getCharPref(PREF_OLLAMA_URL, "http://localhost:11434").replace(/\/$/, "");
    const model = getCharPref(PREF_OLLAMA_MODEL, "llama3.2");
    const projectNames = Object.keys(projects);
    if (!projectNames.length || !tabs.length) return new Map();

    const BATCH_SIZE = 25;
    const results = new Map();
    const headers = getOllamaHeaders();

    for (let start = 0; start < tabs.length; start += BATCH_SIZE) {
      const batch = tabs.slice(start, start + BATCH_SIZE);
      const prompt = `${buildClassifyPrompt(batch, projectNames)}

Respond with JSON only, using this exact shape: { "0": "projectName", "1": "", ... }`;
      const body = {
        model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.1 },
      };
      const url = `${baseUrl}/api/generate`;
      const batchResults = await aiClassifyWithRetry(url, body, "Ollama", batch, projectNames, (data) => {
        return data.response || data.message?.content || "";
      }, headers);
      for (const [tab, project] of batchResults.entries()) {
        results.set(tab, project);
      }
    }

    return results;
  }

  async function aiClassifyWithRetry(url, body, label, tabs, projectNames, extractText, headers) {
    const defaultExtract = (data) => {
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    };
    const extract = extractText || defaultExtract;

    let lastError;
    let text;
    const payload = JSON.stringify(body);
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await postJson(url, payload, 60000, headers);
        const data = JSON.parse(response);
        text = extract(data);
        if (!text) throw new Error(`${label} returned no content`);
        break;
      } catch (e) {
        lastError = e;
        const msg = e.message || "";
        const isRetryable = msg.includes("timed out") || msg.includes("503") || msg.includes("429") || msg.includes("network error");
        if (isRetryable && attempt < 2) {
          const delay = msg.includes("429") ? 15000 : 2000 * (attempt + 1);
          console.warn(`[ZenProjectTidy] ${label} ${msg}, retrying in ${delay}ms (${attempt + 1}/2)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    if (!text) throw lastError || new Error(`${label} request failed`);
    return parseClassifyResponse(text, tabs, projectNames);
  }

  async function aiClassifyTabs(tabs, projects) {
    const provider = getAiProvider();
    if (provider === "ollama") {
      return ollamaClassifyTabs(tabs, projects);
    }
    return geminiClassifyTabs(tabs, projects);
  }

  // ---------------------------------------------------------------------------
  // Folder / group management
  // ---------------------------------------------------------------------------

  function findProjectFolder(name, workspaceId) {
    const folders = document.querySelectorAll("zen-folder");
    for (const folder of folders) {
      const label = folder.getAttribute("label") || folder.label;
      let ws = folder.getAttribute("zen-workspace-id");
      if (!ws) {
        const firstTab = folder.querySelector("tab");
        ws = firstTab ? getWorkspaceId(firstTab) : workspaceId;
      }
      if (label === name && ws === workspaceId) return folder;
    }
    return null;
  }

  function findProjectGroup(name, workspaceId) {
    const groups = document.querySelectorAll("tab-group");
    for (const group of groups) {
      const label = group.getAttribute("label") || group.label;
      let ws = group.getAttribute("zen-workspace-id");
      if (!ws) {
        const firstTab = group.querySelector("tab");
        ws = firstTab ? getWorkspaceId(firstTab) : workspaceId;
      }
      if (label === name && ws === workspaceId) return group;
    }
    return null;
  }

  function createZenFolder(name, workspaceId, color, tabs) {
    const tabList = Array.from(tabs || []);
    try {
      if (window.gZenFolders?.createFolder) {
        let folder;
        try {
          folder = gZenFolders.createFolder(name, workspaceId, tabList);
        } catch {
          // Some Zen builds don't accept a tab list argument; fall back to
          // creating an empty folder and moving tabs manually afterwards.
          folder = gZenFolders.createFolder(name, workspaceId);
        }
        if (folder) {
          if (color) folder.style.setProperty("--folder-color", color);
          return folder;
        }
      }
    } catch (e) {
      // gZenFolders isn't usable on this build; fall through to manual DOM creation.
    }

    // Manual fallback
    try {
      const folder = document.createXULElement?.("zen-folder") || document.createElement("zen-folder");
      folder.setAttribute("label", name);
      folder.setAttribute("zen-workspace-id", workspaceId);
      if (color) folder.style.setProperty("--folder-color", color);

      const container =
        document.querySelector(`#zen-tabs-list[zen-workspace-id="${workspaceId}"] .zen-workspace-pinned-tabs-section`) ||
        document.querySelector(`#zen-tabs-list .zen-workspace-pinned-tabs-section`) ||
        document.querySelector(`.zen-workspace-pinned-tabs-section`) ||
        document.querySelector(`#zen-tabs-list[zen-workspace-id="${workspaceId}"]`) ||
        document.getElementById("zen-tabs-list") ||
        document.getElementById("tabbrowser-tabs");
      if (container) {
        container.appendChild(folder);
        return folder;
      }
    } catch (e) {
      console.warn("[ZenProjectTidy] Manual folder creation failed:", e);
    }

    return null;
  }

  function createTabGroup(name, workspaceId, color, tabs) {
    try {
      // Some Zen builds require contiguous tabs and a non-empty array.
      if (tabs?.length) {
        const group = gBrowser.addTabGroup(tabs, { label: name });
        if (group) {
          group.setAttribute("zen-workspace-id", workspaceId);
          if (color) group.style.setProperty("--tab-group-color", color);
          return group;
        }
      }
    } catch (e) {
      console.warn("[ZenProjectTidy] addTabGroup failed:", e);
    }

    // Manual DOM fallback for builds where addTabGroup is unreliable.
    try {
      const group = document.createXULElement?.("tab-group") || document.createElement("tab-group");
      group.setAttribute("label", name);
      group.setAttribute("zen-workspace-id", workspaceId);
      if (color) group.style.setProperty("--tab-group-color", color);

      if (tabs?.length && tabs[0].parentNode) {
        const first = tabs[0];
        first.parentNode.insertBefore(group, first);
        for (const tab of tabs) {
          group.appendChild(tab);
        }
      }
      return group;
    } catch (e) {
      console.warn("[ZenProjectTidy] Manual group creation failed:", e);
    }

    return null;
  }

  async function pinTabAndMoveToFolder(tab, folder) {
    try {
      if (!tab.pinned) {
        gBrowser.pinTab(tab);
      }
      // Allow pin to settle
      await new Promise((r) => setTimeout(r, 50));

      if (folder.addTab && typeof folder.addTab === "function") {
        folder.addTab(tab);
      } else if (gZenFolders?.addTabToFolder) {
        gZenFolders.addTabToFolder(tab, folder);
      } else {
        // Move DOM manually
        const container = folder.querySelector(".zen-folder-tabs") || folder;
        container.appendChild(tab);
      }
      return true;
    } catch (e) {
      console.error("[ZenProjectTidy] Failed to move tab to folder:", e);
      return false;
    }
  }

  function moveTabToGroup(tab, group) {
    try {
      if (gBrowser.moveTabToExistingGroup) {
        gBrowser.moveTabToExistingGroup(tab, group);
      } else if (gBrowser.addTabToGroup) {
        gBrowser.addTabToGroup(tab, group);
      } else {
        group.appendChild(tab);
      }
      return true;
    } catch (e) {
      console.error("[ZenProjectTidy] Failed to move tab to group:", e);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sorting orchestration
  // ---------------------------------------------------------------------------

  async function sortTabs(options = {}) {
    try {
      const enabled = getBoolPref(PREF_ENABLED, true);
      if (!enabled) return { sorted: 0, skipped: 0, errors: 0 };

      const workspaceId = gZenWorkspaces?.activeWorkspace;
      if (!workspaceId) {
        showToast("No active workspace");
        return { sorted: 0, skipped: 0, errors: 0 };
      }

      const projects = loadProjects();
      const projectNames = Object.keys(projects);
      if (!projectNames.length) {
        showToast("No projects defined");
        return { sorted: 0, skipped: 0, errors: 0 };
      }

      const history = loadHistory();
      const threshold = getIntPref(PREF_THRESHOLD, 35) / 100;
      const outputMode = getCharPref(PREF_OUTPUT_MODE, "folders");
      const tabs = getSortableTabs(workspaceId);
      console.log(`[ZenProjectTidy] Found ${tabs.length} sortable tabs in workspace ${workspaceId}`);

      if (!tabs.length) {
        showToast("No tabs to sort");
        return { sorted: 0, skipped: 0, errors: 0 };
      }

      console.log("[ZenProjectTidy] Scoring tabs...");
      const localScores = scoreAllTabs(tabs, projects, history);
      console.log("[ZenProjectTidy] Scoring complete");

      const aiEnabled = aiFallbackEnabled();
      const geminiCache = loadGeminiCache();

      const plan = [];
      const ambiguousTabs = [];

      for (const tab of tabs) {
        const scores = localScores.get(tab);
        const best = scores?.[0];
        const second = scores?.[1];
        const margin = second ? best.score - second.score : 1;
        const confident = best && best.score >= threshold && margin >= 0.12;

        if (confident) {
          plan.push({ tab, project: best.name, score: best.score, source: "local" });
          continue;
        }

        const key = cacheKey(tab);
        if (geminiCache[key] !== undefined) {
          const cached = geminiCache[key];
          if (cached && projectNames.includes(cached)) {
            plan.push({ tab, project: cached, score: best?.score ?? 0, source: "cache" });
          }
          continue;
        }

        if (aiEnabled) {
          ambiguousTabs.push(tab);
        }
      }

      if (ambiguousTabs.length) {
        console.log(`[ZenProjectTidy] ${ambiguousTabs.length} ambiguous tabs; calling Gemini...`);
        try {
          const aiResults = await aiClassifyTabs(ambiguousTabs, projects);
          for (const [tab, project] of aiResults.entries()) {
            geminiCache[cacheKey(tab)] = project;
            if (project && projectNames.includes(project)) {
              plan.push({ tab, project, score: 0, source: "gemini" });
            }
          }
          saveGeminiCache(geminiCache);
        } catch (e) {
          console.error("[ZenProjectTidy] Gemini classification failed:", e);
          for (const tab of ambiguousTabs) {
            const scores = localScores.get(tab);
            const best = scores?.[0];
            if (best && best.score >= threshold * 0.6) {
              plan.push({ tab, project: best.name, score: best.score, source: "local-fallback" });
            }
          }
        }
      }

      console.log(
        `[ZenProjectTidy] Plan: ${plan.length} tabs, sources:`,
        plan.reduce((acc, item) => {
          acc[item.source] = (acc[item.source] || 0) + 1;
          return acc;
        }, {})
      );

      let sorted = 0;
      let skipped = tabs.length - plan.length;
      let errors = 0;

      const byProject = {};
      for (const item of plan) {
        byProject[item.project] = byProject[item.project] || [];
        byProject[item.project].push(item);
      }

      for (const [name, items] of Object.entries(byProject)) {
        const cfg = projects[name];
        let folder = null;
        let group = null;

        const tabs = items.map((i) => i.tab).filter(Boolean);

        if (outputMode === "folders") {
          folder = findProjectFolder(name, workspaceId);
          if (!folder) folder = createZenFolder(name, workspaceId, cfg.color, tabs);
          if (!folder) {
            // Fallback to group if folders aren't supported on this build
            group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, tabs);
          }
        } else {
          group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, tabs);
        }

        if (!folder && !group) {
          errors += items.length;
          continue;
        }

        for (const tab of tabs) {
          if (folder) {
            const ok = await pinTabAndMoveToFolder(tab, folder);
            if (ok) sorted++;
            else errors++;
          } else if (group) {
            // Tabs passed to addTabGroup are already inside; DOM fallback adds them all.
            if (group.contains(tab)) {
              sorted++;
              continue;
            }
            const ok = moveTabToGroup(tab, group);
            if (ok) sorted++;
            else errors++;
          }
        }
      }

      console.log(`[ZenProjectTidy] Result: sorted=${sorted}, skipped=${skipped}, errors=${errors}`);
      showToast(`Sorted ${sorted} tab${sorted === 1 ? "" : "s"} into projects`);
      return { sorted, skipped, errors };
    } catch (e) {
      console.error("[ZenProjectTidy] Unexpected sortTabs error:", e);
      showToast("Sort failed — check console");
      return { sorted: 0, skipped: 0, errors: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-workspace AI project discovery
  // ---------------------------------------------------------------------------

  function buildDiscoverPrompt(items) {
    const lines = items.map((item, i) => {
      const title = item.title.replace(/\s+/g, " ").trim();
      const url = item.url;
      return `${i}: ${title} | ${url}`;
    });
    return `Suggest up to 8 project categories for these browser tabs. Each category should have a short lowercase name, relevant keywords separated by spaces, an optional hex color, and the indices of tabs that belong to it.\n\nTabs:\n${lines.join("\n")}\n\nRespond with JSON only.`;
  }

  const DISCOVER_SCHEMA = {
    type: "object",
    description: "Suggested project categories for the given tabs.",
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            keywords: { type: "string" },
            color: { type: "string" },
            tabIndices: {
              type: "array",
              items: { type: "integer" },
            },
          },
          required: ["name", "keywords", "tabIndices"],
        },
      },
    },
    required: ["categories"],
  };

  function parseDiscoverResponse(text) {
    const parsed = JSON.parse(text);
    return (parsed.categories || []).filter((c) => c.name && Array.isArray(c.tabIndices));
  }

  async function geminiDiscoverCategories(items) {
    const apiKey = getCharPref(PREF_GEMINI_KEY, "").trim();
    if (!apiKey) throw new Error("No Gemini API key configured");

    const model = getCharPref(PREF_GEMINI_MODEL, "gemini-3.6-flash");
    const body = {
      contents: [{ role: "user", parts: [{ text: buildDiscoverPrompt(items) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: DISCOVER_SCHEMA,
        temperature: 0.2,
      },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let lastError;
    let text;
    const payload = JSON.stringify(body);
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await postJson(url, payload, 60000);
        const data = JSON.parse(response);
        text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini returned no content");
        break;
      } catch (e) {
        lastError = e;
        const isRetryable = e.message?.includes("timed out") || e.message?.includes("503") || e.message?.includes("network error");
        if (isRetryable && attempt < 2) {
          console.warn(`[ZenProjectTidy] Gemini ${e.message}, retrying (${attempt + 1}/2)...`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    if (!text) throw lastError || new Error("Gemini request failed");
    return parseDiscoverResponse(text);
  }

  async function ollamaDiscoverCategories(items) {
    const baseUrl = getCharPref(PREF_OLLAMA_URL, "http://localhost:11434").replace(/\/$/, "");
    const model = getCharPref(PREF_OLLAMA_MODEL, "llama3.2");
    const headers = getOllamaHeaders();
    const shape = '{ "categories": [{ "name": "...", "keywords": "...", "color": "#...", "tabIndices": [0,1,...] }] }';
    const prompt = `${buildDiscoverPrompt(items)}\n\nUse this exact JSON shape: ${shape}`;
    const body = {
      model,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.2 },
    };
    const url = `${baseUrl}/api/generate`;

    let lastError;
    let text;
    const payload = JSON.stringify(body);
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await postJson(url, payload, 60000, headers);
        const data = JSON.parse(response);
        text = data.response || data.message?.content || "";
        if (!text) throw new Error("Ollama returned no content");
        break;
      } catch (e) {
        lastError = e;
        const isRetryable = e.message?.includes("timed out") || e.message?.includes("503") || e.message?.includes("network error");
        if (isRetryable && attempt < 2) {
          console.warn(`[ZenProjectTidy] Ollama ${e.message}, retrying (${attempt + 1}/2)...`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    if (!text) throw lastError || new Error("Ollama request failed");
    return parseDiscoverResponse(text);
  }

  async function aiDiscoverCategories(items) {
    const provider = getAiProvider();
    if (provider === "ollama") {
      return ollamaDiscoverCategories(items);
    }
    return geminiDiscoverCategories(items);
  }

  async function moveTabsToProject(tabs, name, workspaceId, cfg) {
    const outputMode = getCharPref(PREF_OUTPUT_MODE, "folders");
    let folder = null;
    let group = null;

    if (outputMode === "folders") {
      folder = findProjectFolder(name, workspaceId);
      if (!folder) folder = createZenFolder(name, workspaceId, cfg.color, tabs);
      if (!folder) {
        group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, tabs);
      }
    } else {
      group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, tabs);
    }

    if (!folder && !group) {
      console.warn(`[ZenProjectTidy] Could not create folder/group for ${name}`);
      return 0;
    }

    let moved = 0;
    for (const tab of tabs) {
      if (folder) {
        const ok = await pinTabAndMoveToFolder(tab, folder);
        if (ok) moved++;
      } else if (group) {
        if (group.contains(tab)) {
          moved++;
          continue;
        }
        const ok = moveTabToGroup(tab, group);
        if (ok) moved++;
      }
    }
    return moved;
  }

  async function discoverProjects() {
    const provider = getAiProvider();
    if (provider === "ollama") {
      const url = getCharPref(PREF_OLLAMA_URL, "http://localhost:11434").trim();
      if (!url) {
        showToast("No Ollama URL configured");
        return { discovered: 0, sorted: 0 };
      }
    } else {
      const apiKey = getCharPref(PREF_GEMINI_KEY, "").trim();
      if (!apiKey) {
        showToast("No Gemini API key configured");
        return { discovered: 0, sorted: 0 };
      }
    }

    const workspaceIds = getAllWorkspaceIds();
    if (!workspaceIds.length) {
      showToast("No workspaces found");
      return { discovered: 0, sorted: 0 };
    }

    const items = [];
    for (const ws of workspaceIds) {
      for (const tab of getSortableTabs(ws)) {
        items.push({
          tab,
          workspaceId: ws,
          title: getTabTitle(tab),
          url: getTabUrl(tab),
        });
      }
    }

    if (!items.length) {
      showToast("No tabs to analyze");
      return { discovered: 0, sorted: 0 };
    }

    console.log(`[ZenProjectTidy] Analyzing ${items.length} tabs across ${workspaceIds.length} workspaces with ${provider}...`);

    let categories;
    try {
      categories = await aiDiscoverCategories(items);
    } catch (e) {
      console.error("[ZenProjectTidy] Project discovery failed:", e);
      showToast("Project discovery failed — check console");
      return { discovered: 0, sorted: 0 };
    }

    if (!categories.length) {
      showToast("No categories suggested");
      return { discovered: 0, sorted: 0 };
    }

    const names = categories.map((c) => c.name).join(", ");
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    if (!window.confirm(`${providerLabel} suggests these categories:\n${names}\n\nCreate them and sort tabs?`)) {
      showToast("Project discovery cancelled");
      return { discovered: 0, sorted: 0 };
    }

    const projects = loadProjects();
    for (const cat of categories) {
      if (!projects[cat.name]) {
        projects[cat.name] = {
          keywords: cat.keywords || "",
          domains: cat.domains || [],
          color: cat.color || "#888888",
        };
      }
    }
    saveProjects(projects);

    const byKey = {};
    for (const cat of categories) {
      for (const idx of cat.tabIndices) {
        const item = items[idx];
        if (!item) continue;
        const key = `${item.workspaceId}|${cat.name}`;
        byKey[key] = byKey[key] || [];
        byKey[key].push(item.tab);
      }
    }

    let totalSorted = 0;
    for (const [key, tabs] of Object.entries(byKey)) {
      const [workspaceId, name] = key.split("|");
      const cfg = projects[name];
      if (!cfg) continue;
      totalSorted += await moveTabsToProject(tabs, name, workspaceId, cfg);
    }

    console.log(`[ZenProjectTidy] Discovered ${categories.length} categories, moved ${totalSorted} tabs`);
    showToast(`Discovered ${categories.length} categories and sorted ${totalSorted} tabs`);
    return { discovered: categories.length, sorted: totalSorted };
  }

  // ---------------------------------------------------------------------------
  // Learning from corrections
  // ---------------------------------------------------------------------------

  function recordCorrection(tab, projectName, isPositive) {
    const learning = getBoolPref(PREF_LEARNING, true);
    if (!learning) return;

    const history = loadHistory();
    history[projectName] = history[projectName] || { positives: [], negatives: [] };
    const doc = buildDocument(tab);
    if (!doc.trim()) return;

    const list = isPositive ? history[projectName].positives : history[projectName].negatives;
    list.push(doc);
    // Keep last 20
    if (list.length > 20) list.shift();

    saveHistory(history);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function showToast(message) {
    let toast = document.getElementById("project-tidy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "project-tidy-toast";
      toast.className = "project-tidy-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2500);
  }

  function ensureButton(separator) {
    if (!separator || separator.querySelector(".project-tidy-button")) return;

    let button;
    const svg = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
      </svg>
    `;

    const tooltip = "Sort tabs into project folders (Shift+click to discover categories with Gemini)";

    if (window.MozXULElement?.parseXULToFragment) {
      try {
        const frag = window.MozXULElement.parseXULToFragment(`
          <toolbarbutton class="project-tidy-button" tooltiptext="${tooltip}">
            <hbox class="toolbarbutton-box" align="center" pack="center">
              ${svg}
            </hbox>
          </toolbarbutton>
        `);
        button = frag.firstChild;
      } catch (e) {
        console.warn("[ZenProjectTidy] XUL button parse failed:", e);
      }
    }

    if (!button) {
      button = document.createElement("button");
      button.className = "project-tidy-button";
      button.title = tooltip;
      button.innerHTML = svg;
    }

    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      button.classList.add("sorting");
      try {
        if (e.shiftKey) {
          await discoverProjects();
        } else {
          await sortTabs();
        }
      } finally {
        button.classList.remove("sorting");
      }
    });

    separator.appendChild(button);
  }

  function injectFallbackStyles() {
    if (document.getElementById("project-tidy-styles")) return;
    const style = document.createElement("style");
    style.id = "project-tidy-styles";
    style.textContent = `
      :root {
        --zen-project-tidy-button-size: 20px;
        --zen-project-tidy-button-opacity: 0.6;
        --zen-project-tidy-button-hover-opacity: 1;
      }
      .pinned-tabs-container-separator { position: relative; }
      .project-tidy-button {
        appearance: none;
        border: none;
        background: transparent;
        width: var(--zen-project-tidy-button-size);
        height: var(--zen-project-tidy-button-size);
        padding: 2px;
        margin: 0 4px;
        border-radius: var(--border-radius-small, 4px);
        cursor: pointer;
        opacity: var(--zen-project-tidy-button-opacity);
        transition: opacity 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .project-tidy-button:hover {
        opacity: var(--zen-project-tidy-button-hover-opacity);
        background-color: var(--zen-colors-hover, rgba(127, 127, 127, 0.2));
      }
      .project-tidy-button:active { transform: scale(0.92); }
      .project-tidy-button svg { width: 100%; height: 100%; fill: currentColor; pointer-events: none; }
      .project-tidy-button.sorting svg { animation: project-tidy-spin 0.8s ease-in-out infinite; }
      @keyframes project-tidy-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .project-tidy-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 10px 16px;
        border-radius: var(--border-radius-medium, 8px);
        background: var(--zen-colors-tertiary, #2a2a2a);
        color: var(--zen-colors-text, #fff);
        font-size: 13px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        z-index: 10000;
        opacity: 0;
        transform: translateY(12px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
      }
      .project-tidy-toast.visible { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);
  }

  function addButtonsToSeparators() {
    if (!getBoolPref(PREF_SHOW_BUTTON, true)) return;
    const separators = document.querySelectorAll(".pinned-tabs-container-separator");
    if (separators.length) {
      separators.forEach(ensureButton);
      return;
    }

    // Fallback for Zen builds where the divider class differs.
    const fallback =
      document.querySelector(".zen-workspace-tabs-section") ||
      document.getElementById("zen-tabs-list") ||
      document.getElementById("tabbrowser-tabs");
    if (fallback && !fallback.querySelector(".project-tidy-button")) {
      ensureButton(fallback);
    }
  }

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

  function injectContextMenu() {
    if (document.getElementById("project-tidy-context-menu")) return;

    const tabContextMenu =
      document.getElementById("tabContextMenu") ||
      document.getElementById("tab_context_menu") ||
      document.querySelector(".tab-context-menu");
    if (!tabContextMenu) return;

    const menu = document.createXULElement?.("menu") || document.createElement("menu");
    menu.id = "project-tidy-context-menu";
    menu.setAttribute("label", "Project Tidy");

    const popup = document.createXULElement?.("menupopup") || document.createElement("menupopup");
    popup.id = "project-tidy-context-popup";

    const sortItem = document.createXULElement?.("menuitem") || document.createElement("menuitem");
    sortItem.id = "project-tidy-context-sort";
    sortItem.setAttribute("label", "Sort tabs into projects");
    sortItem.addEventListener("command", async () => {
      await sortTabs();
    });

    const discoverItem = document.createXULElement?.("menuitem") || document.createElement("menuitem");
    discoverItem.id = "project-tidy-context-discover";
    discoverItem.setAttribute("label", "Discover categories with AI");
    discoverItem.addEventListener("command", async () => {
      await discoverProjects();
    });

    popup.appendChild(sortItem);
    popup.appendChild(discoverItem);
    menu.appendChild(popup);

    // Try to place the menu inside the existing layout after a known item so
    // MenuSectionLayout doesn't complain about unplaced children.
    const anchor =
      document.getElementById("context_reloadTab") ||
      document.getElementById("context_zenSplitTabs") ||
      document.getElementById("context_closeTab");
    if (anchor && anchor.nextSibling) {
      tabContextMenu.insertBefore(menu, anchor.nextSibling);
    } else {
      tabContextMenu.appendChild(menu);
    }
  }

  // ---------------------------------------------------------------------------
  // Observers & lifecycle
  // ---------------------------------------------------------------------------

  function waitForDependencies() {
    return new Promise((resolve) => {
      const needed = ["gBrowser", "gZenWorkspaces"];
      const check = () => needed.every((dep) => dep in window && window[dep] != null);
      if (check()) return resolve();

      const id = setInterval(() => {
        if (check()) {
          clearInterval(id);
          resolve();
        }
      }, 50);

      // Give up after 10s
      setTimeout(() => {
        clearInterval(id);
        resolve();
      }, 10000);
    });
  }

  async function init() {
    if (!getBoolPref(PREF_ENABLED, true)) return;
    await waitForDependencies();

    injectFallbackStyles();
    addButtonsToSeparators();
    injectContextMenu();

    const observer = new MutationObserver(() => {
      addButtonsToSeparators();
      injectContextMenu();
    });

    const tabsList = document.getElementById("zen-tabs-list");
    if (tabsList) {
      observer.observe(tabsList, { childList: true, subtree: true });
    } else {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Listen for workspace switches to refresh buttons
    const origSwitch = gZenWorkspaces?.switchToWorkspace;
    if (origSwitch) {
      gZenWorkspaces.switchToWorkspace = function (...args) {
        const result = origSwitch.apply(gZenWorkspaces, args);
        setTimeout(addButtonsToSeparators, 100);
        return result;
      };
    }

    console.log("[ZenProjectTidy] Initialized");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // Expose a minimal API for advanced users / debugging
  const tidyApi = {
    sortTabs,
    discoverProjects,
    exportTabs,
    loadProjects,
    saveProjects,
    loadHistory,
    saveHistory,
    recordCorrection,
  };
  window.ZenProjectTidy = tidyApi;
  try {
    const svc =
      (typeof Services !== "undefined" && Services) ||
      ChromeUtils.import("resource://gre/modules/Services.jsm").Services;
    const browserWin = svc.wm.getMostRecentWindow("navigator:browser");
    if (browserWin && browserWin !== window) {
      browserWin.ZenProjectTidy = tidyApi;
    }
  } catch (e) {
    console.warn("[ZenProjectTidy] Could not expose API to browser window:", e);
  }
  } catch (e) {
    console.error("[ZenProjectTidy] Fatal startup error:", e);
  }
})();
