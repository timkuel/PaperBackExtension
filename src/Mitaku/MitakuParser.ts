import {
    Chapter,
    ChapterDetails,
    Tag,
    SourceManga,
    PartialSourceManga,
    TagSection
} from '@paperback/types'

import { decode as decodeHTMLEntity } from 'html-entities'

import {
    Cheerio,
    CheerioAPI
} from 'cheerio'

import { type Element } from 'domhandler'

const MT_DOMAIN = 'https://mitaku.net'

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
    const images = parseImages($)

    const title = decodeHTMLEntity($('.cm-entry-title').first().text().trim())
    const artist = decodeHTMLEntity($('p:contains(Cosplayer:)').text().trim().replace('Cosplayer:', '').trim())
    const description = `Cosplayer: ${artist}\n\nGallery: ${title}\n\nImages: ${images.length}`


    const arrayTags: Tag[] = []
    for (const obj of $('div.genres-content a').toArray()) {
        const id = idCleaner($(obj).attr('href') ?? '')
        const title = $(obj).text().trim()

        if (!title || !id) continue

        arrayTags.push({ label: title, id: id })
    }
    const tagSections: TagSection[] = [App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })]

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title],
            artist: artist,
            author: artist,
            status: 'Completed',
            image: encodeURI(images[0] ?? ''),
            desc: description,
            tags: tagSections
        })
    })
}

export const parseChapters = (mangaId: string): Chapter[] => {
    return [App.createChapter({
        id: mangaId,
        name: 'Gallery',
        langCode: '🇬🇧',
        chapNum: 1
    })]
}

export const parseChapterDetails = ($: CheerioAPI, mangaId: string, chapterId: string): ChapterDetails => {

    const chapterDetails = App.createChapterDetails({
        id: chapterId,
        mangaId: mangaId,
        pages: parseImages($)
    })
    return chapterDetails
}

export const parseHomeSections = ($: CheerioAPI): PartialSourceManga[] => {
    const collectedIds: string[] = []
    const itemArray: PartialSourceManga[] = []

    for (const item of $('article').toArray()) {
        const postId = $(item).attr('id')
        const id = postId?.split('post-').pop()

        const image: string = getImageSrc($('img', item).first()) ?? ''
        const title: string = $('a', item).first().attr('title')?.trim() ?? ''

        const subtitle = $('a[rel="tag"]', item).map((i, el) => $(el).text().trim()).get().join(', ')

        if (!id || isNaN(Number(id)) || !title || !subtitle) continue

        itemArray.push(App.createPartialSourceManga({
            image: encodeURI(image),
            title: decodeHTMLEntity(title),
            mangaId: id,
            subtitle: decodeHTMLEntity(subtitle)
        }))
        collectedIds.push(id)
    }

    return itemArray
}

const parseImages = ($: CheerioAPI): string[] => {
    const images: string[] = []
    for (const img of $('a', 'div.msacwl-slider-wrap').toArray()) {

        let image = $(img).attr('src')
        if (!image) image = $(img).attr('data-mfp-src')
        if (!image) image = $(img).attr('data-lazy')

        if (!image) continue
        images.push(image)
    }

    return images
}

// Utils
const getImageSrc = (imageObj: Cheerio<Element> | undefined): string => {
    let image: string | undefined
    const sources = [
        'data-src',
        'data-lazy-src',
        'srcset',
        'src',
        'data-cfsrc'
    ]

    for (const attr of sources) {
        const val = imageObj?.attr(attr)

        if (val == null || val.trim() === '') continue

        // If it's srcset, extract the first URL
        if (attr === 'srcset') {
            image = val.split(',')[0]?.trim().split(' ')[0] ?? ''
        } else {
            image = val
        }

        break
    }

    image = image?.replace(/-\d+x\d+/g, '')

    if (image?.startsWith('/')) {
        image = MT_DOMAIN + image
    }

    image = image
        ?.trim()
        .replace(/(\s{2,})/gi, '')

    image = image?.replace(/http:\/\/\//g, 'http://') // only changes urls with http protocol
    image = image?.replace(/http:\/\//g, 'https://')
    // Malforumed url fix (Turns https:///example.com into https://example.com (or the http:// equivalent))
    image = image?.replace(/https:\/\/\//g, 'https://') // only changes urls with https protocol

    return decodeURI(decodeHTMLEntity(image ?? ''))
}

const idCleaner = (str: string): string => {
    let cleanId: string | null = str
    cleanId = cleanId.replace(/\/$/, '')
    cleanId = cleanId.split('/').pop() ?? null

    if (!cleanId) throw new Error(`Unable to parse id for ${str}`)
    return cleanId
}

export const isLastPage = ($: CheerioAPI): boolean => {
    let isLast = true
    const hasNext = Boolean($('a.last', 'div.wp-pagenavi').first())

    if (hasNext) isLast = false
    return isLast
}