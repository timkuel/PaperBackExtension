const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCipheriv } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'Mangahub', 'MangahubCrypto.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText
const compiled = new Module(sourcePath, module)
compiled.filename = sourcePath
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
compiled._compile(javascript, sourcePath)
const { base64UrlToBytes, decryptChapterPages, parseChapterPages, parseEncryptedPagesEnvelope } = compiled.exports

test('decrypts MangaHub AES-256-GCM pages and builds ordered image URLs', () => {
    const keyBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
    const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 32))
    const plaintext = JSON.stringify({ p: 'manga/chapter/', i: ['1.jpg', '2.jpg'] })
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const envelope = `enc:v1:abc123:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
    const key = { keyId: 'abc123', keyBytes: new Uint8Array(keyBytes), expiresAt: Date.now() + 300000 }

    assert.equal(parseEncryptedPagesEnvelope(envelope).keyId, 'abc123')
    assert.equal(decryptChapterPages(envelope, key), plaintext)
    assert.deepEqual(parseChapterPages(decryptChapterPages(envelope, key)), [
        'https://imgx.mghcdn.com/manga/chapter/1.jpg',
        'https://imgx.mghcdn.com/manga/chapter/2.jpg'
    ])

    assert.throws(() => decryptChapterPages(envelope, { ...key, keyId: 'stale' }), /key mismatch/)
    const tampered = envelope.slice(0, -1) + (envelope.endsWith('A') ? 'B' : 'A')
    assert.throws(() => decryptChapterPages(tampered, key))
})

test('rejects invalid encryption envelopes, base64, and page payloads', () => {
    assert.equal(parseEncryptedPagesEnvelope('enc:v2:a:b:c:d'), null)
    assert.equal(parseEncryptedPagesEnvelope('enc:v1:a:b:c'), null)
    assert.throws(() => base64UrlToBytes('!'))
    assert.throws(() => parseChapterPages('{"p":"x/","i":[]}'), /no valid pages/)
})
