const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCipheriv } = require('node:crypto')
const path = require('node:path')

const payload = JSON.stringify({ p: 'series/chapter/', i: ['1.jpg', '2.jpg'] })
const encryptPages = (keyId, keyBytes, iv) => {
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv)
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
    return `enc:v1:${keyId}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

test('built Paperback 0.8 source fetches a chapter key and decrypts pages', async () => {
    let graphqlRequests = 0
    let keyRequests = 0
    let keyId = 'fixture-key'
    let keyBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
    let encryptedPages = encryptPages(keyId, keyBytes, Buffer.from(Array.from({ length: 12 }, (_, index) => index + 32)))
    global.App = {
        createRequest: request => request,
        createChapterDetails: details => details,
        createSourceStateManager: () => ({ retrieve: async key => key === 'slug_series' ? 'series' : '', store: async () => {} }),
        createRequestManager: () => ({
            getDefaultUserAgent: async () => 'Paperback test',
            cookieStore: { getAllCookies: () => [] },
            schedule: async request => {
                if (request.method === 'HEAD') return { status: 404, headers: {}, data: '' }
                if (request.url.endsWith('/graphql')) {
                    graphqlRequests++
                    return { status: 200, data: JSON.stringify({ data: { chapter: { pages: encryptedPages } } }) }
                }
                if (request.url.endsWith('/api/chapter-crypto')) {
                    keyRequests++
                    return { status: 200, data: JSON.stringify({ keyId, key: keyBytes.toString('base64url'), expiresAt: Date.now() + 300000 }) }
                }
                throw new Error(`Unexpected request: ${request.url}`)
            }
        })
    }

    const bundlePath = path.join(__dirname, '..', 'bundles', '0.8', 'Mangahub', 'source.js')
    const { Sources } = require(bundlePath)
    const source = new Sources.Mangahub()
    const first = await source.getChapterDetails('series', '1')
    const second = await source.getChapterDetails('series', '2')
    assert.deepEqual(first.pages, [
        'https://imgx.mghcdn.com/series/chapter/1.jpg',
        'https://imgx.mghcdn.com/series/chapter/2.jpg'
    ])
    assert.deepEqual(second.pages, first.pages)
    assert.equal(graphqlRequests, 2)
    assert.equal(keyRequests, 1)

    keyId = 'rotated-key'
    keyBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1))
    encryptedPages = encryptPages(keyId, keyBytes, Buffer.from(Array.from({ length: 12 }, (_, index) => index + 33)))
    const afterRotation = await source.getChapterDetails('series', '3')
    assert.deepEqual(afterRotation.pages, first.pages)
    assert.equal(keyRequests, 2)
    delete global.App
})

test('built source uses CDN pages first and caches the result without fetching a chapter key', async () => {
    let headRequests = 0
    let graphqlRequests = 0
    let keyRequests = 0
    global.App = {
        createRequest: request => request,
        createChapterDetails: details => details,
        createSourceStateManager: () => ({ retrieve: async key => key === 'slug_series' ? 'series' : '', store: async () => {} }),
        createRequestManager: () => ({
            getDefaultUserAgent: async () => 'Paperback test',
            cookieStore: { getAllCookies: () => [] },
            schedule: async request => {
                if (request.method === 'HEAD') {
                    headRequests++
                    const exists = /^https:\/\/imgx\.mghcdn\.com\/series\/1\/[12]\.jpg$/.test(request.url)
                    return { status: exists ? 200 : 404, headers: exists ? { 'Content-Type': 'image/jpeg' } : {}, data: '' }
                }
                if (request.url.endsWith('/graphql')) graphqlRequests++
                if (request.url.endsWith('/api/chapter-crypto')) keyRequests++
                throw new Error(`Unexpected request: ${request.url}`)
            }
        })
    }

    const bundlePath = path.join(__dirname, '..', 'bundles', '0.8', 'Mangahub', 'source.js')
    const { Sources } = require(bundlePath)
    const source = new Sources.Mangahub()
    const first = await source.getChapterDetails('series', '1')
    const probesAfterFirst = headRequests
    const cached = await source.getChapterDetails('series', '1')
    assert.deepEqual(first.pages, [
        'https://imgx.mghcdn.com/series/1/1.jpg',
        'https://imgx.mghcdn.com/series/1/2.jpg'
    ])
    assert.deepEqual(cached.pages, first.pages)
    assert.equal(headRequests, probesAfterFirst)
    assert.equal(graphqlRequests, 0)
    assert.equal(keyRequests, 0)
    delete global.App
})

test('chapter list mainSlug is used for CDN URLs when it differs from manga ID', async () => {
    const state = new Map()
    let graphqlRequests = 0
    global.App = {
        createRequest: request => request,
        createChapter: chapter => chapter,
        createChapterDetails: details => details,
        createSourceStateManager: () => ({ retrieve: async key => state.get(key) ?? '', store: async (key, value) => state.set(key, value) }),
        createRequestManager: () => ({
            getDefaultUserAgent: async () => 'Paperback test',
            cookieStore: { getAllCookies: () => [] },
            schedule: async request => {
                if (request.method === 'HEAD') {
                    const exists = request.url === 'https://imgx.mghcdn.com/canonical-slug/4/1.png'
                    return { status: exists ? 200 : 404, headers: exists ? { 'content-type': 'image/png' } : {}, data: '' }
                }
                if (request.url.endsWith('/graphql')) {
                    graphqlRequests++
                    return { status: 200, data: JSON.stringify({ data: { manga: {
                        mainSlug: 'canonical-slug', chapters: [{ number: 4, title: 'Chapter 4', date: '2024-01-01' }]
                    } } }) }
                }
                throw new Error(`Unexpected request: ${request.url}`)
            }
        })
    }

    const bundlePath = path.join(__dirname, '..', 'bundles', '0.8', 'Mangahub', 'source.js')
    const { Sources } = require(bundlePath)
    const source = new Sources.Mangahub()
    const chapters = await source.getChapters('library-slug')
    const details = await source.getChapterDetails('library-slug', '4')
    assert.equal(chapters.length, 1)
    assert.deepEqual(details.pages, ['https://imgx.mghcdn.com/canonical-slug/4/1.png'])
    assert.equal(state.get('slug_library-slug'), 'canonical-slug')
    assert.equal(graphqlRequests, 1)
    delete global.App
})
