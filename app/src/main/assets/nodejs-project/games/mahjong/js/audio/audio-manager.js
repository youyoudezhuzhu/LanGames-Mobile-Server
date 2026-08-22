/**
 * 万能麻将 - 极致音频引擎 (Maximized SFX)
 * 使用Web Audio API + 高级合成技术
 */

const AudioManager = (function() {
    'use strict';

    let audioCtx = null;
    let masterGain = null;
    let limiter = null;
    let bgmGain = null;
    let sfxGain = null;
    let isMuted = false;
    let bgmVolume = 0.5;
    let sfxVolume = 0.5;
    let bgmPlaying = false;
    let currentBgm = null;
    let bgmTimer = null;
    let sfxEnabled = true;
    let bgmResumeAfterVisibility = null;
    const activeSfxTimers = new Set();

    // 音频缓存（避免重复创建）
    const audioCache = new Map();

    function init() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 1;
            if (typeof audioCtx.createDynamicsCompressor === 'function') {
                limiter = audioCtx.createDynamicsCompressor();
                limiter.threshold.value = -8;
                limiter.knee.value = 10;
                limiter.ratio.value = 8;
                limiter.attack.value = 0.003;
                limiter.release.value = 0.18;
                masterGain.connect(limiter);
                limiter.connect(audioCtx.destination);
            } else {
                masterGain.connect(audioCtx.destination);
            }

            bgmGain = audioCtx.createGain();
            bgmGain.connect(masterGain);
            bgmGain.gain.value = bgmVolume;

            sfxGain = audioCtx.createGain();
            sfxGain.connect(masterGain);
            sfxGain.gain.value = sfxVolume;
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    /**
     * 重新连接分轨总线，让已经排程的旧音源立即静音。
     * Web Audio 的 stop 定时只能阻止后续排程，断开旧总线才能可靠停止正在播放的长音。
     */
    function resetGainBus(kind) {
        if (!audioCtx || !masterGain) return;
        const previous = kind === 'bgm' ? bgmGain : sfxGain;
        const next = audioCtx.createGain();
        next.gain.value = kind === 'bgm' ? bgmVolume : sfxVolume;
        next.connect(masterGain);
        if (kind === 'bgm') bgmGain = next;
        else sfxGain = next;
        try {
            previous?.disconnect();
        } catch (_) {
            // 某些旧浏览器会在重复 disconnect 时抛错；新总线已经接管，不影响后续播放。
        }
    }

    function resume() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function ensureAudio() {
        init();
        resume();
        return !!audioCtx;
    }

    // SFX timer 管理（防止游戏切换后旧音效仍播放）
    function sfxTimeout(fn, delay) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted) return null;
        const id = setTimeout(() => {
            activeSfxTimers.delete(id);
            fn();
        }, delay);
        activeSfxTimers.add(id);
        return id;
    }

    function clearAllSfxTimers() {
        activeSfxTimers.forEach(id => clearTimeout(id));
        activeSfxTimers.clear();
        resetGainBus('sfx');
    }

    // ============ 高级合成器 ============

    /**
     * FM合成器 - 用于丰富音色
     */
    function playFM(options = {}) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted || !ensureAudio()) return;
        const {
            carrier = 440,
            modulator = 220,
            modulationIndex = 100,
            attack = 0.01,
            decay = 0.1,
            sustain = 0.3,
            release = 0.5,
            volume = 0.3
        } = options;

        const amp = Math.max(0, volume || 0);
        if (amp <= 0.0001) return;

        const now = audioCtx.currentTime;

        // 载波
        const carrierOsc = audioCtx.createOscillator();
        carrierOsc.frequency.value = carrier;

        // 调制器
        const modOsc = audioCtx.createOscillator();
        modOsc.frequency.value = modulator;

        const modGain = audioCtx.createGain();
        modGain.gain.value = modulationIndex;

        const envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(amp, now + Math.max(attack, 0.001));
        envelope.gain.exponentialRampToValueAtTime(Math.max(amp * sustain, 0.0001), now + Math.max(attack, 0.001) + Math.max(decay, 0.001));
        envelope.gain.exponentialRampToValueAtTime(0.001, now + Math.max(attack, 0.001) + Math.max(decay, 0.001) + Math.max(release, 0.001));

        modOsc.connect(modGain);
        modGain.connect(carrierOsc.frequency);
        carrierOsc.connect(envelope);
        envelope.connect(sfxGain);

        carrierOsc.start(now);
        modOsc.start(now);
        carrierOsc.stop(now + attack + decay + release + 0.1);
        modOsc.stop(now + attack + decay + release + 0.1);

        carrierOsc.onended = () => {
            carrierOsc.disconnect();
            modOsc.disconnect();
            modGain.disconnect();
            envelope.disconnect();
        };
    }

    /**
     * 噪声合成器 - 用于滑动/碰撞声
     */
    function playNoise(options = {}) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted || !ensureAudio()) return;
        const {
            duration = 0.2,
            frequency = 1000,
            type = 'bandpass',
            volume = 0.3,
            attack = 0.01,
            decay = 0.15
        } = options;

        const amp = Math.max(0, volume || 0);
        if (amp <= 0.0001) return;

        const now = audioCtx.currentTime;
        const safeDuration = Math.min(Math.max(duration, 0.001), 5);
        const bufferSize = audioCtx.sampleRate * safeDuration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = 5;

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(amp, now + Math.max(attack, 0.001));
        gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(attack, 0.001) + Math.max(decay, 0.001));

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(sfxGain);
        noise.start(now);
        noise.stop(now + safeDuration);

        noise.onended = () => {
            noise.disconnect();
            filter.disconnect();
            gain.disconnect();
        };
    }

    /**
     * 打击合成器
     */
    function playPerc(options = {}) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted || !ensureAudio()) return;
        const {
            freq = 200,
            decay = 0.15,
            type = 'sine',
            pitchDrop = 100,
            volume = 0.5,
            harmonics = []
        } = options;

        const amp = Math.max(0, volume || 0);
        if (amp <= 0.0001) return;

        const now = audioCtx.currentTime;
        const mainOsc = audioCtx.createOscillator();
        mainOsc.type = type;
        mainOsc.frequency.setValueAtTime(freq, now);
        mainOsc.frequency.exponentialRampToValueAtTime(Math.max(freq - pitchDrop, 50), now + decay);

        const mainGain = audioCtx.createGain();
        mainGain.gain.setValueAtTime(amp, now);
        mainGain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        mainOsc.connect(mainGain);
        mainGain.connect(sfxGain);
        mainOsc.start(now);
        mainOsc.stop(now + decay + 0.05);

        mainOsc.onended = () => {
            mainOsc.disconnect();
            mainGain.disconnect();
        };

        // 添加泛音
        harmonics.forEach((h, i) => {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq * h.freq;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(amp * h.amp, now + h.delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + decay * 0.8);
            osc.connect(g);
            g.connect(sfxGain);
            osc.start(now + h.delay);
            osc.stop(now + decay + 0.05);
            osc.onended = () => {
                osc.disconnect();
                g.disconnect();
            };
        });
    }

    /**
     * 和弦合成器
     */
    function playChord(freqs, options = {}) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted || !ensureAudio()) return;
        const { duration = 0.5, volume = 0.4, type = 'sine', stagger = 0.04 } = options;
        const amp = Math.max(0, volume || 0);
        if (amp <= 0.0001) return;

        const now = audioCtx.currentTime;

        freqs.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = type;
            osc.frequency.value = freq;

            const t = now + i * stagger;
            const attack = 0.02;
            const rel = duration - attack;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(amp * 0.3, t + attack);
            g.gain.exponentialRampToValueAtTime(0.001, t + attack + rel);

            osc.connect(g);
            g.connect(sfxGain);
            osc.start(t);
            osc.stop(t + attack + rel + 0.05);
            osc.onended = () => {
                osc.disconnect();
                g.disconnect();
            };
        });
    }

    /**
     * 铃铛合成器
     */
    function playBell(freq, options = {}) {
        if (!sfxEnabled || sfxVolume <= 0.0001 || isMuted || !ensureAudio()) return;
        const { duration = 1.5, volume = 0.4 } = options;
        const amp = Math.max(0, volume || 0);
        if (amp <= 0.0001) return;

        const now = audioCtx.currentTime;

        const fundamental = audioCtx.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.value = freq;

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(amp * 0.5, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);

        fundamental.connect(g);
        g.connect(sfxGain);
        fundamental.start(now);
        fundamental.stop(now + duration);

        fundamental.onended = () => {
            fundamental.disconnect();
            g.disconnect();
        };

        // 泛音
        [1.5, 2, 2.5, 3].forEach((ratio, i) => {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq * ratio;
            const g2 = audioCtx.createGain();
            g2.gain.setValueAtTime(0, now + i * 0.05);
            g2.gain.linearRampToValueAtTime(amp * 0.15 / ratio, now + i * 0.05 + 0.03);
            g2.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);
            osc.connect(g2);
            g2.connect(sfxGain);
            osc.start(now + i * 0.05);
            osc.stop(now + duration);
            osc.onended = () => {
                osc.disconnect();
                g2.disconnect();
            };
        });
    }

    // ============ 游戏音效库 ============

    const SFX = {
        // 摸牌 - 根据花色有不同音效
        draw(tile) {
            if (!tile) {
                playNoise({ duration: 0.15, frequency: 500, volume: 0.3 });
                return;
            }
            const suitFreqs = { wan: 400, tong: 550, tiao: 700, feng: 350, jian: 450, hua: 600 };
            const freq = suitFreqs[tile.suit] || 500;
            playNoise({ duration: 0.12, frequency: freq, volume: 0.25, type: 'bandpass' });
            // 轻微共振
            playPerc({ freq: freq * 2, decay: 0.08, volume: 0.15, pitchDrop: 50 });
        },

        // 打牌 - 落桌声
        discard(tile) {
            const suitFreqs = { wan: 200, tong: 260, tiao: 320, feng: 180, jian: 220, hua: 350 };
            const freq = suitFreqs[tile?.suit] || 250;
            playPerc({
                freq, decay: 0.1, type: 'triangle',
                pitchDrop: 80, volume: 0.5,
                harmonics: [{ freq: 2, amp: 0.3, delay: 0.01 }]
            });
            // 桌面共振
            sfxTimeout(() => {
                playPerc({ freq: freq * 0.5, decay: 0.2, type: 'sine', pitchDrop: 30, volume: 0.2 });
            }, 30);
        },

        // 电脑落牌：保留回合节奏，但比本家落牌更轻，避免连续操作轰鸣。
        opponentDiscard(tile) {
            const suitFreqs = { wan: 180, tong: 220, tiao: 270, feng: 160, jian: 200, hua: 300 };
            playPerc({
                freq: suitFreqs[tile?.suit] || 210,
                decay: 0.07,
                type: 'triangle',
                pitchDrop: 45,
                volume: 0.16
            });
        },

        // 选中牌
        selectTile() {
            playFM({ carrier: 1200, modulator: 600, modulationIndex: 50, attack: 0.005, decay: 0.03, sustain: 0, release: 0.05, volume: 0.2 });
        },

        // 取消选中
        // deselectTile() {  // 未使用，已移除
        //     playFM({ carrier: 800, modulator: 400, modulationIndex: 30, attack: 0.005, decay: 0.03, sustain: 0, release: 0.05, volume: 0.15 });
        // },

        // 吃 - 轻快三连音
        chi() {
            playChord([523, 659, 784], { duration: 0.25, volume: 0.5, type: 'triangle', stagger: 0.03 });
            sfxTimeout(() => playPerc({ freq: 1047, decay: 0.08, type: 'sine', volume: 0.2 }), 80);
        },

        // 碰 - 有力双音
        peng() {
            playChord([440, 554], { duration: 0.3, volume: 0.55, type: 'square', stagger: 0 });
            sfxTimeout(() => {
                playPerc({ freq: 880, decay: 0.12, type: 'triangle', volume: 0.3 });
                playChord([440, 554], { duration: 0.2, volume: 0.3, stagger: 0 });
            }, 100);
        },

        // 杠 - 深沉有力
        gang() {
            playPerc({ freq: 150, decay: 0.4, type: 'sawtooth', pitchDrop: 50, volume: 0.6 });
            playChord([196, 247, 293], { duration: 0.5, volume: 0.5, type: 'square', stagger: 0.05 });
            sfxTimeout(() => playPerc({ freq: 100, decay: 0.5, type: 'sine', volume: 0.4 }), 150);
        },

        // 暗杠
        anGang() {
            playPerc({ freq: 200, decay: 0.3, type: 'triangle', pitchDrop: 40, volume: 0.5 });
            playChord([261, 329, 392], { duration: 0.4, volume: 0.4, type: 'sine', stagger: 0.06 });
        },

        // 胡 - 胜利钟声
        hu() {
            playBell(523, { duration: 1.5, volume: 0.7 });
            sfxTimeout(() => playBell(659, { duration: 1.2, volume: 0.5 }), 150);
            sfxTimeout(() => playBell(784, { duration: 1.8, volume: 0.6 }), 300);
            sfxTimeout(() => playBell(1047, { duration: 2.5, volume: 0.4 }), 500);
        },

        // 自摸 - 华丽庆祝
        ziMo() {
            playBell(587, { duration: 0.8, volume: 0.6 });
            sfxTimeout(() => playBell(740, { duration: 0.8, volume: 0.6 }), 80);
            sfxTimeout(() => playBell(880, { duration: 1, volume: 0.7 }), 160);
            sfxTimeout(() => playBell(1175, { duration: 2, volume: 0.5 }), 350);
            // 鼓点
            [0, 200, 400, 600, 800].forEach((t, i) => {
                sfxTimeout(() => playPerc({ freq: 120 + i * 30, decay: 0.15, type: 'sine', volume: 0.25 }), t);
            });
        },

        // 流局
        drawGame() {
            playChord([392, 349, 329], { duration: 1, volume: 0.4, type: 'sine' });
            sfxTimeout(() => playChord([329, 293, 261], { duration: 1.2, volume: 0.3, type: 'triangle' }), 400);
        },

        // 游戏开始
        gameStart() {
            const notes = [523, 587, 659, 784];
            notes.forEach((freq, i) => {
                sfxTimeout(() => playBell(freq, { duration: 0.6, volume: 0.4 }), i * 120);
            });
        },

        // 游戏结束
        gameEnd(isWin) {
            if (isWin) {
                [523, 587, 659, 784, 659, 784, 1047].forEach((freq, i) => {
                    sfxTimeout(() => playBell(freq, { duration: 0.5, volume: 0.5 }), i * 120);
                });
            } else {
                playChord([440, 392, 349], { duration: 1.2, volume: 0.35 });
            }
        },

        // 按钮点击
        buttonClick() {
            playFM({ carrier: 1500, modulator: 750, modulationIndex: 100, attack: 0.003, decay: 0.04, sustain: 0, release: 0.03, volume: 0.25 });
        },

        // 开关切换
        toggleSwitch() {
            playFM({ carrier: 2000, modulator: 1000, modulationIndex: 200, attack: 0.002, decay: 0.05, volume: 0.2 });
        },

        // 滑动条
        // sliderChange() {  // 未使用，已移除
        //     playFM({ carrier: 800 + Math.random() * 400, modulator: 400, modulationIndex: 50, attack: 0.002, decay: 0.03, volume: 0.1 });
        // },

        // 警告
        warning() {
            playPerc({ freq: 350, decay: 0.25, type: 'sawtooth', pitchDrop: 100, volume: 0.4 });
            sfxTimeout(() => playPerc({ freq: 300, decay: 0.3, type: 'sawtooth', pitchDrop: 80, volume: 0.4 }), 120);
        },

        // 错误（静默）
        error() {},

        // 滴答 - 倒计时（降低音量）
        tick() {
            playPerc({ freq: 2200, decay: 0.015, type: 'sine', volume: 0.06 });
        },

        // 以下未使用/静默的SFX已移除以减少代码体积：
        // tickUrgent, tickEnd, achievement, levelUp, flower,
        // screenSwitch, menuOpen, menuClose, modalOpen,
        // scoreUp, scoreDown, combo, turnStart, windChange, toDiscard, flip3D
    };

    // ============ BGM 系统 ============

    const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
    const MINOR_PENTATONIC = [311.13, 349.23, 392.00, 466.16, 523.25];

    const BGM_PATTERNS = {
        calm: {
            notes: [
                [0, 2, 4, 2, 0, 2, 4, 5],
                [4, 2, 0, 2, 4, 5, 4, 2],
                [0, 2, 4, 5, 4, 2, 0, -1],
                [5, 4, 2, 0, -1, 0, 2, 4]
            ],
            scale: PENTATONIC,
            tempo: 0.55,
            type: 'sine',
            harmony: true
        },
        upbeat: {
            notes: [
                [0, 2, 4, 4, 2, 0, 2, 4],
                [5, 4, 2, 0, 2, 4, 5, 5],
                [4, 5, 4, 2, 0, -1, 0, 2]
            ],
            scale: PENTATONIC.map(f => f * 1.5),
            tempo: 0.35,
            type: 'triangle',
            harmony: false
        },
        zen: {
            notes: [
                [0, -1, 2, -1, 4, -1, 2, -1],
                [4, -1, 5, -1, 4, 2, 0, -1]
            ],
            scale: MINOR_PENTATONIC,
            tempo: 0.8,
            type: 'sine',
            harmony: true
        }
    };

    function startBgm(style = 'calm') {
        stopBgm();
        const pattern = BGM_PATTERNS[style];
        currentBgm = pattern ? style : null;
        if (!pattern || bgmVolume <= 0.0001) return;
        if (document.hidden) {
            bgmResumeAfterVisibility = style;
            currentBgm = null;
            return;
        }

        init();
        resume();
        if (!audioCtx || !bgmGain) return;

        bgmPlaying = true;
        const loop = () => {
            if (!bgmPlaying || currentBgm !== style) return;
            const activePattern = BGM_PATTERNS[style];
            const melody = activePattern.notes[Math.floor(Math.random() * activePattern.notes.length)];
            const startTime = audioCtx.currentTime + 0.08;
            const endTime = schedulePhrase(
                melody,
                startTime,
                activePattern.tempo,
                activePattern.scale,
                activePattern.type,
                activePattern.harmony
            );
            const delay = Math.max(250, (endTime - audioCtx.currentTime) * 1000);
            bgmTimer = setTimeout(loop, delay);
        };
        loop();
    }

    function schedulePhrase(melody, startTime, tempo, scale, oscType, addHarmony) {
        let t = startTime;
        melody.forEach((noteIdx) => {
            if (noteIdx >= 0) {
                const freq = scale[noteIdx % scale.length];
                playBgmNote(freq, t, tempo, oscType, addHarmony);
            }
            t += tempo;
        });
        return t;
    }

    function playBgmNote(freq, time, duration, oscType, addHarmony) {
        if (!audioCtx || !bgmPlaying) return;
        if (bgmVolume <= 0.0001) return;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = oscType;
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.06, time + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.03);

        osc.connect(gain);
        gain.connect(bgmGain);
        osc.start(time);
        osc.stop(time + duration);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
        };

        if (addHarmony && Math.random() > 0.5) {
            const harm = audioCtx.createOscillator();
            const harmGain = audioCtx.createGain();
            harm.type = 'sine';
            harm.frequency.value = freq * 1.5;
            harmGain.gain.setValueAtTime(0, time + 0.05);
            harmGain.gain.linearRampToValueAtTime(0.025, time + 0.12);
            harmGain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.6);
            harm.connect(harmGain);
            harmGain.connect(bgmGain);
            harm.start(time + 0.05);
            harm.stop(time + duration * 0.7);

            harm.onended = () => {
                harm.disconnect();
                harmGain.disconnect();
            };
        }
    }

    function stopBgm(preserveVisibilityResume = false) {
        bgmPlaying = false;
        currentBgm = null;
        if (!preserveVisibilityResume) bgmResumeAfterVisibility = null;
        if (bgmTimer) {
            clearTimeout(bgmTimer);
            bgmTimer = null;
        }
        resetGainBus('bgm');
    }

    // ============ 音量控制 ============

    function normalizeVolume(vol) {
        const value = Number(vol);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }

    function setBgmVolume(vol) {
        bgmVolume = normalizeVolume(vol);
        if (bgmGain) bgmGain.gain.value = bgmVolume;
        if (bgmVolume <= 0.0001 && bgmPlaying) stopBgm();
    }

    function setSfxVolume(vol) {
        sfxVolume = normalizeVolume(vol);
        if (sfxGain) sfxGain.gain.value = sfxVolume;
        if (sfxVolume <= 0.0001) clearAllSfxTimers();
    }

    function setMuted(muted) {
        isMuted = muted;
        if (masterGain) masterGain.gain.value = muted ? 0 : 1;
        if (isMuted) clearAllSfxTimers();
    }

    function setSfxEnabled(enabled) {
        sfxEnabled = !!enabled;
        if (!sfxEnabled) clearAllSfxTimers();
    }

    function getBgmVolume() { return bgmVolume; }
    function getSfxVolume() { return sfxVolume; }

    function setupUserInteraction() {
        const events = ['click', 'touchstart', 'keydown'];
        const handler = () => {
            const bgmToResume = bgmPlaying ? currentBgm : null;
            init();
            resume();
            if (bgmToResume) startBgm(bgmToResume);
            events.forEach(e => document.removeEventListener(e, handler));
        };
        events.forEach(e => document.addEventListener(e, handler, { once: true }));

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (bgmPlaying) {
                    bgmResumeAfterVisibility = currentBgm;
                    stopBgm(true);
                }
                clearAllSfxTimers();
                return;
            }
            const style = bgmResumeAfterVisibility;
            bgmResumeAfterVisibility = null;
            if (style && bgmVolume > 0.0001) startBgm(style);
        });
    }

    return {
        init, resume, setupUserInteraction,
        SFX,
        startBgm, stopBgm, stopAllSfx: clearAllSfxTimers,
        setBgmVolume, setSfxVolume, setMuted, setSfxEnabled,
        getBgmVolume, getSfxVolume,
        get isPlaying() { return bgmPlaying; },
        get currentBgm() { return currentBgm; },
        get isSfxEnabled() { return sfxEnabled; }
    };
})();
