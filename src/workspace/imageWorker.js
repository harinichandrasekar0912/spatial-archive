// Card images are decoded and downscaled here, away from the page, so opening a workspace
// full of large photographs never stalls an animation. Message: { id, url, width, height }.
self.onmessage = async ({ data: { id, url, width, height } }) => {
  try {
    const blob = await (await fetch(url)).blob()
    const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high', imageOrientation: 'flipY' })
    self.postMessage({ id, bitmap }, [bitmap])
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
