// GameArmy.js — розыск (6 звёзд), полиция и армия, снаряды, гибель техники.
//
// РОЗЫСК. heat копится от разрушений и убитой техники; звёзды — пороги KR.STARS. Каждая звезда — свой состав сил
// (KR.WAVES): патрульные -> спецназ и вертолёт -> танки и джипы -> ударные вертолёты -> истребители и РСЗО ->
// мазеры, бомбардировщик и шагающий мех. Подкрепления приходят по одному, пока состав не набран.
// ТЕХНИКА. Наземная идёт по полю расстояний от кайдзю (обход уцелевших зданий и воды), встаёт на дальности огня;
// вертолёты кружат и заходят в атаку; самолёты делают проходы через цель. Модели — инстансы частей прототипа.
// ГИБЕЛЬ. Подбитая наземная техника — обугленный корпус-тело GamePhysics (кувыркается, башня отлетает отдельным телом);
// вертолёт падает штопором, самолёт — по дуге, оба взрываются о землю или дом (GameCity.explode).
// Гражданский транспорт — js/GameTraffic.js, жители — js/GameCrowd.js.
// Координаты: x, z — карта, y — высота.

/** @satisfies {Record<string, any>} */
const GameArmy = {
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ view: null,
    heat: 0, stars: 0, maxStars: 0, kills: 0,
    /** @type {any[]} */ units: [],
    /** @type {any[]} */ shots: [],
    /** @type {any[]} */ wrecks: [],          // подбитая техника: тела физики и падающие вертолёты, самолёты
    /** @type {Record<string, any>} */ models: {},
    /** @type {Record<string, any>} */ burnt: {},        // обугленные прототипы (создаются при первой гибели модели)
    /** @type {any} */ _world: null,
    _p7: new Float32Array(7),
    /** @type {Record<string, any>} */ protos: {},
    /** @type {Uint16Array} */ dist: new Uint16Array(0),
    /** @type {Int32Array} */ queue: new Int32Array(0),
    flowT: 0, spawnT: 0, gunT: 0, active: false,
    UNIT_SCALE: 1.5, WRECK_CAP: 14, WRECK_LIFE: 40,
    _m: { x: 0, y: 0, z: 0 },
    /** Повернуть угол a к b не быстрее step радиан. */
    turnTo(a, b, step) {
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + Math.max(-step, Math.min(step, d));
    },
    /** @type {any} */ sirenLoop: null,
    /** @type {any} */ heliLoop: null,
    /** Хуки игры: score(points, x, y, z, kind, coins), stars(n, up). */
    /** @type {Record<string, Function>} */ hooks: {},

    // Пути моделей — литералами (сборщик берёт в архив только такие ссылки).
    MODELS: {
        police_car: 'assets/models/units/police_car.glb',
        swat_van: 'assets/models/units/swat_van.glb', jeep: 'assets/models/units/jeep.glb', tank: 'assets/models/units/tank.glb',
        mlrs: 'assets/models/units/mlrs.glb', maser: 'assets/models/units/maser.glb', heli_police: 'assets/models/units/heli_police.glb',
        heli_attack: 'assets/models/units/heli_attack.glb', jet: 'assets/models/units/jet.glb', bomber: 'assets/models/units/bomber.glb',
        mech: 'assets/models/units/mech.glb',
    },

    // ---------------------------------------------------------------------------------------------
    // Подготовка карты
    // ---------------------------------------------------------------------------------------------

    /** Прототипы моделей и транспорт карты (под экраном загрузки). */
    async build(app) {
        this.clear();
        this.app = app; this.view = app.location.view;
        const scene = this.view.scene;
        this.protos = {}; this.models = {}; this.burnt = {};
        const ids = Object.keys(this.MODELS);
        const models = await Promise.all(ids.map((id) => Model3D.load(this.MODELS[id]).catch(() => null)));
        ids.forEach((id, n) => {
            const model = models[n];
            if (!model) return;
            this.models[id] = model;
            this.protos[id] = [this._proto(model, scene, id, 0, false)];
        });
        this.dist = new Uint16Array(GameCity.navW * GameCity.navH);
        this.queue = new Int32Array(GameCity.navW * GameCity.navH);
        this.resetRound();
    },

    // Прототип: корень с частями (невидимыми), по нему делаются инстансы. paint — цвет кузова или 0.
    _proto(model, scene, id, paint, dark) {
        const root = Model3D.build(model, scene, { name: 'unit-' + id + (dark ? '-burnt' : '') });
        World3D.addObject(this.view, root, 'prop', { castShadow: false, ink: false, outline: false });
        const parts = [];
        for (const m of root.getChildMeshes(true)) {
            m.isVisible = false; m.isPickable = false;
            const mat = /** @type {any} */ (m).material, list = mat ? (mat.subMaterials || [mat]) : [];
            for (const sm of list) {
                if (!sm) continue;
                const name = String(sm.name).split('/').pop() || '';
                if (paint && name === 'paint') sm.diffuseColor = World3D.hexColor3(paint);
                if (dark) { sm.diffuseColor = sm.diffuseColor.scale(0.24); sm.specularColor = new BABYLON.Color3(0, 0, 0); }
                else if (/^(glow|fire)/.test(name)) sm.emissiveColor = sm.diffuseColor.clone();
            }
            const md = m.metadata || {};
            parts.push({ mesh: m, name: String(md.part || ''), pivot: md.pivot || [0, 0, 0] });
        }
        return { root, parts, id };
    },

    clear() {
        for (const u of this.units) this._disposeNode(u);
        this._clearWrecks();
        this.units = []; this.shots = [];
        for (const id of Object.keys(this.protos)) for (const p of this.protos[id]) { try { World3D.removeObject(this.view, p.root); } catch (e) { /* сцена убрана */ } }
        for (const id of Object.keys(this.burnt)) { try { World3D.removeObject(this.view, this.burnt[id].root); } catch (e) { /* сцена убрана */ } }
        this.protos = {}; this.burnt = {}; this.models = {};
        this._stopLoops();
    },

    _stopLoops() {
        if (this.sirenLoop) { try { this.sirenLoop.stop(); } catch (e) { /* */ } this.sirenLoop = null; }
        if (this.heliLoop) { try { this.heliLoop.stop(); } catch (e) { /* */ } this.heliLoop = null; }
    },

    /** Новый раунд: розыск с нуля, техника убрана. */
    resetRound() {
        for (const u of this.units) this._disposeNode(u);
        this._clearWrecks();
        this.units = []; this.shots = [];
        this.heat = 0; this.stars = 0; this.maxStars = 0; this.kills = 0;
        this.spawnT = 3; this.flowT = 0;
        this._stopLoops();
    },

    // Узел юнита: корень + инстансы частей; подвижные части — на своих узлах-осях.
    _makeNode(id, variant, scale) {
        const list = this.protos[id];
        if (!list || !list.length) return null;
        const proto = list[variant % list.length], scene = this.view.scene;
        const root = new BABYLON.TransformNode('u-' + id, scene);
        /** @type {Record<string, any>} */
        const pivots = {};
        const insts = [];
        const pivotOf = (/** @type {string} */ key, /** @type {number[]} */ p) => {
            if (!pivots[key]) { const t = new BABYLON.TransformNode('p-' + key, scene); t.parent = root; t.position.set(p[0], p[1], p[2]); pivots[key] = t; }
            return pivots[key];
        };
        const turret = proto.parts.find((/** @type {any} */ p) => p.name === 'Turret') || proto.parts.find((/** @type {any} */ p) => p.name === 'Torso');
        for (const part of proto.parts) {
            const inst = part.mesh.createInstance('i-' + part.name);
            inst.isPickable = false;
            let parent = root, off = null;
            if (turret && (part.name.indexOf('Turret') === 0 || part.name === 'Torso' || part.name === 'ArmL' || part.name === 'ArmR')) { parent = pivotOf('turret', turret.pivot); off = turret.pivot; }
            else if (/^(Rotor|TailRotor|LegL|LegR)$/.test(part.name)) { parent = pivotOf(part.name, part.pivot); off = part.pivot; }
            inst.parent = parent;
            if (off) inst.position.set(-off[0], -off[1], -off[2]);
            if (!IS_MOBILE || id === 'mech') this.view.addShadowCaster(inst, false);
            insts.push(inst);
        }
        root.scaling.setAll(scale);
        return { root, insts, pivots };
    },

    _disposeNode(u) {
        if (!u || !u.node) return;
        for (const i of u.node.insts) { try { this.view.removeShadowCaster(i); i.dispose(); } catch (e) { /* */ } }
        try { u.node.root.dispose(); } catch (e) { /* */ }
        u.node = null;
    },

    // ---------------------------------------------------------------------------------------------
    // Розыск
    // ---------------------------------------------------------------------------------------------

    addHeat(points) {
        this.heat += points;
        const s = KR.starsOf(this.heat);
        if (s !== this.stars) {
            const up = s > this.stars;
            this.stars = s;
            if (s > this.maxStars) this.maxStars = s;
            if (up) { this.spawnT = Math.min(this.spawnT, 0.6); SFX('star_up', { volume: 0.9 }); FX('starUp', s); }
            if (this.hooks.stars) this.hooks.stars(s, up);
        }
    },

    /** Сбросить n звёзд (награда за рекламу): часть техники уходит. */
    reduceStars(n) {
        const s = Math.max(0, this.stars - n);
        this.heat = KR.STARS[s];
        this.stars = s;
        const keep = Math.ceil(this.units.length * 0.35);
        while (this.units.length > keep) { const u = this.units.pop(); this._disposeNode(u); }
        this.shots = [];
        this.spawnT = 8;
        if (this.hooks.stars) this.hooks.stars(s, false);
    },

    count(type) { let n = 0; for (const u of this.units) if (u.type === type) n++; return n; },

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    update(dt, K) {
        const hold = typeof Platform !== 'undefined' && Platform.adActive;      // идёт реклама за награду: армия не стреляет
        this.gunT -= dt;
        if (this.active && K.alive) {
            this.spawnT -= dt;
            if (this.spawnT <= 0 && this.stars > 0) { this.spawnT = KR.RESPAWN_SEC[this.stars] * (IS_MOBILE ? 1.2 : 1); this.reinforce(K); }
        }
        this.flowT -= dt;
        if (this.flowT <= 0) { this.flowT = 0.5; this.buildFlow(K.x, K.z); }
        let police = false, heli = false;
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i];
            if (u.kind === 'ground') this.stepGround(u, dt, K, hold);
            else if (u.kind === 'heli') { this.stepHeli(u, dt, K, hold); heli = true; }
            else this.stepJet(u, dt, K, hold);
            if (u.info.siren) police = true;
            this.syncUnit(u, dt);
        }
        this.stepShots(dt, K);
        this.stepWrecks(dt, K);
        this._loops(police, heli);
    },

    _loops(police, heli) {
        // @ts-ignore — GameAudio объявляет js/GameAudio.js
        const A = typeof GameAudio !== 'undefined' ? GameAudio : null;
        if (!A || !A.loop) return;
        try {
            if (police && !this.sirenLoop) this.sirenLoop = A.loop('siren', { volume: 0.22 });
            else if (!police && this.sirenLoop) { this.sirenLoop.fade(0.6); this.sirenLoop = null; }
            if (heli && !this.heliLoop) this.heliLoop = A.loop('heli', { volume: 0.2 });
            else if (!heli && this.heliLoop) { this.heliLoop.fade(0.6); this.heliLoop = null; }
        } catch (e) { /* без звука */ }
    },

    // --- Подкрепления ----------------------------------------------------------------------------
    reinforce(K) {
        const wave = KR.WAVES[this.stars] || {};
        const types = Object.keys(wave).filter((t) => this.count(t) < Math.max(1, Math.round(wave[t] * (IS_MOBILE ? 0.75 : 1))));
        if (!types.length) return;
        this.spawn(types[Math.floor(Math.random() * types.length)], K);
    },

    spawn(type, K) {
        const info = KR.UNITS[type];
        if (!info) return null;
        const node = this._makeNode(info.model, 0, this.UNIT_SCALE * (info.boss ? 1.25 : 1));
        if (!node) return null;
        const u = {
            type, info, kind: info.kind, node, x: 0, z: 0, y: GameCity.base, heading: 0, vx: 0, vz: 0, hp: info.hp * (1 + this.stars * 0.08),
            fireT: 1 + Math.random() * 2, burstT: 0, t: 0, aim: 0, orbit: Math.random() * Math.PI * 2, orbitDir: Math.random() < 0.5 ? 1 : -1,
            dive: 0, diveT: 4 + Math.random() * 5, phase: 0, shoveT: 0, state: 'go', tx: 0, tz: 0, bombs: 0, r: info.r * this.UNIT_SCALE, h: info.h * this.UNIT_SCALE,
        };
        if (info.kind === 'ground') {
            const p = this._groundSpawn(K);
            u.x = p.x; u.z = p.z; u.heading = Math.atan2(K.z - p.z, K.x - p.x);
        } else if (info.kind === 'heli') {
            const a = Math.random() * Math.PI * 2, d = 3200 + K.height;
            u.x = K.x + Math.cos(a) * d; u.z = K.z + Math.sin(a) * d; u.y = GameCity.base + Math.max(320, K.height * 1.1);
        } else this._jetRun(u, K);
        this.units.push(u);
        return u;
    },

    // Точка въезда: маркер army подальше от кайдзю, иначе свободная клетка на кольце.
    _groundSpawn(K) {
        const pts = GameCity.armyPoints.filter((p) => Math.hypot(p.x - K.x, p.z - K.z) > 1500 + K.height);
        if (pts.length) {
            pts.sort((a, b) => Math.hypot(a.x - K.x, a.z - K.z) - Math.hypot(b.x - K.x, b.z - K.z));
            const p = pts[Math.floor(Math.random() * Math.min(4, pts.length))];
            return { x: p.x + (Math.random() - 0.5) * 120, z: p.z + (Math.random() - 0.5) * 120 };
        }
        const N = GameCity.NAV;
        for (let n = 0; n < 40; n++) {
            const a = Math.random() * Math.PI * 2, d = 1900 + K.height + Math.random() * 900;
            const x = Math.max(300, Math.min(GameCity.mapW - 300, K.x + Math.cos(a) * d)), z = Math.max(300, Math.min(GameCity.mapH - 300, K.z + Math.sin(a) * d));
            if (GameCity.navFree(Math.floor(x / N), Math.floor(z / N))) return { x, z };
        }
        return { x: Math.max(300, K.x - 2000), z: K.z };
    },

    // --- Поле расстояний до кайдзю по свободным клеткам (общий путь всей наземной техники) --------
    buildFlow(kx, kz) {
        const W = GameCity.navW, H = GameCity.navH, N = GameCity.NAV, d = this.dist, q = this.queue, nav = GameCity.nav;
        if (!d.length) return;
        d.fill(65535);
        const si = Math.max(0, Math.min(W - 1, Math.floor(kx / N))), sj = Math.max(0, Math.min(H - 1, Math.floor(kz / N)));
        let head = 0, tail = 0;
        // старт — клетка кайдзю и соседние: он может стоять «в здании»
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
            const i = si + di, j = sj + dj;
            if (i < 0 || j < 0 || i >= W || j >= H) continue;
            const k = j * W + i;
            d[k] = Math.abs(di) + Math.abs(dj); q[tail++] = k;
        }
        while (head < tail) {
            const k = q[head++], i = k % W, j = (k - i) / W, nd = d[k] + 1;
            if (i > 0 && d[k - 1] === 65535 && nav[k - 1] === 0) { d[k - 1] = nd; q[tail++] = k - 1; }
            if (i < W - 1 && d[k + 1] === 65535 && nav[k + 1] === 0) { d[k + 1] = nd; q[tail++] = k + 1; }
            if (j > 0 && d[k - W] === 65535 && nav[k - W] === 0) { d[k - W] = nd; q[tail++] = k - W; }
            if (j < H - 1 && d[k + W] === 65535 && nav[k + W] === 0) { d[k + W] = nd; q[tail++] = k + W; }
        }
    },

    // --- Наземная техника --------------------------------------------------------------------------
    stepGround(u, dt, K, hold) {
        const info = u.info, dx = K.x - u.x, dz = K.z - u.z, dist = Math.hypot(dx, dz);
        const want = info.range * 0.78 + K.radius();
        u.t -= dt;
        let mx = 0, mz = 0;
        if (dist > want) {
            if (u.t <= 0) {
                u.t = 0.25;
                const W = GameCity.navW, N = GameCity.NAV, i = Math.floor(u.x / N), j = Math.floor(u.z / N), d = this.dist;
                let best = 65535, bi = i, bj = j;
                for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                    const ni = i + di, nj = j + dj;
                    if ((!di && !dj) || ni < 0 || nj < 0 || ni >= W || nj >= GameCity.navH) continue;
                    if (di && dj && (!GameCity.navFree(ni, j) || !GameCity.navFree(i, nj))) continue;      // не резать угол здания
                    const v = d[nj * W + ni];
                    if (v < best) { best = v; bi = ni; bj = nj; }
                }
                if (best < 65535) { u.tx = (bi + 0.5) * N; u.tz = (bj + 0.5) * N; } else { u.tx = K.x; u.tz = K.z; }
            }
            const tx = u.tx - u.x, tz = u.tz - u.z, tl = Math.hypot(tx, tz) || 1;
            mx = tx / tl; mz = tz / tl;
        }
        // не толпиться
        for (const o of this.units) {
            if (o === u || o.kind !== 'ground') continue;
            const ox = u.x - o.x, oz = u.z - o.z, od = Math.hypot(ox, oz), min = u.r + o.r + 12;
            if (od < min && od > 0.01) { mx += ox / od * (1 - od / min) * 1.6; mz += oz / od * (1 - od / min) * 1.6; }
        }
        const ml = Math.hypot(mx, mz);
        const sp = ml > 0.05 ? info.speed : 0;
        const k = Math.min(1, dt * 4);
        u.vx += ((ml > 0.05 ? mx / ml : 0) * sp - u.vx) * k; u.vz += ((ml > 0.05 ? mz / ml : 0) * sp - u.vz) * k;
        u.x += u.vx * dt; u.z += u.vz * dt;
        const v = Math.hypot(u.vx, u.vz);
        const face = v > 12 ? Math.atan2(u.vz, u.vx) : Math.atan2(dz, dx);
        u.heading = GameArmy.turnTo(u.heading, face, dt * (v > 12 ? 4 : 1.6));
        u.aim = GameArmy.turnTo(u.aim, Math.atan2(dz, dx), dt * 2.4);
        u.y = /** @type {LoryApp} */ (this.app).location.terrain.fieldHeight(u.x, u.z);
        if (info.boss) u.phase += v * dt * 0.02;
        if (v > 20 && (u.shoveT -= dt) <= 0) { u.shoveT = 0.15; GameTraffic.shove(u.x, u.z, u.r * 0.75, u.vx, u.vz, info.hp > 50); }
        if (!hold && K.alive && dist < info.range + K.radius()) this.fire(u, dt, K, dist);
    },

    // --- Вертолёты: круг над целью, заход в атаку ----------------------------------------------------
    stepHeli(u, dt, K, hold) {
        const info = u.info, H = K.height;
        u.diveT -= dt;
        if (u.diveT <= 0) { u.dive = u.dive > 0 ? 0 : 2.6; u.diveT = u.dive > 0 ? 2.6 : 5 + Math.random() * 5; }
        const R = (u.dive > 0 ? 0.62 : 1) * Math.max(520, H * 1.7 + 260), alt = GameCity.base + (u.dive > 0 ? Math.max(170, H * 0.62) : Math.max(300, H * 1.05 + 120));
        u.orbit += u.orbitDir * dt * info.speed / R * 0.6;
        const tx = K.x + Math.cos(u.orbit) * R, tz = K.z + Math.sin(u.orbit) * R;
        const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(info.speed, d * 2.2);
        const k = Math.min(1, dt * 2.5);
        u.vx += (dx / d * sp - u.vx) * k; u.vz += (dz / d * sp - u.vz) * k;
        u.x += u.vx * dt; u.z += u.vz * dt;
        u.y += (alt + Math.sin(u.orbit * 3) * 14 - u.y) * Math.min(1, dt * 1.4);
        const fx = K.x - u.x, fz = K.z - u.z, dist = Math.hypot(fx, fz);
        u.heading = GameArmy.turnTo(u.heading, Math.atan2(fz, fx), dt * 3);
        u.aim = u.heading;
        if (!hold && K.alive && dist < info.range + K.radius()) this.fire(u, dt, K, dist);
    },

    // --- Самолёты: проход через цель, разворот вдали --------------------------------------------------
    _jetRun(u, K) {
        const a = Math.random() * Math.PI * 2, far = 5200;
        u.x = K.x + Math.cos(a) * far; u.z = K.z + Math.sin(a) * far;
        u.heading = a + Math.PI + (Math.random() - 0.5) * 0.12;
        u.y = GameCity.base + Math.max(560, K.height * 1.35 + 260) + Math.random() * 160;
        u.state = 'run'; u.fireT = 0; u.bombs = u.info.salvo || 2; u.t = 0;
    },

    stepJet(u, dt, K, hold) {
        const info = u.info;
        if (u.state === 'wait') { u.t -= dt; if (u.t <= 0) this._jetRun(u, K); return; }
        // лёгкое доворачивание на цель, пока далеко
        const dx = K.x - u.x, dz = K.z - u.z, dist = Math.hypot(dx, dz);
        const ahead = Math.cos(u.heading) * dx + Math.sin(u.heading) * dz;
        if (ahead > 900) u.heading = GameArmy.turnTo(u.heading, Math.atan2(dz, dx), dt * 0.5);
        u.x += Math.cos(u.heading) * info.speed * dt; u.z += Math.sin(u.heading) * info.speed * dt;
        u.aim = u.heading;
        if (!hold && K.alive && ahead > 0 && u.bombs > 0) {
            u.fireT -= dt;
            if (info.weapon === 'bomb') {
                if (dist < 760 + K.radius() && u.fireT <= 0) { u.fireT = 0.16; u.bombs--; this.shoot(u, 'bomb', K); }
            } else if (dist < info.range && u.fireT <= 0) { u.fireT = 0.22; u.bombs--; this.shoot(u, 'rocket', K); }
        }
        if (ahead < -4200 || u.x < -6000 || u.z < -6000 || u.x > GameCity.mapW + 6000 || u.z > GameCity.mapH + 6000) { u.state = 'wait'; u.t = 2.5 + Math.random() * 3.5; }
        if (ahead < 500 && ahead > 500 - info.speed * dt && dist < 2600) SFX('jet_pass', { volume: 0.8 });
    },

    // --- Огонь ---------------------------------------------------------------------------------------
    fire(u, dt, K, dist) {
        const info = u.info;
        if (info.weapon === 'laser') {                           // мазер: луч держится burst секунд, потом остывает
            if (u.burstT > 0) {
                u.burstT -= dt; u.fireT -= dt;
                if (u.fireT <= 0) {
                    u.fireT = 0.1;
                    const m = this.muzzle(u), ty = K.y + K.height * 0.55;
                    FX('tracer', m.x, m.y, m.z, K.x, ty, K.z, 'laser');
                    K.hurt(info.dmg * 0.1, K.x, ty, K.z, 'laser');
                }
                if (u.burstT <= 0) u.fireT = info.rate;
            } else { u.fireT -= dt; if (u.fireT <= 0) { u.burstT = info.burst || 2; u.fireT = 0; SFX('laser', { volume: 0.7 }); } }
            return;
        }
        u.fireT -= dt;
        if (u.fireT > 0) return;
        if (info.weapon === 'gun') {
            u.fireT = info.rate * (0.8 + Math.random() * 0.4);
            const m = this.muzzle(u), sp = K.height * 0.16;
            const tx = K.x + (Math.random() - 0.5) * sp * 2, ty = K.y + K.height * (0.25 + Math.random() * 0.55), tz = K.z + (Math.random() - 0.5) * sp * 2;
            FX('tracer', m.x, m.y, m.z, tx, ty, tz, 'bullet');
            if (this.gunT <= 0) { SFX('gun', { volume: 0.35 }); this.gunT = 0.11; }
            if (Math.random() < 0.8) K.hurt(info.dmg, tx, ty, tz, 'gun');
            return;
        }
        const n = info.salvo || 1;
        u.fireT = info.rate * (0.85 + Math.random() * 0.3);
        for (let i = 0; i < n; i++) this.shoot(u, info.weapon, K, i * 0.12);
        void dist;
    },

    muzzle(u) {
        const o = GameArmy._m, c = Math.cos(u.aim), s = Math.sin(u.aim);
        o.x = u.x + c * u.r * 0.9; o.z = u.z + s * u.r * 0.9; o.y = u.y + (u.kind === 'ground' ? u.h * 0.8 : -u.h * 0.2);
        return o;
    },

    /** Выпустить снаряд: shell — по дуге, rocket — самонаводящаяся, bomb — падает. */
    shoot(u, kind, K, delay) {
        if (this.shots.length > 70) return;
        const m = this.muzzle(u), info = u.info;
        const s = { kind, x: m.x, y: m.y, z: m.z, vx: 0, vy: 0, vz: 0, dmg: info.dmg * (1 + this.stars * 0.05), life: 6, delay: delay || 0, trail: null, blast: kind === 'bomb' ? 230 : kind === 'shell' ? 110 : 90 };
        const tx = K.x + (Math.random() - 0.5) * K.height * 0.25, tz = K.z + (Math.random() - 0.5) * K.height * 0.25, ty = K.y + K.height * (kind === 'shell' ? 0.35 : 0.55);
        const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz) || 1;
        if (kind === 'shell') {
            const T = Math.max(0.35, d / 1000), g = 520;
            s.vx = dx / T; s.vz = dz / T; s.vy = (ty - m.y) / T + 0.5 * g * T;
            SFX('cannon', { volume: 0.8 });
        } else if (kind === 'rocket') {
            const sp = u.kind === 'jet' ? 1500 : 620, up = u.kind === 'ground' ? 0.9 : 0.05;
            s.vx = dx / d * sp + (Math.random() - 0.5) * 160; s.vz = dz / d * sp + (Math.random() - 0.5) * 160; s.vy = sp * up;
            s.life = 5;
            SFX('rocket_launch', { volume: 0.6 });
        } else {
            s.vx = Math.cos(u.heading) * info.speed * 0.55; s.vz = Math.sin(u.heading) * info.speed * 0.55; s.vy = -40; s.life = 8;
        }
        FX('muzzle', m.x, m.y, m.z, kind);
        this.shots.push(s);
    },

    stepShots(dt, K) {
        const base = GameCity.base;
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i];
            if (s.delay > 0) { s.delay -= dt; continue; }
            if (!s.trail && s.kind !== 'shell') s.trail = FX('trail', s, s.kind);
            if (s.kind === 'shell') s.vy -= 520 * dt;
            else if (s.kind === 'bomb') s.vy -= 380 * dt;
            else {                                               // ракета: доворот на цель с пределом
                const tx = K.x - s.x, ty = K.y + K.height * 0.5 - s.y, tz = K.z - s.z, tl = Math.hypot(tx, ty, tz) || 1;
                const sp = Math.min(1500, Math.hypot(s.vx, s.vy, s.vz) + 500 * dt), k = Math.min(1, dt * 2.6);
                let vx = s.vx + (tx / tl * sp - s.vx) * k, vy = s.vy + (ty / tl * sp - s.vy) * k, vz = s.vz + (tz / tl * sp - s.vz) * k;
                const vl = Math.hypot(vx, vy, vz) || 1;
                s.vx = vx / vl * sp; s.vy = vy / vl * sp; s.vz = vz / vl * sp;
            }
            s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
            s.life -= dt;
            const hd = Math.hypot(s.x - K.x, s.z - K.z);
            const hitK = K.alive && hd < K.radius() * 1.5 + 14 && s.y > K.y - 10 && s.y < K.y + K.height * 1.02;
            const ground = s.y <= base + GameDebris.pileAt(s.x, s.z) + 2;
            const wall = !hitK && !ground && s.kind !== 'rocket' && GameCity.heightAt(s.x, s.z) > s.y;
            if (!hitK && !ground && !wall && s.life > 0) continue;
            if (s.trail && s.trail.stop) s.trail.stop();
            this.shots.splice(i, 1);
            const y = Math.max(s.y, base + 4);
            FX('explosion', s.x, y, s.z, s.kind === 'bomb' ? 2 : 1);
            SFX(s.kind === 'bomb' ? 'explosion_m' : 'missile_hit', { volume: 0.7 });
            if (hitK) K.hurt(s.dmg, s.x, y, s.z, s.kind);
            else if (K.alive && Math.hypot(s.x - K.x, s.z - K.z) < s.blast + K.radius() && y < K.y + K.height) K.hurt(s.dmg * 0.5, s.x, y, s.z, s.kind);
            // промах — по городу: армия тоже крушит кварталы
            GameCity._breakBudget += 6;
            GameCity.hitSphere(s.x, y, s.z, s.blast * 0.75, s.kind === 'bomb' ? 60 : 26, null, 240);
            if (ground) GameCity.scar(s.x, s.z, s.blast * 0.6, 'scorch', 0.8);
            GameDebris.impulse(s.x, y, s.z, s.blast * 1.4, 300, 0.7);
            GameTraffic.blast(s.x, y, s.z, s.blast * 0.8, 0);
            GameCrowd.scare(s.x, s.z, s.blast * 3 + 150);
        }
    },

    // --- Положение модели ----------------------------------------------------------------------------
    syncUnit(u, dt) {
        const n = u.node;
        if (!n) return;
        n.root.position.set(u.x, u.y, u.z);
        n.root.rotation.y = -u.heading;
        const p = n.pivots;
        if (p.turret) p.turret.rotation.y = -(u.aim - u.heading);
        if (p.Rotor) p.Rotor.rotation.y += dt * 34;
        if (p.TailRotor) p.TailRotor.rotation.z += dt * 40;
        if (p.LegL) { p.LegL.rotation.z = Math.sin(u.phase) * 0.5; p.LegR.rotation.z = -Math.sin(u.phase) * 0.5; n.root.position.y = u.y + Math.abs(Math.cos(u.phase)) * 6; }
        if (u.kind === 'heli') { n.root.rotation.z = -Math.min(0.3, Math.hypot(u.vx, u.vz) / 1600); }
        if (u.kind === 'jet') n.root.rotation.x = Math.sin(u.x * 0.002) * 0.15;
    },

    // ---------------------------------------------------------------------------------------------
    // Урон технике от кайдзю
    // ---------------------------------------------------------------------------------------------

    /** Сфера удара; возвращает число уничтоженных. */
    hitSphere(x, y, z, radius, dmg) {
        let n = 0;
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i], cy = u.y + u.h * 0.5;
            if (Math.hypot(u.x - x, cy - y, u.z - z) > radius + u.r) continue;
            if (this.damage(u, dmg, i)) n++;
        }
        this._pushWrecks(x, z, radius, 260);
        return n;
    },

    /** Луч (отрезок a -> b толщиной r). */
    hitBeam(ax, ay, az, bx, by, bz, r, dmg) {
        const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1;
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i], px = u.x - ax, py = u.y + u.h * 0.5 - ay, pz = u.z - az;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / l2));
            if (Math.hypot(px - dx * t, py - dy * t, pz - dz * t) > r + u.r) continue;
            this.damage(u, dmg, i);
        }
    },

    /** Под ногой и корпусом кайдзю: наземная техника получает урон, машины разлетаются. */
    trample(x, z, radius, dmg) {
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i];
            if (u.kind !== 'ground' || Math.hypot(u.x - x, u.z - z) > radius + u.r * 0.6) continue;
            this.damage(u, dmg, i);
        }
        this._pushWrecks(x, z, radius, 200);
    },

    damage(u, dmg, index) {
        u.hp -= dmg;
        if (u.hp > 0) { FX('unitHit', u.x, u.y + u.h * 0.5, u.z); return false; }
        const i = index != null ? index : this.units.indexOf(u);
        if (i >= 0) this.units.splice(i, 1);
        const info = u.info, size = info.boss ? 3 : info.hp > 50 ? 2 : 1, y = u.y + u.h * 0.5;
        FX('explosion', u.x, y, u.z, size);
        SFX(size >= 3 ? 'explosion_l' : size === 2 ? 'explosion_m' : 'explosion_s', { volume: 0.9 });
        if (typeof GameDebris.shatterBox === 'function') GameDebris.shatterBox(u.x, y, u.z, u.r * 1.2, u.h, u.r, -u.heading, u.kind === 'ground' ? 0x3a4030 : 0x4a4e54, null, 300, size + 2, 0);
        if (u.kind === 'ground') this._wreckGround(u); else this._fall(u);
        this.kills++;
        this.addHeat(info.score * 0.6);
        if (this.hooks.score) this.hooks.score(info.score, u.x, y, u.z, 'unit', info.coins);
        return true;
    },

    // ---------------------------------------------------------------------------------------------
    // Гибель техники: корпуса-тела GamePhysics, падение вертолётов и самолётов
    // ---------------------------------------------------------------------------------------------

    // Обугленный вид: инстансы частей заменяются инстансами тёмного прототипа той же модели.
    _char(u) {
        const id = u.info.model, n = u.node;
        if (!n || !this.models[id]) return;
        if (!this.burnt[id]) this.burnt[id] = this._proto(this.models[id], this.view.scene, id, 0, true);
        const parts = this.burnt[id].parts;
        for (let k = 0; k < n.insts.length && k < parts.length; k++) {
            const old = n.insts[k], inst = parts[k].mesh.createInstance('w-' + parts[k].name);
            inst.isPickable = false; inst.parent = old.parent; inst.position.copyFrom(old.position);
            if (!IS_MOBILE) this.view.addShadowCaster(inst, false);
            try { this.view.removeShadowCaster(old); old.dispose(); } catch (e) { /* */ }
            n.insts[k] = inst;
        }
    },

    // Наземная техника подбита: корпус кувыркается телом физики, башня (у меха — торс с руками) отлетает отдельно.
    _wreckGround(u) {
        const n = u.node;
        if (!n) return;
        this._char(u);
        if (!GamePhysics.ready || !GamePhysics.world) { this._disposeNode(u); return; }
        const r = Math.random;
        let ax = u.x - GameKaiju.x, az = u.z - GameKaiju.z;
        const al = Math.hypot(ax, az) || 1, p = (200 + r() * 180) / (u.info.boss ? 2.2 : u.info.hp > 50 ? 1.5 : 1);
        ax /= al; az /= al;
        const tp = n.pivots.turret;
        let hullH = u.h;
        if (tp) {
            tp.computeWorldMatrix(true);
            const wp = tp.getAbsolutePosition().clone(), tin = [], rest = [];
            for (const inst of n.insts) (inst.parent === tp ? tin : rest).push(inst);
            n.insts = rest;
            tp.setParent(null);
            hullH = Math.max(u.h * 0.45, wp.y - u.y);
            const hy = Math.max(6, (u.y + u.h - wp.y) * 0.5), hx = u.r * (u.info.boss ? 0.5 : 0.42);
            this._addWreck({ root: tp, insts: tin, pivots: {} }, wp.x, wp.y + hy, wp.z, hx, hy, hx * 0.7, -u.aim, hy,
                ax * p * 0.5 + (r() - 0.5) * 140, 300 + r() * 220, az * p * 0.5 + (r() - 0.5) * 140, 1);
        }
        const hy = hullH * 0.5;
        this._addWreck(n, u.x, u.y + hy, u.z, u.r * 0.9, hy, u.r * 0.5, -u.heading, hy, ax * p, 150 + r() * 170, az * p, u.info.boss ? 0.3 : 0.8);
        u.node = null;
    },

    // Корпус-тело: node — { root, insts, pivots }; oy — на сколько начало модели ниже центра тела.
    _addWreck(node, x, y, z, hx, hy, hz, yaw, oy, vx, vy, vz, spin) {
        const r = Math.random;
        const id = GamePhysics.addBox(x, y, z, hx, hy, hz, {
            yaw, vx, vy, vz, wx: (r() - 0.5) * 8 * spin, wy: (r() - 0.5) * 5 * spin, wz: (r() - 0.5) * 8 * spin,
            density: 1.4, friction: 0.7, restitution: 0.15, angDamp: 0.5, member: GamePhysics.G_VEHICLE, filter: GamePhysics.G_ALL,
        });
        if (id < 0) { this._disposeNode({ node }); return; }
        this._world = GamePhysics.world;
        if (!node.root.rotationQuaternion) node.root.rotationQuaternion = new BABYLON.Quaternion();
        this.wrecks.push({ kind: 'body', node, body: id, oy, life: this.WRECK_LIFE, t: 0, x, y, z, r: hx, h: hy * 2, smoke: false, trail: null });
    },

    // Вертолёт и самолёт подбиты: дымный след, падение, взрыв о землю или дом.
    _fall(u) {
        const n = u.node;
        if (!n) return;
        this._char(u);
        const jet = u.kind === 'jet', r = Math.random, c = Math.cos(u.heading), s = Math.sin(u.heading);
        /** @type {any} */
        const w = {
            kind: jet ? 'jet' : 'heli', node: n, body: -1, life: 7, t: 0, x: u.x, y: u.y, z: u.z, heading: u.heading, r: u.r, h: u.h, big: u.info.hp > 50,
            vx: jet ? c * u.info.speed * 0.5 : u.vx + (r() - 0.5) * 120, vy: jet ? -60 : 40, vz: jet ? s * u.info.speed * 0.5 : u.vz + (r() - 0.5) * 120,
            spin: jet ? (r() < 0.5 ? -1 : 1) * (4 + r() * 3) : 4, roll: 0, trail: null, oy: 0, smoke: false,
        };
        w.trail = FX('trail', w, 'rocket');
        this.wrecks.push(w);
        u.node = null;
    },

    stepWrecks(dt, K) {
        const W = this.wrecks, p = this._p7, base = GameCity.base;
        const live = GamePhysics.ready && !!GamePhysics.world && GamePhysics.world === this._world;
        let bodies = 0;
        for (const w of W) if (w.kind === 'body') bodies++;
        for (let i = 0; i < W.length && bodies > this.WRECK_CAP; i++) if (W[i].kind === 'body' && W[i].life > 0) { W[i].life = 0; bodies--; }
        for (let i = W.length - 1; i >= 0; i--) {
            const w = W[i], n = w.node, root = n.root;
            w.life -= dt; w.t += dt;
            if (w.kind === 'body') {
                if (w.body >= 0 && live && GamePhysics.read(w.body, p)) {
                    const qx = p[3], qy = p[4], qz = p[5], qw = p[6];
                    root.position.set(p[0] - 2 * (qx * qy - qz * qw) * w.oy, p[1] - (1 - 2 * (qz * qz + qx * qx)) * w.oy, p[2] - 2 * (qy * qz + qx * qw) * w.oy);
                    root.rotationQuaternion.set(qx, qy, qz, qw);
                    w.x = p[0]; w.y = p[1]; w.z = p[2];
                    if (w.y < base - 300) w.life = 0;
                    else if (w.t > 0.6 && GamePhysics.asleep(w.body)) {
                        GamePhysics.remove(w.body); w.body = -1;
                        if (!w.smoke) { w.smoke = true; FX('smokeColumn', w.x, w.y, w.z, 8 + Math.random() * 6, w.r); }
                    }
                } else if (w.body >= 0 && !live) w.body = -1;
                if (w.life <= 0) {
                    if (w.body >= 0 && live) GamePhysics.remove(w.body);
                    FX('impactPuff', w.x, w.y, w.z, w.r * 2, 0x55595e);
                    this._disposeNode(w);
                    W.splice(i, 1);
                }
                continue;
            }
            if (w.kind === 'heli') {
                w.vy -= 340 * dt;
                const k = Math.max(0, 1 - 0.5 * dt);
                w.vx *= k; w.vz *= k;
                w.spin = Math.min(15, w.spin + 7 * dt); w.heading += w.spin * dt;
                root.rotation.set(Math.sin(w.t * 6) * 0.35, -w.heading, -0.25 - Math.min(0.5, w.t * 0.3));
                if (n.pivots.Rotor) n.pivots.Rotor.rotation.y += dt * 18;
            } else {
                w.vy -= 560 * dt;
                const k = Math.max(0, 1 - 0.9 * dt);
                w.vx *= k; w.vz *= k;
                w.roll += w.spin * dt;
                root.rotation.set(w.roll, -w.heading, Math.atan2(w.vy, Math.hypot(w.vx, w.vz) || 1) * 0.8);
            }
            w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
            root.position.set(w.x, w.y, w.z);
            const pile = typeof GameDebris.pileAt === 'function' ? GameDebris.pileAt(w.x, w.z) : 0;
            if (w.y <= base + pile + 4 || w.life <= 0 || GameCity.heightAt(w.x, w.z) > w.y - w.h * 0.3) this._crash(w, i);
        }
        void K;
    },

    // Упавший вертолёт или самолёт взрывается; от вертолёта остаётся корпус.
    _crash(w, i) {
        const y = Math.max(w.y, GameCity.base + 8), jet = w.kind === 'jet', r = Math.random;
        if (w.trail && w.trail.stop) w.trail.stop();
        w.trail = null;
        this.wrecks.splice(i, 1);
        const radius = jet ? (w.big ? 330 : 210) : (w.big ? 190 : 150);
        GameCity.explode(w.x, y, w.z, radius, jet ? 70 : 40, true);
        FX('carExplode', w.x, y, w.z, radius / 100);
        FX('shake', jet ? 0.5 : 0.35, 350);
        if (typeof GameDebris.shatterBox === 'function') GameDebris.shatterBox(w.x, y, w.z, w.r, w.h, w.r, 0, 0x2c2f34, null, 320, jet ? 8 : 5, 0);
        GameCrowd.scare(w.x, w.z, radius * 3);
        if (jet || !GamePhysics.ready || !GamePhysics.world) { this._disposeNode(w); return; }
        const hy = w.h * 0.45;
        w.node.root.rotation.set(0, 0, 0);
        this._addWreck(w.node, w.x - w.vx * 0.04, y + hy, w.z - w.vz * 0.04, w.r * 0.8, hy, w.r * 0.35, -w.heading, hy,
            -w.vx * 0.3 + (r() - 0.5) * 120, 170 + r() * 130, -w.vz * 0.3 + (r() - 0.5) * 120, 1);
    },

    // Корпуса подбитой техники отлетают от удара и взрыва.
    _pushWrecks(x, z, radius, power) {
        if (!GamePhysics.ready || GamePhysics.world !== this._world) return;
        for (const w of this.wrecks) {
            if (w.kind !== 'body') continue;
            const dx = w.x - x, dz = w.z - z, d = Math.hypot(dx, dz);
            if (d > radius + w.r) continue;
            if (w.body < 0) continue;
            GamePhysics.wake(w.body);
            GamePhysics.push(w.body, dx / (d || 1) * power, power * 0.6, dz / (d || 1) * power);
            w.t = 0;
        }
    },

    _clearWrecks() {
        const live = GamePhysics.ready && !!GamePhysics.world && GamePhysics.world === this._world;
        for (const w of this.wrecks) {
            if (w.trail && w.trail.stop) { try { w.trail.stop(); } catch (e) { /* */ } }
            if (w.body >= 0 && live) GamePhysics.remove(w.body);
            this._disposeNode(w);
        }
        this.wrecks = [];
    },

    /** Взрыв (бак, прыжок-удар): урон технике в радиусе. */
    blast(x, y, z, radius, dmg) {
        if (dmg > 0) this.hitSphere(x, y, z, radius, dmg); else this._pushWrecks(x, z, radius, 220);
    },
};
