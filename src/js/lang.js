/* ==========================================================================
   Carrot Documentation — language detection

   Runs in <head>, before the first paint, so the wrong language never flashes.
   The Russian version is shown when the browser's preferred language belongs
   to a CIS country (plus Ukraine and Georgia) or is Russian in any country.
   Everyone else gets the global English version.

   index.html holds both versions side by side (<span lang="en"> and
   <span lang="ru">); this script only sets <html lang>, and styles.css hides
   the inactive version.

   For testing, the language can be forced with ?lang=ru or ?lang=en.
   ========================================================================== */

(() => {
  "use strict";

  // Countries (ISO 3166-1): CIS members, Turkmenistan as an associate member,
  // and the former members Ukraine and Georgia
  const RUSSIAN_REGIONS = ["RU", "BY", "KZ", "KG", "TJ", "UZ", "AM", "AZ", "TM", "MD", "UA", "GE"];

  // National languages (ISO 639-1) of those countries. Used only when the
  // browser reports a language without a country, e.g. "kk" instead of "kk-KZ".
  // Romanian is left out: without a country it most likely means Romania
  const RUSSIAN_LANGUAGES = ["ru", "be", "kk", "ky", "tg", "uz", "hy", "az", "tk", "uk", "ka"];

  // "ru", "ru-DE", "kk-KZ", "uz-Latn-UZ", "en-KZ" → true; "en-US", "ro", "az-IR" → false
  const prefersRussian = (tag) => {
    const [language, ...subtags] = tag.toLowerCase().split(/[-_]/);
    if (language === "ru") return true;
    // The country is the two-letter subtag; a script subtag like "Latn" has four letters
    const region = subtags.find((part) => /^[a-z]{2}$/.test(part));
    return region
      ? RUSSIAN_REGIONS.includes(region.toUpperCase())
      : RUSSIAN_LANGUAGES.includes(language);
  };

  const forced = new URLSearchParams(window.location.search).get("lang");
  const preferred = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const detected = prefersRussian(preferred) ? "ru" : "en";

  document.documentElement.lang = forced === "ru" || forced === "en" ? forced : detected;
})();
