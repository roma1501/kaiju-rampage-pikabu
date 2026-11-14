// GameKaiju.js — кайдзю игрока: риг из Blender (assets/models/kaiju/<вид>.glb, жёсткие части на костях), вся анимация
// процедурная — игра сама пишет повороты костей (шаг, удары когтями, хвост, прыжок-удар, луч, рёв, урон, гибель).
// Движение, столкновения и урон считаются по своим числам (инвариант 4), риг — только вид.
//
// Оси кости = оси модели (рецепт Blender → Rig): X вперёд, Y вверх, Z вправо. Поворот кости задаётся тремя углами:
//   swing — вокруг Z: у висящей вниз конечности «+» = вперёд; у позвоночника, шеи и головы «−» = наклон вперёд;
//   yaw   — вокруг Y: «+» = влево;   side — вокруг X: «+» = наклон вправо.
// Координаты: x, z — карта (z = y карты), y — высота; курс heading — радианы (0 — вдоль +x, π/2 — вниз по карте).

/** @satisfies {Record<string, any>} */
const GameKaiju = {
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ view: null,
    /** @type {any} */ rig: null,
    /** @type {Record<string, any>} */ nodes: {},
    /** @type {Record<string, any[]>} */ mats: {},
    species: '', loading: false,
    x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, turn: 0,
    level: 1, scale: 1, scaleTo: 1, scaleT: 1, height: 300,
    hp: 100, maxHp: 100, energy: 1, alive: true, invuln: 0, rage: 0,
    // анимация
    phase: 0, moveK: 0, time: 0,
    /** @type {'' | 'clawR' | 'clawL' | 'tail' | 'slam'} */ attack: '',
    attackT: 0, attackHit: 0, combo: 0, comboT: 0, cooldown: 0,
    breath: false, breathT: 0, breathTick: 0, breathK: 0,
    hurtT: 0, roarT: 0, deadT: 0, jumpY: 0, spin: 0, ramT: 0, trampleT: 0, stepSide: 0,
    /** @type {any} */ look: {},
    /** @type {any[]} */ accMeshes: [],
    /** @type {{ core: string, glow: string, style: string }} */ breathStyle: { core: '#e8fbff', glow: '#35c8ff', style: 'beam' },
    /** Хуки игры: hit(x, y, z, r, dmg, dir, power) — техника; blast(...); step(x, z, side); died(); levelUp(level). */
    /** @type {Record<string, Function>} */ hooks: {},
    SW: 1, YW: 1, SD: 1,          // знаки осей (проверены в браузере)
    /** @type {any} */ _q: null,
    _v0: { x: 0, y: 0, z: 0 }, _scaleFrom: 1, _beamLen: 0, slamDash: 0, scorchT: 0,
    /** Уровни прокачки умений (сохранение игры): claws, slam, breath, nova, meteor, nuke. */
    /** @type {Record<string, number>} */ skillLv: {},
    /** @type {Record<string, boolean>} */ skillOwn: {},      // купленные умения: доступны с начала раунда
    /** Перезарядка умений, секунды, и её полная длительность (для кнопок HUD). */
    /** @type {Record<string, number>} */ cds: { slam: 0, nova: 0, meteor: 0, nuke: 0 },
    /** @type {Record<string, number>} */ cdMax: { slam: 1, nova: 1, meteor: 1, nuke: 1 },
    /** @type {any[]} */ waves: [],
    /** @type {any[]} */ meteors: [],

    /** Множители умения по его прокачке: { dmg, rad, cd }. */
    sk(id) { return KR.skillMul(this.skillLv[id] || 1); },
    /** Умение куплено (уровнем кайдзю умения больше не открываются — только покупка за монеты или рекламу). */
    can(id) { return !!KR.SKILLS[id] && !!this.skillOwn[id]; },

    /** Ключевые кадры: kf(t, t0, v0, t1, v1, …) — плавная (smoothstep) интерполяция между парами. */
    kf(t, ...k) {
        if (t <= k[0]) return k[1];
        for (let i = 2; i < k.length; i += 2) {
            if (t <= k[i]) { const u = (t - k[i - 2]) / (k[i] - k[i - 2]), e = u * u * (3 - 2 * u); return k[i - 1] + (k[i + 1] - k[i - 1]) * e; }
        }
        return k[k.length - 1];
    },

    // Пути моделей — литералами (сборщик берёт в архив только такие ссылки).
    MODELS: {
        titan: 'assets/models/kaiju/titan.glb', rex: 'assets/models/kaiju/rex.glb', ape: 'assets/models/kaiju/ape.glb',
        mecha: 'assets/models/kaiju/mecha.glb', drake: 'assets/models/kaiju/drake.glb', golem: 'assets/models/kaiju/golem.glb',
        deep: 'assets/models/kaiju/deep.glb', beetle: 'assets/models/kaiju/beetle.glb',
    },

    // ---------------------------------------------------------------------------------------------
    // Риг
    // ---------------------------------------------------------------------------------------------

    /** Загрузить вид (модель) и поставить риг. Повторяемо. */
    async setSpecies(app, id) {
        this.app = app; this.view = app.location.view;
        const species = this.MODELS[id] ? id : 'titan';
        if (this.rig && this.species === species && !this.rig.disposed && this.rig.view === this.view) return;
        this.loading = true;
        let rig = null;
        try {
            rig = await Rig.spawn(this.MODELS[species], this.view, { name: 'kaiju', kind: 'actor' });
        } catch (e) { console.warn('GameKaiju: модель «' + species + '» не загрузилась, запасной вид:', e); }
        this.disposeRig();
        this.rig = rig || this.fallbackRig();
        this.species = species;
        this.nodes = {};
        this.rig.nodes.forEach((tn, name) => {
            if (!tn.rotationQuaternion) tn.rotationQuaternion = BABYLON.Quaternion.Identity();
            this.nodes[name] = { tn, p: tn.position.clone(), q: tn.rotationQuaternion.clone() };
        });
        // материалы по ролям: имя материала «…/роль»
        this.mats = {};
        for (const m of this.rig._meshes || []) {
            const mat = m.material, list = mat ? (mat.subMaterials || [mat]) : [];
            for (const sm of list) {
                if (!sm) continue;
                const role = String(sm.name).split('/').pop();
                const arr = this.mats[role] || (this.mats[role] = []);
                if (arr.indexOf(sm) < 0) { arr.push(sm); if (!sm.metadata || !sm.metadata.kaijuBase) sm.metadata = Object.assign({}, sm.metadata, { kaijuBase: sm.diffuseColor.clone() }); }
            }
        }
        this.loading = false;
        this.applyLook(this.look, true);
        this.syncRoot();
        this.animate(0);
    },

    disposeRig() {
        for (const m of this.accMeshes) { try { World3D.removeObject(this.view, m); } catch (e) { /* */ } }
        this.accMeshes = [];
        if (this.rig) { try { this.rig.dispose(); } catch (e) { /* сцена убрана */ } }
        this.rig = null;
    },

    // Запасной вид из коробок с теми же именами костей (модель не загрузилась) — игра не падает.
    fallbackRig() {
        const scene = this.view.scene, root = new BABYLON.Mesh('kaiju-fallback', scene), nodes = new Map(), meshes = [];
        const mat = new BABYLON.StandardMaterial('kaiju/primary', scene); mat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.5);
        const B = [['Root', null, 0, 0, 0, 0, 0, 0], ['Hips', 'Root', 0, 125, 0, 90, 60, 110], ['Spine', 'Hips', 0, 160, 0, 80, 60, 100], ['Chest', 'Spine', 0, 200, 0, 90, 70, 120],
            ['Neck', 'Chest', 15, 240, 0, 40, 30, 50], ['Head', 'Neck', 25, 255, 0, 90, 50, 70], ['Jaw', 'Head', 30, 250, 0, 70, 12, 60], ['Mouth', 'Head', 100, 252, 0, 0, 0, 0], ['HeadTop', 'Head', 45, 300, 0, 0, 0, 0], ['Back', 'Chest', -40, 215, 0, 0, 0, 0],
            ['Arm_L', 'Chest', 10, 215, -70, 30, 60, 30], ['Forearm_L', 'Arm_L', 20, 170, -72, 28, 50, 28], ['Hand_L', 'Forearm_L', 40, 150, -72, 30, 20, 30],
            ['Arm_R', 'Chest', 10, 215, 70, 30, 60, 30], ['Forearm_R', 'Arm_R', 20, 170, 72, 28, 50, 28], ['Hand_R', 'Forearm_R', 40, 150, 72, 30, 20, 30],
            ['Leg_L', 'Hips', 0, 120, -42, 50, 70, 50], ['Shin_L', 'Leg_L', 0, 70, -42, 44, 60, 44], ['Foot_L', 'Shin_L', 0, 24, -42, 80, 24, 50],
            ['Leg_R', 'Hips', 0, 120, 42, 50, 70, 50], ['Shin_R', 'Leg_R', 0, 70, 42, 44, 60, 44], ['Foot_R', 'Shin_R', 0, 24, 42, 80, 24, 50],
            ['Tail1', 'Hips', -50, 110, 0, 70, 50, 60], ['Tail2', 'Tail1', -100, 90, 0, 60, 40, 46], ['Tail3', 'Tail2', -150, 70, 0, 54, 30, 34], ['Tail4', 'Tail3', -195, 55, 0, 50, 20, 22]];
        const world = new Map();
        for (const [name, parent, x, y, z, w, h, d] of B) {
            const tn = new BABYLON.TransformNode('kaiju:' + name, scene), pw = parent ? world.get(parent) : [0, 0, 0];
            tn.parent = parent ? nodes.get(parent) : root;
            tn.position.set(/** @type {number} */ (x) - pw[0], /** @type {number} */ (y) - pw[1], /** @type {number} */ (z) - pw[2]);
            tn.rotationQuaternion = BABYLON.Quaternion.Identity();
            nodes.set(name, tn); world.set(name, [x, y, z]);
            if (w) {
                const m = BABYLON.MeshBuilder.CreateBox('kaiju/' + name, { width: /** @type {number} */ (w), height: /** @type {number} */ (h), depth: /** @type {number} */ (d) }, scene);
                m.material = mat; m.parent = tn;
                const down = /Arm|Leg|Shin|Forearm/.test(String(name)) ? -/** @type {number} */ (h) / 2 : 0, back = /Tail/.test(String(name)) ? -/** @type {number} */ (w) / 2 : /Head|Jaw/.test(String(name)) ? /** @type {number} */ (w) / 2 - 10 : 0;
                m.position.set(back, down + (/Hips|Spine|Chest|Neck|Head$/.test(String(name)) ? /** @type {number} */ (h) / 2 : 0), 0);
                meshes.push(m);
            }
        }
        World3D.addObject(this.view, root, 'actor');
        return { root, nodes, _meshes: meshes, view: this.view, disposed: false, height: 300, dispose() { this.disposed = true; World3D.removeObject(this.view, root); } };
    },

    // ---------------------------------------------------------------------------------------------
    // Облик: палитра, украшения, луч
    // ---------------------------------------------------------------------------------------------

    /**
     * Надеть облик (Shop.look()): { species, palette: { primary, secondary, accent, claw, eye, glow, dark, fx }, acc: { kind, color },
     * breath: { core, glow, style }, aura }. Вид меняется асинхронно (setSpecies).
     */
    applyLook(look, keepSpecies) {
        this.look = look || {};
        const L = this.look;
        if (!keepSpecies && L.species && L.species !== this.species && this.app && !this.loading) { this.setSpecies(this.app, L.species); return; }
        const pal = L.palette || null, C3 = BABYLON.Color3;
        for (const role of Object.keys(this.mats)) for (const m of this.mats[role]) {
            const hex = pal && pal[role];
            m.diffuseColor = hex ? C3.FromHexString(hex) : m.metadata.kaijuBase.clone();
            m.emissiveColor = role === 'glow' ? m.diffuseColor.scale(0.85) : role === 'eye' ? m.diffuseColor.scale(0.5) : new C3(0, 0, 0);
            m.alpha = pal && pal.fx === 'ghost' && role !== 'eye' && role !== 'glow' ? 0.72 : 1;
            const shiny = pal && (pal.fx === 'metal' || pal.fx === 'gold') && (role === 'primary' || role === 'accent' || role === 'secondary');
            m.specularColor = shiny ? new C3(0.9, 0.9, 0.9) : new C3(0.08, 0.08, 0.08);
            m.specularPower = shiny ? 48 : 20;
        }
        if (L.breath) this.breathStyle = Object.assign({ core: '#e8fbff', glow: '#35c8ff', style: 'beam' }, L.breath);
        else this.breathStyle = { core: '#e8fbff', glow: '#35c8ff', style: 'beam' };
        this.applyAccessory(L.acc || null);
        FX('aura', L.aura || null);
    },

    // Украшение: меш из GameCosmetics.build(kind, scene, color) в единицах модели (рост 300), на кости HeadTop или Back.
    applyAccessory(acc) {
        for (const m of this.accMeshes) { try { World3D.removeObject(this.view, m); } catch (e) { /* */ } }
        this.accMeshes = [];
        // @ts-ignore — GameCosmetics объявляет js/GameShopData.js
        const cos = typeof GameCosmetics !== 'undefined' ? GameCosmetics : null;
        if (!acc || !cos || !this.rig) return;
        try {
            const made = cos.build(acc.kind, this.view.scene, acc);
            for (const it of [].concat(made || [])) {
                const node = this.nodes[it.node || 'HeadTop'] || this.nodes.Head;
                if (!node || !it.mesh) continue;
                it.mesh.parent = node.tn;
                World3D.addObject(this.view, it.mesh, 'actor');
                this.accMeshes.push(it.mesh);
            }
        } catch (e) { console.warn('GameKaiju: украшение не собралось:', e); }
    },

    // ---------------------------------------------------------------------------------------------
    // Состояние раунда
    // ---------------------------------------------------------------------------------------------

    /** Поставить кайдзю в точку карты и сбросить раунд. */
    reset(x, z, heading, level) {
        this.x = x; this.z = z; this.heading = heading || 0;
        this.vx = this.vz = this.speed = this.turn = 0;
        this.level = level || 1;
        this.scale = this.scaleTo = KR.scaleOf(this.level); this.scaleT = 1;
        this.height = KR.BASE_HEIGHT * this.scale;
        this.maxHp = KR.hpOf(this.level); this.hp = this.maxHp;
        this.energy = 1; this.alive = true; this.invuln = 0; this.rage = 0;
        this.attack = ''; this.attackT = 0; this.combo = 0; this.cooldown = 0;
        this.breath = false; this.breathK = 0; this.hurtT = 0; this.roarT = 0; this.deadT = 0; this.jumpY = 0; this.spin = 0;
        for (const m of this.meteors) if (m.fx && m.fx.stop) m.fx.stop();
        this.meteors = []; this.waves = [];
        this.cds = { slam: 0, nova: 0, meteor: 0, nuke: 0 };
        FX('breathEnd');
        this.syncRoot();
    },

    radius() { return this.height * 0.2; },
    damage() { return KR.BASE_DAMAGE * Math.pow(this.scale, 1.25) * (this.rage > 0 ? 2 : 1); },
    maxSpeed() { return KR.BASE_SPEED * Math.pow(this.scale, 0.8) * (this.rage > 0 ? 1.25 : 1); },

    /** Новый уровень: вырасти и вылечиться — без остановки игры (вспышка и звук остаются). */
    setLevel(level, silent) {
        if (level === this.level) return;
        const up = level > this.level;
        this.level = level;
        this.scaleTo = KR.scaleOf(level); this.scaleT = silent ? 1 : 0; this._scaleFrom = this.scale;
        if (silent) this.scale = this.scaleTo;
        const max = KR.hpOf(level);
        this.hp = Math.min(max, this.hp + (max - this.maxHp) + (up ? max * 0.4 : 0));
        this.maxHp = max;
        if (up && !silent) {
            this.invuln = Math.max(this.invuln, 0.6);
            SFX(level >= 6 ? 'roar_big' : 'roar', { volume: 0.8 }); SFX('level_up', { volume: 0.8 });
            FX('levelUp', this.x, this.y, this.z, KR.BASE_HEIGHT * this.scaleTo);
            FX('shake', 0.7, 700);
            GameDebris.impulse(this.x, this.y, this.z, this.height * 1.6, 300, 0.8);
            if (this.hooks.levelUp) this.hooks.levelUp(level);
            for (const id of Object.keys(KR.SKILLS)) if (KR.SKILLS[id].unlock === level && this.hooks.unlock) this.hooks.unlock(id);
        }
    },

    /** Урон кайдзю. Возвращает true, если урон прошёл. */
    hurt(dmg, x, y, z, kind) {
        if (!this.alive || this.invuln > 0 || (typeof Platform !== 'undefined' && Platform.adActive)) return false;
        this.hp -= dmg;
        this.hurtT = 0.35;
        FX('hitKaiju', x, y, z, dmg, kind || 'gun');
        if (dmg >= 4) { SFX('hurt', { volume: Math.min(1, 0.4 + dmg * 0.04) }); FX('shake', Math.min(0.5, 0.08 + dmg * 0.02), 180); }
        if (this.hp <= 0) { this.hp = 0; this.die(); }
        return true;
    },

    heal(amount) { if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount); },

    die() {
        if (!this.alive) return;
        this.alive = false; this.deadT = 0; this.breath = false; this.attack = '';
        FX('breathEnd');
        SFX('roar', { volume: 0.9, rate: 0.6 });
        if (this.hooks.died) this.hooks.died();
    },

    /** Возрождение (реклама): полное здоровье и несколько секунд неуязвимости. */
    revive() {
        this.alive = true; this.deadT = 0; this.hp = this.maxHp; this.energy = 1; this.invuln = 4; this.roarT = 1.2;
        SFX('roar_big', { volume: 1 });
        FX('levelUp', this.x, this.y, this.z, this.height);
    },

    // ---------------------------------------------------------------------------------------------
    // Кадр: управление, движение, атаки
    // ---------------------------------------------------------------------------------------------

    /**
     * cmd: { mx, mz (желаемое направление по карте, длина 0..1), attack (нажато), slam (нажато), breath (зажато) }.
     */
    update(dt, cmd) {
        this.time += dt;
        if (this.invuln > 0) this.invuln -= dt;
        if (this.rage > 0) this.rage -= dt;
        if (this.cooldown > 0) this.cooldown -= dt;
        for (const k in this.cds) if (this.cds[k] > 0) this.cds[k] -= dt;
        this.stepWaves(dt);
        this.stepMeteors(dt);
        if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
        if (this.hurtT > 0) this.hurtT -= dt;
        if (this.roarT > 0) this.roarT -= dt;
        // рост
        if (this.scaleT < 1) {
            this.scaleT = Math.min(1, this.scaleT + dt / 1.1);
            const k = this.scaleT, e = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.12 * (1 - k);   // с лёгким «перелётом»
            this.scale = this._scaleFrom + (this.scaleTo - this._scaleFrom) * e;
        }
        this.height = KR.BASE_HEIGHT * this.scale;
        const loc = /** @type {LoryApp} */ (this.app).location, H = this.height;

        if (!this.alive) {
            this.deadT += dt; this.speed *= Math.max(0, 1 - dt * 4); this.moveK = 0;
            if (this.deadT > 1.15 && this.deadT - dt <= 1.15) { FX('dustLand', this.x + Math.cos(this.heading) * H * 0.5, this.y, this.z + Math.sin(this.heading) * H * 0.5, H * 0.9); FX('shake', 0.9, 600); SFX('slam', { volume: 1 }); GameCity.trample(this.x + Math.cos(this.heading) * H * 0.5, this.z + Math.sin(this.heading) * H * 0.5, H * 0.5, H, 400); }
            this.syncRoot(); this.animate(dt);
            return;
        }

        // --- атаки ---
        const busy = this.attack !== '' || this.roarT > 0.4;
        const big = this.attack === 'slam' || this.attack === 'nova' || this.attack === 'meteor' || this.attack === 'nuke';
        if (!busy || (!big && this.attackT > this.attackDur() * 0.6)) {
            if (cmd.nuke && this.can('nuke') && this.cds.nuke <= 0) this.startAttack('nuke');
            else if (cmd.meteor && this.can('meteor') && this.cds.meteor <= 0) this.startAttack('meteor');
            else if (cmd.nova && this.can('nova') && this.cds.nova <= 0) this.startAttack('nova');
            else if (cmd.slam && this.can('slam') && this.cds.slam <= 0) this.startAttack('slam');
        }
        const bigNow = this.attack === 'slam' || this.attack === 'nova' || this.attack === 'meteor' || this.attack === 'nuke';
        if (cmd.attack && this.cooldown <= 0 && (this.attack === '' || (!bigNow && this.attackT > this.attackDur() * 0.72)) && this.roarT <= 0.4) {
            this.combo = this.comboT > 0 ? this.combo + 1 : 1;
            this.startAttack(this.combo % 3 === 0 ? 'tail' : this.combo % 3 === 1 ? 'clawR' : 'clawL');
        }
        const wantBreath = !!cmd.breath && this.can('breath') && this.attack === '' && this.roarT <= 0 && this.energy > (this.breath ? 0 : 0.12);
        if (wantBreath !== this.breath) {
            this.breath = wantBreath;
            if (wantBreath) { this.breathT = 0; this.breathTick = 0; SFX('breath_start', { volume: 0.9 }); FX('breathStart', this.breathStyle); }
            else FX('breathEnd');
        }
        this.breathK += ((this.breath ? 1 : 0) - this.breathK) * Math.min(1, dt * 9);
        if (this.attack) this.stepAttack(dt);

        // --- движение ---
        let mx = cmd.mx || 0, mz = cmd.mz || 0;
        const ml = Math.hypot(mx, mz);
        if (ml > 1) { mx /= ml; mz /= ml; }
        const moving = ml > 0.08 && this.roarT <= 0.5;
        const slow = (this.breath ? 0.45 : 1) * (this.attack === 'tail' ? 0.4 : this.attack === 'slam' || this.attack === 'nuke' ? 0 : this.attack === 'nova' ? 0.3 : this.attack === 'meteor' ? 0.5 : this.attack ? 0.75 : 1) * (loc.waterAt(this.x, this.z) != null ? 0.72 : 1);
        const vmax = this.maxSpeed() * slow;
        const tvx = moving ? mx * vmax : 0, tvz = moving ? mz * vmax : 0;
        const acc = Math.min(1, dt * (moving ? 5.5 : 8));
        this.vx += (tvx - this.vx) * acc; this.vz += (tvz - this.vz) * acc;
        if (this.attack === 'slam') { const f = this.slamDash; this.vx = Math.cos(this.heading) * f; this.vz = Math.sin(this.heading) * f; }
        this.speed = Math.hypot(this.vx, this.vz);
        // курс — к направлению движения (при луче поворот медленнее: лучом «метут»)
        if (moving && this.attack !== 'slam') {
            const want = Math.atan2(mz, mx);
            let d = want - this.heading;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            const rate = (this.breath ? 1.5 : 5.2) / Math.pow(this.scale, 0.22);
            const st = Math.max(-rate * dt, Math.min(rate * dt, d));
            this.heading += st;
            this.turn += (st / Math.max(dt, 1e-3) - this.turn) * Math.min(1, dt * 6);
        } else this.turn *= Math.max(0, 1 - dt * 5);

        let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
        const r = this.radius(), stepH = H * 0.3;
        const res = GameCity.resolve(nx, nz, r, this.jumpY > H * 0.25 ? 1e9 : stepH);
        nx = Math.max(260, Math.min(GameCity.mapW - 260, res.x)); nz = Math.max(260, Math.min(GameCity.mapH - 260, res.z));
        this.x = nx; this.z = nz;
        this.y = loc.terrain.fieldHeight(nx, nz);
        this.moveK += ((this.speed / Math.max(1, this.maxSpeed())) - this.moveK) * Math.min(1, dt * 8);

        // давим всё низкое под корпусом; упёрлись в высокое — проламываем плечом
        this.trampleT -= dt;
        if (this.trampleT <= 0 && (this.speed > 20 || this.attack)) {
            this.trampleT = 0.09;
            GameCity.trample(this.x, this.z, r * 1.25, stepH, this.damage() * 0.9);
            if (this.hooks.trample) this.hooks.trample(this.x, this.z, r * 1.3);
        }
        this.ramT -= dt;
        if (res.hit && moving && this.ramT <= 0) {
            this.ramT = 0.28;
            const fx = this.x - res.nx * r * 1.2, fz = this.z - res.nz * r * 1.2;
            this.strike(fx, this.y + H * 0.38, fz, H * 0.3, this.damage() * 0.55, { x: -res.nx, y: 0.25, z: -res.nz }, 200, false);
            FX('shake', 0.12, 120);
        }

        // --- шаги ---
        const f = (0.62 + 0.85 * this.moveK) / Math.pow(this.scale, 0.3);
        const prev = this.phase;
        if (this.moveK > 0.03) this.phase += dt * f * Math.PI * 2 * Math.min(1, this.moveK * 3);
        const TAU = Math.PI * 2;
        const a = prev % TAU, b = this.phase % TAU;
        if (this.moveK > 0.12 && this.jumpY < 1) {
            if ((a < Math.PI * 0.5 && b >= Math.PI * 0.5) || (a > b && b >= Math.PI * 0.5 && a < Math.PI * 0.5)) this.footstep(-1);
            if (a < Math.PI * 1.5 && b >= Math.PI * 1.5) this.footstep(1);
        }

        // --- луч ---
        if (this.breath) this.stepBreath(dt);
        else this.energy = Math.min(1, this.energy + dt * 0.035);

        this.syncRoot();
        this.animate(dt);
    },

    footstep(side) {
        const H = this.height, c = Math.cos(this.heading), s = Math.sin(this.heading);
        // side: −1 левая, +1 правая; вправо от курса — (−sin, cos)
        const fx = this.x + c * H * 0.1 - s * side * H * 0.14, fz = this.z + s * H * 0.1 + c * side * H * 0.14;
        const water = /** @type {LoryApp} */ (this.app).location.waterAt(fx, fz);
        if (water != null) { FX('waterSplash', fx, water, fz, H * 0.2); SFX('splash', { volume: 0.5 }); }
        else { FX('stomp', fx, this.y, fz, H * 0.22, this.look.aura || null); SFX('step', { volume: Math.min(1, 0.35 + this.scale * 0.14), rate: 1.15 / Math.pow(this.scale, 0.25) }); }
        FX('shake', Math.min(0.3, 0.05 + this.scale * 0.035), 140);
        GameDebris.impulse(fx, this.y, fz, H * 0.45, 150 + H * 0.25, 0.9);
        if (water == null) GameCity.scar(fx, fz, H * 0.2, 'crack', 0.5);
        if (this.hooks.step) this.hooks.step(fx, fz, H * 0.3);
    },

    attackDur() { const a = this.attack; return a === 'tail' ? 0.72 : a === 'slam' ? 1.05 : a === 'nova' ? 0.9 : a === 'meteor' ? 0.8 : a === 'nuke' ? 2.3 : 0.44; },

    startAttack(kind) {
        this.attack = kind; this.attackT = 0; this.attackHit = 0; this.comboT = 1.1;
        if (this.cds[kind] != null) this.cds[kind] = this.cdMax[kind] = KR.SKILLS[kind].cd * this.sk(kind).cd;
        if (this.breath) { this.breath = false; FX('breathEnd'); }
        if (kind === 'slam') { this.slamDash = this.height * 1.25; SFX('swipe', { volume: 0.8, rate: 0.6 }); }
        else if (kind === 'nova' || kind === 'meteor' || kind === 'nuke') { /* звук — в момент срабатывания */ }
        else if (kind === 'tail') { SFX('tail', { volume: 0.9 }); }
        else SFX('swipe', { volume: 0.7, rate: 0.9 + Math.random() * 0.25 });
    },

    stepAttack(dt) {
        const H = this.height, c = Math.cos(this.heading), s = Math.sin(this.heading);
        const dmg = this.damage() * (this.attack === 'slam' ? this.sk('slam').dmg : this.attack === 'clawR' || this.attack === 'clawL' || this.attack === 'tail' ? this.sk('claws').dmg : 1);
        const t0 = this.attackT;
        this.attackT += dt;
        const t = this.attackT, dur = this.attackDur();
        const crossed = (/** @type {number} */ at) => t0 < at && t >= at;
        if (this.attack === 'clawR' || this.attack === 'clawL') {
            if (crossed(0.2)) {
                const side = this.attack === 'clawR' ? 1 : -1;
                const hx = this.x + c * H * 0.42 - s * side * H * 0.08, hz = this.z + s * H * 0.42 + c * side * H * 0.08;
                const dir = { x: c * 0.85 - s * side * -0.35, y: 0.3, z: s * 0.85 + c * side * -0.35 };
                let n = this.strike(hx, this.y + H * 0.52, hz, H * 0.36, dmg, dir, 200 + H * 0.3, true);
                n += this.strike(this.x + c * H * 0.34, this.y + H * 0.2, this.z + s * H * 0.34, H * 0.28, dmg * 0.8, dir, 190 + H * 0.26, true);
                FX('swipe', hx, this.y + H * 0.55, hz, H * 0.4, this.heading, side);
                if (n) { SFX('smash', { volume: Math.min(1, 0.5 + n * 0.05) }); FX('shake', Math.min(0.5, 0.14 + n * 0.02), 200); }
            }
        } else if (this.attack === 'tail') {
            this.spin = Math.min(1, t / dur);
            // хвост проходит круг: шесть ударов по дуге позади и по бокам
            for (let k = 0; k < 6; k++) {
                if (!crossed(0.16 + k * 0.07)) continue;
                const a = this.heading + Math.PI + (k - 2.5) * 0.9, hx = this.x + Math.cos(a) * H * 0.62, hz = this.z + Math.sin(a) * H * 0.62;
                const dir = { x: Math.cos(a + 1.2) * 0.8, y: 0.35, z: Math.sin(a + 1.2) * 0.8 };
                const n = this.strike(hx, this.y + H * 0.2, hz, H * 0.34, dmg * 1.25, dir, 230 + H * 0.32, true);
                if (k === 2) FX('tailSweep', this.x, this.y + H * 0.15, this.z, H * 0.85);
                if (n) { SFX('smash', { volume: 0.7 }); FX('shake', 0.25, 160); }
            }
        } else if (this.attack === 'slam') {
            const up = 0.16, land = 0.74;
            if (t < up) { this.jumpY = 0; this.slamDash = 0; }
            else if (t < land) { const k = (t - up) / (land - up); this.jumpY = Math.sin(k * Math.PI) * H * 0.75; this.slamDash = H * 1.9; }
            else { this.jumpY = 0; this.slamDash = 0; }
            if (crossed(land)) {
                const R = H * 1.05 * this.sk('slam').rad;
                GameCity.scar(this.x, this.z, R * 0.95, 'crack', 1);
                GameCity._breakBudget += 50;
                GameCity.trample(this.x, this.z, R, H * 0.55, dmg * 3);
                this.strike(this.x, this.y + H * 0.12, this.z, R, dmg * 1.4, null, 240 + H * 0.3, true);
                GameDebris.impulse(this.x, this.y, this.z, R * 2, 280 + H * 0.28, 1);
                FX('slam', this.x, this.y, this.z, R * 1.5);
                FX('shake', 1, 600);
                SFX('slam', { volume: 1 });
                if (this.hooks.blast) this.hooks.blast(this.x, this.y, this.z, R * 1.3, dmg * 1.5);
            }
        }
        else if (this.attack === 'nova') {
            // Огненная волна: кольцо огня расходится от ног, жжёт и поджигает всё на пути
            if (crossed(0.22)) {
                const m = this.sk('nova'), R = H * 1.7 * m.rad;
                this.waves.push({ kind: 'nova', x: this.x, y: this.y, z: this.z, r: H * 0.35, R, v: R / 0.75, dmg: this.damage() * 1.5 * m.dmg, tick: 0, H });
                FX('nova', this.x, this.y, this.z, R, 0.75); FX('shake', 0.6, 500);
                SFX('explosion_m', { volume: 1, rate: 0.8 }); SFX('roar', { volume: 0.8, rate: 1.2 });
                GameCity.scar(this.x, this.z, H * 0.9, 'scorch', 0.9);
            }
        } else if (this.attack === 'meteor') {
            // Метеоритный дождь: метеоры падают на кварталы впереди
            if (crossed(0.3)) {
                const m = this.sk('meteor'), n = 6 + 2 * (this.skillLv.meteor || 1);
                for (let i = 0; i < n; i++) {
                    const fwd = H * (1.3 + Math.random() * 2.6), side = (Math.random() - 0.5) * H * 3.2;
                    const tx = this.x + c * fwd - s * side, tz = this.z + s * fwd + c * side;
                    this.meteors.push({ delay: 0.05 + i * 0.17 + Math.random() * 0.1, tx, tz, x: tx - c * H * 1.6, y: this.y + H * 4.2, z: tz - s * H * 1.6, sx: 0, sy: 0, sz: 0, t: 0, T: 0.85, size: H * 0.16, blast: H * 0.8 * m.rad, dmg: this.damage() * 2.2 * m.dmg, fx: null });
                }
                SFX('roar_big', { volume: 0.9 });
            }
        } else if (this.attack === 'nuke') {
            // Ядерный взрыв: зарядка, затем ударная волна сносит целый район
            if (crossed(0.02)) { FX('nukeCharge', this.x, this.y, this.z, H, 1.2); SFX('breath_start', { volume: 1, rate: 0.6 }); this.invuln = Math.max(this.invuln, 3.2); }
            if (crossed(1.25)) {
                const m = this.sk('nuke'), R = H * 2.3 * m.rad;
                this.waves.push({ kind: 'nuke', x: this.x, y: this.y, z: this.z, r: H * 0.6, R, v: R / 1.15, dmg: this.damage() * 8 * m.dmg, tick: 0, H });
                FX('nuke', this.x, this.y, this.z, R);
                SFX('explosion_l', { volume: 1 }); SFX('roar_big', { volume: 1 });
                GameDebris.impulse(this.x, this.y, this.z, R * 1.1, 480 + H * 0.35, 1);
                GameCity.scar(this.x, this.z, R * 0.55, 'scorch', 1); GameCity.scar(this.x, this.z, R * 0.4, 'crack', 1);
                if (this.hooks.blast) this.hooks.blast(this.x, this.y, this.z, R, this.damage() * 6 * m.dmg);
            }
        }
        if (t >= dur) { this.attack = ''; this.spin = 0; this.jumpY = 0; this.cooldown = 0.05; }
    },

    // Расходящиеся волны умений: огненное кольцо бьёт по окружности, ядерная волна сносит всё внутри радиуса.
    stepWaves(dt) {
        for (let i = this.waves.length - 1; i >= 0; i--) {
            const w = this.waves[i];
            w.r = Math.min(w.R, w.r + w.v * dt);
            w.tick -= dt;
            if (w.tick <= 0) {
                w.tick = 0.07;
                GameCity._breakBudget += w.kind === 'nuke' ? 40 : 16;
                if (w.kind === 'nuke') {
                    GameCity.trample(w.x, w.z, w.r, 1e9, w.dmg);
                    if (Math.random() < 0.6) { const a = Math.random() * 6.283; GameCity.ignite(w.x + Math.cos(a) * w.r * 0.8, w.y, w.z + Math.sin(a) * w.r * 0.8, w.H * 0.5, 6, w.dmg * 0.02); }
                } else {
                    const rad = w.H * 0.26, n = Math.min(44, Math.max(8, Math.ceil(6.283 * w.r / (rad * 1.5)))), off = Math.random() * 6.283;
                    for (let k = 0; k < n; k++) {
                        const a = off + k / n * 6.283, ca = Math.cos(a), sa = Math.sin(a), px = w.x + ca * w.r, pz = w.z + sa * w.r;
                        const dir = { x: ca * 0.8, y: 0.45, z: sa * 0.8 };
                        GameCity.hitSphere(px, w.y + w.H * 0.2, pz, rad, w.dmg, dir, 200 + w.H * 0.25);
                        GameCity.hitSphere(px, w.y + w.H * 0.62, pz, rad, w.dmg * 0.7, dir, 200 + w.H * 0.25);
                        if (this.hooks.hit) this.hooks.hit(px, w.y + w.H * 0.3, pz, rad * 1.3, w.dmg);
                    }
                    const a = Math.random() * 6.283;
                    GameCity.ignite(w.x + Math.cos(a) * w.r, w.y, w.z + Math.sin(a) * w.r, w.H * 0.4, 5, w.dmg * 0.06);
                }
            }
            if (w.r >= w.R) this.waves.splice(i, 1);
        }
    },

    // Метеоры: летят по наклонной и взрываются на земле.
    stepMeteors(dt) {
        for (let i = this.meteors.length - 1; i >= 0; i--) {
            const m = this.meteors[i];
            if (m.delay > 0) {
                m.delay -= dt;
                if (m.delay <= 0) { m.sx = m.x; m.sy = m.y; m.sz = m.z; m.fx = FX('meteor', m, m.size) || FX('trail', m, 'rocket'); }
                continue;
            }
            m.t += dt;
            const k = Math.min(1, m.t / m.T);
            m.x = m.sx + (m.tx - m.sx) * k; m.z = m.sz + (m.tz - m.sz) * k; m.y = m.sy + (GameCity.base - m.sy) * k * k;
            if (k < 1) continue;
            if (m.fx && m.fx.stop) m.fx.stop();
            this.meteors.splice(i, 1);
            GameCity._breakBudget += 30;
            GameCity.explode(m.tx, GameCity.base + 20, m.tz, m.blast, m.dmg, true);
            FX('meteorImpact', m.tx, GameCity.base, m.tz, m.blast);
            GameCity.ignite(m.tx, GameCity.base, m.tz, m.blast * 0.7, 6, m.dmg * 0.03);
            GameCity.scar(m.tx, m.tz, m.blast * 0.8, 'crack', 0.9);
            FX('shake', 0.5, 300);
        }
    },

    /** Удар сферой по городу и технике. Возвращает число разрушенного. */
    strike(x, y, z, radius, dmg, dir, power, budget) {
        if (budget) GameCity._breakBudget += 14;
        let n = GameCity.hitSphere(x, y, z, radius, dmg, dir, power);
        if (this.hooks.hit) n += this.hooks.hit(x, y, z, radius, dmg, dir, power) || 0;
        return n;
    },

    /** Точка пасти в мире -> out {x, y, z}. */
    /**
     * Сферы тела в мире — для физики (кинематические коллайдеры) и расталкивания: out — массив чисел по 4 на сферу
     * (x, y, z, радиус). Возвращает число сфер. Кости, которых у вида нет, пропускаются.
     */
    bodySpheres(out) {
        const H = this.height, list = GameKaiju.SPHERES;
        let n = 0;
        for (let i = 0; i < list.length; i += 2) {
            const node = this.nodes[list[i]];
            if (!node) continue;
            const p = node.tn.getAbsolutePosition();
            out[n * 4] = p.x; out[n * 4 + 1] = p.y; out[n * 4 + 2] = p.z; out[n * 4 + 3] = H * /** @type {number} */ (list[i + 1]);
            n++;
        }
        if (!n) { out[0] = this.x; out[1] = this.y + H * 0.45; out[2] = this.z; out[3] = H * 0.3; n = 1; }
        return n;
    },
    // кость, радиус в долях роста
    SPHERES: ['Hips', 0.2, 'Chest', 0.2, 'Head', 0.13, 'Hand_L', 0.07, 'Hand_R', 0.07, 'Forearm_L', 0.06, 'Forearm_R', 0.06,
        'Shin_L', 0.09, 'Shin_R', 0.09, 'Foot_L', 0.1, 'Foot_R', 0.1, 'Tail1', 0.12, 'Tail2', 0.1, 'Tail3', 0.08, 'Tail4', 0.06],

    mouth(out) {
        const n = this.nodes.Mouth || this.nodes.Head;
        if (!n) { out.x = this.x; out.y = this.y + this.height * 0.85; out.z = this.z; return out; }
        const p = n.tn.getAbsolutePosition();
        out.x = p.x; out.y = p.y; out.z = p.z;
        return out;
    },

    stepBreath(dt) {
        const H = this.height;
        this.breathT += dt;
        this.energy -= dt * 0.2 * this.sk('breath').cd;
        if (this.energy <= 0) { this.energy = 0; this.breath = false; FX('breathEnd'); return; }
        const m = this.mouth(GameKaiju._v0);
        const range = H * 4.6 * this.sk('breath').rad, c = Math.cos(this.heading), s = Math.sin(this.heading);
        // луч идёт от пасти чуть вниз: упирается в землю на дальности range
        const drop = (m.y - this.y - H * 0.12) / range;
        const dl = Math.hypot(1, drop), dx = c / dl, dy = -drop / dl, dz = s / dl;
        const rad = H * 0.1;
        let len = range;
        this.breathTick -= dt;
        if (this.breathTick <= 0) {
            this.breathTick = 0.07;
            const dmg = this.damage() * 0.42 * this.sk('breath').dmg, stepLen = rad * 1.5, dir = { x: dx, y: 0.3, z: dz };
            GameCity._breakBudget += 8;
            let broke = 0;
            for (let d = rad * 2; d < range; d += stepLen) {
                const px = m.x + dx * d, py = m.y + dy * d, pz = m.z + dz * d;
                if (py < this.y - 4) { len = d; break; }
                broke += GameCity.hitSphere(px, py, pz, rad * 1.25, dmg, dir, 160 + H * 0.2);
            }
            if (this.hooks.beam) this.hooks.beam(m.x, m.y, m.z, m.x + dx * len, m.y + dy * len, m.z + dz * len, rad * 1.6, dmg);
            if (broke) FX('shake', 0.1, 90);
            this._beamLen = len;
            if (len < range && (this.scorchT -= 0.07) <= 0) { this.scorchT = 0.28; GameCity.scar(m.x + dx * len, m.z + dz * len, rad * 2.6, 'scorch', 0.7); }
            FX('breathHit', m.x + dx * len, Math.max(this.y, m.y + dy * len), m.z + dz * len, this.breathStyle);
        }
        FX('breathUpdate', m.x, m.y, m.z, dx, dy, dz, this._beamLen || range, rad, this.breathStyle);
    },

    syncRoot() {
        const rig = this.rig;
        if (!rig) return;
        const root = rig.root;
        root.position.set(this.x, this.y + this.jumpY, this.z);
        root.rotation.y = -(this.heading + this.spin * Math.PI * 2);
        root.scaling.setAll(this.scale);
    },

    // ---------------------------------------------------------------------------------------------
    // Процедурная анимация
    // ---------------------------------------------------------------------------------------------

    /** Поворот кости от позы покоя. swing, yaw, side — радианы (см. шапку). */
    bone(name, swing, yaw, side, py) {
        const n = this.nodes[name];
        if (!n) return;
        const q = GameKaiju._q || (GameKaiju._q = new BABYLON.Quaternion());
        BABYLON.Quaternion.RotationYawPitchRollToRef((yaw || 0) * this.YW, (side || 0) * this.SD, (swing || 0) * this.SW, q);
        n.q.multiplyToRef(q, n.tn.rotationQuaternion);
        if (py != null) n.tn.position.y = n.p.y + py;
    },

    animate(dt) {
        if (!this.rig) return;
        const t = this.time, k = Math.min(1, this.moveK * 1.25), ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
        const breathe = Math.sin(t * 1.7) * 0.02;
        let hipsY = -10 * k * Math.abs(sn), hipsSw = 0, hipsYaw = 0.1 * k * sn, hipsSide = 0.05 * k * sn;
        let spineSw = -0.06 * k + breathe, spineYaw = -0.1 * k * sn, chestSw = breathe, chestYaw = -0.06 * k * sn;
        let neckSw = 0.03 * k, headSw = Math.sin(t * 0.9) * 0.02, headYaw = Math.sin(t * 0.5) * 0.05 * (1 - k) - this.turn * 0.07, jaw = 0.02 + Math.max(0, Math.sin(t * 0.8)) * 0.03;
        let aLs = -0.38 * k * sn, aRs = 0.38 * k * sn, aLside = 0.06, aRside = -0.06, fLs = 0.25 + 0.2 * k, fRs = 0.25 + 0.2 * k, aLyaw = 0, aRyaw = 0;
        let lLs = 0.58 * k * sn, lRs = -0.58 * k * sn, sL = -0.95 * k * Math.max(0, cs), sR = -0.95 * k * Math.max(0, -cs);
        let tailSw = 0, tailAmp = 0.14 * k + 0.05, wing = Math.sin(t * 1.4) * 0.08;
        let rootSw = 0;

        // --- удары когтями ---
        if (this.attack === 'clawR' || this.attack === 'clawL') {
            const a = this.attackT, R = this.attack === 'clawR';
            const w = GameKaiju.kf(a, 0, 0, 0.14, 1, 0.24, -1.25, 0.44, 0);       // замах (+1) -> удар (−1.25) -> возврат
            const arm = w > 0 ? -0.95 * w : -1.75 * w;                            // назад -> далеко вперёд
            const body = (R ? 1 : -1) * w * 0.42;
            if (R) { aRs = arm; aRside = -0.35 * Math.abs(w); fRs = 0.2 + (w < 0 ? 0.5 : 0.9 * w); aRyaw = 0; } else { aLs = arm; aLside = 0.35 * Math.abs(w); fLs = 0.2 + (w < 0 ? 0.5 : 0.9 * w); }
            chestYaw += -body; spineYaw += -body * 0.6; spineSw += Math.min(0, w) * 0.18; headYaw += body * 0.5; jaw = 0.25;
        } else if (this.attack === 'tail') {
            const a = this.attackT / this.attackDur(), e = Math.sin(a * Math.PI);
            hipsY -= 14 * e; spineSw -= 0.3 * e; aLside = 0.7 * e; aRside = -0.7 * e; aLs = -0.3 * e; aRs = -0.3 * e;
            tailSw = -0.1 * e; tailAmp = 0.02; lLs = 0.25 * e; lRs = -0.25 * e; jaw = 0.3 * e;
        } else if (this.attack === 'slam') {
            const a = this.attackT;
            const crouch = GameKaiju.kf(a, 0, 0, 0.14, 1, 0.3, 0, 0.74, 0, 0.8, 1.3, 1.05, 0);
            const air = GameKaiju.kf(a, 0.14, 0, 0.3, 1, 0.66, 1, 0.76, 0);
            hipsY -= 26 * crouch; spineSw -= 0.2 * crouch - 0.25 * air;
            lLs = 0.5 * air + 0.3 * crouch; lRs = 0.5 * air + 0.3 * crouch; sL = -1.1 * air - 0.7 * crouch; sR = sL;
            aLs = -2.4 * air - 0.4 * crouch; aRs = aLs; aLside = 0.3 * air; aRside = -0.3 * air; fLs = 0.2; fRs = 0.2;
            jaw = 0.45 * air; tailSw = -0.35 * air; wing = -0.9 * air + 0.3 * crouch;
        }
        else if (this.attack === 'nova') {
            const e = GameKaiju.kf(this.attackT, 0, 0, 0.2, 1, 0.55, 1, 0.9, 0);
            hipsY -= 16 * e; spineSw += 0.2 * e; aLside = 1.0 * e; aRside = -1.0 * e; aLs = -0.5 * e; aRs = -0.5 * e; jaw = 0.6 * e; headSw += 0.3 * e; tailSw = -0.25 * e; wing = -0.8 * e;
        } else if (this.attack === 'meteor') {
            const e = GameKaiju.kf(this.attackT, 0, 0, 0.25, 1, 0.55, 1, 0.8, 0);
            aLs = -2.7 * e; aRs = -2.7 * e; aLside = 0.25 * e; aRside = -0.25 * e; spineSw += 0.18 * e; headSw += 0.35 * e; jaw = 0.55 * e; wing = -0.6 * e;
        } else if (this.attack === 'nuke') {
            const a = this.attackT, ch = GameKaiju.kf(a, 0, 0, 0.5, 1, 1.2, 1, 1.35, 0), bu = GameKaiju.kf(a, 1.2, 0, 1.35, 1, 1.9, 1, 2.3, 0), tr = Math.sin(t * 60) * 0.02 * ch;
            hipsY -= 30 * ch; spineSw += -0.35 * ch + 0.3 * bu + tr; aLs = 0.6 * ch - 0.6 * bu; aRs = aLs; fLs = 1.1 * ch + 0.2; fRs = fLs; aLside = 1.1 * bu; aRside = -1.1 * bu;
            headSw += -0.2 * ch + 0.4 * bu; jaw = 0.1 + 0.65 * bu; tailSw = 0.15 * ch - 0.3 * bu; wing = 0.4 * ch - 1.0 * bu;
        }
        // --- луч ---
        if (this.breathK > 0.01) {
            const b = this.breathK, tr = Math.sin(t * 46) * 0.012 * b;
            spineSw += -0.18 * b + tr; chestSw += -0.1 * b; neckSw += 0.1 * b; headSw += -0.16 * b + tr; headYaw *= 1 - b; jaw = jaw * (1 - b) + 0.62 * b;
            aLs += -0.5 * b; aRs += -0.5 * b; aLside += 0.3 * b; aRside -= 0.3 * b; tailSw += -0.12 * b; hipsY -= 8 * b;
        }
        // --- рёв (новый уровень, возрождение) ---
        if (this.roarT > 0) {
            const r = Math.min(1, this.roarT / 0.3) * Math.min(1, (1.5 - this.roarT) / 0.25 + 0.2), tr = Math.sin(t * 52) * 0.02 * r;
            spineSw += 0.22 * r + tr; chestSw += 0.14 * r; neckSw += 0.25 * r; headSw += 0.3 * r + tr; jaw = Math.max(jaw, 0.7 * r);
            aLs = aLs * (1 - r) - 0.4 * r; aRs = aRs * (1 - r) - 0.4 * r; aLside += 0.95 * r; aRside -= 0.95 * r; fLs += 0.4 * r; fRs += 0.4 * r;
            tailSw -= 0.2 * r; wing -= 0.7 * r; hipsY -= 6 * r;
        }
        // --- получил урон: короткий рывок назад ---
        if (this.hurtT > 0) { const h = this.hurtT / 0.35; spineSw += 0.16 * h * h; headSw += 0.12 * h; jaw = Math.max(jaw, 0.3 * h); }
        // --- гибель: падает вперёд ---
        if (!this.alive) {
            const d = Math.min(1, this.deadT / 1.2), e = d * d;
            rootSw = -1.48 * e; jaw = 0.5; aLs = -1.2 * e; aRs = -1.2 * e; tailSw = 0.25 * e; lLs = 0.2 * e; lRs = -0.1 * e; headSw = 0.3 * e;
        }

        this.bone('Root', rootSw, 0, 0);
        this.bone('Hips', hipsSw, hipsYaw, hipsSide, hipsY);
        this.bone('Spine', spineSw, spineYaw, -hipsSide * 0.6);
        this.bone('Chest', chestSw, chestYaw, 0);
        this.bone('Neck', neckSw, headYaw * 0.4, 0);
        this.bone('Head', headSw, headYaw * 0.6, 0);
        this.bone('Neck2', neckSw, -headYaw * 0.4 + 0.1, 0); this.bone('Head2', headSw, -headYaw * 0.6, 0);
        this.bone('Jaw', -jaw, 0, 0);
        this.bone('Arm_L', aLs, aLyaw, aLside); this.bone('Arm_R', aRs, aRyaw, aRside);
        this.bone('Forearm_L', fLs, 0, 0); this.bone('Forearm_R', fRs, 0, 0);
        this.bone('Hand_L', 0.1, 0, 0); this.bone('Hand_R', 0.1, 0, 0);
        this.bone('Leg_L', lLs, 0, 0); this.bone('Leg_R', lRs, 0, 0);
        this.bone('Shin_L', sL, 0, 0); this.bone('Shin_R', sR, 0, 0);
        this.bone('Foot_L', -(lLs + sL) * 0.7, 0, 0); this.bone('Foot_R', -(lRs + sR) * 0.7, 0, 0);
        const lag = Math.max(-0.5, Math.min(0.5, this.turn * 0.1));
        for (let i = 1; i <= 4; i++) this.bone('Tail' + i, tailSw * (0.4 + i * 0.2), tailAmp * Math.sin(ph - i * 0.75) + 0.05 * Math.sin(t * 0.9 - i * 0.6) + lag * (0.5 + i * 0.25), 0);
        this.bone('Wing_L', 0, 0, wing); this.bone('Wing_R', 0, 0, -wing);

        // свечение: пульс у светящихся деталей, вспышка при уроне, заряд луча
        const glow = this.mats.glow;
        if (glow) { const g = 0.7 + Math.sin(t * 3) * 0.15 + this.breathK * 0.8 + (this.roarT > 0 ? 0.6 : 0); for (const m of glow) m.emissiveColor.copyFrom(m.diffuseColor).scaleToRef(g, m.emissiveColor); }
        const prim = this.mats.primary;
        if (prim) { const f = this.hurtT > 0 ? this.hurtT / 0.35 * 0.55 : this.invuln > 0 && this.alive ? 0.12 + 0.12 * Math.sin(t * 20) : this.rage > 0 ? 0.18 + 0.1 * Math.sin(t * 9) : 0; for (const m of prim) m.emissiveColor.set(f, f * (this.rage > 0 && this.hurtT <= 0 ? 0.35 : this.hurtT > 0 ? 0.1 : 1), f * (this.hurtT > 0 || this.rage > 0 ? 0.08 : 1)); }
    },
};
