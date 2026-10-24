// itineraryCheckupData.ts——構想四(行程健檢)的雛形假資料與規則草稿。
// 對應 brainstorm 文件列出的四種檢查項目:時間衝突、交通銜接不合理、
// 景點公休日/營業時間衝突、餐期安排。這裡用最小可行的假時間軸資料
// 模擬四種情況各出現一次,規則函式是雛形階段的簡化版,真正落地時應該
// 串接景點的實際營業時間資料(文件原話:「需要串接景點的營業時間資料」)
// ——這裡的 openHours/closedDays 都是寫死的假資料,不是真實 API。

export interface CheckupStop {
  id: string
  name: string
  arriveTime: string // "HH:MM"
  leaveTime: string // "HH:MM"
  // walkMinutesToNext——到下一站的實際步行時間估計(假資料),用來跟
  // 「下一站的開始時間 - 這一站的結束時間」比較,抓交通銜接不合理。
  walkMinutesToNext?: number
  openHours?: { from: string; to: string }
  closedWeekdays?: number[] // 0=週日...6=週六
  isMeal?: boolean
}

export interface CheckupItinerary {
  id: string
  title: string
  // weekday——這趟行程進行的星期幾(0=週日),用來比對 closedWeekdays。
  weekday: number
  stops: CheckupStop[]
}

export const CHECKUP_SAMPLE: CheckupItinerary = {
  id: 'sample-day',
  title: '範例行程：第三天（週二）',
  weekday: 2,
  stops: [
    { id: 's1', name: '飯店出發', arriveTime: '08:00', leaveTime: '08:30', walkMinutesToNext: 10 },
    {
      id: 's2',
      name: '故宮博物院',
      arriveTime: '08:40',
      leaveTime: '11:00',
      walkMinutesToNext: 90,
      openHours: { from: '09:00', to: '17:00' },
    },
    {
      // s3 的 arriveTime 早於 s2 離開 + 走路時間，製造「交通銜接不合理」
      id: 's3',
      name: '士林夜市',
      arriveTime: '11:30',
      leaveTime: '13:00',
      walkMinutesToNext: 20,
    },
    {
      // s4 的 closedWeekdays 含週二，製造「公休日衝突」
      id: 's4',
      name: '某間公休週二的特色博物館',
      arriveTime: '13:30',
      leaveTime: '15:00',
      walkMinutesToNext: 15,
      closedWeekdays: [2],
    },
    {
      // s5 到 s6 之間整個下午沒有安排用餐，製造「餐期安排」警示
      id: 's5',
      name: '文創園區',
      arriveTime: '15:30',
      leaveTime: '18:30',
      walkMinutesToNext: 5,
    },
    { id: 's6', name: '夜景觀景台', arriveTime: '18:35', leaveTime: '20:00' },
  ],
}

export type CheckupSeverity = 'warning' | 'info'

export interface CheckupIssue {
  stopId: string
  type: 'time-conflict' | 'transit-gap' | 'closed-day' | 'meal-gap'
  severity: CheckupSeverity
  message: string
}

// runCheckup——雛形階段的簡化規則:
//   1. 時間衝突:下一站 arriveTime 早於上一站 leaveTime + walkMinutesToNext。
//   2. 交通銜接不合理:這裡用跟 1 同一組資料示範,銜接時間明顯不足。
//   3. 營業時間/公休日衝突:比對 closedWeekdays 與行程進行的星期幾。
//   4. 餐期安排:連續超過 5 小時沒有 isMeal 的節點，標記提醒。
// 真正落地時,這些規則應該交給 AI 判斷(對齊文件「AI 掃過整個時間軸」),
// 不是前端寫死的時間加減——這裡只驗證「健檢結果怎麼呈現給使用者」這個
// UI 層的雛形,規則本身的正確性不是這次雛形要驗證的重點。
export function runCheckup(itinerary: CheckupItinerary): CheckupIssue[] {
  const issues: CheckupIssue[] = []
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  for (let i = 0; i < itinerary.stops.length - 1; i++) {
    const cur = itinerary.stops[i]
    const next = itinerary.stops[i + 1]
    const curLeave = toMinutes(cur.leaveTime)
    const nextArrive = toMinutes(next.arriveTime)
    const walk = cur.walkMinutesToNext ?? 0
    const gap = nextArrive - curLeave

    if (gap < 0) {
      issues.push({
        stopId: next.id,
        type: 'time-conflict',
        severity: 'warning',
        message: `「${next.name}」的抵達時間（${next.arriveTime}）早於「${cur.name}」的離開時間（${cur.leaveTime}），時間軸有衝突。`,
      })
    } else if (walk > 0 && gap < walk) {
      issues.push({
        stopId: next.id,
        type: 'transit-gap',
        severity: 'warning',
        message: `「${cur.name}」到「${next.name}」步行約需 ${walk} 分鐘，但排定的銜接時間只有 ${gap} 分鐘，可能來不及。`,
      })
    }

    if (gap > 300 && !cur.isMeal && !next.isMeal) {
      issues.push({
        stopId: next.id,
        type: 'meal-gap',
        severity: 'info',
        message: `「${cur.name}」到「${next.name}」之間超過 5 小時沒有安排用餐，建議插入餐期。`,
      })
    }
  }

  for (const stop of itinerary.stops) {
    if (stop.closedWeekdays?.includes(itinerary.weekday)) {
      issues.push({
        stopId: stop.id,
        type: 'closed-day',
        severity: 'warning',
        message: `「${stop.name}」在這天公休，請確認或調整日期。`,
      })
    }
    if (stop.openHours) {
      const arrive = toMinutes(stop.arriveTime)
      const open = toMinutes(stop.openHours.from)
      const close = toMinutes(stop.openHours.to)
      if (arrive < open) {
        issues.push({
          stopId: stop.id,
          type: 'closed-day',
          severity: 'info',
          message: `「${stop.name}」營業時間是 ${stop.openHours.from}–${stop.openHours.to}，抵達時間（${stop.arriveTime}）比開門時間早。`,
        })
      }
      if (toMinutes(stop.leaveTime) > close) {
        issues.push({
          stopId: stop.id,
          type: 'closed-day',
          severity: 'info',
          message: `「${stop.name}」營業時間是 ${stop.openHours.from}–${stop.openHours.to}，離開時間（${stop.leaveTime}）晚於打烊時間。`,
        })
      }
    }
  }

  return issues
}
