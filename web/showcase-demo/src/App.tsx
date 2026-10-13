import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ShowcaseDemoIndex } from './ShowcaseDemoIndex'
import { ItineraryShowcasePage } from './ItineraryShowcasePage'
import { ComponentConventionsPage } from './ComponentConventionsPage'
import { PlanningModesPage } from './PlanningModesPage'
import { ItineraryCheckupPage } from './ItineraryCheckupPage'
import { PostComposerPage } from './PostComposerPage'
import { AdSystemPage } from './AdSystemPage'
import { AdAdminDemoPage } from './AdAdminDemoPage'

// 2026-10:從主站 web/ 的 web/src/showcase-demo/ 搬出來,成為完全獨立的
// 小站(自己的 package.json/dev server,見根目錄 vite.config.ts 的完整
// 說明),不再掛在主站 App.tsx 的路由底下。原本主站路由是
// /showcase-demo、/showcase-demo/itinerary-showcase 等有 /showcase-demo
// 前綴的路徑,搬出來後這個小站本身就是獨立網站,前綴移除,首頁
// ShowcaseDemoIndex 直接掛在根路徑 "/"。
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ShowcaseDemoIndex />} />
        <Route path="/itinerary-showcase" element={<ItineraryShowcasePage />} />
        <Route path="/component-conventions" element={<ComponentConventionsPage />} />
        <Route path="/planning-modes" element={<PlanningModesPage />} />
        <Route path="/itinerary-checkup" element={<ItineraryCheckupPage />} />
        <Route path="/post-composer" element={<PostComposerPage />} />
        <Route path="/ad-system" element={<AdSystemPage />} />
        <Route path="/ad-admin-demo" element={<AdAdminDemoPage />} />
      </Routes>
    </BrowserRouter>
  )
}
