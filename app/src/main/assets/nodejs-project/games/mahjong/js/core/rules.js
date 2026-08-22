/**
 * 万能麻将 - 规则系统
 * 胡牌判断、番数计算、特殊规则
 */

const Rules = (function() {
    'use strict';

    const { SUIT_TYPES, createTile, isSameTile, canFormSequence, canFormTriplet, sortTiles } = Tiles;

    // ===== 胡牌判断缓存 =====
    const _canWinCache = new Map();
    const _MAX_CANWIN_CACHE = 5000;

    function _canWinCacheKey(hand, config) {
        const tileKey = hand.filter(t => t && t.suit !== undefined)
                    .map(t => `${t.suit}-${t.value}`).sort().join(',');
        // 缓存键必须包含所有影响胡牌判断的规则参数
        const cfg = config || {};
        const configKey = [
            cfg.mahjongType || '',
            cfg.allowChi !== false ? '1' : '0',
            cfg.allowPeng !== false ? '1' : '0',
            cfg.allowGang !== false ? '1' : '0',
            cfg.queYiMen ? '1' : '0',
            cfg.xueZhanDaoDi ? '1' : '0',
            cfg.huaPai ? '1' : '0'
        ].join('|');
        return `${configKey}||${tileKey}`;
    }

    function _getCanWinCached(hand, config) {
        const key = _canWinCacheKey(hand, config);
        if (_canWinCache.has(key)) {
            return _canWinCache.get(key);
        }
        return undefined;
    }

    function _setCanWinCached(hand, config, result) {
        const key = _canWinCacheKey(hand, config);
        if (_canWinCache.size >= _MAX_CANWIN_CACHE) {
            const entries = Array.from(_canWinCache.entries());
            _canWinCache.clear();
            for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
                _canWinCache.set(entries[i][0], entries[i][1]);
            }
        }
        _canWinCache.set(key, result);
    }

    // ===== 番数体系 =====
    // 默认番数表（地方麻将通用）
    const DEFAULT_FAN_TABLE = {
        seven_pairs: 2,
        thirteen_orphans: 13,
        qing_yi_se: 6,
        hun_yi_se: 3,
        peng_peng_hu: 3,
        ping_hu: 1,
        duan_yao: 1,
        men_qing: 1,
        zi_mo: 1,
        gang_shang_kai_hua: 1,
        hai_di_lao_yue: 1,
        quan_qiu_ren: 3,
        gang: 1,
        da_san_yuan: 0,
        xiao_san_yuan: 0,
        da_si_xi: 0,
        xiao_si_xi: 0,
        zi_yi_se: 0,
        lv_yi_se: 0,
        qing_yao_jiu: 0,
        hun_yao_jiu: 0,
        quan_dai_yao: 1,
    };

    // 变体特定番数表
    const FAN_TABLES = {
        guobiao: {
            ...DEFAULT_FAN_TABLE,
            seven_pairs: 24,
            thirteen_orphans: 88,
            qing_yi_se: 24,
            hun_yi_se: 6,
            peng_peng_hu: 6,
            ping_hu: 2,
            men_qing: 2,
            zi_mo: 0,         // 国标自摸不计番
            gang_shang_kai_hua: 8,
            hai_di_lao_yue: 8,
            duan_yao: 2,
            quan_qiu_ren: 0,  // 国标无此叫法
            gang: 2,
            da_san_yuan: 88,
            xiao_san_yuan: 64,
            da_si_xi: 88,
            xiao_si_xi: 64,
            zi_yi_se: 64,
            lv_yi_se: 88,
            qing_yao_jiu: 64,
            hun_yao_jiu: 32,
            quan_dai_yao: 4,
        },
        guangdong: {
            ...DEFAULT_FAN_TABLE,
            // 广东推倒胡基本与默认相同
        },
        sichuan: {
            ...DEFAULT_FAN_TABLE,
            zi_mo: 1, // 四川自摸加番在上下文处理
        },
        shanghai: {
            ...DEFAULT_FAN_TABLE,
            hua_pai: 1, // 每花1番
        }
    };

    /**
     * 获取番数值
     * @param {Object|string} configOrType - 配置对象或变体名称
     * @param {string} key - 番型键
     */
    function getFanValue(configOrType, key) {
        const type = (typeof configOrType === 'string' ? configOrType : configOrType?.mahjongType) || '';
        const table = FAN_TABLES[type] || DEFAULT_FAN_TABLE;
        return table[key] ?? DEFAULT_FAN_TABLE[key] ?? 0;
    }

    /**
     * 判断一手牌是否可以胡牌
     * 使用递归分解法
     */
    function canWin(hand, config = {}) {
        if (!hand || !Array.isArray(hand)) return { canWin: false };
        if (hand.length % 3 !== 2 && (hand.length < 14 || hand.length % 2 !== 0)) return { canWin: false };

        const cached = _getCanWinCached(hand, config);
        if (cached !== undefined) return cached;

        const sorted = sortTiles(hand);
        
        // 七对（支持任意偶数张牌，如台湾麻将16张=8对）
        if (hand.length % 2 === 0 && hand.length >= 14 && isSevenPairs(sorted)) {
            const result = { canWin: true, type: 'seven_pairs' };
            _setCanWinCached(hand, config, result);
            return result;
        }
        
        // 十三幺
        if (hand.length === 14 && isThirteenOrphans(sorted)) {
            const result = { canWin: true, type: 'thirteen_orphans' };
            _setCanWinCached(hand, config, result);
            return result;
        }
        
        // 标准胡牌型
        const result = findStandardWin(sorted);
        if (result) {
            const r = { canWin: true, type: 'standard', ...result };
            _setCanWinCached(hand, config, r);
            return r;
        }

        const negative = { canWin: false };
        _setCanWinCached(hand, config, negative);
        return negative;
    }

    /**
     * 标准胡牌判断
     */
    function findStandardWin(tiles) {
        if (tiles.length === 0) return { pair: [], melds: [] };
        if (tiles.length % 3 !== 2) return null;
        // 标准胡牌至少需要5张（1对+1个面子）
        if (tiles.length < 5) return null;

        // 尝试每种牌作为将牌
        for (let i = 0; i < tiles.length - 1; i++) {
            if (i > 0 && isSameTile(tiles[i], tiles[i - 1])) continue;
            
            if (isSameTile(tiles[i], tiles[i + 1])) {
                const pair = [tiles[i], tiles[i + 1]];
                const remaining = [...tiles.slice(0, i), ...tiles.slice(i + 2)];
                
                const melds = findAllMelds(remaining);
                if (melds !== null) {
                    return { pair, melds };
                }
            }
        }
        return null;
    }

    /**
     * 从剩余牌中找出所有面子
     */
    function findAllMelds(tiles) {
        if (tiles.length === 0) return [];
        if (tiles.length % 3 !== 0) return null;

        const sorted = sortTiles(tiles);
        const result = tryFormMelds(sorted, []);
        return result;
    }

    function tryFormMelds(remaining, melds) {
        if (remaining.length === 0) return melds;

        const first = remaining[0];
        
        // 尝试刻子
        const tripletIndices = findTriplet(remaining, first);
        if (tripletIndices) {
            const newRemaining = removeIndices(remaining, tripletIndices);
            const result = tryFormMelds(newRemaining, [...melds, {
                type: 'triplet',
                tiles: tripletIndices.map(i => remaining[i])
            }]);
            if (result !== null) return result;
        }
        
        // 尝试顺子
        const sequenceIndices = findSequence(remaining, first);
        if (sequenceIndices) {
            const newRemaining = removeIndices(remaining, sequenceIndices);
            const result = tryFormMelds(newRemaining, [...melds, {
                type: 'sequence',
                tiles: sequenceIndices.map(i => remaining[i])
            }]);
            if (result !== null) return result;
        }
        
        return null;
    }

    function findTriplet(tiles, target) {
        const indices = [];
        for (let i = 0; i < tiles.length && indices.length < 3; i++) {
            if (isSameTile(tiles[i], target)) {
                indices.push(i);
            }
        }
        return indices.length === 3 ? indices : null;
    }

    function findSequence(tiles, target) {
        if (target.isHonor || target.isFlower) return null;
        
        // 找到 target 的索引（第一张）
        const idx0 = tiles.findIndex(t => isSameTile(t, target));
        if (idx0 === -1) return null;
        
        // 找到 value+1 的索引（跳过已使用的牌）
        let next1 = -1;
        for (let i = 0; i < tiles.length; i++) {
            if (i === idx0) continue;
            if (tiles[i].suit === target.suit && tiles[i].value === target.value + 1) {
                next1 = i;
                break;
            }
        }
        if (next1 === -1) return null;
        
        // 找到 value+2 的索引（跳过已使用的牌）
        let next2 = -1;
        for (let i = 0; i < tiles.length; i++) {
            if (i === idx0 || i === next1) continue;
            if (tiles[i].suit === target.suit && tiles[i].value === target.value + 2) {
                next2 = i;
                break;
            }
        }
        if (next2 === -1) return null;
        
        return [idx0, next1, next2];
    }

    function removeIndices(arr, indices) {
        const sorted = [...indices].sort((a, b) => b - a);
        const result = [...arr];
        for (const idx of sorted) {
            result.splice(idx, 1);
        }
        return result;
    }

    /**
     * 判断是否为七对
     * 标准规则：7个不同的对子，每种牌恰好2张，不允许四张相同牌拆成两对
     */
    function isSevenPairs(tiles) {
        if (tiles.length === 0) return false;
        if (tiles.length % 2 !== 0) return false;
        const counts = countTiles(tiles);
        let pairCount = 0;
        for (const key in counts) {
            const count = counts[key];
            if (count !== 2) return false; // 每种牌必须恰好2张（不能4张）
            pairCount++;
        }
        return pairCount === tiles.length / 2;
    }

    /**
     * 判断是否为十三幺
     */
    function isThirteenOrphans(tiles) {
        if (tiles.length !== 14) return false;
        const required = [
            ...[1, 9].map(v => createTile('wan', v)),
            ...[1, 9].map(v => createTile('tong', v)),
            ...[1, 9].map(v => createTile('tiao', v)),
            ...[1, 2, 3, 4].map(v => createTile('feng', v)),
            ...[1, 2, 3].map(v => createTile('jian', v))
        ];
        
        const counts = countTiles(tiles);
        let hasDuplicate = false;
        
        for (const req of required) {
            const key = tileKey(req);
            const count = counts[key] || 0;
            if (count < 1) return false;
            if (count > 1) {
                if (hasDuplicate || count > 2) return false;
                hasDuplicate = true;
            }
        }
        
        return hasDuplicate;
    }

    /**
     * 统计手牌中每种牌的数量
     */
    function countTiles(tiles) {
        const counts = {};
        for (const tile of tiles) {
            const key = tileKey(tile);
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }

    function tileKey(tile) {
        return `${tile.suit}-${tile.value}`;
    }

    /**
     * 判断是否可以吃
     */
    function canChi(hand, discard, config = {}) {
        if (!hand || !Array.isArray(hand)) return [];
        if (!discard) return [];
        if (config.allowChi === false) return [];
        if (discard.isHonor || discard.isFlower) return [];
        
        const results = [];
        const suit = discard.suit;
        const val = discard.value;
        
        // 吃上家：x, x+1, x+2 或 x-1, x, x+1 或 x-2, x-1, x
        const patterns = [
            [val - 2, val - 1],
            [val - 1, val + 1],
            [val + 1, val + 2]
        ];
        
        for (const [a, b] of patterns) {
            if (a < 1 || b > 9) continue;
            const tileA = hand.find(t => t.suit === suit && t.value === a);
            const tileB = hand.find(t => t.suit === suit && t.value === b);
            if (tileA && tileB) {
                results.push([{ ...tileA }, { ...tileB }, { ...discard }]);
            }
        }
        
        return results;
    }

    /**
     * 判断是否可以碰
     */
    function canPeng(hand, discard, config = {}) {
        if (!hand || !Array.isArray(hand)) return false;
        if (!discard) return false;
        if (config.allowPeng === false) return false;
        const sameTiles = hand.filter(t => isSameTile(t, discard));
        return sameTiles.length >= 2;
    }

    /**
     * 判断是否可以明杠
     */
    function canGang(hand, discard, config = {}) {
        if (!hand || !Array.isArray(hand)) return false;
        if (!discard) return false;
        if (config.allowGang === false) return false;
        const sameTiles = hand.filter(t => isSameTile(t, discard));
        return sameTiles.length >= 3;
    }

    /**
     * 判断是否可以暗杠/加杠
     */
    function canAnGang(hand, melds, config = {}) {
        if (!hand || !Array.isArray(hand)) return [];
        if (config.allowAnGang === false) return [];
        if (!Array.isArray(melds)) melds = [];
        const results = [];
        const counts = countTiles(hand);
        const anGangKeys = new Set();
        
        // 暗杠：手中有4张相同牌
        for (const key in counts) {
            if (counts[key] === 4) {
                const tile = hand.find(t => tileKey(t) === key);
                results.push({ type: 'an_gang', tiles: hand.filter(t => tileKey(t) === key) });
                anGangKeys.add(key);
            }
        }
        
        // 加杠：已碰过，手中有第4张（排除已有暗杠的）
        for (const meld of melds) {
            if (!meld || !meld.tiles || !meld.tiles.length) continue;
            if (meld.type === 'triplet') {
                const key = tileKey(meld.tiles[0]);
                if (anGangKeys.has(key)) continue;
                const fourth = hand.find(t => isSameTile(t, meld.tiles[0]));
                if (fourth) {
                    results.push({ type: 'jia_gang', meld, tile: fourth });
                }
            }
        }
        
        return results;
    }

    /**
     * 计算番数
     * @param {Array} hand - 手牌（含将牌和面子）
     * @param {Array} melds - 副露（吃碰杠）
     * @param {Object} winInfo - 胡牌信息
     * @param {Object} config - 配置
     * @param {Object} context - 上下文
     */
    function calculateFan(hand, melds, winInfo, config = {}, context = {}) {
        if (!winInfo) return { total: 0, fans: [] };
        let fan = 0;
        const fans = [];
        const allTiles = getAllTiles(hand, melds);

        function addFan(key, name) {
            const value = getFanValue(config, key);
            if (value > 0) {
                fan += value;
                fans.push({ name, fan: value });
            }
        }

        // ===== 最高番型（独立番种，不叠加） =====
        // 大四喜
        if (isDaSiXi(hand, melds)) {
            addFan('da_si_xi', '大四喜');
            return { total: fan, fans };
        }
        // 大三元
        if (isDaSanYuan(hand, melds)) {
            addFan('da_san_yuan', '大三元');
            return { total: fan, fans };
        }
        // 字一色
        if (isZiYiSe(hand, melds)) {
            addFan('zi_yi_se', '字一色');
            return { total: fan, fans };
        }
        // 绿一色
        if (isLvYiSe(hand, melds)) {
            addFan('lv_yi_se', '绿一色');
            return { total: fan, fans };
        }
        // 清幺九
        if (isQingYaoJiu(hand, melds)) {
            addFan('qing_yao_jiu', '清幺九');
            return { total: fan, fans };
        }
        // 十三幺
        if (winInfo.type === 'thirteen_orphans') {
            addFan('thirteen_orphans', '十三幺');
            return { total: fan, fans };
        }

        // ===== 高番叠加型 =====
        // 小四喜
        if (isXiaoSiXi(hand, melds)) {
            addFan('xiao_si_xi', '小四喜');
        }
        // 小三元
        if (isXiaoSanYuan(hand, melds)) {
            addFan('xiao_san_yuan', '小三元');
        }
        // 混幺九
        if (isHunYaoJiu(hand, melds)) {
            addFan('hun_yao_jiu', '混幺九');
        }

        // ===== 牌型番种 =====
        // 七对
        if (winInfo.type === 'seven_pairs') {
            addFan('seven_pairs', '七对');
        }

        // 清一色 / 混一色（互斥）
        if (isQingYiSe(hand, melds)) {
            addFan('qing_yi_se', '清一色');
        } else if (isHunYiSe(hand, melds)) {
            addFan('hun_yi_se', '混一色');
        }

        // 碰碰胡
        if (isPengPengHu(winInfo, melds)) {
            addFan('peng_peng_hu', '碰碰胡');
        }

        // 平和
        if (isPingHu(winInfo, melds)) {
            addFan('ping_hu', '平和');
        }

        // 断幺
        if (isDuanYao(hand, melds)) {
            addFan('duan_yao', '断幺');
        }

        // 全带幺
        if (isQuanDaiYao(winInfo, melds)) {
            addFan('quan_dai_yao', '全带幺');
        }

        // ===== 情境番种 =====
        // 门清
        if (context.isMenQing) {
            addFan('men_qing', '门清');
        }

        // 自摸
        if (context.isZiMo) {
            addFan('zi_mo', '自摸');
        }

        // 杠上开花
        if (context.isGangShangKaiHua) {
            addFan('gang_shang_kai_hua', '杠上开花');
        }

        // 海底捞月
        if (context.isHaiDiLaoYue) {
            addFan('hai_di_lao_yue', '海底捞月');
        }

        // 全求人
        if (context.isQuanQiuRen) {
            addFan('quan_qiu_ren', '全求人');
        }

        // 杠
        if (Number.isFinite(context.gangCount) && context.gangCount > 0) {
            const gangFan = getFanValue(config, 'gang') * context.gangCount;
            if (gangFan > 0) {
                fan += gangFan;
                fans.push({ name: `×${context.gangCount}杠`, fan: gangFan });
            }
        }

        // 花牌（上海麻将等）
        if (context.flowers && context.flowers.length > 0) {
            const huaFan = getFanValue(config, 'hua_pai') * context.flowers.length;
            if (huaFan > 0) {
                fan += huaFan;
                fans.push({ name: `花牌×${context.flowers.length}`, fan: huaFan });
            }
        }

        return { total: fan, fans };
    }

    /**
     * 获取所有参与牌型计算的牌（手牌+副露）
     */
    function getAllTiles(hand, melds) {
        if (!hand) return [];
        const all = [...hand];
        if (melds) {
            for (const meld of melds) {
                if (meld && Array.isArray(meld.tiles)) {
                    all.push(...meld.tiles);
                }
            }
        }
        return all;
    }

    function isQingYiSe(hand, melds) {
        const all = getAllTiles(hand, melds);
        if (all.length === 0) return false;
        const suits = new Set(all.map(t => t.suit));
        return suits.size === 1 && !all[0].isHonor;
    }

    function isHunYiSe(hand, melds) {
        const all = getAllTiles(hand, melds);
        const suits = new Set(all.map(t => t.suit));
        const hasHonor = all.some(t => t.isHonor);
        const hasNonHonor = all.some(t => !t.isHonor);
        // 混一色 = 一种数牌花色 + 字牌，不能全是字牌（那是字一色）
        return suits.size === 2 && hasHonor && hasNonHonor;
    }

    function isPengPengHu(winInfo, melds) {
        if (winInfo.type !== 'standard') return false;
        // 手牌中的面子必须都是刻子
        if (!winInfo.melds.every(m => m.type === 'triplet')) return false;
        // 副露中也必须都是刻子/杠（不能有顺子）
        if (melds && melds.some(m => m.type === 'sequence')) return false;
        return true;
    }

    function isPingHu(winInfo, melds) {
        if (!winInfo || winInfo.type !== 'standard') return false;
        // 平和不能有碰杠副露（吃顺子在某些规则中允许）
        if (melds && melds.some(m => m.type !== 'sequence')) return false;
        // 将牌不能是箭牌或幺九牌
        if (!winInfo.pair || winInfo.pair.length === 0) return false;
        const pairTile = winInfo.pair[0];
        if (pairTile.isHonor || pairTile.isTerminal) return false;
        // 所有面子都是顺子
        return winInfo.melds.every(m => m.type === 'sequence');
    }

    function isDuanYao(hand, melds) {
        const all = getAllTiles(hand, melds);
        return all.every(t => t.isSimple);
    }

    /**
     * 幺九相关番型检测
     * 清幺九：全部由幺九牌（1、9）组成，不含字牌
     * 混幺九：由幺九牌+字牌组成
     */
    function isQingYaoJiu(hand, melds) {
        const all = getAllTiles(hand, melds);
        if (all.length === 0) return false;
        // 必须全是幺九牌（1或9），不能有字牌
        return all.every(t => t.isTerminal);
    }

    function isHunYaoJiu(hand, melds) {
        const all = getAllTiles(hand, melds);
        if (all.length === 0) return false;
        // 每张牌必须是幺九或字牌
        if (!all.every(t => t.isTerminal || t.isHonor)) return false;
        // 不能是清幺九（必须有字牌）
        if (all.every(t => t.isTerminal)) return false;
        // 必须同时包含字牌和幺九牌
        const hasHonor = all.some(t => t.isHonor);
        const hasTerminal = all.some(t => t.isTerminal);
        return hasHonor && hasTerminal;
    }

    function isYaoJiu(hand, melds) {
        // 旧逻辑有缺陷，改为混幺九的宽松检测（兼容旧调用）
        return isHunYaoJiu(hand, melds);
    }

    /**
     * 字一色：所有牌都是字牌
     */
    function isZiYiSe(hand, melds) {
        const all = getAllTiles(hand, melds);
        return all.length > 0 && all.every(t => t.isHonor);
    }

    /**
     * 绿一色：所有牌都是绿色牌（2/3/4/6/8条 + 发财）
     */
    function isLvYiSe(hand, melds) {
        const all = getAllTiles(hand, melds);
        if (all.length === 0) return false;
        const greenValues = { tiao: [2, 3, 4, 6, 8], jian: [2] }; // 发财是 jian value=2
        return all.every(t => {
            if (t.suit === 'tiao') return greenValues.tiao.includes(t.value);
            if (t.suit === 'jian' && t.value === 2) return true;
            return false;
        });
    }

    /**
     * 大三元：中发白各有刻子或杠
     */
    function isDaSanYuan(hand, melds) {
        const counts = countBySuitValue(getAllTiles(hand, melds));
        // 中(1) 发(2) 白(3) 各至少3张
        return counts['jian-1'] >= 3 && counts['jian-2'] >= 3 && counts['jian-3'] >= 3;
    }

    /**
     * 小三元：中发白有2个刻子+1对
     */
    function isXiaoSanYuan(hand, melds) {
        const counts = countBySuitValue(getAllTiles(hand, melds));
        const c1 = counts['jian-1'] || 0;
        const c2 = counts['jian-2'] || 0;
        const c3 = counts['jian-3'] || 0;
        // 需要两个≥3，一个≥2
        const ge3 = [c1, c2, c3].filter(c => c >= 3).length;
        const ge2 = [c1, c2, c3].filter(c => c >= 2).length;
        return ge3 >= 2 && ge2 >= 3;
    }

    /**
     * 大四喜：东南西北各有刻子或杠
     */
    function isDaSiXi(hand, melds) {
        const counts = countBySuitValue(getAllTiles(hand, melds));
        return counts['feng-1'] >= 3 && counts['feng-2'] >= 3 && counts['feng-3'] >= 3 && counts['feng-4'] >= 3;
    }

    /**
     * 小四喜：东南西北有3个刻子+1对
     */
    function isXiaoSiXi(hand, melds) {
        const counts = countBySuitValue(getAllTiles(hand, melds));
        const cs = [1,2,3,4].map(v => counts[`feng-${v}`] || 0);
        const ge3 = cs.filter(c => c >= 3).length;
        const ge2 = cs.filter(c => c >= 2).length;
        return ge3 >= 3 && ge2 >= 4;
    }

    function countBySuitValue(tiles) {
        const counts = {};
        for (const t of tiles) {
            const key = `${t.suit}-${t.value}`;
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }

    /**
     * 全带幺：每个面子和将牌都包含幺九牌
     */
    function isQuanDaiYao(winInfo, melds) {
        if (!winInfo || winInfo.type !== 'standard') return false;
        // 将牌必须带幺九
        if (!winInfo.pair || winInfo.pair.length === 0) return false;
        if (!winInfo.pair[0].isTerminal && !winInfo.pair[0].isHonor) return false;
        // 每个面子必须带幺九
        for (const m of winInfo.melds) {
            if (!m.tiles.some(t => t.isTerminal || t.isHonor)) return false;
        }
        // 副露也必须带幺九
        if (melds) {
            for (const m of melds) {
                if (!m.tiles.some(t => t.isTerminal || t.isHonor)) return false;
            }
        }
        return true;
    }

    /**
     * 听牌分析
     */
    function analyzeTingPai(hand, config = {}) {
        if (!hand || !Array.isArray(hand)) return [];
        const result = [];
        const allPossible = generateAllPossibleTiles(config);
        
        for (const tile of allPossible) {
            const testHand = [...hand, tile];
            const winResult = canWin(testHand, config);
            if (winResult.canWin) {
                // 统计该牌剩余数量
                const remaining = countRemaining(tile, hand);
                result.push({ tile, remaining, winType: winResult.type });
            }
        }
        
        return result;
    }

    function generateAllPossibleTiles(config) {
        const tiles = [];
        // 根据麻将种类的牌组配置生成可能的牌
        const typeConfig = Tiles.getConfig(config.mahjongType);
        if (typeConfig && typeConfig.tileSets) {
            for (const set of typeConfig.tileSets) {
                if (set.suit === 'hua') continue; // 花牌不用于胡牌
                for (let v = set.range[0]; v <= set.range[1]; v++) {
                    tiles.push(createTile(set.suit, v));
                }
            }
        } else {
            // 回退：生成所有标准牌
            const suits = ['wan', 'tong', 'tiao', 'feng', 'jian'];
            const maxValues = { wan: 9, tong: 9, tiao: 9, feng: 4, jian: 3 };
            for (const suit of suits) {
                for (let v = 1; v <= maxValues[suit]; v++) {
                    tiles.push(createTile(suit, v));
                }
            }
        }
        return tiles;
    }

    function countRemaining(tile, hand) {
        if (!tile) return 0;
        const inHand = hand ? hand.filter(t => isSameTile(t, tile)).length : 0;
        // 花牌只有1张，其他牌通常4张
        const total = tile.isFlower ? 1 : 4;
        return Math.max(0, total - inHand);
    }

    /**
     * 四川麻将：判断缺门
     */
    function checkQueYiMen(hand, chosenSuit = null) {
        const validSuits = ['wan', 'tong', 'tiao'];
        if (chosenSuit && !validSuits.includes(chosenSuit)) {
            return false;
        }
        const suits = new Set();
        for (const tile of hand) {
            if (!tile.isHonor && !tile.isFlower) {
                suits.add(tile.suit);
            }
        }
        // 如果指定了缺门花色，必须确认该花色确实不存在
        if (chosenSuit && suits.has(chosenSuit)) {
            return false;
        }
        return suits.size <= 2;
    }

    /**
     * 判断是否为烂牌（无法胡牌）
     */
    function isDeadHand(hand, config = {}) {
        const tingPai = analyzeTingPai(hand, config);
        return tingPai.length === 0;
    }

    return {
        canWin,
        canChi,
        canPeng,
        canGang,
        canAnGang,
        calculateFan,
        analyzeTingPai,
        checkQueYiMen,
        isDeadHand,
        isSevenPairs: tiles => tiles.length % 2 === 0 && tiles.length >= 14 && isSevenPairs(tiles),
        isThirteenOrphans,
        countTiles,
        getAllTiles
    };
})();
