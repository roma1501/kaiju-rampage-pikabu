// GameCrowd.js — жители города: блочные человечки из кода (голова, торс, руки, ноги, причёска или шляпа, рюкзак).
//
// РИСОВАНИЕ. Один меш-кубик с thin instances: 8 частей на человека, матрицы всех частей — один буфер, цвет части —
// цвет инстанса. Ходьба и бег — мах конечностей, паника — руки вверх, удар — полёт кувырком и «пуф» (без крови).
// ЖИЗНЬ. Жители есть только вокруг кайдзю (пул с пересадкой: появляются за кадром у края радиуса, вдали исчезают).
// Места: тротуары вдоль дорог (сеть GameTraffic.net), площади, парки и маркеры crowd-<N> (группы стоят и беседуют,
// одиночки гуляют). Дорогу переходят на перекрёстках по зелёному и иногда посреди квартала — машины их пропускают
// (roadX / roadZ — кто сейчас на проезжей части).
// ПАНИКА. Кайдзю близко, взрыв или обрушение (scare) — бегут прочь, огибая дома по своей сетке занятости (клетка 25 px,
// здания и вода); успокоившись, возвращаются к ближайшему месту. Логика — по своим числам, без запросов к сцене.
// Координаты: x, z — карта, y — высота.

/** @satisfies {Record<string, any>} */
const GameCrowd = {
    hooks: { /** @type {any} */ score: null },     // score(очки, x, y, z, 'crowd', монеты)
    count: 0,                                      // жителей на карте сейчас

    // --- Числа ---------------------------------------------------------------------------------
    CAP: { low: 70, medium: 160, high: 300 }, CAP_MOBILE: 70,
    PARTS: 8,                       // частей на человека: торс, голова, 2 руки, 2 ноги, причёска/шляпа, рюкзак
    CELL: 25, PCELL: 700,           // px: клетка сетки занятости и корзин мест
    WALK: 17, WALK_VAR: 9,          // px/с: шаг
    RUN: 66, RUN_VAR: 32,           // px/с: бег в панике
    SCORE: 0.4,                     // очков за жителя
    GRAVITY: 520,
    SPAWN_PER_FRAME: 10,
    LIFT: 2.2,                      // px: подошвы над землёй (тротуар и плитка выше земли)
    LEG: 7.6, TORSO: 6.4, HEAD: 4.2, ARM: 6.4,      // px при росте 18
    SHIRTS: [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xecf0f1, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff7eb6, 0x34495e, 0xffffff, 0x8e5a3c, 0x5dade2, 0xc0392b],
    PANTS: [0x2c3e50, 0x34495e, 0x5d6d7e, 0x1f3a5f, 0x7f6a55, 0x2e2e2e, 0x4a6fa5, 0xb0a48a],
    SKINS: [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd],
    HAIRS: [0x2b1b12, 0x4a3020, 0x8a5a2b, 0xd8b56a, 0x1a1a1a, 0xb0b0b0, 0xa33a1e],
    HATS: [0xd0342c, 0x2e6da4, 0xf4f1e6, 0x2a2a2a, 0xf1c40f],
    BAGS: [0x8a5a34, 0x2c3e50, 0xc0392b, 0x27ae60, 0x555555],

    // --- Состояние -----------------------------------------------------------------------------
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ view: null,
    /** @type {any} */ K: null,
    /** @type {any} */ mesh: null,
    N: 0, time: 0, kills: 0,
    /** @type {Float32Array} */ M: new Float32Array(0),
    /** @type {Float32Array} */ C: new Float32Array(0),
    dirtyC: false,
    // жители (SoA). st: 0 нет, 1 идёт по тротуару, 2 гуляет по площадке, 3 стоит, 4 паника, 5 летит, 7 идёт к месту, 8 смотрит
    /** @type {Uint8Array} */ st: new Uint8Array(0),
    /** @type {Uint8Array} */ pst: new Uint8Array(0),
    /** @type {Uint8Array} */ flags: new Uint8Array(0),
    /** @type {Int32Array} */ tint: new Int32Array(0),
    /** @type {Int16Array} */ road: new Int16Array(0),
    /** @type {Int16Array} */ area: new Int16Array(0),
    /** @type {Int32Array} */ smp: new Int32Array(0),
    /** @type {Int8Array} */ dir: new Int8Array(0),
    /** @type {Record<string, Float32Array>} */ f: {},
    // сетка занятости
    gw: 0, gh: 0,
    /** @type {Uint16Array} */ occ: new Uint16Array(0),      // 0 свободно, 0xffff вода, иначе номер здания + 1
    /** @type {Uint8Array} */ asph: new Uint8Array(0),       // 1 — проезжая часть
    // места
    nS: 0, pw: 0, ph: 0,
    /** @type {Float32Array} */ sX: new Float32Array(0),
    /** @type {Float32Array} */ sZ: new Float32Array(0),
    /** @type {Float32Array} */ sT: new Float32Array(0),
    /** @type {Uint8Array} */ sKind: new Uint8Array(0),
    /** @type {Int16Array} */ sA: new Int16Array(0),
    /** @type {Int8Array} */ sB: new Int8Array(0),
    /** @type {any} */ sBk: null,
    /** @type {any[]} */ areas: [],
    grpLeft: 0, grpN: 0, grpX: 0, grpZ: 0, grpA: 0, grpT: 0, grpR: 8,
    // кто на проезжей части (для GameTraffic)
    roadN: 0,
    roadX: new Float32Array(96), roadZ: new Float32Array(96),
    // оси тела и начало (на время записи матриц одного человека)
    bFx: 1, bFy: 0, bFz: 0, bUx: 0, bUy: 1, bUz: 0, bRx: 0, bRz: 1, bOx: 0, bOy: 0, bOz: 0,

    // ---------------------------------------------------------------------------------------------
    // Подготовка карты
    // ---------------------------------------------------------------------------------------------

    /** Карта загружена: сетка занятости, места, меш толпы, жители вокруг точки старта. */
    async build(app) {
        this.clear();
        this.app = app; this.view = app.location.view;
        const scene = this.view.scene, q = KR.quality();
        const N = this.N = IS_MOBILE ? Math.min(this.CAP_MOBILE, this.CAP[q]) : this.CAP[q];
        this.st = new Uint8Array(N); this.pst = new Uint8Array(N); this.flags = new Uint8Array(N); this.tint = new Int32Array(N);
        this.road = new Int16Array(N); this.area = new Int16Array(N); this.smp = new Int32Array(N); this.dir = new Int8Array(N);
        this.f = {};
        for (const k of ['x', 'y', 'z', 'hd', 'sp', 'ph', 'sc', 'tm', 'tx', 'tz', 'fx', 'fz', 'fear', 'det', 'detT', 'vx', 'vy', 'vz', 'rot', 'rv', 'grow', 't', 'off', 'offT', 'think', 'wait', 'calm', 'wsp', 'rsp']) this.f[k] = new Float32Array(N);
        this.M = new Float32Array(N * this.PARTS * 16); this.C = new Float32Array(N * this.PARTS * 4);
        this.pw = Math.ceil(GameCity.mapW / this.PCELL); this.ph = Math.ceil(GameCity.mapH / this.PCELL);
        this._grid();
        this._habitat();

        const mesh = this.mesh = BABYLON.MeshBuilder.CreateBox('crowd', { size: 1 }, scene);
        const mat = new BABYLON.StandardMaterial('crowd', scene);
        mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        mesh.material = mat;
        mesh.doNotSyncBoundingInfo = true;
        mesh.thinInstanceSetBuffer('matrix', this.M, 16, false);
        mesh.thinInstanceSetBuffer('color', this.C, 4, false);
        mesh.thinInstanceCount = N * this.PARTS;
        mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false; mesh.hasVertexAlpha = false;
        mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -200, 0), new BABYLON.Vector3(GameCity.mapW, 3000, GameCity.mapH)));
        World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false, castShadow: !IS_MOBILE && q !== 'low' });
        mat.specularColor = new BABYLON.Color3(0, 0, 0);

        const sp = app.location.marker('spawn');
        this._fill(sp ? sp.x : GameCity.mapW / 2, sp ? sp.y : GameCity.mapH / 2);
    },

    clear() {
        if (this.mesh) {
            const mat = this.mesh.material;
            try { World3D.removeObject(this.view, this.mesh); if (mat) mat.dispose(); } catch (e) { /* сцена убрана */ }
        }
        this.mesh = null; this.N = 0; this.count = 0; this.nS = 0; this.sBk = null; this.areas = []; this.roadN = 0; this.grpLeft = 0;
    },

    /** Новый раунд: жители заново вокруг кайдзю. */
    resetRound() {
        if (!this.N || !this.mesh) return;
        for (let i = 0; i < this.N; i++) if (this.st[i]) this._free(i);
        this.kills = 0; this.grpLeft = 0;
        const K = typeof GameKaiju !== 'undefined' && GameKaiju.app ? GameKaiju : null, sp = this.app ? this.app.location.marker('spawn') : null;
        this._fill(K ? K.x : sp ? sp.x : GameCity.mapW / 2, K ? K.z : sp ? sp.y : GameCity.mapH / 2);
    },

    // Сетка занятости: здания (номер), вода, проезжая часть.
    _grid() {
        const C = this.CELL, gw = this.gw = Math.ceil(GameCity.mapW / C), gh = this.gh = Math.ceil(GameCity.mapH / C);
        const occ = this.occ = new Uint16Array(gw * gh), asph = this.asph = new Uint8Array(gw * gh);
        const NV = GameCity.NAV, nav = GameCity.nav, nw = GameCity.navW, nh = GameCity.navH;
        if (nav.length) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            const ni = Math.min(nw - 1, Math.floor((i + 0.5) * C / NV)), nj = Math.min(nh - 1, Math.floor((j + 0.5) * C / NV));
            if (nav[nj * nw + ni] === 2) occ[j * gw + i] = 0xffff;
        }
        for (const b of GameCity.buildings) {
            const i0 = Math.max(0, Math.floor(b.x0 / C)), i1 = Math.min(gw - 1, Math.floor(b.x1 / C)), j0 = Math.max(0, Math.floor(b.z0 / C)), j1 = Math.min(gh - 1, Math.floor(b.z1 / C));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const dx = (i + 0.5) * C - b.x, dz = (j + 0.5) * C - b.z;
                if (Math.abs(dx * b.c + dz * b.s) < b.w / 2 + 4 && Math.abs(-dx * b.s + dz * b.c) < b.d / 2 + 4) occ[j * gw + i] = b.id + 1;
            }
        }
        for (const R of GameTraffic.net) {
            const hw = R.wid / 2 - R.curb, ex = Math.abs(R.c) * R.len / 2 + Math.abs(R.s) * hw, ez = Math.abs(R.s) * R.len / 2 + Math.abs(R.c) * hw;
            const i0 = Math.max(0, Math.floor((R.x - ex) / C)), i1 = Math.min(gw - 1, Math.floor((R.x + ex) / C)), j0 = Math.max(0, Math.floor((R.z - ez) / C)), j1 = Math.min(gh - 1, Math.floor((R.z + ez) / C));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const dx = (i + 0.5) * C - R.x, dz = (j + 0.5) * C - R.z;
                if (Math.abs(dx * R.c + dz * R.s) <= R.len / 2 && Math.abs(-dx * R.s + dz * R.c) <= hw) asph[j * gw + i] = 1;
            }
        }
    },

    /** Точка занята зданием, водой или за краем карты. */
    blocked(x, z) {
        if (x < 40 || z < 40 || x > GameCity.mapW - 40 || z > GameCity.mapH - 40) return true;
        const v = this.occ[Math.floor(z / this.CELL) * this.gw + Math.floor(x / this.CELL)];
        if (!v) return false;
        return v === 0xffff || !GameCity.buildings[v - 1].gone;
    },

    onRoad(x, z) {
        if (x < 0 || z < 0 || x >= GameCity.mapW || z >= GameCity.mapH) return 0;
        return this.asph[Math.floor(z / this.CELL) * this.gw + Math.floor(x / this.CELL)];
    },

    // Места: точки тротуаров и площадок, разложенные по корзинам.
    _habitat() {
        const loc = /** @type {LoryApp} */ (this.app).location, net = GameTraffic.net, rnd = KR.rng(977);
        const X = [], Z = [], Kd = [], A = [], B = [], T = [];
        net.forEach((/** @type {any} */ R, /** @type {number} */ ri) => {
            for (let side = -1; side <= 1; side += 2) for (let t = -R.len / 2 + 14; t < R.len / 2 - 14; t += 50) {
                const off = side * R.walk, x = R.x + R.c * t - R.s * off, z = R.z + R.s * t + R.c * off;
                if (this.blocked(x, z) || this.onRoad(x, z)) continue;
                X.push(x); Z.push(z); Kd.push(0); A.push(ri); B.push(side); T.push(t);
            }
        });
        this.areas = [];
        for (const d of loc.markers()) {
            const name = String(d.name);
            let step = 0, round = false;
            if (/^plaza(-|$)/.test(name)) step = 80; else if (/^paint-park/.test(name)) step = 115; else if (/^pier(-|$)/.test(name)) step = 130;
            else if (/^crowd(-|$)/.test(name)) { step = 42; round = true; }
            if (!step) continue;
            const yaw = ((d.rot ? d.rot[1] : 0) || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
            const hl = (d.scale ? d.scale[0] : 1) * (round ? 100 : 50), hw = round ? hl : (d.scale ? d.scale[2] : 1) * 50;
            if (hl < 30 || hw < 30) continue;
            const ai = this.areas.length;
            this.areas.push({ x: d.x, z: d.y, hl, hw, c, s, round });
            for (let lz = -hw + step * 0.5; lz < hw; lz += step) for (let lx = -hl + step * 0.5; lx < hl; lx += step) {
                const jx = lx + (rnd() - 0.5) * step * 0.6, jz = lz + (rnd() - 0.5) * step * 0.6;
                if (round && jx * jx + jz * jz > hl * hl) continue;
                const x = d.x + jx * c - jz * s, z = d.y + jx * s + jz * c;
                if (this.blocked(x, z) || this.onRoad(x, z)) continue;
                let bad = false;
                GameCity._nearProps(x, z, 20, (/** @type {any} */ p) => { if (Math.hypot(p.x - x, p.z - z) < p.r * 0.8 + 6) bad = true; });
                if (bad) continue;
                X.push(x); Z.push(z); Kd.push(1); A.push(ai); B.push(0); T.push(0);
            }
        }
        const n = this.nS = X.length;
        this.sX = Float32Array.from(X); this.sZ = Float32Array.from(Z); this.sT = Float32Array.from(T);
        this.sKind = Uint8Array.from(Kd); this.sA = Int16Array.from(A); this.sB = Int8Array.from(B);
        const W = this.pw, H = this.ph, P = this.PCELL, start = new Int32Array(W * H + 1), list = new Int32Array(n), cell = new Int32Array(n);
        for (let i = 0; i < n; i++) { const k = Math.min(H - 1, Math.floor(Z[i] / P)) * W + Math.min(W - 1, Math.floor(X[i] / P)); cell[i] = k; start[k + 1]++; }
        for (let k = 0; k < W * H; k++) start[k + 1] += start[k];
        const at = start.slice(0, W * H);
        for (let i = 0; i < n; i++) list[at[cell[i]]++] = i;
        this.sBk = { start, list };
    },

    // ---------------------------------------------------------------------------------------------
    // Пул: появление и уход
    // ---------------------------------------------------------------------------------------------

    radius() { const K = this.K; return Math.min(3400, 1250 + (K ? K.height : 300) * 1.9); },

    _fill(x, z) {
        if (!this.sBk || !this.nS) return;
        const R = Math.min(3400, 1250 + 300 * 1.9);
        for (let i = 0, tries = 0; i < this.N && tries < this.N * 8; tries++) { if (this.st[i] || this._spawn(i, x, z, R, true)) i++; }
        for (let i = 0; i < this.N; i++) if (this.st[i]) { this.f.grow[i] = 1; this._pose(i, GameCity.base); }
        this._flush();
    },

    _seen(x, z) {
        const app = this.app;
        if (!app || !app.camera) return false;
        const p = this.view.camera.position, az = app.camera.azimuth, fx = Math.cos(az), fz = Math.sin(az);
        const dx = x - p.x, dz = z - p.z, f = dx * fx + dz * fz;
        return f > -40 && Math.abs(-dx * fz + dz * fx) < f * 1.05 + 120;
    },

    // Поселить жителя i у случайного места в круге (first) или в кольце у края радиуса.
    _spawn(i, cx, cz, R, first) {
        const f = this.f, rnd = Math.random;
        if (this.grpLeft > 0) {                                  // группа набирается: встать в круг
            const a = this.grpN * 2.4 + rnd() * 0.5, x = this.grpX + Math.cos(a) * this.grpR, z = this.grpZ + Math.sin(a) * this.grpR;
            this.grpLeft--; this.grpN++;
            if (this.blocked(x, z)) return false;
            this._init(i, x, z);
            this.st[i] = 3; this.area[i] = this.grpA; f.tx[i] = this.grpX; f.tz[i] = this.grpZ; f.tm[i] = this.grpT + rnd() * 6;
            f.hd[i] = Math.atan2(this.grpZ - z, this.grpX - x);
            return true;
        }
        const a = rnd() * 6.283, d = first ? R * Math.sqrt(rnd()) : R * (0.74 + rnd() * 0.26), px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d;
        if (px < 0 || pz < 0 || px >= GameCity.mapW || pz >= GameCity.mapH) return false;
        const B = this.sBk, k = Math.floor(pz / this.PCELL) * this.pw + Math.floor(px / this.PCELL), n = B.start[k + 1] - B.start[k];
        if (!n) return false;
        const s = B.list[B.start[k] + Math.floor(rnd() * n)], x = this.sX[s] + (rnd() - 0.5) * 8, z = this.sZ[s] + (rnd() - 0.5) * 8;
        const dk = Math.hypot(x - cx, z - cz);
        if (dk > R * 1.1) return false;
        if (!first && (dk < R * 0.45 || (dk < R * 0.74 && this._seen(x, z)))) return false;
        if (first && this.K && dk < this.K.radius() + 50) return false;
        if (this.blocked(x, z)) return false;
        this._init(i, x, z);
        this._adopt(i, s, true);
        return true;
    },

    // Встать на место s: тротуар — идти вдоль дороги, площадка — гулять или собрать группу.
    _adopt(i, s, fresh) {
        const f = this.f, rnd = Math.random;
        this.smp[i] = s;
        if (this.sKind[s] === 0) {
            const R = GameTraffic.net[this.sA[s]], side = this.sB[s];
            this.st[i] = 1; this.road[i] = this.sA[s]; this.dir[i] = rnd() < 0.5 ? 1 : -1; f.t[i] = this.sT[s];
            f.off[i] = f.offT[i] = side * (R.walk + (rnd() - 0.5) * (R.curb - 5));
            f.tm[i] = 4 + rnd() * 14;
            f.hd[i] = R.yaw + (this.dir[i] < 0 ? Math.PI : 0);
            if (!fresh) { f.x[i] = R.x + R.c * f.t[i] - R.s * f.off[i]; f.z[i] = R.z + R.s * f.t[i] + R.c * f.off[i]; }
            return;
        }
        this.area[i] = this.sA[s];
        if (fresh && rnd() < 0.5) {                               // компания: остальные подойдут следующими
            this.grpLeft = 1 + Math.floor(rnd() * 4); this.grpN = 1; this.grpX = f.x[i]; this.grpZ = f.z[i]; this.grpA = this.sA[s]; this.grpT = 14 + rnd() * 40; this.grpR = 7 + rnd() * 4;
            const a = rnd() * 6.283, x = this.grpX + Math.cos(a) * this.grpR, z = this.grpZ + Math.sin(a) * this.grpR;
            if (!this.blocked(x, z)) { f.x[i] = x; f.z[i] = z; }
            this.st[i] = 3; f.tx[i] = this.grpX; f.tz[i] = this.grpZ; f.tm[i] = this.grpT + rnd() * 6;
            f.hd[i] = Math.atan2(this.grpZ - f.z[i], this.grpX - f.x[i]);
            return;
        }
        this.st[i] = 2; f.wait[i] = rnd() * 2;
        this._target(i);
    },

    // Новая цель прогулки по площадке (или рядом, если площадки нет).
    _target(i) {
        const f = this.f, A = this.area[i] >= 0 ? this.areas[this.area[i]] : null, rnd = Math.random;
        for (let k = 0; k < 4; k++) {
            let x, z;
            if (A) {
                const lx = (rnd() * 2 - 1) * A.hl, lz = (rnd() * 2 - 1) * A.hw;
                if (A.round && lx * lx + lz * lz > A.hl * A.hl) continue;
                x = A.x + lx * A.c - lz * A.s; z = A.z + lx * A.s + lz * A.c;
                const dx = x - f.x[i], dz = z - f.z[i], d = Math.hypot(dx, dz);
                if (d > 170) { x = f.x[i] + dx / d * 170; z = f.z[i] + dz / d * 170; }
            } else { x = f.x[i] + (rnd() - 0.5) * 160; z = f.z[i] + (rnd() - 0.5) * 160; }
            if (this.blocked(x, z) || this.onRoad(x, z)) continue;
            f.tx[i] = x; f.tz[i] = z;
            return;
        }
        f.tx[i] = f.x[i]; f.tz[i] = f.z[i]; f.wait[i] = 1 + rnd() * 2;
    },

    // Внешность и начальные числа жителя.
    _init(i, x, z) {
        const f = this.f, rnd = Math.random, pick = (/** @type {number[]} */ a) => a[Math.floor(rnd() * a.length)];
        f.x[i] = x; f.z[i] = z; f.y[i] = 0; f.sp[i] = 0; f.ph[i] = rnd() * 6.283; f.sc[i] = (17 + rnd() * 2) / 18; f.grow[i] = 0;
        f.fear[i] = 0; f.det[i] = 0; f.detT[i] = 0; f.think[i] = rnd() * 0.25; f.wait[i] = 0; f.calm[i] = 0; f.tm[i] = 0; f.rot[i] = 0; f.hd[i] = rnd() * 6.283;
        f.wsp[i] = this.WALK + rnd() * this.WALK_VAR; f.rsp[i] = this.RUN + rnd() * this.RUN_VAR;
        this.area[i] = -1; this.pst[i] = 0;
        const fl = (rnd() < 0.7 ? 1 : 0) | (rnd() < 0.22 ? 2 : 0) | (rnd() < 0.3 ? 4 : 0) | (rnd() < 0.45 ? 8 : 0) | (rnd() < 0.5 ? 16 : 0);
        this.flags[i] = fl;
        const shirt = pick(this.SHIRTS), pants = pick(this.PANTS), skin = pick(this.SKINS), o = i * this.PARTS * 4;
        this.tint[i] = shirt;
        this._col(o, shirt, 1); this._col(o + 4, skin, 1);
        this._col(o + 8, fl & 8 ? skin : shirt, fl & 8 ? 1 : 0.9); this._col(o + 12, fl & 8 ? skin : shirt, fl & 8 ? 1 : 0.9);
        this._col(o + 16, pants, 1); this._col(o + 20, pants, 0.92);
        this._col(o + 24, fl & 2 ? pick(this.HATS) : pick(this.HAIRS), 1);
        this._col(o + 28, pick(this.BAGS), 1);
        this.dirtyC = true;
        this.count++;
    },

    _col(o, hex, k) { const C = this.C; C[o] = ((hex >> 16) & 255) / 255 * k; C[o + 1] = ((hex >> 8) & 255) / 255 * k; C[o + 2] = (hex & 255) / 255 * k; C[o + 3] = 1; },

    _free(i) {
        if (!this.st[i]) return;
        this.st[i] = 0; this.count--;
        this.M.fill(0, i * this.PARTS * 16, (i + 1) * this.PARTS * 16);
    },

    // «Пуф»: житель исчезает облачком цвета одежды.
    _puff(i) {
        const f = this.f, y = GameCity.base + f.y[i] + 7;
        FX('crowdPuff', f.x[i], y, f.z[i], this.tint[i]);
        // @ts-ignore — GameFX объявляет js/GameFX.js
        if (typeof GameFX === 'undefined' || typeof GameFX.crowdPuff !== 'function') FX('brickBreak', f.x[i], y, f.z[i], 9, this.tint[i]);
        this._free(i);
    },

    _flush() {
        const m = this.mesh;
        if (!m) return;
        m.thinInstanceBufferUpdated('matrix');
        if (this.dirtyC) { this.dirtyC = false; m.thinInstanceBufferUpdated('color'); }
    },

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    update(dt, K) {
        this.K = K;
        const N = this.N;
        if (!N || !this.mesh) return;
        this.time += dt;
        const f = this.f, st = this.st, x = f.x, z = f.z, net = GameTraffic.net, base = GameCity.base, rnd = Math.random;
        const play = typeof GameArmy !== 'undefined' && GameArmy.active && K.alive;
        const R = this.radius(), out2 = R * R * 1.5, kr = K.radius() + 8;
        const panic2 = play ? Math.pow(K.height * 1.7 + 240, 2) : 0, alert2 = play ? Math.pow(K.height * 2.8 + 520, 2) : 0;
        let spawned = 0, tries = 0, roadN = 0;
        for (let i = 0; i < N; i++) {
            let s = st[i];
            if (!s) { if (spawned < this.SPAWN_PER_FRAME && tries++ < 24 && this._spawn(i, K.x, K.z, R, false)) spawned++; if (!st[i]) continue; s = st[i]; }
            const dx = x[i] - K.x, dz = z[i] - K.z, d2 = dx * dx + dz * dz;
            if (d2 > out2 && s !== 5) { this._free(i); continue; }
            if (f.grow[i] < 1) f.grow[i] = Math.min(1, f.grow[i] + dt * 2.5);
            if (f.calm[i] > 0) f.calm[i] -= dt;
            // --- страх: кайдзю рядом ---
            if (s !== 5 && (f.think[i] -= dt) <= 0) {
                f.think[i] = 0.12 + rnd() * 0.12;
                if (d2 < panic2) { if (s !== 4) { this._panic(i, K.x, K.z, 3 + rnd() * 3); s = 4; } else { f.fx[i] = K.x; f.fz[i] = K.z; if (f.fear[i] < 2.5) f.fear[i] = 2.5; } }
                else if (d2 < alert2 && s !== 4 && s !== 8 && f.calm[i] <= 0) { this.pst[i] = s; st[i] = s = 8; f.tm[i] = 0.25 + rnd() * 1.4; f.sp[i] = 0; }
            }
            let v = 0, hd = f.hd[i];
            if (s === 1) {                                           // --- по тротуару ---
                const Rd = net[this.road[i]], sd = this.dir[i], lat = f.offT[i] - f.off[i], on = this.onRoad(x[i], z[i]);
                v = f.wsp[i];
                if (f.wait[i] > 0) { f.wait[i] -= dt; v = 0; }
                else if (Math.abs(lat) > 0.6) {                      // переход на другую сторону
                    v *= 1.5;
                    const stp = Math.sign(lat) * Math.min(Math.abs(lat), v * dt);
                    f.off[i] += stp; hd = Rd.yaw + (stp > 0 ? 1.5708 : -1.5708);
                } else {
                    if (!on) {                                       // впереди поперечная дорога: ждать зелёного
                        const nt = f.t[i] + sd * 10;
                        if (this.onRoad(Rd.x + Rd.c * nt - Rd.s * f.off[i], Rd.z + Rd.s * nt + Rd.c * f.off[i])) {
                            let J = null;
                            for (const q of Rd.juncs) { const a = (q.t - f.t[i]) * sd; if (a > 0 && a < q.half + 50) { J = q; break; } }
                            if (J && GameTraffic.greenLeft(J) < J.half * 2 / (v * 1.5) * 0.75) v = 0;
                        }
                    } else v *= 1.5;
                    f.t[i] += sd * v * dt;
                    if (Math.abs(f.t[i]) > Rd.len / 2 - 10) { this.dir[i] = -sd; f.t[i] = Math.sign(f.t[i]) * (Rd.len / 2 - 10); }
                    hd = Rd.yaw + (this.dir[i] < 0 ? Math.PI : 0);
                    if (!on && (f.tm[i] -= dt) <= 0) {
                        f.tm[i] = 6 + rnd() * 14;
                        const r = rnd();
                        if (r < 0.12 && !Rd.ave) f.offT[i] = -f.off[i];
                        else if (r < 0.3) f.wait[i] = 1.5 + rnd() * 4;
                    }
                }
                x[i] = Rd.x + Rd.c * f.t[i] - Rd.s * f.off[i]; z[i] = Rd.z + Rd.s * f.t[i] + Rd.c * f.off[i];
            } else if (s === 2 || s === 7) {                         // --- гуляет по площадке / идёт к месту ---
                if (f.wait[i] > 0) f.wait[i] -= dt;
                else {
                    const tx = f.tx[i] - x[i], tz = f.tz[i] - z[i], tl = Math.hypot(tx, tz);
                    if (tl < 3) {
                        if (s === 7) this._adopt(i, this.smp[i], false);
                        else { f.wait[i] = 0.5 + rnd() * 3.5; this._target(i); }
                    } else {
                        v = f.wsp[i] * (s === 7 ? 1.35 : 1);
                        const nx = x[i] + tx / tl * v * dt, nz = z[i] + tz / tl * v * dt;
                        if (this.blocked(nx, nz)) { if (s === 7) { if ((f.tm[i] -= 1) < 0) this._free(i); else { f.tx[i] = x[i] + (rnd() - 0.5) * 60; f.tz[i] = z[i] + (rnd() - 0.5) * 60; } } else this._target(i); v = 0; }
                        else { x[i] = nx; z[i] = nz; hd = Math.atan2(tz, tx); }
                    }
                }
                if (!st[i]) continue;
            } else if (s === 3) {                                    // --- стоит в компании ---
                hd = Math.atan2(f.tz[i] - z[i], f.tx[i] - x[i]);
                if ((f.tm[i] -= dt) <= 0) { st[i] = 2; this._target(i); }
            } else if (s === 8) {                                    // --- замер и смотрит на кайдзю ---
                hd = Math.atan2(-dz, -dx);
                if ((f.tm[i] -= dt) <= 0) {
                    if (rnd() < 0.62) this._panic(i, K.x, K.z, 3 + rnd() * 3);
                    else { st[i] = this.pst[i] || 2; f.calm[i] = 4 + rnd() * 6; }
                }
            } else if (s === 4) {                                    // --- паника: прочь от угрозы, огибая дома ---
                f.fear[i] -= dt;
                let ax = x[i] - f.fx[i], az = z[i] - f.fz[i];
                const al = Math.hypot(ax, az) || 1;
                ax /= al; az /= al;
                if (f.detT[i] > 0) { f.detT[i] -= dt; const c = Math.cos(f.det[i]), n = Math.sin(f.det[i]), t = ax * c - az * n; az = ax * n + az * c; ax = t; }
                v = f.rsp[i];
                let nx = x[i] + ax * v * dt, nz = z[i] + az * v * dt;
                if (this.blocked(nx, nz)) {
                    if (!this.blocked(nx, z[i])) nz = z[i]; else if (!this.blocked(x[i], nz)) nx = x[i]; else { nx = x[i]; nz = z[i]; }
                    if (f.detT[i] <= 0) { f.det[i] = (rnd() < 0.5 ? 1 : -1) * (1 + rnd() * 0.9); f.detT[i] = 0.5 + rnd() * 0.9; }
                }
                const mx = nx - x[i], mz = nz - z[i];
                if (mx * mx + mz * mz > 1e-4) hd = Math.atan2(mz, mx); else v = 0;
                x[i] = nx; z[i] = nz;
                if (f.fear[i] <= 0) { if (d2 > alert2 || !play) this._rehome(i); else f.fear[i] = 1.5; }
                if (!st[i]) continue;
            } else if (s === 5) {                                    // --- летит кувырком ---
                f.vy[i] -= this.GRAVITY * dt;
                x[i] += f.vx[i] * dt; z[i] += f.vz[i] * dt; f.y[i] += f.vy[i] * dt;
                f.rot[i] += f.rv[i] * dt;
                if ((f.y[i] <= 0 && f.vy[i] < 0) || (f.tm[i] -= dt) <= 0) { if (f.y[i] < 0) f.y[i] = 0; this._puff(i); continue; }
            }
            if (s !== 5) {
                // не входить в ноги кайдзю
                if (d2 < kr * kr) { const d = Math.sqrt(d2) || 1, nx = K.x + dx / d * kr, nz = K.z + dz / d * kr; if (!this.blocked(nx, nz) && s !== 1) { x[i] = nx; z[i] = nz; } }
                let dh = hd - f.hd[i];
                while (dh > Math.PI) dh -= 6.2832;
                while (dh < -Math.PI) dh += 6.2832;
                f.hd[i] += dh * Math.min(1, dt * 10);
                f.sp[i] = v;
                f.ph[i] += v * dt * 0.42;
                if (roadN < 96 && this.onRoad(x[i], z[i])) { this.roadX[roadN] = x[i]; this.roadZ[roadN++] = z[i]; }
            }
            this._pose(i, base);
        }
        this.roadN = roadN;
        this._flush();
    },

    _panic(i, sx, sz, sec) {
        const f = this.f;
        if (this.st[i] !== 4 && this.st[i] !== 8) this.pst[i] = this.st[i];
        this.st[i] = 4; f.fx[i] = sx; f.fz[i] = sz; f.fear[i] = Math.max(f.fear[i], sec); f.wait[i] = 0;
        f.det[i] = (Math.random() - 0.5) * 0.7; f.detT[i] = 0.4 + Math.random() * 0.8;
    },

    // Успокоился: идти к ближайшему месту (тротуар, площадка); мест рядом нет — уйти из пула.
    _rehome(i) {
        const f = this.f, B = this.sBk, P = this.PCELL, ci = Math.floor(f.x[i] / P), cj = Math.floor(f.z[i] / P);
        let best = -1, bd = 500 * 500;
        for (let j = Math.max(0, cj - 1); j <= Math.min(this.ph - 1, cj + 1); j++) for (let c = Math.max(0, ci - 1); c <= Math.min(this.pw - 1, ci + 1); c++) {
            const k = j * this.pw + c;
            for (let q = B.start[k]; q < B.start[k + 1]; q++) {
                const s = B.list[q], dx = this.sX[s] - f.x[i], dz = this.sZ[s] - f.z[i], d = dx * dx + dz * dz;
                if (d < bd) { bd = d; best = s; }
            }
        }
        if (best < 0) { this._free(i); return; }
        this.st[i] = 7; this.smp[i] = best; f.tx[i] = this.sX[best]; f.tz[i] = this.sZ[best]; f.tm[i] = 6; f.wait[i] = 0; f.calm[i] = 3;
    },

    // --- Матрицы частей одного жителя --------------------------------------------------------------
    _pose(i, base) {
        const f = this.f, s = this.st[i], fl = this.flags[i], S = f.sc[i] * (0.15 + 0.85 * f.grow[i]), o = i * this.PARTS * 16;
        const h = f.hd[i], ch = Math.cos(h), sh = Math.sin(h), v = f.sp[i], run = s === 4 && v > 1, fly = s === 5;
        const lean = fly ? f.rot[i] : run ? 0.24 : v > 1 ? 0.05 : 0, lc = Math.cos(lean), ln = Math.sin(lean);
        // оси тела: вперёд F, вверх U (наклон вперёд — поворот вокруг R), вправо R
        this.bFx = ch * lc; this.bFy = -ln; this.bFz = sh * lc;
        this.bUx = ch * ln; this.bUy = lc; this.bUz = sh * ln;
        this.bRx = -sh; this.bRz = ch;
        const H2 = 9 * S;
        this.bOx = f.x[i]; this.bOy = base + this.LIFT + f.y[i]; this.bOz = f.z[i];
        if (fly) { this.bOx -= this.bUx * H2; this.bOy += H2 - this.bUy * H2; this.bOz -= this.bUz * H2; }
        const LEG = this.LEG * S, TOR = this.TORSO * S, HEAD = this.HEAD * S, ARM = this.ARM * S;
        const sw = Math.sin(f.ph[i]), t = this.time;
        let legA = 0, armL = 0, armR = 0;
        if (fly) { legA = 0.7; armL = 2.5; armR = 2.2; }
        else if (v > 1) {
            legA = sw * (run ? 0.95 : 0.55);
            if (run && (fl & 1)) { armL = 2.75 + Math.sin(f.ph[i] * 1.3) * 0.45; armR = 2.75 + Math.sin(f.ph[i] * 1.3 + 2) * 0.45; }
            else { armL = -sw * (run ? 0.95 : 0.45); armR = -armL; }
        } else {
            armL = Math.sin(t * 1.1 + i) * 0.06; armR = -armL;
            if (s === 3 && ((t * 0.21 + i * 0.37) % 1) < 0.22) armR = 1.25 + Math.sin(t * 7 + i) * 0.35;      // жест в разговоре
            else if (s === 8 && (fl & 16)) armR = 2.2;                                                       // показывает на кайдзю
        }
        this._part(o, 0, LEG + TOR * 0.5, 0, 0, 2.9 * S, TOR, 5.6 * S, false);
        this._part(o + 16, 0, LEG + TOR + HEAD * 0.5 - 0.1 * S, 0, 0, HEAD, HEAD, HEAD, false);
        this._part(o + 32, 0, LEG + TOR - 0.5 * S, -3.8 * S, armL, 2 * S, ARM, 2 * S, true);
        this._part(o + 48, 0, LEG + TOR - 0.5 * S, 3.8 * S, armR, 2 * S, ARM, 2 * S, true);
        this._part(o + 64, 0, LEG, -1.45 * S, legA, 2.5 * S, LEG, 2.5 * S, true);
        this._part(o + 80, 0, LEG, 1.45 * S, fly ? -legA : -legA, 2.5 * S, LEG, 2.5 * S, true);
        if (fl & 2) this._part(o + 96, 0.5 * S, LEG + TOR + HEAD - 0.2 * S, 0, 0, (fl & 16 ? 6.6 : 5.2) * S, (fl & 16 ? 1 : 1.5) * S, (fl & 16 ? 6.6 : 4.8) * S, false);
        else this._part(o + 96, -0.35 * S, LEG + TOR + HEAD - 0.45 * S, 0, 0, 4.6 * S, 1.5 * S, 4.6 * S, false);
        if (fl & 4) this._part(o + 112, -2.3 * S, LEG + TOR * 0.55, 0, 0, 1.8 * S, 4.4 * S, 4.2 * S, false);
        else this.M.fill(0, o + 112, o + 128);
    },

    // Часть-кубик: точка крепления в осях тела (cf вперёд, cu вверх, cr вправо), поворот ang вокруг оси «вправо»,
    // размеры sx (вперёд) × sy (вверх) × sz (вправо); hang — крепление за верх (рука, нога), иначе за центр.
    _part(o, cf, cu, cr, ang, sx, sy, sz, hang) {
        const M = this.M, Fx = this.bFx, Fy = this.bFy, Fz = this.bFz, Ux = this.bUx, Uy = this.bUy, Uz = this.bUz, Rx = this.bRx, Rz = this.bRz;
        const c = ang ? Math.cos(ang) : 1, n = ang ? Math.sin(ang) : 0;
        const Xx = Fx * c + Ux * n, Xy = Fy * c + Uy * n, Xz = Fz * c + Uz * n;
        const Yx = -Fx * n + Ux * c, Yy = -Fy * n + Uy * c, Yz = -Fz * n + Uz * c;
        let px = this.bOx + Fx * cf + Ux * cu + Rx * cr, py = this.bOy + Fy * cf + Uy * cu, pz = this.bOz + Fz * cf + Uz * cu + Rz * cr;
        if (hang) { px -= Yx * sy * 0.5; py -= Yy * sy * 0.5; pz -= Yz * sy * 0.5; }
        M[o] = Xx * sx; M[o + 1] = Xy * sx; M[o + 2] = Xz * sx; M[o + 3] = 0;
        M[o + 4] = Yx * sy; M[o + 5] = Yy * sy; M[o + 6] = Yz * sy; M[o + 7] = 0;
        M[o + 8] = Rx * sz; M[o + 9] = 0; M[o + 10] = Rz * sz; M[o + 11] = 0;
        M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz; M[o + 15] = 1;
    },

    // ---------------------------------------------------------------------------------------------
    // Урон и испуг
    // ---------------------------------------------------------------------------------------------

    // Житель улетает кувырком от точки (sx, sz); очки — сразу.
    _fling(i, sx, sz, power, up) {
        const f = this.f, s = this.st[i];
        if (!s || s === 5) return false;
        let dx = f.x[i] - sx, dz = f.z[i] - sz;
        const d = Math.hypot(dx, dz) || 1, r = Math.random, p = power * (0.6 + r() * 0.8);
        dx /= d; dz /= d;
        f.vx[i] = dx * p + (r() - 0.5) * 50; f.vz[i] = dz * p + (r() - 0.5) * 50; f.vy[i] = up * (0.7 + r() * 0.7);
        f.rv[i] = (r() < 0.5 ? -1 : 1) * (7 + r() * 10); f.rot[i] = 0; f.tm[i] = 3.5; f.sp[i] = 0;
        if (f.y[i] < 1) f.y[i] = 1;
        this.st[i] = 5;
        this.kills++;
        if (this.hooks.score) this.hooks.score(this.SCORE, f.x[i], GameCity.base + 9, f.z[i], 'crowd', 0);
        return true;
    },

    /** Сфера удара: задетые жители улетают. Возвращает их число. */
    hitSphere(x, y, z, r, dmg) {
        const f = this.f, st = this.st, hy = GameCity.base + 9 - y, rr = (r + 5) * (r + 5);
        const p = Math.min(520, 190 + r * 0.8), up = Math.min(420, 150 + r * 0.5);
        let n = 0;
        for (let i = 0; i < this.N; i++) {
            if (!st[i] || st[i] === 5) continue;
            const dx = f.x[i] - x, dz = f.z[i] - z;
            if (dx * dx + dz * dz + hy * hy > rr) continue;
            if (this._fling(i, x, z, p, up)) n++;
        }
        return n;
    },

    /** Луч (отрезок a → b толщиной r). */
    hitBeam(ax, ay, az, bx, by, bz, r, dmg) {
        const f = this.f, st = this.st, dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1, base = GameCity.base + 9, rr = (r + 6) * (r + 6);
        let n = 0;
        for (let i = 0; i < this.N; i++) {
            if (!st[i] || st[i] === 5) continue;
            const px = f.x[i] - ax, py = base - ay, pz = f.z[i] - az, t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / l2));
            const ox = px - dx * t, oy = py - dy * t, oz = pz - dz * t;
            if (ox * ox + oy * oy + oz * oz > rr) continue;
            if (this._fling(i, f.x[i] - dx, f.z[i] - dz, 230, 210)) n++;
        }
        return n;
    },

    /** Под ногой и корпусом кайдзю. */
    trample(x, z, r, dmg) {
        const f = this.f, st = this.st, K = this.K, ks = K ? K.speed : 0, rr = (r + 4) * (r + 4);
        let n = 0;
        for (let i = 0; i < this.N; i++) {
            if (!st[i] || st[i] === 5) continue;
            const dx = f.x[i] - x, dz = f.z[i] - z, d2 = dx * dx + dz * dz;
            if (d2 > rr) continue;
            if (d2 < r * r * 0.2 && Math.random() < 0.45) {       // прямо под стопой
                this.kills++;
                if (this.hooks.score) this.hooks.score(this.SCORE, f.x[i], GameCity.base + 9, f.z[i], 'crowd', 0);
                this._puff(i);
                n++;
            } else if (this._fling(i, x, z, 140 + ks * 0.5, 130 + ks * 0.25)) n++;
        }
        return n;
    },

    /** Взрыв: в радиусе — улетают, дальше — разбегаются. */
    blast(x, y, z, r, dmg) {
        const f = this.f, st = this.st, rr = r * 0.9;
        let n = 0;
        if (Math.abs(y - GameCity.base) < r + 40) for (let i = 0; i < this.N; i++) {
            if (!st[i] || st[i] === 5) continue;
            const dx = f.x[i] - x, dz = f.z[i] - z, d2 = dx * dx + dz * dz;
            if (d2 > rr * rr) continue;
            const k = 1 - Math.sqrt(d2) / rr;
            if (this._fling(i, x, z, 170 + 260 * k, 180 + 240 * k)) n++;
        }
        this.scare(x, z, r * 2.6 + 150);
        return n;
    },

    /** Напугать жителей в радиусе (обрушение, взрыв рядом): бегут прочь от точки. */
    scare(x, z, r) {
        const f = this.f, st = this.st, rr = r * r;
        for (let i = 0; i < this.N; i++) {
            const s = st[i];
            if (!s || s === 5) continue;
            const dx = f.x[i] - x, dz = f.z[i] - z;
            if (dx * dx + dz * dz > rr) continue;
            if (s !== 4) this._panic(i, x, z, 2.5 + Math.random() * 3.5);
            else if (f.fear[i] < 2) f.fear[i] = 2;
        }
    },
};
