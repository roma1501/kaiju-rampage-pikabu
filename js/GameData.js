// GameData.js — таблицы игры Kaiju Rampage Ultimate: уровни роста кайдзю, звёзды розыска, техника, реестр
// разрушаемых пропсов, карты. Только данные и мелкие чистые функции; логика — в остальных Game*.js.
// Масштаб: 1 px мира = 0.1 м (docs/GAME-CONTRACT.md).

// Эффекты и звук — отдельные модули (GameFX.js, GameAudio.js). Вызовы идут через эти две функции: модуля нет
// или в нём нет такого эффекта — игра идёт дальше без него.
function FX(name, ...args) {
    // @ts-ignore — GameFX объявляет js/GameFX.js
    const g = typeof GameFX !== 'undefined' ? GameFX : null;
    if (!g || typeof g[name] !== 'function') return null;
    try { return g[name](...args); } catch (e) { if (!FX._warned[name]) { FX._warned[name] = true; console.warn('GameFX.' + name + ':', e); } return null; }
}
/** @type {Record<string, boolean>} */
FX._warned = {};
function SFX(name, opts) {
    // @ts-ignore — GameAudio объявляет js/GameAudio.js
    const a = typeof GameAudio !== 'undefined' ? GameAudio : null;
    if (!a || typeof a.sfx !== 'function') return;
    try { a.sfx(name, opts); } catch (e) { /* без звука игра идёт */ }
}

/**
 * Текст по ключу Lang (LANG_STRINGS) с подстановками {имя}.
 * @param {string} key @param {Record<string, any>} [params] @returns {string}
 */
function T(key, params) { return Lang.t(key, params || null); }

// Babylon 9.26: у меша с цветами thin instances define INSTANCESCOLOR ставится, но никогда не снимается. Когда число
// экземпляров падает до 0 (все машины типа разбиты, все пропсы пачки снесены), INSTANCES уходит, а INSTANCESCOLOR
// остаётся — шейдер не собирается ('instanceColor' : undeclared identifier), меш навсегда «не готов», и загрузка
// следующей карты ждёт готовности сцены. Лечение: при переходе 0 <-> >0 сбросить defines подмешей — материал
// пересоберёт их начисто.
(function fixThinInstanceColorDefines() {
    if (typeof BABYLON === 'undefined' || !BABYLON.Mesh) return;
    const P = /** @type {any} */ (BABYLON.Mesh.prototype), d = Object.getOwnPropertyDescriptor(P, 'thinInstanceCount');
    if (!d || !d.get || !d.set || P.__krThinFix) return;
    P.__krThinFix = true;
    Object.defineProperty(P, 'thinInstanceCount', {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) {
            const was = d.get.call(this) || 0;
            d.set.call(this, v);
            if ((was > 0) === ((v || 0) > 0) || !this.subMeshes) return;
            let colored = false;
            try { colored = this.isVerticesDataPresent(BABYLON.VertexBuffer.ColorInstanceKind); } catch (e) { colored = false; }
            if (!colored) return;
            for (const sm of this.subMeshes) { try { sm.materialDefines = null; } catch (e) { /* старый Babylon */ } }
        },
    });
})();

/** @satisfies {Record<string, any>} */
const KR = {
    /** Уровень графики строкой: 'low' | 'medium' | 'high' (Quality.name; без Quality — высокий). */
    quality() { return typeof Quality !== 'undefined' && Quality.name ? String(Quality.name) : 'high'; },

    // --- Здания из кирпичей ---------------------------------------------------------------------
    BRICK_H: 70,            // px: высота кирпича-модуля (2 этажа)
    CELL: 88,               // px: желаемый размер клетки в плане (режется на 70..110)
    FACADE_U: 105,          // px мира на один повтор тайла фасада по горизонтали (3 окна)
    GRAVITY: 420,           // px/с²: обломки (в масштабе гиганта всё падает «тяжело» и чуть замедленно)

    // Ряды атласа фасадов (порядок = номер ряда): 16 фасадов, крыша, изнанка.
    FACADES: ['concrete', 'office', 'glass', 'darkglass', 'brick', 'panel', 'hotel', 'shop', 'industrial', 'warehouse',
        'neon', 'sandstone', 'casino', 'bunker', 'wood', 'ice', 'roof', 'inner'],
    // Оттенки стен (цвет умножает текстуру) и прочность кирпича по фасаду.
    FACADE_INFO: {
        concrete: { hp: 30, tints: [0xe6e6e2, 0xd2d6da, 0xc9c2b8, 0xdcd3c6] },
        office: { hp: 28, tints: [0xf0f2f4, 0xd8e2ea, 0xe8e0d4, 0xcfd6dc] },
        glass: { hp: 24, tints: [0xbfe4ff, 0xa9f0e6, 0xd6e6ff, 0x9fd0ff] },
        darkglass: { hp: 26, tints: [0x8fa6c4, 0x7a8fa8, 0x9a9ac0, 0x6f8894] },
        brick: { hp: 22, tints: [0xd98a6a, 0xc8745a, 0xe0a070, 0xb86a58, 0xd2b08c] },
        panel: { hp: 24, tints: [0xe8e2d0, 0xcfe0e6, 0xe6d0c0, 0xd8e6c8, 0xf0dca0] },
        hotel: { hp: 26, tints: [0xffe9c2, 0xffd9c8, 0xe9f0d0, 0xf6e0ff] },
        shop: { hp: 18, tints: [0xfff0d8, 0xd8f0ff, 0xffd8d8, 0xe0ffd8, 0xfff2a8] },
        industrial: { hp: 30, tints: [0xc8d0d8, 0xb4c4b4, 0xd8c8b4, 0xa8b8c8] },
        warehouse: { hp: 24, tints: [0xc47a5a, 0x6f95b8, 0xb8b0a0, 0x8aa07a] },
        neon: { hp: 26, tints: [0xb9a8ff, 0xff9fd6, 0x9fe8ff, 0xd0c8ff] },
        sandstone: { hp: 26, tints: [0xf2d6a0, 0xe8c48c, 0xf8e2b8, 0xdcb880] },
        casino: { hp: 28, tints: [0xffd76a, 0xff9fb8, 0xc8a0ff, 0xffe6a0] },
        bunker: { hp: 60, tints: [0x9aa58c, 0x8c9488, 0xa8a898, 0x7f8c7a] },
        wood: { hp: 16, tints: [0xfff4e6, 0xffe6d0, 0xf6ecd8] },
        ice: { hp: 26, tints: [0xf4fbff, 0xe0f0fa, 0xffe9d6] },
    },

    // --- Рост кайдзю: уровень 1..10 --------------------------------------------------------------
    // xp — очков разрушения до ЭТОГО уровня (накопительно); scale — к росту модели 300 px.
    LEVELS: [
        { xp: 0, scale: 1.00 }, { xp: 60, scale: 1.20 }, { xp: 190, scale: 1.44 }, { xp: 420, scale: 1.72 },
        { xp: 820, scale: 2.06 }, { xp: 1500, scale: 2.46 }, { xp: 2600, scale: 2.94 }, { xp: 4200, scale: 3.50 },
        { xp: 6500, scale: 4.16 }, { xp: 9500, scale: 4.90 },
    ],
    BASE_HEIGHT: 300,       // px: рост кайдзю 1-го уровня (модель 3.0 ед. Blender)
    BASE_HP: 100,
    HP_PER_LEVEL: 0.5,      // +50% базового HP за уровень
    LIFESTEAL: 0.22,        // HP за очко разрушения
    BASE_SPEED: 470,        // px/с на 1-м уровне; дальше × scale^0.8
    BASE_DAMAGE: 42,        // урон удара когтями на 1-м уровне; дальше × scale^1.25

    // --- Умения: открываются с уровнем кайдзю в раунде, прокачиваются в меню (монеты или реклама) -----
    // unlock — уровень кайдзю, cd — перезарядка в секундах, action — действие Input.
    // buy — цена покупки умения навсегда (монеты), buyAds — или столько просмотров рекламы. Уровнем кайдзю умения
    // не открываются: только покупка (когти и прыжок-удар — свои с начала). unlock — порядок в списке.
    SKILLS: {
        claws: { unlock: 1, cd: 0, icon: 'ic_claw', action: 'attack', buy: 0, buyAds: 0 },
        slam: { unlock: 1, cd: 4.5, icon: 'ic_slam', action: 'slam', buy: 0, buyAds: 0 },
        breath: { unlock: 2, cd: 0, icon: 'ic_breath', action: 'breath', buy: 500, buyAds: 2 },
        nova: { unlock: 3, cd: 12, icon: 'ic_nova', action: 'nova', buy: 1500, buyAds: 3 },
        meteor: { unlock: 5, cd: 16, icon: 'ic_meteor', action: 'meteor', buy: 4000, buyAds: 4 },
        nuke: { unlock: 7, cd: 60, icon: 'ic_nuke', action: 'nuke', buy: 9000, buyAds: 6 },
    },
    SKILL_MAX: 5,
    SKILL_COST: [0, 600, 1500, 3500, 8000],     // монет за следующий уровень умения (индекс — текущий уровень)
    SKILL_ADS: [0, 2, 3, 4, 5],                 // или столько просмотров рекламы
    /** Множители умения по уровню прокачки: урон, радиус, перезарядка. */
    skillMul(level) { const n = Math.max(0, (level || 1) - 1); return { dmg: 1 + 0.2 * n, rad: 1 + 0.07 * n, cd: 1 - 0.06 * n }; },

    // --- Розыск: 6 звёзд ----------------------------------------------------------------------
    // heat — накопленные очки разрушения и убитой техники; STARS[n] — порог n-й звезды.
    STARS: [0, 25, 160, 520, 1350, 3000, 6000],
    // Состав сил по звёздам: сколько единиц каждого типа держится на карте одновременно.
    WAVES: [
        {},
        { police_car: 3 },
        { police_car: 4, swat_van: 1, heli_police: 1 },
        { police_car: 2, swat_van: 2, jeep: 2, tank: 2, heli_police: 1 },
        { swat_van: 2, jeep: 3, tank: 4, heli_attack: 2, heli_police: 1 },
        { jeep: 3, tank: 5, mlrs: 2, heli_attack: 3, jet: 2 },
        { jeep: 2, tank: 6, mlrs: 3, maser: 2, heli_attack: 4, jet: 3, bomber: 1, mech: 1 },
    ],
    RESPAWN_SEC: [0, 5, 4.2, 3.6, 3, 2.5, 2],      // пауза между подкреплениями по звёздам

    // Техника. kind: ground | heli | jet. weapon: gun (очередь, мгновенно), shell (снаряд по дуге), rocket (ракеты),
    // laser (луч), bomb. dmg — урон кайдзю за попадание (луч — в секунду), rate — секунд между выстрелами.
    UNITS: {
        police_car: { model: 'police_car', kind: 'ground', hp: 12, speed: 340, range: 430, weapon: 'gun', dmg: 0.5, rate: 0.55, r: 26, h: 17, score: 5, coins: 3, siren: true },
        swat_van: { model: 'swat_van', kind: 'ground', hp: 32, speed: 290, range: 500, weapon: 'gun', dmg: 1.1, rate: 0.42, r: 32, h: 30, score: 8, coins: 5, siren: true },
        jeep: { model: 'jeep', kind: 'ground', hp: 24, speed: 370, range: 580, weapon: 'gun', dmg: 1.5, rate: 0.3, r: 26, h: 22, score: 10, coins: 6 },
        tank: { model: 'tank', kind: 'ground', hp: 95, speed: 175, range: 1150, weapon: 'shell', dmg: 9, rate: 2.8, r: 40, h: 28, score: 22, coins: 14 },
        mlrs: { model: 'mlrs', kind: 'ground', hp: 60, speed: 150, range: 2500, weapon: 'rocket', dmg: 4, rate: 7, salvo: 6, r: 42, h: 36, score: 30, coins: 18 },
        maser: { model: 'maser', kind: 'ground', hp: 130, speed: 140, range: 1400, weapon: 'laser', dmg: 8, rate: 5, burst: 2.4, r: 44, h: 50, score: 45, coins: 26 },
        heli_police: { model: 'heli_police', kind: 'heli', hp: 26, speed: 430, range: 620, weapon: 'gun', dmg: 1.2, rate: 0.36, r: 42, h: 30, score: 14, coins: 9 },
        heli_attack: { model: 'heli_attack', kind: 'heli', hp: 58, speed: 500, range: 900, weapon: 'rocket', dmg: 5, rate: 2.7, salvo: 2, r: 48, h: 32, score: 28, coins: 16 },
        jet: { model: 'jet', kind: 'jet', hp: 40, speed: 2100, range: 2200, weapon: 'rocket', dmg: 11, rate: 99, salvo: 2, r: 55, h: 24, score: 40, coins: 24 },
        bomber: { model: 'bomber', kind: 'jet', hp: 130, speed: 1150, range: 500, weapon: 'bomb', dmg: 14, rate: 99, salvo: 7, r: 100, h: 36, score: 70, coins: 40 },
        mech: { model: 'mech', kind: 'ground', hp: 620, speed: 150, range: 950, weapon: 'shell', dmg: 16, rate: 2.2, salvo: 2, r: 70, h: 160, score: 160, coins: 120, boss: true },
    },

    // Гражданский транспорт: модели и цвета кузова (материал paint).
    TRAFFIC: ['car_a', 'car_b', 'taxi', 'bus', 'truck', 'car_a', 'car_b'],
    PAINTS: [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xecf0f1, 0x9b59b6, 0xe67e22, 0x34495e],
    // Гражданские машины 2.0 (GameTraffic): файл assets/models/vehicles/<id>.glb, нос вдоль +X. len, wid, h — габариты px;
    // old — модель-замена из assets/models/units/, пока нового файла нет; paint — кузов красится (материал paint);
    // w — доля в потоке; blast — взрывается (радиус px).
    VEHICLES: {
        sedan: { len: 46, wid: 19, h: 15, hp: 10, score: 1, paint: true, w: 6, old: 'car_a' },
        hatch: { len: 40, wid: 18, h: 15, hp: 9, score: 1, paint: true, w: 5, old: 'car_b' },
        suv: { len: 48, wid: 20, h: 18, hp: 12, score: 1.2, paint: true, w: 4, old: 'car_a' },
        pickup: { len: 52, wid: 20, h: 18, hp: 12, score: 1.2, paint: true, w: 3, old: 'car_b' },
        sports: { len: 44, wid: 19, h: 12, hp: 8, score: 2, paint: true, w: 1, old: 'car_b' },
        van: { len: 54, wid: 21, h: 23, hp: 14, score: 1.4, paint: true, w: 3, old: 'car_a' },
        taxi: { len: 46, wid: 19, h: 16, hp: 10, score: 1.2, w: 3, old: 'taxi' },
        bus: { len: 115, wid: 26, h: 32, hp: 30, score: 4, w: 2, old: 'bus' },
        truck: { len: 95, wid: 26, h: 36, hp: 28, score: 3, paint: true, w: 2, old: 'truck' },
        tanker: { len: 105, wid: 26, h: 34, hp: 18, score: 6, w: 1, old: 'truck', blast: 260 },
        fire_truck: { len: 90, wid: 26, h: 34, hp: 30, score: 4, w: 1, old: 'truck' },
        ambulance: { len: 58, wid: 22, h: 26, hp: 16, score: 2, w: 1, old: 'car_a' },
    },

    // --- Разрушаемые пропсы: имя файла модели -> поведение ---------------------------------------
    // r — радиус опоры px, h — высота px, hp, mode: shatter (рассыпается) | topple (падает) | explode,
    // score — очки, colors — цвета обломков, blast — радиус взрыва px.
    PROPS: {
        tree_round: { r: 14, h: 70, hp: 6, mode: 'shatter', score: 0.6, colors: [0x4caf50, 0x6b4a2b], leaf: 0x58c05a },
        tree_tall: { r: 12, h: 95, hp: 6, mode: 'shatter', score: 0.6, colors: [0x3f9d4a, 0x6b4a2b], leaf: 0x4fb35a },
        tree_pine: { r: 13, h: 85, hp: 6, mode: 'shatter', score: 0.6, colors: [0x2f7d46, 0x5a3d25], leaf: 0x3a9454 },
        tree_palm: { r: 10, h: 90, hp: 5, mode: 'shatter', score: 0.6, colors: [0x58b848, 0x9a7a4a], leaf: 0x6fd05a },
        tree_sakura: { r: 14, h: 70, hp: 5, mode: 'shatter', score: 0.6, colors: [0xff9ec4, 0x6b4a3a], leaf: 0xffb6d4 },
        tree_snow: { r: 13, h: 85, hp: 6, mode: 'shatter', score: 0.6, colors: [0xeaf4fa, 0x2f6d46], leaf: 0xffffff },
        bush: { r: 12, h: 22, hp: 2, mode: 'shatter', score: 0.2, colors: [0x4caf50], leaf: 0x58c05a },
        rock: { r: 18, h: 25, hp: 20, mode: 'shatter', score: 0.4, colors: [0x8d8d8d, 0x6f6f6f] },
        cactus: { r: 8, h: 50, hp: 4, mode: 'shatter', score: 0.3, colors: [0x4f9d4a], leaf: 0x5fb85a },
        ice_rock: { r: 18, h: 35, hp: 14, mode: 'shatter', score: 0.4, colors: [0xbfe6ff, 0xe6f6ff] },
        lamp: { r: 5, h: 50, hp: 4, mode: 'shatter', score: 0.4, colors: [0x55606a], spark: true },
        traffic_light: { r: 5, h: 45, hp: 4, mode: 'shatter', score: 0.4, colors: [0x333a40, 0xf1c40f], spark: true },
        hydrant: { r: 5, h: 10, hp: 3, mode: 'shatter', score: 0.4, colors: [0xd0342c], water: true },
        bench: { r: 10, h: 8, hp: 2, mode: 'shatter', score: 0.2, colors: [0x8a5a34] },
        bus_stop: { r: 20, h: 26, hp: 6, mode: 'shatter', score: 0.6, colors: [0x9fd0e6, 0x55606a] },
        billboard: { r: 34, h: 60, hp: 10, mode: 'shatter', score: 1, colors: [0xf39c12, 0x3498db, 0x55606a] },
        power_pole: { r: 5, h: 65, hp: 4, mode: 'shatter', score: 0.4, colors: [0x7a5a3a], spark: true },
        container_red: { r: 30, h: 26, hp: 26, mode: 'shatter', score: 1.5, colors: [0xc0392b, 0x922b21] },
        container_blue: { r: 30, h: 26, hp: 26, mode: 'shatter', score: 1.5, colors: [0x2e6da4, 0x1f4e79] },
        container_green: { r: 30, h: 26, hp: 26, mode: 'shatter', score: 1.5, colors: [0x2e8b57, 0x1f6a40] },
        barrier: { r: 14, h: 10, hp: 8, mode: 'shatter', score: 0.3, colors: [0xcfcfcf, 0xe74c3c] },
        fountain: { r: 35, h: 30, hp: 22, mode: 'shatter', score: 2, colors: [0xcfd6dc, 0x9aa8b4], water: true },
        neon_sign_a: { r: 7, h: 70, hp: 5, mode: 'shatter', score: 0.8, colors: [0xff3ea5, 0x30e0ff], spark: true },
        neon_sign_b: { r: 24, h: 40, hp: 5, mode: 'shatter', score: 0.8, colors: [0xffd23f, 0xff3ea5], spark: true },
        torii: { r: 42, h: 80, hp: 16, mode: 'shatter', score: 2, colors: [0xd0342c, 0x2a2a2a] },
        umbrella: { r: 12, h: 25, hp: 1, mode: 'shatter', score: 0.2, colors: [0xff6b6b, 0xffffff] },
        tent: { r: 24, h: 24, hp: 5, mode: 'shatter', score: 0.6, colors: [0x6b7a4a] },
        crates: { r: 18, h: 26, hp: 6, mode: 'shatter', score: 0.5, colors: [0xa87a4a, 0x6b7a4a] },
        fuel_tank: { r: 18, h: 40, hp: 8, mode: 'explode', score: 4, colors: [0xd0342c, 0xeeeeee], blast: 260 },
        antenna: { r: 8, h: 80, hp: 8, mode: 'shatter', score: 1, colors: [0xb0b8c0, 0xd0342c], spark: true },
        radar_small: { r: 14, h: 45, hp: 8, mode: 'shatter', score: 1, colors: [0xcfd6dc, 0x6b7a4a] },
        lantern: { r: 6, h: 30, hp: 3, mode: 'shatter', score: 0.3, colors: [0xb0a898, 0xffd27a] },
        market_stall: { r: 20, h: 28, hp: 4, mode: 'shatter', score: 0.5, colors: [0xe74c3c, 0xffffff, 0xa87a4a] },
        fence: { r: 28, h: 14, hp: 2, mode: 'shatter', score: 0.1, colors: [0xb0b8c0] },
        // Достопримечательности: падают целиком и крушат то, на что упали.
        ferris_wheel: { r: 150, h: 600, hp: 260, mode: 'topple', score: 80, colors: [0xffffff, 0xe74c3c, 0x3498db, 0xf1c40f] },
        radio_tower: { r: 120, h: 900, hp: 420, mode: 'topple', score: 120, colors: [0xd0342c, 0xffffff] },
        crane_port: { r: 110, h: 320, hp: 180, mode: 'topple', score: 40, colors: [0xe6a23c, 0x55606a] },
        crane_build: { r: 40, h: 500, hp: 120, mode: 'topple', score: 40, colors: [0xf1c40f, 0x55606a] },
        statue: { r: 70, h: 350, hp: 220, mode: 'topple', score: 70, colors: [0x6fae9a, 0xb0a898] },
        lighthouse: { r: 85, h: 300, hp: 160, mode: 'topple', score: 50, colors: [0xffffff, 0xd0342c] },
        water_tower: { r: 50, h: 160, hp: 60, mode: 'topple', score: 14, colors: [0x9aa8b4, 0x7a5a3a], water: true },
        wind_turbine: { r: 26, h: 360, hp: 70, mode: 'topple', score: 20, colors: [0xffffff, 0xd8dee4] },
        oil_tank: { r: 100, h: 90, hp: 40, mode: 'explode', score: 30, colors: [0xffffff, 0xb0b8c0], blast: 520 },
        ship_cargo: { r: 130, h: 140, hp: 380, mode: 'shatter', score: 90, colors: [0x2e4a66, 0xc0392b, 0x2e6da4, 0xffffff], long: 300 },
        yacht: { r: 40, h: 60, hp: 40, mode: 'shatter', score: 12, colors: [0xffffff, 0x3498db], long: 80 },
        obelisk: { r: 28, h: 240, hp: 110, mode: 'topple', score: 30, colors: [0xe8c48c, 0xffd76a] },
        big_sign: { r: 90, h: 220, hp: 70, mode: 'topple', score: 30, colors: [0xff3ea5, 0xffd23f, 0x55606a], spark: true },
        radar_dome: { r: 80, h: 160, hp: 120, mode: 'shatter', score: 40, colors: [0xffffff, 0xcfd6dc] },
        missile_silo: { r: 90, h: 150, hp: 90, mode: 'explode', score: 60, colors: [0xb0b8c0, 0xd0342c], blast: 620 },
        ice_spire: { r: 55, h: 250, hp: 80, mode: 'shatter', score: 16, colors: [0xbfe6ff, 0xe6f6ff] },
        satellite_dish: { r: 70, h: 220, hp: 140, mode: 'topple', score: 45, colors: [0xffffff, 0x9aa8b4] },
        gas_station: { r: 110, h: 70, hp: 50, mode: 'explode', score: 40, colors: [0xe74c3c, 0xffffff], blast: 460 },
        clock_tower: { r: 48, h: 450, hp: 240, mode: 'topple', score: 70, colors: [0xb86a58, 0xf6ecd8, 0x4a5a6a] },
        monument_ring: { r: 110, h: 260, hp: 200, mode: 'topple', score: 60, colors: [0xc8d0d8, 0x30e0ff] },
        // --- 2.0: уличные детали (assets/models/props/) ---
        mailbox: { r: 5, h: 12, hp: 2, mode: 'shatter', score: 0.2, colors: [0x2e6da4] },
        trash_bin: { r: 5, h: 10, hp: 1, mode: 'shatter', score: 0.2, colors: [0x55606a, 0x2ecc71] },
        phone_booth: { r: 8, h: 24, hp: 3, mode: 'shatter', score: 0.4, colors: [0xd0342c, 0x9fd0e6], spark: true },
        newsstand: { r: 16, h: 28, hp: 4, mode: 'shatter', score: 0.6, colors: [0x2e8b57, 0xffffff, 0xf1c40f] },
        vending: { r: 8, h: 20, hp: 3, mode: 'shatter', score: 0.4, colors: [0xe74c3c, 0xffffff], spark: true },
        cafe_table: { r: 12, h: 22, hp: 1, mode: 'shatter', score: 0.2, colors: [0xffffff, 0xff6b6b, 0x8a5a34] },
        planter: { r: 10, h: 12, hp: 2, mode: 'shatter', score: 0.2, colors: [0xb0a898, 0x4caf50], leaf: 0x58c05a },
        bollard: { r: 3, h: 8, hp: 1, mode: 'shatter', score: 0.1, colors: [0x55606a, 0xf1c40f] },
        street_clock: { r: 5, h: 40, hp: 3, mode: 'shatter', score: 0.4, colors: [0x2a2a2a, 0xffffff] },
        sign_stop: { r: 3, h: 28, hp: 1, mode: 'shatter', score: 0.1, colors: [0xd0342c, 0xb0b8c0] },
        shop_sign: { r: 12, h: 30, hp: 2, mode: 'shatter', score: 0.3, colors: [0xffd23f, 0xff3ea5, 0x55606a], spark: true },
        food_cart: { r: 14, h: 24, hp: 3, mode: 'shatter', score: 0.4, colors: [0xffd23f, 0xe74c3c, 0xffffff] },
        atm: { r: 6, h: 18, hp: 3, mode: 'shatter', score: 0.6, colors: [0x2e6da4, 0xcfd6dc], spark: true },
        dumpster: { r: 14, h: 14, hp: 6, mode: 'shatter', score: 0.3, colors: [0x2e8b57, 0x1f6a40] },
        barrel: { r: 6, h: 12, hp: 3, mode: 'explode', score: 1, colors: [0xd0342c, 0xf1c40f], blast: 150 },
        gas_cylinder: { r: 6, h: 14, hp: 3, mode: 'explode', score: 1.2, colors: [0xe67e22, 0xb0b8c0], blast: 180 },
        transformer: { r: 14, h: 22, hp: 6, mode: 'explode', score: 2, colors: [0x7f8c8d, 0xf1c40f], blast: 200, spark: true },
        playground: { r: 40, h: 35, hp: 6, mode: 'shatter', score: 1, colors: [0xe74c3c, 0xf1c40f, 0x3498db] },
        flagpole: { r: 4, h: 90, hp: 3, mode: 'shatter', score: 0.4, colors: [0xcfd6dc, 0xe74c3c] },
        scaffold: { r: 30, h: 80, hp: 8, mode: 'shatter', score: 1, colors: [0xb0b8c0, 0xe6a23c, 0x8a5a34] },
        road_cone: { r: 3, h: 6, hp: 1, mode: 'shatter', score: 0.05, colors: [0xff7a1a, 0xffffff] },
        tire_stack: { r: 8, h: 12, hp: 2, mode: 'shatter', score: 0.1, colors: [0x2a2a2a] },
        statue_small: { r: 14, h: 45, hp: 14, mode: 'shatter', score: 1.5, colors: [0x6fae9a, 0xb0a898] },
        bike_rack: { r: 14, h: 10, hp: 1, mode: 'shatter', score: 0.2, colors: [0xb0b8c0, 0xe74c3c, 0x3498db] },
        pallet: { r: 10, h: 8, hp: 1, mode: 'shatter', score: 0.1, colors: [0xa87a4a] },
        portable_toilet: { r: 8, h: 22, hp: 2, mode: 'shatter', score: 0.3, colors: [0x3498db, 0xffffff] },
        picnic_table: { r: 14, h: 9, hp: 1, mode: 'shatter', score: 0.1, colors: [0x8a5a34] },
        stone_lantern: { r: 7, h: 22, hp: 5, mode: 'shatter', score: 0.4, colors: [0xb0a898, 0xffd27a] },
        bonsai: { r: 10, h: 14, hp: 2, mode: 'shatter', score: 0.2, colors: [0x3f9d4a, 0x6b4a2b], leaf: 0x58c05a },
        shrine_small: { r: 24, h: 40, hp: 8, mode: 'shatter', score: 1.5, colors: [0xd0342c, 0x2a2a2a, 0xf6ecd8] },
        buoy: { r: 8, h: 20, hp: 2, mode: 'shatter', score: 0.2, colors: [0xd0342c, 0xffffff] },
        boat_small: { r: 16, h: 14, hp: 4, mode: 'shatter', score: 0.8, colors: [0xffffff, 0x2e6da4, 0x8a5a34], long: 36 },
        forklift: { r: 12, h: 20, hp: 6, mode: 'shatter', score: 0.6, colors: [0xf1c40f, 0x2a2a2a] },
        snowman: { r: 8, h: 18, hp: 1, mode: 'shatter', score: 0.2, colors: [0xffffff, 0xff7a1a] },
        ice_hut: { r: 24, h: 22, hp: 8, mode: 'shatter', score: 0.8, colors: [0xe6f6ff, 0xbfe6ff] },
        snowmobile: { r: 10, h: 10, hp: 3, mode: 'shatter', score: 0.4, colors: [0xd0342c, 0x2a2a2a] },
        supply_crate: { r: 12, h: 14, hp: 4, mode: 'shatter', score: 0.3, colors: [0x6b7a4a, 0xa87a4a] },
        // --- 2.0: природа (assets/models/nature/) ---
        cactus_big: { r: 12, h: 80, hp: 6, mode: 'shatter', score: 0.5, colors: [0x4f9d4a], leaf: 0x5fb85a },
        dead_tree: { r: 8, h: 60, hp: 4, mode: 'shatter', score: 0.3, colors: [0x7a6a5a] },
        // --- 2.0: крупные сооружения (assets/models/landmarks/) ---
        power_pylon: { r: 40, h: 300, hp: 60, mode: 'topple', score: 16, colors: [0xb0b8c0, 0x7f8c8d], spark: true },
        cooling_tower: { r: 140, h: 320, hp: 260, mode: 'topple', score: 70, colors: [0xdcd3c6, 0xb0a898] },
        smokestack: { r: 30, h: 420, hp: 140, mode: 'topple', score: 40, colors: [0xc8745a, 0xffffff, 0xd0342c] },
        silo: { r: 40, h: 200, hp: 80, mode: 'topple', score: 20, colors: [0xcfd6dc, 0x9aa8b4] },
        gas_holder: { r: 90, h: 130, hp: 50, mode: 'explode', score: 40, colors: [0xffffff, 0x9aa8b4], blast: 600 },
        carousel: { r: 70, h: 90, hp: 40, mode: 'shatter', score: 14, colors: [0xff6b6b, 0xffd23f, 0xffffff, 0x3498db] },
        stadium_light: { r: 20, h: 320, hp: 50, mode: 'topple', score: 12, colors: [0xb0b8c0, 0xffffff], spark: true },
        tv_tower: { r: 90, h: 1100, hp: 520, mode: 'topple', score: 160, colors: [0xcfd6dc, 0xd0342c, 0xffffff] },
        billboard_big: { r: 70, h: 180, hp: 40, mode: 'topple', score: 12, colors: [0xf39c12, 0x3498db, 0x55606a], spark: true },
        drill_rig: { r: 60, h: 380, hp: 120, mode: 'topple', score: 36, colors: [0x7f8c8d, 0xd0342c, 0xf1c40f] },
        pumpjack: { r: 40, h: 90, hp: 30, mode: 'shatter', score: 8, colors: [0x2a2a2a, 0xd0342c, 0xf1c40f] },
        sphinx: { r: 130, h: 170, hp: 240, mode: 'shatter', score: 60, colors: [0xe8c48c, 0xdcb880], long: 240 },
        casino_sign: { r: 50, h: 300, hp: 80, mode: 'topple', score: 30, colors: [0xffd76a, 0xff3ea5, 0x30e0ff], spark: true },
        ice_dome: { r: 90, h: 110, hp: 90, mode: 'shatter', score: 24, colors: [0xe6f6ff, 0xbfe6ff, 0xffffff] },
        antenna_array: { r: 60, h: 260, hp: 70, mode: 'topple', score: 22, colors: [0xcfd6dc, 0xd0342c], spark: true },
        temple_bell: { r: 46, h: 60, hp: 20, mode: 'shatter', score: 5, colors: [0xd0342c, 0x8a7a3a, 0x2a2a2a] },
        train_wagon: { r: 24, h: 34, hp: 30, mode: 'shatter', score: 5, colors: [0x7a5a3a, 0x2e6da4, 0xc0392b], long: 110 },
        fishing_boat: { r: 30, h: 50, hp: 30, mode: 'shatter', score: 8, colors: [0xffffff, 0x2e8b57, 0xd0342c], long: 70 },
        submarine: { r: 50, h: 60, hp: 200, mode: 'shatter', score: 60, colors: [0x2a3440, 0x55606a], long: 260 },
        plane_parked: { r: 90, h: 60, hp: 50, mode: 'explode', score: 40, colors: [0xffffff, 0x3498db, 0xcfd6dc], blast: 320, long: 200 },
        heli_parked: { r: 50, h: 40, hp: 26, mode: 'explode', score: 20, colors: [0x6b7a4a, 0x2a2a2a], blast: 220 },
        rocket: { r: 45, h: 420, hp: 110, mode: 'explode', score: 120, colors: [0xffffff, 0xd0342c, 0x2a2a2a], blast: 720 },
    },

    // --- Карты: свет, небо, погода, музыка -------------------------------------------------------
    // unlock — % разрушения ПРЕДЫДУЩЕЙ карты, открывающий эту (или просмотры рекламы adUnlock).
    MAPS: [
        { id: 'metro', sky: 0x8fc8f0, fog: 0.000055, sunAz: 32, sunEl: 46, sun: 0xfff1d0, sunI: 0.82, skyI: 0.48, skyLight: 0xbfdcff, ground: 0xc8ccb8, shadow: 0x16324a, weather: null, lit: 0, unlock: 0, adUnlock: 0 },
        { id: 'harbor', sky: 0xf0a878, fog: 0.00006, sunAz: 200, sunEl: 20, sun: 0xffb070, sunI: 0.9, skyI: 0.46, skyLight: 0xc8b0e0, ground: 0xd0a888, shadow: 0x3a2050, weather: null, lit: 0.25, unlock: 25, adUnlock: 2 },
        { id: 'tokyo', sky: 0x241c4c, fog: 0.00008, sunAz: 120, sunEl: 52, sun: 0xa8b8ff, sunI: 0.5, skyI: 0.62, skyLight: 0x9a90e0, ground: 0x5a4a80, shadow: 0x0a0820, weather: 'rain', lit: 1, unlock: 25, adUnlock: 3 },
        { id: 'desert', sky: 0xf0d8a8, fog: 0.00007, sunAz: 60, sunEl: 58, sun: 0xfff0c8, sunI: 0.92, skyI: 0.44, skyLight: 0xffe8c0, ground: 0xe8c890, shadow: 0x503018, weather: null, lit: 0, unlock: 25, adUnlock: 4 },
        { id: 'arctic', sky: 0xc8dcec, fog: 0.00009, sunAz: 300, sunEl: 26, sun: 0xfff6ee, sunI: 0.74, skyI: 0.56, skyLight: 0xd8ecff, ground: 0xe0ecf8, shadow: 0x284a6a, weather: 'snow', lit: 0.15, unlock: 25, adUnlock: 5 },
    ],

    mapInfo(id) { return this.MAPS.find(m => m.id === id) || this.MAPS[0]; },
    levelOf(xp) { let n = 1; for (let i = 0; i < this.LEVELS.length; i++) if (xp >= this.LEVELS[i].xp) n = i + 1; return n; },
    starsOf(heat) { let n = 0; for (let i = 1; i < this.STARS.length; i++) if (heat >= this.STARS[i]) n = i; return n; },
    scaleOf(level) { return this.LEVELS[Math.max(0, Math.min(this.LEVELS.length - 1, level - 1))].scale; },
    hpOf(level) { return Math.round(this.BASE_HP * (1 + this.HP_PER_LEVEL * (level - 1))); },

    // Детерминированный ГСЧ (mulberry32) и хэш строки — расстановка и оттенки одинаковы на каждом запуске.
    rng(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },
    hash(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; },
};
