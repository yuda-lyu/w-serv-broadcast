import evEmitDelay from 'wsemi/src/evEmitDelay.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'


//genEeEmit, 建立本套件之事件派發函數(內部使用, 前後端共用)
//  以timer脫勾1ms(維持既有時序)後交由wsemi之evEmitDelay派發, 監聽器之同步拋錯改以error事件通知, 不使行程崩潰
//  why: 原以setTimeout直接包emit, 監聽器之同步拋錯於計時器回呼內即成uncaughtException而使行程崩潰(見wsemi之evEmitDelay.mjs)
//  error事件之內容一律為{ msg, err }(與w-sync-webdata相同): wsemi對監聽器拋錯之通報為{ fun, name, msg, args }且其msg為所拋之錯誤, 於此轉為{ msg: 'listener of event[x] error', err }
//  輸入ev為事件物件, 回傳eeEmit(name, ...args)
function genEeEmit(ev) {

    //funEmit, 實際派發, 只轉換監聽器拋錯之通報, 其餘原樣派發
    let funEmit = (name, ...args) => {
        let r = args[0]
        if (name === 'error' && iseobj(r) && r.fun === 'listener') {
            return ev.emit('error', { msg: `listener of event[${r.name}] error`, err: r.msg })
        }
        return ev.emit(name, ...args)
    }

    //eeEmit
    let eeEmit = (name, ...args) => {
        evEmitDelay(ev, name, args, { tag: 'w-serv-broadcast', funEmit })
    }

    return eeEmit
}


export default genEeEmit
