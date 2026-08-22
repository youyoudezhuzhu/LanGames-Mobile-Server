/**
 * 万能麻将 - 应用事件总线
 * 
 * 职责：提供模块间松耦合通信机制。
 * 引擎事件（engine-events.js）翻译为应用事件后在此发布，
 * 各 UI/输入/网络模块订阅自己关心的事件。
 * 
 * 注意：当前处于过渡阶段，部分模块仍通过直接函数调用通信。
 * 新增事件应优先使用 event-bus，逐步替代隐式全局调用。
 */
const AppEventBus = new Utils.EventEmitter();

/**
 * 便捷方法：发布引擎事件到应用事件总线
 * @param {string} event - 事件名
 * @param {*} data - 事件数据
 */
function emitAppEvent(event, data) {
    try {
        AppEventBus.emit(event, data);
    } catch (err) {
        console.error(`AppEventBus emit error for "${event}":`, err);
    }
}
