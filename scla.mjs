import FormData from 'form-data'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from './src/WServBroadcastClient.mjs'


let ms = []

let opt = {
    FormData,
    url: 'http://localhost:8080',
    apiName: 'api',
}

//instWConverClient
let instWConverClient = new WConverhpClient(opt)

//wo
let wo = new WServBroadcastClient(instWConverClient)

wo.on('broadcast', function(data) {
    console.log(`broadcast`, data)
    ms.push({ receive: data })
})
wo.on('openOnce', function() {
    console.log(`openOnce`)
    ms.push({ event: 'openOnce' })
})
wo.on('open', function() {
    console.log(`open`)
    ms.push({ event: 'open' })
})
wo.on('error', function(err) {
    console.log(`error`, err)
})

setTimeout(() => {
    wo.clearBroadcast()
    console.log('ms', ms)
}, 13000)

//node --experimental-modules scla.mjs
