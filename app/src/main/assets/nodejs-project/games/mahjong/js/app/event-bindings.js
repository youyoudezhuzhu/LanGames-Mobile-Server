/**
 * 万能麻将 - DOM 事件绑定模块
 * 从 main.js 拆分（架构拆分轮次 2）
 */
    function bindEvents() {
        // 菜单按钮
        document.querySelectorAll('.menu-btn').forEach(btn => {
            btn.addEventListener('click', handleMenuClick);
        });
        
        // 返回按钮
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                AudioManager.SFX.buttonClick();
                // 网络大厅返回：如果在房间内先离开
                if (btn.id === 'network-lobby-back' && App.network?.roomId) {
                    App.network.leaveRoom().catch(() => {});
                    showLobbyContent();
                }
                const screen = btn.dataset.screen;
                if (screen) UIComponents.switchScreen(screen);
            });
        });
        
        // 设置变更（设置弹窗内）
        document.querySelectorAll('#settings-modal input, #settings-modal select').forEach(el => {
            el.addEventListener('change', handleSettingChange);
        });
        
        // 滑块实时更新
        document.querySelectorAll('#settings-modal input[type="range"]').forEach(el => {
            el.addEventListener('input', handleSliderInput);
        });
        
        // 高级设置展开/收起
        const advancedToggle = document.getElementById('advanced-toggle');
        if (advancedToggle) {
            advancedToggle.addEventListener('click', () => {
                AudioManager.SFX.buttonClick();
                const content = document.getElementById('advanced-content');
                if (!content) return;
                advancedToggle.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
            });
        }
        
        // 重置统计
        document.getElementById('reset-stats')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            handleResetStats();
        });
        
        // 设置弹窗
        document.getElementById('btn-open-settings')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            showSettingsModal();
        });
        document.getElementById('settings-close')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            hideSettingsModal();
        });
        document.getElementById('settings-modal')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                hideSettingsModal();
            }
        });
        
        // 游戏内暂停菜单
        document.getElementById('btn-menu')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            showIngameMenu();
        });
        document.getElementById('btn-resume')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            hideIngameMenu();
        });
        document.getElementById('btn-resume-main')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            hideIngameMenu();
        });
        document.getElementById('btn-ingame-settings')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            // 暂停菜单已经停止计时；设置关闭后仍返回暂停菜单，不应在后台恢复倒计时。
            showSettingsModal(true);
        });
        document.getElementById('ingame-menu')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) hideIngameMenu();
        });
        document.getElementById('btn-restart')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            hideIngameMenu();
            restartGame();
        });
        document.getElementById('btn-exit-game')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            hideIngameMenu();
            endGame();
        });
        
        // 操作按钮
        document.getElementById('btn-chi')?.addEventListener('click', () => { AudioManager.SFX.buttonClick(); handleAction('chi'); });
        document.getElementById('btn-peng')?.addEventListener('click', () => { AudioManager.SFX.buttonClick(); handleAction('peng'); });
        document.getElementById('btn-gang')?.addEventListener('click', () => { AudioManager.SFX.buttonClick(); handleAction('gang'); });
        document.getElementById('btn-hu')?.addEventListener('click', () => { AudioManager.SFX.buttonClick(); handleAction('hu'); });
        document.getElementById('btn-skip')?.addEventListener('click', () => { AudioManager.SFX.buttonClick(); handleAction('skip'); });
        
        // 自定义模式
        document.getElementById('start-custom')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            startCustomGame();
        });
        
        // 结算页按钮（避免 cloneNode 重新绑定导致的模式不一致）
        document.getElementById('btn-result-restart')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            restartGame();
        });
        document.getElementById('btn-result-exit')?.addEventListener('click', () => {
            AudioManager.SFX.buttonClick();
            endGame();
        });
        
        // 键盘事件
        document.addEventListener('keydown', handleKeydown);
        
        // 触摸手势（移动端）
        initTouchGestures();
    }
