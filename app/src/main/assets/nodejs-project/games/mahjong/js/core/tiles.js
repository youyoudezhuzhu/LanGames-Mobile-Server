/**
 * 万能麻将 - 麻将牌定义系统
 * 支持中国境内所有麻将种类
 */

const Tiles = (function() {
    'use strict';

    // 基础牌类型
    const SUIT_TYPES = {
        WAN: 'wan',      // 万子
        TONG: 'tong',    // 筒子
        TIAO: 'tiao',    // 条子
        FENG: 'feng',    // 风牌
        JIAN: 'jian',    // 箭牌
        HUA: 'hua'       // 花牌
    };

    // Unicode麻将字符映射
    const UNICODE_MAP = {
        wan: ['🀇','🀈','🀉','🀊','🀋','🀌','🀍','🀎','🀏'],
        tong: ['🀙','🀚','🀛','🀜','🀝','🀞','🀟','🀠','🀡'],
        tiao: ['🀐','🀑','🀒','🀓','🀔','🀕','🀖','🀗','🀘'],
        feng: ['🀀','🀁','🀂','🀃'], // 东南西北
        jian: ['🀄','🀆','🀫'],      // 中发白
        hua: ['🀦','🀧','🀨','🀩','🀢','🀣','🀤','🀥'] // 春夏秋冬梅兰竹菊
    };

    // 牌名称
    const NAME_MAP = {
        wan: ['一万','二万','三万','四万','五万','六万','七万','八万','九万'],
        tong: ['一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒'],
        tiao: ['一条','二条','三条','四条','五条','六条','七条','八条','九条'],
        feng: ['东风','南风','西风','北风'],
        jian: ['红中','发财','白板'],
        hua: ['春','夏','秋','冬','梅','兰','竹','菊']
    };

    // 简写名称
    const SHORT_NAME_MAP = {
        wan: ['1万','2万','3万','4万','5万','6万','7万','8万','9万'],
        tong: ['1筒','2筒','3筒','4筒','5筒','6筒','7筒','8筒','9筒'],
        tiao: ['1条','2条','3条','4条','5条','6条','7条','8条','9条'],
        feng: ['东','南','西','北'],
        jian: ['中','发','白'],
        hua: ['春','夏','秋','冬','梅','兰','竹','菊']
    };

    /**
     * 创建一张牌
     */
    function createTile(suit, value, id = null) {
        return {
            id: id || Utils.uuid(),
            suit: suit,
            value: value,
            unicode: UNICODE_MAP[suit]?.[value - 1] || '?',
            name: NAME_MAP[suit]?.[value - 1] || `${suit}${value}`,
            shortName: SHORT_NAME_MAP[suit]?.[value - 1] || `${suit}${value}`,
            isHonor: suit === SUIT_TYPES.FENG || suit === SUIT_TYPES.JIAN,
            isFlower: suit === SUIT_TYPES.HUA,
            isTerminal: (suit === SUIT_TYPES.WAN || suit === SUIT_TYPES.TONG || suit === SUIT_TYPES.TIAO) && (value === 1 || value === 9),
            isSimple: (suit === SUIT_TYPES.WAN || suit === SUIT_TYPES.TONG || suit === SUIT_TYPES.TIAO) && value >= 2 && value <= 8
        };
    }

    /**
     * 麻将种类配置
     */
    const MAHJONG_TYPES = {
        'guobiao': {
            name: '国标麻将',
            desc: '144张，8番起胡',
            icon: '🀄',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 },
                { suit: 'hua', range: [1, 8], count: 1 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 8,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                huaPai: true,
                gangShangKaiHua: true,
                qiangGang: true,
                haiDiLaoYue: true
            }
        },
        'guangdong': {
            name: '广东麻将',
            desc: '136张，鸡平胡/推倒胡',
            icon: '🀅',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                huaPai: false,
                gangShangKaiHua: true,
                qiangGang: true,
                baoPai: true,
                maPai: true
            }
        },
        'sichuan': {
            name: '四川麻将',
            desc: '108张，不可吃，血战到底',
            icon: '🀆',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: false,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                queYiMen: true,
                xueZhanDaoDi: true,
                huaPai: false,
                ziMoJiaFan: true
            }
        },
        'shanghai': {
            name: '上海麻将',
            desc: '144张，花牌计番',
            icon: '🀦',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 },
                { suit: 'hua', range: [1, 8], count: 1 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                huaPai: true,
                huaJiFan: true,
                daDiaoChe: true,
                haiDiLaoYue: true
            }
        },
        'beijing': {
            name: '北京麻将',
            desc: '136张，混儿牌',
            icon: '🀫',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                hunPai: true,
                huaPai: false,
                menQing: true,
                baoPai: true
            }
        },
        'taiwan': {
            name: '台湾麻将',
            desc: '144张，16张牌',
            icon: '🀀',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 },
                { suit: 'hua', range: [1, 8], count: 1 }
            ],
            playerCount: 4,
            handSize: 16,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                huaPai: true,
                taiJi: true,
                lianZhuang: true,
                gangBian: true
            }
        },
        'hangzhou': {
            name: '杭州麻将',
            desc: '136张，财神牌',
            icon: '🀅',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                caiShen: true,
                baoTou: true,
                caiShenGuiWei: true,
                huaPai: false
            }
        },
        'changsha': {
            name: '长沙麻将',
            desc: '108张，不可吃，扎鸟',
            icon: '🀇',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: false,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                zhaNiao: true,
                jiangJiangHu: true,
                qiDui: true,
                huaPai: false
            }
        },
        'dongbei': {
            name: '东北麻将',
            desc: '136张，带会儿',
            icon: '🀁',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                huiEr: true,
                piaoHu: true,
                daPiao: true,
                huaPai: false
            }
        },
        'hubei': {
            name: '湖北麻将',
            desc: '136张，开口翻',
            icon: '🀂',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                kaiKouFan: true,
                piHu: true,
                huaPai: false
            }
        },
        'fujian': {
            name: '福建麻将',
            desc: '136张，花牌',
            icon: '🀃',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                jinPai: true,
                huaPai: true,
                qiangJin: true
            }
        },
        'jiangxi': {
            name: '江西麻将',
            desc: '144张，精牌',
            icon: '🀌',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 },
                { suit: 'feng', range: [1, 4], count: 4 },
                { suit: 'jian', range: [1, 3], count: 4 },
                { suit: 'hua', range: [1, 8], count: 1 }
            ],
            playerCount: 4,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                jingPai: true,
                chongGuan: true,
                huaPai: true
            }
        },
        // 3人麻将变体
        'sichuan-3p': {
            name: '四川三人麻将',
            desc: '108张，不可吃，三人血战',
            icon: '🀆',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 }
            ],
            playerCount: 3,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: false,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                queYiMen: true,
                xueZhanDaoDi: true,
                huaPai: false
            }
        },
        'hunan-3p': {
            name: '湖南三人麻将',
            desc: '108张，红中赖子',
            icon: '🀄',
            tileSets: [
                { suit: 'wan', range: [1, 9], count: 4 },
                { suit: 'tong', range: [1, 9], count: 4 },
                { suit: 'tiao', range: [1, 9], count: 4 }
            ],
            playerCount: 3,
            handSize: 13,
            rules: {
                minFan: 0,
                allowChi: true,
                allowPeng: true,
                allowGang: true,
                allowAnGang: true,
                hongZhongLaiZi: true,
                huaPai: false
            }
        }
    };

    /**
     * 生成一副牌
     */
    function generateDeck(type = 'guobiao') {
        const config = MAHJONG_TYPES[type];
        if (!config) throw new Error(`Unknown mahjong type: ${type}`);
        
        const deck = [];
        for (const set of config.tileSets) {
            for (let val = set.range[0]; val <= set.range[1]; val++) {
                for (let c = 0; c < set.count; c++) {
                    deck.push(createTile(set.suit, val));
                }
            }
        }
        return Utils.shuffle(deck);
    }

    /**
     * 获取麻将种类列表
     */
    function getMahjongTypes() {
        return Object.entries(MAHJONG_TYPES).map(([key, config]) => ({
            key,
            name: config.name,
            desc: config.desc,
            icon: config.icon,
            playerCount: config.playerCount
        }));
    }

    /**
     * 获取麻将配置
     */
    function getConfig(type) {
        return MAHJONG_TYPES[type];
    }

    /**
     * 检查两张牌是否相同
     */
    function isSameTile(a, b) {
        return a.suit === b.suit && a.value === b.value;
    }

    /**
     * 比较牌的大小（用于排序）
     */
    function compareTiles(a, b) {
        const suitOrder = ['wan', 'tong', 'tiao', 'feng', 'jian', 'hua'];
        const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
        if (suitDiff !== 0) return suitDiff;
        return a.value - b.value;
    }

    /**
     * 排序手牌
     */
    function sortTiles(tiles) {
        return [...tiles].sort(compareTiles);
    }

    /**
     * 获取牌的显示文本
     */
    function getTileDisplay(tile, showUnicode = true) {
        if (showUnicode) return tile.unicode;
        return tile.shortName;
    }

    /**
     * 判断是否可以组成顺子
     */
    function canFormSequence(a, b, c) {
        if (a.suit !== b.suit || b.suit !== c.suit) return false;
        if (a.isHonor || b.isHonor || c.isHonor) return false;
        const sorted = [a.value, b.value, c.value].sort((x, y) => x - y);
        return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
    }

    /**
     * 判断是否可以组成刻子
     */
    function canFormTriplet(a, b, c) {
        return a.suit === b.suit && b.suit === c.suit && 
               a.value === b.value && b.value === c.value;
    }

    /**
     * 判断两张牌是否相邻（用于吃）
     */
    function isAdjacent(a, b) {
        if (a.suit !== b.suit) return false;
        if (a.isHonor || b.isHonor) return false;
        return Math.abs(a.value - b.value) === 1;
    }

    return {
        SUIT_TYPES,
        UNICODE_MAP,
        NAME_MAP,
        MAHJONG_TYPES,
        createTile,
        generateDeck,
        getMahjongTypes,
        getConfig,
        isSameTile,
        compareTiles,
        sortTiles,
        getTileDisplay,
        canFormSequence,
        canFormTriplet,
        isAdjacent
    };
})();
