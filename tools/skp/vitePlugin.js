/*
 * Development-only endpoint: lets the workspace accept a dropped .skp while `npm run dev` runs.
 *   GET  …/__spatial-archive/convert-skp               → { available }  (is SketchUp installed?)
 *   POST …/__spatial-archive/convert-skp               → { job }        (body: the .skp file)
 *   GET  …/__spatial-archive/convert-skp/<job>         → { state, files?, error? }
 *   GET  …/__spatial-archive/convert-skp/<job>/<name>  → one exported file (binary)
 * A conversion takes a minute or more, so the page polls the job instead of holding a request
 * open. Requests are only accepted from this machine (the dev server may listen on the network).
 * The production build has no server, so the app falls back to export instructions.
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { convertSkp, findSketchUp } from './convert.js'

const ROUTE = '/__spatial-archive/convert-skp'
const MAX_BYTES = 600 * 1024 * 1024
// Finished jobs (and their files) are kept this long for the page to download.
const JOB_TTL_MS = 20 * 60 * 1000
const TYPES = { '.dae': 'model/vnd.collada+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff' }

const jobs = new Map()

const isLocal = (address = '') => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)

function send(response, status, body) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length

      if (size > MAX_BYTES) {
        reject(new Error('This SketchUp file is too large to convert here.'))
        request.destroy()
        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function forget(id) {
  const job = jobs.get(id)

  if (job) {
    jobs.delete(id)
    rmSync(job.work, { recursive: true, force: true })
  }
}

function startJob(original, body) {
  const id = randomUUID()
  const work = mkdtempSync(join(tmpdir(), 'spatial-archive-upload-'))
  const input = join(work, original.toLowerCase().endsWith('.skp') ? original : `${original}.skp`)
  const job = { work, state: 'running', files: new Map(), error: '' }
  jobs.set(id, job)
  writeFileSync(input, body)

  convertSkp(input, { outputDir: join(work, 'export') })
    .then(({ files }) => {
      files.forEach((file) => job.files.set(basename(file), file))
      job.state = 'done'
    })
    .catch((error) => {
      job.state = 'error'
      job.error = error.message
    })
    .finally(() => {
      setTimeout(() => forget(id), JOB_TTL_MS).unref?.()
    })

  return id
}

function describe(job) {
  if (job.state !== 'done') {
    return { state: job.state, error: job.error || undefined }
  }

  // The model file first, then its textures.
  const files = [...job.files.entries()]
    .map(([name, path]) => ({ name, size: statSync(path).size, type: TYPES[extname(name).toLowerCase()] || 'application/octet-stream' }))
    .sort((a, b) => Number(b.name.toLowerCase().endsWith('.dae')) - Number(a.name.toLowerCase().endsWith('.dae')))
  return { state: 'done', files }
}

export function skpConverterPlugin() {
  return {
    name: 'spatial-archive-skp-converter',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url || '').split('?')[0]
        const at = path.indexOf(ROUTE)

        if (at < 0) {
          next()
          return
        }

        if (!isLocal(request.socket.remoteAddress)) {
          send(response, 403, { error: 'SketchUp conversion is only available on this computer.' })
          return
        }

        const [id, name] = path
          .slice(at + ROUTE.length)
          .split('/')
          .filter(Boolean)
          .map((part) => decodeURIComponent(part))

        try {
          if (!id) {
            if (request.method === 'GET') {
              send(response, 200, { available: Boolean(findSketchUp()) })
            } else if (request.method === 'POST') {
              const original = basename(decodeURIComponent(String(request.headers['x-filename'] || 'model.skp')))
              send(response, 202, { job: startJob(original, await readBody(request)) })
            } else {
              send(response, 405, { error: 'Use GET or POST.' })
            }

            return
          }

          const job = jobs.get(id)

          if (!job) {
            send(response, 404, { error: 'This conversion is no longer available.' })
            return
          }

          if (!name) {
            send(response, 200, describe(job))
            return
          }

          const file = job.files.get(name)

          if (!file) {
            send(response, 404, { error: 'No such file in this conversion.' })
            return
          }

          response.statusCode = 200
          response.setHeader('Content-Type', TYPES[extname(name).toLowerCase()] || 'application/octet-stream')
          response.setHeader('Content-Length', statSync(file).size)
          createReadStream(file).pipe(response)
        } catch (error) {
          send(response, 500, { error: error.message })
        }
      })
    },
  }
}
