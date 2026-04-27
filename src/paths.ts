import { normalizePath, Vault } from "obsidian";

export function getSnippetDirectory(vault: Vault): string {
  return normalizePath(`${vault.configDir}/snippets`);
}
