# 常見前端設計缺失

實際發生過或容易發生的錯誤,每則只需簡短描述問題與正確做法,用於避免重蹈覆轍。新增項目時保持精簡,不必展開長篇解釋。

- **IME 組字中的 Enter 被誤判成送出**:注音/日文/韓文等輸入法在選字確認時也會觸發 `keydown` 的 Enter,若直接用 `e.key === 'Enter'` 判斷送出,會在使用者只是選字、還沒打完字時就提早送出表單。正確做法:用 `e.nativeEvent.isComposing`(或 `keyCode !== 229`)排除組字中的 Enter,見 `AppCommon.tsx` 的 `isSubmitEnter`,所有 Enter 送出的輸入框都應該共用這支工具函式。

- **可點元素沒有 `cursor: pointer`**:`role="button"` 的 div、可點卡片容易忘記加游標樣式,使用者滑過去看不出能點。見 `frontend-design-guidelines` SKILL.md 的「狀態要看得見」章節。
