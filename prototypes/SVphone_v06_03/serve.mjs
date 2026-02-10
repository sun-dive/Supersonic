import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.md':   'text/markdown',
  '.css':  'text/css',
  '.json': 'application/json',
}

const server = http.createServer((req, res) => {
  // Proxy /woc/* to WhatsOnChain API
  if (req.url.startsWith('/woc/')) {
    const apiPath = req.url.slice(4) // strip "/woc"
    const options = {
      hostname: 'api.whatsonchain.com',
      path: apiPath,
      method: req.method,
      headers: {
        'Accept': req.headers.accept || '*/*',
        'User-Agent': 'SVphone-Prototype/1.0',
      },
    }

    if (req.headers['content-type']) {
      options.headers['Content-Type'] = req.headers['content-type']
    }

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      })
      proxyRes.pipe(res)
    })

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message)
      res.writeHead(502)
      res.end('Proxy error')
    })

    // Forward request body (for POST like broadcast)
    req.pipe(proxyReq)
    return
  }

  // Static file serving
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url)
  const ext = path.extname(filePath)

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`\n📱 SVphone v06.01 Dev Server`)
  console.log(`${'═'.repeat(50)}`)
  console.log(`Server running at http://localhost:${PORT}`)
  console.log(`WoC API proxy at http://localhost:${PORT}/woc/...`)
  console.log(`\nOpen in browser: http://localhost:${PORT}`)
  console.log(`Press Ctrl+C to stop\n`)
})
