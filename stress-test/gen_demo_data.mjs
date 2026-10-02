/**
 * 產生與 configs/config_kanon.json、config_dp.json 欄位一致的合成測試資料（全為假資料）。
 * 欄位：姓名,身分證號,生日,年齡,地區,職業,疾病,薪資,婚姻狀況,就醫次數
 * 單獨執行：node stress-test/gen_demo_data.mjs 10000 > demo.csv
 */
const SURNAMES = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周'.split('');
const GIVEN = '志明美麗大同靜宜家豪雅婷俊傑淑芬建宏怡君冠宇佳穎承恩欣怡宗翰詩涵'.split('');
const REGIONS = ['大安區', '中正區', '板橋區', '苓雅區'];
const JOBS = ['工程師', '教師', '醫師', '公務員', '服務業', '自由業', '學生', '退休'];
const DISEASES = ['無', '高血壓', '糖尿病', '氣喘', '憂鬱症', '心臟病'];
const MARITAL = ['未婚', '已婚', '離婚', '喪偶'];
const ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';

const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const generateDemoCsv = (rows, seed = 1) => {
    const rnd = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const out = ['姓名,身分證號,生日,年齡,地區,職業,疾病,薪資,婚姻狀況,就醫次數'];
    for (let i = 0; i < rows; i++) {
        const age = 18 + Math.floor(rnd() * 70);
        const birthYear = 2026 - age;
        const month = 1 + Math.floor(rnd() * 12);
        const day = 1 + Math.floor(rnd() * 28);
        const job = age >= 65 ? '退休' : age <= 22 && rnd() < 0.7 ? '學生' : pick(JOBS.slice(0, 6));
        const salary = job === '學生' || job === '退休' ? Math.floor(rnd() * 30) * 1000 : Math.round((30000 + rnd() * rnd() * 220000) / 1000) * 1000;
        const id = ID_LETTERS[Math.floor(rnd() * 26)] + (rnd() < 0.5 ? '1' : '2') + String(Math.floor(rnd() * 1e8)).padStart(8, '0');
        const disease = rnd() < 0.55 ? '無' : pick(DISEASES.slice(1));
        const visits = Math.min(20, Math.floor(rnd() * (disease === '無' ? 4 : 12) + (age > 60 ? 3 : 0)));
        out.push([
            pick(SURNAMES) + pick(GIVEN) + pick(GIVEN), id,
            `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            age, pick(REGIONS), job, disease, salary,
            age < 25 ? '未婚' : pick(MARITAL), visits,
        ].join(','));
    }
    return out.join('\n') + '\n';
};

if (process.argv[1] && process.argv[1].endsWith('gen_demo_data.mjs')) {
    process.stdout.write(generateDemoCsv(Number(process.argv[2] || 5000), 20260930));
}
