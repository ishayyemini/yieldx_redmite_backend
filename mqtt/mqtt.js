const mqtt = require('mqtt')
const moment = require('moment-timezone')
const webpush = require('web-push')
const schedule = require('node-schedule')

const {
  upsertMqttDevice,
  getPushSubscriptions,
  clearBadSubscriptions,
  getDeviceHistory,
} = require('../auth/db_user')
const {
  WEBPUSH_MAIL,
  WEBPUSH_PUBLIC_KEY,
  WEBPUSH_PRIVATE_KEY,
} = require('../tokens.json')

const adminUsers = ['ishay2', 'lior', 'amit', 'izak']

const mqttServers = [
  'mqtts://broker.hivemq.com:8883',
  'mqtts://3.64.31.133:8884',
]

const parseMessage = (topic, payload) => {
  let data = {}
  if (topic.startsWith('YIELDX/OTA/RM/'))
    data = { id: topic.split('/')[3], version: payload.toString() }
  else
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
          hidden: parsed.HIDDEN || false,
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
          comment: parsed.Comment ?? '',
          timezone: isNaN(parsed.TZ) ? 0 : Number(parsed.TZ),
          conf: {
            training: {
              preOpen: parsed.PreOpen ?? 0,
              ventDur: parsed.ventDur ?? 1,
              on1: parsed.On_1 ?? 0,
              sleep1: parsed.Sleep_1 ?? 0,
              train: parsed.Train ?? 0,
            },
            detection: {
              open1: parsed.Open_1?.padStart(5, '0') ?? '09:46',
              close1: parsed.Close_1?.padStart(5, '0') ?? '09:48',
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
      Comment: conf.comment,
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

const pushHiddenDevice = async ({ id, hidden }, user, store) => {
  if (
    adminUsers.includes(user.username) ||
    store.get(id)?.customer === user.customer
  )
    return new Promise((resolve, reject) => {
      const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'
      const client = mqtt.connect(url, { rejectUnauthorized: false })

      const timeout = setTimeout(() => {
        client.end()
        reject('MQTT timeout')
      }, 5000)

      client.on('connect', () => {
        client.subscribe(`YIELDX/STAT/RM/${id}`)
        let published = false
        client.on('message', (_, payload) => {
          if (!published)
            try {
              const data = {
                ...JSON.parse(payload.toString()),
                HIDDEN: hidden || false,
              }
              client.publish(
                `YIELDX/STAT/RM/${id}`,
                JSON.stringify(data),
                { retain: true },
                (error) => {
                  clearTimeout(timeout)
                  client.end()
                  if (error) reject('MQTT error')
                  else resolve()
                }
              )
            } catch {
              reject('MQTT error')
            }
        })
      })
      client.on('error', (error) => {
        console.log(error)
        reject('MQTT error')
      })
    })
  else throw new Error('Unauthorized')
}

const pushOtaUpdate = async (id, version, user, store) => {
  if (
    adminUsers.includes(user.username) ||
    store.get(id)?.customer === user.customer
  )
    return new Promise((resolve, reject) => {
      const url = user.settings?.mqtt || 'mqtts://broker.hivemq.com:8883'

      const client = mqtt.connect(url, { rejectUnauthorized: false })

      client.on('connect', () => {
        client.publish(
          `YIELDX/OTA/RM/${id}`,
          `http://3.127.195.30/RedMite/OTA/${version}.bin`,
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

const setupMqtt = (store) => {
  listenToAlerts(store)

  mqttServers.forEach((url) => {
    const client = mqtt.connect(url, { rejectUnauthorized: false })
    client.on('connect', () => {
      client.subscribe([
        'YIELDX/STAT/RM/#',
        'YIELDX/CONF/RM/#',
        'YIELDX/OTA/RM/#',
      ])
      client.on('message', (topic, payload) => {
        const data = parseMessage(topic, payload)
        const device = { ...(store.get(`${data.id}|${url}`) ?? {}), ...data }

        if (device.status && device.conf) {
          const { cycles, updates } = calcExpectedTime(device)
          device.nextUpdate = updates.nextUpdate.unix() * 1000
          device.afterNextUpdate = updates.afterNextUpdate.unix() * 1000
          device.server = url
          device.status.currentCycle = cycles.currentCycle
          device.status.totalCycles = cycles.totalCycles

          upsertMqttDevice({
            deviceID: device.id,
            server: url,
            timestamp: moment(device.lastUpdated).toISOString(),
            mode: cycles.currentCycle
              ? `${device.status.mode}|${cycles.currentCycle}|${cycles.totalCycles}`
              : device.status.mode,
            customer: device.customer,
            expectedUpdateAt: moment(device.nextUpdate).toISOString(),
          })
        }

        store.set(`${data.id}|${url}`, device)
      })
    })
    client.on('error', (error) => {
      console.log(error)
    })
  })
}

const calcExpectedTime = (device) => {
  let nextUpdate = moment(device.lastUpdated)
  let afterNextUpdate
  let currentCycle = 0
  let totalCycles = 0

  const parseHour = (s, ago) => {
    const [hour, min] = s.split(':')
    const deadline = moment(nextUpdate)
      .tz(`Etc/GMT${(device.timezone >= 0 ? '' : '+') + -device.timezone}`)
      .hour(+hour)
      .minute(+min)
      .second(0)
    if (!ago && nextUpdate.isSameOrAfter(deadline)) deadline.add(1, 'day')
    if (ago && nextUpdate.isSameOrBefore(deadline)) deadline.subtract(1, 'day')
    return deadline
  }

  switch (device.status.mode) {
    case 'PreOpen Lid':
      nextUpdate.add(device.conf.training.preOpen, 'minutes')
      afterNextUpdate = nextUpdate
        .clone()
        .add(device.conf.training.on1 + device.conf.training.sleep1, 'minutes')
      break
    case 'Training':
      const trainCycleLength =
        device.conf.training.on1 + device.conf.training.sleep1
      const minutesSinceStart = moment(device.lastUpdated).diff(
        device.status.start,
        'minutes'
      )
      currentCycle = Math.floor(minutesSinceStart / trainCycleLength) + 1
      totalCycles = Math.ceil(device.conf.training.train / trainCycleLength)

      nextUpdate.add(trainCycleLength, 'minutes')
      if (currentCycle < totalCycles)
        afterNextUpdate = nextUpdate.clone().add(trainCycleLength, 'minutes')
      else {
        // This is calculated *after* 1 cycle!!!
        afterNextUpdate = moment.min(
          parseHour(device.conf.detection.open1),
          parseHour(device.conf.detection.close1),
          parseHour(device.conf.detection.startDet)
        )
      }
      break
    case 'Done Training':
    case 'Lid Closed Daily-Cycle Done':
      nextUpdate = moment.min(
        parseHour(device.conf.detection.open1),
        parseHour(device.conf.detection.close1),
        parseHour(device.conf.detection.startDet)
      )
      // Minimum *after* the first minimum
      afterNextUpdate = moment.min(
        parseHour(device.conf.detection.open1),
        parseHour(device.conf.detection.close1),
        parseHour(device.conf.detection.startDet)
      )
      break
    case 'Lid Opened Idling':
      nextUpdate = parseHour(device.conf.detection.close1)
      afterNextUpdate = parseHour(device.conf.detection.startDet)
      break
    case 'Lid Closed Idling':
      nextUpdate = parseHour(device.conf.detection.startDet)
      afterNextUpdate = nextUpdate
        .clone()
        .add(
          device.conf.detection.on2 + device.conf.detection.sleep2,
          'minutes'
        )
      break
    case 'Inspecting':
    case 'Report Inspection':
      const detectCycleLength =
        device.conf.detection.on2 + device.conf.detection.sleep2
      const minutesSinceOpen = moment(device.lastUpdated).diff(
        parseHour(device.conf.detection.startDet, true),
        'minutes'
      )
      currentCycle =
        (device.status.mode === 'Report Inspection'
          ? Math.floor(minutesSinceOpen / detectCycleLength)
          : Math.round(minutesSinceOpen / detectCycleLength)) + 1
      totalCycles = Math.ceil(device.conf.detection.detect / detectCycleLength)
      currentCycle = Math.min(currentCycle, totalCycles)

      nextUpdate.add(detectCycleLength, 'minutes')
      if (currentCycle < totalCycles)
        afterNextUpdate = nextUpdate.clone().add(detectCycleLength, 'minutes')
      else afterNextUpdate = parseHour(device.conf.detection.open1)
      break
    default:
      afterNextUpdate = nextUpdate
  }

  return {
    updates: { nextUpdate, afterNextUpdate },
    cycles: { currentCycle, totalCycles },
  }
}

const listenToAlerts = (store) => {
  webpush.setVapidDetails(WEBPUSH_MAIL, WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY)

  store.onUpdate((device) => {
    const id = `${device.id}|${device.server}`

    const buffer = 10
    if (moment().subtract(buffer, 'minutes').isBefore(device.afterNextUpdate)) {
      const sendAt = moment
        .max(moment(device.afterNextUpdate), moment())
        .add(buffer, 'minutes')
      schedule.cancelJob(id)
      schedule.scheduleJob(id, sendAt.toDate(), () =>
        sendPushNotification(device)
      )
    }
  })
}

const sendPushNotification = async (device) => {
  const sessions = await getPushSubscriptions([...adminUsers, device.customer])

  const badSessions = await Promise.all(
    sessions.map(({ subscription, session }) =>
      webpush
        .sendNotification(
          subscription,
          JSON.stringify({
            deviceID: device.id,
            lastUpdated: device.lastUpdated,
            expectedUpdateAt: device.nextUpdate,
            mode: device.status.mode,
            server: device.server,
          })
        )
        .then(() => null)
        .catch((err) => {
          console.log(err)
          return session
        })
    )
  )
    .then((res) => res.filter((item) => item))
    .catch(() => [])

  if (badSessions.length) await clearBadSubscriptions(badSessions)
}

const getOperations = async ({ id, server }, user, store) => {
  const device = store.get(`${id}|${server}`)
  if (
    !adminUsers.includes(user.username) &&
    !device?.customer === user.customer
  )
    throw new Error('Unauthorized')

  const deviceHistory = await getDeviceHistory(device)
  const operations = [
    {
      category: 'Training',
      totalCycles: 0,
      cycles: [],
    },
  ]

  const preOpenEvent = deviceHistory.find((item) => item.mode === 'PreOpen Lid')
  const trainingEvents = deviceHistory.filter(
    (item) => item.mode.startsWith('Training') && item.mode.split('|')[2]
  )
  if (trainingEvents.length)
    operations[0].totalCycles = Number(trainingEvents[0].mode.split('|')[2])
  else
    operations[0].totalCycles = Math.ceil(
      device.conf.training.train /
        (device.conf.training.on1 + device.conf.training.sleep1)
    )
  operations[0].cycles = Array.from({
    length: operations[0].totalCycles + 1,
  }).map(() => null)

  if (preOpenEvent)
    operations[0].cycles[0] = {
      start: moment(preOpenEvent.timestamp),
      end: moment(preOpenEvent.expectedUpdateAt),
    }

  trainingEvents.forEach((item) => {
    const index = Number(item.mode.split('|')[1])
    const oldItem = operations[0].cycles[index]
    if (oldItem)
      operations[0].cycles[index] = {
        start: moment.min(oldItem.start, moment(item.timestamp)),
        end: moment.max(
          oldItem.end,
          moment.min(moment(item.endTime), moment(item.expectedUpdateAt))
        ),
      }
    else
      operations[0].cycles[index] = {
        start: moment(item.timestamp),
        end: moment.min(moment(item.endTime), moment(item.expectedUpdateAt)),
      }
  })

  const inspectionOrder = [
    'Lid Opened Idling',
    'Lid Closed Idling',
    ['Inspecting', 'Report Inspection'],
  ]

  const inspectionCycles = []
  deviceHistory.forEach((item) => {
    const currentStage = inspectionOrder.findIndex((prefix) =>
      typeof prefix === 'string'
        ? item.mode.startsWith(prefix)
        : prefix.some((p) => item.mode.startsWith(p))
    )
    if (currentStage > -1) {
      if (
        inspectionCycles.slice(-1)[0] &&
        currentStage >=
          (inspectionCycles.slice(-1)[0]?.slice(-1)[0]?.stage || 0)
      )
        inspectionCycles.slice(-1)[0].push({ ...item, stage: currentStage })
      else inspectionCycles.push([{ ...item, stage: currentStage }])
    }
  })

  inspectionCycles.forEach((cycle, cycleIndex) => {
    operations.push({ category: 'Daily Cycle', totalCycles: 0, cycles: [] })
    const openEvents = cycle.filter((item) => item.mode === 'Lid Opened Idling')
    const closeEvents = cycle.filter(
      (item) => item.mode === 'Lid Closed Idling'
    )
    const inspectionEvents = cycle.filter(
      (item) => item.mode.includes('Inspect') && item.mode.split('|')[2]
    )

    if (inspectionEvents.length)
      operations[cycleIndex + 1].totalCycles = Number(
        inspectionEvents[0].mode.split('|')[2]
      )
    else
      operations[0].totalCycles = Math.ceil(
        device.conf.detection.detect /
          (device.conf.detection.on2 + device.conf.detection.sleep2)
      )
    operations[cycleIndex + 1].cycles = Array.from({
      length: operations[cycleIndex + 1].totalCycles + 2,
    }).map(() => null)

    if (openEvents.length)
      operations[cycleIndex + 1].cycles[0] = {
        start: moment.min(openEvents.map((item) => moment(item.timestamp))),
        end: moment.max(
          openEvents.map((item) =>
            moment.min(moment(item.endTime), moment(item.expectedUpdateAt))
          )
        ),
      }
    if (closeEvents.length)
      operations[cycleIndex + 1].cycles[1] = {
        start: moment.min(closeEvents.map((item) => moment(item.timestamp))),
        end: moment.max(
          closeEvents.map((item) =>
            moment.min(moment(item.endTime), moment(item.expectedUpdateAt))
          )
        ),
      }

    inspectionEvents.forEach((item) => {
      const index = Number(item.mode.split('|')[1]) + 1
      const oldItem = operations[cycleIndex + 1].cycles[index]
      operations[cycleIndex + 1].cycles[index] = {
        start: moment.min(oldItem?.start ?? moment(), moment(item.timestamp)),
        end: moment(
          inspectionEvents.find((item) =>
            item.mode.startsWith(`Inspecting|${index - 1}|`)
          )?.expectedUpdateAt ||
            oldItem?.end ||
            moment.min(moment(item.endTime), moment(item.expectedUpdateAt))
        ),
      }
    })
  })

  operations.slice(-1)[0].cycles.forEach((cycle, index) => {
    if (
      index + 1 < operations.slice(-1)[0].cycles.length &&
      operations
        .slice(-1)[0]
        .cycles.slice(index + 1)
        .every((cycle) => cycle === null)
    ) {
      if (cycle?.end?.clone().add(10, 'minutes').isAfter(moment()))
        operations.slice(-1)[0].cycles[index + 1] = { start: cycle.end }
      else if (cycle?.start && !cycle.end)
        operations.slice(-1)[0].cycles[index + 1] = {
          start: cycle.start
            .clone()
            .add(
              operations.slice(-1)[0].category === 'Daily Cycle'
                ? device.conf.detection.on2 + device.conf.detection.sleep2
                : device.conf.training.on1 + device.conf.training.sleep1,
              'minutes'
            ),
        }
    }
  })

  return operations
    .map((item) => ({
      ...item,
      cycles: item.cycles
        // Don't allow cycles to overlap
        .map((cycle, index, arr) =>
          cycle?.end
            ? {
                start: cycle.start,
                end: arr[index + 1]?.start
                  ? moment.min(arr[index + 1]?.start, cycle.end)
                  : cycle.end,
              }
            : cycle
        )
        // Map Moments into unix
        .map((cycle) =>
          cycle
            ? {
                start: cycle.start ? cycle.start.unix() * 1000 : undefined,
                end: cycle.end ? cycle.end.unix() * 1000 : undefined,
              }
            : null
        ),
    }))
    .reverse()
}

module.exports = {
  adminUsers,
  pushConfUpdate,
  pushOtaUpdate,
  setupMqtt,
  calcExpectedTime,
  mqttServers,
  pushHiddenDevice,
  getOperations,
}
