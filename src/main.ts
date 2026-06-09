
import { Plugin, requireApiVersion } from "obsidian";
import {
  VaultHubSettings,
  DEFAULT_SETTINGS,
  VaultHubSettingTab,
} from "./settings";
import { PublishModal } from "./modals/PublishModal";
import { UpdateModal } from "./modals/UpdateModal";
import { BrowseView, VIEW_TYPE_BROWSE } from "./views/BrowseView";

export default class VaultHubPlugin extends Plugin {
  settings: VaultHubSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_BROWSE, (leaf) => new BrowseView(leaf, this));

    this.addCommand({
      id: "publish-resource",
      name: "Publish resource",
      callback: () => new PublishModal(this.app, this).open(),
    });

    this.addCommand({
      id: "update-resource",
      name: "Update resource",
      callback: () => new UpdateModal(this.app, this).open(),
    });

    this.addCommand({
      id: "browse-resources",
      name: "Browse resources",
      callback: () => {
        void this.activateBrowseView();
      },
    });

    this.addSettingTab(new VaultHubSettingTab(this.app, this));

    this.addRibbonIcon("globe", "Vault hub", () => {
      void this.activateBrowseView();
    });
  }

  onunload() { }

  async loadSettings() {
    const data: unknown = await this.loadData();
    this.settings = parseSettings(data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async activateBrowseView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_BROWSE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_BROWSE, active: true });
      }
    }
    if (leaf) {
      if (requireApiVersion("1.7.2")) {
        await workspace.revealLeaf(leaf);
      } else {
        workspace.setActiveLeaf(leaf, { focus: true });
      }
    }
  }
}

function parseSettings(value: unknown): VaultHubSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const data = value as Record<string, unknown>;
  return {
    githubToken: typeof data.githubToken === "string" ? data.githubToken : DEFAULT_SETTINGS.githubToken,
    defaultCategories: Array.isArray(data.defaultCategories)
      ? data.defaultCategories.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_SETTINGS.defaultCategories],
    vaultHubUrl: typeof data.vaultHubUrl === "string" ? data.vaultHubUrl : DEFAULT_SETTINGS.vaultHubUrl,
    catalogRepoFullName: typeof data.catalogRepoFullName === "string"
      ? data.catalogRepoFullName
      : DEFAULT_SETTINGS.catalogRepoFullName,
    publishedResources: Array.isArray(data.publishedResources)
      ? data.publishedResources.filter(isPublishedResource)
      : [...DEFAULT_SETTINGS.publishedResources],
    publishDraft: isPublishDraft(data.publishDraft) ? data.publishDraft : DEFAULT_SETTINGS.publishDraft,
  };
}

function isPublishedResource(value: unknown): value is VaultHubSettings["publishedResources"][number] {
  if (typeof value !== "object" || value === null) return false;
  const resource = value as Record<string, unknown>;
  return (
    typeof resource.repoFullName === "string" &&
    typeof resource.localFilePath === "string" &&
    typeof resource.lastPublishedAt === "string" &&
    (
      resource.type === "snippet" ||
      resource.type === "note" ||
      resource.type === "vault" ||
      resource.type === "bundle"
    )
  );
}

function isPublishDraft(value: unknown): value is NonNullable<VaultHubSettings["publishDraft"]> {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.step === "number" &&
    (draft.resourceType === "snippet" || draft.resourceType === "note" || draft.resourceType === "bundle") &&
    Array.isArray(draft.selectedFilePaths) &&
    Array.isArray(draft.attachedSnippetPaths) &&
    Array.isArray(draft.screenshotPaths) &&
    typeof draft.externalScreenshotUrls === "string" &&
    typeof draft.fileSearchQuery === "string" &&
    typeof draft.attachedSnippetSearchQuery === "string" &&
    typeof draft.screenshotSearchQuery === "string" &&
    Array.isArray(draft.checkedPluginIds) &&
    typeof draft.name === "string" &&
    typeof draft.tagline === "string" &&
    typeof draft.description === "string" &&
    Array.isArray(draft.categories) &&
    typeof draft.tags === "string" &&
    Array.isArray(draft.compatibleThemes) &&
    typeof draft.readmeContent === "string"
  );
}
