/**
 * 檔案名稱 (File): sha3.ts
 * 模組功能 (Description): FIPS 202 SHA3-256／SHA3-512 與其 HMAC（純 TypeScript，同步計算）。
 *
 * ★ 2026-10-27：Step2「資料預先處理」的雜湊改由後端 /api/v1/preprocess 實際執行，後端提供
 *   sha256／sha3-256／sha3-512 三種演算法（HMAC，鹽值為金鑰）。畫面預覽需與後端算出相同結果，
 *   但 crypto-js 的 SHA3 是 Keccak 舊版填充（非 FIPS 202），Web Crypto 也不支援 SHA3，故自行實作。
 *   僅用於畫面預覽少量樣本，不追求效能。
 */

const KECCAK_ROUNDS = 24;

// 以 BigInt 表示 64-bit lane，程式最直觀；預覽只算少量樣本，效能無妨
const MASK_64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS: bigint[] = [
	0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
	0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
	0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
	0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
	0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
	0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// 旋轉位移量 r[x][y]
const ROTATION_OFFSETS: number[][] = [
	[0, 36, 3, 41, 18],
	[1, 44, 10, 45, 2],
	[62, 6, 43, 15, 61],
	[28, 55, 25, 21, 56],
	[27, 20, 39, 8, 14],
];

const rotl64 = (value: bigint, shift: number): bigint =>
	shift === 0 ? value : (((value << BigInt(shift)) | (value >> BigInt(64 - shift))) & MASK_64);

/** Keccak-f[1600] 置換；state 以 [x + 5y] 索引 */
const keccakF1600 = (state: bigint[]): void =>
{
	for (let roundIndex = 0; roundIndex < KECCAK_ROUNDS; roundIndex++)
	{
		const columnParity: bigint[] = [];
		for (let x = 0; x < 5; x++) columnParity[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
		for (let x = 0; x < 5; x++)
		{
			const thetaValue = columnParity[(x + 4) % 5] ^ rotl64(columnParity[(x + 1) % 5], 1);
			for (let y = 0; y < 5; y++) state[x + 5 * y] ^= thetaValue;
		}
		const rhoPiState: bigint[] = new Array(25).fill(0n);
		for (let x = 0; x < 5; x++)
		{
			for (let y = 0; y < 5; y++)
			{
				rhoPiState[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], ROTATION_OFFSETS[x][y]);
			}
		}
		for (let x = 0; x < 5; x++)
		{
			for (let y = 0; y < 5; y++)
			{
				state[x + 5 * y] = rhoPiState[x + 5 * y] ^ ((~rhoPiState[((x + 1) % 5) + 5 * y] & MASK_64) & rhoPiState[((x + 2) % 5) + 5 * y]);
			}
		}
		state[0] ^= ROUND_CONSTANTS[roundIndex];
	}
};

/** SHA3（FIPS 202，填充 0x06…0x80）；outputBytes 為 32（SHA3-256）或 64（SHA3-512） */
const sha3Bytes = (messageBytes: Uint8Array, outputBytes: 32 | 64): Uint8Array =>
{
	const rateBytes = 200 - 2 * outputBytes;
	const paddedLength = (Math.floor(messageBytes.length / rateBytes) + 1) * rateBytes;
	const paddedBytes = new Uint8Array(paddedLength);
	paddedBytes.set(messageBytes);
	paddedBytes[messageBytes.length] ^= 0x06;
	paddedBytes[paddedLength - 1] ^= 0x80;

	const state: bigint[] = new Array(25).fill(0n);
	for (let blockOffset = 0; blockOffset < paddedLength; blockOffset += rateBytes)
	{
		for (let laneIndex = 0; laneIndex < rateBytes / 8; laneIndex++)
		{
			let laneValue = 0n;
			for (let byteIndex = 7; byteIndex >= 0; byteIndex--) laneValue = (laneValue << 8n) | BigInt(paddedBytes[blockOffset + laneIndex * 8 + byteIndex]);
			state[laneIndex] ^= laneValue;
		}
		keccakF1600(state);
	}

	const digestBytes = new Uint8Array(outputBytes);
	for (let byteIndex = 0; byteIndex < outputBytes; byteIndex++)
	{
		digestBytes[byteIndex] = Number((state[Math.floor(byteIndex / 8)] >> BigInt(8 * (byteIndex % 8))) & 0xffn);
	}
	return digestBytes;
};

const toHex = (byteArray: Uint8Array): string => Array.from(byteArray, (byteValue) => byteValue.toString(16).padStart(2, '0')).join('');

/** HMAC（RFC 2104），區塊大小即 SHA3 的 rate */
const hmacSha3Bytes = (keyBytes: Uint8Array, messageBytes: Uint8Array, outputBytes: 32 | 64): Uint8Array =>
{
	const blockSize = 200 - 2 * outputBytes;
	let normalizedKey = keyBytes.length > blockSize ? sha3Bytes(keyBytes, outputBytes) : keyBytes;
	const paddedKey = new Uint8Array(blockSize);
	paddedKey.set(normalizedKey);
	normalizedKey = paddedKey;
	const innerInput = new Uint8Array(blockSize + messageBytes.length);
	const outerInput = new Uint8Array(blockSize + outputBytes);
	for (let byteIndex = 0; byteIndex < blockSize; byteIndex++)
	{
		innerInput[byteIndex] = normalizedKey[byteIndex] ^ 0x36;
		outerInput[byteIndex] = normalizedKey[byteIndex] ^ 0x5c;
	}
	innerInput.set(messageBytes, blockSize);
	outerInput.set(sha3Bytes(innerInput, outputBytes), blockSize);
	return sha3Bytes(outerInput, outputBytes);
};

const utf8 = (textValue: string): Uint8Array => new TextEncoder().encode(textValue);

/**
 * 函數名稱: sha3Hex
 * 函數功能: 計算 SHA3-256／SHA3-512；有鹽值時改算 HMAC（與後端 hash_mask 相同：hmac.new(鹽, 值, sha3_*)）。
 */
export const sha3Hex = (textValue: string, bits: 256 | 512, saltKey?: string | null): string =>
{
	const outputBytes = bits === 256 ? 32 : 64;
	return toHex(saltKey ? hmacSha3Bytes(utf8(saltKey), utf8(textValue), outputBytes) : sha3Bytes(utf8(textValue), outputBytes));
};
