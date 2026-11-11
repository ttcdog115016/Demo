/**
 * ============================================================================
 * 檔案名稱 (File): AdaptivePopupSelect.tsx
 * 模組功能 (Description): Step2「資料預先處理」表格專用下拉選單。選單一律掛載於表格內部捲動區
 *                         (.ant-table-body) 內，只會在表格範圍內顯示，不會蓋到表格外的其他版面。
 *                         展開方向依列位置決定 (見 Step2_Mapping.tsx 之 resolveDropdownPopupModeForRow)：
 *                         - 'bottomLeft' / 'topLeft'：固定向下 / 向上 (欄位數 > 5 時使用)
 *                         - 'compact'：欄位數 ≤ 5 時使用。開啟前即時量測觸發元件上下方在表格內的
 *                           可用空間，選擇空間較大的一側，並把選單高度限制在該空間內 (超過則選單內捲動)。
 * 專案名稱 (Project): Privacy Protection Toolkit
 * ============================================================================
 */

import { useState } from 'react';
import type { Ref } from 'react';
import { Select } from 'antd';
import type { SelectProps, RefSelectProps } from 'antd';

export type DropdownPopupMode = 'compact' | 'topLeft' | 'bottomLeft';
type DropdownDirection = 'topLeft' | 'bottomLeft';

/**
 * 魔術數字常數 (規範 e)
 */
const OPTION_ITEM_HEIGHT_PX = 32;        // Ant Design 下拉選項預設高度 (token.controlHeight)
const POPUP_VERTICAL_PADDING_PX = 8;     // 選單上下內距合計
const POPUP_GAP_PX = 4;                  // 選單與觸發元件之間距 (同 offset)
const DEFAULT_LIST_HEIGHT_PX = 256;      // Ant Design 預設選單清單最大高度
const MIN_LIST_HEIGHT_PX = 64;           // 選單清單最小高度 (約 2 個選項)

/**
 * 下拉選單彈出位置設定
 * 規範對照: adjustY 一律 false，停用 Ant Design 自動翻轉；方向完全由本元件/呼叫端決定，
 *           避免選單翻轉後蓋住表格標題列 (歷史跑版問題)。
 */
const SELECT_DROPDOWN_PLACEMENTS = {
    bottomLeft: {
        points: ['tl', 'bl'],
        offset: [0, POPUP_GAP_PX],
        overflow: { adjustX: true, adjustY: false }
    },
    topLeft: {
        points: ['bl', 'tl'],
        offset: [0, -POPUP_GAP_PX],
        overflow: { adjustX: true, adjustY: false }
    }
};

/**
 * 函數名稱: resolveTableScrollAreaAsPopupContainer
 * 函數功能: 讓下拉選單掛載於表格自身可捲動的內容區塊 (`.ant-table-body`) 內，而非 document.body，
 *           並確保該容器具備正確的定位基準 (position: relative)。
 * 規範對照: 修正表格內部捲動時下拉選單浮貼在畫面上、蓋住表格標題列的跑版問題；
 *           2026-10-07 起也用來確保選單不會蓋到表格以外的版面 (如「第二階段」標題)。
 *           找不到該容器時 (理論上不會發生) 則退回 document.body。
 */
const resolveTableScrollAreaAsPopupContainer = (triggerDomNode: HTMLElement): HTMLElement =>
{
    const tableScrollAreaElement = triggerDomNode.closest('.ant-table-body') as HTMLElement | null;
    if (!tableScrollAreaElement)
    {
        return document.body;
    }

    // .ant-table-body 預設 position: static，需明確賦予 relative 作為定位基準，否則選單會相對更外層定位而偏移。
    if (window.getComputedStyle(tableScrollAreaElement).position === 'static')
    {
        tableScrollAreaElement.style.position = 'relative';
    }

    return tableScrollAreaElement;
};

/**
 * 函數名稱: measureDropdownLayout
 * 函數功能: 量測觸發元件在表格捲動區「可見範圍」內上下方剩餘空間，決定展開方向與清單高度。
 *           下方放得下完整清單 → 向下；否則取上下較大的一側，清單高度限制在該側空間內。
 */
const measureDropdownLayout = (anyNodeInsideSelect: HTMLElement, optionCount: number): { placement: DropdownDirection; listHeight: number } | null =>
{
    const selectTriggerElement = (anyNodeInsideSelect.closest('.ant-select') as HTMLElement | null) ?? anyNodeInsideSelect;
    const tableScrollAreaElement = selectTriggerElement.closest('.ant-table-body') as HTMLElement | null;
    if (!tableScrollAreaElement)
    {
        return null;
    }

    const triggerRect = selectTriggerElement.getBoundingClientRect();
    const scrollAreaRect = tableScrollAreaElement.getBoundingClientRect();
    const reservedPx = POPUP_GAP_PX + POPUP_VERTICAL_PADDING_PX;
    const spaceBelowPx = scrollAreaRect.bottom - triggerRect.bottom - reservedPx;
    const spaceAbovePx = triggerRect.top - scrollAreaRect.top - reservedPx;
    const fullListHeightPx = Math.min(Math.max(optionCount, 1) * OPTION_ITEM_HEIGHT_PX, DEFAULT_LIST_HEIGHT_PX);

    const shouldOpenDownwardStatus = spaceBelowPx >= fullListHeightPx || spaceBelowPx >= spaceAbovePx;
    const chosenSpacePx = shouldOpenDownwardStatus ? spaceBelowPx : spaceAbovePx;

    return {
        placement: shouldOpenDownwardStatus ? 'bottomLeft' : 'topLeft',
        listHeight: Math.max(MIN_LIST_HEIGHT_PX, Math.min(fullListHeightPx, Math.floor(chosenSpacePx)))
    };
};

type AdaptivePopupSelectProps = SelectProps & {
    popupMode: DropdownPopupMode;   // 展開方式 (見檔頭說明)
    ref?: Ref<RefSelectProps>;      // 供外層 Tooltip 等元件轉傳 ref
};

/**
 * 元件名稱: AdaptivePopupSelect
 * 元件功能: 包裝 Ant Design Select，統一處理表格內下拉選單之掛載容器與展開方向。
 *           其餘屬性原樣轉傳給 Select。
 */
export default function AdaptivePopupSelect({ popupMode, onMouseDown, onFocus, ref, ...restSelectProps }: AdaptivePopupSelectProps)
{
    const [measuredLayout, setMeasuredLayout] = useState<{ placement: DropdownDirection; listHeight: number }>({ placement: 'bottomLeft', listHeight: DEFAULT_LIST_HEIGHT_PX });
    const isAdaptiveModeStatus = popupMode === 'compact';
    const optionCount = restSelectProps.options?.length ?? DEFAULT_LIST_HEIGHT_PX / OPTION_ITEM_HEIGHT_PX;

    // 在選單開啟前 (滑鼠按下／鍵盤聚焦) 先量測，與 Select 內部開啟動作同一批次更新，開啟當下即套用正確方向與高度。
    const refreshMeasuredLayout = (eventTargetNode: EventTarget | null) =>
    {
        if (!isAdaptiveModeStatus || !(eventTargetNode instanceof HTMLElement))
        {
            return;
        }
        const nextLayout = measureDropdownLayout(eventTargetNode, optionCount);
        if (nextLayout && (nextLayout.placement !== measuredLayout.placement || nextLayout.listHeight !== measuredLayout.listHeight))
        {
            setMeasuredLayout(nextLayout);
        }
    };

    return (
        <Select
            {...restSelectProps}
            ref={ref}
            placement={isAdaptiveModeStatus ? measuredLayout.placement : popupMode}
            listHeight={isAdaptiveModeStatus ? measuredLayout.listHeight : restSelectProps.listHeight}
            builtinPlacements={SELECT_DROPDOWN_PLACEMENTS}
            getPopupContainer={resolveTableScrollAreaAsPopupContainer}
            onMouseDown={(mouseDownEvent) =>
            {
                refreshMeasuredLayout(mouseDownEvent.currentTarget);
                onMouseDown?.(mouseDownEvent);
            }}
            onFocus={(focusEvent) =>
            {
                refreshMeasuredLayout(focusEvent.target);
                onFocus?.(focusEvent);
            }}
        />
    );
}
