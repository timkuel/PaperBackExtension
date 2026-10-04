const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

test('built MangaHere source exports and runs its homepage method', async () => {
    const identity = value => value
    const homepage = '<div class="manga-list-1"><li><a href="/manga/sample/"><img src="cover.jpg" alt="Sample"></a></li></div>'
    global.App = {
        createRequest: identity,
        createCookie: identity,
        createHomeSection: identity,
        createPartialSourceManga: identity,
        createRequestManager: () => ({
            getDefaultUserAgent: async () => 'Paperback test',
            schedule: async () => ({ status: 200, data: homepage, headers: {} })
        })
    }

    const bundlePath = path.join(__dirname, '..', 'bundles', '0.8', 'MangaHere', 'source.js')
    const { Sources } = require(bundlePath)
    assert.equal(Sources.MangaHereInfo.version, '3.0.6')
    const source = new Sources.MangaHere()
    assert.equal(typeof source.getHomePageSections, 'function')
    const sections = []
    await source.getHomePageSections(section => sections.push(section))
    assert.equal(sections.length, 5)
    assert.equal(sections[0].items[0].mangaId, 'sample')
    delete global.App
})
