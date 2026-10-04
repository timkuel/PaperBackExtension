import {
    SourceManga,
    Chapter,
    ChapterDetails,
    HomeSection,
    SearchRequest,
    PagedResults,
    SourceInfo,
    BadgeColor,
    TagSection,
    Tag,
    ContentRating,
    PartialSourceManga,
    Request,
    Response,
    SourceIntents,
    ChapterProviding,
    MangaProviding,
    SearchResultsProviding,
    HomePageSectionsProviding
} from '@paperback/types'

import {
    parseChapters,
    parseMangaDetails,
    parseViewMore,
    parseHomeSections,
    parseSearch
} from './MangahubParser'
import {
    base64UrlToBytes,
    ChapterCryptoKey,
    decryptChapterPages,
    parseChapterPages,
    parseEncryptedPagesEnvelope
} from './MangahubCrypto'
import { CdnProbeResult, discoverCdnPages } from './MangahubCdn'

const MH_DOMAIN = 'https://mangahub.io'
const MH_API_DOMAIN = 'https://api.mghcdn.com/graphql'
const CHAPTER_CRYPTO_URL = `${MH_DOMAIN}/api/chapter-crypto`
const CHAPTER_CACHE_TTL_MS = 60000
const CHAPTER_CACHE_LIMIT = 16

export const MangahubInfo: SourceInfo = {
    version: '3.2.2',
    name: 'Mangahub',
    icon: 'icon.png',
    author: 'Netsky',
    authorWebsite: 'https://github.com/TheNetsky',
    description: 'Extension that pulls manga from mangahub.io',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MH_DOMAIN,
    sourceTags: [{ text: 'Buggy', type: BadgeColor.RED }],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class Mangahub implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 2,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const apiRequest = request.url.startsWith(MH_API_DOMAIN)
                request.headers = {
                    ...(request.headers ?? {}),
                    'Referer': `${MH_DOMAIN}/`,
                    'User-Agent': await this.requestManager.getDefaultUserAgent(),
                    ...(request.url.startsWith(CHAPTER_CRYPTO_URL) ? { 'Accept': 'application/json' } : {}),
                    ...(apiRequest ? {
                        'Origin': MH_DOMAIN,
                        'x-mhub-access': await this.getMhubAccess()
                    } : {})
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    });

    cdnRequestManager = App.createRequestManager({
        requestsPerSecond: 500,
        requestTimeout: 5000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'Referer': `${MH_DOMAIN}/`,
                    'Origin': MH_DOMAIN,
                    'User-Agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    stateManager = App.createSourceStateManager()
    chapterCryptoKey: ChapterCryptoKey | null = null
    mangaSlugs = new Map<string, string>()
    chapterPagesCache = new Map<string, { pages: string[], expiresAt: number }>()
    pendingChapters = new Map<string, Promise<string[]>>()

    getMhubAccess = async (): Promise<string> => {
        const cookie = this.requestManager.cookieStore?.getAllCookies().find(cookie => cookie.name === 'mhub_access')
        if (cookie?.value) return cookie.value
        const stored = (await this.stateManager.retrieve('mhub_key')) ?? ''
        return /^mhub_access=([^;]+)/.exec(stored)?.[1] ?? stored
    }

    getMangaShareUrl(mangaId: string): string { return `${MH_DOMAIN}/manga/${mangaId}` }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            data: {
                query: `query {
                    manga(x: m01, slug: "${mangaId}") {
                        title
                        mainSlug
                        alternativeTitle
                        author
                        artist
                        image
                        status
                        genres
                        description
                        isPorn
                        isSoftPorn
                    }
                 }`
            }
        })

        const response = await this.requestManager.schedule(request, 1)
        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`${e}`)
        }

        if (!data.data?.manga) throw new Error(`Failed to parse manga property from data object mangaId:${mangaId}`)
        await this.rememberMainSlug(mangaId, data.data.manga.mainSlug)
        return parseMangaDetails(data.data.manga, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            data: {
                query: `query {
                    manga(x: m01, slug: "${mangaId}") {
                        title
                        mainSlug
                        chapters {
                          number
                          title
                          slug
                          date
                        }
                    }
                 }`
            }
        })

        const response = await this.requestManager.schedule(request, 1)

        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`${e}`)
        }

        if (!data.data?.manga) throw new Error(`Failed to parse manga property from data object mangaId:${mangaId}`)
        if (data.data.manga.chapters?.length == 0) throw new Error(`Failed to parse chapters property from manga object mangaId:${mangaId}`)
        await this.rememberMainSlug(mangaId, data.data.manga.mainSlug)
        return parseChapters(data.data.manga.chapters, mangaId)
    }

    async rememberMainSlug(mangaId: string, mainSlug: unknown): Promise<void> {
        if (typeof mainSlug !== 'string' || !mainSlug) return
        this.mangaSlugs.set(mangaId, mainSlug)
        await this.stateManager.store(`slug_${mangaId}`, mainSlug)
    }

    async getMainSlug(mangaId: string): Promise<string> {
        const cached = this.mangaSlugs.get(mangaId) || await this.stateManager.retrieve(`slug_${mangaId}`)
        if (typeof cached === 'string' && cached) return cached
        try {
            const request = App.createRequest({
                url: MH_API_DOMAIN,
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                data: { query: `query { manga(x: m01, slug: ${JSON.stringify(mangaId)}) { mainSlug } }` }
            })
            const response = await this.requestManager.schedule(request, 1)
            if (response.status < 400) {
                const data = JSON.parse(response.data as string)
                const mainSlug = data.data?.manga?.mainSlug
                if (typeof mainSlug === 'string' && mainSlug) {
                    await this.rememberMainSlug(mangaId, mainSlug)
                    return mainSlug
                }
            }
        } catch {
            // A missing slug must not prevent probing a chapter by its manga ID.
        }
        try { return decodeURIComponent(mangaId) } catch { return mangaId }
    }

    async getChapterCryptoKey(forceRefresh = false): Promise<ChapterCryptoKey> {
        if (!forceRefresh && this.chapterCryptoKey && this.chapterCryptoKey.expiresAt > Date.now() + 30000) {
            return this.chapterCryptoKey
        }
        const request = App.createRequest({
            url: CHAPTER_CRYPTO_URL,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        if (response.status >= 400) {
            throw new Error(`MangaHub chapter key request returned HTTP ${response.status}. Open MangaHub in Paperback's Cloudflare bypass and try again.`)
        }
        let data: { keyId?: string, key?: string, expiresAt?: number }
        try {
            data = JSON.parse(response.data as string)
        } catch {
            throw new Error('MangaHub returned an invalid chapter key response')
        }
        if (!data.keyId || !data.key) throw new Error('MangaHub chapter decryption key is unavailable')
        const key: ChapterCryptoKey = {
            keyId: data.keyId,
            keyBytes: base64UrlToBytes(data.key),
            expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : Date.now() + 300000
        }
        this.chapterCryptoKey = key
        return key
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const number = Number(chapterId)
        if (!Number.isFinite(number)) throw new Error('Invalid MangaHub chapter number')
        const cacheKey = JSON.stringify([mangaId, number])
        const cached = this.chapterPagesCache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) {
            this.chapterPagesCache.delete(cacheKey)
            this.chapterPagesCache.set(cacheKey, cached)
            return App.createChapterDetails({ id: chapterId, mangaId, pages: cached.pages.slice() })
        }
        this.chapterPagesCache.delete(cacheKey)

        let pending = this.pendingChapters.get(cacheKey)
        if (!pending) {
            pending = this.loadChapterPages(mangaId, chapterId, number)
            this.pendingChapters.set(cacheKey, pending)
        }
        try {
            const pages = await pending
            this.chapterPagesCache.set(cacheKey, { pages, expiresAt: Date.now() + CHAPTER_CACHE_TTL_MS })
            while (this.chapterPagesCache.size > CHAPTER_CACHE_LIMIT) {
                this.chapterPagesCache.delete(this.chapterPagesCache.keys().next().value!)
            }
            return App.createChapterDetails({ id: chapterId, mangaId, pages: pages.slice() })
        } finally {
            if (this.pendingChapters.get(cacheKey) === pending) this.pendingChapters.delete(cacheKey)
        }
    }

    async probeCdnPage(url: string): Promise<CdnProbeResult> {
        try {
            const response = await this.cdnRequestManager.schedule(App.createRequest({ url, method: 'HEAD' }), 1)
            if (response.status === 404 || response.status === 410) return 'missing'
            const contentTypeHeader = Object.keys(response.headers ?? {}).find(name => name.toLowerCase() === 'content-type')
            const contentType = contentTypeHeader ? response.headers[contentTypeHeader] : undefined
            if ((response.status === 200 || response.status === 206) &&
                (!contentType || /^image\//i.test(String(contentType)))) return 'exists'
            return 'inconclusive'
        } catch {
            return 'inconclusive'
        }
    }

    async loadChapterPages(mangaId: string, chapterId: string, number: number): Promise<string[]> {
        let cdnError: unknown
        try {
            const mainSlug = await this.getMainSlug(mangaId)
            return await discoverCdnPages(mainSlug, number, url => this.probeCdnPage(url))
        } catch (error) {
            cdnError = error
        }
        try {
            return await this.loadGraphqlChapterPages(mangaId, chapterId, number)
        } catch (error) {
            throw new Error(`MangaHub chapter pages unavailable. CDN: ${cdnError}; GraphQL: ${error}`)
        }
    }

    async loadGraphqlChapterPages(mangaId: string, chapterId: string, number: number): Promise<string[]> {
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            data: {
                query: `query {
                    chapter(x: m01, slug: "${mangaId}", number: ${number}) {
                      pages
                      title
                      slug
                    }
                  }`
            }
        })
        const response = await this.requestManager.schedule(request, 1)
        if (response.status >= 400) throw new Error(`MangaHub chapter request returned HTTP ${response.status}`)

        let data: { data?: { chapter?: { pages?: string } }, errors?: Array<{ message?: string }> }
        try {
            data = JSON.parse(response.data as string)
        } catch {
            throw new Error('MangaHub returned an invalid chapter response')
        }
        if (data.errors?.length) {
            const errorText = data.errors.map(error => error.message ?? '').join(' ')
            if (/rate\s*limit|api\s*key|encryption unavailable/i.test(errorText)) {
                await this.refreshAPIKey(mangaId, chapterId)
                throw new Error('MangaHub temporarily limited chapter access. Please try again after Cloudflare bypass.')
            }
            throw new Error(`MangaHub chapter request failed: ${errorText || 'unknown error'}`)
        }

        let pagesJson = data.data?.chapter?.pages
        if (!pagesJson) throw new Error(`MangaHub returned no chapter pages (${mangaId}, chapter ${chapterId})`)
        if (pagesJson.startsWith('enc:')) {
            const envelope = parseEncryptedPagesEnvelope(pagesJson)
            if (!envelope) throw new Error('MangaHub changed its chapter encryption format')
            let key = await this.getChapterCryptoKey()
            if (key.keyId !== envelope.keyId) key = await this.getChapterCryptoKey(true)
            pagesJson = decryptChapterPages(pagesJson, key)
        }

        return parseChapterPages(pagesJson)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            data: {
                query: `query {
                    genres {
                      id
                      slug
                      title
                    }
                }`
            }
        })

        const response = await this.requestManager.schedule(request, 1)
        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`${e}`)
        }

        if (data.data.genres?.length == 0) throw new Error('Failed to parse genres property from data object!')

        const arrayTags: Tag[] = []
        for (const genre of data.data.genres) {
            arrayTags.push({ id: genre.slug, label: genre.title })
        }
        return [App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })]
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            data: {
                query: `query {
                    latest_popular: latestPopular(x: m01) {
                        id
                        title
                        slug
                        image
                        latestChapter
                      }
                      latest: latest(x: m01, limit: 30) {
                        id
                        title
                        slug
                        image
                        latestChapter
                      }
                      popular: search(x: m01, mod: POPULAR, limit: 30) {
                        rows {
                          id
                          title
                          slug
                          image
                          latestChapter
                        }
                      }
                      new: search(x: m01, mod: NEW, limit: 30) {
                        rows {
                          id
                          title
                          slug
                          image
                          latestChapter
                        }
                      }
                      completed: search(x: m01, mod: COMPLETED, limit: 30) {
                        rows {
                          id
                          title
                          slug
                          image
                          latestChapter
                    }
                }
            }`
            }
        })
        const response = await this.requestManager.schedule(request, 1)

        try {
            const data = JSON.parse(response.data as string)
            parseHomeSections(data, sectionCallback)
        } catch (e) {
            throw new Error(`${e}`)
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const offset: number = metadata?.offset ?? 0
        const request = App.createRequest({
            url: MH_API_DOMAIN,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            data: {
                query: `query {
                    latest: search(x: m01, mod: LATEST, offset: ${offset}) {
                        rows {
                            id
                            title
                            slug
                            image
                            latestChapter
                        }
                      }
                      popular: search(x: m01, mod: POPULAR, offset: ${offset}) {
                        rows {
                            id
                            title
                            slug
                            image
                            latestChapter
                        }
                      }
                      new: search(x: m01, mod: NEW, offset: ${offset}) {
                        rows {
                            id
                            title
                            slug
                            image
                            latestChapter
                        }
                      }
                      completed: search(x: m01, mod: COMPLETED, offset: ${offset}) {
                        rows {
                            id
                            title
                            slug
                            image
                            latestChapter
                    }
                }
            }`
            }
        })

        const response = await this.requestManager.schedule(request, 1)

        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`${e}`)
        }

        const manga = parseViewMore(homepageSectionId, data)
        metadata = { offset: offset + 30 }
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const offset: number = metadata?.offset ?? 0
        const searchTag = query?.includedTags?.map((x: Tag) => x.id)

        const requests = [
            //No Alt Titles
            {
                request: App.createRequest({
                    url: MH_API_DOMAIN,
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    data: {
                        query: `query {
                            search(x: m01, alt: false, q: "${query?.title ? query.title : ''}", genre: "${searchTag[0] ? searchTag[0] : ''}", offset:${offset}) {
                              rows {
                                id
                                title
                                slug
                                image
                                latestChapter
                                genres
                              }
                            }
                          }
                          `
                    }
                })
            },
            {
                request: App.createRequest({
                    url: MH_API_DOMAIN,
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    data: {
                        query: `query {
                            search(x: m01, alt: true, q: "${query?.title ? query.title : ''}", genre: "${searchTag[0] ? searchTag[0] : ''}", offset:${offset}) {
                              rows {
                                id
                                title
                                slug
                                image
                                latestChapter
                                genres
                              }
                            }
                          }
                          `
                    }
                })
            }
        ]

        const promises: Promise<void>[] = []
        let manga: PartialSourceManga[] = []

        for (const req of requests) {
            promises.push(this.requestManager.schedule(req.request, 1).then((response) => {
                let data
                try {
                    data = JSON.parse(response.data as string)
                } catch (e) {
                    throw new Error(`${e}`)
                }
                manga = manga.concat(parseSearch(data))
            }))
        }

        await Promise.all(promises)

        const seen = new Set()
        manga = manga.filter(x => {
            const duplicate = seen.has(x.mangaId)
            seen.add(x.mangaId)
            return !duplicate
        })

        metadata = { offset: offset + 30 }
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        // Remove stored UserAgent
        await this.stateManager.store('userAgent', 'null')

        return App.createRequest({
            url: `${MH_DOMAIN}/chapter/the-last-human/chapter-1?reloadKey=1`,
            method: 'GET',
            headers: {
                'Referer': `${MH_DOMAIN}/`,
                'User-Agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }

    async refreshAPIKey(mangaId: string, chapterId: string) {
        // Request new access token
        const request = App.createRequest({
            url: `${MH_DOMAIN}/chapter/${encodeURIComponent(mangaId)}/chapter-${encodeURIComponent(chapterId)}?reloadKey=1`,
            method: 'GET',
            headers: {
                'Referer': `${MH_DOMAIN}/`,
                'User-Agent': await this.requestManager.getDefaultUserAgent()
            }
        })

        const response = await this.requestManager.schedule(request, 1)

        const cookieHeaders = response.headers['Set-Cookie'] ?? response.headers['set-cookie']

        let mhub_key = ''
        if (cookieHeaders) {
            const match = /mhub_access=([^;]+)/.exec(cookieHeaders)
            if (match) {
                const mhubAccess = match[1] ?? ''
                mhub_key = mhubAccess
            }
        }

        if (mhub_key) await this.stateManager.store('mhub_key', mhub_key)
    }

}
