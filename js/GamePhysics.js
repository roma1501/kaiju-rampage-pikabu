// GamePhysics.js — физика твёрдых тел на Rapier3D (libs/rapier.js, глобал RAPIER; wasm встроен, сети не нужно).
// Единицы игры: px и секунды (1 px = 0.1 м), ось Y — вверх. Один мир на карту: reset() в подготовке карты,
// step(dt) каждый кадр (внутри — фиксированный шаг). Тела адресуются числом id (не объектом Rapier).
// Договор и перечень функций — docs/GAME-CONTRACT.md, раздел 10.2. Подписи функций ниже менять нельзя: ими
// пользуются GameDebris / GameCity (обломки, секции зданий), GameTraffic (машины), GameCrowd.
//
// Сверх договора 10.2 (добавлено владельцем «разрушение», подписи прежних функций те же):
//   addCompound(x, y, z, boxes, n, opts) / setBoxes(id, boxes, n, opts)   составное тело из коробок (секция здания)
//   addFixed(x, y, z, hx, hy, hz, yaw, member) / addFixedQ(…, qx, qy, qz, qw, member) / removeFixed(handle)
//                                             неподвижный коллайдер БЕЗ тела (кирпич здания, лежащий обломок) -> handle
//   opts.kind, opts.ref / tag(id, kind, ref), kindOf(id), refOf(id)        метка хозяина тела (K_*) и его номер у хозяина
//   opts.hitAcc                               тело сообщает о сильных ударах: порог — ускорение px/с² (сила / масса)
//   hits, hitCount                            удары последнего step(): по 5 чисел — idA, idB (−1 — коллайдер без тела),
//                                             handleA, handleB, сила (масса·px/с²)
//   forActive(fn)                             обойти неспящие тела: fn(id, body)
//   angvel(id, out3), setVel(id, vx, vy, vz), setSpin(id, wx, wy, wz), mass(id)
//   kaiju(spheres, n)                         кинематические шары тела кайдзю (группа G_KAIJU) по GameKaiju.bodySpheres
// Чтение read / vel / angvel не создаёт объектов (Rapier пишет во временные объекты модуля).

/** @satisfies {Record<string, any>} */
const GamePhysics = {
    ready: false,                          // Rapier загружен (иначе все функции — тихие пустышки, add* отдаёт −1)
    /** @type {any} */ world: null,
    /** @type {any[]} */ bodies: [],       // id -> RigidBody | null
    /** @type {number[]} */ free: [],
    /** @type {number[]} */ kinds: [],     // id -> K_*
    /** @type {number[]} */ refs: [],      // id -> номер у хозяина
    count: 0,                              // живых тел
    acc: 0,
    STEP: 1 / 60,                          // с: шаг физики
    MAX_SUB: 2,                            // шагов за кадр, не больше
    // Группы столкновений (биты): кто я / с кем сталкиваюсь. G_CHIP — мелкая крошка: между собой не сталкивается.
    G_WORLD: 1, G_DEBRIS: 2, G_VEHICLE: 4, G_KAIJU: 8, G_PROP: 16, G_CHIP: 32, G_ALL: 0xffff,
    // Метки хозяев тел
    K_NONE: 0, K_DEBRIS: 1, K_SECTION: 2, K_PROP: 3, K_VEHICLE: 4, K_KAIJU: 5,
    /** @type {any} */ events: null,
    HIT_CAP: 192,
    /** @type {Float64Array} */ hits: new Float64Array(192 * 5),
    hitCount: 0,
    groundHandle: -1,
    /** @type {number[]} */ kaijuIds: [],
    /** @type {number[]} */ kaijuR: [],
    _p: { x: 0, y: 0, z: 0 }, _q: { x: 0, y: 0, z: 0, w: 1 }, _v: { x: 0, y: 0, z: 0 }, _i: { x: 0, y: 0, z: 0 },
    /** @type {any} */ _drainFn: null,

    /** Один раз за игру: загрузка wasm. */
    async init() {
        if (this.ready) return true;
        if (typeof RAPIER === 'undefined') return false;
        try { await RAPIER.init(); this.ready = true; } catch (e) { console.warn('GamePhysics: Rapier не запустился', e); }
        return this.ready;
    },

    groups(member, filter) { return (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0; },

    /** Новый мир карты: opts = { ground: высота земли px, width, height: размер карты px, gravity: px/с² }. */
    reset(opts) {
        if (!this.ready) return;
        const o = opts || {};
        if (this.world) { try { this.world.free(); } catch (e) { /* уже освобождён */ } }
        if (this.events) { try { this.events.free(); } catch (e) { /* уже освобождена */ } }
        const w = this.world = new RAPIER.World({ x: 0, y: -(o.gravity || KR.GRAVITY), z: 0 });
        w.timestep = this.STEP;
        try { w.lengthUnit = 10; } catch (e) { /* старая сборка без lengthUnit */ }
        this.events = new RAPIER.EventQueue(true);
        this.bodies.length = 0; this.free.length = 0; this.kinds.length = 0; this.refs.length = 0; this.count = 0; this.acc = 0;
        this.hitCount = 0; this.kaijuIds.length = 0; this.kaijuR.length = 0;
        const g = o.ground || 0, W = o.width || 14000, H = o.height || 14000;
        const gb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(W / 2, g - 400, H / 2));
        const gc = w.createCollider(RAPIER.ColliderDesc.cuboid(W * 2, 400, H * 2).setFriction(0.9).setRestitution(0.05)
            .setCollisionGroups(this.groups(this.G_WORLD, this.G_ALL)), gb);
        this.groundHandle = gc.handle;
        this.ground = g;
    },
    ground: 0,

    /** Шаг физики: dt кадра, внутри фиксированные шаги STEP. После шага — удары в hits (см. шапку). */
    step(dt) {
        const w = this.world;
        this.hitCount = 0;
        if (!w) return;
        this.acc = Math.min(this.acc + dt, this.STEP * this.MAX_SUB);
        const drain = this._drainFn || (this._drainFn = (/** @type {any} */ ev) => this._hit(ev));
        while (this.acc >= this.STEP) {
            w.step(this.events);
            this.acc -= this.STEP;
            this.events.drainContactForceEvents(drain);
        }
    },

    _hit(ev) {
        if (this.hitCount >= this.HIT_CAP) return;
        const w = this.world, h1 = ev.collider1(), h2 = ev.collider2();
        const c1 = w.getCollider(h1), c2 = w.getCollider(h2);
        const b1 = c1 ? c1.parent() : null, b2 = c2 ? c2.parent() : null;
        const o = this.hitCount++ * 5, H = this.hits;
        H[o] = b1 && b1.userData != null ? b1.userData : -1;
        H[o + 1] = b2 && b2.userData != null ? b2.userData : -1;
        H[o + 2] = h1; H[o + 3] = h2; H[o + 4] = ev.totalForceMagnitude();
    },

    _bodyDesc(x, y, z, o) {
        const R = RAPIER;
        const bd = o.type === 'fixed' ? R.RigidBodyDesc.fixed() : o.type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic();
        bd.setTranslation(x, y, z);
        if (o.q) bd.setRotation({ x: o.q[0], y: o.q[1], z: o.q[2], w: o.q[3] });
        else if (o.yaw) bd.setRotation({ x: 0, y: Math.sin(o.yaw / 2), z: 0, w: Math.cos(o.yaw / 2) });
        if (!o.type || o.type === 'dynamic') {
            bd.setLinvel(o.vx || 0, o.vy || 0, o.vz || 0).setAngvel({ x: o.wx || 0, y: o.wy || 0, z: o.wz || 0 });
            bd.setLinearDamping(o.linDamp != null ? o.linDamp : 0.05).setAngularDamping(o.angDamp != null ? o.angDamp : 0.3);
            if (o.ccd) bd.setCcdEnabled(true);
        }
        return bd;
    },

    _colSetup(cd, o) {
        cd.setDensity(o.density != null ? o.density : 1).setFriction(o.friction != null ? o.friction : 0.7).setRestitution(o.restitution != null ? o.restitution : 0.1);
        const member = o.member || (o.type === 'fixed' ? this.G_WORLD : this.G_DEBRIS);
        cd.setCollisionGroups(this.groups(member, o.filter != null ? o.filter : this.G_ALL));
        return cd;
    },

    _register(body, o) {
        const id = this.free.length ? /** @type {number} */ (this.free.pop()) : this.bodies.length;
        this.bodies[id] = body; this.count++;
        this.kinds[id] = o.kind || 0; this.refs[id] = o.ref != null ? o.ref : -1;
        body.userData = id;
        return id;
    },

    // Порог сообщений об ударах у всех коллайдеров тела: сила = масса × hitAcc.
    _hitSetup(body, hitAcc) {
        const thr = Math.max(1, body.mass() * hitAcc), n = body.numColliders();
        for (let i = 0; i < n; i++) {
            const c = body.collider(i);
            c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
            c.setContactForceEventThreshold(thr);
        }
    },

    /**
     * Общий конструктор тела. shape: 'box' (a, b, c — полуразмеры), 'ball' (a — радиус), 'capsule' (a — полувысота
     * цилиндра по Y, b — радиус), 'cyl' (a — полувысота, b — радиус). opts:
     *   type: 'dynamic' (по умолчанию) | 'fixed' | 'kinematic';  yaw (рад вокруг Y) или q: [x, y, z, w];
     *   vx, vy, vz — скорость px/с;  wx, wy, wz — вращение рад/с;  density (1), friction (0.7), restitution (0.1);
     *   linDamp (0.05), angDamp (0.3);  member, filter — группы столкновений (G_*);  ccd: true — быстрые тела;
     *   kind, ref — метка хозяина;  hitAcc — сообщать об ударах сильнее этого ускорения (px/с²).
     * Возвращает id (>= 0) или −1.
     */
    add(shape, x, y, z, a, b, c, opts) {
        const w = this.world;
        if (!w) return -1;
        const o = opts || {}, R = RAPIER;
        const body = w.createRigidBody(this._bodyDesc(x, y, z, o));
        const cd = shape === 'ball' ? R.ColliderDesc.ball(a) : shape === 'capsule' ? R.ColliderDesc.capsule(a, b)
            : shape === 'cyl' ? R.ColliderDesc.cylinder(a, b) : R.ColliderDesc.cuboid(a, b, c);
        w.createCollider(this._colSetup(cd, o), body);
        if (o.hitAcc) this._hitSetup(body, o.hitAcc);
        return this._register(body, o);
    },
    addBox(x, y, z, hx, hy, hz, opts) { return this.add('box', x, y, z, hx, hy, hz, opts); },
    addBall(x, y, z, r, opts) { return this.add('ball', x, y, z, r, 0, 0, opts); },

    /**
     * Составное тело из n коробок: boxes — по 6 чисел на коробку (центр x, y, z в системе тела и полуразмеры).
     * opts — как у add. Возвращает id или −1.
     */
    addCompound(x, y, z, boxes, n, opts) {
        const w = this.world;
        if (!w) return -1;
        const o = opts || {};
        const body = w.createRigidBody(this._bodyDesc(x, y, z, o));
        const id = this._register(body, o);
        this.setBoxes(id, boxes, n, o);
        return id;
    },

    /** Заменить коллайдеры составного тела (секция потеряла кирпичи): прежние убираются, ставятся n новых коробок. */
    setBoxes(id, boxes, n, opts) {
        const w = this.world, body = this.bodies[id];
        if (!w || !body) return;
        const o = opts || {}, R = RAPIER;
        for (let i = body.numColliders() - 1; i >= 0; i--) w.removeCollider(body.collider(i), false);
        for (let i = 0; i < n; i++) {
            const k = i * 6;
            const cd = R.ColliderDesc.cuboid(boxes[k + 3], boxes[k + 4], boxes[k + 5]).setTranslation(boxes[k], boxes[k + 1], boxes[k + 2]);
            w.createCollider(this._colSetup(cd, o), body);
        }
        if (o.hitAcc && n) this._hitSetup(body, o.hitAcc);
        body.wakeUp();
    },

    /** Неподвижная коробка без тела, повёрнутая вокруг Y на yaw. Возвращает handle коллайдера (число >= 0) или −1. */
    addFixed(x, y, z, hx, hy, hz, yaw, member) {
        return this.addFixedQ(x, y, z, hx, hy, hz, 0, Math.sin((yaw || 0) / 2), 0, Math.cos((yaw || 0) / 2), member);
    },
    addFixedQ(x, y, z, hx, hy, hz, qx, qy, qz, qw, member) {
        const w = this.world;
        if (!w) return -1;
        const q = this._q;
        q.x = qx; q.y = qy; q.z = qz; q.w = qw;
        const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(q).setFriction(0.85).setRestitution(0.05)
            .setCollisionGroups(this.groups(member || this.G_WORLD, this.G_ALL));
        return w.createCollider(cd).handle;
    },
    removeFixed(handle) {
        const w = this.world;
        if (!w || handle < 0) return;
        const c = w.getCollider(handle);
        if (c) w.removeCollider(c, true);
    },

    /** Убрать тело. */
    remove(id) {
        const b = this.bodies[id];
        if (!b || !this.world) return;
        this.world.removeRigidBody(b);
        this.bodies[id] = null; this.free.push(id); this.count--;
        this.kinds[id] = 0; this.refs[id] = -1;
    },

    /** Сырой RigidBody Rapier (для своих расширений). */
    body(id) { return this.bodies[id] || null; },
    alive(id) { return id >= 0 && !!this.bodies[id]; },
    tag(id, kind, ref) { if (this.bodies[id]) { this.kinds[id] = kind; this.refs[id] = ref; } },
    kindOf(id) { return id >= 0 ? this.kinds[id] || 0 : 0; },
    refOf(id) { return id >= 0 && this.refs[id] != null ? this.refs[id] : -1; },
    mass(id) { const b = this.bodies[id]; return b ? b.mass() : 0; },

    /** Положение и поворот: out[0..2] = x, y, z; out[3..6] = кватернион x, y, z, w. */
    read(id, out) {
        const b = this.bodies[id];
        if (!b) return null;
        const p = b.translation(this._p), q = b.rotation(this._q);
        out[0] = p.x; out[1] = p.y; out[2] = p.z; out[3] = q.x; out[4] = q.y; out[5] = q.z; out[6] = q.w;
        return out;
    },
    /** Скорость px/с: out[0..2]. */
    vel(id, out) {
        const b = this.bodies[id];
        if (!b) return null;
        const v = b.linvel(this._v);
        out[0] = v.x; out[1] = v.y; out[2] = v.z;
        return out;
    },
    /** Вращение рад/с: out[0..2]. */
    angvel(id, out) {
        const b = this.bodies[id];
        if (!b) return null;
        const v = b.angvel(this._v);
        out[0] = v.x; out[1] = v.y; out[2] = v.z;
        return out;
    },
    asleep(id) { const b = this.bodies[id]; return !b || b.isSleeping(); },
    wake(id) { const b = this.bodies[id]; if (b) b.wakeUp(); },

    /** Обойти неспящие тела (динамические и движущиеся кинематические): fn(id, body). */
    forActive(fn) {
        const w = this.world;
        if (!w) return;
        w.forEachActiveRigidBody((/** @type {any} */ b) => { if (b.userData != null) fn(b.userData, b); });
    },

    /** Толчок: прибавить телу скорость (px/с) — масса учитывается сама. */
    push(id, dvx, dvy, dvz) {
        const b = this.bodies[id];
        if (!b || !b.isDynamic()) return;
        const m = b.mass(), i = this._i;
        i.x = dvx * m; i.y = dvy * m; i.z = dvz * m;
        b.applyImpulse(i, true);
    },
    /** Закрутить: прибавить вращение (рад/с, грубо — без учёта формы). */
    spin(id, wx, wy, wz) {
        const b = this.bodies[id];
        if (!b || !b.isDynamic()) return;
        const a = b.angvel(this._v);
        a.x += wx; a.y += wy; a.z += wz;
        b.setAngvel(a, true);
    },
    /** Задать скорость и вращение тела напрямую. */
    setVel(id, vx, vy, vz) { const b = this.bodies[id]; if (b) { const v = this._v; v.x = vx; v.y = vy; v.z = vz; b.setLinvel(v, true); } },
    setSpin(id, wx, wy, wz) { const b = this.bodies[id]; if (b) { const v = this._v; v.x = wx; v.y = wy; v.z = wz; b.setAngvel(v, true); } },
    /** Кинематическое тело: куда приехать к следующему шагу (q — кватернион [x, y, z, w], можно не давать). */
    move(id, x, y, z, q) {
        const b = this.bodies[id];
        if (!b) return;
        const p = this._p;
        p.x = x; p.y = y; p.z = z;
        b.setNextKinematicTranslation(p);
        if (q) { const r = this._q; r.x = q[0]; r.y = q[1]; r.z = q[2]; r.w = q[3]; b.setNextKinematicRotation(r); }
    },

    /**
     * Взрывная волна: все динамические тела в радиусе получают скорость от центра (power px/с в центре, к краю — 0),
     * up — доля подброса вверх (0..1). Возвращает число задетых тел.
     */
    blast(x, y, z, radius, power, up) {
        let n = 0;
        const r2 = radius * radius, u = up || 0, P = this._p, I = this._i;
        for (let id = 0; id < this.bodies.length; id++) {
            const b = this.bodies[id];
            if (!b || !b.isDynamic()) continue;
            const p = b.translation(P), dx = p.x - x, dy = p.y - y, dz = p.z - z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1, k = power * (1 - d / radius), m = b.mass();
            I.x = dx / d * k * m; I.y = (dy / d * (1 - u) + u) * k * m; I.z = dz / d * k * m;
            b.applyImpulse(I, true);
            n++;
        }
        return n;
    },

    /**
     * Тело кайдзю для физики: n кинематических шаров (spheres — по 4 числа: x, y, z, радиус, как GameKaiju.bodySpheres).
     * Звать каждый кадр до step(): шары едут в новые места и расталкивают обломки, машины и пропсы. Скачок дальше
     * своего диаметра — телепорт без толчка (новый раунд, возрождение).
     */
    kaiju(spheres, n) {
        const w = this.world;
        if (!w) return;
        const ids = this.kaijuIds, rad = this.kaijuR, P = this._p;
        while (ids.length > n) { this.remove(/** @type {number} */ (ids.pop())); rad.pop(); }
        for (let i = 0; i < n; i++) {
            const x = spheres[i * 4], y = spheres[i * 4 + 1], z = spheres[i * 4 + 2], r = Math.max(4, spheres[i * 4 + 3]);
            if (i >= ids.length) {
                ids.push(this.add('ball', x, y, z, r, 0, 0, { type: 'kinematic', member: this.G_KAIJU, filter: this.G_DEBRIS | this.G_CHIP | this.G_VEHICLE | this.G_PROP, friction: 0.4, restitution: 0, kind: this.K_KAIJU, ref: i }));
                rad.push(r);
                continue;
            }
            const b = this.bodies[ids[i]];
            if (!b) continue;
            if (Math.abs(rad[i] - r) > rad[i] * 0.03) { b.collider(0).setRadius(r); rad[i] = r; }
            const p = b.translation(P), dx = x - p.x, dy = y - p.y, dz = z - p.z, jump = dx * dx + dy * dy + dz * dz > r * r * 4;
            p.x = x; p.y = y; p.z = z;
            if (jump) b.setTranslation(p, true); else b.setNextKinematicTranslation(p);
        }
    },
};
