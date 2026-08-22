/**
 * 万能麻将 - 统计/成就/回放列表渲染模块
 * 从 main.js 拆分（Bug修复轮次13）
 */
    function renderAchievements() {
        const container = document.getElementById('achievements-grid');
        if (!container) return;
        
        container.innerHTML = '';
        const achievements = Stats.getAchievements();
        
        for (const ach of achievements) {
            container.appendChild(UIComponents.createAchievementCard(ach));
        }
    }

    /**
     * 渲染战绩页
     */
    function renderStatsPage() {
        const container = document.getElementById('stats-page-content');
        if (!container) return;

        const summary = Stats.getMatchSummary();
        const level = Stats.getLevelProgress();
        const achievements = Stats.getAchievements();
        const unlockedCount = achievements.filter(a => a.unlocked).length;

        // 等级卡片
        const levelCard = `
            <div class="stats-card level-card">
                <div class="level-header">
                    <div class="level-big">Lv.${level.level}</div>
                    <div class="level-exp-detail">
                        <span>${level.currentExp} / ${level.nextLevelExp} EXP</span>
                        <span class="level-percent">${level.percent}%</span>
                    </div>
                </div>
                <div class="exp-bar-large">
                    <div class="exp-fill-large" style="width:${level.percent}%"></div>
                </div>
                <div class="level-hint">累计获得 ${level.totalExpEarned} 点经验 · 再赢 ${Math.ceil((level.nextLevelExp - level.currentExp) / 20)} 场即可升级</div>
            </div>
        `;

        // 概览卡片
        const overviewCard = `
            <div class="stats-card overview-card">
                <h3><svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#chart"></use></svg>战绩概览</h3>
                <div class="overview-grid">
                    <div class="overview-item">
                        <div class="overview-value ${summary.wins > summary.losses ? 'win' : ''}">${summary.totalGames}</div>
                        <div class="overview-label">总场数</div>
                    </div>
                    <div class="overview-item">
                        <div class="overview-value win">${summary.wins}</div>
                        <div class="overview-label">胜场</div>
                    </div>
                    <div class="overview-item">
                        <div class="overview-value lose">${summary.losses}</div>
                        <div class="overview-label">负场</div>
                    </div>
                    <div class="overview-item">
                        <div class="overview-value">${summary.winRate}%</div>
                        <div class="overview-label">胜率</div>
                    </div>
                    <div class="overview-item">
                        <div class="overview-value">${summary.totalRounds}</div>
                        <div class="overview-label">总局数</div>
                    </div>
                    <div class="overview-item">
                        <div class="overview-value">${summary.maxStreak}</div>
                        <div class="overview-label">最高连胜</div>
                    </div>
                </div>
                <div class="overview-detail">
                    <div class="detail-row">
                        <span>累计净胜分</span>
                        <span class="${summary.totalScore >= 0 ? 'win' : 'lose'}">${summary.totalScore >= 0 ? '+' : ''}${summary.totalScore}</span>
                    </div>
                    <div class="detail-row">
                        <span>单场最高净胜</span>
                        <span class="${(summary.bestGame || 0) >= 0 ? 'win' : 'lose'}">${(summary.bestGame || 0) >= 0 ? '+' : ''}${summary.bestGame || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span>场均净胜</span>
                        <span class="${summary.avgNetScore >= 0 ? 'win' : 'lose'}">${summary.avgNetScore >= 0 ? '+' : ''}${summary.avgNetScore}</span>
                    </div>
                    <div class="detail-row">
                        <span>近7场胜率</span>
                        <span>${summary.recentWinRate}%</span>
                    </div>
                </div>
            </div>
        `;

        // 成就进度
        const achievementCard = `
            <div class="stats-card achievement-card">
                <h3><svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#trophy"></use></svg>成就进度 (${unlockedCount}/${achievements.length})</h3>
                <div class="achievement-mini-list">
                    ${achievements.map(ach => `
                        <div class="achievement-mini ${ach.unlocked ? 'unlocked' : 'locked'}">
                            <span class="ach-mini-icon">${Utils.escapeHtml(ach.icon)}</span>
                            <div class="ach-mini-info">
                                <span class="ach-mini-name">${Utils.escapeHtml(ach.name)}</span>
                                <span class="ach-mini-desc">${Utils.escapeHtml(ach.desc)}</span>
                                ${!ach.unlocked ? `
                                    <div class="ach-mini-bar-wrap">
                                        <div class="ach-mini-bar" style="width:${ach.progress}%"></div>
                                    </div>
                                ` : '<span class="ach-mini-unlocked">✓ 已解锁</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // 历史战绩表
        let historyTable = '';
        if (summary.history.length > 0) {
            historyTable = `
                <div class="stats-card history-card">
                    <h3><svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#scroll"></use></svg>近期战绩</h3>
                    <div class="history-table-wrap">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th>类型</th>
                                    <th>结果</th>
                                    <th>净胜分</th>
                                    <th>总局/胜局</th>
                                    <th>最高番</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${summary.history.map(h => {
                                    const date = new Date(h.date);
                                    const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
                                    return `
                                        <tr class="${h.isWin ? 'win-row' : 'lose-row'}">
                                            <td>${dateStr}</td>
                                            <td>${Utils.escapeHtml(h.mahjongType || '')}</td>
                                            <td><span class="result-badge ${h.isWin ? 'win' : 'lose'}">${h.isWin ? '胜' : '负'}</span></td>
                                            <td class="${(h.netScore || 0) >= 0 ? 'win' : 'lose'}">${(h.netScore || 0) >= 0 ? '+' : ''}${h.netScore || 0}</td>
                                            <td>${h.wonRounds || 0}/${h.rounds || 1}</td>
                                            <td>${h.fan || 0}番</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            historyTable = `
                <div class="stats-card history-card empty">
                    <h3><svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#scroll"></use></svg>近期战绩</h3>
                    <div class="empty-state">暂无对局记录，快去开一局吧！</div>
                </div>
            `;
        }

        // 经验来源说明
        const expSourceCard = `
            <div class="stats-card exp-source-card">
                <h3>💡 经验与成就说明</h3>
                <div class="exp-source-list">
                    <div class="exp-source-item">
                        <span class="exp-source-icon">🏆</span>
                        <div>
                            <strong>胜利</strong>：基础 20 EXP + 番数×2
                            <span class="exp-source-example">例：胡出8番 → 20 + 16 = 36 EXP</span>
                        </div>
                    </div>
                    <div class="exp-source-item">
                        <span class="exp-source-icon">🥔</span>
                        <div>
                            <strong>失败</strong>：基础 5 EXP
                            <span class="exp-source-example">虽败犹荣，每局都有成长</span>
                        </div>
                    </div>
                    <div class="exp-source-item">
                        <span class="exp-source-icon">📈</span>
                        <div>
                            <strong>升级</strong>：每级所需经验递增 20%
                            <span class="exp-source-example">Lv.1→2 需 100 EXP，Lv.2→3 需 120 EXP</span>
                        </div>
                    </div>
                    <div class="exp-source-item">
                        <span class="exp-source-icon">🎯</span>
                        <div>
                            <strong>净胜分</strong>：最终总分 − 初始分（默认1000分）
                            <span class="exp-source-example">避免初始分干扰，真实反映战绩</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = levelCard + overviewCard + achievementCard + historyTable + expSourceCard;
    }

    /**
     * 渲染回放列表
     */
    function renderReplays() {
        const container = document.getElementById('replay-container');
        if (!container) return;
        
        const replays = Replay.getReplays();
        
        if (replays.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无历史对局</div>';
            return;
        }
        
        container.innerHTML = '';
        for (const replay of replays) {
            // 适配新数据格式：rounds 是数组
            const roundCount = Array.isArray(replay.rounds) ? replay.rounds.length : (replay.rounds || 1);
            container.appendChild(UIComponents.createReplayItem(
                { ...replay, rounds: roundCount },
                () => openReplayPlayer(replay),
                () => {
                    if (confirm('确定删除这条记录？')) {
                        Replay.deleteReplay(replay.id);
                        renderReplays();
                    }
                }
            ));
        }
    }
