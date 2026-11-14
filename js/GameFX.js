// GameFX.js — визуальные эффекты Kaiju Rampage Ultimate: частицы (app.fx), пулы мешей (кольца, декали, трассеры, луч,
// слэши), DOM (всплывающий текст, вспышки, звёзды розыска). Все вызовы идут через FX(имя, ...) из GameData.js.
//
// Правила: частые эффекты (brickBreak, dustLand, hitKaiju, tracer, ...) — на ПЕРСИСТЕНТНЫХ пулах частиц (BurstSys,
// один выстрел на систему за кадр) и пулах мешей, без новой системы на вызов. Редкие крупные (explosion, slam, обрушение)
// — app.fx.create с защитой от исчерпания бюджета. Меши эффектов: unlit, OVERLAY, не пикаются, без World3D.addObject.
// Пауза: update не зовётся; пулы частиц замораживаются через Pause.onChange; DOM двигается только в update.
// Координаты — Babylon: x, y (вверх), z (= y карты); размеры — px мира.

/** @satisfies {Record<string, any>} */
const GameFX = (() => {
    'use strict';

    // Пути текстур — литералами (сборщик берёт в архив только такие ссылки).
    const T = {
        puff: 'assets/fx/puff.webp', smoke: 'assets/fx/smoke_dark.webp', fire: 'assets/fx/fire_sheet.webp',
        spark: 'assets/fx/spark.webp', flare: 'assets/fx/flare.webp', ring: 'assets/fx/shockwave.webp',
        crack: 'assets/fx/crack.webp', scorch: 'assets/fx/scorch.webp', slash: 'assets/fx/slash.webp',
        beam: 'assets/fx/beam.webp', leaf: 'assets/fx/leaf.webp', star: 'assets/fx/star.webp',
        splash: 'assets/fx/splash.webp', rain: 'assets/fx/rain.webp', snow: 'assets/fx/snow.webp',
        chip: 'assets/fx/chip.webp', glass: 'assets/fx/glass.webp', coin: 'assets/fx/coin.webp',
    };

    // ---- мелкие помощники ----------------------------------------------------------------------------------------
    const rnd = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const easeOut = k => 1 - (1 - k) * (1 - k);
    const num = s => parseInt(String(s || '#ffffff').replace('#', ''), 16) || 0;
    const hexs = n => '#' + (((n & 0xffffff) | 0x1000000).toString(16).slice(1));
    const mixc = (a, b, k) => {
        const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k), g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k),
            bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
        return (r << 16) | (g << 8) | bl;
    };
    const lighten = (n, k) => mixc(n, 0xffffff, k);
    const hsv = (h, s, v) => {
        const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
        return m;
    };
    const V3 = a => new BABYLON.Vector3(a[0], a[1], a[2]);

    const KJ = () => (typeof GameKaiju !== 'undefined' ? GameKaiju : null);
    const kH = () => { const k = KJ(); return (k && k.height) || 300; };
    const kScale = () => { const k = KJ(); return (k && k.scale) || 1; };
    const ks = () => Math.pow(Math.max(1, kScale()), 0.6);        // множитель размера для эффектов армии
    const gY = () => (typeof GameCity !== 'undefined' && GameCity.base != null ? GameCity.base : 0) + 3;
    const OVL = () => (typeof World3D !== 'undefined' && World3D.LAYER ? World3D.LAYER.OVERLAY : 0);

    // ---- состояние -----------------------------------------------------------------------------------------------
    const S = {
        app: /** @type {any} */ (null), fx: /** @type {any} */ (null), scene: /** @type {any} */ (null), view: /** @type {any} */ (null),
        cam: /** @type {any} */ (null), ok: false, inited: false,
        q: 'high', qk: 1, mob: 1, pk: 1, decalMax: 40,
        t: 0, frame: 0,
        /** @type {Record<string, {v:number, t:number}>} */ buckets: {},
        /** @type {Array<{at:number, fn:Function}>} */ later: [],
        /** @type {Record<string, any>} */ pools: {},
        /** @type {any[]} */ rings: [], /** @type {any[]} */ decals: [], /** @type {any[]} */ strips: [],
        /** @type {any[]} */ glows: [], /** @type {any[]} */ slashes: [], /** @type {any[]} */ zones: [],
        /** @type {Set<any>} */ keep: new Set(),
        mats: /** @type {Map<string, any>} */ (new Map()), texs: /** @type {Map<string, any>} */ (new Map()),
        stripVD: /** @type {any} */ (null), heart: '',
        /** @type {Set<any>} */ trails: new Set(),
        unsubPause: /** @type {any} */ (null), unsubQuality: /** @type {any} */ (null),
    };

    // Ведро токенов: take(ключ, в секунду, пачка) — true, если можно.
    function take(key, rate, burst) {
        burst = Math.max(1, burst);
        const b = S.buckets[key] || (S.buckets[key] = { v: burst, t: S.t });
        b.v = Math.min(burst, b.v + (S.t - b.t) * rate); b.t = S.t;
        if (b.v >= 1) { b.v -= 1; return true; }
        return false;
    }
    function later(delay, fn) { S.later.push({ at: S.t + delay, fn }); }
    function busy() {
        const cap = typeof FX_MAX_SYSTEMS !== 'undefined' ? FX_MAX_SYSTEMS : 96;
        return !!(S.fx && S.fx.effects && S.fx.effects.size > cap * 0.6);
    }

    // Составной эффект через менеджер частиц: счётчики — на качество; null при исчерпании бюджета пропускается.
    function P(layers, pos) {
        /** @type {any[]} */ const out = [];
        if (!S.fx) return out;
        for (const l of layers) {
            if (!l) continue;
            const o = Object.assign({}, l, { position: pos });
            if (o.burst != null) o.burst = Math.max(1, Math.round(o.burst * S.qk));
            if (o.rate != null) o.rate = o.rate * S.qk;
            let h = null;
            try { h = S.fx.create(o); } catch (e) { h = null; }
            if (h) out.push(h);
        }
        return out;
    }

    // ---- пул частиц: персистентные системы, один выстрел на систему за кадр -------------------------------------
    class BurstSys {
        constructor(name, o) {
            this.o = o; this.i = 0;
            /** @type {any[]} */ this.list = []; /** @type {number[]} */ this.f = []; /** @type {any[]} */ this.em = [];
            const cap = Math.max(8, Math.ceil(o.cap * S.mob));
            for (let n = 0; n < (o.k || 3); n++) {
                const ps = new BABYLON.ParticleSystem('gfx-' + name, cap, S.scene, null, !!o.sheet);
                ps.particleTexture = S.fx.texture(o.tex);
                ps.renderingGroupId = S.fx.renderGroup();
                const em = new BABYLON.Vector3(0, -9999, 0); ps.emitter = em;
                const d = o.dir || [[-1, -1, -1], [1, 1, 1]];
                ps.direction1 = V3(d[0]); ps.direction2 = V3(d[1]);
                ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
                ps.minSize = o.size ? o.size[0] : 1; ps.maxSize = o.size ? o.size[1] : 1;
                ps.minEmitPower = o.power[0]; ps.maxEmitPower = o.power[1];
                ps.gravity = V3(o.gravity || [0, 0, 0]);
                ps.minAngularSpeed = o.spin ? o.spin[0] : 0; ps.maxAngularSpeed = o.spin ? o.spin[1] : 0;
                ps.color1 = new BABYLON.Color4(1, 1, 1, 1); ps.color2 = new BABYLON.Color4(1, 1, 1, 1); ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
                ps.blendMode = o.add ? BABYLON.ParticleSystem.BLENDMODE_ADD : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
                for (const g of o.sg || []) ps.addSizeGradient(g[0], g[1], g[2] != null ? g[2] : g[1]);
                if (o.sheet) {   // раскадровка: кадры идут по жизни частицы
                    ps.spriteCellWidth = o.sheet.width; ps.spriteCellHeight = o.sheet.height;
                    ps.startSpriteCellID = 0; ps.endSpriteCellID = o.sheet.end; ps.spriteCellChangeSpeed = 1; ps.spriteCellLoop = false;
                }
                ps.emitRate = 0; ps.updateSpeed = Pause.active ? 0 : 1 / 60;
                ps.start();
                this.list.push(ps); this.f.push(-1); this.em.push(em);
            }
        }
        sync() { for (const ps of this.list) ps.updateSpeed = Pause.active ? 0 : 1 / 60; }
        reset() { for (const ps of this.list) { try { ps.reset(); } catch (e) { /* */ } } }
        /** @param {number} x @param {number} y @param {number} z @param {number} n @param {any} [p] c1, c2 (0xRRGGBB), a, sc, d (направления), pw */
        fire(x, y, z, n, p) {
            if (!S.ok) return false;
            const L = this.list, o = this.o;
            let idx = -1;
            for (let k = 0; k < L.length; k++) { const j = (this.i + k) % L.length; if (this.f[j] !== S.frame) { idx = j; break; } }
            if (idx < 0) return false;
            const ps = L[idx]; this.f[idx] = S.frame; this.i = (idx + 1) % L.length;
            p = p || {};
            const sc = p.sc || 1, gsc = o.grav ? Math.sqrt(sc) : sc;
            this.em[idx].copyFromFloats(x, y, z);
            const c1 = p.c1, c2 = p.c2 != null ? p.c2 : p.c1, a = p.a != null ? p.a : 1;
            if (c1 != null) {
                ps.color1.r = ((c1 >> 16) & 255) / 255; ps.color1.g = ((c1 >> 8) & 255) / 255; ps.color1.b = (c1 & 255) / 255; ps.color1.a = a;
                ps.color2.r = ((c2 >> 16) & 255) / 255; ps.color2.g = ((c2 >> 8) & 255) / 255; ps.color2.b = (c2 & 255) / 255; ps.color2.a = a;
                ps.colorDead.r = ps.color2.r; ps.colorDead.g = ps.color2.g; ps.colorDead.b = ps.color2.b; ps.colorDead.a = 0;
            }
            ps.minScaleX = ps.maxScaleX = ps.minScaleY = ps.maxScaleY = sc;
            const pw = p.pw || o.power;
            ps.minEmitPower = pw[0] * gsc; ps.maxEmitPower = pw[1] * gsc;
            const lf = o.grav ? Math.sqrt(sc) : 1;
            ps.minLifeTime = o.life[0] * lf; ps.maxLifeTime = o.life[1] * lf;
            const d = p.d || o.dir || [[-1, -1, -1], [1, 1, 1]];
            ps.direction1.copyFromFloats(d[0][0], d[0][1], d[0][2]); ps.direction2.copyFromFloats(d[1][0], d[1][1], d[1][2]);
            const bx = p.bx || 0, by = p.by || 0;          // объём рождения: ±bx в плане, 0..by вверх
            ps.minEmitBox.copyFromFloats(-bx, 0, -bx); ps.maxEmitBox.copyFromFloats(bx, by, bx);
            const cnt = Math.min(ps.getCapacity(), Math.max(1, Math.round(n * S.pk)));
            ps.manualEmitCount = cnt;
            return true;
        }
    }

    // ---- слоты долгих эффектов (столб дыма над руинами, струя воды): постоянные системы, включаются и гаснут сами ----
    class SlotPool {
        constructor(name, n, o) {
            this.o = o;
            /** @type {any[]} */ this.list = []; /** @type {any[]} */ this.slots = [];
            const cap = Math.max(12, Math.ceil(o.cap * S.mob));
            for (let i = 0; i < n; i++) {
                const ps = new BABYLON.ParticleSystem('gfx-' + name, cap, S.scene);
                ps.particleTexture = S.fx.texture(o.tex);
                ps.renderingGroupId = S.fx.renderGroup();
                const em = new BABYLON.Vector3(0, -9999, 0); ps.emitter = em;
                ps.direction1 = V3(o.dir[0]); ps.direction2 = V3(o.dir[1]);
                ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
                ps.minEmitPower = o.power[0]; ps.maxEmitPower = o.power[1];
                ps.gravity = V3(o.gravity || [0, 0, 0]);
                ps.minAngularSpeed = o.spin ? o.spin[0] : 0; ps.maxAngularSpeed = o.spin ? o.spin[1] : 0;
                ps.minSize = o.size ? o.size[0] : 1; ps.maxSize = o.size ? o.size[1] : 1;
                for (const g of o.sg || []) ps.addSizeGradient(g[0], g[1], g[2] != null ? g[2] : g[1]);
                for (const g of o.cg || []) ps.addColorGradient(g[0], new BABYLON.Color4(g[1], g[2], g[3], g[4]));
                if (o.c1) {
                    ps.color1 = new BABYLON.Color4(o.c1[0], o.c1[1], o.c1[2], o.c1[3]); ps.color2 = new BABYLON.Color4(o.c2[0], o.c2[1], o.c2[2], o.c2[3]);
                    ps.colorDead = new BABYLON.Color4(o.c2[0], o.c2[1], o.c2[2], 0);
                }
                ps.blendMode = o.add ? BABYLON.ParticleSystem.BLENDMODE_ADD : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
                ps.emitRate = 0; ps.updateSpeed = Pause.active ? 0 : 1 / 60;
                ps.start();
                this.list.push(ps);
                this.slots.push({ ps, em, on: false, until: 0, born: 0, x: 0, y: 0, z: 0, size: 1, rate: 0, tick: 0, tick2: 0 });
            }
        }
        sync() { for (const ps of this.list) ps.updateSpeed = Pause.active ? 0 : 1 / 60; }
        reset() { for (const s of this.slots) { s.on = false; s.ps.emitRate = 0; try { s.ps.reset(); } catch (e) { /* */ } } }
        /** Слот у точки (его можно продлить), свободный или тот, что догорит раньше всех. */
        take(x, z, r) {
            let free = null, soon = null;
            for (const s of this.slots) {
                if (s.on && Math.abs(s.x - x) < r && Math.abs(s.z - z) < r) return s;
                if (!s.on) { if (!free) free = s; } else if (!soon || s.until < soon.until) soon = s;
            }
            return free || soon;
        }
    }

    const UP = [[-1, 0.15, -1], [1, 1, 1]];
    const OMNI = [[-1, -0.2, -1], [1, 1, 1]];
    const RING = [[-1, 0.03, -1], [1, 0.3, 1]];

    function buildPools() {
        const mk = (name, o) => { S.pools[name] = new BurstSys(name, o); };
        mk('puff', { tex: T.puff, k: 6, cap: 90, life: [0.5, 1.1], sg: [[0, 14, 22], [0.4, 34, 46], [1, 54, 72]], dir: UP, power: [20, 70], gravity: [0, 12, 0], spin: [-1, 1] });
        mk('chips', { tex: T.chip, k: 4, cap: 60, life: [0.7, 1.2], size: [5, 9], dir: [[-1, 0.4, -1], [1, 1.6, 1]], power: [90, 230], gravity: [0, -520, 0], spin: [-6, 6], grav: true });
        mk('glass', { tex: T.glass, k: 2, cap: 30, life: [0.6, 1], size: [5, 9], dir: [[-1, 0.4, -1], [1, 1.6, 1]], power: [90, 220], gravity: [0, -480, 0], spin: [-5, 5], grav: true });
        mk('leaf', { tex: T.leaf, k: 3, cap: 50, life: [1, 1.8], size: [6, 11], dir: [[-1, 0.2, -1], [1, 1.4, 1]], power: [40, 130], gravity: [0, -90, 0], spin: [-4, 4], grav: true });
        mk('drop', { tex: T.splash, k: 2, cap: 40, life: [0.6, 1.1], size: [4, 8], dir: [[-0.5, 1, -0.5], [0.5, 1.8, 0.5]], power: [110, 260], gravity: [0, -480, 0], grav: true });
        mk('spark', { tex: T.spark, add: true, k: 5, cap: 70, life: [0.25, 0.55], sg: [[0, 6, 9], [1, 1, 2]], dir: OMNI, power: [80, 260], gravity: [0, -420, 0], grav: true });
        mk('smoke', { tex: T.smoke, k: 3, cap: 40, life: [0.6, 1.2], sg: [[0, 8, 12], [1, 26, 36]], dir: [[-0.4, 0.4, -0.4], [0.4, 1, 0.4]], power: [10, 40], gravity: [0, 10, 0] });
        mk('coin', { tex: T.coin, k: 3, cap: 40, life: [1, 1.5], size: [10, 15], dir: [[-0.6, 1, -0.6], [0.6, 1.4, 0.6]], power: [200, 360], gravity: [0, -700, 0], spin: [-8, 8], grav: true });
        // 2.0: удары обломков, клубы пыли, огненный шар, конфетти — свои пулы, чтобы частые вызовы не съедали пулы кирпичей
        mk('ipuff', { tex: T.puff, k: 6, cap: 36, life: [0.4, 0.8], sg: [[0, 9, 14], [0.4, 24, 34], [1, 38, 52]], dir: RING, power: [24, 80], gravity: [0, 10, 0], spin: [-1, 1] });
        mk('cloud', { tex: T.puff, k: 6, cap: 44, life: [1.5, 2.7], sg: [[0, 24, 34], [0.3, 62, 84], [1, 96, 128]], dir: [[-1, 0.08, -1], [1, 0.6, 1]], power: [12, 46], gravity: [0, 7, 0], spin: [-0.6, 0.6] });
        mk('boom', { tex: T.fire, sheet: { width: 128, height: 128, end: 15 }, k: 4, cap: 6, life: [0.7, 0.95], sg: [[0, 70, 90], [0.3, 120, 150], [1, 140, 170]], dir: [[-0.3, 0.3, -0.3], [0.3, 1, 0.3]], power: [8, 36], gravity: [0, 24, 0] });
        mk('confetti', { tex: T.chip, k: 4, cap: 30, life: [0.5, 0.9], size: [3, 5.5], dir: [[-1, 0.8, -1], [1, 2, 1]], power: [50, 130], gravity: [0, -380, 0], spin: [-9, 9], grav: true });
        const lowq = S.q === 'low' || S.mob < 1;
        S.pools.column = new SlotPool('column', lowq ? 4 : S.q === 'medium' ? 7 : 10, { tex: T.smoke, cap: 64, life: [2.4, 3.8], sg: [[0, 22, 30], [0.4, 64, 86], [1, 104, 140]],
            dir: [[-0.22, 1, -0.1], [0.26, 1, 0.34]], power: [34, 78], gravity: [0, 6, 0], spin: [-0.5, 0.5],
            cg: [[0, 0.5, 0.3, 0.16, 0], [0.1, 0.16, 0.14, 0.13, 0.78], [0.55, 0.3, 0.28, 0.27, 0.55], [1, 0.48, 0.46, 0.45, 0]] });
        S.pools.jet = new SlotPool('jet', lowq ? 2 : 4, { tex: T.splash, cap: 110, life: [1, 1.4], size: [5, 9], dir: [[-0.1, 1, -0.1], [0.1, 1, 0.1]], power: [300, 340],
            gravity: [0, -480, 0], c1: [0.82, 0.93, 1, 0.9], c2: [1, 1, 1, 0.9] });
    }
    const pf = (name, x, y, z, n, p) => { const s = S.pools[name]; return s ? s.fire(x, y, z, n, p) : false; };
    // Параметры выстрела без нового объекта на вызов (частые эффекты): q(...) заполняет один общий.
    const Q = { c1: /** @type {any} */ (null), c2: /** @type {any} */ (null), a: 1, sc: 1, d: /** @type {any} */ (null), pw: /** @type {any} */ (null), bx: 0, by: 0 };
    const QD = [[0, 0, 0], [0, 0, 0]], QP = [0, 0];
    function q(c1, c2, a, sc, d, pw) { Q.c1 = c1; Q.c2 = c2; Q.a = a; Q.sc = sc; Q.d = d || null; Q.pw = pw || null; Q.bx = 0; Q.by = 0; return Q; }
    /** Эффект не дальше lim px (× масштаб кайдзю) от кайдзю: мелочь вдали не рисуется. */
    function near(x, z, lim) { const k = KJ(); if (!k) return true; const dx = x - k.x, dz = z - k.z, r = lim * Math.max(1, kScale()); return dx * dx + dz * dz < r * r; }

    // ---- мешевые эффекты: текстуры, материалы, меши ----------------------------------------------------------------
    function mtex(url) {
        let t = S.texs.get(url);
        if (!t) { t = new BABYLON.Texture(url, S.scene); t.hasAlpha = true; S.texs.set(url, t); }
        return t;
    }
    // Unlit материал: цвет — emissiveColor, форма — alpha текстуры (opacityTexture). Кэш по (текстура, цвет, режим).
    function matFor(url, color, add, zoff) {
        const key = url + '|' + color + '|' + (add ? 1 : 0) + '|' + (zoff || 0);
        let m = S.mats.get(key);
        if (m) return m;
        m = makeMat('gfx-' + S.mats.size, mtex(url), color, add, zoff);
        S.mats.set(key, m);
        return m;
    }
    function makeMat(name, tex, color, add, zoff) {
        const m = new BABYLON.StandardMaterial(name, S.scene);
        m.disableLighting = true; m.diffuseColor = new BABYLON.Color3(0, 0, 0); m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.emissiveColor = BABYLON.Color3.FromHexString(hexs(color));
        m.opacityTexture = tex; m.backFaceCulling = false; m.disableDepthWrite = true; m.fogEnabled = false;
        if (add) m.alphaMode = BABYLON.Engine.ALPHA_ADD;
        if (zoff) m.zOffset = zoff;
        m.metadata = { toon: false };
        return m;
    }
    function stripData() {
        if (!S.stripVD) {
            const vd = new BABYLON.VertexData();
            vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
            vd.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
            vd.indices = [0, 1, 2, 0, 2, 3];
            vd.uvs = [0, 0, 0, 1, 1, 1, 1, 0];   // u — поперёк полосы, v — вдоль
            S.stripVD = vd;
        }
        return S.stripVD;
    }
    // kind: 'ground' (плоское кольцо/декаль), 'plane' (плашка), 'bill' (всегда к камере), 'strip' (полоса: x — длина, y — ширина)
    function mkMesh(kind, name) {
        let m;
        if (kind === 'ground') m = BABYLON.MeshBuilder.CreateGround(name, { width: 1, height: 1 }, S.scene);
        else if (kind === 'strip') { m = new BABYLON.Mesh(name, S.scene); stripData().applyToMesh(m); m.rotationQuaternion = new BABYLON.Quaternion(); m.alwaysSelectAsActiveMesh = true; }
        else {
            m = BABYLON.MeshBuilder.CreatePlane(name, { size: 1 }, S.scene);
            if (kind === 'bill') m.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        }
        m.isPickable = false; m.receiveShadows = false; m.renderingGroupId = OVL(); m.isVisible = false; m.doNotSyncBoundingInfo = false;
        return m;
    }
    function acquire(arr, max) {
        let best = null;
        const n = Math.min(arr.length, max || arr.length);
        for (let i = 0; i < n; i++) { const it = arr[i]; if (!it.on && !it.held) return it; if (!it.held && (!best || it.born < best.born)) best = it; }
        return best || arr[0];
    }
    function off(it) { it.on = false; it.m.isVisible = false; }

    function buildMeshes() {
        const mob = S.mob < 1;
        for (let i = 0; i < (mob ? 8 : 14); i++) S.rings.push({ m: mkMesh('ground', 'gfx-ring'), on: false, born: 0 });
        for (let i = 0; i < (mob ? 20 : 40); i++) S.decals.push({ m: mkMesh('ground', 'gfx-decal'), on: false, born: 0 });
        for (let i = 0; i < (mob ? 36 : 56); i++) S.strips.push({ m: mkMesh('strip', 'gfx-strip'), on: false, born: 0 });
        for (let i = 0; i < (mob ? 70 : 120); i++) S.glows.push({ m: mkMesh('bill', 'gfx-glow'), on: false, held: false, born: 0 });
        for (let i = 0; i < (mob ? 8 : 18); i++) S.zones.push({ m: mkMesh('ground', 'gfx-fire'), on: false, born: 0, hs: [], x: 0, y: 0, z: 0, r: 1, t: 0, dur: 1 });
        for (let i = 0; i < 8; i++) S.slashes.push({ m: mkMesh('plane', 'gfx-slash'), on: false, born: 0 });
    }

    // Кольцо на земле: расширяется r0 -> r1 с замедлением, гаснет. o: x,y,z,r0,r1,dur,delay,color,a,add,vy,pw,fade
    function ring(o) {
        if (!S.ok) return;
        const it = acquire(S.rings); Object.assign(it, o, { on: true, t: 0, born: S.t });
        it.delay = o.delay || 0; it.vy = o.vy || 0; it.pw = o.pw || 3; it.fade = o.fade || 1.5;
        it.m.material = matFor(T.ring, o.color, o.add !== false, -1);
        it.m.position.copyFromFloats(o.x, o.y, o.z); it.m.scaling.copyFromFloats(o.r0 * 2.2, 1, o.r0 * 2.2); it.m.visibility = 0; it.m.isVisible = false;
    }
    // Декаль: 'crack' | 'scorch', плоская, угасает за life секунд. o: x,z,size,tex,color,a,life,add,y
    function decal(o) {
        if (!S.ok) return;
        const it = acquire(S.decals, S.decalMax); Object.assign(it, o, { on: true, t: 0, born: S.t });
        it.rot = Math.random() * Math.PI * 2;
        it.m.material = matFor(o.tex, o.color, !!o.add, -4);
        it.m.position.copyFromFloats(o.x, (o.y != null ? o.y : gY()), o.z); it.m.rotation.y = it.rot;
        it.m.scaling.copyFromFloats(o.size * 0.6, 1, o.size * 0.6); it.m.visibility = 0; it.m.isVisible = true;
    }
    // Светящийся шар-спрайт (билборд). o: x,y,z,s0,s1,dur,delay,color,a,add
    function glow(o) {
        if (!S.ok) return null;
        const it = acquire(S.glows); Object.assign(it, o, { on: true, t: 0, born: S.t });
        it.delay = o.delay || 0; it.manual = false; it.held = false;
        it.m.material = matFor(T.flare, o.color, o.add !== false, 0);
        it.m.position.copyFromFloats(o.x, o.y, o.z); it.m.scaling.copyFromFloats(o.s0, o.s0, 1); it.m.visibility = 0; it.m.isVisible = false;
        return it;
    }
    // Полоса a -> b, обращённая к камере. o: ax..bz,w0,w1,dur,color,a,add,head(длина хвоста для летящей головы)
    function strip(o) {
        if (!S.ok) return;
        const it = acquire(S.strips); Object.assign(it, o, { on: true, t: 0, born: S.t });
        it.m.material = matFor(T.beam, o.color, o.add !== false, 0);
        it.m.isVisible = true; it.m.visibility = 0;
        orientStrip(it.m, o.ax, o.ay, o.az, o.bx, o.by, o.bz, o.w0);
    }
    const TM = new BABYLON.Matrix();
    function orientStrip(m, ax, ay, az, bx, by, bz, w) {
        let X = bx - ax, Y = by - ay, Z = bz - az;
        const len = Math.hypot(X, Y, Z) || 0.001; X /= len; Y /= len; Z /= len;
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
        const cp = S.cam ? S.cam.position : null;
        let cx = cp ? cp.x - mx : 0, cy = cp ? cp.y - my : 1, cz = cp ? cp.z - mz : 0;
        const d = cx * X + cy * Y + cz * Z; cx -= X * d; cy -= Y * d; cz -= Z * d;
        let cl = Math.hypot(cx, cy, cz);
        if (cl < 1e-4) { cx = 0; cy = 1; cz = 0; const d2 = Y; cx -= X * d2; cy -= Y * d2; cz -= Z * d2; cl = Math.hypot(cx, cy, cz) || 1; }
        cx /= cl; cy /= cl; cz /= cl;
        // Ось Y = Z × X
        const yx = cy * Z - cz * Y, yy = cz * X - cx * Z, yz = cx * Y - cy * X;
        BABYLON.Matrix.FromXYZAxesToRef(new BABYLON.Vector3(X, Y, Z), new BABYLON.Vector3(yx, yy, yz), new BABYLON.Vector3(cx, cy, cz), TM);
        BABYLON.Quaternion.FromRotationMatrixToRef(TM, m.rotationQuaternion);
        m.position.copyFromFloats(mx, my, mz); m.scaling.copyFromFloats(len, w, 1);
    }
    // Рваная молния a -> b из коротких полос.
    function bolt(ax, ay, az, bx, by, bz, seg, jit, color, dur, width) {
        const px = [ax], py = [ay], pz = [az];
        const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1;
        for (let i = 1; i < seg; i++) {
            const k = i / seg;
            px.push(ax + dx * k + rnd(-jit, jit)); py.push(ay + dy * k + rnd(-jit, jit) * 0.6); pz.push(az + dz * k + rnd(-jit, jit));
        }
        px.push(bx); py.push(by); pz.push(bz); void len;
        for (let i = 0; i < seg; i++) strip({ ax: px[i], ay: py[i], az: pz[i], bx: px[i + 1], by: py[i + 1], bz: pz[i + 1], w0: width, w1: width * 0.4, dur, color, a: 1, add: true });
    }
    // Слэш когтей: плашка slash.webp лицом к камере. o: x,y,z,w,side,color,dur,a,add,grow
    function slash(o) {
        if (!S.ok) return;
        const it = acquire(S.slashes); Object.assign(it, o, { on: true, t: 0, born: S.t });
        it.m.material = matFor(T.slash, o.color, o.add !== false, 0);
        const cp = S.cam ? S.cam.position : null;
        const yaw = cp ? Math.atan2(o.x - cp.x, o.z - cp.z) : 0;
        it.yaw = yaw; it.roll = -o.side * 0.55;
        it.m.position.copyFromFloats(o.x, o.y, o.z); it.m.rotation.copyFromFloats(0, yaw, it.roll);
        it.m.scaling.copyFromFloats(-o.side * o.w * 0.65, o.w * 0.325, 1); it.m.visibility = 0; it.m.isVisible = true;
    }

    // ---- DOM: вспышка, виньетка, звёзды розыска, всплывающий текст ------------------------------------------------
    const D = {
        root: /** @type {any} */ (null), flash: /** @type {any} */ (null), vig: /** @type {any} */ (null), edge: /** @type {any} */ (null),
        star: /** @type {any} */ (null), tint: /** @type {any} */ (null),
        fl: { a: 0, t: 0, dur: 1 }, vg: { a: 0, t: 0, dur: 1 }, st: { on: false, t: 0, n: 0, flip: -1 },
        /** @type {any[]} */ texts: [],
    };
    function buildDom() {
        if (typeof document === 'undefined') return;
        if (D.root && D.root.isConnected) return;
        const mk = (css, parent) => { const e = document.createElement('div'); e.style.cssText = css; parent.appendChild(e); return e; };
        const r = document.createElement('div');
        r.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:31;';
        document.body.appendChild(r); D.root = r;
        const full = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;display:none;';
        D.tint = mk(full + 'background:rgba(214,170,96,.13);', r);
        D.flash = mk(full, r);
        D.vig = mk(full + 'background:radial-gradient(ellipse at center,rgba(255,30,30,0) 42%,rgba(255,30,30,.95) 100%);', r);
        D.edge = mk(full, r);
        D.star = mk('position:absolute;left:50%;top:38%;display:none;opacity:0;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;', r);
        D.texts = [];
        for (let i = 0; i < 24; i++) {
            const e = document.createElement('div');
            e.style.cssText = 'position:absolute;left:0;top:0;display:none;white-space:nowrap;pointer-events:none;will-change:transform,opacity;' +
                'font-family:var(--kr-font,"Arial Black",system-ui,sans-serif);font-weight:900;font-size:calc(var(--kr-u,12px)*2.1);line-height:1;' +
                '-webkit-text-stroke:calc(var(--kr-u,12px)*.32) var(--kr-ink,#141A26);paint-order:stroke fill;text-shadow:0 2px 0 #141A26;';
            r.appendChild(e);
            D.texts.push({ e, on: false, t: 0, dur: 1, x: 0, y: 0, z: 0, born: 0 });
        }
    }
    function updDom(dt) {
        if (!D.root) return;
        if (D.fl.a > 0) {
            D.fl.t += dt; const k = D.fl.t / D.fl.dur;
            if (k >= 1) { D.fl.a = 0; D.flash.style.opacity = '0'; D.flash.style.display = 'none'; } else D.flash.style.opacity = String(D.fl.a * (1 - k) * (1 - k));
        }
        if (D.vg.a > 0) {
            D.vg.t += dt; const k = D.vg.t / D.vg.dur;
            if (k >= 1) { D.vg.a = 0; D.vig.style.opacity = '0'; D.vig.style.display = 'none'; } else D.vig.style.opacity = String(D.vg.a * Math.sin(Math.min(1, k * 1.0) * Math.PI * 0.5 + 0.0) * (1 - k));
        }
        const st = D.st;
        if (st.on) {
            st.t += dt;
            const t = st.t, T0 = 1.5;
            if (t >= T0) { st.on = false; D.star.style.display = 'none'; D.edge.style.display = 'none'; D.edge.style.opacity = '0'; }
            else {
                const flip = Math.floor(t * 7) % 2;
                if (flip !== st.flip) {
                    st.flip = flip; const c = flip ? '40,110,255' : '255,30,40';
                    D.edge.style.background = 'radial-gradient(ellipse at center,rgba(' + c + ',0) 50%,rgba(' + c + ',.9) 100%)';
                }
                D.edge.style.opacity = String(Math.max(0, 0.9 * (1 - t / 1.1)));
                D.star.style.opacity = String(t < 0.1 ? t / 0.1 : t > 1.2 ? (T0 - t) / 0.3 : 1);
                const kids = D.star.children;
                for (let i = 0; i < kids.length; i++) {
                    const c = /** @type {HTMLElement} */ (kids[i]);
                    if (i === kids.length - 1) {
                        const s = t < 0.25 ? (t / 0.25) * 1.9 : 1.9 - 0.75 * Math.min(1, (t - 0.25) / 0.25);
                        c.style.transform = 'scale(' + s.toFixed(3) + ') rotate(' + ((1 - Math.min(1, t / 0.5)) * 25).toFixed(1) + 'deg)';
                    }
                }
            }
        }
        // Всплывающий текст: проекция каждый кадр.
        let any = false;
        for (const f of D.texts) if (f.on) { any = true; break; }
        if (!any) return;
        const cv = document.getElementById('world3d');
        const cr = cv ? cv.getBoundingClientRect() : null, rr = D.root.getBoundingClientRect();
        const ox = cr ? cr.left - rr.left : 0, oy = cr ? cr.top - rr.top : 0;
        for (const f of D.texts) {
            if (!f.on) continue;
            f.t += dt; const k = f.t / f.dur;
            if (k >= 1) { f.on = false; f.e.style.display = 'none'; continue; }
            const p = S.view && S.view.projectToScreen ? S.view.projectToScreen(f.x, f.z, f.y) : null;
            if (!p || p.behind) { f.e.style.display = 'none'; continue; }
            const rise = easeOut(Math.min(1, k * 1.3)) * 70, pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 0.6);
            f.e.style.display = 'block';
            f.e.style.transform = 'translate(' + (p.x + ox).toFixed(1) + 'px,' + (p.y + oy - rise).toFixed(1) + 'px) translate(-50%,-50%) scale(' + pop.toFixed(3) + ')';
            f.e.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
        }
    }

    // ---- анимация мешей ---------------------------------------------------------------------------------------------
    function updMeshes(dt) {
        for (const r of S.rings) {
            if (!r.on) continue;
            r.t += dt; const t = r.t - r.delay;
            if (t < 0) continue;
            const k = t / r.dur;
            if (k >= 1) { off(r); continue; }
            r.m.isVisible = true;
            const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, r.pw));
            r.m.scaling.copyFromFloats(rad * 2.2, 1, rad * 2.2);
            r.m.position.y = r.y + r.vy * t;
            r.m.visibility = r.a * Math.pow(1 - k, r.fade);
        }
        for (const d of S.decals) {
            if (!d.on) continue;
            d.t += dt;
            if (d.t >= d.life) { off(d); continue; }
            const grow = Math.min(1, d.t / 0.14), s = d.size * (0.6 + 0.4 * easeOut(grow));
            d.m.scaling.copyFromFloats(s, 1, s);
            const fade = Math.min(1, (d.life - d.t) / Math.min(4, d.life * 0.5));
            d.m.visibility = d.a * Math.min(1, d.t / 0.06) * fade;
        }
        for (const g of S.glows) {
            if (!g.on || g.manual) continue;
            g.t += dt; const t = g.t - g.delay;
            if (t < 0) continue;
            const k = t / g.dur;
            if (k >= 1) { off(g); continue; }
            g.m.isVisible = true;
            const s = g.s0 + (g.s1 - g.s0) * easeOut(k);
            g.m.scaling.copyFromFloats(s, s, 1);
            g.m.visibility = g.a * Math.pow(1 - k, 1.4);
        }
        for (const s of S.strips) {
            if (!s.on) continue;
            s.t += dt;
            const k = s.t / s.dur;
            if (k >= 1) { off(s); continue; }
            let ax = s.ax, ay = s.ay, az = s.az, bx = s.bx, by = s.by, bz = s.bz;
            if (s.head) {   // летящая голова с хвостом длиной head
                const len = Math.hypot(s.bx - s.ax, s.by - s.ay, s.bz - s.az) || 1, h = Math.min(1, k * 1.15) * len, tl = Math.max(0, h - s.head);
                const ux = (s.bx - s.ax) / len, uy = (s.by - s.ay) / len, uz = (s.bz - s.az) / len;
                ax = s.ax + ux * tl; ay = s.ay + uy * tl; az = s.az + uz * tl; bx = s.ax + ux * h; by = s.ay + uy * h; bz = s.az + uz * h;
            }
            orientStrip(s.m, ax, ay, az, bx, by, bz, s.w0 + (s.w1 - s.w0) * k);
            s.m.visibility = s.a * Math.pow(1 - k, 0.6);
        }
        for (const s of S.slashes) {
            if (!s.on) continue;
            s.t += dt; const k = s.t / s.dur;
            if (k >= 1) { off(s); continue; }
            const g = 0.65 + 0.5 * easeOut(k), w = s.w;
            s.m.scaling.copyFromFloats(-s.side * w * g, w * 0.5 * g, 1);
            s.m.rotation.z = s.roll + s.side * 0.35 * easeOut(k);
            s.m.visibility = s.a * (k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75);
        }
    }

    // ============================================================================================================
    //  ГОРОД
    // ============================================================================================================
    function brickBreak(x, y, z, size, color) {
        if (!S.ok) return;
        const big = size >= 100;
        if (!big && !take('brick', 40 * S.pk, 8)) return;
        const col = color != null ? color : 0xb8b0a0, light = lighten(col, 0.4);
        const sc = clamp(size / 85, 0.7, 1.4);
        pf('puff', x, y, z, 4 + (big ? 2 : 0), { c1: light, c2: lighten(col, 0.62), a: 0.85, sc, d: UP });
        pf('chips', x, y, z, 4, { c1: col, c2: mixc(col, 0x000000, 0.25), sc: sc * 0.9 });
        // стекло: голубоватые / светлые кирпичи
        const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
        if ((b > r + 12 && b > 150) || Math.random() < 0.2) pf('glass', x, y, z, 3, { c1: lighten(col, 0.55), c2: 0xffffff, sc: sc * 0.9 });
        // пыль, что висит и оседает после удара; у тёмных и металлических стен — искры
        if (take('brickDust', 7 * S.pk, 3)) { const p = q(lighten(col, 0.3), lighten(col, 0.55), 0.6, sc * 0.8, null, null); p.bx = size * 0.3; p.by = size * 0.2; pf('cloud', x, y, z, big ? 4 : 2, p); }
        if (r + g + b < 300 && take('brickSpark', 6 * S.pk, 3)) pf('spark', x, y, z, 5, q(0xfff0a0, 0xffa030, 1, sc, null, null));
    }

    function dustLand(x, y, z, size) {
        if (!S.ok || !take('land', 18 * S.pk, 4)) return;
        const sc = clamp(size / 45, 0.5, 14);
        pf('puff', x, y + 2, z, 5 + Math.min(8, size / 14), { c1: 0xd2c6ae, c2: 0xb0a288, a: 0.6, sc, d: RING, pw: [60, 140] });
        if (size >= 60 && take('landRing', 6, 2)) ring({ x, y: gY(), z, r0: size * 0.2, r1: size * 1.1, dur: 0.5, color: 0xd8ccb4, a: 0.35, add: false });
    }

    function partialCollapse(x, y, z, w, count) {
        if (!S.ok || !take('partial', 4, 2)) return;
        const n = clamp(count || 6, 6, 60), hw = Math.max(40, w) / 2;
        P([
            { texture: T.puff, blend: 'standard', burst: 10 + n, capacity: 90, life: [1.2, 2.2], size: [hw * 0.35, hw * 0.7], sizeGradient: [[0, 0.5], [1, 1.7]],
                box: [[-hw, -20, -hw], [hw, 20, hw]], direction: [[-0.3, -0.5, -0.3], [0.3, -0.05, 0.3]], speed: [40, 110], gravity: [0, -60, 0],
                color: '#cfc7b8', color2: '#a39c90', alpha: 0.75, colorGradient: [[0, '#d9d0c0', 0], [0.15, '#cfc7b8', 0.7], [1, '#8f8a82', 0]] },
            { texture: T.puff, blend: 'standard', burst: 6 + n * 0.4, capacity: 40, life: [0.9, 1.6], size: [hw * 0.3, hw * 0.55], sizeGradient: [[0, 0.5], [1, 1.5]],
                box: [[-hw, -10, -hw], [hw, 10, hw]], direction: [[-1, 0, -1], [1, 0.2, 1]], speed: [hw * 0.4, hw * 0.9], color: '#bdb2a0', alpha: 0.5 },
        ], { x, y, z });
        // осколки вниз и клуб, который расползается у подножия
        pf('chips', x, y, z, 8, q(0xa89c8c, 0x6a6258, 1, clamp(hw / 50, 0.8, 3), [[-1, -0.2, -1], [1, 0.8, 1]], null));
        const p = q(0xd6ccba, 0xb8ae9c, 0.65, clamp(hw / 45, 0.8, 6), null, null); p.bx = hw * 0.7; p.by = 20;
        pf('cloud', x, Math.max(gY(), y - hw * 1.2), z, 5, p);
    }

    function buildingCollapse(x, baseY, z, w, h, d) {
        if (!S.ok) return;
        const W = Math.max(w, d), D0 = S.q === 'low' ? 1 : S.mob < 1 ? 2 : 2.6, bz = busy();
        const hw = w / 2, hd = d / 2, pos = { x, y: baseY, z };
        P([
            { texture: T.puff, blend: 'standard', rate: 70, duration: D0 * 0.65, capacity: 130, life: S.q === 'low' ? [0.7, 1] : [1.6, 2.4],
                size: [W * 0.28, W * 0.5], sizeGradient: [[0, 0.5], [0.5, 1], [1, 1.5]], box: [[-hw, 0, -hd], [hw, h * 0.1, hd]],
                direction: [[-0.18, 0.5, -0.18], [0.18, 1, 0.18]], speed: [h * 0.22, h * 0.45], gravity: [0, -h * 0.08, 0],
                color: '#cfc6b8', color2: '#a49d92', alpha: 0.8, colorGradient: [[0, '#d7cdbd', 0], [0.15, '#d0c6b6', 0.8], [0.7, '#a49d92', 0.55], [1, '#7f7a72', 0]] },
            { texture: T.puff, blend: 'standard', rate: 90, duration: D0 * 0.45, capacity: 120, life: [1, 1.8], size: [W * 0.18, W * 0.34], sizeGradient: [[0, 0.6], [1, 1.6]],
                box: [[-hw * 1.1, 0, -hd * 1.1], [hw * 1.1, 6, hd * 1.1]], direction: [[-1, 0, -1], [1, 0.25, 1]], speed: [W * 0.55, W * 1.2],
                color: '#bdb2a0', color2: '#a29a8c', alpha: 0.6 },
            S.q !== 'low' && !bz && { texture: T.smoke, blend: 'standard', delay: 0.2, rate: 28, duration: D0 * 0.6, capacity: 70, life: [1.8, 3], size: [W * 0.3, W * 0.55],
                sizeGradient: [[0, 0.5], [1, 1.6]], box: [[-hw, 0, -hd], [hw, h * 0.1, hd]], direction: [[-0.2, 0.5, -0.2], [0.2, 1, 0.2]], speed: [h * 0.1, h * 0.22],
                color: '#4a4642', color2: '#6a655f', alpha: 0.55, colorGradient: [[0, '#5a5550', 0], [0.2, '#4a4642', 0.55], [1, '#6a655f', 0]] },
            !bz && { texture: T.spark, blend: 'add', burst: 22, capacity: 30, life: [0.4, 0.9], size: [3, 7], sizeGradient: [[0, 1], [1, 0.2]],
                box: [[-hw, 0, -hd], [hw, h * 0.6, hd]], direction: OMNI, speed: [W * 0.4, W * 1.2], gravity: [0, -450, 0], color: '#ffd27a', color2: '#ff7a1a' },
        ], pos);
        const gy = gY();
        ring({ x, y: gy, z, r0: W * 0.3, r1: W * 2.1, dur: 1.1, color: 0xd6ccba, a: 0.5, add: false });
        later(0.25, () => ring({ x, y: gy, z, r0: W * 0.3, r1: W * 2.8, dur: 1.4, color: 0xcfc4b0, a: 0.3, add: false }));
        decal({ x, z, size: W * 2.2, tex: T.scorch, color: 0x2b2620, a: 0.45, life: 14 });
        // пыль у земли мелкими пачками ещё секунду
        for (let i = 1; i <= 3; i++) later(i * 0.3, () => pf('puff', x + rnd(-hw, hw), baseY + 4, z + rnd(-hd, hd), 6, { c1: 0xc4baa6, c2: 0xa89d88, a: 0.6, sc: clamp(W / 60, 1, 8), d: RING, pw: [40, 120] }));
        // клубы катятся от подножия в стороны: шесть очагов по кругу с задержкой, потом ещё волна подальше
        const n = S.q === 'low' ? 3 : 6, a0 = Math.random() * TAU, csc = clamp(W / 75, 1, 7);
        for (let i = 0; i < n; i++) {
            const a = a0 + i / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
            for (let w = 0; w < 2; w++) later(0.12 + w * 0.5 + i * 0.03, () => {
                const d = (0.55 + w * 0.75), p = q(0xd8cebc, 0xb4aa98, 0.7 - w * 0.2, csc * (1 + w * 0.35), [[ca - 0.5, 0.05, sa - 0.5], [ca + 0.5, 0.45, sa + 0.5]], [W * 0.25, W * 0.6]);
                p.bx = W * 0.12; p.by = h * 0.06;
                pf('cloud', x + ca * hw * d, baseY + 6, z + sa * hd * d, 4, p);
            });
        }
        // обломки и стекло из середины, искры проводки
        pf('chips', x, baseY + h * 0.35, z, 12, q(0xb0a696, 0x6e665c, 1, clamp(W / 70, 1, 4), [[-1, 0.2, -1], [1, 1.4, 1]], null));
        if (S.q !== 'low') pf('glass', x, baseY + h * 0.5, z, 10, q(0xd6eeff, 0xffffff, 0.9, clamp(W / 90, 1, 3), null, null));
        // руины дымят долго
        if (S.q !== 'low' || h > 300) smokeColumn(x, baseY, z, clamp(8 + W / 40, 9, 18), clamp(W * 0.42, 40, 420));
        if (h > 420) glow({ x, y: baseY + h * 0.15, z, s0: W * 1.4, s1: W * 2.6, dur: 0.5, color: 0xfff0d8, a: 0.22, add: true });
    }

    const isLeafy = c => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return (g >= r * 0.9 && g > b + 8) || (r > 200 && b > 150 && g < 215) || (r > 235 && g > 235 && b > 235); };

    function propBreak(x, y, z, radius, height, color, spark, water) {
        if (!S.ok || !take('prop', 25 * S.pk, 6)) return;
        const col = color != null ? color : 0x8a8a8a, sc = clamp(radius / 18, 0.6, 10), py = y + Math.min(height * 0.4, 60 * sc);
        pf('puff', x, py, z, 5 + Math.min(6, radius / 10), { c1: lighten(col, 0.45), c2: lighten(col, 0.65), a: 0.7, sc: sc * 0.9, d: UP });
        if (isLeafy(col)) pf('leaf', x, py, z, 10 + Math.min(10, radius / 3), { c1: col, c2: mixc(col, 0xffffff, 0.2), sc: sc * 0.9 });
        else pf('chips', x, py, z, 6, { c1: col, c2: mixc(col, 0x000000, 0.3), sc: sc * 0.9 });
        if (spark) pf('spark', x, y + height * 0.5, z, 12, { c1: 0xfff0a0, c2: 0x7fe8ff, sc: sc * 0.8 });
        if (water) {
            pf('drop', x, y + 4, z, 16, { c1: 0xcfeaff, c2: 0xffffff, a: 0.9, sc: sc * 1.1 });
            ring({ x, y: gY(), z, r0: radius * 0.5, r1: radius * 2.6, dur: 0.6, color: 0xdff6ff, a: 0.6, add: true });
        }
        if (radius > 60 && take('propBig', 3, 2)) {    // достопримечательность: пыльная волна
            ring({ x, y: gY(), z, r0: radius * 0.4, r1: radius * 1.8, dur: 0.9, color: 0xcfc4b0, a: 0.4, add: false });
            pf('puff', x, y + 6, z, 10, { c1: 0xc9bea9, c2: 0xaa9f8a, a: 0.6, sc: clamp(radius / 40, 1, 8), d: RING, pw: [60, 150] });
        }
    }

    // Взрыв: вспышка -> шар (flipbook) -> искры -> дым; кольцо, ожог. size 1 (машина) .. 4 (огромный).
    function explosion(x, y, z, size) {
        if (!S.ok) return;
        size = clamp(size || 1, 0.3, 6);
        const R = 85 * size, near = y - gY() < R * 0.9 + 40, gy = gY();
        const full = !busy() && take('explFull', 3 * S.qk, 3);
        const low = S.q === 'low';
        if (full) {
            P([
                { texture: T.flare, blend: 'add', burst: 2, capacity: 3, life: [0.14, 0.22], size: [R * 2.4, R * 3.2], speed: [0, 0], color: '#fff1b8', color2: '#ffc060',
                    sizeGradient: [[0, 0.4], [0.25, 1], [1, 0.5]] },
                { texture: T.fire, sheet: { width: 128, height: 128, start: 0, end: 15, speed: 1, loop: false }, blend: 'standard', burst: 3 + size, capacity: 8,
                    life: [0.85, 1.15], size: [R * 1.5, R * 2.4], speed: [0, R * 0.35], direction: [[-1, 0.1, -1], [1, 0.9, 1]],
                    box: [[-R * 0.25, 0, -R * 0.25], [R * 0.25, R * 0.3, R * 0.25]], color: '#ffffff', sizeGradient: [[0, 0.55], [0.35, 1], [1, 1.15]], gravity: [0, R * 0.25, 0] },
                { texture: T.spark, blend: 'add', burst: 22 * Math.pow(size, 0.8), capacity: 44, life: [0.35, 0.95], size: [3, 7], speed: [R * 1.6, R * 4.2],
                    gravity: [0, -520, 0], color: '#ffe08a', color2: '#ff7a1a', direction: [[-1, 0.15, -1], [1, 1, 1]], sizeGradient: [[0, 1], [1, 0.2]] },
                { texture: T.smoke, blend: 'standard', delay: 0.12, burst: 5 + 3 * size, capacity: 24, life: low ? [0.7, 1] : [1.5, 2.8], size: [R * 0.45, R * 0.85],
                    speed: [R * 0.5, R * 1.2], direction: [[-0.35, 0.5, -0.35], [0.35, 1, 0.35]], gravity: [0, R * 0.15, 0], color: '#2c2a2a', color2: '#6b6761', alpha: 0.9,
                    colorGradient: [[0, '#ffb060', 0], [0.12, '#4a4540', 0.85], [0.6, '#3a3836', 0.6], [1, '#55524e', 0]] },
                near && { texture: T.puff, blend: 'standard', burst: 8 + 3 * size, capacity: 40, life: [0.6, 1.1], size: [R * 0.3, R * 0.55], speed: [R * 1.4, R * 2.4],
                    direction: [[-1, 0.03, -1], [1, 0.25, 1]], box: [[-R * 0.2, 0, -R * 0.2], [R * 0.2, 4, R * 0.2]], color: '#c7b99d', color2: '#a89878', alpha: 0.55,
                    sizeGradient: [[0, 0.5], [1, 1.4]], gravity: [0, 5, 0] },
            ], { x, y, z });
        } else {   // лёгкая версия: пул частиц + меши
            glow({ x, y, z, s0: R * 1.2, s1: R * 2.4, dur: 0.3, color: 0xffc060, a: 0.9, add: true });
            pf('spark', x, y, z, 14, { c1: 0xffe08a, c2: 0xff7a1a, sc: R / 60 });
            pf('smoke', x, y + R * 0.2, z, 4, { c1: 0x3a3836, c2: 0x6b6761, a: 0.8, sc: R / 28, pw: [R * 0.2, R * 0.7] });
        }
        if (near) {
            ring({ x, y: gy + 1, z, r0: R * 0.25, r1: R * 2.4, dur: 0.45, color: 0xffd9a0, a: 0.75, add: true });
            decal({ x, z, size: R * 1.9, tex: T.scorch, color: 0x000000, a: 0.8, life: 14 });
        }
        glow({ x, y, z, s0: R * 2, s1: R * 3.4, dur: 0.22, color: 0xffb050, a: 0.8, add: true });
        glow({ x, y, z, s0: R * 0.8, s1: R * 1.5, dur: 0.12, color: 0xffffff, a: 0.9, add: true });
        // осколки по дугам, вторая волна по земле и дым, который остаётся над местом взрыва
        pf('chips', x, y, z, 6 + 2 * size, q(0x4a4642, 0x24211f, 1, clamp(size * 0.9, 0.6, 4), [[-1, 0.5, -1], [1, 1.8, 1]], null));
        if (near) later(0.1, () => ring({ x, y: gy + 1, z, r0: R * 0.3, r1: R * 3.2, dur: 0.7, color: 0xd8ccb4, a: 0.3, add: false }));
        if (near && size >= 1.5 && S.q !== 'low') smokeColumn(x, gy, z, 3 + size * 1.6, R * 0.6);
        const k = KJ();
        if (size >= 3 && k) {
            const dist = Math.hypot(x - k.x, z - k.z);
            if (dist < kH() * 6) flash('#ffcf8a', Math.min(0.35, 0.1 * size), 160);
        }
    }

    // ============================================================================================================
    //  КАЙДЗЮ
    // ============================================================================================================
    const STOMP = {
        dust: { c: 0xcdbd9f, c2: 0x9c8c70, glowc: 0, tex: T.puff },
        fire: { c: 0xff9a30, c2: 0xff3d00, glowc: 0xff7a1a },
        ice: { c: 0xdff6ff, c2: 0x8fd8ff, glowc: 0x9fe4ff },
        electric: { c: 0x8ff4ff, c2: 0x4d7bff, glowc: 0x6fd8ff },
        gold: { c: 0xffe36b, c2: 0xffb400, glowc: 0xffd24a },
        toxic: { c: 0x9dff5a, c2: 0x6a2fff, glowc: 0x7aff3a },
    };

    function stomp(x, y, z, radius, aura) {
        if (!S.ok) return;
        const R = Math.max(30, radius || 66), st = STOMP[(aura && aura.stomp) || 'dust'] || STOMP.dust, gy = gY();
        ring({ x, y: gy + 1, z, r0: R * 0.3, r1: R * 1.5, dur: 0.4, color: 0xd6c9b0, a: 0.45, add: false });
        P([{ texture: T.puff, blend: 'standard', burst: 10, capacity: 24, life: [0.5, 0.9], size: [R * 0.25, R * 0.45], speed: [R * 1.2, R * 2.2],
            direction: [[-1, 0.03, -1], [1, 0.3, 1]], box: [[-R * 0.15, 0, -R * 0.15], [R * 0.15, 2, R * 0.15]], color: '#cdbd9f', color2: '#a89878', alpha: 0.6,
            sizeGradient: [[0, 0.5], [1, 1.5]], gravity: [0, 8, 0] }], { x, y: y + 2, z });
        decal({ x, z, size: R * 1.7, tex: T.crack, color: 0x2a2018, a: 0.6, life: 9 });
        const sty = (aura && aura.stomp) || 'dust';
        if (sty === 'dust') return;
        const c = '#' + st.c.toString(16).padStart(6, '0'), c2 = '#' + st.c2.toString(16).padStart(6, '0');
        ring({ x, y: gy + 2, z, r0: R * 0.2, r1: R * 1.25, dur: 0.5, color: st.glowc, a: 0.8, add: true });
        decal({ x, z, size: R * 1.7, tex: T.crack, color: st.glowc, a: 0.9, life: 2.5, add: true, y: gy + 0.5 });
        const L = [];
        if (sty === 'fire') L.push({ texture: T.spark, blend: 'add', burst: 18, capacity: 24, life: [0.5, 1.1], size: [R * 0.05, R * 0.1], speed: [R * 0.8, R * 2.2], direction: [[-1, 0.4, -1], [1, 1.4, 1]], gravity: [0, -120, 0], color: c, color2: c2 },
            { texture: T.puff, blend: 'add', burst: 6, capacity: 10, life: [0.4, 0.8], size: [R * 0.3, R * 0.5], speed: [R * 0.2, R * 0.6], direction: [[-0.5, 0.6, -0.5], [0.5, 1.2, 0.5]], gravity: [0, R * 0.8, 0], color: c, color2: c2, sizeGradient: [[0, 0.7], [1, 0.1]] });
        else if (sty === 'ice') L.push({ texture: T.glass, blend: 'standard', burst: 14, capacity: 20, life: [0.6, 1.1], size: [R * 0.06, R * 0.12], speed: [R * 1, R * 2.4], direction: [[-1, 0.4, -1], [1, 1.4, 1]], gravity: [0, -300, 0], spin: [-4, 4], color: c, color2: c2 },
            { texture: T.snow, blend: 'standard', burst: 10, capacity: 14, life: [0.8, 1.4], size: [R * 0.08, R * 0.14], speed: [R * 0.3, R * 0.9], direction: [[-1, 0.3, -1], [1, 1, 1]], gravity: [0, -40, 0], color: '#ffffff' });
        else if (sty === 'electric') { L.push({ texture: T.spark, blend: 'add', burst: 20, capacity: 24, life: [0.15, 0.4], size: [R * 0.05, R * 0.1], speed: [R * 1.5, R * 3.5], direction: OMNI, color: c, color2: c2 });
            if (take('stompBolt', 6, 2)) for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283, r = R * rnd(0.9, 1.4); bolt(x, gy + 6, z, x + Math.cos(a) * r, gy + 6, z + Math.sin(a) * r, 5, R * 0.12, st.c, 0.12, R * 0.07); } }
        else if (sty === 'gold') L.push({ texture: T.spark, blend: 'add', burst: 18, capacity: 24, life: [0.6, 1.2], size: [R * 0.05, R * 0.1], speed: [R * 0.8, R * 2], direction: [[-1, 0.5, -1], [1, 1.5, 1]], gravity: [0, -160, 0], color: c, color2: c2 },
            { texture: T.coin, blend: 'standard', burst: 3, capacity: 5, life: [0.8, 1.2], size: [R * 0.1, R * 0.16], speed: [R * 1, R * 1.6], direction: [[-0.5, 1, -0.5], [0.5, 1.4, 0.5]], gravity: [0, -400, 0], spin: [-6, 6], color: '#ffffff' });
        else if (sty === 'toxic') L.push({ texture: T.puff, blend: 'standard', burst: 8, capacity: 12, life: [0.9, 1.5], size: [R * 0.25, R * 0.45], speed: [R * 0.3, R * 0.9], direction: [[-1, 0.2, -1], [1, 1, 1]], gravity: [0, R * 0.2, 0], color: c, color2: c2, alpha: 0.55, sizeGradient: [[0, 0.5], [1, 1.5]] },
            { texture: T.ring, blend: 'add', burst: 7, capacity: 10, life: [0.9, 1.5], size: [R * 0.08, R * 0.16], speed: [R * 0.2, R * 0.6], direction: [[-0.6, 1, -0.6], [0.6, 1.4, 0.6]], gravity: [0, R * 0.4, 0], color: c2 });
        P(L, { x, y: y + 4, z });
    }

    function waterSplash(x, y, z, size) {
        if (!S.ok || !take('water', 6, 3)) return;
        const s = Math.max(20, size || 60);
        ring({ x, y: y + 2, z, r0: s * 0.4, r1: s * 2.8, dur: 0.6, color: 0xdff6ff, a: 0.7, add: true });
        pf('drop', x, y + 4, z, 14, { c1: 0xd6efff, c2: 0xffffff, a: 0.9, sc: s / 14 });
        pf('puff', x, y + 6, z, 5, { c1: 0xe6f4ff, c2: 0xcfe6f6, a: 0.5, sc: s / 30, d: UP });
    }

    function swipe(x, y, z, radius, heading, side) {
        if (!S.ok) return;
        const w = Math.max(100, radius * 2.4), sd = side < 0 ? -1 : 1;
        slash({ x, y, z, w, side: sd, color: 0xffffff, dur: 0.18, a: 1, add: true });
        slash({ x, y, z, w: w * 1.15, side: sd, color: 0x29e0c8, dur: 0.22, a: 0.7, add: true });
        pf('spark', x, y, z, 8, { c1: 0xffffff, c2: 0x7ff3e4, sc: clamp(radius / 90, 1, 8) });
        void heading;
    }

    function tailSweep(x, y, z, radius) {
        if (!S.ok) return;
        const R = Math.max(80, radius), gy = gY();
        ring({ x, y: gy + 2, z, r0: R * 0.4, r1: R * 1.1, dur: 0.3, color: 0xffffff, a: 0.55, add: true, pw: 2 });
        ring({ x, y: gy + 1, z, r0: R * 0.5, r1: R * 1.25, dur: 0.45, color: 0xd6c9b0, a: 0.4, add: false, pw: 2 });
        P([{ texture: T.puff, blend: 'standard', burst: 12, capacity: 24, life: [0.5, 0.9], size: [R * 0.12, R * 0.22], speed: [R * 1.4, R * 2.2], direction: [[-1, 0.02, -1], [1, 0.2, 1]],
            box: [[-R * 0.5, 0, -R * 0.5], [R * 0.5, 4, R * 0.5]], color: '#cdbd9f', color2: '#a89878', alpha: 0.55, sizeGradient: [[0, 0.5], [1, 1.4]] }], { x, y: gy, z });
    }

    function slam(x, y, z, radius) {
        if (!S.ok) return;
        const R = Math.max(150, radius || 400), gy = gY();
        ring({ x, y: gy + 2, z, r0: R * 0.1, r1: R * 1.0, dur: 0.5, color: 0xffe2b0, a: 0.9, add: true });
        ring({ x, y: gy + 1, z, r0: R * 0.15, r1: R * 1.3, dur: 0.8, color: 0xd6c9b0, a: 0.6, add: false, delay: 0.05 });
        later(0.18, () => ring({ x, y: gy + 2, z, r0: R * 0.1, r1: R * 1.5, dur: 0.7, color: 0xffffff, a: 0.5, add: true }));
        decal({ x, z, size: R * 2.2, tex: T.crack, color: 0x2a2018, a: 0.75, life: 12 });
        decal({ x, z, size: R * 1.9, tex: T.crack, color: 0xff8a2a, a: 0.9, life: 3, add: true, y: gy + 0.5 });
        P([
            { texture: T.puff, blend: 'standard', burst: 36, capacity: 60, life: [1, 1.6], size: [R * 0.12, R * 0.26], speed: [R * 1.2, R * 2.2], direction: [[-1, 0.05, -1], [1, 0.45, 1]],
                box: [[-R * 0.1, 0, -R * 0.1], [R * 0.1, 4, R * 0.1]], color: '#cdbd9f', color2: '#a89878', alpha: 0.65, sizeGradient: [[0, 0.5], [1, 1.6]], gravity: [0, 12, 0] },
            { texture: T.spark, blend: 'add', burst: 40, capacity: 50, life: [0.4, 1], size: [3, 8], speed: [R * 1.4, R * 3], direction: [[-1, 0.2, -1], [1, 1.2, 1]], gravity: [0, -520, 0], color: '#ffe08a', color2: '#ff8a2a', sizeGradient: [[0, 1], [1, 0.2]] },
            { texture: T.chip, blend: 'standard', burst: 26, capacity: 34, life: [0.8, 1.5], size: [R * 0.02, R * 0.04], speed: [R * 1.3, R * 2.8], direction: [[-1, 0.5, -1], [1, 1.8, 1]], gravity: [0, -600, 0], spin: [-6, 6], color: '#8a7a68', color2: '#5a4a3a' },
        ], { x, y: gy, z });
        glow({ x, y: gy + 20, z, s0: R * 0.6, s1: R * 1.6, dur: 0.25, color: 0xfff0c0, a: 0.8, add: true });
        flash('#ffffff', 0.35, 140);
    }

    function levelUp(x, y, z, height) {
        if (!S.ok) return;
        const H = Math.max(200, height || kH()), gy = y + 2;
        strip({ ax: x, ay: y, az: z, bx: x, by: y + H * 1.7, bz: z, w0: H * 0.9, w1: H * 1.5, dur: 0.9, color: 0x29e0c8, a: 0.7, add: true });
        strip({ ax: x, ay: y, az: z, bx: x, by: y + H * 1.7, bz: z, w0: H * 0.35, w1: H * 0.6, dur: 0.7, color: 0xffffff, a: 0.8, add: true });
        for (let i = 0; i < 4; i++) ring({ x, y: gy + H * 0.05, z, r0: H * 0.28, r1: H * 0.36, dur: 0.8, delay: i * 0.12, vy: H * 1.4, color: 0x29e0c8, a: 0.8, add: true, pw: 1, fade: 1 });
        ring({ x, y: gy, z, r0: H * 0.2, r1: H * 1.8, dur: 0.7, color: 0x29e0c8, a: 0.8, add: true });
        ring({ x, y: gy, z, r0: H * 0.2, r1: H * 2.4, dur: 0.9, delay: 0.12, color: 0xffffff, a: 0.5, add: true });
        glow({ x, y: y + H * 0.5, z, s0: H * 1.2, s1: H * 2.4, dur: 0.5, color: 0x7ffff0, a: 0.7, add: true });
        P([
            { texture: T.spark, blend: 'add', rate: 120, duration: 0.9, capacity: 110, life: [0.8, 1.4], size: [H * 0.012, H * 0.03], speed: [H * 0.7, H * 1.5],
                box: [[-H * 0.28, 0, -H * 0.28], [H * 0.28, H * 0.1, H * 0.28]], direction: [[-0.15, 1, -0.15], [0.15, 1, 0.15]], color: '#29E0C8', color2: '#d6fff8', sizeGradient: [[0, 0.6], [0.3, 1], [1, 0]] },
            { texture: T.star, blend: 'add', burst: 16, capacity: 20, life: [0.7, 1.3], size: [H * 0.04, H * 0.07], speed: [H * 0.5, H * 1.1], direction: [[-1, 0.4, -1], [1, 1.2, 1]], spin: [-3, 3], color: '#ffe066', color2: '#ffffff', sizeGradient: [[0, 0.3], [0.3, 1], [1, 0]] },
        ], { x, y, z });
        flash('#29E0C8', 0.45, 450);
    }

    const HIT_COL = { gun: [0xffe27a, 0xffa030], shell: [0xffc060, 0xff6a1a], rocket: [0xffc060, 0xff6a1a], bomb: [0xffa040, 0xff4a10], laser: [0x9ff6ff, 0x33c8ff] };
    function hitKaiju(x, y, z, dmg, kind) {
        if (!S.ok) return;
        const sc = Math.pow(Math.max(1, kScale()), 0.8), c = HIT_COL[kind] || HIT_COL.gun;
        if (take('hit', 22 * S.pk, 6)) pf('spark', x, y, z, 4 + Math.min(10, dmg * 1.2), { c1: c[0], c2: c[1], sc });
        if (kind === 'laser' && take('hitLaser', 12, 3)) glow({ x, y, z, s0: 30 * sc, s1: 60 * sc, dur: 0.14, color: 0x9ff6ff, a: 0.8, add: true });
        if (dmg >= 4 && take('hitBig', 4, 2)) {
            explosion(x, y, z, clamp((0.4 + dmg * 0.06) * Math.pow(sc, 0.8), 0.5, 3));
            vignette(Math.min(0.55, 0.15 + dmg * 0.04));
        }
    }

    // ---- атомное дыхание -----------------------------------------------------------------------------------------
    // part: тип частиц вдоль луча. coreAdd:false — тёмная сердцевина обычным смешиванием (void).
    const BREATH = {
        beam: { core: '#e8fbff', glow: '#35c8ff', coreAdd: true, flick: 0.12, scroll: 2.2, beads: 5, bead: 0.9, beadSpeed: 1.2, part: 'spark', jag: 0, scar: 0x15202a },
        fire: { core: '#fff2b0', glow: '#ff7a1a', coreAdd: true, flick: 0.35, scroll: 3.5, beads: 6, bead: 1.1, beadSpeed: 1.6, part: 'flame', jag: 0, scar: 0x1a0c06 },
        ice: { core: '#f4fcff', glow: '#7fd8ff', coreAdd: true, flick: 0.06, scroll: 1.2, beads: 4, bead: 0.8, beadSpeed: 0.8, part: 'shard', jag: 0, scar: 0xcfeaff },
        lightning: { core: '#ffffff', glow: '#7a9bff', coreAdd: true, flick: 0.5, scroll: 8, beads: 3, bead: 0.8, beadSpeed: 2.5, part: 'spark', jag: 1, scar: 0x15162a },
        toxic: { core: '#d8ffb0', glow: '#58d83a', coreAdd: true, flick: 0.2, scroll: 1.6, beads: 5, bead: 1, beadSpeed: 0.9, part: 'bubble', jag: 0, scar: 0x1a3a10 },
        void: { core: '#12001f', glow: '#9b30ff', coreAdd: false, flick: 0.18, scroll: 1.8, beads: 5, bead: 1, beadSpeed: 1, part: 'void', jag: 0, scar: 0x120020 },
        rainbow: { core: '#ffffff', glow: '#ff66cc', coreAdd: true, flick: 0.12, scroll: 2.5, beads: 6, bead: 1, beadSpeed: 1.4, part: 'star', jag: 0, scar: 0x222233, rainbow: true },
        plasma: { core: '#fff0ff', glow: '#ff3ee0', coreAdd: true, flick: 0.22, scroll: 3, beads: 8, bead: 1.5, beadSpeed: 1.8, part: 'spark', jag: 0, scar: 0x22061e },
    };
    const B = {
        on: false, k: 0, st: /** @type {any} */ (null), has: false, last: 0, boltT: 0, scarT: 0, ringT: 0,
        mx: 0, my: 0, mz: 0, dx: 1, dy: 0, dz: 0, len: 0, rad: 30,
        tex: /** @type {any[]} */ ([]), mats: /** @type {any} */ (null), meshes: /** @type {any} */ (null),
        /** @type {any[]} */ beads: [], gM: /** @type {any} */ (null), gE: /** @type {any} */ (null), /** @type {any[]} */ hs: [],
    };

    function ensureBeam() {
        if (B.meshes && !B.meshes.core.isDisposed()) return;
        B.tex = [0, 1, 2].map(() => { const t = new BABYLON.Texture(T.beam, S.scene); t.hasAlpha = true; t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; return t; });
        B.mats = {
            wisp: makeMat('gfx-bwisp', B.tex[0], 0x35c8ff, true, 0), glow: makeMat('gfx-bglow', B.tex[1], 0x35c8ff, true, 0), core: makeMat('gfx-bcore', B.tex[2], 0xffffff, true, 0),
        };
        B.meshes = { wisp: mkMesh('strip', 'gfx-bwisp'), glow: mkMesh('strip', 'gfx-bglow'), core: mkMesh('strip', 'gfx-bcore') };
        B.meshes.wisp.material = B.mats.wisp; B.meshes.glow.material = B.mats.glow; B.meshes.core.material = B.mats.core;
    }
    function bstyle(spec) {
        const id = spec && BREATH[spec.style] ? spec.style : 'beam', base = BREATH[id];
        return Object.assign({ id }, base, { coreN: num((spec && spec.core) || base.core), glowN: num((spec && spec.glow) || base.glow) });
    }
    function releaseBeam() {
        if (B.meshes) for (const k of ['wisp', 'glow', 'core']) B.meshes[k].isVisible = false;
        for (const b of B.beads) { b.held = false; b.manual = false; off(b); }
        B.beads = [];
        for (const g of [B.gM, B.gE]) if (g) { g.held = false; g.manual = false; off(g); }
        B.gM = B.gE = null;
    }
    function breathStart(style) {
        if (!S.ok) return;
        ensureBeam();
        for (const h of B.hs) h.stop();
        B.hs = [];
        releaseBeam();
        const st = bstyle(style);
        B.st = st; B.on = true; B.k = 0; B.has = false; B.last = S.t; B.boltT = 0; B.scarT = 0; B.ringT = 0;
        B.mats.core.alphaMode = st.coreAdd ? BABYLON.Engine.ALPHA_ADD : BABYLON.Engine.ALPHA_COMBINE;
        B.mats.glow.emissiveColor.copyFromFloats(((st.glowN >> 16) & 255) / 255, ((st.glowN >> 8) & 255) / 255, (st.glowN & 255) / 255);
        B.mats.wisp.emissiveColor.copyFrom(B.mats.glow.emissiveColor);
        B.mats.core.emissiveColor.copyFromFloats(((st.coreN >> 16) & 255) / 255, ((st.coreN >> 8) & 255) / 255, (st.coreN & 255) / 255);
        const n = Math.max(2, Math.round(st.beads * Math.max(0.5, S.qk)));
        for (let i = 0; i < n; i++) { const g = glow({ x: 0, y: -9999, z: 0, s0: 10, s1: 10, dur: 1, color: st.coreN, a: 0.9, add: true }); if (g) { g.manual = true; g.held = true; B.beads.push(g); } }
        B.gM = glow({ x: 0, y: -9999, z: 0, s0: 10, s1: 10, dur: 1, color: st.coreN, a: 0.9, add: true });
        B.gE = glow({ x: 0, y: -9999, z: 0, s0: 10, s1: 10, dur: 1, color: st.glowN, a: 0.8, add: true });
        for (const g of [B.gM, B.gE]) if (g) { g.manual = true; g.held = true; }
        // частицы вдоль луча: позиция берётся из startPositionFunction по текущему отрезку
        const H = kH(), rad = H * 0.1, c = '#' + st.coreN.toString(16).padStart(6, '0'), g = '#' + st.glowN.toString(16).padStart(6, '0');
        /** @type {any[]} */ let L;
        if (st.part === 'flame') L = [{ texture: T.puff, blend: 'add', rate: 60, capacity: 120, life: [0.5, 0.9], size: [rad * 0.9, rad * 1.5], speed: [rad * 1, rad * 2.5], direction: [[-0.5, 0.5, -0.5], [0.5, 1.2, 0.5]], gravity: [0, rad * 3, 0], color: c, color2: g, colorGradient: [[0, c, 0.8], [0.5, g, 0.55], [1, '#3a0a00', 0]], sizeGradient: [[0, 0.7], [0.5, 1], [1, 0.2]] },
            { texture: T.spark, blend: 'add', rate: 30, capacity: 50, life: [0.5, 1], size: [rad * 0.15, rad * 0.3], speed: [rad * 1.5, rad * 4], direction: OMNI, gravity: [0, -rad * 4, 0], color: '#ffd060', color2: '#ff5a10' }];
        else if (st.part === 'shard') L = [{ texture: T.glass, blend: 'standard', rate: 30, capacity: 60, life: [0.5, 1], size: [rad * 0.2, rad * 0.45], speed: [rad * 2, rad * 4], direction: OMNI, gravity: [0, -rad * 3, 0], spin: [-4, 4], color: c, color2: g },
            { texture: T.snow, blend: 'standard', rate: 35, capacity: 60, life: [0.8, 1.5], size: [rad * 0.2, rad * 0.35], speed: [rad * 0.5, rad * 1.5], direction: OMNI, gravity: [0, -rad * 1, 0], color: '#ffffff' }];
        else if (st.part === 'bubble') L = [{ texture: T.ring, blend: 'add', rate: 22, capacity: 40, life: [0.8, 1.4], size: [rad * 0.3, rad * 0.6], speed: [rad * 0.6, rad * 1.5], direction: [[-0.6, 0.8, -0.6], [0.6, 1.4, 0.6]], gravity: [0, rad * 1.5, 0], color: c, color2: g },
            { texture: T.puff, blend: 'standard', rate: 28, capacity: 50, life: [0.8, 1.4], size: [rad * 0.9, rad * 1.5], speed: [rad * 0.4, rad * 1], direction: OMNI, gravity: [0, rad * 1, 0], color: g, alpha: 0.45, sizeGradient: [[0, 0.5], [1, 1.4]] }];
        else if (st.part === 'void') L = [{ texture: T.smoke, blend: 'standard', rate: 30, capacity: 60, life: [0.8, 1.4], size: [rad * 1, rad * 1.8], speed: [rad * 0.3, rad * 1], direction: OMNI, color: '#1a0a2a', color2: '#3a1058', alpha: 0.7, sizeGradient: [[0, 0.5], [1, 1.4]] },
            { texture: T.spark, blend: 'add', rate: 40, capacity: 60, life: [0.3, 0.7], size: [rad * 0.15, rad * 0.3], speed: [rad * 1, rad * 3], direction: OMNI, color: g, color2: '#d9a0ff' }];
        else if (st.part === 'star') L = [{ texture: T.star, blend: 'add', rate: 36, capacity: 60, life: [0.5, 1], size: [rad * 0.25, rad * 0.5], speed: [rad * 1, rad * 3], direction: OMNI, spin: [-4, 4], color: '#ffd0f0', color2: '#a0f0ff', sizeGradient: [[0, 0.3], [0.3, 1], [1, 0]] },
            { texture: T.spark, blend: 'add', rate: 40, capacity: 60, life: [0.3, 0.7], size: [rad * 0.15, rad * 0.3], speed: [rad * 1.5, rad * 4], direction: OMNI, color: '#ffffff', color2: '#ffe0a0' }];
        else L = [{ texture: T.spark, blend: 'add', rate: 70, capacity: 110, life: [0.3, 0.7], size: [rad * 0.18, rad * 0.38], speed: [rad * 2, rad * 5], direction: OMNI, gravity: [0, -rad * 2, 0], color: g, color2: c, sizeGradient: [[0, 1], [1, 0.2]] }];
        B.hs = P(L, { x: 0, y: 0, z: 0 });
        const sp = (wm, pos) => {
            if (!B.has) { pos.copyFromFloats(0, -9999, 0); return; }
            const s = Math.pow(Math.random(), 0.8) * B.len, j = B.rad * 0.5;
            pos.copyFromFloats(B.mx + B.dx * s + rnd(-j, j), B.my + B.dy * s + rnd(-j, j), B.mz + B.dz * s + rnd(-j, j));
        };
        for (const h of B.hs) h.system.startPositionFunction = sp;
    }

    function layoutBeam() {
        const st = B.st;
        if (!st || !B.has || !B.meshes) return;
        const t = S.t, k = B.k, rad = B.rad, len = B.len;
        const fl = 1 + (Math.sin(t * 53) + Math.sin(t * 31.7 + 1)) * 0.5 * st.flick;
        const ax = B.mx, ay = B.my, az = B.mz, bx = ax + B.dx * len, by = ay + B.dy * len, bz = az + B.dz * len;
        const M = B.meshes, tile = Math.max(1, len / (rad * 5));
        if (st.rainbow) {
            const c = hsv((t * 0.9) % 1, 0.75, 1), c2 = hsv(((t * 0.9) + 0.5) % 1, 0.3, 1);
            B.mats.glow.emissiveColor.copyFromFloats(c[0], c[1], c[2]); B.mats.wisp.emissiveColor.copyFromFloats(c[0], c[1], c[2]); B.mats.core.emissiveColor.copyFromFloats(c2[0], c2[1], c2[2]);
        }
        const set = (m, i, w, a, sc) => {
            orientStrip(m, ax, ay, az, bx, by, bz, w * k);
            B.tex[i].vScale = tile; B.tex[i].vOffset = -t * sc; m.isVisible = k > 0.001; m.visibility = a * Math.min(1, k * 1.4);
        };
        set(M.wisp, 0, rad * (4 + 0.5 * Math.sin(t * 9)) * fl, 0.35, st.scroll * 0.6);
        set(M.glow, 1, rad * 2.8 * fl, 0.75, st.scroll);
        set(M.core, 2, rad * 1.1 * (0.9 + 0.1 * fl), 1, st.scroll * 1.6);
        // бусины, летящие по лучу, и вспышки на концах
        for (let i = 0; i < B.beads.length; i++) {
            const g = B.beads[i], f = (t * st.beadSpeed + i / B.beads.length) % 1, s = f * len, sz = rad * st.bead * (1.6 + 0.6 * Math.sin(t * 20 + i * 2)) * k;
            g.m.position.copyFromFloats(ax + B.dx * s, ay + B.dy * s, az + B.dz * s); g.m.scaling.copyFromFloats(sz, sz, 1); g.m.isVisible = k > 0.001; g.m.visibility = 0.85 * k;
        }
        if (B.gM) { const s = rad * (5 + 1.5 * Math.sin(t * 25)) * k; B.gM.m.position.copyFromFloats(ax, ay, az); B.gM.m.scaling.copyFromFloats(s, s, 1); B.gM.m.isVisible = k > 0.001; B.gM.m.visibility = 0.9 * k; }
        if (B.gE) { const s = rad * (6.5 + 2 * Math.sin(t * 31)) * k; B.gE.m.position.copyFromFloats(bx, by, bz); B.gE.m.scaling.copyFromFloats(s, s, 1); B.gE.m.isVisible = k > 0.001; B.gE.m.visibility = 0.8 * k; }
        if (st.jag && k > 0.5 && t - B.boltT > 0.06) {
            B.boltT = t;
            bolt(ax, ay, az, bx, by, bz, clamp(Math.round(len / (rad * 3)), 5, 8), rad * 0.9, st.coreN, 0.08, rad * 0.35);
        }
    }

    function breathUpdate(mx, my, mz, dx, dy, dz, length, radius, style) {
        if (!S.ok || !B.on) return;
        B.mx = mx; B.my = my; B.mz = mz; B.dx = dx; B.dy = dy; B.dz = dz; B.len = length; B.rad = radius; B.has = true; B.last = S.t;
        if (style && style.style && B.st && style.style !== B.st.id) breathStart(style);   // смена облика на лету
        layoutBeam();
    }
    function breathHit(x, y, z, style) {
        if (!S.ok || !B.on) return;
        const st = B.st || bstyle(style), sc = Math.max(1, kH() / 300);
        pf('spark', x, y + 4, z, 5, { c1: st.glowN, c2: st.coreN, sc, d: [[-1, 0.3, -1], [1, 1.2, 1]] });
        pf('puff', x, y + 6, z, 2, { c1: mixc(st.scar, 0x888888, 0.3), c2: 0x6a645c, a: 0.5, sc: sc * 1.2, d: UP });
        if (S.t - B.ringT > 0.18) { B.ringT = S.t; ring({ x, y: gY() + 2, z, r0: B.rad * 0.8, r1: B.rad * 3, dur: 0.35, color: st.glowN, a: 0.6, add: true }); }
        if (S.t - B.scarT > 0.4 && y < gY() + 40) { B.scarT = S.t; decal({ x, z, size: B.rad * 3.2, tex: T.scorch, color: st.scar, a: 0.5, life: 7 }); }
    }
    function breathEnd() {
        if (!B.on) return;
        B.on = false;
        for (const h of B.hs) h.stop();
        B.hs = [];
    }
    function updBeam(dt) {
        if (B.on) {
            B.k = Math.min(1, B.k + dt / 0.2);
            if (S.t - B.last > 0.3) breathEnd();
        } else if (B.k > 0) {
            B.k -= dt / 0.16;
            if (B.k <= 0) { B.k = 0; releaseBeam(); return; }
            layoutBeam();
        }
    }

    // ---- аура ------------------------------------------------------------------------------------------------------
    const A = { spec: /** @type {any} */ (null), /** @type {any[]} */ hs: [], H: 0 };
    function disposeAura() { for (const h of A.hs) h.dispose(); A.hs = []; }
    function buildAura() {
        disposeAura();
        const sp = A.spec;
        if (!sp || !S.ok || !S.fx) return;
        const k = KJ();
        if (k && k.alive === false) return;
        const H = kH(); A.H = H;
        const ss = Math.pow(H / 300, 0.8), vs = Math.sqrt(H / 300), W = H * 0.22;
        const c = sp.color || '#ffd24a', c2 = sp.color2 || c;
        const body = [[-W, H * 0.05, -W], [W, H * 0.95, W]], low = [[-W, 0, -W], [W, H * 0.5, W]];
        const R = (n) => n;   // плотность задаёт P() через качество
        /** @type {any[]} */ let L = [];
        switch (sp.shape) {
            case 'flames': L = [{ texture: T.puff, blend: 'add', rate: R(34), capacity: 80, life: [0.5, 0.9], size: [26 * ss, 42 * ss], box: low, direction: [[-0.25, 0.6, -0.25], [0.25, 1, 0.25]], speed: [30 * vs, 70 * vs], gravity: [0, 40 * vs, 0], color: c, color2: c2,
                colorGradient: [[0, '#fff3b0', 0], [0.15, c, 0.85], [0.6, c2, 0.5], [1, '#2a0800', 0]], sizeGradient: [[0, 0.7], [0.5, 1], [1, 0.2]] },
                { texture: T.spark, blend: 'add', rate: 10, capacity: 30, life: [0.8, 1.4], size: [4 * ss, 7 * ss], box: low, direction: [[-0.5, 0.6, -0.5], [0.5, 1.2, 0.5]], speed: [40 * vs, 100 * vs], color: c, color2: c2 }]; break;
            case 'smoke': L = [{ texture: T.smoke, blend: 'standard', rate: 12, capacity: 40, life: [1.4, 2.4], size: [30 * ss, 50 * ss], box: low, direction: [[-0.3, 0.6, -0.3], [0.3, 1, 0.3]], speed: [15 * vs, 35 * vs], color: c, color2: c2, alpha: 0.45, sizeGradient: [[0, 0.5], [1, 1.7]] },
                { texture: T.puff, blend: 'standard', rate: 6, capacity: 20, life: [1.2, 2], size: [24 * ss, 40 * ss], box: low, direction: [[-0.3, 0.6, -0.3], [0.3, 1, 0.3]], speed: [15 * vs, 30 * vs], color: c2, alpha: 0.3, sizeGradient: [[0, 0.5], [1, 1.6]] }]; break;
            case 'stars': L = [{ texture: T.star, blend: 'add', rate: 8, capacity: 24, life: [1, 1.8], size: [10 * ss, 16 * ss], box: body, direction: OMNI, speed: [20 * vs, 50 * vs], spin: [-2, 2], color: c, color2: c2, sizeGradient: [[0, 0], [0.25, 1], [0.6, 0.6], [1, 0]] },
                { texture: T.spark, blend: 'add', rate: 16, capacity: 30, life: [0.6, 1.2], size: [4 * ss, 7 * ss], box: body, direction: OMNI, speed: [20 * vs, 60 * vs], color: c2, color2: c }]; break;
            case 'bubbles': L = [{ texture: T.ring, blend: 'add', rate: 14, capacity: 40, life: [1.5, 2.5], size: [8 * ss, 15 * ss], box: body, direction: [[-0.25, 1, -0.25], [0.25, 1, 0.25]], speed: [20 * vs, 40 * vs], gravity: [0, 8 * vs, 0], color: c, color2: c2, alpha: 0.6, sizeGradient: [[0, 0.6], [1, 1.2]] }]; break;
            case 'lightning': L = [{ texture: T.spark, blend: 'add', rate: 40, capacity: 40, life: [0.1, 0.22], size: [8 * ss, 15 * ss], box: body, direction: OMNI, speed: [60 * vs, 160 * vs], color: c, color2: c2 },
                { texture: T.flare, blend: 'add', rate: 6, capacity: 8, life: [0.1, 0.14], size: [30 * ss, 55 * ss], box: body, direction: [[0, 0, 0], [0, 0, 0]], speed: [0, 0], color: c2, alpha: 0.6 }]; break;
            case 'hearts': L = [{ texture: heartURL(), blend: 'standard', rate: 7, capacity: 24, life: [1.4, 2.2], size: [12 * ss, 20 * ss], box: body, direction: [[-0.3, 0.8, -0.3], [0.3, 1, 0.3]], speed: [15 * vs, 35 * vs], gravity: [0, 15 * vs, 0], color: c, color2: c2, sizeGradient: [[0, 0.3], [0.2, 1], [1, 0.8]] },
                { texture: T.spark, blend: 'add', rate: 12, capacity: 24, life: [0.6, 1.2], size: [4 * ss, 7 * ss], box: body, direction: OMNI, speed: [20 * vs, 50 * vs], color: c2 }]; break;
            case 'snow': L = [{ texture: T.snow, blend: 'standard', rate: 22, capacity: 70, life: [2, 3.2], size: [5 * ss, 9 * ss], box: [[-W * 1.8, H * 0.3, -W * 1.8], [W * 1.8, H * 1.3, W * 1.8]], direction: [[-0.3, -1, -0.3], [0.3, -1, 0.3]], speed: [15 * vs, 40 * vs], color: c, color2: c2 }]; break;
            case 'leaves': L = [{ texture: T.leaf, blend: 'standard', rate: 12, capacity: 40, life: [1.6, 2.6], size: [10 * ss, 16 * ss], box: body, direction: [[-1, -0.1, -1], [1, 0.5, 1]], speed: [20 * vs, 60 * vs], gravity: [0, -12 * vs, 0], spin: [-3, 3], color: c, color2: c2 }]; break;
            case 'toxic': L = [{ texture: T.puff, blend: 'standard', rate: 16, capacity: 40, life: [1.2, 2], size: [24 * ss, 40 * ss], box: low, direction: [[-0.3, 0.6, -0.3], [0.3, 1, 0.3]], speed: [15 * vs, 35 * vs], color: c, color2: c2, alpha: 0.5, sizeGradient: [[0, 0.5], [1, 1.6]] },
                { texture: T.ring, blend: 'add', rate: 8, capacity: 24, life: [1.2, 2], size: [8 * ss, 14 * ss], box: body, direction: [[-0.25, 1, -0.25], [0.25, 1, 0.25]], speed: [20 * vs, 40 * vs], color: c2 }]; break;
            case 'gold': L = [{ texture: T.spark, blend: 'add', rate: 22, capacity: 50, life: [0.8, 1.5], size: [5 * ss, 9 * ss], box: body, direction: [[-0.6, 0.2, -0.6], [0.6, 1, 0.6]], speed: [20 * vs, 60 * vs], gravity: [0, -20 * vs, 0], color: c, color2: c2 },
                { texture: T.coin, blend: 'standard', rate: 3, capacity: 8, life: [1, 1.4], size: [8 * ss, 12 * ss], box: body, direction: [[-0.6, 0.6, -0.6], [0.6, 1.2, 0.6]], speed: [30 * vs, 70 * vs], gravity: [0, -90 * vs, 0], spin: [-5, 5], color: '#ffffff' }]; break;
            case 'void': L = [{ texture: T.smoke, blend: 'standard', rate: 14, capacity: 40, life: [1.2, 2], size: [30 * ss, 50 * ss], box: body, direction: [[-0.4, 0.3, -0.4], [0.4, 1, 0.4]], speed: [10 * vs, 30 * vs], color: '#1a0a2a', color2: c, alpha: 0.7, sizeGradient: [[0, 0.5], [1, 1.8]] },
                { texture: T.spark, blend: 'add', rate: 12, capacity: 30, life: [0.8, 1.4], size: [4 * ss, 8 * ss], box: body, direction: OMNI, speed: [10 * vs, 40 * vs], color: c2, color2: c }]; break;
            default: L = [{ texture: T.spark, blend: 'add', rate: 26, capacity: 60, life: [0.8, 1.5], size: [5 * ss, 9 * ss], box: body, direction: [[-0.8, 0.3, -0.8], [0.8, 1, 0.8]], speed: [20 * vs, 60 * vs], gravity: [0, 12 * vs, 0], color: c, color2: c2, sizeGradient: [[0, 0.4], [0.3, 1], [1, 0]] },
                { texture: T.flare, blend: 'add', rate: 6, capacity: 12, life: [0.8, 1.2], size: [18 * ss, 30 * ss], box: body, direction: [[-0.3, 0, -0.3], [0.3, 0.5, 0.3]], speed: [5, 20], color: c2, alpha: 0.4 }];
        }
        const follow = () => { const g = KJ(); return g ? { x: g.x, y: g.y, z: g.z } : { x: 0, y: 0, z: 0 }; };
        A.hs = P(L.map(l => Object.assign(l, { follow })), follow());
    }
    function heartURL() {
        if (S.heart) return S.heart;
        try {
            const cv = document.createElement('canvas'); cv.width = cv.height = 64;
            const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 4;
            g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 36, 6, 10, 24, 10); g.bezierCurveTo(30, 10, 32, 16, 32, 18); g.bezierCurveTo(32, 16, 34, 10, 40, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 54); g.fill();
            S.heart = cv.toDataURL('image/png');
        } catch (e) { S.heart = T.star; }
        return S.heart;
    }
    function aura(spec) {
        A.spec = spec || null;
        if (S.ok) buildAura(); else disposeAura();
    }
    function updAura(dt) {
        A.chk = (A.chk || 0) - dt;
        if (A.chk > 0) return;
        A.chk = 0.3;
        if (!A.spec) return;
        const k = KJ(), alive = !k || k.alive !== false;
        if (!alive) { if (A.hs.length) disposeAura(); return; }
        if (!A.hs.length || Math.abs(kH() - A.H) > A.H * 0.15) buildAura();
    }

    // ---- погода ----------------------------------------------------------------------------------------------------
    const W = { kind: /** @type {any} */ (null), /** @type {any[]} */ hs: [], H: 0, chk: 0 };
    function disposeWeather() { for (const h of W.hs) h.dispose(); W.hs = []; if (D.tint) { D.tint.style.opacity = '0'; D.tint.style.display = 'none'; } }
    function buildWeather() {
        disposeWeather();
        const kind = W.kind;
        if (!kind || !S.ok || !S.fx) return;
        const H = kH(); W.H = H;
        const hs = H / 300, HR = Math.max(1000, H * 3.4), WD = Math.max(1100, H * 4.2), gy = gY(), qk = S.qk;
        const follow = () => { const g = KJ(); return { x: g ? g.x : 0, y: gy - 3, z: g ? g.z : 0 }; };
        /** @type {any[]} */ let L = [];
        if (kind === 'rain') {
            const fall = HR / 0.6, rate = 520 * Math.min(2, Math.pow(hs, 0.4));
            L.push({ texture: T.rain, blend: 'standard', rate, capacity: Math.ceil(rate * 0.6 * 1.15), life: [0.57, 0.63], size: [26 * Math.sqrt(hs), 34 * Math.sqrt(hs)], speed: [fall * 0.97, fall * 1.03],
                box: [[-WD, HR, -WD], [WD, HR, WD]], direction: [[-0.03, -1, -0.03], [0.03, -1, 0.03]], color: '#cfe2ff', alpha: 0.5, group: undefined, _rain: true });
            if (S.q !== 'low') L.push({ texture: T.splash, blend: 'add', rate: 40, capacity: 30, life: [0.25, 0.4], size: [14 * Math.sqrt(hs), 22 * Math.sqrt(hs)], speed: [0, 0], box: [[-WD * 0.6, 2, -WD * 0.6], [WD * 0.6, 4, WD * 0.6]],
                direction: [[0, 0, 0], [0, 0, 0]], color: '#dfeaff', alpha: 0.35, sizeGradient: [[0, 0.5], [1, 1.5]] });
        } else if (kind === 'snow') {
            const fall = 140 * Math.pow(hs, 0.6), life = HR / fall, rate = 100;
            L.push({ texture: T.snow, blend: 'standard', rate, capacity: Math.min(1600, Math.ceil(rate * life * 1.1)), life: [life * 0.95, life * 1.05], size: [5 * Math.pow(hs, 0.6), 9 * Math.pow(hs, 0.6)], speed: [fall * 0.9, fall * 1.1],
                box: [[-WD, HR, -WD], [WD, HR, WD]], direction: [[-0.4, -1, -0.4], [0.4, -1, 0.4]], spin: [-1, 1], color: '#ffffff', alpha: 0.9 });
        } else if (kind === 'sand') {
            const sp = 380 * Math.sqrt(hs);
            L.push({ texture: T.puff, blend: 'standard', rate: 55, capacity: 260, life: [3, 4], size: [60 * Math.sqrt(hs), 120 * Math.sqrt(hs)], speed: [sp * 0.9, sp * 1.1],
                box: [[-WD * 1.1, 0, -WD], [WD * 0.2, HR * 0.5, WD]], direction: [[1, 0.02, 0.2], [1, 0.08, 0.3]], color: '#d9b77a', color2: '#c9a468', alpha: 0.22, sizeGradient: [[0, 0.6], [1, 1.2]] });
            if (D.tint) { D.tint.style.display = 'block'; D.tint.style.opacity = '1'; }
        }
        const hs2 = P(L.map(l => Object.assign(l, { follow })), follow());
        void qk;
        for (const h of hs2) {
            if (kind === 'rain' && h.system.particleTexture) {   // тонкие вертикальные полосы
                if (h === hs2[0]) { h.system.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_Y; h.system.minScaleX = h.system.maxScaleX = 0.09; h.system.minScaleY = 1.8; h.system.maxScaleY = 2.4; }
            }
            W.hs.push(h);
        }
    }
    function weather(kind) {
        W.kind = kind === 'rain' || kind === 'snow' || kind === 'sand' ? kind : null;
        if (S.ok) buildWeather(); else disposeWeather();
    }
    function updWeather(dt) {
        W.chk -= dt;
        if (W.chk > 0 || !W.kind) return;
        W.chk = 1;
        if (!W.hs.length || Math.abs(kH() - W.H) > W.H * 0.25) buildWeather();
    }

    // ============================================================================================================
    //  АРМИЯ
    // ============================================================================================================
    function tracer(ax, ay, az, bx, by, bz, kind) {
        if (!S.ok) return;
        const k = ks();
        if (kind === 'laser') {
            strip({ ax, ay, az, bx, by, bz, w0: 16 * k, w1: 4 * k, dur: 0.12, color: 0x33e6ff, a: 0.85, add: true });
            strip({ ax, ay, az, bx, by, bz, w0: 6 * k, w1: 2 * k, dur: 0.12, color: 0xffffff, a: 1, add: true });
            if (take('laserEnd', 20, 4)) glow({ x: bx, y: by, z: bz, s0: 40 * k, s1: 20 * k, dur: 0.1, color: 0xaef6ff, a: 0.9, add: true });
        } else strip({ ax, ay, az, bx, by, bz, w0: 3.5 * k, w1: 3 * k, dur: 0.07, color: 0xffe58a, a: 1, add: true, head: 130 * k });
    }

    function muzzle(x, y, z, kind) {
        if (!S.ok) return;
        const k = ks();
        if (kind === 'bullet') { if (take('muzzleB', 25 * S.pk, 6)) glow({ x, y, z, s0: 18 * k, s1: 10 * k, dur: 0.06, color: 0xffe58a, a: 0.9, add: true }); return; }
        if (!take('muzzle', 20 * S.pk, 6)) return;
        if (kind === 'shell') {
            glow({ x, y, z, s0: 70 * k, s1: 40 * k, dur: 0.12, color: 0xffd27a, a: 1, add: true });
            pf('spark', x, y, z, 6, { c1: 0xffe08a, c2: 0xff7a1a, sc: k * 1.1 });
            pf('smoke', x, y, z, 3, { c1: 0x8a847c, c2: 0xb0aaa0, a: 0.6, sc: k * 1.2 });
        } else if (kind === 'rocket') {
            glow({ x, y, z, s0: 46 * k, s1: 28 * k, dur: 0.14, color: 0xffc060, a: 0.9, add: true });
            pf('smoke', x, y, z, 4, { c1: 0xc8c2b8, c2: 0x9a948a, a: 0.7, sc: k * 1.3 });
            pf('spark', x, y, z, 4, { c1: 0xffe08a, c2: 0xff7a1a, sc: k });
        } else pf('smoke', x, y, z, 2, { c1: 0x8a847c, c2: 0xb0aaa0, a: 0.5, sc: k });
    }

    function trail(obj, kind) {
        const rocket = kind === 'rocket', k = ks();
        /** @type {any[]} */ let hs = [];
        if (S.ok && S.trails.size < 14) {
            const follow = () => obj;
            hs = P([
                { texture: T.puff, blend: 'standard', rate: rocket ? 70 : 40, capacity: 90, life: [0.8, 1.5], size: [7 * k, 13 * k], sizeGradient: [[0, 0.5], [1, 2.4]], speed: [0, 6], color: '#e8e4de', color2: '#a8a39c', alpha: 0.7,
                    colorGradient: [[0, '#fff0c0', 0], [0.08, '#d8d4cc', 0.7], [1, '#8a857e', 0]], follow },
                rocket && { texture: T.flare, blend: 'add', rate: 50, capacity: 40, life: [0.1, 0.22], size: [10 * k, 16 * k], color: '#ffb347', color2: '#ff6a00', alpha: 0.9, sizeGradient: [[0, 1], [1, 0.2]], follow },
            ], obj);
        }
        const h = { hs, stopped: false, stop() { if (h.stopped) return; h.stopped = true; for (const x of hs) x.stop(); S.trails.delete(h); } };
        S.trails.add(h);
        return h;
    }

    function unitHit(x, y, z) {
        if (!S.ok || !take('unitHit', 30 * S.pk, 6)) return;
        const k = ks();
        pf('spark', x, y, z, 5, { c1: 0xffe08a, c2: 0xff7a1a, sc: k });
        pf('smoke', x, y, z, 2, { c1: 0x6a645c, c2: 0x8a847c, a: 0.6, sc: k * 0.8 });
    }

    // ============================================================================================================
    //  HUD / игра
    // ============================================================================================================
    function starUp(n) {
        if (!D.root) return;
        n = clamp(n | 0, 1, 6);
        D.st.on = true; D.st.t = 0; D.st.n = n; D.st.flip = -1;
        D.star.innerHTML = ''; D.star.style.display = 'block'; D.star.style.opacity = '0';
        for (let i = 0; i < n; i++) {
            const im = document.createElement('img');
            im.src = 'assets/fx/star.webp'; im.alt = '';
            im.style.cssText = 'width:calc(var(--kr-u,12px)*' + (i === n - 1 ? 7 : 4.5) + ');height:auto;margin:0 calc(var(--kr-u,12px)*.2);vertical-align:middle;' +
                'filter:drop-shadow(0 0 calc(var(--kr-u,12px)*.8) #ffb400) drop-shadow(0 calc(var(--kr-u,12px)*.3) 0 #141A26);' + (i === n - 1 ? '' : 'opacity:.85;');
            D.star.appendChild(im);
        }
        D.edge.style.display = 'block'; D.edge.style.opacity = '0.9';
    }
    function floatText(x, y, z, text, color) {
        if (!D.root) return;
        let it = null, old = null;
        for (const f of D.texts) { if (!f.on) { it = f; break; } if (!old || f.born < old.born) old = f; }
        it = it || old;
        if (!it) return;
        it.on = true; it.t = 0; it.dur = 1.1; it.x = x; it.y = y; it.z = z; it.born = S.t;
        it.e.textContent = String(text); it.e.style.color = color || '#FFC400'; it.e.style.display = 'none';
    }
    function coinBurst(x, y, z, count) {
        if (!S.ok || !take('coin', 15, 4)) return;
        const k = ks();
        pf('coin', x, y, z, clamp(count || 5, 1, 14), { sc: k, c1: 0xffffff });
        pf('spark', x, y, z, 5, { c1: 0xffe36b, c2: 0xffb400, sc: k });
    }
    function flash(color, alpha, ms) {
        if (!D.root) return;
        const a = clamp(alpha == null ? 0.4 : alpha, 0, 1), dur = Math.max(0.05, (ms || 200) / 1000);
        const left = D.fl.a * Math.pow(1 - D.fl.t / D.fl.dur, 2);
        if (D.fl.a > 0 && left > a) return;
        D.fl.a = a; D.fl.t = 0; D.fl.dur = dur;
        D.flash.style.background = color || '#fff'; D.flash.style.display = 'block'; D.flash.style.opacity = String(a);
    }
    function vignette(alpha) {
        if (!D.root || !take('vig', 4, 2)) return;
        D.vg.a = clamp(alpha, 0, 1); D.vg.t = 0; D.vg.dur = 0.35;
        D.vig.style.display = 'block'; D.vig.style.opacity = String(D.vg.a);
    }
    function shake(amount, ms) {
        // @ts-ignore — Game объявляет js/Game.js
        const g = typeof Game !== 'undefined' ? Game : null;
        if (g && typeof g.addShake === 'function') g.addShake(amount, ms);
    }

    function setQuality(level) {
        const name = level === 'low' || level === 'medium' || level === 'high' ? level
            : (typeof Quality !== 'undefined' && Quality.name) || 'high';
        S.q = name;
        S.qk = name === 'low' ? 0.45 : name === 'medium' ? 0.75 : 1;
        S.mob = typeof IS_MOBILE !== 'undefined' && IS_MOBILE ? (typeof FX_MOBILE_SCALE !== 'undefined' ? FX_MOBILE_SCALE : 0.55) : 1;
        S.pk = S.qk * S.mob;
        S.decalMax = name === 'low' ? 12 : S.mob < 1 ? 20 : name === 'medium' ? 28 : 40;
        if (S.ok) { buildWeather(); buildAura(); }
    }

    // ============================================================================================================
    //  НОВЫЕ СПОСОБНОСТИ: огонь, волна, метеоры, ядерный взрыв
    // ============================================================================================================
    const TAU = Math.PI * 2;
    // Частицы менеджера с запоминанием handle для clear() (долгоживущие эффекты).
    function PK(layers, pos) {
        const hs = P(layers, pos);
        for (const h of hs) { S.keep.add(h); if (S.keep.size > 80) S.keep.delete(S.keep.values().next().value); }
        return hs;
    }
    // Удерживаемый спрайт-свечение: не уходит в общий пул, пока не отпущен.
    function takeHeld(color, add) {
        for (const g of S.glows) {
            if (!g.on && !g.held) {
                g.on = true; g.held = true; g.manual = true; g.born = S.t;
                g.m.material = matFor(T.flare, color, add !== false, 0); g.m.isVisible = false; g.m.visibility = 0;
                return g;
            }
        }
        return null;
    }
    function freeHeld(g) { if (!g) return; g.held = false; g.manual = false; off(g); }
    function putGlow(g, x, y, z, size, vis) {
        if (!g) return;
        g.m.position.copyFromFloats(x, y, z); g.m.scaling.copyFromFloats(size, size, 1);
        g.m.isVisible = vis > 0.01; g.m.visibility = clamp(vis, 0, 1);
    }

    // --- горящая зона -----------------------------------------------------------------------------------------
    function fire(x, y, z, radius, seconds) {
        if (!S.ok) return;
        const r = clamp(radius || 100, 40, 600), sec = clamp(seconds || 4, 1, 10);
        let zn = null;
        for (const q of S.zones) if (q.on && Math.hypot(q.x - x, q.z - z) < Math.max(q.r, r) * 0.5 && Math.abs(q.y - y) < r + 60) { zn = q; break; }
        if (zn && zn.dur - zn.t > sec * 0.5) return;   // уже горит — системы не плодим
        if (!zn) {
            let old = null;
            for (const q of S.zones) { if (!q.on) { zn = q; break; } if (!old || q.born < old.born) old = q; }
            zn = zn || old;
        }
        if (!zn) return;
        for (const h of zn.hs) h.dispose();
        const low = S.q === 'low', bz = busy(), ra = clamp(12 + r / 10, 14, 60);
        zn.hs = P([
            { texture: T.puff, blend: 'add', rate: ra, duration: sec, capacity: Math.ceil(ra * 1.4), life: [0.6, 1.1], size: [r * 0.16, r * 0.3], sizeGradient: [[0, 0.7], [0.4, 1], [1, 0.1]],
                box: [[-r * 0.65, 0, -r * 0.65], [r * 0.65, r * 0.08, r * 0.65]], direction: [[-0.2, 0.7, -0.2], [0.2, 1.1, 0.2]], speed: [r * 0.5, r],
                gravity: [0, r * 0.6, 0], color: '#ff9a30', color2: '#ff4a10', colorGradient: [[0, '#fff0a0', 0], [0.12, '#ffb040', 0.85], [0.55, '#ff5a14', 0.55], [1, '#2a0800', 0]] },
            !low && !bz && { texture: T.fire, sheet: { width: 128, height: 128, start: 0, end: 15, speed: 1, loop: false }, blend: 'standard', rate: 3 + r / 60, duration: sec, capacity: 12,
                life: [0.9, 1.2], size: [r * 0.5, r * 0.8], box: [[-r * 0.5, 0, -r * 0.5], [r * 0.5, r * 0.05, r * 0.5]], direction: [[-0.1, 0.5, -0.1], [0.1, 1, 0.1]], speed: [r * 0.2, r * 0.5], alpha: 0.55, color: '#ffffff' },
            !bz && { texture: T.smoke, blend: 'standard', delay: 0.2, rate: 5 + r / 50, duration: sec, capacity: 40, life: low ? [0.8, 1] : [1.6, 2.6], size: [r * 0.3, r * 0.55],
                sizeGradient: [[0, 0.5], [1, 1.7]], box: [[-r * 0.5, 0, -r * 0.5], [r * 0.5, r * 0.05, r * 0.5]], direction: [[-0.15, 0.8, -0.15], [0.15, 1, 0.15]], speed: [r * 0.6, r * 1.2],
                color: '#2a2826', color2: '#55514c', alpha: 0.7, colorGradient: [[0, '#000000', 0], [0.2, '#34302d', 0.6], [1, '#55514c', 0]] },
            !low && !bz && { texture: T.spark, blend: 'add', rate: 4 + r / 30, duration: sec, capacity: 30, life: [0.8, 1.6], size: [3 * clamp(r / 100, 1, 3), 6 * clamp(r / 100, 1, 3)], box: [[-r * 0.6, 0, -r * 0.6], [r * 0.6, 4, r * 0.6]],
                direction: [[-0.4, 0.8, -0.4], [0.4, 1.4, 0.4]], speed: [r * 0.6, r * 1.4], color: '#ffd060', color2: '#ff6a10' },
        ], { x, y, z });
        zn.on = true; zn.born = S.t; zn.t = 0; zn.dur = sec; zn.x = x; zn.y = y; zn.z = z; zn.r = r;
        zn.m.material = matFor(T.flare, 0xff7a1a, true, -2);
        zn.m.position.copyFromFloats(x, y + 2, z); zn.m.scaling.copyFromFloats(r * 2.6, 1, r * 2.6); zn.m.visibility = 0; zn.m.isVisible = true;
    }
    function updZones(dt) {
        for (const q of S.zones) {
            if (!q.on) continue;
            q.t += dt;
            if (q.t >= q.dur) { off(q); q.hs = []; continue; }
            const fade = Math.min(1, q.t / 0.3, (q.dur - q.t) / 1);
            q.m.visibility = (0.4 + 0.12 * Math.sin(S.t * 17 + q.x) + 0.08 * Math.sin(S.t * 41 + q.z)) * fade;
        }
    }

    // --- «Огненная волна» ---------------------------------------------------------------------------------------
    function nova(x, y, z, radius, seconds) {
        if (!S.ok) return;
        const R = clamp(radius || 1000, 300, 4000), sec = clamp(seconds || 0.8, 0.3, 3), gy = Math.max(y, gY()), t0 = S.t;
        ring({ x, y: gy + 2, z, r0: R * 0.04, r1: R, dur: sec, color: 0xffb860, a: 0.95, add: true, pw: 1, fade: 1.4 });
        ring({ x, y: gy + 3, z, r0: R * 0.03, r1: R * 0.93, dur: sec, color: 0xffffff, a: 0.7, add: true, pw: 1, fade: 1.2 });
        ring({ x, y: gy + 1, z, r0: R * 0.03, r1: R * 0.8, dur: sec * 1.3, delay: 0.05, color: 0xff6a1a, a: 0.5, add: true, pw: 1.3, fade: 1 });
        const sz = clamp(R * 0.05, 30, 170);
        const hs = PK([
            { texture: T.puff, blend: 'add', rate: 300, duration: sec, capacity: Math.ceil(300 * 0.8 * 1.3), life: [0.5, 0.8], size: [sz * 0.8, sz * 1.4], sizeGradient: [[0, 0.7], [0.4, 1], [1, 0.1]],
                direction: [[-0.3, 0.7, -0.3], [0.3, 1.2, 0.3]], speed: [sz * 2.5, sz * 5], gravity: [0, sz * 3, 0], color: '#ffb040', color2: '#ff5a14',
                colorGradient: [[0, '#fff0b0', 0], [0.12, '#ffb040', 0.9], [0.55, '#ff5a14', 0.55], [1, '#2a0800', 0]] },
            S.q !== 'low' && { texture: T.spark, blend: 'add', rate: 120, duration: sec, capacity: 130, life: [0.7, 1.3], size: [6, 12], direction: [[-0.5, 0.6, -0.5], [0.5, 1.4, 0.5]], speed: [sz * 2, sz * 6],
                gravity: [0, -300, 0], color: '#ffd060', color2: '#ff6a10' },
        ], { x, y: gy, z });
        const fn = (wm, pos) => {
            const k = clamp((S.t - t0) / sec, 0, 1), rf = R * Math.max(0.03, k) * rnd(0.94, 1.04), a = Math.random() * TAU;
            pos.copyFromFloats(x + Math.cos(a) * rf, gy + 4, z + Math.sin(a) * rf);
        };
        for (const h of hs) h.system.startPositionFunction = fn;
        glow({ x, y: gy + 60, z, s0: Math.min(R * 0.25, 600), s1: Math.min(R * 0.5, 1200), dur: 0.35, color: 0xfff0c0, a: 0.9, add: true });
        decal({ x, z, size: Math.min(R * 0.6, 1200), tex: T.scorch, color: 0x000000, a: 0.5, life: 8 });
        flash('#ff9a30', 0.4, 350);
    }

    // --- метеоры ------------------------------------------------------------------------------------------------
    /** @type {any[]} */ const MT = [];
    function stopMeteor(m, dispose) {
        if (m.stopped) return;
        m.stopped = true;
        for (const h of m.hs) { if (dispose) h.dispose(); else h.stop(); }
        freeHeld(m.halo); freeHeld(m.core);
        const i = MT.indexOf(m); if (i >= 0) MT.splice(i, 1);
    }
    function meteor(obj, size) {
        const noop = { stop() { /* нет эффекта */ } };
        if (!S.ok || !obj) return noop;
        const s = clamp(size || 80, 30, 300), maxFull = S.mob < 1 ? 10 : 20;
        let nFull = 0; for (const q of MT) if (q.core) nFull++;
        const halo = takeHeld(0xff7a1a, true);
        if (!halo) return noop;
        const core = nFull < maxFull ? takeHeld(0xfff4d0, true) : null;
        let hs = [];
        if (core && !busy()) {
            const follow = () => obj;
            hs = PK([
                { texture: T.puff, blend: 'add', rate: 80, capacity: 140, life: [0.5, 0.9], size: [s * 0.8, s * 1.4], sizeGradient: [[0, 0.8], [1, 0.1]], speed: [0, s * 0.2], color: '#ffb040', color2: '#ff5a14',
                    colorGradient: [[0, '#fff4c0', 0.9], [0.4, '#ff8a20', 0.6], [1, '#401000', 0]], follow },
                S.q !== 'low' && { texture: T.smoke, blend: 'standard', rate: 45, capacity: 140, life: [1.4, 2.2], size: [s * 0.7, s * 1.3], sizeGradient: [[0, 0.5], [1, 1.8]], speed: [0, s * 0.15],
                    color: '#2a2826', alpha: 0.6, colorGradient: [[0, '#ff9040', 0], [0.15, '#3a3430', 0.6], [1, '#55514c', 0]], follow },
            ], obj);
        }
        const m = { obj, s, halo, core, hs, stopped: false, ph: Math.random() * 6 };
        MT.push(m);
        return { stop() { stopMeteor(m, false); } };
    }
    function updMeteors() {
        for (const m of MT) {
            const p = m.obj; if (!p) continue;
            const f = 1 + 0.12 * Math.sin(S.t * 30 + m.ph);
            putGlow(m.halo, p.x, p.y, p.z, m.s * (m.core ? 5.2 : 4) * f, 0.8);
            putGlow(m.core, p.x, p.y, p.z, m.s * 2.4 * f, 1);
        }
    }
    function meteorImpact(x, y, z, radius) {
        if (!S.ok) return;
        const r = clamp(radius || 100, 30, 400), gy = gY(), sc = clamp(r / 100, 0.6, 4);
        explosion(x, y, z, clamp(r / 70, 0.8, 5.5));
        ring({ x, y: gy + 2, z, r0: r * 0.2, r1: r * 2.5, dur: 0.5, color: 0xffa040, a: 0.8, add: true });
        PK([
            { texture: T.puff, blend: 'add', rate: 120, duration: 0.8, capacity: 110, life: [0.7, 1.1], size: [r * 0.3, r * 0.5], sizeGradient: [[0, 0.7], [0.5, 1], [1, 0.3]],
                box: [[-r * 0.2, 0, -r * 0.2], [r * 0.2, r * 0.1, r * 0.2]], direction: [[-0.12, 1, -0.12], [0.12, 1, 0.12]], speed: [r * 2.2, r * 3.6], color: '#ffb040', color2: '#ff5a14',
                colorGradient: [[0, '#fff0b0', 0.9], [0.4, '#ff8a20', 0.7], [1, '#401000', 0]] },
            { texture: T.spark, blend: 'add', burst: 40, capacity: 50, life: [0.8, 1.6], size: [3 * sc, 8 * sc], speed: [r * 2, r * 5], gravity: [0, -500, 0], direction: [[-1, 0.3, -1], [1, 1.5, 1]],
                color: '#ffd060', color2: '#ff5a10' },
        ], { x, y: gy, z });
        decal({ x, z, size: r * 2.6, tex: T.scorch, color: 0x000000, a: 0.8, life: 16 });
        fire(x, y, z, r * 0.9, 4 + r / 60);
        const k = KJ();
        if (k && Math.hypot(x - k.x, z - k.z) < kH() * 3) flash('#ff9a30', 0.2, 150);
    }

    // --- ядерный заряд кайдзю ---------------------------------------------------------------------------------
    const NC = { on: false, t: 0, dur: 1.2, x: 0, y: 0, z: 0, H: 300, core: /** @type {any} */ (null), /** @type {any[]} */ beads: [] };
    function endCharge() { NC.on = false; freeHeld(NC.core); NC.core = null; for (const b of NC.beads) freeHeld(b.g); NC.beads = []; }
    function nukeCharge(x, y, z, height, seconds) {
        if (!S.ok) return;
        endCharge();
        const H = clamp(height || kH(), 150, 2500), dur = clamp(seconds || 1.2, 0.4, 4);
        NC.on = true; NC.t = 0; NC.dur = dur; NC.x = x; NC.y = y; NC.z = z; NC.H = H;
        NC.core = takeHeld(0xbffff4, true);
        const n = clamp(Math.round(18 * Math.max(0.6, S.pk)), 8, 20);
        for (let i = 0; i < n; i++) {
            const g = takeHeld(i % 3 ? 0x7ffff0 : 0xffffff, true);
            if (g) NC.beads.push({ g, az: Math.random() * TAU, el: rnd(-0.6, 1.0), ph: Math.random() });
        }
        const gy = Math.max(y, gY()) + 2;
        for (let i = 0; i < 3; i++) ring({ x, y: gy, z, r0: H * 1.0, r1: H * 0.2, dur: 0.5, delay: i * dur * 0.3, color: 0x7ffff0, a: 0.8, add: true, pw: 1, fade: 1 });
        flash('#02121a', 0.28, dur * 900);
    }
    function updCharge(dt) {
        if (!NC.on) return;
        NC.t += dt;
        const k = NC.t / NC.dur;
        if (k >= 1) { endCharge(); return; }
        const H = NC.H, cy = NC.y + H * 0.6;
        putGlow(NC.core, NC.x, cy, NC.z, H * (0.15 + 0.7 * k * k) * (1 + 0.08 * Math.sin(S.t * 40)), 0.6 + 0.4 * k);
        for (const b of NC.beads) {
            const f = (k * 2.2 + b.ph) % 1, d = H * 1.1 * (1 - f), ce = Math.cos(b.el);
            putGlow(b.g, NC.x + Math.cos(b.az) * ce * d, cy + Math.sin(b.el) * d, NC.z + Math.sin(b.az) * ce * d, H * 0.05 * (0.5 + f), f < 0.15 ? f / 0.15 : 1);
        }
    }

    // --- ядерный взрыв ----------------------------------------------------------------------------------------
    const NK = { on: false, t0: 0, x: 0, y: 0, z: 0, R: 1000, /** @type {any[]} */ g: [] };
    function endNuke() { NK.on = false; for (const g of NK.g) freeHeld(g); NK.g = []; }
    const capH = (R, t) => R * 0.9 * (1 - Math.pow(1 - clamp(t / 5, 0, 1), 2));
    const capR = (R, t) => R * 0.28 * clamp(0.25 + t / 3, 0, 1);
    function nuke(x, y, z, radius) {
        if (!S.ok) return;
        if (NK.on && S.t - NK.t0 < 1) return;
        endNuke();
        const R = clamp(radius || 3000, 1000, 8000), gy = Math.max(y, gY()), t0 = S.t, tn = () => S.t - t0;
        NK.on = true; NK.t0 = t0; NK.x = x; NK.y = gy; NK.z = z; NK.R = R;
        NK.g = [takeHeld(0xfff2c8, true), takeHeld(0xff8a30, true), takeHeld(0xff6a1a, true)];
        flash('#ffffff', 1, 600);
        later(0.6, () => flash('#ff9a30', 0.25, 500));
        shake(1, 1400);
        // кольца: две приземные ударные волны, воздушное кольцо и пыльный фронт
        ring({ x, y: gy + 2, z, r0: R * 0.03, r1: R, dur: 2.4, color: 0xfff0d0, a: 1, add: true, pw: 1.6, fade: 0.9 });
        ring({ x, y: gy + 1, z, r0: R * 0.03, r1: R * 0.8, dur: 3.2, delay: 0.15, color: 0xff9a30, a: 0.8, add: true, pw: 1.6, fade: 0.9 });
        ring({ x, y: gy + R * 0.12, z, r0: R * 0.03, r1: R * 1.1, dur: 2.8, color: 0xffffff, a: 0.5, add: true, pw: 1.8, fade: 1.1 });
        ring({ x, y: gy + 3, z, r0: R * 0.05, r1: R * 1.15, dur: 4, delay: 0.3, color: 0xb0a08a, a: 0.35, add: false, pw: 1.6, fade: 1 });
        // световые столбы — читаются издалека
        strip({ ax: x, ay: gy, az: z, bx: x, by: gy + R * 0.9, bz: z, w0: R * 0.25, w1: R * 0.08, dur: 1.6, color: 0xffffff, a: 0.85, add: true });
        strip({ ax: x, ay: gy, az: z, bx: x, by: gy + R * 0.9, bz: z, w0: R * 0.5, w1: R * 0.2, dur: 2.2, color: 0xff8a30, a: 0.6, add: true });
        // грибовидное облако: позиции частиц задаются временем (ножка, шапка, подсветка), без тысяч частиц
        const low = S.q === 'low', bz = busy();
        const capPos = (wm, pos) => { const t = tn(), rc = capR(R, t), a = Math.random() * TAU, rr = rc * Math.sqrt(Math.random()); pos.copyFromFloats(x + Math.cos(a) * rr, gy + capH(R, t) + rnd(-0.35, 0.35) * rc, z + Math.sin(a) * rr); };
        const stemPos = (wm, pos) => { const t = tn(), h = Math.random() * capH(R, t), a = Math.random() * TAU, rr = R * 0.045 * rnd(0.5, 1.2); pos.copyFromFloats(x + Math.cos(a) * rr, gy + h, z + Math.sin(a) * rr); };
        const lightPos = (wm, pos) => { const t = tn(), rc = capR(R, t), a = Math.random() * TAU, rr = rc * 0.8 * Math.sqrt(Math.random()); pos.copyFromFloats(x + Math.cos(a) * rr, gy + capH(R, t) - rc * 0.45, z + Math.sin(a) * rr); };
        const rainPos = (wm, pos) => { const a = Math.random() * TAU, rr = R * 0.8 * Math.sqrt(Math.random()); pos.copyFromFloats(x + Math.cos(a) * rr, gy + R * rnd(0.45, 0.9), z + Math.sin(a) * rr); };
        const mk = (l, fn) => { const hs = PK([l], { x, y: gy, z }); if (fn) for (const h of hs) h.system.startPositionFunction = fn; };
        mk({ texture: T.smoke, blend: 'standard', rate: 70, duration: 4.5, capacity: 330, life: [2.8, 3.8], size: [R * 0.12, R * 0.2], sizeGradient: [[0, 0.5], [1, 1.4]], direction: [[-1, -0.1, -1], [1, 0.3, 1]],
            speed: [R * 0.02, R * 0.07], color: '#2a2624', color2: '#4a4440', alpha: 0.85, colorGradient: [[0, '#ffb060', 0], [0.1, '#6a4a3a', 0.8], [0.5, '#3a3532', 0.8], [1, '#4a4642', 0]] }, capPos);
        mk({ texture: T.smoke, blend: 'standard', rate: 50, duration: 4.5, capacity: 240, life: [2.8, 3.8], size: [R * 0.07, R * 0.12], sizeGradient: [[0, 0.6], [1, 1.3]], direction: [[-0.1, 0.6, -0.1], [0.1, 1, 0.1]],
            speed: [R * 0.02, R * 0.05], color: '#3a3532', color2: '#5a5550', alpha: 0.8, colorGradient: [[0, '#ff9a50', 0], [0.12, '#6a4a3a', 0.75], [0.6, '#3a3532', 0.7], [1, '#4a4642', 0]] }, stemPos);
        if (!low && !bz) mk({ texture: T.puff, blend: 'add', rate: 40, duration: 4, capacity: 130, life: [0.8, 1.4], size: [R * 0.1, R * 0.18], sizeGradient: [[0, 0.7], [1, 0.3]], direction: [[-1, -0.2, -1], [1, 0.2, 1]],
            speed: [R * 0.02, R * 0.06], color: '#ff9a30', color2: '#ff4a10', alpha: 0.5, colorGradient: [[0, '#ffd080', 0.6], [0.5, '#ff6a1a', 0.45], [1, '#3a0a00', 0]] }, lightPos);
        mk({ texture: T.fire, sheet: { width: 128, height: 128, start: 0, end: 15, speed: 1, loop: false }, blend: 'standard', burst: 5, capacity: 8, life: [1.6, 2.2], size: [R * 0.35, R * 0.6],
            box: [[-R * 0.1, 0, -R * 0.1], [R * 0.1, R * 0.1, R * 0.1]], direction: [[-1, 0.2, -1], [1, 0.8, 1]], speed: [R * 0.05, R * 0.18], sizeGradient: [[0, 0.6], [0.4, 1], [1, 1.2]], color: '#ffffff' }, null);
        mk({ texture: T.puff, blend: 'standard', burst: 24, capacity: 30, life: [2, 3], size: [R * 0.12, R * 0.2], speed: [R * 0.35, R * 0.7], direction: [[-1, 0.02, -1], [1, 0.2, 1]], color: '#8a7a68', alpha: 0.5,
            sizeGradient: [[0, 0.5], [1, 1.5]] }, null);
        if (!low && !bz) mk({ texture: T.spark, blend: 'add', delay: 1.5, rate: 80, duration: 4, capacity: 320, life: [2.5, 3.5], size: [Math.max(6, R * 0.008), Math.max(10, R * 0.015)], direction: [[-0.05, -1, -0.05], [0.05, -1, 0.05]],
            speed: [R * 0.2, R * 0.3], color: '#ffd060', color2: '#ff5a10' }, rainPos);
        decal({ x, z, size: R * 0.85, tex: T.scorch, color: 0x000000, a: 0.75, life: 22 });
        decal({ x, z, size: R * 0.5, tex: T.scorch, color: 0xff7a1a, a: 0.8, life: 3, add: true, y: gy + 1 });
    }
    function updNuke() {
        if (!NK.on) return;
        const t = S.t - NK.t0, R = NK.R, x = NK.x, y = NK.y, z = NK.z;
        if (t > 8) { endNuke(); return; }
        const core = NK.g[0], outer = NK.g[1], cap = NK.g[2];
        const k1 = t / 1.4, s1 = R * 0.45 * (0.15 + 0.85 * easeOut(Math.min(1, k1)));
        putGlow(core, x, y + s1 * 0.2, z, s1, k1 < 1 ? Math.pow(1 - k1, 1.1) : 0);
        const k2 = t / 2.4, s2 = R * 0.7 * (0.2 + 0.8 * easeOut(Math.min(1, t / 1.6)));
        putGlow(outer, x, y + s2 * 0.15, z, s2, k2 < 1 ? 0.85 * Math.pow(1 - k2, 1.5) : 0);
        const rc = capR(R, t);
        putGlow(cap, x, y + capH(R, t) - rc * 0.5, z, rc * 3.2, t > 0.6 ? 0.5 * Math.min(1, (t - 0.6) / 0.6) * (1 - clamp((t - 4) / 3, 0, 1)) : 0);
    }

    // --- короткий праздничный всплеск при открытии умения ------------------------------------------------------
    function skillUnlock(x, y, z, height) {
        if (!S.ok) return;
        const H = clamp(height || kH(), 150, 2500), gy = y + 2;
        ring({ x, y: gy, z, r0: H * 0.3, r1: H * 0.9, dur: 0.5, color: 0xffd24a, a: 0.8, add: true });
        ring({ x, y: gy, z, r0: H * 0.25, r1: H * 1.2, dur: 0.6, delay: 0.1, color: 0x29e0c8, a: 0.7, add: true });
        for (let i = 0; i < 2; i++) ring({ x, y: gy + H * 0.05, z, r0: H * 0.3, r1: H * 0.36, dur: 0.6, delay: i * 0.12, vy: H * 1.2, color: 0xffe066, a: 0.7, add: true, pw: 1, fade: 1 });
        glow({ x, y: y + H * 0.55, z, s0: H * 0.5, s1: H * 1.1, dur: 0.35, color: 0xffd24a, a: 0.8, add: true });
        P([
            { texture: T.star, blend: 'add', burst: 12, capacity: 14, life: [0.7, 1.2], size: [H * 0.04, H * 0.07], speed: [H * 0.5, H * 1.1], direction: [[-1, 0.4, -1], [1, 1.2, 1]], spin: [-3, 3], color: '#ffe066', color2: '#ffffff', sizeGradient: [[0, 0.3], [0.3, 1], [1, 0]] },
            { texture: T.spark, blend: 'add', burst: 20, capacity: 24, life: [0.6, 1.1], size: [H * 0.012, H * 0.026], speed: [H * 0.6, H * 1.3], direction: [[-0.6, 0.6, -0.6], [0.6, 1.4, 0.6]], color: '#29E0C8', color2: '#d6fff8', sizeGradient: [[0, 1], [1, 0]] },
        ], { x, y, z });
        flash('#29E0C8', 0.15, 200);
    }

    function updAbilities(dt) { updZones(dt); updMeteors(); updCharge(dt); updNuke(); }
    // Сброс состояния способностей. dispose=false — частицы уже снесены движком (смена карты).
    function resetAbilities(dispose) {
        for (const q of [...MT]) stopMeteor(q, dispose);
        MT.length = 0;
        for (const q of S.zones) { if (dispose) for (const h of q.hs) h.dispose(); q.hs = []; if (q.on) off(q); }
        if (dispose) for (const h of S.keep) h.dispose();
        S.keep.clear();
        endCharge(); endNuke();
    }

    // ============================================================================================================
    //  2.0: эффекты разрушения и жизни города. Зовутся очень часто (удары обломков, стёкла, искры): только пулы,
    //  вёдра токенов и отсечение по дальности — ни одной новой системы частиц на вызов.
    // ============================================================================================================

    /** Клуб пыли: size — поперечник px, color — цвет материала (0xRRGGBB). */
    function dustCloud(x, y, z, size, color) {
        if (!S.ok || !near(x, z, 6500) || !take('cloud', 9 * S.pk, 5)) return;
        const sz = clamp(size || 80, 20, 900), col = color != null ? color : 0xcfc6b4;
        const p = q(lighten(col, 0.3), lighten(col, 0.52), 0.72, clamp(sz / 70, 0.4, 9), null, null);
        p.bx = sz * 0.3; p.by = sz * 0.2;
        pf('cloud', x, y + sz * 0.08, z, 5 + Math.min(5, sz / 60), p);
        if (sz >= 60) pf('ipuff', x, y + 2, z, 4, q(lighten(col, 0.4), lighten(col, 0.6), 0.5, clamp(sz / 50, 0.6, 7), RING, null));
    }

    /** Столб дыма над руинами: seconds — сколько дымит, size — поперечник основания px. Слотов мало: лишние вызовы продлевают соседний. */
    function smokeColumn(x, y, z, seconds, size) {
        const P = S.pools.column;
        if (!S.ok || !P) return;
        const sz = clamp(size || 60, 20, 520), sec = clamp(seconds || 6, 1, 40), s = P.take(x, z, sz * 0.7);
        if (!s) return;
        if (s.on) {
            if (Math.abs(s.x - x) < sz * 0.7 && Math.abs(s.z - z) < sz * 0.7) { s.until = Math.max(s.until, S.t + sec); return; }
            if (s.until - S.t > 3 && sz <= s.size) return;      // все заняты и дымят долго — мелкий новый не нужен
        }
        const k = sz / 60, sk = Math.sqrt(k), ps = s.ps;
        s.on = true; s.x = x; s.y = y; s.z = z; s.size = sz; s.born = S.t; s.until = S.t + sec; s.tick = 0.3;
        s.em.copyFromFloats(x, y + sz * 0.1, z);
        ps.minScaleX = ps.maxScaleX = ps.minScaleY = ps.maxScaleY = k;
        ps.minEmitPower = 34 * sk; ps.maxEmitPower = 78 * sk;
        ps.minEmitBox.copyFromFloats(-sz * 0.3, 0, -sz * 0.3); ps.maxEmitBox.copyFromFloats(sz * 0.3, sz * 0.1, sz * 0.3);
        s.rate = (7 + Math.min(7, sz / 40)) * Math.max(0.5, S.qk);
        ps.emitRate = s.rate;
    }

    /** Стекло из окна: (dx, dz) — куда летит, count — осколков. */
    function glassBurst(x, y, z, dx, dz, count) {
        if (!S.ok || !near(x, z, 3600) || !take('glassB', 22 * S.pk, 8)) return;
        const l = Math.hypot(dx || 0, dz || 0) || 1, ux = (dx || 0) / l, uz = (dz || 0) / l, n = clamp(count || 8, 2, 26);
        QD[0][0] = ux - 0.6; QD[0][1] = 0.05; QD[0][2] = uz - 0.6; QD[1][0] = ux + 0.6; QD[1][1] = 1; QD[1][2] = uz + 0.6;
        pf('glass', x, y, z, n, q(0xcfeeff, 0xffffff, 0.95, 1, QD, null));
        if (take('glassGlint', 10 * S.pk, 4)) pf('spark', x, y, z, 3 + n * 0.2, q(0xffffff, 0xbfe8ff, 1, 0.8, QD, null));
    }

    /** Искры: count — сколько, color — цвет (по умолчанию жёлтые). */
    function sparks(x, y, z, count, color) {
        if (!S.ok || !near(x, z, 4200) || !take('sparks', 26 * S.pk, 8)) return;
        const col = color != null ? color : 0xffd27a;
        pf('spark', x, y, z, clamp(count || 8, 2, 40), q(lighten(col, 0.45), col, 1, 1, null, null));
    }

    /** Струя воды (гидрант, фонтан): seconds — сколько бьёт, height — высота px. */
    function waterJet(x, y, z, seconds, height) {
        const P = S.pools.jet;
        if (!S.ok || !P) return;
        const h = clamp(height || 120, 30, 900), sec = clamp(seconds || 5, 0.5, 30), s = P.take(x, z, 24);
        if (!s) return;
        const same = s.on && Math.abs(s.x - x) < 24 && Math.abs(s.z - z) < 24;
        if (s.on && !same && s.until - S.t > 2) return;
        const g = 480, v = Math.sqrt(2 * g * h), life = 2 * v / g, ps = s.ps, sc = Math.sqrt(clamp(h / 120, 0.6, 5));
        s.until = Math.max(same ? s.until : 0, S.t + sec);
        s.on = true; s.x = x; s.y = y; s.z = z; s.size = h; s.born = S.t; s.tick = 0; s.tick2 = 0;
        s.em.copyFromFloats(x, y + 2, z);
        ps.minEmitPower = v * 0.86; ps.maxEmitPower = v * 1.04; ps.minLifeTime = life * 0.8; ps.maxLifeTime = life * 1.02;
        ps.minScaleX = ps.maxScaleX = ps.minScaleY = ps.maxScaleY = sc;
        s.rate = 70 * Math.max(0.5, S.qk);
        ps.emitRate = s.rate;
    }

    /** Удар обломка о землю или стену: маленький пыльный хлопок. Самый частый вызов. */
    function impactPuff(x, y, z, size, color) {
        if (!S.ok || !near(x, z, 3200) || !take('impact', 40 * S.pk, 12)) return;
        const sz = clamp(size || 20, 6, 400), col = color != null ? color : 0xc9bda6, sc = clamp(sz / 34, 0.35, 6);
        pf('ipuff', x, y + 1, z, sz > 30 ? 4 : 2, q(lighten(col, 0.35), lighten(col, 0.6), 0.55, sc, RING, null));
        if (sz >= 24 && take('impactChip', 14 * S.pk, 5)) pf('chips', x, y + 2, z, 3, q(col, mixc(col, 0x000000, 0.3), 1, clamp(sc * 0.7, 0.5, 3), null, null));
    }

    /** Взрыв машины: size 1 — легковая, 2 — автобус или бензовоз. */
    function carExplode(x, y, z, size) {
        if (!S.ok || !take('car', 7 * Math.max(0.5, S.qk), 4)) return;
        const s = clamp(size || 1, 0.4, 4), R = 62 * s;
        pf('boom', x, y + R * 0.35, z, 2, q(0xffffff, 0xffffff, 1, s * 1.1, null, null));
        pf('spark', x, y + R * 0.3, z, 14, q(0xffe08a, 0xff7a1a, 1, s * 1.3, null, null));
        pf('chips', x, y + R * 0.2, z, 6, q(0x3a3a3e, 0x1c1c20, 1, s, null, null));
        QP[0] = R * 0.3; QP[1] = R * 0.9;
        pf('smoke', x, y + R * 0.5, z, 5, q(0x2a2826, 0x55514c, 0.85, s * 2.4, null, QP));
        glow({ x, y: y + R * 0.4, z, s0: R * 1.6, s1: R * 3, dur: 0.2, color: 0xffc060, a: 0.9, add: true });
        ring({ x, y: gY() + 1, z, r0: R * 0.3, r1: R * 2.2, dur: 0.4, color: 0xffd9a0, a: 0.6, add: true });
        decal({ x, z, size: R * 1.7, tex: T.scorch, color: 0x000000, a: 0.7, life: 12 });
        if (S.q !== 'low') smokeColumn(x, y, z, 4 + s * 2, R * 0.55);
    }

    /** Житель «лопнул»: белый пуф и конфетти цвета одежды. Без крови. */
    function crowdPuff(x, y, z, color) {
        if (!S.ok || !near(x, z, 2600) || !take('crowd', 30 * S.pk, 10)) return;
        const col = color != null ? color : 0xffffff;
        pf('ipuff', x, y + 8, z, 3, q(0xffffff, lighten(col, 0.6), 0.75, 0.55, UP, null));
        pf('confetti', x, y + 10, z, 4, q(col, lighten(col, 0.4), 1, 0.6, null, null));
    }

    function updSlots(dt) {
        const C = S.pools.column, J = S.pools.jet;
        if (C) for (const s of C.slots) {
            if (!s.on) continue;
            const left = s.until - S.t;
            if (left <= 0) { s.on = false; s.ps.emitRate = 0; continue; }
            s.ps.emitRate = s.rate * Math.min(1, left / 1.5);
            s.tick -= dt;
            if (s.tick <= 0) {     // пока руины свежие — искры и отсветы у основания
                s.tick = 0.5 + Math.random() * 0.6;
                if (S.t - s.born < 7 && S.q !== 'low') pf('spark', s.x + rnd(-0.3, 0.3) * s.size, s.y + 6, s.z + rnd(-0.3, 0.3) * s.size, 3, q(0xffc060, 0xff6a1a, 1, clamp(s.size / 70, 0.6, 3), UP, null));
            }
        }
        if (J) for (const s of J.slots) {
            if (!s.on) continue;
            const left = s.until - S.t;
            if (left <= 0) { s.on = false; s.ps.emitRate = 0; continue; }
            s.ps.emitRate = s.rate * Math.min(1, left / 0.6);
            s.tick -= dt; s.tick2 -= dt;
            if (s.tick <= 0) { s.tick = 0.3; pf('ipuff', s.x, s.y + 4, s.z, 2, q(0xffffff, 0xdff2ff, 0.4, clamp(s.size / 90, 0.6, 3), RING, null)); }
            if (s.tick2 <= 0) { s.tick2 = 0.9; ring({ x: s.x, y: gY(), z: s.z, r0: s.size * 0.08, r1: s.size * 0.5, dur: 0.7, color: 0xdff6ff, a: 0.45, add: true }); }
        }
    }

    // ---- жизненный цикл --------------------------------------------------------------------------------------------
    function disposeOwn() {
        for (const k of Object.keys(S.pools)) for (const ps of S.pools[k].list) { try { ps.dispose(); } catch (e) { /* сцена уже снесена */ } }
        S.pools = {};
        for (const arr of [S.rings, S.decals, S.strips, S.glows, S.slashes, S.zones]) for (const it of arr) { try { it.m.dispose(); } catch (e) { /* */ } }
        S.rings = []; S.decals = []; S.strips = []; S.glows = []; S.slashes = []; S.zones = [];
        S.mats.clear(); S.texs.clear();
        B.meshes = null; B.mats = null; B.tex = []; B.beads = []; B.gM = B.gE = null; B.hs = []; B.on = false; B.k = 0;
    }
    function bind(app) {
        S.app = app;
        const view = app.location && app.location.view;
        if (!view || !view.scene || !app.fx) { S.ok = false; return false; }
        const changed = S.scene !== view.scene || S.fx !== app.fx || !S.rings.length || S.rings[0].m.isDisposed();
        S.view = view; S.scene = view.scene; S.cam = view.camera;
        if (changed) { disposeOwn(); S.fx = app.fx; S.ok = true; S.stripVD = null; buildPools(); buildMeshes(); }
        S.fx = app.fx; S.ok = true;
        return true;
    }
    function init(app) {
        setQuality(typeof Quality !== 'undefined' ? Quality.name : 'high');
        bind(app);
        buildDom();
        S.inited = true;
        if (!S.unsubPause && typeof Pause !== 'undefined') S.unsubPause = Pause.onChange(() => { for (const k of Object.keys(S.pools)) S.pools[k].sync(); });
        if (!S.unsubQuality && typeof Quality !== 'undefined' && Quality.onChange) S.unsubQuality = Quality.onChange((l, name) => setQuality(name));
    }
    function clear() {
        S.later = []; S.buckets = {};
        resetAbilities(true);
        for (const arr of [S.rings, S.decals, S.strips, S.slashes]) for (const it of arr) off(it);
        for (const g of S.glows) if (!g.held) off(g);
        for (const k of Object.keys(S.pools)) S.pools[k].reset();
        for (const h of [...S.trails]) { for (const x of h.hs) x.dispose(); S.trails.delete(h); }
        breathEnd(); B.k = 0; releaseBeam();
        for (const f of D.texts) { f.on = false; f.e.style.display = 'none'; }
        D.fl.a = 0; D.vg.a = 0; D.st.on = false;
        for (const e of [D.flash, D.vig, D.edge, D.star]) if (e) { e.style.display = 'none'; e.style.opacity = '0'; }
    }
    // После каждой (пере)сборки карты: частицы менеджера очищены движком — пересоздаём постоянное.
    function onMap(app) {
        for (const h of [...S.trails]) S.trails.delete(h);
        B.hs = []; A.hs = []; W.hs = [];
        resetAbilities(false);
        bind(app);
        buildDom();
        clear();
        if (S.ok) { buildAura(); buildWeather(); }
    }
    function update(dt) {
        if (!S.ok && S.app) bind(S.app);
        dt = clamp(dt || 0, 0, 0.1);
        S.t += dt; S.frame++;
        if (S.later.length) {
            const due = S.later.filter(l => l.at <= S.t);
            if (due.length) { S.later = S.later.filter(l => l.at > S.t); for (const l of due) { try { l.fn(); } catch (e) { /* */ } } }
        }
        if (S.ok) { updMeshes(dt); updBeam(dt); updAura(dt); updWeather(dt); updAbilities(dt); updSlots(dt); }
        updDom(dt);
    }

    return {
        init, onMap, update, clear,
        brickBreak, dustLand, partialCollapse, buildingCollapse, propBreak, explosion,
        stomp, waterSplash, swipe, tailSweep, slam, levelUp, hitKaiju,
        breathStart, breathUpdate, breathHit, breathEnd, aura,
        tracer, muzzle, trail, unitHit,
        starUp, floatText, coinBurst, flash, shake, weather, setQuality,
        fire, nova, meteor, meteorImpact, nukeCharge, nuke, skillUnlock,
        dustCloud, smokeColumn, glassBurst, sparks, waterJet, impactPuff, carExplode, crowdPuff,
    };
})();
