/**
 * 万能麻将 - 主入口
 */

(function() {
    'use strict';

    // 全局状态
    const App = {
        engine: null,
        settings: null,
        stats: null,
        currentScreen: 'main-menu',
        network: null,
        localPlayerIndex: 0,
        anGangOptions: null,
        networkServerReachable: false
    };

    // 初始化
    function init() {
        loadSettings();
        loadStats();
        bindEvents();
        renderMahjongTypes();
        renderAchievements();
        renderReplays();
        
        // 初始化主题
        applyTheme(App.settings.tableTheme);
        // 初始化动画速度
        updateAnimSpeed(App.settings.gameSpeed);
        
        // 初始化音频系统（BGM 默认关闭，可在设置中开启）
        AudioManager.setupUserInteraction();
        AudioManager.setBgmVolume((App.settings.bgmVolume || 0) / 100);
        AudioManager.setSfxVolume(App.settings.sfxVolume / 100);
        AudioManager.setSfxEnabled(App.settings.sfxEnabled !== false);
        startConfiguredBgm();
        
        // 初始化已完成后快速收起加载画面，避免每次启动都强制等待。
        setTimeout(() => {
            const loading = document.getElementById('loading-screen');
            if (loading) {
                loading.classList.add('hidden');
                setTimeout(() => loading.remove(), 250);
            }
        }, 350);
        
        // 显示主菜单
        UIComponents.switchScreen('main-menu');
        
        console.log('🀄 万能麻将已加载');
        
        // 页面卸载前保存设置和统计（防止 slider 防抖丢失、统计数据未写）
        window.addEventListener('beforeunload', () => {
            if (App.settings) {
                try { Storage.set('settings', App.settings); } catch (e) {}
            }
        });
    }
    function loadStats() {
        App.stats = Stats.getStats();
        UIComponents.updateStatsPanel(App.stats);
    }

    // 核心游戏启动
    async function startGame(config) {
        // 清理旧游戏（先取消可能存在的退场动画，防止竞态销毁新引擎）
        if (App._endGameTimeout) {
            clearTimeout(App._endGameTimeout);
            App._endGameTimeout = null;
        }
        if (App.engine) {
            App.engine.destroy();
        }
        AudioManager.stopAllSfx();
        startConfiguredBgm();
        
        // 创建引擎
        App.engine = new MahjongEngine(config);
        App.localPlayerIndex = 0;
        
        // 初始化玩家
        const playerConfigs = [
            { name: App.settings.playerName || '玩家', isAI: false }
        ];
        
        for (let i = 1; i < config.playerCount; i++) {
            const diffName = { easy: '简', normal: '普', expert: '难' }[config.aiDifficulty] || '电脑';
            const name = config.playerCount === 3 
                ? ['下', '上'][i - 1]
                : ['下', '对', '上'][i - 1];
            playerConfigs.push({ 
                name: `${diffName}${name || '家'}`,
                isAI: true 
            });
        }
        
        App.engine.initPlayers(playerConfigs);
        
        // 绑定引擎事件
        bindEngineEvents();
        
        // 切换到游戏界面（带过渡）
        UIComponents.switchScreen('game-screen');
        App.currentScreen = 'game-screen';
        
        // 更新玩家名称显示
        const selfNameEl = document.getElementById('self-name');
        if (selfNameEl) selfNameEl.textContent = App.settings.playerName || '玩家';
        
        // 根据人数调整座位布局 + 牌桌入场动画
        const table = document.getElementById('game-table');
        if (table) {
            table.classList.toggle('three-player', config.playerCount === 3);
            table.style.opacity = '0';
            table.style.transform = 'scale(0.9) rotateX(10deg)';
            if (App._tableEnterTimeout) clearTimeout(App._tableEnterTimeout);
            App._tableEnterTimeout = setTimeout(() => {
                App._tableEnterTimeout = null;
                table.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
                table.style.opacity = '1';
                table.style.transform = '';
            }, 100);
        }
        
        // 开始游戏
        try {
            await App.engine.start();
        } catch (e) {
            if (e?.message === 'CANCELLED') {
                console.log('游戏启动被取消');
                return;
            }
            console.error('游戏启动失败:', e);
            Utils.toast('游戏启动失败，请返回主菜单重试', 3000, 'error');
            if (App.engine) {
                App.engine.destroy();
                App.engine = null;
            }
        }
    }

    // 根据游戏速度更新CSS动画倍率
    function updateAnimSpeed(speed) {
        const scale = speed === 'instant' ? 0.01 : (speed === 'fast' ? 0.5 : 1);
        document.documentElement.style.setProperty('--anim-speed', String(scale));
    }

    function startConfiguredBgm() {
        const style = App.settings?.bgmStyle;
        const volume = App.settings?.bgmVolume || 0;
        if (!style || style === 'none' || volume <= 0) {
            AudioManager.stopBgm();
            return;
        }
        AudioManager.setBgmVolume(volume / 100);
        if (!AudioManager.isPlaying || AudioManager.currentBgm !== style) {
            AudioManager.startBgm(style);
        }
    }
    window.updateAnimSpeed = updateAnimSpeed;
    window.startConfiguredBgm = startConfiguredBgm;

    // 暴露全局引用供拆分模块使用
    window.App = App;
    window.startGame = startGame;
    window.loadStats = loadStats;

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
