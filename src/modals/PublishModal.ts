import {
  App,
  Modal,
  Setting,
  Notice,
  TFile,
  TextAreaComponent,
  DropdownComponent,
} from "obsidian";
import type VaultHubPlugin from "../main";
import { DetectedPlugin, detectPlugins } from "../detection";
import { GitHubAPI } from "../github";
import { generateHubMd, HubMdData } from "../hubmd";
import { generateReadme, ReadmeData, syncReadmeScreenshots } from "../readme";
import type { PublishDraft } from "../settings";

type ResourceType = "snippet" | "note" | "bundle";
type PublishedType = "snippet" | "note" | "vault";

interface PublishFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  read: () => Promise<string>;
  readBinary?: () => Promise<ArrayBuffer>;
}

interface AttachedSnippetFile {
  localPath: string;
  repoPath: string;
  name: string;
  optional?: boolean;
  read: () => Promise<string>;
}

interface ScreenshotFile {
  localPath: string;
  repoPath: string;
  name: string;
  readBinary: () => Promise<ArrayBuffer>;
}

function tfileToPublishFile(app: App, f: TFile): PublishFile {
  return {
    path: f.path,
    name: f.name,
    extension: f.extension,
    size: f.stat.size,
    read: () => app.vault.read(f),
    readBinary: () => app.vault.adapter.readBinary(f.path),
  };
}

async function listSnippetFiles(app: App): Promise<PublishFile[]> {
  const adapter = app.vault.adapter;
  const dir = ".obsidian/snippets";
  try {
    const exists = await adapter.exists(dir);
    if (!exists) return [];
    const { files } = await adapter.list(dir);
    const cssFiles = files.filter((p) => p.toLowerCase().endsWith(".css"));
    return Promise.all(
      cssFiles.map(async (path) => {
        const name = path.split("/").pop() || path;
        let size = 0;
        try {
          const stat = await adapter.stat(path);
          size = stat?.size ?? 0;
        } catch {
          // ignore stat errors
        }
        return {
          path,
          name,
          extension: "css",
          size,
          read: () => adapter.read(path),
          readBinary: () => adapter.readBinary(path),
        };
      })
    );
  } catch {
    return [];
  }
}

async function listImageFiles(app: App): Promise<PublishFile[]> {
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  return app.vault
    .getFiles()
    .filter((f: TFile) => imageExts.has(f.extension.toLowerCase()))
    .sort((a: TFile, b: TFile) => a.path.localeCompare(b.path))
    .map((f) => tfileToPublishFile(app, f));
}

function toBase64(data: ArrayBuffer): string {
  return Buffer.from(data).toString("base64");
}

const CATEGORIES: Record<string, string[]> = {
  snippet: [
    "ui-tweak", "layout", "typography", "colors",
    "editor", "sidebar", "dashboard", "starter",
  ],
  note: [
    "dashboard", "tracker", "query", "daily-note",
    "project-template", "kanban", "book-notes", "habit-tracker",
  ],
  bundle: [
    "starter", "student", "developer", "writer",
    "researcher", "pkm", "project-management", "worldbuilding",
    "journaling", "dashboard", "tracker", "finance",
  ],
};

export class PublishModal extends Modal {
  plugin: VaultHubPlugin;
  step = 1;

  // Step 1
  resourceType: ResourceType = "snippet";
  selectedFiles: PublishFile[] = [];
  selectedAttachedSnippets: PublishFile[] = [];
  selectedScreenshots: PublishFile[] = [];
  externalScreenshotUrls = "";
  fileSearchQuery = "";
  attachedSnippetSearchQuery = "";
  screenshotSearchQuery = "";

  // Step 2
  allPlugins: DetectedPlugin[] = [];
  checkedPlugins: Set<string> = new Set();

  // Step 3
  name = "";
  tagline = "";
  description = "";
  categories: string[] = [];
  tags = "";
  compatibleThemes: string[] = [];

  // Step 4
  readmeContent = "";
  private pendingSelectedFilePaths: string[] | null = null;
  private pendingAttachedSnippetPaths: string[] | null = null;
  private pendingScreenshotPaths: string[] | null = null;
  private restoredDraft = false;
  private preserveDraftOnClose = true;

  constructor(app: App, plugin: VaultHubPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Loading publish draft...", cls: "vault-hub-hint" });
    void this.initialize();
  }

  onClose() {
    if (this.preserveDraftOnClose) {
      void this.persistDraftOnClose();
    }
    this.contentEl.empty();
  }

  private getPublishedType(): PublishedType {
    if (this.resourceType === "snippet") return "snippet";
    if (this.resourceType === "bundle") return "vault";
    return "note";
  }

  private async initialize() {
    this.restoreDraft();
    await this.hydrateDraftSelections();
    this.renderStep();
  }

  private restoreDraft() {
    const draft = this.plugin.settings.publishDraft;
    if (!draft) return;

    this.step = Math.min(Math.max(draft.step || 1, 1), 5);
    this.resourceType = draft.resourceType || "snippet";
    this.pendingSelectedFilePaths = [...(draft.selectedFilePaths || [])];
    this.pendingAttachedSnippetPaths = [...(draft.attachedSnippetPaths || [])];
    this.pendingScreenshotPaths = [...(draft.screenshotPaths || [])];
    this.externalScreenshotUrls = draft.externalScreenshotUrls || "";
    this.fileSearchQuery = draft.fileSearchQuery || "";
    this.attachedSnippetSearchQuery = draft.attachedSnippetSearchQuery || "";
    this.screenshotSearchQuery = draft.screenshotSearchQuery || "";
    this.checkedPlugins = new Set(draft.checkedPluginIds || []);
    this.name = draft.name || "";
    this.tagline = draft.tagline || "";
    this.description = draft.description || "";
    this.categories = [...(draft.categories || [])];
    this.tags = draft.tags || "";
    this.compatibleThemes = [...(draft.compatibleThemes || [])];
    this.readmeContent = draft.readmeContent || "";
    this.restoredDraft = true;
  }

  private async persistDraftOnClose() {
    if (!this.hasDraftContent()) {
      if (this.plugin.settings.publishDraft) {
        this.plugin.settings.publishDraft = null;
        await this.plugin.saveSettings();
      }
      return;
    }
    await this.saveDraft();
  }

  private async hydrateDraftSelections() {
    if (this.pendingSelectedFilePaths) {
      const files = await this.collectCandidateFiles();
      this.restoreSelectionFromPaths(files, this.pendingSelectedFilePaths, (restored) => {
        this.selectedFiles = restored;
        this.pendingSelectedFilePaths = null;
      });
    }

    if (this.resourceType === "note" && this.pendingAttachedSnippetPaths) {
      const snippetFiles = await listSnippetFiles(this.app);
      this.restoreSelectionFromPaths(
        snippetFiles,
        this.pendingAttachedSnippetPaths,
        (restored) => {
          this.selectedAttachedSnippets = restored;
          this.pendingAttachedSnippetPaths = null;
        }
      );
    }

    if (this.pendingScreenshotPaths) {
      const imageFiles = await listImageFiles(this.app);
      this.restoreSelectionFromPaths(imageFiles, this.pendingScreenshotPaths, (restored) => {
        this.selectedScreenshots = restored;
        this.pendingScreenshotPaths = null;
      });
    }
  }

  private hasDraftContent(): boolean {
    return (
      this.step > 1 ||
      this.selectedFiles.length > 0 ||
      this.selectedAttachedSnippets.length > 0 ||
      this.selectedScreenshots.length > 0 ||
      (this.pendingSelectedFilePaths?.length || 0) > 0 ||
      (this.pendingAttachedSnippetPaths?.length || 0) > 0 ||
      (this.pendingScreenshotPaths?.length || 0) > 0 ||
      this.externalScreenshotUrls.trim().length > 0 ||
      this.name.trim().length > 0 ||
      this.tagline.trim().length > 0 ||
      this.description.trim().length > 0 ||
      this.categories.length > 0 ||
      this.tags.trim().length > 0 ||
      this.compatibleThemes.length > 0 ||
      this.readmeContent.trim().length > 0
    );
  }

  private buildDraft(): PublishDraft {
    return {
      step: this.step,
      resourceType: this.resourceType,
      selectedFilePaths: this.selectedFiles.length > 0
        ? this.selectedFiles.map((file) => file.path)
        : [...(this.pendingSelectedFilePaths || [])],
      attachedSnippetPaths: this.selectedAttachedSnippets.length > 0
        ? this.selectedAttachedSnippets.map((file) => file.path)
        : [...(this.pendingAttachedSnippetPaths || [])],
      screenshotPaths: this.selectedScreenshots.length > 0
        ? this.selectedScreenshots.map((file) => file.path)
        : [...(this.pendingScreenshotPaths || [])],
      externalScreenshotUrls: this.externalScreenshotUrls,
      fileSearchQuery: this.fileSearchQuery,
      attachedSnippetSearchQuery: this.attachedSnippetSearchQuery,
      screenshotSearchQuery: this.screenshotSearchQuery,
      checkedPluginIds: [...this.checkedPlugins],
      name: this.name,
      tagline: this.tagline,
      description: this.description,
      categories: [...this.categories],
      tags: this.tags,
      compatibleThemes: [...this.compatibleThemes],
      readmeContent: this.readmeContent,
    };
  }

  private async saveDraft() {
    this.plugin.settings.publishDraft = this.buildDraft();
    await this.plugin.saveSettings();
  }

  private async discardDraft() {
    this.plugin.settings.publishDraft = null;
    await this.plugin.saveSettings();
  }

  private resetState() {
    this.step = 1;
    this.resourceType = "snippet";
    this.selectedFiles = [];
    this.selectedAttachedSnippets = [];
    this.selectedScreenshots = [];
    this.externalScreenshotUrls = "";
    this.fileSearchQuery = "";
    this.attachedSnippetSearchQuery = "";
    this.screenshotSearchQuery = "";
    this.allPlugins = [];
    this.checkedPlugins = new Set();
    this.name = "";
    this.tagline = "";
    this.description = "";
    this.categories = [];
    this.tags = "";
    this.compatibleThemes = [];
    this.readmeContent = "";
    this.pendingSelectedFilePaths = null;
    this.pendingAttachedSnippetPaths = null;
    this.pendingScreenshotPaths = null;
    this.restoredDraft = false;
  }

  private restoreSelectionFromPaths(
    files: PublishFile[],
    pendingPaths: string[] | null,
    assign: (files: PublishFile[]) => void
  ) {
    if (!pendingPaths) return;
    const wanted = new Set(pendingPaths);
    assign(files.filter((file) => wanted.has(file.path)));
  }

  private renderStep() {
    this.contentEl.empty();
    this.contentEl.addClass("vault-hub-modal");

    const header = this.contentEl.createDiv("vault-hub-header");
    header.createEl("h2", { text: `Publish Resource — Step ${this.step} of 5` });
    const progress = header.createDiv("vault-hub-progress");
    for (let i = 1; i <= 5; i++) {
      const dot = progress.createSpan("vault-hub-dot");
      if (i === this.step) dot.addClass("active");
      else if (i < this.step) dot.addClass("done");
    }

    if (this.restoredDraft) {
      const draftBar = this.contentEl.createDiv("vault-hub-hint");
      draftBar.setText("Restored your saved publish draft.");
      const discardBtn = draftBar.createEl("button", { text: "Start over" });
      discardBtn.type = "button";
      discardBtn.style.marginLeft = "8px";
      discardBtn.addEventListener("click", async () => {
        this.resetState();
        await this.discardDraft();
        this.renderStep();
      });
    }

    switch (this.step) {
      case 1: this.renderStep1(); break;
      case 2: this.renderStep2(); break;
      case 3: this.renderStep3(); break;
      case 4: this.renderStep4(); break;
      case 5: this.renderStep5(); break;
    }
  }

  private async renderStep1() {
    const c = this.contentEl;

    new Setting(c)
      .setName("Resource Type")
      .addDropdown((dd: DropdownComponent) => {
        dd.addOption("snippet", "CSS Snippet");
        dd.addOption("note", "Note / Template / Dashboard");
        dd.addOption("bundle", "Vault / Multi-file Template");
        dd.setValue(this.resourceType);
        dd.onChange((v: string) => {
          this.resourceType = v as ResourceType;
          this.selectedFiles = [];
          this.selectedAttachedSnippets = [];
          this.checkedPlugins = new Set();
          this.allPlugins = [];
          this.pendingSelectedFilePaths = null;
          this.pendingAttachedSnippetPaths = null;
          this.renderStep();
        });
      });

    const files = await this.collectCandidateFiles();
    const availableSnippets = this.resourceType === "note"
      ? await listSnippetFiles(this.app)
      : [];
    this.restoreSelectionFromPaths(files, this.pendingSelectedFilePaths, (restored) => {
      this.selectedFiles = restored;
      this.pendingSelectedFilePaths = null;
    });
    if (this.resourceType === "note") {
      this.restoreSelectionFromPaths(
        availableSnippets,
        this.pendingAttachedSnippetPaths,
        (restored) => {
          this.selectedAttachedSnippets = restored;
          this.pendingAttachedSnippetPaths = null;
        }
      );
    }

    const fileSection = c.createDiv();
    const isBundle = this.resourceType === "bundle";
    fileSection.createEl("h4", { text: `Select file${isBundle ? "s" : ""}` });

    const fileSearch = fileSection.createEl("input", {
      type: "text",
      placeholder: "Search files...",
      cls: "vault-hub-search-input",
    });
    fileSearch.value = this.fileSearchQuery;
    fileSearch.addEventListener("input", () => {
      this.fileSearchQuery = fileSearch.value;
      renderFileList();
    });

    if (this.resourceType === "snippet") {
      fileSection.createEl("p", {
        text: "Sourced from .obsidian/snippets. Drop .css files there if nothing shows up.",
        cls: "vault-hub-hint",
      });
    }

    if (files.length === 0) {
      fileSection.createEl("p", {
        text:
          this.resourceType === "snippet"
            ? "No CSS snippets found in .obsidian/snippets."
            : this.resourceType === "bundle"
            ? "No markdown files found in this vault."
            : "No markdown files found in this vault.",
        cls: "vault-hub-hint",
      });
    }

    let count: HTMLSpanElement | null = null;
    if (isBundle && files.length > 0) {
      const bulk = fileSection.createDiv("vault-hub-bulk");
      const selectAll = bulk.createEl("button", { text: "Select all" });
      selectAll.type = "button";
      selectAll.addEventListener("click", () => {
        this.selectedFiles = files.slice();
        renderFileList();
      });
      const clearAll = bulk.createEl("button", { text: "Clear" });
      clearAll.type = "button";
      clearAll.addEventListener("click", () => {
        this.selectedFiles = [];
        renderFileList();
      });
      count = bulk.createSpan({ cls: "vault-hub-bulk-count" });
    }

    const list = fileSection.createDiv("vault-hub-file-list");
    const emptyFileSearch = fileSection.createEl("p", {
      text: "No files match that search.",
      cls: "vault-hub-hint",
    });
    emptyFileSearch.style.display = "none";

    const renderFileList = () => {
      const fileSearchNeedle = this.fileSearchQuery.trim().toLowerCase();
      const visibleFiles = fileSearchNeedle
        ? files.filter((file) => file.path.toLowerCase().includes(fileSearchNeedle))
        : files;
      const selectedPaths = new Set(this.selectedFiles.map((f) => f.path));

      list.empty();
      emptyFileSearch.style.display = files.length > 0 && visibleFiles.length === 0 ? "" : "none";
      if (count) {
        count.setText(`${this.selectedFiles.length} / ${files.length} selected`);
      }

      visibleFiles.forEach((f) => {
        const row = list.createDiv("vault-hub-file-row");
        const cb = row.createEl("input", { type: isBundle ? "checkbox" : "radio" });
        cb.name = "vault-hub-file";
        cb.checked = selectedPaths.has(f.path);
        cb.addEventListener("change", () => {
          if (isBundle) {
            if (cb.checked) this.selectedFiles.push(f);
            else this.selectedFiles = this.selectedFiles.filter((x) => x.path !== f.path);
          } else {
            this.selectedFiles = cb.checked ? [f] : [];
          }
          if (count) {
            count.setText(`${this.selectedFiles.length} / ${files.length} selected`);
          }
        });
        row.createSpan({ text: f.path });
      });
    };

    renderFileList();

    if (this.resourceType === "note") {
      const snippetSection = c.createDiv();
      snippetSection.createEl("h4", { text: "Attach CSS snippets" });
      snippetSection.createEl("p", {
        text: "Optional. These will be uploaded into the repo and listed in hub.md so install can pull them automatically.",
        cls: "vault-hub-hint",
      });

      const filterSnippets = () => {
        const needle = this.attachedSnippetSearchQuery.trim().toLowerCase();
        if (!needle) return availableSnippets;
        return availableSnippets.filter((file) => {
          const haystack = `${file.name} ${file.path}`.toLowerCase();
          return haystack.includes(needle);
        });
      };

      const attachedSnippetSearch = snippetSection.createEl("input", {
        type: "text",
        placeholder: "Search snippets...",
        cls: "vault-hub-search-input",
      });
      attachedSnippetSearch.value = this.attachedSnippetSearchQuery;

      if (availableSnippets.length === 0) {
        snippetSection.createEl("p", {
          text: "No CSS snippets found in .obsidian/snippets.",
          cls: "vault-hub-hint",
        });
      } else {
        const snippetList = snippetSection.createDiv("vault-hub-file-list");
        const emptySnippetSearch = snippetSection.createEl("p", {
          text: "No snippets match that search.",
          cls: "vault-hub-hint",
        });
        emptySnippetSearch.style.display = "none";

        const renderSnippetList = () => {
          const visibleSnippets = filterSnippets();
          const selectedSnippetPaths = new Set(this.selectedAttachedSnippets.map((f) => f.path));

          snippetList.empty();
          emptySnippetSearch.style.display = visibleSnippets.length === 0 ? "" : "none";

          visibleSnippets.forEach((file) => {
            const row = snippetList.createDiv("vault-hub-file-row");
            const cb = row.createEl("input", { type: "checkbox" });
            cb.checked = selectedSnippetPaths.has(file.path);
            cb.addEventListener("change", () => {
              if (cb.checked) this.selectedAttachedSnippets.push(file);
              else this.selectedAttachedSnippets = this.selectedAttachedSnippets.filter((x) => x.path !== file.path);
            });
            row.createSpan({ text: file.path });
          });
        };

      attachedSnippetSearch.addEventListener("input", () => {
        this.attachedSnippetSearchQuery = attachedSnippetSearch.value;
        renderSnippetList();
      });

        renderSnippetList();
      }
    }

    this.addNav(c, null, () => {
      if (this.selectedFiles.length === 0) {
        new Notice("Select at least one file");
        return false;
      }
      return true;
    });
  }

  private async collectCandidateFiles(): Promise<PublishFile[]> {
    if (this.resourceType === "snippet") {
      const snippets = await listSnippetFiles(this.app);
      return snippets.sort((a, b) => a.path.localeCompare(b.path));
    }
    return this.app.vault
      .getFiles()
      .filter((f: TFile) => f.extension === "md")
      .sort((a: TFile, b: TFile) => a.path.localeCompare(b.path))
      .map((f) => tfileToPublishFile(this.app, f));
  }

  private async renderStep2() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Select Required Plugins" });
    c.createEl("p", {
      text: "Auto-detected plugins are pre-checked. Review and adjust.",
      cls: "vault-hub-hint",
    });

    const loading = c.createDiv({ text: "Scanning..." });

    const fileType = this.resourceType === "snippet" ? "css" : "md";
    const detectedById = new Map<string, DetectedPlugin>();
    for (const file of this.selectedFiles) {
      const content = await file.read();
      const detected = await detectPlugins(content, fileType as "css" | "md", this.app.vault);
      detected.forEach((plugin) => detectedById.set(plugin.id, plugin));
    }
    this.allPlugins = [...detectedById.values()];

    loading.remove();

    if (this.checkedPlugins.size === 0) {
      this.allPlugins.forEach((p) => {
        if (p.autoDetected) this.checkedPlugins.add(p.id);
      });
    }

    const list = c.createDiv("vault-hub-plugin-list");
    this.allPlugins.forEach((p) => {
      const row = list.createDiv("vault-hub-plugin-row");
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.checkedPlugins.has(p.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.checkedPlugins.add(p.id);
        else this.checkedPlugins.delete(p.id);
      });

      const info = row.createDiv("vault-hub-plugin-info");
      info.createSpan({ text: p.name, cls: "vault-hub-plugin-name" });
      info.createSpan({ text: ` v${p.version}`, cls: "vault-hub-plugin-version" });
      if (p.autoDetected) {
        info.createSpan({ text: " (auto-detected)", cls: "vault-hub-auto-badge" });
      }
    });

    if (this.allPlugins.length === 0) {
      c.createEl("p", { text: "No community plugins installed.", cls: "vault-hub-hint" });
    }

    this.addNav(c, null, null);
  }

  private renderStep3() {
    const c = this.contentEl;

    new Setting(c).setName("Name").addText((t) => {
      t.setPlaceholder("My Resource").setValue(this.name);
      t.onChange((v: string) => (this.name = v));
      t.inputEl.style.width = "100%";
    });

    new Setting(c).setName("Tagline").setDesc("One-line summary").addText((t) => {
      t.setPlaceholder("A brief description").setValue(this.tagline);
      t.onChange((v: string) => (this.tagline = v));
      t.inputEl.style.width = "100%";
    });

    new Setting(c).setName("Description").addTextArea((t: TextAreaComponent) => {
      t.setPlaceholder("Detailed description...").setValue(this.description);
      t.onChange((v: string) => (this.description = v));
      t.inputEl.style.width = "100%";
      t.inputEl.style.minHeight = "80px";
    });

    const cats = CATEGORIES[this.resourceType] || [];
    new Setting(c).setName("Category").addDropdown((dd: DropdownComponent) => {
      dd.addOption("", "Select...");
      cats.forEach((cat) => dd.addOption(cat, cat));
      dd.setValue(this.categories[0] || "");
      dd.onChange((v: string) => (this.categories = v ? [v] : []));
    });

    new Setting(c).setName("Tags").setDesc("Comma-separated").addText((t) => {
      t.setPlaceholder("glass, blur, dark").setValue(this.tags);
      t.onChange((v: string) => (this.tags = v));
    });

    const screenshotSection = c.createDiv();
    screenshotSection.createEl("h4", { text: "Screenshots" });
    screenshotSection.createEl("p", {
      text: "Optional. Use local image files, external image URLs, or both.",
      cls: "vault-hub-hint",
    });

    new Setting(screenshotSection)
      .setName("External screenshot URLs")
      .setDesc("One per line. Direct image URLs work best.")
      .addTextArea((t: TextAreaComponent) => {
        t.setPlaceholder("https://example.com/screenshot.png")
          .setValue(this.externalScreenshotUrls);
        t.onChange((v: string) => (this.externalScreenshotUrls = v));
        t.inputEl.style.width = "100%";
        t.inputEl.style.minHeight = "72px";
      });

    const screenshotSearch = screenshotSection.createEl("input", {
      type: "text",
      placeholder: "Search images...",
      cls: "vault-hub-search-input",
    });
    screenshotSearch.value = this.screenshotSearchQuery;

    const screenshotList = screenshotSection.createDiv("vault-hub-file-list");
    const screenshotEmpty = screenshotSection.createEl("p", {
      text: "No screenshots match that search.",
      cls: "vault-hub-hint",
    });
    screenshotEmpty.style.display = "none";

    const renderScreenshotList = async () => {
      const allImages = await listImageFiles(this.app);
      this.restoreSelectionFromPaths(allImages, this.pendingScreenshotPaths, (restored) => {
        this.selectedScreenshots = restored;
        this.pendingScreenshotPaths = null;
      });
      const needle = this.screenshotSearchQuery.trim().toLowerCase();
      const visibleImages = needle
        ? allImages.filter((file) => file.path.toLowerCase().includes(needle))
        : allImages;
      const selectedImagePaths = new Set(this.selectedScreenshots.map((file) => file.path));

      screenshotList.empty();
      screenshotEmpty.style.display = allImages.length > 0 && visibleImages.length === 0 ? "" : "none";

      if (allImages.length === 0) {
        screenshotList.createEl("p", {
          text: "No image files found in this vault.",
          cls: "vault-hub-hint",
        });
        return;
      }

      visibleImages.forEach((file) => {
        const row = screenshotList.createDiv("vault-hub-file-row");
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = selectedImagePaths.has(file.path);
        cb.addEventListener("change", () => {
          if (cb.checked) this.selectedScreenshots.push(file);
          else this.selectedScreenshots = this.selectedScreenshots.filter((x) => x.path !== file.path);
        });
        row.createSpan({ text: file.path });
      });
    };

    screenshotSearch.addEventListener("input", () => {
      this.screenshotSearchQuery = screenshotSearch.value;
      void renderScreenshotList();
    });
    void renderScreenshotList();

    if (this.resourceType === "snippet") {
      new Setting(c).setName("Compatible Themes").addDropdown((dd: DropdownComponent) => {
        dd.addOption("any", "Any theme");
        ["minimal", "velocity", "obsidian-default", "catppuccin"].forEach((t) =>
          dd.addOption(t, t)
        );
        dd.setValue(this.compatibleThemes[0] || "any");
        dd.onChange((v: string) => (this.compatibleThemes = [v]));
      });
    }

    this.addNav(c, null, () => {
      if (!this.name.trim()) {
        new Notice("Name is required");
        return false;
      }
      this.readmeContent = generateReadme(this.buildReadmeData());
      return true;
    });
  }

  private renderStep4() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Edit README" });
    c.createEl("p", {
      text: "Auto-generated from your details. Edit freely.",
      cls: "vault-hub-hint",
    });

    const textarea = c.createEl("textarea", { cls: "vault-hub-readme-editor" });
    textarea.value = this.readmeContent;
    textarea.addEventListener("input", () => {
      this.readmeContent = textarea.value;
    });

    this.addNav(c, null, null);
  }

  private renderStep5() {
    const c = this.contentEl;
    c.createEl("h4", { text: "Review & Publish" });
    const publishedType = this.getPublishedType();

    const summary = c.createDiv("vault-hub-summary");
    summary.createEl("p", { text: `Type: ${publishedType}${this.resourceType === "bundle" ? " (multi-file)" : ""}` });
    summary.createEl("p", { text: `Name: ${this.name}` });
    summary.createEl("p", { text: `Files: ${this.selectedFiles.map((f) => f.path).join(", ")}` });
    if (this.selectedAttachedSnippets.length > 0) {
      summary.createEl("p", {
        text: `Attached snippets: ${this.selectedAttachedSnippets.map((f) => f.name).join(", ")}`,
      });
    }
    if (this.selectedScreenshots.length > 0) {
      summary.createEl("p", {
        text: `Screenshots: ${this.selectedScreenshots.map((f) => f.name).join(", ")}`,
      });
    }
    const externalScreenshotUrls = this.getExternalScreenshotUrls();
    if (externalScreenshotUrls.length > 0) {
      summary.createEl("p", {
        text: `External screenshots: ${externalScreenshotUrls.length}`,
      });
    }

    const selPlugins = this.allPlugins.filter((p) => this.checkedPlugins.has(p.id));
    summary.createEl("p", {
      text: `Plugins: ${selPlugins.length > 0 ? selPlugins.map((p) => p.name).join(", ") : "None"}`,
    });
    summary.createEl("p", { text: `Categories: ${this.categories.join(", ") || "None"}` });

    const btnContainer = c.createDiv("vault-hub-nav");

    const backBtn = btnContainer.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", async () => {
      this.step--;
      await this.saveDraft();
      this.renderStep();
    });

    const publishBtn = btnContainer.createEl("button", {
      text: "Publish",
      cls: "mod-cta",
    });
    publishBtn.addEventListener("click", () => this.doPublish());
  }

  private async doPublish() {
    const token = this.plugin.settings.githubToken;
    if (!token) {
      new Notice("Set your GitHub token in Vault Hub settings first");
      return;
    }

    const c = this.contentEl;
    c.empty();
    c.createEl("h3", { text: "Publishing..." });
    const status = c.createEl("p", { text: "Creating repository..." });

    try {
      await this.saveDraft();
      const gh = new GitHubAPI(token);
      const user = await gh.getUser();
      const publishedType = this.getPublishedType();

      const slug = this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "resource";
      const repoName = await gh.getAvailableRepoName(user.login, `obsidian-${publishedType}-${slug}`);

      status.setText("Creating repository...");
      const repo = await gh.createRepo(repoName, this.tagline || this.name);
      const [owner, rName] = repo.full_name.split("/");

      // Topic tag
      const topicMap: Record<string, string> = {
        vault: "obsidian-vault-template",
        snippet: "obsidian-css-snippet",
        note: "obsidian-note-template",
      };
      status.setText("Adding topic tag...");
      await gh.addTopics(owner, rName, [topicMap[publishedType]]);

      // Upload resource files
      for (const file of this.selectedFiles) {
        status.setText(`Uploading ${file.path}...`);
        const content = await file.read();
        await gh.createFile(owner, rName, file.path, content, `Add ${file.path}`);
      }

      const attachedSnippetFiles = this.getAttachedSnippetFiles();
      for (const file of attachedSnippetFiles) {
        status.setText(`Uploading ${file.repoPath}...`);
        const content = await file.read();
        await gh.createFile(owner, rName, file.repoPath, content, `Add ${file.repoPath}`);
      }

      const screenshotFiles = this.getScreenshotFiles();
      const screenshotUrls: string[] = [...this.getExternalScreenshotUrls()];
      const readmeScreenshots = this.buildReadmeData().screenshots;
      for (const file of screenshotFiles) {
        status.setText(`Uploading ${file.repoPath}...`);
        const binary = await file.readBinary();
        await gh.createBinaryFile(owner, rName, file.repoPath, toBase64(binary), `Add ${file.repoPath}`);
        screenshotUrls.push(`https://raw.githubusercontent.com/${owner}/${rName}/HEAD/${file.repoPath}`);
      }

      const readmeContent = syncReadmeScreenshots(
        this.readmeContent || generateReadme(this.buildReadmeData()),
        readmeScreenshots
      );
      this.readmeContent = readmeContent;
      const finalScreenshotUrls = this.uniqueStrings([
        ...screenshotUrls,
        ...this.extractMarkdownImageUrls(readmeContent).map((url) =>
          this.resolvePublishedAssetUrl(owner, rName, url)
        ),
      ]);

      // Generate and upload hub.md
      status.setText("Generating hub.md...");
      const selectedPlugins = this.allPlugins
        .filter((p) => this.checkedPlugins.has(p.id))
        .map((p) => ({ ...p, autoDetected: true }));

      const obsVer = (this.app as unknown as { appVersion?: string }).appVersion || "unknown";
      const themeName = ((this.app.vault as unknown as { config?: { cssTheme?: string } }).config?.cssTheme) || "default";

      const hubData: HubMdData = {
        type: publishedType,
        name: this.name,
        tagline: this.tagline,
        description: this.description,
        author: user.login,
        categories: this.categories,
        tags: this.tags.split(",").map((t) => t.trim()).filter(Boolean),
        compatibleThemes: this.compatibleThemes,
        screenshots: finalScreenshotUrls,
        plugins: selectedPlugins,
        attachedSnippets: attachedSnippetFiles.map((file) => ({
          path: file.repoPath,
          name: file.name,
          optional: file.optional,
        })),
        obsidianVersion: obsVer,
        theme: themeName,
        os: navigator.platform,
        files: this.selectedFiles.map((f) => ({
          path: f.path,
          type: f.extension,
          size: f.size,
        })),
        body: readmeContent,
      };

      const hubMd = generateHubMd(hubData);
      await gh.createFile(owner, rName, "hub.md", hubMd, "Add hub.md");

      // Upload README
      status.setText("Uploading README...");
      await gh.createFile(owner, rName, "README.md", readmeContent, "Add README");

      let refreshRequested = false;
      const catalogRepo = this.plugin.settings.catalogRepoFullName.trim();
      if (catalogRepo.includes("/")) {
        const [catalogOwner, catalogName] = catalogRepo.split("/");
        try {
          status.setText("Requesting catalog refresh...");
          await gh.dispatchRepositoryEvent(catalogOwner, catalogName, "catalog_refresh", {
            source_repo: repo.full_name,
            resource_type: publishedType,
          });
          refreshRequested = true;
        } catch {
          refreshRequested = false;
        }
      }

      // Save to published resources
      this.plugin.settings.publishedResources.push({
        repoFullName: repo.full_name,
        localFilePath: this.selectedFiles[0].path,
        localFiles: this.selectedFiles.map((f) => f.path),
        fileMappings: [
          ...this.selectedFiles.map((f) => ({ localPath: f.path, repoPath: f.path, kind: "resource" as const })),
          ...attachedSnippetFiles.map((f) => ({ localPath: f.localPath, repoPath: f.repoPath, kind: "attached-snippet" as const })),
          ...screenshotFiles.map((f) => ({ localPath: f.localPath, repoPath: f.repoPath, kind: "screenshot" as const })),
        ],
        type: publishedType,
        lastPublishedAt: new Date().toISOString(),
      });
      this.plugin.settings.publishDraft = null;
      this.preserveDraftOnClose = false;
      await this.plugin.saveSettings();

      // Success
      c.empty();
      c.createEl("h3", { text: "Published!" });
      c.createEl("p", { text: `Repository: ${repo.full_name}` });

      const vaultHubUrl = `https://obsidianvaulthub.com/r/${owner}/${rName}`;
      const link = c.createEl("a", {
        text: "Open pending page on Vault Hub",
        href: vaultHubUrl,
        cls: "mod-cta vault-hub-success-link",
      });
      link.setAttr("target", "_blank");

      c.createEl("p", {
        text: refreshRequested
          ? "Catalog refresh requested. The listing should move from pending to indexed after the workflow finishes."
          : "Catalog refresh was not requested automatically. The listing may stay pending until the next scheduled refresh.",
        cls: "vault-hub-hint",
      });

      const ghLink = c.createEl("a", {
        text: "View on GitHub",
        href: repo.html_url,
        cls: "vault-hub-hint",
      });
      ghLink.setAttr("target", "_blank");

      const closeBtn = c.createEl("button", { text: "Close", cls: "mod-cta" });
      closeBtn.addEventListener("click", () => this.close());

      new Notice(`Published to ${repo.full_name}!`);
    } catch (e) {
      c.empty();
      c.createEl("h3", { text: "Error" });
      c.createEl("p", { text: String(e) });
      const retryBtn = c.createEl("button", { text: "Back to Review" });
      retryBtn.addEventListener("click", () => {
        this.step = 5;
        this.renderStep();
      });
    }
  }

  private addNav(
    container: HTMLElement,
    backCheck: (() => boolean) | null,
    nextCheck: (() => boolean) | null
  ) {
    const nav = container.createDiv("vault-hub-nav");

    if (this.step > 1) {
      const back = nav.createEl("button", { text: "Back" });
      back.addEventListener("click", async () => {
        if (backCheck && !backCheck()) return;
        this.step--;
        await this.saveDraft();
        this.renderStep();
      });
    }

    if (this.step < 5) {
      const next = nav.createEl("button", { text: "Next", cls: "mod-cta" });
      next.addEventListener("click", async () => {
        if (nextCheck && !nextCheck()) return;
        this.step++;
        await this.saveDraft();
        this.renderStep();
      });
    }
  }

  private buildReadmeData(): ReadmeData {
    const selected = this.allPlugins
      .filter((plugin) => this.checkedPlugins.has(plugin.id))
      .map((plugin) => ({ ...plugin, autoDetected: true }));

    return {
      name: this.name,
      tagline: this.tagline,
      description: this.description,
      type: this.getPublishedType(),
      plugins: selected,
      files: this.selectedFiles.map((file) => ({ path: file.path })),
      attachedSnippets: this.getAttachedSnippetFiles().map((file) => ({
        path: file.repoPath,
        name: file.name,
        optional: file.optional,
      })),
      screenshots: [
        ...this.getScreenshotFiles().map((file) => ({
          path: file.repoPath,
          alt: file.name,
        })),
        ...this.getExternalScreenshotUrls().map((path, index) => ({
          path,
          alt: `Screenshot ${index + 1}`,
        })),
      ],
    };
  }

  private getAttachedSnippetFiles(): AttachedSnippetFile[] {
    const used = new Set<string>();
    return this.selectedAttachedSnippets.map((file) => {
      const rawName = file.name.replace(/\.css$/i, "") || "snippet";
      let candidate = `${rawName}.css`;
      let suffix = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${rawName}-${suffix}.css`;
        suffix++;
      }
      used.add(candidate.toLowerCase());
      return {
        localPath: file.path,
        repoPath: `snippets/${candidate}`,
        name: rawName,
        read: file.read,
      };
    });
  }

  private getScreenshotFiles(): ScreenshotFile[] {
    const used = new Set<string>();
    return this.selectedScreenshots.map((file) => {
      const dot = file.name.lastIndexOf(".");
      const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : file.extension.toLowerCase();
      let candidate = `${stem}.${ext}`;
      let suffix = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${stem}-${suffix}.${ext}`;
        suffix++;
      }
      used.add(candidate.toLowerCase());
      return {
        localPath: file.path,
        repoPath: `screenshots/${candidate}`,
        name: stem,
        readBinary: file.readBinary || (async () => new ArrayBuffer(0)),
      };
    });
  }

  private getExternalScreenshotUrls(): string[] {
    return this.externalScreenshotUrls
      .split(/\r?\n/)
      .map((line) => this.extractMarkdownUrl(line.trim()))
      .filter(Boolean);
  }

  private extractMarkdownUrl(value: string): string {
    const imageMatch = value.match(/^!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/);
    if (imageMatch) return imageMatch[1];
    const linkMatch = value.match(/^\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/);
    if (linkMatch) return linkMatch[1];
    return value.replace(/^["']|["']$/g, "");
  }

  private extractMarkdownImageUrls(value: string): string[] {
    const urls: string[] = [];
    const imagePattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    const screenshotLinkPattern = /\[([^\]]*screenshot[^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gi;
    let match: RegExpExecArray | null;
    while ((match = imagePattern.exec(value))) {
      urls.push(match[1]);
    }
    while ((match = screenshotLinkPattern.exec(value))) {
      urls.push(match[2]);
    }
    return urls;
  }

  private resolvePublishedAssetUrl(owner: string, repo: string, url: string): string {
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    const clean = url.replace(/^\.?\//, "").replace(/^blob\/[^/]+\//, "");
    return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${clean}`;
  }

  private uniqueStrings(values: string[]): string[] {
    return values.filter((value, index, all) => value && all.indexOf(value) === index);
  }
}
