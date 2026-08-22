/**
 * 万能麻将 - 回放系统
 */

const Replay = (function() {
    'use strict';

    const MAX_REPLAYS = 30;

    function getReplays() {
        const replays = Storage.get('replays', []);
        if (!Array.isArray(replays)) return [];
        return replays
            .filter(replay => replay && typeof replay === 'object' && !Array.isArray(replay))
            .slice(0, MAX_REPLAYS);
    }

    function saveReplay(replay) {
        const replays = getReplays();
        replays.unshift({
            ...replay,
            id: Utils.uuid(),
            date: new Date().toISOString()
        });
        
        if (replays.length > MAX_REPLAYS) {
            replays.pop();
        }
        
        try {
            const ok = Storage.set('replays', replays);
            if (!ok) {
                console.error('saveReplay failed: localStorage quota exceeded');
                return false;
            }
        } catch (e) {
            if (e.message?.includes('circular')) {
                console.error('saveReplay failed: circular reference in replay data');
            } else {
                console.error('saveReplay failed:', e);
            }
            Utils.toast('回放保存失败', 3000, 'error');
            return false;
        }
        return replays[0].id;
    }

    function getReplay(id) {
        const replays = getReplays();
        return replays.find(r => r.id === id);
    }

    function deleteReplay(id) {
        const replays = getReplays().filter(r => r.id !== id);
        Storage.set('replays', replays);
    }

    function clearReplays() {
        Storage.set('replays', []);
    }

    function createReplayData(engine) {
        if (!engine || !engine.config) return {};

        // 合并 matchHistory 和当前局（如果游戏还没完全结束）
        const allRounds = Array.isArray(engine.matchHistory) ? [...engine.matchHistory] : [];
        // 如果当前局已有历史且未保存到 matchHistory，追加
        if (engine.gameHistory && engine.gameHistory.length > 0) {
            const lastSaved = allRounds.length > 0 ? allRounds[allRounds.length - 1].round : -1;
            if (lastSaved !== engine.round) {
                allRounds.push({
                    round: engine.round,
                    wind: engine.currentWind,
                    history: Array.isArray(engine.gameHistory) ? [...engine.gameHistory] : [],
                    players: (engine.players || []).map(p => p?.toJSON ? p.toJSON(true) : null).filter(Boolean)
                });
            }
        }

        return {
            mahjongType: engine.config.mahjongType,
            maxRounds: engine.config.maxRounds,
            players: (engine.players || []).map(p => ({
                id: p?.id ?? '',
                name: p?.name || '',
                isAI: p?.isAI || false,
                position: p?.position || 0
            })),
            rounds: allRounds,
            finalScores: [...(engine.players || [])].sort((a, b) => (b?.score || 0) - (a?.score || 0)).map((p, idx) => ({
                name: p?.name || '',
                score: p?.score || 0,
                isWin: idx === 0
            }))
        };
    }

    return {
        getReplays,
        saveReplay,
        getReplay,
        deleteReplay,
        clearReplays,
        createReplayData
    };
})();
