/**
 * 万能麻将 - 统计数据系统 v2
 * 
 * 数据语义规范：
 * - totalGames / wins / losses: 场数（一场 = 多局比赛）
 * - totalRounds: 累计总局数
 * - totalScore: 累计净胜分（不含初始分）
 * - bestGame: 单场最高净胜分
 * - currentStreak / maxStreak: 连胜场数
 */

const Stats = (function() {
    'use strict';

    const MAX_LEVEL_CAP = 10000;

    const DEFAULT_SETTINGS = {
        playerName: '玩家',
        aiDifficulty: 'normal',
        tableTheme: 'classic-green',
        gameRounds: 4,
        gameSpeed: 'normal',
        bgmVolume: 0,
        sfxVolume: 50,
        sfxEnabled: true,
        bgmStyle: 'none',
        opponentDisplay: 'small',
        mahjongType: 'guangdong',
        showTileNames: false,
        showShanten: true,
        autoSort: true
    };

    const DEFAULT_STATS = {
        level: 1,
        exp: 0,
        maxExp: 100,
        totalGames: 0,      // 总场数
        totalRounds: 0,     // 累计总局数
        wins: 0,            // 胜场数
        losses: 0,          // 负场数
        winRate: 0,
        currentStreak: 0,   // 当前连胜场数
        maxStreak: 0,       // 最高连胜场数
        totalScore: 0,      // 累计净胜分（不含初始分）
        bestGame: -999999, // 单场最高净胜分
        mostBombs: 0,       // 单场最多杠次数
        playedTypes: [],
        totalGang: 0,       // 累计杠次数
        totalHu: 0,         // 累计胡次数
        totalZiMo: 0,       // 累计自摸次数
        unlockedAchievements: [],
        history: []         // 每场比赛的历史记录
    };

    const SETTING_OPTIONS = {
        aiDifficulty: ['easy', 'normal', 'expert'],
        tableTheme: ['classic-green', 'dark-blue', 'wood', 'red', 'amethyst', 'ink', 'sunset'],
        gameRounds: [1, 4, 8, 16],
        gameSpeed: ['slow', 'normal', 'fast', 'instant'],
        bgmStyle: ['none', 'calm', 'upbeat', 'zen'],
        opponentDisplay: ['hidden', 'small', 'full']
    };

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const settings = Utils.deepClone(DEFAULT_SETTINGS);

        if (typeof source.playerName === 'string') {
            settings.playerName = source.playerName.slice(0, 8);
        }
        for (const [key, options] of Object.entries(SETTING_OPTIONS)) {
            const value = key === 'gameRounds' ? Number(source[key]) : source[key];
            if (options.includes(value)) settings[key] = value;
        }

        for (const key of ['bgmVolume', 'sfxVolume']) {
            const value = Number(source[key]);
            if (Number.isFinite(value)) settings[key] = Math.round(Math.max(0, Math.min(100, value)));
        }

        for (const key of ['sfxEnabled', 'showTileNames', 'showShanten', 'autoSort']) {
            if (typeof source[key] === 'boolean') settings[key] = source[key];
        }

        if (typeof source.mahjongType === 'string') {
            const validType = typeof Tiles?.getConfig === 'function'
                ? !!Tiles.getConfig(source.mahjongType)
                : (Tiles?.getMahjongTypes?.() || []).some(type => type.key === source.mahjongType);
            if (validType) settings.mahjongType = source.mahjongType;
        }
        return settings;
    }

    function getStats() {
        let stats = Storage.get('stats', null);
        // 防御：null 或损坏的数据
        if (!stats || typeof stats !== 'object') {
            stats = Utils.deepClone(DEFAULT_STATS);
        }
        // 深合并：确保所有 DEFAULT_STATS 字段都存在，防止旧数据缺失字段导致 NaN
        for (const key of Object.keys(DEFAULT_STATS)) {
            if (stats[key] === undefined || stats[key] === null) {
                stats[key] = Utils.deepClone(DEFAULT_STATS[key]);
            }
        }
        const nonNegativeNumericKeys = [
            'exp', 'maxExp', 'totalGames', 'totalRounds', 'wins', 'losses', 'winRate',
            'currentStreak', 'maxStreak', 'mostBombs', 'totalGang', 'totalHu', 'totalZiMo'
        ];
        for (const key of nonNegativeNumericKeys) {
            const value = Number(stats[key]);
            stats[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_STATS[key];
        }
        const level = Number(stats.level);
        stats.level = Number.isFinite(level) && level >= 1 ? Math.floor(level) : DEFAULT_STATS.level;
        for (const key of ['totalScore', 'bestGame']) {
            const value = Number(stats[key]);
            stats[key] = Number.isFinite(value) ? value : DEFAULT_STATS[key];
        }
        stats.winRate = Math.min(100, stats.winRate);
        stats.playedTypes = Array.isArray(stats.playedTypes)
            ? stats.playedTypes.filter(type => typeof type === 'string')
            : [];
        stats.unlockedAchievements = Array.isArray(stats.unlockedAchievements)
            ? stats.unlockedAchievements.filter(id => typeof id === 'string')
            : [];
        stats.history = Array.isArray(stats.history)
            ? stats.history.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 50)
            : [];
        // 防御：Infinity 数据损坏导致无限循环
        if (!isFinite(stats.exp) || stats.exp < 0) stats.exp = 0;
        if (!isFinite(stats.maxExp) || stats.maxExp <= 0) stats.maxExp = 100;
        if (!isFinite(stats.level) || stats.level < 1) stats.level = 1;
        // 防御：旧数据中 bestGame 可能为 0（默认值），如果 totalGames>0 且 totalScore<0，
        // 说明可能从未赢过，bestGame 应从真实历史重新计算
        if (stats.bestGame === 0 && stats.totalGames > 0) {
            const safeHistory = Array.isArray(stats.history) ? stats.history : [];
            const histBest = safeHistory.reduce((best, h) => 
                Math.max(best, isFinite(h.netScore) ? h.netScore : -999999), -999999);
            if (histBest > -999999) {
                stats.bestGame = histBest;
            }
        }
        // 防御：JSON 序列化将 -Infinity 转为 null
        if (stats.bestGame === null) {
            stats.bestGame = -999999;
        }
        return stats;
    }

    function saveStats(stats) {
        const ok = Storage.set('stats', stats);
        if (!ok) {
            console.error('stats save failed: localStorage quota exceeded');
            throw new Error('存储空间不足，请清理回放记录或重置数据');
        }
    }

    function resetStats() {
        Storage.set('stats', Utils.deepClone(DEFAULT_STATS));
        return Utils.deepClone(DEFAULT_STATS);
    }

    function addExp(amount) {
        if (typeof amount !== 'number' || !isFinite(amount) || amount < 0 || amount > 1e6) {
            throw new Error('Invalid exp amount');
        }
        const stats = getStats();
        const result = _addExpToStats(stats, amount);
        saveStats(stats);
        return result;
    }
    
    function _addExpToStats(stats, amount) {
        if (!isFinite(amount) || amount < 0 || amount > 1e6) {
            console.error('_addExpToStats: invalid amount', amount);
            amount = 0;
        }
        const prevLevel = stats.level;
        const prevExp = stats.exp;
        
        // 防御：Infinity / NaN / 异常 level 数据损坏导致无限循环或计算错误
        if (!isFinite(stats.level) || stats.level < 1) stats.level = 1;
        if (!isFinite(stats.exp) || stats.exp < 0) stats.exp = 0;
        if (!isFinite(stats.maxExp) || stats.maxExp <= 0) stats.maxExp = 100;
        
        stats.exp += amount;
        
        let levelsGained = 0;
        // 升级检查（防御：exp异常大时限制升级次数）
        while (isFinite(stats.exp) && stats.exp >= stats.maxExp && levelsGained < MAX_LEVEL_CAP) {
            stats.exp -= stats.maxExp;
            stats.level++;
            levelsGained++;
            stats.maxExp = Math.min(Math.floor(100 * Math.pow(1.2, stats.level - 1)), Number.MAX_SAFE_INTEGER);
        }
        
        const levelResult = {
            prevLevel,
            newLevel: stats.level,
            levelsGained,
            gained: amount,
            prevExp,
            newExp: stats.exp,
            maxExp: stats.maxExp
        };
        // 防御：levelResult 中任何字段出现 Infinity / NaN 或越界
        if (!isFinite(levelResult.prevLevel) || levelResult.prevLevel < 1 || levelResult.prevLevel >= MAX_LEVEL_CAP) {
            console.warn('Invalid levelResult prevLevel', levelResult.prevLevel);
            levelResult.prevLevel = 1;
        }
        if (!isFinite(levelResult.newLevel) || levelResult.newLevel < 1 || levelResult.newLevel >= MAX_LEVEL_CAP) {
            console.warn('Invalid levelResult newLevel', levelResult.newLevel);
            levelResult.newLevel = 1;
        }
        if (!isFinite(levelResult.levelsGained) || levelResult.levelsGained < 0 || levelResult.levelsGained >= MAX_LEVEL_CAP) {
            console.warn('Invalid levelResult levelsGained', levelResult.levelsGained);
            levelResult.levelsGained = 0;
        }
        if (!isFinite(levelResult.maxExp) || levelResult.maxExp <= 0) {
            console.warn('Invalid levelResult maxExp', levelResult.maxExp);
            levelResult.maxExp = 100;
        }
        if (!isFinite(levelResult.prevExp) || levelResult.prevExp < 0) {
            console.warn('Invalid levelResult prevExp', levelResult.prevExp);
            levelResult.prevExp = 0;
        }
        if (!isFinite(levelResult.newExp) || levelResult.newExp < 0) {
            console.warn('Invalid levelResult newExp', levelResult.newExp);
            levelResult.newExp = 0;
        }
        return levelResult;
    }

    /**
     * 记录一场比赛的结果
     * @param {Object} result
     *   - isWin: boolean 整场是否获胜
     *   - finalScore: number 最终总分（含初始分，如 1200）
     *   - netScore: number 净胜分（finalScore - 初始分，如 +200）
     *   - fan: number 本场最高番数
     *   - mahjongType: string
     *   - rounds: number 本场总局数
     *   - wonRounds: number 玩家赢的局数
     *   - gangCount: number 本场杠次数
     *   - huCount: number 本场胡次数
     *   - ziMoCount: number 本场自摸次数
     *   - winType: string 胡牌类型
     *   - hasQingYiSe: boolean
     */
    function recordGame(result) {
        if (!result || typeof result !== 'object') {
            console.error('recordGame: invalid result');
            return null;
        }
        const stats = getStats();
        stats.totalGames++;
        stats.totalRounds += Number(result.rounds) || 1;
        
        if (result.isWin) {
            stats.wins++;
            stats.currentStreak++;
            if (stats.currentStreak > stats.maxStreak) {
                stats.maxStreak = stats.currentStreak;
            }
        } else {
            stats.losses++;
            stats.currentStreak = 0;
        }
        
        stats.winRate = stats.totalGames > 0 
            ? Math.round((stats.wins / stats.totalGames) * 100) 
            : 0;
        
        // 净胜分（不含初始分）
        const netScore = Number(result.netScore) || 0;
        stats.totalScore += netScore;
        
        if (netScore > stats.bestGame || stats.bestGame === null || stats.bestGame === -999999) {
            stats.bestGame = netScore;
        }
        
        const gangCount = Number(result.gangCount) || 0;
        if (gangCount > stats.mostBombs) {
            stats.mostBombs = gangCount;
        }
        
        stats.totalGang += gangCount;
        stats.totalHu += Number(result.huCount) || 0;
        stats.totalZiMo += Number(result.ziMoCount) || 0;
        
        // 记录玩过的麻将种类
        stats.playedTypes = stats.playedTypes || [];
        if (result.mahjongType && !stats.playedTypes.includes(result.mahjongType)) {
            stats.playedTypes.push(result.mahjongType);
        }
        
        // 确保history存在（防御损坏的存储）
        stats.history = stats.history || [];
        
        // 添加历史记录
        stats.history.unshift({
            date: new Date().toISOString(),
            mahjongType: result.mahjongType,
            isWin: result.isWin,
            finalScore: Number(result.finalScore) || 0,
            netScore: netScore,
            fan: Number(result.fan) || 0,
            rounds: Number(result.rounds) || 1,
            wonRounds: Number(result.wonRounds) || (result.isWin ? 1 : 0),
            gangCount: gangCount,
            huCount: Number(result.huCount) || 0,
            ziMoCount: Number(result.ziMoCount) || 0
        });
        
        // 只保留最近50条
        if (stats.history.length > 50) {
            stats.history = stats.history.slice(0, 50);
        }
        
        // 加经验：胜场基础20 + 番数*2，负场基础5
        const expGain = result.isWin ? 20 + (result.fan || 0) * 2 : 5;
        const levelResult = _addExpToStats(stats, expGain);
        
        // 检查成就
        const newlyUnlocked = checkAchievements(stats, result);
        
        saveStats(stats);
        return {
            stats,
            expGain,
            levelResult,
            newlyUnlocked
        };
    }

    // 成就定义
    const ACHIEVEMENTS = [
        { id: 'first_win',    name: '初战告捷',   desc: '赢得第一场对局',           icon: '🏆', condition: s => s.wins >= 1 },
        { id: 'win_10',       name: '十连胜手',   desc: '累计赢得10场对局',         icon: '🥇', condition: s => s.wins >= 10 },
        { id: 'win_100',      name: '百战百胜',   desc: '累计赢得100场对局',        icon: '👑', condition: s => s.wins >= 100 },
        { id: 'streak_3',     name: '三连胜',     desc: '连胜3场',                   icon: '🔥', condition: s => s.maxStreak >= 3 },
        { id: 'streak_5',     name: '五连胜',     desc: '连胜5场',                   icon: '🔥', condition: s => s.maxStreak >= 5 },
        { id: 'streak_10',    name: '十连胜',     desc: '连胜10场',                  icon: '⚡', condition: s => s.maxStreak >= 10 },
        { id: 'gang_master',  name: '杠上开花',   desc: '单场杠3次以上',             icon: '💣', condition: (s, r) => (r.gangCount || 0) >= 3 },
        { id: 'big_win',      name: '大满贯',     desc: '单场净胜分超过200',         icon: '💰', condition: (s, r) => (r.netScore || 0) >= 200 },
        { id: 'zi_mo_king',   name: '自摸王',     desc: '单场自摸3次以上',           icon: '🎯', condition: (s, r) => (r.ziMoCount || 0) >= 3 },
        { id: 'veteran',      name: '老手',       desc: '累计进行50场对局',          icon: '🎖️', condition: s => s.totalGames >= 50 },
        { id: 'master',       name: '麻将大师',   desc: '达到10级',                  icon: '🌟', condition: s => s.level >= 10 },
        { id: 'seven_pairs',  name: '七对专家',   desc: '胡出七对',                  icon: '🎲', condition: (s, r) => r.winType === 'seven_pairs' },
        { id: 'qing_yi_se',   name: '清一色',     desc: '胡出清一色',                icon: '🎨', condition: (s, r) => r.hasQingYiSe },
        { id: 'thirteen_orphans', name: '国士无双', desc: '胡出十三幺',              icon: '👑', condition: (s, r) => r.winType === 'thirteen_orphans' },
        { id: 'all_types',    name: '全能选手',   desc: '玩遍10种麻将',              icon: '🌍', condition: (s, r) => (s.playedTypes?.length || 0) >= 10 },
        { id: 'perfect',      name: '完美对局',   desc: '打满4局且全胜',             icon: '💎', condition: (s, r) => r.isWin && (r.wonRounds || 0) >= (r.rounds || 1) && (r.rounds || 0) >= 4 },
        { id: 'big_loser',    name: '虽败犹荣',   desc: '单场净负分超过200',         icon: '🥔', condition: (s, r) => (r.netScore || 0) <= -200 }
    ];

    function getAchievements() {
        const stats = getStats();
        return ACHIEVEMENTS.map(ach => ({
            ...ach,
            unlocked: stats.unlockedAchievements.includes(ach.id),
            progress: getAchievementProgress(ach, stats)
        }));
    }

    function getAchievementProgress(achievement, stats) {
        switch (achievement.id) {
            case 'first_win':       return Math.min(stats.wins / 1 * 100, 100);
            case 'win_10':          return Math.min(stats.wins / 10 * 100, 100);
            case 'win_100':         return Math.min(stats.wins / 100 * 100, 100);
            case 'streak_3':        return Math.min(stats.maxStreak / 3 * 100, 100);
            case 'streak_5':        return Math.min(stats.maxStreak / 5 * 100, 100);
            case 'streak_10':       return Math.min(stats.maxStreak / 10 * 100, 100);
            case 'veteran':         return Math.min(stats.totalGames / 50 * 100, 100);
            case 'master':          return Math.min(stats.level / 10 * 100, 100);
            case 'all_types':       {
                const totalTypes = (Tiles.getMahjongTypes?.() || []).length || 12;
                return Math.min((stats.playedTypes?.length || 0) / Math.min(10, totalTypes) * 100, 100);
            }
            default: return stats.unlockedAchievements.includes(achievement.id) ? 100 : 0;
        }
    }

    function checkAchievements(stats, result) {
        const newlyUnlocked = [];
        
        for (const ach of ACHIEVEMENTS) {
            if (!stats.unlockedAchievements.includes(ach.id)) {
                if (ach.condition(stats, result)) {
                    stats.unlockedAchievements.push(ach.id);
                    newlyUnlocked.push(ach);
                }
            }
        }
        
        return newlyUnlocked;
    }

    /**
     * 获取等级进度信息（用于战绩页展示）
     */
    function getLevelProgress() {
        const stats = getStats();
        const nextLevelExp = stats.maxExp;
        const currentExp = stats.exp;
        const percent = nextLevelExp > 0 ? Math.max(0, Math.round((currentExp / nextLevelExp) * 100)) : 0;
        
        return {
            level: stats.level,
            currentExp,
            nextLevelExp,
            percent,
            totalExpEarned: _calcTotalExp(stats)
        };
    }

    function _calcTotalExp(stats) {
        // 防御：level异常大时避免无限循环
        const level = Math.min(Math.max(1, Math.floor(stats.level || 1)), MAX_LEVEL_CAP);
        let total = stats.exp || 0;
        for (let lv = 1; lv < level; lv++) {
            total += Math.floor(100 * Math.pow(1.2, lv - 1));
        }
        return total;
    }

    /**
     * 获取战绩摘要（用于战绩页）
     */
    function getMatchSummary() {
        const stats = getStats();
        const safeHistory = Array.isArray(stats.history) ? stats.history : [];
        const history = safeHistory;
        
        // 最近7场
        const recent = history.slice(0, 7);
        const recentWins = recent.filter(h => h.isWin).length;
        
        // 最佳单场
        const bestMatch = history.reduce((best, h) => {
            return (h.netScore > (best?.netScore || -Infinity)) ? h : best;
        }, null);
        
        // 平均每场净胜
        const avgNetScore = history.length > 0
            ? Math.round(history.reduce((sum, h) => sum + (h.netScore || 0), 0) / history.length)
            : 0;
        
        const displayBestGame = stats.bestGame === -999999 ? 0 : stats.bestGame;
        return {
            totalGames: stats.totalGames,
            totalRounds: stats.totalRounds,
            wins: stats.wins,
            losses: stats.losses,
            winRate: stats.winRate,
            currentStreak: stats.currentStreak,
            maxStreak: stats.maxStreak,
            totalScore: stats.totalScore,
            bestGame: displayBestGame,
            avgNetScore,
            recentWinRate: recent.length > 0 ? Math.round((recentWins / recent.length) * 100) : 0,
            bestMatch,
            history: history.slice(0, 20)
        };
    }

    function getSettings() {
        return normalizeSettings(Storage.get('settings', null));
    }

    function saveSettings(settings) {
        return Storage.set('settings', settings);
    }

    return {
        getStats,
        saveStats,
        resetStats,
        addExp,
        recordGame,
        getAchievements,
        checkAchievements,
        getLevelProgress,
        getMatchSummary,
        getSettings,
        normalizeSettings,
        saveSettings,
        ACHIEVEMENTS
    };
})();
