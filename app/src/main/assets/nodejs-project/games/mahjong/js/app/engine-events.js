/**
 * 万能麻将 - 引擎事件绑定模块
 * 从 main.js 拆分（架构拆分轮次 2）
 */
    
    /**
     * 计算玩家相对方向（上家/对家/下家）
     */
    function _getRelativeDir(playerPos, fromPos, playerCount) {
        if (fromPos === undefined || fromPos === null) return '';
        const count = playerCount || App.engine?.config?.playerCount || 4;
        const diff = (fromPos - playerPos + count) % count;
        if (count === 3) {
            if (diff === 1) return '下家';
            if (diff === 2) return '上家';
        } else {
            if (diff === 1) return '下家';
            if (diff === 2) return '对家';
            if (diff === 3) return '上家';
        }
        return '';
    }
    
    function bindEngineEvents() {
        const engine = App.engine;
        if (!engine) return;
        // 防止对同一引擎重复绑定
        if (engine._eventsBound) return;
        engine._eventsBound = true;
        
        // 回合倒计时 UI 管理
        let _turnTimerInterval = null;
        function startTurnTimerUI(timeout = engine.turnTimeout) {
            stopTurnTimerUI();
            const display = document.getElementById('turn-timer-display');
            const valueEl = document.getElementById('turn-timer-value');
            if (!display || !valueEl) return;
            const timeoutSec = Math.max(1, Math.ceil((timeout || 30000) / 1000));
            let remaining = timeoutSec;
            valueEl.textContent = remaining;
            display.classList.remove('hidden');
            _turnTimerInterval = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    stopTurnTimerUI();
                    return;
                }
                if (valueEl) valueEl.textContent = remaining;
                if (remaining <= 5 && display) display.classList.add('urgent');
            }, 1000);
        }
        function stopTurnTimerUI() {
            if (_turnTimerInterval) {
                clearInterval(_turnTimerInterval);
                _turnTimerInterval = null;
            }
            const display = document.getElementById('turn-timer-display');
            if (display) {
                display.classList.add('hidden');
                display.classList.remove('urgent');
            }
        }

        engine.on('timerStart', data => startTurnTimerUI(data?.timeout));
        engine.on('timerStop', stopTurnTimerUI);
        
        engine.on('beforeDestroy', () => {
            stopTurnTimerUI();
            closeAllSelectors();
        });
        
        engine.on('gameStart', (data) => {
            AppEventBus.emit('engine:gameStart', data);
            renderGameState();
            disableActionButtons();
            updateTurnGuidance('准备开局…');
            if (engine.ruleConfig?.allowChi === false) {
                Utils.toast('当前规则不可吃牌，只可碰、杠或胡', 4500, 'warning');
            }
            AudioManager.SFX.gameStart();
        });
        
        engine.on('tileDealt', (data) => {
            AppEventBus.emit('engine:tileDealt', data);
            // 只更新牌堆计数，不发牌动画到DOM（避免与tilesDealed的renderGameState竞态）
            updateDeckCount(data.deckCount);
        });
        
        engine.on('tilesDealt', () => {
            AppEventBus.emit('engine:tilesDealt');
            renderGameState();
        });
        
        engine.on('turnStart', (data) => {
            AppEventBus.emit('engine:turnStart', data);
            updatePlayerHighlight(data.index);
            
            const localIndex = App.localPlayerIndex ?? 0;
            if (data.index === localIndex) {
                updateTurnGuidance('正在摸牌…');
                updateShantenDisplay(localIndex);
                // 本地玩家回合：摸牌
                engine.playerDraw().then((result) => {
                    // 防御引擎被销毁或替换的竞态
                    if (!App.engine || App.engine !== engine || engine.state !== 'playing') {
                        return;
                    }
                    if (!result || !result.ziMo) {
                        enablePlayerActions(true);
                        updateTurnGuidance('选择一张手牌，再次点击打出', 'active');
                        engine.startTimer();
                    }
                    // 联机模式：广播状态
                    if (App.isNetworkGame) broadcastGameState();
                }).catch(err => {
                    console.warn('playerDraw error:', err);
                });
            } else if (App.isNetworkGame && App.network?.isHost) {
                updateTurnGuidance(`等待 ${data.player?.name || '其他玩家'} 出牌`);
                // 房主权威模式：远程玩家的摸牌也由房主引擎执行，再同步给对应访客。
                engine.playerDraw().then(() => {
                    if (!App.engine || App.engine !== engine || engine.state !== 'playing') {
                        return;
                    }
                    engine.startTimer();
                    broadcastGameState(true);
                }).catch(err => {
                    console.warn('remote playerDraw error:', err);
                });
            } else if (App.isNetworkGame) {
                updateTurnGuidance(`等待 ${data.player?.name || '其他玩家'} 出牌`);
                // 联机模式下远程AI回合：广播状态让远程玩家可以观看
                broadcastGameState();
            } else {
                updateTurnGuidance(`${data.player?.name || '电脑玩家'} 正在思考…`, 'thinking');
            }
        });
        
        // 摸牌只提示本家；电脑落牌使用更轻的独立反馈，保持回合节奏。
        const _isHumanPlayer = (pos) => pos === 0 || App.isNetworkGame;
        
        engine.on('draw', (data) => {
            AppEventBus.emit('engine:draw', data);
            if (!data || !data.player) return;
            renderPlayerHand(data.index, data.player.handSize, true, data.tile?.id);
            updateShantenDisplay(App.localPlayerIndex ?? 0);
            updateDeckCount(data.deckCount);
            if (_isHumanPlayer(data.player.position)) {
                AudioManager.SFX.draw(data.tile);
            }
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('discard', (data) => {
            AppEventBus.emit('engine:discard', data);
            stopTurnTimerUI();
            if (!data || !data.player) return;
            updateTurnGuidance('等待其他玩家响应…');
            requestAnimationFrame(() => {
                renderDiscardPile(true);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            if (_isHumanPlayer(data.player.position)) {
                AudioManager.SFX.discard(data.tile);
            } else {
                AudioManager.SFX.opponentDiscard(data.tile);
            }
            if (App.isNetworkGame) broadcastGameState();
        });
        
        // tick SFX 防重复（多个 actionAvailable 快速触发时只播放一次）
        let _lastTickTime = 0;
        engine.on('actionAvailable', (data) => {
            AppEventBus.emit('engine:actionAvailable', data);
            if (!data || !data.player) return;
            if (data.player.position === (App.localPlayerIndex ?? 0)) {
                disableActionButtons();
                const actions = Array.isArray(data.actions) && data.actions.length ? data.actions : [data.action];
                actions.forEach(enableActionButtons);
                updateTurnGuidance('请选择可用操作，或点击“过”继续', 'action');
                const now = Date.now();
                if (now - _lastTickTime > 400) {
                    _lastTickTime = now;
                    AudioManager.SFX.tick();
                }
            }
            if (App.isNetworkGame && App.network?.isHost) broadcastGameState(true);
        });
        
        engine.on('chi', (data) => {
            AppEventBus.emit('engine:chi', data);
            if (!data || !data.player) return;
            const dir = _getRelativeDir(data.player.position, data.from);
            const text = dir ? `吃${dir}` : '吃';
            UIComponents.showActionEffect(text);
            requestAnimationFrame(() => {
                renderDiscardPile();
                renderPlayerMelds(data.player.position);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            AudioManager.SFX.chi();
            UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 8, color: '#4caf50' });
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('peng', (data) => {
            AppEventBus.emit('engine:peng', data);
            if (!data || !data.player) return;
            const dir = _getRelativeDir(data.player.position, data.from);
            const text = dir ? `碰${dir}` : '碰';
            UIComponents.showActionEffect(text);
            requestAnimationFrame(() => {
                renderDiscardPile();
                renderPlayerMelds(data.player.position);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            AudioManager.SFX.peng();
            UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 12, color: '#2196f3' });
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('gang', (data) => {
            AppEventBus.emit('engine:gang', data);
            stopTurnTimerUI();
            if (!data || !data.player) return;
            const dir = _getRelativeDir(data.player.position, data.from);
            const text = dir ? `杠${dir}` : '杠';
            UIComponents.showActionEffect(text);
            requestAnimationFrame(() => {
                renderDiscardPile();
                renderPlayerMelds(data.player.position);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            AudioManager.SFX.gang();
            UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 30, color: '#ff9800', spread: 180, duration: 1200, type: 'star' });
            UIComponents.screenShake(5, 300);
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('anGang', (data) => {
            AppEventBus.emit('engine:anGang', data);
            stopTurnTimerUI();
            if (!data || !data.player) return;
            UIComponents.showActionEffect('暗杠');
            requestAnimationFrame(() => {
                renderPlayerMelds(data.player.position);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            AudioManager.SFX.anGang();
            UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 16, color: '#9c27b0', spread: 120 });
            if (App.isNetworkGame) broadcastGameState();
        });

        engine.on('jiaGang', (data) => {
            AppEventBus.emit('engine:jiaGang', data);
            stopTurnTimerUI();
            if (!data || !data.player) return;
            UIComponents.showActionEffect('加杠');
            requestAnimationFrame(() => {
                renderPlayerMelds(data.player.position);
                renderPlayerHand(data.player.position, data.player.handSize);
            });
            AudioManager.SFX.gang();
            UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, {
                count: 20,
                color: '#ff9800',
                spread: 150
            });
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('hu', (data) => {
            AppEventBus.emit('engine:hu', data);
            stopTurnTimerUI();
            if (!data || !data.player) return;
            let effectText;
            if (data.isGangShangKaiHua) {
                effectText = '杠上开花';
            } else if (data.isZiMo) {
                effectText = '自摸';
            } else {
                const dir = _getRelativeDir(data.player.position, data.from);
                effectText = dir ? `胡${dir}` : '胡';
            }
            UIComponents.showActionEffect(effectText);
            showHuResult(data);
            UIComponents.showWinEffect(data.isZiMo);
            
            if (data.isZiMo) {
                AudioManager.SFX.ziMo();
                UIComponents.createConfetti({ count: 80 });
                UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 40, color: '#d4a843', spread: 250, duration: 1500, type: 'star' });
                UIComponents.screenShake(8, 600);
            } else {
                AudioManager.SFX.hu();
                UIComponents.createParticles(window.innerWidth / 2, window.innerHeight / 2, { count: 40, color: '#d4a843', spread: 220, duration: 1400, type: 'star' });
                UIComponents.screenShake(6, 400);
            }
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('gameEnd', (data) => {
            AppEventBus.emit('engine:gameEnd', data);
            stopTurnTimerUI();
            closeAllSelectors();
            // 先保存再显示，确保结算页展示的经验值与实际获得一致
            const saveResult = saveGameResult(data);
            showGameResult(data, saveResult);
            const localPosition = App.localPlayerIndex ?? 0;
            AudioManager.SFX.gameEnd(data.winner?.position === localPosition);
            if (App.isNetworkGame && App.network?.isHost && typeof broadcastGameResult === 'function') {
                broadcastGameResult(data);
            }
            AudioManager.stopBgm();
            App.isNetworkGame = false;
        });
        
        engine.on('drawGame', (data) => {
            AppEventBus.emit('engine:drawGame', data);
            stopTurnTimerUI();
            closeAllSelectors();
            Utils.toast('流局', 3000, 'warning');
            AudioManager.SFX.drawGame();
            if (App.isNetworkGame) broadcastGameState();
        });
        
        engine.on('ziMo', (data) => {
            AppEventBus.emit('engine:ziMo', data);
            if (!data || !data.player) return;
            if (data.player.position === (App.localPlayerIndex ?? 0)) {
                enableActionButtons({ type: 'hu' });
                updateTurnGuidance('可以胡牌，也可以点击“过”继续', 'action');
            }
        });
        
        engine.on('anGangOptions', (data) => {
            AppEventBus.emit('engine:anGangOptions', data);
            if (!data || !data.player) return;
            if (data.player.position === (App.localPlayerIndex ?? 0)) {
                App.anGangOptions = data.options;
                enableActionButtons({ type: 'gang' });
                updateTurnGuidance('可以杠牌，也可以点击“过”继续', 'action');
            }
        });
        
        engine.on('needDiscard', (data) => {
            AppEventBus.emit('engine:needDiscard', data);
            if (data.index === (App.localPlayerIndex ?? 0)) {
                // 防御引擎被销毁的竞态
                if (!App.engine || App.engine !== engine || engine.state !== 'playing') {
                    return;
                }
                enablePlayerActions(true);
                updateTurnGuidance('选择一张手牌，再次点击打出', 'active');
                Utils.toast('请打出一张牌', 3000, 'warning');
                engine.startTimer();
            }
        });
        
        engine.on('turnTimeout', () => {
            AppEventBus.emit('engine:turnTimeout');
            stopTurnTimerUI();
            Utils.toast('回合超时，自动打牌', 3000, 'warning');
            AudioManager.SFX.warning();
        });
        
        engine.on('queYiMenSelected', (data) => {
            AppEventBus.emit('engine:queYiMenSelected', data);
            if (!data || !data.player) return;
            const suitNames = { wan: '万', tong: '筒', tiao: '条' };
            Utils.toast(`${data.player.name} 缺${suitNames[data.suit] || ''}`);
        });
        
        engine.on('invalidHu', (data) => {
            AppEventBus.emit('engine:invalidHu', data);
            if (data.reason === 'queYiMenNotComplete') {
                Utils.toast('胡牌失败：缺门花色未打完！', 3000, 'error');
                AudioManager.SFX.warning();
            }
        });
        
        engine.on('roundEnd', (data) => {
            AppEventBus.emit('engine:roundEnd', data);
            stopTurnTimerUI();
            closeAllSelectors();
            // 更新所有玩家分数显示
            if (!data || !data.players || data.players.length === 0) return;
            const playerCount = engine.config?.playerCount || 4;
            for (let i = 0; i < playerCount; i++) {
                const p = data.players[i];
                if (p) updatePlayerScore(i, p.score);
            }
            if (App.isNetworkGame) broadcastGameState();
        });
        
    }
