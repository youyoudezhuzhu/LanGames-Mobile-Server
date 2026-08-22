/**
 * 万能麻将 - 玩家类
 */

class Player extends Utils.EventEmitter {
    constructor(id, name, isAI = false, autoSort = true) {
        super();
        this.id = id;
        this.name = name;
        this.isAI = isAI;
        this.networkId = null;
        this.autoSort = autoSort;
        this.hand = [];
        this.melds = [];
        this.discards = [];
        this.score = 0;
        this.position = 0; // 0=东,1=南,2=西,3=北
        this.isDealer = false;
        this.queYiMen = null; // 四川麻将缺门
        this.flowers = [];
        this.gangCount = 0;
        this.isReady = false;
        this.isHu = false;
    }

    reset() {
        this.hand = [];
        this.melds = [];
        this.discards = [];
        this.flowers = [];
        this.gangCount = 0;
        this.isReady = false;
        this.isHu = false;
        this.queYiMen = null;
        this.isDealer = false;
    }

    draw(tile) {
        this.hand.push(tile);
        if (this.autoSort) {
            this.hand = Tiles.sortTiles(this.hand);
        }
        this.emit('draw', tile);
        return tile;
    }

    discard(tileId) {
        const index = this.hand.findIndex(t => t.id === tileId);
        if (index === -1) return null;
        const tile = this.hand.splice(index, 1)[0];
        this.discards.push(tile);
        this.emit('discard', tile);
        return tile;
    }

    addMeld(meld) {
        this.melds.push(meld);
        this.emit('meld', meld);
    }

    removeFromHand(tiles) {
        if (!Array.isArray(tiles)) return;
        // 先统计各 ID 需移除的次数，防止重复 ID 导致误删
        const toRemove = {};
        for (const tile of tiles) {
            const id = tile?.id;
            if (id !== undefined && id !== null) {
                toRemove[id] = (toRemove[id] || 0) + 1;
            }
        }
        const newHand = [];
        for (const tile of this.hand) {
            if (toRemove[tile.id] > 0) {
                toRemove[tile.id]--;
            } else {
                newHand.push(tile);
            }
        }
        this.hand = newHand;
        if (this.autoSort) {
            this.hand = Tiles.sortTiles(this.hand);
        }
    }

    addScore(delta) {
        if (typeof delta !== 'number' || !isFinite(delta)) {
            console.error('addScore: delta must be a finite number, got', delta);
            return;
        }
        this.score += delta;
        this.emit('scoreChange', this.score);
    }

    setQueYiMen(suit) {
        this.queYiMen = suit;
    }

    getQueYiMenTiles() {
        if (!this.queYiMen) return [];
        return this.hand.filter(t => t.suit === this.queYiMen);
    }

    getHandSize() {
        return this.hand.length;
    }

    hasTile(tile) {
        return this.hand.some(t => Tiles.isSameTile(t, tile));
    }

    findTiles(predicate) {
        return this.hand.filter(predicate);
    }

    serialize(includeHand = false) {
        const result = {
            id: this.id,
            name: this.name,
            isAI: this.isAI,
            networkId: this.networkId,
            score: this.score,
            position: this.position,
            isDealer: this.isDealer,
            handSize: this.hand.length,
            melds: this.melds.map(m => ({ ...m, tiles: m.tiles ? m.tiles.map(t => ({ ...t })) : [] })),
            discards: this.discards.map(t => ({ ...t })),
            flowers: this.flowers.map(t => ({ ...t })),
            isHu: this.isHu,
            gangCount: this.gangCount,
            queYiMen: this.queYiMen
        };
        if (includeHand) {
            result.hand = this.hand.map(t => ({ ...t }));
            result.discards = this.discards.map(t => ({ ...t }));
        }
        return result;
    }

    // JSON.stringify 的内建钩子 + 代码直接调用
    // JSON.stringify 传入属性名（字符串），代码直接调用传入 boolean
    toJSON(key) {
        const includeHand = (key === true);
        return this.serialize(includeHand);
    }
}
