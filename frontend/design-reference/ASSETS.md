# Assets and provenance

All assets needed for the English interface are included. There are no runtime requests to Google Fonts, a stock-photo service, or an icon CDN.

- `public/art/source-navy-sky.svg`: exact sky artwork from the supplied source. `night-sky.svg` remains as the base theme fallback.
- `public/art/source-king.svg`, `source-queen.svg`: exact decorative category illustrations from the supplied source. They are not real candidates or votes. Development fixtures reuse them as labelled sample images.
- Lanterns, crown, decorative landscape and sparkle/confetti effects: native React SVG / CSS in Artwork.jsx and festival.css.
- `public/fonts/cormorant-garamond-latin-*.woff2`: Cormorant Garamond 400/500/600 normal and italic, from the Fontsource distribution.
- `public/fonts/dm-sans-latin-*.woff2`: DM Sans 400/500/600/700 normal, from the Fontsource distribution.
- Font license texts accompany the files. These fonts use the SIL Open Font License.

Actual candidate photographs and identities are deliberately not bundled. The API supplies them, including upload URLs. Missing or failed images get an explicit fallback; the production app never substitutes decorative sample portraits for actual candidate photos.

Non-Latin names fall back to installed system fonts. If the final content requires guaranteed Myanmar typography on every device, bundle the team's chosen licensed Myanmar font and append it to the font-family stacks.
