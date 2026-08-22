/**
 * 万能麻将 - 设置、主题与游戏内菜单模块
 * 从 main.js 拆分（架构拆分轮次 2）
 */
    let _settingsTrigger = null;
    let _settingsReturnToIngameMenu = false;
    let _sliderSaveTimer = null;
    let _sliderRollbackSettings = null;
    const AI_DIFFICULTY_HINTS = {
        easy: '休闲出牌，偶尔会保留次优牌型。',
        normal: '均衡牌效，会优先保留有效进张。',
        expert: '综合对手建模、听牌质量与攻守收益。'
    };
    const BGM_STYLE_LABELS = { none: '关闭', calm: '悠然', upbeat: '轻快', zen: '禅意' };

    function updateSettingsHelp(settings) {
        const aiHint = document.getElementById('ai-difficulty-hint');
        if (aiHint) aiHint.textContent = AI_DIFFICULTY_HINTS[settings.aiDifficulty] || AI_DIFFICULTY_HINTS.normal;

        const audioStatus = document.getElementById('audio-settings-status');
        if (audioStatus) {
            const bgmLabel = BGM_STYLE_LABELS[settings.bgmStyle] || BGM_STYLE_LABELS.none;
            const bgmText = settings.bgmStyle === 'none' || settings.bgmVolume <= 0
                ? '背景音乐：关闭'
                : `背景音乐：${bgmLabel} · ${settings.bgmVolume}%`;
            const sfxText = settings.sfxEnabled === false || settings.sfxVolume <= 0
                ? '游戏音效：关闭'
                : `游戏音效：${settings.sfxVolume}%`;
            audioStatus.textContent = `${bgmText} · ${sfxText}`;
        }
    }

    function syncSettingsControls(settings = App.settings) {
        if (!settings) return;
        const settingMap = {
            'player-name': settings.playerName,
            'ai-difficulty': settings.aiDifficulty,
            'table-theme': settings.tableTheme,
            'game-rounds': String(settings.gameRounds),
            'game-speed': settings.gameSpeed,
            'bgm-volume': settings.bgmVolume,
            'sfx-volume': settings.sfxVolume,
            'sfx-enabled': settings.sfxEnabled,
            'bgm-style': settings.bgmStyle,
            'opponent-display': settings.opponentDisplay,
            'show-tile-names': settings.showTileNames,
            'show-shanten': settings.showShanten,
            'auto-sort': settings.autoSort
        };

        for (const [id, value] of Object.entries(settingMap)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (el.type === 'range') {
                el.value = value;
                const label = document.getElementById(id + '-value');
                if (label) label.textContent = value + '%';
            } else if (el.type === 'checkbox') {
                el.checked = !!value;
            } else {
                el.value = value;
            }
        }
        updateSettingsHelp(settings);
    }

    function restoreSettings(settings) {
        App.settings = Utils.deepClone(settings);
        syncSettingsControls(App.settings);
        AudioManager.setBgmVolume(App.settings.bgmVolume / 100);
        AudioManager.setSfxVolume(App.settings.sfxVolume / 100);
        AudioManager.setSfxEnabled(App.settings.sfxEnabled !== false);
        if (App.settings.bgmStyle === 'none' || App.settings.bgmVolume <= 0) {
            AudioManager.stopBgm();
        } else if (!AudioManager.isPlaying || AudioManager.currentBgm !== App.settings.bgmStyle) {
            AudioManager.startBgm(App.settings.bgmStyle);
        }
    }

    function showSettingsModal(returnToIngameMenu = false) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        _settingsTrigger = document.activeElement;
        _settingsReturnToIngameMenu = !!returnToIngameMenu;
        if (_settingsReturnToIngameMenu) {
            document.getElementById('ingame-menu')?.classList.add('hidden');
        }
        modal.classList.remove('hidden');
        requestAnimationFrame(() => document.getElementById('settings-close')?.focus());
    }

    function hideSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.add('hidden');
        // 保存设置
        saveAllSettings();
        if (_settingsReturnToIngameMenu) {
            document.getElementById('ingame-menu')?.classList.remove('hidden');
        }
        if (_settingsTrigger instanceof HTMLElement && _settingsTrigger.isConnected) {
            _settingsTrigger.focus();
        }
        _settingsTrigger = null;
        _settingsReturnToIngameMenu = false;
    }

    /**
     * 保存所有设置
     */
    function saveAllSettings() {
        const prevSettings = Utils.deepClone(_sliderRollbackSettings || App.settings);
        if (_sliderSaveTimer) {
            clearTimeout(_sliderSaveTimer);
            _sliderSaveTimer = null;
        }
        const fields = {
            'player-name': 'playerName',
            'ai-difficulty': 'aiDifficulty',
            'table-theme': 'tableTheme',
            'game-rounds': 'gameRounds',
            'game-speed': 'gameSpeed',

            'opponent-display': 'opponentDisplay',
            'sfx-enabled': 'sfxEnabled',
            'bgm-style': 'bgmStyle',
            'show-tile-names': 'showTileNames',
            'show-shanten': 'showShanten',
            'auto-sort': 'autoSort',
            'bgm-volume': 'bgmVolume',
            'sfx-volume': 'sfxVolume'
        };
        for (const [id, key] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (!el) continue;
            let value = el.value;
            if (el.type === 'checkbox') value = el.checked;
            else if (el.type === 'range') value = parseInt(value);
            else if (value === 'true' || value === 'false') value = value === 'true';
            App.settings[key] = value;
        }
        try {
            const ok = Stats.saveSettings(App.settings);
            if (!ok) {
                restoreSettings(prevSettings);
                _sliderRollbackSettings = null;
                Utils.toast('设置保存失败', 3000, 'error');
                return false;
            }
            // 保存成功后从 Storage 重新加载，确保内存与持久化一致
            App.settings = Utils.deepClone(Stats.getSettings());
            syncSettingsControls(App.settings);
            _sliderRollbackSettings = null;
        } catch (e) {
            restoreSettings(prevSettings);
            _sliderRollbackSettings = null;
            console.error('保存设置失败:', e);
            Utils.toast('设置保存失败', 3000, 'error');
            return false;
        }
        return true;
    }

    /**
     * 显示/隐藏游戏内菜单
     */
    let _wasTimerRunning = false;

    function showIngameMenu() {
        const menu = document.getElementById('ingame-menu');
        if (menu) menu.classList.remove('hidden');
        // 暂停回合计时器，防止玩家在菜单打开时被自动出牌
        _wasTimerRunning = !!(App.engine?.timer);
        App.engine?.stopTimer();
    }

    function hideIngameMenu() {
        const menu = document.getElementById('ingame-menu');
        if (menu) menu.classList.add('hidden');
        // 恢复回合计时器（仅当暂停前计时器在运行、且仍是玩家回合时）
        if (_wasTimerRunning && App.engine && App.engine.state === 'playing') {
            const player = App.engine.players[App.engine.currentPlayerIndex];
            if (player && !player.isAI) {
                App.engine.startTimer();
            }
        }
        _wasTimerRunning = false;
    }
    /**
     * 处理设置变更
     */
    function handleSettingChange(e) {
        const el = e.target;
        // range 由 input 事件统一防抖保存；松手时只试听当前音效音量。
        if (el.type === 'range') {
            if (el.id === 'sfx-volume') AudioManager.SFX.buttonClick();
            return;
        }
        const key = el.id;
        let value = el.value;
        
        if (el.type === 'number') {
            const n = parseInt(value);
            value = isNaN(n) ? 0 : n;
        }
        
        // 映射到settings对象
        const keyMap = {
            'player-name': 'playerName',
            'ai-difficulty': 'aiDifficulty',
            'table-theme': 'tableTheme',
            'game-rounds': 'gameRounds',
            'game-speed': 'gameSpeed',
            'bgm-volume': 'bgmVolume',
            'sfx-volume': 'sfxVolume',
            'sfx-enabled': 'sfxEnabled',
            'bgm-style': 'bgmStyle',

            'opponent-display': 'opponentDisplay',
            'show-tile-names': 'showTileNames',
            'show-shanten': 'showShanten',
            'auto-sort': 'autoSort'
        };
        
        const settingKey = keyMap[key];
        if (settingKey) {
            // checkbox 先解析 boolean，再赋值和保存
            if (el.type === 'checkbox') {
                value = el.checked;
            }
            const prevSettings = Utils.deepClone(App.settings);
            App.settings[settingKey] = value;
            if (key === 'bgm-style' && value !== 'none' && (App.settings.bgmVolume || 0) <= 0) {
                App.settings.bgmVolume = 30;
            }
            let ok = false;
            try {
                ok = Stats.saveSettings(App.settings);
            } catch (e) {
                console.error('保存设置失败:', e);
            }
            if (!ok) {
                restoreSettings(prevSettings);
                Utils.toast('设置保存失败', 3000, 'error');
            } else {
                syncSettingsControls(App.settings);
                // 实时应用某些设置
                if (key === 'player-name') {
                    const selfNameEl = document.getElementById('self-name');
                    if (selfNameEl) selfNameEl.textContent = value || '玩家';
                }
                if (key === 'table-theme') {
                    applyTheme(value);
                }
                if (key === 'sfx-enabled') {
                    const enabled = !!value;
                    AudioManager.setSfxEnabled(enabled);
                    if (enabled) AudioManager.SFX.toggleSwitch();
                }
                if (key === 'bgm-style') {
                    if (value === 'none') {
                        AudioManager.stopBgm();
                    } else {
                        AudioManager.setBgmVolume(App.settings.bgmVolume / 100);
                        AudioManager.startBgm(value);
                    }
                }
                if (key === 'game-speed') {
                    if (typeof updateAnimSpeed === 'function') {
                        updateAnimSpeed(value);
                    }
                }

                if (key === 'auto-sort') {
                    const enabled = !!value;
                    if (App.engine?.players) {
                        App.engine.players.forEach(p => { p.autoSort = enabled; });
                    }
                }
                if (key === 'show-tile-names') {
                    const enabled = !!value;
                    if (App.engine && App.currentScreen === 'game-screen') {
                        const localIndex = App.localPlayerIndex ?? 0;
                        renderPlayerHand(localIndex, App.engine.players[localIndex]?.hand?.length || 0);
                    }
                }
                if (key === 'show-shanten') {
                    updateShantenDisplay(App.localPlayerIndex ?? 0);
                }
                if (key === 'opponent-display' && App.engine && App.currentScreen === 'game-screen') {
                    const localIndex = App.localPlayerIndex ?? 0;
                    App.engine.players.forEach((player, index) => {
                        if (index !== localIndex) renderPlayerHand(index, player.hand?.length || 0);
                    });
                }
            }
        }
    }

    /**
     * 处理滑块输入
     */
    // 滑块保存防抖（避免每帧写入localStorage）
    function handleSliderInput(e) {
        const el = e.target;
        const label = document.getElementById(el.id + '-value');
        if (label) {
            label.textContent = el.value + '%';
        }
        
        // 更新内存中的设置，但延迟保存到localStorage
        const keyMap = {
            'bgm-volume': 'bgmVolume',
            'sfx-volume': 'sfxVolume'
        };
        const settingKey = keyMap[el.id];
        if (!_sliderRollbackSettings) {
            _sliderRollbackSettings = Utils.deepClone(App.settings);
        }
        if (settingKey) {
            App.settings[settingKey] = parseInt(el.value);
            updateSettingsHelp(App.settings);
        }
        
        // 同步音频系统（即时）
        if (el.id === 'bgm-volume') {
            AudioManager.setBgmVolume(parseInt(el.value) / 100);
            const style = App.settings.bgmStyle;
            if (style && style !== 'none' && parseInt(el.value) > 0 && !AudioManager.isPlaying) {
                AudioManager.startBgm(style);
            }
        }
        if (el.id === 'sfx-volume') {
            AudioManager.setSfxVolume(parseInt(el.value) / 100);
        }
        
        // 防抖保存到localStorage
        if (_sliderSaveTimer) clearTimeout(_sliderSaveTimer);
        _sliderSaveTimer = setTimeout(() => {
            _sliderSaveTimer = null;
            try {
                const ok = Stats.saveSettings(App.settings);
                if (!ok) {
                    restoreSettings(_sliderRollbackSettings);
                    Utils.toast('设置保存失败', 3000, 'error');
                } else {
                    App.settings = Utils.deepClone(Stats.getSettings());
                    syncSettingsControls(App.settings);
                }
            } catch (e) {
                restoreSettings(_sliderRollbackSettings);
                console.error('保存设置失败:', e);
                Utils.toast('设置保存失败', 3000, 'error');
            } finally {
                _sliderRollbackSettings = null;
            }
        }, 300);
    }

    /**
     * 应用动画级别
     */
    /**
     * 应用主题
     */
    function applyTheme(theme) {
        const root = document.documentElement;
        
        const themes = {
            'classic-green': {
                '--bg-primary': '#1a3a1a',
                '--bg-secondary': '#2d5a2d',
                '--bg-card': '#3d6b3d',
                '--bg-panel': 'rgba(30, 60, 30, 0.92)',
                '--accent-gold': '#d4a843',
                '--accent-gold-light': '#e8c870',
                '--accent-gold-dark': '#b8922e',
                '--text-primary': '#f0e6d2',
                '--text-secondary': '#c4b896',
                '--text-muted': '#8a9a7a',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(18, 18, 24, 0.92)',
                '--hud-border': 'rgba(212, 168, 67, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(212, 168, 67, 0.15)',
                '--turn-glow': '0 0 16px rgba(212, 168, 67, 0.5)',
                '--shadow-glow': '0 0 20px rgba(212, 168, 67, 0.2)'
            },
            'dark-blue': {
                '--bg-primary': '#1a1a3a',
                '--bg-secondary': '#2d2d5a',
                '--bg-card': '#3d3d6b',
                '--bg-panel': 'rgba(25, 25, 55, 0.92)',
                '--accent-gold': '#6b9ed4',
                '--accent-gold-light': '#8ab8e8',
                '--accent-gold-dark': '#4a7db0',
                '--text-primary': '#e0e8f0',
                '--text-secondary': '#a8b8d0',
                '--text-muted': '#7a8aaa',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(15, 15, 30, 0.92)',
                '--hud-border': 'rgba(107, 158, 212, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(107, 158, 212, 0.15)',
                '--turn-glow': '0 0 16px rgba(107, 158, 212, 0.5)',
                '--shadow-glow': '0 0 20px rgba(107, 158, 212, 0.2)'
            },
            'wood': {
                '--bg-primary': '#3a2a1a',
                '--bg-secondary': '#5a4a2d',
                '--bg-card': '#6b5a3d',
                '--bg-panel': 'rgba(50, 40, 25, 0.92)',
                '--accent-gold': '#c4a86b',
                '--accent-gold-light': '#d8c090',
                '--accent-gold-dark': '#a08850',
                '--text-primary': '#f0e6d2',
                '--text-secondary': '#c8b898',
                '--text-muted': '#9a8a6a',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(25, 20, 15, 0.92)',
                '--hud-border': 'rgba(196, 168, 107, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(196, 168, 107, 0.15)',
                '--turn-glow': '0 0 16px rgba(196, 168, 107, 0.5)',
                '--shadow-glow': '0 0 20px rgba(196, 168, 107, 0.2)'
            },
            'red': {
                '--bg-primary': '#3a1a1a',
                '--bg-secondary': '#5a2d2d',
                '--bg-card': '#6b3d3d',
                '--bg-panel': 'rgba(55, 25, 25, 0.92)',
                '--accent-gold': '#d46b6b',
                '--accent-gold-light': '#e89090',
                '--accent-gold-dark': '#b05050',
                '--text-primary': '#f0e0e0',
                '--text-secondary': '#d0a8a8',
                '--text-muted': '#a07878',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(25, 15, 15, 0.92)',
                '--hud-border': 'rgba(212, 107, 107, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(212, 107, 107, 0.15)',
                '--turn-glow': '0 0 16px rgba(212, 107, 107, 0.5)',
                '--shadow-glow': '0 0 20px rgba(212, 107, 107, 0.2)'
            },
            'amethyst': {
                '--bg-primary': '#2a1a3a',
                '--bg-secondary': '#4a2d5a',
                '--bg-card': '#5a3d6b',
                '--bg-panel': 'rgba(45, 25, 60, 0.92)',
                '--accent-gold': '#c49ee0',
                '--accent-gold-light': '#dab8f0',
                '--accent-gold-dark': '#a070c0',
                '--text-primary': '#f0e8f8',
                '--text-secondary': '#c8b8d8',
                '--text-muted': '#9a88aa',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(25, 18, 35, 0.92)',
                '--hud-border': 'rgba(196, 158, 224, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(196, 158, 224, 0.15)',
                '--turn-glow': '0 0 16px rgba(196, 158, 224, 0.5)',
                '--shadow-glow': '0 0 20px rgba(196, 158, 224, 0.2)'
            },
            'ink': {
                '--bg-primary': '#121214',
                '--bg-secondary': '#1e1e22',
                '--bg-card': '#2a2a30',
                '--bg-panel': 'rgba(20, 20, 25, 0.95)',
                '--accent-gold': '#e0a84a',
                '--accent-gold-light': '#f0c870',
                '--accent-gold-dark': '#c08830',
                '--text-primary': '#e8e4dc',
                '--text-secondary': '#a8a090',
                '--text-muted': '#6a6058',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(15, 15, 18, 0.95)',
                '--hud-border': 'rgba(224, 168, 74, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(224, 168, 74, 0.15)',
                '--turn-glow': '0 0 16px rgba(224, 168, 74, 0.5)',
                '--shadow-glow': '0 0 20px rgba(224, 168, 74, 0.2)'
            },
            'sunset': {
                '--bg-primary': '#3a2010',
                '--bg-secondary': '#5a3820',
                '--bg-card': '#6b4a30',
                '--bg-panel': 'rgba(55, 35, 18, 0.92)',
                '--accent-gold': '#f0a860',
                '--accent-gold-light': '#ffc080',
                '--accent-gold-dark': '#d08040',
                '--text-primary': '#f8ece0',
                '--text-secondary': '#d8c0a0',
                '--text-muted': '#a89070',
                '--win-color': '#4caf50',
                '--lose-color': '#f44336',
                '--hud-bg': 'rgba(35, 22, 12, 0.92)',
                '--hud-border': 'rgba(240, 168, 96, 0.12)',
                '--hud-gold-glow': '0 0 20px rgba(240, 168, 96, 0.15)',
                '--turn-glow': '0 0 16px rgba(240, 168, 96, 0.5)',
                '--shadow-glow': '0 0 20px rgba(240, 168, 96, 0.2)'
            }
        };
        
        const t = themes[theme] || themes['classic-green'];
        for (const [key, value] of Object.entries(t)) {
            root.style.setProperty(key, value);
        }
    }

    /**
     * 重置统计
     */
    function handleResetStats() {
        UIComponents.createModal(
            '重置统计数据',
            '<p>所有战绩、经验与成就进度都将清空。</p><p class="modal-warning">此操作不可恢复。</p>',
            [
                { text: '取消' },
                {
                    text: '确认重置',
                    variant: 'danger',
                    onClick: () => {
                        try {
                            Stats.resetStats();
                            loadStats();
                            Utils.toast('统计数据已重置', 3000, 'success');
                        } catch (e) {
                            console.error('重置统计失败:', e);
                            Utils.toast('重置统计失败', 3000, 'error');
                        }
                    }
                }
            ]
        );
    }
    function loadSettings() {
        App.settings = Utils.deepClone(Stats.getSettings());
        syncSettingsControls(App.settings);
    }
