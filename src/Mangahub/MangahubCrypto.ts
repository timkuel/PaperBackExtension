import { gcm } from '@noble/ciphers/aes'

export interface ChapterCryptoKey {
    keyId: string
    keyBytes: Uint8Array
    expiresAt: number
}

export interface EncryptedPagesEnvelope {
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
}

export const parseEncryptedPagesEnvelope = (encoded: string): EncryptedPagesEnvelope | null => {
    const parts = encoded.split(':')
    if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') return null
    const [, , keyId, iv, authTag, ciphertext] = parts
    if (!keyId || !iv || !authTag || !ciphertext) return null
    return { keyId, iv, authTag, ciphertext }
}

export const base64UrlToBytes = (value: string): Uint8Array => {
    const input = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
    if (!input || input.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(input)) {
        throw new Error('Invalid MangaHub chapter encryption data')
    }

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const bytes: number[] = []
    let bits = 0
    let buffer = 0
    for (const character of input) {
        buffer = (buffer << 6) | alphabet.indexOf(character)
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes.push((buffer >>> bits) & 0xff)
        }
    }
    return new Uint8Array(bytes)
}

const utf8FromBytes = (bytes: Uint8Array): string => {
    // The 0.8 source runtime does not declare TextDecoder, so use a JS-only
    // UTF-8 decoder for the decrypted JSON payload.
    let encoded = ''
    for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`
    return decodeURIComponent(encoded)
}

export const decryptChapterPages = (encoded: string, key: ChapterCryptoKey): string => {
    const envelope = parseEncryptedPagesEnvelope(encoded)
    if (!envelope) throw new Error('Unsupported MangaHub chapter encryption format')
    if (envelope.keyId !== key.keyId) throw new Error('MangaHub chapter encryption key mismatch')

    const nonce = base64UrlToBytes(envelope.iv)
    const tag = base64UrlToBytes(envelope.authTag)
    const ciphertext = base64UrlToBytes(envelope.ciphertext)
    if (key.keyBytes.length !== 32 || nonce.length !== 12 || tag.length !== 16) {
        throw new Error('Invalid MangaHub chapter encryption data')
    }

    const encrypted = new Uint8Array(ciphertext.length + tag.length)
    encrypted.set(ciphertext)
    encrypted.set(tag, ciphertext.length)
    return utf8FromBytes(gcm(key.keyBytes, nonce).decrypt(encrypted))
}

export const parseChapterPages = (pagesJson: string): string[] => {
    const payload = JSON.parse(pagesJson) as { p?: unknown, i?: unknown } | null
    if (!payload || (payload.p != null && typeof payload.p !== 'string') || !Array.isArray(payload.i) || !payload.i.length ||
        !payload.i.every(image => typeof image === 'string' && image.length > 0)) {
        throw new Error('MangaHub chapter contains no valid pages')
    }
    const prefix = payload.p ?? ''
    return payload.i.map((image: string) => `https://imgx.mghcdn.com/${prefix}${image}`)
}
