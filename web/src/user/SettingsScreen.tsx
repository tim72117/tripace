import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { User } from './types'
import type { AssistLang } from '../assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from '../assistLang'
import type { Theme } from '../theme'
import { Avatar } from '../AppCommon'
import { LoginForm } from '../home/LoginForm'
import { LangSelect } from './LangSelect'
import { ThemeToggle } from './ThemeToggle'
import { ScrollArea } from '../components/ScrollArea'
import { FormField } from '../components/FormField'
import { ListRow } from '../components/ListRow'

// SettingsScreen:手機版設定內容——從 PhoneScreens.tsx 拆成獨立檔案,只有
// 這一個元件在用,不再跟 PublicViewScreen 共用同一個檔案。.section-title
// 樣式沿用 base-ui.css 的全站共用 class,刻意不建立專屬 CSS Module——
// 這個 class 是 ChatScreen 等多處畫面刻意共用的一套,拆成 CSS Module
// 只會製造重複定義。.row 相關的清單列樣式已改用共用元件
// components/ListRow.tsx 的 <ListRow>,不再是字串 className="row",
// 見該檔案開頭的說明。
//
// 不再自己渲染 navbar(標題+返回箭頭)——外殼改由呼叫端
// (PhoneContent.tsx)用共用容器 components/PhoneBottomSheet.tsx
// (mode="slide-close")包住,標題/關閉鈕交給該元件的 head slot,理由同
// trip/PhoneTripsDrawer.tsx(同一套 bottom sheet 模式,不在內容元件裡
// 重複刻一份標頭),onBack prop 因此移除(關閉改由 PhoneBottomSheet 的
// onClose 負責,拖曳下滑或點 head 的關閉鈕皆可觸發)。
//
// API Token/後端連線網址/健康檢查/說明區塊已移除(使用者明確要求——這些
// 是給開發除錯用的資訊,不是一般使用者會用到的設定項目,cfg 因此只剩
// LoginForm 需要的 baseURL 還在用)。
export function SettingsScreen({
  cfg,
  user,
  email,
  isGuest,
  onAuthed,
  onLogout,
  theme,
  setTheme,
}: {
  cfg: ClientConfig
  user: User
  email: string
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  theme: Theme
  setTheme: (v: Theme) => void
}) {
  const [assistLang, setAssistLang] = useState<AssistLang>(() => getAssistLang())

  return (
      <ScrollArea>
        {isGuest ? (
          <>
            <div className="section-title">目前身分</div>
            <ListRow icon={<Avatar user={user} />} title="訪客" subtitle="登入後發送的訊息會以你的身分顯示" />
            <LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} />
          </>
        ) : (
          <>
            <div className="section-title">目前登入</div>
            <ListRow icon={<Avatar user={user} />} title={user.name} subtitle={email || user.id} />
            <ListRow
              title="登出"
              titleColor="var(--ios-red)"
              onClick={onLogout}
              trailing={<ChevronLeft size={16} strokeWidth={1.5} color="#c7c7cc" style={{ transform: 'rotate(180deg)' }} />}
            />
          </>
        )}
        {/* 語言設定值實際上仍只透過 ASSIST_LANG_KEY 影響 LLM 回答語言
            (assist/語意查詢),標籤/說明文字改成使用者明確要求的通用說法,
            不再特別標注「LLM」、也不再強調「不影響介面文字」這句
            技術細節——對一般使用者而言,這裡就是「語言設定」。 */}
        <div className="section-title">語言</div>
        <FormField label="介面使用的語言">
          <LangSelect
            value={assistLang}
            onChange={(v) => {
              setAssistLang(v)
              localStorage.setItem(ASSIST_LANG_KEY, v)
            }}
          />
        </FormField>
        <div className="section-title">外觀</div>
        <FormField label="介面深色/淺色模式,「跟隨系統」會依裝置設定自動切換">
          <ThemeToggle value={theme} onChange={setTheme} />
        </FormField>
      </ScrollArea>
  )
}
