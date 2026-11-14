// GameStyle.js — общий визуальный язык интерфейса Kaiju Rampage Ultimate: «кайдзю-катастрофа в комиксе».
// Скошенные плашки с толстым тёмным контуром и жёсткой тенью, аварийные жёлто-чёрные полосы, шрифт Rubik Black.
// Все окна игры (GameUI.js, GameShopUI.js) собираются из этих классов и переменных, а не из своих цветов.
//
//   --kr-u            единица размера: растёт с экраном (9..16 px); все отступы и кегли — в ней
//   --kr-yellow / --kr-red / --kr-teal / --kr-ink / --kr-light / --kr-navy / --kr-green     палитра
//   .kr-screen        слой на весь экран (меню, окна); .kr-screen.is-open — показан
//   .kr-panel         плашка-окно (фон — металл assets/ui/ui_plate.webp), .kr-panel__head — шапка с полосами
//   .kr-btn           кнопка; цвет: .kr-btn--yellow | --red | --teal | --dark | --green; размер: .kr-btn--big | --small
//   .kr-btn .kr-ad    метка «за рекламу» внутри кнопки (иконка assets/ui/ic_ad.webp)
//   .kr-title         заголовок с обводкой; .kr-text — обычный текст; .kr-num — числа
//   .kr-ico           картинка-иконка (img); .kr-chip — маленькая плашка (монеты, уровень)
//   .kr-bar > i       полоса (HP, рост, энергия): ширина i — доля

/** @satisfies {Record<string, any>} */
const GameStyle = {
    done: false,

    init() {
        if (this.done || typeof document === 'undefined') return;
        this.done = true;
        const css = `
@font-face { font-family: 'KRFont'; src: url('assets/fonts/rubik.ttf') format('truetype'); font-weight: 300 900; font-display: swap; }
:root {
  --kr-u: clamp(9px, min(1.55vw, 2.5vh), 16px);
  --kr-yellow: #FFC400; --kr-red: #FF4B1F; --kr-teal: #29E0C8; --kr-ink: #141A26; --kr-light: #E9EDF2; --kr-navy: #1B2333; --kr-green: #3FD86B;
  --kr-font: 'KRFont', 'Arial Black', system-ui, sans-serif;
  --vcap-bg: #0c1018;
}
.kr-root, .kr-root * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.kr-root { font-family: var(--kr-font); font-weight: 900; color: var(--kr-light); font-size: calc(var(--kr-u) * 1.4); line-height: 1.15; }
.kr-root button { font: inherit; color: inherit; }
.kr-hidden { display: none !important; }
.kr-screen { position: fixed; inset: 0; z-index: 40; display: none; pointer-events: none; padding: calc(var(--kr-u) * 1.2);
  padding-top: calc(var(--kr-u) * 1.2 + var(--lory-safe-top, 0px)); padding-bottom: calc(var(--kr-u) * 1.2 + var(--lory-safe-bottom, 0px)); }
.kr-screen.is-open { display: flex; }
.kr-screen > * { pointer-events: auto; }
.kr-dim { background: rgba(8, 11, 18, .72); pointer-events: auto; align-items: center; justify-content: center; }
.kr-title { font-style: italic; font-weight: 900; text-transform: uppercase; letter-spacing: .01em; color: #fff;
  -webkit-text-stroke: calc(var(--kr-u) * .34) var(--kr-ink); paint-order: stroke fill; text-shadow: 0 calc(var(--kr-u) * .32) 0 var(--kr-ink); }
.kr-text { font-weight: 700; color: var(--kr-light); text-shadow: 0 1px 0 rgba(0,0,0,.6); }
.kr-num { font-variant-numeric: tabular-nums; }
.kr-panel { position: relative; background: var(--kr-navy) url('assets/ui/ui_plate.webp'); background-size: calc(var(--kr-u) * 16);
  border: calc(var(--kr-u) * .3) solid var(--kr-ink); border-radius: calc(var(--kr-u) * 1.1);
  box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink), 0 calc(var(--kr-u) * 1.4) calc(var(--kr-u) * 2.6) rgba(0,0,0,.5); overflow: hidden; }
.kr-panel__head { display: flex; align-items: center; gap: calc(var(--kr-u) * .8); min-height: calc(var(--kr-u) * 4.2); padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * 1.2);
  background: var(--kr-yellow) url('assets/ui/ui_hazard.webp'); background-size: calc(var(--kr-u) * 4.6); border-bottom: calc(var(--kr-u) * .3) solid var(--kr-ink); }
.kr-panel__head .kr-title { font-size: calc(var(--kr-u) * 2.2); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kr-panel__body { padding: calc(var(--kr-u) * 1.2); }
.kr-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: calc(var(--kr-u) * .6); cursor: pointer; user-select: none;
  min-height: calc(var(--kr-u) * 4.4); padding: calc(var(--kr-u) * .5) calc(var(--kr-u) * 1.6); border: calc(var(--kr-u) * .3) solid var(--kr-ink);
  border-radius: calc(var(--kr-u) * .9); background: var(--kr-yellow); color: var(--kr-ink) !important; font-size: calc(var(--kr-u) * 1.6); font-style: italic; font-weight: 900;
  text-transform: uppercase; text-align: center; box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink), inset 0 calc(var(--kr-u) * .35) 0 rgba(255,255,255,.45);
  transform: skewX(-6deg); transition: transform .08s ease, box-shadow .08s ease, filter .12s ease; touch-action: manipulation; }
.kr-btn > * { transform: skewX(6deg); pointer-events: none; }
.kr-btn:hover { filter: brightness(1.08); }
.kr-btn:active, .kr-btn.is-down { transform: skewX(-6deg) translateY(calc(var(--kr-u) * .35)); box-shadow: 0 calc(var(--kr-u) * .15) 0 var(--kr-ink), inset 0 calc(var(--kr-u) * .35) 0 rgba(255,255,255,.3); }
.kr-btn[disabled], .kr-btn.is-off { filter: grayscale(.9) brightness(.72); cursor: default; pointer-events: none; }
.kr-btn--red { background: var(--kr-red); color: #fff !important; text-shadow: 0 2px 0 var(--kr-ink); }
.kr-btn--teal { background: var(--kr-teal); }
.kr-btn--green { background: var(--kr-green); }
.kr-btn--dark { background: #33405c; color: var(--kr-light) !important; box-shadow: 0 calc(var(--kr-u) * .5) 0 var(--kr-ink), inset 0 calc(var(--kr-u) * .3) 0 rgba(255,255,255,.14); }
.kr-btn--big { min-height: calc(var(--kr-u) * 6.4); padding: calc(var(--kr-u) * .6) calc(var(--kr-u) * 3); font-size: calc(var(--kr-u) * 2.6); border-radius: calc(var(--kr-u) * 1.2); }
.kr-btn--small { min-height: calc(var(--kr-u) * 3.4); padding: calc(var(--kr-u) * .3) calc(var(--kr-u) * 1); font-size: calc(var(--kr-u) * 1.25); }
.kr-btn--icon { width: calc(var(--kr-u) * 4.6); min-width: calc(var(--kr-u) * 4.6); padding: 0; transform: none; }
.kr-btn--icon > * { transform: none; }
.kr-btn--icon:active { transform: translateY(calc(var(--kr-u) * .35)); }
.kr-ico { width: calc(var(--kr-u) * 2.6); height: calc(var(--kr-u) * 2.6); object-fit: contain; flex: none; pointer-events: none; -webkit-user-drag: none; }
.kr-btn--big .kr-ico { width: calc(var(--kr-u) * 3.6); height: calc(var(--kr-u) * 3.6); }
.kr-ad { display: inline-flex; align-items: center; gap: calc(var(--kr-u) * .3); padding: calc(var(--kr-u) * .1) calc(var(--kr-u) * .6); border-radius: calc(var(--kr-u) * .5);
  background: var(--kr-ink); color: var(--kr-yellow); font-size: .72em; font-style: normal; white-space: nowrap; }
.kr-ad img { width: 1.3em; height: 1.3em; }
.kr-chip { display: inline-flex; align-items: center; gap: calc(var(--kr-u) * .5); min-height: calc(var(--kr-u) * 3.4); padding: calc(var(--kr-u) * .2) calc(var(--kr-u) * 1.1) calc(var(--kr-u) * .2) calc(var(--kr-u) * .5);
  background: rgba(20, 26, 38, .86); border: calc(var(--kr-u) * .25) solid var(--kr-ink); border-radius: calc(var(--kr-u) * 2); font-size: calc(var(--kr-u) * 1.7); color: #fff;
  box-shadow: 0 calc(var(--kr-u) * .3) 0 rgba(0,0,0,.45); white-space: nowrap; }
.kr-bar { position: relative; height: calc(var(--kr-u) * 1.7); background: rgba(10, 14, 22, .82); border: calc(var(--kr-u) * .25) solid var(--kr-ink); border-radius: calc(var(--kr-u) * .6);
  overflow: hidden; transform: skewX(-12deg); }
.kr-bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: var(--kr-green); box-shadow: inset 0 calc(var(--kr-u) * .35) 0 rgba(255,255,255,.4); transition: width .18s ease; }
.kr-pop { animation: kr-pop .32s cubic-bezier(.2, 1.6, .4, 1) both; }
.lory-tut { --tut-bg: rgba(20, 26, 38, .94); --tut-fg: #fff; --tut-accent: #FFC400; --tut-border: #141A26; --tut-font: var(--kr-font); --tut-radius: calc(var(--kr-u) * 1); --tut-z: 35; }
.lory-tut-card { border-width: calc(var(--kr-u) * .3) !important; box-shadow: 0 calc(var(--kr-u) * .5) 0 #141A26 !important; left: 50% !important; top: calc(var(--kr-u) * 12.6 + var(--lory-safe-top, 0px)) !important;
  transform: translateX(-50%) !important; width: max-content !important; max-width: min(560px, 94%) !important; height: auto !important; }
.lory-tut-title { font-style: italic; text-transform: uppercase; color: var(--kr-yellow); }
@media (orientation: portrait) { .lory-tut-card { top: calc(var(--kr-u) * 17 + var(--lory-safe-top, 0px)) !important; } }
@media (max-height: 430px) { .lory-tut-card { top: calc(var(--kr-u) * 11 + var(--lory-safe-top, 0px)) !important; padding: 6px 10px !important; } }
@keyframes kr-pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes kr-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
@keyframes kr-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
`;
        const el = document.createElement('style');
        el.id = 'kr-style';
        el.textContent = css;
        document.head.appendChild(el);
        document.documentElement.style.setProperty('--vcap-bg', '#0c1018');
    },

    /**
     * HTML иконки интерфейса: name — ключ GameStyle.ICONS (ic_coin, tab_color…).
     * @param {string} name @param {string} [cls] @returns {string}
     */
    icon(name, cls) {
        const url = GameStyle.ICONS[name];
        return url ? '<img class="kr-ico ' + (cls || '') + '" src="' + url + '" alt="" draggable="false">' : '';
    },

    // Пути — литералами (сборщик берёт в архив только такие ссылки).
    ICONS: {
        ic_coin: 'assets/ui/ic_coin.webp', ic_star_on: 'assets/ui/ic_star_on.webp', ic_star_off: 'assets/ui/ic_star_off.webp', ic_hp: 'assets/ui/ic_hp.webp',
        ic_level: 'assets/ui/ic_level.webp', ic_claw: 'assets/ui/ic_claw.webp', ic_breath: 'assets/ui/ic_breath.webp', ic_slam: 'assets/ui/ic_slam.webp',
        ic_ad: 'assets/ui/ic_ad.webp', ic_rage: 'assets/ui/ic_rage.webp', ic_heal: 'assets/ui/ic_heal.webp', ic_calm: 'assets/ui/ic_calm.webp',
        ic_revive: 'assets/ui/ic_revive.webp', ic_shop: 'assets/ui/ic_shop.webp', ic_gift: 'assets/ui/ic_gift.webp', ic_wheel: 'assets/ui/ic_wheel.webp',
        ic_settings: 'assets/ui/ic_settings.webp', ic_sound_on: 'assets/ui/ic_sound_on.webp', ic_sound_off: 'assets/ui/ic_sound_off.webp',
        ic_pause: 'assets/ui/ic_pause.webp', ic_play: 'assets/ui/ic_play.webp', ic_lock: 'assets/ui/ic_lock.webp', ic_check: 'assets/ui/ic_check.webp',
        ic_home: 'assets/ui/ic_home.webp', ic_restart: 'assets/ui/ic_restart.webp', ic_help: 'assets/ui/ic_help.webp', ic_x2: 'assets/ui/ic_x2.webp',
        ic_skull: 'assets/ui/ic_skull.webp', ic_trophy: 'assets/ui/ic_trophy.webp', ic_city: 'assets/ui/ic_city.webp', ic_army: 'assets/ui/ic_army.webp',
        ic_time: 'assets/ui/ic_time.webp', ic_nova: 'assets/ui/ic_nova.webp', ic_meteor: 'assets/ui/ic_meteor.webp', ic_nuke: 'assets/ui/ic_nuke.webp', ic_skills: 'assets/ui/ic_skills.webp', ic_map: 'assets/ui/ic_map.webp', ic_close: 'assets/ui/ic_close.webp', ic_arrow: 'assets/ui/ic_arrow.webp', ic_up: 'assets/ui/ic_up.webp',
        tab_monster: 'assets/ui/tab_monster.webp', tab_color: 'assets/ui/tab_color.webp', tab_breath: 'assets/ui/tab_breath.webp',
        tab_acc: 'assets/ui/tab_acc.webp', tab_aura: 'assets/ui/tab_aura.webp',
        emblem: 'assets/ui/emblem.webp', hand: 'assets/ui/hand.webp', gift_closed: 'assets/ui/gift_closed.webp', gift_open: 'assets/ui/gift_open.webp',
        wheel_pointer: 'assets/ui/wheel_pointer.webp',
        map_metro: 'assets/ui/map_metro.webp', map_harbor: 'assets/ui/map_harbor.webp', map_tokyo: 'assets/ui/map_tokyo.webp',
        map_desert: 'assets/ui/map_desert.webp', map_arctic: 'assets/ui/map_arctic.webp',
        monster_titan: 'assets/ui/skins/monster_titan.webp', monster_rex: 'assets/ui/skins/monster_rex.webp', monster_ape: 'assets/ui/skins/monster_ape.webp',
        monster_mecha: 'assets/ui/skins/monster_mecha.webp', monster_drake: 'assets/ui/skins/monster_drake.webp', monster_golem: 'assets/ui/skins/monster_golem.webp',
        monster_deep: 'assets/ui/skins/monster_deep.webp', monster_beetle: 'assets/ui/skins/monster_beetle.webp',
        acc_crown_gold: 'assets/ui/acc/crown_gold.webp', acc_crown_iron: 'assets/ui/acc/crown_iron.webp', acc_horns_bull: 'assets/ui/acc/horns_bull.webp',
        acc_horns_demon: 'assets/ui/acc/horns_demon.webp', acc_halo: 'assets/ui/acc/halo.webp', acc_top_hat: 'assets/ui/acc/top_hat.webp',
        acc_party_hat: 'assets/ui/acc/party_hat.webp', acc_viking: 'assets/ui/acc/viking.webp', acc_kabuto: 'assets/ui/acc/kabuto.webp',
        acc_mohawk: 'assets/ui/acc/mohawk.webp', acc_unicorn: 'assets/ui/acc/unicorn.webp', acc_flower_crown: 'assets/ui/acc/flower_crown.webp',
        acc_antenna: 'assets/ui/acc/antenna.webp', acc_headphones: 'assets/ui/acc/headphones.webp', acc_cap: 'assets/ui/acc/cap.webp',
        acc_wings_angel: 'assets/ui/acc/wings_angel.webp', acc_wings_bat: 'assets/ui/acc/wings_bat.webp', acc_jetpack: 'assets/ui/acc/jetpack.webp',
        acc_cannons: 'assets/ui/acc/cannons.webp', acc_crystals: 'assets/ui/acc/crystals.webp', acc_shell: 'assets/ui/acc/shell.webp', acc_cape: 'assets/ui/acc/cape.webp',
    },
};
