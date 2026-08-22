/**
 * 万能麻将 - 本地存储系统 v2
 * 
 * 特性：
 * - 数据版本控制：版本不匹配时自动清理旧数据
 * - defaultValue 深拷贝：防止调用者修改污染默认值
 * - 配额检测：set 时检测 localStorage 是否已满
 */

const Storage = (function() {
    'use strict';

    const PREFIX = 'mahjong_';
    const STORAGE_VERSION = 1;

    function _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch (e) {
            return obj;
        }
    }

    /**
     * 检查存储版本，不匹配时清理所有数据
     */
    function checkVersion() {
        try {
            const storedVersion = localStorage.getItem(PREFIX + '_version');
            if (storedVersion !== String(STORAGE_VERSION)) {
                if (storedVersion !== null) {
                    console.warn(`Storage version mismatch: expected ${STORAGE_VERSION}, got ${storedVersion}. Clearing old data.`);
                }
                clear();
                localStorage.setItem(PREFIX + '_version', String(STORAGE_VERSION));
            }
        } catch (e) {
            console.error('Storage version check error:', e);
        }
    }

    function get(key, defaultValue = null) {
        try {
            const data = localStorage.getItem(PREFIX + key);
            if (data === null) return _deepClone(defaultValue);
            return JSON.parse(data);
        } catch (e) {
            console.error('Storage get error:', e);
            return _deepClone(defaultValue);
        }
    }

    function set(key, value) {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(value));
            return true;
        } catch (e) {
            // 检测配额溢出（QuotaExceededError）
            if (e.name === 'QuotaExceededError' || e.code === 22 || e.number === 22) {
                console.error('Storage quota exceeded');
            } else {
                console.error('Storage set error:', e);
            }
            return false;
        }
    }

    function remove(key) {
        try {
            localStorage.removeItem(PREFIX + key);
        } catch (e) {
            console.error('Storage remove error:', e);
        }
    }

    function clear() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(PREFIX)) {
                keys.push(key);
            }
        }
        for (const key of keys) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.error('Storage clear error for key:', key, e);
            }
        }
    }

    // 启动时检查版本
    checkVersion();

    return { get, set, remove, clear, checkVersion };
})();
