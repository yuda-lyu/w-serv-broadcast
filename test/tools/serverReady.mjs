//本檔為測試共用之輔助函式, 不含測試案例(檔名不帶.test., 不被mocha之test/*.test.mjs抓取)
import waitFun from 'wsemi/src/waitFun.mjs'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'


//探測請求之函數名: 僅供waitServerReady使用, 不與本套件之[sys:polling]相混
let funcProbe = 'sys-ready-probe'


//waitServerReady, 待真WConverhpServer(已加上本套件伺服端者)可服務: 以WConverhpClient經HTTP發出探測請求, 有回應即就緒, 失敗(尚未監聽等)則稍後重試
//why: 原於啟動後固定等待500ms, 高負載下啟動較慢時整案失敗; WConverhpServer未提供就緒事件或Promise, 且其屬他套件, 故以連線探測(wsemi之waitFun)取代
//  探測走完整之通訊協定: 埠被他行程占用而啟動失敗時, 對方不會以本協定回應, 不會誤判為就緒
//  srv: 通訊服務事件物件; url: 伺服端網址(apiName固定為api); getStartError(): 回傳啟動失敗之訊息字串或假值
//    啟動失敗(例如埠被占用)時WConverhpServer只發error事件而不拋錯, 於此轉為拋錯, 使該案失敗而非以錯誤之前提通過
//  探測期間臨時掛一個只回應探測請求之execute監聽, 就緒後立即移除(不改變各案對execute監聽之假設, 例如無監聽時通訊服務直接拒絕)
//  吾人之防懸置上限(attemptNum 500 x 20ms)只防啟動永不完成, 不表達規格
let waitServerReady = async (srv, url, getStartError) => {
    let onProbe = (func, input, pm) => {
        if (func === funcProbe) {
            pm.resolve('ready')
        }
    }
    srv.on('execute', onProbe)
    try {
        await waitFun(async () => {
            let errStart = getStartError()
            if (errStart) {
                throw new Error(`伺服端啟動失敗: ${errStart}`)
            }
            let cli = new WConverhpClient({ url, apiName: 'api', retryMain: 0 })
            try {
                await cli.execute(funcProbe, {}, () => {})
                return true
            }
            catch (err) {
                return false
            }
        }, { timeInterval: 20, attemptNum: 500 })
    }
    finally {
        srv.off('execute', onProbe)
    }
}


export {
    waitServerReady
}
