/**
 * A phone: a touch screen whose short side is under 600 CSS px. Tablets and
 * touch laptops keep everything; phones skip the desk items and the features
 * that need a webcam, a MIDI controller or a desktop browser.
 */
export const IS_PHONE =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches &&
  Math.min(window.screen.width, window.screen.height) < 600
