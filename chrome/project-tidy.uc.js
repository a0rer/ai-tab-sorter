// ==UserScript==
// @name          Zen Project Tidy
// @description   Sort tabs into user-defined project folders with local matching. No AI runtime required.
// @ignorecache
// ==/UserScript==

(() => {
  "use strict";

  const PREF_ENABLED = "zen.project.tidy.enabled";
  const PREF_SHOW_BUTTON = "zen.project.tidy.showButton";
  const PREF_LEARNING = "zen.project.tidy.learning";
  const PREF_THRESHOLD = "zen.project.tidy.threshold";
  const PREF_PROJECTS = "zen.project.tidy.projects";
  const PREF_HISTORY = "zen.project.tidy.history";
  const PREF_OUTPUT_MODE = "zen.project.tidy.outputMode";

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

  function computeTfIdf(docs) {
    const docCount = docs.length;
    const idf = {};
    const tfDocs = docs.map((doc) => {
      const tokens = tokenize(doc);
      return { tokens, tf: termFrequency(tokens) };
    });

    const allTerms = new Set();
    for (const { tokens } of tfDocs) {
      for (const t of new Set(tokens)) {
        allTerms.add(t);
        idf[t] = (idf[t] || 0) + 1;
      }
    }

    for (const t of allTerms) {
      idf[t] = Math.log(docCount / (idf[t] || 1));
    }

    return tfDocs.map(({ tf }) => {
      const vec = {};
      for (const t of allTerms) {
        vec[t] = (tf[t] || 0) * (idf[t] || 0);
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

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

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

  function precomputeProjectVectors(projects, history) {
    const docs = [];
    const names = [];
    for (const [name, cfg] of Object.entries(projects)) {
      docs.push(buildProjectDocument(name, cfg, history));
      names.push(name);
    }
    const vectors = computeTfIdf(docs);
    return names.map((name, i) => ({ name, vector: vectors[i] }));
  }

  function scoreTab(tab, projectVectors, projects, history) {
    const tabDoc = buildDocument(tab);
    const tabVec = computeTfIdf([tabDoc])[0];
    const url = getTabUrl(tab).toLowerCase();
    const tabTokens = new Set(tokenize(tabDoc));
    const keywordSets = extractKeywordSet(projects);

    const scores = [];
    for (const { name, vector } of projectVectors) {
      let score = cosineSimilarity(tabVec, vector);

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
    return scores;
  }

  function findBestProject(tab, projectVectors, projects, history, threshold) {
    const scores = scoreTab(tab, projectVectors, projects, history);
    if (!scores.length) return null;
    const best = scores[0];
    if (best.score < threshold) return null;
    return best;
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

  function createZenFolder(name, workspaceId, color) {
    try {
      if (window.gZenFolders?.createFolder) {
        const folder = gZenFolders.createFolder(name, workspaceId);
        if (folder) {
          if (color) folder.style.setProperty("--folder-color", color);
          return folder;
        }
      }
    } catch (e) {
      console.warn("[ZenProjectTidy] gZenFolders.createFolder failed:", e);
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
        document.querySelector(`#zen-tabs-list[zen-workspace-id="${workspaceId}"]`);
      if (container) {
        container.appendChild(folder);
        return folder;
      }
    } catch (e) {
      console.warn("[ZenProjectTidy] Manual folder creation failed:", e);
    }

    return null;
  }

  function createTabGroup(name, workspaceId, color, firstTab) {
    try {
      // Zen's addTabGroup needs at least one tab to know where to insert the group.
      const tabs = firstTab ? [firstTab] : [];
      const group = gBrowser.addTabGroup(tabs, { label: name });
      if (group) {
        group.setAttribute("zen-workspace-id", workspaceId);
        if (color) group.style.setProperty("--tab-group-color", color);
        return group;
      }
    } catch (e) {
      console.warn("[ZenProjectTidy] addTabGroup failed:", e);
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

    if (!tabs.length) {
      showToast("No tabs to sort");
      return { sorted: 0, skipped: 0, errors: 0 };
    }

    const projectVectors = precomputeProjectVectors(projects, history);
    const plan = [];
    for (const tab of tabs) {
      const best = findBestProject(tab, projectVectors, projects, history, threshold);
      if (best) {
        plan.push({ tab, project: best.name, score: best.score });
      }
    }

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

      const firstTab = items[0]?.tab;

      if (outputMode === "folders") {
        folder = findProjectFolder(name, workspaceId);
        if (!folder) folder = createZenFolder(name, workspaceId, cfg.color);
        if (!folder) {
          // Fallback to group if folders aren't supported on this build
          group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, firstTab);
        }
      } else {
        group = findProjectGroup(name, workspaceId) || createTabGroup(name, workspaceId, cfg.color, firstTab);
      }

      if (!folder && !group) {
        errors += items.length;
        continue;
      }

      for (const { tab } of items) {
        if (folder) {
          const ok = await pinTabAndMoveToFolder(tab, folder);
          if (ok) sorted++;
          else errors++;
        } else if (group) {
          // First tab is already in the newly created group
          if (tab === firstTab && group.contains(tab)) {
            sorted++;
            continue;
          }
          const ok = moveTabToGroup(tab, group);
          if (ok) sorted++;
          else errors++;
        }
      }
    }

    showToast(`Sorted ${sorted} tab${sorted === 1 ? "" : "s"} into projects`);
    return { sorted, skipped, errors };
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

    if (window.MozXULElement?.parseXULToFragment) {
      try {
        const frag = window.MozXULElement.parseXULToFragment(`
          <toolbarbutton class="project-tidy-button" tooltiptext="Sort tabs into project folders">
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
      button.title = "Sort tabs into project folders";
      button.innerHTML = svg;
    }

    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      button.classList.add("sorting");
      try {
        await sortTabs();
      } finally {
        button.classList.remove("sorting");
      }
    });

    separator.appendChild(button);
  }

  function addButtonsToSeparators() {
    if (!getBoolPref(PREF_SHOW_BUTTON, true)) return;
    const separators = document.querySelectorAll(".pinned-tabs-container-separator");
    separators.forEach(ensureButton);
  }

  // ---------------------------------------------------------------------------
  // Observers & lifecycle
  // ---------------------------------------------------------------------------

  function waitForDependencies() {
    return new Promise((resolve) => {
      const needed = ["gBrowser", "gZenWorkspaces"];
      const check = () => needed.every((dep) => window.hasOwnProperty(dep));
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

    addButtonsToSeparators();

    const observer = new MutationObserver(() => {
      addButtonsToSeparators();
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
  window.ZenProjectTidy = {
    sortTabs,
    loadProjects,
    saveProjects,
    loadHistory,
    saveHistory,
    recordCorrection,
  };
})();
