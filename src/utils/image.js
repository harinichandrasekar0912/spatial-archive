const LOAD_TIMEOUT_MS = 10000

/*
 * Load an image from a URL. image.decode() alone can stall in a hidden or background tab, so
 * this resolves on whichever comes first: a successful decode or the regular load event.
 */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let settled = false

    const finish = (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(image)
    }

    const timer = setTimeout(() => finish(new Error('Image took too long to load.')), LOAD_TIMEOUT_MS)
    image.onload = () => finish()
    image.onerror = () => finish(new Error('Image could not be loaded.'))
    image.src = url
    image.decode().then(() => finish(), () => {})
  })
}
