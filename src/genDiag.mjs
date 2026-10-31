import get from 'lodash-es/get.js'
import getDiag from 'wsemi/src/getDiag.mjs'
import getDiagSecrets from 'wsemi/src/getDiagSecrets.mjs'


//本套件之診斷輸出一律由wsemi之getDiag提供(規則見wsemi sgud/rule/rulebook_diag.md R-DIAG-01, 跨套件規格為主控dspec〈診斷輸出與遮罩〉D1~D4), 本檔只有本套件之宣告, src內除本檔外不得直接呼叫console
//  預設只輸出固定標籤與安全摘要(不含error事件內容之值: 其可能含token或使用者識別), opt.logDetail為true時輸出遮罩後之細節, opt.funLog(label, safe, detail)給予時診斷輸出只交給它


//SAFE_KEYS, 本套件之safe會用到之鍵(白名單外之鍵由getDiag丟棄; errType、errCode恆含): src為通報來源('listener'監聽器拋錯、'error'本套件自發之error), name為監聽器拋錯之事件名
const SAFE_KEYS = ['src', 'name']

//TOKEN_MAX, 記住之token數量上限(依序淘汰最舊者): 伺服端每個前端皆可帶不同token, 須有界
const TOKEN_MAX = 64


//checkOptLog, 診斷輸出設定之型別檢核, 供WServBroadcastServer與WServBroadcastClient建構時使用: 型別錯誤即拋Error(與w-serv-webdata相同), undefined與null視為未給
//  logDetail: 布林(僅原生布林值), 預設false; true時console輸出還原為含錯誤原文之細節(供除錯), 憑證與token仍遮罩
//  funLog: 函數(label, safe, detail), 預設無; 給予時診斷輸出只交給它(不寫console), detail為完整細節(憑證與token已遮罩)
//  回傳固定快照{ logDetail, funLog }, 其後各路徑共用此快照, 不再讀取使用端的opt(getter可能前後不同)
function checkOptLog(opt) {
    let logDetail = get(opt, 'logDetail', null)
    if (logDetail !== undefined && logDetail !== null && typeof logDetail !== 'boolean') {
        throw new Error('invalid opt.logDetail')
    }
    let funLog = get(opt, 'funLog', null)
    if (funLog !== undefined && funLog !== null && typeof funLog !== 'function') {
        throw new Error('invalid opt.funLog')
    }
    return { logDetail: logDetail === true, funLog: typeof funLog === 'function' ? funLog : null }
}


//genDiag, 回傳{ diag, remember }
//  diag: wsemi之診斷輸出實例diag(label, safe, getDetail, level), 另帶diag.brief、diag.mask、diag.err、diag.copy、diag.with(見wsemi getDiag)
//  remember(token): 記住一個token(伺服端為輪詢輸入之__sysToken__, 前端為getToken所得), 其後診斷輸出之細節中該字串遮罩為***; 非空字串才記, 超過TOKEN_MAX者淘汰最舊者
function genDiag(optLog) {

    //book, 以插入順序為新舊
    let book = new Set()
    let remember = (token) => {
        if (typeof token !== 'string' || token === '') {
            return
        }
        book.delete(token)
        book.add(token)
        if (book.size > TOKEN_MAX) {
            book.delete(book.values().next().value)
        }
    }

    //secrets為函數形式: 每次輸出時取當下之清單
    let diag = getDiag(optLog, {
        secrets: () => {
            return getDiagSecrets({ values: Array.from(book) })
        },
        safeKeys: SAFE_KEYS,
    })

    return { diag, remember }
}


export { checkOptLog, genDiag }
