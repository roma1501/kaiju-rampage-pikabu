// GameDebris.js — обломки.
//   RigidPool   — прежний лёгкий пул коробок без движка физики (SoA, удар о землю по углам). Обломки города им больше
//                 не пользуются; оставлен для GameArmy (тела подброшенных машин), пока их не перевели на GamePhysics.
//   GameDebris  — обломки зданий и пропсов: тела Rapier (GamePhysics), завалы, активные зоны коллайдеров.
// Координаты — Babylon: x, y (вверх), z (= y карты). Единицы — px мира.

class RigidPool {
    /** @param {number} cap */
    constructor(cap) {
        this.cap = cap;
        this.count = 0;
        const F = () => new Float32Array(cap);
        this.px = F(); this.py = F(); this.pz = F();
        this.vx = F(); this.vy = F(); this.vz = F();
        this.qx = F(); this.qy = F(); this.qz = F(); this.qw = F();
        this.wx = F(); this.wy = F(); this.wz = F();
        this.hx = F(); this.hy = F(); this.hz = F();
        this.cr = F(); this.cg = F(); this.cb = F();
        this.age = F(); this.rest = F(); this.life = F(); this.fade = F();
        this.state = new Uint8Array(cap);     // 1 — летит, 2 — спит, 3 — исчезает
        this.flags = new Uint8Array(cap);
        this.tag = new Int32Array(cap);       // владелец (здание, машина) — на усмотрение хозяина пула
        this.awake = 0;
        /** Высота опоры под точкой: (x, z, i) => y. */
        this.ground = (x, z, i) => 0;
        /** Удар о землю: (i, скорость удара) — хозяин может расколоть кусок (вернуть true — тело удалено). */
        this.onImpact = null;
        /** Тело уснуло / удалено — для сетки куч. */
        this.onSleep = null;
        this.onRemove = null;
        this.gravity = 420;
        this.restitution = 0.22;
        this.friction = 0.62;
    }

    /** Новое тело; -1 — пул полон. Кватернион — единичный, либо поворот вокруг вертикали yaw. */
    add(x, y, z, hx, hy, hz, vx, vy, vz, r, g, b, flags, yaw) {
        if (this.count >= this.cap) return -1;
        const i = this.count++;
        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
        const a = (yaw || 0) * 0.5;
        this.qx[i] = 0; this.qy[i] = Math.sin(a); this.qz[i] = 0; this.qw[i] = Math.cos(a);
        this.wx[i] = 0; this.wy[i] = 0; this.wz[i] = 0;
        this.hx[i] = hx; this.hy[i] = hy; this.hz[i] = hz;
        this.cr[i] = r; this.cg[i] = g; this.cb[i] = b;
        this.age[i] = 0; this.rest[i] = 0; this.life[i] = 12; this.fade[i] = 1;
        this.state[i] = 1; this.flags[i] = flags | 0; this.tag[i] = -1;
        return i;
    }

    /** Убрать тело: на его место встаёт последнее (индексы меняются!). */
    remove(i) {
        if (this.onRemove) this.onRemove(i);
        const j = --this.count;
        if (i === j) return;
        this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
        this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
        this.qx[i] = this.qx[j]; this.qy[i] = this.qy[j]; this.qz[i] = this.qz[j]; this.qw[i] = this.qw[j];
        this.wx[i] = this.wx[j]; this.wy[i] = this.wy[j]; this.wz[i] = this.wz[j];
        this.hx[i] = this.hx[j]; this.hy[i] = this.hy[j]; this.hz[i] = this.hz[j];
        this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j];
        this.age[i] = this.age[j]; this.rest[i] = this.rest[j]; this.life[i] = this.life[j]; this.fade[i] = this.fade[j];
        this.state[i] = this.state[j]; this.flags[i] = this.flags[j]; this.tag[i] = this.tag[j];
    }

    clear() { this.count = 0; this.awake = 0; }

    wake(i) { if (this.state[i] === 2) { if (this.onRemove) this.onRemove(i); this.state[i] = 1; this.rest[i] = 0; this.age[i] = 0; } }

    /** Шаг физики. dt — секунды (режется до 1/30, большой кадр — два подшага). */
    step(dt) {
        const n = dt > 1 / 28 ? 2 : 1, h = Math.min(dt, 1 / 14) / n;
        for (let s = 0; s < n; s++) this._step(h);
    }

    _step(dt) {
        const g = this.gravity * dt, e = this.restitution, mu = this.friction;
        let awake = 0;
        for (let i = this.count - 1; i >= 0; i--) {
            const st = this.state[i];
            if (st === 2) { this.age[i] += dt; if (this.age[i] > this.life[i]) { this.state[i] = 3; if (this.onRemove) this.onRemove(i); } continue; }
            if (st === 3) { this.fade[i] -= dt * 2.2; this.py[i] -= dt * 14; if (this.fade[i] <= 0) this.remove(i); continue; }
            awake++;
            this.age[i] += dt;
            let vx = this.vx[i], vy = this.vy[i] - g, vz = this.vz[i];
            let wx = this.wx[i], wy = this.wy[i], wz = this.wz[i];
            let x = this.px[i] + vx * dt, y = this.py[i] + vy * dt, z = this.pz[i] + vz * dt;
            // поворот: q += 0.5 * dt * (w ⊗ q)
            let qx = this.qx[i], qy = this.qy[i], qz = this.qz[i], qw = this.qw[i];
            const hd = 0.5 * dt;
            const nx = qx + hd * (wx * qw + wy * qz - wz * qy);
            const ny = qy + hd * (wy * qw + wz * qx - wx * qz);
            const nz = qz + hd * (wz * qw + wx * qy - wy * qx);
            const nw = qw - hd * (wx * qx + wy * qy + wz * qz);
            const il = 1 / (Math.hypot(nx, ny, nz, nw) || 1);
            qx = nx * il; qy = ny * il; qz = nz * il; qw = nw * il;
            // оси коробки в мире (строки матрицы Babylon)
            const hx = this.hx[i], hy = this.hy[i], hz = this.hz[i];
            const ax0 = 1 - 2 * (qy * qy + qz * qz), ax1 = 2 * (qx * qy + qz * qw), ax2 = 2 * (qz * qx - qy * qw);
            const ay0 = 2 * (qx * qy - qz * qw), ay1 = 1 - 2 * (qz * qz + qx * qx), ay2 = 2 * (qy * qz + qx * qw);
            const az0 = 2 * (qz * qx + qy * qw), az1 = 2 * (qy * qz - qx * qw), az2 = 1 - 2 * (qy * qy + qx * qx);
            const ex = ax1 * hx, ey = ay1 * hy, ez = az1 * hz;                 // вклад каждой оси в высоту угла
            const low = Math.abs(ex) + Math.abs(ey) + Math.abs(ez);
            const gy = this.ground(x, z, i);
            let hit = false;
            if (y - low < gy) {
                // точка контакта — среднее углов у земли (грань лежит — контакт в центре грани, без момента)
                const tol = gy + Math.min(hx, hy, hz) * 0.25 + 0.5;
                let cx = 0, cy = 0, cz = 0, k = 0;
                for (let c = 0; c < 8; c++) {
                    const sx = c & 1 ? 1 : -1, sy = c & 2 ? 1 : -1, sz = c & 4 ? 1 : -1;
                    const oy = sx * ex + sy * ey + sz * ez;
                    if (y + oy > tol) continue;
                    cx += sx * ax0 * hx + sy * ay0 * hy + sz * az0 * hz;
                    cy += oy;
                    cz += sx * ax2 * hx + sy * ay2 * hy + sz * az2 * hz;
                    k++;
                }
                if (k) {
                    hit = true;
                    const rx = cx / k, ry = cy / k, rz = cz / k;
                    const invI = 1 / (0.3 * (hx * hx + hy * hy + hz * hz) + 1e-3);
                    // скорость точки контакта: v + w × r
                    const pvx = vx + wy * rz - wz * ry, pvy = vy + wz * rx - wx * rz, pvz = vz + wx * ry - wy * rx;
                    if (pvy < 0) {
                        if (this.onImpact && -pvy > 90 && this.onImpact(i, -pvy)) continue;    // раскололся: тела i больше нет
                        const jn = -(1 + e) * pvy / (1 + invI * (rz * rz + rx * rx));
                        vy += jn;
                        wx += invI * jn * -rz; wz += invI * jn * rx;
                        const vt = Math.hypot(pvx, pvz);
                        if (vt > 1e-3) {
                            const tx = pvx / vt, tz = pvz / vt;
                            const cxx = ry * tz, cyy = rz * tx - rx * tz, czz = -ry * tx;   // r × t
                            const jt = Math.min(mu * jn, vt / (1 + invI * (cxx * cxx + cyy * cyy + czz * czz)));
                            vx -= jt * tx; vz -= jt * tz;
                            wx -= invI * jt * cxx; wy -= invI * jt * cyy; wz -= invI * jt * czz;
                        }
                    }
                    y += (gy - (y - low)) * 0.8;
                    const dr = Math.max(0, 1 - 3.2 * dt), dl = Math.max(0, 1 - 1.4 * dt);
                    wx *= dr; wy *= dr; wz *= dr; vx *= dl; vz *= dl;
                }
            }
            if (hit && vx * vx + vy * vy + vz * vz < 260 && wx * wx + wy * wy + wz * wz < 0.5) {
                this.rest[i] += dt;
                if (this.rest[i] > 0.32) { this.state[i] = 2; this.age[i] = 0; vx = vy = vz = wx = wy = wz = 0; if (this.onSleep) this.onSleep(i); }
            } else this.rest[i] = 0;
            this.px[i] = x; this.py[i] = y; this.pz[i] = z;
            this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
            this.wx[i] = wx; this.wy[i] = wy; this.wz[i] = wz;
            this.qx[i] = qx; this.qy[i] = qy; this.qz[i] = qz; this.qw[i] = qw;
        }
        this.awake = awake;
    }

    /** Матрица Babylon тела i в буфер out со смещения o (масштаб = размеры коробки × fade). */
    writeMatrix(i, out, o) {
        const qx = this.qx[i], qy = this.qy[i], qz = this.qz[i], qw = this.qw[i];
        const f = this.state[i] === 3 ? Math.max(0, this.fade[i]) : 1;
        const sx = this.hx[i] * 2 * f, sy = this.hy[i] * 2 * f, sz = this.hz[i] * 2 * f;
        out[o] = (1 - 2 * (qy * qy + qz * qz)) * sx; out[o + 1] = 2 * (qx * qy + qz * qw) * sx; out[o + 2] = 2 * (qz * qx - qy * qw) * sx; out[o + 3] = 0;
        out[o + 4] = 2 * (qx * qy - qz * qw) * sy; out[o + 5] = (1 - 2 * (qz * qz + qx * qx)) * sy; out[o + 6] = 2 * (qy * qz + qx * qw) * sy; out[o + 7] = 0;
        out[o + 8] = 2 * (qz * qx + qy * qw) * sz; out[o + 9] = 2 * (qy * qz - qx * qw) * sz; out[o + 10] = (1 - 2 * (qy * qy + qx * qx)) * sz; out[o + 11] = 0;
        out[o + 12] = this.px[i]; out[o + 13] = this.py[i]; out[o + 14] = this.pz[i]; out[o + 15] = 1;
    }
}

// Флаги тел
RigidPool.SHATTER = 1;    // крупный кусок: раскалывается при ударе
RigidPool.CRUSH = 2;      // кусок здания: опирается на уцелевшие этажи и давит их (GameCity)

// =====================================================================================================================
// GameDebris — обломки на Rapier (GamePhysics). Один меш-коробка с thin instances: матрица, цвет и два прямоугольника
// атласа фасадов на экземпляр (боковые грани / верх и низ), так что кусок стены летит со своими окнами.
//
// Состояния куска: 1 — ЖИВОЙ (есть тело Rapier: сталкивается со всем), 2 — ЛЕЖИТ (тела нет, матрица не меняется;
// в «активной зоне» рядом с живыми телами у него есть неподвижный коллайдер, чтобы на завал можно было падать),
// 3 — исчезает (утонул, вытеснен). Живых тел — не больше budget (low 250 / medium 600 / high 1200): кусок, который
// полсекунды почти не двигался, превращается в лежащий; удар, взрыв, шаг кайдзю будят лежащие обратно в тела.
//
// АКТИВНЫЕ ЗОНЫ — клетки мира 256 × 280 × 256 px вокруг неспящих тел. Пока зона жива, в ней стоят неподвижные
// коллайдеры: лежащих обломков (здесь) и целых кирпичей зданий (GameCity через onZoneOpen / onZoneClose). Зона, в
// которой больше секунды никого нет, закрывается, и коллайдеры убираются — мир физики не раздувается.

/** @satisfies {Record<string, any>} */
const GameDebris = {
    /** @type {any} */ pool: null,           // прежний RigidPool обломков не используется (поле оставлено для старого кода)
    /** @type {any} */ mesh: null,
    /** @type {any} */ view: null,
    /** @type {any} */ mat: null,
    mapW: 0, mapH: 0, base: 0,
    cap: 0, count: 0, live: 0, budget: 0, staticCap: 0, lifeScale: 1, frame: 0,
    dirtyM: false, dirtyC: false,
    // Флаги кусков (первые два — как у RigidPool)
    SHATTER: 1,          // крупный кусок: раскалывается при сильном ударе
    CRUSH: 2,            // тяжёлый кусок: сообщает об ударах и крушит то, на что упал
    CHIP: 4,             // крошка: с другой крошкой не сталкивается, лёжа коллайдера не получает
    // Куски (SoA)
    /** @type {Uint8Array} */ st: new Uint8Array(0),
    /** @type {Uint8Array} */ fl: new Uint8Array(0),
    /** @type {Int32Array} */ bid: new Int32Array(0),
    /** @type {Float64Array} */ col: new Float64Array(0),
    /** @type {Float32Array} */ px: new Float32Array(0), /** @type {Float32Array} */ py: new Float32Array(0), /** @type {Float32Array} */ pz: new Float32Array(0),
    /** @type {Float32Array} */ qx: new Float32Array(0), /** @type {Float32Array} */ qy: new Float32Array(0), /** @type {Float32Array} */ qz: new Float32Array(0), /** @type {Float32Array} */ qw: new Float32Array(0),
    /** @type {Float32Array} */ hx: new Float32Array(0), /** @type {Float32Array} */ hy: new Float32Array(0), /** @type {Float32Array} */ hz: new Float32Array(0),
    /** @type {Float32Array} */ rest: new Float32Array(0), /** @type {Float32Array} */ top: new Float32Array(0), /** @type {Float32Array} */ fade: new Float32Array(0),
    /** @type {Int32Array} */ stamp: new Int32Array(0), /** @type {Int32Array} */ born: new Int32Array(0), /** @type {Int32Array} */ zc: new Int32Array(0),
    /** @type {Int32Array} */ gNext: new Int32Array(0), /** @type {Int32Array} */ gPrev: new Int32Array(0), /** @type {Int32Array} */ gCell: new Int32Array(0),
    /** @type {Float32Array} */ mats: new Float32Array(0), /** @type {Float32Array} */ cols: new Float32Array(0),
    /** @type {Float32Array} */ rectA: new Float32Array(0), /** @type {Float32Array} */ rectB: new Float32Array(0),
    // Сетка лежащих обломков (клетка GC px): списки по клеткам и высота кучи
    GC: 64, gw: 0, gh: 0,
    /** @type {Int32Array} */ gHead: new Int32Array(0),
    /** @type {Float32Array} */ pileH: new Float32Array(0),
    /** @type {Uint8Array} */ pileDirty: new Uint8Array(0),
    // Активные зоны
    ZX: 256, ZY: 280,
    /** @type {Map<number, any>} */ zones: new Map(),
    // Атлас фасадов (GameArch): тайл изнанки для «простых» кусков; без атласа — своя текстура, прямоугольник 0..1
    atlasOn: false, innerTile: 0,
    _uv: [0, 0, 1, 1], _sub: [0, 0, 1, 1], _subOn: false,
    // Шары кайдзю (GameCity кладёт каждый кадр): будят лежащие обломки на пути
    /** @type {Float32Array} */ kS: new Float32Array(96), kN: 0,
    /** @type {Float32Array} */ kPrev: new Float32Array(72),
    // Хуки GameCity
    /** @type {null | ((zone: any) => void)} */ onZoneOpen: null,
    /** @type {null | ((zone: any) => void)} */ onZoneClose: null,
    /** @type {null | ((handle: number, x: number, y: number, z: number, dv: number, size: number) => void)} */ onCrush: null,
    /** @type {null | ((x: number, y: number, z: number, size: number) => void)} */ onLand: null,
    /** @type {null | ((id: number, kind: number, ref: number, otherId: number, otherHandle: number, force: number) => void)} */ onBodyHit: null,
    /** @type {null | ((dt: number) => void)} */ onSync: null,
    /** @type {null | ((x: number, y: number, z: number, radius: number, power: number, up: number) => void)} */ onImpulse: null,
    /** @type {null | ((x: number, z: number) => number | null)} */ waterAt: null,
    /** @type {null | ((x: number, z: number, tag: number) => number)} */ roofAt: null,
    _rnd: Math.random,
    _P: { x: 0, y: 0, z: 0 }, _Q: { x: 0, y: 0, z: 0, w: 1 }, _v3: [0, 0, 0], _dt: 0,
    /** @type {any} */ _syncFn: null,
    /** @type {any} */ _o: { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, q: [0, 0, 0, 1], density: 1, friction: 0.8, restitution: 0.06, linDamp: 0.04, angDamp: 0.35, member: 2, filter: 0xffff, kind: 1, ref: -1, hitAcc: 0 },
    /** @type {Int32Array} */ _stack: new Int32Array(64),

    /** Бюджет живых тел по уровню графики. */
    capacity() { const q = KR.quality(); return q === 'low' ? 170 : q === 'medium' ? 380 : 700; },

    /** Создать меш и массивы под карту (в prepare карты, до GameCity.build). */
    init(view, mapW, mapH, base) {
        this.dispose();
        this.view = view;
        this.mapW = mapW; this.mapH = mapH; this.base = base || 0;
        const q = KR.quality();
        this.budget = this.capacity();
        const sc = q === 'low' ? 800 : q === 'medium' ? 1800 : 3600;
        this.staticCap = IS_MOBILE ? Math.round(sc * 0.7) : sc;
        const cap = this.cap = this.budget + this.staticCap + 96;
        this.count = 0; this.live = 0; this.frame = 0; this.kN = 0;
        const F = () => new Float32Array(cap), I = () => new Int32Array(cap);
        this.st = new Uint8Array(cap); this.fl = new Uint8Array(cap); this.bid = I(); this.col = new Float64Array(cap);
        this.px = F(); this.py = F(); this.pz = F(); this.qx = F(); this.qy = F(); this.qz = F(); this.qw = F();
        this.hx = F(); this.hy = F(); this.hz = F(); this.rest = F(); this.top = F(); this.fade = F();
        this.stamp = I(); this.born = I(); this.zc = I(); this.gNext = I(); this.gPrev = I(); this.gCell = I();
        this.mats = new Float32Array(cap * 16); this.cols = new Float32Array(cap * 4);
        this.rectA = new Float32Array(cap * 4); this.rectB = new Float32Array(cap * 4);
        this.gw = Math.ceil(mapW / this.GC); this.gh = Math.ceil(mapH / this.GC);
        this.gHead = new Int32Array(this.gw * this.gh).fill(-1);
        this.pileH = new Float32Array(this.gw * this.gh); this.pileDirty = new Uint8Array(this.gw * this.gh);
        this.zones = new Map();
        this.atlasOn = false;
        this._syncFn = (/** @type {number} */ id, /** @type {any} */ body) => this._sync(id, body);

        const scene = view.scene;
        const mesh = this.mesh = new BABYLON.Mesh('debris', scene);
        this._cube().applyToMesh(mesh, false);
        const mat = this.mat = new BABYLON.StandardMaterial('debris-mat', scene);
        mat.diffuseTexture = new BABYLON.Texture('assets/textures/debris.webp', scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null, () => { if (!this.atlasOn) mat.diffuseTexture = null; });
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        this._plugin(mat);
        mesh.material = mat;
        mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
        mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
        mesh.thinInstanceSetBuffer('krRectA', this.rectA, 4, false);
        mesh.thinInstanceSetBuffer('krRectB', this.rectB, 4, false);
        mesh.thinInstanceCount = 0;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        // Габарит на всю карту: иначе отсечение теней и камеры судит по единичной коробке в начале координат.
        mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -200, 0), new BABYLON.Vector3(mapW, 4000, mapH)));
        World3D.addObject(view, mesh, 'prop', { ink: false, outline: false });
    },

    dispose() {
        if (this.mesh && this.view) { try { World3D.removeObject(this.view, this.mesh); } catch (e) { /* сцена уже убрана */ } }
        if (this.mat) { try { this.mat.dispose(false, false); } catch (e) { /* */ } }
        this.mesh = null; this.mat = null; this.count = 0; this.live = 0;
        this.zones = new Map();
    },

    /** Атлас фасадов города: куски стен показывают свои тайлы. innerTile — тайл изнанки (бетон) для простых кусков. */
    setAtlas(texture, innerTile) {
        if (!this.mat || !texture) return;
        const old = this.mat.diffuseTexture;
        this.mat.diffuseTexture = texture;
        if (old && old !== texture) { try { old.dispose(); } catch (e) { /* */ } }
        this.atlasOn = true; this.innerTile = innerTile || 0;
    },

    // Единичный куб: у боковых граней v = 0 наверху (атлас грузится без переворота), нормали — по осям.
    _cube() {
        const pos = [], nor = [], uv = [], idx = [];
        const face = (/** @type {number[]} */ P, /** @type {number} */ nx, /** @type {number} */ ny, /** @type {number} */ nz) => {
            const a = pos.length / 3;
            for (let q = 0; q < 4; q++) {
                pos.push(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]); nor.push(nx, ny, nz);
                uv.push(q < 2 ? 1 : 0, q === 1 || q === 2 ? 0 : 1);
            }
            idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
        };
        const h = 0.5;
        face([h, -h, h, h, h, h, h, h, -h, h, -h, -h], 1, 0, 0);
        face([-h, -h, -h, -h, h, -h, -h, h, h, -h, -h, h], -1, 0, 0);
        face([-h, -h, h, -h, h, h, h, h, h, h, -h, h], 0, 0, 1);
        face([h, -h, -h, h, h, -h, -h, h, -h, -h, -h, -h], 0, 0, -1);
        face([-h, h, -h, h, h, -h, h, h, h, -h, h, h], 0, 1, 0);
        face([-h, -h, h, h, -h, h, h, -h, -h, -h, -h, -h], 0, -1, 0);
        const vd = new BABYLON.VertexData();
        vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = idx;
        return vd;
    },

    // Плагин материала: UV куба переносится в прямоугольник атласа экземпляра (krRectA — бока, krRectB — верх и низ);
    // целая часть krRectA.x / 2 — «простота» куска: 0 — тайл как есть, 1 — наполовину выбелен, 2 — ровный цвет.
    _plugin(mat) {
        if (typeof BABYLON === 'undefined' || !BABYLON.MaterialPluginBase) return;
        const G = /** @type {any} */ (GameDebris);
        if (!G._Plugin) {
            G._Plugin = class KRDebrisUV extends BABYLON.MaterialPluginBase {
                constructor(/** @type {any} */ material) { super(material, 'KRDebrisUV', 210, { KRDEBRISUV: false }, true, true); }
                getClassName() { return 'KRDebrisUV'; }
                prepareDefines(/** @type {any} */ defines, /** @type {any} */ scene, /** @type {any} */ mesh) { defines.KRDEBRISUV = !!(mesh && mesh.hasThinInstances); }
                getAttributes(/** @type {string[]} */ attributes, /** @type {any} */ scene, /** @type {any} */ mesh) { if (mesh && mesh.hasThinInstances) attributes.push('krRectA', 'krRectB'); }
                getCustomCode(/** @type {string} */ shaderType) {
                    if (shaderType === 'vertex') return {
                        CUSTOM_VERTEX_DEFINITIONS: '#ifdef KRDEBRISUV\nattribute vec4 krRectA;\nattribute vec4 krRectB;\nvarying float vKrMix;\n#endif\n',
                        CUSTOM_VERTEX_UPDATE_POSITION: '#ifdef KRDEBRISUV\n{\nfloat krM = floor(krRectA.x * 0.5 + 0.001);\nvec4 krR = abs(normal.y) > 0.5 ? krRectB : vec4(krRectA.x - krM * 2.0, krRectA.yzw);\n#ifdef UV1\nuvUpdated = krR.xy + uvUpdated * krR.zw;\n#endif\nvKrMix = krM * 0.5;\n}\n#endif\n',
                    };
                    return {
                        CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef KRDEBRISUV\nvarying float vKrMix;\n#endif\n',
                        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: '#ifdef KRDEBRISUV\nbaseColor.rgb = mix(baseColor.rgb, vec3(0.9), vKrMix);\n#endif\n',
                    };
                }
            };
        }
        try { mat.krDebrisUV = new G._Plugin(mat); } catch (e) { console.warn('GameDebris: плагин материала не создан', e); }
    },

    // ---------------------------------------------------------------------------------------------
    // Сетка лежащих обломков и высота кучи
    // ---------------------------------------------------------------------------------------------

    _cell(x, z) {
        const i = Math.floor(x / this.GC), j = Math.floor(z / this.GC);
        return i < 0 || j < 0 || i >= this.gw || j >= this.gh ? -1 : j * this.gw + i;
    },

    _link(p) {
        const c = this._cell(this.px[p], this.pz[p]);
        this.gCell[p] = c;
        if (c < 0) { this.gNext[p] = this.gPrev[p] = -1; return; }
        const h = this.gHead[c];
        this.gNext[p] = h; this.gPrev[p] = -1;
        if (h >= 0) this.gPrev[h] = p;
        this.gHead[c] = p;
        if (this.top[p] - this.base > this.pileH[c]) this.pileH[c] = this.top[p] - this.base;
    },

    _unlink(p) {
        const c = this.gCell[p];
        if (c < 0) return;
        const a = this.gPrev[p], b = this.gNext[p];
        if (a >= 0) this.gNext[a] = b; else this.gHead[c] = b;
        if (b >= 0) this.gPrev[b] = a;
        this.gCell[p] = -1;
        this.pileDirty[c] = 1;
    },

    /** Высота кучи обломков над землёй в точке (верх самого высокого лежащего куска в клетке 64 px). */
    pileAt(x, z) {
        const c = this._cell(x, z);
        if (c < 0 || !this.count) return 0;
        if (this.pileDirty[c]) {
            let h = 0;
            for (let p = this.gHead[c]; p >= 0; p = this.gNext[p]) if (this.top[p] - this.base > h) h = this.top[p] - this.base;
            this.pileH[c] = h; this.pileDirty[c] = 0;
        }
        return this.pileH[c];
    },

    /** Доля свободного бюджета живых тел 0..1. */
    room() { return this.budget ? Math.max(0, 1 - this.live / this.budget) : 0; },

    // ---------------------------------------------------------------------------------------------
    // Активные зоны
    // ---------------------------------------------------------------------------------------------

    /** Отметить зоны вокруг точки (радиус r) нужными: новые открываются сразу. */
    touch(x, y, z, r) { const m = r + 78; this.touchBox(x - m, y - m, z - m, x + m, y + m, z + m); },

    /** Отметить зоны, задетые габаритом (мир, px). */
    touchBox(x0, y0, z0, x1, y1, z1) {
        const ZX = this.ZX, ZY = this.ZY, b = this.base, F = this.frame, Z = this.zones;
        const ix0 = Math.max(-4, Math.floor(x0 / ZX)), ix1 = Math.min(500, Math.floor(x1 / ZX));
        const iz0 = Math.max(-4, Math.floor(z0 / ZX)), iz1 = Math.min(500, Math.floor(z1 / ZX));
        const iy0 = Math.max(0, Math.floor((y0 - b) / ZY)), iy1 = Math.min(60, Math.floor((y1 - b) / ZY));
        for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
            const key = (iy * 512 + iz + 4) * 512 + ix + 4;
            let zn = Z.get(key);
            if (!zn) zn = this._zoneOpen(key, ix, iy, iz);
            zn.stamp = F;
        }
    },

    /** Зона, в которой лежит точка (или undefined, если она не активна). */
    zoneAt(x, y, z) {
        const iy = Math.floor((y - this.base) / this.ZY);
        if (iy < 0) return undefined;
        return this.zones.get((iy * 512 + Math.floor(z / this.ZX) + 4) * 512 + Math.floor(x / this.ZX) + 4);
    },

    _zoneOpen(key, ix, iy, iz) {
        const zn = { key, ix, iy, iz, stamp: this.frame, /** @type {number[]} */ bricks: [] };
        this.zones.set(key, zn);
        this._zonePieces(zn, true);
        if (this.onZoneOpen) this.onZoneOpen(zn);
        return zn;
    },

    _zoneClose(zn) {
        this.zones.delete(zn.key);
        this._zonePieces(zn, false);
        if (this.onZoneClose) this.onZoneClose(zn);
    },

    // Лежащим кускам зоны поставить (on) или снять неподвижные коллайдеры.
    _zonePieces(zn, on) {
        const n = this.ZX / this.GC, gx0 = zn.ix * n, gz0 = zn.iz * n, y0 = this.base + zn.iy * this.ZY, y1 = y0 + this.ZY;
        for (let gz = Math.max(0, gz0); gz < Math.min(this.gh, gz0 + n); gz++) for (let gx = Math.max(0, gx0); gx < Math.min(this.gw, gx0 + n); gx++) {
            for (let p = this.gHead[gz * this.gw + gx]; p >= 0; p = this.gNext[p]) {
                const y = this.py[p];
                if (y < y0 || y >= y1) continue;
                if (on) { if (this.col[p] < 0 && !(this.fl[p] & 4)) this.col[p] = GamePhysics.addFixedQ(this.px[p], y, this.pz[p], this.hx[p], this.hy[p], this.hz[p], this.qx[p], this.qy[p], this.qz[p], this.qw[p]); }
                else if (this.col[p] >= 0) { GamePhysics.removeFixed(this.col[p]); this.col[p] = -1; }
            }
        }
    },

    // ---------------------------------------------------------------------------------------------
    // Куски: создание, тело, заморозка, пробуждение, удаление
    // ---------------------------------------------------------------------------------------------

    /** Следующий кусок покажет только часть тайла: доли 0..1 от его прямоугольника (u0, v0, u1, v1). */
    sub(fu0, fv0, fu1, fv1) { const s = this._sub; s[0] = fu0; s[1] = fv0; s[2] = fu1; s[3] = fv1; this._subOn = true; },

    // Прямоугольники атласа куска p: tile < 0 — простой кусок (тайл изнанки, mix по умолчанию 1).
    _rects(p, tile, tileB, mix) {
        const A = this.rectA, B = this.rectB, o = p * 4, uv = this._uv;
        let m = mix || 0;
        if (!this.atlasOn) { A[o] = 2 * Math.max(1, m); A[o + 1] = 0; A[o + 2] = 1; A[o + 3] = 1; B[o] = 0; B[o + 1] = 0; B[o + 2] = 1; B[o + 3] = 1; this._subOn = false; return; }
        if (tile < 0) { tile = this.innerTile; if (!mix) m = 1; }
        GameArch.tileUV(tile, uv);
        let u0 = uv[0], v0 = uv[1], du = uv[2] - uv[0], dv = uv[3] - uv[1];
        if (this._subOn) { const s = this._sub; u0 += du * s[0]; v0 += dv * s[1]; du *= s[2] - s[0]; dv *= s[3] - s[1]; this._subOn = false; }
        A[o] = u0 + 2 * m; A[o + 1] = v0; A[o + 2] = du; A[o + 3] = dv;
        GameArch.tileUV(tileB >= 0 ? tileB : this.innerTile, uv);
        B[o] = uv[0]; B[o + 1] = uv[1]; B[o + 2] = uv[2] - uv[0]; B[o + 3] = uv[3] - uv[1];
    },

    // Матрица Babylon куска p (масштаб = размеры коробки × f).
    _matrix(p, f) {
        const qx = this.qx[p], qy = this.qy[p], qz = this.qz[p], qw = this.qw[p], out = this.mats, o = p * 16;
        const sx = this.hx[p] * 2 * f, sy = this.hy[p] * 2 * f, sz = this.hz[p] * 2 * f;
        out[o] = (1 - 2 * (qy * qy + qz * qz)) * sx; out[o + 1] = 2 * (qx * qy + qz * qw) * sx; out[o + 2] = 2 * (qz * qx - qy * qw) * sx; out[o + 3] = 0;
        out[o + 4] = 2 * (qx * qy - qz * qw) * sy; out[o + 5] = (1 - 2 * (qz * qz + qx * qx)) * sy; out[o + 6] = 2 * (qy * qz + qx * qw) * sy; out[o + 7] = 0;
        out[o + 8] = 2 * (qz * qx + qy * qw) * sz; out[o + 9] = 2 * (qy * qz - qx * qw) * sz; out[o + 10] = (1 - 2 * (qy * qy + qx * qx)) * sz; out[o + 11] = 0;
        out[o + 12] = this.px[p]; out[o + 13] = this.py[p]; out[o + 14] = this.pz[p]; out[o + 15] = 1;
        this.dirtyM = true;
    },

    // Полувысота куска в мире (проекция коробки на вертикаль).
    _extY(p) {
        const qx = this.qx[p], qy = this.qy[p], qz = this.qz[p], qw = this.qw[p];
        return Math.abs(2 * (qx * qy + qz * qw)) * this.hx[p] + Math.abs(1 - 2 * (qz * qz + qx * qx)) * this.hy[p] + Math.abs(2 * (qy * qz - qx * qw)) * this.hz[p];
    },

    // Тело Rapier для куска p.
    _body(p, vx, vy, vz, wx, wy, wz) {
        const o = this._o, G = GamePhysics, chip = (this.fl[p] & 4) !== 0;
        o.vx = vx; o.vy = vy; o.vz = vz; o.wx = wx; o.wy = wy; o.wz = wz;
        o.q[0] = this.qx[p]; o.q[1] = this.qy[p]; o.q[2] = this.qz[p]; o.q[3] = this.qw[p];
        o.member = chip ? G.G_CHIP : G.G_DEBRIS; o.filter = chip ? (G.G_ALL & ~G.G_CHIP) : G.G_ALL;
        o.kind = G.K_DEBRIS; o.ref = p; o.hitAcc = (this.fl[p] & 2) ? 4200 : 0;
        const id = G.add('box', this.px[p], this.py[p], this.pz[p], this.hx[p], this.hy[p], this.hz[p], o);
        this.bid[p] = id;
        return id;
    },

    /**
     * Кусок с полным описанием: положение, полуразмеры, скорость, вращение (рад/с), кватернион, цвет 0xRRGGBB, флаги,
     * тайл атласа боков (−1 — простой кусок), тайл верха и низа (−1 — изнанка), mix (0 — тайл, 1 — выбелен, 2 — ровный цвет).
     * still — сразу лежащий (без тела). Возвращает номер куска или −1.
     */
    spawnQ(x, y, z, hx, hy, hz, vx, vy, vz, wx, wy, wz, qx, qy, qz, qw, color, flags, tile, tileB, mix, still) {
        if (!this.mesh || !GamePhysics.world) { this._subOn = false; return -1; }
        if (!still && this.live >= this.budget && !this._makeRoom()) { this._subOn = false; return -1; }
        if (this.count >= this.cap && !this._evict()) { this._subOn = false; return -1; }
        const p = this.count++;
        this.px[p] = x; this.py[p] = y; this.pz[p] = z;
        this.qx[p] = qx; this.qy[p] = qy; this.qz[p] = qz; this.qw[p] = qw;
        this.hx[p] = hx; this.hy[p] = hy; this.hz[p] = hz;
        this.fl[p] = flags | 0; this.col[p] = -1; this.rest[p] = 0; this.fade[p] = 1; this.gCell[p] = -1;
        this.stamp[p] = this.frame; this.born[p] = this.frame; this.zc[p] = -1;
        const c = p * 4;
        this.cols[c] = ((color >> 16) & 255) / 255; this.cols[c + 1] = ((color >> 8) & 255) / 255; this.cols[c + 2] = (color & 255) / 255; this.cols[c + 3] = 1;
        this._rects(p, tile == null ? -1 : tile, tileB == null ? -1 : tileB, mix || 0);
        this.dirtyC = true;
        if (still) { this.st[p] = 2; this.bid[p] = -1; this._settle(p); }
        else {
            this.st[p] = 1; this.live++;
            if (this._body(p, vx, vy, vz, wx, wy, wz) < 0) { this.live--; this.count--; return -1; }
            this.touch(x, y, z, Math.max(hx, hy, hz));
        }
        this._matrix(p, 1);
        return p;
    },

    /** Один простой обломок (прежняя подпись). color — 0xRRGGBB. Возвращает номер или −1. */
    spawn(x, y, z, hx, hy, hz, vx, vy, vz, color, flags, yaw) {
        const r = this._rnd, s = 5.5 / (1 + Math.max(hx, hy, hz) * 0.035), a = (yaw || 0) * 0.5;
        const fl = (flags | 0) | (Math.max(hx, hy, hz) < 9 ? 4 : 0);
        return this.spawnQ(x, y, z, hx, hy, hz, vx, vy, vz, (r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s, 0, Math.sin(a), 0, Math.cos(a), color, fl, -1, -1, 1, false);
    },

    // Кусок лёг: в сетку, высота верха, коллайдер (если зона активна). Над водой — тонет.
    _settle(p) {
        if (this.waterAt && this.py[p] < this.base + 40 && this.waterAt(this.px[p], this.pz[p]) != null) { this.st[p] = 3; this.fade[p] = 1; return; }
        this.st[p] = 2; this.rest[p] = 0;
        this.top[p] = this.py[p] + this._extY(p);
        this._link(p);
        if (!(this.fl[p] & 4) && this.zoneAt(this.px[p], this.py[p], this.pz[p])) {
            this.col[p] = GamePhysics.addFixedQ(this.px[p], this.py[p], this.pz[p], this.hx[p], this.hy[p], this.hz[p], this.qx[p], this.qy[p], this.qz[p], this.qw[p]);
        }
    },

    // Живой кусок превращается в лежащий (тело убирается).
    _freeze(p) {
        if (this.st[p] !== 1) return;
        GamePhysics.remove(this.bid[p]);
        this.bid[p] = -1; this.live--;
        this._settle(p);
    },

    // Лежащий кусок снова становится телом. false — нет бюджета.
    _wake(p, vx, vy, vz) {
        if (this.st[p] !== 2) return false;
        if (this.live >= this.budget && !this._makeRoom()) return false;
        this._unlink(p);
        if (this.col[p] >= 0) { GamePhysics.removeFixed(this.col[p]); this.col[p] = -1; }
        this.st[p] = 1; this.rest[p] = 0; this.stamp[p] = this.frame; this.zc[p] = -1;
        if (this._body(p, vx, vy, vz, 0, 0, 0) < 0) { this.st[p] = 2; this._link(p); return false; }
        this.live++;
        this.touch(this.px[p], this.py[p], this.pz[p], Math.max(this.hx[p], this.hy[p], this.hz[p]));
        return true;
    },

    // Бюджет живых тел исчерпан: заморозить кусок, который и так почти лежит (номера кусков не меняются).
    _makeRoom() {
        const r = this._rnd, n = this.count;
        let best = -1, score = 0.02;
        for (let k = 0; k < 28; k++) {
            const p = Math.floor(r() * n);
            if (this.st[p] !== 1) continue;
            const low = this.py[p] - this._extY(p) < this.base + 8 ? 0.2 : 0;
            const s = this.rest[p] + low + ((this.fl[p] & 4) ? 0.05 : 0);
            if (s > score) { score = s; best = p; }
        }
        if (best < 0) return false;
        this._freeze(best);
        return true;
    },

    // Места нет вовсе: убрать лежащий кусок подальше от кайдзю (или любой старый).
    _evict() {
        const r = this._rnd, n = this.count;
        // @ts-ignore — GameKaiju объявляет js/GameKaiju.js
        const K = typeof GameKaiju !== 'undefined' ? GameKaiju : null, kx = K ? K.x : 0, kz = K ? K.z : 0;
        let best = -1, score = -1;
        for (let k = 0; k < 24; k++) {
            const p = Math.floor(r() * n);
            if (this.st[p] === 1) continue;
            const dx = this.px[p] - kx, dz = this.pz[p] - kz;
            const s = (this.st[p] === 3 ? 1e12 : 0) + dx * dx + dz * dz + (this.frame - this.born[p]) * 40 + ((this.fl[p] & 4) ? 4e5 : 0);
            if (s > score) { score = s; best = p; }
        }
        if (best < 0) return false;
        this._remove(best);
        return true;
    },

    // Убрать кусок: на его место встаёт последний (номера меняются!).
    _remove(p) {
        if (this.st[p] === 1) { GamePhysics.remove(this.bid[p]); this.live--; }
        else if (this.st[p] === 2) { this._unlink(p); if (this.col[p] >= 0) GamePhysics.removeFixed(this.col[p]); }
        const l = --this.count;
        this.st[l] = this.st[l] | 0;
        if (p !== l) {
            this.st[p] = this.st[l]; this.fl[p] = this.fl[l]; this.bid[p] = this.bid[l]; this.col[p] = this.col[l];
            this.px[p] = this.px[l]; this.py[p] = this.py[l]; this.pz[p] = this.pz[l];
            this.qx[p] = this.qx[l]; this.qy[p] = this.qy[l]; this.qz[p] = this.qz[l]; this.qw[p] = this.qw[l];
            this.hx[p] = this.hx[l]; this.hy[p] = this.hy[l]; this.hz[p] = this.hz[l];
            this.rest[p] = this.rest[l]; this.top[p] = this.top[l]; this.fade[p] = this.fade[l];
            this.stamp[p] = this.stamp[l]; this.born[p] = this.born[l]; this.zc[p] = this.zc[l];
            this.gNext[p] = this.gNext[l]; this.gPrev[p] = this.gPrev[l]; this.gCell[p] = this.gCell[l];
            this.mats.copyWithin(p * 16, l * 16, l * 16 + 16);
            this.cols.copyWithin(p * 4, l * 4, l * 4 + 4);
            this.rectA.copyWithin(p * 4, l * 4, l * 4 + 4);
            this.rectB.copyWithin(p * 4, l * 4, l * 4 + 4);
            if (this.st[p] === 1) GamePhysics.refs[this.bid[p]] = p;
            else if (this.st[p] === 2 && this.gCell[p] >= 0) {
                const a = this.gPrev[p], b = this.gNext[p];
                if (a >= 0) this.gNext[a] = p; else this.gHead[this.gCell[p]] = p;
                if (b >= 0) this.gPrev[b] = p;
            }
        }
        this.st[l] = 0;
        this.dirtyM = true; this.dirtyC = true;
    },

    // ---------------------------------------------------------------------------------------------
    // Раскол, импульсы, пробуждение
    // ---------------------------------------------------------------------------------------------

    /**
     * Коробку w×h×d (центр cx, cy, cz, курс yaw) разбить на простые куски и разбросать (прежняя подпись).
     * dir — направление удара (нормированное) или null (во все стороны), power — px/с, pieces — сколько кусков.
     */
    shatterBox(cx, cy, cz, w, h, d, yaw, color, dir, power, pieces, flags) {
        const r = this._rnd, room = this.room();
        let n = pieces;
        if (room < 0.15) n = Math.max(1, Math.round(n * 0.34)); else if (room < 0.4) n = Math.max(1, Math.round(n * 0.6));
        const ca = Math.cos(yaw || 0), sa = Math.sin(yaw || 0);
        const k = Math.cbrt(n), dark = ((color >> 16 & 255) * 0.62 & 255) << 16 | ((color >> 8 & 255) * 0.62 & 255) << 8 | ((color & 255) * 0.62 & 255);
        for (let i = 0; i < n; i++) {
            const lx = (r() - 0.5) * w * 0.7, ly = (r() - 0.5) * h * 0.7, lz = (r() - 0.5) * d * 0.7;
            const x = cx + lx * ca + lz * sa, z = cz - lx * sa + lz * ca, y = Math.max(this.base + 4, cy + ly);
            const f = 0.5 + r() * 0.5, shape = i % 3;          // куски разной формы: глыба, плита, брус
            let hx = Math.max(3, w * 0.5 / k * f * (0.7 + r() * 0.6)), hy = Math.max(3, h * 0.5 / k * f * (0.7 + r() * 0.6)), hz = Math.max(3, d * 0.5 / k * f * (0.7 + r() * 0.6));
            if (shape === 1) hy = Math.max(2, hy * 0.3); else if (shape === 2) { hx *= 1.5; hy = Math.max(2, hy * 0.4); hz = Math.max(2, hz * 0.4); }
            let vx = (r() - 0.5) * power * 0.7, vy = r() * power * 0.55 + power * 0.1, vz = (r() - 0.5) * power * 0.7;
            if (dir) { const p = power * (0.55 + r() * 0.75); vx += dir.x * p; vy += dir.y * p; vz += dir.z * p; }
            this.spawn(x, y, z, hx, hy, hz, vx, vy, vz, r() < 0.3 ? dark : color, flags || 0, (yaw || 0) + (r() - 0.5));
        }
    },

    // Крупный кусок раскололся от удара: две-три части вдоль длинной оси и крошка.
    _split(p, dv) {
        const r = this._rnd, G = GamePhysics, v = this._v3;
        G.vel(this.bid[p], v);
        const x = this.px[p], y = this.py[p], z = this.pz[p], qx = this.qx[p], qy = this.qy[p], qz = this.qz[p], qw = this.qw[p];
        const hx = this.hx[p], hy = this.hy[p], hz = this.hz[p], c = p * 4;
        const color = (Math.round(this.cols[c] * 255) << 16) | (Math.round(this.cols[c + 1] * 255) << 8) | Math.round(this.cols[c + 2] * 255);
        const A = this.rectA, B = this.rectB, a0 = A[c], a1 = A[c + 1], a2 = A[c + 2], a3 = A[c + 3], b0 = B[c], b1 = B[c + 1], b2 = B[c + 2], b3 = B[c + 3];
        const vx = v[0] * 0.5, vy = Math.abs(v[1]) * 0.2, vz = v[2] * 0.5;
        this._remove(p);
        // оси коробки в мире
        const ax = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qz * qx - qy * qw)];
        const ay = [2 * (qx * qy - qz * qw), 1 - 2 * (qz * qz + qx * qx), 2 * (qy * qz + qx * qw)];
        const az = [2 * (qz * qx + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qy * qy + qx * qx)];
        const long = hx >= hy && hx >= hz ? 0 : hz >= hy ? 2 : 1, L = long === 0 ? hx : long === 1 ? hy : hz, axis = long === 0 ? ax : long === 1 ? ay : az;
        const parts = this.room() > 0.3 && L > 30 ? 3 : 2, kick = Math.min(160, 40 + dv * 0.3);
        let t0 = -L;
        for (let i = 0; i < parts; i++) {
            const t1 = i === parts - 1 ? L : t0 + (2 * L / parts) * (0.7 + r() * 0.6), hl = Math.max(3, (Math.min(L, t1) - t0) * 0.5 * 0.94), tc = (t0 + Math.min(L, t1)) * 0.5;
            t0 = Math.min(L, t1);
            const big = Math.max(hl, hx, hy, hz) > 26;
            const q = this.spawnQ(x + axis[0] * tc, Math.max(this.base + 3, y + axis[1] * tc), z + axis[2] * tc, long === 0 ? hl : hx * 0.94, long === 1 ? hl : hy * 0.94, long === 2 ? hl : hz * 0.94,
                vx + (r() - 0.5) * kick + axis[0] * tc * 0.6, vy + r() * kick * 0.6, vz + (r() - 0.5) * kick + axis[2] * tc * 0.6, (r() - 0.5) * 3, (r() - 0.5) * 2, (r() - 0.5) * 3, qx, qy, qz, qw, color, big ? 2 : 0, -1, -1, 1, false);
            if (q >= 0) { const o = q * 4; A[o] = a0; A[o + 1] = a1; A[o + 2] = a2; A[o + 3] = a3; B[o] = b0; B[o + 1] = b1; B[o + 2] = b2; B[o + 3] = b3; }
        }
        const chips = this.room() > 0.5 ? 3 : 1, s = Math.max(3, Math.min(hx, hy, hz) * 0.5);
        for (let i = 0; i < chips; i++) {
            this.spawnQ(x + (r() - 0.5) * hx, Math.max(this.base + 3, y + (r() - 0.5) * hy), z + (r() - 0.5) * hz, s * (0.5 + r() * 0.6), s * (0.4 + r() * 0.5), s * (0.5 + r() * 0.6),
                vx + (r() - 0.5) * kick * 2, vy + r() * kick * 1.4, vz + (r() - 0.5) * kick * 2, (r() - 0.5) * 9, (r() - 0.5) * 9, (r() - 0.5) * 9, qx, qy, qz, qw, color, 4, -1, -1, 1, false);
        }
        void ay; void az;
    },

    /** Разбудить лежащие куски в шаре (не больше max): они снова тела. Возвращает число разбуженных. */
    wakeSphere(x, y, z, r, max) {
        if (!this.count || this.count === this.live) return 0;
        const G = this.GC, gx0 = Math.max(0, Math.floor((x - r - 40) / G)), gx1 = Math.min(this.gw - 1, Math.floor((x + r + 40) / G));
        const gz0 = Math.max(0, Math.floor((z - r - 40) / G)), gz1 = Math.min(this.gh - 1, Math.floor((z + r + 40) / G));
        let n = 0;
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
            let p = this.gHead[gz * this.gw + gx];
            while (p >= 0) {
                const nx = this.gNext[p];
                const dx = this.px[p] - x, dy = this.py[p] - y, dz = this.pz[p] - z, e = r + Math.max(this.hx[p], this.hy[p], this.hz[p]) * 0.7;
                if (dx * dx + dy * dy + dz * dz < e * e) {
                    if (!this._wake(p, 0, 0, 0)) return n;
                    this._wakeAbove(p);
                    if (++n >= max) return n;
                }
                p = nx;
            }
        }
        return n;
    },

    // Кусок p ушёл из кучи: то, что лежало на нём, тоже просыпается (иначе повиснет в воздухе).
    _wakeAbove(p0) {
        const st = this._stack;
        let sp = 0, woke = 0;
        st[sp++] = p0;
        while (sp > 0 && woke < 40) {
            const p = st[--sp], x = this.px[p], y = this.py[p], z = this.pz[p], e = Math.max(this.hx[p], this.hz[p]) + 6, ty = y + this._extY(p);
            const G = this.GC, gx0 = Math.max(0, Math.floor((x - e - 30) / G)), gx1 = Math.min(this.gw - 1, Math.floor((x + e + 30) / G));
            const gz0 = Math.max(0, Math.floor((z - e - 30) / G)), gz1 = Math.min(this.gh - 1, Math.floor((z + e + 30) / G));
            for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
                let q = this.gHead[gz * this.gw + gx];
                while (q >= 0) {
                    const nx = this.gNext[q];
                    if (this.py[q] > y + 1) {
                        const eq = Math.max(this.hx[q], this.hz[q]), bottom = this.py[q] - this._extY(q);
                        if (Math.abs(this.px[q] - x) < e + eq * 0.8 && Math.abs(this.pz[q] - z) < e + eq * 0.8 && bottom - ty < 14 && bottom > this.base + 6) {
                            if (this._wake(q, 0, 0, 0)) { woke++; if (sp < st.length) st[sp++] = q; }
                        }
                    }
                    q = nx;
                }
            }
        }
    },

    /** Импульс взрыва / удара ноги: всё в радиусе просыпается и разлетается от центра. up — добавка вверх 0..1. */
    impulse(x, y, z, radius, power, up) {
        if (!this.mesh) return;
        const u = up == null ? 0.6 : up, r2 = radius * radius, r = this._rnd, G = GamePhysics;
        this.wakeSphere(x, y, z, radius * 0.75, power > 300 ? 60 : 30);
        for (let p = 0; p < this.count; p++) {
            if (this.st[p] !== 1) continue;
            const dx = this.px[p] - x, dy = this.py[p] - y, dz = this.pz[p] - z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1, f = power * (1 - d / radius) / (1 + Math.max(this.hx[p], this.hy[p], this.hz[p]) * 0.02);
            if (f < 20) continue;
            G.push(this.bid[p], dx / d * f, (dy / d * 0.5 + u) * f, dz / d * f);
            G.spin(this.bid[p], (r() - 0.5) * 5, (r() - 0.5) * 3, (r() - 0.5) * 5);
            this.rest[p] = 0;
        }
        if (this.onImpulse) this.onImpulse(x, y, z, radius, power, u);
    },

    /** Удар с направлением (когти, хвост, луч): куски в шаре летят по dir {x, y, z}, лежащие — просыпаются. */
    shove(x, y, z, radius, dir, power) {
        if (!this.count) return;
        const r2 = radius * radius, r = this._rnd, G = GamePhysics;
        this.wakeSphere(x, y, z, radius * 0.9, 20);
        for (let p = 0; p < this.count; p++) {
            if (this.st[p] !== 1) continue;
            const dx = this.px[p] - x, dy = this.py[p] - y, dz = this.pz[p] - z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1, f = power * (0.45 + 0.55 * (1 - d / radius)) / (1 + Math.max(this.hx[p], this.hy[p], this.hz[p]) * 0.015);
            if (dir) G.push(this.bid[p], dir.x * f + dx / d * f * 0.3, dir.y * f + 0.2 * f, dir.z * f + dz / d * f * 0.3);
            else G.push(this.bid[p], dx / d * f, (dy / d * 0.5 + 0.5) * f, dz / d * f);
            G.spin(this.bid[p], (r() - 0.5) * 4, (r() - 0.5) * 3, (r() - 0.5) * 4);
            this.rest[p] = 0;
        }
    },

    /** Опора под обломками могла исчезнуть (здание разрушено): всё, что лежит выше земли в прямоугольнике, падает снова. */
    wakeBox(x0, x1, z0, z1) {
        if (!this.count || this.count === this.live) return;
        const G = this.GC, gx0 = Math.max(0, Math.floor(x0 / G)), gx1 = Math.min(this.gw - 1, Math.floor(x1 / G));
        const gz0 = Math.max(0, Math.floor(z0 / G)), gz1 = Math.min(this.gh - 1, Math.floor(z1 / G));
        let n = 0;
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
            let p = this.gHead[gz * this.gw + gx];
            while (p >= 0) {
                const nx = this.gNext[p];
                if (this.py[p] - this._extY(p) > this.base + 16 && this.px[p] >= x0 && this.px[p] <= x1 && this.pz[p] >= z0 && this.pz[p] <= z1) {
                    if (!this._wake(p, 0, 0, 0) || ++n >= 90) return;
                }
                p = nx;
            }
        }
    },

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    // Неспящее тело после шага физики: свой кусок — положение в матрицу и проверка покоя; любое тело — отметка зон.
    _sync(id, body) {
        const G = GamePhysics, kind = G.kinds[id];
        if (kind === G.K_KAIJU || kind === G.K_SECTION || kind === G.K_PROP) return;
        const P = body.translation(this._P);
        if (kind !== G.K_DEBRIS) { if (body.isDynamic()) this.touch(P.x, P.y, P.z, 60); return; }
        const p = G.refs[id];
        if (p < 0 || this.st[p] !== 1) return;
        const Q = body.rotation(this._Q), dt = this._dt;
        const dx = P.x - this.px[p], dy = P.y - this.py[p], dz = P.z - this.pz[p];
        const ex = Q.x - this.qx[p], ey = Q.y - this.qy[p], ez = Q.z - this.qz[p], ew = Q.w - this.qw[p];
        const calm = dx * dx + dy * dy + dz * dz < 256 * dt * dt && ex * ex + ey * ey + ez * ez + ew * ew < 0.09 * dt * dt;
        this.rest[p] = calm ? this.rest[p] + dt : 0;
        this.px[p] = P.x; this.py[p] = P.y; this.pz[p] = P.z; this.qx[p] = Q.x; this.qy[p] = Q.y; this.qz[p] = Q.z; this.qw[p] = Q.w;
        this.stamp[p] = this.frame;
        this._matrix(p, 1);
        // зоны: при переходе в другую клетку 64 px и изредка на месте
        const zc = (Math.floor(P.y / 70) * 512 + Math.floor(P.z / 64)) * 512 + Math.floor(P.x / 64);
        if (zc !== this.zc[p] || ((this.frame + p) & 15) === 0) { this.zc[p] = zc; this.touch(P.x, P.y, P.z, Math.max(this.hx[p], this.hy[p], this.hz[p])); }
        if (P.y < this.base - 200) { this.rest[p] = 99; }
    },

    update(dt) {
        const mesh = this.mesh, G = GamePhysics;
        if (!mesh) return;
        const F = ++this.frame;
        this._dt = Math.max(1e-3, dt);
        if (G.world) {
            G.forActive(this._syncFn);
            // покой -> лежащий кусок; тело, уснувшее само (не было в обходе), — тоже
            const load = this.live / this.budget, need = load > 0.85 ? 0.12 : load > 0.6 ? 0.3 : 0.55;
            for (let p = this.count - 1; p >= 0; p--) {
                const s = this.st[p];
                if (s === 1) { if (this.stamp[p] !== F || this.rest[p] > need) { if (this.py[p] < this.base - 200) this._remove(p); else this._freeze(p); } }
                else if (s === 3) {
                    this.fade[p] -= dt * 1.6; this.py[p] -= dt * 16;
                    if (this.fade[p] <= 0) this._remove(p); else this._matrix(p, Math.max(0.01, this.fade[p]));
                }
            }
            this._hits();
        }
        if (this.onSync) this.onSync(dt);
        this._kaijuWake();
        // зоны без тел закрываются
        if ((F & 15) === 0 && this.zones.size) {
            const old = this.zones.size > 260 ? 30 : 70;
            for (const zn of this.zones.values()) if (F - zn.stamp > old) this._zoneClose(zn);
        }
        // лежащих больше нормы — старые и дальние уходят
        const lim = Math.round(this.staticCap * Math.max(0.3, Math.min(1, this.lifeScale)));
        for (let k = 0; k < 6 && this.count - this.live > lim; k++) if (!this._evict()) break;
        if (this.dirtyM || this.dirtyC) {
            mesh.thinInstanceCount = this.count;
            if (this.dirtyM) mesh.thinInstanceBufferUpdated('matrix');
            if (this.dirtyC) { mesh.thinInstanceBufferUpdated('color'); mesh.thinInstanceBufferUpdated('krRectA'); mesh.thinInstanceBufferUpdated('krRectB'); }
            this.dirtyM = false; this.dirtyC = false;
        }
    },

    // Удары последнего шага физики: тяжёлые куски крушат и колются, секции и пропсы — в GameCity (onBodyHit).
    _hits() {
        const G = GamePhysics, H = G.hits, n = G.hitCount;
        for (let i = 0; i < n; i++) {
            const o = i * 5, a = H[o], b = H[o + 1], f = H[o + 4];
            for (let side = 0; side < 2; side++) {
                const id = side ? b : a, oid = side ? a : b, oh = side ? H[o + 2] : H[o + 3];
                if (id < 0 || !G.bodies[id]) continue;
                const kind = G.kinds[id];
                if (kind === G.K_DEBRIS) this._pieceHit(G.refs[id], oid, oh, f);
                else if ((kind === G.K_SECTION || kind === G.K_PROP) && this.onBodyHit) this.onBodyHit(id, kind, G.refs[id], oid, oh, f);
            }
        }
    },

    _pieceHit(p, oid, oh, force) {
        if (p < 0 || this.st[p] !== 1) return;
        const mass = 8 * this.hx[p] * this.hy[p] * this.hz[p], dv = force / Math.max(1, mass) * GamePhysics.STEP;
        if (dv < 70) return;
        const x = this.px[p], y = this.py[p], z = this.pz[p], size = Math.max(this.hx[p], this.hy[p], this.hz[p]);
        if (oid < 0 && oh !== GamePhysics.groundHandle && this.onCrush) this.onCrush(oh, x, y, z, dv, size);
        if (dv > 150 && this.onLand) this.onLand(x, y - this._extY(p), z, size);
        if ((this.fl[p] & 1) && dv > 190 && this.st[p] === 1) this._split(p, dv);
    },

    // Шары кайдзю будят лежащие обломки на своём пути (дальше их толкают кинематические шары GamePhysics.kaiju).
    _kaijuWake() {
        if (!this.kN || this.count === this.live) return;
        const S = this.kS, P = this.kPrev, top = this.base + 700;
        for (let i = 0; i < this.kN; i++) {
            const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
            if (y - r > top) continue;
            const dx = x - P[i * 3], dy = y - P[i * 3 + 1], dz = z - P[i * 3 + 2];
            if (dx * dx + dy * dy + dz * dz < 9) continue;
            P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
            this.wakeSphere(x, y, z, r, 8);
        }
    },
};
