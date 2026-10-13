import evEmitDelay from 'wsemi/src/evEmitDelay.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'


//genEeEmit, 建立本套件之事件派發函數(內部使用, 前後端共用), 為本套件派發與停止閘門之單一擁有者
//  以timer脫勾1ms(維持既有時序)後交由wsemi之evEmitDelay派發, 監聽器之同步拋錯改以error事件通知, 不使行程崩潰
//  why: 原以setTimeout直接包emit, 監聽器之同步拋錯於計時器回呼內即成uncaughtException而使行程崩潰(見wsemi之evEmitDelay.mjs)
//  error事件之內容一律為{ msg, err }(與w-sync-webdata相同): wsemi對監聽器拋錯之通報為{ fun, name, msg, args }且其msg為所拋之錯誤, 於此轉為{ msg: 'listener of event[x] error', err }
//  停止閘門: 已停止(opt.isCleared()為true)者不再排程, 已排程者於派發當下再判斷, 已停止則不派發
//    why 須於派發當下判斷: 停止前已排入計時器之事件(例如同一次輪詢之openOnce與open)只在排程時判斷會漏
//  停止後之監聽器拋錯(含補發事件之監聽器)改以console.error輸出: 停止後不再派發本套件之事件, 但使用端程式之錯誤不可無聲
//  本套件自發之error於派發當下無error監聽者時改以console.error輸出: 失敗不可無聲(eventemitter3對無監聽者之emit只回傳false)
//  輸入ev為事件物件; opt.isCleared為回傳是否已停止之函數, 預設恆為false; opt.onDeliver(name, args)於實際派發、呼叫監聽器之前呼叫(供伺服端記錄已送達之進出)
//  回傳eeEmit(name, ...args); eeEmit.final(name, ...args)不受停止閘門約束, 僅供伺服端停止時之補發
function genEeEmit(ev, opt = {}) {

    //isCleared
    let isCleared = opt.isCleared
    if (!isfun(isCleared)) {
        isCleared = () => false
    }

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

    //report, 以console.error輸出error事件之內容{ msg, err }
    let report = (r) => {
        console.error(`[w-serv-broadcast] ${r.msg}`, r.err)
    }

    //funEmitOf, 實際派發; gated為是否受停止閘門約束
    let funEmitOf = (gated) => {
        return (name, ...args) => {
            let r = args[0]

            //監聽器拋錯之通報, 轉為本套件形狀; 停止後改以console.error輸出
            if (name === 'error' && iseobj(r) && r.fun === 'listener') {
                let e = { msg: `listener of event[${r.name}] error`, err: r.msg }
                if (isCleared()) {
                    report(e)
                    return false
                }
                return ev.emit('error', e)
            }

            //check, 停止閘門
            if (gated && isCleared()) {
                return false
            }

            //check, 本套件自發之error無監聽者時改以console.error輸出
            if (name === 'error' && listenerCount('error') === 0) {
                report(r)
                return false
            }

            //onDeliver, 須於呼叫監聽器之前, 使監聽器於派發中停止時能據以補發
            if (onDeliver !== null) {
                onDeliver(name, args)
            }

            return ev.emit(name, ...args)
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
    }

    //final, 停止時之補發, 不受停止閘門約束
    eeEmit.final = (name, ...args) => {
        evEmitDelay(ev, name, args, { tag: 'w-serv-broadcast', funEmit: funEmitFinal })
    }

    return eeEmit
}


export default genEeEmit
