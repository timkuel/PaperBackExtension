# Paperback Extensions (0.8)

An independent Paperback 0.8 extension project based on [Netsky's 0.8 sources](https://github.com/TheNetsky/netskys-extensions/tree/0.8). It includes the original source set, with current maintenance focused on MangaHub. This repository is separate from Netsky's repository.

## MangaHub chapter loading

MangaHub changed the GraphQL `chapter.pages` path used by the original extension. This version loads the public chapter reader page and extracts its resolved image URLs from `#mangareader`. It checks the reader's page count when available and reports an incomplete response instead of returning a partial chapter. The extension continues to require Paperback's Cloudflare bypass for MangaHub.

The site can change again, and the MangaHub path has not yet been tested inside the iOS app. The parser tests and local bundle build pass.

## Build

Install Node.js 20 or newer, then run:

```sh
npm ci
npm run test:mangahub
npm run typecheck
npm run bundle
```

The installable repository output is generated under `bundles/0.8/`. A GitHub Actions workflow publishes `bundles/` to GitHub Pages from this project's `main` branch. After GitHub Pages is enabled with **GitHub Actions** as its source, add [this repository URL](https://timkuel.github.io/PaperBackExtension/0.8/) in Paperback.

## Credits and license

The original sources and their attribution are retained. See [LICENSE](LICENSE) and the original [Netsky project](https://github.com/TheNetsky/netskys-extensions/tree/0.8). The upstream package metadata declares `GPL-3.0-or-later`; this project retains that declaration while preserving the included upstream license file.
