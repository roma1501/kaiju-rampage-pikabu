// GameCity.js — разрушаемый город: здания из кирпичей по планам GameArch, дороги, пропсы, небо и свет карты.
//
// ЗДАНИЕ = сетка клеток nx × ny × nz, клетка — кирпич-модуль (высота 70 px = 2 этажа). Что заполнено, какой тайл фасада
// на какой грани и какой декор приклеен к кирпичу, решает ПЛАН (GameArch.plan). Все кирпичи района лежат в ОДНОМ меше
// (позиции, нормали, UV в атлас тайлов, цвет стены в вершинах): район — один вызов отрисовки. Разрушенный кирпич — его
// вершины (и вершины его декора) схлопываются в ноль, вместо него летят обломки по стилю фасада (плиты перекрытий,
// фасадные панели, балки, стекло, крошка) — тела Rapier (GameDebris).
//
// ОПОРА. Кирпич держится, если под ним колонна до земли или он не дальше plan.span клеток вбок от такой колонны.
// Связный кусок без опоры отрывается СЕКЦИЕЙ — одним составным телом со своим мешем фасада: падает, кренится,
// ломается при ударе (кирпичи у места удара колются, остальное летит дальше) и крушит то, на что упало. Если основание
// под верхней частью ослаблено или центр масс вышел за него, вся верхняя часть отрывается и заваливается набок.
// Улёгшаяся секция рассыпается на блоки-кирпичи в завале (GameDebris). Мало осталось — здание рушится целиком.
//
// КОЛЛАЙДЕРЫ. Целый кирпич получает неподвижный коллайдер только в «активной зоне» GameDebris (рядом с неспящими
// телами) и только если у него открыта хоть одна грань. Кайдзю — кинематические шары (GamePhysics.kaiju).
//
// Логика (урон, опора, проходимость) считается по своим данным, а не по сцене Babylon (инвариант 4).
// Координаты: x, z — карта (z = y карты), y — высота.

/** @satisfies {Record<string, any>} */
const GameCity = {
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ view: null,
    /** @type {any} */ loc: null,
    base: 0, mapW: 0, mapH: 0,
    /** @type {any[]} */ buildings: [],
    /** @type {any[]} */ chunks: [],
    /** @type {any[]} */ meshes: [],          // всё, что создано в сцене и уходит при смене карты
    /** @type {any[]} */ roads: [],
    /** @type {any[]} */ armyPoints: [],
    /** @type {any[]} */ props: [],
    /** @type {any} */ atlas: null,
    /** @type {any} */ atlasLit: null,
    /** @type {any} */ sky: null,
    // Кирпичи (общие массивы на карту)
    brickCount: 0, deadCount: 0,
    /** @type {Int32Array} */ bBld: new Int32Array(0),
    /** @type {Int32Array} */ bCell: new Int32Array(0),
    /** @type {Float32Array} */ bHp: new Float32Array(0),
    /** @type {Uint8Array} */ bState: new Uint8Array(0),      // 1 — стоит, 0 — нет
    /** @type {Int32Array} */ bVert: new Int32Array(0),       // первая вершина кирпича в меше района
    /** @type {Uint16Array} */ bVN: new Uint16Array(0),       // сколько у него вершин (24 + декор)
    /** @type {Uint8Array} */ bK: new Uint8Array(0),          // затемнение от урона, 255 — цел
    /** @type {Float64Array} */ bCol: new Float64Array(0),    // handle неподвижного коллайдера или −1
    /** @type {Map<number, number>} */ colBrick: new Map(),   // handle коллайдера -> номер кирпича
    // Сетки поиска
    GRID: 700, gridW: 0, gridH: 0,
    /** @type {number[][]} */ grid: [],
    /** @type {number[][]} */ propGrid: [],
    NAV: 100, navW: 0, navH: 0,
    /** @type {Uint8Array} */ nav: new Uint8Array(0),
    _stamp: 0,
    /** @type {Int32Array} */ _seen: new Int32Array(0),
    /** @type {any[]} */ _dirty: [],
    _breakBudget: 0, _sfxT: 0, _fxT: 0, _dustN: 0,
    FLIP: false,           // обход треугольников дорог
    UFLIP: true,           // тайл на боковой грани читается слева направо, если смотреть снаружи
    _tmp: [0, 0, 0],
    _dir: { x: 0, y: 1, z: 0 },
    /** @type {Uint8Array} */ _sup: new Uint8Array(0),
    /** @type {Uint8Array} */ _vis: new Uint8Array(0),
    /** @type {Int32Array} */ _stk: new Int32Array(0),
    /** @type {Int32Array} */ _ids: new Int32Array(0),
    _t6: [0, 0, 0, 0, 0, 0], _uv4: [0, 0, 1, 1], _T: [0, 0, 0, 0, 0, 0, 1], _V: [0, 0, 0], _W: [0, 0, 0],
    /** @type {Float32Array} */ _bx: new Float32Array(6 * 64),
    /** @type {any} */ _F: { cx: 0, cy: 0, cz: 0, vx: 0, vy: 0, vz: 0, dir: null, power: 0, q: [0, 0, 0, 1], a: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    lit: 0,
    /** @type {any} */ rubble: null,
    /** @type {Float32Array} */ rubbleM: new Float32Array(0),
    /** @type {Float32Array} */ rubbleC: new Float32Array(0),
    rubbleCount: 0, rubbleCap: 0, rubbleDirty: false,
    /** @type {Record<string, any>} */ scars: {},
    /** @type {any[]} */ fires: [],
    // Секции (падающие куски зданий) и пропсы-тела
    /** @type {any[]} */ sections: [],
    /** @type {number[]} */ secFree: [],
    secLive: 0,
    /** @type {any[]} */ _hitList: [],
    /** @type {any[]} */ dyn: [],
    dynAwake: 0,
    /** @type {Map<string, any>} */ dynSets: new Map(),
    /** Хуки игры: score(points, x, y, z, kind), blast(x, y, z, r, dmg), collapse(b). */
    /** @type {Record<string, Function>} */ hooks: {},

    // ---------------------------------------------------------------------------------------------
    // Сборка карты (под экраном загрузки, в prepare)
    // ---------------------------------------------------------------------------------------------

    /** Построить город текущей карты. Повторяемо: прежнее убирается. */
    async build(app) {
        this.clear();
        const loc = this.loc = app.location, view = this.view = loc.view;
        this.app = app;
        this.mapW = loc.width; this.mapH = loc.height;
        this.base = loc.map.terrain && Number.isFinite(loc.map.terrain.base) ? loc.map.terrain.base : 0;
        this.gridW = Math.ceil(this.mapW / this.GRID); this.gridH = Math.ceil(this.mapH / this.GRID);
        this.grid = Array.from({ length: this.gridW * this.gridH }, () => []);
        this.propGrid = Array.from({ length: this.gridW * this.gridH }, () => []);
        this.navW = Math.ceil(this.mapW / this.NAV); this.navH = Math.ceil(this.mapH / this.NAV);
        this.nav = new Uint8Array(this.navW * this.navH);

        const markers = loc.objects.filter(o => o.def && o.def.kind === 'marker').map(o => o.def);
        let defs = markers.filter(d => /^b-/.test(d.name));
        let roadDefs = markers.filter(d => /^(road|avenue|cross|plaza|pier|runway)(-|$)/.test(d.name));
        if (!defs.length) { const demo = this.demoCity(); defs = demo.buildings; roadDefs = demo.roads; }   // карта без зданий: тестовый квартал
        this.armyPoints = markers.filter(d => /^army(-|$)/.test(d.name)).map(d => ({ x: d.x, z: d.y }));

        // Атлас тайлов фасадов — GameArch; нет атласа — стены ровного цвета (инвариант 6).
        let A = null;
        try { A = await GameArch.buildAtlas(view.scene, KR.mapInfo(loc.map.id).lit); } catch (e) { console.warn('GameArch.buildAtlas:', e); }
        this.atlas = A ? A.texture : null; this.atlasLit = A ? A.lit : null;
        this.buildRoads(roadDefs);
        this.buildBuildings(defs);
        this.buildRubble();
        this.buildScars();
        this.buildProps();
        this.buildNav();
        this.buildSky();
        if (this.atlas) GameDebris.setAtlas(this.atlas, GameArch.tile('inner'));
        GameDebris.roofAt = (x, z, tag) => this.roofAt(x, z, tag);
        GameDebris.onCrush = (handle, x, y, z, dv, size) => this._blockHit(handle, x, y, z, dv, size);
        GameDebris.onLand = (x, y, z, size) => { if (size > 16 && this._dustN++ < 5) FX('dustLand', x, y, z, size); };
        GameDebris.waterAt = (x, z) => loc.waterAt(x, z);
        GameDebris.onZoneOpen = (zn) => this._zoneOpen(zn);
        GameDebris.onZoneClose = (zn) => this._zoneClose(zn);
        GameDebris.onBodyHit = (id, kind, ref, oid, oh, force) => this._bodyHit(id, kind, ref, oid, oh, force);
        GameDebris.onSync = (dt) => this.afterPhysics(dt);
        GameDebris.onImpulse = (x, y, z, radius, power, up) => this._impulse(x, y, z, radius, power, up);
    },

    clear() {
        const view = this.view;
        for (const s of this.sections) if (s && s.mesh) { try { if (view) World3D.removeObject(view, s.mesh); else s.mesh.dispose(); } catch (e) { /* сцена убрана */ } }
        for (const m of this.meshes) { try { if (view) World3D.removeObject(view, m); else m.dispose(); } catch (e) { /* сцена убрана */ } }
        for (const c of this.chunks) { try { if (c.mesh.material) c.mesh.material.dispose(); } catch (e) { /* */ } }
        if (this.atlas) { try { this.atlas.dispose(); } catch (e) { /* */ } this.atlas = null; }
        if (this.atlasLit) { try { this.atlasLit.dispose(); } catch (e) { /* */ } this.atlasLit = null; }
        this.meshes = []; this.chunks = []; this.buildings = []; this.roads = []; this.props = [];
        this._dirty = []; this.brickCount = 0; this.deadCount = 0; this.sky = null; this.rubble = null; this.rubbleCount = 0; this.scars = {}; this.fires = []; this.blasts = [];
        this.sections = []; this.secFree = []; this.secLive = 0; this._hitList = []; this.dyn = []; this.dynAwake = 0; this.dynSets = new Map();
        this.colBrick = new Map();
    },

    /** Тестовый квартал для карты без маркеров зданий (разработка). */
    demoCity() {
        const cx = this.mapW / 2, cy = this.mapH / 2, rnd = KR.rng(7), buildings = [], roads = [];
        const shapes = ['box', 'step', 'spire', 'cyl', 'twin', 'lshape', 'pyramid', 'dome', 'pagoda', 'hangar', 'arch', 'ring'];
        const styles = Object.keys(GameArch.STYLES);
        let n = 0;
        for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
            if (!gx && !gy) continue;
            for (let k = 0; k < 2; k++) {
                const w = 170 + Math.floor(rnd() * 3) * 60, d = 170 + Math.floor(rnd() * 3) * 60;
                const h = 70 * (1 + Math.floor(rnd() * rnd() * 12));
                buildings.push({ name: 'b-' + shapes[n % shapes.length] + '-' + styles[n % styles.length] + '-' + n, x: cx + gx * 560 + (k ? 170 : -170), y: cy + gy * 560 + (rnd() - 0.5) * 60, rot: [0, 0, 0], scale: [w / 100, h / 100, d / 100] });
                n++;
            }
        }
        for (const o of [-280, 280]) {
            roads.push({ name: 'road-' + o, x: cx, y: cy + o, rot: [0, 0, 0], scale: [19, 1, 1.4] });
            roads.push({ name: 'road-v' + o, x: cx + o, y: cy, rot: [0, 90, 0], scale: [19, 1, 1.4] });
        }
        return { buildings, roads };
    },

    // --- Дороги: плоские прямоугольники с текстурой поверх земли ----------------------------------
    buildRoads(defs) {
        const scene = this.view.scene, D = Math.PI / 180;
        // тип -> { url, высота над землёй, повтор по длине: 0 — растянуть на всю ширину }
        const types = {
            road: { url: 'assets/textures/road.webp', y: 2.0 }, avenue: { url: 'assets/textures/avenue.webp', y: 2.4 },
            cross: { url: 'assets/textures/cross.webp', y: 3.2 }, plaza: { url: 'assets/textures/plaza.webp', y: 1.4, tile: 210 },
            pier: { url: 'assets/textures/pier.webp', y: 7, tile: 180 }, runway: { url: 'assets/textures/runway.webp', y: 2.6 },
        };
        /** @type {Record<string, any>} */
        const acc = {};
        for (const d of defs) {
            const type = String(d.name).split('-')[0], t = types[type];
            if (!t) continue;
            const len = (d.scale ? d.scale[0] : 1) * 100, wid = (d.scale ? d.scale[2] : 1) * 100, yaw = ((d.rot ? d.rot[1] : 0) || 0) * D;
            const c = Math.cos(yaw), s = Math.sin(yaw), y = this.base + (d.h || 0) + t.y;
            if (type === 'road' || type === 'avenue' || type === 'runway') this.roads.push({ x: d.x, z: d.y, len, wid, yaw, c, s, type });
            const a = acc[type] || (acc[type] = { pos: [], nor: [], uv: [], idx: [] });
            const v0 = a.pos.length / 3, hl = len / 2, hw = wid / 2;
            const uvL = t.tile ? len / t.tile : len / wid, uvW = t.tile ? wid / t.tile : 1;
            // углы: (вдоль, поперёк)
            for (const [l, w, u, v] of [[-hl, -hw, 0, 0], [hl, -hw, 0, uvL], [hl, hw, uvW, uvL], [-hl, hw, uvW, 0]]) {
                a.pos.push(d.x + l * c - w * s, y, d.y + l * s + w * c);
                a.nor.push(0, 1, 0);
                a.uv.push(u, v);
            }
            if (this.FLIP) a.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); else a.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        }
        for (const type of Object.keys(acc)) {
            const a = acc[type], mesh = new BABYLON.Mesh('road-' + type, scene);
            const vd = new BABYLON.VertexData();
            vd.positions = a.pos; vd.normals = a.nor; vd.uvs = a.uv; vd.indices = a.idx;
            vd.applyToMesh(mesh, false);
            const mat = new BABYLON.StandardMaterial('road-' + type, scene);
            const tex = new BABYLON.Texture(types[type].url, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null, () => { mat.diffuseTexture = null; mat.diffuseColor = new BABYLON.Color3(0.26, 0.27, 0.3); });
            tex.anisotropicFilteringLevel = IS_MOBILE ? 2 : 8;
            mat.diffuseTexture = tex;
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.zOffset = -4;
            mat.backFaceCulling = false;
            mesh.material = mat;
            mesh.isPickable = false;
            World3D.addObject(this.view, mesh, 'prop', { castShadow: false, ink: false, outline: false });
            this.meshes.push(mesh);
        }
    },

    // --- Здания -----------------------------------------------------------------------------------

    // Как колется кирпич по стилю фасада: 0 — панель и бетон, 1 — стекло, 2 — кладка, 3 — дерево, 4 — металл.
    CLASS: { glass: 1, darkglass: 1, tech: 1, modern: 1, office: 1, brick: 2, townhouse: 2, sandstone: 2, stone: 2, bunker: 2, artdeco: 2, wood: 3, industrial: 4, warehouse: 4, metal: 4 },

    buildBuildings(defs) {
        const q = KR.quality();
        const cell = GameArch.CELL * (q === 'low' ? 1.45 : q === 'medium' ? 1.18 : 1) * (IS_MOBILE ? 1.15 : 1);
        const REG = 3500, regW = Math.ceil(this.mapW / REG);
        /** @type {Map<number, any[]>} */
        const byRegion = new Map();
        let total = 0, maxCells = 1;
        for (const d of defs) {
            /** @type {any} */ let plan = null;
            try { plan = GameArch.plan(d, { cell }); } catch (e) { console.warn('GameArch.plan: ' + d.name, e); }
            if (!plan || !plan.filled) continue;
            const { nx, ny, nz } = plan, c = Math.cos(plan.yaw), s = Math.sin(plan.yaw), w = plan.w, dd = plan.d;
            const b = {
                id: this.buildings.length, plan, x: plan.x, z: plan.z, yaw: plan.yaw, c, s, w, d: dd, h: plan.h, nx, ny, nz, cw: plan.cw, cd: plan.cd, ch: plan.ch,
                shape: plan.shape, style: plan.style, hpBrick: (plan.hp || 26) * 3.6,      // город 2.0 меньше по числу кирпичей — каждый прочнее cls: this.CLASS[plan.style] || 0, tint: 0xcccccc,
                span: plan.span || (plan.shape === 'twin' || plan.shape === 'arch' ? 2 : 1),
                cells: new Int32Array(nx * ny * nz).fill(-1), colTop: new Uint8Array(nx * nz), lv: new Uint8Array(ny),
                /** @type {Map<number, any[]> | null} */ partsBy: null,
                alive: 0, total: 0, ground: 0, groundAlive: 0, verts: 0, inds: 0, dirty: false, gone: false, chunk: -1,
                r: Math.hypot(w, dd) / 2, x0: 0, x1: 0, z0: 0, z1: 0,
            };
            const ex = (Math.abs(c) * w + Math.abs(s) * dd) / 2, ez = (Math.abs(s) * w + Math.abs(c) * dd) / 2;
            b.x0 = b.x - ex; b.x1 = b.x + ex; b.z0 = b.z - ez; b.z1 = b.z + ez;
            const F = plan.filled, N = nx * ny * nz;
            for (let ci = 0; ci < N; ci++) {
                if (!F[ci]) continue;
                b.cells[ci] = -2;                                   // занято, номер кирпича — ниже
                if (!b.total) b.tint = plan.tintOf(ci);
                b.total++;
                if (ci < nx * nz) b.ground++;
            }
            if (!b.total) continue;
            b.verts = b.total * 24; b.inds = b.total * 36;
            // декор, приклеенный к кирпичам
            for (const p of plan.parts || []) {
                if (!p || !(p.cell >= 0) || p.cell >= N || !F[p.cell]) continue;
                if (!b.partsBy) b.partsBy = new Map();
                const list = b.partsBy.get(p.cell) || [];
                if (!list.length) b.partsBy.set(p.cell, list);
                list.push(p);
                if (p.kind === 'wedge') { b.verts += 18; b.inds += 24; } else { b.verts += 24; b.inds += 36; }
            }
            b.alive = b.total; b.groundAlive = b.ground;
            total += b.total;
            if (N > maxCells) maxCells = N;
            this.buildings.push(b);
            const reg = Math.floor(b.z / REG) * regW + Math.floor(b.x / REG);
            (byRegion.get(reg) || byRegion.set(reg, []).get(reg)).push(b);
            // сетка поиска
            for (let gz = Math.max(0, Math.floor(b.z0 / this.GRID)); gz <= Math.min(this.gridH - 1, Math.floor(b.z1 / this.GRID)); gz++)
                for (let gx = Math.max(0, Math.floor(b.x0 / this.GRID)); gx <= Math.min(this.gridW - 1, Math.floor(b.x1 / this.GRID)); gx++)
                    this.grid[gz * this.gridW + gx].push(b.id);
        }
        this.brickCount = total; this.deadCount = 0;
        this.bBld = new Int32Array(total); this.bCell = new Int32Array(total); this.bHp = new Float32Array(total);
        this.bState = new Uint8Array(total); this.bVert = new Int32Array(total); this.bVN = new Uint16Array(total);
        this.bK = new Uint8Array(total).fill(255); this.bCol = new Float64Array(total).fill(-1);
        this._seen = new Int32Array(this.buildings.length + 1);
        this._sup = new Uint8Array(maxCells); this._vis = new Uint8Array(maxCells); this._stk = new Int32Array(maxCells); this._ids = new Int32Array(maxCells);
        let next = 0;
        for (const list of byRegion.values()) next = this.buildChunk(list, next);
    },

    // Меш района: все кирпичи его зданий с декором. Возвращает следующий свободный номер кирпича.
    buildChunk(list, next) {
        let nv = 0, ni = 0;
        for (const b of list) { nv += b.verts; ni += b.inds; }
        const ctx = {
            pos: new Float32Array(nv * 3), nor: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), col: new Float32Array(nv * 4),
            idx: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), v: 0, t: 0, world: true, ox: 0, oy: 0, oz: 0,
        };
        const chunkId = this.chunks.length;
        for (const b of list) {
            b.chunk = chunkId;
            const { nx, nz } = b, N = b.cells.length;
            for (let ci = 0; ci < N; ci++) {
                if (b.cells[ci] === -1) continue;
                const id = next++, j = Math.floor(ci / (nx * nz)), col = ci % (nx * nz);
                b.cells[ci] = id;
                this.bBld[id] = b.id; this.bCell[id] = ci; this.bHp[id] = b.hpBrick; this.bState[id] = 1; this.bVert[id] = ctx.v;
                if (j + 1 > b.colTop[col]) b.colTop[col] = j + 1;
                this._emitBrick(ctx, b, ci, id, 1);
                this.bVN[id] = ctx.v - this.bVert[id];
            }
        }
        const scene = this.view.scene, mesh = new BABYLON.Mesh('city-' + chunkId, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = ctx.pos; vd.normals = ctx.nor; vd.uvs = ctx.uv; vd.colors = ctx.col; vd.indices = ctx.idx;
        vd.applyToMesh(mesh, true);
        const mat = new BABYLON.StandardMaterial('city-' + chunkId, scene);
        if (this.atlas) mat.diffuseTexture = this.atlas;
        mat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
        mesh.material = mat;
        mesh.hasVertexAlpha = false;
        mesh.isPickable = false;
        World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false });
        this.meshes.push(mesh);
        this.chunks.push({ mesh, pos: ctx.pos, col: ctx.col, mat, p0: Infinity, p1: -1, c0: Infinity, c1: -1 });
        return next;
    },

    // Клетка (i, j, k) заполнена в плане здания (исходная форма, без учёта разрушений).
    _filled(b, i, j, k) {
        return i >= 0 && j >= 0 && k >= 0 && i < b.nx && j < b.ny && k < b.nz && b.plan.filled[(j * b.nz + k) * b.nx + i] !== 0;
    },

    // Сколько вершин у кирпича с его декором.
    _brickVerts(b, ci) {
        let n = 24;
        const ps = b.partsBy ? b.partsBy.get(ci) : null;
        if (ps) for (const p of ps) n += p.kind === 'wedge' ? 18 : 24;
        return n;
    },

    // Четыре вершины грани. ctx.world: координаты мира (меш района), иначе — системы секции (минус её начало).
    // Углы идут: низ-A, верх-A, верх-B, низ-B; (ua, ub) — u у стороны A и B; va — v верха, vb — v низа.
    _quad(ctx, b, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx, ny, nz, ua, ub, va, vb, r, g, bl, flip) {
        const pos = ctx.pos, nor = ctx.nor, uv = ctx.uv, col = ctx.col;
        for (let q = 0; q < 4; q++) {
            const lx = q === 0 ? x0 : q === 1 ? x1 : q === 2 ? x2 : x3, ly = q === 0 ? y0 : q === 1 ? y1 : q === 2 ? y2 : y3, lz = q === 0 ? z0 : q === 1 ? z1 : q === 2 ? z2 : z3;
            const v = ctx.v++, o = v * 3;
            if (ctx.world) {
                pos[o] = b.x + lx * b.c - lz * b.s; pos[o + 1] = this.base + ly; pos[o + 2] = b.z + lx * b.s + lz * b.c;
                nor[o] = nx * b.c - nz * b.s; nor[o + 1] = ny; nor[o + 2] = nx * b.s + nz * b.c;
            } else {
                pos[o] = lx - ctx.ox; pos[o + 1] = ly - ctx.oy; pos[o + 2] = lz - ctx.oz;
                nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
            }
            uv[v * 2] = q < 2 ? ua : ub; uv[v * 2 + 1] = q === 1 || q === 2 ? va : vb;
            const c4 = v * 4;
            col[c4] = r; col[c4 + 1] = g; col[c4 + 2] = bl; col[c4 + 3] = 1;
        }
        const a = ctx.v - 4, idx = ctx.idx;
        if (flip) { idx[ctx.t++] = a; idx[ctx.t++] = a + 2; idx[ctx.t++] = a + 1; idx[ctx.t++] = a; idx[ctx.t++] = a + 3; idx[ctx.t++] = a + 2; }
        else { idx[ctx.t++] = a; idx[ctx.t++] = a + 1; idx[ctx.t++] = a + 2; idx[ctx.t++] = a; idx[ctx.t++] = a + 2; idx[ctx.t++] = a + 3; }
    },

    // Коробка (шесть граней): tiles — тайлы +X, −X, +Z, −Z, верх, низ; цвет r, g, bl.
    _box(ctx, b, x0, y0, z0, x1, y1, z1, tiles, r, g, bl) {
        const uv = this._uv4, UF = this.UFLIP, T = GameArch;
        let ua = 0, ub = 0;
        T.tileUV(tiles[0], uv); ua = UF ? uv[2] : uv[0]; ub = UF ? uv[0] : uv[2];
        this._quad(ctx, b, x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0, 1, 0, 0, ua, ub, uv[1], uv[3], r, g, bl, false);
        T.tileUV(tiles[1], uv); ua = UF ? uv[2] : uv[0]; ub = UF ? uv[0] : uv[2];
        this._quad(ctx, b, x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1, -1, 0, 0, ua, ub, uv[1], uv[3], r, g, bl, false);
        T.tileUV(tiles[2], uv); ua = UF ? uv[2] : uv[0]; ub = UF ? uv[0] : uv[2];
        this._quad(ctx, b, x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1, 0, 0, 1, ua, ub, uv[1], uv[3], r, g, bl, false);
        T.tileUV(tiles[3], uv); ua = UF ? uv[2] : uv[0]; ub = UF ? uv[0] : uv[2];
        this._quad(ctx, b, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0, 0, 0, -1, ua, ub, uv[1], uv[3], r, g, bl, false);
        T.tileUV(tiles[4], uv);
        this._quad(ctx, b, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, 0, 1, 0, uv[0], uv[2], uv[1], uv[3], r * 0.9, g * 0.9, bl * 0.9, false);
        T.tileUV(tiles[5], uv);
        this._quad(ctx, b, x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0, 0, -1, 0, uv[0], uv[2], uv[1], uv[3], r * 0.6, g * 0.6, bl * 0.6, false);
    },

    // Клин: верх понижается от стороны high (0: +X, 1: −X, 2: +Z, 3: −Z) до y0 на противоположной.
    _wedge(ctx, b, p, r, g, bl) {
        const uv = GameArch.tileUV(p.tile, this._uv4), u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
        const alongX = p.high === 0 || p.high === 1 || p.high == null;
        const lo = p.high === 1 ? p.x1 : p.high === 3 ? p.z1 : alongX ? p.x0 : p.z0, hi = p.high === 1 ? p.x0 : p.high === 3 ? p.z0 : alongX ? p.x1 : p.z1;
        const c0 = alongX ? p.z0 : p.x0, c1 = alongX ? p.z1 : p.x1, y0 = p.y0, y1 = p.y1;
        // точка: t — вдоль ската, s — поперёк
        const P = (/** @type {number} */ t, /** @type {number} */ s, /** @type {number} */ y) => alongX ? [t, y, s] : [s, y, t];
        const sg = hi > lo ? 1 : -1, len = Math.abs(hi - lo) || 1, hgt = y1 - y0, nl = Math.hypot(len, hgt) || 1;
        const nSlope = alongX ? [-sg * hgt / nl, len / nl, 0] : [0, len / nl, -sg * hgt / nl];
        const nHigh = alongX ? [sg, 0, 0] : [0, 0, sg], nC0 = alongX ? [0, 0, c0 < c1 ? -1 : 1] : [c0 < c1 ? -1 : 1, 0, 0];
        this._poly(ctx, b, [P(lo, c0, y0), P(lo, c1, y0), P(hi, c1, y1), P(hi, c0, y1)], nSlope, u0, v0, u1, v1, r, g, bl);
        this._poly(ctx, b, [P(hi, c0, y0), P(hi, c0, y1), P(hi, c1, y1), P(hi, c1, y0)], nHigh, u0, v0, u1, v1, r * 0.92, g * 0.92, bl * 0.92);
        this._poly(ctx, b, [P(lo, c0, y0), P(hi, c0, y0), P(hi, c1, y0), P(lo, c1, y0)], [0, -1, 0], u0, v0, u1, v1, r * 0.6, g * 0.6, bl * 0.6);
        this._poly(ctx, b, [P(lo, c0, y0), P(hi, c0, y0), P(hi, c0, y1)], nC0, u0, v0, u1, v1, r * 0.85, g * 0.85, bl * 0.85);
        this._poly(ctx, b, [P(lo, c1, y0), P(hi, c1, y0), P(hi, c1, y1)], [-nC0[0], 0, -nC0[2]], u0, v0, u1, v1, r * 0.85, g * 0.85, bl * 0.85);
    },

    // Грань декора по точкам (3 или 4) и наружной нормали: обход подбирается сам.
    _poly(ctx, b, pts, n, u0, v0, u1, v1, r, g, bl) {
        const A = pts[0], B = pts[1], C = pts[2];
        const ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2], fx = C[0] - A[0], fy = C[1] - A[1], fz = C[2] - A[2];
        const dot = (ey * fz - ez * fy) * n[0] + (ez * fx - ex * fz) * n[1] + (ex * fy - ey * fx) * n[2];
        const flip = dot > 0;                      // как у граней кирпича: векторное произведение рёбер смотрит ВНУТРЬ
        if (pts.length === 4) {
            const D = pts[3];
            this._quad(ctx, b, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2], n[0], n[1], n[2], u0, u1, v0, v1, r, g, bl, flip);
            return;
        }
        const pos = ctx.pos, nor = ctx.nor, uv = ctx.uv, col = ctx.col, a = ctx.v;
        for (let q = 0; q < 3; q++) {
            const p = pts[q], v = ctx.v++, o = v * 3;
            if (ctx.world) {
                pos[o] = b.x + p[0] * b.c - p[2] * b.s; pos[o + 1] = this.base + p[1]; pos[o + 2] = b.z + p[0] * b.s + p[2] * b.c;
                nor[o] = n[0] * b.c - n[2] * b.s; nor[o + 1] = n[1]; nor[o + 2] = n[0] * b.s + n[2] * b.c;
            } else {
                pos[o] = p[0] - ctx.ox; pos[o + 1] = p[1] - ctx.oy; pos[o + 2] = p[2] - ctx.oz;
                nor[o] = n[0]; nor[o + 1] = n[1]; nor[o + 2] = n[2];
            }
            uv[v * 2] = q === 0 ? u0 : u1; uv[v * 2 + 1] = q === 2 ? v0 : v1;
            col[v * 4] = r; col[v * 4 + 1] = g; col[v * 4 + 2] = bl; col[v * 4 + 3] = 1;
        }
        const idx = ctx.idx;
        if (flip) { idx[ctx.t++] = a; idx[ctx.t++] = a + 2; idx[ctx.t++] = a + 1; } else { idx[ctx.t++] = a; idx[ctx.t++] = a + 1; idx[ctx.t++] = a + 2; }
    },

    // Кирпич ci здания b со своим декором -> вершины в ctx. id — номер кирпича (разброс оттенка), k — затемнение 0..1.
    _emitBrick(ctx, b, ci, id, k) {
        const { nx, nz, cw, cd, ch } = b, plan = b.plan;
        const i = ci % nx, kk = Math.floor(ci / nx) % nz, j = Math.floor(ci / (nx * nz));
        const t = plan.tiles(ci, this._t6), inner = plan.inner != null ? plan.inner : GameArch.tile('inner');
        // снаружи — тайл плана, между кирпичами — изнанка
        if (this._filled(b, i + 1, j, kk)) t[0] = inner;
        if (this._filled(b, i - 1, j, kk)) t[1] = inner;
        if (this._filled(b, i, j, kk + 1)) t[2] = inner;
        if (this._filled(b, i, j, kk - 1)) t[3] = inner;
        if (this._filled(b, i, j + 1, kk)) t[4] = inner;
        if (j > 0 && this._filled(b, i, j - 1, kk)) t[5] = inner;
        const tint = plan.tintOf(ci), jit = (0.94 + ((KR.hash(id, 17) % 100) / 100) * 0.1) * k;
        const r = ((tint >> 16) & 255) / 255 * jit, g = ((tint >> 8) & 255) / 255 * jit, bl = (tint & 255) / 255 * jit;
        const x0 = i * cw - b.w / 2, y0 = j * ch, z0 = kk * cd - b.d / 2;
        this._box(ctx, b, x0, y0, z0, x0 + cw, y0 + ch, z0 + cd, t, r, g, bl);
        const ps = b.partsBy ? b.partsBy.get(ci) : null;
        if (!ps) return;
        for (const p of ps) {
            const pt = p.tint != null ? p.tint : tint, pr = ((pt >> 16) & 255) / 255 * k, pg = ((pt >> 8) & 255) / 255 * k, pb = (pt & 255) / 255 * k;
            if (p.kind === 'wedge') this._wedge(ctx, b, p, pr, pg, pb);
            else { t[0] = t[1] = t[2] = t[3] = t[4] = t[5] = p.tile || 0; this._box(ctx, b, Math.min(p.x0, p.x1), Math.min(p.y0, p.y1), Math.min(p.z0, p.z1), Math.max(p.x0, p.x1), Math.max(p.y0, p.y1), Math.max(p.z0, p.z1), t, pr, pg, pb); }
        }
    },

    // --- Руины: куча щебня на каждой клетке первого этажа, где кирпич разрушен ----------------------
    buildRubble() {
        let cap = 0;
        for (const b of this.buildings) cap += b.ground;
        this.rubbleCap = cap; this.rubbleCount = 0;
        if (!cap) return;
        const scene = this.view.scene, rnd = KR.rng(91), parts = [];
        // куча: несколько наклонённых блоков в пределах клетки 1×1, высота до 1
        for (let i = 0; i < 7; i++) {
            const w = 0.28 + rnd() * 0.34, h = 0.2 + rnd() * 0.42, d = 0.28 + rnd() * 0.34;
            const m = BABYLON.MeshBuilder.CreateBox('rb', { width: w, height: h, depth: d }, scene);
            m.position.set((rnd() - 0.5) * 0.62, h * 0.32 + rnd() * 0.22, (rnd() - 0.5) * 0.62);
            m.rotation.set((rnd() - 0.5) * 1.1, rnd() * 3, (rnd() - 0.5) * 1.1);
            parts.push(m);
        }
        const slab = BABYLON.MeshBuilder.CreateBox('rb', { width: 0.98, height: 0.12, depth: 0.98 }, scene);
        slab.position.y = 0.06;
        parts.push(slab);
        const mesh = BABYLON.Mesh.MergeMeshes(parts, true, true);
        if (!mesh) return;
        mesh.name = 'rubble';
        const mat = new BABYLON.StandardMaterial('rubble', scene);
        mat.diffuseTexture = new BABYLON.Texture('assets/textures/facade_inner.webp', scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null, () => { mat.diffuseTexture = null; });
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mesh.material = mat;
        this.rubbleM = new Float32Array(cap * 16); this.rubbleC = new Float32Array(cap * 4);
        mesh.thinInstanceSetBuffer('matrix', this.rubbleM, 16, false);
        mesh.thinInstanceSetBuffer('color', this.rubbleC, 4, false);
        mesh.thinInstanceCount = 0;
        mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false;
        mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -50, 0), new BABYLON.Vector3(this.mapW, 400, this.mapH)));
        World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false, castShadow: false });
        this.rubble = mesh;
        this.meshes.push(mesh);
    },

    // --- Шрамы на земле: трещины и подпалины остаются до конца раунда (thin instances, кольцевой буфер) ---
    buildScars() {
        const scene = this.view.scene, cap = IS_MOBILE ? 140 : KR.quality() === 'low' ? 160 : 420;
        // Пути — литералами (сборщик).
        const urls = { crack: 'assets/fx/crack.webp', scorch: 'assets/fx/scorch.webp' };
        this.scars = {};
        for (const kind of ['scorch', 'crack']) {
            const mesh = BABYLON.MeshBuilder.CreateGround('scar-' + kind, { width: 1, height: 1 }, scene);
            const mat = new BABYLON.StandardMaterial('scar-' + kind, scene);
            const tex = new BABYLON.Texture(urls[kind], scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null, () => { mesh.setEnabled(false); });
            tex.hasAlpha = true;
            mat.diffuseTexture = tex; mat.useAlphaFromDiffuseTexture = true;
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.zOffset = kind === 'crack' ? -9 : -7;
            mat.backFaceCulling = false;
            mesh.material = mat;
            mesh.hasVertexAlpha = true;
            const m = new Float32Array(cap * 16), c = new Float32Array(cap * 4);
            mesh.thinInstanceSetBuffer('matrix', m, 16, false);
            mesh.thinInstanceSetBuffer('color', c, 4, false);
            mesh.thinInstanceCount = 0;
            mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false;
            mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -50, 0), new BABYLON.Vector3(this.mapW, 100, this.mapH)));
            World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false, castShadow: false });
            this.meshes.push(mesh);
            this.scars[kind] = { mesh, m, c, n: 0, cap, dirty: false };
        }
    },

    /** Оставить след на земле: kind — 'crack' (трещины) | 'scorch' (подпалина), radius — px, alpha 0..1. */
    scar(x, z, radius, kind, alpha) {
        const S = this.scars[kind || 'crack'];
        if (!S || !(radius > 4) || this.loc.waterAt(x, z) != null) return;
        const i = S.n % S.cap, o = i * 16, a = Math.random() * 6.283, c = Math.cos(a), s = Math.sin(a), d = radius * 2;
        S.n++;
        S.m[o] = c * d; S.m[o + 1] = 0; S.m[o + 2] = -s * d; S.m[o + 3] = 0;
        S.m[o + 4] = 0; S.m[o + 5] = 1; S.m[o + 6] = 0; S.m[o + 7] = 0;
        S.m[o + 8] = s * d; S.m[o + 9] = 0; S.m[o + 10] = c * d; S.m[o + 11] = 0;
        S.m[o + 12] = x; S.m[o + 13] = this.base + 4 + (i % 40) * 0.06; S.m[o + 14] = z; S.m[o + 15] = 1;
        S.c[i * 4] = 1; S.c[i * 4 + 1] = 1; S.c[i * 4 + 2] = 1; S.c[i * 4 + 3] = alpha == null ? 0.85 : alpha;
        S.dirty = true;
    },

    // --- Пожары: зона горит несколько секунд и понемногу разрушает всё внутри -----------------------
    /** Поджечь место: radius — px, seconds — сколько горит, dmg — урон одной «искры» (их несколько в секунду). */
    ignite(x, y, z, radius, seconds, dmg) {
        if (this.loc.waterAt(x, z) != null) return;
        if (this.fires.length >= (IS_MOBILE ? 12 : 26)) this.fires.shift();
        this.fires.push({ x, y, z, r: radius, t: seconds, tick: Math.random() * 0.3, dmg });
        FX('fire', x, y, z, radius, seconds);
        this.scar(x, z, radius * 0.9, 'scorch', 0.6);
    },

    _addRubble(b, ci, id) {
        if (!this.rubble || this.rubbleCount >= this.rubbleCap) return;
        const n = this.rubbleCount++, o = n * 16, m = this.rubbleM, h = KR.hash(id, 7);
        const p = this._center(b, ci, GameCity._tmp);
        const a = -b.yaw + (h % 4) * Math.PI / 2 + ((h >> 4) % 40 - 20) * 0.01, c = Math.cos(a), s = Math.sin(a);
        const sx = b.cw * 1.12, sy = b.ch * (0.3 + ((h >> 8) % 100) / 100 * 0.42), sz = b.cd * 1.12;
        m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = s * sz; m[o + 9] = 0; m[o + 10] = c * sz; m[o + 11] = 0;
        m[o + 12] = p[0]; m[o + 13] = this.base; m[o + 14] = p[2]; m[o + 15] = 1;
        const k = 0.75 + ((h >> 16) % 100) / 100 * 0.45, q = n * 4;
        this.rubbleC[q] = ((b.tint >> 16) & 255) / 255 * k; this.rubbleC[q + 1] = ((b.tint >> 8) & 255) / 255 * k; this.rubbleC[q + 2] = (b.tint & 255) / 255 * k; this.rubbleC[q + 3] = 1;
        this.rubbleDirty = true;
    },

    // --- Пропсы карты (деревья, фонари, достопримечательности) -----------------------------------
    // Как пропс ведёт себя, когда его сломали: pole — валится столбом, rigid — летит целым телом и катается,
    // parts — разваливается на части, land — достопримечательность падает телом и давит дома, explode — взрыв.
    PHYS: {
        bush: 'parts', tent: 'parts', market_stall: 'parts', newsstand: 'parts', bus_stop: 'parts', fence: 'parts', hydrant: 'parts',
        umbrella: 'parts', neon_sign_b: 'parts', shrine_small: 'parts', ice_hut: 'parts', cafe_table: 'parts', bike_rack: 'parts',
        train_wagon: 'rigid', boat_small: 'rigid', phone_booth: 'rigid', atm: 'rigid', portable_toilet: 'rigid',
    },

    _propPhys(id, info) {
        if (info.mode === 'explode') return 'explode';
        if (info.mode === 'topple') return 'land';
        if (this.PHYS[id]) return this.PHYS[id];
        if (info.long) return 'parts';
        if (info.h >= info.r * 2.6 && info.r <= 16) return 'pole';
        if (info.h <= 45 && info.r <= 32) return 'rigid';
        return 'parts';
    },

    buildProps() {
        const D = Math.PI / 180;
        for (const rec of this.loc.objects) {
            const def = rec.def;
            if (!def || def.kind === 'marker' || !def.model || rec.hidden) continue;
            const id = String(def.model).replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, ''), info = KR.PROPS[id];
            if (!info) continue;
            const sc = def.scale ? Math.max(def.scale[0], def.scale[2]) : 1, sy = def.scale ? def.scale[1] : 1;
            const p = { rec, id, info, x: def.x, z: def.y, y: this.base + (def.h || 0), yaw: ((def.rot ? def.rot[1] : 0) || 0) * D, r: info.r * sc, h: info.h * sy, hp: info.hp, dead: false, phys: this._propPhys(id, info), dyn: -1 };
            const n = this.props.push(p) - 1;
            const g = this._gridIndex(p.x, p.z);
            if (g >= 0) this.propGrid[g].push(n);
        }
    },

    _gridIndex(x, z) {
        const gx = Math.floor(x / this.GRID), gz = Math.floor(z / this.GRID);
        return gx < 0 || gz < 0 || gx >= this.gridW || gz >= this.gridH ? -1 : gz * this.gridW + gx;
    },

    // --- Проходимость для наземной техники: клетка занята зданием или водой -----------------------
    buildNav() {
        const N = this.NAV;
        this.nav.fill(0);
        for (let j = 0; j < this.navH; j++) for (let i = 0; i < this.navW; i++) {
            const x = (i + 0.5) * N, z = (j + 0.5) * N;
            if (this.loc.waterAt(x, z) != null) this.nav[j * this.navW + i] = 2;
        }
        for (const b of this.buildings) this._navBuilding(b, 1);
    },

    _navBuilding(b, value) {
        const N = this.NAV;
        for (let j = Math.max(0, Math.floor(b.z0 / N)); j <= Math.min(this.navH - 1, Math.floor(b.z1 / N)); j++)
            for (let i = Math.max(0, Math.floor(b.x0 / N)); i <= Math.min(this.navW - 1, Math.floor(b.x1 / N)); i++) {
                const k = j * this.navW + i;
                if (this.nav[k] === 2) continue;
                const x = (i + 0.5) * N, z = (j + 0.5) * N, dx = x - b.x, dz = z - b.z;
                const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
                if (Math.abs(lx) < b.w / 2 + N * 0.35 && Math.abs(lz) < b.d / 2 + N * 0.35) this.nav[k] = value;
            }
    },

    /** Клетка проходимости свободна (для ИИ техники). */
    navFree(i, j) { return i >= 0 && j >= 0 && i < this.navW && j < this.navH && this.nav[j * this.navW + i] === 0; },

    // --- Небо и свет карты ---------------------------------------------------------------------
    buildSky() {
        const scene = this.view.scene, info = KR.mapInfo(this.loc.map.id);
        // Пути — литералами (сборщик): панорама неба по карте.
        const skies = {
            metro: 'assets/textures/sky_metro.webp', harbor: 'assets/textures/sky_harbor.webp', tokyo: 'assets/textures/sky_tokyo.webp',
            desert: 'assets/textures/sky_desert.webp', arctic: 'assets/textures/sky_arctic.webp',
        };
        const dome = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 2, segments: 24, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        const mat = new BABYLON.StandardMaterial('sky', scene);
        mat.disableLighting = true; mat.fogEnabled = false; mat.backFaceCulling = false;
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0); mat.specularColor = new BABYLON.Color3(0, 0, 0);
        const tex = new BABYLON.Texture(skies[info.id] || skies.metro, scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE, null, () => { mat.emissiveTexture = null; mat.emissiveColor = World3D.hexColor3(info.sky); });
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        mat.emissiveTexture = tex; mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
        mat.metadata = { toon: false };
        mat.disableDepthWrite = true;
        dome.material = mat;
        dome.scaling.set(38000, 38000, 38000);
        dome.isPickable = false; dome.applyFog = false; dome.alwaysSelectAsActiveMesh = true;
        dome.renderingGroupId = World3D.LAYER.WORLD;
        this.sky = dome;
        this.meshes.push(dome);
        const cam = this.view.camera;
        cam.maxZ = 60000; cam.minZ = 12;
        World3D.setLighting({
            sky: info.sky, fog: info.fog * (IS_MOBILE ? 1.2 : 1), sunAz: info.sunAz, sunEl: info.sunEl, sunColor: info.sun, sunIntensity: info.sunI,
            skyIntensity: info.skyI, skyLight: info.skyLight, groundLight: info.ground, shadowColor: info.shadow,
        }, this.view);
        // Ночные и закатные карты: фасады слегка светятся сами (вторая текстура атласа со своей силой).
        if (this.atlasLit) for (const c of this.chunks) { c.mat.emissiveTexture = this.atlasLit; c.mat.emissiveColor = new BABYLON.Color3(0, 0, 0); }
        this.lit = info.lit;
    },

    /** Небо едет за камерой (у купола нет «бесконечной дали» с туманом сцены). */
    followCamera() {
        if (!this.sky) return;
        const p = this.view.camera.position;
        this.sky.position.set(p.x, this.base - 600, p.z);
    },

    // ---------------------------------------------------------------------------------------------
    // Запросы: столкновение, высота крыши
    // ---------------------------------------------------------------------------------------------

    /** Обойти здания, чей габарит задевает квадрат вокруг (x, z) ± r. */
    _near(x, z, r, fn) {
        const G = this.GRID, stamp = ++this._stamp;
        const gx0 = Math.max(0, Math.floor((x - r) / G)), gx1 = Math.min(this.gridW - 1, Math.floor((x + r) / G));
        const gz0 = Math.max(0, Math.floor((z - r) / G)), gz1 = Math.min(this.gridH - 1, Math.floor((z + r) / G));
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
            const cell = this.grid[gz * this.gridW + gx];
            for (let q = 0; q < cell.length; q++) {
                const id = cell[q];
                if (this._seen[id] === stamp) continue;
                this._seen[id] = stamp;
                const b = this.buildings[id];
                if (b.gone || x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
                fn(b);
            }
        }
    },

    _nearProps(x, z, r, fn) {
        const G = this.GRID;
        const gx0 = Math.max(0, Math.floor((x - r - 160) / G)), gx1 = Math.min(this.gridW - 1, Math.floor((x + r + 160) / G));
        const gz0 = Math.max(0, Math.floor((z - r - 160) / G)), gz1 = Math.min(this.gridH - 1, Math.floor((z + r + 160) / G));
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
            const cell = this.propGrid[gz * this.gridW + gx];
            for (let q = 0; q < cell.length; q++) { const p = this.props[cell[q]]; if (!p.dead) fn(p); }
        }
    },

    /**
     * Круг (x, z, r) не входит в колонны зданий выше stepH и в высокие пропсы. Возвращает { x, z, hit, nx, nz }.
     */
    resolve(x, z, r, stepH) {
        let hit = false, hnx = 0, hnz = 0;
        for (let pass = 0; pass < 2; pass++) {
            this._near(x, z, r, (b) => {
                const dx = x - b.x, dz = z - b.z;
                let lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
                const hw = b.w / 2, hd = b.d / 2;
                if (Math.abs(lx) > hw + r || Math.abs(lz) > hd + r) return;
                const i0 = Math.max(0, Math.floor((lx - r + hw) / b.cw)), i1 = Math.min(b.nx - 1, Math.floor((lx + r + hw) / b.cw));
                const k0 = Math.max(0, Math.floor((lz - r + hd) / b.cd)), k1 = Math.min(b.nz - 1, Math.floor((lz + r + hd) / b.cd));
                const minTop = Math.ceil(stepH / b.ch - 1e-6);
                for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
                    if (b.colTop[k * b.nx + i] <= minTop) continue;
                    const cx0 = i * b.cw - hw, cz0 = k * b.cd - hd;
                    const px = Math.max(cx0, Math.min(cx0 + b.cw, lx)), pz = Math.max(cz0, Math.min(cz0 + b.cd, lz));
                    let ox = lx - px, oz = lz - pz;
                    const d2 = ox * ox + oz * oz;
                    if (d2 >= r * r) continue;
                    let d = Math.sqrt(d2);
                    if (d < 1e-3) { ox = lx - (cx0 + b.cw / 2); oz = lz - (cz0 + b.cd / 2); d = Math.hypot(ox, oz) || 1; lx += ox / d * r * 0.5; lz += oz / d * r * 0.5; }
                    else { const push = r - d; lx += ox / d * push; lz += oz / d * push; }
                    hit = true;
                    hnx += (ox / d) * b.c - (oz / d) * b.s; hnz += (ox / d) * b.s + (oz / d) * b.c;
                }
                x = b.x + lx * b.c - lz * b.s; z = b.z + lx * b.s + lz * b.c;
            });
            this._nearProps(x, z, r, (p) => {
                if (p.h <= stepH * 1.6) return;
                const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), min = r + p.r * 0.7;
                if (d >= min || d < 1e-3) return;
                x += dx / d * (min - d); z += dz / d * (min - d);
                hit = true; hnx += dx / d; hnz += dz / d;
            });
            if (!hit) break;
        }
        const n = Math.hypot(hnx, hnz) || 1;
        return { x, z, hit, nx: hnx / n, nz: hnz / n };
    },

    /** Верх уцелевшей колонны здания tag под точкой (для падающих кусков), иначе -Infinity. */
    roofAt(x, z, tag) {
        const b = this.buildings[tag];
        if (!b || b.gone) return -Infinity;
        const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
        const i = Math.floor((lx + b.w / 2) / b.cw), k = Math.floor((lz + b.d / 2) / b.cd);
        if (i < 0 || k < 0 || i >= b.nx || k >= b.nz) return -Infinity;
        return this.base + b.colTop[k * b.nx + i] * b.ch;
    },

    /** Высота уцелевшей застройки в точке (верх колонны здания) или уровень земли. */
    heightAt(x, z) {
        let top = this.base;
        this._near(x, z, 2, (b) => { const h = this.roofAt(x, z, b.id); if (h > top) top = h; });
        return top;
    },

    /** Самая высокая уцелевшая точка зданий под кругом (камера, вертолёты). */
    topAt(x, z, r) {
        let top = this.base;
        this._near(x, z, r, (b) => {
            const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
            if (Math.abs(lx) > b.w / 2 + r || Math.abs(lz) > b.d / 2 + r) return;
            top = Math.max(top, this.base + b.h);
        });
        return top;
    },

    // ---------------------------------------------------------------------------------------------
    // Урон
    // ---------------------------------------------------------------------------------------------

    /**
     * Сфера урона. dir — направление удара {x, y, z} или null (от центра), power — скорость разлёта обломков px/с.
     * Бьёт кирпичи зданий, пропсы, падающие секции; обломки и лежащие пропсы в шаре отлетают.
     * Возвращает число разбитых кирпичей и пропсов.
     */
    hitSphere(x, y, z, radius, dmg, dir, power) {
        let broke = this._hitBricks(x, y, z, radius, dmg, dir, power);
        this._nearProps(x, z, radius, (p) => {
            const d = Math.hypot(p.x - x, p.z - z);
            if (d > radius + p.r || y - radius > p.y + p.h || y + radius < p.y) return;
            if (this.damageProp(p, dmg * (1 - 0.5 * Math.min(1, d / (radius + p.r))), x, z)) broke++;
        });
        if (this.secLive) broke += this._hitSections(x, y, z, radius, dmg, dir, power || 200);
        if (power) {
            GameDebris.shove(x, y, z, radius, dir, power * 0.7);
            if (this.dyn.length) this._shoveProps(x, y, z, radius, dir, power * 0.7);
        }
        return broke;
    },

    // Кирпичи зданий в шаре.
    _hitBricks(x, y, z, radius, dmg, dir, power) {
        let broke = 0;
        const ly = y - this.base, r2 = radius * radius;
        this._near(x, z, radius, (b) => {
            const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c, hw = b.w / 2, hd = b.d / 2;
            const i0 = Math.max(0, Math.floor((lx - radius + hw) / b.cw)), i1 = Math.min(b.nx - 1, Math.floor((lx + radius + hw) / b.cw));
            const k0 = Math.max(0, Math.floor((lz - radius + hd) / b.cd)), k1 = Math.min(b.nz - 1, Math.floor((lz + radius + hd) / b.cd));
            const j0 = Math.max(0, Math.floor((ly - radius) / b.ch)), j1 = Math.min(b.ny - 1, Math.floor((ly + radius) / b.ch));
            for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
                const id = b.cells[(j * b.nz + k) * b.nx + i];
                if (id < 0 || this.bState[id] !== 1) continue;
                const cx0 = i * b.cw - hw, cy0 = j * b.ch, cz0 = k * b.cd - hd;
                const ox = lx - Math.max(cx0, Math.min(cx0 + b.cw, lx)), oy = ly - Math.max(cy0, Math.min(cy0 + b.ch, ly)), oz = lz - Math.max(cz0, Math.min(cz0 + b.cd, lz));
                const d2 = ox * ox + oy * oy + oz * oz;
                if (d2 > r2) continue;
                const f = 1 - 0.55 * Math.sqrt(d2) / radius;
                if (this.damageBrick(id, dmg * f, x, y, z, dir, power)) broke++;
            }
        });
        return broke;
    },

    /** Раздавить ногой: колонны не выше maxTop целиком и мелкие пропсы в круге. */
    trample(x, z, radius, maxTop, dmg) {
        let broke = 0;
        this._near(x, z, radius, (b) => {
            const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c, hw = b.w / 2, hd = b.d / 2;
            const i0 = Math.max(0, Math.floor((lx - radius + hw) / b.cw)), i1 = Math.min(b.nx - 1, Math.floor((lx + radius + hw) / b.cw));
            const k0 = Math.max(0, Math.floor((lz - radius + hd) / b.cd)), k1 = Math.min(b.nz - 1, Math.floor((lz + radius + hd) / b.cd));
            const maxJ = Math.floor(maxTop / b.ch + 1e-6);
            for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
                const top = b.colTop[k * b.nx + i];
                if (!top || top > maxJ) continue;
                const cx = (i + 0.5) * b.cw - hw - lx, cz = (k + 0.5) * b.cd - hd - lz;
                if (cx * cx + cz * cz > (radius + b.cw * 0.5) * (radius + b.cw * 0.5)) continue;
                for (let j = top - 1; j >= 0; j--) {
                    const id = b.cells[(j * b.nz + k) * b.nx + i];
                    if (id >= 0 && this.bState[id] === 1 && this.damageBrick(id, dmg, x, this.base, z, null, 150)) broke++;
                }
            }
        });
        this._nearProps(x, z, radius, (p) => {
            if (p.h > maxTop * 2.2 || Math.hypot(p.x - x, p.z - z) > radius + p.r) return;
            if (this.damageProp(p, dmg, x, z)) broke++;
        });
        if (this.secLive) broke += this._hitSections(x, this.base + Math.min(maxTop, radius) * 0.5, z, radius, dmg, null, 150);
        return broke;
    },

    /** Урон кирпичу; true — разбит. */
    damageBrick(id, dmg, x, y, z, dir, power) {
        const hp = this.bHp[id] - dmg;
        if (hp > 0) {
            this.bHp[id] = hp;
            this._tintBrick(id, 0.55 + 0.45 * hp / this.buildings[this.bBld[id]].hpBrick);
            return false;
        }
        this.breakBrick(id, x, y, z, dir, power);
        return true;
    },

    // Затемнить кирпич (трещины, копоть): цвет его вершин × k (от исходного).
    _tintBrick(id, k) {
        const b = this.buildings[this.bBld[id]], c = this.chunks[b.chunk], v = this.bVert[id], n = this.bVN[id];
        const kn = Math.max(40, Math.min(255, Math.round(k * 255))), f = kn / this.bK[id];
        if (f === 1) return;
        this.bK[id] = kn;
        for (let q = 0; q < n; q++) { const o = (v + q) * 4; c.col[o] *= f; c.col[o + 1] *= f; c.col[o + 2] *= f; }
        if (v * 4 < c.c0) c.c0 = v * 4;
        if ((v + n) * 4 > c.c1) c.c1 = (v + n) * 4;
    },

    // Центр кирпича в мире -> out [x, y, z].
    _center(b, ci, out) {
        const i = ci % b.nx, k = Math.floor(ci / b.nx) % b.nz, j = Math.floor(ci / (b.nx * b.nz));
        const lx = (i + 0.5) * b.cw - b.w / 2, lz = (k + 0.5) * b.cd - b.d / 2;
        out[0] = b.x + lx * b.c - lz * b.s; out[1] = this.base + (j + 0.5) * b.ch; out[2] = b.z + lx * b.s + lz * b.c;
        return out;
    },

    // У живого кирпича открыта хоть одна грань (ему нужен коллайдер).
    _exposed(b, i, j, k) {
        const c = b.cells, nx = b.nx, nz = b.nz, ci = (j * nz + k) * nx + i;
        return i === 0 || i === nx - 1 || k === 0 || k === nz - 1 || j === b.ny - 1 ||
            c[ci - 1] < 0 || c[ci + 1] < 0 || c[ci - nx] < 0 || c[ci + nx] < 0 || c[ci + nx * nz] < 0 || (j > 0 && c[ci - nx * nz] < 0);
    },

    // Неподвижный коллайдер кирпича в зоне zn.
    _brickCollider(b, id, x, y, z, zn) {
        const h = GamePhysics.addFixed(x, y, z, b.cw / 2, b.ch / 2, b.cd / 2, -b.yaw);
        if (h < 0) return;
        this.bCol[id] = h;
        this.colBrick.set(h, id);
        zn.bricks.push(id);
    },

    // Зона GameDebris открылась: открытым кирпичам зданий, чей центр в ней, — коллайдеры.
    _zoneOpen(zn) {
        const ZX = GameDebris.ZX, ZY = GameDebris.ZY, y0 = zn.iy * ZY, y1 = y0 + ZY, cx = (zn.ix + 0.5) * ZX, cz = (zn.iz + 0.5) * ZX, p = GameCity._tmp;
        this._near(cx, cz, ZX * 0.5 + 1, (b) => {
            if (y0 > b.h) return;
            const dx = cx - b.x, dz = cz - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c, hw = b.w / 2, hd = b.d / 2;
            const e = ZX * 0.5 * (Math.abs(b.c) + Math.abs(b.s));
            const i0 = Math.max(0, Math.floor((lx - e + hw) / b.cw)), i1 = Math.min(b.nx - 1, Math.floor((lx + e + hw) / b.cw));
            const k0 = Math.max(0, Math.floor((lz - e + hd) / b.cd)), k1 = Math.min(b.nz - 1, Math.floor((lz + e + hd) / b.cd));
            const j0 = Math.max(0, Math.ceil(y0 / b.ch - 0.5)), j1 = Math.min(b.ny - 1, Math.ceil(y1 / b.ch - 0.5) - 1);
            for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
                const ci = (j * b.nz + k) * b.nx + i, id = b.cells[ci];
                if (id < 0 || this.bCol[id] >= 0 || !this._exposed(b, i, j, k)) continue;
                this._center(b, ci, p);
                if (Math.floor(p[0] / ZX) !== zn.ix || Math.floor(p[2] / ZX) !== zn.iz) continue;
                this._brickCollider(b, id, p[0], p[1], p[2], zn);
            }
        });
    },

    _zoneClose(zn) {
        for (const id of zn.bricks) {
            const h = this.bCol[id];
            if (h < 0) continue;
            this.colBrick.delete(h);
            GamePhysics.removeFixed(h);
            this.bCol[id] = -1;
        }
        zn.bricks.length = 0;
    },

    // Убрать кирпич из меша и из сетки здания. Возвращает здание.
    _removeBrick(id) {
        const b = this.buildings[this.bBld[id]], c = this.chunks[b.chunk], v = this.bVert[id], vn = this.bVN[id], ci = this.bCell[id];
        this.bState[id] = 0;
        c.pos.fill(0, v * 3, (v + vn) * 3);
        if (v * 3 < c.p0) c.p0 = v * 3;
        if ((v + vn) * 3 > c.p1) c.p1 = (v + vn) * 3;
        const h = this.bCol[id];
        if (h >= 0) { this.colBrick.delete(h); GamePhysics.removeFixed(h); this.bCol[id] = -1; }
        b.cells[ci] = -1;
        b.alive--;
        this.deadCount++;
        const nx = b.nx, nz = b.nz, i = ci % nx, k = Math.floor(ci / nx) % nz, j = Math.floor(ci / (nx * nz));
        if (j === 0) { b.groundAlive--; this._addRubble(b, ci, id); }
        const col = k * nx + i;
        if (b.colTop[col] === j + 1) {                       // верх колонны ушёл — найти новый
            let top = 0;
            for (let jj = j - 1; jj >= 0; jj--) if (b.cells[(jj * nz + k) * nx + i] >= 0) { top = jj + 1; break; }
            b.colTop[col] = top;
        }
        b.lv[j] = 1;
        if (!b.dirty) { b.dirty = true; this._dirty.push(b); }
        // соседи стали открытыми: в активной зоне им нужен коллайдер
        if (GameDebris.zones.size) {
            if (i > 0) this._expose(b, ci - 1);
            if (i < nx - 1) this._expose(b, ci + 1);
            if (k > 0) this._expose(b, ci - nx);
            if (k < nz - 1) this._expose(b, ci + nx);
            if (j > 0) this._expose(b, ci - nx * nz);
            if (j < b.ny - 1) this._expose(b, ci + nx * nz);
        }
        return b;
    },

    _expose(b, ci) {
        const id = b.cells[ci];
        if (id < 0 || this.bCol[id] >= 0) return;
        const p = this._center(b, ci, GameCity._W), zn = GameDebris.zoneAt(p[0], p[1], p[2]);
        if (zn) this._brickCollider(b, id, p[0], p[1], p[2], zn);
    },

    // Насколько подробно колоть: 2 — полный набор кусков, 1 — меньше, 0 — один кусок (по бюджету тел и разрушений).
    _lod() {
        const room = GameDebris.room(), big = this._breakBudget-- > 0;
        return room > 0.45 && big ? 2 : room > 0.2 ? 1 : 0;
    },

    /** Кирпич разбит ударом: обломки по стилю фасада летят по направлению удара. */
    breakBrick(id, x, y, z, dir, power) {
        if (this.bState[id] === 0) return;
        const b = this.buildings[this.bBld[id]], ci = this.bCell[id], p = this._center(b, ci, GameCity._tmp), px = p[0], py = p[1], pz = p[2];
        let d = dir;
        if (!d) { const dx = px - x, dy = py - y + b.ch * 0.4, dz = pz - z, l = Math.hypot(dx, dy, dz) || 1; d = GameCity._dir; d.x = dx / l; d.y = dy / l; d.z = dz / l; }
        const lod = this._lod();
        this._fragments(b, ci, px, py, pz, 0, Math.sin(-b.yaw / 2), 0, Math.cos(-b.yaw / 2), d, power || 220, lod, 0, 0, 0);
        this._removeBrick(id);
        GameDebris.wakeSphere(px, py + b.ch * 0.6, pz, b.cw * 0.6, 6);       // то, что лежало на кирпиче, падает
        if (this._fxT <= 0 || lod === 2) { FX('brickBreak', px, py, pz, Math.max(b.cw, b.ch), b.plan.tintOf(ci)); this._fxT = 0.02; }
        if (this._sfxT <= 0) { SFX('brick_break', { volume: 0.5 + Math.random() * 0.3 }); this._sfxT = 0.07; }
        if (this.hooks.score) this.hooks.score(1, px, py, pz, 'brick');
    },

    // --- Обломки кирпича по стилю фасада ------------------------------------------------------------

    // Один кусок в системе кирпича (контекст — GameCity._F): смещение от центра, полуразмеры, цвет, флаги, тайлы.
    _put(lx, ly, lz, hx, hy, hz, color, flags, tile, tileB, mix) {
        const F = GameCity._F, a = F.a, r = Math.random, q = F.q, pw = F.power;
        const x = F.cx + a[0] * lx + a[3] * ly + a[6] * lz, z = F.cz + a[2] * lx + a[5] * ly + a[8] * lz;
        const y = Math.max(this.base + Math.min(hx, hy, hz) + 1, F.cy + a[1] * lx + a[4] * ly + a[7] * lz);
        let vx = F.vx + (r() - 0.5) * pw * 0.5, vy = F.vy + r() * pw * 0.4, vz = F.vz + (r() - 0.5) * pw * 0.5;
        if (F.dir) { const f = pw * (0.4 + r() * 0.7); vx += F.dir.x * f; vy += F.dir.y * f; vz += F.dir.z * f; }
        const s = 7 / (1 + Math.max(hx, hy, hz) * 0.05);
        return GameDebris.spawnQ(x, y, z, hx, hy, hz, vx, vy, vz, (r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s, q[0], q[1], q[2], q[3], color, flags, tile, tileB, mix, false);
    },

    _shade(c, k) { return (Math.min(255, ((c >> 16) & 255) * k) & 255) << 16 | (Math.min(255, ((c >> 8) & 255) * k) & 255) << 8 | (Math.min(255, (c & 255) * k) & 255); },

    // Оси по кватерниону -> a[9] (образы осей X, Y, Z).
    _axes(qx, qy, qz, qw, a) {
        a[0] = 1 - 2 * (qy * qy + qz * qz); a[1] = 2 * (qx * qy + qz * qw); a[2] = 2 * (qz * qx - qy * qw);
        a[3] = 2 * (qx * qy - qz * qw); a[4] = 1 - 2 * (qz * qz + qx * qx); a[5] = 2 * (qy * qz + qx * qw);
        a[6] = 2 * (qz * qx + qy * qw); a[7] = 2 * (qy * qz - qx * qw); a[8] = 1 - 2 * (qy * qy + qx * qx);
        return a;
    },

    _ctx(cx, cy, cz, qx, qy, qz, qw, dir, power, vx, vy, vz) {
        const F = GameCity._F;
        F.cx = cx; F.cy = cy; F.cz = cz; F.dir = dir; F.power = power; F.vx = vx; F.vy = vy; F.vz = vz;
        F.q[0] = qx; F.q[1] = qy; F.q[2] = qz; F.q[3] = qw;
        this._axes(qx, qy, qz, qw, F.a);
    },

    /**
     * Кирпич ci здания b раскалывается: плита перекрытия, фасадные панели (или стекло), балки, крошка — по классу стиля.
     * (cx, cy, cz) и кватернион — где кирпич сейчас (в здании или в падающей секции), v — его скорость, lod — подробность.
     */
    _fragments(b, ci, cx, cy, cz, qx, qy, qz, qw, dir, power, lod, vx, vy, vz) {
        if (!GameDebris.mesh) return;
        const D = GameDebris, r = Math.random, plan = b.plan, a = b.cw / 2, hh = b.ch / 2, d = b.cd / 2, cls = b.cls;
        const i = ci % b.nx, k = Math.floor(ci / b.nx) % b.nz, j = Math.floor(ci / (b.nx * b.nz));
        const t = plan.tiles(ci, this._t6), inner = plan.inner != null ? plan.inner : GameArch.tile('inner');
        const tint = plan.tintOf(ci), dark = this._shade(tint, 0.78);
        const o0 = !this._filled(b, i + 1, j, k), o1 = !this._filled(b, i - 1, j, k), o2 = !this._filled(b, i, j, k + 1), o3 = !this._filled(b, i, j, k - 1), roof = !this._filled(b, i, j + 1, k);
        const side = o0 ? t[0] : o1 ? t[1] : o2 ? t[2] : o3 ? t[3] : -1, top = roof ? t[4] : inner;
        this._ctx(cx, cy, cz, qx, qy, qz, qw, dir, power, vx, vy, vz);
        // декор кирпича отлетает своими кусками
        const ps = b.partsBy ? b.partsBy.get(ci) : null;
        if (ps && lod > 0) {
            const bx = (i + 0.5) * b.cw - b.w / 2, by = (j + 0.5) * b.ch, bz = (k + 0.5) * b.cd - b.d / 2;
            for (const p of ps) {
                const phx = Math.max(2, Math.abs(p.x1 - p.x0) * 0.48), phy = Math.max(2, Math.abs(p.y1 - p.y0) * (p.kind === 'wedge' ? 0.3 : 0.48)), phz = Math.max(2, Math.abs(p.z1 - p.z0) * 0.48);
                this._put((p.x0 + p.x1) / 2 - bx, (p.y0 + p.y1) / 2 - by, (p.z0 + p.z1) / 2 - bz, phx, phy, phz, p.tint != null ? p.tint : tint, Math.max(phx, phy, phz) > 30 ? 1 : 0, p.tile || 0, p.tile || 0, 0);
            }
        }
        if (lod <= 0) {                                 // тел мало: один обломок стены
            if (side >= 0) D.sub(0.2, 0.2, 0.8, 0.8);
            this._put(0, 0, 0, a * 0.55, hh * 0.5, d * 0.55, tint, 2, side, inner, side >= 0 ? 0 : 1);
            return;
        }
        // перекрытие (у верхнего кирпича — ещё и кровля)
        this._put(0, -hh + 5, 0, a * 0.94, 4.5, d * 0.94, dark, 3, inner, inner, 0);
        if (roof && lod === 2) this._put(0, hh - 5, 0, a * 0.94, 4.5, d * 0.94, tint, 3, inner, top, 0);
        // фасад: панели, стекло, доски
        let faces = 0;
        const maxFaces = lod === 2 ? 2 : 1;
        for (let f = 0; f < 4 && faces < maxFaces; f++) {
            if (!(f === 0 ? o0 : f === 1 ? o1 : f === 2 ? o2 : o3)) continue;
            faces++;
            const alongZ = f < 2, sg = f === 0 || f === 2 ? 1 : -1, L = alongZ ? d : a, tile = t[f];
            const nxw = alongZ ? sg : 0, nzw = alongZ ? 0 : sg;                 // нормаль грани в осях кирпича
            if (cls === 1) {
                const n = lod === 2 ? 3 : 2;
                for (let q = 0; q < n; q++) {
                    const s1 = L * (0.2 + r() * 0.22), s2 = hh * (0.22 + r() * 0.3), u = (r() - 0.5) * L * 1.2, w = (r() - 0.5) * hh * 1.2;
                    this._put(alongZ ? sg * (a - 2) : u, w, alongZ ? u : sg * (d - 2), alongZ ? 1.3 : s1, s2, alongZ ? s1 : 1.3, 0xd4f0ff, 4, -1, -1, 2);
                }
                if (lod === 2) this._put(alongZ ? sg * (a - 3) : (r() - 0.5) * a, 0, alongZ ? (r() - 0.5) * d : sg * (d - 3), 2.6, hh * 0.95, 2.6, 0x5a6470, 0, -1, -1, 2);
                const F = GameCity._F.a;
                if (this._dustN < 6) FX('glassBurst', cx + (F[0] * nxw + F[6] * nzw) * a, cy, cz + (F[2] * nxw + F[8] * nzw) * d, F[0] * nxw + F[6] * nzw, F[2] * nxw + F[8] * nzw, lod === 2 ? 14 : 8);
            } else if (cls === 3) {
                const n = lod === 2 ? 4 : 2;
                for (let q = 0; q < n; q++) {
                    const v0 = q / n, w = -hh + (q + 0.5) * (2 * hh / n);
                    D.sub(0, v0, 1, v0 + 1 / n);
                    this._put(alongZ ? sg * (a - 2.5) : 0, w, alongZ ? 0 : sg * (d - 2.5), alongZ ? 2.2 : L * 0.95, hh / n * 0.9, alongZ ? L * 0.95 : 2.2, tint, 0, tile, inner, 0);
                }
            } else {
                const th = cls === 2 ? 6 : cls === 4 ? 1.8 : 3.5;
                if (lod === 2) {
                    for (let q = 0; q < 2; q++) {
                        D.sub(0, q * 0.5, 1, q * 0.5 + 0.5);
                        this._put(alongZ ? sg * (a - th) : 0, q ? -hh / 2 : hh / 2, alongZ ? 0 : sg * (d - th), alongZ ? th : L * 0.96, hh * 0.485, alongZ ? L * 0.96 : th, tint, 1, tile, inner, 0);
                    }
                } else this._put(alongZ ? sg * (a - th) : 0, 0, alongZ ? 0 : sg * (d - th), alongZ ? th : L * 0.96, hh * 0.97, alongZ ? L * 0.96 : th, tint, 1, tile, inner, 0);
            }
        }
        // крошка и балки
        if (cls === 2) {
            const n = lod === 2 ? 5 : 3;
            for (let q = 0; q < n; q++) {
                const s = 8 + r() * 9, u = r() * 0.7, v = r() * 0.7;
                if (side >= 0) D.sub(u, v, u + 0.3, v + 0.3);
                this._put((r() - 0.5) * a * 1.4, (r() - 0.5) * hh * 1.4, (r() - 0.5) * d * 1.4, s, s * (0.6 + r() * 0.5), s * (0.7 + r() * 0.5), tint, s < 11 ? 4 : 0, side, inner, side >= 0 ? 0 : 1);
            }
        } else if (cls === 3) {
            for (let q = 0; q < lod; q++) this._put((r() - 0.5) * a, (r() - 0.5) * hh, (r() - 0.5) * d, a * 0.7, 2.2, 4.5, dark, 0, -1, -1, 1);
        } else {
            const n = cls === 1 ? 1 : lod === 2 ? 3 : 1;
            for (let q = 0; q < n; q++) {
                const s = 9 + r() * 10;
                this._put((r() - 0.5) * a * 1.3, (r() - 0.5) * hh * 1.3, (r() - 0.5) * d * 1.3, s, s * (0.5 + r() * 0.5), s * (0.7 + r() * 0.5), r() < 0.4 ? dark : tint, s < 11 ? 4 : 0, -1, -1, 1);
            }
            if (cls !== 0 || lod === 2) {
                const steel = cls === 0 ? dark : 0x56606a, alongX = r() < 0.5;
                this._put((r() - 0.5) * a * 0.6, hh * 0.6, (r() - 0.5) * d * 0.6, alongX ? a * 0.9 : 3, 3, alongX ? 3 : d * 0.9, steel, 0, -1, -1, cls === 0 ? 1 : 2);
                if (cls === 4 && lod === 2) { D.sub(0, 0, 1, 0.5); this._put(0, 0, 0, a * 0.8, 1.6, d * 0.5, tint, 0, side >= 0 ? side : inner, inner, 0); }
            }
        }
    },

    // Кирпич целиком — блок-обломок с тайлом своего фасада (still — сразу лежащий, без тела).
    _block(b, ci, x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, still) {
        const plan = b.plan, i = ci % b.nx, k = Math.floor(ci / b.nx) % b.nz, j = Math.floor(ci / (b.nx * b.nz));
        const t = plan.tiles(ci, this._t6), inner = plan.inner != null ? plan.inner : GameArch.tile('inner');
        const side = !this._filled(b, i + 1, j, k) ? t[0] : !this._filled(b, i - 1, j, k) ? t[1] : !this._filled(b, i, j, k + 1) ? t[2] : !this._filled(b, i, j, k - 1) ? t[3] : inner;
        const top = !this._filled(b, i, j + 1, k) ? t[4] : inner;
        return GameDebris.spawnQ(x, Math.max(this.base + 4, y), z, b.cw * 0.485, b.ch * 0.485, b.cd * 0.485, vx, vy, vz, wx, wy, wz, qx, qy, qz, qw, plan.tintOf(ci), 3, side, top, 0, still);
    },

    // Удар тяжёлого обломка по коллайдеру кирпича (GameDebris.onCrush): урон по скорости удара и размеру.
    _blockHit(handle, x, y, z, dv, size) {
        const id = this.colBrick.get(handle);
        if (id === undefined || this.bState[id] !== 1) return;
        const b = this.buildings[this.bBld[id]];
        this.damageBrick(id, b.hpBrick * Math.min(0.9, 0.14 * Math.pow(dv / 240, 1.5) * (size / 44)), x, y + 20, z, null, 140);
    },

    /** Падающий кусок ударил по этажу ниже в здании tag (прежняя подпись): урон верхнему кирпичу колонны под точкой. */
    crush(x, y, z, speed, size, tag) {
        const b = this.buildings[tag];
        if (!b || b.gone) return;
        const dx = x - b.x, dz = z - b.z, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
        const i = Math.floor((lx + b.w / 2) / b.cw), k = Math.floor((lz + b.d / 2) / b.cd);
        if (i < 0 || k < 0 || i >= b.nx || k >= b.nz) return;
        const top = b.colTop[k * b.nx + i];
        if (!top) return;
        const id = b.cells[((top - 1) * b.nz + k) * b.nx + i];
        if (id >= 0 && this.bState[id] === 1) this.damageBrick(id, b.hpBrick * Math.min(0.9, 0.22 * speed / 240), x, y + 40, z, null, 150);
    },

    // ---------------------------------------------------------------------------------------------
    // Опора и обрушение
    // ---------------------------------------------------------------------------------------------

    // Пересчёт опоры здания: что держится, что отрывается секциями, что заваливается.
    _solve(b) {
        b.dirty = false;
        if (b.gone) return;
        const { nx, ny, nz } = b, n = nx * nz, N = n * ny, cells = b.cells;
        if (b.alive <= 0) { this._finish(b); return; }
        // Осталось мало — здание рушится целиком.
        if (b.alive < b.total * 0.2 || b.groundAlive < b.ground * 0.22) { this.collapse(b); return; }
        const sup = this._sup, vis = this._vis, stk = this._stk, ids = this._ids, span = b.span;
        // sup: 1 — стоит на колонне до земли, 2.. — висит сбоку не дальше span клеток от такой колонны, 0 — без опоры
        for (let c = 0; c < n; c++) sup[c] = cells[c] >= 0 ? 1 : 0;
        let loose = 0;
        for (let j = 1; j < ny; j++) {
            const o = j * n;
            let any = false;
            for (let c = 0; c < n; c++) { const live = cells[o + c] >= 0; sup[o + c] = live && sup[o - n + c] === 1 ? 1 : 0; if (live) any = true; }
            if (!any) continue;
            for (let pass = 2; pass <= 1 + span; pass++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
                const c = o + k * nx + i;
                if (sup[c] || cells[c] < 0) continue;
                const need = pass - 1;
                if ((i > 0 && sup[c - 1] === need) || (i < nx - 1 && sup[c + 1] === need) || (k > 0 && sup[c - nx] === need) || (k < nz - 1 && sup[c + nx] === need)) sup[c] = pass;
            }
            for (let c = 0; c < n; c++) if (cells[o + c] >= 0 && !sup[o + c]) loose++;
        }
        let dropped = 0, jmin = -1;
        // 1) связные куски без опоры — отрываются секциями
        if (loose) {
            vis.fill(0, 0, N);
            for (let c0 = n; c0 < N; c0++) {
                if (cells[c0] < 0 || sup[c0] || vis[c0]) continue;
                let sp = 0, cnt = 0;
                stk[sp++] = c0; vis[c0] = 1;
                while (sp > 0) {
                    const q = stk[--sp], i = q % nx, k = Math.floor(q / nx) % nz, j = Math.floor(q / n);
                    ids[cnt++] = cells[q];
                    if (i > 0 && cells[q - 1] >= 0 && !sup[q - 1] && !vis[q - 1]) { vis[q - 1] = 1; stk[sp++] = q - 1; }
                    if (i < nx - 1 && cells[q + 1] >= 0 && !sup[q + 1] && !vis[q + 1]) { vis[q + 1] = 1; stk[sp++] = q + 1; }
                    if (k > 0 && cells[q - nx] >= 0 && !sup[q - nx] && !vis[q - nx]) { vis[q - nx] = 1; stk[sp++] = q - nx; }
                    if (k < nz - 1 && cells[q + nx] >= 0 && !sup[q + nx] && !vis[q + nx]) { vis[q + nx] = 1; stk[sp++] = q + nx; }
                    if (j > 0 && cells[q - n] >= 0 && !sup[q - n] && !vis[q - n]) { vis[q - n] = 1; stk[sp++] = q - n; }
                    if (j < ny - 1 && cells[q + n] >= 0 && !sup[q + n] && !vis[q + n]) { vis[q + n] = 1; stk[sp++] = q + n; }
                }
                const j0 = Math.floor(c0 / n);
                if (jmin < 0 || j0 < jmin) jmin = j0;
                this._detach(b, cnt, 0, 0, 0);
                dropped += cnt;
            }
        }
        // 2) устойчивость: над уровнем j — связный кусок; основание под ним слишком слабое или центр масс вышел за
        //    основание — весь кусок отрывается одной секцией и заваливается в сторону перевеса
        for (let j = 0; j < ny - 1; j++) {
            if (!b.lv[j]) continue;
            b.lv[j] = 0;
            const o = (j + 1) * n;
            vis.fill(0, o, N);
            for (let c0 = o; c0 < o + n; c0++) {
                if (cells[c0] < 0 || vis[c0]) continue;
                let sp = 0, cnt = 0, S = 0, sx = 0, sz = 0, bi0 = nx, bi1 = -1, bk0 = nz, bk1 = -1, jtop = j + 1;
                stk[sp++] = c0; vis[c0] = 1;
                while (sp > 0) {
                    const q = stk[--sp], i = q % nx, k = Math.floor(q / nx) % nz, jj = Math.floor(q / n);
                    ids[cnt++] = cells[q];
                    sx += i + 0.5; sz += k + 0.5;
                    if (jj > jtop) jtop = jj;
                    if (jj === j + 1 && cells[q - n] >= 0 && sup[q - n] === 1) { S++; if (i < bi0) bi0 = i; if (i > bi1) bi1 = i; if (k < bk0) bk0 = k; if (k > bk1) bk1 = k; }
                    if (i > 0 && cells[q - 1] >= 0 && !vis[q - 1]) { vis[q - 1] = 1; stk[sp++] = q - 1; }
                    if (i < nx - 1 && cells[q + 1] >= 0 && !vis[q + 1]) { vis[q + 1] = 1; stk[sp++] = q + 1; }
                    if (k > 0 && cells[q - nx] >= 0 && !vis[q - nx]) { vis[q - nx] = 1; stk[sp++] = q - nx; }
                    if (k < nz - 1 && cells[q + nx] >= 0 && !vis[q + nx]) { vis[q + nx] = 1; stk[sp++] = q + nx; }
                    if (jj > j + 1 && cells[q - n] >= 0 && !vis[q - n]) { vis[q - n] = 1; stk[sp++] = q - n; }
                    if (jj < ny - 1 && cells[q + n] >= 0 && !vis[q + n]) { vis[q + n] = 1; stk[sp++] = q + n; }
                }
                if (!S || cnt < 3) continue;
                const comX = sx / cnt, comZ = sz / cnt, m = 0.15, cap = Math.max(28, (jtop - j) * 2.2);
                const off = comX < bi0 + m || comX > bi1 + 1 - m || comZ < bk0 + m || comZ > bk1 + 1 - m;
                if (!off && cnt <= S * cap) continue;
                // куда валится: от середины основания к центру масс (в осях здания -> мир)
                let tx = comX - (bi0 + bi1 + 1) / 2, tz = comZ - (bk0 + bk1 + 1) / 2;
                const tl = Math.hypot(tx * b.cw, tz * b.cd);
                if (tl < 4) { tx = 0; tz = 0; } else { tx = tx * b.cw / tl; tz = tz * b.cd / tl; }
                if (jmin < 0 || j + 1 < jmin) jmin = j + 1;
                this._detach(b, cnt, 1, tx * b.c - tz * b.s, tx * b.s + tz * b.c);
                dropped += cnt;
            }
        }
        b.lv[ny - 1] = 0;
        if (dropped) GameDebris.wakeBox(b.x0 - 40, b.x1 + 40, b.z0 - 40, b.z1 + 40);      // обломки на крышах: опоры под ними могло не стать
        if (dropped > 6) { FX('partialCollapse', b.x, this.base + (jmin + 0.5) * b.ch, b.z, b.w, dropped); SFX('collapse', { volume: Math.min(1, 0.35 + dropped * 0.02) }); }
        if (dropped > 20) FX('shake', Math.min(0.5, 0.1 + dropped * 0.003), 300);
    },

    // Кирпичи GameCity._ids[0..cnt) отрываются от здания одним куском. kind: 0 — висел без опоры, 1 — заваливается
    // в сторону (tx, tz), 2 — общее обрушение (толчок наружу по (tx, tz)).
    _detach(b, cnt, kind, tx, tz) {
        const ids = this._ids, r = Math.random, p = GameCity._tmp;
        const cis = new Int32Array(cnt), hps = new Float32Array(cnt), ks = new Uint8Array(cnt);
        for (let q = 0; q < cnt; q++) {
            const id = ids[q], ci = this.bCell[id];
            cis[q] = ci; hps[q] = this.bHp[id]; ks[q] = this.bK[id];
            this._center(b, ci, p);
            this._removeBrick(id);
            if (this.hooks.score) this.hooks.score(1, p[0], p[1], p[2], 'brick');
        }
        if (!GamePhysics.world) return;
        const qy = Math.sin(-b.yaw / 2), qw = Math.cos(-b.yaw / 2);
        let vx = (r() - 0.5) * 16, vy = -20, vz = (r() - 0.5) * 16, wx = (r() - 0.5) * 0.16, wy = (r() - 0.5) * 0.1, wz = (r() - 0.5) * 0.16;
        if (kind === 1) { vx = tx * 16; vz = tz * 16; vy = -8; wx += tz * 0.24; wz -= tx * 0.24; }
        else if (kind === 2) { vx = tx * (25 + r() * 35); vz = tz * (25 + r() * 35); vy = -15; wx += tz * 0.35 + (r() - 0.5) * 0.5; wz += -tx * 0.35 + (r() - 0.5) * 0.5; }
        if (cnt === 1 || this.secLive >= this.secMax()) {
            for (let q = 0; q < cnt; q++) { this._center(b, cis[q], p); this._block(b, cis[q], p[0], p[1], p[2], 0, qy, 0, qw, vx, vy, vz, wx * 3, wy * 3, wz * 3, false); }
            return;
        }
        this._newSection(b, cis, hps, ks, cnt, b.x, this.base, b.z, 0, 0, 0, 0, qy, 0, qw, vx, vy, vz, wx, wy, wz);
    },

    secMax() { const q = KR.quality(); return q === 'low' ? 10 : q === 'medium' ? 22 : 40; },

    /** Здание рушится целиком: первый этаж — в обломки, остальное — крупными секциями, которые валятся и бьются. */
    collapse(b) {
        if (b.gone) return;
        const { nx, ny, nz } = b, n = nx * nz, N = n * ny, cells = b.cells;
        let count = 0;
        this._finish(b);
        this._breakBudget += 16;
        for (let c = 0; c < n; c++) { const id = cells[c]; if (id >= 0) { this.breakBrick(id, b.x, this.base, b.z, null, 170); count++; } }
        const gi = nx >= 6 ? 3 : 2, gk = nz >= 6 ? 3 : 2, gj = 3 + (b.id & 1), vis = this._vis, stk = this._stk, ids = this._ids;
        vis.fill(0, 0, N);
        for (let c0 = n; c0 < N; c0++) {
            if (cells[c0] < 0 || vis[c0]) continue;
            const li = Math.floor((c0 % nx) / gi), lk = Math.floor((Math.floor(c0 / nx) % nz) / gk), lj = Math.floor((Math.floor(c0 / n) - 1) / gj);
            let sp = 0, cnt = 0, sx = 0, sz = 0;
            stk[sp++] = c0; vis[c0] = 1;
            while (sp > 0) {
                const q = stk[--sp], i = q % nx, k = Math.floor(q / nx) % nz, j = Math.floor(q / n);
                ids[cnt++] = cells[q];
                sx += i + 0.5; sz += k + 0.5;
                if (i > 0 && cells[q - 1] >= 0 && !vis[q - 1] && Math.floor((i - 1) / gi) === li) { vis[q - 1] = 1; stk[sp++] = q - 1; }
                if (i < nx - 1 && cells[q + 1] >= 0 && !vis[q + 1] && Math.floor((i + 1) / gi) === li) { vis[q + 1] = 1; stk[sp++] = q + 1; }
                if (k > 0 && cells[q - nx] >= 0 && !vis[q - nx] && Math.floor((k - 1) / gk) === lk) { vis[q - nx] = 1; stk[sp++] = q - nx; }
                if (k < nz - 1 && cells[q + nx] >= 0 && !vis[q + nx] && Math.floor((k + 1) / gk) === lk) { vis[q + nx] = 1; stk[sp++] = q + nx; }
                if (j > 1 && cells[q - n] >= 0 && !vis[q - n] && Math.floor((j - 2) / gj) === lj) { vis[q - n] = 1; stk[sp++] = q - n; }
                if (j < ny - 1 && cells[q + n] >= 0 && !vis[q + n] && Math.floor(j / gj) === lj) { vis[q + n] = 1; stk[sp++] = q + n; }
            }
            // наружу от оси здания
            let tx = (sx / cnt - nx / 2) * b.cw, tz = (sz / cnt - nz / 2) * b.cd;
            const tl = Math.hypot(tx, tz);
            if (tl > 1) { tx /= tl; tz /= tl; } else { const a = Math.random() * 6.283; tx = Math.cos(a); tz = Math.sin(a); }
            this._detach(b, cnt, 2, tx * b.c - tz * b.s, tx * b.s + tz * b.c);
            count += cnt;
        }
        FX('buildingCollapse', b.x, this.base, b.z, b.w, b.h, b.d);
        FX('smokeColumn', b.x, this.base, b.z, 7, Math.max(b.w, b.d) * 0.7);
        this.scar(b.x, b.z, Math.max(b.w, b.d) * 0.75, 'scorch', 0.5);
        SFX('collapse', { volume: Math.min(1, 0.5 + b.total * 0.004) });
        if (this.hooks.collapse) this.hooks.collapse(b, count);
    },

    _finish(b) {
        if (b.gone) return;
        b.gone = true;
        this._navBuilding(b, 0);
        if (this.hooks.gone) this.hooks.gone(b);
    },

    // ---------------------------------------------------------------------------------------------
    // Секции: падающие куски зданий (составные тела Rapier со своим мешем фасада)
    // ---------------------------------------------------------------------------------------------

    /** @type {any} */ _secO: { q: [0, 0, 0, 1], vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, density: 1, friction: 0.8, restitution: 0.02, linDamp: 0.02, angDamp: 0.12, member: 2, filter: 0xffff, kind: 2, ref: -1, hitAcc: 4800 },

    /**
     * Новая секция из кирпичей cis[0..n) здания b (их прочность hps и затемнение ks). Где секция в мире: точка здания
     * (lx, ly, lz) сейчас в мире в (wx0, wy0, wz0), поворот — кватернион; скорость v и вращение w — в этой точке.
     */
    _newSection(b, cis, hps, ks, n, wx0, wy0, wz0, lx, ly, lz, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz) {
        const nx = b.nx, nz = b.nz, G = GamePhysics;
        let i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1, k0 = 1e9, k1 = -1, nv = 0;
        for (let q = 0; q < n; q++) {
            const ci = cis[q], i = ci % nx, k = Math.floor(ci / nx) % nz, j = Math.floor(ci / (nx * nz));
            if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
            nv += this._brickVerts(b, ci);
        }
        const ni = i1 - i0 + 1, nj = j1 - j0 + 1, nk = k1 - k0 + 1;
        const ox = (i0 + i1 + 1) / 2 * b.cw - b.w / 2, oy = (j0 + j1 + 1) / 2 * b.ch, oz = (k0 + k1 + 1) / 2 * b.cd - b.d / 2;
        const a = this._axes(qx, qy, qz, qw, [0, 0, 0, 0, 0, 0, 0, 0, 0]), dx = ox - lx, dy = oy - ly, dz = oz - lz;
        const rx = a[0] * dx + a[3] * dy + a[6] * dz, ry = a[1] * dx + a[4] * dy + a[7] * dz, rz = a[2] * dx + a[5] * dy + a[8] * dz;
        const X = wx0 + rx, Y = wy0 + ry, Z = wz0 + rz;
        const ctx = {
            pos: new Float32Array(nv * 3), nor: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), col: new Float32Array(nv * 4),
            idx: nv > 65535 ? new Uint32Array(Math.ceil(nv * 1.5)) : new Uint16Array(Math.ceil(nv * 1.5)), v: 0, t: 0, world: false, ox, oy, oz,
        };
        const lut = new Int32Array(ni * nj * nk).fill(-1), v0 = new Int32Array(n), vn = new Uint16Array(n), alive = new Uint8Array(n).fill(1);
        for (let q = 0; q < n; q++) {
            const ci = cis[q], i = ci % nx, k = Math.floor(ci / nx) % nz, j = Math.floor(ci / (nx * nz));
            lut[((j - j0) * nk + (k - k0)) * ni + (i - i0)] = q;
            v0[q] = ctx.v;
            this._emitBrick(ctx, b, ci, b.id * 131 + ci, ks[q] / 255);
            vn[q] = ctx.v - v0[q];
        }
        const scene = this.view.scene, mesh = new BABYLON.Mesh('section', scene);
        const vd = new BABYLON.VertexData();
        vd.positions = ctx.pos; vd.normals = ctx.nor; vd.uvs = ctx.uv; vd.colors = ctx.col; vd.indices = ctx.idx.subarray(0, ctx.t);
        vd.applyToMesh(mesh, true);
        mesh.material = this.chunks[b.chunk].mat;
        mesh.hasVertexAlpha = false; mesh.isPickable = false;
        mesh.position.set(X, Y, Z);
        mesh.rotationQuaternion = new BABYLON.Quaternion(qx, qy, qz, qw);
        World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false });
        const id = this.secFree.length ? /** @type {number} */ (this.secFree.pop()) : this.sections.length;
        const hx = ni * b.cw / 2, hy = nj * b.ch / 2, hz = nk * b.cd / 2;
        const s = {
            id, b, body: -1, mesh, pos: ctx.pos, n, N: n, ci: cis, hp: hps, alive, v0, vn, lut, i0, j0, k0, ni, nj, nk, ox, oy, oz, hx, hy, hz,
            R: Math.hypot(hx, hy, hz), mass: n * b.cw * b.ch * b.cd, px: X, py: Y, pz: Z, qx, qy, qz, qw, m: a, v: [0, 0, 0], w: [0, 0, 0],
            rest: 0, age: 0, cool: 0.25, dead: false, dirty: false,
            hitQ: false, hitDv: 0, hitGround: false, hitOther: false, hitN: 0, hitC: new Float32Array(36), hitB: new Int32Array(12),
        };
        this.sections[id] = s;
        this.secLive++;
        const o = this._secO;
        o.q[0] = qx; o.q[1] = qy; o.q[2] = qz; o.q[3] = qw;
        // скорость в начале секции: v + w × r
        o.vx = vx + wy * rz - wz * ry; o.vy = vy + wz * rx - wx * rz; o.vz = vz + wx * ry - wy * rx;
        o.wx = wx; o.wy = wy; o.wz = wz; o.ref = id; o.kind = G.K_SECTION; o.member = G.G_DEBRIS; o.filter = G.G_ALL;
        const nb = this._boxes(s);
        s.body = G.addCompound(X, Y, Z, this._bx, nb, o);
        s.v[0] = o.vx; s.v[1] = o.vy; s.v[2] = o.vz; s.w[0] = wx; s.w[1] = wy; s.w[2] = wz;
        this._secTouch(s);
        return s;
    },

    // Коробки-коллайдеры секции: жадное слияние живых кирпичей -> GameCity._bx (по 6 чисел), возвращает их число.
    _boxes(s) {
        const L = s.lut, NI = s.ni, NJ = s.nj, NK = s.nk, vis = this._vis, b = s.b, size = NI * NJ * NK;
        vis.fill(0, 0, size);
        let nb = 0;
        for (let j = 0; j < NJ; j++) for (let k = 0; k < NK; k++) for (let i = 0; i < NI; i++) {
            const c = (j * NK + k) * NI + i;
            if (L[c] < 0 || vis[c]) continue;
            let i1 = i, k1 = k, j1 = j;
            while (i1 + 1 < NI && L[c + i1 + 1 - i] >= 0 && !vis[c + i1 + 1 - i]) i1++;
            grow: while (k1 + 1 < NK) {
                for (let ii = i; ii <= i1; ii++) { const q = (j * NK + k1 + 1) * NI + ii; if (L[q] < 0 || vis[q]) break grow; }
                k1++;
            }
            up: while (j1 + 1 < NJ) {
                for (let kk = k; kk <= k1; kk++) for (let ii = i; ii <= i1; ii++) { const q = ((j1 + 1) * NK + kk) * NI + ii; if (L[q] < 0 || vis[q]) break up; }
                j1++;
            }
            for (let jj = j; jj <= j1; jj++) for (let kk = k; kk <= k1; kk++) for (let ii = i; ii <= i1; ii++) vis[(jj * NK + kk) * NI + ii] = 1;
            if ((nb + 1) * 6 > this._bx.length) { const nw = new Float32Array(this._bx.length * 2); nw.set(this._bx); this._bx = nw; }
            const B = this._bx, o = nb++ * 6;
            B[o] = (s.i0 + (i + i1 + 1) / 2) * b.cw - b.w / 2 - s.ox; B[o + 1] = (s.j0 + (j + j1 + 1) / 2) * b.ch - s.oy; B[o + 2] = (s.k0 + (k + k1 + 1) / 2) * b.cd - b.d / 2 - s.oz;
            B[o + 3] = (i1 - i + 1) * b.cw / 2 - 1.2; B[o + 4] = (j1 - j + 1) * b.ch / 2 - 0.6; B[o + 5] = (k1 - k + 1) * b.cd / 2 - 1.2;
        }
        return nb;
    },

    // Зоны коллайдеров по габариту секции.
    _secTouch(s) {
        const m = s.m, ex = Math.abs(m[0]) * s.hx + Math.abs(m[3]) * s.hy + Math.abs(m[6]) * s.hz, ey = Math.abs(m[1]) * s.hx + Math.abs(m[4]) * s.hy + Math.abs(m[7]) * s.hz, ez = Math.abs(m[2]) * s.hx + Math.abs(m[5]) * s.hy + Math.abs(m[8]) * s.hz;
        GameDebris.touchBox(s.px - ex - 90, s.py - ey - 90, s.pz - ez - 90, s.px + ex + 90, s.py + ey + 90, s.pz + ez + 90);
    },

    // Центр кирпича mi секции в мире -> out.
    _secCenter(s, mi, out) {
        const b = s.b, ci = s.ci[mi], i = ci % b.nx, k = Math.floor(ci / b.nx) % b.nz, j = Math.floor(ci / (b.nx * b.nz)), m = s.m;
        const lx = (i + 0.5) * b.cw - b.w / 2 - s.ox, ly = (j + 0.5) * b.ch - s.oy, lz = (k + 0.5) * b.cd - b.d / 2 - s.oz;
        out[0] = s.px + m[0] * lx + m[3] * ly + m[6] * lz; out[1] = s.py + m[1] * lx + m[4] * ly + m[7] * lz; out[2] = s.pz + m[2] * lx + m[5] * ly + m[8] * lz;
        return out;
    },

    // Кирпич секции выбывает: mode 2 — раскалывается, 1 — отлетает целым блоком, 0 — исчезает.
    _secKill(s, mi, mode, dir, power) {
        if (!s.alive[mi]) return;
        s.alive[mi] = 0; s.n--;
        const b = s.b, ci = s.ci[mi], i = ci % b.nx, k = Math.floor(ci / b.nx) % b.nz, j = Math.floor(ci / (b.nx * b.nz));
        s.lut[((j - s.j0) * s.nk + (k - s.k0)) * s.ni + (i - s.i0)] = -1;
        s.pos.fill(0, s.v0[mi] * 3, (s.v0[mi] + s.vn[mi]) * 3);
        s.dirty = true;
        if (!mode) return;
        const p = this._secCenter(s, mi, GameCity._W), V = s.v, W = s.w, rx = p[0] - s.px, ry = p[1] - s.py, rz = p[2] - s.pz;
        const vx = V[0] + W[1] * rz - W[2] * ry, vy = V[1] + W[2] * rx - W[0] * rz, vz = V[2] + W[0] * ry - W[1] * rx;
        if (mode === 2) {
            const lod = this._lod();
            this._fragments(b, ci, p[0], p[1], p[2], s.qx, s.qy, s.qz, s.qw, dir, power, lod, vx * 0.7, vy * 0.7, vz * 0.7);
            if (this._fxT <= 0) { FX('brickBreak', p[0], p[1], p[2], Math.max(b.cw, b.ch), b.plan.tintOf(ci)); this._fxT = 0.03; }
        } else {
            const r = Math.random;
            this._block(b, ci, p[0], p[1], p[2], s.qx, s.qy, s.qz, s.qw, vx * 0.8 + (r() - 0.5) * power * 0.5, vy * 0.8 + r() * power * 0.3, vz * 0.8 + (r() - 0.5) * power * 0.5, W[0] + (r() - 0.5) * 2, W[1] + (r() - 0.5) * 2, W[2] + (r() - 0.5) * 2, false);
        }
    },

    // Секция изменилась: отколовшиеся части — своими телами, меш и коллайдеры — заново.
    _secRefresh(s) {
        if (s.dead) return;
        if (s.n <= 0) { this._secRemove(s); return; }
        if (s.n === 1) { this._dissolve(s, false); return; }
        this._secSplit(s);
        if (s.dead) return;
        if (s.n <= 1) { this._dissolve(s, false); return; }
        if (s.dirty) { s.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, s.pos, false, false); s.dirty = false; }
        const nb = this._boxes(s), b = s.b;
        s.mass = s.n * b.cw * b.ch * b.cd;
        GamePhysics.setBoxes(s.body, this._bx, nb, this._secO);
    },

    // Связные части секции: самая большая остаётся, остальные — новые секции (или блоки, если малы).
    _secSplit(s) {
        const L = s.lut, NI = s.ni, NJ = s.nj, NK = s.nk, size = NI * NJ * NK, vis = this._vis, stk = this._stk;
        vis.fill(0, 0, size);
        /** @type {number[]} */ const counts = [];
        for (let c0 = 0; c0 < size; c0++) {
            if (L[c0] < 0 || vis[c0]) continue;
            if (counts.length >= 250) break;
            const label = counts.length + 1;
            let sp = 0, cnt = 0;
            stk[sp++] = c0; vis[c0] = label;
            while (sp > 0) {
                const q = stk[--sp], i = q % NI, k = Math.floor(q / NI) % NK, j = Math.floor(q / (NI * NK));
                cnt++;
                if (i > 0 && L[q - 1] >= 0 && !vis[q - 1]) { vis[q - 1] = label; stk[sp++] = q - 1; }
                if (i < NI - 1 && L[q + 1] >= 0 && !vis[q + 1]) { vis[q + 1] = label; stk[sp++] = q + 1; }
                if (k > 0 && L[q - NI] >= 0 && !vis[q - NI]) { vis[q - NI] = label; stk[sp++] = q - NI; }
                if (k < NK - 1 && L[q + NI] >= 0 && !vis[q + NI]) { vis[q + NI] = label; stk[sp++] = q + NI; }
                if (j > 0 && L[q - NI * NK] >= 0 && !vis[q - NI * NK]) { vis[q - NI * NK] = label; stk[sp++] = q - NI * NK; }
                if (j < NJ - 1 && L[q + NI * NK] >= 0 && !vis[q + NI * NK]) { vis[q + NI * NK] = label; stk[sp++] = q + NI * NK; }
            }
            counts.push(cnt);
        }
        if (counts.length <= 1) return;
        let best = 0;
        for (let q = 1; q < counts.length; q++) if (counts[q] > counts[best]) best = q;
        // метки частей понадобятся после новых заливок (vis общий) — копия
        const labels = vis.slice(0, size), b = s.b, V = s.v, W = s.w;
        for (let q = 0; q < counts.length; q++) {
            if (q === best) continue;
            const cnt = counts[q], cis = new Int32Array(cnt), hps = new Float32Array(cnt), ks = new Uint8Array(cnt).fill(255);
            let m = 0;
            for (let c = 0; c < size; c++) {
                if (labels[c] !== q + 1) continue;
                const mi = L[c];
                cis[m] = s.ci[mi]; hps[m] = s.hp[mi]; m++;
                if (cnt <= 2 || this.secLive >= this.secMax()) this._secKill(s, mi, 1, null, 60); else this._secKill(s, mi, 0, null, 0);
            }
            if (cnt > 2 && this.secLive < this.secMax() + 6) this._newSection(b, cis, hps, ks, cnt, s.px, s.py, s.pz, s.ox, s.oy, s.oz, s.qx, s.qy, s.qz, s.qw, V[0], V[1], V[2], W[0], W[1], W[2]);
        }
    },

    // Секция рассыпается на блоки-кирпичи (still — уже лежит: блоки сразу лежащие, без тел).
    _dissolve(s, still) {
        if (s.dead) return;
        const b = s.b, p = GameCity._W, V = s.v, W = s.w, r = Math.random;
        for (let mi = 0; mi < s.N; mi++) {
            if (!s.alive[mi]) continue;
            this._secCenter(s, mi, p);
            if (still) { this._block(b, s.ci[mi], p[0], p[1], p[2], s.qx, s.qy, s.qz, s.qw, 0, 0, 0, 0, 0, 0, true); continue; }
            const rx = p[0] - s.px, ry = p[1] - s.py, rz = p[2] - s.pz;
            this._block(b, s.ci[mi], p[0], p[1], p[2], s.qx, s.qy, s.qz, s.qw, V[0] + W[1] * rz - W[2] * ry + (r() - 0.5) * 30, V[1] + W[2] * rx - W[0] * rz, V[2] + W[0] * ry - W[1] * rx + (r() - 0.5) * 30, W[0], W[1], W[2], false);
        }
        if (!still && this._dustN++ < 6) FX('dustCloud', s.px, s.py, s.pz, s.R * 1.2, b.tint);
        this._secRemove(s);
    },

    _secRemove(s) {
        if (s.dead) return;
        s.dead = true;
        if (s.body >= 0) GamePhysics.remove(s.body);
        try { World3D.removeObject(this.view, s.mesh); } catch (e) { /* сцена убрана */ }
        this.sections[s.id] = null;
        this.secFree.push(s.id);
        this.secLive--;
    },

    // Кирпичи падающих секций в шаре урона.
    _hitSections(x, y, z, radius, dmg, dir, power) {
        let broke = 0;
        const r2 = radius * radius;
        for (let n = 0; n < this.sections.length; n++) {
            const s = this.sections[n];
            if (!s || s.dead) continue;
            const dx = x - s.px, dy = y - s.py, dz = z - s.pz, R = s.R + radius;
            if (dx * dx + dy * dy + dz * dz > R * R) continue;
            const m = s.m, b = s.b;
            // центр шара в сетке здания (оси секции)
            const gx = dx * m[0] + dy * m[1] + dz * m[2] + s.ox + b.w / 2, gy = dx * m[3] + dy * m[4] + dz * m[5] + s.oy, gz = dx * m[6] + dy * m[7] + dz * m[8] + s.oz + b.d / 2;
            const i0 = Math.max(s.i0, Math.floor((gx - radius) / b.cw)), i1 = Math.min(s.i0 + s.ni - 1, Math.floor((gx + radius) / b.cw));
            const j0 = Math.max(s.j0, Math.floor((gy - radius) / b.ch)), j1 = Math.min(s.j0 + s.nj - 1, Math.floor((gy + radius) / b.ch));
            const k0 = Math.max(s.k0, Math.floor((gz - radius) / b.cd)), k1 = Math.min(s.k0 + s.nk - 1, Math.floor((gz + radius) / b.cd));
            let hit = false;
            for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
                const mi = s.lut[((j - s.j0) * s.nk + (k - s.k0)) * s.ni + (i - s.i0)];
                if (mi < 0) continue;
                const cx0 = i * b.cw, cy0 = j * b.ch, cz0 = k * b.cd;
                const ox = gx - Math.max(cx0, Math.min(cx0 + b.cw, gx)), oy = gy - Math.max(cy0, Math.min(cy0 + b.ch, gy)), oz = gz - Math.max(cz0, Math.min(cz0 + b.cd, gz));
                const d2 = ox * ox + oy * oy + oz * oz;
                if (d2 > r2) continue;
                s.hp[mi] -= dmg * (1 - 0.55 * Math.sqrt(d2) / radius);
                if (s.hp[mi] <= 0) { this._secKill(s, mi, 2, dir, power); broke++; hit = true; }
            }
            if (hit) this._secRefresh(s);
        }
        return broke;
    },

    // Удар тела по чему-то (GameDebris.onBodyHit): секция копит удары кадра, пропс-тело крушит кирпичи.
    _bodyHit(id, kind, ref, oid, oh, force) {
        const G = GamePhysics;
        if (kind === G.K_SECTION) {
            const s = this.sections[ref];
            if (!s || s.dead) return;
            const dv = force / Math.max(1, s.mass) * G.STEP;
            if (dv < 90) return;
            if (dv > s.hitDv) s.hitDv = dv;
            if (oid < 0 && oh === G.groundHandle) s.hitGround = true;
            else if (s.hitN < 12) {
                let brick = -1, ok = false;
                const o = s.hitN * 3, C = s.hitC;
                if (oid < 0) {
                    const bid = this.colBrick.get(oh);
                    if (bid !== undefined) { brick = bid; const p = this._center(this.buildings[this.bBld[bid]], this.bCell[bid], GameCity._tmp); C[o] = p[0]; C[o + 1] = p[1]; C[o + 2] = p[2]; ok = true; }
                } else if (G.read(oid, this._T)) { C[o] = this._T[0]; C[o + 1] = this._T[1]; C[o + 2] = this._T[2]; ok = true; }
                if (ok) { s.hitB[s.hitN] = brick; s.hitN++; } else s.hitOther = true;
            }
            if (!s.hitQ) { s.hitQ = true; this._hitList.push(s); }
            return;
        }
        const d = this.dyn[ref];
        if (!d || d.body < 0) return;
        const dv = force / Math.max(1, d.mass) * G.STEP;
        if (dv < 80) return;
        const ground = oid < 0 && oh === G.groundHandle;
        let brick = false;
        if (oid < 0 && !ground) {
            const bid = this.colBrick.get(oh);
            if (bid !== undefined && this.bState[bid] === 1) {
                const bb = this.buildings[this.bBld[bid]], p = this._center(bb, this.bCell[bid], GameCity._tmp), heavy = Math.min(3, Math.cbrt(d.mass) / 70);
                this._breakBudget += 2;
                this._hitBricks(p[0], p[1], p[2], Math.max(bb.cw, bb.cd) * 0.7, bb.hpBrick * Math.min(2.4, (dv / 200) * (dv / 200) * (0.16 + heavy * 0.5)), null, 150);
                brick = true;
            }
        }
        if (d.p.phys === 'land' && !d.landed && dv > 110 && (ground || brick)) {
            d.landed = true;
            const size = Math.max(d.hx, d.hy, d.hz);
            FX('dustCloud', d.px, this.base + 10, d.pz, size * 1.6, 0xcfc4b0);
            FX('dustLand', d.px, this.base, d.pz, size * 1.5);
            FX('shake', 0.6, 500);
            this.scar(d.px, d.pz, size * 0.8, 'crack', 0.9);
            SFX('explosion_m', { volume: 0.9, rate: 0.7 });
            if (this.hooks.blast) this.hooks.blast(d.px, this.base, d.pz, size, 0);
        } else if (dv > 150 && this._dustN++ < 6) FX('impactPuff', d.px, d.py - d.hy * 0.5, d.pz, Math.max(d.hx, d.hz) * 1.5, d.p.info.colors[0]);
    },

    // Секция ударилась: кирпичи зданий под ударом получают урон, свои кирпичи у места удара колются и отлетают.
    _fracture(s) {
        const dv = s.hitDv, ground = s.hitGround, other = s.hitOther, hn = s.hitN;
        s.hitQ = false; s.hitDv = 0; s.hitGround = false; s.hitOther = false; s.hitN = 0;
        if (s.dead || s.cool > 0 || dv < 90) return;
        s.cool = 0.09;
        const b = s.b, cell = Math.max(b.cw, b.cd), heavy = Math.min(3, Math.sqrt(s.n / 6)), C = s.hitC, p = GameCity._W;
        // 1) то, во что врезалась: кирпичи зданий («домино»)
        for (let q = 0; q < hn; q++) {
            const id = s.hitB[q];
            if (id < 0 || this.bState[id] !== 1) continue;
            const bb = this.buildings[this.bBld[id]];
            this._breakBudget += 2;
            this._hitBricks(C[q * 3], C[q * 3 + 1], C[q * 3 + 2], Math.max(bb.cw, bb.cd) * 0.7, bb.hpBrick * Math.min(2.4, (dv / 200) * (dv / 200) * (0.2 + heavy * 0.5)), null, 150);
        }
        // 2) свои кирпичи у места удара
        const R = cell * (0.7 + Math.min(1.6, dv / 300)), R2 = R * R, maxKills = Math.max(2, Math.round(s.n * Math.min(1, 0.2 + dv / 600)));
        let kills = 0, sx = 0, sy = 0, sz = 0, low = -1, lowY = 1e9;
        for (let mi = 0; mi < s.N && kills < maxKills; mi++) {
            if (!s.alive[mi]) continue;
            this._secCenter(s, mi, p);
            if (p[1] < lowY) { lowY = p[1]; low = mi; }
            let near = ground && p[1] - b.ch * 0.8 < this.base + 8;
            for (let q = 0; q < hn && !near; q++) { const dx = p[0] - C[q * 3], dy = p[1] - C[q * 3 + 1], dz = p[2] - C[q * 3 + 2]; near = dx * dx + dy * dy + dz * dz < R2; }
            if (!near) continue;
            sx += p[0]; sy += p[1]; sz += p[2]; kills++;
            this._secKill(s, mi, dv > 240 || Math.random() < 0.6 ? 2 : 1, null, Math.min(240, 60 + dv * 0.4));
        }
        if (!kills && (other || ground || hn) && low >= 0 && s.alive[low]) {          // удар о завал или другое тело: откалывается нижний кирпич
            this._secCenter(s, low, p); sx = p[0]; sy = p[1]; sz = p[2]; kills = 1;
            this._secKill(s, low, 2, null, Math.min(240, 60 + dv * 0.4));
        }
        if (kills) {
            const x = sx / kills, y = sy / kills, z = sz / kills;
            if (this._dustN++ < 6) { FX('dustCloud', x, y, z, cell * (1 + Math.sqrt(kills) * 0.6), b.tint); if (ground) FX('dustLand', x, this.base, z, cell * (0.8 + Math.sqrt(kills) * 0.4)); }
            if (this._sfxT <= 0) { SFX(kills > 5 ? 'collapse' : 'smash', { volume: Math.min(1, 0.4 + kills * 0.05) }); this._sfxT = 0.1; }
            if (kills > 4) FX('shake', Math.min(0.45, 0.08 + kills * 0.015), 220);
            if (ground && kills > 3) this.scar(x, z, cell * (0.6 + Math.sqrt(kills) * 0.3), 'crack', 0.7);
        }
        if (s.dead) return;
        if (dv > 520 || s.n <= 2) this._dissolve(s, false); else this._secRefresh(s);
    },

    // ---------------------------------------------------------------------------------------------
    // Пропсы
    // ---------------------------------------------------------------------------------------------

    /** Урон пропсу; true — уничтожен. fromX/fromZ — откуда удар (куда падать). */
    damageProp(p, dmg, fromX, fromZ) {
        if (p.dead) return false;
        p.hp -= dmg;
        if (p.hp > 0) return false;
        p.dead = true;
        const info = p.info, col = info.colors;
        let dx = p.x - fromX, dz = p.z - fromZ;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        const body = (p.phys === 'land' || p.phys === 'pole' || p.phys === 'rigid') && this._propBody(p, dx, dz);
        if (body) {
            // сам пропс остаётся в мире телом: валится, катится, лежит
            if (p.phys === 'land') { SFX('collapse', { volume: 0.8, rate: 1.2 }); FX('shake', 0.3, 300); }
            else SFX(p.h > 100 ? 'smash' : 'brick_break', { volume: 0.45 });
            if (info.leaf) FX('propBreak', p.x, p.y, p.z, p.r, p.h, info.leaf, 0, 0);
            if (info.spark) FX('sparks', p.x, p.y + p.h * 0.85, p.z, 12, 0xfff0a0);
            if (info.water) FX('waterJet', p.x, p.y, p.z, 5, Math.max(60, p.h * 0.9));
        } else {
            this._hideProp(p);
            this._propParts(p, dx, dz);
            FX('propBreak', p.x, p.y, p.z, p.r, p.h, info.leaf || col[0], info.spark ? 1 : 0, info.water ? 1 : 0);
            if (info.water) FX('waterJet', p.x, p.y, p.z, p.id === 'hydrant' ? 7 : 4, Math.max(70, p.h * 1.5));
            if (info.spark) FX('sparks', p.x, p.y + p.h * 0.6, p.z, 10, 0xfff0a0);
            if (info.mode === 'explode') this.explode(p.x, p.y + p.h * 0.5, p.z, info.blast || 300, 70);
            else SFX(p.h > 100 ? 'smash' : 'brick_break', { volume: 0.5 });
        }
        if (this.hooks.score) this.hooks.score(info.score, p.x, p.y + p.h * 0.5, p.z, 'prop');
        return true;
    },

    _hideProp(p) {
        const rec = p.rec;
        try {
            if (rec.batch) this.loc.setInstanceHidden(rec, true);
            else if (rec.mesh) rec.mesh.setEnabled(false);
        } catch (e) { /* объект уже снят */ }
    },

    // Пропс разваливается на части: щиты, брусья и куски цветов модели (ларёк, остановка, корабль — вдоль корпуса).
    _propParts(p, dx, dz) {
        const r = Math.random, info = p.info, col = info.colors, D = GameDebris;
        const n0 = info.mode === 'explode' ? 7 : p.h > 150 ? 12 : p.h > 40 ? 7 : p.r > 14 ? 6 : 3;
        const n = Math.max(2, Math.round(n0 * (0.4 + 0.6 * D.room()))), L = info.long || 0, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        const power = 150 + Math.min(p.h, 300) * 0.4, top = Math.min(p.h, 260), sz0 = Math.max(4, Math.min(p.r, 70));
        for (let i = 0; i < n; i++) {
            const t = L && n > 1 ? (i / (n - 1) - 0.5) * 2 : 0;
            const ox = L ? c * L * t : (r() - 0.5) * p.r * 1.2, oz = L ? s * L * t : (r() - 0.5) * p.r * 1.2;
            const shape = i % 3, sz = sz0 * (0.3 + r() * 0.4);
            let hx = sz, hy = sz * 0.6, hz = sz * 0.8;
            if (shape === 0) { hx = sz * 1.25; hy = Math.max(1.4, sz * 0.12); }                                   // щит, тент, панель
            else if (shape === 1) { hx = sz * 1.6; hy = Math.max(1.4, sz * 0.15); hz = Math.max(1.4, sz * 0.15); }   // брус, труба
            const a = r() * 3.14, fl = (Math.max(hx, hy, hz) < 9 ? 4 : 0) | (sz > 32 ? 1 : 0);
            D.spawnQ(p.x + ox, p.y + Math.max(hy + 2, (0.15 + 0.8 * r()) * top), p.z + oz, hx, hy, hz,
                dx * power * (0.3 + r() * 0.6) + (r() - 0.5) * power * 0.7, power * (0.3 + r() * 0.5), dz * power * (0.3 + r() * 0.6) + (r() - 0.5) * power * 0.7,
                (r() - 0.5) * 7, (r() - 0.5) * 7, (r() - 0.5) * 7, 0, Math.sin(a), 0, Math.cos(a), col[i % col.length], fl, -1, -1, 2, false);
        }
    },

    // Пропс становится телом: коробка по габариту модели, толчок от удара. true — получилось.
    _propBody(p, dx, dz) {
        const G = GamePhysics, rec = p.rec, def = rec.def;
        if (!G.world) return false;
        if (p.phys !== 'land' && this.dynAwake >= (KR.quality() === 'low' ? 24 : 70)) return false;
        const batch = rec.batch && rec.batch.parts ? rec.batch : null;
        if (!batch && !rec.mesh) return false;
        const R = Math.PI / 180, rot = Array.isArray(def.rot) ? def.rot : [0, def.rot || 0, 0], sc = Array.isArray(def.scale) ? def.scale : [def.scale, def.scale, def.scale];
        const sx = sc[0] > 0 ? sc[0] : 1, sy = sc[1] > 0 ? sc[1] : 1, sz = sc[2] > 0 ? sc[2] : 1;
        const q0 = BABYLON.Quaternion.RotationYawPitchRoll(-(Number(rot[1]) || 0) * R, (Number(rot[0]) || 0) * R, (Number(rot[2]) || 0) * R);
        // коробка тела в осях модели: полуразмеры и смещение центра от начала модели
        let hx = Math.max(2, p.r * 0.75), hy = Math.max(2, p.h / 2), hz = hx, ox = 0, oy = p.h / 2, oz = 0;
        if (p.phys === 'pole') hx = hz = Math.max(2.5, p.r * 0.45);
        else {
            /** @type {number[] | null} */ let mn = null, /** @type {number[] | null} */ mx = null;
            if (batch && batch.min && batch.max && Number.isFinite(batch.min[0])) { mn = [batch.min[0] * sx, batch.min[1] * sy, batch.min[2] * sz]; mx = [batch.max[0] * sx, batch.max[1] * sy, batch.max[2] * sz]; }
            else if (rec.mesh) {
                try {                                   // габарит модели без её поворота
                    const m = rec.mesh, r0 = m.rotation.clone(), rq = m.rotationQuaternion;
                    m.rotationQuaternion = null; m.rotation.set(0, 0, 0); m.computeWorldMatrix(true);
                    const bb = m.getHierarchyBoundingVectors(true);
                    mn = [bb.min.x - m.position.x, bb.min.y - m.position.y, bb.min.z - m.position.z]; mx = [bb.max.x - m.position.x, bb.max.y - m.position.y, bb.max.z - m.position.z];
                    m.rotation.copyFrom(r0); m.rotationQuaternion = rq; m.computeWorldMatrix(true);
                } catch (e) { mn = mx = null; }
            }
            if (mn && mx && mx[1] - mn[1] > 1) {
                hx = Math.max(2, (mx[0] - mn[0]) / 2 * 0.9); hy = Math.max(2, (mx[1] - mn[1]) / 2 * 0.97); hz = Math.max(2, (mx[2] - mn[2]) / 2 * 0.9);
                ox = (mx[0] + mn[0]) / 2; oy = (mx[1] + mn[1]) / 2; oz = (mx[2] + mn[2]) / 2;
            }
        }
        const a = this._axes(q0.x, q0.y, q0.z, q0.w, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const gx = Number(def.x) || 0, gy = rec.mesh && !batch ? rec.mesh.position.y : p.y, gz = Number(def.y) || 0;
        const cx = gx + a[0] * ox + a[3] * oy + a[6] * oz, cy = gy + a[1] * ox + a[4] * oy + a[7] * oz + 1, cz = gz + a[2] * ox + a[5] * oy + a[8] * oz;
        const r = Math.random, land = p.phys === 'land', big = hx * hy * hz * 8 > 30000;
        let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
        if (p.phys === 'rigid') {
            const pw = 130 + r() * 120;
            vx = dx * pw; vz = dz * pw; vy = 80 + r() * 90; wx = (r() - 0.5) * 6; wy = (r() - 0.5) * 4; wz = (r() - 0.5) * 6;
        } else {
            // опрокидывание: вращение к (dx, dz) с запасом энергии на переваливание через ребро основания
            const e = Math.max(hx, hz) * 0.9, dh = Math.sqrt(e * e + hy * hy) - hy;
            const w0 = Math.max(land ? 0.5 : 0.9, Math.sqrt(2 * KR.GRAVITY * dh * 1.7 / ((4 * e * e + 4 * hy * hy) / 3)));
            wx = dz * w0; wz = -dx * w0;
            vx = dx * w0 * hy * 0.7; vz = dz * w0 * hy * 0.7; vy = land ? 0 : 20;
        }
        const index = this.dyn.length, density = land ? 0.6 : 1;
        const body = G.add('box', cx, cy, cz, hx, hy, hz, { q: [q0.x, q0.y, q0.z, q0.w], vx, vy, vz, wx, wy, wz, density, friction: 0.75, restitution: 0.05, linDamp: 0.04, angDamp: land ? 0.1 : 0.3, member: G.G_PROP, filter: G.G_ALL, kind: G.K_PROP, ref: index, hitAcc: big ? 3600 : 0 });
        if (body < 0) return false;
        const d = {
            index, p, body, batch, /** @type {any} */ set: null, slot: -1, mesh: batch ? null : rec.mesh, hx, hy, hz, ox, oy, oz, sx, sy, sz,
            px: cx, py: cy, pz: cz, qx: q0.x, qy: q0.y, qz: q0.z, qw: q0.w, rest: 0, age: 0, fixed: -1, big, landed: false, mass: 8 * hx * hy * hz * density, density,
        };
        if (batch) {
            try { this.loc.setInstanceHidden(rec, true); } catch (e) { /* */ }
            d.set = this._dynSet(batch);
            d.slot = this._dynSlot(d.set);
        } else d.mesh.rotationQuaternion = q0.clone();
        this.dyn.push(d);
        p.dyn = index;
        this.dynAwake++;
        this._dynPose(d);
        return true;
    },

    // Меши для пропсов-тел из пачки декора: копии частей модели с thin instances (у пачки свой буфер — инстанс там спрятан).
    _dynSet(batch) {
        let set = this.dynSets.get(batch.key);
        if (set) return set;
        const scene = this.view.scene, cap = 8;
        set = { parts: /** @type {any[]} */ ([]), n: 0, cap, dirty: false };
        for (const part of batch.parts) {
            if (!part.mesh || !part.mesh.geometry) continue;
            const mesh = new BABYLON.Mesh(part.mesh.name + '/dyn', scene);
            part.mesh.geometry.copy(part.mesh.geometry.id + '/dyn').applyToMesh(mesh);
            mesh.material = part.mesh.material;
            mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
            const buf = new Float32Array(cap * 16);
            mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
            mesh.thinInstanceCount = 0;
            mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(0, -200, 0), new BABYLON.Vector3(this.mapW, 3000, this.mapH)));
            World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false });
            this.meshes.push(mesh);
            set.parts.push({ mesh, local: Float32Array.from(part.local.m), buf });
        }
        this.dynSets.set(batch.key, set);
        return set;
    },

    _dynSlot(set) {
        if (set.n >= set.cap) {
            set.cap *= 2;
            for (const part of set.parts) {
                const nb = new Float32Array(set.cap * 16);
                nb.set(part.buf);
                part.buf = nb;
                part.mesh.thinInstanceSetBuffer('matrix', nb, 16, false);
            }
        }
        set.dirty = true;
        return set.n++;
    },

    // Положение тела -> вид пропса (матрицы инстансов частей или меш).
    _dynPose(d) {
        const a = this._axes(d.qx, d.qy, d.qz, d.qw, GameCity._F.a);
        const gx = d.px - (a[0] * d.ox + a[3] * d.oy + a[6] * d.oz), gy = d.py - (a[1] * d.ox + a[4] * d.oy + a[7] * d.oz), gz = d.pz - (a[2] * d.ox + a[5] * d.oy + a[8] * d.oz);
        if (!d.set) {
            if (d.mesh && !d.mesh.isDisposed()) { d.mesh.position.set(gx, gy, gz); d.mesh.rotationQuaternion.set(d.qx, d.qy, d.qz, d.qw); }
            return;
        }
        // мир = масштаб × поворот × перенос; инстанс = матрица части × мир
        const m00 = a[0] * d.sx, m01 = a[1] * d.sx, m02 = a[2] * d.sx, m10 = a[3] * d.sy, m11 = a[4] * d.sy, m12 = a[5] * d.sy, m20 = a[6] * d.sz, m21 = a[7] * d.sz, m22 = a[8] * d.sz;
        for (const part of d.set.parts) {
            const L = part.local, B = part.buf, o = d.slot * 16;
            for (let r = 0; r < 4; r++) {
                const l0 = L[r * 4], l1 = L[r * 4 + 1], l2 = L[r * 4 + 2], l3 = L[r * 4 + 3];
                B[o + r * 4] = l0 * m00 + l1 * m10 + l2 * m20 + l3 * gx;
                B[o + r * 4 + 1] = l0 * m01 + l1 * m11 + l2 * m21 + l3 * gy;
                B[o + r * 4 + 2] = l0 * m02 + l1 * m12 + l2 * m22 + l3 * gz;
                B[o + r * 4 + 3] = l3;
            }
        }
        d.set.dirty = true;
    },

    // Пропсы-тела после шага физики: вид, зоны, покой (тело убирается, пропс остаётся лежать).
    _syncProps(dt) {
        const G = GamePhysics, T = this._T;
        for (let n = 0; n < this.dyn.length; n++) {
            const d = this.dyn[n];
            if (d.body < 0) continue;
            if (!G.read(d.body, T)) { d.body = -1; this.dynAwake--; continue; }
            const dx = T[0] - d.px, dy = T[1] - d.py, dz = T[2] - d.pz, ex = T[3] - d.qx, ey = T[4] - d.qy, ez = T[5] - d.qz, ew = T[6] - d.qw;
            const calm = dx * dx + dy * dy + dz * dz < 196 * dt * dt && ex * ex + ey * ey + ez * ez + ew * ew < 0.06 * dt * dt;
            d.rest = calm ? d.rest + dt : 0;
            d.age += dt;
            d.px = T[0]; d.py = T[1]; d.pz = T[2]; d.qx = T[3]; d.qy = T[4]; d.qz = T[5]; d.qw = T[6];
            this._dynPose(d);
            GameDebris.touch(d.px, d.py, d.pz, Math.max(d.hx, d.hy, d.hz));
            if (d.rest > 0.6 || (d.age > 0.5 && G.asleep(d.body)) || d.py < this.base - 300) {
                G.remove(d.body);
                d.body = -1; this.dynAwake--;
                if (d.big) d.fixed = G.addFixedQ(d.px, d.py, d.pz, d.hx, d.hy, d.hz, d.qx, d.qy, d.qz, d.qw);
            }
        }
        for (const set of this.dynSets.values()) {
            if (!set.dirty) continue;
            set.dirty = false;
            for (const part of set.parts) { part.mesh.thinInstanceCount = set.n; part.mesh.thinInstanceBufferUpdated('matrix'); }
        }
    },

    // Лежащий пропс снова становится телом.
    _wakeProp(d) {
        if (d.body >= 0) return true;
        const G = GamePhysics;
        if (!G.world || this.dynAwake >= 90) return false;
        if (d.fixed >= 0) { G.removeFixed(d.fixed); d.fixed = -1; }
        d.body = G.add('box', d.px, d.py, d.pz, d.hx, d.hy, d.hz, { q: [d.qx, d.qy, d.qz, d.qw], density: d.density, friction: 0.75, restitution: 0.05, linDamp: 0.04, angDamp: 0.3, member: G.G_PROP, filter: G.G_ALL, kind: G.K_PROP, ref: d.index, hitAcc: d.big ? 3600 : 0 });
        if (d.body < 0) return false;
        d.rest = 0; d.age = 0;
        this.dynAwake++;
        return true;
    },

    // Удар по лежащим и летящим пропсам-телам: dir — направление или null (от центра).
    _shoveProps(x, y, z, radius, dir, power) {
        const G = GamePhysics, r = Math.random;
        for (let n = 0; n < this.dyn.length; n++) {
            const d = this.dyn[n], size = Math.max(d.hx, d.hy, d.hz), dx = d.px - x, dy = d.py - y, dz = d.pz - z, R = radius + size * 0.6;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R * R || !this._wakeProp(d)) continue;
            const l = Math.sqrt(d2) || 1, f = power * (0.45 + 0.55 * Math.max(0, 1 - l / R)) / (1 + size * 0.012);
            if (dir) G.push(d.body, dir.x * f + dx / l * f * 0.3, dir.y * f + f * 0.25, dir.z * f + dz / l * f * 0.3);
            else G.push(d.body, dx / l * f, (dy / l * 0.5 + 0.6) * f, dz / l * f);
            G.spin(d.body, (r() - 0.5) * 3, (r() - 0.5) * 2, (r() - 0.5) * 3);
            d.rest = 0;
        }
    },

    // Импульс GameDebris (взрыв, шаг кайдзю) — секциям и пропсам-телам.
    _impulse(x, y, z, radius, power, up) {
        const G = GamePhysics, r2 = radius * radius;
        for (let n = 0; n < this.sections.length; n++) {
            const s = this.sections[n];
            if (!s || s.dead) continue;
            const dx = s.px - x, dy = s.py - y, dz = s.pz - z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1, f = power * (1 - d / radius) / (1 + s.R * 0.02);
            G.push(s.body, dx / d * f, (dy / d * 0.5 + up) * f, dz / d * f);
        }
        if (this.dyn.length) this._shoveProps(x, y, z, radius, null, power);
    },

    /** Взрыв: урон зданиям, пропсам (цепная реакция), волна всем телам физики; технику и кайдзю бьёт игра (hooks.blast). */
    explode(x, y, z, radius, dmg, own) {
        const size = radius < 200 ? 1 : radius < 380 ? 2 : radius < 560 ? 3 : 4;
        FX('explosion', x, y, z, size);
        SFX(size >= 3 ? 'explosion_l' : size === 2 ? 'explosion_m' : 'explosion_s', { volume: 1 });
        this._breakBudget += 30;
        // Цепная реакция — на следующем кадре, чтобы взрывы шли волной, а не одним стеком вызовов.
        this.blasts.push({ x, y, z, radius, dmg, t: 0.08 });
        GameDebris.wakeSphere(x, y, z, radius, 90);
        for (let n = 0; n < this.dyn.length; n++) { const d = this.dyn[n]; if (d.body < 0 && Math.hypot(d.px - x, d.py - y, d.pz - z) < radius) this._wakeProp(d); }
        GamePhysics.blast(x, y, z, radius * 1.3, 380 + radius * 0.5, 0.7);
        this.scar(x, z, radius * 0.7, 'scorch', 0.9);
        if (size >= 2) FX('smokeColumn', x, this.base, z, 5, radius * 0.5);
        if (this.hooks.blast) this.hooks.blast(x, y, z, radius, dmg, !!own);
    },
    /** @type {any[]} */ blasts: [],

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    /** До шага физики: шары кайдзю, отложенные взрывы, пожары, пересчёт опоры. */
    update(dt) {
        this._sfxT -= dt; this._fxT -= dt; this._dustN = 0;
        this._breakBudget = Math.min(60, this._breakBudget + dt * 90);
        // кайдзю для физики: кинематические шары по костям
        // @ts-ignore — GameKaiju объявляет js/GameKaiju.js
        const K = typeof GameKaiju !== 'undefined' ? GameKaiju : null;
        if (K && K.rig && GamePhysics.world) {
            const n = Math.min(24, K.bodySpheres(GameDebris.kS));
            GameDebris.kN = n;
            GamePhysics.kaiju(GameDebris.kS, n);
        }
        // отложенные взрывы
        for (let i = this.blasts.length - 1; i >= 0; i--) {
            const b = this.blasts[i];
            if ((b.t -= dt) > 0) continue;
            this.blasts.splice(i, 1);
            this.hitSphere(b.x, b.y, b.z, b.radius, b.dmg, null, 340);
        }
        // пожары
        for (let i = this.fires.length - 1; i >= 0; i--) {
            const f = this.fires[i];
            if ((f.t -= dt) <= 0) { this.fires.splice(i, 1); continue; }
            if ((f.tick -= dt) > 0) continue;
            f.tick = 0.33;
            for (let k = 0; k < 2; k++) {
                const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * f.r;
                this.hitSphere(f.x + Math.cos(a) * d, f.y + Math.random() * f.r * 1.3, f.z + Math.sin(a) * d, f.r * 0.42, f.dmg, null, 0);
            }
        }
        // опора: не больше нескольких зданий за кадр
        for (let n = 0; n < 6 && this._dirty.length; n++) this._solve(this._dirty.shift());
        this.flush();
        this.followCamera();
    },

    /** После шага физики (GameDebris.onSync): удары секций, положение секций и пропсов-тел, их покой. */
    afterPhysics(dt) {
        const G = GamePhysics, T = this._T;
        if (this._hitList.length) {
            for (let n = 0; n < this._hitList.length; n++) this._fracture(this._hitList[n]);
            this._hitList.length = 0;
        }
        for (let n = 0; n < this.sections.length; n++) {
            const s = this.sections[n];
            if (!s || s.dead) continue;
            if (!G.read(s.body, T)) { this._secRemove(s); continue; }
            const dx = T[0] - s.px, dy = T[1] - s.py, dz = T[2] - s.pz, ex = T[3] - s.qx, ey = T[4] - s.qy, ez = T[5] - s.qz, ew = T[6] - s.qw;
            const calm = dx * dx + dy * dy + dz * dz < 100 * dt * dt && ex * ex + ey * ey + ez * ez + ew * ew < 0.02 * dt * dt;
            s.rest = calm ? s.rest + dt : 0;
            s.age += dt; s.cool -= dt;
            s.px = T[0]; s.py = T[1]; s.pz = T[2]; s.qx = T[3]; s.qy = T[4]; s.qz = T[5]; s.qw = T[6];
            this._axes(s.qx, s.qy, s.qz, s.qw, s.m);
            s.mesh.position.set(s.px, s.py, s.pz);
            s.mesh.rotationQuaternion.set(s.qx, s.qy, s.qz, s.qw);
            G.vel(s.body, s.v); G.angvel(s.body, s.w);
            this._secTouch(s);
            if (s.py < this.base - 400) this._secRemove(s);
            else if (s.rest > 0.7 || (s.age > 0.6 && G.asleep(s.body))) this._dissolve(s, true);
        }
        if (this.dyn.length) this._syncProps(dt);
    },

    /** Отправить в видеокарту изменённые куски буферов (вершины и цвет) — раз в кадр. */
    flush() {
        for (const k in this.scars) {
            const S = this.scars[k];
            if (!S.dirty) continue;
            S.dirty = false;
            S.mesh.thinInstanceCount = Math.min(S.n, S.cap);
            S.mesh.thinInstanceBufferUpdated('matrix'); S.mesh.thinInstanceBufferUpdated('color');
        }
        if (this.rubbleDirty && this.rubble) { this.rubbleDirty = false; this.rubble.thinInstanceCount = this.rubbleCount; this.rubble.thinInstanceBufferUpdated('matrix'); this.rubble.thinInstanceBufferUpdated('color'); }
        for (const c of this.chunks) {
            if (c.p1 > c.p0) {
                this._upload(c, BABYLON.VertexBuffer.PositionKind, c.pos, c.p0, c.p1);
                c.p0 = Infinity; c.p1 = -1;
            }
            if (c.c1 > c.c0) {
                this._upload(c, BABYLON.VertexBuffer.ColorKind, c.col, c.c0, c.c1);
                c.c0 = Infinity; c.c1 = -1;
            }
        }
    },

    _upload(c, kind, data, a, b) {
        const geo = c.mesh.geometry;
        try {
            if (c.partial !== false && geo && geo.updateVerticesDataDirectly) { geo.updateVerticesDataDirectly(kind, data.subarray(a, b), a); return; }
        } catch (e) { c.partial = false; }
        c.mesh.updateVerticesData(kind, data, false, false);
    },

    /** Доля разрушенного города 0..1. */
    destroyed() { return this.brickCount ? this.deadCount / this.brickCount : 0; },
};
