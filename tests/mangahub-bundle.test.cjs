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
        createSourceStateManager: () => ({ retrieve: async () => '', store: async () => {} }),
        createRequestManager: () => ({
            getDefaultUserAgent: async () => 'Paperback test',
            cookieStore: { getAllCookies: () => [] },
            schedule: async request => {
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
