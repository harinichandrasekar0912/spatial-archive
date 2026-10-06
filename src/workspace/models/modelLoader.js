import * as THREE from 'three'

/*
 * 3D model loading. Loaders ship with three.js (three/addons) and are imported on demand, so
 * the initial app bundle does not grow. A model can arrive as several files (OBJ + MTL +
 * textures, glTF + .bin, Collada + texture folder): every file of the bundle is turned into a
 * blob URL, and a LoadingManager URL modifier resolves the model's internal references by name.
 */

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'dae', 'stl', 'fbx']
export const MODEL_SIDECAR_EXTENSIONS = ['mtl', 'bin']

export const extensionOf = (name) => String(name).split('.').pop().toLowerCase()
export const isModelName = (name) => MODEL_EXTENSIONS.includes(extensionOf(name))
export const isSidecarName = (name) => MODEL_SIDECAR_EXTENSIONS.includes(extensionOf(name))

// The last path segment of a URL or relative path ("textures/oak.jpg" → "oak.jpg").
function baseName(url) {
  const last = String(url).split(/[\\/]/).pop().split(/[?#]/)[0]

  try {
    return decodeURIComponent(last).toLowerCase()
  } catch {
    return last.toLowerCase()
  }
}

/*
 * files: [{ name, url }] for every file in the bundle, the main model file included.
 * Resolves to a THREE.Object3D (not yet normalised or styled). With waitForTextures, it also
 * waits until every texture the model asked for has loaded (or failed). The object's
 * userData.sourceNames maps each blob URL back to its file name.
 */
export async function loadModelObject(mainName, files, { waitForTextures = false } = {}) {
  const object = await loadWithManager(mainName, files, waitForTextures)
  object.userData.sourceNames = new Map(files.map(({ name, url }) => [url, name]))
  return object
}

async function loadWithManager(mainName, files, waitForTextures) {
  const byName = new Map(files.map(({ name, url }) => [baseName(name), url]))
  const mainUrl = byName.get(baseName(mainName))
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => byName.get(baseName(url)) ?? url)

  let settle = () => {}
  const settled = new Promise((resolve) => {
    settle = resolve
  })
  manager.onLoad = () => settle()

  const object = await parseWith(manager, mainName, mainUrl, files)

  if (waitForTextures) {
    await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 20000))])
  }

  return object
}

async function parseWith(manager, mainName, mainUrl, files) {
  switch (extensionOf(mainName)) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader(manager).loadAsync(mainUrl)
      return gltf.scene
    }

    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
      const loader = new OBJLoader(manager)
      const mtl = files.find(({ name }) => extensionOf(name) === 'mtl')

      if (mtl) {
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js')
        const materials = await new MTLLoader(manager).loadAsync(mtl.url)
        materials.preload()
        loader.setMaterials(materials)
      }

      return loader.loadAsync(mainUrl)
    }

    case 'dae': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js')
      const collada = await new ColladaLoader(manager).loadAsync(mainUrl)
      return collada.scene
    }

    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
      const geometry = await new STLLoader(manager).loadAsync(mainUrl)
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcccccc }))
      // STL has no up axis; CAD and print files are usually Z-up.
      mesh.rotation.x = -Math.PI / 2
      return mesh
    }

    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
      return new FBXLoader(manager).loadAsync(mainUrl)
    }

    default:
      throw new Error(`${mainName} is not a supported 3D format.`)
  }
}
