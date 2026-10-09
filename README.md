# Carrot Documentation — landing page

The entry page of the Carrot Broadcast documentation: the logo and three section buttons over a live background.

No build step — just open `index.html` in a browser.

## Files

```
index.html                 markup: section links are the buttons' href, section colors are data-color
src/
  css/styles.css           layout, glass without WebGL, transition haze, responsive rules, language switching
  js/lang.js               picks the page language before the first paint
  js/main.js               WebGL background and glass, section transition, button rearrangement, live tab icon
assets/
  icons/                   tab icons (favicon.ico, favicon.svg, apple-touch-icon.png) and the logo mark logo-mark.svg
  images/                  fallback background and the CARROT BROADCAST wordmark
  fonts/                   the Inter font and its license
```

`assets/icons/logo-mark.svg` is the source of the logo mark: it is inlined in `index.html` and used in `favicon.svg`.
`assets/images/background.png` is the source of the fallback background `background.webp`.

Paths in `styles.css` are relative to the stylesheet itself, so fonts and images are referenced as `../../assets/`.

## Languages

The page has two versions: Russian and global (English). Both live in `index.html` side by side — every text exists as `<span lang="en">` and `<span lang="ru">`.

`src/js/lang.js` runs in `<head>` before the first paint and sets `<html lang>`; `styles.css` hides the inactive version, so the wrong language never flashes.

The Russian version is shown when the browser's preferred language:

- is Russian, in any country (`ru`, `ru-RU`, `ru-DE`, …);
- belongs to a CIS country or to Ukraine or Georgia — by country code (`kk-KZ`, `en-KZ`, `ro-MD`, …) or, when the browser reports no country, by the national language (`kk`, `uk`, `hy`, …).

Everyone else gets the English version. The country and language lists are at the top of `lang.js`.

To check a version regardless of the browser language, add `?lang=ru` or `?lang=en` to the address.

To change a text, edit both `<span>`s in `index.html`.

## Where to tweak things

- **`src/js/main.js`, the "Settings" block at the top.** Background, mouse, glass, animation timings and section colors (`SECTION_COLORS`).
- **`src/css/styles.css`, `:root` at the top.** Glass blur (`--glass-blur`), transition haze, dissolve effect, button and logo sizes, font.
- **The breakpoint where the buttons stack** is computed in `main.js` from `--button-width`, `--button-gap` and the number of buttons, so it moves by itself when a button is added. `styles.css` repeats it in the "Responsive" block only as a fallback for when JavaScript is off.

## Support

- **Without WebGL** (or until the browser restores a lost context) a fallback is shown: a static background and glass via `backdrop-filter`.
- **With `prefers-reduced-motion`** the animations are off and the links open immediately.
- **Sections open in a new tab** after the animation. If the browser blocks it (Safari is stricter about opening tabs with a delay), the section opens in the same tab.

## Licenses

The Inter font is distributed under the SIL Open Font License 1.1: `assets/fonts/OFL.txt`.
