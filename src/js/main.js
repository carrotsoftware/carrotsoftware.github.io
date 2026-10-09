/* ==========================================================================
   Carrot Documentation — live background, liquid glass and transitions

   1. Background: long cloth folds in the colors of background.png that slowly
      flow (WebGL).
   2. Mouse movement gently bends the folds, and the whole background drifts
      after the cursor by inertia; then everything smoothly settles back.
   3. Clicking the logo floods the background with a pastel four-color gradient.
   4. The logo and buttons are "liquid glass": refraction at the edges, a soft
      blur, color dispersion and a thin outline with a highlight.
   5. Pressing a section button: it fills with the section color from the
      edges to the center while the background repaints in the same color in
      a wave starting from the button; once the background is repainted, the
      other elements dissolve. Then the haze bursts out with a soft edge to
      cover the screen, the section opens in a new tab, and the landing page
      returns to gray under the haze.
   6. When the window crosses the width breakpoint, the buttons smoothly move
      from a row to a column and back.
   7. The tab icon is a live copy of the logo: the glass circle with the
      background under it.

   The background scale doesn't depend on the window size: the pattern is
   anchored to the top left corner and gets cropped, not squeezed, when the
   window shrinks.

   Rendering takes two passes: the scene is drawn into a lower-resolution
   texture (the background is soft anyway), then composited to the screen at
   full resolution together with the glass. Without WebGL (or until the
   browser restores a lost context) the fallback from styles.css is shown;
   the rest of the logic doesn't depend on WebGL.
   ========================================================================== */

(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Glass elements: the logo and the section buttons. Their count sets the
  // array sizes in the shader, so a new button gets glass automatically
  const glassElements = Array.from(document.querySelectorAll(".glass"));
  const GLASS_SHAPES = Math.max(glassElements.length, 1);

  /* ---------- Settings ----------
     Everything that affects the look and motion is collected here. styles.css
     (:root) holds the glass blur, the transition haze blur and puffs, and the
     dissolve effect. */

  // Background
  const SCENE_SCALE = 0.6;       // background resolution relative to the screen (it's soft, 0.6 is enough)
  const FIELD_UNIT = 900;        // px — pattern scale: larger means bigger folds
  const MAX_DPR = 2;             // pixel density cap for the glass
  const TIME_SPEED = 1;          // background flow speed
  const FOLD_RELIEF = 7;         // fold relief: smaller means deeper folds, larger means flatter
  const PALETTE = ["#B700FF", "#43C2F0", "#A1FF4E", "#FF6262"]; // colorful mode colors
  const VIVID_SATURATION = 0.55; // colorful mode saturation: 0 — gray, 1 — original colors
  const VIVID_PASTEL = 0.22;     // how far colors fade to pastel: 0 — not at all, 1 — almost white
  const REVEAL_MS = 1800;        // color flood after clicking the logo
  const VIVID_SPOT_SIZE = 1;     // size of color spots: larger means wider, smoother transitions

  // Mouse
  const TRAIL_SIZE = 32;         // points in the cursor trail
  const TRAIL_STEP = 18;         // px between trail points
  const TRAIL_LIFE_MS = 2600;    // how long the folds take to settle back
  const TRAIL_RADIUS = 0.3;      // cursor influence radius, as a fraction of FIELD_UNIT
  const PUSH = 1.0;              // how strongly the cursor bends the folds (0 — off)
  const MAX_PUSH_PX = 40;        // cap on the cursor speed taken into account, px per frame
  const DRIFT = 0.04;            // how far the whole background drifts after the cursor
  const DRIFT_DAMPING = 1.5;     // how fast that drift fades (per second)

  // Glass: logo and buttons
  // px — blur behind the glass. Read from --glass-blur in styles.css so the
  // WebGL glass and the backdrop-filter fallback match
  const GLASS_BLUR = parseFloat(getComputedStyle(root).getPropertyValue("--glass-blur")) || 16;
  const GLASS_BLUR_SAMPLES = 24; // blur samples: more is smoother on strong blur, but heavier
  const GLASS_REFRACTION = 0.6;  // refraction strength at the edges (0 — none)
  const GLASS_BEVEL = 14;        // px — width of the refraction zone at the edge
  const GLASS_DISPERSION = 2.5;  // px — color dispersion at the edge
  const GLASS_LIGHTEN = 0.025;   // how much lighter the glass is than the background
  const GLASS_RIM = 0.6;         // brightness of the outline highlight
  const GLASS_RIM_WIDTH = 1.25;  // px — outline width
  const GLASS_HOVER_GLOW = 0.2;  // brightness of the glow around on hover

  // Section transition
  const BUTTON_FILL_MS = 650;    // button fill from the edges to the center
  const BURST_MS = 480;          // burst of the fill to the whole screen
  const DISSOLVE_LEAD_MS = 250;  // how long other elements dissolve before the burst starts
  const BURST_SOFTNESS = 160;    // px — softness of the burst edge (the button melts into the haze)
  const SECTION_SWITCH_MS = 700; // background repaint to the section color (runs with the button fill)

  // Section colors. The key is the data-color value of a button in index.html.
  // background — average cloth tone of the background after the transition;
  // fill — button fill and full-screen haze (the last number is the density);
  // text — label color over the fill (white by default);
  // relief — fold depth in this color: 1 — same as gray, smaller — softer
  const SECTION_COLORS = {
    gray:  { background: "rgb(97, 97, 97)",      fill: "rgba(64, 64, 64, 0.72)" },
    navy:  { background: "rgba(39, 50, 68, 1)",  fill: "rgba(39, 50, 68, 0.72)" },
    black: { background: "rgba(29, 29, 31, 1)",  fill: "rgba(29, 29, 31, 0.72)" },
    beige: { background: "rgb(178, 158, 136)",   fill: "rgba(178, 158, 136, 0.72)", relief: 0.6 },
  };
  const CURTAIN_HOLD_MS = 450;   // how long the fill stays full-screen after the tab opens
  const CURTAIN_FADE_MS = 650;   // fade-out of the fill
  const HAZE_START_SCALE = 0.35; // how tightly the puffs gather around the button at the start
  const FILL_SOFTNESS = 28;      // px — softness of the fill front inside the button

  // Rearranging the buttons when the window width changes
  const LAYOUT_MORPH_MS = 650;   // how long the buttons travel to their new places
  const LAYOUT_MORPH_STAGGER_MS = 60; // delay between buttons — they move one after another

  // Rendering
  const MAX_FPS = 60;            // on 120+ Hz monitors the background isn't drawn more often — saves the GPU

  // Tab icon
  const FAVICON_SIZE = 64;       // px — icon resolution
  const FAVICON_INTERVAL_MS = 1000; // how often the icon follows the background

  // Number for a shader literal (GLSL needs a decimal point in floats)
  const glsl = (value) => Number(value).toFixed(4);

  /* ---------- Shaders ---------- */

  const VERTEX = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  // Pass 1: background into a texture
  const SCENE = `
    precision highp float;
    #define TRAIL ${TRAIL_SIZE}

    uniform vec2 uRes;
    uniform float uUnit;          // scene pixels per pattern unit
    uniform float uTime;
    uniform vec4 uTrail[TRAIL];   // xy — position, zw — cursor velocity
    uniform float uTrailStrength[TRAIL]; // point strength 0..1
    uniform float uBrush;         // 1 / radius² of the cursor influence
    uniform float uPush;
    uniform vec2 uDrift;          // overall background shift by inertia
    uniform vec2 uVividOrigin;    // where the color flood starts (the logo)
    uniform float uVividRadius;   // radius of that wave
    uniform vec3 uFabric;         // current average cloth tone
    uniform vec3 uFabricNext;     // average cloth tone of the section being painted in
    uniform vec2 uRelief;         // fold depth: x — current, y — section
    uniform vec2 uSectionOrigin;  // where the section color wave starts (the button)
    uniform float uSectionRadius; // radius of that wave
    uniform vec3 uPalette[4];

    vec2 hash2(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0)), f - vec2(1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
      }
      return v;
    }

    // Cloth height: folds stretched along the diagonal, their bend slowly drifts
    const vec2 ALONG = vec2(0.8944, 0.4472);
    const vec2 ACROSS = vec2(-0.4472, 0.8944);

    float cloth(vec2 p, float t) {
      float a = dot(p, ALONG);
      float c = dot(p, ACROSS);
      float bend = fbm(vec2(a * 0.45 + t * 0.03, c * 0.8 - t * 0.02));
      float ripple = fbm(vec2(a * 0.7 - t * 0.025, c * 1.5) + 4.0);
      float folds = 0.7 * sin(c * 5.0 + bend * 6.5 + t * 0.12)
                  + 0.3 * sin(c * 11.0 + ripple * 8.0 - t * 0.09 + 1.7);
      // Soft cross wrinkles make the cloth look slightly crumpled
      float wrinkle = sin(dot(p, vec2(0.6, -0.8)) * 6.0 + ripple * 5.0 + t * 0.05);
      return folds + 0.12 * wrinkle;
    }

    // Brightness-preserving mix: green + coral give yellow, not brown
    vec3 blend(vec3 a, vec3 b, float k) {
      vec3 c = mix(a, b, k);
      float peak = mix(max(a.r, max(a.g, a.b)), max(b.r, max(b.g, b.b)), k);
      return c * peak / max(max(c.r, max(c.g, c.b)), 1e-3);
    }

    vec3 palette(float x) {
      x = fract(x) * 4.0;
      float k = smoothstep(0.0, 1.0, fract(x));
      if (x < 1.0) return blend(uPalette[0], uPalette[1], k);
      if (x < 2.0) return blend(uPalette[1], uPalette[2], k);
      if (x < 3.0) return blend(uPalette[2], uPalette[3], k);
      return blend(uPalette[3], uPalette[0], k);
    }

    void main() {
      // Pattern coordinates: from the top left corner, Y up, constant scale —
      // when the window changes, the pattern gets cropped, not squeezed
      vec2 screen = vec2(gl_FragCoord.x, gl_FragCoord.y - uRes.y) / uUnit;
      // Position on the 1400 × 900 mockup: for the soft light towards the bottom right
      vec2 uv = vec2(screen.x * ${glsl(FIELD_UNIT / 1400)}, 1.0 + screen.y * ${glsl(FIELD_UNIT / 900)});
      float t = uTime;

      // The cursor gently bends the folds along its path; as the trail points
      // fade, the cloth settles back. The force falls off smoothly without a
      // plateau and varies across the area, so the influence doesn't read as a circle
      vec2 flow = vec2(0.0);
      float total = 0.0;
      for (int i = 0; i < TRAIL; i++) {
        vec2 d = screen - uTrail[i].xy;
        float w = uTrailStrength[i] * exp(-dot(d, d) * uBrush);
        flow += uTrail[i].zw * w;
        total += w;
      }
      vec2 push = flow / max(total, 1e-4) * (total / (1.0 + total)) * uPush;
      push *= 0.65 + 0.7 * noise(screen * 2.5 + t * 0.1);
      vec2 p = screen - push - uDrift;

      // Cloth and its lighting
      float e = 0.004;
      float h = cloth(p, t);
      vec2 slope = vec2(cloth(p + vec2(e, 0.0), t) - h, cloth(p + vec2(0.0, e), t) - h) / e;
      vec3 n = normalize(vec3(-slope, ${glsl(FOLD_RELIEF)}));
      vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
      float diffuse = clamp(dot(n, light), 0.0, 1.0);
      float sheen = pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 36.0);
      float fall = clamp(0.5 + 0.45 * (uv.x - uv.y), 0.0, 1.0); // lighter towards the bottom right

      // Gray mode: #3a3a3a … #858585
      float g = 0.17 + 0.2 * diffuse + 0.05 * (0.5 + 0.5 * h) + 0.1 * sheen + 0.08 * fall;
      float tone = clamp(g, 0.2, 0.56) / 0.38; // 1 — average cloth tone
      vec3 fabric = uFabric * (1.0 + (tone - 1.0) * uRelief.x);
      vec3 fabricNext = uFabricNext * (1.0 + (tone - 1.0) * uRelief.y);

      // Colorful mode: large soft spots of pastel colors, shaded by the folds.
      // The spots are large and irregular: noise warped by another noise
      vec2 hp = p * (0.32 / ${glsl(VIVID_SPOT_SIZE)});
      vec2 warp = vec2(fbm(hp * 0.8 + vec2(t * 0.012, 0.0)), fbm(hp * 0.8 + vec2(5.2, -t * 0.01)));
      float hue = 1.0 * fbm(hp + 1.6 * warp) + 0.08 * dot(p, ALONG) + t * 0.015;
      vec3 vivid = palette(hue);
      vivid = mix(vec3(dot(vivid, vec3(0.299, 0.587, 0.114))), vivid, ${glsl(VIVID_SATURATION)});
      vivid = mix(vivid, vec3(0.8), ${glsl(VIVID_PASTEL)});
      vivid *= 0.8 + 0.17 * diffuse + 0.05 * sheen;

      // The color flood spreads from the logo in a wave with a ragged edge
      float dist = length(screen - uVividOrigin) + 0.15 * fbm(screen * 1.3 + t * 0.05);
      float m = 1.0 - smoothstep(uVividRadius - 0.35, uVividRadius, dist);
      vec3 color = mix(fabric, vivid, m);

      // The section color spreads from the pressed button in a wave
      float sectionDist = length(screen - uSectionOrigin) + 0.15 * fbm(screen * 1.3 - t * 0.05);
      float w = 1.0 - smoothstep(uSectionRadius - 0.35, uSectionRadius, sectionDist);

      gl_FragColor = vec4(mix(color, fabricNext, w), 1.0);
    }
  `;

  // Pass 2: background to the screen + liquid glass over the logo and buttons
  const COMPOSITE = `
    precision highp float;
    #define SHAPES ${GLASS_SHAPES}

    uniform sampler2D uScene;
    uniform vec2 uRes;
    uniform float uPx;               // canvas pixels per CSS pixel
    uniform vec4 uShape[SHAPES];     // center, half size
    uniform float uShapeRadius[SHAPES]; // corner radius
    uniform float uHover[SHAPES];    // hover 0..1
    uniform float uVisible[SHAPES];  // visibility 0..1 (dissolving during the transition)

    float sdRound(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    vec3 scene(vec2 frag) {
      return texture2D(uScene, frag / uRes).rgb;
    }

    void main() {
      vec2 frag = gl_FragCoord.xy;
      vec3 color = scene(frag);

      // Hover glow; also find the nearest shape
      float d = 1e5;
      vec2 c = vec2(0.0);
      vec2 b = vec2(1.0);
      float r = 0.0;
      float hover = 0.0;
      float visible = 1.0;
      float glow = 0.0;
      for (int i = 0; i < SHAPES; i++) {
        float di = sdRound(frag - uShape[i].xy, uShape[i].zw, uShapeRadius[i]);
        glow += uHover[i] * uVisible[i] * exp(-max(di, 0.0) / (12.0 * uPx));
        if (di < d) {
          d = di;
          c = uShape[i].xy;
          b = uShape[i].zw;
          r = uShapeRadius[i];
          hover = uHover[i];
          visible = uVisible[i];
        }
      }
      color += ${glsl(GLASS_HOVER_GLOW)} * glow * step(0.0, d);

      if (d < 1.0 * uPx && visible > 0.001) {
        // Edge normal and lens profile: a narrow bend at the edge, flat in the middle
        vec2 n = normalize(vec2(
          sdRound(frag + vec2(1.0, 0.0) - c, b, r) - sdRound(frag - vec2(1.0, 0.0) - c, b, r),
          sdRound(frag + vec2(0.0, 1.0) - c, b, r) - sdRound(frag - vec2(0.0, 1.0) - c, b, r)
        ) + 1e-6);
        float bevelWidth = min(min(b.x, b.y) * 0.35, ${glsl(GLASS_BEVEL)} * uPx);
        float depth = clamp(-d / bevelWidth, 0.0, 1.0);
        float bevel = 1.0 - sqrt(1.0 - (1.0 - depth) * (1.0 - depth));

        // Refraction at the edge and a slight magnification
        vec2 bend = -n * bevel * bevelWidth * ${glsl(GLASS_REFRACTION)} - (frag - c) * 0.02;
        float split = bevel * ${glsl(GLASS_DISPERSION)} * uPx; // color dispersion at the edge

        // Blur: samples along a spiral
        vec3 glass = vec3(0.0);
        float blurRadius = ${glsl(GLASS_BLUR)} * uPx;
        for (int k = 0; k < ${GLASS_BLUR_SAMPLES}; k++) {
          float fk = float(k);
          float ang = fk * 2.39996;
          vec2 o = vec2(cos(ang), sin(ang)) * sqrt((fk + 0.5) / ${glsl(GLASS_BLUR_SAMPLES)}) * blurRadius;
          vec2 at = frag + bend + o;
          glass.r += scene(at - n * split).r;
          glass.g += scene(at).g;
          glass.b += scene(at + n * split).b;
        }
        glass /= ${glsl(GLASS_BLUR_SAMPLES)};
        glass = glass * 1.03 + ${glsl(GLASS_LIGHTEN)} + 0.03 * hover;

        // Thin outline: a highlight where the edge faces the light, almost gone on the sides
        vec2 lightDir = normalize(vec2(-0.6, 0.8));
        float facing = dot(n, lightDir);
        float angle = pow(abs(facing), 3.0) * (facing > 0.0 ? 1.0 : 0.5);
        float rim = 1.0 - smoothstep(0.0, ${glsl(GLASS_RIM_WIDTH)} * uPx, -d);
        glass += rim * (0.03 + ${glsl(GLASS_RIM)} * angle) * (1.0 + 0.5 * hover);

        float coverage = clamp(0.5 - d / uPx, 0.0, 1.0) * visible;
        color = mix(color, glass, coverage);
      }

      // Dithering against banding in the gradient
      color += (fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  /* ---------- Utilities ---------- */

  // "#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)" → [r, g, b] from 0 to 1
  const parseColor = (value) => {
    if (value.startsWith("#")) {
      const n = parseInt(value.slice(1), 16);
      return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    return value.match(/[\d.]+/g).slice(0, 3).map((part) => Number(part) / 255);
  };

  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  /* ---------- Logo: colorful mode toggle ---------- */

  const logoButton = document.querySelector(".logo__mark");
  let isVivid = false;

  // Background state drawn by WebGL: cloth tone, the section color wave and
  // the share of the colorful mode
  const sceneState = {
    fabric: parseColor(SECTION_COLORS.gray.background),
    relief: 1,
    next: null,        // cloth tone of the section while the wave is running
    nextRelief: 1,
    origin: null,      // the button the wave starts from
    progress: 0,       // 0..1 — wave progress
    vividAmount: 0,    // 0..1 — progress of the color flood from the logo
  };

  const setVivid = (on) => {
    isVivid = on;
    root.classList.toggle("is-vivid", on);
    logoButton.setAttribute("aria-pressed", String(on));
  };

  logoButton.addEventListener("click", () => setVivid(!isVivid));

  /* ---------- Section buttons: fill with the section color, then burst ---------- */

  const curtain = document.querySelector(".curtain");
  const haze = curtain.querySelector(".haze");
  const pressLabel = document.querySelector(".press-label");
  const sectionLinks = Array.from(document.querySelectorAll(".button"));
  const dissolvable = [
    logoButton,
    document.querySelector(".logo__title"),
    ...sectionLinks,
    document.querySelector(".caption"),
  ];
  let activeTransition = null; // { rafId } of the running transition

  // The transition was reset (e.g. the page came back from the cache) — its remaining steps are skipped
  const TRANSITION_CANCELLED = new Error("Transition cancelled");

  // The haze puffs move with a CSS animation; its speed is ramped up and down
  // so the motion starts and stops without jerks
  const hazeMotion = Array.from(haze.children).flatMap((puff) => puff.getAnimations());
  const setHazeSpeed = (rate) => hazeMotion.forEach((animation) => { animation.playbackRate = rate; });
  setHazeSpeed(0);

  // Frame-by-frame animation bound to the running transition. If the
  // transition is reset, the promise rejects with TRANSITION_CANCELLED;
  // if a frame throws, it rejects with that error
  const tween = (duration, easing, onFrame) => new Promise((resolve, reject) => {
    const owner = activeTransition;
    const start = performance.now();
    // Time comes from performance.now(): in some browsers the frame timestamp lags behind it
    const step = () => {
      if (activeTransition !== owner) {
        reject(TRANSITION_CANCELLED);
        return;
      }
      const progress = Math.min(1, (performance.now() - start) / duration);
      try {
        onFrame(easing(progress));
      } catch (error) {
        reject(error);
        return;
      }
      if (progress < 1) {
        owner.rafId = requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    owner.rafId = requestAnimationFrame(step);
  });

  // The other elements dissolve into the background (the effect itself is the .is-dissolving class in CSS)
  const dissolveOthers = (chosen) => {
    dissolvable.forEach((element) => element.classList.toggle("is-dissolving", element !== chosen));
  };
  const restoreAll = () => dissolvable.forEach((element) => element.classList.remove("is-dissolving", "is-pressed"));

  const resetTransition = () => {
    if (activeTransition) cancelAnimationFrame(activeTransition.rafId);
    activeTransition = null;
    curtain.classList.remove("is-active");
    curtain.removeAttribute("style");
    haze.removeAttribute("style");
    pressLabel.removeAttribute("style");
    setHazeSpeed(0);
    restoreAll();
    Object.assign(sceneState, {
      fabric: parseColor(SECTION_COLORS.gray.background),
      relief: 1,
      next: null,
      origin: null,
      progress: 0,
    });
  };

  // A mask of four soft bands growing inwards from the button edges
  const edgeMask = (inset) => {
    const band = (side) => `linear-gradient(to ${side}, #000 ${inset - FILL_SOFTNESS}px, transparent ${inset}px)`;
    return [band("bottom"), band("top"), band("right"), band("left")].join(", ");
  };

  // The mask sits exactly over the button; rect = null removes the mask
  const setMask = (image, rect) => {
    const size = rect ? `${rect.width}px ${rect.height}px` : "";
    const position = rect ? `${rect.left}px ${rect.top}px` : "";
    for (const prefix of ["webkitMask", "mask"]) {
      curtain.style[`${prefix}Image`] = image;
      curtain.style[`${prefix}Size`] = size;
      curtain.style[`${prefix}Position`] = position;
      curtain.style[`${prefix}Repeat`] = rect ? "no-repeat" : "";
    }
  };

  // Fast start and soft stop — like a blast wave
  const easeBurst = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

  const playTransition = async (link) => {
    const rect = link.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(link).borderTopLeftRadius) || 0;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // A rectangle with a blurred edge: two soft bands intersected by the mask;
    // clip-path rounds the corners while the edge is still sharp
    const softRect = (left, top, right, bottom, soft, round) => {
      const across = (from, to) =>
        `transparent ${from - soft}px, #000 ${from}px, #000 ${to}px, transparent ${to + soft}px`;
      const image = `linear-gradient(to right, ${across(left, right)}), `
        + `linear-gradient(to bottom, ${across(top, bottom)})`;
      for (const prefix of ["webkitMask", "mask"]) {
        curtain.style[`${prefix}Image`] = image;
        curtain.style[`${prefix}Size`] = "";
        curtain.style[`${prefix}Position`] = "";
        curtain.style[`${prefix}Repeat`] = "no-repeat";
      }
      curtain.style.webkitMaskComposite = "source-in";
      curtain.style.maskComposite = "intersect";
      curtain.style.clipPath = `inset(${top - soft}px ${viewportW - right - soft}px `
        + `${viewportH - bottom - soft}px ${left - soft}px round ${round + soft}px)`;
    };
    const clip = (k) => {
      curtain.style.clipPath = `inset(${rect.top * (1 - k)}px ${(viewportW - rect.right) * (1 - k)}px `
        + `${(viewportH - rect.bottom) * (1 - k)}px ${rect.left * (1 - k)}px round ${radius * (1 - k)}px)`;
    };

    // The puffs start gathered around the button, then spread over the whole screen
    const shiftX = rect.left + rect.width / 2 - viewportW / 2;
    const shiftY = rect.top + rect.height / 2 - viewportH / 2;
    const placeHaze = (k) => {
      haze.style.setProperty("--haze-x", `${shiftX * (1 - k)}px`);
      haze.style.setProperty("--haze-y", `${shiftY * (1 - k)}px`);
      haze.style.setProperty("--haze-scale", String(HAZE_START_SCALE + (1 - HAZE_START_SCALE) * k));
    };

    // The button label and outline stay visible over the fill: the copy sits
    // exactly over the button with the same padding and line breaks.
    // innerText takes only the visible text — the label of the active language
    pressLabel.textContent = link.querySelector(".button__label").innerText.trim();
    Object.assign(pressLabel.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderRadius: `${radius}px`,
    });

    const sectionColor = SECTION_COLORS[link.dataset.color] || SECTION_COLORS.gray;
    const sectionFabric = parseColor(sectionColor.background);
    const sectionRelief = sectionColor.relief ?? 1;
    curtain.style.backgroundColor = sectionColor.fill;
    pressLabel.style.color = sectionColor.text || "";

    // Hide the button's own label and glass under the fill: otherwise the
    // haze blur smears them into a light spot
    link.classList.add("is-pressed");

    // At the same time: 1) the button fills with the section color from the
    // edges to the center, 2) the background repaints in the same color in a
    // wave from the button
    placeHaze(0);
    clip(0);
    setMask(edgeMask(0), rect);
    curtain.classList.add("is-active");
    const fullInset = rect.height / 2 + FILL_SOFTNESS * 1.2;
    const fill = tween(BUTTON_FILL_MS, easeInOut, (k) => {
      setMask(edgeMask(k * fullInset), rect);
      setHazeSpeed(k);
    });
    // A fill error is handled by the await below; without this, if the
    // repaint fails first, the browser reports an unhandled promise rejection
    fill.catch(() => {});

    const sameColor = sectionFabric.every((channel, i) => Math.abs(channel - sceneState.fabric[i]) < 0.002)
      && sectionRelief === sceneState.relief;
    let recolor = Promise.resolve();
    if (isVivid || !sameColor) {
      Object.assign(sceneState, { next: sectionFabric, nextRelief: sectionRelief, origin: link, progress: 0 });
      recolor = tween(SECTION_SWITCH_MS, easeInOut, (k) => { sceneState.progress = k; });
    }

    // The background is repainted — make the section color the main one and
    // only now dissolve the other elements
    await recolor;
    if (sceneState.next) {
      Object.assign(sceneState, {
        fabric: sceneState.next,
        relief: sceneState.nextRelief,
        next: null,
        origin: null,
        progress: 0,
        vividAmount: 0,
      });
      setVivid(false);
    }
    dissolveOthers(link);

    await Promise.all([fill, tween(DISSOLVE_LEAD_MS, (x) => x, () => {})]);
    setMask("", null);

    // Burst: the haze with a blurred edge spreads from the button over the
    // whole screen, and the button and its label melt into it
    const reach = Math.max(rect.left, rect.top, viewportW - rect.right, viewportH - rect.bottom) + BURST_SOFTNESS;
    await tween(BURST_MS, (x) => x, (x) => {
      const k = easeBurst(x);
      const soft = BURST_SOFTNESS * Math.min(1, x * 3);
      const grow = k * reach;
      softRect(rect.left - grow, rect.top - grow, rect.right + grow, rect.bottom + grow, soft, radius);
      placeHaze(k);
      const fade = Math.min(1, x / 0.55);
      pressLabel.style.opacity = String(1 - fade);
      pressLabel.style.filter = `blur(${fade * 10}px)`;
    });
    setMask("", null);
    curtain.style.clipPath = "none";
  };

  // The landing page returns to its initial state: under the haze the
  // background smoothly turns gray, then the haze fades away. While the new
  // tab is open, the browser pauses animations here — the user sees the haze
  // fade when they come back
  const fadeOutCurtain = async () => {
    const from = sceneState.fabric.slice();
    const fromRelief = sceneState.relief;
    const gray = parseColor(SECTION_COLORS.gray.background);
    // The haze is translucent, so it is made fully opaque at the same time:
    // the gray doesn't show through and the visible section color doesn't change
    const [r, g, b, alpha = 1] = curtain.style.backgroundColor.match(/[\d.]+/g).map(Number);
    await tween(CURTAIN_HOLD_MS, easeInOut, (k) => {
      sceneState.fabric = from.map((channel, i) => channel + (gray[i] - channel) * k);
      sceneState.relief = fromRelief + (1 - fromRelief) * k;
      curtain.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alpha + (1 - alpha) * k})`;
    });
    restoreAll();
    await tween(CURTAIN_FADE_MS, easeInOut, (k) => {
      curtain.style.opacity = String(1 - k);
      setHazeSpeed(1 - k);
    });
  };

  // Opens the section in a new tab. If the browser blocks it (Safari is
  // stricter about opening tabs with a delay after the click), opens it in
  // this tab and returns false
  const openSection = (link) => {
    const tab = window.open(link.href, "_blank");
    if (!tab) {
      window.location.href = link.href;
      return false;
    }
    tab.opener = null;
    return true;
  };

  sectionLinks.forEach((link) => {
    link.addEventListener("click", async (event) => {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (event.defaultPrevented || event.button !== 0 || modified) return;
      if (reduceMotion.matches) return;

      event.preventDefault();
      if (activeTransition) return;
      const current = (activeTransition = { rafId: 0 });
      let opened = false;
      let leavingPage = false; // the section opens in this tab — keep the curtain

      try {
        await playTransition(link);
        opened = true;
        leavingPage = !openSection(link);
        if (!leavingPage) await fadeOutCurtain();
      } catch (error) {
        if (error === TRANSITION_CANCELLED) return;
        // The animation broke — the section still opens: the link must always work
        console.error("Section transition failed:", error);
        if (!opened) leavingPage = !openSection(link);
      } finally {
        if (!leavingPage && activeTransition === current) resetTransition();
      }
    });
  });

  // Coming back from the browser's back-forward cache — remove the curtain
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resetTransition();
  });

  /* ---------- Viewport changes ----------
     Handled in a ResizeObserver on <html> rather than in the resize event: an
     observer runs after layout and before the frame is painted in every
     browser, while Firefox fires resize later, after the new layout has
     already been shown for a frame */

  // Identifies the screen: changes with the zoom, the monitor or the device
  // orientation. The orientation comes from the screen, not from the window,
  // so a desktop window that becomes wider than tall doesn't count. On iOS
  // the screen size doesn't change on rotation, so the orientation is needed
  const screenKey = () => {
    const orientation = screen.orientation ? screen.orientation.type : String(window.orientation ?? "");
    return `${window.devicePixelRatio}|${screen.availWidth}x${screen.availHeight}|${orientation}`;
  };

  /* Layout height. The logo and buttons are centered on the tallest window
     height seen on this screen. So when the window is made shorter from the
     bottom, they don't move — only the caption rises */

  let layoutHeight = 0;
  let layoutKey = "";

  const updateLayoutHeight = () => {
    const key = screenKey();
    if (key !== layoutKey) {
      layoutKey = key;
      layoutHeight = 0;
    }
    if (window.innerHeight > layoutHeight) {
      layoutHeight = window.innerHeight;
      root.style.setProperty("--layout-height", `${layoutHeight}px`);
    }
  };
  updateLayoutHeight();

  /* Smooth button rearrangement. The layout is switched by this script (the
     .is-stacked class on <html>), not by a CSS media query: the class change
     and the start of the animation happen in the same step, so no frame can
     show the new layout before the animation starts. With a media query that
     happens in Firefox on Windows: while a window grows, it paints the new
     area right away, before the scripts of that frame run.
     The elements are measured in the old layout, the layout is switched, and
     they smoothly travel from the old places to the new ones (the FLIP
     technique). The WebGL glass reads the button positions every frame, so
     it travels with them */

  const navItems = Array.from(document.querySelectorAll(".nav__item"));
  const morphing = [document.querySelector(".header"), ...navItems, document.querySelector(".footer")];

  // The buttons fit in a row while there is at least one button gap on each
  // side. Computed from the CSS sizes, so adding a button moves the
  // breakpoint automatically (three buttons: 3 × 350 + 4 × 40 = 1210px)
  const shouldStack = () => {
    const css = getComputedStyle(root);
    const width = parseFloat(css.getPropertyValue("--button-width"));
    const gap = parseFloat(css.getPropertyValue("--button-gap"));
    const count = navItems.length;
    return window.innerWidth < count * width + (count + 1) * gap;
  };

  const measure = () => morphing.map((element) => {
    const rect = element.getBoundingClientRect();
    return [rect.left, rect.top];
  });

  let layoutStacked = shouldStack();
  root.classList.toggle("is-stacked", layoutStacked);
  root.classList.add("has-layout-script"); // from now on the CSS fallback breakpoint is off

  const switchLayout = (stacked) => {
    // Where the elements are on screen right now, including a move still in progress
    const from = measure();
    morphing.forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
    root.classList.toggle("is-stacked", stacked);
    if (reduceMotion.matches) return;

    const to = measure();
    morphing.forEach((element, i) => {
      const dx = from[i][0] - to[i][0];
      const dy = from[i][1] - to[i][1];
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const order = navItems.indexOf(element);
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        {
          duration: LAYOUT_MORPH_MS,
          delay: order > 0 ? order * LAYOUT_MORPH_STAGGER_MS : 0,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        }
      );
    });
  };

  new ResizeObserver(() => {
    updateLayoutHeight();
    const stacked = shouldStack();
    if (stacked !== layoutStacked) {
      layoutStacked = stacked;
      switchLayout(stacked);
    }
  }).observe(root);

  /* ---------- WebGL ----------
     Everything below works only with WebGL. Without it — or while the context
     is lost — the page shows the fallback from styles.css (background.webp and
     glass via backdrop-filter), and everything above keeps working */

  const canvas = document.querySelector(".backdrop");
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });

  const setWebGLMode = (on) => {
    root.classList.toggle("has-webgl", on);
    root.classList.toggle("no-webgl", !on);
  };

  const createProgram = (fragmentSource) => {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, "");
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  };

  /* Sizes. viewW × viewH is the canvas size in CSS pixels; it can be larger
     than the window (see "Canvas size" below) */

  let viewW = 0;
  let viewH = 0;
  let sceneW = 1;
  let sceneH = 1;
  let pixelRatio = 1;

  /* WebGL resources. They live inside the context: after it is lost (a driver
     crash, low memory on a phone) they have to be created again */

  let sceneProgram = null;
  let compositeProgram = null;
  let sceneTexture = null;
  let sceneFramebuffer = null;

  const initGL = () => {
    sceneProgram = createProgram(SCENE);
    compositeProgram = createProgram(COMPOSITE);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(sceneProgram.program);
    gl.uniform3fv(sceneProgram.uniforms.uPalette, new Float32Array(PALETTE.flatMap(parseColor)));
    gl.uniform1f(sceneProgram.uniforms.uBrush, 1 / (TRAIL_RADIUS * TRAIL_RADIUS));
    gl.uniform1f(sceneProgram.uniforms.uPush, PUSH);
    gl.useProgram(compositeProgram.program);
    gl.uniform1i(compositeProgram.uniforms.uScene, 0);

    sceneTexture = gl.createTexture();
    sceneFramebuffer = gl.createFramebuffer();
    viewW = 0; // the scene texture is created on the first frame
    viewH = 0;
  };

  const resize = () => {
    viewW = canvas.clientWidth;
    viewH = canvas.clientHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(viewW * pixelRatio));
    canvas.height = Math.max(1, Math.round(viewH * pixelRatio));
    sceneW = Math.max(1, Math.round(viewW * SCENE_SCALE));
    sceneH = Math.max(1, Math.round(viewH * SCENE_SCALE));

    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sceneW, sceneH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
  };

  // Screen coordinates → pattern coordinates (from the top left corner, Y up)
  const toField = (x, y) => [x / FIELD_UNIT, -y / FIELD_UNIT];

  /* Cursor influence */

  const trailPos = new Float32Array(TRAIL_SIZE * 4);
  const trailStrength = new Float32Array(TRAIL_SIZE);
  const trailWeight = new Float32Array(TRAIL_SIZE);
  const trailLife = new Float32Array(TRAIL_SIZE); // 1 → 0 over TRAIL_LIFE_MS
  const drift = { x: 0, y: 0, vx: 0, vy: 0 };
  let trailHead = 0;
  let pointer = null;
  let lastPoint = null;

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen" || event.buttons) {
      pointer = { x: event.clientX, y: event.clientY };
    }
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    pointer = null;
    lastPoint = null;
  });

  // Point velocity is the cursor shift per frame in pattern units
  const pushTrailPoint = (x, y, dirX, dirY, speed) => {
    const [fx, fy] = toField(x, y);
    const shift = Math.min(speed, MAX_PUSH_PX) / FIELD_UNIT;
    const i = trailHead * 4;
    trailPos[i] = fx;
    trailPos[i + 1] = fy;
    trailPos[i + 2] = dirX * shift;
    trailPos[i + 3] = -dirY * shift;
    trailWeight[trailHead] = 0.5 + 0.5 * Math.min(speed / 30, 1);
    trailLife[trailHead] = 1;
    trailHead = (trailHead + 1) % TRAIL_SIZE;
  };

  const updatePointer = (dt) => {
    for (let i = 0; i < TRAIL_SIZE; i++) {
      trailLife[i] = Math.max(0, trailLife[i] - (dt * 1000) / TRAIL_LIFE_MS);
      // Smooth fade: holds at first, then gently lets go
      const life = trailLife[i];
      trailStrength[i] = trailWeight[i] * life * life * (3 - 2 * life);
    }

    // Inertia: the background drifts after the cursor and smoothly stops
    const damping = Math.exp(-dt * DRIFT_DAMPING);
    drift.vx *= damping;
    drift.vy *= damping;
    drift.x += drift.vx * dt;
    drift.y += drift.vy * dt;

    if (!pointer || reduceMotion.matches) return;
    if (!lastPoint) {
      lastPoint = { ...pointer };
      return;
    }
    const dx = pointer.x - lastPoint.x;
    const dy = pointer.y - lastPoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance < TRAIL_STEP) return;

    drift.vx += (dx / FIELD_UNIT) * DRIFT;
    drift.vy -= (dy / FIELD_UNIT) * DRIFT;

    // A sharp mouse jerk is split into several points
    const steps = Math.min(6, Math.floor(distance / TRAIL_STEP));
    const speed = distance / Math.max(dt * 60, 1);
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      pushTrailPoint(lastPoint.x + dx * k, lastPoint.y + dy * k, dx / distance, dy / distance, speed);
    }
    lastPoint = { ...pointer };
  };

  /* Background repaint waves: the color flood from the logo and the section color from a button */

  // Element center in pattern coordinates and the distance to the farthest screen corner
  const waveFrom = (element) => {
    const rect = element.getBoundingClientRect();
    const ox = rect.left + rect.width / 2;
    const oy = rect.top + rect.height / 2;
    const farthest = Math.hypot(Math.max(ox, viewW - ox), Math.max(oy, viewH - oy)) / FIELD_UNIT;
    return { center: toField(ox, oy), reach: farthest + 0.8 };
  };

  const updateWaves = (dt) => {
    const target = isVivid ? 1 : 0;
    if (reduceMotion.matches) {
      sceneState.vividAmount = target;
    } else if (sceneState.vividAmount !== target) {
      const step = (dt * 1000) / REVEAL_MS;
      sceneState.vividAmount = target > sceneState.vividAmount
        ? Math.min(target, sceneState.vividAmount + step)
        : Math.max(target, sceneState.vividAmount - step);
    }

    const uniforms = sceneProgram.uniforms;
    const vividWave = waveFrom(logoButton);
    gl.uniform2fv(uniforms.uVividOrigin, vividWave.center);
    gl.uniform1f(uniforms.uVividRadius, easeInOut(sceneState.vividAmount) * vividWave.reach - 0.4);

    gl.uniform3fv(uniforms.uFabric, sceneState.fabric);
    gl.uniform3fv(uniforms.uFabricNext, sceneState.next || sceneState.fabric);
    gl.uniform2f(uniforms.uRelief, sceneState.relief, sceneState.next ? sceneState.nextRelief : sceneState.relief);
    if (sceneState.next && sceneState.origin) {
      const sectionWave = waveFrom(sceneState.origin);
      gl.uniform2fv(uniforms.uSectionOrigin, sectionWave.center);
      gl.uniform1f(uniforms.uSectionRadius, sceneState.progress * sectionWave.reach - 0.4);
    } else {
      gl.uniform1f(uniforms.uSectionRadius, -1);
    }
  };

  /* Glass shapes: the logo and the section buttons */

  const shapes = new Float32Array(GLASS_SHAPES * 4);
  const shapeRadii = new Float32Array(GLASS_SHAPES);
  const hoverAmount = new Float32Array(GLASS_SHAPES);
  const glassVisibility = new Float32Array(GLASS_SHAPES).fill(1);
  const logoIndex = glassElements.indexOf(logoButton);
  const canHover = window.matchMedia("(hover: hover)");

  // The corner radius is read from CSS only when the element size changes
  const radiusCache = new WeakMap();
  const cornerRadius = (element, rect) => {
    const cached = radiusCache.get(element);
    if (cached && cached.width === rect.width && cached.height === rect.height) return cached.radius;
    const value = getComputedStyle(element).borderTopLeftRadius;
    const radius = (parseFloat(value) || 0) * (value.endsWith("%") ? rect.width / 100 : 1);
    radiusCache.set(element, { width: rect.width, height: rect.height, radius });
    return radius;
  };

  const updateShapes = (dt) => {
    glassElements.forEach((element, i) => {
      const rect = element.getBoundingClientRect();
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      shapes[i * 4] = (rect.left + halfW) * pixelRatio;
      shapes[i * 4 + 1] = (viewH - rect.top - halfH) * pixelRatio;
      shapes[i * 4 + 2] = halfW * pixelRatio;
      shapes[i * 4 + 3] = halfH * pixelRatio;
      shapeRadii[i] = Math.min(cornerRadius(element, rect), halfW, halfH) * pixelRatio;

      // On touch screens :hover sticks after a tap, so it only counts with a mouse
      const hovered = canHover.matches && element.matches(":hover");
      const target = hovered || element.matches(":focus-visible") ? 1 : 0;
      hoverAmount[i] += (target - hoverAmount[i]) * Math.min(1, dt * 10);

      // The glass dissolves together with the element (in about the same time as in CSS)
      const shown = element.matches(".is-dissolving, .is-pressed") ? 0 : 1;
      glassVisibility[i] += (shown - glassVisibility[i]) * Math.min(1, dt * 7);
    });
  };

  /* Tab icon: a live copy of the logo ----------
     Once a second the logo circle, together with the glass and the background
     under it, is copied from the canvas and the mark is drawn on top. While
     the tab is in the background, the icon doesn't change. Without WebGL the
     static favicon.svg / favicon.ico stay */

  const faviconLink = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
  const faviconCanvas = document.createElement("canvas");
  faviconCanvas.width = FAVICON_SIZE;
  faviconCanvas.height = FAVICON_SIZE;
  const faviconContext = faviconCanvas.getContext("2d");
  const logoIcon = logoButton.querySelector(".logo__icon");
  const logoIconPaths = Array.from(logoIcon.querySelectorAll("path"), (path) => new Path2D(path.getAttribute("d")));
  const [iconX, iconY, iconW, iconH] = logoIcon.getAttribute("viewBox").split(" ").map(Number);
  let faviconAt = -Infinity;

  const updateFavicon = (now) => {
    if (!faviconLink || now - faviconAt < FAVICON_INTERVAL_MS) return;
    if (activeTransition || glassVisibility[logoIndex] < 0.99) return;
    const rect = logoButton.getBoundingClientRect();
    if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) return;
    faviconAt = now;

    const size = FAVICON_SIZE;
    const scale = size / rect.width;
    const ctx = faviconContext;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(canvas, rect.left * pixelRatio, rect.top * pixelRatio,
      rect.width * pixelRatio, rect.height * pixelRatio, 0, 0, size, size);
    ctx.restore();

    // The mark is centered in the circle with the same proportions as on the page
    const icon = logoIcon.getBoundingClientRect();
    ctx.save();
    ctx.translate((icon.left - rect.left) * scale, (icon.top - rect.top) * scale);
    ctx.scale(icon.width * scale / iconW, icon.height * scale / iconH);
    ctx.translate(-iconX, -iconY);
    ctx.fillStyle = "#ffffff";
    logoIconPaths.forEach((path) => ctx.fill(path));
    ctx.restore();

    // The live icon replaces the static ones, otherwise the browser may keep showing a fallback
    document.querySelectorAll('link[rel="icon"]').forEach((other) => {
      if (other !== faviconLink) other.remove();
    });
    faviconLink.type = "image/png";
    faviconLink.href = faviconCanvas.toDataURL("image/png");
  };

  /* Render loop */

  let time = Math.random() * 100;
  let previous = 0;
  let lastRender = -Infinity;
  let rafId = 0;
  let running = false;

  const draw = (now) => {
    const dt = Math.min((now - previous) / 1000, 0.1);
    previous = now;

    if (canvas.clientWidth !== viewW || canvas.clientHeight !== viewH) resize();
    if (!reduceMotion.matches) time += dt * TIME_SPEED;

    updatePointer(dt);
    updateShapes(dt);

    // Pass 1: scene into the texture
    const scene = sceneProgram.uniforms;
    gl.useProgram(sceneProgram.program);
    updateWaves(dt);
    gl.uniform2f(scene.uRes, sceneW, sceneH);
    gl.uniform1f(scene.uUnit, FIELD_UNIT * sceneH / viewH);
    gl.uniform1f(scene.uTime, time);
    gl.uniform4fv(scene.uTrail, trailPos);
    gl.uniform1fv(scene.uTrailStrength, trailStrength);
    gl.uniform2f(scene.uDrift, drift.x, drift.y);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
    gl.viewport(0, 0, sceneW, sceneH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2: to the screen with the glass
    const composite = compositeProgram.uniforms;
    gl.useProgram(compositeProgram.program);
    gl.uniform2f(composite.uRes, canvas.width, canvas.height);
    gl.uniform1f(composite.uPx, pixelRatio);
    gl.uniform4fv(composite.uShape, shapes);
    gl.uniform1fv(composite.uShapeRadius, shapeRadii);
    gl.uniform1fv(composite.uHover, hoverAmount);
    gl.uniform1fv(composite.uVisible, glassVisibility);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // The canvas is read right after drawing — before the frame is handed to the screen
    updateFavicon(now);
  };

  const canDraw = () => running && !gl.isContextLost() && canvas.clientWidth > 0;

  const render = (now) => {
    rafId = requestAnimationFrame(render);
    // On 120+ Hz monitors draw at most MAX_FPS times per second
    if (now - lastRender < 1000 / MAX_FPS - 1 || !canDraw()) return;
    lastRender = now;
    draw(now);
  };

  /* Canvas size. The canvas covers the largest window seen on this screen
     and never shrinks with it — a smaller window just crops it. Otherwise,
     while the window is being resized, the browser stretches the previous
     frame to the new size until WebGL draws the next one, and the glass
     slides away from the button text. On every viewport change the frame is
     also redrawn right away: the observer runs after layout and before the
     frame is painted, so the glass always matches the buttons */

  let canvasW = 0;
  let canvasH = 0;
  let canvasKey = "";

  const updateCanvasSize = () => {
    const key = screenKey();
    if (key !== canvasKey) {
      canvasKey = key;
      canvasW = 0;
      canvasH = 0;
    }
    const width = Math.max(canvasW, window.innerWidth);
    const height = Math.max(canvasH, window.innerHeight);
    if (width === canvasW && height === canvasH) return;
    canvasW = width;
    canvasH = height;
    root.style.setProperty("--canvas-width", `${width}px`);
    root.style.setProperty("--canvas-height", `${height}px`);
  };
  updateCanvasSize();

  // Created after the layout observer above, so it runs after it: the
  // buttons already have their FLIP transforms when the glass is redrawn
  new ResizeObserver(() => {
    updateCanvasSize();
    if (canDraw()) draw(performance.now());
  }).observe(root);

  const start = () => {
    if (running) return;
    running = true;
    previous = performance.now();
    lastRender = -Infinity;
    rafId = requestAnimationFrame(render);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
  };

  // The context is lost — show the fallback; when the browser restores it,
  // recreate the resources and carry on
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault(); // without this the browser won't restore the context
    stop();
    setWebGLMode(false);
  });

  canvas.addEventListener("webglcontextrestored", () => {
    try {
      initGL();
      setWebGLMode(true);
      start();
    } catch (error) {
      console.warn("Could not restore the animated background:", error);
    }
  });

  try {
    if (!gl) throw new Error("WebGL is not available");
    initGL();
    setWebGLMode(true);
    start();
  } catch (error) {
    console.warn("Animated background disabled:", error);
    setWebGLMode(false);
  }
})();
