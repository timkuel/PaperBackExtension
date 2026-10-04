# Paperback Extensions (0.8)

An independent Paperback 0.8 MangaHub extension based on [Netsky's 0.8 source](https://github.com/TheNetsky/netskys-extensions/tree/0.8). Use Netsky's repository for MangaHere and the other unchanged sources. This repository publishes only MangaHub to avoid duplicate source entries.

## MangaHub chapter loading

Chapter loading first checks MangaHub's CDN for numbered image URLs, following the approach in [HailXD's 0.8 MangaHub source](https://github.com/HailXD/pb-extensions/blob/1e8b4d15fb02fb050124985fa497b58199cfa9f7/src/mangahub.js). It supports common image suffixes, mixed suffixes, and chapters numbered from zero. A numbering gap or an inconclusive CDN response triggers the GraphQL fallback instead of returning a known incomplete chapter. Successful pages are cached briefly, and simultaneous loads of the same chapter share one request.

When CDN discovery fails, the extension requests GraphQL `chapter.pages` and decrypts MangaHub's `enc:v1` AES-256-GCM envelope using the rotating key from `/api/chapter-crypto`. It refreshes the key when its ID changes. This path was adapted for Paperback 0.8 after comparing [Elrulia's working 0.9 change](https://github.com/Elrulia/paperback-extension/commit/2552fcfba1cb960147afd9a12bee0e17da9812f4). MangaHub metadata and chapter lists still use GraphQL. The extension continues to require Paperback's Cloudflare bypass when those requests are challenged.

The site can change again, and this MangaHub version has not yet been tested inside the iOS app. CDN discovery assumes contiguous page numbers; an incorrectly missing tail page can still make a chapter appear shorter. The local tests cover CDN discovery, decryption, and both paths in the built 0.8 bundle.

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

The MangaHub source and its attribution are retained. See [LICENSE](LICENSE), [COPYING](COPYING), the original [Netsky project](https://github.com/TheNetsky/netskys-extensions/tree/0.8), and [HailXD's GPL-3.0 project](https://github.com/HailXD/pb-extensions). The upstream package metadata declares `GPL-3.0-or-later`, while the included upstream LICENSE file contains an MIT notice. This project preserves both notices; the discrepancy needs clarification from the upstream maintainers.
