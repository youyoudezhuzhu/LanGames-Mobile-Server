/**
 * 万能麻将 - 菜单导航与游戏启动快捷方式模块
 * 从 main.js 拆分（架构拆分轮次 2）
 */
    function handleMenuClick(e) {
        AudioManager.SFX.buttonClick();
        const btn = e.currentTarget;
        const mode = btn.dataset.mode;
        
        switch (mode) {
            case 'ai':
                App.currentScreen = 'game-screen';
                startAIGame();
                break;
            case 'lan':
                App.currentScreen = 'network-lobby';
                UIComponents.switchScreen('network-lobby');
                initNetwork();
                break;
            case 'custom':
                App.currentScreen = 'custom-mode';
                UIComponents.switchScreen('custom-mode');
                break;
            case 'replay':
                App.currentScreen = 'replay-list';
                UIComponents.switchScreen('replay-list');
                break;
            case 'achievements':
                App.currentScreen = 'achievements';
                UIComponents.switchScreen('achievements');
                break;
            case 'stats':
                App.currentScreen = 'stats-page';
                UIComponents.switchScreen('stats-page');
                renderStatsPage();
                break;
        }
    }

    /**
     * 开始AI对战
     */
    async function startAIGame() {
        const mahjongType = App.settings.mahjongType || 'guangdong';
        const typeConfig = Tiles.getConfig(mahjongType);
        const config = {
            mahjongType: mahjongType,
            playerCount: typeConfig?.playerCount || 4,
            aiDifficulty: App.settings.aiDifficulty,
            speed: App.settings.gameSpeed,
            maxRounds: Math.max(1, parseInt(App.settings.gameRounds) || 4),
            autoSort: App.settings.autoSort !== false
        };
        
        try {
            await startGame(config);
        } catch (e) {
            console.error('startQuickGame error:', e);
            Utils.toast('游戏启动失败', 3000, 'error');
        }
    }

    /**
     * 开始自定义游戏
     */
    async function startCustomGame() {
        const selectedType = document.querySelector('.mahjong-type-card.selected');
        if (!selectedType) {
            Utils.toast('请先选择一种麻将', 3000, 'warning');
            return;
        }
        
        const type = selectedType.dataset.type;
        const typeConfig = Tiles.getConfig(type);
        if (!typeConfig) {
            Utils.toast('无效的麻将种类', 3000, 'error');
            return;
        }
        const config = {
            mahjongType: type,
            playerCount: typeConfig.playerCount,
            aiDifficulty: App.settings.aiDifficulty,
            speed: App.settings.gameSpeed,
            maxRounds: Math.max(1, parseInt(App.settings.gameRounds) || 4),
            autoSort: App.settings.autoSort !== false
        };
        
        try {
            await startGame(config);
        } catch (e) {
            console.error('startCustomGame error:', e);
            Utils.toast('游戏启动失败', 3000, 'error');
        }
    }

    /**
     * 开始游戏
     */
    function renderMahjongTypes() {
        const container = document.getElementById('mahjong-types');
        if (!container) return;
        
        container.innerHTML = '';
        const types = Tiles.getMahjongTypes();
        
        for (const type of types) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'mahjong-type-card';
            card.dataset.type = type.key;
            card.setAttribute('aria-pressed', 'false');
            card.innerHTML = `
                <div class="type-icon">${Utils.escapeHtml(type.icon)}</div>
                <div class="type-name">${Utils.escapeHtml(type.name)}</div>
                <div class="type-desc">${Utils.escapeHtml(type.desc)}</div>
            `;
            
            card.addEventListener('click', () => {
                AudioManager.SFX.buttonClick();
                container.querySelectorAll('.mahjong-type-card').forEach(c => {
                    c.classList.remove('selected');
                    c.setAttribute('aria-pressed', 'false');
                });
                card.classList.add('selected');
                card.setAttribute('aria-pressed', 'true');
                renderRuleOptions(type.key);
            });
            
            container.appendChild(card);
        }
    }

    /**
     * 渲染规则选项
     */
    function renderRuleOptions(mahjongType) {
        const container = document.getElementById('rule-options');
        if (!container) return;
        
        const config = Tiles.getConfig(mahjongType);
        if (!config || !config.rules) {
            container.innerHTML = '';
            return;
        }
        
        const rules = config.rules;
        const ruleLabels = {
            allowChi: '允许吃牌（仅限上家）',
            allowPeng: '允许碰牌',
            allowGang: '允许杠牌',
            allowAnGang: '允许暗杠',
            huaPai: '花牌计番',
            gangShangKaiHua: '杠上开花',
            qiangGang: '抢杠',
            haiDiLaoYue: '海底捞月',
            queYiMen: '缺一门',
            xueZhanDaoDi: '血战到底',
            ziMoJiaFan: '自摸加番',
            hunPai: '混儿牌',
            menQing: '门清',
            baoPai: '宝牌',
            maPai: '马牌',
            taiJi: '连庄',
            caiShen: '财神牌',
            zhaNiao: '扎鸟',
            jiangJiangHu: '将将胡',
            qiDui: '七对',
            huiEr: '带会儿',
            piaoHu: '飘胡',
            daPiao: '大飘',
            kaiKouFan: '开口翻',
            piHu: '屁胡',
            jinPai: '金牌',
            qiangJin: '抢金',
            jingPai: '精牌',
            chongGuan: '冲关',
            hongZhongLaiZi: '红中赖子'
        };
        
        container.innerHTML = '';
        
        for (const [key, value] of Object.entries(rules)) {
            if (typeof value !== 'boolean') continue;
            
            const label = ruleLabels[key] || key;
            const div = document.createElement('div');
            div.className = 'rule-option';
            div.innerHTML = `
                <span>${label}</span>
                <span style="color:${value ? 'var(--win-color)' : 'var(--text-muted)'}">${value ? '✓ 开启' : '✗ 关闭'}</span>
            `;
            container.appendChild(div);
        }
    }
