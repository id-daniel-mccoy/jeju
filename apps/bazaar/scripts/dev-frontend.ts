#!/usr/bin/env bun
/**
 * Bazaar Frontend-Only Development Server
 *
 * Starts only the frontend server, assuming API is running separately.
 * Usage: bun run scripts/dev-frontend.ts
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import {
  CORE_PORTS,
  getIndexerGraphqlUrl,
  getLocalhostHost,
} from '@jejunetwork/config'

const FRONTEND_PORT = CORE_PORTS.BAZAAR.get()
const API_PORT = CORE_PORTS.BAZAAR_API.get()
const USE_DWS = process.env.USE_DWS === 'true'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4350'

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true

  const start = Date.now()
  console.log('[Bazaar] Building frontend...')

  const { build } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')

  await build({
    configFile: false,
    root: './web',
    build: {
      outDir: '../dist/static',
      emptyOutDir: true,
      rollupOptions: {
        input: './web/index.html',
      },
    },
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
    },
  })

  buildInProgress = false
  console.log(`[Bazaar] Built in ${Date.now() - start}ms`)
}

function generateDevHtml(): string {
  const apiUrl = USE_DWS
    ? `${DWS_URL}/workers/bazaar-api`
    : `http://localhost:${API_PORT}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bazaar</title>
  <script type="module" src="/client.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__BAZAAR_CONFIG__ = {
      apiUrl: '${apiUrl}',
      indexerUrl: '${getIndexerGraphqlUrl()}',
    };
  </script>
</body>
</html>`
}

async function startFrontendServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  await buildFrontend()

  const apiUrl = USE_DWS
    ? `${DWS_URL}/workers/bazaar-api`
    : `http://localhost:${API_PORT}`

  const host = getLocalhostHost()
  Bun.serve({
    port: FRONTEND_PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (
        path.startsWith('/api/') ||
        path === '/health' ||
        path.startsWith('/.well-known/')
      ) {
        return fetch(`${apiUrl}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Serve static files from dist/static
      const { join } = await import('node:path')
      const { existsSync, readFileSync } = await import('node:fs')
      const staticPath = join(process.cwd(), 'dist/static', path === '/' ? 'index.html' : path)
      
      if (existsSync(staticPath)) {
        const content = readFileSync(staticPath)
        const contentType = path.endsWith('.html') ? 'text/html' :
                           path.endsWith('.js') ? 'application/javascript' :
                           path.endsWith('.css') ? 'text/css' :
                           path.endsWith('.json') ? 'application/json' :
                           'application/octet-stream'
        return new Response(content, {
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
        })
      }

      // Serve index.html (SPA fallback)
      return new Response(generateDevHtml(), {
        headers: { 'Content-Type': 'text/html' },
      })
    },
  })

  console.log(`[Bazaar] Frontend: http://${host}:${FRONTEND_PORT}`)

  // Watch for changes
  for (const dir of ['./web', './components', './hooks', './lib']) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_, file) => {
        if (file?.endsWith('.ts') || file?.endsWith('.tsx')) {
          console.log(`[Bazaar] ${file} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

async function main() {
  console.log('[Bazaar] Starting frontend server (API should be running separately)...\n')
  await startFrontendServer()
  console.log('\n[Bazaar] Frontend ready.')
}

main()
