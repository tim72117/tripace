import { describe, expect, it } from 'vitest'
import type { AskPageInput } from '../conversation/asktools'
import {
  askPageAwaitsText,
  COMPOSER_PLACEHOLDER_MAX_EM,
  COMPOSER_PLACEHOLDER_UNAVAILABLE,
  composerModeFor,
  composerPlaceholderFor,
  placeholderWidthEm,
  routeComposerSubmit,
} from './composerMode'

const CANDIDATES: AskPageInput = { candidates: [{ placeId: 'p1', name: '赤崁樓' }] }
const LOADING: AskPageInput = { candidates: [], reason: '正在查詢台南的景點…', loading: true }
const EXPLORE: AskPageInput = { explore: { destination: '台南' } }
const COUNTRY: AskPageInput = { country: {} }
const CITY: AskPageInput = { city: { countryId: 'japan' } }
const CITY_UNKNOWN: AskPageInput = { city: { countryId: 'nowhere' } }
const TRANSPORT: AskPageInput = { transport: ['walk', 'car'] }
const TEXT: AskPageInput = { text: '好的' }

describe('composerPlaceholderFor——輸入匡提示文字依畫面變動', () => {
  it.each([
    ['沒有詢問頁', null, false, '請輸入想去的地方'],
    ['沒有詢問頁、推論中', null, true, 'AI 思考中…'],
    ['國家頁', COUNTRY, false, '或直接輸入國家'],
    ['國家頁(推論中仍等使用者)', COUNTRY, true, '或直接輸入國家'],
    ['城市頁', CITY, false, '或直接輸入城市'],
    ['城市頁(推論中)', CITY_UNKNOWN, true, '或直接輸入城市'],
    ['景點候選頁', CANDIDATES, true, '或直接說明想去哪'],
    ['探查', EXPLORE, false, '或直接說明想去哪'],
    ['查詢中', LOADING, false, '景點查詢中…'],
    ['查詢中(推論中)', LOADING, true, '景點查詢中…'],
    ['交通頁', TRANSPORT, true, '或直接說明移動方式'],
    ['文字氣泡', TEXT, false, '請輸入想去的地方'],
    ['文字氣泡、推論中', TEXT, true, 'AI 思考中…'],
  ] as const)('%s', (_label, ask, isThinking, expected) => {
    expect(composerPlaceholderFor({ isThinking, ask })).toBe(expected)
  })
})

describe('askPageAwaitsText——哪些詢問頁在等使用者、可以用輸入匡回答', () => {
  it.each([
    [COUNTRY, true],
    [CITY, true],
    [CANDIDATES, true],
    [EXPLORE, true],
    [TRANSPORT, true],
    [LOADING, false],
    [TEXT, false],
    [null, false],
  ] as const)('%j → %s', (ask, expected) => {
    expect(askPageAwaitsText(ask)).toBe(expected)
  })
})

describe('composerModeFor——輸入匡鎖定規則', () => {
  it('沒有詢問頁:推論中鎖住(busy),否則可輸入,送出走一般訊息', () => {
    expect(composerModeFor({ isThinking: true, ask: null })).toMatchObject({ busy: true, answersAskPage: false })
    expect(composerModeFor({ isThinking: false, ask: null })).toMatchObject({ busy: false, answersAskPage: false })
  })

  it('有等待使用者的詢問頁:即使推論中也不鎖,送出改走詢問頁', () => {
    for (const ask of [COUNTRY, CITY, CANDIDATES, EXPLORE, TRANSPORT]) {
      expect(composerModeFor({ isThinking: true, ask })).toMatchObject({ busy: false, answersAskPage: true })
      expect(composerModeFor({ isThinking: false, ask })).toMatchObject({ busy: false, answersAskPage: true })
    }
  })

  it('查詢中、文字氣泡:不算等待使用者,推論中維持鎖住', () => {
    for (const ask of [LOADING, TEXT]) {
      expect(composerModeFor({ isThinking: true, ask })).toMatchObject({ busy: true, answersAskPage: false })
      expect(composerModeFor({ isThinking: false, ask })).toMatchObject({ busy: false, answersAskPage: false })
    }
  })

  it('placeholder 與 composerPlaceholderFor 一致', () => {
    expect(composerModeFor({ isThinking: true, ask: CANDIDATES }).placeholder).toBe(
      composerPlaceholderFor({ isThinking: true, ask: CANDIDATES }),
    )
  })
})

describe('routeComposerSubmit——送出要走哪條路', () => {
  it('空白(trim 後)不送', () => {
    expect(routeComposerSubmit('   ', composerModeFor({ isThinking: false, ask: CANDIDATES }))).toBe('ignore')
    expect(routeComposerSubmit('', composerModeFor({ isThinking: false, ask: null }))).toBe('ignore')
  })
  it('有等待使用者的詢問頁 → askPage(推論中也是)', () => {
    expect(routeComposerSubmit('古蹟', composerModeFor({ isThinking: true, ask: CANDIDATES }))).toBe('askPage')
    expect(routeComposerSubmit('古蹟', composerModeFor({ isThinking: false, ask: COUNTRY }))).toBe('askPage')
  })
  it('沒有詢問頁 → prompt;推論中(鎖住)→ ignore', () => {
    expect(routeComposerSubmit('台南', composerModeFor({ isThinking: false, ask: null }))).toBe('prompt')
    expect(routeComposerSubmit('台南', composerModeFor({ isThinking: true, ask: null }))).toBe('ignore')
    expect(routeComposerSubmit('台南', composerModeFor({ isThinking: true, ask: LOADING }))).toBe('ignore')
    expect(routeComposerSubmit('台南', composerModeFor({ isThinking: false, ask: TEXT }))).toBe('prompt')
  })
})

// 長度上限:窄手機(320px)輸入框扣掉送出鈕後約 198px、字級 16px,約 12 個全形字(推算見 composerMode.ts)。
// Composer 的輸入框沒有 text-overflow: ellipsis,超出會直接被裁掉,所以每句都要在上限內。
describe('提示文字長度', () => {
  const SCREENS: Array<[string, string]> = [
    ['一般', composerPlaceholderFor({ isThinking: false, ask: null })],
    ['推論中', composerPlaceholderFor({ isThinking: true, ask: null })],
    ['國家頁', composerPlaceholderFor({ isThinking: false, ask: COUNTRY })],
    ['城市頁', composerPlaceholderFor({ isThinking: false, ask: CITY })],
    ['景點候選頁', composerPlaceholderFor({ isThinking: false, ask: CANDIDATES })],
    ['探查', composerPlaceholderFor({ isThinking: false, ask: EXPLORE })],
    ['查詢中', composerPlaceholderFor({ isThinking: false, ask: LOADING })],
    ['交通頁', composerPlaceholderFor({ isThinking: false, ask: TRANSPORT })],
    ['文字氣泡', composerPlaceholderFor({ isThinking: false, ask: TEXT })],
    ['對話功能無法使用', COMPOSER_PLACEHOLDER_UNAVAILABLE],
  ]

  it('上限常數為 12', () => {
    expect(COMPOSER_PLACEHOLDER_MAX_EM).toBe(12)
  })

  it('寬度估算:全形 1、ASCII 0.5', () => {
    expect(placeholderWidthEm('請輸入想去的地方')).toBe(8)
    expect(placeholderWidthEm('AI 思考中…')).toBe(5.5)
  })

  it.each([
    ['一般', '請輸入想去的地方', 8],
    ['推論中', 'AI 思考中…', 5.5],
    ['國家頁', '或直接輸入國家', 7],
    ['城市頁', '或直接輸入城市', 7],
    ['景點候選頁', '或直接說明想去哪', 8],
    ['探查', '或直接說明想去哪', 8],
    ['查詢中', '景點查詢中…', 6],
    ['交通頁', '或直接說明移動方式', 9],
    ['文字氣泡', '請輸入想去的地方', 8],
    ['對話功能無法使用', '對話功能調整中，請稍候', 11],
  ] as const)('%s:「%s」寬 %s em', (screen, text, width) => {
    const actual = SCREENS.find(([s]) => s === screen)![1]
    expect(actual).toBe(text)
    expect(placeholderWidthEm(actual)).toBe(width)
    expect(placeholderWidthEm(actual)).toBeLessThanOrEqual(COMPOSER_PLACEHOLDER_MAX_EM)
  })

  it('語意不同的詢問頁畫面不共用同一句文案(只有景點候選與探查同義、文字氣泡沿用一般)', () => {
    const SAME_MEANING = [['景點候選頁', '探查'], ['一般', '文字氣泡']]
    const groupOf = (screen: string) => SAME_MEANING.findIndex((g) => g.includes(screen))
    for (const [a, ta] of SCREENS) {
      for (const [b, tb] of SCREENS) {
        if (a >= b || ta !== tb) continue
        const ga = groupOf(a)
        expect(ga !== -1 && ga === groupOf(b), `${a} 與 ${b} 文案相同「${ta}」`).toBe(true)
      }
    }
  })
})
