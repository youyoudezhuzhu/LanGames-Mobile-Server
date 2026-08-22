/**
 * 万能麻将 - UI组件（动画增强版）
 */

const UIComponents = (function() {
    'use strict';

    /**
     * 创建麻将牌DOM元素（真实大号牌面版）
     */
    function createTileElement(tile, options = {}) {
        if (!tile) return document.createElement('div');
        const div = document.createElement('div');
        div.className = `mahjong-tile suit-${tile.suit || 'unknown'}`;
        if (tile.id) div.dataset.id = tile.id;
        if (tile.suit) div.dataset.suit = tile.suit;
        if (tile.value) div.dataset.value = tile.value;
        
        if (options.faceDown) {
            div.classList.add('back');
        } else {
            const face = document.createElement('span');
            face.className = 'tile-face';
            face.textContent = tile.unicode || '?';
            div.appendChild(face);
            if (tile.name) div.title = tile.name;
            
            // 显示牌名
            if (options.showName && tile.name) {
                const nameLabel = document.createElement('span');
                nameLabel.className = 'tile-name-label';
                nameLabel.textContent = tile.name;
                div.appendChild(nameLabel);
            }
            
            // 添加牌面装饰线（真实麻将牌特征）
            const decoTop = document.createElement('div');
            decoTop.className = 'tile-deco tile-deco-top';
            div.appendChild(decoTop);
            
            const decoBottom = document.createElement('div');
            decoBottom.className = 'tile-deco tile-deco-bottom';
            div.appendChild(decoBottom);
        }
        
        if (options.selectable || options.onClick) {
            const activate = () => {
                if (div.getAttribute('aria-disabled') === 'true') return;
                if (options.selectable) div.classList.toggle('selected');
                if (options.onClick) options.onClick(tile);
            };
            div.setAttribute('role', 'button');
            div.setAttribute('tabindex', '0');
            div.setAttribute('aria-label', tile.name || tile.shortName || '麻将牌');
            div.addEventListener('click', activate);
            div.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                activate();
            });
        }
        
        if (options.small) {
            div.classList.add('tile-small');
        }
        
        // 添加拖拽支持
        if (options.draggable) {
            div._cleanupDrag = setupDrag(div, tile, options.onDragEnd);
        }
        
        return div;
    }

    /**
     * 设置拖拽
     */
    function setupDrag(element, tile, onDragEnd) {
        let isDragging = false;
        let startX, startY;
        let clone = null;
        let isListening = false;
        
        element.addEventListener('mousedown', startDrag);
        element.addEventListener('touchstart', startDrag, { passive: false });
        
        function startDrag(e) {
            if (element.classList.contains('back')) return;
            
            // 防止重复注册 document-level 监听器（快速连点/多指触摸）
            if (isListening) {
                onEnd(e);
            }
            
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            isDragging = false;
            startX = clientX;
            startY = clientY;
            isListening = true;
            
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
            document.addEventListener('touchcancel', onEnd);
        }
        
        // 缓存元素尺寸，避免拖拽时的强制同步布局
        let cachedWidth = 0, cachedHeight = 0;
        
        function onMove(e) {
            if (isDragging) e.preventDefault();
            const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
            const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
            
            const dx = clientX - startX;
            const dy = clientY - startY;
            
            if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                isDragging = true;
                e.preventDefault(); // 只在真正开始拖拽时阻止默认行为（避免页面滚动）
                element.classList.add('drag-source');
                
                clone = element.cloneNode(true);
                clone.classList.add('dragging');
                // 在布局稳定时缓存尺寸，避免拖拽时读取offsetWidth/offsetHeight导致的强制同步布局
                cachedWidth = element.offsetWidth || 50;
                cachedHeight = element.offsetHeight || 70;
                clone.style.width = cachedWidth + 'px';
                clone.style.height = cachedHeight + 'px';
                document.body.appendChild(clone);
                
                // 高亮弃牌区域
                const discardPile = document.getElementById('discard-pile');
                if (discardPile) discardPile.classList.add('discard-target');
            }
            
            if (isDragging && clone) {
                // 使用缓存的尺寸避免强制同步布局
                clone.style.left = (clientX - cachedWidth / 2) + 'px';
                clone.style.top = (clientY - cachedHeight / 2) + 'px';
            }
        }
        
        function onEnd(e) {
            if (!isListening) return;
            isListening = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove, { passive: false });
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onEnd);
            
            const discardPile = setupDrag._discardPile || document.getElementById('discard-pile');
            if (discardPile) discardPile.classList.remove('discard-target');
            
            if (isDragging && clone) {
                const clientX = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientX : e.clientX;
                const clientY = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientY : e.clientY;
                
                const rect = discardPile?.getBoundingClientRect();
                const dropped = rect && clientX >= rect.left && clientX <= rect.right &&
                    clientY >= rect.top && clientY <= rect.bottom;
                
                if (dropped) {
                    // 拖到弃牌区
                    if (onDragEnd) onDragEnd(tile);
                    clone.remove();
                    element.classList.remove('drag-source');
                    isDragging = false;
                    clone = null;
                } else {
                    // 未拖到弃牌区：snap-back 动画
                    const snapClone = clone;
                    const elRect = element.getBoundingClientRect();
                    snapClone.style.transition = 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    snapClone.style.left = elRect.left + 'px';
                    snapClone.style.top = elRect.top + 'px';
                    snapClone.style.transform = 'scale(1)';
                    snapClone.style.opacity = '0.6';
                    setTimeout(() => {
                        snapClone.remove();
                        element.classList.remove('drag-source');
                    }, 280);
                    isDragging = false;
                    clone = null;
                }
            } else {
                isDragging = false;
                clone = null;
            }
        }
        
        // 返回清理函数，供增量渲染时清理旧监听器
        return function cleanupDrag() {
            element.removeEventListener('mousedown', startDrag);
            element.removeEventListener('touchstart', startDrag, { passive: false });
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove, { passive: false });
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onEnd);
            if (clone && clone.parentNode) clone.remove();
            element.classList.remove('drag-source');
        };
    }

    /**
     * 创建玩家信息面板
     */
    function createPlayerInfo(player, isCurrent = false) {
        if (!player) return document.createElement('div');
        const div = document.createElement('div');
        div.className = `player-info ${isCurrent ? 'current-turn' : ''}`;
        const score = Number.isFinite(Number(player.score)) ? Number(player.score) : 0;
        div.innerHTML = `
            <div class="player-avatar">${player.isAI ? '🤖' : '👤'}</div>
            <div class="player-name">${Utils.escapeHtml(player.name)}</div>
            <div class="player-score">${score}</div>
        `;
        return div;
    }

    /**
     * 创建手牌区域
     */
    function createHandArea(tiles, options = {}) {
        const div = document.createElement('div');
        div.className = 'hand-area';
        
        if (Array.isArray(tiles)) {
            for (const tile of tiles) {
                div.appendChild(createTileElement(tile, options));
            }
        }
        
        return div;
    }

    /**
     * 创建副露区域
     */
    function createMeldsArea(melds) {
        const div = document.createElement('div');
        div.className = 'melds-area';
        
        if (Array.isArray(melds)) {
            for (const meld of melds) {
                if (!meld || !Array.isArray(meld.tiles)) continue;
                const group = document.createElement('div');
                group.className = 'meld-group';
                
                for (const tile of meld.tiles) {
                    const tileEl = createTileElement(tile, { small: true });
                    group.appendChild(tileEl);
                }
                
                div.appendChild(group);
            }
        }
        
        return div;
    }

    /**
     * 创建模态框
     */
    function createModal(title, content, buttons = []) {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const trigger = document.activeElement;
        const close = () => {
            if (!overlay.isConnected) return;
            overlay.remove();
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
        };
        overlay._closeModal = close;
        
        const modal = document.createElement('div');
        modal.className = 'modal-panel compact-panel';
        modal.tabIndex = -1;
        if (!title) overlay.setAttribute('aria-label', '提示');
        
        // 头部
        if (title) {
            const header = document.createElement('div');
            header.className = 'modal-panel-header';
            const h3 = document.createElement('h3');
            h3.id = `modal-title-${Utils.uuid()}`;
            h3.textContent = title;
            overlay.setAttribute('aria-labelledby', h3.id);
            header.appendChild(h3);
            const closeBtn = document.createElement('button');
            closeBtn.className = 'modal-close';
            closeBtn.type = 'button';
            closeBtn.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#close"></use></svg>';
            closeBtn.setAttribute('aria-label', '关闭弹窗');
            closeBtn.addEventListener('click', close);
            header.appendChild(closeBtn);
            modal.appendChild(header);
        }
        
        const body = document.createElement('div');
        body.className = 'modal-panel-body';
        body.style.textAlign = 'center';
        
        if (content) {
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = content;
            body.appendChild(contentDiv);
        }
        
        for (const btn of buttons) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `modal-btn${btn.variant ? ` ${btn.variant}` : ''}`;
            button.textContent = btn.text;
            button.addEventListener('click', () => {
                try {
                    if (btn.onClick) btn.onClick();
                } finally {
                    close();
                }
            });
            body.appendChild(button);
        }
        
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // 点击背景关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close();
            }
        });
        requestAnimationFrame(() => {
            const focusTarget = modal.querySelector('.modal-btn') || modal.querySelector('.modal-close') || modal;
            focusTarget.focus();
        });
        
        return overlay;
    }

    /**
     * 创建成就卡片
     */
    function createAchievementCard(achievement) {
        const div = document.createElement('div');
        div.className = `achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'}`;
        if (achievement.unlocked) div.classList.add('neon-border');
        div.innerHTML = `
            <div class="achievement-icon">${Utils.escapeHtml(achievement.icon)}</div>
            <div class="achievement-info">
                <div class="achievement-name">${Utils.escapeHtml(achievement.name)}</div>
                <div class="achievement-desc">${Utils.escapeHtml(achievement.desc)}</div>
                <div class="achievement-progress">
                    <div class="achievement-progress-bar" style="width: ${achievement.progress || 0}%"></div>
                </div>
            </div>
        `;
        return div;
    }

    /**
     * 创建回放项
     */
    function createReplayItem(replay, onPlay, onDelete) {
        const div = document.createElement('div');
        div.className = 'replay-item';
        
        const date = new Date(replay.date);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        
        div.innerHTML = `
            <div class="replay-info">
                <span class="replay-title">${Utils.escapeHtml(replay.mahjongType)} · ${Utils.escapeHtml(replay.rounds)}局</span>
                <span class="replay-meta">${dateStr} · ${Utils.escapeHtml(replay.finalScores?.[0]?.name) || '未知'} 胜出</span>
            </div>
            <div class="replay-actions">
                <button class="replay-btn">播放</button>
                <button class="replay-btn" style="background:#f44336">删除</button>
            </div>
        `;
        
        const buttons = div.querySelectorAll('.replay-btn');
        buttons[0].addEventListener('click', () => onPlay?.(replay));
        buttons[1].addEventListener('click', () => onDelete?.(replay));
        
        return div;
    }

    /**
     * 创建房间项
     */
    function createRoomItem(room, onJoin) {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div class="room-item-info">
                <span class="room-item-name">${Utils.escapeHtml(room.name)}</span>
                <span class="room-item-meta">${Utils.escapeHtml(room.type)} · ${Utils.escapeHtml(room.players)}/${Utils.escapeHtml(room.maxPlayers)}人</span>
            </div>
            <button class="room-item-join">加入</button>
        `;
        
        div.querySelector('.room-item-join').addEventListener('click', () => onJoin?.(room));
        
        return div;
    }

    /**
     * 切换屏幕
     */
    function switchScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add('active');
            if (window.App) App.currentScreen = screenId;
        }
    }

    /**
     * 显示动作效果
     */
    function showActionEffect(text) {
        const feedback = document.getElementById('action-feedback');
        if (feedback) {
            feedback.textContent = text;
            feedback.classList.remove('action-effect');
            // 使用双 rAF 替代强制同步布局（void offsetWidth）
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    feedback.classList.add('action-effect');
                });
            });
            // 清除之前的定时器
            if (feedback._actionTimer) clearTimeout(feedback._actionTimer);
            feedback._actionTimer = setTimeout(() => {
                feedback.textContent = '';
                feedback.classList.remove('action-effect');
            }, 1000);
            return;
        }
        // fallback: 创建临时元素
        const app = document.getElementById('app');
        if (!app) return;
        const div = document.createElement('div');
        div.className = 'action-effect';
        div.textContent = text;
        app.appendChild(div);
        setTimeout(() => div.remove(), 1000);
    }

    /**
     * 显示连击效果
     */
    function showCombo(text) {
        const app = document.getElementById('app');
        if (!app) return;
        const div = document.createElement('div');
        div.className = 'combo-text';
        div.textContent = text;
        app.appendChild(div);
        setTimeout(() => div.remove(), 1000);
    }

    /**
     * 全屏胡牌特效
     */
    function showWinEffect(isZiMo = false) {
        const app = document.getElementById('app');
        if (!app) return;
        
        // 创建覆盖层
        const overlay = document.createElement('div');
        overlay.className = 'win-overlay';
        
        // 闪光效果
        const flash = document.createElement('div');
        flash.className = 'win-flash';
        overlay.appendChild(flash);
        
        // 扩散环
        const rings = document.createElement('div');
        rings.className = 'win-rings';
        for (let i = 0; i < 3; i++) {
            const ring = document.createElement('div');
            ring.className = 'win-ring';
            rings.appendChild(ring);
        }
        overlay.appendChild(rings);
        
        app.appendChild(overlay);
        
        // 彩虹光效
        if (isZiMo) {
            const rainbow = document.getElementById('rainbow-overlay');
            if (rainbow) {
                rainbow.classList.add('active');
                setTimeout(() => rainbow.classList.remove('active'), 3000);
            }
        }
        
        setTimeout(() => overlay.remove(), 2000);
    }

    /**
     * 分数浮动效果
     */
    function showScoreFloat(element, delta, x, y) {
        const app = document.getElementById('app');
        if (!app) return;
        const float = document.createElement('div');
        float.className = `score-float ${delta >= 0 ? 'positive' : 'negative'}`;
        float.textContent = delta >= 0 ? `+${delta}` : `${delta}`;
        float.style.left = (x || window.innerWidth / 2) + 'px';
        float.style.top = (y || window.innerHeight / 2) + 'px';
        app.appendChild(float);
        setTimeout(() => float.remove(), 1200);
    }

    /**
     * 分数跳动
     */
    function animateScore(element) {
        if (!element) return;
        element.classList.remove('score-pop');
        // 使用双 rAF 替代强制同步布局
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                element.classList.add('score-pop');
            });
        });
    }

    /**
     * 更新统计面板
     */
    function updateStatsPanel(stats) {
        if (!stats) return;
        const els = {
            'player-level': stats.level,
            'current-exp': stats.exp,
            'max-exp': stats.maxExp,
            'stat-total-games': stats.totalGames,
            'stat-wins': stats.wins,
            'stat-losses': stats.losses,
            'stat-winrate': stats.winRate + '%',
            'stat-streak': `${stats.currentStreak}/${stats.maxStreak}`,
            'stat-total-score': stats.totalScore,
            'stat-best-game': stats.bestGame,
            'stat-most-bombs': stats.mostBombs
        };
        
        for (const [id, value] of Object.entries(els)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }
        
        // 经验条
        const expFill = document.getElementById('exp-fill');
        if (expFill) {
            const percent = (stats.exp / stats.maxExp) * 100;
            expFill.style.width = percent + '%';
        }
    }

    /**
     * 创建粒子爆炸效果
     */
    function createParticles(x, y, options = {}) {
        const {
            count = 16,
            color = 'var(--accent-gold)',
            size = 10,
            spread = 120,
            duration = 1000,
            type = 'circle'
        } = options;
        const animSpeed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim-speed')) || 1;
        const scaledDuration = Math.max(1, duration * animSpeed);

        const container = document.getElementById('particle-container') || document.body;
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            if (type === 'star') particle.classList.add('particle-star');
            else if (color.includes('gold') || color === 'var(--accent-gold)') particle.classList.add('particle-gold');
            
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.width = (size * (0.5 + Math.random())) + 'px';
            particle.style.height = particle.style.width;
            particle.style.background = color;
            
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8;
            const distance = spread * (0.3 + Math.random() * 0.7);
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            
            particle.style.animation = `particleBurst ${scaledDuration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`;
            particle.style.animationDelay = `${Math.random() * 150 * animSpeed}ms`;
            particle.style.setProperty('--tx', `${tx}px`);
            particle.style.setProperty('--ty', `${ty}px`);
            
            fragment.appendChild(particle);
            setTimeout(() => particle.remove(), scaledDuration + 300);
        }
        
        container.appendChild(fragment);
    }

    /**
     * 创建彩带效果
     */
    function createConfetti(options = {}) {
        const { count = 50, duration = 4000 } = options;
        const animSpeed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim-speed')) || 1;
        const scaledDuration = Math.max(1, duration * animSpeed);
        const colors = ['#d4a843', '#e8c870', '#4caf50', '#f44336', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4'];
        const container = document.getElementById('particle-container') || document.body;
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.top = '-15px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.width = (5 + Math.random() * 10) + 'px';
            piece.style.height = (5 + Math.random() * 10) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.animationDuration = (scaledDuration * 0.4 + Math.random() * scaledDuration * 0.6) + 'ms';
            piece.style.animationDelay = (Math.random() * 800 * animSpeed) + 'ms';
            
            // 随机旋转方向
            const rotationDir = Math.random() > 0.5 ? 1 : -1;
            piece.style.setProperty('--rot-dir', rotationDir);
            
            fragment.appendChild(piece);
            setTimeout(() => piece.remove(), scaledDuration + 1500);
        }
        
        container.appendChild(fragment);
    }

    /**
     * 屏幕震动效果
     */
    function screenShake(intensity = 5, duration = 300) {
        const app = document.getElementById('app');
        if (!app) return;
        
        // 创建独立的震动层，避免在 #app 根节点上直接修改 transform 导致整棵 DOM 重排
        let shakeLayer = document.getElementById('screen-shake-layer');
        if (!shakeLayer) {
            shakeLayer = document.createElement('div');
            shakeLayer.id = 'screen-shake-layer';
            shakeLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
            app.insertBefore(shakeLayer, app.firstChild);
        }
        
        const startTime = Date.now();
        function shake() {
            const elapsed = Date.now() - startTime;
            if (elapsed >= duration) {
                shakeLayer.style.transform = '';
                return;
            }
            const decay = 1 - elapsed / duration;
            const dx = (Math.random() - 0.5) * intensity * decay * 2;
            const dy = (Math.random() - 0.5) * intensity * decay * 2;
            shakeLayer.style.transform = `translate(${dx}px, ${dy}px)`;
            requestAnimationFrame(shake);
        }
        shake();
    }

    /**
     * 成就解锁闪光
     * @param {HTMLElement|Object} elementOrAch - DOM元素或成就对象 {name, desc, icon}
     */
    function flashAchievement(elementOrAch) {
        if (!elementOrAch) return;
        // 如果传入的是 DOM 元素，保持原有行为
        if (elementOrAch instanceof HTMLElement) {
            elementOrAch.classList.add('achievement-unlock');
            setTimeout(() => elementOrAch.classList.remove('achievement-unlock'), 800);
            return;
        }
        // 如果传入的是成就对象，创建浮动闪光提示
        const ach = elementOrAch;
        const el = document.createElement('div');
        el.className = 'achievement-flash';
        el.innerHTML = `<span class="achievement-flash-icon">${Utils.escapeHtml(ach.icon || '🏆')}</span><span class="achievement-flash-text">${Utils.escapeHtml(ach.name || '')}</span>`;
        el.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%) scale(0.8);z-index:300;padding:16px 28px;background:linear-gradient(135deg,rgba(30,35,45,0.95),rgba(20,25,35,0.98));border:1px solid rgba(212,168,67,0.3);border-radius:12px;color:var(--accent-gold);font-size:1.1rem;font-weight:700;box-shadow:0 12px 40px rgba(0,0,0,0.4);pointer-events:none;opacity:0;';
        document.getElementById('app')?.appendChild(el) || document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
            el.style.opacity = '1';
            el.style.transform = 'translateX(-50%) scale(1)';
        });
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) scale(0.9) translateY(-20px)';
            setTimeout(() => el.remove(), 400);
        }, 1800);
    }

    return {
        createTileElement,
        createPlayerInfo,
        createHandArea,
        createMeldsArea,
        createModal,
        createAchievementCard,
        createReplayItem,
        createRoomItem,
        switchScreen,
        showActionEffect,
        showCombo,
        showWinEffect,
        showScoreFloat,
        animateScore,
        updateStatsPanel,
        createParticles,
        createConfetti,
        screenShake,
        flashAchievement
    };
})();
