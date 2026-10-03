const fs = require('node:fs')
const path = require('node:path')

fs.mkdirSync(path.join(__dirname, '..', 'bundles'), { recursive: true })
