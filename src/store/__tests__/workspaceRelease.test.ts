/**
 * ★ 2026-11-06：重新開始／重新上傳須釋放原始資料、去識別化結果與模組快取，並還原初始設定。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore, registerWorkspaceReleaseHook } from '../useWorkspaceStore';

const fillWorkspaceWithUsedState = (): void =>
{
	useWorkspaceStore.setState({
		dataFile: new File(['a,b\n1,2\n'], 'data.csv'),
		fileName: 'data.csv',
		columns: ['a', 'b'],
		previewData: [{ a: '1', b: '2' }],
		currentStep: 3,
		kValue: 10,
		maxSuppression: 50,
		enableLDiversity: true,
		budgetLimitEpsilon: 3,
		queryCount: 7,
		columnRoles: { a: 'QI' } as never,
		step4Cache: { processedCsvBlob: new Blob(['x']) } as never,
		lastRunParamsHash: 'hash'
	});
};

describe('工作區釋放（重新開始／重新上傳）', () =>
{
	beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true));

	it.each(['resetWorkspace', 'clearFileData'] as const)('%s：資料、結果與設定全部還原為初始值', (actionName) =>
	{
		const initialState = useWorkspaceStore.getInitialState();
		fillWorkspaceWithUsedState();
		useWorkspaceStore.getState()[actionName]();
		const state = useWorkspaceStore.getState();
		expect(state.dataFile).toBeNull();
		expect(state.previewData).toEqual([]);
		expect(state.step4Cache).toBeNull();
		expect(state.lastRunParamsHash).toBeNull();
		expect(state.columnRoles).toEqual({});
		expect(state.currentStep).toBe(initialState.currentStep);
		expect(state.kValue).toBe(initialState.kValue);
		expect(state.maxSuppression).toBe(initialState.maxSuppression);
		expect(state.enableLDiversity).toBe(initialState.enableLDiversity);
		expect(state.budgetLimitEpsilon).toBe(initialState.budgetLimitEpsilon);
		expect(state.queryCount).toBe(initialState.queryCount);
	});

	it('保留後端同步的 sessionTimeout，並呼叫各模組登記的清除函式', () =>
	{
		const releaseHook = vi.fn();
		registerWorkspaceReleaseHook(releaseHook);
		useWorkspaceStore.setState({ sessionTimeout: 900 } as never);
		useWorkspaceStore.getState().clearFileData();
		expect((useWorkspaceStore.getState() as unknown as { sessionTimeout?: number }).sessionTimeout).toBe(900);
		expect(releaseHook).toHaveBeenCalledTimes(1);
	});
});
