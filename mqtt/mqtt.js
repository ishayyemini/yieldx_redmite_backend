const mqtt = require('mqtt')
const moment = require('moment')
const webpush = require('web-push')

const {
  upsertMqttDevice,
  getMqttDevices,
  getPushSubscriptions,
} = require('../auth/db_user')
const {
  WEBPUSH_MAIL,
  WEBPUSH_PUBLIC_KEY,
  WEBPUSH_PRIVATE_KEY,
} = require('../tokens.json')

const adminUsers = ['ishay2', 'lior', 'amit']

const mqttServers = [
  'mqtts://broker.hivemq.com:8883',
  'mqtts://3.64.31.133:8884',
]

const setupClient = (ws, user) => {
  let store = {}
  const url = mqttServers.includes(user.settings?.mqtt)
    ? user.settings?.mqtt
    : mqttServers[0]

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
          mode: parsed.MODE || '',
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
            open1: parsed.Open_1?.padStart(5, '0') ?? '09:46',
            close1: parsed.Close_1?.padStart(5, '0') ?? '09:48',
          },
          detection: {
            startDet: parsed.StartDet?.padStart(5, '0') ?? '09:50',
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

const pushConfUpdate = async (conf, user) => {
  return new Promise((resolve, reject) => {
    const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'
    const data = JSON.stringify({
      Location: conf.location,
      House: conf.house,
      InHouseLoc: conf.inHouseLoc,
      Customer: conf.customer,
      Contact: conf.contact,
      PreOpen: conf.preOpen,
      ventDur: conf.ventDur,
      On_1: conf.on1,
      Sleep_1: conf.sleep1,
      Train: conf.train,
      Open_1: conf.open1,
      Close_1: conf.close1,
      StartDet: conf.startDet,
      vent2: conf.vent2,
      On_2: conf.on2,
      Sleep_2: conf.sleep2,
      Detect: conf.detect,
    })
    const client = mqtt.connect(url, { rejectUnauthorized: false })

    client.on('connect', () => {
      client.publish(
        `YIELDX/CONF/RM/NEW/${conf.id}`,
        data,
        { retain: true },
        (error) => {
          client.end()
          if (error) reject('MQTT error')
          else resolve()
        }
      )
    })
    client.on('error', (error) => {
      console.log(error)
      reject('MQTT error')
    })
  })
}

const logMqtt = () => {
  mqttServers.forEach((url) => {
    let store = {}
    const client = mqtt.connect(url, { rejectUnauthorized: false })
    client.on('connect', () => {
      client.subscribe(['YIELDX/STAT/RM/#', 'YIELDX/CONF/RM/#'])
      client.on('message', async (topic, payload) => {
        const data = parseMessage(topic, payload)
        store = { ...store, [data.id]: { ...(store[data.id] ?? {}), ...data } }
        if (store[data.id].status && store[data.id].conf) {
          const device = store[data.id]

          upsertMqttDevice({
            deviceID: device.id,
            server: url,
            timestamp: new Date(device.lastUpdated).toISOString(),
            mode: device.status.mode,
            customer: device.customer,
            expectedUpdateAt: calcExpectedTime(device),
          })
        }
      })
    })
    client.on('error', (error) => {
      console.log(error)
    })
  })
}

const calcExpectedTime = (device) => {
  const time = moment(device.lastUpdated)

  const parseHour = (s) => {
    const [hour, min] = s.split(':')
    const oldTime = time.clone()
    time.hour(+hour).minute(+min).second(0)
    if (oldTime.isAfter(time)) time.add(1, 'day')
  }

  switch (device.status.mode) {
    case 'PreOpen Lid':
      time.add(device.conf.training.preOpen, 'minutes')
      break
    case 'Training':
      time.add(
        device.conf.training.on1 + device.conf.training.sleep1,
        'minutes'
      )
      break
    case 'Done Training':
    case 'Lid Closed Daily-Cycle Done':
      parseHour(device.conf.daily.open1)
      break
    case 'Lid Opened Idling':
      parseHour(device.conf.daily.close1)
      break
    case 'Lid Closed Idling':
      parseHour(device.conf.detection.startDet)
      break
    case 'Inspecting':
    case 'Report Inspection':
      time.add(
        device.conf.detection.on2 + device.conf.detection.sleep2,
        'minutes'
      )
      break
  }

  return time.toISOString()
}

const listenToAlerts = () => {
  webpush.setVapidDetails(WEBPUSH_MAIL, WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY)

  let lastPolled = '',
    devices = {}

  const pollDB = async () => {
    const newDevices = await getMqttDevices(lastPolled)

    newDevices.forEach((device) => {
      const id = `${device.deviceID}|${device.server}`
      const minutes = moment(device.expectedUpdateAt).diff(moment(), 'minutes')
      if (minutes > 0)
        device.notify = setTimeout(() => {
          sendPushNotification(devices[id])
        }, (minutes + 10) * 60 * 1000)
      devices[id] = device
    })

    lastPolled = new Date().toISOString()
  }

  setInterval(async () => {
    await pollDB()
  }, 10 * 60 * 1000)
}

const sendPushNotification = async (device) => {
  const subs = await getPushSubscriptions([...adminUsers, device.customer])
  console.log(subs)
  subs.forEach((sub) => {
    webpush.sendNotification(
      sub,
      JSON.stringify({
        title: 'RedMite - Device Error Alert',
        description: `Device ${device.deviceID} was expected
        to update at ${moment(device.expectedUpdateAt).toISOString()}.
        Current status is ${device.mode} since
        ${moment(device.timestamp).toISOString()}`,
      })
    )
  })
}

module.exports = {
  setupClient,
  adminUsers,
  pushConfUpdate,
  logMqtt,
  listenToAlerts,
}
