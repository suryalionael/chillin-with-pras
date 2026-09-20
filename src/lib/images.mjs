// Central registry for every photograph in the archive.
// The original site only ever published ~430-706px files. Every photo in
// src/assets/images has been enhanced (Real-ESRGAN x4, blended back toward the
// plain resample to stay faithful) so it holds up when shown large; the
// untouched originals are kept in audit/originals-lowres/.
const images = import.meta.glob(
  '../assets/images/*.{jpeg,jpg,png}',
  { eager: true, import: 'default' }
);

/** Resolve a source filename to its optimized asset module. */
export function findImage(file) {
  const mod = images[`../assets/images/${file}`];
  if (!mod) throw new Error(`Unknown image: ${file}`);
  return mod;
}

/** width / height of a photograph. */
export function ratio(file) {
  const { width, height } = findImage(file);
  return width / height;
}
