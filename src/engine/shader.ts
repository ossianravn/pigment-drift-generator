// GLSL for the pigment drift look. One full-screen pass:
//   1. domain-warped noise gives the swirling, wet-in-wet structure
//   2. stacked ridge "washes" (back = pale & misty, front = deep & dense)
//   3. a lifted, meandering current with flowing streaks
//   4. paper: granulation, grain, brush relief, edge pooling
// Animation loops seamlessly: every time-varying input is driven by a point
// travelling once around a circle per loop, so frame N equals frame 0.

export const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;        // drawing buffer size, device px
uniform vec2 uView;       // full composition size (differs from uRes when tiling)
uniform vec2 uViewOff;    // offset of this buffer inside the composition
uniform float uPx;        // device px per CSS px (keeps grain a physical size)
uniform float uPhase;     // loop phase 0..1
uniform vec2 uSeedOff;
uniform vec3 uPaper;      // linear rgb
uniform vec3 uLab[5];     // palette in OKLab, foreground -> horizon
uniform int uAnchor;      // 0 bottom, 1 top, 2 left, 3 right
uniform int uLayers;
uniform float uCoverage, uRidge, uScale, uWarp, uMist;
uniform float uDensity, uHueDrift;
uniform float uRiver, uRiverWidth, uRiverMeander, uRiverDepth, uRiverTilt;
uniform float uGranulation, uGrain, uEdge, uFeather, uBrush;
uniform float uMotion, uFlow;
uniform float uOpacity;   // fades the whole piece toward flat paper

out vec4 fragColor;

const float TAU = 6.28318530718;
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

// Integer PCG hash for lattice points: float hashes repeat along whole lattice
// columns for some inputs, which shows up as long vertical streaks.
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

// Gradient noise, roughly -1..1
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

// x in 0..4: 0 = foreground pigment, 4 = horizon pigment. Mixed in OKLab.
vec3 pigment(float x) {
  x = clamp(x, 0.0, 4.0);
  int a = int(min(floor(x), 3.0));
  float f = x - float(a);
  f = f * f * (3.0 - 2.0 * f);
  return max(oklabToLinear(mix(uLab[a], uLab[a + 1], f)), vec3(0.0));
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Depth (from the anchored edge) of the current's centerline at "along" position x.
float riverLine(float x, float base, float horizon, vec2 orb) {
  float k = 4.6 / uScale;
  float wave = sin(x * k + uSeedOff.x * 0.37 + orb.x * 0.6) * 0.7
             + fbm(vec2(x * k * 0.45, 3.7) + uSeedOff * 0.21 + orb * 0.3, 2) * 0.8;
  float y0 = base + uRiverTilt * 0.55 * x;
  float persp = clamp(1.0 - y0 / max(horizon, 0.05), 0.15, 1.0);
  return y0 + uRiverMeander * 0.24 * uScale * wave * (0.3 + 0.7 * persp);
}

void main() {
  vec2 frag = gl_FragCoord.xy + uViewOff;
  vec2 res = uView;
  float unit = min(res.x, res.y);
  vec2 css = frag / uPx;

  // Composition frame: P.x runs along the anchored edge, P.y is depth away from it.
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
  float horizon = uCoverage * extent;
  float hz = max(horizon, 0.05);
  vec2 Q = P / uScale;

  // Loop: a point circling once per loop drives every moving input.
  float ang = TAU * uPhase;
  vec2 orb = vec2(cos(ang), sin(ang)) * uMotion * 0.55;
  vec2 orb2 = vec2(cos(ang + 2.1), sin(ang + 2.1)) * uMotion * 0.4;

  // Domain warp -> swirling wet-in-wet structure.
  vec2 q = vec2(
    fbm(Q * 0.9 + uSeedOff + orb, 4),
    fbm(Q * 0.9 + uSeedOff.yx + vec2(5.2, 1.3) - orb, 4));
  vec2 r = vec2(
    fbm(Q * 1.7 + 1.6 * q + uSeedOff + vec2(1.7, 9.2) + orb2, 3),
    fbm(Q * 1.7 + 1.6 * q + uSeedOff + vec2(8.3, 2.8) - orb2, 3));
  vec2 W = P + uWarp * uScale * vec2(0.22, 0.12) * (r + 0.5 * q);

  // Feathering at three scales: billows, fringes, and pixel grit that breaks soft edges into grain.
  float rag = fbm(Q * 5.0 + uSeedOff * 1.3 + r * 0.7, 5);
  float ragFine = gnoise(Q * 40.0 + uSeedOff + r * 3.0);
  float grit = gnoise(css * 0.55 + 13.0) * 0.6 + gnoise(css * 0.21 + 5.0) * 0.4;
  float depth = W.y + uFeather * uScale * (rag * 0.07 + ragFine * 0.01);

  // Height field: 0 at the anchored edge, 1 at the horizon; turbulent and tilted.
  float turb = fbm(W * 1.2 / uScale + q * 0.3 + uSeedOff + vec2(4.4, 1.9) + orb * 0.4, 5);
  float slope = (hash12(uSeedOff * 0.73) - 0.5) * 1.1;
  float H = depth / hz + uRidge * (0.55 * turb + slope * W.x * 0.45 / hz);

  // Gentle warp only: stronger warps fold space and leave hard creases in the hue.
  float driftN = fbm(W * 0.7 / uScale + q * 0.45 + uSeedOff + vec2(3.1, 7.7) + orb * 0.7, 3);
  float softN = fbm(Q * 1.3 + uSeedOff + vec2(11.0, 4.0), 2);

  float paperLum = dot(uPaper, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = uPaper;
  float pig = 0.0;
  int L = uLayers;
  float denom = float(max(L - 1, 1));

  // Washes, painted back (near the horizon, pale & soft) to front (deep & dense).
  for (int i = 0; i < 7; i++) {
    if (i >= L) break;
    float fl = float(i);
    float fi = fl / denom;
    float thr = mix(1.0, 0.14, pow(fi, 0.85));
    float own = gnoise(vec2(W.x * (1.6 + 0.4 * fl) / uScale + fl * 5.3, fl * 3.7) + uSeedOff + orb * (0.3 + 0.1 * fl));
    float inside = (thr + uRidge * 0.12 * own - H) * hz;   // > 0 inside this wash (unit space)

    float soft = mix(0.05, 0.012, fi) * (0.4 + 1.2 * uMist * (1.0 - fi));
    soft *= mix(0.4, 2.0, smoothstep(-0.45, 0.45, softN + 0.35 * sin(fl * 2.3)));
    float m = smoothstep(-soft, soft, inside + soft * 0.9 * (0.6 * grit + 0.4 * ragFine));
    if (m <= 0.0) continue;

    float wash = 0.82 + 0.28 * fbm(W * 2.0 / uScale + vec2(fl * 11.0, 2.0) + uSeedOff + orb * 0.5, 2);
    float pool = uEdge * exp(-max(inside, 0.0) / (0.012 + soft * 0.5));
    float a = clamp(m * (wash * mix(0.7, 1.15, fi) * uDensity + 0.4 * pool), 0.0, 1.0);

    // Color follows the turbulent height (continuous across washes), then drifts in hue.
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

  // Uneven, mottled pigment load inside the washes.
  float mottle = fbm(Q * 14.0 + r * 2.0 + uSeedOff * 0.7 + orb * 0.3, 3);
  col *= 1.0 - pig * (0.16 * rag + 0.12 * mottle);

  // The current: pigment lifted away along a path that winds off into the distance.
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
    float ad = abs(dist) + (rag * 0.025 + ragFine * 0.006) * uFeather * uScale;
    ad += (0.6 * grit + 0.4 * ragFine) * width * 0.22;

    float fade = smoothstep(hz * 1.08, hz * 0.65, yc) * smoothstep(-0.05, 0.05, yc);
    float rm = (1.0 - smoothstep(width * 0.5, width, ad)) * fade * mix(0.5, 1.0, pig);
    float halo = (1.0 - smoothstep(width, width * 1.8, ad)) * fade * pig;

    // Flowing streaks (two crossfaded phases so the loop stays seamless).
    float along = x / uScale;
    float p1 = fract(uPhase * 2.0);
    float p2 = fract(uPhase * 2.0 + 0.5);
    float wgt = abs(1.0 - 2.0 * p1);
    float travel = uFlow * 6.0;
    vec2 sp = vec2(along * 6.0, dist / max(width, 0.005) * 2.2);
    float s1 = fbm(sp + vec2(-p1 * travel, 0.0) + uSeedOff, 3);
    float s2 = fbm(sp + vec2(-p2 * travel, 0.0) + uSeedOff + 5.0, 3);
    float streak = mix(s1, s2, wgt);

    vec3 riverCol = mix(uPaper, pigment(3.6 + uHueDrift * driftN), 0.14 + 0.2 * persp);
    riverCol = mix(riverCol, pigment(2.4), 0.16 * (streak + 0.5));

    // Lifted pigment pools in a soft, richer rim just outside the banks.
    float bank = exp(-pow((ad - width * 1.15) / (width * 0.35 + 0.004), 2.0)) * uEdge * pig * fade * uRiver;
    col = mix(col, col * col / max(uPaper, vec3(0.05)), bank * 0.2);
    col = mix(col, riverCol, halo * 0.12 * uRiver);
    float lift = clamp(rm * uRiver * (0.85 + 0.3 * streak), 0.0, 1.0);
    col = mix(col, riverCol, lift);
    pig *= 1.0 - 0.75 * lift;
  }

  // Mist: granular haze where the pigment dissolves into paper, and a veil over far washes.
  float mistN = fbm(vec2(W.x * 1.6, W.y * 3.6) / uScale + uSeedOff + orb * 0.6 + r * 0.5, 4);
  float mistH = 0.06 + 0.3 * uMist;
  float mistBand = 1.0 - smoothstep(-0.05, mistH, H - 1.0 + mistN * 0.12);
  float wisp = smoothstep(-0.25, 0.55, mistN + 0.2) * (0.75 + 0.5 * grit);
  vec3 mistCol = mix(uPaper, pigment(3.5 + uHueDrift * driftN * 1.5), 0.55);
  col = mix(col, mistCol, clamp(mistBand * wisp * uMist * 0.6 * (1.0 - pig), 0.0, 1.0));
  float veil = smoothstep(0.5, 1.02, H) * wisp;
  col = mix(col, mistCol, clamp(veil * uMist * 0.28 * pig, 0.0, 1.0));

  // Pigment settles in the paper tooth (static, so the paper stays put while color moves).
  float g1 = gnoise(css * 0.45 + uSeedOff * 3.0);
  float g2 = gnoise(css * 0.14 + 7.0);
  float speck = smoothstep(0.25, 0.75, gnoise(css * 0.8 + 21.0));
  float tooth = pig * (0.6 + 0.8 * (1.0 - pig));
  col *= 1.0 - uGranulation * tooth * (0.1 * (0.6 * g1 + 0.4 * g2) + 0.12 * speck);

  // Brush relief: short diagonal strokes, gently bent by the swirl, lit like paint on canvas.
  vec2 bp = mat2(0.866, 0.5, -0.5, 0.866) * css + r * 30.0;
  float h = gnoise(bp * vec2(0.09, 0.42)) * 0.5 + gnoise(css * 0.5 + 3.0) * 0.5;
  vec3 nrm = normalize(vec3(-dFdx(h) * uPx, -dFdy(h) * uPx, 0.6));
  float light = dot(nrm, vec3(-0.451, 0.551, 0.702)) - 0.702;
  col *= 1.0 + uBrush * mix(0.15, 1.0, pig) * light * 0.5;

  // Paper grain and gentle cockling.
  float grain = gnoise(css * 0.95) * 0.55 + gnoise(css * 0.3 + 3.0) * 0.45;
  float fiber = gnoise(vec2(css.x * 0.05, css.y * 0.55) + 9.0);
  col *= 1.0 + uGrain * (0.045 * grain + 0.018 * fiber);
  col *= 1.0 + uGrain * 0.03 * fbm(P * 1.4 + 40.0, 2);

  // Opacity blends in sRGB like CSS opacity would, so 50% looks like half.
  vec3 outc = mix(toSrgb(uPaper), toSrgb(col), uOpacity);
  outc += (hash12(frag) - 0.5) / 255.0;   // static dither: no banding, no video-bloating flicker
  fragColor = vec4(outc, 1.0);
}
`;
