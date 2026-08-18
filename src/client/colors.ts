/**
 * The color palette for cards and workspace frames: soft, low-saturation
 * tints built from one base hue per tag via alpha, so they sit quietly on
 * both the light and dark theme backgrounds.
 */
export interface ColorTag {
  id: string
  /** Swatch fill (opaque, for the picker). */
  swatch: string
  /** Card / frame-body fill. */
  fill: string
  /** Card border / frame border / label accents. */
  border: string
  /** Frame body fill — even fainter than a card. */
  faint: string
}

const hue = (id: string, r: number, g: number, b: number): ColorTag => ({
  id,
  swatch: `rgb(${r} ${g} ${b} / 0.55)`,
  fill: `rgb(${r} ${g} ${b} / 0.08)`,
  border: `rgb(${r} ${g} ${b} / 0.45)`,
  faint: `rgb(${r} ${g} ${b} / 0.05)`,
})

export const COLOR_TAGS: ColorTag[] = [
  hue('rose', 225, 29, 72),
  hue('amber', 217, 119, 6),
  hue('lime', 101, 163, 13),
  hue('teal', 13, 148, 136),
  hue('sky', 2, 132, 199),
  hue('violet', 124, 58, 237),
  hue('stone', 120, 113, 108),
]

const byId = new Map(COLOR_TAGS.map(tag => [tag.id, tag]))

export function colorOf(tagId: string | undefined): ColorTag | undefined {
  if (tagId === undefined) return undefined
  return byId.get(tagId)
}
