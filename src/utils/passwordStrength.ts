/**
 * 檔案名稱 (File): passwordStrength.ts
 * 模組功能 (Description): 「個人設定 → 變更密碼」的即時密碼強度評分（純函式，方便測試）。
 *
 * ★ 2026-10-29：自 ProfileSettings.tsx 抽出並修正——
 *   1. 「12345」同時命中「常見弱密碼」(-50) 與「連續數字」(-30) 兩條扣分，像 $Qt123456789 這種
 *      已達 12 字且四種字元齊全的密碼被扣到 0 分，強度條整條空白、看起來像沒作用。
 *      連續數字只扣一次（由「連續數字」那條負責）。
 *   2. 回傳扣分原因，畫面可直接告訴使用者為什麼偏弱。
 */

export const PASSWORD_STRENGTH_WEAK_MAX = 40;    // ≤ 40 弱
export const PASSWORD_STRENGTH_MEDIUM_MAX = 80;  // ≤ 80 中，其餘強
const BASE_LENGTH_THRESHOLD = 8;
const RECOMMENDED_LENGTH = 12;
const HIGH_MEMORABILITY_LENGTH_THRESHOLD = 16;

/** 扣分／未達標原因（畫面以 i18n 鍵 profile.strength_issue_<代碼> 顯示） */
export type PasswordStrengthIssue = 'too_short' | 'missing_types' | 'common_word' | 'sequential_digits' | 'keyboard_sequence' | 'repeated_chars';

export interface PasswordStrengthResult
{
	score: number;                    // 0 ~ 100
	level: 'none' | 'weak' | 'medium' | 'strong';
	issues: PasswordStrengthIssue[];
}

const COMMON_WORD_PATTERN = /(p[a@4][s$5]{2}w[o0]rd|admin|qwerty)/i;
const SEQUENTIAL_DIGITS_PATTERN = /(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/;
const KEYBOARD_SEQUENCE_PATTERN = /(qwer|asdf|zxcv|1q2w|qaz)/i;
const REPEATED_CHARS_PATTERN = /(.)\1{2,}/;

export const calculatePasswordStrength = (passwordString?: string | null): PasswordStrengthResult =>
{
	if (!passwordString) return { score: 0, level: 'none', issues: [] };

	const issues: PasswordStrengthIssue[] = [];
	let calculatedScore = 0;

	// 1. 長度
	if (passwordString.length >= BASE_LENGTH_THRESHOLD)
	{
		calculatedScore += 20 + Math.min(40, (passwordString.length - BASE_LENGTH_THRESHOLD) * 5);
	}
	if (passwordString.length < RECOMMENDED_LENGTH) issues.push('too_short');

	// 2. 字元種類（小寫／大寫／數字／符號，每種 +10）
	const characterTypeCount = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(passwordString)).length;
	calculatedScore += characterTypeCount * 10;
	if (characterTypeCount < 4) issues.push('missing_types');

	// 3. 長密碼獎勵
	if (passwordString.length >= HIGH_MEMORABILITY_LENGTH_THRESHOLD) calculatedScore += 15;

	// 4. 扣分
	if (COMMON_WORD_PATTERN.test(passwordString)) { calculatedScore -= 50; issues.push('common_word'); }
	if (SEQUENTIAL_DIGITS_PATTERN.test(passwordString)) { calculatedScore -= 30; issues.push('sequential_digits'); }
	if (KEYBOARD_SEQUENCE_PATTERN.test(passwordString)) { calculatedScore -= 30; issues.push('keyboard_sequence'); }
	if (REPEATED_CHARS_PATTERN.test(passwordString)) { calculatedScore -= 20; issues.push('repeated_chars'); }

	const score = Math.max(0, Math.min(100, calculatedScore));
	const level = score <= PASSWORD_STRENGTH_WEAK_MAX ? 'weak' : score <= PASSWORD_STRENGTH_MEDIUM_MAX ? 'medium' : 'strong';
	return { score, level, issues };
};

/** 強度條顯示的百分比：0 分時仍顯示一小段紅色，避免整條空白被誤以為強度條沒作用 */
export const MIN_VISIBLE_STRENGTH_PERCENT = 8;
export const toStrengthBarPercent = (result: PasswordStrengthResult): number =>
	result.level === 'none' ? 0 : Math.max(MIN_VISIBLE_STRENGTH_PERCENT, result.score);
