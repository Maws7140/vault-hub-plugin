
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
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(isVaultHubSettingsData(data) ? data : {}),
    };
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

function isVaultHubSettingsData(value: unknown): value is Partial<VaultHubSettings> {
  return typeof value === "object" && value !== null;
}
