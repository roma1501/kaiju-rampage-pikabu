// GameTraffic.js — гражданский транспорт: поток машин по полосам, припаркованные машины, аварии и физика (GamePhysics).
//
// СЕТЬ. Дороги карты (GameCity.roads) — полосы в обе стороны (дорога 1+1, проспект 2+2), перекрёстки — пересечения осей
// дорог со светофором (фаза — функция времени), продолжения — стык соосных дорог. Сеть читает и GameCrowd (тротуары).
// МАШИНЫ живут только вокруг кайдзю: пул с пересадкой. Едущие — дешёвая кинематика по полосе: дистанция, красный свет,
// повороты по дуге, разворот, пешеходы на проезжей части, паника (разворот и бегство, аварии). Припаркованные — места
// вдоль бордюров и на стоянках (paint-asphalt), места детерминированы картой; тронутая машина на место не возвращается.
// ФИЗИКА. От удара, пинка, взрыва, наступания машина становится динамическим телом GamePhysics (коробка, G_VEHICLE):
// кувыркается, бьётся о другие машины и обломки, мнётся, может загореться и взорваться; остов остаётся лежать.
// Стоящие рядом с кайдзю машины держат спящее тело — их будит всё, что на них упало.
// РИСОВАНИЕ. На вид машины — два меша (кузов под покраску и всё остальное, цвета запечены в вершины), thin instances:
// матрицы всех машин вида — один буфер. Координаты: x, z — карта, y — высота.

/** @satisfies {Record<string, any>} */
const GameTraffic = {
    hooks: { /** @type {any} */ score: null },     // score(очки, x, y, z, 'car', монеты)
    count: 0,                                      // активных машин

    // --- Числа ---------------------------------------------------------------------------------
    DRIVE_CAP: { low: 40, medium: 80, high: 130 },     // едущих вокруг кайдзю
    PARK_CAP: { low: 90, medium: 200, high: 340 },     // припаркованных
    WRECK_CAP: { low: 30, medium: 60, high: 100 },      // побитых (сверх двух списков выше)
    AWAKE_CAP: { low: 18, medium: 36, high: 60 },       // живых тел физики
    BODY_CAP: { low: 40, medium: 90, high: 150 },      // тел всего (со спящими)
    PARK_FILL: { low: 0.34, medium: 0.62, high: 1 },    // заполнение парковочных мест
    MOBILE_K: 0.6,
    PARK_PITCH: 58, LOT_PITCH: 27,                      // px: шаг мест вдоль бордюра и на стоянке
    GREEN: 9, YELLOW: 2.2,                              // с: зелёный и пауза светофора
    SPEED_MIN: 95, SPEED_VAR: 60,                       // px/с: скорость потока
    TURN_R: 30, TURN_L: 58,                             // px: вылет дуги поворота направо и налево
    LIFT: 2.4,                                          // px: колёса над землёй (полотно дороги выше земли)
    FIRE_CHANCE: 0.1,                                  // подбитая машина загорается и взрывается
    SCORE_COINS: 0.8,                                   // монет за очко машины
    GCELL: 128, PCELL: 700,                             // px: клетка сетки машин и сетки мест
    DENSITY: 0.8, GRAV_UP: 1,

    // Пути моделей — литералами (сборщик берёт в архив только такие ссылки).
    MODELS: {
        sedan: 'assets/models/vehicles/sedan.glb', hatch: 'assets/models/vehicles/hatch.glb', suv: 'assets/models/vehicles/suv.glb',
        pickup: 'assets/models/vehicles/pickup.glb', sports: 'assets/models/vehicles/sports.glb', van: 'assets/models/vehicles/van.glb',
        taxi: 'assets/models/vehicles/taxi.glb', bus: 'assets/models/vehicles/bus.glb', truck: 'assets/models/vehicles/truck.glb',
        tanker: 'assets/models/vehicles/tanker.glb', fire_truck: 'assets/models/vehicles/fire_truck.glb', ambulance: 'assets/models/vehicles/ambulance.glb',
    },
    // Прежние модели (пока новой нет): ключ — поле old в KR.VEHICLES.
    OLD: {
        car_a: 'assets/models/units/car_a.glb', car_b: 'assets/models/units/car_b.glb', taxi: 'assets/models/units/taxi.glb',
        bus: 'assets/models/units/bus.glb', truck: 'assets/models/units/truck.glb',
    },
    // Цвет кузова прежней модели у видов без покраски (чтобы бензовоз не путался с грузовиком).
    OLD_PAINT: { bus: [0xe67e22, 0x3498db, 0x2ecc71, 0xecf0f1], tanker: [0xd8dde2], fire_truck: [0xd0342c], ambulance: [0xf4f6f8] },
    // Доля вида среди припаркованных (нет в списке — как в потоке).
    PARK_W: { bus: 0.25, truck: 0.7, tanker: 0.45, fire_truck: 0.12, ambulance: 0.3, taxi: 1.5 },

    // --- Состояние -----------------------------------------------------------------------------
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ view: null,
    /** @type {any} */ K: null,
    /** @type {any} */ mat: null,
    /** @type {any} */ _world: null,
    /** @type {any[]} */ types: [],
    /** @type {any[]} */ cars: [],
    /** @type {Int32Array} */ free: new Int32Array(0),
    nFree: 0, time: 0, nDrive: 0, nPark: 0, nWreck: 0, nAwake: 0, nBody: 0, kills: 0,
    driveCap: 0, parkCap: 0, wreckCap: 0, awakeCap: 0, bodyCap: 0,
    /** @type {any[]} */ net: [],
    // сетка машин (заново каждый кадр)
    gw: 0, gh: 0,
    /** @type {Int32Array} */ ghead: new Int32Array(0),
    /** @type {Int32Array} */ gnext: new Int32Array(0),
    // парковочные места
    nSlots: 0,
    /** @type {Float32Array} */ slotX: new Float32Array(0),
    /** @type {Float32Array} */ slotZ: new Float32Array(0),
    /** @type {Float32Array} */ slotH: new Float32Array(0),
    /** @type {Uint8Array} */ slotType: new Uint8Array(0),
    /** @type {Uint8Array} */ slotPaint: new Uint8Array(0),
    /** @type {Uint8Array} */ slotGone: new Uint8Array(0),
    /** @type {Int32Array} */ slotCar: new Int32Array(0),
    /** @type {any} */ slotB: null,                // корзины мест по клеткам PCELL
    // точки полос для расселения потока
    nLane: 0,
    /** @type {Int16Array} */ laneRoad: new Int16Array(0),
    /** @type {Float32Array} */ laneT: new Float32Array(0),
    /** @type {any} */ laneB: null,
    pw: 0, ph: 0, scan: 0, sweep: 0, sfxT: 0, fxT: 0,
    /** @type {any} */ _boom: null,
    /** @type {any} */ _oc: null,
    _p7: new Float32Array(7),
    /** @type {any} */ _opts: { q: [0, 0, 0, 1], vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, density: 0.8, friction: 0.55, restitution: 0.22, linDamp: 0.06, angDamp: 0.45, member: 4, filter: 0xffff },
    _dir: { x: 0, y: 0, z: 0 },
    _opt: new Int8Array(8),
    _v: { x: 0, y: 0, z: 0 },

    // ---------------------------------------------------------------------------------------------
    // Подготовка карты
    // ---------------------------------------------------------------------------------------------

    /** Карта загружена: модели, сеть дорог, места парковки, машины вокруг точки старта. */
    async build(app) {
        this.clear();
        this.app = app; this.view = app.location.view;
        const scene = this.view.scene, q = KR.quality(), mob = IS_MOBILE ? this.MOBILE_K : 1;
        this.driveCap = Math.round(this.DRIVE_CAP[q] * mob); this.parkCap = Math.round(this.PARK_CAP[q] * mob);
        this.wreckCap = Math.round(this.WRECK_CAP[q] * mob); this.awakeCap = Math.round(this.AWAKE_CAP[q] * mob); this.bodyCap = Math.round(this.BODY_CAP[q] * mob);
        const total = this.driveCap + this.parkCap + this.wreckCap;
        this.gw = Math.ceil(GameCity.mapW / this.GCELL); this.gh = Math.ceil(GameCity.mapH / this.GCELL);
        this.ghead = new Int32Array(this.gw * this.gh); this.gnext = new Int32Array(total);
        this.pw = Math.ceil(GameCity.mapW / this.PCELL); this.ph = Math.ceil(GameCity.mapH / this.PCELL);

        // --- модели: новая из assets/models/vehicles, иначе прежняя ---
        const ids = Object.keys(KR.VEHICLES);
        const models = await Promise.all(ids.map(async (id) => {
            let m = await Model3D.load(this.MODELS[id]).catch(() => null), old = false;
            if (!m || !m.parts || !m.parts.length) { m = await Model3D.load(this.OLD[KR.VEHICLES[id].old]).catch(() => null); old = true; }
            return { m, old };
        }));
        const mat = this.mat = new BABYLON.StandardMaterial('traffic', scene);
        mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        let wSum = 0, pSum = 0;
        for (const id of ids) { const w = KR.VEHICLES[id].w || 1; wSum += w; pSum += w * (this.PARK_W[id] != null ? this.PARK_W[id] : 1); }
        const shadow = !IS_MOBILE && q !== 'low';
        ids.forEach((id, n) => {
            const info = KR.VEHICLES[id], rec = models[n], w = info.w || 1, pw = w * (this.PARK_W[id] != null ? this.PARK_W[id] : 1);
            const paints = info.paint ? KR.PAINTS : (rec.old && this.OLD_PAINT[id]) || null;
            const cap = Math.min(total, Math.ceil(total * Math.max(w / wSum, pw / pSum) * 1.7) + 24);
            /** @type {any} */
            const T = {
                id, info, n: 0, cap, cars: new Array(cap).fill(null), paints, wDrive: w, wPark: pw,
                hl: info.len / 2, hw: info.wid / 2, hy: info.h / 2, rad: Math.hypot(info.len, info.wid) / 2, long: info.len > 62,
                massK: Math.max(1, info.len * info.wid * info.h / 13000),
                sx: 1, sy: 1, sz: 1, ox: 0, oz: 0, oy: 0, meshP: null, meshR: null,
                M: new Float32Array(cap * 16), CP: new Float32Array(cap * 4), CR: new Float32Array(cap * 4), dirtyM: false, dirtyC: false,
            };
            if (rec.m && rec.m.parts && rec.m.parts.length) {
                const bake = this._bake(rec.m, !!paints);
                if (rec.old) { T.sx = info.len / Math.max(1, bake.hi[0] - bake.lo[0]); T.sy = info.h / Math.max(1, bake.hi[1] - bake.lo[1]); T.sz = info.wid / Math.max(1, bake.hi[2] - bake.lo[2]); }
                T.ox = (bake.lo[0] + bake.hi[0]) / 2; T.oz = (bake.lo[2] + bake.hi[2]) / 2; T.oy = bake.lo[1];
                T.meshP = this._mesh('veh-' + id + '-paint', bake.P, T, T.CP, scene, shadow);
                T.meshR = this._mesh('veh-' + id, bake.R, T, T.CR, scene, shadow);
            }
            this.types.push(T);
        });

        // --- пул машин ---
        this.cars = []; this.free = new Int32Array(total); this.nFree = 0;
        for (let i = 0; i < total; i++) { this.cars.push(this._blank(i)); }
        for (let i = total - 1; i >= 0; i--) this.free[this.nFree++] = i;

        this.buildNet();
        this.buildSlots();
        const sp = app.location.marker('spawn');
        this._fill(sp ? sp.x : GameCity.mapW / 2, sp ? sp.y : GameCity.mapH / 2);
    },

    // Запечь модель в два набора вершин: кузов под покраску (белый) и остальное (цвет материала в вершинах).
    _bake(model, paintOn) {
        /** @type {any} */ const P = { pos: [], nor: [], col: [], flat: false };
        /** @type {any} */ const R = { pos: [], nor: [], col: [], flat: false };
        const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        for (const part of model.parts) {
            const pos = part.positions, nor = part.normals, idx = part.indices, vc = part.colors;
            for (const g of part.groups) {
                const m = model.materials[g.material] || Model3D.material();
                let c = new BABYLON.Color3(m.color[0], m.color[1], m.color[2]);
                if (m.linear) c = c.toGammaSpace();
                const paint = paintOn && String(m.name).split('/').pop() === 'paint', B = paint ? P : R;
                if (!nor) B.flat = true;
                for (let k = g.start; k < g.start + g.count; k++) {
                    const v = idx ? idx[k] : k, x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
                    B.pos.push(x, y, z);
                    if (nor) B.nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); else B.nor.push(0, 1, 0);
                    let r = paint ? 1 : c.r, gg = paint ? 1 : c.g, b = paint ? 1 : c.b;
                    if (vc && !paint) { r *= vc[v * 4]; gg *= vc[v * 4 + 1]; b *= vc[v * 4 + 2]; }
                    B.col.push(r, gg, b, 1);
                    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
                    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
                    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
                }
            }
        }
        return { P, R, lo, hi };
    },

    _mesh(name, B, T, colors, scene, shadow) {
        const n = B.pos.length / 3;
        if (!n) return null;
        const mesh = new BABYLON.Mesh(name, scene), vd = new BABYLON.VertexData(), idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        vd.positions = B.pos; vd.indices = idx; vd.colors = B.col;
        if (B.flat) { const nn = new Float32Array(B.pos.length); BABYLON.VertexData.ComputeNormals(B.pos, idx, nn); vd.normals = nn; } else vd.normals = B.nor;
        vd.applyToMesh(mesh, false);
        mesh.material = this.mat;
        mesh.hasVertexAlpha = false; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.doNotSyncBoundingInfo = true;
        mesh.thinInstanceSetBuffer('matrix', T.M, 16, false);
        mesh.thinInstanceSetBuffer('color', colors, 4, false);
        mesh.thinInstanceCount = 0;
        mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -300, 0), new BABYLON.Vector3(GameCity.mapW, 4000, GameCity.mapH)));
        World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false, castShadow: shadow });
        return mesh;
    },

    _blank(i) {
        return {
            i, state: 0, ti: 0, inst: -1, slot: -1, x: 0, y: 0, z: 0, heading: 0, fx: 1, fz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
            pr: 1, pg: 1, pb: 1, hp: 1, dead: false, burnt: false, flat: false, moved: false, burn: 1, squash: 1, wide: 1, bhy: 1, fuse: 0,
            body: -1, kickT: 0, hitT: 0, bowlT: 0, age: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, sleepT: 0,
            road: 0, dir: 1, lane: 0, off: 0, t: 0, speed: 0, vmax: 100, mode: 0, nj: 0, jdone: false, panic: 0, stuck: 0, jam: 0, ghost: 0, held: false, uturnCd: 0, pileT: 0, pile: false,
            turn: 0, te: 0, tb: 0, tdir: 1, tlane: 0, tt: 0, u: 0, len: 1, ax: 0, az: 0, cx: 0, cz: 0, ex: 0, ez: 0,
        };
    },

    /** Карта выгружается (сцена уже может быть уничтожена). */
    clear() {
        for (const T of this.types) for (const m of [T.meshP, T.meshR]) { if (m) { try { World3D.removeObject(this.view, m); } catch (e) { /* сцена убрана */ } } }
        if (this.mat) { try { this.mat.dispose(); } catch (e) { /* */ } this.mat = null; }
        if (this._world && typeof GamePhysics !== 'undefined' && GamePhysics.world === this._world) for (const c of this.cars) if (c.body >= 0) GamePhysics.remove(c.body);
        this.types = []; this.cars = []; this.net = []; this.nFree = 0; this.count = 0; this.nSlots = 0; this.nLane = 0;
        this.nDrive = this.nPark = this.nWreck = this.nAwake = this.nBody = 0; this._world = null; this.slotB = null; this.laneB = null;
    },

    /** Новый раунд: все машины заново вокруг кайдзю. */
    resetRound() {
        if (!this.cars.length) return;
        for (const c of this.cars) if (c.state) this._release(c);
        this.slotGone.fill(0);
        this.kills = 0;
        const K = typeof GameKaiju !== 'undefined' && GameKaiju.app ? GameKaiju : null, sp = this.app ? this.app.location.marker('spawn') : null;
        this._fill(K ? K.x : sp ? sp.x : GameCity.mapW / 2, K ? K.z : sp ? sp.y : GameCity.mapH / 2);
    },

    // ---------------------------------------------------------------------------------------------
    // Сеть дорог
    // ---------------------------------------------------------------------------------------------

    buildNet() {
        const net = this.net = [];
        for (const r of GameCity.roads) {
            if (r.type === 'runway') continue;
            const ave = r.type === 'avenue' || r.wid >= 200, curb = ave ? 15 : 12;
            net.push({
                x: r.x, z: r.z, len: r.len, wid: r.wid, yaw: r.yaw, c: r.c, s: r.s, ave, curb,
                lanes: ave ? [r.wid * 0.11, r.wid * 0.285] : [r.wid * 0.16], park: r.wid / 2 - curb - 11, walk: r.wid / 2 - curb * 0.5,
                /** @type {any[]} */ juncs: [], /** @type {any[]} */ cont: [null, null],
            });
        }
        const clamp = (/** @type {number} */ v, /** @type {number} */ a) => Math.max(-a, Math.min(a, v));
        for (let a = 0; a < net.length; a++) {
            const A = net[a];
            for (let b = 0; b < net.length; b++) {
                if (a === b) continue;
                const B = net[b], cr = A.c * B.s - A.s * B.c, dx = B.x - A.x, dz = B.z - A.z;
                if (Math.abs(cr) > 0.3) {                          // оси пересекаются: перекрёсток
                    const ta = (dx * B.s - dz * B.c) / cr, tb = (dx * A.s - dz * A.c) / cr;
                    if (Math.abs(ta) > A.len / 2 + B.wid / 2 + 12 || Math.abs(tb) > B.len / 2 + A.wid / 2 + 12) continue;
                    A.juncs.push({ t: clamp(ta, A.len / 2), b, tb: clamp(tb, B.len / 2), half: B.wid / 2 / Math.abs(cr), id: a < b ? a * 512 + b : b * 512 + a, main: a < b });
                } else {                                           // соосные: продолжение за концом
                    for (let e = -1; e <= 1; e += 2) {
                        const ex = A.x + A.c * e * A.len / 2 - B.x, ez = A.z + A.s * e * A.len / 2 - B.z;
                        const along = ex * B.c + ez * B.s, across = -ex * B.s + ez * B.c;
                        if (Math.abs(across) > 40 || Math.abs(along) > B.len / 2 + 40) continue;
                        const dir = (A.c * B.c + A.s * B.s > 0 ? 1 : -1) * e;
                        if (B.len / 2 - along * dir > 150) A.cont[e > 0 ? 1 : 0] = { b, t: clamp(along, B.len / 2), dir };
                    }
                }
            }
            A.juncs.sort((/** @type {any} */ p, /** @type {any} */ q) => p.t - q.t);
        }
        // Точки полос (каждые 90 px, вне перекрёстков) — куда пересаживать поток.
        const lr = [], lt = [], lx = [], lz = [];
        net.forEach((R, ri) => {
            for (let t = -R.len / 2 + 50; t < R.len / 2 - 50; t += 90) {
                let inJ = false;
                for (const J of R.juncs) if (Math.abs(J.t - t) < J.half + 40) { inJ = true; break; }
                if (inJ) continue;
                lr.push(ri); lt.push(t); lx.push(R.x + R.c * t); lz.push(R.z + R.s * t);
            }
        });
        this.nLane = lr.length; this.laneRoad = Int16Array.from(lr); this.laneT = Float32Array.from(lt);
        this.laneB = this._bucket(lx, lz);
    },

    // Корзины точек по клеткам PCELL: start[клетка]..start[клетка + 1] — номера в list.
    _bucket(xs, zs) {
        const W = this.pw, H = this.ph, P = this.PCELL, n = xs.length, start = new Int32Array(W * H + 1), list = new Int32Array(n), cell = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            const k = Math.max(0, Math.min(H - 1, Math.floor(zs[i] / P))) * W + Math.max(0, Math.min(W - 1, Math.floor(xs[i] / P)));
            cell[i] = k; start[k + 1]++;
        }
        for (let k = 0; k < W * H; k++) start[k + 1] += start[k];
        const at = start.slice(0, W * H);
        for (let i = 0; i < n; i++) list[at[cell[i]]++] = i;
        return { start, list };
    },

    /** Секунд зелёного осталось дороге записи перекрёстка J (≤ 0 — красный). */
    greenLeft(J) {
        const G = this.GREEN, Y = this.YELLOW, ph = (this.time + (J.id % 89) * 1.7) % (2 * (G + Y));
        return J.main ? G - ph : (ph >= G + Y ? 2 * G + Y - ph : -1);
    },

    // ---------------------------------------------------------------------------------------------
    // Парковочные места
    // ---------------------------------------------------------------------------------------------

    buildSlots() {
        const loc = /** @type {LoryApp} */ (this.app).location, rnd = KR.rng(4711 + this.net.length * 31), q = KR.quality();
        const fill = this.PARK_FILL[q] * (IS_MOBILE ? this.MOBILE_K : 1), base = GameCity.base;
        const X = [], Z = [], Hd = [], Ty = [], Pa = [];
        const types = this.types;
        let wPark = 0, wShort = 0;
        for (const T of types) { wPark += T.wPark; if (!T.long) wShort += T.wPark; }
        const pick = (/** @type {boolean} */ shortOnly) => {
            let r = rnd() * (shortOnly ? wShort : wPark);
            for (let i = 0; i < types.length; i++) { if (shortOnly && types[i].long) continue; r -= types[i].wPark; if (r <= 0) return i; }
            return 0;
        };
        const ok = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r) => {
            if (x < 80 || z < 80 || x > GameCity.mapW - 80 || z > GameCity.mapH - 80) return false;
            if (loc.waterAt(x, z) != null || GameCity.heightAt(x, z) > base + 1) return false;
            let bad = false;
            GameCity._nearProps(x, z, r, (/** @type {any} */ p) => { if (Math.hypot(p.x - x, p.z - z) < p.r * 0.7 + r) bad = true; });
            return !bad;
        };
        const add = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ h, /** @type {number} */ ti) => { X.push(x); Z.push(z); Hd.push(h); Ty.push(ti); Pa.push(Math.floor(rnd() * 256)); };
        // --- вдоль бордюров ---
        for (const R of this.net) {
            const n = Math.floor((R.len - 60) / this.PARK_PITCH);
            for (let side = -1; side <= 1; side += 2) {
                let blockOcc = 0;
                for (let k = 0; k < n; k++) {
                    if (k % 7 === 0) blockOcc = 0.2 + 0.7 * rnd();
                    const roll = rnd(), ti = pick(false);
                    if (roll > blockOcc * fill) continue;
                    let t = -R.len / 2 + 30 + (k + 0.5) * this.PARK_PITCH;
                    const T = types[ti];
                    if (T.long) { if (k + 1 >= n) continue; t += this.PARK_PITCH / 2; }
                    let inJ = false;
                    for (const J of R.juncs) if (Math.abs(J.t - t) < J.half + 24 + T.hl) { inJ = true; break; }
                    if (inJ) continue;
                    t += (rnd() - 0.5) * 6;
                    const off = side * (R.park - (T.hw - 9.5)), x = R.x + R.c * t - R.s * off, z = R.z + R.s * t + R.c * off;
                    if (!ok(x, z, T.hl * 0.7)) continue;
                    add(x, z, R.yaw + (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.07, ti);
                    if (T.long) k++;
                }
            }
        }
        // --- стоянки: асфальтовые площадки карты (paint-asphalt) ---
        for (const d of loc.markers()) {
            if (!/^paint-asphalt/.test(String(d.name))) continue;
            const len = (d.scale ? d.scale[0] : 1) * 100, wid = (d.scale ? d.scale[2] : 1) * 100, yaw = ((d.rot ? d.rot[1] : 0) || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
            let row = 0;
            for (let lz = -wid / 2 + 30; lz < wid / 2 - 26; lz += row % 2 ? 108 : 50, row++) {
                const face = row % 2 ? 1 : -1;
                for (let lx = -len / 2 + 22; lx < len / 2 - 20; lx += this.LOT_PITCH) {
                    const roll = rnd(), ti = pick(true);
                    if (roll > 0.78 * fill) continue;
                    const x = d.x + lx * c - lz * s, z = d.y + lx * s + lz * c;
                    if (!ok(x, z, 12)) continue;
                    add(x, z, yaw + face * Math.PI / 2 + (rnd() - 0.5) * 0.06, ti);
                }
            }
        }
        const n = this.nSlots = X.length;
        this.slotX = Float32Array.from(X); this.slotZ = Float32Array.from(Z); this.slotH = Float32Array.from(Hd);
        this.slotType = Uint8Array.from(Ty); this.slotPaint = Uint8Array.from(Pa);
        this.slotGone = new Uint8Array(n); this.slotCar = new Int32Array(n).fill(-1);
        this.slotB = this._bucket(X, Z);
    },

    // ---------------------------------------------------------------------------------------------
    // Пул: появление и уход машин
    // ---------------------------------------------------------------------------------------------

    radius() { const K = this.K, H = K ? K.height : 300; return Math.min(3600, 1750 + H * 1.3); },

    // Заполнить окрестности точки сразу (карта, новый раунд).
    _fill(x, z) {
        if (!this.slotB) return;
        const R = Math.min(3600, 1750 + 300 * 1.3), P = this.PCELL, n = Math.ceil(R / P);
        const ci = Math.floor(x / P), cj = Math.floor(z / P);
        for (let ring = 0; ring <= n; ring++) for (let j = cj - ring; j <= cj + ring; j++) for (let i = ci - ring; i <= ci + ring; i++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
            this._parkCell(i, j, x, z, R);
        }
        for (let k = 0; k < this.driveCap * 3 && this.nDrive < this.driveCap; k++) this._spawnDrive(x, z, R, true);
        this.flush();
    },

    // Клетка мест: поставить машины на свободные места, если клетка в радиусе.
    _parkCell(i, j, x, z, R) {
        if (i < 0 || j < 0 || i >= this.pw || j >= this.ph) return;
        const P = this.PCELL, B = this.slotB, k = j * this.pw + i;
        if (Math.hypot((i + 0.5) * P - x, (j + 0.5) * P - z) > R) return;
        for (let q = B.start[k]; q < B.start[k + 1]; q++) {
            const s = B.list[q];
            if (this.slotCar[s] >= 0 || this.slotGone[s]) continue;
            if (this.nPark >= this.parkCap) return;
            this._park(s);
        }
    },

    _alloc(ti) {
        if (!this.nFree) return null;
        let T = this.types[ti];
        if (!T.meshR && !T.meshP) return null;
        if (T.n >= T.cap) { T = null; for (const o of this.types) if (o.n < o.cap && !o.long && (o.meshR || o.meshP)) { T = o; break; } if (!T) return null; }
        const c = this.cars[this.free[--this.nFree]], info = T.info;
        c.ti = this.types.indexOf(T);
        c.hp = info.hp; c.dead = c.burnt = c.flat = c.moved = false; c.burn = 1; c.squash = 1; c.wide = 1; c.bhy = T.hy; c.fuse = 0;
        c.body = -1; c.kickT = c.hitT = c.bowlT = c.age = c.sleepT = 0; c.slot = -1; c.panic = 0; c.stuck = 0; c.jam = 0; c.ghost = 0; c.held = false; c.uturnCd = 0; c.turn = 0; c.mode = 0; c.pile = false; c.pileT = Math.random() * 0.4;
        c.vx = c.vy = c.vz = 0;
        c.inst = T.n; T.cars[T.n++] = c; T.dirtyM = T.dirtyC = true;
        this.count++;
        return c;
    },

    // Убрать машину совсем: тело, место в буфере вида, запись в пуле.
    _release(c) {
        if (!c.state) return;
        this._unbody(c);
        if (c.slot >= 0) { this.slotCar[c.slot] = -1; c.slot = -1; }
        if (c.state === 1) this.nDrive--; else if (!c.moved) this.nPark--;
        const T = this.types[c.ti], last = T.cars[--T.n];
        if (last !== c) {
            const a = c.inst * 16, b = T.n * 16, a4 = c.inst * 4, b4 = T.n * 4;
            for (let k = 0; k < 16; k++) T.M[a + k] = T.M[b + k];
            for (let k = 0; k < 4; k++) { T.CP[a4 + k] = T.CP[b4 + k]; T.CR[a4 + k] = T.CR[b4 + k]; }
            T.cars[c.inst] = last; last.inst = c.inst;
        }
        T.cars[T.n] = null; T.dirtyM = T.dirtyC = true;
        c.state = 0; c.inst = -1;
        this.free[this.nFree++] = c.i;
        this.count--;
    },

    _paint(c, T, n) {
        if (T.paints) { const p = T.paints[n % T.paints.length]; c.pr = ((p >> 16) & 255) / 255; c.pg = ((p >> 8) & 255) / 255; c.pb = (p & 255) / 255; }
        else c.pr = c.pg = c.pb = 1;
    },

    // Машина на парковочное место s.
    _park(s) {
        const c = this._alloc(this.slotType[s]);
        if (!c) return false;
        const T = this.types[c.ti];
        c.state = 2; c.slot = s; this.slotCar[s] = c.i; this.nPark++;
        c.x = this.slotX[s]; c.z = this.slotZ[s]; c.heading = this.slotH[s]; c.y = GameCity.base + T.hy; c.speed = 0;
        c.fx = Math.cos(c.heading); c.fz = Math.sin(c.heading);
        this._quatYaw(c);
        this._paint(c, T, this.slotPaint[s]);
        this._color(c); this._matYaw(c);
        return true;
    },

    // Новая едущая машина на полосе в кольце вокруг (x, z); first — первое расселение (по всему кругу).
    _spawnDrive(x, z, R, first) {
        if (!this.nLane || !this.nFree) return false;
        const a = Math.random() * 6.283, d = first ? R * Math.sqrt(Math.random()) : R * (0.74 + Math.random() * 0.26);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (px < 0 || pz < 0 || px >= GameCity.mapW || pz >= GameCity.mapH) return false;
        const B = this.laneB, k = Math.floor(pz / this.PCELL) * this.pw + Math.floor(px / this.PCELL), n = B.start[k + 1] - B.start[k];
        if (!n) return false;
        const s = B.list[B.start[k] + Math.floor(Math.random() * n)], road = this.laneRoad[s], Rd = this.net[road];
        const dir = Math.random() < 0.5 ? 1 : -1, lane = Math.floor(Math.random() * Rd.lanes.length), t = this.laneT[s] + (Math.random() - 0.5) * 60;
        const off = dir * Rd.lanes[lane], cx = Rd.x + Rd.c * t - Rd.s * off, cz = Rd.z + Rd.s * t + Rd.c * off;
        const dk = Math.hypot(cx - x, cz - z);
        if (dk > R * 1.05 || (!first && dk < R * 0.72 && this._seen(cx, cz))) return false;
        if (!first && dk < R * 0.5) return false;
        if (first && this.K && dk < this.K.radius() + 160) return false;
        // место свободно?
        for (const o of this.cars) if (o.state === 1 && Math.abs(o.x - cx) < 80 && Math.abs(o.z - cz) < 80) return false;
        // вид — по доле в потоке
        let w = 0;
        for (const T of this.types) w += T.wDrive;
        let r = Math.random() * w, ti = 0;
        for (let i = 0; i < this.types.length; i++) { r -= this.types[i].wDrive; if (r <= 0) { ti = i; break; } }
        const c = this._alloc(ti);
        if (!c) return false;
        const T = this.types[c.ti];
        c.state = 1; this.nDrive++;
        c.road = road; c.dir = dir; c.lane = lane; c.off = off; c.t = t; c.x = cx; c.z = cz; c.y = GameCity.base + T.hy;
        c.heading = Rd.yaw + (dir < 0 ? Math.PI : 0); c.fx = Math.cos(c.heading); c.fz = Math.sin(c.heading);
        c.vmax = (this.SPEED_MIN + Math.random() * this.SPEED_VAR) * (T.long ? 0.82 : 1) * (T.id === 'sports' ? 1.25 : 1);
        c.speed = c.vmax * 0.8;
        this._seekJ(c, false);
        this._paint(c, T, Math.floor(Math.random() * 256));
        this._color(c); this._matYaw(c);
        return true;
    },

    // Точка в кадре камеры? (грубо: перед камерой и в угле обзора)
    _seen(x, z) {
        const app = this.app;
        if (!app || !app.camera) return false;
        const p = this.view.camera.position, az = app.camera.azimuth, fx = Math.cos(az), fz = Math.sin(az);
        const dx = x - p.x, dz = z - p.z, f = dx * fx + dz * fz;
        return f > -60 && Math.abs(-dx * fz + dz * fx) < f * 1.05 + 160;
    },

    // ---------------------------------------------------------------------------------------------
    // Матрицы и цвет
    // ---------------------------------------------------------------------------------------------

    _quatYaw(c) { const a = -c.heading * 0.5; c.qx = 0; c.qy = Math.sin(a); c.qz = 0; c.qw = Math.cos(a); },

    // Машина на колёсах: только курс.
    _matYaw(c) {
        const T = this.types[c.ti], M = T.M, o = c.inst * 16, cs = c.fx, sn = c.fz;
        const sx = T.sx * c.wide, sy = T.sy * c.squash, sz = T.sz * c.wide, ox = T.ox * sx, oz = T.oz * sz;
        M[o] = cs * sx; M[o + 1] = 0; M[o + 2] = sn * sx; M[o + 3] = 0;
        M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
        M[o + 8] = -sn * sz; M[o + 9] = 0; M[o + 10] = cs * sz; M[o + 11] = 0;
        M[o + 12] = c.x - (cs * ox - sn * oz); M[o + 13] = c.y - c.bhy + this.LIFT - T.oy * sy; M[o + 14] = c.z - (sn * ox + cs * oz); M[o + 15] = 1;
        T.dirtyM = true;
    },

    // Машина-тело: полный поворот; низ модели — на нижней грани коробки тела.
    _matQuat(c) {
        const T = this.types[c.ti], M = T.M, o = c.inst * 16, qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
        const sx = T.sx * c.wide, sy = T.sy * c.squash, sz = T.sz * c.wide;
        const x0 = 1 - 2 * (qy * qy + qz * qz), x1 = 2 * (qx * qy + qz * qw), x2 = 2 * (qz * qx - qy * qw);
        const y0 = 2 * (qx * qy - qz * qw), y1 = 1 - 2 * (qz * qz + qx * qx), y2 = 2 * (qy * qz + qx * qw);
        const z0 = 2 * (qz * qx + qy * qw), z1 = 2 * (qy * qz - qx * qw), z2 = 1 - 2 * (qy * qy + qx * qx);
        const ox = T.ox * sx, oy = c.bhy + T.oy * sy, oz = T.oz * sz;
        M[o] = x0 * sx; M[o + 1] = x1 * sx; M[o + 2] = x2 * sx; M[o + 3] = 0;
        M[o + 4] = y0 * sy; M[o + 5] = y1 * sy; M[o + 6] = y2 * sy; M[o + 7] = 0;
        M[o + 8] = z0 * sz; M[o + 9] = z1 * sz; M[o + 10] = z2 * sz; M[o + 11] = 0;
        M[o + 12] = c.x - (x0 * ox + y0 * oy + z0 * oz); M[o + 13] = c.y - (x1 * ox + y1 * oy + z1 * oz) + this.LIFT * y1; M[o + 14] = c.z - (x2 * ox + y2 * oy + z2 * oz); M[o + 15] = 1;
        T.dirtyM = true;
    },

    _color(c) {
        const T = this.types[c.ti], o = c.inst * 4, k = c.burn;
        T.CP[o] = c.pr * k; T.CP[o + 1] = c.pg * k; T.CP[o + 2] = c.pb * k; T.CP[o + 3] = 1;
        T.CR[o] = k; T.CR[o + 1] = k; T.CR[o + 2] = k; T.CR[o + 3] = 1;
        T.dirtyC = true;
    },

    /** Отправить изменённые буферы в видеокарту — раз в кадр. */
    flush() {
        for (const T of this.types) {
            if (!T.dirtyM && !T.dirtyC) continue;
            for (let k = 0; k < 2; k++) {
                const m = k ? T.meshR : T.meshP;
                if (!m) continue;
                if (T.dirtyM) { m.thinInstanceCount = T.n; m.thinInstanceBufferUpdated('matrix'); }
                if (T.dirtyC) m.thinInstanceBufferUpdated('color');
            }
            T.dirtyM = T.dirtyC = false;
        }
    },

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    update(dt, K) {
        this.K = K;
        if (!this.cars.length) return;
        this.time += dt; this.sfxT -= dt; this.fxT -= dt;
        const cars = this.cars, G = this.GCELL, gw = this.gw, gh = this.gh, head = this.ghead, next = this.gnext;
        const play = typeof GameArmy !== 'undefined' && GameArmy.active && K.alive;
        const R = this.radius(), phys = GamePhysics.ready && !!GamePhysics.world;
        if (phys && this._world !== GamePhysics.world) { for (const c of cars) c.body = -1; this.nBody = 0; this._world = GamePhysics.world; }

        // --- пересадка: новые едущие и клетки парковки ---
        for (let k = 0; k < 3 && this.nDrive < this.driveCap; k++) this._spawnDrive(K.x, K.z, R, false);
        const P = this.PCELL, n = Math.ceil(R / P) + 1, side = n * 2 + 1;
        for (let k = 0; k < 3; k++) {
            const s = this.scan++ % (side * side);
            this._parkCell(Math.floor(K.x / P) - n + s % side, Math.floor(K.z / P) - n + Math.floor(s / side), K.x, K.z, R);
        }
        // --- обход части пула: уход далёких, тела рядом с кайдзю ---
        const zone = Math.max(700, K.height * 2 + 450);
        for (let k = 0; k < 48; k++) {
            const c = cars[this.sweep++ % cars.length];
            if (!c.state) continue;
            const dk = Math.hypot(c.x - K.x, c.z - K.z);
            if (c.state === 1) { if (dk > R + 500) this._release(c); continue; }
            if (c.state !== 2) continue;
            if (!c.moved) { if (dk > R + 1300) { this._release(c); continue; } }
            else if (dk > R + 2600 || (this.nWreck > this.wreckCap && dk > 1000 + K.height) || (this.nFree < 6 && dk > 700 + K.height)) { this._release(c); continue; }
            if (c.body < 0) { if (phys && play && dk < zone && this.nBody < this.bodyCap - 12) this._body(c, false); }
            else if (dk > zone * 1.25 || !play) this._unbody(c);
        }

        // --- сетка машин ---
        head.fill(-1);
        let nAwake = 0, nWreck = 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state) continue;
            const k = Math.max(0, Math.min(gh - 1, Math.floor(c.z / G))) * gw + Math.max(0, Math.min(gw - 1, Math.floor(c.x / G)));
            next[i] = head[k]; head[k] = i;
            if (c.state === 3) nAwake++;
            if (c.moved) nWreck++;
        }
        this.nAwake = nAwake; this.nWreck = nWreck;

        // --- машины ---
        const panicR = play ? K.height * 1.6 + 260 : 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state) continue;
            if (c.kickT > 0) c.kickT -= dt;
            if (c.state === 1) this._drive(c, dt, K, panicR);
            else if (c.state === 3) this._dyn(c, dt, K);
            else if (c.body >= 0 && !GamePhysics.asleep(c.body)) { c.state = 3; c.age = 0; c.sleepT = 0; this._disturb(c); GamePhysics.read(c.body, this._p7); c.px = this._p7[0]; c.py = this._p7[1]; c.pz = this._p7[2]; }
            if (c.fuse > 0 && c.state) { c.fuse -= dt; if (c.fuse <= 0) this._explode(c); }
        }
        this.flush();
    },

    // --- Едущая машина ---------------------------------------------------------------------------
    _seekJ(c, skipZone) {
        const J = this.net[c.road].juncs;
        let j;
        if (c.dir > 0) { j = 0; while (j < J.length && J[j].t - c.t <= (skipZone ? J[j].half + 10 : 0)) j++; }
        else { j = J.length - 1; while (j >= 0 && c.t - J[j].t <= (skipZone ? J[j].half + 10 : 0)) j--; }
        c.nj = j; c.jdone = false;
    },

    _drive(c, dt, K, panicR) {
        const T = this.types[c.ti];
        let R = this.net[c.road];
        const d = c.dir;
        if (c.panic > 0) c.panic -= dt;
        if (c.uturnCd > 0) c.uturnCd -= dt;
        if (c.ghost > 0) c.ghost -= dt;
        let limit = c.vmax * (c.panic > 0 ? 1.9 : 1), gap = 1e9, ov = 0, block = 0;      // block: 1 свет или пешеход, 2 едущая машина, 3 преграда

        // --- кайдзю: паника ---
        const kx = K.x - c.x, kz = K.z - c.z, dk = Math.hypot(kx, kz);
        if (dk < panicR) {
            c.panic = 3;
            const ahead = kx * c.fx + kz * c.fz;
            if (ahead > 0 && dk < panicR * 0.85) {
                if (c.mode === 0 && c.uturnCd <= 0) this._uturn(c);
                else if (dk < K.radius() + 110 + T.hl) limit = 0;
            }
        } else if (dk < K.radius() + 60 + T.hl && kx * c.fx + kz * c.fz > 0) limit = 0;   // кайдзю стоит на дороге (меню)

        if (c.mode === 0) {
            // --- перекрёсток впереди: красный свет, выбор пути ---
            const J = c.nj >= 0 && c.nj < R.juncs.length ? R.juncs[c.nj] : null;
            if (J) {
                if ((J.t - c.t) * d <= 0) { c.nj += d; c.jdone = false; }
                else if (!c.jdone) {
                    const ds = (J.t - d * (J.half + 8) - c.t) * d - T.hl;
                    if (ds <= 0) { c.jdone = true; if (ds > -16) this._decide(c, R, J); }
                    else if (c.panic <= 0 && ds < 150 && this.greenLeft(J) <= 0) { gap = ds; block = 1; }
                }
            }
            // --- конец дороги: продолжение или разворот ---
            if (c.mode === 0 && !c.turn && R.len / 2 - c.t * d < T.hl + 12) {
                const ct = R.cont[d > 0 ? 1 : 0];
                if (ct) {
                    const B = this.net[ct.b];
                    c.road = ct.b; c.t = ct.t; c.dir = ct.dir; c.lane = Math.min(c.lane, B.lanes.length - 1);
                    c.off = Math.sign(c.off || 1) * Math.abs(c.off) * (ct.dir === d ? 1 : -1);
                    R = B;
                    this._seekJ(c, true);
                } else this._uturn(c);
            }
            // --- начало дуги поворота ---
            if (c.mode === 0 && c.turn && (c.te - c.t) * c.dir <= 0) {
                c.mode = 1; c.u = 0; c.ax = c.x; c.az = c.z;
                c.len = (Math.hypot(c.cx - c.ax, c.cz - c.az) + Math.hypot(c.ex - c.cx, c.ez - c.cz)) * 0.9 + 1;
            }
        }
        if (c.mode) limit = Math.min(limit, c.mode === 2 ? 60 : 78);

        // --- помехи впереди: машины, остовы, пешеходы, завал ---
        const D = 30 + c.speed * 0.9 + T.hl;
        const g = this._ahead(c, T, D), oc = this._oc;
        if (g < gap && oc) {
            gap = g; block = oc.state === 1 ? (oc.held ? 1 : 2) : 3;
            ov = oc.state === 1 ? Math.max(0, oc.speed * (c.fx * oc.fx + c.fz * oc.fz)) : 0;
            if (c.panic > 0 && g < 1.5 && c.speed - ov > 70) { this._crash(c, oc); return; }
        }
        // @ts-ignore — GameCrowd объявляет js/GameCrowd.js
        const crowd = typeof GameCrowd !== 'undefined' ? GameCrowd : null;
        if (crowd && crowd.roadN && c.panic <= 0) {
            const px = crowd.roadX, pz = crowd.roadZ;
            for (let k = 0; k < crowd.roadN; k++) {
                const rx = px[k] - c.x, rz = pz[k] - c.z, f = rx * c.fx + rz * c.fz;
                if (f <= 0 || f > D || Math.abs(rz * c.fx - rx * c.fz) > T.hw + 6) continue;
                if (f - T.hl - 4 < gap) { gap = f - T.hl - 4; ov = 0; block = 1; }
            }
        }
        if ((c.pileT -= dt) <= 0) {
            c.pileT = 0.3;
            const ax = c.x + c.fx * (T.hl + 34), az = c.z + c.fz * (T.hl + 34);
            c.pile = (typeof GameDebris.pileAt === 'function' && GameDebris.pileAt(ax, az) > 9) || GameCity.heightAt(ax, az) > GameCity.base + 1;
        }
        if (c.pile && gap > 20) { gap = 20; ov = 0; block = 3; }

        // --- скорость ---
        const want = gap < 4 ? 0 : Math.min(limit, ov + (gap - 4) * 1.8);
        if (want > c.speed) c.speed = Math.min(want, c.speed + (c.panic > 0 ? 170 : 75) * dt);
        else c.speed = Math.max(want, c.speed - 300 * dt);
        c.held = block === 1 && gap < 30;
        if (c.speed < 3 && limit > 0 && gap < 14) {
            // преграда (остов, завал) — разворот; затор из едущих — через несколько секунд машина протискивается
            if (block === 3) { if ((c.stuck += dt) > (c.panic > 0 ? 1 : 2.5) && c.mode === 0) { c.stuck = 0; this._uturn(c); } }
            else if (block === 2 && (c.jam += dt) > 3 + (c.i % 5) * 0.8) { c.jam = 0; c.ghost = 2.2; }
        } else { c.stuck = 0; c.jam = 0; }

        // --- движение ---
        let hx, hz;
        if (c.mode === 0) {
            c.t += d * c.speed * dt;
            const tgt = c.dir * R.lanes[c.lane], dl = tgt - c.off, st = Math.max(-26 * dt, Math.min(26 * dt, dl));
            c.off += st;
            c.x = R.x + R.c * c.t - R.s * c.off; c.z = R.z + R.s * c.t + R.c * c.off;
            const k = c.speed > 5 ? st / (c.speed * dt + 1e-3) * c.dir : 0;
            hx = c.dir * R.c - R.s * k * c.dir; hz = c.dir * R.s + R.c * k * c.dir;
        } else {
            c.u = Math.min(1, c.u + c.speed * dt / c.len);
            const u = c.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), e = u * u;
            c.x = a * c.ax + b * c.cx + e * c.ex; c.z = a * c.az + b * c.cz + e * c.ez;
            hx = (1 - u) * (c.cx - c.ax) + u * (c.ex - c.cx); hz = (1 - u) * (c.cz - c.az) + u * (c.ez - c.cz);
            if (u >= 1) {
                const B = this.net[c.tb];
                c.road = c.tb; c.dir = c.tdir; c.lane = c.tlane; c.off = c.tdir * B.lanes[c.tlane]; c.t = c.tt; c.mode = 0; c.turn = 0;
                this._seekJ(c, true);
                hx = c.dir * B.c; hz = c.dir * B.s;
            }
        }
        // курс — плавно к направлению пути
        const hl = Math.hypot(hx, hz) || 1, k = Math.min(1, dt * 9);
        c.fx += (hx / hl - c.fx) * k; c.fz += (hz / hl - c.fz) * k;
        const fl = Math.hypot(c.fx, c.fz) || 1;
        c.fx /= fl; c.fz /= fl;
        this._matYaw(c);
    },

    // Перекрёсток: прямо, направо или налево.
    _decide(c, R, J) {
        const B = this.net[J.b], d = c.dir, opt = this._opt;
        let n = 0, w = 0;
        if (R.len / 2 - J.t * d > J.half + 60 || R.cont[d > 0 ? 1 : 0]) { opt[n++] = 0; w += 5; }
        const wb = B.ave ? 3 : 2;
        if (B.len / 2 - J.tb > R.wid / 2 + 90) { opt[n++] = 1; w += wb; }
        if (B.len / 2 + J.tb > R.wid / 2 + 90) { opt[n++] = -1; w += wb; }
        if (!n) { this._uturn(c); return; }
        let r = Math.random() * w, e = opt[n - 1];
        for (let k = 0; k < n; k++) { r -= opt[k] === 0 ? 5 : wb; if (r <= 0) { e = opt[k]; break; } }
        if (!e) return;
        // дуга: от полосы A до полосы B через точку пересечения полос
        const right = d * R.c * e * B.s - d * R.s * e * B.c > 0, lane = right ? B.lanes.length - 1 : 0, offB = e * B.lanes[lane];
        const qax = R.x - R.s * c.off, qaz = R.z + R.c * c.off, qbx = B.x - B.s * offB, qbz = B.z + B.c * offB;
        const cr = R.c * B.s - R.s * B.c, dx = qbx - qax, dz = qbz - qaz;
        const ua = (dx * B.s - dz * B.c) / cr, ub = (dx * R.s - dz * R.c) / cr, rad = right ? this.TURN_R : this.TURN_L;
        let te = ua - d * rad;
        if ((te - c.t) * d < 0) te = c.t;
        c.turn = 1; c.te = te; c.tb = J.b; c.tdir = e; c.tlane = lane; c.tt = ub + e * rad;
        c.cx = qax + R.c * ua; c.cz = qaz + R.s * ua;
        c.ex = qbx + B.c * c.tt; c.ez = qbz + B.s * c.tt;
    },

    // Разворот на встречную полосу той же дороги.
    _uturn(c) {
        if (c.mode !== 0) return;
        const R = this.net[c.road], off = -c.dir * R.lanes[0];
        c.mode = 2; c.turn = 1; c.u = 0; c.uturnCd = 4; c.stuck = 0;
        c.tb = c.road; c.tdir = -c.dir; c.tlane = 0; c.tt = c.t;
        c.ax = c.x; c.az = c.z;
        c.ex = R.x + R.c * c.t - R.s * off; c.ez = R.z + R.s * c.t + R.c * off;
        c.cx = (c.ax + c.ex) / 2 + c.fx * 38; c.cz = (c.az + c.ez) / 2 + c.fz * 38;
        c.len = Math.hypot(c.cx - c.ax, c.cz - c.az) + Math.hypot(c.ex - c.cx, c.ez - c.cz);
    },

    // Ближайшая помеха в полосе движения на дальности D: зазор до неё (px); сама машина — в this._oc.
    _ahead(c, T, D) {
        const G = this.GCELL, gw = this.gw, gh = this.gh, head = this.ghead, next = this.gnext, cars = this.cars, types = this.types;
        const fx = c.fx, fz = c.fz, x1 = c.x + fx * D, z1 = c.z + fz * D;
        const i0 = Math.max(0, Math.floor((Math.min(c.x, x1) - 50) / G)), i1 = Math.min(gw - 1, Math.floor((Math.max(c.x, x1) + 50) / G));
        const j0 = Math.max(0, Math.floor((Math.min(c.z, z1) - 50) / G)), j1 = Math.min(gh - 1, Math.floor((Math.max(c.z, z1) + 50) / G));
        let best = 1e9;
        this._oc = null;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = head[j * gw + i]; k >= 0; k = next[k]) {
            const o = cars[k];
            if (o === c || (o.state === 2 && !o.moved)) continue;
            const rx = o.x - c.x, rz = o.z - c.z, f = rx * fx + rz * fz;
            if (f <= 0 || f > D + 70) continue;
            const To = types[o.ti];
            let cs = 0.72, sn = 0.72;
            if (o.state === 1) {
                const dot = fx * o.fx + fz * o.fz;
                if (dot < 0.7 && c.ghost > 0) continue;                    // протискивается сквозь затор
                cs = Math.abs(dot); sn = Math.sqrt(Math.max(0, 1 - cs * cs));
            } else if (o.y - o.bhy > GameCity.base + 30) continue;         // летит выше крыши
            if (Math.abs(rz * fx - rx * fz) > T.hw + To.hw * cs + To.hl * sn + 2) continue;
            const g = f - T.hl - To.hl * cs - To.hw * sn;
            if (g < best) { best = g; this._oc = o; }
        }
        return best;
    },

    // Авария двух машин: обе — тела со своими скоростями.
    _crash(a, b) {
        const va = a.speed, r = Math.random;
        this._hurt(a, va * 0.07); this._hurt(b, va * 0.07);
        const jx = -a.fz * (r() - 0.5) * 90, jz = a.fx * (r() - 0.5) * 90;
        if (b.state === 1) this._kick(b, a.fx * va * 0.35 - b.fx * b.speed * 0.3 - jx, 30 + r() * 50, a.fz * va * 0.35 - b.fz * b.speed * 0.3 - jz, 0.5);
        else if (b.state === 2) this._kick(b, a.fx * va * 0.4, 30 + r() * 40, a.fz * va * 0.4, 0.4);
        this._kick(a, -a.fx * va * 0.45 + jx, 40 + r() * 70, -a.fz * va * 0.45 + jz, 0.6);
        this._impactFx(a, va * 1.4);
    },

    // ---------------------------------------------------------------------------------------------
    // Тела физики
    // ---------------------------------------------------------------------------------------------

    // Дать машине тело (awake — сразу живое). false — физики нет или бюджет исчерпан.
    _body(c, awake) {
        if (c.body >= 0) return true;
        if (!GamePhysics.ready || !GamePhysics.world) return false;
        if (awake && this.nAwake >= this.awakeCap) return false;
        if (this.nBody >= this.bodyCap && !this._evict()) return false;
        const T = this.types[c.ti], o = this._opts;
        let vx = 0, vz = 0;
        if (c.state === 1) { vx = c.fx * c.speed; vz = c.fz * c.speed; c.heading = Math.atan2(c.fz, c.fx); this._quatYaw(c); c.y = GameCity.base + T.hy; }
        c.bhy = T.hy * (c.flat ? c.squash : 1);
        o.q[0] = c.qx; o.q[1] = c.qy; o.q[2] = c.qz; o.q[3] = c.qw;
        o.vx = vx; o.vy = 0; o.vz = vz; o.wx = o.wy = o.wz = 0; o.density = this.DENSITY;
        o.member = GamePhysics.G_VEHICLE; o.filter = GamePhysics.G_ALL;
        const id = GamePhysics.addBox(c.x, c.y, c.z, T.hl * c.wide, c.bhy, T.hw * c.wide, o);
        if (id < 0) return false;
        this._world = GamePhysics.world;
        c.body = id; this.nBody++;
        c.px = c.x; c.py = c.y; c.pz = c.z; c.vx = vx; c.vy = 0; c.vz = vz;
        if (!awake) { const b = GamePhysics.body(id); if (b && b.sleep) b.sleep(); }
        return true;
    },

    _unbody(c) {
        if (c.body < 0) return;
        if (GamePhysics.world && GamePhysics.world === this._world) GamePhysics.remove(c.body);
        c.body = -1; this.nBody--;
    },

    // Бюджет тел исчерпан: снять тело с самого дальнего спящего остова.
    _evict() {
        const K = this.K;
        let best = null, bd = -1;
        for (const c of this.cars) {
            if (c.state !== 2 || c.body < 0) continue;
            const d = K ? Math.abs(c.x - K.x) + Math.abs(c.z - K.z) : 0;
            if (d > bd) { bd = d; best = c; }
        }
        if (!best) return false;
        this._unbody(best);
        return true;
    },

    // Машину сдвинули с места: парковочное место больше не её.
    _disturb(c) {
        if (c.state === 1) this.nDrive--;
        else if (!c.moved) this.nPark--;
        c.moved = true;
        if (c.slot >= 0) { this.slotCar[c.slot] = -1; this.slotGone[c.slot] = 1; c.slot = -1; }
    },

    /** Толчок: машине прибавляется скорость (px/с); spin 0..1 — закрутка. Машина становится телом. */
    _kick(c, vx, vy, vz, spin) {
        if (!c.state) return;
        const was = c.state;
        if (was !== 3) {
            if (!this._body(c, true)) { this._flatten(c, false); return; }
            this._disturb(c);
            c.state = 3; c.age = 0; c.sleepT = 0; this.nAwake++;
        }
        GamePhysics.wake(c.body);
        GamePhysics.push(c.body, vx, vy, vz);
        const s = spin == null ? 1 : spin, r = Math.random;
        if (s > 0) GamePhysics.spin(c.body, (r() - 0.5) * 10 * s, (r() - 0.5) * 6 * s, (r() - 0.5) * 10 * s);
        c.kickT = 0.3;
    },

    _sfx(name, c, vol) {
        const K = this.K, d = K ? Math.hypot(c.x - K.x, c.z - K.z) : 0, k = Math.max(0, 1 - d / (1800 + (K ? K.height * 2 : 0)));
        if (k > 0.05) SFX(name, { volume: vol * k, rate: 0.9 + Math.random() * 0.25 });
    },

    _impactFx(c, dv) {
        if (this.sfxT <= 0) { this.sfxT = 0.09; this._sfx('car_crush', c, Math.min(0.9, 0.25 + dv * 0.0015)); }
        if (this.fxT <= 0) {
            this.fxT = 0.05;
            FX('sparks', c.x, c.y, c.z, Math.min(14, 3 + Math.round(dv * 0.02)), 0xffd27a);
            if (dv > 220) FX('impactPuff', c.x, c.y - c.bhy, c.z, this.types[c.ti].hl * 1.6, 0x8a8f96);
            // @ts-ignore — GameFX объявляет js/GameFX.js
            if (typeof GameFX === 'undefined' || typeof GameFX.sparks !== 'function') FX('unitHit', c.x, c.y, c.z);
        }
    },

    // --- Машина-тело: каждый кадр -----------------------------------------------------------------
    _dyn(c, dt, K) {
        const p = this._p7, T = this.types[c.ti], base = GameCity.base;
        if (c.body < 0 || !GamePhysics.read(c.body, p)) { c.state = 2; return; }
        c.age += dt;
        const ivt = 1 / Math.max(dt, 1e-3);
        const vx = (p[0] - c.px) * ivt, vy = (p[1] - c.py) * ivt, vz = (p[2] - c.pz) * ivt;
        const dv = Math.hypot(vx - c.vx, vy - c.vy + KR.GRAVITY * dt, vz - c.vz);
        c.x = p[0]; c.y = p[1]; c.z = p[2]; c.qx = p[3]; c.qy = p[4]; c.qz = p[5]; c.qw = p[6];
        const speed = Math.hypot(vx, vy, vz);
        // удар: скорость резко изменилась
        if (dv > 150 && c.age > 0.12 && c.kickT <= 0.18) {
            this._impactFx(c, dv);
            this._hurt(c, dv * 0.035);
            if (!c.flat) { c.squash = Math.max(0.62, c.squash - dv * 0.0005); c.burn = Math.max(0.5, c.burn - dv * 0.0004); this._color(c); }
        }
        // за картой, под землёй, в воде
        if (c.y < base - 300 || c.x < -400 || c.z < -400 || c.x > GameCity.mapW + 400 || c.z > GameCity.mapH + 400) { this._release(c); return; }
        if (c.y < base + T.hy + 6) {
            const w = /** @type {LoryApp} */ (this.app).location.waterAt(c.x, c.z);
            if (w != null && c.y < w + 4) { FX('waterSplash', c.x, w, c.z, T.hl * 1.5); this._sfx('splash', c, 0.6); this._release(c); return; }
        }
        // влетела в дом на скорости: урон кирпичам; пока у домов нет своих коллайдеров — отскок вручную
        if (c.hitT > 0) c.hitT -= dt;
        if (speed > 110 && c.hitT <= 0) {
            const k = (T.hl + 5) / speed, px = c.x + vx * k, pz = c.z + vz * k;
            if (GameCity.heightAt(px, pz) > c.y - c.bhy * 0.4) {
                c.hitT = 0.2;
                const dir = this._dir;
                dir.x = vx / speed; dir.y = 0.2; dir.z = vz / speed;
                GameCity.hitSphere(px, c.y, pz, T.rad * 0.85, speed * 0.07 * T.massK, dir, speed * 0.5);
                this._impactFx(c, speed);
                this._hurt(c, speed * 0.03);
                if (GameCity.heightAt(c.x, c.z) > c.y) {
                    const b = GamePhysics.body(c.body), v = this._v;
                    if (b) { v.x = c.px; v.y = c.py; v.z = c.pz; b.setTranslation(v, true); v.x = -vx * 0.3; v.y = vy * 0.4 + 40; v.z = -vz * 0.3; b.setLinvel(v, true); c.x = c.px; c.z = c.pz; }
                }
            }
        }
        // ноги кайдзю: не лежать внутри
        const kx = c.x - K.x, kz = c.z - K.z, kd = Math.hypot(kx, kz), rr = K.radius() * 0.85;
        if (kd < rr && c.y < K.y + K.height * 0.4 && c.kickT <= 0) { const f = (rr - kd) * 6 + 60; GamePhysics.push(c.body, kx / (kd || 1) * f, 30, kz / (kd || 1) * f); c.kickT = 0.12; }
        // летящая машина сбивает людей
        // @ts-ignore — GameCrowd объявляет js/GameCrowd.js
        if (speed > 130 && (c.bowlT -= dt) <= 0 && typeof GameCrowd !== 'undefined') { c.bowlT = 0.12; GameCrowd.hitSphere(c.x, c.y, c.z, T.rad * 0.8, 1); }
        // соседи без тела: разбудить, чтобы столкновение было настоящим
        if (speed > 40) this._touch(c, T, speed * dt * 2 + 8, vx, vz);
        c.px = c.x; c.py = c.y; c.pz = c.z; c.vx = vx; c.vy = vy; c.vz = vz;
        this._matQuat(c);
        // уснула — остов
        if (GamePhysics.asleep(c.body) || (speed < 3 && (c.sleepT += dt) > 1.2)) {
            c.state = 2; c.sleepT = 0;
            if (c.dead && !c.burnt && this.fxT <= 0 && Math.random() < 0.3) { this.fxT = 0.1; FX('smokeColumn', c.x, c.y, c.z, 6 + Math.random() * 6, T.hl); }
        } else if (speed >= 3) c.sleepT = 0;
    },

    // Рядом с летящей машиной: едущие — в аварию, стоящим — спящее тело.
    _touch(c, T, reach, vx, vz) {
        const G = this.GCELL, gw = this.gw, gh = this.gh, head = this.ghead, next = this.gnext, cars = this.cars, types = this.types;
        const i0 = Math.max(0, Math.floor((c.x - 110) / G)), i1 = Math.min(gw - 1, Math.floor((c.x + 110) / G));
        const j0 = Math.max(0, Math.floor((c.z - 110) / G)), j1 = Math.min(gh - 1, Math.floor((c.z + 110) / G));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = head[j * gw + i]; k >= 0; k = next[k]) {
            const o = cars[k];
            if (o === c || o.state === 3 || o.body >= 0 || !o.state) continue;
            const r = T.rad + types[o.ti].rad * 0.8 + reach;
            if (Math.abs(o.x - c.x) > r || Math.abs(o.z - c.z) > r || c.y - c.bhy > GameCity.base + types[o.ti].info.h + 14) continue;
            if (o.state === 1) this._kick(o, vx * 0.3, 20, vz * 0.3, 0.3);
            else this._body(o, false);
        }
    },

    // ---------------------------------------------------------------------------------------------
    // Урон
    // ---------------------------------------------------------------------------------------------

    _hurt(c, dmg) {
        c.hp -= dmg;
        if (c.hp <= 0 && !c.dead) this._die(c);
    },

    // Машина подбита: очки, вид побитой, шанс загореться.
    _die(c) {
        if (c.dead) return;
        const T = this.types[c.ti], info = T.info;
        c.dead = true; this.kills++;
        c.burn = Math.min(c.burn, 0.66); if (!c.flat) c.squash = Math.min(c.squash, 0.9);
        this._color(c);
        if (c.state === 2 && !c.moved) this._disturb(c);
        if (info.blast) c.fuse = 0.2 + Math.random() * 0.5;
        else if (Math.random() < this.FIRE_CHANCE) c.fuse = 1 + Math.random() * 2.6;
        if (c.fuse > 0 && c.state !== 3) FX('fire', c.x, c.y, c.z, T.hl * 0.9, c.fuse + 0.4);
        if (this.hooks.score) this.hooks.score(info.score, c.x, c.y, c.z, 'car', Math.max(1, Math.round(info.score * this.SCORE_COINS)));
    },

    // Раздавлена в лепёшку: лежит плоским остовом (тело — плоская спящая коробка, если есть место).
    _flatten(c, boom) {
        if (!c.state) return;
        const T = this.types[c.ti];
        if (c.state === 3) { c.heading = Math.atan2(2 * (c.qz * c.qx - c.qy * c.qw), 1 - 2 * (c.qy * c.qy + c.qz * c.qz)); }
        else if (c.state === 1) c.heading = Math.atan2(c.fz, c.fx);
        this._disturb(c);
        this._unbody(c);
        const was = c.flat;
        c.flat = true; c.state = 2; c.speed = 0;
        if (!was) { c.squash = 0.26 + Math.random() * 0.12; c.wide = 1.12; }
        c.burn = Math.min(c.burn, 0.55);
        c.bhy = T.hy * c.squash; c.y = GameCity.base + c.bhy;
        c.fx = Math.cos(c.heading); c.fz = Math.sin(c.heading);
        this._quatYaw(c);
        if (!c.dead) this._die(c); else this._color(c);
        if (T.info.blast && !c.burnt) c.fuse = 0.05; else if (boom && !c.burnt && c.fuse <= 0 && Math.random() < 0.1) c.fuse = 0.5 + Math.random();
        this._matQuat(c);
        if (!was) {
            if (this.sfxT <= 0) { this.sfxT = 0.09; this._sfx('car_crush', c, 0.8); this._sfx('glass', c, 0.5); }
            FX('impactPuff', c.x, GameCity.base + 3, c.z, T.hl * 1.8, 0x9aa0a8);
            FX('glassBurst', c.x, c.y + 4, c.z, 0, 0, 8);
            // @ts-ignore — GameFX объявляет js/GameFX.js
            if (typeof GameFX === 'undefined' || typeof GameFX.impactPuff !== 'function') FX('dustLand', c.x, GameCity.base, c.z, T.hl);
        }
    },

    // Взрыв машины: волна бьёт соседей, дома и людей; остов подбрасывает.
    _explode(c) {
        const T = this.types[c.ti], info = T.info, r = Math.random;
        c.fuse = 0;
        if (c.burnt) return;
        if (!c.dead) this._die(c);
        c.fuse = 0; c.burnt = true; c.burn = 0.2; if (!c.flat) c.squash = Math.min(c.squash, 0.78);
        this._color(c);
        const radius = info.blast ? info.blast * 0.85 : 60 + info.len * 0.5, dmg = info.blast ? 30 : 9;      // домам почти не вредит: рвёт машины, пропсы, людей
        this._boom = c;
        GameCity.explode(c.x, c.y, c.z, radius, dmg, !info.blast);
        this._boom = null;
        FX('carExplode', c.x, c.y, c.z, radius / 100);
        FX('smokeColumn', c.x, c.y, c.z, 8 + r() * 8, T.hl * 1.3);
        if (typeof GameDebris.shatterBox === 'function') GameDebris.shatterBox(c.x, c.y, c.z, T.info.len * 0.6, T.info.h * 0.6, T.info.wid * 0.6, -c.heading, 0x2c2f34, null, 260, info.blast ? 6 : 3, 0);
        // @ts-ignore — GameCrowd объявляет js/GameCrowd.js
        if (typeof GameCrowd !== 'undefined') GameCrowd.scare(c.x, c.z, radius * 3 + 200);
        if (!c.flat) this._kick(c, (r() - 0.5) * 160, 190 + r() * 170 + (info.blast ? 120 : 0), (r() - 0.5) * 160, 1);
        else this._matQuat(c);
    },

    /** Сфера удара (когти, хвост, волна): машины улетают. Возвращает число задетых. */
    hitSphere(x, y, z, r, dmg) {
        const K = this.K, cars = this.cars, types = this.types;
        let n = 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state) continue;
            const T = types[c.ti], dx = c.x - x, dy = c.y - y, dz = c.z - z, rr = r + T.rad * 0.7;
            if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
            n++;
            if (c.kickT > 0) continue;
            this._hurt(c, dmg);
            let nx = dx, nz = dz;
            const l = Math.hypot(nx, nz) || 1;
            nx /= l; nz /= l;
            if (K) { const kx = c.x - K.x, kz = c.z - K.z, kl = Math.hypot(kx, kz) || 1; nx += kx / kl * 0.9; nz += kz / kl * 0.9; }
            const nl = Math.hypot(nx, nz) || 1, p = Math.min(900, 300 + (K ? K.scale * 90 : 0) + r * 0.5) * (0.75 + Math.random() * 0.5) / Math.sqrt(T.massK);
            this._kick(c, nx / nl * p, p * (0.45 + Math.random() * 0.35), nz / nl * p, 1);
        }
        return n;
    },

    /** Луч (отрезок a → b толщиной r): машины горят и взрываются. */
    hitBeam(ax, ay, az, bx, by, bz, r, dmg) {
        const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1, l = Math.sqrt(l2), cars = this.cars, types = this.types;
        let n = 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state || c.burnt) continue;
            const T = types[c.ti], px = c.x - ax, py = c.y - ay, pz = c.z - az, t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / l2));
            const ox = px - dx * t, oy = py - dy * t, oz = pz - dz * t, rr = r + T.rad * 0.6;
            if (ox * ox + oy * oy + oz * oz > rr * rr) continue;
            n++;
            this._hurt(c, dmg * 2);
            if (c.dead && c.fuse <= 0) c.fuse = 0.15 + Math.random() * 0.7;
            if (c.kickT <= 0) this._kick(c, dx / l * 150, 70 + Math.random() * 60, dz / l * 150, 0.5);
        }
        return n;
    },

    /** Под ногой и корпусом кайдзю: под стопой машина — в лепёшку, по краю — отлетает пинком. */
    trample(x, z, r, dmg) {
        const K = this.K, cars = this.cars, types = this.types, base = GameCity.base;
        const step = K ? Math.abs(x - K.x) + Math.abs(z - K.z) > 2 : true, slow = !K || K.speed < 70;
        const ks = K ? K.speed : 0, kx = ks > 30 ? K.vx / ks : 0, kz = ks > 30 ? K.vz / ks : 0;
        let n = 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state || c.flat) continue;
            const T = types[c.ti], dx = c.x - x, dz = c.z - z, rr = r + T.rad * 0.55, d2 = dx * dx + dz * dz;
            if (d2 > rr * rr || c.y - c.bhy > base + 50 + r * 0.25) continue;
            n++;
            const d = Math.sqrt(d2) || 1;
            if ((step || slow) && d < r * 0.5 + 8) { this._flatten(c, true); continue; }
            if (c.kickT > 0) continue;
            this._hurt(c, dmg);
            let nx = dx / d + kx * 0.9, nz = dz / d + kz * 0.9;
            const nl = Math.hypot(nx, nz) || 1, p = (230 + ks * 0.75 + (K ? K.scale * 50 : 0)) * (0.7 + Math.random() * 0.5) / Math.sqrt(T.massK);
            nx /= nl; nz /= nl;
            this._kick(c, nx * p, p * (0.35 + Math.random() * 0.4), nz * p, 1);
        }
        return n;
    },

    /** Взрыв: машины в радиусе разлетаются от центра, получают урон. */
    blast(x, y, z, r, dmg) {
        const cars = this.cars, types = this.types;
        let n = 0;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state || c === this._boom) continue;
            const T = types[c.ti], dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
            if (d > r + T.rad * 0.5 || Math.abs(c.y - y) > r + 60) continue;
            n++;
            const f = Math.max(0.15, 1 - d / (r + T.rad * 0.5));
            if (dmg > 0) this._hurt(c, dmg * f);
            if (c.kickT > 0) continue;
            const p = (150 + 420 * f) / Math.sqrt(T.massK), l = d || 1;
            this._kick(c, dx / l * p, (120 + 330 * f) / Math.sqrt(T.massK), dz / l * p, 1);
        }
        return n;
    },

    /** Тяжёлая техника (танк, мех) идёт сквозь машины: расталкивает и давит. Зовёт GameArmy. */
    shove(x, z, r, vx, vz, heavy) {
        const cars = this.cars, types = this.types;
        for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (!c.state || c.kickT > 0 || c.flat) continue;
            const T = types[c.ti], dx = c.x - x, dz = c.z - z, rr = r + T.rad * 0.5;
            if (dx * dx + dz * dz > rr * rr || c.y - c.bhy > GameCity.base + 40) continue;
            const d = Math.hypot(dx, dz) || 1;
            if (heavy) this._hurt(c, 6);
            this._kick(c, dx / d * 90 + vx * 0.7, 30 + Math.random() * 40, dz / d * 90 + vz * 0.7, 0.4);
        }
    },
};
