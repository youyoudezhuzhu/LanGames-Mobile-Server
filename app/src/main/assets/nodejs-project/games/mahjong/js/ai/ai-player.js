/**
 * 万能麻将 - AI 策略系统
 * 分层策略架构：简单/普通/困难/专家，每层有明确可感知的差异
 */

const AIPlayer = (function() {
    'use strict';

    // ============================================================
    // 策略基类
    // ============================================================

    class BaseStrategy {
        constructor(difficulty) {
            this.difficulty = difficulty;
            this.name = 'base';
        }

        // ---- 抽象决策接口 ----
        chooseDiscard(player, context) {
            throw new Error('chooseDiscard not implemented');
        }

        shouldAnGang(player, options, context) {
            throw new Error('shouldAnGang not implemented');
        }

        shouldAction(player, action, tile, context) {
            throw new Error('shouldAction not implemented');
        }

        chooseChiOption(player, options, context) {
            // 默认选第一种吃法
            return options[0];
        }

        // ---- 公共工具方法 ----

        /**
         * 计算当前向听数
         */
        _shanten(player, context) {
            return AIUtils.calculateShanten(player.hand, player.melds, context?.ruleConfig || {});
        }

        /**
         * 某张牌的危险度
         */
        _danger(tile, context) {
            if (!context) return 50;
            return AIUtils.evaluateDanger(tile, context);
        }

        /**
         * 是否现物
         */
        _isGenbutsu(tile, context) {
            if (!context || !context.discardPile) return false;
            return AIUtils.isGenbutsu(tile, context.discardPile);
        }

        /**
         * 获取候选弃牌（排除花牌）
         */
        _getCandidates(hand, player = null, context = null) {
            const candidates = hand.filter(t => !t.isFlower);
            const isSichuan = context?.config?.mahjongType === 'sichuan'
                || context?.ruleConfig?.queYiMen === true;
            if (isSichuan && player?.queYiMen) {
                const queTiles = candidates.filter(tile => tile.suit === player.queYiMen);
                if (queTiles.length > 0) return queTiles;
            }
            return candidates;
        }

        /**
         * 基础牌价值评分（越高越应该打）
         */
        _baseTileScore(tile, hand, melds) {
            return AIUtils.evaluateTileValue(tile, hand, melds, this.difficulty);
        }

        /**
         * 某张牌移除后的向听数
         */
        _shantenAfterRemove(player, tile, context) {
            const newHand = player.hand.filter(t => t.id !== tile.id);
            return AIUtils.calculateShanten(newHand, player.melds, context?.ruleConfig || {});
        }

        /**
         * 获取所有搭子
         */
        _shapes(player) {
            return AIUtils.findAllShapes(player.hand);
        }

        /**
         * 是否听牌
         */
        _isTenpai(player, context) {
            return this._shanten(player, context) === 0;
        }

        /**
         * 牌墙剩余数
         */
        _deckCount(context) {
            return context && context.deckCount !== undefined ? context.deckCount : 70;
        }

        /**
         * 副露数
         */
        _meldCount(player) {
            return (player.melds || []).length;
        }

        /**
         * 对手最高听牌概率
         */
        _maxOpponentTenpaiProb(context) {
            if (!context || !context.players) return 0;
            let max = 0;
            for (const p of context.players) {
                if (p.id === context.selfIndex) continue;
                max = Math.max(max, AIUtils.estimateTenpaiProbability(p, context));
            }
            return max;
        }

        /**
         * 别家已副露的总数（最多的一家）
         */
        _maxOpponentMelds(context) {
            if (!context || !context.players) return 0;
            let max = 0;
            for (const p of context.players) {
                if (p.id === context.selfIndex) continue;
                max = Math.max(max, (p.melds || []).length);
            }
            return max;
        }

        /**
         * 是否有人明显做清一色
         */
        _someoneDoingPureColor(context, suit) {
            if (!context || !context.players) return false;
            for (const p of context.players) {
                if (p.id === context.selfIndex) continue;
                const likelySuit = AIUtils.estimateLikelySuit(p);
                if (likelySuit && likelySuit === suit) return true;
            }
            return false;
        }

        /**
         * 四川缺门相关
         */
        _queYiMenTiles(player) {
            if (!player.queYiMen) return [];
            return player.hand.filter(t => t.suit === player.queYiMen && !t.isHonor && !t.isFlower);
        }

        _hasQueYiMen(player) {
            return !!player.queYiMen;
        }

        /**
         * 随机波动（用于引入不确定性）
         */
        _randomize(score, range) {
            return score + (Math.random() - 0.5) * range * 2;
        }

        /**
         * 听牌张数
         */
        _winningTilesCount(player, context) {
            return AIUtils.countWinningTiles(player.hand, player.melds, context?.ruleConfig || {}, context);
        }

        /**
         * 模拟吃后的向听数变化
         */
        _shantenAfterChi(player, chiTiles, context) {
            const usedFromHand = chiTiles.filter(t => player.hand.some(h => h.id === t.id));
            let newHand = player.hand.filter(t => !usedFromHand.some(u => u.id === t.id));
            const newMelds = [...player.melds, { type: 'sequence', tiles: chiTiles }];
            // 吃后必须弃一张牌，模拟弃掉最优的一张
            let bestShanten = Infinity;
            for (const t of newHand) {
                const testHand = newHand.filter(h => h.id !== t.id);
                const s = AIUtils.calculateShanten(testHand, newMelds, context?.ruleConfig || {});
                if (s < bestShanten) bestShanten = s;
            }
            return bestShanten;
        }

        /**
         * 模拟碰后的向听数变化
         */
        _shantenAfterPeng(player, tile, context) {
            const sameTiles = player.hand.filter(t => Tiles.isSameTile(t, tile)).slice(0, 2);
            let newHand = player.hand.filter(t => !sameTiles.some(s => s.id === t.id));
            const newMelds = [...player.melds, { type: 'triplet', tiles: [...sameTiles, tile] }];
            // 碰后必须弃一张牌，模拟弃掉最优的一张
            let bestShanten = Infinity;
            for (const t of newHand) {
                const testHand = newHand.filter(h => h.id !== t.id);
                const s = AIUtils.calculateShanten(testHand, newMelds, context?.ruleConfig || {});
                if (s < bestShanten) bestShanten = s;
            }
            return bestShanten;
        }

        /**
         * 模拟明杠后的向听数变化
         */
        _shantenAfterGang(player, tile, context) {
            const sameTiles = player.hand.filter(t => Tiles.isSameTile(t, tile)).slice(0, 3);
            const newHand = player.hand.filter(t => !sameTiles.some(s => s.id === t.id));
            const newMelds = [...player.melds, { type: 'quad', tiles: [...sameTiles, tile] }];
            return AIUtils.calculateShanten(newHand, newMelds, context?.ruleConfig || {});
        }
    }

    // ============================================================
    // 1. 简单策略 — "会玩但常犯错"
    // ============================================================

    class EasyStrategy extends BaseStrategy {
        constructor() { super('easy'); this.name = '简单'; }

        chooseDiscard(player, context) {
            const hand = player.hand;
            const candidates = this._getCandidates(hand, player, context);
            if (candidates.length === 0) return hand[0] || null;

            // 50% 概率随机打（犯错）
            if (Math.random() < 0.5) {
                return candidates[Math.floor(Math.random() * candidates.length)];
            }

            // 50% 概率稍微合理一点：优先打孤张字牌
            const honorTiles = candidates.filter(t => t.isHonor);
            const singleHonors = honorTiles.filter(t => {
                const count = hand.filter(h => h.suit === t.suit && h.value === t.value).length;
                return count === 1;
            });
            if (singleHonors.length > 0) {
                return singleHonors[Math.floor(Math.random() * singleHonors.length)];
            }

            // 然后随机
            return candidates[Math.floor(Math.random() * candidates.length)];
        }

        shouldAnGang(player, options, context) {
            if (!options || options.length === 0) return false;
            return Math.random() < 0.3;
        }

        shouldAction(player, action, tile, context) {
            if (!action) return false;
            if (action.type === 'hu') return true;
            return Math.random() < 0.4; // 40% 随机接受吃碰杠
        }

        chooseChiOption(player, options, context) {
            return options[Math.floor(Math.random() * options.length)];
        }
    }

    // ============================================================
    // 2. 普通策略 — "有基本牌感"
    // ============================================================

    class NormalStrategy extends BaseStrategy {
        constructor() { super('normal'); this.name = '普通'; }

        chooseDiscard(player, context) {
            const hand = player.hand;
            const melds = player.melds;
            const candidates = this._getCandidates(hand, player, context);
            if (candidates.length === 0) return hand[0] || null;

            const ctx = context || {};
            const isSichuan = ctx.config?.mahjongType === 'sichuan';

            // 基础评分
            const scored = candidates.map(tile => {
                let score = this._baseTileScore(tile, hand, melds);
                const newShanten = this._shantenAfterRemove(player, tile, ctx);

                // 四川缺门：优先打完缺门花色（加分=更该打）
                if (isSichuan && player.queYiMen && tile.suit === player.queYiMen) {
                    score += 80;
                }

                // 残局基础防守：最后8张优先现物（安全牌更该打）
                if (this._deckCount(ctx) < 8 && this._isGenbutsu(tile, ctx)) {
                    score += 15;
                }

                // 随机波动 20%
                score = this._randomize(score, 3);

                return { tile, score, newShanten };
            });

            const bestShanten = Math.min(...scored.map(item => item.newShanten));
            const efficient = scored.filter(item => item.newShanten === bestShanten);
            efficient.sort((a, b) => b.score - a.score);
            return efficient[0].tile;
        }

        shouldAnGang(player, options, context) {
            if (!options || options.length === 0) return false;

            const option = options[0];

            // 听牌了不打杠
            if (this._isTenpai(player, context)) return false;

            if (option.type === 'an_gang') {
                return Math.random() < 0.7;
            }

            if (option.type === 'jia_gang') {
                // 加杠谨慎一点
                if (this._maxOpponentMelds(context) >= 2) return Math.random() < 0.3;
                return Math.random() < 0.5;
            }

            return Math.random() < 0.5;
        }

        shouldAction(player, action, tile, context) {
            if (!action) return false;
            if (action.type === 'hu') return true;

            const shanten = this._shanten(player, context);
            const isSichuan = context?.config?.mahjongType === 'sichuan';

            switch (action.type) {
                case 'chi': {
                    // 20% 冲动吃
                    if (Math.random() < 0.2) return true;

                    // 吃后向听数减少才吃（选最优吃法评估）
                    const bestOption = this.chooseChiOption(player, action.options, context);
                    const newShanten = this._shantenAfterChi(player, bestOption, context);
                    if (newShanten < shanten) return true;

                    // 向听数不变但形成好型听牌
                    if (newShanten === shanten && newShanten === 0) {
                        // 检查是否好型听牌
                        const testHand = [...player.hand];
                        // 简化：接受
                        return Math.random() < 0.4;
                    }

                    return false;
                }

                case 'peng': {
                    // 风牌/箭牌优先碰
                    if (tile.isHonor) return true;

                    // 碰后向听数减少才碰
                    const newShanten = this._shantenAfterPeng(player, tile, context);
                    if (newShanten < shanten) return true;

                    // 有4张潜力（未来可以杠）
                    const handCounts = AIUtils.handToCounts(player.hand);
                    const key = `${tile.suit}-${tile.value}`;
                    if ((handCounts[key] || 0) >= 3) {
                        return Math.random() < 0.5;
                    }

                    return false;
                }

                case 'gang': {
                    // 明杠：别家副露多拒绝
                    if (this._maxOpponentMelds(context) >= 2) {
                        return Math.random() < 0.3;
                    }
                    return Math.random() < 0.6;
                }

                default:
                    return false;
            }
        }

        chooseChiOption(player, options, context) {
            if (!options || options.length === 0) return null;
            if (options.length === 1) return options[0];

            // 选择吃后向听数最小的
            let best = options[0];
            let bestShanten = this._shantenAfterChi(player, options[0], context);

            for (const opt of options.slice(1)) {
                const s = this._shantenAfterChi(player, opt, context);
                if (s < bestShanten) {
                    bestShanten = s;
                    best = opt;
                }
            }

            return best;
        }
    }

    // ============================================================
    // 3. 困难策略 — "向听数驱动 + 有防守"
    // ============================================================

    class HardStrategy extends BaseStrategy {
        constructor() { super('hard'); this.name = '困难'; }

        chooseDiscard(player, context) {
            const hand = player.hand;
            const melds = player.melds;
            const candidates = this._getCandidates(hand, player, context);
            if (candidates.length === 0) return hand[0] || null;

            const ctx = context || {};
            const shanten = this._shanten(player, ctx);
            const deckCount = this._deckCount(ctx);
            const isSichuan = ctx.config?.mahjongType === 'sichuan';

            // 评估每个候选
            const scored = candidates.map(tile => {
                let score = this._baseTileScore(tile, hand, melds);

                // 1. 向听数驱动：打完后向听数的影响
                const newShanten = this._shantenAfterRemove(player, tile, ctx);
                const shantenDiff = newShanten - shanten;
                score -= shantenDiff * 50; // 向听数增加→该牌有价值→降低弃牌意愿

                // 2. 听牌效率：打完后如果听牌，评估和牌张数（好弃牌加分）
                if (newShanten === 0) {
                    const newHand = hand.filter(t => t.id !== tile.id);
                    const winningTiles = AIUtils.countWinningTiles(newHand, melds, ctx.ruleConfig || {}, ctx);
                    score += winningTiles * 1.5;
                }

                // 3. 四川缺门（缺门牌加分=更该打）
                if (isSichuan && player.queYiMen) {
                    if (tile.suit === player.queYiMen) {
                        score += 100;
                    }
                    // 快听牌时，如果缺门只剩1张且是好牌，可能暂缓
                    const queTiles = this._queYiMenTiles(player);
                    if (queTiles.length === 1 && shanten <= 1) {
                        if (tile.suit === player.queYiMen) {
                            // 如果是唯一一张缺门牌，且快听牌，根据情况
                            const queTileValue = this._baseTileScore(queTiles[0], hand, melds);
                            if (queTileValue < -5) { // 是好牌
                                score += 30; // 不那么急着打
                            }
                        }
                    }
                }

                // 4. 危险度评估（危险牌减分=更不该打）
                const danger = this._danger(tile, ctx);
                if (shanten >= 2) {
                    // 未听牌时，适度考虑防守
                    score -= danger * 0.3;
                } else {
                    // 听牌后，危险度权重提高
                    score -= danger * 0.8;
                }

                // 5. 残局防守
                if (deckCount < 20) {
                    score -= danger * 0.5;
                }
                if (deckCount < 10) {
                    score -= danger * 0.8;
                }

                // 6. 对手听牌概率高时加强防守
                const maxTenpai = this._maxOpponentTenpaiProb(ctx);
                if (maxTenpai > 0.5) {
                    score -= danger * 0.4;
                }

                // 7. 有人做清一色时避开该花色（该花色减分=更不该打）
                if (this._someoneDoingPureColor(ctx, tile.suit)) {
                    score -= 20;
                }

                return { tile, score };
            });

            scored.sort((a, b) => b.score - a.score);

            // Top-3 中比较听牌效率
            const topTiles = scored.slice(0, Math.min(3, scored.length));
            if (topTiles.length === 1) return topTiles[0].tile;

            let bestTile = topTiles[0].tile;
            let bestEfficiency = -Infinity;

            for (const item of topTiles) {
                const newHand = hand.filter(t => t.id !== item.tile.id);
                const newShanten = AIUtils.calculateShanten(newHand, melds, ctx.ruleConfig || {});

                let efficiency = 0;
                if (newShanten === 0) {
                    efficiency = AIUtils.countWinningTiles(newHand, melds, ctx.ruleConfig || {});
                } else if (newShanten === 1) {
                    const useful = AIUtils.getUsefulDraws(newHand, melds, ctx.ruleConfig || {}, ctx);
                    efficiency = useful.reduce((s, u) => s + u.remaining, 0);
                }

                // 综合：基础分 + 效率（分数越高越该打）
                const total = item.score + efficiency * 0.5;
                if (total > bestEfficiency) {
                    bestEfficiency = total;
                    bestTile = item.tile;
                }
            }

            return bestTile;
        }

        shouldAnGang(player, options, context) {
            if (!options || options.length === 0) return false;

            const option = options[0];
            const ctx = context || {};
            const shanten = this._shanten(player, ctx);
            const deckCount = this._deckCount(ctx);

            if (option.type === 'an_gang') {
                // 听牌前：几乎总是杠
                if (shanten > 0) {
                    const rr = AIUtils.evaluateGangRiskReward(player, 'an_gang', ctx);
                    return rr > -10; // 稍微负收益也接受
                }
                // 听牌后：评估换牌安全性
                const rr = AIUtils.evaluateGangRiskReward(player, 'an_gang', ctx);
                return rr > 5;
            }

            if (option.type === 'jia_gang') {
                // 非常谨慎
                const rr = AIUtils.evaluateGangRiskReward(player, 'jia_gang', ctx);
                return rr > 15;
            }

            return false;
        }

        shouldAction(player, action, tile, context) {
            if (!action) return false;
            if (action.type === 'hu') return true;

            const ctx = context || {};
            const shanten = this._shanten(player, ctx);
            const deckCount = this._deckCount(ctx);
            const maxTenpai = this._maxOpponentTenpaiProb(ctx);

            switch (action.type) {
                case 'chi': {
                    const options = action.options || [];
                    if (options.length === 0) return false;

                    // 选最优吃法
                    const bestOption = this.chooseChiOption(player, options, context);
                    const newShanten = this._shantenAfterChi(player, bestOption, context);

                    // 向听数增加：绝对不吃
                    if (newShanten > shanten) return false;

                    // 向听数不变：只有已形成听牌且是好型才吃
                    if (newShanten === shanten) {
                        if (shanten === 0 && tile.value >= 3 && tile.value <= 7) return true;
                        return false;
                    }

                    // 残局不吃（减少摸牌次数）
                    if (deckCount < 15 && newShanten > 0) return false;

                    return true;
                }

                case 'peng': {
                    // 风牌/箭牌总是碰（增加番数）
                    if (tile.isHonor) return true;

                    const newShanten = this._shantenAfterPeng(player, tile, context);

                    // 碰后向听数减少才碰
                    if (newShanten < shanten) return true;

                    // 向听数不变但有4张潜力（未来杠）
                    const handCounts = AIUtils.handToCounts(player.hand);
                    const key = `${tile.suit}-${tile.value}`;
                    if ((handCounts[key] || 0) >= 3) {
                        // 有暗刻，碰了可以明杠或加杠
                        if (maxTenpai < 0.3) return true; // 别家不太听牌时可以碰
                    }

                    // 残局不碰（减少摸牌）
                    if (deckCount < 15) return false;

                    return false;
                }

                case 'gang': {
                    const rr = AIUtils.evaluateGangRiskReward(player, 'ming_gang', ctx);
                    return rr > 5;
                }

                default:
                    return false;
            }
        }

        chooseChiOption(player, options, context) {
            if (!options || options.length === 0) return null;
            if (options.length === 1) return options[0];

            let best = options[0];
            let bestScore = -Infinity;

            for (const opt of options) {
                const newShanten = this._shantenAfterChi(player, opt, context);
                let score = -newShanten * 50;

                // 偏好中张吃（如 4-5 吃 3 或 6，比 1-2 吃 3 好）
                const optValues = opt.map(t => t.value);
                const midValue = optValues.reduce((a, b) => a + b, 0) / optValues.length;
                if (midValue >= 4 && midValue <= 6) score += 10;

                // 偏好保留边张（不吃会破坏边张的）
                // 简化：吃的牌本身是边张的不吃
                const tile = opt.find(t => !player.hand.some(h => h.id === t.id));
                if (tile && (tile.value === 1 || tile.value === 9)) score -= 5;

                if (score > bestScore) {
                    bestScore = score;
                    best = opt;
                }
            }

            return best;
        }
    }

    // ============================================================
    // 4. 专家策略 — "完整对手建模 + EV 最大化"
    // ============================================================

    class ExpertStrategy extends BaseStrategy {
        constructor() { super('expert'); this.name = '专家'; }

        chooseDiscard(player, context) {
            const hand = player.hand;
            const melds = player.melds;
            const candidates = this._getCandidates(hand, player, context);
            if (candidates.length === 0) return hand[0] || null;

            const ctx = context || {};
            const shanten = this._shanten(player, ctx);
            const deckCount = this._deckCount(ctx);
            const isSichuan = ctx.config?.mahjongType === 'sichuan';
            const maxTenpai = this._maxOpponentTenpaiProb(ctx);

            const scored = candidates.map(tile => {
                let score = this._baseTileScore(tile, hand, melds);
                const newHand = hand.filter(t => t.id !== tile.id);
                const newShanten = AIUtils.calculateShanten(newHand, melds, ctx.ruleConfig || {});

                // 1. 向听数
                score -= (newShanten - shanten) * 60;

                // 2. 听牌质量（好弃牌加分）
                if (newShanten === 0) {
                    const tingPai = Rules.analyzeTingPai(newHand, ctx.ruleConfig || {});
                    const winningTiles = tingPai.reduce(
                        (total, wait) => total + AIUtils.getTileRemaining(wait.tile, newHand, melds, ctx),
                        0
                    );
                    score += winningTiles * 2;

                    // 好型听牌奖励
                    let goodWaits = 0;
                    for (const tp of tingPai) {
                        if (AIUtils.isGoodWaitTile(tp.tile, newHand)) goodWaits++;
                    }
                    score += goodWaits * 20;
                }

                // 3. 牌效率（1向听时评估进张数，好弃牌加分）
                if (newShanten === 1) {
                    const useful = AIUtils.getUsefulDraws(newHand, melds, ctx.ruleConfig || {}, ctx);
                    const totalRemaining = useful.reduce((s, u) => s + u.remaining, 0);
                    score += totalRemaining * 0.6;
                }

                // 4. 四川缺门动态策略（缺门牌加分=更该打）
                if (isSichuan && player.queYiMen) {
                    const queTiles = this._queYiMenTiles(player);
                    if (tile.suit === player.queYiMen) {
                        // 优先清缺门，但向听数 ≤1 时以听牌为主
                        if (shanten <= 1 && queTiles.length === 1) {
                            // 只剩一张缺门牌，但快听牌了
                            const queTileEfficiency = AIUtils.evaluateTileValue(queTiles[0], hand, melds);
                            if (queTileEfficiency < -5) {
                                // 缺门牌是好牌（有价值的搭子），暂缓（减分=更不该打）
                                score -= 50;
                            } else {
                                score += 80; // 缺门牌是废牌，优先打（加分=更该打）
                            }
                        } else {
                            score += 100; // 正常情况优先清缺门
                        }
                    }

                    // 清一色倾向：如果某花色已很多，保留该花色
                    const suitDist = AIUtils.getSuitDistribution(hand);
                    const maxSuit = Object.entries(suitDist).sort((a, b) => b[1] - a[1])[0];
                    if (maxSuit && tile.suit !== maxSuit[0] && !tile.isHonor) {
                        if (maxSuit[1] >= 7 && suitDist[tile.suit] <= 2) {
                            score += 5; // 鼓励打少数花色
                        }
                    }
                }

                // 5. 完整危险评估（危险牌减分=更不该打）
                const danger = this._danger(tile, ctx);
                if (shanten === 0) {
                    // 听牌后，安全性是第一优先级（避免点炮）
                    score -= danger * 1.5;
                } else if (shanten === 1) {
                    score -= danger * 0.6;
                } else if (shanten >= 2) {
                    score -= danger * 0.2;
                }

                // 6. 残局精确判断
                if (deckCount < 10) {
                    score -= danger * 2.0;
                    // 向听数 ≥2 时全面弃和
                    if (shanten >= 2) {
                        score -= danger * 3.0;
                    }
                } else if (deckCount < 20) {
                    score -= danger * 0.8;
                    if (shanten >= 2) {
                        score -= danger * 1.0;
                    }
                } else if (deckCount < 30) {
                    score -= danger * 0.3;
                }

                // 7. 对手听牌概率高时全面防守
                if (maxTenpai > 0.5) {
                    score -= danger * 0.5;
                }
                if (maxTenpai > 0.7) {
                    score -= danger * 0.8;
                }

                // 8. 有人做清一色（该花色减分=更不该打）
                if (this._someoneDoingPureColor(ctx, tile.suit)) {
                    score -= 30;
                }

                // 9. Dora 相关牌特别处理（dora 危险，减分=更不该打）
                if (AIUtils.isDora(tile, ctx.doraIndicators)) {
                    score -= 15;
                }

                return { tile, score };
            });

            scored.sort((a, b) => b.score - a.score);
            return scored[0].tile;
        }

        shouldAnGang(player, options, context) {
            if (!options || options.length === 0) return false;

            const option = options[0];
            const ctx = context || {};
            const shanten = this._shanten(player, ctx);

            if (option.type === 'an_gang') {
                // 听牌前：几乎总是杠（增加分数+摸牌机会）
                if (shanten > 0) {
                    const rr = AIUtils.evaluateGangRiskReward(player, 'an_gang', ctx);
                    return rr > -20;
                }
                // 听牌后：精确评估
                const rr = AIUtils.evaluateGangRiskReward(player, 'an_gang', ctx);
                return rr > 0;
            }

            if (option.type === 'jia_gang') {
                // 极其谨慎
                const rr = AIUtils.evaluateGangRiskReward(player, 'jia_gang', ctx);
                // 但如果是 dora 牌且风险低，可能冒险
                if (AIUtils.isDora(option.tile || option.meld?.tiles?.[0], ctx.doraIndicators)) {
                    return rr > 0;
                }
                return rr > 25;
            }

            return false;
        }

        shouldAction(player, action, tile, context) {
            if (!action) return false;

            const ctx = context || {};
            const shanten = this._shanten(player, ctx);
            const deckCount = this._deckCount(ctx);
            const maxTenpai = this._maxOpponentTenpaiProb(ctx);
            const isSichuan = ctx.config?.mahjongType === 'sichuan';

            if (action.type === 'hu') {
                // 策略性胡牌
                // 小牌且早期：如果向听数很好且牌墙还多，可能追求更大牌型
                // 但这里简化：总是胡（因为错过可能再也胡不了）
                // 实际上专家可以判断是否要"追大牌"
                if (deckCount > 40 && shanten === 0) {
                    const winningTiles = this._winningTilesCount(player, ctx);
                    // 如果和牌张数很少（<3），可能等自摸
                    // 但点炮胡已经确定得分，自摸不确定
                    // 保守：点炮就胡
                    return true;
                }
                return true;
            }

            switch (action.type) {
                case 'chi': {
                    const options = action.options || [];
                    if (options.length === 0) return false;

                    const bestOption = this.chooseChiOption(player, options, context);
                    const newShanten = this._shantenAfterChi(player, bestOption, context);

                    // EV 驱动：评估吃后的期望收益
                    // 吃后向听数严格减少，或形成显著更好的听牌
                    if (newShanten < shanten) {
                        // 向听数减少，但要考虑摸牌减少的代价
                        // 吃后少摸一张牌，在残局代价大
                        if (deckCount < 15) {
                            // 残局不吃 unless 直接听牌
                            return newShanten === 0;
                        }
                        return true;
                    }

                    if (newShanten === shanten) {
                        // 向听数不变：只有改善牌型才吃
                        if (shanten === 0) {
                            // 改善听牌质量
                            const testHand = [...player.hand];
                            const usedFromHand = bestOption.filter(t => player.hand.some(h => h.id === t.id));
                            for (const u of usedFromHand) {
                                const idx = testHand.findIndex(h => h.id === u.id);
                                if (idx >= 0) testHand.splice(idx, 1);
                            }
                            const oldWinning = AIUtils.countWinningTiles(player.hand, player.melds, ctx.ruleConfig || {});
                            const newMelds = [...player.melds, { type: 'sequence', tiles: bestOption }];
                            const newWinning = AIUtils.countWinningTiles(testHand, newMelds, ctx.ruleConfig || {});
                            if (newWinning > oldWinning * 1.3) return true;
                        }
                        return false;
                    }

                    // 向听数增加：绝对不吃
                    return false;
                }

                case 'peng': {
                    // 风牌/箭牌：增加番数，总是碰
                    if (tile.isHonor) return true;

                    const newShanten = this._shantenAfterPeng(player, tile, context);

                    if (newShanten < shanten) return true;

                    // 向听数不变但有4张
                    const handCounts = AIUtils.handToCounts(player.hand);
                    const key = `${tile.suit}-${tile.value}`;
                    if ((handCounts[key] || 0) >= 3) {
                        // 有暗刻，碰了可以杠
                        if (maxTenpai < 0.3) return true;
                    }

                    // 向听数增加：不碰（保留变化）
                    if (newShanten > shanten) return false;

                    // 残局不碰
                    if (deckCount < 15) return false;

                    // 四川麻将：碰了可能破坏缺门进度
                    if (isSichuan && player.queYiMen && tile.suit === player.queYiMen) {
                        return false; // 缺门牌不碰
                    }

                    return false;
                }

                case 'gang': {
                    const rr = AIUtils.evaluateGangRiskReward(player, 'ming_gang', ctx);
                    return rr > 10;
                }

                default:
                    return false;
            }
        }

        chooseChiOption(player, options, context) {
            if (!options || options.length === 0) return null;
            if (options.length === 1) return options[0];

            let best = options[0];
            let bestScore = -Infinity;
            const ctx = context || {};

            for (const opt of options) {
                const newShanten = this._shantenAfterChi(player, opt, context);
                let score = -newShanten * 60;

                // 模拟吃后的手牌
                const usedFromHand = opt.filter(t => player.hand.some(h => h.id === t.id));
                const testHand = [...player.hand];
                for (const u of usedFromHand) {
                    const idx = testHand.findIndex(h => h.id === u.id);
                    if (idx >= 0) testHand.splice(idx, 1);
                }
                const newMelds = [...player.melds, { type: 'sequence', tiles: opt }];

                // 听牌质量
                if (newShanten === 0) {
                    const winningTiles = AIUtils.countWinningTiles(testHand, newMelds, ctx.ruleConfig || {});
                    score += winningTiles * 2;

                    // 好型听牌
                    const tingPai = Rules.analyzeTingPai(testHand, ctx.ruleConfig || {});
                    let goodWaits = 0;
                    for (const tp of tingPai) {
                        if (AIUtils.isGoodWaitTile(tp.tile, testHand)) goodWaits++;
                    }
                    score += goodWaits * 15;
                }

                // 保留多样性：偏好不破坏现有搭子的吃法
                // 例如手牌有 3-4-5，不吃 3（因为已经有搭子了）
                // 简化：如果 opt 中的非弃牌在手牌中都是孤张，加分
                const handOnlyTiles = opt.filter(t => player.hand.some(h => h.id === t.id));
                const allAreUseful = handOnlyTiles.every(t => {
                    const score = AIUtils.evaluateTileValue(t, player.hand, player.melds, 'expert');
                    return score < 0; // 是有价值的牌
                });
                if (allAreUseful) score -= 10; // 用掉了好牌，减分

                // 偏好中张
                const optTile = opt.find(t => !player.hand.some(h => h.id === t.id));
                if (optTile && optTile.value >= 3 && optTile.value <= 7) score += 8;

                if (score > bestScore) {
                    bestScore = score;
                    best = opt;
                }
            }

            return best;
        }
    }

    // ============================================================
    // 策略工厂
    // ============================================================

    const strategies = {
        easy: new EasyStrategy(),
        normal: new NormalStrategy(),
        hard: new HardStrategy(),
        expert: new ExpertStrategy()
    };

    function getStrategy(difficulty) {
        return strategies[difficulty] || strategies.normal;
    }

    // ============================================================
    // 对外接口（保持与旧版兼容）
    // ============================================================

    function chooseDiscard(player, difficulty, context) {
        const strategy = getStrategy(difficulty);
        return strategy.chooseDiscard(player, context);
    }

    function shouldAnGang(player, options, difficulty, context) {
        const strategy = getStrategy(difficulty);
        return strategy.shouldAnGang(player, options, context);
    }

    function shouldAction(player, action, tile, difficulty, context) {
        const strategy = getStrategy(difficulty);
        return strategy.shouldAction(player, action, tile, context);
    }

    function chooseChiOption(player, options, difficulty, context) {
        const strategy = getStrategy(difficulty);
        return strategy.chooseChiOption(player, options, context);
    }

    return {
        chooseDiscard,
        shouldAnGang,
        shouldAction,
        chooseChiOption,
        // 暴露策略类供测试/调试
        strategies,
        getStrategy
    };
})();
