/**
 * 万能麻将 - 回放播放器模块
 * 从 main.js 拆分（Bug修复轮次13）
 */
    // ===== 回放播放器 =====

    let _replayPlayer = null;

    function openReplayPlayer(replay) {
        if (_replayPlayer) {
            _replayPlayer.destroy();
            _replayPlayer = null;
        }
        _replayPlayer = new ReplayPlayer(replay);
        UIComponents.switchScreen('replay-player');
        _replayPlayer.init();
    }

    class ReplayPlayer {
        constructor(replayData = {}) {
            this.data = replayData && typeof replayData === 'object' && !Array.isArray(replayData) ? replayData : {};
            this.rounds = Array.isArray(this.data.rounds)
                ? this.data.rounds.filter(round => round && typeof round === 'object').map(round => ({
                    ...round,
                    history: Array.isArray(round.history) ? round.history : []
                }))
                : [];
            this.currentRoundIdx = 0;
            this.currentStep = -1;
            this.isPlaying = false;
            this.playTimer = null;
            this.speed = 1;
            this.speeds = [1, 2, 4];
            this.speedIdx = 0;
            this.players = Array.isArray(this.data.players) ? this.data.players : [];
            this.playerStates = [];
            this.discardPile = [];
            this._handlers = {};
        }

        init() {
            this._bindEvents();
            this._updateSpeedControl();
            this._updateHeader();
            if (this.rounds.length > 0) {
                this.loadRound(0);
            } else {
                this._showEmptyState('无回放数据');
            }
        }

        destroy() {
            this.pause();
            if (this.playTimer) { clearTimeout(this.playTimer); this.playTimer = null; }
            this._unbindEvents();
            _replayPlayer = null;
        }

        _bindEvents() {
            this._handlers.back = () => { this.destroy(); UIComponents.switchScreen('replay-list'); };
            this._handlers.playPause = () => { AudioManager.SFX.buttonClick(); if (this.isPlaying) this.pause(); else this.play(); };
            // step 按钮防抖（防止快速连点导致音频spam）
            let _lastStepSfx = 0;
            this._handlers.stepForward = () => {
                const now = Date.now();
                if (now - _lastStepSfx > 100) {
                    _lastStepSfx = now;
                    AudioManager.SFX.buttonClick();
                }
                this.stepForward();
            };
            this._handlers.stepBack = () => {
                const now = Date.now();
                if (now - _lastStepSfx > 100) {
                    _lastStepSfx = now;
                    AudioManager.SFX.buttonClick();
                }
                this.stepBack();
            };
            this._handlers.speed = () => {
                AudioManager.SFX.buttonClick();
                this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
                this.speed = this.speeds[this.speedIdx];
                this._updateSpeedControl();
            };
            this._handlers.progress = (e) => {
                const max = this._getTotalSteps() - 1;
                const val = parseInt(e.target.value);
                if (!Number.isFinite(val) || max <= 0) return;
                this.goToStep(Math.round(val / 100 * max));
            };
            this._handlers.roundPrev = () => { AudioManager.SFX.buttonClick(); if (this.currentRoundIdx > 0) this.loadRound(this.currentRoundIdx - 1); };
            this._handlers.roundNext = () => { AudioManager.SFX.buttonClick(); if (this.currentRoundIdx < this.rounds.length - 1) this.loadRound(this.currentRoundIdx + 1); };

            document.getElementById('replay-back-btn')?.addEventListener('click', this._handlers.back);
            document.getElementById('replay-play-pause')?.addEventListener('click', this._handlers.playPause);
            document.getElementById('replay-step-forward')?.addEventListener('click', this._handlers.stepForward);
            document.getElementById('replay-step-back')?.addEventListener('click', this._handlers.stepBack);
            document.getElementById('replay-speed')?.addEventListener('click', this._handlers.speed);
            document.getElementById('replay-progress')?.addEventListener('input', this._handlers.progress);
            document.getElementById('replay-round-prev')?.addEventListener('click', this._handlers.roundPrev);
            document.getElementById('replay-round-next')?.addEventListener('click', this._handlers.roundNext);
        }

        _updateSpeedControl() {
            const btn = document.getElementById('replay-speed');
            if (!btn) return;
            btn.textContent = this.speed + '×';
            btn.setAttribute('aria-label', `回放速度，当前 ${this.speed} 倍`);
        }

        _updatePlayControl(isPlaying) {
            const btn = document.getElementById('replay-play-pause');
            if (!btn) return;
            const icon = isPlaying ? 'pause' : 'play';
            btn.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#${icon}"></use></svg>`;
            btn.setAttribute('aria-label', isPlaying ? '暂停回放' : '播放回放');
        }

        _unbindEvents() {
            document.getElementById('replay-back-btn')?.removeEventListener('click', this._handlers.back);
            document.getElementById('replay-play-pause')?.removeEventListener('click', this._handlers.playPause);
            document.getElementById('replay-step-forward')?.removeEventListener('click', this._handlers.stepForward);
            document.getElementById('replay-step-back')?.removeEventListener('click', this._handlers.stepBack);
            document.getElementById('replay-speed')?.removeEventListener('click', this._handlers.speed);
            document.getElementById('replay-progress')?.removeEventListener('input', this._handlers.progress);
            document.getElementById('replay-round-prev')?.removeEventListener('click', this._handlers.roundPrev);
            document.getElementById('replay-round-next')?.removeEventListener('click', this._handlers.roundNext);
            this._handlers = {};
        }

        _getTotalSteps() {
            const round = this.rounds[this.currentRoundIdx];
            return round?.history?.length || 0;
        }

        _showEmptyState(message) {
            this.pause();
            this.currentStep = -1;
            this.playerStates = [];
            this.discardPile = [];
            this._resetTable();
            const timeline = document.getElementById('replay-timeline');
            if (timeline) timeline.innerHTML = '';
            const actionText = document.getElementById('replay-action-text');
            if (actionText) actionText.textContent = message;
            const actionSub = document.getElementById('replay-action-sub');
            if (actionSub) actionSub.textContent = '';
            const counter = document.getElementById('replay-step-counter');
            if (counter) counter.textContent = '0 / 0';
            this._updateProgress();
            this._updateControls();
        }

        loadRound(idx) {
            this.pause();
            this.currentRoundIdx = idx;
            this.currentStep = -1;
            this.playerStates = [];
            this.discardPile = [];
            this._updateHeader();
            this._buildTimeline();
            this._resetTable();
            this._updateProgress();
            this._updateControls();

            const round = this.rounds[idx];
            if (round?.history?.length > 0) {
                this.goToStep(0);
            } else {
                this._showEmptyState('本局无动作记录');
            }
        }

        _updateHeader() {
            const typeConfig = Tiles.getConfig(this.data.mahjongType);
            const typeName = typeConfig?.name || this.data.mahjongType || '未知';
            const round = this.rounds[this.currentRoundIdx];
            const winds = ['东', '南', '西', '北'];
            const windName = winds[round?.wind ?? 0] || '东';

            const titleEl = document.getElementById('replay-type-name');
            if (titleEl) titleEl.textContent = typeName;

            const metaEl = document.getElementById('replay-meta');
            if (metaEl) metaEl.textContent = this.rounds.length > 0
                ? `第${this.currentRoundIdx + 1}/${this.rounds.length}局 · ${windName}风圈`
                : '无对局数据';

            const roundLabel = document.getElementById('replay-round-label');
            if (roundLabel) roundLabel.textContent = `局 ${this.rounds.length > 0 ? this.currentRoundIdx + 1 : 0}`;

            const scoresEl = document.getElementById('replay-scores');
            if (scoresEl && Array.isArray(this.data.finalScores)) {
                scoresEl.innerHTML = this.data.finalScores.map(s => {
                    const score = Number.isFinite(Number(s.score)) ? Number(s.score) : 0;
                    return `<span class="score-tag${s.isWin ? ' win' : ''}">${Utils.escapeHtml(s.name)}: ${score}</span>`;
                }).join('');
            } else if (scoresEl) scoresEl.innerHTML = '';

            const roundInfoEl = document.getElementById('replay-round-info');
            if (roundInfoEl) roundInfoEl.textContent = this.rounds.length > 0
                ? `${this.currentRoundIdx + 1}/${this.rounds.length}局`
                : '0/0局';

            const windEl = document.getElementById('replay-wind');
            if (windEl) windEl.textContent = windName;
        }

        _buildTimeline() {
            const container = document.getElementById('replay-timeline');
            if (!container) return;
            container.innerHTML = '';

            const round = this.rounds[this.currentRoundIdx];
            if (!round?.history) return;

            round.history.forEach((item, idx) => {
                const desc = this._describeAction(item);
                const el = document.createElement('button');
                el.type = 'button';
                el.className = 'replay-timeline-item';
                el.dataset.index = idx;
                el.innerHTML = `
                    <span class="step-num">${idx + 1}</span>
                    <span class="step-action">${Utils.escapeHtml(desc.icon)} ${Utils.escapeHtml(desc.text)}</span>
                    <span class="step-player">${Utils.escapeHtml(desc.player || '')}</span>
                `;
                el.addEventListener('click', () => {
                    AudioManager.SFX.buttonClick();
                    this.goToStep(idx);
                });
                container.appendChild(el);
            });
        }

        _describeAction(item) {
            if (!item) return { icon: '', text: '', player: '' };
            const action = item.action;
            const data = item.data || {};

            const nameMap = {};
            for (const p of this.players) {
                if (p.id) nameMap[p.id] = p.name;
                if (p.position !== undefined) nameMap[p.position] = p.name;
            }
            const pid = data.playerId !== undefined ? data.playerId : data.player;
            const playerName = nameMap[pid] || this.players[pid]?.name || pid || '';

            switch (action) {
                case 'gameStart': return { icon: '🎮', text: `第${data.round}局开始`, player: '' };
                case 'draw': return { icon: '🃏', text: '摸牌', player: playerName };
                case 'discard': {
                    const tileName = this._getTileName(data.tile);
                    return { icon: '🎯', text: `打出 ${tileName}`, player: playerName };
                }
                case 'chi': {
                    const tiles = (data.tiles || []).map(t => this._getTileName(t)).join('');
                    return { icon: '🍽', text: `吃 ${tiles}`, player: playerName };
                }
                case 'peng': {
                    const tiles = (data.tiles || []).map(t => this._getTileName(t)).join('');
                    return { icon: '👏', text: `碰 ${tiles}`, player: playerName };
                }
                case 'gang': {
                    const tiles = (data.tiles || []).map(t => this._getTileName(t)).join('');
                    return { icon: '💥', text: `杠 ${tiles}`, player: playerName };
                }
                case 'anGang': {
                    const tiles = (data.tiles || []).map(t => this._getTileName(t)).join('');
                    return { icon: '🕶', text: `暗杠 ${tiles}`, player: playerName };
                }
                case 'jiaGang': {
                    const tileName = this._getTileName(data.meldId);
                    return { icon: '➕', text: `加杠 ${tileName}`, player: playerName };
                }
                case 'hu': {
                    const ziMo = data.isZiMo ? '自摸' : '点炮';
                    const fan = data.fan?.total || 0;
                    return { icon: '🎉', text: `${ziMo}胡牌 ${fan}番`, player: playerName };
                }
                case 'drawGame': return { icon: '🤝', text: '流局', player: '' };
                case 'roundEnd': return { icon: '🏁', text: `第${data.round}局结束`, player: '' };
                default: return { icon: '•', text: action, player: playerName };
            }
        }

        _getTileName(tileIdOrObj) {
            if (!tileIdOrObj) return '?';
            if (typeof tileIdOrObj === 'object') {
                return tileIdOrObj.name || tileIdOrObj.shortName || `${tileIdOrObj.suit}${tileIdOrObj.value}`;
            }
            const tile = this._findTile(tileIdOrObj);
            if (tile) return tile.name || tile.shortName || '?';
            return '?';
        }

        _findTile(tileId) {
            if (!tileId) return null;
            if (typeof tileId === 'object') return tileId;

            for (const p of this.playerStates) {
                for (const t of (p.hand || [])) {
                    if ((t.id || t) === tileId) return t.id ? t : null;
                }
                for (const t of (p.discards || [])) {
                    if ((t.id || t) === tileId) return t.id ? t : null;
                }
                for (const meld of (p.melds || [])) {
                    for (const t of (meld.tiles || meld)) {
                        if ((t.id || t) === tileId) return t.id ? t : null;
                    }
                }
            }

            for (const t of this.discardPile) {
                if ((t.id || t) === tileId) return t.id ? t : null;
            }

            const round = this.rounds[this.currentRoundIdx];
            if (round?.players) {
                for (const p of round.players) {
                    if (p.hand) {
                        for (const t of p.hand) {
                            if ((t.id || t) === tileId) return t.id ? t : null;
                        }
                    }
                    if (p.melds) {
                        for (const meld of p.melds) {
                            for (const t of (meld.tiles || meld)) {
                                if ((t.id || t) === tileId) return t.id ? t : null;
                            }
                        }
                    }
                }
            }

            if (typeof tileId === 'string') {
                const parts = tileId.split('_');
                if (parts.length >= 2) {
                    return Tiles.createTile(parts[0], parseInt(parts[1]), tileId);
                }
            }
            return null;
        }

        _resetTable() {
            const tableEl = document.getElementById('replay-table');
            if (tableEl) {
                tableEl.classList.toggle('three-player', this.players.length === 3);
            }
            const positions = this.players.length === 3
                ? ['left', 'right', 'bottom']
                : ['top', 'left', 'right', 'bottom'];
            positions.forEach(pos => {
                const handEl = document.getElementById(`replay-hand-${pos}`);
                if (handEl) handEl.innerHTML = '';
                const meldsEl = document.getElementById(`replay-melds-${pos}`);
                if (meldsEl) meldsEl.innerHTML = '';
            });
            const discardEl = document.getElementById('replay-discard-pile');
            if (discardEl) discardEl.innerHTML = '';
        }

        goToStep(stepIdx) {
            const round = this.rounds[this.currentRoundIdx];
            if (!round?.history) return;
            if (stepIdx < 0) stepIdx = 0;
            if (stepIdx >= round.history.length) stepIdx = round.history.length - 1;

            this.playerStates = [];
            this.discardPile = [];
            this._resetTable();

            const hasGameStart = round.history.some(h => h.action === 'gameStart');
            if (!hasGameStart && round.players) {
                this.playerStates = round.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    score: p.score ?? 1000,
                    position: p.position ?? 0,
                    hand: [],
                    melds: Array.isArray(p.melds) ? p.melds.map(m => ({...m, tiles: [...(m.tiles || [])]})) : [],
                    discards: [],
                    isHu: p.isHu || false,
                    isDealer: p.isDealer || false
                }));
            }

            for (let i = 0; i <= stepIdx; i++) {
                this._applyStep(round.history[i]);
            }

            this.currentStep = stepIdx;
            this._renderState();
            this._updateUI(stepIdx);
        }

        stepForward() {
            if (this.currentStep < this._getTotalSteps() - 1) {
                this.goToStep(this.currentStep + 1);
            } else if (this.currentRoundIdx < this.rounds.length - 1) {
                this.loadRound(this.currentRoundIdx + 1);
            }
        }

        stepBack() {
            if (this.currentStep > 0) {
                this.goToStep(this.currentStep - 1);
            } else if (this.currentRoundIdx > 0) {
                this.loadRound(this.currentRoundIdx - 1);
                const prevRound = this.rounds[this.currentRoundIdx];
                if (prevRound?.history?.length > 0) {
                    this.goToStep(prevRound.history.length - 1);
                }
            }
        }

        play() {
            if (this.isPlaying) return;
            const total = this._getTotalSteps();
            const atEnd = this.currentRoundIdx >= this.rounds.length - 1 && this.currentStep >= total - 1;
            if (total === 0 || atEnd) return;
            this.isPlaying = true;
            this._updatePlayControl(true);
            this._scheduleNext();
        }

        pause() {
            this.isPlaying = false;
            this._updatePlayControl(false);
            if (this.playTimer) { clearTimeout(this.playTimer); this.playTimer = null; }
            this._updateControls();
        }

        _scheduleNext() {
            if (!this.isPlaying) return;
            const delay = Math.max(200, 1200 / this.speed);
            this.playTimer = setTimeout(() => {
                if (!this.isPlaying) return;
                if (this.currentStep < this._getTotalSteps() - 1) {
                    this.stepForward();
                    const reachedEnd = this.currentRoundIdx >= this.rounds.length - 1 &&
                        this.currentStep >= this._getTotalSteps() - 1;
                    if (reachedEnd) this.pause();
                    else this._scheduleNext();
                } else if (this.currentRoundIdx < this.rounds.length - 1) {
                    this.loadRound(this.currentRoundIdx + 1);
                    this.isPlaying = true;
                    this._updatePlayControl(true);
                    this._scheduleNext();
                } else {
                    this.pause();
                }
            }, delay);
        }

        _applyStep(item) {
            if (!item) return;
            const action = item.action;
            const data = item.data || {};

            const _removeFromHand = (p, tileId) => {
                const idx = p.hand.findIndex(t => (t.id || t) === tileId);
                if (idx >= 0) {
                    const obj = p.hand[idx];
                    p.hand.splice(idx, 1);
                    return obj;
                }
                return tileId;
            };

            switch (action) {
                case 'gameStart': {
                    this.playerStates = (data.players || []).map(p => ({
                        id: p.id,
                        name: p.name,
                        score: p.score ?? 1000,
                        position: p.position ?? 0,
                        hand: Array.isArray(p.hand) ? [...p.hand] : [],
                        melds: Array.isArray(p.melds) ? p.melds.map(m => ({...m, tiles: [...(m.tiles || [])]})) : [],
                        discards: Array.isArray(p.discards) ? [...p.discards] : [],
                        isHu: p.isHu || false,
                        isDealer: p.isDealer || false
                    }));
                    this.discardPile = [];
                    break;
                }
                case 'draw': {
                    const p = this._findPlayerState(data.playerId);
                    if (p && data.tile) {
                        p.hand.push(data.tile);
                    }
                    break;
                }
                case 'discard': {
                    const p = this._findPlayerState(data.playerId);
                    if (p) {
                        const tileObj = _removeFromHand(p, data.tile);
                        this.discardPile.push(tileObj);
                    }
                    break;
                }
                case 'chi':
                case 'peng':
                case 'gang': {
                    const p = this._findPlayerState(data.playerId);
                    if (p) {
                        const meldTiles = [];
                        for (const tileId of (data.tiles || [])) {
                            const obj = _removeFromHand(p, tileId);
                            meldTiles.push(obj);
                        }
                        if (data.from !== undefined && this.discardPile.length > 0) {
                            const lastDiscard = this.discardPile[this.discardPile.length - 1];
                            const lastId = lastDiscard.id || lastDiscard;
                            const consumedId = data.tiles[data.tiles.length - 1];
                            if (lastId === consumedId) {
                                this.discardPile.pop();
                            }
                        }
                        p.melds.push({
                            type: action === 'chi' ? 'sequence' : (action === 'peng' ? 'triplet' : 'gang'),
                            tiles: meldTiles
                        });
                    }
                    break;
                }
                case 'anGang': {
                    const p = this._findPlayerState(data.playerId);
                    if (p) {
                        const meldTiles = [];
                        for (const tileId of (data.tiles || [])) {
                            const obj = _removeFromHand(p, tileId);
                            meldTiles.push(obj);
                        }
                        p.melds.push({ type: 'gang', tiles: meldTiles, isAnGang: true });
                    }
                    break;
                }
                case 'jiaGang': {
                    const p = this._findPlayerState(data.playerId);
                    if (p) {
                        const obj = _removeFromHand(p, data.meldId);
                        for (const meld of p.melds) {
                            const tiles = meld.tiles || [];
                            if (tiles.length === 3 && tiles.some(t => (t.id || t) === data.meldId)) {
                                tiles.push(obj);
                                meld.type = 'gang';
                                meld.isJiaGang = true;
                                break;
                            }
                        }
                    }
                    break;
                }
                case 'hu': {
                    const p = this._findPlayerState(data.playerId);
                    if (p) p.isHu = true;
                    break;
                }
                case 'roundEnd': {
                    if (data.players) {
                        for (const dp of data.players) {
                            const p = this._findPlayerState(dp.id);
                            if (p) p.score = dp.score;
                        }
                    }
                    break;
                }
            }
        }

        _findPlayerState(id) {
            return this.playerStates.find(p => p.id === id);
        }

        _getPositionName(index) {
            const count = this.players.length || 4;
            if (count === 3) {
                return ['bottom', 'left', 'right'][index];
            }
            return ['bottom', 'right', 'top', 'left'][index];
        }

        _renderState() {
            for (let i = 0; i < this.players.length; i++) {
                const state = this.playerStates[i];
                const pos = this._getPositionName(i);

                const handEl = document.getElementById(`replay-hand-${pos}`);
                if (handEl && state?.hand) {
                    handEl.innerHTML = '';
                    for (const t of state.hand) {
                        if (!t) continue;
                        const tile = this._findTile(t.id || t);
                        if (tile) {
                            handEl.appendChild(UIComponents.createTileElement(tile, { small: true }));
                        }
                    }
                }

                const meldsEl = document.getElementById(`replay-melds-${pos}`);
                if (meldsEl && state?.melds) {
                    meldsEl.innerHTML = '';
                    for (const meld of state.melds) {
                        const group = document.createElement('div');
                        group.className = 'meld-group';
                        const tiles = meld.tiles || meld;
                        for (const t of tiles) {
                            if (!t) continue;
                            const tile = this._findTile(t.id || t);
                            if (tile) {
                                group.appendChild(UIComponents.createTileElement(tile, { small: true }));
                            }
                        }
                        meldsEl.appendChild(group);
                    }
                }

                this._updatePlayerInfo(i, state);
            }

            const pileEl = document.getElementById('replay-discard-pile');
            if (pileEl) {
                pileEl.innerHTML = '';
                for (const t of this.discardPile) {
                    const tile = this._findTile(t.id || t);
                    if (tile) {
                        pileEl.appendChild(UIComponents.createTileElement(tile, { small: true }));
                    }
                }
                pileEl.scrollTop = pileEl.scrollHeight;
            }
        }

        _updatePlayerInfo(index, playerData) {
            const pos = this._getPositionName(index);
            const nameEl = document.getElementById(`replay-name-${pos}`);
            const scoreEl = document.getElementById(`replay-score-${pos}`);
            if (nameEl) nameEl.textContent = playerData?.name || `玩家${index + 1}`;
            if (scoreEl) scoreEl.textContent = playerData?.score ?? 1000;
        }

        _updateUI(stepIdx) {
            document.querySelectorAll('.replay-timeline-item').forEach(el => {
                const active = parseInt(el.dataset.index) === stepIdx;
                el.classList.toggle('active', active);
                if (active) el.setAttribute('aria-current', 'step');
                else el.removeAttribute('aria-current');
            });
            const activeItem = document.querySelector(`.replay-timeline-item[data-index="${stepIdx}"]`);
            if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

            const round = this.rounds[this.currentRoundIdx];
            const item = round?.history?.[stepIdx];
            const desc = item ? this._describeAction(item) : { text: '', sub: '' };
            const detailEl = document.getElementById('replay-action-text');
            if (detailEl) detailEl.innerHTML = `${Utils.escapeHtml(desc.icon)} <strong>${Utils.escapeHtml(desc.text)}</strong>`;

            const subEl = document.getElementById('replay-action-sub');
            if (subEl) subEl.textContent = desc.player ? `玩家: ${desc.player}` : '';

            const counter = document.getElementById('replay-step-counter');
            if (counter) counter.textContent = `${stepIdx + 1} / ${this._getTotalSteps()}`;

            this._updateProgress();
            this._updateControls();
        }

        _updateProgress() {
            const total = this._getTotalSteps();
            const val = total > 1 ? Math.round(this.currentStep / (total - 1) * 100) : 0;
            const bar = document.getElementById('replay-progress');
            if (bar) bar.value = val;
        }

        _updateControls() {
            const total = this._getTotalSteps();
            const atStart = this.currentRoundIdx === 0 && this.currentStep <= 0;
            const atEnd = this.currentRoundIdx >= this.rounds.length - 1 && this.currentStep >= total - 1;
            const stepBack = document.getElementById('replay-step-back');
            const stepForward = document.getElementById('replay-step-forward');
            const roundPrev = document.getElementById('replay-round-prev');
            const roundNext = document.getElementById('replay-round-next');
            const playPause = document.getElementById('replay-play-pause');
            const progress = document.getElementById('replay-progress');
            if (stepBack) stepBack.disabled = atStart;
            if (stepForward) stepForward.disabled = atEnd || total === 0;
            if (roundPrev) roundPrev.disabled = this.currentRoundIdx <= 0;
            if (roundNext) roundNext.disabled = this.currentRoundIdx >= this.rounds.length - 1;
            if (playPause) playPause.disabled = total === 0 || atEnd;
            if (progress) progress.disabled = total <= 1;
        }
    }
