//pollingTokenKey, 輪詢之輸入中放置使用端token之固定鍵(內部使用, 前後端共用)
//  前端opt.getToken之回傳值放於此鍵; 伺服端注入opt.verifyPolling時, 驗證放行後、交使用端監聽之前剝除此鍵, 避免token進入clientEnter、clientLeave之data
//  鍵名與w-serv-webdata系統函數之token鍵一致(__sysToken__)
let pollingTokenKey = '__sysToken__'


export default pollingTokenKey
