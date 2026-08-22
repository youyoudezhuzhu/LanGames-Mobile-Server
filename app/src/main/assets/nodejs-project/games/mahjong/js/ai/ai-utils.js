/**
 * 万能麻将 - AI 通用工具库
 * 提供向听数计算、危险牌评估、牌效率分析、对手建模等核心能力
 */

const AIUtils = (function() {
    'use strict';

    // ============================================================
    // 模块级 LRU 缓存：跨调用共享向听数子问题结果
    // ============================================================
    const _shantenMemo = new Map();
    const _MAX_SHANTEN_MEMO = 10000;

    function _memoKey(counts) {
        return Object.entries(counts)
            .filter(([k, v]) => v > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
    }

    function _getMemo(counts) {
        const key = _memoKey(counts);
        return _shantenMemo.has(key) ? _shantenMemo.get(key) : undefined;
    }

    function _setMemo(counts, value) {
        const key = _memoKey(counts);
        if (_shantenMemo.size >= _MAX_SHANTEN_MEMO) {
            // 清空一半：保留最近插入的（Map 保持插入顺序）
            const entries = Array.from(_shantenMemo.entries());
            _shantenMemo.clear();
            for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
                _shantenMemo.set(entries[i][0], entries[i][1]);
            }
        }
        _shantenMemo.set(key, value);
    }

    // ============================================================
    // 1. 向听数计算 (Shanten)
    // ============================================================

    /**
     * 将手牌转为计数映射 { 'suit-value': count }
     */
    function handToCounts(hand) {
        const counts = {};
        for (const tile of hand) {
            if (tile.isFlower) continue;
            const key = `${tile.suit}-${tile.value}`;
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }

    /**
     * 标准型向听数 (4面子+1对子)
     * 使用递归搜索完整面子+搭子，公式：shanten = 8 - 2*groups - pair - shapes
     * @param {Tile[]} hand - 当前手牌（不含副露）
     * @param {Meld[]} melds - 已副露的面子
     * @returns {number} 向听数，0=听牌，-1=已胡
     */
    function calculateStandardShanten(hand, melds = []) {
        const counts = handToCounts(hand);
        const memo = new Map();

        /**
         * 递归计算手牌最大价值：value = 2*complete_groups + shapes
         * shapes 包括：对子、两面/坎张/边张搭子
         */
        function analyzeHandValue(counts) {
            // 先查模块级缓存
            const cached = _getMemo(counts);
            if (cached !== undefined) return cached;

            const key = _memoKey(counts);
            if (memo.has(key)) return memo.get(key);

            const keys = Object.keys(counts).filter(k => counts[k] > 0);
            if (keys.length === 0) {
                memo.set(key, 0);
                _setMemo(counts, 0);
                return 0;
            }

            let max = 0;

            for (const k of keys) {
                const [suit, val] = k.split('-');
                const v = parseInt(val);
                const isNumber = suit !== 'feng' && suit !== 'jian';

                // 完整刻子: +2
                if (counts[k] >= 3) {
                    const c = { ...counts };
                    c[k] -= 3;
                    if (c[k] === 0) delete c[k];
                    max = Math.max(max, 2 + analyzeHandValue(c));
                }

                // 完整顺子: +2
                if (isNumber) {
                    const k1 = `${suit}-${v + 1}`;
                    const k2 = `${suit}-${v + 2}`;
                    if ((counts[k1] || 0) > 0 && (counts[k2] || 0) > 0) {
                        const c = { ...counts };
                        c[k]--; if (c[k] === 0) delete c[k];
                        c[k1]--; if (c[k1] === 0) delete c[k1];
                        c[k2]--; if (c[k2] === 0) delete c[k2];
                        max = Math.max(max, 2 + analyzeHandValue(c));
                    }
                }

                // 对子搭子: +1
                if (counts[k] >= 2) {
                    const c = { ...counts };
                    c[k] -= 2;
                    if (c[k] === 0) delete c[k];
                    max = Math.max(max, 1 + analyzeHandValue(c));
                }

                // 两面/坎张/边张搭子 (两张连续数牌): +1
                if (isNumber) {
                    const k1 = `${suit}-${v + 1}`;
                    if ((counts[k1] || 0) > 0) {
                        const c = { ...counts };
                        c[k]--; if (c[k] === 0) delete c[k];
                        c[k1]--; if (c[k1] === 0) delete c[k1];
                        max = Math.max(max, 1 + analyzeHandValue(c));
                    }
                }
            }

            memo.set(key, max);
            _setMemo(counts, max);
            return max;
        }

        let bestValue = -Infinity;

        // 判断手牌中是否已有任何对子
        const hasAnyPair = Object.values(counts).some(c => c >= 2);

        // 无对子分支：必须预留2张牌做对子，价值减1补偿
        const noPairValue = analyzeHandValue({ ...counts });
        bestValue = Math.max(bestValue, hasAnyPair ? noPairValue : noPairValue - 1);

        // 尝试每个对子
        for (const key of Object.keys(counts)) {
            if (counts[key] < 2) continue;
            const c = { ...counts };
            c[key] -= 2;
            if (c[key] === 0) delete c[key];
            bestValue = Math.max(bestValue, analyzeHandValue(c) + 1);
        }

        // 动态计算目标面子数（台湾麻将16张=5面子，标准13张=4面子）
        const targetMelds = Math.ceil((hand.length + melds.length * 3 - 2) / 3);
        const shanten = 2 * targetMelds - 2 * melds.length - bestValue;
        return Math.max(-1, shanten);
    }

    /**
     * 七对子向听数
     */
    function calculateSevenPairsShanten(hand) {
        const counts = handToCounts(hand);
        let pairs = 0;
        for (const key of Object.keys(counts)) {
            pairs += Math.floor(counts[key] / 2);
        }
        // 七对子向听数：6 - 对子数（适用于13/14/16张等所有大小）
        return Math.max(-1, 6 - pairs);
    }

    /**
     * 十三幺向听数
     */
    function calculateThirteenOrphansShanten(hand) {
        const yaoJiuSuits = new Set(['feng', 'jian']);
        const yaoJiuValues = [1, 9];

        const counts = handToCounts(hand);
        let uniqueYaoJiu = 0;
        let hasPair = false;
        let nonYaoJiu = 0;

        for (const key of Object.keys(counts)) {
            const [suit, val] = key.split('-');
            const v = parseInt(val);
            const isYaoJiu = yaoJiuSuits.has(suit) || yaoJiuValues.includes(v);
            if (!isYaoJiu) {
                nonYaoJiu += counts[key];
                continue;
            }

            uniqueYaoJiu++;
            if (counts[key] >= 2) hasPair = true;
        }

        // 需要13种幺九牌各一张 + 其中一种对子
        // 非幺九牌必须全部替换掉
        const shanten = 13 - uniqueYaoJiu - (hasPair ? 1 : 0) + nonYaoJiu;
        return Math.max(-1, shanten);
    }

    /**
     * 综合向听数（取标准型、七对、十三幺最小值）
     */
    function calculateShanten(hand, melds = [], config = {}) {
        const standard = calculateStandardShanten(hand, melds);
        if (melds.length > 0) return standard;

        const sevenPairs = calculateSevenPairsShanten(hand);

        // 十三幺只在支持时才计算（广东/国标）
        let thirteen = Infinity;
        const type = config.mahjongType || 'guangdong';
        if (type === 'guangdong' || type === 'guobiao') {
            thirteen = calculateThirteenOrphansShanten(hand);
        }

        return Math.min(standard, sevenPairs, thirteen);
    }

    // ============================================================
    // 2. 牌效率评估
    // ============================================================

    /**
     * 计算移除某张牌后，手牌的向听数
     */
    function shantenAfterDiscard(hand, melds, tileToRemove, config) {
        const newHand = hand.filter(t => t.id !== tileToRemove.id);
        return calculateShanten(newHand, melds, config);
    }

    /**
     * 计算手牌的所有有效进张（能改进向听数或直接和牌的牌）
     * 返回 { tile, newShanten, remaining }[]
     */
    function getUsefulDraws(hand, melds, config, context) {
        const currentShanten = calculateShanten(hand, melds, config);
        const results = [];
        const allTiles = generateAllPossibleTiles(config);

        for (const tile of allTiles) {
            const testHand = [...hand, tile];
            const newShanten = calculateShanten(testHand, melds, config);
            if (newShanten < currentShanten || newShanten === -1) {
                results.push({
                    tile,
                    newShanten,
                    remaining: getTileRemaining(tile, hand, melds, context)
                });
            }
        }

        return results;
    }

    /**
     * 计算"和牌张数"（听牌时所有能和的牌的剩余总数）
     */
    function countWinningTiles(hand, melds, config, context) {
        const tingPai = Rules.analyzeTingPai(hand, config);
        let total = 0;
        for (const tp of tingPai) {
            total += getTileRemaining(tp.tile, hand, melds, context);
        }
        return total;
    }

    /**
     * 评估移除某张牌后的综合效率评分
     * 返回：向听数变化 + 和牌张数 + 听牌质量 的综合分数（越低越好）
     */
    function evaluateDiscardEfficiency(hand, melds, tileToRemove, config, context) {
        const newHand = hand.filter(t => t.id !== tileToRemove.id);
        const newShanten = calculateShanten(newHand, melds, config);

        let score = newShanten * 100; // 向听数权重最高

        if (newShanten === 0) {
            // 已听牌，评估听牌质量
            const winningTiles = countWinningTiles(newHand, melds, config, context);
            score -= winningTiles * 2; // 和牌张数越多越好

            // 评估是否好型听牌（两面听 > 坎张/边张 > 单骑）
            const tingPai = Rules.analyzeTingPai(newHand, config);
            let goodWaitCount = 0;
            for (const tp of tingPai) {
                if (isGoodWaitTile(tp.tile, newHand)) goodWaitCount++;
            }
            score -= goodWaitCount * 15;
        } else if (newShanten === 1) {
            // 接近听牌，评估进张数
            const useful = getUsefulDraws(newHand, melds, config, context);
            const totalRemaining = useful.reduce((s, u) => s + u.remaining, 0);
            score -= totalRemaining * 0.5;
        }

        return score;
    }

    /**
     * 判断某张牌是否构成"好型"听牌（两面听）
     * 例如手牌有 4-5，听 3 和 6，这两个都是好型
     */
    function isGoodWaitTile(tile, hand) {
        // 好型两面听：tile 能和手牌中的牌形成两面搭子
        // 例如手牌有 4-5，听 3 和 6 → 两面听
        // 手牌有 3-5，听 4 → 坎张听（不算好型）
        // 手牌有 1-2，听 3 → 边张听（不算好型）
        if (tile.isHonor) return false;

        const counts = handToCounts(hand);

        // 检查是否能形成两面听：手牌中有 tile-2,tile-1 或 tile-1,tile+1 或 tile+1,tile+2
        const left1 = `${tile.suit}-${tile.value - 1}`;
        const left2 = `${tile.suit}-${tile.value - 2}`;
        const right1 = `${tile.suit}-${tile.value + 1}`;
        const right2 = `${tile.suit}-${tile.value + 2}`;

        // 两面搭子：n,n+1 听 n-1 或 n+2
        if ((counts[left1] || 0) > 0 && (counts[left2] || 0) > 0) return true;
        if ((counts[left1] || 0) > 0 && (counts[right1] || 0) > 0) return true;
        if ((counts[right1] || 0) > 0 && (counts[right2] || 0) > 0) return true;

        return false;
    }

    /**
     * 生成所有可能的牌（用于听牌分析）
     */
    function generateAllPossibleTiles(config) {
        const tiles = [];
        const typeConfig = Tiles.getConfig(config.mahjongType || 'guangdong');
        if (typeConfig && typeConfig.tileSets) {
            for (const set of typeConfig.tileSets) {
                if (set.suit === 'hua') continue;
                for (let v = set.range[0]; v <= set.range[1]; v++) {
                    tiles.push(Tiles.createTile(set.suit, v));
                }
            }
        } else {
            const suits = ['wan', 'tong', 'tiao'];
            for (const suit of suits) {
                for (let v = 1; v <= 9; v++) {
                    tiles.push(Tiles.createTile(suit, v));
                }
            }
            const honors = [
                { suit: 'feng', value: 1 }, { suit: 'feng', value: 2 },
                { suit: 'feng', value: 3 }, { suit: 'feng', value: 4 },
                { suit: 'jian', value: 1 }, { suit: 'jian', value: 2 }, { suit: 'jian', value: 3 }
            ];
            for (const h of honors) {
                tiles.push(Tiles.createTile(h.suit, h.value));
            }
        }
        return tiles;
    }

    // ============================================================
    // 3. 危险牌评估
    // ============================================================

    /**
     * 评估某张牌的危险度 (0-100)
     * @param {Tile} tile
     * @param {Object} ctx - AI上下文
     */
    function evaluateDanger(tile, ctx) {
        if (!tile || !ctx) return 50;
        let danger = 10; // 基础危险度

        const discardPile = ctx.discardPile || [];
        const players = ctx.players || [];
        const doraIndicators = ctx.doraIndicators || [];
        const deckCount = ctx && ctx.deckCount !== undefined ? ctx.deckCount : 70;

        // 1. 现物安全（已出现过的牌）
        if (isGenbutsu(tile, discardPile)) {
            return 0;
        }

        // 2. 数量安全（已有几张出现）
        const appearedCount = countAppeared(tile, ctx);
        if (appearedCount >= 4) return 0; // 全出了，绝对安全
        if (appearedCount >= 3) danger -= 15;
        else if (appearedCount >= 2) danger -= 8;
        else if (appearedCount >= 1) danger -= 3;

        // 3. Dora 危险
        if (isDora(tile, doraIndicators)) danger += 35;
        if (isDoraNeighbor(tile, doraIndicators)) danger += 15;

        // 4. 筋牌安全（suji）
        const sujiReduction = getSujiReduction(tile, discardPile);
        danger -= sujiReduction;

        // 5. 壁牌（同数字4张已全出，相邻牌更安全）
        if (isWallComplete(tile, ctx)) danger -= 12;

        // 6. 别家副露影响
        for (const p of players) {
            if (p.isHu) continue;
            if (p.id === ctx.selfIndex) continue;

            // 有人副露多，听牌概率高
            const meldCount = (p.melds || []).length;
            if (meldCount >= 3) danger += 12;
            else if (meldCount >= 2) danger += 6;
            else if (meldCount >= 1) danger += 2;

            // 有人明显做清一色
            const likelySuit = estimateLikelySuit(p);
            if (likelySuit && tile.suit === likelySuit) {
                danger += 25;
            }

            // 别家打过的牌的相邻牌更安全
            const pDiscards = p.discards || [];
            if (pDiscards.length > 0) {
                danger -= getDiscardSafetyBonus(tile, pDiscards);
            }
        }

        // 7. 边张相对安全
        if (!tile.isHonor) {
            if (tile.value === 1 || tile.value === 9) danger -= 5;
            else if (tile.value === 2 || tile.value === 8) danger -= 2;
        }

        // 8. 字牌：有人碰过则比较安全（还剩1张）
        if (tile.isHonor) {
            const someoneHasPeng = players.some(p =>
                (p.melds || []).some(m =>
                    m.type === 'triplet' && m.tiles.some(t => Tiles.isSameTile(t, tile))
                )
            );
            if (someoneHasPeng) danger = 5; // 有人碰过，只剩1张，较安全
        }

        // 9. 残局放大
        if (deckCount < 15) danger *= 1.5;
        else if (deckCount < 25) danger *= 1.3;
        else if (deckCount < 40) danger *= 1.1;

        return Math.min(100, Math.max(0, danger));
    }

    /**
     * 是否现物（已在弃牌堆中出现）
     */
    function isGenbutsu(tile, discardPile) {
        if (!discardPile || !tile) return false;
        return discardPile.some(t => Tiles.isSameTile(t, tile));
    }

    /**
     * 某张牌已出现的总次数（弃牌+副露）
     */
    function countAppeared(tile, ctx) {
        let count = 0;
        const discardPile = ctx.discardPile || [];
        const players = ctx.players || [];

        for (const t of discardPile) {
            if (Tiles.isSameTile(t, tile)) count++;
        }

        for (const p of players) {
            for (const m of (p.melds || [])) {
                for (const t of (m.tiles || [])) {
                    if (Tiles.isSameTile(t, tile)) count++;
                }
            }
        }

        // 自己的手牌
        const self = players.find(p => p.id === ctx.selfIndex);
        if (self && self.hand) {
            for (const t of self.hand) {
                if (Tiles.isSameTile(t, tile)) count++;
            }
        }

        return count;
    }

    /**
     * 是否 Dora
     */
    function isDora(tile, doraIndicators) {
        if (!doraIndicators || !tile) return false;
        for (const d of doraIndicators) {
            // Dora 是 indicator 的下一张，indicator 本身不算 dora
            if (!d.isHonor && !tile.isHonor && d.suit === tile.suit) {
                if (d.value + 1 === tile.value) return true;
                // 数牌循环：9的下一张是1
                if (d.value === 9 && tile.value === 1) return true;
            }
            // 风牌循环
            if (d.suit === 'feng' && tile.suit === 'feng') {
                if ((d.value % 4) + 1 === tile.value) return true;
            }
            // 箭牌循环
            if (d.suit === 'jian' && tile.suit === 'jian') {
                if ((d.value % 3) + 1 === tile.value) return true;
            }
        }
        return false;
    }

    /**
     * 是否 Dora 邻居（dora 的 ±1）
     */
    function isDoraNeighbor(tile, doraIndicators) {
        if (!doraIndicators || !tile || tile.isHonor) return false;
        for (const d of doraIndicators) {
            if (d.isHonor) continue;
            if (d.suit !== tile.suit) continue;
            if (d.value !== tile.value && Math.abs(d.value - tile.value) <= 1) return true;
        }
        return false;
    }

    /**
     * 获取筋牌安全度减免
     * 如果弃牌中有 tile.value ±3 的同花色牌，则 tile 是筋牌
     */
    function getSujiReduction(tile, discardPile) {
        if (!tile || tile.isHonor || !discardPile) return 0;
        let reduction = 0;

        for (const d of discardPile) {
            if (d.isHonor) continue;
            if (d.suit !== tile.suit) continue;
            const diff = Math.abs(d.value - tile.value);
            if (diff === 3) {
                reduction = Math.max(reduction, 10);
            } else if (diff === 6) {
                reduction = Math.max(reduction, 5);
            }
        }

        return reduction;
    }

    /**
     * 壁牌是否完整（该牌4张已全部出现）
     */
    function isWallComplete(tile, ctx) {
        return countAppeared(tile, ctx) >= 4;
    }

    /**
     * 某玩家的弃牌带来的安全加分
     */
    function getDiscardSafetyBonus(tile, playerDiscards) {
        if (!tile || !playerDiscards) return 0;
        let bonus = 0;

        for (const d of playerDiscards) {
            if (Tiles.isSameTile(d, tile)) {
                bonus = Math.max(bonus, 15); // 现物
                break;
            }
            if (!d.isHonor && !tile.isHonor && d.suit === tile.suit) {
                const diff = Math.abs(d.value - tile.value);
                if (diff <= 1) bonus = Math.max(bonus, 5);
                if (diff === 3) bonus = Math.max(bonus, 8);
            }
        }

        return bonus;
    }

    /**
     * 估算某玩家的主攻花色（从副露和弃牌推断）
     */
    function estimateLikelySuit(player) {
        if (!player || !player.melds) return null;

        const suitCounts = {};
        const allMelds = player.melds;

        for (const m of allMelds) {
            for (const t of (m.tiles || [])) {
                if (t.isHonor) continue;
                suitCounts[t.suit] = (suitCounts[t.suit] || 0) + 1;
            }
        }

        const discards = player.discards || [];
        // 弃牌中某花色很少，可能在做该花色（四川麻将特征更明显）
        for (const t of discards) {
            if (t.isHonor) continue;
            // 这里不增加计数，因为我们要找的是"保留"的花色
        }

        const entries = Object.entries(suitCounts);
        if (entries.length === 0) return null;

        entries.sort((a, b) => b[1] - a[1]);
        // 只有某花色明显占多才推断
        if (entries[0][1] >= 6) return entries[0][0];
        return null;
    }

    /**
     * 估算某玩家的听牌概率 (0-1)
     */
    function estimateTenpaiProbability(player, ctx) {
        if (!player) return 0;
        if (player.isHu) return 1;

        let prob = 0;
        const meldCount = (player.melds || []).length;
        const discardCount = (player.discards || []).length;
        const deckCount = ctx && ctx.deckCount !== undefined ? ctx.deckCount : 70;

        // 副露越多越可能听牌
        if (meldCount >= 3) prob += 0.4;
        else if (meldCount >= 2) prob += 0.25;
        else if (meldCount >= 1) prob += 0.1;

        // 弃牌越少（刚摸牌后），越可能手牌整齐
        if (discardCount <= 3) prob += 0.1;

        // 残局听牌概率更高
        if (deckCount < 20) prob += 0.2;
        else if (deckCount < 40) prob += 0.1;

        // 某家很久没副露但在打安全牌，可能听牌了
        // 简化：如果副露数多 + 弃牌中有安全牌模式（现物）
        const discards = player.discards || [];
        const discardPile = ctx.discardPile || [];
        if (discards.length > 5) {
            const safeDiscards = discards.filter(d => isGenbutsu(d, discardPile)).length;
            if (safeDiscards / discards.length > 0.5) prob += 0.15;
        }

        return Math.min(1, prob);
    }

    // ============================================================
    // 4. 四川麻将专用
    // ============================================================

    /**
     * 评估选择哪门缺最优
     * 返回 { suit, shantenAfter, tileCount }
     */
    function evaluateQueYiMenChoice(hand, config) {
        const suitCounts = {};
        const suitTiles = {};

        for (const tile of hand) {
            if (tile.isHonor || tile.isFlower) continue;
            suitCounts[tile.suit] = (suitCounts[tile.suit] || 0) + 1;
            if (!suitTiles[tile.suit]) suitTiles[tile.suit] = [];
            suitTiles[tile.suit].push(tile);
        }

        const suits = Object.keys(suitCounts);
        if (suits.length === 0) return { suit: 'wan', shantenAfter: 0, tileCount: 0 };

        let best = null;
        let bestScore = Infinity;

        for (const suit of suits) {
            const tiles = suitTiles[suit];
            const count = tiles.length;

            // 模拟去掉该花色后的向听数
            const remainingHand = hand.filter(t => t.suit !== suit || t.isHonor);
            const shanten = calculateShanten(remainingHand, [], config);

            // 评分：向听数 + 需要弃掉的牌数惩罚
            // 优先选择牌数少的，但如果去掉后向听数大增则不选
            const score = shanten * 30 + count * 5;

            if (score < bestScore) {
                bestScore = score;
                best = { suit, shantenAfter: shanten, tileCount: count };
            }
        }

        // 如果某花色只有1张且去掉后向听数不变，优先选
        for (const suit of suits) {
            if (suitCounts[suit] === 1) {
                const remainingHand = hand.filter(t => t.suit !== suit || t.isHonor);
                const shanten = calculateShanten(remainingHand, [], config);
                if (shanten <= (best ? best.shantenAfter : 99)) {
                    best = { suit, shantenAfter: shanten, tileCount: 1 };
                    break;
                }
            }
        }

        return best || { suit: suits[0], shantenAfter: 0, tileCount: suitCounts[suits[0]] };
    }

    /**
     * 获取缺门进度 (0-1)
     */
    function getQueYiMenProgress(hand, queYiMenSuit) {
        if (!queYiMenSuit) return 1;
        const queTiles = hand.filter(t => t.suit === queYiMenSuit && !t.isHonor && !t.isFlower);
        const totalQueAtStart = 13; // 假设初始有13张牌，缺门花色平均约4-5张
        // 更精确：计算初始手牌中缺门花色的数量（历史追踪更好，但这里简化）
        return Math.max(0, 1 - queTiles.length / 5);
    }

    /**
     * 是否应优先清缺门（而不是先听牌）
     */
    function shouldPrioritizeQueYiMen(hand, queYiMenSuit, shanten) {
        if (!queYiMenSuit) return false;
        const queTiles = hand.filter(t => t.suit === queYiMenSuit && !t.isHonor);
        if (queTiles.length === 0) return false;

        // 快听牌时，先听牌
        if (shanten <= 1) return false;

        // 缺门牌多时优先清
        if (queTiles.length >= 4) return true;
        if (queTiles.length >= 2 && shanten >= 3) return true;

        return false;
    }

    // ============================================================
    // 5. 杠决策
    // ============================================================

    /**
     * 评估杠的风险收益
     * @param {Player} player
     * @param {string} gangType - 'an_gang' | 'ming_gang' | 'jia_gang'
     * @param {Object} ctx
     * @returns {number} 净收益评分（正数=应该杠）
     */
    function evaluateGangRiskReward(player, gangType, ctx) {
        if (!player || !ctx) return 0;

        const deckCount = ctx && ctx.deckCount !== undefined ? ctx.deckCount : 70;
        const players = ctx.players || [];
        const config = ctx.config || {};

        let reward = 0;
        let risk = 0;

        // 收益
        // 杠分
        reward += 20;

        // 岭上开花期望（摸一张牌）
        if (deckCount > 0) {
            reward += 15; // 摸牌的期望价值
        }

        // Dora/翻宝牌额外收益
        if (ctx.doraIndicators && ctx.doraIndicators.length > 0) {
            reward += 10; // 可能翻到宝牌
        }

        // 风险
        if (gangType === 'ming_gang') {
            // 明杠可能被抢
            const robProb = estimateRobGangProbability(player, ctx);
            risk += robProb * 80; // 被抢平均损失80分
        }

        if (gangType === 'jia_gang') {
            // 加杠最容易被抢
            const robProb = estimateRobGangProbability(player, ctx) * 1.5;
            risk += robProb * 80;
        }

        if (gangType === 'an_gang') {
            // 暗杠不会被抢，但听牌后杠会破坏听牌
            if (calculateShanten(player.hand, player.melds, config) === 0) {
                // 听牌后暗杠：要换一张牌，可能破坏听牌
                risk += 30;
            }
        }

        // 残局降低杠的价值（摸牌价值降低，风险增加）
        if (deckCount < 15) {
            reward *= 0.5;
            risk *= 1.5;
        } else if (deckCount < 25) {
            reward *= 0.7;
            risk *= 1.2;
        }

        // 别家听牌概率高时，减少杠
        for (const p of players) {
            if (p.id === player.id) continue;
            if (p.isHu) continue;
            const tenpaiProb = estimateTenpaiProbability(p, ctx);
            risk += tenpaiProb * 25;
        }

        return reward - risk;
    }

    /**
     * 估算被抢杠概率
     */
    function estimateRobGangProbability(player, ctx) {
        if (!ctx) return 0;
        const players = ctx.players || [];
        let prob = 0;

        for (const p of players) {
            if (p.id === player.id) continue;
            if (p.isHu) continue;
            prob = Math.max(prob, estimateTenpaiProbability(p, ctx));
        }

        return prob;
    }

    // ============================================================
    // 6. 通用工具
    // ============================================================

    /**
     * 获取某张牌的更准确剩余张数
     * 考虑：自己手牌、副露、弃牌堆
     */
    function getTileRemaining(tile, hand, melds, ctx) {
        let used = 0;

        // 自己手牌
        for (const t of (hand || [])) {
            if (Tiles.isSameTile(t, tile)) used++;
        }

        // 自己的副露
        for (const m of (melds || [])) {
            for (const t of (m.tiles || [])) {
                if (Tiles.isSameTile(t, tile)) used++;
            }
        }

        // 弃牌堆
        if (ctx && ctx.discardPile) {
            for (const t of ctx.discardPile) {
                if (Tiles.isSameTile(t, tile)) used++;
            }
        }

        // 别家副露
        if (ctx && ctx.players) {
            for (const p of ctx.players) {
                if (p.id === ctx.selfIndex) continue;
                for (const m of (p.melds || [])) {
                    for (const t of (m.tiles || [])) {
                        if (Tiles.isSameTile(t, tile)) used++;
                    }
                }
            }
        }

        return Math.max(0, 4 - used);
    }

    /**
     * 模拟执行某个动作后的状态（用于策略评估）
     */
    function simulateAction(hand, melds, action, tile) {
        // action: 'chi', 'peng', 'gang', etc.
        // 返回模拟后的 { hand, melds }
        const newHand = [...hand];
        const newMelds = [...melds];

        switch (action) {
            case 'peng': {
                const sameTiles = newHand.filter(t => Tiles.isSameTile(t, tile)).slice(0, 2);
                for (const t of sameTiles) {
                    const idx = newHand.findIndex(h => h.id === t.id);
                    if (idx >= 0) newHand.splice(idx, 1);
                }
                newMelds.push({ type: 'triplet', tiles: [...sameTiles, tile] });
                break;
            }
            case 'gang': {
                const sameTiles = newHand.filter(t => Tiles.isSameTile(t, tile)).slice(0, 3);
                for (const t of sameTiles) {
                    const idx = newHand.findIndex(h => h.id === t.id);
                    if (idx >= 0) newHand.splice(idx, 1);
                }
                newMelds.push({ type: 'quad', tiles: [...sameTiles, tile] });
                break;
            }
            // chi 的模拟需要具体知道吃哪两张，这里简化
            default:
                break;
        }

        return { hand: newHand, melds: newMelds };
    }

    /**
     * 基础牌效率评分（类似旧的 evaluateHand 但更准确）
     */
    function evaluateTileValue(tile, hand, melds, level) {
        if (!tile) return 0;
        let score = 0;
        const counts = handToCounts(hand);
        const key = `${tile.suit}-${tile.value}`;
        const count = counts[key] || 0;

        // 花牌：极高价值
        if (tile.isFlower) return -1000;

        // 字牌
        if (tile.isHonor) {
            if (count >= 2) score -= count * 4;
            else score += 6;
            return score;
        }

        // 数牌
        if (count >= 3) score -= 10;
        else if (count === 2) score -= 6;

        // 顺子潜力
        const leftKey = `${tile.suit}-${tile.value - 1}`;
        const rightKey = `${tile.suit}-${tile.value + 1}`;
        const left2Key = `${tile.suit}-${tile.value - 2}`;
        const right2Key = `${tile.suit}-${tile.value + 2}`;

        const hasLeft = (counts[leftKey] || 0) > 0;
        const hasRight = (counts[rightKey] || 0) > 0;
        const hasLeft2 = (counts[left2Key] || 0) > 0;
        const hasRight2 = (counts[right2Key] || 0) > 0;

        if (hasLeft && hasRight) score -= 9; // 两边都有，强搭子
        else if (hasLeft || hasRight) score -= 4; // 单边
        else if (hasLeft2 || hasRight2) score -= 1; // 间张潜力

        // 边张惩罚
        if (tile.value === 1 || tile.value === 9) score += 3;
        else if (tile.value === 2 || tile.value === 8) score += 1;

        // 中张奖励
        if (tile.value >= 4 && tile.value <= 6) score -= 2;

        // 高等级：考虑向听数影响
        if (level === 'hard' || level === 'expert') {
            // 向听数影响由策略类统一计算，此处省略以避免重复
        }

        return score;
    }

    /**
     * 获取手牌中每种花色的数量
     */
    function getSuitDistribution(hand) {
        const dist = {};
        for (const tile of hand) {
            if (tile.isHonor || tile.isFlower) continue;
            dist[tile.suit] = (dist[tile.suit] || 0) + 1;
        }
        return dist;
    }

    /**
     * 获取手牌中所有搭子（两个可以组成面子的牌）
     */
    function findAllShapes(hand) {
        const shapes = [];
        const counts = handToCounts(hand);

        for (const key of Object.keys(counts)) {
            const [suit, val] = key.split('-');
            const v = parseInt(val);

            if (suit === 'feng' || suit === 'jian') {
                // 字牌：对子就是搭子
                if (counts[key] >= 2) {
                    shapes.push({ type: 'pair', tiles: [key, key], suit });
                }
                continue;
            }

            // 对子
            if (counts[key] >= 2) {
                shapes.push({ type: 'pair', tiles: [key, key], suit, value: v });
            }

            // 两面搭子 (n, n+1)
            const nextKey = `${suit}-${v + 1}`;
            if (counts[nextKey] > 0) {
                shapes.push({ type: 'ryanmen', tiles: [key, nextKey], suit, values: [v, v + 1] });
            }

            // 坎张搭子 (n, n+2)
            const skipKey = `${suit}-${v + 2}`;
            if (counts[skipKey] > 0) {
                shapes.push({ type: 'kanchan', tiles: [key, skipKey], suit, values: [v, v + 2] });
            }
        }

        // 去重
        const seen = new Set();
        return shapes.filter(s => {
            const sig = s.tiles.sort().join(',');
            if (seen.has(sig)) return false;
            seen.add(sig);
            return true;
        });
    }

    // ============================================================
    // 导出
    // ============================================================

    return {
        // 向听数
        calculateShanten,
        calculateStandardShanten,
        calculateSevenPairsShanten,
        calculateThirteenOrphansShanten,

        // 牌效率
        shantenAfterDiscard,
        getUsefulDraws,
        countWinningTiles,
        evaluateDiscardEfficiency,
        isGoodWaitTile,
        generateAllPossibleTiles,

        // 危险评估
        evaluateDanger,
        isGenbutsu,
        countAppeared,
        isDora,
        isDoraNeighbor,
        getSujiReduction,
        isWallComplete,
        estimateLikelySuit,
        estimateTenpaiProbability,

        // 四川麻将
        evaluateQueYiMenChoice,
        getQueYiMenProgress,
        shouldPrioritizeQueYiMen,

        // 杠决策
        evaluateGangRiskReward,
        estimateRobGangProbability,

        // 通用工具
        getTileRemaining,
        simulateAction,
        evaluateTileValue,
        getSuitDistribution,
        findAllShapes,
        handToCounts,
    };
})();
