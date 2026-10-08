// GLSL for the paint studio.
//
// The sheet is a pigment field:
//   R  how much pigment lies on the paper (0 = bare)
//   G  how wet the paper is
//   BA how much of that pigment is the second and third ink (the rest is the first)
// The inks are stored premultiplied (amount of each ink, not its share), so
// pushing, stirring, bleeding and blotting move them exactly like the pigment.
// A small fluid sim moves the field, wet areas bleed, and the render pass cuts
// it into stacked washes the way the generator cuts its procedural height field,
// so every stroke dries into the same pigment drift look.

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
`;

/** Noise shared with the generator shader (same PCG lattice, so textures match). */
const NOISE = /* glsl */ `
const float TAU = 6.28318530718;
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

vec2 hash22(vec2 p) {
  uvec2 v = uvec2(ivec2(p));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return vec2(v) * (1.0 / 4294967295.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(p);
    norm += amp;
    p = ROT * p * 2.03 + vec2(17.1, 9.3);
    amp *= 0.5;
  }
  return sum / norm;
}
`;

/**
 * Pigment amount <-> the generator's wash height (0 = deepest, 1 = the palest wash's
 * edge). The last sliver of pigment stands for the mist above that edge, up to bare
 * paper at H_BARE, so soft edges and haze fade out before the pigment runs out.
 */
const HEIGHT = /* glsl */ `
const float P_EDGE = 0.08 / 1.08;
const float H_BARE = 1.4;
float heightOf(float p) {
  return p >= P_EDGE ? 1.08 - 1.08 * p : H_BARE - (H_BARE - 1.0) * p / P_EDGE;
}
float pigmentOf(float h) {
  return h <= 1.0 ? (1.08 - h) / 1.08 : P_EDGE * max(H_BARE - h, 0.0) / (H_BARE - 1.0);
}
`;

// ---------------------------------------------------------------- utilities

/**
 * Copies (and if needed rescales) a texture into a target: source texel = frag * uMap.xy + uMap.zw.
 * Beyond the source's edge its border carries on, so a grown sheet has no seam.
 */
export const COPY = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec4 uMap;
out vec4 o;
void main() {
  vec2 size = vec2(textureSize(uSrc, 0));
  vec2 p = clamp(gl_FragCoord.xy * uMap.xy + uMap.zw, vec2(0.5), size - 0.5);
  o = texture(uSrc, p / size);
}
`;

/** Fills a target with one value (clearing velocity, pressure, a blank sheet). */
export const FILL = HEAD + /* glsl */ `
uniform vec4 uValue;
out vec4 o;
void main() { o = uValue; }
`;

/**
 * The sheet in four bytes per texel, for undo snapshots and saving:
 * pigment as 16 bits, then the second and third inks' shares as 8 bits each.
 * (Wetness isn't kept: a restored sheet is dry.)
 */
export const ENCODE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
out vec4 o;
void main() {
  vec4 f = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  float v = floor(clamp(f.x * 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  vec2 share = f.x > 1e-4 ? clamp(f.zw / f.x, 0.0, 1.0) : vec2(0.0);
  o = vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, share);
}
`;

/** uInks = 0 reads the older two-byte format (pigment only, all first ink). */
export const DECODE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform float uInks;
out vec4 o;
void main() {
  vec4 b = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  float p = (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0;
  o = vec4(p, 0.0, b.zw * p * uInks);
}
`;

/** Eases the sheet toward another one (new sheets arrive by flowing into place). */
export const SETTLE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uTarget;
uniform float uAmount;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uSrc, p, 0);
  vec4 b = texelFetch(uTarget, p, 0);
  o = vec4(mix(a.x, b.x, uAmount), a.y * (1.0 - uAmount), mix(a.zw, b.zw, uAmount));
}
`;

// ---------------------------------------------------------------- fluid

const SEGMENTS = /* glsl */ `
const int MAX_SEGS = 16;
uniform int uSegCount;
uniform vec4 uSeg[MAX_SEGS];   // a.xy, b.xy in field texels

float segDist(vec2 p, vec4 s, out float along) {
  vec2 ab = s.zw - s.xy;
  float t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  along = t;
  return length(p - s.xy - ab * t);
}
`;

/** Self-advection plus the pull of every finger. Velocity is in field texels per second. */
export const VEL_STEP = HEAD + SEGMENTS + /* glsl */ `
uniform sampler2D uVel;
uniform vec2 uVelSize;
uniform vec2 uFieldSize;
uniform float uDt;
uniform float uKeep;
uniform vec4 uForce[MAX_SEGS];  // velocity.xy, radius, coupling
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uVelSize;
  vec2 v = texture(uVel, uv).xy;
  v = texture(uVel, uv - v * uDt / uFieldSize).xy * uKeep;
  vec2 q = uv * uFieldSize;
  for (int i = 0; i < MAX_SEGS; i++) {
    if (i >= uSegCount) break;
    vec4 f = uForce[i];
    if (f.w <= 0.0) continue;
    float t;
    float d = segDist(q, uSeg[i], t);
    float k = exp(-d * d / (f.z * f.z));
    v += (f.xy - v) * k * f.w;
  }
  o = vec4(v, 0.0, 1.0);
}
`;

export const CURL = HEAD + /* glsl */ `
uniform sampler2D uVel;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(uVel, 0) - 1;
  float L = texelFetch(uVel, clamp(p - ivec2(1, 0), ivec2(0), m), 0).y;
  float R = texelFetch(uVel, clamp(p + ivec2(1, 0), ivec2(0), m), 0).y;
  float T = texelFetch(uVel, clamp(p + ivec2(0, 1), ivec2(0), m), 0).x;
  float B = texelFetch(uVel, clamp(p - ivec2(0, 1), ivec2(0), m), 0).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

/** Vorticity confinement: keeps small eddies alive so stirring curls instead of smearing. */
export const VORTICITY = HEAD + /* glsl */ `
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform float uStrength;
uniform float uDt;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(uCurl, 0) - 1;
  float L = texelFetch(uCurl, clamp(p - ivec2(1, 0), ivec2(0), m), 0).x;
  float R = texelFetch(uCurl, clamp(p + ivec2(1, 0), ivec2(0), m), 0).x;
  float T = texelFetch(uCurl, clamp(p + ivec2(0, 1), ivec2(0), m), 0).x;
  float B = texelFetch(uCurl, clamp(p - ivec2(0, 1), ivec2(0), m), 0).x;
  float C = texelFetch(uCurl, p, 0).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= uStrength * C * vec2(1.0, -1.0);
  vec2 v = texelFetch(uVel, p, 0).xy + force * uDt;
  o = vec4(v, 0.0, 1.0);
}
`;

export const DIVERGENCE = HEAD + /* glsl */ `
uniform sampler2D uVel;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(uVel, 0) - 1;
  vec2 C = texelFetch(uVel, p, 0).xy;
  // Walls: the edge of the paper reflects the flow back.
  float L = p.x > 0 ? texelFetch(uVel, p - ivec2(1, 0), 0).x : -C.x;
  float R = p.x < m.x ? texelFetch(uVel, p + ivec2(1, 0), 0).x : -C.x;
  float B = p.y > 0 ? texelFetch(uVel, p - ivec2(0, 1), 0).y : -C.y;
  float T = p.y < m.y ? texelFetch(uVel, p + ivec2(0, 1), 0).y : -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

export const SCALE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform float uAmount;
out vec4 o;
void main() { o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0) * uAmount; }
`;

export const JACOBI = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(uPressure, 0) - 1;
  float L = texelFetch(uPressure, clamp(p - ivec2(1, 0), ivec2(0), m), 0).x;
  float R = texelFetch(uPressure, clamp(p + ivec2(1, 0), ivec2(0), m), 0).x;
  float T = texelFetch(uPressure, clamp(p + ivec2(0, 1), ivec2(0), m), 0).x;
  float B = texelFetch(uPressure, clamp(p - ivec2(0, 1), ivec2(0), m), 0).x;
  float div = texelFetch(uDivergence, p, 0).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uVel;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(uPressure, 0) - 1;
  float L = texelFetch(uPressure, clamp(p - ivec2(1, 0), ivec2(0), m), 0).x;
  float R = texelFetch(uPressure, clamp(p + ivec2(1, 0), ivec2(0), m), 0).x;
  float T = texelFetch(uPressure, clamp(p + ivec2(0, 1), ivec2(0), m), 0).x;
  float B = texelFetch(uPressure, clamp(p - ivec2(0, 1), ivec2(0), m), 0).x;
  vec2 v = texelFetch(uVel, p, 0).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- the sheet

/**
 * One step of the pigment field: drops push the floating pigment outward
 * (suminagashi), the water carries it, wet paper lets it bleed, brushes lay
 * it down or lift it, and everything slowly dries.
 */
export const FIELD_STEP = HEAD + NOISE + SEGMENTS + /* glsl */ `
uniform sampler2D uField;
uniform sampler2D uVel;
uniform vec2 uSize;
uniform float uDt;
uniform float uFlowing;
uniform float uBleed;        // 0..1 how far wet pigment spreads
uniform float uDryKeep;      // wetness multiplier this step
uniform vec2 uSeedOff;
uniform float uUnit;         // one sheet unit, in field texels

const int MAX_DROPS = 4;
uniform int uDropCount;
uniform vec4 uDrop[MAX_DROPS];     // center.xy, r0^2, r1^2 (texels)
uniform vec4 uDropInk[MAX_DROPS];  // pigment, edge softness (texels), kind (0 ink, 1 water), ink slot

uniform vec4 uSegP[MAX_SEGS];      // radius, target pigment, strength, kind + 4 * ink slot (kinds: 0 paint, 1 water, 2 lift)

out vec4 o;

vec4 fieldAt(vec2 p) { return texture(uField, p / uSize); }

/** What a pigment amount p of ink "slot" stores in the BA channels. */
vec2 inkOf(float slot, float p) {
  return vec2(slot > 0.5 && slot < 1.5 ? p : 0.0, slot > 1.5 ? p : 0.0);
}

// Catmull-Rom (9 bilinear taps), clamped to the four nearest texels. Plain bilinear
// resampling every frame would slowly blur the rings and folds away.
vec4 fieldSharp(vec2 p) {
  vec2 pos = p - 0.5;
  vec2 i = floor(pos);
  vec2 f = pos - i;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (i - 0.5) / uSize;
  vec2 t3 = (i + 2.5) / uSize;
  vec2 t12 = (i + 0.5 + w2 / w12) / uSize;
  vec4 r =
      (texture(uField, vec2(t0.x, t0.y)) * w0.x + texture(uField, vec2(t12.x, t0.y)) * w12.x + texture(uField, vec2(t3.x, t0.y)) * w3.x) * w0.y
    + (texture(uField, vec2(t0.x, t12.y)) * w0.x + texture(uField, vec2(t12.x, t12.y)) * w12.x + texture(uField, vec2(t3.x, t12.y)) * w3.x) * w12.y
    + (texture(uField, vec2(t0.x, t3.y)) * w0.x + texture(uField, vec2(t12.x, t3.y)) * w12.x + texture(uField, vec2(t3.x, t3.y)) * w3.x) * w3.y;
  ivec2 m = ivec2(uSize) - 1;
  ivec2 b = ivec2(i);
  vec4 a = texelFetch(uField, clamp(b, ivec2(0), m), 0);
  vec4 c = texelFetch(uField, clamp(b + ivec2(1, 0), ivec2(0), m), 0);
  vec4 d = texelFetch(uField, clamp(b + ivec2(0, 1), ivec2(0), m), 0);
  vec4 e = texelFetch(uField, clamp(b + ivec2(1, 1), ivec2(0), m), 0);
  return clamp(r, min(min(a, c), min(d, e)), max(max(a, c), max(d, e)));
}

void main() {
  vec2 q = gl_FragCoord.xy;
  vec2 src = q;

  // Drops: every point outside a growing drop is pushed outward so the area is
  // conserved, which squeezes the existing washes into rings around it.
  float inkCov = 0.0, inkVal = 0.0, inkKind = 0.0, inkSlot = 0.0;
  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrop[i];
    vec2 rel = src - d.xy;
    float ds = max(dot(rel, rel), 1e-6);
    if (ds < d.w) {
      float r1 = sqrt(d.w);
      float cov = 1.0 - smoothstep(r1 - uDropInk[i].y, r1, sqrt(ds));
      if (cov > inkCov) { inkCov = cov; inkVal = uDropInk[i].x; inkKind = uDropInk[i].z; inkSlot = uDropInk[i].w; }
    }
    src = d.xy + rel * sqrt(max(1.0 - (d.w - d.z) / max(ds, d.w), 0.0));
  }

  if (uFlowing > 0.5) src -= texture(uVel, src / uSize).xy * uDt;
  // Untouched texels are copied exactly (and cheaply); only moved ones are resampled.
  vec4 f = length(src - q) < 0.002 ? texelFetch(uField, ivec2(q), 0) : fieldSharp(src);

  // Wet paper: pigment creeps outward into the wet, unevenly along the paper fibers.
  // The creep only ever adds, so a stroke's core keeps its color while its edge
  // softens into nested washes; a little true diffusion smooths the result. Creeping
  // pigment takes on the mix of inks it came from.
  if (f.y > 0.002) {
    float r = 1.0 + 1.6 * uBleed;
    vec4 n = (fieldAt(src + vec2(r, 0.0)) + fieldAt(src - vec2(r, 0.0))
            + fieldAt(src + vec2(0.0, r)) + fieldAt(src - vec2(0.0, r))) * 0.25;
    vec4 lap = n - f;
    float fiber = 0.35 + 1.0 * smoothstep(-0.5, 0.6, gnoise(q * 0.07 + uSeedOff) + 0.45 * gnoise(q * 0.23 + 5.0));
    float wet = clamp(f.y * 1.4, 0.0, 1.0) * fiber;
    float creep = wet * uBleed * 0.3 * max(lap.x, 0.0);
    f.x += wet * 0.05 * lap.x + creep;
    f.zw += wet * 0.05 * lap.zw + creep * n.zw / max(n.x, 1e-4);
    f.y += lap.y * 0.22;
  }

  if (inkCov > 0.0) {
    if (inkKind < 0.5) {
      f.x = mix(f.x, inkVal, inkCov);
      f.zw = mix(f.zw, inkOf(inkSlot, inkVal), inkCov);
    } else {
      f.xzw *= 1.0 - 0.96 * inkCov;
    }
    // Drops float rather than soak in, so their rings stay crisp.
    f.y = max(f.y, (inkKind < 0.5 ? 0.3 : 0.45) * inkCov);
  }

  // Brush texture, worked out once per texel the first time a brush comes near.
  float rag = 0.0, swell = 0.0, bloom = 0.0;
  bool shaped = false;
  for (int i = 0; i < MAX_SEGS; i++) {
    if (i >= uSegCount) break;
    vec4 sp = uSegP[i];
    float t;
    float d = segDist(q, uSeg[i], t);
    if (d > sp.x * 2.2) continue;
    if (!shaped) {
      vec2 S = q / uUnit;
      // Ragged like the generator's washes: billows, fringes and fine tatters.
      rag = fbm(S * 5.0 + uSeedOff, 3) * 0.45 + gnoise(q * 0.05 + uSeedOff.yx) * 0.13 + gnoise(q * 0.16 + 7.0) * 0.05;
      // Never quite even inside: the load swells and thins like its turbulence.
      swell = fbm(S * 3.0 + uSeedOff.yx + 4.4, 2) * 0.7 + gnoise(S * 9.0 + uSeedOff + 1.9) * 0.3;
      // And the paper takes the water unevenly, so the edge softens in some places more than others.
      bloom = smoothstep(-0.4, 0.4, gnoise(S * 2.2 + uSeedOff * 0.7 + 11.0));
      shaped = true;
    }
    float kind = mod(sp.w, 4.0);
    float slot = floor(sp.w / 4.0);
    float dn = d / sp.x + rag;
    float cov = 1.0 - smoothstep(0.5, 1.0, dn);
    // Dry-brush streaks run along the stroke.
    vec2 ab = uSeg[i].zw - uSeg[i].xy;
    float side = dot(q - uSeg[i].xy, vec2(-ab.y, ab.x)) / max(length(ab), 1e-3) / sp.x;
    float bristle = length(ab) > 0.5 ? 0.7 + 0.6 * smoothstep(-0.4, 0.4, gnoise(vec2(side * 3.2, 0.5) + uSeedOff)) : 1.0;
    if (kind < 0.5) {
      float tgt = max(sp.y + (0.04 + 0.08 * sp.y) * swell, 0.0);
      // The core takes the pan's pigment (and can lighten what's there)...
      float k = clamp((1.0 - smoothstep(0.2, 0.55, dn)) * sp.z * bristle, 0.0, 1.0);
      f.x = mix(f.x, tgt, k);
      f.zw = mix(f.zw, inkOf(slot, tgt), k);
      // ...and around it the wash thins out the way the generator's do: a firm edge
      // for deep pigment, then a pale skirt that fades into mist, wider where the
      // paper drinks more. It only adds.
      float skirt = (0.08 + 0.14 * bloom) * (1.0 - 0.5 * smoothstep(0.3, 0.9, sp.y));
      float shape = 1.1 * (1.0 - smoothstep(0.4, 1.0, dn)) + skirt * (1.0 - smoothstep(0.7, 1.2 + 0.6 * bloom, dn));
      float add = min(tgt, shape) - f.x;
      if (add > 0.0) {
        f.x += add;
        f.zw += inkOf(slot, add);
      }
      f.y = max(f.y, (1.0 - smoothstep(1.0, 1.8, dn)) * 0.95);
    } else if (kind < 1.5) {
      f.y = max(f.y, (1.0 - smoothstep(0.6, 1.25, dn)) * 0.45);
    } else {
      f.xzw *= 1.0 - cov * sp.z;
      f.y *= 1.0 - cov * 0.5;
    }
  }

  f.y = max(f.y * uDryKeep - uDt * 0.02, 0.0);
  f.x = clamp(f.x, 0.0, 1.4);
  // The inks can never add up to more than the pigment that's there.
  f.zw = max(f.zw, 0.0);
  f.zw *= min(1.0, f.x / max(f.z + f.w, 1e-5));
  o = f;
}
`;

/**
 * A generator composition as a starting sheet: the generator's turbulent height
 * field (and its current) converted to pigment, so "Paint this" picks up the
 * piece you were looking at.
 */
export const COMPOSE = HEAD + NOISE + HEIGHT + /* glsl */ `
uniform vec2 uView;       // the viewport, in field texels
uniform vec2 uViewOff;    // its bottom-left corner inside the field
uniform vec2 uSeedOff;
uniform int uAnchor;
uniform float uCoverage, uRidge, uScale, uWarp, uFeather, uMotion;
uniform float uRiver, uRiverWidth, uRiverMeander, uRiverDepth, uRiverTilt;
out vec4 o;

float riverLine(float x, float base, float horizon, vec2 orb) {
  float k = 4.6 / uScale;
  float wave = sin(x * k + uSeedOff.x * 0.37 + orb.x * 0.6) * 0.7
             + fbm(vec2(x * k * 0.45, 3.7) + uSeedOff * 0.21 + orb * 0.3, 2) * 0.8;
  float y0 = base + uRiverTilt * 0.55 * x;
  float persp = clamp(1.0 - y0 / max(horizon, 0.05), 0.15, 1.0);
  return y0 + uRiverMeander * 0.24 * uScale * wave * (0.3 + 0.7 * persp);
}

void main() {
  vec2 frag = gl_FragCoord.xy - uViewOff;
  vec2 res = uView;
  float unit = min(res.x, res.y);
  vec2 P;
  float extent;
  if (uAnchor == 1) {
    P = vec2((0.5 * res.x - frag.x) / unit, (res.y - frag.y) / unit); extent = res.y / unit;
  } else if (uAnchor == 2) {
    P = vec2((0.5 * res.y - frag.y) / unit, frag.x / unit); extent = res.x / unit;
  } else if (uAnchor == 3) {
    P = vec2((frag.y - 0.5 * res.y) / unit, (res.x - frag.x) / unit); extent = res.x / unit;
  } else {
    P = vec2((frag.x - 0.5 * res.x) / unit, frag.y / unit); extent = res.y / unit;
  }
  float hz = max(uCoverage * extent, 0.05);
  vec2 Q = P / uScale;
  vec2 orb = vec2(1.0, 0.0) * uMotion * 0.55;
  vec2 orb2 = vec2(cos(2.1), sin(2.1)) * uMotion * 0.4;

  vec2 q = vec2(
    fbm(Q * 0.9 + uSeedOff + orb, 4),
    fbm(Q * 0.9 + uSeedOff.yx + vec2(5.2, 1.3) - orb, 4));
  vec2 r = vec2(
    fbm(Q * 1.7 + 1.6 * q + uSeedOff + vec2(1.7, 9.2) + orb2, 3),
    fbm(Q * 1.7 + 1.6 * q + uSeedOff + vec2(8.3, 2.8) - orb2, 3));
  vec2 W = P + uWarp * uScale * vec2(0.22, 0.12) * (r + 0.5 * q);
  float rag = fbm(Q * 5.0 + uSeedOff * 1.3 + r * 0.7, 5);
  float ragFine = gnoise(Q * 40.0 + uSeedOff + r * 3.0);
  float depth = W.y + uFeather * uScale * (rag * 0.07 + ragFine * 0.01);
  float turb = fbm(W * 1.2 / uScale + q * 0.3 + uSeedOff + vec2(4.4, 1.9) + orb * 0.4, 5);
  float slope = (hash12(uSeedOff * 0.73) - 0.5) * 1.1;
  float H = depth / hz + uRidge * (0.55 * turb + slope * W.x * 0.45 / hz);

  if (uRiver > 0.001) {
    float rBase = hz * mix(0.08, 0.8, uRiverDepth);
    float x = W.x;
    float e = 0.01;
    float yc = riverLine(x, rBase, hz, orb);
    float slopeR = (riverLine(x + e, rBase, hz, orb) - riverLine(x - e, rBase, hz, orb)) / (2.0 * e);
    float dist = (depth - yc) / sqrt(1.0 + slopeR * slopeR);
    float persp = clamp(1.0 - yc / hz, 0.0, 1.0);
    float width = uRiverWidth * uScale * mix(0.12, 1.05, persp);
    width *= 0.7 + 0.6 * smoothstep(-0.5, 0.5, gnoise(vec2(x * 2.2 / uScale, 9.1) + uSeedOff));
    float ad = abs(dist) + (rag * 0.025 + ragFine * 0.006) * uFeather * uScale + 0.4 * ragFine * width * 0.22;
    float fade = smoothstep(hz * 1.08, hz * 0.65, yc) * smoothstep(-0.05, 0.05, yc);
    // A wider bank than the generator's: the washes cut it a little crisper.
    float lift = (1.0 - smoothstep(width * 0.35, width * 1.15, ad)) * fade * uRiver;
    // The lifted current keeps a pale tint of pigment, like the generator's: just
    // inside the palest wash nearby, fading to haze in the distance.
    H = mix(H, max(H, 0.985 + 0.08 * (1.0 - persp)), clamp(lift, 0.0, 1.0));
  }
  o = vec4(clamp(pigmentOf(H), 0.0, 1.3), 0.0, 0.0, 0.0);
}
`;

/** Shared by the paper, flow and render passes: screen -> sheet mapping. */
const MAPPING = /* glsl */ `
uniform vec4 uMap;          // field texel = frag * uMap.xy + uMap.zw
uniform float uUnit;        // one sheet unit, in field texels
uniform vec2 uSeedOff;
`;

/**
 * Paper: everything that never moves, baked once per canvas size.
 *   r: edge grit   g: granulation   b: brush relief light   a: grain & cockling
 */
export const PAPER = HEAD + NOISE + MAPPING + /* glsl */ `
uniform float uPx;
out vec4 o;
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 css = frag / uPx;
  vec2 S = (frag * uMap.xy + uMap.zw) / uUnit;

  float grit = gnoise(css * 0.55 + 13.0) * 0.6 + gnoise(css * 0.21 + 5.0) * 0.4;
  float ragFine = gnoise(S * 40.0 + uSeedOff);
  float edge = 0.6 * grit + 0.4 * ragFine;

  float g1 = gnoise(css * 0.45 + uSeedOff * 3.0);
  float g2 = gnoise(css * 0.14 + 7.0);
  float speck = smoothstep(0.25, 0.75, gnoise(css * 0.8 + 21.0));
  float gran = 0.1 * (0.6 * g1 + 0.4 * g2) + 0.12 * speck;

  vec2 bp = mat2(0.866, 0.5, -0.5, 0.866) * css;
  float h = gnoise(bp * vec2(0.09, 0.42)) * 0.5 + gnoise(css * 0.5 + 3.0) * 0.5;
  vec3 nrm = normalize(vec3(-dFdx(h) * uPx, -dFdy(h) * uPx, 0.6));
  float light = dot(nrm, vec3(-0.451, 0.551, 0.702)) - 0.702;

  float grain = gnoise(css * 0.95) * 0.55 + gnoise(css * 0.3 + 3.0) * 0.45;
  float fiber = gnoise(vec2(css.x * 0.05, css.y * 0.55) + 9.0);
  float paper = 0.045 * grain + 0.018 * fiber + 0.03 * fbm(S * 1.4 + 40.0, 2);

  o = vec4(edge * 0.5 + 0.5, (gran + 0.15) / 0.4, clamp(light * 0.5 + 0.6, 0.0, 1.0), paper * 4.0 + 0.5);
}
`;

/**
 * Flow: the slow, breathing noise fields, at a quarter of the resolution.
 *   0: breathing offset (field texels), rag, turbulence
 *   1: hue drift, mottling, mist, edge softness
 *   2: two pairs of noises the washes mix into their own edge wobble and load
 */
export const FLOW = HEAD + NOISE + MAPPING + /* glsl */ `
uniform float uTime;
uniform float uDrift;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main() {
  vec2 S = (gl_FragCoord.xy * uMap.xy + uMap.zw) / uUnit;
  float ang = uTime * TAU / 26.0;
  vec2 orb = vec2(cos(ang), sin(ang)) * uDrift * 0.55;
  vec2 orb2 = vec2(cos(ang + 2.1), sin(ang + 2.1)) * uDrift * 0.4;
  vec2 q = vec2(fbm(S * 0.9 + uSeedOff + orb, 3), fbm(S * 0.9 + uSeedOff.yx + vec2(5.2, 1.3) - orb, 3));
  vec2 r = vec2(
    fbm(S * 1.7 + 1.6 * q + uSeedOff + vec2(1.7, 9.2) + orb2, 3),
    fbm(S * 1.7 + 1.6 * q + uSeedOff + vec2(8.3, 2.8) - orb2, 3));
  vec2 warp = uDrift * vec2(0.016, 0.012) * (r + 0.5 * q) * uUnit;
  float rag = fbm(S * 5.0 + uSeedOff * 1.3 + r * 0.7, 4);
  float turb = fbm(S * 1.2 + q * 0.3 + uSeedOff + vec2(4.4, 1.9) + orb * 0.4, 4);
  o0 = vec4(warp, rag, turb);

  float driftN = fbm(S * 0.7 + q * 0.45 + uSeedOff + vec2(3.1, 7.7) + orb * 0.7, 3);
  float mottle = fbm(S * 14.0 + r * 2.0 + uSeedOff * 0.7 + orb * 0.3, 3);
  float mistN = fbm(vec2(S.x * 1.6, S.y * 3.6) + uSeedOff + orb * 0.6 + r * 0.5, 3);
  float softN = fbm(S * 1.3 + uSeedOff + vec2(11.0, 4.0), 2);
  o1 = vec4(driftN, mottle, mistN, softN);

  o2 = vec4(
    gnoise(S * 1.8 + uSeedOff + vec2(5.3, 3.7) + orb * 0.35),
    gnoise(S * 2.6 + uSeedOff + vec2(1.1, 8.4) - orb * 0.4),
    fbm(S * 2.0 + uSeedOff + vec2(11.0, 2.0) + orb * 0.5, 2),
    fbm(S * 2.3 + uSeedOff + vec2(3.0, 13.0) - orb * 0.5, 2));
}
`;

/**
 * The look: the generator's wash stack, fed by the painted field instead of
 * procedural noise. Bare paper stays bare; edges are as soft as the generator's
 * (softer still while wet) and pool into darker rims as they dry.
 */
export const RENDER = HEAD + MAPPING + HEIGHT + /* glsl */ `
uniform sampler2D uField;
uniform sampler2D uPaperTex;
uniform sampler2D uFlow0;
uniform sampler2D uFlow1;
uniform sampler2D uFlow2;
uniform vec2 uFieldSize;
uniform vec2 uRes;
uniform vec3 uPaper;        // linear rgb
uniform vec3 uLab[15];      // three inks, each five OKLab colors, deepest -> palest
uniform int uLayers;
uniform float uEdge, uTexture, uHueDrift, uMist, uRidge, uFeather, uDensity;
out vec4 fragColor;

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

// This pixel's share of each ink (set once per pixel in main).
vec3 inkShare = vec3(1.0, 0.0, 0.0);

// x in 0..4 along the ramps (0 = deepest), the inks mixed in OKLab by their shares.
vec3 pigment(float x) {
  x = clamp(x, 0.0, 4.0);
  int a = int(min(floor(x), 3.0));
  float f = x - float(a);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lab = inkShare.x * mix(uLab[a], uLab[a + 1], f)
           + inkShare.y * mix(uLab[a + 5], uLab[a + 6], f)
           + inkShare.z * mix(uLab[a + 10], uLab[a + 11], f);
  return max(oklabToLinear(lab), vec3(0.0));
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hAt(vec2 t) { return heightOf(texture(uField, t / uFieldSize).x); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 suv = frag / uRes;
  vec4 paperT = texelFetch(uPaperTex, ivec2(frag), 0);
  vec4 f0 = texture(uFlow0, suv);
  vec2 ft = frag * uMap.xy + uMap.zw;
  vec2 at = ft + f0.xy;

  vec4 fv = texture(uField, at / uFieldSize);
  float pv = fv.x;
  float wet = fv.y;
  vec2 other = pv > 1e-4 ? clamp(fv.zw / pv, 0.0, 1.0) : vec2(0.0);
  inkShare = vec3(max(1.0 - other.x - other.y, 0.0), other);

  float edgeN = paperT.r * 2.0 - 1.0;
  vec3 col = uPaper;
  float pig = 0.0;

  if (pv > 1e-4) {
    vec4 f1 = texture(uFlow1, suv);
    vec4 f2 = texture(uFlow2, suv);
    float rag = f0.z;
    float turb = f0.w;
    float driftN = f1.x;
    float paperLum = dot(uPaper, vec3(0.2126, 0.7152, 0.0722));
    // Organic wobble on the slopes only: bare paper stays bare, solid cores stay solid.
    float body = clamp(pv * (1.25 - pv) * 3.2, 0.0, 1.0);
    float H = heightOf(pv) + (uRidge * 0.1 * turb + uFeather * 0.035 * rag) * body;
    // How fast the height changes, per sheet unit (the generator's is about 1.8).
    vec2 g = vec2(hAt(at + vec2(1.0, 0.0)) - hAt(at - vec2(1.0, 0.0)),
                  hAt(at + vec2(0.0, 1.0)) - hAt(at - vec2(0.0, 1.0))) * 0.5 * uUnit;
    float slope = length(g);
    float gH = max(slope, 1.6);
    // Softness is the generator's, measured in height, scaled by how steeply the
    // pigment falls toward each wash's own edge (looked at a few texels out). A
    // steep bank melts the washes it cuts through instead of leaving a rim of each
    // one's color, while a flat wash beside it stays whole, and flat pigment (which
    // the generator never has) stays crisp instead of dissolving into grain.
    float H0 = heightOf(pv);
    vec2 dir = slope > 1e-3 ? g / slope : vec2(0.0);
    float slopeUp = max(hAt(at + dir * 4.0) - H0, 0.0) * uUnit / 4.0;
    float slopeDown = max(H0 - hAt(at - dir * 4.0), 0.0) * uUnit / 4.0;
    // Crisp edges catch on the paper's tooth, a pixel or two either way.
    float tooth = edgeN * 0.0025 * min(slope, 40.0);
    float dry = 1.0 - smoothstep(0.0, 0.5, wet);

    int L = uLayers;
    float denom = float(max(L - 1, 1));
    for (int i = 0; i < 7; i++) {
      if (i >= L) break;
      float fl = float(i);
      float fi = fl / denom;
      float ph = fl * 2.4;
      float thr = mix(1.0, 0.14, pow(fi, 0.85));
      float own = f2.x * cos(ph) + f2.y * sin(ph);
      float dH = thr + 0.03 * own * body - H;

      float soft = mix(0.05, 0.012, fi) * (0.4 + 1.2 * uMist * (1.0 - fi));
      soft *= mix(0.4, 2.0, smoothstep(-0.45, 0.45, f1.w + 0.35 * sin(fl * 2.3)));
      soft *= 1.0 + wet;
      float toward = min(slope, mix(slopeDown, slopeUp, smoothstep(-0.03, 0.03, thr - H)));
      float sH = min(soft * clamp(toward, 0.35, 8.0), 0.19);
      float m = smoothstep(-sH, sH, dH + sH * 0.9 * edgeN + tooth);
      if (m <= 0.0) continue;
      float inside = dH / gH;

      float wash = 0.82 + 0.28 * (f2.z * cos(ph * 1.3 + 1.0) + f2.w * sin(ph * 1.3 + 1.0));
      // Pigment pools along the rim, measured in height like the generator's, so a
      // steep edge (a lifted current, a stroke) gets a hairline, not a dark band.
      float pool = uEdge * dry * exp(-max(dH, 0.0) / (0.022 + 0.5 * sH)) * min(1.0, 3.0 / gH);
      float a = clamp(m * (wash * mix(0.7, 1.15, fi) * uDensity + 0.4 * pool), 0.0, 1.0);

      float idx = mix(clamp(H, 0.0, 1.1) * 3.8, (1.0 - fi) * 3.6 + 0.2, 0.35);
      idx += uHueDrift * driftN * 3.4;
      idx -= clamp(inside * 1.5, 0.0, 0.6);
      vec3 lc = pigment(idx);
      lc = mix(lc, pigment(idx - 1.2) * 0.85, clamp(pool * 0.7, 0.0, 0.7));

      vec3 glaze = col * lc / max(uPaper, vec3(0.03));
      vec3 paint = mix(lc, glaze, 0.28 * paperLum);
      col = mix(col, paint, a);
      pig = pig + a * (1.0 - pig);
    }

    col *= 1.0 - pig * (0.16 * rag + 0.12 * f1.y);

    // Mist, as in the generator: a granular haze where the palest wash dissolves
    // into paper, and a veil over the far washes.
    float mistN = f1.z;
    float mistBand = 1.0 - smoothstep(-0.05, 0.06 + 0.3 * uMist, H - 1.0 + mistN * 0.12);
    float wisp = smoothstep(-0.25, 0.55, mistN + 0.2) * (0.75 + 0.5 * edgeN);
    vec3 mistCol = mix(uPaper, pigment(3.5 + uHueDrift * driftN * 1.5), 0.55);
    col = mix(col, mistCol, clamp(mistBand * wisp * uMist * 0.6 * (1.0 - pig), 0.0, 1.0));
    float veil = smoothstep(0.5, 1.02, H) * wisp;
    col = mix(col, mistCol, clamp(veil * uMist * 0.28 * pig, 0.0, 1.0));

    // Wet paint reads a little deeper.
    col *= 1.0 - 0.08 * wet * pig;
  }

  float gran = paperT.g * 0.4 - 0.15;
  float light = (paperT.b - 0.6) * 2.0;
  float grain = (paperT.a - 0.5) * 0.25;
  float tooth = pig * (0.6 + 0.8 * (1.0 - pig));
  col *= 1.0 - 1.1 * uTexture * tooth * gran;
  col *= 1.0 + 0.9 * uTexture * mix(0.15, 1.0, pig) * light * 0.5;
  col *= 1.0 + 0.9 * uTexture * grain;

  vec3 outc = toSrgb(col) + (hash12(frag) - 0.5) / 255.0;
  fragColor = vec4(outc, 1.0);
}
`;
