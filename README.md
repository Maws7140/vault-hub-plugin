# Vault Hub

Vault Hub is an Obsidian plugin for publishing and installing Vault Hub resources.

It covers three workflows:

- publish notes, snippets, and full vaults to GitHub
- browse the Vault Hub catalog from inside Obsidian
- install note packs and CSS snippets directly into your vault

## What it does

- Publish a CSS snippet, a note, or a full vault as a GitHub repo
- Generate `hub.md` metadata for Vault Hub listings
- Generate and update a `README.md` for the published resource
- Detect required community plugins from selected files
- Attach CSS snippets to note and vault publishes
- Upload local screenshots or reference external screenshot URLs
- Browse the live Vault Hub catalog and install resources from it
- Manage installed CSS snippets from the plugin sidebar

## Install

### Manual install

1. Download the latest release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create a folder named `vault-hub` inside your vault's plugins directory:
   - `<your-vault>/<configDir>/plugins/vault-hub`
3. Place the release files in that folder.
4. Reload Obsidian and enable **Vault Hub** in Community plugins.

## Setup

1. Open **Settings → Community plugins → Vault Hub**.
2. Paste a GitHub personal access token with repo access.
3. Confirm the Vault Hub site URL if you are using a custom deployment.
4. Optionally set default categories for new publishes.

## Publish flow

Use one of the plugin commands:

- `Vault Hub: Publish resource`
- `Vault Hub: Update resource`
- `Vault Hub: Browse resources`

Publishing creates or updates a GitHub repository under your account and writes the files needed for Vault Hub indexing.

## Notes

- This plugin is desktop-only.
- Vault Hub install flows write files into your vault and into your vault configuration directory for CSS snippets.
- Publishing and updating require a GitHub account and a personal access token.

## Disclosures

- **Account requirement:** GitHub account and personal access token required for publish and update flows.
- **Network use:** Calls GitHub APIs, raw GitHub content URLs, and the configured Vault Hub website.
- **External file access:** Reads and writes files inside the current vault and its configuration directory.
- **Telemetry:** None.
- **Ads:** None.
- **Payments:** None.

## License

MIT
