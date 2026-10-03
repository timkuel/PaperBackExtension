# Paperback Extensions (0.8)

An independent Paperback 0.8 extension project based on [Netsky's 0.8 sources](https://github.com/TheNetsky/netskys-extensions/tree/0.8). It includes the original source set, with current maintenance focused on MangaHub. This repository is separate from Netsky's repository.

## MangaHub chapter loading

MangaHub now encrypts the GraphQL `chapter.pages` field. This version decrypts the `enc:v1` AES-256-GCM envelope using the rotating key from MangaHub's `/api/chapter-crypto` endpoint, then builds the page URLs as the original extension did. It refreshes the key when its ID changes and distinguishes rate limits from unsupported encryption formats. The extension continues to require Paperback's Cloudflare bypass for MangaHub. This implementation was adapted for Paperback 0.8 after comparing [Elrulia's working 0.9 change](https://github.com/Elrulia/paperback-extension/commit/2552fcfba1cb960147afd9a12bee0e17da9812f4).

The site can change again, and the MangaHub path has not yet been tested inside the iOS app. The decryption tests and local bundle build pass.

## Build

Install Node.js 20 or newer, then run:

```sh
npm ci
npm run test:mangahub
npm run typecheck
npm run bundle
npm run test:bundle
```

The installable repository output is generated under `bundles/0.8/`. A GitHub Actions workflow publishes `bundles/` to GitHub Pages from this project's `main` branch. After GitHub Pages is enabled with **GitHub Actions** as its source, add [this repository URL](https://timkuel.github.io/PaperBackExtension/0.8/) in Paperback.

## Credits and license

The original sources and their attribution are retained. See [LICENSE](LICENSE) and the original [Netsky project](https://github.com/TheNetsky/netskys-extensions/tree/0.8). The upstream package metadata declares `GPL-3.0-or-later`, while the included upstream LICENSE file contains an MIT notice. This project preserves both notices; the discrepancy needs clarification from the upstream maintainers.
