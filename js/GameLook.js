// GameLook.js — облик кадра Kaiju Rampage Ultimate: небо (купол-шейдер: градиент, солнце или луна, облака, звёзды,
// дальняя гряда), свет и туман по карте, постобработка (свечение, цвет, виньетка, сглаживание), фон за краем карты
// (земля до горизонта, блочные дальние кварталы и горы), оформление земли (тротуары, площадки под домами, газоны,
// люки и заплатки на дорогах, пятна света фонарей ночью, карта затенения у домов).
//
//   GameLook.build(app)   после постройки города на каждой карте (сцена движка остаётся — своё прежнее убирается)
//   GameLook.update(dt)   каждый кадр игры (время облаков, погасшие фонари)
//   GameLook.setQuality() сменился уровень графики: постобработка пересобирается
//   GameLook.clear()      убрать всё своё
//
// Слои земли по высоте над базой (всё плоское, слитые меши; дороги GameCity — 2.0…3.2 с zOffset −4, шрамы — от 4.0
// с zOffset −7/−9): площадки и газоны 0.5 (zOffset −1.5), тротуары 1.2 (−2.5), детали дорог 3.6 (−5.5, прозрачные,
// alphaIndex 0 — раньше шрамов), пятна света 3.8 (−6). Свет сцены — только через World3D.setLighting.
// Постобработка — своя цепочка PostProcess в обычном (не линейном) цвете: кадр сцены -> яркое в 1/4 -> размытие ->
// [ещё шире в 1/8] -> итог (свечение + цвет + виньетка) сразу на экран; полноэкранный проход один. На телефонах и
// низком уровне цепочки нет: только свет, небо и лёгкая виньетка в DOM.

/** @satisfies {Record<string, any>} */
const GameLook = (() => {
    'use strict';

    const D2R = Math.PI / 180;

    // --- Облик карт -----------------------------------------------------------------------------------------------
    // sunAz — куда падает тень (как WORLD3D_SUN_AZIMUTH_DEG), sunEl — высота светила. zenith/mid/horizon — небо;
    // horizon — он же цвет тумана. cloud: покрытие 0..1, масштаб, скорость, мягкость края. ridge: 1 — горы, 2 — город.
    // post: exposure, contrast (0..1 — сила S-кривой), sat, tint, shadow (цвет в тенях), vig, порог/колено/вес свечения.
    const LOOKS = {
        metro: {
            sunAz: 34, sunEl: 50, sun: 0xfff3d8, sunI: 0.9, skyI: 0.46, skyLight: 0xcfe4ff, groundLight: 0xb4bfa8, shadow: 0x17355c, shadowK: 0.52,
            fog: 0.000044, zenith: 0x2a7be0, mid: 0x6fb4f4, horizon: 0xc6e2f6,
            disk: 0xfffdf0, glow: 0xfff2c8, glowK: 0.6, sunSize: 1.5, moon: 0, stars: 0,
            cloud: { cover: 0.47, scale: 0.42, speed: 0.0035, soft: 0.12, lit: 0xffffff, dark: 0xb4c8e4, alpha: 0.96 },
            ridge: { type: 2, h: 0.03, color: 0x8caccc },
            post: { exposure: 1.02, contrast: 0.42, sat: 1.2, tint: [1.0, 0.995, 0.975], shadow: [0.0, 0.015, 0.05], vig: 0.26, bloomT: 0.84, knee: 0.2, bloomSat: 0.35, bloomW: 0.34, haze: 0 },
            outer: 'grass', backdrop: 'city', lamps: 0,
            ground: { walk: 0xd9dadc, pads: [0xc6cad0, 0xb4b8c0, 0xd6cfc2, 0xa4a9b2, 0xc8bca8, 0xbfc7c9], lawnK: 0.3, lawn: 0xffffff, ao: 0x20304a, aoK: 0.5, noise: 0.15,
                decals: [[0, 3], [1, 2], [2, 4], [3, 2], [4, 3], [5, 2], [6, 2], [10, 1]] },
        },
        harbor: {
            sunAz: 287, sunEl: 13, sun: 0xffa45a, sunI: 1.0, skyI: 0.6, skyLight: 0xd8b6e4, groundLight: 0xc89a8c, shadow: 0x33205a, shadowK: 0.5,
            fog: 0.000052, zenith: 0x3b4a9a, mid: 0xe07a86, horizon: 0xffbd7a,
            disk: 0xfff0c0, glow: 0xff9a4a, glowK: 1.0, sunSize: 2.6, moon: 0, stars: 0.25,
            cloud: { cover: 0.5, scale: 0.36, speed: 0.003, soft: 0.16, lit: 0xffc890, dark: 0x7a4f86, alpha: 0.92 },
            ridge: { type: 1, h: 0.035, color: 0x8a5c8c },
            post: { exposure: 1.03, contrast: 0.4, sat: 1.16, tint: [1.035, 0.985, 0.95], shadow: [0.03, 0.0, 0.06], vig: 0.32, bloomT: 0.74, knee: 0.24, bloomSat: 0.4, bloomW: 0.5, haze: 0 },
            outer: 'dry', backdrop: 'coast', lamps: 0.45,
            ground: { walk: 0xdccdb6, pads: [0xd4c4aa, 0xc2b39c, 0xb6a690, 0xcdbea8, 0xb8b0a8], lawnK: 0.2, lawn: 0xf2ecc8, ao: 0x2a1c44, aoK: 0.45, noise: 0.14,
                decals: [[0, 3], [1, 2], [2, 4], [3, 2], [4, 3], [5, 3], [6, 2], [9, 1]] },
        },
        tokyo: {
            sunAz: 122, sunEl: 54, sun: 0x9fb6ff, sunI: 0.5, skyI: 0.62, skyLight: 0x9a92ea, groundLight: 0x5a4a8c, shadow: 0x08061e, shadowK: 0.5,
            fog: 0.000062, zenith: 0x060a22, mid: 0x1d1754, horizon: 0x512c84,
            disk: 0xf2f4ff, glow: 0x8fa4ff, glowK: 0.7, sunSize: 2.3, moon: 1, stars: 1,
            cloud: { cover: 0.44, scale: 0.4, speed: 0.005, soft: 0.2, lit: 0x6a4a9a, dark: 0x191338, alpha: 0.85 },
            ridge: { type: 2, h: 0.042, color: 0x221a4c },
            post: { exposure: 1.1, contrast: 0.5, sat: 1.28, tint: [0.97, 0.975, 1.06], shadow: [0.02, 0.0, 0.07], vig: 0.4, bloomT: 0.52, knee: 0.3, bloomSat: 0.75, bloomW: 0.9, haze: 0 },
            outer: 'night', backdrop: 'neon', lamps: 1,
            ground: { walk: 0x9a98b8, pads: [0x8886a8, 0x767496, 0x9a94b4, 0x66648a, 0x8a7ea6], lawnK: 0.1, lawn: 0x9ad0a0, ao: 0x05041a, aoK: 0.55, noise: 0.16,
                decals: [[0, 3], [1, 2], [2, 3], [4, 2], [5, 2], [7, 6], [10, 1]] },
        },
        desert: {
            sunAz: 62, sunEl: 60, sun: 0xfff2d2, sunI: 0.98, skyI: 0.42, skyLight: 0xffe9c6, groundLight: 0xe6c28c, shadow: 0x5a3018, shadowK: 0.5,
            fog: 0.00005, zenith: 0x2f84de, mid: 0x86c4f2, horizon: 0xf2e0ba,
            disk: 0xffffff, glow: 0xfff0c0, glowK: 0.9, sunSize: 1.8, moon: 0, stars: 0,
            cloud: { cover: 0.3, scale: 0.34, speed: 0.002, soft: 0.1, lit: 0xffffff, dark: 0xe2d2bc, alpha: 0.9 },
            ridge: { type: 1, h: 0.04, color: 0xd09a66 },
            post: { exposure: 1.0, contrast: 0.42, sat: 1.14, tint: [1.04, 1.0, 0.93], shadow: [0.04, 0.01, 0.0], vig: 0.26, bloomT: 0.88, knee: 0.2, bloomSat: 0.3, bloomW: 0.3, haze: 1 },
            outer: '', backdrop: 'desert', lamps: 0,
            ground: { walk: 0xecd8ae, pads: [0xe4cda0, 0xd6bd8c, 0xf0dcb4, 0xc8ad80, 0xddc49a], lawnK: 0.07, lawn: 0xe8f0b8, ao: 0x4a2a10, aoK: 0.42, noise: 0.13,
                decals: [[0, 2], [1, 1], [2, 3], [3, 2], [4, 4], [5, 1], [6, 2], [9, 6]] },
        },
        arctic: {
            sunAz: 300, sunEl: 24, sun: 0xfff3e2, sunI: 0.84, skyI: 0.58, skyLight: 0xd6e9ff, groundLight: 0xdce8f6, shadow: 0x23486e, shadowK: 0.5,
            fog: 0.000066, zenith: 0x5f95d0, mid: 0xa4c8ea, horizon: 0xe4eff8,
            disk: 0xffffff, glow: 0xfff6e0, glowK: 0.75, sunSize: 1.9, moon: 0, stars: 0,
            cloud: { cover: 0.6, scale: 0.34, speed: 0.0045, soft: 0.24, lit: 0xffffff, dark: 0xb0c4da, alpha: 0.9 },
            ridge: { type: 1, h: 0.05, color: 0xb4cce2 },
            post: { exposure: 0.98, contrast: 0.4, sat: 1.08, tint: [0.97, 1.0, 1.05], shadow: [0.0, 0.02, 0.06], vig: 0.26, bloomT: 0.95, knee: 0.1, bloomSat: 0.6, bloomW: 0.26, haze: 0 },
            outer: '', backdrop: 'arctic', lamps: 0.3,
            ground: { walk: 0xe4edf4, pads: [0xdbe6ee, 0xccd9e6, 0xecf2f6, 0xb6c6d6, 0xc8d2dc], lawnK: 0, lawn: 0xffffff, ao: 0x1c3c62, aoK: 0.42, noise: 0.12,
                decals: [[0, 2], [1, 1], [2, 3], [4, 3], [6, 2], [8, 7]] },
        },
    };

    // --- Состояние ------------------------------------------------------------------------------------------------
    const S = {
        app: /** @type {any} */ (null), loc: /** @type {any} */ (null), view: /** @type {any} */ (null), scene: /** @type {any} */ (null),
        cam: /** @type {any} */ (null), id: '', L: /** @type {any} */ (null),
        W: 14000, H: 14000, base: 0, t: 0, pp: false,
        /** @type {any[]} */ meshes: [], /** @type {any[]} */ mats: [], /** @type {any[]} */ texs: [],
        sky: /** @type {any} */ (null), skyMat: /** @type {any} */ (null), skyA: /** @type {any} */ (null),
        /** @type {any[]} */ post: [], dom: /** @type {any} */ (null),
        lamps: /** @type {any} */ (null), lampT: 0, outerTex: /** @type {any} */ (null), unsubQ: /** @type {any} */ (null), shaders: false,
        noiseCv: /** @type {any} */ (null), stats: /** @type {Record<string, any>} */ ({}),
    };

    // --- Мелочи ----------------------------------------------------------------------------------------------------
    const rgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    const c3 = (n) => new BABYLON.Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    const css = (n, a) => 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (a == null ? 1 : a) + ')';
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const mixc = (a, b, k) => {
        const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k), g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k),
            bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
        return (r << 16) | (g << 8) | bl;
    };
    const shade = (n, k) => {
        const f = (v) => clamp(Math.round(v * k), 0, 255);
        return (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
    };
    const quality = () => (typeof KR !== 'undefined' && KR.quality ? KR.quality() : 'high');
    const lite = () => IS_MOBILE || quality() === 'low';
    /** @returns {[HTMLCanvasElement, CanvasRenderingContext2D]} */
    const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))]; };

    /** Текстура из canvas: v = 0 — верхняя строка. opts: mip, clampV, clamp, aniso. */
    function texOf(name, cv, opts) {
        const o = opts || {};
        const t = new BABYLON.DynamicTexture(name, cv, S.scene, o.mip !== false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTUREFORMAT_RGBA, false);
        t.update(false);
        t.wrapU = o.clamp ? BABYLON.Texture.CLAMP_ADDRESSMODE : BABYLON.Texture.WRAP_ADDRESSMODE;
        t.wrapV = o.clamp || o.clampV ? BABYLON.Texture.CLAMP_ADDRESSMODE : BABYLON.Texture.WRAP_ADDRESSMODE;
        t.anisotropicFilteringLevel = IS_MOBILE ? 2 : (o.aniso || 6);
        S.texs.push(t);
        return t;
    }

    // Тайловый шум (сумма решёток с периодом, кратным размеру) — облака неба, пятна земли. Серый canvas size×size.
    function noiseCanvas(size, seed) {
        const [cv, g] = canvas(size, size), img = g.createImageData(size, size), d = img.data, rnd = KR.rng(seed);
        const per = [4, 8, 16, 32, 64], amp = [0.48, 0.26, 0.14, 0.08, 0.04];
        const lat = per.map((P) => { const a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; });
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let v = 0;
            for (let o = 0; o < per.length; o++) {
                const P = per[o], L = lat[o], fx = x / size * P, fy = y / size * P, x0 = Math.floor(fx), y0 = Math.floor(fy);
                let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
                const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
                const a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], e = L[y1 * P + x1];
                v += amp[o] * (a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty);
            }
            const q = clamp(Math.round(((v - 0.5) * 1.9 + 0.5) * 255), 0, 255), i = (y * size + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = q; d[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return cv;
    }

    // --- Шейдеры ---------------------------------------------------------------------------------------------------
    function ensureShaders() {
        if (S.shaders) return;
        S.shaders = true;
        const store = BABYLON.Effect.ShadersStore;
        store.krSkyVertexShader = `precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 p = viewProjection * world * vec4(position, 1.0);
    gl_Position = p.xyww;
}`;
        // uA = (время, звёзды, высота гряды, тип гряды), uB = облака (покрытие, масштаб, скорость, мягкость),
        // uC = (cos радиуса диска, сила ореола, луна-серп, плотность облаков)
        store.krSkyFragmentShader = `precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uGlowCol;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec3 uRidgeCol;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uC;
uniform sampler2D uNoise;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cl(vec2 uv, vec2 w) { return texture2D(uNoise, uv + w).r * 0.65 + texture2D(uNoise, uv * 2.7 - w * 1.6).r * 0.35; }
void main() {
    vec3 d = normalize(vDir);
    float h = d.y, t = clamp(h, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.24, t));
    col = mix(col, uZenith, smoothstep(0.16, 0.8, t));
    float sd = dot(d, uSunDir), sp = max(sd, 0.0);
    col += uGlowCol * (pow(sp, 10.0) * 0.2 + pow(sp, 90.0) * 0.5) * uC.y;
    if (uA.y > 0.01 && h > 0.0) {
        vec2 q = d.xz / (h + 0.4) * 60.0, id = floor(q), f = fract(q) - 0.5;
        float r = h21(id);
        vec2 o = (vec2(h21(id + 17.3), h21(id + 41.7)) - 0.5) * 0.7;
        float s = step(0.88, r) * smoothstep(0.07 + 0.1 * r, 0.0, length(f - o));
        col += vec3(0.82, 0.88, 1.0) * s * (0.6 + 0.4 * sin(uA.x * (1.5 + r * 4.0) + r * 90.0)) * uA.y * smoothstep(0.03, 0.3, h);
    }
    float disk = smoothstep(uC.x, uC.x + 0.0005, sd);
    if (uC.z > 0.5) {
        vec3 o = normalize(uSunDir + vec3(0.014, 0.008, 0.0));
        disk *= 1.0 - 0.88 * smoothstep(uC.x + 0.0001, uC.x + 0.0005, dot(d, o));
    }
    col = mix(col, uSunCol, disk);
    if (uB.x > 0.01 && h > 0.0) {
        vec2 uv = d.xz / (h + 0.1) * uB.y;
        vec2 w = vec2(uA.x * uB.z, uA.x * uB.z * 0.4);
        float n = cl(uv, w);
        float cover = 1.0 - uB.x;
        float c = smoothstep(cover, cover + uB.w, n);
        float n2 = cl(uv + uSunDir.xz * 0.04, w);
        float lit = clamp(0.55 + (n - n2) * 3.2 - (n - cover) * 0.9, 0.0, 1.0);
        lit = mix(lit, floor(lit * 3.0 + 0.5) / 3.0, 0.6);
        vec3 cc = mix(uCloudDark, uCloudLit, lit) + uGlowCol * pow(sp, 5.0) * 0.3 * uC.y;
        col = mix(col, cc, c * uC.w * smoothstep(0.01, 0.17, h));
    }
    if (uA.w > 0.5) {
        float a = atan(d.z, d.x) / 6.2831853 + 0.5;
        float rh;
        vec3 rc = uRidgeCol;
        if (uA.w < 1.5) {
            float n = texture2D(uNoise, vec2(a * 3.0, 0.31)).r * 0.7 + texture2D(uNoise, vec2(a * 11.0, 0.73)).r * 0.3;
            rh = uA.z * (0.2 + 1.0 * n);
            rc = mix(rc, rc * 1.25 + 0.06, smoothstep(rh * 0.55, rh, h));
        } else {
            float k = floor(a * 300.0);
            float r = h21(vec2(k, 3.0));
            float zone = texture2D(uNoise, vec2(a * 2.0, 0.55)).r;
            rh = uA.z * (0.18 + r * r * 1.1) * (0.3 + zone * 1.2);
            float wl = step(0.7, h21(vec2(k * 7.0 + floor(fract(a * 300.0) * 3.0), floor(h * 1100.0))));
            rc += vec3(1.0, 0.78, 0.5) * wl * uA.y * 0.8;
        }
        float m = smoothstep(rh, rh - 0.002, h) * step(-0.02, h);
        col = mix(col, mix(rc, uHorizon, 0.4), m);
    }
    col = mix(col, uHorizon, smoothstep(0.0, -0.03, h));
    gl_FragColor = vec4(col, 1.0);
}`;
        // Яркое в четверть размера: 4 выборки по кадру, порог с «коленом»; насыщенный яркий цвет (неон, огонь) проходит легче белого.
        store.krBrightFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uTexel;
uniform vec4 uP;
void main() {
    vec3 c = texture2D(textureSampler, vUV + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(textureSampler, vUV + uTexel * vec2(1.0, -1.0)).rgb
        + texture2D(textureSampler, vUV + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(textureSampler, vUV + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float e = mix(dot(c, vec3(0.299, 0.587, 0.114)), mx, uP.z) + (mx - mn) * uP.w;
    gl_FragColor = vec4(c * smoothstep(uP.x, uP.x + uP.y, e), 1.0);
}`;
        store.krBlurFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uDir;
void main() {
    vec3 c = texture2D(textureSampler, vUV).rgb * 0.227027;
    c += (texture2D(textureSampler, vUV + uDir * 1.384615).rgb + texture2D(textureSampler, vUV - uDir * 1.384615).rgb) * 0.316216;
    c += (texture2D(textureSampler, vUV + uDir * 3.230769).rgb + texture2D(textureSampler, vUV - uDir * 3.230769).rgb) * 0.070270;
    gl_FragColor = vec4(c, 1.0);
}`;
        // Итог: uGrade = (экспозиция, контраст, насыщенность, вес свечения), uTint = (баланс, виньетка),
        // uShadow = цвет в тенях, uHaze = (сила марева, высота горизонта в кадре, ширина полосы, время).
        store.krFinalFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D sceneSampler;
#ifdef WIDE
uniform sampler2D bloomNear;
#endif
uniform vec4 uGrade;
uniform vec4 uTint;
uniform vec4 uShadow;
uniform vec4 uHaze;
void main() {
    vec2 uv = vUV;
#ifdef HAZE
    float band = exp(-pow((uv.y - uHaze.y) / uHaze.z, 2.0)) * uHaze.x;
    uv.x += sin(uv.y * 210.0 + uHaze.w * 5.0) * 0.0011 * band;
    uv.y += sin(uv.x * 130.0 - uHaze.w * 3.7) * 0.0009 * band;
#endif
    vec3 c = texture2D(sceneSampler, uv).rgb;
    vec3 b = texture2D(textureSampler, vUV).rgb;
#ifdef WIDE
    b = b * 0.6 + texture2D(bloomNear, vUV).rgb * 0.7;
#endif
    c += b * uGrade.w * (1.0 - 0.35 * c);
    c *= uGrade.x * uTint.rgb;
    c = clamp(c, 0.0, 1.0);
    c = mix(c, c * c * (3.0 - 2.0 * c), uGrade.y);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uGrade.z);
    c += uShadow.rgb * (1.0 - smoothstep(0.0, 0.55, l));
    vec2 q = (vUV - 0.5) * vec2(1.0, 0.88);
    c *= 1.0 - smoothstep(0.34, 0.84, length(q)) * uTint.a;
    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
    }

    // --- Свет, туман, камера ---------------------------------------------------------------------------------------
    function applyLight(L) {
        const cam = S.cam;
        cam.maxZ = 70000; cam.minZ = 16;
        World3D.setLighting({
            sky: L.horizon, fog: L.fog * (IS_MOBILE ? 1.15 : 1), sunAz: L.sunAz, sunEl: L.sunEl, sunColor: L.sun, sunIntensity: L.sunI,
            skyIntensity: L.skyI, skyLight: L.skyLight, groundLight: L.groundLight, shadowColor: L.shadow, shadowStrength: L.shadowK,
        }, S.view);
    }

    /** Прежний купол неба GameCity (картинка-панорама) убирается: небо рисует свой купол. Свечение окон ночью остаётся. */
    function dropOldSky() {
        const C = /** @type {any} */ (typeof GameCity !== 'undefined' ? GameCity : null);
        if (!C) return;
        const dome = C.sky;
        if (dome) {
            C.sky = null;
            const i = C.meshes ? C.meshes.indexOf(dome) : -1;
            if (i >= 0) C.meshes.splice(i, 1);
            try { dome.dispose(false, true); } catch (e) { /* уже снят */ }
        }
        const info = KR.mapInfo(S.id);
        if (C.atlasLit && C.chunks) for (const c of C.chunks) if (c.mat && !c.mat.emissiveTexture) { c.mat.emissiveTexture = C.atlasLit; c.mat.emissiveColor = new BABYLON.Color3(0, 0, 0); }
        C.lit = info.lit;
    }

    // --- Небо --------------------------------------------------------------------------------------------------------
    function buildSky(L) {
        const scene = S.scene;
        const dome = BABYLON.MeshBuilder.CreateSphere('look-sky', { diameter: 2, segments: 20 }, scene);
        const mat = new BABYLON.ShaderMaterial('look-sky', scene, { vertex: 'krSky', fragment: 'krSky' }, {
            attributes: ['position'], samplers: ['uNoise'],
            uniforms: ['world', 'viewProjection', 'uZenith', 'uMid', 'uHorizon', 'uSunDir', 'uSunCol', 'uGlowCol', 'uCloudLit', 'uCloudDark', 'uRidgeCol', 'uA', 'uB', 'uC'],
        });
        mat.backFaceCulling = false; mat.disableDepthWrite = true; mat.fogEnabled = false;
        const noise = texOf('look-noise', S.noiseCv, { aniso: 2 });
        const az = L.sunAz * D2R, el = L.sunEl * D2R, ce = Math.cos(el);
        const lowSky = lite();
        mat.setTexture('uNoise', noise);
        mat.setColor3('uZenith', c3(L.zenith)); mat.setColor3('uMid', c3(L.mid)); mat.setColor3('uHorizon', c3(L.horizon));
        mat.setVector3('uSunDir', new BABYLON.Vector3(-Math.cos(az) * ce, Math.sin(el), -Math.sin(az) * ce));
        mat.setColor3('uSunCol', c3(L.disk)); mat.setColor3('uGlowCol', c3(L.glow));
        mat.setColor3('uCloudLit', c3(L.cloud.lit)); mat.setColor3('uCloudDark', c3(L.cloud.dark)); mat.setColor3('uRidgeCol', c3(L.ridge.color));
        S.skyA = new BABYLON.Vector4(0, lowSky ? L.stars * 0.6 : L.stars, L.ridge.h, L.ridge.type);
        mat.setVector4('uA', S.skyA);
        mat.setVector4('uB', new BABYLON.Vector4(L.cloud.cover, L.cloud.scale, L.cloud.speed, L.cloud.soft));
        mat.setVector4('uC', new BABYLON.Vector4(Math.cos(L.sunSize * D2R), L.glowK, L.moon, L.cloud.alpha));
        dome.material = mat;
        dome.scaling.set(900, 900, 900);
        dome.infiniteDistance = true; dome.isPickable = false; dome.alwaysSelectAsActiveMesh = true; dome.applyFog = false;
        dome.renderingGroupId = World3D.LAYER.WORLD;
        S.sky = dome; S.skyMat = mat;
        S.meshes.push(dome); S.mats.push(mat);
    }

    // --- Сборка слитых мешей -----------------------------------------------------------------------------------------
    const acc = () => ({ pos: /** @type {number[]} */ ([]), nor: /** @type {number[]} */ ([]), uv: /** @type {number[]} */ ([]), col: /** @type {number[]} */ ([]), idx: /** @type {number[]} */ ([]) });

    /** Плоский четырёхугольник (углы по кругу), нормаль вверх. uv — 8 чисел, col — [r, g, b, a]. */
    function quad(a, x0, z0, x1, z1, x2, z2, x3, z3, y, uv, col) {
        const v = a.pos.length / 3;
        a.pos.push(x0, y, z0, x1, y, z1, x2, y, z2, x3, y, z3);
        a.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        a.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
        for (let i = 0; i < 4; i++) a.col.push(col[0], col[1], col[2], col[3]);
        a.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }

    /** Коробка без дна: центр (cx, cz), размеры w×d, высота y0..y1, поворот yaw; цвет стен и крыши; uvk — px мира на повтор (0 — без UV). */
    function box(a, cx, cz, w, d, y0, y1, yaw, colS, colT, uvk) {
        const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
        const px = [-hw, hw, hw, -hw], pz = [-hd, -hd, hd, hd], X = [0, 0, 0, 0], Z = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) { X[i] = cx + px[i] * c - pz[i] * s; Z[i] = cz + px[i] * s + pz[i] * c; }
        const sr = rgb(colS), tr = rgb(colT), hgt = y1 - y0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4, v = a.pos.length / 3, len = i % 2 ? d : w;
            const ex = X[j] - X[i], ez = Z[j] - Z[i], el = Math.hypot(ex, ez) || 1, nx = ez / el, nz = -ex / el;
            // наружу: от центра
            const out = ((X[i] + X[j]) / 2 - cx) * nx + ((Z[i] + Z[j]) / 2 - cz) * nz >= 0 ? 1 : -1;
            a.pos.push(X[i], y0, Z[i], X[j], y0, Z[j], X[j], y1, Z[j], X[i], y1, Z[i]);
            for (let k = 0; k < 4; k++) { a.nor.push(nx * out, 0, nz * out); a.col.push(sr[0], sr[1], sr[2], 1); }
            const u = uvk ? len / uvk : 0, vv = uvk ? hgt / uvk : 0;
            a.uv.push(0, vv, u, vv, u, 0, 0, 0);
            a.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        }
        const v = a.pos.length / 3;
        a.pos.push(X[0], y1, Z[0], X[1], y1, Z[1], X[2], y1, Z[2], X[3], y1, Z[3]);
        for (let k = 0; k < 4; k++) { a.nor.push(0, 1, 0); a.col.push(tr[0], tr[1], tr[2], 1); a.uv.push(0.03, 0.03); }
        a.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }

    /** Меш из накопителя; opts: shadows (принимает тени), alphaIndex, fog. */
    function meshOf(name, a, mat, opts) {
        if (!a.idx.length) return null;
        const o = opts || {};
        const mesh = new BABYLON.Mesh(name, S.scene), vd = new BABYLON.VertexData();
        vd.positions = a.pos; vd.normals = a.nor; vd.indices = a.idx;
        if (a.uv.length) vd.uvs = a.uv;
        if (a.col.length) vd.colors = a.col;
        vd.applyToMesh(mesh, !!o.updatable);
        mesh.material = mat; mesh.isPickable = false; mesh.hasVertexAlpha = !!o.vertexAlpha;
        if (o.alphaIndex != null) mesh.alphaIndex = o.alphaIndex;
        World3D.addObject(S.view, mesh, 'prop', { castShadow: false, ink: false, outline: false, receiveShadows: o.shadows !== false });
        mesh.freezeWorldMatrix();
        S.meshes.push(mesh);
        return mesh;
    }

    function groundMat(name, tex, zoff, alpha) {
        const m = new BABYLON.StandardMaterial(name, S.scene);
        m.metadata = { toonGroup: 'ground' };
        if (tex) m.diffuseTexture = tex;
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.zOffset = zoff; m.backFaceCulling = false;
        if (alpha && tex) { tex.hasAlpha = true; m.useAlphaFromDiffuseTexture = true; }
        S.mats.push(m);
        return m;
    }

    // --- Земля за краем карты и дальний фон ---------------------------------------------------------------------------
    // Тайл земли за городом: трава, сухая трава побережья, ночная трава.
    function outerCanvas(kind) {
        const pal = kind === 'night' ? [0x2c4a52, 0x3a5c5c, 0x24403f] : kind === 'dry' ? [0x8fae5c, 0xa8b86a, 0x7a9c50] : [0x63ad4c, 0x79bd58, 0x559c44];
        const [cv, g] = canvas(256, 256), rnd = KR.rng(kind.length * 977 + 13);
        g.fillStyle = css(pal[0]); g.fillRect(0, 0, 256, 256);
        g.globalAlpha = 0.5; g.globalCompositeOperation = 'soft-light';
        g.drawImage(S.noiseCv, 0, 0, 256, 256);
        g.globalCompositeOperation = 'source-over';
        // поля-лоскуты и кусты: всё с переносом через край
        for (let i = 0; i < 26; i++) {
            const x = rnd() * 256, y = rnd() * 256, w = 20 + rnd() * 60, h = 16 + rnd() * 50;
            g.globalAlpha = 0.16 + rnd() * 0.16; g.fillStyle = css(pal[1 + (i % 2)]);
            for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) g.fillRect(x + ox, y + oy, w, h);
        }
        g.globalAlpha = 0.5;
        for (let i = 0; i < 90; i++) {
            const x = rnd() * 256, y = rnd() * 256, r = 2 + rnd() * 4;
            g.fillStyle = css(shade(pal[2], 0.72 + rnd() * 0.2));
            for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        return cv;
    }

    function buildHorizon(L) {
        const t = S.loc.terrain, W = S.W, H = S.H;
        const mat = new BABYLON.StandardMaterial('look-horizon', S.scene);
        mat.metadata = { toonGroup: 'ground' };
        mat.specularColor = new BABYLON.Color3(0, 0, 0); mat.backFaceCulling = false;
        S.mats.push(mat);
        let tile = typeof GROUND_TILE_SIZE !== 'undefined' ? GROUND_TILE_SIZE : 420, tex = null;
        if (L.outer) {
            tile = 1500;
            tex = texOf('look-outer', outerCanvas(L.outer), { aniso: 8 });
            // кольцо движка за краем карты — тем же тайлом: стык с дальней землёй не виден
            if (t.outerMaterial) { S.outerTex = tex; t.outerMaterial.diffuseTexture = tex; }
        } else if (t.texture && t.texture.getContext) {
            try { tex = texOf('look-outer', /** @type {any} */ (t.texture.getContext()).canvas, { aniso: 8 }); } catch (e) { tex = null; }
        }
        if (tex) { tex.uScale = W / tile; tex.vScale = H / tile; mat.diffuseTexture = tex; }
        else mat.diffuseColor = c3(mixc(L.groundLight, 0x808080, 0.4));
        // ниже любой воды: море и озёра остаются сверху
        let y = S.base - 14;
        for (const w of t.waterDefs || []) if (Number.isFinite(w.level)) y = Math.min(y, w.level - 6);
        const E = 54000, I = (t.outerRing || 2400) - 80, a = acc(), white = [1, 1, 1, 1];
        const rect = (x0, z0, x1, z1) => {
            const nx = Math.max(1, Math.ceil((x1 - x0) / 9000)), nz = Math.max(1, Math.ceil((z1 - z0) / 9000));
            for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
                const ax = x0 + (x1 - x0) * i / nx, bx = x0 + (x1 - x0) * (i + 1) / nx, az = z0 + (z1 - z0) * j / nz, bz = z0 + (z1 - z0) * (j + 1) / nz;
                quad(a, ax, az, bx, az, bx, bz, ax, bz, y, [ax / W, az / H, bx / W, az / H, bx / W, bz / H, ax / W, bz / H], white);
            }
        };
        rect(-E, -E, W + E, -I); rect(-E, H + I, W + E, H + E); rect(-E, -I, -I, H + I); rect(W + I, -I, W + E, H + I);
        a.col.length = 0;
        const m = meshOf('look-horizon', a, mat, { shadows: false });
        if (m) m.alwaysSelectAsActiveMesh = true;
    }

    // Фасад дальних домов 64×64: 4×4 окна; lit — ночная версия (горят не все).
    function farFacade(lit, seed) {
        const [cv, g] = canvas(64, 64), rnd = KR.rng(seed);
        g.fillStyle = lit ? '#000000' : '#e9ecf0'; g.fillRect(0, 0, 64, 64);
        const glow = ['#ffd890', '#ffe9b8', '#8fe6ff', '#ff8ad0', '#fff2d0'];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            if (lit) { if (rnd() < 0.45) continue; g.fillStyle = glow[Math.floor(rnd() * glow.length)]; }
            else g.fillStyle = rnd() < 0.5 ? '#8fa6c0' : '#a9bdd4';
            g.fillRect(i * 16 + 4, j * 16 + 4, 9, 9);
        }
        return cv;
    }

    function buildBackdrop(L) {
        const W = S.W, H = S.H, base = S.base, loc = S.loc, kind = L.backdrop;
        const rnd = KR.rng(KR.hash(S.id.length * 31 + S.id.charCodeAt(0), 77));
        const city = acc(), land = acc();
        const wet = (x, z) => { try { return loc.waterAt(x, z) != null; } catch (e) { return false; } };
        /** Точка в поясе d0..d1 за краем карты, на суше (с запасом r). */
        const spot = (d0, d1, r) => {
            for (let n = 0; n < 24; n++) {
                const x = -d1 + rnd() * (W + 2 * d1), z = -d1 + rnd() * (H + 2 * d1);
                if (x > -d0 && x < W + d0 && z > -d0 && z < H + d0) continue;
                if (wet(x, z) || wet(x + r, z) || wet(x - r, z) || wet(x, z + r) || wet(x, z - r)) continue;
                return [x, z];
            }
            return null;
        };
        const stack = (x, z, size, hgt, levels, shrink, cols, capCol) => {
            const yaw = rnd() * Math.PI;
            let w = size, d = size * (0.7 + rnd() * 0.5), y = base - 20, ox = 0, oz = 0;
            for (let i = 0; i < levels; i++) {
                const h = hgt / levels * (0.8 + rnd() * 0.4), k = i / Math.max(1, levels - 1);
                const col = i === levels - 1 && capCol != null ? capCol : mixc(cols[0], cols[1], k);
                box(land, x + ox, z + oz, w, d, y, y + h + (i ? 0 : 20), yaw, shade(col, 0.94 + rnd() * 0.12), shade(col, 1.06), 0);
                y += h + (i ? 0 : 20);
                ox += (rnd() - 0.5) * w * 0.14; oz += (rnd() - 0.5) * d * 0.14;
                w *= shrink * (0.92 + rnd() * 0.16); d *= shrink * (0.92 + rnd() * 0.16);
            }
        };
        const district = (cx, cz, n, pal, hMax, spacing) => {
            const cols = 2 + Math.floor(rnd() * 3), yaw = Math.floor(rnd() * 2) * Math.PI / 2 + (rnd() - 0.5) * 0.3, c = Math.cos(yaw), s = Math.sin(yaw);
            for (let i = 0; i < n; i++) {
                const gx = (i % cols - (cols - 1) / 2) * spacing, gz = (Math.floor(i / cols) - (n / cols - 1) / 2) * spacing;
                const x = cx + gx * c - gz * s, z = cz + gx * s + gz * c;
                if (rnd() < 0.2 || wet(x, z)) continue;
                const w = 240 + rnd() * 220, d = 240 + rnd() * 220, h = 220 + Math.pow(rnd(), 2.4) * hMax;
                const col = pal[Math.floor(rnd() * pal.length)];
                box(city, x, z, w, d, base - 20, base + h, yaw, col, shade(col, 0.8), 330);
                if (h > 900 && rnd() < 0.6) box(city, x, z, w * 0.6, d * 0.6, base + h, base + h + 120 + rnd() * 420, yaw, shade(col, 1.06), shade(col, 0.8), 330);
            }
        };
        const each = (count, d0, d1, r, fn) => { for (let i = 0; i < count; i++) { const p = spot(d0, d1, r); if (p) fn(p[0], p[1]); } };
        const few = lite() ? 0.6 : 1;
        if (kind === 'city' || kind === 'coast' || kind === 'neon') {
            const pal = kind === 'neon' ? [0x3c3a70, 0x4a4486, 0x322f62, 0x54468e, 0x2c3a6a]
                : kind === 'coast' ? [0xd8c4a8, 0xc8b49c, 0xe2d2bc, 0xb8a894, 0xc9bfb4] : [0xc2ccd8, 0xaebccc, 0xd2ccc0, 0x9fb4cc, 0xd6dade, 0x8faac6];
            each(Math.round((kind === 'neon' ? 22 : kind === 'coast' ? 11 : 16) * few), 3300, 10500, 700, (x, z) => district(x, z, 6 + Math.floor(rnd() * 9), pal, kind === 'neon' ? 2700 : 2000, 520 + rnd() * 120));
            const hills = kind === 'neon' ? [0x243c48, 0x2e4c52] : kind === 'coast' ? [0x6f8f4c, 0x9aa868] : [0x4f9444, 0x74b458];
            each(Math.round((kind === 'coast' ? 16 : 9) * few), 5200, 15000, 1800, (x, z) => stack(x, z, 2600 + rnd() * 2600, (kind === 'coast' ? 700 : 420) + rnd() * (kind === 'coast' ? 1500 : 800), 3 + Math.floor(rnd() * 2), 0.7, hills, null));
        } else if (kind === 'desert') {
            each(Math.round(13 * few), 3400, 14000, 2200, (x, z) => stack(x, z, 2400 + rnd() * 3000, 600 + rnd() * 1300, 3 + Math.floor(rnd() * 2), 0.8, [0xc98a52, 0xdfaa70], 0xe8be88));
            each(Math.round(12 * few), 3000, 12000, 2400, (x, z) => stack(x, z, 3200 + rnd() * 3200, 160 + rnd() * 260, 2, 0.62, [0xe2c48c, 0xeed6a4], null));
            each(3, 4200, 9000, 1700, (x, z) => { const s = 2200 + rnd() * 1400; stack(x, z, s, s * 0.6, 8, 0.86, [0xd8b878, 0xecd29a], 0xf6e4b4); });
        } else if (kind === 'arctic') {
            each(Math.round(15 * few), 3600, 15000, 2400, (x, z) => stack(x, z, 2800 + rnd() * 3000, 1100 + rnd() * 2200, 5, 0.72, [0x8fb0cc, 0xdcecf8], 0xffffff));
            each(Math.round(12 * few), 2900, 9000, 600, (x, z) => stack(x, z, 500 + rnd() * 700, 180 + rnd() * 420, 2, 0.7, [0xbcd8ee, 0xeaf6ff], null));
        }
        if (city.idx.length) {
            const m = new BABYLON.StandardMaterial('look-far-city', S.scene);
            m.specularColor = new BABYLON.Color3(0, 0, 0); m.backFaceCulling = false;
            m.diffuseTexture = texOf('look-far-facade', farFacade(false, 5), { aniso: 2 });
            if (KR.mapInfo(S.id).lit >= 0.5) {
                m.emissiveTexture = texOf('look-far-lit', farFacade(true, 9), { aniso: 2 });
                m.emissiveColor = new BABYLON.Color3(0, 0, 0); m.useEmissiveAsIllumination = true;
            }
            S.mats.push(m);
            meshOf('look-far-city', city, m, { shadows: false });
        }
        if (land.idx.length) {
            land.uv.length = 0;
            const m = new BABYLON.StandardMaterial('look-far-land', S.scene);
            m.specularColor = new BABYLON.Color3(0, 0, 0); m.backFaceCulling = false;
            S.mats.push(m);
            meshOf('look-far-land', land, m, { shadows: false });
        }
        S.stats.far = (city.idx.length + land.idx.length) / 3;
    }

    // --- Оформление земли ----------------------------------------------------------------------------------------------
    // Плитка площадок: 4×4 плиты, серая — цвет даёт вершина.
    function pavingCanvas() {
        const [cv, g] = canvas(256, 256), rnd = KR.rng(41);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            const v = Math.round(214 + rnd() * 26);
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(i * 64, j * 64, 64, 64);
        }
        g.fillStyle = 'rgba(96,98,104,.55)';
        for (let i = 0; i < 4; i++) { g.fillRect(i * 64, 0, 3, 256); g.fillRect(0, i * 64, 256, 3); }
        for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.07)'; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 2 + rnd() * 3); }
        return cv;
    }
    // Тротуар: u — вдоль дороги (4 плиты на повтор), v — поперёк: 0 — бордюр у дороги, 1 — внешний край.
    function walkCanvas() {
        const [cv, g] = canvas(256, 128), rnd = KR.rng(57);
        for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) {
            const v = Math.round(206 + rnd() * 26);
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(i * 64, 30 + j * 49, 64, 49);
        }
        g.fillStyle = 'rgba(100,102,108,.6)';
        for (let i = 0; i < 4; i++) g.fillRect(i * 64 + (i % 2) * 0, 30, 3, 98);
        g.fillRect(0, 78, 256, 3);
        g.fillStyle = '#f4f4f2'; g.fillRect(0, 6, 256, 24);              // бордюрный камень
        g.fillStyle = 'rgba(120,122,128,.55)'; for (let i = 0; i < 8; i++) g.fillRect(i * 32, 6, 2, 24);
        g.fillStyle = '#5a5c62'; g.fillRect(0, 0, 256, 6);                // тень у дороги
        g.fillStyle = 'rgba(70,72,78,.5)'; g.fillRect(0, 28, 256, 3);
        g.fillStyle = 'rgba(60,62,68,.45)'; g.fillRect(0, 124, 256, 4);  // внешний край
        for (let i = 0; i < 300; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)'; g.fillRect(rnd() * 256, 30 + rnd() * 96, 2 + rnd() * 3, 2 + rnd() * 3); }
        return cv;
    }
    function lawnCanvas() {
        const [cv, g] = canvas(256, 256), rnd = KR.rng(73);
        g.fillStyle = '#5fb04a'; g.fillRect(0, 0, 256, 256);
        g.globalAlpha = 0.45; g.globalCompositeOperation = 'soft-light'; g.drawImage(S.noiseCv, 0, 0, 256, 256);
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 700; i++) {
            const x = rnd() * 256, y = rnd() * 256;
            g.globalAlpha = 0.25 + rnd() * 0.3; g.fillStyle = rnd() < 0.5 ? '#7cc85a' : '#4a9a3e';
            g.fillRect(x, y, 2 + rnd() * 2, 4 + rnd() * 5);
        }
        g.globalAlpha = 1;
        return cv;
    }

    // Атлас деталей дорог 512×512, клетка 128: 0 люк, 1 решётка, 2 тёмная заплатка, 3 светлая заплатка, 4 трещина,
    // 5 масляное пятно, 6 следы шин, 7 лужа, 8 снежный намёт, 9 песчаный намёт, 10 мусор и листья.
    function decalCanvas() {
        const [cv, g] = canvas(512, 512), rnd = KR.rng(91);
        const cell = (i, fn) => { g.save(); g.translate((i % 4) * 128 + 64, Math.floor(i / 4) * 128 + 64); fn(); g.restore(); };
        const blob = (r, n, jit) => { g.beginPath(); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, q = r * (1 - jit + rnd() * jit * 2); if (i) g.lineTo(Math.cos(a) * q, Math.sin(a) * q); else g.moveTo(Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); };
        cell(0, () => {
            g.fillStyle = '#2f3136'; g.beginPath(); g.arc(0, 0, 54, 0, 6.3); g.fill();
            g.strokeStyle = '#6c7078'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 49, 0, 6.3); g.stroke();
            g.strokeStyle = '#4a4d54'; g.lineWidth = 5;
            for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-34, i * 14); g.lineTo(34, i * 14); g.stroke(); }
        });
        cell(1, () => {
            g.fillStyle = '#26282c'; g.fillRect(-56, -36, 112, 72);
            g.strokeStyle = '#70747c'; g.lineWidth = 6; g.strokeRect(-53, -33, 106, 66);
            g.fillStyle = '#0c0d10'; for (let i = 0; i < 6; i++) g.fillRect(-44 + i * 15.5, -24, 9, 48);
        });
        cell(2, () => { g.fillStyle = 'rgba(22,23,27,.6)'; g.fillRect(-58, -44, 116, 88); g.strokeStyle = 'rgba(90,92,98,.55)'; g.lineWidth = 4; g.strokeRect(-56, -42, 112, 84); });
        cell(3, () => { g.fillStyle = 'rgba(150,152,158,.42)'; g.fillRect(-58, -40, 116, 80); g.strokeStyle = 'rgba(40,42,46,.4)'; g.lineWidth = 3; g.strokeRect(-56, -38, 112, 76); });
        cell(4, () => {
            g.strokeStyle = 'rgba(14,14,16,.75)'; g.lineWidth = 4; g.lineJoin = 'round';
            const walk = (x, y, a, n, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x, y); for (let i = 0; i < n; i++) { a += (rnd() - 0.5) * 1.1; x += Math.cos(a) * 15; y += Math.sin(a) * 15; g.lineTo(x, y); if (w > 2.5 && rnd() < 0.3) { g.stroke(); walk(x, y, a + (rnd() < 0.5 ? 1 : -1), 3, 2.2); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); } } g.stroke(); };
            walk(-56, -6, 0.1, 7, 4);
        });
        cell(5, () => {
            const gr = g.createRadialGradient(0, 0, 4, 0, 0, 56);
            gr.addColorStop(0, 'rgba(10,10,14,.7)'); gr.addColorStop(0.6, 'rgba(14,14,20,.4)'); gr.addColorStop(1, 'rgba(14,14,20,0)');
            g.fillStyle = gr; blob(52, 14, 0.22); g.fill();
        });
        cell(6, () => {
            g.strokeStyle = 'rgba(12,12,14,.5)'; g.lineWidth = 9; g.lineCap = 'round';
            for (const o of [-18, 18]) { g.beginPath(); g.moveTo(-56, o - 10); g.quadraticCurveTo(0, o + 4, 56, o + 12); g.stroke(); }
        });
        cell(7, () => {
            g.fillStyle = 'rgba(40,52,110,.5)'; blob(50, 16, 0.2); g.fill();
            g.strokeStyle = 'rgba(190,205,255,.5)'; g.lineWidth = 3;
            for (let i = 0; i < 3; i++) { g.beginPath(); g.arc((rnd() - 0.5) * 36, (rnd() - 0.5) * 30, 8 + rnd() * 14, 3.4, 5.2); g.stroke(); }
            g.fillStyle = 'rgba(255,120,220,.25)'; blob(22, 10, 0.3); g.fill();
        });
        cell(8, () => { g.fillStyle = 'rgba(244,250,255,.95)'; blob(54, 16, 0.16); g.fill(); g.fillStyle = 'rgba(190,214,236,.6)'; g.save(); g.translate(6, 10); blob(30, 12, 0.25); g.fill(); g.restore(); });
        cell(9, () => { g.fillStyle = 'rgba(232,206,150,.8)'; blob(54, 16, 0.2); g.fill(); g.strokeStyle = 'rgba(190,160,104,.6)'; g.lineWidth = 3; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-34, i * 16); g.quadraticCurveTo(0, i * 16 - 8, 34, i * 16); g.stroke(); } });
        cell(10, () => {
            const cols = ['#d8d2c0', '#c8a25a', '#8aa860', '#e8e4dc', '#b86a4a'];
            for (let i = 0; i < 16; i++) { g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.save(); g.translate((rnd() - 0.5) * 100, (rnd() - 0.5) * 100); g.rotate(rnd() * 3); g.fillRect(-5, -3, 8 + rnd() * 6, 5 + rnd() * 4); g.restore(); }
        });
        return cv;
    }

    /** Карта затенения земли (множитель цвета ×2 на всю карту): крупные пятна и мягкая тень у домов. */
    function buildAmbient(L) {
        const t = S.loc.terrain, G = L.ground, C = /** @type {any} */ (typeof GameCity !== 'undefined' ? GameCity : null);
        if (!t || !t.material) return;
        const N = lite() ? 1024 : 2048, [cv, g] = canvas(N, N), k = N / S.W, kz = N / S.H;
        g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
        g.globalAlpha = G.noise; g.drawImage(S.noiseCv, 0, 0, N, N);
        g.globalAlpha = G.noise * 0.75;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) g.drawImage(S.noiseCv, i * N / 4, j * N / 4, N / 4, N / 4);
        g.globalAlpha = 1;
        if (C && C.buildings && C.buildings.length) {
            const M = 512, [low, lg] = canvas(M, M), s = M / S.W, sz = M / S.H;
            lg.fillStyle = css(L.ground.ao, 1);
            for (const b of C.buildings) {
                lg.save(); lg.translate(b.x * s, b.z * sz); lg.rotate(b.yaw);
                const w = (b.w + 70) * s, d = (b.d + 70) * sz;
                lg.fillRect(-w / 2, -d / 2, w, d);
                lg.restore();
            }
            g.globalAlpha = G.aoK; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
            g.drawImage(low, 0, 0, N, N);
            g.globalAlpha = 1;
        }
        // к краю карты — нейтрально: за краем множителя нет
        const fr = Math.round(N * 0.035);
        for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, fr, 0, 0, 0, fr, N], [N, 0, N - fr, 0, N - fr, 0, fr, N], [0, 0, 0, fr, 0, 0, N, fr], [0, N, 0, N - fr, 0, N - fr, N, fr]]) {
            const gr = g.createLinearGradient(x0, y0, x1, y1);
            gr.addColorStop(0, 'rgba(128,128,128,1)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
            g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
        }
        void k; void kz;
        const tex = texOf('look-ambient', cv, { clamp: true, aniso: 4 });
        tex.level = 2;
        t.material.ambientTexture = tex;
    }

    function buildGround(L) {
        const C = /** @type {any} */ (typeof GameCity !== 'undefined' ? GameCity : null);
        if (!C) return;
        const G = L.ground, base = S.base, W = S.W, H = S.H, loc = S.loc, small = lite();
        const wet = (x, z) => { try { return loc.waterAt(x, z) != null; } catch (e) { return false; } };

        // --- площадки и газоны под домами ---
        const pads = acc(), lawns = acc();
        for (const b of C.buildings || []) {
            const hsh = KR.hash(Math.round(b.x), Math.round(b.z) + 5), lawn = (hsh % 1000) / 1000 < G.lawnK && b.h <= 420;
            const pad = lawn ? 34 + (hsh >> 4) % 22 : 13 + (hsh >> 4) % 12, hw = b.w / 2 + pad, hd = b.d / 2 + pad;
            const X = [0, 0, 0, 0], Z = [0, 0, 0, 0], lx = [-hw, hw, hw, -hw], lz = [-hd, -hd, hd, hd];
            let bad = false;
            for (let i = 0; i < 4; i++) { X[i] = b.x + lx[i] * b.c - lz[i] * b.s; Z[i] = b.z + lx[i] * b.s + lz[i] * b.c; if (wet(X[i], Z[i])) bad = true; }
            if (bad) continue;
            const y = base + 0.5 + (b.id % 6) * 0.025, T = lawn ? 210 : 150;
            const col = lawn ? rgb(shade(G.lawn, 0.9 + ((hsh >> 9) % 20) / 100)) : rgb(shade(G.pads[(hsh >> 6) % G.pads.length], 0.95 + ((hsh >> 12) % 10) / 100));
            quad(lawn ? lawns : pads, X[0], Z[0], X[1], Z[1], X[2], Z[2], X[3], Z[3], y,
                [X[0] / T, Z[0] / T, X[1] / T, Z[1] / T, X[2] / T, Z[2] / T, X[3] / T, Z[3] / T], [col[0], col[1], col[2], 1]);
        }
        if (pads.idx.length) meshOf('look-pads', pads, groundMat('look-pads', texOf('look-paving', pavingCanvas(), { aniso: 8 }), -1.5, false), {});
        if (lawns.idx.length) meshOf('look-lawns', lawns, groundMat('look-lawns', texOf('look-lawn', lawnCanvas(), { aniso: 8 }), -1.5, false), {});

        // --- тротуары вдоль дорог: полосы, обрезанные по другим дорогам ---
        const roads = (C.roads || []).filter((r) => r.type !== 'runway'), N = roads.length;
        const sw = roads.map((r) => (r.type === 'avenue' ? 40 : 32));
        const walks = acc(), wc = rgb(G.walk), STEP = 10;
        /** Точка лежит на другой дороге (с запасом вдоль ea и поперёк eb)? */
        const onRoad = (px, pz, cand, self, ea, eb) => {
            for (const j of cand) {
                if (j === self) continue;
                const B = roads[j], dx = px - B.x, dz = pz - B.z, lx = dx * B.c + dz * B.s, lz = -dx * B.s + dz * B.c;
                if (Math.abs(lx) <= B.len / 2 + ea && Math.abs(lz) <= B.wid / 2 + eb + (j < self ? sw[j] : 0)) return true;
            }
            return false;
        };
        /** @type {number[][]} */ const near = [];
        for (let i = 0; i < N; i++) {
            const A = roads[i], list = [];
            for (let j = 0; j < N; j++) { const B = roads[j]; if (j !== i && Math.hypot(B.x - A.x, B.z - A.z) < (A.len + A.wid + B.len + B.wid) / 2 + 160) list.push(j); }
            near.push(list);
        }
        for (let i = 0; i < N; i++) {
            const A = roads[i], hl = A.len / 2, hw = A.wid / 2, w = sw[i], n = Math.ceil(A.len / STEP), y = base + 1.2 + (i % 7) * 0.02;
            for (const side of [-1, 1]) {
                const o = side * (hw + w / 2), oi = side * (hw - 1.5), oo = side * (hw + w);
                let run = NaN;
                for (let k = 0; k <= n; k++) {
                    const t = -hl + Math.min(A.len, k * STEP), px = A.x + t * A.c - o * A.s, pz = A.z + t * A.s + o * A.c;
                    const blocked = px < 0 || pz < 0 || px > W || pz > H || onRoad(px, pz, near[i], i, w / 2, w / 2 - 0.5) || wet(px, pz);
                    if (!blocked && Number.isNaN(run)) run = t;
                    if ((blocked || k === n) && !Number.isNaN(run)) {
                        const t1 = blocked ? t - STEP : t;
                        if (t1 - run >= 14) {
                            const ax = A.x + run * A.c, az = A.z + run * A.s, bx = A.x + t1 * A.c, bz = A.z + t1 * A.s, u0 = (run + hl) / 96 + i * 0.37, u1 = (t1 + hl) / 96 + i * 0.37;
                            quad(walks, ax - oi * A.s, az + oi * A.c, bx - oi * A.s, bz + oi * A.c, bx - oo * A.s, bz + oo * A.c, ax - oo * A.s, az + oo * A.c, y, [u0, 0, u1, 0, u1, 1, u0, 1], [wc[0], wc[1], wc[2], 1]);
                        }
                        run = NaN;
                    }
                }
            }
        }
        if (walks.idx.length) meshOf('look-walks', walks, groundMat('look-walks', texOf('look-walk', walkCanvas(), { clampV: true, aniso: 8 }), -2.5, false), {});

        // --- детали на дорогах: люки, заплатки, трещины, пятна ---
        const dec = acc(), rnd = KR.rng(KR.hash(S.id.charCodeAt(0) * 131 + N, 3)), every = small ? 520 : 300;
        let wsum = 0; for (const d of G.decals) wsum += d[1];
        const pick = () => { let r = rnd() * wsum; for (const d of G.decals) { r -= d[1]; if (r <= 0) return d[0]; } return G.decals[0][0]; };
        // размер (px мира) и поворот по виду: [ширина, высота, разброс, случайный поворот]
        const SIZE = { 0: [17, 17, 0.15, 1], 1: [20, 13, 0.1, 0], 2: [70, 52, 0.5, 0], 3: [64, 44, 0.5, 0], 4: [110, 110, 0.4, 1], 5: [56, 56, 0.5, 1], 6: [120, 60, 0.3, 0], 7: [90, 90, 0.5, 1], 8: [100, 100, 0.6, 1], 9: [110, 110, 0.6, 1], 10: [46, 46, 0.4, 1] };
        for (let i = 0; i < N; i++) {
            const A = roads[i], count = Math.floor(A.len / every * (0.6 + rnd() * 0.8));
            for (let n = 0; n < count; n++) {
                const id = pick(), sz = SIZE[id], k = 1 - sz[2] / 2 + rnd() * sz[2], w = sz[0] * k, h = sz[1] * k;
                const edge = id === 1 || id >= 8;                     // решётки и намёты — у бордюра
                const t = (rnd() - 0.5) * Math.max(0, A.len - 120), lat = edge ? (rnd() < 0.5 ? -1 : 1) * (A.wid / 2 - h * 0.5 - 4) : (rnd() - 0.5) * Math.max(0, A.wid - h - 30);
                const px = A.x + t * A.c - lat * A.s, pz = A.z + t * A.s + lat * A.c;
                if (px < 40 || pz < 40 || px > W - 40 || pz > H - 40 || onRoad(px, pz, near[i], i, 60, 60) || wet(px, pz)) continue;
                const ang = A.yaw + (sz[3] ? rnd() * Math.PI * 2 : (rnd() < 0.5 ? 0 : Math.PI)), c = Math.cos(ang), s = Math.sin(ang);
                const X = [0, 0, 0, 0], Z = [0, 0, 0, 0], lx = [-w / 2, w / 2, w / 2, -w / 2], lz = [-h / 2, -h / 2, h / 2, h / 2];
                for (let q = 0; q < 4; q++) { X[q] = px + lx[q] * c - lz[q] * s; Z[q] = pz + lx[q] * s + lz[q] * c; }
                const u0 = (id % 4) * 0.25 + 0.004, v0 = Math.floor(id / 4) * 0.25 + 0.004, u1 = u0 + 0.242, v1 = v0 + 0.242;
                quad(dec, X[0], Z[0], X[1], Z[1], X[2], Z[2], X[3], Z[3], base + 3.6 + (n % 5) * 0.03, [u0, v0, u1, v0, u1, v1, u0, v1], [1, 1, 1, 1]);
            }
        }
        if (dec.idx.length) {
            dec.col.length = 0;
            meshOf('look-decals', dec, groundMat('look-decals', texOf('look-decal', decalCanvas(), { clamp: true, aniso: 8 }), -5.5, true), { alphaIndex: 0 });
        }
        S.stats.ground = { pads: pads.idx.length / 6, lawns: lawns.idx.length / 6, walks: walks.idx.length / 6, decals: dec.idx.length / 6 };
    }

    // --- Пятна света фонарей и вывесок (ночь и закат) ------------------------------------------------------------------
    const LAMP = { lamp: [0xffd9a0, 150], lantern: [0xffb070, 110], stone_lantern: [0xffc890, 90], neon_sign_a: [0xff5ab8, 170], neon_sign_b: [0x5ae0ff, 190],
        big_sign: [0xff6ac0, 320], casino_sign: [0xffd060, 320], shop_sign: [0xffe080, 130], vending: [0x9fe8ff, 90], billboard: [0xcfe4ff, 150],
        traffic_light: [0xff7060, 60], stadium_light: [0xfff4e0, 420], bus_stop: [0xe8f4ff, 110] };
    function buildLamps(L) {
        S.lamps = null;
        const C = /** @type {any} */ (typeof GameCity !== 'undefined' ? GameCity : null);
        if (!C || !(L.lamps > 0) || lite()) return;
        const a = acc(), list = [], max = quality() === 'high' ? 700 : 380;
        for (const p of C.props || []) {
            const info = LAMP[p.id];
            if (!info || list.length >= max) continue;
            const r = info[1] * (0.9 + (KR.hash(Math.round(p.x), Math.round(p.z)) % 20) / 100), c = rgb(info[0]), k = L.lamps;
            quad(a, p.x - r, p.z - r, p.x + r, p.z - r, p.x + r, p.z + r, p.x - r, p.z + r, S.base + 3.8 + (list.length % 9) * 0.02, [0, 0, 1, 0, 1, 1, 0, 1], [c[0] * k, c[1] * k, c[2] * k, 1]);
            list.push(p);
        }
        if (!list.length) return;
        const [cv, g] = canvas(64, 64), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,.62)'); gr.addColorStop(0.35, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        const m = new BABYLON.StandardMaterial('look-lamps', S.scene);
        m.disableLighting = true; m.diffuseColor = new BABYLON.Color3(0, 0, 0); m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.emissiveColor = new BABYLON.Color3(1, 1, 1);
        const tex = texOf('look-lamp', cv, { clamp: true, aniso: 1 });
        tex.hasAlpha = true;
        m.opacityTexture = tex;
        m.alphaMode = BABYLON.Engine.ALPHA_ADD; m.zOffset = -6; m.backFaceCulling = false; m.disableDepthWrite = true; m.fogEnabled = false;
        m.metadata = { toon: false, toonGroup: 'ground' };
        S.mats.push(m);
        const mesh = meshOf('look-lamps', a, m, { shadows: false, alphaIndex: 1, updatable: true });
        if (!mesh) return;
        S.lamps = { mesh, list, col: new Float32Array(a.col), off: new Uint8Array(list.length) };
        S.stats.lamps = list.length;
    }
    /** Сломанный фонарь гаснет. */
    function syncLamps() {
        const Q = S.lamps;
        if (!Q) return;
        let dirty = false;
        for (let i = 0; i < Q.list.length; i++) {
            if (Q.off[i] || !Q.list[i].dead) continue;
            Q.off[i] = 1; dirty = true;
            for (let k = 0; k < 16; k++) Q.col[i * 16 + k] = 0;
        }
        if (dirty) Q.mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, Q.col);
    }

    // --- Постобработка ---------------------------------------------------------------------------------------------------
    function disposePost() {
        for (const p of S.post) { try { p.dispose(S.cam); } catch (e) { /* камера уже без него */ } }
        S.post = [];
        S.pp = false;
    }

    function buildPost() {
        disposePost();
        const cam = S.cam, q = quality();
        const on = !!cam && !IS_MOBILE && q !== 'low' && typeof BABYLON.PostProcess === 'function';
        domVignette(!on);
        if (!on) return;
        ensureShaders();
        const eng = S.scene.getEngine(), wide = q === 'high', BIL = BABYLON.Texture.BILINEAR_SAMPLINGMODE;
        const haze = S.L && S.L.post.haze > 0;
        const mk = (name, frag, uniforms, samplers, ratio, defines) => {
            const p = new BABYLON.PostProcess(name, frag, uniforms, samplers, ratio, cam, BIL, eng, false, defines || null);
            S.post.push(p);
            return p;
        };
        const p0 = mk('look-bright', 'krBright', ['uTexel', 'uP'], [], 1, null);
        const caps = eng.getCaps(), ms = eng.webGLVersion >= 2 ? Math.min(caps.maxMSAASamples || 1, wide ? 4 : 2) : 1;
        if (ms > 1) p0.samples = ms;
        p0.onApply = (e) => { const P = S.L.post; e.setFloat2('uTexel', 1 / p0.width, 1 / p0.height); e.setFloat4('uP', P.bloomT, P.knee, 0.55, P.bloomSat); };
        const blur = (name, ratio, dx, dy, spread) => {
            const p = mk(name, 'krBlur', ['uDir'], [], ratio, null);
            p.onApply = (e) => { e.setFloat2('uDir', dx * spread / p.width, dy * spread / p.height); };
            return p;
        };
        blur('look-blur-h', 0.25, 1, 0, 1.2);
        blur('look-blur-v', 0.25, 0, 1, 1.2);
        let near = null;
        if (wide) { near = blur('look-blur-h2', 0.25, 1, 0, 2.2); blur('look-blur-v2', 0.125, 0, 1, 1.4); }
        const fin = mk('look-final', 'krFinal', ['uGrade', 'uTint', 'uShadow', 'uHaze'], ['sceneSampler', 'bloomNear'], wide ? 0.125 : 0.25,
            (wide ? '#define WIDE\n' : '') + (haze ? '#define HAZE\n' : ''));
        fin.onApply = (e) => {
            const P = S.L.post;
            e.setTextureFromPostProcess('sceneSampler', p0);
            if (near) e.setTextureFromPostProcess('bloomNear', near);
            e.setFloat4('uGrade', P.exposure, P.contrast, P.sat, P.bloomW);
            e.setFloat4('uTint', P.tint[0], P.tint[1], P.tint[2], P.vig);
            e.setFloat4('uShadow', P.shadow[0], P.shadow[1], P.shadow[2], 0);
            // горизонт в кадре: наклон камеры вниз поднимает его над серединой
            const cc = S.app && S.app.camera, pitch = cc && Number.isFinite(cc.pitch) ? cc.pitch : 0.3, hy = 0.5 + Math.tan(pitch) / (2 * Math.tan(cam.fov / 2));
            e.setFloat4('uHaze', P.haze, hy - 0.02, 0.085, S.t);
        };
        if (ms <= 1 && typeof BABYLON.FxaaPostProcess === 'function') S.post.push(new BABYLON.FxaaPostProcess('look-fxaa', 1, cam, BIL, eng, false));
        S.pp = true;
    }

    /** Без постобработки (телефон, низкий уровень) — лёгкая виньетка слоем DOM под HUD. */
    function domVignette(on) {
        if (typeof document === 'undefined') return;
        if (!on) { if (S.dom) S.dom.style.display = 'none'; return; }
        if (!S.dom || !S.dom.isConnected) {
            const e = document.createElement('div');
            e.id = 'kr-look-vignette';
            e.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;';
            document.body.appendChild(e);
            S.dom = e;
        }
        const L = S.L, c = L ? mixc(L.shadow, 0x000000, 0.4) : 0x0a0e1e, a = L ? Math.min(0.5, L.post.vig * 1.15) : 0.3;
        S.dom.style.background = 'radial-gradient(ellipse at center,' + css(c, 0) + ' 52%,' + css(c, a) + ' 100%)';
        S.dom.style.display = 'block';
    }

    // --- Жизненный цикл ---------------------------------------------------------------------------------------------------
    function disposeOwn() {
        const t = S.loc && S.loc.terrain;
        if (t && t.material && t.material.ambientTexture && S.texs.includes(t.material.ambientTexture)) t.material.ambientTexture = null;
        if (t && t.outerMaterial && S.outerTex && t.outerMaterial.diffuseTexture === S.outerTex) t.outerMaterial.diffuseTexture = t.texture || null;
        S.outerTex = null;
        for (const m of S.meshes) { try { if (S.view) World3D.removeObject(S.view, m); else m.dispose(false, false); } catch (e) { /* сцена снята */ } }
        for (const m of S.mats) { try { m.dispose(false, false); } catch (e) { /* */ } }
        for (const x of S.texs) { try { x.dispose(); } catch (e) { /* */ } }
        S.meshes = []; S.mats = []; S.texs = [];
        S.sky = null; S.skyMat = null; S.lamps = null;
    }

    function clear() {
        disposePost();
        disposeOwn();
        domVignette(false);
    }

    async function build(app) {
        const loc = app && app.location, view = loc && loc.view;
        if (!view || !view.scene || typeof BABYLON === 'undefined') return;
        if (S.scene && S.scene !== view.scene) { S.post = []; S.meshes = []; S.mats = []; S.texs = []; S.sky = S.skyMat = S.lamps = null; }   // сцену сменили — прежнее умерло с ней
        else { disposePost(); disposeOwn(); }
        S.app = app; S.loc = loc; S.view = view; S.scene = view.scene; S.cam = view.camera;
        S.id = String(loc.map.id); S.W = loc.width; S.H = loc.height;
        S.base = loc.map.terrain && Number.isFinite(loc.map.terrain.base) ? loc.map.terrain.base : 0;
        const L = S.L = LOOKS[S.id] || LOOKS.metro;
        S.stats = {};
        ensureShaders();
        if (!S.noiseCv) S.noiseCv = noiseCanvas(256, 20261);
        const step = (name, fn) => { try { fn(); } catch (e) { console.warn('GameLook.' + name + ':', e); } };
        step('light', () => { dropOldSky(); applyLight(L); });
        step('sky', () => buildSky(L));
        step('horizon', () => buildHorizon(L));
        step('backdrop', () => buildBackdrop(L));
        step('ambient', () => buildAmbient(L));
        step('ground', () => buildGround(L));
        step('lamps', () => buildLamps(L));
        step('post', () => buildPost());
        if (!S.unsubQ && typeof Quality !== 'undefined' && Quality.onChange) S.unsubQ = Quality.onChange(() => setQuality());
    }

    function update(dt) {
        S.t += Math.min(0.1, dt || 0);
        if (S.skyMat && S.skyA) { S.skyA.x = S.t; S.skyMat.setVector4('uA', S.skyA); }
        if (S.lamps) { S.lampT -= dt; if (S.lampT <= 0) { S.lampT = 0.4; syncLamps(); } }
    }

    function setQuality() {
        if (!S.scene || !S.L) return;
        try { buildPost(); } catch (e) { console.warn('GameLook.post:', e); }
    }

    return { build, update, setQuality, clear, LOOKS, state: S };
})();
