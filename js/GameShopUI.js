// GameShopUI.js — окна магазина, подарка дня и колеса фортуны в стиле «кайдзю-катастрофа в комиксе» (GameStyle.js).
// Логика — движок (Shop, DailyGift, Wheel); каталог — js/GameShopData.js. Окна работают только из меню: пока окно открыто,
// меню прячется (GameUI.setMenuHidden), а кайдзю на сцене остаётся виден (Game.shopView).
//
// API: init({ app, save, persist }) · openShop(tab?) · openDaily() · openWheel() · close() · isOpen() ·
//      maybeOfferDaily() -> bool · refresh() · badges() -> { daily, wheel }.
// Все вызовы Game / GameUI / SFX / FX защищены typeof: модуль работает и без них (отдельно от игры).
//
// Раскладка магазина: панель занимает правые 55% экрана в альбомной ориентации и нижние 58% в портретной; остальное
// прозрачно и не ловит касания (камера слушает свайпы). Окна подарка и колеса — по центру на затемнении.

Object.assign(LANG_STRINGS.ru, {
    'krs.shop': 'Магазин', 'krs.daily': 'Подарок дня', 'krs.wheel': 'Колесо фортуны',
    'krs.close': 'Закрыть', 'krs.coinsAd': '+{n} за рекламу', 'krs.coinsAdShort': '+{n}',
    'krs.bought': 'Куплено: {name}', 'krs.unlocked': 'Открыто: {name}', 'krs.adCounted': 'Просмотр засчитан: {a} из {b}',
    'krs.wheelAd': 'Ещё за рекламу (осталось {n})', 'krs.prizeTitle': 'Ваш приз', 'krs.prizeOk': 'Отлично',
    'krs.exTag': 'Эксклюзив', 'krs.dayGoal': 'Главный приз', 'krs.youGet': 'Получите: {label}',
    'krs.newItem': 'Новый предмет!', 'krs.recovered': 'Приз колеса получен: {label}', 'krs.none': 'Нет',
    'krs.coinsAmount': '{n} монет',
});
Object.assign(LANG_STRINGS.en, {
    'krs.shop': 'Shop', 'krs.daily': 'Daily Gift', 'krs.wheel': 'Wheel of Fortune',
    'krs.close': 'Close', 'krs.coinsAd': '+{n} Watch ad', 'krs.coinsAdShort': '+{n}',
    'krs.bought': 'Bought: {name}', 'krs.unlocked': 'Unlocked: {name}', 'krs.adCounted': 'View counted: {a} of {b}',
    'krs.wheelAd': 'Watch ad: spin again ({n} left)', 'krs.prizeTitle': 'Your prize', 'krs.prizeOk': 'Great',
    'krs.exTag': 'Exclusive', 'krs.dayGoal': 'Grand prize', 'krs.youGet': 'You get: {label}',
    'krs.newItem': 'New item!', 'krs.recovered': 'Wheel prize received: {label}', 'krs.none': 'None',
    'krs.coinsAmount': '{n} coins',
});

/** Перевод по ключу (Lang.t требует два аргумента). */
const _kt = (/** @type {string} */ key, /** @type {Record<string, any> | null} */ p) => (typeof Lang !== 'undefined' ? Lang.t(key, p || null) : key);
const _kesc = (/** @type {any} */ s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const _kfmt = (/** @type {number} */ n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const _kico = (/** @type {string} */ name, /** @type {string} */ cls) => GameStyle.icon(name, cls);

/** Мост к игре: возвращает объект или null (модуль живёт и без Game). */
function _kGame() {
    // @ts-ignore — Game объявляет js/Game.js
    return typeof Game !== 'undefined' ? Game : null;
}
function _kUI() {
    // @ts-ignore — GameUI объявляет js/GameUI.js
    return typeof GameUI !== 'undefined' ? GameUI : null;
}
function _kSfx(/** @type {string} */ name) {
    // @ts-ignore — SFX объявляет игра
    try { if (typeof SFX === 'function') SFX(name); } catch (e) { /* звук не критичен */ }
}
function _kFx(/** @type {any[]} */ ...args) {
    // @ts-ignore — FX объявляет игра
    try { if (typeof FX === 'function') FX(...args); } catch (e) { /* эффект не критичен */ }
}
function _kToast(/** @type {string} */ text, /** @type {string} */ color) {
    const ui = _kUI();
    try { if (ui && ui.toast) ui.toast(text, 2400, color); } catch (e) { /* */ }
}
/** Яркость цвета #rrggbb 0..1 (для подстройки превью мутантов). */
function _kLum(/** @type {string} */ hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const KRS_CSS = `
.krs-root button { font: inherit; }
.krs-root .kr-btn { min-height: max(44px, calc(var(--kr-u) * 4.4)); }
.krs-root .kr-btn.is-off, .krs-root .kr-btn[disabled] { pointer-events: auto; }
.krs-root .kr-btn--icon { min-width: max(44px, calc(var(--kr-u) * 4.6)); }
.krs-root .kr-btn--big { min-height: max(52px, calc(var(--kr-u) * 6.4)); }
.krs-root img { -webkit-user-drag: none; user-select: none; }
.krs-adsh { display: none; }
.krs-hint { color: var(--kr-yellow); font-weight: 700; font-size: calc(var(--kr-u) * 1.2); }
.krs-img { width: 86%; height: 86%; object-fit: contain; pointer-events: none; }

/* ---------- магазин ---------- */
.krs-shop { padding: calc(var(--kr-u) * .8); flex-direction: row; justify-content: flex-end; align-items: stretch; }
.krs-sp { width: 55%; min-width: 0; display: flex; flex-direction: column; container-type: inline-size; }
@media (orientation: portrait) { .krs-shop { flex-direction: column; } .krs-sp { width: 100%; height: 58%; } }
.krs-sp .kr-panel__head { flex: none; gap: calc(var(--kr-u) * .6); padding: calc(var(--kr-u) * .4) calc(var(--kr-u) * .8); }
.krs-sp .kr-panel__head > .kr-ico { width: calc(var(--kr-u) * 3.2); height: calc(var(--kr-u) * 3.2); }
.krs-sp .kr-panel__head .kr-title { font-size: calc(var(--kr-u) * 2); }
.krs-coins { margin-left: auto; }
.krs-adcoin { padding-left: calc(var(--kr-u) * .9); padding-right: calc(var(--kr-u) * .9); font-size: calc(var(--kr-u) * 1.3); white-space: nowrap; }
.krs-tabs { flex: none; display: flex; gap: calc(var(--kr-u) * .5); padding: calc(var(--kr-u) * .7) calc(var(--kr-u) * .8) calc(var(--kr-u) * .5); }
.krs-tab { flex: 1 1 0; min-width: 0; padding-left: calc(var(--kr-u) * .3); padding-right: calc(var(--kr-u) * .3); font-size: calc(var(--kr-u) * 1.2); }
.krs-tab .kr-ico { width: calc(var(--kr-u) * 3); height: calc(var(--kr-u) * 3); }
.krs-tab.kr-btn--dark { opacity: .92; }
.krs-tab { flex-direction: column; gap: 0; min-height: calc(var(--kr-u) * 6.2) !important; font-size: calc(var(--kr-u) * 1.02); transform: none; }
.krs-tab > * { transform: none; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.krs-tab:active { transform: translateY(calc(var(--kr-u) * .3)); }
.krs-sp .kr-panel__head .kr-title { display: none; }
.krs-grid { flex: 1 1 auto; min-height: 0; grid-auto-rows: max-content; align-content: start; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--kr-u) * 10.5), 1fr)); gap: calc(var(--kr-u) * .8); align-content: start;
  padding: calc(var(--kr-u) * .8) calc(var(--kr-u) * 1) calc(var(--kr-u) * 1.2); }
.krs-card { --rc: #9aa7bd; position: relative; display: flex; flex-direction: column; align-items: stretch; min-height: 44px; padding: calc(var(--kr-u) * .5); cursor: pointer; overflow: hidden;
  background: #222c42; color: var(--kr-light); text-align: center; border: calc(var(--kr-u) * .3) solid var(--kr-ink); border-radius: calc(var(--kr-u) * .9);
  box-shadow: inset 0 0 0 calc(var(--kr-u) * .28) var(--rc), 0 calc(var(--kr-u) * .4) 0 var(--kr-ink); touch-action: manipulation; transition: transform .1s ease; }
.krs-card.r-uncommon { --rc: #3FD86B; } .krs-card.r-rare { --rc: #3aa8ff; } .krs-card.r-epic { --rc: #b05cff; } .krs-card.r-legendary { --rc: #FFC400; }
.krs-card.is-sel { transform: translateY(calc(var(--kr-u) * -.25)); outline: calc(var(--kr-u) * .4) solid var(--kr-yellow); outline-offset: calc(var(--kr-u) * -.05); }
.krs-card:active { transform: translateY(calc(var(--kr-u) * .2)); }
.krs-th { position: relative; width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; overflow: hidden;
  border-radius: calc(var(--kr-u) * .6); background: radial-gradient(circle at 50% 38%, rgba(255,255,255,.14), rgba(0,0,0,.32) 80%); }
.krs-card.is-locked .krs-th > * { filter: brightness(.78); }
.krs-nm { margin-top: calc(var(--kr-u) * .4); font-size: calc(var(--kr-u) * 1.15); line-height: 1.1; min-height: 2.2em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.krs-stl { margin-top: calc(var(--kr-u) * .25); min-height: calc(var(--kr-u) * 2.2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--kr-u) * .25);
  font-size: calc(var(--kr-u) * 1.1); line-height: 1.05; }
.krs-pr, .krs-adp, .krs-ok, .krs-ex { display: inline-flex; align-items: center; justify-content: center; gap: calc(var(--kr-u) * .3); flex-wrap: wrap; }
.krs-pr { color: var(--kr-yellow); } .krs-pr.is-poor { color: #ff9a85; }
.krs-adp { color: var(--kr-teal); } .krs-ok { color: var(--kr-green); } .krs-ex { color: #ffb347; }
.krs-stl .kr-ico { width: calc(var(--kr-u) * 1.6); height: calc(var(--kr-u) * 1.6); }
.krs-pips { display: flex; gap: calc(var(--kr-u) * .25); }
.krs-pips i { width: calc(var(--kr-u) * .9); height: calc(var(--kr-u) * .9); border-radius: 2px; background: rgba(255,255,255,.18); border: 1px solid var(--kr-ink); transform: skewX(-12deg); }
.krs-pips i.on { background: var(--kr-teal); }
.krs-flag { position: absolute; top: calc(var(--kr-u) * .5); width: calc(var(--kr-u) * 2.4); height: calc(var(--kr-u) * 2.4); display: flex; align-items: center; justify-content: center;
  background: var(--kr-ink); border-radius: 50%; z-index: 2; pointer-events: none; }
.krs-flag .kr-ico { width: 70%; height: 70%; }
.krs-flag--l { left: calc(var(--kr-u) * .5); } .krs-flag--r { right: calc(var(--kr-u) * .5); background: var(--kr-green); }
.krs-card::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.krs-card.r-epic::after, .krs-card.r-legendary::after { opacity: 1; background: linear-gradient(115deg, transparent 38%, rgba(255,255,255,.34) 50%, transparent 62%);
  transform: translateX(-130%); animation: krs-shine 3.6s ease-in-out infinite; }
.krs-card.r-legendary::after { animation-duration: 2.6s; background: linear-gradient(115deg, transparent 38%, rgba(255,230,140,.5) 50%, transparent 62%); }
@keyframes krs-shine { 0% { transform: translateX(-130%); } 55%, 100% { transform: translateX(130%); } }
@media (prefers-reduced-motion: reduce) { .krs-card::after, .krs-today, .krs-spinfx { animation: none !important; } }
.krs-foot { flex: none; display: flex; align-items: center; gap: calc(var(--kr-u) * 1); padding: calc(var(--kr-u) * .7) calc(var(--kr-u) * 1); border-top: calc(var(--kr-u) * .3) solid var(--kr-ink);
  background: rgba(10, 14, 22, .72); min-height: calc(var(--kr-u) * 6.4); }
.krs-fi { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: calc(var(--kr-u) * .2); }
.krs-fn { font-size: calc(var(--kr-u) * 1.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; }
.krs-fs { font-size: calc(var(--kr-u) * 1.15); font-weight: 700; display: flex; gap: calc(var(--kr-u) * .6); align-items: center; flex-wrap: wrap; color: var(--kr-light); }
.krs-rar { color: var(--rc); }
.krs-foot .kr-btn { flex: none; max-width: 62%; }
.krs-owned-tag { flex: none; display: inline-flex; align-items: center; gap: calc(var(--kr-u) * .5); color: var(--kr-green); font-size: calc(var(--kr-u) * 1.6); font-style: italic; text-transform: uppercase; }
@container (max-width: 400px) {
  .krs-sp .kr-panel__head .kr-title { display: none; }
  .krs-tab .krs-tt { display: none; }
  .krs-adtxt { display: none; }
  .krs-adsh { display: inline; }
}
@container (min-width: 700px) { .krs-grid { grid-template-columns: repeat(auto-fill, minmax(calc(var(--kr-u) * 12), 1fr)); } }

/* превью предметов */
.krs-mon { position: relative; width: 88%; aspect-ratio: 1; isolation: isolate; }
.krs-mon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.krs-mon i { position: absolute; inset: 0; background: var(--tint); mix-blend-mode: color; -webkit-mask: var(--mask) center / contain no-repeat; mask: var(--mask) center / contain no-repeat; }
.krs-mon.fx-ghost { opacity: .78; } .krs-mon.fx-metal, .krs-mon.fx-gold { filter: saturate(1.25) contrast(1.15); }
.krs-pal { position: relative; width: 82%; aspect-ratio: 1; border: calc(var(--kr-u) * .3) solid var(--kr-ink); border-radius: calc(var(--kr-u) * .7); overflow: hidden; transform: skewX(-6deg); }
.krs-pal.fx-ghost { opacity: .7; }
.krs-pal.fx-metal::after, .krs-pal.fx-gold::after { content: ''; position: absolute; inset: 0; background: linear-gradient(120deg, rgba(255,255,255,.55), transparent 35%, rgba(255,255,255,.25) 60%, transparent); }
.krs-bm { position: relative; width: 92%; aspect-ratio: 1; border-radius: calc(var(--kr-u) * .6); overflow: hidden; background: linear-gradient(#0d1322, #1d2848); }
.krs-bm::before { content: ''; position: absolute; left: 6%; top: 40%; width: 18%; height: 20%; border-radius: 40% 10% 10% 40%; background: #4b5a7a; border: 2px solid var(--kr-ink); }
.krs-bm i { position: absolute; left: 22%; right: -4%; top: 38%; height: 24%; border-radius: 0 40% 40% 0;
  background: linear-gradient(90deg, var(--core) 0, var(--core) 22%, var(--glow) 62%, transparent 100%); box-shadow: 0 0 calc(var(--kr-u) * 1) var(--glow); }
.krs-bm--fire i { top: 28%; height: 44%; border-radius: 0; clip-path: polygon(0 35%, 18% 12%, 38% 30%, 58% 4%, 80% 28%, 100% 42%, 100% 58%, 80% 74%, 58% 96%, 38% 72%, 18% 90%, 0 65%); box-shadow: none; filter: drop-shadow(0 0 4px var(--glow)); }
.krs-bm--lightning i { top: 24%; height: 52%; border-radius: 0; clip-path: polygon(0 45%, 14% 8%, 28% 58%, 44% 14%, 58% 74%, 74% 20%, 100% 50%, 74% 62%, 58% 94%, 44% 48%, 28% 84%, 14% 44%); box-shadow: none; filter: drop-shadow(0 0 4px var(--glow)); }
.krs-bm--ice i { top: 30%; height: 40%; border-radius: 0; clip-path: polygon(0 50%, 20% 8%, 30% 40%, 52% 0, 62% 38%, 86% 14%, 100% 50%, 86% 86%, 62% 62%, 52% 100%, 30% 60%, 20% 92%); box-shadow: none; filter: drop-shadow(0 0 3px var(--glow)); }
.krs-bm--toxic i { top: 30%; height: 40%; background: radial-gradient(circle at 20% 50%, var(--core) 0 10%, transparent 12%), radial-gradient(circle at 45% 35%, var(--glow) 0 14%, transparent 16%), radial-gradient(circle at 65% 62%, var(--glow) 0 16%, transparent 18%), radial-gradient(circle at 88% 45%, var(--core) 0 12%, transparent 14%), linear-gradient(90deg, transparent, var(--glow) 30%, transparent); border-radius: 50%; }
.krs-bm--void i { background: linear-gradient(90deg, #000 0, #000 20%, var(--glow) 70%, transparent 100%); box-shadow: 0 0 calc(var(--kr-u) * 1.2) var(--glow), inset 0 0 0 calc(var(--kr-u) * .2) var(--core); }
.krs-bm--rainbow i { background: linear-gradient(90deg, #ff3b3b, #ff9a1f, #ffe14a, #3fd86b, #35c8ff, #b05cff 85%, transparent); top: 34%; height: 32%; box-shadow: 0 0 calc(var(--kr-u) * 1.2) var(--glow); }
.krs-bm--plasma i { top: 28%; height: 44%; border-radius: 0 50% 50% 0; background: radial-gradient(ellipse at 30% 50%, var(--core) 0 18%, var(--glow) 55%, transparent 90%); }
.krs-au { position: relative; width: 84%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, var(--c) 0 20%, var(--c2) 20% 40%, transparent 68%); }
.krs-au::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: repeating-conic-gradient(var(--c2) 0 5deg, transparent 5deg var(--step));
  -webkit-mask: radial-gradient(circle, transparent 36%, #000 40%, #000 66%, transparent 70%); mask: radial-gradient(circle, transparent 36%, #000 40%, #000 66%, transparent 70%); }

/* ---------- окна подарка и колеса ---------- */
.krs-win { width: min(100%, calc(var(--kr-u) * 66)); max-height: 100%; display: flex; flex-direction: column; container-type: inline-size; }
.krs-win .kr-panel__head { flex: none; }
.krs-win .kr-panel__head > .kr-ico { width: calc(var(--kr-u) * 3.2); height: calc(var(--kr-u) * 3.2); }
.krs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: calc(var(--kr-u) * 1); display: flex; flex-direction: column; gap: calc(var(--kr-u) * 1); }
.krs-days { display: grid; grid-template-columns: repeat(4, 1fr); gap: calc(var(--kr-u) * .7); }
@container (min-width: 520px) { .krs-days { grid-template-columns: repeat(8, 1fr); } }
.krs-day { position: relative; display: flex; flex-direction: column; align-items: center; gap: calc(var(--kr-u) * .3); padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * .3); min-height: calc(var(--kr-u) * 10.5);
  background: #222c42; border: calc(var(--kr-u) * .3) solid var(--kr-ink); border-radius: calc(var(--kr-u) * .8); box-shadow: 0 calc(var(--kr-u) * .4) 0 var(--kr-ink); text-align: center; overflow: hidden; }
.krs-day--7 { grid-column: span 2; background: linear-gradient(160deg, #3b2a66, #221a44); box-shadow: inset 0 0 0 calc(var(--kr-u) * .28) var(--kr-yellow), 0 calc(var(--kr-u) * .4) 0 var(--kr-ink); }
.krs-day.is-today { border-color: var(--kr-yellow); box-shadow: 0 0 0 calc(var(--kr-u) * .25) var(--kr-yellow), 0 calc(var(--kr-u) * .4) 0 var(--kr-ink); animation: kr-pulse 1.4s ease-in-out infinite; }
.krs-day.is-claimed { filter: brightness(.7); }
.krs-day.is-locked .krs-dg { opacity: .7; }
.krs-dn { font-size: calc(var(--kr-u) * 1.2); color: var(--kr-yellow); text-transform: uppercase; font-style: italic; }
.krs-dg { width: calc(var(--kr-u) * 4.4); height: calc(var(--kr-u) * 4.4); }
.krs-dg--skin { width: calc(var(--kr-u) * 6.4); height: calc(var(--kr-u) * 6.4); position: relative; }
.krs-dr { font-size: calc(var(--kr-u) * 1.15); line-height: 1.1; display: flex; flex-direction: column; align-items: center; gap: calc(var(--kr-u) * .15); min-height: 2.3em; justify-content: center; }
.krs-dr .kr-ico { width: calc(var(--kr-u) * 1.7); height: calc(var(--kr-u) * 1.7); }
.krs-dr b { display: inline-flex; align-items: center; gap: calc(var(--kr-u) * .3); font-weight: 900; }
.krs-dmark { position: absolute; top: calc(var(--kr-u) * .3); right: calc(var(--kr-u) * .3); width: calc(var(--kr-u) * 2.4); height: calc(var(--kr-u) * 2.4); background: var(--kr-green); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.krs-dmark .kr-ico { width: 70%; height: 70%; }
.krs-tag { font-size: calc(var(--kr-u) * 1); color: var(--kr-ink); background: var(--kr-yellow); padding: 0 calc(var(--kr-u) * .5); border-radius: calc(var(--kr-u) * .4); text-transform: uppercase; font-style: italic; }
.krs-act { display: flex; flex-direction: column; align-items: center; gap: calc(var(--kr-u) * .8); }
.krs-row { display: flex; gap: calc(var(--kr-u) * 1); flex-wrap: wrap; justify-content: center; align-items: stretch; width: 100%; }
.krs-row .kr-btn { flex: 1 1 calc(var(--kr-u) * 18); max-width: calc(var(--kr-u) * 30); }
.krs-note { text-align: center; font-size: calc(var(--kr-u) * 1.3); color: var(--kr-light); font-weight: 700; }
.krs-note b { color: var(--kr-yellow); }

.krs-wb { flex-direction: row; align-items: center; justify-content: center; gap: calc(var(--kr-u) * 1.5); --krs-d: min(46vw, calc(100vh - var(--kr-u) * 13)); }
@media (orientation: portrait) { .krs-wb { flex-direction: column; --krs-d: min(84vw, 46vh); } }
.krs-wheelbox { position: relative; flex: none; width: var(--krs-d); height: var(--krs-d); }
.krs-rim { position: absolute; inset: 0; border-radius: 50%; background: var(--kr-yellow) repeating-conic-gradient(var(--kr-ink) 0 3deg, transparent 3deg 15deg); border: calc(var(--kr-u) * .4) solid var(--kr-ink); box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink); }
.krs-disc { position: absolute; inset: 5%; border-radius: 50%; border: calc(var(--kr-u) * .4) solid var(--kr-ink); overflow: hidden; will-change: transform; }
.krs-sec { position: absolute; left: 50%; top: 0; width: 0; height: 50%; transform-origin: 50% 100%; }
.krs-sec__in { position: absolute; left: 0; top: 6%; transform: translateX(-50%); width: calc(var(--krs-d) * .24); display: flex; flex-direction: column; align-items: center; gap: calc(var(--krs-d) * .008);
  font-size: calc(var(--krs-d) * .062); line-height: 1.05; text-align: center; color: var(--ink, #141A26); }
.krs-sec__in .kr-ico { width: calc(var(--krs-d) * .1); height: calc(var(--krs-d) * .1); }
.krs-sec__g { width: calc(var(--krs-d) * .12); height: calc(var(--krs-d) * .12); display: flex; align-items: center; justify-content: center; background: rgba(20,26,38,.35); border-radius: 30%; overflow: hidden; }
.krs-sec__n { font-size: calc(var(--krs-d) * .042); max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.krs-sec.is-win .krs-sec__in { filter: drop-shadow(0 0 6px #fff); }
.krs-hub { position: absolute; left: 50%; top: 50%; width: 20%; height: 20%; transform: translate(-50%, -50%); border-radius: 50%; background: var(--kr-ink); border: calc(var(--kr-u) * .3) solid var(--kr-yellow); display: flex; align-items: center; justify-content: center; }
.krs-hub img { width: 70%; height: 70%; object-fit: contain; }
.krs-ptr { position: absolute; left: 50%; top: -3%; width: 11%; transform: translateX(-50%); z-index: 3; pointer-events: none; filter: drop-shadow(0 3px 0 rgba(0,0,0,.5)); }
.krs-wc { display: flex; flex-direction: column; gap: calc(var(--kr-u) * .9); align-items: stretch; min-width: 0; width: min(100%, calc(var(--kr-u) * 26)); }
@media (orientation: portrait) { .krs-wc { width: min(100%, calc(var(--kr-u) * 34)); } }
.krs-wc .kr-btn { width: 100%; }

.krs-pop { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: calc(var(--kr-u) * 1.2); background: rgba(8, 11, 18, .84); }
.krs-pc { width: min(100%, calc(var(--kr-u) * 34)); display: flex; flex-direction: column; align-items: center; gap: calc(var(--kr-u) * .8); padding: calc(var(--kr-u) * 1.2); max-height: 100%; overflow-y: auto; overscroll-behavior: contain;
  background: #222c42; border: calc(var(--kr-u) * .35) solid var(--kr-yellow); border-radius: calc(var(--kr-u) * 1.1); box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink); text-align: center; }
.krs-pc .kr-title { font-size: calc(var(--kr-u) * 2.4); }
.krs-pc > img { width: calc(var(--kr-u) * 9); height: calc(var(--kr-u) * 9); object-fit: contain; pointer-events: none; }
.krs-pl { display: flex; align-items: center; gap: calc(var(--kr-u) * .7); font-size: calc(var(--kr-u) * 1.9); color: #fff; }
.krs-pl .krs-pth { width: calc(var(--kr-u) * 6); height: calc(var(--kr-u) * 6); position: relative; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.3); border-radius: calc(var(--kr-u) * .8); overflow: hidden; }
.krs-pl .kr-ico { width: calc(var(--kr-u) * 2.8); height: calc(var(--kr-u) * 2.8); }
`;

/** @satisfies {Record<string, any>} */
const GameShopUI = {
    /** Монет за рекламу в шапке магазина (число баланса; в Constants.js не вынесено: файлы движка не правились). */
    COINS_AD: 400,
    ready: false,
    /** Открытое окно: '' | 'shop' | 'daily' | 'wheel'. */
    cur: '',
    tab: 'monster',
    sel: '',
    /** Идёт Shop.act (покупка/реклама). */
    busy: false,
    /** Идёт реклама за монеты. */
    coinsBusy: false,
    coinsRetryAt: 0,
    /** Идёт запрос вращения. */
    wheelBusy: false,
    /** Диск крутится: окно закрыть и повторно крутить нельзя. */
    spinning: false,
    /** Текущий угол диска, градусы. */
    ang: 0,
    /** Открытое окно приза: { kind, got, label } или null. @type {any} */
    popup: null,
    /** Приз колеса, выданный при запуске игры (ожидал с прошлой сессии). @type {any} */
    recovered: null,
    /** Результат проверок каталога при init. @type {any} */
    validation: null,
    /** @type {Record<string, any>} */
    el: {},
    _lookQueued: false,
    _timer: 0,
    /** @type {Array<() => void>} */
    _unsub: [],

    // ----------------------------------------------------------------------------------------------
    // Запуск
    // ----------------------------------------------------------------------------------------------

    /** Порядок по документации движка: Shop.init -> DailyGift.init -> Wheel.init (приёмник наград — Shop). */
    init(o) {
        const cfg = o || {};
        const save = cfg.save || {};
        const persist = () => { try { if (typeof cfg.persist === 'function') return cfg.persist(); } catch (e) { console.warn('GameShopUI: сохранение не удалось:', e); } };
        if (typeof GameStyle !== 'undefined') GameStyle.init();
        Shop.init({ tabs: SHOP_TABS, items: SHOP_ITEMS, state: save.shop, persist });
        save.shop = Shop.state;
        DailyGift.init({ rewards: DAILY_REWARDS, rewardsSink: Shop, state: save.daily, persist });
        save.daily = DailyGift.state;
        Wheel.init({
            sectors: WHEEL_SECTORS, rewardsSink: Shop, state: save.wheel, persist,
            // Приз вращения, которое не успело завершиться в прошлой сессии, выдаётся в Wheel.init: запомним, чтобы показать игроку.
            onChange: (e) => { if (e.type === 'prize' && e.recovered) this.recovered = e; },
        });
        save.wheel = Wheel.state;
        this.validation = { shop: Shop.validate(), daily: DailyGift.validate(), wheel: Wheel.validate() };
        for (const k of Object.keys(this.validation)) {
            const v = this.validation[k];
            if (!v.ok) console.warn('GameShopUI: проверка «' + k + '» не пройдена:', v.problems);
        }

        this._unsub.push(Shop.on((e) => {
            if (e.type === 'equip' || e.type === 'unequip' || e.type === 'preview') this.queueLook();
            if (e.type === 'coins') { const ui = _kUI(); if (ui && ui.refreshCoins) ui.refreshCoins(); if (this.cur === 'shop') this.renderHead(); }
        }));
        if (typeof Platform !== 'undefined' && Platform.onRewardedCooldown) this._unsub.push(Platform.onRewardedCooldown(() => this.tick()));
        if (typeof window !== 'undefined') window.addEventListener('lory-language', () => this.refresh());
        this.build();
        this.ready = true;
        this.queueLook();
    },

    /** Применить облик к кайдзю (склеивает серию событий примерки в один вызов). */
    queueLook() {
        if (this._lookQueued) return;
        this._lookQueued = true;
        setTimeout(() => {
            this._lookQueued = false;
            const g = _kGame();
            try { if (g && g.applyLook) g.applyLook(); } catch (e) { console.warn('GameShopUI: applyLook:', e); }
        }, 0);
    },

    build() {
        if (!document.getElementById('krs-style')) {
            const st = document.createElement('style');
            st.id = 'krs-style';
            st.textContent = KRS_CSS;
            document.head.appendChild(st);
        }
        const root = document.createElement('div');
        root.className = 'kr-root krs-root';
        const head = (/** @type {string} */ icon, /** @type {string} */ id) =>
            '<div class="kr-panel__head">' + _kico(icon, '') + '<div class="kr-title" id="' + id + '"></div>';
        const close = '<button class="kr-btn kr-btn--red kr-btn--icon krs-x" data-a="close" aria-label="close"><img class="kr-ico" src="' + GameStyle.ICONS.ic_close + '" alt="" draggable="false"></button></div>';
        root.innerHTML =
            '<div class="kr-screen krs-shop" id="krs-shop"><div class="kr-panel krs-sp">' +
            head('ic_shop', 'krs-shop-t') + '<span class="kr-chip kr-num krs-coins" id="krs-coins"></span>' +
            '<button class="kr-btn kr-btn--small kr-btn--teal krs-adcoin" data-a="coinsad" id="krs-adcoin"></button>' + close +
            '<div class="krs-tabs" id="krs-tabs"></div><div class="krs-grid" id="krs-grid"></div><div class="krs-foot" id="krs-foot"></div></div></div>' +
            '<div class="kr-screen kr-dim" id="krs-daily"><div class="kr-panel krs-win" id="krs-daily-p">' + head('ic_gift', 'krs-daily-t') + close +
            '<div class="krs-body" id="krs-daily-b"></div></div></div>' +
            '<div class="kr-screen kr-dim" id="krs-wheel"><div class="kr-panel krs-win" id="krs-wheel-p">' + head('ic_wheel', 'krs-wheel-t') + close +
            '<div class="krs-body krs-wb" id="krs-wheel-b"><div class="krs-wheelbox"><div class="krs-rim"></div><div class="krs-disc" id="krs-disc"></div>' +
            '<img class="krs-ptr" src="' + GameStyle.ICONS.wheel_pointer + '" alt="" draggable="false"></div><div class="krs-wc" id="krs-wact"></div></div></div></div>';
        document.body.appendChild(root);
        const q = (/** @type {string} */ id) => /** @type {HTMLElement} */ (root.querySelector('#' + id));
        this.el = {
            root, shop: q('krs-shop'), daily: q('krs-daily'), wheel: q('krs-wheel'), coins: q('krs-coins'), adcoin: q('krs-adcoin'), tabs: q('krs-tabs'), grid: q('krs-grid'),
            foot: q('krs-foot'), dailyB: q('krs-daily-b'), dailyP: q('krs-daily-p'), wheelP: q('krs-wheel-p'), wact: q('krs-wact'), disc: q('krs-disc'),
        };
        root.addEventListener('click', (e) => this.onClick(e));
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.cur || Platform.name === 'playgama') return;      // Playgama 1.5.2: без Esc
            if (this.popup) this.closePopup(); else this.close();
        });
    },

    // ----------------------------------------------------------------------------------------------
    // Открытие и закрытие
    // ----------------------------------------------------------------------------------------------

    isOpen() { return !!this.cur; },

    _show(/** @type {string} */ which) {
        this.cur = which;
        for (const k of ['shop', 'daily', 'wheel']) this.el[k].classList.toggle('is-open', k === which);
        const ui = _kUI();
        if (ui && ui.setMenuHidden) ui.setMenuHidden(true);
        window.clearInterval(this._timer);
        this._timer = window.setInterval(() => this.tick(), 1000);
        this.popup = null;
    },

    openShop(tab) {
        if (!this.ready || this.cur) return false;
        if (tab && SHOP_TABS.some((t) => t.id === tab)) this.tab = tab;
        this._show('shop');
        const g = _kGame();
        try { if (g && g.shopView) g.shopView(true); } catch (e) { /* камера не критична */ }
        this.pickDefault();
        this.refresh();
        this.el.grid.scrollTop = 0;
        return true;
    },

    openDaily() {
        if (!this.ready || this.cur) return false;
        this._show('daily');
        this.refresh();
        return true;
    },

    openWheel() {
        if (!this.ready || this.cur) return false;
        this._show('wheel');
        // Ожидающее вращение (анимацию никто не крутит): выдать приз и показать.
        const p = Wheel.pendingSpin();
        if (p && !this.spinning) {
            this.ang = p.landing;
            const r = Wheel.finish();
            this.refresh();
            if (r && r.ok) this.showPrize('wheel', r.got, r.label, r.sector);
            return true;
        }
        this.refresh();
        return true;
    },

    /** Закрыть окно. false — нельзя (колесо крутится). */
    close() {
        if (!this.cur || this.spinning) return false;
        const was = this.cur;
        this.cur = '';
        this.popup = null;
        for (const k of ['shop', 'daily', 'wheel']) this.el[k].classList.remove('is-open');
        window.clearInterval(this._timer);
        const g = _kGame();
        if (was === 'shop') {
            Shop.clearPreview();
            try { if (g && g.shopView) g.shopView(false); } catch (e) { /* */ }
        }
        this.queueLook();
        const ui = _kUI();
        if (ui && ui.setMenuHidden) ui.setMenuHidden(false);
        _kSfx('ui_click');
        return true;
    },

    /** Вход в меню: подарок дня открывается сам, если его можно забрать и туториал не идёт. */
    maybeOfferDaily() {
        if (!this.ready || this.cur) return false;
        const rec = this.recovered;
        if (rec) {
            this.recovered = null;
            _kToast(_kt('krs.recovered', { label: rec.label }), 'teal');
            const ui = _kUI();
            if (ui && ui.refreshCoins) ui.refreshCoins();
        }
        if (!DailyGift.shouldOffer()) return false;
        _kSfx('ui_open');
        this.openDaily();
        DailyGift.markOffered();
        return true;
    },

    /** Красные точки на кнопках меню. */
    badges() {
        try { return { daily: DailyGift.badge() > 0, wheel: Wheel.badge() > 0 }; } catch (e) { return { daily: false, wheel: false }; }
    },

    refresh() {
        if (!this.cur) return;
        if (this.cur === 'shop') { this.renderHead(); this.renderTabs(); this.renderGrid(); this.renderFoot(); }
        else if (this.cur === 'daily') this.renderDaily();
        else if (this.cur === 'wheel') this.renderWheel();
        if (this.popup) this.renderPopup();
    },

    /** Раз в секунду и по паузе между rewarded: подписи кнопок, таймеры (без перерисовки карточек и дня). */
    tick() {
        if (!this.cur) return;
        if (this.cur === 'shop') { this.renderHead(); this.renderFoot(); }
        else if (this.cur === 'daily') { if (!this.popup) this.renderDailyAct(); }
        else if (this.cur === 'wheel') { if (!this.popup) this.renderWheelAct(); }
    },

    // ----------------------------------------------------------------------------------------------
    // Клики
    // ----------------------------------------------------------------------------------------------

    onClick(/** @type {Event} */ e) {
        const t = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-a]'));
        if (!t || !this.cur) return;
        const a = t.dataset.a;
        switch (a) {
            case 'close': if (this.spinning) { _kSfx('ui_error'); } else this.close(); break;
            case 'tab': this.setTab(String(t.dataset.tab)); break;
            case 'card': this.select(String(t.dataset.id)); break;
            case 'act': this.doAct(); break;
            case 'coinsad': this.doCoinsAd(); break;
            case 'claim': this.doClaim(); break;
            case 'x2': this.doX2(); break;
            case 'spin-free': this.doSpin('free'); break;
            case 'spin-ad': this.doSpin('ad'); break;
            case 'pop-ok': this.closePopup(); break;
            case 'pop-equip': this.popEquip(String(t.dataset.id)); break;
            default: break;
        }
    },

    // ----------------------------------------------------------------------------------------------
    // Магазин
    // ----------------------------------------------------------------------------------------------

    /** Выбор по умолчанию во вкладке: примеряемое или надетое. */
    pickDefault() {
        const tab = SHOP_TABS.find((t) => t.id === this.tab) || SHOP_TABS[0];
        const slot = Shop.slotOf(Shop.items(tab.id)[0] || { tab: tab.id, id: '' });
        const look = Shop.look();
        this.sel = look[slot] || Shop.equippedId(slot) || (Shop.items(tab.id)[0] || { id: '' }).id;
    },

    setTab(/** @type {string} */ id) {
        if (id === this.tab || !SHOP_TABS.some((t) => t.id === id)) return;
        this.tab = id;
        _kSfx('ui_click');
        this.pickDefault();
        this.renderTabs();
        this.renderGrid();
        this.renderFoot();
        this.el.grid.scrollTop = 0;
    },

    select(/** @type {string} */ id) {
        if (!Shop.item(id)) return;
        this.sel = id;
        _kSfx('ui_click');
        Shop.preview(id);
        this.renderGrid();
        this.renderFoot();
    },

    /** Превью предмета по вкладке (HTML внутри квадрата карточки). */
    thumb(/** @type {any} */ it) {
        const I = GameStyle.ICONS;
        if (it.tab === 'monster') {
            const src = I['monster_' + it.species] || I.monster_titan;
            const p = it.palette;
            let tint = '';
            let st = '';
            if (p) {
                tint = '<i style="--tint:' + p.primary + ';--mask:url(\'' + src + '\')"></i>';
                const b = Math.max(0.55, Math.min(1.1, 0.5 + _kLum(p.primary) * 0.8));
                st = ' style="filter:brightness(' + b.toFixed(2) + ')"';
            }
            return '<div class="krs-mon' + (p && p.fx ? ' fx-' + p.fx : '') + '"' + st + '><img src="' + src + '" alt="" draggable="false">' + tint + '</div>';
        }
        if (it.tab === 'color') {
            const p = it.palette || { primary: '#8d99ad', secondary: '#c0c8d6', accent: '#5a6478' };
            return '<div class="krs-pal' + (p.fx ? ' fx-' + p.fx : '') + '" style="background:linear-gradient(115deg,' + p.primary + ' 0 34%,' + p.secondary + ' 34% 67%,' + p.accent + ' 67% 100%)"></div>';
        }
        if (it.tab === 'breath') {
            const b = it.breath;
            return '<div class="krs-bm krs-bm--' + b.style + '" style="--core:' + b.core + ';--glow:' + b.glow + '"><i></i></div>';
        }
        if (it.tab === 'acc') {
            const src = it.acc ? I['acc_' + it.acc.kind] : '';
            return src ? '<img class="krs-img" src="' + src + '" alt="" draggable="false">' : '<img class="krs-img" style="opacity:.45;width:50%;height:50%" src="' + I.ic_close + '" alt="" draggable="false">';
        }
        const a = it.aura;
        if (!a) return '<img class="krs-img" style="opacity:.45;width:50%;height:50%" src="' + I.ic_close + '" alt="" draggable="false">';
        const steps = { sparks: 20, flames: 30, smoke: 60, stars: 36, bubbles: 45, lightning: 25, hearts: 40, snow: 30, leaves: 50, toxic: 45, gold: 22, void: 90 };
        return '<div class="krs-au" style="--c:' + a.color + ';--c2:' + a.color2 + ';--step:' + (steps[a.shape] || 30) + 'deg"></div>';
    },

    cardHtml(/** @type {any} */ c) {
        const I = GameStyle.ICONS;
        let state = '';
        if (c.owned) state = '<span class="krs-ok">' + _kico('ic_check', '') + _kesc(c.priceLabel) + '</span>';
        else if (c.kind === 'coins') state = '<span class="krs-pr' + (c.affordable ? '' : ' is-poor') + '">' + _kico('ic_coin', '') + _kfmt(c.price) + '</span>';
        else if (c.kind === 'ads') {
            let pips = '';
            for (let i = 0; i < c.need; i++) pips += '<i class="' + (i < c.progress ? 'on' : '') + '"></i>';
            state = '<span class="krs-adp">' + _kico('ic_ad', '') + _kesc(c.priceLabel) + '</span><span class="krs-pips">' + pips + '</span>';
        } else state = '<span class="krs-ex">' + _kico('ic_gift', '') + _kesc(c.priceLabel) + '</span>';
        const flag = c.equipped ? '<span class="krs-flag krs-flag--r"><img class="kr-ico" src="' + I.ic_check + '" alt=""></span>'
            : c.owned ? '' : '<span class="krs-flag krs-flag--l"><img class="kr-ico" src="' + I.ic_lock + '" alt=""></span>';
        return '<button class="krs-card r-' + _kesc(c.rarity || 'common') + (c.id === this.sel ? ' is-sel' : '') + (c.owned ? '' : ' is-locked') + '" data-a="card" data-id="' + _kesc(c.id) + '" title="' + _kesc(c.name) + '">' +
            flag + '<div class="krs-th">' + this.thumb(c.item) + '</div><div class="krs-nm">' + _kesc(c.name) + '</div><div class="krs-stl">' + state + '</div></button>';
    },

    renderHead() {
        const t = document.getElementById('krs-shop-t');
        if (t) t.textContent = _kt('krs.shop', null);
        this.el.coins.innerHTML = _kico('ic_coin', '') + '<span>' + _kfmt(Shop.coins) + '</span>';
        const b = this.el.adcoin;
        const supported = typeof Platform !== 'undefined' && typeof Platform.rewarded === 'function' && (!Platform.rewardedSupported || Platform.rewardedSupported());
        b.classList.toggle('kr-hidden', !supported);
        if (!supported) return;
        const amount = this.coinsAdAmount();
        const cd = typeof Platform.rewardedCooldownLabel === 'function' ? Platform.rewardedCooldownLabel() : '';
        const retry = Math.max(0, Math.ceil((this.coinsRetryAt - Date.now()) / 1000));
        const off = !!cd || this.coinsBusy || retry > 0;
        b.classList.toggle('is-off', off);
        b.innerHTML = cd ? '<span>' + _kesc(cd) + '</span>'
            : '<span class="kr-ad">' + _kico('ic_ad', '') + '</span><span class="krs-adtxt">' + _kesc(_kt('krs.coinsAd', { n: amount })) + '</span>' +
              '<span class="krs-adsh">' + _kesc(_kt('krs.coinsAdShort', { n: amount })) + '</span>';
        // в узкой панели (текст скрыт) остаётся «+400» рядом со значком рекламы
        if (!cd) b.setAttribute('title', _kt('krs.coinsAd', { n: amount }));
        b.setAttribute('aria-label', _kt('krs.coinsAd', { n: amount }));
    },

    coinsAdAmount() { return this.COINS_AD; },

    renderTabs() {
        const tabs = Shop.tabs();
        this.el.tabs.innerHTML = SHOP_TABS.map((t) => {
            const on = t.id === this.tab;
            const info = tabs.find((x) => x.id === t.id);
            return '<button class="kr-btn krs-tab ' + (on ? '' : 'kr-btn--dark') + '" data-a="tab" data-tab="' + t.id + '" title="' + _kesc(Shop.text(t.name, t.id)) + (info ? ' ' + info.owned + '/' + info.count : '') + '">' +
                _kico(t.icon, '') + '<span class="krs-tt">' + _kesc(Shop.text(t.name, t.id)) + '</span></button>';
        }).join('');
    },

    renderGrid() {
        const g = this.el.grid;
        const top = g.scrollTop;
        g.innerHTML = Shop.cards(this.tab).map((c) => this.cardHtml(c)).join('');
        g.scrollTop = top;
    },

    renderFoot() {
        const c = this.sel ? Shop.card(this.sel) : null;
        const f = this.el.foot;
        if (!c) { f.innerHTML = ''; return; }
        const rcls = 'r-' + (c.rarity || 'common');
        let sub = '<span class="krs-rar">' + _kesc(c.rarityLabel) + '</span>';
        if (c.kind === 'coins' && !c.owned) sub += '<span class="krs-pr' + (c.affordable ? '' : ' is-poor') + '">' + _kico('ic_coin', '') + _kfmt(c.price) + '</span>';
        else if (c.kind === 'ads' && !c.owned) sub += '<span class="krs-adp">' + _kico('ic_ad', '') + _kesc(c.priceLabel) + '</span>';
        else if (c.kind === 'exclusive' && !c.owned) sub += '<span class="krs-ex">' + _kico('ic_gift', '') + _kesc(c.priceLabel) + '</span>';
        const hint = c.hint && !c.owned && c.action !== 'watch' ? '<div class="krs-hint">' + _kesc(c.hint) + '</div>' : '';
        let act = '';
        if (c.action === 'none') {
            act = c.equipped ? '<span class="krs-owned-tag">' + _kico('ic_check', '') + _kesc(_kt('shop.equipped', null)) + '</span>' : '';
        } else {
            const color = c.action === 'buy' ? 'kr-btn--yellow' : c.action === 'watch' ? 'kr-btn--teal' : c.action === 'equip' ? 'kr-btn--green' : 'kr-btn--dark';
            let inner = '<span>' + _kesc(c.actionLabel) + '</span>';
            if (c.action === 'buy') inner = '<span>' + _kico('ic_coin', '') + '</span>' + inner + '<span>' + _kfmt(c.price) + '</span>';
            else if (c.action === 'watch') inner = '<span class="kr-ad">' + _kico('ic_ad', '') + '</span>' + inner + '<span class="kr-ad" style="color:#fff">' + c.progress + '/' + c.need + '</span>';
            const off = !c.enabled || this.busy;
            act = '<button class="kr-btn ' + color + (off ? ' is-off' : '') + '" data-a="act">' + inner + '</button>';
        }
        const watchHint = c.action === 'watch' && !c.enabled && c.hint && c.hint !== c.actionLabel ? '<div class="krs-hint">' + _kesc(c.hint) + '</div>' : '';
        f.innerHTML = '<div class="krs-fi ' + rcls + '" style="--rc:' + this.rarityColor(c.rarity) + '"><div class="krs-fn">' + _kesc(c.name) + '</div><div class="krs-fs">' + sub + '</div>' + hint + watchHint + '</div>' + act;
    },

    rarityColor(/** @type {string} */ r) {
        return ({ uncommon: '#3FD86B', rare: '#3aa8ff', epic: '#b05cff', legendary: '#FFC400' })[r] || '#9aa7bd';
    },

    async doAct() {
        if (this.busy || !this.sel) return;
        const id = this.sel;
        const c = Shop.card(id);
        if (!c) return;
        if (!c.enabled) {
            _kSfx('ui_error');
            if (c.hint) _kToast(c.hint, 'red');
            return;
        }
        this.busy = true;               // до await: второй клик ничего не сделает
        this.renderFoot();
        /** @type {any} */
        let r = { ok: false, reason: 'error' };
        try { r = await Shop.act(id); } catch (e) { console.warn('GameShopUI: Shop.act:', e); }
        this.busy = false;
        const name = Shop.name(id);
        if (c.action === 'buy') {
            if (r.ok) { _kSfx('ui_buy'); _kToast(_kt('krs.bought', { name }), 'teal'); this.celebrate(10); }
            else { _kSfx('ui_error'); if (r.reason === 'noCoins') _kToast(_kt('shop.noCoins', { n: r.missing || 0 }), 'red'); }
        } else if (c.action === 'watch') {
            if (r.ok && r.unlocked) { _kSfx('reward'); _kToast(_kt('krs.unlocked', { name }), 'teal'); this.celebrate(14); }
            else if (r.ok) { _kSfx('coin'); _kToast(_kt('krs.adCounted', { a: r.progress, b: r.need }), 'teal'); }
            else if (r.reason === 'adFailed' || r.reason === 'adUnavailable') { _kSfx('ui_error'); _kToast(_kt('shop.adUnavailable', null), 'red'); }
        } else if (r.ok) _kSfx('ui_equip');
        const ui = _kUI();
        if (ui && ui.refreshCoins) ui.refreshCoins();
        if (this.cur === 'shop') { this.renderHead(); this.renderTabs(); this.renderGrid(); this.renderFoot(); }
    },

    /** Награда за рекламу в шапке: +N монет только по true от площадки. */
    async doCoinsAd() {
        if (this.coinsBusy || typeof Platform === 'undefined') return;
        const cd = typeof Platform.rewardedCooldownLabel === 'function' ? Platform.rewardedCooldownLabel() : '';
        if (cd || Date.now() < this.coinsRetryAt) { _kSfx('ui_error'); return; }
        this.coinsBusy = true;
        this.renderHead();
        let ok = false;
        try { ok = (await Platform.rewarded('shop-coins')) === true; } catch (e) { ok = false; }
        this.coinsBusy = false;
        if (ok) {
            const n = this.coinsAdAmount();
            Shop.addCoins(n, { reason: 'ad' });
            _kSfx('coin');
            _kToast('+' + _kt('krs.coinsAmount', { n }), 'teal');
            this.celebrate(12);
        } else {
            this.coinsRetryAt = Date.now() + (typeof REWARDED_RETRY_SEC !== 'undefined' ? REWARDED_RETRY_SEC : 4) * 1000;
            _kSfx('ui_error');
            _kToast(_kt('shop.adUnavailable', null), 'red');
        }
        if (this.cur === 'shop') this.renderHead();
    },

    /** Всплеск монет у кайдзю (если игра даёт координаты). */
    celebrate(n) {
        try {
            // @ts-ignore — GameKaiju объявляет js/GameKaiju.js
            const K = typeof GameKaiju !== 'undefined' ? GameKaiju : null;
            if (K) _kFx('coinBurst', K.x, K.y + K.height * 0.55, K.z, n);
        } catch (e) { /* */ }
    },

    // ----------------------------------------------------------------------------------------------
    // Подарок дня
    // ----------------------------------------------------------------------------------------------

    /** Что показать в плитке награды. */
    rewardHtml(/** @type {any} */ d) {
        const r = d.reward;
        const parts = [];
        if (r.exclusive) parts.push('<b>' + _kesc(Shop.name(r.exclusive)) + '</b>');
        if (r.coins > 0) parts.push('<b>' + _kico('ic_coin', '') + _kfmt(r.coins) + '</b>');
        if (r.item) parts.push('<b>' + _kico('ic_shop', '') + _kesc(Shop.name(r.item)) + '</b>');
        if (r.randomItems > 0) parts.push('<b>+ ' + _kico('ic_shop', '') + (r.randomItems > 1 ? 'x' + r.randomItems : _kesc(_kt('reward.randomItem', null))) + '</b>');
        return parts.join('');
    },

    renderDaily() {
        const t = document.getElementById('krs-daily-t');
        if (t) t.textContent = _kt('krs.daily', null);
        const v = DailyGift.view();
        const I = GameStyle.ICONS;
        const tiles = v.days.map((d) => {
            const cls = 'krs-day' + (d.exclusive ? ' krs-day--7' : '') + ' is-' + d.state + (d.state === 'today' ? ' krs-today' : '');
            let glyph;
            if (d.exclusive && d.skin) {
                const it = Shop.item(d.skin);
                glyph = '<div class="krs-dg krs-dg--skin">' + (it ? this.thumb(it) : '') + '</div>';
            } else glyph = '<img class="krs-dg" src="' + (d.state === 'claimed' ? I.gift_open : I.gift_closed) + '" alt="" draggable="false">';
            const mark = d.state === 'claimed' ? '<span class="krs-dmark"><img class="kr-ico" src="' + I.ic_check + '" alt=""></span>' : '';
            const tag = d.exclusive ? '<span class="krs-tag">' + _kesc(d.skin ? _kt('krs.exTag', null) : _kt('krs.dayGoal', null)) + '</span>' : '';
            return '<div class="' + cls + '"><div class="krs-dn">' + _kesc(d.dayLabel) + '</div>' + mark + glyph + '<div class="krs-dr">' + this.rewardHtml(d) + '</div>' + tag + '</div>';
        }).join('');
        this.el.dailyB.innerHTML = '<div class="krs-days">' + tiles + '</div><div class="krs-act" id="krs-dact"></div>';
        this.renderDailyAct();
    },

    renderDailyAct() {
        const box = document.getElementById('krs-dact');
        if (!box || this.cur !== 'daily') return;
        const v = DailyGift.view();
        const busy = this.busy;
        let html = '';
        if (v.claim.enabled) {
            html += '<div class="krs-row"><button class="kr-btn kr-btn--big' + (busy ? ' is-off' : '') + '" data-a="claim"><span>' + _kesc(v.claim.label) + '</span></button>';
            if (v.x2.available) {
                const off = !v.x2.enabled || busy;
                html += '<button class="kr-btn kr-btn--big kr-btn--teal' + (off ? ' is-off' : '') + '" data-a="x2">' + _kico('ic_x2', '') + '<span>' + _kesc(v.x2.label) + '</span></button>';
            }
            html += '</div>';
            if (v.x2.available) html += '<div class="krs-note">' + _kesc(_kt('krs.youGet', { label: v.x2.rewardLabel })) + '</div>';
            const hint = v.x2.hint;
            if (hint) html += '<div class="krs-hint">' + _kesc(hint) + '</div>';
        } else {
            html += '<div class="krs-row"><button class="kr-btn kr-btn--big kr-btn--dark is-off" data-a="none"><span>' + _kesc(_kt('daily.claimed', null)) + '</span></button></div>' +
                '<div class="krs-note"><b>' + _kesc(v.nextLabel) + '</b></div>';
        }
        box.innerHTML = html;
    },

    doClaim() {
        if (this.busy || this.popup) return;
        const r = DailyGift.claim();
        if (!r.ok) { this.renderDaily(); return; }
        this.afterDaily(r);
    },

    async doX2() {
        if (this.busy || this.popup) return;
        const v = DailyGift.view();
        if (!v.x2.enabled) { _kSfx('ui_error'); if (v.x2.hint) _kToast(v.x2.hint, 'red'); return; }
        this.busy = true;               // до await: двойной клик не запросит рекламу дважды
        this.renderDailyAct();
        /** @type {any} */
        let r = { ok: false, reason: 'error' };
        try { r = await DailyGift.claimX2(); } catch (e) { console.warn('GameShopUI: claimX2:', e); }
        this.busy = false;
        if (r.ok) { this.afterDaily(r); return; }
        if (r.reason === 'adFailed' || r.reason === 'adUnavailable') { _kSfx('ui_error'); _kToast(_kt('daily.adUnavailable', null), 'red'); }
        if (this.cur === 'daily') this.renderDaily();
    },

    afterDaily(/** @type {any} */ r) {
        const ui = _kUI();
        if (ui && ui.refreshCoins) ui.refreshCoins();
        this.celebrate(16);
        if (this.cur === 'daily') this.renderDaily();
        this.showPrize('daily', r.got, DailyGift.rewardLabel(r.reward, r.mult), -1);
    },

    // ----------------------------------------------------------------------------------------------
    // Колесо фортуны
    // ----------------------------------------------------------------------------------------------

    renderWheel() {
        const t = document.getElementById('krs-wheel-t');
        if (t) t.textContent = _kt('krs.wheel', null);
        this.renderDisc(-1);
        this.setDisc(this.ang);
        this.renderWheelAct();
    },

    setDisc(/** @type {number} */ a) { this.el.disc.style.transform = 'rotate(' + a + 'deg)'; },

    renderDisc(/** @type {number} */ win) {
        const secs = Wheel.sectors();
        const n = secs.length;
        const step = 360 / n;
        const I = GameStyle.ICONS;
        const stops = secs.map((s, i) => (s.data.color || '#FFC400') + ' ' + (i * step) + 'deg ' + ((i + 1) * step) + 'deg').join(',');
        this.el.disc.style.background = 'repeating-conic-gradient(from ' + (-step / 2) + 'deg, #141A26 0 .7deg, transparent .7deg ' + step + 'deg), conic-gradient(from ' + (-step / 2) + 'deg,' + stops + ')';
        let html = '';
        secs.forEach((s, i) => {
            let inner;
            if (s.kind === 'item') {
                const it = Shop.item(s.itemId);
                inner = '<div class="krs-sec__g">' + (it ? this.thumb(it) : _kico('ic_gift', '')) + '</div><div class="krs-sec__n">' + _kesc(Shop.name(s.itemId)) + '</div>';
            } else inner = _kico('ic_coin', '') + '<b>' + _kfmt(s.coins) + '</b>';
            html += '<div class="krs-sec' + (i === win ? ' is-win' : '') + '" style="transform:rotate(' + (i * step) + 'deg)"><div class="krs-sec__in" style="--ink:' + (s.data.ink || '#141A26') + '">' + inner + '</div></div>';
        });
        html += '<div class="krs-hub"><img src="' + I.emblem + '" alt="" draggable="false"></div>';
        this.el.disc.innerHTML = html;
    },

    renderWheelAct() {
        if (this.cur !== 'wheel') return;
        const s = Wheel.status();
        const lock = this.spinning || this.wheelBusy;
        const cd = typeof Platform !== 'undefined' && Platform.rewardedCooldownLabel ? Platform.rewardedCooldownLabel() : '';
        const left = s.adLeft + s.banked;
        let adLabel;
        if (s.banked === 0 && left === 0) adLabel = _kt('wheel.noSpins', null);
        else if (s.banked === 0 && cd) adLabel = cd;
        else adLabel = _kt('krs.wheelAd', { n: left });
        const freeOff = !s.canSpinFree || lock;
        const adOff = !s.canSpinAd || lock;
        let html = '<button class="kr-btn kr-btn--big' + (freeOff ? ' is-off' : '') + '" data-a="spin-free"><span>' + _kesc(s.freeLabel) + '</span></button>' +
            '<button class="kr-btn kr-btn--big kr-btn--teal' + (adOff ? ' is-off' : '') + '" data-a="spin-ad">' + _kico('ic_ad', '') + '<span>' + _kesc(adLabel) + '</span></button>';
        if (this.spinning) html += '<div class="krs-note">' + _kesc(_kt('wheel.spinning', null)) + '</div>';
        else if (s.hint && !s.canSpinAd) html += '<div class="krs-hint" style="text-align:center">' + _kesc(s.hint) + '</div>';
        this.el.wact.innerHTML = html;
    },

    async doSpin(/** @type {string} */ kind) {
        if (this.spinning || this.wheelBusy || this.popup) return;
        const s = Wheel.status();
        if (kind === 'free' ? !s.canSpinFree : !s.canSpinAd) { _kSfx('ui_error'); return; }
        this.wheelBusy = true;          // до await: ни второй клик, ни вторая реклама
        this.renderWheelAct();
        /** @type {any} */
        let r = { ok: false };
        try { r = kind === 'free' ? Wheel.spinFree() : await Wheel.spinAd(); } catch (e) { console.warn('GameShopUI: вращение:', e); }
        this.wheelBusy = false;
        if (!r.ok) {
            if (r.reason === 'adFailed' || r.reason === 'adUnavailable') { _kSfx('ui_error'); _kToast(_kt('wheel.adUnavailable', null), 'red'); }
            if (this.cur === 'wheel') this.renderWheelAct();
            return;
        }
        this.animateSpin(r);
    },

    /** Результат уже выбран движком: крутим диск до r.angle и выдаём приз ровно один раз. */
    animateSpin(/** @type {any} */ r) {
        this.spinning = true;
        this.renderWheelAct();
        _kSfx('ui_open');
        const from = this.ang;
        const to = Wheel.angleFrom(from, r);
        const dur = r.durationMs || 5500;
        const t0 = performance.now();
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            this.spinning = false;
            this.ang = ((to % 360) + 360) % 360;
            if (this.cur === 'wheel') this.setDisc(this.ang);
            const res = Wheel.finish();
            const ui = _kUI();
            if (ui && ui.refreshCoins) ui.refreshCoins();
            if (res && res.ok) {
                _kSfx('reward');
                this.celebrate(18);
                if (this.cur === 'wheel') { this.renderDisc(res.sector); this.setDisc(this.ang); }
                this.showPrize('wheel', res.got, res.label, res.sector);
            }
            if (this.cur === 'wheel') this.renderWheelAct();
        };
        const frame = (/** @type {number} */ now) => {
            if (done) return;
            const k = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - k, 4);
            if (this.cur === 'wheel') this.setDisc(from + (to - from) * e);
            if (k < 1) requestAnimationFrame(frame); else finish();
        };
        requestAnimationFrame(frame);
        // Вкладка в фоне: rAF стоит, а вращение уже в сохранении — завершаем по таймеру.
        window.setTimeout(finish, dur + 120);
    },

    // ----------------------------------------------------------------------------------------------
    // Окно приза (подарок и колесо)
    // ----------------------------------------------------------------------------------------------

    showPrize(/** @type {string} */ kind, /** @type {any[]} */ got, /** @type {string} */ label, /** @type {number} */ sector) {
        this.popup = { kind, got: got || [], label: label || '', sector };
        this.renderPopup();
    },

    renderPopup() {
        const p = this.popup;
        const host = this.cur === 'wheel' ? this.el.wheelP : this.cur === 'daily' ? this.el.dailyP : null;
        if (!p || !host) return;
        let ov = /** @type {HTMLElement | null} */ (host.querySelector('.krs-pop'));
        if (!ov) {
            ov = document.createElement('div');
            ov.className = 'krs-pop';
            host.appendChild(ov);
        }
        const I = GameStyle.ICONS;
        let lines = '';
        let equipId = '';
        for (const g of p.got) {
            if (g.type === 'coins') {
                lines += '<div class="krs-pl">' + _kico('ic_coin', '') + '<span>+' + _kfmt(g.amount) + '</span></div>' + (g.converted ? '<div class="krs-hint">' + _kesc(_kt('reward.dup', { n: g.amount })) + '</div>' : '');
            } else {
                const it = Shop.item(g.id);
                if (!equipId) equipId = g.id;
                lines += '<div class="krs-pl"><div class="krs-pth">' + (it ? this.thumb(it) : '') + '</div><span>' + _kesc(Shop.name(g.id)) + '</span></div><div class="krs-hint">' + _kesc(_kt('krs.newItem', null)) + '</div>';
            }
        }
        const equip = equipId ? '<button class="kr-btn kr-btn--green" data-a="pop-equip" data-id="' + _kesc(equipId) + '"><span>' + _kesc(_kt('shop.equip', null)) + '</span></button>' : '';
        ov.innerHTML = '<div class="krs-pc kr-pop"><div class="kr-title">' + _kesc(_kt('krs.prizeTitle', null)) + '</div><img src="' + I.gift_open + '" alt="" draggable="false">' + lines +
            '<div class="krs-row">' + equip + '<button class="kr-btn kr-btn--big" data-a="pop-ok"><span>' + _kesc(_kt('krs.prizeOk', null)) + '</span></button></div></div>';
    },

    closePopup() {
        this.popup = null;
        for (const h of [this.el.dailyP, this.el.wheelP]) {
            const ov = h.querySelector('.krs-pop');
            if (ov) ov.remove();
        }
        _kSfx('ui_click');
        if (this.cur === 'wheel') { this.renderDisc(-1); this.setDisc(this.ang); this.renderWheelAct(); }
        else if (this.cur === 'daily') this.renderDaily();
    },

    popEquip(/** @type {string} */ id) {
        const r = Shop.equip(id);
        if (r && r.ok) _kSfx('ui_equip');
        this.closePopup();
    },
};
