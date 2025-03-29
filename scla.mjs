import FormData from 'form-data'
import WConverhpClient from 'w-converhp/src/WConverhpClient.mjs'
import WServBroadcastClient from './src/WServBroadcastClient.mjs'


let opt = {
    FormData,
    url: 'http://localhost:8080',
    apiName: 'api',
}

//instWConverClient
let instWConverClient = new WConverhpClient(opt)

//wo
let wo = WServBroadcastClient(instWConverClient)

wo.on('broadcast', function(data) {
    console.log(`broadcast`, data)
})
wo.on('openOnce', function() {
    console.log(`openOnce`)
})
wo.on('open', function() {
    console.log(`open`)
})
wo.on('error', function(err) {
    console.log(`error`, err)
})

//node --experimental-modules scla.mjs
