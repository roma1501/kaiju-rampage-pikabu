// GameShopData.js — каталог косметики Kaiju Rampage Ultimate и сборщик украшений для кайдзю.
//
// Глобалы: SHOP_TABS, SHOP_ITEMS, DAILY_REWARDS, WHEEL_SECTORS, GameCosmetics. Окна магазина,
// подарка и колеса — js/GameShopUI.js; логика — движок (Shop.js, DailyGift.js, Wheel.js).
//
// Всё косметика: ни один предмет не даёт преимущества в игре. Пять вкладок (слоты):
//   monster (species) — вид кайдзю: 8 базовых + 12 мутантов (вид + фирменная палитра) + эксклюзивы Daily Gift;
//   color   (palette) — палитра ролей материалов { primary, secondary, accent, claw, eye, glow, dark, fx };
//   breath  (breath)  — цвета и стиль атомного луча { core, glow, style };
//   acc     (acc)     — украшения на голове и спине { kind, node, color? } — меши строит GameCosmetics.build;
//   aura    (aura)    — аура и след шагов { color, color2, shape, stomp }.
// Цены: за валюту ≈35% предметов вкладки (400…20000), остальные за рекламу — 1…5 просмотров, чем реже, тем больше
// (обычный 1, необычный 2, редкий 3, эпический 4, легендарный 5). Shop.validate() сверяет это по правилу пользователя.
//
// GameCosmetics.look(Shop.look()) -> { species, palette, acc, breath, aura } для GameKaiju.applyLook;
// GameCosmetics.build(kind, scene, acc) -> [{ mesh, node }] — меш украшения для кости 'HeadTop' или 'Back'.

/** @param {string} ru @param {string} en */
const _kn = (ru, en) => ({ ru, en });

/** Вкладки: id — как в Shop, icon — ключ GameStyle.ICONS. */
const SHOP_TABS = [
    { id: 'monster', name: _kn('Монстры', 'Monsters'), icon: 'tab_monster' },
    { id: 'color', name: _kn('Цвета', 'Colors'), icon: 'tab_color' },
    { id: 'breath', name: _kn('Дыхание', 'Breath'), icon: 'tab_breath' },
    { id: 'acc', name: _kn('Украшения', 'Gear'), icon: 'tab_acc' },
    { id: 'aura', name: _kn('Ауры', 'Auras'), icon: 'tab_aura' },
];

/**
 * Палитра роли -> цвета. Роли материалов GLB-кайдзю: primary (шкура), secondary (брюхо), accent (шипы, пластины, рога),
 * claw, eye, glow (светящееся), dark (пасть, суставы). fx: 'metal' | 'gold' | 'ghost' — особый материал (его делает игра).
 * @param {string} primary @param {string} secondary @param {string} accent
 * @param {{ claw?: string, eye?: string, glow?: string, dark?: string, fx?: string }} [o]
 */
const _kp = (primary, secondary, accent, o) => {
    const x = o || {};
    /** @type {Record<string, string>} */
    const p = { primary, secondary, accent, claw: x.claw || '#f2ead0', eye: x.eye || '#ffe14a', glow: x.glow || accent, dark: x.dark || '#1a1d26' };
    if (x.fx) p.fx = x.fx;
    return p;
};

const SHOP_ITEMS = (() => {
    /** Цена: 0 — по умолчанию; >= 100 — монеты; 1..5 — просмотры рекламы. */
    const price = (/** @type {number} */ c) => (c >= 100 ? { coins: c } : { ads: c });
    /** @type {any[]} */
    const items = [];
    /** Добавить строку каталога: [id, ru, en, редкость, цена, поля предмета]. */
    const add = (/** @type {string} */ tab, /** @type {string} */ slot, /** @type {any[][]} */ rows) => {
        for (const [id, ru, en, rarity, cost, data] of rows) {
            const it = { id, tab, slot, name: _kn(ru, en), rarity, ...data };
            if (cost === 0) it.default = true;
            else if (cost === -1) it.exclusive = 'daily';
            else it.price = price(cost);
            items.push(it);
        }
    };

    // ---- Монстры: 8 видов + 12 мутантов + эксклюзивы дня 7 --------------------------------------------------------
    add('monster', 'species', [
        ['mon_titan', 'Титан', 'Titan', 'common', 0, { species: 'titan' }],
        ['mon_beetle', 'Жук-рогач', 'Stag Beetle', 'common', 500, { species: 'beetle' }],
        ['mon_deep', 'Глубоководный', 'Deepsea Beast', 'common', 1, { species: 'deep' }],
        ['mon_rex', 'Рекс', 'Rex', 'uncommon', 1200, { species: 'rex' }],
        ['mon_ape', 'Примат', 'Ape', 'uncommon', 2, { species: 'ape' }],
        ['mon_mecha', 'Мехатрон', 'Mechatron', 'rare', 3, { species: 'mecha' }],
        ['mon_drake', 'Дрейк', 'Drake', 'rare', 3, { species: 'drake' }],
        ['mon_golem', 'Голем', 'Golem', 'rare', 6000, { species: 'golem' }],
        ['mon_albino_titan', 'Альбинос-Титан', 'Albino Titan', 'uncommon', 1800,
            { species: 'titan', palette: _kp('#eef1f4', '#ffffff', '#ffb3c1', { claw: '#cfd6de', eye: '#ff3b5c', glow: '#ff8aa0', dark: '#8c97a6' }) }],
        ['mon_toxic_beetle', 'Токсичный Жук', 'Toxic Beetle', 'uncommon', 2,
            { species: 'beetle', palette: _kp('#7bd32a', '#3a6b10', '#e6ff3d', { claw: '#2a3a12', eye: '#ff2e2e', glow: '#b6ff00', dark: '#1b2a0c' }) }],
        ['mon_crimson_ape', 'Багровый Примат', 'Crimson Ape', 'uncommon', 2,
            { species: 'ape', palette: _kp('#9b1c2b', '#d9704e', '#3a0d14', { claw: '#f2e6d0', eye: '#ffd23d', glow: '#ff5a36', dark: '#1f080c' }) }],
        ['mon_ice_drake', 'Ледяной Дрейк', 'Frost Drake', 'rare', 4500,
            { species: 'drake', palette: _kp('#9fe3ff', '#e8fbff', '#3f8fd9', { claw: '#ffffff', eye: '#0a3c8a', glow: '#6af0ff', dark: '#2b4c6e' }) }],
        ['mon_magma_golem', 'Магматический Голем', 'Magma Golem', 'rare', 3,
            { species: 'golem', palette: _kp('#3a2a2a', '#6b3a2a', '#ff7a1a', { claw: '#ffb347', eye: '#fff2a0', glow: '#ff4a0a', dark: '#150c0c' }) }],
        ['mon_chrome_mecha', 'Хромовый Мехатрон', 'Chrome Mechatron', 'rare', 3,
            { species: 'mecha', palette: _kp('#c9d3df', '#8995a6', '#35c8ff', { claw: '#e8eef5', eye: '#35c8ff', glow: '#35c8ff', dark: '#2a3140', fx: 'metal' }) }],
        ['mon_neon_rex', 'Неоновый Рекс', 'Neon Rex', 'epic', 10000,
            { species: 'rex', palette: _kp('#1a1033', '#2b1a55', '#ff2bd6', { claw: '#29e0c8', eye: '#29e0c8', glow: '#ff2bd6', dark: '#0b0618' }) }],
        ['mon_gold_mecha', 'Золотой Мехатрон', 'Golden Mechatron', 'epic', 4,
            { species: 'mecha', palette: _kp('#ffc400', '#b8860b', '#fff1a8', { claw: '#fff6cc', eye: '#ff4b1f', glow: '#ffe14a', dark: '#5a4300', fx: 'gold' }) }],
        ['mon_ghost_titan', 'Призрачный Титан', 'Ghost Titan', 'epic', 4,
            { species: 'titan', palette: _kp('#bfe9ff', '#e6f7ff', '#7ad0ff', { claw: '#ffffff', eye: '#ffffff', glow: '#9be8ff', dark: '#5a7a96', fx: 'ghost' }) }],
        ['mon_obsidian_golem', 'Обсидиановый Голем', 'Obsidian Golem', 'epic', 4,
            { species: 'golem', palette: _kp('#1b1d2a', '#2c2f45', '#8a5cff', { claw: '#c9b8ff', eye: '#b48cff', glow: '#7a3cff', dark: '#0a0b12' }) }],
        ['mon_void_drake', 'Дрейк Пустоты', 'Void Drake', 'legendary', 20000,
            { species: 'drake', palette: _kp('#150a2a', '#2a1450', '#c04bff', { claw: '#e8c8ff', eye: '#ff3bd0', glow: '#b04bff', dark: '#07030f', fx: 'ghost' }) }],
        ['mon_abyss_deep', 'Бездонный Ужас', 'Abyssal Terror', 'legendary', 5,
            { species: 'deep', palette: _kp('#0c3a5a', '#0f6a7a', '#35ffe0', { claw: '#bfffff', eye: '#fffb6a', glow: '#35ffe0', dark: '#041a2a' }) }],
        // Эксклюзивы Daily Gift (день 7): не продаются и не выпадают на колесе. Очередь — порядок каталога.
        ['mon_golden_titan', 'Золотой Титан', 'Golden Titan', 'legendary', -1,
            { species: 'titan', palette: _kp('#ffcf2e', '#fff0a0', '#ff8a00', { claw: '#fff7d6', eye: '#ff3b1f', glow: '#ffe066', dark: '#7a5200', fx: 'gold' }) }],
        ['mon_cosmic_drake', 'Космический Дрейк', 'Cosmic Drake', 'legendary', -1,
            { species: 'drake', palette: _kp('#1d1b5a', '#3a2b8a', '#ffd84a', { claw: '#e8e6ff', eye: '#6cf2ff', glow: '#6cf2ff', dark: '#0a0830' }) }],
        ['mon_crystal_golem', 'Хрустальный Голем', 'Crystal Golem', 'legendary', -1,
            { species: 'golem', palette: _kp('#7fe9f0', '#b8f6fa', '#ff6ad5', { claw: '#ffffff', eye: '#ff6ad5', glow: '#7fffe8', dark: '#2a6a78', fx: 'ghost' }) }],
    ]);

    // ---- Цвета: «Родная» + 24 палитры -------------------------------------------------------------------------------
    add('color', 'palette', [
        ['pal_default', 'Родная', 'Original', 'common', 0, { palette: null }],
        ['pal_sand', 'Песчаный', 'Sandstone', 'common', 400, { palette: _kp('#d9b97a', '#f3e2b8', '#a8793a') }],
        ['pal_mint', 'Мята', 'Mint', 'common', 600, { palette: _kp('#4ee0b8', '#d8fff1', '#169a7c') }],
        ['pal_malachite', 'Малахит', 'Malachite', 'common', 1, { palette: _kp('#2faa6a', '#c9efd6', '#0f5e3a') }],
        ['pal_tomato', 'Томат', 'Tomato', 'common', 1, { palette: _kp('#e2432b', '#ffd2a6', '#8a1d12') }],
        ['pal_khaki', 'Хаки', 'Army Khaki', 'common', 1, { palette: _kp('#7d8456', '#c7c896', '#4a5031') }],
        ['pal_ocean', 'Океан', 'Ocean', 'uncommon', 1200, { palette: _kp('#2a7fd1', '#bfe2ff', '#0b3a73') }],
        ['pal_tangerine', 'Мандарин', 'Tangerine', 'uncommon', 1600, { palette: _kp('#ff8a1f', '#ffe0a3', '#b3490a') }],
        ['pal_dusk', 'Сумерки', 'Dusk', 'uncommon', 2, { palette: _kp('#5b4a9a', '#ff9ec2', '#2a1f5c') }],
        ['pal_candy', 'Конфетка', 'Candy', 'uncommon', 2, { palette: _kp('#ff7ac8', '#fff0fa', '#7a3cff') }],
        ['pal_sakura', 'Сакура', 'Sakura', 'uncommon', 2, { palette: _kp('#f7a8c4', '#fff3f7', '#b2415f') }],
        ['pal_coal', 'Уголь', 'Coal', 'uncommon', 2, { palette: _kp('#3a3f4a', '#6b7280', '#ff4b1f') }],
        ['pal_frost', 'Лёд', 'Frost', 'rare', 3500, { palette: _kp('#8fd6ff', '#f2fbff', '#2b7bd6', { glow: '#6af0ff' }) }],
        ['pal_lava', 'Лава', 'Lava', 'rare', 5000, { palette: _kp('#b52a12', '#ff9a1f', '#ffd23d', { glow: '#ff6a1a' }) }],
        ['pal_violet', 'Фиолетовый туман', 'Violet Haze', 'rare', 3, { palette: _kp('#8a5cd6', '#d9c4ff', '#4b2a96') }],
        ['pal_jade', 'Нефрит', 'Jade', 'rare', 3, { palette: _kp('#1fa57a', '#a7f0d0', '#d9b44a') }],
        ['pal_bronze', 'Бронза', 'Bronze', 'rare', 3, { palette: _kp('#b0723a', '#e0b078', '#6b3f1a', { fx: 'metal' }) }],
        ['pal_toxin', 'Токсин', 'Toxin', 'rare', 3, { palette: _kp('#a4e01a', '#f0ffa0', '#4a7a0a', { glow: '#d6ff3d' }) }],
        ['pal_steel', 'Сталь', 'Steel', 'epic', 4, { palette: _kp('#8f9bad', '#c9d3df', '#3a4458', { fx: 'metal' }) }],
        ['pal_radiation', 'Радиация', 'Radioactive', 'epic', 9000, { palette: _kp('#d7f03a', '#2b2f1a', '#ffe14a', { glow: '#b6ff00' }) }],
        ['pal_cosmos', 'Космос', 'Cosmos', 'epic', 4, { palette: _kp('#1a1a4a', '#4a3a9a', '#ff6ad5', { glow: '#6cf2ff' }) }],
        ['pal_ghost', 'Призрак', 'Ghost', 'epic', 4, { palette: _kp('#cfeaff', '#f4fbff', '#8ac8ff', { fx: 'ghost' }) }],
        ['pal_gold', 'Золото', 'Gold', 'legendary', 18000, { palette: _kp('#ffc400', '#ffe680', '#c98a00', { fx: 'gold' }) }],
        ['pal_diamond', 'Алмаз', 'Diamond', 'legendary', 5, { palette: _kp('#bff4ff', '#ffffff', '#5fd8ff', { glow: '#9ff0ff', fx: 'metal' }) }],
        ['pal_darkmatter', 'Тёмная материя', 'Dark Matter', 'legendary', 5, { palette: _kp('#0e0a1c', '#241a4a', '#9a5cff', { fx: 'ghost' }) }],
    ]);

    // ---- Дыхание: «Атомный луч» + 21 стиль ----------------------------------------------------------------------------
    /** @param {string} core @param {string} glow @param {string} style */
    const br = (core, glow, style) => ({ breath: { core, glow, style } });
    add('breath', 'breath', [
        ['br_atomic', 'Атомный луч', 'Atomic Beam', 'common', 0, br('#e8fbff', '#35c8ff', 'beam')],
        ['br_emerald', 'Изумрудный луч', 'Emerald Beam', 'common', 500, br('#eafff0', '#2fe06a', 'beam')],
        ['br_campfire', 'Костёр', 'Campfire', 'common', 700, br('#fff3b0', '#ff8a1f', 'fire')],
        ['br_ruby', 'Рубиновый луч', 'Ruby Beam', 'common', 1, br('#fff0f0', '#ff3b3b', 'beam')],
        ['br_amber', 'Янтарный луч', 'Amber Beam', 'common', 1, br('#fff8d6', '#ffb400', 'beam')],
        ['br_flame', 'Огненное дыхание', 'Fire Breath', 'uncommon', 1500, br('#fff6c0', '#ff5a1a', 'fire')],
        ['br_pink', 'Розовый луч', 'Pink Beam', 'uncommon', 2200, br('#fff0fa', '#ff6ad5', 'beam')],
        ['br_frost', 'Морозный выдох', 'Frost Breath', 'uncommon', 2, br('#f2fcff', '#7fd8ff', 'ice')],
        ['br_spark', 'Искровой разряд', 'Spark Bolt', 'uncommon', 2, br('#ffffff', '#ffe14a', 'lightning')],
        ['br_smog', 'Ядовитый смог', 'Toxic Smog', 'uncommon', 2, br('#eaffb0', '#8fd61a', 'toxic')],
        ['br_blue_flame', 'Синее пламя', 'Blue Flame', 'rare', 4000, br('#e6f2ff', '#2f6bff', 'fire')],
        ['br_storm', 'Грозовой разряд', 'Thunder Bolt', 'rare', 3, br('#f0e8ff', '#9a5cff', 'lightning')],
        ['br_acid', 'Кислотный плевок', 'Acid Spit', 'rare', 3, br('#f6ffd0', '#b6ff00', 'toxic')],
        ['br_plasma', 'Плазма', 'Plasma', 'rare', 3, br('#fff0ff', '#ff4bd0', 'plasma')],
        ['br_blizzard', 'Буран', 'Blizzard', 'rare', 3, br('#ffffff', '#b8e6ff', 'ice')],
        ['br_hellfire', 'Адское пламя', 'Hellfire', 'epic', 9500, br('#ffe0a0', '#d4140a', 'fire')],
        ['br_void', 'Пустота', 'Void Ray', 'epic', 4, br('#f0d8ff', '#5a1ad6', 'void')],
        ['br_arc', 'Электродуга', 'Electric Arc', 'epic', 4, br('#e8ffff', '#29e0c8', 'lightning')],
        ['br_sun', 'Солнечная плазма', 'Solar Plasma', 'epic', 4, br('#fffbe0', '#ffc400', 'plasma')],
        ['br_rainbow', 'Радужный взрыв', 'Rainbow Blast', 'legendary', 20000, br('#ffffff', '#ff4bd0', 'rainbow')],
        ['br_darkmatter', 'Тёмная материя', 'Dark Matter', 'legendary', 5, br('#ffffff', '#2a0a5a', 'void')],
        ['br_nova', 'Сверхновая', 'Supernova', 'legendary', 5, br('#ffffff', '#7fffe8', 'plasma')],
    ]);

    // ---- Украшения: «Без украшений» + 22 ----------------------------------------------------------------------------
    /** @param {string} kind @param {'HeadTop' | 'Back'} node @param {string} [color] */
    const ac = (kind, node, color) => ({ acc: color ? { kind, node, color } : { kind, node } });
    add('acc', 'acc', [
        ['acc_none', 'Без украшений', 'No gear', 'common', 0, { acc: null }],
        ['acc_party_hat', 'Праздничный колпак', 'Party Hat', 'common', 400, ac('party_hat', 'HeadTop')],
        ['acc_cap', 'Кепка', 'Cap', 'common', 500, ac('cap', 'HeadTop')],
        ['acc_headphones', 'Наушники', 'Headphones', 'common', 1, ac('headphones', 'HeadTop')],
        ['acc_antenna', 'Антенны', 'Antennae', 'common', 1, ac('antenna', 'HeadTop')],
        ['acc_flower_crown', 'Венок', 'Flower Crown', 'common', 1, ac('flower_crown', 'HeadTop')],
        ['acc_top_hat', 'Цилиндр', 'Top Hat', 'uncommon', 1200, ac('top_hat', 'HeadTop')],
        ['acc_mohawk', 'Ирокез', 'Mohawk', 'uncommon', 1600, ac('mohawk', 'HeadTop', '#29e0c8')],
        ['acc_viking', 'Шлем викинга', 'Viking Helm', 'uncommon', 2, ac('viking', 'HeadTop')],
        ['acc_horns_bull', 'Бычьи рога', 'Bull Horns', 'uncommon', 2, ac('horns_bull', 'HeadTop')],
        ['acc_shell', 'Панцирь', 'Shell', 'uncommon', 2, ac('shell', 'Back')],
        ['acc_cape', 'Плащ', 'Cape', 'uncommon', 2, ac('cape', 'Back')],
        ['acc_crown_iron', 'Железная корона', 'Iron Crown', 'rare', 3500, ac('crown_iron', 'HeadTop')],
        ['acc_jetpack', 'Реактивный ранец', 'Jetpack', 'rare', 5000, ac('jetpack', 'Back')],
        ['acc_kabuto', 'Кабуто', 'Kabuto', 'rare', 3, ac('kabuto', 'HeadTop')],
        ['acc_unicorn', 'Рог единорога', 'Unicorn Horn', 'rare', 3, ac('unicorn', 'HeadTop')],
        ['acc_cannons', 'Плечевые пушки', 'Shoulder Cannons', 'rare', 3, ac('cannons', 'Back')],
        ['acc_horns_demon', 'Рога демона', 'Demon Horns', 'epic', 9000, ac('horns_demon', 'HeadTop')],
        ['acc_wings_bat', 'Крылья летучей мыши', 'Bat Wings', 'epic', 4, ac('wings_bat', 'Back')],
        ['acc_crystals', 'Кристаллы', 'Crystals', 'epic', 4, ac('crystals', 'Back')],
        ['acc_crown_gold', 'Золотая корона', 'Golden Crown', 'legendary', 18000, ac('crown_gold', 'HeadTop')],
        ['acc_halo', 'Нимб', 'Halo', 'legendary', 5, ac('halo', 'HeadTop')],
        ['acc_wings_angel', 'Ангельские крылья', 'Angel Wings', 'legendary', 5, ac('wings_angel', 'Back')],
    ]);

    // ---- Ауры и следы шагов: «Без ауры» + 21 ------------------------------------------------------------------------
    /** @param {string} color @param {string} color2 @param {string} shape @param {string} stomp */
    const au = (color, color2, shape, stomp) => ({ aura: { color, color2, shape, stomp } });
    add('aura', 'aura', [
        ['aura_none', 'Без ауры', 'No aura', 'common', 0, { aura: null }],
        ['aura_sparks', 'Искры', 'Sparks', 'common', 500, au('#ffd23d', '#ff8a1f', 'sparks', 'dust')],
        ['aura_leaves', 'Листопад', 'Falling Leaves', 'common', 700, au('#6fd36a', '#2f8a3a', 'leaves', 'dust')],
        ['aura_bubbles', 'Пузыри', 'Bubbles', 'common', 1, au('#9fe3ff', '#ffffff', 'bubbles', 'dust')],
        ['aura_smoke', 'Дымок', 'Smoke', 'common', 1, au('#9aa3b0', '#5a6270', 'smoke', 'dust')],
        ['aura_flames', 'Огонёк', 'Little Flames', 'uncommon', 1500, au('#ff7a1a', '#ffd23d', 'flames', 'fire')],
        ['aura_toxic_cloud', 'Ядовитое облако', 'Toxic Cloud', 'uncommon', 2200, au('#8fd61a', '#d6ff3d', 'toxic', 'toxic')],
        ['aura_snow', 'Снегопад', 'Snowfall', 'uncommon', 2, au('#e8fbff', '#9fd8ff', 'snow', 'ice')],
        ['aura_hearts', 'Сердечки', 'Hearts', 'uncommon', 2, au('#ff5ca8', '#ffd0e6', 'hearts', 'dust')],
        ['aura_stars', 'Звёздочки', 'Little Stars', 'uncommon', 2, au('#ffe14a', '#fff6b0', 'stars', 'dust')],
        ['aura_inferno', 'Инферно', 'Inferno', 'rare', 4000, au('#ff3b0a', '#ffb000', 'flames', 'fire')],
        ['aura_icy', 'Ледяной вихрь', 'Ice Whirl', 'rare', 3, au('#7fd8ff', '#ffffff', 'snow', 'ice')],
        ['aura_storm', 'Грозовая аура', 'Storm Aura', 'rare', 3, au('#9a5cff', '#e8d8ff', 'lightning', 'electric')],
        ['aura_goldrain', 'Золотой дождь', 'Golden Rain', 'rare', 3, au('#ffc400', '#fff0a0', 'gold', 'gold')],
        ['aura_blossom', 'Лепестки', 'Petals', 'rare', 3, au('#ff9ec2', '#fff0f6', 'leaves', 'dust')],
        ['aura_electro', 'Электрошторм', 'Electrostorm', 'epic', 9000, au('#29e0c8', '#ffffff', 'lightning', 'electric')],
        ['aura_blackhole', 'Чёрная дыра', 'Black Hole', 'epic', 4, au('#5a1ad6', '#150a2a', 'void', 'dust')],
        ['aura_acid', 'Кислотный туман', 'Acid Fog', 'epic', 4, au('#b6ff00', '#4a7a0a', 'toxic', 'toxic')],
        ['aura_royal', 'Королевское золото', 'Royal Gold', 'epic', 4, au('#ffd84a', '#ff8a00', 'gold', 'gold')],
        ['aura_supernova', 'Сверхновая', 'Supernova', 'legendary', 20000, au('#ffffff', '#7fffe8', 'stars', 'electric')],
        ['aura_hell', 'Адская аура', 'Hellish Aura', 'legendary', 5, au('#d4140a', '#2a0a0a', 'flames', 'fire')],
        ['aura_love', 'Вечная любовь', 'Eternal Love', 'legendary', 5, au('#ff2bd6', '#ffe14a', 'hearts', 'gold')],
    ]);

    return items;
})();

/**
 * Награды Daily Gift за дни 1–6 (день 7 — эксклюзивный скин из очереди SHOP_ITEMS с exclusive: 'daily').
 * Монеты растут 300 → 2500; на днях 3 и 5 ещё случайный предмет магазина (x2 удваивает и его).
 */
const DAILY_REWARDS = [
    { coins: 300 },
    { coins: 500 },
    { coins: 800, randomItems: 1, maxRarity: 'rare' },
    { coins: 1200 },
    { coins: 1800, randomItems: 1, maxRarity: 'epic' },
    { coins: 2500 },
];

/**
 * Секторы колеса (8, равные по углу; сектор 0 — под стрелкой). weight — вес выпадения, color/ink — цвета сектора в окне.
 * Два сектора с предметом магазина (случайный, раз в сутки выбирается Wheel); остальное — монеты 100…2000.
 */
const WHEEL_SECTORS = [
    { coins: 100, weight: 24, color: '#FFC400', ink: '#141A26' },
    { coins: 300, weight: 14, color: '#29E0C8', ink: '#141A26' },
    { randomItem: true, maxRarity: 'rare', weight: 5, color: '#B05CFF', ink: '#FFFFFF' },
    { coins: 200, weight: 20, color: '#FFC400', ink: '#141A26' },
    { coins: 1000, weight: 5, color: '#FF4B1F', ink: '#FFFFFF' },
    { coins: 500, weight: 10, color: '#29E0C8', ink: '#141A26' },
    { randomItem: true, maxRarity: 'epic', weight: 2, color: '#B05CFF', ink: '#FFFFFF' },
    { coins: 2000, weight: 2, color: '#FF4B1F', ink: '#FFFFFF' },
];

// =================================================================================================
// GameCosmetics: облик для кайдзю и меши украшений
// =================================================================================================

/** Набор примитивов Babylon для одного украшения: кусочки копятся по материалам и склеиваются в один корневой меш. */
class AccKit {
    /** @param {any} scene @param {string} name */
    constructor(scene, name) {
        this.scene = scene;
        this.name = name;
        /** @type {Map<string, any[]>} */
        this.groups = new Map();
        /** Вспомогательные узлы (родители частей купола): снимаются после склейки. @type {any[]} */
        this.nodes = [];
        this.n = 0;
    }

    /**
     * Плоский материал (кэш на сцену). glow — доля свечения (emissive), alpha — прозрачность.
     * @param {string} hex @param {{ glow?: number, alpha?: number }} [o]
     */
    mat(hex, o) {
        const glow = (o && o.glow) || 0, alpha = o && o.alpha != null ? o.alpha : 1;
        const key = hex + '|' + glow + '|' + alpha;
        let cache = GameCosmetics._mats.get(this.scene);
        if (!cache) { cache = new Map(); GameCosmetics._mats.set(this.scene, cache); }
        let m = cache.get(key);
        if (!m || this.scene.materials.indexOf(m) < 0) {
            m = new BABYLON.StandardMaterial('acc/' + key, this.scene);
            const c = BABYLON.Color3.FromHexString(hex);
            m.diffuseColor = c;
            m.specularColor = new BABYLON.Color3(0.06, 0.06, 0.06);
            m.emissiveColor = glow > 0 ? c.scale(glow) : new BABYLON.Color3(0, 0, 0);
            m.alpha = alpha;
            cache.set(key, m);
        }
        return m;
    }

    /** Поставить готовый меш (позиция, углы Эйлера, масштаб) и запомнить по материалу. */
    put(/** @type {any} */ mesh, /** @type {any} */ mat, /** @type {number[]} */ pos, /** @type {number[] | null} */ rot, /** @type {number[] | null} */ scl) {
        if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
        if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        if (scl) mesh.scaling.set(scl[0], scl[1], scl[2]);
        mesh.material = mat;
        const list = this.groups.get(mat.name) || [];
        list.push(mesh);
        this.groups.set(mat.name, list);
        return mesh;
    }

    _id() { return this.name + '_' + (this.n++); }

    /** Коробка w (X) × h (Y) × d (Z) с центром в (x, y, z); rot — Эйлер [rx, ry, rz]. */
    box(w, h, d, x, y, z, mat, rot) {
        const m = BABYLON.MeshBuilder.CreateBox(this._id(), { width: w, height: h, depth: d }, this.scene);
        return this.put(m, mat, [x, y, z], rot || null, null);
    }

    /** Цилиндр/усечённый конус вдоль Y с центром в (x, y, z): dTop — диаметр сверху, dBot — снизу. */
    cyl(dTop, dBot, h, tess, x, y, z, mat, rot) {
        const m = BABYLON.MeshBuilder.CreateCylinder(this._id(), { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess }, this.scene);
        return this.put(m, mat, [x, y, z], rot || null, null);
    }

    /** Шар диаметром d (segments — детализация). */
    ball(d, segments, x, y, z, mat) {
        const m = BABYLON.MeshBuilder.CreateSphere(this._id(), { diameter: d, segments }, this.scene);
        return this.put(m, mat, [x, y, z], null, null);
    }

    /**
     * Купол: верхняя половина шара диаметром d из трёх блочных усечённых конусов (tess граней), центр основания в (x, y, z).
     * rot/scl — поворот и масштаб всего купола (scl — до поворота).
     */
    dome(d, tess, x, y, z, mat, rot, scl) {
        const g = new BABYLON.TransformNode(this._id(), this.scene);
        g.position.set(x, y, z);
        if (rot) g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        if (scl) g.scaling.set(scl[0], scl[1], scl[2]);
        this.nodes.push(g);
        const r = d / 2, a = [0, 35, 65, 90].map((v) => v * Math.PI / 180);
        for (let i = 0; i < 3; i++) {
            const y0 = r * Math.sin(a[i]), y1 = r * Math.sin(a[i + 1]);
            const m = BABYLON.MeshBuilder.CreateCylinder(this._id(), { diameterBottom: 2 * r * Math.cos(a[i]), diameterTop: 2 * r * Math.cos(a[i + 1]), height: y1 - y0, tessellation: tess, cap: BABYLON.Mesh.NO_CAP }, this.scene);
            m.parent = g;
            m.position.set(0, (y0 + y1) / 2, 0);
            m.material = mat;
            const list = this.groups.get(mat.name) || [];
            list.push(m);
            this.groups.set(mat.name, list);
        }
    }

    /** Усечённый конус от точки a (диаметр dA) до точки b (диаметр dB), tess граней: рог, шип, стержень. */
    bar(a, b, dA, dB, tess, mat) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz) || 1e-3;
        const m = BABYLON.MeshBuilder.CreateCylinder(this._id(), { diameterBottom: dA, diameterTop: dB, height: len, tessellation: tess }, this.scene);
        m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        // поворот оси +Y на направление a -> b
        const dir = new BABYLON.Vector3(dx / len, dy / len, dz / len);
        if (dir.y > 0.99999) m.rotationQuaternion = BABYLON.Quaternion.Identity();
        else if (dir.y < -0.99999) m.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI);
        else m.rotationQuaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Cross(new BABYLON.Vector3(0, 1, 0), dir).normalize(), Math.acos(dir.y));
        m.material = mat;
        const list = this.groups.get(mat.name) || [];
        list.push(m);
        this.groups.set(mat.name, list);
        return m;
    }

    /** Блочное кольцо из n коробок: радиус r (до оси коробки), толщина radial, высота h, основание на высоте y. */
    ring(n, r, radial, h, y, mat) {
        const tang = 2 * r * Math.tan(Math.PI / n) * 1.06 + 1;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            this.box(radial, h, tang, r * Math.cos(a), y + h / 2, r * Math.sin(a), mat, [0, -a, 0]);
        }
    }

    /** Двусторонняя лента по путям точек: paths — массив путей [[x, y, z], …] одинаковой длины. */
    ribbon(paths, mat) {
        const arr = paths.map((p) => p.map((v) => new BABYLON.Vector3(v[0], v[1], v[2])));
        const m = BABYLON.MeshBuilder.CreateRibbon(this._id(), { pathArray: arr, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        return this.put(m, mat, null, null, null);
    }

    /** Треугольник a, b, c (двусторонний). */
    tri(a, b, c, mat) {
        return this.ribbon([[a, b], [c, [c[0] + 0.01, c[1], c[2]]]], mat);
    }

    /** Склеить кусочки по материалам; корень — пустой Mesh с детьми (по одному на материал), единицы модели. */
    finish() {
        const root = new BABYLON.Mesh(this.name, this.scene);
        root.isPickable = false;
        for (const list of this.groups.values()) {
            const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
            if (!merged) continue;
            merged.parent = root;
            merged.isPickable = false;
        }
        this.groups.clear();
        for (const n of this.nodes) n.dispose();
        this.nodes = [];
        return root;
    }
}

/** @satisfies {Record<string, any>} */
const GameCosmetics = {
    /** Кость кайдзю, на которую крепится украшение. */
    ACC_NODE: {
        crown_gold: 'HeadTop', crown_iron: 'HeadTop', horns_bull: 'HeadTop', horns_demon: 'HeadTop', halo: 'HeadTop', top_hat: 'HeadTop',
        party_hat: 'HeadTop', viking: 'HeadTop', kabuto: 'HeadTop', mohawk: 'HeadTop', unicorn: 'HeadTop', flower_crown: 'HeadTop',
        antenna: 'HeadTop', headphones: 'HeadTop', cap: 'HeadTop',
        wings_angel: 'Back', wings_bat: 'Back', jetpack: 'Back', cannons: 'Back', crystals: 'Back', shell: 'Back', cape: 'Back',
    },
    /** Материалы по сценам (используются повторно: украшение при снятии не оставляет материалов-сирот). @type {WeakMap<object, Map<string, any>>} */
    _mats: new WeakMap(),
    /** Облик по умолчанию для луча. */
    DEFAULT_BREATH: { core: '#e8fbff', glow: '#35c8ff', style: 'beam' },

    /** Индекс предметов каталога по id. @type {Map<string, any> | null} */
    _index: null,
    item(/** @type {string} */ id) {
        if (!GameCosmetics._index) GameCosmetics._index = new Map(SHOP_ITEMS.map((it) => [it.id, it]));
        return GameCosmetics._index.get(id) || null;
    },

    /**
     * Облик кайдзю из Shop.look() ({ слот: id | null }): { species, palette, acc, breath, aura }.
     * Палитра слота `palette` перекрывает фирменную палитру мутанта, если это не «Родная».
     * @param {Record<string, string | null>} shopLook
     */
    look(shopLook) {
        const L = shopLook || {};
        const sp = L.species ? GameCosmetics.item(L.species) : null;
        const pal = L.palette ? GameCosmetics.item(L.palette) : null;
        const ac = L.acc ? GameCosmetics.item(L.acc) : null;
        const br = L.breath ? GameCosmetics.item(L.breath) : null;
        const au = L.aura ? GameCosmetics.item(L.aura) : null;
        const palette = pal && pal.palette ? { ...pal.palette } : sp && sp.palette ? { ...sp.palette } : null;
        return {
            species: (sp && sp.species) || 'titan',
            palette,
            acc: ac && ac.acc ? { ...ac.acc } : null,
            breath: br && br.breath ? { ...br.breath } : { ...GameCosmetics.DEFAULT_BREATH },
            aura: au && au.aura ? { ...au.aura } : null,
        };
    },

    /**
     * Меши украшения для кайдзю: [{ mesh, node }]. mesh — корень (пустой Mesh с детьми по материалам) в единицах модели
     * (кайдзю 300 px ростом), node — 'HeadTop' (макушка) или 'Back' (между лопаток). Оси кости: +X вперёд, +Y вверх, +Z вправо.
     * @param {string} kind @param {any} scene @param {{ color?: string } | null} [acc]
     */
    build(kind, scene, acc) {
        const fn = GameCosmetics.BUILDERS[kind];
        if (!fn || !scene) return [];
        const kit = new AccKit(scene, 'acc_' + kind);
        fn(kit, (acc && acc.color) || '');
        const root = kit.finish();
        root.metadata = { accKind: kind };
        return [{ mesh: root, node: GameCosmetics.ACC_NODE[kind] || 'HeadTop' }];
    },

    /**
     * Строители по видам. Единицы — px модели; голова ~90 px шириной, макушка (0, 0, 0): +X вперёд, +Y вверх, +Z вправо;
     * спина (Back): точка на поверхности спины, предметы уходят в −X. Все предметы симметричны относительно Z = 0.
     * @type {Record<string, (k: AccKit, color: string) => void>}
     */
    BUILDERS: {
        // Золотая корона: блочное кольцо радиусом 30 и пять высоких зубцов (передний выше), рубиновый и сапфировый камни спереди.
        crown_gold(k, c) {
            const gold = k.mat(c || '#ffc400', { glow: 0.25 });
            k.ring(10, 30, 7, 10, -2, gold);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2, x = 30 * Math.cos(a), z = 30 * Math.sin(a);
                k.bar([x, 8, z], [x, 8 + (i === 0 ? 26 : 20), z], 11, 0, 4, gold);
            }
            k.box(4, 6, 6, 32, 3, 0, k.mat('#ff3b3b', { glow: 0.7 }));
            k.box(4, 5, 5, 31, 3, 11, k.mat('#35c8ff', { glow: 0.7 }));
            k.box(4, 5, 5, 31, 3, -11, k.mat('#35c8ff', { glow: 0.7 }));
        },

        // Железная корона: тёмное стальное кольцо с полосой, четыре прямоугольных зубца, красный камень по центру спереди.
        crown_iron(k, c) {
            const iron = k.mat(c || '#7b8594'), dark = k.mat('#4b5361');
            k.ring(8, 30, 6, 12, -2, iron);
            k.ring(8, 30.5, 7, 3, 1, dark);
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2, h = i === 0 ? 24 : 17;
                k.box(8, h, 8, 30 * Math.cos(a), 10 + h / 2, 30 * Math.sin(a), iron, [0, -a, 0]);
            }
            k.box(3, 8, 8, 34, 4, 0, k.mat('#ff2e4d', { glow: 0.6 }));
        },

        // Бычьи рога: два изогнутых рога цвета кости (ломаная из трёх звеньев) выходят в стороны, поднимаются и загибаются вперёд.
        horns_bull(k, c) {
            const bone = k.mat(c || '#f2e8cc'), tip = k.mat('#3a3a46');
            for (const s of [-1, 1]) {
                k.bar([0, -3, 22 * s], [0, 8, 35 * s], 14, 11, 6, bone);
                k.bar([0, 8, 35 * s], [4, 21, 41 * s], 11, 8, 6, bone);
                k.bar([4, 21, 41 * s], [14, 34, 40 * s], 8, 0, 6, tip);
            }
        },

        // Рога демона: два больших красных рога, загнутых назад и вверх, с раскалёнными кончиками, и пара малых рожек спереди.
        horns_demon(k, c) {
            const red = k.mat(c || '#b3261e'), hot = k.mat('#ff7a1a', { glow: 0.7 });
            for (const s of [-1, 1]) {
                k.bar([-4, -3, 16 * s], [-12, 12, 24 * s], 13, 10, 6, red);
                k.bar([-12, 12, 24 * s], [-26, 28, 28 * s], 10, 7, 6, red);
                k.bar([-26, 28, 28 * s], [-44, 38, 26 * s], 7, 0, 6, hot);
                k.bar([14, -3, 14 * s], [23, 12, 19 * s], 8, 0, 5, red);
            }
        },

        // Нимб: парящее над головой золотое светящееся кольцо (восьмиугольник из коробок), радиус 26, высота 52 над макушкой.
        halo(k, c) {
            k.ring(8, 26, 5, 4, 50, k.mat(c || '#ffe066', { glow: 0.9 }));
        },

        // Цилиндр: чёрная шляпа с полями (диаметр 64) и высокой тульёй, красная лента.
        top_hat(k, c) {
            const black = k.mat(c || '#1d2030');
            k.cyl(64, 64, 4, 12, 0, 0, 0, black);
            k.cyl(40, 40, 34, 12, 0, 19, 0, black);
            k.cyl(41.5, 41.5, 7, 12, 0, 8, 0, k.mat('#ff4b1f'));
        },

        // Праздничный колпак: конус из четырёх полос двух цветов, жёлтый помпон на вершине, тонкие поля.
        party_hat(k, c) {
            const a = k.mat(c || '#ff4bb4'), b = k.mat('#29e0c8');
            for (let i = 0; i < 4; i++) k.cyl(36 * (1 - (i + 1) / 4), 36 * (1 - i / 4), 11, 6, 0, 11 * i + 3.5, 0, i % 2 ? b : a);
            k.box(9, 9, 9, 0, 46, 0, k.mat('#ffe14a', { glow: 0.4 }), [0, 0.6, 0]);
            k.cyl(40, 40, 2, 6, 0, -1, 0, b);
        },

        // Шлем викинга: стальной купол, ободок, носовая пластина и два костяных рога по бокам, загнутых вверх.
        viking(k, c) {
            const steel = k.mat(c || '#8f9bb0'), band = k.mat('#5b6578'), bone = k.mat('#f2e8cc');
            k.dome(64, 6, 0, -4, 0, steel);
            k.ring(8, 31.5, 3, 6, -3, band);
            k.box(3, 18, 6, 33, -9, 0, band);
            for (const s of [-1, 1]) {
                k.bar([0, 14, 29 * s], [0, 26, 43 * s], 11, 9, 6, bone);
                k.bar([0, 26, 43 * s], [7, 43, 50 * s], 9, 0, 6, bone);
            }
        },

        // Кабуто: тёмно-синий купол, красный ободок, три пластины-«юбка» сзади и золотой V-образный гребень спереди.
        kabuto(k, c) {
            const navy = k.mat(c || '#2b3a5c'), red = k.mat('#b3261e'), gold = k.mat('#ffc400', { glow: 0.25 });
            k.dome(62, 6, 0, -4, 0, navy);
            k.ring(8, 33, 6, 5, -4, red);
            for (let i = 0; i < 3; i++) k.box(4, 7, 50 + i * 7, -33 - i * 2, -5 - i * 7, 0, i % 2 ? red : navy);
            k.bar([30, 6, 0], [47, 40, 24], 6, 4, 4, gold);
            k.bar([30, 6, 0], [47, 40, -24], 6, 4, 4, gold);
            k.box(3, 16, 8, 32, 14, 0, gold);
        },

        // Ирокез: гребень из семи шипов вдоль головы (высота по колоколу 16…38) на тёмной планке.
        mohawk(k, c) {
            const col = k.mat(c || '#ff2e88', { glow: 0.15 });
            const hs = [16, 24, 32, 38, 32, 24, 16];
            hs.forEach((h, i) => { const x = -24 + i * 8; k.bar([x, -1, 0], [x, -1 + h, 0], 11, 0, 4, col); });
            k.box(56, 5, 9, 0, -1.5, 0, k.mat('#2b3142'));
        },

        // Единорог: полосатый (белый/розовый) рог, наклонённый вперёд, золотой воротник у основания и два розовых уха.
        unicorn(k, c) {
            const w = k.mat('#ffffff', { glow: 0.15 }), p = k.mat(c || '#ff9ad5', { glow: 0.15 }), gold = k.mat('#ffc400');
            const base = [16, -2], tip = [32, 46];
            for (let i = 0; i < 4; i++) {
                const t0 = i / 4, t1 = (i + 1) / 4;
                k.bar([base[0] + (tip[0] - base[0]) * t0, base[1] + (tip[1] - base[1]) * t0, 0], [base[0] + (tip[0] - base[0]) * t1, base[1] + (tip[1] - base[1]) * t1, 0],
                    10 * (1 - t0), 10 * (1 - t1), 6, i % 2 ? p : w);
            }
            k.cyl(22, 24, 5, 8, 16, -1, 0, gold);
            for (const s of [-1, 1]) k.bar([-4, -3, 20 * s], [-8, 16, 27 * s], 9, 0, 5, p);
        },

        // Венок: зелёный блочный ободок радиусом 29 и пять цветков-«плюсов» (розовый, белый, оранжевый) с жёлтой серединкой.
        flower_crown(k, c) {
            const leaf = k.mat(c || '#3fa34d'), cols = [k.mat('#ff6ad5'), k.mat('#ffffff'), k.mat('#ff8a1f')], eye = k.mat('#ffe14a');
            k.ring(8, 29, 5, 5, -2, leaf);
            for (let i = 0; i < 5; i++) {
                const a = ((i + 0.5) / 5) * Math.PI * 2, x = 30 * Math.cos(a), z = 30 * Math.sin(a), m = cols[i % 3];
                k.box(3, 15, 5, x, 6, z, m, [0, -a, 0]);
                k.box(3, 5, 15, x, 6, z, m, [0, -a, 0]);
                k.box(4, 5, 5, x + 2 * Math.cos(a), 6, z + 2 * Math.sin(a), eye, [0, -a, 0]);
            }
        },

        // Антенны: две тонкие чёрные антенны, расходящиеся вверх, на концах светящиеся шарики (красный и бирюзовый).
        antenna(k, c) {
            const dark = k.mat('#3a4254');
            k.box(8, 4, 8, 6, 0, 10, dark); k.box(8, 4, 8, 6, 0, -10, dark);
            k.bar([6, 2, 10], [4, 34, 18], 3.5, 3.5, 4, dark);
            k.bar([6, 2, -10], [4, 34, -18], 3.5, 3.5, 4, dark);
            k.box(9, 9, 9, 4, 38, 18, k.mat(c || '#ff4b1f', { glow: 0.9 }));
            k.box(9, 9, 9, 4, 38, -18, k.mat('#29e0c8', { glow: 0.9 }));
        },

        // Наушники: дуга-оголовье над головой из шести коробок и два больших амбушюра по бокам (тёмные, с бирюзовым светящимся диском).
        headphones(k, c) {
            const dark = k.mat('#1b2333'), neon = k.mat(c || '#29e0c8', { glow: 0.55 });
            const pts = [-90, -60, -30, 0, 30, 60, 90].map((d) => { const r = d * Math.PI / 180; return [-4, -18 + 21 * Math.cos(r), 37 * Math.sin(r)]; });
            for (let i = 0; i < 6; i++) {
                const a = pts[i], b = pts[i + 1], len = Math.hypot(b[1] - a[1], b[2] - a[2]), ang = Math.atan2(b[2] - a[2], b[1] - a[1]);
                // поворот вокруг X: ось Y коробки идёт вдоль звена a -> b
                k.box(6, len + 2, 6, -4, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, dark, [ang, 0, 0]);
            }
            for (const s of [-1, 1]) {
                k.cyl(26, 26, 12, 10, -4, -18, 37 * s, dark, [Math.PI / 2, 0, 0]);
                k.cyl(19, 19, 3, 10, -4, -18, 43.5 * s, neon, [Math.PI / 2, 0, 0]);
            }
        },

        // Кепка: красный купол, тёмный козырёк вперёд (+X), белая нашивка спереди, пуговка сверху.
        cap(k, c) {
            const red = k.mat(c || '#ff4b1f');
            k.dome(64, 6, 0, -4, 0, red);
            k.box(30, 3, 42, 46, -2, 0, k.mat('#c7360f'));
            k.box(3, 11, 13, 31.5, 9, 0, k.mat('#ffffff'));
            k.box(6, 5, 6, 0, 30, 0, red);
        },

        // Ангельские крылья: на каждой стороне золотой лонжерон от лопатки до размаха 130 px и пять белых перьев-пластин разной длины.
        wings_angel(k, c) {
            const white = k.mat(c || '#f4f7ff', { glow: 0.12 }), gold = k.mat('#ffd84a', { glow: 0.2 });
            const lens = [64, 72, 66, 54, 40], zs = [30, 54, 78, 102, 124];
            for (const s of [-1, 1]) {
                k.bar([-4, 6, 12 * s], [-14, 44, 56 * s], 8, 7, 4, gold);
                k.bar([-14, 44, 56 * s], [-20, 58, 128 * s], 7, 4, 4, gold);
                zs.forEach((z, i) => {
                    const y = z <= 56 ? 6 + (z - 12) / 44 * 38 : 44 + (z - 56) / 72 * 14;
                    k.box(5, lens[i], 20, -(8 + z * 0.1), y - lens[i] / 2 + 3, z * s, white);
                });
            }
        },

        // Крылья летучей мыши: тёмные костяные «пальцы» от локтя и фиолетовая перепонка между ними, размах 132 px на сторону.
        wings_bat(k, c) {
            const bone = k.mat('#2a1a3a'), skin = k.mat(c || '#6a2a8a');
            for (const s of [-1, 1]) {
                const R = [-6, 8, 12 * s], E = [-12, 50, 54 * s];
                const T = [[-22, 86, 92 * s], [-26, 64, 132 * s], [-26, 24, 124 * s], [-20, -8, 90 * s]];
                k.bar(R, E, 8, 6, 4, bone);
                for (const t of T) k.bar(E, t, 5, 2, 4, bone);
                k.tri(E, T[0], T[1], skin); k.tri(E, T[1], T[2], skin); k.tri(E, T[2], T[3], skin); k.tri(R, E, T[3], skin);
            }
        },

        // Реактивный ранец: две серые баки-цилиндра на коричневой плите с ремнём, тёмные сопла и оранжевое пламя вниз.
        jetpack(k, c) {
            const metal = k.mat(c || '#a9b3c4'), dark = k.mat('#3a4254'), plate = k.mat('#6b4a2e');
            k.box(6, 54, 46, -4, -18, 0, plate);
            k.box(8, 6, 58, -5, -2, 0, dark);
            for (const s of [-1, 1]) {
                k.cyl(22, 22, 62, 8, -20, -20, 17 * s, metal);
                k.cyl(18, 14, 8, 8, -20, -55, 17 * s, dark);
                k.bar([-20, -59, 17 * s], [-20, -90, 17 * s], 12, 0, 6, k.mat('#ff9a1f', { glow: 1 }));
            }
        },

        // Плечевые пушки: на каждой стороне тёмное основание и серый ствол, наклонённый вперёд-вверх, красное кольцо у дульного среза.
        cannons(k, c) {
            const metal = k.mat(c || '#5d6778'), dark = k.mat('#2b3142'), red = k.mat('#ff4b1f');
            for (const s of [-1, 1]) {
                k.box(16, 12, 18, -14, 0, 38 * s, dark);
                k.bar([-18, 2, 38 * s], [18, 33, 38 * s], 15, 14, 8, metal);
                k.bar([18, 33, 38 * s], [27, 41, 38 * s], 17, 17, 8, red);
            }
        },

        // Кристаллы: гроздь из восьми бирюзовых светящихся шестигранных шипов, торчащих вверх и назад вдоль хребта.
        crystals(k, c) {
            const a = k.mat(c || '#29e0c8', { glow: 0.8, alpha: 0.92 }), b = k.mat('#7af0e0', { glow: 0.8, alpha: 0.92 });
            k.bar([-4, 10, 0], [-14, 70, 0], 18, 0, 5, a);
            k.bar([-4, -20, 0], [-24, 26, 0], 13, 0, 5, b);
            for (const s of [-1, 1]) {
                k.bar([-4, 0, 14 * s], [-16, 48, 26 * s], 13, 0, 5, b);
                k.bar([-4, -22, 10 * s], [-20, 16, 20 * s], 11, 0, 5, a);
                k.bar([-4, 24, 22 * s], [-10, 52, 38 * s], 9, 0, 5, a);
            }
        },

        // Панцирь: зелёный сплюснутый купол диаметром 100 на спине (выпуклостью назад, в −X) с бежевым ободом и светлыми щитками.
        shell(k, c) {
            const green = k.mat(c || '#4a7a3a'), rim = k.mat('#c8a86a'), scute = k.mat('#6aa84f');
            k.dome(100, 8, -2, -10, 0, green, [0, 0, Math.PI / 2], [1, 0.6, 1]);
            k.cyl(104, 104, 6, 10, -3, -10, 0, rim, [0, 0, Math.PI / 2]);
            k.box(6, 16, 16, -33, -10, 0, scute);
            for (let i = 0; i < 6; i++) {
                const phi = (i / 6) * Math.PI * 2, th = 50 * Math.PI / 180, r = 50 * Math.sin(th);
                k.box(7, 14, 14, -2 - 30 * Math.cos(th) - 1, -10 + r * Math.sin(phi), r * Math.cos(phi), scute);
            }
        },

        // Плащ: красный плащ от плеч вниз и назад (ширина растёт от 60 до 100), золотая кайма, две золотые застёжки и цепочка на плечах.
        cape(k, c) {
            const red = k.mat(c || '#d62a2a'), gold = k.mat('#ffc400', { glow: 0.2 });
            k.ribbon([
                [[-3, 10, -30], [-8, 10, 0], [-3, 10, 30]],
                [[-14, -40, -38], [-20, -40, 0], [-14, -40, 38]],
                [[-30, -100, -48], [-36, -100, 0], [-30, -100, 48]],
                [[-33, -112, -50], [-39, -112, 0], [-33, -112, 50]],
            ], red);
            k.box(3, 6, 100, -36, -109, 0, gold, [0, 0, 0.28]);
            k.box(8, 8, 8, -2, 10, 28, gold); k.box(8, 8, 8, -2, 10, -28, gold);
            k.box(3, 3, 52, -2, 12, 0, gold);
        },
    },
};
