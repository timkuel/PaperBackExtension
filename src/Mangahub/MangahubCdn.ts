const CDN_ROOT = 'https://imgx.mghcdn.com'
const SUFFIXES = ['.jpg', '.jpeg', '.png', '.webp', 'a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']
const PROBE_WINDOW = 8
const MAX_PAGES = 1000

export type CdnProbeResult = 'exists' | 'missing' | 'inconclusive'
export type CdnProbe = (url: string) => Promise<CdnProbeResult>

export const discoverCdnPages = async (slug: string, chapter: number, probe: CdnProbe): Promise<string[]> => {
    if (!slug || !Number.isFinite(chapter)) throw new Error('Invalid MangaHub CDN chapter path')
    const base = `${CDN_ROOT}/${encodeURIComponent(slug)}/${chapter}/`
    const url = (page: number, suffix: string): string => `${base}${page}${suffix}`

    const resolveSuffix = async (page: number, skip?: string): Promise<string | null> => {
        const candidates = SUFFIXES.filter(suffix => suffix !== skip)
        const results = await Promise.all(candidates.map(suffix => probe(url(page, suffix))))
        const found = results.findIndex(result => result === 'exists')
        if (found >= 0) return candidates[found]!
        if (results.includes('inconclusive')) throw new Error(`MangaHub CDN probe was blocked or timed out at page ${page}`)
        return null
    }

    let start = 1
    let suffix = await resolveSuffix(1)
    if (suffix) {
        const zero = await probe(url(0, suffix))
        if (zero === 'exists') start = 0
        else if (zero === 'inconclusive') throw new Error('MangaHub CDN page numbering could not be verified')
    } else {
        suffix = await resolveSuffix(0)
        if (suffix) start = 0
    }
    if (!suffix) throw new Error(`MangaHub CDN has no chapter pages at ${base}`)

    const pages = [url(start, suffix)]
    const pending = new Map<number, { suffix: string, result: Promise<CdnProbeResult> }>()
    let nextToQueue = start + 1
    const fillWindow = (): void => {
        while (pending.size < PROBE_WINDOW && nextToQueue <= start + MAX_PAGES + 2) {
            const page = nextToQueue++
            pending.set(page, { suffix: suffix!, result: probe(url(page, suffix!)) })
        }
    }
    fillWindow()

    for (let page = start + 1; pages.length < MAX_PAGES; page++) {
        const queued = pending.get(page)!
        const result = await queued.result
        pending.delete(page)
        const resolved = result === 'exists' ? queued.suffix : await resolveSuffix(page, result === 'missing' ? queued.suffix : undefined)
        if (!resolved) {
            // A gap or an uncertain response could otherwise silently truncate a chapter.
            for (let later = page + 1; later <= page + 2; later++) {
                const prefetched = pending.get(later)
                const laterResult = prefetched ? await prefetched.result : await probe(url(later, suffix))
                if (laterResult === 'exists') {
                    throw new Error(`MangaHub CDN page sequence has a gap at page ${page}`)
                }
                if (laterResult === 'inconclusive') {
                    throw new Error(`MangaHub CDN page sequence is uncertain after page ${page - 1}`)
                }
                if (await resolveSuffix(later, prefetched?.suffix ?? suffix)) {
                    throw new Error(`MangaHub CDN page sequence has a gap at page ${page}`)
                }
            }
            return pages
        }
        suffix = resolved
        pages.push(url(page, suffix))
        fillWindow()
    }
    throw new Error(`MangaHub CDN chapter exceeds ${MAX_PAGES} pages`)
}
