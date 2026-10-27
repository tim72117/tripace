import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HandbookIndex } from './HandbookIndex'
import { ItineraryShowcasePage } from './ItineraryShowcasePage'
import { ComponentConventionsPage } from './ComponentConventionsPage'
import { PlanningModesPage } from './PlanningModesPage'
import { ItineraryCheckupPage } from './ItineraryCheckupPage'
import { PostComposerPage } from './PostComposerPage'
import { AdSystemPage } from './AdSystemPage'
import { AdAdminDemoPage } from './AdAdminDemoPage'
import { AdAffiliateComparePage } from './AdAffiliateComparePage'
import { RoutePathPlanningPage } from './RoutePathPlanningPage'
import { RoutePathMapSkeletonPage } from './RoutePathMapSkeletonPage'
import { ItineraryPosterPage } from './ItineraryPosterPage'
import { ItineraryMonopolyPage } from './ItineraryMonopolyPage'
import { ItineraryPlayfulMapPage } from './ItineraryPlayfulMapPage'
import { PlanDataFlowPage } from './PlanDataFlowPage'
import { MarkerLayersPage } from './MarkerLayersPage'
import { TimelineArchitecturePage } from './TimelineArchitecturePage'
import { IdeasIndexPage } from './ideas/IdeasIndexPage'
import { IdeaPage } from './ideas/IdeaPage'
import { HandbookHome } from './HandbookHome'
import { HANDBOOK_CATEGORIES } from './categories'

// 2026-10:從主站 web/ 的 web/src/handbook/ 搬出來,成為完全獨立的
// 小站(自己的 package.json/dev server,見根目錄 vite.config.ts 的完整
// 說明),不再掛在主站 App.tsx 的路由底下。原本主站路由是
// /handbook、/handbook/itinerary-showcase 等有 /handbook
// 前綴的路徑,搬出來後這個小站本身就是獨立網站,前綴移除,首頁
// HandbookIndex 直接掛在根路徑 "/"。
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HandbookHome />} />
        {/* 首頁分類(見 categories.ts):構想類用構想總覽版型,雛形與系統文件用 HandbookIndex */}
        {HANDBOOK_CATEGORIES.map((c) => (
          <Route
            key={c.id}
            path={`/category/${c.id}`}
            element={
              c.groupIds ? <IdeasIndexPage category={c.id} /> : <HandbookIndex mode={c.id as 'prototypes' | 'system-docs'} />
            }
          />
        ))}
        <Route path="/itinerary-showcase" element={<ItineraryShowcasePage />} />
        <Route path="/component-conventions" element={<ComponentConventionsPage />} />
        <Route path="/planning-modes" element={<PlanningModesPage />} />
        <Route path="/itinerary-checkup" element={<ItineraryCheckupPage />} />
        <Route path="/post-composer" element={<PostComposerPage />} />
        <Route path="/ad-system" element={<AdSystemPage />} />
        <Route path="/ad-admin-demo" element={<AdAdminDemoPage />} />
        <Route path="/route-path-planning" element={<RoutePathPlanningPage />} />
        <Route path="/route-path-map-skeleton" element={<RoutePathMapSkeletonPage />} />
        <Route path="/itinerary-poster" element={<ItineraryPosterPage />} />
        <Route path="/itinerary-monopoly" element={<ItineraryMonopolyPage />} />
        <Route path="/itinerary-playful-map" element={<ItineraryPlayfulMapPage />} />
        <Route path="/ad-affiliate-compare" element={<AdAffiliateComparePage />} />
        <Route path="/plan-data-flow" element={<PlanDataFlowPage />} />
        <Route path="/marker-layers" element={<MarkerLayersPage />} />
        <Route path="/timeline-architecture" element={<TimelineArchitecturePage />} />
        <Route path="/ideas" element={<IdeasIndexPage />} />
        <Route path="/ideas/:id" element={<IdeaPage />} />
      </Routes>
    </BrowserRouter>
  )
}
