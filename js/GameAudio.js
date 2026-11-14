// GameAudio.js — музыка и звуки «Kaiju Rampage Ultimate» поверх Sound.js.
//
// Музыка — своя, оригинальная: шесть тем (menu, metro, harbor, tokyo, desert, arctic) синтезируются
// в коде через OfflineAudioContext (нота за нотой по партитуре в TRACKS ниже) и играют как
// синхронные стемы одного цикла: pad / bass / drumsL / drumsH / lead / tension.
// GameAudio.setIntensity(0..6) (звёзды розыска) плавно (1-2 с) подмешивает слои.
// Тема готовится в prepare() под экраном загрузки (по стему за раз, между ними отдаём поток), кэшируется;
// при подготовке другой карты прежняя карта из кэша выбрасывается (menu остаётся).
//
// Подключение к движку без правки Sound.js: берём Sound.ctx / Sound.musicGain (цепочка
// musicGain -> duckGain -> master -> лимитер), поэтому mute, рекламная тишина, пауза (контекст
// стоит — музыка тоже) и Sound.duck работают как у остальных звуков. До первого жеста контекста
// нет: тема ждёт и стартует сама (оборачиваем Sound._startPending + слушаем жесты + опрос).
//
// Звуки (sfx / loop): файлы из Sound Pack (assets/sounds/, литералами) + синтез на лету
// (Sound.makeBuffer / putBuffer, 'synth:имя'): рёв, шаги, дыхание-луч, сирена, винт и т.д.
// Пути к файлам звуков — только строковые литералы (сборщик ассетов их ищет по тексту).

/**
 * Синтезатор: партитуры тем, рендер стемов, синтез звуков. Приватная кухня GameAudio (без DOM и без Sound).
 */
const GameAudioKit = (() => {
    const BASE_SR = 32000;                 // частота «полных» стемов; pad и bass — 16000 (низ и мягкий верх)
    const TAIL = 3;                        // сек. хвоста за концом цикла (реверб и затухание): сворачивается в начало
    const STEM_NAMES = ['pad', 'bass', 'drumsL', 'drumsH', 'lead', 'tension'];
    const STEM_RATE = [16000, 16000, 32000, 32000, 32000, 32000];
    const STEM_PEAK = [0.22, 0.30, 0.30, 0.36, 0.26, 0.24];   // целевой пик стема до общей нормировки

    // ---------- Музыкальные утилиты ----------
    const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    /** @param {string} name  'F#', 'Bb' -> 0..11 */
    function pcOf(name) {
        const m = /^([A-G])(#|b)?$/.exec(name);
        if (!m) throw new Error('bad pitch class ' + name);
        return (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    }
    /** @param {string} name  'C#4' -> MIDI */
    function midi(name) {
        const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
        if (!m) throw new Error('bad note ' + name);
        return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    }
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const CHORD = {
        min: [0, 3, 7], maj: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], d7: [0, 4, 7, 10],
        sus: [0, 5, 7], dim: [0, 3, 6], p5: [0, 7, 12],
    };
    /**
     * Разбор строки нот: 'E4:2 r:1 G4' (имя:длина в 16-х, r — пауза) или относительной: '0:3 r:1 7:4'
     * (полутоны/индексы). Возвращает [{ step, len, n }], n — MIDI либо число; длина по умолчанию 2.
     * @param {string} str
     */
    function parseSeq(str) {
        const out = [];
        let step = 0;
        for (const tok of String(str).trim().split(/\s+/)) {
            if (!tok) continue;
            const [n, l] = tok.split(':');
            const len = l ? Number(l) : 2;
            if (n !== 'r') out.push({ step, len, n: /^-?\d+$/.test(n) ? Number(n) : midi(n) });
            step += len;
        }
        return out;
    }
    /** Сумма длин строки нот (в 16-х) — для проверки партитуры. */
    function seqLen(str) {
        let s = 0;
        for (const tok of String(str).trim().split(/\s+/)) if (tok) s += tok.split(':')[1] ? Number(tok.split(':')[1]) : 2;
        return s;
    }

    /** Детерминированный ГСЧ (mulberry32). */
    function rng(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    // ---------- Голоса (синтез нот в OfflineAudioContext) ----------
    // osc: [{ t: тип, det: цент, mul: множитель частоты, g: громкость }], lp/lpRel — срез фильтра (Гц / от частоты ноты),
    // lpEnv — множитель среза в момент атаки (спадает за lpDec), a/d/s/r — огибающая, vib — вибрато.
    const V = {
        strings: { osc: [{ t: 'sawtooth', det: -10 }, { t: 'sawtooth', det: 9 }, { t: 'sawtooth', det: 0, g: 0.8 }], lp: 1700, q: 0.5, a: 0.7, d: 0.8, s: 0.85, r: 1.0, g: 0.22 },
        warm: { osc: [{ t: 'triangle', det: -6 }, { t: 'sawtooth', det: 6, g: 0.5 }], lp: 1100, a: 0.5, d: 0.8, s: 0.85, r: 0.9, g: 0.26 },
        synthpad: { osc: [{ t: 'sawtooth', det: -14 }, { t: 'sawtooth', det: 14 }, { t: 'square', det: 0, g: 0.5 }], lp: 2400, lpEnv: 0.5, lpDec: 0.8, q: 0.6, a: 0.35, d: 0.6, s: 0.8, r: 0.5, g: 0.2 },
        icy: { osc: [{ t: 'sawtooth', det: -6 }, { t: 'sawtooth', det: 11 }, { t: 'triangle', mul: 2, g: 0.5 }], lp: 1500, q: 2, a: 1.2, d: 1, s: 0.8, r: 1.6, g: 0.2 },
        rhodes: { osc: [{ t: 'sine' }, { t: 'sine', mul: 4, g: 0.16 }, { t: 'triangle', det: 5, g: 0.4 }], lp: 3500, a: 0.004, d: 0.5, s: 0.25, r: 0.35, g: 0.3 },
        brass: { osc: [{ t: 'sawtooth', det: -7 }, { t: 'sawtooth', det: 7 }, { t: 'square', mul: 0.5, g: 0.5 }], lp: 900, lpEnv: 3.5, lpDec: 0.3, q: 1.2, a: 0.07, d: 0.4, s: 0.85, r: 0.18, g: 0.3, vib: { rate: 5, depth: 6, delay: 0.25 } },
        synthLead: { osc: [{ t: 'sawtooth', det: -11 }, { t: 'sawtooth', det: 11 }, { t: 'square', det: 0, g: 0.35 }], lp: 3800, lpEnv: 1.6, lpDec: 0.2, a: 0.01, d: 0.15, s: 0.75, r: 0.14, g: 0.26, vib: { rate: 5.5, depth: 10, delay: 0.15 } },
        pluck: { osc: [{ t: 'sawtooth' }, { t: 'square', det: 6, g: 0.5 }], lp: 2800, lpEnv: 2.2, lpDec: 0.12, a: 0.002, d: 0.18, s: 0.02, r: 0.08, g: 0.22 },
        sub: { osc: [{ t: 'sine' }, { t: 'triangle', g: 0.25 }], lp: 400, a: 0.012, d: 0.3, s: 0.8, r: 0.2, g: 0.6 },
        sawBass: { osc: [{ t: 'sawtooth' }, { t: 'square', det: -6, g: 0.6 }], lp: 700, lpEnv: 3, lpDec: 0.12, q: 2, a: 0.004, d: 0.2, s: 0.55, r: 0.08, g: 0.4 },
        slap: { osc: [{ t: 'sawtooth' }, { t: 'square', det: 4, g: 0.7 }], lp: 1300, lpEnv: 3.5, lpDec: 0.07, q: 1.5, a: 0.002, d: 0.12, s: 0.3, r: 0.05, g: 0.42 },
        oud: { osc: [{ t: 'sawtooth' }, { t: 'triangle', mul: 2, g: 0.5 }], lp: 1400, lpEnv: 3, lpDec: 0.1, q: 1, a: 0.002, d: 0.35, s: 0.03, r: 0.1, g: 0.35 },
        reed: { osc: [{ t: 'sawtooth', det: -8 }, { t: 'sawtooth', det: 8 }, { t: 'square', g: 0.4 }], lp: 2600, q: 3.5, lpEnv: 1.4, lpDec: 0.1, a: 0.03, d: 0.15, s: 0.8, r: 0.1, g: 0.26, vib: { rate: 5.8, depth: 22, delay: 0.12 } },
        twang: { osc: [{ t: 'sawtooth' }, { t: 'square', det: 7, g: 0.6 }], lp: 3200, lpEnv: 2, lpDec: 0.18, q: 2, a: 0.002, d: 0.25, s: 0.15, r: 0.12, g: 0.28, vib: { rate: 6.5, depth: 14, delay: 0.2 } },
        droneSaw: { osc: [{ t: 'sawtooth', det: -8 }, { t: 'sawtooth', det: 8 }, { t: 'square', mul: 0.5, g: 0.6 }], lp: 420, q: 1, a: 0.6, d: 1, s: 0.9, r: 0.6, g: 0.3 },
        stab: { osc: [{ t: 'sawtooth', det: -6 }, { t: 'sawtooth', det: 6 }], lp: 1800, lpEnv: 2.2, lpDec: 0.1, a: 0.004, d: 0.08, s: 0.4, r: 0.08, g: 0.3 },
        alarm: { osc: [{ t: 'square' }], lp: 2600, a: 0.003, d: 0.05, s: 0.8, r: 0.03, g: 0.2 },
    };

    /** Одна нота голоса v: старт t, длина dur (сек), частота f, громкость vel, send — доля в реверб. */
    function note(S, v, t, dur, f, vel, send) {
        const oc = S.oc, nyq = oc.sampleRate * 0.45;
        const end = t + dur;
        const g = oc.createGain();
        const filt = oc.createBiquadFilter();
        filt.type = v.ft || 'lowpass';
        filt.Q.value = v.q || 0.7;
        const cut = Math.min(v.lp || f * (v.lpRel || 8), nyq);
        if (v.lpEnv && v.lpEnv !== 1) {
            filt.frequency.setValueAtTime(Math.min(cut * v.lpEnv, nyq), t);
            filt.frequency.exponentialRampToValueAtTime(cut, t + (v.lpDec || 0.2));
        } else filt.frequency.value = cut;
        const a = v.a || 0.005, d = v.d || 0.1, s = v.s == null ? 0.7 : v.s, r = v.r || 0.1;
        const peak = (v.g || 0.3) * vel;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + a);
        g.gain.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
        g.gain.setTargetAtTime(0, Math.max(end, t + a), Math.max(0.01, r / 4));
        const stopT = Math.max(end, t + a) + r * 1.8 + 0.05;
        let lg = null;
        if (v.vib) {
            const lfo = oc.createOscillator();
            lfo.frequency.value = v.vib.rate;
            lg = oc.createGain();
            lg.gain.setValueAtTime(0, t);
            lg.gain.linearRampToValueAtTime(v.vib.depth, t + (v.vib.delay || 0) + 0.3);
            lfo.connect(lg);
            lfo.start(t); lfo.stop(stopT);
        }
        for (const o of v.osc) {
            const osc = oc.createOscillator();
            osc.type = o.t;
            osc.frequency.value = f * (o.mul || 1);
            if (o.det) osc.detune.value = o.det;
            if (lg) lg.connect(osc.detune);
            if (o.g && o.g !== 1) { const og = oc.createGain(); og.gain.value = o.g; osc.connect(og); og.connect(filt); } else osc.connect(filt);
            osc.start(t); osc.stop(stopT);
        }
        filt.connect(g);
        sink(S, g, send);
    }

    /** Колокольный FM-тон (холодный лид). */
    function bell(S, t, dur, f, vel, send) {
        const oc = S.oc;
        const car = oc.createOscillator(), mod = oc.createOscillator(), mg = oc.createGain(), g = oc.createGain();
        car.frequency.value = f; mod.frequency.value = f * 3.5;
        mg.gain.setValueAtTime(f * 2.2, t); mg.gain.setTargetAtTime(f * 0.12, t, 0.25);
        mod.connect(mg); mg.connect(car.frequency);
        const peak = 0.3 * vel;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004);
        g.gain.setTargetAtTime(0, t + 0.004, Math.max(0.15, dur * 0.45));
        car.connect(g);
        const stopT = t + dur * 2.4 + 1.2;
        car.start(t); mod.start(t); car.stop(stopT); mod.stop(stopT);
        sink(S, g, send);
    }

    function sink(S, node, send) {
        node.connect(S.dry);
        if (send && S.hasRev) {
            const sg = S.oc.createGain();
            sg.gain.value = send;
            node.connect(sg); sg.connect(S.wet);
        }
    }

    // ---------- Ударные ----------
    function tone(S, t, o) {
        const oc = S.oc, osc = oc.createOscillator(), g = oc.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.f0, t);
        if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.fd || 0.06));
        const atk = o.atk || 0.001;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(o.peak, t + atk);
        g.gain.setTargetAtTime(0, t + atk, o.dec * 0.22);
        osc.connect(g);
        osc.start(t); osc.stop(t + atk + o.dec * 1.5 + 0.02);
        sink(S, g, o.send);
    }
    function nz(S, t, o) {
        const oc = S.oc, src = oc.createBufferSource(), f = oc.createBiquadFilter(), g = oc.createGain();
        src.buffer = S.noise; src.loop = true;
        src.start(t, S.rnd() * 1.5);
        f.type = o.type || 'highpass';
        f.frequency.value = Math.min(o.f, oc.sampleRate * 0.45);
        f.Q.value = o.q || 0.7;
        const atk = o.atk || 0.001;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(o.peak, t + atk);
        g.gain.setTargetAtTime(0, t + atk, o.dec * 0.22);
        src.connect(f); f.connect(g);
        src.stop(t + atk + o.dec * 1.5 + 0.02);
        sink(S, g, o.send);
    }
    const taiko = (f, big) => (S, t, v) => {
        tone(S, t, { f0: f * 1.9, f1: f, fd: 0.1, peak: 0.9 * v, dec: big ? 0.85 : 0.5, send: 0.22 });
        tone(S, t, { type: 'triangle', f0: f * 3.3, f1: f * 2.2, fd: 0.08, peak: 0.25 * v, dec: 0.25 });
        nz(S, t, { type: 'lowpass', f: 700, peak: 0.5 * v, dec: 0.06 });
    };
    const tom = (f) => (S, t, v) => tone(S, t, { f0: f * 1.35, f1: f, fd: 0.08, peak: 0.8 * v, dec: 0.35, send: 0.1 });
    const DRUM = {
        kick: (S, t, v) => { tone(S, t, { f0: 150, f1: 46, fd: 0.07, peak: 0.95 * v, dec: 0.32 }); nz(S, t, { f: 3000, peak: 0.25 * v, dec: 0.012 }); },
        kickL: (S, t, v) => { tone(S, t, { f0: 120, f1: 40, fd: 0.1, peak: 0.95 * v, dec: 0.55 }); nz(S, t, { f: 2500, peak: 0.2 * v, dec: 0.012 }); },
        taiko: taiko(78, true), taikoM: taiko(104, false), taikoS: taiko(150, false),
        tomH: tom(220), tomM: tom(160), tomL: tom(115),
        snare: (S, t, v) => {
            nz(S, t, { type: 'bandpass', f: 2000, q: 0.8, peak: 0.55 * v, dec: 0.18, send: 0.12 });
            tone(S, t, { type: 'triangle', f0: 210, f1: 170, fd: 0.04, peak: 0.45 * v, dec: 0.11 });
            nz(S, t, { f: 5000, peak: 0.15 * v, dec: 0.1 });
        },
        snr: (S, t, v) => {
            nz(S, t, { type: 'bandpass', f: 3200, q: 1, peak: 0.6 * v, dec: 0.09 });
            nz(S, t, { f: 6000, peak: 0.25 * v, dec: 0.07 });
            tone(S, t, { type: 'triangle', f0: 250, f1: 200, fd: 0.03, peak: 0.3 * v, dec: 0.05 });
        },
        rim: (S, t, v) => { tone(S, t, { f0: 1000, f1: 700, fd: 0.02, peak: 0.35 * v, dec: 0.03 }); nz(S, t, { f: 2500, peak: 0.3 * v, dec: 0.015 }); },
        clap: (S, t, v) => {
            for (let i = 0; i < 4; i++) nz(S, t + i * 0.011, { type: 'bandpass', f: 1100, q: 1.2, peak: 0.4 * v, dec: i === 3 ? 0.16 : 0.02, send: i === 3 ? 0.2 : 0 });
        },
        hat: (S, t, v) => nz(S, t, { f: 8000, peak: 0.3 * v, dec: 0.045 }),
        ohat: (S, t, v) => nz(S, t, { f: 7000, peak: 0.25 * v, dec: 0.25 }),
        shaker: (S, t, v) => nz(S, t, { type: 'bandpass', f: 7500, q: 1.2, atk: 0.012, peak: 0.22 * v, dec: 0.07 }),
        cowbell: (S, t, v) => { tone(S, t, { type: 'square', f0: 562, peak: 0.13 * v, dec: 0.18 }); tone(S, t, { type: 'square', f0: 845, peak: 0.13 * v, dec: 0.14 }); },
        dum: (S, t, v) => tone(S, t, { f0: 190, f1: 105, fd: 0.05, peak: 0.9 * v, dec: 0.3, send: 0.08 }),
        tek: (S, t, v) => { tone(S, t, { f0: 560, f1: 480, fd: 0.03, peak: 0.35 * v, dec: 0.06 }); nz(S, t, { type: 'bandpass', f: 3500, q: 1, peak: 0.35 * v, dec: 0.05 }); },
        ka: (S, t, v) => { tone(S, t, { f0: 400, peak: 0.25 * v, dec: 0.04 }); nz(S, t, { f: 2500, peak: 0.3 * v, dec: 0.035 }); },
        conga: (S, t, v) => tone(S, t, { f0: 350, f1: 310, fd: 0.05, peak: 0.6 * v, dec: 0.18 }),
        crash: (S, t, v) => { nz(S, t, { f: 4000, atk: 0.002, peak: 0.35 * v, dec: 1.8, send: 0.35 }); nz(S, t, { type: 'bandpass', f: 8000, q: 0.6, peak: 0.2 * v, dec: 1.1 }); },
    };
    const VEL = { X: 1, x: 0.7, o: 0.42, g: 0.25 };

    // ---------- Партитуры ----------
    // prog — аккорд на каждый такт; шаг сетки — 1/16 (16 на такт).
    // pads — слои пэда: { voice, hits: ['шаг:длина …'] по тактам (циклом), oct, ext (доп. интервалы), send, vel }.
    // arp — арпеджио (в стеме pad): индексы тонов аккорда [r,3,5,r+12,3+12,5+12]. air — шумовой ветер.
    // bass — { voice, oct, pats: ['полутон:длина …'] по тактам (циклом), send }.
    // lead — { voice | 'bell', bars: строки нот по тактам, send, double: { voice, shift, vel } }.
    // dL / dH — { инструмент: ['X.x.o…' (16 символов) по тактам (циклом)] }, X / x / o — громкость.
    // tension — { root, style: 'horn' | 'siren', stabs: ['паттерн'] }.
    const TRACKS = {
        // ===== MENU: тяжёлый медленный марш кайдзю, D фригийский/гармонический минор, 64 уд/мин, 8 тактов =====
        menu: {
            bpm: 64, bars: 8, swing: 0, revSec: 2.6,
            prog: [['D', 'min'], ['D', 'min'], ['Bb', 'maj'], ['Bb', 'maj'], ['G', 'min'], ['A', 'maj'], ['D', 'min'], ['A', 'maj']],
            pads: [{ voice: 'strings', hits: ['0:16'], oct: 3, ext: [], send: 0.4 }],
            bass: { voice: 'sub', oct: 2, pats: ['0:6 r:2 0:3 r:1 7:4', '0:6 r:2 0:3 r:1 7:4', '0:6 r:2 0:3 r:1 7:4', '0:4 0:4 7:4 12:4'] },
            lead: {
                voice: 'brass', send: 0.25, double: { voice: 'strings', shift: 12, vel: 0.5 },
                bars: ['D3:3 r:1 D3:3 r:1 F3:4 A3:4', 'G3:3 F3:1 E3:4 D3:8', 'Bb3:3 r:1 Bb3:3 r:1 D4:4 C4:4', 'Bb3:4 A3:4 F3:8',
                    'G3:3 r:1 G3:3 r:1 Bb3:4 D4:4', 'C#4:4 E4:4 A3:8', 'D4:6 C4:2 A3:4 F3:4', 'A3:6 G3:2 F3:4 E3:4'],
            },
            dL: {
                shaker: ['x.o.x.o.x.o.x.o.'], rim: ['....x.......x...'],
                tomL: ['X.....o.........', 'X.....o.........', 'X.....o.........', 'X.....o...o.o...'],
            },
            dH: {
                taiko: ['X.......X.......', 'X.......X.....x.', 'X.......X.......', 'X.......X...x.x.'],
                taikoM: ['....x.......x...', '....x.....x.x...', '....x.......x...', '..x.....x.x.....'],
                taikoS: ['..o...o...o...o.'],
                tomL: ['................', '................', '................', '............xxXX'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'D', style: 'horn', stabs: ['x..x..x.x.......', '................'] },
            mix: [[1, 1, 0, 0.9, 0.7, 0], [1, 1, 0.4, 1, 0.8, 0], [1, 1, 0.6, 1, 0.9, 0], [1, 1, 0.6, 1, 1, 0.2], [0.95, 1, 0.5, 1, 1, 0.5], [0.9, 1, 0.4, 1, 1, 0.8], [0.9, 1, 0.3, 1, 1, 1]],
        },
        // ===== METRO: оркестрово-электронный экшен, A минор, 128 уд/мин, 16 тактов =====
        metro: {
            bpm: 128, bars: 16, swing: 0, revSec: 1.8,
            prog: [['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj'], ['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj'],
                ['F', 'maj'], ['G', 'maj'], ['A', 'min'], ['A', 'min'], ['A', 'min'], ['F', 'maj'], ['G', 'maj'], ['E', 'd7']],
            pads: [{ voice: 'strings', hits: ['0:16'], oct: 3, ext: [], send: 0.3 }],
            arp: { voice: 'pluck', oct: 4, send: 0.2, vel: 0.5, pat: '0:1 2:1 3:1 2:1 1:1 2:1 3:1 2:1 0:1 2:1 3:1 2:1 1:1 2:1 4:1 2:1' },
            bass: { voice: 'sawBass', oct: 2, pats: ['0:2 0:2 12:2 0:2 0:2 0:2 12:2 7:2', '0:2 0:2 12:2 0:2 0:2 0:2 12:2 7:2', '0:2 0:2 12:2 0:2 0:2 0:2 12:2 7:2', '0:2 0:2 12:2 0:2 0:2 7:2 5:2 3:2'] },
            lead: {
                voice: 'synthLead', send: 0.2, double: { voice: 'brass', shift: -12, vel: 0.6 },
                bars: [
                    'A4:2 r:1 A4:1 C5:2 A4:2 E5:4 r:1 D5:1 C5:2', 'A4:2 r:1 A4:1 C5:2 A4:2 F5:4 r:1 E5:1 C5:2',
                    'G4:2 r:1 G4:1 C5:2 G4:2 E5:4 r:1 D5:1 C5:2', 'B4:2 r:1 B4:1 D5:2 B4:2 G5:4 F5:2 D5:2',
                    'A4:2 r:1 A4:1 C5:2 A4:2 E5:4 r:1 D5:1 C5:2', 'A4:2 r:1 A4:1 C5:2 A4:2 F5:4 r:1 E5:1 C5:2',
                    'G4:2 r:1 G4:1 C5:2 G4:2 E5:4 r:1 D5:1 C5:2', 'D5:4 B4:4 G4:4 D5:2 B4:2',
                    'C5:6 D5:2 E5:4 F5:4', 'D5:6 E5:2 G5:4 B5:4', 'A5:6 G5:2 E5:4 C5:4', 'E5:8 r:2 E5:2 G5:2 A5:2',
                    'A5:4 r:2 G5:2 E5:4 C5:4', 'A5:4 r:2 G5:2 F5:4 C5:4', 'B5:4 r:2 A5:2 G5:4 D5:4', 'E5:2 r:2 G#4:2 B4:2 E5:4 D5:2 B4:2'],
            },
            dL: { kick: ['X...X...X...X...'], hat: ['..x...x...x...x.'], shaker: ['o.o.o.o.o.o.o.o.'] },
            dH: {
                kick: ['X...X...X...X...'], snare: ['....X.......X...'], clap: ['....x.......x...'], hat: ['xoxoxoxoxoxoxoxo'],
                taiko: ['X.......X.....x.'], tomM: ['................', '................', '................', '............xxxX'],
                snr: ['................', '................', '................', '........xxxxxxXX'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'A', style: 'siren', stabs: ['x..x..x.x..x..x.', '................'] },
        },
        // ===== HARBOR: сёрф-фанк на закате, E дорийский/блюзовый, 116 уд/мин, 16 тактов, свинг =====
        harbor: {
            bpm: 116, bars: 16, swing: 0.1, revSec: 1.6,
            prog: [['E', 'm7'], ['A', 'd7'], ['C', 'M7'], ['B', 'd7'], ['E', 'm7'], ['A', 'd7'], ['C', 'M7'], ['B', 'd7'],
                ['A', 'm7'], ['D', 'd7'], ['G', 'M7'], ['C', 'M7'], ['A', 'm7'], ['B', 'd7'], ['E', 'm7'], ['B', 'd7']],
            pads: [{ voice: 'warm', hits: ['0:16'], oct: 3, ext: [], send: 0.35, vel: 0.7 }, { voice: 'rhodes', hits: ['3:2 6:1 10:2 13:2', '3:2 6:1 10:2 12:1 14:2'], oct: 4, ext: [], send: 0.25 }],
            bass: { voice: 'slap', oct: 2, pats: ['0:3 r:1 0:2 12:2 r:2 7:2 5:2 r:2', '0:3 r:1 0:2 12:2 r:2 10:2 7:2 r:2'] },
            lead: {
                voice: 'twang', send: 0.35,
                bars: [
                    'E5:2 G5:2 B5:2 G5:2 E5:2 G5:2 A5:2 G5:2', 'A4:2 C#5:2 E5:2 G5:2 E5:4 C#5:4', 'G5:4 E5:2 G5:2 B5:4 G5:4', 'F#5:2 A5:2 D#5:2 F#5:2 B4:8',
                    'E5:2 G5:2 B5:2 G5:2 E5:2 G5:2 A5:2 G5:2', 'A4:2 C#5:2 E5:2 G5:2 E5:4 C#5:4', 'E5:2 G5:2 B5:2 C6:2 B5:4 G5:4', 'D#5:2 F#5:2 A5:2 F#5:2 D#5:2 B4:2 D#5:4',
                    'C5:3 E5:1 A5:4 G5:2 E5:2 C5:4', 'D5:3 F#5:1 A5:4 C6:2 A5:2 F#5:4', 'B4:3 D5:1 G5:4 F#5:2 D5:2 B4:4', 'E5:6 G5:2 B5:4 G5:2 E5:2',
                    'A5:2 G5:2 E5:2 C5:2 E5:2 G5:2 A5:4', 'B5:2 A5:2 F#5:2 D#5:2 F#5:4 A5:4', 'G5:2 E5:2 B4:2 E5:2 G5:4 B5:4', 'A5:2 F#5:2 D#5:2 A5:2 B5:8'],
            },
            dL: {
                kick: ['X.......o.X.....', 'X.....o...X.....'], snare: ['....X.......X...'], hat: ['xoxoxoxoxoxoxoxo'], ohat: ['..............o.'],
            },
            dH: {
                kick: ['X.......o.X.....', 'X.....o...X.....'], snare: ['....X.......X...'], clap: ['....x.......x...'], hat: ['xoxoxoxoxoxoxoxo'],
                conga: ['o.x..x.o..x.x...', '..x.ox..o.x..x.o'], cowbell: ['x...x...x...x...'],
                tomM: ['................', '................', '................', '............xxxX'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'E', style: 'siren', stabs: ['x..x..x.x..x..x.', '................'] },
        },
        // ===== TOKYO: синтвейв / сити-поп, C пентатоника (Fmaj7-G7-Em7-Am7), 120 уд/мин, 16 тактов + тайко =====
        tokyo: {
            bpm: 120, bars: 16, swing: 0, revSec: 2.0,
            prog: [['F', 'M7'], ['G', 'd7'], ['E', 'm7'], ['A', 'm7'], ['F', 'M7'], ['G', 'd7'], ['E', 'm7'], ['A', 'm7'],
                ['D', 'm7'], ['G', 'd7'], ['C', 'M7'], ['A', 'm7'], ['F', 'M7'], ['G', 'd7'], ['E', 'm7'], ['A', 'm7']],
            pads: [{ voice: 'synthpad', hits: ['0:16'], oct: 3, ext: [], send: 0.35 }],
            arp: { voice: 'pluck', oct: 4, send: 0.3, vel: 0.45, pat: '0:2 2:2 3:2 4:2 3:2 2:2 3:2 1:2' },
            bass: { voice: 'sawBass', oct: 2, pats: ['0:2 r:2 0:2 12:2 0:2 r:2 7:2 5:2'] },
            lead: {
                voice: 'synthLead', send: 0.3, double: { voice: 'rhodes', shift: 12, vel: 0.35 },
                bars: [
                    'A5:3 r:1 G5:2 E5:2 G5:4 A5:4', 'G5:3 r:1 E5:2 D5:2 E5:4 G5:4', 'E5:2 G5:2 A5:4 G5:2 E5:2 D5:4', 'C5:4 D5:2 E5:2 A5:8',
                    'A5:3 r:1 G5:2 E5:2 G5:4 C6:4', 'D6:3 r:1 C6:2 A5:2 G5:4 E5:4', 'E5:2 G5:2 A5:2 C6:2 D6:4 C6:2 A5:2', 'E6:4 D6:2 C6:2 A5:8',
                    'F5:3 r:1 A5:2 C6:2 D6:4 C6:4', 'B5:2 D6:2 G6:4 F6:2 D6:2 B5:4', 'C6:3 r:1 B5:2 G5:2 E5:4 G5:4', 'A5:4 C6:4 E6:8',
                    'C6:3 r:1 A5:2 F5:2 A5:4 C6:4', 'D6:3 r:1 B5:2 G5:2 B5:4 D6:4', 'G5:2 B5:2 E6:4 D6:2 B5:2 G5:4', 'A5:6 G5:2 E5:4 r:4'],
            },
            dL: { kick: ['X...X...X...X...'], hat: ['x.x.x.x.x.x.x.x.'], rim: ['................', '................', '................', '..............x.'] },
            dH: {
                kick: ['X...X...X...X...'], snare: ['....X.......X...'], clap: ['....x.......x...'], hat: ['xoxoxoxoxoxoxoxo'],
                taiko: ['X.....x...X.....'], taikoM: ['..x.......x.x...'],
                tomH: ['................', '................', '................', '........xxxxXXXX'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'A', style: 'siren', stabs: ['x..x..x.x..x..x.', '................'] },
        },
        // ===== DESERT: фригийский доминантовый (D Eb F# G A Bb C), перкуссия, 116 уд/мин, 16 тактов =====
        desert: {
            bpm: 116, bars: 16, swing: 0, revSec: 1.6,
            prog: [['D', 'maj'], ['Eb', 'maj'], ['D', 'maj'], ['C', 'maj'], ['D', 'maj'], ['Eb', 'maj'], ['D', 'maj'], ['A', 'maj'],
                ['G', 'min'], ['D', 'maj'], ['G', 'min'], ['A', 'maj'], ['D', 'maj'], ['Eb', 'maj'], ['C', 'maj'], ['A', 'maj']],
            pads: [{ voice: 'strings', hits: ['0:16'], oct: 3, ext: [], send: 0.3, vel: 0.8 }],
            arp: { voice: 'oud', oct: 4, send: 0.2, vel: 0.5, pat: '0:2 2:1 1:1 2:2 3:2 2:2 1:2 4:2 2:2' },
            bass: { voice: 'oud', oct: 2, pats: ['0:3 r:1 0:2 0:2 7:2 5:2 0:4', '0:3 r:1 0:2 1:2 0:2 7:2 0:4'] },
            lead: {
                voice: 'reed', send: 0.2,
                bars: [
                    'D5:3 Eb5:1 D5:2 C5:2 Bb4:2 A4:2 G4:2 F#4:2', 'Eb5:4 D5:2 Eb5:2 F#5:4 Eb5:2 D5:2', 'D5:3 Eb5:1 F#5:2 G5:2 A5:4 G5:2 F#5:2', 'Eb5:2 D5:2 C5:4 Bb4:2 A4:2 D4:4',
                    'A4:2 Bb4:2 A4:2 G4:2 F#4:2 G4:2 A4:4', 'Bb4:4 Eb5:4 D5:2 Eb5:2 F#5:4', 'A5:4 G5:2 F#5:2 Eb5:2 D5:2 Eb5:2 F#5:2', 'A4:2 C#5:2 E5:4 D5:2 C#5:2 A4:4',
                    'G4:3 A4:1 Bb4:2 D5:2 G5:4 F#5:2 G5:2', 'F#5:4 G5:2 A5:2 Bb5:4 A5:2 G5:2', 'G5:3 F#5:1 Eb5:2 D5:2 Bb4:4 A4:4', 'E5:8 D5:2 C#5:2 A4:4',
                    'D5:3 Eb5:1 F#5:2 G5:2 A5:2 Bb5:2 A5:2 G5:2', 'Bb5:4 A5:2 G5:2 F#5:4 Eb5:4', 'G5:2 Eb5:2 C5:4 D5:2 Eb5:2 D5:4', 'C#5:2 E5:2 A5:4 G5:2 F#5:2 Eb5:4'],
            },
            dL: {
                dum: ['X.......X.......', 'X.......X...x...'], tek: ['..x...x.....x...'], shaker: ['xoxoxoxoxoxoxoxo'],
            },
            dH: {
                dum: ['X.......X.......', 'X.......X...x...'], tek: ['..x...x.....x...'], taiko: ['X.....x...X.x...'], clap: ['....x.......x...'],
                ka: ['..x...o...x...o.'], conga: ['o...x.o.o...x...'],
                tomM: ['................', '................', '................', '........xxxxxxXX'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'D', style: 'horn', stabs: ['x..x..x.x..x..x.', '................'] },
        },
        // ===== ARCTIC: холод, военный марш на малом барабане, B минор, 112 уд/мин, 16 тактов =====
        arctic: {
            bpm: 112, bars: 16, swing: 0, revSec: 2.8,
            prog: [['B', 'min'], ['G', 'M7'], ['D', 'maj'], ['F#', 'min'], ['B', 'min'], ['G', 'M7'], ['A', 'maj'], ['F#', 'maj'],
                ['E', 'min'], ['B', 'min'], ['E', 'min'], ['F#', 'maj'], ['B', 'min'], ['G', 'M7'], ['D', 'maj'], ['F#', 'maj']],
            pads: [{ voice: 'icy', hits: ['0:16'], oct: 3, ext: [14], send: 0.45 }],
            air: { f: 700, gain: 0.5 },
            bass: { voice: 'sub', oct: 2, pats: ['0:6 r:2 0:4 r:2 7:2'] },
            lead: {
                voice: 'bell', send: 0.5,
                bars: [
                    'F#5:6 E5:2 D5:4 B4:4', 'B4:4 D5:4 F#5:8', 'A5:6 F#5:2 D5:4 A4:4', 'C#5:4 E5:4 F#5:4 A4:4',
                    'D5:4 F#5:4 B5:8', 'D5:3 r:1 B4:4 G5:8', 'E5:4 A5:4 C#5:4 E5:4', 'A#4:4 C#5:4 F#5:4 A#5:4',
                    'G5:6 F#5:2 E5:4 B4:4', 'D5:4 F#5:4 D5:4 B4:4', 'B5:6 A5:2 G5:4 E5:4', 'C#5:4 A#4:4 F#5:8',
                    'F#5:6 E5:2 D5:4 B4:4', 'B4:4 D5:4 F#5:4 D5:4', 'A5:6 F#5:2 D5:4 A5:4', 'C#6:4 A#5:4 F#5:8'],
            },
            dL: { kick: ['X.......X.......'], rim: ['..o...o.....o.o.'], shaker: ['xoxoxoxoxoxoxoxo'] },
            dH: {
                snr: ['X.xxX.xxX.xxX.xx', 'X.xxX.xxX.xxX.xx', 'X.xxX.xxX.xxX.xx', 'X.xxX.xxXxXxXxXx'],
                kick: ['X.......X.....x.'], taiko: ['X...............', '........X.......'],
                crash: ['X...............', '................', '................', '................'],
            },
            tension: { root: 'B', style: 'horn', stabs: ['x..x..x.x..x..x.', '................'] },
        },
    };

    // Микс стемов по звёздам (pad, bass, drumsL, drumsH, lead, tension); у темы можно задать свой (menu).
    const MIX_DEFAULT = [
        [1.0, 0.75, 0, 0, 0, 0],
        [1.0, 0.95, 0.85, 0, 0, 0],
        [1.0, 1.0, 1.0, 0, 0.85, 0],
        [0.95, 1.0, 0.75, 0.75, 1.0, 0],
        [0.9, 1.0, 0.5, 1.0, 1.0, 0],
        [0.85, 1.0, 0.35, 1.0, 1.0, 0.55],
        [0.8, 1.0, 0.3, 1.0, 1.0, 1.0],
    ];

    /** Целевые громкости 6 стемов для интенсивности n (0..6, дробная — линейно между рядами). */
    function mix(track, n) {
        const rows = (TRACKS[track] && TRACKS[track].mix) || MIX_DEFAULT;
        const x = Math.max(0, Math.min(6, Number(n) || 0)), i = Math.floor(x), f = x - i;
        const a = rows[i], b = rows[Math.min(6, i + 1)];
        return a.map((v, k) => v + (b[k] - v) * f);
    }

    // ---------- Рендер стемов ----------
    function makeIR(oc, secs, rnd) {
        const rate = oc.sampleRate, n = Math.floor(secs * rate), b = oc.createBuffer(1, n, rate), d = b.getChannelData(0);
        let lp = 0;
        const pre = Math.floor(0.012 * rate);
        for (let i = pre; i < n; i++) {
            const u = (i - pre) / (n - pre);
            const x = (rnd() * 2 - 1) * Math.pow(1 - u, 2.6);
            lp += (x - lp) * (0.62 - 0.5 * u);
            d[i] = lp;
        }
        return b;
    }

    /** Контекст рендера одного стема: шины dry/wet, шум, сетка времени. */
    function makeS(oc, cfg, seed, rev, comp) {
        const rate = oc.sampleRate;
        const S = { oc, cfg, sd: 60 / cfg.bpm / 4, rnd: rng(seed), dry: oc.createGain(), wet: oc.createGain(), hasRev: false, noise: null, tm: null };
        const master = oc.createGain();
        master.gain.value = 1;
        S.dry.connect(master);
        if (rev && cfg.revSec) {
            const conv = oc.createConvolver();
            conv.buffer = makeIR(oc, cfg.revSec, rng(seed ^ 0x9e3779b9));
            S.wet.connect(conv); conv.connect(master);
            S.hasRev = true;
        }
        // мягкий ограничитель (tanh): пики не уходят за 1 даже до нормировки
        const sh = oc.createWaveShaper();
        const curve = new Float32Array(2048);
        for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1); }
        sh.curve = curve;
        if (comp) {   // ударные: компрессор поднимает среднюю громкость стема при том же пике
            const c = oc.createDynamicsCompressor();
            c.threshold.value = -22; c.knee.value = 8; c.ratio.value = 5; c.attack.value = 0.002; c.release.value = 0.09;
            master.connect(c); c.connect(sh);
        } else master.connect(sh);
        sh.connect(oc.destination);
        const nb = oc.createBuffer(1, rate * 2, rate), nd = nb.getChannelData(0), nr = rng(seed ^ 0x51ed270b);
        for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;
        S.noise = nb;
        S.tm = (bar, step) => (bar * 16 + step) * S.sd + ((step & 1) ? cfg.swing * S.sd : 0);
        return S;
    }

    const cyc = (arr, i) => Array.isArray(arr) ? arr[i % arr.length] : arr;
    function chordAt(cfg, bar) {
        const c = cfg.prog[bar % cfg.prog.length];
        return { pc: pcOf(c[0]), ints: CHORD[c[1]] };
    }

    function buildPad(S, b) {
        const cfg = S.cfg, bl = 16 * S.sd;
        {
            const ch = chordAt(cfg, b);
            for (const layer of cfg.pads) {
                const root = 12 * (layer.oct + 1) + ch.pc;
                const tones = ch.ints.concat(layer.ext || []).map(i => root + i);
                for (const tok of parseSeq(cyc(layer.hits, b))) {
                    const t = S.tm(b, tok.step), dur = tok.len * S.sd + (tok.len >= 16 ? 0.3 : 0);
                    for (const m of tones) note(S, V[layer.voice], t, dur, mtof(m), layer.vel || 1, layer.send);
                }
            }
            if (cfg.arp) {
                const root = 12 * (cfg.arp.oct + 1) + ch.pc, i3 = ch.ints[1], i5 = ch.ints[2];
                const tones = [root, root + i3, root + i5, root + 12, root + i3 + 12, root + i5 + 12];
                for (const tok of parseSeq(cfg.arp.pat)) note(S, V[cfg.arp.voice], S.tm(b, tok.step), tok.len * S.sd * 0.9, mtof(tones[tok.n]), (cfg.arp.vel || 0.5) * (0.85 + 0.15 * S.rnd()), cfg.arp.send);
            }
            if (cfg.air && b % 2 === 0) {   // ветер: шум в полосе, раздувается на 2 такта
                const t = S.tm(b, 0), d = 2 * bl, oc = S.oc;
                const src = oc.createBufferSource(), f = oc.createBiquadFilter(), g = oc.createGain();
                src.buffer = S.noise; src.loop = true; src.start(t, S.rnd());
                f.type = 'bandpass'; f.Q.value = 1.4;
                f.frequency.setValueAtTime(cfg.air.f * 0.8, t); f.frequency.linearRampToValueAtTime(cfg.air.f * 1.3, t + d);
                g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14 * cfg.air.gain, t + d * 0.5);
                g.gain.linearRampToValueAtTime(0.0001, t + d + 0.5);
                src.connect(f); f.connect(g); src.stop(t + d + 0.6);
                sink(S, g, 0.3);
            }
        }
    }

    function buildBass(S, b) {
        const cfg = S.cfg, bs = cfg.bass;
        {
            const root = 12 * (bs.oct + 1) + chordAt(cfg, b).pc;
            for (const tok of parseSeq(cyc(bs.pats, b))) {
                note(S, V[bs.voice], S.tm(b, tok.step), tok.len * S.sd * 0.92, mtof(root + tok.n), (tok.step % 4 === 0 ? 1 : 0.8) * (0.92 + 0.08 * S.rnd()), bs.send || 0);
            }
        }
    }

    function buildLead(S, b) {
        const cfg = S.cfg, ld = cfg.lead;
        {
            for (const tok of parseSeq(cyc(ld.bars, b))) {
                const t = S.tm(b, tok.step), dur = tok.len * S.sd * 0.94, vel = tok.step % 4 === 0 ? 1 : 0.82;
                const f = mtof(tok.n);
                if (ld.voice === 'bell') bell(S, t, dur, f, vel, ld.send);
                else note(S, V[ld.voice], t, dur, f, vel, ld.send);
                if (ld.double) {
                    const dv = ld.double.voice;
                    if (dv === 'bell') bell(S, t, dur, mtof(tok.n + ld.double.shift), vel * ld.double.vel, ld.send);
                    else note(S, V[dv], t, dur, mtof(tok.n + ld.double.shift), vel * ld.double.vel, ld.send);
                }
            }
        }
    }

    function buildDrums(S, kit, b) {
        const cfg = S.cfg;
        {
            for (const inst of Object.keys(kit)) {
                const pat = String(cyc(kit[inst], b));
                for (let st = 0; st < 16; st++) {
                    const v = VEL[pat[st]];
                    if (v) DRUM[inst](S, S.tm(b, st), v * (0.9 + 0.1 * S.rnd()));
                }
            }
        }
    }

    function buildTension(S, b) {
        const cfg = S.cfg, T = cfg.tension, bl = 16 * S.sd, oc = S.oc;
        const rootM = 36 + pcOf(T.root);
        if (b % 2 === 0) {
            const t = S.tm(b, 0);
            note(S, V.droneSaw, t, 2 * bl + 0.3, mtof(rootM), 1, 0.2);
            note(S, V.droneSaw, t, 2 * bl + 0.3, mtof(rootM + 6), 0.55, 0.2);
            note(S, V.droneSaw, t, 2 * bl + 0.3, mtof(rootM + 13), 0.3, 0.3);
        }
        if (b % 4 === 3) {         // райзер в последнем такте четвёрки и удар на следующем
            const t = S.tm(b, 0);
            const src = oc.createBufferSource(), f = oc.createBiquadFilter(), g = oc.createGain();
            src.buffer = S.noise; src.loop = true; src.start(t, S.rnd());
            f.type = 'bandpass'; f.Q.value = 2.5;
            f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + bl);
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + bl); g.gain.setValueAtTime(0, t + bl + 0.001);
            src.connect(f); f.connect(g); src.stop(t + bl + 0.01);
            sink(S, g, 0.25);
            const o = oc.createOscillator(), og = oc.createGain();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(mtof(rootM + 24), t); o.frequency.exponentialRampToValueAtTime(mtof(rootM + 36), t + bl);
            og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.16, t + bl); og.gain.setValueAtTime(0, t + bl + 0.001);
            const of = oc.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 2200;
            o.connect(of); of.connect(og); o.start(t); o.stop(t + bl + 0.01);
            sink(S, og, 0.2);
            const t2 = S.tm(b + 1, 0);
            DRUM.taiko(S, t2, 1); DRUM.crash(S, t2, 0.8);
        }
        {
            const pat = String(cyc(T.stabs, b));
            for (let st = 0; st < 16; st++) {
                const v = VEL[pat[st]];
                if (!v) continue;
                const t = S.tm(b, st);
                note(S, V.stab, t, S.sd * 1.4, mtof(rootM + 12 + (st % 4 === 3 ? 1 : 0)), v, 0.2);
                note(S, V.stab, t, S.sd * 1.4, mtof(rootM + 18), v * 0.7, 0.2);
            }
            if (T.style === 'siren' && b % 2 === 1) {                       // тревога: чередующиеся тоны восьмыми
                for (let st = 0; st < 16; st += 2) note(S, V.alarm, S.tm(b, st), S.sd * 1.7, mtof(rootM + 36 + (st % 4 === 0 ? 0 : -5)), 0.8, 0.15);
            }
            if (T.style === 'horn' && b % 4 === 0) {                        // боевой горн: долгая нота, раздувается
                note(S, V.brass, S.tm(b, 0), 3 * bl, mtof(rootM + 12), 0.9, 0.4);
                note(S, V.brass, S.tm(b, 0), 3 * bl, mtof(rootM + 19), 0.6, 0.4);
            }
        }
    }

    function renderCtx(oc) {
        return new Promise((resolve, reject) => {
            const p = oc.startRendering();
            if (p && typeof p.then === 'function') p.then(resolve, reject);
            else { oc.oncomplete = (e) => resolve(e.renderedBuffer); }
        });
    }

    /**
     * Рендер темы: массив стемов { name, rate, data: Float32Array } одной длительности (loopSec).
     * yieldFn вызывается между стемами (отдать поток вкладке). Все стемы нормируются так, что сумма пиков ≤ 0.92.
     */
    async function renderTrack(track, yieldFn) {
        const cfg = TRACKS[track];
        if (!cfg) throw new Error('unknown track ' + track);
        const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : /** @type {any} */ (globalThis).webkitOfflineAudioContext;
        if (!OAC) throw new Error('no OfflineAudioContext');
        const loopSamples = Math.round((cfg.bars * 4 * 60 / cfg.bpm) * BASE_SR / 2) * 2;   // чётное число: 16000-й стем ровно вдвое короче
        const loopSec = loopSamples / BASE_SR;
        const builders = [buildPad, buildBass, (S, b) => buildDrums(S, cfg.dL, b), (S, b) => buildDrums(S, cfg.dH, b), buildLead, buildTension];
        const wantsRev = [true, false, true, true, true, true], wantsComp = [false, false, true, true, false, false];
        const stems = [], timing = [];
        for (let k = 0; k < 6; k++) {
            const rate = STEM_RATE[k], n = Math.round(loopSec * rate);
            const oc = new OAC(1, n + Math.round(TAIL * rate), rate);
            const tb = Date.now();
            const S = makeS(oc, cfg, hash(track) + k * 7919, wantsRev[k], wantsComp[k]);
            // Ноты ставим по тактам прямо во время рендера (suspend/resume): в графе всегда лишь пара тактов,
            // иначе Chrome тратит время на тысячи ещё не стартовавших узлов.
            const tSus = (b) => Math.max(0.01, S.tm(b, 0) - 0.3);
            const lazy = typeof oc.suspend === 'function' && typeof oc.resume === 'function' && cfg.bars > 2;
            let next = lazy ? 2 : cfg.bars;
            for (let b = 0; b < next; b++) builders[k](S, b);
            let susp = next < cfg.bars ? oc.suspend(tSus(next)) : null;
            const tr = Date.now();
            const rendering = renderCtx(oc);
            while (susp) {
                await susp;
                builders[k](S, next++);
                susp = next < cfg.bars ? oc.suspend(tSus(next)) : null;
                oc.resume();
            }
            const rendered = await rendering;
            timing.push([STEM_NAMES[k], tr - tb, Date.now() - tr]);
            const src = rendered.getChannelData(0);
            const out = new Float32Array(n);
            out.set(src.subarray(0, n));
            for (let i = 0; i < src.length - n && i < n; i++) out[i] += src[n + i];   // хвост -> в начало: цикл без щелчка
            // нормировка стема по пику
            let pk = 0;
            for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
            const sc = pk > 1e-6 ? STEM_PEAK[k] / pk : 0;
            for (let i = 0; i < n; i++) out[i] *= sc;
            stems.push({ name: STEM_NAMES[k], rate, data: out });
            if (yieldFn) await yieldFn();
        }
        // общая нормировка: сумма всех стемов (все слои включены) не выше 0.92
        const n32 = loopSamples;
        let mixPk = 0;
        for (let i = 0; i < n32; i++) {
            const h = i >> 1;
            const s = stems[0].data[h] + stems[1].data[h] + stems[2].data[i] + stems[3].data[i] + stems[4].data[i] + stems[5].data[i];
            const a = Math.abs(s);
            if (a > mixPk) mixPk = a;
        }
        const g = mixPk > 0.92 ? 0.92 / mixPk : 1;
        if (g !== 1) for (const st of stems) for (let i = 0; i < st.data.length; i++) st.data[i] *= g;
        return { track, loopSec, stems, timing, mixGain: g };
    }

    // ---------- Синтез звуков (чистый JS, 32 кГц моно) ----------
    const SR = 32000, TAU = Math.PI * 2;
    const alloc = (sec) => new Float32Array(Math.round(sec * SR));
    /** Фильтр с переменным состоянием (Chamberlin): run(x, fc, q) -> поля lo / bp / hp. */
    function svf() {
        return {
            lo: 0, bp: 0, hp: 0,
            run(x, fc, q) {
                const w = Math.PI * Math.min(fc, 0.16 * SR) / SR, w2 = w * w, f = 2 * w * (1 - w2 / 6 * (1 - w2 / 20));   // 2·sin(x) полиномом: дёшево на каждый отсчёт
                this.hp = x - this.lo - this.bp / q;
                this.bp += f * this.hp;
                this.lo += f * this.bp;
                return this;
            },
        };
    }
    function normalize(a, peak) {
        let pk = 0;
        for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; }
        if (pk > 1e-9) { const g = peak / pk; for (let i = 0; i < a.length; i++) a[i] *= g; }
        return a;
    }
    /** Концы цикла сшиваются: raw длиной n + x -> n отсчётов без щелчка на стыке. */
    function loopify(raw, n) {
        const x = raw.length - n, out = raw.slice(0, n);
        for (let i = 0; i < x; i++) { const w = i / x; out[i] = raw[i] * Math.sin(w * Math.PI / 2) + raw[n + i] * Math.cos(w * Math.PI / 2); }
        return out;
    }
    function fadeEdges(a, fi, fo) {
        const n = a.length, i1 = Math.round(fi * SR), i2 = Math.round(fo * SR);
        for (let i = 0; i < i1 && i < n; i++) a[i] *= i / i1;
        for (let i = 0; i < i2 && i < n; i++) a[n - 1 - i] *= i / i2;
        return a;
    }
    /** Ограниченный saw / square (аддитивно, без алиасинга) для нот-эффектов. */
    function bl(ph, f, kind) {
        const h = Math.max(1, Math.min(14, Math.floor(10000 / f)));
        let s = 0;
        if (kind === 'sq') for (let k = 1; k <= h; k += 2) s += Math.sin(ph * k) / k;
        else for (let k = 1; k <= h; k++) s += Math.sin(ph * k) / k;
        return s * (kind === 'sq' ? 1.2 : 0.65);
    }
    /** Нота в массив: кусочная огибающая атака/затухание, kind: sin | tri | saw | sq | bell. */
    function addNote(out, t, dur, f, amp, kind, o) {
        o = o || {};
        const i0 = Math.round(t * SR), n = Math.round(dur * SR), a = o.a || 0.004, dec = o.dec || dur * 0.4, vib = o.vib || 0;
        const f2 = o.f2 || f;
        let ph = 0, lp = 0;
        for (let i = 0; i < n && i0 + i < out.length; i++) {
            const tt = i / SR;
            const fr = (f + (f2 - f) * Math.min(1, tt / dur)) * (1 + vib * Math.sin(TAU * 5.5 * tt));
            ph += TAU * fr / SR;
            let s;
            if (kind === 'bell') s = Math.sin(ph + 2.2 * Math.exp(-tt * 6) * Math.sin(ph * 3.5)) * 0.9;
            else if (kind === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
            else if (kind === 'saw' || kind === 'sq') { const w = (ph / TAU) % 1; s = kind === 'saw' ? 2 * w - 1 : (w < 0.5 ? 1 : -1); lp += (s - lp) * (o.lp || 0.35); s = lp; }
            else s = Math.sin(ph);
            const env = Math.min(1, tt / a) * Math.exp(-tt / dec) * (tt > dur - 0.02 ? Math.max(0, (dur - tt) / 0.02) : 1);
            out[i0 + i] += s * env * amp;
        }
    }
    function echo(a, delay, fb, mixAmt) {
        const d = Math.round(delay * SR), out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = a[i] + (i >= d ? out[i - d] * fb * mixAmt : 0);
        return out;
    }

    const SYN = {};
    for (let v = 0; v < 4; v++) {
        SYN['step-' + v] = () => {
            const o = alloc(0.5), r = rng(100 + v), lp = svf(), lp2 = svf();
            const f0 = [88, 78, 94, 72][v], f1 = [38, 34, 40, 32][v];
            let ph = 0;
            for (let i = 0; i < o.length; i++) {
                const t = i / SR, fr = f1 + (f0 - f1) * Math.exp(-t / 0.045);
                ph += TAU * fr / SR;
                const thump = Math.sin(ph) * Math.exp(-t / 0.13);
                const n = r() * 2 - 1;
                const crunch = lp.run(n, 380, 0.9).lo * Math.exp(-t / 0.07) * 1.3;
                const grit = lp2.run(n, 1800, 1.2).bp * Math.exp(-t / 0.018) * 0.5;
                o[i] = Math.tanh((thump * 1.4 + crunch + grit) * 1.2);
            }
            return fadeEdges(normalize(o, 0.85), 0.001, 0.02);
        };
    }
    for (let v = 0; v < 2; v++) {
        SYN['thud-s' + v] = () => {
            const o = alloc(0.6), r = rng(300 + v), lp = svf();
            let ph = 0;
            for (let i = 0; i < o.length; i++) {
                const t = i / SR, fr = 45 + (110 + v * 15) * Math.exp(-t / 0.05);
                ph += TAU * fr / SR;
                o[i] = Math.tanh(Math.sin(ph) * Math.exp(-t / 0.18) * 1.6 + lp.run(r() * 2 - 1, 700, 0.8).lo * Math.exp(-t / 0.08));
            }
            return fadeEdges(normalize(o, 0.85), 0.001, 0.03);
        };
    }
    function synthRoar(big, seed) {
        const dur = big ? 2.2 : 1.5, o = alloc(dur), r = rng(seed), nV = big ? 8 : 5;
        const ph = new Float32Array(nV), det = [];
        for (let v = 0; v < nV; v++) det.push(1 + (v - (nV - 1) / 2) * 0.013 + (r() - 0.5) * 0.008);
        const f1 = svf(), f2 = svf(), f3 = svf(), lo = svf();
        let sub = 0;
        const base0 = big ? 58 : 88;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, u = t / dur;
            const up = Math.exp(-Math.pow((u - 0.14) / 0.14, 2));
            const pitch = base0 * (1 + 0.55 * up) * (1 - 0.42 * u) * (1 + 0.035 * Math.sin(TAU * 23 * t));
            const am = 0.62 + 0.38 * Math.sin(TAU * (big ? 17 : 26) * t + 2 * Math.sin(TAU * 3 * t));
            let s = 0;
            for (let v = 0; v < nV; v++) { ph[v] += pitch * det[v] / SR; if (ph[v] >= 1) ph[v] -= 1; s += 2 * ph[v] - 1; }
            s = s / nV * 1.6 + (r() * 2 - 1) * 0.55 * (0.4 + 0.6 * am);
            const vow = Math.min(1, u * 1.25);
            f1.run(s, 720 - 330 * vow, 5);
            f2.run(s, 1150 - 420 * vow, 6);
            f3.run(s, 2500 - 500 * vow, 7);
            lo.run(s, 260, 0.8);
            let y = (f1.bp * 0.9 + f2.bp * 0.7 + f3.bp * 0.35 + lo.lo * 1.2) * am;
            sub += TAU * pitch * 0.5 / SR;
            y += Math.sin(sub) * (big ? 0.9 : 0.4) * (1 - u);
            const env = Math.min(1, t / 0.06) * Math.pow(Math.max(0, 1 - u), 0.55);
            o[i] = Math.tanh(y * 0.9 * env * 1.4);
        }
        return fadeEdges(normalize(o, 0.9), 0.003, 0.08);
    }
    SYN.roar = () => synthRoar(false, 901);
    SYN.roar_big = () => synthRoar(true, 902);
    SYN.breath = () => {   // старт дыхания: нарастающий свист + низкий гул
        const o = alloc(1.0), r = rng(77), f = svf(), lo = svf();
        let ph = 0;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, u = t / 1.0, env = Math.pow(Math.min(1, u * 1.2), 1.6) * (u > 0.85 ? (1 - u) / 0.15 : 1);
            const n = r() * 2 - 1;
            const hiss = f.run(n, 500 + 3200 * u, 1.6).bp;
            ph += TAU * (55 + 40 * u) / SR;
            o[i] = (hiss * 0.6 + lo.run(n, 220, 0.8).lo * 0.9 + Math.sin(ph) * 0.5 * (0.5 + 0.5 * Math.sin(TAU * 14 * t))) * env;
        }
        return fadeEdges(normalize(o, 0.85), 0.01, 0.02);
    };
    SYN.beam = () => {     // цикл 2 с: гудящий луч (все синусы — целое число периодов)
        const N = Math.round(2 * SR), rawN = N + 4000, raw = new Float32Array(rawN), r = rng(55), f = svf(), f2 = svf();
        for (let i = 0; i < rawN; i++) { const n = r() * 2 - 1; raw[i] = f.run(n, 1400, 1.2).bp * 0.5 + f2.run(n, 5000, 0.9).hp * 0.12; }
        const nz2 = loopify(raw, N), o = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const t = i / SR;
            const wob = 1 + 0.25 * Math.sin(TAU * 7 * t);
            let s = Math.sin(TAU * 55 * t) * 0.8 + Math.sin(TAU * 110 * t + 1.2 * Math.sin(TAU * 3 * t)) * 0.5 + Math.sin(TAU * 220 * t) * 0.3 + Math.sin(TAU * 440 * t + 3 * Math.sin(TAU * 11 * t)) * 0.12;
            o[i] = Math.tanh((s * wob + nz2[i] * 1.6) * 0.9);
        }
        return normalize(o, 0.8);
    };
    SYN.siren = () => {    // цикл 2.4 с: американское «вау» 600-1350 Гц
        const T = 2.4, N = Math.round(T * SR), o = new Float32Array(N);
        const fr = (t) => 600 + 750 * (0.5 - 0.5 * Math.cos(TAU * t / T));
        let P = 0;
        for (let i = 0; i < N; i++) P += TAU * fr(i / SR) / SR;
        const k = Math.round(P / TAU) / (P / TAU);          // подгоняем частоты под целое число периодов
        let ph = 0;
        for (let i = 0; i < N; i++) {
            ph += TAU * fr(i / SR) * k / SR;
            o[i] = Math.tanh(Math.sin(ph) * 2.4) * 0.8 + Math.sin(ph * 2) * 0.15;
        }
        return normalize(o, 0.6);
    };
    SYN.heli = () => {     // цикл 1 с: 12 ударов винта + турбина
        const N = SR, o = new Float32Array(N), r = rng(31), lp = svf();
        const blades = 12, tmp = new Float32Array(N + 4000), rawT = new Float32Array(N + 4000), fn = svf();
        for (let i = 0; i < rawT.length; i++) rawT[i] = fn.run(r() * 2 - 1, 2600, 2).bp * 0.06;
        const turbine = loopify(rawT, N);
        for (let b = 0; b < blades; b++) {
            const start = Math.round(b / blades * N);
            for (let i = 0; i < 3200; i++) {
                const t = i / SR, nn = lp.run(r() * 2 - 1, 240, 0.9).lo;
                const s = (nn * 1.2 + Math.sin(TAU * 62 * t) * 0.9) * Math.exp(-t / 0.028);
                tmp[(start + i) % N] += s * (b % 2 ? 0.85 : 1);
            }
        }
        for (let i = 0; i < N; i++) { const t = i / SR; o[i] = Math.tanh(tmp[i] * 1.4 + turbine[i] + Math.sin(TAU * 90 * t) * 0.05 * (0.6 + 0.4 * Math.sin(TAU * 12 * t))); }
        return normalize(o, 0.7);
    };
    SYN.fire = () => {     // цикл 2 с: гул и потрескивание
        const N = 2 * SR, rawN = N + 6000, raw = new Float32Array(rawN), r = rng(17), br = svf();
        for (let i = 0; i < rawN; i++) raw[i] = br.run(r() * 2 - 1, 320, 0.7).lo * 0.9 + (r() * 2 - 1) * 0.04;
        const o = loopify(raw, N), rp = rng(18), hp = svf();
        const pops = 46;
        for (let p = 0; p < pops; p++) {
            const st = Math.floor(rp() * N), amp = 0.25 + rp() * 0.75, dec = 0.0015 + rp() * 0.006, fc = 1500 + rp() * 3000;
            for (let i = 0; i < 900; i++) o[(st + i) % N] += hp.run(rp() * 2 - 1, fc, 1.5).bp * Math.exp(-i / SR / dec) * amp * 0.5;
        }
        return normalize(o, 0.6);
    };
    SYN.collapse = () => {
        const dur = 2.8, o = alloc(dur), r = rng(404), br = svf(), rk = svf(), sb = svf();
        const rocks = [];
        for (let i = 0; i < 26; i++) rocks.push({ t: 0.1 + r() * 2.1, a: 0.3 + r() * 0.7, d: 0.05 + r() * 0.22, f: 300 + r() * 900 });
        let ph = 0;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, u = t / dur;
            const env = Math.min(1, t / 0.2) * (u > 0.6 ? Math.pow(1 - (u - 0.6) / 0.4, 1.5) : 1);
            const n = r() * 2 - 1;
            let s = br.run(n, 130 + 90 * Math.sin(TAU * 0.9 * t), 0.7).lo * 2.2;
            ph += TAU * (36 + 8 * Math.sin(TAU * 0.5 * t)) / SR;
            s += Math.sin(ph) * 0.8 + sb.run(n, 55, 1).lo * 1.0;
            let rockAmp = 0;
            for (const k of rocks) { const dt = t - k.t; if (dt > 0 && dt < k.d * 5) rockAmp += Math.exp(-dt / k.d) * k.a; }
            const rock = rockAmp > 0.002 ? rk.run(n, 650 + 500 * Math.sin(TAU * 1.7 * t), 1.2).bp * rockAmp : 0;
            o[i] = Math.tanh((s + rock * 0.8) * env * 1.3);
        }
        return fadeEdges(normalize(o, 0.9), 0.01, 0.1);
    };
    SYN.slam = () => {
        const o = alloc(1.4), r = rng(606), lp = svf(), hp = svf();
        let ph = 0;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, n = r() * 2 - 1;
            ph += TAU * (30 + 120 * Math.exp(-t / 0.09)) / SR;
            const boom = Math.sin(ph) * Math.exp(-t / 0.5) * 1.5;
            const body = lp.run(n, 500, 0.8).lo * Math.exp(-t / 0.22) * 1.6;
            const crack = hp.run(n, 2500, 1).hp * Math.exp(-t / 0.012) * 0.9;
            o[i] = Math.tanh(boom + body + crack);
        }
        return fadeEdges(normalize(o, 0.95), 0.0005, 0.05);
    };
    for (let v = 0; v < 3; v++) {
        SYN['gun-' + v] = () => {
            const o = alloc(0.38), r = rng(700 + v), hp = svf(), bp = svf();
            const shots = [0, 0.062 + v * 0.004, 0.125 + v * 0.003];
            for (const st of shots) {
                const s0 = Math.round(st * SR);
                let ph = 0;
                for (let i = 0; i < 4800 && s0 + i < o.length; i++) {
                    const t = i / SR, n = r() * 2 - 1;
                    ph += TAU * (60 + 220 * Math.exp(-t / 0.012)) / SR;
                    o[s0 + i] += hp.run(n, 900, 0.8).hp * Math.exp(-t / 0.014) * 0.9 + bp.run(n, 1800, 1.2).bp * Math.exp(-t / 0.05) * 0.35 + Math.sin(ph) * Math.exp(-t / 0.03) * 0.8;
                }
            }
            for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * 1.4);
            return fadeEdges(normalize(o, 0.8), 0.0005, 0.03);
        };
    }
    SYN.cannon = () => {
        const o = alloc(1.0), r = rng(808), lp = svf(), bp = svf();
        let ph = 0;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, n = r() * 2 - 1;
            ph += TAU * (36 + 90 * Math.exp(-t / 0.07)) / SR;
            const body = Math.sin(ph) * Math.exp(-t / 0.28) * 1.4;
            const blast = lp.run(n, 1300, 0.8).lo * Math.exp(-t / 0.13) * 1.3;
            const ring = bp.run(n, 2200, 3).bp * Math.exp(-t / 0.35) * 0.18;
            o[i] = Math.tanh(body + blast + ring);
        }
        return fadeEdges(normalize(o, 0.92), 0.0005, 0.05);
    };
    SYN.rocket = () => {
        const o = alloc(1.7), r = rng(909), hp = svf(), lp = svf();
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, n = r() * 2 - 1;
            const env = Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.25) / 0.9);
            const hiss = hp.run(n, 1800 + 1500 * Math.min(1, t), 0.8).hp * 0.7;
            const rum = lp.run(n, 260, 0.8).lo * 1.8;
            o[i] = Math.tanh((hiss + rum) * env * 1.3) + Math.sin(TAU * (90 + 40 * t) * t) * 0.15 * env;
        }
        return fadeEdges(normalize(o, 0.85), 0.003, 0.2);
    };
    SYN.jet = () => {      // пролёт реактивного самолёта с доплеровским сдвигом
        const dur = 2.4, o = alloc(dur), r = rng(1010), bp = svf(), bp2 = svf();
        let ph = 0;
        for (let i = 0; i < o.length; i++) {
            const t = i / SR, u = t / dur, n = r() * 2 - 1;
            const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 2.2);
            const fc = 2600 - 1900 * u;
            ph += TAU * (1500 - 900 * u) / SR;
            o[i] = (bp.run(n, fc, 1.4).bp * 1.1 + bp2.run(n, fc * 0.4, 1.2).bp * 0.9 + Math.sin(ph) * 0.2 + Math.sin(ph * 1.5) * 0.08) * env;
        }
        return fadeEdges(normalize(o, 0.8), 0.02, 0.05);
    };
    for (let v = 0; v < 2; v++) {
        SYN['hurt-' + v] = () => {
            const o = alloc(0.65), r = rng(1100 + v), f1 = svf(), f2 = svf();
            let ph = 0;
            for (let i = 0; i < o.length; i++) {
                const t = i / SR, u = t / 0.65;
                ph += TAU * (150 - 70 * u + v * 20) / SR;
                const src = bl(ph, 140, 'saw') * 0.9 + (r() * 2 - 1) * 0.35;
                const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.22);
                const y = f1.run(src, 560 - 140 * u, 4).bp * 1.1 + f2.run(src, 980 - 220 * u, 5).bp * 0.7 + f1.lo * 0.3;
                o[i] = Math.tanh(y * env * 1.5);
            }
            return fadeEdges(normalize(o, 0.85), 0.002, 0.06);
        };
    }
    SYN.heal = () => {
        const o = alloc(1.1), notes = [72, 76, 79, 84, 88];
        notes.forEach((m, i) => { const f = 440 * Math.pow(2, (m - 69) / 12); addNote(o, i * 0.075, 0.55, f, 0.35, 'tri', { dec: 0.2 }); addNote(o, i * 0.075, 0.5, f * 2, 0.12, 'sin', { dec: 0.15 }); });
        const e = echo(o, 0.12, 0.35, 1);
        return fadeEdges(normalize(e, 0.7), 0.002, 0.15);
    };
    SYN.levelup = () => {
        const o = alloc(1.9), ms = [67, 72, 76, 79, 84];
        ms.forEach((m, i) => { const f = 440 * Math.pow(2, (m - 69) / 12); addNote(o, i * 0.1, 0.7, f, 0.3, 'saw', { dec: 0.35, lp: 0.3 }); addNote(o, i * 0.1, 0.9, f * 2, 0.12, 'bell', { dec: 0.5 }); });
        [67, 72, 76, 84].forEach(m => { const f = 440 * Math.pow(2, (m - 69) / 12); addNote(o, 0.55, 1.3, f, 0.22, 'saw', { dec: 0.7, lp: 0.25 }); });
        const e = echo(o, 0.17, 0.4, 1);
        return fadeEdges(normalize(e, 0.75), 0.002, 0.2);
    };
    SYN.starup = () => {   // тревожный подъём: свип + тритоновый звон
        const o = alloc(1.3);
        addNote(o, 0, 0.45, 300, 0.3, 'saw', { f2: 1200, dec: 0.5, lp: 0.2 });
        addNote(o, 0.38, 0.8, 659, 0.35, 'bell', { dec: 0.45 });
        addNote(o, 0.38, 0.8, 932, 0.3, 'bell', { dec: 0.45 });
        addNote(o, 0.38, 0.6, 110, 0.35, 'sq', { dec: 0.3, lp: 0.15 });
        const e = echo(o, 0.14, 0.3, 1);
        return fadeEdges(normalize(e, 0.8), 0.002, 0.15);
    };
    SYN.reward = () => {
        const o = alloc(1.4), ms = [79, 83, 86, 91, 95, 98];
        ms.forEach((m, i) => { const f = 440 * Math.pow(2, (m - 69) / 12); addNote(o, i * 0.065, 0.8, f, 0.3, 'bell', { dec: 0.35 }); });
        addNote(o, 0.42, 0.9, 784, 0.22, 'tri', { dec: 0.4 }); addNote(o, 0.42, 0.9, 1175, 0.18, 'tri', { dec: 0.4 });
        const e = echo(o, 0.13, 0.35, 1);
        return fadeEdges(normalize(e, 0.7), 0.002, 0.2);
    };
    SYN.victory = () => {
        const o = alloc(3.3), f = (m) => 440 * Math.pow(2, (m - 69) / 12);
        const mel = [[0, 0.16, 60], [0.2, 0.16, 60], [0.4, 0.16, 60], [0.6, 0.7, 67], [1.4, 0.3, 65], [1.75, 0.3, 67], [2.1, 1.0, 72]];
        for (const [t, d, m] of mel) { addNote(o, t, d + 0.1, f(m), 0.3, 'saw', { dec: d * 1.2, lp: 0.28 }); addNote(o, t, d + 0.1, f(m + 12), 0.1, 'sq', { dec: d, lp: 0.2 }); }
        [48, 55, 60, 64, 67].forEach(m => addNote(o, 2.1, 1.2, f(m), 0.18, 'saw', { dec: 0.9, lp: 0.22 }));
        addNote(o, 0, 0.4, f(36), 0.3, 'tri', { dec: 0.4 }); addNote(o, 0.6, 0.8, f(43), 0.3, 'tri', { dec: 0.6 });
        const e = echo(o, 0.2, 0.35, 1);
        return fadeEdges(normalize(e, 0.8), 0.002, 0.3);
    };
    SYN.gameover = () => {
        const o = alloc(2.8), f = (m) => 440 * Math.pow(2, (m - 69) / 12);
        const mel = [[0, 0.5, 67], [0.5, 0.5, 63], [1.0, 0.5, 60], [1.5, 1.2, 55]];
        for (const [t, d, m] of mel) { addNote(o, t, d + 0.3, f(m), 0.3, 'saw', { dec: d * 1.1, lp: 0.15, vib: 0.01 }); addNote(o, t, d + 0.3, f(m - 12), 0.2, 'tri', { dec: d }); }
        addNote(o, 1.5, 1.2, 41, 0.5, 'sin', { f2: 30, dec: 0.8 });
        const e = echo(o, 0.24, 0.4, 1);
        return fadeEdges(normalize(e, 0.8), 0.002, 0.4);
    };
    SYN.alarm = () => {
        const o = alloc(1.0);
        for (let i = 0; i < 6; i++) addNote(o, i * 0.16, 0.14, i % 2 ? 660 : 880, 0.35, 'sq', { dec: 0.2, a: 0.002, lp: 0.25 });
        return fadeEdges(normalize(o, 0.6), 0.001, 0.02);
    };

    return { TRACKS, STEM_NAMES, mix, renderTrack, SYN, parseSeq, seqLen, BASE_SR, SR };
})();

/** @satisfies {Record<string, any>} */
const GameAudio = {
    _makeup: 1.25,                   // запас громкости музыки (микс нормирован на пик 0.92, лимитер движка ловит редкие выбросы)
    _inited: false,
    _polling: false,
    /** @type {Map<string, any>} */
    _prepared: new Map(),            // тема -> { track, loopSec, stems: [{ name, buffer }] }
    /** @type {Map<string, Promise<boolean>>} */
    _jobs: new Map(),
    /** @type {Promise<any>} */
    _queue: Promise.resolve(),
    /** @type {string | null} */
    _want: null,
    /** @type {any} */
    _cur: null,                      // играющая тема: { track, out, gains, sources }
    _intensity: 0,
    /** @type {Map<string, number>} */
    _last: new Map(),                // sfx -> время последнего запуска (мс), для лимита частоты
    /** @type {Set<string>} */
    _synthDone: new Set(),
    _warmed: false,

    // Лимит частоты (мс между запусками одного звука) и состав слоёв. Пути — литералами (сборщик).
    // layer: { u: путь | [пути-варианты] | 'synth:имя' | ['synth:имя', …], v: громкость, r: скорость }
    _sfxDefs: {
        ui_click: { gap: 30, layers: [{ u: 'assets/sounds/ui-click.ogg', v: 0.9 }] },
        ui_open: { gap: 60, layers: [{ u: 'assets/sounds/ui-open.ogg', v: 0.9 }] },
        ui_buy: { gap: 80, layers: [{ u: 'assets/sounds/ui-buy.ogg', v: 0.9 }] },
        ui_equip: { gap: 80, layers: [{ u: 'assets/sounds/ui-equip.ogg', v: 0.9 }] },
        ui_error: { gap: 100, layers: [{ u: 'assets/sounds/ui-error.ogg', v: 0.8 }] },
        coin: { gap: 30, layers: [{ u: ['assets/sounds/coin-a.ogg', 'assets/sounds/coin-b.ogg', 'assets/sounds/coin-c.ogg', 'assets/sounds/coin-d.ogg'], v: 0.7 }] },
        reward: { gap: 200, layers: [{ u: 'synth:reward', v: 0.85 }] },
        star_up: { gap: 300, layers: [{ u: 'synth:starup', v: 0.9 }] },
        level_up: { gap: 300, layers: [{ u: 'synth:levelup', v: 0.9 }] },
        roar: { gap: 400, layers: [{ u: 'synth:roar', v: 1 }] },
        roar_big: { gap: 600, layers: [{ u: 'synth:roar_big', v: 1 }] },
        step: {
            gap: 90, layers: [
                { u: ['synth:step-0', 'synth:step-1', 'synth:step-2', 'synth:step-3'], v: 1 },
                { u: ['assets/sounds/thud-0.ogg', 'assets/sounds/thud-1.ogg'], v: 0.45, r: 0.55 },
            ],
        },
        swipe: { gap: 80, layers: [{ u: ['assets/sounds/swipe-1.wav', 'assets/sounds/swipe-2.wav'], v: 0.8, r: 0.9 }] },
        smash: {
            gap: 50, layers: [
                { u: ['assets/sounds/smash-0.ogg', 'assets/sounds/smash-1.ogg', 'assets/sounds/smash-2.ogg'], v: 0.9, r: 0.8 },
                { u: ['synth:thud-s0', 'synth:thud-s1'], v: 0.8 },
            ],
        },
        tail: { gap: 120, layers: [{ u: 'assets/sounds/tail-whoosh.wav', v: 0.9 }, { u: 'assets/sounds/smash-1.ogg', v: 0.55, r: 0.65 }] },
        slam: { gap: 200, layers: [{ u: 'synth:slam', v: 1 }, { u: ['assets/sounds/explosion-l-low-0.ogg', 'assets/sounds/explosion-l-low-1.ogg'], v: 0.55, r: 0.9 }] },
        breath_start: { gap: 300, layers: [{ u: 'synth:breath', v: 0.9 }] },
        brick_break: { gap: 80, layers: [{ u: ['assets/sounds/brick-0.ogg', 'assets/sounds/brick-1.ogg', 'assets/sounds/brick-2.ogg', 'assets/sounds/brick-3.ogg'], v: 0.7 }] },
        glass: { gap: 50, layers: [{ u: ['assets/sounds/glass-h0.ogg', 'assets/sounds/glass-h1.ogg', 'assets/sounds/glass-h2.ogg', 'assets/sounds/glass-m0.ogg'], v: 0.8 }] },
        collapse: { gap: 400, layers: [{ u: 'synth:collapse', v: 1 }, { u: 'assets/sounds/explosion-l-low-1.ogg', v: 0.5, r: 0.6 }] },
        explosion_s: { gap: 40, layers: [{ u: ['assets/sounds/explosion-s-a.ogg', 'assets/sounds/explosion-s-b.ogg', 'assets/sounds/explosion-s-c.ogg'], v: 0.85 }] },
        explosion_m: { gap: 60, layers: [{ u: ['assets/sounds/explosion-m-1.ogg', 'assets/sounds/explosion-m-2.ogg', 'assets/sounds/explosion-m-3.ogg'], v: 0.9 }] },
        explosion_l: {
            gap: 120, layers: [
                { u: ['assets/sounds/explosion-l-low-0.ogg', 'assets/sounds/explosion-l-low-1.ogg'], v: 1, r: 0.85 },
                { u: 'assets/sounds/explosion-l-crunch.ogg', v: 0.9, r: 0.9 },
            ],
        },
        gun: { gap: 45, layers: [{ u: ['synth:gun-0', 'synth:gun-1', 'synth:gun-2'], v: 0.8 }] },
        cannon: { gap: 80, layers: [{ u: 'synth:cannon', v: 1 }] },
        rocket_launch: { gap: 100, layers: [{ u: 'synth:rocket', v: 0.9 }] },
        missile_hit: { gap: 60, layers: [{ u: 'assets/sounds/crunch-0.ogg', v: 1, r: 0.9 }, { u: ['assets/sounds/explosion-s-a.ogg', 'assets/sounds/explosion-s-b.ogg'], v: 0.7, r: 0.8 }] },
        laser: { gap: 60, layers: [{ u: ['assets/sounds/laser-0.ogg', 'assets/sounds/laser-1.ogg', 'assets/sounds/laser-2.ogg'], v: 0.8 }] },
        jet_pass: { gap: 600, layers: [{ u: 'synth:jet', v: 0.9 }] },
        hurt: { gap: 150, layers: [{ u: ['synth:hurt-0', 'synth:hurt-1'], v: 0.9 }] },
        heal: { gap: 150, layers: [{ u: 'synth:heal', v: 0.8 }] },
        gameover: { gap: 500, layers: [{ u: 'synth:gameover', v: 0.9 }] },
        victory: { gap: 500, layers: [{ u: 'synth:victory', v: 0.9 }] },
        car_crush: {
            gap: 80, layers: [
                { u: ['assets/sounds/car-metal-0.ogg', 'assets/sounds/car-metal-1.ogg', 'assets/sounds/car-metal-2.ogg'], v: 0.9, r: 0.85 },
                { u: 'assets/sounds/car-crunch.wav', v: 0.7 },
            ],
        },
        splash: { gap: 100, layers: [{ u: 'assets/sounds/splash.wav', v: 0.9 }] },
        alarm: { gap: 300, layers: [{ u: 'synth:alarm', v: 0.7 }] },
    },
    _loopDefs: {
        beam: { u: 'synth:beam', v: 0.8 },
        siren: { u: 'synth:siren', v: 0.5 },
        heli: { u: 'synth:heli', v: 0.7 },
        fire: { u: 'synth:fire', v: 0.6 },
    },

    /** Дёшево и синхронно: подписки на жесты и разблокировку звука. Повторные вызовы безопасны. */
    init() {
        if (this._inited) return;
        this._inited = true;
        if (typeof window !== 'undefined') {
            const kick = () => { setTimeout(() => this._ensurePlaying(), 0); setTimeout(() => this._ensurePlaying(), 120); };
            for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, kick, true);
        }
        try {   // Sound сам зовёт _startPending при разблокировке (жест / платформа): подключаемся без правки Sound.js
            const S = /** @type {any} */ (Sound), orig = S._startPending;
            if (typeof orig === 'function' && !orig._gameAudio) {
                const wrapped = (/** @type {any[]} */ ...args) => { const r = orig.apply(S, args); GameAudio._ensurePlaying(); return r; };
                wrapped._gameAudio = true;
                S._startPending = wrapped;
            }
        } catch (e) { /* без Sound — тишина */ }
        setTimeout(() => this._warmSynth(), 500);
    },

    /** Фоном (по одному за тик) строим синтезированные звуки, чтобы первый вызов не лагал. */
    _warmSynth() {
        if (this._warmed) return;
        const names = Object.keys(GameAudioKit.SYN);
        let i = 0;
        const step = () => {
            if (i >= names.length) { this._warmed = true; return; }
            try { this._ensureSynth('synth:' + names[i++]); } catch (e) { /* ничего */ }
            setTimeout(step, 20);
        };
        step();
    },

    /** 'synth:имя' -> буфер в Sound (по первому запросу). */
    _ensureSynth(url) {
        if (typeof url !== 'string' || url.indexOf('synth:') !== 0 || this._synthDone.has(url)) return;
        this._synthDone.add(url);
        const key = url.slice(6);
        const fn = GameAudioKit.SYN[key];
        if (!fn) { console.warn('GameAudio: нет синтеза ' + url); return; }
        try {
            const buf = Sound.makeBuffer(fn(), GameAudioKit.SR);
            Sound.putBuffer(key, buf);
        } catch (e) { console.warn('GameAudio: синтез ' + url + ' не удался', e); }
    },

    // ---------- Музыка ----------
    /** Готовит тему (рендер стемов); безопасно звать несколько раз. Возвращает true, если тема готова. */
    async prepare(track) {
        if (!track || !GameAudioKit.TRACKS[track]) return false;
        if (this._prepared.has(track)) return true;
        let job = this._jobs.get(track);
        if (!job) {
            job = this._queue.then(() => this._render(track)).catch((e) => { console.warn('GameAudio: тема ' + track + ' не собралась', e); return false; });
            this._queue = job;
            this._jobs.set(track, job);
            job.then(() => this._jobs.delete(track));
        }
        return job;
    },

    async _render(track) {
        if (this._prepared.has(track)) return true;
        if (track !== 'menu') for (const k of [...this._prepared.keys()]) if (k !== 'menu' && k !== track) this._prepared.delete(k);   // прежняя карта — в утиль
        const r = await GameAudioKit.renderTrack(track, () => new Promise((res) => setTimeout(res, 0)));
        const stems = r.stems.map((st) => ({ name: st.name, buffer: this._makeBuffer(st.data, st.rate) }));
        if (stems.some((s) => !s.buffer)) return false;
        this._prepared.set(track, { track, loopSec: r.loopSec, stems, timing: r.timing, mixGain: r.mixGain });
        return true;
    },

    _makeBuffer(data, rate) {
        try {
            const b = new AudioBuffer({ length: data.length, sampleRate: rate, numberOfChannels: 1 });
            b.copyToChannel(data, 0);
            return b;
        } catch (e) { return Sound.makeBuffer(data, rate); }
    },

    /** Запустить / плавно сменить тему: 'menu' | 'metro' | 'harbor' | 'tokyo' | 'desert' | 'arctic' | null (стоп). */
    music(track) {
        this.init();
        if (track == null || track === '') {
            this._want = null;
            if (this._cur) { this._release(this._cur, 1.2); this._cur = null; }
            return;
        }
        if (!GameAudioKit.TRACKS[track]) { console.warn('GameAudio: неизвестная тема ' + track); return; }
        this._want = track;
        this._ensurePlaying();
    },

    _poll() {
        if (this._polling) return;
        this._polling = true;
        setTimeout(() => { this._polling = false; this._ensurePlaying(); }, 400);
    },

    /** Приводит звучание к желаемому: готовит тему, ждёт разблокировки контекста, затем стартует. */
    _ensurePlaying() {
        const track = this._want;
        if (!track || typeof Sound === 'undefined') return;
        if (this._cur && this._cur.track === track) return;
        const rec = this._prepared.get(track);
        if (!rec) {
            this.prepare(track).then(() => { if (this._want === track) this._ensurePlaying(); });
            return;
        }
        const ctx = Sound.ctx;
        if (!ctx || !Sound.musicGain) { this._poll(); return; }
        this._begin(rec, ctx);
    },

    _begin(rec, ctx) {
        const old = this._cur;
        const t = ctx.currentTime, t0 = t + 0.06;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.connect(Sound.musicGain);
        const target = GameAudioKit.mix(rec.track, this._intensity);
        const gains = [], sources = [];
        rec.stems.forEach((st, i) => {
            const src = ctx.createBufferSource();
            src.buffer = st.buffer;
            src.loop = true;
            const g = ctx.createGain();
            g.gain.value = target[i];
            src.connect(g); g.connect(out);
            src.start(t0);          // все стемы в одно и то же время: синхронны сэмпл в сэмпл
            gains.push(g); sources.push(src);
        });
        out.gain.setTargetAtTime(this._makeup, t, old ? 0.6 : 0.25);
        if (old) this._release(old, 2.0);
        this._cur = { track: rec.track, out, gains, sources };
    },

    _release(cur, fade) {
        const ctx = Sound.ctx;
        if (!ctx) return;
        const t = ctx.currentTime;
        try {
            cur.out.gain.cancelScheduledValues(t);
            cur.out.gain.setValueAtTime(cur.out.gain.value, t);
            cur.out.gain.setTargetAtTime(0, t, fade / 3);
            cur.sources.forEach((s, i) => {
                try { s.stop(t + fade * 1.7); } catch (e) { /* уже стоит */ }
                if (i === 0) s.onended = () => { try { cur.out.disconnect(); } catch (e) { /* ок */ } };
            });
        } catch (e) { /* контекст закрыт */ }
    },

    /** Звёзды розыска 0..6 -> набор слоёв темы (плавно 1-2 с). Дробное значение — между рядами. */
    setIntensity(n) {
        this._intensity = Math.max(0, Math.min(6, Number(n) || 0));
        const cur = this._cur, ctx = typeof Sound !== 'undefined' ? Sound.ctx : null;
        if (!cur || !ctx) return;
        const target = GameAudioKit.mix(cur.track, this._intensity), t = ctx.currentTime;
        cur.gains.forEach((g, i) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(target[i], t, 0.45); });
    },

    // ---------- Звуки ----------
    /** Разовый звук по имени. opts: { volume = 1, rate = 1 }. Неизвестное имя — тишина. */
    sfx(name, opts) {
        const def = this._sfxDefs[name];
        if (!def || typeof Sound === 'undefined') return null;
        this.init();
        if (def.gap) {
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const last = this._last.get(name);
            if (last !== undefined && now - last < def.gap) return null;
            this._last.set(name, now);
        }
        const o = opts || {}, vol = o.volume == null ? 1 : o.volume, rate = o.rate == null ? 1 : o.rate;
        let handle = null;
        for (const layer of def.layers) {
            const urls = layer.u;
            if (Array.isArray(urls)) urls.forEach((u) => this._ensureSynth(u)); else this._ensureSynth(urls);
            const h = Sound.play(urls, { volume: vol * (layer.v == null ? 1 : layer.v), rate: rate * (layer.r || 1) });
            if (!handle) handle = h;
        }
        return handle;
    },

    /** Цикл по имени (beam, siren, heli, fire): { set(volume, rate), stop(), fade(seconds) } — всегда handle. */
    loop(name, opts) {
        const def = this._loopDefs[name];
        if (!def || typeof Sound === 'undefined') return { set() { }, stop() { }, fade() { } };
        this.init();
        this._ensureSynth(def.u);
        const o = opts || {};
        const vol = (o.volume == null ? 1 : o.volume) * def.v;
        const h = Sound.loop(def.u, { volume: vol, rate: o.rate || 1 });
        // оборачиваем set: громкость цикла тоже умножается на базу
        return {
            set(volume, rate) { h.set(volume == null ? null : volume * def.v, rate); },
            stop() { h.stop(); },
            fade(seconds) { h.fade(seconds); },
        };
    },

    // ---------- Для проверок (tools/audio-test.html) ----------
    /** Статистика готовой темы: длины, пики, стыки цикла, пик полного микса. */
    _stats(track) {
        const rec = this._prepared.get(track);
        if (!rec) return null;
        const stems = rec.stems.map((st) => {
            const d = st.buffer.getChannelData(0);
            let pk = 0, sum = 0, nan = 0;
            for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) nan++; const a = Math.abs(v); if (a > pk) pk = a; sum += v * v; }
            return { name: st.name, rate: st.buffer.sampleRate, length: st.buffer.length, duration: st.buffer.duration, peak: pk, rms: Math.sqrt(sum / d.length), first: d[0], last: d[d.length - 1], nan };
        });
        const n = rec.stems[2].buffer.length, ds = rec.stems.map((s) => s.buffer.getChannelData(0));
        let mixPk = 0;
        for (let i = 0; i < n; i++) {
            const h = i >> 1, s = ds[0][h] + ds[1][h] + ds[2][i] + ds[3][i] + ds[4][i] + ds[5][i];
            if (Math.abs(s) > mixPk) mixPk = Math.abs(s);
        }
        return { track, loopSec: rec.loopSec, stems, mixPeak: mixPk, timing: rec.timing, mixGain: rec.mixGain };
    },
    /** Статистика синтезированного звука (для самопроверки). */
    _synthStats(key) {
        const fn = GameAudioKit.SYN[key];
        if (!fn) return null;
        const d = fn();
        let pk = 0, nan = 0, sum = 0;
        for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) nan++; const a = Math.abs(v); if (a > pk) pk = a; sum += v * v; }
        return { key, seconds: d.length / GameAudioKit.SR, peak: pk, rms: Math.sqrt(sum / d.length), first: d[0], last: d[d.length - 1], nan };
    },
};
