// useIslandScene.ts——載入一個場景的資料(含載入中、失敗、重試),給 IslandPage 用。
//
// 防競態:狀態記著「是哪個場景、第幾次嘗試」的結果,與目前要的不同就視為載入中,
// 所以快速連續切換場景時,先送出、後回來的舊結果不會蓋掉新場景(舊 effect 的 cancelled 旗標也會擋住它的 setState)。
import { useCallback, useEffect, useState } from 'react'
import { loadIslandData, type IslandData } from '../islandData'

export type SceneLoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: IslandData }
  | { status: 'error'; error: unknown }

type Result = { key: string; state: Exclude<SceneLoadState, { status: 'loading' }> }

export function useIslandScene(sceneId: string): { state: SceneLoadState; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const key = `${sceneId}#${attempt}`

  useEffect(() => {
    let cancelled = false
    loadIslandData(sceneId).then(
      (data) => { if (!cancelled) setResult({ key, state: { status: 'ready', data } }) },
      (error) => { if (!cancelled) setResult({ key, state: { status: 'error', error } }) },
    )
    return () => { cancelled = true }
  }, [sceneId, key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const state: SceneLoadState = result && result.key === key ? result.state : { status: 'loading' }
  return { state, retry }
}
