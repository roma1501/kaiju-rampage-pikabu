// Game.js — Kaiju Rampage Ultimate: состояния игры, раунд, камера, сохранение, реклама, связка модулей.
//   GameCity (город из кирпичей) · GameDebris (обломки) · GameKaiju (игрок) · GameArmy (розыск и техника)
//   GameFX (эффекты) · GameAudio (музыка и звук) · GameUI (меню, HUD) · GameShopUI (магазин, подарок, колесо)
//
// Состояния: 'menu' (кайдзю стоит на карте, камера кружит) -> 'play' (раунд) -> 'dead' (предложение возродиться)
// -> 'result' (итог раунда) -> 'menu'. Раунд — разрушение одной карты до победы (город уничтожен) или гибели.
// Прогресс — один объект Platform.save: монеты и облик (Shop), подарок дня, колесо, рекорды и открытые карты, обучение.

Object.assign(LANG_STRINGS.ru, {
    'title': 'Kaiju Rampage Ultimate',
    'kr.play': 'Крушить!', 'kr.boost': 'Мега-старт: 3 уровень', 'kr.forAd': 'За рекламу', 'kr.adIn': 'Через {n} с', 'kr.noAds': 'Реклама недоступна',
    'kr.shop': 'Магазин', 'kr.daily': 'Подарок', 'kr.wheel': 'Колесо', 'kr.howto': 'Как играть', 'kr.settings': 'Настройки',
    'kr.map.metro': 'Метро-Сити', 'kr.map.harbor': 'Порт Харбор', 'kr.map.tokyo': 'Неон-Токио', 'kr.map.desert': 'Мираж', 'kr.map.arctic': 'База «Полюс»',
    'kr.best': 'Рекорд: {n}%', 'kr.locked': 'Разрушь {n}% карты «{map}»', 'kr.unlockAd': 'Открыть за рекламу {a}/{b}', 'kr.unlocked': 'Карта открыта!',
    'kr.level': 'Ур. {n}', 'kr.destroyed': '{n}%', 'kr.levelUp': 'Уровень {n}!', 'kr.grow': 'Кайдзю растёт!', 'kr.star': 'Розыск: {n}★',
    'kr.star1': 'Полиция уже едет!', 'kr.star2': 'Спецназ и вертолёт!', 'kr.star3': 'В город вошли танки!', 'kr.star4': 'Ударные вертолёты!',
    'kr.star5': 'Истребители и ракеты!', 'kr.star6': 'Вся армия против тебя!',
    'kr.attack': 'Удар', 'kr.breath': 'Луч', 'kr.slam': 'Прыжок',
    'kr.top': 'Рекорды', 'kr.top.empty': 'Пока нет лучших игроков', 'kr.top.login': 'Войдите в аккаунт', 'kr.top.loading': 'Загрузка…', 'kr.top.err': 'Рекорды сейчас недоступны', 'kr.top.anon': 'Игрок',
    'kr.skills': 'Умения', 'kr.sk.claws': 'Когти и хвост', 'kr.sk.claws.d': 'Удары лапами и разворот хвостом — основа разрушения',
    'kr.sk.slam': 'Прыжок-удар', 'kr.sk.slam.d': 'Прыжок, который сносит всё вокруг', 'kr.sk.breath': 'Атомный луч', 'kr.sk.breath.d': 'Луч прожигает дома насквозь',
    'kr.sk.nova': 'Огненная волна', 'kr.sk.nova.d': 'Кольцо огня поджигает кварталы вокруг', 'kr.sk.meteor': 'Метеоритный дождь', 'kr.sk.meteor.d': 'Метеоры падают на город перед тобой',
    'kr.sk.nuke': 'Ядерный взрыв', 'kr.sk.nuke.d': 'Стирает с лица земли целый район', 'kr.sk.unlock': 'Открывается на {n} уровне кайдзю в раунде',
    'kr.sk.level': 'Сила {n} из {m}', 'kr.sk.up': 'Улучшить', 'kr.sk.max': 'Максимум', 'kr.sk.new': 'Новое умение: {name}!',
    'kr.sk.bonus': 'Умения покупаются за монеты или открываются за рекламу — и остаются навсегда. Каждое улучшение: +20% урона, +7% радиуса, быстрее перезарядка',
    'kr.sk.locked': 'Не куплено — купи за монеты или открой за рекламу', 'kr.sk.bought': '{name} — твоё! Доступно с начала раунда', 'kr.sk.unlockAd': 'Открыть {a}/{b}', 'kr.sk.owned': 'С начала раунда', 'kr.sk.buy': 'Купить', 'kr.sk.noCoins': 'Не хватает монет', 'kr.sk.upDone': '{name}: сила {n}!', 'kr.sk.adProgress': 'За рекламу {a}/{b}',
    'kr.offer.heal': 'Вылечиться', 'kr.offer.heal.s': 'Полное здоровье', 'kr.offer.calm': 'Сбросить розыск', 'kr.offer.calm.s': 'Минус 2 звезды',
    'kr.offer.rage': 'Ярость', 'kr.offer.rage.s': 'Урон x2 на 30 с', 'kr.healed': 'Здоровье восстановлено!', 'kr.calmed': 'Армия отступает!', 'kr.rage': 'ЯРОСТЬ!',
    'kr.revive.t': 'Кайдзю повержен!', 'kr.revive': 'Возродиться', 'kr.revive.no': 'Нет, спасибо', 'kr.revived': 'Кайдзю снова в деле!',
    'kr.win': 'Город уничтожен!', 'kr.lose': 'Кайдзю повержен', 'kr.ended': 'Раунд окончен',
    'kr.res.destroyed': 'Разрушено', 'kr.res.level': 'Уровень', 'kr.res.kills': 'Техники уничтожено', 'kr.res.stars': 'Розыск', 'kr.res.time': 'Время',
    'kr.res.coins': 'Монеты', 'kr.res.x2': 'Удвоить', 'kr.res.again': 'Заново', 'kr.res.menu': 'Меню', 'kr.res.next': 'Новая карта открыта: {map}!',
    'kr.pause': 'Пауза', 'kr.resume': 'Продолжить', 'kr.finish': 'Завершить раунд', 'kr.sound': 'Звук', 'kr.quality': 'Графика',
    'kr.q.auto': 'Авто', 'kr.q.low': 'Низкая', 'kr.q.medium': 'Средняя', 'kr.q.high': 'Высокая', 'kr.qNote': 'Графика изменится со следующего раунда',
    'kr.close': 'Закрыть', 'kr.loadingMap': 'Город просыпается…', 'kr.combo': 'Комбо x{n}', 'kr.collapse': 'Здание рухнуло!', 'kr.saveError': 'Не удалось прочитать сохранение',
    'kr.tut.smash.t': 'Круши!', 'kr.tut.smash.keyboard': 'Подойди к зданию и бей: {keys}', 'kr.tut.smash.touch': 'Подойди к зданию и жми кнопку удара',
    'kr.tut.breath.t': 'Атомный луч', 'kr.tut.breath.keyboard': 'Зажми {keys} и води лучом по домам', 'kr.tut.breath.touch': 'Зажми кнопку луча и поворачивайся',
    'kr.tut.slam.t': 'Прыжок-удар', 'kr.tut.slam.keyboard': 'Нажми {keys}: прыжок сносит всё вокруг', 'kr.tut.slam.touch': 'Нажми кнопку прыжка',
    'kr.tut.grow.t': 'Расти', 'kr.tut.grow.h': 'Разрушай город — кайдзю растёт и бьёт сильнее. За разрушения дают звёзды розыска: приедет армия.',
});
Object.assign(LANG_STRINGS.en, {
    'title': 'Kaiju Rampage Ultimate',
    'kr.play': 'Rampage!', 'kr.boost': 'Mega start: level 3', 'kr.forAd': 'Watch ad', 'kr.adIn': 'In {n} s', 'kr.noAds': 'Ads unavailable',
    'kr.shop': 'Shop', 'kr.daily': 'Gift', 'kr.wheel': 'Wheel', 'kr.howto': 'How to play', 'kr.settings': 'Settings',
    'kr.map.metro': 'Metro City', 'kr.map.harbor': 'Harbor Bay', 'kr.map.tokyo': 'Neon Tokyo', 'kr.map.desert': 'Mirage', 'kr.map.arctic': 'Polar Base',
    'kr.best': 'Best: {n}%', 'kr.locked': 'Destroy {n}% of {map}', 'kr.unlockAd': 'Unlock: watch ad {a}/{b}', 'kr.unlocked': 'Map unlocked!',
    'kr.level': 'Lv. {n}', 'kr.destroyed': '{n}%', 'kr.levelUp': 'Level {n}!', 'kr.grow': 'The kaiju grows!', 'kr.star': 'Wanted: {n}★',
    'kr.star1': 'Police are on the way!', 'kr.star2': 'SWAT and a helicopter!', 'kr.star3': 'Tanks roll into the city!', 'kr.star4': 'Attack helicopters!',
    'kr.star5': 'Fighter jets and rockets!', 'kr.star6': 'The whole army is after you!',
    'kr.attack': 'Smash', 'kr.breath': 'Beam', 'kr.slam': 'Slam',
    'kr.top': 'Leaderboard', 'kr.top.empty': 'No top players yet', 'kr.top.login': 'Sign in', 'kr.top.loading': 'Loading…', 'kr.top.err': 'Leaderboard is unavailable right now', 'kr.top.anon': 'Player',
    'kr.skills': 'Powers', 'kr.sk.claws': 'Claws & tail', 'kr.sk.claws.d': 'Claw strikes and a tail spin — the core of destruction',
    'kr.sk.slam': 'Ground slam', 'kr.sk.slam.d': 'A leap that flattens everything around', 'kr.sk.breath': 'Atomic beam', 'kr.sk.breath.d': 'The beam burns straight through buildings',
    'kr.sk.nova': 'Fire wave', 'kr.sk.nova.d': 'A ring of fire sets the blocks around you ablaze', 'kr.sk.meteor': 'Meteor shower', 'kr.sk.meteor.d': 'Meteors rain on the city ahead of you',
    'kr.sk.nuke': 'Nuclear blast', 'kr.sk.nuke.d': 'Wipes a whole district off the map', 'kr.sk.unlock': 'Unlocks at kaiju level {n} in a round',
    'kr.sk.level': 'Power {n} of {m}', 'kr.sk.up': 'Upgrade', 'kr.sk.max': 'Maxed', 'kr.sk.new': 'New power: {name}!',
    'kr.sk.bonus': 'Powers are bought with coins or unlocked with ads — and stay forever. Each upgrade: +20% damage, +7% radius, faster cooldown',
    'kr.sk.locked': 'Not owned — buy with coins or unlock with ads', 'kr.sk.bought': '{name} is yours! Ready from the round start', 'kr.sk.unlockAd': 'Unlock {a}/{b}', 'kr.sk.owned': 'From round start', 'kr.sk.buy': 'Buy', 'kr.sk.noCoins': 'Not enough coins', 'kr.sk.upDone': '{name}: power {n}!', 'kr.sk.adProgress': 'Watch ad {a}/{b}',
    'kr.offer.heal': 'Heal up', 'kr.offer.heal.s': 'Full health', 'kr.offer.calm': 'Lose the heat', 'kr.offer.calm.s': 'Minus 2 stars',
    'kr.offer.rage': 'Rage', 'kr.offer.rage.s': 'Damage x2 for 30 s', 'kr.healed': 'Health restored!', 'kr.calmed': 'The army falls back!', 'kr.rage': 'RAGE!',
    'kr.revive.t': 'The kaiju is down!', 'kr.revive': 'Revive', 'kr.revive.no': 'No, thanks', 'kr.revived': 'The kaiju is back!',
    'kr.win': 'City destroyed!', 'kr.lose': 'The kaiju is down', 'kr.ended': 'Round over',
    'kr.res.destroyed': 'Destroyed', 'kr.res.level': 'Level', 'kr.res.kills': 'Vehicles destroyed', 'kr.res.stars': 'Wanted', 'kr.res.time': 'Time',
    'kr.res.coins': 'Coins', 'kr.res.x2': 'Double', 'kr.res.again': 'Play again', 'kr.res.menu': 'Menu', 'kr.res.next': 'New map unlocked: {map}!',
    'kr.pause': 'Paused', 'kr.resume': 'Resume', 'kr.finish': 'End round', 'kr.sound': 'Sound', 'kr.quality': 'Graphics',
    'kr.q.auto': 'Auto', 'kr.q.low': 'Low', 'kr.q.medium': 'Medium', 'kr.q.high': 'High', 'kr.qNote': 'Graphics change from the next round',
    'kr.close': 'Close', 'kr.loadingMap': 'The city wakes up…', 'kr.combo': 'Combo x{n}', 'kr.collapse': 'Building down!', 'kr.saveError': 'Could not read the save',
    'kr.tut.smash.t': 'Smash!', 'kr.tut.smash.keyboard': 'Walk up to a building and hit: {keys}', 'kr.tut.smash.touch': 'Walk up to a building and tap the smash button',
    'kr.tut.breath.t': 'Atomic beam', 'kr.tut.breath.keyboard': 'Hold {keys} and sweep the beam over buildings', 'kr.tut.breath.touch': 'Hold the beam button and turn',
    'kr.tut.slam.t': 'Ground slam', 'kr.tut.slam.keyboard': 'Press {keys}: the slam flattens everything around', 'kr.tut.slam.touch': 'Tap the slam button',
    'kr.tut.grow.t': 'Grow', 'kr.tut.grow.h': 'Destroy the city: the kaiju grows and hits harder. Destruction raises your wanted stars — the army will come.',
});

/** @satisfies {Record<string, any>} */
const Game = {
    /** @type {LoryApp | null} */ app: null,
    /** @type {any} */ save: null,
    /** @type {'boot' | 'menu' | 'play' | 'dead' | 'result'} */ state: 'boot',
    mapId: 'metro', menuMap: 'metro', cityDirty: false, busy: false, shop: false,
    /** Цель камеры: x, y — карта, h — высота (CameraController.follow). */
    cam: { x: 0, y: 0, h: 0, frameHeight: 1000, frameWidth: 0 },
    shakeAmp: 0, shakeT: 0, shakeDur: 1, lookIdle: 0, hudT: 0, winAt: 0.88,
    /** @type {any} */ run: null,
    /** @type {any} */ offer: null,
    /** @type {Record<string, number>} */ offerCd: { heal: 0, calm: 0, rage: 25 },
    reviveT: 0, prefPitch: 0.34,
    spawn: { x: 0, z: 0, heading: 0 },

    // ---------------------------------------------------------------------------------------------
    // Запуск
    // ---------------------------------------------------------------------------------------------

    /** Первая карта — та, на которой игрок остановился (main.js зовёт до init). */
    async firstMap() {
        const s = await Platform.load();
        return s && typeof s.lastMap === 'string' ? s.lastMap : 'metro';
    },

    async init(app) {
        this.app = app;
        let saved = null;
        try { saved = await Platform.load(); } catch (e) { console.warn('Platform.load:', e); }
        this.save = Object.assign({ v: 1, tutorialDone: false, lastMap: 'metro', maps: {}, stats: { runs: 0, bricks: 0, kills: 0, bestStars: 0 } }, saved || {});
        for (const m of KR.MAPS) this.save.maps[m.id] = Object.assign({ best: 0, ads: 0, open: m.unlock === 0 }, this.save.maps[m.id]);
        this.save.skills = Object.assign({ claws: 1, slam: 1, breath: 1, nova: 1, meteor: 1, nuke: 1 }, this.save.skills);
        this.save.skillAds = Object.assign({}, this.save.skillAds);
        this.save.skillOwn = Object.assign({}, this.save.skillOwn, { claws: true, slam: true });
        this.save.skillBuyAds = Object.assign({}, this.save.skillBuyAds);
        GameKaiju.skillLv = this.save.skills;
        GameKaiju.skillOwn = this.save.skillOwn;
        this.mapId = app.location.map.id;
        this.menuMap = this.mapOpen(this.mapId) ? this.mapId : 'metro';

        GameStyle.init();
        HudLayout.init({ app });
        Input.init({
            app, mouse: 'drag',
            actions: Object.assign({}, Input.DEFAULTS, {
                attack: { keys: ['Mouse0', 'KeyJ'], pad: [2] }, breath: { keys: ['KeyE', 'KeyK'], pad: [7] }, slam: { keys: ['Space'], pad: [0] },
                nova: { keys: ['KeyQ'], pad: [1] }, meteor: { keys: ['KeyR'], pad: [3] }, nuke: { keys: ['KeyF'], pad: [5] },
                jump: { keys: [] }, interact: { keys: [] }, pause: { keys: Platform.name === 'playgama' ? ['KeyP'] : ['Escape', 'KeyP'], pad: [9] },      // Playgama 1.5.2: без Esc
            }),
        });
        // Камера всегда идёт за кайдзю: средняя кнопка мыши её не перетаскивает, колесо не отдаляет.
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        canvas.addEventListener('pointerdown', (e) => { if (e.button === 1) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, true);
        canvas.addEventListener('wheel', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, passive: false });
        // Тени и дальность под масштаб гиганта: свет дальше, кадр теней шире.
        const view = app.location.view;
        View3D.LIGHT_DIST = 12000;
        view.sun.shadowMinZ = 2500; view.sun.shadowMaxZ = 21500;

        // @ts-ignore — GameAudio объявляет js/GameAudio.js
        if (typeof GameAudio !== 'undefined') { try { GameAudio.init(); GameAudio.prepare('menu'); } catch (e) { console.warn('GameAudio:', e); } }
        FX('init', app);
        GameUI.init(this);
        // Магазин, подарок дня, колесо (их окна — GameShopUI); облик кайдзю — из надетого.
        // @ts-ignore — GameShopUI объявляет js/GameShopUI.js
        if (typeof GameShopUI !== 'undefined') { try { GameShopUI.init({ app, save: this.save, persist: () => this.persist() }); } catch (e) { console.warn('GameShopUI.init:', e); } }
        GameKaiju.look = this.lookNow();
        this.initClickAds(false);
        // Загрузка карты не застревает: готовность сцены (шейдеры) ждём не дольше READY_WAIT, а не дождались — карта
        // всё равно показывается (шейдер доберётся сам), вместо экрана «не удалось загрузить».
        Location3D.READY_TIMEOUT = this.READY_WAIT;
        const ready = LoadingScreen.ready.bind(LoadingScreen);
        LoadingScreen.ready = async (scene) => {
            try { await ready(scene); } catch (e) {
                console.warn('LoadingScreen.ready:', e && e.message);
                const canvas = document.getElementById('world3d'); if (canvas) canvas.style.visibility = 'visible';
                LoadingScreen.set(100, 'loadingReady');
            }
        };

        GameCity.hooks.score = (p, x, y, z, kind) => this.addScore(p, x, y, z, kind, 0);
        GameCity.hooks.collapse = (b, n) => this.onCollapse(b, n);
        GameCity.hooks.blast = (x, y, z, r, dmg, own) => { GameArmy.blast(x, y, z, r, dmg); GameTraffic.blast(x, y, z, r, dmg); GameCrowd.blast(x, y, z, r, dmg); if (dmg > 0 && !own && GameKaiju.alive && this.state === 'play' && Math.hypot(GameKaiju.x - x, GameKaiju.z - z) < r * 0.7) GameKaiju.hurt(dmg * 0.12, x, y, z, 'bomb'); };
        GameKaiju.hooks.hit = (x, y, z, r, dmg) => { GameArmy.hitSphere(x, y, z, r, dmg); GameTraffic.hitSphere(x, y, z, r, dmg); GameCrowd.hitSphere(x, y, z, r, dmg); };
        GameKaiju.hooks.beam = (ax, ay, az, bx, by, bz, r, dmg) => { GameArmy.hitBeam(ax, ay, az, bx, by, bz, r, dmg); GameTraffic.hitBeam(ax, ay, az, bx, by, bz, r, dmg); GameCrowd.hitBeam(ax, ay, az, bx, by, bz, r, dmg); };
        GameKaiju.hooks.trample = (x, z, r) => { const d = GameKaiju.damage() * 0.9; GameArmy.trample(x, z, r, d); GameTraffic.trample(x, z, r, d); GameCrowd.trample(x, z, r, d); };
        GameKaiju.hooks.step = (x, z, r) => { const d = GameKaiju.damage(); GameArmy.trample(x, z, r, d); GameTraffic.trample(x, z, r, d); GameCrowd.trample(x, z, r, d); };
        GameKaiju.hooks.blast = (x, y, z, r, dmg) => { GameArmy.blast(x, y, z, r, dmg); GameTraffic.blast(x, y, z, r, dmg); GameCrowd.blast(x, y, z, r, dmg); };
        GameKaiju.hooks.died = () => this.onDied();
        GameKaiju.hooks.levelUp = (level) => { GameUI.toast(T('kr.levelUp', { n: level }), 1500, 'teal'); if (this.run) this.run.level = level; };
        GameKaiju.hooks.unlock = null;      // умения больше не открываются уровнем: только покупка в меню
        GameArmy.hooks.score = (p, x, y, z, kind, coins) => this.addScore(p, x, y, z, kind, coins || 0);
        GameTraffic.hooks.score = GameCrowd.hooks.score = GameArmy.hooks.score;
        GameArmy.hooks.stars = (n, up) => this.onStars(n, up);

        await this.prepareMap(app);

        Tutorial.init({
            app, state: () => this.save, field: 'tutorialDone', persist: () => this.persist(),
            steps: [
                Tutorial.preset('move'), Tutorial.preset('look'),
                { id: 'smash', title: 'kr.tut.smash.t', hint: { keyboard: 'kr.tut.smash.keyboard', touch: 'kr.tut.smash.touch' }, keys: { keyboard: ['attack'], pad: ['attack'] }, event: 'smash', target: { touch: '#kr-act-attack' } },
                { id: 'slam', title: 'kr.tut.slam.t', hint: { keyboard: 'kr.tut.slam.keyboard', touch: 'kr.tut.slam.touch' }, keys: { keyboard: ['slam'], pad: ['slam'] }, action: 'slam', target: { touch: '#kr-act-slam' } },
                { id: 'grow', title: 'kr.tut.grow.t', hint: 'kr.tut.grow.h', check: (/** @type {any} */ ctx) => ctx.time > 5 || GameKaiju.level > 1, target: '#kr-grow' },
            ],
        });
        window.addEventListener('lory-release-input', () => this.releaseActs());
        if (typeof Quality !== 'undefined') Quality.onChange(() => { this.cityDirty = true; FX('setQuality', KR.quality()); });
        Platform.onAd(() => GameUI.refreshOffer());
        this.toMenu();
    },

    async ready() { Platform.gameplay(false); },

    /** Город, обломки, техника и кайдзю текущей карты — под экраном загрузки (повторяемо). */
    async prepareMap(app) {
        const loc = app.location, base = loc.map.terrain && Number.isFinite(loc.map.terrain.base) ? loc.map.terrain.base : 0;
        this.mapId = loc.map.id;
        const info = KR.mapInfo(this.mapId);
        // Свои краски земли (маркеры paint-<тип> карт)
        Object.assign(Terrain3D.PAINT_COLORS, { park: 0x5fb04a, asphalt: 0x3c3f46, concrete: 0xb9bbb8, beach: 0xf0dca0 });
        await GamePhysics.init();
        GamePhysics.reset({ ground: base, width: loc.width, height: loc.height });
        GameDebris.init(loc.view, loc.width, loc.height, base);
        GameDebris.lifeScale = IS_MOBILE ? 0.6 : 1;
        await GameCity.build(app);
        await GameArmy.build(app);
        await GameTraffic.build(app);
        await GameCrowd.build(app);
        await GameLook.build(app);
        await GameKaiju.setSpecies(app, (this.lookNow().species) || 'titan');
        const sp = loc.marker('spawn');
        const sx = sp ? sp.x : loc.width / 2, sz = sp ? sp.y : loc.height / 2, sh = sp && sp.rot ? (sp.rot[1] || 0) * Math.PI / 180 : 0;
        this.spawn = { x: sx, z: sz, heading: sh };
        GameKaiju.reset(sx, sz, sh, 1);
        GameKaiju.y = loc.terrain.fieldHeight(sx, sz);
        GameKaiju.syncRoot();
        // светящиеся материалы моделей карты (лампы, неон)
        for (const m of loc.view.scene.materials) {
            const name = String(m.name).split('/').pop() || '';
            if (/^glow/.test(name) && /** @type {any} */ (m).diffuseColor) /** @type {any} */ (m).emissiveColor = /** @type {any} */ (m).diffuseColor.scale(info.lit > 0.5 ? 1 : 0.7);
        }
        FX('onMap', app);
        FX('weather', info.weather);
        FX('setQuality', KR.quality());
        this.cityDirty = false;
        const cam = app.camera;
        cam.follow(this.cam);
        cam.azimuth = sh;
        cam.pitch = 0.3;
        this.syncCam(0);
        if (cam.snap) cam.snap(this.cam.x, this.cam.y, this.cam.h);
    },

    persist() { try { Platform.save(this.save); } catch (e) { console.warn('Platform.save:', e); } },

    /**
     * «Войдите в аккаунт» в окне рекордов: окно входа площадки только по нажатию. После входа — сохранение аккаунта:
     * если в нём прогресса больше нынешнего, игра перезапускается с ним; иначе нынешний прогресс уходит в аккаунт.
     */
    async loginTop() {
        if (this.busy) return;
        this.busy = true;
        let ok = false;
        try { ok = await Platform.login(); } catch (e) { ok = false; } finally { this.busy = false; }
        if (!ok) return;
        let saved = null;
        try { saved = await Platform.load(); } catch (e) { saved = null; }
        if (saved && saved.stats && (saved.stats.runs || 0) > (this.save.stats.runs || 0)) { location.reload(); return; }
        this.persist();
        GameUI.loadTop(true);
    },

    releaseActs() { for (const a of ['attack', 'breath', 'slam', 'nova', 'meteor', 'nuke']) Input.setVirtual(a, false); },

    // ---------------------------------------------------------------------------------------------
    // Умения: прокачка в меню за монеты или за рекламу (несколько просмотров на уровень)
    // ---------------------------------------------------------------------------------------------

    /** Карточка умения для окна «Умения». */
    // --- Межстраничная реклама по кнопкам интерфейса (просьба пользователя) ---------------------------------
    // Сборка playables — на каждый клик по кнопке интерфейса; остальные площадки — по кнопкам меню CLICK_AD_MENU
    // (магазин, подарок, колесо, умения, рекорды, звук, настройки). Никогда — во время раунда (play, dead), на кнопках
    // rewarded-рекламы и при рекламе на экране. Сначала запрос рекламы, потом действие кнопки (клик повторяется).
    // Показывать ли — решает площадка (её лимиты частоты): нет рекламы — действие сразу. Правило двух раундов
    // (Platform.ads.next) после такой рекламы не добавляет вторую подряд. Локально: force = true (проверка с ?mockads).
    CLICK_AD_SEL: 'button, [data-act], [data-a], .kr-btn',
    CLICK_AD_REWARDED: ['boost', 'double', 'offer', 'revive', 'unlock', 'coinsad', 'spin-ad', 'x2'],
    CLICK_AD_WAIT: 45,      // с: страховка, если SDK не ответит — действие кнопки всё равно выполнится
    CLICK_AD_MENU: ['shop', 'daily', 'wheel', 'skills', 'top', 'sound', 'settings'],
    READY_WAIT: 6000,       // мс: сколько ждать готовности шейдеров новой карты на этапе её объектов

    initClickAds(force) {
        if (this._clickAds || !Platform.interstitialSupported()) return;
        this._clickAds = true;
        const every = force || Platform.name === 'playables';
        let busy = false, replay = false;
        const rewardedBtn = (/** @type {HTMLElement} */ el) => {
            const a = String(el.dataset.act || el.dataset.a || '');
            return this.CLICK_AD_REWARDED.includes(a) || a.indexOf('sk-ad-') === 0 || a.indexOf('sk-getad-') === 0
                || !!el.querySelector('img[src*="ic_ad"], .kr-ad, .krs-adp');
        };
        document.addEventListener('click', async (e) => {
            if (replay || !e.isTrusted) return;
            const t = /** @type {HTMLElement} */ (e.target);
            const el = /** @type {HTMLElement | null} */ (t && t.closest ? t.closest(this.CLICK_AD_SEL) : null);
            if (!el || el.closest('#world3d')) return;
            if (busy) { e.stopImmediatePropagation(); e.preventDefault(); return; }
            if (this.state === 'play' || this.state === 'dead' || Platform.adActive || rewardedBtn(el)) return;
            if (!every && !this.CLICK_AD_MENU.includes(String(el.dataset.act || ''))) return;
            if (/** @type {HTMLButtonElement} */ (el).disabled || el.classList.contains('is-off')) return;
            e.stopImmediatePropagation(); e.preventDefault();
            busy = true;
            try {
                await Promise.race([Platform.interstitial(), new Promise((r) => setTimeout(r, this.CLICK_AD_WAIT * 1000))]);
            } catch (err) { /* нет рекламы — просто действие */ }
            Platform.ads.results = 0;
            busy = false;
            // Меню перерисовывается (таймер rewarded, язык) — та же кнопка могла смениться новой: ищем её по действию
            let go = el;
            if (!go.isConnected) {
                const a = el.dataset.act != null ? '[data-act="' + el.dataset.act + '"]' : el.dataset.a != null ? '[data-a="' + el.dataset.a + '"]' : el.id ? '#' + el.id : '';
                go = a ? /** @type {HTMLElement | null} */ (document.querySelector(a)) : null;
            }
            if (!go) return;
            replay = true;
            try { go.click(); } finally { replay = false; }
        }, true);
    },

    skillCard(id) {
        const k = KR.SKILLS[id], lv = this.save.skills[id] || 1, max = lv >= KR.SKILL_MAX;
        return { id, icon: k.icon, name: T('kr.sk.' + id), desc: T('kr.sk.' + id + '.d'), unlock: k.unlock, level: lv, max, cost: max ? 0 : KR.SKILL_COST[lv], ads: this.save.skillAds[id] || 0, adNeed: max ? 0 : KR.SKILL_ADS[lv],
            owned: !!this.save.skillOwn[id], buy: k.buy || 0, buyAds: k.buyAds || 0, buyAdsDone: this.save.skillBuyAds[id] || 0 };
    },

    /** Есть ли что купить или улучшить на имеющиеся монеты (точка на кнопке «Умения»). */
    skillsAffordable() {
        const coins = this.coins();
        for (const id of Object.keys(KR.SKILLS)) { const c = this.skillCard(id); if (!c.owned ? coins >= c.buy : (!c.max && coins >= c.cost)) return true; }
        return false;
    },

    _skillOwn(id) {
        this.save.skillOwn[id] = true;
        this.save.skillBuyAds[id] = 0;
        this.persist();
        SFX('reward', { volume: 0.8 });
        GameUI.toast(T('kr.sk.bought', { name: T('kr.sk.' + id) }), 2400, 'teal');
        try { Platform.analytics('skill_buy', { id }); } catch (e) { /* аналитика не обязана работать */ }
    },

    /** Купить умение навсегда за монеты. */
    buySkill(id) {
        const c = this.skillCard(id);
        if (c.owned || typeof Shop === 'undefined' || !Shop.state) return;
        if (Shop.coins < c.buy) { SFX('ui_error'); GameUI.toast(T('kr.sk.noCoins'), 1500, 'red'); return; }
        Shop.spend(c.buy, { save: false });
        this._skillOwn(id);
        GameUI.renderSkills(); GameUI.renderPlay();
    },

    /** Открыть умение за просмотры рекламы (нужно buyAds просмотров, счёт копится). */
    async buySkillAd(id) {
        const c = this.skillCard(id);
        if (c.owned || this.busy) return;
        this.busy = true;
        const ok = await Platform.rewarded('skill-unlock');
        this.busy = false;
        if (ok) {
            this.save.skillBuyAds[id] = (this.save.skillBuyAds[id] || 0) + 1;
            if (this.save.skillBuyAds[id] >= c.buyAds) this._skillOwn(id); else { this.persist(); SFX('coin'); }
        }
        GameUI.renderSkills(); GameUI.renderPlay();
    },

    _skillUp(id) {
        this.save.skills[id] = Math.min(KR.SKILL_MAX, (this.save.skills[id] || 1) + 1);
        this.save.skillAds[id] = 0;
        this.persist();
        SFX('ui_buy');
        GameUI.toast(T('kr.sk.upDone', { name: T('kr.sk.' + id), n: this.save.skills[id] }), 1800, 'teal');
    },

    upgradeSkill(id) {
        const c = this.skillCard(id);
        if (c.max || typeof Shop === 'undefined' || !Shop.state) return;
        if (Shop.coins < c.cost) { SFX('ui_error'); GameUI.toast(T('kr.sk.noCoins'), 1500, 'red'); return; }
        Shop.spend(c.cost, { save: false });
        this._skillUp(id);
        GameUI.renderSkills();
    },

    async upgradeSkillAd(id) {
        const c = this.skillCard(id);
        if (c.max || this.busy) return;
        this.busy = true;
        const ok = await Platform.rewarded('skill-up');
        this.busy = false;
        if (ok) {
            this.save.skillAds[id] = (this.save.skillAds[id] || 0) + 1;
            if (this.save.skillAds[id] >= c.adNeed) this._skillUp(id); else { this.persist(); SFX('coin'); }
        }
        GameUI.renderSkills();
    },

    // Облик из надетых вещей магазина.
    lookNow() {
        // @ts-ignore — GameCosmetics и Shop: js/GameShopData.js, js/Shop.js
        if (typeof GameCosmetics !== 'undefined' && typeof Shop !== 'undefined' && Shop.state) { try { return GameCosmetics.look(Shop.look()) || {}; } catch (e) { console.warn('GameCosmetics.look:', e); } }
        return {};
    },

    /** Магазин сменил надетое или примерку. */
    applyLook() { GameKaiju.applyLook(this.lookNow()); },

    /** Камера магазина: кайдзю крупно, слева (альбом) или сверху (портрет) от панели. */
    shopView(on) {
        this.shop = !!on;
        if (!on) return;
        // Вид спереди-сбоку; из нескольких направлений берётся то, где кайдзю не заслоняют дома.
        const cam = /** @type {LoryApp} */ (this.app).camera, base = GameKaiju.heading + Math.PI;
        let best = base + 0.55, bestNeed = 9;
        for (const da of [0.55, -0.55, 0.25, -0.25, 0.95, -0.95, 1.5, -1.5, 2.3, -2.3, Math.PI]) {
            cam.azimuth = base + da;
            const need = this.clearPitch();
            if (need < bestNeed - 0.05) { bestNeed = need; best = base + da; }
            if (need < 0.18) break;
        }
        cam.azimuth = best;
    },

    coins() { return typeof Shop !== 'undefined' && Shop.state ? Shop.coins : 0; },

    // ---------------------------------------------------------------------------------------------
    // Карты
    // ---------------------------------------------------------------------------------------------

    mapOpen(id) {
        const i = KR.MAPS.findIndex(m => m.id === id);
        if (i <= 0) return true;
        const rec = this.save.maps[id], prev = this.save.maps[KR.MAPS[i - 1].id];
        return !!(rec && rec.open) || (prev && prev.best >= KR.MAPS[i].unlock);
    },

    /** Данные карточки карты для меню. */
    mapCard(id) {
        const i = KR.MAPS.findIndex(m => m.id === id), info = KR.MAPS[i], rec = this.save.maps[id];
        return { id, index: i, count: KR.MAPS.length, name: T('kr.map.' + id), open: this.mapOpen(id), best: Math.round(rec.best), need: info.unlock, ads: rec.ads, adNeed: info.adUnlock, prev: i > 0 ? T('kr.map.' + KR.MAPS[i - 1].id) : '' };
    },

    selectMap(delta) {
        const i = KR.MAPS.findIndex(m => m.id === this.menuMap), n = (i + delta + KR.MAPS.length) % KR.MAPS.length;
        this.menuMap = KR.MAPS[n].id;
        SFX('ui_click');
        GameUI.renderMenu();
    },

    /** Открыть выбранную карту за рекламу (несколько просмотров, прогресс сохраняется). */
    async unlockByAd() {
        const id = this.menuMap, rec = this.save.maps[id], info = KR.mapInfo(id);
        if (this.busy || this.mapOpen(id)) return;
        this.busy = true;
        const ok = await Platform.rewarded('map-unlock');
        this.busy = false;
        if (ok) {
            rec.ads++;
            if (rec.ads >= info.adUnlock) { rec.open = true; SFX('reward'); GameUI.toast(T('kr.unlocked')); }
            this.persist();
        }
        GameUI.renderMenu();
    },

    // ---------------------------------------------------------------------------------------------
    // Состояния
    // ---------------------------------------------------------------------------------------------

    toMenu() {
        this.state = 'menu';
        this.run = null; this.offer = null;
        GameArmy.active = false;
        if (GameKaiju.rig) {
            const sp = this.spawn, K = GameKaiju;
            K.reset(sp.x, sp.z, sp.heading, 1);
            K.y = /** @type {LoryApp} */ (this.app).location.terrain.fieldHeight(sp.x, sp.z);
            K.syncRoot();
            GameArmy.resetRound(); GameTraffic.resetRound(); GameCrowd.resetRound();
            FX('clear');
            FX('aura', (K.look && K.look.aura) || null);
        }
        Platform.gameplay(false);
        Input.configure({ controls: false });
        GameUI.showHud(false); GameUI.showResult(null); GameUI.showRevive(false); GameUI.showPause(false);
        GameUI.showMenu(true);
        GameUI.renderMenu();
        this.music('menu', 0);
        // Подарок дня — в меню после обучения
        // @ts-ignore — GameShopUI объявляет js/GameShopUI.js
        if (typeof GameShopUI !== 'undefined' && this.save.tutorialDone) Tutorial.whenIdle(() => { if (this.state === 'menu') { try { GameShopUI.maybeOfferDaily(); } catch (e) { /* */ } } });
    },

    music(track, intensity) {
        // @ts-ignore — GameAudio объявляет js/GameAudio.js
        const A = typeof GameAudio !== 'undefined' ? GameAudio : null;
        if (!A) return;
        try { if (track !== undefined) A.music(track); if (intensity != null) A.setIntensity(intensity); } catch (e) { /* */ }
    },

    /** «Крушить!»: boost — старт с 3-го уровня (награда за рекламу уже получена). */
    async play(boost) {
        if (this.state !== 'menu' || this.busy) return;
        const id = this.menuMap;
        if (!this.mapOpen(id)) { SFX('ui_error'); return; }
        this.busy = true;
        SFX('ui_open');
        // @ts-ignore — GameShopUI объявляет js/GameShopUI.js
        if (typeof GameShopUI !== 'undefined' && GameShopUI.isOpen()) GameShopUI.close();
        const app = /** @type {LoryApp} */ (this.app);
        try {
            if (id !== this.mapId || this.cityDirty) {
                GameUI.showMenu(false);
                await app.loadMap(id, { prepare: (a) => this.prepareMap(a), label: T('kr.loadingMap') });
            }
        } catch (e) { console.warn('loadMap:', e); this.busy = false; this.toMenu(); return; }
        this.busy = false;
        this.startRun(boost ? 3 : 1);
    },

    async playBoost() {
        if (this.state !== 'menu' || this.busy || !this.mapOpen(this.menuMap)) return;
        this.busy = true;
        const ok = await Platform.rewarded('start-boost');
        this.busy = false;
        if (ok) this.play(true); else GameUI.renderMenu();
    },

    startRun(level) {
        const K = GameKaiju, sp = this.spawn;
        this.state = 'play';
        this.cityDirty = true;
        this.save.lastMap = this.mapId; this.save.stats.runs++;
        this.persist();
        this.run = { time: 0, points: 0, xp: KR.LEVELS[level - 1].xp, coinF: 0, kills: 0, level, maxStars: 0, revives: 0, bricks: 0, combo: 0, comboT: 0, ended: false, doubled: false, coins: 0 };
        this.offer = null; this.offerCd = { heal: 6, calm: 10, rage: 28 };
        K.reset(sp.x, sp.z, sp.heading, level);
        K.y = /** @type {LoryApp} */ (this.app).location.terrain.fieldHeight(sp.x, sp.z);
        K.skillLv = this.save.skills; K.skillOwn = this.save.skillOwn;
        K.invuln = 2; K.roarT = 0.7;
        SFX('roar', { volume: 1 });
        GameArmy.resetRound(); GameTraffic.resetRound(); GameCrowd.resetRound(); GameArmy.active = true;
        FX('clear');
        FX('aura', (GameKaiju.look && GameKaiju.look.aura) || null);
        const cam = /** @type {LoryApp} */ (this.app).camera;
        cam.azimuth = sp.heading; cam.pitch = this.prefPitch = 0.34;
        GameUI.showMenu(false); GameUI.showResult(null); GameUI.showHud(true);
        Input.configure({ controls: true });
        Platform.gameplay(true);
        if (typeof Telemetry !== 'undefined') Telemetry.progress('started', this.mapId);
        this.music(this.mapId, 0);
        if (!this.save.tutorialDone) Tutorial.autoStart();
    },

    howTo() {
        if (Pause.has('manual')) this.togglePause();
        if (this.state === 'menu') { this.play(false).then(() => Tutorial.start({ replay: true })); return; }
        if (this.state === 'play') Tutorial.start({ replay: true });
    },

    togglePause() {
        if (this.state !== 'play' && !Pause.has('manual')) return;
        const on = !Pause.has('manual');
        Pause.set('manual', on);
        GameUI.showPause(on);
        SFX('ui_click');
    },

    /** Кайдзю погиб: предложить возрождение за рекламу (до двух раз за раунд). */
    onDied() {
        if (this.state !== 'play') return;
        this.state = 'dead';
        GameArmy.active = false;
        this.offer = null; GameUI.setOffer(null);
        this.releaseActs();
        const can = Platform.rewardedSupported() && this.run.revives < 2 && Tutorial.roundCounts();
        this.reviveT = can ? 9 : 2.2;
        setTimeout(() => { if (this.state === 'dead' && can) GameUI.showRevive(true); }, 1500);
    },

    async revive() {
        if (this.state !== 'dead' || this.busy) return;
        this.busy = true;
        this.reviveT = 1e9;
        const ok = await Platform.rewarded('revive');
        this.busy = false;
        if (this.state !== 'dead') return;
        if (!ok) { this.reviveT = 4; GameUI.showRevive(true); return; }
        this.run.revives++;
        GameUI.showRevive(false);
        GameKaiju.revive();
        GameArmy.shots = [];
        GameArmy.reduceStars(1);
        GameArmy.active = true;
        this.state = 'play';
        GameUI.toast(T('kr.revived'));
        this.music(undefined, GameArmy.stars);
    },

    /** Конец раунда: win — город уничтожен. */
    endRun(win) {
        const r = this.run;
        if (!r || r.ended) return;
        r.ended = true;
        this.state = 'result';
        GameArmy.active = false;
        Pause.set('manual', false);
        GameUI.showPause(false); GameUI.showRevive(false); GameUI.setOffer(null); this.offer = null;
        this.releaseActs();
        Input.configure({ controls: false });
        Platform.gameplay(false);
        const pct = Math.min(100, GameCity.destroyed() * 100 / this.winAt);
        const rec = this.save.maps[this.mapId], wasOpen = KR.MAPS.map(m => this.mapOpen(m.id));
        r.coins = Math.round(r.coinF * (win ? 1.5 : 1)) + (win ? 500 : 0);
        if (typeof Shop !== 'undefined' && Shop.state) Shop.addCoins(r.coins, { save: false });
        rec.best = Math.max(rec.best, win ? 100 : pct);
        const st = this.save.stats;
        st.bricks += r.bricks; st.kills += GameArmy.kills; st.bestStars = Math.max(st.bestStars, GameArmy.maxStars);
        this.persist();
        const opened = KR.MAPS.find((m, i) => !wasOpen[i] && this.mapOpen(m.id));
        if (Tutorial.active) Tutorial.finish('abort');
        if (Tutorial.roundCounts()) Platform.ads.roundEnded(!!win);
        Platform.submitScore(Math.round(r.points));
        if (typeof Telemetry !== 'undefined') Telemetry.progress(win ? 'completed' : 'failed', this.mapId);
        SFX(win ? 'victory' : 'gameover', { volume: 0.9 });
        this.music(undefined, 0);
        GameUI.showHud(false);
        GameUI.showResult({ win, died: !GameKaiju.alive, pct: Math.round(win ? 100 : pct), level: GameKaiju.level, kills: GameArmy.kills, stars: GameArmy.maxStars, time: r.time, coins: r.coins, opened: opened ? T('kr.map.' + opened.id) : '' });
    },

    /** Удвоить монеты раунда за рекламу (один раз). */
    async doubleCoins() {
        const r = this.run;
        if (!r || r.doubled || this.busy || this.state !== 'result') return;
        this.busy = true;
        const ok = await Platform.rewarded('result-x2');
        this.busy = false;
        if (ok && !r.doubled) {
            r.doubled = true;
            if (typeof Shop !== 'undefined' && Shop.state) Shop.addCoins(r.coins, { save: false });
            this.persist();
            SFX('reward');
            GameUI.resultDoubled(r.coins * 2);
        } else GameUI.resultRefresh();
    },

    again() { Platform.ads.next(() => { this.state = 'menu'; this.menuMap = this.mapId; GameUI.showResult(null); this.play(false); }); },
    menu() { Platform.ads.next(() => this.toMenu()); },

    // ---------------------------------------------------------------------------------------------
    // Очки, рост, розыск
    // ---------------------------------------------------------------------------------------------

    addScore(points, x, y, z, kind, coins) {
        const r = this.run;
        if (!r || this.state === 'result' || this.state === 'menu') return;
        const K = GameKaiju;
        r.points += points; r.xp += points;
        r.coinF += points * 0.3 + (coins || 0);
        if (kind === 'brick') { r.bricks++; if (!this.save.tutorialDone || Tutorial.active) Tutorial.complete('smash'); }
        if (kind !== 'unit') GameArmy.addHeat(points);
        if (K.alive) { K.heal(points * KR.LIFESTEAL * (1 + K.level * 0.18)); K.energy = Math.min(1, K.energy + points * 0.004); }
        const level = Math.min(KR.LEVELS.length, KR.levelOf(r.xp));
        if (level > K.level && K.alive) K.setLevel(level);
        // крупные события — всплывающие очки и монеты
        if (kind === 'unit' || (kind === 'prop' && points >= 10)) {
            FX('floatText', x, y + 30, z, '+' + Math.round(points), kind === 'unit' ? '#FF4B1F' : '#FFC400');
            if (coins || points >= 20) FX('coinBurst', x, y, z, Math.min(12, 2 + Math.round((coins || points * 0.3) / 4)));
        }
    },

    onCollapse(b, n) {
        const r = this.run;
        if (!r || this.state !== 'play') return;
        const bonus = Math.round(b.total * 0.2);
        r.coinF += bonus * 0.5;
        r.combo = r.comboT > 0 ? r.combo + 1 : 1; r.comboT = 3;
        FX('floatText', b.x, GameCity.base + Math.min(b.h, GameKaiju.height) + 40, b.z, r.combo > 1 ? T('kr.combo', { n: r.combo }) : '+' + (bonus + n), '#29E0C8');
        FX('coinBurst', b.x, GameCity.base + 40, b.z, Math.min(14, 3 + Math.round(bonus / 6)));
        FX('shake', Math.min(0.8, 0.2 + b.total * 0.004), 450);
    },

    onStars(n, up) {
        if (this.run) this.run.maxStars = Math.max(this.run.maxStars, n);
        GameUI.stars(n, up);
        if (up && this.state === 'play') { GameUI.toast(T('kr.star' + n), 2600, 'red'); FX('flash', '#ff2a2a', 0.22, 260); }
        this.music(undefined, n);
    },

    // ---------------------------------------------------------------------------------------------
    // Предложения «за рекламу» в раунде: лечение, сброс розыска, ярость
    // ---------------------------------------------------------------------------------------------

    updateOffers(dt) {
        const K = GameKaiju, cd = this.offerCd;
        for (const k of Object.keys(cd)) if (cd[k] > 0) cd[k] -= dt;
        if (this.offer) {
            this.offer.t -= dt;
            if (this.offer.t <= 0 && !this.busy) { cd[this.offer.id] = 22; this.offer = null; GameUI.setOffer(null); }
            return;
        }
        if (!K.alive || Tutorial.active || !Platform.rewardedSupported() || !Platform.rewardedReady() || this.run.time < 12) return;
        let id = '';
        if (cd.heal <= 0 && K.hp < K.maxHp * 0.38) id = 'heal';
        else if (cd.calm <= 0 && GameArmy.stars >= 3) id = 'calm';
        else if (cd.rage <= 0 && K.rage <= 0) id = 'rage';
        if (!id) return;
        this.offer = { id, t: 11, dur: 11 };
        GameUI.setOffer(this.offer);
        SFX('ui_open', { volume: 0.5 });
    },

    async takeOffer() {
        const o = this.offer;
        if (!o || this.busy || this.state !== 'play') return;
        this.busy = true;
        o.t = 1e9;
        const ok = await Platform.rewarded('offer-' + o.id);
        this.busy = false;
        this.offer = null; GameUI.setOffer(null);
        const K = GameKaiju;
        this.offerCd[o.id] = ok ? 70 : 25;
        if (!ok || this.state !== 'play' || !K.alive) return;
        if (o.id === 'heal') { K.hp = K.maxHp; K.invuln = Math.max(K.invuln, 3); GameUI.toast(T('kr.healed'), 2000, 'teal'); SFX('heal'); FX('levelUp', K.x, K.y, K.z, K.height); }
        else if (o.id === 'calm') { GameArmy.reduceStars(2); GameUI.toast(T('kr.calmed'), 2000, 'teal'); SFX('reward'); }
        else { K.rage = 30; K.roarT = 1.2; GameUI.big(T('kr.rage'), 'red'); SFX('roar_big'); FX('flash', '#ff4b1f', 0.3, 300); }
    },

    // ---------------------------------------------------------------------------------------------
    // Кадр
    // ---------------------------------------------------------------------------------------------

    /** Тряска камеры: amount 0..1 (доля роста кайдзю), ms — длительность. */
    addShake(amount, ms) {
        const a = Math.max(0, Math.min(1, amount || 0));
        if (a * 1.0 >= this.shakeAmp * (this.shakeT > 0 ? this.shakeT / this.shakeDur : 0)) { this.shakeAmp = a; this.shakeDur = this.shakeT = Math.max(0.05, (ms || 200) / 1000); }
    },

    /** Наклон камеры, при котором дома между ней и кайдзю не заслоняют его: луч взгляда идёт выше крыш. */
    clearPitch() {
        const K = GameKaiju, cam = /** @type {LoryApp} */ (this.app).camera, H = K.height;
        const reach = cam.distance() * Math.cos(cam.pitch), ca = Math.cos(cam.azimuth), sa = Math.sin(cam.azimuth), ty = this.cam.h, side = H * 0.2;
        let need = 0;
        for (let i = 1; i <= 12; i++) {
            const d = H * 0.3 + (reach - H * 0.3) * i / 12, x = K.x - ca * d, z = K.z - sa * d;
            const top = Math.max(GameCity.heightAt(x, z), GameCity.heightAt(x - sa * side, z + ca * side), GameCity.heightAt(x + sa * side, z - ca * side)) + H * 0.1;
            if (top > ty) need = Math.max(need, Math.atan2(top - ty, d));
        }
        return Math.min(1.22, need);
    },

    syncCam(dt) {
        const K = GameKaiju, c = this.cam, H = K.height, app = /** @type {LoryApp} */ (this.app);
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        const portrait = canvas.clientHeight > canvas.clientWidth;
        let x = K.x, z = K.z, h = K.y + H * 0.6 + K.jumpY * 0.6, frame = H * (portrait ? 4.4 : 3.5);
        if (this.state === 'menu') {
            frame = H * (portrait ? 3.6 : 2.9); h = K.y + H * 0.55;
            if (this.shop) {
                frame = H * (portrait ? 2.9 : 2.5);
                const az = app.camera.azimuth, k = portrait ? 0 : frame * (canvas.clientWidth / Math.max(1, canvas.clientHeight)) * 0.24;
                x += -Math.sin(az) * k; z += Math.cos(az) * k;            // цель правее — кайдзю в левой части кадра
                h = K.y + H * (portrait ? -0.15 : 0.5);
            }
        } else if (this.state === 'dead' || this.state === 'result') { frame = H * 3; h = K.y + H * 0.3; }
        if (this.shakeT > 0) {
            this.shakeT -= dt;
            const a = this.shakeAmp * Math.max(0, this.shakeT / this.shakeDur) * H * 0.07;
            x += (Math.random() * 2 - 1) * a; z += (Math.random() * 2 - 1) * a; h += (Math.random() * 2 - 1) * a * 0.7;
        }
        c.x = x; c.y = z; c.h = h;
        c.frameHeight += (frame - c.frameHeight) * (dt > 0 ? Math.min(1, dt * 2.2) : 1);
        // кадр теней растёт вместе с кайдзю
        app.location.view._shadowRadius = Math.max(900, Math.min(5200, H * 4.2));
    },

    update(dt) {
        const app = /** @type {LoryApp} */ (this.app), cam = app.camera, K = GameKaiju;
        const look = Input.consumeLook();
        /** @type {any} */
        const cmd = { mx: 0, mz: 0, attack: false, slam: false, breath: false, nova: false, meteor: false, nuke: false };
        if (this.state === 'menu') {
            if (!this.shop) cam.azimuth += dt * 0.1; else cam.azimuth += look.dx * 0.004;
            cam.pitch += (Math.max(this.shop ? 0.16 : 0.26, this.clearPitch()) - cam.pitch) * Math.min(1, dt * 3);
        } else {
            cam.azimuth += look.dx * 0.0042;
            this.prefPitch = Math.max(0.1, Math.min(1.15, this.prefPitch + look.dy * 0.0032));
            const need = Math.max(this.prefPitch, this.clearPitch());
            cam.pitch += (need - cam.pitch) * Math.min(1, dt * (need > cam.pitch ? 6 : 1.6));
            if (look.dx || look.dy) this.lookIdle = 0; else this.lookIdle += dt;
        }
        if (this.state === 'play') {
            const r = this.run, m = Input.move();
            const fx = Math.cos(cam.azimuth), fz = Math.sin(cam.azimuth);
            cmd.mx = fx * m.y - fz * m.x; cmd.mz = fz * m.y + fx * m.x;
            cmd.attack = Input.pressed('attack'); cmd.slam = Input.pressed('slam'); cmd.breath = Input.down('breath');
            cmd.nova = Input.pressed('nova'); cmd.meteor = Input.pressed('meteor'); cmd.nuke = Input.pressed('nuke');
            if (Input.pressed('pause')) { this.togglePause(); return; }
            // камера сама встаёт за спину, если игрок её не трогает
            if (this.lookIdle > 1.4 && (m.x || m.y) && K.speed > 30) {
                let d = K.heading - cam.azimuth;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                cam.azimuth += d * Math.min(1, dt * (Input.device === 'touch' ? 1.1 : 0.7));
            }
            r.time += dt;
            if (r.comboT > 0) r.comboT -= dt;
            if (K.breath && r.time > 1) Tutorial.complete('breath');
            this.updateOffers(dt);
            if (K.alive && GameCity.destroyed() >= this.winAt) { this.endRun(true); return; }
        } else if (this.state === 'dead') {
            this.reviveT -= dt;
            GameUI.reviveTime(this.reviveT);
            if (this.reviveT <= 0 && !this.busy) { this.endRun(false); return; }
        }
        K.update(dt, cmd);
        GameArmy.update(dt, K);
        GameTraffic.update(dt, K);
        GameCrowd.update(dt, K);
        GameCity.update(dt);
        GamePhysics.step(dt);
        GameDebris.update(dt);
        FX('update', dt);
        GameLook.update(dt);
        this.syncCam(dt);
        this.hudT -= dt;
        if (this.hudT <= 0 && (this.state === 'play' || this.state === 'dead')) { this.hudT = 0.08; GameUI.hud(this.hudData()); }
    },

    hudData() {
        const K = GameKaiju, r = this.run, L = KR.LEVELS, lv = K.level;
        const a = L[lv - 1].xp, b = lv < L.length ? L[lv].xp : a;
        return {
            hp: K.hp, maxHp: K.maxHp, level: lv, xp: lv >= L.length ? 1 : Math.max(0, Math.min(1, (r.xp - a) / Math.max(1, b - a))),
            destroyed: Math.min(100, GameCity.destroyed() * 100 / this.winAt), coins: Math.round(r.coinF), energy: K.energy,
            cd: { slam: K.cds.slam > 0 ? K.cds.slam / K.cdMax.slam : 0, nova: K.cds.nova > 0 ? K.cds.nova / K.cdMax.nova : 0, meteor: K.cds.meteor > 0 ? K.cds.meteor / K.cdMax.meteor : 0, nuke: K.cds.nuke > 0 ? K.cds.nuke / K.cdMax.nuke : 0 },
            breath: K.breath, rage: K.rage, stars: GameArmy.stars,
        };
    },
};

// Название площадки (GAME_TITLES в Constants.js) важнее строки 'title' игры: Lang.js ставит его раньше этого файла.
(() => {
    const t = typeof GAME_TITLES !== 'undefined' && GAME_TITLES ? /** @type {Record<string, any>} */ (GAME_TITLES)[String(GAME_PLATFORM)] : null;
    if (typeof t === 'string' && t) for (const c of Object.keys(LANG_STRINGS)) /** @type {Record<string, Record<string, string>>} */ (LANG_STRINGS)[c].title = t;
})();
