// 景點卡片的圖片外框:有圖、沒圖、圖載入失敗三種狀態外框 class 都一致(固定高度站位)。
// 外框以 import 的 styles.photo 精確比對(不用 [class*="photo"]——那會同時命中裡面的 .photoPlaceholder)。
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { RecommendedPlaceCard, type RecommendedPlace } from './RecommendedPlaces'
import styles from './RecommendedPlaces.module.css'

const base: RecommendedPlace = {
  name: '赤崁樓', address: 'x', lat: 0, lng: 0, rating: 0, userRatingCount: 0, primaryType: 'museum',
}

// frameOf——卡片的圖片外框(class 恰好是 styles.photo 的那一個元素),必須剛好一個。
function frameOf(container: HTMLElement): HTMLElement {
  const frames = Array.from(container.querySelectorAll<HTMLElement>(`.${styles.photo}`))
  expect(frames).toHaveLength(1)
  return frames[0]
}

describe('RecommendedPlaceCard 圖片站位', () => {
  it('沒有 photoUrl 時仍渲染佔位外框', () => {
    const { container, getByText } = render(<RecommendedPlaceCard place={base} />)
    expect(getByText('佔位圖')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    const frame = frameOf(container)
    expect(frame.className).toBe(styles.photo)
    // 佔位圖在外框內(而不是外框不見、只剩佔位圖)
    expect(frame.querySelector(`.${styles.photoPlaceholder}`)).not.toBeNull()
  })

  it('有圖與無圖的外框 class 相同', () => {
    const a = frameOf(render(<RecommendedPlaceCard place={base} />).container)
    const withImg = render(<RecommendedPlaceCard place={{ ...base, photoUrl: 'http://x/y.png' }} />).container
    const b = frameOf(withImg)
    expect(a.className).toBe(styles.photo)
    expect(b.className).toBe(a.className)
    expect(b.querySelector('img')?.getAttribute('src')).toBe('http://x/y.png')
  })

  it('圖片載入失敗時換成佔位圖且外框 class 不變', () => {
    const { container, getByText } = render(<RecommendedPlaceCard place={{ ...base, photoUrl: 'http://x/y.png' }} />)
    const frame = frameOf(container)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(getByText('佔位圖')).toBeTruthy()
    expect(frameOf(container)).toBe(frame)
    expect(frame.className).toBe(styles.photo)
  })

  it('失敗後換一張新的 photoUrl:重新顯示 img(失敗記號只綁在舊網址上);新網址也失敗才再退回佔位', () => {
    const { container, rerender, queryByText } = render(<RecommendedPlaceCard place={{ ...base, photoUrl: 'http://x/old.png' }} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()

    rerender(<RecommendedPlaceCard place={{ ...base, photoUrl: 'http://x/new.png' }} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('http://x/new.png')
    expect(queryByText('佔位圖')).toBeNull()
    expect(frameOf(container).className).toBe(styles.photo)

    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(queryByText('佔位圖')).not.toBeNull()
  })
})
