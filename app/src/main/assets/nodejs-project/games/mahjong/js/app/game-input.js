/**
 * 万能麻将 - 游戏输入处理模块（牌点击、动作、键盘、触摸）
 * 从 main.js 拆分（架构拆分轮次 2）
 */
    // selectTile SFX 节流（防止快速点击导致音频spam）
    let _lastSelectTileSfxTime = 0;
    function _playSelectTileSfx() {
        const now = Date.now();
        if (now - _lastSelectTileSfxTime > 80) {
            _lastSelectTileSfxTime = now;
            AudioManager.SFX.selectTile();
        }
    }

    function updateTurnGuidance(message, state = 'waiting') {
        const guidance = document.getElementById('turn-guidance');
        if (!guidance) return;
        guidance.textContent = message;
        guidance.dataset.state = state;
    }

    function handleTileClick(tile) {
        if (!App.engine || App.engine.state !== 'playing') return;
        const localIndex = App.localPlayerIndex ?? 0;
        if (App.engine.currentPlayerIndex !== localIndex) return;
        if (App._actionPending) return;
        
        // 限定查询范围到手牌区域，避免选中副露区的牌
        const handEl = document.getElementById('hand-bottom');
        if (!handEl) return;
        const targetEl = handEl.querySelector(`[data-id="${escapeCssSelector(tile.id)}"]`);
        if (!targetEl || targetEl.classList.contains('disabled')) return;
        const selected = handEl.querySelector('.mahjong-tile.selected');
        
        if (selected) {
            const selectedId = selected.dataset.id;
            if (selectedId === tile.id) {
                // 双击或再次点击同一牌：打出
                _doDiscard(tile.id);
                selected.classList.remove('selected');
            } else {
                // 选择另一张牌
                _playSelectTileSfx();
                selected.classList.remove('selected');
                const targetEl = handEl.querySelector(`[data-id="${escapeCssSelector(tile.id)}"]`);
                if (targetEl) targetEl.classList.add('selected');
                updateTurnGuidance(`已选择 ${tile.name || tile.shortName || '这张牌'}，再次点击打出`, 'active');
            }
        } else {
            // 选择牌
            _playSelectTileSfx();
            const targetEl = handEl.querySelector(`[data-id="${escapeCssSelector(tile.id)}"]`);
            if (targetEl) targetEl.classList.add('selected');
            updateTurnGuidance(`已选择 ${tile.name || tile.shortName || '这张牌'}，再次点击打出`, 'active');
        }
    }

    async function _doDiscard(tileId) {
        try {
            if (!App.engine || App.engine.state !== 'playing') return false;
            updateTurnGuidance('已打出，等待其他玩家响应…');
            enablePlayerActions(false);
            if (App.isNetworkGame && App.network && !App.network.isHost) {
                const sent = sendNetworkPlayerAction({ type: 'discard', tileId });
                if (!sent) {
                    updateTurnGuidance('出牌发送失败，请重新选择手牌', 'active');
                    enablePlayerActions(true);
                }
                return sent;
            }
            await App.engine.playerDiscard(tileId);
            return true;
        } catch (e) {
            console.warn('playerDiscard error:', e);
            updateTurnGuidance('出牌失败，请重新选择手牌', 'active');
            enablePlayerActions(true);
            return false;
        }
    }

    function sendNetworkPlayerAction(action) {
        if (!App.network || App.network.isHost) return false;
        const host = (App.network.players || []).find(p => p.isHost);
        if (!host) {
            Utils.toast('未连接到房主，操作发送失败', 3000, 'error');
            return false;
        }
        const sent = App.network.sendTo(host.id, { type: 'playerAction', data: action });
        if (!sent) {
            Utils.toast('操作发送失败，请检查联机连接', 3000, 'error');
        } else {
            disableActionButtons();
            const skipBtn = document.getElementById('btn-skip');
            if (skipBtn) skipBtn.disabled = true;
            enablePlayerActions(false);
            updateTurnGuidance('操作已发送，等待房主确认…');
        }
        return sent;
    }

    /**
     * 处理操作
     */
    // 待处理的选择器 resolve 函数（用于游戏结束时强制关闭）
    const _pendingSelectorResolves = [];

    /**
     * 关闭所有选择器 overlay 并 resolve 挂起的 Promise（防止游戏结束时 Promise 泄漏）
     */
    function closeAllSelectors() {
        const overlay = document.getElementById('tile-selector-overlay');
        if (overlay) overlay.remove();
        while (_pendingSelectorResolves.length) {
            const resolve = _pendingSelectorResolves.pop();
            resolve(null);
        }
    }

    /**
     * 通用牌型选项选择器
     */
    function showTileOptionsSelector(options, titleText, getTilesFn) {
        return new Promise((resolve) => {
            _pendingSelectorResolves.push(resolve);
            const trigger = document.activeElement;
            const overlay = document.createElement('div');
            overlay.id = 'tile-selector-overlay';
            overlay.className = 'modal';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:240;display:flex;align-items:center;justify-content:center;';
            const finishSelector = (value) => {
                if (!overlay.isConnected) return;
                overlay.remove();
                const i = _pendingSelectorResolves.indexOf(resolve);
                if (i >= 0) _pendingSelectorResolves.splice(i, 1);
                if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
                resolve(value);
            };
            overlay._closeModal = () => finishSelector(null);
            
            const panel = document.createElement('div');
            panel.style.cssText = 'background:var(--bg-panel);padding:20px;border-radius:var(--border-radius);border:1px solid rgba(212,168,67,0.3);max-width:90%;';
            
            const title = document.createElement('h3');
            title.id = `tile-selector-title-${Utils.uuid()}`;
            title.textContent = titleText;
            overlay.setAttribute('aria-labelledby', title.id);
            title.style.cssText = 'color:var(--accent-gold);margin-bottom:16px;text-align:center;';
            panel.appendChild(title);
            
            const optionsContainer = document.createElement('div');
            optionsContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
            
            options.forEach((opt, idx) => {
                const row = document.createElement('button');
                row.type = 'button';
                row.setAttribute('aria-label', `${titleText}，选项 ${idx + 1}`);
                row.style.cssText = 'display:flex;width:100%;gap:8px;align-items:center;cursor:pointer;padding:8px 12px;border-radius:8px;border:1px solid transparent;transition:all 0.2s;background:transparent;color:inherit;font:inherit;';
                row.addEventListener('mouseenter', () => {
                    row.style.background = 'rgba(212,168,67,0.1)';
                    row.style.borderColor = 'rgba(212,168,67,0.3)';
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = '';
                    row.style.borderColor = 'transparent';
                });
                row.addEventListener('click', () => {
                    finishSelector(opt);
                });
                
                const tiles = getTilesFn(opt);
                for (const tile of tiles) {
                    const tileEl = UIComponents.createTileElement(tile, { small: true });
                    tileEl.style.cursor = 'pointer';
                    row.appendChild(tileEl);
                }
                
                optionsContainer.appendChild(row);
            });
            
            panel.appendChild(optionsContainer);
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => optionsContainer.querySelector('button')?.focus());
        });
    }

    function showChiOptionsSelector(options) {
        return showTileOptionsSelector(options, '请选择吃的组合', opt => opt);
    }

    function showAnGangOptionsSelector(options) {
        return new Promise((resolve) => {
            _pendingSelectorResolves.push(resolve);
            const trigger = document.activeElement;
            const overlay = document.createElement('div');
            overlay.id = 'tile-selector-overlay';
            overlay.className = 'modal';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:240;display:flex;align-items:center;justify-content:center;';
            const finishSelector = (value) => {
                if (!overlay.isConnected) return;
                overlay.remove();
                const i = _pendingSelectorResolves.indexOf(resolve);
                if (i >= 0) _pendingSelectorResolves.splice(i, 1);
                if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
                resolve(value);
            };
            overlay._closeModal = () => finishSelector(null);
            
            const panel = document.createElement('div');
            panel.style.cssText = 'background:var(--bg-panel);padding:20px;border-radius:var(--border-radius);border:1px solid rgba(212,168,67,0.3);max-width:90%;';
            
            const title = document.createElement('h3');
            title.id = `tile-selector-title-${Utils.uuid()}`;
            title.textContent = '请选择杠的组合';
            overlay.setAttribute('aria-labelledby', title.id);
            title.style.cssText = 'color:var(--accent-gold);margin-bottom:16px;text-align:center;';
            panel.appendChild(title);
            
            const optionsContainer = document.createElement('div');
            optionsContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
            
            options.forEach((opt, optionIndex) => {
                const row = document.createElement('button');
                row.type = 'button';
                row.setAttribute('aria-label', `请选择杠的组合，选项 ${optionIndex + 1}`);
                row.style.cssText = 'display:flex;width:100%;gap:8px;align-items:center;cursor:pointer;padding:8px 12px;border-radius:8px;border:1px solid transparent;transition:all 0.2s;background:transparent;color:inherit;font:inherit;';
                row.addEventListener('mouseenter', () => {
                    row.style.background = 'rgba(212,168,67,0.1)';
                    row.style.borderColor = 'rgba(212,168,67,0.3)';
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = '';
                    row.style.borderColor = 'transparent';
                });
                row.addEventListener('click', () => {
                    finishSelector(opt);
                });
                
                const tiles = opt.type === 'an_gang' ? opt.tiles : (opt.tile ? [opt.tile] : []);
                for (const tile of tiles) {
                    const tileEl = UIComponents.createTileElement(tile, { small: true });
                    tileEl.style.cursor = 'pointer';
                    row.appendChild(tileEl);
                }
                
                if (opt.type === 'jia_gang') {
                    const label = document.createElement('span');
                    label.textContent = '加杠';
                    label.style.cssText = 'color:var(--text-secondary);font-size:0.9rem;';
                    row.appendChild(label);
                }
                
                optionsContainer.appendChild(row);
            });
            
            panel.appendChild(optionsContainer);
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => optionsContainer.querySelector('button')?.focus());
        });
    }

    async function handleAction(type) {
        if (!App.engine) return;
        if (App._actionPending) return;
        App._actionPending = true;
        
        const engine = App.engine;
        const localIndex = App.localPlayerIndex ?? 0;
        const player = engine.players[localIndex];
        if (!player) {
            App._actionPending = false;
            return;
        }
        
        // 辅助：检查引擎是否仍有效且未被替换
        const engineStillValid = () => App.engine === engine && engine.state !== 'destroyed' && engine.state !== 'idle';
        let networkActionFailed = false;
        const sendAction = action => {
            const sent = sendNetworkPlayerAction(action);
            networkActionFailed = !sent;
            return sent;
        };
        const getPendingAction = actionType => {
            const synced = engine.pendingAction?.actions;
            const actions = Array.isArray(synced) && synced.length
                ? synced
                : engine.getSelectableActions?.(player) || [engine.pendingAction?.action];
            return actions.find(action => action?.type === actionType) || null;
        };
        
        try {
        switch (type) {
            case 'chi': {
                const pendingChi = getPendingAction('chi');
                if (pendingChi && engineStillValid()) {
                    const options = pendingChi.options;
                    let actionToExecute = pendingChi;
                    let selectedOptionIndex = 0;
                    if (options && options.length > 1) {
                        const selected = await showChiOptionsSelector(options);
                        if (!engineStillValid() || selected === null) break;
                        selectedOptionIndex = options.indexOf(selected);
                        actionToExecute = { ...pendingChi, selectedOption: selected };
                    }
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'chi', selectedOptionIndex });
                        break;
                    }
                    await engine.executeAction(player, actionToExecute);
                }
                break;
            }
            case 'peng': {
                const pendingPeng = getPendingAction('peng');
                if (pendingPeng && engineStillValid()) {
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'peng' });
                        break;
                    }
                    await engine.executeAction(player, pendingPeng);
                }
                break;
            }
            case 'gang': {
                const pendingGang = getPendingAction('gang');
                if (pendingGang && engineStillValid()) {
                    // 明杠（碰后加杠或别人打出杠）
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'gang' });
                        break;
                    }
                    await engine.executeAction(player, pendingGang);
                } else if (App.anGangOptions && App.anGangOptions.length > 0 && engineStillValid()) {
                    // 暗杠/加杠
                    let option = App.anGangOptions[0];
                    let optionIndex = 0;
                    if (App.anGangOptions.length > 1) {
                        option = await showAnGangOptionsSelector(App.anGangOptions);
                        if (!engineStillValid() || option === null) break;
                        optionIndex = App.anGangOptions.indexOf(option);
                    }
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        if (sendAction({ type: 'gang', optionIndex })) App.anGangOptions = null;
                        break;
                    }
                    await engine.executeAnGang(player, option);
                    App.anGangOptions = null;
                }
                break;
            }
            case 'hu': {
                // 优先检查自摸（仅在当前玩家回合且手牌已包含摸到的牌）
                if (typeof Rules === 'undefined' || !Rules.canWin) {
                    console.error('Rules模块未加载');
                    break;
                }
                const isLocalTurn = engine.currentPlayerIndex === localIndex;
                const selfWin = isLocalTurn ? Rules.canWin(player.hand, engine.ruleConfig) : null;
                const pendingHu = getPendingAction('hu');
                if (selfWin && selfWin.canWin && engineStillValid()) {
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'hu', selfWin: true });
                        break;
                    }
                    await engine.executeAction(player, { type: 'hu', winInfo: selfWin });
                } else if (pendingHu && engine.lastDiscard && engineStillValid()) {
                    // 点炮胡：必须通过pendingAction验证，防止利用过期lastDiscard作弊
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'hu' });
                        break;
                    }
                    await engine.executeAction(player, pendingHu);
                }
                break;
            }
            case 'skip':
                if (engine.pendingAction && engineStillValid()) {
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'skip' });
                        break;
                    }
                    await engine.skipAction();
                } else if (App.anGangOptions) {
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        if (sendAction({ type: 'skip' })) App.anGangOptions = null;
                        break;
                    }
                    // 跳过暗杠，继续打牌
                    App.anGangOptions = null;
                    disableActionButtons();
                    engine.emit('needDiscard', { player: player.toJSON(), index: localIndex });
                } else if (engine.currentPlayerIndex === localIndex && player.hand?.length > (engine.typeConfig?.handSize || 13) && engineStillValid()) {
                    if (App.isNetworkGame && App.network && !App.network.isHost) {
                        sendAction({ type: 'skip' });
                        break;
                    }
                    // 跳过自摸，允许继续打牌
                    engine.emit('needDiscard', { player: player.toJSON(), index: localIndex });
                    // 重新检查暗杠（跳过自摸后可能仍有暗杠选项）
                    if (typeof Rules !== 'undefined' && Rules.canAnGang) {
                        const anGangOptions = Rules.canAnGang(player.hand, player.melds, engine.ruleConfig);
                        if (anGangOptions.length > 0) {
                            App.anGangOptions = anGangOptions;
                            enableActionButtons({ type: 'gang' });
                        }
                    }
                }
                break;
        }
        } catch (e) {
            console.error('handleAction error:', e);
        } finally {
            // 如果 skip 后引擎又提供了新的 pendingAction，不要禁用按钮
            // （engine-events.js 中的 actionAvailable 监听器可能已经启用了新按钮）
            if (!engine.pendingAction && !App.anGangOptions && !networkActionFailed) {
                disableActionButtons();
            }
            App._actionPending = false;
        }
    }

    /**
     * 启用操作按钮（增量模式，允许多个按钮同时启用）
     */
    function enableActionButtons(action) {
        if (!action || !action.type) return;
        const buttonMap = {
            'chi': 'btn-chi',
            'peng': 'btn-peng',
            'gang': 'btn-gang',
            'an_gang': 'btn-gang',
            'hu': 'btn-hu'
        };
        
        const btnId = buttonMap[action.type];
        if (btnId) {
            const btn = document.getElementById(btnId);
            if (btn) btn.disabled = false;
        }
        const skipBtn = document.getElementById('btn-skip');
        if (skipBtn) skipBtn.disabled = false;
        syncActionBarVisibility();
    }

    /**
     * 禁用操作按钮
     */
    function disableActionButtons() {
        ['btn-chi', 'btn-peng', 'btn-gang', 'btn-hu', 'btn-skip'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });
        syncActionBarVisibility();
    }

    function syncActionBarVisibility() {
        const actionBar = document.getElementById('action-bar');
        if (!actionBar) return;
        const hasActions = Boolean(actionBar.querySelector('.action-btn:not(:disabled)'));
        actionBar.classList.toggle('has-actions', hasActions);
        actionBar.setAttribute('aria-hidden', String(!hasActions));
    }

    /**
     * 启用/禁用玩家操作
     */
    function enablePlayerActions(enable) {
        const handEl = document.getElementById('hand-bottom');
        if (!handEl) return;
        
        handEl.querySelectorAll('.mahjong-tile').forEach(tile => {
            tile.classList.toggle('disabled', !enable);
            tile.setAttribute('aria-disabled', String(!enable));
            tile.tabIndex = enable ? 0 : -1;
        });
    }

    /**
     * 键盘事件
     */
    function handleKeydown(e) {
        // 忽略重复按键（长按不连续关闭多层弹窗或触发游戏操作）
        if (e.repeat) return;

        // 模态框键盘行为不依赖当前页面：主菜单设置同样应支持 Esc 和焦点循环。
        const openModal = document.querySelector('.modal:not(.hidden)');
        if (openModal) {
            if (e.key === 'Escape') {
                if (openModal.id === 'settings-modal') hideSettingsModal();
                else if (openModal.id === 'ingame-menu') hideIngameMenu();
                else if (typeof openModal._closeModal === 'function') openModal._closeModal();
                e.preventDefault();
            } else if (e.key === 'Tab') {
                const focusable = [...openModal.querySelectorAll(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )].filter(el => el.getClientRects().length > 0);
                if (focusable.length > 0) {
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        last.focus();
                        e.preventDefault();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            }
            return;
        }

        if (App.currentScreen !== 'game-screen') return;
        if (!App.engine) return;
        
        // 忽略输入法/文本框/下拉框/按钮中的按键
        if (e.key !== 'Escape' && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.isContentEditable)) {
            return;
        }
        
        // 忽略带修饰键的按键（防止阻止Ctrl+S等浏览器快捷键）
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        
        // 如果菜单已打开，ESC关闭菜单
        const menu = document.getElementById('ingame-menu');
        if (menu && !menu.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                hideIngameMenu();
                e.preventDefault();
            }
            return;
        }
        
        switch (e.key) {
            case 'Escape':
                showIngameMenu();
                e.preventDefault();
                break;
            case '1': {
                const btn = document.getElementById('btn-chi');
                if (btn && !btn.disabled) { AudioManager.SFX.buttonClick(); handleAction('chi'); }
                break;
            }
            case '2': {
                const btn = document.getElementById('btn-peng');
                if (btn && !btn.disabled) { AudioManager.SFX.buttonClick(); handleAction('peng'); }
                break;
            }
            case '3': {
                const btn = document.getElementById('btn-gang');
                if (btn && !btn.disabled) { AudioManager.SFX.buttonClick(); handleAction('gang'); }
                break;
            }
            case '4':
            case ' ': {
                e.preventDefault();
                const btn = document.getElementById('btn-hu');
                if (btn && !btn.disabled) { AudioManager.SFX.buttonClick(); handleAction('hu'); }
                break;
            }
            case 's':
            case 'S': {
                e.preventDefault();
                const skipBtn = document.getElementById('btn-skip');
                if (skipBtn && !skipBtn.disabled) { AudioManager.SFX.buttonClick(); handleAction('skip'); }
                break;
            }
        }
    }

    /**
     * 触摸手势
     */
    function initTouchGestures() {
        let touchStartY = 0;
        
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length === 0) return;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 0) return;
            const touchEndY = e.changedTouches[0].clientY;
            const diff = touchStartY - touchEndY;
            
            // 上滑显示菜单（modal 打开时不触发）
            if (diff > 100 && App.currentScreen === 'game-screen' && !document.querySelector('.modal:not(.hidden)')) {
                showIngameMenu();
            }
            touchStartY = 0;
        }, { passive: true });
        
        document.addEventListener('touchcancel', () => {
            touchStartY = 0;
        }, { passive: true });
    }

    // 通过事件总线订阅牌交互事件（消除 game-renderer.js 的反向依赖）
    AppEventBus.on('tile:click', handleTileClick);
    AppEventBus.on('tile:dragend', (tile) => {
        if (!App.engine || App.engine.state !== 'playing') return;
        const localIndex = App.localPlayerIndex ?? 0;
        if (App.engine.currentPlayerIndex !== localIndex) return;
        _doDiscard(tile.id);
    });
