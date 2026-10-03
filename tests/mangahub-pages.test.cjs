const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'Mangahub', 'MangahubParser.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText
const compiled = new Module(sourcePath, module)
compiled.filename = sourcePath
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
compiled._compile(javascript, sourcePath)
const { parseChapterImageUrls } = compiled.exports

test('extracts every chapter image from reader HTML in page order', () => {
    const html = `<html><body><img src="https://imgx.mghcdn.com/ad/banner.jpg">
        <div id="mangareader">
          <img src="https://imgx.mghcdn.com/red-storm/478/1.jpg"><p>1/3</p>
          <img data-src="//imgx.mghcdn.com/red-storm/478/2.jpg"><p>2/3</p>
          <img src="https://imgx.mghcdn.com/red-storm/478/2.jpg">
          <img src="https://imgx.mghcdn.com/red-storm/478/3.jpg"><p>3/3</p>
          <img src="https://other.example/tracker.png">
        </div></body></html>`
    assert.deepEqual(parseChapterImageUrls(html), [
        'https://imgx.mghcdn.com/red-storm/478/1.jpg',
        'https://imgx.mghcdn.com/red-storm/478/2.jpg',
        'https://imgx.mghcdn.com/red-storm/478/3.jpg'
    ])
})

test('rejects incomplete reader HTML and Cloudflare pages', () => {
    assert.deepEqual(parseChapterImageUrls('<div id="mangareader"><img src="https://imgx.mghcdn.com/a.jpg"><p>1/4</p></div>'), [])
    assert.deepEqual(parseChapterImageUrls('<title>Just a moment...</title>'), [])
})
