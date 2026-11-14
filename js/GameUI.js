// GameUI.js — интерфейс Kaiju Rampage Ultimate: главное меню (карты, «Крушить!», магазин, подарок, колесо), HUD раунда
// (здоровье, рост, звёзды розыска, разрушение, монеты, кнопки атак, предложение «за рекламу»), окна возрождения,
// итога, паузы и настроек. Вёрстка — DOM поверх канваса из общих классов GameStyle.js; тексты — Lang.
// Декоративные слои не ловят нажатия; кнопки атак шлют действия в Input (Input.setVirtual).

/** @satisfies {Record<string, any>} */
const GameUI = {
    /** @type {any} */ game: null,
    /** @type {HTMLElement | null} */ root: null,
    /** @type {Record<string, HTMLElement>} */ el: {},
    /** @type {any} */ result: null,
    /** @type {any} */ offer: null,
    menuHidden: false, toastT: 0, bigT: 0, lastStars: -1, lastCoins: -1, lastLevel: -1,

    init(game) {
        this.game = game;
        const I = (/** @type {string} */ n) => GameStyle.icon(n);
        const root = this.root = document.createElement('div');
        root.className = 'kr-root';
        root.innerHTML = `
<style>
#kr-hud { position: fixed; inset: 0; z-index: 30; pointer-events: none; display: none; }
#kr-hud .kr-btn { pointer-events: auto; }
#kr-hud.is-open { display: block; }
.krh-top { position: absolute; left: 0; right: 0; top: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: var(--kr-u);
  padding: calc(var(--kr-u) * 1) calc(var(--kr-u) * 1.2); padding-top: calc(var(--kr-u) * 1 + var(--lory-safe-top, 0px)); }
.krh-vitals { display: flex; align-items: center; gap: calc(var(--kr-u) * .8); min-width: 0; }
.krh-lvl { flex: none; width: calc(var(--kr-u) * 5.4); height: calc(var(--kr-u) * 5.4); display: grid; place-items: center; background: var(--kr-teal); color: var(--kr-ink);
  border: calc(var(--kr-u) * .3) solid var(--kr-ink); border-radius: calc(var(--kr-u) * 1.2); box-shadow: 0 calc(var(--kr-u) * .4) 0 var(--kr-ink); transform: rotate(-5deg); line-height: .9; text-align: center; }
.krh-lvl small { display: block; font-size: calc(var(--kr-u) * .95); letter-spacing: .04em; }
.krh-lvl b { display: block; font-size: calc(var(--kr-u) * 2.7); font-style: italic; }
.krh-lvl.is-up { animation: kr-pulse .5s ease 3; }
.krh-bars { display: flex; flex-direction: column; gap: calc(var(--kr-u) * .45); width: min(calc(var(--kr-u) * 25), 38vw); min-width: 0; }
#kr-hp { height: calc(var(--kr-u) * 2.3); }
#kr-hp > i { background: linear-gradient(#5dff9a, #1fc463); }
#kr-hp.is-low > i { background: linear-gradient(#ff8a5c, #ff2e2e); }
#kr-hp > span { position: absolute; inset: 0; display: grid; place-items: center; transform: skewX(12deg); font-size: calc(var(--kr-u) * 1.3); color: #fff; text-shadow: 0 1px 0 var(--kr-ink), 0 0 3px var(--kr-ink); }
#kr-grow { height: calc(var(--kr-u) * 1.3); }
#kr-grow > i { background: linear-gradient(#7af7e6, #19bfa9); }
.krh-mid { display: flex; flex-direction: column; align-items: center; gap: calc(var(--kr-u) * .5); }
.krh-stars { display: flex; gap: calc(var(--kr-u) * .15); padding: calc(var(--kr-u) * .3) calc(var(--kr-u) * .8); background: rgba(20, 26, 38, .78); border: calc(var(--kr-u) * .25) solid var(--kr-ink);
  border-radius: calc(var(--kr-u) * 2); }
.krh-stars img { width: calc(var(--kr-u) * 3.1); height: calc(var(--kr-u) * 3.1); transition: transform .2s; }
.krh-stars img.is-new { animation: kr-pop .5s cubic-bezier(.2, 2.2, .4, 1); }
.krh-stars.is-hot { animation: kr-shake .3s linear 3; border-color: var(--kr-red); }
.krh-right { justify-self: end; display: flex; align-items: center; gap: calc(var(--kr-u) * .7); }
.krh-acts { position: absolute; right: calc(var(--kr-u) * 1.4); bottom: calc(var(--kr-u) * 1.6 + var(--lory-safe-bottom, 0px)); display: flex; flex-direction: column; align-items: flex-end; gap: calc(var(--kr-u) * .9); }
.krh-row { display: flex; align-items: flex-end; gap: calc(var(--kr-u) * .9); }
.kr-act { position: relative; flex: none; width: calc(var(--kr-u) * 7.2); height: calc(var(--kr-u) * 7.2); pointer-events: auto; cursor: pointer; border-radius: 50%; border: calc(var(--kr-u) * .34) solid var(--kr-ink);
  background: var(--kr-yellow); box-shadow: 0 calc(var(--kr-u) * .55) 0 var(--kr-ink), inset 0 calc(var(--kr-u) * .5) 0 rgba(255,255,255,.45); display: grid; place-items: center; touch-action: none; overflow: hidden;
  transition: transform .06s; }
.kr-act.is-down { transform: translateY(calc(var(--kr-u) * .4)) scale(.95); box-shadow: 0 calc(var(--kr-u) * .15) 0 var(--kr-ink); }
.kr-act.is-locked { display: none; }
.kr-act.is-new { animation: kr-pop .5s cubic-bezier(.2, 2, .4, 1), kr-pulse .7s ease .5s 4; }
.kr-act img { width: 70%; height: 70%; object-fit: contain; pointer-events: none; }
.kr-act u { position: absolute; left: 0; right: 0; bottom: 3%; text-align: center; text-decoration: none; font-size: calc(var(--kr-u) * 1); color: var(--kr-ink); pointer-events: none; text-shadow: 0 0 3px #fff; }
.kr-act i { position: absolute; inset: 0; pointer-events: none; background: conic-gradient(rgba(20,26,38,.74) calc(var(--cd, 0) * 1turn), transparent 0); }
#kr-act-attack { width: calc(var(--kr-u) * 10.5); height: calc(var(--kr-u) * 10.5); background: var(--kr-red); }
#kr-act-breath { background: var(--kr-teal); }
#kr-act-nova { background: #ff8a1f; } #kr-act-meteor { background: #b06cff; } #kr-act-nuke { background: #7dff5a; }
.kr-kbd .krh-acts { transform: scale(.72); transform-origin: right bottom; }
#kr-offer { position: absolute; left: calc(var(--kr-u) * 1.2); top: 38%; pointer-events: auto; display: none; flex-direction: column; align-items: stretch; gap: 0; min-width: calc(var(--kr-u) * 17);
  max-width: 46vw; padding: 0; text-align: left; transform: none; animation: kr-pulse 1.1s ease infinite; }
#kr-offer.is-open { display: flex; }
#kr-offer > * { transform: none; }
.kro-row { display: flex; align-items: center; gap: calc(var(--kr-u) * .7); padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * .9); }
.kro-row img { width: calc(var(--kr-u) * 4); height: calc(var(--kr-u) * 4); }
.kro-row b { display: block; font-size: calc(var(--kr-u) * 1.5); line-height: 1.05; }
.kro-row small { display: block; font-size: calc(var(--kr-u) * 1.05); font-style: normal; font-weight: 700; text-transform: none; opacity: .85; }
.kro-time { height: calc(var(--kr-u) * .6); background: var(--kr-ink); }
.kro-time i { display: block; height: 100%; width: 100%; background: var(--kr-red); }
#kr-toast { position: absolute; left: 50%; top: 23%; transform: translateX(-50%); max-width: 86%; padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * 1.6); background: var(--kr-ink); color: #fff;
  border-radius: calc(var(--kr-u) * 1); border: calc(var(--kr-u) * .25) solid var(--kr-yellow); font-size: calc(var(--kr-u) * 1.7); font-style: italic; text-align: center; opacity: 0; transition: opacity .25s; }
#kr-toast.is-open { opacity: 1; }
#kr-toast.is-red { border-color: var(--kr-red); } #kr-toast.is-teal { border-color: var(--kr-teal); }
#kr-big { position: absolute; left: 50%; top: 36%; transform: translate(-50%, -50%); width: 96%; text-align: center; font-size: calc(var(--kr-u) * 5.6); color: var(--kr-yellow); opacity: 0; pointer-events: none; }
#kr-big.is-open { opacity: 1; animation: kr-pop .4s cubic-bezier(.2, 1.8, .4, 1); }
#kr-big.is-teal { color: var(--kr-teal); } #kr-big.is-red { color: var(--kr-red); }
@media (orientation: portrait) {
  .krh-top { grid-template-columns: 1fr auto; } .krh-mid { grid-column: 1 / -1; grid-row: 2; }
  .krh-bars { width: min(calc(var(--kr-u) * 22), 44vw); } #kr-offer { top: 27%; }
}
@media (max-height: 430px) { .krh-acts { transform: scale(.74); transform-origin: right bottom; } #kr-offer { top: 30%; } #kr-big { font-size: calc(var(--kr-u) * 4.4); } }

#kr-menu { flex-direction: column; }
#kr-menu.is-hidden { display: none; }
.krm-top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--kr-u); }
.krm-logo { display: flex; align-items: center; gap: calc(var(--kr-u) * .8); pointer-events: none; min-width: 0; }
.krm-logo img { width: calc(var(--kr-u) * 8.5); height: calc(var(--kr-u) * 8.5); flex: none; filter: drop-shadow(0 calc(var(--kr-u) * .4) 0 var(--kr-ink)); }
.krm-logo div { font-size: calc(var(--kr-u) * 3.3); line-height: .92; }
.krm-logo div b { display: block; color: var(--kr-yellow); font-size: .8em; }
.krm-tr { display: flex; align-items: center; gap: calc(var(--kr-u) * .7); flex: none; }
.krm-side { position: absolute; right: calc(var(--kr-u) * 1.2); top: calc(var(--kr-u) * 7.4 + var(--lory-safe-top, 0px)); display: flex; flex-direction: column; gap: calc(var(--kr-u) * .9); }
.krm-side .kr-btn { flex-direction: column; gap: 0; width: calc(var(--kr-u) * 8.6); min-height: calc(var(--kr-u) * 7.6); padding: calc(var(--kr-u) * .3); font-size: calc(var(--kr-u) * 1.05); transform: none; }
.krm-side .kr-btn > * { transform: none; }
.krm-side .kr-btn:active { transform: translateY(calc(var(--kr-u) * .35)); }
.krm-side .kr-ico { width: calc(var(--kr-u) * 4.2); height: calc(var(--kr-u) * 4.2); }
.krm-dot { position: absolute; right: calc(var(--kr-u) * -.5); top: calc(var(--kr-u) * -.5); width: calc(var(--kr-u) * 1.9); height: calc(var(--kr-u) * 1.9); border-radius: 50%; background: var(--kr-red);
  border: calc(var(--kr-u) * .25) solid var(--kr-ink); animation: kr-pulse .9s ease infinite; display: none; }
.krm-dot.is-on { display: block; }
.krm-bottom { margin-top: auto; display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--kr-u) * 1.1); }
.krm-map { display: flex; align-items: center; gap: calc(var(--kr-u) * .8); }
.krm-card { position: relative; width: calc(var(--kr-u) * 25); max-width: 62vw; aspect-ratio: 16 / 8.2; border: calc(var(--kr-u) * .32) solid var(--kr-ink); border-radius: calc(var(--kr-u) * 1.1);
  background: var(--kr-navy) center / cover no-repeat; box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink); overflow: hidden; }
.krm-card.is-locked { filter: saturate(.25) brightness(.75); }
.krm-name { position: absolute; left: 0; right: 0; top: 0; padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * 1); font-size: calc(var(--kr-u) * 2.1); background: linear-gradient(rgba(20,26,38,.85), rgba(20,26,38,0)); }
.krm-info { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; align-items: flex-end; gap: var(--kr-u); padding: calc(var(--kr-u) * .6) calc(var(--kr-u) * .9);
  font-size: calc(var(--kr-u) * 1.3); background: linear-gradient(rgba(20,26,38,0), rgba(20,26,38,.9)); }
.krm-pips { display: flex; gap: calc(var(--kr-u) * .4); }
.krm-pips i { width: calc(var(--kr-u) * 1); height: calc(var(--kr-u) * 1); border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid var(--kr-ink); }
.krm-pips i.is-on { background: var(--kr-yellow); }
.krm-lock { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.krm-lock img { width: calc(var(--kr-u) * 6); height: calc(var(--kr-u) * 6); }
.krm-play { display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: calc(var(--kr-u) * 1); }
@media (orientation: portrait) {
  .krm-side { position: static; flex-direction: row; justify-content: center; margin-top: auto; margin-bottom: calc(var(--kr-u) * 1.2); }
  .krm-bottom { margin-top: 0; align-items: center; } .krm-play { justify-content: center; } .krm-logo { max-width: 50%; } .krm-logo div { font-size: calc(var(--kr-u) * 2); } .krm-logo img { width: calc(var(--kr-u) * 6.4); height: calc(var(--kr-u) * 6.4); }
  .krm-card { width: 70vw; max-width: 70vw; }
}
@media (max-height: 430px) {
  .krm-card { width: calc(var(--kr-u) * 19); } .krm-logo img { width: calc(var(--kr-u) * 5.4); height: calc(var(--kr-u) * 5.4); } .krm-logo div { font-size: calc(var(--kr-u) * 2.3); }
  .krm-bottom { gap: calc(var(--kr-u) * .6); } .krm-side { gap: calc(var(--kr-u) * .5); } .krm-side .kr-btn { min-height: calc(var(--kr-u) * 6.2); width: calc(var(--kr-u) * 7.6); }
  .krm-side .kr-ico { width: calc(var(--kr-u) * 3.2); height: calc(var(--kr-u) * 3.2); } #kr-menu .kr-btn--big { min-height: calc(var(--kr-u) * 5.2); font-size: calc(var(--kr-u) * 2.2); }
}

.krw { width: min(calc(var(--kr-u) * 44), 94%); max-height: 96%; display: flex; flex-direction: column; }
.krw .kr-panel__body { overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: calc(var(--kr-u) * 1); }
.krw-stats { display: grid; grid-template-columns: 1fr auto; gap: calc(var(--kr-u) * .5) calc(var(--kr-u) * 1.4); font-size: calc(var(--kr-u) * 1.6); }
.krw-stats span { opacity: .8; font-weight: 700; } .krw-stats b { text-align: right; }
.krw-coins { display: flex; align-items: center; justify-content: center; gap: calc(var(--kr-u) * .7); font-size: calc(var(--kr-u) * 3.4); color: var(--kr-yellow); }
.krw-coins img { width: calc(var(--kr-u) * 4.2); height: calc(var(--kr-u) * 4.2); }
.krw-row { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(var(--kr-u) * 1); }
.krw-note { text-align: center; font-size: calc(var(--kr-u) * 1.4); color: var(--kr-teal); }
.krw-set { display: flex; align-items: center; justify-content: space-between; gap: var(--kr-u); font-size: calc(var(--kr-u) * 1.6); }
.krw-q { display: flex; gap: calc(var(--kr-u) * .5); flex-wrap: wrap; justify-content: flex-end; }
.krw-q .kr-btn.is-sel { background: var(--kr-teal); color: var(--kr-ink) !important; }
.krw--wide { width: min(calc(var(--kr-u) * 62), 96%); }
.krk-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--kr-u) * 27)), 1fr)); gap: calc(var(--kr-u) * .8); }
.krk-card { display: grid; grid-template-columns: auto 1fr; gap: calc(var(--kr-u) * .3) calc(var(--kr-u) * .9); align-items: center; padding: calc(var(--kr-u) * .7); background: rgba(10, 14, 22, .55);
  border: calc(var(--kr-u) * .25) solid var(--kr-ink); border-radius: calc(var(--kr-u) * .9); }
.krk-ico { grid-row: 1 / span 3; width: calc(var(--kr-u) * 6.4); height: calc(var(--kr-u) * 6.4); border-radius: 50%; background: var(--kr-yellow); border: calc(var(--kr-u) * .3) solid var(--kr-ink); display: grid; place-items: center; }
.krk-ico img { width: 72%; height: 72%; object-fit: contain; }
.krk-name { font-size: calc(var(--kr-u) * 1.6); font-style: italic; text-transform: uppercase; color: #fff; }
.krk-desc { font-size: calc(var(--kr-u) * 1.1); font-weight: 700; opacity: .8; }
.krk-pips { display: flex; align-items: center; gap: calc(var(--kr-u) * .35); font-size: calc(var(--kr-u) * 1.05); font-weight: 700; color: var(--kr-teal); }
.krk-pips i { width: calc(var(--kr-u) * 1.5); height: calc(var(--kr-u) * .8); border-radius: calc(var(--kr-u) * .3); background: rgba(255,255,255,.2); border: 2px solid var(--kr-ink); transform: skewX(-14deg); }
.krk-pips i.is-on { background: var(--kr-teal); }
.krk-pips--lock { color: var(--kr-yellow); }
.krk-pips--lock img { width: calc(var(--kr-u) * 1.5); height: calc(var(--kr-u) * 1.5); object-fit: contain; }
.krk-card.is-locked .krk-ico { filter: grayscale(1) brightness(.75); }
.krk-btns .kr-btn img + img { margin-left: calc(var(--kr-u) * -.3); }
.krt-list { display: flex; flex-direction: column; gap: calc(var(--kr-u) * .45); }
.krt-row { display: grid; grid-template-columns: calc(var(--kr-u) * 3.4) calc(var(--kr-u) * 3.8) minmax(0, 1fr) auto; align-items: center; gap: calc(var(--kr-u) * .8); padding: calc(var(--kr-u) * .45) calc(var(--kr-u) * .9); background: rgba(255,255,255,.07); border-radius: calc(var(--kr-u) * .8); font-size: calc(var(--kr-u) * 1.4); font-weight: 700; }
.krt-row.is-me { background: rgba(255,196,0,.2); box-shadow: inset 0 0 0 2px var(--kr-yellow); }
.krt-rank { text-align: center; color: var(--kr-yellow); font-style: italic; font-size: calc(var(--kr-u) * 1.6); }
.krt-ava { width: calc(var(--kr-u) * 3.6); height: calc(var(--kr-u) * 3.6); border-radius: 50%; object-fit: cover; background: var(--kr-teal); border: 2px solid var(--kr-ink); display: grid; place-items: center; color: var(--kr-ink); font-weight: 900; overflow: hidden; }
.krt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; }
.krt-score { color: var(--kr-teal); }
.krt-empty { text-align: center; padding: calc(var(--kr-u) * 2) 0; font-size: calc(var(--kr-u) * 1.5); opacity: .85; }
.krt-login { display: flex; justify-content: center; margin-top: calc(var(--kr-u) * .9); }
.krk-btns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: calc(var(--kr-u) * .6); justify-content: flex-end; }
.krw-timer { height: calc(var(--kr-u) * .8); background: var(--kr-ink); border-radius: 99px; overflow: hidden; }
.krw-timer i { display: block; height: 100%; background: var(--kr-red); width: 100%; }
</style>

<div id="kr-hud">
  <div class="krh-top">
    <div class="krh-vitals">
      <div class="krh-lvl" id="kr-lvl"><span><small data-t="kr.res.level"></small><b id="kr-lvl-n">1</b></span></div>
      <div class="krh-bars">
        <div class="kr-bar" id="kr-hp"><i></i><span class="kr-num" id="kr-hp-n"></span></div>
        <div class="kr-bar" id="kr-grow"><i></i></div>
      </div>
    </div>
    <div class="krh-mid">
      <div class="krh-stars" id="kr-stars"></div>
      <div class="kr-chip">${I('ic_city')}<span class="kr-num" id="kr-city">0%</span></div>
    </div>
    <div class="krh-right">
      <div class="kr-chip">${I('ic_coin')}<span class="kr-num" id="kr-coins">0</span></div>
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="pause">${I('ic_pause')}</button>
    </div>
  </div>
  <button class="kr-btn kr-btn--green" id="kr-offer" data-act="offer">
    <span class="kro-row"><img id="kr-offer-ico" alt=""><span><b id="kr-offer-t"></b><small id="kr-offer-s"></small><span class="kr-ad" id="kr-offer-ad"></span></span></span>
    <span class="kro-time"><i id="kr-offer-bar"></i></span>
  </button>
  <div id="kr-toast"></div>
  <div class="kr-title" id="kr-big"></div>
  <div class="krh-acts">
    <div class="krh-row">
      <div class="kr-act is-locked" id="kr-act-nuke" data-input="nuke">${I('ic_nuke')}<i></i><u></u></div>
      <div class="kr-act is-locked" id="kr-act-meteor" data-input="meteor">${I('ic_meteor')}<i></i><u></u></div>
      <div class="kr-act is-locked" id="kr-act-nova" data-input="nova">${I('ic_nova')}<i></i><u></u></div>
    </div>
    <div class="krh-row">
      <div class="kr-act is-locked" id="kr-act-breath" data-input="breath">${I('ic_breath')}<i></i><u></u></div>
      <div class="kr-act" id="kr-act-slam" data-input="slam">${I('ic_slam')}<i></i><u></u></div>
      <div class="kr-act" id="kr-act-attack" data-input="attack">${I('ic_claw')}<u></u></div>
    </div>
  </div>
</div>

<div class="kr-screen" id="kr-menu">
  <div class="krm-top">
    <div class="krm-logo">${I('emblem')}<div class="kr-title">${String(GAME_PLATFORM) === 'pikabu' ? 'Ярость кайдзю<b>Разрушь город</b>' : 'Kaiju Rampage<b>Ultimate</b>'}</div></div>
    <div class="krm-tr">
      <div class="kr-chip">${I('ic_coin')}<span class="kr-num" id="krm-coins">0</span></div>
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="top" id="krm-top-btn">${I('ic_trophy')}</button>
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="sound" id="krm-sound"></button>
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="settings">${I('ic_settings')}</button>
    </div>
  </div>
  <div class="krm-side">
    <button class="kr-btn kr-btn--teal" data-act="shop">${I('ic_shop')}<span data-t="kr.shop"></span></button>
    <button class="kr-btn" data-act="daily">${I('ic_gift')}<span data-t="kr.daily"></span><i class="krm-dot" id="krm-dot-daily"></i></button>
    <button class="kr-btn" data-act="wheel">${I('ic_wheel')}<span data-t="kr.wheel"></span><i class="krm-dot" id="krm-dot-wheel"></i></button>
    <button class="kr-btn kr-btn--red" data-act="skills">${I('ic_skills')}<span data-t="kr.skills"></span><i class="krm-dot" id="krm-dot-skills"></i></button>
  </div>
  <div class="krm-bottom">
    <div class="krm-map">
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="map-prev" style="transform: scaleX(-1)">${I('ic_arrow')}</button>
      <div class="krm-card" id="krm-card">
        <div class="krm-name kr-title" id="krm-name"></div>
        <div class="krm-lock" id="krm-lock">${I('ic_lock')}</div>
        <div class="krm-info"><span class="kr-text" id="krm-best"></span><span class="krm-pips" id="krm-pips"></span></div>
      </div>
      <button class="kr-btn kr-btn--dark kr-btn--icon" data-act="map-next">${I('ic_arrow')}</button>
    </div>
    <div class="krm-play" id="krm-play"></div>
  </div>
</div>

<div class="kr-screen kr-dim" id="kr-revive">
  <div class="kr-panel krw kr-pop">
    <div class="kr-panel__head">${I('ic_skull')}<div class="kr-title" data-t="kr.revive.t"></div></div>
    <div class="kr-panel__body">
      <div class="krw-timer"><i id="kr-revive-bar"></i></div>
      <div class="krw-row"><button class="kr-btn kr-btn--green kr-btn--big" data-act="revive" id="kr-revive-btn"></button></div>
      <div class="krw-row"><button class="kr-btn kr-btn--dark kr-btn--small" data-act="revive-no"><span data-t="kr.revive.no"></span></button></div>
    </div>
  </div>
</div>

<div class="kr-screen kr-dim" id="kr-result">
  <div class="kr-panel krw kr-pop">
    <div class="kr-panel__head"><span id="kr-res-ico"></span><div class="kr-title" id="kr-res-title"></div></div>
    <div class="kr-panel__body">
      <div class="krw-stats" id="kr-res-stats"></div>
      <div class="krw-note" id="kr-res-note"></div>
      <div class="krw-coins">${I('ic_coin')}<span class="kr-num" id="kr-res-coins">0</span></div>
      <div class="krw-row" id="kr-res-btns"></div>
    </div>
  </div>
</div>

<div class="kr-screen kr-dim" id="kr-top">
  <div class="kr-panel krw kr-pop">
    <div class="kr-panel__head">${I('ic_trophy')}<div class="kr-title" data-t="kr.top"></div><button class="kr-btn kr-btn--red kr-btn--icon kr-btn--small" data-act="top-close">${I('ic_close')}</button></div>
    <div class="kr-panel__body">
      <div class="krt-list" id="krt-list"></div>
      <div class="krt-login" id="krt-login"><button class="kr-btn kr-btn--teal" data-act="top-login"><span data-t="kr.top.login"></span></button></div>
    </div>
  </div>
</div>

<div class="kr-screen kr-dim" id="kr-skills">
  <div class="kr-panel krw krw--wide kr-pop">
    <div class="kr-panel__head">${I('ic_skills')}<div class="kr-title" data-t="kr.skills"></div><div class="kr-chip">${I('ic_coin')}<span class="kr-num" id="krk-coins">0</span></div><button class="kr-btn kr-btn--red kr-btn--icon kr-btn--small" data-act="skills-close">${I('ic_close')}</button></div>
    <div class="kr-panel__body">
      <div class="krw-note" data-t="kr.sk.bonus"></div>
      <div class="krk-list" id="krk-list"></div>
    </div>
  </div>
</div>

<div class="kr-screen kr-dim" id="kr-pause">
  <div class="kr-panel krw kr-pop">
    <div class="kr-panel__head">${I('ic_pause')}<div class="kr-title" id="kr-pause-title"></div><button class="kr-btn kr-btn--red kr-btn--icon kr-btn--small" data-act="pause-close">${I('ic_close')}</button></div>
    <div class="kr-panel__body">
      <div class="krw-row" id="kr-pause-main"></div>
      <div class="krw-set"><span data-t="kr.sound"></span><button class="kr-btn kr-btn--dark kr-btn--icon" data-act="sound" id="krp-sound"></button></div>
      <div class="krw-set"><span data-t="kr.quality"></span><div class="krw-q" id="kr-q"></div></div>
      <div class="krw-note kr-hidden" id="kr-q-note" data-t="kr.qNote"></div>
      <div class="krw-row" id="kr-pause-extra"></div>
    </div>
  </div>
</div>`;
        document.body.appendChild(root);
        for (const n of root.querySelectorAll('[id]')) this.el[n.id] = /** @type {HTMLElement} */ (n);
        if (!this.topAvailable()) this.el['krm-top-btn'].style.display = 'none';
        Lang.apply();

        root.addEventListener('click', (e) => {
            const t = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-act]'));
            if (t) this.act(String(t.dataset.act));
        });
        // Кнопки атак: палец или мышь -> действие Input (зажатие для луча)
        for (const b of root.querySelectorAll('.kr-act')) {
            const a = String(/** @type {HTMLElement} */ (b).dataset.input);
            const set = (/** @type {boolean} */ on) => { Input.setVirtual(a, on); b.classList.toggle('is-down', on); };
            b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(/** @type {PointerEvent} */ (e).pointerId); } catch (err) { /* */ } set(true); });
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
        }
        const dev = () => { root.classList.toggle('kr-kbd', Input.device !== 'touch'); this.keys(); };
        window.addEventListener('lory-input-device', dev);
        window.addEventListener('lory-language', () => { Lang.apply(); this.renderMenu(); });
        dev();
        Platform.onRewardedCooldown(() => { if (this.game.state === 'menu') { this.renderPlay(); this.renderSkills(); } this.refreshOffer(); if (this.result) this.resultRefresh(); });
        this.setSound(!Sound.muted);
        this.stars(0, false);
        this.game.app.onFrame((/** @type {number} */ dt) => this.frame(dt));
    },

    // Подписи клавиш на кнопках атак (на ПК)
    keys() {
        const kbd = Input.device !== 'touch';
        for (const a of ['attack', 'breath', 'slam', 'nova', 'meteor', 'nuke']) {
            const u = this.el['kr-act-' + a].querySelector('u');
            if (u) u.textContent = kbd ? Input.labelOf(a) : '';
        }
    },

    act(a) {
        const G = this.game;
        // @ts-ignore — GameShopUI объявляет js/GameShopUI.js
        const S = typeof GameShopUI !== 'undefined' ? GameShopUI : null;
        switch (a) {
            case 'play': G.play(false); break;
            case 'boost': G.playBoost(); break;
            case 'unlock': G.unlockByAd(); break;
            case 'map-prev': G.selectMap(-1); break;
            case 'map-next': G.selectMap(1); break;
            case 'shop': SFX('ui_open'); if (S) S.openShop(); break;
            case 'daily': SFX('ui_open'); if (S) S.openDaily(); break;
            case 'wheel': SFX('ui_open'); if (S) S.openWheel(); break;
            case 'howto': this.showPause(false); G.howTo(); break;
            case 'skills': SFX('ui_open'); this.showSkills(true); break;
            case 'skills-close': SFX('ui_click'); this.showSkills(false); break;
            case 'top': SFX('ui_open'); this.showTop(true); break;
            case 'top-close': SFX('ui_click'); this.showTop(false); break;
            case 'top-login': SFX('ui_click'); G.loginTop(); break;
            case 'settings': SFX('ui_open'); this.showPause(true, true); break;
            case 'sound': this.setSound(!Sound.toggleMuted()); break;
            case 'pause': G.togglePause(); break;
            case 'pause-close': if (G.state === 'play') G.togglePause(); else this.showPause(false); break;
            case 'resume': G.togglePause(); break;
            case 'finish': Pause.set('manual', false); this.showPause(false); G.endRun(false); break;
            case 'offer': G.takeOffer(); break;
            case 'revive': G.revive(); break;
            case 'revive-no': G.reviveT = 0; this.showRevive(false); break;
            case 'double': G.doubleCoins(); break;
            case 'again': SFX('ui_click'); G.again(); break;
            case 'menu': SFX('ui_click'); G.menu(); break;
            default:
                if (a.indexOf('sk-get-') === 0) { G.buySkill(a.slice(7)); break; }
                if (a.indexOf('sk-getad-') === 0) { G.buySkillAd(a.slice(9)); break; }
                if (a.indexOf('sk-buy-') === 0) { G.upgradeSkill(a.slice(7)); break; }
                if (a.indexOf('sk-ad-') === 0) { G.upgradeSkillAd(a.slice(6)); break; }
                if (a.indexOf('q-') === 0 && typeof Quality !== 'undefined') { Quality.set(a.slice(2)); this.el['kr-q-note'].classList.remove('kr-hidden'); this.renderQuality(); SFX('ui_click'); }
        }
    },

    /** Подпись кнопки «за рекламу»: «За рекламу» или «Через N с»; пусто — реклама не поддерживается. */
    adTag() {
        if (!Platform.rewardedSupported()) return '';
        const left = Platform.rewardedCooldownLeft();
        return '<span class="kr-ad">' + GameStyle.icon('ic_ad') + (left > 0 ? T('kr.adIn', { n: Math.ceil(left) }) : T('kr.forAd')) + '</span>';
    },
    adReady() { return Platform.rewardedSupported() && Platform.rewardedReady(); },

    // --- Меню -------------------------------------------------------------------------------------
    showMenu(on) { this.el['kr-menu'].classList.toggle('is-open', !!on); if (on) this.setMenuHidden(false); },
    /** Магазин и другие окна прячут меню, а не рисуются поверх. */
    setMenuHidden(on) { this.menuHidden = !!on; this.el['kr-menu'].classList.toggle('is-hidden', !!on); if (!on) this.renderMenu(); },

    refreshCoins() {
        const c = this.game.coins();
        if (c !== this.lastCoins) { this.lastCoins = c; this.el['krm-coins'].textContent = String(c); }
    },

    renderMenu() {
        const G = this.game, c = G.mapCard(G.menuMap);
        this.refreshCoins();
        const card = this.el['krm-card'];
        card.style.backgroundImage = 'url(' + GameStyle.ICONS['map_' + c.id] + ')';
        card.classList.toggle('is-locked', !c.open);
        this.el['krm-name'].textContent = c.name;
        this.el['krm-lock'].classList.toggle('kr-hidden', c.open);
        this.el['krm-best'].textContent = c.open ? T('kr.best', { n: c.best }) : T('kr.locked', { n: c.need, map: c.prev });
        this.el['krm-pips'].innerHTML = Array.from({ length: c.count }, (_, i) => '<i class="' + (i === c.index ? 'is-on' : '') + '"></i>').join('');
        this.renderPlay();
        // @ts-ignore — GameShopUI объявляет js/GameShopUI.js
        const S = typeof GameShopUI !== 'undefined' ? GameShopUI : null;
        let b = { daily: false, wheel: false };
        try { if (S && S.badges) b = S.badges(); } catch (e) { /* */ }
        this.el['krm-dot-daily'].classList.toggle('is-on', !!b.daily);
        this.el['krm-dot-wheel'].classList.toggle('is-on', !!b.wheel);
        if (this.el['krm-dot-skills']) this.el['krm-dot-skills'].classList.toggle('is-on', this.game.skillsAffordable());
    },

    renderPlay() {
        const G = this.game, c = G.mapCard(G.menuMap), ad = this.adTag(), ready = this.adReady();
        let h;
        if (c.open) {
            h = '<button class="kr-btn kr-btn--red kr-btn--big" data-act="play">' + GameStyle.icon('ic_play') + '<span>' + T('kr.play') + '</span></button>';
            if (ad) h += '<button class="kr-btn kr-btn--teal ' + (ready ? '' : 'is-off') + '" data-act="boost">' + GameStyle.icon('ic_level') + '<span>' + T('kr.boost') + '</span>' + ad + '</button>';
        } else if (ad) {
            h = '<button class="kr-btn kr-btn--green kr-btn--big ' + (ready ? '' : 'is-off') + '" data-act="unlock">' + GameStyle.icon('ic_lock') + '<span>' + T('kr.unlockAd', { a: c.ads, b: c.adNeed }) + '</span>' + ad + '</button>';
        } else h = '<button class="kr-btn kr-btn--dark kr-btn--big is-off">' + GameStyle.icon('ic_lock') + '<span>' + T('kr.locked', { n: c.need, map: c.prev }) + '</span></button>';
        this.el['krm-play'].innerHTML = h;
    },

    setSound(on) {
        const h = GameStyle.icon(on ? 'ic_sound_on' : 'ic_sound_off');
        this.el['krm-sound'].innerHTML = h; this.el['krp-sound'].innerHTML = h;
    },

    // --- HUD ----------------------------------------------------------------------------------------
    showHud(on) { this.el['kr-hud'].classList.toggle('is-open', !!on); if (on) { this.lastLevel = -1; this.stars(0, false); this.keys(); for (const id of ['breath', 'nova', 'meteor', 'nuke']) this.el['kr-act-' + id].classList.remove('is-new'); } },

    hud(d) {
        const E = this.el;
        /** @type {HTMLElement} */ (E['kr-hp'].firstElementChild).style.width = Math.max(0, Math.min(100, d.hp / d.maxHp * 100)) + '%';
        E['kr-hp'].classList.toggle('is-low', d.hp < d.maxHp * 0.3);
        E['kr-hp-n'].textContent = Math.ceil(d.hp) + ' / ' + d.maxHp;
        /** @type {HTMLElement} */ (E['kr-grow'].firstElementChild).style.width = Math.round(d.xp * 100) + '%';
        if (d.level !== this.lastLevel) {
            if (this.lastLevel >= 0 && d.level > this.lastLevel) { E['kr-lvl'].classList.remove('is-up'); void E['kr-lvl'].offsetWidth; E['kr-lvl'].classList.add('is-up'); }
            this.lastLevel = d.level; E['kr-lvl-n'].textContent = String(d.level);
        }
        E['kr-city'].textContent = Math.floor(d.destroyed) + '%';
        E['kr-coins'].textContent = String(d.coins);
        E['kr-act-breath'].style.setProperty('--cd', String(1 - d.energy));
        for (const id of ['slam', 'nova', 'meteor', 'nuke']) E['kr-act-' + id].style.setProperty('--cd', String(d.cd[id]));
        for (const id of ['breath', 'nova', 'meteor', 'nuke']) E['kr-act-' + id].classList.toggle('is-locked', !GameKaiju.can(id));      // кнопка есть только у купленного умения
        E['kr-act-attack'].style.background = d.rage > 0 ? '#ff2e2e' : '';
    },

    /** Открылось новое умение: кнопка появляется с анимацией, сверху — подсказка. */
    unlockSkill(id) {
        const b = this.el['kr-act-' + id];
        if (b) { b.classList.remove('is-locked', 'is-new'); void b.offsetWidth; b.classList.add('is-new'); }
        const key = Input.device !== 'touch' ? ' [' + Input.labelOf(id) + ']' : '';
        this.toast(T('kr.sk.new', { name: T('kr.sk.' + id) }) + key, 3200, 'teal');
    },

    // --- Окно «Рекорды»: лидерборд площадки (технический id Score; Яндекс, Playgama) -------------------------
    /** @type {any[] | null} */ topCache: null,
    topT: -1e9,
    TOP_CACHE_MS: 60000,      // Яндекс: не больше 20 запросов таблицы за 5 минут — держим последнюю минуту

    /** У площадки есть лидерборд: иначе кнопки «Рекорды» нет. */
    topAvailable() { const a = /** @type {any} */ (Platform.adapter); return !!(a && typeof a.leaderboard === 'function'); },

    showTop(on) {
        this.el['kr-top'].classList.toggle('is-open', !!on);
        if (on) this.loadTop(false);
    },

    async loadTop(force) {
        this.el['krt-login'].style.display = Platform.canLogin() ? '' : 'none';
        if (!force && this.topCache && performance.now() - this.topT < this.TOP_CACHE_MS) { this.renderTop(this.topCache); return; }
        this.el['krt-list'].innerHTML = '<div class="krt-empty">' + T('kr.top.loading') + '</div>';
        const rows = await Platform.leaderboard({ quantityTop: 10, includeUser: true, quantityAround: 2, avatarSize: 'medium' });
        if (rows) { this.topCache = rows; this.topT = performance.now(); }
        this.renderTop(rows);
    },

    renderTop(rows) {
        const list = this.el['krt-list'];
        if (!rows) { list.innerHTML = '<div class="krt-empty">' + T('kr.top.err') + '</div>'; return; }
        if (!rows.length) { list.innerHTML = '<div class="krt-empty">' + T('kr.top.empty') + '</div>'; return; }
        const esc = (/** @type {any} */ v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        list.innerHTML = rows.map((r) => {
            const name = r.name ? String(r.name) : T('kr.top.anon');
            const ava = r.avatar ? '<img class="krt-ava" src="' + esc(r.avatar) + '" alt="" draggable="false" referrerpolicy="no-referrer">'
                : '<div class="krt-ava">' + esc(name.slice(0, 1).toUpperCase()) + '</div>';
            return '<div class="krt-row' + (r.me ? ' is-me' : '') + '"><div class="krt-rank">' + esc(r.rank) + '</div>' + ava
                + '<div class="krt-name">' + esc(name) + '</div><div class="krt-score">' + esc(Math.round(Number(r.score) || 0)) + '</div></div>';
        }).join('');
    },

    // --- Окно «Умения» ---------------------------------------------------------------------------------
    showSkills(on) {
        this.el['kr-skills'].classList.toggle('is-open', !!on);
        this.setMenuHidden(!!on);
        if (on) this.renderSkills();
    },

    renderSkills() {
        if (!this.el['kr-skills'].classList.contains('is-open')) return;
        const G = this.game, ad = this.adTag(), ready = this.adReady(), coins = G.coins();
        this.el['krk-coins'].textContent = String(coins);
        this.el['krk-list'].innerHTML = Object.keys(KR.SKILLS).map((id) => {
            const c = G.skillCard(id);
            let pips = '';
            for (let i = 1; i <= KR.SKILL_MAX; i++) pips += '<i class="' + (i <= c.level ? 'is-on' : '') + '"></i>';
            let btns, info;
            const adIco = Platform.rewardedCooldownLeft() > 0 ? ad : GameStyle.icon('ic_ad');
            if (!c.owned) {
                // Не куплено: купить навсегда за монеты или открыть за рекламу
                btns = '<button class="kr-btn kr-btn--small ' + (coins >= c.buy ? '' : 'kr-btn--dark') + '" data-act="sk-get-' + id + '">' + GameStyle.icon('ic_coin') + '<span>' + c.buy + '</span></button>';
                if (ad) btns += '<button class="kr-btn kr-btn--green kr-btn--small ' + (ready ? '' : 'is-off') + '" data-act="sk-getad-' + id + '"><span>' + T('kr.sk.unlockAd', { a: c.buyAdsDone, b: c.buyAds }) + '</span>' + adIco + '</button>';
                info = '<div class="krk-pips krk-pips--lock">' + GameStyle.icon('ic_lock') + '<span>' + T('kr.sk.locked') + '</span></div>';
            } else {
                if (c.max) btns = '<span class="kr-chip">' + GameStyle.icon('ic_check') + T('kr.sk.max') + '</span>';
                else {
                    btns = '<button class="kr-btn kr-btn--small ' + (coins >= c.cost ? '' : 'kr-btn--dark') + '" data-act="sk-buy-' + id + '">' + GameStyle.icon('ic_up') + GameStyle.icon('ic_coin') + '<span>' + c.cost + '</span></button>';
                    if (ad) btns += '<button class="kr-btn kr-btn--green kr-btn--small ' + (ready ? '' : 'is-off') + '" data-act="sk-ad-' + id + '"><span>' + T('kr.sk.adProgress', { a: c.ads, b: c.adNeed }) + '</span>' + adIco + '</button>';
                }
                info = '<div class="krk-pips">' + pips + '<span>' + T('kr.sk.level', { n: c.level, m: KR.SKILL_MAX }) + '</span></div>';
            }
            return '<div class="krk-card' + (c.owned ? '' : ' is-locked') + '"><div class="krk-ico">' + GameStyle.icon(c.icon) + '</div><div class="krk-name">' + c.name + '</div><div class="krk-desc">' + c.desc
                + '</div>' + info + '<div class="krk-btns">' + btns + '</div></div>';
        }).join('');
    },

    stars(n, up) {
        const box = this.el['kr-stars'];
        if (n === this.lastStars && box.children.length) return;
        let h = '';
        for (let i = 1; i <= 6; i++) h += '<img alt="" draggable="false" class="' + (up && i === n ? 'is-new' : '') + '" src="' + GameStyle.ICONS[i <= n ? 'ic_star_on' : 'ic_star_off'] + '">';
        box.innerHTML = h;
        this.lastStars = n;
        if (up) { box.classList.remove('is-hot'); void box.offsetWidth; box.classList.add('is-hot'); }
    },

    toast(text, ms, color) {
        const t = this.el['kr-toast'];
        t.textContent = text;
        t.className = 'is-open' + (color ? ' is-' + color : '');
        this.toastT = (ms || 2200) / 1000;
    },

    big(text, color) {
        const b = this.el['kr-big'];
        b.textContent = text;
        b.className = 'kr-title';
        void b.offsetWidth;
        b.className = 'kr-title is-open' + (color ? ' is-' + color : '');
        this.bigT = 1.6;
    },

    /** Предложение «за рекламу» в раунде: { id, t, dur } или null. */
    setOffer(o) {
        this.offer = o;
        const b = this.el['kr-offer'];
        b.classList.toggle('is-open', !!o);
        if (!o) return;
        const ico = { heal: 'ic_heal', calm: 'ic_calm', rage: 'ic_rage' }[o.id] || 'ic_ad';
        /** @type {HTMLImageElement} */ (this.el['kr-offer-ico']).src = GameStyle.ICONS[ico];
        this.el['kr-offer-t'].textContent = T('kr.offer.' + o.id);
        this.el['kr-offer-s'].textContent = T('kr.offer.' + o.id + '.s');
        b.className = 'kr-btn is-open ' + (o.id === 'rage' ? 'kr-btn--red' : o.id === 'calm' ? 'kr-btn--teal' : 'kr-btn--green');
        this.refreshOffer();
    },

    refreshOffer() {
        if (!this.offer) return;
        this.el['kr-offer-ad'].innerHTML = GameStyle.icon('ic_ad') + T('kr.forAd');
        this.el['kr-offer'].classList.toggle('is-off', !this.adReady() || Platform.adActive);
    },

    // --- Возрождение --------------------------------------------------------------------------------
    showRevive(on) {
        this.el['kr-revive'].classList.toggle('is-open', !!on);
        if (on) this.el['kr-revive-btn'].innerHTML = GameStyle.icon('ic_revive') + '<span>' + T('kr.revive') + '</span>' + this.adTag();
    },
    reviveTime(t) { this.el['kr-revive-bar'].style.width = Math.max(0, Math.min(100, t / 9 * 100)) + '%'; },

    // --- Итог раунда ----------------------------------------------------------------------------------
    showResult(d) {
        this.result = d;
        this.el['kr-result'].classList.toggle('is-open', !!d);
        if (!d) return;
        this.el['kr-res-ico'].innerHTML = GameStyle.icon(d.win ? 'ic_trophy' : 'ic_skull');
        this.el['kr-res-title'].textContent = T(d.win ? 'kr.win' : d.died ? 'kr.lose' : 'kr.ended');
        const mm = Math.floor(d.time / 60), ss = Math.floor(d.time % 60);
        const rows = [['kr.res.destroyed', d.pct + '%'], ['kr.res.level', d.level], ['kr.res.kills', d.kills], ['kr.res.stars', '★'.repeat(d.stars) || '—'], ['kr.res.time', mm + ':' + (ss < 10 ? '0' : '') + ss]];
        this.el['kr-res-stats'].innerHTML = rows.map((r) => '<span>' + T(String(r[0])) + '</span><b class="kr-num">' + r[1] + '</b>').join('');
        this.el['kr-res-note'].textContent = d.opened ? T('kr.res.next', { map: d.opened }) : '';
        this.el['kr-res-coins'].textContent = '+' + d.coins;
        this.resultRefresh();
    },

    resultRefresh() {
        const d = this.result;
        if (!d) return;
        const ad = this.adTag();
        let h = '';
        if (ad && !d.doubled && d.coins > 0) h += '<button class="kr-btn kr-btn--green ' + (this.adReady() ? '' : 'is-off') + '" data-act="double">' + GameStyle.icon('ic_x2') + '<span>' + T('kr.res.x2') + '</span>' + ad + '</button>';
        h += '<button class="kr-btn kr-btn--red" data-act="again">' + GameStyle.icon('ic_restart') + '<span>' + T('kr.res.again') + '</span></button>';
        h += '<button class="kr-btn kr-btn--dark" data-act="menu">' + GameStyle.icon('ic_home') + '<span>' + T('kr.res.menu') + '</span></button>';
        this.el['kr-res-btns'].innerHTML = h;
    },

    resultDoubled(total) {
        if (!this.result) return;
        this.result.doubled = true;
        const c = this.el['kr-res-coins'];
        c.textContent = '+' + total;
        c.parentElement && c.parentElement.classList.add('kr-pop');
        this.resultRefresh();
    },

    // --- Пауза и настройки (одно окно: в меню — настройки, в раунде — пауза) ---------------------------
    showPause(on, settings) {
        this.el['kr-pause'].classList.toggle('is-open', !!on);
        if (!on) return;
        this.el['kr-pause-title'].textContent = T(settings ? 'kr.settings' : 'kr.pause');
        this.el['kr-pause-main'].innerHTML = settings ? '' : '<button class="kr-btn kr-btn--green kr-btn--big" data-act="resume">' + GameStyle.icon('ic_play') + '<span>' + T('kr.resume') + '</span></button>';
        this.el['kr-pause-extra'].innerHTML = settings ? '<button class="kr-btn kr-btn--dark" data-act="howto">' + GameStyle.icon('ic_help') + '<span>' + T('kr.howto') + '</span></button>'
            : '<button class="kr-btn kr-btn--dark" data-act="howto">' + GameStyle.icon('ic_help') + '<span>' + T('kr.howto') + '</span></button>'
            + '<button class="kr-btn kr-btn--red" data-act="finish">' + GameStyle.icon('ic_home') + '<span>' + T('kr.finish') + '</span></button>';
        this.el['kr-q-note'].classList.add('kr-hidden');
        this.renderQuality();
    },

    renderQuality() {
        const cur = typeof Quality !== 'undefined' ? (Quality.choice || 'auto') : 'auto';
        this.el['kr-q'].innerHTML = ['auto', 'low', 'medium', 'high'].map((q) => '<button class="kr-btn kr-btn--dark kr-btn--small ' + (q === cur ? 'is-sel' : '') + '" data-act="q-' + q + '"><span>' + T('kr.q.' + q) + '</span></button>').join('');
    },

    // --- Кадр (и на паузе): таймеры подсказок, полоса предложения ----------------------------------------
    frame(dt) {
        if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el['kr-toast'].classList.remove('is-open'); }
        if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.el['kr-big'].classList.remove('is-open'); }
        if (this.offer) this.el['kr-offer-bar'].style.width = Math.max(0, Math.min(100, this.offer.t / this.offer.dur * 100)) + '%';
        if (this.game.state === 'menu' && !this.menuHidden) this.refreshCoins();
    },
};
