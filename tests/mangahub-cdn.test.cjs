const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'Mangahub', 'MangahubCdn.ts')
const javascript = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const compiled = new Module(sourcePath, module)
compiled.filename = sourcePath
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
compiled._compile(javascript, sourcePath)
const { discoverCdnPages } = compiled.exports

const fixtureProbe = (paths, uncertain = []) => async url => {
    const path = new URL(url).pathname
    return uncertain.includes(path) ? 'inconclusive' : paths.includes(path) ? 'exists' : 'missing'
}

test('discovers mixed image suffixes without a chapter pages API call', async () => {
    const pages = await discoverCdnPages('my-series', 1.5, fixtureProbe([
        '/my-series/1.5/1.jpg', '/my-series/1.5/2.webp', '/my-series/1.5/3.webp'
    ]))
    assert.deepEqual(pages, [
        'https://imgx.mghcdn.com/my-series/1.5/1.jpg',
        'https://imgx.mghcdn.com/my-series/1.5/2.webp',
        'https://imgx.mghcdn.com/my-series/1.5/3.webp'
    ])
})

test('includes a page zero when the chapter uses zero-based numbering', async () => {
    const pages = await discoverCdnPages('series', 2, fixtureProbe([
        '/series/2/0.png', '/series/2/1.png', '/series/2/2.png'
    ]))
    assert.equal(pages.length, 3)
    assert.ok(pages[0].endsWith('/0.png'))
})

test('rejects gaps and inconclusive probes so GraphQL can recover the full chapter', async () => {
    await assert.rejects(
        discoverCdnPages('series', 2, fixtureProbe(['/series/2/1.jpg', '/series/2/3.jpg'])),
        /gap/
    )
    await assert.rejects(
        discoverCdnPages('series', 2, fixtureProbe(['/series/2/1.jpg'], ['/series/2/2.jpg'])),
        /blocked or timed out/
    )
})
