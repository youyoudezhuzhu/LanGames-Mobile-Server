/**
 * 万能麻将 - 工具函数
 */

const Utils = {
    /**
     * 生成随机整数 [min, max)
     */
    randomInt(min, max) {
        if (max <= min) return min;
        return Math.floor(Math.random() * (max - min)) + min;
    },

    /**
     * 洗牌算法 (Fisher-Yates)
     */
    shuffle(array) {
        if (!Array.isArray(array)) return [];
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Utils.randomInt(0, i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    /**
     * 延迟函数
     */
    sleep(ms, token) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            if (token) {
                token.onCancel(() => {
                    clearTimeout(timer);
                    reject(new Error('CANCELLED'));
                });
            }
        });
    },

    /**
     * 取消令牌
     */
    CancelToken: class CancelToken {
        constructor() {
            this._cancelled = false;
            this._callbacks = [];
        }
        get isCancelled() { return this._cancelled; }
        cancel() {
            if (this._cancelled) return;
            this._cancelled = true;
            this._callbacks.forEach(cb => cb());
            this._callbacks = [];
        }
        onCancel(cb) {
            if (this._cancelled) { cb(); return; }
            this._callbacks.push(cb);
        }
        throwIfCancelled() {
            if (this._cancelled) throw new Error('CANCELLED');
        }
    },

    /**
     * 防抖函数
     */
    debounce(fn, delay) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /**
     * 节流函数
     */
    throttle(fn, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * 深拷贝
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * HTML实体转义（防止XSS）
     */
    escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    /**
     * 格式化日期
     */
    formatDate(date = new Date()) {
        const d = new Date(date);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },

    /**
     * 生成唯一ID
     */
    uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Toast提示
     * @param {string} message
     * @param {number} duration - 毫秒
     * @param {string} type - 'default' | 'success' | 'error' | 'warning'
     */
    toast(message, duration = 3000, type = 'default') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        const colors = {
            success: '#4caf50',
            error:   '#f44336',
            warning: '#ff9800',
            default: null
        };
        if (colors[type]) {
            toast.style.borderLeftColor = colors[type];
        }
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * 确认对话框
     */
    confirm(message) {
        return new Promise(resolve => {
            const result = window.confirm(message);
            resolve(result);
        });
    },

    /**
     * 数组分组
     */
    groupBy(array, key) {
        if (!Array.isArray(array)) return {};
        return array.reduce((result, item) => {
            const group = item[key];
            result[group] = result[group] || [];
            result[group].push(item);
            return result;
        }, {});
    },

    /**
     * 数组计数
     */
    countBy(array, key) {
        if (!Array.isArray(array)) return {};
        return array.reduce((result, item) => {
            const val = item[key];
            result[val] = (result[val] || 0) + 1;
            return result;
        }, {});
    },

    /**
     * 扁平化数组
     */
    flatten(array) {
        if (!Array.isArray(array)) return [];
        return array.reduce((flat, item) => 
            flat.concat(Array.isArray(item) ? Utils.flatten(item) : item), []);
    },

    /**
     * 比较两个数组是否相等（忽略顺序）
     */
    arraysEqual(a, b) {
        if (!a || !b) return a === b;
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((val, i) => val === sortedB[i]);
    },

    /**
     * 获取对象所有可能的组合
     */
    combinations(array, k) {
        if (!Array.isArray(array)) return [];
        if (k === 0) return [[]];
        if (array.length < k) return [];
        if (k === 1) return array.map(x => [x]);
        
        const result = [];
        for (let i = 0; i <= array.length - k; i++) {
            const subCombinations = Utils.combinations(array.slice(i + 1), k - 1);
            for (const sub of subCombinations) {
                result.push([array[i], ...sub]);
            }
        }
        return result;
    },

    /**
     * 事件发射器
     */
    EventEmitter: class EventEmitter {
        constructor() {
            this.events = {};
        }
        on(event, callback) {
            this.events[event] = this.events[event] || [];
            this.events[event].push(callback);
            return () => this.off(event, callback);
        }
        off(event, callback) {
            if (!this.events[event]) return;
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        }
        emit(event, ...args) {
            if (!this.events[event]) return;
            this.events[event].forEach(cb => {
                try {
                    cb(...args);
                } catch (err) {
                    console.error(`EventEmitter listener error for "${event}":`, err);
                }
            });
        }
        removeAllListeners() {
            this.events = {};
        }
        once(event, callback) {
            const onceWrapper = (...args) => {
                try {
                    callback(...args);
                } finally {
                    this.off(event, onceWrapper);
                }
            };
            this.on(event, onceWrapper);
        }
    }
};

// CSS.escape 兼容性回退（旧版 Safari/IE/部分安卓 WebView 不支持）
function escapeCssSelector(str) {
    if (typeof str !== 'string') return '';
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(str);
    }
    // 手动转义：仅处理 ID/类名选择器中最危险的字符
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
