import get from 'lodash-es/get.js'
import evEmitDelay from 'wsemi/src/evEmitDelay.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { genDiag } from './genDiag.mjs'


//genEeEmit, 建立本套件之事件派發函數(內部使用, 前後端共用), 為本套件派發與停止閘門之單一擁有者
//  以timer脫勾1ms(維持既有時序)後交由wsemi之evEmitDelay派發, 監聽器之同步拋錯改以error事件通知, 不使行程崩潰
//  why: 原以setTimeout直接包emit, 監聽器之同步拋錯於計時器回呼內即成uncaughtException而使行程崩潰(見wsemi之evEmitDelay.mjs)
//  error事件之內容一律為{ msg, err }(與w-sync-webdata相同): 監聽器拋錯通報為{ msg: 'listener of event[x] error', err }, err為所拋之值
//  監聽器之拋錯由本檔之派發函數(funEmit)自行攔截與通報, 不交給wsemi之evEmit: evEmit於無error監聽者或error事件本身之監聽器拋錯時以console.error輸出所拋之原值(其未提供注入診斷輸出之介面, 值可能含token或使用者識別), 本套件之診斷輸出一律經getDiag(opt.diag, 見genDiag)
//  停止閘門: 已停止(opt.isCleared()為true)者不再排程, 已排程者於派發當下再判斷, 已停止則不派發
//    why 須於派發當下判斷: 停止前已排入計時器之事件(例如同一次輪詢之openOnce與open)只在排程時判斷會漏
//  診斷輸出(opt.diag, 預設只輸出標籤與安全摘要{ src, name, errType, errCode }, 不含值; logDetail、funLog見genDiag):
//    停止後之監聽器拋錯(含補發事件之監聽器)、error事件本身之監聽器拋錯(含監聽器拋錯通報時error監聽器再拋錯)、無error監聽者時之監聽器拋錯: 輸出該拋錯(停止後不再派發本套件之事件, 但使用端程式之錯誤不可無聲)
//    本套件自發之error於派發當下無error監聽者時: 輸出該error(失敗不可無聲, eventemitter3對無監聽者之emit只回傳false)
//  輸入ev為事件物件; opt.isCleared為回傳是否已停止之函數, 預設恆為false; opt.onDeliver(name, args)於實際派發、呼叫監聽器之前呼叫(供伺服端記錄已送達之進出)
//  opt.diag為診斷輸出函數(genDiag所得), 未給時為預設(只輸出標籤與安全摘要)
//  opt.trace為觀察回調之通知函數(wsemi之getTrace所得, 格式(type, info)), 未給時不組事件物件; 事件(欄位皆為原始值, 兩端之opt.onTrace共用, 列舉見兩端JSDoc):
//    emit(name, final): 事件已排定(1ms後派發), final為是否為停止時之補發; 已停止而不再排程者不通知
//    deliver(name, final, ok): 事件已派發(監聽器皆已呼叫完), ok為監聽器是否皆未拋錯; 監聽器拋錯時先通知deliver(ok為false), 其通報於其後
//    report(src, msg, via, name): 本套件改以error事件或診斷輸出(console.error或funLog)通報: src為'listener'(監聽器拋錯, name為其事件名, msg為listener of event[x] error)或'error'(本套件自發之error於無error監聽者時改以診斷輸出, msg為其msg), via為'event'(error事件)或'console'(診斷輸出)
//      監聽器拋錯而error監聽器亦拋錯時, 先通知error監聽器之拋錯(src為'listener', name為'error', via為'console'), 再通知原事件之通報(via為'event')
//    停止閘門丟棄之事件(排程時或派發當下已停止)不通知: 停止後除停止時已在進行之那次派發與補發事件外不再通知
//  回傳eeEmit(name, ...args); eeEmit.final(name, ...args)不受停止閘門約束, 僅供伺服端停止時之補發
function genEeEmit(ev, opt = {}) {

    //isCleared
    let isCleared = opt.isCleared
    if (!isfun(isCleared)) {
        isCleared = () => false
    }

    //trace
    let trace = isfun(opt.trace) ? opt.trace : null

    //diag
    let diag = isfun(opt.diag) ? opt.diag : genDiag({ logDetail: false, funLog: null }).diag

    //onDeliver
    let onDeliver = opt.onDeliver
    if (!isfun(onDeliver)) {
        onDeliver = null
    }

    //listenerCount, 事件物件無listenerCount時(非eventemitter3)視為有監聽者, 照常派發
    let listenerCount = (name) => {
        if (isfun(ev.listenerCount)) {
            return ev.listenerCount(name)
        }
        return 1
    }

    //report, 經診斷輸出通報: 標籤為固定詞彙, 摘要只含來源、事件名與錯誤之類別與代碼, 所拋之值只在logDetail或funLog時以遮罩後之細節輸出
    let report = (msg, err, src, name) => {
        let safe = { src, ...diag.brief(err) }
        if (name !== undefined) {
            safe.name = name
        }
        diag(`[w-serv-broadcast] ${msg}`, safe, () => err, 'error')
    }

    //reportListener, 監聽器拋錯之通報(已通知deliver之後)
    let reportListener = (name, err) => {
        let nm = String(name)
        let msg = `listener of event[${nm}] error`

        //停止後、error事件本身之監聽器、無error監聽者: 診斷輸出(不再發error事件)
        if (isCleared() || name === 'error' || listenerCount('error') === 0) {
            report(msg, err, 'listener', nm)
            if (trace !== null) {
                trace('report', { src: 'listener', msg, via: 'console', name: nm })
            }
            return
        }

        //轉為本套件形狀之error事件, error監聽器亦拋錯者改以診斷輸出
        try {
            ev.emit('error', { msg, err })
        }
        catch (err2) {
            report('listener of event[error] error', err2, 'listener', 'error')
            if (trace !== null) {
                trace('report', { src: 'listener', msg: 'listener of event[error] error', via: 'console', name: 'error' })
            }
        }
        if (trace !== null) {
            trace('report', { src: 'listener', msg, via: 'event', name: nm })
        }
    }

    //funEmitOf, 實際派發; gated為是否受停止閘門約束; 不外拋(監聽器之拋錯於此攔截, 不交給evEmit)
    let funEmitOf = (gated) => {
        return (name, ...args) => {
            try {
                let r = args[0]

                //check, 停止閘門
                if (gated && isCleared()) {
                    return false
                }

                //check, 本套件自發之error無監聽者時改以診斷輸出
                if (name === 'error' && listenerCount('error') === 0) {
                    report(get(r, 'msg', ''), get(r, 'err'), 'error')
                    if (trace !== null) {
                        trace('report', { src: 'error', msg: get(r, 'msg', ''), via: 'console' })
                    }
                    return false
                }

                //onDeliver, 須於呼叫監聽器之前, 使監聽器於派發中停止時能據以補發
                if (onDeliver !== null) {
                    onDeliver(name, args)
                }

                //emit, 監聽器拋錯時攔截(同一堆疊內通報, 見reportListener)
                let b = false
                let threw = false
                let thrown = null
                try {
                    b = ev.emit(name, ...args)
                }
                catch (err) {
                    threw = true
                    thrown = err
                }

                //deliver, 監聽器拋錯時ok為false, 其通報於其後
                if (trace !== null) {
                    trace('deliver', { name, final: !gated, ok: !threw })
                }

                if (threw) {
                    reportListener(name, thrown)
                    return false
                }
                return b
            }
            catch (err) {
                //本函數之內部失敗(例如事件物件之listenerCount拋錯)亦不外拋(外拋則由evEmit以console.error輸出原值): 同自發之error以診斷輸出通報
                try {
                    report('internal error', err, 'error')
                    if (trace !== null) {
                        trace('report', { src: 'error', msg: 'internal error', via: 'console' })
                    }
                }
                catch (err2) {
                    //放棄輸出
                }
                return false
            }
        }
    }
    let funEmitGated = funEmitOf(true)
    let funEmitFinal = funEmitOf(false)

    //eeEmit
    let eeEmit = (name, ...args) => {

        //check, 已停止者不再排程
        if (isCleared()) {
            return
        }

        evEmitDelay(ev, name, args, { tag: 'w-serv-broadcast', funEmit: funEmitGated })

        //emit, 於排定之後通知: 回調內停止者, 該事件已排定而於派發當下被停止閘門丟棄
        if (trace !== null) {
            trace('emit', { name, final: false })
        }
    }

    //final, 停止時之補發, 不受停止閘門約束
    eeEmit.final = (name, ...args) => {
        evEmitDelay(ev, name, args, { tag: 'w-serv-broadcast', funEmit: funEmitFinal })
        if (trace !== null) {
            trace('emit', { name, final: true })
        }
    }

    return eeEmit
}


export default genEeEmit
