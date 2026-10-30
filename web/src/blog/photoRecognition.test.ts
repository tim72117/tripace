import { describe, expect, it } from 'vitest'
import { normalizeNote } from './photoRecognition'

describe('normalizeNote', () => {
  it('去掉前後空白與包住整句的引號', () => {
    expect(normalizeNote('  「清水寺舞台的秋季楓紅」 ')).toBe('清水寺舞台的秋季楓紅')
    expect(normalizeNote('"A shrine gate"')).toBe('A shrine gate')
  })
  it('多行只留第一個非空行', () => {
    expect(normalizeNote('\n\n夜晚的老街紅燈籠\n補充說明')).toBe('夜晚的老街紅燈籠')
  })
  it('超過上限截斷,以字元計(不切壞中文)', () => {
    expect(Array.from(normalizeNote('字'.repeat(300))).length).toBe(120)
  })
  it('空內容回傳空字串', () => {
    expect(normalizeNote('  \n ')).toBe('')
  })
})
