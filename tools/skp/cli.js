#!/usr/bin/env node
/*
 * Batch-convert SketchUp files for Spatial Archive:
 *   npm run convert:skp -- "path/to/model.skp" [more.skp ...] [--out folder]
 * Each model is exported to Collada (.dae, plus a texture folder if it has textures) next to
 * the original, or into --out. Drop the .dae (with its textures) into a workspace.
 */
import { dirname, resolve } from 'node:path'
import { convertSkp, findSketchUp } from './convert.js'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outputDir = outIndex >= 0 ? resolve(args[outIndex + 1] || '.') : null
const inputs = args.filter((arg, index) => arg !== '--out' && index !== outIndex + 1 && arg.toLowerCase().endsWith('.skp'))

if (!inputs.length) {
  console.log('Usage: npm run convert:skp -- "model.skp" [more.skp ...] [--out folder]')
  process.exit(1)
}

if (!findSketchUp()) {
  console.error('SketchUp was not found. Install it, or set SKETCHUP_EXE to its executable.')
  process.exit(1)
}

for (const input of inputs) {
  const absolute = resolve(input)
  process.stdout.write(`Converting ${absolute} … `)

  try {
    const { daePath, files } = await convertSkp(absolute, { outputDir: outputDir || dirname(absolute) })
    console.log(`done → ${daePath}${files.length > 1 ? ` (+${files.length - 1} texture files)` : ''}`)
  } catch (error) {
    console.log(`failed: ${error.message}`)
    process.exitCode = 1
  }
}
