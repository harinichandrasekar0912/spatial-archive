/*
 * SketchUp (.skp) → Collada (.dae) conversion using the SketchUp installed on this machine.
 * Browsers cannot read .skp (a closed format), so SketchUp itself does the export:
 * it is launched with tools/skp/export.rb, opens a *copy* of the model, exports, and quits.
 * Nothing is uploaded anywhere and the original file is never opened directly.
 *
 * SketchUp is a desktop app, so an unattended run can stall on a dialog. On Windows a small
 * watcher (answerDialogs.ps1) answers the known ones and logs the rest; and a finished .dae is
 * accepted even if SketchUp never gets as far as reporting back.
 */
import { spawn } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const EXPORT_SCRIPT = join(here, 'export.rb')
const DIALOG_WATCHER = join(here, 'answerDialogs.ps1')
// Give up when nothing has happened for this long (the timer restarts while the .dae grows).
const IDLE_TIMEOUT_MS = 4 * 60 * 1000
const POLL_MS = 500
// A .dae that ends properly and has not grown for this long is complete.
const SETTLED_MS = 3000

function newestSketchUpIn(root, executable) {
  if (!existsSync(root)) {
    return null
  }

  const versions = readdirSync(root)
    .filter((name) => /^SketchUp 20\d\d$/.test(name))
    .sort()
    .reverse()

  for (const version of versions) {
    const candidate = join(root, version, executable)

    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function findSketchUp() {
  if (process.env.SKETCHUP_EXE && existsSync(process.env.SKETCHUP_EXE)) {
    return process.env.SKETCHUP_EXE
  }

  if (process.platform === 'win32') {
    return newestSketchUpIn('C:\\Program Files\\SketchUp', 'SketchUp.exe')
  }

  if (process.platform === 'darwin') {
    const root = '/Applications'
    const app = existsSync(root) && readdirSync(root).filter((name) => /^SketchUp 20\d\d$/.test(name)).sort().reverse()[0]
    return app ? join(root, app, 'SketchUp.app', 'Contents', 'MacOS', 'SketchUp') : null
  }

  return null
}

// A template opened on the command line skips SketchUp's Welcome screen.
function findTemplate(executable) {
  const templates = join(dirname(executable), 'Resources', 'en-US', 'Templates')

  if (!existsSync(templates)) {
    return null
  }

  const preferred = readdirSync(templates).filter((name) => name.toLowerCase().endsWith('.skp')).sort()
  return preferred.length ? join(templates, preferred[0]) : null
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Files SketchUp wrote: the .dae plus its texture folder (named after the .dae), if any.
function collectOutputs(daePath) {
  const files = [daePath]
  const textureDir = join(dirname(daePath), basename(daePath, '.dae'))

  if (existsSync(textureDir) && statSync(textureDir).isDirectory()) {
    readdirSync(textureDir).forEach((name) => files.push(join(textureDir, name)))
  }

  return files
}

function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return -1
  }
}

// Whether a Collada file has been written to the end.
function isCompleteDae(path) {
  const size = sizeOf(path)

  if (size < 64) {
    return false
  }

  const length = Math.min(256, size)
  const buffer = Buffer.alloc(length)
  const handle = openSync(path, 'r')

  try {
    readSync(handle, buffer, 0, length, size - length)
  } finally {
    closeSync(handle)
  }

  return buffer.toString('utf8').includes('</COLLADA>')
}

function readLog(path) {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function startDialogWatcher(processId, logPath) {
  if (process.platform !== 'win32' || !existsSync(DIALOG_WATCHER)) {
    return null
  }

  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DIALOG_WATCHER, '-ProcessId', String(processId), '-LogPath', logPath], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

let queue = Promise.resolve()

/*
 * Converts one .skp file. Conversions run one at a time (SketchUp is a single desktop app).
 * Resolves to { daePath, files } where files includes any exported textures.
 */
export function convertSkp(inputPath, { outputDir } = {}) {
  const job = queue.then(() => runConversion(inputPath, outputDir))
  queue = job.catch(() => {})
  return job
}

async function runConversion(inputPath, outputDir) {
  const executable = findSketchUp()

  if (!executable) {
    throw new Error('SketchUp was not found. Install SketchUp, or set SKETCHUP_EXE to its executable.')
  }

  const template = findTemplate(executable)

  if (!template) {
    throw new Error('SketchUp templates were not found, so its Welcome screen cannot be skipped.')
  }

  const work = mkdtempSync(join(tmpdir(), 'spatial-archive-skp-'))
  const safeName = basename(inputPath, extname(inputPath)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'model'
  const source = join(work, `${safeName}.skp`)
  const bootstrap = join(work, 'bootstrap.skp')
  const targetDir = outputDir || work
  const daePath = join(targetDir, `${safeName}.dae`)
  const statusPath = join(work, 'status.txt')
  const dialogLog = join(work, 'dialogs.txt')

  mkdirSync(targetDir, { recursive: true })
  copyFileSync(inputPath, source)
  copyFileSync(template, bootstrap)

  const child = spawn(executable, ['-RubyStartup', EXPORT_SCRIPT, bootstrap], {
    env: { ...process.env, SA_SKP_INPUT: source, SA_SKP_OUTPUT: daePath, SA_SKP_STATUS: statusPath },
    stdio: 'ignore',
    windowsHide: false,
  })
  const watcher = startDialogWatcher(child.pid, dialogLog)

  let exited = false
  child.on('exit', () => {
    exited = true
  })

  const stop = () => {
    watcher?.kill()

    if (!exited) {
      child.kill()
    }
  }

  let lastSize = -1
  let lastChange = Date.now()
  let status = ''

  try {
    while (true) {
      if (existsSync(statusPath)) {
        status = readFileSync(statusPath, 'utf8').trim()
        break
      }

      const size = sizeOf(daePath)

      if (size !== lastSize) {
        lastSize = size
        lastChange = Date.now()
      } else if (size > 0 && Date.now() - lastChange > SETTLED_MS && isCompleteDae(daePath)) {
        // Exported, but SketchUp is held up afterwards (e.g. by a dialog): the file is done.
        status = 'ok (exported)'
        break
      }

      if (exited) {
        throw new Error('SketchUp closed before exporting the model.')
      }

      if (Date.now() - lastChange > IDLE_TIMEOUT_MS) {
        const dialogs = readLog(dialogLog)
        throw new Error(dialogs ? `SketchUp stopped at a dialog (${dialogs.split('\n').pop()}).` : 'SketchUp took too long to export the model.')
      }

      await wait(POLL_MS)
    }

    // SketchUp quits itself after exporting; give it a moment before closing it.
    for (let attempt = 0; attempt < 20 && !exited; attempt += 1) {
      await wait(POLL_MS)
    }
  } finally {
    stop()
  }

  if (outputDir) {
    // The copy of the model and SketchUp's scratch files are no longer needed.
    setTimeout(() => {
      try {
        rmSync(work, { recursive: true, force: true })
      } catch {
        // SketchUp may still hold a file for a moment; the system clears temp folders anyway.
      }
    }, 5000).unref?.()
  }

  if (!status.startsWith('ok') || !existsSync(daePath)) {
    throw new Error(`SketchUp could not export this model (${status || 'no status'}).`)
  }

  return { daePath, files: collectOutputs(daePath) }
}
