import * as THREE from 'three'

/* Drives the loading screen in index.html (window.__boot). */
declare global {
  interface Window {
    __boot?: { set(p: number): void; done(): void }
  }
}

export const bootProgress = (p: number) => window.__boot?.set(p)
export const bootDone = () => window.__boot?.done()

/** Count an image loaded outside three.js's loaders (canvas-built textures) towards the 3D load. */
export function trackImage(img: HTMLImageElement, url: string) {
  const m = THREE.DefaultLoadingManager
  m.itemStart(url)
  const end = () => m.itemEnd(url)
  img.addEventListener('load', end, { once: true })
  img.addEventListener('error', end, { once: true })
}

/** The 3D studio: fill the bar as its textures load, and finish once they all have and frames are drawn with them. */
let texturesLoaded = false
let framesSince = 0
export function bootWith3DTextures() {
  const m = THREE.DefaultLoadingManager
  let started = false
  m.onStart = () => {
    started = true
    texturesLoaded = false
  }
  m.onProgress = (_url, loaded, total) => bootProgress(0.5 + 0.45 * (loaded / Math.max(1, total)))
  m.onLoad = () => {
    texturesLoaded = true
    framesSince = 0
  }
  // nothing to load: the frames alone decide
  setTimeout(() => !started && (texturesLoaded = true), 1200)
}

/** Called after each 3D frame. The first frames compile shaders and upload textures, so wait for a few. */
export function bootFrameDrawn() {
  if (!texturesLoaded || !window.__boot) return
  if (++framesSince === 3) bootDone()
}

/** The 2D view: fill the bar as the page's images load, and finish when the page has. */
export function bootWithPage() {
  if (document.readyState === 'complete') return void requestAnimationFrame(bootDone)
  const poll = setInterval(() => {
    const imgs = Array.from(document.images)
    if (imgs.length) bootProgress(0.5 + 0.48 * (imgs.filter((i) => i.complete).length / imgs.length))
  }, 100)
  window.addEventListener(
    'load',
    () => {
      clearInterval(poll)
      bootDone()
    },
    { once: true },
  )
}
