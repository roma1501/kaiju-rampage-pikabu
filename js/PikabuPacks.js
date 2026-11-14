// @ts-nocheck
// PikabuPacks.js — наборы за рубли в сборке Пикабу Игр (js/PikabuShop.js). Цены и названия товаров — в Студии
// (каталог CSV: coins_s 19 ₽, coins_m 49 ₽, coins_l 99 ₽, starter 29 ₽, no_ads 59 ₽), здесь — что игрок получает.
// Валюта — монеты движкового Shop (Shop.addCoins), предметы набора — лучшие «за рекламу» из каталога Shop.
PikabuShop.setup({
    colors: ['#ff5a1f', '#16a34a'],
    ready: () => !!(typeof Shop !== 'undefined' && Shop.state && Shop.items().length && typeof Game !== 'undefined'),
    visible: () => Game.state === 'menu',
    persist: () => Shop._save('pikabu'),
    button: { corner: 'tl', x: 34, y: 160 },
    packs: [
        { id: 'coins_s', type: 'consumable', icon: '🪙', name: 'Горсть монет', desc: '3 000 монет на монстров, окрасы и дыхание', grant: () => Shop.addCoins(3000) },
        { id: 'coins_m', type: 'consumable', icon: '💰', name: 'Мешок монет', desc: '10 000 монет', grant: () => Shop.addCoins(10000) },
        { id: 'coins_l', type: 'consumable', icon: '🏆', name: 'Сундук монет', desc: '25 000 монет — хватит на самые дорогие предметы', best: true, grant: () => Shop.addCoins(25000) },
        {
            id: 'starter', type: 'non_consumable', icon: '🦖', name: 'Набор Бездны', best: 'Один раз',
            desc: '5 000 монет, монстр «Бездонный ужас», алмазный окрас и дыхание «Тёмная материя»',
            grant: () => Shop.addCoins(5000),
            apply: () => PikabuShop.shopGrant(['mon_abyss_deep', 'pal_diamond', 'br_darkmatter']),
        },
        { id: 'no_ads', type: 'non_consumable', icon: '🚫', name: 'Без рекламы', desc: 'Убирает рекламу между раундами навсегда. Награды за рекламу остаются', noAds: true },
    ],
});
