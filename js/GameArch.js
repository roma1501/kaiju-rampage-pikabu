// GameArch.js — архитектура зданий: из маркера карты получается ПЛАН здания — сетка кирпичей, какой тайл фасада на
// какой грани, оттенок стен и декоративные детали (крыши, козырьки, балконы, вывески, надстройки). Только данные и
// текстуры: меши строит и разрушает GameCity.js. Договор — docs/GAME-CONTRACT.md, раздел 10.3.
//
// ТАЙЛЫ. Каждая грань кирпича показывает ровно ОДИН тайл целиком (UV 0..1): тайл — самостоятельный модуль фасада
// (2 этажа × ~3 окна), бесшовность не нужна. Все тайлы рисуются кодом на canvas в один атлас-сетку COLS × ROWS
// (2048×2048, на телефонах 1024×1024); вокруг каждого тайла — поля (PAD), tileUV их учитывает. Номер тайла = его
// место в GameArch.TILES, номер по имени — GameArch.tile(имя). У стиля фасада 8 тайлов-ярусов (ROLES):
//   '' стена A · '_b' стена B (балконы, пожарные лестницы…) · '_c' акцентная секция (лестничная клетка, эркер…) ·
//   '_g' первый этаж (витрина, ворота) · '_d' вход · '_t' верх с карнизом · '_x' глухая стена · '_e' первый этаж, вариант 2.
// Дальше — крыши ('roof…'), изнанка ('inner…': разлом, перекрытие, потолок) и материалы деталей ('m_…').
// Ночной атлас (litLevel > 0): часть окон горит уже в основной текстуре; текстура свечения lit — чёрная, кроме горящих
// окон, неона и вывесок (потребитель ставит её как emissiveTexture с теми же UV, лучше с useEmissiveAsIllumination).
//
// ПЛАН (GameArch.plan(def)) — см. описание полей у функции. Локальные координаты здания: x — вдоль ширины
// (−w/2..w/2), y — вверх от земли (0..h), z — вдоль глубины (−d/2..d/2). Клетка (i, j, k) занимает
// x: i·cw − w/2 … +cw, y: j·ch … +ch, z: k·cd − d/2 … +cd; её номер ci = (j·nz + k)·nx + i.
// Парадный фасад — сторона −Z (при курсе 0 смотрит вверх карты): там главный вход; на +Z — второй вход и витрины.
//
// ОПОРА. Кирпич держится, если под ним колонна кирпичей до земли или он не дальше span клеток вбок (по занятым
// клеткам своего этажа) от такой колонны. plan.span — 1, у мостов между башнями и арок 2–3. Все планы этому правилу
// удовлетворяют: GameArch.hanging(plan) === 0 (tests/game-arch.test.mjs).
//
// ОТРИСОВКА — эталон в GameArch.preview(): грани кирпича, UV, оттенки, детали box и wedge.

/** @satisfies {Record<string, any>} */
const GameArch = {
    TILE: 128,          // px: ячейка тайла в атласе вместе с полями (на телефонах 64)
    PAD: 4,             // px: поле вокруг тайла (края тайла растянуты в него — мипы не тянут соседей)
    COLS: 16,           // тайлов в строке атласа
    ROWS: 16,           // строк в атласе
    BRICK_H: 70,        // px: высота кирпича (2 этажа)
    CELL: 88,           // px: желаемый размер кирпича в плане (режется на 70..110)

    // Ярусы стиля: суффикс имени тайла. Тайл стиля S яруса r — S + ROLES[r].
    ROLES: ['', '_b', '_c', '_g', '_d', '_t', '_x', '_e'],
    SHAPES: ['box', 'step', 'spire', 'cyl', 'dome', 'pyramid', 'ring', 'pagoda', 'hangar', 'twin', 'lshape', 'arch',
        'tower', 'slab', 'ushape', 'court', 'house', 'cross', 'terrace', 'mall', 'factory', 'church'],
    // Тайлы вне стилей: крыши, изнанка, материалы деталей.
    EXTRA: ['roof_dark', 'roof_vent', 'roof_ac', 'roof_heli', 'roof_solar', 'roof_green', 'roof_pool', 'roof_deck', 'roof_glass',
        'roof_tile', 'roof_metal', 'roof_snow', 'roof_sand', 'roof_park', 'roof_court', 'inner_floor', 'inner_dark',
        'm_plain', 'm_trim', 'm_metal', 'm_vent', 'm_ac', 'm_dark', 'm_wood', 'm_tank', 'm_glass', 'm_rail', 'm_stone', 'm_gold',
        'm_hazard', 'm_brick', 'm_plant', 'm_snow', 'm_lamp', 'm_red', 'm_lantern', 'm_clock', 'm_flag', 'm_screen', 'm_pipe',
        'm_awn', 'm_awn_r', 'm_awn_b', 'm_awn_g', 'm_awn_y', 'm_sign1', 'm_sign2', 'm_sign3', 'm_sign4', 'm_sign5', 'm_sign6',
        'm_neon1', 'm_neon2', 'm_neon3', 'm_neon4', 'm_bill1', 'm_bill2', 'm_bill3', 'm_bill4'],
    /** Имена тайлов по номерам (заполняет _init): первые 18 — как в v0 (16 стен, 'roof', 'inner'). */
    /** @type {string[]} */ TILES: [],
    /** @type {Record<string, number>} */ _ix: {},
    /** @type {Record<string, number[]>} */ _st: {},
    _fk: '',
    /** @type {Uint8Array} */ _fg: new Uint8Array(0),

    // Стили фасадов (имя — третья часть имени маркера b-<форма>-<стиль>-<N>).
    //   hp — прочность кирпича; tints — оттенки стен (цвет умножает тайл); cls — род здания: 'com' (первый этаж —
    //   витрины), 'res' (жильё), 'ind' (цеха и склады); roof — тайл плоской крыши; pitch — % малоэтажных домов со
    //   скатной крышей; par — вид парапета; trim — цвет карнизов и парапетов; ent / front — декор входа и витрин;
    //   equip — надстройки на крыше; art — как рисовать тайлы (см. _paint).
    STYLES: {
        concrete: { hp: 30, cls: 'res', roof: 'roof', pitch: 0, trim: 0xe8e8e4, ent: 'canopy', front: 'sign', stripe: 1, equip: ['hut', 'ac', 'vent', 'antenna', 'ac', 'bill'],
            tints: [0xe6e6e2, 0xd2d6da, 0xc9c2b8, 0xdcd3c6, 0xe8dcc8, 0xc8d4d0],
            art: { mat: 'concrete', wc: '#b4b7ba', tr: '#eceef0', cols: 3, ww: 0.66, wh: 0.5, wo: { fr: '#3a414b', fw: 1.4 }, B: 'loggia', C: 'stair', G: 'lobby', D: 'glass', T: 'parapet', X: 'pipe', E: 'gwin' } },
        office: { hp: 28, cls: 'com', roof: 'roof', pitch: 0, par: 'thin', trim: 0xffffff, ent: 'glass', front: 'canopy', pat: [0, 1, 2, 3], equip: ['hut', 'ac', 'antenna', 'sky', 'vent', 'ac'],
            tints: [0xf4f6f8, 0xdce8f0, 0xf0e6d8, 0xd6dee6, 0xe6f0e0, 0xf8e8e0],
            art: { mat: 'panel', wc: '#e6eaee', tr: '#ffffff', cols: 3, ww: 1, wh: 0.46, wo: { fw: 0, mx: 1, mc: '#eef2f6' }, B: 'fins', C: 'stair', G: 'lobby', D: 'glass', T: 'fascia', X: 'plain', E: 'colonnade' } },
        glass: { hp: 24, cls: 'com', roof: 'roof_dark', pitch: 0, par: 'thin', trim: 0xe0f0ff, ent: 'glass', front: 'none', pat: [0, 2, 2, 4], equip: ['hut', 'antenna', 'ac', 'vent'],
            tints: [0xbfe4ff, 0xa9f0e6, 0xd6e6ff, 0x9fd0ff, 0xc8f0d0, 0xe0d8ff],
            art: { mat: 'plaster', wc: '#eef6fb', tr: '#ffffff', cols: 3, ww: 0.93, wh: 0.9, wy: 0.5, wo: { fw: 0, g0: '#e8f6ff', g1: '#a9d9ff' }, B: 'band', C: 'stair', G: 'lobby', D: 'glass', T: 'crown', X: 'gpanel', E: 'colonnade' } },
        darkglass: { hp: 26, cls: 'com', roof: 'roof_dark', pitch: 0, par: 'thin', trim: 0x9aa8c0, ent: 'glass', front: 'none', pat: [0, 2, 2, 4], equip: ['hut', 'antenna', 'ac', 'antenna'],
            tints: [0xc0d0e8, 0xb0c4d8, 0xc8c4e8, 0xa8c8d0, 0xd0c0c8, 0xb8d8c8],
            art: { mat: 'plaster', wc: '#8a97ad', tr: '#b4c0d4', cols: 3, ww: 0.93, wh: 0.9, wy: 0.5, wo: { fw: 0, g0: '#5a6d92', g1: '#2c3a5e' }, B: 'band', C: 'vline', nl: '#9fd8ff', G: 'lobby', D: 'glass', T: 'neonline', X: 'gpanel', E: 'colonnade' } },
        brick: { hp: 22, cls: 'res', roof: 'roof_dark', pitch: 35, par: 'cornice', trim: 0xf6eee2, ent: 'porch', front: 'awn', equip: ['tank', 'chim', 'ac', 'vent', 'bill', 'hut'],
            tints: [0xf0a890, 0xe89078, 0xf8c8a0, 0xd89888, 0xe8c8a8, 0xc8a8a0, 0xf4b480],
            art: { mat: 'brick', wc: '#c79a8c', tr: '#fff4e8', cols: 3, ww: 0.48, wh: 0.56, wo: { fr: '#3b3530', fw: 1.2, lintel: 1, sill: 1, my: 1 }, B: 'fire', C: 'bigarch', G: 'shop', D: 'wood', dc: '#27503c', T: 'dentil', X: 'ghost', E: 'gwin' } },
        panel: { hp: 24, cls: 'res', roof: 'roof', pitch: 0, trim: 0xf4f4f0, ent: 'canopy', front: 'sign', stripe: 1, pat: [1, 1, 3, 5, 0], equip: ['hut', 'vent', 'antenna', 'ac', 'solar'],
            tints: [0xf0ead8, 0xd6e8f0, 0xf0d8c8, 0xdcecd0, 0xf6e6a8, 0xe8d8e8, 0xcfe4dc],
            art: { mat: 'panel', wc: '#d6d3cc', tr: '#fbfbf8', cols: 3, ww: 0.56, wh: 0.52, wo: { fr: '#ffffff', fw: 1.4, mx: 1 }, B: 'loggia', C: 'stair', G: 'shop', D: 'steel', T: 'parapet', X: 'smallwin', E: 'gwin' } },
        hotel: { hp: 26, cls: 'com', roof: 'roof', pitch: 30, hip: 1, par: 'cornice', trim: 0xfffaf0, ent: 'portico', front: 'awn', balc: 1, pat: [1, 4, 5, 2], equip: ['lightbox', 'hut', 'flag', 'ac', 'plant', 'tank'],
            tints: [0xffe9c2, 0xffd9c8, 0xe9f0d0, 0xf6e0ff, 0xfff0a8, 0xd8ecf8],
            art: { mat: 'plaster', wc: '#e4d8c6', tr: '#fffaf0', cols: 3, ww: 0.5, wh: 0.62, wo: { arch: 1, fr: '#fffaf0', fw: 1.6, mx: 1, my: 2, sill: 1 }, B: 'balc', C: 'bay', G: 'arcade', D: 'arch', dc: '#6a3a22', T: 'mansard', X: 'ivy', E: 'shop2' } },
        shop: { hp: 18, cls: 'com', roof: 'roof', pitch: 20, par: 'cornice', trim: 0xffffff, ent: 'awn', front: 'both', sect: 'ground', pat: [0, 1], equip: ['bill', 'lightbox', 'ac', 'vent', 'lightbox'],
            tints: [0xfff0d8, 0xd8f0ff, 0xffd8d8, 0xe0ffd8, 0xfff2a8, 0xf0d8ff, 0xffe0c0],
            art: { mat: 'plaster', wc: '#e4e0d8', tr: '#ffffff', cols: 3, ww: 0.56, wh: 0.5, wo: { fr: '#ffffff', fw: 1.6, mx: 1, sill: 1 }, B: 'awn', C: 'ad', G: 'shop', D: 'wood', dc: '#3a5a8a', T: 'fascia', X: 'poster', E: 'shop2' } },
        industrial: { hp: 30, cls: 'ind', roof: 'roof_metal', pitch: 0, par: 'metal', trim: 0xd8dce0, ent: 'canopy', front: 'none', pat: [0, 1, 2], equip: ['pipes', 'vent', 'sky', 'tank', 'ac', 'pipes'],
            tints: [0xc8d0d8, 0xb4c4b4, 0xd8c8b4, 0xa8b8c8, 0xd0b8a8, 0xc0c0c8],
            art: { mat: 'concrete', wc: '#bfc2c4', tr: '#e4e6e8', cols: 2, ww: 0.78, wh: 0.56, wo: { fr: '#3c444c', fw: 1.2, mx: 3, my: 2 }, B: 'louver', C: 'duct', G: 'gate', D: 'steel', T: 'parapet', X: 'pipe', E: 'hiwin' } },
        warehouse: { hp: 24, cls: 'ind', roof: 'roof_metal', pitch: 55, par: 'metal', trim: 0xe8e8e8, ent: 'none', front: 'none', blind: 2, pat: [0], equip: ['vent', 'sky', 'pipes', 'ac'],
            roofc: [0xd8dce0, 0xb8c8d8, 0xc87858, 0xa8b8a0], tints: [0xe09070, 0x80a8d0, 0xc8c0b0, 0x98b888, 0xe0c070, 0xb0a0c0],
            art: { mat: 'ribs', wc: '#d2d4d6', tr: '#f0f0f0', cols: 3, ww: 0.7, wh: 0.22, wy: 0.3, wo: { fr: '#3c444c', fw: 1 }, B: 'stripe', C: 'duct', G: 'dock', D: 'steel', T: 'parapet', X: 'plain', E: 'gwin' } },
        neon: { hp: 26, cls: 'com', roof: 'roof_dark', pitch: 0, trim: 0x6a6888, ent: 'canopy', front: 'neon', equip: ['neon', 'ac', 'neon', 'antenna', 'tank', 'bill'],
            tints: [0xd8ccff, 0xffc8e8, 0xc8f0ff, 0xe0d8ff, 0xffe0c8, 0xc8ffe0],
            art: { mat: 'plaster', wc: '#5c5a74', tr: '#8a88a8', cols: 4, ww: 0.56, wh: 0.5, wo: { fr: '#2a2838', fw: 1.2, p: 1.5 }, B: 'signs', C: 'screen', G: 'neonshop', D: 'glass', T: 'neonline', nl: '#ff5fd0', X: 'acwall', E: 'vending' } },
        sandstone: { hp: 26, cls: 'res', roof: 'roof_sand', pitch: 0, par: 'thick', trim: 0xfff0d8, ent: 'awn', front: 'awn', balc: 1, terr: ['roof_sand', 'roof_deck'], equip: ['plant', 'hut', 'chim', 'tank'],
            tints: [0xf2d6a0, 0xe8c48c, 0xf8e2b8, 0xdcb880, 0xf0c8a0, 0xfff0d0, 0xe8d0b0],
            art: { mat: 'adobe', wc: '#e2d6c2', tr: '#fff6e4', cols: 3, ww: 0.36, wh: 0.5, wo: { arch: 1, fr: '#6a4a30', fw: 1.2, sill: 1 }, B: 'lattice', C: 'bigarch', G: 'souk', D: 'arch', dc: '#5a3a22', T: 'crenel', X: 'beams', E: 'gwin' } },
        casino: { hp: 28, cls: 'com', roof: 'roof_dark', pitch: 0, par: 'cornice', trim: 0xffe9a8, ent: 'portico', front: 'neon', equip: ['neon', 'lightbox', 'flag', 'ac', 'neon'],
            tints: [0xffd76a, 0xff9fb8, 0xc8a0ff, 0xffe6a0, 0x90e0e0, 0xff9880],
            art: { mat: 'plaster', wc: '#e6dcd2', tr: '#fff2cc', cols: 3, ww: 0.6, wh: 0.56, wo: { fr: '#c9a03a', fw: 1.6, g0: '#6a7ab8', g1: '#2c3a78', p: 1.4 }, B: 'lights', C: 'vsign', nl: '#ffe27a', G: 'marquee', D: 'gold', T: 'neonline', X: 'pattern', pc: '#d8a830', E: 'shop2' } },
        bunker: { hp: 60, cls: 'ind', roof: 'roof_dark', pitch: 0, par: 'thick', trim: 0x8a9080, ent: 'none', front: 'none', blind: 2, pat: [0], equip: ['vent', 'antenna', 'hut', 'pipes'],
            tints: [0x9aa58c, 0x8c9488, 0xa8a898, 0x7f8c7a, 0xb0a890, 0x90a0a0],
            art: { mat: 'concrete', wc: '#cfcfc8', tr: '#e6e6dc', cols: 3, ww: 0.5, wh: 0.16, wy: 0.4, wo: { fr: '#2c302c', fw: 1.4, p: 0.5 }, B: 'hazard', C: 'duct', G: 'blast', D: 'steel', T: 'parapet', X: 'camo', E: 'gwin' } },
        wood: { hp: 16, cls: 'res', roof: 'roof_dark', pitch: 92, trim: 0x5a3424, ent: 'awn', front: 'awn', balc: 1, roofc: [0x3e4654, 0x4a5a52, 0x5a4038, 0x34404c], equip: ['chim', 'ac'],
            tints: [0xfff4e6, 0xffe6d0, 0xf6ecd8, 0xf0e0c0, 0xe8f0e0, 0xffe0e0],
            art: { mat: 'timber', wc: '#efe6d6', tr: '#5a3424', dk: '#5a3424', cols: 3, ww: 0.56, wh: 0.56, wo: { fr: '#5a3424', fw: 1.4, mx: 1, my: 1, g0: '#bfe0f4', g1: '#7fb4d8' }, B: 'balc', C: 'lat', G: 'noren', D: 'slide', T: 'eave', X: 'planks', E: 'gwin' } },
        ice: { hp: 26, cls: 'res', roof: 'roof_snow', pitch: 40, par: 'snow', trim: 0xffffff, ent: 'canopy', front: 'none', terr: ['roof_snow'], roofc: [0xffffff], equip: ['antenna', 'vent', 'snow', 'hut', 'snow'],
            tints: [0xf4fbff, 0xe0f0fa, 0xffe9d6, 0xd8ecf8, 0xe8f4f0, 0xffd8c8],
            art: { mat: 'ice', wc: '#dfe8ee', tr: '#ffffff', cols: 3, ww: 0.46, wh: 0.44, wo: { fr: '#ffffff', fw: 2, mx: 1, snow: 1, p: 2 }, B: 'icicle', C: 'porthole', G: 'garage', D: 'steel', T: 'snowcap', X: 'plain', E: 'gwin' } },
        // 2.0
        modern: { hp: 26, cls: 'res', roof: 'roof', pitch: 0, par: 'thin', trim: 0x34383e, ent: 'canopy', front: 'canopy', balc: 1, stripe: 1, pat: [0, 1, 3, 5], equip: ['solar', 'plant', 'sky', 'ac', 'solar'],
            tints: [0xffffff, 0xf2f4f6, 0xe6eef2, 0xfff6e8, 0xe8e8e8, 0xd8e0e8],
            art: { mat: 'plaster', wc: '#f0f0ee', tr: '#2e3238', cols: 2, ww: 0.78, wh: 0.62, wo: { fr: '#2e3238', fw: 1.2 }, B: 'gbalc', C: 'woodbay', G: 'lobby', D: 'wood', dc: '#b88a5a', T: 'parapet', X: 'smallwin', E: 'gwin' } },
        artdeco: { hp: 30, cls: 'com', roof: 'roof', pitch: 0, par: 'cornice', trim: 0xf4e6c8, ent: 'portico', front: 'sign', pat: [0, 3, 4, 2], equip: ['flag', 'tank', 'hut', 'antenna', 'lightbox'],
            tints: [0xf0dcb8, 0xe0d0b0, 0xd0d8d0, 0xf8e8c8, 0xe8c8b0, 0xc8d8e0],
            art: { mat: 'plaster', wc: '#d6cec0', tr: '#f4ead6', cols: 3, ww: 0.5, wh: 0.7, wy: 0.5, wo: { fr: '#4a3c2c', fw: 1.2, my: 2 }, B: 'spandrel', C: 'piers', G: 'shop', sc: '#22252c', D: 'portal', dc: '#b8902a', T: 'steps', X: 'pattern', pc: '#c9a03a', E: 'gwin' } },
        townhouse: { hp: 20, cls: 'res', roof: 'roof_dark', pitch: 75, par: 'cornice', trim: 0xffffff, ent: 'porch', front: 'none', sect: 'full', pat: [0, 1, 3], equip: ['chim', 'plant', 'chim', 'ac'],
            tints: [0xffb89a, 0xffe08a, 0x9adcc8, 0xc8b8f0, 0xf6a8b8, 0xa8c8f0, 0xf0f0e8, 0xb8e0a0],
            art: { mat: 'plaster', wc: '#e0dbd4', tr: '#ffffff', cols: 2, ww: 0.5, wh: 0.64, wo: { fr: '#ffffff', fw: 1.8, my: 1, sill: 1 }, B: 'shut', C: 'bay', G: 'tdoor', D: 'wood', dc: '#1f4e5a', T: 'dentil', X: 'plain', E: 'tgarden' } },
        tech: { hp: 28, cls: 'com', roof: 'roof_dark', pitch: 0, par: 'thin', trim: 0x4a5468, ent: 'glass', front: 'sign', pat: [0, 2, 4, 1], equip: ['antenna', 'solar', 'vent', 'neon', 'antenna'],
            tints: [0xd8e8ff, 0xc8f0f0, 0xe0d8ff, 0xd0ffe8, 0xffffff, 0xffe0f0],
            art: { mat: 'tech', wc: '#343c4c', tr: '#5a6478', cols: 3, ww: 0.93, wh: 0.34, wy: 0.5, wo: { fw: 0, g0: '#3f6688', g1: '#1c2c44', p: 1.2 }, B: 'led', C: 'vline', nl: '#6ff0ff', G: 'lobby', D: 'tech', T: 'neonline', X: 'hex', E: 'colonnade' } },
        metal: { hp: 24, cls: 'ind', roof: 'roof_metal', pitch: 50, par: 'metal', trim: 0xe0e4e8, ent: 'none', front: 'none', blind: 2, pat: [0, 1], equip: ['vent', 'pipes', 'sky', 'antenna'],
            roofc: [0xd8dce0, 0xb8c8d8, 0xe0d0b8], tints: [0xd0dce4, 0xb8c8d0, 0xe0d0b8, 0xa8c0d0, 0xc8d8c0, 0xe0e0e0],
            art: { mat: 'ribs', wc: '#d0d3d6', tr: '#f0f2f4', cols: 3, ww: 0.5, wh: 0.3, wo: { fr: '#39414a', fw: 1.2 }, B: 'stripe', C: 'duct', G: 'gate', D: 'steel', T: 'parapet', X: 'plain', E: 'gwin' } },
        stone: { hp: 34, cls: 'com', roof: 'roof', pitch: 20, hip: 1, par: 'cornice', trim: 0xf0eadc, ent: 'portico', front: 'awn', balc: 1, pat: [0, 3, 4, 1], equip: ['flag', 'hut', 'chim', 'plant'],
            tints: [0xdcd4c4, 0xccc4b4, 0xe4dccc, 0xbcbcb4, 0xd8ccb8, 0xe8e0d0],
            art: { mat: 'block', wc: '#cdc5b8', tr: '#f2ece0', dk: '#e8e2d6', cols: 3, ww: 0.46, wh: 0.6, wo: { fr: '#4a4038', fw: 1.2, mx: 1, my: 2, lintel: 1, sill: 1 }, B: 'balc', C: 'bigarch', G: 'arcade', D: 'portal', dc: '#5a3a22', T: 'dentil', X: 'plain', E: 'gwin' } },
    },

    /** Заполнить список тайлов (раз при загрузке скрипта). */
    _init() {
        const T = this.TILES, names = Object.keys(this.STYLES);
        T.length = 0;
        for (const s of names.slice(0, 16)) T.push(s);
        T.push('roof', 'inner');
        for (const s of names) for (const r of this.ROLES) if (T.indexOf(s + r) < 0) T.push(s + r);
        for (const e of this.EXTRA) T.push(e);
        T.forEach((name, i) => { this._ix[name] = i; });
        for (const s of names) this._st[s] = this.ROLES.map((r) => this._ix[s + r]);
    },

    /** Номер тайла по имени (нет такого — тайл 0). */
    tile(id) { const i = this._ix[id]; return i === undefined ? 0 : i; },

    /** Прямоугольник тайла в атласе без полей: out = [u0, v0, u1, v1], v0 — ВЕРХ тайла (атлас грузится без переворота). */
    tileUV(tile, out) {
        const c = tile % this.COLS, r = Math.floor(tile / this.COLS), e = this.PAD / this.TILE;
        out[0] = (c + e) / this.COLS; out[1] = (r + e) / this.ROWS; out[2] = (c + 1 - e) / this.COLS; out[3] = (r + 1 - e) / this.ROWS;
        return out;
    },

    /**
     * Атлас тайлов сцены: { texture, lit } — основная текстура и (для ночных карт, litLevel > 0) текстура свечения:
     * чёрная, кроме горящих окон, неона и вывесок. Обе рисуются кодом; картинки не нужны.
     */
    async buildAtlas(scene, litLevel) {
        const lit = Math.max(0, Number(litLevel) || 0), T = IS_MOBILE ? this.TILE / 2 : this.TILE;
        const night = lit <= 0 ? 0 : Math.min(0.62, 0.14 + lit * 0.46);           // доля горящих окон
        const make = (/** @type {string} */ name, /** @type {boolean} */ emis) => {
            const canvas = document.createElement('canvas');
            canvas.width = this.COLS * T; canvas.height = this.ROWS * T;
            this._paint(canvas, emis, night);
            const tex = new BABYLON.DynamicTexture(name, canvas, scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
            tex.update(false);
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE; tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.anisotropicFilteringLevel = IS_MOBILE ? 2 : 6;
            return tex;
        };
        const texture = make('arch-atlas', false);
        let glow = null;
        if (lit > 0) { glow = make('arch-atlas-lit', true); glow.level = Math.min(1.3, 0.45 + lit * 0.75); }
        return { texture, lit: glow };
    },

    /**
     * Нарисовать все тайлы в canvas атласа. emis — проход свечения (всё, кроме горящих окон и неона, чёрное);
     * night — доля горящих окон (0 — день). Единицы кистей — 0..100 по обеим осям тайла, y вниз; тайл фасада — два
     * этажа: верхний y 0..50, нижний 50..100.
     */
    _paint(canvas, emis, night) {
        const COLS = this.COLS, T = canvas.width / COLS, pad = T * this.PAD / this.TILE, S = T - 2 * pad;
        const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        const tc = document.createElement('canvas');
        tc.width = tc.height = S;
        const t = /** @type {CanvasRenderingContext2D} */ (tc.getContext('2d'));
        let rnd = KR.rng(1);
        const DARK = '#2c3038', SHD = 'rgba(0,0,0,0.22)';

        // --- кисти. R — обычная заливка (в проходе свечения чёрная: заслоняет свет), L — светящаяся, A — тень/блик.
        const hex = (col) => [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
        const sh = (col, k) => { const q = hex(col); return 'rgb(' + Math.min(255, Math.round(q[0] * k)) + ',' + Math.min(255, Math.round(q[1] * k)) + ',' + Math.min(255, Math.round(q[2] * k)) + ')'; };
        const R = (x, y, w, h, col) => { t.fillStyle = emis ? '#000' : col; t.fillRect(x, y, w, h); };
        const L = (x, y, w, h, col, k) => { t.fillStyle = emis && k ? sh(col, k) : col; t.fillRect(x, y, w, h); };
        const A = (x, y, w, h, col) => { if (!emis) { t.fillStyle = col; t.fillRect(x, y, w, h); } };
        const grad = (y, h, c0, c1) => { const g = t.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
        const G = (x, y, w, h, c0, c1) => { t.fillStyle = emis ? '#000' : grad(y, h, c0, c1); t.fillRect(x, y, w, h); };
        const disc = (x, y, rx, ry, col, glow) => { t.fillStyle = emis && !glow ? '#000' : col; t.beginPath(); t.ellipse(x, y, rx, ry, 0, 0, 6.2832); t.fill(); };
        const poly = (p, col, glow) => { t.fillStyle = emis && !glow ? '#000' : col; t.beginPath(); t.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) t.lineTo(p[i], p[i + 1]); t.closePath(); t.fill(); };
        const line = (x0, y0, x1, y1, wd, col) => { t.strokeStyle = emis ? '#000' : col; t.lineWidth = wd; t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1); t.stroke(); };
        const speck = (n, a) => { for (let i = 0; i < n; i++) { const x = rnd() * 98, y = rnd() * 98, s = 1 + rnd() * 2.2; A(x, y, s, s, i & 1 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')'); } };
        const stripes = (x, y, w, h, n, c0, c1) => { for (let q = 0; q < n; q++) R(x + q * w / n, y, w / n + 0.2, h, q & 1 ? c1 : c0); };
        const hazard = (x, y, w, h) => {
            R(x, y, w, h, '#f2c230'); t.save(); t.beginPath(); t.rect(x, y, w, h); t.clip();
            for (let q = -Math.ceil(h / 6) - 1; q < w / 6 + 1; q++) poly([x + q * 6, y + h, x + q * 6 + 3, y + h, x + q * 6 + 3 + h, y, x + q * 6 + h, y], '#22252a');
            t.restore();
        };
        // «надпись»: ряд брусков разной ширины; glow — светится
        const glyphs = (x, y, w, h, col, glow) => { let p = x; while (p < x + w - 2) { const q = Math.min(x + w - p, 2.5 + rnd() * 5); if (glow) L(p, y, q - 1.2, h, col); else R(p, y, q - 1.2, h, col); p += q; } };

        // Окно: рама, стекло с бликом. Ночью часть окон горит; в проходе свечения остаются только они.
        const win = (x, y, w, h, o) => {
            o = o || {};
            const fw = o.fw == null ? 1.6 : o.fw, r1 = rnd(), r2 = rnd(), r3 = rnd(), fr = o.fr || '#ffffff';
            const on = night > 0 && r1 < night * (o.p || 1);
            const path = () => {
                t.beginPath();
                if (o.arch) { t.moveTo(x, y + h); t.lineTo(x, y + w / 2); t.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); t.lineTo(x + w, y + h); t.closePath(); }
                else if (o.round) t.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 6.2832);
                else t.rect(x, y, w, h);
            };
            if (o.shut) for (const sx of [x - fw - w * 0.3, x + w + fw]) { R(sx, y, w * 0.3, h, o.shut); for (let q = 1; q < 5; q++) A(sx, y + h * q / 5, w * 0.3, 0.7, 'rgba(0,0,0,0.25)'); }
            if (o.lintel) R(x - fw - 1.5, y - fw - 3.4, w + 2 * fw + 3, 3.4, o.sc || '#ffffff');
            if (fw > 0) { path(); t.lineWidth = fw * 2; t.strokeStyle = emis ? '#000' : fr; t.stroke(); }
            path();
            if (on) t.fillStyle = r2 < 0.55 ? '#ffe9a6' : r2 < 0.85 ? '#ffd07a' : '#dff3ff';
            else if (emis) t.fillStyle = '#000';
            else if (night > 0) t.fillStyle = grad(y, h, '#2c3d60', '#172038');
            else t.fillStyle = grad(y, h, o.g0 || '#9bd8ff', o.g1 || '#3f8fe8');
            t.fill();
            if (!emis) {
                t.save(); path(); t.clip();
                if (on) { t.fillStyle = 'rgba(255,255,255,0.45)'; t.fillRect(x, y, w, h * (0.12 + r3 * 0.38)); }
                else { t.fillStyle = 'rgba(255,255,255,' + (night > 0 ? 0.1 : 0.3) + ')'; t.beginPath(); t.moveTo(x + w * 0.1, y + h); t.lineTo(x + w * 0.5, y); t.lineTo(x + w * 0.72, y); t.lineTo(x + w * 0.32, y + h); t.fill(); }
                t.fillStyle = 'rgba(8,16,40,0.3)'; t.fillRect(x, y, w, Math.min(2.2, h * 0.14)); t.fillRect(x, y, Math.min(1.3, w * 0.1), h);
                t.restore();
            }
            const mc = o.mc || fr;
            if (o.mx) for (let q = 1; q <= o.mx; q++) R(x + w * q / (o.mx + 1) - 0.6, y, 1.2, h, mc);
            if (o.my) for (let q = 1; q <= o.my; q++) R(x, y + h * q / (o.my + 1) - 0.6, w, 1.2, mc);
            if (o.sill) { R(x - fw - 1.5, y + h + fw, w + 2 * fw + 3, 2.6, o.sc || '#ffffff'); A(x - fw - 1.5, y + h + fw + 2.6, w + 2 * fw + 3, 1.3, SHD); }
            if (o.snow) R(x - fw - 2, y + h + fw - 1.6, w + 2 * fw + 4, 3.4, '#ffffff');
        };
        // Ряд окон этажа с верхом y0; o — правки к стилю (cols, ww, wh, y, wo, skip)
        const row = (a, y0, o) => {
            o = o || {};
            const n = o.cols || a.cols, bw = 100 / n, w = bw * (o.ww || a.ww), h = 50 * (o.wh || a.wh);
            const y = y0 + (o.y != null ? o.y : (50 - h) * (a.wy != null ? a.wy : 0.45));
            for (let i = 0; i < n; i++) if (!o.skip || !o.skip(i)) win(i * bw + (bw - w) / 2, y, w, h, o.wo || a.wo);
            return { n, bw, w, h, y };
        };
        // Дверь: полотно с филёнками или стеклом
        const door = (x, y, w, h, col, glass) => {
            R(x - 1.6, y - 1.6, w + 3.2, h + 1.6, '#f4f2ee'); R(x, y, w, h, col);
            if (glass) win(x + w * 0.16, y + h * 0.08, w * 0.68, h * 0.44, { fw: 0, p: 2 });
            else { A(x + w * 0.14, y + h * 0.07, w * 0.72, h * 0.36, 'rgba(255,255,255,0.16)'); A(x + w * 0.14, y + h * 0.55, w * 0.72, h * 0.36, 'rgba(0,0,0,0.16)'); }
            R(x + w * 0.8, y + h * 0.5, 1.6, 1.8, '#e8c050');
        };

        // --- материалы стен: заливают весь тайл
        const mats = {
            plaster: (wc) => { R(0, 0, 100, 100, wc); speck(50, 0.035); },
            brick: (wc) => { R(0, 0, 100, 100, sh(wc, 1.2)); for (let r = 0; r < 20; r++) for (let q = -1; q < 8; q++) R(q * 12.5 + (r & 1 ? 6.25 : 0) + 0.4, r * 5 + 0.4, 11.7, 4.2, sh(wc, 0.88 + rnd() * 0.22)); },
            panel: (wc) => {
                for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) R(q * 33.34, r * 50, 33.34, 50, sh(wc, 0.95 + rnd() * 0.09));
                for (let q = 0; q <= 3; q++) A(q * 33.34 - 0.5, 0, 1, 100, 'rgba(0,0,0,0.17)');
                for (let r = 0; r <= 2; r++) A(0, r * 50 - 0.5, 100, 1, 'rgba(0,0,0,0.17)');
            },
            block: (wc) => {
                R(0, 0, 100, 100, sh(wc, 0.84));
                for (let r = 0; r < 10; r++) for (let q = -1; q < 5; q++) { const x = q * 25 + (r & 1 ? 12.5 : 0); R(x + 0.5, r * 10 + 0.5, 24, 9, sh(wc, 0.93 + rnd() * 0.13)); A(x + 0.5, r * 10 + 0.5, 24, 1.2, 'rgba(255,255,255,0.28)'); A(x + 0.5, r * 10 + 8.3, 24, 1.2, 'rgba(0,0,0,0.13)'); }
            },
            plank: (wc) => { for (let r = 0; r < 14; r++) { R(0, r * 7.15, 100, 7.2, sh(wc, 0.93 + rnd() * 0.12)); A(0, r * 7.15 + 6.2, 100, 0.95, 'rgba(0,0,0,0.24)'); } },
            ribs: (wc) => { R(0, 0, 100, 100, wc); for (let q = 0; q < 25; q++) { A(q * 4, 0, 1.3, 100, 'rgba(255,255,255,0.24)'); A(q * 4 + 2.6, 0, 1.4, 100, 'rgba(0,0,0,0.17)'); } },
            concrete: (wc) => { R(0, 0, 100, 100, wc); speck(46, 0.05); A(0, 49.5, 100, 1, 'rgba(0,0,0,0.14)'); A(49.5, 0, 1, 100, 'rgba(0,0,0,0.1)'); for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) A(q * 25 + 11.5, r * 25 + 11.5, 2, 2, 'rgba(0,0,0,0.2)'); },
            adobe: (wc) => { R(0, 0, 100, 100, wc); for (let i = 0; i < 9; i++) { const x = rnd() * 80, y = rnd() * 80; A(x, y, 14 + rnd() * 20, 8 + rnd() * 14, i & 1 ? 'rgba(255,255,255,0.07)' : 'rgba(90,60,20,0.06)'); } speck(40, 0.04); },
            timber: (wc) => { R(0, 0, 100, 100, wc); speck(30, 0.03); for (const y of [0, 48.2, 96.4]) R(0, y, 100, 3.6, '#5a3424'); for (const x of [0, 31.6, 64.8, 96.4]) R(x, 0, 3.6, 100, '#5a3424'); },
            ice: (wc) => { R(0, 0, 100, 100, wc); for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) { R(q * 25 + 0.6, r * 25 + 0.6, 23.8, 23.8, sh(wc, 0.96 + rnd() * 0.07)); A(q * 25 + 2, r * 25 + 2, 9, 1.4, 'rgba(255,255,255,0.7)'); A(q * 25 + 2, r * 25 + 2, 1.4, 7, 'rgba(255,255,255,0.7)'); } speck(40, 0.05); },
            tech: (wc) => { R(0, 0, 100, 100, wc); for (let q = 0; q <= 4; q++) { A(q * 25 - 0.5, 0, 1, 100, 'rgba(0,0,0,0.4)'); A(0, q * 25 - 0.5, 100, 1, 'rgba(0,0,0,0.4)'); } for (let q = 0; q < 4; q++) A(q * 25 + 1, 1, 23, 1, 'rgba(255,255,255,0.08)'); },
        };

        // --- стена B: окна с деталями
        const wallB = (a) => {
            const tr = a.tr || '#ffffff', wo = a.wo || {}, dk = a.dk || DARK;
            switch (a.B) {
                case 'balc': case 'gbalc':            // балконы: высокие окна и ограждение
                    for (const y0 of [0, 50]) {
                        const q = row(a, y0, { wh: 0.68, y: 7, wo: Object.assign({}, wo, { sill: 0, lintel: 0 }) });
                        for (let i = 0; i < q.n; i++) {
                            const x = i * q.bw + q.bw * 0.07, w = q.bw * 0.86, yb = y0 + 43;
                            if (a.B === 'gbalc') { A(x, yb - 11, w, 11, 'rgba(170,220,255,0.55)'); R(x, yb - 11.6, w, 1.2, tr); }
                            else { R(x, yb - 11, w, 1.4, dk); for (let b = 0; b <= 6; b++) R(x + b * (w - 1) / 6, yb - 11, 1, 11, dk); }
                            R(x - 1, yb, w + 2, 2.6, a.B === 'gbalc' ? '#f4f4f2' : tr === dk ? '#f4ece0' : tr); A(x - 1, yb + 2.6, w + 2, 1.4, SHD);
                        }
                    }
                    break;
                case 'loggia':                        // лоджии: ниша, окно в глубине, парапет
                    for (const y0 of [0, 50]) for (let i = 0; i < 3; i++) {
                        const x = i * 33.34 + 3;
                        G(x, y0 + 7, 27.3, 37, '#4a525e', '#2e343e');
                        win(x + 3, y0 + 10, 21.3, 19, { fw: 0 });
                        R(x, y0 + 30, 27.3, 14, sh(a.wc, 1.14)); R(x, y0 + 29, 27.3, 1.6, tr); A(x, y0 + 44, 27.3, 1.5, SHD);
                    }
                    break;
                case 'fins': row(a, 0); row(a, 50); for (let q = 0; q <= 3; q++) { R(q * 33.34 - 1.7, 0, 3.4, 100, tr); A(q * 33.34 + 1.7, 0, 1.6, 100, 'rgba(0,0,0,0.2)'); } break;
                case 'band':                          // пояс-спандрель между этажами
                    row(a, 0); row(a, 50); R(0, 43, 100, 14, sh(a.wc, 0.88)); A(0, 43, 100, 1, 'rgba(255,255,255,0.45)'); A(0, 56, 100, 1, 'rgba(0,0,0,0.25)');
                    for (let q = 1; q < 3; q++) A(q * 33.34 - 0.5, 43, 1, 14, 'rgba(0,0,0,0.2)');
                    break;
                case 'fire':                          // пожарная лестница
                    row(a, 0); row(a, 50);
                    for (const y0 of [0, 50]) { R(8, y0 + 42.5, 84, 1.8, dk); R(8, y0 + 33, 84, 1, dk); for (let b = 0; b <= 14; b++) R(8 + b * 5.94, y0 + 33, 0.9, 9.5, dk); }
                    line(34, 92.5, 60, 44, 1.5, dk); line(39, 92.5, 65, 44, 1.5, dk);
                    break;
                case 'shut': {                        // ставни и ящики с цветами
                    const sc = ['#3d6b58', '#35557a', '#8a3d3d', '#5a4a7a'][Math.floor(rnd() * 4)];
                    for (const y0 of [0, 50]) {
                        const q = row(a, y0, { wo: Object.assign({}, wo, { shut: sc }) });
                        for (let i = 0; i < q.n; i++) { const x = i * q.bw + (q.bw - q.w) / 2; R(x - 2, q.y + q.h + 4, q.w + 4, 3.2, '#7a5232'); for (let f = 0; f < 5; f++) disc(x + f * q.w / 4, q.y + q.h + 3.4, 2, 1.8, f & 1 ? '#e8504a' : '#4fae4a'); }
                    }
                    break;
                }
                case 'awn': {                         // маркизы над окнами
                    row(a, 0); const q = row(a, 50);
                    for (let i = 0; i < q.n; i++) { const x = i * q.bw + (q.bw - q.w) / 2 - 2; stripes(x, q.y - 6, q.w + 4, 5, 6, '#ffffff', '#8f96a0'); A(x, q.y - 1, q.w + 4, 1.4, SHD); }
                    R(0, 46, 100, 2.4, tr);
                    break;
                }
                case 'louver':                        // жалюзи вентиляции и трубы
                    row(a, 50);
                    for (const x of [7, 54]) { R(x, 9, 34, 30, '#8f979e'); for (let q = 0; q < 6; q++) R(x + 2, 11.5 + q * 4.6, 30, 2.4, '#4a5158'); }
                    G(45, 0, 5, 50, '#d9dde1', '#a9b0b8');
                    break;
                case 'stripe': {                      // цветная полоса и номер
                    row(a, 0);
                    const sc = ['#e8823a', '#3a7be0', '#d9483b', '#2e9e6b'][Math.floor(rnd() * 4)];
                    R(0, 60, 100, 15, sc); A(0, 60, 100, 1, 'rgba(255,255,255,0.35)'); A(0, 74, 100, 1, 'rgba(0,0,0,0.25)');
                    R(40, 63, 5, 9, '#ffffff'); R(48, 63, 12, 2.4, '#ffffff'); R(48, 69.6, 12, 2.4, '#ffffff'); R(48, 63, 2.6, 9, '#ffffff'); R(57.4, 63, 2.6, 9, '#ffffff');
                    break;
                }
                case 'signs':                         // неоновые вывески
                    row(a, 0, { skip: (i) => i === 0 }); row(a, 50, { skip: (i) => i === 0 || i === 3 });
                    R(4, 4, 15, 92, '#15151d'); for (let q = 0; q < 6; q++) L(7, 8 + q * 14.6, 9, 10.5, ['#ff5fd0', '#4ff0ff', '#ffe34f', '#ff5fd0', '#7dff6a', '#4ff0ff'][q]);
                    R(78, 54, 19, 40, '#15151d'); L(80, 57, 15, 2, '#ffe34f'); L(80, 89, 15, 2, '#ffe34f'); glyphs(80, 63, 15, 5, '#ff7a4f', true); glyphs(80, 72, 15, 5, '#4ff0ff', true); glyphs(80, 81, 15, 5, '#ff5fd0', true);
                    break;
                case 'lights':                        // гирлянды лампочек
                    row(a, 0); row(a, 50);
                    for (const y of [1, 48.4, 96.6]) { R(0, y - 1, 100, 4.4, '#8a1030'); for (let q = 0; q < 20; q++) L(q * 5 + 1.4, y, 2.2, 2.4, q & 1 ? '#fff6c8' : '#ffd24a'); }
                    break;
                case 'lattice': {                     // резные деревянные эркеры
                    for (const y0 of [0, 50]) {
                        const q = row(a, y0, { skip: (i) => i === 1 });
                        const x = q.bw + (q.bw - q.w) / 2 - 5, w = q.w + 10;
                        R(x, q.y - 3, w, q.h + 9, '#7a5232'); A(x + w, q.y - 1, 2, q.h + 9, SHD);
                        for (let f = 1; f < 6; f++) { A(x + f * w / 6, q.y - 1, 0.8, q.h + 5, 'rgba(0,0,0,0.35)'); A(x + 1, q.y - 1 + f * (q.h + 5) / 6, w - 2, 0.8, 'rgba(0,0,0,0.35)'); }
                        R(x - 1.5, q.y - 5, w + 3, 2.6, '#5a3a22'); R(x - 1.5, q.y + q.h + 5, w + 3, 2.6, '#5a3a22');
                    }
                    break;
                }
                case 'hazard':                        // усиленные плиты и разметка
                    row(a, 0);
                    R(8, 56, 84, 30, sh(a.wc, 0.9)); for (const x of [11, 86]) for (const y of [59, 81]) disc(x + 1.2, y + 1.2, 1.5, 1.5, '#555c52');
                    hazard(8, 88, 84, 6);
                    break;
                case 'icicle': {                      // сугробы и сосульки
                    for (const y0 of [0, 50]) { const q = row(a, y0); for (let i = 0; i < q.n; i++) { const x = i * q.bw + (q.bw - q.w) / 2; for (let f = 0; f < 4; f++) poly([x + f * q.w / 4, q.y + q.h + 3.6, x + f * q.w / 4 + 2.6, q.y + q.h + 3.6, x + f * q.w / 4 + 1.3, q.y + q.h + 6 + rnd() * 5], '#f4fbff'); } }
                    break;
                }
                case 'spandrel':                      // ар-деко: шевроны между этажами
                    row(a, 0); row(a, 50);
                    for (let q = 0; q < 3; q++) { const x = q * 33.34 + 7; R(x, 40, 19.3, 14, sh(a.wc, 0.8)); for (let f = 0; f < 3; f++) poly([x + 2, 52 - f * 4, x + 9.65, 46 - f * 4, x + 17.3, 52 - f * 4, x + 17.3, 50.4 - f * 4, x + 9.65, 44.4 - f * 4, x + 2, 50.4 - f * 4], '#d8a830'); }
                    break;
                case 'led':                           // световые полосы
                    row(a, 0); row(a, 50); L(0, 46, 100, 1.4, a.nl || '#6ff0ff'); L(0, 96, 100, 1.4, a.nl || '#6ff0ff'); for (let q = 0; q < 6; q++) L(6 + q * 16, 40, 6, 1.2, '#ffffff');
                    break;
                default: row(a, 0); row(a, 50);
            }
        };

        // --- стена C: акцентная секция
        const wallC = (a) => {
            const tr = a.tr || '#ffffff', wo = a.wo || {}, dk = a.dk || DARK, gl = { g0: wo.g0, g1: wo.g1 };
            switch (a.C) {
                case 'stair':                         // лестничная клетка: стеклянная полоса на оба этажа
                    win(39, 5, 22, 90, Object.assign({ fr: wo.fw === 0 ? tr : wo.fr || tr, fw: 1.4, my: 5 }, gl));
                    for (const y0 of [0, 50]) { win(9, y0 + 16, 17, 18, wo); win(74, y0 + 16, 17, 18, wo); }
                    break;
                case 'bay':                           // эркер
                    if (a.cols === 3) { row(a, 0, { skip: (i) => i === 1 }); row(a, 50, { skip: (i) => i === 1 }); }
                    A(73, 0, 3, 100, 'rgba(0,0,0,0.18)'); R(27, 0, 46, 100, sh(a.wc, 1.1));
                    for (const y0 of [0, 50]) { for (let q = 0; q < 3; q++) win(30.5 + q * 14, y0 + 9, 11, 30, Object.assign({ fr: wo.fr || tr, fw: 1, my: 1 }, gl)); R(25.5, y0 + 44, 49, 3, tr); A(25.5, y0 + 47, 49, 1.5, SHD); }
                    break;
                case 'bigarch':                       // большое арочное окно на два этажа
                    win(29, 12, 42, 80, Object.assign({ arch: 1, fr: wo.fr || tr, fw: 2, mx: 2, my: 3 }, gl));
                    for (const y0 of [0, 50]) { win(7, y0 + 17, 12, 20, wo); win(81, y0 + 17, 12, 20, wo); }
                    break;
                case 'vsign': {                       // вертикальная вывеска
                    const nl = a.nl || '#ff5fd0';
                    row(a, 0, { skip: (i) => i === 1 }); row(a, 50, { skip: (i) => i === 1 });
                    R(37, 3, 26, 94, '#15151d'); L(37, 3, 26, 1.3, nl); L(37, 95.7, 26, 1.3, nl); L(37, 3, 1.3, 94, nl); L(61.7, 3, 1.3, 94, nl);
                    for (let q = 0; q < 6; q++) L(43, 8 + q * 14.6, 14, 10.5, q & 1 ? '#ffffff' : nl);
                    break;
                }
                case 'vline': row(a, 0); row(a, 50); R(43, 0, 14, 100, sh(a.wc, 0.7)); L(48.4, 0, 3.2, 100, a.nl || '#9fd8ff'); break;
                case 'piers':                         // ар-деко: пилоны и окна-ленты на два этажа
                    for (let q = 0; q < 3; q++) { win(q * 33.34 + 9, 6, 15.3, 88, Object.assign({ fr: wo.fr, fw: 1, my: 6 }, gl)); R(q * 33.34 + 8, 44, 17.3, 11, sh(a.wc, 0.8)); poly([q * 33.34 + 10, 53, q * 33.34 + 16.7, 46, q * 33.34 + 23.3, 53], '#d8a830'); }
                    for (let q = 0; q <= 3; q++) { R(q * 33.34 - 4.5, 0, 9, 100, sh(a.wc, 1.12)); A(q * 33.34 + 4.5, 0, 1.6, 100, 'rgba(0,0,0,0.18)'); }
                    break;
                case 'screen':                        // экран во всю стену
                    R(6, 6, 88, 88, '#0e0e16');
                    L(9, 9, 82, 28, '#ff4f9a', 0.7); L(9, 37, 82, 26, '#5a4fff', 0.7); L(9, 63, 82, 28, '#2fd0e0', 0.7);
                    disc(34, 50, 16, 20, '#fff6c8', true); glyphs(56, 44, 30, 5, '#ffffff', true); glyphs(56, 53, 24, 4, '#ffffff', true);
                    break;
                case 'ad': {                          // рекламный щит на стене
                    row(a, 50);
                    const col = ['#e2473a', '#2f6fdb', '#2fa36b', '#f2a516', '#7a4fd0'][Math.floor(rnd() * 5)];
                    R(7, 6, 86, 36, '#f4f4f2'); L(9, 8, 82, 32, col, 0.45); disc(24, 24, 9, 11, '#ffffff', true); glyphs(38, 16, 46, 6, '#ffffff', true); glyphs(38, 27, 36, 4, '#ffffff', true);
                    break;
                }
                case 'porthole': for (const y0 of [0, 50]) for (let q = 0; q < 3; q++) win(q * 33.34 + 9.2, y0 + 13, 15, 22, { round: 1, fr: tr, fw: 2.2, p: wo.p }); break;
                case 'duct':                          // воздуховод и лестница
                    win(8, 14, 22, 0.4 * 50, wo); win(8, 64, 22, 0.4 * 50, wo);
                    G(44, 0, 16, 100, '#d9dde1', '#a9b0b8'); for (let q = 0; q < 5; q++) R(43, q * 20 + 8, 18, 2.2, '#858c94');
                    R(72, 0, 1.3, 100, dk); R(83, 0, 1.3, 100, dk); for (let q = 0; q < 14; q++) R(72, q * 7.2 + 2, 12, 1, dk);
                    break;
                case 'lat':                           // решётка-коси
                    for (const y0 of [0, 50]) { R(6, y0 + 8, 88, 34, '#eadfc8'); for (let q = 0; q < 22; q++) R(6 + q * 4.1, y0 + 8, 1.6, 34, dk); R(5, y0 + 6, 90, 2.4, dk); R(5, y0 + 41.6, 90, 2.4, dk); }
                    break;
                case 'woodbay':                       // деревянная вставка с узким окном
                    for (const y0 of [0, 50]) { win(5, y0 + 11, 20, 27, wo); win(75, y0 + 11, 20, 27, wo); }
                    R(30, 0, 40, 100, '#b88a5a'); for (let q = 1; q < 8; q++) A(30 + q * 5, 0, 0.8, 100, 'rgba(0,0,0,0.2)');
                    win(44, 8, 12, 84, { fr: dk, fw: 1, my: 3 });
                    break;
                default: row(a, 0); row(a, 50);
            }
        };

        // --- первый этаж: витрины, ворота, входы. Верхний этаж тайла — обычные окна и поясок сверху.
        const ground = (a, kind) => {
            const tr = a.tr || '#ffffff', dk = a.dk || DARK, wo = a.wo || {}, gl = { g0: wo.g0, g1: wo.g1 };
            const upper = () => { row(a, 0); R(0, 0, 100, 2.6, tr); A(0, 2.6, 100, 1.4, 'rgba(0,0,0,0.18)'); };
            const plinth = () => R(0, 94, 100, 6, sh(a.wc, 0.72));
            const slats = (x, y, w, h, col) => { R(x, y, w, h, col); for (let q = 1; q * 3.6 < h; q++) A(x, y + q * 3.6, w, 0.9, 'rgba(0,0,0,0.2)'); };
            upper();
            switch (kind) {
                case 'shop': case 'shop2': case 'neonshop': {
                    const neon = kind === 'neonshop', sc = neon ? '#17171f' : a.sc || ['#d9483b', '#2f6fdb', '#2e9e6b', '#e39a1c', '#7a55c7'][Math.floor(rnd() * 5)];
                    R(0, 47, 100, 10, sc); A(0, 57, 100, 1.5, 'rgba(0,0,0,0.25)');
                    glyphs(14, 50, 72, 4, neon ? '#ff5fd0' : a.sc ? '#e8c050' : '#ffffff', true);
                    if (kind === 'shop2') { door(8, 62, 18, 32, a.dc || '#5a6470', true); win(33, 62, 59, 26, { fr: dk, fw: 1.6, mx: 1, p: 2.5 }); R(31, 90, 63, 4, sh(a.wc, 0.8)); }
                    else { win(7, 62, 86, 27, { fr: dk, fw: 1.6, mx: 2, p: 2.5 }); R(5, 91, 90, 3, sh(a.wc, 0.8)); }
                    if (neon) { L(3, 59.2, 94, 1, '#4ff0ff'); L(3, 59.2, 1, 34, '#4ff0ff'); L(96, 59.2, 1, 34, '#4ff0ff'); }
                    plinth(); break;
                }
                case 'tdoor':                         // таунхаус: дверь и окно
                    R(8, 95, 26, 5, '#d8d4cc'); door(11, 60, 20, 35, a.dc || '#1f4e5a', false); win(13.5, 54, 15, 4.5, { fw: 0.8, fr: tr, p: 2 });
                    win(48, 60, 34, 24, Object.assign({}, wo, { mx: 1 })); plinth(); R(8, 95, 26, 5, '#d8d4cc');
                    break;
                case 'tgarden':                       // таунхаус: окно с цветами и подвальное окошко
                    win(28, 59, 44, 25, Object.assign({}, wo, { mx: 2 })); R(25, 88, 50, 4, '#7a5232'); for (let f = 0; f < 9; f++) disc(28 + f * 5.5, 87.4, 2.6, 2.2, f % 3 === 1 ? '#e8504a' : '#4fae4a');
                    plinth(); R(42, 95.4, 16, 3.4, dk);
                    break;
                case 'lobby':                         // стеклянный вестибюль
                    R(0, 49, 100, 4.5, dk); win(6, 56, 88, 38, Object.assign({ fr: dk, fw: 1, mx: 3, my: 1, p: 2.5 }, gl));
                    R(0, 53.5, 5, 46.5, tr); R(95, 53.5, 5, 46.5, tr); R(0, 96, 100, 4, sh(a.wc, 0.72));
                    break;
                case 'arcade': case 'souk':           // аркада
                    for (const x of [5, 53]) {
                        t.fillStyle = emis ? '#000' : grad(56, 40, '#4a4f5a', '#2a2e36'); t.beginPath(); t.moveTo(x, 96); t.lineTo(x, 77); t.arc(x + 21, 77, 21, Math.PI, 0); t.lineTo(x + 42, 96); t.closePath(); t.fill();
                        win(x + 6, 64, 30, 31, { arch: 1, fw: 1.3, fr: tr, mx: 1, p: 2.5 });
                    }
                    R(46.5, 58, 7, 38, tr); R(45, 74, 10, 2.4, tr);
                    if (kind === 'souk') { stripes(0, 48, 100, 8, 10, '#c8503a', '#f4e4c4'); A(0, 56, 100, 1.4, SHD); }
                    else { R(0, 47.5, 100, 3.4, tr); A(0, 50.9, 100, 1.3, SHD); }
                    plinth(); break;
                case 'gate': case 'blast': {          // ворота
                    const bl = kind === 'blast';
                    R(10, 53, 80, 43, dk); slats(12, 55, 76, 41, bl ? '#8d949a' : '#d3d8dc');
                    if (bl) { hazard(12, 55, 76, 6); R(49, 61, 2, 35, '#5a6066'); disc(50, 78, 6, 7, '#5a6066'); disc(50, 78, 3, 3.5, '#8d949a'); L(46.5, 47.5, 7, 4, '#ff5a2a'); }
                    else { hazard(12, 90, 76, 6); L(4, 56, 3.5, 4.5, '#ffe9a6'); }
                    R(0, 96, 100, 4, sh(a.wc, 0.72));
                    break;
                }
                case 'dock':                          // погрузочные ворота на рампе
                    for (const x of [8, 56]) { R(x - 1.5, 54.5, 39, 31, dk); slats(x, 56, 36, 28, '#d5d9dd'); R(x + 12, 58, 12, 5, '#3a7be0'); }
                    R(0, 84, 100, 16, '#9a9da2'); A(0, 84, 100, 1.4, 'rgba(255,255,255,0.3)'); for (const x of [3, 47.5, 93]) { R(x, 85, 4, 9, '#22252a'); R(x, 87, 4, 2, '#f2c230'); }
                    break;
                case 'hiwin':                         // глухой первый этаж цеха: трубы и вентрешётка
                    G(8, 50, 5, 50, '#d9dde1', '#a9b0b8'); G(8, 62, 44, 5, '#d9dde1', '#a9b0b8'); R(7, 60, 7, 2, '#858c94'); R(50, 61, 2, 7, '#858c94');
                    R(60, 68, 26, 16, dk); for (let q = 0; q < 4; q++) R(62, 70 + q * 3.6, 22, 1.8, '#8f979e');
                    plinth(); break;
                case 'noren':                         // раздвижные двери и занавес-норэн
                    R(6, 58, 88, 37, '#eadfc8'); for (let q = 0; q <= 16; q++) R(6 + q * 5.5, 58, 1, 37, dk); for (let q = 1; q < 4; q++) R(6, 58 + q * 9.25, 88, 1, dk); R(5, 56, 90, 2.6, dk);
                    R(12, 55, 62, 12, '#27408b'); for (let q = 1; q < 4; q++) R(12 + q * 15.5 - 0.5, 60, 1, 7, '#eadfc8'); for (let q = 0; q < 4; q++) disc(19.75 + q * 15.5, 60.5, 3.2, 3.2, '#f4f0e4');
                    R(82, 56, 9, 2, dk); L(83, 58, 7, 11, '#ff6a3a'); R(83, 58, 7, 1.4, dk); R(83, 67.6, 7, 1.4, dk);
                    plinth(); break;
                case 'marquee':                       // казино: козырёк с лампочками
                    R(2, 46, 96, 15, '#b01030'); for (let q = 0; q < 19; q++) { L(4 + q * 5, 47.5, 2.2, 2.2, q & 1 ? '#fff6c8' : '#ffd24a'); L(4 + q * 5, 57.5, 2.2, 2.2, q & 1 ? '#ffd24a' : '#fff6c8'); }
                    glyphs(18, 51, 64, 5, '#ffe27a', true);
                    win(18, 64, 64, 31, { fr: '#d8a830', fw: 1.8, mx: 3, p: 3, g0: '#6a7ab8', g1: '#2c3a78' }); R(38, 96, 24, 4, '#b01030');
                    break;
                case 'gwin': {                        // жилой первый этаж: окна и цоколь
                    row(a, 50, { wh: Math.min(0.46, a.wh), y: 12 }); plinth(); R(12, 95.6, 10, 3, dk); R(78, 95.6, 10, 3, dk);
                    break;
                }
                case 'colonnade':                     // колоннада
                    G(0, 53, 100, 43, '#2e3644', '#1c222c'); win(6, 58, 88, 36, Object.assign({ fw: 0, mx: 3, p: 2 }, gl));
                    for (let q = 0; q < 4; q++) { R(q * 25 + 9, 52, 7, 45, tr); A(q * 25 + 16, 52, 1.6, 45, 'rgba(0,0,0,0.25)'); }
                    R(0, 49, 100, 4, tr); R(0, 96, 100, 4, sh(a.wc, 0.72));
                    break;
                case 'garage':                        // гаражные ворота
                    R(11, 57, 78, 39, dk); slats(13, 59, 74, 37, '#ebebe9'); for (let q = 0; q < 4; q++) win(18 + q * 17, 62, 13, 5, { fw: 0, p: 0.6 });
                    R(0, 96, 100, 4, '#8a8c90');
                    break;
                case 'vending':                       // закрытая ставня и торговые автоматы
                    slats(6, 58, 54, 37, '#7a7890'); line(12, 84, 28, 70, 2, '#ff5fd0'); line(28, 70, 40, 86, 2, '#4ff0ff'); line(40, 86, 54, 66, 2, '#ffe34f');
                    R(65, 61, 14, 34, '#e8e8f0'); L(66.5, 63, 11, 14, '#9ff0ff'); R(81, 61, 14, 34, '#d04040'); L(82.5, 63, 11, 14, '#ffe0a0');
                    plinth(); break;
                default: {                            // 'door' — вход по стилю (a.D)
                    const dc = a.dc || '#6a4a3a';
                    switch (a.D) {
                        case 'glass':
                            R(22, 53, 56, 3.4, dk); win(31, 59, 38, 36, Object.assign({ fr: dk, fw: 1.4, mx: 1, p: 3 }, gl)); win(6, 60, 19, 33, Object.assign({ fr: dk, fw: 1.2, p: 2 }, gl)); win(75, 60, 19, 33, Object.assign({ fr: dk, fw: 1.2, p: 2 }, gl));
                            R(48, 76, 1.2, 6, '#e8e8e8'); R(50.8, 76, 1.2, 6, '#e8e8e8'); if (a.nl) L(22, 56.4, 56, 1.2, a.nl);
                            R(0, 96, 100, 4, sh(a.wc, 0.72)); break;
                        case 'steel':
                            R(34, 58, 32, 38, dk); R(36, 60, 28, 36, a.dc2 || '#6f7780'); win(44, 64, 12, 8, { fw: 0.8, fr: dk, p: 2 }); A(36, 88, 28, 8, 'rgba(0,0,0,0.2)'); R(60, 78, 2, 4, '#e8e8e8');
                            L(47, 53, 6, 3.4, '#ffe9a6'); R(72, 66, 15, 10, '#f2c230'); R(74, 68, 11, 1.6, DARK); R(74, 71.6, 8, 1.6, DARK); R(27, 74, 3.4, 5.4, DARK);
                            plinth(); R(32, 95, 36, 5, '#b8bcc0'); break;
                        case 'arch':
                            t.fillStyle = emis ? '#000' : tr; t.beginPath(); t.moveTo(30, 96); t.lineTo(30, 72); t.arc(50, 72, 20, Math.PI, 0); t.lineTo(70, 96); t.closePath(); t.fill();
                            t.fillStyle = emis ? '#000' : dc; t.beginPath(); t.moveTo(33.5, 96); t.lineTo(33.5, 72); t.arc(50, 72, 16.5, Math.PI, 0); t.lineTo(66.5, 96); t.closePath(); t.fill();
                            A(49.4, 56, 1.2, 40, 'rgba(0,0,0,0.35)'); for (const x of [38, 44, 56, 62]) for (const y of [70, 80, 90]) disc(x, y, 1, 1, '#e8c050');
                            win(9, 64, 12, 20, wo); win(79, 64, 12, 20, wo); L(24, 60, 2.6, 4, '#ffe9a6'); L(73.4, 60, 2.6, 4, '#ffe9a6');
                            plinth(); R(28, 95, 44, 5, '#d8d4cc'); break;
                        case 'slide':
                            R(22, 58, 56, 38, '#eadfc8'); for (let q = 0; q <= 8; q++) R(22 + q * 6.9, 58, 1, 38, dk); for (let q = 1; q < 4; q++) R(22, 58 + q * 9.5, 56, 1, dk); R(20, 55.6, 60, 2.6, dk); R(49, 58, 2, 38, dk);
                            R(24, 54, 52, 12, '#8a2a24'); for (let q = 1; q < 4; q++) R(24 + q * 13 - 0.5, 59, 1, 7, '#eadfc8'); disc(50, 60, 3.4, 3.4, '#f4f0e4');
                            L(8, 60, 7, 11, '#ff6a3a'); R(8, 60, 7, 1.4, dk); R(8, 69.6, 7, 1.4, dk); L(85, 60, 7, 11, '#ff6a3a'); R(85, 60, 7, 1.4, dk); R(85, 69.6, 7, 1.4, dk);
                            plinth(); break;
                        case 'tech':
                            R(28, 55, 44, 41, '#151a24'); L(28, 55, 44, 1.3, a.nl || '#6ff0ff'); L(28, 55, 1.3, 41, a.nl || '#6ff0ff'); L(70.7, 55, 1.3, 41, a.nl || '#6ff0ff');
                            win(32, 59, 17, 37, { fw: 0, p: 3, g0: '#3f6688', g1: '#1c2c44' }); win(51, 59, 17, 37, { fw: 0, p: 3, g0: '#3f6688', g1: '#1c2c44' });
                            L(8, 70, 12, 1.4, a.nl || '#6ff0ff'); L(80, 70, 12, 1.4, a.nl || '#6ff0ff'); R(0, 96, 100, 4, sh(a.wc, 0.72)); break;
                        case 'gold':
                            for (let q = 0; q < 11; q++) L(26 + q * 4.6, 53.4, 2.2, 2.2, q & 1 ? '#fff6c8' : '#ffd24a');
                            win(30, 58, 40, 38, { fr: '#d8a830', fw: 2.2, mx: 1, p: 3, g0: '#6a7ab8', g1: '#2c3a78' }); win(8, 62, 14, 26, wo); win(78, 62, 14, 26, wo);
                            R(36, 96, 28, 4, '#b01030'); break;
                        case 'portal':
                            R(24, 52, 52, 4.6, tr); poly([22, 52, 50, 43.5, 78, 52], tr); A(24, 56.6, 52, 1.4, SHD);
                            R(34, 58, 32, 38, dk); R(36, 60, 13.2, 36, dc); R(50.8, 60, 13.2, 36, dc); win(38, 62, 9.2, 12, { fw: 0, p: 2 }); win(52.8, 62, 9.2, 12, { fw: 0, p: 2 });
                            for (const x of [25, 68]) { R(x, 56, 7, 40, tr); A(x + 7, 56, 1.4, 40, SHD); R(x - 1, 56, 9, 2.4, tr); R(x - 1, 93.6, 9, 2.4, tr); }
                            win(7, 64, 12, 22, wo); win(81, 64, 12, 22, wo); plinth(); R(22, 95, 56, 5, '#d8d4cc'); break;
                        default:                      // 'wood'
                            R(33.4, 54.4, 33.2, 41.6, tr); win(37, 57, 26, 6.4, { fw: 0, p: 2.5 }); R(37, 65.4, 26, 30.6, dc);
                            A(40, 68, 9, 11, 'rgba(255,255,255,0.16)'); A(51, 68, 9, 11, 'rgba(255,255,255,0.16)'); A(40, 82, 9, 11, 'rgba(0,0,0,0.16)'); A(51, 82, 9, 11, 'rgba(0,0,0,0.16)'); R(59.4, 80, 1.8, 2, '#e8c050');
                            win(9, 62, 15, 22, wo); win(76, 62, 15, 22, wo); L(28, 60, 2.8, 4, '#ffe9a6');
                            plinth(); R(29, 95, 42, 5, '#d8d4cc');
                    }
                }
            }
        };

        // --- верх: окна и карниз
        const topT = (a) => {
            const tr = a.tr || '#ffffff', wo = a.wo || {}, kind = a.T;
            row(a, 50);
            if (kind === 'mansard') {                 // мансарда: скат с люкарнами
                G(0, 0, 100, 41, '#6a7280', '#535a66'); for (let r = 0; r < 7; r++) { A(0, r * 6 + 5, 100, 0.9, 'rgba(0,0,0,0.25)'); for (let q = 0; q < 13; q++) A(q * 8 + (r & 1 ? 4 : 0), r * 6, 0.8, 5, 'rgba(0,0,0,0.16)'); }
                for (let q = 0; q < 3; q++) { const x = q * 33.34 + 16.67; poly([x - 9, 14, x, 6, x + 9, 14], tr); R(x - 7.4, 14, 14.8, 23, tr); win(x - 5, 16.4, 10, 18, { fw: 0, my: 1, mc: tr }); }
                R(0, 40, 100, 4.4, tr); A(0, 44.4, 100, 1.8, SHD);
                return;
            }
            const hh = { cornice: 10, dentil: 13, parapet: 10, crenel: 12, eave: 9, fascia: 12, steps: 14, neonline: 9, snowcap: 9, crown: 8 }[kind] || 10;
            const wh = Math.min(a.wh, (50 - hh - 5) / 50);
            row(a, 0, { wh, y: hh + (50 - hh - 50 * wh) * 0.5 });
            switch (kind) {
                case 'dentil': R(0, 0, 100, 9, tr); A(0, 3.6, 100, 1, 'rgba(0,0,0,0.12)'); for (let q = 0; q < 20; q++) R(q * 5 + 1, 9, 3, 3, tr); A(0, 9, 100, 3.6, 'rgba(0,0,0,0.14)'); A(0, 12.6, 100, 1.6, SHD); break;
                case 'crenel': R(0, 0, 100, 11, sh(a.wc, 1.08)); for (let q = 0; q < 5; q++) R(q * 20 + 12, 0, 8, 6.4, sh(a.wc, 0.55)); A(0, 11, 100, 1.4, SHD); break;
                case 'eave': R(0, 0, 100, 5, '#3e4654'); for (let q = 0; q < 13; q++) R(q * 8 + 2.5, 5, 3, 3.2, tr); A(0, 5, 100, 3.2, 'rgba(0,0,0,0.2)'); A(0, 8.2, 100, 1.6, SHD); break;
                case 'fascia': G(0, 0, 100, 11, '#f2f5f8', '#cfd6de'); R(7, 3, 5, 5, '#3a7be0'); glyphs(15, 3.4, 30, 4.2, '#5a6470', false); A(0, 11, 100, 1.5, SHD); break;
                case 'steps': R(0, 0, 100, 13, sh(a.wc, 1.1)); for (let q = 0; q <= 3; q++) { R(q * 33.34 - 9, 0, 18, 3.4, sh(a.wc, 0.8)); R(q * 33.34 - 5.5, 3.4, 11, 3.2, sh(a.wc, 0.8)); } for (let q = 0; q < 3; q++) poly([q * 33.34 + 9.6, 12, q * 33.34 + 16.67, 5, q * 33.34 + 23.7, 12], '#d8a830'); R(0, 12.2, 100, 1.4, '#d8a830'); A(0, 13.6, 100, 1.4, SHD); break;
                case 'neonline': R(0, 0, 100, 8, sh(a.wc, 0.78)); L(0, 3, 100, 2.2, a.nl || '#ff5fd0'); A(0, 8, 100, 1.4, SHD); break;
                case 'snowcap': R(0, 0, 100, 5.4, '#ffffff'); for (let q = 0; q < 12; q++) { const x = rnd() * 96; poly([x, 5.2, x + 3.2, 5.2, x + 1.6, 8 + rnd() * 6], '#f4fbff'); } break;
                case 'crown': R(0, 0, 100, 7, tr); A(0, 7, 100, 1.4, SHD); break;
                case 'parapet': R(0, 0, 100, 9.4, sh(a.wc, 0.9)); R(0, 0, 100, 2.4, tr); A(0, 9.4, 100, 1.5, SHD); break;
                default: R(0, 0, 100, 4, tr); R(0, 4, 100, 5, sh(a.wc, 1.1)); A(0, 9, 100, 2, SHD);
            }
            void wo;
        };

        // --- глухая стена
        const blind = (a) => {
            const dk = a.dk || DARK, wo = a.wo || {};
            for (let i = 0; i < 4; i++) { const x = rnd() * 90, y = rnd() * 40; A(x, y, 2 + rnd() * 3, 30 + rnd() * 50, 'rgba(0,0,0,0.045)'); }
            switch (a.X) {
                case 'pipe': G(78, 0, 4.4, 100, '#c9cdd2', '#9aa0a8'); for (const y of [12, 46, 80]) R(77, y, 6.4, 2, '#7a8088'); R(16, 60, 18, 13, dk); for (let q = 0; q < 3; q++) R(18, 62 + q * 3.6, 14, 1.8, '#9aa0a8'); break;
                case 'ghost': A(12, 20, 76, 44, 'rgba(255,255,255,0.3)'); for (let r = 0; r < 3; r++) { let p = 18; while (p < 78) { const q = 3 + rnd() * 7; A(p, 27 + r * 11, q - 1.4, 6, 'rgba(60,30,20,0.4)'); p += q; } } break;
                case 'poster': for (let q = 0; q < 3; q++) { const col = ['#e2473a', '#2f6fdb', '#f2a516', '#2fa36b', '#7a4fd0'][Math.floor(rnd() * 5)]; R(8 + q * 29, 58, 24, 32, '#f4f4f2'); R(9.5 + q * 29, 59.5, 21, 29, col); disc(20 + q * 29, 70, 6, 7, '#ffffff'); R(13 + q * 29, 81, 14, 2.4, '#ffffff'); } break;
                case 'smallwin': win(14, 15, 13, 15, wo); win(73, 65, 13, 15, wo); G(46, 0, 4, 100, '#c9cdd2', '#9aa0a8'); break;
                case 'ivy': for (let i = 0; i < 46; i++) { const y = 100 - rnd() * rnd() * 100, x = 8 + rnd() * 34 + (100 - y) * 0.3; disc(x, y, 3 + rnd() * 3, 3 + rnd() * 3, ['#3f8f3a', '#4fae4a', '#357a32'][i % 3]); } break;
                case 'camo': for (let i = 0; i < 7; i++) { const x = rnd() * 80, y = rnd() * 80, w = 14 + rnd() * 20, h = 8 + rnd() * 14; poly([x, y + h * 0.3, x + w * 0.4, y, x + w, y + h * 0.4, x + w * 0.7, y + h, x + w * 0.2, y + h * 0.8], i & 1 ? sh(a.wc, 0.72) : sh(a.wc, 0.86)); } R(68, 78, 5, 11, dk); R(76, 78, 9, 2.4, dk); R(76, 86.6, 9, 2.4, dk); R(76, 78, 2.4, 11, dk); R(82.6, 78, 2.4, 11, dk); break;
                case 'acwall': for (let q = 0; q < 4; q++) { const x = 10 + (q & 1) * 44 + rnd() * 8, y = 12 + (q >> 1) * 46 + rnd() * 8; R(x, y, 20, 13, '#c8ccd4'); disc(x + 7, y + 6.5, 4.6, 4.6, '#4a5058'); R(x + 14, y + 3, 4, 7, '#8a909a'); line(x + 10, y + 13, x + 10 + rnd() * 6, 100, 0.9, '#22242c'); } break;
                case 'pattern': for (let r = 0; r < 5; r++) for (let q = 0; q < 5; q++) { const x = q * 20 + 10, y = r * 20 + 10; poly([x, y - 8, x + 8, y, x, y + 8, x - 8, y], a.pc || '#d8a830'); poly([x, y - 5, x + 5, y, x, y + 5, x - 5, y], sh(a.wc, 0.9)); } break;
                case 'hex': for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) { const x = q * 25 + (r & 1 ? 12.5 : 0), y = r * 25; A(x + 3, y + 3, 19, 19, 'rgba(255,255,255,0.06)'); L(x + 11.5, y + 11.5, 2, 2, a.nl || '#6ff0ff'); } break;
                case 'planks': mats.plank('#8a5a3c'); win(40, 30, 20, 16, wo); break;
                case 'beams': for (let q = 0; q < 8; q++) { R(q * 12.5 + 4, 16, 4.5, 4.5, '#6a4a30'); A(q * 12.5 + 4, 20.5, 4.5, 3, SHD); } t.fillStyle = emis ? '#000' : sh(a.wc, 0.62); t.beginPath(); t.moveTo(42, 78); t.lineTo(42, 62); t.arc(50, 62, 8, Math.PI, 0); t.lineTo(58, 78); t.closePath(); t.fill(); break;
                case 'gpanel': for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) { G(q * 33.34 + 1.2, r * 50 + 1.2, 31, 47.6, wo.g0 || '#9bd8ff', wo.g1 || '#3f8fe8'); A(q * 33.34 + 1.2, r * 50 + 1.2, 31, 47.6, 'rgba(255,255,255,0.25)'); } break;
                default: break;
            }
        };
        const facade = (a, role) => {
            mats[a.mat](a.wc);
            if (role === 0) { row(a, 0); row(a, 50); }
            else if (role === 1) wallB(a);
            else if (role === 2) wallC(a);
            else if (role === 3) ground(a, a.G);
            else if (role === 4) ground(a, 'door');
            else if (role === 5) topT(a);
            else if (role === 6) blind(a);
            else ground(a, a.E);
        };

        // --- крыши, изнанка, материалы деталей
        const gravel = (col) => { R(0, 0, 100, 100, col); speck(150, 0.07); A(0, 49.6, 100, 0.8, 'rgba(0,0,0,0.07)'); A(49.6, 0, 0.8, 100, 'rgba(0,0,0,0.07)'); };
        const sign = (bg, fg, kind) => {
            R(0, 0, 100, 100, '#f4f4f2'); L(4, 6, 92, 88, bg, 0.5);
            if (kind === 0) { disc(22, 50, 12, 26, fg, true); glyphs(40, 30, 50, 16, fg, true); glyphs(40, 56, 38, 12, fg, true); }
            else if (kind === 1) { glyphs(12, 26, 76, 22, fg, true); L(12, 58, 76, 5, fg); glyphs(24, 68, 52, 10, fg, true); }
            else { poly([14, 76, 28, 22, 42, 76], fg, true); glyphs(50, 30, 40, 16, fg, true); glyphs(50, 56, 30, 12, fg, true); }
        };
        const neonSign = (c1, c2) => {
            R(0, 0, 100, 100, '#14141c');
            for (const [x, y, w, h] of [[5, 5, 90, 3], [5, 92, 90, 3], [5, 5, 3, 90], [92, 5, 3, 90]]) L(x, y, w, h, c1);
            glyphs(16, 22, 68, 20, c2, true); glyphs(22, 54, 56, 16, c1, true);
        };
        const misc = {
            roof: () => gravel('#b9bcc0'),
            roof_dark: () => { R(0, 0, 100, 100, '#5e646c'); speck(90, 0.06); for (let q = 1; q < 4; q++) A(0, q * 25, 100, 0.9, 'rgba(0,0,0,0.16)'); },
            roof_vent: () => { gravel('#b9bcc0'); disc(37, 41, 18, 18, 'rgba(0,0,0,0.2)', false); disc(35, 38, 17, 17, '#dfe3e7'); disc(35, 38, 12.5, 12.5, '#59616b'); R(33.6, 26, 2.8, 24, '#aab1b9'); R(23, 36.6, 24, 2.8, '#aab1b9'); disc(35, 38, 3, 3, '#dfe3e7'); R(63, 60, 24, 22, '#8a9098'); R(61, 57, 24, 22, '#e2e5e8'); for (let q = 0; q < 4; q++) R(63, 60 + q * 4.4, 20, 2, '#8a9098'); },
            roof_ac: () => { gravel('#b9bcc0'); for (const [x, y] of [[12, 14], [54, 54]]) { R(x + 2, y + 3, 34, 30, 'rgba(0,0,0,0.2)'); R(x, y, 34, 30, '#e4e7ea'); disc(x + 17, y + 15, 11, 11, '#4a5058'); disc(x + 17, y + 15, 8, 8, '#6a727c'); R(x + 16, y + 5, 2, 20, '#4a5058'); R(x + 7, y + 14, 20, 2, '#4a5058'); } G(46, 26, 4, 34, '#d9dde1', '#a9b0b8'); },
            roof_heli: () => { R(0, 0, 100, 100, '#4f555d'); speck(60, 0.05); disc(50, 50, 41, 41, '#f2c230'); disc(50, 50, 35, 35, '#4f555d'); R(33, 29, 9, 42, '#ffffff'); R(58, 29, 9, 42, '#ffffff'); R(33, 45.5, 34, 9, '#ffffff'); for (const [x, y] of [[3, 3], [92, 3], [3, 92], [92, 92]]) L(x, y, 5, 5, '#ff4a3a'); },
            roof_solar: () => { gravel('#b9bcc0'); for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) { const x = 6 + q * 30, y = 7 + r * 45; G(x, y, 27, 40, '#2f58a8', '#1b3570'); for (let f = 1; f < 3; f++) A(x + f * 9, y, 0.8, 40, 'rgba(255,255,255,0.35)'); for (let f = 1; f < 4; f++) A(x, y + f * 10, 27, 0.8, 'rgba(255,255,255,0.35)'); A(x, y, 27, 5, 'rgba(255,255,255,0.14)'); } },
            roof_green: () => { R(0, 0, 100, 100, '#cfc8ba'); R(5, 5, 90, 90, '#6dbb5a'); for (let i = 0; i < 16; i++) disc(10 + rnd() * 80, 10 + rnd() * 80, 4 + rnd() * 5, 4 + rnd() * 5, ['#4f9f48', '#86cc6a', '#5fae52'][i % 3]); R(44, 5, 12, 90, '#e0d8c8'); for (let i = 0; i < 8; i++) disc(10 + rnd() * 80, 10 + rnd() * 80, 1.6, 1.6, i & 1 ? '#ffd24a' : '#ff7a9a'); },
            roof_pool: () => { R(0, 0, 100, 100, '#d9c9a8'); for (let q = 1; q < 10; q++) A(0, q * 10, 100, 0.8, 'rgba(0,0,0,0.12)'); R(12, 20, 62, 60, '#f4f4f2'); G(15, 23, 56, 54, '#5fd4f0', '#2fa8e0'); for (let q = 0; q < 5; q++) A(20 + q * 9, 30 + (q & 1) * 20, 14, 1.4, 'rgba(255,255,255,0.5)'); for (const y of [22, 46, 70]) { R(80, y, 12, 5, '#ffffff'); R(80, y, 3.4, 5, '#e8504a'); } },
            roof_deck: () => { for (let r = 0; r < 12; r++) { R(0, r * 8.34, 100, 8.4, sh('#c79a6a', 0.92 + rnd() * 0.14)); A(0, r * 8.34 + 7.6, 100, 0.8, 'rgba(0,0,0,0.25)'); } for (const [x, y] of [[6, 6], [80, 6], [6, 80]]) { R(x, y, 14, 14, '#8a5a3c'); disc(x + 7, y + 7, 6, 6, '#4fae4a'); } disc(62, 62, 12, 12, '#f4f4f2'); disc(62, 62, 3, 3, '#e8504a'); },
            roof_glass: () => { R(0, 0, 100, 100, '#dfe6ec'); for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) win(q * 33.34 + 2.4, r * 33.34 + 2.4, 28.6, 28.6, { fw: 0, p: 1.6 }); },
            roof_tile: () => { R(0, 0, 100, 100, '#c9c2ba'); for (let r = 0; r < 10; r++) { for (let q = -1; q < 10; q++) R(q * 10 + (r & 1 ? 5 : 0) + 0.4, r * 10, 9.2, 9.2, sh('#ece6de', 0.9 + rnd() * 0.14)); A(0, r * 10 + 8, 100, 2, 'rgba(0,0,0,0.2)'); A(0, r * 10, 100, 1.4, 'rgba(255,255,255,0.3)'); } },
            roof_metal: () => { R(0, 0, 100, 100, '#d6dade'); for (let q = 0; q < 8; q++) { A(q * 12.5, 0, 1.6, 100, 'rgba(255,255,255,0.5)'); A(q * 12.5 + 1.6, 0, 1.6, 100, 'rgba(0,0,0,0.22)'); } speck(30, 0.03); },
            roof_snow: () => { R(0, 0, 100, 100, '#f6faff'); for (let i = 0; i < 10; i++) A(rnd() * 80, rnd() * 80, 12 + rnd() * 20, 6 + rnd() * 10, 'rgba(150,190,230,0.12)'); speck(40, 0.03); },
            roof_sand: () => { R(0, 0, 100, 100, '#e6d6b4'); speck(100, 0.05); R(18, 30, 38, 24, '#b8503a'); R(21, 33, 32, 18, '#e8c890'); R(27, 38, 20, 8, '#3a6a8a'); disc(78, 22, 7, 7, '#a8643c'); disc(78, 22, 4, 4, '#4fae4a'); disc(74, 76, 6, 6, '#a8643c'); },
            roof_park: () => { R(0, 0, 100, 100, '#6a6e74'); speck(60, 0.05); for (let q = 0; q <= 4; q++) { R(q * 24.4 + 0.6, 6, 1.4, 36, '#e8e8e8'); R(q * 24.4 + 0.6, 58, 1.4, 36, '#e8e8e8'); } for (const [x, y, col] of [[5, 9, '#e04a3a'], [53.6, 9, '#3a7be0'], [29.4, 61, '#f2c230'], [78, 61, '#f4f4f2']]) { R(x, y, 16, 30, String(col)); R(Number(x) + 2, Number(y) + 6, 12, 7, '#22303c'); R(Number(x) + 2, Number(y) + 19, 12, 5, '#22303c'); } },
            roof_court: () => { R(0, 0, 100, 100, '#3f8f6a'); R(12, 8, 76, 84, '#3a78c0'); for (const [x, y, w, h] of [[12, 8, 76, 1.6], [12, 90.4, 76, 1.6], [12, 8, 1.6, 84], [86.4, 8, 1.6, 84], [12, 49.2, 76, 1.6], [49.2, 26, 1.6, 48], [22, 26, 56, 1.6], [22, 72.4, 56, 1.6]]) R(x, y, w, h, '#ffffff'); },
            inner: () => {                            // разлом: перекрытия, комнаты, арматура
                R(0, 0, 100, 100, '#7d766e'); speck(110, 0.08);
                for (const y0 of [0, 50]) {
                    for (const x of [5, 54]) { G(x, y0 + 9, 41, 36, '#4c4640', '#2c2826'); A(x, y0 + 9, 41, 12, ['rgba(120,160,200,0.2)', 'rgba(210,170,110,0.2)', 'rgba(170,200,150,0.2)'][Math.floor(rnd() * 3)]); R(x + 4 + rnd() * 20, y0 + 37, 10, 8, '#6a625a'); }
                    R(0, y0, 100, 8, '#a59e96'); A(0, y0 + 8, 100, 1.6, 'rgba(0,0,0,0.35)');
                    for (let q = 0; q < 9; q++) { const x = 4 + rnd() * 92; line(x, y0 + 7, x + (rnd() - 0.5) * 6, y0 + 12 + rnd() * 8, 0.8, '#8a4a2a'); }
                }
                for (let q = 0; q < 5; q++) { const x = rnd() * 90, y = rnd() * 80; line(x, y, x + 6 + rnd() * 10, y + 8 + rnd() * 12, 0.7, '#3a3632'); }
            },
            inner_floor: () => { R(0, 0, 100, 100, '#8f8880'); speck(90, 0.07); for (let q = 1; q < 4; q++) { A(q * 25, 0, 0.8, 100, 'rgba(0,0,0,0.2)'); A(0, q * 25, 100, 0.8, 'rgba(0,0,0,0.2)'); } for (let q = 0; q < 8; q++) { const x = rnd() * 86, y = rnd() * 86; R(x, y, 4 + rnd() * 8, 4 + rnd() * 6, sh('#a59e96', 0.8 + rnd() * 0.3)); } for (let q = 0; q < 4; q++) { const x = rnd() * 80, y = rnd() * 80; line(x, y, x + 14 + rnd() * 10, y + (rnd() - 0.5) * 20, 0.8, '#3a3632'); } },
            inner_dark: () => { R(0, 0, 100, 100, '#5a5550'); speck(60, 0.06); R(0, 20, 100, 7, '#4a4642'); R(0, 70, 100, 7, '#4a4642'); },
            m_plain: () => { R(0, 0, 100, 100, '#f4f4f2'); speck(30, 0.025); A(0, 0, 100, 2.4, 'rgba(255,255,255,0.6)'); A(0, 95, 100, 5, 'rgba(0,0,0,0.07)'); },
            m_trim: () => { R(0, 0, 100, 100, '#f6f6f4'); A(0, 0, 100, 8, 'rgba(255,255,255,0.7)'); A(0, 30, 100, 5, 'rgba(0,0,0,0.12)'); A(0, 62, 100, 7, 'rgba(0,0,0,0.16)'); A(0, 92, 100, 8, 'rgba(0,0,0,0.2)'); },
            m_metal: () => { G(0, 0, 100, 100, '#e3e7eb', '#b4bbc4'); for (let q = 1; q < 10; q++) A(q * 10, 0, 1.2, 100, 'rgba(0,0,0,0.12)'); },
            m_vent: () => { R(0, 0, 100, 100, '#c9ced4'); for (let r = 0; r < 8; r++) R(9, 10 + r * 10.4, 82, 5.4, '#474d55'); A(0, 0, 100, 4, 'rgba(255,255,255,0.4)'); },
            m_ac: () => { R(0, 0, 100, 100, '#e6e9ec'); disc(50, 50, 36, 36, '#3a4048'); disc(50, 50, 30, 30, '#5b636d'); R(47, 16, 6, 68, '#3a4048'); R(16, 47, 68, 6, '#3a4048'); disc(50, 50, 8, 8, '#c9ced4'); A(0, 0, 100, 5, 'rgba(255,255,255,0.5)'); },
            m_dark: () => { R(0, 0, 100, 100, '#30343c'); A(0, 0, 100, 6, 'rgba(255,255,255,0.14)'); A(0, 0, 6, 100, 'rgba(255,255,255,0.08)'); },
            m_wood: () => { for (let q = 0; q < 8; q++) { R(q * 12.5, 0, 12.6, 100, sh('#b07a4a', 0.9 + rnd() * 0.2)); A(q * 12.5 + 11.4, 0, 1.1, 100, 'rgba(0,0,0,0.3)'); } },
            m_tank: () => { for (let q = 0; q < 10; q++) { R(q * 10, 0, 10.1, 100, sh('#a8703f', 0.88 + rnd() * 0.22)); A(q * 10 + 9, 0, 1, 100, 'rgba(0,0,0,0.3)'); } R(0, 20, 100, 6, '#4a4f57'); R(0, 68, 100, 6, '#4a4f57'); },
            m_glass: () => { R(0, 0, 100, 100, '#eef2f6'); win(3, 3, 94, 94, { fw: 0, mx: 1, my: 1, p: 1.6 }); },
            m_rail: () => { R(0, 0, 100, 100, '#9aa4b0'); R(0, 0, 100, 12, '#f4f4f2'); for (let q = 0; q < 10; q++) R(q * 10 + 3, 12, 4, 64, '#f4f4f2'); R(0, 76, 100, 24, '#f4f4f2'); A(0, 76, 100, 3, 'rgba(0,0,0,0.15)'); },
            m_stone: () => { R(0, 0, 100, 100, '#eeeae2'); for (let q = 0; q < 6; q++) { A(q * 16.7 + 4, 8, 4, 84, 'rgba(0,0,0,0.13)'); A(q * 16.7 + 10, 8, 3, 84, 'rgba(255,255,255,0.55)'); } R(0, 0, 100, 7, '#f8f5ee'); R(0, 93, 100, 7, '#dcd6ca'); },
            m_gold: () => { G(0, 0, 100, 100, '#ffe48f', '#d49a1e'); poly([10, 100, 40, 0, 56, 0, 26, 100], 'rgba(255,255,255,0.35)'); },
            m_hazard: () => hazard(0, 0, 100, 100),
            m_brick: () => mats.brick('#cfc6bc'),
            m_plant: () => { R(0, 0, 100, 100, '#4f9f48'); for (let i = 0; i < 30; i++) disc(rnd() * 100, rnd() * 100, 6 + rnd() * 8, 6 + rnd() * 8, ['#3f8f3a', '#63b656', '#57a84c', '#7cc86a'][i % 4]); for (let i = 0; i < 7; i++) disc(rnd() * 100, rnd() * 100, 2.4, 2.4, i & 1 ? '#ffd24a' : '#ff8aa0'); },
            m_snow: () => { R(0, 0, 100, 100, '#ffffff'); for (let i = 0; i < 8; i++) A(rnd() * 80, rnd() * 80, 14 + rnd() * 20, 8 + rnd() * 10, 'rgba(150,190,230,0.14)'); },
            m_lamp: () => { L(0, 0, 100, 100, '#fff0b8'); A(0, 0, 100, 100, 'rgba(255,255,255,0.2)'); },
            m_red: () => L(0, 0, 100, 100, '#ff3a2a'),
            m_lantern: () => { L(0, 0, 100, 100, '#ff5a3a'); for (let q = 1; q < 6; q++) A(q * 16.7, 0, 1.4, 100, 'rgba(120,20,10,0.5)'); R(0, 0, 100, 9, '#2a2420'); R(0, 91, 100, 9, '#2a2420'); },
            m_clock: () => { R(0, 0, 100, 100, '#f0eadc'); disc(50, 50, 44, 44, '#3a3530'); disc(50, 50, 39, 39, '#fbf6e8'); for (let q = 0; q < 12; q++) { const an = q * Math.PI / 6; disc(50 + Math.cos(an) * 33, 50 + Math.sin(an) * 33, 2.2, 2.2, '#3a3530'); } line(50, 50, 50, 24, 3, '#3a3530'); line(50, 50, 68, 58, 3, '#3a3530'); disc(50, 50, 3.4, 3.4, '#b8902a'); },
            m_flag: () => { R(0, 0, 100, 100, '#ffffff'); R(0, 36, 100, 28, '#d8d8d8'); disc(50, 50, 12, 16, '#f2c230'); },
            m_screen: () => { R(0, 0, 100, 100, '#0e0e16'); L(4, 6, 92, 30, '#ff4f9a', 0.7); L(4, 36, 92, 28, '#5a4fff', 0.7); L(4, 64, 92, 30, '#2fd0e0', 0.7); disc(30, 50, 16, 30, '#fff6c8', true); glyphs(54, 40, 36, 10, '#ffffff', true); },
            m_pipe: () => { G(0, 0, 100, 100, '#e3e7eb', '#9ea6b0'); for (const x of [14, 50, 86]) R(x - 3, 0, 6, 100, '#7a828c'); },
            m_awn: () => { stripes(0, 0, 100, 100, 8, '#ffffff', '#9aa0a8'); A(0, 88, 100, 12, 'rgba(0,0,0,0.12)'); },
            m_awn_r: () => { stripes(0, 0, 100, 100, 8, '#ffffff', '#e2473a'); A(0, 88, 100, 12, 'rgba(0,0,0,0.12)'); },
            m_awn_b: () => { stripes(0, 0, 100, 100, 8, '#ffffff', '#3a7be0'); A(0, 88, 100, 12, 'rgba(0,0,0,0.12)'); },
            m_awn_g: () => { stripes(0, 0, 100, 100, 8, '#ffffff', '#3fae5a'); A(0, 88, 100, 12, 'rgba(0,0,0,0.12)'); },
            m_awn_y: () => { stripes(0, 0, 100, 100, 8, '#ffffff', '#f2b632'); A(0, 88, 100, 12, 'rgba(0,0,0,0.12)'); },
            m_sign1: () => sign('#e2473a', '#ffffff', 0), m_sign2: () => sign('#2f6fdb', '#ffffff', 1), m_sign3: () => sign('#2fa36b', '#fff6c8', 2),
            m_sign4: () => sign('#f2a516', '#3a2a10', 0), m_sign5: () => sign('#7a4fd0', '#ffffff', 1), m_sign6: () => sign('#1f2a3a', '#ffd24a', 2),
            m_neon1: () => neonSign('#ff4fd8', '#4ff0ff'), m_neon2: () => neonSign('#4ff0ff', '#ffe34f'), m_neon3: () => neonSign('#ffe34f', '#ff4fd8'), m_neon4: () => neonSign('#7dff6a', '#ffffff'),
            m_bill1: () => { R(0, 0, 100, 100, '#f4f4f2'); L(4, 6, 92, 88, '#ff9a3a', 0.4); disc(34, 56, 20, 34, '#ffe34f', true); L(4, 70, 92, 24, '#3a2a5a', 0.4); glyphs(58, 22, 34, 14, '#ffffff', true); },
            m_bill2: () => { R(0, 0, 100, 100, '#f4f4f2'); L(4, 6, 92, 88, '#2f6fdb', 0.4); L(14, 28, 30, 12, '#ffd24a'); L(12, 44, 34, 10, '#8a4a2a'); L(14, 58, 30, 12, '#ffd24a'); glyphs(54, 30, 36, 16, '#ffffff', true); glyphs(54, 56, 28, 12, '#ffffff', true); },
            m_bill3: () => { R(0, 0, 100, 100, '#f4f4f2'); L(4, 6, 92, 88, '#ff5f9a', 0.4); disc(70, 50, 18, 34, '#ffffff', true); stripes(8, 20, 40, 60, 5, '#ffffff', '#ff5f9a'); },
            m_bill4: () => { R(0, 0, 100, 100, '#f4f4f2'); L(4, 6, 92, 88, '#2fa36b', 0.4); poly([4, 94, 60, 6, 80, 6, 24, 94], '#ffe34f', true); glyphs(46, 60, 46, 16, '#ffffff', true); },
        };

        c.fillStyle = emis ? '#000' : '#c8c8c8'; c.fillRect(0, 0, canvas.width, canvas.height);
        c.imageSmoothingEnabled = false;
        this.TILES.forEach((name, n) => {
            rnd = KR.rng(7919 + n * 7907);
            t.setTransform(1, 0, 0, 1, 0, 0);
            t.fillStyle = emis ? '#000' : '#c8c8c8'; t.fillRect(0, 0, S, S);
            t.setTransform(S / 100, 0, 0, S / 100, 0, 0);
            const us = name.lastIndexOf('_'), role = us > 0 ? this.ROLES.indexOf(name.slice(us)) : 0, sty = role > 0 ? name.slice(0, us) : name;
            if (this.STYLES[sty] && role >= 0) facade(this.STYLES[sty].art, role);
            else if (misc[name]) misc[name]();
            // тайл в ячейку атласа; поля — растянутые края тайла
            const x = (n % COLS) * T, y = Math.floor(n / COLS) * T, p = pad;
            c.drawImage(tc, 0, 0, 1, 1, x, y, p, p); c.drawImage(tc, S - 1, 0, 1, 1, x + p + S, y, p, p);
            c.drawImage(tc, 0, S - 1, 1, 1, x, y + p + S, p, p); c.drawImage(tc, S - 1, S - 1, 1, 1, x + p + S, y + p + S, p, p);
            c.drawImage(tc, 0, 0, S, 1, x + p, y, S, p); c.drawImage(tc, 0, S - 1, S, 1, x + p, y + p + S, S, p);
            c.drawImage(tc, 0, 0, 1, S, x, y + p, p, S); c.drawImage(tc, S - 1, 0, 1, S, x + p + S, y + p, p, S);
            c.drawImage(tc, x + p, y + p);
        });
    },

    // ---------------------------------------------------------------------------------------------
    // Формы
    // ---------------------------------------------------------------------------------------------

    /** @type {Uint8Array} */ _sup: new Uint8Array(0),
    // Формы, у которых крыша всегда плоская (скатную не ставим)
    FLAT: ['step', 'spire', 'cyl', 'dome', 'pyramid', 'ring', 'twin', 'arch', 'tower', 'terrace', 'mall'],

    /**
     * Сколько кирпичей сетки F висит без опоры при данном span (правило — в шапке файла). fix — подпереть висящие:
     * заполнить клетки под ними до земли.
     */
    _hang(F, nx, ny, nz, span, fix) {
        const n = nx * nz;
        let S = this._sup, bad = 0;
        if (S.length < n * 2) S = this._sup = new Uint8Array(n * 2);
        for (let c = 0; c < n; c++) S[c] = F[c] ? 1 : 0;                                 // первый этаж стоит на земле
        for (let j = 1; j < ny; j++) {
            const o = j * n;
            for (let c = 0; c < n; c++) S[n + c] = F[o + c] && S[c] === 1 ? 1 : 0;         // 1 — колонна до земли
            for (let pass = 2; pass <= 1 + span; pass++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
                const c = k * nx + i, need = pass - 1;
                if (S[n + c] || !F[o + c]) continue;
                if ((i > 0 && S[n + c - 1] === need) || (i < nx - 1 && S[n + c + 1] === need) || (k > 0 && S[n + c - nx] === need) || (k < nz - 1 && S[n + c + nx] === need)) S[n + c] = pass;
            }
            for (let c = 0; c < n; c++) {
                if (F[o + c] && !S[n + c]) { bad++; if (fix) { for (let q = 0; q < j; q++) F[q * n + c] = 1; S[n + c] = 1; } }
                S[c] = S[n + c];
            }
        }
        return bad;
    },

    /** Число кирпичей плана без опоры (должно быть 0): колонна до земли или не дальше plan.span клеток вбок от неё. */
    hanging(plan) { return this._hang(plan.filled, plan.nx, plan.ny, plan.nz, plan.span || 1, false); },

    /**
     * Заполнить сетку формы: F[ci] = 1, где кирпич есть; K[ci] — вид клетки (1 — «кровля»: купол, пирамида, труба —
     * без окон; 2 — акцент: корона, переход, башня). Вариант формы — от seed. Возвращает span (см. ОПОРА в шапке).
     */
    _shape(shape, F, K, nx, ny, nz, seed) {
        const n = nx * nz, R = (/** @type {number} */ c) => KR.hash(seed, c);
        const put = (i0, i1, j0, j1, k0, k1, v, kd) => {
            i0 = Math.max(0, i0); j0 = Math.max(0, j0); k0 = Math.max(0, k0); i1 = Math.min(nx, i1); j1 = Math.min(ny, j1); k1 = Math.min(nz, k1);
            for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) { const ci = (j * nz + k) * nx + i; F[ci] = v; K[ci] = v ? kd : 0; }
        };
        // a — вдоль длинной стороны здания, b — поперёк: формы-«полосы» ложатся по длинной оси
        const sw = nz > nx, La = sw ? nz : nx, Wb = sw ? nx : nz;
        const pl = (a0, a1, j0, j1, b0, b1, v, kd) => { if (sw) put(b0, b1, j0, j1, a0, a1, v, kd); else put(a0, a1, j0, j1, b0, b1, v, kd); };
        const lx = (nx - 1) >> 1, lz = (nz - 1) >> 1;                 // наибольший отступ, при котором остаётся клетка
        const inset = (j0, j1, m, kd) => { const a = Math.min(m, lx), b = Math.min(m, lz); put(a, nx - a, j0, j1, b, nz - b, 1, kd); };
        const all = () => put(0, nx, 0, ny, 0, nz, 1, 0);
        const round = (j, lim, kd) => {                               // круг в плане
            let any = false;
            for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const fx = (i + 0.5) / nx - 0.5, fz = (k + 0.5) / nz - 0.5; if (fx * fx + fz * fz <= lim) { const ci = (j * nz + k) * nx + i; F[ci] = 1; K[ci] = kd; any = true; } }
            return any;
        };
        let maxSpan = 1, flips = true;
        if (shape === 'twin' && La < 3) shape = 'step';
        switch (shape) {
            case 'step': {
                const t1 = [0.34, 0.42, 0.5][R(1) % 3], t2 = [0.66, 0.76, 0.86][R(2) % 3];
                let mode = R(3) % 4;
                if (mode === 0 && !lx && !lz) mode = 1;
                if (mode === 3 && !lx) mode = 2;
                for (let j = 0; j < ny; j++) {
                    const t = j / ny, s = t < t1 ? 0 : t < t2 ? 1 : 2;
                    if (mode === 0) inset(j, j + 1, s, 0);                                           // со всех сторон
                    else if (mode === 3) { const a = Math.min(s, lx); put(a, nx - a, j, j + 1, 0, nz, 1, 0); }   // только по ширине
                    else put(0, nx - Math.min(mode === 1 ? s : s >> 1, nx - 1), j, j + 1, 0, nz - Math.min(mode === 1 ? s >> 1 : s, nz - 1), 1, 0);   // к углу
                }
                break;
            }
            case 'spire': {
                const t1 = [0.3, 0.36, 0.44][R(1) % 3], t2 = [0.56, 0.62, 0.7][R(2) % 3], t3 = ny >= 4 ? [0.8, 0.86, 0.9][R(3) % 3] : 2;
                for (let j = 0; j < ny; j++) {
                    const t = j / ny;
                    if (t >= t3) put((nx - 1) >> 1, (nx >> 1) + 1, j, j + 1, (nz - 1) >> 1, (nz >> 1) + 1, 1, 2);     // игла
                    else inset(j, j + 1, t < t1 ? 0 : t < t2 ? 1 : 2, 0);
                }
                flips = false; break;
            }
            case 'cyl': {
                const rr = Math.min(nx, nz) === 3 ? 0.2 : 0.262, v = R(1) % 4, cap = v === 1 && ny >= 4 ? (ny >= 9 ? 2 : 1) : 0, pod = v === 2 && ny >= 4 ? 1 : 0;
                for (let j = 0; j < ny; j++) { if (j < pod) put(0, nx, j, j + 1, 0, nz, 1, 0); else round(j, j >= ny - cap ? rr * 0.42 : rr, j >= ny - cap ? 2 : 0); }
                flips = false; break;
            }
            case 'dome': {
                const m = Math.min(nx, nz), rr = m === 3 ? 0.2 : 0.262, cyl = m >= 3 && R(1) % 2 === 0, cap = m >= 3 ? Math.min(ny - 1, Math.max(1, m >> 1)) : 0;
                for (let j = 0; j < ny; j++) {
                    if (j >= ny - cap) { const q = (j - (ny - cap) + 1) / (cap + 1); round(j, rr * (1 - q * q), 1); }
                    else if (cyl) round(j, rr, 0); else put(0, nx, j, j + 1, 0, nz, 1, 0);
                }
                flips = false; break;
            }
            case 'pyramid': {
                const m = Math.min(nx, nz), v = R(1) % 3, flat = v === 1 && m >= 5 ? Math.max(1, (m >> 1) - 2) : 99;
                for (let j = 0; j < ny; j++) { let s = Math.floor(j * (m / 2) / ny); if (v === 2) s -= s & 1; inset(j, j + 1, Math.min(s, flat), 1); }
                flips = false; break;
            }
            case 'ring': {
                if (Math.min(nx, nz) < 5) { all(); if (nx >= 3 && nz >= 3) put(1, nx - 1, 0, ny, 1, nz - 1, 0, 0); flips = false; break; }
                const open = R(1) % 3 === 0, half = Math.max(1, Math.ceil(ny / 2));
                for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
                    const fx = (i + 0.5) / nx - 0.5, fz = (k + 0.5) / nz - 0.5, r2 = fx * fx + fz * fz;
                    if (r2 >= 0.085 && r2 <= 0.262 && (r2 > 0.165 || j < half) && !(open && fz > 0.3 && Math.abs(fx) < 0.16)) F[(j * nz + k) * nx + i] = 1;
                }
                break;
            }
            case 'pagoda': {
                const th = ny >= 5 ? 2 : 1, tiers = Math.ceil(ny / th), mm = Math.min(lx, lz);
                for (let j = 0; j < ny; j++) inset(j, j + 1, tiers > 1 ? Math.floor(Math.floor(j / th) * mm / (tiers - 1) + 0.3) : 0, 0);
                flips = false; break;
            }
            case 'hangar': {
                for (let j = 0; j < ny; j++) for (let b = 0; b < Wb; b++) { const f = (b + 0.5) / Wb - 0.5; if ((j + 0.5) / ny <= Math.sqrt(Math.max(0, 1 - 4 * f * f)) + 0.16) pl(0, La, j, j + 1, b, b + 1, 1, 0); }
                if (R(1) % 3 === 0 && Wb >= 3 && ny >= 2) pl(0, La, 1, ny, Wb - 1, Wb, 0, 0);            // пристройка в один этаж
                break;
            }
            case 'twin': {
                let a = Math.max(1, Math.floor(La * 0.36));
                if (La - 2 * a > 4) a = Math.ceil((La - 4) / 2);
                const low = R(1) % 3 === 0 && ny >= 5 ? Math.max(3, Math.round(ny * 0.72)) : ny;       // вторая башня ниже
                pl(0, a, 0, ny, 0, Wb, 1, 0); pl(La - a, La, 0, low, 0, Wb, 1, 0);
                if (R(2) % 3 === 0 && ny >= 5) pl(0, La, 0, 1, 0, Wb, 1, 0);                             // общий подиум
                if (ny >= 4) {                                                                           // переходы
                    const c0 = (Wb - 1) / 2, hw = Math.max(0.5, Wb * 0.2), b0 = Math.ceil(c0 - hw), b1 = Math.floor(c0 + hw) + 1;
                    const bj = Math.min(low - 2, Math.max(1, Math.floor(ny * [0.45, 0.55, 0.3][R(3) % 3])));
                    pl(a, La - a, bj, bj + 2, b0, b1, 1, 2);
                    if (ny >= 9 && R(4) % 2 === 0 && low - 2 > bj + 3) pl(a, La - a, low - 2, low - 1, b0, b1, 1, 2);
                }
                maxSpan = 3; break;
            }
            case 'lshape': {
                all();
                let qx = nx >> 1, qz = nz >> 1;
                if (qx && qz) {
                    if (nx >= 5 && nz >= 5 && R(1) % 2) { qx = nx - 2; qz = nz - 2; }                    // тонкие крылья
                    put(nx - qx, nx, 0, ny, nz - qz, nz, 0, 0);
                    if (R(2) % 3 === 0 && ny >= 2) put(nx - qx, nx, Math.max(1, ny - (ny >= 5 ? 2 : 1)), ny, 0, nz - qz, 0, 0);   // крыло пониже
                }
                break;
            }
            case 'arch': {
                if (La < 3 || ny < 2) { all(); break; }
                let leg = Math.max(1, La >> 2);
                if (La - 2 * leg > 6) leg = Math.ceil((La - 6) / 2);
                const beam = Math.max(1, ny >> 2);
                pl(0, leg, 0, ny, 0, Wb, 1, 0); pl(La - leg, La, 0, ny, 0, Wb, 1, 0); pl(leg, La - leg, ny - beam, ny, 0, Wb, 1, 2);
                if (La - 2 * leg >= 5 && R(1) % 2) pl(La >> 1, (La >> 1) + 1, 0, ny, 0, Wb, 1, 0);       // средняя опора
                maxSpan = 3; flips = false; break;
            }
            case 'tower': {
                all();
                const pod = ny >= 7 ? 2 : ny >= 4 ? 1 : 0, cr = ny >= 8 ? 2 : ny >= 4 ? 1 : 0;
                let v = R(1) % 4;
                if (v === 1 && (nx < 3 || nz < 3)) v = 0;
                if (v === 0 && pod && (nx >= 3 || nz >= 3)) {                                            // подиум и узкий ствол
                    put(0, nx, pod, ny, 0, nz, 0, 0);
                    put(nx >= 4 ? 1 : 0, nx >= 3 ? nx - 1 : nx, pod, ny, nz >= 4 ? 1 : 0, nz >= 3 ? nz - 1 : nz, 1, 0);
                } else if (v === 1) { for (const i of [0, nx - 1]) for (const k of [0, nz - 1]) put(i, i + 1, pod, ny, k, k + 1, 0, 0); }   // срезанные углы
                else if (v === 3 && ny >= 4 && nx >= 2) { const S = Math.min(nx - 1, 3, ny - 2); for (let s = 1; s <= S; s++) put(nx - s, nx - s + 1, ny - (S - s + 1), ny, 0, nz, 0, 0); }   // скошенная вершина
                else if (v === 2 && cr) {                                                                // узкая корона
                    put(0, nx, ny - cr, ny, 0, nz, 0, 0);
                    if (lx || lz) inset(ny - cr, ny, 1, 2); else put(0, Math.max(1, nx - 1), ny - cr, ny, 0, nz, 1, 2);
                }
                for (let ci = (ny - cr) * n; ci < ny * n; ci++) if (F[ci]) K[ci] = 2;
                break;
            }
            case 'slab': {
                all();
                const v = R(1) % 6;
                if (v === 1 && ny >= 3 && La >= 4) { const e = La >= 8 ? 2 : 1, dq = ny >= 6 ? 2 : 1; pl(0, e, ny - dq, ny, 0, Wb, 0, 0); if (R(2) % 2) pl(La - e, La, ny - dq, ny, 0, Wb, 0, 0); }   // торцы пониже
                else if (v === 2 && ny >= 3 && La >= 5) { const c0 = Math.floor(La / 3); pl(0, c0, ny - 1, ny, 0, Wb, 0, 0); pl(La - c0, La, ny - 1, ny, 0, Wb, 0, 0); }                              // середина повыше
                else if (v === 3 && ny >= 2 && La >= 3) { for (const p of La >= 9 ? [La >> 2, La - 1 - (La >> 2)] : [La >> 1]) pl(p, p + 1, 0, Math.min(2, ny - 1), 0, Wb, 0, 0); }                   // проезды-арки
                else if (v === 4 && Wb >= 2 && La >= 4) { for (let a = 0; a < La; a++) { if ((a >> 1) & 1) pl(a, a + 1, 0, ny, 0, 1, 0, 0); else if (Wb >= 3) pl(a, a + 1, 0, ny, Wb - 1, Wb, 0, 0); } }   // секции со сдвигом
                else if (v === 5 && Wb >= 2 && La >= 3 && ny >= 3) { for (let a = 1; a < La - 1; a += 3) for (let j = 1; j < ny - 1; j += 2) pl(a, a + 1, j, j + 1, 0, 1, 0, 0); }                    // лоджии-ниши
                break;
            }
            case 'ushape': {
                all();
                if (nx >= 3 && nz >= 2) {
                    const a = Math.max(1, Math.round(nx / 3.2)), open = nz - Math.max(1, Math.round(nz / 3));
                    if (nx - 2 * a >= 1) {
                        put(a, nx - a, 0, ny, 0, open, 0, 0);
                        if (ny >= 3 && R(1) % 3 === 0) { put(0, a, ny - 1, ny, 0, open, 0, 0); put(nx - a, nx, ny - 1, ny, 0, open, 0, 0); }   // крылья пониже
                    }
                } else if (nz >= 3 && nx >= 2) {
                    const a = Math.max(1, Math.round(nz / 3.2));
                    if (nz - 2 * a >= 1) put(0, nx - Math.max(1, Math.round(nx / 3)), 0, ny, a, nz - a, 0, 0);
                }
                break;
            }
            case 'court': {
                all();
                if (nx >= 3 && nz >= 3) {
                    const tk = Math.min(nx, nz) >= 7 ? 2 : 1;
                    let v = R(1) % 4;
                    if (v === 3 && ny < 2) v = 0;
                    put(tk, nx - tk, v === 3 ? 1 : 0, ny, tk, nz - tk, 0, 0);                             // двор (v = 3 — накрыт первым этажом)
                    if (v === 1 && ny >= 2) put(nx >> 1, (nx >> 1) + 1, 0, Math.min(2, ny - 1), 0, tk, 0, 0);   // проезд во двор
                    if (v === 2 && ny >= 3) { put(tk, nx - tk, ny - 1, ny, 0, nz, 0, 0); put(0, nx, ny - 1, ny, tk, nz - tk, 0, 0); }   // угловые башни
                }
                break;
            }
            case 'house': {
                all();
                const v = R(1) % 4;
                if (v === 1 && nx >= 3 && ny >= 2) put(nx - 1, nx, 1, ny, 0, nz, 0, 0);                    // гараж-пристройка
                else if (v === 2 && nx >= 2 && ny >= 2) put(nx - (nx >> 1), nx, ny - 1, ny, 0, nz, 0, 0);  // полтора этажа
                else if (v === 3 && nz >= 3 && ny >= 2) put(0, nx, 1, ny, nz - 1, nz, 0, 0);               // веранда
                break;
            }
            case 'cross': {
                all();
                if (nx >= 3 && nz >= 3) {
                    const cx = Math.max(1, Math.floor(nx / 3)), cz = Math.max(1, Math.floor(nz / 3)), v = R(1) % 3, dq = v === 1 && ny >= 6 ? 2 : 1;
                    for (const i0 of [0, nx - cx]) for (const k0 of [0, nz - cz]) put(i0, i0 + cx, 0, ny, k0, k0 + cz, 0, 0);
                    if ((v === 1 && ny >= 3) || (v === 2 && ny >= 2)) {                                    // 1 — башня в середине, 2 — концы лучей пониже
                        const e = v === 1 ? cx : 1, f = v === 1 ? cz : 1;
                        put(0, e, ny - dq, ny, 0, nz, 0, 0); put(nx - e, nx, ny - dq, ny, 0, nz, 0, 0); put(0, nx, ny - dq, ny, 0, f, 0, 0); put(0, nx, ny - dq, ny, nz - f, nz, 0, 0);
                    }
                }
                flips = false; break;
            }
            case 'terrace': {
                const v = R(1) % 3, sw2 = La >= 6 && R(2) % 2 ? 2 : 1, lowest = v === 2 ? Math.ceil(ny / 2) : 1;
                for (let a = 0; a < La; a++) {
                    let s = Math.floor(a / sw2), sm = Math.ceil(La / sw2) - 1;
                    if (v === 1) { s = Math.floor(Math.abs(a - (La - 1) / 2) / sw2); sm = Math.floor((La - 1) / 2 / sw2); }      // вершина посередине
                    pl(a, a + 1, 0, sm > 0 ? Math.max(lowest, Math.round(ny - (ny - lowest) * s / sm)) : ny, 0, Wb, 1, 0);
                }
                break;
            }
            case 'mall': {
                const body = ny >= 3 ? ny - 1 : ny, v = R(1) % 3, m = nx >= 7 ? 2 : 1;
                put(0, nx, 0, body, 0, nz, 1, 0);
                if (nx >= 4 && nz >= 3 && body >= 2) put(m, nx - m, body - 1, ny, 1, nz - 1, 0, 0);       // атриум ниже на этаж
                if (ny >= 3) {                                                                             // «якоря» в полную высоту
                    const e = Math.max(1, nx >> 2);
                    if (v === 0) { const q = Math.max(1, Math.min(nx, nz) >> 2); for (const i0 of [0, nx - q]) for (const k0 of [0, nz - q]) put(i0, i0 + q, 0, ny, k0, k0 + q, 1, 2); }
                    else if (v === 1) { put(0, e, 0, ny, 0, nz, 1, 2); put(nx - e, nx, 0, ny, 0, nz, 1, 2); }
                    else put((nx - e) >> 1, ((nx - e) >> 1) + e, 0, ny, 0, Math.max(1, nz >> 2), 1, 2);
                }
                break;
            }
            case 'factory': {
                const hb = ny >= 4 ? ny - 2 : ny >= 2 ? ny - 1 : ny;
                pl(0, La, 0, hb, 0, Wb, 1, 0);                                                             // цех
                if (ny >= 2 && La >= 2) pl(0, Math.max(1, Math.round(La / 3.5)), 0, ny >= 4 ? ny - 1 : ny, 0, Wb, 1, 0);   // корпус повыше
                if (ny >= 3 && La >= 3 && R(1) % 2) pl(La - 1, La, 0, ny, Wb - 1, Wb, 1, 1);               // кирпичная труба
                break;
            }
            case 'church': {
                const hn = Math.max(1, Math.round(ny * 0.55)), ha = Wb >= 3 ? Math.max(1, hn - 1) : hn, tw = La >= 6 && Wb >= 4 ? 2 : 1, v = R(1) % 3;
                pl(0, La, 0, ha, 0, Wb, 1, 0); pl(0, La, 0, hn, Wb >= 3 ? 1 : 0, Wb >= 3 ? Wb - 1 : Wb, 1, 0);   // боковые нефы и главный
                if (La >= 5 && Wb >= 3) { const tp = Math.round(La * 0.62); pl(tp, tp + (La >= 8 ? 2 : 1), 0, hn, 0, Wb, 1, 0); }   // трансепт
                if (La >= 4 && Wb >= 3 && hn >= 2) pl(La - 1, La, hn - 1, hn, 0, Wb, 0, 0);                // апсида пониже
                if (v === 2 && Wb >= 4) { pl(0, 1, 0, ny, 0, 1, 1, 2); pl(0, 1, 0, ny, Wb - 1, Wb, 1, 2); }   // две башни
                else { const b0 = v === 1 ? 0 : (Wb - tw) >> 1; pl(0, tw, 0, ny, b0, b0 + tw, 1, 2); }      // башня с торца: по центру или в углу
                break;
            }
            default: {                                                                                     // 'box' и неизвестные формы
                all();
                const opt = [0, 0];
                if (ny >= 2 && n >= 4) opt.push(1, 1);
                if (ny >= 3 && nx >= 3) opt.push(2, 3);
                if (ny >= 3 && nx >= 3 && nz >= 2) opt.push(4);
                if (ny >= 2 && nx >= 3 && nz >= 3) opt.push(5);
                if (ny >= 4 && nx >= 3 && nz >= 3) opt.push(6);
                const v = opt[R(1) % opt.length], q = ny >= 5 ? 2 : 1;
                if (v === 1) {                                                                             // терраса: верх без угла или без полосы
                    if (nx <= 2 && nz <= 2) put(nx - 1, nx, ny - q, ny, 0, 1, 0, 0);
                    else if (R(2) % 2 && nz >= 2) put(0, nx, ny - q, ny, 0, 1, 0, 0);
                    else if (nx >= 2) put(nx - 1, nx, ny - q, ny, 0, nz, 0, 0);
                } else if (v === 2) {                                                                      // подиум и башня уже
                    const p = ny >= 6 ? 2 : 1, one = R(2) % 2;
                    put(0, nx, p, ny, 0, nz, 0, 0); put(one ? 0 : 1, nx - 1, p, ny, nz >= 3 && R(3) % 2 ? 1 : 0, nz, 1, 0);
                } else if (v === 3) put(nx >> 1, (nx >> 1) + 1, 0, ny >= 5 ? 2 : 1, 0, nz, 0, 0);          // проезд-арка
                else if (v === 4) { for (let i = 1; i < nx - 1; i += 2) for (let j = 1; j < ny - 1; j += 2) put(i, i + 1, j, j + 1, 0, 1, 0, 0); }   // лоджии-ниши
                else if (v === 5) { const e = nx >= 5 && nz >= 5 ? 2 : 1; put(nx - e, nx, ny >= 4 && R(2) % 2 ? ny >> 1 : 0, ny, 0, e, 0, 0); }      // срезанный угол
                else if (v === 6) { for (const i of [0, nx - 1]) for (const k of [0, nz - 1]) put(i, i + 1, ny - 1, ny, k, k + 1, 0, 0); }           // корона-крест
            }
        }
        // пустых этажей нет: этаж без клеток повторяет нижний (первый — заполнен целиком)
        for (let j = 0; j < ny; j++) {
            let any = false;
            for (let c = 0; c < n && !any; c++) any = F[j * n + c] === 1;
            if (!any) for (let c = 0; c < n; c++) { F[j * n + c] = j ? F[(j - 1) * n + c] : 1; K[j * n + c] = j ? K[(j - 1) * n + c] : 0; }
        }
        // зеркала: тот же план в четырёх положениях
        const fx = flips && (R(90) & 1) === 1, fz = flips && (R(91) & 1) === 1;
        if (fx || fz) {
            const F2 = F.slice(), K2 = K.slice();
            for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const s = (j * nz + (fz ? nz - 1 - k : k)) * nx + (fx ? nx - 1 - i : i), ci = (j * nz + k) * nx + i; F[ci] = F2[s]; K[ci] = K2[s]; }
        }
        // опора: мостам — span побольше, остальное висящее подпирается
        let span = 1;
        while (span < maxSpan && this._hang(F, nx, ny, nz, span, false) > 0) span++;
        this._hang(F, nx, ny, nz, span, true);
        return span;
    },

    /** Заполнена ли клетка (i, j, k) у формы (вариант — от seed). Готовый план отдаёт то же в plan.filled. */
    filled(shape, i, j, k, nx, ny, nz, seed) {
        const key = shape + '|' + nx + '|' + ny + '|' + nz + '|' + (seed >>> 0);
        if (this._fk !== key) { this._fg = new Uint8Array(nx * ny * nz); this._shape(shape, this._fg, new Uint8Array(nx * ny * nz), nx, ny, nz, seed >>> 0); this._fk = key; }
        return this._fg[(j * nz + k) * nx + i] === 1;
    },

    _mul(c, k) { return (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k)); },
    _mix(a, b, t) { const u = 1 - t; return (Math.round(((a >> 16) & 255) * u + ((b >> 16) & 255) * t) << 16) | (Math.round(((a >> 8) & 255) * u + ((b >> 8) & 255) * t) << 8) | Math.round((a & 255) * u + (b & 255) * t); },

    // ---------------------------------------------------------------------------------------------
    // План здания
    // ---------------------------------------------------------------------------------------------

    /**
     * План здания по маркеру карты def = { name: 'b-<форма>-<стиль>-<N>', x, y, rot: [0, курс°, 0], scale: [ширина/100, высота/100, глубина/100] }.
     * opts.cell — желаемый размер кирпича в плане (по уровню графики). Возвращает:
     *   x, z, yaw (рад), w, d, h, nx, ny, nz, cw, cd, ch — сетка; shape, style, hp — прочность кирпича; seed;
     *   filled: Uint8Array(nx·ny·nz) — 1, где кирпич есть;  inner — тайл изнанки (грани между кирпичами);
     *   tintOf(ci) -> 0xRRGGBB — оттенок кирпича (умножает тайл);
     *   tiles(ci, out) -> out[6] — тайлы граней кирпича: +X, −X, +Z, −Z, верх, низ. У грани, закрытой соседом, — изнанка
     *     (боковая — разлом с перекрытиями, верх — пол, низ — потолок): её видно, когда соседа разрушат;
     *   parts: [{ cell, kind: 'box' | 'wedge', x0, y0, z0, x1, y1, z1, tile, tint, high? }] — декор, приклеенный к кирпичу cell:
     *     исчезает вместе с ним, на столкновения и опору не влияет. Каждая грань детали — тайл tile целиком с оттенком tint.
     *     wedge — клин: верх понижается от стороны high (0: +X, 1: −X, 2: +Z, 3: −Z) до y0 на противоположной.
     * Необязательные поля (потребитель может их не знать):
     *   span — на сколько клеток вбок кирпич держится от колонны, стоящей до земли (нет поля — 1; у мостов и арок 2–3);
     *   topTint(ci) -> 0xRRGGBB — оттенок ОТКРЫТОЙ верхней грани (крыша не красится в цвет стен); без него — tintOf(ci).
     */
    plan(def, opts) {
        const D = Math.PI / 180, CH = this.BRICK_H, cell = (opts && opts.cell) || this.CELL;
        const names = String(def.name).split('-');
        const shape = names[1] || 'box', style = this.STYLES[names[2]] ? names[2] : 'concrete', info = this.STYLES[style];
        const sc = def.scale || [2, 2, 2];
        const w = Math.max(70, sc[0] * 100), d = Math.max(70, sc[2] * 100), h = Math.max(CH, Math.round(sc[1] * 100 / CH) * CH);
        const nx = Math.max(1, Math.round(w / cell)), nz = Math.max(1, Math.round(d / cell)), ny = Math.max(1, Math.round(h / CH));
        const seed = KR.hash(Math.round(def.x), Math.round(def.y)), N = nx * ny * nz;
        const filled = new Uint8Array(N), kind = new Uint8Array(N), T = new Uint16Array(N * 6), tint = new Int32Array(N), ttop = new Int32Array(N);
        const span = this._shape(shape, filled, kind, nx, ny, nz, seed);
        /** @type {any} */
        const g = { shape, style, info, seed, w, d, h, nx, ny, nz, cw: w / nx, cd: d / nz, ch: CH, filled, kind, T, tint, ttop, top: new Uint8Array(nx * nz), parts: [] };
        this._dress(g);
        this._decor(g);
        return {
            x: def.x, z: def.y, yaw: ((def.rot ? def.rot[1] : 0) || 0) * D, w, d, h, nx, ny, nz, cw: w / nx, cd: d / nz, ch: CH,
            shape, style, hp: info.hp, seed, filled, inner: this._ix.inner, span,
            tintOf(ci) { return tint[ci]; },
            topTint(ci) { return ttop[ci]; },
            tiles(ci, out) { const o = ci * 6; out[0] = T[o]; out[1] = T[o + 1]; out[2] = T[o + 2]; out[3] = T[o + 3]; out[4] = T[o + 4]; out[5] = T[o + 5]; return out; },
            parts: g.parts,
        };
    },

    // Раскладка: какой тайл на какой грани и оттенки кирпичей. Пишет g.T, g.tint, g.ttop и решения о крыше.
    _dress(g) {
        const { nx, ny, nz, filled: F, kind: K, top, T, tint, ttop, seed, info, shape, style } = g, n = nx * nz, ix = this._ix, st = this._st[style];
        const R = (/** @type {number} */ c) => KR.hash(seed, c), cls = info.cls, tl = info.tints;
        let hmax = 0, cols = 0, full = true, peak = 0, best = 1e9;
        for (let c = 0; c < n; c++) { let tp = 0; for (let j = ny - 1; j >= 0; j--) if (F[j * n + c]) { tp = j + 1; break; } top[c] = tp; if (tp > hmax) hmax = tp; if (tp) cols++; }
        for (let c = 0; c < n; c++) {
            if (top[c] !== hmax) { full = false; continue; }
            const dx = (c % nx) - (nx - 1) / 2 + 0.01, dz = Math.floor(c / nx) - (nz - 1) / 2 + 0.02, q = dx * dx + dz * dz;
            if (q < best) { best = q; peak = c; }
        }
        g.hmax = hmax; g.cols = cols; g.peak = peak;
        const glassy = style === 'glass' || style === 'darkglass' || style === 'tech' || style === 'modern';

        // --- крыша: скатная (клинья-детали) или плоская
        let roofT = 'flat';
        if (shape === 'house' || shape === 'church' || shape === 'hangar') roofT = 'gable';
        else if (shape === 'factory') roofT = 'saw';
        else if (shape === 'pagoda') roofT = 'pagoda';
        else if (this.FLAT.indexOf(shape) < 0 && hmax <= 4 && R(50) % 100 < info.pitch) roofT = info.hip && full && cols <= 9 && R(51) % 2 ? 'hip' : 'gable';
        const rc = info.roofc || (shape === 'hangar' || shape === 'factory' ? [0xd8dce0, 0xb8c8d8, 0xc8d0c0] : [0xc85a40, 0x5a6474, 0x8a5444, 0x4a7a64, 0x44608a, 0x9a3a34]);
        g.roofT = roofT; g.roofCol = rc[R(52) % rc.length];
        g.roofTile = style === 'ice' ? ix.roof_snow : cls === 'ind' || shape === 'hangar' || shape === 'factory' ? ix.roof_metal : ix.roof_tile;
        const flat = roofT === 'flat', roofBase = ix[info.roof];

        // --- цвета
        const base = this._mul(tl[R(40) % tl.length], 0.94 + (R(41) % 9) / 100), av = R(42) % 3;
        const acc = av === 0 ? this._mul(base, 0.8) : av === 1 ? this._mix(base, 0xffffff, 0.5) : this._mix(base, tl[(R(40) + 1 + R(43) % (tl.length - 1)) % tl.length], 0.8);
        g.base = base; g.acc = acc;
        let capSide = st[6], capTop = roofBase, capTint = base;
        if (shape === 'dome') { capSide = glassy ? st[0] : ix.roof_metal; capTop = glassy ? ix.roof_glass : ix.roof_metal; capTint = glassy ? base : style === 'ice' ? 0xf4fbff : [0xe8c050, 0x6fc0b0, 0xf2f2f2, 0xc87850, 0x7aa0d0][R(38) % 5]; }
        else if (shape === 'pyramid') { capSide = glassy ? st[0] : ix.m_brick; capTop = glassy ? ix.roof_glass : ix.m_brick; }
        else if (shape === 'factory') { capSide = ix.m_brick; capTop = ix.roof_dark; capTint = 0xd07858; }
        g.capTile = capTop; g.capTint = capTint;
        const alongX = nx >= nz, secW = (alongX ? g.cw : g.cd) >= 80 ? 1 : 2, sec = [];
        for (let u = 0; u < Math.max(nx, nz); u++) { const s = Math.floor(u / secW); sec.push(this._mul(tl[KR.hash(seed, 700 + s) % tl.length], 0.95 + (KR.hash(seed, 800 + s) % 8) / 100)); }
        const sectFull = info.sect === 'full', sectGround = info.sect === 'ground';
        const gt = cls === 'com' && hmax >= 4 ? this._mix(base, 0xb8b4ac, 0.45) : -1;                 // цоколь высоких зданий
        const belt = hmax >= 8 && R(44) % 2 ? 3 + R(45) % 3 : 0, beltTint = this._mix(base, 0xffffff, 0.4);
        const crown = hmax >= 5 && ['step', 'spire', 'tower', 'twin', 'cyl'].indexOf(shape) >= 0 ? 1 : 0;

        // --- раскладка фасада
        const shops = cls === 'com' || (cls === 'res' && R(20) % 5 < 2);
        const pat = info.pat || [0, 1, 2, 3, 5], wm = pat[R(21) % pat.length], ph = R(22) & 1, gph = R(28) % 3;
        const doorI = nx & 1 ? nx >> 1 : (nx >> 1) - (R(23) & 1), doorK = nz & 1 ? nz >> 1 : (nz >> 1) - (R(24) & 1);
        const per = nx >= 6 ? 3 + (R(25) & 1) : 0, sideDoor = nz >= 3 && (R(26) & 1) === 0;
        const blindEnds = (shape === 'slab' || sectFull || info.blind === 1) && R(27) % 3 !== 0;       // глухие торцы
        const stripe = info.stripe && wm === 1 ? this._mix(base, tl[(R(40) + 2) % tl.length], 0.7) : -1;
        const side = (i, j, k, f, kd) => {
            if (kd === 1) return capSide;
            const front = f >= 2, u = front ? i : k, nU = front ? nx : nz;
            if (j === 0) {
                if (sectFull && front) return [st[3], st[4], st[3], st[7]][KR.hash(seed, 40 + u) % 4];     // у каждой секции свой вход
                if (front ? (u === doorI || (per > 0 && Math.abs(u - doorI) % per === 0)) : (sideDoor && u === doorK)) return st[4];
                if (cls === 'ind') return (u + gph) % 3 === 0 && front ? st[3] : st[7];
                if (cls === 'com') return (u + ph) & 1 ? st[7] : st[3];
                return shops && front ? st[3] : st[7];
            }
            if (!front && blindEnds) return st[6];
            if (j === top[k * nx + i] - 1) return st[5];
            if (info.blind === 2 && (u + j + gph) % 3 !== 0) return st[6];
            switch (wm) {
                case 1: return (u + ph) & 1 ? st[1] : st[0];
                case 2: return (j + ph) % 3 === 2 ? st[1] : st[0];
                case 3: return front && u === doorI ? st[2] : st[0];
                case 4: return nU >= 3 && (u === 0 || u === nU - 1) ? st[2] : st[1];
                case 5: return (u + j) & 1 ? st[1] : st[0];
                default: return st[0];
            }
        };

        // --- плоская крыша: что на ней
        let heli = -1, pool = -1, atTop = 0;
        for (let c = 0; c < n; c++) if (top[c] === hmax) atTop++;
        if (flat && cls === 'com' && hmax >= 8 && R(32) % 2 === 0) heli = peak;
        if (flat && atTop >= 4 && (style === 'hotel' || style === 'modern' || style === 'casino') && R(33) % 2 === 0) { for (let q = 0, c = R(33) % n; q < n; q++, c = (c + 1) % n) if (top[c] === hmax && c !== heli) { pool = c; break; } }
        const green = flat && ['modern', 'office', 'hotel', 'glass', 'panel', 'concrete'].indexOf(style) >= 0 && R(34) % 4 === 0;
        const solar = flat && ['modern', 'tech', 'office', 'panel', 'industrial', 'warehouse', 'metal', 'ice'].indexOf(style) >= 0 && R(35) % 3 === 0;
        const park = shape === 'mall' && R(36) % 2 === 0, gravel = roofBase === ix.roof || roofBase === ix.roof_dark;
        const terrL = info.terr || (cls === 'ind' ? [info.roof] : ['roof_green', 'roof_deck', info.roof, 'roof_green']);
        const terr = ix[terrL[R(31) % terrL.length]], rt = [0xffffff, 0xf0ece4, 0xe4e8ec][R(37) % 3], seat = [0x4a8ad8, 0xd84a4a, 0x4ab86a, 0xe8b83a][R(39) % 4];
        const roof = (i, j, k, c, kd) => {
            if (kd === 1) return capTop;
            if (j + 1 < top[c]) return ix.roof;                                    // пол лоджии или проезда
            if (!flat) return roofT === 'pagoda' ? ix.roof_dark : roofBase;
            if (shape === 'ring') return j + 1 < hmax ? ix.roof_tile : ix.roof_metal;
            if (shape === 'mall' && j + 1 < hmax - (ny >= 3 ? 1 : 0) && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) return ix.roof_glass;   // атриум
            if (j + 1 < hmax && !(shape === 'mall' && j + 1 === hmax - 1)) return terr;   // терраса на уступе
            if (c === heli) return ix.roof_heli;
            if (c === pool) return ix.roof_pool;
            if (green) return ix.roof_green;
            const hc = KR.hash(seed ^ 0x51ed, c);
            if (solar && (hc & 1)) return ix.roof_solar;
            if (park) return ix.roof_park;
            if (gravel) { const q = hc % 11; if (q === 0) return ix.roof_vent; if (q === 1) return ix.roof_ac; }
            return roofBase;
        };

        const INNER = ix.inner, FLOOR = ix.inner_floor, CEIL = ix.inner_dark, PLAIN = ix.m_plain;
        for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
            const ci = (j * nz + k) * nx + i;
            if (!F[ci]) continue;
            const o = ci * 6, c = k * nx + i, kd = K[ci], u = alongX ? i : k;
            T[o] = i + 1 < nx && F[ci + 1] ? INNER : side(i, j, k, 0, kd);
            T[o + 1] = i > 0 && F[ci - 1] ? INNER : side(i, j, k, 1, kd);
            T[o + 2] = k + 1 < nz && F[ci + nx] ? INNER : side(i, j, k, 2, kd);
            T[o + 3] = k > 0 && F[ci - nx] ? INNER : side(i, j, k, 3, kd);
            T[o + 4] = j + 1 < ny && F[ci + n] ? FLOOR : roof(i, j, k, c, kd);
            T[o + 5] = j === 0 || F[ci - n] ? CEIL : PLAIN;
            let tn = sectFull ? sec[u] : base;
            if (kd === 1) tn = capTint;
            else if (kd === 2) tn = acc;
            else if (j === 0 && sectGround) tn = sec[u];
            else if (j === 0 && gt >= 0) tn = gt;
            else if (belt && j > 0 && j % belt === 0 && j < top[c] - 1) tn = beltTint;
            else if (crown && j >= hmax - crown) tn = acc;
            else if (stripe >= 0 && j > 0 && ((u + ph) & 1) === 1) tn = stripe;
            tint[ci] = tn;
            ttop[ci] = kd === 1 ? capTint : shape === 'ring' && j + 1 < hmax ? seat : rt;
        }
    },

    // Декор: детали-коробки и клинья, приклеенные к кирпичам. Не больше max(12, 1.5 · колонн) деталей на здание,
    // за габарит здания деталь выходит не дальше 24 px.
    _decor(g) {
        const { nx, ny, nz, cw, cd, ch, w, d, filled: F, kind: K, top, T, seed, info, shape, style, hmax, base } = g;
        const n = nx * nz, ix = this._ix, st = this._st[style], parts = g.parts, cls = info.cls, trim = info.trim, WHITE = 0xffffff, M = 24;
        const R = (/** @type {number} */ c) => KR.hash(seed, c), cap = Math.max(12, Math.floor(g.cols * 1.5));
        let lim = cap;
        const add = (cell, kind, x0, y0, z0, x1, y1, z1, tile, tn, high) => {
            if (parts.length >= lim || cell < 0 || !F[cell]) return false;
            x0 = Math.max(x0, -w / 2 - M); z0 = Math.max(z0, -d / 2 - M); x1 = Math.min(x1, w / 2 + M); z1 = Math.min(z1, d / 2 + M);
            if (x1 - x0 < 0.5 || y1 - y0 < 0.5 || z1 - z0 < 0.5) return false;
            /** @type {any} */
            const p = { cell, kind, x0, y0, z0, x1, y1, z1, tile, tint: tn };
            if (kind === 'wedge') p.high = high;
            parts.push(p);
            return true;
        };
        const X = (i) => i * cw - w / 2, Z = (k) => k * cd - d / 2, CI = (i, j, k) => (j * nz + k) * nx + i;
        const TP = (i, k) => i < 0 || k < 0 || i >= nx || k >= nz ? 0 : top[k * nx + i];
        const topCell = (c) => (top[c] - 1) * n + c;
        // деталь на грани f кирпича: u0..u1 — вдоль грани (x у ±Z, z у ±X), d0..d1 — наружу от грани; клин высок у стены
        const stick = (cell, i, k, f, u0, u1, y0, y1, d0, d1, kind, tile, tn) => {
            if (f === 3) return add(cell, kind, u0, y0, Z(k) - d1, u1, y1, Z(k) - d0, tile, tn, 2);
            if (f === 2) return add(cell, kind, u0, y0, Z(k + 1) + d0, u1, y1, Z(k + 1) + d1, tile, tn, 3);
            if (f === 1) return add(cell, kind, X(i) - d1, y0, u0, X(i) - d0, y1, u1, tile, tn, 0);
            return add(cell, kind, X(i + 1) + d0, y0, u0, X(i + 1) + d1, y1, u1, tile, tn, 1);
        };
        const used = new Uint8Array(n);
        const pk = g.peak, pi = pk % nx, pkk = Math.floor(pk / nx), py = hmax * ch, pcx = X(pi) + cw / 2, pcz = Z(pkk) + cd / 2, pcell = topCell(pk);
        let ridge = 0;

        // --- 1. детали самой формы
        if (shape === 'dome') {
            let hasCap = false, y = py;
            for (let ci = 0; ci < F.length && !hasCap; ci++) hasCap = K[ci] === 1;
            if (!hasCap) { const m = Math.min(w, d); for (const [f, hq] of [[0.9, 0.17], [0.68, 0.15], [0.4, 0.12]]) { add(pcell, 'box', -w / 2 * f, y, -d / 2 * f, w / 2 * f, y + m * hq, d / 2 * f, g.capTile, g.capTint); y += m * hq; } }
            const fx = hasCap ? pcx : 0, fz = hasCap ? pcz : 0;
            add(pcell, 'box', fx - 2, y, fz - 2, fx + 2, y + 16, fz + 2, ix.m_gold, WHITE);
            used[pk] = 1;
        } else if (shape === 'spire' || (hmax >= 9 && (shape === 'tower' || shape === 'twin' || shape === 'step' || shape === 'cyl'))) {   // мачта с огнём
            const hgt = 36 + R(60) % 50;
            add(pcell, 'box', pcx - 2, py, pcz - 2, pcx + 2, py + hgt, pcz + 2, ix.m_metal, WHITE); add(pcell, 'box', pcx - 3, py + hgt, pcz - 3, pcx + 3, py + hgt + 6, pcz + 3, ix.m_red, WHITE);
            used[pk] = 1;
        } else if (shape === 'pyramid' && (style === 'sandstone' || style === 'casino' || style === 'stone')) {
            add(pcell, 'box', pcx - cw * 0.3, py, pcz - cd * 0.3, pcx + cw * 0.3, py + 14, pcz + cd * 0.3, ix.m_gold, WHITE);
        } else if (shape === 'pagoda') {                                 // карнизы ярусов и крыша с навершием
            const th = ny >= 5 ? 2 : 1, rcol = g.roofCol, rt = ix.roof_tile;
            for (let j = hmax - 1; j >= 0; j -= th) {
                let i0 = nx, i1 = -1, k0 = nz, k1 = -1;
                for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (F[CI(i, j, k)]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (k < k0) k0 = k; if (k > k1) k1 = k; }
                if (i1 < 0) continue;
                const y = (j + 1) * ch, mi = (i0 + i1) >> 1, mk = (k0 + k1) >> 1;
                if (j === hmax - 1) {
                    const x0 = X(i0) - 12, x1 = X(i1 + 1) + 12, z0 = Z(k0) - 12, z1 = Z(k1 + 1) + 12, zm = (z0 + z1) / 2, xm = (x0 + x1) / 2, rh = Math.min(40, (z1 - z0) * 0.34);
                    add(CI(mi, j, k0), 'wedge', x0, y, z0, x1, y + rh, zm, rt, rcol, 2); add(CI(mi, j, k1), 'wedge', x0, y, zm, x1, y + rh, z1, rt, rcol, 3);
                    add(CI(mi, j, mk), 'box', xm - 2, y + rh - 3, zm - 2, xm + 2, y + rh + 18, zm + 2, ix.m_gold, WHITE);
                } else {
                    add(CI(mi, j, k0), 'wedge', X(i0) - 15, y - 13, Z(k0) - 15, X(i1 + 1) + 15, y + 3, Z(k0), rt, rcol, 2);
                    add(CI(mi, j, k1), 'wedge', X(i0) - 15, y - 13, Z(k1 + 1), X(i1 + 1) + 15, y + 3, Z(k1 + 1) + 15, rt, rcol, 3);
                    add(CI(i0, j, mk), 'wedge', X(i0) - 15, y - 13, Z(k0) - 15, X(i0), y + 3, Z(k1 + 1) + 15, rt, rcol, 0);
                    add(CI(i1, j, mk), 'wedge', X(i1 + 1), y - 13, Z(k0) - 15, X(i1 + 1) + 15, y + 3, Z(k1 + 1) + 15, rt, rcol, 1);
                }
            }
        } else if (shape === 'church') {                                 // шпили над башнями, часы
            const tw = [];
            let i0 = nx, i1 = -1, k0 = nz, k1 = -1, solid = true;
            for (let c = 0; c < n; c++) if (top[c] === hmax && K[topCell(c)] === 2) { tw.push(c); const i = c % nx, k = Math.floor(c / nx); if (i < i0) i0 = i; if (i > i1) i1 = i; if (k < k0) k0 = k; if (k > k1) k1 = k; }
            for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (top[k * nx + i] !== hmax) solid = false;
            const spire = (a0, a1, b0, b1) => {
                const x0 = X(a0), x1 = X(a1 + 1), z0 = Z(b0), z1 = Z(b1 + 1), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z1 - z0) / 2, cell = CI(a0, hmax - 1, b0);
                let y = py;
                add(cell, 'box', x0 - 3, y, z0 - 3, x1 + 3, y + 4, z1 + 3, ix.m_trim, trim); y += 4;
                for (const [f, hq] of [[0.82, 16], [0.56, 20], [0.3, 24]]) { add(cell, 'box', cx - hw * f, y, cz - hd * f, cx + hw * f, y + hq, cz + hd * f, ix.roof_tile, g.roofCol); y += hq; }
                add(cell, 'box', cx - 1.5, y, cz - 1.5, cx + 1.5, y + 22, cz + 1.5, ix.m_gold, WHITE); add(cell, 'box', cx - 6, y + 12, cz - 1.5, cx + 6, y + 15, cz + 1.5, ix.m_gold, WHITE);
                for (const f of [3, 2, 1, 0]) { const front = f >= 2, uc = front ? cx : cz, ii = f === 0 ? a1 : a0, kk = f === 2 ? b1 : b0; if (hmax >= 2 && TP(ii + (f === 0 ? 1 : f === 1 ? -1 : 0), kk + (f === 2 ? 1 : f === 3 ? -1 : 0)) < hmax) stick(CI(ii, hmax - 1, kk), ii, kk, f, uc - 10, uc + 10, py - 30, py - 10, 0, 1.6, 'box', ix.m_clock, WHITE); }
            };
            if (tw.length && solid) spire(i0, i1, k0, k1); else for (const c of tw.slice(0, 2)) spire(c % nx, c % nx, Math.floor(c / nx), Math.floor(c / nx));
            for (const c of tw) used[c] = 1;
        } else if (shape === 'factory') {                                // трубы цеха
            let low = 255;
            for (let c = 0; c < n; c++) if (top[c] && top[c] < low) low = top[c];
            const list = [];
            for (let c = 0; c < n; c++) if (top[c] === low && K[topCell(c)] === 0) list.push(c);
            list.sort((a, b) => KR.hash(seed, 300 + a) - KR.hash(seed, 300 + b));
            for (const c of list.slice(0, 1 + (list.length >= 6 ? 1 : 0))) {
                const cx = X(c % nx) + cw / 2, cz = Z(Math.floor(c / nx)) + cd / 2, y = low * ch, hgt = 90 + KR.hash(seed, 310 + c) % 60;
                add(topCell(c), 'box', cx - 7, y, cz - 7, cx + 7, y + hgt, cz + 7, ix.m_brick, 0xd07858); add(topCell(c), 'box', cx - 8, y + hgt - 16, cz - 8, cx + 8, y + hgt - 8, cz + 8, ix.m_plain, WHITE);
                used[c] = 1;
            }
        } else if (shape === 'ring' && Math.min(nx, nz) >= 5) {          // мачты освещения и табло
            for (const [fx, fz] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
                let bc = -1, bq = 1e9;
                for (let c = 0; c < n; c++) if (top[c] === hmax) { const q = Math.abs((c % nx + 0.5) / nx - fx) + Math.abs((Math.floor(c / nx) + 0.5) / nz - fz); if (q < bq) { bq = q; bc = c; } }
                if (bc < 0) continue;
                const cx = X(bc % nx) + cw / 2, cz = Z(Math.floor(bc / nx)) + cd / 2;
                add(topCell(bc), 'box', cx - 2, py, cz - 2, cx + 2, py + 70, cz + 2, ix.m_dark, WHITE); add(topCell(bc), 'box', cx - 10, py + 70, cz - 3, cx + 10, py + 82, cz + 3, ix.m_lamp, WHITE);
                used[bc] = 1;
            }
            add(pcell, 'box', pcx - cw * 0.45, py + 4, pcz - 2, pcx + cw * 0.45, py + 34, pcz + 2, ix.m_screen, WHITE);
        }

        // --- 2. крыша
        lim = parts.length + Math.max(0, Math.min(Math.floor(cap * 0.5), cap - parts.length - 3));
        // двускатная: конёк вдоль x (alongX) или z; полосы поперёк конька с одной высотой получают пару клиньев,
        // полоса у стены повыше — односкатную пристройку
        const gable = (alongX, tile, tn) => {
            const na = alongX ? nx : nz, nb = alongX ? nz : nx, sb = alongX ? cd : cw, done = new Uint8Array(na * nb);
            const tAB = (a, b) => a < 0 || b < 0 || a >= na || b >= nb ? 0 : alongX ? top[b * nx + a] : top[a * nx + b];
            const skip = (a, b) => K[topCell(alongX ? b * nx + a : a * nx + b)] !== 0;
            const A0 = (a) => alongX ? X(a) : Z(a), B0 = (b) => alongX ? Z(b) : X(b), cellAB = (a, b, j) => alongX ? CI(a, j, b) : CI(b, j, a);
            const emit = (cell, a0, a1, b0, b1, y0, y1, hi) => alongX ? add(cell, 'wedge', a0, y0, b0, a1, y1, b1, tile, tn, hi ? 2 : 3) : add(cell, 'wedge', b0, y0, a0, b1, y1, a1, tile, tn, hi ? 0 : 1);
            for (let a = 0; a < na; a++) for (let b = 0; b < nb; b++) {
                const t0 = tAB(a, b);
                if (!t0 || done[a * nb + b] || skip(a, b)) continue;
                let b1 = b + 1, a1 = a + 1;
                while (b1 < nb && tAB(a, b1) === t0 && !skip(a, b1) && !done[a * nb + b1]) b1++;
                if (a1 < na && tAB(a1, b - 1) !== t0 && tAB(a1, b1) !== t0) { let same = true; for (let q = b; q < b1; q++) if (tAB(a1, q) !== t0 || done[a1 * nb + q] || skip(a1, q)) same = false; if (same) a1++; }
                for (let p = a; p < a1; p++) for (let q = b; q < b1; q++) done[p * nb + q] = 1;
                const y = t0 * ch, lo = tAB(a, b - 1), hi = tAB(a, b1), dep = (b1 - b) * sb;
                const x0 = A0(a) - (tAB(a - 1, b) < t0 ? 3 : 0), x1 = A0(a1) + (tAB(a1, b) < t0 ? 3 : 0), f0 = B0(b), f1 = B0(b1);
                if (lo > t0 && hi > t0) continue;
                if (lo > t0 || hi > t0) {
                    const rh = Math.min(dep * 0.5, (Math.max(lo, hi) - t0) * ch * 0.7, 36);
                    if (lo > t0) emit(cellAB(a, b, t0 - 1), x0, x1, f0, f1 + (hi < t0 ? 5 : 0), y, y + rh, false); else emit(cellAB(a, b1 - 1, t0 - 1), x0, x1, f0 - (lo < t0 ? 5 : 0), f1, y, y + rh, true);
                    continue;
                }
                const rh = Math.max(12, Math.min(dep * 0.4, 46)), mid = (f0 + f1) / 2;
                emit(cellAB(a, b, t0 - 1), x0, x1, f0 - 5, mid, y, y + rh, true); emit(cellAB(a, b1 - 1, t0 - 1), x0, x1, mid, f1 + 5, y, y + rh, false);
                if (rh > ridge) ridge = rh;
            }
        };
        // парапет по кромкам плоской крыши: отрезки до seg клеток
        const parapet = (ok, ph, out, th, yoff, tile, tn, seg) => {
            for (let k = 0; k < nz; k++) for (const dz of [-1, 1]) for (let i = 0; i < nx;) {
                const t0 = top[k * nx + i];
                if (!t0 || !ok(k * nx + i) || TP(i, k + dz) >= t0) { i++; continue; }
                let i1 = i + 1;
                while (i1 < nx && i1 - i < seg && top[k * nx + i1] === t0 && ok(k * nx + i1) && TP(i1, k + dz) < t0) i1++;
                const zz = dz < 0 ? Z(k) : Z(k + 1), oa = TP(i - 1, k) < t0 ? out : 0, ob = TP(i1, k) < t0 ? out : 0;
                add(CI(i, t0 - 1, k), 'box', X(i) - oa, t0 * ch + yoff, dz < 0 ? zz - out : zz - th, X(i1) + ob, t0 * ch + ph, dz < 0 ? zz + th : zz + out, tile, tn);
                i = i1;
            }
            for (let i = 0; i < nx; i++) for (const dx of [-1, 1]) for (let k = 0; k < nz;) {
                const t0 = top[k * nx + i];
                if (!t0 || !ok(k * nx + i) || TP(i + dx, k) >= t0) { k++; continue; }
                let k1 = k + 1;
                while (k1 < nz && k1 - k < seg && top[k1 * nx + i] === t0 && ok(k1 * nx + i) && TP(i + dx, k1) < t0) k1++;
                const xx = dx < 0 ? X(i) : X(i + 1);
                add(CI(i, t0 - 1, k), 'box', dx < 0 ? xx - out : xx - th, t0 * ch + yoff, Z(k), dx < 0 ? xx + th : xx + out, t0 * ch + ph, Z(k1), tile, tn);
                k = k1;
            }
        };
        const PAR = { cornice: [5, 4.5, 5, -5, ix.m_trim, trim], thin: [3, 1, 2.5, 0, ix.m_plain, trim], thick: [9, 1, 7, 0, ix.m_plain, this._mul(base, 0.92)], snow: [5, 3, 9, 0, ix.m_snow, WHITE], metal: [4, 1, 3, 0, ix.m_metal, trim] };
        const pr = PAR[info.par] || [6, 1.5, 4, 0, ix.m_plain, trim], seg = Math.max(2, Math.ceil(2 * (nx + nz) / Math.max(1, lim - parts.length)));
        if (g.roofT === 'gable') gable(shape === 'church' || shape === 'hangar' ? nx >= nz : w === d ? (R(53) & 1) === 1 : w > d, g.roofTile, g.roofCol);
        else if (g.roofT === 'hip') {                                    // вальмовая: четыре ската и плоский верх
            const D = Math.max(16, Math.min(40, Math.min(w, d) * 0.3)), H = Math.min(34, D * 0.9), y = py, mi = nx >> 1, mk = nz >> 1;
            add(CI(mi, hmax - 1, 0), 'wedge', -w / 2 - 4, y, -d / 2 - 4, w / 2 + 4, y + H, -d / 2 + D, g.roofTile, g.roofCol, 2);
            add(CI(mi, hmax - 1, nz - 1), 'wedge', -w / 2 - 4, y, d / 2 - D, w / 2 + 4, y + H, d / 2 + 4, g.roofTile, g.roofCol, 3);
            add(CI(0, hmax - 1, mk), 'wedge', -w / 2 - 4, y, -d / 2 + D, -w / 2 + D, y + H, d / 2 - D, g.roofTile, g.roofCol, 0);
            add(CI(nx - 1, hmax - 1, mk), 'wedge', w / 2 - D, y, -d / 2 + D, w / 2 + 4, y + H, d / 2 - D, g.roofTile, g.roofCol, 1);
            add(CI(mi, hmax - 1, mk), 'box', -w / 2 + D, y, -d / 2 + D, w / 2 - D, y + H, d / 2 - D, g.roofTile, this._mul(g.roofCol, 0.9));
            ridge = H;
        } else if (g.roofT === 'saw') {                                  // пилообразная крыша цеха; у корпуса повыше — парапет
            let low = 255;
            for (let c = 0; c < n; c++) if (top[c] && top[c] < low) low = top[c];
            const lng = nx >= nz;
            for (let a = 0; a < (lng ? nx : nz); a++) {
                let b0 = -1, b1 = -1;
                for (let b = 0; b < (lng ? nz : nx); b++) { const c = lng ? b * nx + a : a * nx + b; if (top[c] === low && K[topCell(c)] === 0 && !used[c]) { if (b0 < 0) b0 = b; b1 = b; } }
                if (b0 < 0) continue;
                if (lng) add(CI(a, low - 1, b0), 'wedge', X(a), low * ch, Z(b0), X(a + 1), low * ch + Math.min(30, cw * 0.4), Z(b1 + 1), g.roofTile, g.roofCol, 1);
                else add(CI(b0, low - 1, a), 'wedge', X(b0), low * ch, Z(a), X(b1 + 1), low * ch + Math.min(30, cd * 0.4), Z(a + 1), g.roofTile, g.roofCol, 3);
            }
            parapet((c) => top[c] > low && K[topCell(c)] === 0, pr[0], pr[1], pr[2], pr[3], pr[4], pr[5], seg);
        } else if (g.roofT === 'flat') {
            parapet((c) => K[topCell(c)] !== 1, pr[0], pr[1], pr[2], pr[3], pr[4], pr[5], seg);
            if (info.par === 'thick' && style === 'sandstone') for (const [i, k] of [[0, 0], [nx - 1, 0], [0, nz - 1], [nx - 1, nz - 1]]) {     // зубцы по углам
                const t0 = TP(i, k);
                if (t0) add(CI(i, t0 - 1, k), 'box', i ? X(i + 1) - 11 : X(0) - 1, t0 * ch + 9, k ? Z(k + 1) - 11 : Z(0) - 1, i ? X(i + 1) + 1 : X(0) + 11, t0 * ch + 17, k ? Z(k + 1) + 1 : Z(0) + 11, ix.m_plain, this._mul(base, 0.92));
            }
        }

        // --- 3. первый этаж: входы и витрины (сначала парадный фасад −Z, потом +Z и бока)
        lim = parts.length + Math.max(0, Math.min(Math.floor(cap * 0.4), cap - parts.length - 2));
        const awns = [ix.m_awn_r, ix.m_awn_b, ix.m_awn_g, ix.m_awn_y, ix.m_awn], signs = [ix.m_sign1, ix.m_sign2, ix.m_sign3, ix.m_sign4, ix.m_sign5, ix.m_sign6], neons = [ix.m_neon1, ix.m_neon2, ix.m_neon3, ix.m_neon4];
        const awnB = R(70) % 5, woodAwn = style === 'wood';
        for (const f of [3, 2, 1, 0]) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
            const ci = k * nx + i, ii = i + (f === 0 ? 1 : f === 1 ? -1 : 0), kk = k + (f === 2 ? 1 : f === 3 ? -1 : 0);
            if (!F[ci] || parts.length >= lim || (ii >= 0 && kk >= 0 && ii < nx && kk < nz && F[kk * nx + ii])) continue;
            const tile = T[ci * 6 + f], su = f >= 2 ? cw : cd, uc = f >= 2 ? X(i) + cw / 2 : Z(k) + cd / 2, hsh = KR.hash(seed ^ 0x9e37, ci * 4 + f);
            if (tile === st[4] || (info.sect === 'full' && tile === st[3])) {                // вход
                const e = info.ent;
                if (e === 'portico') {
                    stick(ci, i, k, f, uc - su * 0.36, uc + su * 0.36, 33, 37, 0, 16, 'box', ix.m_trim, trim);
                    stick(ci, i, k, f, uc - su * 0.34, uc - su * 0.34 + 5, 0, 33, 10.5, 15.5, 'box', ix.m_stone, trim); stick(ci, i, k, f, uc + su * 0.34 - 5, uc + su * 0.34, 0, 33, 10.5, 15.5, 'box', ix.m_stone, trim);
                    stick(ci, i, k, f, uc - su * 0.4, uc + su * 0.4, 0, 2.5, 0, 19, 'box', ix.m_plain, 0xc8c4bc);
                } else if (e === 'porch') {
                    stick(ci, i, k, f, uc - su * 0.26, uc + su * 0.26, 0, 3, 0, 10, 'box', ix.m_plain, 0xc8c4bc);
                    stick(ci, i, k, f, uc - su * 0.3, uc + su * 0.3, 32, 39, 0, 11, 'wedge', ix.roof_tile, g.roofCol);
                } else if (e === 'awn') stick(ci, i, k, f, uc - su * 0.32, uc + su * 0.32, 31, 40, 0, 13, 'wedge', woodAwn ? ix.roof_tile : awns[awnB], woodAwn ? g.roofCol : awnB === 4 ? g.acc : WHITE);
                else if (e === 'glass') stick(ci, i, k, f, uc - su * 0.4, uc + su * 0.4, 34, 36.5, 0, 17, 'box', ix.m_glass, WHITE);
                else if (e === 'canopy') stick(ci, i, k, f, uc - su * 0.36, uc + su * 0.36, 33, 36.5, 0, 14, 'box', ix.m_plain, style === 'neon' ? 0x4a4860 : trim);
            } else if ((tile === st[3] && (cls === 'com' || cls === 'res')) || (tile === st[7] && cls === 'com')) {     // витрина
                const fr = info.front, both = fr === 'both' ? hsh % 3 : -1;
                if (fr === 'awn' || both === 0 || both === 1) {
                    const q = info.sect === 'ground' ? hsh % 5 : awnB;
                    stick(ci, i, k, f, uc - su * 0.45, uc + su * 0.45, 31, 40.5, 0, 14, 'wedge', woodAwn ? ix.roof_tile : awns[q], woodAwn ? g.roofCol : q === 4 ? g.acc : WHITE);
                }
                if (fr === 'sign' || both === 2 || (both === 1 && hsh % 2)) stick(ci, i, k, f, uc - su * 0.4, uc + su * 0.4, 41, 49.5, 0, 2.6, 'box', signs[hsh % 6], WHITE);
                else if (fr === 'canopy') stick(ci, i, k, f, uc - su * 0.48, uc + su * 0.48, 34, 36.5, 0, 12, 'box', ix.m_plain, trim);
                else if (fr === 'neon' && top[ci] >= 2 && hsh % 2) stick(ci, i, k, f, uc + su * 0.36, uc + su * 0.36 + 4, 38, 38 + Math.min(52, top[ci] * ch - 50), 0, 12, 'box', neons[hsh % 4], WHITE);
                else if (fr === 'neon') stick(ci, i, k, f, uc - su * 0.42, uc + su * 0.42, 40, 50, 0, 3, 'box', neons[hsh % 4], WHITE);
            }
        }

        // --- 4. надстройки на крыше
        lim = cap;
        const roofBase = ix[info.roof], cells = [], pitched = g.roofT === 'gable' || g.roofT === 'hip';
        for (let c = 0; c < n; c++) if (top[c] && !used[c] && K[topCell(c)] !== 1 && (pitched || T[topCell(c) * 6 + 4] === roofBase || T[topCell(c) * 6 + 4] === ix.roof_green || T[topCell(c) * 6 + 4] === ix.roof_deck)) cells.push(c);
        cells.sort((a, b) => KR.hash(seed, 900 + a) - KR.hash(seed, 900 + b));
        const eq = info.equip, want = g.roofT === 'pagoda' || g.roofT === 'saw' ? 0 : pitched ? (eq.indexOf('chim') >= 0 ? R(61) % 2 + (cells.length >= 4 ? 1 : 0) : 0) : 1 + R(61) % 2 + (cells.length >= 6 ? 1 : 0) + (cells.length >= 14 ? 1 : 0);
        for (let q = 0; q < cells.length && q < want; q++) {
            const c = cells[q], i = c % nx, k = Math.floor(c / nx), t0 = top[c], y = t0 * ch, cell = topCell(c), hsh = KR.hash(seed, 950 + c);
            const cx = X(i) + cw / 2 + ((hsh >> 4) % 100 / 100 - 0.5) * cw * 0.24, cz = Z(k) + cd / 2 + ((hsh >> 11) % 100 / 100 - 0.5) * cd * 0.24;
            const edge = TP(i, k - 1) < t0 ? -1 : TP(i, k + 1) < t0 ? 1 : 0, tt = T[cell * 6 + 4];
            let kd = pitched ? 'chim' : eq[hsh % eq.length];
            if (!pitched && (tt === ix.roof_green || tt === ix.roof_deck)) kd = 'plant';
            if (kd === 'hut' && t0 < 3) kd = 'ac';
            if (kd === 'antenna' && t0 < 4) kd = 'vent';
            if ((kd === 'bill' || kd === 'lightbox' || kd === 'neon') && (!edge || t0 > 6)) kd = 'ac';
            switch (kd) {
                case 'hut': add(cell, 'box', cx - cw * 0.27, y, cz - cd * 0.23, cx + cw * 0.27, y + 24, cz + cd * 0.23, ix.m_plain, this._mul(base, 0.9)); add(cell, 'box', cx - cw * 0.29, y + 24, cz - cd * 0.25, cx + cw * 0.29, y + 27, cz + cd * 0.25, ix.m_plain, trim); break;
                case 'tank': add(cell, 'box', cx - 9, y, cz - 9, cx + 9, y + 7, cz + 9, ix.m_dark, WHITE); add(cell, 'box', cx - 12, y + 7, cz - 12, cx + 12, y + 31, cz + 12, ix.m_tank, WHITE); add(cell, 'box', cx - 13, y + 31, cz - 13, cx + 13, y + 34, cz + 13, ix.m_dark, WHITE); break;
                case 'ac': add(cell, 'box', cx - 11, y, cz - 7, cx + 11, y + 11, cz + 7, ix.m_ac, WHITE); if (hsh & 1) add(cell, 'box', cx - 11, y, cz + 10, cx + 11, y + 11, cz + 24, ix.m_ac, WHITE); break;
                case 'vent': add(cell, 'box', cx - 8, y, cz - 8, cx + 8, y + 13, cz + 8, ix.m_vent, WHITE); break;
                case 'antenna': { const hgt = 40 + hsh % 50; add(cell, 'box', cx - 1.5, y, cz - 1.5, cx + 1.5, y + hgt, cz + 1.5, ix.m_dark, WHITE); add(cell, 'box', cx - 8, y + hgt * 0.6, cz - 1, cx + 8, y + hgt * 0.6 + 2, cz + 1, ix.m_dark, WHITE); add(cell, 'box', cx - 2.5, y + hgt, cz - 2.5, cx + 2.5, y + hgt + 5, cz + 2.5, ix.m_red, WHITE); break; }
                case 'bill': case 'neon': { const zf = edge < 0 ? Z(k) + 8 : Z(k + 1) - 11, x0 = X(i) + cw * 0.04, x1 = X(i + 1) - cw * 0.04; add(cell, 'box', x0 + cw * 0.2, y, zf, x1 - cw * 0.2, y + 9, zf + 3, ix.m_dark, WHITE); add(cell, 'box', x0, y + 9, zf - 0.5, x1, y + 38, zf + 3.5, kd === 'neon' ? neons[hsh % 4] : [ix.m_bill1, ix.m_bill2, ix.m_bill3, ix.m_bill4][hsh % 4], WHITE); break; }
                case 'lightbox': { const zf = edge < 0 ? Z(k) + 1 : Z(k + 1) - 7; add(cell, 'box', X(i) + cw * 0.08, y + 5, zf, X(i + 1) - cw * 0.08, y + 22, zf + 6, signs[hsh % 6], WHITE); break; }
                case 'sky': add(cell, 'wedge', cx - cw * 0.3, y, cz - cd * 0.3, cx + cw * 0.3, y + 9, cz, ix.m_glass, WHITE, 2); add(cell, 'wedge', cx - cw * 0.3, y, cz, cx + cw * 0.3, y + 9, cz + cd * 0.3, ix.m_glass, WHITE, 3); break;
                case 'solar': add(cell, 'wedge', X(i) + cw * 0.1, y + 1, Z(k) + cd * 0.2, X(i + 1) - cw * 0.1, y + 12, Z(k + 1) - cd * 0.2, ix.roof_solar, WHITE, 2); break;
                case 'chim': add(cell, 'box', cx - 6, y, cz - 6, cx + 6, y + (pitched ? ridge + 9 : 22), cz + 6, ix.m_brick, this._mul(base, 0.85)); add(cell, 'box', cx - 7, y + (pitched ? ridge + 9 : 22), cz - 7, cx + 7, y + (pitched ? ridge + 12 : 25), cz + 7, ix.m_dark, WHITE); break;
                case 'plant': add(cell, 'box', X(i) + 8, y, Z(k) + 8, X(i + 1) - 8, y + 8, Z(k) + 18, ix.m_plant, WHITE); add(cell, 'box', cx - 8, y, cz + 2, cx + 8, y + 17, cz + 18, ix.m_plant, 0xd8f0d0); break;
                case 'flag': add(cell, 'box', cx - 1.2, y, cz - 1.2, cx + 1.2, y + 46, cz + 1.2, ix.m_metal, WHITE); add(cell, 'box', cx + 1.2, y + 34, cz - 0.6, cx + 18, y + 45, cz + 0.6, ix.m_flag, [0xe2473a, 0x3a7be0, 0x3fae5a, 0xf2b632][hsh % 4]); break;
                case 'snow': add(cell, 'box', cx - cw * 0.3, y, cz - cd * 0.3, cx + cw * 0.3, y + 7, cz + cd * 0.3, ix.m_snow, WHITE); add(cell, 'box', cx - cw * 0.16, y + 7, cz - cd * 0.16, cx + cw * 0.16, y + 12, cz + cd * 0.16, ix.m_snow, WHITE); break;
                case 'pipes': add(cell, 'box', X(i) + 6, y + 3, cz - 3, X(i + 1) - 6, y + 9, cz + 3, ix.m_pipe, WHITE); add(cell, 'box', cx - 5, y, cz + 6, cx + 5, y + 30, cz + 16, ix.m_metal, WHITE); break;
                default: break;
            }
        }

        // --- 5. балконы и зелень на террасах
        if (info.balc) {
            let left = 6;
            const bt = style === 'modern' ? ix.m_glass : style === 'sandstone' || style === 'wood' ? ix.m_wood : ix.m_rail;
            for (const f of [3, 2]) for (let j = 1; j < ny && left > 0; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx && left > 0; i++) {
                const ci = CI(i, j, k), kk = k + (f === 2 ? 1 : -1);
                if (!F[ci] || T[ci * 6 + f] !== st[1] || (kk >= 0 && kk < nz && F[CI(i, j, kk)]) || KR.hash(seed, 400 + ci) % 3 === 0) continue;
                if (stick(ci, i, k, f, X(i) + cw * 0.1, X(i + 1) - cw * 0.1, j * ch + 34, j * ch + 46, 0, 9, 'box', bt, style === 'wood' ? 0x9a6a4a : WHITE)) left--;
            }
        }
        if (cls !== 'ind' && g.roofT === 'flat') {
            let left = 4;
            for (let c = 0; c < n && left > 0; c++) {
                const t0 = top[c], i = c % nx, k = Math.floor(c / nx);
                if (!t0 || t0 >= hmax || used[c] || K[topCell(c)] || KR.hash(seed, 500 + c) % 2) continue;
                const fz = TP(i, k - 1) < t0 ? Z(k) + 7 : TP(i, k + 1) < t0 ? Z(k + 1) - 16 : -1e9;
                if (fz > -1e8 && add(topCell(c), 'box', X(i) + 7, t0 * ch, fz, X(i + 1) - 7, t0 * ch + 9, fz + 9, ix.m_plant, WHITE)) left--;
            }
        }
    },

    // ---------------------------------------------------------------------------------------------
    // Эталон отрисовки плана (отладка и снимки): один меш Babylon на все здания defs
    // ---------------------------------------------------------------------------------------------

    /**
     * Построить здания по маркерам defs простым мешем: каждая открытая грань кирпича — своим тайлом из атласа, оттенок —
     * цветом вершин, детали parts — коробки и клинья. opts: { cell, base — высота земли, lit — litLevel, atlas — готовый
     * атлас buildAtlas }. Возвращает { mesh, atlas, plans }. UV грани: u — слева направо для смотрящего снаружи,
     * v — сверху (v0) вниз (v1); у верхней грани u вдоль x, v вдоль z. Порядок углов и обход — как у кирпичей GameCity.
     */
    async preview(scene, defs, opts) {
        const o = opts || {}, base = o.base || 0, atlas = o.atlas || await this.buildAtlas(scene, o.lit || 0);
        const pos = [], nor = [], uv = [], col = [], idx = [], q = [0, 0, 0, 0], t6 = [0, 0, 0, 0, 0, 0], plans = [];
        let P = /** @type {any} */ (null), cs = 1, sn = 0, cr = 1, cg = 1, cb = 1;
        // тайл и оттенок следующих граней (k — затемнение)
        const paint = (tile, tint, k) => { this.tileUV(tile, q); cr = ((tint >> 16) & 255) / 255 * k; cg = ((tint >> 8) & 255) / 255 * k; cb = (tint & 255) / 255 * k; };
        // вершина: локальные координаты здания -> мир (поворот на курс), нормаль, доля тайла (u, v)
        const vert = (x, y, z, ax, ay, az, u, v) => {
            pos.push(P.x + x * cs - z * sn, base + y, P.z + x * sn + z * cs);
            nor.push(ax * cs - az * sn, ay, ax * sn + az * cs);
            uv.push(q[0] + (q[2] - q[0]) * u, q[1] + (q[3] - q[1]) * v);
            col.push(cr, cg, cb, 1);
        };
        // грань: углы по порядку низ-лево, верх-лево, верх-право, низ-право (если смотреть снаружи); нормаль считается
        const quad = (x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3) => {
            const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0, vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
            let ax = -(uy * vz - uz * vy), ay = -(uz * vx - ux * vz), az = -(ux * vy - uy * vx);
            const l = Math.hypot(ax, ay, az) || 1, v0 = pos.length / 3;
            ax /= l; ay /= l; az /= l;
            vert(x0, y0, z0, ax, ay, az, 0, 1); vert(x1, y1, z1, ax, ay, az, 0, 0); vert(x2, y2, z2, ax, ay, az, 1, 0); vert(x3, y3, z3, ax, ay, az, 1, 1);
            idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        };
        // шесть граней коробки; mask — какие рисовать (бит: 1 +X, 2 −X, 4 +Z, 8 −Z, 16 верх, 32 низ)
        const boxFace = (f, x0, y0, z0, x1, y1, z1) => {
            if (f === 0) quad(x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0);
            else if (f === 1) quad(x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1);
            else if (f === 2) quad(x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1);
            else if (f === 3) quad(x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0);
            else if (f === 4) quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
            else quad(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0);
        };
        // клин: точка (a, b) основания — a вдоль конька (0..1), b от низкой стороны (0) к высокой (1)
        const wedge = (p) => {
            const h = p.high, X = (a, b) => h === 2 ? (a ? p.x1 : p.x0) : h === 3 ? (a ? p.x0 : p.x1) : h === 0 ? (b ? p.x1 : p.x0) : (b ? p.x0 : p.x1);
            const Z = (a, b) => h === 2 ? (b ? p.z1 : p.z0) : h === 3 ? (b ? p.z0 : p.z1) : h === 0 ? (a ? p.z0 : p.z1) : (a ? p.z1 : p.z0);
            const y0 = p.y0, y1 = p.y1;
            quad(X(0, 0), y0, Z(0, 0), X(1, 0), y0, Z(1, 0), X(1, 1), y1, Z(1, 1), X(0, 1), y1, Z(0, 1));          // скат
            quad(X(0, 1), y0, Z(0, 1), X(0, 1), y1, Z(0, 1), X(1, 1), y1, Z(1, 1), X(1, 1), y0, Z(1, 1));          // высокая стенка
            quad(X(1, 1), y0, Z(1, 1), X(1, 1), y1, Z(1, 1), X(1, 0), y0, Z(1, 0), X(1, 0), y0, Z(1, 0));          // торцы (треугольники)
            quad(X(0, 0), y0, Z(0, 0), X(0, 0), y0, Z(0, 0), X(0, 1), y1, Z(0, 1), X(0, 1), y0, Z(0, 1));
        };
        for (const def of defs) {
            P = this.plan(def, { cell: o.cell }); plans.push(P); cs = Math.cos(P.yaw); sn = Math.sin(P.yaw);
            const { nx, ny, nz, cw, cd, ch, w, d, filled: F } = P;
            const has = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && F[(j * nz + k) * nx + i] === 1;
            for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
                const ci = (j * nz + k) * nx + i;
                if (!F[ci]) continue;
                P.tiles(ci, t6);
                const tint = P.tintOf(ci), x0 = i * cw - w / 2, x1 = x0 + cw, y0 = j * ch, y1 = y0 + ch, z0 = k * cd - d / 2, z1 = z0 + cd;
                // Грани, закрытые соседним кирпичом, здесь не рисуются (игра рисует их тайлом изнанки из tiles)
                if (!has(i + 1, j, k)) { paint(t6[0], tint, 1); boxFace(0, x0, y0, z0, x1, y1, z1); }
                if (!has(i - 1, j, k)) { paint(t6[1], tint, 1); boxFace(1, x0, y0, z0, x1, y1, z1); }
                if (!has(i, j, k + 1)) { paint(t6[2], tint, 1); boxFace(2, x0, y0, z0, x1, y1, z1); }
                if (!has(i, j, k - 1)) { paint(t6[3], tint, 1); boxFace(3, x0, y0, z0, x1, y1, z1); }
                if (!has(i, j + 1, k)) { paint(t6[4], P.topTint(ci), 1); boxFace(4, x0, y0, z0, x1, y1, z1); }
                if (j > 0 && !has(i, j - 1, k)) { paint(t6[5], tint, 0.6); boxFace(5, x0, y0, z0, x1, y1, z1); }
            }
            for (const p of P.parts) {
                paint(p.tile, p.tint, 1);
                if (p.kind === 'wedge') wedge(p); else for (let f = 0; f < 6; f++) boxFace(f, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1);
            }
        }
        const mesh = new BABYLON.Mesh('arch-preview', scene), vd = new BABYLON.VertexData();
        vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.colors = col; vd.indices = idx;
        vd.applyToMesh(mesh, false);
        const mat = new BABYLON.StandardMaterial('arch-preview', scene);
        mat.diffuseTexture = atlas.texture;
        mat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
        if (atlas.lit) { mat.emissiveTexture = atlas.lit; mat.useEmissiveAsIllumination = true; }      // окна светят сами, а не умножаются на цвет стены
        mesh.material = mat; mesh.hasVertexAlpha = false; mesh.isPickable = false;
        return { mesh, atlas, plans };
    },
};
GameArch._init();
