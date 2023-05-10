const mqtt = require('mqtt')

const adminUsers = ['ishay2', 'lior', 'amit']

const setupClient = (ws, user) => {
  let store = {}
  const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'

  const client = mqtt.connect(url, { rejectUnauthorized: false })
  client.on('connect', () => {
    client.subscribe(['YIELDX/STAT/RM/#', 'YIELDX/CONF/RM/#'])
    client.on('message', (topic, payload) => {
      const data = parseMessage(topic, payload)
      store = { ...store, [data.id]: { ...(store[data.id] ?? {}), ...data } }
      if (
        [...adminUsers, store[data.id].customer].includes(user.username) &&
        store[data.id].status &&
        store[data.id].conf
      )
        ws.send(JSON.stringify(store[data.id]))
    })
  })
  client.on('error', (error) => {
    console.log(error)
    ws.close(4004, `MQTT error: ${error.message}`)
  })
}

const parseMessage = (topic, payload) => {
  let data = {}
  try {
    const parsed = JSON.parse(payload.toString())
    if (topic.startsWith('YIELDX/STAT/RM/'))
      data = {
        id: topic.split('/')[3],
        status: {
          start: parsed.STRT * 1000 || 0,
          end: parsed.END * 1000 || 0,
          detection: parsed.DETCT * 1000 || 0,
          trained: parsed.TRND * 1000 || 0,
          battery: parsed.BSTAT === 'Low' ? 'Low' : 'Ok',
        },
        lastUpdated: parsed.TS * 1000 || 0,
      }
    if (topic.startsWith('YIELDX/CONF/RM/CURRENT/'))
      data = {
        id: topic.split('/')[4],
        location: parsed.Location ?? '',
        house: parsed.House ?? '',
        inHouseLoc: parsed.InHouseLoc ?? '',
        customer: parsed.Customer ?? '',
        contact: parsed.Contact ?? '',
        conf: {
          training: {
            preOpen: parsed.PreOpen ?? 0,
            ventDur: parsed.ventDur ?? 1,
            on1: parsed.On_1 ?? 0,
            sleep1: parsed.Sleep_1 ?? 0,
            train: parsed.Train ?? 0,
          },
          daily: {
            open1: parsed.Open_1 ?? '9:46',
            close1: parsed.Close_1 ?? '9:48',
          },
          detection: {
            startDet: parsed.StartDet ?? '9:50',
            vent2: parsed.vent2 ?? 0,
            on2: parsed.On_2 ?? 1,
            sleep2: parsed.Sleep_2 ?? 1,
            detect: parsed.Detect ?? 1,
          },
        },
      }
  } catch {
    console.error('Cannot parse mqtt message')
  }
  return data
}

module.exports = { setupClient, adminUsers }
